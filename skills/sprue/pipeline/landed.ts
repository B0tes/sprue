// Sprue's price of the made parts in euros, landed in Italy: the numbers behind the hand-off's "In Italy, in euros"
// (handoff.ts writes the words). The quote is in USD for request.json's region; a person in Italy pays in euros, and a
// parcel from outside the EU pays the EU's charges on the way in. Each was read by hand, on the page handoff.ts cites:
//   the rate      fx.json: the ECB's reference rate of a date, for information only (a shop and a card use their own)
//   VAT           22% in Italy, on a parcel of any value: collected at the checkout by a seller in IOSS (a parcel up to
//                 €150), else on import by the courier, who usually adds a clearance fee of its own
//   the €3 duty   on a parcel up to €150 sold to a consumer, 1 July 2026 to 1 July 2028, per item: goods with the same
//                 tariff classification and description are one item however many pieces, and customs charge it per
//                 line of the declaration
//   the €2 fee    the EU's handling fee, per item counted the same way, on a parcel of any value sold to a consumer,
//                 since 1 November 2026; whoever declares the parcel owes it and may pass it on: with no VAT when you
//                 pay it at clearance of a parcel whose VAT IOSS collected, with 22% when the seller charges it at
//                 checkout or the courier collects the import VAT (the Commission's guidance of 5 October 2026, 9.2)
// Sprue can't tell how the seller will declare a parcel, so a cart of n parts counts 1 to n items, and each figure is a
// low and a high one. Sprue's shipping is the quote's, for request.json's region, not a price to Italy. Each line is
// converted to the cent on its own, so a part's figure and its cart's add up. Nothing here fetches or reads the clock.
// A cart with a line priced from a shop's quote (catalog.json shopQuote) lands by where its shop ships from (QUOTED)
// and the VAT each line's price holds, as its quote records it. Its shipping is the figure catalog.json records for the
// shop, which Sprue counts as the shipping to Italy, holding VAT or not. From inside the EU it clears no customs; the
// seller charges VAT: Italy's 22% from a seller in Italy, and from one in another EU country Italy's once its sales to
// people in other EU countries pass €10,000 a year, its own country's below that (the EU's place-of-supply rule).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, isDay } from "./io.ts";
import type { QuoteLine, Quotes, ShopQuote } from "./types.ts";

/** US dollars to the euro, as fx.json gives it: the rate of `date`, from `url`, read on `read`. */
export type Fx = { usdPerEur: number; date: string; source: string; url: string; read: string };


/** The dollars to the euro Sprue takes as a rate: the euro has been between about 0.8 and 1.6 dollars since 1999. */
export const USD_PER_EUR = [0.5, 2] as const;

/** pipeline/fx.json, or the file given; throws, saying what is wrong, on one Sprue can't use. */
export function loadFx(file = join(import.meta.dirname, "fx.json")): Fx {
  let fx: Partial<Fx>;
  try {
    fx = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`pipeline/fx.json can't be read (${errorText(e)})`);
  }
  const bad = !fx || typeof fx !== "object" ? "it is not an object"
    : typeof fx.usdPerEur !== "number" || !(fx.usdPerEur >= USD_PER_EUR[0] && fx.usdPerEur <= USD_PER_EUR[1])
      ? `usdPerEur is not a number of dollars to the euro (${USD_PER_EUR[0]} to ${USD_PER_EUR[1]})`
    : !isDay(fx.date) ? "date is not a day (YYYY-MM-DD)"
    : !isDay(fx.read) ? "read is not a day (YYYY-MM-DD)"
    : fx.read < fx.date ? "read is before date: a rate can't be read before its day"
    : typeof fx.url !== "string" || !/^https:\/\/\S+$/.test(fx.url) ? "url is not an https page"
    : typeof fx.source !== "string" || !fx.source.trim() ? "source is empty" : undefined;
  if (bad) throw new Error(`pipeline/fx.json: ${bad}`);
  return fx as Fx;
}

