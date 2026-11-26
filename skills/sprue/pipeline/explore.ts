// Everything a person looks at: the BOM with every way to buy each line, the shops in the order,
// what changed since the last run, and the data view.html (the product page) and the website render,
// which `sprue view` saves as explorer.json. Nothing here changes a price; it reads the files the
// stages wrote. Before stage 3 (Source) there is no quote yet: the data then has quoted: false and no offers.
// Stage 2 (Inspect) reads the whole-product check: system.json, as score.ts's systemAudit judges it against the
// files there are now, and faults.json.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batchNeed, exists, productDir, readJson, usd, writeJson } from "./io.ts";
import { chooseRiding, madeWays, options, readQuotes, type Option } from "./stages/quote.ts";
import { faultsAudit, isMade, systemAudit, systemInputs, withSystem } from "./stages/score.ts";
import { source } from "./stages/source.ts";
import { catalogError, catalogProblems } from "./catalog.ts";
import { HOME, printShipping, type FabRates, type Filament } from "./adapters/fab.ts";
import type { Bom, Checks, Design, Offer, Request, Score, Sourcing, SystemCheck } from "./types.ts";
import { readState, type State } from "./state.ts";
import { limitsOf, type Limit } from "./limits.ts";
import { handoffView, type HandoffView } from "./handoff.ts";
import { exampleOf, reportUrl } from "./gallery.ts";

export type ExplorerOption = {
  supplier: string;
  sku: string;
  mpn?: string;
  url: string;
  packSize?: number;
  unitUsd: number;
  orderQty: number;
  orderUsd: number;
  /** The price before rounding to the cent, where it differs from orderUsd: the quote's search for the bought lines'
   * shops weighs this one, so a requote does too (the total adds orderUsd, as the quote's does). */
  exactUsd?: number;
  stock: Offer["stock"];
  leadDays: number;
  source: string;
  capturedAt: string;
};

export type ExplorerLine = {
  id: string;
  name: string;
  /** What the figure's readout calls the part. */
  shortName?: string;
  role: string;
  process: string;
  qtyPerUnit: number;
  /** Pieces the batch needs: qtyPerBatch, or qtyPerUnit x units, plus spares. */
  needQty: number;
  spares?: number;
  qtyPerBatch?: number;
  spec: Record<string, string | number>;
  mpn?: string;
  notes?: string;
  file?: string;
  pin?: { supplier: string; sku?: string };
  /** Bought lines: every offer priced for the batch, and which one the quote chose. */
  options: ExplorerOption[];
  chosen: number;
  /** Where catalog.json lists the offers otherwise than cheapest first: the options in its order (indices into
   * `options`). A requote meets the shops in this order, as the quote's search does, which decides a tie. */
  offerOrder?: number[];
  /** Why some offers were left out (another part than bom.json's, none on hand, or stock below the batch's need), from
   * sourcing. */
  sourceNote?: string;
  /** Made lines: the fab quote. `quoted`: priced from a shop's quote recorded in catalog.json, whose orderQty is a count
   * the shop quoted, not a minimum. */
  made?: ExplorerMade;
  /** Made lines, where a pick can move one (Explorer.ways): each option the quote weighs for the line, which a way's
   * `at` points into. */
  fabs?: ExplorerMade[];
  /** Made lines whose price already includes shipping (PCBs), or that ship nowhere (printed at home). */
  shipsFree?: boolean;
};

export type ExplorerMade = { supplier: string; sku: string; orderQty: number; orderUsd: number; leadDays: number; mode: string; basis: string; quoted?: boolean };

/** An order of the made lines the quote weighs (quote.ts madeWays()), with what it changes about the bought lines'
 * shops: their shipping, and which of them ride in a fab's parcel. */
export type ExplorerWay = {
  /** Each line's option in its `fabs` (-1 for a line that is not made, or not priced). */
  at: number[];
  /** Lines it makes at another shop than the cheapest for each, which of two orders that cost the same decides. */
  moves: number;
  /** Where the order holds only with a bought line riding in this fab's parcel, and the shops that would (as
   * Explorer.needsRider and riders); the requote leaves out the order where no line can. */
  needsRider?: string;
  riders?: string[];
  /** Explorer.shipping and shipsWith with these made lines (shipping: of the shops selling or making a line here). */
  shipping: Record<string, number>;
  shipsWith?: Record<string, string>;
  /** Shops making a line here that ride in the named fab's parcel only where the order also buys a bought line from
   * them, as quote.ts labels them: catalog.json has no figure for them and their made lines' print rates' is 0, so they
   * ride where a line of theirs is not one of those made lines. Only a made line's words turn on it. */
  ridesIfSells?: Record<string, string>;
  /** An order the quote weighs only with a bought line pinned (one of two that cost the same, which a pin making a shop
   * alone sell a line can make it keep): the requote weighs it only with a line pinned to one of these shops. */
  when?: string[];
};

export type Explorer = {
  slug: string;
  product: string;
  brief: string;
  units: number;
  region: string;
  budgetUsd?: number;
  summary: string;
  architecture: string[];
  params: Record<string, number | string>;
  assembly: string[];
  lines: ExplorerLine[];
  /** Flat shipping per shop, charged once per shop the order uses. */
  shipping: Record<string, number>;
  /** The shops whose shipping was read from their published rates or, for a shop with a shop's quote for a made part
   * in catalog.json, at its checkout (catalog.json shippingRead); the rest are estimates. */
  shippingRead?: string[];
  /** Those of shippingRead with a shop's quote in catalog.json, whose figure may have been read at their checkout. */
  shippingAtCheckout?: string[];
  /** Shops whose parts ride in the parcel of a fab that makes a line here (shop -> fab, catalog.json shipsWith), as the
   * quote says of its own shops and a pick would of one the order buys nothing from: their shipping is 0. */
  shipsWith?: Record<string, string>;
  /** The fab whose parcel a bought line rides in for the quote's order to hold (quotes.json needsRider): the requote of
   * a pick with these made lines buys a line riding there where one can, and where a pick can move a made line (ways),
   * weighs too each other order of them, as `sprue pick` quotes the whole order again. */
  needsRider?: string;
  /** With needsRider, the shops the quote counts as riding in its parcel: those that sell a line here with catalog.json
   * shipsWith to it and their own figure not a known 0, whether or not the order labels them (shipsWith above). */
  riders?: string[];
  /** Where a pick can move a made line, as `sprue pick` quotes the whole order again: every order of the made lines the
   * quote weighs, in the order it weighs them, each once (quote.ts madeWays()). The requote of a pick prices it with
   * each and keeps the cheapest, as the quote keeps one. None where the quote weighs one order (or none) of them. */
  ways?: ExplorerWay[];
  /** Of `ways`, the quote's own: its made lines and needsRider. */
  quoteWay?: number;
  /** false until quotes.json exists (stage 3): then no line has offers or a fab price yet, and totals are 0. */
  quoted?: false;
  totals: { batchUsd: number; perUnitUsd: number; longestLeadDays: number; unquoted: string[] };
  /** A first-article run (design param firstArticleUnits): order A, then order B, each in production/order-<x>.csv. */
  phases?: { name: string; units: number; batchUsd: number; longestLeadDays: number; file: string }[];
  /** The made parts' hand-off once there is a quote (handoff.ts handoffView): what `sprue handoff` would write in
   * fab/order/ now, with the checks as checks.json has them, or why it would write nothing. It reads the part files in
   * fab/ (and pcb/, through the whole-product check), so, as Inspect, it is what the machine that wrote it found.
   * Whether the folder is there is the product page's to say. */
  handoff?: HandoffView;
  /** Costs the quote leaves out (design.json costNotes). */
  costNotes?: string[];
  /** Numbers not from a datasheet, a page or the CAD yet (design.json estimates), shown before the design is accepted. */
  estimates?: string[];
  /** What Sprue can't check in this product (limits.ts: mains power, batteries, soft goods, made metal parts), each with
   * where it was found; shown with the design, and before it is accepted. None, none written. */
  limits?: Limit[];
  /** Where a person who built it tells how it went (gallery.ts: the build-report form on Sprue's repo, with the product
   * filled in), when it is one of the skill's worked examples or a copy of one; a product of the person's own has none. */
  buildReport?: string;
  /** The figure's steps and which lines it leaves out, from figure.json, when the product has been drawn. */
  figure?: { caption: string; steps: { n: number; text: string; lines: string[] }[]; hidden: Record<string, string>;
    coverage: Record<string, { drawn: number; needed: number }> };
  /** Every check, each with its scope: part ones show under Design, assembly ones under Inspect (one with no scope, from
   * an older checks.json, counts as part). */
  checks: Checks["checks"];
  /** The whole-product check and the checks of the checks, for Inspect. */
  inspect?: InspectSummary;
  score?: Score;
  previews: { name: string; svg: string }[];
  designMd?: string;
  buildPlanMd?: string;
  /** The gates from state.json (design, inspect, source, build), when the run has one. Not part of the cost history. */
  state?: State;
  generatedAt: string;
};

