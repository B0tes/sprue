# Swapping a part or a supplier: `/anatomy-2 swap <slug> <line> [what]`

`A` means the anatomy command named in SKILL.md. Start with `A bom <slug> <line>`: it shows the line's spec and
every offer priced for the batch, with the chosen one marked.

**Another shop for the same part** ("get the camera from Adafruit", "swap ctrl to SparkFun"):
run `A pick <slug> <line> <supplier> [sku]`. It pins the line, requotes and prints what moved. Shipping often
makes the cheapest offer the wrong one, so say what the pin costs overall, not only on that line.
`A pick <slug> <line> auto` removes the pin.

**A different part** ("a cheaper camera", "a 3 W speaker instead", "something in stock"):
1. Read the line's role and spec, and the checks that read it (`checks.json`, `rules.ts`): a swap must still
   pass them. Note what the part connects to (pins, voltage, connector, size) from `design.json`.
2. Find one to three candidates on supplier pages with WebFetch. For each, read the datasheet numbers the checks
   need. Prefer shops already in the order.
3. Show the candidates in a few lines (part, why it fits, price for the batch, shop) and recommend one. Then
   change the BOM line (keep its `id`; update `name`, `spec`, `mpn`), replace its offers in `catalog.json` with
   real ones (at least two shops when possible), update `design.json` params the part changes (current draw,
   size), and the CAD if it has to fit a new size.
4. Run `A all <slug>` and `A diff <slug>`, and report what changed in cost and checks.

Never swap in a part you haven't read a product page and datasheet for.
