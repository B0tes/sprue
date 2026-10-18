# Can Sprue check its designs against physics without building them?

Research date: 2026-10-15. "Tested here" means it was run in this cloud container (Ubuntu 24.04.5, Python 3.13, Node 22) today. Every other claim links to a page that was opened or seen in search results. Anything that could not be confirmed is marked **unconfirmed**. Reasoning or arithmetic of my own is marked *(inferred)*.

## Short answer

- **We don't need to train a physics model now.** For small consumer hardware, the free classical solvers run in seconds and can be driven by code (CalculiX, ngspice, PrusaSlicer). The research shows the big gain comes from **putting a simulator in the LLM's loop**, not from learned physics:
  - EngDesign: o3 passes 34% of all 101 tasks in one shot. On a 71-task subset, with simulation feedback over ten tries, it reaches "almost a 60% pass rate". The authors say the subset's one-shot rates are "slightly lower" than the main table ([EngDesign](https://arxiv.org/html/2509.16204v2)).
  - Foam-Agent: in v1 of the paper, removing error-correction feedback dropped success from 83.6% to 37.3% ([Foam-Agent v1](https://arxiv.org/html/2505.04997v1)). The latest version (v3, August 2026) reports 88.2% on the 110 basic tasks and 62.5% on a harder out-of-distribution tier ([abstract](https://arxiv.org/abs/2505.04997)).
- **There are real limits, but a trained model fixes none of them:**
  - An LLM's design judgment is still weak. On design benchmarks, published scores run from about 5% (EDA Bench) to 75% (EEBench).
  - A verifier only catches what it checks.
  - Simulation inputs are uncertain: the strength of printed material, tolerances, supports and loads.
  - Some things only a built prototype shows: assembly, how keys feel, EMC, users.
- **Where Sprue stands today (from the repo):**
  - The PCB is already checked hard: our audit, a gerbonara read-back of the shipped zip, and the firmware on an emulated Pico.
  - The 15 checks in `products/macropad/checks.json` are rules on parameters. No solid geometry, slicer or solver checks the case and plate yet.

## 1. Simulators and checkers that run headless and can be driven by code

| Area | Tool | What it would catch on Sprue products | Install path (status) | Effort to automate |
|---|---|---|---|---|
| Fit and interference | build123d / OpenCascade (`a & b` volume, `a.distance_to(b)`) | Parts that collide. Clearance below the tolerance budget (Pico vs lid, sockets vs tray, USB plug vs wall) | Already installed (build123d 0.13.0). **Tested here:** overlap volume and clearance come out right on test boxes | Low. One catch, tested on the keypad: `top.py` and `bottom.py` each start at z=0 in their own frame, so a naive check reports a 4,922 mm³ overlap (reproduced: 4,921.6 mm³). Each part has to be placed in one assembly first |
| Tolerance stack-up | Our own worst-case, RSS and Monte Carlo code. `stackups` 1.2.5 is on PyPI ("calculate clearances between machinery parts"), but its last release was January 2018 and I haven't vetted it ([PyPI](https://pypi.org/project/stackups/)) | Fits that work at nominal size but fail at the fab's tolerance. JLC3DP states ±0.3 mm (within 100 mm) for FDM, MJF, SLS and SLM metal, and ±0.2 mm for SLA ([JLC3DP](https://jlc3dp.com/capabilities/3d-printing-service)) | pip, or about 50 lines of our own code | Low. Use worst-case for stacks of 3 or 4 parts ("worst case is normally reserved for three or four part stacks"). RSS assumes centred normal distributions and is "usually too optimistic" ([Wevolver](https://www.wevolver.com/article/tolerance-stack-up-analysis-worst-case-vs-rss-methods)) |
| Printability | PrusaSlicer CLI: `--export-gcode`, `--info`, `--load`, and for FDM supports `--support-material` / `--support-material-auto`. `--supports-enable` is the SLA option ([man page, 2.9.2](https://dyn.manpages.debian.org/trixie/prusa-slicer/prusa-slicer.1)) | Overhangs, bridging, non-manifold meshes, print time, filament volume | `apt install prusa-slicer` gives 2.7.2 on 24.04 (the linked man page is Debian's 2.9.2; flags checked against 2.7.2's `--help-fff`). **Tested here** on the keypad top shell: about 1.5–1.7 s per slice | Low. Details below the table |
| Printability (alternative) | CuraEngine CLI | Same | No package for Ubuntu 24.04: Launchpad lists Jammy (4.13) and Oracular (5.0), not Noble ([Launchpad](https://launchpad.net/ubuntu/+source/cura-engine/)), and apt has no candidate here | Not needed if PrusaSlicer is used |
| Mesh sanity | trimesh 5.1.1, admesh 0.98.5 | Leaky or non-manifold STL exports | pip / apt. **Tested here:** the top shell is watertight | Trivial |
| Structural FEA | CalculiX 2.21 + gmsh 4.15.2 | Plate flex, boss and standoff stress, arm stiffness (Ponder's neck) | `apt install calculix-ccx`, `pip install gmsh`. **Tested here** end to end | Medium. Meshing and solving are easy. The hard part is choosing supports and loads (see section 4) |
| FEA (alternatives) | FEniCSx 0.11 (June 2026), sfepy 2026.3, scikit-fem 12.0.2, Elmer, Code_Aster | Same, plus coupled physics | FEniCSx: conda-forge or the Ubuntu PPA ([download page](https://fenicsproject.org/download/)). PyPI has no `fenics-dolfinx` package. sfepy and scikit-fem: pip (installed for a test on 2026-10-15; that install did not persist). Elmer: the Launchpad PPA lists builds only up to 22.04, none for 24.04 ([PPA](https://qastaging.launchpad.net/~elmer-csc-ubuntu/+archive/ubuntu/elmer-csc-ppa)). There are also Windows installers and a source build ([Elmer binaries](https://csc.fi/web/elmer/binaries)). Not tested. Code_Aster: Docker `simvia/code_aster` (stable 16.8.0, tags up to 18.1.0) ([Docker Hub](https://hub.docker.com/r/simvia/code_aster)). This container has the Docker client (29.8.2) but no daemon | Medium to high. CalculiX is enough for linear statics |
| Thermal / CFD | Elmer (heat), OpenFOAM | Enclosure temperature around a Pi (Ponder), airflow | OpenFOAM: apt gives the old v1912 (1912.200626). v2606 (June 2026) has Ubuntu 24.04 packages ([OpenFOAM](https://www.openfoam.com/news/main-news/openfoam-v2606)). Not tested | High. A lumped thermal model is enough to start *(inferred)* |
| Drop / impact | OpenRadioss (explicit dynamics) | Cracked bosses or shells after a drop | A "Cell Phone Drop Test" model exists: it is one of the inputs in the OpenBenchmarking OpenRadioss profile ([OpenBenchmarking](https://mail.openbenchmarking.org/test/pts/openradioss&search)). The wiki page that describes it is in a locked space ([OpenRadioss](https://openradioss.atlassian.net/wiki/spaces/OPENRADIOSS/pages/11141156)) | High. Later, if at all |
| Circuits | ngspice 42, PySpice 1.5 (latest on PyPI), spicelib 1.6.4, InSpice 1.7.0.7 | Power paths, regulator and LED budgets, analog front ends (Ponder's mic and amp), with worst-case tolerance corners | `apt install ngspice`. The others via pip. **Tested here:** an RC low-pass (1 kΩ, 100 nF) measured f₋₃dB = 1.588 kHz, against 1.59 kHz from theory | Low |
| Circuits (alternative) | Xyce 7.10 | Same, for larger circuits | Prebuilt binaries: RHEL 8 (the only Linux build), Windows (serial only) and macOS arm64. All are the "XyceNF" build with proprietary models; "The team no longer provides open-source binaries". Ubuntu means building from source ([Xyce](https://xyce.sandia.gov/downloads/executables)). PyPI has only a 7.4.0 source tarball from January 2022 | High. Not needed |
| Electrical rules | SKiDL 2.3.0 (circuit as Python, with ERC, outputs a netlist for KiCad) ([PyPI](https://pypi.org/project/skidl/), [old docs](https://skidl.readthedocs.io/en/latest/readme.html)) | Unconnected pins, driver conflicts | pip | Medium. Our `design.json` intent checks already cover part of this |
| PCB DRC and ERC | `kicad-cli pcb drc` / `sch erc` (`--format json`, `--exit-code-violations`, `--schematic-parity`), plus `pcb export ipcd356` ([KiCad 10 CLI](https://docs.kicad.org/10.0/it/cli/cli.html), [KiCad 9 CLI](https://docs.kicad.org/9.0/en/cli/cli.html)) | A rule we got wrong, through a second DRC | DRC and ERC on the command line arrived in KiCad 8 ([release notes](https://www.kicad.org/blog/2024/02/Version-8.0.0-Released/)). `pcb export ipcd356` is not in the KiCad 8 CLI manual and first appears in KiCad 9. The current stable release is KiCad 10 (March 2026) ([release](https://www.kicad.org/blog/2026/03/Version-10.0.0-Released/)). apt here gives 7.0.11. *(Corrected 2026-10-15: its Python API already runs DRC (`pcbnew.WriteDRCReport`) and writes IPC-D-356, so the cross-check runs here without a newer KiCad; see `open-source-validators.md`.)* | Medium. Sprue's board is not a KiCad file, so we must write a `.kicad_pcb` first (already in the backlog) |
| Signal integrity / RF | openEMS + Antmicro's gerber2ems (inputs: Gerbers, a plated-through Excellon drill file, `stackup.json`, a port-position CSV and `simulation.json`; outputs: S-parameters and impedance) ([gerber2ems](https://github.com/antmicro/gerber2ems)) | Impedance of USB or RF traces | openEMS is built from source ([docs](https://docs.openems.de/install.html)). gerber2ems can run from a container built with the repo's Dockerfile, and it does not simulate capacitors | High. You must cut out a small region, because "Simulating an entire PCB is extremely resource-intensive". Not needed for full-speed USB on a keypad *(inferred)* |
| Power integrity / IR drop | No mature open-source PCB tool found. A 2020 KiCad forum thread lists FreeCAD FEM with fcad_pcb, FEMM, a Pad2Pad plugin and sparselizard ([forum](https://forum.kicad.info/t/open-source-power-analysis-tool/21652?page=2)) | Voltage drop, hot traces | — | Use an analytical check in code instead. IPC-2221 gives I = k·ΔT^0.44·A^0.725, with A in mil², k = 0.048 for external layers and 0.024 for internal ones ([KiCad calculator notes](https://hub.allspice.io/AllSpiceMirrors/kicad/src/branch/master/pcb_calculator/tracks_width_versus_current_formula.md), [NextPCB](https://www.nextpcb.com/blog/pcb-trace-width-calculation-high-current-design-and-thermal-analysis)) |
| Sheet-metal DFM | Rule checks from fab guidelines | Features too close to a bend, missing bend relief, short flanges | SendCutSend: keep cut features at least half the die width from the bend line. Relief depth = effective bend radius + 0.020". Each material has a minimum flat flange length ([SendCutSend](https://sendcutsend.com/guidelines/bend-deformation/)) | Low, as rules on parameters. Neither FreeCAD nor its SheetMetal workbench has an apt candidate here |
| Battery / power budget | Our own calculator (Sprue already has a `usb-power` check). PyBaMM 26.10 (26.10.1.0, released 14 Oct 2026) for cell-level models ([PyPI](https://pypi.org/project/pybamm)) | Runtime, peak current against the cell's limit or the USB limit | pip (installed for a test on 2026-10-15; that install did not persist) | Low. PyBaMM is overkill until a product has a battery *(inferred)* |
| Rigid-body dynamics | MuJoCo 3.16.0 ([PyPI](https://pypi.org/project/mujoco/)) | Ponder's moving neck: tip-over margin, servo torque at the worst pose | pip. Not tested | Low to medium *(inferred)* |

PrusaSlicer test on the keypad top shell:
- **As modelled (plate up):** it warns "Collapsing overhang, Loose extrusions, Long bridging extrusions … Consider enabling supports."
- **Flipped 180° (plate on the bed):** no warning. This is how `top.py` says the part is printed ("Printed upside down (plate on the bed)").
- It reports 11.12 cm³ of filament and 1 h 16 m 36 s of print time.
- So the slicer gate needs each part's print orientation from the design, and it gives a real input for the print cost.

CalculiX test:
- I meshed the keypad top shell: 49,600 nodes and 24,512 quadratic tetrahedra (C3D10).
- Load case: PLA (E = 3.5 GPa, ν = 0.36), wall bottoms fixed, 10 N in total on the centre key area.
- Result: 0.71 mm maximum deflection. Meshing took 2.2 s and solving about 7.8 s (CalculiX log).

These were one-off probes in a cloud session (the keypad top shell exported from `products/macropad/cad/top.py`); the scripts are not in the repo.

## 2. LLM agents with simulators as tools: how well they do

| Work | Setup | Result |
|---|---|---|
| FEABench ([arXiv](https://www.arxiv.org/pdf/2504.06260)) | LLM writes COMSOL API calls, 15 verified problems ("Gold"), plus 200 larger tutorial-derived tasks | The best agent's calls run 88% of the time, but only 2/15 problems end with a valid answer. Only one matched the target within 10%, and that was a false match (COMSOL's 20 °C default, against a target of 18.3 °C). A Python-only agent (numpy/scipy) got 11/15 valid answers, 4 of them within 10% |
| Foam-Agent ([v1](https://arxiv.org/html/2505.04997v1), [latest abstract](https://arxiv.org/abs/2505.04997)) | OpenFOAM, 110 cases over 11 physics scenarios | v1: 83.6% of runs execute successfully (Claude 3.5 Sonnet), against 55.5% for MetaOpenFOAM. Weak on multiphase and reacting physics and on new geometries. v3 (Aug 2026): 88.2% on the basic tier, 62.5% on an out-of-distribution advanced tier |
| PDE-Agents ([arXiv](https://arxiv.org/pdf/2606.07850)) | DOLFINx, heat equation only | 97.8% success over 1,369 runs, 85.4% on the first try. Its scope is scalar heat only |
| FeaGPT ([arXiv](https://arxiv.org/html/2510.21993v1)) | FreeCAD + Gmsh + CalculiX | All 432 configurations of one wing family converged. Safety factors ranged from 0.45 to 1.84, so some designs fell below 1. That shows the pipeline works, not that the designs are good |
| Multi-platform structural agent ([arXiv](https://arxiv.org/pdf/2604.09866)) | OpenSees, SAP2000, ETABS | At least 90% accuracy on each of 20 frame problems (averages 98–100%), but only for rectangular frames described with a fixed text template |
| AnalogCoder ([AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/32016/34171)) | PySpice + SPICE feedback loop | 20/24 circuits solved, against 15/24 for GPT-4o without tools |
| EngDesign ([arXiv](https://arxiv.org/html/2509.16204v2)) | 101 tasks graded by simulation, 9 domains | Best pass rate 34.4% (o3). Analog IC design: 0% for every model. With feedback, on a 71-task subset, o3 reaches almost 60% after 10 iterations |
| EEBench, by atopile ([methodology](https://eebench.org/methodology.html), [release](https://ai-tldr.dev/releases/atopile-eebench/)) | Circuits written as atopile code and checked by SPICE simulation at worst-case tolerance corners. Score = 0.65 × technical + 0.35 × cost. Held-out tasks (13 at the V1 launch) | Top score on BenchLM's 12 Oct 2026 snapshot: 75.0% for Claude Opus 5.5 in Claude Code ([BenchLM](https://benchlm.ai/md/benchmarks/eebench.md)). The page lists Opus 5.5 twice (75.0% and 68.9%) and Opus 4.8 twice, so the data may contain an error. No layout in V1. atopile built and funded the benchmark and it grades designs written in atopile's own language; Hackaday notes that it "is run by the developers behind Atopile" ([Hackaday](https://hackaday.com/2026/09/05/can-ai-now-design-pcbs-that-just-work/)) |
| EDA Bench ([ICML 2026](https://icml.cc/virtual/2026/77908)) | 35 KiCad reconstruction tasks. The grader extracts the routed copper and runs ngspice plus ERC/DRC | The best (web-enabled) harness scored 4.58%. It produced a buildable project in 21 of 35 tasks, but failed most of the functional checks |
| PCBInnoBench ([NeurIPS 2026](https://neurips.cc/virtual/2026/poster/139034)) | 372 expert-designed KiCad tasks in which agents modify existing projects | 22.0% Pass@1 for the best agent when given the workflow, 7.3% without it |
| Text2CAD-Bench ([arXiv](https://arxiv.org/pdf/2605.18430)) | CadQuery code, 600 examples in 4 tiers | On the hardest tier with ground-truth geometry (L3: sweep, loft, shell, freeform), 68–93% of outputs from most general LLMs fail to run. Gemini 3 Flash is the exception (13–45%). Domain-specific models (e.g. Text2CAD) run but produce the wrong geometry (IoU about 0.02–0.04) |
| FE / PE exams ([arXiv](https://arxiv.org/pdf/2303.18149)) | Multiple choice, 2023, civil/environmental FE questions and PE Structural | ChatGPT-4: 70.9% on the FE exam, 46.2% on the PE Structural exam |

Takeaways *(inferred from the table)*:
1. Code that runs is not the same as a correct design (FEABench, EDA Bench, Text2CAD-Bench).
2. Feedback from execution and simulation is the biggest lever.
3. Narrow, templated domains reach 90% or more. Sprue's ladder of known products is that kind of domain.
4. Exams test knowledge, not design. They work as a sanity check, not as a measure of Sprue.

## 3. Trained physics models: when they are worth it

**What exists**
- **NVIDIA PhysicsNeMo** offers neural operators (FNO), Transolver, FLARE and GeoTransolver, graph networks (MeshGraphNet examples), and a DoMINO external-aerodynamics example ([docs](https://docs.nvidia.com/physicsnemo/latest/physicsnemo/index.html)). It expects an NVIDIA GPU and Python 3.10 or later ([requirements](https://docs.nvidia.com/physicsnemo/latest/getting-started/system_requirements.html)).
- **Physics foundation models:**
  - Poseidon reports better sample efficiency and accuracy than baselines on 15 downstream tasks ([NeurIPS](https://proceedings.neurips.cc/paper_files/paper/2024/hash/84e1b1ec17bb11c57234e96433022a9a-Abstract.html)).
  - Walrus has 1.3 billion parameters and was pretrained on 96 H100s over 19 datasets: astrophysics, geoscience, rheology, plasma, acoustics and classical fluids. Its authors name "non-uniform geometries" as the next direction ([arXiv](https://arxiv.org/pdf/2511.15684)).
  - PhysicsX LGM-Aero has 100 million parameters. It was trained on more than 25 million meshes using 128 H100s for 4 weeks, then 64 A100s for 4 more weeks ([PhysicsX](https://physicsx.ai/newsroom/building-beyond-human-imagination-with-foundation-models-for-geometry-and-physics)).

**What training one takes**
- AB-UPT used 400 training simulations of a single car family (DrivAerML). The whole DrivAerML dataset cost about $1M to generate, at roughly $2,000 per high-resolution CFD run ([arXiv](https://arxiv.org/pdf/2502.09692v4)).
- Training then took under a day on one H100, and the relative surface-pressure error was 3.8%. The authors leave more diverse geometries to future work.
- Neural Concept says the number of simulations needed "greatly varies" from one use case to another, and that the size of the design space is the main factor ([Neural Concept](https://www.neuralconcept.com/post/how-many-simulations-do-you-need-to-train-your-predictive-model)).

**Cautions**
- Of 76 ML-for-PDE papers that claimed to beat standard solvers, 60 (79%) compared against weak baselines ([McGreivy & Hakim](https://arxiv.org/html/2407.07218v1)).
- A review says data-driven (POD-interpolation) surrogates "tend to fail when extrapolation is considered" ([review](https://arxiv.org/html/2603.12870)).

**When a surrogate is worth it** *(inferred)*: thousands of evaluations of one stable design family, with a solver that takes minutes to hours per run (aero, crash). Sprue has the opposite profile:
- A CalculiX run takes about 10 s.
- Every product is a different design.
- We have no training data.
- We would still need the solver to check the model.

A small surrogate for one family (say, 500 CalculiX runs of about 10 s each, roughly 1.5 CPU-hours, trained on one GPU) would be cheap. It would only pay off if Sprue ran optimisation loops *(inferred)*.

## 4. What simulation cannot tell you

- **Material data.**
  - Extrusion-printed parts are 25–50% weaker in the build direction, and the gap grows to 75–90% for fibre-filled materials ([ORNL, 2018](https://www.ornl.gov/publication/z-pinning-approach-reducing-mechanical-anisotropy-3d-printed-parts)).
  - A 2025 thesis measured X-direction prints as 24.6% (PLA), 42% (ABS) and 127.9% (PETG) stronger than Z-direction prints. FEA matched the tests to within 5% once the material had been measured ([CSUS](https://scholars.csus.edu/esploro/outputs/graduate/Mechanical-and-FEA-comparison-of-FDM/99258311232901671)).
  - So the simulation can be good, but only with measured inputs.
- **Supports and loads.** My 0.71 mm plate result assumes fixed wall bottoms and ignores the stiffening from the switches and PCB. Setting up this physics is where FEABench's agents struggled: the physics block, which holds the boundary conditions and loads, had the lowest share of calls that ran when each block was asked for in a single query.
- **Tolerances and variation:** ±0.3 mm per printed part, before stack-up.
- **Assembly:** heat-set inserts, screw torque, cable routing, the order the parts go together.
- **Validation:** checking a model against reality "must be confirmed with experimental studies" ([SimScale](https://www.simscale.com/blog/2017/07/verification-and-validation-cae/)). That is why the industry builds EVT units "to test the functionality of your product against its requirements" ([Embedded Artistry](https://embeddedartistry.com/fieldmanual-terms/engineering-validation-and-test/)).
- **Not realistically simulated for us** *(inferred)*: how keys feel and sound, ergonomics, user testing, EMC and CE compliance (which need a lab), long-term reliability, and part substitutions.

## 5. Splitting the tests, as Tobias asked

- **Whole product:**
  - Keep the reference-ladder scorer and add held-out products.
  - Use EngDesign-Open's mechanical and structural tasks as an outside check. The open set has 67 tasks that need no MATLAB or Cadence, but only 13 of them are mechanical (6) or structural (7), so the sample is small.
- **PCB:**
  - Grade like EDA Bench: extract the copper, run ngspice, run DRC. Sprue's read-back plus the firmware run already does most of this.
  - Ask atopile for a held-out EEBench run for circuit design.
  - For layout, PCBWorld (KiCad-engine routing with DRC feedback, 679 real boards) is the closest open harness ([arXiv](https://arxiv.org/abs/2607.05915)).
  - PCBInnoBench fits less well, because it measures edits to existing KiCad projects.
- **Mechanical and CAD:**
  - Text2CAD-Bench-style scoring for geometry (CadQuery is close to build123d).
  - Our own fit, slicer and FEA gates on the reference products.
- **Exams:** knowledge sanity checks only. That means the FE exam, EEE-Bench (2,860 multimodal electrical-engineering problems; 17 models averaged 19.5–46.8%) ([CVPR 2025](https://cvpr.thecvf.com/virtual/2025/poster/35039)), and the question tracks of PCB-Bench (about 3,700 text and 500 multimodal placement and routing problems) ([ICLR 2026](https://iclr.cc/virtual/2026/poster/10009621)).
- **FEABench** needs a COMSOL licence, so it cannot run here.

## Recommendation for Sprue

**Verifiers to add, in order:**
1. **Assembly and interference check.** Place the case, PCB, Pico, switches and screws in one frame in build123d. Fail on any overlap volume above zero, or any clearance below the tolerance budget. This is cheap, it closes the backlog item "mechanical cross-check", and the test above already shows it working.
2. **Slicer gate.** Run PrusaSlicer headless in each part's print orientation. Fail on stability warnings. Record filament and print time, which also feed the print quote.
3. **Tolerance stack-up** for each fit: worst-case, using the fab's published tolerances (±0.3 mm at JLC3DP). It sets the clearance limits used in step 1.
4. **KiCad DRC and ERC cross-check**, already planned. On the command line, DRC and ERC need KiCad 8 or later, and `export ipcd356` needs KiCad 9 or later. *(Corrected 2026-10-15: the installed KiCad 7.0.11's Python API already runs DRC and writes IPC-D-356, so the DRC cross-check needs no newer KiCad; ERC still needs a `.kicad_sch`. See `open-source-validators.md`.)*
5. **Electrical simulation.** ngspice at worst-case tolerance corners for power paths and any analog parts (Ponder), plus an IPC-2221 trace-current rule in code.
6. **CalculiX FEA for load-bearing parts only**: Ponder's neck arm, bosses, plate stiffness. Derate FDM strength in Z by 50% and report the result as an estimate.
7. **Later, only when a product needs it:** thermal (lumped model, then Elmer), openEMS/gerber2ems for RF, OpenRadioss for drops, MuJoCo for moving parts.

**Training a model:** not now. Later, maybe two narrow cases:
- A calibration model fitted to measurements from Sprue's own prototypes (print shrink, hole sizes, plate flex).
- A surrogate for one product family, if optimisation loops ever need thousands of runs.

A general physics model is not worth it. The two foundation models checked here took 96 H100s (Walrus) and 128 H100s plus 64 A100s (LGM-Aero) to train, and they don't yet cover small solid-mechanics or enclosure problems.

**Fundamental limits:**
1. The LLM's design judgment. Verifiers in the loop catch its errors; they don't remove them.
2. Verifier coverage: anything unchecked passes.
3. Uncertain models and inputs: material data, supports and loads, tolerances.
4. Problems that only a build reveals.

The keypad order already in the backlog is the real test. It waits on Tobias's OK because it spends money. Its measurements should feed back into the checks.

---

## Fact-check notes

**Corrections made**
1. **EngDesign, short answer:** the 34% → "almost 60%" comparison mixes two sets. The 34.38% is on all 101 tasks. The ~60% after ten feedback iterations is on a 71-task subset whose one-shot rates the paper calls "slightly lower". The wording now says this.
2. **EngDesign-Open:** confirmed 67 open and 34 closed tasks. Added that only 13 open tasks are mechanical (6) or structural (7).
3. **Foam-Agent:** the 83.6%, 55.5% and 37.3% figures are from v1. v3 (13 Aug 2026) reports 88.2% on 110 basic tasks and 62.5% on an advanced tier. Both are now stated. Also added "reacting" to the weaknesses, as the paper names chemical reactions too.
4. **PrusaSlicer flags:** `--supports-enable` is an SLA option. FDM supports use `--support-material` / `--support-material-auto` (checked in 2.7.2's `--help-fff`). Also, the linked man page documents 2.9.2 (Debian trixie), not the 2.7.2 that apt installs here.
5. **CuraEngine:** changed from unconfirmed to confirmed absent on 24.04. Launchpad lists Jammy and Oracular but not Noble, and apt has no candidate here.
6. **Elmer:** "Ubuntu PPA only" was wrong. Windows installers and a source build also exist. More importantly, the PPA (via the Launchpad staging mirror) lists builds only up to 22.04, none for 24.04.
7. **Xyce:** "Binaries exist only for RHEL 8" was wrong. There are also Windows (serial) and macOS arm64 binaries. RHEL 8 is the only Linux build, all binaries are XyceNF, and the team "no longer provides open-source binaries". The PyPI 7.4.0 sdist dates from January 2022.
8. **KiCad:** `pcb export ipcd356` is missing from the KiCad 8 CLI manual and present in KiCad 9's, so "KiCad 8 or later" holds for DRC/ERC only. Added that KiCad 10.0.0 was released in March 2026. The original KiCad 10 docs link is the Italian locale; an English KiCad 9 link was added.
9. **gerber2ems:** "ships a Docker image" became "can run from a container built with the repo's Dockerfile". Added the required inputs (stackup.json, position CSV, simulation.json) and that capacitors are not simulated.
10. **IPC-2221:** the NextPCB page gives k = 0.048/0.024 and A in mil², but not the 0.44/0.725 exponents. Those are confirmed by KiCad's own calculator notes, which are now cited.
11. **OpenRadioss:** changed from unconfirmed to confirmed. "Cell Phone Drop Test" is one of the models in the OpenBenchmarking OpenRadioss profile. The wiki page is still locked.
12. **EEBench / Hackaday:** Hackaday does not say atopile "sells the tool" and does not explicitly flag bias. It only notes the benchmark "is run by the developers behind Atopile". Reworded. Added the 13 tasks at the V1 launch (ai-tldr) and that BenchLM also lists Opus 4.8 twice. "In Claude Code" is confirmed as BenchLM's configuration column.
13. **FeaGPT:** "Many designs fell below a safety factor of 1" is not stated. The paper gives a range of 0.45–1.84 and no count. Reworded to "some".
14. **Text2CAD-Bench:** "70–90% fail to run" is now "68–93% for most general LLMs, with Gemini 3 Flash at 13–45%". L3 also includes freeform surfaces. Added the IoU figures for domain-specific models.
15. **FE/PE paper:** the model is reported as "ChatGPT-4" (compared with Bard), and the FE questions are civil/environmental.
16. **Multi-platform structural agent:** "over 90%" is now "at least 90% on each problem, averages 98–100%". The template is a predefined text format.
17. **Walrus:** the domain list was incomplete. Added geoscience, rheology and acoustics.
18. **AB-UPT:** clarified that the $1M is the whole DrivAerML dataset, not the 400 training runs.
19. **ORNL:** the source says "extrusion-based" printing, and the year (2018) was added. The CSUS thesis year (2025) was also added.
20. **Review 2603.12870:** the quote refers specifically to POD-interpolation (data-driven) surrogates. Reworded.
21. **FEABench "physics block":** the lowest-executability result is for single-query generation (Gemini 1.5 Pro). Reworded section 4 to match.
22. **PCBInnoBench:** confirmed that the tasks modify existing ECAD projects. The wording "372 expert-designed KiCad tasks" now matches the abstract.
23. **stackups:** added that the last release (1.2.5) was January 2018.
24. **SKiDL:** the linked readthedocs page documents version 0.0.7. The current version is 2.3.0 on PyPI, and that link was added.
25. **CalculiX solve time:** the log shows 7.81 s, not 7.9 s. Added the element count (24,512) and ν = 0.36.
26. **PrusaSlicer slice time:** re-timed at 1.49 s; the report's 1.7 s is kept as a range. Exact print time is 1 h 16 m 36 s.
27. **"Foundation models take 96 to 128 H100s":** these are the only two models whose compute was checked. Reworded to say so.

**Re-verified locally (tested here):** Ubuntu 24.04.5, Python 3.13, Node 22, and these versions: prusa-slicer 2.7.2, calculix-ccx 2.21, ngspice 42, kicad 7.0.11, admesh 0.98.5, openfoam 1912 in apt, trimesh 5.1.1, gmsh 4.15.2, sfepy 2026.3, scikit-fem 12.0.2, pybamm 26.10.1.0, spicelib 1.6.4, InSpice 1.7.0.7, PySpice 1.5 (latest on PyPI), build123d 0.13.0, mujoco 3.16.0 (PyPI). The pip installs among these (gmsh 4.15.2, sfepy, scikit-fem, pybamm, spicelib, InSpice, PySpice, mujoco) did not persist: later the same day none of them imported, and the container's gmsh is apt's 4.12.1. Also re-checked:
- The 4,922 mm³ naive overlap (4,921.6).
- The top shell is watertight.
- ngspice f₋₃dB = 1,587.8 Hz.
- 49,600 nodes and C3D10 elements.
- 0.71 mm maximum deflection under a 10 N total load with E = 3,500 MPa.
- 11.12 cm³ of filament.
- The supports warning in the plate-up slice log.
- 15 checks in `checks.json`, and the comment in `top.py` that the part is printed upside down.
- Docker client present, no daemon.

**Could not confirm**
- The 2.2 s meshing time. It was not re-run.
- Foam-Agent v3's LLM, ablation numbers and baselines: the v3 full text was rate-limited, so only the abstract was read.
- The EEBench primary leaderboard at eebench.org: it renders client-side and could not be fetched, so the 75.0% rests on BenchLM's snapshot only. EEBench's methodology page does not name SPICE; ai-tldr does.
- The Elmer PPA series list: the production Launchpad page is blocked to fetch (robots), so it comes from the qastaging mirror.
- The Code_Aster image: the overview text (stable 16.8.0, testing 17.3.1) and the tag list (18.1.0) don't line up.
- The date of review 2603.12870. The arXiv ID implies March 2026.
- The EDA Bench harness name: the page says only "web-enabled harness".
- Which model reached 22.0% on PCBInnoBench: the page does not name it.

**Added (missing from the original, five items)**
1. PCBWorld, a KiCad-engine routing environment with DRC feedback and 679 real boards (July 2026): https://arxiv.org/abs/2607.05915
2. PCB-Bench, about 3,700 text and 500 multimodal placement and routing problems plus 170+ real projects (ICLR 2026): https://iclr.cc/virtual/2026/poster/10009621
3. EEE-Bench, 2,860 multimodal electrical-engineering problems; 17 models averaged 19.48–46.78% (CVPR 2025). It is a better "hardware exam" than the FE exam: https://cvpr.thecvf.com/virtual/2025/poster/35039
4. KiCad 10.0.0, the current stable release (March 2026), and the fact that `ipcd356` CLI export needs KiCad 9 or later: https://www.kicad.org/blog/2026/03/Version-10.0.0-Released/
5. MuJoCo 3.16.0 (pip), rigid-body dynamics for Ponder's moving neck (tip-over, servo torque): https://pypi.org/project/mujoco/