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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "./io.ts";
import type { Quotes } from "./types.ts";

/** US dollars to the euro, as fx.json gives it: the rate of `date`, from `url`, read on `read`. */
export type Fx = { usdPerEur: number; date: string; source: string; url: string; read: string };

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

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
/** Dollars in euros at `fx`, to the cent, less a tax the dollars hold that Italy does not pay. */
export const toEur = (usd: number, fx: Fx, usTax = 1) => cents(usd / usTax / fx.usdPerEur);

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

/** One parcel: what the quote buys from one shop for the parts `ids`, in one order (A or B when the quote splits it),
 * line by line (`lines`; without it, `partsUsd` as one), its shipping as the quote counts it (none when it counts
 * none), and the bought lines that ride in it (catalog.json shipsWith), by their shops. */
export type Cart = { shop: string; order?: string; ids: string[]; partsUsd: number; lines?: { id: string; usd: number }[];
  shipUsd?: number; shipBasis?: string; riders: { id: string; supplier: string; usd: number }[] };

/** The carts of the parts `ids` (the made parts handed off to a shop, not printed at home), as the quote buys them:
 * one a shop, or with the quote split in two, one a shop and an order. */
export function cartsOf(q: Quotes | undefined, ids: Set<string>): Cart[] {
  if (!q) return [];
  const groups = q.phases?.length ? q.phases.map((p) => ({ order: p.name as string | undefined, lines: p.lines }))
    : [{ order: undefined, lines: q.lines }];
  const out: Cart[] = [];
  for (const g of groups) {
    const own = g.lines.filter((x) => ids.has(x.lineId) && x.orderQty > 0);
    for (const shop of new Set(own.map((x) => x.supplier))) {
      const mine = own.filter((x) => x.supplier === shop), ship = g.lines.find((x) => x.lineId === `ship:${shop}`);
      const riders = g.lines.filter((x) => x.shipsWith === shop && !ids.has(x.lineId) && !x.lineId.startsWith("ship:") && x.orderQty > 0)
        .map((x) => ({ id: x.lineId, supplier: x.supplier, usd: x.orderUsd }));
      out.push({ shop, order: g.order, ids: [...new Set(mine.map((x) => x.lineId))], partsUsd: mine.reduce((s, x) => s + x.orderUsd, 0),
        lines: mine.map((x) => ({ id: x.lineId, usd: x.orderUsd })), shipUsd: ship?.orderUsd, shipBasis: ship?.basis, riders });
    }
  }
  return out;
}

/** A cart in euros, landed in Italy, each figure to the cent. Each range is [low, high]. */
export type Landed = {
  cart: Cart;
  /** Its shop's rule; undefined for a shop Sprue has none for. */
  rule?: ItalyRule;
  /** Sprue's figure for the parts in euros, less a tax its rate holds that Italy does not pay: the sum of each line's. */
  parts: number;
  /** The quote's shipping in euros; undefined where it counts none. */
  ship?: number;
  /** The bought lines riding in the parcel, in euros. */
  riders: number;
  /** What the parcel is worth for the €150 line: the parts and the riders, without shipping. */
  value: number;
  /** Worth up to €150, so the €3 duty and IOSS apply. */
  small: boolean;
  /** Within NEAR_EUR of €150, so it may fall on either side. */
  near: boolean;
  /** How many items the duty and the fee count: 1 if its parts go on one line of the declaration (with riders, 2: one
   * of the made parts and one of what rides with them), up to one a line. */
  items: [number, number];
  /** From a partner in the EU, which clears no customs. */
  eu?: [number, number];
  /** From outside the EU, on a parcel up to €150: before shipping where Sprue has no price for it, and before the
   * courier's own fee. */
  outside?: [number, number];
};

export function landed(c: Cart, fx: Fx): Landed {
  const rule = ITALY[c.shop], sum = (xs: number[]) => cents(xs.reduce((t, x) => t + x, 0));
  const parts = sum((c.lines ?? [{ id: "", usd: c.partsUsd }]).map((x) => toEur(x.usd, fx, rule?.usTax)));
  const ship = c.shipUsd !== undefined ? toEur(c.shipUsd, fx) : undefined;
  const riders = sum(c.riders.map((x) => toEur(x.usd, fx))), value = cents(parts + riders);
  const lines = new Set([...c.ids, ...c.riders.map((x) => x.id)]).size, low = c.riders.length ? 2 : 1;
  const base: Landed = { cart: c, rule, parts, ship, riders, value, small: value <= LOW_VALUE_EUR, near: Math.abs(value - LOW_VALUE_EUR) <= NEAR_EUR,
    items: [Math.min(low, lines), Math.max(1, lines)] };
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
    if (base.small) base.outside = [cents(withVat + (DUTY_EUR + FEE_EUR) * k), cents(withVat + DUTY_EUR * n + vat(FEE_EUR) * n)];
  }
  return base;
}
