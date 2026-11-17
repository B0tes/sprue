// What catalog.json (and offers.digikey.json) must hold for the quote to add it up: every price, quantity and
// shipping charge a number, every field one the quote reads. A misspelt field is read as nothing, so a price break
// written { qty: 1, unitPrice: 2 } gave the CO2 run a $NaN total with exit 0. `sprue validate` prints these, and
// loadCatalog (explore.ts) refuses a file that has any, so no command prices from it.

import { quotedPart } from "./adapters/fab.ts";
import { isDay } from "./io.ts";
import type { Bom } from "./types.ts";

const OFFER = ["supplier", "sku", "mpn", "url", "packSize", "priceBreaks", "stock", "leadDays", "source", "capturedAt", "note", "shopQuote"];
/** A shop's quote for a made part (types.ts ShopQuote), as the part's ORDER.md gives it. */
const SHOP_QUOTE = ["part", "sha256", "spec", "currency", "usdPerEur", "vat", "expires"];
const VAT = ["excluded", "included", "not stated"];
const SOURCES = ["api", "snapshot", "formula", "estimate"];
const FILAMENT = ["usdPerKg", "gPerCm3", "url", "capturedAt", "densityUrl", "leadDays"];
const TOP: Record<string, string[]> = {
  "catalog.json": ["shipping", "shippingFirstArticle", "shippingRead", "shippingBasis", "shipsWith", "filament", "offers"],
  "offers.digikey.json": ["fetchedAt", "offers"],
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const say = (x: unknown) => (x === undefined ? "nothing" : JSON.stringify(x));
const num = (x: unknown, min = 0) => typeof x === "number" && Number.isFinite(x) && x >= min;
const whole = (x: unknown, min: number) => num(x, min) && Number.isInteger(x);

/** The fields of `o` none of `known` names; a key starting with _ is a comment. */
function unknown(o: Obj, known: string[]): string[] {
  return Object.keys(o).filter((k) => !k.startsWith("_") && !known.includes(k));
}

/** The words for fields nothing reads, with the ones that are read. */
const strays = (keys: string[], known: string[]) =>
  `${keys.length === 1 ? "a field" : "fields"} nothing reads (${keys.map((k) => `"${k}"`).join(", ")}; the fields are ${known.join(", ")})`;

/** A figure as the shortest decimal that is it to 6 places: 12.83975, 33.495, 12.195. */
const decimal = (x: number) => String(Number(x.toFixed(6)));
/** A sum of money to the cent, a half cent up, though in binary floats 1060.675 is 1060.67499...: as landed.ts cents(). */
const cents = (x: number) => (Math.round(Number((x * 100).toPrecision(12))) / 100).toFixed(2);
/** A price a piece as written, to the cent at least: 33.495, 12.83975, 10.10. */
const piece = (x: number) => (/\.\d\d/.test(decimal(x)) ? decimal(x) : x.toFixed(2));

/** Each problem with a shop's quote for a made part: its shopQuote, and each price break's shopTotal, which its unitUsd
 * must be worked out from (to half a cent a piece, so a unit price rounded to the cent passes). */
function shopQuoteProblems(at: string, o: Obj): string[] {
  const out: string[] = [], q = o.shopQuote;
  if (!isObj(q)) return [`${at}: shopQuote must be { ${SHOP_QUOTE.join(", ")} }, as the part's ORDER.md gives it, not ${say(q)}`];
  const x = unknown(q, SHOP_QUOTE);
  if (x.length) out.push(`${at}: shopQuote has ${strays(x, SHOP_QUOTE)}`);
  if (typeof q.part !== "string" || !/^fab\/[^/\\]+\.stl$/.test(q.part))
    out.push(`${at}: shopQuote.part must be the part's STL in fab/ (fab/<part>.stl), as its ORDER.md gives it, not ${say(q.part)}`);
  if (typeof q.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(q.sha256))
    out.push(`${at}: shopQuote.sha256 must be the 64 hex digits its ORDER.md gives for the part's STL, not ${say(q.sha256)}`);
  if (!isObj(q.spec)) out.push(`${at}: shopQuote.spec must be bom.json's spec for the line as the shop priced it (an object, as its ORDER.md gives it), not ${say(q.spec)}`);
  const eur = q.currency === "EUR", rateOk = num(q.usdPerEur) && (q.usdPerEur as number) >= 0.5 && (q.usdPerEur as number) <= 2;
  if (!eur && q.currency !== "USD") out.push(`${at}: shopQuote.currency must be "EUR" or "USD", the currency of the shop's totals, not ${say(q.currency)}`);
  if (eur && !rateOk)
    out.push(`${at}: a quote in euros needs shopQuote.usdPerEur, the dollars to the euro its unitUsd are worked out at (its ORDER.md gives pipeline/fx.json's), between 0.5 and 2, not ${say(q.usdPerEur)}`);
  if (q.currency === "USD" && q.usdPerEur !== undefined) out.push(`${at}: a quote in dollars takes no shopQuote.usdPerEur: drop it`);
  if (!VAT.includes(q.vat as string)) out.push(`${at}: shopQuote.vat must be "excluded", "included" or "not stated", as the shop's quote shows its totals, not ${say(q.vat)}`);
  // The day it was read and the last day it holds, so the hand-off can say when it runs out. A capturedAt that is not
  // text is said once, with every offer's.
  const read = o.capturedAt;
  if (typeof read === "string" && read && !isDay(read))
    out.push(`${at}: a shop's quote's capturedAt must be the day you read it (YYYY-MM-DD), not ${say(read)}`);
  if (q.expires !== "not stated" && !isDay(q.expires))
    out.push(`${at}: shopQuote.expires must be the last day the shop's quote holds, as its page says (YYYY-MM-DD), or "not stated", not ${say(q.expires)}`);
  else if (isDay(q.expires) && isDay(read) && q.expires < read)
    out.push(`${at}: shopQuote.expires, ${q.expires}, is before capturedAt, ${read}, the day the quote was read: write the last day the shop's quote says it holds`);
  if (o.source !== "snapshot" && o.source !== "estimate")
    out.push(`${at}: a shop's quote is read by a person, so its source is "snapshot" (the price the shop gave for this file) or "estimate" (one it calls a reference), not ${say(o.source)}`);
  if (o.packSize !== undefined) out.push(`${at}: a shop's quote prices the pieces it was asked for, so it takes no packSize: drop it`);
  if (!Array.isArray(o.priceBreaks)) return out;
  const rate = eur ? (rateOk ? (q.usdPerEur as number) : undefined) : q.currency === "USD" ? 1 : undefined;
  const seen = new Set<unknown>();
  o.priceBreaks.forEach((b, j) => {
    if (!isObj(b)) return;
    if (whole(b.qty, 1) && seen.has(b.qty)) out.push(`${at}: priceBreaks give two prices for ${b.qty}: keep the one the shop's quote shows`);
    seen.add(b.qty);
    const count = whole(b.qty, 1) ? `${b.qty} ${b.qty === 1 ? "piece" : "pieces"}` : "its qty";
    // A shop's total for made pieces is never 0: a 0 is a placeholder, and would price the part free.
    if (!num(b.shopTotal) || b.shopTotal === 0)
      return void out.push(`${at}: priceBreaks[${j}].shopTotal must be the shop's total for ${count}, over 0, before shipping, as its page showed it, not ${say(b.shopTotal)}: leave the offer out until the shop has quoted`);
    if (rate === undefined || !whole(b.qty, 1) || !num(b.unitUsd)) return;
    const qty = b.qty as number, total = b.shopTotal as number, unit = b.unitUsd as number, want = (total * rate) / qty;
    // Half a cent a piece, and a little for binary floats: €90 for 3 at 1.1165 is 33.495 a piece, and 33.50 passes.
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 + 1e-9;
    if (near(unit, want)) return;
    const cur = (x: number) => `${eur ? "€" : "$"}${cents(x)}`;
    // One sum written twice, as shopTotal and as the price a piece: either shopTotal is the shop's price a piece (and
    // writing the unitUsd asked would price the order a qty-th of what it costs), or unitUsd is the whole order. Only
    // the shop's quote tells which.
    if (qty > 1 && near(unit, total * rate))
      return void out.push(`${at}: priceBreaks[${j}] gives one sum twice, ${cur(total)} as shopTotal and $${piece(unit)} as the price a piece: look at the shop's quote. If ${cur(total)} is its total for ${qty}, unitUsd was written as the whole order in dollars: write "unitUsd": ${decimal(want)}; if ${cur(total)} is its price a piece, shopTotal must be its total for ${qty}, before shipping: write "shopTotal": ${cents(total * qty)}`);
    const shop = eur ? `the shop's €${cents(total)} for ${qty} at $${q.usdPerEur} a euro (shopQuote.usdPerEur) is $${cents(total * rate)}`
      : `the shop's $${cents(total)} for ${qty} is $${decimal(want)} a piece`;
    // The total that unit price comes from, to the cent of the shop's currency: at 1.1165 a euro and 1 piece, no euro
    // total is within half a cent of some dollar prices ($10.01), so that clause would name a figure this refuses.
    // And never a total of 0, which this refuses too.
    const fits = cents((unit * qty) / rate), other = Number(fits) > 0 && near(unit, (Number(fits) * rate) / qty)
      ? `; if $${piece(unit)} a piece is right, the shop's total for ${qty} is ${cur((unit * qty) / rate)}: write "shopTotal": ${fits}`
      : `; no total in ${eur ? "euros" : "dollars"}${Number(fits) > 0 ? "" : " over 0"} comes to $${piece(unit)} a piece, so the unitUsd is the one to change`;
    out.push(`${at}: priceBreaks[${j}] is ${qty} at $${piece(unit)} a piece, $${cents(unit * qty)}, but ${shop}. If ${cur(total)} is the shop's total for ${qty}, write "unitUsd": ${decimal(want)}${other}`);
  });
  return out;
}

/** Each problem in a catalog file as one line ("offers.co2[1] (BerryBase ADA5190): priceBreaks[0].unitUsd is
 * nothing"), and `notes` for what is wrong but changes no price (offers for a line bom.json has no line for). */
export function catalogProblems(raw: unknown, file = "catalog.json", bom?: Bom): { problems: string[]; notes: string[] } {
  const problems: string[] = [], notes: string[] = [];
  if (!isObj(raw)) return { problems: ["the file is not a JSON object"], notes };
  const top = TOP[file] ?? TOP["catalog.json"];
  const extra = unknown(raw, top);
  if (extra.length) problems.push(`its top level has ${strays(extra, top)}`);
  const amounts = (key: string) => {
    if (raw[key] === undefined) return;
    if (!isObj(raw[key])) return void problems.push(`${key} must map each shop to a number of USD, not ${say(raw[key])}`);
    for (const [shop, usd] of Object.entries(raw[key] as Obj))
      if (!shop.startsWith("_") && !num(usd)) problems.push(`${key}.${shop} must be a number of USD, 0 or more, not ${say(usd)}`);
  };
  amounts("shipping");
  amounts("shippingFirstArticle");
  if (raw.shippingRead !== undefined && !(Array.isArray(raw.shippingRead) && raw.shippingRead.every((s) => typeof s === "string")))
    problems.push(`shippingRead must be a list of shop names, not ${say(raw.shippingRead)}`);
  for (const key of ["shippingBasis", "shipsWith"]) {
    if (raw[key] === undefined) continue;
    if (!isObj(raw[key]) || Object.entries(raw[key] as Obj).some(([k, v]) => !k.startsWith("_") && typeof v !== "string"))
      problems.push(`${key} must map each shop to ${key === "shipsWith" ? "the fab whose parcel carries it" : "a sentence"}, not ${say(raw[key])}`);
  }
  // A parcel is carried by a fab that rides in none: a shop riding with itself, or round a loop, has no parcel.
  if (isObj(raw.shipsWith)) {
    const to = raw.shipsWith as Record<string, unknown>, said = new Set<string>();
    for (const shop of Object.keys(to).filter((k) => !k.startsWith("_"))) {
      const path = [shop];
      for (let at = to[shop]; typeof at === "string"; at = Object.hasOwn(to, at) ? to[at] : undefined) {
        if (path.includes(at)) {
          const loop = path.slice(path.indexOf(at)), key = [...loop].sort().join("\0");
          if (!said.has(key)) problems.push(loop.length === 1 ? `shipsWith.${loop[0]} rides with itself: name the fab whose parcel carries it, or leave it out`
            : `shipsWith goes round a loop (${[...loop, at].join(" rides with ")}): one of them must carry the parcel, riding in no other's`);
          said.add(key);
          break;
        }
        path.push(at);
      }
    }
  }
  if (raw.filament !== undefined) {
    if (!isObj(raw.filament)) problems.push(`filament must map each material to its price and density, not ${say(raw.filament)}`);
    else for (const [material, f] of Object.entries(raw.filament)) {
      if (material.startsWith("_")) continue;
      const at = `filament.${material}`;
      if (!isObj(f)) { problems.push(`${at} must be { usdPerKg, gPerCm3, url, capturedAt }, not ${say(f)}`); continue; }
      const x = unknown(f, FILAMENT);
      if (x.length) problems.push(`${at} has ${strays(x, FILAMENT)}`);
      for (const k of ["usdPerKg", "gPerCm3"]) if (!num(f[k]) || f[k] === 0) problems.push(`${at}.${k} must be a number over 0, not ${say(f[k])}`);
      if (f.leadDays !== undefined && !num(f.leadDays)) problems.push(`${at}.leadDays must be a number of days, not ${say(f.leadDays)}`);
      for (const k of ["url", "capturedAt"]) if (typeof f[k] !== "string" || !f[k]) problems.push(`${at}.${k} must be text, not ${say(f[k])}`);
    }
  }
  if (!isObj(raw.offers)) {
    if (raw.offers !== undefined || file !== "catalog.json") problems.push(`offers must map each BOM line's id (a bought line, or a part made from a shop's quote) to a list of offers, not ${say(raw.offers)}`);
    return { problems, notes };
  }
  for (const [line, offers] of Object.entries(raw.offers)) {
    if (line.startsWith("_")) continue;
    if (!Array.isArray(offers)) { problems.push(`offers.${line} must be a list of offers, not ${say(offers)}`); continue; }
    const l = bom?.lines.find((x) => x.id === line);
    const quoted = !!l && quotedPart(l);
    if (bom && !l) notes.push(`${file}: offers for "${line}", which bom.json has no line for, so nothing reads them`);
    else if (l && l.process !== "buy" && !quoted) notes.push(`${file}: offers for ${line}, which is made (${l.process}), not bought, so nothing reads them`);
    offers.forEach((o, i) => {
      const at = `offers.${line}[${i}]` + (isObj(o) && typeof o.supplier === "string" ? ` (${o.supplier}${typeof o.sku === "string" && o.sku ? ` ${o.sku}` : ""})` : "");
      if (!isObj(o)) return void problems.push(`${at} must be an offer object, not ${say(o)}`);
      const shopQuote = o.shopQuote !== undefined;
      if (quoted && !shopQuote)
        notes.push(`${file}: ${at} has no shopQuote, so the quote prices nothing from it: ${line} is made (${l!.process}), and Sprue prices it only from a shop's quote recorded as fab/order/${line}/ORDER.md shows`);
      if (l?.process === "buy" && shopQuote)
        notes.push(`${file}: ${at} has a shopQuote, which only a CNC, sheet-metal or metal-printed part's quote carries, and ${line} is bought: the quote reads it as a plain offer, held to no file`);
      if (shopQuote) problems.push(...shopQuoteProblems(at, o));
      const x = unknown(o, OFFER);
      if (x.length) problems.push(`${at} has ${strays(x, OFFER)}`);
      for (const k of ["supplier", "url", "capturedAt"]) if (typeof o[k] !== "string" || !o[k]) problems.push(`${at}: ${k} must be text, not ${say(o[k])}`);
      if (typeof o.sku !== "string") problems.push(`${at}: sku must be text (the shop's order code, or the product's name), not ${say(o.sku)}`);
      if (o.mpn !== undefined && typeof o.mpn !== "string") problems.push(`${at}: mpn must be text, not ${say(o.mpn)}`);
      if (o.note !== undefined && typeof o.note !== "string") problems.push(`${at}: note must be text, not ${say(o.note)}`);
      if (!shopQuote && o.packSize !== undefined && !whole(o.packSize, 1)) problems.push(`${at}: packSize must be a whole number of pieces, 1 or more, not ${say(o.packSize)}`);
      if (!num(o.leadDays)) problems.push(`${at}: leadDays must be a number of days, not ${say(o.leadDays)}`);
      if (!shopQuote && !SOURCES.includes(o.source as string)) problems.push(`${at}: source must be one of ${SOURCES.join(", ")}, not ${say(o.source)}`);
      if (!(whole(o.stock, 0) || o.stock === "in stock" || o.stock === "unknown"))
        problems.push(`${at}: stock must be a whole number of pieces, "in stock" or "unknown", not ${say(o.stock)}`);
      const breakKeys = shopQuote ? ["qty", "unitUsd", "shopTotal"] : ["qty", "unitUsd"];
      if (!Array.isArray(o.priceBreaks) || !o.priceBreaks.length) return void problems.push(`${at}: priceBreaks must list at least one { ${breakKeys.join(", ")} }, not ${say(o.priceBreaks)}`);
      o.priceBreaks.forEach((b, j) => {
        const pb = `${at}: priceBreaks[${j}]`;
        if (!isObj(b)) return void problems.push(`${pb} must be { ${breakKeys.join(", ")} }, not ${say(b)}`);
        if (!shopQuote && b.shopTotal !== undefined)
          problems.push(`${pb} has shopTotal, which only a shop's quote for a made part (an offer with its "shopQuote") reads: drop it, or add the shopQuote`);
        const y = unknown(b, breakKeys).filter((k) => k !== "shopTotal");
        if (y.length) problems.push(`${pb} has ${strays(y, breakKeys)}`);
        if (!whole(b.qty, 1)) problems.push(`${pb}.qty must be a whole number of pieces, 1 or more, not ${say(b.qty)}`);
        if (!num(b.unitUsd)) problems.push(`${pb}.unitUsd must be a number of USD per piece, 0 or more, not ${say(b.unitUsd)}`);
      });
    });
  }
  return { problems, notes };
}

/** One line for an error that stops a command reading the file: the first problem, and how many more. */
export const catalogError = (file: string, problems: string[]) =>
  `${file} can't be priced from: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more: run sprue validate)` : ""}`;
