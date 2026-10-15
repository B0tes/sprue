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
  `pin` is written by `distinta pick`: the quote then buys that line from that shop even if another is cheaper.
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
- `cad/pcb.mjs`: the circuit board as code, read by `distinta pcb` (and by `distinta cad`, after the parts). It draws
  with the PCB kit (`pipeline/pcb/`) and reads every number from `design.json` params or the kit's footprint library
  (the audit in `pcb/drc.json` counts as out of date when the file, the params, the kit, or what the board code
  reads of `design` and `bom` change). It may read nothing but what `board()` is handed and the modules it imports
  by a literal relative path (`import layout from "./layout.json" with { type: "json" }`, or `import(\`./keys.mjs\`)`
  with no `${}`), which the fingerprint follows: board code that imports `node:fs`, `child_process`, `module` or
  `worker_threads`, calls `process.getBuiltinModule`, or imports a path it works out (`import("./" + name)`) is not
  run, and `drc.json` says why. Millimetres, the
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
- `figure.mjs`: the product drawn with the kit, read by `distinta figure`. `reference/figure.md` has the whole API.

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
- Written by `distinta figure` (and by `distinta figure --draft`, which only leaves the design unproposed):
  `figure.svg` (the bare `<svg>`) and
  `figure.json`: `{ width, height, title, hint, caption, steps: [{ n, text, lines: [id], counts: { "<line id>": n } }],
  parts: [{ line, step, count, dx, dy }], coverage: { "<line id>": { drawn, needed } },
  hidden: { "<line id>": why } }`. `counts` is how many of each line a step places. `dx, dy` is the screen offset
  of the part's `lift`; `needed` is the line's `qtyPerUnit` (1 for a `qtyPerBatch` line with `qtyPerUnit` 0).
  Then it writes `view.html` with the new figure.
- `view.html`: the product page, one for the whole run. `distinta figure` and `distinta view` write it, and every
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
  `distinta diff` never shows it; `explorer.json` may carry a copy as `state`.
- `quotes.json`: `{ units, lines, batchUsd, perUnitUsd, longestLeadDays, unquoted, phases? }`. Each line has
  `needQty` (pieces the batch needs), `orderQty` (pieces bought), and `packSize` and `packs` when the shop sells
  packs. The quote rounds up to whole packs and buys up to a higher price break when that costs less in total.
  `phases` is orders A and B, each `{ name, units, lines, batchUsd, longestLeadDays }`, when `firstArticleUnits` is set.
- `production/order-list.csv`: one row per quote line, with `need_pcs`, `order_pcs`, `pack_size` and
  `packs_to_order` (what to type into a cart that sells packs). With orders A and B, `order-a.csv` and
  `order-b.csv` sit beside it in the same columns.
- `pipeline/rates.json` (in the skill folder): the print and PCB price rules. A print rate with `materials` only
  quotes those materials (`spec.material`).
