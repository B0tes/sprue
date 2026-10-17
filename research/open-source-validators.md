# Open-source validators, by process (2026-10-15)

Tobias, 2026-10-15: "we need a way to validate the PCB design. We should look at github and see what the best open
source repos are for this process. Ideally do the same for other processes / materials."

Five areas were surveyed and then fact-checked by a second pass: PCB layout and fab files, circuits, 3D printing, CNC
and sheet metal, and structure and fit. Stars, licences and release dates are as read on each project's page on
2026-10-15 ("★" is GitHub stars, rounded). The tools were tried on the keypad's real files (the Gerber zip,
`macropad.d356`, `top.step`, `bottom.step` and the STLs) using only what is installed in this container: KiCad 7.0.11
with its Python module, gerbv, PrusaSlicer 2.7.2, CalculiX 2.21, gmsh 4.12.1, ngspice 42, build123d 0.13, OCP,
gerbonara 1.6.3, trimesh 5.1.1 and ezdxf 1.4.4. Nothing was installed, uploaded or ordered. The raw survey, the
fact-check and the trial scripts are in the project's shared folder at `anatomy-2/research/oss-validators-2026-10-15/`,
not in the repo.

## Short answers

- **PCBs have one mature open validator: KiCad's DRC** (KiCad, about 3.0k★ on its GitHub mirror, GPL-3.0). The CI
  tools around it (KiBot, KiKit) expect a KiCad project, which Sprue doesn't write. kicad-happy also reads Gerbers, but
  there it only checks that the layers and the drill file are present. LibrePCB and pcb-rnd each need their own format.
  The bridge is to rebuild the board in KiCad from the Gerber zip we ship and run KiCad's DRC with Aisler's official
  rule file and a community rule file for JLCPCB and PCBWay. Our Gerbers carry the net on every track, and the net,
  part and pin on every pad (X2 attributes), so gerbonara can rebuild them. The GND pour's net has to be assigned by
  the rebuild, since gerbonara drops the attributes on filled regions.
  The rebuild from the zip is the next step and hasn't been tried yet. A simpler KiCad board written from `board.json`
  (unrouted, no pour) already agrees with our DRC on the tightest hole gap (0.4648 against 0.465 mm), and its IPC-D-356
  export matches ours on 129 of 129 records.
  *Update 2026-10-17:* built as `pipeline/pcb/kicad.py`, a layer of `sprue verify` that does not hold back the
  board. On the keypad rebuilt from its zip (58 pads, 18 vias, 111 tracks, 53 holes and the pour, stored and never
  refilled), KiCad 7.0.11 finds 0 errors with our rules, with each fab's numbers, with Aisler's rule file and with
  kicad-druid's JLCPCB and PCBWay 2L-1oz files. All three files load on 7.0.11 (a canary rule fires in each, though
  druid's are written for KiCad 8). The IPC-D-356 export of the rebuilt board matches ours on 129 of 129 records, and
  KiCad reports each of four faults put into copies. Three traps: a cut-out circle approximated by an inscribed
  polygon leaves the pour about 0.0014 mm too close, which KiCad reports as 45 clearance errors, so the rebuild draws
  cut-outs just outside their circles; KiCad's report gives a violation of no named rule (an open net, a zone's own
  clearance) as "Local override; Severity: error", which a parser looking for "Rule:" files as a warning; and a
  rule whose condition does not compile is skipped without a word while the rest of the file runs, so a canary proves
  only that the file parsed, and each condition needs a probe of its own (all 70 in the pinned files compile on
  7.0.11). KiCad also stops reporting a kind of violation after about 200, so canaries and probes fire on one marker
  line each, not on every line of the outline.
- **For the other processes, open source gives engines but almost no checkers.** There are good slicers, FEA solvers
  and a CAD kernel. Apart from UVtools for resin prints, there is no maintained open tool for design-for-manufacturing
  checks on machined, bent, moulded or printed parts. Those rules stay our own code on build123d, trimesh and
  shapely, with each fab's published numbers, the way `drc.ts` already works for PCBs.
