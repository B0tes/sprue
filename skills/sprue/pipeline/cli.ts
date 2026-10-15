// The Sprue command line. One command per stage, so a person (or Claude) can run a
// stage, read what it wrote, change an input and run it again. Products live in
// ./products/<slug>/ under the current folder. The /sprue skill runs it as
// ${CLAUDE_SKILL_DIR}/bin/sprue; inside the sprue repo it's skills/sprue/bin/sprue.
//
//   sprue status <slug>                     the three stages, their files and gates, and what's next
//   sprue list                              products in ./products
//   sprue where                             where the pipeline and the worked examples live
//   design (stage 1):
//   sprue new <slug> '<brief>'              start products/<slug>/request.json
//   sprue validate <slug>                   request, design and BOM are complete
//   sprue cad <slug>                        build products/<slug>/cad/*.py to STL, STEP and SVG, then the board (cad/pcb.mjs) as pcb does
//   sprue pcb <slug>                        draw cad/pcb.mjs to Gerbers, drill files, a zip and drc.json, and audit it (no Python)
//   sprue check <slug>                      engineer checks (built-in rules and rules.ts)
//   sprue figure <slug> [--draft]           draw figure.mjs to figure.svg and figure.json, and write view.html (proposes the design; --draft doesn't)
//   sprue shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]      the figure on view.html to shots/*.png
//   source (stage 2):
//   sprue digikey <slug>                    live DigiKey offers (needs DIGIKEY_CLIENT_ID and _SECRET)
//   sprue source <slug>                     offers per bought line, from catalog.json
//   sprue quote <slug>                      cheapest order, packs and shipping included (proposes the source stage)
//   sprue pick <slug> <line> '<supplier>'|auto [sku]      buy a line from a given shop, then requote
//   sprue bom <slug> [line]                 the bill of materials, or one line with every offer
//   sprue suppliers <slug> [name]           shops in the order, or one shop's offers
//   sprue view <slug> [--page]              view.html: the product page, every stage so far (and explorer.json and a history entry once quoted, unless --page)
//   build (stage 3):
//   sprue plan <slug>                       build-plan.md (proposes the build stage)
//   sprue package <slug>                    production/: build plan, order list, fab files
//   sprue score <slug>                      compare the run with reference/reference.json
//   gates:
//   sprue state <slug>                      the three gates: design, source, build
//   sprue accept <slug> [stage] [--force]      accept the current stage and move on
//   sprue decline <slug> [stage] [why...]      decline the current stage (or the one named), with the reason
//   sprue propose <slug> <stage>            mark a stage ready for review again, after an edit
//   after a change:
//   sprue all <slug>                        figure, check, source, quote, plan, score, explorer.json and a history entry
//   sprue diff <slug>                       what changed between the last two runs
//
// The judgement work is Claude's: request.json, design.json, design.md, bom.json, the CAD, figure.mjs and
// catalog.json (the /sprue skill walks through it). The commands here do the arithmetic.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { batchNeed, exists, productDir, readJson, usd, writeJson, writeText } from "./io.ts";
import { build, loadCatalog, loadRates, printBom, printDiff, printSuppliers, record, writeExplorer, type Explorer } from "./explore.ts";
import { runChecks, type Rule } from "./stages/check.ts";
import { source, type Catalog } from "./stages/source.ts";
import { quote, type ShippingNotes } from "./stages/quote.ts";
import { buildPlan, type FigureStep } from "./stages/plan.ts";
import { gerbersAudit, score } from "./stages/score.ts";
import { figure, shot } from "./figure.ts";
import { pcb } from "./pcb.ts";
import { printPage, refreshPage, writePage } from "./page.ts";
import type { FabRates, Filament } from "./adapters/fab.ts";
import { accept, autoPropose, decline, gateNote, printState, propose, startState } from "./state.ts";
import { printStatus } from "./status.ts";
import { printBomLines } from "./parts.ts";
import type { Bom, Checks, Design, Phase, QuoteLine, Quotes, Reference, Request, Sourcing } from "./types.ts";

const root = join(import.meta.dirname, "..");
const [cmd, slug, ...rest] = process.argv.slice(2);
const commands = ["status", "new", "validate", "cad", "pcb", "check", "source", "quote", "plan", "score", "all", "package",
  "bom", "suppliers", "pick", "diff", "view", "digikey", "figure", "shot", "state", "accept", "decline", "propose"];
