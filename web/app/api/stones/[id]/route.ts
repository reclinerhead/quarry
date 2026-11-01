// PATCH /api/stones/:id: edit a stone's own facts, from its specimen label and
// its kitchen-table tests. Any subset of: variety, associates (other minerals
// on it), foundAt, acquired (found, bought, gifted, traded), acquiredOn
// (yyyy-mm-dd), location, notes, tests. An empty string clears a field.
//
// DELETE /api/stones/:id: remove the stone for good. Its photos go from the
// table and from disk with their thumbnails, and so do the jobs that brought
// them (otherwise an identified job with no naming would reappear in the
// pending strip; candidates and confirmations cascade). The mineral row goes
// too when no stone is left on it, as Change does on the confirm screen.

import { openReadWrite } from "@/lib/db";
import { cleanAnswers } from "@/lib/household-tests";
import { thumbPathFor } from "@/lib/photos";
import { discardUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ACQUIRED = new Set(["found", "bought", "gifted", "traded"]);

type Body = Record<string, unknown>;

/** A trimmed string of at most `max` characters, or null when blank; undefined when the field was not sent. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/[ \t]+/g, " ");
  return t.length === 0 ? null : t.slice(0, max);
}

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }

  const sets: string[] = [];
  const values: Array<string | null> = [];
  const set = (column: string, value: string | null | undefined) => {
    if (value === undefined) return;
    sets.push(`${column} = ?`);
    values.push(value);
  };
  set("variety", text(body.variety, 80));
  set("associates", text(body.associates, 120));
  set("found_at", text(body.foundAt, 120));
  set("location", text(body.location, 80));
  set("notes", text(body.notes, 1000));
  const acquired = text(body.acquired, 10);
  if (acquired !== undefined && acquired !== null && !ACQUIRED.has(acquired))
    return Response.json({ error: "acquired must be found, bought, gifted or traded" }, { status: 400 });
  set("acquired", acquired);
  const on = text(body.acquiredOn, 10);
  if (on !== undefined && on !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))))
    return Response.json({ error: "acquiredOn must be a date, yyyy-mm-dd" }, { status: 400 });
  set("acquired_on", on);
  if (body.tests !== undefined) set("tests", JSON.stringify(cleanAnswers(body.tests)));
  if (sets.length === 0) return Response.json({ error: "nothing to change" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const r = db.prepare(`UPDATE specimens SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (Number(r.changes) === 0) return Response.json({ error: "no such stone" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
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
    const sp = db.prepare("SELECT mineral_id FROM specimens WHERE id = ?").get(id) as { mineral_id: number } | undefined;
    if (!sp) return Response.json({ error: "no such stone" }, { status: 404 });
    const photos = db.prepare("SELECT path, job_id FROM photos WHERE specimen_id = ?").all(id) as Array<{ path: string; job_id: number | null }>;
    const named = db.prepare("SELECT job_id FROM confirmations WHERE specimen_id = ?").all(id) as Array<{ job_id: number }>;
    const jobIds = [...new Set([...photos.flatMap((p) => (p.job_id === null ? [] : [p.job_id])), ...named.map((c) => c.job_id)])];

    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM photos WHERE specimen_id = ?").run(id);
    const delJob = db.prepare("DELETE FROM jobs WHERE id = ?"); // candidates, suggested tests and confirmations cascade
    for (const j of jobIds) delJob.run(j);
    db.prepare("DELETE FROM specimens WHERE id = ?").run(id);
    const others = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE mineral_id = ?").get(sp.mineral_id) as { n: number }).n;
    if (others === 0) db.prepare("DELETE FROM minerals WHERE id = ?").run(sp.mineral_id);
    db.exec("COMMIT");

    for (const p of photos) {
      await discardUpload(p.path);
      await discardUpload(thumbPathFor(p.path));
    }
    return Response.json({ ok: true, photosRemoved: photos.length, mineralRemoved: others === 0 });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
