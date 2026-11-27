// Made parts. PCBs and plastic prints are priced by rule: a supplier's published pricing rule turned into code
// ("scripted"), or a print service's rate ("estimate"). Rates live in pipeline/rates.json with their source URL and
// the date they were read, so a stale rate is easy to spot. A print pinned to "home" is printed on the user's own
// printer: it costs the filament it uses, priced from catalog.json `filament` (a page Claude read), with no shipping.
// A CNC part, a sheet-metal part or a print in metal has no rule: none of the shops that make them publishes one, so it
// is priced only from a shop's quote for its file that a person read at the shop and recorded in catalog.json (an
// offer with a `shopQuote`, which its ORDER.md from `sprue handoff` says how to write). Nothing here fetches.

import { basename, posix } from "node:path";
import type { BomLine, Offer, QuoteLine } from "../types.ts";
import { printedInMetal } from "../limits.ts";

export type Rate = { url: string; capturedAt: string; leadDays: number; verified: boolean };
/** catalog.json `filament`, by material: a spool's price per kg and the material's density, each read from a page. */
export type Filament = { usdPerKg: number; gPerCm3: number; url: string; capturedAt: string; densityUrl?: string; leadDays?: number };
/** The supplier name a home-printed line is quoted under. */
export const HOME = "Home printer";
/** A print pinned to the user's own printer: pin { supplier: "home" } (or "Home printer"). */
export const homePinned = (line: BomLine) => line.process === "print" && !!line.pin && /^home( printer)?$/i.test(line.pin.supplier.trim());
export type FabRates = {
  pcb: {
    oshpark?: Rate & { usdPerSqIn2Layer: number; boardsPerOrder: number; shippingUsd: number };
    jlcpcb?: Rate & { baseUsd: number; boards: number; maxMm: number; shippingUsd: number };
  };
  /** materials: what the service prints at this rate (matched against spec.material); absent means any. */
  print: Record<string, Rate & { usdPerCm3: number; minPerPartUsd: number; shippingUsd: number; name: string; materials?: string[] }>;
  /** From the product's catalog.json, not rates.json: filament prices for prints made at home. */
  filament?: Record<string, Filament>;
  /** From the product's catalog.json, not rates.json: its offers by line, where the shops' quotes for made parts are. */
  shopQuotes?: Record<string, Offer[]>;
};

const round = (x: number) => Math.round(x * 100) / 100;

function pcbOptions(line: BomLine, need: number, r: FabRates["pcb"]): QuoteLine[] {
  const w = Number(line.spec.widthMm), h = Number(line.spec.heightMm);
  const layers = Number(line.spec.layers);
  const out: QuoteLine[] = [];
  if (r.oshpark && layers === 2) {
    const sqIn = (w * h) / 645.16;
    const orders = Math.ceil(need / r.oshpark.boardsPerOrder);
    out.push({
      lineId: line.id, supplier: "OSH Park", sku: `2-layer ${w}x${h} mm`, mode: "scripted",
      needQty: need,
      orderQty: orders * r.oshpark.boardsPerOrder,
      orderUsd: round(orders * sqIn * r.oshpark.usdPerSqIn2Layer + r.oshpark.shippingUsd),
      leadDays: r.oshpark.leadDays,
      basis: `${sqIn.toFixed(2)} sq in x $${r.oshpark.usdPerSqIn2Layer}/sq in per ${r.oshpark.boardsPerOrder} boards (${r.oshpark.url}, ${r.oshpark.capturedAt}${r.oshpark.verified ? "" : ", unverified"})`,
    });
  }
  if (r.jlcpcb && layers === 2 && w <= r.jlcpcb.maxMm && h <= r.jlcpcb.maxMm) {
    const orders = Math.ceil(need / r.jlcpcb.boards);
    out.push({
      lineId: line.id, supplier: "JLCPCB", sku: `2-layer ${w}x${h} mm, ${r.jlcpcb.boards} pcs`, mode: "scripted",
      needQty: need,
      orderQty: orders * r.jlcpcb.boards,
      orderUsd: round(orders * r.jlcpcb.baseUsd + r.jlcpcb.shippingUsd),
      leadDays: r.jlcpcb.leadDays,
      basis: `$${r.jlcpcb.baseUsd} per ${r.jlcpcb.boards} boards up to ${r.jlcpcb.maxMm} mm + $${r.jlcpcb.shippingUsd} shipping (${r.jlcpcb.url}, ${r.jlcpcb.capturedAt}${r.jlcpcb.verified ? "" : ", unverified"})`,
    });
  }
  return out;
}

