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
| `/` | The dashboard: the greeting, the pending strip, the collection and the side column; see below | #5, #8, #9, #31 |
| `/add` | Upload from the camera or the camera roll, one rock at a time; see below | #6, #17, #31 |
| `POST /api/photos` | One photo in, stored without a job | #6, #17 |
| `POST /api/jobs` | One rock in: `{ photoIds, notes }` becomes one queued job | #17 |
| `GET /api/jobs/[id]` | A job as `readJob` sees it: state, note, test answers, label text, photos, the plan (verdict and pills), the tests the models suggested, and any naming. The add page, the confirm screen and the dashboard's strip poll it | #6, #8, #31 |
| `GET /media/photos/[yyyy]/[mm]/[file]` | A photo, or the thumbnail Jasper writes beside it, from the data directory | #6 |
| `/name` | Sends the person to the oldest stone waiting for a name, or says there is none | #8 |
| `/name/[id]` | The confirm screen, one stone per screen; see below | #8 |
| `POST /api/jobs/[id]/confirm` | Put a name on the stone: `{ pick: { model, rank } }`, `{ typedName }` or `{ sameAsSpecimenId }`, plus an optional `variety`, and with a pick the one-opinion minerals the person ticked, `maybe: string[]` | #8, #29 |
| `PATCH /api/jobs/[id]/confirm` | "How do you know?": `{ how }` | #8 |
| `DELETE /api/jobs/[id]/confirm` | "Change": reverse a naming | #8 |
| `POST /api/jobs/[id]/dismiss` | "Not a rock": delete the job, its photos, their files and thumbnails | #8 |
| `POST /api/jobs/[id]/photos` | Another photo of the same stone; sends the job back to Jasper | #8 |
| `POST /api/jobs/[id]/tests` | "Ask Jasper again with these answers": `{ tests, notes }`, then back to the queue | #8 |
| `GET /api/minerals?q=` | The minerals and rocks already in the collection, for the name field | #8 |
| `/stones/[id]` | One stone: its photos, its specimen label, its tests, how it was named; see below | #9 |
| `PATCH /api/stones/[id]` | Edit a stone's facts or test answers: any of `variety`, `parts` (`{ with: string[], on: string \| null }`, `on` possibly `"matrix"`; replaces them all), `foundAt`, `acquired`, `acquiredOn`, `location`, `notes`, `tests`; an empty string clears | #9, #29 |
| `DELETE /api/stones/[id]` | Remove a stone: its photos (rows, files, thumbnails), the jobs that brought them, and each of its minerals no stone uses any more | #9 |

## The home page

`app/page.tsx` is the dashboard from DESIGN.md §5, as far as Phase 1 has data for it. The hardness filter, the Mohs set and what new stones add to the periodic table wait for Mindat in Phase 2; the catalog dab on each card waits for Phase 3.

