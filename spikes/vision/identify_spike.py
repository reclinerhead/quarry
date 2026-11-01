"""Phase 0 spike: how well do cheap hosted vision models identify our own specimens?

Every model is called through the Vercel AI Gateway, so one key reaches all of
them: AI_GATEWAY_API_KEY in the environment, never on the command line. Model
IDs are gateway slugs, listed at https://ai-gateway.vercel.sh/v1/models.

Usage
-----
    python identify_spike.py photos                      # default models
    python identify_spike.py photos --group              # photos sharing a stem are one specimen
    python identify_spike.py photos --models anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5
    python identify_spike.py photos --effort low         # thinking depth, for every model

Photo layout
------------
The quick way: a flat folder of photos, no names. Each is identified and the
top three candidates are printed for you to judge by eye. Nothing is scored.

The scored way, when you know what a specimen is:

    photos/
      Quartz/                      <- what you believe it is
        point-1.jpg
        point-1.txt                <- optional notes for that photo (see below)
      Amethyst/                    <- a variety is fine; it also scores against Quartz
        geode.jpg
      Quartz var. Rose Quartz/     <- "Mineral var. Variety" when you know both
        tumbled.jpg
      Pyrite/
        cube_top.jpg               <- with --group, cube_top + cube_side are one specimen
        cube_side.jpg
        cube.txt

Notes are free text, as the owner would say them, in a .txt file named for the
photo's stem (or the group key with --group):

    Found on a Lake Superior beach. Scratches glass: yes. Vinegar: no fizz.
    Magnet: no. Streak: white. About 3 cm.

A specimen with notes is identified twice: photo alone, then photo plus notes.

Every response is cached in out/responses/ so re-running the scoring costs
nothing. Delete a cached file to re-query it. Results land in out/results.md
and out/results.csv.
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageOps

try:  # iPhone photos arrive as HEIC; Pillow needs the opener registered
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
LONG_SIDE = 1280  # what the app's uploader will send
TOP_N = 3
MAX_PHOTOS = 5
DEFAULT_MODELS = "anthropic/claude-haiku-5.5,google/gemini-3.8-flash"
# The gateway's Anthropic Messages endpoint serves every model, Gemini included,
# with the same images, system prompt, effort and JSON schema.
GATEWAY_URL = "https://ai-gateway.vercel.sh"

SYSTEM = """\
You identify rocks, minerals, and crystals from photos for a family's home collection.
The family members are keen amateurs, not geologists. Your answer is a suggestion:
a person confirms or corrects it before anything is saved.

Return one to three candidates, most likely first.
- name: the mineral species or rock type, as Mindat names it (Quartz, Calcite,
  Pyrite, Granite, Obsidian). Name the species, not the variety, here.
