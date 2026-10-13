// Everything a person looks at after a run: the BOM with every way to buy each line, the shops
// in the order, what changed since the last run, and the explorer.json that view.html and the
// website render. Nothing here changes a price; it reads the files stages 3-6 wrote.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exists, productDir, readJson, usd, writeJson } from "./io.ts";
import { options } from "./stages/quote.ts";
import { printShipping, type FabRates } from "./adapters/fab.ts";
import type { Bom, Checks, Design, Offer, Quotes, Request, Score } from "./types.ts";

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
  role: string;
  process: string;
  qtyPerUnit: number;
  spec: Record<string, string | number>;
  mpn?: string;
  notes?: string;
  file?: string;
  pin?: { supplier: string; sku?: string };
  /** Bought lines: every offer priced for the batch, and which one the quote chose. */
  options: ExplorerOption[];
  chosen: number;
  /** Made lines: the fab quote. */
  made?: { supplier: string; sku: string; orderQty: number; orderUsd: number; leadDays: number; mode: string; basis: string };
  /** Made lines whose price already includes shipping (PCBs). */
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
  totals: { batchUsd: number; perUnitUsd: number; longestLeadDays: number; unquoted: string[] };
  checks: Checks["checks"];
  score?: Score;
  previews: { name: string; svg: string }[];
  designMd?: string;
  buildPlanMd?: string;
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

export function build(slug: string, rates: FabRates, catalog: { shipping: Record<string, number>; offers: Record<string, Offer[]> }): Explorer {
  const req = readJson<Request>(slug, "request.json");
  const design = readJson<Design>(slug, "design.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const quotes = readJson<Quotes>(slug, "quotes.json");
  const checks = exists(slug, "checks.json") ? readJson<Checks>(slug, "checks.json") : { checks: [] };
  const shipping: Record<string, number> = { ...catalog.shipping };
  const lines: ExplorerLine[] = bom.lines.map((l) => {
    const q = quotes.lines.find((x) => x.lineId === l.id);
    const base = { id: l.id, name: l.name, role: l.role, process: l.process, qtyPerUnit: l.qtyPerUnit, spec: l.spec,
      mpn: l.mpn, notes: l.notes, file: l.file, pin: l.pin };
    if (l.process !== "buy") {
      if (q && l.process !== "pcb") shipping[q.supplier] ??= printShipping(rates, q.supplier);
      return { ...base, options: [], chosen: -1, shipsFree: l.process === "pcb",
        made: q ? { supplier: q.supplier, sku: q.sku, orderQty: q.orderQty, orderUsd: q.orderUsd, leadDays: q.leadDays, mode: q.mode, basis: q.basis } : undefined };
    }
    const offers = (catalog.offers[l.id] ?? []).filter((o) => o.stock !== 0);
    const opts = options(l, bom.units, offers)
      .map((x) => ({ supplier: x.o.supplier, sku: x.o.sku, mpn: x.o.mpn, url: x.o.url, packSize: x.o.packSize,
        unitUsd: round(x.orderUsd / x.orderQty), orderQty: x.orderQty, orderUsd: round(x.orderUsd), stock: x.o.stock,
        leadDays: x.o.leadDays, source: x.o.source, capturedAt: x.o.capturedAt }))
      .sort((a, b) => a.orderUsd - b.orderUsd);
    const chosen = q ? opts.findIndex((o) => o.supplier === q.supplier && o.sku === q.sku) : -1;
    return { ...base, options: opts, chosen };
  });
  const dir = productDir(slug);
  const previewDir = join(dir, "previews");
  const previews = existsSync(previewDir)
    ? readdirSync(previewDir).filter((f) => f.endsWith(".svg")).sort()
        .map((f) => ({ name: f.replace(/\.svg$/, ""), svg: readFileSync(join(previewDir, f), "utf8") }))
    : [];
  const text = (f: string) => (exists(slug, f) ? readFileSync(join(dir, f), "utf8") : undefined);
  const ex: Explorer = {
    slug, product: req.product, brief: req.brief, units: req.units, region: req.region, budgetUsd: req.budgetUsd,
    summary: design.summary, architecture: design.architecture ?? [], params: design.params, assembly: design.assembly ?? [],
    lines, shipping,
    totals: { batchUsd: quotes.batchUsd, perUnitUsd: quotes.perUnitUsd, longestLeadDays: quotes.longestLeadDays, unquoted: quotes.unquoted },
    checks: checks.checks,
    score: exists(slug, "score.json") ? readJson<Score>(slug, "score.json") : undefined,
    previews, designMd: text("design.md"), buildPlanMd: text("build-plan.md"),
    generatedAt: new Date().toISOString(),
  };
  const recomputed = totalFor(ex, lines.map((l) => Math.max(0, l.chosen)));
  if (Math.abs(recomputed - quotes.batchUsd) > 0.011)
    console.warn(`explorer total ${usd(recomputed)} differs from quotes.json ${usd(quotes.batchUsd)}; rerun \`anatomy all ${slug}\``);
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
      const qty = `${l.qtyPerUnit * ex.units}${o && o.orderQty !== l.qtyPerUnit * ex.units ? `→${o.orderQty}` : ""}`;
      const more = l.made ? l.made.mode : `${l.options.length}${l.pin ? " (pinned)" : ""}`;
      console.log(`  ${pad(l.id, 10)} ${pad(l.name, 34)} ${pad(qty, 9)} ${pad(o?.supplier ?? "not priced", 18)} ${(o ? usd(o.orderUsd) : "–").padStart(9)}  ${more}`);
    }
    console.log("");
  }
  const shops = new Set(ex.lines.map((l) => (l.made && !l.shipsFree ? l.made.supplier : l.chosen >= 0 ? l.options[l.chosen].supplier : "")).filter(Boolean));
  console.log(`Shipping: ${[...shops].map((s) => `${s} ${usd(ex.shipping[s] ?? 0)}`).join(", ")}`);
  if (ex.totals.unquoted.length) console.log(`Not priced: ${ex.totals.unquoted.join(", ")}`);
  console.log(`\nOne line in detail: anatomy bom ${ex.slug} <line>. Pick a supplier: anatomy pick ${ex.slug} <line> <supplier>.`);
}

