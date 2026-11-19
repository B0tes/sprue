// The source stage's quote: price every line for the batch. Bought parts take the cheapest mix of offers for the
// quantity actually ordered (packs round up, price breaks are bought up to when that costs less), with one
// shipping charge per shop. Made parts use the fab adapters: a PCB or plastic print by rule, a CNC, sheet-metal or
// metal-printed part from a shop's quote recorded in catalog.json (adapters/fab.ts).

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Bom, BomLine, Offer, QuoteLine, Quotes, Sourcing } from "../types.ts";
import { fabOptions, heldQuotes, homePinned, pinnedTo, printShipping, quotedFile, quotedPart, type FabRates } from "../adapters/fab.ts";
import { batchNeed, isDay, usd } from "../io.ts";
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
 * line simply takes its cheapest offer from those shops, so the search is 2^shops, not offers^lines. An offer priced
 * at no number goes last, so it is picked only where nothing else prices its line. */
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
  // Each set of shops as a bitmask over `shops`, and each line's options cheapest first (on a tie, in their order), so
  // that a set's pick for a line is its first option from a shop in the set, as evaluate() picks it. An offer priced
  // at no number (a field catalog.json's checks missed) goes last, so it changes no other pick, and a set that must
  // take it counts only where no set can do without it, for the quote to say which line it is.
  const nan = (x: Option) => Number(Number.isNaN(x.orderUsd));
  const sorted = perLine.map((opts) => [...opts].sort((a, b) => nan(a) - nan(b) || a.orderUsd - b.orderUsd).map((x) => ({ x, bit: 1 << shops.indexOf(x.o.supplier) })));
  const ship = shops.map((x) => shipping[x] ?? 0);
  let best: { mask: number; usd: number } | undefined;
  for (let mask = 1; mask < 1 << shops.length; mask++) {
    let usd = 0, used = 0, all = true;
    for (const opts of sorted) {
      const first = opts.find((y) => mask & y.bit);
      if (!first) { all = false; break; }
      usd += first.x.orderUsd;
      used |= first.bit;
    }
    if (!all) continue;
    for (let k = 0; k < shops.length; k++) if (used & (1 << k)) usd += ship[k];
    if (!best || usd < best.usd - 1e-9 || (Number.isNaN(best.usd) && !Number.isNaN(usd))) best = { mask, usd };
  }
  return best ? sorted.map((opts) => opts.find((y) => best!.mask & y.bit)!.x) : [];
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
/** The words for a shipping figure read at the checkout of a shop that quoted a made part (catalog.json shippingRead),
 * which `sprue quote` tells from a figure read from published rates by them. */
export const CHECKOUT_READ = "shipping read at the shop's checkout or from its published rates";

/** The shops with a shop's quote for a made part anywhere in catalog.json, picked in this order or not: a figure read
 * for them may have been read at their checkout. */
export const quotingShops = (rates: FabRates) =>
  new Set(Object.values(rates.shopQuotes ?? {}).flat().filter((o) => o?.shopQuote).map((o) => o.supplier));

/** The most shops that quoted made parts the quote tries every set of: 2^8 - 1 sets, each set's picks and its
 * carriers' parts worked out once and laid on each shipsWith try, each different order priced once (a priceWith,
 * which runs choose() on the bought lines). The hand-off knows seven shops (handoff.ts SHOPS). Eight that all quote
 * every one of 12 to 24 parts and all carry a shop, with printed parts beside or not, take about a tenth of a second;
 * with fifteen shops selling the bought lines, whose choose() then searches 2^15 sets of them for each order, up to
 * about two seconds. */
const QUOTE_SHOPS = 8;

/** Where each shop's shipping figure came from (catalog.json): `shippingRead` lists the shops whose figure was read
 * from their published rates, or for a shop that quoted a made part at its checkout; every other figure is an
 * estimate, with its `shippingBasis` note when there is one.
 * `shipsWith` maps a shop to the fab whose parcel carries its parts (JLCMC's in a JLCPCB board order). */
export type ShippingNotes = { read?: string[]; basis?: Record<string, string>; shipsWith?: Record<string, string> };

/** The shipping each shop adds to this order: a shop in `shipsWith` adds none when the order already has a made
 * line from the fab that carries its parts, and its own `shipping` otherwise. */