/** A gate of system.json, with the aims a probe missed though it passed (`notes`, the function gate's). */
export type SystemGate = SystemCheck["gates"][number] & { notes?: string[] };

/** What Inspect shows: the whole-product check as it stands now, what system.json found, and how well the checks
 * catch faults. The assembly-scope checks are in Explorer.checks, by their scope. */
export type InspectSummary = {
  /** systemAudit (score.ts): ok only while system.json passed, its self-test too, on the files there are now. */
  verdict: Score["system"];
  /** current: system.json is of the files there are now. stale: of an earlier design. unwritten: there is no
   * cad/_system.py to check the parts with. missing: no system.json. unreadable. none: nothing is made, so nothing is
   * assembled and there is nothing to check. */
  system: "current" | "stale" | "unwritten" | "missing" | "unreadable" | "none";
  /** The command that writes system.json, while it isn't current (after cad/_system.py, when that is unwritten). */
  run?: string;
  /** What system.json found, whenever it could be read: when stale, what it found of an earlier design. `envelopes`:
   * the parts drawn as stand-in shapes (boxes, cylinders, cones, prisms) at their datasheet sizes, not their makers' models. */
  report?: Pick<SystemCheck, "generatedAt" | "parts" | "envelopes" | "stability" | "probes" | "selfTest"> & { gates: SystemGate[] };
  /** The seeded faults (faultsAudit), when reference/faults.json lists some. */
  faults?: Score["faults"];
  /** The rules.ts rules with no scope (checks.json unscoped), read as part. */
  unscoped?: string[];
};

/** The Inspect data for a product. `score` is score.json as withSystem rereads it, when there is one: its system and
 * faults are the audits of the files now, so they are not run twice. */
