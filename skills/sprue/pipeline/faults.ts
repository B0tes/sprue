// Seeded faults (`sprue faults <slug>`): the checks, checked. Each fault in products/<slug>/reference/faults.json is
// put into a copy of the product (a param, a BOM line, an offer, a line of the CAD or of the board code), and the
// copy goes through every gate a user's run would: sprue cad (the parts, the board, its read-back and the
// whole-product check), sprue verify, sprue validate and sprue all (the checks, the quote and the score). A copy with
// no fault goes through the same, and a fault counts as caught only by a problem that copy does not have (numbers
// aside) which names what the fault broke: a design that already fails a gate would otherwise "catch" any fault at
// all. What the clean copy reports is held to the list's `known` problems, real ones each with why; any other is a
// false alarm. It writes products/<slug>/faults.json, which the score reads (score.ts faultsAudit). Nothing in the
// product itself is touched: every copy is in a temporary folder, removed at the end (kept with --keep).

import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, constants, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { linkInProduct, productDir, realPath } from "./io.ts";
import { faultsInputs, productFiles, productLinks } from "./stages/score.ts";
import type { FaultCase, FaultList, FaultsReport, FaultEdit, Problem, Checks, Score, SystemCheck } from "./types.ts";

const BIN = join(import.meta.dirname, "..", "bin", "sprue");
/** The commands each copy goes through, in this order: verify after cad, since cad's read-back has no self-test. */
export const STEPS = ["cad", "verify", "validate", "all"] as const;
/** A problem that says a stage is missing or older than its inputs: the run skipped something, which is not a catch.
 * It is read without the file a score line starts with ("pcb/x.zip: no pcb/readback.json, ..."). */
const STALE = /(of|from) an earlier (design|board|build)|has not (been )?run on|is not readable|not generated yet|^no (system\.json|pcb\/[\w.]+|fab\/build\.json)\b/;
/** A file name a score line starts with, as in "fab/top.stl: the mesh holds ...". */
const FILE = /^[\w./-]+\.\w+: /;
/** A problem that says a command or the code it ran broke, not that a gate found something: an exception (with its
 * class, as Python and errorText print one, after ": " or "(" as the read-back words one it did not expect, or in V8's
 * words), JSON that does not parse, a command that failed, a system error (ENOENT: ...), a whole-product gate that
 * could not run, a read-back that stopped. It is a problem (one
 * the clean copy has is a false alarm) but never a catch. A plain Error the board kit throws to refuse a design (hole x
 * must be a number) is not one: that is a check. */
const CRASH = new RegExp([
  "Command failed", "is not valid JSON", "in JSON at position", "Unexpected (token|end of|identifier|non-whitespace|string|number)",
  "is not iterable", "is not a function", "is not a constructor", "is not defined", "Cannot (read|set) propert", "Cannot destructure",
  "before initialization", "has already been declared", "Assignment to constant", "Maximum call stack", "Cannot use 'in' operator",
  "Cannot convert undefined or null", "Invalid array length", "Reduce of empty array", "Converting circular structure",
  "^Can't run: ", "stopped with an error, so it proves nothing", "^E[A-Z]{2,}: ", "(^|: |\\()[A-Z]\\w*(Error|Exception)\\b",
].join("|"));
/** The score's note that a printed part's mesh is not the volume its BOM line is priced at: bookkeeping that follows
 * any change of shape, whose fix is to copy the volume in, so it catches no fault. */
const VOLUME = /: the mesh holds [\d.]+ cm3 but bom\.json prices/;
// A number as system.py's self-test reads it (NUMBER there): 4.79, -0.05, 28 (in 28%); not the 9 of sw9 or the 14 of U1.14.
const NUMBER = /(?<![\w.-])-?\d+(?:\.\d+)?(?!\w)/g;

/** A problem with its numbers taken out, so the same problem with a number moved a little is the same problem. */
export const shape = (text: string) => text.replace(NUMBER, "#");

/** Whether a problem names `word` as a whole (any case): K1 is not in K10, nor sw1 in fault-sw1. */
export const names = (text: string, word: string) =>
  new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text);

/** reference/faults.json, read and held to its shape: a list that cannot be run as written fails before anything
 * runs, not as faults that "were not caught". */
