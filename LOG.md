# LOG

Newest entry first. Each run adds one entry; Tobias can reply inline.

## 2026-10-22 (the site in four stages)
**Shipped:** The website's worked example now runs in four stages, with Inspect between Design and Source, and the
"Accept the build" sample output is back. That output went missing on 2026-10-21 because the page ran the gates while
Vercel built it, and Vercel has no CAD exports or board (they are git-ignored). Now `scripts/gate-outputs.mjs` runs
every gate here, on a copy of each example that has its exports, and records what each command printed in
`src/lib/gate-outputs.json`, with the sha256 of the files it ran on. The page shows a record only while those files
are unchanged, so it never shows an output of other files, and nothing is faked. The keypad's four gates are all
accepted. Ponder's Design is accepted and its Inspect refused, with its 10 problems shown, so its Source and Build tabs
say they were made ahead of their gates.
**PR:** https://github.com/B0tes/sprue/pull/24 (on top of #23)
**Metric:** unchanged; the site only shows the run.
**Needs Tobias:** merge #22, then #23, then this PR.

## 2026-10-21 (night, the Inspect stage)
**Shipped:** The Inspect stage, the second step of Tobias's "Start now". A run now has four stages, design, inspect,
source and build. Design's gate holds each part on its own; Inspect's holds the parts together: the assembly checks
(9 of the built-ins, and each `rules.ts` rule by its `scope`) and the whole-product check. `sprue inspect <slug>`
proposes it only when they all pass, and `accept` refuses a failing Inspect. A design may accept a known risk in
`_system.py`, with its reason, which the gate then shows as a flag; neither example does. A run from before Inspect
reads as at Inspect, and nothing it accepted is undone unless a fix there changes what that gate showed. A pick, a cost
note or an assembly step no longer makes the whole-product check stale. `sprue status` now asks each gate what its
`accept` would refuse, so its next step is never one that would only fail again. A review from five angles found 27
real problems, a walk through a whole run 3 more (the worst: a fix made at Inspect could leave an accepted quote and
package of the parts as they were) and a check of those fixes 5 more. Two more reviews, of `sprue status` and the build
gate, found 18 and then 16 (the worst: status sending the person to a command that refuses, over and over), and a
check of those fixes 14 more of the same kind. All are fixed with tests; 277 pipeline and site tests pass.
**PR:** https://github.com/B0tes/sprue/pull/23 (on top of #22)
**Metric:** keypad PASSES, unchanged: Inspect passes (7 of 7 whole-product gates, 9 assembly checks), coverage 100%,
0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3, seeded faults 10 of 10 with 0 false alarms, board
VERIFIED. Ponder is refused at Inspect: 6 clearance problems, and 4 steel parts in the Pi radio's keep-out.
**Needs Tobias:** say whether a design may accept a known risk with its reason (the default here) or must fix every
whole-product problem; merge #22, then this PR. The go to order the keypad boards is still open.

## 2026-10-21 (evening, the keypad's case fix)
**Shipped:** The keypad's case fix, the first step of Tobias's "Start now" (case fix, then the Inspect stage). The
whole-product check had found two faults in the case: the USB cable's overmold ran 1.04 mm3 into the tray's wall, where
the top's USB opening was not cut, and the screw heads had 0.15 mm a side in their counterbores, under the 0.2 mm gap.
The tray now has the top's opening cut through its wall too (`cad/bottom.py`), and the counterbores are 6.4 mm (was
6.0). The two problems are gone from `reference/faults.json`'s `known` list. The tray prints 16.64 cm3 (was 16.68); the
total is unchanged.
**PR:** https://github.com/B0tes/sprue/pull/22
**Metric:** keypad PASSES: coverage 100%, 0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3, the whole
product 7 of 7 gates (no overlap but its 19 fits, every other pair at least 0.2 mm apart, self-test 12 of 12), seeded
faults 10 of 10 with 0 false alarms, board VERIFIED. It is the first pass with the whole-product check and the seeded
faults in the score. It stays on rung 1 until the rest of the case's second pass is done. The overmold's 11 x 8 mm is
still an estimate.
**Needs Tobias:** nothing new; merge the PR. The go to order the keypad boards is still open.

