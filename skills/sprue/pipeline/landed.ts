// Sprue's price of the made parts in euros, landed in Italy: the numbers behind the hand-off's "In Italy, in euros"
// (handoff.ts writes the words). The quote is in USD for request.json's region; a person in Italy pays in euros, and a
// parcel from outside the EU pays the EU's charges on the way in. Each was read by hand, on the page handoff.ts cites:
//   the rate      fx.json: the ECB's reference rate of a date, for information only (a shop and a card use their own)
//   VAT           22% in Italy, on a parcel of any value: collected at the checkout by a seller in IOSS (a parcel up to
//                 €150), else on import by the courier, who usually adds a clearance fee of its own
//   the €3 duty   on a parcel up to €150 sold to a consumer, 1 July 2026 to 1 July 2028, per item: each tariff
//                 sub-heading in the parcel is one item, however many pieces it holds
//   the €2 fee    the EU's handling fee, per item counted the same way, on a parcel of any value sold to a consumer,
//                 since 1 November 2026; the seller or the courier pays it and may pass it on, VAT on it in some cases
// Sprue can't tell how a parcel's parts are classed, so a cart of n parts counts 1 to n items, and each figure is a low
// and a high one. Nothing here fetches or reads the clock.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "./io.ts";
import type { Quotes } from "./types.ts";

/** US dollars to the euro, as fx.json gives it: the rate of `date`, from `url`, read on `read`. */
export type Fx = { usdPerEur: number; date: string; source: string; url: string; read: string };

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** pipeline/fx.json, or the file given; throws, saying what is wrong, on one Sprue can't use. */
export function loadFx(file = join(import.meta.dirname, "fx.json")): Fx {
  let fx: Partial<Fx>;
  try {
    fx = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`pipeline/fx.json can't be read (${errorText(e)})`);
  }
  const bad = !fx || typeof fx !== "object" ? "it is not an object"
    : typeof fx.usdPerEur !== "number" || !Number.isFinite(fx.usdPerEur) || fx.usdPerEur <= 0 ? "usdPerEur is not a number above 0"
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
const vat = (eur: number) => eur * (1 + VAT_IT);

/** How a print service's price lands in Italy. */
export type ItalyRule = {
  /** Where its parcel comes from: either side of the EU's border (its partner decides), or outside the EU. */
  from: "either" | "outside";
  /** A tax Sprue's rate holds that an order to Italy does not pay: the parts' figure is divided by it. */
  usTax?: number;
  /** Where its terms put VAT (where it applies) and regular shipping in its price; undefined when they don't. */
  allIn?: string;
  /** Its shipping in rates.json is a price; false where it is a placeholder. */
  shipPriced: boolean;
};

/** The rule of each print service rates.json prices, by its name in quotes.json. */
export const ITALY: Record<string, ItalyRule> = {
  // Its terms (8.1.2) put VAT where it applies, packaging and regular shipping in the price, and customs, duties and
  // import taxes outside it (8.2). Its partners are in Europe, North America and Asia.
  Craftcloud: { from: "either", allIn: "its terms, 8.1.2", shipPriced: true },
  // rates.json's JLC3DP rate is $0.275/g x 1.01 g/cm3 x 1.40: the 40% advance tax JLC3DP collects on orders to the US
  // only. Its shipping of $0 is a placeholder. Its EU notice: its IOSS collects the VAT, not the €3, paid on import.
  JLC3DP: { from: "outside", usTax: 1.4, shipPriced: false },
};

/** One parcel: what the quote buys from one shop for the parts `ids`, in one order (A or B when the quote splits it). */
export type Cart = { shop: string; order?: string; ids: string[]; partsUsd: number; shipUsd?: number };

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
      const mine = own.filter((x) => x.supplier === shop);
      out.push({ shop, order: g.order, ids: [...new Set(mine.map((x) => x.lineId))], partsUsd: mine.reduce((s, x) => s + x.orderUsd, 0),
        shipUsd: g.lines.find((x) => x.lineId === `ship:${shop}`)?.orderUsd });
    }
  }
  return out;
}

/** A cart in euros, landed in Italy. Each range is [low, high]. */
export type Landed = {
  cart: Cart;
  /** Its shop's rule; undefined for a shop Sprue has none for. */
  rule?: ItalyRule;
  /** Sprue's figure for the parts in euros, less a tax its rate holds that Italy does not pay: the parcel's worth. */
  parts: number;
  /** Sprue's shipping in euros; undefined where it has no price for it. */
  ship?: number;
  /** Worth up to €150, so the €3 duty and IOSS apply. */
  small: boolean;
  /** How many items the duty and the fee count: 1 if its parts share one tariff sub-heading, up to one a part. */
  items: [number, number];
  /** From a partner in the EU, which clears no customs. */
  eu?: [number, number];
  /** From outside the EU, on a parcel up to €150: before shipping where Sprue has no price for it, and before the
   * courier's own fee. */
  outside?: [number, number];
};

export function landed(c: Cart, fx: Fx): Landed {
  const rule = ITALY[c.shop], eur = (usd: number) => usd / fx.usdPerEur;
  const parts = eur(c.partsUsd / (rule?.usTax ?? 1));
  const ship = c.shipUsd !== undefined && (rule?.shipPriced ?? true) ? eur(c.shipUsd) : undefined;
  const n = Math.max(1, c.ids.length), base: Landed = { cart: c, rule, parts, ship, small: parts <= LOW_VALUE_EUR, items: [1, n] };
  if (!rule) return base;
  const s = ship ?? 0;
  if (rule.allIn) {
    // Low: Sprue's rate already holds the shipping and the VAT, as the shop's price does, and the checkout collects
    // the VAT on a parcel from outside. High: it holds neither, and the courier collects VAT on the parts, shipping
    // and duty, and on the fee.
    if (rule.from === "either") base.eu = [parts, vat(parts + s)];
    if (base.small) base.outside = [parts + DUTY_EUR + FEE_EUR, vat(parts + s + DUTY_EUR * n) + vat(FEE_EUR) * n];
  } else {
    // VAT at the shop's checkout (IOSS) on the parts and shipping, then the duty and the fee on top.
    if (rule.from === "either") base.eu = [vat(parts + s), vat(parts + s)];
    if (base.small) base.outside = [vat(parts + s) + DUTY_EUR + FEE_EUR, vat(parts + s) + DUTY_EUR * n + vat(FEE_EUR) * n];
  }
  return base;
}
