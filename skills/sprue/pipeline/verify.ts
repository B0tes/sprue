// `sprue verify <slug>`: does the board work, as far as we can tell before a fab makes it? Layer by layer, each
// catching what the ones before it cannot:
//   1. the PCB audit, as `sprue pcb` runs it (pcb.ts): the footprints against their references, the drawn nets
//      against design.json's keys and keyMap, and our DRC, at least as strict as each fab profile;
//   2. the read-back (pcb/readback.py, Python): gerbonara and shapely, not our writer, read the very files in the zip
//      and the .d356, rebuild the copper, and compare the netlist it makes with the one design.json means;
//   3. its self-test: up to three faults put into copies of the files, each of which it must catch, so its pass
//      means something on this board (with none it can put in, it is not run, and the board is unverified);
//   4. for a keypad, the firmware in the loop (firmware/fil.ts): the board's own firmware (the code.py sprue pcb
//      wrote for its keys) on real CircuitPython and KMK, on an emulated Pico wired to the copper the read-back found,
//      must type each key's code, and each pair's; and its self-test, faults put into that netlist (a key shorted to
//      ground and, with two keys or more, two keys swapped and two GPIO nets joined), each of which it must catch.
//      It writes firmware/fil.json. A firmware/code.py of the user's own is run after it on the same copper, to say
//      what each key of it types; that layer is the user's code's, and does not hold back the board;
//   5. once the read-back has passed, the KiCad cross-check (pcb/kicad.py and kicad.ts): the board rebuilt in KiCad
//      from the zip, KiCad's own DRC on it with our rules and each fab's numbers and rule file, its IPC-D-356 against
//      ours, and faults put into copies that it must catch. It writes pcb/kicad.json. It is a second opinion, and
//      does not hold back the board: without KiCad installed it is not run, and the board is verified without it;
//   6. the order hand-off (pcb/order.ts), only once every layer above has passed: the zip for each fab profile the
//      board passes, in that fab's own file names and drill format, read back by readback.py as the board's own zip
//      was; only when each passes is pcb/order/ written (a README.md, the netlist, the previews and a folder per fab
//      with its zip and ORDER.md). With any layer failed or not run there is no pcb/order/, and it says why.
// It prints one line per layer (what was checked, and the first errors with what to do), writes pcb/verify.json and
// returns the exit status: 0 verified, 1 a check failed, 2 unverified (Python, gerbonara or shapely is missing, so
// the read-back could not run; its self-test had no fault to put in; or the firmware's emulator could not be
// fetched, or ran out of the computer's time; that is not a pass). Nothing is uploaded, quoted or ordered: fetch
// refuses every fab's host while it runs (guardNetwork, pcb/order.ts).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { exists, productDir, readJson, writeJson } from "./io.ts";
import { cacheDir } from "./firmware/cache.ts";
import { firmwareCheck, isYours, yourFirmware, yoursFailed, type FirmwareCheck, type Yours } from "./firmware/fil.ts";
import { clearOrder, fabPackages, guardNetwork, specProblems, THICKNESS_MM, verified, writeOrder, type FabPackage, type Skipped, type Verified } from "./pcb/order.ts";
import { kicadLayer, kicadPython, ruleSets, runKicad } from "./pcb/kicad.ts";
import type { Rules } from "./pcb/rules.ts";
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

/** Whether a path is there, as a link too: a venv whose Python was removed keeps a bin/python3 that points nowhere. */
const lexists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** The Python that runs the read-back and where it comes from: $SPRUE_PYTHON when it is set ("env"), else the
 * read-back's venv once it is made ("venv", even when its Python has gone since, so that is said and not passed over),
 * else python3 on the PATH ("path"). */
export function readbackInterpreter(): { python: string; from: "env" | "venv" | "path" } {
  if (process.env.SPRUE_PYTHON) return { python: process.env.SPRUE_PYTHON, from: "env" };
  const venv = join(readbackVenv(), "bin", "python3");
  return lexists(venv) ? { python: venv, from: "venv" } : { python: "python3", from: "path" };
}

export const readbackPython = () => readbackInterpreter().python;

