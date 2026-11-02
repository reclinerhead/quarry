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
| `/` | The dashboard: the greeting, the pending strip, the collection and the side column; see below | #5, #8, #9 |
| `/add` | Upload from the camera or the camera roll; see below | #6 |
| `POST /api/photos` | One photo in, one queued job out | #6 |
| `GET /api/jobs/[id]` | A job as `readJob` sees it: state, note, test answers, label text, photos, the plan (verdict and pills), the tests the models suggested, and any naming. The add page and the confirm screen poll it | #6, #8 |
| `GET /media/photos/[yyyy]/[mm]/[file]` | A photo, or the thumbnail Jasper writes beside it, from the data directory | #6 |
| `/name` | Sends the person to the oldest stone waiting for a name, or says there is none | #8 |
| `/name/[id]` | The confirm screen, one stone per screen; see below | #8 |
| `POST /api/jobs/[id]/confirm` | Put a name on the stone: `{ pick: { model, rank } }`, `{ typedName }` or `{ sameAsSpecimenId }`, plus an optional `variety` | #8 |
| `PATCH /api/jobs/[id]/confirm` | "How do you know?": `{ how }` | #8 |
| `DELETE /api/jobs/[id]/confirm` | "Change": reverse a naming | #8 |
| `POST /api/jobs/[id]/dismiss` | "Not a rock": delete the job, its photos, their files and thumbnails | #8 |
| `POST /api/jobs/[id]/photos` | Another photo of the same stone; sends the job back to Jasper | #8 |
| `POST /api/jobs/[id]/tests` | "Ask Jasper again with these answers": `{ tests, notes }`, then back to the queue | #8 |
| `GET /api/minerals?q=` | The minerals and rocks already in the collection, for the name field | #8 |
| `/stones/[id]` | One stone: its photos, its specimen label, its tests, how it was named; see below | #9 |
| `PATCH /api/stones/[id]` | Edit a stone's facts or test answers: any of `variety`, `associates`, `foundAt`, `acquired`, `acquiredOn`, `location`, `notes`, `tests`; an empty string clears | #9 |
| `DELETE /api/stones/[id]` | Remove a stone: its photos (rows, files, thumbnails), the jobs that brought them, and the mineral when it was the last | #9 |

## The home page

`app/page.tsx` is the dashboard from DESIGN.md §5, as far as Phase 1 has data for it. The hardness filter, the Mohs set and what new stones add to the periodic table wait for Mindat in Phase 2; the catalog dab on each card waits for Phase 3.

- **The greeting** (`lib/greeting.ts`, tested) has three parts:
  - the date ("Sunday, November 1");
  - "Good evening.";
  - what changed: "Two new stones today." (`addedToday` and `whatChanged` in `lib/collection.ts`, counted in the station's time zone), or "Your collection starts here." while it is empty.
- **The pending strip** (DESIGN.md §4), drawn on the server only when something waits, so it never pops in:
  - It's an amber card with up to three overlapping 72 px thumbnails and "3 rocks waiting for a name".
  - Under that is the first stone's line (`stripLine` in `lib/pills.ts`): "Jasper's guess for the first one: could be Chalcopyrite or Marcasite." When the models are torn, it adds the first suggested test: "A steel nail would tell them apart."
  - "Name them" goes to `/name`.
  - `waitingStrip` in `lib/jobs.ts` reads it.
- **While the collection is empty:** one card in the specimen card's shape, "No stones yet" with "Add the first one", beside faint placeholder cards that show the grid it will fill. Each placeholder appears only where the grid has a column for it (from `sm`, `lg` and `xl`), so a phone shows the one card.
- **Once there are stones**, two columns, DESIGN.md's flex split: the collection (`flex: 999 1 600px`) and the side column (`flex: 1 1 320px`, at most 400 px), which drops below on a phone and is never sticky.

### Your collection

`components/collection.tsx` over the pure shape in `lib/collection.ts` (tested), the Conservatory's pattern. The server sends every stone as a `Tile` (`collectionTiles` in `lib/specimens.ts`): name, kind, variety, where it came from, how it came, where it lives, when it was added (the "Nov 1" label worked out on the server, in the station's time zone, so server and phone never disagree) and the newest photo's 320 px thumbnail, never an original. The phone filters and sorts, so a search makes no request.

