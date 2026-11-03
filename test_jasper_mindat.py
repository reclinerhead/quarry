"""Mindat lookups (#18): which term is asked, which answer is taken, the chain and
the cache, what a failure leaves, and the worker's part. Enrichment (#21): each
named mineral linked to its record, and the records it needs fetched whole, once.
A fake API stands in for Mindat; the HTTP itself stays untested."""

import json

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


class Clock:
    """Time that moves only when the fake API is asked something: a second a request."""

    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class FakeApi:
    """Mindat as the tests need it: an exact search ignoring case and accents, records by
    id, and whole records, which carry more than the lean ones."""

    def __init__(self, records=RECORDS, fail=False, fail_full=(), clock=None):
        self.records = {r["id"]: r for r in records}
        self.fail = fail
        self.fail_full = set(fail_full)
        self.clock = clock
        self.requests = 0
        self.asked = []
        self.fetched = []

    def _request(self):
        self.requests += 1
        if self.clock:
            self.clock.t += 1
        if self.fail:
            raise mindat.Unreachable("api.mindat.org answered 504")

    def search(self, term):
        self._request()
        self.asked.append(term)
        return [r for r in self.records.values() if mindat.fold(r["name"]) == mindat.fold(term)]

    def record(self, mindat_id):
        self._request()
        return self.records.get(mindat_id)

    def full(self, mindat_id):
        self._request()
        self.fetched.append(mindat_id)
        if mindat_id in self.fail_full:
            raise mindat.Unreachable("api.mindat.org answered 504")
        r = self.records.get(mindat_id)
        return {**r, "description_short": f"About {r['name']}."} if r else None


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
    assert mindat.catch_up(conn, api, float("inf")) == 1
    ids = dict(conn.execute("SELECT job_id, mindat_id FROM candidates").fetchall())
    assert ids == {waiting: 51, named: None}
    assert mindat.catch_up(conn, api, float("inf")) == 0


def _piece(name, withs=(), on=None):
    """A candidate with its other minerals (#29), as the validator makes it."""
    c = identify.Candidate(name, None, "mineral", 0.6)
    c.parts = [identify.Part("with", w) for w in withs] + ([identify.Part("on", on)] if on else [])
    return c


def test_each_part_is_looked_up_by_name_and_written_with_its_record(tmp_path):
    conn, api = _db(tmp_path), FakeApi(RECORDS + [rec(3314, "Pyrite"), rec(3727, "Sphalerite")])
    opinions = [
        identify.Opinion(HAIKU, 200, identify.Answer([_piece("Pyrite", ["Sphalerite", "Galena"], "Quartz")], [], None)),
        identify.Opinion(FLASH, 200, identify.Answer([_piece("Quartz", ["Pyrite"]), _piece("Agate", on="matrix")], [], None)),
    ]
    out = identify.classify(opinions)
    mindat.resolve_outcome(conn, api, out)
    assert "matrix" not in [t.casefold() for t in api.asked]
    jid = _job(conn)
    queue.record_outcome(conn, jid, out, NOW)
    written = {(r["model"], r["rank"]): json.loads(r["parts"]) for r in conn.execute("SELECT model, rank, parts FROM candidates")}
    assert written[(HAIKU.model, 1)] == [
        {"role": "with", "name": "Sphalerite", "mindat_id": 3727},
        {"role": "with", "name": "Galena", "mindat_id": None},  # not in this Mindat
        {"role": "on", "name": "Quartz", "mindat_id": 3337},
    ]
    assert written[(FLASH.model, 1)] == [{"role": "with", "name": "Pyrite", "mindat_id": 3314}]
    assert written[(FLASH.model, 2)] == [{"role": "on", "name": "matrix", "mindat_id": None}]


