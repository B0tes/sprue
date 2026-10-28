// File contracts for the Sprue pipeline (docs/pipeline.md). A run has four stages, design, inspect, source and build.
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
  /** Whether it holds one part on its own (Design's gate) or the parts together (Inspect's). */
  scope?: CheckScope;
};
export type CheckScope = "part" | "assembly";
/** A rule that did not run because the design has none of the params it needs: it doesn't apply to this product.
 * One with some of its params but not all fails instead (check.ts), since that is most often a param left out. */
export type SkippedCheck = { id: string; title: string; missing: string[] };
/** `unscoped`: the rules.ts rules that say no scope, read as part. */
export type Checks = { slug: string; checks: Check[]; failed: number; flagged: number; skipped?: SkippedCheck[]; unscoped?: string[] };

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
  note?: string; // what the page said that the fields don't hold
};
/** One bought line's offers: those that can buy it, `note` saying what was dropped and why (out of stock, short of the
 * batch, another part), `alternates` naming the offers that are of an alternate rather than the line's own mpn, and
 * `flags` for gate 3 (one offer or one shop, an alternate, offers with no part number to hold to the line's). */
export type SourcedLine = { lineId: string; offers: Offer[]; note?: string; alternates?: { supplier: string; sku: string; alternate: string }[];
  flags?: string[] };
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
  alternate?: string; // the bom.json alternate this offer is of, when it is not the line's own mpn
};
export type Quotes = {
  slug: string;
  units: number;
  lines: QuoteLine[];
  batchUsd: number;
  perUnitUsd: number;
  longestLeadDays: number;
  unquoted: string[];
  /** Shops the order buys from that catalog.json gives no shipping figure (and are no print service): the total
   * counts their shipping as $0, so the quote is not one yet. */
  noShipping?: string[];
  /** Set when design.params.firstArticleUnits is: order A builds that many units first, order B the rest. */
  phases?: Phase[];
  /** What it was priced from (quoteInputs): the sha256 of bom.json, catalog.json, offers.digikey.json and Sprue's
   * rates.json, and firstArticleUnits. A gate and `sprue package` refuse a quote of earlier ones. */
  inputs?: Record<string, string>;
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
  /** Seeded faults (faults.json, `sprue faults`), when reference/faults.json lists some: ok only while every fault was
   * caught, with no false alarm on the clean design, on the design and Sprue's gates as they are now. `pass` needs it
   * ok; a product with no reference/faults.json has no `faults` and is not held to it. */
  faults?: { ok: boolean; detail: string; ran: number; caught: number; pct: number; missed: string[]; falseAlarms: number };
  pass: boolean;
};

/** A part of system.json's frame (cad/system.py `frame`). */
export type SystemItem = { id: string; line: string | null; model: "cad" | "envelope"; material: string | null; tags: string[];
  massG: number | null; massNote: string; estimated: boolean; bbox: number[] | null };

/** Where a problem of system.json is: the ids of the parts it is of (a stability problem may name an item of a pose's
 * own, which `items` doesn't list), and a point in the product's frame (mm), or null where it is of the parts as a
 * whole (a line short of a part) or of none (a gate that can't run). */
export type Where = { parts: string[]; at: number[] | null };

