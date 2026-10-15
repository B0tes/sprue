<!-- Research for the PCB test step, 2026-10-14: providers (Flux and others), how to prove a board works, and the order hand-off. Nothing was uploaded, quoted or ordered. -->

# PCB stage: providers, proving a board works, and the order hand-off

Date: 2026-10-14. Scope: the reference macropad (61 x 94 mm, 2 layers, 1.6 mm, a Raspberry Pi Pico plus 9 Kailh hot-swap sockets) and the PCB kit in `skills/sprue/pipeline/pcb/`. Nothing was uploaded, quoted, ordered or paid for. Facts come from the research findings as corrected by the fact-check. Items marked "(inferred)" are my own reasoning or arithmetic and are not taken from a source. Line numbers come from the audit snapshot. I re-read the cited parts of `drc.ts`, `rules.ts`, `footprints.ts`, `pcb.ts` and `fresh.ts` in this repo.

## 1. Recommendation

Keep `cad/pcb.mjs` and our kit as the only designer. No hosted AI tool should sit in the automated loop, Flux included. Put the effort into checks that read the files we actually ship, plus a firmware run against the extracted netlist. The stage should end with one zip per fab and an `ORDER.md` that stops before payment.

### The pipeline

| # | Step | What runs | Tool | Blocks the zip? | Works here? |
|---|---|---|---|---|---|
| 1 | Design | `pcb.mjs` builds the board model, the A* router routes, the GND pour fills | our kit (Node) | n/a | Exists |
| 2 | Intent | An intended netlist from `design.json` plus pin-function rules, compared with the drawn nets | new TS module | Yes | No network needed |
| 3 | DRC | Geometry checks plus raster connectivity, with one rule profile per fab | `drc.ts` | Yes | Exists; profiles to add |
| 4 | Footprint tests | Pad and hole coordinates compared with vendored reference numbers, to 0.01 mm | `node:test` | Yes (tests) | No network needed |
| 5 | Independent read-back | Parse the shipped Gerbers and Excellon files, rebuild the copper, extract the netlist (unconnected pads included) and compare it with step 2. Also check that each X2 FileFunction matches its file extension and that there is exactly one closed outline. | gerbonara 1.6.3 + shapely 2.2.0 (Python) | Yes | pip confirmed |
| 6 | Firmware in the loop | Generate `code.py` from `pinMap`. rp2040js runs real CircuitPython 10.3.1 and KMK; each key and each pair of keys must give its own keycode. | rp2040js 1.4.0 | Yes, once built | npm, S3 and git confirmed |
| 7 | KiCad cross-check | KiCad DRC and IPC-D-356 on a `.kicad_pcb` that we write | KiCad 7.0.11 pcbnew (apt) or `kicad/kicad:10.0` (Docker) | No, at first | Partly confirmed |
| 8 | Inspect | `drc.json`, `readback.json`, SVG previews, gerbv PNG, a 1:1 print sheet | ours + gerbv | n/a | gerbv via apt confirmed |
| 9 | Hand off | `pcb/order/<fab>/` with a zip and `ORDER.md` | ours | Stops before ordering | No network needed |

### Does Flux fit?

Not as a pipeline step. Flux's own documentation gives these reasons:
- **Browser-only.** It has no offline version and no REST API, CLI or SDK. The only programmatic interface is the Flux MCP Server (`https://app.flux.ai/mcp`, launched August 2026).
- **The MCP server is limited.** It reads project data (nets, designators, pin maps) and sends prompts to the Flux agent. Agent runs cost ACUs, take minutes, and change only Flux's cloud copy of the design. It documents no Gerber export, no DRC report and no file download.
- **Our board can't get in.** Flux imports netlists only as Cadence EDIF or Altium ASCII schematics, and "Footprints and traces will not be imported." There is no Gerber, KiCad board or layout import, so Flux cannot check what `pcb.mjs` produces.
- **Its documented DRC is thin.** The DRC reference lists 7 checks, mostly connectivity, and none of them is a clearance check. A design-review tutorial says reviews cover "spacing and clearance", but no page gives rule numbers.
- **Agent Mode can order.** It lists "Get PCB and 3D-printing quotes and place orders" with no documented confirmation step. That conflicts with our no-order-without-Tobias rule.
- **Blocked here.** www.flux.ai, docs.flux.ai and app.flux.ai all return CONNECT 403 at the container proxy.

How Flux could still be used, manually and only with Tobias's OK:
- Rebuild the macropad in a Flux trial as a second opinion. The Pro trial needs a card, and Flux's docs conflict on whether a trial converts to a paid plan.
- Or connect the MCP server with an API key that has only the project-read scope and no agent-run scope. That needs app.flux.ai allowlisted first.

### Is this already being done?

Partly, yes:
- Keyboard builders already run ergogen, then Freerouting, then KiCad DRC, then Gerbers. The `ceoloide/ergogen-freerouting` Docker image has 2,714 pulls.
- Hosted AI routers (DeepPCB, Quilter, Flux) do layout, but none of them checks our files.
- Nobody we found checks a design against its intent with an independent read-back plus a firmware run. That part we build ourselves.

### Other providers

