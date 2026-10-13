# The Anatomy 2.0 pipeline

One request goes through seven stages. Each stage reads the previous stage's output file and writes
its own, so any stage can be rerun, inspected or replaced on its own. Outputs live in
`products/<slug>/` and are plain JSON or Markdown plus the files a fab needs.

| # | Stage | Input | Output | Done when |
| --- | --- | --- | --- | --- |
| 0 | **Request** | A chat message | `request.json`: what it does, quantity, budget, region, hard constraints | Every constraint is a field, not prose |
| 1 | **Design** (Anatomy skill + CAD) | `request.json` | `figure/` (Anatomy's interactive exploded view of the real product, at true size), `design.md` (architecture, grouped parts list), CAD in `cad/` | Parts and how they connect are named, with real dimensions |
| 2 | **Decompose** | design | `bom.json`: every part with spec, quantity, process (buy, PCB, print, CNC, sheet) | Nothing in the design is missing from the BOM |
| 3 | **Engineer check** | `bom.json` + design | `checks.json`: power budget, voltages, pin and footprint fit, mechanical fit, standards | Every check passes or is flagged with a reason |
| 4 | **Source** | `bom.json` | `sourcing.json`: real SKU per line, stock, price breaks, alternates | Every buy line has an in-stock SKU |
| 5 | **Quote** | sourcing + fab files | `quotes.json`: price and lead per line, with quote mode (API, scripted, agent RFQ) | Every line has a price with its source |
| 6 | **Build plan** | everything above | `build-plan.md`: assembly steps, tools, firmware, test plan, total cost and lead time | Someone could order and assemble from it |

## Stage 1 and the Anatomy skill

[Anatomy](https://skills.wheresryan.sh/anatomy) is vendored in `plugin/skills/anatomy/` (MIT). It draws a technical idea
as a detailed, interactive isometric machine: it writes a grouped parts list first (base, structure, mechanism, controls,
subject), drives the drawing from a model of real numbers, and audits that nothing passes through anything and every part
sits on another. That is most of what stage 1 needs, with one change:

- **Anatomy invents a machine to explain a concept. Anatomy 2.0 draws the real product.** The request says
  "draw the actual 3×3 keypad, exploded, at true dimensions" instead of "explain X". Every part in the figure must be
  a part someone can buy or make.
- Anatomy's parts list and world-unit plan become the first draft of `bom.json` (stage 2).
- The figure is illustration geometry, not manufacturing geometry. Real parts that get fabricated (case, plate, PCB)
  are also written as CAD code in `cad/` and as a PCB, and stage 3 checks that both agree on sizes.
- The figure is what a user sees first, and it doubles as the live picture on the landing page.

## How we know it works

Each reference product has a known-good real-world version. The pipeline's output is scored against it:

- **BOM coverage:** share of the reference's functional parts the pipeline also chose (or a valid equivalent).
- **Checks:** zero failed engineering checks that the reference passes.
- **Cost:** total within ±25% of what the reference costs to build from parts.
- **Files:** Gerbers pass the fab's DRC, STLs are manifold, CAD parts fit together.

A product "graduates" when it scores well on all four in two runs in a row. Then we move up the ladder.

## Reference ladder

Simple first, each rung adds one new kind of difficulty:

1. **3×3 USB macro keypad.** Plug-in module (RP2040 board), 9 key switches, a simple PCB, a 3D printed case. Low voltage, no moving parts, and hundreds of working open designs to compare against. Exercises every stage once.
2. **Ponder tutor desk device.** Adds a camera, audio, quantity pricing (20 to 50 units), a bent or CNC neck and children's-product rules. Notes in `research/ponder-hardware-notes.md`.
3. **USB-C desk lamp.** Adds an LED driver, heat and a hinge.
4. **Kitchen scale.** Adds a sensor (load cell), calibration and a display.
5. **Self-watering planter.** Adds a pump, water and a sealed enclosure.
6. **Single-cup pour-over coffee machine.** Adds mains power, heat, food-safe parts and certification.
