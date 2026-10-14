# A new idea: three stages, three gates

Read this when a new idea comes in. `A` means `${CLAUDE_SKILL_DIR}/bin/anatomy`. Run every command from the
user's current folder; products live in `products/<slug>/` there. Formats for every file:
`${CLAUDE_SKILL_DIR}/reference/formats.md`. A finished example to copy shapes from:
`${CLAUDE_SKILL_DIR}/examples/macropad/` (a 3x3 USB keypad, 1 unit) and `examples/ponder/` (an AI tutor desk
unit, 20 units, with spares and two orders); `A where` lists them all.

The user is going to buy these parts and build this thing. Every stage ends at a gate: show what it made, then
ask. `products/<slug>/state.json` records where the run is. `A state <slug>` prints it, and `A status <slug>`
shows it with the files. The commands mark a stage proposed when they finish it; only the user accepts.

| Stage | Commands | Proposed by | The user sees |
| --- | --- | --- | --- |
| 1 Design | `new`, `validate`, `cad`, `check`, `figure`, `shot` | `A figure` | `view.html`: the product, interactive, and the design |
| 2 Source | `digikey`, `source`, `quote`, `view` | `A quote` | `view.html` again, now with every offer and the quote |
| 3 Build | `plan`, `package`, `score` | `A plan` | `view.html` with the build plan, and `production/` |

One page shows the whole run: `products/<slug>/view.html`. `A figure` and `A view` write it, and every command that
changes what it shows (a gate, the checks, the quote, the plan) rewrites it. At the top are the three stages and
what to type at the current gate. Then the figure, then Design, then Source once there is a quote, then Build once
there is a plan.

A later stage's commands still run before an earlier stage is accepted (they print a note saying so, and never
mark their own stage proposed while an earlier one is open), but don't start a stage until the user says yes at the
gate before it, unless they asked for the whole run without stopping. "Step" in what you tell the user means an
assembly step of the product; the work below is in stages and moves.

## Stage 1: Design

