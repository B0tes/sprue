# Blind run: a desk CO2 monitor, 2026-10-19

Tobias asked (2026-10-19) to run a whole new product through Sprue and see where it breaks: in the design, the
sourcing or the build. This folder is that run: a fresh agent given only one line, graded against an answer key it
never saw.

## Result in one paragraph

Sprue got the product through all three stages, to a hand-wired build that would mostly work, for EUR 147.04
landed in Italy (the key's band is EUR 60-175). But **none of the 13 traps the key could apply was caught by one of
Sprue's own built-in checks.** Sprue did the arithmetic (packs, stock, shipping, one frame for the parts, the gates),
and the agent wrote every engineering check itself (242 lines of `rules.ts`, a 192-line `_system.py`). Graded
against the key: 6 traps pass, 5 pass in part and 2 fail. An independent audit then confirmed 9 places where Sprue
gives a **wrong answer without saying so**. The worst: every figure is drawn as a mirror image of its CAD, a failed
check stops nothing, and an old STL can ship after the design changed.

## How it was run

- **Idea, all the agent got:** "A desk CO2 monitor with a small screen and a light that goes green to red, powered
  by USB." The user was Tobias, in Italy, one unit, can solder, accepts each gate once it is ready.
- **Skill:** a clean copy of `skills/sprue` at commit 07a1ef0 (main plus PRs #15 and #16), in an empty folder, as a
  user would have it installed. One agent per stage: `/sprue <idea>`, then `/sprue accept co2-monitor` twice.
  Each logged every error, workaround, estimate and gap in `journal/`.
- **Answer key:** `evals/ideas/keys/co2-monitor.json` (summary in `co2-monitor.md`). It was written by separate
  agents from four real monitors and the sensor datasheets, then checked by two reviewers. It holds facts and links
  only, no copied files:
  - Curious Electric's CO2 Monitor, GBP 44.95 kit
  - KnowCO2, OSHWA US002828
  - Watterott's CO2-Ampel, from EUR 81
  - AirGradient ONE, USD 138 kit

  The key lists the roles, 15 traps, a cost band and every architecture it accepts.
- **Grading:** four graders (electrical, mechanical, firmware and build plan, sourcing and cost), each with a
  skeptic trying to refute its verdicts. An audit of Sprue itself reproduced each logged break in a copy. All of
  it is in `grading.json`.
- **Caveat:** the run's agents also had the repo's CLAUDE.md in their context, which describes Sprue's internals.
  They were told to ignore it. The answer key was never in reach.
- **Time:** about 75 min (design), 30 min (source) and 14 min (build). Nothing was ordered, quoted or uploaded.

## What it designed

- **Parts:** a Raspberry Pi Pico, an Adafruit SCD-40 breakout (the order actually buys the SCD-41), a 0.96 in
  SSD1306 OLED and a red/green bicolour LED on PWM.
- **Build:** hand-wired, with no custom board, in a two-part PLA case printed on a friend's printer.
- **Firmware:** CircuitPython, written by hand.
- **Quote:** 15 lines from three EU shops (BerryBase, Opencircuit, TME), $165.46 = EUR 147.04.

## Graded against the key

| Trap | Result | Who caught it |
| --- | --- | --- |
| Sensor supply in range at its peak current | PASS | the agent's `rules.ts` |
| Logic levels between parts | PASS | the agent's judgement |
| LED drive and supply | PASS | the agent's `rules.ts` |
| USB current budget | PARTIAL: peaks only, no per-load averages | the agent's `rules.ts`; Sprue's own `usb-power` counts only the controller |
| USB-C CC resistors | N/A (micro-USB on the Pico) | |
| SCD30 bus speed | N/A (SCD4x) | |
| Vents to the sensor | PASS | the agent's `_system.py` probe, at a threshold it chose itself |
| Sensor away from heat | PASS | the agent's `rules.ts` |
| Screen, light and USB reachable | **FAIL:** the top 31% of the screen sits behind the front wall | nobody: the window, the probe and the rule all read the same wrong guess of where the glass is |
| Colour thresholds in ppm, sourced | PARTIAL: UBA's 1000/2000 ppm, but no hysteresis or averaging | the agent's `rules.ts` |
| Self-calibration (ASC) | PARTIAL: default stated, no forced-calibration procedure | the agent's judgement |
| Warm-up and fault state | PARTIAL: after a sensor dropout the light stays green on the last value forever | the agent's judgement |
| EU sourcing for Italy | **FAIL:** the OLED and the inserts have stock "unknown"; the OLED's page was never read | nobody: Sprue's stock filter lets "unknown" through |
| Landed cost in Italy | PASS: 22% VAT and shipping per shop | the agent, by hand (Sprue is USD only) |
| Build plan: flash, test, calibrate | PARTIAL: no rail check before the sensor goes in, no test that shows red, glue near the sensor with no warning | the agent's judgement |

Cost: EUR 147.04 is inside the EUR 60-175 band. It is still 2.45 times the cheapest sound build in the key: the OLED
costs EUR 26.72 where one at EUR 7 exists, and three parcels add EUR 28.73. It is also 65% over the $100 the agent
assumed for the user. The design also tips backwards at a 0.20 N cable pull; only a sideways pull was tested.

The run used no custom board, which the key accepts. So the PCB kit's two-footprint limit, and the dry probe's
keyless board that came out VERIFIED (`research/pcbtracer-vs-sprue.md`), were not exercised.

## Where Sprue broke

Each of these was reproduced by the audit in a copy (evidence and commands in `grading.json`).

**Wrong answers, given without warning**

1. **Every figure is a mirror image of its CAD.** The kit's `iso()` is left-handed (`skills/sprue/kit/iso-kit.mjs:11-15`),
   while `reference/figure.md` says to draw in the CAD's right-handed frame. The shipped keypad figure puts the USB
   cable on the left; its design and CAD put it on the right (checked). Ponder's figure uses the same kit, so the
   site's worked example is mirrored too (inferred, not checked).
2. **A failed check stops nothing.** `sprue check` and `sprue all` exit 0 with a failed check. `package` ships, and
   `accept` prints "every stage accepted" (`pipeline/cli.ts:244-258`, `:481`, `:519-543`).
3. **Old files ship.** After a change to the case's height and `sprue all`, the system check passed on the new
   geometry, and status showed `fab/` current. Then `package` shipped the old STL, priced at the old volume. The only
   check that an STL is the current export lives in `sprue score`, which runs only with an answer key.
4. **A different part is bought without a word.** The order buys an SCD-41 on the SCD-40 line, and PVC wire on a
   silicone-wire line; the checks still describe the SCD-40. Offers are matched to lines by id only
   (`pipeline/stages/source.ts:10-24`).
5. **Region IT is ignored.** Everything is in USD with US rates. The agent converted every EUR price by hand, with a
   107-line script.
6. **The firmware crashed at boot, and no check could see it.** Firmware exists only for keypads. The agent's
   hand-written `code.py` read the sensor's serial number after starting measurements, which the SCD4x refuses; the
   agent found this by hand in stage 3. `package` leaves `code.py` out, although the build plan says to copy it.
7. **The whole-product check skips wires, resistors and cables, and never checks how parts go in.** The agent
   found by hand that the LED's leads would hit the sensor board, and that the lid can't close with the USB plug in.
   A batch line (the wire) is dropped without being named.
8. **Gate 1 is proposed without anyone having looked at the figure.** There is no Chrome here, so no shot was
   taken, and nothing requires one.
9. **A misspelt price field gives a $NaN total**, with exit 0. `catalog.json` is not validated.

**Manual work every new product needs**

- Writing 1,766 lines by hand: CAD 399, `_system.py` 192 of them, `rules.ts` 242, `figure.mjs` 306, `code.py` 104,
  `design.json` 198, and a generated 517-line catalog. On top of that, 425 lines of helper tools: a board-file
  reader, an SVG renderer, the currency converter, a firmware mock and a mesh check.
- The built-in checks are keypad-shaped. The agent wrote its own, and had to turn off a keypad rule that a shared
  param name (`footHeightMm`) pulled in.

The smaller gaps (unclear docs, cosmetic labels) are in `grading.json` under `integrity.breaks`.

## What to fix, in order

These are now PLAN items at the top of the test suite.

1. **Draw figures the right way round:** a right-handed `iso()`, both examples and the site regenerated, and a kit
   test that pins the handedness.
2. **Make a failure stop the run:**
   - exit codes on check and all;
   - accept and package refuse a failed check or a stale export;
   - the mesh audit runs in cad and package;
   - catalog.json is validated;
   - each offer's part number is held to its line's part number or alternates.
3. **Generic checks keyed to roles, not keypad params:**
   - a USB budget that sums every line's current;
   - walls for any printed part;
   - standards for any powered product;
   - the wall table passed to `rules.ts`.
4. **Firmware for any product:** a declared firmware file that the plan lists and package ships, and the emulated
   Pico run with I2C stand-ins (an SCD4x, an SSD1306).
5. **Quotes for Italy** (already in PLAN, now higher): EUR, VAT per offer, EU shipping tables, EU print rates.
6. **Whole product, more honest:**
   - unplaced lines flagged;
   - leads and cables as swept envelopes;
   - insertion paths;
   - pulls in every direction.

Then run the same idea again with a fresh agent, to measure the change, and a second idea that needs a board.

## Files

- `products/co2-monitor/`: the run's sources and outputs. Not copied: the STLs and STEPs, `view.html`,
  `explorer.json`, `figure.svg`.
- `journal/`: each stage's log and what it showed at its gate.
- `tools/`: the helper scripts the agent had to write.
- `grading.json`: every verdict, the skeptics' changes, and the audit of Sprue.
