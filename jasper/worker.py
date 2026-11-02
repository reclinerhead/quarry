"""Jasper's loop: claim a job, ask both models about its photos, record what came back.

Copied from the Conservatory's fern/worker.py and adapted (#7). `run_once`
does one job and is the unit the loop repeats. It takes the clock and the ask
function as arguments so the tests can drive it without the network. The two
models are asked side by side on two threads, so a job takes as long as the
slower of them. The thumbnail is written for every processed job, rejected
ones included, because the confirm screen shows the photo either way.

With a Mindat key (#18), an identified job's candidates are looked up in
Mindat before the job is written, and when the queue is idle the candidates a
lookup missed are tried again (`mindat.catch_up`), once a minute, or ten
minutes after Mindat failed. Mindat never decides a job's outcome.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import identify, llm, mindat, queue

log = logging.getLogger("jasper")

AskFn = Callable[[str, dict], llm.Response]

# A 402 means the gateway budget is spent; someone has to top it up.
QUOTA_PAUSE = timedelta(minutes=10)
# How often an idle Jasper tries the waiting candidates Mindat has not answered for.
CATCH_UP_EVERY = timedelta(minutes=1)
CATCH_UP_AFTER_FAILURE = timedelta(minutes=10)


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
    mindat_api: mindat.Api | None = None,
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
    looked_up = None
    if mindat_api is not None and outcome.status == "identified":
        looked_up = mindat.resolve_outcome(conn, mindat_api, outcome)
    seconds = time.monotonic() - t0

    queue.record_outcome(conn, job["id"], outcome, now)
    row = conn.execute("SELECT attempts, next_attempt_at FROM jobs WHERE id = ?", (job["id"],)).fetchone()
    level, line = _log_line(job["id"], outcome, row, seconds, looked_up)
    log.log(level, "%s", line)
    return outcome


def _log_line(job_id: int, outcome: identify.Outcome, row: sqlite3.Row, seconds: float,
              looked_up: str | None = None) -> tuple[int, str]:
    """One line per job: `job 7 identified: haiku Galena 0.82 · flash Galena 0.90 · $0.0041 · mindat cached · 6.2 s`.

    INFO when both models answered; WARNING when one did not, or the job will be
    tried again; ERROR when it failed for good (a bad key says so here, once).
    The Mindat part is there only when Mindat was asked, and never changes the level."""
    if outcome.status == "retry":
        when = row["next_attempt_at"]
        verdict = f"retry {row['attempts']} of {queue.MAX_ATTEMPTS} at {when}" if when else f"failed after {row['attempts']} attempts"
    elif outcome.status == "quota":
        verdict = "back in the queue"
    else:
        verdict = outcome.status
    parts = [o.describe() for o in outcome.opinions] or [outcome.error or ""]
    parts += [f"${outcome.cost_usd:.4f}", *([looked_up] if looked_up else []), f"{seconds:.1f} s"]
    if outcome.status == "failed" or (outcome.status == "retry" and not row["next_attempt_at"]):
        level = logging.ERROR
    elif outcome.error:
        level = logging.WARNING
    else:
        level = logging.INFO
    return level, f"job {job_id} {verdict}: {' · '.join(parts)}"


def catch_up(conn: sqlite3.Connection, mindat_api: mindat.Api, now: datetime) -> datetime:
    """Try the waiting candidates Mindat has not answered for. Returns when to try next."""
    try:
        filled = mindat.catch_up(conn, mindat_api)
    except mindat.Unreachable as e:
        log.warning("mindat catch-up stopped: %s; next try in %d minutes", e, CATCH_UP_AFTER_FAILURE.seconds // 60)
        return now + CATCH_UP_AFTER_FAILURE
    if filled:
        log.info("mindat caught up on %d waiting candidate(s)", filled)
    return now + CATCH_UP_EVERY


def run_forever(conn: sqlite3.Connection, data_dir: Path, cfg: identify.Settings, should_run: Callable[[], bool],
                mindat_api: mindat.Api | None = None) -> None:
    paused_until: datetime | None = None
    next_catch_up = datetime.now(timezone.utc)
    while should_run():
        now = datetime.now(timezone.utc)
        if paused_until and now < paused_until:
            time.sleep(5)
            continue
        paused_until = None
        outcome = run_once(conn, data_dir, cfg, now, mindat_api=mindat_api)
        if outcome is None:
            if mindat_api is not None and now >= next_catch_up:
                next_catch_up = catch_up(conn, mindat_api, now)
            time.sleep(2)
        elif outcome.status == "quota":
            paused_until = now + QUOTA_PAUSE
            log.warning("the gateway budget is spent; pausing until %s", queue.iso(paused_until))
        else:
            time.sleep(1)