This is Anatomy's workflow, aimed at a product to build instead of an idea to explain. The ten moves below are
adapted from Anatomy by Ryan (https://github.com/wheresryan22/anatomy, MIT). Run `date` at the start.

1. **Size it.** Name the size before any other work. Count the solids the figure will draw: every bought and made
   part, plus the details on them (screw heads, seams, ports).
   - **Figure**, 40-80 solids: one product, one mechanism. The default. Say the size and go.
   - **Hero**, 80-150 solids: a dense product. Say so and that it takes about 2-4 hours, then go.
   - **Epic**: a switchgear line-up, a vehicle, a plant. Don't start it. Propose a smaller first build that keeps
     the core (one panel of the line-up, one bay), say what the full build adds, and wait for the user's choice.
2. **Truth first.** Choose a short slug (`desk-lamp`) and run `A new <slug> '<the user's words>'` (single quotes;
   write an apostrophe in them as `'\''`, or use double quotes when the words have no `$`, `!` or backquote). Fill
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
   passes. Before the CAD has built a print it lists that print's `volumeCm3` as pending rather than failing:
   fill it in from `A cad` (move 6) and validate again.
5. **Plan the world.** Millimetres, x and y on the floor, z up, the origin at a datum you can name (the PCB centre,
   the floor under the cabinet). Choose the camera. `figure.md` has the details.
6. **Build the geometry.** For every made part, write `cad/<part>.py` with `make()` returning a build123d Part,
   reading its numbers from `../design.json` through a shared `cad/_params.py` (copy the pattern from the example).
   Run `A cad <slug>`: it writes STL and STEP to `fab/` and SVG previews to `previews/`, and prints each part's
   volume and size; copy those into the BOM (`volumeCm3`, `bboxMm`). Then write `figure.mjs`, the whole product
   drawn with the kit, reading
   the same `design.json` params, so an edit moves both. Follow `${CLAUDE_SKILL_DIR}/reference/figure.md`.
7. **Paint back to front.** In `figure.mjs`, call order is paint order: the base first, far before near.
8. **Frame it** and 9. **make it live**: `A figure <slug> --draft` does both while you work. It writes
   `view.html` with the card (hover, take apart and the assembly steps) and the parts list under it, and prints
   which BOM lines are drawn. `--draft` keeps the design from being proposed before it is finished.
10. **Verify like a critic.** Run `A check <slug>` (below), read the coverage table `A figure` prints, then `A shot`
    the rest pose, the apart pose, every step and 4x zooms (`figure.md`, "Verify"). Read every PNG, fix, repeat.

**Open early.** As soon as a first pass draws every part, run `A figure <slug> --draft`, then open the page with
its relative path: `open products/<slug>/view.html` on macOS, `xdg-open products/<slug>/view.html` on Linux.
If neither works (a remote or headless shell), say so and give the full path and `file://` link `A figure`
printed for the user to open in a browser. Print them either way, so the user sees the product while you deepen
the detail; they reload the page after each `A figure`.

**Engineer checks.** `A check <slug>` runs the built-in rules (they cover the keypad). For anything else, write the
rules this product needs in `products/<slug>/rules.ts` as `export const rules = [{ id, title, needs, run }]`, where
`needs` lists the design params a rule reads and `run({ p, bom })` returns `{ status: "pass" | "fail" | "flag",
detail }` (see `formats.md`). Cover the power budget, voltages, pin counts, mechanical fits and clearances, and the
standards it falls under. Read numbers from `design.json` and `bom.json`, never hard-code them. When a check fails,
fix the design, rebuild the CAD and the figure and rerun. Don't loosen a rule to make it pass unless the rule was
wrong, and say so if it was.

**Gate 1.** When the figure, the checks and the shots are done, run `A figure <slug>` without `--draft`: it
marks the design proposed (if the design was declined or edited after a proposal, run `A propose <slug> design`
instead). While the design is open the page shows a "Before you accept" list. Show, in a few lines: the page's path and `file://`
link, the one sentence from move 3, the size and part count, failed or flagged checks, and any number that is
still an estimate (`design.json` `estimates`). No price yet: that is stage 2. Then ask with the AskUserQuestion
tool when it is available, else in one line:

- **Accept and source it**: run `A accept <slug>`, then stage 2.
- **Edit something**: follow `edit.md` (it ends with `A propose <slug> design`), reopen the page and ask again.
- **Decline**: run `A decline <slug> '<why>'`, then ask what to change, or stop.

## Stage 2: Source

1. Write `catalog.json` (same shape as the example's): for each bought line, at least two real offers read from
   the supplier's product page with WebFetch (supplier, sku, url, packSize, priceBreaks, stock, leadDays,
   `source: "snapshot"`, `capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines,
   because each shop adds shipping. If `catalog.json` is there already (a copied example, or a design that came
   back from gate 2), keep it: add offers for any new line, and refetch the ones older than a month or that the
   user doubts. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run `A digikey <slug>` for live
   offers. `formats.md` has the rules for each field: break quantities and stock in pieces, an order multiple as
   `packSize`, a backorder date as unknown stock with a longer lead.
   - **Shipping.** Read each shop's shipping page. When it gives a flat rate for this order, use it and list the
     shop in `shippingRead`. Most shops show the rate only at checkout. Then estimate it from a carrier's
     published table (for the US, USPS Ground Advantage retail by weight and zone), and write in `shippingBasis`
     the table, its date, the weight you guessed and why. The quote and the page mark every shop not in
     `shippingRead` as an estimate.
   - **Made at home.** When the request says the user has a 3D printer that fits the part, pin each print line to
     it (`"pin": { "supplier": "home" }` in `bom.json`) and add `filament` to `catalog.json`: the price per kg
     from a spool's product page and the density from the material's datasheet, with their URLs. The quote then
     prices the filament only, with no shipping.
   - For a batch, add `spares` to the BOM lines that get lost or broken in a build (small parts, printed parts).
   - Write in `design.json` `costNotes` the costs the quote leaves out: duty, a shop's small-order fee or minimum
     order, consumables.
2. Run `A source <slug>`, then `A quote <slug>`. Sourcing drops an offer whose stock is below what the batch needs
   and says so. The quote rounds up to whole packs (it prints the packs to order), buys up to a higher price break
   when that costs less, adds one shipping charge per shop and picks the cheapest mix of shops. PCB and print
   prices come from published pricing rules in `${CLAUDE_SKILL_DIR}/pipeline/rates.json`; a print rate that lists
   `materials` only quotes those. For more than a few units, suggest building a few first: set
   `firstArticleUnits` in `design.json` params, and the quote also prices order A (those units) and order B (the
   rest and the spares), and what two orders cost over one. Spares, `costNotes` and `firstArticleUnits` change
   the order, not the design, so they don't reopen gate 1.
3. Run `A view <slug>` and reopen `products/<slug>/view.html` (or ask the user to reload it). Under the design it
   now shows Source: the BOM with every offer, the shops and the quote.

**Gate 2.** `A quote` has marked sourcing proposed. Show: the total and whether it fits the budget, the costs left
out of it (`costNotes`), the two or three lines that drive the cost (shipping counts), and any line with one offer,
unknown stock, offers dropped for short stock or an estimated price or shipping. With orders A and B, show both and
the extra cost. Then ask:

- **Accept and plan the build**: run `A accept <slug>`, then stage 3.
- **Swap a part**: follow `swap.md`.
- **Change a supplier**: run `A suppliers <slug>`, then `A pick <slug> <line> '<supplier>'` (`swap.md`). Quote
  the shop's name: many have a space in it ('Bolt Depot').
- **Edit the design**: follow `edit.md`. `A propose <slug> design` sends the run back to gate 1: show the figure
  again, and once the user accepts it, requote and ask gate 2 again.

After a swap or a new supplier, ask again. Declining works as in gate 1.

## Stage 3: Build

1. Run `A plan <slug>`: it writes `build-plan.md`. Its assembly steps come from `design.json` `assembly`, and a
   table after them lists the figure's steps (`figure.json` `steps`) with the parts each one places, so check
   first that the two agree in order and words; `assembly` may add steps that place no part, such as flashing the
   firmware and testing.
2. A copied example ships without `fab/`: run `A cad <slug>` first (it needs build123d), or `production/` gets no
   STL or STEP and `A score` reads "not yet". Then run `A package <slug>`. That writes `products/<slug>/production/` with the build plan, `order-list.csv` and every
   fab file (STL, STEP, Gerbers when present). The order list gives each line's pieces needed and bought, and the
   packs to put in the cart. With `firstArticleUnits` it also writes `order-a.csv` and `order-b.csv`, and the plan
   has a section for the two orders. If `reference/reference.json` exists, run `A score <slug>`.
3. Run `A view <slug>`. The page now shows Build: the steps (choosing one shows it in the figure), the order list
   and the files. The user can click through the whole run on it.

**Gate 3.** `A plan` has marked the build proposed. End with one short summary: what was designed, the total
against the budget, the costs left out of it (`costNotes`), orders A and B if there are two, any failed or
flagged checks, what's in `production/` and what's still missing (for example a PCB with no Gerbers yet), and the
one change that would cut cost or risk the most. Nothing gets ordered. Ask
whether to accept the build (`A accept <slug>`, which marks the run done) or change something, then ask what felt
wrong: that is how the pipeline gets better.

## After a change

Rerun what the current stage has, not more:

- **In stage 1** (no offers yet): `A cad <slug>` if a made part changed, then `A validate`, `A check` and
  `A figure <slug> --draft`. There is no quote, so there is nothing for `A diff` to show yet.
- **From stage 2 on**: `A all <slug>` reruns the code stages in order (the figure when `figure.mjs` exists, the
  checks, sourcing, the quote, the plan, the score), refreshes `explorer.json` and the page, and records a
  history entry; `A diff <slug>` then says what moved. It skips sourcing and the plan while there is no
  `catalog.json`, doesn't rebuild the CAD (run `A cad` first), and proposes nothing past a stage that isn't
  accepted. While the quote is still open it writes `build-plan.md` ahead of its gate, so the page shows a Build
  section marked as made ahead: stage 3 makes it again once the quote is accepted.

Then reopen the earliest stage the change touched with `A propose <slug> <stage>`: that sends every later stage
back to drafting. `A accept`, `A decline` and `A propose` also rewrite the page, so its stages and what it says
to type stay true.
