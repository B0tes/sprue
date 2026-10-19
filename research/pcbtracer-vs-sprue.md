# PCB Tracer and Sprue, and where a new product breaks Sprue

2026-10-19. Tobias asked what we think of https://pcbtracer.com/, how much of it Sprue already does, what to improve next, and whether to run a whole new product through Sprue to see where it breaks.

## Short answer

- **PCB Tracer runs the other way from Sprue.** It starts from a board someone else made (two photos) and works back to a netlist, schematic and BOM. Sprue starts from an idea and works forward to a board, a case and a priced order. They meet only at the netlist and the BOM, and there Sprue already does more: its netlist is proven against the shipped copper four ways and its BOM is priced from real offers.
- **What is worth taking from it is the bench side,** which Sprue has nowhere yet: a part built from its datasheet, a drawn schematic, expected multimeter readings for bring-up, and a place to log what was measured.
- **Yes, run a new product end to end.** A quick dry probe already shows the first breaks. The worst are silent: a board was VERIFIED with its sensor wires swapped and connected to nothing, and an Italian order was priced as a US one. The full run should be blind, graded against an answer key written beforehand from real products. I suggest a desk CO2 monitor.

## What PCB Tracer is

- A free, closed-source browser app (Chrome, Edge, Brave or Opera on a desktop) by Philip Giacalone. First video October 2025; it took off after Hackaday's article on 2026-02-23 (https://hackaday.com/2026/02/23/x-ray-a-pcb-virtually/).
- You lay the top and bottom photos over each other and trace vias, pads, tracks and parts by hand. The developer says AI can't yet trace boards from photos reliably (EEVblog, 2026-02-10).
- AI is opt-in, and the user pays the AI company (about $0.50 per schematic, per Hackaday). Users' project files show Gemini 2.5 Flash; the schematic beta needed Claude Opus 4.6. AI names nets, builds a chip's pin list from its datasheet, guesses chips from their markings, writes a circuit explanation, suggests troubleshooting, and draws an SVG or KiCad schematic.
- It also predicts the multimeter reading between two points (Modified Nodal Analysis) so you can compare with your probe.
- A paid Pro version (any number of layers) is planned; today it handles 2- and 4-layer boards. Open alternatives exist: PCB ReTrace (AGPL, exports KiCad and SPICE) and PCB-RevEng.

## How much of it Sprue already has

| PCB Tracer feature | Sprue today |
| --- | --- |
| Netlist with named nets | **Has, stronger.** Designed in `cad/pcb.mjs`, then checked by our DRC, a read-back of the shipped zip, KiCad's own netlist (129 of 129 records match) and the firmware on an emulated Pico. Only the keypad's nets are held to an intended circuit, though (see below). |
| BOM | **Has, stronger.** Real offers, packs, shipping and shop choice. It lacks designators (U1, K1) and packages, and only 2 of the keypad's 11 lines carry a maker part number. |
| Every pad has an ID and a net | **Has the data,** but no way to point at a pad on a picture and read its pin and net. |
| Part library | **Partial: 2 footprints** (Pico and Kailh socket). The main limit on any second board. |
| Chip from its datasheet | **Partial: by hand.** Claude copies numbers into `bom.json`; there is no reusable part file. |
| Expected meter readings | **Partial:** typed by hand in Ponder's build plan; nothing for the keypad, nothing computed. |
| Troubleshooting | **Partial:** the emulator already turns copper faults into symptoms ("GP5 reads pressed all the time"), but nothing reaches the build plan. |
| Circuit explanation | **Partial:** `design.md` explains the design Sprue made. |
| Schematic (SVG or KiCad) | **None.** No schematic or wiring diagram of any kind. Ponder's hand-wired harness exists only as sentences. |
| Log of test readings | **None.** Ponder's test sheet says to write results "in the build log", which doesn't exist. |
| Autosave and history | **Partial:** cost history and `sprue diff`; the design itself is only versioned if committed. |
| Photo overlay, hand annotation, identifying chips by their markings | **Doesn't apply:** Sprue chose the parts, so it never has to read an unknown board. |

## What to take from it, in order