function printLine(ex: Explorer, id: string) {
  const l = ex.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line "${id}" in ${ex.slug}; lines: ${ex.lines.map((x) => x.id).join(", ")}`);
  console.log(`${l.name} (${l.id}, ${l.role}, ${l.process})`);
  console.log(`  ${l.qtyPerUnit} per unit x ${ex.units} = ${l.qtyPerUnit * ex.units}${l.mpn ? `, MPN ${l.mpn}` : ""}`);
  for (const [k, v] of Object.entries(l.spec)) console.log(`  ${k}: ${v}`);
  if (l.notes) console.log(`  note: ${l.notes}`);
  if (l.made) {
    console.log(`\n  Made by ${l.made.supplier}: ${l.made.sku}, ${l.made.orderQty} for ${usd(l.made.orderUsd)}, ${l.made.leadDays} d [${l.made.mode}]`);
    console.log(`  ${l.made.basis}`);
    if (l.file) console.log(`  file: products/${ex.slug}/${l.file}`);
    return;
  }
  console.log(`\n  Offers for the batch, cheapest first${l.pin ? ` (pinned to ${l.pin.supplier}${l.pin.sku ? ` ${l.pin.sku}` : ""})` : ""}:`);
  l.options.forEach((o, i) => {
    const mark = i === l.chosen ? "●" : "○";
    const pack = o.packSize ? `, packs of ${o.packSize}` : "";
    console.log(`  ${mark} ${pad(o.supplier, 18)} ${pad(o.sku, 26)} ${o.orderQty} x ${usd(o.unitUsd)} = ${usd(o.orderUsd).padStart(9)}${pack}, stock ${o.stock}, ${o.leadDays} d`);
    console.log(`      ${o.url}  (${o.source}, ${o.capturedAt})`);
  });
  if (!l.options.length) console.log("  none yet: add offers to catalog.json");
  else if (l.chosen >= 0 && l.chosen !== 0)
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
    console.log(`${s}: ${used.length ? `${used.length} line(s) in the order, ${usd(sub)} + ${usd(ex.shipping[s] ?? 0)} shipping` : "not in the order"}; offers for ${rows.length} line(s)`);
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
    console.log(`only ${files.length} run recorded for ${slug}; change something and run \`anatomy all ${slug}\` again`);
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
    else if (x.supplier !== y.supplier || x.sku !== y.sku || x.orderUsd !== y.orderUsd)
      console.log(`  ~ ${y.name}: ${x.supplier} ${x.sku} ${usd(x.orderUsd)} → ${y.supplier} ${y.sku} ${usd(y.orderUsd)}`);
  }
  for (const c of b.checks) {
    const before = a.checks.find((x) => x.id === c.id)?.status ?? "new";
    if (before !== c.status) console.log(`  check ${c.title}: ${before} → ${c.status}`);
  }
}

export function writeExplorer(slug: string, ex: Explorer) {
  writeJson(slug, "explorer.json", ex);
}