- **Routing is not where the macropad can fail.** It has about 10 nets on 2 layers, and our A* router routes it.
- **If future boards get dense:**
  - DeepPCB is the one hosted router with a usable API. Its Apache-2.0 plugin source shows `.kicad_pcb` upload and an `x-deeppcb-api-key` header. It costs $30 per hour, and api.deeppcb.ai is blocked here.
  - Freerouting 2.5.0 is the free local option. It needs Java 25, which apt offers as `openjdk-25-jre-headless`.
  - Either way, our checks stay the final gate.

## 2. Providers compared

"Here" means this container: Node 22, Python 3.13, the proxy as tested on 2026-10-14.

| Provider / tool | What it does | Scriptable headless here? | Cost | Verdict |
|---|---|---|---|---|
| **Flux** | Browser ECAD with an AI agent, auto-layout, Ngspice, real-time DRC; exports Gerber, BOM, PnP, IPC-D-356, STEP | No. MCP reads data and prompts the agent only; no documented export or DRC over MCP; no import of our board or Gerbers; all hosts blocked (403) | Official page shows no prices. TrustRadius lists $50/$100/$250 a month (Explore/Build/Pro) or $40/$80/$200 billed annually, plus ACUs. The per-ACU price is unpublished; the $2.50 figure from ProtoFlow is unreliable | Not in the pipeline. Optional manual second look |
| **DeepPCB** (InstaDeep) | Cloud RL routing, with placement through the API | On paper, yes. REST API at `api.deeppcb.ai/api/v1`, `.kicad_pcb` multipart upload, poll, download (from the plugin source). Hosts blocked. Needs an account | $30 per 1 h, $280 per 10 h, $800 per 30 h. Free 30-minute trial (1 board, 4 layers, 150 airwires) | Only for future dense boards, with our DRC as the gate |
| **Quilter** | Physics-driven RL placement and routing with physics checks; returns native ECAD files | No API in its docs; web app only; hosts blocked | Billed per unrouted pin, no public price. Free tier for academic, personal and eligible small teams (under 10 people, under $50K revenue); free uploads may be used for training | Manual only, Tobias in the loop, future boards |
| **Cadence Allegro X AI, Zuken AIPR, Siemens Fuse, Altium Develop, CircuitMaker** | AI layout inside enterprise or desktop suites | No (desktop or enterprise; CircuitMaker is Windows-only) | Enterprise. Zuken AIPR from about $64K a year | No |
| **JITX** | Python design-as-code with an autorouter | pip installs it, but it needs a running launcher and a sign-in; jitx.com blocked | Free tier requires CERN-OHL and JITX stores the designs | No |
| **atopile** | `.ato` language that compiles to KiCad | 0.15.9 needs Python 3.14 (via uv); part picking needs a sign-in | Free (MIT) | No |
| **Diode pcb / Zener** | Schematic as code, rendered to KiCad | Install script reachable, but its binaries come from a blocked host | Free (MIT) | No; borrow its ideas |
| **tscircuit** | TSX circuits, local autorouter, many exports | Yes, offline via npm | Free (MIT) | Watch, don't adopt: lossy KiCad export (19 parity issues), its DSN fails to parse in Freerouting, routes vary between runs, vias are marginal (0.3 / 0.2 mm) |
| **Ergogen** | Keyboard YAML to `.kicad_pcb`, with a Kailh hot-swap option | Yes, npm | Free | A reference for Kailh pads; it has no Pico footprint |
| **KiCad** (pcbnew, kicad-cli) | Mature DRC, IPC-D-356 and fab export | 7.0.11 via apt (pcbnew Python, no CLI DRC). 10.0.6 via `kicad/kicad:10.0` once dockerd is started | Free (GPL) | Adopt as a non-blocking cross-check |
| **Freerouting 2.5.0** | Specctra DSN to SES autorouter | Yes, jar from Maven Central. Needs Java 25; routed a 3-key test board in 0.83 s with identical output across runs | Free (GPL-3) | Optional when boards outgrow A* |
| **EasyEDA Pro + JLCPCB API** | EDA tool plus ordering API | No. The EasyEDA skill needs the desktop client; the JLCPCB API is an application, gated on order history and volume | EDA free; boards per order | Manual upload only |
| **Trace** (buildwithtrace.com) | AI desktop EDA; `trace-cli` runs DRC | No. The CLI needs a desktop sign-in; host blocked | Free to start, 7-day trial | Watch |
| **CELUS, Circuit Mind, SnapMagic, ProtoFlow** | Schematic front ends and part libraries | No | Various | No layout or verification |
| **Cadstrom, siliXon** | Validation and text-to-PCB startups | No product available | Unknown | No |
| **AllSpice** | Git plus CI Actions for hardware | Hosted; blocked | Not stated | No |
| **gerbonara + shapely** | Gerber, Excellon and IPC-356 parsing; geometry | Yes, pip; 0.24 s on the macropad | Free | **Adopt: read-back gate** |
| **rp2040js + CircuitPython + KMK** | Runs the real firmware against the extracted netlist | Yes: npm, S3 bucket, git clone | Free | **Adopt: firmware gate** |
| **SKiDL** | Netlist as code with ERC | Yes, pip | Free | Optional. Its ERC passed a swapped key-to-GPIO map |
| **gerbv** | Independent Gerber render | Yes, apt | Free | Inspect only |
| **Wokwi CI** | Hosted simulator | No: token required, hosts blocked | 50 free minutes per 30 days | Skip; rp2040js covers it |

## 3. How we prove a board works

These are layered checks in priority order. Each one catches something the layers above it cannot.

