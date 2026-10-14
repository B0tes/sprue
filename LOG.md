# LOG

Newest entry first. Each run adds one entry; Tobias can reply inline.

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
