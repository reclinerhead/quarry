"""Mindat lookups for Jasper's candidates (#18): which Mindat record each one
names, and the records above it, cached in the database.

The two models name a stone at different levels. One says Quartz, variety
Agate; the other says Chalcedony, "Agate, banded". Mindat knows Agate is a
variety of Chalcedony, which is a variety of Quartz, so the confirm screen can
see that both said agate. Jasper looks each candidate up after the models
answer and before the job is written, and, since #29, each other mineral the
model saw on the piece (its `parts`, by name alone; a base of plain matrix is
never asked), and, since #62, the mineral an object is made of (`made_of`). The web app reads the cache and never calls Mindat.

Which term: the most specific one Mindat knows, in this order: the variety as
written, the variety before its first comma ("Agate, banded" gives "Agate"),
then the name. A synonym is followed through `synid` (Barite to Baryte), and
`varietyof` is walked to the top, a species or a rock, at most MAX_DEPTH
records. Mindat's groups are never used, so agreement never climbs above a
species.

The cache is two tables. `mindat_records` holds records by Mindat id;
`mindat_terms` holds each term asked, folded (`fold`), with the id it found, or
NULL for a miss, so a name Mindat doesn't know is asked once. A term is written
only after its chain is, so a cached term always has its chain. A failure (a
timeout, a server error, a refused key, the job's time running out) is never
cached: it raises Unreachable, the candidates keep a NULL `mindat_id`, and
`catch_up` tries again when the queue is idle.

Enrichment (#21) starts here too. When the queue is idle, `idle` links each
mineral the household has named to the record its own name resolves to
(`link_minerals`; Chalcedony links to Chalcedony and keeps its name), sets its
kind from Mindat's entry type (`kind_for`), and fetches the whole record, once,
for that record and each one above it (`fetch_details`), into
`mindat_records.detail`. A record only a candidate names is never fetched in
full. Running out of time is not a failure there: the pass stops quietly and
the rest waits for the next one.

`Api` is the only part that touches the network, over urllib as llm.py is, so
Jasper's venv grows no dependency.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .identify import MATRIX

if TYPE_CHECKING:
    from .identify import Outcome

API_HOST = "api.mindat.org"
API_URL = f"https://{API_HOST}/v1/geomaterials/"
FIELDS = "id,name,entrytype_text,varietyof,synid,hmin,hmax,streak"


@dataclass(frozen=True)
class Limits:
    """How long one request may take, and how many times it is tried."""

    timeout_s: float
    tries: int


# Two leashes, side by side so they can't drift apart (#40). The idle pass has
# the time: 8 s a request, each tried twice, 20 s a pass. A job's lookups run
# while a person may be waiting on the confirm screen, so they get 3 s a
# request, one try, and 4 s for the whole job; whatever they miss, the idle
# pass's catch-up fills in. urllib's timeout is per socket operation, so a job
# can still run a few seconds past its budget, never the 20 to 58 s it did.
IDLE = Limits(timeout_s=8, tries=2)
IDLE_BUDGET_S = 20
WAIT = Limits(timeout_s=3, tries=1)
WAIT_BUDGET_S = 4
# Records in a chain, the candidate's own included: Crazy Lace Agate, Agate,
# Chalcedony, Quartz is four.
MAX_DEPTH = 6

Clock = Callable[[], float]


class Unreachable(Exception):
    """Mindat gave no usable answer: a timeout, a server error, a refused key, or no time left."""


class OutOfTime(Unreachable):
    """The budget ran out before the next request. A job's lookup stops as for any failure; the idle pass just stops."""