if (cmd === "where") {
  const examples = readdirSync(join(root, "examples")).map((e) => join(root, "examples", e));
  console.log(`pipeline: ${root}\nworked examples:\n${examples.map((e) => `  ${e}`).join("\n")}\nproducts: ${join(process.cwd(), "products")}`);
  process.exit(0);
}
if (cmd === "list") {
  const dir = join(process.cwd(), "products");
  const slugs = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "request.json"))) : [];
  if (!slugs.length) console.log("no products in ./products yet");
  for (const s of slugs) {
    const q = existsSync(join(dir, s, "quotes.json")) ? (JSON.parse(readFileSync(join(dir, s, "quotes.json"), "utf8")) as Quotes) : undefined;
    const r = JSON.parse(readFileSync(join(dir, s, "request.json"), "utf8")) as Request;
    console.log(`  ${s.padEnd(16)} ${(r.product || r.brief).slice(0, 48).padEnd(48)} ${q ? `${usd(q.batchUsd)} for ${q.units}` : "not quoted yet"}`);
  }
  process.exit(0);
}
if (!cmd || cmd === "help" || !commands.includes(cmd) || !slug) {
  // The usage is the comment block at the top of this file.
  const usage = readFileSync(import.meta.filename, "utf8").split("\n")
    .filter((l) => /^\/\/ {3}(sprue |[a-z][a-z ]*( \(stage \d\))?:$)/.test(l)).map((l) => l.slice(3)).join("\n");
  const known = !cmd || cmd === "help" || commands.includes(cmd);
  (known ? console.log : console.error)(`${known ? "" : `unknown command "${cmd}"\n\n`}${cmd && known && cmd !== "help" ? `${cmd} needs a product slug\n\n` : ""}usage:\n${usage}`);
  process.exit(cmd && cmd !== "help" ? 1 : 0);
}

// Every command but `new` works on a product that exists: say where it looked when it doesn't.
if (cmd !== "new" && !existsSync(productDir(slug))) {
  const dir = join(process.cwd(), "products");
  const here = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "request.json"))) : [];
  console.error(`no product "${slug}" in ${dir}` + (here.length ? ` (products here: ${here.join(", ")})` : ""));
  if (existsSync(join(process.cwd(), "request.json")))
    console.error("this folder looks like a product folder itself: run sprue from the folder that holds products/");
  process.exit(1);
}

function need(file: string) {
  if (!exists(slug, file)) {
    console.error(`products/${slug}/${file} is missing. Run \`sprue status ${slug}\` to see what's next.`);
    process.exit(1);
  }
}

// catalog.json, with live offers (written by live/digikey.ts, locally or by the quote.yml workflow) joined in.
const catalog = (): { shipping: Record<string, number>; shippingFirstArticle?: Record<string, number>; shippingRead?: string[];
  shippingBasis?: Record<string, string>; filament?: Record<string, Filament>; offers: Catalog } => loadCatalog(slug);
/** rates.json's print and PCB rules, with the product's filament prices for prints made at home. */
const rates = (): FabRates => {
  const r = loadRates();
  const filament = exists(slug, "catalog.json") ? catalog().filament : undefined;
  return filament ? { ...r, filament } : r;
};

// ---- design: the files Claude writes, checked ------------------------------------------------

function status() {
  printStatus(slug);
}

function create(brief: string) {
  if (!brief) throw new Error("usage: sprue new <slug> '<one-sentence request>'");
  if (exists(slug, "request.json")) throw new Error(`products/${slug}/request.json already exists`);
  mkdirSync(productDir(slug), { recursive: true });
  const req: Request = {
    slug, brief, product: "", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: {},
  };
  writeJson(slug, "request.json", req);
  startState(slug);
  console.log(`wrote products/${slug}/request.json with your brief. Fill in product, mustHave and constraints next.`);
}

