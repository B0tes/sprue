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

- **PCBs have one mature open validator: KiCad's DRC** (KiCad, about 3.0k★ on its GitHub mirror, GPL-3.0). Every
  open checker and CI tool around it (KiBot, KiKit, kicad-happy) expects a KiCad project, and Sprue doesn't write one.
  The bridge is to rebuild the board in KiCad from the Gerber zip we ship and run KiCad's DRC with each fab's own rule
  file. Our Gerbers carry the net, part and pin on every track and pad (X2 attributes), so gerbonara can rebuild them.
  Tried on the keypad: KiCad measured the tight hole gap at 0.4648 mm, where our DRC reports 0.465 mm, and KiCad's
  IPC-D-356 export matched ours on 129 of 129 records.
- **For every other process, open source gives engines but no checker.** There are good slicers, FEA solvers and a
  CAD kernel, but no maintained open tool for design-for-manufacturing checks on machined, bent, moulded or printed
  parts. Those rules stay our own code on build123d, trimesh and shapely, with each fab's published numbers, the way
  `drc.ts` already works for PCBs.
- **Several tools pass bad input without complaint, so every gate needs its own sanity check and planted faults:**
  - PrusaSlicer exits 0 after silently dropping a 0.08 mm fin.
  - CalculiX exits 0 on a model with no supports and reports displacements of 10^12 mm.
  - Sprue's own `stlIsWatertight` passes a part with a sealed void inside.
- **The trials found real issues in the keypad case** (below). The board itself is fine.

## PCB

| Check | Best open tool | Adopt | Tried on the keypad |
|---|---|---|---|
| A second DRC engine | KiCad DRC: `pcbnew.WriteDRCReport` on the installed 7.0.11; `kicad-cli pcb drc` on 8 and later | Now, non-blocking, on a board rebuilt from the shipped zip | Hole gap 0.4648 mm (ours: 0.465). On 7.0.11 a broken rule file fails loudly. KiCad checks the GND fill we give it as is, without refilling it |
| Fab rule files | Aisler's official KiCad templates (AislerHQ/aisler-support, 92★). For JLCPCB and PCBWay 2-layer: Cimos/kicad-druid (MIT, 3★, ships a canary rule) | With the KiCad check | Aisler's numbers match our `FAB_PROFILES.aisler` |
| Netlist compare | Keep `readback.py` (gerbonara, Apache-2.0, plus shapely). Add a diff of KiCad's IPC-D-356 export against ours with `gerbonara.ipc356` | With the KiCad check | 129/129 records identical. KiCad 7 writes the solder-mask field one column early, so skip that field |
| A second Gerber reader | gerbv (270★, GPL-2.0) rendered against gerbonara and XORed | Now | 0 px difference on all 8 files at 1000 DPI. That resolution misses a 0.05 mm pad-size disagreement; 3000 DPI catches it, at about 16 s a layer |
| Revision diff | The same gerbv render of the old and new zip, with a raw XOR | Now | A pad moved by 0.02 mm was found and located |
| Board against case | A build123d solid built from the zip (Edge_Cuts plus both drill files) placed against `top.step` and `bottom.step` | Now: it covers the backlog's "mechanical cross-check" | 0 overlap. The XY margin is only 0.4 to 0.5 mm (finding 1) |
| A third DFM engine on the fab files | delta-gerber (MIT, 17★, Java, 1.8.2 in September 2026), the only open DFM that reads Gerber, Excellon and IPC-D-356 | Later, non-blocking | Not run: it needs a download |
| ERC | Keep `intent.ts`. SKiDL (1.7k★, MIT) once a board carries ICs or power parts. KiCad ERC needs a `.kicad_sch` | Later | Nothing to add on the keypad |
| Circuit simulation | ngspice (BSD-3-Clause, installed). Run Monte Carlo as ngspice's own loops: spicelib's version targets LTspice | Later, for Ponder's supply rails and audio | A key press settles in at most 4.25 µs against a 20 ms scan, so SPICE can't fail the keypad |
| Track current and heat | Our own IPC-2221 rule over `board.json` | Once `design.json` gives each net a current | The keypad routes no supply net. The kit's 0.3 mm default track carries 1.0 A |
| Impedance and EMC | scikit-rf's closed-form microstrip (948★, BSD-3-Clause) first, then gerber2ems and openEMS (261★ and 772★) for RF or fast USB | Later (Ponder) | Return-path coverage computed from the Gerbers: GP2 runs 28.7% over the ground pour. That's harmless for slow key lines |
| Firmware | Keep rp2040js (527★, MIT, 1.4.0 of 2026-09-25). Add switch-bounce injection. Renode (2.9k★) or Espressif's QEMU for other MCUs | Bounce now | None. Bounce injection is a planned next step |
| SMT boards | Fabrication-Toolkit (691★, Apache-2.0, headless BOM and pick-and-place files), KiKit (2k★) for panels, InteractiveHtmlBom (4.6k★) for hand assembly, JLC2KiCadLib (484★, MIT) for LCSC footprints | Later | — |

Not worth adopting:
- KiBot (753★, AGPL-3.0) wraps KiCad and adds nothing to a single DRC run.
- tracespace (949★) says its own development is on hiatus.
- pcb-rnd and LibrePCB each need their own board format.
- kiri and KiCad-Diff need KiCad projects.
- The official KiCad Library Convention checker checks style, not dimensions; our footprint tests against reference numbers stay.

## Other processes and materials