- **Several tools pass bad input without complaint, so every gate needs its own sanity check and planted faults:**
  - PrusaSlicer exits 0 after silently dropping a 0.08 mm fin.
  - CalculiX exits 0 on a model with no supports and reports displacements of 10^12 mm.
  - Sprue's own `stlIsWatertight` passes a part with a sealed void inside.
- **The trials found real issues in the keypad case** (below), each with a fix. The board passes every check run on it so far.

## PCB

| Check | Best open tool | Adopt | Tried on the keypad |
|---|---|---|---|
| A second DRC engine | KiCad DRC: `pcbnew.WriteDRCReport` on the installed 7.0.11; `kicad-cli pcb drc` on 8 and later | Now, non-blocking, on a board rebuilt from the shipped zip, with the pour stored as a fill and never refilled | On a board written from `board.json` (unrouted, no pour): hole gap 0.4648 mm (ours: 0.465). On 7.0.11 a broken rule file fails loudly. Clearance and track checks wait for the rebuild from the zip |
| Fab rule files | Aisler's official KiCad templates (AislerHQ/aisler-support, 92★). For JLCPCB and PCBWay 2-layer: Cimos/kicad-druid (MIT, a 3★ community repo, ships a canary rule) | With the KiCad check. Aisler's repo names no licence, so fetch its file at run time rather than copying it into ours | Neither file has been loaded yet: the proxy refused the download. Aisler's published numbers match our `FAB_PROFILES.aisler` |
| Netlist compare | Keep `readback.py` (gerbonara, Apache-2.0, plus shapely). Add a diff of KiCad's IPC-D-356 export against ours with `gerbonara.ipc356` | With the KiCad check | 129 of 129 records match on net, position, type, hole and size (board written from `board.json`). That checks our `.d356` writer, not the copper. Skip the part names and the solder-mask field, which KiCad 7 writes one column early |
| A second Gerber reader | gerbv (270★, GPL-2.0) rendered against gerbonara and XORed | Now | 0 px difference on all 8 files at 1000 DPI after a 1-px erosion, but that misses a 0.05 mm pad-size disagreement. 3000 DPI catches it, at about 16 s a layer, and shows a 2 px difference on clean files, so it needs a small threshold |
| Revision diff | The same gerbv render of the old and new zip, with a raw XOR | Now | A pad moved by 0.02 mm was found and located |
| Board against case | A build123d solid built from the zip (Edge_Cuts plus both drill files) placed against `top.step` and `bottom.step` | Now: it covers the backlog's "mechanical cross-check" | 0 overlap. The board can move only 0.44 mm in X or Y and 0.38 mm diagonally (finding 1) |
| A third DFM engine on the fab files | delta-gerber (MIT, 17★, Java, 1.8.2 in September 2026), the only open DFM that reads Gerber, Excellon and IPC-D-356 | Later, non-blocking | Not run: it needs a download |
| ERC | Keep `intent.ts`. SKiDL (1.7k★, MIT) once a board carries ICs or power parts. KiCad ERC needs a `.kicad_sch` | Later | Nothing to add on the keypad |
| Circuit simulation | ngspice (BSD-3-Clause, installed). Gate on stepping every tolerance corner with ngspice's own loops (`foreach`, `alterparam`). Use Monte Carlo only to show spreads: in the trial, 200 random runs missed the worst corner (3.46 against 3.72 µs). spicelib's Monte Carlo targets LTspice | Later, for Ponder's supply rails and audio | A key line settles within 4.25 µs after release (a press takes about 10 ns), against a 20 ms scan, so SPICE can't fail the keypad. The switch's own bounce, up to 5 ms, is what matters, and that belongs to the firmware run |
| Track current and heat | Our own IPC-2221 rule, with track widths read from the routes or the Gerbers | Once `design.json` gives each net a current | The keypad routes no supply net. The kit's 0.3 mm default track carries 1.0 A |
| Impedance and EMC | scikit-rf's closed-form microstrip (948★, BSD-3-Clause) first, then gerber2ems and openEMS (261★ and 772★) for RF or fast USB | Later (Ponder) | From the Gerbers: only 28.7% of the GP2 key line runs over the ground pour on the other layer, so its return current has no plane under most of its length. That's harmless for a slow key line, and becomes a rule for fast nets |
| Firmware | Keep rp2040js (527★, MIT, 1.4.0 of 2026-09-25). Add switch-bounce injection. Renode (2.9k★) or Espressif's QEMU for other MCUs | Keep; bounce injection later | None |
| SMT boards | Fabrication-Toolkit (691★, Apache-2.0, headless BOM and pick-and-place files), KiKit (2k★) for panels, InteractiveHtmlBom (4.6k★) for hand assembly, JLC2KiCadLib (484★, MIT) for LCSC footprints | Later | — |

