---
name: anatomy-2
description: Take a one-sentence hardware idea all the way from request to a production package (design, CAD, BOM, engineer checks, real supplier offers, quotes, build plan, fab files). Use when someone types /anatomy-2 <idea>, asks to design, source, quote or plan a physical product, or wants to iterate on an earlier run.
argument-hint: <hardware idea> [--step]
allowed-tools: Bash(anatomy *), Bash(plugin/bin/anatomy *), Bash(python3 -m pip install build123d*)
license: MIT
---

# Anatomy 2.0: from an idea to a production package

Request: $ARGUMENTS

You turn a short request ("a 3x3 USB macro keypad for my desk") into a product folder someone could order
parts from and build. Every stage writes files in `products/<slug>/` under the current folder. Stages 0 to 2 are
your judgement; stages 3 to 6 and the package are code you run with the `anatomy` command.

## Before you start

- **The command.** `anatomy` is on PATH while this plugin is installed. Inside the anatomy-2 repo itself, use
  `plugin/bin/anatomy`. Run `anatomy where` once: it prints where the pipeline code and the worked example are.
- **The worked example.** `<pipeline>/examples/macropad/` is a finished run of a 3x3 keypad. Before writing each
  stage, open the matching file there and follow its shape. `<pipeline>/pipeline/types.ts` is the exact shape of
  every file.
- **Tools.** Node 22.6+ and Python 3 with build123d (`python3 -m pip install build123d`, once). If build123d is
  missing, install it before stage 1.
- **Resume.** If the request names an existing slug, or `products/` already has a matching folder, run
  `anatomy status <slug>` and pick up at the first missing stage (or the one the user names) instead of starting
  over.

## How to run

**Default: run straight through.** Go from stage 0 to the package without stopping. After each stage, print a
short line or two with what it produced (the command output is usually enough). Stop and ask only when:
- the request forks in a way that changes the product (one unit or fifty, USB or mains power); otherwise pick a
  sensible default, say which, and keep going;
- an engineer check fails and you can't fix it by changing the design;
- going on would spend money (ordering parts, paid quotes): that always waits for the user's explicit OK.

**With `--step` in the request**, pause after every stage: show what it produced and ask whether to continue,
change something, or redo it.

When the user changes something later, edit the input file, rerun that stage and every later one
(`anatomy all <slug>` reruns 3 to 6), and say what moved: checks, cost, files.

Never invent a price, stock level or dimension. A number comes from a page you read, a datasheet or the CAD, or it
is marked as an estimate with where the estimate came from.

## Stage 0: request

Choose a short slug (`desk-lamp`) and run `anatomy new <slug> "<the user's words>"`. Fill `request.json`:
`product`, `units` (default 1), `region` (default US), `budgetUsd` if given, `mustHave`, `niceToHave`, and
`constraints` as fields, not prose (power source, max size, tools available).

## Stage 1: design

Design the simplest version of something that already exists and works. Base it on a known open design and
name it in `design.md`; that design is also the answer key for scoring later.

1. **Numbers.** Write `design.json`: `summary`, `architecture` (one line per block, e.g. "USB 5V -> Pico VSYS"),
   `params` (every dimension, current and count the checks will need, in mm, mA, counts) and `assembly` (ordered
   build steps). Write `design.md` explaining the choices and naming the reference design.
2. **CAD.** For every part that gets made, write `products/<slug>/cad/<part>.py` with `make()` returning a
   build123d Part, reading its numbers from `../design.json` through a shared `cad/_params.py` (copy the pattern
   from the example). Run `anatomy cad <slug>`: it writes STL and STEP to `fab/`, SVG previews to `previews/`, and
   prints each part's volume and size for the BOM.
3. **Figure (optional, slow).** If the user asks for a picture, or with `--step`, use the `anatomy` skill
   (https://skills.wheresryan.sh/anatomy; if it isn't installed, say so and skip the figure) at Figure size to draw the real product exploded at true dimensions in `products/<slug>/figure/`. Every
   part in the drawing must be one someone can buy or make. Otherwise offer it at the end.

## Stage 2: BOM

Write `bom.json`: one line per part, with a stable `id`, `name`, functional `role`, `process` (buy, pcb, print,
cnc, sheet), `qtyPerUnit`, `spec` and `mpn` where there is one. Made parts need `file`, relative to the product
folder (`fab/case.stl`); prints need `spec.material` and `spec.volumeCm3` (from the cad output); PCBs need
`spec.widthMm`, `heightMm` and `layers`. Include fasteners, cables and feet: the small parts are where real builds
fail. Run `anatomy validate <slug>` until it passes.

## Stage 3: engineer checks

Run `anatomy check <slug>`. The built-in rules cover the keypad. For anything else, write the rules this product
needs in `products/<slug>/rules.ts` as `export const rules = [{ id, title, needs, run }]`, where `needs` lists the
design params a rule reads and `run({ p, bom })` returns `{ status: "pass" | "fail" | "flag", detail }` (copy the
style of `<pipeline>/pipeline/stages/check.ts`). Cover the power budget, voltages, pin counts, mechanical fits and
clearances, and the standards it falls under. Read numbers from `design.json` and `bom.json`, never hard-code them.
When a check fails, fix the design, rebuild the CAD and rerun. Don't loosen a rule to make it pass unless the
rule was wrong, and say so if it was.

## Stage 4: sourcing

Write `catalog.json` (same shape as the example's): for each bought line, at least two real offers read from the
supplier's product page (supplier, sku, url, packSize, priceBreaks, stock, leadDays, `source: "snapshot"`,
`capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines, because each shop adds
shipping. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run `anatomy digikey <slug>` for live
offers. Then run `anatomy source <slug>`.

## Stage 5: quotes

Run `anatomy quote <slug>`. It rounds up to packs, adds one shipping charge per shop and picks the cheapest mix of
shops. PCB and print prices come from published pricing rules in the pipeline's `rates.json`. Note the total,
whether it fits the budget, and the two or three lines that drive the cost.

## Stage 6: build plan and package

Run `anatomy plan <slug>`, then `anatomy package <slug>`. That writes `products/<slug>/production/` with the build
plan, `order-list.csv` and every fab file (STL, STEP, Gerbers when present). If `reference/reference.json` exists,
run `anatomy score <slug>`.

## Finish

End with one short summary: what was designed, the total cost against the budget, any failed or flagged checks,
what's in `production/` and what's still missing (for example a PCB with no Gerbers yet), and the one change that
would cut cost or risk the most. Nothing gets ordered. Then ask what felt wrong: what the user tells you is how
the pipeline gets better.
