# Suppliers that make parts from Sprue's own files (checked 2026-10-15, fact-checked 2026-10-15)

## The short version

- **No supplier offers an open API that Sprue can just call.** Every real API needs someone to approve access or issue credentials:
  - **JLCPCB** has a pricing API and an ordering API. The ordering API covers Gerber upload, automatic pricing, ordering and order tracking, for bare PCBs and stencils only. It is meant for partners who "can meet a certain monthly order volume", and "not all applications will be approved" ([JLCPCB API](https://api.jlcpcb.com/help/article/jlcpcb-online-api-available-now)).
  - **PCBWay** has a partner API for PCB quoting, ordering and order status. Its assembly API is "still under construction". You ask for access by emailing anson@pcbway.com, and PCBWay approves it ([PCBWay API](https://www.pcbway.com/api_cooperation.html)).
  - **Sculpteo** has an API covering upload, instant quotes, cart, order and tracking (the docs live under `/en/api/v2/`). It is free for partners, who have to contact Sculpteo to get access ([Sculpteo API](https://www.sculpteo.com/en/services/api-services/)). 3D Prod acquired Sculpteo in May 2026, so this may change (see the 3D printing section).
  - **i.materialise stopped taking orders on 31 Oct 2025.** Accounts became read-only, and Materialise sent users to **Materialise OnSite** ([fabbaloo](https://www.fabbaloo.com/news/i-materialise-to-cease-orders-by-october-31-as-materialise-consolidates-3d-print-services), [help page](https://imaterialise.helpjuice.com/ordering-shipping/my-imaterialise-account)).
    - OnSite documents its own REST API at `api.onsite.materialise.com/v1`: a token from a client ID and secret, model upload, product price, quotations and order placement ([endpoints](https://onsite.helpjuice.com/api-endpoints-)).
    - Ordering through the API "requires invoice payment to be enabled for your account" ([ordering via API](https://onsite.helpjuice.com/en_US/order-submitting-using-api)).
    - How you get a client ID is unconfirmed.
  - **Shapeways** still documents a v1 API with app authorisation and refresh tokens, and says "API access is free". The page has no date, so whether it works since the relaunch after bankruptcy is unconfirmed ([developers.shapeways.com](https://developers.shapeways.com/)).
  - **AISLER** has "Push for CLI" (forum post, 6 Feb 2026). You upload a file with any S3 client (the guide uses s3cmd) to a path that holds your organisation's token, and AISLER creates a project. The page does not say it returns a price ([AISLER forum](https://community.aisler.net/t/quick-and-secure-import-using-aisler-push-for-cli/5527)).
- **Xometry has no public API that I found.**
  - It has CAD add-ins for SolidWorks, Fusion and Onshape. The page lists those CAD programs as free; whether the add-ins themselves are free is not stated clearly ([Xometry](https://xometry.com/cad-add-ins)).
  - Its TradeCentric PunchOut, purchase-order and invoice automation (release dated 15 Sep 2026) is "available now for Xometry customers in the U.S. and expanding to international markets" ([release](https://investors.xometry.com/news-releases/news-release-details/xometry-marketplace-enables-deeper-enterprise-integration-and)).
  - Xometry Europe's own site separately lists an "E-Procurement Integration" ([xometry.eu](https://xometry.eu/en/)). What it covers is unconfirmed.
- **Two candidates cannot ship to Italy, so drop them.**
  - SendCutSend ships to the US and Canada only, "and we cannot make exceptions" ([FAQ](https://sendcutsend.com/faq/can-you-ship-to-countries-outside-of-the-us/)).
  - OSH Cut "currently only ships within the USA" ([capabilities](https://oshcut.com/capabilities)).
- **New EU and Italian import charges make EU suppliers more attractive.**
  - **€3 customs duty (in force).** From 1 July 2026 the EU charges a flat €3 on small parcels worth less than €150 that are "sent directly to consumers in the EU".
    - It is charged on "each different category of item, identified by their tariff sub-headings". One silk blouse and two wool blouses make two categories, so €6.
    - It runs until 1 July 2028 and "may be extended" ([Council, via EACCNY](https://eaccny.com/news/european-council-council-gives-final-green-light-to-new-customs-duty-rules-for-small-parcels/)).
    - VAT is charged on top of it ([beancount summary](https://beancount.io/blog/2026/07/10/eu-de-minimis-exemption-ends-customs-duty-us-sellers-guide)).
    - Secondary sources say the declarant (the seller, importer or IOSS intermediary) owes it, rather than the buyer paying at the door ([Eurofiscalis](https://www.eurofiscalis.com/en/eu-3-euro-customs-duty-small-parcels/)). The Council text does not say.
    - Whether it applies when a company, not a consumer, is the buyer is unconfirmed.
  - **€2 EU Union Handling Fee (expected about 1 Nov 2026).** It is charged per distinct item on business-to-consumer goods from outside the EU, "regardless of the value of the purchase" ([Irish Revenue](https://www.revenue.ie/en/customs/individuals/union-handling-fee/index.aspx)). On 8 Oct 2026 it was still waiting for its final EU review ([Altroconsumo](https://www.altroconsumo.it/soldi/imposte-e-tasse/news/tassa-pacchi)).
  - **Italy's own €2 charge (postponed).** It would be €2 per parcel on non-EU parcels under €150. It has been postponed three times, now to 1 Dec 2026, and whether it will stack with the EU fee is undecided ([Altroconsumo](https://www.altroconsumo.it/soldi/imposte-e-tasse/news/tassa-pacchi)).
  - **JLCPCB's customs page** (updated 9 Sep 2026): on EU orders up to €150, VAT is "collected by JLCPCB" for individual customers and "by local customs" for company customers. "All duties and taxes for international shipments are the responsibility of the customer." The page does not mention the €3 duty or the handling fee ([JLCPCB](https://jlcpcb.com/help/article/customs,-duties-and-taxes)).
  - Who actually collects the €3 (and later the €2) on JLC orders is unconfirmed.

## Platforms that do several processes

| Supplier | Processes and materials | Instant quote from a file | API or scripting | Minimum | Lead time | Ships to Italy from | Sources |
|---|---|---|---|---|---|---|---|
| **Xometry Europe** | CNC (turning, milling, drilling), sheet metal (laser, plasma, waterjet), 3D printing (MJF, FDM, SLS, SLA, DMLS, Carbon DLS, PolyJet), injection moulding, vacuum and die casting, compression and foam moulding, thermoforming | Yes, for STEP, STP, SLDPRT, IPT, 3DXML, PRT and SAT, returning price and delivery time in seconds. PDFs and other files get a manual quote, usually within 24 h. Injection-moulding auto-quote launched in Europe in 2025, per Xometry's Oct 2025 US release | None public. CAD add-ins; an "E-Procurement Integration" is listed (unconfirmed what it covers) | Not stated (unconfirmed). Private individuals can order ("We do work with individuals") | "From 7 days" for prototypes, per a competitor's comparison (MakerVerse, Jul 2026) | Parts are made available EXW Ottobrunn, Germany, unless you specify otherwise. Delivers to the EU, UK, Norway and Switzerland | [FAQ](https://xometry.asia/en/faq) (Xometry Europe's FAQ, served on xometry.asia), [xometry.eu](https://xometry.eu/en/), [IM auto-quote](https://investors.xometry.com/news-releases/news-release-details/xometry-introduces-auto-quote-capability-injection-molding), [MakerVerse comparison](https://www.makerverse.com/resources/best-cnc-machining-services-europe/) |
| **Protolabs** (own factories) | Injection moulding, CNC, 3D printing | Yes, through ProDesk (launched 17 Feb 2026): real-time quotes plus AI design-for-manufacture feedback | None found | Not stated | "In as little as one day" from the UK factory, per a competitor's comparison; Protolabs' own figure was not checked | Factories in Telford (UK) and Putzbrunn (Germany). Italian customers contract with a local entity (PL Euro Service Limited, Novara). Which factory serves Italy, and who pays UK-to-EU duties, is unconfirmed | [ProDesk](https://www.protolabs.com/en-gb/prodesk/), [launch](https://www.barchart.com/story/news/256674/protolabs-introduces-prodesk-an-ai-enabled-manufacturing-platform-to-accelerate-projects-from-prototyping-to-production), [locations](https://www.protolabs.com/en-gb/about-us/locations), [UK/EU contracting](https://www.protolabs.com/en-gb/supporting-our-customers-under-the-new-uk-eu-trade-agreement/) |
| **Protolabs Network** (Hubs until Jan 2024) | CNC, 3D printing, sheet metal, injection moulding, through 250+ partners | Instant "for most orders" in CNC, 3D printing and sheet metal; complex jobs go to "Request a review". Injection moulding is quoted within 48 h | None found | Not stated | Shown in the quote | Price includes shipping, quality control and "customs clearance (in certain regions)". Based in Amsterdam. Which countries it ships to was not on the cited page (unconfirmed) | [ordering](https://www.hubs.com/how-ordering-works/), [quote help](https://www.hubs.com/help-center/how-to-get-a-quote/), [Wikipedia](https://en.wikipedia.org/wiki/Protolabs_Network) |
| **Weerg** (Italy) | 5-axis CNC milling and turning; 3D printing (MJF, FDM, MSLA); laser cutting (aluminium 5754, brass OT63, stainless 304, pickled iron); 50+ materials | Yes, "in a second" from a 3D file, with a fixed price | None mentioned | Not stated; one piece up to 10,000 | CNC "from 1 to 10,000 custom parts in 3 days" (you choose a ship date from 3 days); laser from 3 days. Then 1–2 working days in transit to 98% of European customers (islands +2 days) | Gardigiano di Scorzè (VE), "100% in Italy" | [where](https://www.weerg.com/faq/where-do-you-produce), [what](https://www.weerg.com/faq/what-does-weerg-do), [CNC](https://www.weerg.com/en/global/services/5-axis-cnc-machining), [shipping](https://www.weerg.com/faq/worldwide-shipping), [laser](https://www.weerg.com/laser-cutting), [quantities](https://www.weerg.com/faq/order-prototypes-and-large-runs) |
| **JLCCNC** | CNC milling (3–5 axis), turning and EDM from $5. Sheet metal (laser cutting, bending, punching, welding; aluminium 5052, stainless 201 and 304, cold-rolled and galvanised steel) from $0.40, announced 7 Nov 2025 after a one-month trial. Finishes include anodising and powder coat | The homepage says instant quote from STEP. The ordering guide says CNC files are reviewed in 2–4 h on working days and the quote arrives by email. A sponsored article says final price and lead time "can still be subject to manual review" | JLCPCB's API does not cover CNC | Starting prices above | CNC 3 days, sheet metal 2 days (build time) | China (factory city not named), "180+ countries" | [home](https://jlccnc.com/), [sheet metal](https://jlccnc.com/blog/sheet-metel-online), [ordering](https://jlccnc.com/help/article/how-to-place-cnc-orders), [sponsored comparison](https://3dprintbeginner.com/justway-vs-pcbway-vs-jlcpcb-what-to-use/) |
| **PCBWay** (mechanical parts) | CNC (3, 4 and 5 axis), sheet metal (laser cutting and bending), 3D printing (SLA, DLP, FDM, SLM, SLS, PolyJet), vacuum casting, injection moulding | Instant for about 80% of 3D-printing materials. CNC, sheet metal and moulding: "Final price is subject to our review" | Partner API covers PCBs only | $25 order value, not counting shipping | Fastest SLA lead time "can be within 1 day" | Made in several cities in mainland China, shipped from warehouses in Hangzhou and Shenzhen by DHL, FedEx, UPS, TNT, EMS and others | [FAQ](https://www.pcbway.com/rapid-prototyping/cnc-faq.html), [services](https://www.pcbway.com/rapid-prototyping/) |
| **Fictiv** | CNC, sheet metal, injection moulding, die casting, 3D printing, urethane casting | Instant for standard CNC, 3D printing and injection moulding; complex parts go to an RFQ, "most within 2 business days" | None mentioned | Not stated | CNC "as fast as 2 days" (the same page's header also says "manufactured in one day") | Sites listed: Bay Area and Phoenix (US), Guangzhou (China), Bengaluru and Pune (India), Nuevo León (Mexico); the page does not say which are factories. DDP, with Fictiv as importer of record (launched Aug 2025, per a competitor) | [how it works](https://www.fictiv.com/why-choose-fictiv/how-it-works/), [competitor review](https://www.makerverse.com/resources/makerverse-vs-fictiv/) |
| **MakerVerse** (Berlin) | CNC, 3D printing, sheet metal and more, through a mostly European partner network | Yes "for supported technologies". DXF and DWG are accepted, but an instant quote from a 2D drawing alone is unconfirmed. Manual RFQs answered within 24 h | None; RFQs can come in through ERP integration | **€250 per order, business customers only (VAT ID needed)** | Varies | Partners mainly in Europe; shipping priced at checkout by address | [FAQ](https://www.makerverse.com/faqs/) |
| **Craftcloud** (already in Sprue) | 3D printing and CNC (recently added); nearly 200 partners; 250+ materials (one caption says "nearly 150") | Yes, real-time prices from STL, 3MF, OBJ, STEP or ZIP, no account needed | Its terms say "We provide an API". The open-source [cults/all3dp](https://github.com/cults/all3dp) Ruby gem sends files to Craftcloud and returns a configuration URL. No public docs found (unconfirmed) | Not stated | Shown per offer | Worldwide partners. The price includes regular shipping but "does not include any Customs, Duties, Taxes". The contract is with All3DP GmbH (Munich) | [All3DP, Mar 2026](https://all3dp.com/1/craftcloud-by-all3dp-simply-explained/), [terms](https://craftcloud3d.com/en/p/terms-and-conditions) |

## Sheet metal and metal laser cutting

| Supplier | Processes and materials | Instant quote | API | Minimum | Lead time | Ships to Italy from | Sources |
|---|---|---|---|---|---|---|---|
| **Laserboost** (Spain) | Laser cutting and CNC bending; carbon, galvanised and stainless steel, aluminium, copper, brass; 0.5–15 mm; cuts up to 1500×3000 mm | Yes, from DXF, DWG, SVG, AI, PDF, EPS, STEP or SLDPRT. The quote is valid for one month | None mentioned | None ("No minimum order"; 1 to 10,000+ parts, though one banner says 100,000); orders need no account | Laser-cut orders delivered within 72 h; the exact date is shown after you configure the parts | Madrid and Manresa (Barcelona province). Ships worldwide; DHL is the logistics partner | [home](https://laserboost.com/), [FAQ](https://www.laserboost.com/faq/). Keyboard-plate vendor thread seen in search only: [keebtalk](https://keebtalk.com/t/eu-es-laserboost-perfect-metal-keyboards-layouts-custom-metal-laser-cut-parts/2417) |
| **Fractory** | Laser (sheet and tube), plasma, oxy-fuel, waterjet, punching, bending, CNC milling and turning, welding, surface treatment, casting | Yes. STP, SLDPRT or IPT also price tube, bending and CNC; DXF prices laser cutting only. Some operations are still quoted by hand | None mentioned | Not stated | "Consegna in 9 giorni o meno" (9 days or less) | Partners across Europe; delivers across Italy | [IT page](https://fractory.com/it/preventivo-taglio-laser/) |
| **LaserMio** (Montecchio Maggiore, VI; run by BM Beta Meccanica) | Laser cutting only; S235, pre-painted steel, stainless 304 and 316, aluminium, galvanised, brass, copper, Cor-Ten, up to 10 mm. No bending listed | Yes, from DXF only | None | Not stated | "Consegna in pochi giorni" (a few days) | Italy | [lasermio.com](https://www.lasermio.com/) |
| **Laserbend3D** (Scarpati Inox, Torre Annunziata, NA) | Laser cutting, punching, bending, turning, shearing, milling; iron 0.8–10 mm, stainless 304 0.8–6 mm, stainless 316 0.8–5 mm | Yes, from DXF or STEP (up to 10 MB). IGES, welding and painting are quoted by hand | None | None | From payment: 10–15 working days; express 7–10 (+15%); economy 30 (−30%) | Italy; ships across Italy and the EU | [page](https://laserbend3d.it/taglio-laser-lamiera/) |
| **Weerg**, Xometry EU, Protolabs Network, JLCCNC, PCBWay | See the multi-process table | | | | | | |
| SendCutSend, OSH Cut | US only (SendCutSend: US and Canada); not usable from Italy | | | | | | see the short version |

## PCB fabrication and assembly

| Supplier | What it does | Instant quote | API | Minimum | Lead time | Ships to Italy from | Sources |
|---|---|---|---|---|---|---|---|
| **JLCPCB assembly** (already in Sprue) | Economic and Standard assembly. Economic needs panelising above 30 boards; Standard has "no restriction on quantity". Fees below. Needs Gerbers, a BOM and a placement (CPL) file | Yes, at checkout | Pricing and ordering APIs for PCBs and stencils only, partners only, "not all applications will be approved". Trademark rules apply | The FAQ does not state a board count for assembly | "90% of PCB assembly orders can be finished within 24 hours, 48 hours at most", counted after PCB fabrication | China. VAT handling as in the short version | [price](https://jlcpcb.com/help/article/40-pcb-assembly-price), [FAQ](https://jlcpcb.com/help/article/98-pcb-assembly-faqs) (both updated 9 Sep 2026), [API](https://api.jlcpcb.com/help/article/jlcpcb-online-api-available-now) |
| **PCBWay assembly** | Turnkey, kitted or hybrid assembly | No. The calculator gives an estimate, and the "exact quotation will be updated after all the files you uploaded pass review". PCBWay says assembly quotes are "completed within 1-2 days" | Assembly API "under construction" | Assembly quantity "1 - 10000+" (promotion: $29 for 1–20 pcs). Bare PCB prototypes start at 5 pcs | Assembly turn time "2 days - 3 weeks" | China | [assembly quote](https://www.pcbway.com/quotesmt.aspx?f=fa), [review times](https://www.pcbway.com/helpcenter/checkingorders/How_long_it_will_take_for_order_review.html), [home](https://www.pcbway.com/?from=EH), [API](https://www.pcbway.com/api_cooperation.html) |
| **AISLER** | Bare boards in sets of 3 (from €14.20), assembly from one board, part sourcing. Published formula, e.g. 2-layer HASL Budget: €12 job fee + €0.067/cm² × quantity (Aug 2023 post, may have changed). €15 per component you supply yourself (same post; the assembly page confirms a per-part handling fee but gives no amount) | Yes, on uploading a design | Push for KiCad and Push for CLI (S3 upload). No price returned, per the page | One set of 3 bare boards; one assembled board | Boards in 1 business day. Assembly: "6 business days" on the homepage, but the assembly FAQ says 2-layer "from 9 business days" (Blitz), so check before ordering | "Manufactured and delivered from Europe", **free worldwide shipping** | [home](https://www.aisler.net/?lang=en), [products](https://aisler.net/en-US/products), [assembly](https://aisler.net/products/assembly?lang=en-IT), [pricing](https://community.aisler.net/t/our-simple-pricing/102), [CLI](https://community.aisler.net/t/quick-and-secure-import-using-aisler-push-for-cli/5527) |
| **Eurocircuits** | PCB Proto: 1–5 boards, 2 or 4 layers, bare or assembled (SMT, THT or mixed, one or two sides) | Yes, with the PCB Calculator. More than 200 BOM lines or 1,000 placements gets an engineering quote, usually within 24 h | None found | "No Minimum Order Charge", "No Tooling Charges" | Bare boards 2–3 working days; assembled 6 working days (3 + 3) | Mechelen (Belgium). Dispatched from factories in Hungary and Germany and from Belgium. Assembly in Eger (Hungary) and Aachen, per a 2023 article. Italian sales and support office, per a 2021 article. Shipping is priced by destination country in the Visualizer; the amount for Italy is unconfirmed | [Proto](https://www.eurocircuits.com/pcb-assembly-proto/), [transport](https://www.eurocircuits.com/blog/how-transport-costs-are-calculated/), [overview (2021)](https://www.rs-online.com/designspark/eurocircuit), [sites (2023)](https://circuitsassembly.com/ca/editorial/menu-news/38418-eurocircuits-moving-into-new-hungarian-facility.html) |
| **OSH Park** (already in Sprue) | 2-layer at $5 per square inch per set of 3; 4-layer at $10 per square inch per set of 3 | Yes | None checked | 3 boards | 2-layer 9–12 calendar days; 4-layer 9–14 | Made in the USA, "shipped for free to anywhere in the world". The €3 duty, VAT and, from about 1 Nov 2026, the €2 handling fee apply to consumer orders | [services](https://docs.oshpark.com/services) |

## 3D printing (besides JLC3DP, Craftcloud, Weerg and Xometry)

- **Sculpteo** (Villejuif, France): SLS, MJF, SLA, PolyJet, DLS, DLP/LCD, FDM, DMLS, lost-wax casting and laser cutting. Instant quote, "1-100k parts", and the partner API described above ([site](https://www.sculpteo.com/en/), [API page](https://www.sculpteo.com/en/services/api-services/)).
  - **This may change.** 3D Prod took over Sculpteo, announced in the week of 7 May 2026. TCT calls it a merger and Fabbaloo calls it an acquisition, and Fabbaloo says the plans for Sculpteo are unclear ([TCT](https://www.tctmagazine.com/explained-why-3d-prod-sculpteo-have-merged/), [Fabbaloo](https://www.fabbaloo.com/?p=237277)).
  - Its marketplace for selling design files closed on 4 Nov 2023, but the printing service carried on ([3DPrint.com](https://3dprint.com/304058/basf-to-shut-down-sculpteos-online-3d-printing-marketplace/)).
- **i.materialise has closed to orders.** Since 31 Oct 2025 you can no longer quote or order, and accounts are read-only ([help page](https://imaterialise.helpjuice.com/ordering-shipping/my-imaterialise-account)). Its old API docs and sandbox are still online but no longer lead to an order.
  - The replacement is **Materialise OnSite**: instant quotes from an uploaded file, plus a documented API covering upload, price, quotation and order. A client ID and secret are needed, and ordering through the API needs invoice payment enabled ([how it works](https://onsite.helpjuice.com/en_US/how-it-works), [API endpoints](https://onsite.helpjuice.com/api-endpoints-)).
  - Most orders shipped from Leuven ([help](https://imaterialise.helpjuice.com/where-do-you-ship-from)). OnSite's shipping origin is unconfirmed.
- **Shapeways**: went bankrupt in July 2024. On 2–3 Dec 2024 the management of its Eindhoven factory and two co-founders (Marleen Vogelaar, CEO; Robert Schouwenburg, CTO) bought the assets through Manuevo BV, a subsidiary of WVS International.
  - It runs 12 additive technologies. The marketplace and shops were not restored ([press](https://www.shapeways.com/presscorner/shapeways-comes-home-to-trusted-management-and-founding-visionaries), [TCT](https://www.tctmagazine.com/shapeways-brand-revived-manuevo-acquires-available-assets/)).
  - A comparison reviewed on 11 Aug 2026, published by a competitor, says it is "printing again" with instant per-part pricing ([OpenSpindle](https://openspindle.com/compare/shapeways-alternatives)).
  - Whether the API still works is unconfirmed.

## Injection moulding

Sprue does not need this before there is real volume. When it does, the options are:
- **Protolabs ProDesk**: real-time quotes.
- **Xometry Europe**: auto-quote, available in Europe since 2025.
- **Fictiv**: instant quotes for standard parts, but the parts are made outside the EU.
- **Protolabs Network**: quote within 48 h.
- **PCBWay**: price final only after review.
- **MakerVerse**: RFQ, answered within 24 h.

Sources are in the tables above.

## Acrylic and wood laser cutting

- **3Dline** (Reggio Emilia): 3 mm poplar plywood, 3 mm PMMA (clear, black or opal), 6.5 mm rubber or foam, pieces up to 400×400 mm. Instant quote from DXF only, no minimum, production in 3–5 working days plus shipping by courier ([page](https://stampanti.3dline.it/taglio-laser-online/)).
- **ErreBi Lab** (location unconfirmed): PMMA, polycarbonate, ABS, wood, other plastics, steel up to 1.2 mm. Instant quote, "Worldwide shipping" ([page](https://errebilab.com/en/custom/9-laser-cutting.html)).
- **Het Laser Lokaal** (Wormerveer, NL): plywood, MDF, acrylic, foam, rubber, other plastics, cardboard. Instant price, from one piece. Shipping and taxes are calculated at checkout; delivery to Italy is unconfirmed ([page](https://laserlokaal.nl/en/pages/online-laser-cutting-via-the-laser-room-fast-precise-and-easily-arranged)).
- **Sculpteo** laser cutting: acrylic, plywood, MDF, POM. Automatic quote, "no minimum order quantity" ([page](https://pro.sculpteo.com/en/services/online-lasercutting-service/)).
- **Ponoko**: acrylic, wood, MDF, metals and more. Instant quote, no minimum order quantity; the acrylic page says "from $50 for just 1" ([acrylic](https://ponoko.com/laser-cutting/acrylic)). Ships worldwide "from our making hub in Oakland, California", so US-to-EU duty, VAT and the new handling fee apply ([shipping](https://help.ponoko.com/en/articles/3169188-where-do-you-ship-to)).

## Keycaps, cables and wire harnesses

- **Krome Keycaps** (registered office in London; where it prints is not stated): UV printing on blank PBT OEM 1u keycaps from your own image or SVG.
  - Sold one keycap at a time at £9.60. Mock-up in 1–3 working days, then 5–7 working days to build.
  - **Ships DDP to the EU**, so no customs bill on arrival ([product](https://www.kromekeycaps.com/products/create-your-own-custom-keycap)).
- **Thockfactory**: an online configurator for dye-sublimated PBT keycaps by a German software engineer. First launched in April 2024; version 2.0 went live on 27 June 2025. Location, minimum and shipping are unconfirmed ([keebtalk](https://www.keebtalk.com/t/vendor-thockfactory-an-online-configurator-for-designing-and-ordering-your-own-custom-keycaps/23236)).
- **Cables and harnesses**: NextPCB has an online cable estimator, but "This quote tool generates an estimated price for reference" and the final price is reviewed by sales, who contact you within one working day.
  - Its 11 cable types include D-Sub, IDC and FFC; JST is not mentioned ([NextPCB](https://www.nextpcb.com/cable-assembly-quote)).
  - I found no EU service that quotes custom harnesses instantly.

## What Sprue should add next

1. **Sheet metal (plates, brackets):** add **Laserboost** first. It is in the EU, quotes instantly from DXF or STEP, has no minimum, delivers laser-cut parts within 72 h and does bending. For Italian suppliers, add **Laserbend3D** (bending, ships across Italy and the EU) or **LaserMio** (laser cutting only, DXF). Remove SendCutSend and OSH Cut, which cannot ship to Italy.
2. **CNC:** add **Weerg** as the Italian default. It quotes instantly at a fixed price, ships CNC parts from 3 days, and most European deliveries then take 1–2 working days. Add **Xometry Europe** as the EU fallback, and keep **JLCCNC** as the low-cost option from China (now subject to the €3 duty and, from about November, the €2 handling fee per item on consumer orders).
3. **3D printing:** keep JLC3DP and Craftcloud. Add **Weerg** (MJF made in Italy, so no import charges).
   - If Sprue wants quotes from an API instead of a browser, apply to **Materialise OnSite** (documented upload, price, quotation and order endpoints; ordering by API needs invoice payment) or **Sculpteo** (watch the 3D Prod takeover). Both need credentials from the supplier.
   - Do not apply to i.materialise, which no longer takes orders.
4. **PCB:** keep JLCPCB for price and its instant assembly quote.
   - Add **AISLER** as the EU option: free shipping, no import charges, and scriptable upload through Push for CLI.
   - Add **Eurocircuits** for assembly made in the EU.
   - The JLCPCB and PCBWay APIs probably will not accept a project of Sprue's size, and neither API quotes assembly.
5. **Acrylic or wood panels:** **3Dline** (Italy) for simple 3 mm parts; Het Laser Lokaal or Sculpteo when more materials are needed.
6. **Keycaps:** **Krome** (DDP to the EU), or print them through JLC3DP.
7. **Landed cost:** Sprue's quotes for suppliers outside the EU (JLC, PCBWay, OSH Park, Ponoko, Fictiv) should add €3 per distinct tariff sub-heading on consumer parcels under €150. From about 1 Nov 2026 they should also add €2 per distinct item for the handling fee, and possibly Italy's €2 per parcel if it starts on 1 Dec 2026.

**Quoted only by a person uploading files in a browser:** Xometry, Protolabs, Protolabs Network, Fictiv, MakerVerse, Laserboost, Weerg, Fractory, LaserMio, Laserbend3D, Eurocircuits, Ponoko, 3Dline, ErreBi Lab, Het Laser Lokaal, Krome, NextPCB, JLCCNC, PCBWay's mechanical parts, PCBWay assembly, and JLCPCB assembly (its API covers PCBs and stencils only). For these, Sprue should prepare the files and an upload checklist for each supplier, the way `ORDER.md` already does for each PCB fab.

**Could not confirm:**
- Xometry Europe's minimum order and shipping cost, and what its "E-Procurement Integration" covers
- Which Protolabs factory serves Italy, and who pays UK-to-EU duties
- Which countries Protolabs Network ships to
- Whether the Shapeways API still works
- Whether Craftcloud has public API docs
- How to get Materialise OnSite API credentials, and where OnSite ships from
- AISLER's current prices (the formula comes from a 2023 post) and its current assembly lead time (6 vs 9 business days)
- Who pays the €3 EU duty (and later the €2 handling fee) on JLC orders, and whether either applies when a company is the buyer
- Whether Italy's €2 per-parcel charge starts on 1 Dec 2026 and stacks with the EU fee
- Eurocircuits' shipping cost to Italy
- Where ErreBi Lab is based, and whether Het Laser Lokaal delivers to Italy
- JLCPCB's $3.07 Economic extended-component fee: per order or per unique part

## Fact-check notes

**Corrections made**
1. **i.materialise (major).** The report said to apply for i.materialise's API. In fact i.materialise stopped taking orders on 31 Oct 2025, accounts are read-only, and users were moved to Materialise OnSite. I replaced it with Materialise OnSite, which has its own documented API (`api.onsite.materialise.com/v1`), in the short version, the 3D printing section and recommendation 3. The sandbox claim was true of the old i.materialise docs, but that service is now irrelevant.
2. **EU €3 duty.**
   - The report said "per item" means per tariff heading. The Council says per distinct tariff **sub-heading**.
   - Added that it covers parcels "sent directly to consumers".
   - The end date is 1 July 2028, extendable, rather than "until 2028".
   - Added that secondary sources say the declarant owes it, not the consumer at the door.
   - Replaced the valueaddedresource source with the Council text, because that article says "tariff heading" and does not mention VAT.
3. **JLCPCB assembly fees.**
   - Hand soldering is $3.58 per order labour plus $0.0164 per joint, not "$3.5 plus $0.0173 per joint".
   - The $3.07 extended-component fee is a "feeder loading" fee on Economic. The page does not say "per order", so the unit is marked unconfirmed.
   - Added the Standard double-side setup fee ($51.12).
4. **PCBWay assembly.** This is now sourced from PCBWay itself instead of a third-party skill:
   - Quantity is 1–10,000+, not a minimum of 5. The minimum of 5 applies to bare prototype PCBs.
   - The quote is an estimate that is "completed within 1-2 days" after review.
   - Turn time is 2 days to 3 weeks, with a $29 promotion for 1–20 pcs.
   - The 2020 Elektor article actually says "instant online quotes", which contradicts the report. I dropped it as outdated.
5. **NextPCB.** The report said a salesperson "confirms" the price within one working day. The page says a rep "will contact" you within one working day, and the final price comes after review. D-Sub, IDC and FFC are cable types (11 types in all), not connector types.
6. **Weerg.**
   - The report gave CNC as "a few days". The CNC page says "in 3 days" (ship date from 3 days).
   - The recommendation said "1–2 day delivery", which conflated transit with lead time. The 1–2 days is transit after dispatch, for 98% of European customers.
7. **Xometry.**
   - The PunchOut release is dated 15 Sep 2026 and covers TradeCentric PunchOut, PO and invoice automation. It is available in the US and "expanding to international markets", so "US-only" is too strong.
   - Xometry Europe's site lists an "E-Procurement Integration".
   - Whether the CAD add-ins are free is not clearly stated (the "free" label is for the CAD software).
   - The cited "EU release" (xometry.eu/?p=173724) is a January 2023 UK-launch release and does not support the injection-moulding claim. I relabelled it, and the IM auto-quote claim now rests on Xometry's 23 Oct 2025 release.
   - Format list corrected to STEP, STP, SLDPRT, IPT, 3DXML, PRT, SAT.
8. **Protolabs Network.** "Ships to most places in Europe" is not on the cited page, so it is now unconfirmed. Instant quoting is "for most orders", and complex jobs go to manual review.
9. **Protolabs.**
   - "As fast as 1 day" for CNC came only from a competitor (MakerVerse: "from its UK factory in as little as one day"), so I attributed it.
   - Added that Italian customers contract with an Italian Protolabs entity.
   - ProDesk's quotes are described as AI-generated in the launch release; the ProDesk page itself credits AI only for the design-for-manufacture analysis.
10. **MakerVerse.** "Including quotes from 2D drawings" is not supported. The FAQ accepts DXF and DWG but does not say a 2D-only file gets an instant quote, so it is marked unconfirmed.
11. **PCBWay mechanical.** "Fastest SLA ships in 1 day" should be lead time "can be within 1 day". Parts are made in several Chinese cities and shipped from Hangzhou and Shenzhen warehouses, and the list of carriers is longer.
12. **Fictiv.** Listed the actual sites (Bay Area, Phoenix, Guangzhou, Bengaluru, Pune, Nuevo León) and noted the page does not say which are factories. Noted that the same page also claims CNC "manufactured in one day".
13. **Craftcloud.** "About 200 partners" should be "nearly 200". Added ZIP to the formats and the note that CNC was added recently. Confirmed that the terms mention an API and that the cults/all3dp Ruby gem exists.
14. **Sculpteo.** The API page does not name "v2" (only the docs URL contains it). 3D Prod's deal was announced the week of 7 May 2026 and is reported as both a merger (TCT) and an acquisition (Fabbaloo). The marketplace closure date is 4 Nov 2023.
15. **Shapeways.** The buyers were the Eindhoven factory management plus two co-founders, through Manuevo BV (a subsidiary of WVS International), not "under its founders". The OpenSpindle comparison is published by a competitor.
16. **AISLER.**
    - "Sets of 3" and the €15 customer-supplied-component fee are confirmed by the community pricing post. The homepage confirms only "from €14.20".
    - The assembly lead time is inconsistent: 6 business days on the homepage, "from 9 business days" in the assembly FAQ.
17. **Laserboost.**
    - Locations are Madrid and Manresa (Barcelona province).
    - The quantity range is given inconsistently on the site (10,000 vs 100,000).
    - The site says delivered within 72 h, while the report said "shipping in 72 h".
    - DHL is named as the logistics partner, not specifically as the worldwide carrier.
18. **Laserbend3D.** Added the stainless 316 thickness (0.8–5 mm), milling, and that IGES files are quoted by hand.
19. **Eurocircuits.** Shipping is priced by destination and dispatched from Hungary, Germany and Belgium. The Italian office claim comes from a 2021 article.
20. **OSH Park.** Added the 4-layer lead time (9–14 days) and "per set of 3" for the 4-layer price.
21. **Krome.** The London address is a registered office; the production location is not stated.
22. **Thockfactory.** First launched April 2024; v2.0 relaunched 27 June 2025.
23. **JLCCNC.** The 7 Nov 2025 date is the newsroom post date, after a one-month trial. The help article says the CNC quote arrives by email after a 2–4 h file review.

**Items added (missing from the report)**
1. Materialise OnSite API, which replaces i.materialise: https://onsite.helpjuice.com/api-endpoints-
2. EU Union Handling Fee: €2 per distinct item on business-to-consumer goods from outside the EU, any value, expected about 1 Nov 2026 and still pending final EU review on 8 Oct 2026: https://www.revenue.ie/en/customs/individuals/union-handling-fee/index.aspx
3. Italy's national €2 per-parcel charge on non-EU parcels under €150, postponed three times to 1 Dec 2026; whether it stacks with the EU fee is undecided: https://www.altroconsumo.it/soldi/imposte-e-tasse/news/tassa-pacchi
4. Protolabs: Italian customers contract with a local Italian entity after Brexit: https://www.protolabs.com/en-gb/supporting-our-customers-under-the-new-uk-eu-trade-agreement/
5. PCBWay's own assembly terms (quantity from 1, quote review 1–2 days), replacing the third-party skill as the source: https://www.pcbway.com/helpcenter/checkingorders/How_long_it_will_take_for_order_review.html

**Claims I could not confirm (left in, marked)**
- Whether the Shapeways v1 API still works
- Craftcloud public API docs
- Xometry Europe's minimum order, shipping cost and e-procurement details
- Which Protolabs factory serves Italy, and the duty treatment
- Protolabs Network's shipping countries
- AISLER's current prices and assembly lead time
- Who pays the €3 duty and the €2 fee on JLC orders, and whether they apply to company buyers
- Whether Italy's €2 charge will start
- The unit of JLCPCB's $3.07 extended-component fee
- ErreBi Lab's location; Het Laser Lokaal's delivery to Italy; Thockfactory's location, minimum and shipping
- How to get Materialise OnSite API credentials, and where OnSite ships from
- Eurocircuits' shipping cost to Italy
- The keebtalk Laserboost thread (seen in search only, not opened)

**Confirmed without change**
- JLCPCB API scope and trademark rules
- PCBWay API and the email approval process
- Sculpteo API being free for partners
- The AISLER Push for CLI mechanics
- SendCutSend and OSH Cut shipping limits
- JLCPCB's customs page (updated 9 Sep 2026)
- Xometry Europe: EXW Ottobrunn, EU/UK/NO/CH delivery, private buyers allowed
- ProDesk launch date (17 Feb 2026) and the Protolabs factory locations
- Hubs renamed in Jan 2024, Amsterdam, 250+ partners; IM quote within 48 h; price includes shipping and customs clearance in some regions
- Weerg: location, 100% Italian production, laser materials
- JLCCNC starting prices, build times, 180+ countries
- PCBWay's $25 minimum
- Fictiv: DDP and importer of record, RFQs within about 2 days
- MakerVerse: €250 minimum and VAT ID
- Craftcloud: terms with All3DP GmbH, shipping included, duties excluded
- Fractory, LaserMio and 3Dline details
- Eurocircuits Proto specs
- OSH Park 2-layer pricing and free shipping
- Sculpteo laser cutting
- Ponoko's price and shipping from Oakland
- Krome's price, timings and DDP