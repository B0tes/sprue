# Benchmarks for testing Sprue's design stage (October 2026)

*Fact-checked against primary sources on 2026-10-15. Text marked [corrected], [added] or [unconfirmed] changed during the check. The "Fact-check notes" at the end list every change.*

## Bottom line

- **No public benchmark tests what Sprue actually does**: start from a one-line idea and produce enclosure CAD, a PCB as code, a BOM and rule checks. The pieces exist separately, and most are from 2026:
  - Text spec to manufacturable, assemblable CAD: MUSE.
  - Drawing to CAD, on a live leaderboard that already has Claude Code + build123d entries: CADGenBench.
  - Plain-language spec to schematic with real ICs, graded by a deterministic checker: the PCBSchemaGen benchmarks.
  - [added] Agentic PCB work on real KiCad projects: PCBInnoBench (NeurIPS 2026, 372 tasks). PCB routing under KiCad DRC: PCBWorld (open source).
- **Exams (FE/PE) mostly measure the base model's textbook knowledge.** [corrected] Across 2023–2025 studies on FE practice sets, GPT-4-class models scored 49–76%, and most studies land at 66–76%. In 2025, o3, GPT-4o, DeepSeek-R1 and Gemini 2.5 Pro all scored above 70% on the official NCEES FE Civil practice exam. These exams say almost nothing about whether Sprue's outputs can be built.
- **Across benchmarks, scores depend heavily on the tools and checkers in the loop.** The same model scores very differently with and without them (evidence in section 8). The gap seems to be grounding, perception and checking, not "the model lacks physics knowledge". That last point is my interpretation, not something any paper proves. [added] Two counterpoints:
  - The HWE-Bench authors read their own results as models that "lack physical intuition".
  - CADEngBench (Aug 2026) found that designs whose stress analysis (FEA) must match a reference are still hard for every model.
  
  On closed-ended textbook physics, a Sep 2026 audit found frontier models near saturation once broken questions and graders were fixed.

---

## 1. Whole-product and engineering-design benchmarks

