// GET /api/cover: this week's cover stone, for the Quarry's tile on the
// station launcher (reclinerhead/aviary#696). Answers { src, caption, credit }:
// a same-origin path to the stone's photo, its name as its card shows it, and
// a credit that is always null here (the field belongs to the shape the three
// apps share). The photo is the cover-sized copy Jasper writes beside each
// one (#136: 960 px on its short side, a sixth of the original's bytes, for a
// launcher read over a station's uplink), or the original while that copy is
// not there yet. Every stone with a photo is a candidate, each by the photo
// it is known by; rocks still waiting for a name are jobs, not stones, and
// never appear. No database yet, or no stone with a photo, is a quiet three
// nulls with a 200, and the launcher keeps its default photo.

import { promises as fs } from "node:fs";
import path from "node:path";
import { BASE_PATH } from "@/lib/base-path";
import { pickCover } from "@/lib/cover";
import { dataDir, openReadOnly } from "@/lib/db";
import { coverPathFor } from "@/lib/photos";
import { pieceName } from "@/lib/pills";
import { collectionTiles, mainPhotoPaths } from "@/lib/specimens";

export const dynamic = "force-dynamic";

function cover(src: string | null = null, caption: string | null = null) {
  return Response.json({ src, caption, credit: null }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const db = openReadOnly();
  if (!db) return cover();
  let rel: string;
  let caption: string;
  try {
    const photos = mainPhotoPaths(db);
    const pick = pickCover(
      collectionTiles(db).filter((t) => photos.has(t.id)),
      new Date(),
    );
    if (!pick) return cover();
    rel = photos.get(pick.id)!;
    caption = pieceName(pick);
  } finally {
    db.close();
  }
  const sized = coverPathFor(rel);
  const hasSized = await fs.access(path.join(dataDir(), sized)).then(
    () => true,
    () => false,
  );
  return cover(`${BASE_PATH}/media/${hasSized ? sized : rel}`, caption);
}
