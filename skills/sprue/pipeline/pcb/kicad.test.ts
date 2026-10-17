// Tests of the KiCad cross-check (kicad.py, kicad.ts): the macropad rebuilt in KiCad from its zip, its DRC with our
// rules and the fabs', the netlist diff and the self-test, faults put into the shipped files, a rule file KiCad cannot
// load, and the layer verify prints. Run them with
//   node --test skills/sprue/pipeline/pcb/kicad.test.ts
// The ones that read the zip need the read-back's Python (gerbonara and shapely); the ones that run the DRC also need
// KiCad's Python (pcbnew). Without them they are skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pcb } from "../pcb.ts";
import { installLine, readbackPython } from "../verify.ts";
import { unzip, zip } from "./gerber.ts";
import { fabKicadRules, KICAD, kicadLayer, kicadPython, ourKicadRules, ruleFiles, RULE_FILES, type KicadReport, type RuleSet } from "./kicad.ts";
import { RULES } from "./rules.ts";

const PYTHON = readbackPython();
const ready = spawnSync(PYTHON, ["-I", "-c", "import gerbonara, shapely"]).status === 0;
const skip = ready ? false : `gerbonara and shapely are not installed (${installLine()})`;
const kicad = ready ? kicadPython(PYTHON) : undefined;
const skipKicad = skip || (!kicad && "no Python with KiCad's pcbnew is installed");
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

/** Builds a product's board with `sprue pcb` in a temporary products/ folder: the macropad's files, or these, with
 * `edit` made to its cad/pcb.mjs. Returns its pcb/ folder. */
async function build(slug = "macropad", { edit, files }: { edit?: (code: string) => string; files?: Record<string, string> } = {}): Promise<string> {
  const tmp = temp("sprue-kicad-"), here = process.cwd(), log = console.log;
  const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", slug);
  if (files) for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(dst, f)), { recursive: true }); writeFileSync(join(dst, f), text); }
  else for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
  if (edit) writeFileSync(join(dst, "cad", "pcb.mjs"), edit(readFileSync(join(dst, "cad", "pcb.mjs"), "utf8")));
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb(slug), true);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  return join(dst, "pcb");
}

let built: Promise<string> | undefined;
/** The macropad's pcb/ folder, built once. */
const macropad = (): Promise<string> => (built ??= build());

/** Runs kicad.py on a pcb/ folder as it is. */
function run(dir: string, flags = ["--self-test"]) {
  const r = spawnSync(PYTHON, ["-I", KICAD, dir, ...flags], { encoding: "utf8" });
  return { status: r.status, report: JSON.parse(readFileSync(join(dir, "kicad.json"), "utf8")) as KicadReport, said: r.stdout + r.stderr };
}

type Board = { files: Record<string, string>; pads: { id: string; x: number; y: number; layers: string[] }[] };

/** Runs kicad.py on a copy of the macropad's pcb/ folder, with `change` made to the files in its zip and these rule
 * sets. */
async function check({ change, netlist, sets, flags = ["--self-test"] }: { change?: (files: Map<string, string>, board: Board) => void; netlist?: (text: string) => string; sets?: RuleSet[]; flags?: string[] } = {}) {
  const src = await macropad(), dir = temp("sprue-kicad-copy-");
  const board = JSON.parse(readFileSync(join(src, "board.json"), "utf8")) as Board;
  for (const f of ["board.json", board.files.netlist]) cpSync(join(src, f), join(dir, f));
  if (netlist) writeFileSync(join(dir, board.files.netlist), netlist(readFileSync(join(dir, board.files.netlist), "utf8")));
  const files = new Map(unzip(readFileSync(join(src, board.files.zip))).map((f) => [f.name, f.data.toString("utf8")]));
  change?.(files, board);
  writeFileSync(join(dir, board.files.zip), zip([...files].map(([name, data]) => ({ name, data }))));
  const args = [...flags];
  if (sets) {
    writeFileSync(join(dir, "rules.json"), JSON.stringify({ ruleSets: sets }));
    args.push("--rules", join(dir, "rules.json"));
  }
  const r = spawnSync(PYTHON, ["-I", KICAD, dir, ...args], { encoding: "utf8" });
  const report = JSON.parse(readFileSync(join(dir, "kicad.json"), "utf8")) as KicadReport;
  return { status: r.status, report, said: r.stdout + r.stderr };
}