class Api:
    """The OpenMindat geomaterials endpoint. `limits` is the leash in force, IDLE unless
    a job is being written (`within`); `requests` counts every try for the log line."""

    def __init__(self, key: str, limits: Limits = IDLE):
        self._key = key
        self.limits = limits
        self.requests = 0

    def __repr__(self) -> str:
        return "Api(key=…)"  # never logged

    @contextmanager
    def within(self, limits: Limits) -> Iterator[None]:
        """Run the block under another leash, then put the old one back."""
        before, self.limits = self.limits, limits
        try:
            yield
        finally:
            self.limits = before

    def search(self, term: str) -> list[dict]:
        """Mindat's entries named `term`. The search is exact, ignoring case and accents."""
        body = self._get(API_URL + "?" + urllib.parse.urlencode({"name": term, "fields": FIELDS}))
        results = body.get("results") if body else None
        return [r for r in results if isinstance(r, dict)] if isinstance(results, list) else []

    def record(self, mindat_id: int) -> dict | None:
        """One entry by id, or None when Mindat has no such id."""
        return self._get(f"{API_URL}{mindat_id}/?" + urllib.parse.urlencode({"fields": FIELDS}))

    def full(self, mindat_id: int) -> dict | None:
        """One entry by id with every field Mindat has, its type localities as ids, or None when Mindat has no such id."""
        return self._get(f"{API_URL}{mindat_id}/?" + urllib.parse.urlencode({"expand": "type_localities"}))

    def _get(self, url: str) -> dict | None:
        """The JSON body, None for a 404, or Unreachable."""
        req = urllib.request.Request(url, headers={"Authorization": f"Token {self._key}", "Accept": "application/json"})
        last = ""
        for _ in range(self.limits.tries):
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=self.limits.timeout_s) as resp:
                    out = json.load(resp)
                    return out if isinstance(out, dict) else {}
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code in (401, 403):
                    # A new key answers 401 until Mindat approves the account by hand.
                    raise Unreachable(f"{API_HOST} refused the key (MINDAT_API_KEY) ({e.code})") from None
                last = f"{API_HOST} answered {e.code}"
            except Exception as e:  # noqa: BLE001  (unreachable, timed out, unreadable body)
                last = f"{API_HOST} unreachable ({type(e).__name__}: {e})"[:200]
        raise Unreachable(last)


def api(environ: Mapping[str, str] | None = None) -> Api | None:
    """The Mindat API when MINDAT_API_KEY is set; None means candidates are matched by name only."""
    env = os.environ if environ is None else environ
    key = (env.get("MINDAT_API_KEY") or "").strip()
    return Api(key) if key else None


# ----------------------------------------------------------------------------
# Pure: what to ask, and which answer is the one
# ----------------------------------------------------------------------------


def fold(s: str) -> str:
    """Case, accents, curly apostrophes and spacing don't count: "Hématite" is "hematite"."""
    s = unicodedata.normalize("NFKD", s.replace("’", "'"))
    return " ".join("".join(ch for ch in s if not unicodedata.combining(ch)).casefold().split())


def terms(name: str, variety: str | None) -> list[str]:
    """What to ask Mindat about a candidate, most specific first: the variety,
    the variety before its first comma, then the name. Each once."""
    out: list[str] = []
    for t in (variety, variety.split(",")[0] if variety else None, name):
        t = " ".join((t or "").split())
        if t and fold(t) not in {fold(x) for x in out}:
            out.append(t)
    return out


def pick(results: list[dict], term: str) -> dict | None:
    """The result named exactly `term`, ignoring case and accents, an entry of its own before a synonym.
    Mindat answers Hematite with both Hematite and the synonym Hématite."""
    exact = [r for r in results if isinstance(r.get("name"), str) and fold(r["name"]) == fold(term)]
    exact.sort(key=lambda r: r.get("entrytype_text") == "synonym")  # stable: entries first
    return exact[0] if exact else None


def _id(v: object) -> int | None:
    """Mindat writes 0, or nothing, for no id."""
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else None


def _mohs(v: object) -> float | None:
    """Mindat writes 0 for a hardness it has not recorded, which it often does on a variety."""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


# Mindat's entry types that settle whether a named mineral is a mineral or a rock.
# A mixture, a commodity or anything new leaves the kind as it was.
KINDS = {"rock": "rock", "mineral": "mineral", "variety": "mineral", "grouplist": "mineral",
         "series": "mineral", "polytype": "mineral"}


def kind_for(entrytype: str | None, kind: str) -> str:
    """A mineral's kind once Mindat has its record: a typed Granite becomes a rock.
    `other` (a fossil, sea glass) is the household's or the model's call and stays."""
    return kind if kind == "other" else KINDS.get(entrytype or "", kind)


# ----------------------------------------------------------------------------
# The cache, filled through the API
# ----------------------------------------------------------------------------


