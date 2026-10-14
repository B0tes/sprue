// `distinta verify <slug>`: does the board work, as far as we can tell before a fab makes it? Layer by layer, each
// catching what the ones before it cannot:
//   1. the PCB audit, as `distinta pcb` runs it (pcb.ts): the footprints against their references, the drawn nets
//      against design.json's keys and keyMap, and our DRC, at least as strict as each fab profile;
//   2. the read-back (pcb/readback.py, Python): gerbonara and shapely, not our writer, read the very files in the zip
//      and the .d356, rebuild the copper, and compare the netlist it makes with the one design.json means;
//   3. its self-test: three faults put into copies of the files, each of which it must catch, so its pass means
//      something on this board;
//   4. for a keypad, the firmware in the loop (firmware/fil.ts): the generated firmware/code.py on real CircuitPython
//      and KMK, on an emulated Pico wired to the copper the read-back found, must type each key's code, and each
//      pair's; and its self-test, three faults put into that netlist (a key shorted to ground, two keys swapped, two
//      GPIO nets joined), each of which it must catch. It writes firmware/fil.json;
//   5. the order hand-off (pcb/order.ts), only once every layer above has passed: the zip for each fab profile the
//      board passes, in that fab's own file names and drill format, read back by readback.py as the board's own zip
//      was; only when each passes is pcb/order/ written (a README.md, the netlist, the previews and a folder per fab
//      with its zip and ORDER.md). With any layer failed or not run there is no pcb/order/, and it says why.
// It prints one line per layer (what was checked, and the first errors with what to do), writes pcb/verify.json and
// returns the exit status: 0 verified, 1 a check failed, 2 unverified (Python, gerbonara or shapely is missing, so
// the read-back could not run, or the firmware's emulator could not be fetched; that is not a pass). Nothing is
// uploaded, quoted or ordered: fetch refuses every fab's host while it runs (guardNetwork, pcb/order.ts).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { exists, productDir, readJson, writeJson } from "./io.ts";
import { cacheDir } from "./firmware/cache.ts";
import { firmwareCheck, type FirmwareCheck } from "./firmware/fil.ts";
import { clearOrder, fabPackages, guardNetwork, verified, writeOrder, type FabPackage, type Skipped, type Verified } from "./pcb/order.ts";
import { pcb } from "./pcb.ts";

export const READBACK = join(import.meta.dirname, "pcb", "readback.py");
export const REQUIREMENTS = join(import.meta.dirname, "pcb", "requirements.txt");

/** `s` as a shell takes it: as it is when it holds nothing a shell reads as special, else in single quotes. */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);
/** A path for a command line: under the home folder as ~/..., as a shell expands it. */
const shown = (path: string) => {
  const home = homedir(), rest = path.slice(home.length);
  return path.startsWith(home + sep) && shellQuote(rest) === rest ? `~${rest}` : shellQuote(path);
};

/** The read-back's own Python: a venv in the cache the firmware's pieces go to. A venv, since pip may not install into
 * the system Python (PEP 668: Debian, Ubuntu, Homebrew), and in it no other gerbonara or shapely gets in the way. */
export const readbackVenv = () => join(cacheDir(), "venv");

/** The Python that runs the read-back: $DISTINTA_PYTHON when it is set, else the read-back's venv once it is made,
 * else python3. */
export function readbackPython(): string {
  if (process.env.DISTINTA_PYTHON) return process.env.DISTINTA_PYTHON;
  const venv = join(readbackVenv(), "bin", "python3");
  return existsSync(venv) ? venv : "python3";
}

/** The command that installs what the read-back needs: the venv, and gerbonara and shapely at their pins in it (or
 * into $DISTINTA_PYTHON's Python, when that is set). readback.py prints the same line. */
export function installLine(): string {
  const req = shellQuote(REQUIREMENTS);
  if (process.env.DISTINTA_PYTHON) return `${shellQuote(process.env.DISTINTA_PYTHON)} -m pip install --no-deps -r ${req} (or unset DISTINTA_PYTHON to use the read-back's own venv)`;
  const venv = shown(readbackVenv());
  return `python3 -m venv ${venv} && ${venv}/bin/python -m pip install --no-deps -r ${req}`;
}

