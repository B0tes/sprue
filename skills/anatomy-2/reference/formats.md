# File formats

All files are JSON in `products/<slug>/` unless noted. `?` marks an optional field.

- `request.json`: `{ slug, brief, product, units, region, budgetUsd?, mustHave: [], niceToHave: [], constraints: {} }`
- `design.json`: `{ slug, summary, architecture: [string], params: { name: number | string }, assembly: [string] }`
- `bom.json`: `{ slug, units, lines: [{ id, name, role, process: "buy"|"pcb"|"print"|"cnc"|"sheet", qtyPerUnit,
  spec: {}, mpn?, alternates?, file?, notes?, pin?: { supplier, sku? } }] }`.
  `pin` is written by `anatomy pick`: the quote then buys that line from that shop even if another is cheaper.
- `catalog.json`: `{ shipping: { "<supplier>": usd }, offers: { "<bom line id>": [{ supplier, sku, mpn?, url,
  packSize?, priceBreaks: [{ qty, unitUsd }], stock: number | "in stock" | "unknown", leadDays,
  source: "snapshot", capturedAt: "YYYY-MM-DD" }] } }`. `unitUsd` is per piece, not per pack.
- `reference/reference.json` (optional, for scoring): `{ slug, source: url, units, roles: [{ role, spec, qtyPerUnit }],
  batchUsd: { low, high, basis } }`
- `rules.ts` (optional): plain TypeScript, no imports needed.

  ```ts
  export const rules = [
    {
      id: "usb-power",
      title: "Power draw fits the USB budget",
      needs: ["drawMa", "usbBudgetMa"], // design params; the rule is skipped if any is missing
      run: ({ p, bom }) => ({
        status: p.drawMa * 1.5 <= p.usbBudgetMa ? "pass" : "fail", // or "flag" for a human decision
        detail: `${p.drawMa} mA (x1.5 margin) vs ${p.usbBudgetMa} mA`,
      }),
    },
  ];
  ```
  `bom.lines` is the BOM's lines, so a rule can count parts by `role`.
- `cad/<part>.py`: build123d, `def make() -> Part`. Files starting with `_` are shared helpers, not parts.
- Written by the commands: `explorer.json` (everything `view.html` and the website show), `history/NNN.json`
  (one snapshot per run that changed something, read by `anatomy diff`), `view.html`, `checks.json`, `sourcing.json`, `quotes.json`, `build-plan.md` (Markdown), `score.json`,
  `fab/` (STL, STEP), `previews/` (SVG) and `production/`.
