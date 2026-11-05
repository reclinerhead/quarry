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
  least 48 px tall. (Design px: a desktop draws everything at 90%, §3.)
  One idea per card. Nothing hides behind hover or an
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
  1.8–2 px stroke line icons, inline SVG. Nothing moves except Jasper at work
  (§4), and nothing at all under reduced motion.
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
- **Drawn at 90% on a desktop.** With a mouse or trackpad (`hover: hover`
  and `pointer: fine`), the site's root carries `zoom: 0.9` (#55), the
  browser's one notch smaller built in, so every px in this file and on the
  canvas is a design px that draws at nine tenths: 18 px body text reads at
  16.2, a 48 px target at 43. Type, spacing, targets and photos shrink
  together, so the proportions here hold. Phones and tablets, held close and
  tapped, draw at full size. Write sizes in design px; never pre-shrink one.
- Formulas use real subscript characters (`CaF₂`, `SiO₂`), not `<sub>`.
- Mineral names are upright and capitalized (Fluorite, Milky Quartz). There
  is no italic binomial here. A stone is named as a rock-show label names it
  (#29): the hobby or trade name leads (Amethyst, Blue Lace Agate), the other
  minerals follow with "with" and the base with "on" ("Fluorite with Pyrite on
  Quartz", "Amethyst on matrix", "matrix" lowercase). The species goes on the
  line under a hobby name ("A kind of Quartz"), the only place it shows. Long
  names wrap; they are never cut with an ellipsis.

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
to its left ("Hardness", "Sort by"). Native `<select>`, so older phones get their
own big picker. On a mouse, where the browser lets a `<select>` style its
list, the open list is a white card of 48 px pill rows: sand under the
pointer, the chosen one azurite and bold with the chip's check.

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
catalog dab, then name (Zilla 24/600), the "A kind of …" or description line
(ink-2, 17), "Where it lives · added Month D" (ink-3, 16), then a row of tags
(Mohs, kind, mineral class, UV). The whole card is one `<a>`.

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
one-column list with mineral names (the canvas's 5 × 2 can't hold
"Orthoclase" at the side column's width). The specimen page shows a single
row of ten with this stone's slot solid.

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
one primary button ("Name them"). While Jasper still has rocks and none waits
for a name, the same box holds them as a plain white card (nothing needs you
yet): their thumbs (the crystal placeholder for a rock he hasn't started),
"N rocks waiting for Jasper", Jasper at work under it, and the button's room
kept empty. When he's done it turns amber in place, with no reload. The add
page holds its sent rocks in the same strip, at the top under the lead line,
with two states of its own in the plain card: rocks still sending ("Keep this
page open until they're sent."), and rocks that couldn't be sent, the reason in
words with "Send it again" and "Remove" in the button's room.

**Jasper at work**: the one thing that moves. A rock hammer line icon in
azurite, 1.5em, pivoting at the grip to tap a stone, with two ticks flashing at
each strike. Beside it, a rock hound's line that changes every 2.5 s ("Digging
in…", "Giving it a lick…", "Hand lens out…"). The lines are plain words, never
a term that needs an info mark, and short enough to stay on one line in a
narrow row. It's decoration beside a status that says where things stand, so
it's hidden from screen readers. Under reduced motion the hammer rests on the
stone and the line holds. It sits in the add page's sent strip, the dashboard's
working strip, and under the confirm screen's heading while Jasper has the
stone ("Jasper is looking…", and "Jasper is looking again…" after a test
answer). The cursor never says "busy": a disabled control keeps the arrow,
since the progress cursor reads as a hung browser.

**Candidate pills** (naming, and "How it was named"): confirmed name = solid
azurite with a check. Other candidates = outlined, 64 px tall, the piece's
name in Zilla 24 with "A kind of …" under a hobby name. Corners are half the
one-line height (32 px; 24 on the 48 px "How it was named" rows), so a long
name wraps into a rounded card rather than an oval. The name has first claim
on the pill's width; on a phone, where the tags can't fit beside it, they drop
under the name rather than squeezing it. Each carries a plain
word, never a percentage. A mineral only one opinion saw sits under the lead
pill as a chip, off by default ("Jasper also saw Sphalerite (one opinion).
Add it?"); ticking it adds it to the pill's name, so the pill always says
what a tap saves. "probably" goes on the lead pill when Jasper's two opinions agree,
with an `azurite-soft` tag and a 2 px azurite border. "could be" goes on each
pill when they differ, and "could also be" on the rest, both as sand tags.
Phase 0 (#1) settled this: two models agreeing were right about 9 times in 10,
and a model's own confidence meant much less. On the naming screen the pills
sit in a **well**: the page's `ground` inside the white card, 14 px radius,
1 px `line` border, 16 px padding, headed "Jasper's suggestions" in the meta
style, holding the pills with their "Why?", notes and chips. White pills on
limestone read as things to press; on white they read as rows, the same
shape as the fields under them. The well is the card's one thing to do, so
"Name it" beside the typed-name field is a soft button while there are pills
(primary belongs to the one main action, a tap on a pill) and primary only on
the no-guess screen. What goes with the name (variety, made of, form) is one
"Details to save with the name (optional)" group under the name field, behind
a hairline.

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

**Case tile** (show cases): a stone as it sits in a display case. The
stone's thumbnail, 130 px, 12 px radius, as a `<button>` that picks it up
(selected = 4 px azurite border, `aria-pressed`; hover `line-strong`), with
its **number in the case** on the photo's top-left corner the way the
catalog dab sits (`label` fill, 1 px `line-2`, 6 px radius, 32 px, Zilla
21/600 in ink: catalog red stays for catalog numbers). Under it a **paper
label**: the box-label paper (`label` fill, 1 px `line-2`, 4 px radius),
48 px tall, with the stone's name (700, wraps on words, never cut), which is
the link to the stone's page: tap the rock to move it, tap its label to
read about it. A stone with no photo gets the collection's tinted tile.
While dragged the tile fades to 40%. Tiles sit in an auto-fill grid of at
least 160 px (128 on a phone, two across).

**Breadcrumb**: Collection › Class › Mineral › Catalog number
(Collection › Halides › Fluorite › Q-0047), 17 px, ink-2 700 links, current
page in ink.

**Photo gallery**: hero photo at 640 px tall, `object-fit: contain` on a dark
`photo-well` (rocks get photographed in every aspect ratio, and cropping cuts
off the specimen), 22 px radius, with a dark caption pill naming the source
and date ("Your photo · whole stone · Oct 31, 2026"). Beside it, "More photos
of this stone": a 2-across grid of 170 px thumbnail buttons (selected = 4 px
azurite border, `aria-pressed`) that swap the hero, plus a dashed "Add a
photo" tile. The main photo, the one the stone is known by on its card and
in every list, wears a small "Main photo" pill in its thumbnail's lower-left
corner, in the caption pill's recipe, and the hero's caption ends "· Main
photo" while it is showing. Under the grid, one soft 48 px button, "Use this
as the main photo", while another photo is selected; its row keeps its
height when the button is gone, so choosing never moves the page. Opposite
the caption, bottom-right of the well (top-right on a phone, whose 360 px
well may wrap the caption to two lines), "See it full size": a pill in the
caption's colours with the expand icon (four corner arrows), 48 px; it and a
tap on the hero open the photo in a lightbox over the page, the viewport
its size, the backdrop the photo well at 0.96, the controls surface white,
"2 of 5" in the corner in the caption's weight, pinch and scroll to zoom,
arrows and swipe between the stone's photos; closing lands on the page
where it was, with the last photo shown now in the well. Under the grid, a
tip about the coin-for-scale and shop-tag photos, and the Wikipedia
reference image as a small row. The owner's photos always outrank the
reference image.

## 5. Page anatomy

**Top bar** (both pages, white, hairline bottom border, then the strata band):
faceted-gem mark + "The Quarry" in Zilla 30/700 · nav pills (Collection,
Minerals, Periodic table, Show cases, Labels, Gem Show; active = `sand-2` fill,
`aria-current`) · search (pill, hand-lens icon, "Search your rocks") ·
primary "Add a rock" with a camera icon. Wraps to two rows on narrow screens.

**Dashboard**, top to bottom:
1. Date, then a greeting that says what changed ("Good evening. Two new stones
   today."), and one line on what the new stones added (a Mohs slot, new
   elements).
2. Pending strip (only while something waits for a name, or Jasper still has it).
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
2. Title block: catalog dab · the piece's name (60), "matrix" with its info
   mark · "A kind of Quartz" under a hobby name · tags (class, habit, Mohs, UV,
   "N in your collection"), all for the main mineral; the formula is not here,
   it shows once, in Mineral properties under the mineral's name · right:
   Print label (soft), Edit details (soft), Add photos (primary).
3. Photo gallery.
4. Two columns, same split as the dashboard.
   - Main: **This specimen** (the label card) · **Kitchen-table tests** (with
     the card check) · **About [mineral]** (the heading names the article the
     lead came from, "About Gneiss" on a Granite Gneiss, with the mineral info
     mark; Wikipedia's lead paragraphs, whole; "From Wikipedia · fetched <date>"
     right of the heading, then "Read the article on Wikipedia"; before Jasper
     has asked, or for a name Wikipedia has no article for, one line holds the
     card's place) · **Mineral properties** (the meta line names the
     main mineral the cells are about, "Pyrite ⓘ, from Mindat"; Mindat cells: Formula,
     Mohs hardness, Crystal system, Luster, Streak, Cleavage, Specific gravity,
     Fluorescence, each with an info mark, then the note block) · **Where it's
     found** (Mindat's places in the USA, with its locality info mark: one line
     with Michigan's rank among the states, then "In Michigan" and "Across the
     USA" as hairline rows linking to Mindat, eight and "and N more", then "See
     every place on Mindat") · **Taking care of it** (handling notes) · **Related stones you already have** (same class,
     same habit, same trait).
   - Side: How it was named (candidate pills + "Change the name") · At the
     show (a "Show case" select, §4, "Not in a case" or a case by name; under
     it "In Booth 12, stone 7 of 12." and "Arrange the case") · What it's
     made of (element tiles + link to the periodic table; with two or more
     minerals on the piece, a group per mineral under "Sphalerite · ZnS", each
     element once, under the first mineral that carries it) · On your Mohs scale
     · Its story so far (timeline) · Box label (preview + Print labels).

**Show cases page** (`/show`): the display cases a household sets up at the
club's rock show, and what goes in each. "Show cases", not "Gem Show": the
Gem Show pill is Phase 4's hub.
1. Title "Show cases" (34) and a lead line: plan the cases before the show;
   at the hall, open the same page on a phone and set the stones out in the
   order of their numbers. Under it, one status line (`aria-live`), its room
   always kept.
2. One card per case, drawn as the case: the name as the sign (Zilla 30),
   "12 stones" with its note, "Add stones" (primary) at the right. Then the
   **shelf**: a `ground` well inside the card (14 px radius, `line` border)
   holding the **case tiles** (§4) in an auto-fill grid (min 160 px, 128 on
   a phone, where they go two across). An empty shelf keeps a tile row's height and says
   "Nothing in it yet."
3. Under each shelf the **move row**, 48 px and always there: "Tap a stone
   to move it" (", or drag it where it goes" on a mouse), or, with a stone
   picked up, soft pills Move earlier · Move later · Take out, and a "Move
   to" select of the other cases when there are two or more. This tap path
   is the contract; on a mouse or trackpad (`hover: hover` and
   `pointer: fine`) the tiles also drag, within a case and onto another,
   with a dashed slot (`line-strong`, a tile's height) where the stone
   would land and the shelf's border going `line-strong`. A touch screen
   never drags.
4. The card's footer: Rename (opens the name and note fields in place),
   Move up / Move down (the cases' order), and at the right "Remove this
   case" → "Yes, remove it" with "Keep it", the question in a reserved line.
   Removing a case never removes a stone.
5. **Add a case** last: a name field offered the next free "Case N", and a
   soft button. With no cases, a dashed card of one case's height above it
   says the first will appear there.

**Add stones page** (`/show/[id]/add`): breadcrumb Show cases › Booth 12 ›
Add stones; title "Add stones to Booth 12"; a search pill and, beside it,
the one primary action, "Add 4 stones to Booth 12", live with the count (its
room holds "Tick the stones you want in Booth 12." while none is). Then the
collection as side-panel rows (§4) in a card, a 48 px checkbox first; a
stone already in this case has no checkbox; where a stone is reads as a
line under its name ("Already in Booth 12", "In Booth 3 · would move here"),
not a column at the right, which would squeeze the name on a phone.

**Periodic table page** (`/periodic-table`), designed at laptop width:
1. Title "Your periodic table" with its info mark, the count line ("14 of the
   118 elements lit, from 47 stones") and the newest arrival ("Fluorine came
   with your Fluorite on Oct 31").
2. **Your elements**: the lit elements as element tiles (§4), by atomic
   number, each with its stone count; each is a link that selects it.
3. **The table**: the standard 18-column layout in a card, lanthanides and
   actinides in two rows below. Cells are 48 px squares, number over symbol.
   Unlit = the Mohs set's dashed slot in `ink-3`; lit = `azurite-soft`, a
   link; selected = solid azurite. Lit means any named mineral on a confirmed
   stone carries the element: a piece's elements are additive, unlike its
   formula.
4. **Stones with calcium**: the side-panel rows (§4) for the stones that carry
   the selected element, newest first, each naming the mineral on the piece
   that has it and its formula. With nothing selected the card holds its room.

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
stays 18 px. One exception, decided for #48: the periodic table's card scrolls
sideways inside itself on a narrow screen, since 18 readable columns can't fit
in 358 px; the page itself never scrolls sideways, and the element tiles above
the table are the phone's way in.

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
- Contrast as measured in §2. 48 px minimum targets, 52 px for primary
  (design px, §3).
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
