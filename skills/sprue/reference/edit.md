# Editing a design: `/sprue edit <slug> <change>`

The user describes a change in words: "make the arm 30 mm taller", "PETG instead of PA12", "two units, not twenty",
"move the button to the front". It also comes in as "Edit something" at a gate. `A` means the sprue command
named in SKILL.md.

1. Run `A status <slug>` (the stages and the files) and read `design.json`, `design.md`, `bom.json` and
   `figure.mjs`, so you know what the change touches.
2. Only if the run has a quote (`quotes.json`): run `A diff <slug>`. If it says no run is recorded yet (a copied
   example has no history), run `A view <slug>` once, so the edit has a before to compare with. A copied example
   at gate 1 already has a quote from its earlier run: treat it as a run with a quote here and in step 5 (`A all`,
   then `A diff`). A new design in stage 1 or 2 has no cost to compare yet; skip this.
3. Make the change at its source, not downstream:
   - a dimension, current or count: `design.json` `params` (the CAD, the figure and the checks all read it there);
   - a shape the params can't express: the part's `cad/<part>.py`, and its drawing in `figure.mjs`;
   - the circuit board (its size, holes, parts, routes, pour or labels): `cad/pcb.mjs` and the params it reads;
   - a part added or removed: its `bom.json` line and its `fig.part` call (or `fig.hidden`), together;
   - quantity, budget or region: `request.json`, then `bom.json` `units`;
   - material or process of a made part: that BOM line's `spec` / `process`;
   - how the parts are put together in the whole-product check (a part placed wrong, a risk the user accepts with
     their reason): `cad/_system.py`.
   Keep `design.md` true: one sentence on what changed and why.
4. If a made part changed, run `A cad <slug>` and copy the new `volumeCm3` and `bboxMm` it prints into the BOM line.
   If the board changed (`cad/pcb.mjs`, a param it reads, or a footprint in the PCB kit), run `A pcb <slug>` (`A cad`
   does it too), read its errors, look at `previews/pcb-top.svg` and `pcb-bottom.svg` again, and keep the BOM line's
   `spec` (`widthMm`, `heightMm`, `holeMm`) true to it. `A pcb` removes the board's earlier `verify.json` and
   `pcb/order/`, so run `A verify <slug>` again and report it as "Proving a board" in `run.md` says. `A all` does
   not rebuild the board, and `A score` fails an audit that is older than the board code, the params or the kit.
5. Rerun what the current stage has. With no quote yet: `A validate <slug>`, `A check <slug>` and
   `A figure <slug> --draft`, and from stage 2 on `A inspect <slug>` too. Once there is a quote: `A all <slug>` (it
   rebuilds the figure and inspects the whole product too), then `A diff <slug>`. Either way the figure's coverage
   must still pass.
6. Reopen the earliest stage the change touched (each also reopens every later stage that has a status):
   - `A propose <slug> design` for a change to the parts list (a line added, removed or swapped for another part),
     the figure, a part on its own (a param a part check or the figure reads, a material or process), or the board;
   - `A propose <slug> inspect` for a change that only reshapes CAD within the design (a hole widened, a notch cut,
     a boss moved) and leaves the parts list and the figure as they were, or for `cad/_system.py`. While the run is
     at Inspect, propose nothing: run `A inspect <slug>`, which proposes it once it passes, and name the change in
     the gate 2 report;
   - `A propose <slug> source` for quantity, region, budget, spares, `costNotes`, `firstArticleUnits` or an offer.
     A pick never reopens Inspect.
   When in doubt between design and inspect, reopen design.
7. Report in a few lines: what you changed, checks that changed status (a new failure comes first, with what you'd
   do about it), the cost before and after and which lines moved (once there is a quote). When the change is
   visual, reopen `products/<slug>/view.html` (or ask the user to reload it) and print its path.
8. If a check now fails, propose the smallest design change that fixes it and ask before making it, unless the user
   asked you to keep going. Then ask the reopened stage's gate question again (`run.md`).

Once there are offers, run `A view <slug>` and reopen `products/<slug>/view.html` when the change touches many
lines: its Source stage has the BOM and every offer.
