// POST /api/photos: one photo of the rock being sent, stored without a job.
//
// multipart fields: `file` (the image, already shrunk by the browser when it
// could) and `takenAt` (ISO, from the original's EXIF, optional). The file is
// written under QUARRY_DATA as photos/yyyy/mm/<uuid>.<ext> and a photos row
// with no job goes in. Once all of a rock's photos are in, POST /api/jobs
// makes the job from them, so Jasper never starts on half a rock. The database
// is opened first, so a missing one costs no file, and a file whose row fails
// to go in is removed.
//
// Photos whose rock never got its job (the phone died, the page closed) belong
// to neither a job nor a stone. Each upload first clears those more than a day
// old; a sweep that fails never fails the upload.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { thumbPathFor } from "@/lib/photos";
import { checkUpload, discardUpload, storeUpload, takenAtFrom } from "@/lib/storage";

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
  const takenAt = takenAtFrom(form);

  let db: DatabaseSync;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  let rel: string | null = null;
  try {
    await sweepStrays(db);
    rel = await storeUpload(check.file);
    const photo = db.prepare("INSERT INTO photos (path, taken_at) VALUES (?, ?)").run(rel, takenAt);
    return Response.json({ photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
  } catch (err) {
    if (rel) await discardUpload(rel);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}

async function sweepStrays(db: DatabaseSync): Promise<void> {
  try {
    const stray = db
      .prepare(
        `DELETE FROM photos
          WHERE job_id IS NULL AND specimen_id IS NULL
            AND uploaded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
          RETURNING path`,
      )
      .all() as Array<{ path: string }>;
    for (const { path } of stray) {
      await discardUpload(path);
      await discardUpload(thumbPathFor(path));
    }
  } catch {
    /* tidying up, never the upload's business */
  }
}
