# A new idea: three stages, three gates

Read this when a new idea comes in. `A` means `${CLAUDE_SKILL_DIR}/bin/anatomy`. Run every command from the
user's current folder; products live in `products/<slug>/` there. Formats for every file:
`${CLAUDE_SKILL_DIR}/reference/formats.md`. A finished example to copy shapes from:
`${CLAUDE_SKILL_DIR}/examples/macropad/` (a 3x3 USB keypad, 1 unit); `A where` lists them all.

The user is going to buy these parts and build this thing. Every stage ends at a gate: show what it made, then
ask. `products/<slug>/state.json` records where the run is. `A state <slug>` prints it, and `A status <slug>`
shows it with the files. The commands mark a stage proposed when they finish it; only the user accepts.

| Stage | Commands | Proposed by | The user sees |
| --- | --- | --- | --- |
| 1 Design | `new`, `validate`, `cad`, `check`, `figure`, `shot` | `A figure` | `figure.html`: the product, interactive |
| 2 Source | `digikey`, `source`, `quote`, `view` | `A quote` | `view.html`: every offer and the quote |
| 3 Build | `plan`, `package`, `score` | `A plan` | the build plan, `production/` |

A later stage's commands still run before an earlier stage is accepted (they print a note saying so), but don't
start a stage until the user says yes at the gate before it, unless they asked for the whole run without stopping.

## Stage 1: Design

