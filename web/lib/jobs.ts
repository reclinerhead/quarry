// Reading jobs for the confirm screen, the pending strip and the jobs API.
// Server only, except nextWaitingJob, which is pure.

import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, openReadOnly } from "./db";
import { cleanAnswers, suggestedOrder, type Answers, type TestKind } from "./household-tests";
import type { JobStatus } from "./job-state";
import { chainOf, MAX_DEPTH, type MindatRecord } from "./names";
import type { ConfirmHow } from "./naming";
import { thumbPathFor } from "./photos";
import { parseParts, planPills, type Candidate, type Plan } from "./pills";
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
 * same way, from the `mindat_id` in its `parts` JSON.
 */
export function candidatesOf(db: DatabaseSync, jobId: number): Candidate[] {
  const rows = (
    db
      .prepare("SELECT model, rank, name, variety, kind, confidence, mindat_id, parts FROM candidates WHERE job_id = ? ORDER BY model, rank")
      .all(jobId) as Array<Omit<Candidate, "chain" | "parts"> & { mindat_id: number | null; parts: string | null }>
  ).map((r) => ({ ...r, parts: parseParts(r.parts) }));
  const seeds = rows.flatMap((r) => [r.mindat_id, ...r.parts.map((p) => p.mindatId)]).filter((id) => id !== null);
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
  }));
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
      `SELECT c.specimen_id, c.how, c.source, c.confirmed_at, m.name, sp.variety
         FROM confirmations c
         JOIN specimens sp ON sp.id = c.specimen_id
         JOIN minerals m ON m.id = sp.mineral_id
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
    photos: photos.map((p) => ({ id: p.id, url: `/media/${p.path}`, thumbUrl: `/media/${thumbPathFor(p.path)}`, takenAt: p.taken_at })),
    plan: planPills(candidates, identifier, answers),
    suggestedTests: suggestedOrder(tests, identifier).map(({ kind, how, expected }) => ({ kind, how, expected })),
    confirmation: conf
      ? {
          specimenId: conf.specimen_id,
          name: conf.name,
          variety: conf.variety,
          parts: stoneParts(db, conf.specimen_id),
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
    return p ? [`/media/${thumbPathFor(p.path)}`] : [];
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
    return thumb && existsSync(path.join(dataDir(), thumb)) ? `/media/${thumb}` : null;
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
