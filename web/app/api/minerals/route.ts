// GET /api/minerals?q=: the name field's autocomplete. The minerals and rocks
// already in the collection with how many stones each has, ordered by
// rankMinerals (lib/minerals.ts).

import { openReadOnly } from "@/lib/db";
import { rankMinerals, type MineralHit } from "@/lib/minerals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const db = openReadOnly();
  if (!db) return Response.json([]);
  try {
    const rows = db
      .prepare(
        `SELECT m.id, m.name, m.kind, COUNT(sp.id) AS stones
           FROM minerals m LEFT JOIN specimens sp ON sp.mineral_id = m.id
          GROUP BY m.id`,
      )
      .all() as MineralHit[];
    return Response.json(rankMinerals(rows, q.slice(0, 60)), { headers: { "cache-control": "no-store" } });
  } finally {
    db.close();
  }
}
