# Macro keypad: design (stage 1)

**Request:** a 3×3 USB macro keypad, nine mechanical keys, no drivers. One unit, US, $75 budget.

**Concept:** the simplest proven build. A Raspberry Pi Pico is soldered flat onto a small 2-layer PCB. Each of the nine
switches goes to its own GPIO and to ground, so there is no matrix and no diodes. Switches sit in hot-swap sockets, so
no switch is ever soldered. A two-part printed case: the top is also the switch plate.

**Architecture:** see `design.json` → `architecture`. All dimensions live in `design.json` → `params`; the CAD
(`cad/*.py` in this folder) and the engineer checks (design stage) both read them from there, so they can't drift apart.

**Stack, top down:** keycaps → switches clipped into the 1.5 mm plate → PCB top 5.0 mm below the plate top
(the MX standard) → hot-swap sockets under the PCB → 4 mm standoffs → 2 mm tray floor → rubber feet.

**Layout (PCB 61 × 94 mm):** keys on a 19.05 mm grid starting 5.4 mm from the near edge; the Pico across the top, USB
end flush with the right edge so the cable reaches it; M3 holes 3.5 mm in from each corner, kept 4 mm clear of the
Pico. The 8.4 mm insert bosses run from the PCB up to the plate beside the corner switches, so each hole centre stays
4.4 mm (boss radius plus 0.2 mm) from every switch housing; the check `holes-clear-keys` measures it. The case is
66.8 × 99.8 mm, just under the 100 mm the request allows.

**Lid over the Pico:** a 3 mm hole over the BOOTSEL button (a paperclip reflashes it without opening the case) and a
1.6 mm window over the LED. Their positions are estimates (see `design.json` → `estimates`): check them against your
Pico before printing the top.

**Changed:** the first layout had the PCB 90 mm tall with the keys 1.9 mm from its edge, which put the two near bosses
1.3 mm from the corner switches' housings, so those switches could not clip in. The board grew 4 mm and the grid
moved up 3.5 mm. The feet are Adafruit 550's real size, 8 mm across and 4 mm tall (they were 10 × 3).

**Firmware:** KMK on CircuitPython 10.3.1. `distinta pcb` writes `firmware/code.py` from the routed board, each key read on the GPIO it is wired to, and the keys type 1 to 9 until you map them to shortcuts there; the Pico shows up as a USB keyboard. `distinta verify` boots that firmware on an emulated Pico wired to the copper read back from the Gerbers and presses every key and every pair of keys.
The keys are wired to the GPIOs in the order the Pico's pads allow, not in key order (the tracks on the back cannot
cross): K1 is the bottom left key, K3 bottom right, K7 top left, K9 top right, and the board wires K1 GP10, K2 GP7,
K3 GP4, K4 GP9, K5 GP6, K6 GP3, K7 GP8, K8 GP5, K9 GP2. `cad/pcb.mjs` returns this map and warns if `design.json`'s
assembly stops giving it.

**Parts, grouped (Anatomy-style):**
- Base: tray, 4 standoffs, 4 rubber feet, 4 button-head screws
- Structure: top shell and plate, 4 insert bosses, 4 heat-set inserts, PCB
- Mechanism: 9 switches, 9 hot-swap sockets
- Controls: 9 keycaps
- Subject: the Pico and its USB port

**Figure:** `figure.mjs` draws this stack in the Anatomy style from the same `params` and the BOM specs: every part at
its real count, an apart pose that lifts each layer off along its way in, and nine assembly steps in build order
(`distinta figure macropad`, then open `view.html`). The parts the case hides (the PCB, the Pico, the sockets, the
inserts, the screws and the feet) show as dashed outlines while they are lit and something covers them.
