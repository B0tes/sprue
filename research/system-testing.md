# Testing the whole product (2026-10-16)

Tobias asked (2026-10-16 15:46 UTC): what are the best repos online for custom AI PCBs that also get fully tested;
if not done already, fork them and integrate them in Sprue; give the user full flexibility to change individual
components while keeping the product working. He expects the hardest part to be testing the system as a whole, not
each part: that electricity flows through it correctly, that it makes physical sense (it doesn't fall over), that
parts that go inside other parts fit, and that it does its physical job (sound gets out of a speaker, no
interference). He named Arena Physics as having a good model for electromagnetics.

Six sweeps (AI PCB tools, closed tools, part swaps, electrical, mechanical, physical) ran on 2026-10-16, each
fact-checked by a second pass that reopened its sources; corrections from that pass are applied below. Facts were
seen on 2026-10-16 unless dated otherwise; "(inferred)" marks our own reasoning or arithmetic. Trials ran in this
container on the keypad and on Ponder. What was built from it is `sprue system` (`skills/sprue/cad/system.py`,
README "The whole product").

## The short answers

- **Nobody ships AI-designed boards that are fully tested.** No open or closed project goes from a request to a
  board that is proven to work in its product. The ones that check the most:
  - **Diode `pcb` / Zener** (MIT, Rust): ERC, ngspice testbenches, KiCad DRC, JLCPCB and IPC DFM rule files that
    fail when a rule can't be evaluated, and live BOM availability. It needs KiCad 10 (7.0.11 is installed here) and
    its binaries come from a host blocked here, so it is one to watch, not run.
  - **tscircuit** (MIT, TypeScript, 2.7k stars): boards as TSX, any JLC part by its `jlcpcb:Cxxx` number, its own
    autorouter, Gerber, KiCad and STEP export, and 23 checks on its Circuit JSON, 15 of them about the board. Its
    checks read the model it wrote, so they aren't independent, and in our 2026-10-14 trial its routes varied
    between runs and its KiCad export lost detail (`research/pcb-verification.md`).
  - **atopile** (MIT): parameters as toleranced ranges, assertions as constraints, and a solver that picks parts to
    satisfy them. 0.12.6 is marked retired, 0.15.9 needs Python 3.14 and a sign-in to pick parts, and layout is done
    by hand in KiCad, so it can't run unattended here (tried 2026-10-16).
  - **kicad-happy** (MIT): a verifier of KiCad files, not a designer: 44 EMC rules, derating and generated SPICE
    testbenches. It needs a `.kicad_sch` or `.kicad_pcb`, which Sprue doesn't write yet.
  - **Freerouting** (GPL-3, a separate program): the best open router in the PCBWorld study (clean on 80% of 99 real
    boards, 78% of 10 hard ones, where every LLM agent scored 0). For boards Sprue's own router can't do.
- None of them reads back the Gerbers it ships, runs firmware against the copper, or puts the board in the product.
  Sprue already did the first two (`sprue verify`); `sprue system` now does the third.
- **Fork nothing.** tscircuit is about 80 npm packages and releases several times a week (0.0.2839 to 0.0.2920 while
  the sweeps ran); Diode releases several times a day. A fork would make Sprue their maintainer, and Sprue's value
  is the independent checks on top. Depend on exact pinned versions, run GPL tools as separate programs, and copy
  rule lists (Quilter's physics rules, Cadstrom's interface checks, Diode's fail-when-a-rule-can't-run) into Sprue's
  own audit. A fork can't be made from here anyway: this session can't create repos on Tobias's account.
- **Arena Physics is Arena Physica** (New York, formerly Arena AI, maker of Atlas). Its Heaviside-1 (350M parameters,
  released 2026-09-01) predicts near fields and S-parameters from a 3D structure; its published benchmarks are
  8 x 8 mm two-layer boards, it has no far field yet, and every accuracy figure is its own. It has no public API,
  weights, licence or price: access is a browser beta, Microsoft Discovery (since 2026-10-13) or sales. It can't
  answer Ponder's real EM question, the Wi-Fi antenna next to a 381 mm steel gooseneck (about three wavelengths at
  2.4 GHz). Watch it. The open path is openEMS (GPL-3, minutes per run) with scikit-rf, run only when a rule says the
  margin is thin, and the cheapest real test is the RSSI with and without the arm on the first unit.
