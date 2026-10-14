// File contracts for the Distinta pipeline (docs/pipeline.md). A run has three stages, design, source and build.
// Each stage reads the files written by the stages before it from products/<slug>/
// and writes exactly one file of its own. Keep these types plain JSON.

/** The chat request, turned into fields (request.json, written at the start of the design stage). */
export type Request = {
  slug: string;
  brief: string; // the user's words, verbatim
  product: string; // what it is, in a few words
  units: number; // how many to build
  region: string; // where parts ship to, e.g. "US"
  budgetUsd?: number; // for the whole batch
  mustHave: string[];
  niceToHave: string[];
  constraints: Record<string, string | number | boolean>;
};

export type Process = "buy" | "pcb" | "print" | "cnc" | "sheet";

/** The design stage's numbers, which the CAD, the figure and the checks read (design.md explains them). */
export type Design = {
  slug: string;
  summary: string;
  architecture: string[]; // one line per block, e.g. "USB 5V -> Pico VSYS"
  params: Record<string, number | string>; // mm, mA, counts
  assembly?: string[]; // ordered build steps for the build plan
  /** Which GPIO each key's socket is wired to ("K1": "GP10"), for a board with key sockets: the intent the PCB audit
   * holds the drawn board to (pipeline/pcb/intent.ts). */
  keyMap?: Record<string, string>;
  /** Numbers that are still estimates, each with where it came from; shown at gate 1. */
  estimates?: string[];
  /** Costs the quote leaves out (duty, unpriced shipping, consumables), shown under the plan's headline. */
  costNotes?: string[];
};

export type BomLine = {
  id: string; // stable, e.g. "ctrl", "sw"
  name: string;
  /** A few words for tight places (the figure's readout), e.g. "Hot-swap socket". Defaults to name. */
  shortName?: string;
  /** Functional role used for scoring against the reference, e.g. "controller". */
  role: string;
  process: Process;
  qtyPerUnit: number;
  /** Extra pieces for the whole batch (attrition), on top of qtyPerUnit x units. */
  spares?: number;
  /** A batch-level quantity (a wire set, a tube of glue) used instead of qtyPerUnit x units. */
  qtyPerBatch?: number;
  spec: Record<string, string | number>;
  mpn?: string; // preferred manufacturer part number
  alternates?: string[];
  /** For made parts: the file a fab needs, relative to the product folder. */
  file?: string;
  notes?: string;
  /** Set by `distinta pick`: always buy this line from this supplier (and SKU), even if dearer. */
  pin?: { supplier: string; sku?: string };
};

/** The bill of materials (design stage). */
export type Bom = { slug: string; units: number; lines: BomLine[] };

/** The design stage's engineer checks. */
export type CheckStatus = "pass" | "fail" | "flag";
export type Check = {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  lines?: string[];
};
export type Checks = { slug: string; checks: Check[]; failed: number; flagged: number };

/** The source stage: offers read from supplier pages. */
export type PriceBreak = { qty: number; unitUsd: number };
export type OfferSource = "api" | "snapshot" | "formula" | "estimate";
export type Offer = {
  supplier: string;
  sku: string;
  mpn?: string;
  url: string;
  packSize?: number; // units per purchasable pack, if sold in packs
  priceBreaks: PriceBreak[]; // unit price per piece (not per pack)
  stock: number | "in stock" | "unknown"; // a number is pieces on hand (not packs); 0 = out of stock
  leadDays: number;
  source: OfferSource;
  capturedAt: string; // ISO date the price was read
};
export type SourcedLine = { lineId: string; offers: Offer[]; note?: string };
export type Sourcing = { slug: string; lines: SourcedLine[]; unsourced: string[] };

/** The source stage's quote. How the price was obtained, shown to the user. */
export type QuoteMode = "api" | "scripted" | "agent" | "snapshot" | "estimate";
export type QuoteLine = {
  lineId: string;
  supplier: string;
  sku: string;
  mode: QuoteMode;
  needQty?: number; // pieces the batch needs, spares included
  orderQty: number; // pieces we actually buy (rounded up to whole packs or a cheaper price break)
  packSize?: number; // pieces per pack, when the shop sells packs
  packs?: number; // packs to put in the cart (orderQty / packSize)
  orderUsd: number;
  leadDays: number;
  basis: string; // one line: where the number came from
};
export type Quotes = {
  slug: string;
  units: number;
  lines: QuoteLine[];
  batchUsd: number;
  perUnitUsd: number;
  longestLeadDays: number;
  unquoted: string[];
  /** Set when design.params.firstArticleUnits is: order A builds that many units first, order B the rest. */
  phases?: Phase[];
};
export type Phase = { name: string; units: number; lines: QuoteLine[]; batchUsd: number; longestLeadDays: number; unquoted: string[] };

/** The answer key for a reference product. */
export type Reference = {
  slug: string;
  source: string; // URL of the known-good design
  units: number;
  roles: { role: string; spec: string; qtyPerUnit: number }[];
  batchUsd: { low: number; high: number; basis: string };
};

export type Score = {
  slug: string;
  coverage: { matched: string[]; missing: string[]; extra: string[]; pct: number };
  checks: { failed: number; flagged: number };
  cost: { batchUsd: number; referenceMidUsd: number; deltaPct: number; withinBand: boolean };
  files: { name: string; ok: boolean; detail: string }[];
  pass: boolean;
};
