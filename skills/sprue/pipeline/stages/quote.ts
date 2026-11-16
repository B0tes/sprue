// The source stage's quote: price every line for the batch. Bought parts take the cheapest mix of offers for the
// quantity actually ordered (packs round up, price breaks are bought up to when that costs less), with one
// shipping charge per shop. Made parts use the fab adapters: a PCB or plastic print by rule, a CNC, sheet-metal or
// metal-printed part from a shop's quote recorded in catalog.json (adapters/fab.ts).

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Bom, BomLine, Offer, QuoteLine, Quotes, Sourcing } from "../types.ts";
import { fabOptions, heldQuotes, homePinned, pinnedTo, printShipping, quotedFile, quotedPart, type FabRates } from "../adapters/fab.ts";
import { batchNeed, usd } from "../io.ts";
import { partOf } from "./source.ts";
import { handoffBlock } from "../handoff-line.ts";

/** Why a parsed quotes.json can't be read as a quote (what package and the page read of it), or undefined. */
export function quoteShapeProblem(q: unknown): string | undefined {
  const list = (x: unknown) => Array.isArray(x) && x.every((y) => !!y && typeof y === "object");
  const names = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((y) => typeof y === "string"));
  if (!q || typeof q !== "object" || Array.isArray(q)) return "it is not an object";
  const o = q as Record<string, unknown>;
  if (!list(o.lines)) return "its lines are not a list";
  if (o.phases !== undefined && (!list(o.phases) || (o.phases as Record<string, unknown>[]).some((p) => typeof p.name !== "string" || !list(p.lines) || !names(p.unquoted))))
    return "its phases are not a list of named orders";
  if (!names(o.unquoted)) return "its unquoted is not a list of line ids";
  if (!names(o.noShipping)) return "its noShipping is not a list of shops";
  // Each order is a list of its own in production/ (order-<name>.csv), so its name is a file name of its own.
  const phases = (o.phases ?? []) as Record<string, unknown>[];
  const lists = phases.map((p) => String(p.name).toLowerCase());
  if (lists.some((n, i) => !/^[a-z0-9_-]+$/.test(n) || n === "list" || lists.indexOf(n) !== i))
    return "its orders' names are not each a name of their own (letters, digits, - or _, and not List)";
  // What the order lists, the plan and the page read from each line.
  const fields = { lineId: "string", supplier: "string", sku: "string", orderQty: "number", orderUsd: "number", leadDays: "number", basis: "string" };
  for (const [where, lines] of [["", o.lines], ...phases.map((p) => [` in order ${p.name}`, p.lines])] as [string, Record<string, unknown>[]][])
    for (const [i, l] of lines.entries()) {
      const bad = Object.entries(fields).find(([k, t]) => typeof l[k] !== t || (t === "number" && !Number.isFinite(l[k])));
      if (bad) return `its line ${i + 1}${where} has ${bad[0]} ${JSON.stringify(l[bad[0]]) ?? "missing"}, not a ${bad[1] === "number" ? "number" : "text"}`;
    }
  return undefined;
}

/** quotes.json as the page reads it, or undefined when it is not there, not readable JSON or not a quote Sprue wrote:
 * the page then shows no prices rather than stopping, so `sprue all` goes on to write the quote again (the gates and
 * `sprue status` say why it is wanted). */
export function readQuotes(dir: string): Quotes | undefined {
  try {
    const q: unknown = JSON.parse(readFileSync(join(dir, "quotes.json"), "utf8"));
    return quoteShapeProblem(q) ? undefined : (q as Quotes);
  } catch {
    return undefined;
  }
}

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
/** The most shops that quoted made parts the quote tries every set of: 2^6 - 1 sets on top of each shipsWith try,
 * each different set of picks priced once (a priceWith, which runs choose() on the bought lines). */