/** A Gerber layer with one more stroke along `pts` before its end: dark adds copper, clear takes it away. */
function stroke(text: string, width: number, pts: [number, number][], dark: boolean): string {
  const code = Math.max(9, ...[...text.matchAll(/%ADD(\d+)/g)].map((m) => Number(m[1]))) + 1;
  const xy = ([x, y]: [number, number]) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
  const cmds = [`%ADD${code}C,${width.toFixed(6)}*%`, dark ? "%LPD*%" : "%LPC*%", `D${code}*`, `${xy(pts[0])}D02*`, ...pts.slice(1).map((p) => `${xy(p)}D01*`), "%LPD*%"];
  return text.replace(/M02\*\n$/, `${cmds.join("\n")}\nM02*\n`);
}

/** A Gerber layer with one more region (a polygon) before its end: dark adds copper, clear takes it away. */
function region(text: string, pts: [number, number][], dark: boolean): string {
  const xy = ([x, y]: [number, number]) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
  const cmds = [dark ? "%LPD*%" : "%LPC*%", "G36*", `${xy(pts[0])}D02*`, ...[...pts.slice(1), pts[0]].map((p) => `${xy(p)}D01*`), "G37*", "%LPD*%"];
  return text.replace(/M02\*\n$/, `${cmds.join("\n")}\nM02*\n`);
}

/** A Gerber layer with the longest straight draw on a net other than `but` turned into a move (D02), so that piece of
 * track is gone; and that net. Our writer gives each draw its X and Y and its net in %TO.N. */
function cutLongest(text: string, but = "GND"): { text: string; net: string } {
  const lines = text.split("\n");
  let net = "", at: [number, number] | undefined, best = { len: 0, i: -1, net: "" };
  lines.forEach((l, i) => {
    const n = /^%TO\.N,(.*)\*%$/.exec(l);
    if (n) net = n[1];
    if (l === "%TD*%") net = "";
    const m = /^X(-?\d+)Y(-?\d+)D0([12])\*$/.exec(l);
    if (!m) return;
    const p: [number, number] = [Number(m[1]) / 1e6, Number(m[2]) / 1e6];
    if (m[3] === "1" && at && net && net !== but && Math.hypot(p[0] - at[0], p[1] - at[1]) > best.len) best = { len: Math.hypot(p[0] - at[0], p[1] - at[1]), i, net };
    at = p;
  });
  assert.ok(best.i >= 0, "no draw to cut");
  lines[best.i] = lines[best.i].replace(/D01\*$/, "D02*");
  return { text: lines.join("\n"), net: best.net };
}

/** kicad.py's own functions, run in the read-back's Python on `code`'s input: prints what `code` prints. */
function python(code: string): string {
  const r = spawnSync(PYTHON, ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(dirname(KICAD))}); import kicad\n${code}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const ours: RuleSet = { id: "ours", title: "our rules", source: "", ruleFile: null, rules: ourKicadRules(RULES), dru: "" };

test("a fab's published limits become KiCad's design settings, and a limit it does not publish is not checked", () => {
  const jlc = fabKicadRules("jlcpcb", RULES), pcbway = fabKicadRules("pcbway", RULES);
  assert.equal(jlc.clearanceMm, 0.1);
  assert.equal(jlc.holeGapMm, 0.45);
  assert.equal(jlc.maskWebMm, 0.1);
  // PCBWay publishes no copper-to-hole limit and no mask web: 0, so KiCad checks neither, as the audit does not.
  assert.equal(pcbway.holeClearMm, 0);
  assert.equal(pcbway.maskWebMm, 0);
  // The mask openings are the files' own, and the pour keeps the fab's clearance.
  assert.equal(jlc.maskExpandMm, RULES.maskExpandMm);
  assert.equal(jlc.pourClearanceMm, undefined);
  // Ours: the narrowest copper is the narrower of a track and a neck of pour.
  assert.equal(ourKicadRules(RULES).trackMinMm, Math.min(RULES.trackMinMm, RULES.copperMinMm));
  assert.equal(ourKicadRules(RULES).pourClearanceMm, RULES.pourClearanceMm);
});

