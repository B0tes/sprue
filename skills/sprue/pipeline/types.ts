// File contracts for the Sprue pipeline (docs/pipeline.md). A run has three stages, design, source and build.
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
  /** Set by `sprue pick`: always buy this line from this supplier (and SKU), even if dearer. */
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
/** A rule that did not run because the design has none of the params it needs: it doesn't apply to this product.
 * One with some of its params but not all fails instead (check.ts), since that is most often a param left out. */
export type SkippedCheck = { id: string; title: string; missing: string[] };
export type Checks = { slug: string; checks: Check[]; failed: number; flagged: number; skipped?: SkippedCheck[] };

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
  shipsWith?: string; // the fab whose parcel carries this line (catalog.json shipsWith), so its shop adds no shipping
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
  /** ran: checks that ran (checks.json); skipped: the ids of rules that don't apply, having none of their params. */
  checks: { failed: number; flagged: number; ran: number; skipped: string[] };
  /** unpriced: BOM lines the batch needs that the quote has no price for; any of them fails the score. */
  cost: { batchUsd: number; referenceMidUsd: number; deltaPct: number; withinBand: boolean; unpriced: string[] };
  files: { name: string; ok: boolean; detail: string }[];
  /** The whole-product check (system.json): ok only while it passed, its self-test too, on the design as it is now. */
  system: { ok: boolean; detail: string; failed: string[] };
  pass: boolean;
};

/** system.json: the product's parts in one frame, checked as one thing by cad/system.py (`sprue system`). */
export type SystemCheck = {
  slug: string;
  ok: boolean;
  generatedAt: string;
  parts: number;
  /** Bought parts drawn as boxes and cylinders at their datasheet sizes, not their makers' models. */
  envelopes: number;
  /** `flags`: problems the design accepts, each with its reason (a Pose's or Push's `accept`); they don't fail the gate. */
  gates: { id: string; title: string; status: "pass" | "fail"; detail: string; problems: number; flags?: string[] }[];
  stability: { pose: string; massG: number; com: number[]; tiltDeg: number; tipsToward: number[]; estimatedG: number;
    pushes: { name: string; tipN: number | null; needN: number }[] }[];
  probes: { id: string; kind: string; [k: string]: unknown }[];
  selfTest: { ok: boolean; faults: { gate: string; fault: string; caught: boolean; detail: string }[]; untested: string[] };
  /** sha256 of the files the result depends on (score.ts systemInputs). */
  inputs: Record<string, string>;
  seconds: number;
};
