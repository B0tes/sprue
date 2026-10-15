# 3x3 RP2040 macropad: reference designs and prices (checked 2026-10-13)

Prices are USD unless noted, taken from the product page on the date above. Shipping and tax are excluded.
"unverified" means the figure could not be confirmed on the page itself.

## Task A: reference designs

**Best match for "Pico + direct-wired + 3D printed + published BOM with cost": athul/macrokuttan**
- URL: https://github.com/athul/macrokuttan · License: GPL-3.0
- 9 MX keys on a Raspberry Pi Pico. Hand-wired with no PCB. The case is 3D printed from Victor Lucachi's VOID9 design. Firmware is KMK (CircuitPython).
- BOM as published: 1 Pico (₹349), 9 switches (₹18 each), 1 printed case (₹200), 9 1N4148 diodes (₹2 each), keycaps (~₹200 per 10, estimated).
- Stated cost: ₹740 plus about ₹100 shipping (target "$13 ≈ ₹1000"). The line items add up to ₹729, not ₹740.
- PCB size: not applicable.

**Best match with a PCB: jboucly/macropad-3x3**
- URL: https://github.com/jboucly/macropad-3x3
- License: conflicting. The README says CC BY-NC-SA 4.0 and the sidebar says CC0-1.0.
- 9 MX keys on a Waveshare RP2040-Zero. The PCB was designed in EasyEDA, and Gerber, BOM and pick-and-place files for JLCPCB are in the repo. The case is printed, designed in Fusion 360. Firmware is KMK on CircuitPython.
- BOM: 1 RP2040-Zero, 9 MX switches (linked to Glorious Panda), 9 diodes (no spec given), 9 keycaps, 8 M3 screws, 8 M3 heat-set inserts.
- PCB size: unverified (not on the README). Build cost: not stated.

**Other candidates**
- balub/CoryDora: https://github.com/balub/CoryDora · no license stated. 3x3 keys, RP2040-Zero, KiCad PCB, 9 hot-swap sockets, 9 1N4148 THT diodes, EC11 encoder, 0.91" 128x32 OLED, QMK fork. A case STEP file is included. No size or cost given.
- palmacas/MacroBoard: https://hackaday.io/project/186812-macroboard · 3x3 keys, XIAO RP2040, 9 Kailh hot-swap sockets, SK6812 MINI-E LEDs, encoder, printed case with M2.5 screws, KMK.
- jaysongiroux/pico-macro-pad: https://github.com/jaysongiroux/pico-macro-pad · Pico wired directly to GP2–GP10, CircuitPython, case STLs on Thingiverse (thing:4816077).
- NextPCB / Hackster: https://www.hackster.io/1NextPCB/how-to-build-a-pico-macro-pad-3638e6 · Apache-2.0. Pico, 9 Gateron switches, 4 M3x16 screws, ~2 ft of 20 AWG wire, printed case, CircuitPython (based on novaspirit/PiPicoMacroKeys).

**Design note:** with 9 keys on direct GPIO (the Pico has 26 GPIO), no diodes or matrix are needed. Diodes appear in these BOMs only because the authors wired a matrix.

## Task B: prices

### 1. Controller
| Item | Source | Price | Breaks / stock |
|---|---|---|---|
| Pico (SC0915, no headers) | https://www.pishop.us/product/raspberry-pi-pico/ | $3.95 | no breaks; in stock |
| Pico | https://www.sparkfun.com/raspberry-pi-pico.html (DEV-17829) | $4.60 | volume pricing on request; in stock |
| Pico | https://www.adafruit.com/product/4864 | $4.00 | all Pico variants out of stock |
| Pico H | https://www.pishop.us/product/raspberry-pi-pico-h/ | $5.00 | no breaks; in stock |
| Pico (official list price) | https://www.raspberrypi.com/products/raspberry-pi-pico/ | "from $4" | the page does not give a separate Pico H price |
| Waveshare RP2040-Zero (USB-C) | https://www.waveshare.com/rp2040-zero.htm | $3.99–$4.99 (with or without header) | per-option price and stock unverified |
| SC0915 at DigiKey / Mouser | — | unverified | pages did not load |

### 2. MX-compatible switches
| Item | Source | Pack price | Per switch | Stock |
|---|---|---|---|---|
| Outemu Blue, 10-pack | https://milktooth.com/products/switches/outemu-blue | $3.10 | $0.31 | out of stock |
| Gateron Milky Yellow Pro, 35-pack | https://us.maxgaming.com/us/switches/gateron-milky-yellow-pro-35-pack | $7.12 | $0.20 | in stock (7–14 days) |
| Gateron Milky Yellow Pro, 35 pcs | https://www.microcenter.com/quickView/675964/gateron-milky-yellow-pro-keyboard-switches-35-pieces | "$999" shown (page error) | unverified | in-store only |

