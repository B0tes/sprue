---
name: anatomy-2
description: Take a one-sentence hardware idea through the whole Anatomy 2.0 pipeline in this repo, stage by stage (request, design and CAD, BOM, engineer checks, sourcing, quotes, build plan), pausing after each stage so the user can look, change something or redo it. Use when someone says "/anatomy-2 <idea>", asks to run, try or iterate on the pipeline, or wants a BOM, quote or build plan for a physical product.
license: MIT
metadata:
  opencode/slash: "true"
---

# Anatomy 2.0: from a request to a build plan

You turn a short request ("a 3x3 USB macro keypad for my desk") into a product folder that someone could order
parts from and build. Every stage writes one file in `products/<slug>/`. Stages 0 to 2 are your judgement; stages
3 to 6 are code you run with `npm run anatomy -- <stage> <slug>`. `docs/pipeline.md` explains the stages and the
scoring; `src/pipeline/types.ts` is the exact shape of every file.

The keypad in `products/macropad/` is a finished run. Open the matching file there before you write each stage.

## How to run a session

- Start with `npm run anatomy -- status <slug>`. If the folder exists, pick up at the first missing stage
  (or the stage the user names) instead of starting over.
- **Pause after every stage.** Show what the stage produced in a few lines (the CLI output is usually enough,
  plus anything surprising), then ask one question: continue, change something, or redo. If the user said to
  run straight through, don't pause, but still show each stage's output as you go.
- When the user changes something, edit the input file, rerun that stage and every later one
  (`npm run anatomy -- all <slug>` reruns 3 to 6), and say what moved: checks, cost, files.
- Never invent a price, stock level or dimension. A number either comes from a page you read, a datasheet,
  the CAD, or it is marked as an estimate with where the estimate came from.
- Spending money (ordering parts, paid quotes) waits for the user's explicit OK.

## Stage 0: request

1. Choose a short slug (`desk-lamp`). Run `npm run anatomy -- new <slug> "<the user's words>"`.
2. Fill `request.json`: `product`, `units` (default 1), `region` (default US), `budgetUsd` if they gave one,
   `mustHave`, `niceToHave`, and `constraints` as fields, not prose (power source, max size, tools available).
3. Ask the user only about forks that change the design (how many units, mains or USB power). Otherwise pick a
   sensible default and say which.

## Stage 1: design

Design the simplest thing that already exists and works. Base it on a known open design and name it in
`design.md`; this is where a reference for scoring comes from.

1. **Figure (Anatomy skill).** Use the `anatomy` skill in `.claude/skills/anatomy/` at Figure size to draw the
   real product exploded at true dimensions, in `products/<slug>/figure/`. Every part in the drawing must be
   a part someone can buy or make. Its grouped parts list is the first draft of the BOM. This is the slowest
   step; on reruns, skip it unless the parts changed, and if the user wants to move fast, offer to do it last.
2. **Numbers.** Write `design.json`: `summary`, `architecture` (one line per block, e.g. "USB 5V -> Pico VSYS"),
   `params` (every dimension, current and count the checks will need, in mm, mA, counts), and `assembly` (the
   ordered build steps). Write `design.md` explaining the choices and naming the reference design.
3. **CAD.** For every part that gets made, write `cad/parts/<slug>_<part>.py` with `make()` returning a build123d
   Part, reading its numbers from `design.json` through a shared `cad/parts/_<slug>.py` (copy the pattern from
   `_macropad.py`). Run `npm run anatomy -- cad <slug>`. It prints each part's volume and size and writes SVG
   previews to `products/<slug>/previews/`. Show the user the previews.
   Needs `pip install -r cad/requirements.txt` once.

## Stage 2: BOM

Write `bom.json`: one line per part, with a stable `id`, `name`, functional `role`, `process` (buy, pcb, print,
cnc, sheet), `qtyPerUnit`, `spec` and `mpn` where there is one. Made parts need `file` (path relative to the product
folder, e.g. `../../cad/out/<slug>_case.stl`); prints need `spec.material` and `spec.volumeCm3` (from the cad
output); PCBs need `spec.widthMm`, `heightMm` and `layers`. Include fasteners, cables and feet: the small parts are
where real builds fail. Run `npm run anatomy -- validate <slug>` until it passes.

## Stage 3: engineer checks

Run `npm run anatomy -- check <slug>`. Rules live in `src/pipeline/stages/check.ts`; a rule runs only when the
design has the params it `needs`, so a new kind of product starts with no rules. **Add the rules this product
needs** (power budget, voltages, pin counts, fits and clearances, standards it falls under), each reading
numbers from `design.json` and `bom.json`, never hard-coded. When a check fails, fix the design (stage 1),
rebuild the CAD and rerun. Don't loosen a rule to make it pass unless the rule was wrong, and say so if it was.

## Stage 4: sourcing

Write `catalog.json` (same shape as `products/macropad/catalog.json`): for each bought line, at least two real
offers read from the supplier's product page (supplier, sku, url, pack size, price breaks, stock, lead days,
`source: "snapshot"`, `capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines, since
each shop adds shipping. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run
`node src/pipeline/live/digikey.ts <slug>` for live offers. Then run `npm run anatomy -- source <slug>`.

## Stage 5: quotes

Run `npm run anatomy -- quote <slug>`. It rounds up to packs, adds one shipping charge per shop and picks the
cheapest combination of shops. PCB and print prices come from the published rules in `src/pipeline/rates.json`.
Tell the user the total, whether it's within budget, and the two or three lines that drive the cost, with one
concrete way to cut each.

## Stage 6: build plan

Run `npm run anatomy -- plan <slug>` and show the top of `build-plan.md` (total, order list, failed or flagged
checks). If `reference/reference.json` exists, run `npm run anatomy -- score <slug>`. For a new product, offer to
write a reference from the known design you based it on (its roles and what it costs to build from parts), so
later runs can be scored.

## After the run

Ask what felt wrong. Things the pipeline should do better (a missing check, a stage that needed too much hand
work, a supplier that should be scripted) go in `PLAN.md`'s backlog, and changes to how stages are run go in this
file, so the next run is better than this one.
