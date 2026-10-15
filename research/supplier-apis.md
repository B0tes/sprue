# Sprue: Programmatic Supplier Pricing (research as of Oct 2026)

**Tiers.** **A** = instant price by API with a self-serve key. **B** = an API exists but needs partner approval, or the API is undocumented, or a public price formula can be scripted. **C** = a human or browser agent has to use a web upload form or send an email RFQ.
"Verified" means I read the vendor's own page in this session. "Unverified" means it comes from third-party sources or prior knowledge.

## Summary table

| # | Supplier | Category | Official quote API? | Auth / access | Inputs | Typical turnaround | Tier | Docs |
|---|---|---|---|---|---|---|---|---|
| 1 | Nexar (Octopart) | Components (aggregator) | Yes, GraphQL supSearch/supMultiMatch with prices from every distributor | Free account, create an app, OAuth2 client credentials (OAuth unverified). Free "Evaluation" plan has about 100 matched parts, then paid plans | MPN or keyword | Real-time | A | https://nexar.com/api |
| 2 | DigiKey Product Information v4 | Components | Yes, ProductSearch / PricingOptionsByQuantity | Free self-serve developer app, OAuth2 (2- and 3-legged), sandbox available. Rate limits not shown on the page | MPN, DigiKey PN, quantity | Real-time | A | https://developer.digikey.com |
| 3 | Mouser Search API | Components | Yes, up to 4 price breaks plus MOQ | My Mouser account and request form. Key arrives by email, approval appears routine. 30 calls/min, 1,000/day | Keyword or MPN | Real-time | A | https://www.mouser.com/api-hub/ |
| 4 | Arrow | Components | Yes, Search/Pricing API (also MyArrow open APIs) | Request form, then login and key by email ("processed by Arrow team") | MPN | Real-time | A/B | https://developers.arrow.com |
| 5 | LCSC (official) | Components (JLC's parts source) | Yes, search, details with price, cart, shipping cost, ordering | Application form with approval. Default 1,000 searches/day, 200/min | Keyword, LCSC PN | Real-time | B | https://www.lcsc.com/agent , https://lcsc.com/docs |
| 6 | jlcsearch (tscircuit, open source) | JLC/LCSC basic and extended parts | Unofficial JSON (append `.json` to any URL) | None | Category and filter query params | Real-time, stock-focused. Price fields unverified | A (unofficial) | https://jlcsearch.tscircuit.com |
| 7 | JLCPCB | PCB fab, SMT assembly, stencil | Yes. "Pricing API" (general) and "Ordering API" (Gerber upload, auto price, order, tracking) | Partner only. Application reviewed against order history and monthly volume, "not all approved". Email support@jlcpcb.com | Gerber zip plus board params. BOM/CPL for assembly (unverified) | 2-5 days fab plus shipping | B | https://api.jlcpcb.com |
| 8 | tscircuit Order Quote API | PCB plus parts (routes to JLCPCB) | Yes, quote returns component cost, bare PCB cost, shipping, total | Bearer token (tscircuit account). Only vendor today is `jlcpcb` | tscircuit `circuit_json` / package release | Real-time quote | A (via intermediary) | https://docs.tscircuit.com/web-apis/ordering-api |
| 9 | PCBWay | PCB fab (assembly API "under construction") | Yes, quote, order, status | Partner only. Email anson@pcbway.com, reviewed per business | Board params, Gerbers (endpoint details sent privately) | 24h to 5 days plus shipping | B | https://www.pcbway.com/api_cooperation.html |
| 10 | OSH Park | PCB fab (US) | No API | None needed. Price is deterministic: 2L $5/sq in, 4L $10/sq in, 6L $15/sq in, 3 copies. Super Swift costs 2x. Medium run 2L $1 / 4L $2 per sq in (100 sq in minimum) | Board dimensions and layer count | 9-14 days (Super Swift 4-6 business days) | B (formula) | https://docs.oshpark.com/services/ |
| 11 | Aisler | PCB fab/assembly (EU) | No public API. Open-source Ruby pricing lib used internally, undocumented | None | Board size, layers | ~1-2 weeks (unverified) | B (formula/lib) | https://community.aisler.net/t/how-to-use-the-pricing-tool/3249 |
| 12 | Eurocircuits | PCB fab/assembly (EU) | No public API found. Web price calculator works before upload | Web account | Params or data upload | 3-10 working days (unverified) | C | https://www.eurocircuits.com/calculate-prices-prior-to-data-upload-price-calculator-menu/ |
| 13 | Seeed Fusion | PCB/PCBA | No public quote API found (unverified) | Web | Gerber/BOM via web | ~1-2 weeks | C | https://www.seeedstudio.com/fusion.html |
| 14 | MacroFab | PCBA (US) | Web platform with instant quote. Public API unverified (historically had one) | Web account | Gerber, BOM, XYZ | ~2-4 weeks | C (B if API confirmed) | https://www.macrofab.com/how-it-works |
| 15 | Slant 3D | 3D print (FDM print farm) | Yes, `POST https://www.slant3dapi.com/api/slicer` with `{fileURL}` returns price. Also orders and files | Self-serve key (Google login plus credit card on file) in `api-key` header. Endpoint path per a third-party blog | STL URL, material/color | ~1-3 days (unverified) | A | https://api.slant3d.com |
| 16 | Sculpteo (BASF) | 3D print (SLS, MJF, etc.) | Yes, documented web API. `GET /en/api/design/3D/price_by_uuid/` | Account, design must be uploaded first (auth not shown on page). Business continuity unverified | design uuid, qty, scale, unit, material, currency | ~3-10 days | A/B | https://www.sculpteo.com/developer/webapi/order/price/ |
| 17 | Craftcloud (All3DP) | 3D print marketplace (150+ shops), now CNC too | API exists but undocumented publicly. Used by the `cults/all3dp` gem and by the Kiln MCP server's `fulfillment_quote` | Partner/undocumented (no key in the gem) | STL/3MF/OBJ plus material_id | Varies by vendor, ~3-10 days | B | https://github.com/cults/all3dp |
| 18 | JLC3DP | 3D print (SLA, MJF, SLS, metal) | Yes, Pricing API and Ordering API | Partner only, same terms as JLCPCB. support@jlcpcb.com | STL/STEP/OBJ/3MF | ~2-5 days plus shipping | B | https://jlc3dp.com/help/article/jlc3dp-api |
| 19 | Shapeways (relaunched 2024-25) | 3D print | The old 2013 public API is effectively gone. Relaunched company does print-on-demand via Thangs partnership | Partner | Model file | ~1-2 weeks | C | https://www.shapeways.com |
| 20 | Treatstock | 3D print/CNC marketplace | Historically had an embeddable widget and API. Current status unverified (site fetch failed) | Unverified | STL | Varies | C (B if API live) | https://www.treatstock.com |
| 21 | Xometry | CNC, sheet, 3DP, injection molding, urethane | No public quote API found. Instant Quoting Engine is web/CAD-plugin. Enterprise gets punchout and TradeCentric procurement integration | Enterprise/partner | STEP/STL/IGES plus material, finish, qty | Days to weeks | C (B for enterprise) | https://www.xometry.com/xometry-enterprise/xometry-integration-punchout |
| 22 | Protolabs / Protolabs Network (Hubs) | CNC, IM, 3DP, sheet | No public API. Web quoting platform ("ProDesk", AI-assisted) | Web account | STEP | 1 day to 3 weeks | C | https://protolabs.com/help-center/quoting-platform |
| 23 | Fictiv | CNC, IM (instant IM quotes), 3DP | No public API found. Instant web quotes | Web account | STEP | ~1-3 weeks | C | https://www.fictiv.com/articles/instant-injection-molding-quote-online |
| 24 | SendCutSend | Laser/waterjet sheet, bending | No public API (instant web quote. Custom quote by form) | Web | DXF/STEP, material, thickness, qty | 2-5 days | C | https://sendcutsend.com/faq/how-to-get-a-custom-quote/ |
| 25 | OSH Cut | Sheet metal, bending, tube | No public API (instant DFM web quoting. "Enterprise features" page, API unverified) | Web | STEP/DXF | 1-5 days | C | https://oshcut.com/enterprise-features |
| 26 | RapidDirect | CNC, IM, sheet | No public API (instant web quote) | Web | STEP | 1-3 weeks | C | https://www.rapiddirect.com |
| 27 | PCBWay CNC / JLCCNC | CNC, sheet metal | PCBWay API covers PCB only. JLCCNC public API not found (may sit under the JLC partner program, unverified) | Partner | STEP | ~1-2 weeks | C/B | https://jlccnc.com |
| 28 | McMaster-Carr | Off-the-shelf mechanical | Yes, Product Information API with a Price endpoint (amount, min qty, UoM) | Approved customers only. Client certificate plus login gives a 24h bearer token. Products must be "subscribed" first (daily caps). eCommerce@mcmaster.com | McMaster part number | Real-time price, next-day ship (US) | B | https://www.mcmaster.com/help/api |
| 29 | Misumi | Configurable mechanical | No public API found. Third-party scrapers (anysite.io) exist | Web/eProcurement | Configured part number | Real-time on web | C | https://us.misumi-ec.com |

**Injection molding (category 5):** I found no supplier with a self-serve molding quote API. Xometry, Protolabs, Fictiv and RapidDirect all quote instantly on the web from a STEP file, plus material, quantity and finish. For automation, treat them as Tier C with a browser agent. For early budgeting, use a parametric cost model (tooling $3k-$25k plus a per-part cost).

## Takeaways for Sprue's architecture
1. **Electronics BOM is fully Tier A today.** Nexar (one call covers all distributors) plus DigiKey and Mouser as fallbacks. Add jlcsearch for JLC-assembly part selection.
2. **PCB price.** Short term, combine the tscircuit quote API (it routes to JLCPCB), the OSH Park formula, and a reverse-engineered JLCPCB price model. Apply early for JLCPCB, PCBWay and LCSC partner APIs (approval is gated on order volume).
3. **3D printing.** Slant 3D is the only clearly self-serve instant API. Sculpteo is documented. Craftcloud gives the widest price comparison but needs a partnership.
4. **CNC, sheet metal and molding are Tier C.** Use a browser/agent quote worker (upload STEP/DXF to Xometry, SendCutSend, OSH Cut) behind a queue. Show a parametric estimate instantly, then replace it with the real quote within minutes.
5. **Hardware fasteners.** McMaster needs approval. Until then, look prices up by agent or use DigiKey/Mouser, which also stock many standoffs and screws.

## Competitors / adjacent startups
- **Flux.ai**: browser PCB CAD with an AI copilot and live part pricing/stock. Closest to "chat to design a board".
- **Quilter**: physics-driven autonomous PCB layout ($25M Series B, Oct 2025). Does layout, not sourcing.
- **Diode Computers** (YC): AI that designs and validates PCBs for robotics, aerospace and medical. Connects design to sourcing through the **Cofactr** API (Cofactr does sourcing, inventory and kitting).
- **tscircuit**: open-source "PCBs as code" with built-in JLCPCB quote/order API. A potential building block as well as a competitor.
- **CADstrom**: unverified. I couldn't confirm details in this pass.

## Sources
- JLCPCB API: https://api.jlcpcb.com/help/article/jlcpcb-online-api-available-now
- PCBWay API: https://www.pcbway.com/api_cooperation.html
- JLC3DP API: https://jlc3dp.com/help/article/jlc3dp-api
- tscircuit ordering: https://docs.tscircuit.com/web-apis/ordering-api
- Slant 3D pricing example: https://waylonwalker.com/price-an-stl-print-on-slant3d
- Sculpteo price API: https://www.sculpteo.com/developer/webapi/order/price/
- Mouser: https://www.mouser.com/en/apihome/ · Nexar: https://nexar.com/api · LCSC: https://www.lcsc.com/agent
- Arrow: https://learncq.calcuquote.com/supplier-apis-how-to-connect-arrow · https://developers.arrow.com
- McMaster: https://www.mcmaster.com/help/api · OSH Park: https://docs.oshpark.com/services/
- Aisler: https://community.aisler.net/t/how-to-use-the-pricing-tool/3249 · Craftcloud gem: https://github.com/cults/all3dp
- Diode/Cofactr: https://www.cofactr.com/case-studies/how-diode-computers-connected-pcb-design-directly-to-sourcing-with-cofactr
- Quilter Series B: https://www.businesswire.com/news/home/20251007165399/en/