/** A Python's version as [major, minor, micro], or undefined when it does not run. */
function pythonVersion(python: string): number[] | undefined {
  const r = spawnSync(python, ["-I", "-c", "import sys; print(*sys.version_info[:3])"], { encoding: "utf8", timeout: 20_000 });
  const m = r.status === 0 ? /^(\d+) (\d+) (\d+)/.exec(r.stdout ?? "") : null;
  return m ? m.slice(1).map(Number) : undefined;
}
const newEnough = (v?: number[]) => !!v && (v[0] > 3 || (v[0] === 3 && v[1] >= 12));

/** A Python 3.12 or newer on the PATH to make the venv with: python3 when it is new enough, else python3.14, 3.13 or
 * 3.12, the first that runs. Debian 12 and Ubuntu 22.04 keep python3 at 3.11 or 3.10 with a newer one beside it. */
export function newPython(): string | undefined {
  return ["python3", "python3.14", "python3.13", "python3.12"].find((p) => newEnough(pythonVersion(p)));
}

/** The line that makes the read-back's venv with `python` and installs the pins in it. With --clear, so a venv made
 * before, with an older Python or one removed since, is made again rather than kept with that Python in it. */
export function venvLine(python: string): string {
  const venv = shown(readbackVenv());
  return `${python} -m venv --clear ${venv} && ${venv}/bin/python -m pip install --no-deps -r ${shellQuote(REQUIREMENTS)}`;
}

/** What to do to get what the read-back needs: the venv line, with a Python 3.12 or newer the PATH has (or, with
 * none, after installing one), or the pins into $SPRUE_PYTHON's Python when that is set. */
export function installLine(): string {
  const req = shellQuote(REQUIREMENTS);
  if (process.env.SPRUE_PYTHON) return `${shellQuote(process.env.SPRUE_PYTHON)} -m pip install --no-deps -r ${req} (or unset SPRUE_PYTHON to use the read-back's own venv)`;
  const python = newPython();
  return python ? venvLine(python) : `install Python 3.12 or newer, then ${venvLine("python3.12")} (with the name of the Python you installed, if it is not python3.12)`;
}

/** pcb/readback.json, as readback.py writes it. */
export type Readback = {
  inputs: string; ok: boolean; errors: string[]; warnings: string[];
  files: { zip: { name: string; sha256: string; files: string[] }; netlist: { name: string; sha256: string } };
  tools: { python: string; gerbonara: string; shapely: string };
  checks: { id: string; checked: string; ok: boolean; errors: string[] }[];
  nets: Record<string, string[]>;
  stats: { islands: Record<string, number>; platedDrills: number; nets: number; d356Records: number; x2Objects: number; seconds: number };
  /** `ran` is false when no fault could be put into this board: the self-test did not run, which is not a pass. */
  selfTest?: { ok: boolean; ran?: boolean; control: { ok: boolean; errors: string[] }; cases: { fault: string; expect: string; ran: boolean; ok: boolean; got: string[] }[] };
};

/** How a run of the read-back went: "pass" or "fail" with its report, "unverified" when it could not run for want of
 * a tool (`fix` says what to install), "missing" when there are no files to read. */
export type ReadbackRun = { status: "pass" | "fail" | "unverified" | "missing"; report?: Readback; message: string; fix?: string };

/** Runs pcb/readback.py on products/<slug>/pcb/ (isolated, -I, since it reads generated files). The old readback.json
 * goes first, so a run that crashes leaves none for the scorer to trust. */
export function runReadback(slug: string, { selfTest = false } = {}): ReadbackRun {
  return runReadbackIn(join(productDir(slug), "pcb"), slug, { selfTest });
}

/** The first line readback.py prints, on stderr: without it, what ran was not a Python that runs it (a macOS
 * python3 stub with no developer tools, a pyenv shim with no version set, a Python 2). */
const STARTED = /^read-back: running on Python /;

/** Why the Python `from` gave cannot run the read-back, and what to do; `r` is the run that did not start it. */
function noPython(python: string, from: "env" | "venv" | "path", r: ReturnType<typeof spawnSync>, again: string): ReadbackRun {
  const out = `${r.stderr ?? ""}`.trim().split("\n").filter((l) => l && !STARTED.test(l));
  const said = r.error ? "" : `: it said ${out.length ? `"${out.slice(0, 2).join(" ").slice(0, 200)}"` : "nothing"} and exited ${r.status ?? r.signal}`;
  const venv = shown(readbackVenv());
  if (from === "env")
    return { status: "unverified", message: r.error ? `SPRUE_PYTHON is ${python}, and there is no Python there to run it` : `SPRUE_PYTHON is ${python}, which does not run Python${said}`, fix: `point SPRUE_PYTHON at Python 3.12 or newer, or unset it, ${again}` };
  if (from === "venv")
    return { status: "unverified", message: `the read-back's venv at ${venv} has no Python that runs (the Python it was made with was removed or moved)${said}`, fix: `make it again: ${installLine()}, ${again}` };
  return { status: "unverified", message: r.error ? "there is no python3 to run it" : `python3 here is not a Python that runs${said}`, fix: `${installLine()}, ${again}` };
}

