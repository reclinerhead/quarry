// POST /api/jobs/:id/confirm: the person puts a name on the stone. One of:
//   { pick: { model, rank } }    a pill (the candidate it stands for)
//   { typedName }                a name they typed
//   { sameAsSpecimenId }         another photo of the stone just named
// plus an optional `variety` (the variety or shop name) for the first two,
// which defaults to the pill's own. Finds or creates the mineral, creates the
// specimen with the job's notes and test answers, links the job's photos and
// writes the confirmation, in one transaction. Saves at once: there is no
// batch save.
//
// The confirmation records how the stone was named (#4): `source` (pill,
// typed, same_as_last), `how` (a pill is Jasper's suggestion, a typed name a
// guess until the person says otherwise, another photo inherits the stone's
// first naming) and `verdict`, what the screen said, recomputed here from the
// candidates rather than taken from the request.
//
// PATCH /api/jobs/:id/confirm { how }: "How do you know?" after the fact.
//
// DELETE /api/jobs/:id/confirm: "Change". Removes the confirmation, unlinks
// the photos, deletes the specimen if nothing else is attached to it and the
// mineral if no specimen is left. The job is back in the strip with its pills,
// which were never deleted.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { identifierSlug, nextWaitingJob, waitingJobIds, type ConfirmHow } from "@/lib/jobs";
import { norm } from "@/lib/names";
import { planPills, type Candidate } from "@/lib/pills";

export const dynamic = "force-dynamic";

const HOWS: ConfirmHow[] = ["label", "tests", "expert", "suggestion", "guess"];
const NAME_MAX = 120;

type Body = { pick?: { model?: unknown; rank?: unknown }; typedName?: unknown; variety?: unknown; sameAsSpecimenId?: unknown; how?: unknown };

function clean(s: unknown, max = NAME_MAX): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t.slice(0, max);
}

function jobIdFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function bodyOf(req: Request): Promise<Body | null> {
  try {
    return (await req.json()) as Body;
  } catch {
    return null;
  }
}

