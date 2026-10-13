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
- `figure.mjs`: the product drawn with the kit, read by `anatomy figure`. `reference/figure.md` has the whole API.

  ```js
  export default function draw({ k, G, T, fig, params, bom, design }) {
    fig.size(640, 520);                                   // optional, before the camera
    const P = fig.camera(points, { azimuth: 38 });        // points: rest and apart poses, in mm
    fig.under(svg);                                       // not a part: a halo, a bench mat
    fig.part("pcb", svg, { step: 1, lift: [0, 0, 12], count: 1 }); // instances of a bom.json line
    fig.hidden("fw", "firmware, nothing to draw");        // a line that is not drawn
    fig.step(1, "Lay the PCB face up");                   // the caption for a step
    fig.over(svg);                                        // not a part, drawn last
    return { title: "3x3 macro keypad", hint, caption };  // hint and caption are optional
  }
  ```
- Written by `anatomy figure`: `figure.svg` (the bare `<svg>`), `figure.html` (the standalone page) and
  `figure.json`: `{ width, height, title, hint, caption, steps: [{ n, text, lines: [id] }],
  parts: [{ line, step, count, dx, dy }], coverage: { "<line id>": { drawn, needed } },
  hidden: { "<line id>": why } }`. `dx, dy` is the screen offset of the part's `lift`; `needed` is the line's
  `qtyPerUnit`.
- `state.json`: the gates. `{ stage: "design"|"source"|"build"|"done", stages: { design: { status, at, note? },
  source: {...}, build: {...} } }`, where `status` is `"drafting"|"proposed"|"accepted"|"declined"` and `at` an
  ISO time. `stage` is the first stage not accepted. Written by `new`, `figure` (design proposed), `quote` (source
  proposed), `plan` (build proposed), `accept`, `decline` and `propose`; never by hand. It is not part of the cost
  history, so `anatomy diff` never shows it; `explorer.json` may carry a copy as `state`.
- `shots/<name>.png`: screenshots of `figure.html` written by `anatomy shot`, for checking the figure.
- Written by the commands: `explorer.json` (everything `view.html` and the website show), `history/NNN.json`
  (one snapshot per run that changed something, read by `anatomy diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `fab/` (STL, STEP), `previews/` (SVG) and `production/`.
