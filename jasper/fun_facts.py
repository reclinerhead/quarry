"""Fun facts (#126): three to five short, true facts about each mineral the
household owns, drawn from its Wikipedia article by the identifier's model,
each carrying the article sentence it rests on. The dashboard shows one now
and then ("Did you know?") and the stone's page lists the mineral's.

Copied from the Aviary's listener/fun_facts.py (aviary #422) and adapted. The
Aviary ships a hand-reviewed pool; here Jasper writes them per household on
the idle pass (the writer decision on #126: B), so a mineral has facts within
minutes of being named on any box, and the validator is the only check.

A WRONG FACT IS WORSE THAN NONE, because the family repeats it. The Aviary's
near-miss, "Chimney Swifts can only perch on horizontal surfaces", is the
reverse of the truth. So the model sees only the article and must quote,
word for word, the sentence each fact rests on, and `check_fact` drops any
fact whose quote isn't in the article, any figure the quote doesn't hold and
any absolute ("only", "never", "largest") the quote doesn't say. A dropped
fact is logged with its reasons and never stored; nothing rewrites a fact.

One row of `fun_facts` per (article title, source). The title is the key
the About card already resolves each stone to, so an Amethyst gets Amethyst's
and a Schorl gets Tourmaline's. The source here is "wikipedia" and its kind
"fact"; the old lore of epic #127 arrives as other sources, kind "lore", in
the same table. An article that yields nothing is stored as `[]`, so it is
asked once; Wikipedia or the gateway failing stores nothing, and the title is
tried again. Deleting a row asks again on the next idle pass.

Everything that decides something is pure and tested (test_jasper_fun_facts.py);
the two calls, Wikipedia's and the gateway's, are parameters.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from . import identify, llm, wikipedia
from .mindat import Clock, OutOfTime, Unreachable, _in_time

log = logging.getLogger("jasper")

PROMPT_PATH = Path(__file__).with_name("prompts") / "fun_facts.md"
SOURCE = "wikipedia"
KIND = "fact"
# The strip's headline on a phone: a fact past this wraps to a paragraph.
MAX_FACT_CHARS = 140
MAX_FACTS = 5
# The article the model sees. Measured 2026-11-21, back matter dropped: Agate
# 18,600 characters, Calcite 18,000, Tourmaline 15,700, Quartz 15,000, so every
# article the household has fits whole and Calcite's "Use and applications"
# and Quartz's "Uses" survive. The cap is for the rare long one.
MAX_ARTICLE_CHARS = 30_000
# Two facts sharing this much of their vocabulary are one fact twice.
NEAR_DUPLICATE = 0.6

# Trailing apparatus: nothing a fact can rest on lives past these headings.
_BACK_MATTER = re.compile(
    r"^==+\s*(?:See also|References|Notes|Footnotes|Further reading|External links|"
    r"Bibliography|Sources|Gallery|Citations|Cited (?:texts|works))\s*==+\s*$",
    re.M | re.I,
)

# The swift's failure: an absolute the source never stated. A fact may use one
# of these words only when its quote does.
ABSOLUTES = ("only", "always", "never", "first", "last", "all", "every", "none", "largest", "smallest", "biggest",
             "fastest", "slowest", "longest", "shortest", "oldest", "hardest", "softest", "rarest", "most", "least", "unique")
_WORDS = re.compile(r"[a-z0-9']+")
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)
_ELLIPSIS = re.compile(r"\s*(?:\.\.\.|…)\s*")

# The answer's shape, held by the gateway as the identification's is.
SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"fact": {"type": "string"}, "quote": {"type": "string"}},
                "required": ["fact", "quote"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["facts"],
    "additionalProperties": False,
}

AskFn = Callable[[str, dict], llm.Response]


@dataclass(frozen=True)
class Writer:
    """Who writes the facts: the identifier's model at its effort, with the prompt file."""

    key: str = field(repr=False)  # never logged
    model: str
    effort: str
    prompt_version: int
    system: str = field(repr=False)
    ask: AskFn = field(default=llm.ask, repr=False)


def writer(cfg: identify.Settings, prompt_path: Path = PROMPT_PATH) -> Writer:
    """The writer from Jasper's settings: the identifier (`QUARRY_IDENTIFIER`) and the gateway key."""
    version, system = identify.load_prompt(prompt_path)
    ident = cfg.roles[0]
    return Writer(key=cfg.key, model=ident.model, effort=ident.effort, prompt_version=version, system=system)


# ----------------------------------------------------------------------------
# Pure: the article, the answer, the check
# ----------------------------------------------------------------------------


