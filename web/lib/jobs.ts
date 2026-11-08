// Reading jobs for the confirm screen, the pending strip and the jobs API.
// Server only, except nextWaitingJob, which is pure.

import { BASE_PATH } from "./base-path";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, openReadOnly } from "./db";
import { cleanAnswers, suggestedOrder, type Answers, type TestKind } from "./household-tests";
import type { JobStatus } from "./job-state";
import { chainOf, MAX_DEPTH, type MindatRecord } from "./names";
import type { ConfirmHow } from "./naming";
import { thumbPathFor } from "./photos";
import { isForm, parseParts, planPills, type Candidate, type Form, type Plan } from "./pills";
import { stoneParts, type StonePart } from "./specimens";

export type { ConfirmHow };

export type JobView = {
  id: number;
  status: JobStatus;
  error: string | null;
  nextAttemptAt: string | null;
  notes: string | null;
  tests: Answers;
  labelText: string | null;
  photos: Array<{ id: number; url: string; thumbUrl: string; takenAt: string | null }>;
  plan: Plan;
  suggestedTests: Array<{ kind: TestKind; how: string; expected: string }>;
  confirmation: {
    specimenId: number;
    name: string;
    variety: string | null;
    parts: StonePart[];
    madeOf: string | null; // what the stone is made of (#62), a minerals row's name
    form: Form | null; // the shape of the piece (#73)
    how: ConfirmHow;
    source: "pill" | "typed" | "same_as_last";
    confirmedAt: string;
  } | null;
};

/**
 * The model whose opinion leads, as Jasper is configured (#7): its first
 * choice is the first pill when the two disagree. Read at runtime with the
 * same default as Jasper's QUARRY_IDENTIFIER.
 */
export function identifierSlug(): string {
  return process.env["QUARRY_IDENTIFIER"] ?? "anthropic/claude-haiku-5.5";
}

/**
 * A job's candidates, each with its Mindat chain (#18) when Jasper looked it
 * up: the record from `candidates.mindat_id`, then each `varietyof` above it in
 * the cache. Jasper writes the chain whole before the candidate, so a missing
 * record only shortens it. Each of a candidate's parts (#29) gets its chain the
 * same way, from the `mindat_id` in its `parts` JSON, and so does what the
 * object is made of (#62), from `made_of_mindat_id`.
 */