| Process | Best pick | What open source doesn't cover |
|---|---|---|
| FDM printing | PrusaSlicer CLI (9.4k★, AGPL-3.0) in each part's print orientation, with a small hand-written `.ini`. Fail on the stability warning, on any support material, and on a sliced height below the mesh's. Add trimesh (3.7k★, MIT) for body count, signed volume, overhang area and wall thickness, and OpenCascade's `BRepAlgoAPI_Check` (through the installed OCP) for self-intersections. Take the limits from each fab's guideline, starting with JLC3DP. OrcaSlicer (16k★) has better exit codes and is a later option | A machine-readable report of what the slicer dropped or thickened. Hole shrinkage and warping |
| Resin (SLA) | PrusaSlicer `--export-sla` without hollowing (its CLI can't place drain holes). Add UVtools (1.6k★, AGPL-3.0) later for islands and suction cups | Orientation by peel force |
| Powder (MJF, SLS) | trimesh body split plus a voxel flood fill for trapped cavities and escape holes | Any open escape-hole or warp check |
| CNC machining | Our own build123d check: inside corner radius against pocket depth, pocket depth against tool, thin walls. Use Hubs' and Protolabs' numbers per shop. FreeCAD CAM (FreeCAD, 34k★) only if Sprue ever writes toolpaths; shops do their own CAM | A maintained machinability analyser (setups, tool reach, time) |
| Sheet metal | build123d's sheet-metal module (in its development docs, not yet in 0.13) for unfolding with a K-factor. Until then, `make_brake_formed` plus our own bend-rule check, with numbers per supplier. Laserboost's table is stricter than generic rules: a 1.5 mm sheet needs a 9.5 mm minimum flange, where 4t gives 6 mm. FreeCAD SheetMetal's unfold needs its GUI | Bend sequence, press-brake collisions, springback |
| Laser and waterjet | ezdxf (1.4k★, MIT) and shapely (4.5k★, BSD-3-Clause) in our own DXF check: closed contours, the smallest web against kerf, and double cuts. The prototype caught 8 of 8 simple faults but missed a duplicate circle and a partial overlap. `ezdxf audit` checks file structure only | Per-material shop minimums and kerf tables |
| Injection moulding | Our own OpenCascade check for draft, undercuts and wall uniformity. On the printed keypad top it reports 76 of 92 faces without draft, as expected for a printed part. No open mould-flow tool runs headless: openInjMoldSim targets OpenFOAM 7 | Fill, warp and gate placement (the moulder's review) |
| Structure (FEA) | CalculiX (205★ on Dhondtguido/CalculiX, GPL-2.0) on gmsh meshes. Gate on reaction forces equal to the applied load and on a Jacobian check of every element, not on the exit code. NGSolve (584★, LGPL-2.1) later as a second solver | Picking boundary conditions. Validated fracture models for printed parts |
| Heat | A lumped model using the `ht` library (254★, MIT) for natural convection and radiation, then CalculiX heat transfer with film and radiation. Radiation matters: in the test case it lowered the hot spot from 115 °C to 92 °C | Air flow inside a small sealed case without full CFD |
| Assembly fit and tolerances | build123d and OpenCascade: overlap volume, clearance between pairs not declared as contacts, and a shift sweep for margin. Our own tolerance stack (worst case, RSS, Monte Carlo); the open ones are tiny (dimstack, 2★) | A 3D GD&T stack that reads STEP |
| Mechanisms | MuJoCo (15.5k★, Apache-2.0), only once a product moves. Tip-over stays a mass calculation | Drop survival of printed parts (a real unit decides) |
| Materials | Our own `materials.json`, citing vendor data sheets, with X-Y and Z values for printed parts. FreeCAD's material cards as a fallback | An open database of printed-part properties by direction. Shear moduli and Poisson ratios aren't published, and in the trial they, not the data-sheet stiffness, drove the orthotropic result |

## What the trials found on the keypad

1. **The board has little room in the case.** It can shift only 0.4 to 0.5 mm in X or Y before it touches the top
   shell. The worst case of ±0.2 mm on the board outline plus ±0.3 mm on the print is 0.5 mm. The PCB's 1.0 mm
   corners sit 0.376 mm from the tray's 1.8 mm inner corners, against the 0.5 mm gap `caseClearanceMm` intends.
2. **The case clamps the board twice.** The top's walls sit on the tray's walls and its bosses sit on the PCB, at
   the same nominal height (`top.py`, `bottom.py`). Which one touches first depends on the real board thickness
   (1.6 mm ±10%) and on the print, so either the board can rattle or the walls leave a gap. *(Inferred from the CAD;
   not measured.)*
3. **The Pico has 0.2 mm under the lid skin** (`minClearanceMm`), which a ±0.3 mm print can close.
4. **The tray needs support in its four counterbores** when printed floor down (+0.11 cm³), although PrusaSlicer
   prints no warning.
5. **The walls are thin by JLC3DP's FDM guideline**, which asks for 2.0 mm on a part about 100 mm long. The top's
   1.0 mm skin and 1.5 mm plate and the tray's 1.8 mm standoff walls fall short. MX switches need the 1.5 mm plate,
   so this is a question for JLC3DP, not a design change.
6. **The board checks agree.** KiCad confirms our tightest hole gap (0.465 mm, already a warning), and Aisler's
   official numbers match our Aisler profile.

Items 1 to 3 belong in the keypad's second pass. The 1:1 paper print of the board can't show them.

## Corrections to earlier research

- `research/physics-verification.md` lists scikit-fem, SfePy, PyBaMM, spicelib, InSpice and MuJoCo as installed here.
  Those test installs did not persist: none of them imports in this container today. gmsh here is the apt 4.12.1.
- The silently dropped `.kicad_dru` trap in `research/pcb-verification.md` belongs to `kicad-cli` (seen on KiCad 10).
  On the installed 7.0.11, `WriteDRCReport` returns False and writes no report for a bad rule file.
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