const QUOTE_SHOPS = 6;

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
  // line: also try moving to it the one made line that costs least extra there, and every line it can make. Such a try
  // counts only when some bought line then rides with that fab; keep whichever order totals least (the cheapest fabs
  // on a tie).
  const tries: { made: QuoteLine[]; fab?: string }[] = [{ made: base }];
  for (const fab of new Set(Object.values(notes.shipsWith ?? {}))) {
    if (base.some((q) => q.supplier === fab)) continue;
    const at = fabs.map((o) => o.find((q) => q.supplier === fab));
    const extra = at.map((q, i) => (q ? q.orderUsd - base[i].orderUsd : Infinity));
    const one = extra.indexOf(Math.min(...extra));
    if (!at[one]) continue;
    tries.push({ made: base.map((q, i) => (i === one ? at[i]! : q)), fab });
    if (at.filter(Boolean).length > 1) tries.push({ made: base.map((q, i) => at[i] ?? q), fab });
  }
  // A part priced from shops' quotes can come from any shop that quoted it, and each shop's shipping is counted once
  // whatever it sends, so the shop cheapest for the part alone may not be the cheapest order. As choose() does for
  // bought lines: on top of each try above, for each set of the shops that quoted, each such part takes its cheapest
  // quote from those shops (2^shops tries, not shops^parts); where only shipping depends on the shops used, the
  // cheapest order is one of them. A shop that carries another's parts (shipsWith), where a shop riding with it sells
  // or makes a line here, is worth a part even where the set has a cheaper shop for each: so for each group of such
  // shops in a set, each takes a part of its own, the parts costing least extra in all. With up to three such shops
  // every group and every way is tried, which finds the cheapest order of each set; past that, each one the set leaves
  // unused alone and all of them at once, each in turn taking the part that costs least extra there. Past QUOTE_SHOPS
  // shops, each shop added to the base's, and each shop with only the base's for the parts it did not quote. (A plastic
  // print still goes to the service cheapest for it before shipping.)
  const quotedAt = fabs.map((o, i) => (base[i].shopQuote ? o : []));
  const quoteShops = [...new Set(quotedAt.flat().map((q) => q.supplier))];
  const baseShops = quotedAt.flatMap((o, i) => (o.length ? [base[i].supplier] : []));
  const sets = quoteShops.length <= QUOTE_SHOPS
    ? Array.from({ length: (1 << quoteShops.length) - 1 }, (_, m) => new Set(quoteShops.filter((_, k) => (m + 1) & (1 << k))))
    : quoteShops.flatMap((s) => [new Set([...baseShops, s]), new Set([s, ...quotedAt.flatMap((o, i) => (o.some((q) => q.supplier === s) ? [] : [base[i].supplier]))])]);
  // A shop rides with a carrier only if it sells a bought line here or makes a made one.
  const sellers = new Set([...bom.lines.filter((l) => l.process === "buy" && need(l) > 0)
    .flatMap((l) => (sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []).map((o) => o.supplier)), ...fabs.flat().map((q) => q.supplier)]);
  const carriers = [...new Set(Object.values(notes.shipsWith ?? {}))]
    .filter((f) => quoteShops.includes(f) && Object.entries(notes.shipsWith ?? {}).some(([s, g]) => g === f && s !== f && sellers.has(s)));
  /** `picks` with each shop of `fs` given a part it quoted, a different part each, costing least extra in all: every
   * way, for up to three shops (a part already at its shop costs none, so a shop the set uses keeps a part of its own
   * when another moves away); past that, each in turn takes the part that costs least extra there. */
  const moveTo = (picks: QuoteLine[], fs: string[]): QuoteLine[] | undefined => {
    const at = (i: number, f: string) => quotedAt[i].find((x) => x.supplier === f);
    const moved = [...picks];
    if (fs.length > 3) {
      for (const f of fs) {
        const extra = picks.map((q, i) => (moved[i] === q && at(i, f) ? at(i, f)!.orderUsd - q.orderUsd : Infinity));
        const one = extra.indexOf(Math.min(...extra));
        if (extra[one] < Infinity) moved[one] = at(one, f)!;
      }
      return moved;
    }
    let best: { extra: number; moved: QuoteLine[] } | undefined;
    const taken = picks.map(() => false);
    const go = (k: number, extra: number) => {
      if (k === fs.length) {
        if (!best || extra < best.extra - 1e-9) best = { extra, moved: [...moved] };
        return;
      }
      for (let i = 0; i < picks.length; i++) {
        const q = taken[i] ? undefined : at(i, fs[k]);
        if (!q) continue;
        taken[i] = true;
        moved[i] = q;
        go(k + 1, extra + q.orderUsd - picks[i].orderUsd);
        taken[i] = false;
        moved[i] = picks[i];
      }
    };
    go(0, 0);
    return best?.moved;
  };
  if (quoteShops.length > 1) for (const t of [...tries]) for (const allowed of sets) {
    const made = t.made.map((b, i) => (quotedAt[i].length ? quotedAt[i].find((q) => allowed.has(q.supplier)) : b));
    if (!made.every(Boolean)) continue;
    const picks = made as QuoteLine[];
    if (picks.some((q, i) => q !== t.made[i])) tries.push({ made: picks, fab: t.fab });
    // Every group of the set's carriers, up to three (one the set uses can lose its part to another and need one
    // back); past that, each idle one alone and all of them at once.
    const inSet = carriers.filter((f) => allowed.has(f)), idle = inSet.filter((f) => !picks.some((q) => q.supplier === f));
    const groups = inSet.length <= 3 ? Array.from({ length: (1 << inSet.length) - 1 }, (_, m) => inSet.filter((_, k) => (m + 1) & (1 << k)))
      : [...idle.map((f) => [f]), ...(idle.length > 1 ? [idle] : [])];
    for (const fs of groups) {
      const moved = moveTo(picks, fs);
      if (moved?.some((q, i) => q !== picks[i])) tries.push({ made: moved, fab: fs.find((f) => !picks.some((q) => q.supplier === f)) ?? fs[0] });
    }
  }
  // Many tries share their picks (a shipsWith try's quoted parts are set again by each set, and often one shop's quote
  // is the cheapest of a set for every part), and each priceWith runs choose() over every set of the bought lines'
  // shops: price each set of picks once. Every pick is one of its line's options (fabs), so its place there keys it.
  const pricedWith = new Map<string, ReturnType<typeof priceWith>>();
  const best = tries.map((t) => {
    const key = t.made.map((q, i) => fabs[i].indexOf(q)).join(",");
    if (!pricedWith.has(key)) pricedWith.set(key, priceWith(t.made));
    return { ...pricedWith.get(key)!, fab: t.fab };
  })
    .filter((p) => !p.fab || p.lines.some((l) => l.shipsWith === p.fab))
    .reduce((a, b) => (b.batchUsd < a.batchUsd - 1e-9 ? b : a));
  best.made.forEach((q, i) => {
    if (q.supplier === base[i].supplier) return;
    // Why by the line's own shop: a bought line rides in its parcel, or (a shop's quote moved) the shipping. Riders
    // that rode with that shop in the base order already are not why the line moved.
    const riders = base.some((b) => b.supplier === q.supplier) ? []
      : [...new Set(best.lines.filter((l) => l.shipsWith === q.supplier).map((l) => l.supplier))];
    q.basis += riders.length ? `; chosen over ${base[i].supplier} (${usd(base[i].orderUsd)}) because ${riders.join(", ")} ${riders.length === 1 ? "ships" : "ship"} in its parcel`
      : `; chosen over ${base[i].supplier} (${usd(base[i].orderUsd)}) because the order costs less with each shop's shipping counted`;
  });
  // A price that is not a number (a misspelt field catalog.json's checks missed, a volume that isn't one) would make
  // the total $NaN: say which line, rather than write it.
  const bad = best.lines.filter((l) => !Number.isFinite(l.orderUsd));
  if (bad.length) throw new Error(`the quote came to ${usd(best.batchUsd)}: ${bad.map((l) => `${l.lineId} (${l.supplier} ${l.sku}) is priced at ${l.orderUsd}`).join("; ")}. Run sprue validate`);
  return {
    slug: bom.slug,
    units: bom.units,
    lines: best.lines,
    batchUsd: best.batchUsd,
    perUnitUsd: round(best.batchUsd / bom.units),
    longestLeadDays: Math.max(0, ...best.lines.map((l) => l.leadDays)),
    unquoted: [...best.unquoted, ...unmade],
    ...(best.noShipping.length ? { noShipping: best.noShipping } : {}),
  };

  /** The order with these made-line picks: the cheapest mix of shops for the bought lines, and one shipping charge
   * per shop (none for a shop whose parts ride in the parcel of a fab picked here). */
  function priceWith(pickedMade: QuoteLine[]) {
    const made = pickedMade.map((q) => ({ ...q }));
    const lines: QuoteLine[] = [];
    const ship = rideAlong(shipping, notes.shipsWith, new Set(made.map((l) => l.supplier)));
    // A made part's shop that rides in a fab's parcel says so, as a bought line's does, so the plan says how to order it;
    // not a shop whose own shipping is 0 (catalog.json's, or a print service's in rates.json), which riding saves none.
    for (const q of made) {
      const fab = notes.shipsWith?.[q.supplier], own = shipping[q.supplier] ?? (q.shopQuote ? undefined : printShipping(rates, q.supplier));
      if (fab && fab !== q.supplier && ship[q.supplier] === 0 && own !== 0) {
        q.basis += `; rides in the ${fab} order's parcel, counted as no shipping of its own (catalog.json shipsWith, an estimate)`;
        q.shipsWith = fab;
      }
    }
    const bought = bom.lines.filter((l) => l.process === "buy" && need(l) > 0);
    const perLine = bought.map((l) => options(l, need(l), sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []));
    const priced = bought.filter((_, i) => perLine[i].length);
    const chosen = choose(perLine.filter((o) => o.length), ship);
    priced.forEach((l, i) => {
      const q = toLine(l, chosen[i], need(l));
      // An offer of an alternate is bought only with a word: the design and its checks describe the line's own mpn.
      // Read from bom.json as it is now, not from sourcing.json, which may be of an earlier one.
      const alt = partOf(l, chosen[i].o.mpn);
      if (alt.as === "alternate") {
        q.alternate = alt.alternate;
        q.basis += `; the alternate ${alt.alternate}, not ${l.mpn} (bom.json)`;
      }
      const fab = notes.shipsWith?.[q.supplier];
      if (fab && ship[q.supplier] === 0 && shipping[q.supplier] !== 0) {
        q.basis += `; rides in the ${fab} order's parcel, counted as no shipping of its own (catalog.json shipsWith, an estimate)`;
        q.shipsWith = fab;
      }
      lines.push(q);
    });
    const unquoted = bought.filter((_, i) => !perLine[i].length).map((l) => l.id);
    lines.push(...made);
    // One shipping charge per supplier we order from (PCB fab shipping is already in its price).
    const pcbLines = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
    const suppliers = new Set(lines.filter((l) => !pcbLines.has(l.lineId)).map((l) => l.supplier));
    const boughtFrom = new Set(lines.filter((l) => bought.some((b) => b.id === l.lineId)).map((l) => l.supplier));
    // A shop whose quote for a made part prices it: rates.json's print shipping is for plastic prints, not its parcel.
    const quotedFrom = new Set(made.filter((l) => l.shopQuote).map((l) => l.supplier));
    const noShipping: string[] = [];
    for (const sup of suppliers) {
      const fromRates = ship[sup] === undefined;
      // A shop a bought line, or a shop's quote, comes from with no shipping figure in catalog.json is counted as $0:
      // say so.
      if (fromRates && (quotedFrom.has(sup) || (boughtFrom.has(sup) && !Object.values(rates.print).some((p) => p.name === sup)))) noShipping.push(sup);
      const usd = ship[sup] ?? (quotedFrom.has(sup) ? 0 : printShipping(rates, sup));
      const read = !fromRates && (notes.read ?? []).includes(sup);
      const note = notes.basis?.[sup];
      // A quoting shop's 0 from catalog.json (its total holds shipping) is kept as a line, so its basis is said; a 0
      // from riding in a fab's parcel (shipsWith) is not catalog.json's figure, and gets no line.
      if (usd > 0 || (shipping[sup] === 0 && quotedFrom.has(sup)))
        lines.push({ lineId: `ship:${sup}`, supplier: sup, sku: "shipping", mode: read ? "snapshot" : "estimate", orderQty: 1,
          orderUsd: usd, leadDays: 0,
          basis: fromRates ? `the print service's shipping in pipeline/rates.json (an estimate)`
            : read ? `flat order shipping read from the shop's published rates (catalog.json shippingRead)${note ? `: ${note}` : ""}`
            : `estimate, not read from the shop's rates${note ? `: ${note}` : " (catalog.json has no shippingBasis for this shop)"}` });
    }
    return { lines, made, unquoted, noShipping, batchUsd: round(lines.reduce((s, l) => s + l.orderUsd, 0)) };
  }
}

