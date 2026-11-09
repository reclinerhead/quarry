"""Mindat lookups (#18): which term is asked, which answer is taken, the chain and
the cache, what a failure leaves, and the worker's part. Enrichment (#21): each
named mineral linked to its record, and the records it needs fetched whole, once.
Where it's found (#65): the states and counties kept, the counts shaped, and
which records are counted when. A fake API stands in for Mindat; the HTTP itself
stays untested."""

import json

import logging
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

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
    rec(198, "Amethyst", "variety", varietyof=3337),
]

# Mindat's localities, shaped on what it sent on 2026-11-03. The USA's and
# Michigan's ids are Mindat's; the others are made up.
USA, MICHIGAN, TRI_STATE, YELLOWSTONE = 3366, 208081, 9001, 9002
STATE_IDS = {name: 4000 + i for i, name in enumerate(sorted(mindat.STATES - {"Michigan"}))} | {"Michigan": MICHIGAN}
NEBRASKA, UTAH = STATE_IDS["Nebraska"], STATE_IDS["Utah"]
US_ROWS = [
    {"id": USA, "txt": "USA", "level": 0},
    *({"id": i, "txt": f"{name}, USA", "level": 1} for name, i in STATE_IDS.items()),
    {"id": TRI_STATE, "txt": "Tri-State Mining District, USA", "level": 1},
    {"id": YELLOWSTONE, "txt": "Yellowstone National Park, USA", "level": 1},
]
KEWEENAW, HOUGHTON, MARQUETTE, ONTONAGON, PENINSULA = 9101, 9102, 9103, 9104, 9105
HOME_ROWS = [
    {"id": KEWEENAW, "txt": "Keweenaw County, Michigan, USA", "level": 2},
    {"id": HOUGHTON, "txt": "Houghton County, Michigan, USA", "level": 2},
    {"id": MARQUETTE, "txt": "Marquette County, Michigan, USA", "level": 2},
    {"id": ONTONAGON, "txt": "Ontonagon County, Michigan, USA", "level": 2},
    # The regions that overlap the counties.
    {"id": PENINSULA, "txt": "Keweenaw Peninsula, Michigan, USA", "level": 2},
    {"id": 9106, "txt": "Keweenaw Copper Mining District, Michigan, USA", "level": 2},
    {"id": 9107, "txt": "Marquette Iron Range, Michigan, USA", "level": 2},
    {"id": 9108, "txt": "Menominee Iron Range, Michigan, USA", "level": 2},
]
# How many places under each locality report each record; Jasper, a rock, has none in the USA.
COUNTS = {
    51: {USA: 879, NEBRASKA: 140, MICHIGAN: 51, UTAH: 51, TRI_STATE: 4, KEWEENAW: 31, HOUGHTON: 8, ONTONAGON: 0, PENINSULA: 39},
    960: {USA: 2210, MICHIGAN: 60, KEWEENAW: 22},
    3337: {USA: 32540, MICHIGAN: 501, NEBRASKA: 30, MARQUETTE: 168, KEWEENAW: 82},
    198: {USA: 820, MICHIGAN: 19, KEWEENAW: 8},
}


class Clock:
    """Time that moves only when the fake API is asked something: a second a request."""

    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class FakeApi:
    """Mindat as the tests need it: an exact search ignoring case and accents, records by
    id, whole records, which carry more than the lean ones, the two locality lists, and
    the counts. `fail_counts` fails a record's third request, its counties."""

    def __init__(self, records=RECORDS, fail=False, fail_full=(), fail_counts=(), clock=None):
        self.records = {r["id"]: r for r in records}
        self.fail = fail
        self.fail_full = set(fail_full)
        self.fail_counts = set(fail_counts)
        self.clock = clock
        self.limits = mindat.IDLE
        self.geography = None
        self.requests = 0
        self.asked = []
        self.fetched = []
        self.counted = []
        self.leashes = []  # the limits in force at each request

    @contextmanager
    def within(self, limits):
        before, self.limits = self.limits, limits
        try:
            yield
        finally:
            self.limits = before

    def _request(self):
        self.requests += 1
        self.leashes.append(self.limits)
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

    def localities(self, query):
        self._request()
        return US_ROWS if query == mindat.US_LOCALITIES else HOME_ROWS if query == mindat.HOME_LOCALITIES else []

    def counts(self, mindat_id, localities):
        self._request()
        self.counted.append(mindat_id)
        asked = set(localities)
        if mindat_id in self.fail_counts and KEWEENAW in asked:
            raise mindat.Unreachable("api.mindat.org answered 504")
        return [{"lstm_loc": loc, "lstm_numlocs": n} for loc, n in COUNTS.get(mindat_id, {}).items() if loc in asked]


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