/** Runs pcb/readback.py on a folder that holds a board.json, the zip it names and the netlist. */
function runReadbackIn(dir: string, slug: string, { selfTest = false } = {}): ReadbackRun {
  rmSync(join(dir, "readback.json"), { force: true });
  const { python, from } = readbackInterpreter();
  const r = spawnSync(python, ["-I", READBACK, dir, ...(selfTest ? ["--self-test"] : [])], { encoding: "utf8" });
  const lines = (r.stderr || "").trim().split("\n").filter(Boolean);
  const said = lines.filter((l) => !STARTED.test(l));
  const again = `then run sprue verify ${slug} again`;
  if (r.error || !lines.some((l) => STARTED.test(l))) return noPython(python, from, r, again);
  // 3: gerbonara or shapely is missing, or not at its pin; 4: the Python is older than 3.12. readback.py says which.
  if (r.status === 3) return { status: "unverified", message: said.at(-1) ?? `gerbonara or shapely is missing: ${installLine()}`, fix: `${installLine()}, ${again}` };
  if (r.status === 4) {
    const old = said.at(-1) ?? "the read-back needs Python 3.12 or newer";
    if (from === "env") return { status: "unverified", message: old, fix: `point SPRUE_PYTHON at Python 3.12 or newer, or unset it to use the read-back's own venv, ${again}` };
    if (from === "venv") {
      const version = /is (\d+\.\d+(?:\.\d+)?): /.exec(old)?.[1];
      return {
        status: "unverified", message: `the read-back's venv at ${shown(readbackVenv())} was made with Python ${version ?? "older than 3.12"}, and the read-back needs 3.12 or newer (gerbonara does)`,
        fix: `make the venv again with a Python 3.12 or newer: ${installLine()}, ${again}`,
      };
    }
    return { status: "unverified", message: old, fix: `${installLine()}, ${again}` };
  }
  if (r.status === 2) return { status: "missing", message: said.at(-1) ?? `no files to read: run sprue pcb ${slug}` };
  const path = join(dir, "readback.json");
  if ((r.status === 0 || r.status === 1) && existsSync(path)) {
    const report = JSON.parse(readFileSync(path, "utf8")) as Readback;
    return { status: report.ok ? "pass" : "fail", report, message: "" };
  }
  return { status: "fail", message: `the read-back stopped with an error, so it proves nothing: ${said.slice(-3).join(" ") || `exit status ${r.status}`}` };
}

/** One layer of the summary: what it checked, how it came out in a few words, its first errors and what to do.
 * `blocks: false` marks a layer that does not hold back the board (the user's own firmware, the KiCad cross-check):
 * its failure is said, and the board is verified without it; `aside` says why, in the order folder's README. */
export type Layer = { id: string; title: string; checked: string; status: "pass" | "fail" | "not run"; result: string; errors: string[]; fix?: string; blocks?: false; aside?: string };

/** Whether a layer failed that holds back the board. */
const failedLayer = (l: Layer) => l.status === "fail" && l.blocks !== false;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorCount = (errors: string[]) => (errors.length ? plural(errors.length, "error") : "0 errors");
const listed = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fabNames = "JLCPCB's, PCBWay's, OSH Park's and Aisler's";
const notRun = (result: string, fix?: string): Layer =>
  ({ id: "readback", title: "read-back", checked: "gerbonara and shapely on the files in the zip", status: "not run", result: `not run: ${result}`, errors: [], fix });

