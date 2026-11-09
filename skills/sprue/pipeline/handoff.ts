// The made parts' hand-off: `sprue handoff <slug>` writes products/<slug>/fab/order/, for a person to order each
// printed, CNC-machined and sheet-metal part by hand, as pcb/order/ does for the board (pcb/order.ts):
//   README.md                  the parts, what was checked first, which parts share a cart, each cart in euros landed
//                              in Italy, and what is not here
//   order.json                 {"written": "YYYY-MM-DD", "files": {"<path in order/>": "<sha256>", ...}}
//   <id>.svg                   previews/<stem>.svg, as sprue cad drew it (a picture, not to scale: never uploaded)
//   <id>/<slug>-<stem>.stl     a print: the one file to upload, fab/<stem>.stl byte for byte
//   <id>/<slug>-<stem>.step    a CNC or sheet-metal part: the one file to upload, fab/<stem>.step byte for byte
//   <id>/ORDER.md              what to choose, what the shop's viewer should show, what Sprue checked and did not,
//                              Sprue's price (or why there is none), its cart in euros landed in Italy (at fx.json's
//                              ECB rate, with the EU's charges on a parcel from outside it: landed.ts), the shops with
//                              a person's steps to the cart, and last the STOP line
// It is written only while no check fails, each part file is the export of cad/ as it is now (and its STL one closed
// body of the volume its line prices), the whole product passes its check and quotes.json is of the files as they
// are (handoffProblems); a line with no price is handed off all the same, marked so, since its ORDER.md is how it gets
// one. The folder is written whole or not at all. It is out of date once the folder Sprue would write now differs
// from it, or a file in it changed (handoffStaleness): `sprue status`, `score`, `package` and `all` remove it then,
// and `sprue cad` always does. Nothing here uploads, quotes or orders: every shop's host is refused by guardNetwork
// (pcb/order.ts FAB_HOSTS), and each ORDER.md's steps are for a person, after the user's own OK.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homePinned, type FabRates } from "./adapters/fab.ts";
import { loadRates } from "./explore.ts";
import { bomShapeProblems, gateProblems, meshProblem, quoteFreshness, wholeProduct } from "./gates.ts";
import { batchNeed, errorText, inProduct, usd } from "./io.ts";
import { limitsOf, printedInMetal } from "./limits.ts";
import { STOP } from "./pcb/order.ts";
import { printProcess } from "./stages/check.ts";
import { whyUnpriced } from "./stages/quote.ts";
import { BAD_ID, countGaps, exportOf, handoffLines, ID, specGaps, splitOf } from "./handoff-line.ts";
import { cartsOf, cents, FX_OLD_DAYS, fxAge, ITALY, landed, loadFx, NEAR_EUR, toEur, type Fx, type Landed } from "./landed.ts";
import { exportStale, meshAudit } from "./stages/score.ts";
import type { Bom, BomLine, Check, Checks, Design, QuoteLine, Quotes, Request } from "./types.ts";

/** fab/order/, the folder the hand-off writes. */
export const HANDOFF_DIR = "order";
/** When the shops' pages below were read (the supplier survey of 2026-11-07), unless a source says otherwise. */
export const READ = "2026-11-07";

/** How a made line is made, as the shops sort it. */
export type Kind = "plastic" | "metal" | "cnc" | "sheet";
export const kindOf = (l: BomLine): Kind =>
  l.process === "cnc" ? "cnc" : l.process === "sheet" ? "sheet" : printedInMetal(l) ? "metal" : "plastic";
const MADE_BY: Record<Kind, string> = { plastic: "3D print", metal: "3D print in metal", cnc: "CNC machining", sheet: "Sheet metal" };

/** The lines handed off: each printed, CNC or sheet-metal part, but the board's (whose is pcb/order/). */
export { handoffLines } from "./handoff-line.ts";

// ---- the shops ------------------------------------------------------------------------------------------------

/** A page a fact was read on, and when; `note` says what it is cited for, where the page says more than that. */
export type Source = { url: string; read: string; note?: string };
export const SOURCES: Record<string, Source> = {
  S1: { url: "https://craftcloud3d.com/", read: READ },
  S2: { url: "https://craftcloud3d.com/en/upload", read: READ },
  S3: { url: "https://craftcloud3d.com/en/p/terms-and-conditions", read: READ },
  S4: { url: "https://craftcloud3d.com/en/material-guide/petg", read: READ },
  S5: { url: "https://craftcloud3d.com/material-guide/hp-mjf-nylon-pa12", read: READ },
  S6: { url: "https://craftcloud3d.com/en/partner/printing-method/slm-dmls", read: READ },
  S8: { url: "https://jlc3dp.com/capabilities/3d-printing-service", read: READ },
  S9: { url: "https://jlc3dp.com/3d-printing-quote", read: READ },
  S10: { url: "https://jlc3dp.com/help/article/How-to-place-a-3D-printing-order", read: READ },
  S11: { url: "https://jlc3dp.com/news/eu-customs-reform2026", read: READ },
  S12: { url: "https://jlccnc.com/help/article/eu-customs-reform-faq", read: READ },
  S13: { url: "https://jlccnc.com/", read: READ },
  S14: { url: "https://jlccnc.com/help/article/how-to-place-cnc-orders", read: READ },
  S15: { url: "https://jlccnc.com/help/article/how-to-place-a-sheet-metal-order", read: READ },
  S16: { url: "https://jlccnc.com/blog/sheet-metel-online", read: READ },
  S17: { url: "https://jlccnc.com/help/article/terms-and-conditions", read: READ },
  S19: { url: "https://www.weerg.com/en/global/quotation-tool/upload", read: READ },
  S20: { url: "https://www.weerg.com/en/global/services/5-axis-cnc-machining", read: READ },
  S21: { url: "https://www.weerg.com/faq/how-do-i-design-the-threads-cnc", read: READ },
  S24: { url: "https://www.weerg.com/faq/worldwide-shipping", read: READ },
  S25: { url: "https://www.weerg.com/en/global/general-conditions-of-use-and-supply", read: READ },
  S26: { url: "https://www.weerg.com/en/materials/nylon-pa12", read: READ },
  S27: { url: "https://www.weerg.com/3d-printing-finishes/dyeing", read: READ },
  S28: { url: "https://www.weerg.com/3d-printing-materials/resin", read: READ },
  S29: { url: "https://www.weerg.com/faq/what-does-weerg-do", read: READ },
  S30: { url: "https://www.weerg.com/faq/where-do-you-produce", read: "2026-10-15" },
  S31: { url: "https://laserboost.com/", read: READ },
  S32: { url: "https://www.laserboost.com/faq/", read: READ },
  S33: { url: "https://laserboost.com/metal-sheet-bending-design-guideline", read: READ },
  S34: { url: "https://www.laserboost.com/laser-cutting-design-guideline/", read: READ },
  S35: { url: "https://www.laserboost.com/payment_method_and_shipping/", read: READ },
  S36: { url: "https://www.laserboost.com/terms-conditions/", read: READ },
  S37: { url: "https://laserbend3d.it/taglio-laser-lamiera/", read: READ },
  S38: { url: "https://xometry.asia/en/faq", read: READ },
  S39: { url: "https://xometry.eu/en/?p=667", read: READ },
  S40: { url: "https://xometry.eu/en/direct-metal-laser-sintering/", read: READ },
  S41: { url: "https://xometry.eu/en/manufacturing-standards/", read: READ },
  S43: { url: "https://www.xometry.com/service-agreement/", read: READ },
  S49: { url: "https://hubs.com/terms-of-use", read: READ },
  S52: { url: "https://www.protolabs.com/legal-notices/", read: READ },
  // The EU's charges on a parcel from outside it, and Italy's VAT (landed.ts), read on 2026-11-09.
  COUNCIL: { url: "https://www.consilium.europa.eu/en/press/press-releases/2026/02/11/council-gives-final-green-light-to-new-customs-duty-rules-for-small-parcels/", read: "2026-11-09" },
  EU_DUTY: { url: "https://taxation-customs.ec.europa.eu/news/guidance-and-legal-text-temporary-flat-fee-low-value-imports-which-will-apply-until-1-july-2028-2026-06-08_en", read: "2026-11-09" },
  REVENUE: { url: "https://www.revenue.ie/en/customs/individuals/union-handling-fee/index.aspx", read: "2026-11-09" },
  REVENUE_HOW: { url: "https://www.revenue.ie/en/customs/individuals/union-handling-fee/how-the-fee-applies.aspx", read: "2026-11-09" },
  EU_VAT: { url: "https://taxation-customs.ec.europa.eu/customs/customs-procedures-import-and-export/importation/buying-goods-online-coming-non-european-union-country_en", read: "2026-11-09",
    note: "for VAT: its line on duty predates 1 July 2026" },
  A2M: { url: "https://trade.ec.europa.eu/access-to-markets/en/news/eu-applies-eu3-customs-duty-item-low-value-e-commerce-consignments", read: "2026-11-09" },
  REVENUE_PR: { url: "https://www.revenue.ie/en/corporate/press-office/press-releases/2026/pr-092926-handling-fee.aspx", read: "2026-11-09" },
  EU_UHF_GUIDE: { url: "https://taxation-customs.ec.europa.eu/document/download/053e5b4e-f0be-4f20-9a23-3e3b659a6676_en?filename=Customs+Guidance+on+EUR+3+customs+duty.pdf", read: "2026-11-09",
    note: "the Commission's guidance of 5 October 2026: 6.4, who owes the handling fee; 9.2, VAT on it" },
  THE_LOCAL: { url: "https://www.thelocal.se/20261030/eu-to-slap-new-e2-fee-on-online-shopping-orders-from-outside-europe", read: "2026-11-09",
    note: "The Local, 30 October 2026, quoting BEUC" },
  IT_BUDGET: { url: "https://www.informazionefiscale.it/tassa-sui-pacchi-novita-manovra-2027-contributi-dazi-spedizioni-ue", read: "2026-11-09",
    note: "2 November 2026: the 2027 budget bill would repeal Italy's €2" },
  JLC_EU_FAQ: { url: "https://jlcpcb.com/help/article/eu-customs-reform-faq", read: "2026-11-09", note: "JLCPCB's, which JLC3DP's notice points to" },
  JLC_VAT: { url: "https://jlcpcb.com/help/article/eu-vat-e-commerce-rules-&-adjustments", read: "2026-11-09", note: "JLCPCB's" },
  IT_VAT: { url: "https://agenziaentrate.gov.it/portale/web/english/nse/business/vat-in-italy", read: "2026-11-09" },
  IT_DL193: { url: "https://www.normattiva.it/eli/id/2026/10/23/26G00216/ORIGINAL", read: "2026-11-09" },
  JLC_USTAX: { url: "https://jlc3dp.com/help/article/us-tariff-policy-faq", read: "2026-11-09" },
};
/** A list of sources, as each ORDER.md writes them: a page read on another day than READ says when. */
const sourcesText = (keys: string[], first: string[] = []) =>
  `Sources: ${[...first, ...[...new Set(keys)].map((k) => {
    const s = SOURCES[k], said = [s.note, s.read === READ ? "" : `read ${s.read}`].filter(Boolean).join("; ");
    return `${s.url}${said ? ` (${said})` : ""}`;
  })].join(" · ")}`;

/** One thing a shop's page says, and where. One Sprue could not confirm starts "Sprue did not confirm". */
export type Fact = { text: string; src: string[] };

/** What a listing's steps and facts are worked out from. */
export type Part = {
  slug: string; line: BomLine; kind: Kind; material: string; process?: string;
  /** The file to upload, by its name in the part's folder. */
  upload: string; n: number;
  /** With a split, what to choose now: order A's pieces, and order B's to come. */
  count?: string;
};

