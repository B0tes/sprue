# Inspect stage and 3D view: plan and macropad prototype (reviewed)

Written for Tobias's ask of 2026-10-20: separate Design from an overall inspection before Sourcing, and let the user turn the product in 3D and click into each part. The prototype it reviews (`view.html` with a three.js view, its export and FEA scripts) was built in a scratch folder and is not in the repo; the PRs in section 3 rebuild it.

Reviewed against `origin/main` at 908dce1 (2026-10-20), the prototype (built outside the repo), and its nine screenshots. Code claims cite `path:line` on main. External facts carry their URL. Web search was used up in this run, so a few things stay marked unconfirmed.

---

## 0. What this review changed

### Wrong in the draft

| # | The draft said | What is true | Source |
|---|---|---|---|
| W1 | The macropad stops at Inspect "(local run)" | The committed `system.json` already fails (generated 2026-10-19): overlap 1.04 mm3 between bot and cable, and 4 × 0.15 mm clearance at scr1–4. **Ponder fails too**: clearance (6 problems) and function (4: scr25-3/4 and ins25-3/4 sit 8.9–11.5 mm from the Pi's radio, under 15 mm). Under "fix first", neither worked example gets past Inspect. | `examples/macropad/system.json`, `examples/ponder/system.json` |
| W2 | Function probes: "the macropad has none" | It has 2: `bootsel` (a port, 1.00 open, needs 0.95) and `led` (a light, 1.00, needs 0.90). Ponder has 9. | `examples/macropad/system.json` `probes` |
| W3 | The gate shows "system.json's fit, contact and inside lists" | `system.json` does not have them. It writes slug, ok, parts, envelopes, gates, stability, probes, selfTest and inputs. The lists exist only in the `System` that `_system.py` returns. | `cad/system.py:1273-1279` |
| W4 | The Design panel's "Before you accept" list "loses the whole-product items" | That list (lines, checks, non-passing checks, estimates) has no whole-product items. They are in Claude's gate-1 report: the `run.md` Gate 1 paragraph and SKILL.md's "Say whether the parts go together" rule. Those are what move. | `viewer/explorer.js:788-802`, `reference/run.md:147-155`, `SKILL.md:94` |
| W5 | "Rules a product writes in rules.ts default to part" | Ponder's 26 rules include assembly checks: harness-bore, base-headroom, ballast-fit, arm-mount-stack, pi-screws, shell-screws, tip-design-pose, tip-arm-straight, tip-push, drop, power-budget, head-voltage. With a part default, Ponder's Inspect would hold `system.json` and nothing else. | `examples/ponder/rules.ts` |
| W6 | Electrical today is only `usb-power` | Ponder already checks DC drop in `head-voltage` (cable, USB-C contacts, base feed and harness resistance; flagged today), plus `power-budget`, `gpio-current` and `harness-conductors`. `usb-power` counts only the controller. PLAN.md:49 already plans the typed netlist and ngspice, with a recorded Ponder trial: 4.24 V at the head against the rule's 4.31 V, and 3.12 A peaks from a 3 A supply. `spice/usb.cir` uses placeholder values, so it shows only that ngspice starts. | `examples/ponder/rules.ts`; PLAN.md:39, :49; `research/system-testing.md:149-153` |
| W7 | ngspice is "BSD-3-Clause, usable as a shared library" | Wikipedia says the core is BSD-3 and it builds as a shared library (https://en.wikipedia.org/wiki/Ngspice). The repo's own research says parts are LGPL, GPL and MPL, so Sprue calls it as a program. Keep that rule. | `research/system-testing.md:153` |
| W8 | FEA: "the wall feet held" | The deck holds the walls' feet **and the four screw bosses**. gmsh warned of **3 elements with a negative Jacobian**, and ccx still finished. PLAN.md:57 already says ccx exits 0 even on a model with no supports. A check must gate on mesh quality and reaction forces, never on the exit code. | `viewer-proto/fea/deck.py`, `fea/gmsh.log` |
| W9 | PETG: anisotropy across layers "is not in the datasheet (unconfirmed)"; "flat (47 MPa) and upright (50 MPa)" | The TDS lists **Interlayer Adhesion 18 ± 4 MPa** (by Prusa Polymers' own method). 46 ± 1 MPa is the yield of the filament (ISO 527). Printed specimens give 47 ± 2 MPa horizontal and 50 ± 1 MPa "vertical xz", which means on edge, not upright. Modulus is 1.5 / 1.6 GPa, HDT 68 °C at both 0.45 and 1.80 MPa, density 1.27 g/cm3, and no Poisson's ratio. The mirror is v1.1 of 16-02-2022. Prusa's own copy was not located (unconfirmed). | https://www.3dprintergear.com.au/assets/files/technical-data-sheet%20(1).pdf |
| W10 | "The 9 bought lines have no material" | The macropad has 11 lines: 8 bought, 2 printed (PETG) and the PCB. The PCB is the 9th line with no `spec.material`; its FR4 is set only as an Item material in `_system.py`. | `examples/macropad/bom.json` |
| W11 | "Inspect's tab" | `view.html` uses the stages layout: sections, not tabs. Read it as "the Inspect section, which opens Fig 1 on 3D with Problems on". | `viewer/explorer.js:5-7` |
| W12 | The FEA trial answers "is FEA cheap enough?" | That was answered on 2026-10-15: 24,512 C3D10, about 7.8 s to solve, 0.71 mm under 10 N in PLA (E 3.5 GPa). Scaled to 50 N and E 1.5 GPa that is about 8.3 mm, which agrees with today's 6.9 mm. Cite that note; don't present this as new. | `research/physics-verification.md:48-51, 104-110` |

### Missing from the draft

| # | Gap | Source |
|---|---|---|
| M1 | **Step 1 cannot build alone.** `next build` type-checks the pipeline: tsconfig includes `**/*.ts` and excludes only `examples/*/rules.ts` and `evals`. Adding `inspect` to `STAGES` breaks every `Record<Stage, …>`: `status.ts:16` (`items`), `status.ts:64` (`PROPOSER`) and `page.ts:35` (`STAGE_WORDS`). The CLI's usage comment (`cli.ts:6-38`, parsed for `help`) and its `commands` array (`cli.ts:75`) need `inspect` too. | `tsconfig.json`; files cited |
| M2 | **"Fix first" needs `accept` to refuse.** `accept()` checks only the stage order. Nothing reads a verdict today: a failed check stops nothing (PLAN.md:38). | `state.ts:96-119` |
| M3 | **A pick makes the whole-product check stale.** `pick` rewrites `bom.json` (the `pin` field). The whole-product check hashes `bom.json` (`system.py` `digest`, `score.ts:294` `systemInputs`), and `systemIfStale` reruns it after a pick (50 s on the keypad, 153 s on Ponder). With an Inspect gate, every Source pick would make Inspect stale. Either hash `bom.json` without `pin` (both digests, in one PR), or show "stale" after Inspect is accepted without reopening the gate. | `cli.ts:236-240, 499-505` |
| M4 | **The explorer needs the data.** `explore.ts` (the `Explorer` type and `build()`) must carry an inspect summary, or `explorer.js` has nothing to render. Not in the draft's file list. | `pipeline/explore.ts:85-96, 159-224` |
| M5 | **The site has its own gate texts** in `src/lib/example.ts` ("Gate 2" and the others). About 20 files say "three stages" or a gate number: README, `docs/pipeline.md`, SKILL.md, run.md, swap.md, figure.md, formats.md, types.ts, explore.ts, parts.ts, cli.ts, state.ts, status.ts, page.ts, explorer.js, page.tsx, WorkedExample.tsx, example.ts, and two CSS comments. `edit.md` and `swap.md` say which stage to reopen after a change, and they need Inspect. | `git grep` on main |
| M6 | **Ponder's 3D model has no gooseneck.** The arm and the harness are PointMasses, and psu, diode, r220 and r1k are not in the frame: 62 parts from 31 of 37 lines. The 3D view would show the head floating over the base. | `examples/ponder/system.json` gate `placed` |
| M7 | **One URL hash, two meanings.** `figure.js` already reads `apart`, `step` and `select` from the hash, and its `select` is a **line** id. The 3D deep link uses an **item** id (`select=sw5`), which the drawing ignores. On a `hashchange` the drawing then sends `a2:select {line:null}`, which clears the 3D selection. | `viewer/figure.js:118, 522-531` |
| M8 | **Prices at Inspect.** `pricesOf` hides prices only while `stage === "design"`, so at Inspect the figure readout would show the example's old quote. Hide them until Source. | `page.ts:76` |
| M9 | **The doc/code mismatch the lift patch fixes.** `formats.md:35` already says `figure.json` holds "parts with their lifts", but `figure.ts:231` drops them. | files cited |
| M10 | **The metric.** The keypad is NOT YET only on the whole-product check (LOG 2026-10-20). PLAN.md:72-79 ("Case, second pass") names both fixes: cut the USB opening through the tray wall, and widen the counterbores from 6.0 to 6.4 mm. Nothing else in this plan can move the metric, and without this fix "fix first" blocks the keypad. | PLAN.md:72-79; `design.json` `counterboreMm: 6.0` |
| M11 | **Per-part soundness**, Tobias's "each component tested individually", is mostly the printed-wall flags and the mesh checks today. The ready next step is the slicer gate (PLAN.md:53; PrusaSlicer 2.7.2 is installed). It belongs in Design. | PLAN.md:53 |

### Bigger than the draft says

| # | Item | Why |
|---|---|---|
| B1 | **Where the model lives** | `fab/` is git-ignored for the examples. Examples ship without `fab/`, and the site's build writes each `view.html` with `sprue figure --draft`, without Python (`scripts/copy-figures.mjs`). With `fab/system.glb`, the examples, the site and a freshly copied example have no 3D until `sprue cad` runs. Write `previews/system.glb` instead, committed like `previews/system.svg`. Git then grows by about 0.77 MB each time the keypad's model changes (Ponder not measured), not "once", and the skill zip carries it too. |
| B2 | **What makes the model big** | The PCB is 15,036 of 27,216 triangles (55%). The repeated pieces (sw, ins, scr, feet) are 6,424 (24%), and the envelopes are a few hundred. Instancing saves about 20% at most. The lever is a coarser board mesh, since its texture already carries the pads. Quantization savings: unconfirmed. |
| B3 | **Problem marks** | The prototype regex-parses problem text out of `system.json` (`tools/export_meshes.py`). The gates should write `{parts, at}` beside each problem's text instead. |
| B4 | **Vendoring** | three 0.186.1 ships no `.min.js`: `build/` has three.core.js (1.46 MB) and three.module.js (0.66 MB). The prototype minified them with Next's internal terser path (`tools/build_page.mjs`). A vendor script needs a pinned minifier, or ships 2.3 MB unminified. Nobody can review 827 KB of minified code line by line, so make it reviewable by hash. |
| B5 | **The view is 36 KB of JS** (`src/viewer3d.js`) | One PR of that size takes more than five minutes to review. Split it in two. |
| B6 | **Ponder in 3D** | Needs an arm drawn along each pose's path, a pose switch and per-call lifts (74 figure calls, e.g. scr3 × 10). Closer to 4–6 h than 3 h. |
| B7 | **Electrical v0, strength v0, materials** | Each is 1–2 days, and each is already a PLAN.md item (:49, :57, :50). Take them out of this plan and link to them. |

### Checked and correct

- 17 built-in checks, 8 + 9 split (`stages/check.ts:231-437`).
- 44 parts, 41 envelopes, 5 of 7 gates, self-test 12/12, 149.3 g with 98.1 g estimated, COM [5.6, -0.5, 4.2], 58.7° tilt.
- Ponder: 62 parts and 9 probes. 74 figure calls.
- The cited lines: `state.ts:13/117/176`, `page.ts:107`, `explorer.js:51/598`, `figure.ts:231`, `score.ts:361`, `types.ts:69` (`Check.lines?`).
- The GLB: 0.77 MB, 27,216 triangles. The fab STLs match the placed solids (top +0 mm, bottom -6 mm).
- The page: 1026 → 3021 KB.
- GLTFLoader handles `EXT_mesh_gpu_instancing` and `KHR_mesh_quantization` (grep of the 0.186.1 source).
- Licence: three.js 0.186.1 is MIT, "Copyright © 2010-2026 three.js authors" (read from the npm package's LICENSE; the GitHub URL was not fetched).
- I reran `tools/sync_test.mjs`: ready in 4.2 s under SwiftShader, sync works both ways, no page errors. That test listens only for `pageerror`; `shoot.mjs` also collects console errors.
- FEA, re-read from `top_ccx.frd`: 6.908 mm, a 53.2 MPa peak at a switch-cutout corner (-25.27, -6.03, 5.1), 35.6 MPa at the 1% rank.
- Installed here (dpkg): calculix-ccx 2.21-1, gmsh 4.12.1, ngspice 42. The Debian page https://packages.debian.org/sid/calculix-ccx could not be read (a JavaScript challenge).

---

**Short answer to "Or is this what the Build part is?"** No. Stage 3, Build, comes after Source. It writes the build plan; proves the board (`sprue verify`: our audit, a read-back of the zip, the firmware on an emulated Pico, KiCad's DRC as a non-blocking second opinion) and writes `pcb/order/`; then `sprue package` writes `production/` (`pipeline/cli.ts`, cases `plan`, `verify`, `package`).

The whole-product check he describes half exists: `sprue system` (`cad/system.py`). `sprue cad` runs it, and it shows in `sprue status`, in Claude's gate-1 report, and on `view.html` only in the score block of the Build section. It does not show in the Design section.

This plan gives that check its own stage and gate between Design and Source. It also adds a 3D view in Fig 1 that Tobias can turn and click into during Design.

---

## 1. The Inspect stage (design -> inspect -> source -> build)

### 1.1 Which checks stay and which move

| Stays in **Design** (each part sound on its own) | Moves to **Inspect** (the parts together) |
|---|---|
| `bom-roles`, `key-count`, `gpio`, `mx-plate`*, `keys-on-pcb`*, `print-walls`, `print-skins`, `standards` | `controller-zone`, `usb-reach`, `lid-headroom`, `socket-headroom`, `screw-engagement`, `insert-depth`, `holes-clear-keys`, `feet-clear-heads`, `usb-power` |
| The board audit (`sprue pcb`: DRC and fit), `sprue validate`, the STL closed-mesh and volume checks, figure coverage, and the slicer gate when it is built (PLAN.md:53) | All of `system.json`: placed, overlap, contact, clearance, inside, stability, function, and the self-test |
| Ponder: the part rules, such as `camera-fov`, `pin-map` and `small-parts` | Ponder: the assembly rules listed in W5, once they are tagged |

\* These are judgement calls. `mx-plate` holds the plate-top-to-PCB drop (a stack-up), and `keys-on-pcb` holds the key grid against the board. Both are between parts, but they are parameter checks that run before any frame exists. The same goes for the board's fit check (`pipeline/pcb/fit.ts`).

`sprue verify` stays in Build.

### 1.2 What the Inspect gate shows

1. **One verdict line.** For example: "Whole product fails: 5 of 7 gates pass, self-test 12/12 faults caught, 41 of 44 parts are envelopes".
2. **Fig 1 opens on 3D with Problems on.** The macropad shows the 1.04 mm3 clash between bot and cable as a red solid, and the four 0.15 mm gaps (bot to scr1–4) as dots. Clicking a problem frames it. This needs the problem locations in `system.json` (PR 2).
3. **Fits and contacts.** The 9 assembly checks, plus the fits, contacts and inside rules (PR 2 adds them to `system.json`).
4. **Mass and stability.**
   - The stability rows `system.json` already has: total mass, estimated share, COM, tip angle per pose, pushes.
     - Macropad: 149.3 g, of which 98.1 g (66%) is estimated; the 2 N corner-key press never tips it.
     - Ponder: 1089.7 g, of which 385.1 g (35%) is estimated.
   - Per-line masses need PR 2.
5. **Function probes.** Sound, Port, View, Light, Keepout. The macropad has 2 (bootsel, led) and Ponder 9.
6. **Electrical, strength and materials.** Each row reads "not checked yet" and never "passed", until its PLAN item lands.
7. **Evals.** The self-test (macropad 12/12, Ponder 19/19) and `faults.json` (macropad 10/10 caught, 0 false alarms; Ponder has no list yet, PLAN.md:32).
8. **The gate commands:** `/sprue accept|edit|decline <slug>`.

**Both worked examples fail Inspect on main today.**
- Macropad: overlap and clearance (W1). PR 1 fixes both.
- Ponder: clearance (6 problems) and the radio keep-out (4).
- `print-walls`, `print-skins` and `standards` are Design flags, so they don't affect Inspect.
- Once tagged, Ponder's flagged assembly rules show at Inspect: power-budget, head-voltage, tip-arm-straight, tip-push, drop, harness-bore.

### 1.3 Decisions Tobias owes

1. **What happens at a failing Inspect?**
   - (a) Fix first, no override. Ponder stays blocked until its 10 problems are fixed; that work is not scoped.
   - (b) Accept with a written reason at the gate, saved as the gate's note.
   - (c) **Recommended:** fix first at the gate, but let the design accept a known risk in `_system.py` with its reason. `Pose.accept` and `Push.accept` already do this for tipping (`cad/system.py` Push and Pose): a flag, not a failure. Extend it to probes and pairs. The reason is then versioned with the design, and the gate shows it as a flag.
2. **Order.** 3D view first (PRs 2–7, no change to the stages) or the Inspect stage first (PRs 8–11)? **Recommended: 3D first.** It is what he asked to use in Design, it touches no gate, and the Inspect section reuses it.
3. **The estimated-mass share.** A flag (recommended, like "Keep flags" on 2026-10-19), or a fail at 50%? A 50% fail would fail the keypad at 66%.

### 1.4 Migrating an old state.json

Use an in-memory insert and never rewrite a gate the person accepted.

- In `readState()`, when `stages.inspect` is missing and design is accepted, treat Inspect as `drafting`.
- Nothing else is needed:
  - `current()` returns Inspect, since it is the first stage not accepted (`state.ts:42`).
  - `gateOf()` already shows later stages as "not started", whatever the file says (`state.ts:153-156`).
  - `openBefore()` already refuses to accept or propose them.
  - `propose design` already reopens every later stage (`state.ts:137-147`).
- No `version` field: in new files, `accept design` always writes `inspect: drafting` (`state.ts:109`).
- The file changes only when a command saves state.
- The macropad and Ponder have design proposed, so nothing changes for them.
- The co2-monitor eval's `state.json` is a record of that run and stays as it is.

The draft's alternative is defensible: set Source and Build back to drafting. But it overwrites accepted gates to guard a case `openBefore` already guards. I rejected auto-accepting Inspect when `system.json` is current and ok, as the draft did: it would accept a gate the person never saw.

### 1.5 The checks Tobias named

| Tobias's words | Exists today | Missing | Already planned in | Planted fault |
|---|---|---|---|---|
| "screws go in the piece, each piece that is supposed to fit into another do fit" | `system.py`: each declared Fit must share volume (overlap gate), plus contact, inside and clearance; `screw-engagement` and `insert-depth` from params | Depth: a minimum engagement per Fit (the screw's length inside the insert), measured on the placed solids. Insertion paths (the lid can't close with the plug in). Real bought-part models: 41 of 44 are envelopes. | PLAN.md:42, :51 | Screw 2 mm shorter; insert bore 0.3 mm smaller |
| "electricity flows" | `usb-power` (counts only the controller); Ponder's `power-budget`, `head-voltage` (DC drop), `gpio-current`, `harness-conductors`; the board netlist (`.d356`); firmware on an emulated Pico | A typed netlist across parts and a power tree. ngspice called as a program. A track-current rule. | PLAN.md:49, :57 ("IPC-2221 track-current rule"); `research/system-testing.md:141-158` | VBUS pin left off; a rail under a sink's minimum |
| "the physics and weighting" | Mass, COM, tipping and pushes (system.py stability); Ponder's `drop` | Measured or datasheet masses (66% estimated on the keypad). Stress only where a part carries load: Ponder's arm first, not the keypad plate, whose load goes through the switches into the board. | PLAN.md:52, :57 | One foot removed; a plate made 0.6 mm |
| "materials" | `spec.material` on the 2 printed lines (PETG); FR4 only in `_system.py` | A material on every line, read once (the part contracts of PLAN.md:50, not typed twice). A cited `reference/materials.json`. A rule against an operating temperature. | PLAN.md:50 | PETG case at 80 °C; a line with no material |

**FEA notes.**
- Known since 2026-10-15: FEA is cheap. The work is the supports and loads taken from the system frame.
- Sanity gates for any solver run: no element with a negative Jacobian (this trial had 3), reaction forces that sum to the load, small strain (6.9 mm on a 1.5 mm plate is not).
- The top prints plate down, so plate bending is in-plane: use 47 MPa. Bosses and standoffs load across layers: use the 18 MPa interlayer figure with a stated factor (the research note suggests a 50% derate in Z).

### 1.6 Risks (Inspect)

- **Gate fatigue.** Four gates. Inspect proposes itself the moment it passes; the accept is one command.
- **Staleness after picks** (M3). Decide in PR 10.
- **Runtime.** The whole-product check takes 50 s on the keypad and 153 s on Ponder (170 of Ponder's 188 s is ray casting, PLAN.md:51). `inspect` must rerun it only when stale, and `faults` must not run it twice per copy.
- **Envelopes.** Show the envelope share, and never call a fit "proven" on envelopes alone.
- **GPL and install burden.** CalculiX is GPL (https://en.wikipedia.org/wiki/Calculix). Run it and ngspice as separate programs, and show "not checked" when they are missing. Whether Homebrew carries all three for macOS: unconfirmed.

---

## 2. The 3D view

### 2.1 What the prototype does (verified)

- **Page.** `viewer-proto/view.html` is 3021 KB (it was 1026 KB). It opens from `file://`.
- **Library.** three.js 0.186.1, 6 modules, 827 KB minified, inlined as text and loaded as `blob:` modules under a generated import map. Tested in Chromium only; Firefox and Safari are unconfirmed.
- **Model.** All 44 placed items in one frame, 27,216 triangles, from `system.py`'s own items. The board is textured from its Gerber previews. CAD solids are drawn solid and envelopes dashed.
- **Interaction.** Orbit, pan, zoom and Fit. Click to pick. The panel has facts, fits and contacts, checks and files. An apart slider follows the figure's lifts, steps follow the drawing, and there are Problems, X-ray and Mass toggles.
- **Sync.** `a2:select` and `a2:hover` work both ways (rerun here).
- **Mode and links.** Drawing and 3D tabs in Fig 1. The choice is remembered in `localStorage`, and the hash deep-links a view.
- **Speed.** About 4.2 s to ready under SwiftShader.

**What the screenshots show needs fixing:**
1. Shots 2 and 5b: "✓ Whole product: placed, contact, inside, stability, function" under a keycap and under the Pico, while the product fails. It reads as a pass. List only problems that name the part.
2. Shot 4, step 5 of 9: the Mass overlay shows the whole product's 149.3 g and COM over half the parts. The viewer hides it only when parts are apart (`viewer3d.js:306`). Hide it on a step.
3. Shot 2: after the pick reframes the camera, the readout says "Case top / switch plate" while cap6 is selected. While a part is pinned, show the pinned part.
4. Shot 3 (apart): the scr2 gap dot is drawn through the PCB and looks as if it sits on the Pico. Dim marks that are behind a part, or hide labels while parts are apart.
5. Shots 1 and 7: switching Drawing and 3D changes the figure column from about 440 to 760 px at 1440, which reflows the whole page.
6. Shot 5b: the files list `meshes/stl/ctrl.stl`, which exists only in the prototype. `fab/` and `pcb/` may be missing, and on the site nothing exists. List only files that exist.
7. Shot 7 against shot 1: the drawing shows the whole cable, while 3D shows only the plug's envelope. That is honest, but the legend should say it.

### 2.2 Risks (3D)

- **Page and repo size.** About 0.8 MB of vendored code, plus the GLB in `previews/` committed per model change (B1). Shrink the board mesh first (B2).
- **No WebGL.** Stay on Drawing, with a note.
- **Import maps from `blob:` URLs.** Avoid them: rewrite each inlined module's specifiers to the `blob:` URLs of the modules it imports, in dependency order (core first), or ship one bundle. That removes the browser question. That `blob:` module scripts load from `file://` in Safari: unconfirmed.
- **Ponder.** Without its arm drawn, the model misreads the product (M6).
- **A stale model.** The page must say "model of an earlier design" when the inputs recorded with the GLB differ from the files now.

---

## 3. The PRs, in order

Each PR runs `npm run lint` and `npm run build` (which type-checks the pipeline) and the pipeline tests it touches. Effort is the hours of a Claude run, my estimate. At 1–3 items per daily run this is about 7–10 runs.

| PR | What | Files | Test / proof | Effort | Needs |
|---|---|---|---|---|---|
| **1** | **Keypad case, second pass** (moves the metric). Cut the USB opening through the tray wall; `counterboreMm` 6.0 → 6.4. Drop the two fixed problems from `reference/faults.json` `known`. | `examples/macropad/cad/bottom.py`, `design.json`, `reference/faults.json`; regenerate `system.json`, `checks.json`, `score.json`, `faults.json` | `sprue system macropad`: 7/7 gates, self-test 12/12. `sprue faults`: 10/10, 0 false alarms. Whether the score then PASSES: unconfirmed until run. The overmold size is an estimate: say so. | 1–2 h | — |
| **2** | **`system.json` says where.** Per item: id, line, model, material, massG, massNote, bbox. Relations: fits, contacts, inside, unplaced, minClearanceMm. Beside each problem's text: `{parts, at}` (the overlap's shared-solid centre; the clearance's closest points). The text is unchanged, so `score.ts` and `faults.ts` don't change. | `cad/system.py`, `pipeline/system.test.ts`, `reference/formats.md` | A test per new field; a planted overlap's `at` lies inside both parts | 2–3 h | — |
| **3** | **`figure.json` keeps `lift`.** One line, and matches `formats.md:35`. | `pipeline/figure.ts:231`, `figure.test.ts`, examples' `figure.json` | `lift` round-trips | 1 h | — |
| **4** | **Export the model.** `system.py` writes `previews/system.glb` from the placed items, with a coarse board (the texture carries the detail), committed for the examples. Record its inputs hash. | `cad/system.py`, `system.test.ts`, `.gitignore` unchanged | The GLB has one node per item; the triangle count is reported | 2–3 h | 2 |
| **5** | **Vendor three.js 0.186.1.** `viewer/vendor/three/`: 6 modules and LICENSE; a NOTICE line; `vendor.mjs` that fetches the pinned npm tarball, checks its registry integrity hash, rewrites the specifiers and minifies with a pinned minifier. | new files, `skills/sprue/NOTICE` | Review = rerun `vendor.mjs` and see an empty diff | 1–2 h | — |
| **6a** | **The view, read-only.** Load, orbit, Fit, pick, a panel built from PR 2 data, files that exist, the CAD/envelope legend, the WebGL fallback, reduced motion (reuse `figure.js`'s `still`), a readout that follows the selection, no "✓ Whole product" rows. | `viewer/model.js`, `viewer/model.css` | Unit tests of the panel builder | 3–4 h | 2, 4, 5 |
| **6b** | **Apart, steps, sync, toggles.** Lifts (PR 3), steps, `a2:*` both ways, one hash grammar (`select=<line>`, `part=<item>`, `apart`, `step`, `3d`), Mass only for the whole product, Problems with marks dimmed when hidden, X-ray. | `viewer/model.js`, `viewer/figure.js` (hash) | The sync test as asserts, not prints | 3–4 h | 3, 6a |
| **7** | **`page.ts` puts it in Fig 1.** Drawing and 3D tabs (Drawing the default), inlined vendor code, GLB and skins, the stale-model note, one column width for both tabs. `copy-figures.mjs` carries it to the site. A Playwright smoke test from `file://` (data-ready, no console errors, a click selects), skipped without Chromium. | `pipeline/page.ts`, `viewer/view.html`, `scripts/copy-figures.mjs`, new `pipeline/model.test.ts` | Shots at 1440 and 390 px, light and dark | 2–3 h | 6b |
| **8** | **Check scope.** `Rule.scope: "part" \| "assembly"` plus `lines`. Tag the built-ins (1.1) and Ponder's 26 rules. `sprue check` names a local rule with no scope (read as part). `checks.json` carries scope and lines. | `stages/check.ts`, `types.ts`, `check.test.ts`, `examples/ponder/rules.ts`, examples' `checks.json` | Each built-in's scope is pinned in a test | 2 h | — |
| **9** | **The stage machine.** `STAGES` gets inspect and `WHAT.inspect`; the in-memory migration (1.4); every "of 3" becomes `STAGES.length`; the `Record<Stage>` maps (M1), with `system.json` moved into an inspect group in `status.ts`; the gate texts in `page.ts:53-68`; `pricesOf` hidden until Source (M8); `explorer.js` STAGES. **Merge together with PR 10**, or a run stops at an Inspect nothing proposes. | `state.ts`, `status.ts`, `page.ts`, `viewer/explorer.js`, new `state.test.ts`, `status.test.ts` (fixture at :38) | Old file (design accepted) → at Inspect, later stages "not started", accepting Inspect resumes; a new file; reopening | 3 h | — |
| **10** | **`sprue inspect <slug>`.** Calls `systemIfStale` (not `systemStage`, since `cad` already ran it), prints the verdict and the assembly checks, and proposes Inspect only when both pass. `all` runs it after `check`. The usage block and the commands list. `gateNote` only on `inspect`, not `system`. `faults.ts` STEPS unchanged: `all` covers it. No `inspect.json` in v1, so `RUN_OUTPUTS` and the fault copies don't change. `accept` refuses a failing Inspect per decision 1. The pick-staleness rule (M3). | `pipeline/cli.ts`, `state.ts` (`accept`), `cli.test.ts` | A failing product isn't proposed; a passing one is; a pick doesn't reopen an accepted Inspect | 2–3 h | 8, 9 |
| **11a** | **The Inspect section.** `Explorer.inspect` (verdict, problems, relations, stability, probes, assembly checks); the explorer section; "not checked yet" rows; a "Before you accept" list at Inspect; Design shows only part-scope checks; at Inspect, Fig 1 opens on 3D with Problems on. | `pipeline/explore.ts`, `viewer/explorer.js`, `explorer.css` | Shots | 3–4 h | 2, 7, 10 |
| **11b** | **Site.** Four stages; the gate cards in `src/lib/example.ts`; the stage rows in `page.tsx`. | `src/components/WorkedExample.tsx`, `src/lib/example.ts`, `src/app/page.tsx` | `npm run build`, shots at 1440 and 390 px | 2 h | 11a |
| **12** | **Docs.** SKILL.md (the description, four stages, the "parts go together" rule moves to the Inspect gate), run.md (a new "Stage 2: Inspect" with its gate questions; gate numbers), formats.md, edit.md, swap.md, figure.md:76, README, `docs/pipeline.md`, the types.ts comment. Propose the CLAUDE.md edit in the PR text, since it is Tobias's file. | docs | Read-through | 2 h | 10 |
| **13** | **Regenerate the examples.** `checks.json`, `system.json`, `previews/system.glb`, `figure.json`, `explorer.json`, and shots. | `examples/*/` | `sprue status` and `sprue score` on both | 1–2 h | 11b, 12 |
| **14** | **Ponder in 3D.** The arm drawn along each pose's path, the harness and the other unplaced lines named in the panel, a pose switch, the 9 probes drawn, per-call lifts. | `cad/system.py`, `viewer/model.js`, `examples/ponder/figure.mjs` | Shots per pose | 4–6 h | 7 |

**Not in this plan, already in PLAN.md:**
- The estimated-mass flag: one small PR after PR 2, per decision 3.
- Fit engagement depth: PLAN.md:42/:51 area; add as an item.
- Materials: PLAN.md:50.
- Electrical: PLAN.md:49.
- Strength: PLAN.md:57.
- The slicer gate for Design: PLAN.md:53.
- Makers' STEP models: PLAN.md:51.
- "A failure stops the run": PLAN.md:38, which decision 1 overlaps.

PRs 5, 6a and 6b sit at the edge of a five-minute review: PR 5 because the vendored code is minified, 6a and 6b because each is about 15–18 KB of JS.
