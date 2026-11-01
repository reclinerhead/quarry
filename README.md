# The Quarry

**A living inventory of the rocks, minerals, and crystals in a household, built from photos taken on a phone.**

The Quarry is where a rock collection gets catalogued, named, and explained. Photograph a geode from a gem show, a handful of agates from a beach, or a crystal point from a gift shop, and the Quarry suggests what it is, asks for a couple of kitchen-table tests to tell the lookalikes apart, adds it to the collection once a person confirms the name, and pulls together what is known about the mineral: its formula, its hardness, its crystal system, where it was first described. Over time the egg cartons, tackle boxes, and windowsills become a collection a person actually wants to open, and every specimen gets a label that can be scanned.

It is being built for the rock hounds in one family, who come home from beaches, creek beds, road cuts, and gem shows with their pockets full. A collection like that outgrows memory fast: which drawer the fluorite is in, where the geode came from, whether anyone ever worked out what the green one is. The Quarry is the version that remembers.

It also teaches. The person building it could not tell quartz from calcite, which makes a useful test. Every mineralogical term the app shows carries a small info mark that explains it in plain language, with an example from the person's own collection when there is one. Nobody should have to leave the app to understand the app.

> **Status:** design stage. Nothing runs yet. This README is the design brief and will become the project guide as the code lands.

## Lineage

The Quarry is the fifth app in a family of home-scale projects, and it is being built alongside the fourth:

