// The source stage's offers: match each bought BOM line to real offers, from catalog.json (snapshots Claude read
// from supplier pages) with any live DigiKey offers (offers.digikey.json) that loadCatalog merged in. An offer out
// of stock, or with fewer pieces on hand than the batch needs, is dropped here and the line's note says so. So is an
// offer of another part: one whose `mpn` is neither the line's `mpn` nor one of its `alternates` (the CO2 run's order
// bought a different board on a line without a word). An offer of an alternate stays, and the line says which.

import type { Bom, BomLine, Offer, SourcedLine, Sourcing } from "../types.ts";
import { batchNeed } from "../io.ts";

export type Catalog = Record<string, Offer[]>; // keyed by BOM line id

/** A part number as the words to compare: lower case, split at spaces and the marks that part words, and with the
 * marks inside a code dropped, so "WP-59SURKCGKW" and "WP59SURKCGKW" are one word. */
export const partWords = (s: string) =>
  s.toLowerCase().split(/[\s,;:()[\]]+/).map((w) => w.replace(/[-._/'"]/g, "")).filter(Boolean);

/** What an offer's part number is to its line: the line's own part (`mpn`), one of its `alternates` (the alternate's
 * text, as bom.json gives it), another part, or nothing to tell by. It is a part when every word of it is a word of
 * the line's mpn or of one alternate: a maker's name may be left out ("3203" is "Adafruit 3203") and a description
 * may run longer ("Raspberry Pi SC1628 32 GB A2"), but "Adafruit 5190" is not "Adafruit 5187". A comment in brackets
 * after an offer's number ("PIGN15BL (image code)") is not part of it. An offer with no number, or none with a digit
 * in it ("Adafruit"), can't be told apart, and neither can any offer of a line with no mpn. */
export function partOf(line: Pick<BomLine, "mpn" | "alternates">, offerMpn: string | undefined):
  { as: "mpn" } | { as: "alternate"; alternate: string } | { as: "other" } | { as: "unknown" } {
  if (!line.mpn) return { as: "unknown" };
  const words = offerMpn ? partWords(offerMpn.replace(/\([^)]*\)/g, " ")) : [];
  if (!words.some((w) => /\d/.test(w))) return { as: "unknown" };
  const within = (text: string) => {
    const have = new Set(partWords(text));
    return words.every((w) => have.has(w));
  };
  if (within(line.mpn)) return { as: "mpn" };
  const alternate = (line.alternates ?? []).find(within);
  return alternate ? { as: "alternate", alternate } : { as: "other" };
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
      const short = same.filter((o) => typeof o.stock === "number" && o.stock > 0 && o.stock < need);
      const offers = same.filter((o) => o.stock !== 0 && !short.includes(o));
      const drops = [
        other.length && `dropped as another part (bom.json's mpn is ${l.mpn}${l.alternates?.length ? `, or an alternate it lists` : ""}): ${other.map((o) => `${said(o)} is ${o.mpn}`).join("; ")}`,
        short.length && `dropped for short stock (need ${need}): ${short.map((o) => `${said(o)} has ${o.stock}`).join("; ")}`,
      ].filter(Boolean).join("; ") || undefined;
      const note = !offers.length
        ? (drops ? `no offer to buy it from; ${drops}` : all.length ? "every offer is out of stock" : "no offer found")
        : drops;
      const alternates = offers.flatMap((o) => {
        const p = partOf(l, o.mpn);
        return p.as === "alternate" ? [{ supplier: o.supplier, sku: o.sku, alternate: p.alternate }] : [];
      });
      const unknown = l.mpn ? offers.filter((o) => partOf(l, o.mpn).as === "unknown") : [];
      const shops = [...new Set(offers.map((o) => o.supplier))];
      const flags = [
        offers.length === 1 ? `one offer (${shops[0]}): no second source if it sells out` :
          shops.length === 1 && offers.length > 1 ? `every offer is from ${shops[0]}: no second shop` : "",
        ...alternates.map((a) => `${a.supplier} ${a.sku} is the alternate ${a.alternate}, not ${l.mpn}: the design and its checks describe ${l.mpn}`),
        unknown.length ? `${unknown.length === offers.length ? (unknown.length === 1 ? "its offer names" : `its ${unknown.length} offers name`) : `${unknown.length} of its ${offers.length} offers name`} no part number to hold to ${l.mpn} (${unknown.map(said).join("; ")}): check ${unknown.length === 1 ? "that page shows" : "their pages show"} that part` : "",
      ].filter(Boolean);
      return { lineId: l.id, offers, ...(note ? { note } : {}), ...(alternates.length ? { alternates } : {}), ...(flags.length ? { flags } : {}) };
    });
  return { slug: bom.slug, lines, unsourced: lines.filter((l) => !l.offers.length).map((l) => l.lineId) };
}