export function rideAlong(shipping: Record<string, number>, shipsWith: Record<string, string> | undefined,
  madeBy: Set<string>): Record<string, number> {
  const out = { ...shipping };
  for (const [shop, fab] of Object.entries(shipsWith ?? {})) if (shop !== fab && madeBy.has(fab)) out[shop] = 0;
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
  // counts only when some line then rides with that fab; keep whichever order totals least (on a tie, the one that
  // moves fewest lines from the fab cheapest for each, then the first). The sets below place each part priced from shops' quotes, and one of them may take such a part away
  // from the fab: so where the order has such parts, the other lines alone are tried at the fab too, wherever the base
  // has none of them there.
  const tries: { made: QuoteLine[]; fab?: string }[] = [{ made: base }];
  for (const fab of new Set(Object.values(notes.shipsWith ?? {}))) for (const others of base.some((q) => q.shopQuote) ? [false, true] : [false]) {
    if (base.some((q) => (!others || !q.shopQuote) && q.supplier === fab)) continue;
    const at = fabs.map((o, i) => (others && base[i].shopQuote ? undefined : o.find((q) => q.supplier === fab)));
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
  // or makes a line here, is worth a part even where the set has a cheaper shop for each: so in each set, every such
  // shop also takes a part of its own, the parts costing least extra in all, of every way. And a shop that quoted and
  // rides with a fab puts a line in that fab's parcel only with a part of its own: on a try that moves a line to the
  // fab, each such shop of the set takes a part as well, one at a time. Of every way to give each such part to a shop
  // that quoted it, each priced as here with only that shop's quote for the part, take the cheapest: its other lines
  // are where one of the tries above puts them, and its parts go to some set of shops, each with a part; that set's
  // picks on that try, with every carrier there given a part this way (and the shop of the set riding with the try's
  // fab, where that is what rides there), cost no more (the parts no more, the shops no more, and every carrier there
  // for its riders). So up to QUOTE_SHOPS shops, where every set is tried, the quote is the cheapest of every way
  // (adapters/fab.test.ts checks it against every way on random catalogs), where each shop that quoted has a shipping
  // figure in catalog.json: one with none counts as $0 where it sends a quoted part and at its print rates' figure
  // where it only prints, so a part sent there can cost less than none (such an order names the shop in noShipping,
  // which the gates refuse). Past QUOTE_SHOPS shops, each shop added to the base's, and each shop with only the
  // base's for the parts it did not quote, each with each one and each two of its carriers given a part as well as
  // all of them (where they are up to QUOTE_SHOPS); not always the cheapest. (A plastic print still goes to the
  // service cheapest for it before shipping, or to a carrier as above.) A set's try on a shipsWith try counts as that
  // one does, only where a line rides with its fab.
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
  /** `picks` with each shop of `fs` given a part it quoted, a different part each, costing least extra in all, of every
   * way (a part already at its shop costs none, so a shop the set uses keeps a part of its own when another moves
   * away). Of ways that cost the same, the one whose other parts' shops ship least by their own figures (so a part
   * moves where that frees a shop), then the one that leaves most parts at the shop cheapest for each (so no part
   * moves for nothing), then the first. Undefined where there is no such way. Worked out part by part, keeping the best way for each set of the
   * shops of `fs` given a part so far and of the other shops used so far (those only where there are up to 12 shops in
   * all). */
  const moveTo = (picks: QuoteLine[], fs: string[]): QuoteLine[] | undefined => {
    const others = [...new Set(picks.map((q) => q.supplier).filter((s) => !fs.includes(s)))];
    const track = fs.length + others.length <= 12;
    type Way = { usd: number; moves: number; got: number; used: number; prev?: Way; i?: number; q?: QuoteLine };
    const fewer = (a: Way, b: Way) => a.usd < b.usd - 1e-9 || (a.usd <= b.usd + 1e-9 && a.moves < b.moves);
    let ways: Way[] = [{ usd: 0, moves: 0, got: 0, used: 0 }];
    picks.forEach((p, i) => {
      const next = new Map<number, Way>();
      const keep = (w: Way) => {
        const key = w.got * 2 ** others.length + w.used, was = next.get(key);
        if (!was || fewer(w, was)) next.set(key, w);
      };
      const o = track ? others.indexOf(p.supplier) : -1;
      for (const w of ways) {
        keep({ ...w, moves: w.moves + Number(p.supplier !== base[i].supplier), used: o < 0 ? w.used : w.used | (1 << o), prev: w, i: undefined, q: undefined });
        fs.forEach((f, k) => {
          const q = w.got & (1 << k) ? undefined : quotedAt[i].find((x) => x.supplier === f);
          if (q) keep({ usd: w.usd + q.orderUsd - p.orderUsd, moves: w.moves + Number(q.supplier !== base[i].supplier), got: w.got | (1 << k), used: w.used, prev: w, i, q });
        });
      }
      ways = [...next.values()];
    });
    const done = ways.filter((w) => w.got === 2 ** fs.length - 1);
    if (!done.length) return undefined;
    const least = Math.min(...done.map((w) => w.usd));
    const ship = (w: Way) => others.reduce((t, s, k) => t + (w.used & (1 << k) ? shipping[s] ?? 0 : 0), 0);
    let best: Way | undefined;
    for (const w of done.filter((x) => x.usd <= least + 1e-9)) {
      if (!best || ship(w) < ship(best) - 1e-9 || (ship(w) <= ship(best) + 1e-9 && w.moves < best.moves)) best = w;
    }
    const moved = [...picks];
    for (let w: Way | undefined = best; w; w = w.prev) if (w.q) moved[w.i!] = w.q;
    return moved;
  };
  // Each one of `xs` and each two of them, in order.
  const upToTwo = (xs: string[]) => xs.flatMap((a, i) => [[a], ...xs.slice(i + 1).map((b) => [a, b])]);
  // The shops that quoted a part and ride with a fab (shipsWith), each with its fab.
  const quotedRiders = Object.entries(notes.shipsWith ?? {}).filter(([s, f]) => s !== f && quoteShops.includes(s));
  // A set's picks and its carriers' parts depend on the set alone, as the tries differ only in other lines: each is
  // worked out once (past QUOTE_SHOPS shops, two ways of making a set can make the same one) and laid on every try.
  const setsSeen = new Set<string>();
  const bySet = quoteShops.length < 2 ? [] : sets.flatMap((allowed) => {
    const key = quoteShops.filter((s) => allowed.has(s)).join("\n");
    if (setsSeen.has(key)) return [];
    setsSeen.add(key);
    const picks = base.map((b, i) => (quotedAt[i].length ? quotedAt[i].find((q) => allowed.has(q.supplier)) : b));
    if (!picks.every(Boolean)) return [];
    // Every carrier of the set with a part of its own (one the set uses can lose its part to another and need one back).
    const inSet = carriers.filter((f) => allowed.has(f));
    const exact = quoteShops.length <= QUOTE_SHOPS;
    // Past QUOTE_SHOPS shops, as many shops at once as the search works through every set of, and no more: its
    // ways grow with every set of the shops given a part.
    const groups: { fs: string[]; at?: string }[] = [
      ...(!inSet.length ? [] : exact ? [inSet] : [...upToTwo(inSet).filter((g) => g.length < inSet.length), ...(inSet.length <= QUOTE_SHOPS ? [inSet] : [])])
        .map((fs) => ({ fs })),
      ...quotedRiders.filter(([r]) => allowed.has(r) && !inSet.includes(r))
        .flatMap(([r, at]) => (exact || !inSet.length ? [[...inSet, r]] : [[r], ...(inSet.length < QUOTE_SHOPS ? [[...inSet, r]] : [])]).map((fs) => ({ fs, at }))),
    ];
    return [{
      picks: picks as QuoteLine[],
      moves: groups.flatMap(({ fs, at }) => {
        const m = moveTo(picks as QuoteLine[], fs);
        return m?.some((q, i) => q !== picks[i]) ? [{ m, at }] : [];
      }),
    }];
  });
  for (const t of [...tries]) for (const { picks, moves } of bySet) {
    const on = (m: QuoteLine[]) => t.made.map((b, i) => (quotedAt[i].length ? m[i] : b));
    const made = on(picks);
    if (made.some((q, i) => q !== t.made[i])) tries.push({ made, fab: t.fab });
    for (const { m, at } of moves) if (!at || at === t.fab) tries.push({ made: on(m), fab: t.fab });
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
    .map((p) => ({ ...p, moves: p.made.filter((q, i) => q.supplier !== base[i].supplier).length }))
    .reduce((a, b) => (b.batchUsd < a.batchUsd - 1e-9 || (b.batchUsd <= a.batchUsd + 1e-9 && b.moves < a.moves) ? b : a));
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
      lines.push(q);
    });
    const unquoted = bought.filter((_, i) => !perLine[i].length).map((l) => l.id);
    lines.push(...made);
    // A shop that rides in a fab's parcel says so on each of its lines, bought or made, so the plan says how to order it
    // and its parcel holds them all; not a shop whose own shipping is a known 0 (catalog.json's, or rates.json's for a
    // shop whose lines are all print-service rates), which riding saves none.
    for (const sup of new Set(lines.map((l) => l.supplier))) {
      const fab = notes.shipsWith?.[sup], at = lines.filter((l) => l.supplier === sup);
      if (!fab || fab === sup || ship[sup] !== 0) continue;
      const own = shipping[sup] ?? (at.every((l) => made.includes(l) && !l.shopQuote) ? printShipping(rates, sup) : undefined);
      if (own === 0) continue;
      for (const q of at) {
        q.basis += `; rides in the ${fab} order's parcel, counted as no shipping of its own (catalog.json shipsWith, an estimate)`;
        q.shipsWith = fab;
      }
    }
    // One shipping charge per supplier we order from (PCB fab shipping is already in its price).
    const pcbLines = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
    const suppliers = new Set(lines.filter((l) => !pcbLines.has(l.lineId)).map((l) => l.supplier));
    const boughtFrom = new Set(lines.filter((l) => bought.some((b) => b.id === l.lineId)).map((l) => l.supplier));
    // A shop whose quote for a made part prices it: rates.json's print shipping is for plastic prints, not its parcel.
    const quotedFrom = new Set(made.filter((l) => l.shopQuote).map((l) => l.supplier)), quoting = quotingShops(rates);
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
            : read ? `${quoting.has(sup) ? CHECKOUT_READ : "flat order shipping read from the shop's published rates"} (catalog.json shippingRead)${note ? `: ${note}` : ""}`
            : `estimate, not read from the shop's ${quoting.has(sup) ? "checkout or its " : ""}rates${note ? `: ${note}` : " (catalog.json has no shippingBasis for this shop)"}` });
    }
    return { lines, made, unquoted, noShipping, batchUsd: round(lines.reduce((s, l) => s + l.orderUsd, 0)) };
  }
}

