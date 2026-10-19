// The whole-product check (`sprue system`, cad/system.py) on a small product made here: a printed tray and lid, a
// bought block inside on the tray's floor, a pin pressed into the floor, four feet and a port up through a hole in
// the lid. It passes as drawn and its self-test catches a fault in every gate. A block drawn into the lid fails the
// overlap gate and the score, one drawn 0.1 mm from the tray's wall fails the clearance gate though it sits on the
// floor, a pin drawn on the floor instead of in it is no fit, and a port that can't fail (open to 0% is enough) makes
// the self-test miss its fault, which fails the score though every gate passes. A gate that cannot run fails with why.
// They need python3 with build123d, trimesh, scipy, rtree and shapely (cad/requirements.txt); without them they are
// skipped. Run them with
//   node --test skills/sprue/pipeline/system.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { systemAudit } from "./stages/score.ts";
import type { Bom, SystemCheck } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
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
// the floor, a foot under each corner, and the block's port looking up through the hole.
const SYSTEM = `
import json, pathlib
from system import Contact, Fit, Inside, Item, Port, System, box, cyl

P = json.loads((pathlib.Path(__file__).parent.parent / "design.json").read_text())["params"]


def system():
    tray = box(-20, 20, -20, 20, 0, 10) - box(-18, 18, -18, 18, 2, 10)
    lid = box(-20, 20, -20, 20, 10, 12) - cyl(1.5, 10, 12)
    items = [Item("tray", tray, line="tray", material="PLA"), Item("lid", lid, line="lid", material="PLA"),
             Item("blk", box(-5, P["blockHalfMm"], -5, 5, 2, P["blockTopMm"]), line="blk", mass_g=10, mass_note="bom.json", model="envelope")]
    for n, (x, y) in enumerate(((-15, -15), (-15, 15), (15, -15), (15, 15)), 1):
        items.append(Item(f"foot{n}", cyl(3, -2, 0, x, y), line="feet", mass_g=0.3, tags=("foot",), model="envelope"))
    items.append(Item("pin", cyl(1, P["pinBottomMm"], 4, 10, 10), line="pin", mass_g=0.1, model="envelope"))
    return System(items=items, min_clearance_mm=0.2, fits=[Fit("pin", "tray", "pressed 1 mm into the floor")],
                  contacts=[Contact("lid", "tray"), Contact("blk", "tray"), Contact("foot*", "tray")],
                  inside=[Inside("blk", ("tray", "lid"))],
                  probes=[Port("port", "blk", (0, 0, P["blockTopMm"]), (0, 0, 1), 0.5, P["portMinOpen"])])
`;

function product(blockTopMm: number, { blockHalfMm = 5, portMinOpen = 0.95, pinBottomMm = 1 } = {}) {
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "", architecture: [], params: { blockTopMm, blockHalfMm, portMinOpen, pinBottomMm } }));
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
  assert.match(systemAudit(dir, bom).detail, /^system\.json is of an earlier design \(design\.json changed\)/);
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
  // The same product, its sizes read through bom_lines: the block's height from its line's spec, and in the last
  // case the board read from a zip.
  const reads = (extra = "") => SYSTEM.replace("from system import", "from system import bom_lines, board_from_gerbers,")
    .replace("def system():\n", `BOM, S = bom_lines(pathlib.Path(__file__).parent.parent)\n\n\ndef system():\n    top = S["blk"]["topMm"]\n${extra}`)
    .replace('P["blockTopMm"])', "top)");
  const withTop: Bom = { ...bom, lines: bom.lines.map((l) => (l.id === "blk" ? { ...l, spec: { ...l.spec, topMm: 7 } } : l)) };
  const cases: [string, Bom, string, RegExp][] = [
    ["a line taken out", { ...withTop, lines: withTop.lines.filter((l) => l.id !== "blk") }, "",
      /^bom\.json has no blk line, which cad\/_system\.py puts in the frame: put the line back, or take its part out of cad\/_system\.py$/],
    ["a spec field taken out", bom, "", /^bom\.json's blk line has no spec\.topMm, which cad\/_system\.py reads: give it$/],
    ["no board zip", withTop, '    board_from_gerbers(pathlib.Path(__file__).parent.parent / "pcb" / "box-gerbers.zip", 1.6)\n',
      /^pcb\/box-gerbers\.zip is not there, which the board is read from: sprue pcb writes it once the board passes its audit/],
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
