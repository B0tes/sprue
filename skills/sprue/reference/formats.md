# File formats

All files are JSON in `products/<slug>/` unless noted. `?` marks an optional field.

- `request.json`: `{ slug, brief, product, units, region, budgetUsd?, mustHave: [], niceToHave: [], constraints: {} }`
- `design.json`: `{ slug, summary, architecture: [string], params: { name: number | string }, assembly: [string],
  estimates?: [string], costNotes?: [string] }`. `costNotes` lists costs the quote leaves out (duty, shipping no
  page gives, consumables); the build plan prints them under its total. A param `firstArticleUnits` (fewer than
  `units`) splits the order in two: order A buys parts for that many units to build and check first, order B the
  rest and the spares. `estimates` lists, one sentence each, every number that isn't from a datasheet, a page
  or the CAD yet and where it came from ("bootselFromUsbEndMm, ledFromUsbEndMm: read off the Pico's board photo,
  not in its datasheet"); `view.html` and gate 1 show them before the design is accepted.
- `bom.json`: `{ slug, units, lines: [{ id, name, shortName?, role, process: "buy"|"pcb"|"print"|"cnc"|"sheet",
  qtyPerUnit, spares?, qtyPerBatch?, spec: {}, mpn?, alternates?, file?, notes?, pin?: { supplier, sku? } }] }`.
  The batch needs `qtyPerUnit x units + spares` pieces of a line. `qtyPerBatch` is for one thing the whole batch
  shares (a wire set, a tube of glue): it replaces `qtyPerUnit x units`, and `qtyPerUnit` may then be 0.
  `shortName` is what the figure's readout calls the part ("Hot-swap socket"); the parts list keeps `name`.
  `pin` is written by `sprue pick`: the quote then buys that line from that shop even if another is cheaper.
  A print line can be pinned by hand to a print service by its name (`{ "supplier": "Craftcloud" }`), or to the
  user's own printer with `{ "supplier": "home" }` when the request says they have one. The quote then buys it
  from "Home printer": `volumeCm3 x gPerCm3` grams at `usdPerKg` from catalog.json `filament`, with no shipping.
  Without a `filament` entry for its material the line has no price.
- `catalog.json`: `{ shipping: { "<supplier>": usd }, shippingFirstArticle?: { "<supplier>": usd },
  shippingRead?: ["<supplier>"], shippingBasis?: { "<supplier>": text }, filament?: { "<material>": { usdPerKg,
  gPerCm3, url, capturedAt, densityUrl?, leadDays? } }, offers: { "<bom line id>": [{ supplier, sku, mpn?, url,
  packSize?, priceBreaks: [{ qty, unitUsd }], stock: number | "in stock" | "unknown", leadDays, source: "snapshot",
  capturedAt: "YYYY-MM-DD" }] } }`. A key starting with `_` (such as `_note`) is a comment the commands skip.
  - Shipping: `shipping` is one flat charge per shop. `shippingRead` lists the shops whose charge you read from
    their published rates. Every other charge is an estimate, and the quote, the order list and the page mark it
    so. `shippingBasis` says where each figure came from ("ESTIMATE. No rate published. Stand-in: USPS Ground
    Advantage retail, 1 lb, Zone 8, from USPS Notice 123, read 2026-10-13"). `shippingFirstArticle` is a shop's
    charge on the small order A, when it differs. Fees and minimums (a small-order fee, a minimum order) go in `design.json` `costNotes`.
  - `priceBreaks[].qty` is in pieces, not packs: a 10-pack sold from 5 packs up is `{ qty: 50 }`. `unitUsd` is
    per piece, not per pack.
  - A shop's order multiple goes in `packSize`: "multiples of 10" on a pack of 4 is `packSize: 40`.
  - A number in `stock` is pieces on hand: an offer with fewer than the batch needs is dropped, and
    `sourcing.json` notes it. A page that says "ships on <date>" (a backorder) gives `stock: "unknown"`, with
    `leadDays` counted to that date plus transit, so the quote can still use it; `stock: 0` keeps it out.
  - `leadDays` is days until the part arrives, transit included.
  - `sku` is the shop's order code, which may be followed by the product's name ("4955 Kailh Clicky White"). With
    no code on the page, use the name alone. Leave the pack size out: that is `packSize`.
  - `filament` prices prints pinned to the user's own printer (`bom.json` `pin`), read from a spool's page and the
    material's datasheet.
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
- `cad/pcb.mjs`: the circuit board as code, read by `sprue pcb` (and by `sprue cad`, after the parts). It draws
  with the PCB kit (`pipeline/pcb/`) and reads every number from `design.json` params or the kit's footprint library
  (the audit in `pcb/drc.json` counts as out of date when the file, the params or the kit change). Millimetres, the
  origin at the board centre, x right, y up, seen from the top. A part on the bottom is placed at the coordinates it
  has seen from the top (nothing is mirrored).

  ```js
  export default function board({ pcb, params, bom, design }) {
    pcb.outline(61, 94, 2);                                       // rounded rectangle, corner radius
    pcb.hole(-27, 44, 3.2, { keepout: 3.5, ref: "M3" });          // non-plated; copper and silk stay `keepout` (radius) away
    pcb.place("rpi-pico-castellated", { ref: "U1", x: 8, y: 30, side: "top", nets: { GND: "GND", GP2: "GP2" } });
    pcb.place("kailh-mx-hotswap", { ref: "K1", x: -19, y: -33, side: "bottom", nets: { A: "GP10", B: "GND" } });
    pcb.pour("GND", "F.Cu");                                      // the net's copper over the layer, clear of other nets
    pcb.pad("K1.B");                                              // a placed pad: { x, y, w, h, net, ... }
    pcb.track("GND", "B.Cu", [[0, 0], [0, 3]]);                   // copper by hand: net, layer, points, width?
    pcb.via("GND", 0, 3);                                         // plated, 0.4 / 0.8 mm, tented
    pcb.route("GP2", "U1.GP2", "K9.A", { via: true });            // a track found by the maze router
    pcb.text("F.Silk", 0, 40, "MACROPAD", 3);                     // top silkscreen, capital height in mm, at least 1.0
    pcb.keepout("B.Cu", [[0, 0], [5, 0], [5, 5]], { tracks: true, pour: true });
    pcb.single("RUN");                                            // a net with one pad on purpose (a test point)
    pcb.warn("the notes should give the key map");                // a warning for the audit's list
    return { title: "keypad PCB", pinMap: { GP2: "K9" } };       // both optional; the title names the previews
  }
  ```
  - Footprints: `kailh-mx-hotswap` (the Kailh MX hot-swap socket: pads `A` and `B` and the switch's holes; option
    `switchMm` draws the switch outline on the silkscreen) and `rpi-pico-castellated` (a Raspberry Pi Pico soldered
    flat by its castellated edge: pads `1` to `40` named by function, such as `GP2`, `GND`, `VBUS`; option
    `throughHoles: { drillMm, padMm }` adds plated holes). `nets` maps a pad's number or name to a net name; a pad
    with no net is left floating, and a net with one pad is an error unless `pcb.single` names it, because it is
    usually a typo. A part the library lacks needs a footprint added to `pipeline/pcb/footprints.ts`, with its source
    for every number; the ones that are measured, not dimensioned, belong in `estimates`.
  - Options. `place`: `rotDeg` (a multiple of 90). `route(net, from, to, { via, width, layers, topCost, viaCost,
    turnCost, softMm, window })`: both pads must be on `net`; `topCost`, `viaCost` and `turnCost` are numbers from 0 to
    1,000,000 and `window` is 0 or more (Infinity allowed), and anything else throws. `via(net, x, y, { drill, dia })`.
    `pour(net, layer, { clearance })`: one per layer, declared before the routes so the router keeps clear of its
    thermal spokes. `text(layer, x, y, string, height, { align: "left" | "center" | "right", rotDeg, width })`.
  - Rules, in `pcb.rules` (`pipeline/pcb/rules.ts`, each with its source; read-only, the audit holds the board to
    them): 0.3 mm tracks (0.25 minimum), 0.2 mm clearance, copper 0.5 mm from the board edge and 0.3 mm from a
    non-plated hole, 0.4 / 0.8 mm vias, annular ring at least 0.18 mm, drills at least 0.3 mm, holes at least 0.45 mm
    apart edge to edge, silkscreen lines at least 0.15 mm and text at least 1.0 mm tall, no neck of pour thinner
    than 0.25 mm. They are at or above JLCPCB's published 2-layer limits, and some sit exactly on them (the 0.18 mm
    ring, the 0.45 mm hole spacing, the 0.15 mm silkscreen line and 0.15 mm silkscreen to pad, the 1.0 mm text), so a
    board built right at a rule has no margin.
  - Layers: what the code draws. A pour is inset 0.5 mm from the edge and cleared of other nets, holes and keepouts;
    pads of its net join it directly, or through thermal spokes when the footprint defines them (the Pico's pads do,
    the Kailh pads do not); where two cut-outs leave a neck of pour thinner than the copper minimum, the fill cuts
    the neck out too. Mask on both sides (pads open 0.05 mm per side, vias tented), top silkscreen (clipped off
    pads, openings, hole keepouts and the board edge) and the outline.
  - `pcb.route` is a grid router (0.1 mm) that prefers the back and throws when it finds no way. It changes layer
    only where `via: true` allows: pads on different layers get one via, two pads on one layer may hop to the other
    and back; a via keeps its distance from every other via, even one of its own net. It finds the cheapest path on
    the whole board, but looks first in a window round the two pads (5 mm beyond their box, `window` changes that)
    and widens it only as far as it must, so a route costs about its own length and not the board's area. Route the
    hardest net first. A rule broken by hand-drawn copper is a DRC error, not an exception.
- `figure.mjs`: the product drawn with the kit, read by `sprue figure`. `reference/figure.md` has the whole API.

  ```js
  export default function draw({ k, G, T, fig, params, bom, design }) {
    fig.size(640, 520);                                   // optional, before the camera
    const P = fig.camera(points, { azimuth: 38 });        // points: rest and apart poses, in mm
    fig.under(svg);                                       // not a part: a halo, a bench mat
    fig.part("pcb", svg, { step: 1, lift: [0, 0, 12], count: 1 }); // instances of a bom.json line
    fig.xray("sock", svg, { by: ["pcb"], step: 2 });      // dashed outline of a part hidden by pcb, shown when lit
    fig.hidden("fw", "firmware, nothing to draw");        // a line that is not drawn
    fig.step(1, "Lay the PCB face up");                   // the caption for a step
    fig.over(svg);                                        // not a part, drawn last
    return { title: "3x3 macro keypad", hint, caption };  // hint and caption are optional
  }
  ```
- Written by `sprue figure` (and by `sprue figure --draft`, which only leaves the design unproposed):
  `figure.svg` (the bare `<svg>`) and
  `figure.json`: `{ width, height, title, hint, caption, steps: [{ n, text, lines: [id], counts: { "<line id>": n } }],
  parts: [{ line, step, count, dx, dy }], coverage: { "<line id>": { drawn, needed } },
  hidden: { "<line id>": why } }`. `counts` is how many of each line a step places. `dx, dy` is the screen offset
  of the part's `lift`; `needed` is the line's `qtyPerUnit` (1 for a `qtyPerBatch` line with `qtyPerUnit` 0).
  Then it writes `view.html` with the new figure.
- `view.html`: the product page, one for the whole run. `sprue figure` and `sprue view` write it, and every
  command that changes what it shows (a gate, the checks, the quote, the plan) rewrites it. Everything is inline,
  so it opens from disk. At the top are the three stages from `state.json` and what to type at the current gate.
  Then the figure (one line says so while there is none), then Design (needs `bom.json`), Source (once
  `quotes.json` exists) and Build (once `build-plan.md` exists). The parts list and the BOM light the part in the
  figure, and the assembly steps under Build move it. `view.html#apart&step=3&select=pcb` opens the figure in a
  pose. Never edit it by hand.
- `state.json`: the gates. `{ stage: "design"|"source"|"build"|"done", stages: { design: { status, at, note? },
  source: {...}, build: {...} } }`, where `status` is `"drafting"|"proposed"|"accepted"|"declined"` and `at` an
  ISO time. `stage` is the first stage not accepted. Written by `new`, `figure` (design proposed, unless
  `--draft`), `quote` (source proposed) and `plan` (build proposed), each only while its stage has no status or is
  drafting and every stage before it is accepted; and by `accept` (which starts the next stage drafting), `decline` and
  `propose`. `propose` and `decline` send every later stage that has a status back to `drafting`, with a note
  ("reopened: design changed"), because what it showed was built on the old one. A stage after the current one
  reads as not started, whatever the file says. Never write it by hand. It is not part of the cost history, so
  `sprue diff` never shows it; `explorer.json` may carry a copy as `state`.
- `quotes.json`: `{ units, lines, batchUsd, perUnitUsd, longestLeadDays, unquoted, phases? }`. Each line has
  `needQty` (pieces the batch needs), `orderQty` (pieces bought), and `packSize` and `packs` when the shop sells
  packs. The quote rounds up to whole packs and buys up to a higher price break when that costs less in total.
  `phases` is orders A and B, each `{ name, units, lines, batchUsd, longestLeadDays }`, when `firstArticleUnits` is set.
- `production/order-list.csv`: one row per quote line, with `need_pcs`, `order_pcs`, `pack_size` and
  `packs_to_order` (what to type into a cart that sells packs). With orders A and B, `order-a.csv` and
  `order-b.csv` sit beside it in the same columns.
- `pipeline/rates.json` (in the skill folder): the print and PCB price rules. A print rate with `materials` only
  quotes those materials (`spec.material`).
- `pcb/` (written by `sprue pcb`, git-ignored; nothing in it is edited by hand):
  `<slug>-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`, `-F_Silkscreen.gto`, `-Edge_Cuts.gm1` (Gerber X2),
  `-PTH.drl` and `-NPTH.drl` (Excellon), `<slug>-gerbers.zip` (those eight files, the one to upload to a fab) and
  `drc.json`: `{ inputs, rules: { name: { value, note } }, errors: [string], warnings: [string], nets: { "<net>":
  { pads: [string], connected } }, pinMap, stats }`; `inputs` fingerprints the board code, the params and the kit.
  The audit is ours, at JLCPCB's 2-layer limits, not the fab's own check. It checks clearances, widths, edges,
  holes, thermal spokes and silkscreen on the geometry, then reads connectivity back from the very shapes written
  to the Gerbers: every net in one piece, no two nets touching, every netted pad reached, no neck of pour thinner than
  the minimum (a track's width is checked on the track). Each written file is read back as a Gerber reader would and must print exactly those shapes. With any error,
  and when the board code throws or the router finds no way, the zip and the Gerbers are not written (an old one is
  removed) and `drc.json` says why. `previews/pcb-top.svg` and `pcb-bottom.svg` (the bottom mirrored and labelled)
  show the board as the files draw it and are committed. `sprue score` counts a BOM line whose `file` is a `.zip`
  under `pcb/` as ok only when `drc.json` has 0 errors, every net connected and an `inputs` that is still the
  board's; `sprue package` copies the zip only then.
- `shots/<name>.png`: screenshots of the figure card on `view.html`, written by `sprue shot`, for checking the
  figure.
- Written by the commands: `explorer.json` (what the website's BOM explorer shows, written by `sprue view` once
  there is a quote, with each line's `needQty`, orders A and B as `phases`, `costNotes`, and the figure's caption,
  steps and coverage as `figure`), `history/NNN.json`
  (one snapshot per run that changed something, read by `sprue diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `fab/` (STL, STEP), `previews/` (SVG) and `production/`.