**1. Intended netlist and pin functions.** Write the intent from `design.json`, not from `pcb.mjs`:
- Each key's socket A pad connects to exactly one GPIO, and its B pad to GND.
- Each GPIO is used by at most one key.
- No key net touches VBUS, VSYS, 3V3(OUT), 3V3_EN, RUN, ADC_VREF, AGND or GP23 to GP25.
- Every socket pad must have a net.

Compare this with the drawn nets. Today a dead key and a mirrored Pico both pass with 0 errors (section 4).

**2. Our DRC, held to the strictest published fab rule.** Our values against the published 2-layer numbers:

| Rule (mm) | Ours (`rules.ts`) | JLCPCB | PCBWay (Standard) | OSH Park | Aisler HASL |
|---|---|---|---|---|---|
| Trace / space | 0.3 (min 0.25) / 0.2 | 0.10 / 0.10 | 0.1 / 0.1 | 0.1524 / 0.1524 | 0.2 / 0.15 |
| Copper to board edge | 0.5 | 0.2 | 0.25 (Advanced, CNC) | 0.381 | 0.3 |
| Via drill / pad (ring) | 0.4 / 0.8 (0.2) | 0.15 / 0.25 | 0.15 drill | 0.254 drill, 0.127 ring | 0.3 to 0.45 drill, 0.2 ring |
| Plated-hole ring | 0.18 | 0.18 min, 0.25 recommended | 0.15 (Advanced: 0.203 for component holes) | 0.127 | 0.3 (PTH drill at least 0.5) |
| NPTH minimum / to copper | 0.5 / 0.3 | 0.50 / 0.2 | not stated | NPTH handling not documented | 0.5 / 0.25 |
| Hole to hole | 0.45 (warning under 0.5) | 0.45 pad, 0.2 via | 16 mil component, 11 mil via (Advanced) | 5 mil recommended | 0.3 |
| Silk line / text | 0.15 / 1.0 | 0.15 / 1.0 | 0.15 / 0.8 | 0.127 | 0.15 / 0.8 |
| Silk to pad | 0.1 to the mask opening (pad + 0.05), so 0.15 to copper (inferred) | 0.15 | not stated | not stated | 0.125, no silk on pads |
| Outline tolerance | n/a | ±0.2 | ±0.2 CNC | n/a | n/a |

Our rules clear all four fabs, with two exceptions:
- **Silk to pad** sits exactly at JLCPCB's 0.15 mm.
- **The plated-hole ring** of 0.18 mm is under Aisler's 0.3 mm for component PTH. The macropad has no plated component holes (its 18 plated drills are vias with a 0.2 mm ring), so it passes today (inferred from the read-back counts).

Also from KiCad's DRC: each Pico GND pad has one thermal spoke, and KiCad's 2-spoke default flags it at error severity. Give each pad two spokes.

**3. Footprints compared with sources, to 0.01 mm.** Our frame is top view with y up.

