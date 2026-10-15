// Everything a person looks at: the BOM with every way to buy each line, the shops in the order,
// what changed since the last run, and the data view.html (the product page) and the website render,
// which `sprue view` saves as explorer.json. Nothing here changes a price; it reads the files the
// stages wrote. Before stage 2 there is no quote yet: the data then has quoted: false and no offers.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batchNeed, exists, productDir, readJson, usd, writeJson } from "./io.ts";
import { choose, options, type Option } from "./stages/quote.ts";
import { source } from "./stages/source.ts";
import { HOME, printShipping, type FabRates, type Filament } from "./adapters/fab.ts";
import type { Bom, Checks, Design, Offer, Quotes, Request, Score } from "./types.ts";
import { readState, type State } from "./state.ts";

export type ExplorerOption = {
  supplier: string;
  sku: string;
  mpn?: string;
  url: string;
  packSize?: number;
  unitUsd: number;
  orderQty: number;
  orderUsd: number;
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
  /** Why some offers were left out (stock below the batch's need), from sourcing. */
  sourceNote?: string;
  /** Made lines: the fab quote. */
  made?: { supplier: string; sku: string; orderQty: number; orderUsd: number; leadDays: number; mode: string; basis: string };
  /** Made lines whose price already includes shipping (PCBs), or that ship nowhere (printed at home). */
  shipsFree?: boolean;
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
  /** The shops whose shipping was read from their published rates (catalog.json shippingRead); the rest are estimates. */
  shippingRead?: string[];
  /** Shops whose parts ride in the parcel of a fab that makes a line here (shop -> fab, catalog.json shipsWith):
   * their shipping is 0. */
  shipsWith?: Record<string, string>;
  /** false until quotes.json exists (stage 2): then no line has offers or a fab price yet, and totals are 0. */
  quoted?: false;
  totals: { batchUsd: number; perUnitUsd: number; longestLeadDays: number; unquoted: string[] };
  /** A first-article run (design param firstArticleUnits): order A, then order B, each in production/order-<x>.csv. */
  phases?: { name: string; units: number; batchUsd: number; longestLeadDays: number; file: string }[];
  /** Costs the quote leaves out (design.json costNotes). */
  costNotes?: string[];
  /** Numbers not from a datasheet, a page or the CAD yet (design.json estimates), shown before the design is accepted. */
  estimates?: string[];
  /** The figure's steps and which lines it leaves out, from figure.json, when the product has been drawn. */
  figure?: { caption: string; steps: { n: number; text: string; lines: string[] }[]; hidden: Record<string, string>;
    coverage: Record<string, { drawn: number; needed: number }> };
  checks: Checks["checks"];
  score?: Score;
  previews: { name: string; svg: string }[];
  designMd?: string;
  buildPlanMd?: string;
  /** The gates from state.json (design, source, build), when the run has one. Not part of the cost history. */
  state?: State;
  generatedAt: string;
};

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

/** What `sprue pick` would quote with some bought lines pinned to one offer each (line index -> option index): the
 * same search as quote.ts over every other line's offers, so a pick that brings in a shop can move other lines to
 * it. Returns the option chosen for every line (-1 for made and unpriced lines) and the batch total. */
export function requote(ex: Explorer, pins: Map<number, number>): { choice: number[]; total: number } {
  const bought = ex.lines.map((l, i) => [l, i] as const).filter(([l]) => !l.made && l.options.length);
  const perLine: Option[][] = bought.map(([l, i]) => {
    const opts = l.options.map((o, j) => ({ o: { ...o, j } as unknown as Offer, orderQty: o.orderQty, orderUsd: o.orderUsd }));
    return pins.has(i) ? [opts[pins.get(i)!]] : opts;
  });
  const picked = choose(perLine, ex.shipping);
  const choice = ex.lines.map(() => -1);
  bought.forEach(([, i], k) => { choice[i] = (picked[k]?.o as unknown as { j: number })?.j ?? -1; });
  return { choice, total: totalFor(ex, choice.map((c) => Math.max(0, c))) };
}

/** "est." after a shop's shipping unless catalog.json says it was read from the shop's rates. */
const est = (ex: Explorer, shop: string) =>
  ex.shipsWith?.[shop] ? ` (in the ${ex.shipsWith[shop]} parcel, est.)` : ex.shippingRead?.includes(shop) ? "" : " est.";

