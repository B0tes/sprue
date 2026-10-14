# The Distinta pipeline

One request goes through seven stages. Each stage reads the previous stage's output file and writes
its own, so any stage can be rerun, inspected or replaced on its own. Outputs live in
`products/<slug>/` and are plain JSON or Markdown plus the files a fab needs.

The skill groups these into the three stages the user sees, each ending at a gate in `state.json`: **design**
(0 to 3, and the figure), **source** (4 and 5) and **build** (6). `skills/distinta/reference/run.md` is the run as
the skill does it; the numbers here are only this page's.

| # | Stage | Input | Output | Done when |
| --- | --- | --- | --- | --- |
| 0 | **Request** | A chat message | `request.json`: what it does, quantity, budget, region, hard constraints | Every constraint is a field, not prose |
| 1 | **Design** (Anatomy skill + CAD) | `request.json` | `figure.mjs`, drawn at the top of `view.html` (an Anatomy-style interactive exploded view of the real product, at true size), `design.md` (architecture, grouped parts list), CAD in `cad/` (a circuit board as `cad/pcb.mjs`) | Parts and how they connect are named, with real dimensions |
| 2 | **Decompose** | design | `bom.json`: every part with spec, quantity, process (buy, PCB, print, CNC, sheet) | Nothing in the design is missing from the BOM |
| 3 | **Engineer check** | `bom.json` + design | `checks.json`: power budget, voltages, pin and footprint fit, mechanical fit, standards | Every check passes or is flagged with a reason |
| 4 | **Source** | `bom.json` | `sourcing.json`: real SKU per line, stock, price breaks, alternates | Every buy line has an in-stock SKU |
| 5 | **Quote** | sourcing + fab files | `quotes.json`: price and lead per line, with quote mode (API, scripted, agent RFQ) | Every line has a price with its source |
| 6 | **Build plan** | everything above | `build-plan.md`: assembly steps, tools, firmware, test plan, total cost and lead time | Someone could order and assemble from it |

## Stage 1 and the Anatomy skill

[Anatomy](https://skills.wheresryan.sh/anatomy), by Ryan, is MIT licensed. The skill bundles its drawing kit, copied unchanged, in
`skills/distinta/kit/` (with Anatomy's notes in `reference/anatomy/`, both listed in the skill's `NOTICE`), and
stage 1 always draws the figure on `view.html` with it. The user doesn't need Anatomy installed. Anatomy draws a technical idea
as a detailed, interactive isometric machine: it writes a grouped parts list first (base, structure, mechanism, controls,
subject), drives the drawing from a model of real numbers, and audits that nothing passes through anything and every part
sits on another. That is most of what stage 1 needs, with one change:

- **Anatomy invents a machine to explain a concept. Distinta draws the real product.** The request says
  "draw the actual 3×3 keypad, exploded, at true dimensions" instead of "explain X". Every part in the figure must be
  a part someone can buy or make.
- Anatomy's parts list and world-unit plan become the first draft of `bom.json` (stage 2 in this table; all of
  it is in the skill's design stage).
- The figure is illustration geometry, not manufacturing geometry. Real parts that get fabricated (case, plate, PCB)
  are also written as CAD code in `cad/` (the PCB as `cad/pcb.mjs`, which writes Gerbers), and stage 3 checks that both agree on sizes.
- The figure is what a user sees first, and it doubles as the live picture on the landing page.

## How we know it works

Each reference product has a known-good real-world version. The pipeline's output is scored against it:

- **BOM coverage:** share of the reference's functional parts the pipeline also chose (or a valid equivalent).
- **Checks:** zero failed engineering checks that the reference passes.
- **Cost:** total within ±25% of what the reference costs to build from parts.
- **Files:** STLs are manifold and the CAD parts fit together. A board's zip counts only once `distinta verify`'s
  read-back has passed it (below), and not after a run of its firmware on it failed. The fab's own review is still
  ahead of an order.

A product "graduates" when it scores well on all four in two runs in a row. Then we move up the ladder.

## How a board is proven

A circuit board is the one part whose faults can't be seen by looking at its files: a swapped pin or a sliver of
copper looks like any other line in a Gerber. So the board goes through layers of checks, each catching what the ones
before it cannot. `distinta pcb` runs the first three with nothing but Node; `distinta verify` runs them all, and
only a board that passes every one gets `pcb/order/`. The research behind it, with its sources and the faults that
shaped each check, is `research/pcb-verification.md`.

| # | Layer | What runs | It catches | Status |
| --- | --- | --- | --- | --- |
| 1 | Intent | `pipeline/pcb/intent.ts`: each footprint against its sources' own numbers (`pcb/fixtures/footprint-refs.json`), the nets against `design.json`'s keys and `keyMap` | a mirrored or moved part, a dead key, a key on the wrong pin or on a supply or control pin | built |
| 2 | Fit | `pipeline/pcb/fit.ts`: the parts against the params the case is built from | a part moved in `pcb.mjs` alone | built |
| 3 | DRC | `pipeline/pcb/drc.ts`, at least as strict as JLCPCB, PCBWay, OSH Park and Aisler (`rules.ts`), with connectivity read from the shapes written | clearances, widths, rings, holes, thermal spokes, silkscreen, opens and shorts in our own shapes | built |
| 4 | Read-back | `pipeline/pcb/readback.py`: gerbonara and shapely read the zip and the `.d356`, and a self-test puts three faults into copies | what our writer got wrong: opens, shorts, sizes, the mask, drills, the outline, statements a fab's CAM would apply | built |
| 5 | Firmware in the loop | `pipeline/firmware/`: CircuitPython and KMK boot the board's `code.py` on rp2040js, wired to the copper read back; every key and pair pressed; a self-test | firmware and copper that disagree, a key that reads held | built |
| 6 | Order files | `pipeline/pcb/order.ts`: a zip per fab in its own names and drill format, each read back | a layer under the wrong name, a drill file in the wrong format or unit | built |
| 7 | KiCad cross-check | KiCad's DRC and netlist on a `.kicad_pcb` we write, not blocking at first | a rule we got wrong, by a second DRC | not built |
| 8 | Mechanical cross-check | the placed holes against the build123d case itself, not only the params they share | case and board that agree on paper and not as solids | not built |
| 9 | The real board | a 1:1 print with a real Pico and socket on it, the fab's own review, then the first boards | everything above is a model | by hand, with Tobias's OK |

The checks are ours, not a fab's, and the firmware runs on an emulator, not on a board. Nothing is uploaded, quoted
or ordered: `ORDER.md` in each fab's folder ends at a STOP line for the user.

## Reference ladder

Simple first, each rung adds one new kind of difficulty:

1. **3×3 USB macro keypad.** Plug-in module (RP2040 board), 9 key switches, a simple PCB, a 3D printed case. Low voltage, no moving parts, and hundreds of working open designs to compare against. Exercises every stage once.
2. **Ponder tutor desk device.** Adds a camera, audio, quantity pricing (20 to 50 units), a bent or CNC neck and children's-product rules. Notes in `research/ponder-hardware-notes.md`.
3. **USB-C desk lamp.** Adds an LED driver, heat and a hinge.
4. **Kitchen scale.** Adds a sensor (load cell), calibration and a display.
5. **Self-watering planter.** Adds a pump, water and a sealed enclosure.
6. **Single-cup pour-over coffee machine.** Adds mains power, heat, food-safe parts and certification.