/** One shop for one kind of part. `fits` says why it is not listed for this line, or undefined when it is. */
export type Listing = {
  kind: Kind; upload: string;
  fits?: (p: Part) => string | undefined;
  intro: string;
  /** A person's steps, the last of them a stop. */
  steps: (p: Part) => string[];
  facts: (p: Part) => Fact[];
  /** Said under Sprue's price when the quote buys the part here. */
  priceNote?: string;
  /** Say priceNote only where the quote counts shipping for the shop. */
  noteIfShipped?: boolean;
};
export type Shop = {
  id: string; name: string; who: string;
  /** Where it makes or ships from: in the EU, in China, or through partners anywhere. */
  from: "eu" | "china" | "world";
  /** Its terms (or its group's) ban agents: listed last, for a person only. */
  person?: string;
  hosts: string[];
  listings: Listing[];
};

const AT_CART = "Stop at the cart.", BEFORE_PAY = "Stop before you pay.";
const pieces = (n: number) => `${n} piece${n === 1 ? "" : "s"}`;
/** How many to choose at the shop now: the whole order, or with a split, order A's. */
const howMany = (p: Part) => p.count ?? pieces(p.n);
const PETG = /\bPETG\b/i;
/** The filled nylons in Weerg's menu. */
const WEERG_FILLED = /^\s*(nylon )?PA ?(12 ?[- ]?(CF|GB)|6 ?[- ]?CF)\s*$/i;
/** Plain PA12 (or PA11 with `eleven`), not a blend or a filled grade, which a shop's plain PA12 is not. */
const plainNylon = (m: string, eleven = false) =>
  new RegExp(`^(nylon[ -]?)?(pa[ -]?(12${eleven ? "|11" : ""})|polyamide[ -]?(12${eleven ? "|11" : ""}))?([ -]?nylon)?$`, "i").test(m.trim()) && /\S/.test(m);

/** Text from bom.json, checks.json or the catalog, made safe to put in a line of markdown: one line (no heading, list or
 * fence can start), and no link, image, HTML or code span of its own; a bare URL is not made a link either, unless
 * `urls` (a quote's basis names the page its price was read on). */
