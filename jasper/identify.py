"""What Jasper asks the two models, and what their answers mean for a job (#7).

Phase 0 (#1) chose the pair: Claude Haiku at medium effort names the stone,
and Gemini Flash at low effort gives a second opinion from another company.
Each is asked the same question (the prompt file, the photos, the owner's
notes and test answers, held to SCHEMA) and each answer is kept apart; the
confirm screen (#8) works out whether they agree when it renders.

Everything that decides something is pure and tested (`load_prompt`,
`settings`, `user_text`, `parse_answer`, `opinion`, `classify`); the image
functions at the bottom are I/O, copied from the Conservatory's Pl@ntNet
client.
"""

from __future__ import annotations

import io
import json
import math
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageOps

from . import llm

try:  # iPhone photos arrive as HEIC when a browser could not re-encode them
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

PROMPT_PATH = Path(__file__).with_name("prompts") / "identify.md"
DEFAULT_IDENTIFIER = "anthropic/claude-haiku-5.5"
DEFAULT_SECOND_OPINION = "google/gemini-3.8-flash"
CANDIDATE_KINDS = ("mineral", "rock", "other")
# The shape of a piece as a rock hound bins it (#73); the schema's CHECK on candidates.form and specimens.form.
FORMS = ("crystal", "cluster", "geode", "druzy", "rough", "tumbled", "slab", "carved")
# What a model answers for the form when the photos don't say (#77). A real word, not "":
# Gemini refuses an empty enum value, and the one schema goes to both models.
NO_FORM = "none"
# The schema's CHECK on suggested_tests.kind, in the order the user message lists answers.
TEST_KINDS = ("glass", "steel", "copper", "fingernail", "streak", "vinegar", "magnet", "uv")
MAX_CANDIDATES = 3
MAX_WITH = 3  # other minerals on one piece, as a show label names them (#29)
MATRIX = "matrix"  # a base of rock nobody names: "Amethyst on matrix"
MAX_TESTS = 3
MAX_IMAGES = 5
LONG_SIDE = 1280  # the copy the models see, made in memory
# The most a photo on disk measures on its long side (#83). The browser's
# shrink (web/lib/shrink.ts, LONG_SIDE) uses the same number, so the common
# upload is already the stored copy; normalize_photo is the guarantee behind it.
STORE_SIDE = 2048
STORE_QUALITY = 85
THUMB_SIDE = 320

SCHEMA = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "variety": {"type": "string"},
                    "kind": {"type": "string", "enum": list(CANDIDATE_KINDS)},
                    "made_of": {"type": "string"},
                    "form": {"type": "string", "enum": [*FORMS, NO_FORM]},
                    "with": {"type": "array", "items": {"type": "string"}},
                    "on": {"type": "string"},
                    "confidence": {"type": "number"},
                    "features": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "variety", "kind", "made_of", "form", "with", "on", "confidence", "features"],
                "additionalProperties": False,
            },
        },
        "tests": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(TEST_KINDS)},
                    "how": {"type": "string"},
                    "expected": {"type": "string"},
                },
                "required": ["kind", "how", "expected"],
                "additionalProperties": False,
            },
        },
        "label_text": {"type": "string"},
    },
    "required": ["candidates", "tests", "label_text"],
    "additionalProperties": False,
}

# How the user message says each test the owner answered. The hardness tests
# read the way the household does them: the stone scratches glass, but the
# knife, the coin and the fingernail scratch the stone.
TEST_WORDS = {
    "glass": "Scratches glass",
    "steel": "A steel knife scratches it",
    "copper": "A copper coin scratches it",
    "fingernail": "A fingernail scratches it",
    "streak": "Streak",
    "vinegar": "Fizzes in vinegar",
    "magnet": "A magnet sticks to it",
    "uv": "Glows under UV light",
}

NOT_TRIED = "not tried"


# ----------------------------------------------------------------------------
# Settings: the key, the two roles, the prompt
# ----------------------------------------------------------------------------

_FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def load_prompt(path: Path = PROMPT_PATH) -> tuple[int, str]:
    """(prompt_version, instructions) from the prompt file's front matter and body."""
    raw = path.read_text(encoding="utf-8")
    m = _FRONT.match(raw)
    if not m:
        raise ValueError(f"{path.name}: no front matter")
    v = re.search(r"^prompt_version:\s*(\d+)\s*$", m.group(1), re.MULTILINE)
    if not v:
        raise ValueError(f"{path.name}: no prompt_version")
    return int(v.group(1)), raw[m.end():].strip()


def short_name(slug: str) -> str:
    """The log's name for a model: anthropic/claude-haiku-5.5 -> haiku, google/gemini-3.8-flash -> flash."""
    words = [w for w in slug.rsplit("/", 1)[-1].split("-") if w and not re.fullmatch(r"[\d.]+", w)]
    return "-".join(words[1:] if len(words) > 1 else words) or slug


@dataclass(frozen=True)
class Role:
    """One of the two models Jasper asks, and how hard it thinks."""

    name: str  # identifier | second opinion
    model: str  # the gateway slug
    effort: str

    @property
    def short(self) -> str:
        return short_name(self.model)


@dataclass(frozen=True)
class Settings:
    key: str = field(repr=False)  # never logged
    roles: tuple[Role, ...]
    prompt_version: int
    system: str = field(repr=False)


def settings(environ: Mapping[str, str] | None = None, prompt_path: Path = PROMPT_PATH) -> Settings | None:
    """The gateway key, the two roles and the prompt, or None when there is no key.
    Raises ValueError when both roles name the same model: the second opinion must
    be another model, and their candidates are keyed by slug."""
    env = os.environ if environ is None else environ
    key = (env.get("AI_GATEWAY_API_KEY") or "").strip()
    if not key:
        return None
    roles = (
        Role("identifier", (env.get("QUARRY_IDENTIFIER") or "").strip() or DEFAULT_IDENTIFIER, "medium"),
        Role("second opinion", (env.get("QUARRY_SECOND_OPINION") or "").strip() or DEFAULT_SECOND_OPINION, "low"),
    )
    if roles[0].model == roles[1].model:
        raise ValueError(f"QUARRY_IDENTIFIER and QUARRY_SECOND_OPINION are both {roles[0].model}; the second opinion must be another model")
    version, system = load_prompt(prompt_path)
    return Settings(key=key, roles=roles, prompt_version=version, system=system)


# ----------------------------------------------------------------------------
# The question
# ----------------------------------------------------------------------------


def answer_words(value: object) -> str:
    """yes, no, not tried, or the owner's own words (a streak colour). Not tried is never no."""
    if value is True:
        return "yes"
    if value is False:
        return "no"
    text = " ".join(str(value).split()) if value is not None else ""
    if text.lower().replace("_", " ") in ("", NOT_TRIED):
        return NOT_TRIED
    return text


def user_text(notes: str | None, tests_json: str | None) -> str:
    """The text after the photos: the owner's notes, and any test answers in words,
    e.g. "Scratches glass: no. Streak: red-brown. Fizzes in vinegar: not tried."
    `tests_json` is the job's `tests` column (test kind -> answer); a kind the app
    does not know yet is said with its own name rather than dropped."""
    notes = (notes or "").strip()
    out = f"Photos of one specimen. The owner's notes:\n{notes}" if notes else "Photos of one specimen. No notes from the owner."
    try:
        tests = json.loads(tests_json or "{}")
    except json.JSONDecodeError:
        tests = {}
    if isinstance(tests, dict) and tests:
        keys = [k for k in TEST_KINDS if k in tests] + sorted(k for k in tests if k not in TEST_KINDS)
        said = [f"{TEST_WORDS.get(k) or k.replace('_', ' ').capitalize()}: {answer_words(tests[k])}." for k in keys]
        out += "\nThe owner's test answers: " + " ".join(said)
    return out


