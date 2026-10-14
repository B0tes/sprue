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
//      GPIO nets joined), each of which it must catch. It writes firmware/fil.json.
// It prints one line per layer (what was checked, and the first errors with what to do), writes pcb/verify.json and
// returns the exit status: 0 verified, 1 a check failed, 2 unverified (Python, gerbonara or shapely is missing, so
// the read-back could not run, or the firmware's emulator could not be fetched; that is not a pass). Nothing is
// uploaded, quoted or ordered.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exists, productDir, readJson, writeJson } from "./io.ts";
import { firmwareCheck, type FirmwareCheck } from "./firmware/fil.ts";
import { pcb } from "./pcb.ts";

export const READBACK = join(import.meta.dirname, "pcb", "readback.py");
export const REQUIREMENTS = join(import.meta.dirname, "pcb", "requirements.txt");
export const INSTALL = `python3 -m pip install --no-deps -r ${REQUIREMENTS}`;

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
 * a tool, "missing" when there are no files to read. */
export type ReadbackRun = { status: "pass" | "fail" | "unverified" | "missing"; report?: Readback; message: string };

/** Runs pcb/readback.py on products/<slug>/pcb/ (isolated, -I, since it reads generated files). The old readback.json
 * goes first, so a run that crashes leaves none for the scorer to trust. */
export function runReadback(slug: string, { selfTest = false } = {}): ReadbackRun {
  const dir = join(productDir(slug), "pcb");
  rmSync(join(dir, "readback.json"), { force: true });
  const r = spawnSync("python3", ["-I", READBACK, dir, ...(selfTest ? ["--self-test"] : [])], { encoding: "utf8" });
  const said = (r.stderr || "").trim().split("\n").filter(Boolean);
  if (r.error) return { status: "unverified", message: `there is no python3 to run it: install Python 3.12 or newer, then ${INSTALL}` };
  if (r.status === 3) return { status: "unverified", message: said.at(-1) ?? `gerbonara or shapely is missing: ${INSTALL}` };
  if (r.status === 2) return { status: "missing", message: said.at(-1) ?? `no files to read: run distinta pcb ${slug}` };
  const path = join(dir, "readback.json");
  if ((r.status === 0 || r.status === 1) && existsSync(path)) {
    const report = JSON.parse(readFileSync(path, "utf8")) as Readback;
    return { status: report.ok ? "pass" : "fail", report, message: "" };
  }
  return { status: "fail", message: `the read-back stopped with an error, so it proves nothing: ${said.slice(-3).join(" ") || `exit status ${r.status}`}` };
}

/** One layer of the summary: what it checked, how it came out in a few words, its first errors and what to do. */
type Layer = { id: string; title: string; checked: string; status: "pass" | "fail" | "not run"; result: string; errors: string[]; fix?: string };

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
    checked: `the footprints against their references, the nets against design.json's keyMap, and our DRC within ${fabNames} 2-layer limits`,
    status: ok ? "pass" : "fail", result: errorCount(errors), errors: errors.slice(0, 3),
    fix: ok ? undefined : `fix cad/pcb.mjs (or design.json's keyMap) for the errors above, then run distinta verify ${slug} again`,
  };
}

/** What to do about the first failing check of the read-back. */
function readbackFix(slug: string, report: Readback): string {
  const first = report.checks.find((c) => !c.ok)?.id;
  if (first === "files" || first === "outline" || first === "drills")
    return `the zip is not what a fab expects: run distinta pcb ${slug} to write it again; if this stays, the writer in pipeline/pcb/gerber.ts is wrong, so do not order this zip`;
  return `the copper in the shipped files is not the circuit the audit passed: run distinta pcb ${slug} to write them again; if this stays, our writer and the read-back disagree, so do not order this zip and report it`;
}