function validate(): boolean {
  const problems: string[] = [];
  const pending: string[] = [];
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
      if (!(l.qtyPerUnit > 0) && !(l.qtyPerBatch! > 0)) say("bom.json", `${l.id} has no quantity (qtyPerUnit, or qtyPerBatch for a batch-level item)`);
      if (l.spares !== undefined && !(l.spares >= 0)) say("bom.json", `${l.id} spares must be 0 or more`);
      if (l.process === "pcb" && !(l.spec.widthMm && l.spec.heightMm && l.spec.layers))
        say("bom.json", `${l.id} (pcb) needs spec.widthMm, heightMm and layers to be quoted`);
      if (l.process === "print" && !(l.spec.volumeCm3 && l.spec.material)) {
        // Before `sprue cad` has built the part there is no volume to copy in yet: that is pending, not wrong.
        if (l.spec.material && l.file && !exists(slug, l.file)) pending.push(`${l.id} (print): spec.volumeCm3 comes from \`sprue cad ${slug}\` (${l.file} isn't built yet)`);
        else say("bom.json", `${l.id} (print) needs spec.volumeCm3 and material to be quoted`);
      }
    }
    if (!b.lines?.length) say("bom.json", "no lines");
  } else say("bom.json", "missing");
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const p of pending) console.log(`  · ${p}`);
  if (!problems.length) console.log(`request, design and BOM are complete${pending.length ? ", except the print volumes `sprue cad` gives" : ""}`);
  return !problems.length;
}

async function cad() {
  const src = join(productDir(slug), "cad");
  const parts = existsSync(src) ? readdirSync(src).filter((f) => f.endsWith(".py") && !f.startsWith("_")) : [];
  const board = existsSync(join(src, "pcb.mjs"));
  if (!parts.length && !board) throw new Error(`no CAD parts: write products/${slug}/cad/<part>.py, each with make() returning a build123d Part`);
  if (parts.length) {
    execFileSync("python3", [join(root, "cad", "build.py"), productDir(slug)], { stdio: "inherit" });
    console.log(`STL and STEP in products/${slug}/fab/, previews in products/${slug}/previews/`);
  }
  if (exists(slug, "bom.json")) {
    const bom = readJson<Bom>(slug, "bom.json");
    for (const l of bom.lines.filter((l) => l.file?.endsWith(".stl")))
      if (!exists(slug, l.file!)) console.log(`  ✗ ${l.id}: ${l.file} not built`);
  }
  // The board is code too (cad/pcb.mjs): `sprue cad` builds every fab file, so run it here as `sprue pcb` does.
  if (board && !(await pcb(slug))) process.exitCode = 1;
}

// ---- the code stages: check, source, quote, plan --------------------------------------------

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
    console.log(`  no rule applies to this product yet: write them in products/${slug}/rules.ts`);
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
    console.log(`  ${s.offers.length ? "✓" : "✗"} ${name}: ${best.join(", ") || (s.note && s.note !== "no offer found" ? `${s.note}; add another offer to catalog.json` : "no offer, add one to catalog.json")}`);
    if (s.offers.length && s.note) console.log(`      ${s.note}`);
  }
  console.log(`sourcing: ${sourcing.lines.length - sourcing.unsourced.length}/${sourcing.lines.length} bought lines have offers`);
  return sourcing;
}

