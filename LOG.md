# LOG

Newest entry first. Each run adds one entry; Tobias can reply inline.

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
