# The web app

`web/` is a Next.js 16 App Router app on the Conservatory's stack: React 19 with the React Compiler, TypeScript, Tailwind CSS 4, `node:sqlite` for the database, pnpm, Vitest. It serves every page a person sees and writes the rows their actions create. It never calls a model.

## Running it

```powershell
cd web
pnpm install
pnpm dev
```

`allowedDevOrigins` in `next.config.ts` lets a phone on the house subnet reach the dev server. `turbopack.root` there is the repo root, not `web/`: `app/globals.css` imports `design/tokens.css` from outside `web/`, and Turbopack reads nothing outside its root (without it `pnpm dev` panics on every page, as the Conservatory found in its #31). The same root bounds the build's file tracing, which is why `lib/db.ts` marks its runtime database path `turbopackIgnore` both where it is built and where it is checked. `pnpm test` runs Vitest once; `pnpm build` is the production build the boxes will run with `pnpm start`.

## Reading the database

`lib/db.ts` opens `QUARRY_DB` (default `../data/quarry.db`, resolved against `web/`) with `node:sqlite`'s `DatabaseSync`: `openReadOnly` for pages (returns `null` when the file does not exist yet, so a fresh checkout renders honest zeros instead of crashing) and `openReadWrite` for the routes that record a person's actions (sets a 5 s busy timeout because Jasper writes to the same file, and foreign keys on). The environment is read with bracket access (`process.env["QUARRY_DB"]`) on purpose: Next inlines a static `process.env.FOO` at build time, and these values belong to the box at runtime. Pages that read the database export `dynamic = "force-dynamic"` so their answers come from the request, never from the build. `dataDir()` resolves `QUARRY_DATA` the same way.

## Routes

| Route | What | Status |
| --- | --- | --- |
| `/` | The home page: the greeting, and the collection's empty state; see below | #5 |
| `/add` | Upload from the camera or the camera roll; see below | #6 |
| `POST /api/photos` | One photo in, one queued job out | #6 |
| `GET /api/jobs/[id]` | A job's state, its note and its photos; the add page polls it | #6 |
| `GET /media/photos/[yyyy]/[mm]/[file]` | A photo, or the thumbnail Jasper writes beside it, from the data directory | #6 |

## The home page

`app/page.tsx` is the dashboard from DESIGN.md §5, as far as there is data for it:

- **The greeting** (`lib/greeting.ts`, tested): the date ("Sunday, November 1", in the station's time zone), then "Good evening." with "Your collection starts here." while there are no stones. The line that says what changed arrives with the collection (#9).
- **Your collection**: the count line ("No stones yet", "1 stone"), and while it is empty, one card in the specimen card's shape, "No stones yet" with "Add the first one", beside faint placeholder cards that show the grid it will fill. Each placeholder appears only where the grid has a column for it (from `sm`, `lg` and `xl`), so a phone shows the one card.
- The pending strip (#8) and the cards, filters and side column (#9) arrive with the issues that have data for them; their space is not faked.

## Adding a rock

Both of the README's ways in, the camera-roll batch after a trip and the photo taken at the kitchen table, go through one page and one route. `components/uploader.tsx` is the client side:

- **Two inputs.** "Take a photo" is a file input with `capture="environment"`; "Choose from your photos" takes `multiple` and names `.heic` and `.heif` in `accept`. Either appends to the same list. Under them, an info note gives the README's photo advice: one close-up in daylight, one with a coin beside it for scale, one of any label or tag.
- **One note per batch.** "Anything you know about these?" (optional: where they were found or bought, and roughly when) goes with every photo sent and becomes each job's `notes`, which Jasper puts in front of the models. It is read-only while a batch sends, so one batch shares one note. A single stone's note is edited on the confirm screen (#8).
- **Shrink before sending** (`lib/shrink.ts`): `createImageBitmap` with orientation from EXIF, drawn to a canvas at most 1280 px on the long side, JPEG at 0.9. A 3 MB phone photo becomes about 270 KB, which is the difference between working and not on a weak Wi-Fi. If the browser cannot decode the file (HEIC on a desktop browser), the original is sent, the row shows "No preview", and Jasper re-encodes it.
- **The date survives the shrink** (`lib/exif.ts`): the re-encode drops EXIF, so `DateTimeOriginal` (else IFD0's `DateTime`) is read from the original bytes first and sent as `takenAt`. Two walks, no library: a JPEG's APP1 segment, and a HEIC's `Exif` item, found through the `meta` box's `iinf` (which item is Exif) and `iloc` (where its bytes are). Safari hands an iPhone's HEIC over as is when `accept` names HEIC, so without the second walk no iPhone photo would keep its date. A file it cannot read gives null, never a throw.
- **One request per photo, with retry** (`lib/retry.ts`): five tries with waits doubling from 1 s (15 s in all), each try cut off after 60 s so a request the Wi-Fi dropped mid-way cannot hang the batch. A 4xx other than 408 or 429 is `NoRetry`. Photos go one at a time, and each row shows its own state and try count. A photo that runs out of tries says why in words and stays in the list for "Send it again"; the rest of the batch carries on. A photo removed while the batch sends is skipped when its turn comes. Item keys are a counter, not `crypto.randomUUID`, which a phone on the house's plain-http LAN does not have.
- **Then it polls.** Each sent photo's job is fetched from `/api/jobs/[id]` every 1.5 s (a round starts after the last one answered) until Jasper is done with it: "Waiting for Jasper", "Jasper is looking at it…", then "Ready to name" with a link to `/name/[id]` (#8). A row waiting for a name turns amber, DESIGN.md's "needs you". A rejected job is ready to name too ("Jasper had no guess"). A `failed` job with a `next_attempt_at` is one Jasper will retry, so its row keeps waiting; one without is failed for good, and its row says Jasper couldn't look at it and links to the confirm screen to name it by hand.
- **Nothing is kept in the browser.** The camera roll is the offline mode: a photo not yet sent when the page closes is still on the phone.

`POST /api/photos` opens the database first (503 while Jasper has not created it, before anything is written). It then writes the file and inserts the `jobs` row (`queued`, carrying the note, trimmed to 1000 characters, NULL when empty) and the `photos` row (`taken_at` when the EXIF had a date) in one `BEGIN IMMEDIATE`; a file whose rows fail to go in is deleted. Limits: 25 MB, and image types or `application/octet-stream` only. There is no idempotency key: a request whose response is lost after the commit is retried into a second job for the same photo, which is rare and visible, and cheaper than a column.

`GET /api/jobs/[id]` answers `{ id, status, error, nextAttemptAt, notes, photos: [{ id, url, takenAt }] }`, uncached; the confirm screen (#8) adds the candidates. `GET /media/...` serves files with a year-long immutable cache behind `mediaRelPath`, a guard that accepts exactly `photos/<four-digit year>/<01 to 12>/<file>` with a plain file name and a jpg, jpeg, png or heic extension, and nothing a filesystem could interpret.

### The data directory

```
QUARRY_DATA/
  quarry.db                          the default QUARRY_DB
  photos/yyyy/mm/<uuid>.jpg          an upload: usually the browser's 1280 px JPEG
  photos/yyyy/mm/<uuid>.heic         a HEIC the browser could not decode
  photos/yyyy/mm/<uuid>.thumb.jpg    Jasper's thumbnail of it (#7)
```

The folder is the upload's month in UTC, not the EXIF date, so a folder is never surprising. Names are UUIDs written once. The extension comes from the MIME type, else `.heic` for a HEIC-named file a browser sent untyped, else `.jpg`; Jasper opens files by their content, not their extension.

Tests: `lib/photos.test.ts` (paths, the extension rule, the media guard), `lib/exif.test.ts` (the APP1 walk against hand-built JPEGs in both byte orders with the IFD0 fallback, and the HEIC walk against hand-built `meta` boxes in two `iloc` versions), `lib/retry.test.ts`.

## The visual language

DESIGN.md is the reference and `design/tokens.css` the values, imported as the Tailwind theme. `app/globals.css` writes down DESIGN.md §4's component recipes as screens first need them: `btn` (48 px, `btn-lg` 52 px for the page's main action) with `btn-primary` (azurite) and `btn-soft` (sand), and a disabled state only for a button that is working ("Sending…"), since a button that can do nothing is not drawn; `card`, `nav-pill` (the current page in `sand-2` through `aria-current`), and `field` (a 52 px pill `<label>` around a bare `<input>`, so the focus ring goes on the pill). Base rules: Zilla Slab 600 for headings, azurite links, a 3 px azurite focus ring. The root font size stays 16 px so Tailwind's spacing scale is the standard one; the body is 18 px (`text-body`), the floor for anything read.

The faces are self-hosted by `next/font` in `app/layout.tsx` (Zilla Slab 600 and 700; Atkinson Hyperlegible 400 and 700 with its italic; Courier Prime 400 and 700), whose variables feed the font tokens, so the stations make no font requests. Line icons live in `components/icons.tsx` (the gem mark, the crystal for tiles with no photo, the camera, the camera roll's photo, and the sun, coin and tag of the add page's photo tips).

**The top bar** (`components/topbar.tsx`): the gem mark and wordmark, a nav pill for each page that exists (Collection today; Minerals, Periodic table, Labels and Gem Show join with their phases, rather than being drawn dead), the search (a plain form that sends `?q=` to `/`; the collection wires it up in #9), the primary "Add a rock", then the strata band. Below `lg` it is two rows, the wordmark with Add, then the nav with the search; on a phone Add reads "Add" with "a rock" kept for screen readers. From `lg` it is the canvas's one row.

### Rules every screen keeps

- No layout shift: empty states reserve the populated space.
- Every target is at least 48 px, 52 for the main action; 18 px is the floor for reading text, 15 px the smallest anywhere.
- Every surface works on a 390 px phone with 16 px gutters and no sideways scroll, and uses a laptop's width.
- The app teaches: every mineralogical term gets an info mark (the first arrive with #8).