/** pcb/readback.json, as readback.py writes it. */
export type Readback = {
  inputs: string; ok: boolean; errors: string[]; warnings: string[];
  files: { zip: { name: string; sha256: string; files: string[] }; netlist: { name: string; sha256: string } };
  tools: { python: string; gerbonara: string; shapely: string };
  checks: { id: string; checked: string; ok: boolean; errors: string[] }[];
  nets: Record<string, string[]>;
  stats: { islands: Record<string, number>; platedDrills: number; nets: number; d356Records: number; x2Objects: number; seconds: number };
  selfTest?: { ok: boolean; control: { ok: boolean; errors: string[] }; cases: { fault: string; expect: string; ran: boolean; ok: boolean; got: string[] }[] };
};

/** How a run of the read-back went: "pass" or "fail" with its report, "unverified" when it could not run for want of
 * a tool (`fix` says what to install), "missing" when there are no files to read. */
export type ReadbackRun = { status: "pass" | "fail" | "unverified" | "missing"; report?: Readback; message: string; fix?: string };

/** Runs pcb/readback.py on products/<slug>/pcb/ (isolated, -I, since it reads generated files). The old readback.json
 * goes first, so a run that crashes leaves none for the scorer to trust. */
export function runReadback(slug: string, { selfTest = false } = {}): ReadbackRun {
  return runReadbackIn(join(productDir(slug), "pcb"), slug, { selfTest });
}

/** Runs pcb/readback.py on a folder that holds a board.json, the zip it names and the netlist. */
function runReadbackIn(dir: string, slug: string, { selfTest = false } = {}): ReadbackRun {
  rmSync(join(dir, "readback.json"), { force: true });
  const python = readbackPython(), install = installLine();
  const r = spawnSync(python, ["-I", READBACK, dir, ...(selfTest ? ["--self-test"] : [])], { encoding: "utf8" });
  const said = (r.stderr || "").trim().split("\n").filter(Boolean);
  const again = `then run distinta verify ${slug} again`;
  if (r.error) {
    if (process.env.DISTINTA_PYTHON)
      return { status: "unverified", message: `DISTINTA_PYTHON is ${python}, and there is no Python there to run it`, fix: `point DISTINTA_PYTHON at Python 3.12 or newer, or unset it, ${again}` };
    return { status: "unverified", message: "there is no python3 to run it", fix: `install Python 3.12 or newer, then ${install}, ${again}` };
  }
  // 3: gerbonara or shapely is missing, or not at its pin; 4: the Python is older than 3.12. readback.py says which.
  if (r.status === 3) return { status: "unverified", message: said.at(-1) ?? `gerbonara or shapely is missing: ${install}`, fix: `${install}, ${again}` };
  if (r.status === 4) return { status: "unverified", message: said.at(-1) ?? "the read-back needs Python 3.12 or newer", fix: `install Python 3.12 or newer, then ${install}, ${again}` };
  if (r.status === 2) return { status: "missing", message: said.at(-1) ?? `no files to read: run distinta pcb ${slug}` };
  const path = join(dir, "readback.json");
  if ((r.status === 0 || r.status === 1) && existsSync(path)) {
    const report = JSON.parse(readFileSync(path, "utf8")) as Readback;
    return { status: report.ok ? "pass" : "fail", report, message: "" };
  }
  return { status: "fail", message: `the read-back stopped with an error, so it proves nothing: ${said.slice(-3).join(" ") || `exit status ${r.status}`}` };
}

