# The Quarry — design language

Reference for anyone (human or Claude Code) building screens. Read this before
touching UI. `tokens.css` holds the values as a Tailwind 4 `@theme`. The visual
reference is the design canvas with two mockups, **Dashboard — your
collection** and **Specimen — Fluorite Q-0047**:
<https://claude.ai/artifact/QJREbveJwMU92z1DpWWA6m> (private to the owner).
Treat it as a reference, not app code: match it, don't copy its markup.

The structure of this file follows the Conservatory's `design/DESIGN.md` on
purpose. The palette and type do not. The two apps are siblings, not twins in
looks.

## 1. Feel

A rock hound's shelf and field notebook: limestone, basalt, a hand lens, a
specimen box with a paper label in it. Light, sturdy and plain-spoken, not a
SaaS dashboard and not a gem-shop sparkle page.

- **Built for older eyes first.** 18 px body text is the floor for anything
  you read. 15 px is the smallest text anywhere (tags). Every target is at
  least 48 px tall. One idea per card. Nothing hides behind hover or an
  icon-only button.
- One pale limestone ground, white cards, thin sandstone borders. Flat at rest;
  a card lifts (soft shadow, stronger border) only on hover.
- Everything you can press is a pill. No hard corners except the specimen
  label, which is drawn as a paper card.
- A slab serif for the things a rock hound cares about: the stone's name, the
  big counts, section titles. A sans built for legibility for everything else.
  A typewriter face only for what a collector would hand-letter or type: the
  catalog number, the chemical formula, label field names.
- **Collector details are the decoration.** A thin strata band (four stacked
  sediment layers) under the top bar. The catalog number as a small white "dab"
  with red typewriter digits in the corner of each photo, like the number
  painted on a real stone. The specimen card styled as a museum label. The Mohs
  scale as a ten-slot set to complete. Nothing else is ornamental.
- One action color (azurite blue). Amber only means "needs you" (waiting for a
  name, details missing). Violet only means "glows under UV". Never use these
  for decoration.
- No gradients, no emoji, no glitter, no left-border cards. Icons are
  1.8–2 px stroke line icons, inline SVG.
- Copy is plain and specific: "3 rocks waiting for a name", "Handle it over a
  towel", "Your answers fit fluorite". Say "stone" or "rock" in friendly copy.
  Use the real term (Mohs hardness, streak, luster) only where it carries
  meaning, and always with an info mark (§4).

## 2. Color

| Token | Hex | Use |
|---|---|---|
| `ground` | `#F5F1EA` | page background (limestone) |
| `surface` | `#FFFFFF` | cards, inputs, chips at rest |
| `label` | `#FFFDF8` | specimen label card, catalog-number dab, box label |
| `sand` | `#EDE6DA` | soft fills: tags, soft buttons, info note, chip hover |
| `sand-2` | `#E3D9C8` | active nav pill, pressed soft button |
| `line` / `line-2` | `#DDD3C3` / `#CFC3AF` | card borders / control borders |
| `line-strong` | `#A8977C` | hover border, info-mark ring, dashed "Add a photo" tile |
| `rule` | `#E6DDCD` | ruled lines inside the specimen label |
| `ink` | `#2A2622` | text (basalt) |
| `ink-2` | `#5A5048` | secondary text, labels, nav links |
| `ink-3` | `#6E645A` | placeholders, "Not recorded yet" |
| `tag-ink` | `#3E3630` | text on `sand` tags |
| `azurite` / `azurite-deep` | `#2D5B8A` / `#1F4468` | the action color and its hover |
| `azurite-soft` / `azurite-note` | `#E4ECF4` / `#1F3A57` | "you have this": owned Mohs slots, lit elements, the test-check note |
| `catalog` | `#9E2F22` | catalog numbers, and nothing else |
| `warn` / `warn-line` / `warn-ink` | `#FBF4E4` / `#E4C98A` / `#5A4210` | waiting for a name, details missing |
| `uv` / `uv-ink` | `#ECE6F7` / `#4B3584` | "Glows under UV" |
| `strata-1…4` | `#D8C7A8` `#B9A586` `#E6DAC4` `#8C7B66` | the strata band only |