function open(): DatabaseSync | Response {
  try {
    return openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
}

function fail(db: DatabaseSync, err: unknown): Response {
  if (db.isTransaction) db.exec("ROLLBACK");
  return Response.json({ error: (err as Error).message }, { status: 500 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jobId = jobIdFrom((await ctx.params).id);
  if (!jobId) return Response.json({ error: "bad id" }, { status: 400 });
  const body = await bodyOf(req);
  if (!body) return Response.json({ error: "expected json" }, { status: 400 });
  const variety = clean(body.variety, 80);

  const db = open();
  if (db instanceof Response) return db;
  try {
    const job = db.prepare("SELECT status, next_attempt_at, notes, tests FROM jobs WHERE id = ?").get(jobId) as
      | { status: string; next_attempt_at: string | null; notes: string | null; tests: string }
      | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    const settled = job.status === "identified" || job.status === "rejected" || (job.status === "failed" && job.next_attempt_at === null);
    if (!settled) return Response.json({ error: `Jasper is still looking (${job.status})` }, { status: 409 });
    if (db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId)) return Response.json({ error: "already named" }, { status: 409 });

    const candidates = db
      .prepare("SELECT model, rank, name, variety, kind, confidence FROM candidates WHERE job_id = ?")
      .all(jobId) as Candidate[];
    const verdict = planPills(candidates, identifierSlug()).verdict;

    db.exec("BEGIN IMMEDIATE");
    let specimenId: number;
    let name: string;
    let stoneVariety: string | null;
    let source: "pill" | "typed" | "same_as_last";
    let how: ConfirmHow;

    if (body.sameAsSpecimenId !== undefined) {
      const sp = db
        .prepare("SELECT sp.id, m.name, sp.variety FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id WHERE sp.id = ?")
        .get(Number(body.sameAsSpecimenId)) as { id: number; name: string; variety: string | null } | undefined;
      if (!sp) {
        db.exec("ROLLBACK");
        return Response.json({ error: "no such stone" }, { status: 404 });
      }
      const first = db.prepare("SELECT how FROM confirmations WHERE specimen_id = ? ORDER BY confirmed_at, rowid LIMIT 1").get(sp.id) as
        | { how: ConfirmHow }
        | undefined;
      specimenId = sp.id;
      name = sp.name;
      stoneVariety = sp.variety;
      source = "same_as_last";
      how = first?.how ?? "guess";
    } else {
      let mineralName: string;
      let kind: Candidate["kind"] = "mineral";
      if (body.pick) {
        const c = candidates.find((x) => x.model === body.pick?.model && x.rank === Number(body.pick?.rank));
        if (!c) {
          db.exec("ROLLBACK");
          return Response.json({ error: "no such candidate" }, { status: 404 });
        }
        mineralName = c.name;
        kind = c.kind;
        stoneVariety = variety ?? c.variety;
        source = "pill";
        how = "suggestion";
      } else {
        const typed = clean(body.typedName);
        if (!typed) {
          db.exec("ROLLBACK");
          return Response.json({ error: "no name" }, { status: 400 });
        }
        // A typed name one of the models also gave keeps that candidate's
        // spelling and kind (rock or mineral); otherwise it is a mineral
        // until Phase 2's Mindat lookup says otherwise.
        const match = candidates.find((x) => norm(x.name) === norm(typed));
        mineralName = match ? match.name : typed.charAt(0).toUpperCase() + typed.slice(1);
        kind = match?.kind ?? "mineral";
        stoneVariety = variety;
        source = "typed";
        how = "guess";
      }
      // minerals.name is UNIQUE COLLATE NOCASE, so "galena" finds "Galena".
      db.prepare("INSERT INTO minerals (name, kind) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").run(mineralName, kind);
      const mineral = db.prepare("SELECT id, name FROM minerals WHERE name = ?").get(mineralName) as { id: number; name: string };
      const sp = db
        .prepare("INSERT INTO specimens (mineral_id, variety, notes, tests) VALUES (?, ?, ?, ?)")
        .run(mineral.id, stoneVariety, job.notes, job.tests);
      specimenId = Number(sp.lastInsertRowid);
      name = mineral.name;
    }

    db.prepare("UPDATE photos SET specimen_id = ? WHERE job_id = ?").run(specimenId, jobId);
    db.prepare("INSERT INTO confirmations (job_id, specimen_id, chosen_name, source, how, verdict) VALUES (?, ?, ?, ?, ?, ?)").run(
      jobId,
      specimenId,
      name,
      source,
      how,
      verdict,
    );
    db.exec("COMMIT");

    const nextJobId = nextWaitingJob(waitingJobIds(db), jobId);
    return Response.json({ specimenId, name, variety: stoneVariety, how, nextJobId }, { status: 201 });
  } catch (err) {
    return fail(db, err);
  } finally {
    db.close();
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jobId = jobIdFrom((await ctx.params).id);
  if (!jobId) return Response.json({ error: "bad id" }, { status: 400 });
  const body = await bodyOf(req);
  const how = body?.how;
  if (typeof how !== "string" || !HOWS.includes(how as ConfirmHow)) return Response.json({ error: "how must be one of " + HOWS.join(", ") }, { status: 400 });
  const db = open();
  if (db instanceof Response) return db;
  try {
    const res = db.prepare("UPDATE confirmations SET how = ? WHERE job_id = ?").run(how, jobId);
    if (Number(res.changes) === 0) return Response.json({ error: "not named" }, { status: 404 });
    return Response.json({ how });
  } catch (err) {
    return fail(db, err);
  } finally {
    db.close();
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jobId = jobIdFrom((await ctx.params).id);
  if (!jobId) return Response.json({ error: "bad id" }, { status: 400 });
  const db = open();
  if (db instanceof Response) return db;
  try {
    const conf = db.prepare("SELECT specimen_id FROM confirmations WHERE job_id = ?").get(jobId) as { specimen_id: number } | undefined;
    if (!conf) return Response.json({ error: "not named" }, { status: 404 });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM confirmations WHERE job_id = ?").run(jobId);
    db.prepare("UPDATE photos SET specimen_id = NULL WHERE job_id = ?").run(jobId);
    const left = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE specimen_id = ?").get(conf.specimen_id) as { n: number }).n;
    let removedStone = false;
    if (left === 0) {
      const sp = db.prepare("SELECT mineral_id FROM specimens WHERE id = ?").get(conf.specimen_id) as { mineral_id: number } | undefined;
      db.prepare("DELETE FROM specimens WHERE id = ?").run(conf.specimen_id);
      removedStone = true;
      if (sp) {
        const others = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE mineral_id = ?").get(sp.mineral_id) as { n: number }).n;
        if (others === 0) db.prepare("DELETE FROM minerals WHERE id = ?").run(sp.mineral_id);
      }
    }
    db.exec("COMMIT");
    return Response.json({ ok: true, removedStone });
  } catch (err) {
    return fail(db, err);
  } finally {
    db.close();
  }
}