/** One layer of the summary: what it checked, how it came out in a few words, its first errors and what to do. */
export type Layer = { id: string; title: string; checked: string; status: "pass" | "fail" | "not run"; result: string; errors: string[]; fix?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorCount = (errors: string[]) => (errors.length ? plural(errors.length, "error") : "0 errors");
const listed = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fabNames = "JLCPCB's, PCBWay's, OSH Park's and Aisler's";
const notRun = (result: string, fix?: string): Layer =>
  ({ id: "readback", title: "read-back", checked: "gerbonara and shapely on the files in the zip", status: "not run", result: `not run: ${result}`, errors: [], fix });

/** The audit, from drc.json as pcb() just wrote it. */
function auditLayer(slug: string, ok: boolean): Layer {
  const drc = exists(slug, "pcb/drc.json") ? readJson<{ errors?: string[] }>(slug, "pcb/drc.json") : { errors: ["no pcb/drc.json was written"] };
  const errors = drc.errors ?? [];
  return {
    id: "audit", title: "PCB audit",
    checked: `the footprints against their references, the nets against design.json's keyMap, the parts against the params the case is built from, and our DRC within ${fabNames} 2-layer limits`,
    status: ok ? "pass" : "fail", result: errorCount(errors), errors: errors.slice(0, 3),
    fix: ok ? undefined : `fix cad/pcb.mjs (or design.json's keyMap) for the errors above, then run distinta verify ${slug} again`,
  };
}

/** What to do about the first failing check of the read-back. */
function readbackFix(slug: string, report: Readback): string {
  const first = report.checks.find((c) => !c.ok)?.id;
  if (first === "files" || first === "outline" || first === "drills")
    return `the zip is not what a fab expects: run distinta pcb ${slug} to write it again; if this stays, the writer in pipeline/pcb/gerber.ts is wrong, so do not order this zip`;
  if (first === "sizes" || first === "mask")
    return `a fab would not make what the audit passed (a feature under the rules' size, copper too close, or a mask or legend off its pads): run distinta pcb ${slug} to write the files again; if this stays, our writer (pipeline/pcb/layers.ts, gerber.ts) is wrong, so do not order this zip and report it`;
  return `the copper in the shipped files is not the circuit the audit passed: run distinta pcb ${slug} to write them again; if this stays, our writer and the read-back disagree, so do not order this zip and report it`;
}

function readbackLayers(slug: string, run: ReadbackRun): Layer[] {
  if (run.status === "unverified") return [notRun(run.message, run.fix ?? `${installLine()}, then run distinta verify ${slug} again`)];
  if (run.status === "missing") return [notRun(run.message, `run distinta pcb ${slug}, then distinta verify ${slug}`)];
  const r = run.report;
  if (!r) return [{ ...notRun(""), status: "fail", result: "it stopped", errors: [run.message], fix: `run distinta pcb ${slug}, then distinta verify ${slug}; if it stops again, report it` }];
  const title = "read-back";
  const s = r.stats;
  const checked = `gerbonara ${r.tools.gerbonara} and shapely ${r.tools.shapely} read the ${r.files.zip.files.length} files in ${r.files.zip.name} and ${r.files.netlist.name} ` +
    `and rebuilt the copper (${s.islands["F.Cu"]} islands on F.Cu, ${s.islands["B.Cu"]} on B.Cu, ${plural(s.platedDrills, "plated drill")}): its ${plural(s.nets, "net")} against design.json's, ` +
    "and each feature's size, the mask and the legend, the netlist file, the drills, the X2 attributes, each file's function and statements and the outline against the board";
  const layers: Layer[] = [{
    id: "readback", title, checked, status: r.errors.length ? "fail" : "pass", result: errorCount(r.errors), errors: r.errors.slice(0, 3),
    fix: r.errors.length ? readbackFix(slug, r) : undefined,
  }];
  const t = r.selfTest;
  if (t) {
    const ran = t.cases.filter((c) => c.ran);
    const missed = ran.filter((c) => !c.ok);
    layers.push({
      id: "self-test", title: "read-back self-test",
      checked: `${ran.length ? listed(ran.map((c) => c.fault)) : "faults"}, each put into a copy of the files, must fail and an unchanged copy pass`,
      status: t.ok ? "pass" : "fail", result: t.ok ? "each was caught, and the unchanged copy passed" : plural(missed.length + (t.control.ok ? 0 : 1) + (ran.length ? 0 : 1), "problem"),
      errors: [...(t.control.ok ? [] : [`an unchanged copy of the files fails: ${t.control.errors[0] ?? "?"}`]), ...missed.map((c) => `${c.fault} was not caught as ${c.expect}`),
        ...(ran.length ? [] : ["no fault could be put into this board"])],
      fix: t.ok ? undefined : "the read-back misses faults on this board, so its pass means nothing here: do not order the zip, and report it",
    });
  }
  return layers;
}

/** The firmware layers: the run on the read-back's copper, and its self-test. None for a board with no firmware. */
function firmwareLayers(slug: string, run: FirmwareCheck): Layer[] {
  const title = "firmware";
  const checked = "firmware/code.py, on CircuitPython and KMK on an emulated Pico wired to the copper the read-back found";
  if (run.status === "missing") return [];
  if (run.status === "unverified")
    return [{ id: "firmware", title, checked, status: "not run", result: `not run: ${run.message}`, errors: [], fix: `run distinta verify ${slug} again once that is fixed` }];
  const r = run.report!;
  const started = !r.errors.some((e) => /never became a keyboard|ran out of time/.test(e));
  const layers: Layer[] = [{
    id: "firmware", title, checked: r.checked, status: r.errors.length ? "fail" : "pass",
    result: r.errors.length ? errorCount(r.errors) : `0 errors in ${plural(r.stats.presses, "press", "presses")}`, errors: r.errors.slice(0, 3),
    fix: !r.errors.length ? undefined : started
      ? `the copper in the zip does not give each key its code with this firmware: fix cad/pcb.mjs (or design.json's keyMap) and run distinta verify ${slug} again; do not order this zip`
      : `the firmware does not start on the emulated Pico: see the serial output in products/${slug}/firmware/fil.json; do not order this zip until it does`,
  }];
  if (started) {
    const t = r.selfTest, missed = t.cases.filter((c) => !c.ok);
    layers.push({
      id: "firmware-self-test", title: "firmware self-test",
      checked: `${t.cases.length ? listed(t.cases.map((c) => c.fault)) : "faults"}, each put into the read-back's netlist, must make a key come out wrong`,
      status: t.ok ? "pass" : "fail", result: t.ok ? "each was caught" : plural(missed.length || 1, "problem"),
      errors: missed.length ? missed.map((c) => `${c.fault} was not caught`) : t.cases.length ? [] : ["no fault could be put into this board"],
      fix: t.ok ? undefined : "the firmware run misses faults on this board, so its pass means nothing here: do not order the zip, and report it",
    });
  }
  return layers;
}

// ---- the order hand-off ----

const orderLayer = (status: Layer["status"], result: string, errors: string[] = [], fix?: string): Layer => ({
  id: "order", title: "order files", status, result, errors, fix,
  checked: "the zip for each fab profile the board passes, in that fab's own file names and drill format, read back by gerbonara and shapely as the board's own zip was",
});

/** What verify.json says of the hand-off: the folder, each fab's zip with its sha256 and files, and the profiles that
 * got no folder. */
export type OrderSummary = { dir: string; fabs: { id: string; name: string; zip: string; sha256: string; files: string[] }[]; skipped: Skipped[] };

/** Reads one fab's zip back, in a folder of its own: board.json with that zip's names for the layers, the zip and
 * the netlist beside it. */
function readBackPackage(slug: string, v: Verified, pkg: FabPackage): ReadbackRun {
  const tmp = mkdtempSync(join(tmpdir(), `distinta-order-${pkg.id}-`));
  try {
    writeFileSync(join(tmp, "board.json"), JSON.stringify({ ...v.board, files: pkg.roles }));
    writeFileSync(join(tmp, pkg.zip), pkg.bytes);
    writeFileSync(join(tmp, v.board.files.netlist), v.d356);
    return runReadbackIn(tmp, slug);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The last layer, once every other one has passed: each fab's zip (pcb/order.ts, or `given`) is read back, and only
 * when every one reads back as the board is pcb/order/ written, whole. Any earlier pcb/order/ goes first. */
export function handOff(slug: string, layers: Layer[], given?: { packages: FabPackage[]; skipped: Skipped[] }): { layer: Layer; order: OrderSummary | null } {
  const product = productDir(slug), again = `run distinta verify ${slug} again; if it stays, do not order these files, and report it`;
  clearOrder(join(product, "pcb"));
  let v: Verified, made: { packages: FabPackage[]; skipped: Skipped[] };
  try {
    v = verified(product);
    made = given ?? fabPackages(v);
  } catch (error) {
    return { layer: orderLayer("fail", "it stopped", [error instanceof Error ? error.message : String(error)], again), order: null };
  }
  if (!made.packages.length)
    return { layer: orderLayer("fail", "no fab profile passes the board", made.skipped.map((s) => `${s.name}: ${s.why}`), `see the fab profiles distinta pcb ${slug} prints`), order: null };
  const runs = made.packages.map((p) => ({ p, run: readBackPackage(slug, v, p) }));
  const bad = runs.filter((r) => r.run.status !== "pass");
  if (bad.length) {
    const errors = bad.flatMap(({ p, run }) => (run.report?.errors.length ? run.report.errors : [run.message]).map((e) => `${p.zip}: ${e}`));
    return {
      layer: orderLayer("fail", `${listed(bad.map((b) => b.p.name))}'s zip does not read back as the board: ${errorCount(errors)}`, errors.slice(0, 3),
        `our writer of that fab's zip (pipeline/pcb/order.ts) is wrong, so no order folder was written: report it`),
      order: null,
    };
  }
  writeOrder(product, v, made.packages, made.skipped, layers, runs[0].run.report!.tools);
  const names = made.packages.map((p) => p.name);
  return {
    layer: orderLayer("pass", `0 errors in each; wrote products/${slug}/pcb/order/ for ${listed(names)}${made.skipped.length ? `, none for ${listed(made.skipped.map((s) => s.name))}` : ""}`),
    order: {
      dir: "pcb/order", skipped: made.skipped,
      fabs: made.packages.map((p) => ({ id: p.id, name: p.name, zip: `${p.id}/${p.zip}`, sha256: p.sha256, files: p.files.map((f) => f.name) })),
    },
  };
}

/** Prints one layer: its mark, what it checked and, when it did not pass, its first errors and what to do. */
function printLayer(l: Layer) {
  const mark = l.status === "pass" ? "✓" : l.status === "fail" ? "✗" : "·";
  console.log(`  ${mark} ${l.title}: ${l.checked}: ${l.result}`);
  for (const e of l.errors) console.log(`      ${e}`);
  if (l.fix) console.log(`      what to do: ${l.fix}`);
}

/** Whether the board is a keypad with firmware: board.json lists its keys (pcb.ts writes them only for a board whose
 * audit passed). A code.py in firmware/ of a board with no keys is not run. */
export function hasFirmware(slug: string): boolean {
  if (!exists(slug, "pcb/board.json")) return false;
  const keys = readJson<{ firmware?: unknown }>(slug, "pcb/board.json").firmware;
  return Array.isArray(keys) && keys.length > 0;
}

/** `distinta verify <slug>`. Returns the exit status. */
export async function verify(slug: string): Promise<number> {
  guardNetwork();
  if (!exists(slug, "cad/pcb.mjs")) {
    console.log(`verify ${slug}: products/${slug} has no board (cad/pcb.mjs), so there is nothing to verify: verify checks a PCB's files and its firmware, and this product has none`);
    return 2;
  }
  const audited = await pcb(slug);
  const layers: Layer[] = [auditLayer(slug, audited)];
  const run: ReadbackRun = audited ? runReadback(slug, { selfTest: true }) : { status: "missing", message: "the audit found errors, so there are no files to read back" };
  if (audited) layers.push(...readbackLayers(slug, run));
  else layers.push(notRun("the audit wrote no files to read"));
  // The firmware runs on the copper the read-back found, so only once it has found it and passed.
  const keypad = hasFirmware(slug);
  const notYet = run.status === "pass" ? "" : run.status === "fail" ? "the read-back did not pass, so there is no copper to wire the firmware to"
    : "the read-back did not run, so there is no copper to wire the firmware to";
  const fw = keypad ? await firmwareRun(slug, notYet) : { status: "missing" as const, message: "" };
  layers.push(...firmwareLayers(slug, fw));
  // The hand-off only when every layer above passed: pcb() has already removed any earlier pcb/order/.
  const firmwareOk = !keypad || fw.status === "pass";
  const why = layers.some((l) => l.status === "fail") ? "a layer above failed"
    : run.status !== "pass" ? "the read-back did not run, so the board is not verified"
    : !firmwareOk ? "the firmware did not run, so the board is not verified" : undefined;
  const hand = why ? { layer: orderLayer("not run", `not run: ${why}, and no order folder is written`), order: null } : handOff(slug, layers);
  layers.push(hand.layer);
  const status = layers.some((l) => l.status === "fail") ? "failed" : hand.layer.status === "pass" ? "verified" : "unverified";
  const drc = exists(slug, "pcb/drc.json") ? readJson<{ inputs?: string }>(slug, "pcb/drc.json") : {};
  writeJson(slug, "pcb/verify.json", {
    slug, inputs: drc.inputs ?? null, status, zip: run.report?.files.zip ?? null, order: hand.order,
    note: "our own checks, not a fab's; nothing was uploaded, quoted or ordered", layers,
  });
  console.log(`verify ${slug} (our checks, not a fab's):`);
  for (const l of layers) printLayer(l);
  const where = `products/${slug}/pcb/verify.json`;
  if (status === "verified") console.log(`VERIFIED: every layer passed. Wrote ${where} and the order folder products/${slug}/pcb/order/ (start with its README.md); nothing was uploaded, quoted or ordered`);
  else if (status === "unverified" && run.status !== "pass") console.log(`UNVERIFIED: the read-back did not run, so the board is not verified and no order folder was written. Wrote ${where}`);
  else if (status === "unverified") console.log(`UNVERIFIED: the firmware did not run, so the board is not verified and no order folder was written. Wrote ${where}`);
  else console.log(`FAILED: do not order this board; no order folder was written. Wrote ${where}`);
  return status === "verified" ? 0 : status === "failed" ? 1 : 2;
}

/** The firmware layer's run, and what to print: firmware/fil.json written when it ran. Not run, and the fil.json of
 * an earlier run kept (the scorer reads a failure there until the zip or code.py changes), when `why` says why not. */
async function firmwareRun(slug: string, why: string): Promise<FirmwareCheck> {
  if (!exists(slug, "firmware/code.py")) return { status: "unverified", message: "there is no firmware/code.py to run: run distinta pcb, which writes it" };
  if (why) return { status: "unverified", message: why };
  console.log(`running firmware/code.py on an emulated Pico, wired to the copper read back (about a minute; the first run fetches CircuitPython, KMK and rp2040js, about 3 MB)`);
  let fw: FirmwareCheck;
  try {
    fw = await firmwareCheck(productDir(slug));
  } catch (error) {
    return { status: "unverified", message: `the emulator stopped with an error, so it proves nothing: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (fw.report) writeJson(slug, "firmware/fil.json", fw.report);
  return fw;
}

/** After `distinta cad` built the board: the read-back without its self-test, so the scorer has a readback.json. When
 * Python's packages are missing it says how to install them, and the board stays unverified. False on a failure. */
export function readbackAfterBuild(slug: string): boolean {
  // A self-test that failed on this very zip stays failed: this run has none, and would otherwise drop it.
  const before = exists(slug, "pcb/readback.json") ? readJson<Readback>(slug, "pcb/readback.json") : undefined;
  const zipFile = join(productDir(slug), "pcb", before?.files?.zip?.name ?? "-");
  const kept = before?.selfTest && !before.selfTest.ok && existsSync(zipFile) &&
    createHash("sha256").update(readFileSync(zipFile)).digest("hex") === before.files.zip.sha256 ? before.selfTest : undefined;
  const run = runReadback(slug);
  if (kept && run.report) {
    writeJson(slug, "pcb/readback.json", { ...run.report, ok: false, selfTest: kept });
    console.log(`  ✗ read-back: its self-test failed on this zip (distinta verify ran it), so the zip stays refused: see pcb/readback.json`);
    return false;
  }
  if (run.status === "pass") {
    console.log(`  ✓ read-back (gerbonara and shapely on the files in the zip): 0 errors, the nets design.json means; \`distinta verify ${slug}\` adds its self-test`);
    return true;
  }
  if (run.status === "unverified" || run.status === "missing") {
    console.log(`  · read-back not run: ${run.message}. Until it runs, distinta score and package refuse the zip`);
    return true;
  }
  console.log(`  ✗ read-back: ${run.report ? plural(run.report.errors.length, "error") : run.message}`);
  for (const e of run.report?.errors.slice(0, 3) ?? []) console.log(`      ${e}`);
  if (run.report) console.log(`      what to do: ${readbackFix(slug, run.report)}`);
  return false;
}
