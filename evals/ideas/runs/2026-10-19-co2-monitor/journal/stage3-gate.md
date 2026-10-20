**Gate 3: the build plan is ready (desk CO2 monitor, `co2-monitor`)**

**Page:** products/co2-monitor/view.html
**Link:** file://products/co2-monitor/view.html

The page now has a Build section with the steps (each one shows in the figure), the order list and the files. This shell has no browser, so open the link in yours, or reload it.

**What it is.** A 64 x 26 x 60 mm printed desk box. It reads CO2 every 5 s, shows it on a 0.96 in OLED, and fades an LED from green to red between 1000 and 2000 ppm. It runs off USB and has 15 assembly steps.

**Total: $165.46 for one unit, delivered to Italy (about EUR 147 at the checkouts).** That is over the $100 budget. The $100 was my guess from "not expensive"; you never gave a number. The order goes to three EU shops (BerryBase, Opencircuit, TME), so there are no customs. The longest lead time is 33 days, set by the inserts.

**Not in the total:**
- the gap between the dollar figures and what each checkout charges in EUR;
- a spool, failed prints and power: the prints count as 36 g of filament on your friend's printer;
- an online print service, which wasn't priced;
- solder, heat-shrink, hot glue, a heat-set insert tip and a USB charger.

Packs leave spares: 46 inserts and 96-98 of each screw.

**Checks:**
- **Engineer checks:** 16 ran, none failed, and 3 are flagged: standards, sensor heat (set `TEMP_OFFSET_C` against a thermometer) and the weekly airing the sensor needs to self-calibrate.
- **Whole-product check (`sprue system`): PASS.** All 25 parts fit, with no overlaps. It tips at 15.2 deg, and the screen, LED and vents are clear. All 15 planted faults were caught.
  - The bought parts are boxes at their datasheet sizes, not their makers' models. Several sizes and masses are my estimates.
  - The resistors, the STEMMA QT cable and the hand wiring aren't modelled.
  - It doesn't check the current through the whole circuit, heat, a drop or interference.

**No circuit board.** `sprue verify` has nothing to check, so in Sprue's terms the board is UNVERIFIED (exit 2), and there is no `pcb/order/`. That's expected for this design: there is no board to order.

**Fixed in this stage:**
- **A bug that would have stopped it at boot.** The firmware read the sensor's serial number after starting its measurements. The SCD4x refuses that command while it measures (datasheet command table), so `code.py` would have crashed on start-up. I moved the read before the start.
  - I then ran `code.py` on this computer against stand-ins for CircuitPython's modules. It boots, the light goes green to yellow to red at the right readings, and a missing screen, a missing sensor or a read error is shown properly. The old order crashes as expected.
  - This doesn't prove it on a Pico: Sprue's emulated-Pico test only covers keypads. Step 11 tests it on the bench before you close the case.
- **The tool list.**
  - **Screwdrivers:** TME's pages say the M2 screws are PH1 (the list said PH0) and the M3 button heads take a 2 mm hex key, not a Phillips.
  - **Multimeter:** step 9 needs one and it wasn't listed.
  - **Heat-shrink:** step 9 needs 3 pieces, one each for the two resistors and the cathode joint, not 2.
- **Step 7** now says the order buys Adafruit's SCD-41 board. It is the same size and shape as the SCD-40.
- I rebuilt the CAD so the print files match the design as it stands now. The shapes didn't change.
- None of this moved the cost or any check.
- I did not reopen the design for these fixes. Tell me if you want them treated as a design change.

**In `products/co2-monitor/production/`:**
- `build-plan.md`
- `order-list.csv`, with what to put in each cart
- `shell.stl` / `shell.step` and `lid.stl` / `lid.step`: both prints are closed solids at their quoted volumes.

**Missing from `production/`: the firmware.** Sprue packages firmware only for a keypad's board, so copy it from `products/co2-monitor/software/code.py` (step 2).

**First unit, check these:**
- the OLED board's size: Adafruit's page and its board file disagree;
- that an M2 screw bites in a 1.7 mm pilot hole;
- the USB plug's moulding: at most 11 x 8 mm.

**The change that would cut the cost most:** a cheaper 0.96 in SSD1306 screen in place of the Adafruit one would bring it to about $146. That reopens the design gate, because the front of the case would need redrawing. Getting near $100 would also need a cheaper CO2 module.

**It's ready.** You can order the parts by hand and build it. Nothing has been ordered, uploaded or paid for.

**Accept the build or change something?**
- **Accept:** run `sprue accept co2-monitor`. That marks the run done.
- **Change something:** tell me what, for example the OLED swap.

After that: what felt wrong or slow in this run? That's how Sprue gets better.
