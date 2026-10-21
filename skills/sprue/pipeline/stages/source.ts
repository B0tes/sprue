// The source stage's offers: match each bought BOM line to real offers, from catalog.json (snapshots Claude read
// from supplier pages) with any live DigiKey offers (offers.digikey.json) that loadCatalog merged in. An offer out
// of stock, or with fewer pieces on hand than the batch needs, is dropped here and the line's note says so. So is an
// offer of another part: one whose `mpn` is neither the line's `mpn` nor one of its `alternates` (the CO2 run's order
// bought a different board on a line without a word). An offer of an alternate stays, and the line says which.

import type { Bom, BomLine, Offer, SourcedLine, Sourcing } from "../types.ts";
import { batchNeed } from "../io.ts";

export type Catalog = Record<string, Offer[]>; // keyed by BOM line id

/** Sizes, threads, amounts, values, packages and dates: words with a digit in them that are not a part number. */
const NOT_A_CODE = [
  // A number, fraction or range with its unit: 5/8in, 1-3/4in, 15in, 100mm, 1/4w, 3.3v, 26awg, 4ohm.
  /^\d[\d./-]*(mm|cm|m|in|ips|ft|awg|gb|tb|mb|kb|v|mv|w|mw|a|ma|mah|ohms?|k|kohms?|mohms?|r|hz|khz|mhz|ppm|pcs?|pack|x|deg|g|kg|uf|nf|pf|uh|mh|nh)$/,
  // A fraction with no unit (1/4-40, a thread), and a decimal (4.0, 3.64).
  /^\d[\d.-]*\/[\d./-]*$/, /^\d+\.\d+$/,
  // Two sizes (128x64, 1x0.14), a metric thread (M3, M2.5, M3-0.5, M3x8, M2.5x6mm), an inch screw (#4-40, 6-32).
  /^[\d.]+x[\d.]+(mm|cm|in)?$/, /^m\d+(\.\d+)?([x*-][\d.]+)*(mm)?$/, /^(0|1|2|3|4|5|6|8|10|12)-(80|72|64|56|48|44|40|36|32|28|24)$/,
  // A date, a count of something (4-pin, 2-week), a supply (5V2A, 3V3), a chip package and an SD card's class.
  /^\d{4}-\d{2}-\d{2}$/, /^\d+-(pins?|ways?|weeks?|days?|packs?|pieces?|pcs|cores?|wires?|ports?|keys?)$/, /^\d+(\.\d+)?v\d+(\.\d+)?a?$/,
  /^(0201|0402|0603|0805|1206|1210|2512)$/, /^(a1|a2|u1|u3|v[369]0)$/,
];
/** A unit on its own after a number ("150 mm", "100 pcs"), which makes the number an amount. */
const UNIT = /^(mm|cm|m|in|inch|inches|ft|awg|gb|tb|mb|v|w|a|ma|mah|ohms?|hz|khz|mhz|ppm|pcs|pc|pieces?|pack|deg|degrees|g|kg|lb|oz|uf|nf|pf)$/;
/** Words that make the number after them a standard, not a part (ISO 7380, DIN 912). */
const STANDARD = /^(iso|din|en|iec|ul|ansi|astm|ipc)$/;

/** The part numbers in a text, in order: each word with a letter and a digit (SC0915, WP-59SURKCGKW, DEV-14809) or
 * three or more digits (5187, 1363-1), lower case and with the marks inside it dropped, so "WP-59SURKCGKW" and
 * "WP59SURKCGKW" are one. The rest (a maker's name, "32 GB", "M2.5", "1/8ips", "150 mm", a pack of 100, ISO 7380, 0805)
 * is no part number. */
