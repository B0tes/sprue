// Stage 4: match each bought BOM line to real offers.
// Adapters are tried in order. Today only the snapshot catalog works from this
// environment (supplier hosts are blocked by its network policy); DigiKey and
// jlcsearch adapters slot in here once keys and network access exist.

import type { Bom, Offer, Sourcing } from "../types.ts";

export type Catalog = Record<string, Offer[]>; // keyed by BOM line id

export function source(bom: Bom, catalog: Catalog): Sourcing {
  const lines = bom.lines
    .filter((l) => l.process === "buy")
    .map((l) => {
      const offers = (catalog[l.id] ?? []).filter((o) => o.stock !== 0);
      return { lineId: l.id, offers, note: offers.length ? undefined : "no offer found" };
    });
  return { slug: bom.slug, lines, unsourced: lines.filter((l) => !l.offers.length).map((l) => l.lineId) };
}
