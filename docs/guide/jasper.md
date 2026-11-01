# Jasper

Jasper is the Quarry's worker: a Python 3.13 package in `jasper/`, run as `python -m jasper`. It owns the database, drains the identification queue, and is the only process that calls a model, so the bill has one owner; Phase 2 adds the Mindat enrichment. It is named in the tradition of the Aviary's Earl and Willard and the Conservatory's Fern: a stone and an old-fashioned name. The queue, the gateway client and the worker loop are copied from Fern and adapted, not shared.

## Running it

```powershell
python -m venv .venv
.venv\Scripts\pip install -r jasper\requirements.txt
.venv\Scripts\python -m jasper
```

Environment:

| Variable | Default | |
| --- | --- | --- |
| `QUARRY_DB` | `data/quarry.db` | the SQLite file |
| `QUARRY_DATA` | `data/` | photos under `photos/`, thumbnails beside them |
| `AI_GATEWAY_API_KEY` | none | the Vercel AI Gateway key; Jasper refuses to start without it (exit 2) |
| `QUARRY_IDENTIFIER` | `anthropic/claude-haiku-5.5` | the identifier's gateway slug, asked at medium effort |
| `QUARRY_SECOND_OPINION` | `google/gemini-3.8-flash` | the second opinion's slug, asked at low effort; must differ from the identifier (exit 2), since candidates are keyed by slug |