Not worth adopting:
- KiBot (753★, AGPL-3.0) wraps KiCad and adds nothing to a single DRC run.
- tracespace (949★) says its own development is on hiatus.
- pcb-rnd and LibrePCB each need their own board format.
- kiri and KiCad-Diff need KiCad projects.
- The official KiCad Library Convention checker checks style, not dimensions; our footprint tests against reference numbers stay.

Two gaps in our own Gerber writer showed up along the way. It writes no `%TA.AperFunction` attributes, which KiCad and
DFM tools use to tell pads from tracks and fills, and no `.gbrjob` job file listing the layers and the stack. Both are
small additions to the kit.

## Other processes and materials

| Process | Best pick | What open source doesn't cover |
|---|---|---|
| FDM printing | PrusaSlicer CLI (9.4k★, AGPL-3.0) in each part's print orientation, with a small hand-written `.ini`. Fail on the stability warning, on any support material, and on a sliced height below the mesh's. Add trimesh (3.7k★, MIT) for body count, signed volume, overhang area and wall thickness, and OpenCascade's `BRepAlgoAPI_Check` (through the installed OCP) for self-intersections. Take the limits from each fab's guideline, starting with JLC3DP. OrcaSlicer (16k★) has better exit codes and is a later option | A machine-readable report of what the slicer dropped or thickened. Hole shrinkage and warping |
| Resin (SLA) | PrusaSlicer `--export-sla` without hollowing (its CLI can't place drain holes). Add UVtools (1.6k★, AGPL-3.0) later for islands and suction cups | Orientation by peel force |
| Powder (MJF, SLS) | trimesh body split plus a voxel flood fill for trapped cavities and escape holes | Any open escape-hole or warp check |
| CNC machining | Our own build123d check: inside corner radius against pocket depth, pocket depth against tool, thin walls. Use Hubs' and Protolabs' numbers per shop. FreeCAD CAM (FreeCAD, 34k★) only if Sprue ever writes toolpaths; shops do their own CAM | A maintained machinability analyser (setups, tool reach, time) |
| Sheet metal | build123d's sheet-metal module (in its development docs, not yet in 0.13) for unfolding with a K-factor. Until then, `make_brake_formed` plus our own bend-rule check, with numbers per supplier. Laserboost's table is stricter than generic rules: a 1.5 mm sheet needs a 9.5 mm minimum flange, where 4t gives 6 mm. FreeCAD SheetMetal's unattended unfold is tied to its GUI; its newer unfolder may run headless (untested) | Bend sequence, press-brake collisions, springback |
| Laser and waterjet | ezdxf (1.4k★, MIT) and shapely (4.5k★, BSD-3-Clause) in our own DXF check: closed contours, the smallest web against kerf, and double cuts. The prototype caught 8 of 8 planted simple faults, but it missed a 0.5 mm tongue, a 0.4 mm notch, a duplicate circle and a partial overlap, and it crashes on a DXF made only of closed polylines, circles or ellipses, so it isn't ready to gate. `ezdxf audit` checks file structure only | Per-material shop minimums and kerf tables |
| Injection moulding | Our own OpenCascade check for draft, undercuts and wall uniformity. On the printed keypad top it reports 76 of 92 faces without draft, as expected for a printed part. For mould flow, openInjMoldSim runs headless but needs OpenFOAM 7 and a hand-built case for each part | Fill, warp and gate placement (the moulder's review) |
| Structure (FEA) | CalculiX (205★ on Dhondtguido/CalculiX, GPL-2.0) on gmsh meshes. Check its exit code (201 on input errors and on elements turned inside out) but don't trust it alone: also check that the forces at the supports add up to the applied load (a model with no supports exits 0) and that no mesh element is distorted past use (a Jacobian check). NGSolve (584★, LGPL-2.1) later as a second solver | Picking boundary conditions. Validated fracture models for printed parts |
| Heat | A lumped model using the `ht` library (254★, MIT) for natural convection and radiation, then CalculiX heat transfer with film and radiation. Radiation matters: in the test case it lowered the hot spot from 115 °C to 92 °C | Air flow inside a small sealed case without full CFD |
| Assembly fit and tolerances | build123d and OpenCascade: overlap volume, clearance between pairs not declared as contacts, and a shift sweep for margin. Our own tolerance stack (worst case, RSS, Monte Carlo); the open ones are tiny (dimstack, 2★) | A 3D GD&T stack that reads STEP |
| Mechanisms | MuJoCo (15.5k★, Apache-2.0), only once a product moves. Tip-over stays a mass calculation | Drop survival of printed parts (a real unit decides) |
| Materials | Our own `materials.json`, citing vendor data sheets, with X-Y and Z values for printed parts. FreeCAD's material cards as a fallback | An open database of printed-part properties by direction. Printed parts are stiffer along their layers than across them. Data sheets give the stiffness each way, but not how the part resists shearing or how much it narrows when stretched, and in the trial those missing numbers changed the result more than the published stiffness did |

## What the trials found on the keypad

1. **The board has little room in the case.** It can shift only 0.44 mm in X or Y, and 0.38 mm diagonally, before
   it touches the top shell. The board's outline (±0.2 mm) and the print (±0.3 mm) can take up 0.5 mm between them.
   The corners touch first: the board's corners are rounded to 1.0 mm and the top shell's inner corners to 1.8 mm, so
   at the corners the gap is 0.376 mm, not the 0.5 mm `caseClearanceMm` intends.
   *Fix:* round the shell's inner corners to match the board, and widen `caseClearanceMm` by up to 0.2 mm. More than
   that detaches the 8.4 mm screw bosses from the walls, so a wider gap needs the bosses tied back to them.
2. **The case clamps the board twice.** The top's walls sit on the tray's walls and its bosses sit on the PCB, at
   the same nominal height (`top.py`, `bottom.py`). Which one touches first depends on the real board thickness
   (1.6 mm, ±10% assumed) and on the print, so either the board can rattle or the walls leave a gap. *(Inferred from
   the CAD; not measured.)*
   *Fix:* clamp with the bosses alone and leave a designed gap or a lip where the walls meet.
3. **The Pico has 0.2 mm under the lid skin** (`minClearanceMm`) at nominal sizes. With ±0.3 mm per printed part the
   worst case is 0.66 mm of interference if the walls seat first, or 0.20 mm if the bosses seat first (0.26 and
   0.12 mm when the errors are added statistically). *(A stack-up from the CAD numbers, not measured.)*
   *Fix:* raise a local panel in the lid over the Pico. Thinning the skin or moving the plate would break the
   5.0 mm plate-to-board height the MX switches need.
4. **The tray needs support in its four counterbores** when printed floor down (+0.11 cm³), although PrusaSlicer
   prints no warning.
   *Fix:* close each counterbore with a one-layer sacrificial bridge, drilled out after printing.
5. **Some walls are thin by JLC3DP's FDM guideline.** It keys wall thickness to part size: 1.6 mm at 50 mm and 2.0 mm
   at 100 mm, and the case parts are 66.8 × 99.8 mm. The tray's 1.8 mm standoff walls meet the 50 mm figure and its
   1.5 mm rule for walls around fasteners. The top's 1.0 mm skin and 1.5 mm plate fall short of both size figures.
   The case is quoted from Craftcloud in PETG, so JLC3DP's table is only a reference.
   *Fix:* thicken the standoffs to 2.1 mm (`standoffOuterMm` 7.6). The plate stays 1.5 mm for the MX switches, so
   whether the skin and plate print well is a question for the print shop.
6. **The board checks agree so far.** Our tightest hole gap is 0.465 mm (already a warning); the KiCad board written
   from `board.json` measures 0.4648 mm. Aisler's published numbers match our Aisler profile.

Items 1 to 5 belong in the keypad's second pass. The 1:1 paper print of the board can't show them.

## Corrections to earlier research

- `research/physics-verification.md` lists scikit-fem, SfePy, PyBaMM, spicelib, InSpice and MuJoCo as installed here.
  Those test installs did not persist: none of them imports in this container today. gmsh here is the apt 4.12.1.
- The silently dropped `.kicad_dru` trap in `research/pcb-verification.md` belongs to `kicad-cli` (seen on KiCad 10).
  On the installed 7.0.11, `WriteDRCReport` returns False and writes no report for a bad rule file. (2026-10-17: the
  check appends a canary rule to every file anyway, so a file dropped on either path is said.)
- `research/physics-verification.md` says DRC needs KiCad 8 or later. That holds for `kicad-cli` only: the Python API
  of the installed 7.0.11 already runs DRC and writes IPC-D-356.
- Step 9 of `research/pcb-verification.md` writes the KiCad board from the kit's model and refills the zones. It is
  superseded: build the board from the shipped zip and never refill.
- rp2040js already enumerates the emulated Pico over USB for the console, so reading the keyboard's HID reports
  (backlog) is a small extension, not a missing capability.

## Sources (main pages read on 2026-10-15)

- KiCad: kicad.org/blog/2026/03/Version-10.0.0-Released/; docs.kicad.org (CLI manuals 8.0, 9.0, 10.0); github.com/KiCad/kicad-source-mirror
- Rule files: github.com/AislerHQ/aisler-support (kicad/aisler-2-layer-simple-drc); github.com/Cimos/kicad-druid; github.com/Cimos/KiCad-CustomDesignRules
- Fab-file readers: gitlab.com/gerbolyze/gerbonara and pypi.org/project/gerbonara; github.com/gerbv/gerbv; github.com/Delta-Proto/delta-gerber; github.com/tracespace/tracespace
- KiCad tooling: github.com/INTI-CMNB/KiBot; github.com/yaqwsx/KiKit; github.com/bennymeg/Fabrication-Toolkit; github.com/openscopeproject/InteractiveHtmlBom; github.com/TousstNicolas/JLC2KiCad_lib; github.com/aklofas/kicad-happy
- Circuits: github.com/devbisme/skidl; ngspice.sourceforge.io; github.com/antmicro/gerber2ems; github.com/thliebig/openEMS-Project; github.com/scikit-rf/scikit-rf; github.com/wokwi/rp2040js; github.com/renode/renode
- Printing: github.com/prusa3d/PrusaSlicer; github.com/OrcaSlicer/OrcaSlicer; github.com/mikedh/trimesh; github.com/elalish/manifold; github.com/sn4k3/UVtools; jlc3dp.com design guidelines
- Machining and sheet: github.com/FreeCAD/FreeCAD; github.com/aewallin/opencamlib; github.com/shaise/FreeCAD_SheetMetal; build123d.readthedocs.io; github.com/mozman/ezdxf; github.com/shapely/shapely; laserboost.com/metal-sheet-bending-design-guideline; hubs.com CNC design guide
- Structure and heat: github.com/Dhondtguido/CalculiX; gmsh.info; github.com/NGSolve/ngsolve; github.com/CalebBell/ht; github.com/google-deepmind/mujoco
