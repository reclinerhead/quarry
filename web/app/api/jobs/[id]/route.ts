// GET /api/jobs/:id: a job's state and its photos. The add page polls this
// every 1.5 s until Jasper has looked; the confirm screen (#8) adds the
// candidates and the verdict.
//
// A failed job with a next_attempt_at is one Jasper will try again (backoff);
// one without is failed for good, so the page stops waiting for it.

import { openReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export type JobView = {
  id: number;
  status: "queued" | "identifying" | "identified" | "rejected" | "failed";
  error: string | null;
  nextAttemptAt: string | null;
  notes: string | null;
  photos: Array<{ id: number; url: string; takenAt: string | null }>;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  const db = openReadOnly();
  if (!db) return Response.json({ error: "no database yet" }, { status: 503 });
  try {
    const job = db.prepare("SELECT id, status, error, next_attempt_at, notes FROM jobs WHERE id = ?").get(jobId) as
      | { id: number; status: JobView["status"]; error: string | null; next_attempt_at: string | null; notes: string | null }
      | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    const photos = db.prepare("SELECT id, path, taken_at FROM photos WHERE job_id = ? ORDER BY id").all(jobId) as Array<{
      id: number;
      path: string;
      taken_at: string | null;
    }>;
    const view: JobView = {
      id: job.id,
      status: job.status,
      error: job.error,
      nextAttemptAt: job.next_attempt_at,
      notes: job.notes,
      photos: photos.map((p) => ({ id: p.id, url: `/media/${p.path}`, takenAt: p.taken_at })),
    };
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } finally {
    db.close();
  }
}
