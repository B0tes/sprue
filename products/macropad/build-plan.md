# Build plan: 3x3 USB macro keypad

> I want a small 3x3 USB macro keypad for my desk: nine mechanical keys I can map to shortcuts, plugs into my laptop over USB, no drivers.

**1 unit · $109.75 all in (parts, fab, shipping) · longest lead 14 days**
Budget $75.00: OVER budget.

## What it is
Raspberry Pi Pico soldered flat to a 2-layer PCB with 9 Kailh hot-swap sockets for MX switches, directly wired to 9 GPIOs. Two-part 3D printed case: the top doubles as the switch plate, the bottom tray holds the PCB on standoffs. Four M3 screws into heat-set inserts.

## Order list
| Part | Supplier | What to order | Qty | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Pico | PiShop.us | Raspberry Pi Pico | 1 | $3.95 | 5 d | Snapshot (price read from the product page) |
| MX-compatible mechanical switch | MaxGaming US | Gateron Milky Yellow Pro, 35-pack | 35 | $7.12 | 14 d | Snapshot (price read from the product page) |
| Kailh MX hot-swap socket | Adafruit | 4958 (20-pack) | 20 | $4.95 | 5 d | Snapshot (price read from the product page) |
| 1u keycap, MX stem | Adafruit | 4997 DSA blank, 10-pack | 10 | $5.95 | 5 d | Snapshot (price read from the product page) |
| M3 heat-set insert | 3DJake | CNC Kitchen M3 inserts, 100-pack | 100 | $11.19 | 7 d | Snapshot (price read from the product page) |
| M3 x 8 button head screw | Bolts and Nuts | M3 x 8 button head | 4 | $0.44 | 5 d | Snapshot (price read from the product page) |
| Adhesive rubber foot | Adafruit | 550 (4-pack) | 4 | $0.95 | 5 d | Snapshot (price read from the product page) |
| USB micro-B cable, 1 m | Adafruit | 592 USB A to micro-B, 1 m | 1 | $2.95 | 5 d | Snapshot (price read from the product page) |
| Keypad PCB | JLCPCB | 2-layer 61x90 mm, 5 pcs | 5 | $17.00 | 12 d | Scripted (published rule) |
| Case top / switch plate | Craftcloud | PETG craftcloud | 1 | $6.00 | 10 d | Estimate |
| Case bottom tray | Craftcloud | PETG craftcloud | 1 | $6.00 | 10 d | Estimate |
| Shipping (PiShop.us) | PiShop.us | shipping | 1 | $6.00 | – | Estimate |
| Shipping (MaxGaming US) | MaxGaming US | shipping | 1 | $8.00 | – | Estimate |
| Shipping (Adafruit) | Adafruit | shipping | 1 | $6.00 | – | Estimate |
| Shipping (3DJake) | 3DJake | shipping | 1 | $8.00 | – | Estimate |
| Shipping (Bolts and Nuts) | Bolts and Nuts | shipping | 1 | $5.00 | – | Estimate |
| Shipping (Craftcloud) | Craftcloud | shipping | 1 | $10.25 | – | Estimate |

## Engineer checks (0 failed, 1 flagged)
| | Check | Result |
| --- | --- | --- |
| ✓ | Every part the design needs is in the BOM | All required roles present |
| ✓ | Switches, sockets and keycaps match the key grid | 9 keys; switches 9, keycaps 9, sockets 9 |
| ✓ | Controller has a free GPIO for every directly wired key | 9 keys need 9 GPIO; 26 available |
| ✓ | Power draw fits the USB budget | 25 mA typical (x2 margin) vs 500 mA from USB 2.0 |
| ✓ | Plate matches the MX switch standard | Cutout 14 mm (14.0), plate 1.5 mm (1.5), plate top to PCB top 5 mm (5.0) |
| ✓ | Key grid fits on the PCB | Grid 57.15 mm wide, 57.20 mm available |
| ✓ | Controller fits beside the keys and clear of screw holes | Controller y 16.0..37.0 (keys end at 14.05), x -20.5..30.5, holes clear (keep-out 4 mm) |
| ✓ | USB plug can seat through the case wall | Port 2.9 mm behind the outer wall, so the plug's overmold must enter the opening: opening 12 x 8.5 mm vs overmold 11 x 8 mm |
| ✓ | Lid clears the controller and its USB connector | Cavity 4.0 mm over a 3.8 mm tall controller: 0.20 mm clear |
| ✓ | Hot-swap sockets clear the tray floor | 4 mm standoffs, 1.85 mm sockets: 2.15 mm clear |
| ✓ | Screws reach the inserts without bottoming out | Counterbored head, 5.95 mm to the insert, 2.05 mm of thread engaged (insert 3 mm) |
| ✓ | Rubber feet keep screw heads off the desk | Screw heads sit in counterbores, flush with the floor |
| ⚑ | Regulatory standards | A USB keyboard is an unintentional radiator: selling it in the US needs FCC Part 15B (EU: CE, EMC directive). Building one for yourself needs nothing. Using a pre-certified Pico doesn't cover the finished product. |

## Assembly
1. Order the PCB (Gerbers in pcb/) and the two case prints (cad/out/macropad_top.stl, macropad_bottom.stl, PETG, 0.2 mm layers, top printed plate-down).
2. Solder the Pico flat onto the PCB by its castellated edges, USB end flush with the right edge.
3. Solder the 9 hot-swap sockets onto the back of the PCB.
4. Press the 4 M3 heat-set inserts into the top shell's bosses with a soldering iron at about 220 C.
5. Clip the 9 switches into the top plate, then press the PCB onto the switch pins so they seat in the sockets.
6. Drop the PCB and top into the tray and fasten with the 4 M3 screws from below. Stick on the 4 feet.
7. Hold BOOTSEL, plug in, copy CircuitPython and KMK onto the Pico, then copy code.py with GP2-GP10 mapped to your shortcuts.
8. Test: each key should send its shortcut. If one doesn't, check its socket joint first.

## Files
- Keypad PCB: `pcb/macropad-gerbers.zip`
- Case top / switch plate: `../../cad/out/macropad_top.stl`
- Case bottom tray: `../../cad/out/macropad_bottom.stl`
