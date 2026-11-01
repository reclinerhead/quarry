"""Jasper's loop: claim a job, ask both models about its photos, record what came back.

Copied from the Conservatory's fern/worker.py and adapted (#7). `run_once`
does one job and is the unit the loop repeats. It takes the clock and the ask
function as arguments so the tests can drive it without the network. The two
models are asked side by side on two threads, so a job takes as long as the
slower of them. The thumbnail is written for every processed job, rejected
ones included, because the confirm screen shows the photo either way.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import identify, llm, queue

log = logging.getLogger("jasper")

AskFn = Callable[[str, dict], llm.Response]

# A 402 means the gateway budget is spent; someone has to top it up.
QUOTA_PAUSE = timedelta(minutes=10)


def thumb_path(rel: str) -> str:
    """photos/2026/10/abc.heic -> photos/2026/10/abc.thumb.jpg"""
    p = Path(rel)
    return str(p.with_name(p.stem + ".thumb.jpg")).replace("\\", "/")


def run_once(
    conn: sqlite3.Connection,
    data_dir: Path,
    cfg: identify.Settings,
    now: datetime | None = None,
    ask: AskFn = llm.ask,
) -> identify.Outcome | None:
    """Process the next runnable job. Returns its outcome, or None when the queue is idle."""
    now = now or datetime.now(timezone.utc)
    job = queue.claim_next(conn, now)
    if job is None:
        return None

    images: list[bytes] = []
    for ph in queue.job_photos(conn, job["id"]):
        src = data_dir / ph["path"]
        try:
            identify.write_thumbnail(src, data_dir / thumb_path(ph["path"]))
            if len(images) < identify.MAX_IMAGES:
                images.append(identify.prepare_image(src))
        except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
            log.warning("job %d: photo %s unreadable: %s", job["id"], ph["path"], exc)

    t0 = time.monotonic()
    if not images:
        outcome = identify.Outcome("failed", error="no readable photos")
    else:
        text = identify.user_text(job["notes"], job["tests"])
        bodies = [llm.payload(r.model, r.effort, cfg.system, identify.SCHEMA, images, text) for r in cfg.roles]
        with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
            responses = list(pool.map(lambda body: ask(cfg.key, body), bodies))
        outcome = identify.classify([identify.opinion(r, resp) for r, resp in zip(cfg.roles, responses)])
    seconds = time.monotonic() - t0

    queue.record_outcome(conn, job["id"], outcome, now)
    row = conn.execute("SELECT attempts, next_attempt_at FROM jobs WHERE id = ?", (job["id"],)).fetchone()
    level, line = _log_line(job["id"], outcome, row, seconds)
    log.log(level, "%s", line)
    return outcome


def _log_line(job_id: int, outcome: identify.Outcome, row: sqlite3.Row, seconds: float) -> tuple[int, str]:
    """One line per job: `job 7 identified: haiku Galena 0.82 · flash Galena 0.90 · $0.0041 · 6.2 s`.

    INFO when both models answered; WARNING when one did not, or the job will be
    tried again; ERROR when it failed for good (a bad key says so here, once)."""
    if outcome.status == "retry":
        when = row["next_attempt_at"]
        verdict = f"retry {row['attempts']} of {queue.MAX_ATTEMPTS} at {when}" if when else f"failed after {row['attempts']} attempts"
    elif outcome.status == "quota":
        verdict = "back in the queue"
    else:
        verdict = outcome.status
    parts = [o.describe() for o in outcome.opinions] or [outcome.error or ""]
    parts += [f"${outcome.cost_usd:.4f}", f"{seconds:.1f} s"]
    if outcome.status == "failed" or (outcome.status == "retry" and not row["next_attempt_at"]):
        level = logging.ERROR
    elif outcome.error:
        level = logging.WARNING
    else:
        level = logging.INFO
    return level, f"job {job_id} {verdict}: {' · '.join(parts)}"


def run_forever(conn: sqlite3.Connection, data_dir: Path, cfg: identify.Settings, should_run: Callable[[], bool]) -> None:
    paused_until: datetime | None = None
    while should_run():
        now = datetime.now(timezone.utc)
        if paused_until and now < paused_until:
            time.sleep(5)
            continue
        paused_until = None
        outcome = run_once(conn, data_dir, cfg, now)
        if outcome is None:
            time.sleep(2)
        elif outcome.status == "quota":
            paused_until = now + QUOTA_PAUSE
            log.warning("the gateway budget is spent; pausing until %s", queue.iso(paused_until))
        else:
            time.sleep(1)
