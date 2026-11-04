// PATCH /api/cases/:id: rename a show case (#81), change its note, or move it
// among the cases: any of `name`, `note` (an empty string clears it) and
// `position` (1-based; the others close the gap). DELETE /api/cases/:id removes
// the case; its stones stay in the collection (case_stones cascades).

import { MAX_NAME, MAX_NOTE, parseId, text } from "@/lib/cases";
import { openReadWrite } from "@/lib/db";
import { hasCases } from "@/lib/specimens";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const name = text(body.name, MAX_NAME);
  if (name === null) return Response.json({ error: "a case needs a name" }, { status: 400 });
  const note = text(body.note, MAX_NOTE);
  const position = body.position === undefined ? undefined : Number(body.position);
  if (position !== undefined && (!Number.isInteger(position) || position < 1)) return Response.json({ error: "position must be 1 or more" }, { status: 400 });
  if (name === undefined && note === undefined && position === undefined) return Response.json({ error: "nothing to change" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasCases(db)) return Response.json({ error: "Jasper hasn’t set up the show cases yet" }, { status: 503 });
    db.exec("BEGIN IMMEDIATE");
    if (!db.prepare("SELECT 1 FROM cases WHERE id = ?").get(id)) {
      db.exec("ROLLBACK");
      return Response.json({ error: "no such case" }, { status: 404 });
    }
    if (name !== undefined) db.prepare("UPDATE cases SET name = ? WHERE id = ?").run(name, id);
    if (note !== undefined) db.prepare("UPDATE cases SET note = ? WHERE id = ?").run(note, id);
    if (position !== undefined) {
      // Renumber every case 1..n with this one at `position` (clamped to the end).
      const ids = (db.prepare("SELECT id FROM cases ORDER BY position, id").all() as Array<{ id: number }>).map((r) => r.id).filter((x) => x !== id);
      ids.splice(Math.min(position - 1, ids.length), 0, id);
      const set = db.prepare("UPDATE cases SET position = ? WHERE id = ?");
      ids.forEach((caseId, i) => set.run(i + 1, caseId));
    }
    db.exec("COMMIT");
    return Response.json({ ok: true });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasCases(db)) return Response.json({ error: "Jasper hasn’t set up the show cases yet" }, { status: 503 });
    const r = db.prepare("DELETE FROM cases WHERE id = ?").run(id); // its stones' rows cascade; the stones stay
    if (Number(r.changes) === 0) return Response.json({ error: "no such case" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