This is Anatomy's workflow, aimed at a product to build instead of an idea to explain. Steps 1 to 10 below are
adapted from Anatomy by Ryan (https://github.com/wheresryan22/anatomy, MIT). Run `date` at the start.

1. **Size it.** Name the size before any other work. Count the solids the figure will draw: every bought and made
   part, plus the details on them (screw heads, seams, ports).
   - **Figure**, 40-80 solids: one product, one mechanism. The default. Say the size and go.
   - **Hero**, 80-150 solids: a dense product. Say so and that it takes about 2-4 hours, then go.
   - **Epic**: a switchgear line-up, a vehicle, a plant. Don't start it. Propose a smaller first build that keeps
     the core (one panel of the line-up, one bay), say what the full build adds, and wait for the user's choice.
2. **Truth first.** Choose a short slug (`desk-lamp`) and run `A new <slug> "<the user's words>"`. Fill
   `request.json`: `product`, `units` (default 1), `region` (default US), `budgetUsd` if given, `mustHave`,
   `niceToHave`, and `constraints` as fields, not prose (power source, max size, tools available). Then collect the
   real numbers: the datasheet dimensions of every bought part, and every size, current and count the design needs.
   Design the simplest version of something that already exists and works, base it on a known open design, and
   name it in `design.md`; that design is also the answer key for scoring later. Write `design.json`: `summary`,
   `architecture` (one line per block, e.g. "USB 5V -> Pico VSYS"), `params` (every number the CAD, the figure and
   the checks read, in mm, mA and counts) and `assembly` (ordered build steps).
3. **Say what it is.** The product itself is the object; there is no metaphor to find. Write one sentence in
   `design.md` on what it does and how it goes together: "Nine switches clip into the printed plate, the PCB presses
   onto their pins from below, and four screws close the plate onto the tray."
4. **Parts list.** Write `bom.json`: one line per part, with a stable `id`, `name`, functional `role`, `process`
   (buy, pcb, print, cnc, sheet), `qtyPerUnit`, `spec` with its real dimensions, and `mpn` where there is one. No
   offers yet. Made parts need `file`, relative to the product folder (`fab/case.stl`); prints need
   `spec.material` and `spec.volumeCm3` (from the CAD output); PCBs need `spec.widthMm`, `heightMm` and `layers`.
   Include fasteners, cables and feet: the small parts are where real builds fail. Run `A validate <slug>` until it
   passes.
5. **Plan the world.** Millimetres, x and y on the floor, z up, the origin at a datum you can name (the PCB centre,
   the floor under the cabinet). Choose the camera. `figure.md` has the details.
6. **Build the geometry.** For every made part, write `cad/<part>.py` with `make()` returning a build123d Part,
   reading its numbers from `../design.json` through a shared `cad/_params.py` (copy the pattern from the example).
   Run `A cad <slug>`: it writes STL and STEP to `fab/` and SVG previews to `previews/`, and prints each part's
   volume and size; copy those into the BOM. Then write `figure.mjs`, the whole product drawn with the kit, reading
   the same `design.json` params, so an edit moves both. Follow `${CLAUDE_SKILL_DIR}/reference/figure.md`.
7. **Paint back to front.** In `figure.mjs`, call order is paint order: the base first, far before near.
8. **Frame it** and 9. **make it live**: `A figure <slug>` does both. It writes `figure.html` with the card, a parts
   legend, hover, take apart and the assembly steps, and prints which BOM lines are drawn.
10. **Verify like a critic.** Run `A check <slug>` (below), read the coverage table `A figure` prints, then `A shot`
    the rest pose, the apart pose, every step and 4x zooms (`figure.md`, "Verify"). Read every PNG, fix, repeat.

**Open early.** As soon as a first pass draws every part, run `A figure <slug>`, then `open products/<slug>/figure.html`
(`xdg-open` on Linux) and print its full path, so the user sees the product while you deepen the detail. They
reload the page after each `A figure`.

**Engineer checks.** `A check <slug>` runs the built-in rules (they cover the keypad). For anything else, write the
rules this product needs in `products/<slug>/rules.ts` as `export const rules = [{ id, title, needs, run }]`, where
`needs` lists the design params a rule reads and `run({ p, bom })` returns `{ status: "pass" | "fail" | "flag",
detail }` (see `formats.md`). Cover the power budget, voltages, pin counts, mechanical fits and clearances, and the
standards it falls under. Read numbers from `design.json` and `bom.json`, never hard-code them. When a check fails,
fix the design, rebuild the CAD and the figure and rerun. Don't loosen a rule to make it pass unless the rule was
wrong, and say so if it was.

**Gate 1.** `A figure` has marked the design proposed. Show, in a few lines: the page's path and `file://` link,
the one sentence from step 3, the size and part count, failed or flagged checks, and any number that is still an
estimate. No price yet: that is stage 2. Then ask with the AskUserQuestion tool when it is available, else in one
line:

- **Accept and source it**: run `A accept <slug>`, then stage 2.
- **Edit something**: follow `edit.md` (it ends with `A propose <slug> design`), reopen the page and ask again.
- **Decline**: run `A decline <slug> <why>`, then ask what to change, or stop.

## Stage 2: Source

1. Write `catalog.json` (same shape as the example's): for each bought line, at least two real offers read from
   the supplier's product page (supplier, sku, url, packSize, priceBreaks, stock, leadDays, `source: "snapshot"`,
   `capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines, because each shop adds
   shipping. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run `A digikey <slug>` for live offers.
2. Run `A source <slug>`, then `A quote <slug>`. The quote rounds up to packs, adds one shipping charge per shop and
   picks the cheapest mix of shops. PCB and print prices come from published pricing rules in `pipeline/rates.json`
   in the skill folder.
3. Run `A view <slug>` and open `products/<slug>/view.html`: the BOM with every offer and the quote.

**Gate 2.** `A quote` has marked sourcing proposed. Show: the total and whether it fits the budget, the two or
three lines that drive the cost, and any line with one offer, unknown stock or an estimated price. Then ask:

- **Accept and plan the build**: run `A accept <slug>`, then stage 3.
- **Swap a part**: follow `swap.md`.
- **Change a supplier**: run `A suppliers <slug>`, then `A pick <slug> <line> <supplier>` (`swap.md`).
- **Edit the design**: follow `edit.md`. `A propose <slug> design` sends the run back to gate 1: show the figure
  again, and once the user accepts it, requote and ask gate 2 again.

After a swap or a new supplier, ask again. Declining works as in gate 1.

## Stage 3: Build

1. Run `A plan <slug>`: it writes `build-plan.md`. Its assembly steps come from `design.json` `assembly`, so check
   first that they match the figure's steps (`figure.json` `steps`) in order and words; `assembly` may add steps
   that place no part, such as flashing the firmware and testing.
2. Run `A package <slug>`. That writes `products/<slug>/production/` with the build plan, `order-list.csv` and every
   fab file (STL, STEP, Gerbers when present). If `reference/reference.json` exists, run `A score <slug>`.
3. Run `A view <slug>` so the user can click through the whole run.

**Gate 3.** `A plan` has marked the build proposed. End with one short summary: what was designed, the total
against the budget, any failed or flagged checks, what's in `production/` and what's still missing (for example a
PCB with no Gerbers yet), and the one change that would cut cost or risk the most. Nothing gets ordered. Ask
whether to accept the build (`A accept <slug>`, which marks the run done) or change something, then ask what felt
wrong: that is how the pipeline gets better.

## After a change

`A all <slug>` reruns the code stages in order (the figure when `figure.mjs` exists, the checks, sourcing, the
quote, the plan, the score), refreshes `explorer.json` and the figure page, and records a history entry; `A diff
<slug>` then says what moved. It doesn't rebuild the CAD (run `A cad` first) and never changes an accepted status.
`A accept`, `A decline` and `A propose` also refresh the figure page, so its stage line stays true.