/** A print made on the user's own printer: the filament it uses, no shipping. No price without a filament entry. */
function homeOption(line: BomLine, need: number, filament: FabRates["filament"]): QuoteLine[] {
  const vol = Number(line.spec.volumeCm3);
  const material = String(line.spec.material ?? "");
  const f = Object.entries(filament ?? {}).find(([m]) => m.toUpperCase() === material.toUpperCase())?.[1];
  if (!f || !(f.usdPerKg > 0) || !(f.gPerCm3 > 0)) return [];
  const grams = vol * f.gPerCm3;
  return [{
    lineId: line.id, supplier: HOME, sku: [line.file ? basename(line.file) : line.name, line.spec.material].filter(Boolean).join(", "),
    mode: "scripted", needQty: need, orderQty: need,
    orderUsd: round((grams * f.usdPerKg / 1000) * need),
    leadDays: f.leadDays ?? 0,
    basis: `filament only, printed at home: ${vol} cm3 x ${f.gPerCm3} g/cm3 = ${round(grams)} g a part at $${f.usdPerKg}/kg (${f.url}, ${f.capturedAt}${f.densityUrl ? `; density ${f.densityUrl}` : ""}); supports, failed prints and power not counted`,
  }];
}

function printOptions(line: BomLine, need: number, r: FabRates["print"]): QuoteLine[] {
  const vol = Number(line.spec.volumeCm3);
  const material = String(line.spec.material ?? "").toUpperCase();
  // A rate only applies to the materials its service prints at that price. One with no list prints plastics: a part
  // printed in a metal (limits.ts) is not priced at a plastic's rate.
  const metal = printedInMetal(line);
  const fits = ([, s]: [string, FabRates["print"][string]]) =>
    s.materials ? s.materials.some((m) => m.toUpperCase() === material) : !metal;
  // A pinned print goes to the pinned service, like a pinned bought part.
  const pinned = (e: [string, FabRates["print"][string]]) => !line.pin || e[1].name === line.pin.supplier;
  // What to ask the print service for: the file, then material, process and colour as the BOM gives them.
  const what = [line.file ? basename(line.file) : line.name, line.spec.material, line.spec.process, line.spec.color]
    .filter(Boolean).join(", ");
  return Object.entries(r).filter(fits).filter(pinned).map(([, s]) => {
    const each = Math.max(vol * s.usdPerCm3, s.minPerPartUsd);
    const qty = need;
    return {
      lineId: line.id, supplier: s.name, sku: what, mode: "estimate" as const,
      needQty: qty,
      orderQty: qty,
      orderUsd: round(each * qty),
      leadDays: s.leadDays,
      basis: `${s.verified ? "" : "unverified rate, not a quote: "}${vol} cm3 x $${s.usdPerCm3}/cm3 (min $${s.minPerPartUsd}/part), shipping counted once per order (${s.url}, ${s.capturedAt}${s.verified ? "" : ", unverified"})`,
    };
  });
}

/** The offers catalog.json records for line `id` (shops' quotes among them), by the map's own keys: a line may be named
 * as a property every object has (constructor, toString), which a lookup would read as that property. */
export const shopQuotesOf = (rates: FabRates, id: string): Offer[] =>
  (rates.shopQuotes && Object.hasOwn(rates.shopQuotes, id) ? rates.shopQuotes[id] : []);

/** A made line priced only from a shop's quote: a CNC part, a sheet-metal part, or a print in metal not made at home. */
export const quotedPart = (l: BomLine) =>
  l.process === "cnc" || l.process === "sheet" || (l.process === "print" && !homePinned(l) && !!printedInMetal(l));

/** The file a shop's quote for the line is held to: its STL in fab/, which sprue cad exports with the STEP a shop is
 * sent. Not the STEP: OCC writes the time of export into it, so its bytes change on every export, while the STL's
 * change only with the shape. bom.json's path is read as written, made regular (./fab/x.step, fab//x.step) but not
 * looked up on disk, so the quote stays a function of the files it reads. Undefined for a line whose file is not one
 * sprue cad exports (fab/<part>.step or .stl). */
export function quotedFile(l: Pick<BomLine, "file">): string | undefined {
  const m = /^fab\/([^/]+)\.(step|stl)$/.exec(posix.normalize(String(l.file ?? "").replaceAll("\\", "/")));
  return m ? `fab/${m[1]}.stl` : undefined;
}

/** A value as JSON with its keys in order, so two specs that differ only in the order of their keys are one. */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v) ?? "null";

/** What changed in a spec since a shop quoted it, one entry per key: `material "aluminium 6061-T6", now "..."`. */
function specChanges(was: Record<string, unknown>, now: Record<string, unknown>): string[] {
  const said = (v: unknown) => (v === undefined ? "none" : stable(v));
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].sort().filter((k) => stable(was[k]) !== stable(now[k]))
    .map((k) => `${k} ${said(was[k])}, now ${said(now[k])}`);
}

