"""Fetch a set of known specimens from Wikimedia Commons, for scoring without a family that knows the names.

    python fetch_commons.py                 # list what it would pick
    python fetch_commons.py --download      # save them to photos-commons/

Minerals are single-mineral catalog photos named like "Galena-186570.jpg", most
from Rob Lavinsky's iRocks archive (CC BY-SA). Rocks are James St. John's
hand-sample photos titled "<Rock> (<formation; place>)" (CC BY). Each pick is
saved as photos-commons/<expected name>/<n>.jpg, resized by Commons to 1280 px
where the original is larger (most catalog photos are about 600 px), and every
file's page, author and license go to photos-commons/sources.csv. Look over
what it picked before scoring: a search can return a shop photo or an outcrop.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "QuarrySpike/0.1 (https://github.com/reclinerhead/quarry; family hobby project)"
API = "https://commons.wikimedia.org/w/api.php"
OUT = Path(__file__).parent / "photos-commons"

# (folder name the scorer reads, title to search, how many). Two each of the
# lookalikes that trip people up; one each of the rest.
MINERALS = [
    ("Quartz", "Quartz", 2), ("Calcite", "Calcite", 2), ("Fluorite", "Fluorite", 2),
    ("Pyrite", "Pyrite", 2), ("Chalcopyrite", "Chalcopyrite", 2), ("Marcasite", "Marcasite", 1),
    ("Galena", "Galena", 2), ("Sphalerite", "Sphalerite", 2), ("Hematite", "Hematite", 1),
    ("Magnetite", "Magnetite", 1), ("Dolomite", "Dolomite", 1), ("Baryte (Barite)", "Baryte", 1),
    ("Celestine", "Celestine", 1), ("Gypsum (Selenite)", "Gypsum", 1), ("Malachite", "Malachite", 1),
    ("Bornite", "Bornite", 1), ("Microcline", "Microcline", 1), ("Muscovite", "Muscovite", 1),
    ("Almandine (Garnet)", "Almandine", 1), ("Schorl (Tourmaline)", "Schorl", 1), ("Smithsonite", "Smithsonite", 1),
]
ROCKS = [
    ("Granite", "Granite", 1), ("Basalt", "Basalt", 1), ("Obsidian", "Obsidian", 1),
    ("Sandstone", "Sandstone", 1), ("Limestone", "Limestone", 1), ("Slate", "Slate", 1),
    ("Conglomerate", "Conglomerate", 1), ("Gneiss", "Gneiss", 1), ("Schist", "Schist", 1),
    ("Porphyry (Andesite)", "Porphyritic andesite", 1),
]


def api(params: dict) -> dict:
    params = {"format": "json", "formatversion": "2", **params}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def plain(s: str | None) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def picks(term: str, n: int, rock: bool) -> list[tuple[str, dict]]:
    """The n largest usable photos among the first 25 search hits."""
    query = f'intitle:/^{term} \\(/ "James St. John"' if rock else f"intitle:/^{term}-[0-9]+\\.jpg$/"
    hits = api({"action": "query", "list": "search", "srnamespace": "6", "srlimit": "25", "srsearch": query})
    titles = [h["title"] for h in hits["query"]["search"]]
    if not titles:
        return []
    pages = api({"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
                 "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "1280"})["query"]["pages"]
    meta = {p["title"]: p["imageinfo"][0] for p in pages if p.get("imageinfo")}
    chosen = []
    for t in sorted(meta, key=lambda t: -meta[t]["width"] * meta[t]["height"]):
        ii = meta[t]
        if ii.get("mime") != "image/jpeg" or min(ii["width"], ii["height"]) < 380:
            continue
        # outcrops and roadcuts are not hand specimens
        if rock and re.search(r"outcrop|roadcut|cliff|quarry wall|exposure|unconformity|contact", t, re.I):
            continue
        chosen.append((t, ii))
        if len(chosen) == n:
            break
    return chosen


def main() -> int:
    download = "--download" in sys.argv
    rows = []
    for rock, targets in ((False, MINERALS), (True, ROCKS)):
        for folder, term, n in targets:
            chosen = picks(term, n, rock)
            if len(chosen) < n:
                print(f"!! {folder}: found {len(chosen)} of {n}")
            for i, (title, ii) in enumerate(chosen, 1):
                em = ii.get("extmetadata", {})
                artist = plain(em.get("Artist", {}).get("value"))
                lic = plain(em.get("LicenseShortName", {}).get("value"))
                print(f"{folder:24} {title[5:][:70]:70} | {artist[:24]:24} | {lic}")
                if download:
                    dest = OUT / folder / f"{re.sub(r'[^A-Za-z0-9]+', '-', folder).strip('-').lower()}-{i}.jpg"
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    req = urllib.request.Request(ii.get("thumburl") or ii["url"], headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        dest.write_bytes(r.read())
                    rows.append({"folder": folder, "file": dest.name, "page": ii["descriptionurl"], "artist": artist, "license": lic})
                    time.sleep(0.5)  # be gentle with Commons
            time.sleep(0.3)
    if download:
        with (OUT / "sources.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["folder", "file", "page", "artist", "license"])
            w.writeheader()
            w.writerows(rows)
        print(f"\nsaved {len(rows)} photos to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
