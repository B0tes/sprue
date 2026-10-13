# PLAN

**Idea:** Describe a hardware product in chat and get back a validated, priced bill of materials with real supplier quotes: idea to RFQ.
**Tier:** Build
**Success metric:** The coffee-machine demo BOM is priced end to end with live quotes (target: 8 of 12 lines from real API or scripted quotes), plus 25 waitlist signups.
**Status:** Started 2026-10-13

## Who it is for
A maker or first-time founder with a hardware idea and no sourcing team. Today they spend weeks emailing fabs and
distributors to learn whether the thing costs $80 or $800 to build. We give them the number, and the plan behind it, in an afternoon.

## Scope for v0
- Chat brief in, structured BOM out (part, spec, process, quantity), using an Anatomy-style design step as the front end.
- Each BOM line routed to a quote mode: **API** (documented endpoint), **Scripted** (a few lines against a public
  calculator or catalog), or **Agent RFQ** (a browser or email agent fills the quote form).
- One consolidated package: totals, longest lead time, files per fab, and flags for integration and certification risk.
- Not in v0: ordering, assembly planning, certification work, injection-molded tooling quotes.

## Supplier roadmap (from research/supplier-apis.md, 2026-10-13)
- Now, self-serve: Nexar/Octopart (all distributors in one call), DigiKey v4, Mouser, tscircuit quote API (JLCPCB), Slant 3D, Sculpteo.
- Scripted: OSH Park formula, jlcsearch (LCSC/JLC parts), McMaster public pages.
- Apply for partner access: JLCPCB / JLC3DP pricing API, PCBWay, LCSC, Craftcloud.
- Agent RFQ: Xometry, Protolabs/Hubs, Fictiv, SendCutSend, OSH Cut, RapidDirect, OEM sellers.

## Backlog
Ordered, top item first. Claude picks from the top each run.

- [x] Landing page that explains the idea and collects emails (Supabase table `waitlist`)
- [ ] Deploy landing page to Vercel and connect Supabase (needs repo, Vercel, Supabase access)
- [ ] BOM schema (TypeScript + Supabase tables: projects, bom_lines, quotes) and a JSON version of the coffee-machine BOM
- [ ] Quote adapter interface (`quote(line) -> {price, qty breaks, lead, source, raw}`) with a fixture-based test harness
- [ ] Adapter: Nexar/Octopart for every electronic line (needs Nexar key)
- [ ] Adapter: OSH Park formula + tscircuit/JLCPCB for the control board
- [ ] Adapter: Slant 3D / Sculpteo for printed parts (STL from `cad/`)
- [ ] CAD for the coffee machine parts in `cad/parts/` (hopper, shell, brew chamber, drip tray) so printed/CNC lines have real files
- [ ] Brief-to-BOM: Claude turns a chat brief into the BOM schema, with a constraint pass (power budget, voltages, fit)
- [ ] Agent RFQ prototype: browser agent gets a Xometry or SendCutSend quote from a STEP/DXF
- [ ] Replace illustrative landing-page numbers with live quotes as adapters land
- [ ] Certification flagger: map product traits (mains, water, heat, radio, kids) to likely standards

## Decisions
- 2026-10-13: Demo product is a single-cup grind/weigh/brew coffee machine (Tobias's example). Landing-page prices are illustrative until adapters ship.
- 2026-10-13: Three quote modes (API / Scripted / Agent RFQ). Agents only where no API or calculator exists.
