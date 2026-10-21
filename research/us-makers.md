# US makers that build from a file or spec: merged list, coverage, and APIs vs an agent

Research for Tobias's question of 2026-10-20 (US companies that build from specs or files, coverage of materials and product types, APIs or an agent). The merged list is `us-makers-2026-10-20.csv` beside this note. Nothing was uploaded, quoted or ordered.

## Summary

- **The merged list has 269 rows, one per company** (`us-makers-2026-10-20.csv`). Every row's `source` column holds its URLs.
  - 242 rows are US-based or US-run. 55 of them give the HQ city as unconfirmed or inferred.
  - 23 rows are non-US and labelled `NON-US REFERENCE` in `hq`.
  - 4 rows have an unconfirmed HQ and are labelled `UNCONFIRMED HQ`: Jiga, Vernex, Sewport and Opendesk.
  - Six parallel research passes (by process family) gave 235 entries. Deduping left 188 companies, and I added 81 that the fact-checkers named as missing, after a quick check of each page.
- **Dropped:**
  - Tempo Automation wound down in 2023: staff were cut to 7, the site is now a contact form, and its customers went to Network PCB ([site](https://www.tempoautomation.com/), [Wikipedia](https://en.wikipedia.org/wiki/Tempo_Automation)).
  - Suuchi: suuchi.com now redirects to ignitetech.ai ([suuchi.com](https://www.suuchi.com/)).
- **Merged:**
  - Rapid Sheet Metal into Protolabs; rapidsheetmetal.com redirects to protolabs.com ([link](https://www.rapidsheetmetal.com/)).
  - PCB Trace Technologies into Rush PCB, its parent at the same address ([pcbtrace.com](https://pcbtrace.com/)).
  - JLCPCB, JLC3DP and JLCCNC into one non-US row, and three PCBWay rows into one.
  - Forecast3D becomes ADDMAN Polymer ([addman](https://www.addmangroup.com/forecast3d/)).
  - Pololu's laser service into Pololu, and the Xometry rubber row and the Protolabs LSR row into their main rows.
- **Named by the checkers but left out, because the page could not be read** (robots-blocked, an error, or no content): Midwest Prototyping, ARC Group Worldwide, Albright Technologies, Boca Bearing, Arnold Magnetic, CMS Magnetics, Parker O-Ring & Engineered Seals, Gates, Thorlabs and Rogers Corp.
- **Kept, but `notes` start with `OPERATING UNCLEAR`:** Big Blue Saw (its newest promotion ended April 2020), Rubber Industries, FastCastings, Kinetic Die Casting, Smith Metal Products, Parmatech, Lakeland Plastics, i3D MFG, Advanced Assembly, Accuratus, Laserod, Sewport and Geomiq. OSH Stencils and Opendesk are also only weakly confirmed.
- **API claims corrected:**
  - Xometry's Developer API is for suppliers only. Buyers get CAD add-ins and PunchOut through TradeCentric ([llms.txt](https://developer.xometry.com/llms.txt), [release](https://investors.xometry.com/news-releases/news-release-details/xometry-marketplace-enables-deeper-enterprise-integration-and)).
  - PCBWay's partner API covers bare PCBs only ([api](https://www.pcbway.com/api_cooperation.html)).
  - Sculpteo's API is for partners only ([api](https://pro.sculpteo.com/en/services/api-services/)).
  - Fastenal has a developer portal, but I could not read what is in it ([portal](https://developer.fastenal.com/)).
  - Grainger offers XML/EDI and punchout; a public API is unconfirmed ([eprocurement](https://www.grainger.com/content/eprocurement)).
  - Craftcloud's docs page renders only with JavaScript ([docs](https://api.craftcloud3d.com/docs)).
  - Treatstock's API is public, with keys on request ([docs](https://treatstock.com/help/article/83-api-documentation)).
  - Digital Metal has a public Quoting API and a DFM API ([api](https://www.digitalmetal.io/resources/api)).
- **API counts:** 15 public, 13 partner, 2 unknown and 239 none found. Of the public APIs, 14 belong to US rows.

**Main findings:**
1. **Well covered in the US, with instant quotes:**
   - sheet metal (laser, waterjet, bending), and CNC in aluminium, steel, stainless and brass;
   - FDM, SLA, SLS and MJF printing, and metal printing;
   - injection moulding and urethane casting;
   - PCBs and board assembly;
   - laser-cut plastic and sheet wood, 2D foam, labels and packaging.
2. **Thin and almost always by quote request:** casting, forging, MIM, powder metal, extrusion, thermoforming, rubber and LSR moulding, etching and stamping. Glass, optics, ceramics, cut-and-sew, displays, battery packs and custom magnetics are all quote-by-spec.
3. **Springs, bearings, gears, fasteners, magnets, seals, motors, hinges and gas springs are bought from stock or made to a spec sheet.** Only two places price them instantly: Acxess Spring, from dimensions you type in, and igus, from a CAD upload (igus is German).
4. **Buyer-side APIs exist in a few places:**
   - stock parts: DigiKey, Mouser and Arrow;
   - board assembly: MacroFab, through to payment;
   - harnesses: MiniProto (quote only);
   - FDM printing: Slant 3D;
   - a printing marketplace: Treatstock;
   - investment casting: Digital Metal;
   - sheet metal: Fabworks (quote only) and RMFG (can pay).
   - OSH Park's API only uploads a design.

   None of the big CNC or moulding networks has a buyer API.
5. **The best US in-house shops don't ship to Italy.** SendCutSend, OSH Cut, Fabworks, RMFG, Fictiv and Bolt Depot all stop at North America.
   - US firms that do ship to Italy: Xometry (through Xometry Europe), Protolabs, Ponoko, Pololu, OSH Park, AdvancedPCB, Sierra Circuits (EXW), McMaster (business addresses only), K&J, Apex, Lee Spring, Edmund, Printful and Sticker Mule (plant in Pisa).
   - EU fallbacks: Weerg (Venice), AISLER, Eurocircuits, Shapeways, Sculpteo and Protolabs Network.

**Limits:**
- The shared WebSearch budget (200 calls) was used up before this step, and I did not work around it. Every check here is a direct fetch of a company's own pages, made on 2026-10-20.
- Pages that need JavaScript or block robots stay unconfirmed.
- Nothing was uploaded, quoted or ordered.

## 1. Coverage matrix

The count column shows US makers in the list that take a file, drawing or spec for that row, with the number that quote instantly or by configurator in brackets.
- Counts are keyword matches over the merged rows. The ones marked * were corrected by hand because the match was noisy. Treat every count as approximate.
- "API?" means a buyer-side API for that row.

| Material / process | US makers (instant) | Best 2-3 | API? | Verdict |
|---|---|---|---|---|
| Aluminium | 42 (23) | SendCutSend, Xometry, Protolabs | Fabworks MCP (quote only), RMFG (can pay); Digital Metal for cast A356 | well covered |
| Carbon steel | 30 (17) | SendCutSend, OSH Cut, Xometry | Fabworks, RMFG (steel offered unconfirmed) | well covered |
| Stainless | 31 (18) | SendCutSend, OSH Cut, Protolabs | Digital Metal (cast 17-4, 304) | well covered |
| Titanium | 7 (6) | SendCutSend, Xometry | No | thin |
| Copper, brass, bronze | 18 (12) | SendCutSend, OSH Cut, Xometry | Unconfirmed | well covered |
| Nickel alloys, exotics | ~3* (2) | OSH Cut (nickel 625), Signicast (cast), i3D MFG (printed) | No | thin |
| Tool steel, heat treatment | ~2* (0 with hardening) | OSH Cut (tool steel stock), Canton Drop Forge (heat treatment) | No | gap: hardening is not an orderable option |
| Sheet laser cutting | 25 (14) | SendCutSend, OSH Cut, Fabworks | Fabworks, RMFG | well covered |
| Waterjet | 12 (8) | SendCutSend, Xometry, PartsBadger | No | well covered |
| Plasma, thick plate | 1 (1) | Xometry | No | thin |
| Bending | 26 (13) | SendCutSend, OSH Cut, Approved Sheet Metal | Fabworks, RMFG | well covered |
| Tube cutting and bending | 6 (6) | OSH Cut, LaserBend, Fabworks | Fabworks, RMFG | thin; tube bending is round tube only (OSH Cut) |
| CNC milling | 42 (25) | Xometry, Protolabs, PartsBadger | No (Xometry's API is supplier-side) | well covered, API gap |
| CNC turning, Swiss | 12 (11) | Xometry, PartsBadger, RivCut | No | well covered |
| EDM | ~6* (few) | PartsBadger, Xact EDM, Fotofab | No | covered |
| Photochemical etching | 2* (0) | Fotofab, Tech-Etch | No | thin, RFQ |
| Stamping, fourslide | ~4* (0) | Fotofab, Newcomb Spring, Lee Spring | No | thin, RFQ |
| Welding | 10 (8) | RMFG, LaserBend, eMachineShop | RMFG | covered |
| Finishing (anodise, plate, powder) | 15 (10) | SendCutSend, OSH Cut, Protolabs | Unconfirmed | covered, short menus |
| FDM | 12 (10) | Slant 3D, Makelab, Xometry | Slant 3D API + MCP; Treatstock | well covered |
| SLA, DLP | 11 (10) | Protolabs, Stratasys Direct, Xometry | Treatstock | well covered |
| SLS, MJF, SAF | 11 (10) | Protolabs, Stratasys Direct, ADDMAN Polymer | Treatstock | well covered |
| PolyJet | 9 (8) | Stratasys Direct, ADDMAN Polymer | No | covered |
| Metal printing | 12 (7) | Protolabs, Xometry, Sintavia (RFQ) | No | well covered, no API |
| Laser-cut sheet plastics | 21 (9) | SendCutSend, Ponoko, Canal Plastics | No | well covered |
| Injection moulding | 27 (13) | Protolabs, Xometry, Fathom (ICOMold) | No | well covered, no API |
| LSR, silicone moulding | ~4* (1) | Protolabs, Apple Rubber, Stockwell | No | thin |
| Urethane casting | 20 (13) | Xometry, Fictiv, Prototek | No | well covered |
| Thermoforming | 4* (0) | RapidMade, Redline Plastics, Curbell | No | thin, RFQ only |
| Rotomoulding | 1 (0) | Redline Plastics | No | thin |
| Rubber compression moulding | ~5* (2) | Xometry, eMachineShop, Apple Rubber | No | thin |
| Plastic profile extrusion | 2* (0) | Lakeland Plastics (operating unclear), Xometry RFQ | No | gap |
| Aluminium extrusion | 4* (0) | Profile Precision Extrusions, Minalex, partZpro | No | thin, RFQ; die about $1,250-2,500 |
| Investment casting | ~4* (2) | Digital Metal, Signicast, FastCastings (unclear) | Digital Metal | thin, but has an API |
| Sand casting | ~3* (1) | FastCastings (unclear); Hoosier Pattern and Humtown print moulds only | No | thin |
| Die casting | ~5* (0) | Dynacast, Gibbs, Kinetic Die Casting | No | thin, RFQ |
| MIM | 2* (0) | Smith Metal, Parmatech (both unclear); Indo-MIM (India) quotes instantly | No | thin |
| Powder metal | 2 (0) | Sintergy, Bunting Bearings | No | thin, needs hard tooling |
| Forging | 3* (0) | Canton Drop Forge, Scot Forge, TFG USA | No | thin, RFQ |
| Bare PCBs | 27 (17) | OSH Park, Sierra Circuits, AdvancedPCB | OSH Park (upload only), MacroFab | well covered |
| Flex, rigid-flex | 19 (10) | Sierra Circuits, All Flex, Cirexx | No | covered (OSH Park flex paused) |
| PCB assembly | 20 (15) | MacroFab, Screaming Circuits, CircuitHub | MacroFab (through payment) | well covered |
| SMT stencils | 6 (5) | Stencils Unlimited, StenTech, OSH Stencils | No | covered |
| Wire harnesses | ~5* (1) | MiniProto, Worthington, Epec | MiniProto (quote, no order) | thin, but has an API |
| Membrane keypads | 6* (0) | Butler, JN White, RAFI North America | No | RFQ only |
| Custom LCD / OLED | 3 (0) | Crystalfontz, Newhaven, Focus LCDs | No | spec-only, production MOQ |
| Battery packs | 3 (0) | Epec, BatterySpace, Inventus | No | spec-only |
| Transformers, inductors | 4 (0) | Pactran, L/C Magnetics, Triad | No | spec-only |
| Springs | ~8 to spec (1) | Lee Spring, Century Spring, Acxess Spring | No (McMaster partner API covers stock data) | spec-only |
| Bearings, bushings | 0 custom rolling; 2 bushing makers | stock: McMaster, VXB; bushings: Bunting, igus (DE) | DigiKey, McMaster for stock data | gap for custom rolling bearings |
| Gears | ~5 to spec (0) | Rush Gears, Gear Motions, SDP/SI | No | spec-only; plastic gears can be printed, machined or bought from igus |
| Fasteners | ~3 to print | Fastenal, PEM, MW Components | stock: DigiKey, Mouser; Fastenal portal | stock well covered, custom thin |
| Magnets | 2 (0) | K&J Magnetics, Apex Magnets | No | thin |
| Seals, O-rings, gaskets | ~8* (2) | Apple Rubber, Marco, Global O-Ring; DXF gaskets at SendCutSend | No | covered |
| Motors, actuators | ~4 custom (1) | Lin Engineering, Haydon Kerk Pittman | stock: DigiKey, Mouser | stock well covered, custom thin |
| Linear motion | 8 (5) | Thomson, PBC Linear, MISUMI | No | covered by configurators |
| Hinges, latches | ~2 | Reell, Southco (unconfirmed); Monroe stock | No | thin |
| Gas springs, dampers | 2 | ASRaymond, ACE Controls | No | thin |
| Couplings, pulleys, belts | 8 (3) | Lovejoy, Ruland, B&B Manufacturing | No | covered |
| Cut-and-sew soft goods | 2* (0) | Lefty Production, Case Design; Maker's Row marketplace | Printful only prints on its own blanks | gap |
| Fabric printing | 1 (1) | Spoonflower | No | thin |
| Straps, webbing | 1 | Strapworks | No | thin |
| Foam, 2D cut | ~10* (6) | SendCutSend, MyCaseBuilder, Foam Factory | No | well covered |
| Foam, moulded | 3 (0) | UFP Technologies, Boyd, Stockwell | No | thin, volume RFQ |
| Glass | ~6* (0) | Swift Glass, Abrisa, Technical Glass Products | No | thin, RFQ |
| Optics | ~6* (0) | Edmund Optics, Ross Optical, PG&O | Edmund eProcurement only | spec-only |
| Technical ceramics | 8* (0) | CoorsTek, INSACO, Accuratus | No | RFQ only |
| Carbon fibre, composites | ~10* (3) | SendCutSend (flat CF), Rock West (tube and plate configurators), DragonPlate | No | flat well covered, moulded thin |
| Wood | 7 (5) | SendCutSend, Ponoko, Pololu | No | sheet well covered; solid or 3D carving is a gap |
| Labels, stickers | 16 (10) | Sticker Mule, StickerGiant, OnlineLabels | Sticker Mule (reorders only) | well covered |
| Nameplates, front panels | 6 (3) | Front Panel Express, Metalphoto, Lustre-Cal | No | covered |
| Packaging | ~10* (7) | Packlane, Packola, Arka | No | well covered |
| Enclosures | 19 (11) | Polycase, Front Panel Express; Protocase (Canada) | No | covered |

## 2. Parts a file cannot make: who makes them to spec in the US

For these parts, Sprue should hand over a spec sheet with quantity tiers, plus a PDF drawing where the maker accepts one, instead of a CAD upload. Each company's row in `us-makers-2026-10-20.csv` carries its sources.

| Part | Made to spec in the US (how to ask) | Stock source | Watch out for |
|---|---|---|---|
| Compression, extension, torsion springs | Lee Spring (Brooklyn NY; RFQ with an image or PDF drawing); Century Spring (Commerce CA; RFQ by email, to print, spec or sample); Acxess Spring (Colton CA; instant quote from typed dimensions, 25-25,000 pcs); Newcomb (Alpharetta GA); Vulcan (Telford PA; constant-force); Gardner (Tulsa OK); MW Components (Charlotte NC) | McMaster, Lee Spring, Century Spring | No CAD-to-spring quote exists. Lee Spring has an Italian site and an Italian distributor (Berardi). |
| Wave springs, retaining rings | Smalley (Lake Zurich IL; no tooling cost on custom); Rotor Clip (Somerset NJ) | the same, through distributors | |
| Flat springs, flexures, shims | Fotofab (Chicago); Tech-Etch (Plymouth MA); both photo-etch | | RFQ only |
| Gas springs, dampers | ASRaymond (Maumee OH); ACE Controls (Stabilus; eShop plus custom RFQ) | Monroe Engineering, ACE eShop | |
| Rolling bearings | No US maker to custom spec found. RBC Bearings (Oxford CT) sells through an e-Shop and distributors. | McMaster, VXB, Timken and RBC through distributors, Applied, Motion | Design around stock sizes. |
| Plain bearings, bushings | Bunting Bearings (Holland OH; bronze or powder metal to print); Sintergy (powder metal); igus (Germany; instant quote from a CAD upload) | Bunting, igus | |
| Linear motion | Thomson (online 3D quote tool); PBC Linear, Nook (configurators); MISUMI (configure to order); Roton (stock); Helix Linear (ordering unconfirmed) | MISUMI, McMaster | Machined ends to your drawing mean an RFQ. |
| Metal gears, sprockets, pulleys | Rush Gears (Fort Washington PA; RFQ with file upload; 48 h to 3 weeks); Gear Motions (Syracuse NY); SDP/SI; KHK USA (RFQ); B&B (modifies stock pulleys) | SDP/SI, KHK USA, Boston Gear, Martin Sprocket | |
| Special fasteners, inserts, pins | Fastenal (to print, through a local store); PennEngineering/PEM (modified parts); SPIROL; MW Components | McMaster, Bolt Depot (US/CA/MX only), Micro Fasteners ($20 minimum), Albany County, DigiKey, Mouser | No online upload for cold-headed specials |
| Magnets | K&J Magnetics (Pipersville PA; custom $250 per shape, 7-9 weeks); Apex Magnets (Petersburg WV; custom about $500-1,000, 6-12 weeks, 35% deposit; its custom form takes no file) | K&J, Apex, McMaster | Both ship to Italy. |
| O-rings, seals, moulded rubber | Apple Rubber (Lancaster NY; RFQ with drawing); Marco Sealing (Seabrook NH; shop plus RFQ upload); Global O-Ring (Houston; vulcanised odd sizes); Stockwell (Philadelphia; silicone gaskets); Rubber-Cal | The O-Ring Store, Global O-Ring, Marco, McMaster | SendCutSend cuts flat rubber gaskets from a DXF. Xometry is the only instant quote for moulded rubber. |
| Small motors, steppers, actuators | Lin Engineering (Morgan Hill CA; configurator, two-week prototypes); Haydon Kerk Pittman (AMETEK; store plus custom RFQ) | DigiKey, Mouser, Pololu, ServoCity, Anaheim Automation | Custom windings and shafts are OEM RFQs. |
| Hinges, latches, knobs | Reell (St. Paul MN; torque hinges, ordering unconfirmed); Southco (HQ and ordering unconfirmed); Davies Molding (Carol Stream IL; knobs, distributors plus RFQ) | Monroe Engineering, McMaster | |
| Transformers, inductors | Pactran (Anaheim; quote in 1 day, wound prototype in 2); L/C Magnetics (Anaheim); Triad Magnetics (Perris CA); West Coast Magnetics (HQ unconfirmed) | Coilcraft, DigiKey | Windings have no file format, so these are always spec RFQs. |
| Battery packs | Epec (New Bedford MA; UN38.3 transport testing adds about 8-10 weeks); BatterySpace (Richmond CA; emailed form); Inventus Power | | Shipping lithium packs abroad is restricted. |
| Displays | Crystalfontz (custom only in production volume); Newhaven (Elgin IL; MOQ and NRE in every quote); Focus LCDs (Chandler AZ; samples in 6-7 weeks) | stock modules from the same makers, DigiKey | Prototypes should use stock modules. |
| Membrane keypads, overlays | Butler Technologies, JN White, Dyna-Graphics, RSP, RAFI North America, Nelson Miller | | RFQ only. None of the US makers checked publishes an MOQ. |
| Wire harnesses | MiniProto (Kingston NY; configurator plus API); Worthington Assembly; Epec; Loombotic (Canada; AI prices a drawing) | | MiniProto is the only spec-to-quote API in this section. |

## 3. API vs agent: checked and tightened

**Corrections to the first draft of this section:**
- **It misses five US buyer-side fab APIs that the other research passes found:**
  - RMFG: REST and MCP. It can pay a real order after an opt-in, a saved card and browser consent. It ships to the 48 contiguous states only ([api](https://www.rmfg.com/docs/api), [agent guide](https://www.rmfg.com/docs/api/agent-guide.txt)).
  - Fabworks: an MCP server with 22 tools. It quotes, but checkout and payment stay in the dashboard. It serves the US and Canada only ([mcp](https://www.fabworks.com/resources/developers/mcp)).
  - MacroFab: v2 REST, from upload and quote through order and payment with a saved token ([v2](https://apps.macrofab.com/apidoc/v2/index.html)).
  - MiniProto: anonymous validate and price calls, quotes with OAuth or a B2B key, and MCP. It has no create_order call, by design ([api](https://www.miniproto.com/docs/api)).
  - Digital Metal: Quoting and DFM APIs with self-serve keys ([api](https://www.digitalmetal.io/resources/api)).
- **It also misses distributor APIs:**
  - DigiKey: Quoting and Ordering APIs ([docs](https://developer.digikey.com/documentation)).
  - Mouser: Search, Cart and Order APIs. Search allows 30 calls a minute and 1,000 a day ([api](https://www.mouser.com/en/api-solutions/), [search](https://www.mouser.com/en/api-search/)).
  - Arrow: Pricing and Order APIs by key request; its Quote API is still in development ([developers](https://developers.arrow.com/)).
- **Two of its gap claims are wrong:**
  - "Only Ponoko for US board assembly, no API" is wrong: MacroFab has an API.
  - "No network covers harnesses" is wrong: MiniProto does.
- **Slant 3D:** it also runs a public MCP server that needs no key ([mcp](https://www.slant3d.com/mcp-server)). Quoting starts by uploading the STL. `quote_checkout` returns a payment link, and printing starts only after the customer pays.
- **Shapeways:** the API has no price endpoint, and whether it works today is unconfirmed ([developers](https://developers.shapeways.com/)).
- **The draft's terms-of-service findings stand:**
  - Xometry's Customer Service Agreement: 7.1.2 bans bots, scrapers and avatars; 7.1.1 bans reverse-engineering its pricing; 7.1.3 bans building a competing service ([agreement](https://www.xometry.com/service-agreement/)).
  - Protolabs' Terms 3.3(d) ban automated agents and scripts ([terms](https://www.protolabs.com/legal-notices/)).
  - SendCutSend's terms have no bot clause but bar exploiting the service ([terms](https://sendcutsend.com/terms-of-service/)).
  - The Hubs (Protolabs Network) terms are still unchecked.
- **Hermes Agent: hold off, as the draft says.** Its approvals gate shell commands only. It has no gate for browser actions or payments, and no file-upload tool ([repo](https://github.com/NousResearch/hermes-agent), [security](https://hermes-agent.nousresearch.com/docs/user-guide/security)).

**Which APIs to integrate first.** All of them quote-only and opt-in. Each sits behind `guardNetwork`, with an allowlist of just its quote endpoints and an explicit block on order, cart, checkout and payment paths: Slant `quote_checkout`, MacroFab order calls, RMFG pay, Mouser Cart and Order, DigiKey Ordering, and the Arrow Order API.
1. **Mouser Search, beside the existing DigiKey adapter.** No design leaves the machine, so there is no IP or terms risk. Arrow comes next, after a key request.
2. **MiniProto price snapshots for harnesses.** The calls are anonymous and take a JSON spec, not CAD. This is the lowest-risk fab quote to automate.
3. **Slant 3D quotes for printed parts, for US users.** Each quote uploads the STL, so it needs per-run consent.
   - Treatstock comes second, because it can price by location; delivery to Italy is unconfirmed.
   - Craftcloud stays a scripted rate in `rates.json` until its docs can be read.
4. **Boards:** keep the ORDER.md packages Sprue already writes for JLCPCB, PCBWay, OSH Park and AISLER.
   - Add MacroFab quote calls for US board assembly.
   - Apply for JLCAPI later. It is granted on application and covers PCBs, stencils, 3D printing and components, but not assembly or CNC ([jlcapi](https://api.jlcpcb.com/docs/start)).
5. **Sheet metal for US users:** Fabworks with read-only tools, and RMFG quotes with payment off. Neither ships to Italy.
6. **Castings:** the Digital Metal Quoting API.

**Where a supervised agent fits better.** It fits a fab with no API whose terms allow it.
- Ponoko, Weerg, OSH Cut, PartsBadger and eMachineShop are candidates, but their terms have not been read, so check each first.
- The agent fills the quote form in the user's own browser from the ORDER.md values and stops at the price. The user pays.
- The first draft reported that Claude in Chrome asks before purchases. I did not re-fetch that in this step.
- Never on Protolabs.
- On Xometry only with written permission or partner access.
- For spec-only parts, the agent drafts the RFQ email and packet only, and the user sends it.

**Terms-of-service risk:**
- High: Protolabs (explicit ban) and Xometry (bots and avatars banned).
- Medium: every site whose terms were not read, which is most of the list, Hubs included.
- Low: official APIs used within their documented limits.

Two risks cut across everything:
- Any upload hands the design to a third party, so it needs per-run consent.
- Supplier pages are untrusted input to an agent.

**What Sprue should build first:**
1. **An ORDER.md hand-off for every made part, as PCBs already have, plus an RFQ packet for each spec-only line:** a spec sheet, a PDF drawing and quantity tiers. No network, and no terms risk.
2. **A Mouser adapter next to `pipeline/live/digikey.ts`,** using the same `guardNetwork` pattern.
3. **One opt-in, quote-only fab adapter.** Use MiniProto for products with harnesses, or Slant 3D for printed enclosures. Its live price goes next to the scripted rate.
4. **An eval before any agent touches a real site.** Build a local mock quote form with a file input, a price that recomputes and a checkout. Score the agent on correct fields, the right file, and never submitting.
5. **Ask Xometry and Protolabs in writing for permission or partner access.**

None of this spends money. Any real order, or any upload of a design to a supplier, waits for Tobias's explicit OK.