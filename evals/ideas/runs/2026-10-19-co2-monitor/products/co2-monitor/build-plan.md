# Build plan: Desk CO2 monitor with an OLED screen and a green-to-red light

> A desk CO2 monitor with a small screen and a light that goes green to red, powered by USB.

**1 unit · $165.46 for parts, fab and estimated shipping · longest lead 33 days**
Budget $100.00: OVER budget.

**Not in this total:**
- Currency and VAT: every shop prices in EUR; the quote's dollars are each shop's price without VAT, plus 22% Italian VAT, at 1.1253 USD/EUR (ECB, 2026-10-16). What you pay is the EUR total at each checkout, which may differ by a few percent (the shop's own VAT handling for Italy, rounding).
- Prints: priced as filament only (36 g of PLA at the Sunlu spool's price), for a friend's printer. A spool, failed prints, supports and power are not counted. An online print service is not quoted: Sprue's print rate (Craftcloud) is a US figure, and a real quote needs the STL uploaded, which was not done.
- Packs: the order buys 50 inserts, 100 of each screw and 4 feet for a unit that uses 4, 4, 4 + 2 and 4; the rest are spares.
- Not in the total: solder, heat-shrink, a little hot glue, a heat-set insert tip if your iron has none, and a USB charger (any 5 V phone charger or the computer).
- No customs or import duty: every shop in the order is in the EU. A UK shop (The Pi Hut, Pimoroni) would add DHL Express (GBP 30 at The Pi Hut) and EU import charges.
- Free-shipping thresholds not reached: Opencircuit from EUR 150, BerryBase from EUR 250.

## What it is
A small upright desk box: a Sensirion SCD-40 photoacoustic CO2 sensor (Adafruit breakout) and a Raspberry Pi Pico on the back lid, a 0.96 in 128x64 OLED behind a window in the front, and a red/green bi-colour LED at the top of the front that fades from green through yellow to red as CO2 rises (green below 1000 ppm, red from 2000 ppm, the German UBA guide values). USB 5 V comes in through the Pico's own micro-USB socket on the right side. Everything runs at 3.3 V from the Pico; the sensor and the OLED share one I2C bus over a STEMMA QT cable; the firmware is CircuitPython.

## Order list
The whole batch as one order. Need is pieces, spares included; Buy is what goes in the cart.

| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Pico (RP2040), no headers | BerryBase | RPI-PICO Raspberry Pi Pico | 1 | 1 | $4.73 | 6 d | Snapshot (price read from the product page) |
| Adafruit SCD-40 True CO2, Temperature and Humidity Sensor, STEMMA QT | BerryBase | ADA5190 Adafruit SCD-41 (bom.json alternate, same board) | 1 | 1 | $61.03 | 6 d | Snapshot (price read from the product page) |
| Adafruit Monochrome 0.96 in 128x64 OLED Graphic Display, STEMMA QT | Opencircuit | 326 Adafruit Monochrome 0.96in 128x64 OLED STEMMA QT | 1 | 1 | $30.07 | 33 d | Snapshot (price read from the product page) |
| Bi-colour LED, 5 mm, red/green, white diffused, common cathode | TME | L-59SURKCGKW (now WP59SURKCGKW) | 1 | 1 | $0.27 | 6 d | Snapshot (price read from the product page) |
| Resistor, 390 ohm, 1/4 W, through-hole | BerryBase | MSW390R.25 metal film 390 ohm 1/4 W 1% | 2 | 2 | $0.12 | 6 d | Snapshot (price read from the product page) |
| STEMMA QT / Qwiic JST SH 4-pin cable, 100 mm | Opencircuit | 4210 Adafruit STEMMA QT / Qwiic JST SH 4-pin cable 100 mm | 1 | 1 | $5.15 | 15 d | Snapshot (price read from the product page) |
| Silicone hook-up wire, 26 AWG stranded, a few colours | BerryBase | 55045 stranded wire 1x0.14 mm2 (18x0.1), PVC, 10 m, black | 1 | 1 | $1.73 | 6 d | Snapshot (price read from the product page) |
| USB cable, USB-A to micro-B, 1 m | BerryBase | 96193 USB 2.0 Hi-Speed cable A to Micro B, white, 1.0 m | 1 | 1 | $2.03 | 6 d | Snapshot (price read from the product page) |
| Brass heat-set insert, M3 x 4 mm | Opencircuit | 4255 Adafruit brass heat-set inserts M3 x 4 mm, 50 pack | 4 | 1 x pack of 50 (50 pcs) | $12.48 | 33 d | Snapshot (price read from the product page) |
| M3 x 6 mm button head screw, ISO 7380 | TME | B3X6/BN19 Bossard ISO 7380 M3x6, steel 10.9, black | 4 | 1 x pack of 100 (100 pcs) | $4.88 | 6 d | Snapshot (price read from the product page) |
| M2 x 6 mm pan head Phillips screw, ISO 7045 | TME | M2X6/D7985 Kraftberg cheese head PH1, steel zinc (ISO 7045) | 4 | 1 x pack of 100 (100 pcs) | $2.44 | 6 d | Snapshot (price read from the product page) |
| M2 x 4 mm pan head Phillips screw, ISO 7045 | TME | M2X4/D7985 Kraftberg cheese head PH1, steel zinc (ISO 7045) | 2 | 1 x pack of 100 (100 pcs) | $2.44 | 6 d | Snapshot (price read from the product page) |
| Adhesive rubber bumper feet, 8 mm | Opencircuit | 550 Adafruit little rubber bumper feet, pack of 4 | 4 | 1 x pack of 4 (4 pcs) | $5.15 | 15 d | Snapshot (price read from the product page) |
| Front shell (front wall, sides, corner columns) | Home printer | shell.stl, PLA | 1 | 1 | $0.44 | 6 d | Scripted (published rule) |
| Back lid (carries the Pico and the sensor) | Home printer | lid.stl, PLA | 1 | 1 | $0.17 | 6 d | Scripted (published rule) |
| Shipping (BerryBase) | BerryBase | shipping | – | 1 | $11.42 | – | Snapshot (price read from the product page) |
| Shipping (Opencircuit) | Opencircuit | shipping | – | 1 | $14.18 | – | Snapshot (price read from the product page) |
| Shipping (TME) | TME | shipping | – | 1 | $6.73 | – | Snapshot (price read from the product page) |

## Engineer checks (0 failed, 3 flagged)
| | Check | Result |
| --- | --- | --- |
| ✓ | The whole draw fits a USB 2.0 port | At most 270.5 mA from USB at the sensor's 205 mA pulse (Pico 30 mA allowance + the 3.3 V load counted 1:1), vs 500 mA from a USB 2.0 port; about 62.5 mA on average |
| ✓ | The micro-USB plug seats through the side opening | The 11 x 8 mm moulding has 0.75 and 0.75 mm each side in the opening (at least 0.3); seated, it goes 1.50 mm into the wall |
| ✓ | The printed walls meet the print shops' least walls | shell walls 2 mm, lid 2 mm (FDM: 1 mm least, 2 mm for a part up to 100 mm; this case is 64 mm); round fasteners insert columns 2.00 mm, Pico standoffs 1.65 mm, sensor standoffs 1.65 mm, OLED bosses 1.65 mm (more than 1.5 mm asked) |
| ⚑ | Regulatory standards | Built for your own desk it needs nothing. Selling it in the EU would need CE marking (EMC directive for the electronics, RoHS) and in the US FCC Part 15B; the Pico's own compliance doesn't cover the finished product. It is not a certified CO2 measuring instrument. |
| ✓ | Every part the design needs is in the BOM | All 13 roles present |
| ✓ | The 3.3 V load fits the Pico's regulator | Peak external load on 3V3(OUT): sensor 205 + OLED 29 + LED 6.5 = 240.5 mA, under the 300 mA the Pico datasheet asks (59.5 mA to spare) |
| ✓ | The LED's current suits the GPIO and the LED | 390 ohm: red 3.46 mA, green 3.08 mA at typical Vf, 2.05 mA at the 2.5 V maximum Vf; each under the RP2040's 4 mA default drive and the LED's 30 mA, and at least 1 mA so it lights |
| ✓ | The GPIO bank's total current stays in the RP2040's limit | 6.54 mA sourced by GPIOs (both colours on) vs 50 mA for all of IOVDD |
| ✓ | The pins are distinct and do what they are wired for | I2C0 SDA GP4, SCL GP5; LED red GP14 (PWM 7A), green GP15 (PWM 7B) |
| ✓ | The I2C devices have their own addresses and the bus speed suits them | SCD4x at 0x62, OLED at 0x3c or 0x3d; bus at 100 kHz, the SCD4x takes up to 400 kHz |
| ✓ | The light's thresholds sit inside the sensor's specified range | Green below 1000 ppm, red from 2000 ppm (UBA guide values); the SCD40 is specified to 2000 ppm, reading +-150.0 ppm at 2000 |
| ✓ | The window shows the whole active area from 30 degrees off axis, and only glass | Window half-size 12.20 x 6.75 mm vs 12.03 x 6.59 mm needed for 30 degrees through the 2 mm wall; glass edges 13.35 mm to the sides, 7.53 above and 11.73 below the window's centre |
| ✓ | The LED clears the OLED and the top wall | Flange 1.85 mm above the OLED board, 1.60 mm under the top wall (at least 0.3) |
| ✓ | Every screw bites far enough and stops short of a face | M3 lid screws 4.00 mm in (at least 3, room 7.00); M2 Pico screws 5.00 mm in (at least 2, room 5.20); M2 sensor screws 4.80 mm in (at least 2, room 8.70); M2 OLED screws 2.40 mm in (at least 2, room 2.75) |
| ⚑ | The CO2 sensor sits below the heat sources (Sensirion's advice) | The sensor's board starts 1.1 mm above the Pico, so the Pico's warmth (about 0.1 W) rises past it. Chosen so the USB plug sits low (a cable pull tips it less); the CO2 reading is compensated inside the SCD40, but the temperature and humidity it shows need TEMP_OFFSET_C set against a thermometer (assembly, last step) |
| ⚑ | The sensor's self-calibration gets fresh air | The SCD40's automatic self-calibration assumes it sees outdoor air (about 400 ppm) for 3 minutes at least once every 7 days. A room that is never aired drifts the zero; air it, or put the monitor on an open window sill now and then |

## Assembly
1. Before you start. Tools: soldering iron (with a heat-set insert tip if you have one), solder, flush cutters, wire strippers for 26 AWG, a PH1 Phillips screwdriver for the M2 screws (TME gives PH1 for these DIN 7985 heads), a 2 mm hex key for the M3 button heads, a multimeter with a diode test (step 9), a hot-glue gun or a drop of superglue for the LED, 3 pieces of 2 mm heat-shrink about 15 mm long, and a computer with a USB port. Print the front shell and the back lid in PLA (black hides the LED's glow through the walls): front shell face down on the bed, lid flat, 0.2 mm layers, 4 perimeters (enough for the 2 mm walls) and 20 % infill; no supports are needed.
2. Flash the Pico first, on the bench. Hold BOOTSEL, plug the Pico into the computer, copy CircuitPython for the Raspberry Pi Pico (the .uf2 from circuitpython.org/board/raspberry_pi_pico) onto RPI-RP2, and wait for the CIRCUITPY drive. From the Adafruit CircuitPython bundle for that version, copy adafruit_scd4x.mpy, adafruit_displayio_ssd1306.mpy and the folders adafruit_display_text and adafruit_bus_device into CIRCUITPY/lib, then copy software/code.py (in this product's folder) to CIRCUITPY/code.py. Unplug.
3. Lay the front shell face down. Press the 4 M3 inserts into the 4 corner columns from the open back, flush with the rim, with the iron at the insert tip's temperature for PLA.
4. Push the bi-colour LED into the hole at the top of the front, from inside, until its flange sits on the wall. Fix it with a drop of hot glue on the flange.
5. Set the OLED in behind the window: glass toward the window, bottom edge on the printed ledge, its two upper holes on the two bosses. Fasten it with 2 M2 x 4 screws, finger tight (the glass must not be pressed hard).
6. Lay the lid inner face up. Set the Pico on its four 4 mm standoffs, components up, with the USB socket at the end that has two short printed pins: those two holes drop over the pins. Fasten the other end with 2 M2 x 6 screws (a pan head next to the USB socket would hit it, which is why that end has pins).
7. Fasten the CO2 sensor breakout (the order buys Adafruit's SCD-41 version, the same board as the SCD-40) on the lid's four tall standoffs with 2 M2 x 6 screws in the two diagonal standoffs that have holes: the sensor (the white square block) faces the lid, over the five vent slots, and the 5-pin header row is at the bottom, toward the Pico.
8. Wire the sensor: solder 4 pieces of 26 AWG wire, about 50 mm each, from the Pico to the SCD-40 header: pin 36 3V3(OUT) to VIN, pin 8 GND to GND, pin 7 GP5 to SCL, pin 6 GP4 to SDA.
9. Wire the light: with the multimeter's diode test, find the common cathode (the lead both colours light from, as the black probe) and which anode lights red. Bend all three leads 90 degrees toward the right side (the USB side) about 3 mm behind the flange: straight back they would hit the sensor's board, which sits 12 mm behind the LED once the lid is on, and to the right of that board, under the top, there is about 18 mm of free room. Solder a 390 ohm resistor to each anode there. Then about 80 mm of wire from the red resistor to Pico pin 19 (GP14), from the green resistor to pin 20 (GP15), and from the cathode to pin 18 (GND), slipping a piece of heat-shrink onto each wire before you solder it on at the LED end: shrink one over each resistor with both its joints and the third over the cathode's joint, so no bare lead can touch another.
10. Plug the 100 mm STEMMA QT cable into the SCD-40's right-hand connector and the OLED's right-hand connector.
11. Test before closing: plug the USB cable into the Pico and a charger or the computer. Within about 10 s the screen shows the CO2 in ppm, the temperature and the humidity, and the LED is green in a ventilated room. Breathe gently toward the vent slots: the CO2 rises and the LED moves toward yellow. If the screen stays blank, open the serial console (Mu or screen) and read the error code.py prints.
12. Close the case: unplug the USB cable, tuck the wires so none crosses the vent slots or the USB opening, set the lid on the shell with the Pico's USB socket at the side opening, and fasten 4 M3 x 6 screws into the inserts.
13. Stick the 4 rubber feet under the bottom, one near each corner.
14. Plug the USB cable into the Pico through the opening in the right side, and the other end into a phone charger or the computer. Set the monitor on the desk where you sit, not next to a window or your face.
15. Settle it in: leave it running for a day. The SCD40's self-calibration (on by default) needs fresh outdoor air (about 400 ppm) for at least 3 minutes once a week, so air the room now and then or set it on an open window sill for 5 minutes. To match the temperature to a thermometer next to it, change TEMP_OFFSET_C in code.py (the sensor's default is 4 C) and save.

### What goes on at each step (from the figure)
Open `view.html` and walk the steps with ← → (or choose one under Build), or open `view.html#step=<n>` for one.

| Step | Do | Parts |
| --- | --- | --- |
| 1 | Press the 4 inserts into the shell | 1 × Front shell (front wall, sides, corner columns), 4 × Brass heat-set insert, M3 x 4 mm |
| 2 | Glue the LED into its hole | 1 × Bi-colour LED, 5 mm, red/green, white diffused, common cathode |
| 3 | Screw the OLED in behind the window | 2 × M2 x 4 mm pan head Phillips screw, ISO 7045, 1 × Adafruit Monochrome 0.96 in 128x64 OLED Graphic Display, STEMMA QT |
| 4 | Screw the Pico onto the lid | 1 × Raspberry Pi Pico (RP2040), no headers, 2 × M2 x 6 mm pan head Phillips screw, ISO 7045 |
| 5 | Screw the CO2 sensor onto the lid | 1 × Adafruit SCD-40 True CO2, Temperature and Humidity Sensor, STEMMA QT, 2 × M2 x 6 mm pan head Phillips screw, ISO 7045 |
| 6 | Close the lid with 4 M3 screws | 4 × M3 x 6 mm button head screw, ISO 7380, 1 × Back lid (carries the Pico and the sensor) |
| 7 | Stick on the 4 rubber feet | 4 × Adhesive rubber bumper feet, 8 mm |
| 8 | Plug the USB cable into the Pico | 1 × USB cable, USB-A to micro-B, 1 m |

## Files
In production/ these sit next to this plan; in the product folder they are at the paths shown.
- Front shell (front wall, sides, corner columns): `shell.stl` (`fab/shell.stl`)
- Back lid (carries the Pico and the sensor): `lid.stl` (`fab/lid.stl`)