export const md = (v: unknown, urls = false): string => {
  const one = String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/[\\`[\]<>|]/g, "\\$&").trim();
  return urls ? one : one.replace(/:\/\//g, "\\://").replace(/\b(www)\./gi, "$1\\.");
};

const WEERG_OPEN = "Open https://www.weerg.com/en/global/quotation-tool/upload on a computer: Weerg recommends its PC version for uploads. If it shows Error 953, the connection dropped: reload the page.";
const WEERG_EXW = "Its price is ex works: transport and insurance come on top, at its checkout.";
const WEERG_FACTS: Fact[] = [
  { text: "It makes every part itself in Italy, so an order from the EU clears no customs.", src: ["S30"] },
  { text: "Sprue did not confirm how it charges VAT: its pages give only its Italian VAT and SDI numbers.", src: ["S29"] },
  { text: "It ships by DHL, FedEx or DPD. It says 98% of European deliveries arrive 1 to 2 working days after dispatch, and islands take 2 days more.", src: ["S24"] },
  { text: "Its conditions say it checks only that the file can be produced. A full check of the file is a paid option in the quote.", src: ["S25"] },
];
/** JLC's own page on the EU customs change of 2026: its IOSS, and the duty on top. */
const JLC3DP_CUSTOMS: Fact = { text: "On a parcel worth up to €150, JLC's IOSS collects the VAT but not the new €3 duty, which is paid on import, or at its checkout if the parcel ships DDP (delivered duty paid: the shop collects the import charges for you).", src: ["S11"] };
const JLCCNC_FACTS: Fact[] = [
  { text: "Its terms (section VIII) deliver FCA: the import charges are yours unless you choose DDP at checkout. See the import charges below.", src: ["S17", "S12"] },
  { text: "Its terms (updated 2025-07-30) have no clause on agents.", src: ["S17"] },
];
/** The metal warning of an ORDER.md: the shops listed below can make the part, and theirs are the only checks on it. */
export const METAL = "Sprue has no price for a metal part made for the product, and no rule here reads bends, tool reach, supports or tolerances. The shops below make metal parts: their own checks are the only ones this part gets before it is made.";
const XOMETRY_PERSON = "For a person only. Xometry's customer agreement (7.1.2) bans bots, scrapers and avatars. No agent, Claude included, may open this site, fill its form or upload to it. Xometry Europe's own terms have no such clause, but treat them the same.";

export const SHOPS: Shop[] = [
  {
    id: "craftcloud", name: "Craftcloud", who: "All3DP GmbH, Munich, Germany", from: "world",
    hosts: ["craftcloud3d.com"],
    listings: [
      {
        kind: "plastic", upload: "https://craftcloud3d.com/en/upload",
        intro: "Craftcloud passes your order to one of about 150 partner shops around the world.",
        steps: (p) => [
          `Open https://craftcloud3d.com/en/upload. Upload \`${p.upload}\`, this part's one file.`,
          "If it asks for units, choose mm. Check its viewer as above.",
          `Choose ${p.material} and ${howMany(p)}.` + (PETG.test(p.material) ? " It lists 38 PETG colours and a Standard or Sanded finish."
            : plainNylon(p.material) && p.process === "MJF/SLS" ? " It lists HP MJF Nylon PA12 in 12 colours, with finishes from Standard to Vapor Smoothed." : ""),
          "Compare the offers. Each one is a partner shop with its own price and date. The price includes regular shipping, and VAT where it applies. It does not include customs, duties or import taxes.",
          "Pick a partner in the EU if you can. From outside the EU, the charges below come on top. Sprue did not confirm that the checkout shows where the partner is.",
          "Craftcloud does not check your file before it charges you. If the part can't be printed, you get your money back less up to 7%.",
          AT_CART,
        ],
        facts: (p) => [
          { text: "It takes STL, OBJ, 3MF, STEP, STP and 11 more formats, up to 500 MB.", src: ["S2"] },
          { text: "It has no minimum order. \"Ships in 24-48h\" is its site's claim: each offer gives its own date.", src: ["S1"] },
          { text: "Its price includes regular shipping, and VAT where it applies (its terms, 8.1.2), but not customs, duties or import taxes (8.2). It does not check a file before it charges (5.2), and keeps up to 7% of the order if a part can't be printed (8.4.1).", src: ["S3"] },
          ...(PETG.test(p.material) ? [{ text: "PETG: walls of at least 1 mm, sizes to ±0.3% (at least ±0.2 mm), 0.2 mm layers.", src: ["S4"] }] : []),
          ...(plainNylon(p.material) ? [{ text: "HP MJF Nylon PA12: walls of at least 0.8 mm, sizes to ±0.3% (at least ±0.3 mm); finishes Standard, Polished, Vapor Smoothed, Shot Peened, Electroplated or UV Powder Coating.", src: ["S5"] }] : []),
          { text: "Sprue did not confirm that its upload asks for units.", src: ["S2"] },
        ],
        priceNote: "Craftcloud says its prices already include regular shipping (its terms, 8.1.2). Sprue adds the shipping in its rates.json on top, so its total may count shipping twice.",
        noteIfShipped: true,
      },
      {
        kind: "metal", upload: "https://craftcloud3d.com/en/upload",
        intro: "Craftcloud passes a metal print to one of its partner shops. Its partners in the EU include K3D (the Netherlands: AlSi10Mg, 316L, M300, Ti6Al4V), MadeInAdd (Italy), KleRo (Germany) and IAMG (Poland).",
        steps: (p) => [
          `Open https://craftcloud3d.com/en/upload. Upload \`${p.upload}\`, this part's one file.`,
          "If it asks for units, choose mm. Check its viewer as above.",
          `Choose ${p.material}, printed by DMLS or SLM, and ${howMany(p)}.`,
          "Compare the offers, and pick a partner in the EU if you can. The price includes regular shipping, and VAT where it applies. It does not include customs, duties or import taxes.",
          "Craftcloud does not check your file before it charges you.",
          AT_CART,
        ],
        facts: () => [
          { text: "Its DMLS and SLM partners in the EU include K3D, MadeInAdd, KleRo and IAMG.", src: ["S6"] },
          { text: "Its price includes regular shipping, and VAT where it applies (its terms, 8.1.2), but not customs, duties or import taxes (8.2). It does not check a file before it charges (5.2).", src: ["S3"] },
        ],
      },
    ],
  },
  {
    id: "weerg", name: "Weerg", who: "Venice, Italy", from: "eu",
    hosts: ["weerg.com"],
    listings: [
      {
        kind: "plastic", upload: "https://www.weerg.com/en/global/quotation-tool/upload",
        fits: (p) => PETG.test(p.material) ? "It lists PETG ESD, not plain PETG."
          : p.process === "SLA" ? undefined
          : p.process === "MJF/SLS" ? (plainNylon(p.material, true) || WEERG_FILLED.test(p.material) ? undefined : `Its nylon menu lists PA12, PA12 W, PA11 Gen 2, PA12 CF, PA6 CF and PA12 GB, not ${p.material}.`)
          : "Which of its materials it prints by FDM is not confirmed.",
        intro: "Weerg makes every part itself, in Italy.",
        steps: (p) => [
          WEERG_OPEN,
          `Upload \`${p.upload}\`, this part's one file. It takes .stl, .stp, .step and .zip, up to 150 MB.`,
          p.process === "SLA"
            ? `Choose the resin nearest ${p.material}: Versatile w135, Tough PP-like, Best Price classic, ABS like PRO, High temp PRO, Ceramic or Flame retardant. Then ${howMany(p)}, and Basic or Professional finishing.`
            : plainNylon(p.material) ? `Choose "Nylon PA12" (natural) or "PA12 W | White", and ${howMany(p)}. It dyes PA12 black, yellow, red, blue, green or orange.`
            : plainNylon(p.material, true) ? `Choose "PA11 Gen 2" in its nylon menu, and ${howMany(p)}.`
            : `Choose ${p.material} in its nylon menu, and ${howMany(p)}.`,
          WEERG_EXW,
          BEFORE_PAY,
        ],
        facts: (p) => [
          ...(p.process === "SLA"
            ? [{ text: "Most of its resins hold ±0.3 mm up to 100 mm and ±0.3% above; Ceramic and Flame retardant hold ±0.6 mm and ±0.75%. All ship in under 2 days.", src: ["S28"] }]
            : [{ text: "Its PA12 holds ±0.30 mm up to 100 mm and ±0.3% above, in a build volume of 380 x 284 x 380 mm, and ships in under 2 days.", src: ["S26", "S27"] },
              { text: "Sprue did not confirm whether its \"natural\" PA12 is the grey it prints in.", src: ["S26"] }]),
          ...WEERG_FACTS,
        ],
      },
      {
        kind: "cnc", upload: "https://www.weerg.com/en/global/quotation-tool/upload",
        fits: (p) => /ALUMIN|STAINLESS|INOX|\b30[34]\b|\b316|STEEL|\bS2\d\d|\bS3\d\d|\bC45\b|COPPER|BRONZE|BRASS|\bOT ?58\b|\bPOM\b|DELRIN|ACETAL|PEEK|PTFE|TEFLON|\bABS\b|NYLON|\bPA ?6\b|POLYETHYLENE|\bHDPE\b|\bPE\b|\bPVC\b/i.test(p.material)
          ? undefined : `Its CNC list has no ${p.material}.`,
        intro: "Weerg machines every part itself, in Italy, on 5-axis machines.",
        steps: (p) => [
          WEERG_OPEN,
          `Upload \`${p.upload}\`, this part's one file. A PDF drawing goes through "Attach a technical drawing with specs", and Sprue writes none.`,
          `Choose ${p.material}, or the nearest it lists: aluminium 2011, 2017A, 5083, 6082, 7021, 7022 or 7075; stainless 303, 304 or 316L; steel S235JR, S355J2, C45, 11SMnPb37, 18NiCrMo5 or 39NiCrMo3; copper C101, bronze 12 or brass OT58; POM-C, PEEK, PTFE, ABS, nylon 6 + MoS2, polyethylene or PVC. Then ${howMany(p)}.`,
          "Pick each threaded hole's thread in the form. A standard thread needs no drawing when the hole is modelled at its tap-drill size (M5 is 4.2 mm).",
          "Pick the finish: none, Lancet shot peening, or gloss or matt anodizing.",
          WEERG_EXW,
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "It machines 1 to 10,000 parts, and ships from 3 days. Its CNC page says a technician checks the file.", src: ["S20"] },
          { text: "A standard thread is picked in the form for a hole modelled at the tap-drill size. It states no default tolerance.", src: ["S21"] },
          ...WEERG_FACTS,
        ],
      },
    ],
  },
  {
    id: "laserboost", name: "Laserboost", who: "Madrid and Manresa, Spain", from: "eu",
    hosts: ["laserboost.com"],
    listings: [
      {
        kind: "sheet", upload: "https://www.laserboost.com/en/create",
        fits: (p) => {
          if (!/STEEL|GALVAN|STAINLESS|INOX|ALUMIN|BRASS|COPPER/i.test(p.material)) return `It cuts steel, galvanised steel, stainless, aluminium, brass and copper, not ${p.material}.`;
          const t = Number(p.line.spec.thicknessMm);
          return t < 0.5 || t > 15 ? `It cuts 0.5 to 15 mm, not ${t} mm.` : undefined;
        },
        intro: "Laserboost cuts and bends sheet metal in Spain.",
        steps: (p) => [
          "Open https://www.laserboost.com/en/create.",
          `Upload \`${p.upload}\`, this part's one file. A bent part takes a STEP or SLDPRT only, in mm, at 1:1, one part to a file.`,
          `Choose ${p.material}, ${Number(p.line.spec.thicknessMm)} mm thick, and ${howMany(p)}.`,
          "Read its report on the bends. It bends with an inside radius equal to the thickness.",
          ...(p.line.spec.finish ? [`It does no coatings, so the finish bom.json asks for (${md(p.line.spec.finish)}) is done elsewhere.`] : []),
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "It cuts up to 1500 x 3000 mm, and says \"Delivery in 72 h\".", src: ["S31"] },
          { text: "It holds ±0.15 mm up to 3 mm thick, ±0.3 mm above, and ±0.35 mm a bend. It does no coatings. It has no minimum and needs no account, and a quote holds for a month.", src: ["S32"] },
          { text: "Its shortest flange is 9.5 mm at 1.5 mm thick, and a hole stays 12.5 mm from a bend at 2 mm thick.", src: ["S33"] },
          { text: "Files are in mm, at 1:1, one part to a file.", src: ["S34"] },
          { text: "It checks a file with automatic alerts only. A change it asks for applies only once you accept it by email.", src: ["S36"] },
          { text: "Sprue did not confirm its shipping cost to Italy, or how it charges VAT.", src: ["S35"] },
        ],
      },
    ],
  },
  {
    id: "laserbend3d", name: "Laserbend3D", who: "Torre Annunziata, Naples, Italy", from: "eu",
    hosts: ["laserbend3d.it"],
    listings: [
      {
        kind: "sheet", upload: "https://laserbend3d.it/#preventivo",
        fits: (p) => {
          const m = p.material, t = Number(p.line.spec.thicknessMm);
          if (/ALUMIN|GALVAN|ZINC/i.test(m)) return undefined; // its calculator lists them, with no thickness range on its page
          if (!/\bIRON\b|FERRO|STEEL|ACCIAIO|STAINLESS|INOX|\b30[34]\b|\b316/i.test(m))
            return `Its page lists iron, AISI 304 and AISI 316, aluminium and galvanised iron, not ${m}.`;
          const [lo, hi] = /\b316\s*SB\b/i.test(m) ? [0.8, 4] : /\b316/.test(m) ? [0.8, 5] : /STAINLESS|INOX|\b30[34]\b/i.test(m) ? [0.8, 6] : [0.8, 10];
          return t < lo || t > hi ? `It cuts ${m} ${lo} to ${hi} mm thick, not ${t} mm.` : undefined;
        },
        intro: "Laserbend3D cuts flat parts in Italy. A bent part needs a flat-pattern DXF too, which Sprue doesn't write: use Laserboost for one.",
        steps: (p) => [
          "Open https://laserbend3d.it/#preventivo.",
          `Upload \`${p.upload}\`, this part's one file, if the part is flat. It takes DXF and STEP up to 10 MB, one part to a STEP.`,
          `Choose ${p.material}, ${Number(p.line.spec.thicknessMm)} mm thick, and ${howMany(p)}.`
            + (/ALUMIN|GALVAN|ZINC/i.test(p.material) ? ` Its calculator lists raw and tread-plate aluminium and galvanised iron, with no alloy or thickness range on its page: check that it offers ${p.material} at ${Number(p.line.spec.thicknessMm)} mm.` : ""),
          "Its price includes IVA. Shipping is priced by weight in the cart, or pick it up for free.",
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "It cuts iron 0.8 to 10 mm, AISI 304 0.8 to 6 mm and AISI 316 0.8 to 5 mm (316 SB to 4 mm), and lists aluminium and galvanised iron, with no minimum. It makes the part in 10 to 15 working days from payment (express 7 to 10, at 15% more; economy 30, at 30% less).", src: ["S37"] },
          { text: "Its technical office checks each file after you order. If a part can't be made, it asks you to fix the file or cancel with a full refund.", src: ["S37"] },
          { text: "Sprue did not confirm what its terms say of agents: they were not read.", src: ["S37"] },
        ],
      },
    ],
  },
  {
    id: "jlc3dp", name: "JLC3DP", who: "China", from: "china",
    hosts: ["jlc3dp.com"],
    listings: [
      {
        kind: "plastic", upload: "https://jlc3dp.com/3d-printing-quote",
        fits: (p) => p.process === "SLA" ? undefined
          : p.process === "MJF/SLS" ? (plainNylon(p.material, true) ? undefined : `It prints PA12-HP, PA11-HP and PAC-HP by MJF, not ${p.material}.`)
          : p.process !== "FDM" ? "Sprue can't tell how the part is printed, so it can't match JLC3DP's lists."
          : PETG.test(p.material) ? "Its FDM list has no PETG."
          : /\b(PLA|ABS|ASA|TPU|PEBA)\b|\bPA ?12[- ]?CF\b/i.test(p.material) ? undefined : `Its FDM list (PLA, ABS, ASA, PA12-CF, PEBA, TPU) has no ${p.material}.`,
        intro: "JLC3DP prints the part in China and ships it. Sprue did not read its terms.",
        steps: (p) => [
          `Open https://jlc3dp.com/3d-printing-quote. Upload \`${p.upload}\`, this part's one file.`,
          `Choose ${p.process === "MJF/SLS" ? "MJF" : p.process === "SLA" ? "a resin (9600, 8001, Black, Imagine Black, 8228, LEDO 6060, CBY, JLC Black, Grey, JLC Temp, 9000HE or X)" : "FDM"} in ${p.material}, and ${howMany(p)}. Check its viewer as above: it warns of walls under 1.2 mm and parts under 0.8 mm.`,
          "Its engineers check the file once you submit the order, before you pay, in 4 to 6 business hours. Submitting waits for your OK too.",
          AT_CART,
        ],
        facts: () => [
          { text: "FDM in PLA, ABS, ASA, PA12-CF, PEBA or TPU; MJF in PA12-HP, PA11-HP or PAC-HP; a dozen resins. FDM and MJF hold ±0.3 mm up to 100 mm and ±0.4% above, resin ±0.2 mm up to 100 mm. It makes a part in 48 to 120 hours.", src: ["S8"] },
          { text: "It takes STL, STP, STEP, OBJ, 3MF, IGS and IGES. Its shipping weight is an estimate and can change.", src: ["S9"] },
          { text: "Its engineers check a file after you submit the order and before you pay, in 4 to 6 business hours.", src: ["S10"] },
          JLC3DP_CUSTOMS,
        ],
        priceNote: "Sprue's JLC3DP rate includes the 40% US advance tax, which an order to the EU does not pay (rates.json). Its shipping there, $0, is a placeholder, not free shipping: unless catalog.json gives one, the quote counts none.",
      },
      {
        kind: "metal", upload: "https://jlc3dp.com/3d-printing-quote",
        fits: (p) => /\b316L?\b|\bTC4\b|TI-?6AL-?4V|TITANIUM|STAINLESS/i.test(p.material) ? undefined
          : `It prints 316L stainless and TC4 titanium, not ${p.material}.`,
        intro: "JLC3DP prints metal in China (SLM in 316L or TC4, binder jetting in 316L) and ships it. Sprue did not read its terms.",
        steps: (p) => [
          `Open https://jlc3dp.com/3d-printing-quote. Upload \`${p.upload}\`, this part's one file.`,
          `Choose ${p.material} and ${howMany(p)}. Check its viewer as above.`,
          "Its engineers check the file once you submit the order, before you pay, in 4 to 6 business hours. Submitting waits for your OK too.",
          AT_CART,
        ],
        facts: () => [
          { text: "It prints SLM 316L and TC4, and binder-jet BJ-316L, in 48 to 120 hours.", src: ["S8"] },
          { text: "Its engineers check a file after you submit the order and before you pay, in 4 to 6 business hours.", src: ["S10"] },
          JLC3DP_CUSTOMS,
        ],
      },
    ],
  },
  {
    id: "jlccnc", name: "JLCCNC", who: "China", from: "china",
    hosts: ["jlccnc.com"],
    listings: [
      {
        kind: "cnc", upload: "https://jlccnc.com/cnc-machining-quote",
        fits: (p) => /ALUMIN|\b6061\b|\b7075\b|\bSUS|STAINLESS|\b304\b|STEEL|BRASS|COPPER|\bPOM\b|DELRIN|ACETAL|\bPC\b|POLYCARBONATE|\bABS\b|\bFR-?4\b|PMMA|ACRYLIC|NYLON|\bPA ?6\b|BAKELITE/i.test(p.material)
          ? undefined : `Its CNC list has no ${p.material}.`,
        intro: "JLCCNC machines the part in China and ships it.",
        steps: (p) => [
          `Open https://jlccnc.com/cnc-machining-quote. Upload \`${p.upload}\`, this part's one file.`,
          `Choose ${p.material}, or the nearest it lists (aluminum 6061 or 7075, SUS304, 45# steel, brass H59, copper T2, POM, PC, ABS, FR4, PMMA, nylon PA6, bakelite), and ${howMany(p)}.`,
          "Threads and tolerances go on a drawing (PDF, DWG or DXF), and Sprue writes none: leave them out, or have one drawn.",
          "When you submit, choose Review Before Payment, not Automatic pay with PayPal, which charges a small order as soon as the file is approved and starts production. Its engineers then check the file in 2 to 4 hours on working days. Submitting waits for your OK too.",
          AT_CART,
        ],
        facts: () => [
          { text: "A STEP is required. A PDF, DWG or DXF goes as a drawing, which threads and tolerances need.", src: ["S14"] },
          { text: "When you submit, it offers Review Before Payment, or Automatic pay with PayPal, which charges a small order once the file is approved and starts production. The file is checked in 2 to 4 hours on working days.", src: ["S14"] },
          { text: "It builds in 3 days.", src: ["S13"] },
          { text: "Its price can change until the order is complete.", src: ["S17"] },
          ...JLCCNC_FACTS,
        ],
      },
      {
        kind: "sheet", upload: "https://jlccnc.com/sheet-metal-quote",
        fits: (p) => /ALUMIN|\b5052\b|STAINLESS|\b20[14]\b|\b304\b|COLD.?ROLLED|STEEL|GALVAN/i.test(p.material)
          ? undefined : `Its sheet-metal list has no ${p.material}.`,
        intro: "JLCCNC cuts and bends sheet metal in China and ships it.",
        steps: (p) => [
          `Open https://jlccnc.com/sheet-metal-quote. Upload \`${p.upload}\`, this part's one file.`,
          `Choose ${p.material}, or the nearest it lists (aluminum 5052, stainless 201 or 304, cold rolled steel, galvanized steel), ${Number(p.line.spec.thicknessMm)} mm thick, and ${howMany(p)}.`,
          "Its automatic quote is for reference only: it checks the file in 10 minutes to 4 hours, before you pay.",
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "A STEP is required. A PDF, DWG or DXF goes as a drawing. The automatic quote is for reference only, and the file is checked in 10 minutes to 4 hours.", src: ["S15"] },
          { text: "Finishes: anodizing, hardcoat or conductive anodizing, powder coating, brushing, silkscreen printing, laser marking.", src: ["S16"] },
          { text: "It builds in 2 days.", src: ["S13"] },
          ...JLCCNC_FACTS,
        ],
      },
    ],
  },
  {
    id: "xometry", name: "Xometry Europe", who: "Ottobrunn, Germany", from: "eu",
    person: XOMETRY_PERSON,
    hosts: ["xometry.eu", "xometry.com", "xometry.asia"],
    listings: [
      {
        kind: "cnc", upload: "https://xometry.eu/en/",
        intro: "Xometry Europe passes the part to a partner shop.",
        steps: (p) => [
          `A person opens https://xometry.eu/en/ and uploads \`${p.upload}\`, this part's one file.`,
          `Choose ${p.material} and ${howMany(p)}. Its tolerance is ISO 2768 unless you say otherwise. Threads and inserts need a drawing, and Sprue writes none.`,
          "It quotes a STEP at once. A PDF drawing gets a quote by hand, in about 24 hours, and its engineers may review an order.",
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "It quotes STEP, STP, SLDPRT, IPT, 3DXML, PRT and SAT at once, and a PDF by hand in about 24 hours. Private buyers may order. Its price is ex works Ottobrunn, delivering to the EU, the UK, Norway and Switzerland.", src: ["S38"] },
          { text: "Its contract is with Xometry Europe GmbH, whose own terms have no clause on bots.", src: ["S39"] },
          { text: "Xometry's customer agreement (7.1.2, updated 2026-07-28) bans bots, scrapers and avatars.", src: ["S43"] },
          { text: "Tolerances are ISO 2768 unless you say otherwise. Threads and inserts need a drawing.", src: ["S41"] },
          { text: "Sprue did not confirm its upload page or its lead time.", src: ["S39"] },
        ],
      },
      {
        kind: "metal", upload: "https://xometry.eu/en/",
        intro: "Xometry Europe passes a metal print to a partner shop.",
        steps: (p) => [
          `A person opens https://xometry.eu/en/ and uploads \`${p.upload}\`, this part's one file.`,
          `Choose ${p.material} (it lists AlSi10Mg, 316L / 1.4404, 17-4PH, Ti-6Al-4V, tool steel 1.2709 / MS1, CoCr and Inconel 718) and ${howMany(p)}.`,
          BEFORE_PAY,
        ],
        facts: () => [
          { text: "Metal prints hold ±0.2% (±0.1 to 0.2 mm), up to a 400 mm cube, from 10 business days.", src: ["S40"] },
          { text: "Xometry's customer agreement (7.1.2, updated 2026-07-28) bans bots, scrapers and avatars.", src: ["S43"] },
        ],
      },
    ],
  },
];

