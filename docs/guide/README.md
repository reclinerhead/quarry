# The Quarry: technical guide

The living description of how the Quarry is built and why. The root [README](../../README.md) is the design brief; this is the state of the system. Hub and spokes: read this page, then the spoke for the area you are touching, and update that spoke in the same PR as the code.

| Spoke | Covers | Read it when |
| --- | --- | --- |
| [`jasper.md`](jasper.md) | Jasper, the Python worker: the database and its schema | Touching anything under `jasper/`, or the schema |
| [`web.md`](web.md) | The Next.js app: routes, how it reads the database, the visual language | Touching anything under `web/` |

Spokes to come: `ops.md` (what runs on orchid, #10), and the hub's in Phase 4.

## The shape, in one paragraph

One SQLite file per household, in WAL mode. Jasper (`jasper/`) creates and migrates it, and will drain the identification queue and ask the two models through the Vercel AI Gateway (#7); the web app (`web/`) opens the same file with `node:sqlite`, serves every page, and writes the rows that a person's actions create. Photos sit on disk under `QUARRY_DATA/photos/`. Both processes read their configuration from the environment (`.env.example` at the root). Nothing calls a model but Jasper, so the bill has one owner.

## Conventions

- **Tests.** Pure logic gets tests; I/O does not. Python tests are `test_*.py` at the repo root and must be named in `.github/workflows/tests.yml` by hand (there is no discovery fallback). Web tests are `*.test.ts` beside the source and run with `pnpm test` in `web/`.
- **Environment.** The web app reads `process.env["NAME"]` with bracket access so Next cannot inline the value at build time; the boxes set these at runtime.
- **Schema changes** are migration steps appended to `jasper/db.py`, never edits to shipped statements. See `jasper.md`.
- **Copied, not shared.** The worker's database module, the web app's skeleton and the issue templates are copied from the Conservatory and adapted, per the README's open question; a shared package waits until both apps have shipped.
- **Issues are the contract.** Templates in `.github/ISSUE_TEMPLATE/`, copied from the Conservatory.
