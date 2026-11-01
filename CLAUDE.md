# The Quarry

Read first: the root `README.md` (the design brief) and `docs/guide/README.md` (the state of what is built, hub and spokes). Issues are the contract; the workflow is the one in the global CLAUDE.md.

UI work follows `design/DESIGN.md`. Tokens live in `design/tokens.css` (Tailwind 4 `@theme`, imported from `web/app/globals.css`, with the fonts self-hosted through `next/font` in `web/app/layout.tsx`). The design canvas linked at the top of DESIGN.md is the visual reference for the dashboard and specimen pages; match it, don't copy its markup. The component recipes DESIGN.md §4 describes are written once in `globals.css`, as screens first need them.

Two rules every screen keeps: no layout shift (empty states reserve the populated space), and the app teaches (every mineralogical term carries an info mark).
