// GET /api/cover: this week's cover stone, for the Quarry's tile on the
// station launcher (reclinerhead/aviary#696). Answers { src, caption, credit }:
// a same-origin path to the stone's full-size photo, its name as its card
// shows it, and a credit that is always null here (the field belongs to the
// shape the three apps share). Every stone with a photo is a candidate, each
// by the photo it is known by; rocks still waiting for a name are jobs, not
// stones, and never appear. No database yet, or no stone with a photo, is a
// quiet three nulls with a 200, and the launcher keeps its default photo.

import { pickCover } from "@/lib/cover";
import { openReadOnly } from "@/lib/db";
import { pieceName } from "@/lib/pills";
import { collectionTiles, mainPhotoUrls } from "@/lib/specimens";

export const dynamic = "force-dynamic";

function cover(src: string | null = null, caption: string | null = null) {
  return Response.json({ src, caption, credit: null }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const db = openReadOnly();
  if (!db) return cover();
  try {
    const photos = mainPhotoUrls(db);
    const pick = pickCover(
      collectionTiles(db).filter((t) => photos.has(t.id)),
      new Date(),
    );
    return pick ? cover(photos.get(pick.id), pieceName(pick)) : cover();
  } finally {
    db.close();
  }
}
