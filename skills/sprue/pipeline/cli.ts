// The Sprue command line. One command per stage, so a person (or Claude) can run a
// stage, read what it wrote, change an input and run it again. Products live in
// ./products/<slug>/ under the current folder. The /sprue skill runs it as
// ${CLAUDE_SKILL_DIR}/bin/sprue; inside the sprue repo it's skills/sprue/bin/sprue.
//
//   sprue status <slug>                     the four stages, their files and gates, and what's next
//   sprue list                              products in ./products
//   sprue where                             where the pipeline and the worked examples live
//   design (stage 1):
//   sprue new <slug> '<brief>'              start products/<slug>/request.json
//   sprue validate <slug>                   request, design, BOM and catalog are complete, and every price and volume is a number
//   sprue cad <slug>                        build products/<slug>/cad/*.py to STL, STEP and SVG, then the board (cad/pcb.mjs) as pcb does, read it back, and run system
//   sprue pcb <slug>                        draw cad/pcb.mjs to Gerbers, drill files, a zip, a netlist and drc.json, and audit it (no Python)
//   sprue check <slug>                      engineer checks (built-in rules and rules.ts), of each part and of the parts together; exits 1 on a failed one
//   sprue figure <slug> [--draft]           draw figure.mjs to figure.svg and figure.json, and write view.html (proposes the design; --draft doesn't)
//   sprue shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]      the figure on view.html to shots/*.png
//   inspect (stage 2):
//   sprue system <slug>                     every part in one frame (cad/_system.py): they fit, touch, keep their gaps, stand up and do their job, to system.json
//   sprue inspect <slug>                    the assembly checks, the BOM's files and the whole-product check (system, when stale); proposes inspect once they pass, else exits 1
//   source (stage 3):
//   sprue digikey <slug>                    live DigiKey offers (needs DIGIKEY_CLIENT_ID and _SECRET)
//   sprue source <slug>                     offers per bought line, from catalog.json; exits 1 when a line has none
//   sprue quote <slug>                      cheapest order, packs and shipping included (proposes the source stage); prices from the offers as they are (and rewrites sourcing.json); exits 1 when the total leaves a line out, counts a shop's shipping as $0 or can't keep a pin
//   sprue pick <slug> <line> '<supplier>'|auto [sku]      buy a line from a given shop, then requote; refuses an offer the source stage drops
//   sprue bom <slug> [line]                 the bill of materials, or one line with every offer
//   sprue suppliers <slug> [name]           shops in the order, or one shop's offers
//   sprue view <slug> [--page]              view.html: the product page, every stage so far (and explorer.json and a history entry once quoted, unless --page)
//   build (stage 4):
//   sprue plan <slug>                       build-plan.md (proposes the build stage)
//   sprue verify <slug>                     prove the board before it is packaged: the PCB audit, the read-back of the zip by gerbonara and shapely (Python), the firmware, and the order folder (pcb/order/)
//   sprue package <slug>                    production/: build plan, order list, fab files, and a keypad's firmware; refuses a failed check, a file not current, a whole product that fails its check, an order not priced whole or a plan of an earlier quote
//   sprue score <slug>                      compare the run with reference/reference.json
//   sprue faults <slug> [--keep] [--jobs n]      break copies of the product in each way reference/faults.json lists and run every gate on each: the share caught, and false alarms on the clean design, to faults.json
//   gates:
//   sprue state <slug>                      the four gates: design, inspect, source, build
//   sprue accept <slug> [stage] [--force]      accept the current stage and move on; refuses while a check fails (at design, a check of a part), a file is not current, (from inspect on) the whole product fails its check, (source, build) the order is not priced whole, or (build) the plan is of an earlier quote or production/ of other files
//   sprue decline <slug> [stage] [why...]      decline the current stage (or the one named), with the reason
//   sprue propose <slug> <stage>            mark a stage ready for review again, after an edit
//   after a change:
//   sprue all <slug>                        figure, check, inspect, source, quote, plan, score, explorer.json and a history entry; exits 1 on a failed check, a whole product that fails inspect, a line with no offer or price, a shop with no shipping figure or a pin the quote can't keep
//   sprue diff <slug>                       what changed between the last two runs
//
// The judgement work is Claude's: request.json, design.json, design.md, bom.json, the CAD, figure.mjs and
// catalog.json (the /sprue skill walks through it). The commands here do the arithmetic.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { batchNeed, errorText, exists, productDir, readJson, renamedEnv, usd, writeJson, writeText } from "./io.ts";
import { build, loadCatalog, loadRates, printBom, printDiff, printSuppliers, record, writeExplorer, type Explorer } from "./explore.ts";
import { runChecks, type Rule } from "./stages/check.ts";
import { partOf, source, type Catalog } from "./stages/source.ts";
import { quote, whyUnpriced, type ShippingNotes } from "./stages/quote.ts";
import { buildPlan, type FigureStep } from "./stages/plan.ts";
import { bomForOneUnit, designParams, firmwareShips, gerbersAudit, isBoardLine, score, systemAudit } from "./stages/score.ts";
import { acceptProblems, bomShapeProblems, FIRMWARE, fileProblems, gateProblems as gateProblemsOf, meshProblem, orderLists, planProblem, planRecord, pricingProblems, quoteInputs, wholeProduct } from "./gates.ts";
import { catalogProblems } from "./catalog.ts";
import { figure, shot } from "./figure.ts";
import { pcb } from "./pcb.ts";
import { dropStaleOrder, guardNetwork } from "./pcb/order.ts";
import { readbackAfterBuild, verify } from "./verify.ts";
import { faults } from "./faults.ts";
import { printPage, refreshPage, writePage } from "./page.ts";
import type { FabRates, Filament } from "./adapters/fab.ts";
import { accept, acceptable, autoPropose, decline, gateNote, printState, propose, readState, reopenAtInspect, startState, type Stage } from "./state.ts";
import { printStatus } from "./status.ts";
import { printBomLines } from "./parts.ts";
import type { Bom, Check, Checks, Design, Phase, QuoteLine, Quotes, Reference, Request, Sourcing } from "./types.ts";

