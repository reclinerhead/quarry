-- The Quarry's schema, owned by Jasper (jasper/db.py applies it on start).
--
-- This file is the baseline and must stay idempotent: every statement is
-- CREATE ... IF NOT EXISTS. Changes to an existing table are NOT edited in
-- here; they are appended as numbered steps to MIGRATIONS in jasper/db.py, and
-- the baseline is only rewritten to match once a step has shipped everywhere.
-- The web app opens this database with node:sqlite and never creates tables.

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A photo a person uploaded. One photo belongs to one identification job and,
-- once named, to one specimen. The file lives under QUARRY_DATA.
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY,
  path        TEXT    NOT NULL UNIQUE,            -- relative to QUARRY_DATA
  taken_at    TEXT,                               -- ISO 8601, from EXIF when present
  uploaded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  specimen_id INTEGER REFERENCES specimens(id) ON DELETE SET NULL,
  thumb_at    TEXT                                -- when a job-less photo's thumbnail was written
);

-- One identification job per upload. Jasper drains these oldest first and asks
-- both models (#7). notes and tests are what the person told the models; a
-- rejected job is one where neither model named anything.
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY,
  status          TEXT    NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'identifying', 'identified', 'rejected', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  notes           TEXT,                            -- where it was found or bought, from the upload
  tests           TEXT    NOT NULL DEFAULT '{}',   -- JSON: test kind -> answer, sent to the models
  label_text      TEXT,                            -- any label or tag the models read in the photos
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at     TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs (status, created_at);

-- Each model's ranked answers for a job, kept apart: the confirm screen works
-- out whether they agree when it renders, so the rule can change without
-- rewriting rows. cost_usd is the whole call's cost as the gateway reported
-- it, on the rank-1 row only, so a SUM is the spend.
CREATE TABLE IF NOT EXISTS candidates (
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,                     -- the gateway slug
  rank       INTEGER NOT NULL,
  name       TEXT    NOT NULL,                     -- the mineral or rock, as Mindat names it
  variety    TEXT,                                 -- Amethyst, Tiger's Eye
  kind       TEXT    NOT NULL CHECK (kind IN ('mineral', 'rock', 'other')),
  confidence REAL    NOT NULL,
  features   TEXT    NOT NULL DEFAULT '[]',        -- JSON array of short phrases
  cost_usd   REAL,
  PRIMARY KEY (job_id, model, rank)
);

-- The household tests each model suggested to separate its candidates.
CREATE TABLE IF NOT EXISTS suggested_tests (
  job_id   INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  model    TEXT    NOT NULL,
  rank     INTEGER NOT NULL,
  kind     TEXT    NOT NULL
                   CHECK (kind IN ('glass', 'steel', 'copper', 'fingernail', 'streak', 'vinegar', 'magnet', 'uv')),
  how      TEXT    NOT NULL,                       -- how to do it
  expected TEXT    NOT NULL,                       -- what each candidate would show
  PRIMARY KEY (job_id, model, rank)
);

-- A mineral or rock the household has named at least once: the first part of
-- a specimen's name. Phase 2 hangs the Mindat record here.
CREATE TABLE IF NOT EXISTS minerals (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  kind       TEXT    NOT NULL DEFAULT 'mineral' CHECK (kind IN ('mineral', 'rock', 'other')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The stone on the shelf. Its name is the mineral plus an optional variety or
-- shop name; other minerals on the same piece go in associates as text (#4).
-- tests is copied from the job when it is named, then edited on its page.
CREATE TABLE IF NOT EXISTS specimens (
  id          INTEGER PRIMARY KEY,
  mineral_id  INTEGER NOT NULL REFERENCES minerals(id),
  variety     TEXT,                                -- Amethyst, "Blue Lace Agate"
  associates  TEXT,                                -- "on sphalerite"
  found_at    TEXT,                                -- where it was found or bought
  acquired    TEXT    CHECK (acquired IN ('found', 'bought', 'gifted', 'traded')),
  acquired_on TEXT,                                -- ISO date
  location    TEXT,                                -- where it lives now: a shelf, a drawer
  notes       TEXT,
  tests       TEXT    NOT NULL DEFAULT '{}',       -- JSON: test kind -> answer
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS specimens_mineral ON specimens (mineral_id);
CREATE INDEX IF NOT EXISTS specimens_location ON specimens (location);

-- How a job's stone was named: what it was called, whether from a pill, typed,
-- or as another photo of the last stone, how the person knew, and what the
-- screen said at the time. Only label, tests and expert count as known
-- answers when a future model is scored against the household's record.
CREATE TABLE IF NOT EXISTS confirmations (
  job_id       INTEGER NOT NULL PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  specimen_id  INTEGER NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
  chosen_name  TEXT    NOT NULL,
  source       TEXT    NOT NULL CHECK (source IN ('pill', 'typed', 'same_as_last')),
  how          TEXT    NOT NULL CHECK (how IN ('label', 'tests', 'expert', 'suggestion', 'guess')),
  verdict      TEXT    NOT NULL CHECK (verdict IN ('probably', 'could_be', 'none')),
  confirmed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
