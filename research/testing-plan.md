# Testing Sprue: the plan (2026-10-15)

Tobias asked (2026-10-15) to test the setup, at least the design stage before sourcing, against a benchmark or a
hardware engineering exam, split into the whole product, the PCB and the rest, and whether a trained physics model is
needed. This file is the plan the daily runs follow. The research behind it, fact-checked the same day:
`research/benchmarks.md`, `research/physics-verification.md` and `research/custom-part-suppliers.md`.

## The short answers

- **No public benchmark tests what Sprue does** (one line in; CAD, a PCB, a BOM and checks out). So the headline is
  our own set, and public benchmarks give outside numbers for the parts they cover: CAD (CADGenBench, MUSE) and
  schematics (PCBSchemaGen).
- **Exams measure the model, not Sprue.** Frontier models score about 70% or more on FE practice exams, and a
  September 2026 audit found textbook physics benchmarks close to saturated once their broken questions were fixed.
  They tell us nothing about whether a Sprue design can be built.
- **No trained physics model now.** In most of the studies we read, the biggest gains come from putting a checker or
  simulator in the loop (our reading; some results, such as HWE-Bench, point the other way). EngDesign: o3 passes 34%
  of all 101 tasks one shot, and almost 60% of a 71-task subset after ten rounds of simulation feedback;
  Foam-Agent: removing its error-correction loop dropped OpenFOAM success from 83.6% to 37.3%. The free solvers run
  in seconds here: CalculiX bent the keypad top 0.71 mm under 10 N in about 10 s, PrusaSlicer flagged the top shell
  for supports when it lay plate up, and ngspice matched a test RC filter to theory. A trained model only pays off for thousands of runs on one design family; Sprue is
  the opposite.
- **The real limits** are the model's design judgment (checks catch mistakes, they don't make good designs), what the
  checks cover (anything unchecked passes), uncertain inputs (an FDM part is 25-50% weaker across its layers, and a
  printed part can be off by ±0.3 mm) and what only a build shows (feel, assembly, EMC). So the keypad build Tobias
  has to OK is the real calibration, and its measurements go back into the checks.

## What the current checks can't see (from the repo, 2026-10-15)

- A check whose params are missing is skipped silently, and the score doesn't count how many checks ran
  (`pipeline/stages/check.ts:223`).
- Lines Sprue can't quote (CNC, sheet metal) cost $0 in the score, so they can push a product into its cost band
  (`stages/score.ts`, `adapters/fab.ts:103-107`).
- "The parts fit" is not checked on the solids: the only file check on a print is that its STL is watertight. The
  board is checked against the case's params, not the case's CAD.
- Coverage matches BOM roles by name only, so a wrong part under the right role still counts.
- The PCB kit has only two footprints, the Pico and the Kailh socket (`pipeline/pcb/footprints.ts`), so no other part
  can go on a board yet. A board with neither keys nor a Pico stops at UNVERIFIED, because its read-back self-test has
  no fault to put in (`pipeline/verify.ts:398-402`).
- Every quote assumes delivery to the US (`request.json` region), though Tobias is in Italy.

## The split: four tracks

| Track | What it answers | Our own set | Outside number |
|---|---|---|---|
| **1. Whole product** | From one line, does the design stage produce a product that would work and fits the brief? | 10 one-line ideas to start (20-30 later), each with an answer key the run doesn't see: roles that must appear, checks that must pass, a cost band, and 3-5 "trap" requirements (for example "fits a 60 mm drawer") | EngDesign-Open's 6 mechanical and 7 structural tasks, graded by simulation. Small, so a sanity check only |
| **2. PCB and electronics** | Is the circuit right, and would the board work? | Every board in the set must reach VERIFIED, plus the seeded faults below | PCBSchemaGen's PCBBench (62) and Open-Schematics-Eval (165): plain-language spec to schematic with real ICs, graded by a deterministic checker (MIT). Its tasks need ICs our PCB kit can't place yet, so the adapter is tried on the keypad first. Later: HWE-Bench if its data is shared, PCBWorld for routing (non-commercial licence) |
| **3. Mechanical and CAD** | Is the CAD what was meant, can it be printed, does it fit together? | New gates: parts in one assembly with no overlap and clearances above the tolerance budget, a slicer pass in each part's print orientation, a worst-case tolerance stack, FEA for load-bearing parts only | CADGenBench (49 drawings to STEP, build123d native, public leaderboard with Claude Code + build123d entries) and MUSE (106 written specs to multi-part assemblies, dataset CC BY 4.0, code licence not stated; CadQuery, so it needs an adapter) |
| **4. The checks themselves** | When a design is wrong, do our checks notice? | Seeded faults: take passing designs and break them on purpose (a hole 1 mm off, the Pico 0.5 mm higher, two GPIOs swapped, a wall under the minimum, a missing role, an unpriced CNC line). Score = share caught, plus false alarms on the clean designs (must be 0) | None. The PCB side already does this in small (3 read-back faults, 3 firmware faults) |

Rules for the set:
- Grade with code wherever we can. LLM judges disagree with people on structural correctness (MultModLM found near-zero
  agreement); keep human review for a small sample, by Tobias.
- Hold the answer keys out of the run: the run sees only the one line.
- Keep each benchmark's raw outputs and our score in `evals/<benchmark>/<date>/`, so a later run can be compared.

## Order of work (one small PR per item)

1. Make the score honest: count checks run and skipped, fail on unpriced lines, and require the read-back and firmware
   self-tests for a board.
2. Seeded faults v0 for the keypad: 10 faults across mechanical, PCB and BOM, with the catch rate in `score.json`.
3. Mechanical gates on the keypad, as two PRs: an assembly gate (every part in one frame, an overlap and clearance
   check in build123d), then PrusaSlicer headless in each part's print orientation.
4. CADGenBench: run Sprue's CAD approach on its 49 generation tasks and keep the outputs in
   `evals/cadgenbench/<date>/`. Only its Hugging Face Space can score them (the ground truth is private) and a
   submission shows on its public leaderboard, so submitting waits for Tobias's OK.
5. Idea set v0: 10 one-liners with answer keys in `evals/ideas/keys/`; run the design stage on 3 of them in a
   subagent that works in a copy of the repo without `evals/` and is given only the one line, then grade its output.
6. PCBSchemaGen: an adapter from Sprue's netlist to its checker, tried on the keypad's netlist. Its 62 PCBBench tasks
   wait for a PCB kit that can place more than the Pico and the Kailh socket.
7. Later: a worst-case tolerance stack for each fit, PCBSchemaGen's 62 PCBBench tasks, the KiCad cross-check
   (already in the backlog), ngspice for power paths, CalculiX for Ponder's arm, the 13 EngDesign-Open tasks, a MUSE
   adapter.

Running these costs only session time. Building and measuring real units costs money and waits for Tobias's OK.