const root = join(import.meta.dirname, "..");
// No command fetches from a fab: fetch refuses every fab's host and order call from here on (pcb/order.ts).
guardNetwork();
// A DISTINTA_* variable from before the rename is read by nothing now: say so, on stderr.
if (renamedEnv()) console.error(renamedEnv());
const [cmd, slug, ...rest] = process.argv.slice(2);
const commands = ["status", "new", "validate", "cad", "pcb", "system", "inspect", "verify", "check", "source", "quote", "plan", "score", "faults", "all", "package",
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
  shippingBasis?: Record<string, string>; shipsWith?: Record<string, string>; filament?: Record<string, Filament>; offers: Catalog } => loadCatalog(slug);
/** rates.json's print and PCB rules, with the product's filament prices for prints made at home. */
const rates = (): FabRates => {
  const r = loadRates();
  const filament = exists(slug, "catalog.json") ? catalog().filament : undefined;
  return filament ? { ...r, filament } : r;
};

// ---- design: the files Claude writes, checked ------------------------------------------------

async function status() {
  staleOrder();
  await printStatus(slug);
}

/** Removes pcb/order/ when it is of an earlier board than pcb/ holds now, and says so. */
function staleOrder() {
  const why = dropStaleOrder(productDir(slug));
  if (why) console.log(`removed products/${slug}/pcb/order/: ${why}. Run sprue verify ${slug} to write it again`);
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
  // A file that is not readable JSON, or not an object of fields, is said as that, and its fields are not read.
  const fields = <T,>(file: string): T | undefined => {
    if (!exists(slug, file)) return void say(file, "missing");
    try {
      const v = readJson<unknown>(slug, file);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
      say(file, `it is not an object of its fields, but ${JSON.stringify(v)}`);
    } catch (e) {
      say(file, `not readable JSON (${errorText(e)})`);
    }
    return undefined;
  };
  const r = fields<Request>("request.json");
  if (r) {
    if (!r.product) say("request.json", "product is empty");
    if (!r.mustHave?.length) say("request.json", "mustHave is empty");
    if (!(r.units >= 1)) say("request.json", "units must be 1 or more");
  }
  const d = fields<Design>("design.json");
  if (d) {
    if (!d.summary) say("design.json", "summary is empty");
    if (!Object.keys(d.params ?? {}).length) say("design.json", "params is empty (checks read their numbers from here)");
    if (!d.assembly?.length) say("design.json", "assembly steps are empty");
  }
  let bomRead = true;
  if (exists(slug, "bom.json")) {
    let b: Bom;
    try {
      b = readJson<Bom>(slug, "bom.json");
    } catch (e) {
      b = null as unknown as Bom;
      bomRead = false;
      say("bom.json", `not readable JSON (${errorText(e)})`);
    }
    // What no check below can read past: said alone, as each line's own checks would stop on it.
    const shape = bomShapeProblems(b);
    if (bomRead) for (const p of shape) say("bom.json", p);
    const ids = new Set<string>();
    // Quantities the quote multiplies: "2" in place of 2 is a slip it would not catch.
    const whole = (v: unknown, least: number) => typeof v === "number" && Number.isInteger(v) && v >= least;
    if (b && typeof b === "object" && !whole(b.units, 1)) say("bom.json", `units must be a whole number of units, 1 or more, not ${JSON.stringify(b.units)}`);
    for (const l of shape.length ? [] : b.lines) {
      if (ids.has(l.id)) say("bom.json", `duplicate line id ${l.id}`);
      ids.add(l.id);
      if (!l.role) say("bom.json", `${l.id} has no role`);
      for (const k of ["qtyPerUnit", "qtyPerBatch"] as const)
        if (l[k] !== undefined && !(typeof l[k] === "number" && Number.isFinite(l[k]) && l[k] >= 0)) say("bom.json", `${l.id}: ${k} must be a number of pieces, 0 or more, not ${JSON.stringify(l[k])}`);
      if (!(l.qtyPerUnit > 0) && !(l.qtyPerBatch! > 0)) say("bom.json", `${l.id} has no quantity (qtyPerUnit, or qtyPerBatch for a batch-level item)`);
      if (l.spares !== undefined && !whole(l.spares, 0)) say("bom.json", `${l.id}: spares must be a whole number of pieces, 0 or more, not ${JSON.stringify(l.spares)}`);
      // The source stage holds each offer to these (stages/source.ts).
      if (l.mpn !== undefined && typeof l.mpn !== "string") say("bom.json", `${l.id}: mpn must be the maker's part number as text, not ${JSON.stringify(l.mpn)}`);
      if (l.alternates !== undefined && !(Array.isArray(l.alternates) && l.alternates.every((a) => typeof a === "string")))
        say("bom.json", `${l.id}: alternates must be a list of part numbers as text, not ${JSON.stringify(l.alternates)}`);
      // A made part with no file has nothing to print, cut or order from.
      if (l.process !== "buy" && !l.file) say("bom.json", `${l.id} (${l.process}) names no file, so nothing would be made from it: give its file (fab/<part>.stl, or the board's zip)`);
      if (l.process === "pcb" && !(l.spec.widthMm && l.spec.heightMm && l.spec.layers))
        say("bom.json", `${l.id} (pcb) needs spec.widthMm, heightMm and layers to be quoted`);
      // The quote reads the volume as a number: "21.3" or "abc" in its place is a slip, and "abc" priced at $NaN.
      // An empty place for it (none, "", null or 0) waits for `sprue cad`.
      const vol = l.spec?.volumeCm3;
      if (l.process === "print" && ![undefined, "", null, 0].includes(vol as never) && !(typeof vol === "number" && Number.isFinite(vol) && vol > 0))
        say("bom.json", `${l.id} (print): spec.volumeCm3 must be a number of cm3 over 0, not ${JSON.stringify(vol)}`);
      else if (l.process === "print" && !(l.spec.volumeCm3 && l.spec.material)) {
        // Before `sprue cad` has built the part there is no volume to copy in yet: that is pending, not wrong.
        if (l.spec.material && l.file && !exists(slug, l.file)) pending.push(`${l.id} (print): spec.volumeCm3 comes from \`sprue cad ${slug}\` (${l.file} isn't built yet)`);
        else say("bom.json", `${l.id} (print) needs spec.volumeCm3 and material to be quoted`);
      }
    }
    if (!shape.length && !b.lines.length) say("bom.json", "no lines");
  } else say("bom.json", "missing");
  // The offers and shipping, as loadCatalog will refuse them: every price a number, every field one the quote reads.
  const notes: string[] = [];
  const bom = exists(slug, "bom.json") && bomRead ? readJson<Bom>(slug, "bom.json") : undefined;
  for (const file of ["catalog.json", "offers.digikey.json"]) {
    if (!exists(slug, file)) continue;
    let raw: unknown;
    try {
      raw = readJson<unknown>(slug, file);
    } catch (e) {
      say(file, `not readable JSON (${errorText(e)})`);
      continue;
    }
    const c = catalogProblems(raw, file, bom && !bomShapeProblems(bom).length ? bom : undefined);
    for (const x of c.problems) say(file, x);
    notes.push(...c.notes);
  }
  // A shop with no shipping figure is counted as $0 if the order buys from it (sprue quote then exits 1).
  if (exists(slug, "catalog.json") && !problems.some((p) => /^(catalog|offers\.digikey)\.json: /.test(p))) {
    try {
      const cat = catalog();
      const shops = [...new Set(Object.values(cat.offers).flat().map((o) => o.supplier))].filter((s) => !(s in cat.shipping)).sort();
      if (shops.length) notes.push(`catalog.json: shipping has no figure for ${shops.join(", ")}: an order that buys from ${shops.length === 1 ? "it" : "one"} can't be priced whole (0 for a shop that ships free)`);
    } catch { /* said above */ }
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const p of [...pending, ...notes]) console.log(`  · ${p}`);
  if (!problems.length) console.log(`request, design, BOM${exists(slug, "catalog.json") ? " and catalog" : ""} are complete${pending.length ? ", except the print volumes `sprue cad` gives" : ""}`);
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
    for (const l of bom.lines.filter((l) => l.file?.endsWith(".stl"))) {
      // The mesh audit the score runs, here too: an open or doubled mesh, or one of another volume than the line
      // prices, is said before anything is quoted or packaged from it.
      const problem = exists(slug, l.file!) ? meshProblem(productDir(slug), l) : `${l.id}: ${l.file} not built`;
      if (problem) { console.log(`  ✗ ${problem}`); process.exitCode = 1; }
    }
  }
  // The board is code too (cad/pcb.mjs): `sprue cad` builds every fab file, so run it here as `sprue pcb` does,
  // and, Python being here for the CAD, read the files back as `sprue verify` does (without its self-test).
  if (board && !(await pcb(slug))) process.exitCode = 1;
  else if (board && !readbackAfterBuild(slug)) process.exitCode = 1;
  // With every part and the board built, check them as one product (it reads the board from the zip just written).
  if (existsSync(join(src, "_system.py")) && !systemStage()) process.exitCode = 1;
}