export function readFaultList(dir: string): FaultList {
  const path = join(dir, "reference", "faults.json");
  const say = (msg: string) => { throw new Error(`reference/faults.json: ${msg}`); };
  if (!existsSync(path)) say("there is none: list the faults to seed, and the clean design's known problems (reference/formats.md)");
  const list = JSON.parse(readFileSync(path, "utf8")) as FaultList;
  if (!Array.isArray(list.faults) || !list.faults.length) say("faults is empty");
  const ids = new Set<string>();
  for (const f of list.faults) {
    if (!f.id || !/^[a-z0-9-]+$/.test(f.id)) say(`a fault's id must be lower-case letters, digits and dashes (got ${JSON.stringify(f.id)})`);
    if (ids.has(f.id) || f.id === "clean") say(`${f.id}: the id is taken`);
    ids.add(f.id);
    if (!["mechanical", "pcb", "bom"].includes(f.area)) say(`${f.id}: area must be mechanical, pcb or bom`);
    if (!f.fault || typeof f.fault !== "string") say(`${f.id}: fault (what it breaks, in words) is empty`);
    if (!Array.isArray(f.expect) || !f.expect.length || !f.expect.every((w) => typeof w === "string" && w.trim()))
      say(`${f.id}: expect must be a list of the parts, lines or words a problem must name to catch it`);
    if (!Array.isArray(f.edit) || !f.edit.length) say(`${f.id}: edit must be a list of edits`);
    f.edit.forEach((e, i) => { const why = editProblem(e); if (why) say(`${f.id}: edit ${i + 1}: ${why}`); });
  }
  if (list.known !== undefined && !Array.isArray(list.known)) say("known must be a list");
  for (const k of list.known ?? []) if (typeof k?.problem !== "string" || !k.problem || typeof k.why !== "string" || !k.why) say("each known problem needs problem and why");
  return { ...list, known: list.known ?? [] };
}

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/** What is wrong with an edit as written, if anything: a misspelt key or a `to` left out would otherwise put no fault
 * in, and the copy, the same as the clean one, would read as a fault the gates missed. */
function editProblem(e: unknown): string | undefined {
  if (!isObject(e) || typeof e.file !== "string" || !e.file) return "needs a file";
  const extra = Object.keys(e).filter((k) => !["file", "set", "delete", "replace", "optional"].includes(k));
  if (extra.length) return `${extra.join(", ")}: an edit takes only file, set, delete, replace and optional`;
  if (e.set === undefined && e.delete === undefined && e.replace === undefined) return "needs set, delete or replace";
  if (e.set !== undefined && (!isObject(e.set) || !Object.keys(e.set).length)) return "set must map paths to values";
  if (e.delete !== undefined && (!Array.isArray(e.delete) || !e.delete.length || !e.delete.every((p) => typeof p === "string" && p))) return "delete must be a list of paths";
  if (e.replace !== undefined && (!Array.isArray(e.replace) || !e.replace.length ||
    !e.replace.every((r) => isObject(r) && typeof r.from === "string" && r.from && typeof r.to === "string" && Object.keys(r).length === 2)))
    return "replace must be a list of { from, to }, each a string, from not empty";
  if (e.optional !== undefined && typeof e.optional !== "boolean") return "optional must be true or false";
}

/** Copies a product's own files (score.ts productFiles: not what a run writes, which a copy must make afresh) to `to`,
 * and its links within itself as links, each made again from where it lands in the product (linkInProduct): board/ to
 * pcb/ is a link to the copy's own pcb/ even when the product's is an absolute link, or one through the product's real
 * folder, either of which would lead the copy's edits and reads back into the product. */
export function copyProduct(from: string, to: string) {
  for (const f of productFiles(from)) {
    mkdirSync(dirname(join(to, f)), { recursive: true });
    copyFileSync(join(from, f), join(to, f));
  }
  for (const f of productLinks(from)) {
    const at = join(to, f);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(relative(dirname(at), join(to, linkInProduct(from, f))) || ".", at);
  }
}

