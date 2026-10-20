**Gate 1: the design is ready for you to review (desk CO2 monitor, `co2-monitor`)**

**Page:** products/co2-monitor/view.html
**Link:** file://products/co2-monitor/view.html

This shell has no browser, so I couldn't open the page; open the link in yours.

**What it is.** It reads the room's CO2 every 5 s, shows it on a 0.96 in OLED and fades a 5 mm LED from green to red. The Pico and the SCD-40 sensor screw to the back lid, and the OLED and the LED sit behind the front wall of the printed shell. Seven soldered wires and one STEMMA QT cable join them, and four M3 screws close the lid onto the shell. The USB cable plugs into the Pico through an opening in the right side.

**Size.** The figure draws about 49 solids.
- **Parts list:** 15 lines.
  - 13 bought: 26 pieces per unit, plus hook-up wire cut from a reel.
  - 2 printed in PLA: the front shell (21.3 cm3) and the back lid (8.15 cm3).
- **Case:** 64 x 26 x 60 mm, about 56 g with everything in it.

**Engineer checks:** 16 run, 0 failed, 3 flagged.
- **Standards:** nothing is needed for your own desk. If it were sold, it would need CE marking (EMC, RoHS). It is not a certified CO2 instrument.
- **Sensor heat:** the sensor sits 1.1 mm above the Pico, which keeps the USB plug low so a cable pull tips the box less. The CO2 reading is compensated for this. The temperature it shows is not, so set `TEMP_OFFSET_C` against a thermometer (last assembly step).
- **Self-calibration:** the sensor needs fresh outdoor air for 3 minutes once a week, from an aired room or a window sill. Without it the reading drifts.

I changed three of Sprue's built-in checks:
- I replaced `print-walls` and `usb-power` with versions that fit a case with no PCB.
- I turned off `feet-clear-heads`, a keypad check. This case has no screws underneath.

**Whole-product check (`sprue system`): PASS.**
- All 25 parts are in one frame. Nothing overlaps, the parts meant to touch do, and everything else keeps at least 0.3 mm apart.
- The boards are inside the case.
- It tips at 15.2 deg. It holds against a 0.58 N sideways cable pull (I assumed 0.3 N).
- The LED's light, the screen's centre and corners, and the sensor's vents are all clear.
- All 15 planted faults were caught.
- **Bought parts are envelopes** at the sizes in their datasheets and Adafruit's board files.
- **The vent gate rests on a number of mine.** It passes at 0.449 open against my own 0.4 threshold; Sensirion publishes no figure.
- **Not modelled:** the two resistors, the STEMMA QT cable and the hand wiring. I checked their routing by hand, which is how I found the LED-lead clash (fixed in the steps).
- **Estimated masses:** the Pico, LED, inserts, screws, feet and USB cable. The SCD-40 and OLED masses are Adafruit's.

**Still estimates. Check these on the first unit:**
- **OLED board size:** I used Adafruit's board file (29.21 x 31.75 mm). The product page says 29.2 x 26.7 mm, so measure yours.
- **OLED glass position and screen offset:** these come from drawings that came through unclearly. The window is 1.3 mm oversize each way to absorb this.
- **SCD-40 board thickness:** taken as 1.2 mm.
- **Small part sizes:**
  - the LED's flange and seated height
  - the JST socket bodies
  - the height of the Pico's USB socket
- **USB cable:** its moulding must be at most 11 x 8 mm to reach the socket.
- **Pilot holes:** 1.7 mm for M2 screws cutting their thread in PLA.
- **Assumed numbers:**
  - the Pico's 30 mA
  - the 0.3 N cable pull
  - the vents' open share

**No board.** There is no `sprue pcb` or `sprue verify` for this design.

**Firmware.** `software/code.py` (CircuitPython) is written by hand, because Sprue only generates and emulates firmware for keypads. It has had a syntax check and nothing more.

**Not checked:**
- `sprue shot` needs Chrome, which isn't installed and isn't one of the allowed installs, so I took no screenshots.
- I rendered the figure with a small script of my own (rest, apart, steps, zooms). The render shows the shapes, but not the screen text, the x-rays or the hover.

**No price yet.** That is stage 2.

**Accept, edit or decline?**
- **Accept and source it:** run `sprue accept co2-monitor`, then stage 2 finds offers and quotes it.
- **Edit something:** tell me what to change, and I'll update it and propose it again.
- **Decline:** run `sprue decline co2-monitor '<why>'`, then tell me what to change, or stop.
