"""Mindat lookups (#18): which term is asked, which answer is taken, the chain and
the cache, what a failure leaves, and the worker's part. A fake API stands in
for Mindat; the HTTP itself stays untested."""

import logging
from datetime import datetime, timezone

import pytest
from PIL import Image

from jasper import db, identify, llm, mindat, queue, worker

NOW = datetime(2026, 11, 2, 15, 0, tzinfo=timezone.utc)
HAIKU = identify.Role("identifier", "anthropic/claude-haiku-5.5", "medium")
FLASH = identify.Role("second opinion", "google/gemini-3.8-flash", "low")
CFG = identify.Settings(key="k", roles=(HAIKU, FLASH), prompt_version=1, system="SYSTEM")


def rec(id, name, entrytype="mineral", varietyof=0, synid=0, hmin=0, hmax=0, streak=""):
    return {"id": id, "name": name, "entrytype_text": entrytype, "varietyof": varietyof, "synid": synid,
            "hmin": hmin, "hmax": hmax, "streak": streak}


# Shaped on Mindat's own records, checked on 2026-11-02.
RECORDS = [
    rec(3337, "Quartz", hmin=7, hmax=7, streak="White"),
    rec(960, "Chalcedony", "variety", varietyof=3337, hmin=6.5, hmax=7, streak="White"),
    rec(51, "Agate", "variety", varietyof=960, hmin=6.5, hmax=7, streak="white"),
    rec(9333, "Carnelian", "variety", varietyof=960),
    rec(7595, "Crazy Lace Agate", "variety", varietyof=51),
    rec(549, "Baryte", hmin=3, hmax=3, streak="white"),
    rec(4723, "Barite", "synonym", synid=549),
    rec(1856, "Hematite", hmin=5, hmax=6),
    rec(36610, "Hématite", "synonym", synid=1856),
    rec(2082, "Jasper", "rock"),
]


class FakeApi:
    """Mindat as the tests need it: an exact search ignoring case and accents, and records by id."""

    def __init__(self, records=RECORDS, fail=False):
        self.records = {r["id"]: r for r in records}
        self.fail = fail
        self.requests = 0
        self.asked = []

    def search(self, term):
        self.requests += 1
        self.asked.append(term)
        if self.fail:
            raise mindat.Unreachable("api.mindat.org answered 504")
        return [r for r in self.records.values() if mindat.fold(r["name"]) == mindat.fold(term)]

    def record(self, mindat_id):
        self.requests += 1
        if self.fail:
            raise mindat.Unreachable("api.mindat.org answered 504")
        return self.records.get(mindat_id)


def _db(tmp_path):
    return db.connect(tmp_path / "q.db")


def _resolve(conn, api, name, variety=None):
    return mindat.resolve(conn, api, name, variety, deadline=float("inf"))


def _chain(conn, rid):
    out = []
    while rid is not None:
        row = conn.execute("SELECT id, name, varietyof FROM mindat_records WHERE id = ?", (rid,)).fetchone()
        if row is None:
            break
        out.append(row["name"])
        rid = row["varietyof"]
    return out


# --- what to ask, and which answer is the one --------------------------------


def test_terms_run_from_the_most_specific():
    assert mindat.terms("Chalcedony", "Agate, banded") == ["Agate, banded", "Agate", "Chalcedony"]
    assert mindat.terms("Quartz", "  Rose   Quartz ") == ["Rose Quartz", "Quartz"]
    assert mindat.terms("Galena", None) == ["Galena"]
    assert mindat.terms("Quartz", "quartz") == ["quartz"]


def test_fold_drops_case_accents_and_curly_apostrophes():
    assert mindat.fold("Hématite") == "hematite"
    assert mindat.fold("Tiger’s  Eye") == "tiger's eye"


def test_pick_takes_the_exact_name_and_an_entry_before_a_synonym():
    hematite = [r for r in RECORDS if mindat.fold(r["name"]) == "hematite"]
    assert mindat.pick(list(reversed(hematite)), "Hematite")["id"] == 1856
    assert mindat.pick([rec(51, "Agate", "variety")], "Banded Agate") is None


