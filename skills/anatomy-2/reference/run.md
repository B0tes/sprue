# Full run: stages 0 to 6

Read this when running a new idea end to end. `A` below means `${CLAUDE_SKILL_DIR}/bin/anatomy`.
Run every command from the user's current folder; products live in `products/<slug>/` there.
Formats for every file: `${CLAUDE_SKILL_DIR}/reference/formats.md`. Finished examples to copy shapes from:
`${CLAUDE_SKILL_DIR}/examples/macropad/` (a 3x3 USB keypad, 1 unit) and `${CLAUDE_SKILL_DIR}/examples/ponder/`
(a camera-and-speaker desk tutor for kids, 20 units).

## Stage 0: request

Choose a short slug (`desk-lamp`) and run `A new <slug> "<the user's words>"`. Fill `request.json`:
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
   from the example). Run `A cad <slug>`: it writes STL and STEP to `fab/`, SVG previews to `previews/`, and
   prints each part's volume and size for the BOM.
3. **Figure (optional, slow).** If the user asks for a picture, or with `--step`, use the `anatomy` skill
   (https://skills.wheresryan.sh/anatomy; if it isn't installed, say so and skip the figure) at Figure size to
   draw the real product exploded at true dimensions in `products/<slug>/figure/`. Every part in the drawing must
   be one someone can buy or make. Otherwise offer it at the end.

## Stage 2: BOM

Write `bom.json`: one line per part, with a stable `id`, `name`, functional `role`, `process` (buy, pcb, print,
cnc, sheet), `qtyPerUnit`, `spec` and `mpn` where there is one. Made parts need `file`, relative to the product
folder (`fab/case.stl`); prints need `spec.material` and `spec.volumeCm3` (from the cad output); PCBs need
`spec.widthMm`, `heightMm` and `layers`. Include fasteners, cables and feet: the small parts are where real builds
fail. Run `A validate <slug>` until it passes.

## Stage 3: engineer checks

Run `A check <slug>`. The built-in rules cover the keypad. For anything else, write the rules this product
needs in `products/<slug>/rules.ts` as `export const rules = [{ id, title, needs, run }]`, where `needs` lists the
design params a rule reads and `run({ p, bom })` returns `{ status: "pass" | "fail" | "flag", detail }` (see `formats.md`). Cover the power budget,
voltages, pin counts, mechanical fits and clearances, and the standards it falls under. Read numbers from `design.json` and `bom.json`, never hard-code them.
When a check fails, fix the design, rebuild the CAD and rerun. Don't loosen a rule to make it pass unless the
rule was wrong, and say so if it was.

## Stage 4: sourcing

Write `catalog.json` (same shape as the example's): for each bought line, at least two real offers read from the
supplier's product page (supplier, sku, url, packSize, priceBreaks, stock, leadDays, `source: "snapshot"`,
`capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines, because each shop adds
shipping. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run `A digikey <slug>` for live
offers. Then run `A source <slug>`.

## Stage 5: quotes

Run `A quote <slug>`. It rounds up to packs, adds one shipping charge per shop and picks the cheapest mix of
shops. PCB and print prices come from published pricing rules in `pipeline/rates.json` in the skill folder.
Note the total, whether it fits the budget, and the two or three lines that drive the cost.

## Stage 6: build plan and package

Run `A plan <slug>`, then `A package <slug>`. That writes `products/<slug>/production/` with the build
plan, `order-list.csv` and every fab file (STL, STEP, Gerbers when present). If `reference/reference.json` exists,
run `A score <slug>`.

## Finish

Run `A view <slug>` so the user can click through the result, then end with one short summary: what was designed,
the total against the budget, any failed or flagged checks, what's in `production/` and what's still missing (for
example a PCB with no Gerbers yet), and the one change that would cut cost or risk the most. Nothing gets ordered.
Then ask what felt wrong: that is how the pipeline gets better.