export function candidatesOf(db: DatabaseSync, jobId: number): Candidate[] {
  const rows = (
    db
      .prepare(
        "SELECT model, rank, name, variety, kind, confidence, mindat_id, parts, made_of, made_of_mindat_id, features, form FROM candidates WHERE job_id = ? ORDER BY model, rank",
      )
      .all(jobId) as Array<
      Omit<Candidate, "chain" | "parts" | "madeOf" | "features" | "form"> & {
        mindat_id: number | null;
        parts: string | null;
        made_of: string | null;
        made_of_mindat_id: number | null;
        features: string | null;
        form: string | null;
      }
    >
  ).map((r) => ({ ...r, parts: parseParts(r.parts) }));
  const seeds = rows.flatMap((r) => [r.mindat_id, ...r.parts.map((p) => p.mindatId), r.made_of_mindat_id]).filter((id) => id !== null);
  const records = db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT value, 1 FROM json_each(?)
         UNION
         SELECT r.varietyof, up.depth + 1 FROM up JOIN mindat_records r ON r.id = up.id
          WHERE r.varietyof IS NOT NULL AND up.depth < ?)
       SELECT id, name, varietyof, hmin, hmax FROM mindat_records WHERE id IN (SELECT id FROM up)`,
    )
    .all(JSON.stringify([...new Set(seeds)]), MAX_DEPTH) as Array<MindatRecord & { varietyof: number | null }>;
  const byId = new Map(records.map((r) => [r.id, r]));
  // Plain objects: node:sqlite rows have a null prototype, which React refuses to pass to a client component.
  return rows.map((r) => ({
    model: r.model,
    rank: r.rank,
    name: r.name,
    variety: r.variety,
    kind: r.kind,
    confidence: r.confidence,
    chain: chainOf(r.mindat_id, byId),
    parts: r.parts.map((p) => ({ role: p.role, name: p.name, chain: chainOf(p.mindatId, byId) })),
    madeOf: r.made_of ? { name: r.made_of, chain: chainOf(r.made_of_mindat_id, byId) } : null,
    features: parseFeatures(r.features),
    form: isForm(r.form) ? r.form : null,
  }));
}

/** A candidate's `features` column (a JSON array of short phrases, as Jasper writes it); anything malformed is none. */
function parseFeatures(json: string | null): string[] {
  try {
    const raw: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim()) : [];
  } catch {
    return [];
  }
}

export function readJob(db: DatabaseSync, jobId: number): JobView | null {
  const job = db
    .prepare("SELECT id, status, error, next_attempt_at, notes, tests, label_text FROM jobs WHERE id = ?")
    .get(jobId) as
    | { id: number; status: JobView["status"]; error: string | null; next_attempt_at: string | null; notes: string | null; tests: string; label_text: string | null }
    | undefined;
  if (!job) return null;
  const photos = db.prepare("SELECT id, path, taken_at FROM photos WHERE job_id = ? ORDER BY id").all(jobId) as Array<{
    id: number;
    path: string;
    taken_at: string | null;
  }>;
  const candidates = candidatesOf(db, jobId);
  const answers = cleanAnswers(job.tests);
  const tests = db
    .prepare("SELECT model, rank, kind, how, expected FROM suggested_tests WHERE job_id = ? ORDER BY model, rank")
    .all(jobId) as Array<{ model: string; rank: number; kind: TestKind; how: string; expected: string }>;
  const conf = db
    .prepare(
      `SELECT c.specimen_id, c.how, c.source, c.confirmed_at, m.name, sp.variety, mo.name AS made_of, sp.form
         FROM confirmations c
         JOIN specimens sp ON sp.id = c.specimen_id
         JOIN minerals m ON m.id = sp.mineral_id
         LEFT JOIN minerals mo ON mo.id = sp.made_of_id
        WHERE c.job_id = ?`,
    )
    .get(jobId) as
    | {
        specimen_id: number;
        how: ConfirmHow;
        source: "pill" | "typed" | "same_as_last";
        confirmed_at: string;
        name: string;
        variety: string | null;
        made_of: string | null;
        form: string | null;
      }
    | undefined;
  const identifier = identifierSlug();
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    nextAttemptAt: job.next_attempt_at,
    notes: job.notes,
    tests: answers,
    labelText: job.label_text,
    photos: photos.map((p) => ({ id: p.id, url: `${BASE_PATH}/media/${p.path}`, thumbUrl: `${BASE_PATH}/media/${thumbPathFor(p.path)}`, takenAt: p.taken_at })),
    plan: planPills(candidates, identifier, answers),
    suggestedTests: suggestedOrder(tests, identifier).map(({ kind, how, expected }) => ({ kind, how, expected })),
    confirmation: conf
      ? {
          specimenId: conf.specimen_id,
          name: conf.name,
          variety: conf.variety,
          parts: stoneParts(db, conf.specimen_id),
          madeOf: conf.made_of,
          form: isForm(conf.form) ? conf.form : null,
          how: conf.how,
          source: conf.source,
          confirmedAt: conf.confirmed_at,
        }
      : null,
  };
}

/** Jobs waiting for a name, oldest first: Jasper is done with them (isSettled in job-state.ts) and nobody has named them. */
const WAITING = `j.status IN ('identified', 'rejected') OR (j.status = 'failed' AND j.next_attempt_at IS NULL)`;
/** Jobs Jasper still has: WAITING's complement, so the two never drift apart. */
const WORKING = `j.status IN ('queued', 'identifying') OR (j.status = 'failed' AND j.next_attempt_at IS NOT NULL)`;

/** The unnamed jobs a predicate picks, oldest first. */
function unnamedJobIds(db: DatabaseSync, where: string): number[] {
  const rows = db
    .prepare(
      `SELECT j.id FROM jobs j
        WHERE (${where})
          AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.job_id = j.id)
        ORDER BY j.created_at, j.id`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

export function waitingJobIds(db: DatabaseSync): number[] {
  return unnamedJobIds(db, WAITING);
}

/** The next waiting job after `current`, wrapping to the first; null when nothing else waits. */
export function nextWaitingJob(ids: number[], current: number): number | null {
  const others = ids.filter((id) => id !== current);
  if (others.length === 0) return null;
  return others.find((id) => id > current) ?? others[0];
}

/** The pending strip: how many stones wait, up to three thumbnails, and the first one's job. */
export function waitingStrip(db: DatabaseSync): { count: number; thumbs: string[]; first: JobView | null } {
  const ids = waitingJobIds(db);
  if (ids.length === 0) return { count: 0, thumbs: [], first: null };
  const thumbs = ids.slice(0, 3).flatMap((id) => {
    const p = db.prepare("SELECT path FROM photos WHERE job_id = ? ORDER BY id LIMIT 1").get(id) as { path: string } | undefined;
    return p ? [`${BASE_PATH}/media/${thumbPathFor(p.path)}`] : [];
  });
  return { count: ids.length, thumbs, first: readJob(db, ids[0]) };
}

/**
 * The pending strip's working state (#31): the jobs Jasper still has, oldest
 * first, and up to three thumbnails. Jasper writes a job's thumbnails when he
 * claims it, so a rock he hasn't started has none yet: null, which the strip
 * draws as the crystal placeholder rather than a broken image or an original.
 */
export function workingStrip(db: DatabaseSync): { ids: number[]; thumbs: Array<string | null> } {
  const ids = unnamedJobIds(db, WORKING);
  const thumbs = ids.slice(0, 3).map((id) => {
    const p = db.prepare("SELECT path FROM photos WHERE job_id = ? ORDER BY id LIMIT 1").get(id) as { path: string } | undefined;
    const thumb = p ? thumbPathFor(p.path) : null;
    return thumb && existsSync(path.join(dataDir(), thumb)) ? `${BASE_PATH}/media/${thumb}` : null;
  });
  return { ids, thumbs };
}

export function withReadDb<T>(fn: (db: DatabaseSync) => T, fallback: T): T {
  const db = openReadOnly();
  if (!db) return fallback;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
