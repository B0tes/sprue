// The Anatomy 2.0 command line. One command per stage, so a person (or Claude) can run a
// stage, read what it wrote, change an input and run it again. Products live in
// ./products/<slug>/ under the current folder. Run it as `anatomy` (on PATH while the Claude
// Code plugin is installed) or `plugin/bin/anatomy` inside the anatomy-2 repo:
//
//   anatomy status <slug>          what exists, what's next
//   anatomy new <slug> "<brief>"   stage 0: start products/<slug>/request.json
//   anatomy validate <slug>        stages 0-2: request, design and BOM are complete
//   anatomy cad <slug>             stage 1: build products/<slug>/cad/*.py to STL, STEP and SVG
//   anatomy check <slug>           stage 3: engineer checks
//   anatomy source <slug>          stage 4: offers per bought line
//   anatomy quote <slug>           stage 5: cheapest order, packs and shipping included
//   anatomy plan <slug>            stage 6: build-plan.md
//   anatomy score <slug>           compare the run with reference/reference.json
//   anatomy all <slug>             stages 3-6 and the score
//   anatomy package <slug>         production/: build plan, order list, fab files
//   anatomy digikey <slug>         live DigiKey offers (needs DIGIKEY_CLIENT_ID and _SECRET)
//   anatomy where                  where the pipeline and the worked example live
//
// Stages 0-2 are judgement work: Claude writes request.json, design.json, design.md, the CAD
// and bom.json (the /anatomy-2 skill walks through it). Stages 3-6 are code.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { exists, productDir, readJson, usd, writeJson, writeText } from "./io.ts";
import { runChecks, type Rule } from "./stages/check.ts";
import { source, type Catalog } from "./stages/source.ts";
import { quote } from "./stages/quote.ts";
import { buildPlan } from "./stages/plan.ts";
import { score } from "./stages/score.ts";
import type { FabRates } from "./adapters/fab.ts";
import type { Bom, Checks, Design, Quotes, Reference, Request, Sourcing } from "./types.ts";

const root = join(import.meta.dirname, "..");
const [cmd, slug, ...rest] = process.argv.slice(2);
const commands = ["status", "new", "validate", "cad", "check", "source", "quote", "plan", "score", "all", "package", "digikey"];
if (cmd === "where") {
  console.log(`pipeline: ${root}\nworked example: ${join(root, "examples", "macropad")}\nproducts: ${join(process.cwd(), "products")}`);
  process.exit(0);
}
if (!commands.includes(cmd) || !slug) {
  console.error(`usage: anatomy <${commands.join("|")}> <slug> [brief], or anatomy where`);
  process.exit(1);
}

const stages: { n: number; name: string; file: string }[] = [
  { n: 0, name: "request", file: "request.json" },
  { n: 1, name: "design", file: "design.json" },
  { n: 2, name: "bom", file: "bom.json" },
  { n: 3, name: "check", file: "checks.json" },
  { n: 4, name: "source", file: "sourcing.json" },
  { n: 5, name: "quote", file: "quotes.json" },
  { n: 6, name: "plan", file: "build-plan.md" },
];

function need(file: string) {
  if (!exists(slug, file)) {
    console.error(`products/${slug}/${file} is missing. Run \`anatomy status ${slug}\` to see what's next.`);
    process.exit(1);
  }
}

function catalog() {
  const c = exists(slug, "catalog.json")
    ? readJson<{ shipping: Record<string, number>; offers: Catalog }>(slug, "catalog.json")
    : { shipping: {}, offers: {} as Catalog };
  // Live offers (written by live/digikey.ts, locally or by the quote.yml workflow) join the snapshot offers.
  if (exists(slug, "offers.digikey.json")) {
    const live = readJson<{ offers: Catalog }>(slug, "offers.digikey.json").offers;
    for (const [lineId, offers] of Object.entries(live)) c.offers[lineId] = [...(c.offers[lineId] ?? []), ...offers];
    c.shipping.DigiKey ??= 7;
  }
  return c;
}

const rates = () => JSON.parse(readFileSync(join(import.meta.dirname, "rates.json"), "utf8")) as FabRates;

// ---- stages 0-2 -------------------------------------------------------------------------

function status() {
  console.log(`products/${slug}/`);
  let next: string | undefined;
  for (const s of stages) {
    const done = exists(slug, s.file);
    console.log(`  ${done ? "✓" : "○"} ${s.n} ${s.name.padEnd(8)} ${s.file}`);
    if (!done && !next) next = s.name;
  }
  const extras = ["design.md", "catalog.json", "offers.digikey.json", "reference/reference.json", "score.json"];
  for (const f of extras) if (exists(slug, f)) console.log(`  · ${f}`);
  console.log(next ? `next: ${next}` : "all stages written; edit an input and rerun `all` to iterate");
}

function create(brief: string) {
  if (!brief) throw new Error('usage: anatomy new <slug> "<one-sentence request>"');
  if (exists(slug, "request.json")) throw new Error(`products/${slug}/request.json already exists`);
  mkdirSync(productDir(slug), { recursive: true });
  const req: Request = {
    slug, brief, product: "", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: {},
  };
  writeJson(slug, "request.json", req);
  console.log(`wrote products/${slug}/request.json with your brief. Fill in product, mustHave and constraints next.`);
}