function inspectOf(slug: string, bom: Bom, checks: Pick<Checks, "unscoped">, score?: Score): InspectSummary {
  const dir = productDir(slug);
  const verdict = score?.system ?? systemAudit(dir, bom);
  const faults = score ? score.faults : faultsAudit(dir);
  const base = { verdict, ...(faults ? { faults } : {}), ...(checks.unscoped?.length ? { unscoped: checks.unscoped } : {}) };
  const hasSystemPy = existsSync(join(dir, "cad", "_system.py"));
  // As systemAudit has it: a product of bought parts alone is not assembled by us, unless it has a whole-product check.
  if (!isMade(bom) && !hasSystemPy) return { ...base, system: "none" };
  const run = `sprue inspect ${slug}`; // it reruns the whole-product check when stale
  if (!hasSystemPy) return { ...base, system: "unwritten", run };
  if (!exists(slug, "system.json")) return { ...base, system: "missing", run };
  let s: SystemCheck;
  try {
    s = readJson<SystemCheck>(slug, "system.json");
  } catch {
    return { ...base, system: "unreadable", run };
  }
  // The same comparison systemAudit makes: any file the result depends on that changed makes it of an earlier design.
  const was = s.inputs ?? {}, now = systemInputs(dir, Object.keys(was));
  const stale = [...new Set([...Object.keys(now), ...Object.keys(was)])].some((k) => now[k] !== was[k]);
  const list = <T>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
  const report = {
    generatedAt: s.generatedAt, parts: s.parts, envelopes: s.envelopes, gates: list<SystemGate>(s.gates),
    stability: list(s.stability), probes: list(s.probes),
    selfTest: { ok: !!s.selfTest?.ok, faults: list(s.selfTest?.faults), untested: list(s.selfTest?.untested) },
  };
  return { ...base, system: stale ? "stale" : "current", ...(stale ? { run } : {}), report };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** The same total quote.ts computes, from a choice of option per bought line. view.html and the
 * website do this sum in the browser when someone picks a different offer. */
export function totalFor(ex: Explorer, choice: number[]): number {
  let sum = 0;
  const shops = new Set<string>();
  ex.lines.forEach((l, i) => {
    if (l.made) {
      sum += l.made.orderUsd;
      if (!l.shipsFree) shops.add(l.made.supplier);
    } else if (l.options.length) {
      const o = l.options[choice[i]];
      sum += o.orderUsd;
      shops.add(o.supplier);
    }
  });
  for (const s of shops) sum += ex.shipping[s] ?? 0;
  return round(sum);
}

/** The shipping the quote weighs when it picks the bought lines' shops, as the total counts it: none for a shop a made
 * line here already pays it to (not a board fab, whose shipping is in the board's price). */
const searchShipping = (ex: Explorer): Record<string, number> =>
  ({ ...ex.shipping, ...Object.fromEntries(ex.lines.flatMap((l) => (l.made && !l.shipsFree ? [[l.made.supplier, 0]] : []))) });

/** The explorer as the quote would have it with order `k` of ex.ways: its made lines, their shops' shipping and the
 * shops riding in a fab's parcel; the explorer itself, for the quote's own (quoteWay). Neither has ways, so a requote
 * of it keeps its made lines where they are. With `choice`, each made line has its words as quote() writes them for the
 * bought lines at those offers, on the quote's own order too (a pick can change the shops riding in a made line's fab's
 * parcel, which its words name), where the explorer is the quote's with only those words changed, its ways kept. */
export function withWay(ex: Explorer, k: number, choice?: number[]): Explorer {
  const { ways, quoteWay, ...rest } = ex;
  const w = ways?.[k];
  if (!w || (k === quoteWay && !choice)) return rest;
  const at = ex.lines.map((l, i) => (w.at[i] >= 0 ? l.fabs?.[w.at[i]] : undefined));
  // Each made line's words as quote() writes them for this order (madeWords()): the order's shops as it lists its
  // lines, the bought ones (at their offers in `choice`) then the made ones, riding as quote() labels them there.
  const sold = ex.lines.flatMap((l, i) => (!l.made && l.options[choice?.[i] ?? -1] ? [l.options[choice![i]].supplier] : []));
  const shops = [...new Set([...sold, ...at.flatMap((f) => (f ? [f.supplier] : []))])];
  const cheapest = new Set(ex.lines.flatMap((l) => (l.fabs?.length ? [l.fabs[0].supplier] : [])));
  const extra = Object.entries(w.ridesIfSells ?? {}).filter(([s]) => sold.includes(s));
  const labels = extra.length ? { ...w, shipsWith: { ...w.shipsWith, ...Object.fromEntries(extra) } } : w;
  if (k === quoteWay) return { ...ex, lines: ex.lines.map((l, i) => (l.made && at[i] ? { ...l, made: { ...l.made, basis: madeWords(l, at[i]!, labels, shops, cheapest) } } : l)) };
  return { ...rest,
    lines: ex.lines.map((l, i) => {
      const f = at[i];
      if (!f) return l;
      // Where it stays at its shop, the quote's line for it, with its words for this order.
      const stays = l.made?.supplier === f.supplier && l.made?.sku === f.sku;
      const basis = madeWords(l, f, labels, shops, cheapest);
      return { ...l, made: { ...(stays && l.made ? l.made : f), basis }, shipsFree: l.process === "pcb" || f.supplier === HOME };
    }),
    shipping: w.shipping, shipsWith: w.shipsWith, needsRider: w.needsRider, riders: w.riders };
}

/** The fab whose parcel `shop` rides in by a shipsWith map, from the map's own keys only: a shop may be named as a
 * property every object has (constructor, toString). */
const rideOf = (m: Record<string, string> | undefined, shop: string): string | undefined => (m && Object.hasOwn(m, shop) ? m[shop] || undefined : undefined);

/** Why made line `l` is at option `f` in order `w`, as quote() words it: the option's own words; that it rides in a
 * fab's parcel where the order has its shop riding there; and where it is not at the line's cheapest shop (its fabs'
 * first), what it was chosen over and why: a board only for a line riding in its parcel, any other line where the order
 * costs less with each shop's shipping counted, naming the order's shops (`shops`, as quote() lists its lines) riding in
 * its parcel, none where a made line is at that shop in the order of each line at its cheapest (`cheapest`). */
function madeWords(l: ExplorerLine, f: ExplorerMade, w: ExplorerWay, shops: string[], cheapest: Set<string>): string {
  let basis = f.basis;
  const fab = rideOf(w.shipsWith, f.supplier);
  if (fab) basis += `; rides in the ${fab} order's parcel, counted as no shipping of its own (catalog.json shipsWith, an estimate)`;
  const first = l.fabs![0];
  if (f.supplier === first.supplier) return basis;
  const riders = cheapest.has(f.supplier) ? [] : shops.filter((s) => w.shipsWith?.[s] === f.supplier);
  const ride = `${riders.join(", ")} ${riders.length === 1 ? "ships" : "ship"} in its parcel`;
  return `${basis}; chosen over ${first.supplier} (${usd(first.orderUsd)}) because `
    + (riders.length && l.process === "pcb" ? ride : `the order costs less with each shop's shipping counted${riders.length ? ` (${ride})` : ""}`);
}

/** Whether `choice` buys a line from a shop riding in the parcel of the fab the order needs one in (ex.riders). */
const buysRider = (ex: Explorer, choice: number[]) =>
  ex.lines.some((l, i) => !l.made && !!l.options[choice[i]] && (ex.riders ?? []).includes(l.options[choice[i]].supplier));

/** What `sprue pick` would quote with some bought lines pinned to one offer each (line index -> option index): the
 * same search as quote.ts over every other line's offers, so a pick that brings in a shop can move other lines to
 * it; and where a pick can move a made line (ex.ways), the same over each order of the made lines the quote weighs
 * (requoteWays()). Returns the option chosen for every line (-1 for made and unpriced lines), the batch total, and
 * with ways, the order of made lines it is with (withWay()). With `riding` false, the cheapest mix whatever rides in
 * a fab's parcel, the made lines where the quote put them. */
export function requote(ex: Explorer, pins: Map<number, number>, riding = true): { choice: number[]; total: number; way?: number } {
  if (riding && ex.ways?.length) {
    const r = requoteWays(ex, pins);
    if (r) return r;
  }
  const bought = ex.lines.map((l, i) => [l, i] as const).filter(([l]) => !l.made && l.options.length);
  // Each line's offers in catalog.json's order at their prices before rounding, which choose() sorts cheapest first as
  // the quote's own lists are.
  const perLine: Option[][] = bought.map(([l, i]) => (pins.has(i) ? [pins.get(i)!] : l.offerOrder ?? l.options.map((_, j) => j))
    .filter((j) => l.options[j])
    .map((j) => ({ o: { ...l.options[j], j } as unknown as Offer, orderQty: l.options[j].orderQty, orderUsd: l.options[j].exactUsd ?? l.options[j].orderUsd })));
  // Where the order holds only with a line riding in a fab's parcel, as the quote's search buys one there (not with
  // `riding` false: the cheapest mix whatever rides).
  const picked = chooseRiding(perLine, searchShipping(ex), riding && ex.needsRider ? ex.riders ?? [] : []);
  const choice = ex.lines.map(() => -1);
  bought.forEach(([, i], k) => { choice[i] = (picked[k]?.o as unknown as { j: number })?.j ?? -1; });
  return { choice, total: totalFor(ex, choice.map((c) => Math.max(0, c))) };
}

/** requote() over each order of the made lines the quote weighs (ex.ways), as quote.ts prices them: the bought lines'
 * cheapest mix with that order's shipping and, where the order holds only with a line riding in a fab's parcel, the
 * cheapest that buys one, the order left out where none does. The cheapest is kept; of two that cost the same, the
 * one that makes fewer lines at another shop than the cheapest for each, then the one that holds with no line riding,
 * then the first. The orders are priced from the least each could come to up (its made lines and their shops'
 * shipping, and each bought line at its cheapest), none whose least is above the cheapest found by more than six
 * tenths of a cent and a billionth (where every price and shipping figure is a number of 0 or more; elsewhere every
 * order is priced), and compared in their own order, as the quote's are. None where no order holds. */
function requoteWays(ex: Explorer, pins: Map<number, number>): { choice: number[]; total: number; way: number } | undefined {
  const ways = ex.ways!;
  const bought = ex.lines.flatMap((l, i) => (!l.made && l.options.length ? [i] : []));
  const offered = (i: number) => (pins.has(i) && ex.lines[i].options[pins.get(i)!] ? [ex.lines[i].options[pins.get(i)!]] : ex.lines[i].options);
  // The shops the pins buy from: an order quote() weighs only with a line pinned to one of its shops (`when`) is
  // weighed only then.
  const pinned = new Set([...pins].flatMap(([i, j]) => (ex.lines[i]?.options[j] ? [ex.lines[i].options[j].supplier] : [])));
  const open = ways.map((w) => !w.when || w.when.some((s) => pinned.has(s)));
  const figure = (x: unknown) => typeof x === "number" && x >= 0 && Number.isFinite(x);
  const floored = ways.every((w) => Object.values(w.shipping).every(figure))
    && ex.lines.every((l) => l.options.every((o) => figure(o.orderUsd)) && (l.fabs ?? []).every((f) => figure(f.orderUsd)));
  const low = bought.reduce((t, i) => t + Math.min(...offered(i).map((o) => o.orderUsd)), 0);
  // The bought lines' shops: each order's search weighs only their shipping (none for one a made line pays) and, where
  // it needs a line riding, its riders, so orders alike in those choose alike.
  const sellers = [...new Set(bought.flatMap((i) => offered(i).map((o) => o.supplier)))];
  const sole = new Set(bought.flatMap((i) => (new Set(offered(i).map((o) => o.supplier)).size === 1 ? [offered(i)[0].supplier] : [])));
  const weighOf = (w: Explorer) => {
    const ship = searchShipping(w);
    return new Map(sellers.map((s) => [s, ship[s] ?? 0]));
  };
  // The least an order could come to: its made lines and their shops' shipping, each bought line at its cheapest, the
  // shipping of each shop alone selling a line (every order buys from it), and of the lines no such shop sells, the
  // least shipping of the shops selling the one whose sellers ship dearest (the order buys it from one of them).
  const floor = (k: number) => {
    if (!floored) return -Infinity;
    const w = withWay(ex, k), shops = new Set<string>(), weigh = weighOf(w);
    let f = low;
    for (const l of w.lines) if (l.made) { f += l.made.orderUsd; if (!l.shipsFree) shops.add(l.made.supplier); }
    for (const s of shops) if (!w.shipsWith?.[s]) f += w.shipping[s] ?? 0;
    for (const s of sole) f += weigh.get(s)!;
    let most = 0;
    for (const i of bought) if (!offered(i).some((o) => sole.has(o.supplier))) most = Math.max(most, Math.min(...offered(i).map((o) => weigh.get(o.supplier)!)));
    return f + most;
  };
  const floors = ways.map((_, k) => (open[k] ? floor(k) : Infinity));
  const priced: ({ choice: number[]; total: number; way: number } | undefined)[] = [];
  const chosen = new Map<string, number[]>();
  let least = Infinity;
  for (const k of ways.map((_, k) => k).sort((a, b) => floors[a] - floors[b] || a - b)) {
    if (!open[k]) continue;
    if (floors[k] > least + 0.006 + least * 1e-9) break;
    const w = withWay(ex, k);
    // Where it holds only with a line riding in a fab's parcel, the cheapest mix that buys one (chooseRiding()), and
    // with none to buy, not at all. An order alike to one already priced in what the search weighs chooses as it did.
    const key = JSON.stringify([[...weighOf(w).values()], w.needsRider ? w.riders ?? [] : null]);
    const was = chosen.get(key);
    const r = was ? { choice: was, total: totalFor(w, was.map((c) => Math.max(0, c))) } : requote(w, pins);
    if (!was) chosen.set(key, r.choice);
    if (w.needsRider && !buysRider(w, r.choice)) continue;
    priced[k] = { ...r, way: k };
    least = Math.min(least, r.total);
  }
  const kept = priced.flatMap((p) => (p ? [p] : []));
  if (!kept.length) return undefined;
  return kept.reduce((a, b) => {
    const [x, y] = [ways[a.way], ways[b.way]];
    return b.total < a.total - 1e-9 || (b.total <= a.total + 1e-9 && (y.moves < x.moves || (y.moves === x.moves && !!x.needsRider && !y.needsRider))) ? b : a;
  });
}

/** "est." after a shop's shipping unless catalog.json says it was read (from the shop's rates, or at its checkout). */
const est = (ex: Explorer, shop: string) =>
  rideOf(ex.shipsWith, shop) ? ` (in the ${rideOf(ex.shipsWith, shop)} parcel, est.)` : ex.shippingRead?.includes(shop) ? "" : " est.";

type CatalogFile = { shipping: Record<string, number>; shippingFirstArticle?: Record<string, number>; shippingRead?: string[];
  shippingBasis?: Record<string, string>; shipsWith?: Record<string, string>; filament?: Record<string, Filament>; offers: Record<string, Offer[]> };

/** catalog.json, with any live DigiKey offers (offers.digikey.json, from live/digikey.ts) added to it. A file with a
 * field that isn't a number where a price, quantity or charge goes, or one nothing reads, is refused (catalog.ts). */
export function loadCatalog(slug: string): CatalogFile {
  const read = <T>(file: string): T => {
    const raw = readJson<T>(slug, file);
    const { problems } = catalogProblems(raw, file);
    if (problems.length) throw new Error(catalogError(file, problems));
    return raw;
  };
  const c: CatalogFile = exists(slug, "catalog.json") ? read<CatalogFile>("catalog.json") : { shipping: {}, offers: {} };
  c.shipping ??= {};
  c.offers ??= {};
  if (exists(slug, "offers.digikey.json")) {
    const live = read<{ offers: Record<string, Offer[]> }>("offers.digikey.json").offers;
    for (const [lineId, offers] of Object.entries(live)) c.offers[lineId] = [...(c.offers[lineId] ?? []), ...offers];
    c.shipping.DigiKey ??= 7;
  }
  return c;
}

/** The print and PCB price rules in pipeline/rates.json. */
export const loadRates = () => JSON.parse(readFileSync(join(import.meta.dirname, "rates.json"), "utf8")) as FabRates;

/** The orders of the made lines the quote weighs (madeWays()), for the requote of a pick to price each as `sprue pick`
 * quotes the whole order again, each with what it does to the bought lines' shops as build() works it out for the
 * quote's own (their shipping, and which of them ride in a fab's parcel), and that one's place among them; each made
 * line's options are set on `lines` (fabs). An order that counts only where a bought line rides in its fab's parcel
 * (a try with a fab, no made line riding there) says which shops would, and is left out where none sells a line here
 * or the fab makes nothing in it. None where there is one order or none, or where the quote can't be run again (a
 * price that isn't a number, which sprue validate refuses). */
function waysOf(bom: Bom, sourced: Sourcing, rates: FabRates,
  catalog: { shipping: Record<string, number>; shipsWith?: Record<string, string>; filament?: Record<string, Filament>; offers: Record<string, Offer[]> },
  lines: ExplorerLine[], sells: Set<string>, needsRider?: string): { ways: ExplorerWay[]; quoteWay: number } | undefined {
  let m: ReturnType<typeof madeWays>;
  try {
    // The rates `sprue quote` prices with (cli.ts rates()): rates.json with catalog.json's filament and shops' quotes
    // (those `rates` has already, where it has them).
    m = madeWays(bom, sourced, { ...rates, ...(catalog.filament ? { filament: catalog.filament } : {}), shopQuotes: { ...catalog.offers, ...rates.shopQuotes } },
      catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  } catch {
    return undefined;
  }
  const index = m.lines.map((id) => lines.findIndex((l) => l.id === id));
  const shipsWith = catalog.shipsWith ?? {};
  // Each order with what it costs whatever is picked (its made lines and their shops' shipping) and what a pick's
  // requote with it turns on (`bought`): the shipping of each shop selling a bought line, or that a made line pays it,
  // which shops ride where, and the fab it needs a line riding with.
  const ways: (ExplorerWay & { fixed: number; bought: string })[] = [];
  const seen = new Map<string, number>();
  for (const w of m.ways) {
    const made = w.at.map((j, k) => m.fabs[k][j]);
    const madeBy = new Set(made.map((q) => q.supplier));
    // A shop rides in a fab's parcel where the fab makes a line here (rideAlong()) and its own shipping is not a known
    // 0, as quote.ts labels it: catalog.json's figure, or with none, for a shop making only lines not priced from
    // shops' quotes, its print rates'.
    const rides = (sup: string) => shipsWith[sup] !== undefined && shipsWith[sup] !== sup && madeBy.has(shipsWith[sup]);
    const own = (sup: string) => catalog.shipping[sup] ?? (made.every((q) => q.supplier !== sup || !q.shopQuote) ? printShipping(rates, sup) : undefined);
    let need: { needsRider: string; riders: string[] } | undefined;
    if (w.fab !== undefined && !made.some((q) => rides(q.supplier) && shipsWith[q.supplier] === w.fab && own(q.supplier) !== 0)) {
      // The shops whose bought lines would ride there, as quote.ts's priceWith() has them.
      const riders = [...sells].filter((s) => s !== w.fab && shipsWith[s] === w.fab && catalog.shipping[s] !== 0);
      if (!madeBy.has(w.fab) || !riders.length) continue;
      need = { needsRider: w.fab, riders };
    }
    // An order weighed only with some pins and one weighed whatever is pinned are kept apart, each in its place; two
    // weighed only with some pins, as one weighed with a pin to a shop of either.
    const key = JSON.stringify([w.at, need?.needsRider ?? null]), was = seen.get(JSON.stringify([key, !!w.when]));
    if (was !== undefined) {
      if (w.when) ways[was].when = [...new Set([...ways[was].when!, ...w.when])];
      continue;
    }
    seen.set(JSON.stringify([key, !!w.when]), ways.length);
    // The shipping as build() works it out for the quote's made lines: catalog.json's figures, a made line's shop with
    // none at its print rates' (none for a shop whose quote prices a made part), a shop a pick can bring in with none
    // at its print rates', and none for a shop riding in a fab's parcel.
    // Of the shops selling or making a line here: a comment in catalog.json's shipping (a key starting with "_") is
    // none, nor is a shop this order can't buy from.
    const shipping: Record<string, number> = Object.fromEntries(Object.entries(catalog.shipping).filter(([shop]) => sells.has(shop) || madeBy.has(shop)));
    const quotedFrom = new Set(made.filter((q) => q.shopQuote).map((q) => q.supplier));
    made.forEach((q, k) => { if (lines[index[k]].process !== "pcb") shipping[q.supplier] ??= quotedFrom.has(q.supplier) ? 0 : printShipping(rates, q.supplier); });
    for (const shop of sells) if (!Object.hasOwn(shipping, shop) && !quotedFrom.has(shop) && printShipping(rates, shop)) shipping[shop] = printShipping(rates, shop);
    const riding: Record<string, string> = {};
    for (const shop of new Set([...sells, ...madeBy])) {
      if (!rides(shop)) continue;
      shipping[shop] = 0;
      // A shop rides where its own figure is not a known 0, as quote.ts labels the order's shops: one making a line
      // here, as its made lines say (the order may buy from it too, or not); one only selling a line here, catalog.json's.
      if (madeBy.has(shop) ? own(shop) !== 0 : catalog.shipping[shop] !== 0) riding[shop] = shipsWith[shop];
    }
    // One making a line here at print rates of 0, with no figure in catalog.json, which quote.ts labels riding only
    // where the order buys a line from it too (that line is no made line, so its own figure is not a known 0).
    const ridesIfSells: Record<string, string> = {};
    for (const shop of madeBy)
      if (rides(shop) && !Object.hasOwn(riding, shop) && sells.has(shop) && !Object.hasOwn(catalog.shipping, shop)) ridesIfSells[shop] = shipsWith[shop];
    const at = lines.map(() => -1);
    index.forEach((i, k) => { at[i] = w.at[k]; });
    // A made line's shop pays its shipping whatever is picked, but a board fab's (in the board's price) and home's.
    const pays = new Set(made.filter((q, k) => lines[index[k]].process !== "pcb" && q.supplier !== HOME).map((q) => q.supplier));
    const fixed = made.reduce((t, q) => t + q.orderUsd, 0) + [...pays].reduce((t, s) => t + (shipping[s] ?? 0), 0);
    const bought = JSON.stringify([[...sells].sort().map((s) => [pays.has(s) ? "paid" : shipping[s] ?? null, riding[s] ?? null]), need ?? null]);
    ways.push({ at, moves: made.filter((q, k) => q.supplier !== m.fabs[k][0].supplier).length, ...need, shipping,
      ...(Object.keys(riding).length ? { shipsWith: riding } : {}), ...(Object.keys(ridesIfSells).length ? { ridesIfSells } : {}),
      ...(w.when ? { when: [...w.when] } : {}), fixed, bought });
  }
  // The quote's own: each made line as quotes.json has it, and its needsRider.
  const isQuote = (w: (typeof ways)[number]) => w.needsRider === needsRider
    && index.every((i) => lines[i].made?.supplier === m.fabs[index.indexOf(i)][w.at[i]].supplier && lines[i].made?.sku === m.fabs[index.indexOf(i)][w.at[i]].sku);
  // The quote weighs its own unpinned: the one weighed whatever is pinned, where the same made lines are also a tie.
  const quoteWay = ways.findIndex((w) => !w.when && isQuote(w)) >= 0 ? ways.findIndex((w) => !w.when && isQuote(w)) : ways.findIndex(isQuote);
  // The quote's own is weighed whatever is pinned.
  if (quoteWay >= 0) delete ways[quoteWay].when;
  // Of orders a pick's requote prices alike (the same `bought`), every pick costs the same more with each, so only the
  // cheapest can be the one kept, and those within a cent and a tenth of it, which can round to the same total and win
  // on fewer lines moved; the quote's own stays. An order weighed only with some pins (`when`) is weighed against the
  // orders weighed whatever is pinned and those weighed with the same pins, not the others.
  const least = new Map<string, number>();
  const group = (w: (typeof ways)[number]) => JSON.stringify([w.bought, w.when ? [...w.when].sort() : null]);
  for (const w of ways) least.set(group(w), Math.min(least.get(group(w)) ?? Infinity, w.fixed));
  const floorOf = (w: (typeof ways)[number]) => Math.min(least.get(group(w))!, least.get(JSON.stringify([w.bought, null])) ?? Infinity);
  const kept = ways.flatMap((w, k) => (k === quoteWay || w.fixed <= floorOf(w) + 0.011 ? [k] : []));
  if (kept.length < 2) return undefined;
  // Each made line's options the kept orders use, in the quote's order, and the orders pointing at them; and its
  // cheapest (the quote's first), whose shop the quote says why a line is not at (withWay()).
  const used = index.map((_, k) => [...new Set([0, ...kept.map((j) => ways[j].at[index[k]])])].sort((a, b) => a - b));
  index.forEach((i, k) => {
    lines[i].fabs = used[k].map((j) => m.fabs[k][j]).map((q) => ({ supplier: q.supplier, sku: q.sku, orderQty: q.orderQty, orderUsd: q.orderUsd,
      leadDays: q.leadDays, mode: q.mode, basis: q.basis, ...(q.shopQuote ? { quoted: true } : {}) }));
  });
  const out = kept.map((j): ExplorerWay => {
    const w = ways[j], at = w.at.slice();
    index.forEach((i, k) => { at[i] = used[k].indexOf(w.at[i]); });
    return { at, moves: w.moves, ...(w.needsRider ? { needsRider: w.needsRider, riders: w.riders } : {}), shipping: w.shipping, ...(w.shipsWith ? { shipsWith: w.shipsWith } : {}),
      ...(w.ridesIfSells ? { ridesIfSells: w.ridesIfSells } : {}), ...(w.when ? { when: w.when } : {}) };
  });
  return { ways: out, quoteWay: kept.indexOf(quoteWay) };
}

/** Everything the page shows. Only bom.json is needed: before the quote (stage 3) the lines have no offers. With
 * `handoff`, the made parts' hand-off too (handoffView, a second or more: it checks the part files as sprue handoff
 * does), as explorer.json and the page have it; the commands that print the BOM or the shops leave it out. */
export function build(slug: string, rates: FabRates,
  catalog: { shipping: Record<string, number>; shippingRead?: string[]; shipsWith?: Record<string, string>; filament?: Record<string, Filament>;
    offers: Record<string, Offer[]> },
  { quiet = false, handoff = false, ways: withWays = true } = {}): Explorer {
  const req = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : undefined;
  const bom = readJson<Bom>(slug, "bom.json");
  const limits = limitsOf({ request: req, design, bom });
  // One the page can't read is none here: the gates say why, and sprue all writes it again.
  const quotes = readQuotes(productDir(slug));
  const checks: Pick<Checks, "checks" | "unscoped"> = exists(slug, "checks.json") ? readJson<Checks>(slug, "checks.json") : { checks: [] };
  const shipping: Record<string, number> = quotes ? { ...catalog.shipping } : {};
  // The same offers the quote saw: sourcing drops what is out of stock or short of the batch's need.
  const sourced = source(bom, quotes ? catalog.offers : {});
  const units = req?.units ?? bom.units;
  const quotedFrom = new Set((quotes?.lines ?? []).filter((x) => x.shopQuote).map((x) => x.supplier));
  const lines: ExplorerLine[] = bom.lines.map((l) => {
    const q = quotes?.lines.find((x) => x.lineId === l.id);
    const base = { id: l.id, name: l.name, shortName: l.shortName, role: l.role, process: l.process, qtyPerUnit: l.qtyPerUnit,
      needQty: batchNeed(l, bom.units), spares: l.spares, qtyPerBatch: l.qtyPerBatch, spec: l.spec,
      mpn: l.mpn, notes: l.notes, file: l.file, pin: l.pin };
    if (l.process !== "buy") {
      // As quote.ts counts it: rates.json's print shipping is not that of a shop whose quote prices a made part.
      if (q && l.process !== "pcb") shipping[q.supplier] ??= quotedFrom.has(q.supplier) ? 0 : printShipping(rates, q.supplier);
      return { ...base, options: [], chosen: -1, shipsFree: l.process === "pcb" || q?.supplier === HOME,
        made: q ? { supplier: q.supplier, sku: q.sku, orderQty: q.orderQty, orderUsd: q.orderUsd, leadDays: q.leadDays, mode: q.mode, basis: q.basis,
          ...(q.shopQuote ? { quoted: true } : {}) } : undefined };
    }
    if (!quotes) return { ...base, options: [], chosen: -1 };
    const s = sourced.lines.find((x) => x.lineId === l.id);
    const offered = options(l, base.needQty, s?.offers ?? []);
    const listed = offered.map((x) => ({ supplier: x.o.supplier, sku: x.o.sku, mpn: x.o.mpn, url: x.o.url, packSize: x.o.packSize,
      unitUsd: round(x.orderUsd / x.orderQty), orderQty: x.orderQty, orderUsd: round(x.orderUsd),
      ...(x.orderUsd !== round(x.orderUsd) ? { exactUsd: x.orderUsd } : {}), stock: x.o.stock,
      leadDays: x.o.leadDays, source: x.o.source, capturedAt: x.o.capturedAt }));
    // Cheapest first, as the quote's search takes them: by the price before rounding, and on a tie in catalog.json's
    // order. That order is kept too where it differs, as the search meets the shops in it, which decides a tie.
    const opts = offered.map((_, k) => k).sort((a, b) => offered[a].orderUsd - offered[b].orderUsd).map((k) => listed[k]);
    const order = listed.map((o) => opts.indexOf(o));
    const chosen = q ? opts.findIndex((o) => o.supplier === q.supplier && o.sku === q.sku) : -1;
    return { ...base, options: opts, chosen, ...(order.some((k, i) => k !== i) ? { offerOrder: order } : {}),
      sourceNote: s?.note && s.note !== "no offer found" ? s.note : undefined };
  });
  // As quote.ts counts it: a shop whose parts ride in a fab's parcel adds no shipping, and its lines say so (not one
  // whose own shipping is a known 0, which riding saves none).
  const rides: Record<string, string> = Object.fromEntries((quotes?.lines ?? []).filter((x) => x.shipsWith).map((x) => [x.supplier, x.shipsWith!]));
  // A pick moves only bought lines, so the made ones stay at the fabs the quote put them at: a shop that rides with one
  // of them (catalog.json shipsWith, as rideAlong has it) adds no shipping whichever of its offers is picked, here or
  // with `sprue pick`. One the order buys nothing from rides with the same words where a pick there would put them on
  // its lines: where its own figure in catalog.json is not a known 0 (it has a bought line then, so no print rate is
  // its own).
  const madeBy = new Set(lines.flatMap((l) => (l.made ? [l.made.supplier] : [])));
  const inOrder = new Set((quotes?.lines ?? []).map((x) => x.supplier));
  const sells = new Set(lines.flatMap((l) => l.options.map((o) => o.supplier)));
  // A shop a pick can bring in with no figure in catalog.json: as for a made line above, a print service's from
  // rates.json (none for a shop whose quote prices a made part here).
  for (const shop of sells) if (!Object.hasOwn(shipping, shop) && !quotedFrom.has(shop) && printShipping(rates, shop)) shipping[shop] = printShipping(rates, shop);
  for (const [shop, fab] of Object.entries(catalog.shipsWith ?? {}))
    if (shop !== fab && madeBy.has(fab) && sells.has(shop) && !inOrder.has(shop)) {
      shipping[shop] = 0;
      if (catalog.shipping[shop] !== 0) rides[shop] = fab;
    }
  for (const shop of Object.keys(rides)) shipping[shop] = 0;
  // Where the order needs a line riding in a fab's parcel, the shops the quote counts as riding there: each that sells
  // a line here and rides with it (catalog.json shipsWith), its own figure not a known 0, labelled in the order or not
  // (a board fab in it with no figure is not).
  const need = quotes?.needsRider;
  const riders = need ? [...sells].filter((s) => s !== need && catalog.shipsWith?.[s] === need && catalog.shipping[s] !== 0) : [];
  // Each order of the made lines the quote weighs, for a pick's requote (not for the commands that print the BOM or
  // the shops without one: it runs the quote again).
  const ways = quotes && withWays ? waysOf(bom, sourced, rates, catalog, lines, sells, quotes.needsRider) : undefined;
  const dir = productDir(slug);
  const previewDir = join(dir, "previews");
  const previews = existsSync(previewDir)
    ? readdirSync(previewDir).filter((f) => f.endsWith(".svg")).sort()
        .map((f) => ({ name: f.replace(/\.svg$/, ""), svg: readFileSync(join(previewDir, f), "utf8") }))
    : [];
  const text = (f: string) => (exists(slug, f) ? readFileSync(join(dir, f), "utf8") : undefined);
  type FigureFile = { caption?: string; steps?: { n: number; text: string; lines: string[] }[]; hidden?: Record<string, string>;
    coverage?: Record<string, { drawn: number; needed: number }> };
  const fig = exists(slug, "figure.json") ? readJson<FigureFile>(slug, "figure.json") : undefined;
  const score = exists(slug, "score.json") ? withSystem(readJson<Score>(slug, "score.json"), dir, bom) : undefined;
  // A shop's figure is read as quote.ts counts it: catalog.json gives it and lists the shop in shippingRead, so not a
  // print service's rates.json figure or the 0 above for a quoting shop with none. It is the shop's whichever offer is
  // picked, as `sprue pick` would quote it; the page's words for the order count only the shops it charges shipping
  // for. A read figure of a shop with a shop's quote in catalog.json may be its checkout's, as the quote words it.
  const read = quotes ? (catalog.shippingRead ?? []).filter((sup) => Object.hasOwn(catalog.shipping ?? {}, sup)) : [];
  const quoting = new Set(Object.values(catalog.offers).flat().filter((o) => o?.shopQuote).map((o) => o.supplier));
  const atCheckout = read.filter((sup) => quoting.has(sup));
  const ex: Explorer = {
    slug, product: req?.product || slug, brief: req?.brief ?? "", units, region: req?.region ?? "", budgetUsd: req?.budgetUsd,
    summary: design?.summary ?? "", architecture: design?.architecture ?? [], params: design?.params ?? {}, assembly: design?.assembly ?? [],
    lines, shipping,
    ...(Object.keys(rides).length ? { shipsWith: rides } : {}),
    ...(need ? { needsRider: need, riders } : {}),
    ...(ways ? { ways: ways.ways, ...(ways.quoteWay >= 0 ? { quoteWay: ways.quoteWay } : {}) } : {}),
    shippingRead: read.length ? read : undefined,
    ...(atCheckout.length ? { shippingAtCheckout: atCheckout } : {}),
    ...(quotes ? {} : { quoted: false as const }),
    totals: quotes
      ? { batchUsd: quotes.batchUsd, perUnitUsd: quotes.perUnitUsd, longestLeadDays: quotes.longestLeadDays, unquoted: quotes.unquoted }
      : { batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [] },
    phases: quotes?.phases?.map((p) => ({ name: p.name, units: p.units, batchUsd: p.batchUsd, longestLeadDays: p.longestLeadDays,
      file: `production/order-${p.name.toLowerCase()}.csv` })),
    handoff: quotes && handoff ? handoffView(dir, bom, exists(slug, "checks.json") ? checks as Checks : undefined) : undefined,
    costNotes: design?.costNotes?.length ? design.costNotes : undefined,
    estimates: design?.estimates?.length ? design.estimates : undefined,
    limits: limits.length ? limits : undefined,
    ...(exampleOf(dir, slug) ? { buildReport: reportUrl(slug) } : {}),
    checks: checks.checks,
    inspect: inspectOf(slug, bom, checks, score),
    score,
    previews, designMd: text("design.md"), buildPlanMd: text("build-plan.md"),
    figure: fig?.steps ? { caption: fig.caption ?? "", steps: fig.steps, hidden: fig.hidden ?? {}, coverage: fig.coverage ?? {} } : undefined,
    state: exists(slug, "state.json") ? readState(slug) : undefined,
    generatedAt: new Date().toISOString(),
  };
  if (quotes && !quiet) {
    const recomputed = totalFor(ex, lines.map((l) => Math.max(0, l.chosen)));
    if (Math.abs(recomputed - quotes.batchUsd) > 0.011)
      console.warn(`explorer total ${usd(recomputed)} differs from quotes.json ${usd(quotes.batchUsd)}; rerun \`sprue all ${slug}\``);
  }
  return ex;
}

// ---- text views -----------------------------------------------------------------------------

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

export function printBom(ex: Explorer, lineId?: string) {
  if (lineId) return printLine(ex, lineId);
  const groups: [string, ExplorerLine[]][] = [
    ["Bought", ex.lines.filter((l) => l.process === "buy")],
    ["Made", ex.lines.filter((l) => l.process !== "buy")],
  ];
  console.log(`${ex.product}: ${ex.units} unit(s), ${usd(ex.totals.batchUsd)} all in (${usd(ex.totals.perUnitUsd)} each)\n`);
  for (const [title, ls] of groups) {
    if (!ls.length) continue;
    console.log(`${title}`);
    console.log(`  ${pad("line", 10)} ${pad("part", 34)} ${pad("qty", 9)} ${pad("from", 18)} ${"cost".padStart(9)}  options`);
    for (const l of ls) {
      const o = l.made ?? (l.chosen >= 0 ? l.options[l.chosen] : undefined);
      const qty = `${l.needQty}${o && o.orderQty !== l.needQty ? `→${o.orderQty}` : ""}`;
      const more = l.made ? l.made.mode : `${l.options.length}${l.pin ? " (pinned)" : ""}`;
      console.log(`  ${pad(l.id, 10)} ${pad(l.name, 34)} ${pad(qty, 9)} ${pad(o?.supplier ?? "not priced", 18)} ${(o ? usd(o.orderUsd) : "–").padStart(9)}  ${more}`);
    }
    console.log("");
  }
  const shops = new Set(ex.lines.map((l) => (l.made && !l.shipsFree ? l.made.supplier : l.chosen >= 0 ? l.options[l.chosen].supplier : "")).filter(Boolean));
  // Whether any shop the order charges shipping for (not one riding in another's parcel) had its figure read.
  const anyRead = [...shops].some((s) => !ex.shipsWith?.[s] && ex.shippingRead?.includes(s));
  console.log(`Shipping: ${[...shops].map((s) => `${s} ${usd(ex.shipping[s] ?? 0)}${est(ex, s)}`).join(", ")}${anyRead ? "" : " (estimates: no shop's rate was read)"}`);
  if (ex.totals.unquoted.length) console.log(`Not priced: ${ex.totals.unquoted.join(", ")}`);
  if (ex.phases?.length)
    console.log(`In two orders (first article): ${ex.phases.map((p) => `order ${p.name}, ${p.units} unit(s), ${usd(p.batchUsd)}`).join("; ")}. \`sprue package\` writes them to production/.`);
  console.log(`\nOne line in detail: sprue bom ${ex.slug} <line>. Pick a supplier: sprue pick ${ex.slug} <line> <supplier>.`);
}

function printLine(ex: Explorer, id: string) {
  const l = ex.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line "${id}" in ${ex.slug}; lines: ${ex.lines.map((x) => x.id).join(", ")}`);
  console.log(`${l.name} (${l.id}, ${l.role}, ${l.process})`);
  const per = l.qtyPerBatch !== undefined ? `${l.qtyPerBatch} for the batch` : `${l.qtyPerUnit} per unit x ${ex.units}`;
  console.log(`  ${per}${l.spares ? ` + ${l.spares} spare(s)` : ""} = ${l.needQty}${l.mpn ? `, MPN ${l.mpn}` : ""}`);
  for (const [k, v] of Object.entries(l.spec)) console.log(`  ${k}: ${v}`);
  if (l.notes) console.log(`  note: ${l.notes}`);
  if (l.made) {
    console.log(`\n  Made by ${l.made.supplier}: ${l.made.sku}, ${l.made.orderQty} for ${usd(l.made.orderUsd)}, ${l.made.leadDays} d [${l.made.mode}]`);
    console.log(`  ${l.made.basis}`);
    if (l.file) console.log(`  file: products/${ex.slug}/${l.file}`);
    return;
  }
  console.log(`\n  Offers for the batch, cheapest first${l.pin ? ` (pinned to ${l.pin.supplier}${l.pin.sku ? ` ${l.pin.sku}` : ""})` : ""}:`);
  const at = ex.lines.indexOf(l);
  const base = ex.totals.batchUsd;
  // The shops the order already pays shipping to, or buys from in another's parcel: a pick there adds none, whether
  // another line, this one (another of its shop's offers) or a made line (not a board, whose shipping is in its price)
  // goes there.
  const inOrder = new Set(ex.lines.flatMap((x) => (x.made ? (x.shipsFree ? [] : [x.made.supplier])
    : x.chosen >= 0 && x.options[x.chosen] ? [x.options[x.chosen].supplier] : [])));
  l.options.forEach((o, i) => {
    const mark = i === l.chosen ? "●" : "○";
    const pack = o.packSize ? `, packs of ${o.packSize}` : "";
    console.log(`  ${mark} ${pad(o.supplier, 18)} ${pad(o.sku, 26)} ${o.orderQty} x ${usd(o.unitUsd)} = ${usd(o.orderUsd).padStart(9)}${pack}, stock ${o.stock}, ${o.leadDays} d`);
    // All in: what `sprue pick` would quote, shipping and any line that follows this shop included.
    if (i !== l.chosen && l.chosen >= 0) {
      const r = requote(ex, new Map([[at, i]]));
      const d = Math.round((r.total - base) * 100) / 100;
      // The other lines it moves: bought lines to another offer, made lines to another shop or service (withWay()).
      const w = r.way === undefined ? ex : withWay(ex, r.way, r.choice);
      const moved = ex.lines.flatMap((x, k) => {
        const m = w.lines[k].made;
        if (x.made) return m && (m.supplier !== x.made.supplier || m.sku !== x.made.sku) ? [`${x.id} to ${m.supplier === x.made.supplier ? `${m.supplier} ${m.sku}` : m.supplier}`] : [];
        return k !== at && x.chosen >= 0 && r.choice[k] >= 0 && r.choice[k] !== x.chosen ? [`${x.id} to ${x.options[r.choice[k]].supplier}`] : [];
      });
      // Its shop's shipping as the order it is quoted with has it: none where it rides in a fab's parcel, and none
      // added where the quote's order pays it already or a made line moves there (but a shop riding in a fab's parcel
      // in the quote's order, which pays none there, adds its own where it no longer rides, a made line of its own
      // staying there or not).
      const madeAt = new Set(w.lines.flatMap((x, k) => (x.made && !x.shipsFree
        && !(ex.lines[k].made?.supplier === x.made.supplier && !ex.lines[k].shipsFree) ? [x.made.supplier] : [])));
      const rode = !!rideOf(ex.shipsWith, o.supplier), rides = !!rideOf(w.shipsWith, o.supplier);
      const shipNote = (!inOrder.has(o.supplier) || (rode && !rides)) && !madeAt.has(o.supplier)
        ? rides ? `, no shipping of its own${est(w, o.supplier)}`
          : `, adds ${o.supplier}'s ${usd(w.shipping[o.supplier] ?? 0)}${est(w, o.supplier)} shipping` : "";
      console.log(`      if picked: ${d >= 0 ? "+" : "−"}${usd(Math.abs(d))} on the batch, ${usd(r.total)} all in${shipNote}${moved.length ? `; also moves ${moved.join(", ")}` : ""}`);
    }
    console.log(`      ${o.url}  (${o.source}, ${o.capturedAt})`);
  });
  if (l.sourceNote) console.log(`  ${l.sourceNote}`);
  if (!l.options.length) console.log("  none yet: add offers to catalog.json");
  else if (l.chosen > 0 && l.options[l.chosen].orderUsd > l.options[0].orderUsd + 0.005)
    console.log(`\n  ${notCheapest(ex, at)}`);
}

