// The source stage's quote: price every line for the batch. Bought parts take the cheapest mix of offers for the
// quantity actually ordered (packs round up, price breaks are bought up to when that costs less), with one
// shipping charge per shop. Made parts use the fab adapters: a PCB or plastic print by rule, a CNC, sheet-metal or
// metal-printed part from a shop's quote recorded in catalog.json (adapters/fab.ts).

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Bom, BomLine, Offer, QuoteLine, Quotes, Sourcing } from "../types.ts";
import { fabOptions, heldQuotes, homePinned, pinnedTo, printShipping, quotedFile, quotedPart, shopQuotesOf, type FabRates } from "../adapters/fab.ts";
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
  if (o.needsRider !== undefined && typeof o.needsRider !== "string") return "its needsRider is not a shop's name";
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
 * at no number is left out where its line has one with a price, so it is picked only where nothing else prices its
 * line. Past twenty shops (`many`, by default where these lines' shops are more than twenty) it drops one shop at a time
 * while that helps instead. */
export function choose(perLine: Option[][], shipping: Record<string, number>, many?: boolean): Option[] {
  // An offer priced at no number (a field catalog.json's checks missed) is left out where its line has one with a
  // price, its shop with it, so the picks are those without it. Where nothing else prices its line it is picked, for
  // the quote to stop and say which line it is, and it adds its shop's shipping but no price.
  const nan = (x: Option) => Number.isNaN(x.orderUsd);
  const lines = perLine.map((opts) => (opts.every(nan) ? opts : opts.filter((x) => !nan(x))));
  const shops = [...new Set(lines.flat().map((x) => x.o.supplier))];
  const price = (x: Option) => (nan(x) ? 0 : x.orderUsd);
  const better = (a: { usd: number }, b?: { usd: number }) => !b || a.usd < b.usd - 1e-9;
  const cheapest = (opts: Option[], allowed: Set<string>) =>
    opts.filter((x) => allowed.has(x.o.supplier)).sort((a, b) => price(a) - price(b))[0];
  const evaluate = (allowed: Set<string>) => {
    const pick = lines.map((opts) => cheapest(opts, allowed));
    if (pick.some((x) => !x)) return undefined;
    const used = new Set(pick.map((x) => x.o.supplier));
    const usd = pick.reduce((sum, x) => sum + price(x), 0) + [...used].reduce((sum, x) => sum + (shipping[x] ?? 0), 0);
    return { pick, usd };
  };
  if (many ?? shops.length > 20) {
    // Too many shops to search every set: start from all shops and drop one at a time while it helps.
    let allowed = new Set(shops);
    let best = evaluate(allowed)!;
    for (let improved = true; improved; ) {
      improved = false;
      for (const shop of [...allowed]) {
        const trial = new Set([...allowed].filter((x) => x !== shop));
        const r = evaluate(trial);
        if (r && better(r, best)) [best, allowed, improved] = [r, trial, true];
      }
    }
    return best.pick;
  }
  // Each set of shops as a bitmask over `shops`, and each line's options cheapest first (on a tie, in their order), so
  // that a set's pick for a line is its first option from a shop in the set, as evaluate() picks it. For each line,
  // the pick of every set at once: the better of its lowest shop's first option and the pick of the set without that
  // shop. Its price and its shop's shipping, the first time the set uses the shop, add up as evaluate() adds them.
  const n = 1 << shops.length, cost = new Float64Array(n), fee = new Float64Array(n), used = new Int32Array(n);
  const none = new Uint8Array(n), at = new Int32Array(n);
  const low = (m: number) => 31 - Math.clz32(m & -m);
  const sorted = lines.map((opts) => [...opts].sort((a, b) => price(a) - price(b)));
  for (const opts of sorted) {
    const firstAt = shops.map((s) => { const k = opts.findIndex((x) => x.o.supplier === s); return k < 0 ? opts.length : k; });
    const usd = opts.map(price), bit = opts.map((x) => 1 << shops.indexOf(x.o.supplier)), ship = opts.map((x) => shipping[x.o.supplier] ?? 0);
    at[0] = opts.length;
    for (let m = 1; m < n; m++) {
      const k = (at[m] = Math.min(at[m & (m - 1)], firstAt[low(m)]));
      if (k === opts.length) { none[m] = 1; continue; }
      cost[m] += usd[k];
      if (!(used[m] & bit[k])) { used[m] |= bit[k]; fee[m] += ship[k]; }
    }
  }
  let best: { mask: number; usd: number } | undefined;
  for (let mask = 1; mask < n; mask++) {
    if (none[mask]) continue;
    const set = { mask, usd: cost[mask] + fee[mask] };
    if (better(set, best)) best = set;
  }
  const bit = (x: Option) => 1 << shops.indexOf(x.o.supplier);
  return best ? sorted.map((opts) => opts.find((x) => best!.mask & bit(x))!) : [];
}

/** choose(), but for an order that holds only with a line riding in a fab's parcel: where `riders`, the shops riding
 * there, sell a line and the cheapest mix buys from none of them, the cheapest mix that buys a line from one of them
 * (of equal ones the first, by line and then offer). Each such search pins a line to a rider's offer, which can leave
 * twenty shops or fewer where the lines have more: it searches as choose() does for all the lines, dropping one shop at
 * a time past twenty (it searched every set of the twenty, a million, once for each rider offer). */
export function chooseRiding(perLine: Option[][], shipping: Record<string, number>, riders: string[]): Option[] {
  const nan = (x: Option) => Number.isNaN(x.orderUsd);
  const many = new Set(perLine.flatMap((opts) => (opts.every(nan) ? opts : opts.filter((x) => !nan(x)))).map((x) => x.o.supplier)).size > 20;
  const picks = choose(perLine, shipping, many);
  if (!riders.length || picks.some((x) => riders.includes(x.o.supplier))) return picks;
  const cost = (xs: Option[]) => xs.reduce((t, x) => t + (nan(x) ? 0 : x.orderUsd), 0)
    + [...new Set(xs.map((x) => x.o.supplier))].reduce((t, s) => t + (shipping[s] ?? 0), 0);
  let least: Option[] | undefined;
  perLine.forEach((opts, i) => opts.forEach((x) => {
    if (!riders.includes(x.o.supplier) || (nan(x) && opts.some((y) => !nan(y)))) return;
    const got = choose(perLine.map((o, k) => (k === i ? [x] : o)), shipping, many);
    if (got.length && (!least || cost(got) < cost(least) - 1e-9)) least = got;
  }));
  return least ?? picks;
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

/** The cheapest way to give each row a different column (`cost[r][c]`, Infinity where it may not), by the Hungarian
 * method: each row's column, or undefined where there is no such way. */
export function assign(cost: number[][]): number[] | undefined {
  const n = cost.length, m = n ? cost[0].length : 0;
  if (n > m) return undefined;
  // A cost no way giving each row a column it may take comes to, for those it may not.
  const big = (cost.flat().filter(Number.isFinite).reduce((t, x) => t + Math.abs(x), 0) + 1) * (n + 1);
  const a = (r: number, c: number) => (Number.isFinite(cost[r][c]) ? cost[r][c] : big);
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const col = new Array<number>(n);
  for (let j = 1; j <= m; j++) if (p[j]) col[p[j] - 1] = j - 1;
  return col.some((c, r) => !Number.isFinite(cost[r][c])) ? undefined : col;
}

const round = (x: number) => Math.round(x * 100) / 100;
/** The words for a shipping figure read at the checkout of a shop that quoted a made part (catalog.json shippingRead),
 * which `sprue quote` tells from a figure read from published rates by them. */
export const CHECKOUT_READ = "shipping read at the shop's checkout or from its published rates";

/** The shops with a shop's quote for a made part anywhere in catalog.json, picked in this order or not: a figure read
 * for them may have been read at their checkout. */
export const quotingShops = (rates: FabRates) =>
  new Set(Object.values(rates.shopQuotes ?? {}).flat().filter((o) => o?.shopQuote).map((o) => o.supplier));

/** The most shops that quoted made parts the quote tries every set of: 2^8 - 1 sets, each set's picks and its carriers'
 * parts worked out once and laid on each shipsWith try, each different order priced at most once (a priceWith, which
 * takes the bought lines' shops from chooseRiding(), run once for each different way of weighing the shops that sell
 * them, as riding in a parcel or paid by a made line, and of the shops among them riding in a try's fab's parcel where
 * the order needs a line there: where the cheapest mix buys none of theirs, choose() runs again for each offer of
 * theirs), and none whose floor shows it cannot be the order kept (in quote(), below). The hand-off knows seven shops
 * (handoff.ts SHOPS). Measured on 2026-11-23: eight that all quote every one of 12 or 24 parts and all carry a shop
 * take under a twentieth of a second, two printed parts beside or not. With fifteen shops selling eight bought lines as
 * well, choose() searches 2^15 sets of them for each such weighing, but most orders are not priced: about a ninth to a
 * fifth of a second, beside two printed parts and two of the fifteen riding with print services or not (the quote of
 * 2026-11-22 took about three quarters of a second to nine tenths, and two to two and a third with the prints); on 33
 * catalogs of 12 and 24 parts with two printed parts, fourteen or fifteen shops selling ten bought lines and every
 * shop's shipping drawn at random, about a fifteenth to a third of a second, beside a 50 by 40 mm board or not (the
 * quote of 2026-11-22: seven tenths of a second to three, and one and two fifths to eleven and a quarter beside the
 * board). With the eight among the fifteen, a ninth to a sixth; where each of the eight sells a bought line too,
 * twenty-three shops, under an eighth, as each search past twenty, pinned to a rider's offer or not, drops one shop at
 * a time (pinned, it searched every set of twenty, half a minute on one catalog). Where fifteen shops sell fifteen
 * bought lines for 24 parts, eight of them each riding with a quoting shop, two with print services and seven each
 * alone selling a line, whose shipping every order pays, under a sixteenth, and under a sixth with two printed parts (a
 * second, and three and a half, on 2026-11-22). Past eight, where quote() then searches for every set whose orders
 * could cost no more than the cheapest found (bounded()), forty quoting shops that all quote 24 parts, seven carrying a
 * shop and the other thirty-three riding with a print service, take (measured on 2026-11-24, beside the quote of
 * 2026-11-23 on the same machine) about a third of a second to a second and a third where the prices are random (a
 * quarter to a third before), and about three quarters of a second to a second and two thirds where the parts are
 * cheapest at eleven or twelve of them, the carriers among them (as long as before); with 96 parts, about two thirds
 * of a second to two seconds, and four and a half (a half to one and a quarter, and four and a half, before). Of those
 * 24 catalogs, all but one cost less than before, by $2 to $36. madeWays(), which past eight also lays every order a
 * pick could make the cheapest (measured on 2026-11-28), takes a quarter of a second to eight on the twelve with 24
 * parts where the prices are random (a sixth of a second to one before), as long as before where they are cheapest at
 * twelve shops (a half to one and a third), and one to four seconds with 96 parts (a third to three before). */
const QUOTE_SHOPS = 8;

/** Whether quote() leaves out a try whose floor is above the total of an order it keeps: tests set `floors` to false to
 * price every try, and past QUOTE_SHOPS quoting shops to try every set of them, to check that the floors change no
 * quote and that the search past QUOTE_SHOPS (bounded()) changes no total. */
export const quoteSearch = { floors: true };

/** While madeWays() runs quote(), where quote() leaves the made lines' options and each order of them it weighs. */
let collecting: { lines: string[]; fabs: QuoteLine[][]; ways: MadeWay[] } | undefined;

/** An order of made lines quote() weighs: each made line's option (its place in `fabs`), and for a try that counts only
 * where a line rides in a fab's parcel, that fab. With `when`, an order quote() weighs only with a bought line pinned
 * (one of moveTo()'s ties that way() keeps only where a pin makes a shop alone sell a line): it may weigh it where a
 * line is pinned to one of these shops, and, as the moveTo() call that gave it does, never where none is. A pin can
 * also make quote() weigh another order of the same cost as one listed, or one listed in another place (the pinned
 * shop sells alone, so states of a call that differed only in it merge), so with pins the order of the made lines it
 * keeps can be one listed here at another place or none listed, at the same total wherever this was fuzzed. */
export type MadeWay = { at: number[]; fab?: string; when?: string[] };

/** Every order of the made lines that quote() weighs with these inputs, in the order it weighs them, each once; and
 * the made lines (those it prices, in bom.json's order) with their options. quote() with a bought line pinned to an
 * offer weighs the same orders but where two cost as much (moveTo()'s ties, turning on the shops alone selling a
 * bought line), so each of those is here too, with the shops a pin to which could make quote() weigh it (`when`: an
 * order also weighed unpinned has none); past QUOTE_SHOPS quoting shops, those it weighs unpinned and every other that
 * could be the cheapest with some lines pinned (quote() below). The page prices a pick with each of them (explorer.json
 * ways), as `sprue pick` would. */
export function madeWays(bom: Bom, sourcing: Sourcing, rates: FabRates, shipping: Record<string, number>,
  need: (l: BomLine) => number = (l) => batchNeed(l, bom.units), notes: ShippingNotes = {}): { lines: string[]; fabs: QuoteLine[][]; ways: MadeWay[] } {
  const was = collecting;
  collecting = { lines: [], fabs: [], ways: [] };
  try {
    quote(bom, sourcing, rates, shipping, need, notes);
    const seen = new Set<string>();
    // Each once: weighed unpinned where any of its tries is, else where a pin to a shop of any of them could be.
    const byKey = new Map<string, MadeWay>();
    for (const w of collecting.ways) {
      const key = JSON.stringify([w.at, w.fab ?? null]), was = byKey.get(key);
      if (!was) byKey.set(key, { ...w, ...(w.when ? { when: [...w.when] } : {}) });
      else if (!w.when) delete was.when;
      else if (was.when) was.when = [...new Set([...was.when, ...w.when])];
    }
    return { lines: collecting.lines, fabs: collecting.fabs, ways: [...byKey.values()] };
  } finally {
    collecting = was;
  }
}

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
  // moves fewest lines from the fab cheapest for each, then one that holds with no bought line riding in a fab's parcel,
  // then the first). The sets below place each part priced from shops' quotes, and one of them may take such a part away
  // from the fab: so where the order has such parts, the other lines alone are tried at the fab too, wherever the base
  // has none of them there.
  const tries: { made: QuoteLine[]; fab?: string; when?: string[] }[] = [{ made: base }];
  for (const fab of new Set(Object.values(notes.shipsWith ?? {}))) for (const others of base.some((q) => q.shopQuote) ? [false, true] : [false]) {
    if (base.some((q) => (!others || !q.shopQuote) && q.supplier === fab)) continue;
    const at = fabs.map((o, i) => (others && base[i].shopQuote ? undefined : o.find((q) => q.supplier === fab)));
    const extra = at.map((q, i) => (q ? q.orderUsd - base[i].orderUsd : Infinity));
    const one = extra.indexOf(Math.min(...extra));
    if (!at[one]) continue;
    tries.push({ made: base.map((q, i) => (i === one ? at[i]! : q)), fab });
    if (at.filter(Boolean).length > 1) tries.push({ made: base.map((q, i) => at[i] ?? q), fab });
  }
  // A shop rides with a carrier only if it sells a bought line here or makes a made one.
  const boughtSellers = new Set(bom.lines.filter((l) => l.process === "buy" && need(l) > 0)
    .flatMap((l) => (sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []).map((o) => o.supplier)));
  const sellers = new Set([...boughtSellers, ...fabs.flat().map((q) => q.supplier)]);
  // A plastic print goes where the order costs least with each shop's shipping counted, as a part priced from shops'
  // quotes does (below), not to the print service cheapest for it before shipping. On top of each try above, for each
  // set of the print services, each print more than one of them makes takes its cheapest option from those services,
  // but where the try moved it to its fab, which it stays at (2^services tries, not services^prints); and where a
  // service of the set that a shop selling or making a line here rides with (shipsWith) is left with no print, also
  // the way that gives each such service of the set a print of its own, a different one each, the prints costing
  // least extra in all (then moving fewest from the service cheapest for each), but not a service a line the try
  // keeps is at already (a print at the try's fab or at the one service making it; a part priced from shops' quotes
  // does not count, as the sets below may move it away). A way that puts the prints at some services costs no less
  // than one of that set's ways on the try placing its other lines: those use no service it doesn't, and each it uses
  // that a shop rides with, and their prints cost no more in all (each at the cheapest of the set for it, but those
  // given to such a service, which cost least extra of every way to give them).
  const fabLines = madeLines.filter((_, i) => madeOpts[i].length);
  const printAt = fabs.map((o, i) => (!base[i].shopQuote && fabLines[i].process === "print" && o.length > 1 ? o : []));
  const printShops = [...new Set(printAt.flat().map((q) => q.supplier))];
  const carried = new Set(Object.entries(notes.shipsWith ?? {}).filter(([s, f]) => s !== f && sellers.has(s)).map(([, f]) => f));
  if (printShops.length > 1) for (const t of [...tries]) for (let m = 1; m < 1 << printShops.length; m++) {
    const inSet = (s: string) => (m & (1 << printShops.indexOf(s))) !== 0;
    const moves = (i: number) => printAt[i].length > 0 && t.made[i].supplier !== t.fab;
    const made = t.made.map((q, i) => (moves(i) ? printAt[i].find((x) => inSet(x.supplier)) : q));
    if (!made.every(Boolean)) continue;
    if (made.some((q, i) => q !== t.made[i])) tries.push({ made: made as QuoteLine[], fab: t.fab });
    const held = new Set(made.flatMap((q, i) => (moves(i) || base[i].shopQuote ? [] : [q!.supplier])));
    const want = printShops.filter((s) => inSet(s) && carried.has(s) && !held.has(s));
    if (want.every((s) => made.some((q, i) => moves(i) && q!.supplier === s))) continue;
    let way: QuoteLine[] | undefined, least = Infinity, fewest = Infinity;
    // Each service of `want` in turn takes a print not yet given one, as every way of doing so is tried. A way already
    // dearer than the least found so far is dropped, so one moving fewer lines wins only at the same cost.
    const give = (k: number, w: QuoteLine[], given: number[], extra: number) => {
      if (extra > least + 1e-9) return;
      if (k === want.length) {
        const n = w.filter((q, i) => q.supplier !== base[i].supplier).length;
        if (extra < least - 1e-9 || n < fewest) [way, least, fewest] = [w, extra, n];
        return;
      }
      w.forEach((q, i) => {
        const x = moves(i) && !given.includes(i) ? printAt[i].find((y) => y.supplier === want[k]) : undefined;
        if (x) give(k + 1, w.map((y, j) => (j === i ? x : y)), [...given, i], extra + x.orderUsd - q.orderUsd);
      });
    };
    give(0, made as QuoteLine[], [], 0);
    if (way) tries.push({ made: way, fab: t.fab });
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
  // are where one of the tries above puts them (its prints as one of the print services' sets does, as above), and its
  // parts go to some set of shops, each with a part; that set's
  // picks on that try, with every carrier there given a part this way (and the shop of the set riding with the try's
  // fab, where that is what rides there), cost no more (the parts no more, the shops no more, every carrier there for
  // its riders, and the bought lines' shops, chosen again for that order by priceWith, no more than that way's there).
  // So up to QUOTE_SHOPS shops, where every set is tried, and up to twenty selling the bought lines, where choose()
  // tries every set of those, the quote is the cheapest of every way (to within a cent a line: ways are compared on totals of lines rounded to the cent,
  // the bought lines' shops chosen on prices before rounding), each
  // bought line's offer chosen of its offers and each plastic print's service of those that print it as well
  // (adapters/fab.test.ts checks it against every way on random catalogs, against every way of the bought lines'
  // offers too, and of a board's fabs beside several prints), where each shop that quoted has a shipping figure in
  // catalog.json: one with none counts as $0 where it sends a quoted part and at its print rates' figure
  // where it only prints, so a part sent there can cost less than none (such an order names the shop in noShipping,
  // which the gates refuse). Past QUOTE_SHOPS shops, first each shop added to the base's, and each shop with only the
  // base's for the parts it did not quote, each with each one and each two of its carriers given a part as well as
  // all of them (where they are up to QUOTE_SHOPS); then every set whose ways could cost no more than the cheapest
  // order found, each with all its carriers given a part at once (bounded(), below), so the quote is the cheapest of
  // every way there too (of orders that cost the same, not always the one trying every set keeps), where every price
  // is a number and the floors hold (floored, below); elsewhere only the first sets, not always the cheapest. A set's
  // try on a shipsWith try counts as that one does, only where a line rides with its fab.
  const quotedAt = fabs.map((o, i) => (base[i].shopQuote ? o : []));
  const quoteShops = [...new Set(quotedAt.flat().map((q) => q.supplier))];
  const baseShops = quotedAt.flatMap((o, i) => (o.length ? [base[i].supplier] : []));
  // Every set up to QUOTE_SHOPS shops, and past it where a test prices every try (quoteSearch.floors off, on catalogs
  // of a few more shops); else first the few sets below, then those bounded() finds.
  const everySet = quoteShops.length <= QUOTE_SHOPS || !quoteSearch.floors;
  const sets = everySet
    ? Array.from({ length: 2 ** quoteShops.length - 1 }, (_, m) => new Set(quoteShops.filter((_, k) => Math.floor((m + 1) / 2 ** k) % 2)))
    : quoteShops.flatMap((s) => [new Set([...baseShops, s]), new Set([s, ...quotedAt.flatMap((o, i) => (o.some((q) => q.supplier === s) ? [] : [base[i].supplier]))])]);
  const carriers = [...new Set(Object.values(notes.shipsWith ?? {}))]
    .filter((f) => quoteShops.includes(f) && Object.entries(notes.shipsWith ?? {}).some(([s, g]) => g === f && s !== f && sellers.has(s)));
  // A board's shipping is in its price (priceWith).
  const boards = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
  // A shop that alone sells a bought line here (of its offers with a price, as choose() reads them) ships it whatever
  // the way.
  const soleSellers = new Set(bom.lines.filter((l) => l.process === "buy" && need(l) > 0).flatMap((l) => {
    const opts = options(l, need(l), sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []);
    const priced = opts.some((x) => !Number.isNaN(x.orderUsd)) ? opts.filter((x) => !Number.isNaN(x.orderUsd)) : opts;
    const shops = new Set(priced.map((x) => x.o.supplier));
    return shops.size === 1 ? [...shops] : [];
  }));
  // For each try above, the shops of its lines not priced from quotes: a set's way laid on that try leaves each of them
  // its shipping to pay whatever the way (`fixed`, but for a board fab, whose shipping is in the board's price, and with
  // each shop alone selling a bought line), and a shop riding with one of them (`held`, a board fab included) rides
  // whatever the way; and the try's fab. Each different one, once (keyed as JSON, as a shop's name may hold any text).
  const triedSeen = new Set<string>();
  const byTry = tries.flatMap(({ made, fab }) => {
    const held = new Set(made.flatMap((q, i) => (quotedAt[i].length ? [] : [q.supplier])));
    const fixed = new Set([...made.flatMap((q, i) => (quotedAt[i].length || boards.has(q.lineId) ? [] : [q.supplier])), ...soleSellers]);
    const key = JSON.stringify([[...held].sort(), [...fixed].sort(), fab ?? null]);
    if (triedSeen.has(key)) return [];
    triedSeen.add(key);
    return [{ held, fixed, fab }];
  });
  // The shops paid whatever the way on every try: no tie turns on them.
  const paidAlways = new Set([...byTry[0].fixed].filter((s) => byTry.every((t) => t.fixed.has(s))));
  // priceWith puts a shop's lines in a fab's parcel only where its own shipping is not a known 0, as riding then saves
  // it none: catalog.json's figure, or with none, for a shop sending only made lines not priced from quotes, its print
  // rates' (a board fab's being 0). So a shop holding a quoted part or a bought line rides where its figure is not 0,
  // and any other surely rides only where its figure, or with none its print rates', is not 0.
  const sends = (s: string) => (shipping[s] ?? printShipping(rates, s)) !== 0;
  /** `picks` with each shop of `fs` given a part it quoted, a different part each, costing least extra in all, of every
   * way (a part already at its shop costs none, so a shop the set uses keeps a part of its own when another moves
   * away). Of ways that cost the same, for each try above with its lines not priced from quotes (byTry), the one whose
   * other parts' shops ship least on that try (so a part moves where that frees a shop), each paid whatever the way
   * there counting none, as does each riding with one of `fs` or with a shop of such a line, as it rides in that parcel
   * whatever the way; and on a try with a fab that none of those lines' shops, no shop of `fs` and no shop alone
   * selling a bought line surely rides with (`sends`), also the one of those that keeps a part at a shop riding with
   * the fab whose own shipping is not 0, as the try counts only where a line does; each then the one that leaves most
   * parts at the shop cheapest for each (so no part moves for nothing), then the first. None where there is no such
   * way. Worked out part by part, keeping the best way for each set of the shops of `fs` given a part so far and of the
   * other shops the quoted parts use so far (but those paid whatever the way on every try), those other shops kept
   * track of only where they and `fs` are up to 12, as they always are with up to QUOTE_SHOPS quoting shops; past that,
   * of ways that cost the same, the one that moves fewest, or with `exact`, matchTo()'s way. */
  // For madeWays(): each way moveTo() gives only as a tie (below), with the shops a pin to which could make it weighed.
  const tiedWhen = new WeakMap<QuoteLine[], string[]>();
  const moveTo = (picks: QuoteLine[], fs: string[], exact = false): QuoteLine[][] => {
    const others = [...new Set(picks.flatMap((q, i) => (quotedAt[i].length && !fs.includes(q.supplier) && !paidAlways.has(q.supplier) ? [q.supplier] : [])))];
    const track = fs.length + others.length <= 12;
    if (!track && exact) return matchTo(picks, fs);
    // A state is a number: the shops of `fs` given a part so far, times `width`, plus (where tracked) the other shops
    // used so far. Each part's step keeps, for each state reached, its cost, its moves, the state it came from and the
    // shop of `fs` given this part (-1 for none); the states in the order first reached, as the first way found is kept.
    const width = track ? 2 ** others.length : 1, size = 2 ** fs.length * width, all = 2 ** fs.length - 1;
    let usd = new Float64Array(size), moves = new Int32Array(size), seen = new Uint8Array(size), list = [0];
    let nUsd = new Float64Array(size), nMoves = new Int32Array(size), nSeen = new Uint8Array(size);
    seen[0] = 1;
    const steps = picks.map((p, i) => {
      const from = new Int32Array(size), gave = new Int8Array(size), next: number[] = [];
      const keep = (st: number, u: number, m: number, prev: number, k: number) => {
        if (!nSeen[st]) { nSeen[st] = 1; next.push(st); }
        else if (!(u < nUsd[st] - 1e-9 || (u <= nUsd[st] + 1e-9 && m < nMoves[st]))) return;
        nUsd[st] = u; nMoves[st] = m; from[st] = prev; gave[st] = k;
      };
      const o = track && quotedAt[i].length ? others.indexOf(p.supplier) : -1, stays = Number(p.supplier !== base[i].supplier);
      // Each shop of `fs` with its quote for this part, if it quoted it.
      const to = fs.map((f) => quotedAt[i].find((x) => x.supplier === f));
      const extra = to.map((q) => (q ? q.orderUsd - p.orderUsd : 0)), moved = to.map((q) => Number(q?.supplier !== base[i].supplier));
      for (const st of list) {
        const got = Math.floor(st / width), used = st % width;
        keep(got * width + (o < 0 ? used : used | (1 << o)), usd[st], moves[st] + stays, st, -1);
        for (let k = 0; k < fs.length; k++) {
          if (to[k] && !(got & (1 << k))) keep((got | (1 << k)) * width + used, usd[st] + extra[k], moves[st] + moved[k], st, k);
        }
      }
      for (const st of list) seen[st] = 0;
      [usd, nUsd, moves, nMoves, seen, nSeen, list] = [nUsd, usd, nMoves, moves, nSeen, seen, next];
      return { from, gave, to };
    });
    const done = list.filter((st) => Math.floor(st / width) === all);
    if (!done.length) return [];
    const least = Math.min(...done.map((st) => usd[st]));
    const tied = done.filter((x) => usd[x] <= least + 1e-9);
    const ridesWith = (s: string, f?: string) => f !== undefined && s !== f && notes.shipsWith?.[s] === f;
    const way = ({ held, fixed, fab }: (typeof byTry)[number], keep: boolean) => {
      const rides = others.map((s) => [...held, ...fs].some((f) => ridesWith(s, f)));
      const ship = (st: number) => others.reduce((t, x, k) => t + ((st % width) & (1 << k) && !fixed.has(x) && !rides[k] ? shipping[x] ?? 0 : 0), 0);
      const kept = (st: number) => !keep || others.some((x, k) => (st % width) & (1 << k) && ridesWith(x, fab) && shipping[x] !== 0);
      let best = -1;
      for (const st of tied) if (kept(st) && (best < 0 || ship(st) < ship(best) - 1e-9 || (ship(st) <= ship(best) + 1e-9 && moves[st] < moves[best]))) best = st;
      return best;
    };
    const states = [...new Set(byTry.flatMap((t) => {
      // A try with a fab counts only where a line rides with it: where none of its other lines, no shop of `fs` and no
      // shop alone selling a bought line surely does, also the way that keeps a part at a shop riding with it.
      const surely = [...[...t.held].filter(sends), ...[...fs, ...soleSellers].filter((s) => shipping[s] !== 0)];
      const keep = track && t.fab !== undefined && !surely.some((s) => ridesWith(s, t.fab));
      return [way(t, false), ...(keep ? [way(t, true)] : [])];
    }))].filter((st) => st >= 0);
    const path = (best: number) => {
      const moved = [...picks];
      for (let i = picks.length - 1, st = best; i >= 0; st = steps[i].from[st], i--) if (steps[i].gave[st] >= 0) moved[i] = steps[i].to[steps[i].gave[st]]!;
      return moved;
    };
    if (!collecting || !track) return states.map(path);
    // For madeWays(), after those, every other way that costs as little: which of them way() keeps turns on the shops
    // alone selling a bought line, and a pin makes its shop one. Of this call's states as they are with no pin, a pin
    // can make way() keep one only by taking the shipping off a shop it uses that a way kept does not (each other way's
    // shipping can only fall, and a shop both use comes off both), so each says which of its shops, not used by every
    // way kept, a pin could make alone sell a line (one selling a bought line), and one with none is never kept. (A pin
    // to one of them is needed, not always enough: it must take off as much as the way kept costs less in shipping.
    // With a pin, the pinned shop leaves `others`, so states that differed only in it merge, and the path kept for
    // them can be another of the same cost: see MadeWay.)
    return [...states.map(path), ...tied.filter((st) => !states.includes(st)).flatMap((st) => {
      const when = others.filter((x, k) => (st % width) & (1 << k) && boughtSellers.has(x) && states.some((s) => !((s % width) & (1 << k))));
      if (!when.length) return [];
      const moved = path(st);
      tiedWhen.set(moved, when);
      return [moved];
    })];
  };
  /** moveTo() where the shops are too many to keep track of, as past QUOTE_SHOPS quoting shops they can be: `picks`
   * with each shop of `fs` given a part it quoted, a different part each, costing least extra in all, of every way (a
   * part already at its shop costs none): the shops and parts matched by assign(). None where there is no such way. Of
   * ways that cost the same, the one assign() finds. */
  const matchTo = (picks: QuoteLine[], fs: string[]): QuoteLine[][] => {
    const parts = picks.flatMap((_, i) => (quotedAt[i].length ? [i] : []));
    const to = fs.map((f) => parts.map((i) => quotedAt[i].find((x) => x.supplier === f)));
    const got = assign(to.map((qs) => qs.map((q, j) => (q ? q.orderUsd - picks[parts[j]].orderUsd : Infinity))));
    if (!got) return [];
    const moved = [...picks];
    got.forEach((j, k) => { moved[parts[j]] = to[k][j]!; });
    return [moved];
  };
  // Each one of `xs` and each two of them, in order.
  const upToTwo = (xs: string[]) => xs.flatMap((a, i) => [[a], ...xs.slice(i + 1).map((b) => [a, b])]);
  // The shops that quoted a part and ride with a fab (shipsWith), each with its fab.
  const quotedRiders = Object.entries(notes.shipsWith ?? {}).filter(([s, f]) => s !== f && quoteShops.includes(s));
  // A set's picks and its carriers' parts depend on the set alone, but for the ties broken for each try (laid on a
  // try, they take the place of every part priced from quotes): each is worked out once (past QUOTE_SHOPS shops, two
  // ways of making a set can make the same one; a set is keyed by its shops' places in quoteShops, as a name may hold
  // any text), and every way of it laid on every try (a quoting rider's ways only on tries with its fab).
  const setsSeen = new Set<string>();
  const ways = (allowed: Set<string>, exact: boolean) => {
    const key = `${Number(exact)} ${quoteShops.flatMap((s, k) => (allowed.has(s) ? [k] : [])).join(",")}`;
    if (setsSeen.has(key)) return [];
    setsSeen.add(key);
    const picks = base.map((b, i) => (quotedAt[i].length ? quotedAt[i].find((q) => allowed.has(q.supplier)) : b));
    if (!picks.every(Boolean)) return [];
    // Every carrier of the set with a part of its own (one the set uses can lose its part to another and need one back).
    const inSet = carriers.filter((f) => allowed.has(f));
    // But for the few sets tried first past QUOTE_SHOPS shops, all of them at once: for those, as many at once as the
    // search works through every set of, and no more (its ways grow with every set of the shops given a part).
    const groups: { fs: string[]; at?: string }[] = [
      ...(!inSet.length ? [] : exact ? [inSet] : [...upToTwo(inSet).filter((g) => g.length < inSet.length), ...(inSet.length <= QUOTE_SHOPS ? [inSet] : [])])
        .map((fs) => ({ fs })),
      ...quotedRiders.filter(([r]) => allowed.has(r) && !inSet.includes(r))
        .flatMap(([r, at]) => (exact || !inSet.length ? [[...inSet, r]] : [[r], ...(inSet.length < QUOTE_SHOPS ? [[...inSet, r]] : [])]).map((fs) => ({ fs, at }))),
    ];
    return [{
      picks: picks as QuoteLine[],
      moves: groups.flatMap(({ fs, at }) => moveTo(picks as QuoteLine[], fs, exact).filter((m) => m.some((q, i) => q !== picks[i])).map((m) => ({ m, at }))),
    }];
  };
  // The tries so far, which each set's ways are laid on.
  const plain = [...tries];
  const lay = (bySet: ReturnType<typeof ways>) => {
    for (const t of plain) for (const { picks, moves } of bySet) {
      const on = (m: QuoteLine[]) => t.made.map((b, i) => (quotedAt[i].length ? m[i] : b));
      const made = on(picks);
      if (made.some((q, i) => q !== t.made[i])) tries.push({ made, fab: t.fab });
      for (const { m, at } of moves) if (!at || at === t.fab) tries.push({ made: on(m), fab: t.fab, ...(tiedWhen.has(m) ? { when: tiedWhen.get(m) } : {}) });
    }
  };
  if (quoteShops.length >= 2) lay(sets.flatMap((allowed) => ways(allowed, everySet)));
  // Many tries share their picks (a shipsWith try's quoted parts are set again by each set, and often one shop's quote
  // is the cheapest of a set for every part): price each set of picks at most once (none whose floor leaves it out,
  // below). Every pick is one of its line's options (fabs), so its place there keys it.
  const pricedWith = new Map<string, ReturnType<typeof priceWith>>();
  // And choose() reads an order's made lines only for the weight it gives each shop selling a bought line (none where it
  // rides in a fab's parcel or a made line pays its shipping): search once for each different weighing and set of shops
  // riding in the try's fab's parcel (chooseRiding()), keeping each line's pick by its place among the line's options.
  // Each riding shop is keyed by its place among the shops selling the bought lines, not its name, which may hold any
  // text (joined by line breaks, the names of riders "a\nb" and of "a" and "b" would be one key).
  const chosenFor = new Map<string, number[]>();
  // A try with a fab is priced again with its fab (priceWith then buys a line riding in its parcel where it can) only
  // where it has a line from the fab, no line rides there as priced without it, and a shop selling a bought line rides
  // with it.
  const boughtRide = new Set(Object.entries(notes.shipsWith ?? {}).filter(([s, f]) => s !== f && boughtSellers.has(s)).map(([, f]) => f));
  const keyOf = (made: QuoteLine[]) => made.map((q, i) => fabs[i].indexOf(q)).join(",");
  // Made lines a try with no fab has hold with nothing riding: a try with a fab and the same made lines is that try.
  // (Past twenty shops selling the bought lines, its search for a line riding could find a mix that the search for
  // every line, dropping one shop at a time, missed: the order would then need a line riding where its made lines need
  // none, and the page would keep one on every pick that `sprue pick` quotes without.)
  const plainMade = new Set(tries.filter((t) => t.fab === undefined && !t.when).map((t) => keyOf(t.made)));
  const candidates = tries.filter((t) => t.fab === undefined || !plainMade.has(keyOf(t.made)));
  // Where many shops sell the bought lines, searching their shops is most of a quote's time, and each set of the print
  // services weighs them anew. So each try first gets a floor under its total (floor()), and the tries are priced from the lowest floor up, the
  // base order first. Once a floor is more than six tenths of a cent above the least total of a try kept so far, and a
  // billionth of that total more (for the error of adding such sums up in floating point), that try comes to a cent or
  // more above it once rounded to the cent, as does every try after it: none of them could be the order kept, so none
  // is priced. A try with a fab and no line riding there is not kept, and sets no least total. The tries priced are
  // compared in their own order, as all of them were, so the order kept is the one it was. A floor that is no number (a
  // price that is none) is priced first. The floors hold where the shipping of each shop selling or making a line here,
  // as priceWith reads it, is none or a number of 0 or more (for a shop named as a property every object has, such as
  // valueOf, with no figure in catalog.json, it is that property), and each print service's in rates.json too, every
  // price a number of 0 or more or none and each line's id its own: elsewhere every try is priced, as before. (A
  // comment in catalog.json's shipping, a key starting with "_" that no shop here is named, is no figure the quote
  // reads.) On input of other types than quote()'s, which catalog.json's checks refuse, a try left out is not priced,
  // so it does not throw where pricing it would (a notes.read that is no list, say). And the check reads each print
  // service's shipping in rates.json and each shop's here before any try is priced: a getter there that throws, which
  // no JSON file has, throws then, where pricing might not read it.
  const boughtOpts = bom.lines.filter((l) => l.process === "buy" && need(l) > 0)
    .map((l) => options(l, need(l), sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? [])).filter((o) => o.length);
  const sellerShops = [...new Set(boughtOpts.flat().map((x) => x.o.supplier))];
  const figure = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  const price = (x: unknown) => typeof x === "number" && !(x < 0);
  const object = (x: unknown): x is object => typeof x === "object" && x !== null;
  // The shipping figures as priceWith reads them, in rideAlong()'s copy: a plain object's own figures.
  const figures: Record<string, unknown> = object(shipping) ? { ...shipping } : {};
  const floored = quoteSearch.floors && object(shipping) && object(rates) && object(rates.print)
    && [...sellerShops, ...fabs.flat().map((q) => q.supplier)].every((s) => figures[s] === undefined || figure(figures[s]))
    && Object.values(rates.print).every((p) => object(p) && (p.shippingUsd === undefined || figure(p.shippingUsd)))
    && boughtOpts.flat().every((x) => price(x.orderUsd)) && fabs.flat().every((q) => price(q.orderUsd))
    && new Set(bom.lines.map((l) => l.id)).size === bom.lines.length;
  // Each bought line at its cheapest offer, rounded as toLine() rounds it; and the bought lines that no shop selling a
  // line alone (soleSellers, which every order buys from) sells.
  const boughtLeast = boughtOpts.reduce((t, o) => t + round(o.reduce((m, x) => Math.min(m, x.orderUsd), Infinity)), 0);
  const open = boughtOpts.filter((o) => !o.some((x) => soleSellers.has(x.o.supplier)));
  const floorOf = new Map<string, number>();
  /** An order's made lines as priceWith prices them, their shops' shipping as it charges them (`usd`), and the shipping
   * it weighs each shop selling a bought line at (`weigh`, in sellerShops' order: none for a shop a made line pays
   * already or riding in a fab's parcel), as floor() below reads them: what any mix of bought lines adds to the order is
   * their prices and the shipping of their shops so weighed. */
  const fixedOf = (made: QuoteLine[]) => {
    const madeBy = new Set(made.map((q) => q.supplier));
    const paid = new Set(made.filter((q) => !boards.has(q.lineId)).map((q) => q.supplier));
    const quotedFrom = new Set(made.filter((q) => q.shopQuote).map((q) => q.supplier));
    // As rideAlong() has it: none for a shop riding with a shop making a line here, else its own figure.
    const charge = (s: string) => {
      const f = notes.shipsWith?.[s];
      return (f !== undefined && f !== s && Object.hasOwn(notes.shipsWith!, s) && madeBy.has(f) ? 0 : (figures[s] as number | undefined))
        ?? (quotedFrom.has(s) ? 0 : printShipping(rates, s));
    };
    return { usd: made.reduce((t, q) => t + q.orderUsd, 0) + [...paid].reduce((t, s) => t + charge(s), 0),
      weigh: Float64Array.from(sellerShops, (s) => (paid.has(s) ? 0 : charge(s))) };
  };
  /** No more than priceWith's total for these made lines before it is rounded to the cent, with or without a fab: the
   * made lines, the shipping of their shops as priceWith charges it, each bought line at its cheapest offer, and the
   * shipping of the shops the bought lines come from, none for one a made line pays already: that of each shop selling
   * a line alone, as every order buys from it, and of the lines no such shop sells, the most that the shop selling one
   * that priceWith would charge least is charged, as one of those shops is. */
  const floor = (made: QuoteLine[]) => {
    const key = keyOf(made);
    let f = floorOf.get(key);
    if (f === undefined) {
      const ship = rideAlong(shipping, notes.shipsWith, new Set(made.map((q) => q.supplier)));
      const paid = new Set(made.filter((q) => !boards.has(q.lineId)).map((q) => q.supplier));
      const quotedFrom = new Set(made.filter((q) => q.shopQuote).map((q) => q.supplier));
      const charge = (s: string) => ship[s] ?? (quotedFrom.has(s) ? 0 : printShipping(rates, s));
      const weigh = new Map(sellerShops.map((s) => [s, paid.has(s) ? 0 : charge(s)]));
      f = made.reduce((t, q) => t + q.orderUsd, boughtLeast) + [...paid].reduce((t, s) => t + charge(s), 0)
        + [...soleSellers].reduce((t, s) => t + weigh.get(s)!, 0)
        + open.reduce((most, o) => Math.max(most, o.reduce((m, x) => Math.min(m, weigh.get(x.o.supplier)!), Infinity)), 0);
      floorOf.set(key, f);
    }
    return f;
  };
  // Each bought line's offers as priceWith chooses from them (those with a price, where any has one) and the cheapest,
  // rounded as toLine() rounds it; and the lines no shop selling a line alone sells.
  const offered = boughtOpts.map((o) => (o.some((x) => !Number.isNaN(x.orderUsd)) ? o.filter((x) => !Number.isNaN(x.orderUsd)) : o));
  const cheapest = offered.map((o) => round(o.reduce((m, x) => Math.min(m, x.orderUsd), Infinity)));
  const free = offered.flatMap((o, l) => (o.some((x) => soleSellers.has(x.o.supplier)) ? [] : [l]));
  /** Past QUOTE_SHOPS quoting shops, each set of them (`visit`) whose ways could cost `most` or less, by branch and
   * bound: each shop in turn put in the set or left out, the branch with the lowest bound taken up first, and a branch
   * left once its bound is above `most`. Any way giving each quoted part to a shop costs no less than the bound of a
   * branch that holds its set (the shops given a part, each with one): the least, over the tries above, of their made
   * lines not priced from quotes, each bought line at its cheapest, and the shipping (each shop of the set and of those
   * lines, but one riding where its fab may be in the set; of the bought lines no shop alone sells, lines no two of
   * which share a seller, each at least the least of its sellers' offer and shipping); plus the quoted parts, each at
   * least its cheapest from a shop that may be in the set, and that sum raised either by giving each shop in the set a
   * part of its own (the least extra, by assign()) or by the shipping of shops not yet decided (by dual ascent, as a
   * facility location search bounds its branches), whichever raises it more. A set with a shop that is the first of
   * the set for no part is left out, but for a carrier and one shop riding with a fab: the way with that shop's parts
   * at their first shops costs no more, as nothing else rides with it. So the set of a cheapest way is visited, and
   * its ways (every carrier, and that shop, given a part at once: moveTo() with `exact`) cost no more than that way.
   * With `over`, the bound is of a way's fixedOf() alone (its made lines and their shipping, nothing bought), with the
   * least each shop selling a bought line could be weighed at by a way of the branch, and a branch is left
   * where `over` says so of those, not by `most`. */
  const bounded = (most: () => number, visit: (allowed: Set<string>) => void, over?: (at: number, low: Float64Array) => boolean) => {
    const rideTo = new Map(Object.entries(notes.shipsWith ?? {}).filter(([s, f]) => s !== f));
    const printed = new Map<string, number>();
    const fromRates = (s: string) => {
      if (!printed.has(s)) printed.set(s, printShipping(rates, s));
      return printed.get(s)!;
    };
    // For each try above, its made lines not priced from quotes (and the bought lines at their cheapest): their price,
    // their shops and the shops they pay.
    const seen = new Set<string>();
    const per = plain.flatMap((t) => {
      const nq = t.made.filter((_, i) => !quotedAt[i].length);
      const key = t.made.map((q, i) => (quotedAt[i].length ? -1 : fabs[i].indexOf(q))).join(",");
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ usd: nq.reduce((x, q) => x + q.orderUsd, cheapest.reduce((x, y) => x + y, 0)), own: nq.reduce((x, q) => x + q.orderUsd, 0),
        by: new Set(nq.map((q) => q.supplier)), paid: new Set(nq.filter((q) => !boards.has(q.lineId)).map((q) => q.supplier)) }];
    });
    // The least, over those tries, of an order's total but for the quoted parts' prices, as low as any set within
    // `may` could make it, the shops of `inSet` paid: each shop riding where its fab may be in the order and paid where
    // it may be. And of the bought lines no shop alone sells, lines no two of which share a seller (taken greedily,
    // the most first): each buys from a shop of its own, so each adds at least the least, over its sellers, of the
    // offer's price above the line's cheapest and the seller's shipping. With `over`, the made lines and their shops'
    // shipping alone, and in `weighed` the least each shop selling a bought line is weighed at.
    const weighed = new Float64Array(sellerShops.length);
    const rest = (may: Set<string>, inSet: string[]) => {
      let least = Infinity;
      if (over) weighed.fill(Infinity);
      for (const t of per) {
        // The shipping as rideAlong() makes it with the shops of the try and of `may`.
        const own = (s: string) => {
          const f = rideTo.get(s);
          return f !== undefined && (t.by.has(f) || may.has(f)) ? 0 : (figures[s] as number | undefined);
        };
        const charge = (s: string) => own(s) ?? (may.has(s) ? 0 : fromRates(s));
        const weigh = (s: string) => (t.paid.has(s) || may.has(s) ? 0 : charge(s));
        let sum = over ? t.own : t.usd;
        for (const s of t.paid) sum += charge(s);
        for (const s of inSet) if (!t.paid.has(s)) sum += charge(s);
        if (over) {
          sellerShops.forEach((s, k) => { weighed[k] = Math.min(weighed[k], weigh(s)); });
          if (sum < least) least = sum;
          continue;
        }
        for (const s of soleSellers) sum += weigh(s);
        const taken = new Set<string>();
        for (const [w, l] of free.map((l) => [offered[l].reduce((m, x) => Math.min(m, round(x.orderUsd) + weigh(x.o.supplier)), Infinity) - cheapest[l], l] as const).sort((x, y) => y[0] - x[0]))
          if (offered[l].every((x) => !taken.has(x.o.supplier))) { sum += w; for (const x of offered[l]) taken.add(x.o.supplier); }
        if (sum < least) least = sum;
      }
      return least;
    };
    // Each quoting shop's shipping, as low as any set could make it on any try.
    const ship = quoteShops.map((s) => Math.min(...per.map((t) => {
      const sent = rideAlong(shipping, notes.shipsWith, new Set([...t.by, ...quoteShops]));
      return t.paid.has(s) ? 0 : sent[s] ?? 0;
    })));
    const parts = quotedAt.flatMap((o, i) => (o.length ? [i] : []));
    // Each shop's quote for each part: its price, and its place among the part's quotes (cheapest first).
    const usd = quoteShops.map((s) => parts.map((i) => quotedAt[i].find((q) => q.supplier === s)?.orderUsd ?? Infinity));
    const place = quoteShops.map((s) => parts.map((i) => { const k = quotedAt[i].findIndex((q) => q.supplier === s); return k < 0 ? Infinity : k; }));
    const carrier = quoteShops.map((s) => carriers.includes(s)), rider = quoteShops.map((s) => quotedRiders.some(([r]) => r === s));
    // The shops in turn: the carriers, then those cheapest for most parts, then those with the least shipping.
    const order = quoteShops.map((_, k) => k).sort((a, b) => Number(carrier[b]) - Number(carrier[a]) || place[b].filter((x) => x === 0).length - place[a].filter((x) => x === 0).length || ship[a] - ship[b] || a - b);
    // Whether a set is kept: each shop of it the first of the set for some part (its place among the part's quotes the
    // lowest), but carriers, and of the shops riding with a fab and carrying none, one at most (a way with two such
    // shops first for no part costs no less with one of them, its parts moved to their first shops).
    const kept = (chosen: number[]) => {
      const first = parts.map((_, j) => chosen.reduce((f, k) => (f < 0 || place[k][j] < place[f][j] ? k : f), -1));
      const idle = chosen.filter((k) => !first.includes(k));
      return idle.every((k) => carrier[k] || rider[k]) && idle.filter((k) => !carrier[k]).length <= 1;
    };
    // A bound on the quoted parts and the shipping of the shops not yet decided, the more of two: each part's cheapest
    // quote from a shop that may be in the set, plus the least extra of giving each shop in the set a part of its own;
    // and by dual ascent (as a facility location search bounds its branches), each part's figure starting at that
    // cheapest quote and rising, while no shop quoting it that cheaply has its shipping used up, towards the next
    // quote (a shop in the set has none to use). The figures' sum is no more than any set's parts and those shops'
    // shipping, so no more than its order's.
    const lift = new Float64Array(quoteShops.length), v = new Float64Array(parts.length), low = new Float64Array(parts.length);
    const bound = (chosen: number[], d: number) => {
      const may = [...chosen, ...order.slice(d)];
      for (const k of chosen) lift[k] = 0;
      for (const k of order.slice(d)) lift[k] = ship[k];
      for (let j = 0; j < parts.length; j++) {
        let m = Infinity;
        for (const k of may) if (usd[k][j] < m) m = usd[k][j];
        if (m === Infinity) return Infinity;
        v[j] = low[j] = m;
      }
      let alt = -Infinity;
      if (chosen.length) {
        const cost = chosen.map((k) => usd[k].map((x, j) => x - low[j]));
        const got = assign(cost);
        if (!got) return Infinity;
        alt = got.reduce((t, c, r) => t + cost[r][c], 0);
        for (let j = 0; j < parts.length; j++) alt += low[j];
      }
      for (let pass = 0, rose = true; rose && pass < 4; pass++) {
        rose = false;
        for (let j = 0; j < parts.length; j++) {
          let next = Infinity, room = Infinity;
          for (const k of may) {
            if (usd[k][j] <= v[j] + 1e-12) room = Math.min(room, lift[k]);
            else if (usd[k][j] < next) next = usd[k][j];
          }
          const by = Math.min(next - v[j], room);
          if (!(by > 1e-12) || by === Infinity) continue;
          for (const k of may) if (usd[k][j] <= v[j] + 1e-12) lift[k] -= by;
          v[j] += by;
          rose = true;
        }
      }
      let sum = 0;
      for (let j = 0; j < parts.length; j++) sum += v[j];
      sum = Math.max(sum, alt);
      const names = chosen.map((k) => quoteShops[k]);
      return rest(new Set(may.map((k) => quoteShops[k])), names) + sum;
    };
    // Best first: the branch with the lowest bound (the first made of those that tie) is taken up next, each shop in
    // the set or out of it, and each set reached is visited, until every branch left is bound above `most`.
    type Branch = { at: number; n: number; d: number; chosen: number[]; low?: Float64Array };
    const heap: Branch[] = [];
    const less = (x: Branch, y: Branch) => x.at < y.at || (x.at === y.at && x.n < y.n);
    let made = 0;
    const push = (chosen: number[], d: number) => {
      const at = bound(chosen, d);
      if (over ? over(at, weighed) : at > most()) return;
      heap.push({ at, n: made++, d, chosen, ...(over ? { low: weighed.slice() } : {}) });
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (!less(heap[i], heap[up])) break;
        [heap[i], heap[up]] = [heap[up], heap[i]];
        i = up;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    push([], 0);
    while (heap.length) {
      const { at, d, chosen, low: lows } = pop();
      if (over ? over(at, lows!) : at > most()) {
        if (over) continue;
        break;
      }
      if (d === order.length) {
        if (chosen.length) visit(new Set(chosen.map((k) => quoteShops[k])));
        continue;
      }
      const k = order[d];
      if (kept([...chosen, k])) push([...chosen, k], d + 1);
      push(chosen, d + 1);
    }
  };
  const floors = candidates.map((t) => (floored ? floor(t.made) : -Infinity));
  const rank = (i: number) => (Number.isNaN(floors[i]) ? -Infinity : floors[i]);
  const priced: (ReturnType<typeof priceWith> & { fab?: string })[] = [];
  let least = Infinity;
  // The tries from `from` on, from the lowest floor up (the base order first).
  const search = (from: number) => {
    const ids = candidates.map((_, i) => i).slice(from || 1).sort((a, b) => rank(a) - rank(b) || a - b);
    for (const i of from ? ids : [0, ...ids]) {
      if (floors[i] > least + 0.006 + least * 1e-9) break;
      const t = candidates[i], key = keyOf(t.made);
      // A tie madeWays() lists for a pin is not priced: the quote weighs what it weighs unpinned.
      if (t.when) continue;
      if (!pricedWith.has(key)) pricedWith.set(key, priceWith(t.made));
      let p = { ...pricedWith.get(key)!, fab: t.fab };
      if (t.fab !== undefined && boughtRide.has(t.fab) && t.made.some((q) => q.supplier === t.fab) && !p.lines.some((l) => l.shipsWith === t.fab)) {
        const at = `${t.fab}\0${key}`;
        if (!pricedWith.has(at)) pricedWith.set(at, priceWith(t.made, t.fab));
        p = { ...pricedWith.get(at)!, fab: t.fab };
      }
      if (p.fab && !p.lines.some((l) => l.shipsWith === p.fab)) continue;
      priced[i] = p;
      if (p.batchUsd < least) least = p.batchUsd;
    }
  };
  search(0);
  // Past QUOTE_SHOPS quoting shops, every set whose ways could come to no more than the least total found: bounded()
  // finds them, and each set's ways (every carrier given a part at once) are laid on every try and priced as above.
  if (!everySet && floored && fabs.flat().every((q) => Number.isFinite(q.orderUsd)) && cheapest.every(Number.isFinite) && Number.isFinite(least)) {
    bounded(() => least + 0.006 + least * 1e-9, (allowed) => {
      const from = tries.length;
      lay(ways(allowed, true));
      const added = tries.slice(from);
      for (const t of added) if (t.fab === undefined && !t.when) plainMade.add(keyOf(t.made));
      const start = candidates.length;
      for (const t of added) if (t.fab === undefined || !plainMade.has(keyOf(t.made))) { candidates.push(t); floors.push(floor(t.made)); }
      if (candidates.length > start) search(start);
    });
  }
  // For madeWays(), past QUOTE_SHOPS quoting shops, also every way that could be the cheapest with some bought lines
  // pinned, as `sprue pick` pins them, for the page to price a pick on each as `sprue pick` would. With any pins, a way
  // W comes to its fixedOf() usd and a mix of its bought lines, at their prices and its shops' shipping as W weighs it;
  // an order O with no fab buys the mix cheapest as O weighs it, so no dearer than W's mix would be with O (a fab only
  // narrows the mixes W weighs). So W costs no less than O but for the shipping O weighs above W (the most W's mix
  // could save), the rounding of each bought line (a cent for each with an offer that is no whole number of cents) and
  // of the total (a cent and a tenth): where W's usd is above O's by more, W is never the cheapest. Nor where O is not
  // weighed with the pins: the quote then bounds O's set above the order it keeps. bounded() with `over` visits every
  // set that could hold a way not so beaten by an O found so far (the orders with no fab laid above, then those of each
  // set laid), each set once, and its ways not so beaten are kept, each once, but not priced: the page prices them. Of
  // two Os, one weighed no more for any shop and no dearer beats every way the other does, and the other is not kept.
  if (collecting && !everySet && floored && fabs.flat().every((q) => Number.isFinite(q.orderUsd)) && cheapest.every(Number.isFinite)) {
    const front: ReturnType<typeof fixedOf>[] = [];
    const slack = 0.011 + 0.01 * boughtOpts.filter((o) => o.some((x) => Math.abs(round(x.orderUsd) - x.orderUsd) > 1e-9)).length;
    const over = (at: number, low: Float64Array) => front.some((o) => {
      let limit = o.usd + slack + 1e-9 * Math.abs(o.usd);
      for (let k = 0; k < low.length; k++) if (o.weigh[k] > low[k]) limit += o.weigh[k] - low[k];
      return at > limit;
    });
    const add = (o: ReturnType<typeof fixedOf>) => {
      if (front.some((f) => f.usd <= o.usd && f.weigh.every((w, k) => w <= o.weigh[k]))) return;
      for (let i = front.length - 1; i >= 0; i--) if (o.usd <= front[i].usd && o.weigh.every((w, k) => w <= front[i].weigh[k])) front.splice(i, 1);
      front.push(o);
    };
    const wayOf = (t: (typeof tries)[number]) => JSON.stringify([keyOf(t.made), t.fab ?? null, t.when ?? null]), listed = new Set(candidates.map(wayOf));
    for (const t of candidates) if (t.fab === undefined && !t.when) add(fixedOf(t.made));
    if (front.length) bounded(() => Infinity, (allowed) => {
      const from = tries.length;
      lay(ways(allowed, true));
      const added = tries.slice(from).filter((t) => !listed.has(wayOf(t))).map((t) => ({ t, f: fixedOf(t.made) }));
      for (const { t, f } of added) if (t.fab === undefined && !t.when) { plainMade.add(keyOf(t.made)); add(f); }
      for (const { t, f } of added) if ((t.fab === undefined || !plainMade.has(keyOf(t.made))) && !listed.has(wayOf(t)) && !over(f.usd, f.weigh)) {
        listed.add(wayOf(t));
        candidates.push(t);
        floors.push(floor(t.made));
      }
    }, over);
  }
  if (collecting) {
    collecting.lines = fabLines.map((l) => l.id);
    collecting.fabs = fabs;
    collecting.ways = candidates.map((t) => ({ at: t.made.map((q, i) => fabs[i].indexOf(q)), ...(t.fab === undefined ? {} : { fab: t.fab }),
      ...(t.when ? { when: t.when } : {}) }));
  }
  const best = priced.filter(Boolean)
    // An order that holds only with a bought line riding in its fab's parcel needs one (needsRider): no made line rides
    // there by itself, its shop's own shipping, as its made lines alone have it, a known 0 (a board fab with no figure
    // in catalog.json is labelled riding only for a bought line it sells there). Of two that cost the same and move as
    // many lines, the one that holds without one.
    .map((p) => ({ ...p, moves: p.made.filter((q, i) => q.supplier !== base[i].supplier).length,
      needs: p.fab !== undefined && !p.made.some((q) => q.shipsWith === p.fab
        && (shipping[q.supplier] ?? (p.made.every((l) => l.supplier !== q.supplier || !l.shopQuote) ? printShipping(rates, q.supplier) : undefined)) !== 0) }))
    .reduce((a, b) => (b.batchUsd < a.batchUsd - 1e-9 || (b.batchUsd <= a.batchUsd + 1e-9
      && (b.moves < a.moves || (b.moves === a.moves && a.needs && !b.needs))) ? b : a));
  best.made.forEach((q, i) => {
    if (q.supplier === base[i].supplier) return;
    // Why by the line's own shop: a board, whose shipping is in its price, moves only for a line riding in its parcel;
    // any other line where the order costs less with each shop's shipping counted, a line riding in its parcel or not
    // (named where one does). Riders that rode with that shop in the base order already are not why it moved.
    const riders = base.some((b) => b.supplier === q.supplier) ? []
      : [...new Set(best.lines.filter((l) => l.shipsWith === q.supplier).map((l) => l.supplier))];
    const ride = `${riders.join(", ")} ${riders.length === 1 ? "ships" : "ship"} in its parcel`;
    q.basis += `; chosen over ${base[i].supplier} (${usd(base[i].orderUsd)}) because `
      + (riders.length && boards.has(q.lineId) ? ride : `the order costs less with each shop's shipping counted${riders.length ? ` (${ride})` : ""}`);
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
    ...(best.needs ? { needsRider: best.fab } : {}),
  };

  /** The order with these made-line picks: the cheapest mix of shops for the bought lines, and one shipping charge
   * per shop (none for a shop whose parts ride in the parcel of a fab picked here). With a try's fab, which counts only
   * where a line rides in its parcel (passed only where no line rides there priced without it): the cheapest mix with
   * a bought line riding there, where some shop riding there sells one. */
  function priceWith(pickedMade: QuoteLine[], fab?: string) {
    const made = pickedMade.map((q) => ({ ...q }));
    const pcbLines = new Set(bom.lines.filter((l) => l.process === "pcb").map((l) => l.id));
    const lines: QuoteLine[] = [];
    const ship = rideAlong(shipping, notes.shipsWith, new Set(made.map((l) => l.supplier)));
    const bought = bom.lines.filter((l) => l.process === "buy" && need(l) > 0);
    const perLine = bought.map((l) => options(l, need(l), sourcing.lines.find((s) => s.lineId === l.id)?.offers ?? []));
    const priced = bought.filter((_, i) => perLine[i].length), lists = perLine.filter((o) => o.length);
    // The bought lines' shops are chosen with each shop's shipping weighed as the total below counts it: none for a
    // shop a made line here already pays it to (not a board fab, whose shipping is in the board's price) or riding in a
    // fab's parcel, and for a shop catalog.json has no figure for, a print service's from rates.json.
    const paid = new Set(made.filter((l) => !pcbLines.has(l.lineId)).map((l) => l.supplier));
    const sellerShops = [...new Set(lists.flat().map((x) => x.o.supplier))];
    const weigh = sellerShops.map((s) => (paid.has(s) ? 0 : ship[s] ?? printShipping(rates, s)));
    // With a try's fab (passed only where the fab makes a line and none rides there priced without it): the shops
    // whose bought lines ride in its parcel, as labelled below (riding with it, their own shipping not a known 0).
    const riders = fab === undefined ? [] : sellerShops.filter((s) => s !== fab && notes.shipsWith?.[s] === fab && shipping[s] !== 0);
    const key = `${weigh.join(",")} ${riders.map((s) => sellerShops.indexOf(s)).join(",")}`;
    if (!chosenFor.has(key))
      chosenFor.set(key, chooseRiding(lists, Object.fromEntries(sellerShops.map((s, k) => [s, weigh[k]])), riders).map((x, i) => lists[i].indexOf(x)));
    const chosen = chosenFor.get(key)!.map((k, i) => lists[i][k]);
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
  const offers = shopQuotesOf(rates, line.id), quotes = offers.filter((o) => o.shopQuote);
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