/** The audit, from drc.json as pcb() just wrote it. */
function auditLayer(slug: string, ok: boolean): Layer {
  const drc = exists(slug, "pcb/drc.json") ? readJson<{ errors?: string[]; fit?: { checked?: string[] }; intent?: unknown }>(slug, "pcb/drc.json") : { errors: ["no pcb/drc.json was written"] };
  const errors = drc.errors ?? [], fit = drc.fit?.checked ?? [];
  // A board with keys is held to design.json's keyMap; one with none only to what the controller's pins are for.
  const nets = drc.intent ? "the nets against design.json's keyMap" : "the controller's supply and control pins against its ground, and its 5 V against the pins that take 3.3 V (design.json gives no keys to hold the nets to)";
  return {
    id: "audit", title: "PCB audit",
    checked: `the footprints against their references, ${nets}, ${fit.length ? `the parts against the params the case is built from (${listed(fit)})` : "nothing against the params the case is built from"}, and our DRC within ${fabNames} 2-layer limits`,
    status: ok ? "pass" : "fail", result: errorCount(errors), errors: errors.slice(0, 3),
    fix: ok ? undefined : `fix cad/pcb.mjs, or design.json's params or keyMap, for the errors above, then run sprue verify ${slug} again`,
  };
}

/** What to do about the first failing check of the read-back. */
function readbackFix(slug: string, report: Readback): string {
  const first = report.checks.find((c) => !c.ok)?.id;
  if (first === "files" || first === "outline" || first === "drills")
    return `the zip is not what a fab expects: run sprue pcb ${slug} to write it again; if this stays, the writer in pipeline/pcb/gerber.ts is wrong, so do not order this zip`;
  if (first === "sizes" || first === "mask")
    return `a fab would not make what the audit passed (a feature under the rules' size, copper too close, or a mask or legend off its pads): run sprue pcb ${slug} to write the files again; if this stays, our writer (pipeline/pcb/layers.ts, gerber.ts) is wrong, so do not order this zip and report it`;
  return `the copper in the shipped files is not the circuit the audit passed: run sprue pcb ${slug} to write them again; if this stays, our writer and the read-back disagree, so do not order this zip and report it`;
}

function readbackLayers(slug: string, run: ReadbackRun): Layer[] {
  if (run.status === "unverified") return [notRun(run.message, run.fix ?? `${installLine()}, then run sprue verify ${slug} again`)];
  if (run.status === "missing") return [notRun(run.message, `run sprue pcb ${slug}, then sprue verify ${slug}`)];
  const r = run.report;
  if (!r) return [{ ...notRun(""), status: "fail", result: "it stopped", errors: [run.message], fix: `run sprue pcb ${slug}, then sprue verify ${slug}; if it stops again, report it` }];
  const title = "read-back";
  const s = r.stats;
  const keyed = exists(slug, "pcb/board.json") && !!readJson<{ intent?: unknown }>(slug, "pcb/board.json").intent;
  const checked = `gerbonara ${r.tools.gerbonara} and shapely ${r.tools.shapely} read the ${r.files.zip.files.length} files in ${r.files.zip.name} and ${r.files.netlist.name} ` +
    `and rebuilt the copper (${s.islands["F.Cu"]} islands on F.Cu, ${s.islands["B.Cu"]} on B.Cu, ${plural(s.platedDrills, "plated drill")}): its ${plural(s.nets, "net")} against ${keyed ? "design.json's" : "the ones the audit passed (design.json gives no keys)"}, ` +
    "and each feature's size, the mask and the legend, the netlist file, the drills, the X2 attributes, each file's function and statements and the outline against the board";
  const layers: Layer[] = [{
    id: "readback", title, checked, status: r.errors.length ? "fail" : "pass", result: errorCount(r.errors), errors: r.errors.slice(0, 3),
    fix: r.errors.length ? readbackFix(slug, r) : undefined,
  }];
  const t = r.selfTest;
  if (t && t.ran === false && t.control.ok)
    layers.push({
      id: "self-test", title: "read-back self-test", checked: "faults put into a copy of the files, which it must catch", status: "not run",
      result: `not run: no fault could be put into this board (${listed(t.cases.map((c) => c.expect))}), so the read-back's pass is not shown to mean anything here`, errors: [],
      fix: "the self-test has no fault for a board like this one yet: do not order the zip on the read-back's word alone, and report it",
    });
  else if (t) {
    const ran = t.cases.filter((c) => c.ran);
    const missed = ran.filter((c) => !c.ok);
    layers.push({
      id: "self-test", title: "read-back self-test",
      checked: `${ran.length ? listed(ran.map((c) => c.fault)) : "faults"}, ${ran.length === 1 ? "" : "each "}put into a copy of the files, must fail and an unchanged copy pass`,
      status: t.ok ? "pass" : "fail", result: t.ok ? `${ran.length === 1 ? "it" : "each"} was caught, and the unchanged copy passed` : plural(missed.length + (t.control.ok ? 0 : 1) + (ran.length ? 0 : 1), "problem"),
      errors: [...(t.control.ok ? [] : [`an unchanged copy of the files fails: ${t.control.errors[0] ?? "?"}`]), ...missed.map((c) => `${c.fault} was not caught as ${c.expect}`),
        ...(ran.length ? [] : ["no fault could be put into this board"])],
      fix: t.ok ? undefined : "the read-back misses faults on this board, so its pass means nothing here: do not order the zip, and report it",
    });
  }
  return layers;
}