function validate(): boolean {
  const problems: string[] = [];
  const say = (file: string, msg: string) => problems.push(`${file}: ${msg}`);
  if (exists(slug, "request.json")) {
    const r = readJson<Request>(slug, "request.json");
    if (!r.product) say("request.json", "product is empty");
    if (!r.mustHave?.length) say("request.json", "mustHave is empty");
    if (!(r.units >= 1)) say("request.json", "units must be 1 or more");
  } else say("request.json", "missing");
  if (exists(slug, "design.json")) {
    const d = readJson<Design>(slug, "design.json");
    if (!d.summary) say("design.json", "summary is empty");
    if (!Object.keys(d.params ?? {}).length) say("design.json", "params is empty (checks read their numbers from here)");
    if (!d.assembly?.length) say("design.json", "assembly steps are empty");
  } else say("design.json", "missing");
  if (exists(slug, "bom.json")) {
    const b = readJson<Bom>(slug, "bom.json");
    const ids = new Set<string>();
    for (const l of b.lines ?? []) {
      if (ids.has(l.id)) say("bom.json", `duplicate line id ${l.id}`);
      ids.add(l.id);
      if (!l.role) say("bom.json", `${l.id} has no role`);
      if (!(l.qtyPerUnit > 0)) say("bom.json", `${l.id} has no quantity`);
      if (l.process === "pcb" && !(l.spec.widthMm && l.spec.heightMm && l.spec.layers))
        say("bom.json", `${l.id} (pcb) needs spec.widthMm, heightMm and layers to be quoted`);
      if (l.process === "print" && !(l.spec.volumeCm3 && l.spec.material))
        say("bom.json", `${l.id} (print) needs spec.volumeCm3 and material to be quoted`);
    }
    if (!b.lines?.length) say("bom.json", "no lines");
  } else say("bom.json", "missing");
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (!problems.length) console.log("request, design and BOM are complete");
  return !problems.length;
}

function cad() {
  const src = join(productDir(slug), "cad");
  const parts = existsSync(src) ? readdirSync(src).filter((f) => f.endsWith(".py") && !f.startsWith("_")) : [];
  if (!parts.length) throw new Error(`no CAD parts: write products/${slug}/cad/<part>.py, each with make() returning a build123d Part`);
  execFileSync("python3", [join(root, "cad", "build.py"), productDir(slug)], { stdio: "inherit" });
  console.log(`STL and STEP in products/${slug}/fab/, previews in products/${slug}/previews/`);
  if (exists(slug, "bom.json")) {
    const bom = readJson<Bom>(slug, "bom.json");
    for (const l of bom.lines.filter((l) => l.file?.endsWith(".stl")))
      if (!exists(slug, l.file!)) console.log(`  ✗ ${l.id}: ${l.file} not built`);
  }
}

// ---- stages 3-6 -------------------------------------------------------------------------

async function check(): Promise<Checks> {
  need("design.json");
  need("bom.json");
  const local = join(productDir(slug), "rules.ts");
  const extra: Rule[] = existsSync(local) ? (await import(pathToFileURL(local).href)).rules : [];
  const checks = runChecks(readJson<Design>(slug, "design.json"), readJson<Bom>(slug, "bom.json"), extra);
  writeJson(slug, "checks.json", checks);
  for (const c of checks.checks) console.log(`  ${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚑"} ${c.title}: ${c.detail}`);
  console.log(`checks: ${checks.checks.length} run, ${checks.failed} failed, ${checks.flagged} flagged`);
  if (!checks.checks.length)
    console.log("  no rule applies to this product yet: write them in products/${slug}/rules.ts (see the example's rules in the pipeline's stages/check.ts)");
  return checks;
}