def _in_time(deadline: float, clock: Clock) -> None:
    if clock() >= deadline:
        raise OutOfTime("out of time for this job")


def _store(conn: sqlite3.Connection, r: dict) -> None:
    """An upsert, not a replace: a record stored again by a later lookup (a synonym of it) keeps its `detail`."""
    conn.execute(
        """INSERT INTO mindat_records (id, name, entrytype, varietyof, hmin, hmax, streak)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, entrytype = excluded.entrytype, varietyof = excluded.varietyof,
             hmin = excluded.hmin, hmax = excluded.hmax, streak = excluded.streak,
             fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')""",
        (
            _id(r.get("id")),
            str(r.get("name") or ""),
            str(r.get("entrytype_text") or ""),
            _id(r.get("varietyof")),
            _mohs(r.get("hmin")),
            _mohs(r.get("hmax")),
            (r.get("streak") or None) if isinstance(r.get("streak"), str) else None,
        ),
    )


def _cached(conn: sqlite3.Connection, mindat_id: int) -> bool:
    return conn.execute("SELECT 1 FROM mindat_records WHERE id = ?", (mindat_id,)).fetchone() is not None


def _chain(conn: sqlite3.Connection, api: Api, record: dict, deadline: float, clock: Clock) -> int:
    """Store a record and the records above it, all in one transaction. Returns its id.
    A cached parent ends the walk: chains are stored whole, so its own parents are there too."""
    records = [record]
    seen = {_id(record.get("id"))}
    parent = _id(record.get("varietyof"))
    while parent and parent not in seen and len(records) < MAX_DEPTH and not _cached(conn, parent):
        _in_time(deadline, clock)
        r = api.record(parent)
        if r is None or _id(r.get("id")) is None:
            break
        records.append(r)
        seen.add(parent)
        parent = _id(r.get("varietyof"))
    with conn:
        for r in records:
            _store(conn, r)
    return _id(record.get("id"))  # type: ignore[return-value]  (checked by the caller)


def _look_up(conn: sqlite3.Connection, api: Api, term: str, deadline: float, clock: Clock) -> int | None:
    """Ask Mindat about one term, store what it found with its chain, then the term itself."""
    _in_time(deadline, clock)
    found = pick(api.search(term), term)
    if found is not None and found.get("entrytype_text") == "synonym" and _id(found.get("synid")):
        _in_time(deadline, clock)
        found = api.record(_id(found.get("synid")))  # type: ignore[arg-type]
    rid = _chain(conn, api, found, deadline, clock) if found is not None and _id(found.get("id")) else None
    with conn:
        conn.execute("INSERT OR REPLACE INTO mindat_terms (term, mindat_id) VALUES (?, ?)", (fold(term), rid))
    return rid


def resolve(conn: sqlite3.Connection, api: Api, name: str, variety: str | None, deadline: float,
            clock: Clock = time.monotonic) -> int | None:
    """The Mindat id a candidate names: the first of its terms Mindat knows, with its chain cached.
    None when Mindat knows none of them. Raises Unreachable."""
    for term in terms(name, variety):
        row = conn.execute("SELECT mindat_id FROM mindat_terms WHERE term = ?", (fold(term),)).fetchone()
        rid = _look_up(conn, api, term, deadline, clock) if row is None else row["mindat_id"]
        if rid is not None:
            return rid
    return None


def resolve_outcome(conn: sqlite3.Connection, api: Api, outcome: Outcome, budget_s: float = WAIT_BUDGET_S,
                    clock: Clock = time.monotonic, limits: Limits = WAIT) -> str:
    """Set `mindat_id` on each candidate of an identified job before it is written,
    on the short leash: a person may be waiting. Returns the log line's part:
    "mindat 3 requests", "mindat cached", or why it stopped."""
    deadline = clock() + budget_s
    before = api.requests
    try:
        with api.within(limits):
            for o in outcome.opinions:
                for c in o.answer.candidates if o.answer else []:
                    c.mindat_id = resolve(conn, api, c.name, c.variety, deadline, clock)
                    # The other minerals on the piece (#29), by name alone; plain matrix is no mineral.
                    for p in c.parts:
                        if p.name != MATRIX:
                            p.mindat_id = resolve(conn, api, p.name, None, deadline, clock)
                    # What the object is made of (#62), by name alone, as a part is.
                    if c.made_of:
                        c.made_of_mindat_id = resolve(conn, api, c.made_of, None, deadline, clock)
    except Unreachable as e:
        return f"mindat stopped: {e}"
    n = api.requests - before
    return f"mindat {n} request{'' if n == 1 else 's'}" if n else "mindat cached"