/** Why line i's offer in the quote is not its cheapest: the shipping the cheapest one's shop would add or, where the
 * cheapest mix whatever rides buys a cheapest offer of it, a line riding in the parcel of the fab the order needs one
 * in (needsRider): this one, or another, with which the cheapest mix buys this line here. Where that mix buys a
 * dearer offer of it too, the cheapest one's shop adds shipping the order doesn't need, a line riding there or not.
 * The page's notCheapestWhy. */
function notCheapest(ex: Explorer, i: number) {
  const l = ex.lines[i], shop = l.options[l.chosen].supplier;
  const plain = ex.needsRider ? requote(ex, new Map(), false).choice[i] : l.chosen;
  const low = Math.min(...l.options.map((o) => o.orderUsd));
  if (plain === l.chosen || (l.options[plain]?.orderUsd ?? Infinity) > low + 0.005) return "The cheapest offer isn't chosen because its shop would add shipping the rest of the order doesn't need.";
  const holds = `The cheapest offer isn't chosen because the order holds only with a line riding in ${ex.needsRider}'s parcel (the quote moved a part there for a line to ride with it)`;
  const riders = new Set(ex.riders ?? []);
  if (riders.has(shop)) return `${holds}, and ${shop}'s rides in it.`;
  const riding = [...new Set(ex.lines.flatMap((x) => (!x.made && riders.has(x.options[x.chosen]?.supplier) ? [x.options[x.chosen].supplier] : [])))].join(" and ");
  return riding ? `${holds}: with a line from ${riding} riding there, the cheapest mix of shops buys this one at ${shop}.` : `${holds}.`;
}

