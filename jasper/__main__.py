"""Run Jasper: `python -m jasper`.

Opens the database, applies the schema, logs the queue depth, and idles until
stopped. Draining the identification queue arrives with #7.

Environment:
    QUARRY_DB     path to the SQLite file (default data/quarry.db)
    QUARRY_DATA   directory for photos (default data/)
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from pathlib import Path

from . import db

log = logging.getLogger("jasper")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m jasper", description="The Quarry's worker.")
    parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s jasper %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("QUARRY_DATA", "data"))
    db_path = Path(os.environ.get("QUARRY_DB", data_dir / "quarry.db"))
    (data_dir / "photos").mkdir(parents=True, exist_ok=True)

    conn = db.connect(db_path)
    log.info("up: db=%s schema=v%d queued=%d", db_path, db.current_version(conn), db.queued_jobs(conn))

    running = True

    def stop(signum, _frame):
        nonlocal running
        log.info("stopping on signal %d", signum)
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while running:
        time.sleep(1)  # the queue arrives with #7
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