/** Makes a fault's edits in the product at `dir`. Any file takes `replace`, each `from` found exactly once in the file
 * as it stands; then a JSON file takes `set` (a path such as params.caseWallMm or lines[id=sw].qtyPerUnit, which must
 * be there already) and `delete`. An edit of a file the product does not have is skipped when `optional`. An edit
 * that does not apply, or changes nothing, throws, and so does a list whose edits were all skipped, so a fault that was
 * never put in is never counted. */
export function applyEdits(dir: string, edits: FaultEdit[]) {
  let made = 0;
  for (const e of edits) {
    const why = editProblem(e);
    if (why) throw new Error(`${e.file}: ${why}`);
    const path = join(dir, e.file);
    if (!existsSync(path)) {
      if (e.optional) continue;
      throw new Error(`${e.file} is not in the product`);
    }
    const was = readFileSync(path, "utf8");
    let text = was;
    for (const r of e.replace ?? []) {
      const n = text.split(r.from).length - 1;
      if (n !== 1) throw new Error(`${e.file}: ${JSON.stringify(r.from.slice(0, 60))} is there ${n} times, not once`);
      text = text.replace(r.from, () => r.to);
    }
    let same = text === was;
    if (e.set || e.delete) {
      if (!e.file.endsWith(".json")) throw new Error(`${e.file}: set and delete are for JSON files; use replace`);
      const doc = JSON.parse(text) as unknown, before = JSON.stringify(doc);
      for (const [p, value] of Object.entries(e.set ?? {})) {
        const { parent, key } = locate(doc, p);
        (parent as Record<string | number, unknown>)[key] = value;
      }
      for (const p of e.delete ?? []) {
        const { parent, key } = locate(doc, p);
        if (Array.isArray(parent)) parent.splice(key as number, 1);
        else delete (parent as Record<string, unknown>)[key as string];
      }
      same &&= JSON.stringify(doc) === before;
      text = JSON.stringify(doc, null, 2) + "\n";
    }
    if (same) throw new Error(`${e.file}: the edit changes nothing`);
    writeFileSync(path, text);
    made++;
  }
  if (edits.length && !made) throw new Error(`${edits.map((e) => e.file).join(", ")}: not in the product, and every edit is optional, so nothing was put in`);
}

const SEGMENT = /^([^.[\]]+)(?:\[([^=\]]+)=([^\]]+)\])?$/;

/** Where a path such as lines[id=sw].qtyPerUnit points in a JSON document: its parent and key. Each step must be
 * there, so a misspelt name fails rather than adding a field nothing reads. */
function locate(doc: unknown, path: string): { parent: unknown; key: string | number } {
  let cur = doc, parent: unknown, key: string | number = "";
  for (const seg of path.split(".")) {
    const m = SEGMENT.exec(seg);
    if (!m) throw new Error(`${path}: "${seg}" is neither a name nor name[key=value]`);
    if (cur === null || typeof cur !== "object" || !(m[1] in cur)) throw new Error(`${path}: there is no ${m[1]}`);
    parent = cur;
    key = m[1];
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2]) {
      if (!Array.isArray(cur)) throw new Error(`${path}: ${m[1]} is not a list`);
      const i = cur.findIndex((x) => x !== null && typeof x === "object" && String((x as Record<string, unknown>)[m[2]]) === m[3]);
      if (i < 0) throw new Error(`${path}: ${m[1]} has none with ${m[2]} ${m[3]}`);
      parent = cur;
      key = i;
      cur = cur[i];
    }
  }
  return { parent, key };
}

type Said = { step: string; code: number | null; out: string; err: string };

/** What the gates said of the product at `dir` after the steps: every problem, each with the gate that found it, and
 * apart from them the problems that only say a stage did not run on the files there are. */
