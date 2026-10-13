# File formats

All files are JSON in `products/<slug>/` unless noted. `?` marks an optional field.

- `request.json`: `{ slug, brief, product, units, region, budgetUsd?, mustHave: [], niceToHave: [], constraints: {} }`
- `design.json`: `{ slug, summary, architecture: [string], params: { name: number | string }, assembly: [string],
  estimates?: [string] }`. `estimates` lists, one sentence each, every number that isn't from a datasheet, a page
  or the CAD yet and where it came from ("bootselFromUsbEndMm, ledFromUsbEndMm: read off the Pico's board photo,
  not in its datasheet"); the figure page and gate 1 show them before the design is accepted.
- `bom.json`: `{ slug, units, lines: [{ id, name, shortName?, role, process: "buy"|"pcb"|"print"|"cnc"|"sheet",
  qtyPerUnit, spec: {}, mpn?, alternates?, file?, notes?, pin?: { supplier, sku? } }] }`.
  `shortName` is what the figure's readout calls the part ("Hot-swap socket"); the legend keeps `name`.
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
  `bom.lines` is the BOM's lines, so a rule can count parts by `role`. The built-in rules (their ids are in
  `checks.json`: `bom-roles`, `key-count`, `gpio`, `usb-power`, `mx-plate`, `keys-on-pcb`, `controller-zone`,
  `usb-reach`, `lid-headroom`, `socket-headroom`, `screw-engagement`, `insert-depth`, `holes-clear-keys`,
  `feet-clear-heads`, `standards`) are the keypad's, and each skips itself when its params are missing. A rule here
  with a built-in's `id` replaces it; `{ id: "keys-on-pcb", off: true }` drops one that doesn't fit this product
  (say why in `design.md`). Two rules here with the same id fail as `rules:<id>`.
- `cad/<part>.py`: build123d, `def make() -> Part`. Files starting with `_` are shared helpers, not parts.
- `figure.mjs`: the product drawn with the kit, read by `anatomy figure`. `reference/figure.md` has the whole API.

  ```js
  export default function draw({ k, G, T, fig, params, bom, design }) {
    fig.size(640, 520);                                   // optional, before the camera
    const P = fig.camera(points, { azimuth: 38 });        // points: rest and apart poses, in mm
    fig.under(svg);                                       // not a part: a halo, a bench mat
    fig.part("pcb", svg, { step: 1, lift: [0, 0, 12], count: 1 }); // instances of a bom.json line
    fig.xray("sock", svg, { by: ["pcb"] });               // dashed outline of a hidden part, shown when lit
    fig.hidden("fw", "firmware, nothing to draw");        // a line that is not drawn
    fig.step(1, "Lay the PCB face up");                   // the caption for a step
    fig.over(svg);                                        // not a part, drawn last
    return { title: "3x3 macro keypad", hint, caption };  // hint and caption are optional
  }
  ```
- Written by `anatomy figure` (and by `anatomy figure --draft`, which only leaves the design unproposed):
  `figure.svg` (the bare `<svg>`), `figure.html` (the standalone page) and
  `figure.json`: `{ width, height, title, hint, caption, steps: [{ n, text, lines: [id] }],
  parts: [{ line, step, count, dx, dy }], coverage: { "<line id>": { drawn, needed } },
  hidden: { "<line id>": why } }`. `dx, dy` is the screen offset of the part's `lift`; `needed` is the line's
  `qtyPerUnit`.
- `state.json`: the gates. `{ stage: "design"|"source"|"build"|"done", stages: { design: { status, at, note? },
  source: {...}, build: {...} } }`, where `status` is `"drafting"|"proposed"|"accepted"|"declined"` and `at` an
  ISO time. `stage` is the first stage not accepted. Written by `new`, `figure` (design proposed, unless
  `--draft`), `quote` (source proposed) and `plan` (build proposed), each only while its stage has no status or is
  drafting and every stage before it is accepted; and by `accept` (which starts the next stage drafting), `decline` and
  `propose`. `propose` and `decline` send every later stage that has a status back to `drafting`, with a note
  ("reopened: design changed"), because what it showed was built on the old one. A stage after the current one
  reads as not started, whatever the file says. Never write it by hand. It is not part of the cost history, so
  `anatomy diff` never shows it; `explorer.json` may carry a copy as `state`.
- `shots/<name>.png`: screenshots of `figure.html` written by `anatomy shot`, for checking the figure.
- Written by the commands: `explorer.json` (everything `view.html` and the website show), `history/NNN.json`
  (one snapshot per run that changed something, read by `anatomy diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `fab/` (STL, STEP), `previews/` (SVG) and `production/`.