Measured contrast (WCAG): ink on ground 13.3:1 · ink-2 on ground 7.0:1 ·
ink-2 on surface 7.8:1 · ink-3 on surface 5.8:1 · ink-3 on ground 5.1:1 ·
white on azurite 7.1:1 · azurite on surface 7.1:1 · tag-ink on sand 9.5:1 ·
catalog on label 7.2:1 · warn-ink on warn 8.6:1 · uv-ink on uv 8.0:1. Most
pairs clear AAA (7:1), and every pair clears AA. Keep it that way: if you add a
color, measure it, and aim for 7:1 on reading text.

Rules: text on `ground` or `surface` is `ink`, `ink-2` or `ink-3`, never a
tint color on its own. Status tints are always a background + ink pair.
Specimens without a photo get a tile in the `tile-*` tint nearest the stone's
color (violet for amethyst, brass for pyrite, and so on) with a line-icon
crystal and the words "No photo yet". Vary the tint between neighbours.

## 3. Type

- **Display: Zilla Slab.** Weight 600 for headings and names, 700 for the
  wordmark. Letter-spacing −0.01em on headings. Used for: page titles, section
  titles, stone names on cards, big numbers in stat tiles, element symbols, and
  the wordmark.
- **Body: Atkinson Hyperlegible.** Designed by the Braille Institute for
  low-vision readers; its letters are hard to confuse (I/l/1, O/0). 400 body,
  700 for names in lists, links, labels and buttons. Line height 1.5–1.65.
- **Label: Courier Prime.** 700 for catalog numbers and formulas (`CaF₂`), 400
  for field names on the specimen label. Never for running text.
- Scale (px): 60 specimen title · 46 greeting · 34 list title · 30 section
  title · 24 side-panel title and card name · 22 subtitle under a title ·
  19 lead and info-note text · 18 body · 16 meta · 15 tag.
- Formulas use real subscript characters (`CaF₂`, `SiO₂`), not `<sub>`.
- Mineral names are upright and capitalized (Fluorite, Milky Quartz). There
  is no italic binomial here. A variety or trade name goes on the line under
  the name ("Quartz · geode half", "Chalcedony · banded").

## 4. Components

**Buttons**: pill, 48 px tall (52 for the page's main action), 700 weight,
icon + label with 10 px gap. `primary` (azurite fill, white text) for the one
main action on a page. `soft` (sand fill, line-2 border) for secondary.
Text-link style (azurite, 700, underlined) only for "Clear filters",
"Change", "Add".

**Chips (filters)**: pill, 48 px, white with `line-2` border. Selected =
azurite fill, white text, plus a check icon, so selection never relies on
color alone (`aria-pressed`). Chips wrap; never scroll a chip row
sideways.

**Selects**: same pill shape as chips, 50 px, a drawn chevron, a visible label
above ("Hardness", "Sort by"). Native `<select>`, so older phones get their
own big picker.

**Tags (status)**: 15 px / 700, 4 × 12 px padding, pill. Default = sand +
tag-ink ("Mohs 4", "Crystal", "Tumbled"). `uv` variant only for "Glows under
UV".

**Catalog dab**: `label` fill, 1 px `line-2` border, 6 px radius,
Courier Prime 700 in `catalog` red. 16 px at the top left of every specimen
photo or tile. 20 px above the title on the specimen page.

**Card**: white, 1 px `line` border, 18 px radius. Main-column cards pad
28 × 32; side-panel cards pad 24. Hover (when the card is a link): border
`line-strong` plus `shadow-hover`.

**Specimen card** (collection grid): photo or tinted tile 220 px tall with the
catalog dab, then name (Zilla 24/600), the variety or description line
(ink-2, 17), "Where it lives · added Month D" (ink-3, 16), then a row of tags
(Mohs, kind, UV). The whole card is one `<a>`.

**Relative card** (specimen page): the same at 130 px photo height and 16 px
radius, with the reason it's related as the second line ("Also a halide",
"Also glows under UV", "Also grows as cubes").

**Side-panel row**: 64 px thumb (12 px radius) + name link (700, azurite) +
meta line, hairline dividers between rows, none above the first.

**Stat tile**: `ground` fill on a white card, 14 px radius, 34 px Zilla number
over a meta label written as a phrase ("elements on your periodic table").
Two across.

**Mohs set**: ten slots, numbered in Courier Prime. Owned = `azurite-soft`
fill, `azurite-deep` text. Just added = solid azurite, white text, "· new".
Missing = dashed `line-2` border, ink-3 text. The dashboard shows it as a
5 × 2 list with mineral names. The specimen page shows a single row of ten with
this stone's slot solid.

