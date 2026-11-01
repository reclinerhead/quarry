// POST /api/jobs/:id/dismiss: "Not a rock". The photo has no business in the
// collection, so the job, its candidates and suggested tests (by cascade), its
// photo rows, the files and their thumbnails go. Refused once the job has been
// named (use Change first).

import { openReadWrite } from "@/lib/db";
import { nextWaitingJob, waitingJobIds } from "@/lib/jobs";
import { thumbPathFor } from "@/lib/photos";
import { discardUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId)) return Response.json({ error: "no such job" }, { status: 404 });
    if (db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId)) return Response.json({ error: "already named" }, { status: 409 });
    const paths = (db.prepare("SELECT path FROM photos WHERE job_id = ?").all(jobId) as Array<{ path: string }>).map((r) => r.path);
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM photos WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId); // candidates and suggested tests cascade
    db.exec("COMMIT");
    for (const p of paths) {
      await discardUpload(p);
      await discardUpload(thumbPathFor(p));
    }
    const nextJobId = nextWaitingJob(waitingJobIds(db), jobId);
    return Response.json({ ok: true, nextJobId });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