| Feature | Reference value | Source | Ours |
|---|---|---|---|
| Pico castellated pads | 3.2 x 1.6 mm at x = ±9.69 (0.8 mm outboard of the ±8.89 rows), 2.54 mm pitch; pad 1 at KiCad (-9.69, -24.13) | KiCad `Module.pretty/RaspberryPi_Pico_SMD` | Match |
| Pico USB-shell holes | NPTH 1.8 at (±2.725, -24) and 1.5 at (±2.425, -20.97) | Raspberry Pi `RPi_Pico_SMD_TH`. KiCad `Common_SMD` uses 2.2 / 1.85 instead | Match (Raspberry Pi's values) |
| Pico through-hole option | 1.6 mm pads, 1.0 mm drill, rows 17.78 apart; GND pads 3, 8, 13, 18, 23, 28, 33, 38 | KiCad `RaspberryPi_Pico_Common_THT` | n/a |
| Pico body | 51 x 21 x 1 mm; 4 x 2.1 mm (±0.05) mounting holes | Pico datasheet | n/a |
| MX centre / pegs | 4.0 mm centre NPTH; 1.7 mm peg NPTH at x = ±5.08 | KiCad `SW_Cherry_MX_1.00u_PCB` (ergogen: 3.9878 / 1.7018) | 4.0 / **1.75** |
| Kailh pins (holes) | A (-3.81, +2.54), B (+2.54, +5.08) | every library checked | Match |
| Kailh socket holes | **Ø3.05 ±0.05** | Kailh CPG151101S11 datasheet, Recommended PCB Layout, page 9/10 | **3.0** (bottom of the tolerance) |
| Kailh SMD pads | 2.55 x 2.50 at (-7.36, +2.54) and (+6.09, +5.08), 3.55 mm from each hole | marbastlib @6b0a9a7, Keebio @1486bef; Kailh drawing scales to about 3.48 to 3.56 mm | Match |
| Kailh SMD pads (other camp) | (-7.085, +2.54) and (+5.842, +5.08) | ai03 @cdbfc72, kiswitch, foostan @1f12004, ergogen 4.2.1 | Documented alternative |

KiCad's official library has no Kailh hot-swap footprint.

Change the socket holes to 3.05 mm and the peg holes to 1.70 mm together:
- Changing only the socket hole cuts the peg-to-socket gap from 0.465 mm to 0.44 mm, which is under our 0.45 mm hole-gap error.
- Changing both keeps the gap at 0.465 mm. Arithmetic: 2.840 - 0.85 - 1.525 (inferred).

**4. Independent read-back of the shipped files.** Run gerbonara and shapely (Python, a different implementation from our JS writer) on the exact files in the zip:
- Rebuild the copper islands per layer and join the layers where a plated drill lands.
- Map **every** pad, unconnected ones included, as its own one-pad net.
- Report OPEN, SHORT and pad-without-copper against the intent from step 1.

The scratch version (a throwaway script during the research) found 33 F.Cu islands, 18 B.Cu islands, 18 plated drills and 10 matching nets, with 0 errors. Fault injection worked: a 0.5 mm B.Cu cut gave 6 OPEN nets, and a sliver from K5.A to K5.B gave SHORT GND/GP6. But it skipped unnetted pads, so a sliver from VBUS through VSYS to GND passed. Our own `drc.ts` already treats an unnetted pad as its own net (`~<pad>`, lines 50 and 233), and the port must do the same.

The read-back also checks the files themselves:
- Parse the Excellon files (our own reader skips them today).
- Each `%TF.FileFunction%` matches its file extension. JLCPCB lets X2 attributes override the filename.
- Exactly one closed outline.
- One drill unit per file.

**5. Firmware in the loop.** Generate `code.py` from `pinMap` (KMK, internal pull-ups). Boot real CircuitPython 10.3.1 and KMK (pinned @8afe569) in rp2040js 1.4.0, and drive each GPIO from the netlist extracted in step 4. Expected: K1 to K9 give keycodes 30 to 38 (KC.N1 to KC.N9); the run took 10 to 12 s. With the shorted netlist, K5 gave no events. Add key pairs, to catch shorts between GPIO nets.

rp2040js needs these workarounds:
- Load a FAT12 CIRCUITPY image at flash offset 0x100000, because it doesn't emulate flash writes.
- Force SIO GPIO_HI_IN bit 1 high, or CircuitPython thinks BOOTSEL is held.
- Resolve pull-ups in the harness, because rp2040js doesn't apply them to inputs.
- Read keycodes from a KMK hook, because there is no USB HID host yet.

**6. Netlist in the files.** Write `board.d356` (IPC-D-356A) with every pad: type 317 through holes, 327 SMD, 367 non-plated holes, and N/C pads. Today's scratch writer omitted the N/C and 367 records, so a fab testing against it would not check that VBUS, VSYS and 3V3 are isolated. Also add `%TO.N/TO.P/TO.C%` attributes to our Gerbers; JLCPCB says netlist attributes improve its short and open checks. Round-trip both through gerbonara.

**7. KiCad cross-check, non-blocking.** Write a `.kicad_pcb` and run KiCad DRC plus `IPC356D_WRITER`, then diff KiCad's `.d356` against ours. In the scratch rebuild, KiCad 7.0.11 found 0 clearance, width, hole, ring or edge violations (plus the starved-thermal finding). Its DRC is not proven as a gate:
- One test flagged a 0.05 mm clearance.
- Another missed overlapping tracks on different nets.

Gate traps found with KiCad 10.0.6:
- A `.kicad_dru` file with one bad layer name or a missing paren is dropped silently, giving 0 violations and exit 0. Add a canary rule that must fire.
- `--refill-zones` without `--save-board`, then exporting without `--check-zones`, produced Gerbers with no pour while DRC passed.
- `--schematic-parity` without a `.kicad_sch` checks nothing and exits 0.

**8. Mechanical and physical.** Compare the placed board (Pico position and rotation, socket holes, outline) with the case CAD, not only the shared params. Before the first order, print the copper 1:1 and lay a real Pico and a real socket on it.

**9. Fab electrical test, as a backstop only.**
- JLCPCB fully tests orders of "no more than 50 pieces" for free. One forum user reports it uses a netlist taken from the Gerbers, which proves only that the Gerbers match themselves.
- PCBWay lists free flying-probe testing; whether it accepts an IPC-356 file is not stated.
- Aisler Smart Test uses IPC-356 but is not offered for Gerber uploads.

SPICE adds nothing for this passive board: a key line rises to VIH in 1.49 µs.

## 4. What our pipeline checks today and the gaps

**Checked today:**
- **Board build** (`board.ts`) rejects:
  - a net naming a missing pad
  - a duplicate ref
  - a rotation that isn't a multiple of 90°
  - a wrong side
  - a second pour on one layer
  - silk text under 1.0 mm
  - a route the router can't find
- **Geometry** (`drc.ts`):
  - copper clearance (0.2 mm) and track width (0.25 mm minimum)
  - copper to edge (0.5 mm)
  - NPTH and footprint keepouts
  - via and plated-hole drill and ring
  - hole to hole (0.45 mm error, 0.5 mm warning) and hole to edge
  - via tenting, mask webs
  - silk width, silk over pads, silk near the edge
- **Raster connectivity** at 0.025 mm per pixel, from the same shapes the Gerber writer prints:
  - every via and plated hole has copper on both layers
  - every pad has copper at its centre
  - shorts, unconnected pads included
  - open nets and single-pad nets
  - islands that touch no pad
  - pour necks under 0.25 mm
- **Writing and gating:**
  - each Gerber is read back by our own reader
  - files are written only with 0 errors
  - a fingerprint of `pcb.mjs`, the kit and `design.json` params is stored
  - the scorer and packager accept only a current, clean zip
  - the rules are frozen
- **Stage-3 checks** from `design.json` params: GPIO count, keys on the PCB, controller zone, USB reach, lid and socket headroom.

The macropad passes with 0 errors and 1 warning: the 0.465 mm gap between a peg hole and a socket hole. The 19 kit tests pass.

**Fault injection results:**

| Fault | Result |
|---|---|
| A track with no net bridging K5.A and K5.B | Caught (clearance) |
| A GPIO track cut, or a ground stub removed | Caught (net not connected) |
| K5.B given no net and no ground stub (a dead key) | **Passes**: an unnetted pad floats by design (`reference/formats.md`) |
| Pico footprint mirrored | **Passes**: K6 would short 3V3(OUT) to GND, K9 would hit 3V3_EN, K7 would hit RUN |
| Kailh pads moved 1 mm out and shrunk to 1 mm square | **Passes** |
| Socket holes drilled 2.5 mm instead of 3.0 | **Passes** |
| Kailh pads mirrored in x | Caught only by accident (keepouts) |

**Gaps, ranked by risk of a board that doesn't work:**

1. **No firmware, and the pin map is never checked against one.** The repo has no `code.py`; `design.json` tells the user to write it. The map comes from sorting the Pico's pads by x, so a "natural" GP2 to GP10 = K1 to K9 keymap scrambles the keys:

   | Key | K1 | K2 | K3 | K4 | K5 | K6 | K7 | K8 | K9 |
   |---|---|---|---|---|---|---|---|---|---|
   | GPIO | GP10 | GP7 | GP4 | GP9 | GP6 | GP3 | GP8 | GP5 | GP2 |

2. **Footprints are trusted, never tested.** A mirrored Pico could damage the regulator, and moved pads pass. The socket holes are 3.0 mm against Kailh's Ø3.05 ±0.05.
3. **No intended netlist and no pin-function check.** A forgotten net (a dead key) or a key on a power or control pin passes, because the netlist is whatever `pcb.mjs` says.
4. **Mechanical fit is checked from params only, with tight margins:**
   - socket holes of Ø3.0 against case bosses of 2.90 to 2.92
   - 0.2 mm lid clearance over the Pico
   - a 0.6 mm web at the USB-shell holes against ±0.2 mm outline tolerance
   - a known overlap between a 5-pin switch's peg and the socket

   Rotating the Pico 180° in code would pass every check. Board and case work out positions with copied formulas (`pcb.mjs` and `_params.py`).
5. **Only our own reader reads the Gerbers back, nothing reads the Excellon files, and there is no independent DRC.**
6. **One fab profile (JLCPCB).** The plated-hole ring sits at JLCPCB's absolute minimum, silk-to-pad sits exactly at its 0.15 mm, and no fab DFM runs before an order.
7. **The tests don't guard the main claims.** No kit test asserts that a short or an open is detected, and none pins footprint coordinates.
8. **Small items:**
   - The fingerprint (`fresh.ts`) skips `design.json`'s slug and assembly text, and `bom.json`.
   - Nothing checks that silk is still legible after clipping.
   - Pico GND pads have one thermal spoke.
   - The Gerbers carry no X2 netlist attributes.

## 5. Implementation plan

Each item is one small PR that can be built and tested headless here. Tags: **[local]** needs nothing new; **[pip ok]**, **[npm ok]**, **[apt ok]**, **[net ok]** were confirmed working in this container; **[needs daemon]** has a caveat.

1. **Footprint fixes and golden tests** [local]
   - `skills/sprue/pipeline/pcb/footprints.ts`:
     - `KAILH.holeMm` 3.0 to 3.05, and `MX.pegHoleMm` 1.75 to 1.70 in the same change (see section 3, step 3).
     - Record a source for every number.
     - Move the Pico and Kailh values out of `estimates` in `design.json`.
   - New `skills/sprue/pipeline/pcb/fixtures/footprint-refs.json`: the reference numbers from section 3, with URLs and commit hashes.
   - New `footprints.test.ts`: fail on any drift over 0.01 mm; assert pad 1 sits at the USB end; assert that a mirrored Pico gives a different pin-function layout.
   - Run `node --test skills/sprue/pipeline/pcb/` and `skills/sprue/bin/sprue pcb macropad`, and check that the peg-gap warning stays at 0.465 mm.

2. **Intent and pin-function check** [local]
   - New `skills/sprue/pipeline/pcb/intent.ts`.
   - Footprints tag pad kinds: Pico `gpio`, `gnd`, `power`, `control`; Kailh `A` and `B` marked must-connect.
   - Build the intended netlist from `design.json` and run the rules in section 3, step 1 as audit errors.
   - Tests in `kit.test.ts`: a dead key, a key on 3V3_EN, two keys on one GPIO and a missing B-to-GND connection each fail.

3. **Kit tests for the main claims** [local]
   - Add a short test (a sliver between nets, and a sliver from an unnetted pad to GND) and an open test (a cut track) to `kit.test.ts`.

4. **Rules: fab profiles and margins** [local]
   - `rules.ts`:
     - Export frozen `FAB_PROFILES` for jlcpcb, pcbway, oshpark and aisler, with the numbers from section 3.
     - `drc.json` lists which profiles the board passes.
     - Keep `RULES` at least as strict as every profile.
     - Split the plated ring into a via ring (0.2) and a component ring (0.3, Aisler).
     - Raise `silkPadGapMm` to 0.15 from the mask opening for margin. Re-run the macropad and accept the extra clipping (inferred to be harmless).
   - Pour code: two thermal spokes per Pico GND pad.

5. **IPC-D-356A writer and X2 netlist attributes** [local]
   - New `skills/sprue/pipeline/pcb/ipc356.ts`: every pad, N/C included, plus 367 NPTH records. Use inches (CUST 0) as KiCad and PCBWay's plugin do (inferred safer choice).
   - `gerber.ts`: add `%TO.N%`, `%TO.P%` and `%TO.C%` on pad flashes and tracks, and `%TD*%` to clear them.
   - `pcb.ts`: also write `pcb/board.json`, a dump of pads, nets, drills and the intent for the read-back.
   - Test: parse back our own file in `kit.test.ts`.

6. **Independent read-back** [pip ok: gerbonara 1.6.3, shapely 2.2.0; needs Python 3.12 or newer]
   - New `skills/sprue/pipeline/pcb/readback.py`, ported from the scratch `gerber_nets.py` with the unnetted-pad fix. It also checks Excellon parsing, X2 FileFunction against the extension, a single closed outline, and the `.d356` round trip. It writes `pcb/readback.json` carrying the same fingerprint.
   - Pin both packages in `skills/sprue/cad/requirements.txt`. Add `Bash(python3 -m pip install gerbonara*)` or the requirements install to `SKILL.md`'s `allowed-tools`.
   - `sprue pcb` stays Node-only, as `CLAUDE.md` says. Run the read-back from `sprue cad`, which already needs Python, and from a new `sprue verify <slug>`. `stages/score.ts` and `sprue package` refuse a zip whose `readback.json` is missing, failing or stale.
   - Self-test: `python3 -I skills/sprue/pipeline/pcb/readback.py products/macropad/pcb --self-test`, which injects a cut, a K5 sliver and a VBUS-VSYS-GND sliver, and expects each to fail.

7. **Generated firmware** [local]
   - `sprue pcb` writes `products/<slug>/firmware/code.py` from `pinMap` (KMK, `KC.N1` to `KC.N9`, pull-ups).
   - Update the assembly step in `design.json` and `build-plan.md` to copy that file plus KMK, instead of "write code.py yourself".

8. **Firmware in the loop** [npm ok: rp2040js 1.4.0; net ok: adafruit-circuit-python.s3.amazonaws.com, raw.githubusercontent.com, git clone of KMK; apt ok: dosfstools, mtools]
   - New `skills/sprue/pipeline/firmware/fil.mjs`, ported from the scratch `fil.mjs`.
   - Cache under `~/.cache/sprue/`: the CircuitPython 10.3.1 UF2 at a pinned URL and sha256 (a 10.4.0 alpha also exists, so pin), KMK @8afe569, and rp2040js installed on demand so the skill keeps no npm dependencies (inferred design).
   - It runs from `sprue verify`, asserts every single key and every pair of keys, and writes `firmware/fil.json`.
   - Later: a small JS FAT12 writer to drop the apt tools, and a USB HID host on rp2040js to read real reports (both inferred, not built).

9. **KiCad cross-check, non-blocking** [apt ok: KiCad 7.0.11 pcbnew; needs daemon: `kicad/kicad:10.0`]
   - New `skills/sprue/pipeline/pcb/kicad.ts` writes a KiCad-7-format `.kicad_pcb` with footprints inline. KiCad 7 can't load the 8.0.9+ library files; KiCad 10 loads older formats.
   - A script runs `pcbnew.WriteDRCReport` and `IPC356D_WRITER`, with the zone fill done after a save and reload (ZONE_FILLER segfaults on an in-memory board), and diffs the result against our `.d356`.
   - For KiCad 10:
     - `kicad-cli pcb drc --refill-zones --save-board --severity-all --format json --exit-code-violations`, with a canary rule.
     - No `--schematic-parity`.
     - Export with `--check-zones`.
     - The image runs as uid 1000.
   - Make it blocking only after it agrees with our DRC on the fault-injected boards.

10. **Order hand-off folder** [local]: see section 6. New `skills/sprue/pipeline/pcb/order.ts`. Use `pcb/order/`, because `fab/` is already the CAD export folder.

11. **Mechanical cross-check** [local, Python already needed]
    - One shared params module for board and case in place of the copied formulas.
    - A test comparing the placed Pico and socket holes with the build123d case geometry.
    - A 1:1 print SVG with a 50 mm scale bar in `previews/`.

## 6. Ordering hand-off

The build stage writes `products/<slug>/pcb/order/` and never calls an upload, quote or payment endpoint.
- The proxy blocks every fab host anyway: oshpark.com, pcbway.com, aisler.net, jlcpcb.com and the others all failed.
- Add a hard denylist in code for PCBWay `PlaceOrder`, `ConfirmOrder`, `PayTGroupOrder`, `CancelOrder` and `CancelTGroupOrder`, and for any JLCPCB order call.
- Each `ORDER.md` ends with: **"STOP: do not upload, quote or pay without Tobias's explicit OK."**

**Shared files in every profile:**
- `README.md`: 61 x 94 mm, 2 layers, 1.6 mm FR-4, 1 oz, minimum features, which fab profiles pass.
- `board.d356`.
- The previews.
- A verification summary from `drc.json`, `readback.json` and `fil.json`. It reads VERIFIED or UNVERIFIED; if UNVERIFIED, no zip is written.

**JLCPCB** (`order/jlcpcb/<slug>-jlcpcb.zip`)
- Files: our current Protel-extension set (`-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`, `-F_Silkscreen.gto`, exactly one outline `-Edge_Cuts.gm1`), plus `-PTH.drl` and `-NPTH.drl`.
  - Excellon in mm with a decimal format, as we already write.
  - X2 attributes on, with FileFunction matching each extension, plus the netlist attributes.
  - No paste layers unless we want assembly.
- `ORDER.md`:
  - Open cart.jlcpcb.com/quote and upload.
  - Check the Gerber viewer.
  - Settings: 2 layers, 1.6 mm, HASL lead-free, green, 5 pcs.
  - Pick **"Review Before Payment"**. JLCPCB recommends "Pay Directly".
  - Optionally upload to jlcdfm.com for its free PDF report.
  - Choose DDP shipping. Since 1 July 2026 the EU charges €3 per HS code plus VAT; IOSS collects only the VAT. Without DDP, DHL charges 2.5% with a €16 minimum to advance the duty.
- Price: "From $2.00 / 5 pcs". The homepage ties that to no board size, so it is unverified for 61 x 94 mm. Shipping to Italy was not obtained.

**PCBWay** (`order/pcbway/<slug>-pcbway.zip`)
- Files: KiCad-style names, as PCBWay's own plugin writes them (Protel extensions off, X2 on). Excellon in inches with PTH and NPTH separate. Include the IPC-D-356 netlist; the plugin ships one.
- `ORDER.md` covers two routes:
  - Manual upload at pcbway.com/orderonline.aspx.
  - An optional push for Tobias to run on his own machine: `curl -F "upload[file]=@macropad-pcbway.zip" -F boardWidth=61 -F boardHeight=94 -F boardLayer=2 https://www.pcbway.com/Common/KiCadUpFile/`. He opens the `redirect` URL from the JSON reply and stops at the cart.
    - This endpoint is undocumented; it is copied from PCBWay's MIT plugin v1.0.5.
    - Whether the server accepts an upload without a login could not be tested.
    - Uploading shares the design with PCBWay.
- Price: "$5/10pcs" (plugin metadata). Customs duty and VAT are not included. Quotes are final only after engineering review.

**Aisler, the default EU fab** (`order/aisler/<slug>-aisler.zip`)
- Files: Aisler's own names: `<slug>.toplayer.ger`, `.bottomlayer.ger`, `.topsoldermask.ger`, `.bottomsoldermask.ger`, `.topsilkscreen.ger`, `.boardoutline.ger`, `.drills_pth.xln` and `.holes_npth.xln`. Excellon in inches 2:4. No other documents inside the zip.
- `ORDER.md`:
  - Log in at aisler.net and drop in the zip.
  - Read the Board Viewer's Processing Notes. Aisler remanufactures for free if the boards don't match what it rendered, provided you checked the render first.
  - Choose HASL Budget, 6 pcs (sold in sets of 3), and stop at checkout.
  - Smart Test, assembly and the CLI push are not available for Gerber uploads.
- Price for 57.3 cm² (inferred arithmetic): €12 + €0.067/cm² x 57.3 x 6 = about **€35.05 net, €42.76 with 22% VAT**; for 3 pcs, about €23.53 net.
  - Aisler's own worked example uses €0.051/cm², which gives about €29.55 for 6.
  - The pricing post dates from 2023, so confirm in the configurator.
  - Shipping is free and untracked, 4 to 14 business days, with VAT collected at checkout and no customs.

**Optional profiles:**
- **OSH Park:** Excellon inches 2:4. Tobias would run `curl -F file=@macropad-oshpark.zip https://oshpark.com/import.json` on his own machine and get back a token and URL; the upload is not tied to an account. Price about $44.44 per 3 boards (8.89 sq in x $5, inferred arithmetic). Its NPTH handling is not documented, and this board depends on NPTH.
- **Eurocircuits:** needs a `.gbrjob`. Electrical test is standard. Price not obtained.

## 7. Sources

**Flux**
- docs.flux.ai/llms.txt; docs.flux.ai/reference/flux-mcp-server.md; flux.ai/p/blog/summer-2026-updates-flux-mcp-server-and-chat-mode
- docs.flux.ai/reference/reference-import-designs.md; docs.flux.ai/tutorials/tutorial-import-part; docs.flux.ai/reference/reference-import-kicad.md
- docs.flux.ai/reference/chat---agent-mode.md; docs.flux.ai/reference/design-rule-check--drc-; docs.flux.ai/tutorials/pcb-design-review.md; docs.flux.ai/tutorials/ai-design-reviews; docs.flux.ai/tutorials/auto-layout.md
- docs.flux.ai/reference/data-portability; docs.flux.ai/reference/gerber-export; docs.flux.ai/Introduction/getting-started-in-flux--export-and-manufacturing.md
- docs.flux.ai/general-support/how-acus-and-on-demand-charges-work.md; docs.flux.ai/faq/pricing.md; flux.ai/p/pricing; trustradius.com/products/flux-ai/pricing; pricingsaas.com/companies/flux
- siliconangle.com/2026/02/27/flux-nabs-37m-automate-printed-circuit-board-development-ai/

**AI and code EDA**
- deeppcb.ai/pricing/; deeppcb.ai/deeppcb-api-your-pcb-design-ai-agent/; raw.githubusercontent.com/instadeepai/deeppcb-kicad-plugin/main/helpers/http_helpers.py
- docs.quilter.ai/llms-full.txt; quilter.ai/free-ai-pcb-design
- pypi.org/project/jitx/; docs.jitx.com/free-tier.html; pypi.org/p/atopile; raw.githubusercontent.com/diodeinc/pcb/main/install.sh
- registry.npmjs.org/@tscircuit/cli; tscircuit.com/seveibar/usbc-pd-charger/blob/TSCIRCUIT_FEEDBACK.md; npmjs.com/package/ergogen
- repo1.maven.org/maven2/app/freerouting/freerouting/2.5.0/; github.com/freerouting/freerouting
- digitalengineering247.com (Zuken AIPR); news.siemens.com/en-us/siemens-fuse-eda-ai-agent/; businesswire.com (Cadence Allegro X AI, Cadstrom); buildwithtrace.com; cdn.jsdelivr.net/gh/easyeda/easyeda-api-skill@main/SKILL.md

**KiCad**
- docs.kicad.org/8.0/en/cli/cli.html; docs.kicad.org/9.0/en/cli/cli.html; docs.kicad.org/10.0/en/cli/cli.html
- dev-docs.kicad.org/en/apis-and-binding/pcbnew/; hub.docker.com/v2/repositories/kicad/kicad/tags
- raw.githubusercontent.com/Cimos/kicad-druid/main/README.md
- Local KiCad DRU, zone-fill and KiCad 7 DRC tests run during the research (throwaway)

**Verification tools**
- pypi.org/project/gerbonara/; pypi.org/project/skidl/
- npmjs.com/package/rp2040js; github.com/wokwi/rp2040js; github.com/KMKfw/kmk_firmware
- adafruit-circuit-python.s3.amazonaws.com/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.1.uf2
- docs.wokwi.com/wokwi-ci/getting-started
- Throwaway research scripts (not kept): `gerber_nets.py`, `fil.mjs`, `kmk_code.py`, `dump-board.ts`, `kicad_check_v2.py`, `skidl_erc.py`

**Footprints**
- Pico datasheet: pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008307-DS-2-pico-datasheet.pdf
- gitlab.com/kicad/libraries/kicad-footprints (`Module.pretty/RaspberryPi_Pico_SMD`, `_Common_THT`, `_Common_SMD`; `Button_Switch_Keyboard.pretty/SW_Cherry_MX_1.00u_PCB`)
- raw.githubusercontent.com/HeadBoffin/RP_Silicon_KiCad/main/KiCadLibraries/MCU_RaspberryPi_and_Boards.pretty/RPi_Pico_SMD_TH.kicad_mod
- raw.githubusercontent.com/keyboardio/keyswitch_documentation/master/datasheets/Kailh/CPG151101S11.pdf
- github.com/ebastler/marbastlib; github.com/keebio/Keebio-Parts.pretty; github.com/ai03-2725/MX_Alps_Hybrid; github.com/foostan/kbd; github.com/kiswitch/keyswitch-kicad-library
- `research/keypad-pcb-footprints.md`

**Fabs**
- JLCPCB: jlcpcb.com/capabilities/pcb-capabilities; jlcpcb.com/help/article/Misidentified-Layers-Why-Not-Follow-Gerber-X2-Standards; jlcpcb.com/help/article/how-to-generate-gerber-and-drill-files-in-kicad-9; jlcpcb.com/help/article/how-do-i-place-an-order; jlcpcb.com/help/article/eu-customs-reform-faq; jlcpcb.com/quote/pcbOrderFaq/Flying%20probe%20test; api.jlcpcb.com/help/article/jlcpcb-online-api-available-now; jlcdfm.com
- PCBWay: pcbway.com/capabilities.html; api-partner.pcbway.com/Help; github.com/pcbway/PCBWay-Plug-in-for-Kicad (v1.0.5 `plugins/thread.py`, `process.py`, `metadata.json`)
- Aisler: community.aisler.net/t/our-simple-pricing; /t/2-layer-1-6-mm-35-m-hasl-design-rules/3735; /t/naming-convention-for-traditional-gerber-files/99; /t/pcb-design-tool-support-matrix/103; /t/rendering-guarantee-for-beautiful-boards/55; /t/introducing-aisler-smart-tests-your-electrical-tests-on-steroids/34
- OSH Park: docs.oshpark.com/tips+tricks/api/; docs.oshpark.com/services/two-layer/; docs.oshpark.com/submitting-orders/drill-specs/
- Eurocircuits: eurocircuits.com/technical-guidelines/pcb-design-guidelines/input-data-formats/
- forum.kicad.info/t/verify-gerbers-with-netlist/35700

**Repo**
- `skills/sprue/pipeline/pcb/rules.ts`, `footprints.ts` (lines 52-68), `drc.ts` (lines 50, 141-161, 206-262), `fresh.ts`, `pcb.ts`
- `skills/sprue/examples/macropad/cad/pcb.mjs`, `design.json` (`pcbWidthMm` 61, `pcbHeightMm` 94)
- `CLAUDE.md` (`fab/` is the CAD export folder; `sprue pcb` uses no Python)