def test_catch_up_fills_a_waiting_candidates_parts_too(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    jid = _job(conn, "identified")
    parts = [{"role": "with", "name": "Hematite", "mindat_id": None}, {"role": "on", "name": "matrix", "mindat_id": None}]
    conn.execute(
        "INSERT INTO candidates (job_id, model, rank, name, variety, kind, confidence, mindat_id, parts) VALUES (?, ?, 1, 'Quartz', NULL, 'mineral', 0.5, 3337, ?)",
        (jid, HAIKU.model, json.dumps(parts)),
    )
    conn.commit()
    assert mindat.catch_up(conn, api, float("inf")) == 1
    filled = json.loads(conn.execute("SELECT parts FROM candidates").fetchone()[0])
    assert [p["mindat_id"] for p in filled] == [1856, None]
    asked = api.requests
    assert mindat.catch_up(conn, api, float("inf")) == 0
    assert api.requests == asked


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


# --- enrichment (#21) -------------------------------------------------------------


def _mineral(conn, name, kind="mineral"):
    mid = conn.execute("INSERT INTO minerals (name, kind) VALUES (?, ?)", (name, kind)).lastrowid
    conn.commit()
    return mid


def _link(conn, api):
    return mindat.link_minerals(conn, api, float("inf"))


def _fetch(conn, api):
    return mindat.fetch_details(conn, api, float("inf"))


def _mineral_row(conn, mid):
    return tuple(conn.execute("SELECT name, kind, mindat_id FROM minerals WHERE id = ?", (mid,)).fetchone())


def _detailed(conn):
    return {r[0] for r in conn.execute("SELECT id FROM mindat_records WHERE detail IS NOT NULL")}


@pytest.mark.parametrize(
    "entrytype, kind, expected",
    [
        ("rock", "mineral", "rock"),
        ("mineral", "rock", "mineral"),
        ("variety", "mineral", "mineral"),
        ("grouplist", "mineral", "mineral"),  # Apatite
        ("series", "rock", "mineral"),
        ("polytype", "rock", "mineral"),
        ("mixture", "rock", "rock"),
        ("commodity", "mineral", "mineral"),
        (None, "rock", "rock"),
        ("rock", "other", "other"),
        ("mineral", "other", "other"),
    ],
)
def test_the_kind_follows_mindat_but_other_stays(entrytype, kind, expected):
    assert mindat.kind_for(entrytype, kind) == expected


def test_a_name_already_asked_for_a_candidate_links_with_no_request(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _resolve(conn, api, "Jasper")
    asked = api.requests
    mid = _mineral(conn, "jasper")  # typed, so filed as a mineral until now
    assert _link(conn, api) == 1
    assert api.requests == asked
    assert _mineral_row(conn, mid) == ("jasper", "rock", 2082)


def test_a_typed_name_is_looked_up_and_keeps_its_own_record_and_name(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    mid = _mineral(conn, "Chalcedony")
    assert _link(conn, api) == 1
    assert _mineral_row(conn, mid) == ("Chalcedony", "mineral", 960)
    assert _chain(conn, 960) == ["Chalcedony", "Quartz"]
    assert _link(conn, api) == 0


def test_a_mineral_mindat_does_not_know_stays_unlinked_and_is_asked_once(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    mid = _mineral(conn, "Banded Agate")
    assert _link(conn, api) == 0
    assert _link(conn, api) == 0
    assert api.requests == 1
    assert _mineral_row(conn, mid) == ("Banded Agate", "mineral", None)


def test_a_mineral_called_other_is_linked_but_stays_other(tmp_path):
    conn = _db(tmp_path)
    mid = _mineral(conn, "Agate", "other")
    _link(conn, FakeApi())
    assert _mineral_row(conn, mid) == ("Agate", "other", 51)


def test_a_mineral_and_each_record_above_it_are_fetched_whole_once(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _resolve(conn, api, "Chalcedony", "Carnelian")  # a candidate nobody chose
    _mineral(conn, "Agate")
    _link(conn, api)
    assert _fetch(conn, api) == 3
    assert sorted(api.fetched) == [51, 960, 3337]
    assert _detailed(conn) == {51, 960, 3337}  # Carnelian is never fetched whole
    detail = json.loads(conn.execute("SELECT detail FROM mindat_records WHERE id = 960").fetchone()[0])
    assert detail["description_short"] == "About Chalcedony."
    assert conn.execute("SELECT detail_at FROM mindat_records WHERE id = 960").fetchone()[0]
    asked = api.requests
    assert _fetch(conn, api) == 0
    assert api.requests == asked


def test_a_record_stored_again_keeps_its_detail(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _mineral(conn, "Baryte")
    _link(conn, api)
    _fetch(conn, api)
    assert _resolve(conn, api, "Barite") == 549  # a new term, so Baryte is stored again
    assert _detailed(conn) == {549}


def test_an_id_mindat_no_longer_has_is_stored_empty_and_not_asked_again(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _mineral(conn, "Hematite")
    _link(conn, api)
    del api.records[1856]
    assert _fetch(conn, api) == 1
    assert conn.execute("SELECT detail FROM mindat_records WHERE id = 1856").fetchone()[0] == "{}"
    assert _fetch(conn, api) == 0


def test_running_out_of_time_stops_quietly_and_the_next_pass_goes_on(tmp_path):
    conn, clock = _db(tmp_path), Clock()
    api = FakeApi(clock=clock)
    _mineral(conn, "Agate")
    _link(conn, api)
    clock.t = 0.0
    assert mindat.idle(conn, api, budget_s=1.5, clock=clock) == (0, 0, 2)  # requests at 0 and 1; at 2 the time is up
    assert _detailed(conn) == {51, 960}
    assert mindat.idle(conn, api, budget_s=1.5, clock=clock) == (0, 0, 1)
    assert _detailed(conn) == {51, 960, 3337}


def test_a_failure_partway_keeps_what_was_fetched_before_it(tmp_path):
    conn = _db(tmp_path)
    _mineral(conn, "Agate")
    _link(conn, FakeApi())
    with pytest.raises(mindat.Unreachable):
        mindat.idle(conn, FakeApi(fail_full={960}))
    assert _detailed(conn) == {51}


def test_the_idle_pass_links_fetches_and_says_so(tmp_path, caplog):
    conn = _db(tmp_path)
    _mineral(conn, "Quartz")
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, FakeApi(), NOW) == NOW + worker.CATCH_UP_EVERY
    assert "mindat linked 1 mineral(s), fetched 1 record(s)" in [r.getMessage() for r in caplog.records]
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, FakeApi(), NOW) == NOW + worker.CATCH_UP_EVERY
    assert not caplog.records  # nothing left to do, nothing said
    _mineral(conn, "Agate")
    assert worker.catch_up(conn, FakeApi(fail=True), NOW) == NOW + worker.CATCH_UP_AFTER_FAILURE


def test_without_a_key_the_idle_pass_never_runs(tmp_path, monkeypatch):
    conn = _db(tmp_path)
    calls = []
    monkeypatch.setattr(worker.time, "sleep", lambda s: None)
    monkeypatch.setattr(worker.mindat, "idle", lambda conn, api: calls.append(api) or (0, 0, 0))
    worker.run_forever(conn, tmp_path, CFG, iter([True, False]).__next__, None)
    assert calls == []
    api = FakeApi()
    worker.run_forever(conn, tmp_path, CFG, iter([True, False]).__next__, api)
    assert calls == [api]