function readbackLayers(slug: string, run: ReadbackRun): Layer[] {
  if (run.status === "unverified") return [notRun(run.message, `${INSTALL}, then run distinta verify ${slug} again`)];
  if (run.status === "missing") return [notRun(run.message, `run distinta pcb ${slug}, then distinta verify ${slug}`)];
  const r = run.report;
  if (!r) return [{ ...notRun(""), status: "fail", result: "it stopped", errors: [run.message], fix: `run distinta pcb ${slug}, then distinta verify ${slug}; if it stops again, report it` }];
  const title = "read-back";
  const s = r.stats;
  const checked = `gerbonara ${r.tools.gerbonara} and shapely ${r.tools.shapely} read the ${r.files.zip.files.length} files in ${r.files.zip.name} and ${r.files.netlist.name} ` +
    `and rebuilt the copper (${s.islands["F.Cu"]} islands on F.Cu, ${s.islands["B.Cu"]} on B.Cu, ${plural(s.platedDrills, "plated drill")}): its ${plural(s.nets, "net")} against design.json's, ` +
    "and the netlist file, the drills, the X2 attributes, each file's function and the outline against the board";
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
  const checked = "the generated firmware/code.py, on CircuitPython and KMK on an emulated Pico wired to the copper the read-back found";
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

/** Prints one layer: its mark, what it checked and, when it did not pass, its first errors and what to do. */
function printLayer(l: Layer) {
  const mark = l.status === "pass" ? "✓" : l.status === "fail" ? "✗" : "·";
  console.log(`  ${mark} ${l.title}: ${l.checked}: ${l.result}`);
  for (const e of l.errors) console.log(`      ${e}`);
  if (l.fix) console.log(`      what to do: ${l.fix}`);
}

/** `distinta verify <slug>`. Returns the exit status. */
export async function verify(slug: string): Promise<number> {
  const audited = await pcb(slug);
  const layers: Layer[] = [auditLayer(slug, audited)];
  const run: ReadbackRun = audited ? runReadback(slug, { selfTest: true }) : { status: "missing", message: "the audit found errors, so there are no files to read back" };
  if (audited) layers.push(...readbackLayers(slug, run));
  else layers.push(notRun("the audit wrote no files to read"));
  // The firmware runs on the copper the read-back found, so only once it has found it and passed.
  const keypad = exists(slug, "firmware/code.py");
  const fw = await firmwareRun(slug, keypad && run.status === "pass");
  layers.push(...firmwareLayers(slug, fw));
  const failed = layers.some((l) => l.status === "fail");
  const firmwareOk = !keypad || fw.status === "pass";
  const status = failed ? "failed" : run.status === "pass" && firmwareOk ? "verified" : "unverified";
  const drc = exists(slug, "pcb/drc.json") ? readJson<{ inputs?: string }>(slug, "pcb/drc.json") : {};
  writeJson(slug, "pcb/verify.json", {
    slug, inputs: drc.inputs ?? null, status, zip: run.report?.files.zip ?? null,
    note: "our own checks, not a fab's; nothing was uploaded, quoted or ordered", layers,
  });
  console.log(`verify ${slug} (our checks, not a fab's):`);
  for (const l of layers) printLayer(l);
  const where = `products/${slug}/pcb/verify.json`;
  if (status === "verified") console.log(`VERIFIED: every layer passed. Wrote ${where}`);
  else if (status === "unverified" && run.status !== "pass") console.log(`UNVERIFIED: the read-back did not run, so the board is not verified. Wrote ${where}`);
  else if (status === "unverified") console.log(`UNVERIFIED: the firmware did not run, so the board is not verified. Wrote ${where}`);
  else console.log(`FAILED: do not order this board. Wrote ${where}`);
  return status === "verified" ? 0 : status === "failed" ? 1 : 2;
}

/** The firmware layer's run: firmware/fil.json written (or removed, when it could not run), and what to print. Not
 * run when `go` is false: no firmware, or no read-back that passed to wire it to. */
async function firmwareRun(slug: string, go: boolean): Promise<FirmwareCheck> {
  const file = join(productDir(slug), "firmware", "fil.json");
  rmSync(file, { force: true });
  if (!exists(slug, "firmware/code.py")) return { status: "missing", message: "" };
  if (!go) return { status: "unverified", message: "the read-back did not pass, so there is no copper to wire the firmware to" };
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
  const run = runReadback(slug);
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
