# Vision model spike

Phase 0 of the Quarry ([#1](https://github.com/reclinerhead/quarry/issues/1)). A hand-run script that sends our own specimen photos to cheap hosted vision models, asks each for structured candidates and at-home tests, and scores the answers: accuracy with and without the owner's notes, whether the stated confidence means anything, and what each identification actually costs.

## Setup, once

```powershell
cd C:\WEBDEV\quarry\spikes\vision
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Two API keys, set in the shell you run from. Neither is ever passed on the command line, and nothing here writes them to disk. A model whose key is missing is skipped.

```powershell
$env:ANTHROPIC_API_KEY = "paste it here"   # console.anthropic.com
$env:GEMINI_API_KEY = "paste it here"      # aistudio.google.com, free tier
```

Gemini's free tier lets Google use what it is sent to improve its products. Photos of rocks are fine.

## Photos

**The quick way:** drop photos into a flat folder such as `photos/` (ignored by git). Each is identified and the candidates are printed for you to judge by eye. No naming, no scoring.

**The scored way**, for any specimen whose name you know, is one folder per name:

```
photos/
  Quartz/                      what you believe it is
    point-1.jpg
    point-1.txt                optional notes for point-1.jpg
  Chalcedony var. Agate/       "Mineral var. Variety" when you know both
    beach-agate.jpg
  Amethyst/                    a variety alone is fine too
    geode.jpg
  Pyrite/
    cube_top.jpg               with --group, cube_top and cube_side are one specimen
    cube_side.jpg
    cube.txt                   notes for the group
```

A folder named `Chalcedony var. Agate` accepts either name, so an answer of plain "Chalcedony" still counts. A folder named just `Agate` only accepts answers that say agate somewhere (as the name or the variety).

**Notes** are free text, written the way the owner would say them, in a `.txt` file named after the photo (or the group). A specimen with notes runs twice, once on the photo alone and once with the notes, and the gap between the two passes shows what the notes are worth.

```
Found on a Lake Superior beach. Scratches glass: yes. Vinegar: no fizz.
Magnet: no. Streak: white. About 3 cm.
```

**Labels.** If a photo shows a dealer's label or a show tag, the model can read it, and that is not a fair test of what it sees in the stone. The script asks the model to copy any label text it finds and marks those rows `[label]`. Crop labels out for the scored run, or read those rows with that in mind.

## Run

```powershell
.venv\Scripts\python identify_spike.py photos
```

Add `--group` to send photos that share a stem (`cube_top.jpg` and `cube_side.jpg`) as one specimen, up to five photos. Add `--models` to change which models run; the default is `claude-haiku-5-5,gemini-3.8-flash`, and `claude-sonnet-5-5` is worth one run as an upper bound on what a stronger model would get. Add `--effort low` or `--effort high` to see whether Claude's thinking depth changes the answers or just the cost.

Every successful response is cached in `out/responses/` (ignored by git), so re-running costs nothing. Delete a cached file to re-query that one. Errors are not cached, so a re-run retries them. The run writes `out/results.md` and `out/results.csv` and prints a summary per model and pass.

## Reading the numbers

- **Top-3** is the number that matters for the product. The confirm screen shows three pills, and the tests are there to pick between them.
- **Top-1 by confidence band** is the calibration check. If the "high" band is not right much more often than the "low" band, the app shows words (likely, possible), not percentages.
- **Photo vs notes** is the case for the notes form. If notes barely move the numbers, the form can stay short.
- **Cost per 1000** is the number to compare against the hope. A family collection's backlog is a few hundred specimens, so the cost of cataloguing all of it is about that figure.
- **Label read** counts the identifications where a visible label may have done the work.
