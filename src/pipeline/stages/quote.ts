// Stage 5: price every line for the batch. Bought parts take the cheapest offer for the
// quantity actually ordered (packs round up). Made parts use the fab adapters.

import type { Bom, BomLine, Offer, QuoteLine, Quotes, Sourcing } from "../types.ts";
import { fabQuotes, printShipping, type FabRates } from "../adapters/fab.ts";

function unitPrice(o: Offer, qty: number) {
  const sorted = [...o.priceBreaks].sort((a, b) => a.qty - b.qty);
  let price = sorted[0].unitUsd;
  for (const b of sorted) if (qty >= b.qty) price = b.unitUsd;
  return price;
}

type Option = { o: Offer; orderQty: number; orderUsd: number };

function options(line: BomLine, units: number, offers: Offer[]): Option[] {
  const need = line.qtyPerUnit * units;
  return offers.map((o) => {
    const pack = o.packSize ?? 1;
    const orderQty = Math.ceil(need / pack) * pack;
    return { o, orderQty, orderUsd: unitPrice(o, orderQty) * orderQty };
  });
}

/** Picks one offer per line so that parts plus one shipping charge per shop is lowest.
 * Exhaustive over combinations, which is fine at BOM sizes with a few offers per line. */
function choose(perLine: Option[][], shipping: Record<string, number>): Option[] {
  let best: Option[] = [];
  let bestUsd = Infinity;
  const pick: Option[] = [];
  const walk = (i: number) => {
    if (i === perLine.length) {
      const shops = new Set(pick.map((p) => p.o.supplier));
      const usd = pick.reduce((s, p) => s + p.orderUsd, 0) + [...shops].reduce((s, x) => s + (shipping[x] ?? 0), 0);
      if (usd < bestUsd) [bestUsd, best] = [usd, [...pick]];
      return;
    }
    for (const opt of perLine[i]) {
      pick.push(opt);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

function toLine(line: BomLine, b: Option): QuoteLine {
  return {
    lineId: line.id,
    supplier: b.o.supplier,
    sku: b.o.sku,
    mode: b.o.source === "api" ? "api" : b.o.source === "formula" ? "scripted" : b.o.source,
    orderQty: b.orderQty,
    orderUsd: round(b.orderUsd),
    leadDays: b.o.leadDays,
    basis: `${b.o.source} price from ${b.o.url} (${b.o.capturedAt})` + (b.o.packSize ? `, pack of ${b.o.packSize}` : ""),
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** shipping: flat order shipping per distributor, from the catalog. */
export function quote(bom: Bom, sourcing: Sourcing, rates: FabRates, shipping: Record<string, number>): Quotes {
  const lines: QuoteLine[] = [];
  const unquoted: string[] = [];
  const bought = bom.lines.filter((l) => l.process === "buy");
  const perLine = bought.map((l) => options(l, bom.units, sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []));
  const priced = bought.filter((_, i) => perLine[i].length);
  const chosen = choose(perLine.filter((o) => o.length), shipping);
  priced.forEach((l, i) => lines.push(toLine(l, chosen[i])));
  unquoted.push(...bought.filter((_, i) => !perLine[i].length).map((l) => l.id));
  for (const line of bom.lines.filter((l) => l.process !== "buy")) {
    const q = fabQuotes(line, bom.units, rates);
    if (q) lines.push(q);
    else unquoted.push(line.id);
  }
  // One shipping charge per supplier we order from (PCB fab shipping is already in its price).
  const suppliers = new Set(lines.filter((l) => !l.lineId.startsWith("pcb")).map((l) => l.supplier));
  for (const sup of suppliers) {
    const usd = shipping[sup] ?? printShipping(rates, sup);
    if (usd > 0)
      lines.push({ lineId: `ship:${sup}`, supplier: sup, sku: "shipping", mode: "estimate", orderQty: 1,
        orderUsd: usd, leadDays: 0, basis: "flat order shipping to the US, from the supplier's published rates" });
  }
  const batchUsd = round(lines.reduce((s, l) => s + l.orderUsd, 0));
  return {
    slug: bom.slug,
    units: bom.units,
    lines,
    batchUsd,
    perUnitUsd: round(batchUsd / bom.units),
    longestLeadDays: Math.max(0, ...lines.map((l) => l.leadDays)),
    unquoted,
  };
}
