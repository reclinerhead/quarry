"""The identification queue: which job runs next, and what an outcome does to it.

Copied from the Conservatory's fern/queue.py and adapted (#7). One job at a
time, oldest first. A transient failure backs off exponentially for
MAX_ATTEMPTS tries and then stays `failed` with its error. A 402 (the gateway
budget is spent) is not an attempt: the job goes back to `queued` and the
worker pauses. Timestamps are ISO 8601 UTC text, the same shape the schema's
defaults write, so string comparison orders them.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

from .identify import Outcome

MAX_ATTEMPTS = 5
BACKOFF_BASE_S = 30
BACKOFF_CAP_S = 480


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def backoff_seconds(attempts: int) -> int:
    """30 s, 60 s, 120 s, 240 s, 480 s, and no longer. `attempts` counts the one that just failed."""
    if attempts < 1:
        return BACKOFF_BASE_S
    return min(BACKOFF_BASE_S * 2 ** (attempts - 1), BACKOFF_CAP_S)


def next_attempt_at(attempts: int, now: datetime) -> datetime | None:
    """When a job that has failed `attempts` times may run again; None once it is out of tries."""
    if attempts >= MAX_ATTEMPTS:
        return None
    return now + timedelta(seconds=backoff_seconds(attempts))


def requeue_interrupted(conn: sqlite3.Connection) -> int:
    """Put back the jobs a stopped Jasper left `identifying`, without counting an attempt.

    Only one Jasper runs against a database, so at start any such job is one
    whose run was killed before its outcome was written. Returns how many."""
    with conn:
        return conn.execute("UPDATE jobs SET status = 'queued' WHERE status = 'identifying'").rowcount


def claim_next(conn: sqlite3.Connection, now: datetime) -> sqlite3.Row | None:
    """Pick the oldest runnable job and mark it `identifying`. Returns the job row, or None."""
    now_s = iso(now)
    with conn:
        row = conn.execute(
            """
            SELECT * FROM jobs
             WHERE status = 'queued'
                OR (status = 'failed' AND attempts < ? AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
             ORDER BY created_at, id
             LIMIT 1
            """,
            (MAX_ATTEMPTS, now_s),
        ).fetchone()
        if row is None:
            return None
        conn.execute("UPDATE jobs SET status = 'identifying', next_attempt_at = NULL WHERE id = ?", (row["id"],))
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone()


def job_photos(conn: sqlite3.Connection, job_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM photos WHERE job_id = ? ORDER BY id", (job_id,)).fetchall()


def record_outcome(conn: sqlite3.Connection, job_id: int, outcome: Outcome, now: datetime) -> None:
    """Apply an outcome to the job row, its candidates and its suggested tests."""
    now_s = iso(now)
    with conn:
        if outcome.status in ("identified", "rejected"):
            # New answers replace whatever an earlier ask left: a job sent back
            # with test answers (#8) comes through here again.
            conn.execute("DELETE FROM candidates WHERE job_id = ?", (job_id,))
            conn.execute("DELETE FROM suggested_tests WHERE job_id = ?", (job_id,))
            for o in outcome.opinions:
                if o.answer is None:
                    continue
                conn.executemany(
                    """INSERT INTO candidates (job_id, model, rank, name, variety, kind, confidence, features, cost_usd)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        # The whole call's cost on the rank-1 row only, so a SUM is the spend.
                        (job_id, o.role.model, rank, c.name, c.variety, c.kind, c.confidence, json.dumps(c.features),
                         o.cost_usd if rank == 1 else None)
                        for rank, c in enumerate(o.answer.candidates, start=1)
                    ],
                )
                conn.executemany(
                    "INSERT INTO suggested_tests (job_id, model, rank, kind, how, expected) VALUES (?, ?, ?, ?, ?, ?)",
                    [(job_id, o.role.model, rank, t.kind, t.how, t.expected) for rank, t in enumerate(o.answer.tests, start=1)],
                )
            conn.execute(
                """UPDATE jobs SET status = ?, label_text = ?, finished_at = ?, error = ?, next_attempt_at = NULL,
                                   attempts = attempts + 1 WHERE id = ?""",
                (outcome.status, outcome.label_text, now_s, outcome.error, job_id),
            )
        elif outcome.status == "quota":
            # Not an attempt. Back to the queue; the worker pauses before the next claim.
            conn.execute("UPDATE jobs SET status = 'queued', error = ? WHERE id = ?", (outcome.error, job_id))
        elif outcome.status == "retry":
            attempts = int(conn.execute("SELECT attempts FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]) + 1
            when = next_attempt_at(attempts, now)
            conn.execute(
                "UPDATE jobs SET status = 'failed', attempts = ?, next_attempt_at = ?, error = ?, finished_at = ? WHERE id = ?",
                (attempts, iso(when) if when else None, outcome.error, None if when else now_s, job_id),
            )
        else:  # failed, for good
            conn.execute(
                "UPDATE jobs SET status = 'failed', attempts = ?, next_attempt_at = NULL, error = ?, finished_at = ? WHERE id = ?",
                (MAX_ATTEMPTS, outcome.error, now_s, job_id),
            )
