# Macro keypad: design (stage 1)

**Request:** a 3×3 USB macro keypad, nine mechanical keys, no drivers. One unit, US, $75 budget.

**Concept:** the simplest proven build. A Raspberry Pi Pico is soldered flat onto a small 2-layer PCB. Each of the nine
switches goes to its own GPIO and to ground, so there is no matrix and no diodes. Switches sit in hot-swap sockets, so
no switch is ever soldered. A two-part printed case: the top is also the switch plate.

**Architecture:** see `design.json` → `architecture`. All dimensions live in `design.json` → `params`; the CAD
(`cad/parts/macropad_*.py`) and the engineer checks (stage 3) both read them from there, so they can't drift apart.

**Stack, top down:** keycaps → switches clipped into the 1.5 mm plate → PCB top 5.0 mm below the plate top
(the MX standard) → hot-swap sockets under the PCB → 4 mm standoffs → 2 mm tray floor → rubber feet.

**Layout (PCB 61 × 90 mm):** keys on a 19.05 mm grid in the lower 61 mm; the Pico across the top, USB end flush with
the right edge so the cable reaches it; M3 holes 3.5 mm in from each corner, kept 4 mm clear of everything.

**Firmware:** KMK on CircuitPython. Each key maps to a shortcut in `code.py`; the Pico shows up as a USB keyboard.

**Parts, grouped (Anatomy-style):**
- Base: tray, 4 standoffs, 4 rubber feet, 4 button-head screws
- Structure: top shell and plate, 4 insert bosses, 4 heat-set inserts, PCB
- Mechanism: 9 switches, 9 hot-swap sockets
- Controls: 9 keycaps
- Subject: the Pico and its USB port

**Figure:** the Anatomy exploded view of this stack is the next backlog item (`figure/`).