/** system.json: the product's parts in one frame, checked as one thing by cad/system.py (`sprue system`). */
export type SystemCheck = {
  slug: string;
  ok: boolean;
  generatedAt: string;
  parts: number;
  /** Bought parts drawn as boxes and cylinders at their datasheet sizes, not their makers' models. */
  envelopes: number;
  /** The gap every pair keeps but those the design pairs (`_system.py`'s min_clearance_mm); null with no System. This,
   * `items` and `relations` are what the 3D view draws; a system.json of an earlier Sprue has none of them. */
  minClearanceMm?: number | null;
  /** Each part in the frame, as the 3D view shows it: `massG` as the stability gate weighs it (null, with why in
   * `massNote`, when it can't), `estimated` when its note says so, `bbox` [x0, y0, z0, x1, y1, z1] in mm. */
  items?: SystemItem[];
  /** The design's fits, contacts, gaps and insides, each with the items that meet it: `pairs` [a, b], the first
   * matching its `a`, each pair once (a fit's share volume, a contact's touch, a Gap's are closer than minClearanceMm),
   * as the overlap, contact and clearance gates found them, null where that gate couldn't run; an inside's `parts` and
   * `case`, the items its patterns match. */
  relations?: {
    fits: { a: string; b: string; why: string; pairs: [string, string][] | null }[];
    contacts: { a: string; b: string; why: string; gap: number | null; pairs: [string, string][] | null }[];
    gaps: { a: string; b: string; mm: number; accept: string; pairs: [string, string][] | null }[];
    inside: { items: string; within: string[]; why: string; parts: string[]; case: string[] }[];
    unplaced: Record<string, string>;
  };
  /** The 3D model, `previews/system.glb`, written by the same run: `inputs` the sha256 of `inputs` below as JSON with
   * its keys in order and no spaces (the GLB's asset.extras.inputs too), `triangles` in it. null when none was
   * written (no System, or the model couldn't be made); a system.json of an earlier Sprue has none. */
  model?: { file: string; inputs: string; triangles: number } | null;
  /** `flags`: problems the design accepts, each with its reason (a Pose's, Push's or probe's `accept`, or a Gap's); they don't fail the gate. */
  /** `list`: a failing gate's problems, each in full (`detail` has the first 8); at most 200. `where` beside it and
   * `flagsWhere` beside `flags`: where each one is. */
  gates: { id: string; title: string; status: "pass" | "fail"; detail: string; problems: number; list?: string[]; where?: Where[];
    flags?: string[]; flagsWhere?: Where[] }[];
  stability: { pose: string; massG: number; com: number[]; tiltDeg: number; tipsToward: number[]; estimatedG: number;
    pushes: { name: string; tipN: number | null; needN: number }[] }[];
  probes: { id: string; kind: string; [k: string]: unknown }[];
  selfTest: { ok: boolean; faults: { gate: string; fault: string; caught: boolean; detail: string }[]; untested: string[] };
  /** sha256 of the files the result depends on (score.ts systemInputs): design.json as "design.json params" (designParams),
   * bom.json as "bom.json for one unit" (bomForOneUnit); "changed while the check ran" for one that did. */
  inputs: Record<string, string>;
  seconds: number;
};

/** One edit of a seeded fault: in any file `replace`, each `from` found exactly once; then in a JSON file `set` (path to
 * value) and `delete` (paths), such as params.caseWallMm or lines[id=sw].qtyPerUnit, each there already. `optional`:
 * skipped when the product has no such file (offers.digikey.json). */
export type FaultEdit = { file: string; set?: Record<string, unknown>; delete?: string[]; replace?: { from: string; to: string }[]; optional?: boolean };

/** reference/faults.json: the faults `sprue faults` puts into copies of the product, and the answer key. `expect`: the
 * parts, lines or words a new problem must name for the fault to count as caught. `known`: the problems the clean
 * design really has, each with why, which are not false alarms. */
export type FaultList = {
  slug: string;
  note?: string;
  faults: { id: string; area: "mechanical" | "pcb" | "bom"; fault: string; edit: FaultEdit[]; expect: string[] }[];
  known: { problem: string; why: string }[];
};

/** A problem a gate found: `gate` is the command or report it came from (checks, pcb, system:overlap, score...). */
export type Problem = { gate: string; text: string };

/** One fault's run. `new`: problems the clean copy does not have (at most 12); `broke`: the first of them that says a
 * step crashed, which is never a catch; `stale`: problems that only say a stage did not run; `kicad`: for a board
 * fault, whether KiCad's DRC on the rebuilt board (which does not hold it back) saw it, "not run" when our audit
 * stopped the board first. */
export type FaultCase = {
  id: string; area: FaultList["faults"][number]["area"]; fault: string; ran: boolean; caught: boolean; by: string[];
  got?: string; broke?: string; new: Problem[]; stale: string[]; kicad?: "caught" | "missed" | "not run"; error?: string;
};

/** faults.json, written by `sprue faults`. */
export type FaultsReport = {
  slug: string;
  ok: boolean;
  generatedAt: string;
  ran: number;
  caught: number;
  pct: number;
  missed: string[];
  falseAlarms: number;
  control: { problems: Problem[]; stale: string[]; falseAlarms: Problem[]; known: (FaultList["known"][number] & { seen: boolean })[] };
  cases: FaultCase[];
  /** sha256 of the files the result depends on (score.ts faultsInputs). */
  inputs: Record<string, string>;
  seconds: number;
};
