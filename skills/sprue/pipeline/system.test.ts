// The whole-product check (`sprue system`, cad/system.py) on a small product made here: a printed tray and lid, a
// bought block inside on the tray's floor, a pin pressed into the floor, four feet and a port up through a hole in
// the lid. It passes as drawn and its self-test catches a fault in every gate. A block drawn into the lid fails the
// overlap gate and the score, one drawn 0.1 mm from the tray's wall fails the clearance gate though it sits on the
// floor, a pin drawn on the floor instead of in it is no fit, and a port that can't fail (open to 0% is enough) makes
// the self-test miss its fault, which fails the score though every gate passes. A gate that cannot run fails with why.
// What the check never reads (a pick, spares, the batch's size, a costNote) leaves system.json current, where any
// other edit of bom.json or design.json's params, or a run of cad/system.py by hand, makes it stale, and so does a file
// changed while the check ran. A risk the design accepts with its reason (a probe of each kind falling short, a Gap)
// is a flag, not a failure, and the self-test still catches the fault put in each gate.
// They need python3 with build123d, trimesh, scipy, rtree and shapely (cad/requirements.txt); without them they are
// skipped. Run them with
//   node --test skills/sprue/pipeline/system.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BOM_FOR_ONE_UNIT, bomForOneUnit, DESIGN_PARAMS, designParams, systemAudit } from "./stages/score.ts";
import type { Bom, SystemCheck } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
const CHECKER = join(import.meta.dirname, "..", "cad", "system.py");
const ready = spawnSync("python3", ["-c", "import build123d, trimesh, scipy, rtree, shapely"]).status === 0;
const skip = ready ? false : "python3 has no build123d, trimesh, scipy, rtree or shapely (pip install -r skills/sprue/cad/requirements.txt)";

const cwd = mkdtempSync(join(tmpdir(), "sprue-system-"));
after(() => rmSync(cwd, { recursive: true, force: true }));
const dir = join(cwd, "products", "box");

const bom: Bom = {
  slug: "box", units: 1, lines: [
    { id: "tray", name: "Tray", role: "case-bottom", process: "print", qtyPerUnit: 1, spec: { material: "PLA" }, file: "fab/tray.stl" },
    { id: "lid", name: "Lid", role: "case-top", process: "print", qtyPerUnit: 1, spec: { material: "PLA" }, file: "fab/lid.stl" },
    { id: "blk", name: "Sensor block", role: "sensor", process: "buy", qtyPerUnit: 1, spec: { massG: 10 } },
    { id: "feet", name: "Feet", role: "feet", process: "buy", qtyPerUnit: 4, spec: { massG: 0.3 } },
    { id: "pin", name: "Dowel pin", role: "pin", process: "buy", qtyPerUnit: 1, spec: { massG: 0.1 } },
  ],
};

