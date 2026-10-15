# Build plan: 3x3 USB macro keypad

> I want a small 3x3 USB macro keypad for my desk: nine mechanical keys I can map to shortcuts, plugs into my laptop over USB, no drivers.

**1 unit · $92.29 for parts, fab and estimated shipping · longest lead 12 days**
Budget $75.00: OVER budget.

## What it is
Raspberry Pi Pico soldered flat to a 2-layer PCB with 9 Kailh hot-swap sockets for MX switches, directly wired to 9 GPIOs. Two-part 3D printed case: the top doubles as the switch plate, the bottom tray holds the PCB on standoffs. Four M3 screws into heat-set inserts.

## Order list
The whole batch as one order. Need is pieces, spares included; Buy is what goes in the cart.

| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Pico | PiShop.us | 1432 Raspberry Pi Pico | 1 | 1 | $3.95 | 5 d | Snapshot (price read from the product page) |
| MX-compatible mechanical switch | Adafruit | 4955 Kailh Clicky White | 9 | 1 x pack of 10 (10 pcs) | $6.95 | 5 d | Snapshot (price read from the product page) |
| Kailh MX hot-swap socket | Adafruit | 4958 | 9 | 1 x pack of 20 (20 pcs) | $4.95 | 5 d | Snapshot (price read from the product page) |
| 1u keycap, MX stem | Adafruit | 4997 DSA blank | 9 | 1 x pack of 10 (10 pcs) | $5.95 | 5 d | Snapshot (price read from the product page) |
| M3 heat-set insert | Adafruit | 4255 M3 x 4 mm brass inserts | 4 | 1 x pack of 50 (50 pcs) | $5.95 | 5 d | Snapshot (price read from the product page) |
| M3 x 8 button head screw | Bolts and Nuts | M3C08BSHCSA4/D M3-0.50 x 8 button head | 4 | 4 | $0.44 | 5 d | Snapshot (price read from the product page) |
| Adhesive rubber foot | Adafruit | 550 | 4 | 1 x pack of 4 (4 pcs) | $0.95 | 5 d | Snapshot (price read from the product page) |
| USB micro-B cable, 1 m | Adafruit | 592 USB A to micro-B, 1 m | 1 | 1 | $2.95 | 5 d | Snapshot (price read from the product page) |
| Keypad PCB | JLCPCB | 2-layer 61x94 mm, 5 pcs | 1 | 5 | $17.00 | 12 d | Scripted (published rule) |
| Case top / switch plate | Craftcloud | top.stl, PETG | 1 | 1 | $6.00 | 10 d | Estimate (unverified rate) |
| Case bottom tray | Craftcloud | bottom.stl, PETG | 1 | 1 | $6.00 | 10 d | Estimate (unverified rate) |
| Shipping (PiShop.us) | PiShop.us | shipping | – | 1 | $6.00 | – | Estimate |
| Shipping (Adafruit) | Adafruit | shipping | – | 1 | $6.00 | – | Estimate |
| Shipping (Bolts and Nuts) | Bolts and Nuts | shipping | – | 1 | $8.95 | – | Estimate |
| Shipping (Craftcloud) | Craftcloud | shipping | – | 1 | $10.25 | – | Estimate |

