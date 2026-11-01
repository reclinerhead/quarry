"""Compare scored runs side by side, and measure what a second opinion buys.

    python identify_spike.py photos-commons --models anthropic/claude-haiku-5.5 --out out-commons/haiku
    python identify_spike.py photos-commons --models google/gemini-3.8-flash --out out-commons/gemini-flash
    python compare_runs.py out-commons > out-commons/compare.md

Each subfolder of the given folder is one run (one model at one effort), named
by the folder. The report has each run's accuracy for minerals and rocks, its
calibration, every pair's accuracy when the two agree and when they do not,
and every specimen.
"""

from __future__ import annotations

import csv
import itertools
import sys
from pathlib import Path

from identify_spike import norm

sys.stdout.reconfigure(encoding="utf-8")

# The rock folders in fetch_commons.py; everything else is a mineral.
ROCKS = {"Granite", "Basalt", "Obsidian", "Sandstone", "Limestone", "Slate", "Conglomerate", "Gneiss", "Schist", "Porphyry (Andesite)"}


def yes(v: str) -> bool:
    return v == "True"


def first_name(candidates: str) -> str:
    """'Quartz (Amethyst) 0.93 | Fluorite 0.05' -> 'quartz'."""
    return norm(candidates.split(" | ")[0].rsplit(" ", 1)[0].split(" (")[0])


def pct(hits: int, total: int) -> str:
    return f"{hits}/{total} ({100 * hits / total:.0f}%)" if total else "n/a"


def main() -> int:
    root = Path(sys.argv[1])
    runs = {p.parent.name: list(csv.DictReader(p.open(encoding="utf-8"))) for p in sorted(root.glob("*/results.csv"))}
    by = {(run, r["photos"]): r for run, rows in runs.items() for r in rows if r["status"] == "ok"}
    specimens = sorted({(r["expected"], r["photos"]) for rows in runs.values() for r in rows})

    print("## Per run\n")
    print("| run | top-1 | top-3 | top-1 minerals | top-1 rocks | errors | $ / 1000 | s / ID |")
    print("|---|---|---|---|---|---|---|---|")
    for run, rows in runs.items():
        ok = [r for r in rows if r["status"] == "ok"]
        scored = [r for r in ok if r["expected"]]  # unnamed photos are answered, not scored
        mineral = [r for r in scored if r["expected"] not in ROCKS]
        rock = [r for r in scored if r["expected"] in ROCKS]
        cost = [float(r["cost_usd"]) for r in ok if r["cost_usd"]]
        secs = [float(r["seconds"]) for r in ok]
        print(f"| {run} | {pct(sum(yes(r['top1']) for r in scored), len(scored))} | {pct(sum(yes(r['top3']) for r in scored), len(scored))} | "
              f"{pct(sum(yes(r['top1']) for r in mineral), len(mineral))} | {pct(sum(yes(r['top1']) for r in rock), len(rock))} | "
              f"{len(rows) - len(ok)} | ${1000 * sum(cost) / max(len(cost), 1):.2f} | {sum(secs) / max(len(secs), 1):.1f} |")

    print("\n## Calibration: top-1 right, by the stated confidence\n")
    for run, rows in runs.items():
        bands: dict[str, list[int]] = {}
        for r in rows:
            if r["status"] == "ok":
                b = bands.setdefault(r["top1_band"], [0, 0])
                b[0] += yes(r["top1"])
                b[1] += 1
        print(f"- {run}: " + "; ".join(f"{k} {pct(*v)}" for k, v in sorted(bands.items())))

    print("\n## Pairs: right when the two agree, and when they do not\n")
    print("| pair | agree on top-1 | right when agreeing | disagreeing, either right at top-1 | either right in top-3 |")
    print("|---|---|---|---|---|")
    for a, b in itertools.combinations(runs, 2):
        n = agree = agree_right = dis = dis_either = union3 = 0
        for _, p in specimens:
            ra, rb = by.get((a, p)), by.get((b, p))
            if not (ra and rb):
                continue
            n += 1
            union3 += yes(ra["top3"]) or yes(rb["top3"])
            if first_name(ra["candidates"]) == first_name(rb["candidates"]):
                agree += 1
                agree_right += yes(ra["top1"])
            else:
                dis += 1
                dis_either += yes(ra["top1"]) or yes(rb["top1"])
        print(f"| {a} + {b} | {pct(agree, n)} | {pct(agree_right, agree)} | {pct(dis_either, dis)} | {pct(union3, n)} |")

    print("\n## Every specimen (✓ right first, ³ right in top 3, ✗ missed)\n")
    print("| expected | " + " | ".join(runs) + " |")
    print("|---|" + "---|" * len(runs))
    for exp, p in specimens:
        cells = []
        for run in runs:
            r = by.get((run, p))
            if not r:
                cells.append("error")
                continue
            mark = "" if not exp else "✓ " if yes(r["top1"]) else ("³ " if yes(r["top3"]) else "✗ ")
            cells.append(f"{mark}{r['candidates'].split(' | ')[0]}")
        print(f"| {exp or p} | " + " | ".join(cells) + " |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
