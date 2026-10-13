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
- [x] Landing page that explains the idea and collects emails (Supabase table `waitlist`)
- [ ] Stage contracts: TypeScript types + JSON schemas for request, bom, checks, sourcing, quotes (`src/pipeline/`)
- [ ] Reference: hand-written known-good keypad BOM and cost in `products/macropad/reference/` (the answer key)
- [ ] Scorer: compares a pipeline run to the reference (coverage, checks, cost, files)
- [x] Vendor the Anatomy skill into `.claude/skills/anatomy/` as stage 1
- [ ] Stage 0+1: request parser, then Anatomy figure of the real keypad (Figure size, exploded, true dimensions) + `design.md` with the grouped parts list
- [ ] Stage 2: design to `bom.json`
- [ ] Stage 1 CAD: parametric keypad case and plate in `cad/parts/` (build123d), STL export
- [ ] Stage 1 PCB: keypad PCB as code (tscircuit or KiCad via script), Gerber export
- [ ] Stage 3: engineer checks (USB power budget, GPIO count vs keys, switch footprint vs plate cutouts, case fit)
- [ ] Stage 4: sourcing via jlcsearch (no key), then DigiKey (needs key)
- [ ] Stage 5: quotes via OSH Park formula, tscircuit/JLCPCB, Slant 3D
- [ ] Stage 6: build plan writer (assembly steps, firmware, test plan, totals)
- [ ] End-to-end run + score, shown as a live example on the landing page in place of the illustrative coffee machine

**Later rungs:** USB-C desk lamp, kitchen scale, self-watering planter, coffee machine (see `docs/pipeline.md`).

- [ ] Deploy landing page to Vercel and connect Supabase (blocked on environment network settings)

## Decisions
- 2026-10-13: Stage 1 uses the Anatomy skill (wheresryan22/anatomy, MIT) to draw the real product exploded at true size; its parts list seeds the BOM. CAD code stays the manufacturing source of truth.
- 2026-10-13: Tobias: focus on getting Anatomy right. Start with simple hardware that already has known solutions, run the full pipeline end to end, split it into stages with the Anatomy skill first, then iterate. First reference product: 3×3 USB macro keypad.
- 2026-10-13: Demo product is a single-cup grind/weigh/brew coffee machine (Tobias's example). Landing-page prices are illustrative until adapters ship.
- 2026-10-13: Three quote modes (API / Scripted / Agent RFQ). Agents only where no API or calculator exists.