export function printSuppliers(ex: Explorer, name?: string) {
  const bySupplier = new Map<string, { line: ExplorerLine; usd: number; chosen: boolean; url?: string }[]>();
  for (const l of ex.lines) {
    if (l.made) {
      const s = l.made.supplier;
      bySupplier.set(s, [...(bySupplier.get(s) ?? []), { line: l, usd: l.made.orderUsd, chosen: true }]);
      continue;
    }
    l.options.forEach((o, i) =>
      bySupplier.set(o.supplier, [...(bySupplier.get(o.supplier) ?? []), { line: l, usd: o.orderUsd, chosen: i === l.chosen, url: o.url }]));
  }
  const list = [...bySupplier.entries()].filter(([s]) => !name || s.toLowerCase().includes(name.toLowerCase()));
  if (!list.length) throw new Error(`no supplier matching "${name}"; suppliers: ${[...bySupplier.keys()].join(", ")}`);
  for (const [s, rows] of list.sort((a, b) => Number(b[1].some((r) => r.chosen)) - Number(a[1].some((r) => r.chosen)))) {
    const used = rows.filter((r) => r.chosen);
    const sub = used.reduce((t, r) => t + r.usd, 0);
    console.log(`${s}: ${used.length ? `${used.length} line(s) in the order, ${usd(sub)} + ${usd(ex.shipping[s] ?? 0)} shipping${rideOf(ex.shipsWith, s) ? est(ex, s) : ""}` : "not in the order"}; offers for ${rows.length} line(s)`);
    if (name || used.length)
      for (const r of rows) console.log(`  ${r.chosen ? "●" : "○"} ${pad(r.line.name, 34)} ${usd(r.usd).padStart(9)}${r.url ? `  ${r.url}` : ""}`);
  }
}

