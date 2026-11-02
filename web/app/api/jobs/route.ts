// POST /api/jobs { photoIds, notes? }: one rock in, one queued job out.
//
// The add page sends a rock's photos first (POST /api/photos, each without a
// job), then this: the job carrying the rock's note, and every photo linked to
// it, in one transaction. Jasper only ever sees the whole rock. At most five
// photos, Jasper's MAX_IMAGES. If every photo is already on one job, that job
// is the answer, so a retry whose first response was lost gets the same job
// rather than a second one or an error.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { MAX_NOTES } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 5;

export async function POST(req: Request) {
  let body: { photoIds?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const ids = body.photoIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length)
    return Response.json({ error: "photoIds must be distinct photo ids" }, { status: 400 });
  if (ids.length > MAX_PHOTOS) return Response.json({ error: "five photos is the most Jasper looks at" }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES) || null : null;

  let db: DatabaseSync;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const marks = ids.map(() => "?").join(", ");
    db.exec("BEGIN IMMEDIATE");
    const rows = db.prepare(`SELECT job_id, specimen_id FROM photos WHERE id IN (${marks})`).all(...ids) as Array<{
      job_id: number | null;
      specimen_id: number | null;
    }>;
    if (rows.length < ids.length) {
      db.exec("ROLLBACK");
      return Response.json({ error: "some of these photos are gone" }, { status: 404 });
    }
    const jobs = new Set(rows.map((r) => r.job_id));
    if (rows.some((r) => r.specimen_id !== null)) {
      db.exec("ROLLBACK");
      return Response.json({ error: "already on a stone" }, { status: 409 });
    }
    if (!jobs.has(null)) {
      db.exec("ROLLBACK");
      if (jobs.size === 1) return Response.json({ jobId: [...jobs][0] }); // the retry of a job already made
      return Response.json({ error: "these photos are on different jobs" }, { status: 409 });
    }
    if (jobs.size > 1) {
      db.exec("ROLLBACK");
      return Response.json({ error: "some of these photos are already on a job" }, { status: 409 });
    }
    const jobId = Number(db.prepare("INSERT INTO jobs (notes) VALUES (?)").run(notes).lastInsertRowid);
    db.prepare(`UPDATE photos SET job_id = ? WHERE id IN (${marks})`).run(jobId, ...ids);
    db.exec("COMMIT");
    return Response.json({ jobId }, { status: 201 });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