// A 40 mm square tray with 2 mm walls and floor, the lid on its rim with a 3 mm hole over the block, the block on
// the floor, a foot under each corner, a steel pin, and the block's port looking up through the hole. With
// `othersAccept`, also a probe of each other kind, each falling short, which the design accepts for that reason: a
// camera over the lid that sees the product, one whose page on the desk is partly outside its image and partly under
// the product, a light under the lid, and a radio's keep-out 1 mm from the pin.
const SYSTEM = `
import json, pathlib
from system import Contact, Fit, Gap, Inside, Item, Keepout, Light, Port, System, View, box, cyl

P = json.loads((pathlib.Path(__file__).parent.parent / "design.json").read_text())["params"]


def system():
    tray = box(-20, 20, -20, 20, 0, 10) - box(-18, 18, -18, 18, 2, 10)
    lid = box(-20, 20, -20, 20, 10, 12) - cyl(1.5, 10, 12)
    items = [Item("tray", tray, line="tray", material="PLA"), Item("lid", lid, line="lid", material="PLA"),
             Item("blk", box(-5, P["blockHalfMm"], -5, 5, 2, P["blockTopMm"]), line="blk", mass_g=10, mass_note="bom.json", model="envelope")]
    for n, (x, y) in enumerate(((-15, -15), (-15, 15), (15, -15), (15, 15)), 1):
        items.append(Item(f"foot{n}", cyl(3, -2, 0, x, y), line="feet", mass_g=0.3, tags=("foot",), model="envelope"))
    items.append(Item("pin", cyl(1, P["pinBottomMm"], 4, 10, 10), line="pin", mass_g=0.1, tags=("metal",), model="envelope"))
    probes = [Port("port", "blk", (0, 0, P["blockTopMm"]), (0, 0, 1), P["portRadiusMm"], P["portMinOpen"], accept=P["portAccept"])]
    why = P["othersAccept"]
    if why:
        probes += [View("cam", (0, 0, 30), (0, 0, -1), (0, 1, 0), 40, 30, accept=why),
                   View("page", (0, 0, 30), (0, 0, -1), (0, 1, 0), 40, 30, target=box(-30, 30, -5, 5, -2.1, -2), accept=why),
                   Light("led", (-10, 0, 3), (0, 0, 1), 20, "out", 0.5, accept=why),
                   Keepout("radio", box(12, 14, 9, 11, 2, 4), 3, accept=why)]
    return System(items=items, min_clearance_mm=0.2, fits=[Fit("pin", "tray", "pressed 1 mm into the floor")],
                  contacts=[Contact("lid", "tray"), Contact("blk", "tray"), Contact("foot*", "tray")],
                  gaps=[Gap(*g) for g in P["gaps"]], inside=[Inside("blk", ("tray", "lid"))], probes=probes)
`;

/** The product, with the block's top at `blockTopMm` (7: 3 mm under the lid). `portRadiusMm` 2 is wider than the
 * lid's hole, so near half of the port's rays meet the lid; `portAccept` the design's reason to live with that,
 * `othersAccept` its reason to live with a probe of each other kind falling short, and `gaps` its Gaps, [a, b, mm,
 * accept]. */
function product(blockTopMm: number, { blockHalfMm = 5, portMinOpen = 0.95, pinBottomMm = 1, portRadiusMm = 0.5, portAccept = "",
  othersAccept = "", gaps = [] as [string, string, number, string][] } = {}) {
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "", architecture: [],
    params: { blockTopMm, blockHalfMm, portMinOpen, pinBottomMm, portRadiusMm, portAccept, othersAccept, gaps } }));
  writeFileSync(join(dir, "cad", "_system.py"), SYSTEM);
}

const run = () => spawnSync(SPRUE, ["system", "box"], { cwd, encoding: "utf8", timeout: 300_000 });
const result = () => JSON.parse(readFileSync(join(dir, "system.json"), "utf8")) as SystemCheck;

test("a product whose parts fit, stand and do their job passes, and each gate catches the fault put in it", { skip }, () => {
  product(7);
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = result();
  assert.equal(s.ok, true);
  assert.deepEqual(s.gates.filter((g) => g.status !== "pass"), []);
  assert.equal(s.parts, 8);
  // 10 g of block and 1.2 g of feet on a PLA tray and lid; low and wide, so it tips well past 10 degrees.
  assert.ok(s.stability[0].tiltDeg > 45, String(s.stability[0].tiltDeg));
  assert.deepEqual(s.selfTest.faults.map((f) => [f.gate, f.caught]),
    [["placed", true], ["overlap", true], ["clearance", true], ["overlap", true], ["inside", true], ["contact", true],
      ["clearance", true], ["stability", true], ["stability", true], ["stability", true], ["function", true]]);
  // Each catch names the parts its fault moved: the pin out of its fit, the block slid along the floor to 0.1 mm
  // from the tray's wall.
  assert.match(s.selfTest.faults[3].detail, /^pin is meant to fit tray/);
  assert.match(s.selfTest.faults[6].fault, /^slid blk 12\.90 mm along tray/);
  assert.match(s.selfTest.faults[6].detail, /^(blk is 0\.10 mm from tray|tray is 0\.10 mm from blk) beside where they touch/);
  assert.deepEqual(s.selfTest.untested, []);
  assert.equal(systemAudit(dir, bom).ok, true, systemAudit(dir, bom).detail);
  // The block grows into the lid: the same files with one number changed are stale until checked again.
  product(10.5);
  assert.match(systemAudit(dir, bom).detail, /^system\.json is of an earlier design \(design\.json params changed\)/);
});

