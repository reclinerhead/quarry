// PUT /api/cases/:id/stones: the stones in a show case (#81), as one list.
// `{ ids }` is the whole case in order, replacing what it had; `{ add }` puts
// stones not yet in it at the end, and `{ remove }` takes stones out, both
// over the order as it is. A stone in another case leaves it (a stone is in
// one case at a time). Every add, move, take-out, drop and the stone page's
// select come through here, so the order on disk is always exactly one list,
// written in one transaction. Answers `{ ok, ids }`, the case's order now.

import { parseId } from "@/lib/cases";
import { openReadWrite } from "@/lib/db";
import { caseStoneIds, hasCases } from "@/lib/specimens";

export const dynamic = "force-dynamic";

const MAX_STONES = 600;

/** A list of distinct positive integers, or null when it isn't one; undefined when not sent. */
function idList(v: unknown): number[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_STONES || !v.every((x) => Number.isInteger(x) && x > 0)) return null;
  return [...new Set(v as number[])];
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caseId = parseId((await ctx.params).id);
  if (!caseId) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const ids = idList(body.ids);
  const add = idList(body.add);
  const remove = idList(body.remove);
  if (ids === null || add === null || remove === null) return Response.json({ error: `ids, add and remove are lists of up to ${MAX_STONES} stone ids` }, { status: 400 });
  if (ids === undefined && add === undefined && remove === undefined) return Response.json({ error: "nothing to change" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasCases(db)) return Response.json({ error: "Jasper hasn’t set up the show cases yet" }, { status: 503 });
    db.exec("BEGIN IMMEDIATE");
    const current = caseStoneIds(db, caseId);
    if (current === null) {
      db.exec("ROLLBACK");
      return Response.json({ error: "no such case" }, { status: 404 });
    }
    let order = ids ?? current;
    if (remove) order = order.filter((x) => !remove.includes(x));
    if (add) order = [...order, ...add.filter((x) => !order.includes(x))];
    const isStone = db.prepare("SELECT 1 FROM specimens WHERE id = ?");
    const missing = order.filter((x) => !isStone.get(x));
    if (missing.length) {
      db.exec("ROLLBACK");
      return Response.json({ error: `not in the collection: ${missing.join(", ")}` }, { status: 400 });
    }
    db.prepare("DELETE FROM case_stones WHERE case_id = ?").run(caseId);
    const leave = db.prepare("DELETE FROM case_stones WHERE specimen_id = ?"); // out of any other case
    const put = db.prepare("INSERT INTO case_stones (case_id, specimen_id, position) VALUES (?, ?, ?)");
    order.forEach((stoneId, i) => {
      leave.run(stoneId);
      put.run(caseId, stoneId, i + 1);
    });
    db.exec("COMMIT");
    return Response.json({ ok: true, ids: order });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