/** The pinned offers when the line is pinned (with no fallback, as for a pinned print), else all of them. */
export const pinnedTo = (line: BomLine, offers: Offer[]) =>
  line.pin ? offers.filter((o) => o.supplier === line.pin!.supplier && (!line.pin!.sku || o.sku === line.pin!.sku)) : offers;

/** The shops' quotes that can price a quoted line as it is now: those for its own file (quotedFile) and for bom.json's
 * spec as it is, from the pinned shop when it has a pin. `why` says, one per quote, why each other one can't. */
export function heldQuotes(line: BomLine, offers: Offer[]): { held: Offer[]; why: string[] } {
  const file = quotedFile(line), held: Offer[] = [], why: string[] = [];
  for (const o of pinnedTo(line, offers.filter((x) => x.shopQuote))) {
    const q = o.shopQuote!, said = `${o.supplier} ${o.sku}`;
    if (!file || q.part !== file) { why.push(`${said} is a quote for ${q.part}, not ${line.id}'s ${file ?? "file"}`); continue; }
    const changed = specChanges(q.spec, line.spec);
    if (changed.length) why.push(`${said} was quoted for bom.json's spec as it was (${changed.join("; ")})`);
    else held.push(o);
  }
  return { held, why };
}

const money = (currency: "EUR" | "USD", x: number) => `${currency === "EUR" ? "€" : "$"}${x.toFixed(2)}`;

/** Each held quote's price for `need` pieces: the least total of the counts the shop quoted that cover it (the fewest
 * pieces on a tie), at the shop's own total, in dollars at the rate the quote records. A count the shop did not quote
 * is never worked out from one it did, so an order larger than every count it quoted has no price from it. */
function quotedOptions(line: BomLine, need: number, offers: Offer[]): QuoteLine[] {
  return heldQuotes(line, offers).held.flatMap((o): QuoteLine[] => {
    const q = o.shopQuote!, rate = q.currency === "EUR" ? q.usdPerEur ?? NaN : 1;
    const best = o.priceBreaks.filter((b) => b.qty >= need && typeof b.shopTotal === "number")
      .map((b) => ({ qty: b.qty, total: b.shopTotal!, usd: round(b.shopTotal! * rate) }))
      .sort((a, b) => a.usd - b.usd || a.qty - b.qty)[0];
    if (!best) return [];
    const more = best.qty > need ? `, more than the ${need} this order needs` : "";
    const vat = q.vat === "not stated" ? "VAT not stated" : `VAT ${q.vat}`;
    const at = q.currency === "EUR" ? `, at $${q.usdPerEur} a euro (catalog.json shopQuote.usdPerEur)` : "";
    const held = { part: q.part, sha256: q.sha256, currency: q.currency, ...(q.usdPerEur !== undefined ? { usdPerEur: q.usdPerEur } : {}), vat: q.vat, expires: q.expires };
    const holds = q.expires === "not stated" ? "its page not saying how long it holds" : `holding until ${q.expires}`;
    return [{
      lineId: line.id, supplier: o.supplier, sku: o.sku, mode: o.source === "estimate" ? "estimate" : "snapshot",
      needQty: need, orderQty: best.qty, orderUsd: best.usd, leadDays: o.leadDays,
      basis: `${o.source === "estimate" ? "estimate, not a firm quote: " : ""}${o.supplier}'s quote ${o.sku} for ${q.part} (sha256 ${q.sha256.slice(0, 12)}) and bom.json's spec, read by a person on ${o.capturedAt} from ${o.url} and recorded in catalog.json, ${holds}: ${money(q.currency, best.total)} for ${best.qty}${more}, ${vat}${at}`,
      shopQuote: { ...held, total: best.total, read: o.capturedAt },
    }];
  });
}

/** Every option for one made line, cheapest first. Shipping is folded into the PCB price; the quote adds a print
 * service's or a quoting shop's shipping once per shop. */
export function fabOptions(line: BomLine, need: number, rates: FabRates): QuoteLine[] {
  const opts =
    line.process === "pcb" ? pcbOptions(line, need, rates.pcb)
    : quotedPart(line) ? quotedOptions(line, need, shopQuotesOf(rates, line.id))
    : line.process === "print" ? (homePinned(line) ? homeOption(line, need, rates.filament) : printOptions(line, need, rates.print))
    : [];
  return opts.sort((a, b) => a.orderUsd - b.orderUsd);
}

export function printShipping(rates: FabRates, supplierName: string) {
  return Object.values(rates.print).find((s) => s.name === supplierName)?.shippingUsd ?? 0;
}