/** A shop's quote the order prices from whose last day (catalog.json shopQuote.expires) is before `day`. */
export type Lapsed = { supplier: string; sku: string; lineId: string; expires: string };

/** Each shop's quote the quote prices a part from, in the one order or in order A or B, that holds no longer than the
 * day before `day` (YYYY-MM-DD), once each: the shop may price it otherwise now. A quote whose page did not say how
 * long it holds is not one, nor one `held` refuses (a quote held to an earlier part file, which the gates say to take
 * out). Read with the clock by the commands that print it, never written into a file. */
export function lapsedQuotes(quotes: { lines: QuoteLine[]; phases?: { lines: QuoteLine[] }[] }, day: string,
  held: (x: QuoteLine) => boolean = () => true): Lapsed[] {
  const out = new Map<string, Lapsed>();
  for (const x of [...quotes.lines, ...(quotes.phases ?? []).flatMap((ph) => ph.lines)]) {
    const e = x.shopQuote?.expires;
    if (!isDay(e) || !(e < day) || !held(x)) continue;
    out.set(`${x.supplier}\0${x.sku}\0${x.lineId}`, { supplier: x.supplier, sku: x.sku, lineId: x.lineId, expires: e });
  }
  return [...out.values()];
}

/** A lapsed quote as `sprue quote`, `sprue status`, `sprue accept` and `sprue handoff` say it. */
export const lapsedText = (x: Lapsed) =>
  `${x.supplier}'s quote ${x.sku} for ${x.lineId} held until ${x.expires} (catalog.json shopQuote.expires), so the shop may price it otherwise now: ask ${x.supplier} to quote it again and record its new totals, as ${x.lineId}'s ORDER.md from sprue handoff says, before you order`;

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