1. **A part contract built from the datasheet** (`parts/<mpn>.json`): pins, power and limits, each number tagged with its datasheet page, and the pinout held to a second source (the maker's footprint or STEP), as Sprue already does for the Pico. A footprint generator reads it. This removes the two-footprint limit and is already in PLAN as "Part swaps".
2. **The intended circuit as data,** separate from the board code, with a schematic drawn from it by code, not AI. Today only a keypad's copper is held to what the design asked for.
3. **A bring-up sheet for the keypad's first boards,** generated from the verified netlist: which pads should beep to which, what must not be shorted, the voltages once powered. Add a file per built unit to record readings next to the expected values. This is cheap and matters the day the boards arrive.
4. **Troubleshooting computed by the emulator:** plant the likely solder faults (a dry socket joint, two Pico pads bridged) and list what the keyboard does for each. For the keypad this is only about nine rows, so it is a small add-on to item 3.

Not worth taking: photo alignment, hand annotation, chip identification, AI-written circuit reports, AI net names.

## Where a new product breaks Sprue today

A worker tried a USB CO2 monitor in a scratch copy of the repo: Pico, an I2C CO2 sensor on a Qwiic cable, an OLED, a PETG case, an aluminium plate, region IT. Nothing in the real repo was touched.

| Stage | What happened | How bad |
| --- | --- | --- |
| Design checks | 7 of the 8 built-in checks that ran failed with "Can't run", because they are keypad rules. The USB power check passed while ignoring the sensor's and the screen's current. | Wrong answer, silently |
| Board | `sprue pcb` stopped at the first part that isn't a Pico or a Kailh socket: `no footprint "jst-sh-4-qwiic"`. | Blocks the run |
| Board proof | A Pico-only board with the sensor's two data lines swapped and connected to nothing was **VERIFIED**, and order folders were written for four fabs. Nothing holds a board without keys to the circuit the design asked for. | Wrong answer, silently |
| Firmware | Only keypads get firmware, and only on a Pico. The build plan had no software step at all. | Wrong answer, silently |
| Sourcing and quote | Region IT was ignored: everything was priced in USD with US shipping. The aluminium plate couldn't be priced, so it was left out of the total and the budget check. | Wrong answer, silently |
| Score and seeded faults | Neither does anything until someone writes an answer key and a fault list for the product. | Manual work |
| Figure and whole-product check | Both are drawn by hand per product (the keypad's figure is 552 lines, Ponder's 1,312). | Manual work |

The pattern is that **the arithmetic is generic** (state and gates, packs and shipping, print pricing, CAD export, the board back end, the fault runner) **and the judgement is not**: the checks, the board's circuit and the firmware are keypad-shaped, and for anything else Claude writes them by hand with nothing checking them.

## The run I'd do

- **Product:** a desk CO2 monitor (one line: "A desk CO2 monitor with a small screen and a light that goes green to red, powered by USB"). It is simple and already solved, and it brings a sensor, a display, a different microcontroller, airflow through the case and real electrical traps. It is not another keypad.
- **Answer key first, from several real monitors,** not one: Curious Electric's CO2 Monitor (GBP 45 kit), KnowCO2 (OSHWA-certified, about USD 87 in parts), Watterott's CO2-Ampel (from EUR 81, Germany) and the AirGradient ONE (USD 138 kit). Roles, a cost band in EUR and trap requirements only, with links; no copied files. Example traps: a 5 V sensor with 3.3 V logic, LED current that the USB budget must cover, the sensor kept away from the board's heat, vents for airflow.
- **Blind:** a fresh agent gets only the one line and the installed skill, in a copy of the repo without the answer key, and runs all three stages as a user's Claude would. Every place it is blocked, improvises or gets a wrong answer through is logged by stage.
- **Graded** against the key, with a report of breaks ranked by harm. The fixes become PLAN items, and the product joins the examples as rung 3.
- **Cost:** tokens only. Nothing is ordered, and no fab is quoted or uploaded to.

**Done, 2026-10-19:** see `evals/ideas/runs/2026-10-19-co2-monitor/README.md`.

## Sources

- PCB Tracer: https://pcbtracer.com/; EEVblog thread https://www.eevblog.com/forum/repair/pcb-tracer-sw-designed-to-reverse-engineer-troubleshoot-and-repair-pcbs/; Hackaday https://hackaday.com/2026/02/23/x-ray-a-pcb-virtually/; Ko-fi https://ko-fi.com/pcbtracer
- Open alternatives: https://github.com/dev-lab/pcb-retrace, https://github.com/gamerpaddy/PCB-RevEng
- Datasheet-to-part tools for item 1: kicad-happy's datasheets skill (https://github.com/aklofas/kicad-happy, MIT), datasheet-cli (https://github.com/akiselev/datasheet-cli, GPL-3.0)
- CO2 monitors for the answer key: https://www.curiouselectric.co.uk/products/co2-monitor, https://certification.oshwa.org/us002828.html, https://shop.watterott.com/CO2-Ampel-pro_2, https://www.airgradient.com/documentation/one-v9/
- Repo evidence: `skills/sprue/pipeline/pcb/footprints.ts:193-196` (two footprints), `pcb/intent.ts:122-142` (no keys, no circuit check), `firmware/code.ts:23-31` (keypad-only firmware), `stages/check.ts:262-269` (USB power counts only the controller), `types.ts:77` (prices in USD only), `adapters/fab.ts:103-107` (no CNC or sheet quotes)
