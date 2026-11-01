"""Open the Quarry's database and bring its schema up to date.

Jasper is the only process that creates or alters tables. The web app opens
the same file with node:sqlite and trusts that this module has run first.

Schema changes after the baseline go in MIGRATIONS as (version, sql) steps.
Each step runs once, in order, inside a transaction, and records its version
in schema_version. The baseline (schema.sql) is version 1.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
BASELINE_VERSION = 1

# Append only. Never edit a step that has shipped.
MIGRATIONS: list[tuple[int, str]] = []

LATEST_VERSION = MIGRATIONS[-1][0] if MIGRATIONS else BASELINE_VERSION


def connect(path: str | Path) -> sqlite3.Connection:
    """Open (creating if needed) the database in WAL mode with the schema applied."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")  # the web app writes to this file too
    apply_schema(conn)
    return conn


def current_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if row is None:
        return 0
    v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    return int(v or 0)


def apply_schema(conn: sqlite3.Connection) -> int:
    """Apply the baseline (idempotent) and any unapplied migration steps. Returns the version."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    version = current_version(conn)
    if version < BASELINE_VERSION:
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (BASELINE_VERSION,))
        conn.commit()
        version = BASELINE_VERSION
    for step_version, sql in MIGRATIONS:
        if step_version <= version:
            continue
        with conn:
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_version (version) VALUES (?)", (step_version,))
        version = step_version
    return version


def queued_jobs(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'queued'").fetchone()[0])
