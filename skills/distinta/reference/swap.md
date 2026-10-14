# Swapping a part or a supplier: `/distinta swap <slug> <line> [what]`

`A` means the distinta command named in SKILL.md. Run `A bom <slug> <line>`: once the run has a quote it shows the
line's spec and every offer priced for the batch, with the chosen one marked. Under each other offer an "if
picked" line gives what picking it does to the whole order, shipping included. During stage 1 it shows the spec
only. When there is a quote, first run `A diff <slug>`; if it says no run is recorded yet (a copied
example has no history), run `A view <slug>` once, so the swap has a before to compare with.

**Another shop for the same part** ("get the camera from Adafruit", "swap ctrl to SparkFun"), from stage 2 on:
run `A pick <slug> <line> '<supplier>' [sku]`, with the shop's name in single quotes ('Bolt Depot'). It pins the
line, requotes and prints what moved. Shipping often makes the cheapest offer the wrong one, so say what the pin
costs overall (the "if picked" line), not only on that line.
`A pick <slug> <line> auto` removes the pin. The figure doesn't change. Run `A propose <slug> source` if sourcing
was accepted already, and ask gate 2 again (`run.md`).

**A different part** ("a cheaper camera", "a 3 W speaker instead", "something in stock"):
1. Read the line's role and spec, and the checks that read it (`checks.json`, `rules.ts`): a swap must still
   pass them. Note what the part connects to (pins, voltage, connector, size) from `design.json`.
2. Find one to three candidates on supplier pages with WebFetch. For each, read the datasheet numbers the checks
   need, and its outline dimensions. Prefer shops already in the order.
3. Show the candidates in a few lines (part, why it fits, price for the batch with shipping, shop) and recommend
   one. If none is cheaper overall, or none passes the checks, change no file: list the ones you checked with
   their prices, name what really drives the line's cost (often a shop's shipping, not the part), and ask gate 2
   again. Otherwise change the BOM line (keep its `id`; update `name`, `shortName`, `spec`, `mpn`), replace its
   offers in `catalog.json` with real ones once the run has one (at least two shops when possible), update
   `design.json` params the part changes (current draw, size), and the CAD if it has to fit a new size. Update
   every `design.json` `assembly` line and `fig.step` caption in `figure.mjs` that names the old part
   ("Drive the 4 M3 x 6 screws").
4. If the part's shape or size changed, update its drawing in `figure.mjs` (it should read the new params or spec),
   so the figure shows the part that will be bought.
5. Rerun as in `edit.md` step 5 (during stage 1: `A check` and `A figure <slug> --draft`; with a quote:
   `A all <slug>` and `A diff <slug>`), and report what changed in checks and, once there is a quote, cost.
6. A new part changes the design: run `A propose <slug> design` when its size, shape or connections changed, and
   show the figure again (`products/<slug>/view.html`); otherwise `A propose <slug> source`. Then ask that
   stage's gate question (`run.md`).

Never swap in a part you haven't read a product page and datasheet for.