# ----------------------------------------------------------------------------
# The validator
# ----------------------------------------------------------------------------


class InvalidAnswer(ValueError):
    """The model answered, but not with something this app will store."""


@dataclass
class Part:
    """Another mineral on the piece (#29): `with` the main one, or the base it is `on`.
    The base may be MATRIX, rock nobody names, which is never looked up."""

    role: str  # with | on
    name: str
    mindat_id: int | None = None  # set by mindat.resolve_outcome, as for the candidate

    def as_json(self) -> dict:
        return {"role": self.role, "name": self.name, "mindat_id": self.mindat_id}


@dataclass
class Candidate:
    name: str
    variety: str | None
    kind: str
    confidence: float
    features: list[str] = field(default_factory=list)
    mindat_id: int | None = None  # set by mindat.resolve_outcome before the job is written (#18)
    parts: list[Part] = field(default_factory=list)  # the `with` minerals in order, then the `on`
    # What an object that is not a mineral is composed of or preserved as (#62): a fossil
    # coral made of Calcite. None for a mineral, a rock, or when the photos don't say.
    made_of: str | None = None
    made_of_mindat_id: int | None = None  # set by mindat.resolve_outcome, as for a part
    form: str | None = None  # the shape of the piece (#73), one of FORMS, or None when the model didn't say

    def label(self) -> str:
        """The candidate for the log: Galena, Quartz (Amethyst), Pyrite with Sphalerite on Quartz,
        Fossil coral made of Calcite, Quartz on matrix [geode]."""
        withs = [p.name for p in self.parts if p.role == "with"]
        on = next((p.name for p in self.parts if p.role == "on"), None)
        return (self.name + (f" ({self.variety})" if self.variety else "")
                + (f" with {', '.join(withs)}" if withs else "") + (f" on {on}" if on else "")
                + (f" made of {self.made_of}" if self.made_of else "") + (f" [{self.form}]" if self.form else ""))


@dataclass
class SuggestedTest:
    kind: str
    how: str
    expected: str


@dataclass
class Answer:
    candidates: list[Candidate]
    tests: list[SuggestedTest]
    label_text: str | None


