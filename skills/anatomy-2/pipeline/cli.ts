// The Anatomy 2.0 command line. One command per stage, so a person (or Claude) can run a
// stage, read what it wrote, change an input and run it again. Products live in
// ./products/<slug>/ under the current folder. The /anatomy-2 skill runs it as
// ${CLAUDE_SKILL_DIR}/bin/anatomy; inside the anatomy-2 repo it's skills/anatomy-2/bin/anatomy.
//
//   anatomy status <slug>                  the three stages, their files and gates, and what's next
//   anatomy list                           products in ./products
//   anatomy where                          where the pipeline and the worked examples live
//   design (stage 1):
//   anatomy new <slug> "<brief>"           start products/<slug>/request.json
//   anatomy validate <slug>                request, design and BOM are complete
//   anatomy cad <slug>                     build products/<slug>/cad/*.py to STL, STEP and SVG
//   anatomy check <slug>                   engineer checks (built-in rules and rules.ts)
//   anatomy figure <slug> [--draft]        draw figure.mjs to figure.svg, figure.json and figure.html (proposes the design; --draft doesn't)
//   anatomy shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]   figure.html to shots/*.png
//   source (stage 2):
//   anatomy digikey <slug>                 live DigiKey offers (needs DIGIKEY_CLIENT_ID and _SECRET)
//   anatomy source <slug>                  offers per bought line, from catalog.json
//   anatomy quote <slug>                   cheapest order, packs and shipping included (proposes the source stage)
//   anatomy pick <slug> <line> <supplier|auto> [sku]   buy a line from a given shop, then requote
//   anatomy bom <slug> [line]              the bill of materials, or one line with every offer
//   anatomy suppliers <slug> [name]        shops in the order, or one shop's offers
//   anatomy view <slug>                    view.html: an interactive page of the run
//   build (stage 3):
//   anatomy plan <slug>                    build-plan.md (proposes the build stage)
//   anatomy package <slug>                 production/: build plan, order list, fab files
//   anatomy score <slug>                   compare the run with reference/reference.json
//   gates:
//   anatomy state <slug>                   the three gates: design, source, build
//   anatomy accept <slug> [stage] [--force]   accept the current stage and move on
//   anatomy decline <slug> [stage] [why...]   decline the current stage (or the one named), with the reason
//   anatomy propose <slug> <stage>         mark a stage ready for review again, after an edit
//   after a change:
//   anatomy all <slug>                     figure, check, source, quote, plan, score, explorer.json and a history entry
//   anatomy diff <slug>                    what changed between the last two runs
//
// The judgement work is Claude's: request.json, design.json, design.md, bom.json, the CAD, figure.mjs and
// catalog.json (the /anatomy-2 skill walks through it). The commands here do the arithmetic.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { exists, productDir, readJson, usd, writeJson, writeText } from "./io.ts";
import { build, printBom, printDiff, printSuppliers, record, writeExplorer } from "./explore.ts";
import { runChecks, type Rule } from "./stages/check.ts";
import { source, type Catalog } from "./stages/source.ts";
import { quote } from "./stages/quote.ts";
import { buildPlan, type FigureStep } from "./stages/plan.ts";
import { score } from "./stages/score.ts";
import { figure, printPage, refreshFigure, shot } from "./figure.ts";
import { accept, autoPropose, decline, gateNote, printState, propose, startState } from "./state.ts";
import { printStatus } from "./status.ts";
import { printBomLines } from "./parts.ts";
import type { FabRates } from "./adapters/fab.ts";
import type { Bom, Checks, Design, Quotes, Reference, Request, Sourcing } from "./types.ts";

const root = join(import.meta.dirname, "..");
const [cmd, slug, ...rest] = process.argv.slice(2);
const commands = ["status", "new", "validate", "cad", "check", "source", "quote", "plan", "score", "all", "package",
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
    .filter((l) => /^\/\/ {3}(anatomy |[a-z][a-z ]*( \(stage \d\))?:$)/.test(l)).map((l) => l.slice(3)).join("\n");
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
    console.error("this folder looks like a product folder itself: run anatomy from the folder that holds products/");
  process.exit(1);
}

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

// ---- design: the files Claude writes, checked ------------------------------------------------

function status() {
  printStatus(slug);
}

function create(brief: string) {
  if (!brief) throw new Error('usage: anatomy new <slug> "<one-sentence request>"');
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
      if (!(l.qtyPerUnit > 0)) say("bom.json", `${l.id} has no quantity`);
      if (l.process === "pcb" && !(l.spec.widthMm && l.spec.heightMm && l.spec.layers))
        say("bom.json", `${l.id} (pcb) needs spec.widthMm, heightMm and layers to be quoted`);
      if (l.process === "print" && !(l.spec.volumeCm3 && l.spec.material)) {
        // Before `anatomy cad` has built the part there is no volume to copy in yet: that is pending, not wrong.
        if (l.spec.material && l.file && !exists(slug, l.file)) pending.push(`${l.id} (print): spec.volumeCm3 comes from \`anatomy cad ${slug}\` (${l.file} isn't built yet)`);
        else say("bom.json", `${l.id} (print) needs spec.volumeCm3 and material to be quoted`);
      }
    }
    if (!b.lines?.length) say("bom.json", "no lines");
  } else say("bom.json", "missing");
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const p of pending) console.log(`  · ${p}`);
  if (!problems.length) console.log(`request, design and BOM are complete${pending.length ? ", except the print volumes `anatomy cad` gives" : ""}`);
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