function quoteStage(): Quotes {
  need("bom.json");
  need("sourcing.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const sourcing = readJson<Sourcing>(slug, "sourcing.json");
  const cat = catalog();
  const ship = cat.shipping;
  const notes: ShippingNotes = { read: cat.shippingRead, basis: cat.shippingBasis };
  const quotes = quote(bom, sourcing, rates(), ship, undefined, notes);
  // A first-article run: order A builds a few units to measure, order B buys what is still needed.
  const fa = exists(slug, "design.json") ? Number(readJson<Design>(slug, "design.json").params.firstArticleUnits ?? 0) : 0;
  if (fa > 0 && fa < bom.units) {
    // A small first order can ship for less than the whole batch: catalog.shippingFirstArticle overrides per shop.
    const a = quote(bom, sourcing, rates(), { ...ship, ...cat.shippingFirstArticle }, (l) => l.qtyPerBatch ?? l.qtyPerUnit * fa, notes);
    const got = (id: string) => a.lines.filter((q) => q.lineId === id).reduce((s, q) => s + q.orderQty, 0);
    const b = quote(bom, sourcing, rates(), ship, (l) => Math.max(0, batchNeed(l, bom.units) - got(l.id)), notes);
    const phase = (name: string, units: number, q: Quotes): Phase =>
      ({ name, units, lines: q.lines, batchUsd: q.batchUsd, longestLeadDays: q.longestLeadDays, unquoted: q.unquoted });
    quotes.phases = [phase("A", fa, a), phase("B", bom.units - fa, b)];
  }
  writeJson(slug, "quotes.json", quotes);
  const name = (id: string) => bom.lines.find((l) => l.id === id)?.name ?? id;
  const qty = (q: QuoteLine) => (q.packs ? `${q.packs} pack${q.packs === 1 ? "" : "s"} of ${q.packSize} (${q.orderQty} pcs)` : `${q.orderQty}`);
  for (const q of quotes.lines)
    console.log(`  ${usd(q.orderUsd).padStart(8)}  ` + (q.lineId.startsWith("ship:")
      ? `shipping (${q.supplier}), ${q.mode === "estimate" ? "estimate" : "read from its rates"}`
      : `${name(q.lineId)}: ${qty(q)}, ${q.sku}, from ${q.supplier} [${q.mode}]`));
  console.log(`quote: ${usd(quotes.batchUsd)} for ${quotes.units} unit(s), longest lead ${quotes.longestLeadDays} d` +
    (quotes.unquoted.length ? `, not priced: ${quotes.unquoted.join(", ")}` : ""));
  for (const p of quotes.phases ?? [])
    console.log(`  order ${p.name} (${p.units} unit(s)${p.name === "B" ? " and the spares" : ""}): ${usd(p.batchUsd)}, longest lead ${p.longestLeadDays} d`);
  if (quotes.phases) {
    const both = quotes.phases.reduce((s, p) => s + p.batchUsd, 0);
    console.log(`  two orders: ${usd(both)}, ${usd(both - quotes.batchUsd)} more than one order`);
  }
  const req = readJson<Request>(slug, "request.json");
  if (req.budgetUsd) console.log(`budget ${usd(req.budgetUsd)}: ${quotes.batchUsd <= req.budgetUsd ? "within" : "OVER"}`);
  autoPropose(slug, "source");
  return quotes;
}

function plan() {
  for (const f of ["request.json", "design.json", "bom.json", "checks.json", "quotes.json"]) need(f);
  const design = readJson<Design>(slug, "design.json");
  writeText(slug, "build-plan.md", buildPlan(readJson<Request>(slug, "request.json"), design,
    readJson<Bom>(slug, "bom.json"), readJson<Checks>(slug, "checks.json"), readJson<Quotes>(slug, "quotes.json"),
    design.assembly ?? [], exists(slug, "figure.json") ? readJson<{ steps: FigureStep[] }>(slug, "figure.json").steps : []));
  console.log(`wrote products/${slug}/build-plan.md`);
  autoPropose(slug, "build");
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
  const cell = (x: string | number | undefined) => `"${String(x ?? "").replaceAll('"', '""')}"`;
  // Type packs_to_order into a cart that sells packs; order_pcs is the pieces that buys.
  const header = ["part", "supplier", "order", "need_pcs", "order_pcs", "pack_size", "packs_to_order", "usd", "lead_days", "priced_by", "basis"];
  const csvOf = (lines: QuoteLine[]) => [header.join(",")]
    .concat(lines.map((q) => [name(q.lineId), q.supplier, q.sku, q.needQty, q.orderQty, q.packSize ?? 1, q.packs ?? q.orderQty,
      q.orderUsd.toFixed(2), q.leadDays, q.mode, q.basis].map(cell).join(",")))
    .join("\n") + "\n";
  for (const f of readdirSync(out)) if (/^order-[a-z]\.csv$/.test(f)) rmSync(join(out, f));
  writeText(slug, "production/order-list.csv", csvOf(quotes.lines));
  for (const p of quotes.phases ?? []) writeText(slug, `production/order-${p.name.toLowerCase()}.csv`, csvOf(p.lines));
  const missing: string[] = [];
  for (const l of bom.lines.filter((l) => l.file)) {
    const src = join(productDir(slug), l.file!);
    if (!existsSync(src)) { missing.push(`${l.name} (${l.file}): not generated yet`); continue; }
    // Gerbers go in only as the audit of the board as it is now passed them.
    const audited = l.file!.startsWith("pcb/") && l.file!.endsWith(".zip") ? gerbersAudit(productDir(slug)) : undefined;
    if (audited && !audited.ok) { missing.push(`${l.name} (${l.file}): ${audited.detail}`); continue; }
    copyFileSync(src, join(out, basename(src)));
    const step = src.replace(/\.stl$/, ".step");
    if (step !== src && existsSync(step)) copyFileSync(step, join(out, basename(step)));
  }
  const csvs = readdirSync(out).filter((f) => f.endsWith(".csv"));
  console.log(`wrote products/${slug}/production/: build-plan.md, ${csvs.join(", ")} and ${readdirSync(out).length - 1 - csvs.length} fab file(s)`);
  for (const m of missing) console.log(`  ✗ not packaged: ${m}`);
  console.log(`total ${usd(quotes.batchUsd)} for ${quotes.units} unit(s)` +
    (quotes.phases ? ` as one order, or ${quotes.phases.map((p) => `${usd(p.batchUsd)} (order ${p.name})`).join(" + ")} in two` : "") +
    "; nothing has been ordered");
}

function explorer() {
  for (const f of ["bom.json", "quotes.json"]) need(f);
  return build(slug, rates(), catalog());
}

/** After a run: refresh explorer.json and add a history entry if anything changed. */
function snapshot() {
  const ex = explorer();
  writeExplorer(slug, ex);
  record(slug, ex);
  return ex;
}

/** `sprue pick <slug> <line> <supplier...> [sku]`. A shop name with a space should be quoted ('Bolt Depot'), but
 * unquoted words are joined too: the whole tail as the shop, or all but the last word with the last as the sku. */
function pick(lineId: string, words: string[]) {
  if (!lineId || !words.length) throw new Error("usage: sprue pick <slug> <line> '<supplier>'|auto [sku]");
  need("bom.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const line = bom.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`no line "${lineId}"; lines: ${bom.lines.map((l) => l.id).join(", ")}`);
  if (line.process !== "buy") throw new Error(`${lineId} is made, not bought: a print goes to one service with "pin": { "supplier": "<service name>" } on its bom.json line, or to the user's own printer with { "supplier": "home" } (reference/formats.md); a PCB follows rates.json`);
  const auto = words.length === 1 && words[0] === "auto";
  if (auto) delete line.pin;
  else {
    const offers = catalog().offers[lineId] ?? [];
    const tries: [string, string | undefined][] = [[words.join(" "), undefined]];
    if (words.length > 1) tries.push([words.slice(0, -1).join(" "), words.at(-1)]);
    const found = tries.map(([supplier, sku]) => ({ sku, match: offers.find((o) => o.supplier.toLowerCase() === supplier.toLowerCase() && (!sku || o.sku === sku)) }))
      .find((t) => t.match);
    if (!found) {
      const [supplier, sku] = tries.at(-1)!;
      throw new Error(`no offer for ${lineId} from "${supplier}"${sku ? ` with sku ${sku}` : ""}; offers: ${offers.map((o) => `${o.supplier} ${o.sku}`).join(", ") || "none"}` +
        (words.length > 1 ? `. Quote a shop name with a space: sprue pick ${slug} ${lineId} '${words.join(" ")}'` : ""));
    }
    line.pin = { supplier: found.match!.supplier, ...(found.sku ? { sku: found.sku } : {}) };
  }
  writeJson(slug, "bom.json", bom);
  console.log(auto ? `${lineId}: back to the cheapest mix of shops` : `${lineId}: pinned to ${line.pin!.supplier}${line.pin!.sku ? ` ${line.pin!.sku}` : ""}`);
}

/** The flags a command takes; any other one is a mistake, so say so instead of ignoring it. */
function flags(allowed: string[], usage: string) {
  const bad = rest.filter((a) => a.startsWith("--") && !allowed.includes(a));
  if (bad.length) throw new Error(`unknown option ${bad.join(", ")}; usage: ${usage}`);
}

function quiet<T>(f: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return f(); } finally { console.log = log; }
}

/** The product page. Once there is a quote it also saves explorer.json and a history entry, as `sprue all` does,
 * unless `pageOnly` (the site's build writes the examples' pages this way, and changes no tracked file). */
function view(ex?: Explorer, pageOnly = false) {
  need("bom.json");
  const quoted = exists(slug, "quotes.json");
  if (!ex && quoted && !pageOnly) ex = snapshot();
  writePage(slug, { ex });
  console.log(`wrote products/${slug}/view.html${quoted ? "" : " (no quote yet, so Source and Build say not started)"}; open it in a browser (macOS: open products/${slug}/view.html)`);
  printPage(slug);
}

try {
switch (cmd) {
  case "status": status(); break;
  case "new": create(rest.join(" ")); break;
  case "validate": process.exitCode = validate() ? 0 : 1; break;
  case "cad": await cad(); refreshPage(slug); break;
  case "pcb": process.exitCode = (await pcb(slug)) ? 0 : 1; refreshPage(slug); break;
  case "check": await check(); refreshPage(slug); break;
  case "source": gateNote(slug, "source"); sourceStage(); refreshPage(slug); break;
  case "quote": gateNote(slug, "source"); quoteStage(); refreshPage(slug); break;
  case "plan": gateNote(slug, "build"); plan(); refreshPage(slug); break;
  case "score": scoreStage(); refreshPage(slug); break;
  case "package": gateNote(slug, "build"); packageStage(); refreshPage(slug); break;
  case "bom": if (exists(slug, "quotes.json")) printBom(explorer(), rest[0]); else printBomLines(slug, rest[0]); break;
  case "suppliers": printSuppliers(explorer(), rest.join(" ") || undefined); break;
  case "pick":
    gateNote(slug, "source");
    pick(rest[0], rest.slice(1));
    quiet(() => { sourceStage(); quoteStage(); plan(); });
    writePage(slug, { ex: snapshot() });
    printDiff(slug);
    break;
  case "diff": printDiff(slug); break;
  case "view": flags(["--page"], `sprue view ${slug} [--page]`); view(undefined, rest.includes("--page")); break;
  case "digikey": // live offers into offers.digikey.json; needs DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET
    execFileSync(process.execPath, [...process.execArgv, join(root, "pipeline", "live", "digikey.ts"), slug], { stdio: "inherit" });
    break;
  case "figure": flags(["--draft"], `sprue figure ${slug} [--draft]`); process.exitCode = (await figure(slug, { draft: rest.includes("--draft") })) ? 0 : 1; break;
  case "shot": process.exitCode = shot(slug, rest) ? 0 : 1; break;
  case "state": need("request.json"); printState(slug); break;
  // A gate changes what the page says to type, so these write it even when an older run left none (a copied product
  // from before view.html): as long as there is a figure to show.
  case "accept": need("request.json"); accept(slug, rest); refreshPage(slug, { create: true }); break;
  case "decline": need("request.json"); decline(slug, rest); refreshPage(slug, { create: true }); break;
  case "propose": need("request.json"); propose(slug, rest[0]); refreshPage(slug, { create: true }); break;
  case "all": {
    // The figure first (skipped until figure.mjs exists), then the checks; sourcing, the quote and the plan only
    // once there are offers to price (stage 2 writes catalog.json). Later stages run even if a gate is open, but
    // are only proposed once the stages before them are accepted.
    let drawn = true;
    if (exists(slug, "figure.mjs")) { console.log("· design: figure"); drawn = await figure(slug, { table: false }); }
    else console.log(`· design: figure skipped, no products/${slug}/figure.mjs yet`);
    console.log("· design: check"); await check();
    let ex: Explorer | undefined;
    if (exists(slug, "catalog.json") || exists(slug, "offers.digikey.json")) {
      console.log("· source: offers"); gateNote(slug, "source"); sourceStage();
      console.log("· source: quote"); quoteStage();
      // The plan is written ahead of its gate while the quote is open, so the page and the history stay current;
      // it is proposed only once the quote is accepted.
      console.log("· build: plan"); gateNote(slug, "build"); plan();
      scoreStage();
      ex = snapshot();
    } else console.log(`· source and build: skipped, no products/${slug}/catalog.json yet (stage 2 writes it once the design is accepted)`);
    writePage(slug, { ex }); // the page picks up the new checks, prices and gates
    printPage(slug);
    if (!drawn) { console.log(`figure: fix the problems above, then run \`sprue figure ${slug}\``); process.exitCode = 1; }
    break;
  }
}
} catch (error) {
  // A usage mistake or a file that doesn't add up: one line, no stack trace.
  console.error(`✗ ${cmd}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
