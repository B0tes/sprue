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
  reads of `design` and `bom` change). Millimetres, the
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
- `pcb/` (written by `distinta pcb`, git-ignored; nothing in it is edited by hand):
  `<slug>-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`, `-F_Silkscreen.gto`, `-Edge_Cuts.gm1` (Gerber X2),
  `-PTH.drl` and `-NPTH.drl` (Excellon), `<slug>-gerbers.zip` (those eight files, the one to upload to a fab),
  `<slug>.d356` (the IPC-D-356A netlist for a fab's electrical test: every pad, via and non-plated hole, a pad on no
  net as `N/C`, in inches, `UNITS CUST 0`, in the Gerbers' coordinates), `board.json`, `readback.json` and
  `verify.json` (below, written by `distinta verify` and `distinta cad`) and
  `drc.json`: `{ inputs, reads, rules: { name: { value, note } }, errors: [string], warnings: [string], nets: { "<net>":
  { pads: [string], connected } }, pinMap, intent, measured, fabs, stats }`; `inputs` fingerprints the board code,
  the params, the keyMap, the kit, the footprint references, and the keys of design.json and bom.json the board code
  read, which `reads` lists (`{ design: ["assembly", "slug"], bom: [] }` for the keypad; `"*"` is a whole file).
  `intent` is the circuit design.json means, `{ controller, keys: { "<key>": { gpio, pin } }, ground: { pads, pins } }`
  (null when it could not be built), by the reference's pin numbers. `measured` is the board's smallest of each
  feature a fab limits, `{ "<feature>": { mm, at } }` (the narrowest copper, the closest two nets, the smallest via
  ring, and so on, with where it is), and `fabs` holds it to each profile: `{ jlcpcb: { name, ok, why: [string] },
  pcbway, oshpark, aisler }`, `why` saying which feature is outside that fab's limit.
  `board.json` is the board as drawn, for the read-back of the written files: `{ inputs, slug, frame, board: { width,
  height, corner, outline }, files: { "F.Cu": "<slug>-F_Cu.gtl", ..., PTH, NPTH, netlist, zip }, pads: [{ id, ref, num,
  name, kind, mustConnect, net, x, y, w, h, shape, layers, drill }], vias, drills: { plated, nonPlated }, pours, nets:
  { "<net>": [pad id] }, singles, intent, intended, firmware }`, where `nets` is what the board code drew (a pad on no net is a
  net of its own) and `intended` the netlist design.json means: `[{ net, pads, anyOf? }]`, each key's A pad with its
  GPIO pin, and the ground (every B pad with at least one of the controller's ground pins, `anyOf`); a controller or
  socket pad listed nowhere is meant to be joined to nothing. `firmware` is the keys the firmware reads, `[{ key,
  gpio, row, col, kc, code }]` (each socket, the Pico GPIO its A pad is wired to, its row from the top and column
  from the left, its KMK key name and HID usage code), or null for a board without keys.
  The audit is ours, at least as strict as each fab profile, not a fab's own check. It starts with the intent check
  (`pipeline/pcb/intent.ts`): every placed footprint matches its reference (so a mirrored or moved one fails), each
  socket's A pad reaches exactly one GPIO of the Pico and no supply, control or ground pin, no GPIO serves two keys,
  each B pad reaches a GND pin, and the nets are the ones design.json's keys and `keyMap` mean, with nothing else
  joined. It checks clearances, widths, edges,
  holes, thermal spokes and silkscreen on the geometry, then reads connectivity back from the very shapes written
  to the Gerbers: every net in one piece, no two nets touching, every netted pad reached, every thermally relieved pad
  reaching the pour by at least 2 spokes, no neck of pour thinner than the minimum (a track's width is checked on the
  track). Each written Gerber is read back as a Gerber reader would and must print exactly those shapes with those
  netlist attributes, and the `.d356` must read back as exactly the board's pads, vias and holes. With any error,
  and when the board code throws or the router finds no way, the zip, the Gerbers and the netlist are not written
  (old ones are removed) and `drc.json` says why. `previews/pcb-top.svg` and `pcb-bottom.svg` (the bottom mirrored and labelled)
  show the board as the files draw it and are committed.
  `readback.json` is the read-back of the shipped files (`pipeline/pcb/readback.py`, Python 3.12+ with gerbonara
  1.6.3 and shapely 2.2.0 from `pipeline/pcb/requirements.txt`, run with `-I`): another reader than our writer reads
  only the zip's Gerbers and drill files and the `.d356`, with `board.json` for where the pads are and the intended
  netlist. `{ inputs, slug, ok, files: { zip: { name, sha256, files }, netlist: { name, sha256 } }, tools, checks:
  [{ id, checked, ok, errors }], errors, warnings, nets: { "<net>": [pad id] }, stats, selfTest? }`. The checks:
  `files` (the zip holds exactly the files `board.json` lists, each Gerber's `%TF.FileFunction%` matches its
  extension and each drill file's its PTH or NPTH name, each file states its unit once, the Excellon parses);
  `outline` (exactly one closed outline, of the board's size, no copper past it); `drills` (the drill files hold
  exactly the board's holes); `copper` (each layer painted in file order, the non-plated holes punched out, the
  islands joined where a plated drill lands; every pad has copper at its centre and a mask opening); `intent` (the
  netlist that copper makes against `intended`: OPEN, SHORT, a controller or socket pad listed nowhere being a net
  of its own); `netlist` (the `.d356` read by gerbonara: every pad, via and hole where the board has it, on its net,
  and the copper joining exactly what it says); `x2` (each copper object's `%TO.N` is the net its copper joins, each
  pad has its `%TO.P` flash; gerbonara keeps no attributes on regions, so the pour's go unchecked). `nets` is the
  extracted netlist, each piece of copper with two or more pads, named by the net design.json means for them (two
  names joined by `+` for a short). `selfTest` (with `--self-test`, as `distinta verify` runs it) puts a cut round
  a key's pad, a sliver across a key's socket and one from VBUS through VSYS to GND into copies of the files, and
  passes only if each fails and an unchanged copy passes: `{ ok, control: { ok, errors }, cases: [{ fault, expect,
  ran, ok, got }] }`. `inputs` is `board.json`'s, which is `drc.json`'s, and the fingerprint covers `readback.py`.
  `verify.json`: `{ slug, inputs, status: "verified"|"failed"|"unverified", zip, note, layers: [{ id, title, checked,
  status: "pass"|"fail"|"not run", result, errors, fix? }] }`, one layer each for the audit, the read-back and its
  self-test, and for a keypad `firmware` and `firmware-self-test` (below); `unverified` means the read-back could not
  run (no Python 3.12+, gerbonara or shapely), or the firmware could not (CircuitPython, KMK or rp2040js neither
  cached nor fetched), which is not a pass. `distinta verify` exits 0 when verified, 1 when a layer failed and 2
  when unverified.
  `distinta score` counts a BOM line whose `file` is a `.zip` under `pcb/` as ok only when `drc.json` has 0 errors,
  every net connected and an `inputs` that is still the board's, and `readback.json` passed (its self-test too, when
  it ran), carries the same `inputs` and read the zip and the netlist that are there now (by sha256), and no
  `firmware/fil.json` of this board, this `code.py` and this read-back failed (one that is missing or of an earlier
  run refuses nothing, since the emulator is fetched once, and the detail says to run `distinta verify`); `distinta
  package` copies the zip only then, and removes one an earlier run copied.
- `firmware/` (a board with key sockets and a Pico; nothing in it is edited by hand): `code.py` and `README.md`,
  written by `distinta pcb` once its audit passes (and removed when it fails), and `fil.json` (git-ignored), written
  by `distinta verify`. `code.py` is KMK on CircuitPython for the Raspberry Pi Pico: a `KeysScanner` on the GPIO
  each key's socket is wired to on the routed board, in reading order (the top row first, as the keypad is seen from
  above), with the Pico's pull-ups and `value_when_pressed=False`, and a keymap of `KC.N1` to `KC.N9` for K1 to K9 in
  the same order, for the user to change to shortcuts. `README.md` says how to put it on the Pico, with links to
  the CircuitPython UF2 and the KMK commit `distinta verify` tests, and which key types what. `distinta package`
  copies both into `production/firmware/`.
  `fil.json` is the firmware in the loop (`pipeline/firmware/fil.ts`): CircuitPython 10.3.1 and KMK at a pinned
  commit, with `code.py` as it is, booted in rp2040js 1.4.0, each GPIO driven by the piece of copper
  `readback.json`'s `nets` joins it to (ground, the 3V3 supply, another GPIO, or its own pull-up), each key and each
  pair of keys pressed. `{ inputs, slug, ok, note, firmware: { file, sha256 }, netlist: { file: "pcb/readback.json",
  zip, sha256 }, tools: { circuitpython, kmk, rp2040js }, keys, checked, errors, presses: [{ keys, want, got, ok }],
  selfTest: { ok, cases: [{ fault, ok, got }] }, stats }`. A press passes when the keyboard reports exactly the
  keycodes `want` (HID usage codes) and then nothing once the keys are let go, and with no key pressed it must
  report nothing; an error names the key and what the copper does there. `selfTest` puts into the read-back's
  netlist a key's GPIO joined to ground, two keys swapped and two keys' GPIOs joined, and passes only if each makes
  a key come out wrong. `inputs` is `readback.json`'s. The emulator is fetched into `~/.cache/distinta/firmware`
  (`DISTINTA_CACHE` moves it; `DISTINTA_OFFLINE=1` fetches nothing), each file pinned by sha256 and each folder by
  a digest of its files.
- `shots/<name>.png`: screenshots of the figure card on `view.html`, written by `distinta shot`, for checking the
  figure.
- Written by the commands: `explorer.json` (what the website's BOM explorer shows, written by `distinta view` once
  there is a quote, with each line's `needQty`, orders A and B as `phases`, `costNotes`, and the figure's caption,
  steps and coverage as `figure`), `history/NNN.json`
  (one snapshot per run that changed something, read by `distinta diff`), `view.html`, `checks.json`, `sourcing.json`,
  `quotes.json`, `build-plan.md` (Markdown), `score.json`, `fab/` (STL, STEP), `previews/` (SVG), `firmware/` and
  `production/`.
