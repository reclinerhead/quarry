// POST /api/jobs/:id/tests { tests, notes? }: "Ask Jasper again with these
// answers". Saves the kitchen-table answers (cleanAnswers: yes, no, or the
// streak's colour; a test not tried is left out) and the stone's note on the
// job, and sends it back to the queue as a fresh ask: attempts 0. Jasper says
// the answers to both models, and its identified or rejected outcome replaces
// the old candidates (docs/guide/jasper.md, Asking again). Refused once the
// job has been named, or while Jasper is looking at it, since its answer
// would land on top of the new question.

import { openReadWrite } from "@/lib/db";
import { cleanAnswers } from "@/lib/household-tests";
import { MAX_NOTES } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { tests?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const tests = cleanAnswers(body.tests);
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES) || null : undefined;

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    if (job.status === "identifying") return Response.json({ error: "Jasper is looking at it right now" }, { status: 409 });
    if (db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId)) return Response.json({ error: "already named" }, { status: 409 });
    db.prepare(
      `UPDATE jobs SET tests = ?, notes = CASE WHEN ? THEN ? ELSE notes END,
              status = 'queued', attempts = 0, next_attempt_at = NULL, finished_at = NULL, error = NULL
        WHERE id = ?`,
    ).run(JSON.stringify(tests), notes !== undefined ? 1 : 0, notes ?? null, jobId);
    return Response.json({ ok: true, tests });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