/** `sprue system`: cad/system.py on the product, which writes system.json (and previews/system.svg). */
function systemStage(): boolean {
  if (!existsSync(join(productDir(slug), "cad", "_system.py"))) {
    console.log(`no products/${slug}/cad/_system.py: write system() there, every part in one frame (reference/formats.md), then run sprue system ${slug}`);
    return false;
  }
  console.log("· the whole product (cad/_system.py)");
  try {
    // design.json's params and bom.json for one unit, which system.json records in place of the files' own hashes: a
    // costNote, an assembly step, a pick, spares or the batch's size leave it current.
    const dir = productDir(slug);
    const env = { ...process.env, SPRUE_DESIGN_DIGEST: designParams(dir) ?? "", SPRUE_BOM_DIGEST: bomForOneUnit(dir) ?? "" };
    execFileSync("python3", [join(root, "cad", "system.py"), dir], { stdio: "inherit", env });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      console.log(`no python3 to run the whole-product check: install Python 3, then python3 -m pip install -r ${join(root, "cad", "requirements.txt")}`);
    return false; // otherwise system.py printed what failed
  }
}

/** Run `sprue system` again when system.json is missing or of an earlier design (an edit of the CAD, a param, a part
 * line or the board zip, or a file changed while it ran; not a pick): a failing gate on the files as they are would
 * only fail again. */
