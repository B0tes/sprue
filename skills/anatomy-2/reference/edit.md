# Editing a design: `/anatomy-2 edit <slug> <change>`

The user describes a change in words: "make the arm 30 mm taller", "PETG instead of PA12", "two units, not twenty",
"move the button to the front". It also comes in as "Edit something" at a gate. `A` means the anatomy command
named in SKILL.md.

1. Run `A diff <slug>`. If it says only 0 runs are recorded (a copied example has no history yet), run
   `A view <slug>` once, so the edit has a before to compare with.
2. Run `A state <slug>` and `A status <slug>`, and read `design.json`, `design.md`, `bom.json` and `figure.mjs` so
   you know what the change touches.
3. Make the change at its source, not downstream:
   - a dimension, current or count: `design.json` `params` (the CAD, the figure and the checks all read it there);
   - a shape the params can't express: the part's `cad/<part>.py`, and its drawing in `figure.mjs`;
   - a part added or removed: its `bom.json` line and its `fig.part` call (or `fig.hidden`), together;
   - quantity, budget or region: `request.json`, then `bom.json` `units`;
   - material or process of a made part: that BOM line's `spec` / `process`.
   Keep `design.md` true: one sentence on what changed and why.
4. If a made part changed, run `A cad <slug>` and copy the new `volumeCm3` and `bboxMm` it prints into the BOM line.
5. Run `A all <slug>` (it rebuilds the figure too), then `A diff <slug>`. The figure's coverage must still pass.
6. Reopen the earliest stage the change touched: `A propose <slug> design` for the design, the BOM, the CAD or the
   figure (that also reopens a later stage that was accepted); `A propose <slug> source` for quantity, region,
   budget or an offer.
7. Report in a few lines: what you changed, checks that changed status (a new failure comes first, with what you'd
   do about it), the cost before and after (once there is a quote), and which lines moved. When the change is
   visual, reopen `products/<slug>/figure.html` (or ask the user to reload it) and print its path.
8. If a check now fails, propose the smallest design change that fixes it and ask before making it, unless the user
   asked you to keep going. Then ask the reopened stage's gate question again (`run.md`).

Open the BOM and offers in the browser with `A view <slug>` when the change touches many lines.
