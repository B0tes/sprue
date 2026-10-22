// `sprue status <slug>`: the files each stage has written, its gate, and the one thing to do next.
// Grouped by the four stages the user sees (design, inspect, source, build), so nothing here numbers steps.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptProblems, fileProblems, meshProblem, packageProblem, planProblem, pricingProblems, wholeProductProblem } from "./gates.ts";
import { errorText, exists, productDir, readJson } from "./io.ts";
import { runChecks } from "./stages/check.ts";
import { exportStale, faultsAudit, isBoardLine, systemAudit, verifyState } from "./stages/score.ts";
import { gateLine, readState, STAGES, waiting, type Stage, type State } from "./state.ts";
import type { Bom, Checks, Design } from "./types.ts";

// `done` is for a file whose being there is not enough: verify.json counts only once it says verified, of the board
// as it is now. `stale` marks one that is there but not of the files as they are, which its stage's command writes
// again (a quote, a plan, a check that failed).
type Item = { file: string; dir?: boolean; optional?: boolean; next?: string; done?: boolean; stale?: string };

function items(slug: string): Record<Stage, Item[]> {
  const bom = exists(slug, "bom.json") ? readJson<Bom>(slug, "bom.json") : undefined;
  const dir = productDir(slug);
  const made = !bom || bom.lines.some((l) => l.process === "print" || l.process === "cnc" || l.process === "sheet");
  const board = !!bom?.lines.some((l) => isBoardLine(productDir(slug), l)); // a PCB whose Gerbers come from cad/pcb.mjs
  const verified = verifyStatus(slug) === "verified";
  const system = bom ? systemAudit(productDir(slug), bom) : undefined;
  // A system.json of the files as they are that fails: sprue inspect would only fail too, so the design is fixed first.
  const fails = system && !system.ok && !/^(no system\.json|system\.json is (of an earlier design|not readable))/.test(system.detail);
  const at = readState(slug).stage;
  const past = at === "done" || STAGES.indexOf(at) > STAGES.indexOf("inspect");
  // A part file exported before the CAD or the params changed, or a mesh not the part its line prices, which every
  // gate refuses (fileProblems), and from Build one not made yet.
  const parts = bom?.lines.filter((l) => l.file && !isBoardLine(dir, l)) ?? [];
  const exported = parts.every((l) => existsSync(join(dir, l.file!)) ? !exportStale(dir, l.file!) && !meshProblem(dir, l) : at !== "build");
  const recorded = exists(slug, "checks.json") ? readJson<Checks>(slug, "checks.json") : undefined;
  const failing = recorded?.checks.filter((c) => c.status === "fail").map((c) => c.id) ?? [];
  return {
    design: [
      { file: "request.json", next: `sprue new ${slug} '<brief>', then fill request.json` },
      { file: "design.json", next: "write design.json: summary, architecture, params, assembly" },
      { file: "design.md", optional: true },
      { file: "bom.json", next: `write bom.json, then sprue validate ${slug}` },
      { file: "cad", dir: true, optional: !made && !board, next: `write cad/<part>.py for each made part, then sprue cad ${slug}` },
      { file: "fab", dir: true, optional: !made, done: exists(slug, "fab") && exported, next: `sprue cad ${slug}` },
      { file: "pcb", dir: true, optional: !board, next: `sprue pcb ${slug}` },
      { file: "rules.ts", optional: true },
      { file: "checks.json", next: `sprue check ${slug}`, stale: failing.length ? `fails ${failing.join(", ")}` : undefined },
      { file: "figure.mjs", next: `write figure.mjs (reference/figure.md), then sprue figure ${slug} --draft` },
      { file: "view.html", next: `sprue figure ${slug} --draft` },
      { file: "shots", dir: true, optional: true },
    ],
    inspect: [
      // Every part in one frame: they fit, touch where they should, stand up and do their physical job.
      // A product of bought parts alone has none, unless it has a whole-product check: then the gates hold it.
      { file: "system.json", optional: !bom || (!made && !exists(slug, "cad/_system.py")), done: system?.ok,
        next: !exists(slug, "cad/_system.py") ? `write cad/_system.py, then sprue system ${slug}`
          : fails ? `fix the design (system.json ${system.failed.length ? `fails ${system.failed.join(", ")}` : "is not ok"}), then sprue inspect ${slug}`
          // Past Inspect, sprue inspect runs the check again and leaves the accepted Inspect as it is.
          : past ? `sprue inspect ${slug} runs the whole-product check again` : `sprue inspect ${slug} proposes inspect for review` },
    ],
    source: [
      { file: "catalog.json", next: "write catalog.json: two real offers per bought line" },
      { file: "offers.digikey.json", optional: true },
      { file: "sourcing.json", next: `sprue source ${slug}` },
      { file: "quotes.json", next: `sprue quote ${slug}`, stale: bom && exists(slug, "quotes.json") && pricingProblems(dir, bom).length ? "stale" : undefined },
    ],
    build: [
      { file: "build-plan.md", next: `sprue plan ${slug}`, stale: exists(slug, "build-plan.md") && planProblem(dir) ? "stale" : undefined },
      // The board is proven before it is packaged: package leaves out a zip the read-back has not passed.
      { file: "pcb/verify.json", optional: !board, done: verified, next: `sprue verify ${slug}, until it ends VERIFIED` },
      // production/ counts only while it is what package would write from the files as they are (the build gate's too).
      { file: "production", dir: true, done: exists(slug, "production") && !(bom && packageProblem(productDir(slug), bom)), next: `sprue package ${slug}` },
      { file: "reference/reference.json", optional: true },
      { file: "score.json", optional: true },
      // The checks, checked: each fault reference/faults.json lists, put into a copy, is caught (sprue faults).
      { file: "faults.json", optional: true, done: faultsAudit(productDir(slug))?.ok ?? false, next: `sprue faults ${slug}` },
    ],
  };
}