/** The shops left out, said in every README. */
const LEFT_OUT = [
  "Protolabs and its Hubs network. Their terms (3.3(d)) ban automated agents, and Sprue's next step is an agent that reads these files.",
  "Weerg's laser cutting. Which files it takes is not confirmed, and it cuts 2D outlines, which Sprue does not write.",
  "Shops that take only a DXF, such as LaserMio.",
];

/** The shops of a line, in the order an ORDER.md lists them (the quote's or the pinned shop first, then the shops in
 * the EU, then through partners, then in China, then those for a person only), and those of its kind it is not listed
 * at, with why. */
export function shopsFor(p: Part, first?: string): { listed: { shop: Shop; listing: Listing }[]; not: { shop: Shop; why: string }[] } {
  const listed: { shop: Shop; listing: Listing }[] = [], not: { shop: Shop; why: string }[] = [];
  for (const shop of SHOPS) for (const listing of shop.listings.filter((x) => x.kind === p.kind)) {
    const why = listing.fits?.(p);
    if (why) not.push({ shop, why });
    else listed.push({ shop, listing });
  }
  const rank = (s: Shop) => (first && s.name === first ? -1 : s.person ? 4 : { eu: 0, world: 1, china: 2 }[s.from]);
  listed.sort((a, b) => rank(a.shop) - rank(b.shop));
  return { listed, not };
}

// ---- the gates ------------------------------------------------------------------------------------------------

/** Whether previews/<stem>.svg, which an ORDER.md shows as the part to check against the shop's viewer, is the
 * drawing `sprue cad` wrote (fab/build.json's outputs); its STL and STEP are exportStale's to hold. A build.json that
 * can't be read, or has no outputs, is exportStale's to say too. */
function previewProblem(dir: string, id: string, stem: string): string | undefined {
  const f = `previews/${stem}.svg`;
  if (!existsSync(join(dir, f))) return undefined;
  let outputs: unknown;
  try {
    outputs = (JSON.parse(readFileSync(join(dir, "fab", "build.json"), "utf8")) as { outputs?: unknown }).outputs;
  } catch {
    return undefined;
  }
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return undefined;
  const want = (outputs as Record<string, unknown>)[f];
  if (typeof want !== "string") return `${id}: ${f} is not a file sprue cad wrote: run sprue cad`;
  if (sha256(readFileSync(join(dir, f))) !== want) return `${id}: ${f} was changed since sprue cad wrote it: run sprue cad`;
  return undefined;
}

/** Each made line's problems that stop the hand-off: no file, or one that is not an export of cad/; its STL or STEP not
 * made, stale, a link, not the bytes sprue cad wrote, or (the STL) not one closed body of the volume it prices; two
 * lines of one file; an id that can't be a folder; no material, no sheet thickness, no whole number to order, or an
 * order A that is not one. */
export function lineProblems(dir: string, bom: Bom): string[] {
  const out: string[] = [], lines = handoffLines(dir, bom), files = new Map<string, string>(), ids = new Map<string, string>();
  for (const l of lines) {
    if (typeof l.id !== "string" || !ID.test(l.id)) {
      out.push(`${l.id}: ${BAD_ID}`);
      continue;
    }
    const other = ids.get(l.id.toLowerCase());
    if (other) out.push(`${other} and ${l.id}: two line ids that differ only in case would share a folder on a Mac or Windows disk: rename one`);
    ids.set(l.id.toLowerCase(), l.id);
    if (!l.file) {
      out.push(`${l.id} (${l.process}) names no file, so there is nothing to send a shop: give its file (fab/<part>.stl), exported from cad/<part>.py`);
      continue;
    }
    const stem = exportOf(dir, l);
    if (!stem) {
      out.push(`${l.id}: ${l.file} is not an export of cad/ (fab/<part>.stl or .step, with cad/<part>.py beside it): sprue handoff hands off only parts sprue cad exports`);
      continue;
    }
    const twin = files.get(stem);
    if (twin) out.push(`${twin} and ${l.id}: both name fab/${stem}, so one part would be ordered twice: give each line its own file`);
    files.set(stem, l.id);
    const missing = ["stl", "step"].map((x) => `fab/${stem}.${x}`).filter((f) => !existsSync(join(dir, f)));
    for (const f of missing) out.push(`${l.id}: ${f} is not made yet: run sprue cad`);
    // What is copied out must be this product's own file, not a link to another's: inProduct follows links.
    const linked = [`fab/${stem}.stl`, `fab/${stem}.step`, `previews/${stem}.svg`]
      .filter((f) => existsSync(join(dir, f)) && (inProduct(dir, f) !== f || !lstatSync(join(dir, f)).isFile()));
    for (const f of linked) out.push(`${l.id}: ${f} is a link or not a plain file, so it may not be this product's export: remove it and run sprue cad`);
    if (!missing.length && !linked.length) {
      // The line's own file, then its twin: a problem with either is said after the file the line names.
      // Named as bom.json writes it, as the gates name it, so one problem is said once.
      const stale = exportStale(dir, inProduct(dir, l.file));
      if (stale) out.push(`${l.id}: ${l.file}: ${stale}`);
      else {
        const drawn = previewProblem(dir, l.id, stem);
        if (drawn) out.push(drawn);
        const mesh = meshProblem(dir, { ...l, file: `fab/${stem}.stl` });
        if (mesh) out.push(mesh);
      }
    }
    for (const gap of [...specGaps(l), ...countGaps(dir, l, bom.units)]) out.push(`${l.id}: ${gap}`);
  }
  return out;
}

/** Why `sprue handoff` writes nothing: the Inspect gate as `checks` (just run) holds it (a failed check, a part file
 * that is not current, the whole product failing its check), each made line's own problems (lineProblems), and a
 * quotes.json that is not of the files as they are. A line the quote leaves unpriced is no problem here. */
export function handoffProblems(dir: string, bom: Bom, checks: Checks): string[] {
  return [...new Set([...gateProblems(dir, "inspect", checks), ...lineProblems(dir, bom), ...quoteProblems(dir)])];
}

/** quoteFreshness's problems, said so they can be fixed: with no offers sprue all skips the quote, and sprue quote,
 * which prices the made lines without them, is the command that writes it. */
function quoteProblems(dir: string): string[] {
  const rerun = ": run sprue all", problems = quoteFreshness(dir).problems;
  if (existsSync(join(dir, "catalog.json")) || existsSync(join(dir, "offers.digikey.json"))) return problems;
  return problems.map((p) => (p.endsWith(rerun) ? `${p.slice(0, -rerun.length)}: run sprue quote ${basename(dir)} (sprue all skips the quote while there is no catalog.json)` : p));
}

// ---- the texts ------------------------------------------------------------------------------------------------

/** What fab/order/ is worked out from, read from the product's files (throws on one that doesn't parse). */
export type HandoffInput = {
  dir: string; slug: string; bom: Bom; checks: Checks; quotes?: Quotes; rates: FabRates; region: string;
  /** pipeline/fx.json: the rate the euro figures use. */
  fx: Fx;
  /** design.json's firstArticleUnits: the quote splits the order in two when it is between 0 and the units. */
  firstArticle: number;
  written: string;
};

export function handoffInput(dir: string, written: string): HandoffInput {
  const read = <T>(f: string): T => {
    if (!existsSync(join(dir, f))) throw new Error(`there is no ${f}`);
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
    } catch (e) {
      throw new Error(`${f} doesn't parse (${errorText(e)})`);
    }
  };
  const opt = <T>(f: string): T | undefined => (existsSync(join(dir, f)) ? read<T>(f) : undefined);
  const bom = read<Bom>("bom.json"), checks = read<Checks>("checks.json");
  const design = opt<Design>("design.json"), quotes = opt<Quotes>("quotes.json"), request = opt<Request>("request.json");
  let filament: FabRates["filament"];
  try {
    filament = (read<{ filament?: FabRates["filament"] }>("catalog.json")).filament;
  } catch {
    filament = undefined; // no catalog, or one the gates say is not readable
  }
  return {
    dir, slug: basename(dir), bom, checks, quotes, rates: { ...loadRates(), ...(filament ? { filament } : {}) }, fx: loadFx(),
    region: String(request?.region ?? "not given"), firstArticle: Number(design?.params?.firstArticleUnits ?? 0) || 0, written,
  };
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const fmt = (n: number, d = 1) => n.toFixed(d);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const grouped = (n: number) => Math.round(n).toLocaleString("en-US");

/** A line's flags: those whose `lines` name it, and on a print, those of the print rules that name no line. */
const flagsOf = (checks: Checks, l: BomLine): Check[] =>
  checks.checks.filter((c) => c.status === "flag" && (c.lines?.includes(l.id) || (l.process === "print" && c.id.startsWith("print-") && !c.lines?.length)));

type Order = { stem: string; ext: "stl" | "step"; upload: string; part: Part; split?: { a: number; b: number };
  priced: QuoteLine[]; phases: { name: string; lines: QuoteLine[] }[]; home: boolean };