function explorer() {
  for (const f of ["request.json", "design.json", "bom.json", "quotes.json"]) need(f);
  return build(slug, rates(), catalog());
}

/** After a run: refresh explorer.json and add a history entry if anything changed. */
function snapshot() {
  const ex = explorer();
  writeExplorer(slug, ex);
  record(slug, ex);
  return ex;
}

function pick(lineId: string, supplier: string, sku?: string) {
  if (!lineId || !supplier) throw new Error("usage: anatomy pick <slug> <line> <supplier|auto> [sku]");
  need("bom.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const line = bom.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`no line "${lineId}"; lines: ${bom.lines.map((l) => l.id).join(", ")}`);
  if (line.process !== "buy") throw new Error(`${lineId} is made, not bought; change its fab in rates.json or the BOM instead`);
  if (supplier === "auto") delete line.pin;
  else {
    const offers = catalog().offers[lineId] ?? [];
    const match = offers.find((o) => o.supplier.toLowerCase() === supplier.toLowerCase() && (!sku || o.sku === sku));
    if (!match) throw new Error(`no offer for ${lineId} from "${supplier}"${sku ? ` with sku ${sku}` : ""}; offers: ${offers.map((o) => `${o.supplier} ${o.sku}`).join(", ") || "none"}`);
    line.pin = { supplier: match.supplier, ...(sku ? { sku } : {}) };
  }
  writeJson(slug, "bom.json", bom);
  console.log(supplier === "auto" ? `${lineId}: back to the cheapest mix of shops` : `${lineId}: pinned to ${line.pin!.supplier}`);
}

function quiet<T>(f: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return f(); } finally { console.log = log; }
}

function view() {
  const ex = snapshot();
  const dir = join(root, "viewer");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  // Everything inline, so the page opens from disk with no server. "</" is escaped so the data can't close the script tag.
  const js = read("explorer.js").replaceAll("</script", "<\\/script");
  const page = read("view.html")
    .replace("/*EXPLORER_CSS*/", () => read("explorer.css"))
    .replace("/*EXPLORER_JS*/", () => js)
    .replace("/*EXPLORER_DATA*/null", () => JSON.stringify(ex).replaceAll("</", "<\\/"))
    .replace("<title>Anatomy 2.0</title>", () => `<title>${ex.product.replaceAll("<", "&lt;")} · Anatomy 2.0</title>`);
  writeText(slug, "view.html", page);
  console.log(`wrote products/${slug}/view.html; open it in a browser (macOS: open products/${slug}/view.html)`);
}

switch (cmd) {
  case "status": status(); break;
  case "new": create(rest.join(" ")); break;
  case "validate": process.exitCode = validate() ? 0 : 1; break;
  case "cad": cad(); break;
  case "check": await check(); break;
  case "source": gateNote(slug, "source"); sourceStage(); break;
  case "quote": gateNote(slug, "source"); quoteStage(); break;
  case "plan": gateNote(slug, "build"); plan(); break;
  case "score": scoreStage(); break;
  case "package": gateNote(slug, "build"); packageStage(); break;
  case "bom": if (exists(slug, "quotes.json")) printBom(explorer(), rest[0]); else printBomLines(slug, rest[0]); break;
  case "suppliers": printSuppliers(explorer(), rest.join(" ") || undefined); break;
  case "pick":
    gateNote(slug, "source");
    pick(rest[0], rest[1], rest[2]);
    quiet(() => { sourceStage(); quoteStage(); plan(); });
    snapshot();
    printDiff(slug);
    break;
  case "diff": printDiff(slug); break;
  case "view": view(); break;
  case "digikey": // live offers into offers.digikey.json; needs DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET
    execFileSync(process.execPath, [...process.execArgv, join(root, "pipeline", "live", "digikey.ts"), slug], { stdio: "inherit" });
    break;
  case "figure": process.exitCode = (await figure(slug, { draft: rest.includes("--draft") })) ? 0 : 1; break;
  case "shot": process.exitCode = shot(slug, rest) ? 0 : 1; break;
  case "state": need("request.json"); printState(slug); break;
  case "accept": need("request.json"); accept(slug, rest); await refreshFigure(slug); break;
  case "decline": need("request.json"); decline(slug, rest); await refreshFigure(slug); break;
  case "propose": need("request.json"); propose(slug, rest[0]); await refreshFigure(slug); break;
  case "all": {
    // The figure first (skipped until figure.mjs exists), then the checks; sourcing, the quote and the plan only
    // once there are offers to price (stage 2 writes catalog.json). Later stages run even if a gate is open, but
    // are only proposed once the stages before them are accepted.
    let drawn = true;
    if (exists(slug, "figure.mjs")) { console.log("— design: figure"); drawn = await figure(slug, { table: false }); }
    else console.log(`— design: figure skipped, no products/${slug}/figure.mjs yet`);
    gateNote(slug, "build");
    console.log("— design: check"); await check();
    if (exists(slug, "catalog.json") || exists(slug, "offers.digikey.json")) {
      console.log("— source: offers"); sourceStage();
      console.log("— source: quote"); quoteStage();
      console.log("— build: plan"); plan();
      scoreStage();
      snapshot();
    } else console.log(`— source and build: skipped, no products/${slug}/catalog.json yet (stage 2 writes it once the design is accepted)`);
    await refreshFigure(slug); // the page picks up the new prices and gates
    printPage(slug);
    if (!drawn) { console.log(`figure: fix the problems above, then run \`anatomy figure ${slug}\``); process.exitCode = 1; }
    break;
  }
}
