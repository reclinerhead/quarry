// POST /api/jobs/:id/photos: another photo of the same stone ("Add another
// photo of this stone"). Stores the file, adds a photos row to the job, and
// sends the job back to the queue so Jasper asks again with every photo (at
// most five, Jasper's MAX_IMAGES). The old pills stay until the new ones
// replace them. Refused once the job has been named, or while Jasper is
// looking at it.

import { openReadWrite } from "@/lib/db";
import { checkUpload, discardUpload, storeUpload, takenAtFrom } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 5;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const check = checkUpload(form);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  const takenAt = takenAtFrom(form);

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  let rel: string | null = null;
  try {
    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    if (job.status === "identifying") return Response.json({ error: "Jasper is looking at it right now" }, { status: 409 });
    if (db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId)) return Response.json({ error: "already named" }, { status: 409 });
    const count = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE job_id = ?").get(jobId) as { n: number }).n;
    if (count >= MAX_PHOTOS) return Response.json({ error: "five photos is the most Jasper looks at" }, { status: 409 });

    rel = await storeUpload(check.file);
    db.exec("BEGIN IMMEDIATE");
    const photo = db.prepare("INSERT INTO photos (path, taken_at, job_id) VALUES (?, ?, ?)").run(rel, takenAt, jobId);
    db.prepare("UPDATE jobs SET status = 'queued', attempts = 0, next_attempt_at = NULL, finished_at = NULL, error = NULL WHERE id = ?").run(jobId);
    db.exec("COMMIT");
    return Response.json({ photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    if (rel) await discardUpload(rel);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