function orderOf(input: HandoffInput, l: BomLine): Order {
  const stem = exportOf(input.dir, l)!, kind = kindOf(l), ext = kind === "cnc" || kind === "sheet" ? "step" : "stl";
  const upload = `${input.slug}-${stem}.${ext}`, n = batchNeed(l, input.bom.units);
  const split = splitOf(l, n, input.firstArticle, input.bom.units);
  const part: Part = { slug: input.slug, line: l, kind, material: md(String(l.spec.material ?? "").trim()), process: l.process === "print" ? printProcess(l) : undefined, upload, n,
    count: split ? `${pieces(split.a)} now, for order A (order B, ${pieces(split.b)}, follows once the first units are built)` : undefined };
  const q = input.quotes;
  return {
    stem, ext, upload, part, home: homePinned(l), split,
    priced: (q?.lines ?? []).filter((x) => x.lineId === l.id),
    phases: (q?.phases ?? []).map((p) => ({ name: p.name, lines: p.lines.filter((x) => x.lineId === l.id) })),
  };
}

/** Sprue's price of a part in a few words: the README's and the command's. */
function priceWords(o: Order): string {
  const q = o.priced;
  if (!q.length) return "not priced";
  const total = q.reduce((s, x) => s + x.orderUsd, 0), shops = [...new Set(q.map((x) => md(x.supplier)))].join(" and ");
  if (o.home) return `${usd(total)} of filament, printed at home`;
  return `${usd(total)} at ${shops}${q.some((x) => x.mode === "estimate") ? ", an estimate" : ""}`;
}

const quantityText = (l: BomLine, units: number, n: number) => {
  const spares = l.spares ?? 0, sp = spares ? ` + ${plural(spares, "spare")}` : "";
  const why = l.qtyPerBatch !== undefined ? `bom.json qtyPerBatch ${l.qtyPerBatch}${sp}` : `${l.qtyPerUnit} a unit x ${plural(units, "unit")}${sp}`;
  return `Order ${n} (${why}).${spares ? "" : " bom.json lists no spares."}`;
};

function section(title: string, body: string[]): string[] {
  return [`## ${title}`, "", ...body, ""];
}

/** The text of one part's ORDER.md. `bytes` is the file to upload, `stl` the STL Sprue measured. */
export function orderMd(input: HandoffInput, o: Order, bytes: Buffer, hasPreview: boolean): string {
  const { slug, bom, checks } = input, l = o.part.line, p = o.part;
  const stlPath = join(input.dir, "fab", `${o.stem}.stl`), m = meshAudit(stlPath);
  const flags = flagsOf(checks, l), metal = limitsOf({ bom: { lines: [l] } }).some((x) => x.kind === "metal");
  const first = o.priced[0]?.supplier ?? l.pin?.supplier;
  const out: string[] = [];
  const opening = { plastic: `A ${p.material} print.`, metal: `A print in ${p.material}.`, cnc: `A CNC-machined part in ${p.material}.`,
    sheet: `A sheet-metal part in ${p.material}, ${Number(l.spec.thicknessMm)} mm thick.` }[p.kind];
  out.push(`# Order the ${md(l.name)} (${l.id}) for ${md(slug)}`, "", opening, "",
    `\`sprue handoff ${slug}\` wrote this on ${input.written}, after every check below passed.`, "",
    `Run \`sprue status ${slug}\` before you upload. It removes this folder if anything it was made from has changed. If the folder is still here, it is current.`, "",
    "Sprue writes this folder whole and removes it when it is out of date. Keep nothing of yours in it.", "",
    `Nothing has been uploaded, quoted or ordered. Uploading the file to get a price shares the design with the shop. That waits for your OK too.`, "");

  // Read this first.
  const first_: string[] = [];
  if (flags.length) {
    first_.push(`The checks flag ${flags.length === 1 ? "1 thing" : `${flags.length} things`} to ask the shop about before you order:`, "",
      ...flags.map((c) => `- ${md(c.id)}: ${md(c.detail)}`), "", "Ask in the shop's order notes whether it makes these as drawn.", "");
  }
  if (l.pin) first_.push(o.home ? "bom.json pins it to your own printer (sprue pick)." : `bom.json pins it to ${md(l.pin.supplier)} (sprue pick).`, "");
  if (!o.priced.length) first_.push("Sprue has no price for this part. See Sprue's price below.", "");
  if (metal) first_.push(METAL, "");
  if (p.kind === "cnc") {
    first_.push("Sprue writes no drawing. A STEP holds the shape only. Threads, fits and tight tolerances are not in it.",
      "Weerg takes a standard thread from its form if the hole is modelled at the tap-drill size (M5 is 4.2 mm). JLCCNC and Xometry Europe need a drawing for threads.");
    if (typeof l.spec.features === "string" && l.spec.features.trim()) first_.push(`bom.json says: "${md(l.spec.features)}".`);
    first_.push("");
  }
  if (p.kind === "sheet") first_.push("Sprue writes no flat pattern (DXF). Upload the STEP. No rule here reads bends.",
    "Laserboost bends with an inside radius equal to the thickness. Its shortest flange is 9.5 mm at 1.5 mm thick. Check what the shop's report says.", "");
  if (first_.length) out.push(...section("Read this first", first_.slice(0, -1)));

  // The file.
  const src = `fab/${o.stem}.${o.ext}`;
  out.push(...section("The file", [
    o.home ? `Slice \`${o.upload}\` and nothing else.` : `Upload \`${o.upload}\` once, and no other file of this part: each file you upload becomes a part in the cart.`, "",
    `- sha256 ${sha256(bytes)}`,
    `- ${grouped(bytes.length)} bytes`,
    `- It is ${src}, byte for byte, as \`sprue cad\` exported it from cad/${o.stem}.py.${o.ext === "step" ? ` Sprue measured the part on fab/${o.stem}.stl, exported with it.` : ""}`,
    ...(hasPreview ? ["", `\`../${l.id}.svg\` is a picture of the part. It is not to scale and it is not a drawing. Do not upload it.`] : []),
  ]));

  // How many.
  const many = [quantityText(l, bom.units, o.part.n)];
  if (o.split) many.push("", `The quote splits the order in two (design.json firstArticleUnits ${input.firstArticle}): order A, ${o.split.a} for the first ${plural(input.firstArticle, "unit")}, then order B, ${o.split.b} for the rest${l.spares ? ", spares included" : ""}. Order A first, and order B once the first units are built.`);
  out.push(...section("How many", many));

  // What to choose.
  const s = l.spec, rows: [string, string][] = [];
  const said = (k: string) => (s[k] !== undefined && String(s[k]).trim() ? md(s[k]) : undefined);
  const dflt = "The shop's default. bom.json sets none.";
  if (p.kind === "plastic" || p.kind === "metal") {
    rows.push(["Process", said("process") ? `${said("process")} (bom.json spec.process).${p.process ? ` The wall checks used ${p.process}'s limits.` : ""}`
      : p.process ? `${p.process}. bom.json names no process, so Sprue read it from ${p.material}. The wall checks used ${p.process}'s limits. Another process was not checked.`
      : "bom.json names none, and Sprue can't tell it from the material. Ask the shop."]);
  } else rows.push(["Process", p.kind === "cnc" ? "CNC machining. The shop picks milling or turning." : "Sheet metal: laser cut, and bent where the STEP is bent."]);
  rows.push(["Material", `${p.material} (bom.json spec.material). Not a blend or a filled grade, unless it names one.`]);
  if (p.kind === "sheet") rows.push(["Thickness", `${Number(s.thicknessMm)} mm (bom.json spec.thicknessMm)`]);
  rows.push(["Colour", said("color") ?? said("colour") ?? "Any. bom.json names none."]);
  rows.push(["Finish", said("finish") ?? dflt]);
  if (p.kind === "cnc") {
    rows.push(["Tolerance", said("tolerance") ?? said("toleranceMm") ?? dflt]);
    rows.push(["Threads", said("threads")
      ?? (/\bM\d|\btap|\bthread/i.test(String(s.features ?? "")) ? `As bom.json's features say ("${md(s.features)}"). Pick each one in the shop's form, or add a drawing: see Read this first.`
        : "None that bom.json names. A thread is not in the STEP: see Read this first.")]);
  }
  rows.push(["Quantity", o.split ? `${o.part.n}: ${o.split.a} in order A, ${o.split.b} in order B` : `${o.part.n}`]);
  rows.push(["Units", "mm"]);
  if (p.kind === "plastic") rows.push(["Layer height, infill", dflt]);
  const used = new Set(["material", "process", "color", "colour", "finish", "thicknessMm", "tolerance", "toleranceMm", "threads", "features", "volumeCm3", "bboxMm"]);
  const notes = Object.entries(s).filter(([k]) => !used.has(k)).map(([k, v]) => `- spec.${md(k)}: ${md(typeof v === "object" ? JSON.stringify(v) : v)}`);
  out.push(...section("What to choose", ["| Setting | Choose |", "| --- | --- |", ...rows.map(([a, b]) => `| ${a} | ${b} |`),
    ...(notes.length ? ["", "bom.json's other notes on the part, for you, not settings in the shop's form:", ...notes] : [])]));

  // The viewer.
  const box = m.bboxMm ?? [0, 0, 0], dims = (f: number, d = 1) => box.map((x) => fmt(x * f, d)).join(" x ");
  const view: [string, string][] = [["Size", `${dims(1)} mm, in any order. Sprue measured this on the file.`]];
  if (o.ext === "stl") view.push(
    ["Read as inches", `${dims(25.4)} mm, or ${dims(1)} in. Set mm and upload again.`],
    ["Read as centimetres", `${dims(10)} mm, or ${dims(1)} cm. Set mm and upload again.`]);
  else view.push(["Units", "mm. A STEP says its units, so the shop reads them from the file."]);
  const cm3 = m.volumeCm3 ?? 0;
  view.push(["Volume", `${fmt(cm3, 2)} cm³ (${grouped(cm3 * 1000)} mm³), where the shop shows one.`],
    ["Bodies", "One. If the shop finds holes, open edges or more than one shell, it was given another file."]);
  if (hasPreview) view.push(["Shape", `As \`../${l.id}.svg\`.`]);
  out.push(...section(o.home ? "Check the slicer" : "Check the shop's viewer", ["| What | It should show |", "| --- | --- |",
    ...view.map(([a, b]) => `| ${a} | ${b} |`), "", `If any of these is wrong, do not order. Run \`sprue status ${slug}\`.`]));

  // What was checked.
  const notChecked = {
    plastic: ["How a shop turns, supports or slices the part.", "How holes and cut-outs come out once printed."],
    metal: ["How a shop supports, stress-relieves or finishes a metal print.", "How holes and thin walls come out once printed."],
    cnc: ["Tool reach, inside corners and what a shop can hold in a fixture. No rule here reads them.", "Threads, fits and tolerances, which no file here carries."],
    sheet: ["Bends, flanges and the flat pattern. No rule here reads them.", "How holes near a bend come out."],
  }[p.kind];
  out.push(...section("What Sprue checked, and what it did not", ["Checked:",
    `- The file is one closed body of ${fmt(cm3, 2)} cm³.${Number(s.volumeCm3) > 0 ? " That is the volume bom.json prices." : ""}`,
    `- The file is the export of cad/ and design.json as they are now.`,
    `- No engineer check fails.${flags.length ? ` The ${plural(flags.length, "flag")} above ${flags.length === 1 ? "is not a failure" : "are not failures"}.` : ""}`,
    "- The whole product passes its check (system.json). The parts fit together in the CAD.", "", "Not checked:",
    ...notChecked.map((x) => `- ${x}`), "- The shop's own design rules. Read its guide."]));

  // Sprue's price.
  const price: string[] = [];
  if (o.priced.length) {
    const q = o.priced;
    if (o.home) price.push(`Sprue's figure is the filament only: ${usd(q.reduce((t, x) => t + x.orderUsd, 0))} for ${q.reduce((t, x) => t + x.orderQty, 0)}. How Sprue worked it out: ${q.map((x) => md(x.basis, true)).join("; ")}.`);
    else {
      if (q.some((x) => x.mode === "estimate")) price.push("This is an estimate, not a quote.", "");
      for (const x of q) price.push(`The quote (quotes.json) buys it from ${md(x.supplier)}: ${usd(x.orderUsd)} for ${x.orderQty}. How Sprue worked it out: ${md(x.basis, true)}.`);
    }
    const phased = o.phases.filter((ph) => ph.lines.length);
    if (phased.length) price.push("", `In two orders: ${phased.map((ph) => `order ${ph.name} buys ${ph.lines.map((x) => `${x.orderQty} from ${md(x.supplier)} for ${usd(x.orderUsd)}`).join(" and ")}`).join("; ")}.`);
    for (const shop of [...new Set(q.map((x) => x.supplier))]) {
      const ship = input.quotes?.lines.find((x) => x.lineId === `ship:${shop}`);
      const byPhase = (input.quotes?.phases ?? []).map((ph) => ({ name: ph.name, ship: ph.lines.find((x) => x.lineId === `ship:${shop}`) }))
        .filter((x): x is { name: string; ship: QuoteLine } => !!x.ship);
      const others = (input.quotes?.lines ?? []).filter((x) => x.supplier === shop && !x.lineId.startsWith("ship:") && x.lineId !== l.id)
        .map((x) => bom.lines.find((b) => b.id === x.lineId)).filter((b): b is BomLine => !!b);
      const files = others.map((b) => { const st = exportOf(input.dir, b); return st ? `\`../${b.id}/${input.slug}-${st}.${kindOf(b) === "cnc" || kindOf(b) === "sheet" ? "step" : "stl"}\`` : undefined; })
        .filter((f): f is string => !!f);
      const cart = others.length ? ` ${others.map((b) => `${b.id} (${md(b.name)})`).join(", ")} ${others.length === 1 ? "shares" : "share"} it. Put ${others.length === 1 ? "both" : "them all"} in one cart, or you pay shipping twice: upload ${files.length ? `${files.join(" and ")} in the same upload as this part's file` : "their files in the same upload as this part's"}, and pick one partner for all.` : "";
      if (byPhase.length > 1) price.push("", `Shipping at ${md(shop)}: ${byPhase.map((x) => `${usd(x.ship.orderUsd)} for order ${x.name}`).join(" and ")}, since each order ships on its own. Where it comes from: ${sentence(byPhase[0].ship.basis)}${cart}`);
      else if (ship) price.push("", `Shipping: ${usd(ship.orderUsd)} once for the ${md(shop)} order. Where it comes from: ${sentence(ship.basis)}${cart}`);
      const listing = SHOPS.find((x) => x.name === shop)?.listings.find((x) => x.kind === p.kind);
      if (listing?.priceNote && (!listing.noteIfShipped || ship || byPhase.length)) price.push("", listing.priceNote);
    }
    const italy = o.home ? [] : italyOf(input).filter((x) => x.cart.ids.includes(l.id));
    price.push("", o.home ? `Prices are in USD, for request.json's region (${md(input.region)}). They leave out VAT. The price at the shop's checkout is the price.`
      : vatText(input, q, italy));
    out.push(...section("Sprue's price", price));
    if (italy.length) out.push(...section("In Italy, in euros", italyText(input, o, italy)));
  } else {
    price.push(`Not priced: ${md(whyUnpriced(l, input.rates))}`);
    if (!o.home) price.push("", "Get a price from a shop below.");
    out.push(...section("Sprue's price", price));
  }

  // The shops.
  if (o.home) {
    out.push(...section("Print it yourself", [`bom.json pins it to your own printer, so no shop is listed.`, "",
      `1. Slice \`${o.upload}\` in mm, in ${p.material}.`, "2. Check the slicer shows the size above.", `3. Print ${o.split ? howMany(p) : o.part.n}.`]));
  } else {
    const { listed, not } = shopsFor(p, first);
    const shops: string[] = [`Read on ${READ}.`, ""];
    listed.forEach(({ shop, listing }, i) => {
      shops.push(`### ${i + 1}. ${shop.name} (${shop.who})`, "");
      if (shop.person) shops.push(shop.person, "");
      const here = o.priced.some((x) => x.supplier === shop.name) ? "The quote buys it here. " : l.pin?.supplier === shop.name ? "bom.json pins it here. " : "";
      shops.push(`${here}${listing.intro}`, "");
      listing.steps(p).forEach((x, j) => shops.push(`${j + 1}. ${x}`));
      const facts = listing.facts(p);
      shops.push("", "Its pages say:", ...facts.map((f) => `- ${f.text}`), "",
        sourcesText(facts.flatMap((f) => f.src)), "");
    });
    if (!listed.length) shops.push("No shop Sprue knows makes it as bom.json gives it. Ask a shop of your own, or change the material.", "");
    if (not.length) shops.push(`Not listed for ${p.material}:`, ...not.map(({ shop, why }) => `- ${shop.name} (${shop.who.split(", ").at(-1)}). ${why}`), "");
    if (listed.some(({ shop }) => shop.from !== "eu"))
      shops.push(...euImport(input.written, listed.some(({ shop }) => shop.hosts.some((h) => h.startsWith("jlc"))), listed.some(({ shop }) => shop.id === "craftcloud")));
    out.push(...section("Shops", shops.slice(0, -1)));
  }

  // Bringing a price back.
  if (!o.home) {
    if (o.priced.length) out.push(...section("When you have the shop's price", [
      "Sprue can't take a print shop's quote back yet. Its own figure comes from rates.json and stays as it is.", "",
      `If the shop's price is far from ${usd(o.priced.reduce((t, x) => t + x.orderUsd, 0))}, tell Claude the shop, the price and the date. Claude adds a line to design.json's costNotes. The build plan shows cost notes under its total. Keep the quote outside this folder.`]));
    else out.push(...section("When you have the shop's price", [
      "Sprue keeps no made part's price yet, so the part comes back as a bought one:", "",
      "1. Keep this ORDER.md and the quote outside this folder.",
      `2. In bom.json, set ${l.id}'s \`process\` to "buy" and keep its \`file\`.`,
      `3. In catalog.json, add the quote under \`offers.${l.id}\`:`,
      "   ```",
      `   {"supplier": "<shop>", "sku": "<quote number>", "url": "<its page>",`,
      `    "priceBreaks": [{"qty": ${o.part.n}, "unitUsd": <price a piece in USD>}],`,
      `    "stock": "unknown", "leadDays": <days>, "source": "snapshot", "capturedAt": "<date>",`,
      `    "note": "quote for ${src} sha256 ${sha256(bytes).slice(0, 12)}"}`,
      "   ```",
      "   Then add the shop under `shipping`.",
      `4. Run \`sprue all ${slug}\`.`, "",
      `The line is then a bought part, so this folder goes.${metal ? " The made-metal warning no longer shows for it." : ""} A quote of an earlier file is not this part's price.`]));
  }
  out.push(STOP, "");
  return out.join("\n");
}