/** Why the quote has no price for a line, and what to do: a bought line with no offer left, a made line that no fab
 * rate in rates.json takes (and for a print, why), or a CNC, sheet-metal or metal-printed part with no shop's quote in
 * catalog.json that prices it as it is now (and why each recorded one does not). With the
 * product (its folder and bom.json), a part a shop makes (not one for the home printer, nor the board, whose is
 * pcb/order/) also gets where to ask a shop for its price by hand: `sprue handoff` writes what to send and where; or,
 * while the BOM is one it can't take as written (handoff-line.ts), what to fix first. An ORDER.md, which
 * `sprue handoff` writes, gives none, as it is that page. */
export function whyUnpriced(line: BomLine, rates: FabRates, product?: { dir: string; bom: Bom }): string {
  const why = reason(line, rates);
  const shop = (line.process === "print" && !homePinned(line)) || line.process === "cnc" || line.process === "sheet";
  if (!product || !shop) return why;
  const { dir, bom } = product, block = handoffBlock(dir, line, bom);
  return block ? `${why}. sprue handoff, which writes what to send a shop for its price by hand, can't take it yet: ${block}`
    : `${why}. To get a shop's price by hand: sprue handoff ${basename(dir)} writes fab/order/${line.id}/ORDER.md, with the file to upload and the shops that make it`;
}