**Info mark**: 26–28 px ring in `line-strong`, "i" in azurite, a real
`<button>` with an `aria-label` ("What is streak?"), 8 px after the term.
Pressing it fills the note block under the property grid (sand fill, 14 px
radius, `aria-live="polite"`): a Zilla title and a 19 px explanation that uses
the owner's own stones by name and catalog number ("Your Calcite (Q-0031) is
softer at 3…"). This is a README requirement: every mineralogical term gets
one.

**Specimen label**: the museum-label card. `label` fill, an outer 1 px
`line-2` border and an inner 1 px `line` border 10 px in (a double rule), a
2 px ink rule under the title, then a two-column `<dl>`: Courier field names
in ink-2, values in ink. Unknown values read "Not recorded yet" in ink-3
italic with an "Add" link beside them. When fields are missing, an amber note
at the bottom counts them ("4 details are missing") with a "Fill in details"
button.

**Test rows**: "Scratches glass?", "Streak on a tile", "Fizzes in vinegar?",
"Sticks to a magnet?". Each is a `ground` row with the answer as a white pill.
*Not tried* is a dashed pill, never the same as *No* (README rule). Under them,
the card check: an `azurite-soft` note with a check icon when the answers fit
the Mindat record. When they don't fit, use a `warn` note with the reason
("Calcite is Mohs 3, so either the name or the scratch test is wrong").

**Pending strip**: full-width `warn` card with `warn-line` border: up to three
overlapping 72 px thumbs, "N rocks waiting for a name" (Zilla 26), one line
with Jasper's guess for the first one and the test that would settle it, and
one primary button ("Name them").

**Candidate pills** (naming, and "How it was named"): confirmed name = solid
azurite with a check. Other candidates = outlined, 64 px tall, the name in
Zilla 24 with the variety under it. Each carries a plain word, never a
percentage. "probably" goes on the lead pill when Jasper's two opinions agree,
with an `azurite-soft` tag and a 2 px azurite border. "could be" goes on each
pill when they differ, and "could also be" on the rest, both as sand tags.
Phase 0 (#1) settled this: two models agreeing were right about 9 times in 10,
and a model's own confidence meant much less.

**Element tile**: atomic number, symbol (Zilla 36/700), name. Already lit =
`azurite-soft`. New with this specimen = solid azurite, "· new".

**Handling note**: bordered tile with a 28 px azurite line icon, a bold
imperative ("No hot water.") and one sentence of reason. Footer line says who
wrote it ("Written by Jasper from the Mindat record").

**Story timeline** (provenance log): azurite dots, bold event, meta date line.
Then a soft "Add to its story" button with the event kinds listed under it:
found, bought, gifted, traded, cleaned, moved, given away.

**Box label preview**: `label` fill, 1 px ink border, 4 px radius (it's
paper). QR placeholder plus Courier lines: catalog number (red), name, formula,
"Loc:" and "Coll:" with blanks.

**Breadcrumb**: Collection › Class › Mineral › Catalog number
(Collection › Halides › Fluorite › Q-0047), 17 px, ink-2 700 links, current
page in ink.

**Photo gallery**: hero photo at 640 px tall, `object-fit: contain` on a dark
`photo-well` (rocks get photographed in every aspect ratio, and cropping cuts
off the specimen), 22 px radius, with a dark caption pill naming the source
and date ("Your photo · whole stone · Oct 31, 2026"). Beside it, "More photos
of this stone": a 2-across grid of 170 px thumbnail buttons (selected = 4 px
azurite border, `aria-pressed`) that swap the hero, plus a dashed "Add a
photo" tile. Under that, a tip about the coin-for-scale and shop-tag photos,
and the Wikipedia reference image as a small row. The owner's photos always
outrank the reference image.

## 5. Page anatomy

**Top bar** (both pages, white, hairline bottom border, then the strata band):
faceted-gem mark + "The Quarry" in Zilla 30/700 · nav pills (Collection,
Minerals, Periodic table, Labels, Gem Show; active = `sand-2` fill,
`aria-current`) · search (pill, hand-lens icon, "Search your rocks") ·
primary "Add a rock" with a camera icon. Wraps to two rows on narrow screens.