// ---- in Italy, in euros (the numbers are landed.ts's) -------------------------------------------------------------

/** A basis or note from quotes.json as the end of a sentence: made safe, with one full stop. */
const sentence = (v: unknown) => `${md(v, true).replace(/[\s.]+$/, "")}.`;

/** The carts of the parts handed off to a shop, in euros, landed in Italy. */
function italyOf(input: HandoffInput): Landed[] {
  const ids = new Set(handoffLines(input.dir, input.bom).filter((l) => !homePinned(l)).map((l) => l.id));
  return cartsOf(input.quotes, ids).map((c) => landed(c, input.fx));
}

const eur = (n: number) => `€${n.toFixed(2)}`;
const span = ([a, b]: [number, number]) => (eur(a) === eur(b) ? eur(a) : `${eur(a)} to ${eur(b)}`);
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const cartName = (x: Landed) => `${md(x.cart.shop)}${x.cart.order ? `, order ${md(x.cart.order)}` : ""}`;
const riderIds = (x: Landed) => [...new Set(x.cart.riders.map((r) => r.id))].filter((id) => !x.cart.ids.includes(id)).map((id) => md(id));
/** Every line in the parcel: the made parts, then what rides with them. */
const parcelIds = (x: Landed) => [...x.cart.ids.map((id) => md(id)), ...riderIds(x)];
/** How many items the duty and the fee count, said. */
const itemsText = (x: Landed) => {
  const [k, n] = x.items;
  if (k === n) return `${plural(n, "item")}`;
  return `${k} to ${n} items (${k === 1 ? `1 if ${and(parcelIds(x))} go on one line of the customs declaration, with one tariff classification and description`
    : `${k} if the made parts go on one line of the customs declaration and what rides with them on another`}, ${n} if each has a line of its own)`;
};
/** Where the parcel comes from, said. */
const fromText = (x: Landed) => (x.rule?.from === "outside" ? `From ${md(x.cart.shop)}, outside the EU` : "From a partner outside the EU");
const DDP = "DDP (delivered duty paid: the shop collects the import charges at its checkout)";
/** The courier's fee for paying the duty and tax, as JLCPCB's FAQ gives it for Italy. */
const COURIER_FEES = "DHL €5 where the duty and tax come to under €5 (else 2.5%, at least €16), UPS €8.85 on a parcel worth under €22 (else 3%, at least €18.45), FedEx 2.5%, at least €15";
/** The ORDER.md's sources for the euro figures of `carts`: the rate's page, then the rules'. */
const italySources = (fx: Fx, carts: Landed[]) => sourcesText(["EU_VAT", "IT_VAT", "EU_DUTY", "A2M", "REVENUE_HOW", "REVENUE_PR", "EU_UHF_GUIDE",
  ...carts.flatMap((x) => x.cart.shop === "Craftcloud" ? ["S3"] : x.cart.shop === "JLC3DP" ? ["JLC_USTAX", "S11", "JLC_EU_FAQ", ...(x.near ? ["JLC_VAT"] : [])] : [])],
  [`${fx.url} (read ${fx.read})`]);

/** The rate the euro figures use, how old it is, and that the prices are for request.json's region. */
function rateText(input: HandoffInput): string {
  const fx = input.fx, age = fxAge(fx, input.written);
  return `At the ECB's reference rate of ${fx.date}, 1 EUR = ${fx.usdPerEur} USD (Sprue's pipeline/fx.json, read ${fx.read}). The ECB publishes it for information only: the shop and your card convert at their own rates.`
    + (age > FX_OLD_DAYS ? ` The rate is ${age} days older than this folder, so the euro figures may be off: update pipeline/fx.json from the ECB's page and run \`sprue handoff\` again.`
      : ` If you order more than a month after ${fx.date}, update pipeline/fx.json from the ECB's page and run \`sprue handoff\` again.`)
    + ` These are Sprue's prices, for request.json's region (${md(input.region)}), landed in Italy: a shop may price an order to Italy differently.`;
}

/** What Sprue's price holds of VAT, under Sprue's price: by each shop's rule, and where the euro figures are. */
function vatText(input: HandoffInput, q: QuoteLine[], italy: Landed[]): string {
  const out = [`Prices are in USD, for request.json's region (${md(input.region)}).`];
  for (const shop of new Set(q.map((x) => x.supplier))) {
    const r = ITALY[shop];
    out.push(r?.allIn ? `Sprue did not confirm whether its ${md(shop)} rate holds VAT and shipping, as ${md(shop)}'s own price does.`
      : r ? `Its ${md(shop)} rate leaves out VAT.` : `Sprue did not confirm whether its ${md(shop)} price holds VAT.`);
  }
  out.push("None holds import duty or the EU's handling fee. What you pay the shop is its checkout price, not Sprue's figure, and from outside the EU import charges can come after it.");
  if (italy.some((x) => x.eu || x.outside)) out.push("\"In Italy, in euros\", below, gives a low and a high figure, neither with the courier's own fee.");
  else if (italy.length) out.push("\"In Italy, in euros\", below, gives Sprue's figure in euros and says why it gives no landed one.");
  return out.join(" ");
}