- **Swapping a part safely needs a contract, and no tool checks one against the whole product.** Every tool's
  alternates (Zener's `alternatives`, tscircuit's `pinCompatibleVariants`, DigiKey's substitutions, Sprue's own
  `BomLine.alternates`) are sourcing metadata. See "Part swaps".
- **The whole-system check is Sprue's own code**, with Claude orchestrating free solvers. No tool, open or closed,
  takes an assembly and its BOM and answers whether it fits, stands, sounds, radiates and stays cool. The closest are
  enterprise agents (Arena Atlas; Cadence's AuraStack, announced for later in 2026; Siemens Fuse, PCB only).

## What `sprue system` checks now

`cad/_system.py` puts every part in one frame: the printed parts from their own CAD, the board from the shipped
Gerber zip, the bought parts as envelopes at their datasheet sizes. Seven gates run on the solids:

| Gate | What fails it |
| --- | --- |
| placed | a BOM piece missing, or the wrong count (sw1 to sw9 for 9 switches) |
| overlap | two parts sharing volume, except the fits the design declares (an insert in its boss) |
| contact | a pair the design says touches that doesn't |
| clearance | any other pair, or a facing face beside a contact, under `minClearanceMm` |
| inside | a part meant to be inside the case outside its hull |
| stability | tipping at 10 deg of tilt, or under a push the design names, in any pose |
| function | rays: sound out of a grille, a mic port open, the camera's target in view and clear, light reaching its window, no metal near an antenna |

Each gate has planted faults (a part left out, moved into its neighbour, to just under the gap, off its contact or
out of the case; 10 kg beyond the feet or high above them; a 1000 N shove; a disc over a grille or port, a plate in
front of a camera or light, a steel block on a keep-out). A catch counts only when the faulted run has a problem the
clean run lacks, so a gate that already fails can't pass its self-test on that failure. `score.json` fails a product
with printed, machined or sheet parts until `system.json` passes on the files as they are now.

What it found on the first runs:

- **Keypad** (44 parts, 17 s): the USB cable's overmold (an 11 x 8 mm estimate) and the tray wall share 1.04 mm3,
  because the opening is cut in the top shell only; and the tray's 6.0 mm counterbores leave the 5.7 mm ISO 7380
  screw heads 0.15 mm a side, under the 0.2 mm gap, where a printed hole comes out small. It stands to 58.7 deg.
- **Ponder** (62 parts, 135 s): 30% of the speaker's 35.6 mm opening sees out through the grille, over the 20% floor
  and under the 40% aim (24% over the whole 40 mm frame); an M2.5 steel screw is 8.9 mm from the Pi's antenna, under
  15 mm; the SD card (2.4 mm out, an estimate) is 0.10 mm from the head; the mute toggle's bushing
  has 0.075 mm a side in its 6.35 mm hole; four locating fits (camera pins, junction posts, the head's lap joint)
  are 0.15 mm a side. It tips at 15.9 deg as built and tips under a 2 N push forward at head height (1.34 N), which
  the design already accepts in `rules.ts` (hold the base while bending the arm).
- Both fixes lists are in PLAN.md.

Not checked yet: the circuit as a whole, heat, a drop, sound beyond the open share, and fields beyond a keep-out
distance. The sections below are the plan for those.

## Part swaps: keep it working when a part changes

The real gap is inside Sprue. Swap-critical numbers are typed twice and nothing ties the copies:

- Ponder's speaker is 40 mm, 4 ohm, 3 W rated, 4 W max in `bom.json`, and again in `design.json` params (with the
  grille's 35.6 mm opening taken from that speaker's baffle). The amp-speaker rule reads impedance from the BOM but
  power from the params, so a swap that edits only the BOM passes on stale numbers.
- The keypad repeats the Pico's size in the BOM and its BOOTSEL, LED and USB positions in the params.

The fix: one **part contract** per part (`parts/<mpn>.json`) and one **slot contract** per BOM line, with every
number a range with its source (after kicad-happy's MIT datasheet schema: min, typ, max, unit, condition, evidence),
and CAD, rules, PCB and firmware reading only values derived from them. A contract holds:

- interfaces provided and required: a power rail with its voltage range and current, I2S, USB, GPIOs with pull-ups
  (the vocabulary of tscircuit's `pinAttributes`);
- pins: function, power domain, absolute maximum, 5 V tolerance;
- mechanics: envelope, mounting pattern, a STEP file and its hash, mass, connector positions;
- software: the CircuitPython board and its pin names, or the Pi overlay and its pins, and the CPU architecture;
- acoustic, radio and thermal numbers where the part has them.

Then `sprue swap <slug> <line> <part>` reruns every gate and prints which changed. Four swaps worked through:

1. **Keypad: Pico to Seeed XIAO RP2040.** The XIAO breaks out 11 GPIOs; GP5, GP8, GP9 and GP10 of the keypad's map are
   not among them, so four keys must be rewired, and CircuitPython on the XIAO has no `board.GPx` names, so
   `code.py` would raise an `AttributeError` (inferred from its `pins.c`). A static check of `code.py` against the
   board's stub file (circuitpython-stubs, MIT) catches it before the emulator boots.
2. **Keypad: Pico to Waveshare RP2040-Zero.** All the pins exist, but there is no `board.LED` (its NeoPixel is on
   GPIO16), so the keypad's LED window probe means nothing; and Waveshare publishes a STEP but no footprint.
3. **Ponder: the 40 mm 4 ohm speaker to a 36 mm 8 ohm one (PUI AS03608AS-R).** The amp gives 1.8 W into 8 ohm, not
   3.2 W, against a 1 W rating, so the volume cap must fall to 1 W; the square frame's 50.9 mm diagonal doesn't fit
   the 40.8 mm ring (inferred); and the grille was sized for the old baffle.
4. **Ponder: Pi Zero 2 W to Zero W.** Same header, camera socket and radio, but a single-core ARMv6 CPU: Raspberry Pi
   OS 64-bit lists the Zero 2 W and not the Zero W, so anything built for aarch64 breaks. A slot needs an
   architecture requirement.

Real geometry for bought parts makes the mechanical half of a contract checkable: Raspberry Pi's STEP files for the
Pico and the Camera Module 3, Adafruit_CAD_Parts (MIT) for the NeoPixel stick and the amp, kiswitch (MIT and
CC-BY-SA) for MX switches and Kailh sockets, attached by build123d joints at their mounting features so a substitute
lands in the same place. KiCad's own libraries are CC-BY-SA 4.0 with a design exception: keep them out of the MIT
tree.

## Electricity through the whole system

What exists: Ponder's `rules.ts` runs a lumped power budget (2,607 mA against a 3,000 mA supply) and a head-voltage
check (4.31 V worst against 4.75 V), both flagged. Ponder's wiring exists only as English in `design.json`, which is
the biggest missing input. No open tool checks pinouts or power across boards, modules and harnesses: KiCad has no
multi-board support, and the open ERCs (SKiDL's, KiCad's) know pin types but not voltages.

The plan:

1. **A typed system netlist and power tree, in Sprue's own code**, with each module's pins from its contract and the
   harness as WireViz YAML (WireViz itself is GPL-3, used only to draw it). Checks: every pin's role exists on that
   pin (the Pi's alternate-function table, BSD-3), rail voltages inside every sink's range, logic levels (a WS2812B
   needs 2.7 V high; Ponder powers it through a diode so 3.3 V data still reads high), current summed over sources and
   sinks, wire gauge and drop over length, and the current a USB-C supply advertises on CC against the budget.
2. **ngspice from that netlist**, with behavioural loads (no vendor SPICE model exists for the MAX98357A). The trial
   on Ponder (0.4 s): modelling the class-D amp as a constant-power load gives 4.24 V at the head and 3.12 A peaks from
   a 3 A supply, against the rule's 4.31 V and 2.82 A; going from 1 to 1,000 uF at the head moves the 50 Hz minimum by
   6 mV, so only less amp power, more copper or a stiffer supply fix it. The supply's output resistance is the main
   unknown: measure it on unit 1. ngspice's core is BSD-3 but parts are LGPL, GPL and MPL, so call it as a program.
3. **Datasheet interconnect rules**: the MAX98357A's EMI was measured with 12 in of speaker cable and no filter, and
   Ponder runs 690 mm through the arm beside the LED data line (add ferrites, flag it); 0.1 uF + 10 uF on its supply,
   more with long leads.
4. **Interference in the arm's ribbon**: an ngspice coupled-line deck for the speaker pair beside LED data and the
   button. It runs here, but needs the ribbon's per-length L and C before its answer counts.
5. **The keypad end to end over real USB**: read the HID reports off rp2040js's USB controller instead of a KMK hook
   (already in PLAN).
6. **A bring-up script for unit 1** (OpenHTF, Apache-2.0) from the same limits, whose readings come back as
   calibration. Ponder's Pi software can't be emulated whole (QEMU's Zero 2 W lacks I2S, the camera and Wi-Fi).

## Physical sense: stability, fit, assembly

- **Stability.** The static support-polygon tilt is the gate; MuJoCo 3.16 (Apache-2.0) agreed with it within about
  1 deg on Ponder (15.9 against 14.7 to 14.9 deg about the weakest edge), with two traps: runs under 2 to 3 s gave a
  false 20.1 deg, and its default soft contacts creep. IEC 60598-2-4 (portable luminaires) asks for 6 deg in the
  most unfavourable position, so Sprue's 10 deg is a margin above it. MuJoCo stays an optional layer for pushes,
  tugs and bumps.
- **The gooseneck can only hold what it can hold.** Holding Ponder's head straight out needs 1.04 N m at the root
  (inferred: 9.81 x (0.330 kg x 0.191 m + 0.107 kg x 0.404 m)); the maker publishes no holding torque. Add a measured
  `armHoldNm` and drop the poses the arm can't hold.
- **Speed.** 170 of Ponder's 188 s is trimesh's numpy ray casting; manifold3d (Apache-2.0) runs the pair gates 13 to
  26 times faster than OpenCascade within 0.008 mm, with OpenCascade kept as the referee near a limit. Neither
  embreex nor manifold3d is a dependency yet.
- **Fit under tolerance.** No maintained open tool does 3D stacks from STEP. With manifold3d, a sweep that grows and
  shifts each printed part by up to 0.3 mm becomes affordable.
- **Can it be assembled.** Learn from Assemble-Them-All (assembly by disassembly), not its Python 3.7 code: one swept
  path per part and direction, then each build-plan step as a partial assembly.
- **A drop** from 760 mm (inferred): 3.86 m/s; Ponder's 213 g ballast mounts see 0.5 to 2.5 kN for 5 to 1 mm of
  stopping distance, a cheap CalculiX load case.

## Physical job: sound, light, radio, heat

The right first gate for each is a rule plus a lumped model from Sprue's own CAD and BOM, in milliseconds; a field
solver runs only when the margin is thin.

- **Sound.** Same Sky (speaker maker) says holes removing as little as 20% of the front plate protect the speaker,
  and 40 to 60% is a reasonable compromise (its summary table: at least 20% of the diaphragm area). Ponder's grille
  leaves 30% of the speaker's 35.6 mm opening clear (the probe's rays), so it passes the floor and is under the
  compromise; 2.4 mm holes on the same 3.2 mm pitch would give about 44% (inferred). A lumped front-cavity model puts its
  resonance near 10 kHz (inferred), above speech. Second gate if needed: SfePy (BSD-3, pip), which has a perforated
  plate acoustic example.
- **Microphones.** A 0.2 to 0.5 mm unsealed gap behind Ponder's 2 x 2 mm mic port would put a Helmholtz peak at 5 to
  9 kHz (inferred): add a gasket or glue ring. At the 2.5 W cap the speaker reaches the mics about 30 dB above a voice
  at 60 cm (inferred), so push-to-talk with playback muted is the simple answer.
- **Light.** Ponder's light bar has 6.39 mm LED pitch behind 3.5 mm of depth, so hot spots: about 0.56 min/max
  (inferred); pitch equal to depth gives about 0.95.
- **Radio.** Espressif asks for at least 15 mm of clearance "in all directions" around a module's antenna inside the
  housing; it gives no number for metal, and none was found elsewhere. AISLER measured detuning when a printed wall
  is under 3 mm away. So Sprue's keep-out is Espressif's 15 mm applied to metal, which is our choice, and nylon
  screws are the zero-risk fix for Ponder.
- **Heat.** A lumped network for Ponder's head (199 cm2 of shell, about 4.4 K/W, a time constant of about 7 min,
  inferred) puts it near the Pi's 80 C throttle under sustained load; the build plan's 10-minute soak reaches only
  76% of the rise, so make it 30 min. CalculiX only when the margin is under 10 K.
- **What only a lab answers**: CE (RED and EMC) and FCC. Sprue lists them; the Zero 2 W's own compliance documents
  say what its module certification covers.

## Thresholds and where they come from

| Check | Value | Source |
| --- | --- | --- |
| Gap between parts | the design's `minClearanceMm` (0.2 mm on both) | the design; a printed part can be off by about 0.3 mm (`research/testing-plan.md`) |
| Tilt | 10 deg | ours, above IEC 60598-2-4's 6 deg |
| Speaker opening | fail under 20%, noted under 40% | Same Sky |
| Mic port open | 95% of rays | ours |
| Metal near an antenna | 15 mm | Espressif's housing clearance, applied to metal by us |
| Light to its window | 90 to 95% of the cone | ours |

## Tools: what to do with each

| Tool | Licence | Verdict |
| --- | --- | --- |
| tscircuit (core, checks, footprinter, autorouter) | MIT | trial pinned, then decide: adopt only if its boards pass Sprue's read-back, KiCad DRC and firmware gates, route the same twice and keep Gerber X2 attributes |
| Diode `pcb` / Zener | MIT | watch; borrow fail-when-a-rule-can't-run and per-module testbenches |
| atopile | MIT | borrow its toleranced ranges and voltage aliasing, not the tool |
| kicad-happy | MIT | watch, until Sprue writes KiCad files |
| Freerouting | GPL-3 | use as a separate program when Sprue's router fails (needs Java 25; 21 is here) |
| PCBSchemaGen verifier | MIT | adapt its ERC and pin-role layers for boards with ICs |
| SKiDL | MIT | ideas only |
| Arena Physica Heaviside, Atlas | proprietary | watch |
| Quilter, Cadstrom, Flux, JITX, CELUS | proprietary | copy their check lists, nothing else |
| ngspice | BSD core, mixed parts | use, as a program |
| WireViz | GPL-3 | its YAML as Sprue's harness format; the tool only to draw |
| rp2040js | MIT | already used; add a USB HID reader |
| OpenHTF | Apache-2.0 | use for unit 1's bring-up |
| manifold3d | Apache-2.0 | use, for speed |
| MuJoCo | Apache-2.0 | optional dynamic layer |
| openEMS + scikit-rf | GPL-3, BSD | opt-in radio check, as a program |
| SfePy | BSD-3 | second acoustic gate |
| CalculiX | GPL-2 | heat and drop load cases, as a program |
| Adafruit_CAD_Parts, kiswitch, Raspberry Pi STEP | MIT; MIT/CC-BY-SA; unstated | real bought-part geometry |
| PCBWorld, EMVal | non-commercial | skip |
| Tidy3D (Flexcompute) | client LGPL, paid runs | a paid EM cross-check; needs Tobias's OK (it costs credits and uploads designs) |

## Not confirmed

tscircuit's DRC thresholds and whether its Gerbers carry X2 attributes; Diode's install hosts and telemetry; the
Camera Module 3 Wide's horizontal and vertical field of view (Ponder's camera probe is rectilinear at 102 x 67 deg,
109 deg diagonal, against Raspberry Pi's 120 deg diagonal, so the frame's corners see a little more than the probe);
the Zero 2 W's antenna position; whether the Zero 2 W reports under-voltage in `vcgencmd get_throttled` (so the
build plan should rely on a meter); printed PETG's radio transmission.

## Sources

- tscircuit: https://github.com/tscircuit/tscircuit, https://github.com/tscircuit/checks, https://docs.tscircuit.com/command-line/tsci-export
- Diode: https://github.com/diodeinc/pcb, https://blog.diode.computer/anthropic-partnership
- atopile: https://github.com/atopile/atopile
- kicad-happy: https://github.com/aklofas/kicad-happy
- Freerouting: https://github.com/freerouting/freerouting; PCBWorld: https://github.com/LGAI-Research/PCBWorld (arXiv 2607.05915v4, Table 3)
- PCBSchemaGen: https://github.com/HZou9/PCBSchemaGen_v2
- Arena Physica: https://www.arenaphysica.com/publications/heaviside-1, https://huggingface.co/datasets/ArenaPhysica/EMVal, https://runtimewire.com/article/arena-physica-heaviside-microsoft-discovery
- Quilter rules: https://docs.quilter.ai/llms-full.txt; Cadstrom: https://cadstrom.io
- Part data: https://registry.npmjs.org/@tscircuit/props, https://pypi.org/pypi/circuitpython-stubs/json, https://raw.githubusercontent.com/adafruit/circuitpython/main/ports/raspberrypi/boards/seeeduino_xiao_rp2040/pins.c, https://raw.githubusercontent.com/raspberrypi/linux/rpi-6.18.y/arch/arm/boot/dts/overlays/README, https://raw.githubusercontent.com/raspberrypi/utils/master/pinctrl/gpiochip_bcm2835.c
- WireViz: https://github.com/wireviz/WireViz; OpenHTF: https://github.com/google/openhtf; rp2040js: https://github.com/wokwi/rp2040js
- MAX98357A datasheet: https://www.makerguides.com/wp-content/uploads/2026/01/Datasheet_MAX98357A.pdf; WS2812B: https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/8880/WS2812B.pdf
- manifold3d: https://github.com/elalish/manifold; MuJoCo: https://github.com/google-deepmind/mujoco; Assemble-Them-All: https://github.com/yunshengtian/Assemble-Them-All
- IEC 60598-2-4 (preview): https://standards.iteh.ai/catalog/standards/iec/d3b29a26-4f44-4faa-8bc7-7a938494cc87/iec-60598-2-4-2017
- Bought-part geometry: https://github.com/adafruit/Adafruit_CAD_Parts, https://pip.raspberrypi.com/categories/610, https://raw.githubusercontent.com/kiswitch/kiswitch/main/README.md
- Same Sky: https://www.sameskydevices.com/blog/how-to-design-a-micro-speaker-enclosure; speaker: https://www.mouser.com/datasheet/2/334/AS04004PR-R-270443.pdf
- Espressif: https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s2/pcb-layout-design.html
- openEMS: https://github.com/thliebig/openEMS-Project; scikit-rf: https://pypi.org/pypi/scikit-rf/json; SfePy: https://raw.githubusercontent.com/sfepy/sfepy/master/sfepy/examples/acoustics/vibro_acoustic3d.py
- Tidy3D: https://raw.githubusercontent.com/flexcompute/tidy3d/develop/README.md
