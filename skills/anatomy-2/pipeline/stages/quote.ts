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

export type Option = { o: Offer; orderQty: number; orderUsd: number };

/** Every way to buy one line for the batch. A pinned line keeps only the pinned offers. */
export function options(line: BomLine, units: number, offers: Offer[]): Option[] {
  const need = line.qtyPerUnit * units;
  const pinned = line.pin
    ? offers.filter((o) => o.supplier === line.pin!.supplier && (!line.pin!.sku || o.sku === line.pin!.sku))
    : [];
  return (pinned.length ? pinned : offers).map((o) => {
    const pack = o.packSize ?? 1;
    const orderQty = Math.ceil(need / pack) * pack;
    return { o, orderQty, orderUsd: unitPrice(o, orderQty) * orderQty };
  });
}

/** Picks one offer per line so that parts plus one shipping charge per shop is lowest.
 * Searches over sets of shops rather than combinations of offers: for a given set of shops each
 * line simply takes its cheapest offer from those shops, so the search is 2^shops, not offers^lines. */
export function choose(perLine: Option[][], shipping: Record<string, number>): Option[] {
  const shops = [...new Set(perLine.flat().map((x) => x.o.supplier))];
  const cheapest = (opts: Option[], allowed: Set<string>) =>
    opts.filter((x) => allowed.has(x.o.supplier)).sort((a, b) => a.orderUsd - b.orderUsd)[0];
  const evaluate = (allowed: Set<string>) => {
    const pick = perLine.map((opts) => cheapest(opts, allowed));
    if (pick.some((x) => !x)) return undefined;
    const used = new Set(pick.map((x) => x.o.supplier));
    const usd = pick.reduce((sum, x) => sum + x.orderUsd, 0) + [...used].reduce((sum, x) => sum + (shipping[x] ?? 0), 0);
    return { pick, usd };
  };
  if (shops.length > 20) {
    // Too many shops to search every set: start from all shops and drop one at a time while it helps.
    let allowed = new Set(shops);
    let best = evaluate(allowed)!;
    for (let improved = true; improved; ) {
      improved = false;
      for (const shop of [...allowed]) {
        const trial = new Set([...allowed].filter((x) => x !== shop));
        const r = evaluate(trial);
        if (r && r.usd < best.usd - 1e-9) [best, allowed, improved] = [r, trial, true];
      }
    }
    return best.pick;
  }
  let best: { pick: Option[]; usd: number } | undefined;
  for (let mask = 1; mask < 1 << shops.length; mask++) {
    const r = evaluate(new Set(shops.filter((_, i) => mask & (1 << i))));
    if (r && (!best || r.usd < best.usd - 1e-9)) best = r;
  }
  return best?.pick ?? [];
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
  const pcbLines = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
  const suppliers = new Set(lines.filter((l) => !pcbLines.has(l.lineId)).map((l) => l.supplier));
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
