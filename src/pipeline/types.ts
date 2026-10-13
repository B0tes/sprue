// Stage contracts for the Anatomy 2.0 pipeline (docs/pipeline.md).
// Each stage reads the files written by the stages before it from products/<slug>/
// and writes exactly one file of its own. Keep these types plain JSON.

/** Stage 0: the chat request, turned into fields. */
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

/** Stage 1 numbers the later stages check against (design.md explains them). */
export type Design = {
  slug: string;
  summary: string;
  architecture: string[]; // one line per block, e.g. "USB 5V -> Pico VSYS"
  params: Record<string, number | string>; // mm, mA, counts
  assembly?: string[]; // ordered build steps for stage 6
};

export type BomLine = {
  id: string; // stable, e.g. "ctrl", "sw"
  name: string;
  /** Functional role used for scoring against the reference, e.g. "controller". */
  role: string;
  process: Process;
  qtyPerUnit: number;
  spec: Record<string, string | number>;
  mpn?: string; // preferred manufacturer part number
  alternates?: string[];
  /** For made parts: the file a fab needs, relative to the product folder. */
  file?: string;
  notes?: string;
};

/** Stage 2. */
export type Bom = { slug: string; units: number; lines: BomLine[] };

/** Stage 3. */
export type CheckStatus = "pass" | "fail" | "flag";
export type Check = {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  lines?: string[];
};
export type Checks = { slug: string; checks: Check[]; failed: number; flagged: number };

/** Stage 4. */
export type PriceBreak = { qty: number; unitUsd: number };
export type OfferSource = "api" | "snapshot" | "formula" | "estimate";
export type Offer = {
  supplier: string;
  sku: string;
  mpn?: string;
  url: string;
  packSize?: number; // units per purchasable pack, if sold in packs
  priceBreaks: PriceBreak[]; // unit price per piece (not per pack)
  stock: number | "in stock" | "unknown";
  leadDays: number;
  source: OfferSource;
  capturedAt: string; // ISO date the price was read
};
export type SourcedLine = { lineId: string; offers: Offer[]; note?: string };
export type Sourcing = { slug: string; lines: SourcedLine[]; unsourced: string[] };

/** Stage 5. How the price was obtained, shown to the user. */
export type QuoteMode = "api" | "scripted" | "agent" | "snapshot" | "estimate";
export type QuoteLine = {
  lineId: string;
  supplier: string;
  sku: string;
  mode: QuoteMode;
  orderQty: number; // what we actually buy (packs, fab minimums)
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
};

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
