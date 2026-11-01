// Reading jobs for the confirm screen, the pending strip and the jobs API.
// Server only, except nextWaitingJob, which is pure.

import type { DatabaseSync } from "node:sqlite";
import { openReadOnly } from "./db";
import { cleanAnswers, suggestedOrder, type Answers, type TestKind } from "./household-tests";
import type { JobStatus } from "./job-state";
import type { ConfirmHow } from "./naming";
import { thumbPathFor } from "./photos";
import { planPills, type Candidate, type Plan } from "./pills";

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
  const candidates = db
    .prepare("SELECT model, rank, name, variety, kind, confidence FROM candidates WHERE job_id = ? ORDER BY model, rank")
    .all(jobId) as Candidate[];
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
    tests: cleanAnswers(job.tests),
    labelText: job.label_text,
    photos: photos.map((p) => ({ id: p.id, url: `/media/${p.path}`, thumbUrl: `/media/${thumbPathFor(p.path)}`, takenAt: p.taken_at })),
    plan: planPills(candidates, identifier),
    suggestedTests: suggestedOrder(tests, identifier).map(({ kind, how, expected }) => ({ kind, how, expected })),
    confirmation: conf
      ? { specimenId: conf.specimen_id, name: conf.name, variety: conf.variety, how: conf.how, source: conf.source, confirmedAt: conf.confirmed_at }
      : null,
  };
}

/** Jobs waiting for a name, oldest first: Jasper is done with them (isSettled in job-state.ts) and nobody has named them. */
const WAITING = `j.status IN ('identified', 'rejected') OR (j.status = 'failed' AND j.next_attempt_at IS NULL)`;

export function waitingJobIds(db: DatabaseSync): number[] {
  const rows = db
    .prepare(
      `SELECT j.id FROM jobs j
        WHERE (${WAITING})
          AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.job_id = j.id)
        ORDER BY j.created_at, j.id`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** The next waiting job after `current`, wrapping to the first; null when nothing else waits. */
export function nextWaitingJob(ids: number[], current: number): number | null {
  const others = ids.filter((id) => id !== current);
  if (others.length === 0) return null;
  return others.find((id) => id > current) ?? others[0];
}

/** The stone the person named most recently, for "Same stone as the last one". */
export function lastNamedStone(db: DatabaseSync): { id: number; name: string; variety: string | null } | null {
  const row = db
    .prepare(
      `SELECT sp.id, m.name, sp.variety
         FROM confirmations c
         JOIN specimens sp ON sp.id = c.specimen_id
         JOIN minerals m ON m.id = sp.mineral_id
        ORDER BY c.confirmed_at DESC, c.rowid DESC LIMIT 1`,
    )
    .get() as { id: number; name: string; variety: string | null } | undefined;
  // node:sqlite rows have a null prototype, which React refuses to pass to a client component.
  return row ? { id: row.id, name: row.name, variety: row.variety } : null;
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

export function withReadDb<T>(fn: (db: DatabaseSync) => T, fallback: T): T {
  const db = openReadOnly();
  if (!db) return fallback;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