- **[The Conservatory](https://github.com/reclinerhead/conservatory)** is the twin. Same idea, same shape, for plants: photos go in, a worker on the household's station asks an identifier, candidates come out, the owner confirms, an enrichment pass builds each species page, and a hub gathers every household into one family view. The Quarry follows that design almost step for step. It differs at one point, the identifier, because rocks have no Pl@ntNet.
- **[The Aviary](https://github.com/reclinerhead/aviary)** is the template both twins follow: a purpose-built identifier, an enrichment pass from Wikipedia, a page per species, field stations at family members' homes, and a community hub. The Quarry runs on the same boxes.
- **[Hearth](https://github.com/reclinerhead/hearth)** contributes the uploader: a phone-first capture flow where a photo becomes a structured record, with browser-side compression so uploads survive a weak connection.
- **Échoes**, a private family archive, contributes the identification step. Its photo wizard shows suggestion pills, lets the person type a name instead, saves every confirmation immediately, and makes every mis-tap reversible. Those rules were learned with older family members as the users, and they carry over unchanged.

## What it will do

- **Add a specimen from a photo.** Upload one photo or ten. Each becomes an identification job, and the worker on the household's station sends it, with whatever the person noted, to a vision language model. The result is a short list of candidates, the features that point to each, and the at-home tests that would tell them apart. The owner confirms, corrects, or types the name from the dealer's label.
- **Keep the collection.** Every confirmed piece is a *specimen* with a catalog number, a name, where it was found or bought, when, by whom, where it lives now (a display case, a drawer, a windowsill), its size, a photo set, and the results of any tests done on it. A short provenance log records what happened to it: found, bought, gifted, traded, cleaned, moved, given away. A specimen that came out of a grandparent's collection keeps that history.
- **Know the minerals.** Each mineral has its own page: a property card from Mindat (formula, Mohs hardness, crystal system, luster, streak, type locality, varieties), the Wikipedia summary and reference image, every specimen of it in the household, and its relatives in the collection, meaning other members of the same mineral group.
- **Light up the periodic table.** Every element that appears in a confirmed specimen's formula lights up on a periodic table, and tapping one lists the specimens that carry it. It is a join over the Mindat formulas, not a model call.
- **Label the specimens.** Collectors already keep a paper label in each specimen's box (name, locality, date, collector) and a catalog number dabbed on the stone itself. The Quarry assigns the numbers and prints the labels on sheets, each with a QR code that opens the specimen's page. Scan one with the phone camera to find out what a stone is and where it came from.
- **Explain itself.** Mineral, rock, variety, Mohs hardness, streak, luster, cleavage, fracture, habit, crystal system, specific gravity, type locality, pseudomorph: each one is a word with an info mark beside it, and the explanation uses the reader's own specimens as the example. "Mohs 7: harder than a steel knife, which is why the amethyst from the gift shop scratched the glass."
- **Hold a gem show.** Each household publishes a digest, and a hub at the house gathers them into a family view with ribbons: most species, most elements on the periodic table, the full Mohs scale (one specimen of each of the ten reference minerals, talc through diamond), the farthest find, find of the month.

## How identification works

**There is no Pl@ntNet for rocks.** The Aviary has BirdNET and the Conservatory has Pl@ntNet, classifiers trained on millions of labeled examples and free for a family to use. Nothing like that exists for minerals. The identifier is a general **vision language model**, held to a JSON schema, which returns the top two or three candidates with a confidence, the distinguishing features it saw in the photo, and the at-home tests that would separate its own candidates: a hardness scratch against glass, a streak on the back of a bathroom tile, a drop of vinegar for fizz, a fridge magnet. The Conservatory considered a vision model for plants and rejected it because a better tool existed. Here, it is the best tool there is.

**Two hosted models, not a local one.** The identifier is Claude Haiku, with Gemini Flash as a second opinion from a different company. Phase 0 measured them at under a tenth of a cent and about a third of a cent per photo (Gemini at low effort, which cost it no accuracy), so a family's whole backlog costs a dollar or two to identify. Both are more accurate than anything that runs locally, and hosted models mean every station identifies on its own, with nothing depending on the house, which keeps the Conservatory's rule. They are reached through the Vercel AI Gateway, the route the Aviary and the Conservatory already use: one key on a station reaches every provider's models by slug, at the provider's list price, and the gateway reports what each call cost. The models sit behind one interface (photos and notes in, candidates and tests out), so swapping either is a one-line configuration change, not a rewrite. Ollama on bluejay, once the fallback in case hosted models proved expensive, is not needed.

**The notes matter as much as the photo.** A mineral is defined by its chemistry and its crystal structure, and a photo shows neither. So the prompt carries everything the person can add: where it was found or bought, its approximate size, and the tests, each answered yes, no, or *not tried*, which is not the same as no. A vision model can also read, unlike a classifier, so a photo of the dealer's label or the gem show tag goes in as evidence too.

**Two opinions, in plain words.** A photo alone does not name a stone reliably. In Phase 0, on photos of 38 expert-identified specimens, the first guess was right about three times in five whichever of four models made it, and the dearest model did no better than the cheapest. What held up was agreement. When Claude Haiku and Gemini Flash, from different companies, named the same thing, they were right nearly nine times in ten, more often than two models from the same company that agreed. A model's own stated confidence helped less: Claude's 0.7 or more was right 28 times in 29 but came on only a third of the stones, and a low score marked a guess that changed when the same photo was asked again. So the confirm screen speaks in words, not percentages: **probably** galena when the two agree, **could be** pyrite or chalcopyrite when they don't. About one stone in six was beyond every model, the right name missing even from its top three, so "could be" never promises the answer is among the names it shows.

**The tests settle what the photo cannot, for whoever wants to be sure.** When the candidates are lookalikes, the confirm screen offers the test that separates them. A clear crystal could be quartz, calcite, or fluorite: quartz scratches glass, calcite fizzes in vinegar, fluorite does neither. Answering sends the job back through the models with the new facts. Nobody has to: the app names what it can without them, and the test waits behind "want to be sure?" This is the Quarry's version of the Conservatory's "add another photo of this plant" button.

**The owner confirms, and the app records how.** The models only suggest, and the owner may know no more than they do. The confirm screen shows the candidates as pills, a name field with autocomplete against the minerals already in the collection, and the options to skip for now or mark the photo as not a rock. Confirming saves at once, and a "Change" link reverses it. Both are kept, the models' candidates and the name the person confirmed, along with how it was confirmed: from a label, by the tests, by someone who knows (a rock club, a dealer), or by accepting the suggestion. Only the first three count as known answers. Over time the household builds its own accuracy record from them, and the next model can be scored against it before it is swapped in, without the app ever being graded on its own guesses.

**What a photo cannot show.** Lookalikes are the rule, not the exception: quartz, calcite, and fluorite; pyrite, marcasite, and chalcopyrite; red jasper and carnelian. Tumbled and polished stones have lost the crystal shape that would have told them apart. Much of a family collection is also not a mineral species. Granite, basalt, and obsidian are rocks, which are mixtures of minerals. Amethyst and agate are varieties of something else (quartz, chalcedony). Shop stones carry trade names like "Tiger's Eye", "Blue Lace Agate", and "Rainbow Moonstone", and are sometimes dyed, heat-treated, or lab-grown. Two design consequences:

- A specimen's name has two parts: the mineral or rock, and an optional variety or trade name (Quartz, variety Amethyst; Chalcedony, "Blue Lace Agate"). The Mindat record attaches to the first part. This is the Conservatory's cultivar field, for stones.
- A rock's property card is thinner than a mineral's: Mindat's record where it has one, and the specimen's own notes and tests.

**Rejected:** hobbyist mineral classifiers on Hugging Face (too few classes, and overconfident about the ones they have), mineralML (it needs oxide chemistry as input, not photos), and the consumer "Rock Identifier" apps (no API).

## Two ways to add a specimen, one queue

The best finds happen where there is no signal: a beach, a creek bed, a road cut, the far end of a gem mine. Both ways in use the same pipeline. The only difference is whether the person waits for the answer.

**From the camera roll, later.** Take photos at the beach with the normal camera app, which needs no signal: one close-up in daylight and one with a coin beside it for scale. Back home, open the Quarry on the house Wi-Fi, multi-select the photos, and upload. Each becomes a queued job. Come back whenever: the dashboard reserves a strip that reads "9 specimens waiting for a name", and tapping it walks through them one specimen per screen, with large pills, the suggested tests, and a "same specimen as the last one" button that merges a close-up, a scale shot, and a label photo into one record. The camera roll is the offline mode. No service worker, no browser-side queue, nothing to break on an old phone.

**On the spot.** Take a photo in the app at the kitchen table. The upload creates the same job, the page waits on it, and the pills appear in place a few seconds later, with the tests beside them. Walk away mid-way and the job simply waits in the strip.

**The queue is the resilience.** Jobs live in SQLite on the station and survive a restart. A worker drains them one at a time, which keeps the model calls under any rate limit and makes a dropped connection or a provider outage a retry rather than a loss. Photos are resized in the browser to about 1280 px on the long side before upload, each sent as its own request with retry, so a drop on photo seven keeps one through six. The queue matters more here than in the Conservatory, because the Quarry's first job is the backlog: a collection that already fills drawers arrives in batches of dozens.

Access from outside the house is not part of the first version. The station is reachable on its own LAN through the same public front door the Aviary uses, and that covers every flow above.

## Enrichment

The enrichment pass runs once per mineral, the first time a mineral is confirmed anywhere in the household:

- **Mindat** is the field guide. Through the OpenMindat API (Python wrapper `openmindat`, a free API key), the worker looks up the canonical record: formula, Mohs hardness, crystal system, luster, streak, type locality, and varieties. Each record is cached per mineral in the database, so a second specimen of the same mineral never re-queries and the site keeps working when the API is down.
- **Wikipedia** supplies the summary and the reference image, with the household's own photo as the hero once there is one.
- **A language model**, the same hosted one, writes short handling notes once per mineral from the Mindat record and stores them: water-soluble (don't rinse the halite), fades in sunlight (keep the amethyst off the windowsill), wash your hands after handling (the realgar). Every figure the notes rely on is kept so it can be checked.

The property card also checks the household's own tests against Mindat. A "calcite" that someone recorded as scratching glass gets a quiet note: calcite is Mohs 3, so either the name or the test is wrong. It is a comparison, not a model call, and it teaches the household how to read the card.

## Where it runs

On the same small boxes that run the Aviary and the Conservatory, one per household, alongside them. Each station has its own worker, database, and dashboard, calls the hosted models and Mindat directly, and never depends on the house. Deploys follow the Aviary's pattern: git-driven autodeploy with a promotion channel for the field stations, a Caddy front door, Tailscale between stations for the hub to pull digests. The code is a separate repository on purpose.

## Tech stack (planned)

| Layer | Built with |
| --- | --- |
| Identification | Claude Haiku with Gemini Flash (low effort) as a second opinion, through the Vercel AI Gateway, each returning structured candidates and tests; "probably" when they agree, "could be" when they don't; the owner confirms every result and how |
| Enrichment | Mindat API via `openmindat`, cached per mineral; Wikipedia; Claude for handling notes, once per mineral |
| Queue and storage | Python worker, SQLite |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, pnpm |
| Labels | QR codes on printable specimen labels |
| Stations and ops | systemd, Caddy, Tailscale, git-driven autodeploy |
| Tests | pytest and Vitest on every pull request |

## Plan

- **Phase 0, the spike.** Identification is done: a throwaway script (`spikes/vision/`) scored four hosted models on 38 expert-identified specimen photos from Wikimedia Commons, and on 11 of the family's own unnamed stones, for accuracy, calibration, agreement between models, and cost. It picked Claude Haiku with Gemini Flash as the second opinion; the numbers are in [#1](https://github.com/reclinerhead/quarry/issues/1). Still to do: check that Mindat returns what the property card needs for every mineral in the set.
- **Phase 1, one household.** Capture from the camera roll and on the spot, the job queue, the confirm screen with its tests, and a dashboard of specimens. Its look gets its own `design/DESIGN.md`, in the Conservatory's structure but not its palette. Runs at the house first.
- **Phase 2, the minerals.** The Mindat enrichment and its cache, mineral pages, property cards, handling notes, the glossary, the periodic table.
- **Phase 3, the labels.** Catalog numbers, printable specimen labels with QR codes, the provenance log.
- **Phase 4, the gem show.** Digests from each household, the hub, ribbons.

## Open questions

- How the worker and the hub are named. The Aviary has Earl and Willard, and the Conservatory has Fern. The Quarry's worker is provisionally **Jasper**, a stone and an old-fashioned name, as Fern is a plant and one. The hub is provisionally **the Gem Show**.
- Copy or share. The Conservatory copies the Aviary's patterns rather than sharing code "until a second caller justifies a shared package". The Quarry is that second caller for the uploader, the queue, and the confirm strip. The lean is to copy for Phase 1, while the Conservatory's versions are days old and still moving, and extract a shared package once both apps have shipped and the seams are visible.
- Whether the find site can be read from a photo's location data before the browser's resize strips it, or is always typed.
- Whether stations share one gateway key or each carries its own (separate keys would show each household's spend apart).
- How to name a specimen that is several minerals at once, such as calcite crystals on a bed of sphalerite. The models name whichever caught their eye, and the two-part name has room for only one. The choices are one name with the rest in the notes, or a list of minerals, each with its own Mindat record.

## Credits

Mineral data from [Mindat.org](https://www.mindat.org/) through the OpenMindat API, used under CC BY-NC-SA for a private, non-commercial family site. Summaries from Wikipedia. Identification by Claude (Anthropic) and Gemini (Google), through the Vercel AI Gateway.

## License

MIT.