| Benchmark | Task, size | Scoring | Data | Best reported | Fit for Sprue |
|---|---|---|---|---|---|
| **EngDesign** ("Toward Engineering AGI", NeurIPS 2025 Datasets & Benchmarks track; mostly UIUC, with Amazon AGI, UCSD, UPenn, UMich) ([paper](https://arxiv.org/html/2509.16204v2), [NeurIPS](https://proceedings.neurips.cc/paper_files/paper/2025/hash/664f777548205fb6e0cbb0965e8d2e16-Abstract-Datasets_and_Benchmarks_Track.html)) | 101 design tasks in 9 domains: OS, computer architecture, control, mechanical, structural, digital HW, analog IC, robotics, signal processing. 473 rubric items. Each task has a spec, a rubric, an evaluation script and a reference design. | Simulation-based (MATLAB, SPICE, FEA): pass/fail plus a 0–100 score, 3 runs per task | [HF dataset (MIT)](https://huggingface.co/datasets/opt1zer/EngDesign); code at GitHub AGI4Engineering/EngDesign ([project page](https://agi4engineering.github.io/Eng-Design/)). "EngDesign-Open" needs no licensed tools. The paper says it has 67 tasks, the project page says 53; they disagree. | o3 34.38% pass rate, o4-mini-high 34.04%; "no model surpasses 35%"; Analog IC 0% for every model. [corrected] With feedback, o3 reaches "almost 60%" after 10 iterations, but on a 71-task subset, not the full 101. Project leaderboard last updated 2025-06-18. | **Partial.** The only public design benchmark graded by simulation. No consumer product, enclosure or PCB tasks. |
| **DesignQA** (2024; MIT, MIT Motorsports, Autodesk Research) ([paper](https://arxiv.org/html/2404.07917v2)) | 1,451 QA pairs on the Formula SAE rules plus MIT Motorsports CAD and drawings. Rule retrieval, comprehension and compliance (dimensions, functional performance). | F1 or accuracy per subset | [GitHub](https://github.com/anniedoris/design_qa/) | GPT-4o with the full rules in context: Retrieval 0.885 F1, Compilation 0.424, Definition 0.540, Presence 0.726, Dimension 0.825, Functional 0.938 | **Partial.** The compliance subsets resemble Sprue's "engineer checks" (is this drawing compliant with rule X?). It is QA, not design, and only older models were tested (GPT-4/4o, Gemini 1.0, Claude Opus 3, LLaVA-1.5). |
| **EngiBench** (Sep 2025; NTU, USyd, CUHK-SZ, PolyU, INSAIT) ([paper](https://arxiv.org/html/2509.17677v1)) | About 1,717 problems at 3 levels (L3: 43 open-ended modelling problems) | Exact match for L1–L2; expert rubric for L3 | [corrected link] [GitHub EngiBench/EngiBench](https://github.com/EngiBench/EngiBench) | GPT-4.1 and Gemini 2.5 Flash >80% on L2. On L3 the top models approach 7.0, against 8.58 for human experts. | **Poor.** Problem solving, not design artifacts. |
| **VLMs for engineering design** (MIT DeCoDE, 2023; revised Dec 2024) ([paper](https://arxiv.org/html/2311.12668v3)) | [corrected] More than 1,000 quantitative queries across conceptual design, detailed design (drawings/CAD), manufacturing and inspection, plus education tasks, with separate qualitative case studies | [corrected] Mostly quantitative, with qualitative case studies. GPT-4V (Sep 2023) and LLaVA 1.6 34B. | [released](https://decode.mit.edu/projects/vlms4design/) (images, prompts, answers for 8 experiments) | Per-experiment accuracies (not re-checked) | **Poor/partial.** Old models. |
| **BuildArena** (Westlake U.; ICML 2026) ([paper](https://arxiv.org/html/2510.16559v4), [ICML](https://icml.cc/virtual/2026/poster/64183)) | Build bridges, vehicles and rockets in the Besiege game. 3 tasks × 3 levels = 9 combinations; 8 LLMs, 64 samples per cell. | Success rate, part count, task metric | [corrected] [GitHub AI4Science-WestlakeU/BuildArena](https://github.com/AI4Science-WestlakeU/BuildArena) | Grok-4 strongest overall; Support Lv.1 46.9% success | **Poor.** Game physics, not real hardware. |

## 2. Mechanical design and CAD generation

| Benchmark | Task, size | Scoring | Data | Best reported | Fit |
|---|---|---|---|---|---|
| **CADGenBench** (Hugging Face, 2026) ([repo](https://github.com/huggingface/cadgenbench)) | Generation: engineering drawing in, STEP out. Editing: apply a change to an existing STEP. Any CAD tool is allowed; the reference baseline supports build123d (default) and CadQuery. [corrected] 81 fixtures in all: 49 generation ([BenchLM](https://benchlm.ai/md/benchmarks/cadgenbenchgeneration.md)) plus, by inference, 32 editing (a submission named "gen49-edit32" on [benchmarklist](https://benchmarklist.com/benchmarks/cadgenbench/)). | Validity-gated "CAD score": surface-distance F1, volume IoU, interface (mating-feature) match, topology (Betti numbers) | Inputs public (HuggingAI4Engineering/cadgenbench-data); ground truth private (read only by the Space); code Apache-2.0; [leaderboard Space](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench). The repo's About section links to a different URL (`.../cadgenbench-leaderboard`). | Generation score, BenchLM snapshot of Oct 15 2026: #1 build123d-mcp 0.3.85 + Claude Opus 5.5 (max effort) 86.9%; #2 Godela (model not stated) 84.5%; #3 build123d-mcp 0.3.81 + Claude Opus 5 (xhigh) 59.6%; plain Claude Opus 4.8 27.4% ([BenchLM](https://benchlm.ai/benchmarks/cadgenbenchgeneration)). [corrected] New submissions publish as "unvalidated" until maintainers review them. BenchLM says it mirrors only rows the official dataset marks validated, but it did not re-run them or check row by row. | **Good for CAD precision.** Works natively with build123d, and Claude Code + build123d systems are already on the board to compare against. The input is a drawing, not an idea. |
| **MUSE** ([corrected] first posted May 2026, v2 4 Jun 2026; HK PolyU + Curvature Flow) ([paper](https://arxiv.org/html/2605.28579)) | 106 design instances, each with a written design specification. The model writes a CadQuery script that exports a STEP multi-component *assembly*. | 3 stages: the code runs; the geometry is valid (watertight, manifold, no self-intersection or overlap); then a VLM judge (Gemini 3.1 Pro) scores functionality, manufacturability and assemblability on rubrics | [HF dongxiaoyu/MUSE](https://huggingface.co/datasets/dongxiaoyu/MUSE) (dataset CC BY 4.0), [code](https://github.com/dong7313/muse) (licence not stated), [project](https://dong7313.github.io/muse-benchmark/) | GPT-5.5 52.36% final; Gemini 3.1 Pro 43.40%; Claude Opus 4.7 39.47% | **Good.** The closest thing to "spec in, buildable multi-part enclosure out". It is CadQuery-based, so Sprue needs an adapter that emits STEP via build123d (effort not checked). |
| **[added] CADEngBench** (Aug 2026; Singh, Dubey, Amador Herrera) ([abs](https://arxiv.org/abs/2608.09296)) | Track P: 300 parametric parts, each with a generation task and a functional-edit task (600 tasks). Track A: 150 body pairs for joint/mating prediction. | Geometric validity, engineering and manufacturability rules, behaviour under parameter changes, edits, **static FEA matched to a reference**; for Track A, joint retrieval, face/edge picking, joint frame and kinematic check | [unconfirmed] No release link found | 8 models. Editing is much easier than generation; complex edits and matched FEA stay hard; assembly predictions find the right region but miss the exact mating entities (numbers not checked) | **Good on paper.** The only CAD benchmark found that checks structural (FEA) behaviour and joints, which matters for the "is there a physics limit" question. Watch for data. |
| **Text2CAD-Bench** (May 2026; Wuhan U. et al.) ([paper](https://arxiv.org/pdf/2605.18430)) | 600 examples / 1,200 prompts (L1 200, L2 200, L3 100, L4 100), text in, CadQuery out. L1 primitives, L2 booleans/fillets, L3 sweep/loft/shell, L4 single-solid real products (industrial, consumer, medical, architectural, educational). | Chamfer distance, IoU, invalidity rate. L4 is judged by a VLM (GLM-4.6V). | **Not released yet** ("after accept") | L1 GPT-5.2 IoU 0.59. L3: Claude-4.5-Sonnet has the best CD but 70% invalid. L4: DeepSeek-V3.2 has the best Overall (8.26/10) [added] but 55% of its outputs are invalid. | **Good on paper (L4), but unavailable.** |
| **CADBench** (May 2026; MIT DeCoDE) ([paper](https://arxiv.org/pdf/2605.10873)) | 18,000 samples: mesh or image in, CAD program out (reverse engineering) | IoU, Chamfer distance, surface IoU, valid-shape rate, compactness | [GitHub (MIT)](https://github.com/anniedoris/CADBench), HF DeCoDELab/CADBench | Image input: Claude Opus 4.7 best IoU 0.412 | **Poor/partial.** Sprue does not work from images or scans. |
| **BenchCAD** (May 2026; U. Virginia) ([paper](https://arxiv.org/html/2605.10865v1)) | 17,900 CadQuery programs across 106 industrial part families. Tasks: image to code, code edit (748 pairs), QA. | IoU/CD/Feature-F1; normalised edit accuracy | HF BenchCAD (CC-BY-4.0); eval code MIT | Code Edit: GPT-5.3 (thinking) 0.865, Claude Opus 4.7 (thinking) 0.853. Vision2Code: Gemini 3.1 Pro 0.318 (from the paper text). | **Partial.** The code-edit task resembles Sprue's edit/swap flows. |
| **CADPrompt** (ICLR 2025; Georgia Tech) ([paper](https://arxiv.org/pdf/2410.05340)) | 200 text prompts, CadQuery out | Point-cloud distance, Hausdorff distance, IoGT, compile rate | [GitHub](https://github.com/Kamel773/CAD_Code_Generation) | GPT-4 + CADCodeVerify: PC distance 0.127, compile rate 96.5% | **Partial.** A cheap smoke test, but the objects are simple and only old models were tested. |
| **Text2CAD** (NeurIPS 2024 main track, spotlight; DFKI) ([abstract](https://proceedings.neurips.cc/paper_files/paper/2024/hash/0e5b96f97c1813bb75f6c28532c2ecc7-Abstract.html), [pdf](https://www.dfki.de/fileadmin/user_upload/import/15570_Text2CAD.pdf)) / **CAD-Coder** (NeurIPS 2025) ([paper](https://arxiv.org/html/2505.19713v3)) | About 170K DeepCAD models with about 660K text annotations (4 levels). CAD-Coder turned it into 110K text-to-CadQuery triplets. | F1 on primitives, Chamfer distance, invalidity ratio | [HF SadilKhan/Text2CAD](https://sadilkhan.github.io/text2cad-project/) | On CAD-Coder's test set: Claude-3.7-Sonnet 47% invalid, GPT-4o 93% invalid, the fine-tuned 7B model 1.45% | **Partial.** Sketch-and-extrude parts only; mainly useful as training data. |
| **CAD-Recode** (ICCV 2025) ([HF](https://huggingface.co/papers/2412.14042), [code](https://github.com/filaPro/cad-recode)) | Point cloud in, CadQuery out; trained on 1M synthetic sequences | Chamfer distance | Public | 10× lower mean Chamfer distance than prior work on DeepCAD and Fusion360 | **Poor.** |
| **RealCADBench** (Sep 2026; Li et al.) ([arXiv](https://arxiv.org/abs/2609.03773v1), [summary](https://themodelwire.com/article/realcadbench-measures-ais-ability-to-generate-executable-cad-code-from-design-in-01M1N1PF8V7TJGE70EXF16VJPV)) | [corrected] 12,632 industrial tasks across 19 factory-automation categories. Text, drawing, photo or render in; FreeCAD Python out. The evaluated slice is 1,745 part tasks plus a 25-task assembly set. | Executability, solid IoU, surface IoU, rubric "Judge" score | [unconfirmed] No release link found | Part tasks: executability 0.565–0.812, solid IoU 0.28–0.54 across six frontier models; no model leads every metric. Assembly: Codex + GPT-5.5 beats GPT-5.5 alone on executability and IoU. | Partial. FreeCAD, not build123d. |
| **CADWorld** (Sep 2026; Dong et al.) ([arXiv](https://arxiv.org/pdf/2609.16251), [summary](https://aiweekly.co/alerts/cadworld-benchmark-top-agent-175-on-freecad-vs-experts-87)) | 200 FreeCAD GUI (computer-use) tasks in 11 categories (sketching, assembly, CAM, FEM, drawings) | Executable checks on the saved FreeCAD files | arXiv 2609.16251; VM image on [HF Zihan1004/CADWorld](https://huggingface.co/Zihan1004/CADWorld) (MIT) | Best agent 17.5% vs experts 87.0% | **Poor.** Sprue writes CAD as code, not through a GUI. |
| **BlenderLLM CADBench** (Dec 2024) ([paper](https://arxiv.org/html/2412.14203v1)) | Open-ended instruction in, Blender Python script out | MLLM judge | [GitHub](https://github.com/FreedomIntelligence/BlenderLLM) | Not given in the excerpt | **Poor.** Blender meshes, not B-rep. |

A relevant risk: a vendor blog (undated, ©2026) counted about 3–4× more code errors from build123d than from OpenSCAD in a 23-model run (40 vs 10 raw; 33 with an API reference). The author's explanation is that models know build123d's API less well ([GrandpaCAD](https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d)). [corrected] The CADGenBench rows suggest that a gated build123d MCP layer helps a lot with newer models: Opus 5 scores 36.1% with a baseline harness and 59.6% with build123d-mcp. It helped much less with Opus 4.8: 27.4% plain vs 31.5% with build123d-mcp.

## 3. Simulation and physics (only where it touches hardware design)

| Benchmark | Summary | Fit |
|---|---|---|
| **FEABench** (Google Research + Harvard) ([pdf](https://www.arxiv.org/pdf/2504.06260)) | A Gold set of 15 verified problems plus a Large set of 200; the LLM drives the COMSOL API. The best multi-turn agent wrote executable API calls 88% of the time but effectively solved **0** Gold problems within 10% tolerance. Its one "pass" was 20 °C, a COMSOL default. A Python variant (SWE-agent + Claude 3.5 Sonnet, numpy/scipy) passed 4 of 15. [GitHub](https://github.com/google/feabench). Needs a COMSOL licence. | **Partial.** Only matters if Sprue adds stress or thermal checks (plate flex, snap fits). |
| **PHYBench** (Apr 2025; NeurIPS 2025 Datasets & Benchmarks) ([abs](https://arxiv.org/abs/2504.16074v1)) | 500 original physics problems. Gemini 2.5 Pro 36.9% vs human experts 61.9%. [phybench.cn](https://www.phybench.cn/). [added] A Sep 2026 audit (below) found most of PHYBench's rejections were grader errors. | **Poor.** Measures the base model; the original numbers are outdated and the grading is unreliable. |
| **UGPhysics** (ICML 2025) ([pdf](https://arxiv.org/pdf/2502.00334)) | 5,520 undergraduate problems in English and Chinese (11,040 counting both languages). o1-mini 49.8%. | **Poor.** Outdated numbers; GPT-5.6-Sol High scored 92% after the 2026 audit. |
| **OlympiadBench** (2024) ([alphaxiv](https://www.alphaxiv.org/benchmarks/beihang-university/olympiadbench)) | 8,476 problems, 2,334 of them physics. GPT-4V 17.97%. | **Poor.** Outdated numbers. |
| **SciCode** (2024) ([alphaxiv](https://alphaxiv.org/benchmarks/university-of-illinois-at-urbana-champaign/scicode)) | 80 main problems / 338 subproblems, 46% physics; scored by running code. The listing (dated Jul 2024) shows o3-mini-low at 10.8%, which is stale. | **Poor.** |
| **[added] Physics benchmark audit** (Sep 2026; Yale-led, with Jump Trading, Cambridge, USC) ([pdf](https://arxiv.org/pdf/2609.13009)) | Experts re-graded six physics benchmarks (UGPhysics, PHYBench, PRISM-Physics, HLE-Physics, CMT-Benchmark, CritPt). Of 250 audited rejections, 95.2% were benchmark or grader errors and 4.8% were model errors. Corrected scores for GPT-5.6-Sol High: PHYBench 26.5% to 90.2%, UGPhysics 83.0% to 92.1%, HLE-Physics 47.3% to 78.7%. The authors say this does **not** show end-to-end physics research ability. | **Context, not a test to run.** The strongest evidence that the base model's closed-ended physics knowledge is not the bottleneck. |

## 4. Electronics: schematic, PCB, analog (RTL briefly)

| Benchmark | Task, size | Scoring | Data | Best reported | Fit |
|---|---|---|---|---|---|
| **PCBSchemaGen: PCBBench + Open-Schematics-Eval** (v2 Jun 2026; ASU + UT Austin) ([paper](https://arxiv.org/html/2602.00510v2)) | 227 plain-language specs (62 + 165), 480 real ICs, 22 domains. The model writes SKiDL Python, which produces KiCad schematics and netlists. Example task: "ESP32-based window monitoring… 3x LED… 3x reed switches" ([HF, MIT](https://huggingface.co/datasets/Hzou9/PCBSchemaGen-Benchmarks)). | Deterministic 5-layer checker: ERC, pin roles, templates, topology matching (VF2), power invariants. Gives a score in [0,1]; no LLM needed. | [GitHub, MIT](https://github.com/HZou9/PCBSchemaGen_v2) | Gemma-4-31B with their framework passes 81.3% of PCBBench | **Good.** Closest in spirit to a Pico + switches keypad. Sprue would need an adapter from its netlist to the checker's input (effort not checked). |
| **HWE-Bench (schematic)** (Mar 2026; Guangdong U. of Finance and Economics + Shandong U.) ([paper](https://arxiv.org/html/2603.18102)) | 300 board-level tasks across 8 domains, with 2,914 datasheets. Requirements + datasheets in, netlist out. | Static checks (pins, SPI/I²C/UART), then dynamic checks: the netlist is converted to SPICE and run in LTspice | **No release link or statement found** | Claude Sonnet 4.5 best, 8.15% fully correct (static 77.73%, dynamic 67.92%). The authors attribute the low scores to models that "lack physical intuition". | **Good if obtainable.** A lot of room above current scores. Note: a different "HWE-Bench" ([arXiv 2604.14709](https://arxiv.org/abs/2604.14709)) is about hardware bug repair (417 Verilog/Chisel tasks). |
| **SchGen** (May 2026; UCSD, MSR Asia, UT Austin) ([alphaxiv](https://alphaxiv.org/abs/2605.30345)) | Plain-language request to a schematic via a Python API, generated by a fine-tuned 20B model. 988 unseen GitHub designs for evaluation. | KiCad ERC valid rate, netlist Jaccard, expert review of function | [GitHub microsoft/SchGen (MIT)](https://github.com/microsoft/SchGen); dataset HF microsoft/SchGen_dataset (SparkFun-based, CC BY-SA 4.0) | About 80% valid, 60.5% functionally correct; about 65% valid on the GitHub set; beats GPT-5.2 and Grok-4 | **Partial/good.** Judging function needs humans. |
| **[added] PCBInnoBench** (NeurIPS 2026; Xia et al.) ([poster](https://neurips.cc/virtual/2026/poster/139034), [OpenReview](https://openreview.net/forum?id=owSXOGoqx5)) | 372 expert-designed KiCad tasks on real PCB projects (design and upgrade workflows). The agent gets the KiCad project and references; ground truth and validators stay hidden. | Structural, task-specific and cross-artifact engineering-constraint checks; Pass@1 with and without an expert's editing trajectory | Code and data at an anonymous review repo ([link](https://anonymous.4open.science/r/pcbinnobench-C841)); no permanent release confirmed | Best agent 22.0% Pass@1 with guidance, 7.3% without | **Partial/good.** The only released benchmark found that grades agentic edits of real boards. Sprue's board is code (`pcb.mjs`), not KiCad, so it would need a KiCad export (effort not checked). |
| **[added] PCBWorld** (Jul 2026; LG AI Research) ([arXiv](https://arxiv.org/abs/2607.05915), [GitHub](https://github.com/LGAI-Research/PCBWorld)) | Routing environment on KiCad 9's push-and-shove router; synthetic boards plus 679 DRC-clean real open-source boards. Supports RL and tool-using LLM agents. | 8 engine-checked metrics with post-hoc DRC | Public; non-commercial "PCBWorld License 1.0-NC"; engine GPLv3 | Agents beat grid RL and open-loop LLM baselines (numbers not checked) | **Partial.** A real routing test with DRC; routing only, KiCad only. |
| **PCB-Bench** (ICLR 2026) ([notes](https://en.papernotes.org/ICLR2026/llm_evaluation/pcb-bench_benchmarking_llms_for_printed_circuit_board_placement_and_routing/), [GitHub](https://github.com/digailab/PCB-Bench)) | About 3,700 text questions, about 500 image questions and 174 real projects (from OSHWHub), all about placement and routing. **QA only, no layout generation.** | Accuracy, BERTScore | Public | Claude-Opus-4.1 93.3–94.4% on placement multiple choice | **Partial.** A cheap knowledge check. |
| **OmniLayout** (Jul 2026, [arXiv 2607.03261](https://arxiv.org/abs/2607.03261)) / **OmniRouting** (Aug 2026) ([OmniLayout summary](https://chatpaper.com/es/chatpaper/paper/307758), [OmniRouting](https://www.alphaxiv.org/abs/2608.04434)) (Penn State, SJTU, MSR, Binghamton et al.) | 1,681 industrial PCBs paired with schematics. Placement (77.24K instances) and routing under design rules (DRC). | Metrics not visible | OmniRouting: "will open-source"; OmniLayout: release not stated | Qualitative only: "weak" | **Would be good for layout. Watch for release.** |
| **OmniSch** (Mar 2026; same group) ([MSR](https://www.microsoft.com/en-us/research/publication/omnisch-a-multimodal-pcb-schematic-benchmark-for-structured-diagram-visual-reasoning/), [arXiv 2604.00270](https://arxiv.org/abs/2604.00270)) | 1,854 schematic images, 109.9K grounded instances; grounding, diagram-to-graph and geometric reasoning | Not stated | No data link | Qualitative | **Poor.** |
| **MultModLM** (Jun 2026; SVNIT + George Mason) ([alphaxiv](https://www.alphaxiv.org/abs/2606.27666)) | 99 RTL modules, generate schematics | Rubric plus human review | No link | LLM judges showed **near-zero agreement with humans** | Poor fit, but a useful warning for designing our own set. |
| **AnalogCoder** (AAAI 2025) ([GitHub](https://github.com/laiyao1/AnalogCoder)) / **AnalogCoder-Pro** (Aug 2025) ([alphaxiv](https://alphaxiv.org/abs/2508.02518)) / **Masala-CHAI** (NYU + Cornell) ([paper](https://arxiv.org/html/2411.14299v5)) | 24 and 28 analog design tasks in PySpice/ngspice; about 7,500 textbook SPICE netlists | Pass@k from simulation | Public | The Claude-3.5-based AnalogCoder solved 22/24; AnalogCoder-Pro + GPT-5 98.6% Pass@5 | **Poor for keypads.** Partial if Sprue adds analog parts (power, sensors). |
| **EEE-Bench** (CVPR 2025) ([paper](https://arxiv.org/html/2411.01492v1)) | 2,860 EE questions, almost all with an image, 10 subdomains | Accuracy | Release promised; link not confirmed | GPT-4o 46.78% | **Partial.** Knowledge only; outdated numbers. |
| **VerilogEval v2** (NVIDIA/Cornell) ([pdf](https://www.csl.cornell.edu/~cbatten/pdfs/pinckney-revisiting-verilogeval-todaes2025.pdf)), **RTLLM 2.0** ([review](https://www.themoonlight.io/en/review/openllm-rtl-open-dataset-and-benchmark-for-llm-aided-design-rtl-generation)) | 156 problems / 50 designs | Pass@1 from simulation | Public | GPT-4o about 63% spec-to-RTL (2024) | **Poor.** Sprue has no RTL. |

## 5. Licensure and engineering exams

| Study | Exam, questions | Score |
|---|---|---|
| Naser et al. 2023 ([pdf](https://arxiv.org/pdf/2303.18149)) | [corrected] FE (civil) practice exam (79 Q answered); PE Structural (39 Q) | GPT-4: FE 70.9%, PE 46.2%. Bard: 39.2% / 41%. |
| Pursnani et al. 2023, U. Iowa ([pdf](https://arxiv.org/pdf/2304.12198)) | [corrected] FE Environmental: a 134-question practice exam written by U. Iowa faculty, not the NCEES practice exam | GPT-4 66.42%, 75.37% with refined prompts |
| Frenkel & Emara 2023 ([abs](https://arxiv.org/abs/2309.15866v1)) | Mechanical engineering undergraduate exams + FE Mechanical practice questions (text only) | GPT-4 76%, GPT-3.5 51% |
| Oblitas et al., Dec 2025, *Discover AI* ([Springer](https://link.springer.com/article/10.1007/s44163-025-00646-6)) | Official NCEES FE Civil practice exam (100 Q, 34 with images; 7 visual-reasoning Q) | o3, GPT-4o, DeepSeek-R1, Gemini 2.5 Pro all >70%; DeepSeek-V3 and Gemini 2.0 Flash >60%. Text questions about 87% vs image questions about 42%. Visual reasoning averaged <30% (only 7 questions). |
| Genç 2025, *J. Asian Architecture and Building Engineering* ([record](https://avesis.uludag.edu.tr/yayin/15293d50-24dc-4c49-b77e-1ce78a82d987/is-conversational-ai-ready-for-engineering-licensure-a-chatgpt-performance-benchmark-and-prompting-strategy-evaluation)) | FE Civil (100 Q) | ChatGPT-4 49% (Statics 14%); one-shot prompting recovered 30 of the 51 misses |
| Balart et al. 2024 ([ASEE](https://peer.asee.org/48322.pdf)) | PUC Chile's Fundamental Competencies Exam (857 valid Q, pass mark 60%) | GPT-4 63.06%; 64.38% with images (GPT-3.5 47.38%) |

- NCEES does not publish a passing score ([Pursnani](https://arxiv.org/pdf/2304.12198), [Oblitas](https://link.springer.com/article/10.1007/s44163-025-00646-6)).
- I found **no study of FE Electrical & Computer or PE Electrical with current models**. Treat that gap as unconfirmed rather than proven absent.
- **Fit: poor** for Sprue's design stage. These exams measure the underlying model, not the skill. The consistent weak spot is reading diagrams and images.

---

## 6. Recommendation: what to actually run

| Split | Use | Why |
|---|---|---|
| **Product-level** | **1. Our own Sprue idea set (required)** | Nothing public goes from an idea to CAD + PCB + BOM. See section 7. |
| | **2. EngDesign-Open** | The only public design benchmark graded by simulation, so it gives an external number we can compare with papers. Run its mechanical, structural and control tasks. None of its domains is consumer hardware, so it is a sanity check, not the headline. |
| **PCB / electronics** | **3. PCBSchemaGen benchmarks** (PCBBench 62 + Open-Schematics-Eval 165) | Plain-language specs with real ICs, a deterministic checker, MIT licence, and microcontroller + switch/LED tasks close to Sprue's keypads. Needs a netlist adapter. |
| | **4. HWE-Bench** if the authors share the data; otherwise **PCB-Bench** text and image QA as a cheap knowledge floor | HWE-Bench adds LTspice dynamic checks, and the best model is at 8.15%. PCB-Bench only tests placement and routing knowledge. |
| | [added] **4b. PCBInnoBench** (optional) | Real KiCad projects with hidden validators. Only worth it if a KiCad export from Sprue's board code is cheap. |
| **Mechanical / CAD** | **5. CADGenBench** | Native to build123d, has a public leaderboard, and Claude Code + build123d systems are already listed to compare against. Tests CAD precision. |
| | **6. MUSE** | Spec to manufacturable, assemblable multi-part assemblies; dataset CC BY 4.0. The closest to "design the enclosure". |

Worth watching: Text2CAD-Bench (its L4 real-product tier), CADEngBench (FEA and joints), OmniLayout / OmniRouting, and PCBWorld (routing with KiCad DRC; already public, non-commercial licence).

## 7. What no existing benchmark covers (so we would build it)

1. **Idea to spec.** Turning one line into requirements and choices: key count, controller, connector, size. Every benchmark starts from a spec or a drawing.
2. **Fit between domains.** Does the PCB outline match the case? Do mounting holes, standoffs, switch cutouts and the USB opening line up? Do parts collide? I found no benchmark that checks CAD and PCB together. (CADEngBench checks joints between mechanical parts; PCBInnoBench checks consistency across ECAD files.)
3. **PCB layout as code that a fab would accept.** Gerbers that pass a real fab's DRC, with the netlist read back from the zip. [corrected] Layout benchmarks now exist: PCBInnoBench (KiCad project edits) and PCBWorld (routing under KiCad DRC). None of them grades generating a complete board from a spec, exporting Gerbers, or reading the netlist back.
4. **Firmware matching the board.** A pin map that matches the routed board, run on an emulated Pico. Nothing combines firmware with a PCB.
5. **BOM correctness before sourcing.** Real, orderable parts, footprints that match those parts, quantities and plausible cost.
6. **FDM printability and tolerances.** Wall thickness, overhangs, press-fit and snap-fit clearances. MUSE covers some of this, but only through a VLM judge.
7. **How good the checks themselves are.** Precision and recall of Sprue's engineer checks on known faults.
8. **Physical ground truth.** Does the built device work?

A suggested shape for our set:
- About 20–30 one-line ideas in Sprue's scope, each with a hidden acceptance rubric.
- Scored on three tracks that match the split you asked for:
  - **Product**: all gates pass, plus a human review.
  - **PCB**: ERC/DRC, netlist read-back and the firmware emulator, reusing what `sprue verify` already does.
  - **Mechanical**: build123d runs, the solid is valid, the fit checks pass, and the part is printable.
- A **seeded-fault set**: take good designs, inject known errors (a hole 1 mm off, swapped pins, a wall that is too thin) and measure whether the checks catch them.
- Avoid LLM-as-judge for structural correctness: MultModLM found near-zero agreement between LLM judges and humans ([link](https://www.alphaxiv.org/abs/2606.27666)).
- Build 2–3 devices to calibrate the scores against reality. That costs money, so it needs Tobias's OK.

## 8. Evidence on "is there a fundamental limit / do we need to train a physics model?"

The evidence points to tools and checkers in the loop as the main lever, not missing physics knowledge. Training our own model is not clearly needed. This is my interpretation of the results below, and some of them point the other way.

- **Iterating with feedback helps a lot.** [corrected] EngDesign: on a 71-task subset, o3 reaches "almost 60%" after 10 design iterations ([paper](https://arxiv.org/html/2509.16204v2)). Its one-shot 34.38% is on all 101 tasks, and the iteration-0 rate on the subset appears only in a figure. So "roughly doubles" is not a like-for-like comparison.
- **The harness matters a lot for the same model.** CADGenBench generation: Claude Opus 5 scores 36.1% with a baseline harness (max effort) and 59.6% with build123d-mcp (xhigh effort). [added] For Opus 4.8 the gain is small: 27.4% plain, 28.0% with Claude Code + a text-to-CAD skill, 31.5% with build123d-mcp. There is no plain Opus 5.5 row, so its 86.9% cannot be split between model and harness ([BenchLM](https://benchlm.ai/md/benchmarks/cadgenbenchgeneration.md)). Rows are submitted by their authors; BenchLM did not re-run them.
- **Failures are in system integration, not single-circuit checks.** HWE-Bench: the best model passes static checks 77.7% of the time and dynamic checks 67.9%, but only 8.15% of designs are fully correct ([paper](https://arxiv.org/html/2603.18102)). [added] Counterpoint: the authors themselves attribute this to models that "lack physical intuition".
- **[added] Textbook physics is close to solved; physics in the loop is not.** A Sep 2026 audit found 95.2% of audited "model errors" on six physics benchmarks were broken questions or graders; corrected frontier scores are 79–95% ([pdf](https://arxiv.org/pdf/2609.13009)). CADEngBench, in contrast, found designs that must match a reference FEA still hard for all eight models tested ([abs](https://arxiv.org/abs/2608.09296)). That fits "use simulators as checkers", not "train a physics model".
- **Reading drawings is the bottleneck in exams.** FE Civil: about 87% on text questions vs about 42% on image questions ([Springer](https://link.springer.com/article/10.1007/s44163-025-00646-6)).
- **Simulation is used wrong rather than physics being misunderstood.** FEABench: the agent wrote executable COMSOL calls 88% of the time but almost never produced the right number ([pdf](https://www.arxiv.org/pdf/2504.06260)).
- **Fine-tuned small models win narrow metrics.** CAD-Coder 7B: 1.45% invalid vs 47% for Claude 3.7 ([paper](https://arxiv.org/html/2505.19713v3)). SchGen's fine-tuned 20B model beats GPT-5.2 and Grok-4 on its own schematic task. Even so, a general frontier model with tools currently leads the open CAD leaderboard.

## 9. Not read or not confirmed

**Pages I could not read (original report):**
- OmniLayout's arXiv page and the CircuitLM arXiv page (arXiv 2601.04505). The fetch proxy rate-limited them (HTTP 429), so I used a chatpaper summary for OmniLayout. [added] Fact-check: OmniLayout is arXiv 2607.03261. CircuitLM is a multi-agent schematic pipeline from IUT Dhaka with 100 embedded-systems prompts and a 0–10 "DMCV" score; its code and data are promised on acceptance. Low relevance.
- The Taylor & Francis page for Genç 2025 failed to load; I used the university record.
- CADWorld's awesomepapers page failed to load; I used the AI Weekly summary and the arXiv PDF.

**Unconfirmed:**
- HWE-Bench data availability (the paper has no release statement).
- Release of Text2CAD-Bench ("after accept"), OmniLayout (not stated), OmniRouting ("will open-source"), CADEngBench and RealCADBench data, and their metrics where not listed.
- PCBInnoBench: whether a permanent public release follows the anonymous review repo.
- PHYBench's organisation; the data links for UGPhysics and EEE-Bench.
- EngDesign-Open size (67 in the paper vs 53 on the project page).
- CADGenBench editing count (32, inferred from a submission name) and the per-row validation status of the top BenchLM rows.
- The adapter effort for MUSE, PCBSchemaGen and PCBInnoBench.
- The MUSE code licence.

**Probably outdated:** the SciCode, OlympiadBench, EEE-Bench and VerilogEval numbers come from 2024–early 2025 models. The PHYBench and UGPhysics numbers are both outdated and, per the 2026 audit, distorted by grader errors.

## Sources
- EngDesign: https://arxiv.org/html/2509.16204v2 · https://agi4engineering.github.io/Eng-Design/ · https://huggingface.co/datasets/opt1zer/EngDesign · https://proceedings.neurips.cc/paper_files/paper/2025/hash/664f777548205fb6e0cbb0965e8d2e16-Abstract-Datasets_and_Benchmarks_Track.html
- DesignQA: https://arxiv.org/html/2404.07917v2 · https://github.com/anniedoris/design_qa/
- EngiBench: https://arxiv.org/html/2509.17677v1 · https://github.com/EngiBench/EngiBench
- VLMs for design: https://arxiv.org/html/2311.12668v3 · https://decode.mit.edu/projects/vlms4design/
- BuildArena: https://arxiv.org/html/2510.16559v4 · https://icml.cc/virtual/2026/poster/64183 · https://github.com/AI4Science-WestlakeU/BuildArena
- CADGenBench: https://github.com/huggingface/cadgenbench · https://benchlm.ai/benchmarks/cadgenbenchgeneration · https://benchlm.ai/md/benchmarks/cadgenbenchgeneration.md · https://github.com/pzfreo/cadgenbench-build123d · https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench · https://benchmarklist.com/benchmarks/cadgenbench/
- MUSE: https://arxiv.org/html/2605.28579 · https://dong7313.github.io/muse-benchmark/ · https://huggingface.co/datasets/dongxiaoyu/MUSE · https://github.com/dong7313/muse
- CADEngBench: https://arxiv.org/abs/2608.09296
- Text2CAD-Bench: https://arxiv.org/pdf/2605.18430
- CADBench (MIT): https://arxiv.org/pdf/2605.10873 · https://github.com/anniedoris/CADBench
- BenchCAD: https://arxiv.org/html/2605.10865v1
- CADPrompt: https://arxiv.org/pdf/2410.05340
- Text2CAD: https://proceedings.neurips.cc/paper_files/paper/2024/hash/0e5b96f97c1813bb75f6c28532c2ecc7-Abstract.html · https://www.dfki.de/fileadmin/user_upload/import/15570_Text2CAD.pdf · https://sadilkhan.github.io/text2cad-project/
- CAD-Coder: https://arxiv.org/html/2505.19713v3 · https://proceedings.neurips.cc/paper_files/paper/2025/hash/564a224e88f2490f3c1deaae877d37e3-Abstract-Conference.html
- CAD-Recode: https://huggingface.co/papers/2412.14042 · https://github.com/filaPro/cad-recode
- RealCADBench: https://arxiv.org/abs/2609.03773v1 · https://themodelwire.com/article/realcadbench-measures-ais-ability-to-generate-executable-cad-code-from-design-in-01M1N1PF8V7TJGE70EXF16VJPV
- CADWorld: https://arxiv.org/pdf/2609.16251 · https://aiweekly.co/alerts/cadworld-benchmark-top-agent-175-on-freecad-vs-experts-87 · https://huggingface.co/Zihan1004/CADWorld
- BlenderLLM: https://arxiv.org/html/2412.14203v1
- GrandpaCAD: https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d
- FEABench: https://www.arxiv.org/pdf/2504.06260 · https://arxiv.org/abs/2504.06260v1
- PHYBench: https://arxiv.org/abs/2504.16074v1 · https://proceedings.neurips.cc/paper_files/paper/2025/hash/01e793f8cf5689aa0ea46a1b01071bea-Abstract-Datasets_and_Benchmarks_Track.html
- UGPhysics: https://arxiv.org/pdf/2502.00334 · https://proceedings.mlr.press/v267/xu25ai.html
- Physics benchmark audit: https://arxiv.org/pdf/2609.13009
- OlympiadBench: https://www.alphaxiv.org/benchmarks/beihang-university/olympiadbench
- SciCode: https://alphaxiv.org/benchmarks/university-of-illinois-at-urbana-champaign/scicode
- PCBSchemaGen: https://arxiv.org/html/2602.00510v2 · https://github.com/HZou9/PCBSchemaGen_v2 · https://huggingface.co/datasets/Hzou9/PCBSchemaGen-Benchmarks
- HWE-Bench: https://arxiv.org/html/2603.18102 · (bug-repair namesake) https://arxiv.org/abs/2604.14709
- SchGen: https://alphaxiv.org/abs/2605.30345 · https://github.com/microsoft/SchGen
- PCBInnoBench: https://neurips.cc/virtual/2026/poster/139034 · https://openreview.net/forum?id=owSXOGoqx5
- PCBWorld: https://arxiv.org/abs/2607.05915 · https://github.com/LGAI-Research/PCBWorld
- PCB-Bench: https://en.papernotes.org/ICLR2026/llm_evaluation/pcb-bench_benchmarking_llms_for_printed_circuit_board_placement_and_routing/ · https://github.com/digailab/PCB-Bench
- OmniLayout / OmniRouting / OmniSch: https://arxiv.org/abs/2607.03261 · https://chatpaper.com/es/chatpaper/paper/307758 · https://www.alphaxiv.org/abs/2608.04434 · https://www.microsoft.com/en-us/research/publication/omnisch-a-multimodal-pcb-schematic-benchmark-for-structured-diagram-visual-reasoning/ · https://arxiv.org/abs/2604.00270
- MultModLM: https://www.alphaxiv.org/abs/2606.27666
- AnalogCoder / Pro / Masala-CHAI: https://github.com/laiyao1/AnalogCoder · https://alphaxiv.org/abs/2508.02518 · https://arxiv.org/html/2411.14299v5
- EEE-Bench: https://arxiv.org/html/2411.01492v1 · https://openaccess.thecvf.com/content/CVPR2025/html/Li_EEE-Bench_A_Comprehensive_Multimodal_Electrical_And_Electronics_Engineering_Benchmark_CVPR_2025_paper.html
- VerilogEval / RTLLM: https://www.csl.cornell.edu/~cbatten/pdfs/pinckney-revisiting-verilogeval-todaes2025.pdf · https://www.themoonlight.io/en/review/openllm-rtl-open-dataset-and-benchmark-for-llm-aided-design-rtl-generation
- CircuitLM: https://arxiv.org/abs/2601.04505
- Exams: https://arxiv.org/pdf/2303.18149 · https://arxiv.org/pdf/2304.12198 · https://arxiv.org/abs/2309.15866v1 · https://link.springer.com/article/10.1007/s44163-025-00646-6 · https://avesis.uludag.edu.tr/yayin/15293d50-24dc-4c49-b77e-1ce78a82d987/is-conversational-ai-ready-for-engineering-licensure-a-chatgpt-performance-benchmark-and-prompting-strategy-evaluation · https://peer.asee.org/48322.pdf

---

## Fact-check notes

**Corrections made**
1. **EngDesign iteration claim (sections 1, 8).** The "nearly 60% after 10 iterations" result is on a 71-task subset, not the full 101 tasks. Comparing it with the 34.38% one-shot rate on all tasks is not like-for-like, so "roughly doubles" was replaced. The iteration-0 rate for that subset is not in the text.
2. **EngDesign venue.** NeurIPS 2025 Datasets & Benchmarks is confirmed by the NeurIPS proceedings, not by the arXiv text. Added the full title and the dataset licence (MIT).
3. **FE exam range (bottom line).** "Around 66–76%" left out Genç 2025 (ChatGPT-4 49% on FE Civil). It now reads 49–76%, with most studies at 66–76%.
4. **Pursnani 2023.** The 134 questions are an unpublished practice exam written by U. Iowa faculty, not the NCEES exam.
5. **Naser 2023.** Described as an FE (civil) practice exam rather than "civil/environmental".
6. **Oblitas 2025.** Added the journal and date (Discover AI, Dec 2025), the DeepSeek-V3 and Gemini 2.0 Flash results, and that the "visual reasoning <30%" figure rests on only 7 questions.
7. **Balart 2024.** Named as PUC Chile's Fundamental Competencies Exam; added GPT-3.5 at 47.38%.
8. **CADGenBench task count.** The two figures do not conflict: 49 is generation only, 81 is all fixtures. The 32 editing fixtures are inferred from a submission name.
9. **CADGenBench validation.** BenchLM states that it mirrors only rows the official dataset marks validated. It does not verify them row by row or re-run them. Wording updated.
10. **CADGenBench harness evidence (sections 2, 8).** Added the Opus 4.8 rows (27.4 / 28.0 / 31.5): a skill alone barely helped and the MCP helped modestly. There is no plain Opus 5.5 baseline, so its 86.9% cannot be attributed to the harness. "Largely offsets" was softened.
11. **GrandpaCAD.** "About 4×" became "3–4×": raw counts are 40 vs 10, and 33 with an API reference; the author says "roughly three to four times".
12. **MUSE date and licence.** First posted May 2026, v2 on 4 Jun 2026. CC BY 4.0 is confirmed for the dataset; the code licence is not stated. Added the direct HF and GitHub links.
13. **EngiBench link.** The "GitHub" link pointed at arXiv; it now points to github.com/EngiBench/EngiBench.
14. **VLMs for engineering design.** The paper is mainly quantitative (more than 1,000 quantitative queries) with qualitative case studies, not "mostly qualitative". The models were GPT-4V and LLaVA 1.6 34B.
15. **BuildArena.** Code URL found (AI4Science-WestlakeU/BuildArena). ICML 2026 confirmed.
16. **RealCADBench.** Now confirmed: arXiv 2609.03773, authors, metrics, evaluated slice and result ranges.
17. **CADWorld.** Added the 11 categories and the HF VM image (MIT).
18. **Text2CAD-Bench.** L4 is single-solid and also covers architectural and educational designs; its judge is GLM-4.6V. Added DeepSeek-V3.2's 55% invalid rate next to its best L4 score.
19. **Text2CAD.** NeurIPS 2024 main track, spotlight. 170K/660K confirmed as "text annotations".
20. **HWE-Bench.** Affiliations confirmed (GDUFE + Shandong U.). Added the authors' own "lack physical intuition" reading as a counterpoint in section 8.
21. **Section 7, item 3.** "Layout benchmarks are QA-only or unreleased" is no longer true; PCBInnoBench and PCBWorld exist.
22. **OmniLayout and OmniSch.** Added arXiv IDs (2607.03261, 2604.00270) and affiliations. "Will be open-sourced" applies to OmniRouting only.
23. **PHYBench and UGPhysics.** Venues confirmed (NeurIPS 2025 D&B; ICML 2025, PMLR v267). Added the 2026 audit showing their original numbers are distorted by grader errors.
24. **SchGen.** It is a fine-tuned 20B model. Code is MIT; data is CC BY-SA 4.0.
25. **Masala-CHAI.** Affiliations are NYU and Cornell.
26. **Sources.** Removed arXiv 2509.18776v3. It is AECBench, a Chinese AEC knowledge benchmark, not an FE/PE study, and the report never cited it.

**Added (missed by the report)**
1. PCBInnoBench (NeurIPS 2026): https://neurips.cc/virtual/2026/poster/139034
2. PCBWorld (LG AI Research, Jul 2026): https://arxiv.org/abs/2607.05915
3. CADEngBench (Aug 2026): https://arxiv.org/abs/2608.09296
4. The physics benchmark audit (Yale-led, Sep 2026): https://arxiv.org/pdf/2609.13009

**Confirmed as stated (no change):** DesignQA scores; EngiBench numbers; CADGenBench top scores (86.9 / 84.5 / 59.6 / 36.1 / 27.4) and its scoring, Apache-2.0 licence and private ground truth; MUSE scores; CADBench (Opus 4.7, IoU 0.412; HF DeCoDELab/CADBench); BenchCAD; CADPrompt; CAD-Coder; CAD-Recode; FEABench (88%, 0 Gold, the 20 °C default, Python variant 4/15); OlympiadBench; SciCode; PCBSchemaGen (227 tasks, 480 ICs, MIT, 81.3%, the ESP32 example); HWE-Bench numbers; the separate HWE-Bench 2604.14709; SchGen results; PCB-Bench; MultModLM; AnalogCoder 22/24 (AAAI 2025); AnalogCoder-Pro 98.6%; EEE-Bench (CVPR 2025, 46.78%); VerilogEval (156, about 63%); RTLLM 2.0 (50); Frenkel & Emara; Genç.

**Could not confirm**
- HWE-Bench data release; Text2CAD-Bench, OmniLayout, OmniRouting, CADEngBench and RealCADBench data releases.
- Whether PCBInnoBench gets a permanent release beyond the anonymous review repo.
- The CADGenBench editing count (32, inferred) and the per-row validation of BenchLM's top rows.
- The CADGenBench leaderboard URL (the Space name vs `cadgenbench-leaderboard` in the repo's About section).
- PHYBench's organisation; UGPhysics and EEE-Bench data links; the MUSE code licence.
- EngDesign-Open size (67 vs 53); o3's iteration-0 rate on the 71-task subset.
- BenchCAD's Vision2Code 0.318, taken from the paper text, not its appendix table.
- PCBWorld and CADEngBench numeric results.
- The absence of any FE/PE Electrical study with current models.