# Candidates of jobs still waiting for a name that have no Mindat id yet: a
# lookup that failed, or a job identified before Jasper knew Mindat.
WAITING = """
SELECT c.job_id, c.model, c.rank, c.name, c.variety
  FROM candidates c JOIN jobs j ON j.id = c.job_id
 WHERE c.mindat_id IS NULL AND j.status = 'identified'
   AND NOT EXISTS (SELECT 1 FROM confirmations f WHERE f.job_id = c.job_id)
 ORDER BY j.created_at, c.job_id, c.model, c.rank
"""


# Their parts (#29): every waiting candidate that has any; which part lacks an id is
# read from the JSON here rather than in SQL.
WAITING_PARTS = """
SELECT c.job_id, c.model, c.rank, c.parts
  FROM candidates c JOIN jobs j ON j.id = c.job_id
 WHERE c.parts IS NOT NULL AND c.parts <> '[]' AND j.status = 'identified'
   AND NOT EXISTS (SELECT 1 FROM confirmations f WHERE f.job_id = c.job_id)
 ORDER BY j.created_at, c.job_id, c.model, c.rank
"""


# What each waiting candidate is made of (#62), when the model said and it has no id yet.
WAITING_MADE_OF = """
SELECT c.job_id, c.model, c.rank, c.made_of
  FROM candidates c JOIN jobs j ON j.id = c.job_id
 WHERE c.made_of IS NOT NULL AND c.made_of_mindat_id IS NULL AND j.status = 'identified'
   AND NOT EXISTS (SELECT 1 FROM confirmations f WHERE f.job_id = c.job_id)
 ORDER BY j.created_at, c.job_id, c.model, c.rank
"""


def catch_up(conn: sqlite3.Connection, api: Api, deadline: float, clock: Clock = time.monotonic) -> int:
    """Look up the waiting candidates with no Mindat id, then their parts with none, then
    what they are made of. A term already cached costs no request, so a name Mindat
    doesn't know is not asked again. Returns how many candidates, parts and made-ofs it
    filled; stops there when the time runs out. Raises Unreachable."""
    filled = 0
    try:
        for row in conn.execute(WAITING).fetchall():
            rid = resolve(conn, api, row["name"], row["variety"], deadline, clock)
            if rid is not None:
                with conn:
                    conn.execute(
                        "UPDATE candidates SET mindat_id = ? WHERE job_id = ? AND model = ? AND rank = ?",
                        (rid, row["job_id"], row["model"], row["rank"]),
                    )
                filled += 1
        for row in conn.execute(WAITING_PARTS).fetchall():
            parts = _parts_of(row["parts"])
            n = 0
            for p in parts:
                if p.get("mindat_id") is None and p.get("name") and p["name"] != MATRIX:
                    rid = resolve(conn, api, str(p["name"]), None, deadline, clock)
                    if rid is not None:
                        p["mindat_id"] = rid
                        n += 1
            if n:
                with conn:
                    conn.execute(
                        "UPDATE candidates SET parts = ? WHERE job_id = ? AND model = ? AND rank = ?",
                        (json.dumps(parts), row["job_id"], row["model"], row["rank"]),
                    )
                filled += n
        for row in conn.execute(WAITING_MADE_OF).fetchall():
            rid = resolve(conn, api, row["made_of"], None, deadline, clock)
            if rid is not None:
                with conn:
                    conn.execute(
                        "UPDATE candidates SET made_of_mindat_id = ? WHERE job_id = ? AND model = ? AND rank = ?",
                        (rid, row["job_id"], row["model"], row["rank"]),
                    )
                filled += 1
    except OutOfTime:
        pass  # the rest wait for the next idle pass
    return filled


