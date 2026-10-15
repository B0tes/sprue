// Made parts (PCBs, prints). These are "scripted" quotes: a supplier's published pricing
// rule turned into code. Rates live in pipeline/rates.json with their source URL and
// the date they were read, so a stale rate is easy to spot. A print pinned to "home" is printed on the
// user's own printer: it costs the filament it uses, priced from catalog.json `filament` (a page Claude read),
// with no shipping.

import { basename } from "node:path";
import type { BomLine, QuoteLine } from "../types.ts";

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
  // A rate only applies to the materials its service prints at that price.
  const fits = ([, s]: [string, FabRates["print"][string]]) =>
    !s.materials || s.materials.some((m) => m.toUpperCase() === material);
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

/** Cheapest option for one made line. Shipping is folded into the PCB price; print
 * shipping is added once per supplier by the caller via shippingFor(). */
export function fabQuotes(line: BomLine, need: number, rates: FabRates): QuoteLine | undefined {
  const opts =
    line.process === "pcb" ? pcbOptions(line, need, rates.pcb)
    : line.process === "print" ? (homePinned(line) ? homeOption(line, need, rates.filament) : printOptions(line, need, rates.print))
    : [];
  return opts.sort((a, b) => a.orderUsd - b.orderUsd)[0];
}

export function printShipping(rates: FabRates, supplierName: string) {
  return Object.values(rates.print).find((s) => s.name === supplierName)?.shippingUsd ?? 0;
}
