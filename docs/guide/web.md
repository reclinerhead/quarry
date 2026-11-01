# The web app

`web/` is a Next.js 16 App Router app on the Conservatory's stack: React 19 with the React Compiler, TypeScript, Tailwind CSS 4, `node:sqlite` for the database, pnpm, Vitest. It serves every page a person sees and will write the rows their actions create. It never calls a model.

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

## The home page

`app/page.tsx` is the dashboard from DESIGN.md §5, as far as there is data for it:

- **The greeting** (`lib/greeting.ts`, tested): the date ("Sunday, November 1", in the station's time zone), then "Good evening." with "Your collection starts here." while there are no stones. The line that says what changed arrives with the collection (#9).
- **Your collection**: the count line ("No stones yet", "1 stone"), and while it is empty, one card in the specimen card's shape, "No stones yet" with "Add the first one", beside faint placeholder cards that show the grid it will fill. Each placeholder appears only where the grid has a column for it (from `sm`, `lg` and `xl`), so a phone shows the one card.
- The pending strip (#8) and the cards, filters and side column (#9) arrive with the issues that have data for them; their space is not faked.

## The visual language

DESIGN.md is the reference and `design/tokens.css` the values, imported as the Tailwind theme. `app/globals.css` writes down DESIGN.md §4's component recipes as screens first need them: `btn` (48 px, `btn-lg` 52 px for the page's main action) with `btn-primary` (azurite) and `btn-soft` (sand), `card`, `nav-pill` (the current page in `sand-2` through `aria-current`), and `field` (a 52 px pill `<label>` around a bare `<input>`, so the focus ring goes on the pill). Base rules: Zilla Slab 600 for headings, azurite links, a 3 px azurite focus ring. The root font size stays 16 px so Tailwind's spacing scale is the standard one; the body is 18 px (`text-body`), the floor for anything read.

The faces are self-hosted by `next/font` in `app/layout.tsx` (Zilla Slab 600 and 700; Atkinson Hyperlegible 400 and 700 with its italic; Courier Prime 400 and 700), whose variables feed the font tokens, so the stations make no font requests. Line icons live in `components/icons.tsx` (the gem mark, the crystal for tiles with no photo, the camera).

**The top bar** (`components/topbar.tsx`): the gem mark and wordmark, a nav pill for each page that exists (Collection today; Minerals, Periodic table, Labels and Gem Show join with their phases, rather than being drawn dead), the search (a plain form that sends `?q=` to `/`; the collection wires it up in #9), the primary "Add a rock", then the strata band. Below `lg` it is two rows, the wordmark with Add, then the nav with the search; on a phone Add reads "Add" with "a rock" kept for screen readers. From `lg` it is the canvas's one row.

### Rules every screen keeps

- No layout shift: empty states reserve the populated space.
- Every target is at least 48 px, 52 for the main action; 18 px is the floor for reading text, 15 px the smallest anywhere.
- Every surface works on a 390 px phone with 16 px gutters and no sideways scroll, and uses a laptop's width.
- The app teaches: every mineralogical term gets an info mark (the first arrive with #8).