export function partCodes(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[‐-―−]/g, "-").replace(/×/g, "x").split(/[\s,;:()[\]+]+/)
    .map((raw) => raw.replace(/^[#$~]+/, "").replace(/[.]+$/, ""));
  const codes = new Set<string>();
  words.forEach((w, i) => {
    if (!/\d/.test(w) || NOT_A_CODE.some((re) => re.test(w))) return;
    if (/^[\d.,/-]+$/.test(w) && (UNIT.test(words[i + 1] ?? "") || STANDARD.test(words[i - 1] ?? ""))) return;
    const code = w.replace(/[-._/'"#]/g, "");
    if (/[a-z]/.test(code) || /^\d{3,}$/.test(code)) codes.add(code);
  });
  return codes;
}

/** A text's own part number: the first in it. What follows is a comment ("Adafruit 5190 (SCD-41, same board)" is
 * 5190, not the SCD-41 named after it), and a size or maker's name before it is none. */
export const partNumber = (text: string): string | undefined => partCodes(text).values().next().value;

/** What an offer's part number is to its line: the line's own part (`mpn`), one of its `alternates` (the alternate's
 * text, as bom.json gives it), another part, or nothing to tell by. Each text counts by its own part number
 * (partNumber), so "Raspberry Pi SC0915" is "SC0915", "3203" is "Adafruit 3203", and "5187 SCD-40" is "Adafruit 5187",
 * while "SCD-41" is not "Adafruit 5190 (SCD-41, same board)" and "Adafruit 5190 (replaces 5187)" is not "Adafruit 5187".
 * A part number in brackets counts when nothing before it is one ("... Coupling - Black (NE438BL)"). An offer with no
 * part number in its mpn ("Adafruit", "M3 x 8 mm") can't be told apart, and neither can any offer of a line whose mpn
 * holds none. */
export function partOf(line: Pick<BomLine, "mpn" | "alternates">, offerMpn: string | undefined):
  { as: "mpn" } | { as: "alternate"; alternate: string } | { as: "other" } | { as: "unknown" } {
  if (typeof line.mpn !== "string" || !line.mpn) return { as: "unknown" };
  const offer = partNumber(typeof offerMpn === "string" ? offerMpn : "");
  if (!offer) return { as: "unknown" };
  const own = partNumber(line.mpn);
  if (own === offer) return { as: "mpn" };
  const alternates = Array.isArray(line.alternates) ? line.alternates.filter((a) => typeof a === "string") : [];
  const alternate = alternates.find((a) => partNumber(a) === offer);
  if (alternate) return { as: "alternate", alternate };
  // A line whose mpn names no part number can't tell its own part from another.
  return own ? { as: "other" } : { as: "unknown" };
}

export function source(bom: Bom, catalog: Catalog): Sourcing {
  const lines = bom.lines
    .filter((l) => l.process === "buy")
    .map((l): SourcedLine => {
      const need = batchNeed(l, bom.units);
      const all = catalog[l.id] ?? [];
      const said = (o: Offer) => `${o.supplier} ${o.sku}`;
      // An offer of another part is not a way to buy this line, whatever it costs.
      const other = all.filter((o) => partOf(l, o.mpn).as === "other");
      const same = all.filter((o) => !other.includes(o));
      // Numeric stock is pieces on hand: an offer that can't cover the batch is not a way to buy it.
      const out = same.filter((o) => o.stock === 0);
      const short = same.filter((o) => typeof o.stock === "number" && o.stock > 0 && o.stock < need);
      const offers = same.filter((o) => !out.includes(o) && !short.includes(o));
      const drops = [
        other.length && `dropped as another part (bom.json's mpn is ${l.mpn}${l.alternates?.length ? `, or an alternate it lists` : ""}): ${other.map((o) => `${said(o)} is ${o.mpn}`).join("; ")}`,
        out.length && `dropped as out of stock: ${out.map(said).join("; ")}`,
        short.length && `dropped for short stock (need ${need}): ${short.map((o) => `${said(o)} has ${o.stock}`).join("; ")}`,
      ].filter(Boolean).join("; ") || undefined;
      const note = !offers.length ? (drops ? `no offer to buy it from; ${drops}` : "no offer found") : drops;
      const alternates = offers.flatMap((o) => {
        const p = partOf(l, o.mpn);
        return p.as === "alternate" ? [{ supplier: o.supplier, sku: o.sku, alternate: p.alternate }] : [];
      });
      // A line with an mpn whose text holds no part number (only a description) can't have its offers checked.
      const codeless = !!l.mpn && !partNumber(String(l.mpn));
      const unknown = l.mpn && !codeless ? offers.filter((o) => partOf(l, o.mpn).as === "unknown") : [];
      const shops = [...new Set(offers.map((o) => o.supplier))];
      const n = unknown.length;
      const flags = [
        offers.length === 1 ? `one offer (${shops[0]}): no second source if it sells out` :
          shops.length === 1 && offers.length > 1 ? `every offer is from ${shops[0]}: no second shop` : "",
        ...alternates.map((a) => `${a.supplier} ${a.sku} is the alternate ${a.alternate}, not ${l.mpn}: the design and its checks describe ${l.mpn}`),
        codeless && offers.length ? `bom.json's mpn for it has no part number in it (a code with a letter and a digit, or 3 or more digits), so no offer can be checked against it: give the maker's part number` : "",
        n ? `${n === offers.length ? (n === 1 ? "its offer gives" : `its ${n} offers give`) : `${n} of its ${offers.length} offers ${n === 1 ? "gives" : "give"}`} no part number to check against ${l.mpn} (${unknown.map(said).join("; ")}): check ${n === 1 ? "that page shows" : "their pages show"} that part` : "",
      ].filter(Boolean);
      return { lineId: l.id, offers, ...(note ? { note } : {}), ...(alternates.length ? { alternates } : {}), ...(flags.length ? { flags } : {}) };
    });
  return { slug: bom.slug, lines, unsourced: lines.filter((l) => !l.offers.length).map((l) => l.lineId) };
}
