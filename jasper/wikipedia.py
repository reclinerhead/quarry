"""Wikipedia's lead paragraphs for each name the household uses (#92): the
stone page's "About [mineral]" card. Fetched once per name when the queue is
idle, as Mindat's records are, and kept in `wikipedia_pages`; the web app reads
the table and never calls Wikipedia.

Which term a stone shows is the web app's call (`lib/about.ts`), in the order
`mindat.terms` uses: the variety as written, the variety before its first
comma, then the mineral's name. So this pass asks for every mineral's name and
every stone's variety, each once, folded as `mindat_terms` folds.

Which title is asked, for one term: the name as written, then sentence-cased,
since Wikipedia's titles are case-sensitive after the first letter ("Potassium
Feldspar" misses, "Potassium feldspar" is a page). A disambiguation page
("Dolomite" is a mineral, a rock and a mountain range) is asked again as
"<name> (mineral)", then "(rock)". A page marked `missing` is no article, not
an error: the term is stored with no page and never asked again. So is a
redirect that lands on a section of some other article ("Fossil coral" goes to
Coral#Evolution, the animal; "Crazy lace agate" goes to a section of Agate,
and the stone reads Agate through its next term instead), and a set-index page
whose lead says "may refer to", which Wikipedia doesn't mark as a
disambiguation. A redirect to a whole article is kept ("Granite gneiss" is
Gneiss), and the card heads with the article's title.

The Action API, not the REST `page/summary` endpoint: Fern (the Conservatory)
records that the REST one is in gradual deprecation, and it answered a dozen
quick requests with a 429 on 2026-11-03. The Action API resolves redirects and
says so, takes `maxlag` as a non-interactive client should, and is the
long-stable path. One query a title, over urllib as Mindat's are.
"""

from __future__ import annotations

import html
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal

from .mindat import IDLE, Clock, Limits, OutOfTime, Unreachable, _in_time, fold

API_HOST = "en.wikipedia.org"
API_URL = f"https://{API_HOST}/w/api.php"
# Wikimedia asks non-interactive clients to say who they are and where to write.
USER_AGENT = "TheQuarry/0.1 (https://github.com/reclinerhead/quarry)"
# A replica lag past this many seconds makes Wikipedia answer "try later"; the pass does.
MAXLAG_S = 5
# Where a disambiguation page sends a mineral or a rock: "Dolomite (mineral)", "Dolomite (rock)".
DISAMBIGUATED = ("mineral", "rock")

Miss = Literal["missing", "disambiguation"]


@dataclass(frozen=True)
class Page:
    title: str
    url: str
    summary: str  # the lead paragraphs, plain text, a blank line between


def params(title: str) -> dict[str, str | int]:
    """The one query: the lead as plain text, the article's URL, and whether it is a disambiguation page."""
    return {
        "action": "query",
        "format": "json",
        "formatversion": 2,
        "redirects": 1,
        "maxlag": MAXLAG_S,
        "prop": "extracts|info|pageprops",
        "exintro": 1,
        "explaintext": 1,
        "inprop": "url",
        "ppprop": "disambiguation",
        "titles": title,
    }


class Api:
    """The Action API. `limits` is the idle pass's leash; `requests` counts every try for the log line."""

    def __init__(self, limits: Limits = IDLE):
        self.limits = limits
        self.requests = 0

    def query(self, title: str) -> dict:
        """The query's body for one title. Raises Unreachable."""
        url = API_URL + "?" + urllib.parse.urlencode(params(title))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        last = ""
        for _ in range(self.limits.tries):
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=self.limits.timeout_s) as resp:
                    out = json.load(resp)
            except urllib.error.HTTPError as e:
                last = f"{API_HOST} answered {e.code}"  # a 503 is maxlag's answer, a 429 too many asks
                continue
            except Exception as e:  # noqa: BLE001  (unreachable, timed out, unreadable body)
                last = f"{API_HOST} unreachable ({type(e).__name__}: {e})"[:200]
                continue
            if not isinstance(out, dict):
                last = f"{API_HOST} sent no object"
                continue
            if isinstance(out.get("error"), dict):  # maxlag comes back as a 200 with an error
                last = f"{API_HOST} answered {out['error'].get('code') or 'an error'}"
                continue
            return out
        raise Unreachable(last)


# ----------------------------------------------------------------------------
# Pure: which titles, and what an answer means
# ----------------------------------------------------------------------------


def titles(term: str) -> list[str]:
    """What to ask for one term: as written, then sentence-cased. Each once."""
    t = " ".join(term.split())
    if not t:
        return []
    cased = t[0].upper() + t[1:].lower()
    return [t] if cased == t else [t, cased]


