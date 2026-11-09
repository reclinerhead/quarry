"""Jasper's loop: claim a job, ask both models about its photos, record what came back.

Copied from the Conservatory's fern/worker.py and adapted (#7). `run_once`
does one job and is the unit the loop repeats. It takes the clock and the ask
function as arguments so the tests can drive it without the network. The two
models are asked side by side on two threads, so a job takes as long as the
slower of them. Each photo is first brought within the stored-size rule (#83:
a JPEG of at most `identify.STORE_SIDE` px, which the browser's shrink already
gives for almost every upload), then its thumbnail is written, for every
processed job, rejected ones included, because the confirm screen shows the
photo either way. The photos that were on disk before get the same once, when
the queue is first idle after a start (`tidy_photos`).

With a Mindat key (#18), an identified job's candidates are looked up in
Mindat before the job is written, on a short leash (#40): a person may be
waiting on the confirm screen. When the queue is idle (`catch_up`), two passes
share one budget and stop as soon as a job arrives: Wikipedia's lead for each
name first (#92, `wikipedia.fetch_pages`), then Mindat's four steps
(`mindat.idle`: the candidates a lookup missed, each named mineral linked to
its record and that record fetched whole (#21), then where those records are
found (#65)). Each host has its own clock (`Host`): once a minute, and after a
failure a minute, then two, four, eight, ten at most, until a pass completes
(#119), so a slow Mindat never holds the About card, and a stone's page fills
in within a minute of a hiccup rather than ten.
Mindat never decides a job's outcome. The log line times each part, and the
job's `finished_at` is when it finished, not when it was claimed.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import identify, llm, mindat, queue, wikipedia

log = logging.getLogger("jasper")

AskFn = Callable[[str, dict], llm.Response]

# A 402 means the gateway budget is spent; someone has to top it up.
QUOTA_PAUSE = timedelta(minutes=10)
# How often an idle Jasper does its Mindat and Wikipedia work (`catch_up`).
CATCH_UP_EVERY = timedelta(minutes=1)
# A host that failed waits this long, doubled each failure in a row, up to the cap (#119).
CATCH_UP_AFTER_FAILURE = timedelta(minutes=1)
CATCH_UP_FAILURE_CAP = timedelta(minutes=10)


def after_failure(failures: int) -> timedelta:
    """How long a host waits after its `failures`th failure in a row: 1, 2, 4, 8, 10, 10 minutes."""
    return min(CATCH_UP_AFTER_FAILURE * 2 ** (max(failures, 1) - 1), CATCH_UP_FAILURE_CAP)


@dataclass
class Host:
    """One source's place in the idle pass: when to ask it next, and how many times in a
    row it has failed. Running out of time or stopping for a job is not a failure."""

    next_at: datetime
    failures: int = 0

    def failed(self, now: datetime) -> timedelta:
        self.failures += 1
        wait = after_failure(self.failures)
        self.next_at = now + wait
        return wait

    def done(self, now: datetime) -> None:
        self.failures = 0
        self.next_at = now + CATCH_UP_EVERY


@dataclass
class Hosts:
    wikipedia: Host
    mindat: Host

    @classmethod
    def at(cls, now: datetime) -> Hosts:
        return cls(Host(now), Host(now))


def _minutes(wait: timedelta) -> str:
    m = max(1, round(wait.total_seconds() / 60))
    return f"{m} minute" if m == 1 else f"{m} minutes"


def thumb_path(rel: str) -> str:
    """photos/2026/10/abc.heic -> photos/2026/10/abc.thumb.jpg"""
    p = Path(rel)
    return str(p.with_name(p.stem + ".thumb.jpg")).replace("\\", "/")


def store_photo(conn: sqlite3.Connection, data_dir: Path, photo: sqlite3.Row, who: str) -> tuple[Path, str, int | None]:
    """Bring one photo on disk within the stored-size rule (#83): a JPEG of at most
    `identify.STORE_SIDE` px. Returns the file to read, its path relative to the data
    directory, and the bytes the rewrite freed (None when the file was already right).
    The path is the row's unless the file was renamed to .jpg; then the row is updated
    first and the original removed after, and a line says so."""
    src = data_dir / photo["path"]
    before = src.stat().st_size
    dst = identify.normalize_photo(src)
    if dst is None:
        return src, photo["path"], None
    rel = dst.relative_to(data_dir).as_posix()
    if rel != photo["path"]:
        with conn:
            conn.execute("UPDATE photos SET path = ? WHERE id = ?", (rel, photo["id"]))
        src.unlink()
    freed = before - dst.stat().st_size
    log.info("%s: photo %s stored as %s (%.1f MB freed)", who, photo["path"], dst.name, freed / 1e6)
    return dst, rel, freed


def tidy_photos(conn: sqlite3.Connection, data_dir: Path, should_stop: Callable[[], bool]) -> bool:
    """The one-time pass over every photo already on disk (#83), run when the queue
    is idle after a start: each is brought within the stored-size rule, and one line
    says what that freed. Returns True once the whole table has been walked; a job
    arriving mid-pass stops it, and the next idle tick starts over (a photo already
    right costs one header read). A photo that cannot be read is one warning."""
    rewritten, freed = 0, 0
    for photo in conn.execute("SELECT id, path FROM photos ORDER BY id").fetchall():
        if should_stop():
            return False
        try:
            _, _, bytes_freed = store_photo(conn, data_dir, photo, "photos")
            if bytes_freed is not None:
                rewritten += 1
                freed += bytes_freed
        except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
            log.warning("photos: %s unreadable: %s", photo["path"], exc)
    if rewritten:
        log.info("photos: %d re-encoded, %.1f MB freed", rewritten, freed / 1e6)
    return True


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

    t_start = time.monotonic()
    images: list[bytes] = []
    for ph in queue.job_photos(conn, job["id"]):
        try:
            src, rel, _ = store_photo(conn, data_dir, ph, f"job {job['id']}")
            identify.write_thumbnail(src, data_dir / thumb_path(rel))
            if len(images) < identify.MAX_IMAGES:
                images.append(identify.prepare_image(src))
        except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
            log.warning("job %d: photo %s unreadable: %s", job["id"], ph["path"], exc)

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
        t_mindat = time.monotonic()
        looked_up = f"{mindat.resolve_outcome(conn, mindat_api, outcome)} ({time.monotonic() - t_mindat:.1f} s)"
    seconds = time.monotonic() - t_start

    # `now` is the claim; the job finished this many seconds later.
    queue.record_outcome(conn, job["id"], outcome, now + timedelta(seconds=seconds))
    row = conn.execute("SELECT attempts, next_attempt_at FROM jobs WHERE id = ?", (job["id"],)).fetchone()
    level, line = _log_line(job["id"], outcome, row, seconds, looked_up)
    log.log(level, "%s", line)
    return outcome


def _log_line(job_id: int, outcome: identify.Outcome, row: sqlite3.Row, seconds: float,
              looked_up: str | None = None) -> tuple[int, str]:
    """One line per job, each part timed:
    `job 7 identified: haiku Galena 0.82 (6.8 s) · flash Galena 0.90 (4.1 s) · $0.0041 · mindat cached (0.0 s) · 7.1 s`.

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
    parts = [f"{o.describe()} ({o.seconds:.1f} s)" for o in outcome.opinions] or [outcome.error or ""]
    parts += [f"${outcome.cost_usd:.4f}", *([looked_up] if looked_up else []), f"{seconds:.1f} s"]
    if outcome.status == "failed" or (outcome.status == "retry" and not row["next_attempt_at"]):
        level = logging.ERROR
    elif outcome.error:
        level = logging.WARNING
    else:
        level = logging.INFO
    return level, f"job {job_id} {verdict}: {' · '.join(parts)}"


def catch_up(conn: sqlite3.Connection, mindat_api: mindat.Api | None, now: datetime,
             wiki_api: wikipedia.Api | None = None, hosts: Hosts | None = None) -> datetime:
    """The idle pass: Wikipedia's lead for each name (#92), then Mindat's four steps
    (the waiting candidates, the named minerals, their records, where those are found),
    each host when it is due, in one budget, each failing on its own (#119). Returns
    when to try next: the earlier of the hosts' times. Running out of time, or a job
    arriving, is not a failure: the rest waits a minute, not longer."""
    hosts = hosts or Hosts.at(now)
    should_stop = lambda: queue.has_runnable(conn, datetime.now(timezone.utc))  # noqa: E731
    start = time.monotonic()
    deadline = start + mindat.IDLE_BUDGET_S
    if wiki_api is not None and now >= hosts.wikipedia.next_at:
        try:
            asked, misses = wikipedia.fetch_pages(conn, wiki_api, deadline, mindat.stopping(time.monotonic, should_stop))
        except mindat.Unreachable as e:
            log.warning("catch-up stopped: %s; next try in %s", e, _minutes(hosts.wikipedia.failed(now)))
        else:
            hosts.wikipedia.done(now)
            if asked:
                log.info("wikipedia fetched %d page(s), %d with no article", asked, misses)
    if mindat_api is not None and now >= hosts.mindat.next_at:
        try:
            filled, linked, fetched, placed = mindat.idle(
                conn, mindat_api, budget_s=max(0.0, deadline - time.monotonic()), should_stop=should_stop
            )
        except mindat.Unreachable as e:
            log.warning("catch-up stopped: %s; next try in %s", e, _minutes(hosts.mindat.failed(now)))
        else:
            hosts.mindat.done(now)
            if filled:
                log.info("mindat caught up on %d waiting candidate(s)", filled)
            if linked or fetched:
                log.info("mindat linked %d mineral(s), fetched %d record(s)", linked, fetched)
            if placed:
                log.info("mindat counted where %d record(s) are found", placed)
    due = [h.next_at for h, api in ((hosts.wikipedia, wiki_api), (hosts.mindat, mindat_api)) if api is not None]
    return min(due) if due else now + CATCH_UP_EVERY


def run_forever(conn: sqlite3.Connection, data_dir: Path, cfg: identify.Settings, should_run: Callable[[], bool],
                mindat_api: mindat.Api | None = None, wiki_api: wikipedia.Api | None = None) -> None:
    paused_until: datetime | None = None
    hosts = Hosts.at(datetime.now(timezone.utc))
    next_catch_up = datetime.now(timezone.utc)
    photos_tidy = False  # the one-time pass over the photos on disk (#83), done at the first idle
    while should_run():
        now = datetime.now(timezone.utc)
        if paused_until and now < paused_until:
            time.sleep(5)
            continue
        paused_until = None
        outcome = run_once(conn, data_dir, cfg, now, mindat_api=mindat_api)
        if outcome is None:
            if not photos_tidy:
                photos_tidy = tidy_photos(conn, data_dir, should_stop=lambda: queue.has_runnable(conn, datetime.now(timezone.utc)))
            if (mindat_api is not None or wiki_api is not None) and now >= next_catch_up:
                next_catch_up = catch_up(conn, mindat_api, now, wiki_api, hosts)
            time.sleep(2)
        elif outcome.status == "quota":
            paused_until = now + QUOTA_PAUSE
            log.warning("the gateway budget is spent; pausing until %s", queue.iso(paused_until))
        else:
            time.sleep(1)
