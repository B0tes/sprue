// The source stage's offers: match each bought BOM line to real offers, from catalog.json (snapshots Claude read
// from supplier pages) with any live DigiKey offers (offers.digikey.json) that loadCatalog merged in. An offer out
// of stock, or with fewer pieces on hand than the batch needs, is dropped here and the line's note says so.

import type { Bom, Offer, Sourcing } from "../types.ts";
import { batchNeed } from "../io.ts";

export type Catalog = Record<string, Offer[]>; // keyed by BOM line id

export function source(bom: Bom, catalog: Catalog): Sourcing {
  const lines = bom.lines
    .filter((l) => l.process === "buy")
    .map((l) => {
      const need = batchNeed(l, bom.units);
      const all = catalog[l.id] ?? [];
      // Numeric stock is pieces on hand: an offer that can't cover the batch is not a way to buy it.
      const short = all.filter((o) => typeof o.stock === "number" && o.stock > 0 && o.stock < need);
      const offers = all.filter((o) => o.stock !== 0 && !short.includes(o));
      const dropped = short.length ? `dropped for short stock (need ${need}): ${short.map((o) => `${o.supplier} ${o.sku} has ${o.stock}`).join("; ")}` : undefined;
      const note = !offers.length ? (dropped ? `no offer with enough stock; ${dropped}` : all.length ? "every offer is out of stock" : "no offer found")
        : dropped;
      return { lineId: l.id, offers, note };
    });
  return { slug: bom.slug, lines, unsourced: lines.filter((l) => !l.offers.length).map((l) => l.lineId) };
}