# The pronunciation, which the plain text keeps in two shapes: the respelling left
# behind when the IPA inside its parentheses is dropped, "Gneiss ( NYSE) is",
# "pyrite ( PY-ryte), or", a parenthetical that opens with a space or holds
# nothing; and the IPA itself, "Calcite (English: /ˈkælˌsaɪt/) is", a
# parenthetical holding a /…/ run with a stress mark or a vowel of the IPA's own.
# Neither is prose; "Fluorite (also called fluorspar)" stays.
_STRAY = re.compile(r"\s*\((?:\s*[;,]?\s+[^()]*|\s*|[^()]*/[^/()]*[ˈˌːəɪʊɛɔæŋʃʒθðɑ][^/()]*/[^()]*)\)")
_BLANK_RUNS = re.compile(r"\n\s*\n")
_REFERS = re.compile(r"\bmay (?:also )?refer to\b", re.IGNORECASE)


def tidy(text: str | None) -> str:
    """The extract as the card shows it: entities unescaped, the stray parentheticals
    dropped, paragraphs trimmed with one blank line between; "" for no lead."""
    if not text:
        return ""
    text = _STRAY.sub("", html.unescape(text))
    return "\n\n".join(p for p in (" ".join(p.split()) for p in _BLANK_RUNS.split(text)) if p)


def _page(body: dict) -> dict | None:
    pages = (body.get("query") or {}).get("pages") if isinstance(body.get("query"), dict) else None
    return pages[0] if isinstance(pages, list) and pages and isinstance(pages[0], dict) else None


def parse_page(body: dict) -> Page | Miss:
    """What the query found: the article, or why there is none. A page marked `missing`
    is "missing"; a page Wikipedia marks as a disambiguation, or whose lead says "may
    refer to" (a set index, which it doesn't mark), is "disambiguation"; a redirect
    that lands on a section of another article is "missing", and so is an article
    with no lead or no URL."""
    page = _page(body)
    if page is None or page.get("missing"):
        return "missing"
    summary = tidy(page.get("extract") if isinstance(page.get("extract"), str) else None)
    if "disambiguation" in (page.get("pageprops") or {}) or _REFERS.search(summary.split("\n\n")[0]):
        return "disambiguation"
    redirects = body["query"].get("redirects")
    if isinstance(redirects, list) and any(isinstance(r, dict) and r.get("tofragment") for r in redirects):
        return "missing"
    title = str(page.get("title") or "").strip()
    url = str(page.get("canonicalurl") or page.get("fullurl") or "").strip()
    if not title or not url or not summary:
        return "missing"
    return Page(title=title, url=url, summary=summary)


# ----------------------------------------------------------------------------
# The pass
# ----------------------------------------------------------------------------

# Every term a stone could show, in the order the pass asks: each mineral's name,
# oldest first, then each variety by the stone that first used it.
WANTED = (
    "SELECT name FROM minerals ORDER BY id",
    "SELECT variety FROM specimens WHERE trim(coalesce(variety, '')) <> '' GROUP BY variety ORDER BY MIN(id)",
)


def wanted(conn: sqlite3.Connection) -> list[str]:
    """The terms not yet asked: each mineral's name, each stone's variety as written and
    before its first comma, each once (folded), minus those `wikipedia_pages` has."""
    asked = {r[0] for r in conn.execute("SELECT term FROM wikipedia_pages")}
    out: list[str] = []
    for row in [r for sql in WANTED for r in conn.execute(sql).fetchall()]:
        v = row[0]
        for t in (v, v.split(",")[0]):
            t = " ".join(t.split())
            if t and fold(t) not in asked:
                asked.add(fold(t))
                out.append(t)
    return out


def look_up(api: Api, term: str, deadline: float, clock: Clock) -> Page | None:
    """Ask for one term's titles in order, then "(mineral)" and "(rock)" after a
    disambiguation. The first article wins; None when none is one. Raises Unreachable."""
    for title in titles(term):
        _in_time(deadline, clock)
        found = parse_page(api.query(title))
        if isinstance(found, Page):
            return found
        if found == "disambiguation":
            for kind in DISAMBIGUATED:
                _in_time(deadline, clock)
                found = parse_page(api.query(f"{title} ({kind})"))
                if isinstance(found, Page):
                    return found
            return None  # the name is known; its other spelling would land on the same page
    return None


def fetch_pages(conn: sqlite3.Connection, api: Api, deadline: float, clock: Clock = time.monotonic) -> tuple[int, int]:
    """Fetch the lead for each term in `wanted`, one transaction per term, a term with no
    article stored with none so it is asked once. Returns (terms asked, of which no
    article); stops quietly where the time runs out. Raises Unreachable."""
    asked = misses = 0
    try:
        for term in wanted(conn):
            page = look_up(api, term, deadline, clock)
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO wikipedia_pages (term, title, url, summary) VALUES (?, ?, ?, ?)",
                    (fold(term), page.title if page else None, page.url if page else None, page.summary if page else None),
                )
            asked += 1
            misses += page is None
    except OutOfTime:
        pass
    return asked, misses