// ---- history ----------------------------------------------------------------------------------

type Snapshot = {
  at: string;
  batchUsd: number;
  lines: { id: string; name: string; supplier: string; sku: string; orderUsd: number }[];
  checks: { id: string; title: string; status: string }[];
};

function snapshotOf(ex: Explorer): Snapshot {
  return {
    at: ex.generatedAt,
    batchUsd: ex.totals.batchUsd,
    lines: ex.lines.flatMap((l) => {
      const o = l.made ?? (l.chosen >= 0 ? l.options[l.chosen] : undefined);
      return o ? [{ id: l.id, name: l.name, supplier: o.supplier, sku: o.sku, orderUsd: o.orderUsd }] : [];
    }),
    checks: ex.checks.map((c) => ({ id: c.id, title: c.title, status: c.status })),
  };
}

/** Saves a snapshot to history/ when the result differs from the last one. */
export function record(slug: string, ex: Explorer) {
  const dir = join(productDir(slug), "history");
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort();
  const snap = snapshotOf(ex);
  const same = (a: Snapshot, b: Snapshot) => JSON.stringify({ ...a, at: "" }) === JSON.stringify({ ...b, at: "" });
  if (files.length && same(JSON.parse(readFileSync(join(dir, files.at(-1)!), "utf8")), snap)) return;
  writeJson(slug, `history/${String(files.length + 1).padStart(3, "0")}.json`, snap);
}