def test_a_jobs_lookups_run_on_the_short_leash_and_stop_at_its_budget(tmp_path):
    """A person may be waiting (#40): 3 s a request, one try, 4 s a job; the rest is the idle pass's."""
    conn, clock = _db(tmp_path), Clock()
    api = FakeApi(clock=clock)
    out = _outcome([("Chalcedony", "Agate"), ("Jasper", None)], [("Baryte", None)])
    # Agate, Chalcedony, Quartz at 0, 1, 2 s; Jasper at 3 s; at 4 s the time is up before Baryte.
    assert mindat.resolve_outcome(conn, api, out, clock=clock) == "mindat stopped: out of time for this job"
    assert api.requests == 4 and api.leashes == [mindat.WAIT] * 4 and api.limits == mindat.IDLE
    ids = [c.mindat_id for o in out.opinions for c in o.answer.candidates]
    assert ids == [51, 2082, None]
    assert mindat.WAIT_BUDGET_S == 4 and mindat.WAIT == mindat.Limits(timeout_s=3, tries=1)
    assert mindat.IDLE_BUDGET_S == 20 and mindat.IDLE == mindat.Limits(timeout_s=8, tries=2)
    # The idle pass finishes the job on its own leash.
    conn.execute("INSERT INTO jobs (id, status) VALUES (7, 'identified')")
    queue.record_outcome(conn, 7, out, NOW)
    clock.t = 0.0
    assert mindat.catch_up(conn, api, clock() + mindat.IDLE_BUDGET_S, clock) == 1
    assert api.leashes[4:] == [mindat.IDLE]
    assert conn.execute("SELECT mindat_id FROM candidates WHERE name = 'Baryte'").fetchone()[0] == 549


def test_a_jobs_request_is_tried_once_and_the_idle_pass_s_twice(monkeypatch):
    """The real client against a Mindat that never answers: the tries and the timeout follow the leash."""
    calls = []

    def never(req, timeout):
        calls.append(timeout)
        raise TimeoutError("timed out")

    monkeypatch.setattr(mindat.urllib.request, "urlopen", never)
    api = mindat.Api("k")
    with pytest.raises(mindat.Unreachable, match="unreachable"):
        api.search("Agate")
    assert calls == [8, 8]
    calls.clear()
    with api.within(mindat.WAIT), pytest.raises(mindat.Unreachable, match="unreachable"):
        api.search("Agate")
    assert calls == [3] and api.limits == mindat.IDLE and api.requests == 3


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


def test_what_a_candidate_is_made_of_is_looked_up_by_name_and_written(tmp_path):
    """#62: a fossil coral made of Calcite gets Calcite's record beside it; the coral itself is a miss."""
    conn, api = _db(tmp_path), FakeApi(RECORDS + [rec(859, "Calcite", hmin=3, hmax=3)])
    coral = identify.Candidate("Fossil coral", None, "other", 0.7, made_of="Calcite")
    glass = identify.Candidate("Sea glass", None, "other", 0.2)
    out = identify.classify([identify.Opinion(HAIKU, 200, identify.Answer([coral, glass], [], None))])
    assert mindat.resolve_outcome(conn, api, out) == "mindat 3 requests"  # fossil coral, calcite, sea glass
    assert (coral.mindat_id, coral.made_of_mindat_id, glass.made_of_mindat_id) == (None, 859, None)
    jid = _job(conn)
    queue.record_outcome(conn, jid, out, NOW)
    rows = [tuple(r) for r in conn.execute("SELECT name, mindat_id, made_of, made_of_mindat_id FROM candidates ORDER BY rank")]
    assert rows == [("Fossil coral", None, "Calcite", 859), ("Sea glass", None, None, None)]