function systemIfStale() {
  if (!existsSync(join(productDir(slug), "cad", "_system.py")) || !exists(slug, "bom.json")) return;
  const a = systemAudit(productDir(slug), readJson<Bom>(slug, "bom.json"));
  if (!a.ok && /^(no system\.json|system\.json is of an earlier design|system\.json is not readable)/.test(a.detail)) systemStage();
}

// ---- the code stages: check, source, quote, plan --------------------------------------------

/** The engineer checks on design.json and bom.json as they are now, written to checks.json. */
async function runAll(): Promise<Checks> {
  need("design.json");
  need("bom.json");
  const local = join(productDir(slug), "rules.ts");
  const extra: Rule[] = existsSync(local) ? (await import(pathToFileURL(local).href)).rules : [];
  const checks = runChecks(readJson<Design>(slug, "design.json"), readJson<Bom>(slug, "bom.json"), extra);
  writeJson(slug, "checks.json", checks);
  return checks;
}

/** What a failed check asks of the user, after the checks are printed. */
const fixChecks = (checks: Checks) =>
  `✗ ${checks.failed} check${checks.failed === 1 ? "" : "s"} failed (${checks.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")}): ` +
  `fix the design and run it again; a check that doesn't fit this product is replaced or dropped in rules.ts, and a risk you accept is a flag with its reason`;