The efforts belong to the roles, not the models: Phase 0 (#1) found Gemini Flash as accurate at low effort as at medium, for a third of the cost. On start Jasper opens the database, applies the schema, puts back any job a stopped Jasper left `identifying`, and logs two lines (`up: db=data\quarry.db schema=v1 queued=11`, then `identifier anthropic/claude-haiku-5.5 (medium effort), second opinion google/gemini-3.8-flash (low effort), prompt v1`). It then drains the queue until stopped (SIGTERM or Ctrl-C).

## The database

`jasper/db.py` is the one place that opens the file for writing from Python. `connect(path)` creates parent directories, opens SQLite with `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, and a 5 s `busy_timeout` (the web app writes to the same file), then applies the schema.

**Schema ownership.** `jasper/schema.sql` is the baseline, version 1, and is idempotent: every statement is `CREATE ... IF NOT EXISTS`, so applying it to a live database is a no-op. Changes to an existing table are never edited into the baseline. They are appended to `MIGRATIONS` in `db.py` as `(version, sql)` steps; each runs once, in order, inside a transaction, and records its version in `schema_version`. The baseline may be rewritten to match only once a step has shipped to every box. `db.LATEST_VERSION` is the version a fresh database comes up at: **1** today. The web app never creates or alters tables; it trusts that Jasper ran first, and `web/lib/db.ts` answers honest zeros when the file does not exist yet.

**Tables.** All timestamps are ISO 8601 text in UTC. The Phase 1 set, decided in #4:

| Table | Holds | Notes |
| --- | --- | --- |
| `photos` | one uploaded photo | `path` relative to `QUARRY_DATA`; linked to a job and, once named, a specimen; `thumb_at` for a photo added straight to a stone, which has no job |
| `jobs` | one identification request | `status`: `queued` → `identifying` → `identified`, or `rejected` (neither model named anything), or `failed` (retried after `next_attempt_at`, or for good once `attempts` reaches five); `notes` and `tests` (JSON) are what the person told the models; `label_text` is any label the models read; `error` is why the last attempt failed or, on an identified or rejected job, which model gave no answer and why |
| `candidates` | each model's ranked answers for a job | keyed `(job_id, model, rank)`; `kind` is `mineral`, `rock` or `other`; `features` is a JSON array; `cost_usd` is the whole call's cost on the rank-1 row only, so a `SUM` is the spend of the answers that named something. Each model's answer is kept apart, and the confirm screen works out agreement when it renders, so the rule can change without rewriting rows |
| `suggested_tests` | the household tests each model suggested | `kind` is one of `glass`, `steel`, `copper`, `fingernail`, `streak`, `vinegar`, `magnet`, `uv`, so the confirm screen can ask it with a structured answer |
| `minerals` | a mineral or rock the household has named | the first part of a specimen's name; `name` is unique ignoring case (`COLLATE NOCASE`); Phase 2 hangs the Mindat record here |
| `specimens` | the stone on the shelf | `variety` is the second part of its name (Amethyst, "Blue Lace Agate"); `associates` is other minerals on the same piece, as text; `found_at` where it came from, `acquired` how (`found`, `bought`, `gifted`, `traded`), `location` where it lives now; `tests` (JSON) copied from the job when named |
| `confirmations` | how a job's stone was named | `chosen_name`; `source` `pill`, `typed` or `same_as_last`; `how` `label`, `tests`, `expert`, `suggestion` or `guess`; `verdict` what the screen said (`probably`, `could_be`, `none`). Only `label`, `tests` and `expert` count as known answers when a future model is scored against the household's record |

Tests: `test_jasper_db.py` at the repo root covers the baseline apply, idempotence, migration ordering, the enumerated columns' constraints, case-insensitive mineral names, and a confirmation's `how`.

## The queue (`jasper/queue.py`)

One job at a time, oldest first (`created_at`, then `id`). `claim_next` picks the oldest job that is `queued`, or `failed` with its `next_attempt_at` passed and attempts left, and marks it `identifying` in the same transaction. `record_outcome` applies the outcome in one transaction, so a kill mid-write leaves the job as it was. A failed attempt backs off 30 s, 60 s, 120 s, 240 s (doubling, capped at 480 s); after the fifth attempt the job stays `failed` with its error and a `finished_at`.

**Nothing is lost to a kill.** Only one Jasper runs against a database, so at start any job still `identifying` belonged to a run that was killed before its outcome was written; `requeue_interrupted` puts it back to `queued` without counting an attempt, and it keeps its place in line. Fern has no such step.

**Asking again.** A job sent back with test answers (the confirm screen, #8) is the same job set back to `queued` with `attempts` 0 and its `tests` updated. It goes through the same path, and an `identified` or `rejected` outcome deletes the job's old candidates and suggested tests before writing the new ones. A re-ask that fails leaves the old ones in place.

## The question (`jasper/identify.py`, `jasper/prompts/identify.md`)

Both models get the same question: the prompt file as the system prompt, then one user message of the job's photos followed by one text block, held to `identify.SCHEMA`.

**The prompt** is the Phase 0 spike's instructions, with `prompt_version` in its front matter (read by `load_prompt`, logged at start; no column records it yet). It asks for one to three candidates (name as Mindat names the species or rock, variety or trade name, kind, an honest calibrated confidence, the visible features), one to three household tests that would separate them, and any label text in the photos. It differs from the spike in one way: each test carries a `kind` from the same fixed list the `suggested_tests` table checks, each named with its household tool (a glass bottle about Mohs 5.5, a steel knife or nail about 5.5, a copper coin about 3.5, a fingernail about 2.5, the back of a tile for streak, vinegar for fizz, a fridge magnet, a UV flashlight), replacing the spike's free-text test name, and it skips tests the owner has already answered.

**The photos**: at most five per job, in `photos.id` order, each re-encoded by `prepare_image` to JPEG at 1280 px on the long side (orientation applied, HEIC through pillow-heif), as base64 image blocks.

**The text** (`user_text`) carries the notes and any test answers in words: `Photos of one specimen. The owner's notes:` and the notes (or `No notes from the owner.`), then `The owner's test answers: Scratches glass: no. Streak: red-brown. Fizzes in vinegar: not tried.` in the fixed kind order. The `tests` column is JSON from test kind to answer; Jasper reads `true`/`"yes"` as yes, `false`/`"no"` as no, `null`, `""` or `"not_tried"` as **not tried** (always said as such, never as no), and any other text verbatim (a streak colour, "glows green"). The hardness answers read the way the household does them: the stone scratches glass, but the knife, the coin and the fingernail scratch the stone. A key Jasper does not know is said under its own name rather than dropped.

## The call (`jasper/llm.py`)

The Vercel AI Gateway's Anthropic Messages endpoint (`https://ai-gateway.vercel.sh/v1/messages`, `anthropic-version: 2023-06-01`, the key as a bearer token), over the standard library's `urllib` as Fern's `llm.py` does, so the only dependencies are the image libraries. The same endpoint serves Gemini by slug with the same request. The body (`payload`) is five keys: `model`, `max_tokens` (16000, since thinking counts against it), `system`, `messages`, and `output_config: {effort, format: {type: "json_schema", schema}}`, which holds each answer to the schema. No sampling settings. `ask` never raises: an HTTP error comes back as its status and JSON body, and a transport failure or timeout (180 s) as status 0.

What a response holds, confirmed live on 2026-11-01: Haiku's `content` is a `thinking` block then the `text` block, Gemini's is the text alone (`reply_text` joins only text blocks, and refuses a `refusal` or `max_tokens` stop, so a cut-off answer never reaches the validator); the cost is `provider_metadata.gateway.marketCost` in the raw body (`market_cost`), the list price including thinking, read rather than `cost` because a provider key of our own would bill the gateway nothing.

## The validator (`identify.parse_answer`)

Each model's answer is checked on its own. It reads the outermost `{…}` (a code fence or a stray sentence is forgiven), then requires a `candidates` list; keeps the first three; requires each to have a name, a kind of `mineral`, `rock` or `other` (any case) and a numeric confidence, clamped to 0..1; collapses whitespace; and stores an empty variety as NULL. An empty list is a real answer that names nothing. Tests whose kind is off the list, or with an empty `how` or `expected`, are dropped, and three at most are kept. `label_text` must be text. Anything else is an `InvalidAnswer` from that model.

## Outcomes (`identify.opinion`, `identify.classify`)

`opinion` turns one model's response into an `Opinion`: a valid answer, or an error in the log's words (`the gateway refused the key (AI_GATEWAY_API_KEY) (401): …`, `invalid answer: candidate 1 (Galena): kind 'gem' is not mineral, rock or other`), with the cost whenever the gateway reported it. `classify` decides the job from the two, in this order:

| What happened | The job becomes |
| --- | --- |
| A 402 from either (the gateway budget is spent) | back to `queued`, no attempt counted; the worker pauses ten minutes. The budget is shared, so the other model's answer is bought again later rather than kept as a lone opinion |
| At least one valid answer that names something | `identified`: each answering model's candidates and suggested tests are written, with the label text (the identifier's first) and each call's cost. One model failing still identifies on the other's opinion, and `error` says which failed and why; the screen never says "probably" on one opinion |
| Valid answers, and none names anything | `rejected`: the confirm screen shows only the name field |
| No valid answer, and a 401 or 403 | `failed` for good, with one ERROR line (a bad key cannot be fixed by retrying) |
| No valid answer, and a 429, a 408, a 5xx, a transport error or an invalid answer | `failed` with backoff, as above. Models vary, so an invalid answer may pass on a second ask |
| Anything else (a 400, an unknown slug's 404) | `failed` for good |

**Known gap:** an answer that names nothing, an invalid answer and a failed attempt have no candidate row to carry their cost, so that spend is only in the log line. A `jobs.cost_usd` column (a migration step) would close it; it was left out to keep the baseline untouched until someone needs the number.

## The worker (`jasper/worker.py`)

`run_once` claims a job, writes a 320 px `<stem>.thumb.jpg` beside each photo (for every processed job, rejected ones included, because the confirm screen shows the photo either way), prepares the images, builds one payload per role, and asks both models side by side on two threads, so a job takes as long as the slower one (about 6 to 9 s). It then classifies, records, and logs one line:

```
job 1 identified: haiku Galena 0.75 · flash Galena 0.85 · $0.0042 · 5.6 s
job 3 identified: haiku Chalcopyrite 0.30 · flash Marcasite 0.55 · $0.0042 · 8.4 s
job 9 identified: haiku Pyrite 0.40 · flash the gateway answered a server error (503) · $0.0009 · 6.1 s
job 12 retry 1 of 5 at 2026-11-01T15:00:30.000Z: haiku … · flash … · $0.0000 · 0.4 s
job 13 failed: haiku the gateway refused the key (AI_GATEWAY_API_KEY) (401): … · flash … · $0.0000 · 0.3 s
```

INFO when both models answered, WARNING when one did not or the job will be tried again, ERROR when it failed for good. The model names in the line are the slugs shortened (`short_name`). An unreadable photo is one warning line and is skipped; a job with no readable photo fails for good without a call. `run_forever` repeats `run_once` with a second between jobs and two when the queue is idle, and pauses ten minutes after a 402. The clock and the ask function are parameters, so the tests run without the network.

Tests: `test_jasper_identify.py` covers the validator (a clean answer, tidying, each missing or malformed field, an unknown test kind dropped, confidence clamped, an empty candidate list, the caps), the prompt file and the schema's test kinds against the table's CHECK, the user message (notes, test answers in words and in order, not tried, free text, unknown kinds), the payload for each role, the settings (defaults, overrides, the same slug twice, no key, the key kept out of `repr`, refusing to start), the response readers, and each status's outcome, including one model failing. `test_jasper_queue.py` covers backoff, claim order, putting back an interrupted job, what each outcome writes (both opinions, one opinion, a re-ask replacing candidates, rejected, quota, failed for good), and `run_once` end to end with a fake ask function: both payloads, photos in order, thumbnails, the rows and the log line, a bad key failing once, and unreadable photos. The HTTP call stays untested.