**Dashboard**, top to bottom:
1. Date, then a greeting that says what changed ("Good evening. Two new stones
   today."), and one line on what the new stones added (a Mohs slot, new
   elements).
2. Pending strip (only when something is waiting).
3. Two columns, 32 px gap: **Your collection** (`flex: 999 1 600px`) and a
   **side column** (`flex: 1 1 320px; max-width: 400px`) that drops below on
   phones.
   - Collection header: title, a count line ("Showing 12 of 47 stones", or
     "Showing 3 stones that match" when filtered), then the Hardness and Sort
     by selects.
   - Filter chips: Everything · Crystals · Rocks and fossils · Tumbled and
     polished · Glows under UV · Found it myself · Bought or gifted, then
     "Clear filters" when any filter is on.
   - Hardness: Any · Soft (under Mohs 3.5) · Medium (3.5 to 5.5) · Hard
     (6 and up). Rocks with no single hardness drop out of a hardness filter.
   - Sort: Name, A to Z (default) · Newest first · Hardest first · Catalog
     number.
   - Specimen cards in an auto-fill grid (`minmax(260px, 1fr)`), then "Show
     more stones". An empty filter result says "No stones match those choices"
     with a "Show everything" button.
   - Side panels in order: Newest additions (four rows + "See everything by
     date") · At a glance (four stat tiles) · Your Mohs scale · Where they live
     (shelf, drawers, egg cartons, with counts).

**Specimen page**:
1. Breadcrumb.
2. Title block: catalog dab · name (60) · description · formula and its plain
   name ("CaF₂, calcium fluoride") · tags (class, habit, Mohs, UV, "N in your
   collection") · right: Print label (soft), Edit details (soft), Add photos
   (primary).
3. Photo gallery.
4. Two columns, same split as the dashboard.
   - Main: **This specimen** (the label card) · **Kitchen-table tests** (with
     the card check) · **About [mineral]** (Wikipedia summary, source line with
     fetch date, article link) · **Mineral properties** (Mindat cells: Formula,
     Mohs hardness, Crystal system, Luster, Streak, Cleavage, Specific gravity,
     Fluorescence, each with an info mark, then the note block) · **Taking care
     of it** (handling notes) · **Related stones you already have** (same class,
     same habit, same trait).
   - Side: How it was named (candidate pills + "Change the name") · What it's
     made of (element tiles + link to the periodic table) · On your Mohs scale
     · Its story so far (timeline) · Box label (preview + Print labels).

Rocks (granite, obsidian) and fossils get a thinner property card, per the
README: Mindat's record where there is one, otherwise the specimen's own notes
and tests. Hide cells that have no value. Never show an empty cell.

## 6. Responsive

Phone first in spirit; the mockups are drawn at 1440. Rules that keep them
honest at 390: every row is `flex-wrap`; the side column is a flex sibling,
never sticky or `100vh`; card grids are `auto-fill` with a minimum, so they go
to one column on a phone without breakpoints; chip rows wrap; the specimen
label's two columns stack below ~520 px; the photo hero drops to 360 px tall;
the test rows go to one column. Text never shrinks on small screens: 18 px
stays 18 px.

## 7. Accessibility

Part of the design, not a pass at the end:

- Real `<button>`, `<a href>`, `<select>`, `<input>` + `<label>` everywhere.
  Never a click handler on a `div`.
- Selected states use a check icon or border as well as color, plus
  `aria-pressed` / `aria-current`.
- Visible focus: 3 px azurite outline, 2 px offset.
- Icon-only buttons have an `aria-label`. Decorative SVG is
  `aria-hidden="true"`. Specimen photos get alt text that describes the stone
  ("Purple fluorite with stepped cubic crystals").
- Contrast as measured in §2. 48 px minimum targets, 52 px for primary.
- Info notes and filter counts update with `aria-live="polite"`.

## 8. Using this with Claude Code

Add a line to `CLAUDE.md`:

> UI work follows `design/DESIGN.md`. Tokens live in `design/tokens.css`
> (Tailwind 4 `@theme`, imported from `app/globals.css`). The design canvas
> linked at the top of DESIGN.md is the visual reference for the dashboard and
> specimen pages; match it, don't copy its markup.

Then ask for screens by their section names here ("build the pending strip
from DESIGN.md as a server component", "build the Mineral properties card with
its info marks").
