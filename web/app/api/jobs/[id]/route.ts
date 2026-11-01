// GET /api/jobs/:id: a job's state, its photos, and once Jasper has looked,
// the plan (verdict and pills), the tests the models suggested, and any
// naming. The add page and the confirm screen poll this every 1.5 s until
// Jasper is done (isSettled in lib/jobs.ts).

import { openReadOnly } from "@/lib/db";
import { readJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  const db = openReadOnly();
  if (!db) return Response.json({ error: "no database yet" }, { status: 503 });
  try {
    const job = readJob(db, jobId);
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    return Response.json(job, { headers: { "cache-control": "no-store" } });
  } finally {
    db.close();
  }
}
