// Made parts (PCBs, prints). These are "scripted" quotes: a supplier's published pricing
// rule turned into code. Rates live in src/pipeline/rates.json with their source URL and
// the date they were read, so a stale rate is easy to spot.

import type { BomLine, QuoteLine } from "../types.ts";

export type Rate = { url: string; capturedAt: string; leadDays: number; verified: boolean };
export type FabRates = {
  pcb: {
    oshpark?: Rate & { usdPerSqIn2Layer: number; boardsPerOrder: number; shippingUsd: number };
    jlcpcb?: Rate & { baseUsd: number; boards: number; maxMm: number; shippingUsd: number };
  };
  print: Record<string, Rate & { usdPerCm3: number; minPerPartUsd: number; shippingUsd: number; name: string }>;
};

const round = (x: number) => Math.round(x * 100) / 100;

function pcbOptions(line: BomLine, units: number, r: FabRates["pcb"]): QuoteLine[] {
  const w = Number(line.spec.widthMm), h = Number(line.spec.heightMm);
  const layers = Number(line.spec.layers);
  const out: QuoteLine[] = [];
  if (r.oshpark && layers === 2) {
    const sqIn = (w * h) / 645.16;
    const orders = Math.ceil((line.qtyPerUnit * units) / r.oshpark.boardsPerOrder);
    out.push({
      lineId: line.id, supplier: "OSH Park", sku: `2-layer ${w}x${h} mm`, mode: "scripted",
      orderQty: orders * r.oshpark.boardsPerOrder,
      orderUsd: round(orders * sqIn * r.oshpark.usdPerSqIn2Layer + r.oshpark.shippingUsd),
      leadDays: r.oshpark.leadDays,
      basis: `${sqIn.toFixed(2)} sq in x $${r.oshpark.usdPerSqIn2Layer}/sq in per ${r.oshpark.boardsPerOrder} boards (${r.oshpark.url}, ${r.oshpark.capturedAt}${r.oshpark.verified ? "" : ", unverified"})`,
    });
  }
  if (r.jlcpcb && layers === 2 && w <= r.jlcpcb.maxMm && h <= r.jlcpcb.maxMm) {
    const orders = Math.ceil((line.qtyPerUnit * units) / r.jlcpcb.boards);
    out.push({
      lineId: line.id, supplier: "JLCPCB", sku: `2-layer ${w}x${h} mm, ${r.jlcpcb.boards} pcs`, mode: "scripted",
      orderQty: orders * r.jlcpcb.boards,
      orderUsd: round(orders * r.jlcpcb.baseUsd + r.jlcpcb.shippingUsd),
      leadDays: r.jlcpcb.leadDays,
      basis: `$${r.jlcpcb.baseUsd} per ${r.jlcpcb.boards} boards up to ${r.jlcpcb.maxMm} mm + $${r.jlcpcb.shippingUsd} shipping (${r.jlcpcb.url}, ${r.jlcpcb.capturedAt}${r.jlcpcb.verified ? "" : ", unverified"})`,
    });
  }
  return out;
}

function printOptions(line: BomLine, units: number, r: FabRates["print"]): QuoteLine[] {
  const vol = Number(line.spec.volumeCm3);
  return Object.entries(r).map(([key, s]) => {
    const each = Math.max(vol * s.usdPerCm3, s.minPerPartUsd);
    const qty = line.qtyPerUnit * units;
    return {
      lineId: line.id, supplier: s.name, sku: `${line.spec.material} ${key}`, mode: "estimate" as const,
      orderQty: qty,
      orderUsd: round(each * qty),
      leadDays: s.leadDays,
      basis: `${vol} cm3 x $${s.usdPerCm3}/cm3 (min $${s.minPerPartUsd}/part), shipping counted once per order (${s.url}, ${s.capturedAt}${s.verified ? "" : ", unverified"})`,
    };
  });
}

/** Cheapest option for one made line. Shipping is folded into the PCB price; print
 * shipping is added once per supplier by the caller via shippingFor(). */
export function fabQuotes(line: BomLine, units: number, rates: FabRates): QuoteLine | undefined {
  const opts =
    line.process === "pcb" ? pcbOptions(line, units, rates.pcb)
    : line.process === "print" ? printOptions(line, units, rates.print)
    : [];
  return opts.sort((a, b) => a.orderUsd - b.orderUsd)[0];
}

export function printShipping(rates: FabRates, supplierName: string) {
  return Object.values(rates.print).find((s) => s.name === supplierName)?.shippingUsd ?? 0;
}