## 2026-10-21
**Shipped:** A failure stops the run, the blind CO2 run's worst finding, and the pipeline tests in CI. Until now a
failed check printed a cross and Sprue carried on: `sprue all` exited 0, `accept` took the gate and `package` wrote an
order. Now `check` and `all` exit 1 on a failed check, and `accept` (even with `--force`) and `package` refuse one.
They also refuse a part file exported from an earlier design, a mesh that is not one closed body of the volume its
line prices, a made line with no file and an unproved board, and from the source gate on an order not priced whole: a
quote of an earlier BOM or catalog, a line with no price (saying why), a shop it buys from with no shipping figure,
and a build plan written from an earlier quote. A refused `package` takes the old `production/` away instead of
leaving it to be ordered from. `validate` now checks `catalog.json` field by field (the CO2 run's misspelt price gave
a $NaN total and exit 0), and `source` holds each offer to its line by part number, so an SCD-41 can no longer be
bought on the SCD-40 line without a word; `pick` refuses an offer the source stage drops, and the quote says when it
buys an alternate or can't keep a pin. CI now runs the pipeline tests, the Python and firmware ones included, on each
PR: 219 of 228 ran and passed on GitHub, and 9 were skipped there (KiCad's cross-check, as KiCad is not installed
there, now a PLAN item, and one test that needs Python 3.11). Two reviews found 45 and then 17 real problems in this
work (the worst: the quote priced from a stale `sourcing.json`, and a build plan of an earlier quote shipped in the
package), all fixed with tests; 228 of 228 pipeline and site tests pass here.
The silkscreen item waits: it is a board polish, and this one is about wrong answers and was named next.
**PR:** https://github.com/B0tes/sprue/pull/21
**Metric:** keypad NOT YET, unchanged: coverage 100%, 0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3,
seeded faults 10 of 10 with 0 false alarms, board VERIFIED; the whole-product check still fails on the USB plug in
the tray wall (the keypad's case fix). Ponder: one order $5,371.43, unchanged; as two orders $5,521.71 (was
$5,522.17), because Jameco's 1k resistor is another part number than the BOM's, so it is now bought from Mouser.
Test-suite runs don't count toward the pause rule.
**Needs Tobias:** nothing new to decide; merge this PR. The go to order the keypad boards is still open.

## 2026-10-20 (afternoon, Tobias's questions)
**Shipped:** Research and a plan, no code. Tobias asked to separate Design from an overall inspection of the whole
build before Sourcing, to turn the product in 3D and click into each part during Design, for the US makers that build
from files or specs (covering every material and kind of part, with APIs or an agent), for Sprue's limits in numbers,
and for a public gallery of products built with Sprue. Four notes in `research/` (`inspect-and-3d-view.md`,
`us-makers.md` with the list as `us-makers-2026-10-20.csv`, `sprue-limits-2026-10-20.md`, `gallery.md`), each reviewed
against main at 908dce1 and the pages they cite, and six backlog items in the recommended order: the keypad's case
fix, the 3D view, the Inspect stage, an up-front "Sprue can't check this", a sourcing hand-off for every made part,
and the gallery's first two steps. A working 3D prototype of the keypad (every part as `sprue system` places it; click
a part for its line, material, fits, checks and files) was built outside the repo; the 3D view item rebuilds it in
small PRs. The makers list has 269 companies: 15 with a public API, 13 partner-only and 239 with none found;
Xometry's and Protolabs' terms ban bots, so an agent would only fill quote forms where the terms allow it.
**Metric:** keypad NOT YET, unchanged (no code changed).
**Needs Tobias:** the build order (3D view first is the recommendation), what a failing Inspect does, and a go when
the keypad boards may be ordered and the case printed.

