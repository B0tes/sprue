# Editing a design: `/anatomy-2 edit <slug> <change>`

The user describes a change in words: "make the arm 30 mm taller", "PETG instead of PA12", "two units, not twenty",
"move the button to the front". `A` means the anatomy command named in SKILL.md.

1. Run `A status <slug>` and read `design.json`, `design.md` and `bom.json` so you know what the change touches.
2. Make the change at its source, not downstream:
   - a dimension, current or count: `design.json` `params` (the CAD and the checks both read it from there);
   - a shape the params can't express: the part's `cad/<part>.py`;
   - quantity, budget or region: `request.json`, then `bom.json` `units`;
   - material or process of a made part: that BOM line's `spec` / `process`.
   Keep `design.md` true: one sentence on what changed and why.
3. If a made part changed, run `A cad <slug>` and copy the new `volumeCm3` and `bboxMm` it prints into the BOM line.
4. Run `A all <slug>`, then `A diff <slug>`. Report in a few lines: what you changed, checks that changed status
   (a new failure comes first, with what you'd do about it), the cost before and after, and which lines moved.
5. If a check now fails, propose the smallest design change that fixes it and ask before making it, unless the user
   asked you to keep going.

Open the result in the browser with `A view <slug>` when the change is visual (CAD) or touches many lines.