/** An ORDER.md's "In Italy, in euros": this part's own figure, then each cart it is in, then the sources. */
function italyText(input: HandoffInput, o: Order, carts: Landed[]): string[] {
  const fx = input.fx, ownUsd = o.priced.reduce((t, x) => t + x.orderUsd, 0), taxed = o.priced.some((x) => ITALY[x.supplier]?.usTax);
  const own = cents(o.priced.reduce((t, x) => t + toEur(x.orderUsd, fx, ITALY[x.supplier]?.usTax), 0));
  const lessTax = o.priced.reduce((t, x) => t + x.orderUsd / (ITALY[x.supplier]?.usTax ?? 1), 0);
  const out = [rateText(input), "",
    `This part on its own: ${eur(own)} (${taxed ? `${usd(lessTax)} without the US advance tax; Sprue's figure is ${usd(ownUsd)}` : usd(ownUsd)}). ${carts.length > 1 ? "Each cart below adds" : "Its cart, below, adds"} the shipping, VAT and import charges.`, ""];
  for (const x of carts) out.push(...cartText(input, x), "");
  const sources = italySources(fx, carts);
  out.push(carts.length > 1 ? sources.replace(/^Sources: /, "Sources for every cart above: ") : sources);
  return out;
}

/** One cart's euro figures. */
function cartText(input: HandoffInput, x: Landed): string[] {
  const c = x.cart, r = x.rule, shop = md(c.shop), out = [`**The ${cartName(x)} cart: ${and(c.ids.map((id) => md(id)))}**`, ""];
  const noShip = x.ship === undefined, figures = !!(x.eu || x.outside), after = noShip && !r?.allIn ? ", before shipping" : "";
  const shipping = !noShip ? `The quote's shipping for it is ${eur(x.ship!)} (${usd(c.shipUsd!)}), for request.json's region (${md(input.region)}), not a price to Italy. Where it comes from: ${sentence(c.shipBasis)}`
    : r?.allIn ? `The quote counts no shipping for ${shop}, whose own price holds regular shipping${figures ? ": the high figures below are before any shipping" : ""}.`
    : `The quote counts no shipping for ${shop}${figures ? ", so the figures below are before shipping" : ""}: ${shop} gives it at checkout.`;
  const ridersText = c.riders.length ? [`The parcel also holds ${and(riderIds(x))}, bought from ${and([...new Set(c.riders.map((y) => md(y.supplier)))])} in the same checkout (catalog.json shipsWith), worth ${eur(x.riders)}. They count toward the €150 and the items below, but their own price and VAT are not in these figures.`, ""] : [];
  if (!r) {
    out.push(`Sprue's figure for the parts: ${eur(x.parts)} (${usd(c.partsUsd)}). ${shipping}`, "", ...ridersText,
      `Sprue has no rule for the charges into Italy from ${shop}, so it gives no landed figure.`);
    return out;
  }
  out.push(r.usTax ? `Sprue's figure for the parts is ${usd(c.partsUsd)}. It holds the ${Math.round((r.usTax - 1) * 100)}% US advance tax ${shop} collects on orders to the US only: without it, ${usd(c.partsUsd / r.usTax)}, or ${eur(x.parts)}. ${shipping}`
    : `Sprue's figure for the parts: ${eur(x.parts)} (${usd(c.partsUsd)}). ${shipping}`, "", ...ridersText);
  const worth = `the parcel is worth ${eur(x.value)} (the goods, without shipping), ${x.small ? "up to €150" : "over €150"}${x.near ? ` (within €${NEAR_EUR} of it: customs converts at its own rate${r.from === "outside" && !r.allIn ? ", and JLCPCB's VAT page says JLC collects VAT at checkout on orders up to $170" : ""}, so it may fall on either side)` : ""}`;
  if (x.eu) out.push(r.allIn
    ? `From a partner in the EU: ${span(x.eu)}. ${shop}'s own price holds regular shipping and VAT where it applies (${r.allIn}), and a parcel from inside the EU clears no customs, so its checkout price is the whole price. Sprue did not confirm whether its rate holds them: ${eur(x.eu[0])} is the parts as Sprue prices them, as if its rate holds both, and ${eur(x.eu[1])} adds ${noShip ? "22% VAT, before any shipping" : "the quote's shipping and 22% VAT"}.`
    : `From a partner in the EU: ${eur(x.eu[0])}${after}, with 22% VAT and no customs.`, "");
  const [k, n] = x.items, declare = `for ${itemsText(x)}: you have no say in how the seller declares the parcel`;
  if (x.outside) out.push(r.allIn
    ? `${fromText(x)}: ${span(x.outside)}, and the courier's own fee if it collects VAT or duty on delivery. T${worth.slice(1)}, so the EU's €3 duty and €2 handling fee come on top, ${declare}. The low figure, ${eur(x.outside[0])}, is the parts as Sprue prices them, as if its rate holds VAT and shipping as ${shop}'s price does and the checkout collects that VAT, plus ${eur((3 + 2) * k)}: the duty and the fee for ${plural(k, "item")}, the fee without VAT, as when you pay it at clearance. The high one, ${eur(x.outside[1])}, adds ${noShip ? "" : "the quote's shipping, "}a duty and a fee for each of ${n} items, and 22% VAT on the parts, ${noShip ? "" : "shipping, "}duties and fees, as when the courier collects the VAT on delivery${noShip ? ", before any shipping" : ""}. See the import charges under Shops.`
    : `${fromText(x)}: ${span(x.outside)}${after}, and the courier's fee for paying the duty for you. T${worth.slice(1)}, so its IOSS (the EU's Import One-Stop Shop) adds 22% VAT at checkout, and the EU's €3 duty and €2 handling fee come on top, ${declare}. The low figure counts the €2 fee without VAT, as when you pay it at clearance; the high one with VAT, €2.44, as when the seller charges it at checkout.${r.ddp ? ` JLC says the courier's fee is charged with ${DDP} or without: at its checkout with DDP, by the courier on delivery without. JLCPCB's FAQ gives Italy's as ${COURIER_FEES}.` : ""} See the import charges under Shops.`);
  else out.push(`${fromText(x)}: ${worth}, so the duty is the parts' own tariff rate, not €3, and the VAT and the courier's fee are paid on import${r.ddp ? `, or at the checkout if the parcel ships ${DDP}` : ""}, with the EU's €2 handling fee ${declare}. Sprue can't price the duty or the courier's fee, so it gives no figure from outside the EU. See the import charges under Shops.`);
  return out;
}

/** README.md's "In Italy, in euros": a row a cart, then what the rows mean, from the carts in them. */
function italyTable(input: HandoffInput, carts: Landed[]): string[] {
  const row = (x: Landed) => {
    const r = x.rule, noShip = x.ship === undefined, after = noShip && !r?.allIn ? ", before shipping" : "";
    const figure = `${eur(cents(x.parts + (x.ship ?? 0)))}${r?.usTax ? " without the US tax" : ""}${noShip ? ", before shipping" : ""}`;
    const eu = !r ? "No rule" : x.eu ? `${span(x.eu)}${after}` : "None: it ships from outside the EU";
    const outside = !r ? "No rule" : x.outside ? `${span(x.outside)}${after}` : "Over €150: no figure";
    const riders = riderIds(x);
    return `| ${cartName(x)} | ${and(x.cart.ids.map((id) => md(id)))}${riders.length ? `, with ${and(riders)} riding along` : ""} | ${figure} | ${eu} | ${outside} |`;
  };
  const allIn = carts.filter((x) => x.rule?.allIn && x.eu), shops = (xs: Landed[]) => and([...new Set(xs.map((x) => md(x.cart.shop)))]);
  const notes = [
    ...(allIn.length ? [`From a partner in the EU, the shop's checkout price is the whole price, and that column is Sprue's estimate of it: pick a partner in the EU where you can. Sprue did not confirm whether its ${shops(allIn)} rate holds VAT and shipping, as the shop's own price does, so the low figure is as if it holds both and the high one as if it holds neither.`] : []),
    ...(allIn.some((x) => x.ship !== undefined) ? [`Sprue's figure adds the quote's shipping, which ${shops(allIn.filter((x) => x.ship !== undefined))}'s own price may already hold.`] : []),
    ...(allIn.some((x) => x.ship === undefined) ? [`The quote counts no shipping for ${shops(allIn.filter((x) => x.ship === undefined))}, so its high figures are before any shipping.`] : []),
    ...(carts.some((x) => x.outside) ? ["From outside the EU, the low figure counts the fewest items the seller can declare the parcel as and the high one an item a line, each item with the €3 duty and the €2 handling fee, and how the VAT is paid moves them too."] : []),
    ...(carts.some((x) => x.ship !== undefined) ? [`Sprue's shipping is the quote's, for request.json's region (${md(input.region)}), not a price to Italy.`] : []),
    ...(carts.some((x) => x.ship === undefined && x.rule && !x.rule.allIn) ? ["Where a figure says before shipping, the quote counts none: the shop gives it at checkout."] : []),
    ...(carts.some((x) => x.eu || x.outside) ? [`No figure holds the courier's own fee for collecting VAT or duty${carts.some((x) => x.rule?.ddp) ? `: JLCPCB's FAQ gives Italy's as ${COURIER_FEES}` : ""}.`] : []),
    ...(carts.some((x) => x.cart.riders.length) ? ["A line riding along is in the same parcel (catalog.json shipsWith): it counts toward the €150 and the items, but its own price and VAT are not in these figures."] : []),
    ...(carts.some((x) => x.rule && !x.small) ? ["Over €150 from outside the EU, Sprue gives no figure: the duty is the parts' own tariff rate, and the VAT, the €2 handling fee and the courier's fee are paid on import."] : []),
    ...(carts.some((x) => !x.rule) ? ["A shop with no rule gets Sprue's figure only."] : []),
    "Each part's ORDER.md says how its cart's figures are worked out.",
  ];
  return ["## In Italy, in euros", "", rateText(input), "",
    "| Cart | Parcel | Sprue's figure | From a partner in the EU | From outside the EU |", "| --- | --- | --- | --- | --- |", ...carts.map(row), "",
    notes.join(" "), ""];
}

/** The block on charges into the EU from a shop outside it; with JLC, where its IOSS collects the VAT. `written` is
 * the folder's date: Italy's own €2 was put off to 1 January 2027 and the €3 duty runs to 1 July 2028, and Sprue has
 * not read what applies after either. */
function euImport(written: string, jlc: boolean, craftcloud = false): string[] {
  return ["### Import charges into the EU, from a shop outside it", "",
    "- VAT at your country's rate, on a parcel of any value. Italy's is 22%. A seller in IOSS (the EU's Import One-Stop Shop, for parcels up to €150) collects it at its checkout. Otherwise the courier collects it on delivery and usually charges a clearance fee of its own.",
    ...(craftcloud ? ["- Craftcloud's price includes VAT where it applies (its terms, 8.1.2), but not customs, duties or import taxes, which are billed to you separately (8.2). Sprue did not confirm that a partner outside the EU collects the VAT at checkout: if its checkout shows no VAT, expect the courier to collect 22% and a fee on delivery."] : []),
    `- A €3 customs duty per item on a parcel worth up to €150 sold to a consumer, from 1 July 2026 to 1 July 2028. An item is goods with the same tariff classification and description (and origin, where declared), however many pieces: customs charge it per line of the customs declaration${jlc ? ", which is what JLC calls a line item" : ""}. The seller declares the parcel, not you.`
      + (written >= "2028-07-01" ? " This folder is dated after 1 July 2028, when the €3 was to end: Sprue has not read what replaced it, and its figures still count it." : ""),
    ...(jlc ? [`- Up to €150 a parcel (JLCPCB's VAT page draws the line at orders of 170 US dollars), JLC's IOSS collects the VAT at its checkout, but not the €3, which you pay on import, or at its checkout if the parcel ships ${DDP}. The courier charges a fee for paying it, with DDP or without (JLCPCB's FAQ).`] : []),
    `- Over €150 a parcel, the VAT, the duty at the goods' own tariff rate and the courier's fees are all paid on import${jlc ? " (no IOSS), or at the checkout with DDP" : ""}.`,
    "- The EU's handling fee: €2 per item, counted as the duty is, on a parcel of any value sold to a consumer, since 1 November 2026. Whoever declares the parcel (the seller, platform, carrier or its agent) owes it, not you, but may pass it on to you: in the checkout price, or at clearance"
      + (jlc ? ", as JLCPCB's FAQ says you pay it on its IOSS parcels" : "") + ". BEUC says a courier must not claim it from you later."
      + " It bears no VAT when you pay it at clearance of a parcel whose VAT IOSS collected, and 22% (€2.44 in Italy) when the seller charges it at checkout or the courier collects the import VAT.",
    written < "2027-01-01"
      ? "- Italy's own €2 a parcel, on imports up to €150: a decree of 23 October 2026 (still to be made law) put it off to 1 January 2027, and the 2027 budget bill would repeal it. Sprue does not count it: on an order from 1 January 2027, ask the shop whether it is charged."
      : "- Italy's own €2 a parcel, on imports up to €150, was put off to 1 January 2027 by a decree of 23 October 2026, and the 2027 budget bill would repeal it. Sprue has not read whether it is charged now, and does not count it: ask the shop.",
    "- A business order always goes through formal customs.", "",
    sourcesText(["S11", "S12", ...(jlc ? ["JLC_EU_FAQ", "JLC_VAT"] : []), ...(craftcloud ? ["S3"] : []), "EU_VAT", "IT_VAT", "COUNCIL", "EU_DUTY", "A2M", "REVENUE", "REVENUE_HOW", "REVENUE_PR", "EU_UHF_GUIDE", "THE_LOCAL", "IT_DL193", "IT_BUDGET"]), ""];
}

/** fab/order/'s README.md. */
function readme(input: HandoffInput, orders: Order[]): string {
  const { slug, checks } = input;
  const flags = checks.checks.filter((c) => c.status === "flag" && (c.id.startsWith("print-") || orders.some((o) => c.lines?.includes(o.part.line.id))));
  const out = [`# The made parts of ${slug}, ready to order`, "",
    `\`sprue handoff ${slug}\` wrote this folder on ${input.written}. Run \`sprue status ${slug}\` before you upload. It removes this folder if anything it was made from has changed.`, "",
    "Every check passed first:",
    `- No engineer check fails (${checks.checks.length} ran).${flags.length ? ` ${plural(flags.length, "flag")} (${flags.map((c) => md(c.id)).join(", ")}) ${flags.length === 1 ? "is" : "are"} about the made parts: each ORDER.md lists ${flags.length === 1 ? "it" : "them"}.` : ""}`,
    "- Each part file is the export of cad/ as it is now, and one closed body (of the volume bom.json prices, where it gives one).",
    "- The whole product passes its check (system.json).", "",
    "Nothing has been uploaded, quoted or ordered. Sprue writes this folder whole and removes it when it is out of date. Keep nothing of yours in it.", "",
    "| Part | Folder | Made by | Material | How many | Upload | Sprue's price |", "| --- | --- | --- | --- | --- | --- | --- |",
    ...orders.map((o) => `| ${md(o.part.line.name)} | ${o.part.line.id}/ | ${o.home ? "3D print, at home" : MADE_BY[o.part.kind]} | ${o.part.material} | ${o.part.n} | ${o.upload} | ${priceWords(o)} |`), ""];
  const bySupplier = new Map<string, string[]>();
  for (const o of orders) for (const s of new Set(o.priced.map((x) => x.supplier))) bySupplier.set(s, [...(bySupplier.get(s) ?? []), o.part.line.id]);
  const together = [...bySupplier].filter(([, ids]) => ids.length > 1 && !orders.find((o) => o.part.line.id === ids[0])?.home);
  if (together.length) out.push("## Order together", "", ...together.map(([s, ids]) => {
    const ship = input.quotes?.lines.find((x) => x.lineId === `ship:${s}`);
    const phased = (input.quotes?.phases ?? []).filter((ph) => ph.lines.some((x) => x.lineId === `ship:${s}`)).length > 1;
    return `- ${md(s)}: ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}. Put ${ids.length === 2 ? "both" : "them all"} in one cart: upload their files in the same upload, and pick one partner for all.${phased ? " Sprue counts its shipping once an order." : ship ? ` Sprue counts its ${usd(ship.orderUsd)} shipping once.` : ""}`;
  }), "");
  const italy = italyOf(input);
  if (italy.length) out.push(...italyTable(input, italy));
  out.push("## Not here", "",
    `- The board. Its files are in pcb/order/, from \`sprue verify ${slug}\`.`,
    `- The bought parts. They are in production/order-list.csv, or run \`sprue bom ${slug}\`.`,
    "- A part bought to a spec sheet, such as a spring, a magnet or a motor. Sprue writes no request for a quote yet.",
    "- Drawings (PDF) and flat patterns (DXF). Sprue writes neither yet.",
    "- What Sprue can't land in Italy: a part with no price or printed at home; the courier's own fees; shipping where the quote counts none; and from outside the EU, a parcel over €150 (its duty at the parts' tariff rate, the VAT and the €2 handling fee). And the landed cost in any other country.",
    "- Each shop's own design rules. No check here reads them.", "",
    "## Shops left out", "", ...LEFT_OUT.map((x) => `- ${x}`), "", STOP, "");
  return out.join("\n");
}

/** One file of fab/order/: its bytes, and for a copy, the file in the product it is a copy of. */
export type Entry = { bytes: Buffer; from?: string };

/** fab/order/ as `sprue handoff` writes it from `input`, by path in the folder; order.json last. Reads the part files
 * and previews, so it throws when one can't be read. */
export function renderHandoff(input: HandoffInput): Map<string, Entry> {
  const files = new Map<string, Entry>();
  const orders = handoffLines(input.dir, input.bom).map((l) => orderOf(input, l));
  files.set("README.md", { bytes: Buffer.from(readme(input, orders)) });
  for (const o of orders) {
    const id = o.part.line.id, preview = `previews/${o.stem}.svg`, src = `fab/${o.stem}.${o.ext}`;
    const hasPreview = existsSync(join(input.dir, preview));
    if (hasPreview) files.set(`${id}.svg`, { bytes: readFileSync(join(input.dir, preview)), from: preview });
    const bytes = readFileSync(join(input.dir, src));
    files.set(`${id}/${o.upload}`, { bytes, from: src });
    files.set(`${id}/ORDER.md`, { bytes: Buffer.from(orderMd(input, o, bytes, hasPreview)) });
  }
  const record = { written: input.written, files: Object.fromEntries([...files].map(([p, e]) => [p, sha256(e.bytes)])) };
  files.set("order.json", { bytes: Buffer.from(`${JSON.stringify(record, null, 2)}\n`) });
  return files;
}

/** Sprue's price of each part as the command prints it once written: "top (macropad-top.stl, $6.00 at Craftcloud, an
 * estimate)". */
export function handoffSummary(input: HandoffInput): { id: string; text: string; priced: boolean }[] {
  return handoffLines(input.dir, input.bom).map((l) => orderOf(input, l))
    .map((o) => ({ id: o.part.line.id, text: `${o.part.line.id} (${o.upload}, ${priceWords(o)})`, priced: o.priced.length > 0 }));
}

// ---- writing, and removing ------------------------------------------------------------------------------------

/** Removes fab/order/ (and a half-written one). Returns whether there was one. */
export function clearHandoff(dir: string): boolean {
  const there = existsSync(join(dir, "fab", HANDOFF_DIR));
  rmSync(join(dir, "fab", HANDOFF_DIR), { recursive: true, force: true });
  rmSync(join(dir, "fab", `${HANDOFF_DIR}.part`), { recursive: true, force: true });
  return there;
}

/** Writes fab/order/ whole: into fab/order.part/ first, then renamed into place; a half-written one is removed. Returns
 * the paths written, relative to fab/order/. */
export function writeHandoff(dir: string, files: Map<string, Entry>): string[] {
  const part = join(dir, "fab", `${HANDOFF_DIR}.part`);
  clearHandoff(dir);
  try {
    for (const [path, e] of files) {
      mkdirSync(dirname(join(part, path)), { recursive: true });
      writeFileSync(join(part, path), e.bytes);
    }
    renameSync(part, join(dir, "fab", HANDOFF_DIR));
  } catch (error) {
    rmSync(part, { recursive: true, force: true });
    throw error;
  }
  return [...files.keys()];
}

/** Why fab/order/ is not what `sprue handoff` would write now, or undefined when it is (or there is none): no
 * order.json, a file it is made from that is missing or doesn't parse (bom.json, checks.json; design.json, quotes.json
 * or request.json when there), a bom.json line Sprue can't read, a check that fails in checks.json, a made line's own
 * problem, a quote not of the files as they are, a whole product that fails its check, a folder Sprue would now write
 * otherwise (rebuilt with order.json's own date), or a file in it changed by hand. Each ORDER.md says a folder still
 * there is current, so whatever can't be tied to the parts as they are is a reason; it is quick to write again. A file
 * added to it is not a reason. A rules.ts edit with no `sprue check` after it is not seen. */
export function handoffStaleness(dir: string): string | undefined {
  const folder = join(dir, "fab", HANDOFF_DIR);
  if (!existsSync(folder)) return undefined;
  let rec: { written?: unknown; files?: unknown };
  try {
    rec = JSON.parse(readFileSync(join(folder, "order.json"), "utf8"));
  } catch {
    return "it has no order.json to tie it to the parts";
  }
  if (typeof rec?.written !== "string" || !rec.files || typeof rec.files !== "object" || Array.isArray(rec.files))
    return "it has no order.json to tie it to the parts";
  const was = rec.files as Record<string, unknown>;
  let input: HandoffInput;
  try {
    input = handoffInput(dir, rec.written);
  } catch (e) {
    return `${errorText(e)}, so it can't be tied to the parts`;
  }
  const shape = bomShapeProblems(input.bom)[0];
  if (shape) return `bom.json: ${shape}`;
  if (!Array.isArray(input.checks?.checks) || input.checks.checks.some((c) => !c || typeof c !== "object"))
    return "checks.json is not a list of checks, so it can't be tied to the parts";
  try {
    return staleness(dir, folder, input, was);
  } catch (e) {
    return `the parts can't be checked now (${errorText(e)})`;
  }
}

function staleness(dir: string, folder: string, input: HandoffInput, was: Record<string, unknown>): string | undefined {
  const failed = input.checks.checks.find((c) => c.status === "fail");
  if (failed) return `check ${failed.id} fails (checks.json)`;
  if (!handoffLines(dir, input.bom).length) return "bom.json has no printed, CNC or sheet-metal part now";
  const own = lineProblems(dir, input.bom)[0];
  if (own) return own;
  const quote = quoteProblems(dir)[0];
  if (quote) return quote;
  const whole = wholeProduct(dir, input.bom);
  if (!whole.ok) return `the whole-product check no longer passes on these parts: ${whole.detail}`;
  let now: Map<string, Entry>;
  try {
    now = renderHandoff(input);
  } catch {
    return "its part files or previews can't be read now";
  }
  now.delete("order.json");
  for (const path of new Set([...now.keys(), ...Object.keys(was)])) if (!now.has(path) || !(path in was)) return `the made parts changed (${path})`;
  for (const [path, e] of now) {
    if (sha256(e.bytes) === was[path]) continue;
    return e.from ? `${e.from} is not the file it was copied from` : `${path} would now say something else: the quantity, the spec, the price, the flags, the shops or pipeline/fx.json's rate changed since sprue handoff wrote it`;
  }
  for (const path of Object.keys(was)) {
    let held: Buffer;
    try {
      held = readFileSync(join(folder, path));
    } catch {
      return `${path} was removed or changed by hand since sprue handoff wrote it`;
    }
    if (sha256(held) !== was[path]) return `${path} was changed by hand since sprue handoff wrote it`;
  }
  return undefined;
}

/** Removes fab/order/ when it is out of date (handoffStaleness). Returns why, or undefined. */
export function dropStaleHandoff(dir: string): string | undefined {
  const why = handoffStaleness(dir);
  if (why) clearHandoff(dir);
  return why;
}