- **The greeting** (`lib/greeting.ts`, tested) has three parts:
  - the date ("Sunday, November 1");
  - "Good evening.";
  - what changed: "Two new stones today." (`addedToday` and `whatChanged` in `lib/collection.ts`, counted in the station's time zone), or "Your collection starts here." while it is empty.
- **The pending strip** (DESIGN.md §4), drawn on the server, so it never pops in:
  - It's an amber card with up to three overlapping 72 px thumbnails and "3 rocks waiting for a name".
  - Under that is the first stone's line (`stripLine` in `lib/pills.ts`): "Jasper's guess for the first one: could be Chalcopyrite or Marcasite." When the models are torn, it adds the first suggested test: "A steel nail would tell them apart."
  - "Name them" goes to `/name`.
  - `waitingStrip` in `lib/jobs.ts` reads it.
  - **While Jasper still has rocks and none waits for a name**, the strip's place is held by a plain white card in the same shape: the rocks' thumbnails, "2 rocks waiting for Jasper", Jasper at work under it, and the amber strip's button drawn `invisible` (out of the tab order and unread) so its room is kept. `workingStrip` in `lib/jobs.ts` reads it. Its predicate, `WORKING`, is `WAITING`'s complement among unnamed jobs: queued, identifying, or failed with a next attempt. Jasper writes a job's thumbnails when he claims it, so a rock he hasn't started has none; `workingStrip` checks the file and sends null, drawn as the crystal placeholder.
  - **It turns amber on its own.** While Jasper has rocks, `components/strip-watch.tsx` asks after each one through `GET /api/jobs/[id]` every 2 s. Once one is settled (`isSettled`) or answers 404 (dismissed), it calls `router.refresh()` from `next/navigation`'s `useRouter`, which re-renders the server components and keeps client state and the scroll. That is not `refresh` from `next/cache`, which works only inside Server Actions. The refresh hands back the jobs still out, which starts the next watch. When rocks wait for a name and others are still out, the strip is the amber one and the watch keeps its count and thumbnails current. With nothing out there is no poll, so a rock sent from another phone after the dashboard was opened appears only on the next load.
  - The two states are the same height at laptop width, where the strip is one row. On a phone, Jasper's line for the first rock usually runs to two lines and the working line is one, so the strip grows by a line when it turns amber.
- **While the collection is empty:** one card in the specimen card's shape, "No stones yet" with "Add the first one", beside faint placeholder cards that show the grid it will fill. Each placeholder appears only where the grid has a column for it (from `sm`, `lg` and `xl`), so a phone shows the one card.
- **Once there are stones**, two columns, DESIGN.md's flex split: the collection (`flex: 999 1 600px`) and the side column (`flex: 1 1 320px`, at most 400 px), which drops below on a phone and is never sticky.

### Your collection

`components/collection.tsx` over the pure shape in `lib/collection.ts` (tested), the Conservatory's pattern. The server sends every stone as a `Tile` (`collectionTiles` in `lib/specimens.ts`): name, kind, the mineral's class, variety, the other minerals on it, where it came from, how it came, where it lives, when it was added (the "Nov 1" label worked out on the server, in the station's time zone, so server and phone never disagree) and the newest photo's 320 px thumbnail, never an original. The phone filters and sorts, so a search makes no request.

- **The count line:** "Showing 12 of 47 stones", or "Showing 3 stones that match" once anything filters (`countLine`).
- **Sort by**, a native `<select>`: Name, A to Z (the default, by the name the card shows, so an amethyst is under A) or Newest first.
- **The filter chips Phase 1 has data for** (`filterChips`):
  - Everything;
  - Minerals, and Rocks and fossils (anything that isn't a mineral), one kind at a time;
  - Found it myself, and Bought or gifted (a gift or a trade counts), one source at a time.

  The two groups combine. Counts come from the whole collection, so the row never changes shape while a person types, and a chip with nobody in it is left out. "Clear filters" appears once anything filters.
- **The top bar's search** matches any part of the name, the variety, the other minerals on it ("pyrite" finds Fluorite with Pyrite) or where it came from, ignoring case and punctuation (`matchesQuery`, through `norm`).
- **All of it lives in the URL** (`?q=`, `?kind=`, `?from=`, `?sort=`), written with the native `history.replaceState`, which Next syncs with `useSearchParams`. The back button returns to the same view, and the top bar's box and the grid agree. The top bar reads the URL behind a `Suspense` boundary because `/add` is static.
- **No match** draws a dashed card, "No stones match those choices.", with "Show everything".
- **Specimen cards** (`StoneCard`, DESIGN.md §4), each one link to `/stones/[id]`:
  - the thumbnail, 220 px, or a tinted "No photo yet" tile, the tint varied between neighbours;
  - the piece's name (see "Naming a stone") in Zilla 24, wrapping rather than cut;
  - "A kind of Quartz" under a hobby name (`kindOf`); a stone whose name already says the mineral has no line there, the meta line follows the name directly;
  - "Glass case · added Nov 1";
  - the kind as a tag, then the mineral's class ("Sulfide", #38) by the specimen page's rule (`mineralClassOf` in `lib/mindat.ts`). A rock has none, since Mindat records no class for one, and neither does a stone Jasper hasn't looked up yet. `collectionTiles` reads every chain in one query and takes only `strunz10ed1` out of `detail` (`json_extract`, guarded by `json_valid`), so the dashboard parses no whole records. The class carries no info mark here, as the kind doesn't: the card is one link and a mark is a button. The stone's page has the mark.

### The side column

- **Newest additions:** four rows, each a whole 64 px link (thumbnail, the piece's name on up to two lines, "added Nov 1" after any "A kind of …"), then "See everything by date" (`/?sort=new`).
- **At a glance:** four stat tiles, stones, different minerals, kinds of rock and places they live (`glance`), each a number over a phrase.
- **Where they live:** each place with its count, most stones first (`places`), or a line saying where to record one.

## A stone

`app/stones/[id]/page.tsx` is one stone, read by `readStone` in `lib/specimens.ts`. It is DESIGN.md §5's specimen page as far as the data goes: Mindat's properties are here (#23); About, handling notes, elements, the Mohs scale, relatives, the story log and the box label arrive later in Phases 2 and 3.

- **The breadcrumb** ("Collection › Galena").
- **The title block:**
  - the piece's name at 60 px (40 on a phone), as a show label gives it ("Amethyst on matrix", the "matrix" with its info mark: `components/piece-title.tsx`); the same name is the page's `<title>`;
  - one line with "A kind of Quartz" under a hobby name (`kindOf`) and the formula, in Courier Prime with real subscripts ("A kind of Quartz · SiO₂"). This line is the only place the Mindat species shows;
  - the tags: the mineral class ("Halide"), else the kind ("Rock", with the rock info mark); "Mohs 4"; "Can glow under UV" in DESIGN.md's `uv` violet when Mindat says it can; then the photo count, how many of that mineral the collection holds, and when it was added. The formula, the tags and the property card follow the main mineral (`specimens.mineral_id`), never the others on the piece.
  - A tag whose word is a mineralogical term carries its info mark beside the pill (`TagTerm`).
- **The gallery** (`components/gallery.tsx`):
  - The hero is in the dark photo well, 640 px tall (360 on a phone), contained rather than cropped, with a caption, "Your photo · Oct 31, 2026".
  - With more than one photo, "More photos of this stone" is a 2-across grid of thumbnail buttons that swap the hero (aria-pressed, a 4 px azurite border).
  - Photos are newest first, by `taken_at`, else upload time.
  - `components/photo-view.tsx`, shared with the confirm screen, falls back from a HEIC original a desktop browser cannot draw to Jasper's thumbnail.
- **This specimen** (`components/stone-editor.tsx`) is the specimen label: paper, a double rule, the name over a 2 px ink rule, and Courier field names.
  - The title is the piece's name, and the fields are the stone's own mineral (#33), variety, With and On (the other minerals on it, `specimen_parts`, #29), where from, how it came, when, lives in, and notes. The first row is read-only and always filled: "Mineral" (or "Rock", or "Other" with no mark) with the species name, `stoneName(name)`, so an Amethyst shows "Quartz" here while the title leads with Amethyst, and its info mark says the main mineral is the one the tags and the Mineral properties follow. It changes through "Change" on the naming, never the form. An On of plain matrix carries the matrix info mark.
  - An unknown reads "Not recorded yet" with an Add link.
  - An amber note counts the details a collector's label wants (`missingDetails`, tested: where from, how, when, where it lives; never the extras), with "Fill in details".
  - Any of those, or "Edit details", turns the label into one form with a single Save (`PATCH /api/stones/[id]`) and focuses the field that was asked for. How it came is chips, with a dashed "Not recorded"; where it lives offers every place already in use.
  - **Other minerals on it** is its own group in the form. With is a list of chips, each ticked, untick to take one off (one tap to undo), and a field with Add (or Enter) for the next; a name typed but not added is added by Save. On is a field, or an "On matrix" chip with the matrix info mark. Both offer the minerals already in the collection as chips while typing, through the name field's autocomplete (`/api/minerals`, `rankMinerals`). The route writes them with `writeParts` (`lib/specimens.ts`): in label order, each mineral once, never the stone's own mineral, a new name made a `minerals` row as on the confirm screen, matrix with no mineral; then `pruneMinerals` deletes any mineral the edit left on no stone.
- **Kitchen-table tests** (`components/tests-editor.tsx`):
  - The confirm screen's `TestRow`s, editable in place.
  - The tests already answered come first (with none, the four DESIGN.md names: glass, streak, vinegar, magnet), and the rest wait behind "Other tests".
  - Which rows show first is fixed when the page opens, so a save never moves them.
  - "Save the answers" appears once something changed, and "Not saved yet." says so meanwhile.
  - The check against Mindat arrives in Phase 2.
- **Mineral properties** (#23), after the tests, from the record Jasper fetched for the stone's mineral (#21, `jasper.md`).
  - **Reading.** `readStone` reads the mineral's record (`minerals.mindat_id`) and each `varietyof` above it, with `detail` parsed.
  - **Shaping.** `propertyCard` in `lib/mindat.ts` (pure, tested on Mindat's own strings) turns it into cells. Each value comes from the first record in the chain that has one, so a chalcedony takes its crystal system from Quartz. Mindat's `0`, `"0"` and `""` mean none.
  - **The cells**, in the canvas's order: Formula, Mohs hardness, Crystal system, Luster, Streak, Cleavage, Specific gravity, Fluorescence. Each is a `ground` tile with its label's info mark, the value in Zilla 24 (the formula in Courier Prime), in auto-fill columns of at least 230 px, so a phone shows one column and a laptop three. A cell with no value is not drawn.
  - **The rules:**
    - The formula is split into runs drawn as real `<sub>`/`<sup>`; any other tag is dropped with its text kept. Mindat's HTML never reaches the page as HTML.
    - Crystal system and luster are put in plain words ("Cubic (isometric)", "Glassy (vitreous)"), luster taking the first value listed. Cleavage drops Mindat's slashes ("Poor/Indistinct" is "Poor").
    - Specific gravity is the measured value, or a range when `dmeas2` is larger, else the calculated one, at two decimals rounded half up on the written digits.
    - Fluorescence reads `uv`, else `luminescence`: "Doesn’t glow" when the text is only a negative, "Rarely glows" when it opens with "not usually" or "rarely", "Can glow" when either field speaks of fluorescence or UV, and no cell otherwise. Under the last two, Mindat's words in whole sentences, with LW and SW spelled out: the first sentence always, however long, then the next ones while the note stays within 160 characters. A sentence ends at `.`, `!` or `?` before a capital letter, so "et al. 2003" runs on. Nothing is cut inside a sentence; the rest is on Mindat.
    - The class is Strunz's (`strunz10ed1`), singular (`mineralClassOf`, shared with the tiles).
  - **The heading's source line** is "From Mindat · tap i to learn what a word means". "Mindat" links to the mineral's page on mindat.org, the attribution the README's Credits promise.
  - **With no cells**, one line takes the grid's place:
    - a rock (every rock: Mindat records none of these for one) says Mindat lists no single formula or hardness, with the rock info mark;
    - a name Mindat doesn't have says so, with "Change the name". It is found by folding the name as Jasper does (`fold`) and looking it up in `mindat_terms`.
    - Before Jasper has linked or fetched it, the line says Jasper hasn't looked it up yet. On a station without a Mindat key it stays that way.
  - **The info marks** are new glossary entries (formula, crystal system, luster, cleavage, specific gravity, mineral class, rock) beside the tests' hardness, streak and fluorescence. They float, as every mark does. The canvas's note block under the grid, with examples from the household's own stones, waits for the glossary issue.
- **How it was named**, from the job whose naming made the stone (`readJob`):
  - Jasper's pills as they were, each its whole reading: the chosen one solid azurite with a check, reading as the stone is named now, the others outlined with their word. A typed name no model offered leads, marked "typed by you". Their corners are 24 px, so a long name wraps into a rounded card rather than an oval.
  - The date, and how the person knew (`HOW_SUMMARY` in `lib/naming.ts`, beside the confirm screen's chip labels).
  - How many more photos were added as the same stone.
  - "Change the name", which goes to that job's confirm screen.
- **Remove** (`RemoveStone`): two taps, "Remove this stone" then "Yes, remove it", with "Keep it" to back out. `DELETE /api/stones/[id]` removes the photo rows and the jobs that brought them, found through the photos and through the stone's confirmations; candidates, suggested tests and confirmations cascade. It then removes the stone (its parts cascade), and each of its minerals, main or on it, that no stone uses any more (`pruneMinerals`), and unlinks the files and their thumbnails. Then home.

Tests: `lib/collection.test.ts` (search, by a part too, the kind and source filters, both sorts, by the shown name, the chips, the count line, the side column, date labels, what changed today, missing details), `lib/greeting.test.ts`, and `lib/mindat.test.ts` (formula runs, plain text, the luster, gravity and fluorescence rules on Mindat's own strings, inheritance up the chain, the card's four states, the class on the tiles' shape (`mineralClassOf`), and `fold` on Jasper's cases).

## Adding a rock

Both of the README's ways in, the camera-roll batch after a trip and the photos taken at the kitchen table, go through one page. The page sends one rock at a time, and a rock is all of its photos in one job, so the models see the close-up, the coin shot and the label together. `components/uploader.tsx` is the client side:

- **Two inputs.** "Take a photo" is a file input with `capture="environment"`; "Choose from your photos" takes `multiple` and names `.heic` and `.heif` in `accept`. Either adds to the rock being put together. Under them, an info note gives the README's photo advice as three photos of each rock: one close-up in daylight, one with a coin beside it for scale, one of any label or tag.
- **The rock** ("This rock", then "The next rock") is five slots, always drawn, so a photo fills a slot and moves nothing; each photo has Remove until the rock is sent. Five is Jasper's `MAX_IMAGES`. Choosing more than fit adds the first ones and says how many weren't; pressing either button with five already in says so instead of opening the picker.
- **The note.** "Anything you know about this rock?" (optional: where it was found or bought, and roughly when) becomes the rock's job's `notes`, which Jasper puts in front of the models. It stays for the next rock until it is changed, because rocks from one trip share it. A single stone's note is edited on the confirm screen (#8).
- **"Send this rock"** moves the rock into "Rocks you've sent" and leaves an empty next rock at once. Rocks send one after another through a promise chain, so the next one can be put together while the last is still sending. The sent list sits between the photo tips and the rock card, where it's in sight after a send. Nothing is drawn there until the first rock is sent. Each rock sent grows the list and moves the rock card down; that shift follows the person's own press, so it's the exception to the no-layout-shift rule. The list keeps the order sent, so its rows never reorder under a finger. "Back to your collection", and the line saying the page can be left, appear only once no rock is still sending or failed, because leaving loses those.
- **Shrink before sending** (`lib/shrink.ts`): `createImageBitmap` with orientation from EXIF, drawn to a canvas at most 1280 px on the long side, JPEG at 0.9. A 3 MB phone photo becomes about 270 KB, which is the difference between working and not on a weak Wi-Fi. If the browser cannot decode the file (HEIC on a desktop browser), the original is sent, the row shows "No preview", and Jasper re-encodes it.
- **The date survives the shrink** (`lib/exif.ts`): the re-encode drops EXIF, so `DateTimeOriginal` (else IFD0's `DateTime`) is read from the original bytes first and sent as `takenAt`. Two walks, no library: a JPEG's APP1 segment, and a HEIC's `Exif` item, found through the `meta` box's `iinf` (which item is Exif) and `iloc` (where its bytes are). Safari hands an iPhone's HEIC over as is when `accept` names HEIC, so without the second walk no iPhone photo would keep its date. A file it cannot read gives null, never a throw.
- **Photos first, then the job.** Each photo is its own `POST /api/photos` with retry (`lib/retry.ts`): five tries with waits doubling from 1 s (15 s in all), each try cut off after 60 s so a request the Wi-Fi dropped mid-way cannot hang the rock. A 4xx other than 408 or 429 is `NoRetry`. Once every photo is in, `POST /api/jobs` with their ids makes the job, with the same retry. The `photos.id` each photo got is kept per photo, so "Send it again" sends only what hasn't gone, then makes the job. A 404 from `POST /api/jobs` (the photos were swept) forgets those ids, so the next try sends them afresh. A row shows "Waiting its turn to send", "Sending photo 2 of 3…" with the try count, or "Couldn't send it" with the reason in words, "Send it again" and Remove. Keys are a counter, not `crypto.randomUUID`, which a phone on the house's plain-http LAN does not have.
- **Then it polls.** Each sent rock's job is fetched from `/api/jobs/[id]` every 1.5 s (a round starts after the last one answered) until Jasper is done with it: "Waiting for Jasper", "Jasper is looking at it…", with Jasper at work (`components/jasper-at-work.tsx`, below) in the photo count's line, then "Ready to name" with Jasper's verdict ("Probably Galena.") and a link to `/name/[id]` (#8). A row waiting for a name turns amber, DESIGN.md's "needs you". A rejected job is ready to name too ("Jasper had no guess"). A `failed` job with a `next_attempt_at` is one Jasper will retry, so its row keeps waiting; one without is failed for good, and its row says Jasper couldn't look at it and links to the confirm screen to name it by hand.
- **Nothing is kept in the browser.** The camera roll is the offline mode: a photo not yet sent when the page closes is still on the phone.
- **Jasper at work** (`components/jasper-at-work.tsx`, DESIGN.md §4), also on the dashboard's working strip and under the confirm screen's heading: `RockHammerIcon` taps its stone (the `hammer-tap` and `hammer-spark` keyframes in `design/tokens.css`), beside one of ten rock hound's lines. The line steps every 2.5 s on a shared wall-clock beat, offset by the job id, so rows sent a second apart never fall into step and say the same thing, as separate timers would. It is `aria-hidden` and in no live region; the status beside it carries the meaning. Under `prefers-reduced-motion` the keyframes are off (`motion-reduce:`) and the beat doesn't advance. The lines avoid every glossary term, because a changing line can't carry an info mark. Each fits one line in a sent row at 390 px; the longest, about 150 px, has about 170 px of room.

`POST /api/photos` opens the database first (503 while Jasper has not created it, before anything is written). It writes the file and inserts a `photos` row with no job (`taken_at` when the EXIF had a date); a file whose row fails to go in is deleted. Limits: 25 MB, and image types or `application/octet-stream` only. Before storing, it deletes the photos that belong to neither a job nor a stone and are more than a day old, rows and files: what a rock that never got its job (the phone died, the page closed) leaves behind. A sweep that fails never fails the upload.

`POST /api/jobs` takes `{ photoIds, notes }`: one to five distinct ids. In one `BEGIN IMMEDIATE` it inserts the `jobs` row (`queued`, the note trimmed to 1000 characters, NULL when empty) and points every photo at it, so Jasper, which looks for queued jobs every 2 s, never starts on half a rock. It answers 404 when a photo is gone and 409 when one is already on a stone or the photos are split across jobs. When every photo is already on one job it answers that job, so a retry whose first response was lost gets the job it made rather than a second one.

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

**The heading block is where the wait shows.** The card's top is one element (`head` in `namer.tsx`) for the first look, the second look and the verdict: a polite live region with `tabIndex={-1}`, so focus and the announcement stay put while the words change. While Jasper has the stone it reads "Jasper is looking…" (or "Jasper is looking again…" after a test answer) with Jasper at work under it, then the line: "Usually a few seconds…", "With your answers. The new suggestions replace these in a few seconds.", or "Jasper hit a snag and will try again shortly." while a retry is pending. When the plan arrives the heading becomes the verdict and the explain line returns, the same way a sent row on the add page goes from "Jasper is looking at it…" to "Ready to name". Jasper at work is `aria-hidden`, so the region reads only the heading and the line. No cursor says busy: `.btn:disabled` and the pills keep the arrow, since the progress cursor read as a hung browser (#36).

**What it says** comes from Phase 0 (#1): two opinions, in words.
- **The plan.** `readJob` builds it on the server with `planPills` (`lib/pills.ts`, pure, tested on the shapes of Mom's stones) from the candidates rows and the job's test answers. It is recomputed on every read, so the rule can change without rewriting rows.
- **The Mindat chains.** `candidatesOf` (`lib/jobs.ts`, shared with the confirm route) loads each candidate with its chain: the record Jasper resolved it to (`candidates.mindat_id`), then each `varietyof` above it, read from Jasper's cache with one recursive query and put in order by `chainOf` (`lib/names.ts`, tested). Agate's chain is Agate, Chalcedony, Quartz. A candidate Jasper has not looked up, or that Mindat doesn't know, has an empty chain and is matched by name alone. Each of a candidate's parts (`candidates.parts`, read by `parseParts`, which drops anything malformed) gets its chain the same way, in the same query.
- **Readings** (#29). Each candidate is a reading of the whole piece: its main mineral, and its parts, the minerals `with` it and the base it is `on` (a mineral, a rock, or plain `matrix`). A reading's minerals are the main one and its parts, never matrix. A prompt v1 answer, or a stone that is one mineral, is a reading with no parts, and plans exactly as before.
- **The identifier.** Its first choice leads when the models disagree. It is `QUARRY_IDENTIFIER` with Jasper's default, read at runtime.
- **"Probably X"**: both models' first readings name the same piece. That is their main minerals being the same stone, or each model having seen the other's main mineral among its own (Pyrite with Sphalerite on Quartz, and Quartz with Pyrite). One lead pill, with a 2 px azurite border and an `azurite-soft` "probably" tag, then up to two "could also be" pills from the rest of both lists.
  - The lead pill is the identifier's reading: its main mineral, its base as it gave it, and the `with` minerals the other model saw too. Every other mineral only one of them saw is a `maybe`: "Probably Pyrite on Quartz", with Sphalerite offered.
  - A pill with parts never gets a scratch-test misfit: the answer could be about any of its minerals, and the test's own wording says which part to scratch.
  - When one first choice is only finer than the other (Agate under Chalcedony), the lead pill takes the finer variety.
  - When Mindat puts the two first choices on different varieties of the stone (`varietySplit`: Amethyst and Citrine under Quartz, Agate and Carnelian under Chalcedony), the lead pill carries a `doubt` (the shared level and both guesses) and no variety, and nothing further down the lists fills it in. Only the first choices can make a doubt; a lower-ranked variety folded into the lead pill never does.
- **"Could be X or Y"**: they differ. Each model's first choice becomes a pill, naming its whole reading, the identifier's first, then one more. After a reading with parts the "or" takes a comma ("Could be Pyrite on Quartz, or Calcite").
- **One opinion** (the other model failed): its candidates as "could be", never "probably".
- **No guess**: a rejected job, or one that failed for good. The name field leads.
- **Matching.** "The same stone" is `sameStone` (`lib/names.ts`, tested on the spike's cases and Mindat's chains). Either of two rules is enough:
  - **By name**, the spike's whole-word matching made symmetric. Names match as whole words either way round (Specular hematite is Hematite; Chalcopyrite is not Pyrite). A variety matches only the other's whole name (Quartz, variety Amethyst is Amethyst). Varieties are never matched word by word, because models put colour words there, and "Purple" would make a fluorite and an amethyst agree.
  - **By Mindat** (#18): both chains end at the same species or rock, so Chalcedony, "Agate, banded" and Quartz, Agate agree, and so do Quartz, Amethyst and Quartz, Citrine. Agreement never climbs above a species, so "probably" still means the two first choices named one species or rock, as the prompt asks them to name it. Mindat never undoes a match by name: it files Tiger's Eye as an entry of its own, and Quartz, Tiger's Eye still agrees with Tiger's Eye. Jasper is a rock of its own in Mindat, so Jasper and Chalcedony differ.
- **Duplicates.** A candidate naming a stone already on a pill adds its model to that pill. After a lead pill, so does one led by a mineral already on the piece, rather than a "could also be Quartz" under "Probably Pyrite on Quartz".
- **The name** every screen shows is `pieceName` (`lib/pills.ts`, tested), built as a dealer's label at a rock show is: the main mineral's own name, then "with" the others in order ("with Sphalerite and Galena", a serial comma from three), then "on" the base, "matrix" kept lowercase. A mineral's own name (`ownName`) is its hobby or trade name when it has one (Amethyst, Blue Lace Agate), else the mineral or rock; a variety that is only a colour or a look (Milky, Purple, Specular) goes in front of the mineral instead (Milky Quartz). `kindOf` is the line under a hobby name, "A kind of Quartz", and nothing when the name already says the mineral (Rose Quartz). The data keeps the species in `name` and the hobby name in `variety`; only the display leads with the hobby name.
- **No percentages, ever.** `verdictLine` puts the plan in one line for the strip and the add page's rows.
- **The line under the heading** says why, with the "two opinions" info mark:
  - agreed: "Jasper's two opinions agree. Tap it if it looks right, or name it yourself.";
  - agreed on the stone, not its variety: "Jasper's two opinions agree it's Chalcedony, but not on the variety: Agate or Carnelian.", with the variety info mark;
  - a real disagreement: "Jasper's two opinions differ. A steel nail would tell them apart.", from the first of the models' suggested tests (`suggestedOrder`, `TESTS[kind].phrase`, the strip's wording), or "Tap the one that looks right, or try a test to be sure." when they suggested none.
- **A pill that can't fit an answered scratch test** (`misfit` in `lib/household-tests.ts`, tested) has DESIGN.md's `warn` note under it, with the reason: "Doesn't fit your glass test: Agate is Mohs 6.5 to 7.", the Mohs figure carrying the hardness info mark, and the pill `aria-describedby` it. Only the four scratch tests answered yes or no are checked, against the hardness of the first record in the chain that has one (a variety without one takes its parent's), with half a point of slack either side of the tool, so a stone of 5 to 6 fits either glass answer. Rocks and unresolved candidates are never checked. The pill keeps its place and its word: a home test can be wrong.

**What's on it:**
- **The photo**, contained in the dark photo well, 280 px tall on a phone so the verdict is on the first screen, 520 px from `sm`. It carries a caption with the EXIF date (`takenLabel`, read from the text so server and phone agree) and thumbnails to switch between photos. A HEIC original a desktop browser cannot draw falls back to Jasper's 320 px thumbnail, and to "No preview on this device" before there is one. The fallback is checked on mount as well as on `error`, because the server-rendered image fails before React is listening.
- **Any label the models read**, as a paper tag in Courier: "Jasper read a label in the photo".
- **The pills.** One tap names the stone. Each names its piece and wraps rather than being cut, with "A kind of Quartz" as its second line under a hobby name; its corners are 32 px, so one line is a pill and a long name a rounded card. A pill on plain matrix has "On matrix: rock nobody has named." under it, with the matrix info mark (a mark can't sit inside the pill's button).
- **The maybes.** Under the lead pill: "Jasper also saw Sphalerite (one opinion). Add it?", and a chip per mineral ("With Sphalerite"), off by default. Ticking one adds it to the pill's name at once, so the pill always says what a tap saves (`savedParts`, tested: the pill's parts, then the ticked maybes; a label has one base, so a second one ticked reads as "with").
- **"Variety or shop name"** (optional). It becomes `specimens.variety`; left empty, the tapped pill's own variety is used, which is none when the lead pill carries a doubt, so a variety the two opinions disagreed on is never saved as though it were known. With a doubt, "Jasper's two guesses" sit under the field as chips (`aria-pressed`, a check when chosen); a tap fills the field, a second tap clears it, and naming still takes a pill.
- **The name field**, always on the screen, because "could be" never promises the answer is among the pills. Under it, chips for the minerals already in the collection (`rankMinerals` in `lib/minerals.ts`, tested): the household's own most-owned first, or matches of the typed text, names that start with it first.
- **"Want to be sure? Try a test"** opens `components/tests-panel.tsx`. The household tests are in `lib/household-tests.ts`: their kinds, which are the schema's and Jasper's, and questions worded the way Jasper words the answers back.
  - The tests the models suggested come first (`suggestedOrder`: the identifier's first, each kind once), each with the model's "how" and "what to look for". The rest wait behind "Other tests".
  - Answers are chips: Yes and No, or a streak colour. "Not tried" is a dashed chip and is never stored as no.
  - The stone's note is editable there too.
  - "Ask Jasper again with these answers" saves both on the job and sends it back to the queue (`POST .../tests`; `cleanAnswers` keeps only `yes`, `no` and a streak colour, and leaves a test not tried out of the JSON).
  - On success the panel closes and focus moves to the heading block, which brings the card's top into view on a phone (the tests sit at the bottom of the card) and has a screen reader say "Jasper is looking again…". The old pills stay in place, dimmed, until Jasper's new plan replaces them, so nothing moves when it lands.
  - Once settled, a job with at least one test answer carries a `text-meta` kicker above the verdict, "Jasper looked again with your answers". It is state, not a toast: it is there after a reload and goes once the stone is named. Nothing is reserved for it on a job with no answers, since it appears only after the person's own press.
- **"Same stone as the last one"** (`lastNamedStone`, with that stone's name as its label reads) merges this photo into the stone named most recently.
- **"Not a rock"** is two taps, then deletes the job, its photos, and their files and thumbnails.
- **"Add another photo of this stone"** stores a photo on the same job (at most five, Jasper's limit) and sends it back to the queue.
- **"Skip for now"** goes to the next waiting job; **"Done for now"** goes home.

**Naming saves at once.** `POST .../confirm` does it all in one `BEGIN IMMEDIATE`:
- it finds or creates the mineral (`mineralId` in `lib/specimens.ts`; `minerals.name` is `COLLATE NOCASE`, so "galena" finds "Galena");
- it creates the specimen with the variety and the job's notes and test answers;
- for a pill, it writes the other minerals on the piece (`writeParts`): the pill's parts and the maybes sent, each a `minerals` row made the same way, so Jasper links it to Mindat. A typed name saves none (the stone's page adds them), and another photo keeps the stone's;
- it links the photos;
- it writes the confirmation.

The confirmation records:
- `chosen_name`;
- `source`: `pill`, `typed` or `same_as_last`;
- `how`: a pill is `suggestion`, a typed name `guess`, and another photo inherits the stone's first naming;
- `verdict`: what the screen said, recomputed from the candidates on the server rather than taken from the request.

A typed name that one of the models also gave takes that candidate's spelling and kind; any other is a mineral until Jasper links it to its Mindat record, when the kind follows Mindat's (a typed Granite becomes a rock; see `jasper.md`).

**The named state** is a specimen label (paper, double rule, the piece's name over a 2 px ink rule).
- **"How do you know?"** Five chips: I took Jasper's suggestion, From a label or tag, The tests settled it, Someone who knows told me, My best guess. A tap saves through `PATCH .../confirm`, with "Saved." in reserved space. Only a label, the tests and someone who knows count as known answers (README). "My best guess" is there so that a typed name is never counted as known by default.
- **"Next stone"**: `nextWaitingJob` (`lib/jobs.ts`, tested): the next later job, wrapping to the first, or home when nothing else waits.
- **"Change"**: `DELETE .../confirm` reverses a naming. The confirmation goes and the photos unlink. The specimen is deleted if nothing else is attached to it, and with it each of its minerals, main or on it, that no stone uses any more (`pruneMinerals`). The job is back in the strip with its pills, since naming never deletes candidates.

**Waiting** is `waitingJobIds`: jobs Jasper is done with and nobody has named, oldest first. That includes a job that failed for good, so the person can still name it by hand.

**The first info marks** are here (`components/term.tsx` over `lib/glossary.ts`): two opinions, variety, matrix, and the idea behind each test (hardness, streak, fizz, magnetic, glows under UV). A test checks that each entry runs two or three sentences and that every test kind has one. The mark is DESIGN.md's 28 px ring, with an invisible ±10 px hit area. Its note floats under the mark in sand rather than opening in place, so opening one moves nothing. That is the Conservatory's choice: the no-layout-shift rule outranks the canvas's inline block.

Tests:
- `lib/names.test.ts` (the spike's cases, agreement through Mindat's chains, the shared level, where varieties part, `chainOf`), `lib/pills.test.ts` (with the agate, a variety doubt, a finer variety and a misfit; for #29 the screenshot's cluster agreeing mineral by mineral, a one-sided reading staying "could be", parts agreeing through chains, matrix, the base, no misfit on a piece, and `pieceName`, `kindOf`, `ownName`, `savedParts` and `parseParts`), `lib/household-tests.test.ts` (with `misfit`), `lib/minerals.test.ts`;
- `lib/jobs.test.ts`: `nextWaitingJob` and `isSettled`;
- `lib/glossary.test.ts`.

## The visual language

DESIGN.md is the reference and `design/tokens.css` the values, imported as the Tailwind theme. `app/globals.css` writes down DESIGN.md §4's component recipes as screens first need them: `btn` (48 px, `btn-lg` 52 px for the page's main action) with `btn-primary` (azurite) and `btn-soft` (sand), and a disabled state only for a button that is working ("Sending…"), since a button that can do nothing is not drawn; `chip` (a 48 px white pill; `aria-pressed="true"` is azurite, always drawn with a check icon so selection never relies on colour; `chip-dashed` is "Not tried"), `card` (with `card-link`, which lifts on hover), `tag` (15 px, sand), `select` (a 50 px pill around a native `<select>`, its chevron drawn in the markup), `text-link` (DESIGN.md's underlined azurite for "Clear filters", "Change", "Add"), `nav-pill` (the current page in `sand-2` through `aria-current`), and `field` (a 52 px pill around a bare `<input>` that fills it, so the focus ring goes on the pill and the whole pill is the target). Base rules: Zilla Slab 600 for headings, azurite links, a 3 px azurite focus ring. The root font size stays 16 px so Tailwind's spacing scale is the standard one; the body is 18 px (`text-body`), the floor for anything read.

The faces are self-hosted by `next/font` in `app/layout.tsx` (Zilla Slab 600 and 700; Atkinson Hyperlegible 400 and 700 with its italic; Courier Prime 400 and 700), whose variables feed the font tokens, so the stations make no font requests. Line icons live in `components/icons.tsx` (the gem mark, the crystal for tiles with no photo, the camera, the check on a selected chip, the camera roll's photo, the sun, coin and tag of the add page's photo tips, and the rock hammer of Jasper at work, the one animated icon).

**The top bar** (`components/topbar.tsx`): the gem mark and wordmark, a nav pill for each page that exists (Collection today; Minerals, Periodic table, Labels and Gem Show join with their phases, rather than being drawn dead), the search ("Search your rocks": on the collection it filters as you type through `?q=`; anywhere else Enter goes to `/?q=`), the primary "Add a rock", then the strata band. Below `lg` it is two rows, the wordmark with Add, then the nav with the search; on a phone Add reads "Add" with "a rock" kept for screen readers. From `lg` it is the canvas's one row.

### Rules every screen keeps

- No layout shift: empty states reserve the populated space.
- Nothing moves except Jasper at work, and that stops under `prefers-reduced-motion`.
- The screen says in words what is working; no control uses the progress cursor.
- Every target is at least 48 px, 52 for the main action; 18 px is the floor for reading text, 15 px the smallest anywhere.
- Every surface works on a 390 px phone with 16 px gutters and no sideways scroll, and uses a laptop's width.
- The app teaches: every mineralogical term gets an info mark (`components/term.tsx`, with its entry in `lib/glossary.ts`).
- Rows from `node:sqlite` have a null prototype, which React refuses to pass to a client component: map them to plain objects before they cross (`readJob`, `lastNamedStone`, `collectionTiles`, `readStone`).
- Text that follows a `{expression}` in JSX and starts with an entity (`&ldquo;`) loses the space between them; write such a sentence as one string.