def _words(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _candidate(raw: object, rank: int) -> Candidate:
    if not isinstance(raw, dict):
        raise InvalidAnswer(f"candidate {rank} is not an object")
    name = _words(raw.get("name"))
    if not name:
        raise InvalidAnswer(f"candidate {rank} has no name")
    kind = _words(raw.get("kind")).lower()
    if kind not in CANDIDATE_KINDS:
        raise InvalidAnswer(f"candidate {rank} ({name}): kind {raw.get('kind')!r} is not mineral, rock or other")
    conf = raw.get("confidence")
    if isinstance(conf, bool) or not isinstance(conf, (int, float)) or not math.isfinite(conf):
        raise InvalidAnswer(f"candidate {rank} ({name}): confidence {conf!r} is not a number")
    features = raw.get("features", [])
    if not isinstance(features, list):
        raise InvalidAnswer(f"candidate {rank} ({name}): features is not a list")
    made_of = raw.get("made_of", "")
    if not isinstance(made_of, str):
        raise InvalidAnswer(f"candidate {rank} ({name}): made_of is not text")
    # Missing on a v1 or v2 answer; empty, or the name itself, says nothing.
    made_of = _words(made_of)
    if made_of.casefold() == name.casefold():
        made_of = ""
    # The form (#73): missing before v6, "none" (or "" before v7) when the photos don't
    # say, and a model's stray word off the list is not an invalid answer, just no form.
    form = _words(raw.get("form", "")).lower() if isinstance(raw.get("form", ""), str) else ""
    return Candidate(
        name=name,
        variety=_words(raw.get("variety")) or None,
        kind=kind,
        confidence=min(1.0, max(0.0, float(conf))),
        features=[f for f in (_words(x) for x in features) if f],
        parts=_parts(raw, name, rank),
        made_of=made_of or None,
        form=form if form in FORMS else None,
    )


def _parts(raw: dict, name: str, rank: int) -> list[Part]:
    """`with` and `on` (#29). Either may be missing, as in a prompt v1 answer, and is then
    empty. A name that repeats the main mineral, the base or an earlier one is dropped,
    at most MAX_WITH are kept, and the base `matrix` is spelled as such."""
    withs, on = raw.get("with", []), raw.get("on", "")
    if not isinstance(withs, list):
        raise InvalidAnswer(f"candidate {rank} ({name}): with is not a list")
    if not isinstance(on, str):
        raise InvalidAnswer(f"candidate {rank} ({name}): on is not text")
    on = _words(on)
    if on.casefold() == MATRIX:
        on = MATRIX
    if on.casefold() == name.casefold():
        on = ""
    seen = {name.casefold(), on.casefold()}
    parts: list[Part] = []
    for w in (_words(x) for x in withs):
        if w and w.casefold() not in seen and w.casefold() != MATRIX and len(parts) < MAX_WITH:
            seen.add(w.casefold())
            parts.append(Part("with", w))
    return parts + ([Part("on", on)] if on else [])


def _test(raw: object) -> SuggestedTest | None:
    """A suggested test, or None when its kind is off the list or it says nothing."""
    if not isinstance(raw, dict):
        return None
    kind = _words(raw.get("kind")).lower()
    how, expected = _words(raw.get("how")), _words(raw.get("expected"))
    if kind not in TEST_KINDS or not how or not expected:
        return None
    return SuggestedTest(kind, how, expected)


def parse_answer(text: str) -> Answer:
    """One model's answer, checked, or InvalidAnswer.

    Up to three candidates (any beyond are cut), each with a name, a kind from
    its enum and a numeric confidence clamped to 0..1. An empty list is a real
    answer: the model named nothing. Tests whose kind is off the list, or that
    say nothing, are dropped, and at most three are kept. The outermost {...}
    is read, so a code fence or a stray sentence around it is forgiven."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise InvalidAnswer("no JSON object in the answer")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise InvalidAnswer(f"not JSON ({e.msg})") from None
    raw = data.get("candidates")
    if not isinstance(raw, list):
        raise InvalidAnswer("no candidates list")
    candidates = [_candidate(c, rank) for rank, c in enumerate(raw[:MAX_CANDIDATES], start=1)]
    raw_tests = data.get("tests") or []
    if not isinstance(raw_tests, list):
        raise InvalidAnswer("tests is not a list")
    tests = [t for t in (_test(t) for t in raw_tests) if t][:MAX_TESTS]
    label = data.get("label_text") or ""
    if not isinstance(label, str):
        raise InvalidAnswer("label_text is not text")
    return Answer(candidates, tests, label.strip() or None)


# ----------------------------------------------------------------------------
# Outcomes
# ----------------------------------------------------------------------------


@dataclass
class Opinion:
    """One model's part in a job: its answer, or why there is none."""

    role: Role
    status: int  # the HTTP status, 0 when the gateway was unreachable
    answer: Answer | None = None
    error: str | None = None
    cost_usd: float | None = None
    seconds: float = 0.0

    @property
    def kind(self) -> str:
        """answer, budget (402), auth (401, 403), retry (worth trying again) or fatal."""
        if self.answer is not None:
            return "answer"
        if self.status == 402:
            return "budget"
        if self.status in (401, 403):
            return "auth"
        # 200 here is an invalid answer: models vary, so a second ask may pass.
        if self.status in (0, 200, 408, 429) or self.status >= 500:
            return "retry"
        return "fatal"

    def describe(self) -> str:
        """For the log line: haiku Galena 0.82, flash nothing named, flash <the error>."""
        if self.answer is None:
            return f"{self.role.short} {self.error}"
        if not self.answer.candidates:
            return f"{self.role.short} nothing named"
        c = self.answer.candidates[0]
        return f"{self.role.short} {c.label()} {c.confidence:.2f}"


def opinion(role: Role, resp: llm.Response) -> Opinion:
    """What one model's response amounts to. The cost is kept whenever the gateway reported it."""
    cost = llm.market_cost(resp.body)
    if resp.status == 200:
        try:
            answer = parse_answer(llm.reply_text(resp.body))
        except (llm.LlmError, InvalidAnswer) as e:
            return Opinion(role, 200, None, f"invalid answer: {e}", cost, resp.seconds)
        return Opinion(role, 200, answer, None, cost, resp.seconds)
    return Opinion(role, resp.status, None, llm.status_line(resp.status, resp.body), cost, resp.seconds)


@dataclass
class Outcome:
    """What a job's opinions mean for it. `status` is one of identified (at least
    one model named something), rejected (whoever answered named nothing), quota
    (a 402: back to the queue, and the worker pauses), retry (backoff) or failed
    (for good). `error` names each model that gave no answer, and why."""

    status: str
    opinions: list[Opinion] = field(default_factory=list)
    error: str | None = None

    @property
    def label_text(self) -> str | None:
        """The first label either model read, the identifier's first."""
        return next((o.answer.label_text for o in self.opinions if o.answer and o.answer.label_text), None)

    @property
    def cost_usd(self) -> float:
        return sum(o.cost_usd or 0.0 for o in self.opinions)


def classify(opinions: list[Opinion]) -> Outcome:
    """The job's outcome from its two opinions, in this order:

    1. a 402 from either: quota (the budget is shared, so the other answer is bought again later)
    2. a valid answer that names something: identified, on one opinion if need be
    3. a valid answer that names nothing: rejected
    4. a 401 or 403: failed for good (a bad key; retrying cannot fix it)
    5. a 429, a 5xx, a transport error or an invalid answer: retry
    6. anything else (a 400, an unknown model): failed for good
    """
    error = "; ".join(f"{o.role.short}: {o.error}" for o in opinions if o.error) or None
    kinds = {o.kind for o in opinions}
    if "budget" in kinds:
        status = "quota"
    elif any(o.answer and o.answer.candidates for o in opinions):
        status = "identified"
    elif "answer" in kinds:
        status = "rejected"
    elif "auth" in kinds:
        status = "failed"
    elif "retry" in kinds:
        status = "retry"
    else:
        status = "failed"
    return Outcome(status, opinions, error)


# ----------------------------------------------------------------------------
# I/O: the photos
# ----------------------------------------------------------------------------


def prepare_image(path: Path) -> bytes:
    """Re-encode to JPEG at most 1280 px on the long side, orientation applied.

    The browser already did this for most uploads; this is the HEIC and
    oversize fallback, and it is harmless on a file that is already right."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LONG_SIDE, LONG_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        return buf.getvalue()


def normalize_photo(src: Path) -> Path | None:
    """Make the photo on disk a JPEG of at most STORE_SIDE px on the long side (#83).

    A JPEG already within the cap is left alone, byte for byte, and None comes
    back. Anything else (a HEIC or PNG the browser could not draw, a JPEG over
    the cap) is re-encoded with its orientation applied and no EXIF, written
    through a temp file to <stem>.jpg beside the original, and that path comes
    back. The original is left for the caller to remove once the row points at
    the new file, so a crash between the two leaves a stray file, never a row
    that names a file that is gone."""
    with Image.open(src) as im:
        if im.format == "JPEG" and max(im.size) <= STORE_SIDE:
            return None
        out = ImageOps.exif_transpose(im).convert("RGB")
    out.thumbnail((STORE_SIDE, STORE_SIDE))
    dst = src.with_suffix(".jpg")
    tmp = dst.with_name(dst.name + ".part")
    out.save(tmp, "JPEG", quality=STORE_QUALITY)
    os.replace(tmp, dst)
    return dst


def write_thumbnail(src: Path, dst: Path) -> None:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((THUMB_SIDE, THUMB_SIDE))
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "JPEG", quality=85)