# --- the chain and the cache ---------------------------------------------------


def test_the_agate_case_resolves_through_the_variety_and_caches_its_chain(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    assert _resolve(conn, api, "Chalcedony", "Agate, banded") == 51
    assert api.asked == ["Agate, banded", "Agate"]
    assert _chain(conn, 51) == ["Agate", "Chalcedony", "Quartz"]
    terms = {r["term"]: r["mindat_id"] for r in conn.execute("SELECT term, mindat_id FROM mindat_terms")}
    assert terms == {"agate, banded": None, "agate": 51}
    asked = api.requests
    assert _resolve(conn, api, "Quartz", "Agate") == 51
    assert api.requests == asked  # the other model's agate costs nothing


def test_a_synonym_is_followed_to_its_entry(tmp_path):
    conn = _db(tmp_path)
    assert _resolve(conn, FakeApi(), "Barite") == 549
    row = conn.execute("SELECT name, hmin, hmax FROM mindat_records WHERE id = 549").fetchone()
    assert tuple(row) == ("Baryte", 3.0, 3.0)
    assert conn.execute("SELECT COUNT(*) FROM mindat_records WHERE id = 4723").fetchone()[0] == 0


def test_a_variety_wins_over_the_name_and_brings_its_whole_chain(tmp_path):
    conn = _db(tmp_path)
    assert _resolve(conn, FakeApi(), "Quartz", "Crazy Lace Agate") == 7595
    assert _chain(conn, 7595) == ["Crazy Lace Agate", "Agate", "Chalcedony", "Quartz"]


def test_a_variety_mindat_does_not_know_falls_back_to_the_name(tmp_path):
    conn = _db(tmp_path)
    assert _resolve(conn, FakeApi(), "Quartz", "Purple") == 3337


def test_a_name_mindat_does_not_know_is_asked_once(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    assert _resolve(conn, api, "Banded Agate") is None
    assert _resolve(conn, api, "banded agate") is None
    assert api.requests == 1


def test_a_hardness_of_zero_is_stored_as_none(tmp_path):
    conn = _db(tmp_path)
    _resolve(conn, FakeApi(), "Chalcedony", "Carnelian")
    row = conn.execute("SELECT hmin, hmax, streak FROM mindat_records WHERE id = 9333").fetchone()
    assert tuple(row) == (None, None, None)


def test_a_long_chain_stops_at_the_depth_cap(tmp_path):
    conn = _db(tmp_path)
    chain = [rec(100 + i, f"Level {i}", "variety", varietyof=100 + i + 1) for i in range(10)]
    assert _resolve(conn, FakeApi(chain), "Level 0") == 100
    assert len(_chain(conn, 100)) == mindat.MAX_DEPTH


def test_a_failure_raises_and_caches_nothing(tmp_path):
    conn = _db(tmp_path)
    with pytest.raises(mindat.Unreachable):
        _resolve(conn, FakeApi(fail=True), "Agate")
    assert conn.execute("SELECT COUNT(*) FROM mindat_terms").fetchone()[0] == 0


def test_no_request_once_the_time_is_up(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    with pytest.raises(mindat.Unreachable, match="out of time"):
        mindat.resolve(conn, api, "Agate", None, deadline=10.0, clock=lambda: 11.0)
    assert api.requests == 0


def test_the_api_comes_from_the_environment_and_hides_its_key():
    assert mindat.api({}) is None
    assert mindat.api({"MINDAT_API_KEY": "  "}) is None
    api = mindat.api({"MINDAT_API_KEY": " secret "})
    assert isinstance(api, mindat.Api) and "secret" not in repr(api)


# --- a job's candidates ----------------------------------------------------------


def _outcome(*answers):
    opinions = [
        identify.Opinion(role, 200, identify.Answer([identify.Candidate(n, v, "mineral", 0.5) for n, v in cands], [], None))
        for role, cands in zip((HAIKU, FLASH), answers)
    ]
    return identify.classify(opinions)


def _job(conn, status="queued"):
    jid = conn.execute("INSERT INTO jobs (status) VALUES (?)", (status,)).lastrowid
    conn.commit()
    return jid


def test_an_identified_job_is_written_with_each_candidates_record(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    out = _outcome([("Chalcedony", "Agate, banded"), ("Jasper", None)], [("Quartz", "Agate"), ("Banded Agate", None)])
    assert mindat.resolve_outcome(conn, api, out) == "mindat 6 requests"
    jid = _job(conn)
    queue.record_outcome(conn, jid, out, NOW)
    rows = conn.execute("SELECT model, rank, mindat_id FROM candidates ORDER BY model, rank").fetchall()
    assert [tuple(r) for r in rows] == [(HAIKU.model, 1, 51), (HAIKU.model, 2, 2082), (FLASH.model, 1, 51), (FLASH.model, 2, None)]
    assert mindat.resolve_outcome(conn, api, out) == "mindat cached"


def test_a_failed_lookup_leaves_the_job_as_it_would_be(tmp_path):
    conn = _db(tmp_path)
    out = _outcome([("Calcite", None)], [("Calcite", None)])
    assert mindat.resolve_outcome(conn, FakeApi(fail=True), out) == "mindat stopped: api.mindat.org answered 504"
    assert all(c.mindat_id is None for o in out.opinions for c in o.answer.candidates)
    assert out.status == "identified"


def test_catch_up_fills_only_jobs_still_waiting_for_a_name(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    waiting, named = _job(conn, "identified"), _job(conn, "identified")
    for jid in (waiting, named):
        conn.execute("INSERT INTO candidates (job_id, model, rank, name, variety, kind, confidence) VALUES (?, ?, 1, 'Quartz', 'Agate', 'mineral', 0.5)",
                     (jid, HAIKU.model))
    mineral = conn.execute("INSERT INTO minerals (name) VALUES ('Quartz')").lastrowid
    specimen = conn.execute("INSERT INTO specimens (mineral_id) VALUES (?)", (mineral,)).lastrowid
    conn.execute("INSERT INTO confirmations (job_id, specimen_id, chosen_name, source, how, verdict) VALUES (?, ?, 'Quartz', 'pill', 'suggestion', 'could_be')",
                 (named, specimen))
    conn.commit()
    assert mindat.catch_up(conn, api) == 1
    ids = dict(conn.execute("SELECT job_id, mindat_id FROM candidates").fetchall())
    assert ids == {waiting: 51, named: None}
    assert mindat.catch_up(conn, api) == 0


def test_run_once_looks_up_the_candidates_and_says_so(tmp_path, caplog):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    (data / "photos").mkdir(parents=True)
    Image.new("RGB", (400, 300), (180, 90, 40)).save(data / "photos" / "agate.jpg", "JPEG")
    jid = _job(conn)
    conn.execute("INSERT INTO photos (path, job_id) VALUES ('photos/agate.jpg', ?)", (jid,))
    conn.commit()

    def fake_ask(key, body):
        name, variety = ("Chalcedony", "Agate, banded") if body["model"] == HAIKU.model else ("Quartz", "Agate")
        text = ('{"candidates": [{"name": "%s", "variety": "%s", "kind": "mineral", "confidence": 0.6, "features": []}],'
                ' "tests": [], "label_text": ""}') % (name, variety)
        return llm.Response(200, {"stop_reason": "end_turn", "content": [{"type": "text", "text": text}]}, 1.0)

    with caplog.at_level(logging.INFO, logger="jasper"):
        worker.run_once(conn, data, CFG, NOW, ask=fake_ask, mindat_api=FakeApi())
    assert [r[0] for r in conn.execute("SELECT mindat_id FROM candidates ORDER BY model")] == [51, 51]
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith(f"job {jid} "))
    assert " · mindat 4 requests · " in line and line.endswith(" s")