/** What pcb/verify.json says of the board as it is now: verified, failed or unverified, or stale once the board, its
 * zip or what verified it changed (undefined with none). */
const verifyStatus = (slug: string) => verifyState(productDir(slug));

const done = (slug: string, item: Item) => item.done ?? exists(slug, item.file);
const mark = (slug: string, item: Item) => (done(slug, item) && !item.stale ? "✓" : "○");

const PROPOSER: Record<Stage, string> = { design: "figure", inspect: "inspect", source: "quote", build: "plan" };

function label(slug: string, item: Item) {
  if (item.file === "pcb/verify.json" && exists(slug, item.file)) return `${item.file} (${verifyStatus(slug) ?? "unreadable"})`;
  if (item.file === "system.json" && exists(slug, item.file)) {
    if (!exists(slug, "bom.json")) return `${item.file} (no bom.json)`;
    const s = systemAudit(productDir(slug), readJson<Bom>(slug, "bom.json"));
    return `${item.file} (${s.ok ? "passes" : s.failed.length ? `fails ${s.failed.join(", ")}` : "not ok"})`;
  }
  if (item.file === "faults.json" && exists(slug, item.file)) {
    const f = faultsAudit(productDir(slug));
    if (!f) return `${item.file} (no reference/faults.json)`;
    const counts = `${f.caught} of ${f.ran} caught, ${f.falseAlarms} false alarm${f.falseAlarms === 1 ? "" : "s"}`;
    return `${item.file} (${/^faults\.json (is of|was measured)/.test(f.detail) ? "stale" : /^faults\.json is not readable/.test(f.detail) ? "unreadable" : /^faults\.json could not be checked/.test(f.detail) ? "unchecked" : counts})`;
  }
  if ((item.file === "production" || item.file === "fab") && exists(slug, item.file) && !done(slug, item)) return `${item.file}/ (stale)`;
  if (item.stale && exists(slug, item.file)) return `${item.file} (${item.stale})`;
  if (!item.dir) return item.file;
  const dir = join(productDir(slug), item.file);
  const n = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith("_") && !f.startsWith(".")).length : 0;
  return `${item.file}/${n ? ` (${n})` : ""}`;
}