function reason(line: BomLine, rates: FabRates): string {
  if (line.process === "buy") return "no offer is left to buy it from: add one to catalog.json (sprue source says why the ones it has are left out)";
  if (quotedPart(line)) return quotedReason(line, rates);
  if (line.process === "pcb") return "no board fab in rates.json takes it: check its spec.widthMm, heightMm and layers (both fabs' rates are for 2 layers)";
  const material = String(line.spec.material ?? "");
  if (homePinned(line)) return `it is pinned to the home printer, and catalog.json has no filament entry for ${material || "its material"} (usdPerKg and gPerCm3) to price it from`;
  const services = Object.values(rates.print);
  if (line.pin) {
    const s = services.find((x) => x.name === line.pin!.supplier);
    return s ? `it is pinned to ${s.name}, whose rates.json rate is for ${s.materials?.join(", ") ?? "other materials"}, not ${material || "an empty spec.material"}`
      : `it is pinned to ${line.pin.supplier}, which is no print service in rates.json (${services.map((x) => x.name).join(", ")}), nor "home"`;
  }
  return `no print service in rates.json prints ${material || "it: spec.material is empty"}`;
}

/** Why no shop's quote in catalog.json prices a CNC, sheet-metal or metal-printed part: none recorded, none Sprue can
 * read (an offer with no shopQuote), none from the shop it is pinned to, or each one of another file, of an earlier
 * spec, or for fewer pieces than an order buys. */
