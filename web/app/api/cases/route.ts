// POST /api/cases: a new show case (#81), `{ name }`, at the end of the
// cases. Answers the row, `{ id, name }`. 503 until Jasper has run step 8.

import { MAX_NAME, text } from "@/lib/cases";
import { openReadWrite } from "@/lib/db";
import { hasCases } from "@/lib/specimens";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const name = text(body.name, MAX_NAME);
  if (!name) return Response.json({ error: "a case needs a name" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasCases(db)) return Response.json({ error: "Jasper hasn’t set up the show cases yet" }, { status: 503 });
    db.exec("BEGIN IMMEDIATE");
    const r = db.prepare("INSERT INTO cases (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM cases))").run(name);
    db.exec("COMMIT");
    return Response.json({ id: Number(r.lastInsertRowid), name });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
