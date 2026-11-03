// POST /api/jobs/:id/confirm: the person puts a name on the stone. One of:
//   { pick: { model, rank } }    a pill (the candidate it stands for)
//   { typedName }                a name they typed
// plus an optional `variety` (the variety or shop name), which defaults to
// the pill's own: none when the two opinions agreed on the stone but not its
// variety (#18), so a guess they disagreed on is never saved as though it
// were known. A pill also saves the other minerals on the piece (#29): its
// parts, and each of its one-opinion `maybe` minerals the person ticked, sent
// by name as `maybe: string[]`. A typed name saves none (the stone's page adds
// them). An optional `madeOf` (#62) is the mineral the object is made of, which
// defaults to the pill's own: none when the two opinions disagreed on it, so a
// guess they differed on is never saved as though it were known. An optional
// `form` (#73), one of FORMS or "" for none, is the shape of the piece as the
// person left the Form chips; left out, the pill's own is used. Finds or
// creates the minerals, creates the specimen with the job's
// notes and test answers, links the job's photos and writes the confirmation,
// in one transaction. Saves at once: there is no batch save.
//
// The confirmation records how the stone was named (#4): `source` (pill or
// typed; the schema's `same_as_last` is only on older stones, #60), `how` (a
// pill is Jasper's suggestion, a typed name a guess until the person says
// otherwise) and `verdict`, what the screen said, recomputed here from the
// candidates rather than taken from the request.
//
// PATCH /api/jobs/:id/confirm { how }: "How do you know?" after the fact.
//
// DELETE /api/jobs/:id/confirm: "Change". Removes the confirmation, unlinks
// the photos, deletes the specimen if nothing else is attached to it and each
// of its minerals no stone uses any more. The job is back in the strip with
// its pills, which were never deleted.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { candidatesOf, identifierSlug, nextWaitingJob, waitingJobIds, type ConfirmHow } from "@/lib/jobs";
import { norm } from "@/lib/names";
import { isForm, planPills, savedParts, type Candidate, type Form, type PartRole } from "@/lib/pills";
import { mineralId, pruneMinerals, stoneParts, writeMadeOf, writeParts } from "@/lib/specimens";

export const dynamic = "force-dynamic";

const HOWS: ConfirmHow[] = ["label", "tests", "expert", "suggestion", "guess"];
const NAME_MAX = 120;

type Body = {
  pick?: { model?: unknown; rank?: unknown };
  typedName?: unknown;
  variety?: unknown;
  maybe?: unknown;
  madeOf?: unknown;
  form?: unknown;
  how?: unknown;
};

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
  const madeOfTyped = clean(body.madeOf, 80);
  if (body.form !== undefined && body.form !== null && body.form !== "" && !isForm(body.form))
    return Response.json({ error: "form must be one of crystal, cluster, geode, druzy, rough, tumbled, slab, carved" }, { status: 400 });
  const formSent: Form | null | undefined = body.form === undefined ? undefined : isForm(body.form) ? body.form : null;
  const ticked = Array.isArray(body.maybe) ? body.maybe.flatMap((m) => clean(m) ?? []) : [];

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

    const candidates = candidatesOf(db, jobId);
    const plan = planPills(candidates, identifierSlug());
    const verdict = plan.verdict;

    db.exec("BEGIN IMMEDIATE");
    let stoneVariety: string | null;
    let source: "pill" | "typed";
    let how: ConfirmHow;
    let mineralName: string;
    let kind: Candidate["kind"] = "mineral";
    let parts: Array<{ role: PartRole; name: string }> = [];
    let madeOf: string | null = madeOfTyped;
    let form: Form | null = formSent ?? null;
    if (body.pick) {
      const c = candidates.find((x) => x.model === body.pick?.model && x.rank === Number(body.pick?.rank));
      if (!c) {
        db.exec("ROLLBACK");
        return Response.json({ error: "no such candidate" }, { status: 404 });
      }
      mineralName = c.name;
      kind = c.kind;
      const pill = plan.pills.find((p) => p.pick.model === c.model && p.pick.rank === c.rank);
      stoneVariety = variety ?? (pill ? pill.variety : c.variety);
      parts = pill ? savedParts(pill, ticked) : (c.parts ?? []);
      madeOf = madeOfTyped ?? (pill ? pill.madeOf : c.madeOf)?.name ?? null;
      form = formSent === undefined ? ((pill ? pill.form : c.form) ?? null) : formSent;
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
    const mineral = mineralId(db, mineralName, kind);
    const sp = db
      .prepare("INSERT INTO specimens (mineral_id, variety, notes, tests, form) VALUES (?, ?, ?, ?, ?)")
      .run(mineral, stoneVariety, job.notes, job.tests, form);
    const specimenId = Number(sp.lastInsertRowid);
    writeParts(db, specimenId, parts);
    writeMadeOf(db, specimenId, madeOf);
    const name = (db.prepare("SELECT name FROM minerals WHERE id = ?").get(mineral) as { name: string }).name;
    const made = db.prepare("SELECT m.name FROM specimens sp JOIN minerals m ON m.id = sp.made_of_id WHERE sp.id = ?").get(specimenId) as { name: string } | undefined;

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
    return Response.json({ specimenId, name, variety: stoneVariety, parts: stoneParts(db, specimenId), madeOf: made?.name ?? null, form, how, nextJobId }, { status: 201 });
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
      const minerals = db
        .prepare(
          `SELECT mineral_id FROM specimens WHERE id = ?
           UNION SELECT made_of_id FROM specimens WHERE id = ? AND made_of_id IS NOT NULL
           UNION SELECT mineral_id FROM specimen_parts WHERE specimen_id = ? AND mineral_id IS NOT NULL`,
        )
        .all(conf.specimen_id, conf.specimen_id, conf.specimen_id) as Array<{ mineral_id: number }>;
      db.prepare("DELETE FROM specimens WHERE id = ?").run(conf.specimen_id); // its parts cascade
      removedStone = true;
      pruneMinerals(db, minerals.map((m) => m.mineral_id));
    }
    db.exec("COMMIT");
    return Response.json({ ok: true, removedStone });
  } catch (err) {
    return fail(db, err);
  } finally {
    db.close();
  }
}