function quotedReason(line: BomLine, rates: FabRates): string {
  const kind = line.process === "cnc" ? "a CNC part" : line.process === "sheet" ? "a sheet-metal part" : "a part printed in metal";
  const how = `Sprue prices ${kind} only from a shop's quote for its file and spec, for at least as many pieces as an order buys, which a person reads at the shop and records in catalog.json under offers.${line.id}`;
  const offers = rates.shopQuotes?.[line.id] ?? [], quotes = offers.filter((o) => o.shopQuote);
  if (!quotes.length) {
    if (line.process === "print") return `no print service in rates.json prints in metal (${String(line.spec.material ?? line.spec.process)}), and catalog.json holds no shop's quote for it: ${how}. Or print it in plastic`;
    return offers.length ? `catalog.json's offers for it (offers.${line.id}) hold no shop's quote Sprue can read: ${how}, with the "shopQuote" its ORDER.md gives`
      : `catalog.json holds no shop's quote for it: ${how}`;
  }
  if (!quotedFile(line))
    return `its file (${line.file ?? "none in bom.json"}) is not written in bom.json as fab/<part>.step or .stl, the path a shop's quote is held to, so no shop's quote can be held to it`;
  if (line.pin && !pinnedTo(line, quotes).length)
    return `bom.json pins it to ${line.pin.supplier}${line.pin.sku ? ` ${line.pin.sku}` : ""}, and catalog.json holds no quote from it that prices it: ${how}`;
  const { held, why } = heldQuotes(line, quotes);
  const counts = (o: (typeof held)[number]) => o.priceBreaks.map((b) => b.qty).sort((a, b) => a - b);
  const list = (n: number[]) => (n.length === 1 ? `${n[0]}` : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);
  const short = held.map((o) => `${o.supplier} ${o.sku} prices ${list(counts(o))} ${counts(o).length === 1 && counts(o)[0] === 1 ? "piece" : "pieces"}, fewer than an order of it buys`);
  return `no shop's quote in catalog.json prices it as it is now (${[...why, ...short].join("; ")}): ${how}`;
}