export function printDiff(slug: string) {
  const dir = join(productDir(slug), "history");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort() : [];
  if (files.length < 2) {
    console.log(files.length
      ? `only 1 run recorded for ${slug}; change something and run \`sprue all ${slug}\` again`
      : existsSync(join(productDir(slug), "quotes.json"))
        ? `no run recorded for ${slug} yet; run \`sprue view ${slug}\` once, so a later change has a before`
        : `no run recorded for ${slug} yet: the history starts with the first quote`);
    return;
  }
  const [a, b] = files.slice(-2).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Snapshot);
  const d = Math.round((b.batchUsd - a.batchUsd) * 100) / 100;
  console.log(`run ${files.length - 1} → ${files.length}: ${usd(a.batchUsd)} → ${usd(b.batchUsd)} (${d >= 0 ? "+" : "−"}${usd(Math.abs(d))})`);
  const ids = new Set([...a.lines.map((l) => l.id), ...b.lines.map((l) => l.id)]);
  for (const id of ids) {
    const x = a.lines.find((l) => l.id === id), y = b.lines.find((l) => l.id === id);
    if (!x) console.log(`  + ${y!.name}: ${y!.supplier} ${y!.sku} ${usd(y!.orderUsd)}`);
    else if (!y) console.log(`  − ${x.name}: was ${x.supplier} ${x.sku} ${usd(x.orderUsd)}`);
    else if (x.supplier !== y.supplier || x.sku !== y.sku || x.orderUsd !== y.orderUsd || x.name !== y.name)
      console.log(`  ~ ${x.name === y.name ? y.name : `${x.name} → ${y.name}`}: ${x.supplier} ${x.sku} ${usd(x.orderUsd)} → ${y.supplier} ${y.sku} ${usd(y.orderUsd)}`);
  }
  for (const c of b.checks) {
    const before = a.checks.find((x) => x.id === c.id)?.status ?? "new";
    if (before !== c.status) console.log(`  check ${c.title}: ${before} → ${c.status}`);
  }
}

export function writeExplorer(slug: string, ex: Explorer) {
  writeJson(slug, "explorer.json", ex);
}

