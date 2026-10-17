// Tests of the KiCad cross-check (kicad.py, kicad.ts): the macropad rebuilt in KiCad from its zip, its DRC with our
// rules and the fabs', the netlist diff and the self-test, faults put into the shipped files, a rule file KiCad cannot
// load, and the layer verify prints. Run them with
//   node --test skills/sprue/pipeline/pcb/kicad.test.ts
// The ones that read the zip need the read-back's Python (gerbonara and shapely); the ones that run the DRC also need
// KiCad's Python (pcbnew). Without them they are skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

let built: Promise<string> | undefined;
/** The macropad's pcb/ folder, built once into a temporary products/ folder. */
function macropad(): Promise<string> {
  built ??= (async () => {
    const tmp = temp("sprue-kicad-"), here = process.cwd(), log = console.log;
    const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
    for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
    try {
      process.chdir(tmp);
      console.log = () => {};
      assert.equal(await pcb("macropad"), true);
    } finally {
      console.log = log;
      process.chdir(here);
    }
    return join(dst, "pcb");
  })();
  return built;
}

type Board = { files: Record<string, string>; pads: { id: string; x: number; y: number; layers: string[] }[] };

/** Runs kicad.py on a copy of the macropad's pcb/ folder, with `change` made to the files in its zip and these rule
 * sets. */
async function check({ change, sets, flags = ["--self-test"] }: { change?: (files: Map<string, string>, board: Board) => void; sets?: RuleSet[]; flags?: string[] } = {}) {
  const src = await macropad(), dir = temp("sprue-kicad-copy-");
  const board = JSON.parse(readFileSync(join(src, "board.json"), "utf8")) as Board;
  for (const f of ["board.json", board.files.netlist]) cpSync(join(src, f), join(dir, f));
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
    assert.deepEqual(notes, Object.values(RULE_FILES).map((f) => `${f.name} is not in the cache and SPRUE_OFFLINE=1 says not to fetch it`));
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
  l = kicadLayer("t", { status: "pass", report: report(), message: "" }, ["kicad-druid's JLCPCB 2-layer 1 oz rules could not be fetched from Cimos/kicad-druid (offline)"]);
  assert.deepEqual(l.errors, ["kicad-druid's JLCPCB 2-layer 1 oz rules could not be fetched from Cimos/kicad-druid (offline)"]);
  const failed = report({ ok: false, status: "fail", ruleSets: [{ id: "ours", title: "our rules", status: "fail", note: "", ruleFileLoaded: true, canaryHits: 4, errors: ["[clearance] Clearance violation"], warnings: [] }] });
  l = kicadLayer("t", { status: "fail", report: failed, message: "" });
  assert.equal(l.status, "fail");
  assert.deepEqual(l.errors, ["our rules: [clearance] Clearance violation"]);
  assert.match(l.fix ?? "", /^KiCad and our DRC disagree about these files: read products\/t\/pcb\/kicad\.json before ordering/);
  l = kicadLayer("t", { status: "not run", message: "no Python with KiCad's pcbnew was found (tried python3)" });
  assert.equal(l.status, "not run");
  assert.match(l.fix ?? "", /^install KiCad \(7 or later; its Python comes with it\), or point SPRUE_KICAD_PYTHON/);
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
  const { status, report } = await check({ flags: [], sets: [ours, broken, unknownLayer] });
  assert.equal(status, 0);
  assert.equal(report.status, "partial");
  assert.deepEqual(report.ruleSets.map((s) => s.status), ["pass", "not run", "not run"]);
  for (const s of report.ruleSets.slice(1)) assert.match(s.note, /could not load the rule file|the canary rule did not fire/);
});