def article_from(body: dict) -> tuple[str, str, str] | None:
    """The whole-article query's (title, url, plain text), or None for nothing usable:
    a missing page, a disambiguation page, an empty extract or no URL."""
    query = body.get("query") if isinstance(body, dict) else None
    pages = query.get("pages") if isinstance(query, dict) else None
    page = pages[0] if isinstance(pages, list) and pages and isinstance(pages[0], dict) else None
    if page is None or page.get("missing") or "disambiguation" in (page.get("pageprops") or {}):
        return None
    title = str(page.get("title") or "").strip()
    url = str(page.get("canonicalurl") or page.get("fullurl") or "").strip()
    text = page.get("extract").strip() if isinstance(page.get("extract"), str) else ""
    return (title, url, text) if title and url and text else None


def trim_article(text: str, limit: int = MAX_ARTICLE_CHARS) -> str:
    """Drop the back matter, then cap at a paragraph boundary."""
    m = _BACK_MATTER.search(text or "")
    body = (text[: m.start()] if m else (text or "")).strip()
    if len(body) <= limit:
        return body
    cut = body.rfind("\n", 0, limit)
    return body[: cut if cut > 0 else limit].rstrip()


def build_prompt(title: str, article: str) -> str:
    return f"Mineral or rock: {title}\n\nArticle:\n<<<\n{article}\n>>>"


def parse_reply(text: str) -> list[tuple[str, str]] | None:
    """The model's JSON as [(fact, quote), ...], with or without a code fence, or None
    when the answer isn't the shape asked for. Items missing either half are skipped."""
    raw = _FENCE.sub("", (text or "").strip())
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        body = json.loads(raw[start : end + 1])
    except ValueError:
        return None
    items = body.get("facts") if isinstance(body, dict) else None
    if not isinstance(items, list):
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        fact, quote = str(it.get("fact") or "").strip(), str(it.get("quote") or "").strip()
        if fact and quote:
            out.append((fact, quote))
    return out


def normalize(text: str) -> str:
    """The quote check's view of text: Unicode-folded, curly quotes and dashes made
    plain, whitespace collapsed, case folded. A model that retypes ’ as ' or a
    newline as a space has still quoted faithfully."""
    t = unicodedata.normalize("NFKC", text or "")
    t = t.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", t).strip().casefold()


def quote_found(quote: str, article: str) -> bool:
    """Every ellipsis-separated piece of the quote appears in the article. A quote that
    elides the middle of a sentence is still a quote; a piece the article never says is not."""
    hay = normalize(article)
    pieces = [p for p in _ELLIPSIS.split(quote or "") if p.strip()]
    return bool(pieces) and all(normalize(p) in hay for p in pieces)


# A figure: a digit run, optionally comma-grouped, optionally with decimals.
_FIGURE = re.compile(r"\d[\d,]*(?:\.\d+)?")
# Numbers written as words are read as numbers and held to the same rule. A lone
# word of ten or under ("one crystal", "two colours") is English, not a figure.
_UNITS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * i for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split(), 2)}
_SCALES = {"hundred": 100, "thousand": 1000}
_WORD = "|".join(sorted([*_UNITS, *_TENS, *_SCALES], key=len, reverse=True))
_NUMBER_PHRASE = re.compile(rf"\b(?:{_WORD})(?:(?:[\s-]+(?:and[\s-]+)?)(?:{_WORD}))*\b", re.I)


def words_value(phrase: str) -> int | None:
    """ "seventy-three" is 73, "one hundred and twelve" 112; None for a lone small word ("two")."""
    tokens = re.findall(_WORD, phrase.lower())
    if len(tokens) == 1 and tokens[0] in _UNITS and _UNITS[tokens[0]] <= 10:
        return None
    total = current = 0
    for t in tokens:
        if t in _UNITS:
            current += _UNITS[t]
        elif t in _TENS:
            current += _TENS[t]
        elif t == "hundred":
            current = (current or 1) * 100
        else:  # thousand
            total += (current or 1) * 1000
            current = 0
    return total + current


def figures(text: str) -> set[str]:
    """Every figure in the text, commas dropped, numbers written as words included
    ("eighteen" is 18). A trailing comma or period is punctuation, not a decimal."""
    out = set()
    for m in _FIGURE.finditer(text or ""):
        tok = m.group(0).rstrip(",").replace(",", "")
        if tok:
            out.add(tok)
    for m in _NUMBER_PHRASE.finditer(text or ""):
        value = words_value(m.group(0))
        if value is not None:
            out.add(str(value))
    return out


def check_fact(fact: str, quote: str, article: str, name: str = "") -> list[str]:
    """Why a fact may not be stored; empty when it may. In words, because the log
    prints them. `name` is the mineral's own: its words are never absolutes."""
    out = []
    if not quote_found(quote, article):
        out.append("its quote is not in the article")
    if len(fact) > MAX_FACT_CHARS:
        out.append(f"longer than {MAX_FACT_CHARS} characters ({len(fact)})")
    unfounded = sorted(figures(fact) - figures(quote))
    if unfounded:
        out.append(f"figures its quote doesn't hold: {', '.join(unfounded)}")
    quote_words = set(_WORDS.findall(normalize(quote))) | set(_WORDS.findall(normalize(name)))
    fact_words = set(_WORDS.findall(normalize(fact)))
    added = [w for w in ABSOLUTES if w in fact_words and w not in quote_words]
    if added:
        out.append(f"absolutes its quote doesn't say: {', '.join(added)}")
    if normalize(fact).startswith("did you know"):
        out.append('begins with "Did you know"')
    return out