- variety: the variety or trade name when one applies (Amethyst, Rose Quartz,
  Agate, Tiger's Eye), otherwise an empty string.
- kind: "mineral" for a mineral species, "rock" for a rock, "other" for
  anything else (a fossil, glass, a man-made stone).
- confidence: your honest probability from 0 to 1 that this candidate is right.
  The three need not sum to 1. Be calibrated: photos cannot show hardness or
  chemistry, and many minerals look alike.
- features: the visible features that point to this candidate (colour, luster,
  habit, cleavage, banding), each a short phrase.

Then suggest one to three at-home tests that would best separate your candidates,
using only household things: a glass bottle or window (about Mohs 5.5), a steel
knife or nail (about 5.5), a copper coin (about 3.5), a fingernail (about 2.5),
the unglazed back of a bathroom tile (for streak), household vinegar (fizz), a
fridge magnet, and a UV flashlight if the family has one. For each test, say how
to do it and what each candidate would show. Skip any test the notes already answer.

If any photo shows a label, tag, or card with writing on it, copy that text into
label_text; otherwise leave label_text empty.
"""

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
                    "kind": {"type": "string", "enum": ["mineral", "rock", "other"]},
                    "confidence": {"type": "number"},
                    "features": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "variety", "kind", "confidence", "features"],
                "additionalProperties": False,
            },
        },
        "tests": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "test": {"type": "string"},
                    "how": {"type": "string"},
                    "expected": {"type": "string"},
                },
                "required": ["test", "how", "expected"],
                "additionalProperties": False,
            },
        },
        "label_text": {"type": "string"},
    },
    "required": ["candidates", "tests", "label_text"],
    "additionalProperties": False,
}


# ----------------------------------------------------------------------------
# Pure logic: naming, grouping, matching, scoring, cost
# ----------------------------------------------------------------------------


def norm(name: str) -> str:
    """'Tiger's Eye' -> 'tigers eye'; 'Quartz, var. Amethyst' -> 'quartz var amethyst'."""
    name = name.lower().replace("'", "").replace("’", "")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", name).split())


@dataclass
class Expected:
    label: str
    names: set[str]  # any of these, normalized, counts as a hit


def parse_expected(folder_name: str) -> Expected:
    """'Quartz var. Amethyst' accepts Quartz or Amethyst; 'Amethyst' accepts Amethyst."""
    label = folder_name.strip()
    parts = re.split(r"\s+var\.?\s+|\s*\(|\)", label, flags=re.IGNORECASE)
    names = {norm(p) for p in parts if norm(p)}
    return Expected(label=label, names=names)


def group_key(path: Path, grouped: bool) -> str:
    """With --group, photos sharing the stem before the first underscore are one specimen."""
    if not grouped:
        return path.stem
    return path.stem.split("_", 1)[0]


@dataclass
class Candidate:
    name: str
    variety: str
    kind: str
    confidence: float
    features: list[str] = field(default_factory=list)

    def display(self) -> str:
        v = f" ({self.variety})" if self.variety else ""
        return f"{self.name}{v} {self.confidence:.2f}"

    def answers(self) -> set[str]:
        """Every way this candidate could be naming the expected specimen."""
        out = {norm(self.name)}
        if self.variety:
            v = norm(self.variety)
            out |= {v, f"{v} {norm(self.name)}", f"{norm(self.name)} {v}"}
        return out - {""}


def candidates_from(result: dict) -> list[Candidate]:
    out = []
    for c in result.get("candidates", [])[:TOP_N]:
        out.append(
            Candidate(
                name=str(c.get("name", "")),
                variety=str(c.get("variety", "")),
                kind=str(c.get("kind", "")),
                confidence=float(c.get("confidence", 0.0) or 0.0),
                features=list(c.get("features", [])),
            )
        )
    return out


def is_hit(expected: Expected, cand: Candidate) -> bool:
    return bool(expected.names & cand.answers())


@dataclass
class Score:
    top1: bool
    top3: bool


def score(expected: Expected, cands: list[Candidate]) -> Score:
    top = cands[:TOP_N]
    return Score(top1=bool(top) and is_hit(expected, top[0]), top3=any(is_hit(expected, c) for c in top))


def band(confidence: float) -> str:
    if confidence >= 0.7:
        return "high (0.7+)"
    if confidence >= 0.4:
        return "mid (0.4-0.7)"
    return "low (<0.4)"


def market_cost(provider_metadata: dict | None) -> float | None:
    """The call's cost at list price, as the gateway reports it (thinking included).
    marketCost, not cost: a call billed to our own provider key (BYOK) costs the
    gateway nothing, so its cost is 0, but marketCost is still what it is worth."""
    try:
        return float(((provider_metadata or {}).get("gateway") or {})["marketCost"])
    except (KeyError, TypeError, ValueError):
        return None


def pct(hits: int, total: int) -> str:
    return "n/a" if total == 0 else f"{hits}/{total} ({100 * hits / total:.0f}%)"


def summarize(rows: list[dict]) -> list[dict]:
    """One line per model and pass over the rows that came back ok."""
    out = []
    keys = sorted({(r["model"], r["pass"]) for r in rows})
    for model, pass_ in keys:
        mine = [r for r in rows if r["model"] == model and r["pass"] == pass_]
        ok = [r for r in mine if r["status"] == "ok"]
        scored = [r for r in ok if r["expected"]]
        costs = [r["cost_usd"] for r in ok if r["cost_usd"] != ""]
        secs = [r["seconds"] for r in ok]
        bands = {}
        for r in scored:
            b = bands.setdefault(r["top1_band"], [0, 0])
            b[0] += int(r["top1"])
            b[1] += 1
        out.append(
            {
                "model": model,
                "pass": pass_,
                "specimens": len(mine),
                "errors": len(mine) - len(ok),
                "top-1": pct(sum(r["top1"] for r in scored), len(scored)),
                "top-3": pct(sum(r["top3"] for r in scored), len(scored)),
                "label read": str(sum(1 for r in ok if r["label_text"])),
                "by confidence": "; ".join(f"{k} {pct(*v)}" for k, v in sorted(bands.items())) or "n/a",
                "cost / ID": f"${sum(costs) / len(costs):.5f}" if costs else "n/a",
                "cost / 1000": f"${1000 * sum(costs) / len(costs):.2f}" if costs else "n/a",
                "sec / ID": f"{sum(secs) / len(secs):.1f}" if secs else "n/a",
            }
        )
    return out


# ----------------------------------------------------------------------------
# I/O: images, the gateway, the cache, the reports
# ----------------------------------------------------------------------------


def prepare_image(path: Path) -> bytes:
    """Resize to 1280 px on the long side, JPEG q90, as the app's uploader will."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LONG_SIDE, LONG_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        return buf.getvalue()


def user_text(notes: str | None) -> str:
    if notes:
        return f"Photos of one specimen. The owner's notes:\n{notes.strip()}"
    return "Photos of one specimen. No notes from the owner."


@dataclass
class Reply:
    status: str  # ok, or an error description
    result: dict
    input_tokens: int
    output_tokens: int
    seconds: float
    cost_usd: float | None = None


def ask(model: str, images: list[bytes], notes: str | None, effort: str) -> Reply:
    """One identification, any model, through the gateway's Anthropic Messages endpoint."""
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["AI_GATEWAY_API_KEY"], base_url=GATEWAY_URL)
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(b).decode()}}
        for b in images
    ]
    content.append({"type": "text", "text": user_text(notes)})
    t0 = time.monotonic()
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        )
    except anthropic.RateLimitError as e:
        return Reply(f"rate limited: {e.message}", {}, 0, 0, time.monotonic() - t0)
    except anthropic.APIStatusError as e:
        return Reply(f"http {e.status_code}: {e.message}", {}, 0, 0, time.monotonic() - t0)
    except anthropic.APIConnectionError as e:
        return Reply(f"connection: {e}", {}, 0, 0, time.monotonic() - t0)
    secs = time.monotonic() - t0
    usage_in, usage_out = resp.usage.input_tokens or 0, resp.usage.output_tokens or 0
    cost = market_cost(resp.model_dump().get("provider_metadata"))
    if resp.stop_reason != "end_turn":
        return Reply(f"stop_reason {resp.stop_reason}", {}, usage_in, usage_out, secs, cost)
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return Reply(f"not JSON: {text[:80]!r}", {}, usage_in, usage_out, secs, cost)
    return Reply("ok", result, usage_in, usage_out, secs, cost)


