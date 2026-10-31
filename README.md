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

**A hosted model, not a local one.** The identifier is a cheap hosted model: a Haiku-class Claude model or Gemini's free tier, both expected to cost a fraction of a cent per photo and both more accurate than anything that runs locally. A hosted model also means every station identifies on its own, with nothing depending on the house, which keeps the Conservatory's rule. Ollama on bluejay (the house desktop with the graphics card) running Qwen-VL, Llama 3.2 Vision, or Gemma 3 is held in reserve: it is the fallback only if Phase 0 finds the real cost per identification well above what is hoped. The model sits behind one interface (photos and notes in, candidates and tests out), so swapping providers is a configuration change, not a rewrite. Gemini's free tier lets Google use what it is sent to improve its products. That is acceptable for photos of rocks, but worth knowing.

**The notes matter as much as the photo.** A mineral is defined by its chemistry and its crystal structure, and a photo shows neither. So the prompt carries everything the person can add: where it was found or bought, its approximate size, and the tests, each answered yes, no, or *not tried*, which is not the same as no. A vision model can also read, unlike a classifier, so a photo of the dealer's label or the gem show tag goes in as evidence too.

**The tests do the work the photo cannot.** When the candidates are lookalikes, the confirm screen shows the tests that separate them. A clear crystal could be quartz, calcite, or fluorite: quartz scratches glass, calcite fizzes in vinegar, fluorite does neither. Answering sends the job back through the model with the new facts. This is the Quarry's version of the Conservatory's "add another photo of this plant" button.

**The model's confidence is its own guess.** A classifier's score comes from training on labeled examples. A language model's stated confidence is a sentence it wrote, and language models tend to be overconfident. Until Phase 0 shows that its "high" is right more often than its "low", the pills show the candidates in rank order with a plain word (likely, possible) rather than a percentage.

**The owner always confirms.** The model only suggests. The confirm screen shows the candidates as pills, a name field with autocomplete against the minerals already in the collection, and the options to skip for now or mark the photo as not a rock. Confirming saves at once, and a "Change" link reverses it. Both are kept, the model's candidates and the name the person confirmed, so every confirmation becomes a labeled example. Over time the household builds its own accuracy record, and the next model can be scored against it before it is swapped in.

**What a photo cannot show.** Lookalikes are the rule, not the exception: quartz, calcite, and fluorite; pyrite, marcasite, and chalcopyrite; red jasper and carnelian. Tumbled and polished stones have lost the crystal shape that would have told them apart. Much of a family collection is also not a mineral species. Granite, basalt, and obsidian are rocks, which are mixtures of minerals. Amethyst and agate are varieties of something else (quartz, chalcedony). Shop stones carry trade names like "Tiger's Eye", "Blue Lace Agate", and "Rainbow Moonstone", and are sometimes dyed, heat-treated, or lab-grown. Three design consequences:

- A specimen's name has two parts: the mineral or rock, and an optional variety or trade name (Quartz, variety Amethyst; Chalcedony, "Blue Lace Agate"). The Mindat record attaches to the first part. This is the Conservatory's cultivar field, for stones.
- A rock's property card is thinner than a mineral's: Mindat's record where it has one, and the specimen's own notes and tests.
- The first thing built is a spike that measures accuracy on the family's own labeled specimens, with and without the test answers.

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

On the same small boxes that run the Aviary and the Conservatory, one per household, alongside them. Each station has its own worker, database, and dashboard, calls the hosted model and Mindat directly, and never depends on the house. Deploys follow the Aviary's pattern: git-driven autodeploy with a promotion channel for the field stations, a Caddy front door, Tailscale between stations for the hub to pull digests. The code is a separate repository on purpose.

## Tech stack (planned)

| Layer | Built with |
| --- | --- |
| Identification | A hosted vision language model (Haiku-class Claude or Gemini) returning structured candidates and tests, with the owner confirming every result; Ollama on bluejay as the fallback |
| Enrichment | Mindat API via `openmindat`, cached per mineral; Wikipedia; the same model for handling notes, once per mineral |
| Queue and storage | Python worker, SQLite |
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, pnpm |
| Labels | QR codes on printable specimen labels |
| Stations and ops | systemd, Caddy, Tailscale, git-driven autodeploy |
| Tests | pytest and Vitest on every pull request |

## Plan

- **Phase 0, the spike.** A throwaway script sends about thirty specimens whose names the family already knows (dealer labels, gem show tags, the pieces a collector is sure of) through the hosted candidates, each twice: photo alone, then photo plus the test answers. It reports top-1 and top-3 accuracy, whether stated confidence tracks being right, and the actual cost per identification from the token counts. It also checks that Mindat returns what the property card needs for every mineral in the set. This picks the model, and confirms the cost, before any interface exists. Ollama on bluejay is scored only if the hosted cost disappoints.
- **Phase 1, one household.** Capture from the camera roll and on the spot, the job queue, the confirm screen with its tests, and a dashboard of specimens. Its look gets its own `design/DESIGN.md`, in the Conservatory's structure but not its palette. Runs at the house first.
- **Phase 2, the minerals.** The Mindat enrichment and its cache, mineral pages, property cards, handling notes, the glossary, the periodic table.
- **Phase 3, the labels.** Catalog numbers, printable specimen labels with QR codes, the provenance log.
- **Phase 4, the gem show.** Digests from each household, the hub, ribbons.

## Open questions

- How the worker and the hub are named. The Aviary has Earl and Willard, and the Conservatory has Fern. The Quarry's worker is provisionally **Jasper**, a stone and an old-fashioned name, as Fern is a plant and one. The hub is provisionally **the Gem Show**.
- Copy or share. The Conservatory copies the Aviary's patterns rather than sharing code "until a second caller justifies a shared package". The Quarry is that second caller for the uploader, the queue, and the confirm strip. The lean is to copy for Phase 1, while the Conservatory's versions are days old and still moving, and extract a shared package once both apps have shipped and the seams are visible.
- Whether the find site can be read from a photo's location data before the browser's resize strips it, or is always typed.
- Which hosted model, and whether stations share one API key or carry their own.

## Credits

Mineral data from [Mindat.org](https://www.mindat.org/) through the OpenMindat API, used under CC BY-NC-SA for a private, non-commercial family site. Summaries from Wikipedia. The identification model is credited here once Phase 0 picks it.

## License

MIT.