function sourceStage(): Sourcing {
  need("bom.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const sourcing = source(bom, catalog().offers);
  writeJson(slug, "sourcing.json", sourcing);
  for (const s of sourcing.lines) {
    const name = bom.lines.find((l) => l.id === s.lineId)?.name ?? s.lineId;
    const best = s.offers.map((o) => `${o.supplier} ${usd(o.priceBreaks[0].unitUsd)}${o.packSize ? `/pc (pack of ${o.packSize})` : ""}`);
    console.log(`  ${s.offers.length ? "✓" : "✗"} ${name}: ${best.join(", ") || "no offer, add one to catalog.json"}`);
  }
  console.log(`sourcing: ${sourcing.lines.length - sourcing.unsourced.length}/${sourcing.lines.length} bought lines have offers`);
  return sourcing;
}

function quoteStage(): Quotes {
  need("bom.json");
  need("sourcing.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const quotes = quote(bom, readJson<Sourcing>(slug, "sourcing.json"), rates(), catalog().shipping);
  writeJson(slug, "quotes.json", quotes);
  const name = (id: string) => (id.startsWith("ship:") ? `shipping (${id.slice(5)})` : bom.lines.find((l) => l.id === id)?.name ?? id);
  for (const q of quotes.lines)
    console.log(`  ${usd(q.orderUsd).padStart(8)}  ${name(q.lineId)}: ${q.orderQty} x ${q.sku} from ${q.supplier} [${q.mode}]`);
  console.log(`quote: ${usd(quotes.batchUsd)} for ${quotes.units} unit(s), longest lead ${quotes.longestLeadDays} d` +
    (quotes.unquoted.length ? `, not priced: ${quotes.unquoted.join(", ")}` : ""));
  const req = readJson<Request>(slug, "request.json");
  if (req.budgetUsd) console.log(`budget ${usd(req.budgetUsd)}: ${quotes.batchUsd <= req.budgetUsd ? "within" : "OVER"}`);
  return quotes;
}

function plan() {
  for (const f of ["request.json", "design.json", "bom.json", "checks.json", "quotes.json"]) need(f);
  const design = readJson<Design>(slug, "design.json");
  writeText(slug, "build-plan.md", buildPlan(readJson<Request>(slug, "request.json"), design,
    readJson<Bom>(slug, "bom.json"), readJson<Checks>(slug, "checks.json"), readJson<Quotes>(slug, "quotes.json"),
    design.assembly ?? []));
  console.log(`wrote products/${slug}/build-plan.md`);
}

function scoreStage() {
  if (!exists(slug, "reference/reference.json")) {
    console.log(`no reference at products/${slug}/reference/reference.json, so nothing to score against`);
    return;
  }
  for (const f of ["bom.json", "checks.json", "quotes.json"]) need(f);
  const s = score(productDir(slug), readJson<Bom>(slug, "bom.json"), readJson<Checks>(slug, "checks.json"),
    readJson<Quotes>(slug, "quotes.json"), readJson<Reference>(slug, "reference/reference.json"));
  writeJson(slug, "score.json", s);
  console.log(`score: coverage ${s.coverage.pct}% (missing: ${s.coverage.missing.join(", ") || "none"}), ` +
    `${s.checks.failed} failed checks, cost ${s.cost.deltaPct > 0 ? "+" : ""}${s.cost.deltaPct}% vs reference, ` +
    `files ${s.files.filter((f) => f.ok).length}/${s.files.length} ok -> ${s.pass ? "PASS" : "not yet"}`);
  for (const f of s.files.filter((f) => !f.ok)) console.log(`  ✗ ${f.name}: ${f.detail}`);
}

function packageStage() {
  for (const f of ["bom.json", "quotes.json", "build-plan.md"]) need(f);
  const bom = readJson<Bom>(slug, "bom.json");
  const quotes = readJson<Quotes>(slug, "quotes.json");
  const out = join(productDir(slug), "production");
  mkdirSync(out, { recursive: true });
  copyFileSync(join(productDir(slug), "build-plan.md"), join(out, "build-plan.md"));
  const name = (id: string) => (id.startsWith("ship:") ? `Shipping (${id.slice(5)})` : bom.lines.find((l) => l.id === id)?.name ?? id);
  const cell = (x: string | number) => `"${String(x).replaceAll('"', '""')}"`;
  const csv = [["part", "supplier", "order", "qty", "usd", "lead_days", "priced_by", "basis"].join(",")]
    .concat(quotes.lines.map((q) => [name(q.lineId), q.supplier, q.sku, q.orderQty, q.orderUsd.toFixed(2), q.leadDays, q.mode, q.basis].map(cell).join(",")));
  writeText(slug, "production/order-list.csv", csv.join("\n") + "\n");
  const missing: string[] = [];
  for (const l of bom.lines.filter((l) => l.file)) {
    const src = join(productDir(slug), l.file!);
    if (!existsSync(src)) { missing.push(`${l.name} (${l.file})`); continue; }
    copyFileSync(src, join(out, basename(src)));
    const step = src.replace(/\.stl$/, ".step");
    if (step !== src && existsSync(step)) copyFileSync(step, join(out, basename(step)));
  }
  console.log(`wrote products/${slug}/production/: build-plan.md, order-list.csv and ${readdirSync(out).length - 2} fab file(s)`);
  for (const m of missing) console.log(`  ✗ not generated yet: ${m}`);
  console.log(`total ${usd(quotes.batchUsd)} for ${quotes.units} unit(s); nothing has been ordered`);
}

switch (cmd) {
  case "status": status(); break;
  case "new": create(rest.join(" ")); break;
  case "validate": process.exitCode = validate() ? 0 : 1; break;
  case "cad": cad(); break;
  case "check": await check(); break;
  case "source": sourceStage(); break;
  case "quote": quoteStage(); break;
  case "plan": plan(); break;
  case "score": scoreStage(); break;
  case "package": packageStage(); break;
  case "digikey": // live offers into offers.digikey.json; needs DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET
    execFileSync(process.execPath, [...process.execArgv, join(root, "pipeline", "live", "digikey.ts"), slug], { stdio: "inherit" });
    break;
  case "all":
    console.log("— stage 3: check"); await check();
    console.log("— stage 4: source"); sourceStage();
    console.log("— stage 5: quote"); quoteStage();
    console.log("— stage 6: plan"); plan();
    scoreStage();
    break;
}
