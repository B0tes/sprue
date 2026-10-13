# PLAN

**Idea:** Describe a hardware product in chat and get back a validated, priced bill of materials with real supplier quotes: idea to RFQ.
**Tier:** Build
**Success metric:** The pipeline takes "a 3×3 USB macro keypad" from one chat message to a build plan that scores against a known-good keypad (see `docs/pipeline.md`): 90% BOM coverage, zero failed checks, cost within ±25%, fab-ready files.
**Status:** Building rung 1 (macro keypad)

## Who it is for
A maker or first-time founder with a hardware idea and no sourcing team. Today they spend weeks emailing fabs and
distributors to learn whether the thing costs $80 or $800 to build. We give them the number, and the plan behind it, in an afternoon.

## Scope for v0
The seven-stage pipeline in `docs/pipeline.md` (request, design, decompose, engineer check, source, quote, build plan),
run end to end on simple products that already exist and work, climbing the reference ladder one rung at a time.
Not in v0: ordering, physical builds, injection-molded tooling, certification work (flagged only).

## Supplier roadmap (from research/supplier-apis.md, 2026-10-13)
- Electronic parts: DigiKey API v4 first (Nexar dropped, Tobias found it unreliable), Mouser as second source, jlcsearch (no key) for JLCPCB/LCSC assembly parts.
- PCBs: OSH Park price formula and tscircuit's JLCPCB quote API. Apply for JLCPCB and PCBWay partner APIs.
- 3D prints: Slant 3D and Sculpteo APIs.
- CNC, sheet metal, OEM parts: agent RFQ (Xometry, SendCutSend, Protolabs and others have no public quote API).

## Backlog
Ordered, top item first. Claude picks from the top each run. Each item is one small PR.

**Rung 1: 3×3 USB macro keypad**
Run 1 score (2026-10-13): coverage 100%, 0 failed checks, cost $109.75 vs $55-80 reference (+63%), files 2/3 (no Gerbers). Not passing yet.
- [ ] Cut cost: drop the 100-pack of inserts (self-tapping M3 into printed bosses), and buy from fewer shops; shipping is $43 of $110
- [ ] Stage 1 PCB: keypad PCB as code, Gerber export (last missing file)
- [x] Landing page that explains the idea and collects emails (Supabase table `waitlist`)
- [x] Stage contracts: TypeScript types for every stage file (`src/pipeline/types.ts`)
- [x] Reference: known-good keypad roles and cost band in `products/macropad/reference/` (the answer key)
- [x] Scorer: compares a pipeline run to the reference (coverage, checks, cost, files)
- [ ] Stage 0+1: request parser and design stage (Anatomy skill as stage 1; until it's in the repo, a Claude prompt that writes `design.md`)
- [x] Stage 2: design to `bom.json` (written by Claude for the keypad)
- [x] Stage 1 CAD: parametric keypad case and plate in `cad/parts/` (build123d), reading `design.json`
- [ ] Stage 1 PCB: keypad PCB as code (tscircuit or KiCad via script), Gerber export
- [x] Stage 3: 13 engineer checks (power, GPIO, MX plate, PCB and case fit, USB reach, screws, standards)
- [x] Stage 4: sourcing from a snapshot catalog of real product pages (supplier APIs are blocked from this environment)
- [ ] Stage 4: live DigiKey adapter, run as a GitHub Actions job (`quote.yml`, secrets DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET) because the Claude session environment blocks supplier hosts; the job commits refreshed offers to `catalog.json`. jlcsearch search proved unreliable
- [x] Stage 5: quotes with pack rounding, shipping per shop and shop consolidation; OSH Park and JLCPCB rules; print estimate
- [ ] Stage 5: real print quote (Slant 3D API key) to replace the per-cm3 estimate
- [x] Stage 6: build plan writer (`products/macropad/build-plan.md`)
- [ ] End-to-end run + score, shown as a live example on the landing page in place of the illustrative coffee machine

**Later rungs:** USB-C desk lamp, kitchen scale, self-watering planter, coffee machine (see `docs/pipeline.md`).

- [ ] Deploy landing page to Vercel and connect Supabase (blocked on environment network settings)

## Decisions
- 2026-10-13: Tobias: focus on getting Anatomy right. Start with simple hardware that already has known solutions, run the full pipeline end to end, split it into stages with the Anatomy skill first, then iterate. First reference product: 3×3 USB macro keypad.
- 2026-10-13: Demo product is a single-cup grind/weigh/brew coffee machine (Tobias's example). Landing-page prices are illustrative until adapters ship.
- 2026-10-13: Three quote modes (API / Scripted / Agent RFQ). Agents only where no API or calculator exists.
