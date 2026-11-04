// PATCH /api/stones/:id: edit a stone's own facts, from its specimen label and
// its kitchen-table tests. Any subset of: variety, parts (the other minerals on
// it, #29: `{ with: string[], on: string | null }`, where `on` may be "matrix";
// it replaces them all), madeOf (what an object that is not a mineral is made
// of, #62), form (the shape of the piece, #73, one of FORMS), foundAt,
// acquired (found, bought, gifted, traded), acquiredOn (yyyy-mm-dd), location,
// notes, tests, heroPhotoId (the photo the stone is known by, #84: one of its
// own photos, or null for the newest). An empty string clears a field.
//
// DELETE /api/stones/:id: remove the stone for good. Its photos go from the
// table and from disk with their thumbnails, and so do the jobs that brought
// them (otherwise an identified job with no naming would reappear in the
// pending strip; candidates and confirmations cascade). Each of its minerals
// goes too when no stone uses it any more, as Change does on the confirm screen.

import { openReadWrite } from "@/lib/db";
import { cleanAnswers } from "@/lib/household-tests";
import { thumbPathFor } from "@/lib/photos";
import { isForm, type PartRole } from "@/lib/pills";
import { pruneMinerals, writeMadeOf, writeParts } from "@/lib/specimens";
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

/** The stone's other minerals as sent, in label order; undefined when not sent, null when malformed. */
function partsOf(v: unknown): Array<{ role: PartRole; name: string }> | null | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return null;
  const { with: withs = [], on = null } = v as { with?: unknown; on?: unknown };
  if (!Array.isArray(withs) || withs.length > MAX_PARTS || !withs.every((w) => typeof w === "string") || (on !== null && typeof on !== "string"))
    return null;
  return [...withs.map((name: string) => ({ role: "with" as const, name })), ...(on ? [{ role: "on" as const, name: on }] : [])];
}

const MAX_PARTS = 8;

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
  set("found_at", text(body.foundAt, 120));
  set("location", text(body.location, 80));
  set("notes", text(body.notes, 1000));
  const acquired = text(body.acquired, 10);
  if (acquired !== undefined && acquired !== null && !ACQUIRED.has(acquired))
    return Response.json({ error: "acquired must be found, bought, gifted or traded" }, { status: 400 });
  set("acquired", acquired);
  const form = text(body.form, 10);
  if (form !== undefined && form !== null && !isForm(form))
    return Response.json({ error: "form must be one of crystal, cluster, geode, druzy, rough, tumbled, slab, carved" }, { status: 400 });
  set("form", form);
  const on = text(body.acquiredOn, 10);
  if (on !== undefined && on !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))))
    return Response.json({ error: "acquiredOn must be a date, yyyy-mm-dd" }, { status: 400 });
  set("acquired_on", on);
  if (body.tests !== undefined) set("tests", JSON.stringify(cleanAnswers(body.tests)));
  const parts = partsOf(body.parts);
  if (parts === null) return Response.json({ error: `parts must be { with: up to ${MAX_PARTS} names, on: a name or null }` }, { status: 400 });
  const madeOf = text(body.madeOf, 80);
  const hero = body.heroPhotoId;
  if (hero !== undefined && hero !== null && !(Number.isInteger(hero) && (hero as number) > 0))
    return Response.json({ error: "heroPhotoId must be a photo id or null" }, { status: 400 });
  if (sets.length === 0 && parts === undefined && madeOf === undefined && hero === undefined)
    return Response.json({ error: "nothing to change" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!db.prepare("SELECT 1 FROM specimens WHERE id = ?").get(id)) return Response.json({ error: "no such stone" }, { status: 404 });
    if (typeof hero === "number" && !db.prepare("SELECT 1 FROM photos WHERE id = ? AND specimen_id = ?").get(hero, id))
      return Response.json({ error: "not a photo of this stone" }, { status: 400 });
    db.exec("BEGIN IMMEDIATE");
    if (sets.length > 0) db.prepare(`UPDATE specimens SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (hero !== undefined) db.prepare("UPDATE specimens SET hero_photo_id = ? WHERE id = ?").run(hero as number | null, id);
    if (parts !== undefined) pruneMinerals(db, writeParts(db, id, parts));
    if (madeOf !== undefined) pruneMinerals(db, writeMadeOf(db, id, madeOf));
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
    const sp = db.prepare("SELECT mineral_id, made_of_id FROM specimens WHERE id = ?").get(id) as { mineral_id: number; made_of_id: number | null } | undefined;
    if (!sp) return Response.json({ error: "no such stone" }, { status: 404 });
    const photos = db.prepare("SELECT path, job_id FROM photos WHERE specimen_id = ?").all(id) as Array<{ path: string; job_id: number | null }>;
    const named = db.prepare("SELECT job_id FROM confirmations WHERE specimen_id = ?").all(id) as Array<{ job_id: number }>;
    const jobIds = [...new Set([...photos.flatMap((p) => (p.job_id === null ? [] : [p.job_id])), ...named.map((c) => c.job_id)])];
    const parts = db.prepare("SELECT mineral_id FROM specimen_parts WHERE specimen_id = ? AND mineral_id IS NOT NULL").all(id) as Array<{ mineral_id: number }>;

    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM photos WHERE specimen_id = ?").run(id);
    const delJob = db.prepare("DELETE FROM jobs WHERE id = ?"); // candidates, suggested tests and confirmations cascade
    for (const j of jobIds) delJob.run(j);
    db.prepare("DELETE FROM specimens WHERE id = ?").run(id); // its parts cascade
    const mineralsRemoved = pruneMinerals(db, [sp.mineral_id, ...(sp.made_of_id === null ? [] : [sp.made_of_id]), ...parts.map((p) => p.mineral_id)]);
    db.exec("COMMIT");

    for (const p of photos) {
      await discardUpload(p.path);
      await discardUpload(thumbPathFor(p.path));
    }
    return Response.json({ ok: true, photosRemoved: photos.length, mineralsRemoved });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