def fact_id(text: str) -> str:
    """A short stable id: the dashboard's schedule and the dismiss cookie key on it,
    so the same words are the same fact on every box."""
    return hashlib.sha1(normalize(text).encode("utf-8")).hexdigest()[:10]


def near_duplicate(a: str, b: str, threshold: float = NEAR_DUPLICATE) -> bool:
    va, vb = set(_WORDS.findall(normalize(a))), set(_WORDS.findall(normalize(b)))
    return bool(va and vb) and len(va & vb) / len(va | vb) >= threshold


def select_facts(pairs: list[tuple[str, str]], article: str, name: str, source: dict) -> tuple[list[dict], list[tuple[str, list[str]]]]:
    """Check every (fact, quote); keep the first MAX_FACTS that pass and aren't a
    near-duplicate of one already kept. Returns (kept, rejected): kept as stored
    facts, each with its `source` display; rejected as (fact, reasons) for the log."""
    kept: list[dict] = []
    rejected: list[tuple[str, list[str]]] = []
    for fact, quote in pairs:
        reasons = check_fact(fact, quote, article, name)
        if not reasons and any(near_duplicate(fact, k["text"]) for k in kept):
            reasons = ["repeats an earlier fact"]
        if not reasons and len(kept) >= MAX_FACTS:
            reasons = [f"past the {MAX_FACTS}-fact cap"]
        if reasons:
            rejected.append((fact, reasons))
        else:
            kept.append({"id": fact_id(fact), "text": fact, "quote": quote, "source": source})
    return kept, rejected


def source_display(url: str) -> dict:
    """What a surface prints under a fact without a lookup: author, work, year, URL.
    Wikipedia has a work and a link; the books of #127 fill the rest."""
    return {"author": None, "work": "Wikipedia", "year": None, "url": url}


# ----------------------------------------------------------------------------
# The pass
# ----------------------------------------------------------------------------


def wanted(conn: sqlite3.Connection) -> list[str]:
    """The article titles with no Wikipedia row in `fun_facts` yet, in the order their pages were fetched."""
    return [r[0] for r in conn.execute(
        "SELECT title FROM wikipedia_pages WHERE title IS NOT NULL"
        "   AND title NOT IN (SELECT title FROM fun_facts WHERE source = ?)"
        " GROUP BY title ORDER BY MIN(fetched_at), title",
        (SOURCE,),
    )]


def facts_for(title: str, api: wikipedia.Api, who: Writer) -> list[dict]:
    """One article's facts, checked: [] when the article is nothing usable or holds
    none. Raises Unreachable when Wikipedia or the gateway gave no answer, so the
    title is tried again."""
    found = article_from(api.article(title))
    if found is None:
        return []
    name, url, text = found
    article = trim_article(text)
    resp = who.ask(who.key, llm.payload(who.model, who.effort, who.system, SCHEMA, [], build_prompt(name, article)))
    if resp.status != 200:
        raise Unreachable(llm.status_line(resp.status, resp.body))
    try:
        pairs = parse_reply(llm.reply_text(resp.body))
    except llm.LlmError as e:
        log.warning("fun facts: %s: %s; recorded with none", title, e)
        return []
    if pairs is None:
        log.warning("fun facts: %s: the answer wasn't the JSON asked for; recorded with none", title)
        return []
    kept, rejected = select_facts(pairs, article, name, source_display(url))
    for fact, reasons in rejected:
        log.info("fun facts: %s: dropped %r (%s)", title, fact, "; ".join(reasons))
    return kept


def write_facts(conn: sqlite3.Connection, api: wikipedia.Api, who: Writer, deadline: float,
                clock: Clock = time.monotonic) -> tuple[int, int]:
    """Write the facts for each title in `wanted`, one transaction per article. Returns
    (articles written, of which none); stops quietly where the time runs out or a
    job arrives, between articles: a call in flight is finished. Raises Unreachable."""
    written = empty = 0
    try:
        for title in wanted(conn):
            _in_time(deadline, clock)
            facts = facts_for(title, api, who)
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO fun_facts (title, source, kind, facts) VALUES (?, ?, ?, ?)",
                    (title, SOURCE, KIND, json.dumps(facts, ensure_ascii=False)),
                )
            written += 1
            empty += not facts
    except OutOfTime:
        pass
    return written, empty