export async function printStatus(slug: string) {
  const s = readState(slug);
  const all = items(slug);
  console.log(`products/${slug}/${exists(slug, "state.json") ? "" : "  (no state.json yet)"}`);
  for (const stage of STAGES) {
    console.log(`  ${gateLine(s, stage)}`);
    const row = all[stage]
      .filter((it) => !it.optional || exists(slug, it.file))
      .map((it) => `${mark(slug, it)} ${label(slug, it)}`);
    // Inspect of a product with nothing made and no whole-product check has no file to show.
    if (row.length) console.log(`      ${row.join("  ")}`);
  }
  if (exists(slug, "view.html")) {
    const page = join(productDir(slug), "view.html");
    console.log(`page: ${page}\n      ${pathToFileURL(page).href}`);
  }
  console.log(`next: ${await next(slug, s, all)}`);
}

/** What the run's gate would refuse, but the order of the stages, so it is put right before the user is asked: at a
 * proposed gate all its accept refuses (acceptProblems, the same call); before then, past Design, what its proposer
 * and accept hold that the stage's own commands don't write (a failed check, a part file of an earlier design, and
 * after Inspect the whole-product check). A string when the checks can't run, which accept would stop at too. */
async function refusals(slug: string, s: State): Promise<string[] | string> {
  if (s.stage === "done") return [];
  const proposed = s.stages[s.stage]?.status === "proposed";
  if (!proposed && s.stage === "design") return [];
  for (const f of ["design.json", "bom.json"]) if (!exists(slug, f)) return proposed ? `${f} is missing, so the gate can't be checked: put it back` : [];
  const dir = productDir(slug);
  let checks: Checks;
  try {
    const local = join(dir, "rules.ts");
    checks = runChecks(readJson<Design>(slug, "design.json"), readJson<Bom>(slug, "bom.json"),
      existsSync(local) ? (await import(pathToFileURL(local).href)).rules : []);
  } catch (e) {
    return proposed ? `the checks can't run (${errorText(e)}): fix it, then sprue check ${slug}` : [];
  }
  if (proposed) return acceptProblems(dir, s.stage, checks);
  const bom = readJson<Bom>(slug, "bom.json");
  const whole = STAGES.indexOf(s.stage) > STAGES.indexOf("inspect") ? wholeProductProblem(dir, bom) : undefined;
  return [...checks.checks.filter((c) => c.status === "fail").map((c) => `check ${c.id} fails: ${c.detail}`),
    ...fileProblems(dir, bom), ...(whole ? [whole] : [])];
}

/** The step that puts a gate's problem right: the design for a failed check, the whole-product check's own (Inspect's
 * row says which), else the command the problem ends with, named first. */
function fix(slug: string, all: Record<Stage, Item[]>, problem: string) {
  if (/^check \S+ fails: /.test(problem)) return `fix the design (${problem}), then sprue check ${slug}`;
  if (problem.startsWith("the whole-product check")) return all.inspect[0].next!;
  const m = /^(.*): run (sprue [a-z]+)$/.exec(problem);
  return m ? `${m[2]} ${slug} (${m[1]})` : problem;
}

async function next(slug: string, s: State, all: Record<Stage, Item[]>) {
  if (s.stage === "done") return "nothing: every stage is accepted. Edit an input and rerun to iterate; nothing has been ordered.";
  // What the gate would refuse comes first, as accept (or the stage's proposer) would only say so; at a proposed gate
  // with none, the user is asked, whatever else is left to do (a board's sprue verify, a package: accept needs neither).
  const problems = await refusals(slug, s);
  if (typeof problems === "string") return problems;
  if (problems.length) return fix(slug, all, problems[0]);
  const line = waiting(slug, s);
  if (line) return line.replace(/^waiting for you/, "ask the user");
  const missing = all[s.stage].find((it) => !it.optional && !done(slug, it));
  if (missing) return missing.next ?? missing.file;
  // At Inspect only sprue inspect, which checks the parts first: sprue propose would skip that.
  return `sprue ${PROPOSER[s.stage]} ${slug} proposes ${s.stage} for review${s.stage === "inspect" ? "" : ` (or sprue propose ${slug} ${s.stage})`}`;
}