test("a rule file in the cache that is not the one pinned is not used, and with SPRUE_OFFLINE=1 nothing is fetched", async () => {
  const cache = temp("sprue-kicad-cache-"), was = process.env.SPRUE_CACHE;
  try {
    process.env.SPRUE_CACHE = cache;
    const pin = RULE_FILES.aisler;
    cpSync(join(import.meta.dirname, "kicad.py"), join(cache, "kicad", `aisler-${pin.sha256.slice(0, 12)}.kicad_dru`));
    const { texts, notes } = await ruleFiles({ offline: true });
    assert.deepEqual(texts, {});
    assert.deepEqual(notes, Object.values(RULE_FILES).map((f) => `${f.name} is not in the cache and SPRUE_OFFLINE=1 says not to fetch it, so that fab's run uses its published numbers alone`));
  } finally {
    if (was === undefined) delete process.env.SPRUE_CACHE;
    else process.env.SPRUE_CACHE = was;
  }
});

test("the layer says what KiCad checked, and does not hold back the board when it fails or cannot run", () => {
  const report = (change: Partial<KicadReport> = {}): KicadReport => ({
    ok: true, status: "pass", kicad: "7.0.11", python: "/usr/bin/python3", zip: { name: "t-gerbers.zip", sha256: "" }, errors: [],
    rebuilt: { pads: 2, vias: 1, npth: 0, tracks: 3, outline: 4, pours: [] },
    ruleSets: [{ id: "ours", title: "our rules", status: "pass", note: "", ruleFileLoaded: true, canaryHits: 4, errors: [], warnings: [] },
      { id: "aisler", title: "Aisler's numbers and Aisler's 2-layer rule file", status: "pass", note: "", ruleFileLoaded: true, canaryHits: 4, errors: [], warnings: [] }],
    netlist: { ok: true, ours: 3, kicad: 3, matched: 3, onlyOurs: [], onlyKicad: [] },
    selfTest: { ok: true, cases: [{ fault: "a track cut out", expect: "unconnected_items", ok: true, got: "" }] }, ...change,
  });
  let l = kicadLayer("t", { status: "pass", report: report(), message: "" });
  assert.equal(l.blocks, false);
  assert.equal(l.status, "pass");
  assert.equal(l.result, "0 errors with ours and Aisler's; 3 of 3 netlist records match KiCad's; the fault was caught");
  assert.match(l.checked, /^the board rebuilt in KiCad 7\.0\.11 from the zip \(2 pads, 1 via, 3 tracks, 0 non-plated holes\), KiCad's DRC on it with our rules and Aisler's numbers and Aisler's 2-layer rule file, its IPC-D-356 netlist against ours, and 1 fault put into copies/);
  // A fab's rule file that could not be had is said, and the board still passes.
  const offline = "kicad-druid's JLCPCB 2-layer 1 oz rules could not be fetched from Cimos/kicad-druid (offline), so that fab's run uses its published numbers alone";
  l = kicadLayer("t", { status: "pass", report: report(), message: "" }, [offline]);
  assert.deepEqual(l.errors, [offline]);
  const failed = report({ ok: false, status: "fail", ruleSets: [{ id: "ours", title: "our rules", status: "fail", note: "", ruleFileLoaded: true, canaryHits: 4, errors: ["[clearance] Clearance violation"], warnings: [] }] });
  l = kicadLayer("t", { status: "fail", report: failed, message: "" });
  assert.equal(l.status, "fail");
  assert.deepEqual(l.errors, ["our rules: [clearance] Clearance violation"]);
  assert.match(l.fix ?? "", /^KiCad and our DRC disagree about these files: read products\/t\/pcb\/kicad\.json before ordering/);
  // Every error counts, though only two a rule set are shown.
  const many = report({ ok: false, status: "fail", ruleSets: [{ id: "ours", title: "our rules", status: "fail", note: "", ruleFileLoaded: true, canaryHits: 4, errors: Array.from({ length: 40 }, (_, i) => `[clearance] ${i}`), warnings: [] },
    { id: "jlcpcb", title: "JLCPCB's numbers", status: "fail", note: "", ruleFileLoaded: true, canaryHits: 4, errors: Array.from({ length: 25 }, (_, i) => `[clearance] ${i}`), warnings: [] }] });
  l = kicadLayer("t", { status: "fail", report: many, message: "" });
  assert.equal(l.result, "65 problems");
  assert.equal(l.errors.length, 3);

  // Not found: install KiCad. Found, but its DRC did not run (another pcbnew): report it, not install it.
  const notFound = report({ ok: false, status: "not run", kicad: null, python: null, ruleSets: [], netlist: null, selfTest: null, note: "no Python with KiCad's pcbnew was found (tried python3): install KiCad, or point SPRUE_KICAD_PYTHON at its Python" });
  l = kicadLayer("t", { status: "not run", report: notFound, message: notFound.note! });
  assert.equal(l.status, "not run");
  assert.match(l.checked, /^the board rebuilt for KiCad from the zip \(2 pads.*\), and KiCad's DRC on it$/);
  // The reason once, in the result; what to do about it once, in the fix.
  assert.equal(l.result, "not run: no Python with KiCad's pcbnew was found (tried python3)");
  assert.match(l.fix ?? "", /^install KiCad \(7\.0\.11 is the version the check is tested on; its Python comes with it\), or point SPRUE_KICAD_PYTHON/);
  const drift = report({ ok: false, status: "not run", kicad: "9.0.1", ruleSets: [], netlist: null, selfTest: null, note: "KiCad's DRC with our rules did not run: AttributeError: module 'pcbnew' has no attribute 'EDA_UNITS_MILLIMETRES'" });
  l = kicadLayer("t", { status: "not run", report: drift, message: drift.note! });
  assert.match(l.checked, /^the board rebuilt in KiCad 9\.0\.1 \(the check is tested on KiCad 7\.0\.11\) from the zip .*, and KiCad's DRC on it$/);
  assert.equal(l.result, "not run: AttributeError: module 'pcbnew' has no attribute 'EDA_UNITS_MILLIMETRES'");
  assert.equal(l.fix, "the check is tested on KiCad 7.0.11, and pcbnew changes between versions: report it with products/t/pcb/kicad.json");
  // On the version it is tested on, nothing is said about versions.
  const same = report({ ok: false, status: "not run", ruleSets: [], netlist: null, selfTest: null, note: "KiCad 7.0.11 did not finish the check: it timed out" });
  l = kicadLayer("t", { status: "not run", report: same, message: same.note! });
  assert.equal(l.result, "not run: KiCad 7.0.11 did not finish the check: it timed out");
  assert.equal(l.fix, "run sprue verify t again; if it stays, report it with products/t/pcb/kicad.json");
  // Not run because the read-back did not pass: the read-back's line says what to do.
  l = kicadLayer("t", { status: "not run", upstream: true, message: "the read-back found errors, so the zip is not the board the audit passed" });
  assert.equal(l.fix, undefined);

  // The rebuild stopped (our reader, not KiCad): no DRC, netlist or faults are claimed, with or without KiCad.
  const stopped = report({ ok: false, status: "fail", kicad: null, python: null, rebuilt: undefined, ruleSets: [], netlist: null, selfTest: null,
    errors: ["the board cannot be rebuilt in KiCad from the zip: macropad-NPTH.drl has a slot, which the rebuild does not make yet"] });
  l = kicadLayer("t", { status: "fail", report: stopped, message: "" });
  assert.equal(l.status, "fail");
  assert.equal(l.checked, "the board read from the zip to be rebuilt in KiCad");
  assert.equal(l.result, "1 problem in the rebuild, so KiCad's DRC did not run");
  assert.match(l.fix ?? "", /^these files use something the KiCad check cannot rebuild yet \(our reader stopped, not KiCad\)/);
  // A pour that joins two nets is a failure even with no KiCad to run.
  const short = report({ ok: false, status: "fail", kicad: null, python: null, ruleSets: [], netlist: null, selfTest: null, note: "no Python with KiCad's pcbnew was found (tried python3)",
    errors: ["the pour on F.Cu touches copper of GND, GP6: it joins nets"] });
  l = kicadLayer("t", { status: "fail", report: short, message: "" });
  assert.equal(l.status, "fail");
  assert.equal(l.result, "1 problem in the rebuild, and the DRC did not run (no Python with KiCad's pcbnew was found (tried python3))");
  assert.deepEqual(l.errors, ["the pour on F.Cu touches copper of GND, GP6: it joins nets"]);
  assert.match(l.fix ?? "", /^the files join two nets where our DRC saw none/);
  // The same with KiCad found but its DRC not run: no rule sets to list.
  for (const change of [{ note: "KiCad 7.0.11 did not finish the check: it timed out", ruleSets: [] },
    { note: "KiCad's DRC with our rules did not run: KiCad could not load the rule file", ruleSets: [{ ...report().ruleSets[0], status: "not run" as const, note: "KiCad could not load the rule file" }] }]) {
    l = kicadLayer("t", { status: "fail", report: { ...short, kicad: "7.0.11", python: "/usr/bin/python3", ...change }, message: "" });
    assert.match(l.checked, /^the board rebuilt in KiCad 7\.0\.11 from the zip \(.*\), and KiCad's DRC on it$/);
    assert.equal(l.result, `1 problem in the rebuild, and the DRC did not run (${change.note.replace("KiCad's DRC with our rules did not run: ", "")})`);
    assert.match(l.fix ?? "", /^the files join two nets where our DRC saw none/);
  }

  // No fault could be put in: said as such, not as each of 0 faults caught.
  l = kicadLayer("t", { status: "pass", report: report({ status: "partial", selfTest: { ok: false, ran: false, cases: [] } }), message: "" });
  assert.match(l.result, /; no fault could be put into this board, so the self-test did not run$/);
  assert.match(l.checked, /and no faults put into copies/);
  // Rules of a fab's file that KiCad skipped are said beside a pass.
  const skipped = report({ status: "partial", ruleSets: [report().ruleSets[0], { ...report().ruleSets[1], skippedRules: ["hole to hole"], note: "KiCad 7.0.11 skipped 1 of the file's 4 rules, whose conditions it could not compile: hole to hole" }] });
  l = kicadLayer("t", { status: "pass", report: skipped, message: "" });
  assert.deepEqual(l.errors, ["Aisler's numbers and Aisler's 2-layer rule file: KiCad 7.0.11 skipped 1 of the file's 4 rules, whose conditions it could not compile: hole to hole"]);
});

test("a rule file fetched and matching its pin is used even when the cache cannot keep it", async () => {
  const was = process.env.SPRUE_CACHE, file = join(temp("sprue-kicad-nocache-"), "a-file");
  writeFileSync(file, "");
  try {
    process.env.SPRUE_CACHE = join(file, "cache");
    const text = '(version 1)\n(rule "x" (constraint track_width (min 0.1mm)))\n';
    const sha = (await import("node:crypto")).createHash("sha256").update(text).digest("hex");
    const pins = { x: { name: "a rule file", repo: "o/r", url: "https://raw.githubusercontent.com/o/r/0/x.kicad_dru", sha256: sha } };
    const { texts, notes } = await ruleFiles({ offline: false, pins, get: async () => new Response(text) });
    assert.equal((texts as Record<string, string>).x, text);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^a rule file was fetched and used, but could not be kept in the cache .*: not a directory|ENOTDIR/);
    // One that does not match its pin is not used.
    const bad = await ruleFiles({ offline: false, pins, get: async () => new Response(text + " ") });
    assert.deepEqual(bad.texts, {});
    assert.match(bad.notes[0], /is not the file pinned \(its sha256 differs\), so it is not used and that fab's run uses its published numbers alone: report it$/);
  } finally {
    if (was === undefined) delete process.env.SPRUE_CACHE;
    else process.env.SPRUE_CACHE = was;
  }
});

test("a violation KiCad files as a local override (an open net, a zone's clearance) keeps its severity, and counts as an error", { skip }, () => {
  const out = python(`import json
text = '''** Found 2 DRC violations **
[unconnected_items]: Missing connection between items
    Local override; Severity: error
    @(15.7500 mm, -38.4500 mm): Track [GP4] on B.Cu, length 8.6267 mm
    @(9.6500 mm, 27.5500 mm): Track [GP4] on B.Cu, length 1.1314 mm
[clearance]: Clearance violation (netclass 'Default' clearance 0.2000 mm; actual 0.1000 mm)
    Rule: netclass 'Default'; Severity: warning
    @(1.0000 mm, 2.0000 mm): Track [GND] on F.Cu
[track_dangling]: Track has unconnected end
    Severity: whatever
    @(1.0000 mm, 2.0000 mm): Track [GND] on F.Cu
'''
v = kicad.parse_report(text)
print(json.dumps([[x["kind"], x["rule"], x["severity"], x["items"][0]["y"]] for x in v]))
j = kicad.judged({"loaded": True, "violations": v + [{"kind": "assertion_failure", "text": "", "rule": kicad.CANARY, "severity": "error", "items": []}]}, {"id": "ours", "title": "ours"})
print(json.dumps([j["status"], len(j["errors"]), len(j["warnings"])]))`);
  const [parsed, judged] = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(parsed, [["unconnected_items", "", "error", 38.45], ["clearance", "netclass 'Default'", "warning", -2], ["track_dangling", "", "whatever", -2]]);
  // A severity worded some other way fails rather than passes.
  assert.deepEqual(judged, ["fail", 2, 1]);
});

test("copper KiCad cannot hold as pads and tracks (a clear draw erasing a pad) stops the rebuild, which is a failure", { skip }, async () => {
  const { status, report } = await check({
    change: (files, board) => {
      const p = board.pads.find((x) => x.id === "K1.A")!, name = board.files[p.layers[0]];
      files.set(name, stroke(files.get(name)!, 1.0, [[p.x, p.y], [p.x + 0.1, p.y]], false));
    },
  });
  assert.equal(status, 1);
  assert.equal(report.status, "fail");
  assert.match(report.errors[0], /^the board cannot be rebuilt in KiCad from the zip: B\.Cu: a clear draw at \(-26\.41, -29\.54\) erases copper drawn before it/);
});

test("a clear region erasing a track drawn before it stops the rebuild too", { skip }, async () => {
  const { status, report } = await check({
    change: (files, board) => {
      const name = board.files["B.Cu"], { text } = cutLongest(files.get(name)!);
      // The square sits across the start of the longest signal draw, whatever it is: find it the same way.
      const lines = files.get(name)!.split("\n"), i = text.split("\n").findIndex((l, k) => l !== lines[k]);
      const m = /^X(-?\d+)Y(-?\d+)D01\*$/.exec(lines[i])!, [x, y] = [Number(m[1]) / 1e6, Number(m[2]) / 1e6];
      files.set(name, region(files.get(name)!, [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]], false));
    },
  });
  assert.equal(status, 1);
  assert.match(report.errors[0], /^the board cannot be rebuilt in KiCad from the zip: B\.Cu: a clear region at \(.*\) erases copper drawn before it/);
});

test("the macropad rebuilt from its zip passes KiCad's DRC with our rules, its netlist matches ours, and each planted fault is caught", { skip: skipKicad }, async () => {
  const { status, report, said } = await check();
  assert.equal(status, 0, said);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.rebuilt, { pads: 58, vias: 18, npth: 53, tracks: 111, outline: 68, pours: [{ layer: "F.Cu", net: "GND", touches: ["GND"] }] });
  assert.equal(report.ruleSets[0].errors.length, 0);
  assert.ok(report.ruleSets[0].canaryHits > 0);
  assert.deepEqual([report.netlist?.ours, report.netlist?.matched], [129, 129]);
  assert.deepEqual(report.selfTest?.cases.map((c) => [c.fault.replace(/ \(.*/, ""), c.ok]), [
    ["a track joining U1.14", true], ["a 59.9 mm track of GP4 cut out", true], ["the GND pour on F.Cu grown over U1.1", true], ["a track 0.1 mm from the board edge at", true],
  ]);
});

test("a sliver joining two nets in the shipped copper, or a rule set the board does not meet, fails KiCad's DRC", { skip: skipKicad }, async () => {
  const short = await check({
    flags: [],
    change: (files, board) => {
      const a = board.pads.find((x) => x.id === "K5.A")!, b = board.pads.find((x) => x.id === "K5.B")!, name = board.files["B.Cu"];
      files.set(name, stroke(files.get(name)!, 0.3, [[a.x, a.y], [b.x, b.y]], true));
    },
  });
  assert.equal(short.status, 1);
  assert.equal(short.report.status, "fail");
  assert.ok(short.report.ruleSets[0].errors.some((e) => /^\[(clearance|shorting_items)\]/.test(e) && /K5|GP6|GND/.test(e)), short.report.ruleSets[0].errors.join("\n"));
  // Clearance of 0.5 mm, which the board does not keep: KiCad finds it, where its other rules pass.
  const strict = await check({ flags: [], sets: [{ ...ours, id: "strict", title: "0.5 mm clearance", rules: { ...ours.rules, clearanceMm: 0.5, pourClearanceMm: 0.5 } }] });
  assert.equal(strict.report.status, "fail");
  assert.ok(strict.report.ruleSets[0].errors.every((e) => e.startsWith("[clearance]")), strict.report.ruleSets[0].errors.join("\n"));
});

test("a rule file KiCad cannot load says that fab's rules were not checked, and does not fail the board", { skip: skipKicad }, async () => {
  const broken = { ...ours, id: "broken", title: "a broken rule file", dru: '(version 1)\n(rule "x"\n\t(constraint no_such_constraint (min 1mm)))\n' };
  const unknownLayer = { ...ours, id: "layer", title: "a rule on a layer no board has", dru: '(version 1)\n(rule "y"\n\t(layer "F.Nowhere")\n\t(constraint track_width (min 0.1mm)))\n' };
  // A file KiCad loads, one of whose conditions it cannot compile: it skips that rule without a word, and the probe says so.
  const partly = { ...ours, id: "partly", title: "a rule file with a condition KiCad cannot compile", dru: '(version 1)\n(rule "fine"\n\t(condition "A.Type == \'Via\'")\n\t(constraint hole_size (min 0.1mm)))\n(rule "no such function"\n\t(condition "A.noSuchFunc()")\n\t(constraint track_width (min 0.1mm)))\n(rule "cut short"\n\t(condition "A.Type == ")\n\t(constraint track_width (min 0.1mm)))\n' };
  const { status, report } = await check({ flags: [], sets: [ours, broken, unknownLayer, partly] });
  assert.equal(status, 0);
  assert.equal(report.status, "partial");
  assert.deepEqual(report.ruleSets.map((s) => s.status), ["pass", "not run", "not run", "pass"]);
  for (const s of report.ruleSets.slice(1, 3)) assert.match(s.note, /could not load the rule file|the canary rule did not fire/);
  assert.deepEqual(report.ruleSets[3].skippedRules, ["no such function", "cut short"]);
  assert.match(report.ruleSets[3].note, /^KiCad 7\.0\.11 skipped 2 of the file's 3 rules, whose conditions it could not compile: no such function, cut short$/);
});

test("the probe reads a rule file as KiCad 7 does: '#' lines are comments, a rule's last condition counts, and one that does not balance is not probed", { skip }, () => {
  const out = python(`import json
dru = '''(version 1)
# (rule "commented out"
#\t(condition "A.Type == 'Track'")
#\t(constraint track_width (min 1mm)))
   # (rule "also out" (condition "A.Type == 'Zone'") (constraint track_width (min 1mm)))
(rule "two conditions"
\t(condition "A.Type == 'Via'")
\t(condition "A.Type == 'Pad'")
\t(constraint hole_size (min 0.1mm)))
'''
f, names = kicad.probes(dru)
print(json.dumps([names, "A.Type == 'Pad'" in f, "A.Type == 'Via'" in f]))
print(json.dumps([kicad.probes(t) for t in ['(version 1)\\n(rule "x" (condition "a")', '(version 1)\\n(rule "x" (condition "a))\\n', '(version 1))\\n']]))`);
  const [read, unbalanced] = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(read, [["two conditions"], true, false]);
  assert.deepEqual(unbalanced, [[null, null], [null, null], [null, null]]);
});

test("a short in the rebuild with KiCad's DRC not run still says why the DRC did not run", { skip }, async () => {
  const dir = await macropad();
  const out = python(`import json
from pathlib import Path
real = kicad.read_zip
def short(pcb, board):
    d = real(pcb, board)
    d["pours"][0]["touches"] = ["GND", "GP6"]
    return d
kicad.read_zip = short
kicad.find_kicad = lambda: ("python3", "7.0.11", ["python3"])
def stops(python, runs):
    raise RuntimeError("it timed out")
kicad.run_kicad = stops
a = kicad.check(Path(${JSON.stringify(dir)}), None, False)
kicad.run_kicad = lambda python, runs: {"runs": [{"id": r["id"], "loaded": False, "violations": []} for r in runs]}
b = kicad.check(Path(${JSON.stringify(dir)}), None, False)
print(json.dumps([a, b]))`);
  const [a, b] = JSON.parse(out) as KicadReport[];
  assert.deepEqual([a.status, a.note, a.errors], ["fail", "KiCad 7.0.11 did not finish the check: it timed out", ["the pour on F.Cu touches copper of GND, GP6: it joins nets"]]);
  assert.deepEqual([b.status, b.note], ["fail", "KiCad's DRC with our rules did not run: KiCad could not load the rule file (it stops on a rule file it cannot parse)"]);
  for (const r of [a, b]) {
    const l = kicadLayer("t", { status: "fail", report: r, message: "" });
    assert.match(l.result, /^1 problem in the rebuild, and the DRC did not run \((KiCad 7\.0\.11 did not finish|KiCad could not load)/);
    assert.doesNotMatch(l.checked, /with ,|with  /);
  }
});

test("the fabs' pinned rule files: KiCad compiles every condition in them", { skip: skipKicad }, async () => {
  const { texts } = await ruleFiles();
  const sets = Object.entries(texts).map(([id, dru]) => ({ ...ours, id, title: id, dru: dru! }));
  if (!sets.length) return; // offline, with nothing in the cache
  const { report } = await check({ flags: [], sets: [ours, ...sets] });
  for (const s of report.ruleSets.slice(1)) {
    assert.equal(s.ruleFileLoaded, true, s.id);
    assert.deepEqual(s.skippedRules, [], `${s.id}: ${s.note}`);
  }
});

test("a track cut out of the shipped copper is an open net, and the check fails on it", { skip: skipKicad }, async () => {
  let net = "";
  const { status, report } = await check({
    flags: [],
    change: (files, board) => {
      const name = board.files["B.Cu"], cut = cutLongest(files.get(name)!);
      files.set(name, cut.text);
      net = cut.net;
    },
  });
  assert.equal(status, 1);
  assert.equal(report.status, "fail");
  assert.ok(report.ruleSets[0].errors.some((e) => e.startsWith("[unconnected_items]") && e.includes(`[${net}]`)), report.ruleSets[0].errors.join("\n"));
});

test("the netlists' differences are given in mm, where the records are", { skip: skipKicad }, async () => {
  const src = await macropad(), board = JSON.parse(readFileSync(join(src, "board.json"), "utf8")) as Board;
  // One record of GP4 renamed GQ4, which keeps the columns.
  const { report } = await check({ flags: [], netlist: (text) => text.replace(/^(327)GP4 /m, "$1GQ4 ") });
  assert.equal(report.netlist?.ok, false);
  const m = /^GQ4 at \((-?\d+\.\d{3}), (-?\d+\.\d{3})\) mm$/.exec(report.netlist?.onlyOurs?.[0] ?? "");
  assert.ok(m, JSON.stringify(report.netlist));
  assert.ok(board.pads.some((p) => Math.abs(p.x - Number(m[1])) < 0.01 && Math.abs(p.y - Number(m[2])) < 0.01), `no pad at ${m[1]}, ${m[2]} mm`);
  assert.match(report.netlist?.onlyKicad?.[0] ?? "", new RegExp(`^GP4 at \\(${m[1]}, ${m[2]}\\) mm$`));
  // A point one unit of the file (0.0001 in) off is the same point, rounded the other way; three units off is not.
  const one = await check({ flags: [], netlist: (text) => text.replace(/^(327GND +U1 +-3 +A01X\+0094)69/m, "$170") });
  assert.deepEqual([one.report.netlist?.ok, one.report.netlist?.matched], [true, 129], JSON.stringify(one.report.netlist));
  const three = await check({ flags: [], netlist: (text) => text.replace(/^(327GND +U1 +-3 +A01X\+0094)69/m, "$172") });
  assert.equal(three.report.netlist?.ok, false);
  assert.match(three.report.netlist?.onlyOurs?.[0] ?? "", /^GND at \(24\.059, /);
});

test("a Pico soldered through its own holes is one plated pad a pin beside its castellation, and passes", { skip: skipKicad }, async () => {
  const dir = await build("through", {
    files: {
      "cad/pcb.mjs": `export default function board({ pcb }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" }, throughHoles: { drillMm: 1.0, padMm: 1.6 } });
  pcb.pour("GND", "B.Cu");
}
`,
      "design.json": JSON.stringify({ slug: "through", params: { pcbWidthMm: 61, pcbHeightMm: 40, pcbCornerMm: 1, controllerCenterXMm: 0, controllerCenterYMm: 0, controllerLengthMm: 51, controllerWidthMm: 21 } }),
    },
  });
  const { status, report, said } = run(dir);
  assert.equal(report.rebuilt?.pads, 80, said);
  assert.deepEqual([report.netlist?.ok, report.netlist?.ours, report.netlist?.kicad], [true, 84, 84], said);
  assert.equal(status, 0, said);
});

test("on a net routed twice, the cut-out fault takes a track whose removal does cut a net", { skip: skipKicad }, async () => {
  const dir = await build("twice", { edit: (code) => code.replace(/\n  \/\/ Silkscreen:/, `\n  pcb.route("GP4", "K3.A", "U1.GP4", { via: true });\n  // Silkscreen:`) });
  const { status, report, said } = run(dir);
  assert.equal(status, 0, said);
  const cut = report.selfTest?.cases.find((c) => / track of .* cut out$/.test(c.fault));
  assert.ok(cut && cut.ok, said);
  assert.ok(report.selfTest?.cases.every((c) => c.ok), said);
});
