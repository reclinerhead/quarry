// POST /api/photos: one photo in, one queued job out.
//
// multipart fields: `file` (the image, already shrunk by the browser when it
// could), `notes` (the batch's "Anything you know about these?", optional),
// `takenAt` (ISO, from the original's EXIF, optional). The file is written
// under QUARRY_DATA as photos/yyyy/mm/<uuid>.<ext>, then a jobs row carrying
// the note and a photos row are inserted in one transaction. Jasper picks the
// job up from there. The database is opened first, so a missing one costs no
// file, and a file whose rows fail to go in is removed.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { checkUpload, discardUpload, notesFrom, storeUpload, takenAtFrom } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const check = checkUpload(form);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  const notes = notesFrom(form);
  const takenAt = takenAtFrom(form);

  let db: DatabaseSync;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  let rel: string | null = null;
  try {
    rel = await storeUpload(check.file);
    db.exec("BEGIN IMMEDIATE");
    const job = db.prepare("INSERT INTO jobs (notes) VALUES (?)").run(notes);
    const jobId = Number(job.lastInsertRowid);
    const photo = db.prepare("INSERT INTO photos (path, taken_at, job_id) VALUES (?, ?, ?)").run(rel, takenAt, jobId);
    db.exec("COMMIT");
    return Response.json({ jobId, photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    if (rel) await discardUpload(rel);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