/** The firmware layers: the run of the board's own firmware on the read-back's copper, its self-test, and the run of
 * a code.py of the user's own. None for a board with no firmware. */
function firmwareLayers(slug: string, run: FirmwareCheck): Layer[] {
  const title = "firmware";
  const checked = "the board's firmware, on CircuitPython and KMK on an emulated Pico wired to the copper the read-back found";
  if (run.status === "missing" && !run.message) return [];
  if (run.status === "missing")
    return [{ id: "firmware", title, checked, status: "not run", result: `not run: ${run.message}`, errors: [], fix: `run sprue pcb ${slug}, then sprue verify ${slug}` }];
  if (run.status === "unverified")
    return [{ id: "firmware", title, checked, status: "not run", result: `not run: ${run.message}`, errors: [], fix: `run sprue verify ${slug} again once that is fixed` }];
  const r = run.report!;
  const started = !r.errors.some((e) => /never became a keyboard/.test(e));
  const layers: Layer[] = [{
    id: "firmware", title, checked: r.checked, status: r.errors.length ? "fail" : "pass",
    result: r.errors.length ? errorCount(r.errors) : `0 errors in ${plural(r.stats.presses, "press", "presses")}`, errors: r.errors.slice(0, 3),
    fix: !r.errors.length ? undefined : started
      ? `the copper in the zip does not give each key its code with this firmware: fix cad/pcb.mjs (or design.json's keyMap) and run sprue verify ${slug} again; do not order this zip`
      : `the firmware does not start on the emulated Pico: see the serial output in products/${slug}/firmware/fil.json; do not order this zip until it does`,
  }];
  if (started) {
    const t = r.selfTest, missed = t.cases.filter((c) => !c.ok);
    layers.push({
      id: "firmware-self-test", title: "firmware self-test",
      checked: `${t.cases.length ? listed(t.cases.map((c) => c.fault)) : "faults"}, ${t.cases.length === 1 ? "" : "each "}put into the read-back's netlist, must make a key come out wrong`,
      status: t.ok ? "pass" : "fail", result: t.ok ? `${t.cases.length === 1 ? "it" : "each"} was caught` : plural(missed.length || 1, "problem"),
      errors: missed.length ? missed.map((c) => `${c.fault} was not caught`) : t.cases.length ? [] : ["no fault could be put into this board"],
      fix: t.ok ? undefined : "the firmware run misses faults on this board, so its pass means nothing here: do not order the zip, and report it",
    });
  }
  if (r.yours) layers.push(yoursLayer(slug, r.yours, r.firmware.file));
  return layers;
}

/** The layer of a firmware/code.py of the user's own: what each key types, and what is wrong with it, which is the
 * code's and not the board's. */