def test_catch_up_fills_what_a_waiting_candidate_is_made_of(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    jid = _job(conn, "identified")
    conn.execute(
        "INSERT INTO candidates (job_id, model, rank, name, variety, kind, confidence, made_of) VALUES (?, ?, 1, 'Fossil coral', NULL, 'other', 0.7, 'Hematite')",
        (jid, HAIKU.model),
    )
    conn.commit()
    assert mindat.catch_up(conn, api, float("inf")) == 1
    assert conn.execute("SELECT made_of_mindat_id FROM candidates").fetchone()[0] == 1856
    asked = api.requests
    assert mindat.catch_up(conn, api, float("inf")) == 0  # the coral's own miss is cached, the id is filled
    assert api.requests == asked


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
    assert re.search(r" · mindat 4 requests \(\d+\.\d s\) · \d+\.\d s$", line), line


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
    assert mindat.idle(conn, api, budget_s=1.5, clock=clock) == (0, 0, 2, 0)  # requests at 0 and 1; at 2 the time is up
    assert _detailed(conn) == {51, 960}
    assert mindat.idle(conn, api, budget_s=1.5, clock=clock) == (0, 0, 1, 0)  # and the time is up during the localities
    assert _detailed(conn) == {51, 960, 3337}


def test_the_idle_pass_stops_for_a_job_and_keeps_what_it_did(tmp_path):
    conn, clock = _db(tmp_path), Clock()
    api = FakeApi(clock=clock)
    _mineral(conn, "Agate")
    # Linking Agate takes three requests (Agate, Chalcedony, Quartz); a job arrives after two.
    assert mindat.idle(conn, api, clock=clock, should_stop=lambda: api.requests >= 2) == (0, 0, 0, 0)
    assert api.requests == 2 and _mineral_row(conn, 1)[2] is None
    assert mindat.idle(conn, api, clock=clock) == (0, 1, 3, 3)  # the chain, its three records, then where each is found
    assert _mineral_row(conn, 1)[2] == 51


def test_the_worker_ends_the_pass_for_a_queued_job_and_tries_again_in_a_minute(tmp_path, caplog):
    conn = _db(tmp_path)
    _mineral(conn, "Agate")
    _job(conn)  # queued: the pass must not hold it
    api = FakeApi()
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, api, NOW) == NOW + worker.CATCH_UP_EVERY
    assert api.requests == 0 and not caplog.records
    conn.execute("UPDATE jobs SET status = 'identified'")
    conn.commit()
    assert worker.catch_up(conn, api, NOW) == NOW + worker.CATCH_UP_EVERY
    assert _mineral_row(conn, 1)[2] == 51


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
    assert [r.getMessage() for r in caplog.records] == ["mindat linked 1 mineral(s), fetched 1 record(s)", "mindat counted where 1 record(s) are found"]
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="jasper"):
        assert worker.catch_up(conn, FakeApi(), NOW) == NOW + worker.CATCH_UP_EVERY
    assert not caplog.records  # nothing left to do, nothing said
    _mineral(conn, "Agate")
    with caplog.at_level(logging.WARNING, logger="jasper"):
        assert worker.catch_up(conn, FakeApi(fail=True), NOW) == NOW + worker.CATCH_UP_AFTER_FAILURE
    assert caplog.records[-1].getMessage() == "catch-up stopped: api.mindat.org answered 504; next try in 1 minute"


def test_without_a_key_the_idle_pass_runs_for_wikipedia_alone(tmp_path, monkeypatch):
    conn = _db(tmp_path)
    calls = []
    monkeypatch.setattr(worker.time, "sleep", lambda s: None)
    monkeypatch.setattr(worker.mindat, "idle", lambda conn, api, budget_s, should_stop: calls.append(("mindat", api)) or (0, 0, 0, 0))
    monkeypatch.setattr(worker.wikipedia, "fetch_pages", lambda conn, api, deadline, clock: calls.append(("wikipedia", api)) or (0, 0))
    worker.run_forever(conn, tmp_path, CFG, iter([True, False]).__next__, None)
    assert calls == []  # nothing to ask without either
    wiki = object()
    worker.run_forever(conn, tmp_path, CFG, iter([True, False]).__next__, None, wiki)
    assert calls == [("wikipedia", wiki)]  # the Mindat steps are skipped (#92); Wikipedia needs no key
    api = FakeApi()
    worker.run_forever(conn, tmp_path, CFG, iter([True, False]).__next__, api, wiki)
    assert calls == [("wikipedia", wiki), ("wikipedia", wiki), ("mindat", api)]  # Wikipedia first (#119)


# --- where it's found (#65) ---------------------------------------------------------


def _places(conn, rid):
    row = conn.execute("SELECT places FROM mindat_records WHERE id = ?", (rid,)).fetchone()
    return json.loads(row[0]) if row and row[0] is not None else None


def _count_places(conn, api):
    return mindat.fetch_places(conn, api, float("inf"))


def test_the_50_states_and_the_home_counties_are_kept_and_the_rest_dropped():
    geo = mindat.geography(US_ROWS, HOME_ROWS)
    assert geo.usa == USA
    assert len(mindat.STATES) == 50 and sorted(geo.states.values()) == sorted(mindat.STATES)
    assert geo.states[MICHIGAN] == "Michigan"
    assert TRI_STATE not in geo.states and YELLOWSTONE not in geo.states  # a mining district, a national park
    assert sorted(geo.counties.values()) == ["Houghton County", "Keweenaw County", "Marquette County", "Ontonagon County"]


def test_localities_with_no_usa_states_or_counties_are_a_failure():
    with pytest.raises(mindat.Unreachable):
        mindat.geography(US_ROWS[1:], HOME_ROWS)
    with pytest.raises(mindat.Unreachable):
        mindat.geography(US_ROWS[:1], HOME_ROWS)
    with pytest.raises(mindat.Unreachable):
        mindat.geography(US_ROWS, HOME_ROWS[4:])  # the regions alone