def _parts_of(text: str | None) -> list[dict]:
    """A candidate's `parts` column as a list of objects; anything else is no parts."""
    try:
        parts = json.loads(text or "[]")
    except json.JSONDecodeError:
        return []
    return [p for p in parts if isinstance(p, dict)] if isinstance(parts, list) else []


# ----------------------------------------------------------------------------
# Enrichment (#21): each named mineral's record, whole
# ----------------------------------------------------------------------------


def link_minerals(conn: sqlite3.Connection, api: Api, deadline: float, clock: Clock = time.monotonic) -> int:
    """Link each mineral with no Mindat id to the record its own name resolves to, and
    set its kind from that record. The name is never changed: Chalcedony links to
    Chalcedony, a variety of Quartz. A name Mindat doesn't know stays unlinked, and
    its miss is cached, so it costs no request again. Returns how many it linked;
    stops there when the time runs out. Raises Unreachable."""
    linked = 0
    try:
        for row in conn.execute("SELECT id, name, kind FROM minerals WHERE mindat_id IS NULL ORDER BY id").fetchall():
            rid = resolve(conn, api, row["name"], None, deadline, clock)
            if rid is None:
                continue
            entrytype = conn.execute("SELECT entrytype FROM mindat_records WHERE id = ?", (rid,)).fetchone()[0]
            with conn:
                # The web app may have removed the mineral meanwhile; then nothing is updated.
                linked += conn.execute(
                    "UPDATE minerals SET mindat_id = ?, kind = ? WHERE id = ? AND mindat_id IS NULL",
                    (rid, kind_for(entrytype, row["kind"]), row["id"]),
                ).rowcount
    except OutOfTime:
        pass
    return linked


# Records some mineral needs in full: the one it links to and each one above it,
# whose `detail` has not been fetched. A record only a candidate names is not here.
NEEDS_DETAIL = """
WITH RECURSIVE up(id, depth) AS (
  SELECT mindat_id, 1 FROM minerals WHERE mindat_id IS NOT NULL
  UNION
  SELECT r.varietyof, up.depth + 1 FROM up JOIN mindat_records r ON r.id = up.id
   WHERE r.varietyof IS NOT NULL AND up.depth < :max_depth
)
SELECT DISTINCT r.id FROM mindat_records r JOIN up ON up.id = r.id
 WHERE r.detail IS NULL
 ORDER BY r.id
"""


def fetch_details(conn: sqlite3.Connection, api: Api, deadline: float, clock: Clock = time.monotonic) -> int:
    """Fetch the whole record, once, for each record a mineral needs (`NEEDS_DETAIL`).
    One transaction per record. An id Mindat no longer has is stored as `{}`, so it is
    not asked every minute. Returns how many it stored; stops there when the time runs
    out. Raises Unreachable."""
    fetched = 0
    try:
        for row in conn.execute(NEEDS_DETAIL, {"max_depth": MAX_DEPTH}).fetchall():
            _in_time(deadline, clock)
            body = api.full(row["id"]) or {}
            with conn:
                conn.execute(
                    "UPDATE mindat_records SET detail = ?, detail_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                    (json.dumps(body, ensure_ascii=False, separators=(",", ":")), row["id"]),
                )
            fetched += 1
    except OutOfTime:
        pass
    return fetched


def idle(conn: sqlite3.Connection, api: Api, budget_s: float = IDLE_BUDGET_S,
         clock: Clock = time.monotonic, should_stop: Callable[[], bool] | None = None) -> tuple[int, int, int]:
    """Jasper's Mindat work while the queue is empty, in one budget: the waiting
    candidates, then the minerals, then their records. Returns (candidates filled,
    minerals linked, records fetched). Raises Unreachable; what was done before stays.
    `should_stop` (a job has arrived, #40) ends the pass at its next request the way
    running out of time does: the steps keep what they did, and the rest waits a minute."""
    deadline = clock() + budget_s
    if should_stop is not None:
        wall = clock

        def clock() -> float:  # a job waiting is "out of time" for the pass
            return float("inf") if should_stop() else wall()

    filled = catch_up(conn, api, deadline, clock)
    linked = link_minerals(conn, api, deadline, clock)
    return filled, linked, fetch_details(conn, api, deadline, clock)