const mark = (c: Check) => (c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚑");

async function check(): Promise<Checks> {
  const checks = await runAll();
  for (const c of checks.checks) console.log(`  ${mark(c)} ${c.title}: ${c.detail}`);
  const skipped = checks.skipped ?? [];
  console.log(`checks: ${checks.checks.length} run, ${checks.failed} failed, ${checks.flagged} flagged` +
    (skipped.length ? `, ${skipped.length} skipped (design.json has none of their params): ${skipped.map((x) => x.id).join(", ")}` : ""));
  if (!checks.checks.length)
    console.log(`  no rule applies to this product yet: write them in products/${slug}/rules.ts`);
  // A rule with no scope is held as a part's, from Design's gate on: wrong for one of the parts together, so each is named.
  if (checks.unscoped?.length)
    console.log(`  no scope in rules.ts, so read as part: ${checks.unscoped.join(", ")} (give each scope: "part" for one part on its own, or "assembly" for the parts together)`);
  if (checks.failed) console.log(fixChecks(checks));
  return checks;
}

/** Why a gate can't be accepted, or the build packaged (as the build gate), now: a failed engineer check (run again
 * here, on the files as they are, and written to checks.json), at Design's gate only one of a part on its own, and the
 * BOM's files (gates.ts); from Inspect's gate on, the whole-product check too (system.json, not run again here); from
 * the source gate on, the order (pricingProblems), and at the build gate the plan (planProblem) and the files to make
 * it from. */
async function gateProblems(stage: Stage): Promise<string[]> {
  return gateProblemsOf(productDir(slug), stage, await runAll());
}

/** `sprue inspect`, stage 2: the parts together. The assembly checks, and the whole-product check (cad/_system.py),
 * run again only when system.json is missing or of an earlier design, since `sprue cad` runs it. It proposes Inspect,
 * drafting or declined, only when no check fails, the BOM's files are current and the whole product passes, as the
 * Inspect gate holds them; `ran` is the checks `sprue all` has just run and printed. Returns whether it passes. */
async function inspect(ran?: Checks): Promise<boolean> {
  need("design.json");
  need("bom.json");
  gateNote(slug, "inspect");
  const checks = ran ?? await runAll();
  const assembly = checks.checks.filter((c) => c.scope === "assembly");
  if (!ran) for (const c of assembly) console.log(`  ${mark(c)} ${c.title}: ${c.detail}`);
  const count = (status: Check["status"]) => assembly.filter((c) => c.status === status).length;
  console.log(`assembly checks: ${assembly.length} run, ${count("fail")} failed, ${count("flag")} flagged`);
  const failed = checks.checks.filter((c) => c.status === "fail");
  const part = failed.filter((c) => c.scope !== "assembly").length;
  if (part) console.log(`  ${part} part check${part === 1 ? " fails: it stops" : "s fail: they stop"} Design's gate too`);
  systemIfStale();
  const bom = readJson<Bom>(slug, "bom.json");
  const whole = wholeProduct(productDir(slug), bom);
  console.log(`${whole.ok ? "✓" : "✗"} the whole product: ${whole.detail}`);
  // system.json's own words, while it is of these files: each failing gate's problems, and each risk the design
  // accepts in cad/_system.py, with its reason (a flag, which stops nothing).
  for (const g of whole.gates) {
    if (g.status !== "pass") for (const p of g.list ?? [g.detail]) console.log(`  ✗ ${g.id}: ${p}`);
    for (const f of g.flags ?? []) console.log(`  ⚑ ${g.id}: ${f}`);
  }
  // A part exported from an earlier design, or a mesh of another volume than its line prices: the gate holds these too.
  const files = fileProblems(productDir(slug), bom);
  for (const p of files) console.log(`✗ ${p}`);
  const problems = failed.length + whole.problems + files.length;
  if (problems) {
    await reopenChanged(bom, false);
    console.log(`✗ inspect: ${problems} problem${problems === 1 ? "" : "s"}: fix the design, then run sprue inspect ${slug} again`);
    return false;
  }
  await reopenChanged(bom, true);
  autoPropose(slug, "inspect", { declined: true });
  return true;
}

/** A run from before Inspect is at Inspect with its source or build stage accepted or proposed (state.ts readState).
 * Once the parts pass, a later gate that no longer holds goes back to drafting: a quote of other parts (the source
 * gate's problems) reopens source and build, and a plan, files or package of others (the build gate's, or production/
 * of other files) build alone. While they fail, only the quote and the plan are held here: `sprue all` prices and plans
 * again right after, whatever Inspect says, and the pass would then find them current (the gates' other problems are
 * Inspect's own until then). Past Inspect nothing is reopened here: each later stage's own command and gate hold it. */
async function reopenChanged(bom: Bom, passed: boolean) {
  const s = readState(slug);
  const had = (x: Stage) => s.stage === "inspect" && !!s.stages[x] && s.stages[x]!.status !== "drafting";
  if (!had("source") && !had("build")) return;
  const dir = productDir(slug);
  const why = (problem: string) => `inspect changed the parts (${problem})`;
  const source = passed ? await gateProblems("source") : pricingProblems(dir, bom);
  if (source.length) return reopenAtInspect(slug, ["source", "build"], why(source[0]));
  if (!had("build")) return;
  const plan = planProblem(dir);
  const build = passed ? acceptProblems(dir, "build", await runAll()) : plan ? [plan] : [];
  if (build.length) reopenAtInspect(slug, ["build"], why(build[0]));
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
  for (const s of sourcing.lines) for (const f of s.flags ?? []) console.log(`  ⚑ ${bom.lines.find((l) => l.id === s.lineId)?.name ?? s.lineId}: ${f}`);
  console.log(`sourcing: ${sourcing.lines.length - sourcing.unsourced.length}/${sourcing.lines.length} bought lines have offers`);
  if (sourcing.unsourced.length) process.exitCode = 1;
  return sourcing;
}

function quoteStage(): Quotes {
  need("bom.json");
  const bom = readJson<Bom>(slug, "bom.json");
  const cat = catalog();
  // Priced from the BOM and offers as they are now, which quotes.inputs records, never a sourcing.json of earlier
  // ones: the same offers `sprue source` keeps, written back so the two agree.
  const sourcing = source(bom, cat.offers);
  writeJson(slug, "sourcing.json", sourcing);
  const ship = cat.shipping;
  const notes: ShippingNotes = { read: cat.shippingRead, basis: cat.shippingBasis, shipsWith: cat.shipsWith };
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
    const noShipping = [...new Set([...quotes.noShipping ?? [], ...a.noShipping ?? [], ...b.noShipping ?? []])];
    if (noShipping.length) quotes.noShipping = noShipping;
  }
  quotes.inputs = quoteInputs(productDir(slug));
  writeJson(slug, "quotes.json", quotes);
  const name = (id: string) => bom.lines.find((l) => l.id === id)?.name ?? id;
  const qty = (q: QuoteLine) => (q.packs ? `${q.packs} pack${q.packs === 1 ? "" : "s"} of ${q.packSize} (${q.orderQty} pcs)` : `${q.orderQty}`);
  for (const q of quotes.lines)
    console.log(`  ${usd(q.orderUsd).padStart(8)}  ` + (q.lineId.startsWith("ship:")
      ? `shipping (${q.supplier}), ${q.mode === "estimate" ? "estimate" : "read from its rates"}`
      : `${name(q.lineId)}: ${qty(q)}, ${q.sku}, from ${q.supplier} [${q.mode}]${q.alternate ? `, the alternate ${q.alternate}` : ""}`));
  console.log(`quote: ${usd(quotes.batchUsd)} for ${quotes.units} unit(s), longest lead ${quotes.longestLeadDays} d` +
    (quotes.unquoted.length ? `, not priced: ${quotes.unquoted.join(", ")}` : ""));
  // A line with no price, or a shop with no shipping figure, counts as $0 in the total, so the quote is not one yet.
  for (const id of quotes.unquoted) {
    const l = bom.lines.find((x) => x.id === id)!;
    console.log(`  ✗ the total leaves out ${l.name} (${id}), which has no price: ${whyUnpriced(l, rates())}`);
    process.exitCode = 1;
  }
  if (quotes.noShipping?.length) {
    console.log(`  ✗ catalog.json's shipping has no figure for ${quotes.noShipping.join(", ")}, which the order buys from, so the total counts ${quotes.noShipping.length === 1 ? "its" : "their"} shipping as $0: add ${quotes.noShipping.length === 1 ? "it" : "them"} (0 for a shop that ships free)`);
    process.exitCode = 1;
  }
  for (const p of unkeptPins(bom, sourcing, quotes)) {
    console.log(`  ✗ ${p}`);
    process.exitCode = 1;
  }
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

/** A pin to a shop none of whose offers the source stage keeps (another part, or out of stock) can't be kept: where each
 * such line is bought instead. */
function unkeptPins(bom: Bom, sourcing: Sourcing, quotes: Quotes): string[] {
  return bom.lines.filter((l) => l.pin && l.process === "buy").flatMap((l) => {
    const q = quotes.lines.find((x) => x.lineId === l.id);
    if (!q || (q.supplier === l.pin!.supplier && (!l.pin!.sku || q.sku === l.pin!.sku))) return [];
    return [`${l.name}: pinned to ${l.pin!.supplier}${l.pin!.sku ? ` ${l.pin!.sku}` : ""}, but no offer of it is left in sourcing.json (${sourcing.lines.find((x) => x.lineId === l.id)?.note ?? "no offer found"}), so it is bought from ${q.supplier}: sprue pick ${slug} ${l.id} auto, or fix the offer`];
  });
}

function plan() {
  for (const f of ["request.json", "design.json", "bom.json", "checks.json", "quotes.json"]) need(f);
  const design = readJson<Design>(slug, "design.json");
  writeText(slug, "build-plan.md", buildPlan(readJson<Request>(slug, "request.json"), design,
    readJson<Bom>(slug, "bom.json"), readJson<Checks>(slug, "checks.json"), readJson<Quotes>(slug, "quotes.json"),
    design.assembly ?? [], exists(slug, "figure.json") ? readJson<{ steps: FigureStep[] }>(slug, "figure.json").steps : [],
    FIRMWARE.filter((f) => exists(slug, f))).trimEnd() + `\n\n${planRecord(productDir(slug))}\n`);
  console.log(`wrote products/${slug}/build-plan.md`);
  autoPropose(slug, "build");
}

function scoreStage() {
  if (!exists(slug, "reference/reference.json")) {
    console.log(`no reference at products/${slug}/reference/reference.json, so nothing to score against`);
    return;
  }
  for (const f of ["bom.json", "checks.json", "quotes.json"]) need(f);
  staleOrder();
  const s = score(productDir(slug), readJson<Bom>(slug, "bom.json"), readJson<Checks>(slug, "checks.json"),
    readJson<Quotes>(slug, "quotes.json"), readJson<Reference>(slug, "reference/reference.json"));
  writeJson(slug, "score.json", s);
  console.log(`score: coverage ${s.coverage.pct}% (missing: ${s.coverage.missing.join(", ") || "none"}), ` +
    `${s.checks.failed} failed of ${s.checks.ran} checks run (${s.checks.skipped.length} skipped), cost ${s.cost.deltaPct > 0 ? "+" : ""}${s.cost.deltaPct}% vs reference` +
    `${s.cost.unpriced.length ? `, ${s.cost.unpriced.length} line${s.cost.unpriced.length === 1 ? "" : "s"} not priced` : ""}, ` +
    `files ${s.files.filter((f) => f.ok).length}/${s.files.length} ok, whole product ${s.system.ok ? "ok" : "not ok"}` +
    `${s.faults ? `, seeded faults ${s.faults.ok ? "ok" : "not ok"}` : ""} -> ${s.pass ? "PASS" : "not yet"}`);
  if (s.cost.unpriced.length) console.log(`  ✗ not priced, so the total counts them as $0: ${s.cost.unpriced.join(", ")} (run sprue quote; a CNC or sheet-metal part has no fab adapter yet)`);
  for (const f of s.files.filter((f) => !f.ok)) console.log(`  ✗ ${f.name}: ${f.detail}`);
  if (!s.system.ok) console.log(`  ✗ whole product: ${s.system.detail}`);
  if (s.faults) console.log(`  ${s.faults.ok ? "·" : "✗"} seeded faults: ${s.faults.detail}`);
}

async function packageStage() {
  for (const f of ["bom.json", "quotes.json", "build-plan.md"]) need(f);
  staleOrder();
  const out = join(productDir(slug), "production");
  // Nothing is packaged while a check fails or a file is not the one the design and the quote describe: a package of
  // an earlier run is taken away too, so no old file is left to order from.
  const problems = await gateProblems("build");
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    if (existsSync(out)) {
      rmSync(out, { recursive: true, force: true });
      console.error(`removed products/${slug}/production/, which was of an earlier run`);
    }
    throw new Error(`nothing packaged: ${problems.length} problem${problems.length === 1 ? "" : "s"} above. Fix ${problems.length === 1 ? "it" : "them"}, then run sprue package ${slug} again`);
  }
  const bom = readJson<Bom>(slug, "bom.json");
  const quotes = readJson<Quotes>(slug, "quotes.json");
  // Written afresh, so no file of an earlier run (a part since taken out of the BOM) is left beside this one's.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(join(productDir(slug), "build-plan.md"), join(out, "build-plan.md"));
  for (const [f, text] of Object.entries(orderLists(bom, quotes))) writeText(slug, `production/${f}`, text);
  const missing: string[] = [];
  let board = false;
  for (const l of bom.lines.filter((l) => l.file)) {
    const src = resolve(productDir(slug), l.file!);
    // The board's line, however its path is written: it goes in only through the board's gates.
    const zip = isBoardLine(productDir(slug), l);
    if (!existsSync(src)) { missing.push(`${l.name} (${l.file}): not generated yet`); continue; }
    // Gerbers go in only as the audit of the board as it is now, and the read-back of these very files with its
    // self-test, passed them.
    const audited = zip ? gerbersAudit(productDir(slug), l.file, { selfTest: true }) : undefined;
    if (audited && !audited.ok) {
      missing.push(`${l.name} (${l.file}): ${audited.detail}`);
      continue;
    }
    board ||= zip;
    copyFileSync(src, join(out, basename(src)));
    const step = src.replace(/\.stl$/, ".step");
    if (step !== src && existsSync(step)) copyFileSync(step, join(out, basename(step)));
  }
  // The keypad's firmware goes with its board, as the plan's last steps copy it onto the Pico: only with the zip, and
  // only the code.py sprue pcb wrote for this board, or one the firmware run passed on this zip (firmwareShips).
  const ships = firmwareShips(productDir(slug));
  const firmware = board && ships.ok ? FIRMWARE.filter((f) => exists(slug, f)) : [];
  for (const f of firmware) {
    mkdirSync(join(out, "firmware"), { recursive: true });
    copyFileSync(join(productDir(slug), f), join(out, f));
  }
  if (!firmware.length && ships.detail) missing.push(`firmware (firmware/code.py): ${board ? ships.detail : "it goes only with the board's zip, which is not packaged"}`);
  const csvs = readdirSync(out).filter((f) => f.endsWith(".csv"));
  const fabFiles = readdirSync(out).length - 1 - csvs.length - (firmware.length ? 1 : 0);
  console.log(`wrote products/${slug}/production/: build-plan.md, ${csvs.join(", ")}${firmware.length
    ? `, ${fabFiles} fab file(s) and ${firmware.join(", ")}` : ` and ${fabFiles} fab file(s)`}`);
  for (const m of missing) console.log(`  ✗ not packaged: ${m}`);
  if (missing.length) process.exitCode = 1;
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
    // The quote buys only what the source stage keeps: a pin to an offer it drops (another part, out of stock or
    // short) would be bought elsewhere without a word.
    const kept = source(bom, catalog().offers).lines.find((s) => s.lineId === lineId);
    const usable = (kept?.offers ?? []).filter((o) => o.supplier === found.match!.supplier && (!found.sku || o.sku === found.sku));
    if (!usable.length) {
      const p = partOf(line, found.match!.mpn);
      throw new Error(`${found.sku ? `${found.match!.supplier} ${found.sku} can't be pinned, as the source stage drops it` : `no offer from ${found.match!.supplier} can be pinned, as the source stage drops each`}: ${kept?.note ?? "no offer found"}` +
        (p.as === "other" ? `. To buy it, add its part number (${found.match!.mpn}) to ${lineId}'s alternates in bom.json, if it is a part the design works with` : ""));
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
  case "status": await status(); break;
  case "new": create(rest.join(" ")); break;
  case "validate": process.exitCode = validate() ? 0 : 1; break;
  case "cad": await cad(); refreshPage(slug); break;
  case "pcb": process.exitCode = (await pcb(slug)) ? 0 : 1; refreshPage(slug); break;
  case "system": process.exitCode = systemStage() ? 0 : 1; refreshPage(slug); break;
  case "inspect": process.exitCode = (await inspect()) ? 0 : 1; refreshPage(slug); break;
  case "verify": process.exitCode = await verify(slug); refreshPage(slug); break;
  case "check": process.exitCode = (await check()).failed ? 1 : 0; refreshPage(slug); break;
  case "source": gateNote(slug, "source"); sourceStage(); refreshPage(slug); break;
  case "quote": gateNote(slug, "source"); quoteStage(); refreshPage(slug); break;
  case "plan": gateNote(slug, "build"); plan(); refreshPage(slug); break;
  case "score": scoreStage(); refreshPage(slug); break;
  case "faults": {
    const usage = `sprue faults ${slug} [--keep] [--jobs n]`;
    flags(["--keep", "--jobs"], usage);
    const at = rest.indexOf("--jobs"), jobs = at >= 0 ? Number(rest[at + 1]) : undefined;
    if (jobs !== undefined && !(Number.isInteger(jobs) && jobs >= 1)) throw new Error(`--jobs takes a whole number, 1 or more; usage: ${usage}`);
    process.exitCode = (await faults(slug, { keep: rest.includes("--keep"), ...(jobs ? { jobs } : {}) })) ? 0 : 1;
    if (exists(slug, "score.json")) console.log(`run sprue score ${slug} (or sprue all) to put it in score.json`);
    refreshPage(slug);
    break;
  }
  case "package": gateNote(slug, "build"); try { await packageStage(); } finally { refreshPage(slug); } break;
  case "bom": if (exists(slug, "quotes.json")) printBom(explorer(), rest[0]); else printBomLines(slug, rest[0]); break;
  case "suppliers": printSuppliers(explorer(), rest.join(" ") || undefined); break;
  case "pick":
    gateNote(slug, "source");
    pick(rest[0], rest.slice(1));
    {
      const [s, q] = quiet(() => { const s = sourceStage(), q = quoteStage(); plan(); return [s, q] as const; });
      // What made the requote exit 1, as `sprue quote` prints it.
      const bom = readJson<Bom>(slug, "bom.json");
      for (const id of new Set([...s.unsourced, ...q.unquoted])) {
        const l = bom.lines.find((x) => x.id === id)!;
        console.log(`  ✗ not priced: ${l.name} (${id}): ${whyUnpriced(l, rates())}`);
      }
      if (q.noShipping?.length) console.log(`  ✗ no shipping figure in catalog.json for ${q.noShipping.join(", ")}, which the order buys from`);
      for (const p of unkeptPins(bom, s, q)) console.log(`  ✗ ${p}`);
    }
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
  case "accept": {
    need("request.json");
    // The order of the stages first (an Inspect never shown, an earlier gate open), so the fix asked for below is one
    // after which the same command goes through. Then a gate is not accepted while an engineer check fails, a file is
    // not the one the design describes (the build stage's: not made yet, or a board not proved) or, from Inspect's gate
    // on, the whole product fails its check; --force only skips the order of the stages, never these.
    const stage = acceptable(slug, rest);
    need("design.json");
    need("bom.json");
    // At Build also the package, which is taken only of the files as they are now.
    const problems = acceptProblems(productDir(slug), stage, await runAll());
    if (problems.length) {
      for (const p of problems) console.error(`  ✗ ${p}`);
      refreshPage(slug, { create: true });
      throw new Error(`${stage} not accepted: ${problems.length} problem${problems.length === 1 ? "" : "s"} above. Fix ${problems.length === 1 ? "it" : "them"}, then run sprue accept ${slug} again`);
    }
    accept(slug, rest);
    refreshPage(slug, { create: true });
    break;
  }
  case "decline": need("request.json"); decline(slug, rest); refreshPage(slug, { create: true }); break;
  case "propose": need("request.json"); propose(slug, rest[0]); refreshPage(slug, { create: true }); break;
  case "all": {
    // The figure first (skipped until figure.mjs exists), then the checks and the whole product; sourcing, the quote
    // and the plan only once there are offers to price (the source stage writes catalog.json). Later stages run even
    // if a gate is open, but are only proposed once the stages before them are accepted.
    let drawn = true;
    if (exists(slug, "figure.mjs")) { console.log("· design: figure"); drawn = await figure(slug, { table: false }); }
    else console.log(`· design: figure skipped, no products/${slug}/figure.mjs yet`);
    console.log("· design: check"); const checks = await check();
    // Inspect: the assembly checks just printed, and the whole product, checked again if an edit made system.json stale.
    console.log("· inspect: the whole product"); const inspected = await inspect(checks);
    let ex: Explorer | undefined;
    if (exists(slug, "catalog.json") || exists(slug, "offers.digikey.json")) {
      console.log("· source: offers"); gateNote(slug, "source"); sourceStage();
      console.log("· source: quote"); quoteStage();
      // The plan is written ahead of its gate while the quote is open, so the page and the history stay current;
      // it is proposed only once the quote is accepted.
      console.log("· build: plan"); gateNote(slug, "build"); plan();
      scoreStage();
      ex = snapshot();
    } else console.log(`· source and build: skipped, no products/${slug}/catalog.json yet (the source stage writes it once Inspect is accepted)`);
    writePage(slug, { ex }); // the page picks up the new checks, prices and gates
    printPage(slug);
    if (!drawn) { console.log(`figure: fix the problems above, then run \`sprue figure ${slug}\``); process.exitCode = 1; }
    // A run with a failed check, or a whole product that fails Inspect, is not one to accept or package: it says so in
    // its exit code, as \`sprue check\` and \`sprue inspect\` do (which printed what to do).
    if (checks.failed || !inspected) process.exitCode = 1;
    break;
  }
}
} catch (error) {
  // A usage mistake or a file that doesn't add up: one line, no stack trace (an engine's exception with its class).
  console.error(`✗ ${cmd}: ${errorText(error)}`);
  process.exitCode = 1;
}