type CatalogFile = { shipping: Record<string, number>; shippingFirstArticle?: Record<string, number>; shippingRead?: string[];
  shippingBasis?: Record<string, string>; shipsWith?: Record<string, string>; filament?: Record<string, Filament>; offers: Record<string, Offer[]> };

/** catalog.json, with any live DigiKey offers (offers.digikey.json, from live/digikey.ts) added to it. */
export function loadCatalog(slug: string): CatalogFile {
  const c: CatalogFile = exists(slug, "catalog.json") ? readJson<CatalogFile>(slug, "catalog.json") : { shipping: {}, offers: {} };
  c.shipping ??= {};
  c.offers ??= {};
  if (exists(slug, "offers.digikey.json")) {
    const live = readJson<{ offers: Record<string, Offer[]> }>(slug, "offers.digikey.json").offers;
    for (const [lineId, offers] of Object.entries(live)) c.offers[lineId] = [...(c.offers[lineId] ?? []), ...offers];
    c.shipping.DigiKey ??= 7;
  }
  return c;
}

/** The print and PCB price rules in pipeline/rates.json. */
export const loadRates = () => JSON.parse(readFileSync(join(import.meta.dirname, "rates.json"), "utf8")) as FabRates;

/** Everything the page shows. Only bom.json is needed: before the quote (stage 2) the lines have no offers. */
export function build(slug: string, rates: FabRates,
  catalog: { shipping: Record<string, number>; shippingRead?: string[]; shipsWith?: Record<string, string>; offers: Record<string, Offer[]> },
  { quiet = false } = {}): Explorer {
  const req = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : undefined;
  const bom = readJson<Bom>(slug, "bom.json");
  const quotes = exists(slug, "quotes.json") ? readJson<Quotes>(slug, "quotes.json") : undefined;
  const checks = exists(slug, "checks.json") ? readJson<Checks>(slug, "checks.json") : { checks: [] };
  const shipping: Record<string, number> = quotes ? { ...catalog.shipping } : {};
  // The same offers the quote saw: sourcing drops what is out of stock or short of the batch's need.
  const sourced = source(bom, quotes ? catalog.offers : {});
  const units = req?.units ?? bom.units;
  const lines: ExplorerLine[] = bom.lines.map((l) => {
    const q = quotes?.lines.find((x) => x.lineId === l.id);
    const base = { id: l.id, name: l.name, shortName: l.shortName, role: l.role, process: l.process, qtyPerUnit: l.qtyPerUnit,
      needQty: batchNeed(l, bom.units), spares: l.spares, qtyPerBatch: l.qtyPerBatch, spec: l.spec,
      mpn: l.mpn, notes: l.notes, file: l.file, pin: l.pin };
    if (l.process !== "buy") {
      if (q && l.process !== "pcb") shipping[q.supplier] ??= printShipping(rates, q.supplier);
      return { ...base, options: [], chosen: -1, shipsFree: l.process === "pcb" || q?.supplier === HOME,
        made: q ? { supplier: q.supplier, sku: q.sku, orderQty: q.orderQty, orderUsd: q.orderUsd, leadDays: q.leadDays, mode: q.mode, basis: q.basis } : undefined };
    }
    if (!quotes) return { ...base, options: [], chosen: -1 };
    const s = sourced.lines.find((x) => x.lineId === l.id);
    const opts = options(l, base.needQty, s?.offers ?? [])
      .map((x) => ({ supplier: x.o.supplier, sku: x.o.sku, mpn: x.o.mpn, url: x.o.url, packSize: x.o.packSize,
        unitUsd: round(x.orderUsd / x.orderQty), orderQty: x.orderQty, orderUsd: round(x.orderUsd), stock: x.o.stock,
        leadDays: x.o.leadDays, source: x.o.source, capturedAt: x.o.capturedAt }))
      .sort((a, b) => a.orderUsd - b.orderUsd);
    const chosen = q ? opts.findIndex((o) => o.supplier === q.supplier && o.sku === q.sku) : -1;
    return { ...base, options: opts, chosen, sourceNote: s?.note && s.note !== "no offer found" ? s.note : undefined };
  });
  // As quote.ts counts it: a shop whose parts ride in a fab's parcel adds no shipping when that fab makes a line here.
  const madeBy = new Set(lines.flatMap((l) => (l.made ? [l.made.supplier] : [])));
  const rides = quotes ? Object.fromEntries(Object.entries(catalog.shipsWith ?? {}).filter(([, fab]) => madeBy.has(fab))) : {};
  for (const shop of Object.keys(rides)) shipping[shop] = 0;
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
  const ex: Explorer = {
    slug, product: req?.product || slug, brief: req?.brief ?? "", units, region: req?.region ?? "", budgetUsd: req?.budgetUsd,
    summary: design?.summary ?? "", architecture: design?.architecture ?? [], params: design?.params ?? {}, assembly: design?.assembly ?? [],
    lines, shipping,
    ...(Object.keys(rides).length ? { shipsWith: rides } : {}),
    shippingRead: quotes && catalog.shippingRead?.length ? catalog.shippingRead.filter((sup) => sup in shipping) : undefined,
    ...(quotes ? {} : { quoted: false as const }),
    totals: quotes
      ? { batchUsd: quotes.batchUsd, perUnitUsd: quotes.perUnitUsd, longestLeadDays: quotes.longestLeadDays, unquoted: quotes.unquoted }
      : { batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [] },
    phases: quotes?.phases?.map((p) => ({ name: p.name, units: p.units, batchUsd: p.batchUsd, longestLeadDays: p.longestLeadDays,
      file: `production/order-${p.name.toLowerCase()}.csv` })),
    costNotes: design?.costNotes?.length ? design.costNotes : undefined,
    estimates: design?.estimates?.length ? design.estimates : undefined,
    checks: checks.checks,
    score: exists(slug, "score.json") ? readJson<Score>(slug, "score.json") : undefined,
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
  console.log(`Shipping: ${[...shops].map((s) => `${s} ${usd(ex.shipping[s] ?? 0)}${est(ex, s)}`).join(", ")}${ex.shippingRead?.length ? "" : " (estimates: no shop's rate was read)"}`);
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
  l.options.forEach((o, i) => {
    const mark = i === l.chosen ? "●" : "○";
    const pack = o.packSize ? `, packs of ${o.packSize}` : "";
    console.log(`  ${mark} ${pad(o.supplier, 18)} ${pad(o.sku, 26)} ${o.orderQty} x ${usd(o.unitUsd)} = ${usd(o.orderUsd).padStart(9)}${pack}, stock ${o.stock}, ${o.leadDays} d`);
    // All in: what `sprue pick` would quote, shipping and any line that follows this shop included.
    if (i !== l.chosen && l.chosen >= 0) {
      const r = requote(ex, new Map([[at, i]]));
      const d = Math.round((r.total - base) * 100) / 100;
      const moved = ex.lines.flatMap((x, k) => (k !== at && !x.made && x.chosen >= 0 && r.choice[k] >= 0 && r.choice[k] !== x.chosen
        ? [`${x.id} to ${x.options[r.choice[k]].supplier}`] : []));
      const shipNote = !ex.lines.some((x, k) => k !== at && !x.made && x.chosen >= 0 && x.options[x.chosen].supplier === o.supplier)
        ? ex.shipsWith?.[o.supplier] ? `, no shipping of its own${est(ex, o.supplier)}`
          : `, adds ${o.supplier}'s ${usd(ex.shipping[o.supplier] ?? 0)}${est(ex, o.supplier)} shipping` : "";
      console.log(`      if picked: ${d >= 0 ? "+" : "−"}${usd(Math.abs(d))} on the batch, ${usd(r.total)} all in${shipNote}${moved.length ? `; also moves ${moved.join(", ")}` : ""}`);
    }
    console.log(`      ${o.url}  (${o.source}, ${o.capturedAt})`);
  });
  if (l.sourceNote) console.log(`  ${l.sourceNote}`);
  if (!l.options.length) console.log("  none yet: add offers to catalog.json");
  else if (l.chosen > 0 && l.options[l.chosen].orderUsd > l.options[0].orderUsd + 0.005)
    console.log(`\n  The cheapest offer isn't chosen because its shop would add shipping the rest of the order doesn't need.`);
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
    console.log(`${s}: ${used.length ? `${used.length} line(s) in the order, ${usd(sub)} + ${usd(ex.shipping[s] ?? 0)} shipping${ex.shipsWith?.[s] ? est(ex, s) : ""}` : "not in the order"}; offers for ${rows.length} line(s)`);
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

