// The source stage's quote: price every line for the batch. Bought parts take the cheapest mix of offers for the
// quantity actually ordered (packs round up, price breaks are bought up to when that costs less), with one
// shipping charge per shop. Made parts use the fab adapters.

import type { Bom, BomLine, Offer, QuoteLine, Quotes, Sourcing } from "../types.ts";
import { fabOptions, printShipping, type FabRates } from "../adapters/fab.ts";
import { batchNeed, usd } from "../io.ts";

function unitPrice(o: Offer, qty: number) {
  const sorted = [...o.priceBreaks].sort((a, b) => a.qty - b.qty);
  let price = sorted[0].unitUsd;
  for (const b of sorted) if (qty >= b.qty) price = b.unitUsd;
  return price;
}

export type Option = { o: Offer; orderQty: number; orderUsd: number };

/** Every way to buy `need` pieces of one line. A pinned line keeps only the pinned offers. */
export function options(line: BomLine, need: number, offers: Offer[]): Option[] {
  const pinned = line.pin
    ? offers.filter((o) => o.supplier === line.pin!.supplier && (!line.pin!.sku || o.sku === line.pin!.sku))
    : [];
  return (pinned.length ? pinned : offers).map((o) => {
    const pack = o.packSize ?? 1;
    const up = (q: number) => Math.ceil(q / pack) * pack;
    // Round up to whole packs; buy up to a higher price break when that costs less in total.
    const qtys = [up(need), ...o.priceBreaks.map((b) => up(b.qty)).filter((q) => q > need)]
      .filter((q, i) => i === 0 || typeof o.stock !== "number" || q <= o.stock);
    const best = qtys.map((q) => ({ q, usd: unitPrice(o, q) * q })).sort((a, b) => a.usd - b.usd || a.q - b.q)[0];
    return { o, orderQty: best.q, orderUsd: best.usd };
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

function toLine(line: BomLine, b: Option, need: number): QuoteLine {
  const pack = b.o.packSize && b.o.packSize > 1 ? b.o.packSize : undefined;
  return {
    lineId: line.id,
    supplier: b.o.supplier,
    sku: b.o.sku,
    mode: b.o.source === "api" ? "api" : b.o.source === "formula" ? "scripted" : b.o.source,
    needQty: need,
    orderQty: b.orderQty,
    ...(pack ? { packSize: pack, packs: Math.round(b.orderQty / pack) } : {}),
    orderUsd: round(b.orderUsd),
    leadDays: b.o.leadDays,
    basis: (b.o.source === "estimate" ? `estimate, not a price read from ${b.o.url}` : `${b.o.source} price from ${b.o.url}`)
      + ` (${b.o.capturedAt})` + (b.o.packSize ? `, pack of ${b.o.packSize}` : ""),
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** Where each shop's shipping figure came from (catalog.json): `shippingRead` lists the shops whose figure was read
 * from their published rates; every other figure is an estimate, with its `shippingBasis` note when there is one.
 * `shipsWith` maps a shop to the fab whose parcel carries its parts (JLCMC's in a JLCPCB board order). */
export type ShippingNotes = { read?: string[]; basis?: Record<string, string>; shipsWith?: Record<string, string> };

/** The shipping each shop adds to this order: a shop in `shipsWith` adds none when the order already has a made
 * line from the fab that carries its parts, and its own `shipping` otherwise. */
export function rideAlong(shipping: Record<string, number>, shipsWith: Record<string, string> | undefined,
  madeBy: Set<string>): Record<string, number> {
  const out = { ...shipping };
  for (const [shop, fab] of Object.entries(shipsWith ?? {})) if (madeBy.has(fab)) out[shop] = 0;
  return out;
}

/** shipping: flat order shipping per distributor, from the catalog. need: pieces to buy per line
 * (default: the whole batch with spares); a line that needs 0 is left out of this order. */
export function quote(bom: Bom, sourcing: Sourcing, rates: FabRates, shipping: Record<string, number>,
  need: (l: BomLine) => number = (l) => batchNeed(l, bom.units), notes: ShippingNotes = {}): Quotes {
  const madeLines = bom.lines.filter((l) => l.process !== "buy" && need(l) > 0);
  const madeOpts = madeLines.map((l) => fabOptions(l, need(l), rates));
  const unmade = madeLines.filter((_, i) => !madeOpts[i].length).map((l) => l.id);
  const fabs = madeOpts.filter((o) => o.length);
  const base = fabs.map((o) => o[0]);
  // A fab that carries another shop's parts (shipsWith) can be worth using even where it isn't the cheapest for its
  // line: also try moving to it the one made line that costs least extra there, and every line it can make, and keep
  // whichever order totals least (the cheapest fabs on a tie).
  const tries = [base];
  for (const fab of new Set(Object.values(notes.shipsWith ?? {}))) {
    if (base.some((q) => q.supplier === fab)) continue;
    const at = fabs.map((o) => o.find((q) => q.supplier === fab));
    const extra = at.map((q, i) => (q ? q.orderUsd - base[i].orderUsd : Infinity));
    const one = extra.indexOf(Math.min(...extra));
    if (!at[one]) continue;
    tries.push(base.map((q, i) => (i === one ? at[i]! : q)));
    if (at.filter(Boolean).length > 1) tries.push(base.map((q, i) => at[i] ?? q));
  }
  const best = tries.map((made) => priceWith(made)).reduce((a, b) => (b.batchUsd < a.batchUsd - 1e-9 ? b : a));
  best.made.forEach((q, i) => {
    if (q.supplier !== base[i].supplier)
      q.basis += `; chosen over ${base[i].supplier} (${usd(base[i].orderUsd)}) because ${shipsWithFab(q.supplier).join(", ")} ship in its parcel`;
  });
  return {
    slug: bom.slug,
    units: bom.units,
    lines: best.lines,
    batchUsd: best.batchUsd,
    perUnitUsd: round(best.batchUsd / bom.units),
    longestLeadDays: Math.max(0, ...best.lines.map((l) => l.leadDays)),
    unquoted: [...best.unquoted, ...unmade],
  };

  /** The shops whose parts ride in `fab`'s parcel. */
  function shipsWithFab(fab: string) {
    return Object.entries(notes.shipsWith ?? {}).filter(([, f]) => f === fab).map(([shop]) => shop);
  }

  /** The order with these made-line picks: the cheapest mix of shops for the bought lines, and one shipping charge
   * per shop (none for a shop whose parts ride in the parcel of a fab picked here). */
  function priceWith(pickedMade: QuoteLine[]) {
    const made = pickedMade.map((q) => ({ ...q }));
    const lines: QuoteLine[] = [];
    const ship = rideAlong(shipping, notes.shipsWith, new Set(made.map((l) => l.supplier)));
    const bought = bom.lines.filter((l) => l.process === "buy" && need(l) > 0);
    const perLine = bought.map((l) => options(l, need(l), sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []));
    const priced = bought.filter((_, i) => perLine[i].length);
    const chosen = choose(perLine.filter((o) => o.length), ship);
    priced.forEach((l, i) => {
      const q = toLine(l, chosen[i], need(l));
      const fab = notes.shipsWith?.[q.supplier];
      if (fab && ship[q.supplier] === 0 && shipping[q.supplier] !== 0) {
        q.basis += `; ships in the ${fab} order's parcel, so no shipping of its own (catalog.json shipsWith)`;
        q.shipsWith = fab;
      }
      lines.push(q);
    });
    const unquoted = bought.filter((_, i) => !perLine[i].length).map((l) => l.id);
    lines.push(...made);
    // One shipping charge per supplier we order from (PCB fab shipping is already in its price).
    const pcbLines = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
    const suppliers = new Set(lines.filter((l) => !pcbLines.has(l.lineId)).map((l) => l.supplier));
    for (const sup of suppliers) {
      const fromRates = ship[sup] === undefined;
      const usd = ship[sup] ?? printShipping(rates, sup);
      const read = !fromRates && (notes.read ?? []).includes(sup);
      const note = notes.basis?.[sup];
      if (usd > 0)
        lines.push({ lineId: `ship:${sup}`, supplier: sup, sku: "shipping", mode: read ? "snapshot" : "estimate", orderQty: 1,
          orderUsd: usd, leadDays: 0,
          basis: fromRates ? `the print service's shipping in pipeline/rates.json (an estimate)`
            : read ? `flat order shipping read from the shop's published rates (catalog.json shippingRead)${note ? `: ${note}` : ""}`
            : `estimate, not read from the shop's rates${note ? `: ${note}` : " (catalog.json has no shippingBasis for this shop)"}` });
    }
    return { lines, made, unquoted, batchUsd: round(lines.reduce((s, l) => s + l.orderUsd, 0)) };
  }
}
