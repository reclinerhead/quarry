"""Run Jasper: `python -m jasper`.

Opens the database, applies the schema, puts back any job a stopped Jasper
left mid-identification, and drains the identification queue until stopped,
asking both models about each job through the Vercel AI Gateway (#7).

Environment:
    QUARRY_DB              path to the SQLite file (default data/quarry.db)
    QUARRY_DATA            directory for photos (default data/)
    AI_GATEWAY_API_KEY     the Vercel AI Gateway key; Jasper refuses to start without it
    QUARRY_IDENTIFIER      the identifier's gateway slug (default anthropic/claude-haiku-5.5), asked at medium effort
    QUARRY_SECOND_OPINION  the second opinion's slug (default google/gemini-3.8-flash), asked at low effort
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
from pathlib import Path

from . import db, identify, queue, worker

log = logging.getLogger("jasper")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m jasper", description="The Quarry's worker.")
    parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s jasper %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("QUARRY_DATA", "data"))
    db_path = Path(os.environ.get("QUARRY_DB", data_dir / "quarry.db"))

    try:
        cfg = identify.settings()
    except ValueError as exc:
        log.error("%s", exc)
        return 2
    if cfg is None:
        log.error("AI_GATEWAY_API_KEY is not set; nothing to identify with")
        return 2
    (data_dir / "photos").mkdir(parents=True, exist_ok=True)

    conn = db.connect(db_path)
    requeued = queue.requeue_interrupted(conn)
    log.info("up: db=%s schema=v%d queued=%d", db_path, db.current_version(conn), db.queued_jobs(conn))
    if requeued:
        log.info("put %d job(s) a stopped Jasper left identifying back in the queue", requeued)
    ident, second = cfg.roles
    log.info(
        "identifier %s (%s effort), second opinion %s (%s effort), prompt v%d",
        ident.model, ident.effort, second.model, second.effort, cfg.prompt_version,
    )

    running = True

    def stop(signum, _frame):
        nonlocal running
        log.info("stopping on signal %d", signum)
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    worker.run_forever(conn, data_dir, cfg, lambda: running)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
