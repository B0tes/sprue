# What Sprue can build today, how often it is wrong, and how to fix it

Written for Tobias's question of 2026-10-20 ("what are our limits on what our skill can build, how many mistakes are we still making, how many tests are we failing and how can we overcome them").

An audit of `main` at 908dce1 (PR #18 merged), run on 2026-10-20 in a clean worktree, then checked the same day by a second reviewer against `origin/main`. Every path below is relative to https://github.com/B0tes/sprue/blob/908dce1/ (skill files under `skills/sprue/`).

Setup: nothing was installed. build123d 0.13.0, gerbonara 1.6.3, shapely 2.2.0 and KiCad 7.0.11 were already present. `~/.cache/sprue/venv` does not exist, so the read-back used `python3` on the PATH. There is no Chrome, so no figure shots were taken. All probes ran on copies in scratch worktrees. Those worktrees have been removed, and `/home/claude/sprue` is untouched. The reviewer re-ran silent wrong answers 2 and 9 on a copy of the CO2 product. Nothing else was re-run.

## The short answer

- **All 201 pipeline unit tests pass, but none of them runs in CI. All 10 seeded faults on the keypad are caught.** The score still fails on both examples, and the gates that fail them point at real faults in the designs. The one exception is Ponder's stability gate, which passes only because the design accepts six tip-overs (see (a)).
- **The checks are keypad-shaped.** Of the 17 built-in engineer checks, none ran its own logic on the CO2 monitor or on Ponder. Every check that ran on them was written for that one product (`rules.ts`), by the same agent that drew the design.
- **Silent wrong answers: 8 of the 9 from the blind run are still on main.** Only the mirrored figure is fixed (PR #18). The 9 are the README's summary of 18 entries that `grading.json` tags `silent-wrong-answer` (14 confirmed, plus 4 new). At least 4 confirmed ones are not among the 9 and are still present (listed under (b)).
- **A user's own product is never scored.** `sprue score` runs only when `reference/reference.json` exists (`pipeline/cli.ts:327-331`). The stale-export check, the mesh audit, the unpriced-line failure and the seeded-fault gate all live only in the score. So for any product without an answer key they gate nothing.
- **Exit codes don't stop a bad run.** `check`, `quote`, `score` and `package` never set a failing exit code. `all` fails only when the figure fails (`cli.ts:476-541`).
- **Sprue can take a Pico keypad end to end, to files.** Nothing has been ordered, printed, built or measured (`PLAN.md:15,71`). It can take a hand-wired module product only partly, and only because the agent writes the checks itself. It cannot do these yet:
  - a custom board with other chips;
  - mains power;
  - batteries;
  - soft goods;
  - made metal parts.

## (a) What Sprue can take, by product class

| Product class | Today | Why (evidence) |
|---|---|---|
| Keypad-like Pico board | **End to end, to files only** | **Board: VERIFIED** (`sprue verify macropad`). That means the audit, the read-back, and the firmware on an emulated Pico (45 presses, 0 errors; `LOG.md:240`). Two limits: the firmware check reads a KMK hook, not the USB reports a host would see (`PLAN.md:84`), and the KiCad cross-check (0 errors on 5 rule sets, 129/129 netlist records) does not hold the board back and has never run on the 3 seeded board faults (`PLAN.md:30,46`). Seeded faults: 10 of 10.<br>**Score: NOT YET**, because of a case fault. The USB overmold shares 1.04 mm3 with the tray wall, and the screw heads have 0.15 mm a side, under the 0.2 mm gap (`system.json`; `PLAN.md:72-80`). The overmold's 11 x 8 mm is an estimate (`PLAN.md:78`).<br>**Not built:** no board ordered, no case printed (`PLAN.md:71-72`).<br>**Other controllers:** a XIAO, for example, is not possible yet. The board kit has 2 footprints (`pipeline/pcb/footprints.ts:193-196`). |
| Modules wired by hand | **Partly** | The CO2 run reached all three gates at EUR 147.04 (`evals/ideas/runs/2026-10-19-co2-monitor/README.md:9-16`).<br>**Checks:** 0 of 17 built-ins ran their own logic. 12 were skipped, 4 were replaced by `rules.ts` (usb-power, usb-reach, print-walls, standards) and 1 was turned off (`co2-monitor/rules.ts:23`; `checks.json`).<br>**Firmware:** written by hand and never run by Sprue. The agent found the boot crash in stage 3 by reading the SCD4x datasheet, then ran the code on a 170-line host mock it wrote itself (`journal/stage3.md:16-18`; `tools/fwmock_run.py`).<br>**Frame:** 3 of 15 BOM lines are not in the whole-product frame. Two are named (the resistors and the Qwiic cable). The wire is dropped without a word (item 7 below). |
| Custom board with other chips | **No** | The kit can place only the Kailh socket and the Pico (`footprints.ts:193-196`). A board with no keys is checked only for the controller's supply and control pins against ground, and for its 5 V against the pins that take 3.3 V. Nothing holds it to the circuit the design asked for (`pipeline/verify.ts:198`). In an earlier dry probe, a board with the sensor wires swapped and connected to nothing came out VERIFIED (`research/pcbtracer-vs-sprue.md:53`). No board of this kind has been tried since (README:73-74). |
| Mechanisms with moving parts | **Partly (statics only)** | Ponder's arm is modelled as poses with pushes in fixed directions. That gives tip-over and nothing else (`cad/system.py:132-152`).<br>**Ponder's stability gate passes only because the design accepts six tip-overs:**<br>• a 2 N push forward at head height tips it at 1.34 N;<br>• 5 N down on the head tips it at 4.79 N;<br>• the arm pulled straight out tips it in all four directions.<br>(`ponder/system.json` stability; `ponder/rules.ts` tip-push and tip-arm-straight.) Ponder is a children's product.<br>**Pushes:** the designer chooses which pushes to test. The CO2 unit tips backwards at a 0.20 N cable pull, and only a sideways pull was tested (README:71).<br>**Not covered:** a range-of-motion sweep, joint torque (`armHoldNm` waits for unit 1, `PLAN.md:52`) and FEA (`PLAN.md:57`). |
| Mains-powered | **No** | No rule in `pipeline/` or `cad/` mentions mains (grep). The built-in `standards` check only flags, and it needs `keyRows` (`stages/check.ts:427-438`). Certification is out of v0 (`PLAN.md:15`). `SKILL.md` and `reference/` say nothing about what Sprue can't build, so the skill accepts any idea. A bought USB wall supply, as Ponder uses, is the only safe pattern today. |
| Batteries | **No** | No battery, charger or runtime rule exists: a grep of `pipeline/` and `cad/` for battery, lipo, lithium or charger finds nothing. There is no charger footprint and no lithium shipping rule. |
| Soft goods | **No** | The only processes are `buy`, `pcb`, `print`, `cnc` and `sheet` (`pipeline/types.ts:18`). |
| Metal parts | **Bought: yes. Made: no** | `cnc` and `sheet` exist only as names. `fabOptions` prices only `pcb` and `print` (`pipeline/adapters/fab.ts:103-108`), so a made metal part has no price. `quote` prints "not priced" and still exits 0. Only the score fails it, and the score needs an answer key (`docs/pipeline.md:48-50`). There are no CNC or sheet-metal rules (`PLAN.md:57`) and no supplier API (`PLAN.md:21-22`). Ponder's bought gooseneck and steel ballast price fine (`ponder/quotes.json`). |

## (b) The numbers

| What | Result | Source |
|---|---|---|
| Pipeline unit tests | **201 of 201 pass**, 0 fail, 0 skipped. 18 files, 470 s when run one file at a time. The count of 201 was rechecked. The time was not re-run | `node --test` on each `skills/sprue/pipeline/**/*.test.ts` |
| Tests in CI | 0. CI runs only lint and the build, so `src/app/install/route.test.ts` is not run either | `.github/workflows/ci.yml`; `PLAN.md:36` |
| Keypad engineer checks | 17 run: 0 failed, 3 flagged (standoff walls 1.8 mm, the plate and skins, standards), 0 skipped | `sprue all macropad`; `macropad/checks.json` |
| Keypad whole product | 5 of 7 gates pass. Overlap and clearance fail. 12 of 12 self-tests caught | `sprue cad macropad` (exit 1); `macropad/system.json` |
| Keypad board | **VERIFIED**: read-back self-test 3/3, firmware self-test 3/3, KiCad faults 4/4 | `sprue verify macropad` (`pcb/` is git-ignored, so this was not rechecked from the repo) |
| Keypad seeded faults | **10 of 10 caught, 0 false alarms**, 303 s (the committed `faults.json` says 306.8 s). First catcher: checks 4, board audit 3, system 1, figure 1, score 1. The "Pico with no offer" fault is caught only by the score, so on a product with no answer key nothing would catch it. The fault list was written alongside these checks: v0 caught 9 of 10, then a wall check was added for the one it missed (`PLAN.md:31-32`) | `sprue faults macropad`; `macropad/faults.json` |
| Keypad score | **NOT YET** (whole product): $83.34, +23.5% against the $67.50 midpoint, coverage 100%, files 3/3. `sprue all` still exited 0. The $55-80 band is the team's own estimate (`research/macropad-prices.md`) | `macropad/score.json`; `reference/reference.json` |
| Ponder engineer checks | 26 run: 0 failed, 9 flagged. All 26 come from its own `rules.ts`, which also replaces `standards`. 16 built-ins are skipped today. The committed `checks.json` says 14, because it predates `print-walls` and `print-skins` | `sprue all ponder`; `ponder/checks.json` |
| Ponder whole product | 5 of 7 gates pass. Clearance fails (6 pairs under 0.2 mm). Function fails (4 metal parts 8.9-11.5 mm from the Pi's antenna). 19 of 19 self-tests caught. **7 of 38 BOM lines are not in the frame:** 6 are named in `unplaced`, and the batch wire line `wire22` is dropped without a word, so the gate reads "31 of 37" and passes (`cad/system.py:476-485`). Stability passes with 6 tip-overs accepted | `sprue cad ponder` (exit 1); `ponder/system.json`; `ponder/bom.json` |
| Ponder board, faults and score | No board (`verify` exits 2) and no fault list. Score **NOT YET**: $5,371.43 for 20 units, +16.1%. Its answer key is partly circular: the roles use Ponder's own role names (case-base-top and so on), and the $4,250-5,000 band is priced from Ponder's own parts list. So its 100% coverage and +16.1% carry little weight | `sprue verify ponder` (`verify.ts:387-389`); `ponder/score.json`; `ponder/reference/reference.json` |
| New finding on Ponder | No wall check covers Ponder's 6 printed parts. `print-walls` and `print-skins` need keypad params (`caseWallMm`, `pcbWidthMm` and others), and even with those params they read only parts with the roles `case-top` and `case-bottom` (`check.ts:229,405-420`). Ponder's roles are `case-base-top` and the like, and its `rules.ts` has no wall rule | rerun; `ponder/design.json`; `ponder/bom.json` |
| CO2 blind run traps | Of 15 traps, 13 apply: 6 pass, 5 partial, 2 fail (2 do not apply). **0 caught by a Sprue built-in check.** This is one run (n = 1), and its agents had the repo's `CLAUDE.md` in context (README:37-38) | README:51-67 |
| Silent wrong answers | The README lists 9, condensed from 18 entries tagged `silent-wrong-answer`. Of the 9, **1 is fixed and 8 are still present**. At least 4 more confirmed ones are not in the 9 and are still present (list below) | README:76-109; `grading.json` `integrity` |
| All logged problems from that run | The audit re-checked 35 logged breaks: 25 confirmed, 7 partly confirmed, 2 refuted, 1 unverifiable. It also found 8 new ones (4 silent wrong answers, 3 cosmetic, 1 blocking). The 9 above are among these, not in addition | `grading.json` `integrity.breaks`, `new_breaks` |
| Cost that is estimated, not read from a page | **Keypad: $51.69 of $83.34 (62%).** That is $34.69 of estimates plus the $17.00 board, priced from JLCPCB's formula in `rates.json`, which is marked `verified: false`. **Ponder: $1,636.61 of $5,371.43 (30%).** The rest are page snapshots read on 2026-10-13 and 14. None of it is live, and no line is a real quote | `quotes.json` `mode` and `basis`; `pipeline/rates.json:4,7,8` |

**The 9 silent wrong answers, checked on main:**

1. **Mirrored figure: fixed.** The projection is right-handed now (`kit/iso-kit.mjs:6-17`), and `projection.test.ts` passes 11/11. One caveat: the CO2 run's own `figure.mjs` flips y to make up for the old kit, so redrawn today it would come out mirrored (README:86-90).
2. **A failed check stops nothing: still present.** In a copy of the CO2 product, `usbBudgetMa` was set from 500 to 100. The keypad's own 25 mA controller would still pass at 100.
   - `check` printed "1 failed" and exited 0.
   - `package` exited 0.
   - `accept` printed "every stage accepted" and exited 0.
   - The reviewer reproduced all three today.

   In the code, `cli.ts:481` sets no exit code, and `cli.ts:541` exits 1 only on a figure error. `state.ts:96-119` never reads `checks.json`. A gate reopens only on an explicit `propose` (`state.ts:137-145`), so an edit made after `accept` leaves the design accepted. The keypad's own `all` also exits 0 while its score says NOT YET.
3. **Old STL ships: still present.** In the CO2 copy, `caseHeightMm` went from 60 to 66, then `all` ran.
   - The system check rebuilt the geometry and passed.
   - `status` listed `fab/` with no warning: it checks only that the folder exists (`status.ts:29`).
   - `package` shipped an STL with the old sha256: 60 mm tall, 21.31 cm3.

   `all` has no CAD step (`cli.ts:519-543`). `exportStale` and `meshAudit` are called only by the score (`stages/score.ts:344,592-595`), never by `packageStage` (`cli.ts:349-406`). The score itself runs only with an answer key (`cli.ts:327-331`).
4. **A part other than the one the line names is bought without a check: still present (overstated before).** The quote buys ADA5190 (SCD-41) on the SCD-40 line. That part is listed in the line's `alternates` (`co2-monitor/bom.json:59`), and the agent wrote "(bom.json alternate, same board)" into the offer's sku. But no Sprue code compares an offer's `mpn` with the line's `mpn` or `alternates`: offers are matched by line id alone (`stages/source.ts:10-24`), and `Offer.mpn` is optional (`types.ts:82`). So a part that is not an alternate would pass just as quietly. The PVC wire on the silicone-wire line has no note at all. The checks still use SCD-40 numbers.
5. **Region IT ignored: still present.** `request.json` says region IT, and the quote prints $165.46. `quotes.json` has no currency or region field. `new` defaults to US (`cli.ts:147`), `region` is free text (`types.ts:11`), and nothing in the quote reads it. The agent converted EUR to USD by hand (`build-plan.md:9`).
6. **Firmware only for keypads: still present.** The firmware runs only for a keypad board (`verify.ts:9,254-255`). `package` ships it only with a board zip (`score.ts:224-229`; `cli.ts:386-397`). Step 2 of the CO2 build plan says to copy `software/code.py` "in this product's folder" (`build-plan.md:65`), but `production/` has no `code.py`, and nothing says so.
7. **The system check skips wires and insertion paths: still present.** For the CO2 monitor it reports "25 parts from 12 of 14 BOM lines", but the BOM has 15 lines. The batch wire line (`qtyPerUnit` 0) is skipped without being named (`cad/system.py:476,485`). The same happens to Ponder's `wire22`. Unplaced lines still pass (`:478`). Nothing checks how a part goes in.
8. **Gate 1 is proposed with nobody having looked: still present.** `sprue figure` printed "design proposed" with no `shots/` folder and no Chrome (`figure.ts:296`).
9. **A misspelt price gives $NaN: still present.** The reviewer reproduced it today by renaming `unitUsd` on one offer:
   - `validate` exits 0, because it never reads `catalog.json` (`cli.ts:154-193`);
   - `source` dies on a bare TypeError;
   - `quote` prints "$NaN" and exits 0;
   - `plan` crashes with a TypeError.

**Confirmed silent wrong answers that are not among the 9, still present:**
- `validate` passes a print line whose `volumeCm3` is a string such as "pending: from sprue cad". It tests only that the value is truthy (`cli.ts:181`; `PLAN.md:38`).
- An offer with stock "unknown" passes the source filter (`source.ts:18`). The CO2 OLED and inserts went through this way, which is why the "EU sourcing for Italy" trap failed (README:65).
- A line with only one offer, or with all its offers from one shop, is not flagged (`grading.json`; `PLAN.md:38`).
- The assembly text is never compared with the CAD, the BOM or the offers (`grading.json`).
- Pass thresholds are set by the designer. The CO2 vent probe passed at an open share of 0.4 that the agent chose with no published basis (`grading.json`). Ponder's six tip-overs pass as "accepted".
- Common-mode error: the CO2 screen-window trap failed because the window, the probe and the rule all read the same wrong guess of where the glass sits (README:61). A check that reads the same params as the design can't catch a wrong param.

## (c) What no check covers yet

- **Current through the circuit.** The built-in `usb-power` doubles the controller's current and ignores every other line (`check.ts:263-268`). There is no netlist across the modules, no power tree and no wire drop (`PLAN.md:49`).
- **Heat.** There is no built-in heat check. The CO2 `sensor-heat` rule was written by the agent, and it only flags. Ponder's heat model and soak test are still open (`PLAN.md:52`).
- **Strength (FEA).** Nothing. CalculiX was tried once, by hand (`research/testing-plan.md:22`; `PLAN.md:57`).
- **Materials.** Process and material names are matched against a table of the least wall each process allows (`check.ts:33-49`; `PLAN.md:32`). No check reads a material property such as strength, temperature or creep. The 25-50% weakness of an FDM part across its layers is not modelled (`testing-plan.md:26`).
- **Drop.** Ponder's drop rule says "No check here can show it" and only flags (`ponder/rules.ts:314-329`).
- **Tolerance stack-up.** There is one fixed gap and no stack (`PLAN.md:48,57`). The keypad's worst case is 0.66 mm of interference over the Pico, which the nominal check passes (`PLAN.md:75`).
- **Assembly order.** Only the final, assembled state is checked. There are no insertion paths (`PLAN.md:42`), and the assembly text is never compared with the CAD (`grading.json`).
- **Cost against real quotes.** No quote has ever been taken. The metric is ±25% of a reference band, not of a real quote (`PLAN.md:5`). Both bands were built by the team, and Ponder's from Ponder's own parts. Between 30% and 62% of each total is an estimate.
- **The checks themselves.** On a new product, every check that ran was written by the agent that designed it, and nothing tests those checks. Seeded faults exist only for the keypad (`PLAN.md:45`).
- **Also uncovered:**
  - printed walls on any part that is not a keypad case;
  - firmware for anything that is not a keypad;
  - the figure itself, which nobody has to look at;
  - EMC, beyond one radio keep-out probe;
  - stock that a shop lists as "unknown";
  - a product's scope: nothing says up front that a product is out of reach.

## (d) How to get past these limits, in priority order

One "run" means one daily slice, or one small PR (`docs/daily-loop.md`). The effort figures are the auditor's estimates.

1. **Make a failure stop the run** (`PLAN.md:38`), 1-2 runs.
   - **What changes:** `check`, `all`, `quote` and `package` exit 1 on a failure. `accept` and `package` refuse a failed check, a stale export or a bad mesh. The export and mesh checks move out of the score, which needs an answer key, into `cad` and `package`.
   - **What it closes:** silent wrong answers 2, 3, 4 and 9, plus the pending-volume and one-offer cases above.
   - **Eval:** add *process faults* to the seeded faults:
     - a failed check must exit 1 and block `accept` and `package`;
     - a stale STL must be refused;
     - a misspelt price must fail `validate`;
     - a part number off the line and off its alternates must be named;
     - stock "unknown" must be flagged.
2. **Say "Sprue can't check this" at the start**, about 0.5 run. This covers mains, lithium cells, soft goods and made metal parts, written into `SKILL.md` and the design gate. A plain flag beats a silent pass.
3. **Run the 201 tests in CI** (`PLAN.md:36`), 0.5-1 run. Run one file at a time, the suite takes about 8 minutes. The Python and KiCad tests need their packages installed in CI.
4. **Start the real build now, in parallel** (`PLAN.md:71`). It needs Tobias's OK and money. It is the only calibration there is (`testing-plan.md:25-28`).
   - Order the keypad boards.
   - Print the case after its second pass.
   - Measure each fit and record it against the prediction (the bring-up sheet, `research/pcbtracer-vs-sprue.md:40`).
   - Get 3-5 real quotes to measure how far the estimates are off.

   Preparing it takes 1 run. Shipping time is unconfirmed.
5. **Make the built-in checks work by role, not keypad params** (`PLAN.md:39`), 2-3 runs. Today 0 of 17 run on a product that is not a keypad, and the wall checks match only the roles `case-top` and `case-bottom`.
6. **Build idea set v0 with answer keys** (`PLAN.md:55`). This is the headline eval.
   - **Ideas:** pick 10 one-liners, at least one per class in (a).
   - **Effort:** the CO2 key took separate agents and two reviewers, so allow about 1 run per key, 5-10 runs in all. Each blind run takes about 2 h of agent time (75 + 30 + 14 min, README:39), plus grading time the README doesn't record.
   - **Blind:** keep `CLAUDE.md` out of the blind agent's context.
   - **Score:**
     - traps caught by Sprue's own checks (0 of 13 today);
     - traps caught only by the agent;
     - traps missed;
     - silent wrong answers.

   Then repeat the CO2 run, and add a second idea that needs a custom board (`PLAN.md:43`).
7. **Electricity through the whole product** (`PLAN.md:49`), 3-5 runs: a typed netlist and power tree, then ngspice. Seeded faults to add:
   - a 5 V pull-up on a 3.3 V pin;
   - a part on the wrong rail;
   - a wire too thin.
8. **Make the whole-product check more honest, and add a tolerance sweep** (`PLAN.md:42,51,57`), 2-3 runs.
   - Name every unplaced line, batch lines included.
   - Use swept envelopes for leads and cables.
   - Check insertion paths.
   - Push from every direction.
   - Grow and shift each part by ±0.3 mm.
   - Make each "accepted" tip-over a flag that is carried to the gate.
9. **Firmware for any product** (`PLAN.md:40`), 2-3 runs: run it on the emulated Pico with SCD4x and SSD1306 stand-ins. Seeded firmware faults to add: a wrong key code, and the SCD4x read-order bug.
10. **Seeded faults v1** (`PLAN.md:45`), 1-2 runs.
    - **Today:** 10 faults, all on the keypad: 4 mechanical, 3 board, 3 BOM.
    - **Aim:** at least 3 per gate, a list for Ponder, and faults planted in each blind run's agent-written `rules.ts` and `_system.py`, where every catch on a new product came from.
    - **Rule from now on:** every new check lands with a planted fault and a clean case.
11. **Custom boards**, 5 or more runs: footprints from KiCad's libraries, and a keyless board held to a design netlist (`verify.ts:198`). Then the PCBSchemaGen adapter (`PLAN.md:56`). Make the KiCad layer blocking once it agrees with `drc.ts` on the seeded board faults (`PLAN.md:46`).
12. **Physics, only when a product needs it**, 1-2 runs each: the slicer gate (`PLAN.md:53`), CalculiX for load-bearing parts, and a lumped heat model (`PLAN.md:52,57`).

## What this review changed

- **Ponder unplaced lines:** 6 of 37 became 7 of 38. The batch wire `wire22` is dropped without a word, as the CO2 wire is.
- **Keypad estimated cost:** 42% became 62%. The $17 board is priced from an unverified JLCPCB formula.
- **"Other confirmed problems":** these are all the logged breaks, and the 9 silent wrong answers are among them, not in addition. The counts gained the 2 refuted and 1 unverifiable.
- **Silent wrong answers:** the 9 are condensed from 18 tagged entries. Four more confirmed ones, still present, are now listed.
- **Item 4:** the SCD-41 is a listed alternate, and the agent noted it. The gap is that Sprue never checks the part, not that the purchase was unannounced.
- **Item 2:** the probe was on the CO2 copy, and it was reproduced today. Item 9 was reproduced too.
- **CO2 firmware:** it was run on the agent's own host mock, never by Sprue.
- **Added:**
  - the score needs an answer key, so a user's product is never scored;
  - `quote`, `score` and `package` exit 0 whatever happens;
  - Ponder's stability passes on six accepted tip-overs;
  - the wall checks' role mismatch;
  - Ponder's circular answer key and both self-built cost bands;
  - KiCad does not block and has not run on the board faults;
  - the firmware check reads KMK, not USB;
  - nothing has been built;
  - the blind run's `CLAUDE.md` caveat and n = 1;
  - stock "unknown" passes the filter.
- **Line references:** `system.py:132-152`, `check.ts:427-438` and `cli.ts:349-406` now carry the exact lines, and `verify.ts:9,254-255` was added for the firmware run.