## 2026-10-20
**Shipped:** Figures drawn the right way round, the top test-suite item from the blind run. The drawing kit Sprue
copied from Anatomy projects left-handed, so a figure drawn in its CAD's frame came out as the CAD's mirror image: the
keypad's USB cable, at +x in the CAD and the STLs, left its figure on the left, and every exploded part moved the
wrong way across the screen. The kit is now right-handed, the one change Sprue makes to it (`skills/sprue/NOTICE`).
The camera sits where it did, the light stays on the screen's upper left and face text still reads the right way
round. The keypad's figure is now its old one mirrored, exactly, with the cable on the right. A correction to
yesterday: Ponder was never mirrored, because its `figure.mjs` swapped x and y to work round the kit; that swap is
gone, it draws at azimuth 52 and its picture is the same. The site's emblem is art, not a CAD, so it keeps Anatomy's
projection (`leftHanded: true`) and comes out byte for byte the same; a product's camera that asks for it is refused.
New tests pin the camera's hand, the light, face text, dial ticks and the shipped figure's cable side (9 of the 16
fail on Anatomy's kit), and 201 of 201 pipeline tests pass. A review from five angles found 10 small problems, all
fixed with tests; the worst was in the kit's `lathe` `hole`, whose bore was open for only half the ways a part can
point (which half flipped with the hand); it is open either way now.
**PR:** https://github.com/B0tes/sprue/pull/18 (stacked on #17)
**Metric:** keypad NOT YET, unchanged: coverage 100%, 0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3,
seeded faults 10 of 10 with 0 false alarms, board VERIFIED. The one gap left is the whole-product check (the USB plug
in the tray wall). Test-suite runs don't count toward the pause rule.
**Needs Tobias:** nothing new to decide; merge #15, #16, #17, then this PR.

## 2026-10-19 (afternoon, at Tobias's "Start now")
**Shipped:** A blind run of a new product. Tobias linked pcbtracer.com and asked whether to run a whole new product
through Sprue to see where it breaks. PCB Tracer reverse engineers boards from photos, the other way round from Sprue
(`research/pcbtracer-vs-sprue.md`). Then a fresh agent, given only "A desk CO2 monitor with a small screen and a light
that goes green to red, powered by USB" and a clean install of the skill, ran all three stages: a Pico, an SCD-40
breakout, a 0.96 in OLED and a bicolour LED, hand-wired in a printed case, EUR 147.04 landed in Italy. Graded against
an answer key written by other agents from four real monitors: 6 of 13 traps pass, 5 in part, 2 fail (a third of the
screen hidden behind the front wall; two parts with stock unknown). None of the 13 was caught by a Sprue built-in
check; the agent wrote every engineering check itself. An audit confirmed 9 wrong answers Sprue gives without a
warning, the worst being that every figure is drawn as a mirror image of its CAD (the keypad's too), that a failed
check stops nothing, and that an old STL can ship after the design changed. They are now the top PLAN items.
Report: `evals/ideas/runs/2026-10-19-co2-monitor/README.md`.
**PR:** https://github.com/B0tes/sprue/pull/17 (stacked on #16)
**Metric:** keypad unchanged (NOT YET). This run measures the pipeline on a new idea and builds tests, so it doesn't
count toward the pause rule.
**Needs Tobias:** nothing new to decide; merge #15, #16, then this PR.

## 2026-10-19
**Shipped:** Say what is missing instead of crashing, the next test-suite item (stacked on #15). Seeded faults v0
found that taking the cable out of the BOM, or a board whose audit failed, crashed the whole-product check and the
figure. Now a product's `_system.py` reads the BOM through `bom_lines` and its mass estimates through `estimates`: a
missing line, a missing field, a mass with no estimate, or a missing board zip fails the check with one problem that
names it ("bom.json has no cable line, which cad/_system.py puts in the frame"), and `system.json` is still written.
The figure reads lines through the harness, so a missing line stops it with a sentence naming it, and a part drawn
with NaN or undefined in it is a problem instead of a figure drawn wrong. `sprue faults` reads a missing zip as a stage
that did not run, never as a catch. Keypad: none of the 10 seeded faults crashes a step now (4 did). A review from
three angles found 5 real problems, all fixed with tests (the worst: Ponder still stopped on a bare KeyError for a
part with no mass, and a missing zip could have counted as catching a board fault). 188 of 188 pipeline tests pass.
**PR:** https://github.com/B0tes/sprue/pull/16 (stacked on #15; preview: https://anatomy-2-git-claude-2026-10-19-missing-lines-b0tes-projects.vercel.app)
**Metric:** keypad NOT YET, unchanged: coverage 100%, 0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3,
seeded faults 10 of 10 with 0 false alarms. The one gap left is the whole-product check (the USB plug in the tray
wall). Test-suite runs don't count toward the pause rule.
**Needs Tobias:** merge #15, then this PR.
**Tobias (10:26Z, decision card):** "Keep flags" for yesterday's question: JLC3DP's size table keeps flagging a
printed wall instead of failing it (PLAN.md Decisions).

## 2026-10-18 (afternoon, at Tobias's "Start the printed-wall check now")
**Shipped:** The printed-wall check, and the seeded faults in the pass. Two new engineer checks, `print-walls` and
`print-skins`, hold the case's walls, the walls round its screws and inserts, the plate, the skins and the tray floor
to the process each part is printed by. Under the print shop's least wall fails (Craftcloud: 1 mm for FDM, 0.8 mm
for MJF and SLS). Under JLC3DP's figure for the case's size, round a fastener at 1.5 mm or less, or on a case past
JLC3DP's 200 mm table is flagged for a person to ask the shop. The PLAN asked for JLC3DP's table as the limit, but
JLC3DP prints no PETG, its own FDM pages disagree, and no shop says whether the table holds for a horizontal skin,
so it flags instead. Then, as Tobias chose, a product that lists seeded faults passes only with every one caught
and no false alarm, measured on its files and Sprue's checks as they are now; the site, the viewer and the CLI say
so. Keypad: the thinned wall is now caught (10 of 10, 0 false alarms), nothing fails, and the standoffs, plate and
skins are flagged, as the case's second-pass item already says to ask the shop. A part's `spec.process` is now one of
a process's names and nothing else, and its material must name a material of that process; a metal or ceramic in a
plastic binder, or a part debound, sintered or fired after printing, fails. Reviews before the PR found 15 and then 18
real problems, and seven rounds after it 57 more, most in reading free-text process words, which is why
`spec.process` became a plain name; all are fixed, and each code fix has a test that fails when it is undone.
**PR:** https://github.com/B0tes/sprue/pull/15 (preview: https://anatomy-2-git-claude-2026-10-18-wall-check-b0tes-projects.vercel.app)
**Metric:** keypad NOT YET: coverage 100%, 0 failed of 17 checks (3 flagged), $83.34 (+23.5%), files 3/3, seeded
faults 10 of 10 with 0 false alarms (now in the pass). The one gap left is the whole-product check (the USB plug in
the tray wall). Test-suite runs don't count toward the pause rule.
**Needs Tobias:** merge this PR. One call: should JLC3DP's size table fail a wall instead of flagging it? If yes, the
keypad also needs thicker standoffs, plate and lid skin before it can pass.

## 2026-10-18
**Shipped:** Seeded faults v0, test-suite item 3 (stacked on #13). `sprue faults <slug>` checks the checks: it
breaks copies of the product in each way `reference/faults.json` lists, runs every gate (cad, verify, validate, all)
on each copy and on a clean one, and counts a fault caught only when a problem the clean copy lacks names what was
broken. A problem on the clean copy is a false alarm unless it is a known one with a reason, and a crash never counts
as a catch. The keypad has 10 faults across the case, the board and the BOM. `score.json` now reports the share
caught and the false alarms, but the pass is unchanged, since gating on it changes the metric. Keypad: 9 of 10 caught
(90%), 0 false alarms on the clean design. The one missed is a case wall thinned from 2.4 to 0.8 mm: no check reads
wall thickness yet, now a PLAN item. It also showed that taking the cable out of the BOM crashes the whole-product
check and the figure instead of naming the missing line, and that KiCad never sees a board our audit fails. Ten reviews
found 13, 8, 9, 7, 3, 5, 2, 3, 4 and 3 real problems (the last ten small), and testing the sixth's fixes one more, all fixed. Each fix after the first review has a test that fails when the fix is
undone, but three (a file or link that goes mid-walk, and the page's Unchecked label, since the page has no tests). The worst: the new problem lists made `sprue system` crash, writing
nothing, whenever a gate could not run, and an exception in the board code could still count as a catch. All 166
pipeline tests pass.
**Preview:** https://anatomy-2-git-claude-2026-10-18-seeded-faults-b0tes-projects.vercel.app
**PR:** https://github.com/B0tes/sprue/pull/14 (stacked on #13)
**Metric:** keypad NOT YET, unchanged: coverage 100%, 0 failed of 15 checks, $83.34 (+23.5%), files 3/3, whole
product fails overlap and clearance (the USB plug in the tray wall). Seeded faults 9 of 10 caught, 0 false alarms
(reported, not in the pass). Test-suite runs don't count toward the pause rule.
**Needs Tobias:** merge #10 to #13, then this PR, in that order. One call: should the seeded-faults result count
toward the pass? If yes, the keypad also needs the wall check before it can pass.
**Tobias (15:50Z, decision card):** "After wall check". The next run builds the printed-wall check, then the pass needs
every seeded fault caught and 0 false alarms.

## 2026-10-17
**Shipped:** The KiCad cross-check, test-suite item 2 (stacked on #12). `sprue verify` now rebuilds the board in
KiCad from the zip a fab gets, nothing else, and runs KiCad 7.0.11's own DRC on it with our rules, then with each
fab's numbers and the fabs' own KiCad rule files (Aisler's official one, kicad-druid's for JLCPCB and PCBWay, fetched
at pinned commits and never copied in). A canary rule proves each file loaded and a probe proves each of their 69
conditions compiles, since KiCad skips a broken rule without a word. KiCad's netlist of the rebuilt board is diffed
with ours, and four faults planted in copies must each come back as errors. It is a second opinion for now and does
not hold back the board. Keypad: 0 errors with all five rule sets, 129 of 129 netlist points match, 4 of 4 faults
caught. Also: the score fails a printed part whose mesh is not the volume it is priced at. A review before the PR
found 20 real problems and a second pass over the fixes 10 smaller ones, all fixed with tests. The worst: KiCad words open nets and pour clearances as "Local
override", which we read as warnings, so a cut track passed. Others: a through-hole Pico was built with 120 pads
instead of 80, a clear region could erase a track unseen, a board our reader could not rebuild for KiCad was
reported as KiCad disagreeing with our DRC, and VERIFIED said "every layer passed" when the KiCad line had not. All pipeline tests pass.
**Preview:** https://anatomy-2-git-claude-2026-10-17-kicad-check-b0tes-projects.vercel.app
**PR:** https://github.com/B0tes/sprue/pull/13 (stacked on #12)
**Metric:** keypad NOT YET, unchanged: coverage 100%, 0 failed of 15 checks, $83.34 (+23.5%), files 3/3, whole
product fails overlap and clearance (the USB plug in the tray wall). The board itself is VERIFIED. Test-suite runs
don't count toward the pause rule.
**Needs Tobias:** merge #10, #11 and #12, then this PR, in that order. The three thresholds from yesterday are still
open.

## 2026-10-16 (evening: the whole product)
**Shipped:** Tobias asked for the best repos for AI-designed boards that also get fully tested, to fork them into
Sprue, to let a user swap parts and keep the product working, and above all a test of the system as a whole. Six
research sweeps, each fact-checked, found that nobody tests AI boards end to end: Diode's `pcb`, tscircuit and
atopile check the most, none puts the board in its product, and none is worth forking (pinned dependencies and
copied rule lists instead). "Arena Physics" is Arena Physica's Heaviside-1, a closed EM model with no API that
can't model Ponder's Wi-Fi next to the steel arm; openEMS is the open path. The write-up is
`research/system-testing.md`. Built: `sprue system`, which puts every part in one frame and checks seven gates
(placed, overlap, contact, clearance, inside, stability, function by ray casting), each with planted faults, and
the score now fails a made product until it passes. It found the keypad's USB plug moulding in the tray wall
(1.04 mm3) and its screw heads with 0.15 mm of play, and on Ponder two steel screws and two brass inserts 8.9 to
11.5 mm from the antenna, a mute-switch hole with 0.075 mm of play, a tight SD card, an LED flange 0.09 mm from a mic
rim and three locating fits under the gap. Thresholds now have sources (Same Sky for the grille, Espressif for the
keep-out, IEC 60598-2-4 for tilt). A second review of the checker found 21 real issues, all fixed: a fit was never
made to meet (40 screws, nuts and cables drawn at their mating size only touched, and are contacts now), a planted
fault could be "caught" by any new problem (now it must name the part it moved), the camera saw through the
diffuser and counted the margin the wrong way, STEP models read by OpenCascade escaped the staleness check, an STL
exported before an edit still scored, and the page could show an old pass. All 130 pipeline tests pass.
**Preview:** https://anatomy-2-git-claude-2026-10-16-system-check-b0tes-projects.vercel.app
**PR:** https://github.com/B0tes/sprue/pull/12 (stacked on #11)
**Metric:** keypad NOT YET: coverage 100%, 0 failed of 15 checks, $83.34 (+23.5%), files 3/3, but the whole product
fails overlap and clearance. It is the first time the score can see the assembly, so this is a truer reading, not a
step back; the fixes are in the keypad's case item. Ponder fails clearance and function the same way. Test-suite
runs don't count toward the pause rule.
**Needs Tobias:** merge #10 and #11, then this PR. Say if the three thresholds should be stricter or looser.

## 2026-10-16
**Shipped:** The honest score, the first test-suite item (stacked on #10, which is still open). A check whose
params the design has none of is now listed as skipped, and one with only some of them fails ("Can't run") instead of
quietly not running. The score records how many checks ran, fails on any line the batch needs that has no price (a
CNC or sheet-metal part used to count as $0), and takes a board's zip only with the read-back's and the firmware's
self-tests, so after `sprue cad` alone it reads "not yet" until `sprue verify` runs. The STL check is new: it finds
a sealed void, a flipped face, a hole, a part inside out and a part in two pieces, which the old edge count passed,
and it agrees with trimesh on all 8 product parts and on 7 planted meshes. A review of the change found 7 real
issues, all fixed: a stack overflow on long strip-ordered meshes (now a test with 60,000 faces), the page and the
site not showing an unpriced line, wrong advice for a rules.ts rule, a test that no longer had a passing case, and
stale docs. All 122 pipeline tests pass.
**Preview:** https://anatomy-2-git-claude-2026-10-16-honest-score-b0tes-projects.vercel.app
**PR:** https://github.com/B0tes/sprue/pull/11 (stacked on #10)
**Metric:** keypad PASS under the stricter score: coverage 100%, 0 failed of 15 checks run (0 skipped), $83.34
(+23.5%) with every line priced, files 3/3 (the board with both self-tests, each STL one closed body). That is the
second passing run in a row, but I kept it on rung 1: the case faults from 15 Oct are real and the score can't see
them until the assembly gate exists. Ponder also passes (26 checks run, 14 skipped as not applying to it).
**Needs Tobias:** nothing new. Merge #10, then this PR.

## 2026-10-15 (evening: open-source validators)
**Shipped:** Tobias chose tests first, then asked for the best open-source repos to validate the PCB design, and the
same for other processes and materials. Five areas were surveyed and fact-checked, and the tools were tried on the
keypad's own files (`research/open-source-validators.md`). For PCBs the answer is KiCad's DRC, fed a board rebuilt
from the Gerbers we ship; that rebuild is the next step. A simpler KiCad board written from `board.json` (unrouted,
no pour) already agrees with our DRC on the tightest hole gap (0.4648 against 0.465 mm), and its IPC-D-356 export
matches ours on 129 of 129 records. The cross-check is now the second test-suite item. For the other processes open
source has engines (PrusaSlicer, CalculiX, gmsh, build123d) but almost no manufacturing-rule checkers (UVtools for
resin is the exception), so those stay our code with each fab's numbers. The trials also found that the keypad case is
tight: the board has 0.44 mm of play (0.38 mm diagonally) against a 0.5 mm worst-case tolerance, the
top clamps on both the tray and the PCB, and the Pico has 0.2 mm under the lid, which a worst-case print turns into
0.66 mm of interference. A new keypad item lists a fix for each, for before anything is printed.
**Score:** unchanged (keypad PASS, $83.34).
**PR:** #10 (added to it)
**Needs Tobias:** nothing new to keep working. PR #10 is ready to merge. Before the case is printed: whether the print
shop accepts the lid's 1.0 mm skin and 1.5 mm switch plate, which are under JLC3DP's guideline for a part this size.

## 2026-10-15 (afternoon: a plan to test Sprue)
**Shipped:** Tobias made the repo public as B0tes/sprue and connected Vercel; #9 points the site at the new repo
and leads with `npx skills add B0tes/sprue -g`, and #8 and #9 are merged and live. Then he asked how the boards are
built and tested, which suppliers make parts to our files, whether to test Sprue on a benchmark or an engineering
exam split into the product, the PCB and the rest, and whether a trained physics model is needed. The answers and a
four-track test plan (whole product, PCB, mechanical, and seeded faults that test the checks themselves) are in
`research/testing-plan.md`, with fact-checked research in `research/benchmarks.md`,
`research/physics-verification.md` and `research/custom-part-suppliers.md`. The test suite now heads the backlog.
**Score:** unchanged (keypad PASS, $83.34).
**PR:** #10
**Needs Tobias:** whether the next daily runs do the test suite first (the default) or carry on up the ladder. The
suite's runs don't move the keypad's score, so PLAN.md says they don't count toward the 5-run pause rule.

## 2026-10-15 (daily: the keypad passes)
**Shipped:** Tobias said merge, so #4 to #7 are on `main`. Then the daily run: the four M3 screws were paying $8.95 of
Bolts and Nuts shipping on their own. JLCMC lists ISO 7380 button head screws in SUS304 and ships them in the JLCPCB
parcel, so the quote now buys them there with no shipping of their own (`shipsWith` in `catalog.json`), and the build
plan says to check out with the board. The total went from $92.29 to $83.34 and the keypad passes its score for the
first time. The JLCMC line is an estimate ($0.11 a screw, Bolts and Nuts' price): its page shows only the ISO 7380
family ("From $0.0018"), and whether it lists an M3 x 8 in SUS304, and at what price, sits in a part picker a page read
can't open. If the shared parcel costs no more than the board's alone, four screws could cost up to $1.50 and still
pass. The
quote now also tries moving a made line to a fab that carries another shop's parts, when the saved shipping outweighs
that fab's higher price.
**Score:** coverage 100%, 0 failed of 15 checks, $83.34 (+23.5%), files 3/3: PASS.
**PR:** #8
**Needs Tobias:** make the repo public (Settings → General → Change visibility) and connect Vercel to the repo
(Vercel → Settings → Git). Sessions can't change repo settings, and until Vercel deploys `main` the live site and the
one-line install stay on the old build.

## 2026-10-14 (night: the name is Sprue)
**Shipped:** Tobias asked for an English name and picked Sprue: the frame a model kit comes on, every part held in
one place and ready to put together. The skill is now `skills/sprue/`, the command `/sprue`, the command line
`bin/sprue`, the zip `sprue.zip` and the site variable `SPRUE_SITE`. The site's "Why the name?" answer says what a
sprue is. Twelve English names were checked first for clashes with live products.
**PR:** #6 (stacked on #5)
**Needs Tobias:** rename the GitHub repo to `sprue` and give the Vercel project a Sprue domain, so the install line
stops showing `anatomy-2`.

## 2026-10-14 (evening: does the PCB work?)
**Shipped:** `distinta verify <slug>` checks a board as far as we can before a fab makes it, and only then writes the
files to order it by hand. On the keypad it ends VERIFIED. It runs in layers, each catching what the ones before it
cannot. First the audit `distinta pcb` runs (Node only): every footprint is held to its sources' own numbers
(KiCad's and Raspberry Pi's footprint files, Kailh's drawing, marbastlib and Keebio, to 0.01 mm), the nets to the
circuit `design.json` means (a new `keyMap`), the parts to the params the case is built from, and our DRC, at least
as strict as the published limits of JLCPCB, PCBWay, OSH Park and Aisler. Then a second reader, gerbonara and
shapely in Python, reads the very files in the zip and the new IPC-D-356A netlist, rebuilds the copper and fails any
open, short, undersized feature, mask error or statement a fab would apply that our writer never writes. Then the
keypad's firmware, which `distinta pcb` now writes from the routed board (KMK on CircuitPython), boots on an
emulated Pico (rp2040js) wired to the copper read back, and every key and every pair of keys must type its own code:
45 presses, 0 errors. The read-back and the firmware each have a self-test that puts faults into copies and must
catch each. Last it writes `pcb/order/`: a README with the board and its smallest features, and for each of the four
fabs a zip in that fab's own file names and drill format, read back too, and an `ORDER.md` with the upload steps,
the settings and an unverified price, ending at a STOP line. Nothing is uploaded, quoted or ordered: every command
refuses the fabs' hosts and their order calls.
**Fixed on the way:** the Kailh socket holes are 3.05 mm as Kailh's drawing gives them (they were 3.0), the switch
peg holes 1.70 mm (1.75), and each Pico ground pad has two thermal spokes instead of one. Four rounds of testers then
broke the board and its tools on purpose, 79 holes in all (a Pico turned or mirrored, two keys swapped, a pad eaten by a later clear, renamed
params, a stub `python3`); each fault that got through now fails, with a test that proves it.
**Not checked yet:** a second DRC by KiCad, the board against the case's CAD solids (only the params they share),
a real Pico and socket on the 1:1 print, and the Pico datasheet's Figure 5 (its host is blocked here). The prices in
the `ORDER.md` files are read from published pages, not quoted. Research: `research/pcb-verification.md`.
**Preview:** none (Vercel isn't connected to the repo yet)
**PR:** #7 (stacked on #6)
**Metric:** unchanged: coverage 100%, 0 failed of 15 checks, $92.29 vs $55-80 (+36.7%), files 3/3. Not passing, on
cost only. The board's zip now counts only after its read-back has passed.
**Needs Tobias:** whether to order the first keypad boards, once a real Pico and socket fit the 1:1 print in
`pcb/order/` (JLCPCB from $2.00 for 5, unverified, plus shipping; the README lists all four fabs).

## 2026-10-14 (afternoon: new name, legend, emblem, one-line install)
**Shipped:** Anatomy 2.0 is now Distinta, from *distinta base*, Italian for a bill of materials. The skill moved to
`skills/distinta/`, the command to `/distinta` and the command line to `bin/distinta`. The site says once that it was
inspired by Anatomy by Ryan and no longer compares itself with it. A legend in the left margin jumps to each section
and marks where you are. A soldering iron a hair above a pin, drawn with the same kit as the product figures
(`scripts/emblem.mjs`), opens and closes the page in place of Anatomy's hands. Every install is one command:
`curl -fsSL <site>/install | sh` while the repo is private, `npx skills add` once it is public.
**PR:** #6 (stacked on #5)
**Needs Tobias:** pick the name (Distinta is in for now); then rename the GitHub repo and give the Vercel project a
Distinta domain, so the install line stops showing `anatomy-2`.

## 2026-10-14 (daily run: keypad PCB)
**Shipped:** The keypad has a real PCB. `products/macropad/cad/pcb.mjs` places the board from `design.json`: 9 Kailh
hot-swap sockets on the back, the Pico face up on the front, the 4 M3 holes, a ground pour and silkscreen with each
key's GPIO. `anatomy pcb <slug>` (Node only; `anatomy cad` runs it too) routes it, audits it and writes the Gerbers,
drill files and `pcb/<slug>-gerbers.zip`. The audit is our DRC at JLCPCB's 2-layer limits plus connectivity read
back from the Gerbers; with an error it writes no zip, and the scorer counts the zip only when the audit passes. The
footprints come from Kailh's, Cherry's and Raspberry Pi's drawings, checked against KiCad libraries
(`research/keypad-pcb-footprints.md`), and an independent Gerber library parsed and rendered all eight files.
Also fixed: the lid's BOOTSEL hole was on the wrong side of the Pico. Pricing: no fitting screw is sold by a shop
already in the order, and Bolts and Nuts shipping is now the $8.95 its page shows instead of a $5 guess.
**Preview:** none (Vercel isn't connected to the repo yet); board images in `products/macropad/previews/pcb-*.svg`
**PR:** #5 (stacked on #4)
**Metric:** coverage 100%, 0 failed of 15 checks, $92.29 vs $55-80 (+36.7%), files 3/3. Not passing, on cost only.
**Needs Tobias:** merge #4, then this PR (it is stacked on #4). Still open from before: making the repo public, and
connecting Vercel to the repo.

## 2026-10-13 (standalone skill, explorer, three gates)
**Shipped:** The plugin became one standalone skill in `skills/anatomy-2/`, downloadable as `anatomy-2.zip` from
the site. A run now has three stages (Design, Source, Build) and stops at a gate after each for accept, edit or
decline; `--step` is gone. Stage 1 draws the real product with Anatomy's drawing kit, now bundled in `kit/` under
its MIT license (credited in `NOTICE`; Anatomy 2.0 has its own MIT `LICENSE`). New subcommands: accept, decline,
next, figure and example (copies a finished run into `products/`). One explorer renders both `view.html` and the
example on the site: every in-stock offer per line, pick one and the total is worked out again with the quote's
rule. The site was rewritten around the skill: the stage 1 figure in the hero, a one-line install, the three
gates, the worked example, the commands, how prices are found, the history and the limits.
**Fixed from review:** the screw offer now links to its product page with stock unknown; pack prices show as
packs times pack price; the swap command in the explorer is the slash command, quoted for the shell; shop counts
say which shops charge shipping; the print rate is called an assumed rate.
**Then:** one product page, `view.html`, that grows with the run: the figure on one side, the three stages on the
other, with BOM rows and build steps lighting parts in the figure. Ponder (the tutor desk unit) is the second
example and the site's worked example: drawn with 74 parts in 15 steps, sourced from 14 shops, quoted at $5,371.43
for 20 units, plus an optional first order of 2 units. Its pipeline fixes came along: stock checked against the batch,
price breaks, packs on the order list, print rates by material, a home-printer option.
**Then (Tobias's first try):** an old install treated `/anatomy-2 example ponder` as a new idea and began
designing with no brief. The skill now asks what to build when the input names no product, asks a few short
questions when the brief is thin, and asks before treating a bare example name as an idea.
**PR:** #4 (try it yourself)
**Metric:** keypad unchanged: $88.34 (+31%), files 2/3. Ponder: PASS (coverage 100%, 0 failed of 26 checks, +16.1%, files 6/6).
**Needs Tobias:** decide whether to make the repo public with the skill on `main` (until then only the zip
works for others); decide whether bundling Anatomy's notes in `reference/anatomy/` is OK; OK pipeline edits for
the open items (CLI output wording, HTML escaping in `view.html`, the blocked PCB step in the build plan).

## 2026-10-13 (try it yourself)
**Shipped:** Tobias can run the pipeline himself. In Claude Code, `/anatomy-2 <idea>` walks request, design and CAD,
BOM, checks, sourcing, quotes and build plan, pausing after each stage. The code stages are now one CLI
(`npm run anatomy -- <stage> <slug>`) that prints each stage's result. The CAD build can target one product and
prints part volumes for the BOM. Tested on the keypad and on a throwaway product.
**PR:** try it yourself (includes PRs #1 to #3)
**Metric:** unchanged: $88.34 (+31%), files 2/3.
**Then:** packaged as a Claude Code plugin (`plugin/`), so `/anatomy-2 <idea>` works in any folder and runs straight
through to a `production/` folder (build plan, order list CSV, STL and STEP); `--step` pauses after each stage.
Product CAD and custom check rules now live in the product folder.
**Needs Tobias:** merge this PR (it carries #1 to #3), install the plugin, try `/anatomy-2` on a new idea.

## 2026-10-13 (daily run)
**Shipped:** Cheaper keypad. The quoter now finds Adafruit switches and a 50-pack of M3 x 4 inserts, so two shops
(and their shipping) drop out of the order. The longer inserts needed a deeper boss; a new check confirms 1.0 mm of
plastic stays over each insert. Also: live DigiKey adapter and a `quote.yml` workflow that pushes offers to the
`live-quotes` branch, idle until the DigiKey secrets exist.
**Preview:** anatomy-2.vercel.app (landing page only)
**PR:** cheaper keypad + live quote job (stacked on pipeline v0)
**Metric:** coverage 100%, 0 failed of 14 checks, $88.34 vs $55-80 (+31%), files 2/3. Not passing.
**Needs Tobias:** DigiKey client ID and secret as repo Actions secrets; merge PRs #1 and #2.

## 2026-10-13 (re-plan)
**Shipped:** Re-planned around a seven-stage pipeline (`docs/pipeline.md`) and a ladder of reference products.
First rung: 3×3 USB macro keypad. Nexar dropped; DigiKey v4 is the primary parts API.
**Preview:** blocked (Vercel deploys need environment network settings)
**PR:** pushed to main (repo was empty)
**Metric:** no score yet
**Needs Tobias:** DigiKey API client ID and secret.

## 2026-10-13
**Shipped:** Repo set up from the World template. Landing page (hero with exploded coffee-machine drawing, animated
BOM demo with quote modes, automation gradient, hard-parts section, waitlist). Supplier API research in
`research/supplier-apis.md`.
**Preview:** pending Vercel
**PR:** initial commit
**Metric:** 0 of 12 demo lines live-quoted; 0 signups
**Needs Tobias:** create the GitHub repo, then Vercel + Supabase access and a Nexar API key.

## 2026-10-13 (first end-to-end run)
**Shipped:** Stage file formats, keypad answer key, case CAD (2 printable parts), stages 3-6 and the scorer.
`npm run pipeline macropad` writes checks, sourcing, quotes, `build-plan.md` and `score.json`.
The checks caught two real faults in the first design: the key grid was 0.15 mm wider than the PCB allowed, and
M3x10 screws would have bottomed out in the 3 mm inserts. Both fixed (1.9 mm edge margin, M3x8).
**Preview:** anatomy-2.vercel.app (landing page only)
**PR:** pipeline v0
**Metric:** coverage 100%, 0 failed checks, $109.75 vs $55-80 (+63%), 2/3 files. Not passing.
**Needs Tobias:** DigiKey client ID and secret as repo Actions secrets (live quotes will run in GitHub Actions).

<!-- Template:
## YYYY-MM-DD
**Shipped:** ...
**Preview:** <Vercel URL>
**PR:** <link>
**Metric:** <value or "n/a yet">
**Needs Tobias:** <one decision, or "nothing">
-->