- **The count line:** "Showing 12 of 47 stones", or "Showing 3 stones that match" once anything filters (`countLine`).
- **Sort by**, a native `<select>`: Name, A to Z (the default) or Newest first.
- **The filter chips Phase 1 has data for** (`filterChips`):
  - Everything;
  - Minerals, and Rocks and fossils (anything that isn't a mineral), one kind at a time;
  - Found it myself, and Bought or gifted (a gift or a trade counts), one source at a time.

  The two groups combine. Counts come from the whole collection, so the row never changes shape while a person types, and a chip with nobody in it is left out. "Clear filters" appears once anything filters.
- **The top bar's search** matches any part of the name, the variety or where it came from, ignoring case and punctuation (`matchesQuery`, through `norm`).
- **All of it lives in the URL** (`?q=`, `?kind=`, `?from=`, `?sort=`), written with the native `history.replaceState`, which Next syncs with `useSearchParams`. The back button returns to the same view, and the top bar's box and the grid agree. The top bar reads the URL behind a `Suspense` boundary because `/add` is static.
- **No match** draws a dashed card, "No stones match those choices.", with "Show everything".
- **Specimen cards** (`StoneCard`, DESIGN.md §4), each one link to `/stones/[id]`:
  - the thumbnail, 220 px, or a tinted "No photo yet" tile, the tint varied between neighbours;
  - the name in Zilla 24;
  - the variety line, reserved when there is none so cards in a row line up;
  - "Glass case · added Nov 1";
  - the kind as a tag.

### The side column

- **Newest additions:** four rows, each a whole 64 px link (thumbnail, name, "added Nov 1"), then "See everything by date" (`/?sort=new`).
- **At a glance:** four stat tiles, stones, different minerals, kinds of rock and places they live (`glance`), each a number over a phrase.
- **Where they live:** each place with its count, most stones first (`places`), or a line saying where to record one.

## A stone

`app/stones/[id]/page.tsx` is one stone, read by `readStone` in `lib/specimens.ts`. It is DESIGN.md §5's specimen page as far as Phase 1 goes. Mineral properties, handling notes, elements, the Mohs scale, relatives, the story log and the box label arrive with Phases 2 and 3.

- **The breadcrumb** ("Collection › Galena").
- **The title block:** the name at 60 px (40 on a phone), the variety under it, and tags for the kind, the photo count, how many of that mineral the collection holds, and when it was added.
- **The gallery** (`components/gallery.tsx`):
  - The hero is in the dark photo well, 640 px tall (360 on a phone), contained rather than cropped, with a caption, "Your photo · Oct 31, 2026".
  - With more than one photo, "More photos of this stone" is a 2-across grid of thumbnail buttons that swap the hero (aria-pressed, a 4 px azurite border).
  - Photos are newest first, by `taken_at`, else upload time.
  - `components/photo-view.tsx`, shared with the confirm screen, falls back from a HEIC original a desktop browser cannot draw to Jasper's thumbnail.
- **This specimen** (`components/stone-editor.tsx`) is the specimen label: paper, a double rule, the name over a 2 px ink rule, and Courier field names.
  - The fields are variety, also on it (`associates`), where from, how it came, when, lives in, and notes.
  - An unknown reads "Not recorded yet" with an Add link.
  - An amber note counts the details a collector's label wants (`missingDetails`, tested: where from, how, when, where it lives; never the extras), with "Fill in details".
  - Any of those, or "Edit details", turns the label into one form with a single Save (`PATCH /api/stones/[id]`) and focuses the field that was asked for. How it came is chips, with a dashed "Not recorded"; where it lives offers every place already in use.
- **Kitchen-table tests** (`components/tests-editor.tsx`):
  - The confirm screen's `TestRow`s, editable in place.
  - The tests already answered come first (with none, the four DESIGN.md names: glass, streak, vinegar, magnet), and the rest wait behind "Other tests".
  - Which rows show first is fixed when the page opens, so a save never moves them.
  - "Save the answers" appears once something changed, and "Not saved yet." says so meanwhile.
  - The check against Mindat arrives in Phase 2.
- **How it was named**, from the job whose naming made the stone (`readJob`):
  - Jasper's pills as they were: the chosen name solid azurite with a check, the others outlined with their word. A typed name no model offered leads, marked "typed by you".
  - The date, and how the person knew (`HOW_SUMMARY` in `lib/naming.ts`, beside the confirm screen's chip labels).
  - How many more photos were added as the same stone.
  - "Change the name", which goes to that job's confirm screen.
- **Remove** (`RemoveStone`): two taps, "Remove this stone" then "Yes, remove it", with "Keep it" to back out. `DELETE /api/stones/[id]` removes the photo rows and the jobs that brought them, found through the photos and through the stone's confirmations; candidates, suggested tests and confirmations cascade. It then removes the stone, and the mineral if it was the last of its kind, and unlinks the files and their thumbnails. Then home.

Tests: `lib/collection.test.ts` (search, the kind and source filters, both sorts, the chips, the count line, the side column, date labels, what changed today, missing details) and `lib/greeting.test.ts`.

## Adding a rock

Both of the README's ways in, the camera-roll batch after a trip and the photo taken at the kitchen table, go through one page and one route. `components/uploader.tsx` is the client side:

- **Two inputs.** "Take a photo" is a file input with `capture="environment"`; "Choose from your photos" takes `multiple` and names `.heic` and `.heif` in `accept`. Either appends to the same list. Under them, an info note gives the README's photo advice: one close-up in daylight, one with a coin beside it for scale, one of any label or tag.
- **One note per batch.** "Anything you know about these?" (optional: where they were found or bought, and roughly when) goes with every photo sent and becomes each job's `notes`, which Jasper puts in front of the models. It is read-only while a batch sends, so one batch shares one note. A single stone's note is edited on the confirm screen (#8).
- **Shrink before sending** (`lib/shrink.ts`): `createImageBitmap` with orientation from EXIF, drawn to a canvas at most 1280 px on the long side, JPEG at 0.9. A 3 MB phone photo becomes about 270 KB, which is the difference between working and not on a weak Wi-Fi. If the browser cannot decode the file (HEIC on a desktop browser), the original is sent, the row shows "No preview", and Jasper re-encodes it.
- **The date survives the shrink** (`lib/exif.ts`): the re-encode drops EXIF, so `DateTimeOriginal` (else IFD0's `DateTime`) is read from the original bytes first and sent as `takenAt`. Two walks, no library: a JPEG's APP1 segment, and a HEIC's `Exif` item, found through the `meta` box's `iinf` (which item is Exif) and `iloc` (where its bytes are). Safari hands an iPhone's HEIC over as is when `accept` names HEIC, so without the second walk no iPhone photo would keep its date. A file it cannot read gives null, never a throw.
- **One request per photo, with retry** (`lib/retry.ts`): five tries with waits doubling from 1 s (15 s in all), each try cut off after 60 s so a request the Wi-Fi dropped mid-way cannot hang the batch. A 4xx other than 408 or 429 is `NoRetry`. Photos go one at a time, and each row shows its own state and try count. A photo that runs out of tries says why in words and stays in the list for "Send it again"; the rest of the batch carries on. A photo removed while the batch sends is skipped when its turn comes. Item keys are a counter, not `crypto.randomUUID`, which a phone on the house's plain-http LAN does not have.
- **Then it polls.** Each sent photo's job is fetched from `/api/jobs/[id]` every 1.5 s (a round starts after the last one answered) until Jasper is done with it: "Waiting for Jasper", "Jasper is looking at it…", then "Ready to name" with Jasper's verdict ("Probably Galena.") and a link to `/name/[id]` (#8). A row waiting for a name turns amber, DESIGN.md's "needs you". A rejected job is ready to name too ("Jasper had no guess"). A `failed` job with a `next_attempt_at` is one Jasper will retry, so its row keeps waiting; one without is failed for good, and its row says Jasper couldn't look at it and links to the confirm screen to name it by hand.
- **Nothing is kept in the browser.** The camera roll is the offline mode: a photo not yet sent when the page closes is still on the phone.

`POST /api/photos` opens the database first (503 while Jasper has not created it, before anything is written). It then writes the file and inserts the `jobs` row (`queued`, carrying the note, trimmed to 1000 characters, NULL when empty) and the `photos` row (`taken_at` when the EXIF had a date) in one `BEGIN IMMEDIATE`; a file whose rows fail to go in is deleted. Limits: 25 MB, and image types or `application/octet-stream` only. There is no idempotency key: a request whose response is lost after the commit is retried into a second job for the same photo, which is rare and visible, and cheaper than a column.

`GET /api/jobs/[id]` answers a `JobView` (`lib/jobs.ts`), uncached; see Naming a stone. `GET /media/...` serves files with a year-long immutable cache behind `mediaRelPath`, a guard that accepts exactly `photos/<four-digit year>/<01 to 12>/<file>` with a plain file name and a jpg, jpeg, png or heic extension, and nothing a filesystem could interpret.

### The data directory

```
QUARRY_DATA/
  quarry.db                          the default QUARRY_DB
  photos/yyyy/mm/<uuid>.jpg          an upload: usually the browser's 1280 px JPEG
  photos/yyyy/mm/<uuid>.heic         a HEIC the browser could not decode
  photos/yyyy/mm/<uuid>.thumb.jpg    Jasper's thumbnail of it (#7)
```

The folder is the upload's month in UTC, not the EXIF date, so a folder is never surprising. Names are UUIDs written once. The extension comes from the MIME type, else `.heic` for a HEIC-named file a browser sent untyped, else `.jpg`; Jasper opens files by their content, not their extension.

Tests:
- `lib/photos.test.ts`: paths, the thumbnail's name, the extension rule, the media guard, the caption's date.
- `lib/exif.test.ts`: the APP1 walk against hand-built JPEGs in both byte orders with the IFD0 fallback, and the HEIC walk against hand-built `meta` boxes in two `iloc` versions.
- `lib/retry.test.ts`.

## Naming a stone

`components/namer.tsx` is the confirm screen, one stone per screen, on the Conservatory's namer. It serves both flows: a person walking the strip, and one at the kitchen table whose job has not settled yet. The screen polls `/api/jobs/[id]` every 1.5 s with the pill area reserved until Jasper answers. `isSettled` (`lib/job-state.ts`, pure, shared with the add page) says when Jasper is done: identified, rejected, or failed with no next attempt.

**What it says** comes from Phase 0 (#1): two opinions, in words.
- **The plan.** `readJob` builds it on the server with `planPills` (`lib/pills.ts`, pure, tested on the shapes of Mom's stones) from the candidates rows. It is recomputed on every read, so the rule can change without rewriting rows.
- **The identifier.** Its first choice leads when the models disagree. It is `QUARRY_IDENTIFIER` with Jasper's default, read at runtime.
- **"Probably X"**: both models' first choices name the same stone. One lead pill, with a 2 px azurite border and an `azurite-soft` "probably" tag, then up to two "could also be" pills from the rest of both lists.
- **"Could be X or Y"**: they differ. Each model's first choice becomes a pill, the identifier's first, then one more.
- **One opinion** (the other model failed): its candidates as "could be", never "probably".
- **No guess**: a rejected job, or one that failed for good. The name field leads.
- **Matching.** "The same stone" is `sameStone` (`lib/names.ts`, tested on the spike's cases), the spike's whole-word matching made symmetric. Names match as whole words either way round (Specular hematite is Hematite; Chalcopyrite is not Pyrite). A variety matches only the other's whole name (Quartz, variety Amethyst is Amethyst). Varieties are never matched word by word, because models put colour words there, and "Purple" would make a fluorite and an amethyst agree.
- **Duplicates.** A candidate naming a stone already on a pill adds its model to that pill.
- **No percentages, ever.** The screen's line says why, with the "two opinions" info mark. `verdictLine` puts the plan in one line for the strip and the add page's rows.

**What's on it:**
- **The photo**, contained in the dark photo well, 280 px tall on a phone so the verdict is on the first screen, 520 px from `sm`. It carries a caption with the EXIF date (`takenLabel`, read from the text so server and phone agree) and thumbnails to switch between photos. A HEIC original a desktop browser cannot draw falls back to Jasper's 320 px thumbnail, and to "No preview on this device" before there is one. The fallback is checked on mount as well as on `error`, because the server-rendered image fails before React is listening.
- **Any label the models read**, as a paper tag in Courier: "Jasper read a label in the photo".
- **The pills.** One tap names the stone.
- **"Variety or shop name"** (optional). It becomes `specimens.variety`; left empty, a pill's own variety is used.
- **The name field**, always on the screen, because "could be" never promises the answer is among the pills. Under it, chips for the minerals already in the collection (`rankMinerals` in `lib/minerals.ts`, tested): the household's own most-owned first, or matches of the typed text, names that start with it first.
- **"Want to be sure? Try a test"** opens `components/tests-panel.tsx`. The household tests are in `lib/household-tests.ts`: their kinds, which are the schema's and Jasper's, and questions worded the way Jasper words the answers back.
  - The tests the models suggested come first (`suggestedOrder`: the identifier's first, each kind once), each with the model's "how" and "what to look for". The rest wait behind "Other tests".
  - Answers are chips: Yes and No, or a streak colour. "Not tried" is a dashed chip and is never stored as no.
  - The stone's note is editable there too.
  - "Ask Jasper again with these answers" saves both on the job and sends it back to the queue (`POST .../tests`; `cleanAnswers` keeps only `yes`, `no` and a streak colour, and leaves a test not tried out of the JSON).
  - The old pills stay, dimmed, under "Jasper is asking again", until Jasper's new answer replaces them.
- **"Same stone as the last one"** (`lastNamedStone`) merges this photo into the stone named most recently.
- **"Not a rock"** is two taps, then deletes the job, its photos, and their files and thumbnails.
- **"Add another photo of this stone"** stores a photo on the same job (at most five, Jasper's limit) and sends it back to the queue.
- **"Skip for now"** goes to the next waiting job; **"Done for now"** goes home.

**Naming saves at once.** `POST .../confirm` does it all in one `BEGIN IMMEDIATE`:
- it finds or creates the mineral (`minerals.name` is `COLLATE NOCASE`, so "galena" finds "Galena");
- it creates the specimen with the variety and the job's notes and test answers;
- it links the photos;
- it writes the confirmation.

The confirmation records:
- `chosen_name`;
- `source`: `pill`, `typed` or `same_as_last`;
- `how`: a pill is `suggestion`, a typed name `guess`, and another photo inherits the stone's first naming;
- `verdict`: what the screen said, recomputed from the candidates on the server rather than taken from the request.

A typed name that one of the models also gave takes that candidate's spelling and kind; any other is a mineral until Phase 2's Mindat lookup says otherwise.

**The named state** is a specimen label (paper, double rule, the name over a 2 px ink rule).
- **"How do you know?"** Five chips: I took Jasper's suggestion, From a label or tag, The tests settled it, Someone who knows told me, My best guess. A tap saves through `PATCH .../confirm`, with "Saved." in reserved space. Only a label, the tests and someone who knows count as known answers (README). "My best guess" is there so that a typed name is never counted as known by default.
- **"Next stone"**: `nextWaitingJob` (`lib/jobs.ts`, tested): the next later job, wrapping to the first, or home when nothing else waits.
- **"Change"**: `DELETE .../confirm` reverses a naming. The confirmation goes and the photos unlink. The specimen is deleted if nothing else is attached to it, and the mineral too if no specimen is left. The job is back in the strip with its pills, since naming never deletes candidates.

**Waiting** is `waitingJobIds`: jobs Jasper is done with and nobody has named, oldest first. That includes a job that failed for good, so the person can still name it by hand.

**The first info marks** are here (`components/term.tsx` over `lib/glossary.ts`): two opinions, variety, and the idea behind each test (hardness, streak, fizz, magnetic, glows under UV). A test checks that each entry runs two or three sentences and that every test kind has one. The mark is DESIGN.md's 28 px ring, with an invisible ±10 px hit area. Its note floats under the mark in sand rather than opening in place, so opening one moves nothing. That is the Conservatory's choice: the no-layout-shift rule outranks the canvas's inline block.

Tests:
- `lib/names.test.ts`, `lib/pills.test.ts`, `lib/household-tests.test.ts`, `lib/minerals.test.ts`;
- `lib/jobs.test.ts`: `nextWaitingJob` and `isSettled`;
- `lib/glossary.test.ts`.

## The visual language

DESIGN.md is the reference and `design/tokens.css` the values, imported as the Tailwind theme. `app/globals.css` writes down DESIGN.md §4's component recipes as screens first need them: `btn` (48 px, `btn-lg` 52 px for the page's main action) with `btn-primary` (azurite) and `btn-soft` (sand), and a disabled state only for a button that is working ("Sending…"), since a button that can do nothing is not drawn; `chip` (a 48 px white pill; `aria-pressed="true"` is azurite, always drawn with a check icon so selection never relies on colour; `chip-dashed` is "Not tried"), `card` (with `card-link`, which lifts on hover), `tag` (15 px, sand), `select` (a 50 px pill around a native `<select>`, its chevron drawn in the markup), `text-link` (DESIGN.md's underlined azurite for "Clear filters", "Change", "Add"), `nav-pill` (the current page in `sand-2` through `aria-current`), and `field` (a 52 px pill around a bare `<input>` that fills it, so the focus ring goes on the pill and the whole pill is the target). Base rules: Zilla Slab 600 for headings, azurite links, a 3 px azurite focus ring. The root font size stays 16 px so Tailwind's spacing scale is the standard one; the body is 18 px (`text-body`), the floor for anything read.

The faces are self-hosted by `next/font` in `app/layout.tsx` (Zilla Slab 600 and 700; Atkinson Hyperlegible 400 and 700 with its italic; Courier Prime 400 and 700), whose variables feed the font tokens, so the stations make no font requests. Line icons live in `components/icons.tsx` (the gem mark, the crystal for tiles with no photo, the camera, the check on a selected chip, the camera roll's photo, and the sun, coin and tag of the add page's photo tips).

**The top bar** (`components/topbar.tsx`): the gem mark and wordmark, a nav pill for each page that exists (Collection today; Minerals, Periodic table, Labels and Gem Show join with their phases, rather than being drawn dead), the search ("Search your rocks": on the collection it filters as you type through `?q=`; anywhere else Enter goes to `/?q=`), the primary "Add a rock", then the strata band. Below `lg` it is two rows, the wordmark with Add, then the nav with the search; on a phone Add reads "Add" with "a rock" kept for screen readers. From `lg` it is the canvas's one row.

### Rules every screen keeps

- No layout shift: empty states reserve the populated space.
- Every target is at least 48 px, 52 for the main action; 18 px is the floor for reading text, 15 px the smallest anywhere.
- Every surface works on a 390 px phone with 16 px gutters and no sideways scroll, and uses a laptop's width.
- The app teaches: every mineralogical term gets an info mark (`components/term.tsx`, with its entry in `lib/glossary.ts`).
- Rows from `node:sqlite` have a null prototype, which React refuses to pass to a client component: map them to plain objects before they cross (`readJob`, `lastNamedStone`, `collectionTiles`, `readStone`).
- Text that follows a `{expression}` in JSX and starts with an entity (`&ldquo;`) loses the space between them; write such a sentence as one string.