/** Days from the rate's date to `day` (YYYY-MM-DD). */
export const fxAge = (fx: Fx, day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${fx.date}T00:00:00Z`)) / 86_400_000);
/** A rate more than this many days older than the folder is said to be out of date. */
export const FX_OLD_DAYS = 31;

export const VAT_IT = 0.22, DUTY_EUR = 3, FEE_EUR = 2, LOW_VALUE_EUR = 150;
/** A parcel this close to €150 may fall on either side: customs converts at its own rate, and a shop counts its own way. */
export const NEAR_EUR = 20;
const vat = (eur: number) => eur * (1 + VAT_IT);
/** To the cent, a half cent up: 13.75 x 1.22 is 16.775, €16.78, though in binary floats it is 16.774999... */
export const cents = (eur: number) => Math.round(Number((eur * 100).toPrecision(12))) / 100;
/** Dollars less a tax they hold that Italy does not pay, to the cent as the hand-off shows dollars (io.ts usd(),
 * toFixed), so the euros are the dollars it shows, converted. */
export const untaxed = (usd: number, usTax = 1) => Number((usd / usTax).toFixed(2));
/** Dollars in euros at `fx`, to the cent, less a tax the dollars hold that Italy does not pay: the dollars as shown,
 * converted, so a "$10.01, or €8.97" pair is the rate's. */
export const toEur = (usd: number, fx: Fx, usTax = 1) => cents(untaxed(usd, usTax) / fx.usdPerEur);

/** How a print service's price lands in Italy. */
export type ItalyRule = {
  /** Where its parcel comes from: either side of the EU's border (its partner decides), or outside the EU. */
  from: "either" | "outside";
  /** A tax Sprue's rate holds that an order to Italy does not pay: the parts' figure is divided by it. */
  usTax?: number;
  /** Where its terms put VAT (where it applies) and regular shipping in its price; undefined when they don't, and its
   * checkout adds VAT (IOSS) on a parcel up to €150. */
  allIn?: string;
  /** It ships DDP (the shop collects the import charges at its checkout) where you choose it. */
  ddp?: boolean;
};

/** The rule of each print service rates.json prices, by its name in quotes.json. */
export const ITALY: Record<string, ItalyRule> = {
  // Its terms (8.1.2) put VAT where it applies, packaging and regular shipping in the price, and customs, duties and
  // import taxes outside it (8.2). Its partners are in Europe, North America and Asia.
  Craftcloud: { from: "either", allIn: "its terms, 8.1.2" },
  // rates.json's JLC3DP rate is $0.275/g x 1.01 g/cm3 x 1.40: the 40% advance tax JLC3DP collects on orders to the US
  // only. Its EU notice: its IOSS collects the VAT, not the €3, paid on import or, with DDP, at its checkout.
  JLC3DP: { from: "outside", usTax: 1.4, ddp: true },
};

/** Whether a line's price holds VAT: a shop's quote's `vat`, as catalog.json records it. */
export type VatHeld = ShopQuote["vat"];
/** The seller's country and its standard VAT rate, for a parcel from inside the EU. */
export type Seller = { country: string; vat: number };
/** How a cart with a line priced from a shop's quote lands in Italy. */
export type QuotedRule = {
  /** Where its parcel comes from: handoff.ts's SHOPS `from` (eu, china, world) as inside the EU, outside it, or either
   * side (a partner Sprue does not record). */
  from: "eu" | "outside" | "either";
  /** Who sells to you from inside the EU, and its country's standard VAT rate. */
  seller?: Seller;
  /** It ships DDP where you choose it: the shop collects the import charges at its checkout. */
  ddp?: boolean;
};

/** The rule of each shop handoff.ts lists (SHOPS), by its name in quotes.json, for a cart with a line priced from its
 * quote. A seller's rate is its country's standard one, as Your Europe's table gives it. */
export const QUOTED: Record<string, QuotedRule> = {
  Weerg: { from: "eu", seller: { country: "Italy", vat: 0.22 } },
  Laserbend3D: { from: "eu", seller: { country: "Italy", vat: 0.22 } },
  Laserboost: { from: "eu", seller: { country: "Spain", vat: 0.21 } },
  "Xometry Europe": { from: "eu", seller: { country: "Germany", vat: 0.19 } },
  // All3DP GmbH, in Munich, is the seller: its terms (4.4) make one contract with you and another with the partner.
  Craftcloud: { from: "either", seller: { country: "Germany", vat: 0.19 } },
  // Their EU customs pages (S12, S11): with DDP the shop collects the VAT, the €3 duty and the courier's fee at checkout.
  JLCCNC: { from: "outside", ddp: true },
  JLC3DP: { from: "outside", ddp: true },
};

/** One parcel: what the quote buys from one shop for the parts `ids`, in one order (A or B when the quote splits it),
 * line by line (`lines`; without it, `partsUsd` as one), its shipping as the quote counts it (none when it counts
 * none), and the lines that ride in it (catalog.json shipsWith), by their shops: bought ones, and made parts whose
 * shop rides with this one, as the line of a cart of their own has them. A line priced from a shop's quote
 * (catalog.json shopQuote) is `quoted`, and one quoted in euros carries the shop's own total as `eur`. A cart whose
 * own shop rides in a fab's parcel names the fab whose parcel it is, `ridesWith` (past a fab that rides in another's
 * itself): its parts are in that parcel, not one of their own. */
export type Cart = { shop: string; order?: string; ids: string[]; partsUsd: number; lines?: CartLine[];
  shipUsd?: number; shipBasis?: string; riders: Rider[]; ridesWith?: string };
/** A line riding in a cart's parcel; a made part's, less a tax its rate holds that Italy does not pay (`usTax`). */
export type Rider = { id: string; supplier: string; usd: number; usTax?: number } & Pick<CartLine, "quoted" | "eur" | "usdPerEur" | "vat">;
/** A line of a cart; one priced from a shop's quote is `quoted`, with the VAT its quote's totals hold (`vat`). */
export type CartLine = { id: string; usd: number; quoted?: boolean; eur?: number; usdPerEur?: number; vat?: VatHeld };

/** The carts of the parts `ids` (the made parts handed off to a shop, not printed at home, that the quote prices), as
 * the quote buys them: one a shop, or with the quote split in two, one a shop and an order. `made` is every made part
 * handed off to a shop: one not in `ids` rides in no cart either. */
export function cartsOf(q: Quotes | undefined, ids: Set<string>, made: Set<string> = ids): Cart[] {
  if (!q) return [];
  const groups = q.phases?.length ? q.phases.map((p) => ({ order: p.name as string | undefined, lines: p.lines }))
    : [{ order: undefined, lines: q.lines }];
  const out: Cart[] = [];
  for (const g of groups) {
    const own = g.lines.filter((x) => ids.has(x.lineId) && x.orderQty > 0);
    // The parcel each shop's lines go in: a shop riding with a fab (any of its lines says so) goes where the fab's
    // parcel goes, to the first that rides with none; one round a loop (which catalog.json's checks refuse) in its own.
    const fabOf = new Map(g.lines.filter((x) => x.shipsWith && x.shipsWith !== x.supplier).map((x) => [x.supplier, x.shipsWith!] as const));
    const parcelOf = (shop: string) => {
      const seen = [shop];
      for (let at = fabOf.get(shop); at; at = fabOf.get(at)) {
        if (seen.includes(at)) return shop;
        seen.push(at);
      }
      return seen[seen.length - 1];
    };
    for (const shop of new Set(own.map((x) => x.supplier))) {
      const mine = own.filter((x) => x.supplier === shop), ship = g.lines.find((x) => x.lineId === `ship:${shop}`);
      const riders = g.lines.filter((x) => x.supplier !== shop && parcelOf(x.supplier) === shop && !x.lineId.startsWith("ship:") && x.orderQty > 0
        && (ids.has(x.lineId) || !made.has(x.lineId)))
        .map((x): Rider => ({ id: x.lineId, supplier: x.supplier, usd: x.orderUsd,
          ...(ids.has(x.lineId) ? { ...quotedOf(x), ...(!x.shopQuote && ITALY[x.supplier]?.usTax ? { usTax: ITALY[x.supplier].usTax } : {}) } : {}) }));
      out.push({ shop, order: g.order, ids: [...new Set(mine.map((x) => x.lineId))], partsUsd: mine.reduce((s, x) => s + x.orderUsd, 0),
        lines: mine.map((x) => ({ id: x.lineId, usd: x.orderUsd, ...quotedOf(x) })), shipUsd: ship?.orderUsd, shipBasis: ship?.basis, riders,
        ...(parcelOf(shop) !== shop ? { ridesWith: parcelOf(shop) } : {}) });
    }
  }
  return out;
}

/** A line priced from a shop's quote, as a cart line has it: quoted, with the VAT its totals hold, and in euros the
 * shop's own total when it quoted in euros, which Sprue's dollars are at the rate recorded with the quote, so they are
 * not converted back. A quote with no `vat` (one quotes.json held before the field) does not say. */
function quotedOf(x: QuoteLine): Pick<CartLine, "quoted" | "eur" | "usdPerEur" | "vat"> {
  const q = x.shopQuote;
  if (!q) return {};
  const vat: VatHeld = q.vat === "excluded" || q.vat === "included" ? q.vat : "not stated";
  return q.currency === "EUR" && typeof q.total === "number" && typeof q.usdPerEur === "number" ? { quoted: true, eur: q.total, usdPerEur: q.usdPerEur, vat } : { quoted: true, vat };
}

/** A cart line in euros: a shop's euro total as it gave it, else its dollars converted, less a tax a print service's
 * rate holds that Italy does not pay (`usTax`, which a shop's quote does not hold). */
export const lineEur = (x: CartLine, fx: Fx, usTax?: number) => x.eur ?? toEur(x.usd, fx, x.quoted ? 1 : usTax);

/** A cart in euros, landed in Italy, each figure to the cent. Each range is [low, high]. */
export type Landed = {
  cart: Cart;
  /** Its shop's rule; undefined for a shop Sprue has none for, and for a cart with a line priced from a shop's quote,
   * which lands by `landing` instead: the rules describe print services' rates, not what a shop quoted. */
  rule?: ItalyRule;
  /** A line in it is priced from a shop's quote. */
  quoted: boolean;
  /** A cart with a line priced from a shop's quote: its shop's rule (QUOTED); undefined for a shop Sprue has none for. */
  landing?: QuotedRule;
  /** A cart with a line priced from a shop's quote: whether each line's price holds VAT, once each (a line at a print
   * service's rate as its rule has it: JLC3DP's leaves it out, Craftcloud's Sprue did not confirm). */
  held?: VatHeld[];
  /** Sprue's figure for the parts in euros, less a tax its rate holds that Italy does not pay, a shop's euro total as
   * it gave it: the sum of each line's. */
  parts: number;
  /** The quote's shipping in euros; undefined where it counts none. */
  ship?: number;
  /** The rate the shipping is in euros at when it is not fx.json's: that of the shop's quotes in euros, every line of
   * the cart one, all at one rate, whose shipping catalog.json holds in dollars at that rate (ORDER.md, step 4). */
  shipRate?: number;
  /** The lines riding in the parcel, in euros. */
  riders: number;
  /** What the parcel is worth for the €150 line: the parts and the riders, without shipping or VAT. A total whose
   * quote says it holds VAT counts without it; one whose quote does not say counts as it is. */
  value: number;
  /** The parcel's worth counting a total whose quote does not say whether it holds VAT as holding it; only where it
   * differs from `value`. */
  valueLow?: number;
  /** Worth up to €150 (at `valueLow`, where there is one), so the €3 duty and IOSS apply. */
  small: boolean;
  /** Within NEAR_EUR of €150, or on either side of it at its two readings, so it may fall on either side. */
  near: boolean;
  /** How many items the duty and the fee count: 1 if its parts go on one line of the declaration (with riders, 2: one
   * of the made parts and one of what rides with them), up to one a line. */
  items: [number, number];
  /** From inside the EU (a partner, or the shop itself), which clears no customs. */
  eu?: [number, number];
  /** From outside the EU, on a parcel up to €150: before shipping where Sprue has no price for it, and before the
   * courier's own fee. */
  outside?: [number, number];
};

/** What a line counts toward €150, without VAT, at a low and a high reading: a total whose quote says it holds VAT
 * (Italy's 22%, as a seller outside the EU charges it) without it, one whose quote does not say either way, one that
 * leaves VAT out (or is not from a quote) as it is. */
const worth = (eur: number, held?: VatHeld): [number, number] =>
  held === "included" ? [eur / (1 + VAT_IT), eur / (1 + VAT_IT)] : held === "not stated" ? [eur / (1 + VAT_IT), eur] : [eur, eur];

export function landed(c: Cart, fx: Fx): Landed {
  const quoted = !!c.lines?.some((x) => x.quoted), rule = quoted ? undefined : ITALY[c.shop], sum = (xs: number[]) => cents(xs.reduce((t, x) => t + x, 0));
  const ownLines = c.lines ?? [{ id: "", usd: c.partsUsd }];
  const eurs = ownLines.map((x) => lineEur(x, fx, ITALY[c.shop]?.usTax)), parts = sum(eurs);
  const rates = new Set((c.lines ?? []).map((x) => x.usdPerEur)), shipRate = c.lines?.length && rates.size === 1 ? [...rates][0] : undefined;
  const ship = c.shipUsd === undefined ? undefined : shipRate ? cents(c.shipUsd / shipRate) : toEur(c.shipUsd, fx);
  const riderEurs = c.riders.map((x) => lineEur(x, fx, x.usTax)), riders = sum(riderEurs);
  // Each line's VAT, where the cart has a line from a shop's quote: a print rate's as its rule has it. From either side
  // of the EU's border (a Craftcloud partner Sprue does not record), a quote's word on VAT was read for one partner, so
  // toward €150 it counts as not saying.
  const landing = quoted ? QUOTED[c.shop] : undefined;
  const heldOf = (x: CartLine): VatHeld => x.quoted ? x.vat ?? "not stated" : ITALY[c.shop] && !ITALY[c.shop].allIn ? "excluded" : "not stated";
  const helds = quoted ? ownLines.map(heldOf) : [];
  const forValue = (h: VatHeld | undefined) => landing?.from === "either" && h === "included" ? "not stated" : h;
  const reads = [...eurs.map((e, i) => worth(e, quoted ? forValue(helds[i]) : undefined)), ...riderEurs.map((e, i) => worth(e, forValue(c.riders[i].vat)))];
  const value = sum(reads.map((r) => r[1])), valueLow = sum(reads.map((r) => r[0]));
  const lines = new Set([...c.ids, ...c.riders.map((x) => x.id)]).size, low = c.riders.length ? 2 : 1;
  const base: Landed = { cart: c, rule, quoted, ...(landing ? { landing } : {}), ...(quoted ? { held: [...new Set(helds)] } : {}), parts, ship, ...(shipRate ? { shipRate } : {}), riders,
    value, ...(valueLow < value ? { valueLow } : {}), small: valueLow <= LOW_VALUE_EUR,
    near: [valueLow, value].some((v) => Math.abs(v - LOW_VALUE_EUR) <= NEAR_EUR) || (valueLow <= LOW_VALUE_EUR && value > LOW_VALUE_EUR),
    items: [Math.min(low, lines), Math.max(1, lines)] };
  // A cart that rides in another's parcel has no landing of its own: that parcel's is its.
  if (c.ridesWith) return base;
  if (landing) return landQuoted(base, landing, eurs, helds);
  if (!rule) return base;
  const s = ship ?? 0, [k, n] = base.items;
  if (rule.allIn) {
    // Low: Sprue's rate already holds the shipping and the VAT, as the shop's price does, the checkout collects the
    // VAT on a parcel from outside (IOSS), the parcel is declared on as few lines as it can be, and the fee is paid at
    // clearance, with no VAT. High: the rate holds neither, the parcel is declared a line a part, and the courier
    // collects VAT on the parts, shipping and duty, and on the fee.
    if (rule.from === "either") base.eu = [parts, cents(vat(parts + s))];
    if (base.small) base.outside = [cents(parts + (DUTY_EUR + FEE_EUR) * k), cents(vat(parts + s + DUTY_EUR * n) + vat(FEE_EUR) * n)];
  } else {
    // VAT at the shop's checkout (IOSS) on the parts and shipping, then the duty and the fee on top: the fee with no
    // VAT where you pay it at clearance, with VAT where the seller charges it at checkout.
    const withVat = cents(vat(parts + s));
    if (rule.from === "either") base.eu = [withVat, withVat];
    if (base.small) base.outside = [cents(withVat + (DUTY_EUR + FEE_EUR) * k), cents(withVat + (vat(DUTY_EUR) + vat(FEE_EUR)) * n)];
  }
  return base;
}

/** A cart with a line priced from a shop's quote, landed by its shop's rule: `eurs` are its lines in euros (a print
 * rate's without the US tax it holds) and `helds` whether each price holds VAT. Its shipping, the figure catalog.json
 * records, may hold VAT or not: the low figure counts it as it is, the high one adds 22%.
 *   From inside the EU, no customs. A price that leaves VAT out takes the seller's own rate (low) up to Italy's (high);
 *   one that holds it is as it is (low) up to Italy's rate in place of the seller's (high); one whose quote does not
 *   say is as it is (low) up to with Italy's rate (high). A seller in Italy charges 22% either way.
 *   From outside the EU, on a parcel up to €150: low, VAT collected at checkout (IOSS) on a price that leaves it out
 *   (one that holds it, or does not say, as it is), the €3 duty and the €2 fee without VAT, for the fewest items; high,
 *   22% VAT on every price that does not hold it, on the shipping and on the duty and the fee, as when the seller
 *   charges them at checkout (DDP) or the courier collects the import VAT, an item a line. A quote's word on VAT from
 *   a shop on either side of the border was read for one partner, so from outside it counts as not saying. */
function landQuoted(base: Landed, landing: QuotedRule, eurs: number[], helds: VatHeld[]): Landed {
  const s = base.ship ?? 0, [k, n] = base.items, it = 1 + VAT_IT, home = 1 + (landing.seller?.vat ?? VAT_IT);
  const sum = (f: (e: number, h: VatHeld) => number) => eurs.reduce((t, e, i) => t + f(e, helds[i]), 0);
  if (landing.from !== "outside")
    base.eu = [cents(sum((e, h) => (h === "excluded" ? e * home : e)) + s), cents(sum((e, h) => (h === "included" ? (e * it) / home : e * it)) + s * it)];
  if (landing.from !== "eu" && base.small) {
    const h = (x: VatHeld): VatHeld => (landing.from === "either" ? "not stated" : x);
    base.outside = [cents(sum((e, x) => (h(x) === "excluded" ? e * it : e)) + s + (DUTY_EUR + FEE_EUR) * k),
      cents(sum((e, x) => (h(x) === "included" ? e : e * it)) + s * it + (DUTY_EUR + FEE_EUR) * it * n)];
  }
  return base;
}