- `pcb/`: the board's files, git-ignored; nothing in it is edited by hand. `distinta pcb` writes the Gerbers, the
  drill files, the zip, the netlist, `drc.json` and `board.json`, and removes `verify.json` and `order/`, which are
  of the board before (an earlier `readback.json` stays, and its `inputs` say which board it read). `distinta
  verify` writes `readback.json`, `verify.json` and `order/`; `distinta cad` writes `readback.json` too, without the
  self-test.
  - The files to make the board from: `<slug>-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`,
    `-F_Silkscreen.gto`, `-Edge_Cuts.gm1` (Gerber X2), `-PTH.drl` and `-NPTH.drl` (Excellon), and
    `<slug>-gerbers.zip`, those eight files, the one to upload to a fab. The copper layers carry the X2 netlist
    attributes (`cad/pcb.mjs`, Layers, above).
  - `<slug>.d356`: the IPC-D-356A netlist for a fab's electrical test: every pad, via and non-plated hole, a pad on
    no net as `N/C`, in inches, `UNITS CUST 0`, in the Gerbers' coordinates.
  - **The audit** (`distinta pcb`, and the first layer of `distinta verify`) is ours, at least as strict as each fab
    profile, not a fab's own check. It runs three checks:
    - Intent (`pipeline/pcb/intent.ts`): every placed footprint matches its reference (so a mirrored or moved one
      fails), each socket's A pad reaches exactly one GPIO of the Pico and no supply, control or ground pin, no GPIO
      serves two keys, each B pad reaches a GND pin, and the nets are the ones design.json's keys and `keyMap` mean,
      with nothing else joined; a socket goes on the bottom only, where its reference is drawn, and an assembly step
      that names a key on another GPIO than `keyMap` fails. A board with a Pico and no keys has no `keyMap` to hold
      its nets to, but no supply (VBUS, VSYS, 3V3(OUT), ADC_VREF) or control pin (RUN, 3V3_EN) of the Pico may be on
      its ground, and 3V3(OUT) may not be joined to VBUS or VSYS.
    - Fit (`pipeline/pcb/fit.ts`): the parts held to the params the case is built from, to 0.05 mm: the outline
      `pcbWidthMm` x `pcbHeightMm` with `pcbCornerMm` corners, socket K<n> at key n of the grid (`keyRows`,
      `keyCols`, `keyPitchMm`, `pcbEdgeToKeyMm`; numbered from the bottom left, row by row) turned 0 or 180 degrees,
      the Pico at `controllerCenterXMm`, `controllerCenterYMm` with its body `controllerLengthMm` x
      `controllerWidthMm`, and a screw hole of `screwClearanceMm` at each corner `holeInsetMm` in, with copper kept
      `bossOuterMm` / 2 from it. A part the board places whose params design.json does not give under these names
      (the ones the case and the design checks read) is an error that names them, so a param called something else
      does not leave the part unchecked; the Pico's turn, USB end to +x, is checked whatever the params. `drc.json`
      `fit` lists what it checked, and `distinta verify`'s audit line says it.
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
    - `inputs` fingerprints the board code and the modules it imports by a literal relative path (a `?query` or
      `#hash` on it dropped), the params, the keyMap and the assembly steps, the kit (with the firmware's generator
      and runner, `pipeline/firmware/` and `harness.py`, `readback.py` and `requirements.txt`), the footprint
      references, and the keys of design.json and bom.json the board code read, which `reads` lists (`{ design:
      ["assembly", "slug"], bom: [] }` for the keypad; `"*"` is a whole file). Each object's keys are taken in order,
      so params written in another order are the same board. Every later file of the board carries the same
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
      (`firmware/code.distinta.py` when `firmware/code.py` is the user's own).
    - `rules` is the rules the audit held the board to, which the read-back holds the files to.
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
    `selfTest` (with `--self-test`, as `distinta verify` runs it) puts a cut round a key's pad (or any pad on a
    shared net clear of plated drills), a sliver across a key's socket and one from the Pico's VBUS through VSYS to
    GND into copies of the files, each where the board has something to put it on, and passes only if each fails and
    an unchanged copy passes: `{ ok, ran, control: { ok, errors }, cases: [{ fault, expect, ran, ok, got }] }`. With
    no fault put in, `ran` is false: the self-test did not run, which `distinta verify` calls unverified, not
    failed, and the scorer and `distinta package` refuse the zip, saying so. `inputs` is `board.json`'s, which is `drc.json`'s, and the fingerprint covers
    `readback.py`.
  - Running `readback.py`: it prints `read-back: running on Python <version>` on stderr first, and exits 0 when every
    check passed, 1 when one failed, 2 when there are no files to read, 3 when gerbonara or shapely is missing or not
    at its pin, and 4 when the Python is older than 3.12. `distinta verify` runs it with `$DISTINTA_PYTHON`, else
    `~/.cache/distinta/venv/bin/python3` once that venv is made (in the cache `DISTINTA_CACHE` moves; a venv whose
    Python is gone is said, not passed over), else `python3`. Without that first line nothing ran it (a macOS
    `python3` stub with no developer tools, a pyenv shim with no version set), which is unverified, not failed. On
    that, 3 or 4 it prints what to do: the venv made with `--clear` (so a venv made with an older Python is made
    again, not kept) by a Python 3.12 or newer the PATH has (`python3`, else `python3.14`, `3.13` or `3.12`), or,
    with none, install one first; with `$DISTINTA_PYTHON` set, to point it at Python 3.12 or newer.
  - `verify.json`: `{ slug, inputs, status: "verified"|"failed"|"unverified", zip, order, note, layers: [{ id, title,
    checked, status: "pass"|"fail"|"not run", result, errors, fix?, blocks? }] }`.
    - `layers`, in order: `audit`, `readback` and its `self-test`; for a keypad `firmware` and `firmware-self-test`
      (`fil.json`, below) and, when `firmware/code.py` is the user's own, `your-firmware` (`blocks: false`: its
      failure is the code's, said with ⚑, and the board is verified without it); and last `order`, the hand-off. A
      layer that cannot run is `not run`, with why: the read-back without files from a passing audit, the firmware
      without a passing read-back, the order files without every other layer passed.
    - `status`: `verified` when every layer passed; `failed` when one failed; `unverified` when the read-back could
      not run (no Python 3.12+, gerbonara or shapely), its self-test could put no fault into the board, or the
      firmware could not run (CircuitPython, KMK or rp2040js neither cached nor fetched, or the emulator out of the
      computer's time), which is not a pass. `distinta verify` exits 0 when verified, 1 when failed and 2 when
      unverified, or when the product has no board (`cad/pcb.mjs`) to verify, which writes no `verify.json`.
      `distinta status` counts the file only once it says verified, and only while it is of the board in `pcb/` now
      and `distinta package` would take its zip; once the board, its zip or the kit changed it shows `(stale)`, and
      `distinta verify` is next again.
    - `order` is `{ dir: "pcb/order", fabs: [{ id, name, zip, sha256, files }], skipped: [{ id, name, why }] }`, or
      null when no order folder was written.
  - `order/`: the board ready to order by hand (`pipeline/pcb/order.ts`), written only when every other layer
    passed, into `order.part/` first and then renamed, so it is there whole or not at all, and only when bom.json's
    PCB line and design.json give one board: the same thickness (`spec.thicknessMm`, `pcbThicknessMm`), 1.6 mm, which
    every fab profile was checked for, and 2 layers. Otherwise the order layer fails and names both values.
    - `README.md`: the board's size, layers, thickness, copper and finish, its smallest features from `drc.json`
      `measured`, the fab profiles it passes with a price for each, every layer of the verification with its result
      (the firmware said to have run only when its layer passed, and the parts to lay on the prints only those the
      board places), and the board's fingerprint and the zip's sha256.
    - `order.json`: `{ inputs, zip: { name, sha256 }, texts }`, which ties the folder to the board, and `texts` the
      sha256 of what the texts take from bom.json and design.json: the thickness, the finish and how many boards.
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
      `distinta verify` reads each zip back with `readback.py`, as it read the board's own, and writes the folder only
      when every one passes.

    `distinta pcb` removes the folder, and `distinta score`, `package` and `status` remove it once its `order.json`
    is not of the board and the zip in `pcb/` now, or bom.json or design.json no longer give the quantity, thickness
    and finish its texts say. Nothing is uploaded, quoted or ordered: in every command, fetch refuses each fab's
    host and every order or payment call (`guardNetwork`).
  - What the scorer and `distinta package` take: the board's BOM line is a PCB line (`process: "pcb"`) or any line
    whose `file` is in `pcb/`, however its path is written (`./pcb/x.zip` is `pcb/x.zip`). `distinta score` counts it
    as ok only when it names the very zip the read-back read (`pcb/<slug>-gerbers.zip`, not one of that name
    elsewhere), `drc.json` has 0 errors, every net connected and an `inputs` that is still the board's, and
    `readback.json` passed (its self-test too, when it ran), carries the same `inputs` and read the zip and the
    netlist that are there now (by sha256), and no `firmware/fil.json` run of the board's own firmware failed on this
    zip (by sha256: a failure holds until the zip or the board's firmware changes, however often the board is built
    again, and a `code.py` of the user's own does not clear it; one that is missing or of other files refuses the
    scorer nothing, since the emulator is fetched once, and the detail says to run `distinta verify`). `distinta
    cad`'s read-back has no self-test, so it keeps a self-test that failed on the same zip. `distinta package` copies
    the zip only then, only when the read-back's self-test ran and passed and, for a keypad, the board's firmware
    passed on this zip and this board (a missing or stale `fil.json` refuses it, as after an UNVERIFIED verify), and
    removes one an earlier run copied.
- `firmware/` (a board with key sockets and a Pico). `code.py` and `README.md` are the product's own files, kept
  with it like `build-plan.md` (the examples ship them); `fil.json` is the report of one run on the files in `pcb/`,
  and like them this repo does not commit it.
  - `code.py` and `README.md`: written by `distinta pcb` once its audit passes (and removed when it fails). A
    `code.py` that `distinta pcb` did not write (it has no line saying so) is the user's, and stays: the board's
    firmware goes to `code.distinta.py` beside it. Whether a board has firmware is `board.json` `firmware`, not
    whether a `code.py` is there. `code.py` is KMK on CircuitPython for the Raspberry Pi Pico: a `KeysScanner` on the
    GPIO each key's socket is wired to on the routed board, in reading order (the top row first, as the keypad is
    seen from above), with the Pico's pull-ups and `value_when_pressed=False`, and a keymap of `KC.N1` to `KC.N9` for
    K1 to K9 in the same order, for the user to change to shortcuts. `README.md` says how to put it on the Pico, with
    links to the CircuitPython UF2 and the KMK commit `distinta verify` tests, and which key types what. `distinta
    package` copies both into `production/firmware/`, with the board's zip only, and only a `code.py` that is the
    one `distinta pcb` wrote for this board (`board.json` `firmwareCode`) or the user's own whose run passed on this
    zip.
  - `fil.json`: the firmware in the loop (`pipeline/firmware/fil.ts`), written by `distinta verify` and kept until
    the next run. CircuitPython 10.3.1 and KMK at a pinned commit, with the board's own firmware as `distinta pcb`
    wrote it (made again from `board.json` and held to `firmwareCode`'s sha256, so an edited `code.py` is not taken
    for it), booted in rp2040js 1.4.0, each GPIO driven by the piece of copper `readback.json`'s `nets` joins it to
    (ground, the 3V3 supply, another GPIO, or its own pull-up), each key and each pair of keys pressed. `{ inputs,
    slug, ok, note, firmware: { file, sha256 }, netlist: { file: "pcb/readback.json", zip, zipSha256, sha256 },
    tools: { circuitpython, kmk, rp2040js }, keys, checked, errors, presses: [{ keys, want, got, ok }], selfTest: {
    ok, cases: [{ fault, ok, got }] }, stats, yours? }`.
    - `firmware.file` is `firmware/code.py` or, beside the user's own, `firmware/code.distinta.py`.
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
    - `inputs` is `readback.json`'s. The emulator is fetched into `~/.cache/distinta/firmware` (`DISTINTA_CACHE` moves
      it; `DISTINTA_OFFLINE=1` fetches nothing), each file pinned by sha256 and each folder by a digest of its files.
- `shots/<name>.png`: screenshots of the figure card on `view.html`, written by `distinta shot`, for checking the
  figure.
- Written by the commands: `explorer.json` (what the website's BOM explorer shows, written by `distinta view` once
  there is a quote, with each line's `needQty`, orders A and B as `phases`, `costNotes`, and the figure's caption,
  steps and coverage as `figure`), `history/NNN.json`
  (one snapshot per run that changed something, read by `distinta diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `fab/` (STL, STEP), `previews/` (SVG), `firmware/` and
  `production/`.
