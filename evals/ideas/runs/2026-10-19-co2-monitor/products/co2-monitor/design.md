# Desk CO2 monitor: design (stage 1)

**Request:** a desk CO2 monitor with a small screen and a light that goes green to red, powered by USB. One unit, for
the user's own desk in Italy, built at home: he solders through-hole and short-pitch SMD and prints through an online
service or a friend's FDM printer. "Simple and not expensive" with no number, so the brief assumes under 100 USD all
in.

**What it is:** it reads the room's CO2 every 5 s, shows it on a 0.96 in OLED and fades a 5 mm LED from green to
red: the Pico and the SCD-40 sensor screw to the back lid, the OLED and the LED sit behind the front wall of the
printed shell, seven soldered wires and one STEMMA QT cable join them, and four M3 screws close the lid onto the
shell, with the USB cable plugged into the Pico through an opening in the right side.

The case is an upright box, 64 x 26 x 60 mm (wide, deep, tall), about 56 g with its parts. Every number lives in
`design.json` → `params`; the CAD (`cad/`), the system check (`cad/_system.py`) and the engineer checks (`rules.ts`)
read them from there.

## Reference designs

No one open design has these parts and a case to print, so this is the simplest build that four published ones
agree on:

- **Parts and firmware: kiedtl/co2mon** ([github.com/kiedtl/co2mon](https://github.com/kiedtl/co2mon)). A Raspberry
  Pi Pico, a Sensirion SCD40 and an SSD1306 128x64 OLED on one I2C bus. It also has a radio, which this one leaves
  out.
- **Wiring and libraries: Adafruit's SCD-40 guide**
  ([learn.adafruit.com/adafruit-scd-40-and-scd-41](https://learn.adafruit.com/adafruit-scd-40-and-scd-41)). The
  breakout runs from the controller's 3 V into VIN, with SDA and SCL straight across, and CircuitPython's
  `adafruit_scd4x` drives it. The board outlines and holes come from Adafruit's board files,
  [Adafruit-SCD-4x-PCB](https://github.com/adafruit/Adafruit-SCD-4x-PCB) and
  [Adafruit-128x64-Monochrome-OLED-PCB](https://github.com/adafruit/Adafruit-128x64-Monochrome-OLED-PCB).
- **The green-to-red light: senseBox's CircuitPython CO2 traffic light**
  ([sensebox.de](https://sensebox.de/projects/en/2024-04-02-circuitpython-co2-traffic-light)). An SCD-type sensor
  read in CircuitPython, with the colour set from the reading.
- **The thresholds: the German Umweltbundesamt's guide values**
  ([UBA, hygienische Leitwerte](https://www.umweltbundesamt.de/system/files/medien/4031/bilder/dateien/hygienische_leitwerte_0.pdf)).
  Under 1000 ppm is harmless, 1000 to 2000 ppm is conspicuous, and over 2000 ppm is unacceptable. The light is
  green under 1000 ppm, red from 2000 ppm, and mixes through yellow in between.

There is no `reference/reference.json` for this product yet, so `sprue score` has no answer key to score against.

## Stack

- **Controller: Raspberry Pi Pico (SC0915).** The plain board without headers, so the wires solder straight to its
  pads. It runs CircuitPython.
- **CO2 sensor: Adafruit 5187, the SCD-40 breakout.** It is a true photoacoustic NDIR sensor, specified from 400 to
  2000 ppm at ±(50 ppm + 5 %). It also measures temperature and humidity. The SCD-41 (Adafruit 5190) is the same
  board, specified to 5000 ppm, and costs a little more.
- **Screen: Adafruit 326,** a 0.96 in 128x64 SSD1306 OLED with STEMMA QT. A generic 0.96 in module would cost less,
  but its board and holes differ, so the shell would need changing.
- **Light: Kingbright WP59SURKCGKW,** a 5 mm red/green LED with a common cathode and a white diffused lens. It has
  two 390 ohm resistors.
- **Wiring:** one 100 mm STEMMA QT cable, about 450 mm of 26 AWG stranded wire, and a USB-A to micro-B data cable.
- **Case:** two FDM prints in PLA (black, so the LED does not glow through the walls).
  - The front shell: front wall, four sides and four corner columns.
  - The back lid.
- **Fasteners:**
  - 4 M3 x 4 heat-set inserts and 4 M3 x 6 button heads close the case.
  - 4 M2 x 6 pan heads hold the Pico and the sensor.
  - 2 M2 x 4 pan heads hold the OLED.
  - 4 rubber feet.

## How the blocks connect

**Power.** USB 5 V from a phone charger or the computer goes into the Pico's own micro-USB socket. The Pico's
regulator makes 3.3 V, and everything runs from its 3V3(OUT) pin. That is how Adafruit wires the breakout to a 3.3 V
board, and it keeps the I2C pull-ups at 3.3 V.

The load on 3V3(OUT) is 240 mA worst case, against the 300 mA the Pico datasheet allows on that pin:

| Part | Current |
| --- | --- |
| SCD40 peak during a measurement | 205 mA |
| OLED, all pixels on | 29 mA |
| LED, both colours on | 6.5 mA |

From USB the whole unit draws about 270 mA, of 500 mA.

**I2C.** I2C0 runs on GP4 (SDA, pin 6) and GP5 (SCL, pin 7) to the SCD-40's header. From the SCD-40's STEMMA QT
socket the cable goes on to the OLED. The addresses are 0x62 for the sensor and 0x3D or 0x3C for the OLED. code.py
scans for the OLED, because Adafruit's jumper sets its address. The bus runs at 100 kHz, and the breakout's 10 k
pull-ups serve both boards.

**Light.** GP14 (pin 19) drives the red anode and GP15 (pin 20) the green, each through 390 ohm. The common cathode
goes to GND (pin 18). Both pins are on PWM slice 7, channels A and B, so code.py can mix green, yellow, orange and
red.

At 3.3 V each colour draws about 3 to 3.5 mA. That is under the RP2040's 4 mA default drive, and bright enough for
a diffused indicator across a desk. If it looks dim, the resistors can drop to 220 ohm with the pins set to 8 mA.

## Layout

The frame:
- Origin: the centre of the case's footprint, on its underside.
- x: across the front, toward the USB side (right).
- y: from the front toward the back lid.
- z: up.

**Front shell.** The front wall is 2 mm thick.
- **OLED.** It sits behind a 24.4 x 13.5 mm window. The window is 1.3 mm larger each way than the panel's active area,
  so a viewing angle of 30 deg clears the wall. The glass rests on the wall's inner face. The board sits on a printed
  ledge and is held by two M2 x 4 screws in two bosses as tall as the glass.
- **LED.** It sits above the screen, in a 5.2 mm hole, with its flange on the inner face and glued.
- **USB opening.** The right side has a 12.5 x 9.5 mm opening for the micro-USB plug.
- **Corner columns.** Four columns take the M3 inserts.

**Back lid.** It carries both boards that need air or a cable.
- **Pico.** It lies along the bottom on four 4 mm standoffs, its USB end against the right side. The far end's two
  holes take M2 screws. The USB end's two holes drop over printed pins, because a pan head there would hit the
  micro-USB socket.
- **SCD-40 breakout.** It sits higher, at the left, on four 7.5 mm standoffs (two with screws). The sensor faces the
  lid, 1 mm from it, behind five vent slots. Five more slots low down let air in.

**The tradeoff.** Sensirion advises putting the sensor below heat sources. Here it is above the Pico, because that
keeps the USB plug low: a cable pull then tips the box less (the system check gives 0.58 N to tip it sideways, against
the 0.3 N assumed).

The Pico dissipates about 0.1 W. The SCD40 compensates its CO2 reading itself, but the temperature and humidity it
shows need `TEMP_OFFSET_C` set against a thermometer. `rules.ts` flags this (`sensor-heat`), and the last assembly
step says how.

## Checks

**`rules.ts`** holds this product's engineer checks:
- **Electrical:**
  - the 3V3 and USB budgets
  - LED current per pin and the GPIO total
  - the pin functions (an I2C0 pair, one PWM slice)
  - I2C addresses and bus speed
  - the thresholds against the sensor's specified range
- **Mechanical:**
  - the screen window against the active area and the glass
  - the LED's place
  - the USB plug's reach
  - screw engagement against the room each screw has
  - print walls

Three rules flag rather than pass:
- **standards:** what the unit falls under (below).
- **sensor-heat:** above.
- **self-calibration:** the SCD40's automatic self-calibration assumes it sees outdoor air (about 400 ppm) for
  3 minutes once a week.

Built-in checks changed here:
- **`print-walls` is replaced.** The built-in one computes the case from a PCB's size (`pcbWidthMm`, `pcbHeightMm`),
  and this product has no PCB.
  - The local rule holds the shell's walls to the same limits Sprue uses for FDM, copied into `design.json`'s params
    because a local rule cannot read Sprue's table:
    - 1.0 mm least (Craftcloud's material guide).
    - 2.0 mm for a part up to 100 mm (JLC3DP).
    - 1.5 mm round a fastener (JLC3DP).
  - It caught one fault: the OLED bosses had 1.4 mm round their pilot holes, and are now 5.0 mm across.
- **`usb-power` is replaced.** The built-in one counts the controller's current only. This one adds the sensor's
  205 mA measurement pulse, the OLED and the LED.
- **`feet-clear-heads` is off.** It keeps a keypad's screw heads, under its tray, off the desk. This case has no
  screws underneath: the four M3 screws close the lid at the back. It ran only because `footHeightMm` is a keypad
  param name too.

**`cad/_system.py`** puts all 25 placed parts in one frame. Bought parts are envelopes at their datasheet sizes.
- **Not placed:** the two resistors (on the LED's leads, under heat-shrink) and the STEMMA QT cable (routed by hand).
- **Pose:** one, on the desk, with a sideways pull of the USB cable.
- **Probes:**
  - the LED out of the front
  - three points of the screen through the window
  - the sensor's vents

## Software

`software/code.py` is CircuitPython for the Pico. Sprue writes firmware only for a keypad, so this file is written
by hand. Every 5 s it does three things:
- reads CO2, temperature and humidity from the SCD40 (periodic measurement);
- shows them on the OLED, CO2 large;
- sets the LED: green under 1000 ppm, red from 2000 ppm, mixed in between.

Until the first reading (about 5 s) the screen says "warming up" and the LED is dim yellow. On an error it prints the
error on the serial console and shows it on the screen.

Changed at stage 3: the sensor's serial number is now read before periodic measurement starts, because the SCD4x
refuses that command while it measures (the datasheet's command table), and the first version would have stopped at
boot. It has been run on the host against stand-ins for CircuitPython's modules (`.tools/fwmock_run.py` in the work
folder), not on a Pico. The assembly's tool list was corrected too: PH1 for the M2 screws and a 2 mm hex key for the
M3 button heads (TME's pages), a multimeter, and three pieces of heat-shrink.

## Standards

For one unit built for its maker's own use, no conformity marking applies. Sold or given away in the EU, it would
fall under:
- the EMC Directive 2014/30/EU (the Pico is a digital device clocked at 125 MHz);
- RoHS 2011/65/EU;
- the CE marking.

It is a 5 V USB device, so the Low Voltage Directive does not apply. In the US it would need FCC Part 15B. The Pico's
own compliance does not cover the finished product. Its readings are indicative, not a certified CO2 measuring
instrument. `rules.ts` flags this.

## Check on the first unit

These are the numbers this design takes on trust; `design.json` → `estimates` lists them all.

- **Measure the OLED board.** Adafruit's page says 29.2 x 26.7 mm, and its board file says 29.21 x 31.75 mm. The
  shell follows the board file. A 26.7 mm board would have no upper holes for the screws.
- **Measure the SCD-40 board's thickness.** It is taken as 1.2 mm, which sets the sensor's gap to the lid.
- **Hold the OLED's glass against the window before gluing anything.** The glass position and the active area's
  offset are read from drawings that did not come through cleanly.
- **Bend the LED's leads to the right, 3 mm behind the flange.** Straight back they would hit the SCD-40 board, 12 mm
  behind the LED; the resistors go in the free room to its right.
- **Measure the USB cable's moulding.** It must be at most 11 x 8 mm to reach through the opening.
- **Try an M2 screw in a pilot hole on the first print.** The pilots are 1.7 mm for a thread cut in PLA.
- **Set `TEMP_OFFSET_C`.** Run the unit for a day and set it against a thermometer.