def test_three_counts_are_shaped_most_first_with_the_zeros_dropped():
    geo, api = mindat.geography(US_ROWS, HOME_ROWS), FakeApi()
    places = mindat.places_of(geo, api.counts(51, [geo.usa]), api.counts(51, geo.states), api.counts(51, geo.counties))
    assert places == {
        "usa": 879,
        # Michigan and Utah tie, so by name; the district is never asked.
        "states": [{"id": NEBRASKA, "name": "Nebraska", "n": 140}, {"id": MICHIGAN, "name": "Michigan", "n": 51}, {"id": UTAH, "name": "Utah", "n": 51}],
        # Ontonagon's 0 is dropped; the peninsula is never asked.
        "michigan": [{"id": KEWEENAW, "name": "Keweenaw County", "n": 31}, {"id": HOUGHTON, "name": "Houghton County", "n": 8}],
    }
    assert mindat.places_of(geo, [], [], []) == {"usa": 0}


def test_each_record_a_mineral_needs_is_counted_once_three_requests_each(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _mineral(conn, "Agate")
    _mineral(conn, "Jasper")
    _link(conn, api)
    asked = api.requests
    assert _count_places(conn, api) == 4  # Agate, Chalcedony and Quartz above it, and Jasper
    # The localities once, then three a record, and one for Jasper, which has no US row.
    assert api.requests - asked == 2 + 3 + 3 + 1 + 3
    assert api.counted == [51, 51, 51, 960, 960, 960, 2082, 3337, 3337, 3337]
    assert _places(conn, 51)["usa"] == 879 and _places(conn, 3337)["michigan"][0] == {"id": MARQUETTE, "name": "Marquette County", "n": 168}
    assert _places(conn, 2082) == {"usa": 0}
    assert conn.execute("SELECT places_at FROM mindat_records WHERE id = 2082").fetchone()[0]
    asked = api.requests
    assert _count_places(conn, api) == 0
    assert api.requests == asked


def test_counts_older_than_30_days_are_counted_again(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    _mineral(conn, "Quartz")
    _link(conn, api)
    _count_places(conn, api)
    conn.execute("UPDATE mindat_records SET places_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 days')")
    conn.commit()
    assert _count_places(conn, api) == 0
    conn.execute("UPDATE mindat_records SET places_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days')")
    conn.commit()
    asked = api.requests
    assert _count_places(conn, api) == 1
    assert api.requests - asked == 3  # the localities are asked once a run


def test_a_stones_variety_is_looked_up_and_its_record_counted(tmp_path):
    conn, api = _db(tmp_path), FakeApi()
    quartz = _mineral(conn, "Quartz")
    conn.execute("INSERT INTO specimens (mineral_id, variety) VALUES (?, 'Amethyst')", (quartz,))
    conn.execute("INSERT INTO specimens (mineral_id, variety) VALUES (?, 'Purple')", (quartz,))
    conn.commit()
    _link(conn, api)
    assert _count_places(conn, api) == 2  # Amethyst, and Quartz above it
    assert api.asked == ["Quartz", "Amethyst", "Purple"]  # each variety as its own name, never the mineral's
    assert _places(conn, 198)["usa"] == 820
    asked = api.requests
    assert _count_places(conn, api) == 0
    assert api.requests == asked  # the varieties' terms are cached, a miss too


def test_a_failure_stores_nothing_for_its_record_and_keeps_the_ones_before(tmp_path):
    conn = _db(tmp_path)
    _mineral(conn, "Agate")
    _link(conn, FakeApi())
    with pytest.raises(mindat.Unreachable):
        _count_places(conn, FakeApi(fail_counts={960}))  # Chalcedony's counties fail, after its USA and states
    assert _places(conn, 51)["usa"] == 879
    assert _places(conn, 960) is None and _places(conn, 3337) is None


def test_counting_stops_quietly_for_the_budget_or_a_job_and_the_next_pass_goes_on(tmp_path):
    conn, clock = _db(tmp_path), Clock()
    api = FakeApi(clock=clock)
    _mineral(conn, "Quartz")
    _link(conn, api)
    _fetch(conn, api)
    clock.t = 0.0
    # The localities at 0 and 1, the USA at 2, the states at 3; at 4 the time is up before the counties.
    assert mindat.idle(conn, api, budget_s=3.5, clock=clock) == (0, 0, 0, 0)
    assert _places(conn, 3337) is None
    asked = api.requests
    assert mindat.idle(conn, api, clock=clock, should_stop=lambda: api.requests >= asked + 2) == (0, 0, 0, 0)  # a job arrives
    assert _places(conn, 3337) is None
    assert mindat.idle(conn, api, clock=clock) == (0, 0, 0, 1)
    assert api.requests - asked == 2 + 3  # the localities were kept for the run
    assert _places(conn, 3337)["usa"] == 32540