test("a part drawn into another fails the overlap gate, and the score with it", { skip }, () => {
  product(10.5);
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = result();
  const overlap = s.gates.find((g) => g.id === "overlap")!;
  assert.equal(overlap.status, "fail");
  assert.match(overlap.detail, /lid and blk share|blk and lid share/);
  assert.deepEqual(overlap.list, overlap.detail.split("; "), "a failing gate's problems, in full");
  assert.equal(s.gates.find((g) => g.id === "inside")!.list, undefined, "a gate that passes has none");
  assert.deepEqual(systemAudit(dir, bom).failed, ["overlap"]);
});

test("a gate that cannot run fails with why, and system.json is still written", { skip }, () => {
  product(7, { portMinOpen: null as unknown as number });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const fn = result().gates.find((g) => g.id === "function")!;
  assert.equal(fn.status, "fail");
  assert.match(fn.detail, /^Can't run: /);
  assert.deepEqual(fn.list, [fn.detail]);
});

test("a part that sits where it should but 0.1 mm from a wall fails the clearance gate", { skip }, () => {
  product(7, { blockHalfMm: 17.9 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const clearance = result().gates.find((g) => g.id === "clearance")!;
  assert.equal(clearance.status, "fail");
  assert.match(clearance.detail, /blk is 0\.10 mm from tray beside where they touch|tray is 0\.10 mm from blk beside where they touch/);
});

test("a part of a fit that only touches its partner is not a fit", { skip }, () => {
  product(7, { pinBottomMm: 2 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const overlap = result().gates.find((g) => g.id === "overlap")!;
  assert.equal(overlap.status, "fail");
  assert.match(overlap.detail, /pin only touches tray, so it is not a fit \(pressed 1 mm into the floor\): make it a Contact/);
});

test("a model the check reads through build123d is one of its inputs, as it was when read", { skip }, () => {
  product(7);
  mkdirSync(join(dir, "models"), { recursive: true });
  const step = join(dir, "models", "blk.step");
  const made = spawnSync("python3", ["-c", `from build123d import Box, export_step; export_step(Box(10, 10, 5), ${JSON.stringify(step)})`], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  // OpenCascade reads the STEP in C++, where Python's audit hook sees no open.
  writeFileSync(join(dir, "cad", "_system.py"), SYSTEM + `
from build123d import import_step
MODEL = import_step(str(pathlib.Path(__file__).parent.parent / "models" / "blk.step"))
`);
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(result().inputs["models/blk.step"], JSON.stringify(Object.keys(result().inputs)));
  assert.equal(systemAudit(dir, bom).ok, true, systemAudit(dir, bom).detail);
  writeFileSync(step, readFileSync(step, "utf8") + "\n");
  assert.match(systemAudit(dir, bom).detail, /^system\.json is of an earlier design \(models\/blk\.step changed\)/);
  rmSync(join(dir, "models"), { recursive: true, force: true });
});

test("a probe that can't fail makes the self-test miss its fault, and the score fails though every gate passes", { skip }, () => {
  product(7, { portMinOpen: 0 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = result();
  assert.deepEqual(s.gates.filter((g) => g.status !== "pass"), []);
  assert.equal(s.selfTest.ok, false);
  assert.deepEqual(s.selfTest.faults.filter((f) => !f.caught).map((f) => f.gate), ["function"]);
  assert.match(systemAudit(dir, bom).detail, /^its self-test missed function/);
});

test("a BOM line, a spec field or a board zip _system.py needs that isn't there fails the check naming it, and system.json is still written", { skip }, () => {
  // The same product, its sizes read through bom_lines: the block's height from its line's spec, then the board
  // read from a zip, and a mass looked up in the product's estimates.
  const reads = (extra = "") => SYSTEM.replace("from system import", "from system import bom_lines, board_from_gerbers, estimates,")
    .replace("def system():\n", `BOM, S = bom_lines(pathlib.Path(__file__).parent.parent)\n\n\ndef system():\n    top = S["blk"]["topMm"]\n${extra}`)
    .replace('P["blockTopMm"])', "top)");
  const withTop: Bom = { ...bom, lines: bom.lines.map((l) => (l.id === "blk" ? { ...l, spec: { ...l.spec, topMm: 7 } } : l)) };
  const cases: [string, Bom, string, RegExp][] = [
    ["a line taken out", { ...withTop, lines: withTop.lines.filter((l) => l.id !== "blk") }, "",
      /^bom\.json has no blk line, which cad\/_system\.py puts in the frame: put the line back, or take its part out of cad\/_system\.py$/],
    ["a spec field taken out", bom, "", /^bom\.json's blk line has no spec\.topMm, which cad\/_system\.py reads: give it$/],
    ["no board zip", withTop, '    board_from_gerbers(pathlib.Path(__file__).parent.parent / "pcb" / "box-gerbers.zip", 1.6)\n',
      /^no pcb\/box-gerbers\.zip, which the board is read from: sprue pcb writes it once the board passes its audit/],
    ["no mass and no estimate", withTop, '    estimates({"tray": (1.0, "a guess")})["blk"]\n',
      /^bom\.json's blk line has no spec\.massG, and cad\/_system\.py has no estimate for it: give its massG$/],
  ];
  for (const [what, lines, extra, says] of cases) {
    product(7);
    writeFileSync(join(dir, "bom.json"), JSON.stringify(lines));
    writeFileSync(join(dir, "cad", "_system.py"), reads(extra));
    // A system.json and a drawing of the frame from a run before: neither may stand for this one.
    writeFileSync(join(dir, "system.json"), "{}");
    mkdirSync(join(dir, "previews"), { recursive: true });
    writeFileSync(join(dir, "previews", "system.svg"), "<svg/>");
    const r = run();
    assert.equal(r.status, 1, `${what}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Traceback|Error/, what);
    const s = result();
    assert.equal(s.ok, false, what);
    assert.deepEqual(s.gates.map((g) => [g.id, g.status]), [["inputs", "fail"]], what);
    assert.match(s.gates[0].detail, says, what);
    assert.deepEqual(s.gates[0].list, [s.gates[0].detail], what);
    assert.match(r.stdout, /✗ inputs: /, what);
    assert.ok(!existsSync(join(dir, "previews", "system.svg")), `${what}: the old drawing is gone`);
    const audit = systemAudit(dir, lines);
    assert.equal(audit.ok, false, what);
    assert.deepEqual(audit.failed, ["inputs"], what);
    assert.equal(audit.detail, `the whole product can't be checked: ${s.gates[0].detail}`, what);
  }
  // Put back, it passes again: the inputs are the files as they are.
  product(7);
  writeFileSync(join(dir, "bom.json"), JSON.stringify(withTop));
  writeFileSync(join(dir, "cad", "_system.py"), reads());
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(systemAudit(dir, withTop).ok, true, systemAudit(dir, withTop).detail);
});

test("a system() that returns no System stops on an error saying so, not on the checker's own code", { skip }, () => {
  product(7);
  writeFileSync(join(dir, "cad", "_system.py"), SYSTEM.replace("    return System(", "    System("));
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^TypeError: cad\/_system\.py's system\(\) returned NoneType, not a System: return the System it builds$/m);
});

test("a pick, spares, the batch's size or a costNote leave system.json current, where any other edit, or a run of system.py by hand, makes it stale", { skip }, () => {
  product(7);
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // design.json and bom.json are in the inputs as sprue digested them and passed them in, not by their own hashes.
  assert.deepEqual([DESIGN_PARAMS, BOM_FOR_ONE_UNIT, "design.json", "bom.json"].map((k) => result().inputs[k]),
    [designParams(dir), bomForOneUnit(dir), undefined, undefined]);
  // A pick (a pin on a line), spares and a bigger batch, the file written again as sprue writes it; a costNote and an
  // assembly step in design.json.
  const picked: Bom = { ...bom, units: 20, lines: bom.lines.map((l) => (l.id === "blk" ? { ...l, pin: { supplier: "Shop", sku: "B-1" }, spares: 2 } : l)) };
  writeFileSync(join(dir, "bom.json"), JSON.stringify(picked, null, 2) + "\n");
  const design = JSON.parse(readFileSync(join(dir, "design.json"), "utf8"));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ ...design, costNotes: ["the block is the cost"], assembly: ["Put the block in"] }, null, 2) + "\n");
  assert.equal(systemAudit(dir, picked).ok, true, systemAudit(dir, picked).detail);
  // Any other edit is of another design than the one checked: a line's name, a param.
  const renamed: Bom = { ...picked, lines: picked.lines.map((l) => (l.id === "feet" ? { ...l, name: "Rubber feet" } : l)) };
  writeFileSync(join(dir, "bom.json"), JSON.stringify(renamed));
  assert.equal(systemAudit(dir, renamed).detail, "system.json is of an earlier design (bom.json for one unit changed): run sprue system");
  writeFileSync(join(dir, "bom.json"), JSON.stringify(picked));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ ...design, params: { ...design.params, blockHalfMm: 5.5 } }));
  assert.equal(systemAudit(dir, picked).detail, "system.json is of an earlier design (design.json params changed): run sprue system");
  // cad/system.py run by hand hashes design.json and bom.json whole, which sprue reads as stale and runs again.
  writeFileSync(join(dir, "design.json"), JSON.stringify(design));
  const env = { ...process.env };
  delete env.SPRUE_DESIGN_DIGEST;
  delete env.SPRUE_BOM_DIGEST;
  const hand = spawnSync("python3", [CHECKER, dir], { encoding: "utf8", env, timeout: 300_000 });
  assert.equal(hand.status, 0, hand.stdout + hand.stderr);
  assert.deepEqual([DESIGN_PARAMS, BOM_FOR_ONE_UNIT, "design.json", "bom.json"].map((k) => typeof result().inputs[k]), ["undefined", "undefined", "string", "string"]);
  assert.equal(systemAudit(dir, picked).detail,
    "system.json is of an earlier design (design.json params, bom.json for one unit, design.json, ... changed): run sprue system");
});

test("a file changed while the check ran is recorded as that, so system.json is stale, though what changed is what it never reads", { skip }, () => {
  // A pick and a costNote made while the check runs, each file written again as sprue writes it: the digests sprue
  // passed in before the run still match the files, and would stand for a run that failed on them.
  product(7);
  writeFileSync(join(dir, "cad", "_system.py"), SYSTEM + `
_check = system


def system():
    root = pathlib.Path(__file__).parent.parent
    for name, edit in (("bom.json", lambda b: b["lines"][2].update(pin={"supplier": "Shop", "sku": "B-1"})),
                       ("design.json", lambda d: d.update(costNotes=["the block is the cost"]))):
        data = json.loads((root / name).read_text())
        edit(data)
        (root / name).write_text(json.dumps(data, indent=2) + "\\n")
    return _check()
`);
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ bom\.json, design\.json changed while the check ran: run it again/);
  const s = result();
  assert.deepEqual([s.ok, s.gates.filter((g) => g.status !== "pass"), s.selfTest.ok], [false, [], true]);
  assert.deepEqual([s.inputs[DESIGN_PARAMS], s.inputs[BOM_FOR_ONE_UNIT]], ["changed while the check ran", "changed while the check ran"]);
  const picked = JSON.parse(readFileSync(join(dir, "bom.json"), "utf8")) as Bom;
  assert.equal(picked.lines[2].pin?.sku, "B-1");
  // So sprue reads it as stale, and runs the check again, where "does not say it passed" would stop it for good.
  assert.equal(systemAudit(dir, picked).detail, "system.json is of an earlier design (design.json params, bom.json for one unit changed): run sprue system");
});

test("a probe the design accepts falling short is a flag, not a failure, and the self-test still catches the fault put in it", { skip }, () => {
  product(7, { portRadiusMm: 2 });
  let r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  let fn = result().gates.find((g) => g.id === "function")!;
  assert.deepEqual([fn.status, fn.list, fn.flags], ["fail", ["port: 56% of it sees out, under 95% (blocked by lid)"], undefined]);
  product(7, { portRadiusMm: 2, portAccept: "half the port is all the sensor needs (a test)" });
  r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = result();
  fn = s.gates.find((g) => g.id === "function")!;
  assert.deepEqual([fn.status, fn.problems, fn.flags], ["pass", 0, ["port: 56% of it sees out, under 95% (blocked by lid) (accepted: half the port is all the sensor needs (a test))"]]);
  assert.equal(s.ok, true);
  // The disc over the port is a problem, not one more flag: its fault is judged with the probe's reason set aside.
  assert.deepEqual(s.selfTest.faults.filter((f) => f.gate === "function").map((f) => [f.caught, f.detail]),
    [[true, "port: 0% of it sees out, under 95% (blocked by fault-lid-port)"]]);
  assert.deepEqual([s.selfTest.ok, s.selfTest.untested], [true, []]);
  assert.equal(systemAudit(dir, bom).ok, true, systemAudit(dir, bom).detail);
  assert.match(systemAudit(dir, bom).detail, /; 1 risk the design accepts \(system\.json\)$/);
});

const lidOnBlock = (mm: number, accept = "the lid rests on the block's gasket, which is soft (a test)") => ({ gaps: [["blk", "lid", mm, accept]] as [string, string, number, string][] });
const blkAndLid = /^(blk is 0\.10 mm from lid|lid is 0\.10 mm from blk)/;

test("a Gap flags a pair closer than the gap, down to its mm, and the self-test moves another pair to just under the gap and this one under its mm", { skip }, () => {
  // 3 mm under the lid, the block is what the self-test moves to just under the gap from the lid, where the Gap would
  // let it be: it moves it to the pin instead, and to just under the Gap's 0.05 mm from the lid.
  product(7, lidOnBlock(0.05));
  let r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let s = result();
  assert.deepEqual(s.selfTest.faults.filter((f) => f.gate === "clearance").map((f) => [f.fault, f.caught]), [
    ["moved blk to 0.15 mm from pin", true], ["slid blk 12.90 mm along tray, to 0.1 mm beside a contact", true],
    ["moved blk to 0.025 mm from lid, under the 0.05 mm of a gap the design accepts", true]]);
  assert.match(s.selfTest.faults.find((f) => f.fault.endsWith("of a gap the design accepts"))!.detail, /^(blk is 0\.03 mm from lid|lid is 0\.03 mm from blk), under the 0\.05 mm the design accepts$/);
  assert.deepEqual([s.selfTest.ok, s.selfTest.untested], [true, []]);
  // 0.1 mm under the lid, closer than the 0.2 mm gap: a flag, with the Gap's reason.
  product(9.9, lidOnBlock(0.05));
  r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  s = result();
  const clearance = s.gates.find((g) => g.id === "clearance")!;
  assert.deepEqual([clearance.status, clearance.problems, clearance.flags?.length], ["pass", 0, 1]);
  assert.match(clearance.flags![0], blkAndLid);
  assert.match(clearance.flags![0], / \(accepted: the lid rests on the block's gasket, which is soft \(a test\)\)$/);
  assert.deepEqual(s.selfTest.faults.filter((f) => !f.caught), []);
  assert.deepEqual([s.ok, s.selfTest.ok, s.selfTest.untested], [true, true, []]);
  assert.equal(systemAudit(dir, bom).ok, true, systemAudit(dir, bom).detail);
});

test("a pair under a Gap's mm still fails, and a Gap with no reason, that names no parts or goes under 0, is a problem that excuses nothing", { skip }, () => {
  product(9.9, lidOnBlock(0.18));
  let r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  let s = result();
  let clearance = s.gates.find((g) => g.id === "clearance")!;
  assert.deepEqual([clearance.status, clearance.list?.length, clearance.flags], ["fail", 1, undefined]);
  assert.match(clearance.list![0], /^(blk is 0\.10 mm from lid|lid is 0\.10 mm from blk), under the 0\.18 mm the design accepts$/);
  // The only pair the Gap names is under its mm already, so nothing can be moved under it: the self-test has no fault
  // for it, and its pass would prove nothing.
  assert.deepEqual([s.selfTest.ok, s.selfTest.untested],
    [false, ["clearance, under a gap the design accepts (each pair it names is under it already, or none is within 20 mm)"]]);
  product(9.9, { gaps: [...lidOnBlock(0.05, "").gaps, ["cable", "lid", 0.1, "it ships loose"], ["foot1", "lid", -0.1, "a test"]] });
  r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  s = result();
  clearance = s.gates.find((g) => g.id === "clearance")!;
  assert.equal(clearance.status, "fail");
  assert.deepEqual(clearance.list!.slice(0, 3), ["gap blk / lid gives no reason: give its accept, why the design lets them sit closer than 0.2 mm",
    "gap cable / lid names no parts", "gap foot1 / lid is down to -0.1 mm: a gap is 0 or more (sharing volume is a Fit)"]);
  assert.match(clearance.list![3], new RegExp(`${blkAndLid.source}$`));
  assert.equal(clearance.list!.length, 4);
});

test("a view, a light and a keep-out the design accepts falling short are flags, not failures, and the self-test still catches the fault put in each", { skip }, () => {
  product(7, { othersAccept: "a test" });
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = result();
  const fn = s.gates.find((g) => g.id === "function")!;
  assert.deepEqual([fn.status, fn.problems], ["pass", 0]);
  // Each of the five places a probe other than a port falls short: the camera over the lid sees the product; the
  // page's camera has its page partly outside the image and the rest under the product; the light meets the lid; the
  // pin is in the radio's keep-out.
  assert.deepEqual(fn.flags!.map((f) => f.replace(/\d+(\.\d+)?%/g, "#%")), [
    "cam: the product fills #% of the image (blk, lid) (accepted: a test)",
    "page: #% of its target is outside the image (accepted: a test)",
    "page: #% of its target is hidden (blk, lid) (accepted: a test)",
    "led: #% of its light reaches out, under #% (blocked by lid) (accepted: a test)",
    "radio: pin is 1.0 mm away, under 3 mm (accepted: a test)",
  ]);
  // Each fault is a problem, not one more flag: it is judged with the probe's reason set aside.
  assert.deepEqual(s.selfTest.faults.filter((f) => f.gate === "function").map((f) => [f.fault, f.caught]), [
    ["closed port with a disc", true], ["put a plate 10 mm in front of cam", true], ["put a plate 10 mm in front of page", true],
    ["put a plate in front of led", true], ["put a steel block on radio", true]]);
  assert.match(s.selfTest.faults.find((f) => f.fault === "put a steel block on radio")!.detail, /^radio: fault-metal-radio is in the keep-out$/);
  assert.deepEqual([s.ok, s.selfTest.ok, s.selfTest.untested], [true, true, []]);
  // The verdict counts only the port as passing.
  const a = systemAudit(dir, bom);
  assert.equal(a.ok, true, a.detail);
  assert.match(a.detail, /, 1 of 5 function probes pass, and its self-test catches each fault put in; 5 risks the design accepts \(system\.json\)$/);
});