## Engineer checks (0 failed, 1 flagged)
| | Check | Result |
| --- | --- | --- |
| ✓ | Every part the design needs is in the BOM | All required roles present |
| ✓ | Switches, sockets and keycaps match the key grid | 9 keys; switches 9, keycaps 9, sockets 9 |
| ✓ | Controller has a free GPIO for every directly wired key | 9 keys need 9 GPIO; 26 available |
| ✓ | Power draw fits the USB budget | 25 mA typical (x2 margin) vs 500 mA from USB 2.0 |
| ✓ | Plate matches the MX switch standard | Cutout 14 mm (14.0), plate 1.5 mm (1.5), plate top to PCB top 5 mm (5.0) |
| ✓ | Key grid fits on the PCB | Grid 57.15 x 57.15 mm: 1.92 mm to each side edge, 5.4 mm to the near edge, 31.45 mm left beyond it |
| ✓ | Controller fits beside the keys and clear of screw holes | Controller y 16.0..37.0 (keys end at 15.55), x -20.5..30.5, holes clear (keep-out 4 mm) |
| ✓ | USB plug can seat through the case wall | Port 2.9 mm behind the outer wall, so the plug's overmold must enter the opening: opening 12 x 8.5 mm vs overmold 11 x 8 mm |
| ✓ | Lid clears the controller and its USB connector | Cavity 4.0 mm over a 3.8 mm tall controller: 0.20 mm clear |
| ✓ | Hot-swap sockets clear the tray floor | 4 mm standoffs, 1.85 mm sockets: 2.15 mm clear |
| ✓ | Screws reach the inserts without bottoming out | Counterbored head, 5.95 mm to the insert, 2.05 mm of thread engaged (insert 4 mm) |
| ✓ | Heat-set inserts fit inside the bosses with a closed top | 4 mm insert in a 5 mm boss leaves 1.0 mm on top |
| ✓ | Screw bosses clear the switch housings | Nearest hole centre 4.53 mm from a switch housing; the 8.4 mm boss needs 4.40 mm |
| ✓ | Rubber feet keep screw heads off the desk | Heads 0.00 mm proud of the floor (1.65 mm heads in 1.65 mm counterbores); 4 mm feet leave 4.00 mm to the desk |
| ⚑ | Regulatory standards | A USB keyboard is an unintentional radiator: selling it in the US needs FCC Part 15B (EU: CE, EMC directive). Building one for yourself needs nothing. Using a pre-certified Pico doesn't cover the finished product. |

## Assembly
1. Order the PCB (Gerbers in pcb/) and the two case prints (fab/top.stl and fab/bottom.stl, PETG, 0.2 mm layers, top printed plate-down).
2. Solder the 9 hot-swap sockets onto the back of the PCB while it is bare and lies flat, face down.
3. Turn it face up (it rests level on its sockets) and solder the Pico flat onto the PCB by its castellated edges, USB end flush with the right edge.
4. Flash the Pico: hold BOOTSEL, plug it in, copy CircuitPython onto the RPI-RP2 drive, then KMK onto CIRCUITPY. Unplug. (Later, the small hole in the lid reaches BOOTSEL.)
5. Press the 4 M3 heat-set inserts into the top shell's bosses with a soldering iron at about 220 °C, then set the top on the PCB.
6. Clip the 9 switches into the plate, pressing each until its two pins seat in its socket; keep the PCB flat on the bench so the sockets are backed.
7. Set it all in the tray and fasten with the 4 M3 screws from below.
8. Stick on the 4 rubber feet.
9. Press a keycap onto each switch.
10. Plug the USB cable into the Pico and copy code.py onto CIRCUITPY with GP2-GP10 mapped to your shortcuts. Keys are numbered from the bottom left, row by row (K1 to K3 along the bottom, K7 to K9 along the top, the USB end on the right), and the board wires K1 GP10, K2 GP7, K3 GP4, K4 GP9, K5 GP6, K6 GP3, K7 GP8, K8 GP5, K9 GP2; the labels under the keys say the same.
11. Test: each key should send its shortcut. If one doesn't, check its socket joint first.

### What goes on at each step (from the figure)
Open `view.html` and walk the steps with ← → (or choose one under Build), or open `view.html#step=<n>` for one.

| Step | Do | Parts |
| --- | --- | --- |
| 1 | Start with the bare PCB | 1 × Keypad PCB |
| 2 | Solder the 9 sockets onto the back | 9 × Kailh MX hot-swap socket |
| 3 | Solder the Pico flat onto the face | 1 × Raspberry Pi Pico |
| 4 | Press the 4 inserts in, set the top on | 4 × M3 heat-set insert, 1 × Case top / switch plate |
| 5 | Clip the 9 switches into the plate | 9 × MX-compatible mechanical switch |
| 6 | Set it in the tray, 4 screws from below | 4 × M3 x 8 button head screw, 1 × Case bottom tray |
| 7 | Stick on the 4 rubber feet | 4 × Adhesive rubber foot |
| 8 | Press a keycap onto each switch | 9 × 1u keycap, MX stem |
| 9 | Plug the USB cable into the Pico | 1 × USB micro-B cable, 1 m |

## Files
In production/ these sit next to this plan; in the product folder they are at the paths shown.
- Keypad PCB: `macropad-gerbers.zip` (`pcb/macropad-gerbers.zip`)
- Case top / switch plate: `top.stl` (`fab/top.stl`)
- Case bottom tray: `bottom.stl` (`fab/bottom.stl`)