export function collect(dir: string, said: Said[]): { problems: Problem[]; stale: string[]; kicad: FaultCase["kicad"] } {
  const raw: Problem[] = [];
  const read = <T>(file: string): T | undefined => {
    try {
      return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
    } catch {
      return undefined;
    }
  };
  // A command that stopped with an error says why on one line (cli.ts), and a part or board code that threw names
  // its exception (a Python traceback's last line, or Node's); validate lists what is missing, and cad a BOM line's
  // print it did not build.
  for (const s of said) {
    for (const line of s.err.split("\n")) {
      const m = /^✗ \w+: (.*)$/.exec(line.trim()) ?? /^([A-Z]\w*(?:Error|Exception)\b.*)$/.exec(line.trim());
      if (m) raw.push({ gate: s.step, text: m[1] });
    }
    if (s.step === "validate" || s.step === "cad") for (const line of s.out.split("\n")) {
      const m = s.step === "validate" ? /^\s*✗ (.*)$/.exec(line) : /^\s*✗ ([\w-]+: \S+ not built)$/.exec(line);
      if (m) raw.push({ gate: s.step, text: m[1] });
    }
  }
  for (const c of read<Checks>("checks.json")?.checks ?? []) if (c.status === "fail") raw.push({ gate: "checks", text: `${c.id}: ${c.detail}` });
  for (const e of read<{ errors?: string[] }>("pcb/drc.json")?.errors ?? []) raw.push({ gate: "pcb", text: e });
  // verify's layers after the audit (whose errors drc.json has in full): the read-back, the firmware, their self-tests
  // and the order files. KiCad's does not hold back the board, so it is said apart.
  const v = read<{ layers?: { id: string; status: string; blocks?: false; errors?: string[] }[] }>("pcb/verify.json");
  let kicad: FaultCase["kicad"] = "not run";
  for (const l of v?.layers ?? []) {
    if (l.id === "kicad") kicad = l.status === "fail" ? "caught" : l.status === "pass" ? "missed" : "not run";
    else if (l.id !== "audit" && l.blocks !== false && l.status === "fail") for (const e of l.errors ?? []) raw.push({ gate: l.id, text: e });
  }
  // Each failing gate of the whole-product check, while system.json is of these files; else what the score says of it
  // (no system.json when the check could not run, or a self-test that missed a fault).
  const sys = read<SystemCheck>("system.json"), s = read<Score>("score.json");
  const failing = (sys?.gates ?? []).filter((g) => g.status !== "pass");
  const word = s?.system && !s.system.ok ? s.system.detail : undefined;
  const old = !!word && /^(no system\.json|system\.json is (of an earlier|not readable))/.test(word);
  if (word && (old || !failing.length)) raw.push({ gate: "score", text: word });
  if (!old) for (const g of failing) {
    const list = g.list ?? g.detail.replace(/; and \d+ more$/, "").split("; ");
    for (const p of list) raw.push({ gate: `system:${g.id}`, text: p });
  }
  if (s) {
    for (const r of s.coverage.missing) raw.push({ gate: "score", text: `the BOM has no ${r} (a role of the reference's)` });
    for (const id of s.cost.unpriced) raw.push({ gate: "score", text: `${id} has no price, so the total counts it as $0` });
    if (!s.cost.withinBand) raw.push({ gate: "score", text: `the cost is ${s.cost.deltaPct > 0 ? "+" : ""}${s.cost.deltaPct}% from the reference's, outside its 25% band` });
    for (const f of s.files) if (!f.ok) raw.push({ gate: "score", text: `${f.name}: ${f.detail}` });
  }
  // The copy's own folder is written as the product's, so the clean copy's problem and a fault's are the same text.
  const roots = [...new Set([resolve(dir, "..", ".."), realPath(resolve(dir, "..", ".."))])];
  const all = raw.map((p) => ({ ...p, text: roots.reduce((t, r) => t.split(`${r}/`).join(""), p.text) }));
  // A problem that says the run broke is a crash, never a catch (CRASH), wherever it was read (the board code's
  // exception is in drc.json and the score's line for the zip as well as on stderr), and after the file a score line
  // starts with.
  for (const p of all) if (CRASH.test(p.text) || CRASH.test(p.text.replace(FILE, ""))) p.gate += ":crash";
  const seen = new Set<string>(), problems: Problem[] = [], stale: string[] = [];
  for (const p of all) {
    const k = `${p.gate}\n${p.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (STALE.test(p.text.replace(FILE, ""))) stale.push(`${p.gate}: ${p.text}`);
    else problems.push(p);
  }
  return { problems, stale, kicad };
}

/** Runs the steps on the product in `root`/products/<slug>, one after another: sprue cad only when it has a cad/
 * folder and sprue verify only when it has a board (cad/pcb.mjs), as a user's run would. */
async function steps(root: string, slug: string): Promise<Said[]> {
  const out: Said[] = [], cad = join(root, "products", slug, "cad");
  for (const step of STEPS) {
    if (step === "cad" && !existsSync(cad)) continue;
    if (step === "verify" && !existsSync(join(cad, "pcb.mjs"))) continue;
    out.push(await run(root, step, slug));
  }
  return out;
}

/** The steps running now, so an interrupt can stop them. */
const running = new Set<ChildProcess>();

/** Stops every running step and what it started: each leads its own process group (run). */
function stopSteps() {
  for (const c of running) try { process.kill(-c.pid!, "SIGTERM"); } catch { /* gone already */ }
}

/** The signals that stop `sprue faults`: Ctrl-C, kill, a closed terminal, Ctrl-\ (quit). */
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

function run(cwd: string, step: string, slug: string): Promise<Said> {
  return new Promise((done) => {
    // No Python byte code in the copy's cad/ or the skill's: the copies go, and the skill's should not change. Each
    // step leads its own process group, so an interrupt stops the Python it started too.
    const child = spawn(BIN, [step, slug], { cwd, detached: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    running.add(child);
    let out = "", err = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", (e) => { running.delete(child); done({ step, code: null, out, err: `${err}\n✗ ${step}: ${e.message}` }); });
    child.on("close", (code) => { running.delete(child); done({ step, code, out, err }); });
  });
}

/** Runs `f` on each item, `jobs` at a time. */
async function pool<T, R>(items: T[], jobs: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  }));
  return out;
}

/** Whether a fault was caught, against the clean copy's problems: by a problem the clean copy does not have (numbers
 * aside) that names one of the fault's `expect` words. */
export function judge(f: FaultList["faults"][number], clean: Problem[], got: { problems: Problem[]; stale: string[]; kicad: FaultCase["kicad"] }): FaultCase {
  const before = new Set(clean.map((p) => shape(p.text)));
  const fresh = got.problems.filter((p) => !before.has(shape(p.text)));
  // Not a crash, nor the volume note, and named in the problem itself, not in the file a score line starts with.
  const hits = fresh.filter((p) => !p.gate.endsWith(":crash") && !VOLUME.test(p.text) &&
    f.expect.some((w) => names(p.gate === "score" ? p.text.replace(FILE, "") : p.text, w)));
  const broke = fresh.find((p) => p.gate.endsWith(":crash"));
  return {
    id: f.id, area: f.area, fault: f.fault, ran: true, caught: hits.length > 0, by: [...new Set(hits.map((p) => p.gate))],
    ...(hits.length ? { got: `${hits[0].gate}: ${hits[0].text}` } : {}), ...(broke ? { broke: `${broke.gate}: ${broke.text}` } : {}),
    new: fresh.slice(0, 12), stale: got.stale.slice(0, 6), ...(f.area === "pcb" ? { kicad: got.kicad } : {}),
  };
}

/** The clean copy's problems held to the known ones: those it has that the list does not know are false alarms. */
export function falseAlarms(clean: Problem[], known: FaultList["known"]) {
  const shapes = new Set(known.map((k) => shape(k.problem)));
  return {
    falseAlarms: clean.filter((p) => !shapes.has(shape(p.text))),
    known: known.map((k) => ({ ...k, seen: clean.some((p) => shape(p.text) === shape(k.problem)) })),
  };
}

/** `sprue faults <slug>`: every fault of reference/faults.json in a copy of its own, and a clean copy, through the
 * steps; writes faults.json and prints a line a fault. True when each fault was caught and the clean copy has no
 * problem the list does not know. */
export async function faults(slug: string, { keep = false, jobs = Math.max(1, Math.min(3, availableParallelism() - 1)) } = {}): Promise<boolean> {
  const t0 = Date.now(), dir = productDir(slug);
  const list = readFaultList(dir);
  const inputs = faultsInputs(dir);
  const tmp = mkdtempSync(join(tmpdir(), `sprue-faults-${slug}-`));
  // Stops the steps (and what they started) and removes the copies. A signal skips `finally`, so it does this and
  // exits as killed by it (128 and its number); the handlers stay until the copies are gone, so a second signal
  // (Ctrl-C twice, a closed terminal resending SIGHUP) waits for them rather than killing the run halfway. Leaving any
  // other way (an uncaught error, such as EPIPE when the output's reader goes) does it too. The steps are in groups
  // of their own, so a signal to this one's group reaches only it; a SIGKILL can't be caught, and its steps run on.
  const leave = () => {
    stopSteps();
    if (!keep) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  };
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    leave();
    process.exit(128 + constants.signals[signal]);
  };
  for (const sig of SIGNALS) process.on(sig, stop);
  process.once("exit", leave);
  try {
    console.log(`seeded faults: ${list.faults.length} faults and a clean copy of products/${slug}, each through sprue ${STEPS.join(", ")} (${jobs} at a time; a few minutes)`);
    const cases = [{ id: "clean", edit: [] as FaultEdit[] }, ...list.faults];
    const errors = new Map<string, string>();
    for (const c of cases) {
      const root = join(tmp, c.id);
      copyProduct(dir, join(root, "products", slug));
      try {
        applyEdits(join(root, "products", slug), c.edit);
      } catch (e) {
        errors.set(c.id, `the fault could not be put in: ${(e as Error).message}`);
      }
    }
    const runs = await pool(cases, jobs, async (c) => {
      if (errors.has(c.id)) return undefined;
      const root = join(tmp, c.id), said = await steps(root, slug);
      const got = collect(join(root, "products", slug), said);
      if (c.id !== "clean") console.log(`  · ${c.id} has run`);
      return got;
    });
    const clean = runs[0];
    if (!clean) throw new Error(errors.get("clean") ?? "the clean copy did not run");
    const { falseAlarms: alarms, known } = falseAlarms(clean.problems, list.known);
    const results: FaultCase[] = list.faults.map((f, i) => {
      const got = runs[i + 1];
      return got ? judge(f, clean.problems, got)
        : { id: f.id, area: f.area, fault: f.fault, ran: false, caught: false, by: [], new: [], stale: [], error: errors.get(f.id) };
    });
    const ran = results.filter((r) => r.ran), caught = ran.filter((r) => r.caught);
    const report: FaultsReport = {
      slug, ok: ran.length === results.length && caught.length === ran.length && !alarms.length && !clean.stale.length,
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      ran: ran.length, caught: caught.length, pct: ran.length ? Math.round((caught.length / ran.length) * 1000) / 10 : 0,
      missed: results.filter((r) => !r.caught).map((r) => r.id), falseAlarms: alarms.length,
      control: { problems: clean.problems, stale: clean.stale, falseAlarms: alarms, known },
      cases: results, inputs, seconds: Math.round((Date.now() - t0) / 100) / 10,
    };
    writeFileSync(join(dir, "faults.json"), JSON.stringify(report, null, 2) + "\n");
    for (const r of results)
      console.log(r.caught ? `  ✓ ${r.id}: ${r.fault}: caught by ${r.got}`
        : r.ran ? `  ✗ ${r.id}: ${r.fault}: missed (no new problem names ${list.faults.find((f) => f.id === r.id)!.expect.join(", ")}${r.broke ? `; the run broke: ${r.broke}` : ""})`
        : `  ✗ ${r.id}: ${r.error}`);
    for (const p of alarms) console.log(`  ✗ false alarm on the clean design: ${p.gate}: ${p.text}`);
    for (const k of known.filter((k) => !k.seen)) console.log(`  · the clean design no longer has "${k.problem}": take it out of reference/faults.json's known`);
    for (const s of clean.stale) console.log(`  ✗ the clean copy's run skipped a stage: ${s}`);
    console.log(`seeded faults: ${caught.length} of ${ran.length} caught (${report.pct}%)${ran.length < results.length ? `, ${results.length - ran.length} not put in` : ""}, ` +
      `${alarms.length} false alarm${alarms.length === 1 ? "" : "s"} on the clean design, ${report.seconds} s; wrote products/${slug}/faults.json` +
      (keep ? `; the copies are in ${tmp}` : ""));
    return report.ok;
  } finally {
    leave();
    for (const sig of SIGNALS) process.off(sig, stop);
    process.off("exit", leave);
  }
}