### 3. Kailh MX hot-swap socket (CPG151101S11)
| Source | Price | Breaks / stock |
|---|---|---|
| LCSC C2803348: https://fat.lcsc.com/product-detail/Mechanical-Keyboard-Shaft_Kailh-CPG151101S11_C2803348.html | $0.1108 each (5+) | 50+ $0.0898, 500+ $0.0714, 2k+ $0.0651; out of stock; MOQ 5, multiples of 5 |
| Adafruit 4958, 20-pack: https://www.adafruit.com/product/4958 | $4.95 ($0.25 each) | 10+ packs $4.46, 100+ $3.96; in stock |
| Keyboardio, 25-pack (PG151101S11): https://shop.keyboard.io/products/kailh-hotswap-sockets-for-mx-style-keyswitches-x-25 | $2.00 ($0.08 each) | sold out |

### 4. Blank 1u keycaps
| Item | Source | Price | Per key | Notes |
|---|---|---|---|---|
| DSA, 10-pack (black) | https://www.adafruit.com/product/4997 | $5.95 | $0.60 | 10+ $5.36, 100+ $4.76; 10 in stock; material not stated |
| DSA PBT, single | https://www.kromekeycaps.com/products/single-blank-dsa-pbt-keycaps | £1.07 | £1.07 | minimum 3 (the page conflicts on this); most colours in stock |
| DSA 1u, single | https://spkeyboards.com/products/sp-dsa-1-space | $3.00 | $3.00 | ABS or PBT; in stock |

### 5. Hardware
| Item | Source | Price | Notes |
|---|---|---|---|
| CNC Kitchen M3x5.7 heat-set inserts, 100 pcs | https://www.3djake.com/cnc-kitchen/threaded-inserts-m3-standard?sai=15445 | $11.19 ($0.11 each) | in stock (38 left), excl. VAT |
| Adafruit M3x3 inserts, 50 pcs | https://www.adafruit.com/product/4256 | $5.95 | out of stock |
| M3x8 A4 button-head screw | https://boltsandnuts.com/products/m3-0-50x8-stainless-a4-70-button-head-socket-cap-screws | $0.11 each | 100+ $0.08, 500+ $0.05; stock not shown |
| M3x8 SHCS 304, 100 pcs | https://www.globalindustrial.com/p/m3-x-0-5-x-8mm-socket-head-cap-screw-304-stainless-steel-pkg-of-100 | $9.80 per 100 | ships in about 2 days |
| Rubber bumper feet, 4-pack | https://www.adafruit.com/product/550 | $0.95 | 10+ $0.86; in stock |

### 6. USB cable, 1 m
| Item | Source | Price | Stock |
|---|---|---|---|
| USB-A to micro-B, 3 ft (for the Pico) | https://www.adafruit.com/product/592 | $2.95 (10+ $2.66) | in stock |
| USB-A to USB-C, 1 m (for the RP2040-Zero) | https://www.adafruit.com/product/5153 | $2.95 | out of stock |

### 7. PCB fab (2-layer)
- **OSH Park** (https://docs.oshpark.com/services/): $5 per sq in, sold in sets of 3. Medium Run is $1 per sq in with a 100 sq in minimum, in multiples of 10. For example, a ~66x66 mm (6.75 sq in) board is about $34 for 3.
- **JLCPCB**: "From $2.00 / 5 pcs" on https://jlcpcb.com/. The exact quote for 100x100 mm, 2 layers, 5 pcs only appears in the instant quote, so it is unverified. LCSC's page (https://fat.lcsc.com/pcba/price) states that 1–2 layer boards at 100x100 mm cost $2. Shipping is extra.
- **PCBWay** (https://m.pcbway.com/activitypcb.aspx): $5 for 10 pcs, 1–2 layers, up to 100x100 mm, 2–3 day build. Shipping is extra and not shown.

### 8. 3D-printed case (~60 g, ~80x80x20 mm)
- **Craftcloud** (all3dp quotes, 2026-06-24 to 26: https://all3dp.com/1/uncover-real-3d-printing-service-costs/): a 91x88x70 mm PLA phone stand cost $12.85 for the part plus $10.25 shipping, $23.10 total. That price was set by a **$12 minimum product cost**. An 80x80x20 case should land at about the same price. This is a third-party quote, not a published price list.
- **JLC3DP**: the FDM PLA page (https://jlc3dp.com/help/article/pla-plastic) says "From $1.00", minimum part size 30x30x10 mm, build time from 72 h. The per-gram rate is not published. PLA-P prices were cut 18% from 2026-07-24 (https://jlc3dp.com/news/materials-finishing-pricing-update-july2026). The quote for this part is unverified.
- **Slant 3D**: the API (`POST https://www.slant3dapi.com/api/slicer` with fileURL and api-key) returns a price in USD for a given quantity, excluding shipping, and defaults to black PLA. It does not publish a per-gram rule, so the price is unverified until we call it.

## Rough per-unit build cost (Pico, direct-wired, hot-swap PCB)
Pico $3.95 + 9 switches ~$2.80 + 9 sockets ~$1.00 (LCSC) + 9 keycaps ~$5.40 + 4 inserts and 4 screws ~$0.90 + 4 feet $0.95 + cable $2.95 + PCB ~$0.40 (JLC $2 / 5) + printed case ~$13 ≈ **$31**, before shipping.
Shipping and pack minimums dominate a one-off build. Real cash outlay is closer to $60–80 (Craftcloud shipping ~$10, JLC shipping unverified, full packs of each part).
