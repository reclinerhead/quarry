# Jasper

Jasper is the Quarry's worker: a Python 3.13 package in `jasper/`, run as `python -m jasper`. It owns the database. Identification arrives with #7, when it becomes the only process that calls a model; Phase 2 adds the Mindat enrichment. It is named in the tradition of the Aviary's Earl and Willard and the Conservatory's Fern: a stone and an old-fashioned name.

## Running it

```powershell
python -m venv .venv
.venv\Scripts\pip install -r jasper\requirements.txt
.venv\Scripts\python -m jasper
```

Environment: `QUARRY_DB` (default `data/quarry.db`) and `QUARRY_DATA` (default `data/`; photos under `photos/`). On start it opens the database, applies the schema, logs one line (`up: db=data\quarry.db schema=v1 queued=0`), and idles until stopped (SIGTERM or Ctrl-C).

## The database

`jasper/db.py` is the one place that opens the file for writing from Python. `connect(path)` creates parent directories, opens SQLite with `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, and a 5 s `busy_timeout` (the web app writes to the same file), then applies the schema.

**Schema ownership.** `jasper/schema.sql` is the baseline, version 1, and is idempotent: every statement is `CREATE ... IF NOT EXISTS`, so applying it to a live database is a no-op. Changes to an existing table are never edited into the baseline. They are appended to `MIGRATIONS` in `db.py` as `(version, sql)` steps; each runs once, in order, inside a transaction, and records its version in `schema_version`. The baseline may be rewritten to match only once a step has shipped to every box. `db.LATEST_VERSION` is the version a fresh database comes up at: **1** today. The web app never creates or alters tables; it trusts that Jasper ran first, and `web/lib/db.ts` answers honest zeros when the file does not exist yet.

**Tables.** All timestamps are ISO 8601 text in UTC. The Phase 1 set, decided in #4:

| Table | Holds | Notes |
| --- | --- | --- |
| `photos` | one uploaded photo | `path` relative to `QUARRY_DATA`; linked to a job and, once named, a specimen; `thumb_at` for a photo added straight to a stone, which has no job |
| `jobs` | one identification request | `status`: `queued` → `identifying` → `identified`, or `rejected` (neither model named anything), or `failed` (retried after `next_attempt_at`); `notes` and `tests` (JSON) are what the person told the models; `label_text` is any label the models read |
| `candidates` | each model's ranked answers for a job | keyed `(job_id, model, rank)`; `kind` is `mineral`, `rock` or `other`; `features` is a JSON array; `cost_usd` is the whole call's cost on the rank-1 row only, so a `SUM` is the spend. Each model's answer is kept apart, and the confirm screen works out agreement when it renders, so the rule can change without rewriting rows |
| `suggested_tests` | the household tests each model suggested | `kind` is one of `glass`, `steel`, `copper`, `fingernail`, `streak`, `vinegar`, `magnet`, `uv`, so the confirm screen can ask it with a structured answer |
| `minerals` | a mineral or rock the household has named | the first part of a specimen's name; `name` is unique ignoring case (`COLLATE NOCASE`); Phase 2 hangs the Mindat record here |
| `specimens` | the stone on the shelf | `variety` is the second part of its name (Amethyst, "Blue Lace Agate"); `associates` is other minerals on the same piece, as text; `found_at` where it came from, `acquired` how (`found`, `bought`, `gifted`, `traded`), `location` where it lives now; `tests` (JSON) copied from the job when named |
| `confirmations` | how a job's stone was named | `chosen_name`; `source` `pill`, `typed` or `same_as_last`; `how` `label`, `tests`, `expert`, `suggestion` or `guess`; `verdict` what the screen said (`probably`, `could_be`, `none`). Only `label`, `tests` and `expert` count as known answers when a future model is scored against the household's record |

Tests: `test_jasper_db.py` at the repo root covers the baseline apply, idempotence, migration ordering, the enumerated columns' constraints, case-insensitive mineral names, and a confirmation's `how`.
