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
MIGRATIONS: list[tuple[int, str]] = [
    # 2 (#18): the Mindat cache (jasper/mindat.py), and the record each candidate names.
    (
        2,
        """
-- One Mindat entry, as Jasper fetched it. Phase 2's enrichment grows this
-- table rather than starting another.
CREATE TABLE IF NOT EXISTS mindat_records (
  id         INTEGER PRIMARY KEY,                  -- Mindat's geomaterial id
  name       TEXT    NOT NULL,                     -- Agate
  entrytype  TEXT    NOT NULL,                     -- mineral, variety, rock, ...
  varietyof  INTEGER,                              -- the parent's id; NULL at the top (a species or a rock)
  hmin       REAL,                                 -- Mohs; NULL when Mindat records none
  hmax       REAL,
  streak     TEXT,
  fetched_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every term Jasper has asked Mindat about, folded (case, accents and
-- apostrophes removed), with the id it found; NULL when Mindat has no such
-- name, so it is asked once.
CREATE TABLE IF NOT EXISTS mindat_terms (
  term         TEXT    PRIMARY KEY,
  mindat_id    INTEGER,
  looked_up_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE candidates ADD COLUMN mindat_id INTEGER;  -- the record the candidate names; NULL until looked up, or unknown
""",
    ),
    # 3 (#21): the record each named mineral links to, and the whole record as Mindat sent it.
    (
        3,
        """
ALTER TABLE minerals ADD COLUMN mindat_id INTEGER;     -- the record the mineral's own name resolves to; NULL until looked up, or unknown
ALTER TABLE mindat_records ADD COLUMN detail TEXT;     -- the whole record as Mindat sent it (JSON); NULL until fetched
ALTER TABLE mindat_records ADD COLUMN detail_at TEXT;  -- when it was fetched
""",
    ),
    # 4 (#29): a piece with several minerals, named as a show label does: Pyrite with Sphalerite on Quartz.
    (
        4,
        """
-- Each candidate's other minerals, as the model gave them: JSON, a list of
-- {role: "with" | "on", name, mindat_id}; the base may be "matrix". NULL on an
-- answer written before this step.
ALTER TABLE candidates ADD COLUMN parts TEXT;

-- A stone's other minerals. specimens.mineral_id stays the main one, which the
-- property card follows; these are the minerals "with" it, in order, and the one
-- it is "on". A base of plain matrix has no mineral.
CREATE TABLE IF NOT EXISTS specimen_parts (
  specimen_id INTEGER NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('with', 'on')),
  mineral_id  INTEGER REFERENCES minerals(id),
  PRIMARY KEY (specimen_id, position),
  CHECK (mineral_id IS NOT NULL OR role = 'on')
);

CREATE INDEX IF NOT EXISTS specimen_parts_mineral ON specimen_parts (mineral_id);

-- "Also on it" was free text that nothing read. It moves into the notes, and the
-- column is no longer used.
UPDATE specimens
   SET notes = CASE WHEN notes IS NULL OR trim(notes) = '' THEN 'Also on it: ' || trim(associates)
                    ELSE notes || char(10) || 'Also on it: ' || trim(associates) END,
       associates = NULL
 WHERE associates IS NOT NULL AND trim(associates) <> '';
""",
    ),
]

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
