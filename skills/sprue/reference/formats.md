# File formats

All files are JSON in `products/<slug>/` unless noted. `?` marks an optional field.

- `request.json`: `{ slug, brief, product, units, region, budgetUsd?, mustHave: [], niceToHave: [], constraints: {} }`
- `design.json`: `{ slug, summary, architecture: [string], params: { name: number | string }, keyMap?: { "<key>":
  "<GPIO>" }, assembly: [string], estimates?: [string], costNotes?: [string] }`. `keyMap` says which GPIO each key's
  socket is wired to (`{ "K1": "GP10", "K2": "GP7" }`, the keys K1 to K<keyRows x keyCols>); a board with key sockets
  needs it, because the PCB audit checks the drawn nets against it. `costNotes` lists costs the quote leaves out (duty, shipping no
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
  `mpn` is the part the design means, and `alternates` the other parts it may be bought as, each a part number with
  any words after it ("Adafruit 5190 (SCD-41, same board)"); `mpn` is text and `alternates` a list of texts. `sprue
  source` holds every offer's `mpn` to them by part number alone. A part number is a word with a letter and a digit
  (SC0915, DEV-14809) or three or more digits (5187), case and the marks inside it ignored; a maker's name, a size,
  a thread, an amount, a value, a chip package, a standard (ISO 7380) or a date is none. Each text counts by its
  first part number, so the words after it are a comment: "5187 SCD-40" is the part "Adafruit 5187", while "SCD-41"
  is not the alternate "Adafruit 5190 (SCD-41, same board)". An offer of neither the line's part nor an alternate
  is dropped; one of an alternate is kept and flagged, and the quote and the build plan say when they buy it. A line
  whose `mpn` holds no part number ("Satco brass lock nut") can't have its offers checked, and gate 3 flags it.
  `pin` is written by `sprue pick`: the quote then buys that line from that shop even if another is cheaper.
  `cnc` and `sheet` parts have no price yet (no fab adapter, and catalog.json offers are read only for bought
  lines), so a product with one can't pass gate 3 until they do.
  A print line can be pinned by hand to a print service by its name (`{ "supplier": "Craftcloud" }`), or to the
  user's own printer with `{ "supplier": "home" }` when the request says they have one. The quote then buys it
  from "Home printer": `volumeCm3 x gPerCm3` grams at `usdPerKg` from catalog.json `filament`, with no shipping.
  Without a `filament` entry for its material the line has no price.
- `catalog.json`: `{ shipping: { "<supplier>": usd }, shippingFirstArticle?: { "<supplier>": usd },
  shippingRead?: ["<supplier>"], shippingBasis?: { "<supplier>": text }, shipsWith?: { "<supplier>": "<fab>" }, filament?: { "<material>": { usdPerKg,
  gPerCm3, url, capturedAt, densityUrl?, leadDays? } }, offers: { "<bom line id>": [{ supplier, sku, mpn?, url,
  packSize?, priceBreaks: [{ qty, unitUsd }], stock: number | "in stock" | "unknown", leadDays, source: "snapshot",
  capturedAt: "YYYY-MM-DD", note? }] } }`. A key starting with `_` (such as `_note`) is a comment the commands skip.
  Any other field the file does not list here, or a price, quantity, lead time or charge that is not a number, is a
  problem `sprue validate` names, and the commands that price refuse the file until it is fixed (a misspelt
  `unitPrice` was read as nothing, and the total came to $NaN). `note` is what the offer's page said that the
  fields don't hold.
  - `mpn` is the part number the page gives. An offer whose `mpn` is neither the line's nor one of its `alternates`
    (by part number, as above) is dropped as another part ("3203" is "Adafruit 3203"); an offer with no part number
    in it is kept and flagged, since nothing holds it to the line's part. `sprue pick` refuses an offer the source
    stage drops.
  - Shipping: `shipping` is one flat charge per shop. `shippingRead` lists the shops whose charge you read from
    their published rates. Every other charge is an estimate, and the quote, the order list and the page mark it
    so. `shippingBasis` says where each figure came from ("ESTIMATE. No rate published. Stand-in: USPS Ground
    Advantage retail, 1 lb, Zone 8, from USPS Notice 123, read 2026-10-13"). `shippingFirstArticle` is a shop's
    charge on the small order A, when it differs. `shipsWith` names a shop whose parts travel in a fab's parcel
    (`{ "JLCMC": "JLCPCB" }`: JLCMC's parts ship with a JLCPCB board order). When that fab makes a line in the
    order, the shop adds no shipping and the build plan says to check out with the fab; otherwise its own
    `shipping` counts. The quote also tries moving a made line to that fab when the saved shipping outweighs the
    fab's higher price for it. Fees and minimums (a small-order fee, a minimum order) go in `design.json` `costNotes`.
    A shop the order buys from with no `shipping` figure would count as $0: the quote names it (`noShipping`) and
    exits 1, as `sprue all` does, and the source and build gates and `sprue package` refuse until it has one (0 for
    a shop that ships free). `sprue validate` notes every shop with offers and no figure.
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
- `reference/faults.json` (optional, for `sprue faults`): `{ slug, note?, faults: [{ id, area, fault, edit, expect }],
  known: [{ problem, why }] }`. Each fault breaks a copy of the product in one way: `area` is mechanical, pcb or bom;
  `fault` says what it breaks; `edit` is `[{ file, set?, delete?, replace?, optional? }]`: in any file `replace` is
  `[{ from, to }]`, each `from` found exactly once in the file as it stands; then in a JSON file `set` maps a path
  such as `params.caseWallMm` or `lines[id=sw].qtyPerUnit` to its new value and `delete` lists paths (each path
  there already, so a misspelt one fails rather than adding a field nothing reads); `optional: true` skips the edit
  when the product has no such file (`offers.digikey.json`). An edit with any other key, or one that changes
  nothing, is refused, since its copy would be the clean one and read as a fault the gates missed. `expect` lists
  the words (a part such as `ins1`, a line, a param) one of which a problem must name to catch it. `known` is the
  problems the clean design really has, each with why: they are not false alarms.
- `rules.ts` (optional): plain TypeScript, no imports needed.

  ```ts
  export const rules = [
    {
      id: "usb-power",
      title: "Power draw fits the USB budget",
      scope: "assembly", // "part": one part on its own; "assembly": the parts together
      needs: ["drawMa", "usbBudgetMa"], // design params: skipped with none of them, fails with only some
      run: ({ p, bom }) => ({
        status: p.drawMa * 1.5 <= p.usbBudgetMa ? "pass" : "fail", // or "flag" for a human decision
        detail: `${p.drawMa} mA (x1.5 margin) vs ${p.usbBudgetMa} mA`,
      }),
    },
  ];
  ```
  `bom.lines` is the BOM's lines, so a rule can count parts by `role`. `scope` says which gate holds the rule:
  `"part"` for one part on its own (a wall, a pin count, a lens, a standard), which the design gate holds, and
  `"assembly"` for the parts together (a stack-up, a fit, a gap, the current one part draws from another, the product
  tipping), which the inspect gate holds; every gate from Inspect's on holds both. A rule with no `scope` is read as
  part, and `sprue check` names it in one line; a `scope` that is neither fails as `rules:<id>:scope`. The built-in
  rules (their ids are in `checks.json`) are the keypad's: of scope part `bom-roles`, `key-count`, `gpio`,
  `mx-plate`, `keys-on-pcb`, `print-walls`, `print-skins` and `standards`, and of scope assembly `controller-zone`,
  `usb-reach`, `lid-headroom`, `socket-headroom`, `screw-engagement`, `insert-depth`, `holes-clear-keys`,
  `feet-clear-heads` and `usb-power`. `print-walls` and `print-skins`
  hold the walls (with the walls round its screws and inserts) and skins (the plate, the skin over the controller and
  over the inserts, the tray floor) of the lines with role `case-top` and `case-bottom` to the print shop's least
  wall for the line's process (`spec.process`, else its material: PETG, PLA and the like are FDM, a bare PA11 or PA12
  MJF or SLS, a resin or an "ABS-like" SLA; a nylon with anything after its grade but the word nylon, such as
  PA12-CF, needs its `spec.process`), failing under it. A `spec.process` is a process's name and nothing else ("FDM",
  "FFF", "MJF", "HP MJF", "SLS", "Selective laser sintering", or two names of one process as in "Fused deposition
  modeling (FDM)"); anything more about the print (a finish, inserts) goes in the line's `notes`, and a
  `spec.process` that isn't a name fails. A process holds only a `spec.material` that names a material it prints, as
  makers write it ("Prusament PETG", "eSUN ePLA-Matte", "PolyFlex TPU95", "Glass-filled PA12", "Versatile Plastic",
  "Grey resin"), so an alloy, a ceramic or sand fails. So does a plastic whose `spec.material` or `notes` say it is a
  metal, ceramic or sand held in a plastic binder, or a part debound, sintered or fired after printing ("Copper
  Filamet (PLA binder)", "PLA, sintered" under FDM, a ceramic resin): such a print needs a process row of its own,
  marked `"fired"` in `PROCESSES`. The notes, which also name the part's hardware, count only for words about the
  part itself being debound, sintered or fired after printing. Each such failure says why and what to write instead.
  They flag a wall under JLC3DP's figure for the case's size, a wall round a fastener of 1.5 mm or less, every wall
  on a case longer than JLC3DP's table goes (200 mm), and a printed case none of whose walls here the design gives
  the params of (a printed tray with no `trayFloorMm` under a machined lid, say): a person asks the shop. The
  numbers, each with its page, are `PRINT_WALLS` in `pipeline/stages/check.ts`, and each process's names and
  materials `PROCESSES`; a process with no figure there (so far SLA, which has its `PROCESSES` row and needs a
  `PRINT_WALLS` one, and metal, which needs both), a param that isn't a number, a wall with some of its params but
  not all, and printed lines with no `case-top` or `case-bottom` line in the BOM (they may be the case under other
  roles) each fail. A rule whose params the design has none of is skipped and listed in `checks.json`'s `skipped`
  (`[{ id, title, missing }]`); one with some of its params but not all fails, saying which are missing, since that
  is most often a param left out. A rule here with a built-in's `id` replaces it, scope and all (so give it the
  scope again); `{ id: "keys-on-pcb", off: true }` drops one that doesn't fit this product (say why in
  `design.md`). Two rules here with the same id fail as `rules:<id>`.
- `checks.json`: the engineer checks as they last ran, written by `sprue check`, `sprue inspect`, `sprue all` and
  each gate (`sprue accept`, `sprue package`), which run them again on the files as they are. `{ slug, checks: [{
  id, title, status: "pass" | "fail" | "flag", detail, scope: "part" | "assembly" }], failed, flagged, skipped?:
  [{ id, title, missing }], unscoped?: [id] }`. Every check carries its `scope`: the rule's, else `"part"`, and the
  `rules:<id>` rows of a rules.ts mistake are part. `unscoped` lists the rules.ts rules that give no scope, read as
  part; it is left out when there are none. The design gate is refused while a check of scope part fails; from the
  inspect gate on, while any check fails.
- `cad/<part>.py`: build123d, `def make() -> Part`. Files starting with `_` are shared helpers, not parts.
- `cad/pcb.mjs`: the circuit board as code, read by `sprue pcb` (and by `sprue cad`, after the parts). It draws
  with the PCB kit (`pipeline/pcb/`) and reads every number from `design.json` params or the kit's footprint library
  (the audit in `pcb/drc.json` counts as out of date when the file, the params, the kit, or what the board code
  reads of `design` and `bom` change). It may read nothing but what `board()` is handed and the ES modules and JSON
  it imports by a path relative to it (`import layout from "./layout.json" with { type: "json" }`, or
  `import(\`./${name}.mjs\`)`), and the builtins that read no file (`node:path`, `node:url`, `node:util`,
  `node:assert`). Node's module hooks note each module it loads, which the fingerprint then covers, and refuse the
  rest: an import of an absolute path, a `file:` URL, a `#` import, a package or any other builtin (`node:fs`,
  `node:sqlite`, `node:module`), a module in CommonJS, and a call of `process.getBuiltinModule`, `binding`,
  `_linkedBinding`, `dlopen` or `loadEnvFile`. Board code that tries any of them is not run, even when it would get
  by without it, and `drc.json` says why. Millimetres, the
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
    with no net is left floating, except the socket's `A` and `B`, which must connect (a floating one is a dead key),
    and a net with one pad is an error unless `pcb.single` names it, because it is usually a typo. Every footprint
    number names its source, and `pipeline/pcb/fixtures/footprint-refs.json` holds the sources' own numbers (with URLs
    and commits), which the tests and the audit hold the library to, to 0.01 mm. A part the library lacks needs a
    footprint added to `pipeline/pcb/footprints.ts` and its reference numbers to that file; the ones that are
    measured, not dimensioned, belong in `estimates`.
  - Options. `place`: `rotDeg` (a multiple of 90). `route(net, from, to, { via, width, layers, topCost, viaCost,
    turnCost, softMm, window })`: both pads must be on `net`; `topCost`, `viaCost` and `turnCost` are numbers from 0 to
    1,000,000 and `window` is 0 or more (Infinity allowed), and anything else throws. `via(net, x, y, { drill, dia })`.
    `pour(net, layer, { clearance })`: one per layer, declared before the routes so the router keeps clear of its
    thermal spokes. `text(layer, x, y, string, height, { align: "left" | "center" | "right", rotDeg, width })`.
  - Rules, in `pcb.rules` (`pipeline/pcb/rules.ts`, each with its source; read-only, the audit holds the board to
    them): 0.3 mm tracks (0.25 minimum), 0.2 mm clearance, copper 0.5 mm from the board edge and 0.3 mm from a
    non-plated hole, 0.4 / 0.8 mm vias, a via drill of 0.3 to 0.45 mm with a ring of at least 0.2 mm, a part's plated
    hole at least 0.5 mm with a ring of at least 0.3 mm, non-plated holes at least 0.5 mm, holes at least 0.45 mm
    apart edge to edge, silkscreen lines at least 0.15 mm, text at least 1.0 mm tall and 0.15 mm from every mask
    opening, at least 2 thermal spokes into the pour from each pad that has them, no neck of pour thinner than
    0.25 mm. They are at least as strict as the published 2-layer limits of four fabs, kept in `FAB_PROFILES`
    (JLCPCB, PCBWay, OSH Park, Aisler), and a test holds them to it; some sit exactly on the strictest (Aisler's
    0.2 mm via ring and 0.3 mm component ring, JLCPCB's 0.45 mm hole spacing and 1.0 mm text), so a board built right
    at a rule has no margin there.
  - Layers: what the code draws. A pour is inset 0.5 mm from the edge and cleared of other nets, holes and keepouts;
    pads of its net join it directly, or through thermal spokes when the footprint defines them (the Pico's pads do,
    two each, out of the pad's outer edge; the Kailh pads do not); where two cut-outs leave a neck of pour thinner than
    the copper minimum, the fill cuts the neck out too. Mask on both sides (pads open 0.05 mm per side, vias tented),
    top silkscreen (clipped 0.15 mm off the mask openings, off vias, hole keepouts and the board edge) and the
    outline. The copper layers carry the Gerber X2 netlist attributes: each pad, track, via, spoke and pour has its
    net (`%TO.N`, `N/C` for a pad on no net) and each pad its part and pin (`%TO.C`, `%TO.P`), which a fab's CAM can
    check the copper against.
  - `pcb.route` is a grid router (0.1 mm) that prefers the back and throws when it finds no way. It changes layer
    only where `via: true` allows: pads on different layers get one via, two pads on one layer may hop to the other
    and back; a via keeps its distance from every other via, even one of its own net. It finds the cheapest path on
    the whole board, but looks first in a window round the two pads (5 mm beyond their box, `window` changes that)
    and widens it only as far as it must, so a route costs about its own length and not the board's area. Route the
    hardest net first. A rule broken by hand-drawn copper is a DRC error, not an exception.
- `figure.mjs`: the product drawn with the kit, read by `sprue figure`. `reference/figure.md` has the whole API.

  ```js
  export default function draw({ k, G, T, fig, params, bom, design, line, spec }) {
    const SW = spec("sw");                                // a line's spec; a line bom.json lacks fails, naming it
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
  parts: [{ line, step, count, lift, dx, dy }], coverage: { "<line id>": { drawn, needed } },
  hidden: { "<line id>": why } }`. `counts` is how many of each line a step places. `lift` is the part's move in
  the apart pose, `[x, y, z]` in mm as `figure.mjs` gives it, and `dx, dy` that move on the drawing; `needed` is the line's `qtyPerUnit` (1 for a `qtyPerBatch` line with `qtyPerUnit` 0).
  Then it writes `view.html` with the new figure.
- `view.html`: the product page, one for the whole run. `sprue figure` and `sprue view` write it, and every
  command that changes what it shows (a gate, the checks, the quote, the plan) rewrites it. Everything is inline,
  so it opens from disk. At the top are the four stages from `state.json` and what to type at the current gate.
  Then the figure (one line says so while there is none), then Design (needs `bom.json`; its checks are those of
  scope part), Inspect (the whole product from `system.json`, the checks of scope assembly, `faults.json` and what
  is not checked yet; a missing or stale `system.json` says so and names the command), Source (once `quotes.json`
  exists) and Build (once `build-plan.md` exists). The figure's readout shows prices from the source stage on.
  The parts list and the BOM light the part in the figure, and the assembly steps under Build move it.
  With a model (`previews/system.glb`, which `modelView` reads), Fig 1 has a Drawing and a 3D tab: the 3D view is
  made the first time its tab opens, in the drawing's card and as tall as it, with its bar, legend and panel under
  the card, its own readout in the corner, and a line over the bar when the model is of an earlier design. The page
  holds three.js's six modules as text (with its licence, once) and the model in base64, so it still opens from
  disk. The tab chosen last is kept for the next page (localStorage); `#3d`, or a part (`#part=sw5`), opens it.
  `view.html#apart&step=3&select=pcb` opens the figure in a pose. Never edit it by hand.
- `state.json`: the gates. `{ stage: "design"|"inspect"|"source"|"build"|"done", stages: { design: { status, at,
  note? }, inspect: {...}, source: {...}, build: {...} } }`, where `status` is
  `"drafting"|"proposed"|"accepted"|"declined"` and `at` an ISO time, the stages written in this order. `stage` is
  the first stage not accepted. Written by `new`, `figure` (design proposed, unless `--draft`), `inspect` (inspect
  proposed, only when no check fails, the BOM's files are current and the whole-product check passes), `quote`
  (source proposed) and `plan` (build proposed), each only while its stage has no status or is drafting (for
  `inspect`, or declined) and every stage before it is accepted; and by `accept` (which starts the next stage
  drafting: accepting design writes `inspect: drafting`), `decline` and `propose`. `propose` and `decline` send
  every later stage that has a status back to `drafting`, with a note ("reopened: design changed"), because what it
  showed was built on the old one. A stage after the current one reads as not started, whatever the file says. A
  file from before the Inspect stage, its design accepted and no `inspect`, is read as at Inspect: the commands take
  Inspect as `drafting` in memory, at the design gate's `at`, with the note "added: Sprue now inspects the whole
  product before sourcing". No gate the person accepted is rewritten on reading, and Inspect is never accepted for
  them: a bare `accept` or `decline` (no stage named) at an Inspect still drafting refuses with `inspect has not
  been proposed: run sprue inspect <slug> and ask gate 2 first (or name the stage)`; the file changes only when a
  command saves it. A source or build stage it accepted or proposed keeps its status, which reads again once
  Inspect is accepted, unless a fix at Inspect changed what its gate showed. Each `sprue inspect` at Inspect checks
  that, passing or failing: when the quote is not of the BOM as it is (once it passes, when any of the source gate's
  problems is there), source and build go back to drafting; else when the plan is not of the quote (once it passes,
  any of the build gate's problems, or a `production/` of other files than there are now), build alone. Each gets
  the note `reopened: inspect changed the parts (<first problem>)`, and a line is printed for it. Never write it by
  hand. It is not part of the cost history, so `sprue diff` never shows it; `explorer.json` may carry a copy as
  `state`.
- `quotes.json`: `{ units, lines, batchUsd, perUnitUsd, longestLeadDays, unquoted, phases?, noShipping?, inputs }`. Each line has
  `needQty` (pieces the batch needs), `orderQty` (pieces bought), and `packSize` and `packs` when the shop sells
  packs. The quote rounds up to whole packs and buys up to a higher price break when that costs less in total.
  `phases` is orders A and B, each `{ name, units, lines, batchUsd, longestLeadDays }`, when `firstArticleUnits` is set.
  `unquoted` is the lines it found no price for, which `batchUsd` leaves out, and `sprue quote` exits 1 while there
  are any; `sprue score` fails on any line the batch needs that has no quote line (`score.json` `cost.unpriced`), so
  an unpriced part never counts as $0. A line bought as an alternate (`sourcing.json`) carries `alternate`, the
  alternate's text from bom.json, and its `basis` says so. A price that is not a number stops the quote, naming
  the line, rather than writing a $NaN total. `noShipping` is the shops it buys from with no shipping figure.
  `inputs` is what it was priced from: the sha256 of bom.json, catalog.json, offers.digikey.json and Sprue's
  rates.json, and design.json's `firstArticleUnits`. The source and build gates and `sprue package` refuse a quote
  of other inputs, one with no `inputs` (an earlier Sprue's), and one with an unpriced line (naming why: no offer
  left, no print service for its material or pin, no filament for a home print, or a CNC or sheet part) or a shop
  with no shipping figure: run `sprue all` again.
- `build-plan.md`, from `sprue plan`: the build plan, ending in a Markdown comment that records the sha256 of the
  quotes.json and design.json it was written from. The build gate and `sprue package` refuse a plan with no such
  line or of other files, so the plan they ship is the order's: run `sprue all` (or `sprue plan`) again.
- `sourcing.json`: `{ lines: [{ lineId, offers, note?, alternates?, flags? }], unsourced }`, from `sprue source`
  (and `sprue quote`, which prices from the offers as they are and writes it again):
  for each bought line the offers that can buy it, `note` for those dropped (out of stock, short of the batch, or
  another part than the line's `mpn` and `alternates`), `alternates` for the offers of an alternate
  (`{ supplier, sku, alternate }`), and `flags` for gate 3: one offer, one shop, an alternate, offers with no part
  number. `unsourced` is the lines with no offer left, and `sprue source` exits 1 while there are any.
- `score.json`: `{ coverage, checks: { failed, flagged, ran, skipped }, cost: { batchUsd, referenceMidUsd, deltaPct,
  withinBand, unpriced }, files: [{ name, ok, detail }], system: { ok, detail, failed }, faults?: { ok, detail, ran,
  caught, pct, missed, falseAlarms }, pass }`, from `sprue score` against `reference/reference.json`.
  An STL in `files` is ok only as one closed body of positive volume (`meshAudit`, read as trimesh reads a mesh once
  faces with two vertices welded together are dropped), and a `fab/<part>.stl` or `.step` only as the export of the
  `cad/` there is now (`fab/build.json`, which `sprue cad` writes: the sha256 of every `cad/` file but `_system.py`
  and the board's code (`.mjs`, `.js`, `.ts`), and design.json's `params` but `firstArticleUnits`, which splits the
  order and shapes no part; a build.json of an earlier Sprue, without the params, reads as stale); a print's STL also
  only when its mesh holds the volume its BOM line is priced at (`spec.volumeCm3`, a JSON number: `sprue validate`
  names a string), to within the larger of 0.05 cm3 and 1% (`volumeMismatch`;
  the fix is to copy the volume `sprue cad` prints into the line, then `sprue all` so the quote prices it); the
  board's zip as the scorer finds it below. `system` is
  `system.json` as it stands: a product with a printed, machined or sheet part, or any product with a
  `cad/_system.py`, passes only with a `system.json` of the files as they are now (its `inputs`), every gate passed
  and its self-test ok; `failed` names the gates that did not pass. The page reads `system` afresh, so a `sprue
  system` run after the score shows there. `faults`, present when `reference/faults.json` exists, is `faults.json`
  as it stands: ok only with every fault caught and no false alarm, on the product files and the gates' code there
  are now (its `inputs`), and `pass` needs it ok (a product with no `reference/faults.json` is not held to it). The
  page reads it afresh too.
- `cad/_system.py`: the whole product in one frame, for `sprue system` (which `sprue cad` runs after the parts and
  the board, and `sprue inspect` when `system.json` is stale). `system()` returns a `System` from the skill's
  `cad/system.py` (`from system import ...`), in mm with z up. Read the BOM with `BOM, S = bom_lines(HERE.parent)`
  (the lines by id, and their specs) and keep mass estimates in `estimates({line: ...})`: a line, a field of one
  read with `[]`, an estimate for a line with no `spec.massG`, or a board zip (a board whose audit failed has none)
  that isn't there fails the check with one problem, `inputs`, naming it, and `system.json` is still written.
  - `items`: one `Item(id, shape, line, material?, mass_g?, mass_note?, tags?, model?)` per physical piece, placed.
    A printed part is its module's `make()` moved into place, with `material` (its mass is its volume times the
    density: `system.py` `DENSITY`, or a design.json param `<material>DensityGPerCm3`). The board is
    `board_from_gerbers(<its zip>, thickness)`, the outline and drills as the fab gets them. A bought part is an
    envelope (`box`, `cyl`, `model="envelope"`) at the sizes its bom.json line or datasheet gives, or its maker's
    STEP; its `mass_g` is from bom.json `spec.massG` or the datasheet, or an estimate with `mass_note` saying so
    ("estimate: ..."). Tags: `foot` (what it stands on), `metal`, `transparent` (a window or diffuser light passes).
    A line with several pieces gives one item per piece (`sw1` to `sw9`), so the count is checked against the BOM.
  - `min_clearance_mm`: the gap every pair keeps that is not a fit, a contact or a gap (the design's
    `minClearanceMm`).
  - `fits`: `Fit(a, b, why)` for pairs meant to share volume (an insert in its boss, a cap on its switch); `a` and
    `b` are id patterns (`sw*`), and each part either names must share volume with one on the other side (one that
    only touches is a contact). `contacts`: `Contact(a, b, why, gap?)` for pairs meant to touch: each part either
    names touches one on the other side (`scr*`, `ins*`: each screw its own insert). Where else their faces face each
    other they keep `min_clearance_mm` (a board on its standoffs, its edge from the tray's wall), or `gap`: 0 for a
    part a fit locates, such as a switch's post in its footprint's hole, or a screw drawn at its insert's bore. A fit
    or a contact excuses only a pair that meets; two parts that match it and don't (scr1 and ins2) keep the gap like
    any other pair. `gaps`: `Gap(a, b, mm, accept)` for a pair (id patterns, as a Contact's) the design lets sit
    closer than `min_clearance_mm`, down to `mm` (0 or more), with `accept` the reason: a known risk, which the
    clearance gate flags with its reason instead of failing. Closer than `mm`, or sharing volume, the pair still
    fails, and a Gap with no reason, under 0 mm or naming no parts is a problem. `inside`:
    `Inside(items, (case parts), why)`, parts that must be inside the hull of the case.
  - `unplaced`: `{ line: why }` for a BOM line that is not in the frame (a cable that ships loose, spares).
  - `drawn`: `Drawn(id, shape, line, why, mass_g?, mass_note?)` for a part the 3D model draws along the path it takes
    as built, which no gate checks as a shape: a gooseneck bent to the design pose, whose mass each pose weighs as a
    `PointMass`. It places its line (one with an item's id, of no BOM line, or whose line `unplaced` names too is a
    problem of placed), `why` says what path it follows and how the gates weigh it instead, and `mass_g` and
    `mass_note` are the design pose's PointMass, for the view only.
  - `poses`: `Pose(name, items, pushes, drop)`, each way it stands or moves: `drop` removes items (patterns) the
    pose moves and `items` adds them where they go, `Item`s or `PointMass(id, at, mass_g)` for a mass with no shape;
    `Push(name, at, force)` is a force in newtons it must stand (a press on a key). `min_tilt_deg` (10) is the
    least tilt it must stand without tipping. A Pose's or Push's `accept="<why>"` is the design's reason to live with
    it tipping (the same reason rules.ts gives when it flags it): it is flagged in `system.json`, not failed.
  - `probes`: its physical job. `Sound(id, source, center, normal, radius, min_open, why, aim_open?)` (the share of
    rays from the cone, or the baffle opening in front of it, that get out; under `aim_open` is noted in the gate,
    not failed), `Port(...)` (a microphone's port, 95% by default), `View(id, origin, axis, up, hfov_deg,
    vfov_deg, ignore, target?)` (a camera sees none of the product, transparent parts included; with `target`, a
    region such as the page, the whole of its upper surface is in the image with no part in front of it, and how
    much of the image the product fills is reported), `Light(id, origin, axis, half_angle_deg, target,
    min_share, ignore)` (light meets `target`, a window's id, first, or with "out" passes the transparent parts and
    leaves the product), `Keepout(id, region, min_mm)` (no metal near an antenna; every metal part nearer is named).
    Every probe takes `accept="<why>"` too, the design's reason to live with it falling short: its problems are then
    flags carrying "(accepted: <why>)", not failures (a View whose target has no upper surface still fails).
  - Accepting a risk (a Pose's, Push's or probe's `accept`, a `Gap`) is the design owner's call: write the reason the
    user gives, never one of your own. Each shows at the inspect gate as a flag, and flags never stop a gate.
- `system.json` (written by `sprue system`): `{ slug, ok, generatedAt, parts, envelopes, minClearanceMm, items: [{
  id, line, model, material, tags, massG, massNote, estimated, bbox, why? }], relations: { fits: [{ a, b, why, pairs }],
  contacts: [{ a, b, why, gap, pairs }], gaps: [{ a, b, mm, accept, pairs }], inside: [{ items, within, why, parts,
  case }], unplaced }, model, gates: [{ id, title, status, detail, problems, list?, where?, flags?, flagsWhere? }],
  stability: [{ pose, massG, com, tiltDeg, tipsToward, estimatedG, pushes }], probes, selfTest: { ok, faults: [{
  gate, fault, caught, detail }], untested }, inputs, seconds }`. The gates are
  placed, overlap, contact, clearance, inside, stability and function; or, when `cad/_system.py` stops on something
  that isn't there or on an error of its own, the one gate `inputs` naming it, with `parts` 0, no items, relations,
  stability, probes or self-test faults, `minClearanceMm` null, and every gate `untested`. `items` are the parts in
  the frame as the 3D view draws them: `massG` as the stability gate weighs it (null, with why in `massNote`, when it
  can't; `estimated` when its note says estimate) and `bbox` `[x0, y0, z0, x1, y1, z1]` in mm; after them each
  `Drawn`, `model` `path`, with its `why` and its mass as `_system.py` gives it (`parts` counts only the items the gates
  check). `relations` are
  `_system.py`'s fits, contacts, Gaps and Insides, each with the items that meet it: `pairs` of item ids, the one its
  `a` matches first, each pair once (a fit's share volume, a contact's touch, a Gap's are closer than
  `minClearanceMm`), as the overlap, contact and clearance gates found them, and null where that gate couldn't run;
  an inside's `parts` and `case` are the items its patterns match. A failing gate's `list` is its problems in full
  (`detail` has the first 8; at most 200), and `where` beside it is each one's `{ parts, at }`: the ids of the parts
  it is of (a stability problem may name an item of a pose's own, which `items` doesn't list), and a point in the
  frame in mm where it is (inside both parts where they share volume, though the middle of what they share is in a
  hole; midway between a pair too close; the point of a part furthest outside the case; the centre of mass, or where
  a push is; a probe's centre or origin; a metal part's point nearest an antenna, or inside both where it is in the
  region), or `at` null where it is of the parts as a whole (a line short of a part) or of none (a gate that can't
  run). A gate's `flags` are the risks the design accepts in `_system.py`,
  each with "(accepted: <why>)", and `flagsWhere` where each is: they don't fail the gate, and its `detail` counts
  them. The self-test plants faults
  in each gate (a piece left out, a part moved into its neighbour, to just under the gap from a part no Gap pairs it
  with, to just under a Gap's `mm`, out of its fit, off its contact, off it by half the gap its other faces keep, or
  out of the case; 10 kg beyond the feet, 10 kg high over them and a 1000 N shove at the top; a disc over each grille
  or port, a plate in front of each camera or light, a steel block on each keep-out, each probe's fault judged with
  its `accept` set aside) and `ok` needs every one caught: a catch is a problem that names the parts the fault moved
  (or its probe) and that the product without the fault does not have (numbers aside), so a gate that already fails
  can't pass its self-test on that failure. `untested` names a gate, or a fit or a contact's gap, the system has and no
  fault could be planted in. `inputs` is the sha256 of every file under `cad/` (but caches and an editor's dotfiles
  and backups), design.json, bom.json and the board's zip as the run began, of any other file in the product folder
  it read (a STEP model through build123d's importers too, and the modules it imported) as it was first read, and of
  the skill's `cad/system.py` (as `sprue:cad/system.py`). One that is different at the end, or was read as other
  than it began, fails the run and goes in as `changed while the check ran`, which no file's digest matches, so
  `sprue` reads the result as stale and runs the check again. design.json and bom.json go in by what the check
  reads of them: design.json as `"design.json params"`, the sha256 of `JSON.stringify` of its `params` (one that
  doesn't parse is hashed as it is), and bom.json as `"bom.json for one unit"`, the sha256 of `JSON.stringify` (no
  indent) of bom.json with the top-level `units` and each line's `pin`, `spares` and `qtyPerBatch` taken out (the
  batch's and the shops' fields, which neither `cad/system.py` nor a `_system.py` reads). `sprue` computes both and
  passes them to `cad/system.py` in `SPRUE_DESIGN_DIGEST` and `SPRUE_BOM_DIGEST`. So a `costNotes` line, an
  estimate, an assembly step, a `sprue pick`, spares or the batch's size leave `system.json` current, and any param
  (`firstArticleUnits` too), part line or CAD edit makes it stale. Run by hand without those variables, `system.py`
  writes the files' own hashes under `design.json` and `bom.json`, which `sprue` reads as stale and runs again, as
  it does a `system.json` of an earlier Sprue (with `"bom.json without pins"`). `sprue score` (`systemInputs`)
  computes the same keys.
  `previews/system.svg` is the product drawn as one, and `previews/system.glb` the frame as a 3D model, written by the
  same run (committed, as the previews are, so the 3D view has it without `sprue cad`): under a root node named for the
  product, whose matrix makes the frame's mm with z up glTF's metres with y up, a node per item named by its id, in
  `items`' order, its mesh positions and indices only, but for a board's picture's points (`TEXCOORD_0`), and its
  material `cad`, `envelope` or `path` by its model, but for a board's (below). Each face of a shape has vertices of its own,
  one at each point (a round face's seam too), so a viewer that makes smooth normals (three.js `computeVertexNormals`,
  with the flat shading `GLTFLoader` sets on a mesh without normals turned off) shades each face smooth and each edge
  sharp; one that doesn't draws it flat. Each item is its shape meshed to OpenCascade's 0.1 mm deflection (its facets
  within about 0.1 mm of its surface, a sphere's within 0.25 mm); a board `board_from_gerbers` read is meshed to 0.2 mm
  (its drills about 8-sided) and wears a picture of its two faces drawn from that zip (the mask, copper under it, pads,
  the silkscreen but on pads, and the drills, 10 px a mm), the top's and bottom's side by side as seen from above, and
  its edges in the laminate's colour, as the material `board <id>`. An item is that board when its vertices are the
  board's, in order, each where one rotation and translation puts it, however it was placed (`Pos` and `Rot`, `move`,
  `located`, `transformed`, `rotate(..., transform=True)`, or its `solid()`; of boards alike, the one whose mark or
  faces it keeps); mirrored, scaled evenly (by the method or build123d's `mirror()` or `scale()`), cut or joined to
  another shape it is a plain part, and the check says so, while a part made from one of its faces (a pad extruded from
  it) is no board. Its `asset.extras` are `{ slug, inputs, frame }`, `inputs` the sha256 of system.json's `inputs` as
  JSON with its keys in order and no spaces, and system.json's `model` is
  `{ file: "previews/system.glb", inputs, triangles }` of it. A model whose `inputs` are not system.json's
  `model.inputs` is of another run; with no frame (the `inputs` gate), or a model that couldn't be made (the check says
  why), there is none, `model` is null and an earlier `system.glb` is removed.
  The 3D view (`viewer/model.js`) draws it beside what `pipeline/model.ts` (`modelView`) reads from the folder: the
  frame's items, relations and problems from system.json, with each gate's count, `ok`, what the self-test missed and
  `stale`, the inputs it was run on that are not as they are now (as score.ts compares them), each line's name and
  process from bom.json and the files of each line that are there (the board's code, pictures and firmware on the
  board's line only, picked as the order folder picks it); a `model.file` outside the folder is none, and a model
  whose `asset.extras.inputs` are not `model.inputs` is drawn with a note that it is of another run. With no part
  picked, its panel says first whether the check passes (or, when `stale`, what it found on the earlier design),
  which gates fail and on which parts, and the parts the risks it accepts are on. Edges are solid for a part drawn
  from its CAD, dashed for an envelope and dotted for a part drawn along a path (model `path`), whose panel says no
  gate checks it as a shape, with its `why`, and the legend names it. A folder without `pcb/` (git
  ignores it) has a keypad check of an earlier design, since the check was run on the board's zip.
  `modelView` also reads the drawing's assembly from `figure.json` (`assembly`: its steps in order, and for each part
  in the frame the step that puts it in and its `lift`; a line the drawing puts in at more than one step or moves
  apart more than one way has parts it can't match to the drawing's, which come in at the first of those steps and
  don't move apart, and `unsure` says why, by line, as it does for a line the drawing doesn't draw, whose parts are in
  from the start; null without a `figure.json` with steps, and then there is no apart pose and no steps), the first
  stability pose's weighing, the pose the model is drawn in (`stability`: `{ pose, massG, estimatedG, com, tiltDeg }`,
  null without one), and each stability problem's pose, the one its text starts with (`pose`, null for every other
  gate's): its `at` is in that pose, so only the first pose's are marked. The view takes the product apart along the
  lifts and walks the steps; the page's hash starts it in a pose as it does the drawing, with `part` too
  (`view.html#apart&step=3&part=sw5`, a part by its item id, which the 3D view tells the drawing the line of). The two
  say what they do as events on their roots that bubble: `a2:select { line, part }` (the drawing gives only `line`),
  `a2:hover { line, part }`, `a2:step { n, of, text }` and `a2:apart { on }`. Each ignores its own, and the drawing
  takes one from inside its card (its `scope`) as its own figure in another view: it follows without scrolling to
  itself, taking the focus or saying it back, where a step chosen elsewhere on the page (the build steps) brings its
  card into view and gives it the focus. A view that mounts after the other dispatches `a2:ask`, and the other replies
  with its `a2:step`, `a2:apart` and `a2:select`, each with `reply: true`; the one asking goes there at once.
- `production/order-list.csv`: one row per quote line, with `need_pcs`, `order_pcs`, `pack_size` and
  `packs_to_order` (what to type into a cart that sells packs). With orders A and B, `order-a.csv` and
  `order-b.csv` sit beside it in the same columns.
- `pipeline/rates.json` (in the skill folder): the print and PCB price rules. A print rate with `materials` only
  quotes those materials (`spec.material`).
- `pcb/`: the board's files, git-ignored; nothing in it is edited by hand. `sprue pcb` writes the Gerbers, the
  drill files, the zip, the netlist, `drc.json` and `board.json`, and removes `verify.json` and `order/`, which are
  of the board before (an earlier `readback.json` stays, and its `inputs` say which board it read). `sprue
  verify` writes `readback.json`, `kicad.json`, `verify.json` and `order/`; `sprue cad` writes `readback.json` too,
  without the self-test.
  - The files to make the board from: `<slug>-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`,
    `-F_Silkscreen.gto`, `-Edge_Cuts.gm1` (Gerber X2), `-PTH.drl` and `-NPTH.drl` (Excellon), and
    `<slug>-gerbers.zip`, those eight files, the one to upload to a fab. The copper layers carry the X2 netlist
    attributes (`cad/pcb.mjs`, Layers, above).
  - `<slug>.d356`: the IPC-D-356A netlist for a fab's electrical test: every pad, via and non-plated hole, a pad on
    no net as `N/C`, in inches, `UNITS CUST 0`, in the Gerbers' coordinates.
  - **The audit** (`sprue pcb`, and the first layer of `sprue verify`) is ours, at least as strict as each fab
    profile, not a fab's own check. It runs three checks:
    - Intent (`pipeline/pcb/intent.ts`): every placed footprint matches its reference (so a mirrored or moved one
      fails), each socket's A pad reaches exactly one GPIO of the Pico and no supply, control or ground pin, no GPIO
      serves two keys, each B pad reaches a GND pin, and the nets are the ones design.json's keys and `keyMap` mean,
      with nothing else joined; a socket goes on the bottom only, where its reference is drawn, and an assembly step
      that names a key on another GPIO than `keyMap` fails. A board with a Pico and no keys has no `keyMap` to hold
      its nets to, but no supply (VBUS, VSYS, 3V3(OUT), ADC_VREF) or control pin (RUN, 3V3_EN) of the Pico may be on
      its ground, and a net with VBUS or VSYS on it may hold no other pin of the Pico but 3V3_EN: 5 V on a GPIO, RUN,
      ADC_VREF or 3V3(OUT) would damage it.
    - Fit (`pipeline/pcb/fit.ts`): the parts held to the params the case is built from, to 0.05 mm: the outline
      `pcbWidthMm` x `pcbHeightMm` with `pcbCornerMm` corners, socket K<n> at key n of the grid (`keyRows`,
      `keyCols`, `keyPitchMm`, `pcbEdgeToKeyMm`; numbered from the bottom left, row by row) turned 0 or 180 degrees,
      the Pico at `controllerCenterXMm`, `controllerCenterYMm` with its body `controllerLengthMm` x
      `controllerWidthMm`, and a screw hole of `screwClearanceMm` at each corner `holeInsetMm` in, with copper kept
      `bossOuterMm` / 2 from it. A part the board places whose params design.json does not give under these names
      (the ones the case and the design checks read) is an error that names them, so a param called something else
      does not leave the part unchecked; the Pico's turn, USB end to +x, is checked whatever the params. `drc.json`
      `fit` lists what it checked, and `sprue verify`'s audit line says it.
    - DRC (`pipeline/pcb/drc.ts`, with `rules.ts`): clearances, widths, edges, holes, thermal spokes and silkscreen
      on the geometry, then connectivity read back from the very shapes written to the Gerbers: every net in one
      piece, no two nets touching, every netted pad reached, every thermally relieved pad reaching the pour by at
      least 2 spokes, no neck of pour thinner than the minimum (a track's width is checked on the track). Each
      written Gerber is read back as a Gerber reader would and must print exactly those shapes with those netlist
      attributes, and the `.d356` must read back as exactly the board's pads, vias and holes.

    With any error, and when the board code throws or the router finds no way, the zip, the Gerbers and the netlist
    are not written (old ones are removed) and `drc.json` says why. `previews/pcb-top.svg` and `pcb-bottom.svg` (the
    bottom mirrored and labelled) show the board as the files draw it and are committed.
  - `drc.json`: `{ inputs, reads, rules: { name: { value, note } }, errors: [string], warnings: [string], nets: {
    "<net>": { pads: [string], connected } }, pinMap, intent, fit: { checked }, measured, fabs, stats }`.
    - `inputs` fingerprints the board code and the modules it loaded (`reads.modules`, each by its path from the
      product folder, one that it tried and is not there as missing), the params, the keyMap and the assembly
      steps, the kit (with the firmware's generator and runner, `pipeline/firmware/` and `harness.py`, `readback.py`
      and `requirements.txt`), the footprint references, and the keys of design.json and bom.json the board code
      read, which `reads` lists (`{ design: ["assembly", "slug"], bom: [], modules: ["cad/pcb.mjs"] }` for the
      keypad; `"*"` is a whole file, and a key read through its descriptor counts). Each object's keys are taken
      in order, so params written in another order are the same board. Every later file of the board carries the same
      `inputs`, so a stale one shows.
    - `intent` is the circuit design.json means, `{ controller, keys: { "<key>": { gpio, pin } }, ground: { pads,
      pins } }` (null when it could not be built), by the reference's pin numbers.
    - `measured` is the board's smallest of each feature a fab limits, `{ "<feature>": { mm, at } }` (the narrowest
      copper, the closest two nets, the smallest via ring, and so on, with where it is), and `fabs` holds it to each
      profile: `{ jlcpcb: { name, ok, why: [string] }, pcbway, oshpark, aisler }`, `why` saying which feature is
      outside that fab's limit.
  - `board.json`: the board as drawn, for the read-back of the written files: `{ inputs, slug, frame, board: {
    width, height, corner, outline }, files: { "F.Cu": "<slug>-F_Cu.gtl", ..., PTH, NPTH, netlist, zip }, pads: [{
    id, ref, num, name, kind, mustConnect, net, x, y, w, h, shape, layers, drill }], vias, drills: { plated,
    nonPlated }, pours, nets: { "<net>": [pad id] }, singles, intent, intended, firmware, firmwareCode, rules }`.
    It is written even when the audit has errors, though not when the board code throws.
    - `nets` is what the board code drew (a pad on no net is a net of its own) and `intended` the netlist design.json
      means: `[{ net, pads, anyOf? }]`, each key's A pad with its GPIO pin, and the ground (every B pad with at least
      one of the controller's ground pins, `anyOf`); a controller or socket pad listed nowhere is meant to be joined
      to nothing.
    - `firmware` is the keys the firmware reads, `[{ key, gpio, row, col, kc, code }]` (each socket, the Pico GPIO
      its A pad is wired to, its row from the top and column from the left, its KMK key name and HID usage code), or
      null for a board without keys; `firmwareCode` is the `code.py` written for them, `{ file, sha256 }`
      (`firmware/code.sprue.py` when `firmware/code.py` is the user's own).
    - `rules` is the rules the audit held the board to, which the read-back holds the files to.
  - `kicad.json`: the KiCad cross-check (`pipeline/pcb/kicad.py`, run by the read-back's Python, which finds KiCad's
    own for the DRC): the board rebuilt in KiCad from the zip and KiCad's DRC on it. `{ inputs, slug, ok, status:
    "pass" | "partial" | "fail" | "not run", zip: { name, sha256 }, kicad, tested, python, note?, errors, rebuilt?: {
    pads, vias, npth, tracks, outline, pours: [{ layer, net, touches }] }, ruleSets: [{ id, title, source, ruleFile,
    status, note, ruleFileLoaded, canaryHits, loaded, errors, warnings, ignored, fillMm2, fillAfterMm2,
    skippedRules? }], netlist: { ours, kicad, matched, onlyOurs, onlyKicad, ok } | { ok: false, error } | null,
    selfTest: { ok, ran, cases: [{ fault, expect, ok, got }] } | null, seconds? }`. `kicad` is the KiCad that ran
    (null when none was found, or when the rebuild stopped before one was looked for), `tested` the one the check and
    the pinned rule files were proved on, and `note` why KiCad's DRC with our rules did not run, when it did not.
    `errors` are what the rebuild found before any DRC (copper KiCad cannot hold as items, which stops it with no
    `rebuilt`; a pour touching two nets), and either is `fail` with or without KiCad; each rule set's `errors` are
    KiCad's violations of any severity but warning, less those about what the rebuild has no part in (`ignored`:
    footprint libraries, courtyards, silkscreen). `fillMm2` and `fillAfterMm2` are the pours' copper as loaded and
    after the DRC, the same when KiCad did not refill them. `skippedRules` (a fab's own file only) names the rules
    KiCad skipped because their conditions did not compile, found by a probe run that reads the file as KiCad 7 does
    (a line starting with `#` is a comment, a rule's last condition is the one it keeps); null when the probe did not
    run, or the file's brackets or quotes do not balance. The netlists are compared net by net, each record of ours
    paired with one of KiCad's within 0.0001 in (a unit of the file, which two writers may round either way);
    `onlyOurs`/`onlyKicad` give each record left over as `<net> at (x, y) mm`, to 0.001 mm. `partial` is a pass in which a fab's rule file
    did not load, KiCad skipped some of its rules, or no fault could be put in (`selfTest.ran` false). It does not
    hold back the board. kicad.py exits 0 on pass or partial, 1 on fail, 5 when no KiCad was found and 6 when one was
    found but its DRC did not run.
  - `readback.json`: the read-back of the shipped files (`pipeline/pcb/readback.py`, Python 3.12+ with gerbonara
    1.6.3 and shapely 2.2.0 from `pipeline/pcb/requirements.txt`, run with `-I`). Another reader than our writer reads
    only the zip's Gerbers and drill files and the `.d356`, with `board.json` for where the pads are and the intended
    netlist. `{ inputs, slug, ok, files: { zip: { name, sha256, files }, netlist: { name, sha256 } }, tools, checks:
    [{ id, checked, ok, errors, ran? }], errors, warnings, nets: { "<net>": [pad id] }, stats, selfTest? }`. The
    checks, in order:
    - `files`: the zip unzips and holds exactly the files `board.json` lists; each Gerber's `%TF.FileFunction%`
      matches its name (a Protel extension, KiCad's layer name such as `-F_Cu.gbr` or Aisler's such as
      `.toplayer.ger`), and each drill file's its PTH or NPTH name; each file states its unit once and holds only the
      statements our writer writes, in one absolute format and with one M02, last, so no step and repeat, mirroring,
      rotation, scaling, offset, incremental coordinates, aperture macro or aperture with a hole, all of which a
      fab's CAM applies; every file parses, and a netlist in the zip, `.d356` or `.ipc`, is the very `.d356` read
      back. A file it cannot read through, such as a zip cut short, fails here with the reason, and the checks after
      it do not run (`ran: false`).
    - `outline`: exactly one closed outline, `board.json`'s, of its size and where it is, the copper inside it and
      the rules' `edgeMm` from it.
    - `drills`: the drill files hold exactly the board's holes.
    - `copper`: each layer painted in file order, the non-plated holes punched out, the islands joined where a
      plated drill lands; every pad has copper at its centre.
    - `sizes`: each pad flashed at its size and shape and at least 99% of it copper once every object is painted,
      so a clear object drawn after a pad does not eat it; every track, spoke and dot at least `trackMinMm` and every
      via at its size; every plated drill with its ring on both layers; copper of two nets `clearanceMm` apart; and
      no pads joined only through copper narrower than `trackMinMm` less 0.05 mm.
    - `mask`: every pad's opening covers the pad and `maskExpandMm` round it, the mask open nowhere but over the pads
      and the non-plated holes, and the legend `silkPadGapMm` from every opening.
    - `intent`: the netlist that copper makes against `intended`: OPEN, SHORT, a controller or socket pad listed
      nowhere being a net of its own.
    - `netlist`: the `.d356` read by gerbonara: every pad, via and hole where the board has it, on its net, and the
      copper joining exactly what it says.
    - `x2`: each copper object's `%TO.N` is the net its copper joins, and each pad has its `%TO.P` flash; gerbonara
      keeps no attributes on regions, so the pour's go unchecked.

    `nets` is the extracted netlist, each piece of copper with two or more pads, named by the net design.json means
    for them (two names joined by `+` for a short); with no keys, the intended nets are the ones the audit passed.
    `selfTest` (with `--self-test`, as `sprue verify` runs it) puts a cut round a key's pad (or any pad on a
    shared net clear of plated drills), a sliver across a key's socket and one from the Pico's VBUS through VSYS to
    GND into copies of the files, each where the board has something to put it on, and passes only if each fails and
    an unchanged copy passes: `{ ok, ran, control: { ok, errors }, cases: [{ fault, expect, ran, ok, got }] }`. With
    no fault put in, `ran` is false: the self-test did not run, which `sprue verify` calls unverified, not
    failed, and the scorer and `sprue package` refuse the zip, saying so. `inputs` is `board.json`'s, which is `drc.json`'s, and the fingerprint covers
    `readback.py`.
  - Running `readback.py`: it prints `read-back: running on Python <version>` on stderr first, and exits 0 when every
    check passed, 1 when one failed, 2 when there are no files to read, 3 when gerbonara or shapely is missing or not
    at its pin, and 4 when the Python is older than 3.12. `sprue verify` runs it with `$SPRUE_PYTHON`, else
    `~/.cache/sprue/venv/bin/python3` once that venv is made (in the cache `SPRUE_CACHE` moves; a venv whose
    Python is gone is said, not passed over), else `python3`. Without that first line nothing ran it (a macOS
    `python3` stub with no developer tools, a pyenv shim with no version set), which is unverified, not failed. On
    that, 3 or 4 it prints what to do: the venv made with `--clear` (so a venv made with an older Python is made
    again, not kept) by a Python 3.12 or newer the PATH has (`python3`, else `python3.14`, `3.13` or `3.12`), or,
    with none, install one first; with `$SPRUE_PYTHON` set, to point it at Python 3.12 or newer.
  - `verify.json`: `{ slug, inputs, status: "verified"|"failed"|"unverified", zip, order, note, layers: [{ id, title,
    checked, status: "pass"|"fail"|"not run", result, errors, fix?, blocks?, aside? }] }`.
    - `layers`, in order: `audit`, `readback` and its `self-test`; for a keypad `firmware` and `firmware-self-test`
      (`fil.json`, below) and, when `firmware/code.py` is the user's own, `your-firmware` (`blocks: false`: its
      failure is the code's, said with ⚑, and the board is verified without it); `kicad`, the KiCad cross-check
      (`kicad.json`, above; `blocks: false` too, `aside` says why); and last `order`, the hand-off. A layer that
      cannot run is `not run`, with why: the read-back without files from a passing audit, the firmware without a
      passing read-back, KiCad without a read-back that found no errors or without KiCad's Python, the order files
      without every layer that holds back the board passed.
    - `status`: `verified` when every layer that holds back the board passed (one with `blocks: false` that failed
      or did not run is named on the VERIFIED line and in the order README); `failed` when one failed; `unverified`
      when the read-back could
      not run (no Python 3.12+, gerbonara or shapely), its self-test could put no fault into the board, or the
      firmware could not run (CircuitPython, KMK or rp2040js neither cached nor fetched, or the emulator out of the
      computer's time), which is not a pass. `sprue verify` exits 0 when verified, 1 when failed and 2 when
      unverified, or when the product has no board (`cad/pcb.mjs`) to verify, which writes no `verify.json`.
      `sprue status` counts the file only once it says verified, and only while it is of the board in `pcb/` now
      and `sprue package` would take its zip; once the board, its zip or the kit changed, once bom.json and
      design.json no longer give one board to order (below), or once the order folder it names is gone or of another
      order, it shows `(stale)`, and `sprue verify` is next again.
    - `order` is `{ dir: "pcb/order", fabs: [{ id, name, zip, sha256, files }], skipped: [{ id, name, why }] }`, or
      null when no order folder was written.
  - `order/`: the board ready to order by hand (`pipeline/pcb/order.ts`), written only when every other layer
    that holds back the board passed (the KiCad cross-check and the user's own firmware do not), into `order.part/` first and then renamed, so it is there whole or not at all, and only when bom.json's
    PCB line and design.json give one board: the same thickness (`spec.thicknessMm`, `pcbThicknessMm`, a number of
    mm, or a string of one with or without "mm"), 1.6 mm, which every fab profile was checked for, and 2 layers.
    Otherwise the order layer fails and names both values. The board's PCB line is the one whose `file` is the
    board's zip, however its path is written (as the scorer finds it, below), else the first PCB line that names no
    file: a switch plate ordered as a PCB is not held to the board.
    - `README.md`: the board's size, layers, thickness, copper and finish, its smallest features from `drc.json`
      `measured`, the fab profiles it passes with a price for each, every layer of the verification with its result
      (the firmware said to have run only when its layer passed, and the parts to lay on the prints only those the
      board places), and the board's fingerprint and the zip's sha256.
    - `order.json`: `{ inputs, zip: { name, sha256 }, texts }`, which ties the folder to the board, and `texts` the
      sha256 of what the texts take from bom.json and design.json: the layers, the thickness, the finish and how many
      boards.
    - `<slug>.d356`, and `pcb-top.svg` and `pcb-bottom.svg` with their size in mm, to print at 100% scale.
    - A folder per fab profile the board passes, `jlcpcb/`, `pcbway/`, `oshpark/` and `aisler/`, each with
      `<slug>-<fab>.zip` and `ORDER.md` (where to upload, the steps, the settings, the price with its source, the date
      it was read and why it is unverified, and last the STOP line, "STOP: do not upload, quote or pay without your
      explicit OK."). Each zip holds the board's own Gerbers byte for byte under that fab's names, and its drill
      files in that fab's format: JLCPCB the board's zip as it is (Protel names, mm with a decimal point); PCBWay
      KiCad's names (`-F_Cu.gbr`, `-F_SilkS.gbr`, `-Edge_Cuts.gbr`), `-PTH.drl` and `-NPTH.drl` in inches with a
      decimal point and the netlist as `PCBWay_netlist.ipc`, as its KiCad plugin writes them; OSH Park `.gtl`,
      `.gbl`, `.gts`, `.gbs`, `.gto`, `.gko`, `-PTH.xln` and `-NPTH.xln`; Aisler `.toplayer.ger`, `.bottomlayer.ger`,
      `.topsoldermask.ger`, `.bottomsoldermask.ger`, `.topsilkscreen.ger`, `.boardoutline.ger`, `.drills_pth.xln`
      and `.holes_npth.xln`; OSH Park's and Aisler's drills in inches in the 2:4 format with every zero kept.
      `sprue verify` reads each zip back with `readback.py`, as it read the board's own, and writes the folder only
      when every one passes. With a finish other than HASL, Aisler's `ORDER.md` says first that HASL Budget, the
      service the board was checked against, makes HASL only, and JLCPCB's $2 price is said to be HASL's.

    `sprue pcb` removes the folder, and `sprue score`, `package` and `status` remove it once its `order.json`
    is not of the board and the zip in `pcb/` now, or bom.json or design.json no longer give the quantity, layers,
    thickness and finish its texts say. Nothing is uploaded, quoted or ordered: in every command, fetch refuses each fab's
    host and every order or payment call (`guardNetwork`).
  - What the scorer and `sprue package` take: the board's BOM line is a PCB line (`process: "pcb"` or `role:
    "pcb"`), any line whose `file` is in `pcb/` however its path is written (`./pcb/x.zip`, its absolute path, or
    through a link: `board/x.zip` with `board/` a link to `pcb/`, `../../examples/<slug>/pcb/x.zip` through the
    `products/` link), or any line whose `file` is a copy of a file in `pcb/`. A `file` is found from the product
    folder, so an absolute path is the file it names. `sprue score` counts it
    as ok only when it names the very zip the read-back read (`pcb/<slug>-gerbers.zip`, not one of that name
    elsewhere), `drc.json` has 0 errors, every net connected and an `inputs` that is still the board's, and
    `readback.json` passed with its self-test, carries the same `inputs` and read the zip and the netlist that are
    there now (by sha256), and, for a keypad, the board's own firmware passed on this zip and this board with its
    self-test (`firmware/fil.json`: a failure holds until the zip or the board's firmware changes, however often the
    board is built again, and a `code.py` of the user's own does not clear it; a missing or stale `fil.json` refuses
    it too, and the detail says to run `sprue verify`). `sprue cad`'s read-back has no self-test, so after it the
    score reads "not yet" until `sprue verify` runs, and it keeps a self-test that failed on the same zip. `sprue
    package` copies the zip on the same terms, and removes one an earlier run copied. Both refuse it, as `sprue verify`'s order layer fails it, while bom.json and
    design.json do not give one board to order (the thickness or the layers above), saying why.
- `firmware/` (a board with key sockets and a Pico). `code.py` and `README.md` are the product's own files, kept
  with it like `build-plan.md` (the examples ship them); `fil.json` is the report of one run on the files in `pcb/`,
  and like them this repo does not commit it.
  - `code.py` and `README.md`: written by `sprue pcb` once its audit passes (and removed when it fails). A
    `code.py` that `sprue pcb` did not write (it has no line saying so; one that says `distinta pcb`, Sprue's name
    before the rename, is its own too) is the user's, and stays: the board's
    firmware goes to `code.sprue.py` beside it. Whether a board has firmware is `board.json` `firmware`, not
    whether a `code.py` is there. `code.py` is KMK on CircuitPython for the Raspberry Pi Pico: a `KeysScanner` on the
    GPIO each key's socket is wired to on the routed board, in reading order (the top row first, as the keypad is
    seen from above), with the Pico's pull-ups and `value_when_pressed=False`, and a keymap of `KC.N1` to `KC.N9` for
    K1 to K9 in the same order, for the user to change to shortcuts. `README.md` says how to put it on the Pico, with
    links to the CircuitPython UF2 and the KMK commit `sprue verify` tests, and which key types what. `sprue
    package` copies both into `production/firmware/`, with the board's zip only, and only a `code.py` that is the
    one `sprue pcb` wrote for this board (`board.json` `firmwareCode`) or the user's own whose run passed on this
    zip.
  - `fil.json`: the firmware in the loop (`pipeline/firmware/fil.ts`), written by `sprue verify` and kept until
    the next run. CircuitPython 10.3.1 and KMK at a pinned commit, with the board's own firmware as `sprue pcb`
    wrote it (made again from `board.json` and held to `firmwareCode`'s sha256, so an edited `code.py` is not taken
    for it), booted in rp2040js 1.4.0, each GPIO driven by the piece of copper `readback.json`'s `nets` joins it to
    (ground, the 3V3 supply, another GPIO, or its own pull-up), each key and each pair of keys pressed. `{ inputs,
    slug, ok, note, firmware: { file, sha256 }, netlist: { file: "pcb/readback.json", zip, zipSha256, sha256 },
    tools: { circuitpython, kmk, rp2040js }, keys, checked, errors, presses: [{ keys, want, got, ok }], selfTest: {
    ok, cases: [{ fault, ok, got }] }, stats, yours? }`.
    - `firmware.file` is `firmware/code.py` or, beside the user's own, `firmware/code.sprue.py`.
    - A press passes when the keyboard reports exactly the keycodes `want` (HID usage codes) and then nothing once
      the keys are let go, and with no key pressed it must report nothing; an error names the key and what the
      copper does there.
    - `selfTest` puts into the read-back's netlist a key's GPIO joined to ground and, with two keys or more, two keys
      swapped and two keys' GPIOs joined, and passes only if each makes a key come out wrong.
    - `yours` is the user's `code.py` run after it on the same copper, each key on its own: `{ file, sha256, ok,
      checked, errors, types: [{ key, codes, names }] }`, failing only for what no keymap means (it cannot be run,
      such as a `code.py` too large for the drive, it does not start, a key reads held with none pressed or does not
      let go, or no key types anything).
    - The run has 600 s of the computer's processor time (not the clock's, so a computer put to sleep mid-run uses
      none of it). One that runs out is unverified, not failed, and writes no `fil.json`.
    - `inputs` is `readback.json`'s. The emulator is fetched into `~/.cache/sprue/firmware` (`SPRUE_CACHE` moves
      it; `SPRUE_OFFLINE=1` fetches nothing), each file pinned by sha256 and each folder by a digest of its files.
- `shots/<name>.png`: screenshots of the figure card on `view.html`, written by `sprue shot`, for checking the
  figure.
- Written by the commands: `explorer.json` (what the website's BOM explorer shows, written by `sprue view` once
  there is a quote, with each line's `needQty`, orders A and B as `phases`, `costNotes`, the figure's caption,
  steps and coverage as `figure`, and the whole-product check as `inspect`: `system.json` as `systemAudit` judges it
  (`verdict`), with `system` current, stale, unwritten, missing, unreadable or none, the command to `run` while it is
  not current and what it found as `report`, `faults.json` as `faultsAudit` judges it (`faults`), and the rules.ts
  rules with no scope as `unscoped`; the checks of scope assembly are in `checks`, by their `scope`), `history/NNN.json`
  (one snapshot per run that changed something, read by `sprue diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `system.json`, `faults.json`, `fab/` (STL, STEP), `previews/` (SVG, and `system.glb`),
  `firmware/` and `production/`.
- `faults.json` (written by `sprue faults`, `pipeline/faults.ts`): `{ slug, ok, generatedAt, ran, caught, pct, missed,
  falseAlarms, control: { problems, stale, falseAlarms, known: [{ problem, why, seen }] }, cases: [{ id, area, fault,
  ran, caught, by, got?, broke?, new, stale, kicad?, error? }], inputs, seconds }`. Each fault of `reference/faults.json` is
  put into a copy of the product's own files (none of what a run writes), and the copy goes through `sprue cad`
  (when it has `cad/`), `sprue verify` (when it has a board), `sprue validate` and `sprue all`; so does a copy with
  no fault, `control`. A problem is `{ gate, text }`, from a command's error line, validate's list, the failed
  checks, `pcb/drc.json`'s errors, the failed layers of `pcb/verify.json` that hold the board back (KiCad's verdict
  on a board fault is `kicad`, apart), each failing gate of `system.json`, a BOM print `sprue cad` did not build and
  the score's misses (a missing role, an unpriced line, the cost out of its band, a file not ok). One that only says a stage did not run on these files
  (of an earlier design, not generated yet, no board zip for the whole-product check since the audit stopped it) is
  in `stale`, never a catch. A fault is `caught` only by a problem the
  control does not have, numbers aside, that names one of its `expect` words (in a score line, after the file it
  starts with); `by` names the gates, `got` the first such problem, and `new` lists up to 12 problems the control
  does not have. A problem that says code broke, wherever it was read, is a crash (gate `<gate>:crash`): an
  exception (every command prints an engine's with its class, `TypeError: ...`, as does the read-back for one it did
  not expect; the kit's own refusal of a design is a plain message and counts), JSON that does not parse, a command
  that failed, a system error (`ENOENT: ...`, also after the file a score line starts with), a whole-product gate that
  could not run (`Can't run: ...`), a read-back that stopped. A crash and the
  score's note that a print's mesh is not the volume it is priced at never catch a fault; `broke` gives the first
  crash. `kicad` is "not run" for a board fault our audit stopped before KiCad. A fault
  whose edit does not apply, or whose edits were all optional and all skipped, is not run (`ran: false`, `error`). `control.falseAlarms` is the control's problems that match no `known` one,
  numbers aside, and a known one the control no longer has is `seen: false`. `ok` needs every fault run and caught,
  no false alarm and no stage skipped on the control. `inputs` is the sha256 of every file of the product's own (but
  the firmware `sprue pcb` wrote, which each copy writes again; a link within the product is copied as a link, made
  again from where it lands in the product, so an absolute one points into the copy; one out of it counts as the
  files and folders it reaches by their shortest name, and every other name for one already counted is a link to
  it, so each folder is walked once and a folder holding nothing is made in the copy too; a link to a folder the
  product is in counts as nothing; a link out of it that no one can follow is copied as one that fails the same way:
  to itself for a loop, to a name in `.sprue-new/` (whose folder is made, so a write lands in the copy) for one to
  nothing in a folder that is there, to a name in `.sprue-gone/` for one to nothing in a folder that is not, through
  the file `.sprue-notdir` for one through a file; each link is an input too, by where it leads, and for one out of
  the product that no one can follow, how it fails; and so is each folder that holds nothing counted (but
  `firmware/`, which `sprue pcb` makes), as `<folder>/`, since a copy makes it even so and `sprue cad` runs or not by
  whether `cad/` is there),
  and of the gates' code (`pipeline/`, `cad/` and `bin/` but tests) as `sprue:gates`.