UNLABELED = Expected(label="", names=set())


@dataclass
class Specimen:
    expected: Expected
    key: str
    photos: list[Path]
    notes: str | None


def collect_specimens(root: Path, grouped: bool) -> list[Specimen]:
    """Named subfolders are scored; a flat folder of photos is just identified, for the eye."""
    specimens = []
    folders = sorted(p for p in root.iterdir() if p.is_dir())
    sources = [(parse_expected(f.name), f) for f in folders] or [(UNLABELED, root)]
    for expected, folder in sources:
        groups: dict[str, list[Path]] = {}
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in IMAGE_EXTS:
                groups.setdefault(group_key(f, grouped), []).append(f)
        for key, photos in groups.items():
            notes_file = folder / f"{key}.txt"
            notes = notes_file.read_text(encoding="utf-8").strip() if notes_file.exists() else None
            specimens.append(Specimen(expected, key, photos[:MAX_PHOTOS], notes or None))
    return specimens


def safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos", type=Path, help="folder of <expected name>/<photo> files, or a flat folder")
    ap.add_argument("--group", action="store_true", help="send photos sharing a stem as one specimen")
    ap.add_argument("--models", default=DEFAULT_MODELS, help=f"comma-separated gateway slugs (default {DEFAULT_MODELS})")
    ap.add_argument("--effort", default="medium", help="thinking depth for every model: low, medium, high (default medium)")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between live calls")
    args = ap.parse_args()

    if not args.photos.is_dir():
        print(f"not a folder: {args.photos}", file=sys.stderr)
        return 2

    if not os.environ.get("AI_GATEWAY_API_KEY", "").strip():
        print("AI_GATEWAY_API_KEY is not set", file=sys.stderr)
        return 2
    models = [m.strip() for m in args.models.split(",") if m.strip()]

    cache_dir = args.out / "responses"
    cache_dir.mkdir(parents=True, exist_ok=True)

    specimens = collect_specimens(args.photos, args.group)
    with_notes = sum(1 for s in specimens if s.notes)
    print(f"{len(specimens)} specimens from {args.photos} ({with_notes} with notes), effort {args.effort}, models: {', '.join(models)}\n")

    rows: list[dict] = []
    for sp in specimens:
        images = None
        passes = ["photo"] + (["notes"] if sp.notes else [])
        for model in models:
            for pass_ in passes:
                notes = sp.notes if pass_ == "notes" else None
                label = sp.expected.label or "unlabeled"
                cache_file = cache_dir / safe(f"{model}__{args.effort}__{label}__{sp.key}__{pass_}.json")
                if cache_file.exists():
                    reply = Reply(**json.loads(cache_file.read_text(encoding="utf-8")))
                    source = "cache"
                else:
                    images = images or [prepare_image(p) for p in sp.photos]
                    reply = ask(model, images, notes, args.effort)
                    if reply.status == "ok":  # errors are not cached, so a re-run retries them
                        cache_file.write_text(json.dumps(reply.__dict__, indent=1), encoding="utf-8")
                    source = "live"
                    time.sleep(args.sleep)

                cands = candidates_from(reply.result)
                sc = score(sp.expected, cands)
                cost = reply.cost_usd
                tests = reply.result.get("tests", [])
                rows.append(
                    {
                        "model": model,
                        "pass": pass_,
                        "expected": sp.expected.label,
                        "photos": ", ".join(p.name for p in sp.photos),
                        "status": reply.status,
                        "top1": sc.top1,
                        "top3": sc.top3,
                        "top1_band": band(cands[0].confidence) if cands else "none named",
                        # an empty list is a real answer: the model declined to name anything
                        "candidates": " | ".join(c.display() for c in cands) or ("(none named)" if reply.status == "ok" else ""),
                        "features": " | ".join("; ".join(c.features) for c in cands),
                        "tests": " | ".join(f"{t.get('test', '')}: {t.get('expected', '')}" for t in tests),
                        "label_text": reply.result.get("label_text", ""),
                        "input_tokens": reply.input_tokens,
                        "output_tokens": reply.output_tokens,
                        "cost_usd": "" if cost is None else round(cost, 6),
                        "seconds": round(reply.seconds, 1),
                    }
                )
                r = rows[-1]
                name = sp.expected.label or sp.photos[0].name
                mark = "" if not sp.expected.label else ("1 " if sc.top1 else ("3 " if sc.top3 else "- "))
                flag = "  [label]" if r["label_text"] else ""
                print(f"[{source:5}] {mark}{model:26} {pass_:5} {name:28} -> {r['candidates'] or reply.status}{flag}")

    if not rows:
        return 1

    summary = summarize(rows)
    args.out.mkdir(parents=True, exist_ok=True)

    with (args.out / "results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    cols = list(summary[0].keys())
    lines = ["# Vision model spike results", "", f"Effort: {args.effort}", ""]
    lines += ["| " + " | ".join(cols) + " |", "|" + " --- |" * len(cols)]
    lines += ["| " + " | ".join(str(s[c]) for c in cols) + " |" for s in summary]
    lines += ["", "| model | pass | expected | top-3 | candidates | tests | label |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        hit = "" if not r["expected"] else ("1" if r["top1"] else ("3" if r["top3"] else "✗"))
        name = r["expected"] or r["photos"]
        cands = r["candidates"] or r["status"]
        lines.append(f"| {r['model']} | {r['pass']} | {name} | {hit} | {cands} | {r['tests']} | {r['label_text']} |")
    (args.out / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print()
    for s in summary:
        print(f"{s['model']} / {s['pass']}")
        for k in cols[2:]:
            print(f"  {k:>14}: {s[k]}")
    print(f"\nwrote {args.out / 'results.md'} and results.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