function yoursLayer(slug: string, y: Yours, board: string): Layer {
  const types = y.types.some((t) => t.codes.length) ? y.types.map((t) => `${t.key} ${t.names}`).join(", ") : "";
  return {
    id: "your-firmware", title: "your firmware", checked: y.checked, blocks: false,
    status: y.ok ? "pass" : "fail", result: y.ok ? `it started, and on its own ${types}` : `${errorCount(y.errors)}${types ? `; on its own ${types}` : ""}`,
    errors: y.errors.slice(0, 3),
    fix: y.ok ? undefined : `this is your code.py's, not the board's: the board passed with its own firmware, ${board}; fix yours, or copy ${board} over it, then run sprue verify ${slug} again`,
  };
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
  const tmp = mkdtempSync(join(tmpdir(), `sprue-order-${pkg.id}-`));
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
  const product = productDir(slug), again = `run sprue verify ${slug} again; if it stays, do not order these files, and report it`;
  clearOrder(join(product, "pcb"));
  let v: Verified, made: { packages: FabPackage[]; skipped: Skipped[] };
  try {
    v = verified(product);
    made = given ?? fabPackages(v);
  } catch (error) {
    return { layer: orderLayer("fail", "it stopped", [error instanceof Error ? error.message : String(error)], again), order: null };
  }
  // The forms ask for one board: the thickness bom.json orders is the one the case is built for and the profiles
  // were checked for.
  const spec = specProblems(product, v.board);
  if (spec.length)
    return {
      layer: orderLayer("fail", "bom.json and design.json do not give one board to order", spec,
        `give bom.json's PCB line spec.thicknessMm and design.json's pcbThicknessMm the same value, ${THICKNESS_MM} mm, and 2 layers, then run sprue verify ${slug} again`),
      order: null,
    };
  if (!made.packages.length)
    return { layer: orderLayer("fail", "no fab profile passes the board", made.skipped.map((s) => `${s.name}: ${s.why}`), `see the fab profiles sprue pcb ${slug} prints`), order: null };
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
  const mark = l.status === "pass" ? "✓" : failedLayer(l) ? "✗" : l.status === "fail" ? "⚑" : "·";
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

/** `sprue verify <slug>`. Returns the exit status. */
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
  // KiCad's DRC on the board rebuilt from the zip, once the read-back has found the zip to be the board.
  if (run.report && !run.report.errors.length) {
    // KiCad first: the fabs' rule files are fetched only for a KiCad to run them (without one, the rebuild still runs).
    const python = readbackPython(), found = kicadPython(python) !== undefined;
    console.log(found ? "rebuilding the board in KiCad from the zip and running KiCad's DRC on it (a few seconds; the first run fetches the fabs' KiCad rule files, a few kB)"
      : "rebuilding the board from the zip for KiCad (no KiCad was found, so its DRC will not run)");
    // The rules board.json carries, the ones the audit held the board to.
    const { sets, notes } = found ? await ruleSets(readJson<{ rules: Rules }>(slug, "pcb/board.json").rules) : { sets: [], notes: [] };
    layers.push(kicadLayer(slug, runKicad(join(productDir(slug), "pcb"), python, sets), notes));
  } else layers.push(kicadLayer(slug, { status: "not run", upstream: true, message: run.report ? "the read-back found errors, so the zip is not the board the audit passed" : "the read-back did not run, so the zip is not known to be the board" }));
  // The hand-off only when every layer above passed: pcb() has already removed any earlier pcb/order/.
  const firmwareOk = !keypad || fw.status === "pass";
  const noFault = run.report?.selfTest?.ran === false && run.report.selfTest.control.ok && !run.report.errors.length;
  const why = layers.some(failedLayer) ? "a layer above failed"
    : noFault ? "the read-back's self-test could put no fault into this board, so the board is not verified"
    : run.status !== "pass" ? "the read-back did not run, so the board is not verified"
    : !firmwareOk ? "the firmware did not run, so the board is not verified" : undefined;
  const hand = why ? { layer: orderLayer("not run", `not run: ${why}, and no order folder is written`), order: null } : handOff(slug, layers);
  layers.push(hand.layer);
  const status = layers.some(failedLayer) ? "failed" : hand.layer.status === "pass" ? "verified" : "unverified";
  const drc = exists(slug, "pcb/drc.json") ? readJson<{ inputs?: string }>(slug, "pcb/drc.json") : {};
  writeJson(slug, "pcb/verify.json", {
    slug, inputs: drc.inputs ?? null, status, zip: run.report?.files.zip ?? null, order: hand.order,
    note: "our own checks, not a fab's; nothing was uploaded, quoted or ordered", layers,
  });
  console.log(`verify ${slug} (our checks, not a fab's):`);
  for (const l of layers) printLayer(l);
  const where = `products/${slug}/pcb/verify.json`;
  // The layers that do not hold back the board and did not pass: said, so VERIFIED never reads as all of them passing.
  const asides = layers.filter((l) => l.blocks === false && l.status !== "pass").map((l) =>
    l.id === "your-firmware" ? "your firmware/code.py did not" : `the KiCad cross-check ${l.status === "fail" ? `did not: read products/${slug}/pcb/kicad.json before ordering` : "did not run"}`);
  if (status === "verified" && asides.length) console.log(`VERIFIED: every layer of the board passed (${listed(asides)}: see above). Wrote ${where} and the order folder products/${slug}/pcb/order/ (start with its README.md); nothing was uploaded, quoted or ordered`);
  else if (status === "verified") console.log(`VERIFIED: every layer passed. Wrote ${where} and the order folder products/${slug}/pcb/order/ (start with its README.md); nothing was uploaded, quoted or ordered`);
  else if (status === "unverified" && noFault) console.log(`UNVERIFIED: the read-back's self-test could put no fault into this board, so the board is not verified and no order folder was written. Wrote ${where}`);
  else if (status === "unverified" && run.status !== "pass") console.log(`UNVERIFIED: the read-back did not run, so the board is not verified and no order folder was written. Wrote ${where}`);
  else if (status === "unverified") console.log(`UNVERIFIED: the firmware did not run, so the board is not verified and no order folder was written. Wrote ${where}`);
  else console.log(`FAILED: do not order this board; no order folder was written. Wrote ${where}`);
  return status === "verified" ? 0 : status === "failed" ? 1 : 2;
}

