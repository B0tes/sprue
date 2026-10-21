// What catalog.json (and offers.digikey.json) must hold for the quote to add it up: every price, quantity and
// shipping charge a number, every field one the quote reads. A misspelt field is read as nothing, so a price break
// written { qty: 1, unitPrice: 2 } gave the CO2 run a $NaN total with exit 0. `sprue validate` prints these, and
// loadCatalog (explore.ts) refuses a file that has any, so no command prices from it.

import type { Bom } from "./types.ts";

const OFFER = ["supplier", "sku", "mpn", "url", "packSize", "priceBreaks", "stock", "leadDays", "source", "capturedAt", "note"];
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
    if (raw.offers !== undefined || file !== "catalog.json") problems.push(`offers must map each bought BOM line's id to a list of offers, not ${say(raw.offers)}`);
    return { problems, notes };
  }
  for (const [line, offers] of Object.entries(raw.offers)) {
    if (line.startsWith("_")) continue;
    if (!Array.isArray(offers)) { problems.push(`offers.${line} must be a list of offers, not ${say(offers)}`); continue; }
    const l = bom?.lines.find((x) => x.id === line);
    if (bom && !l) notes.push(`${file}: offers for "${line}", which bom.json has no line for, so nothing reads them`);
    else if (l && l.process !== "buy") notes.push(`${file}: offers for ${line}, which is made (${l.process}), not bought, so nothing reads them`);
    offers.forEach((o, i) => {
      const at = `offers.${line}[${i}]` + (isObj(o) && typeof o.supplier === "string" ? ` (${o.supplier}${typeof o.sku === "string" && o.sku ? ` ${o.sku}` : ""})` : "");
      if (!isObj(o)) return void problems.push(`${at} must be an offer object, not ${say(o)}`);
      const x = unknown(o, OFFER);
      if (x.length) problems.push(`${at} has ${strays(x, OFFER)}`);
      for (const k of ["supplier", "url", "capturedAt"]) if (typeof o[k] !== "string" || !o[k]) problems.push(`${at}: ${k} must be text, not ${say(o[k])}`);
      if (typeof o.sku !== "string") problems.push(`${at}: sku must be text (the shop's order code, or the product's name), not ${say(o.sku)}`);
      if (o.mpn !== undefined && typeof o.mpn !== "string") problems.push(`${at}: mpn must be text, not ${say(o.mpn)}`);
      if (o.note !== undefined && typeof o.note !== "string") problems.push(`${at}: note must be text, not ${say(o.note)}`);
      if (o.packSize !== undefined && !whole(o.packSize, 1)) problems.push(`${at}: packSize must be a whole number of pieces, 1 or more, not ${say(o.packSize)}`);
      if (!num(o.leadDays)) problems.push(`${at}: leadDays must be a number of days, not ${say(o.leadDays)}`);
      if (!SOURCES.includes(o.source as string)) problems.push(`${at}: source must be one of ${SOURCES.join(", ")}, not ${say(o.source)}`);
      if (!(whole(o.stock, 0) || o.stock === "in stock" || o.stock === "unknown"))
        problems.push(`${at}: stock must be a whole number of pieces, "in stock" or "unknown", not ${say(o.stock)}`);
      if (!Array.isArray(o.priceBreaks) || !o.priceBreaks.length) return void problems.push(`${at}: priceBreaks must list at least one { qty, unitUsd }, not ${say(o.priceBreaks)}`);
      o.priceBreaks.forEach((b, j) => {
        const pb = `${at}: priceBreaks[${j}]`;
        if (!isObj(b)) return void problems.push(`${pb} must be { qty, unitUsd }, not ${say(b)}`);
        const y = unknown(b, ["qty", "unitUsd"]);
        if (y.length) problems.push(`${pb} has ${strays(y, ["qty", "unitUsd"])}`);
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