/** The firmware layer's run, and what to print: firmware/fil.json written when it ran. Not run, and the fil.json of
 * an earlier run kept (the scorer reads a failure there until the zip or code.py changes), when `why` says why not. */
async function firmwareRun(slug: string, why: string): Promise<FirmwareCheck> {
  if (why) return { status: "unverified", message: why };
  const dir = productDir(slug), yours = isYours(dir);
  console.log(`running the board's firmware on an emulated Pico, wired to the copper read back (about a minute; the first run fetches CircuitPython, KMK and rp2040js, about 3 MB)${yours ? ", then your firmware/code.py (half a minute more)" : ""}`);
  let fw: FirmwareCheck;
  try {
    fw = await firmwareCheck(dir);
  } catch (error) {
    return { status: "unverified", message: `the emulator stopped with an error, so it proves nothing: ${error instanceof Error ? error.message : String(error)}` };
  }
  // Yours only on copper the board's firmware passed: then what it does is the code's, and whatever goes wrong with
  // it, a throw too, is its own layer's and leaves the board's run as it was.
  if (fw.report && fw.status === "pass" && yours)
    fw.report.yours = await yourFirmware(dir).catch((error) => yoursFailed(readFileSync(join(dir, "firmware", "code.py"), "utf8"), error));
  if (fw.report) writeJson(slug, "firmware/fil.json", fw.report);
  return fw;
}

/** After `sprue cad` built the board: the read-back without its self-test, so the scorer has a readback.json. When
 * Python's packages are missing it says how to install them, and the board stays unverified. False on a failure. */
export function readbackAfterBuild(slug: string): boolean {
  // A self-test that failed on this very zip stays failed: this run has none, and would otherwise drop it.
  const before = exists(slug, "pcb/readback.json") ? readJson<Readback>(slug, "pcb/readback.json") : undefined;
  const zipFile = join(productDir(slug), "pcb", before?.files?.zip?.name ?? "-");
  const kept = before?.selfTest && !before.selfTest.ok && before.selfTest.ran !== false && existsSync(zipFile) &&
    createHash("sha256").update(readFileSync(zipFile)).digest("hex") === before.files.zip.sha256 ? before.selfTest : undefined;
  const run = runReadback(slug);
  if (kept && run.report) {
    writeJson(slug, "pcb/readback.json", { ...run.report, ok: false, selfTest: kept });
    console.log(`  ✗ read-back: its self-test failed on this zip (sprue verify ran it), so the zip stays refused: see pcb/readback.json`);
    return false;
  }
  if (run.status === "pass") {
    console.log(`  ✓ read-back (gerbonara and shapely on the files in the zip): 0 errors, the nets design.json means; \`sprue verify ${slug}\` adds its self-test`);
    return true;
  }
  if (run.status === "unverified" || run.status === "missing") {
    console.log(`  · read-back not run: ${run.message}. Until it runs, sprue score and package refuse the zip`);
    return true;
  }
  console.log(`  ✗ read-back: ${run.report ? plural(run.report.errors.length, "error") : run.message}`);
  for (const e of run.report?.errors.slice(0, 3) ?? []) console.log(`      ${e}`);
  if (run.report) console.log(`      what to do: ${readbackFix(slug, run.report)}`);
  return false;
}
