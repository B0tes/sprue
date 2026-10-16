// The whole-product check (`sprue system`, cad/system.py) on a small product made here: a printed tray and lid, a
// bought block inside on the tray's floor, four feet and a port up through a hole in the lid. It passes as drawn and
// its self-test catches a fault in every gate. A block drawn into the lid fails the overlap gate and the score, one
// drawn 0.1 mm from the tray's wall fails the clearance gate though it sits on the floor, and a port that can't fail
// (open to 0% is enough) makes the self-test miss its fault, which fails the score though every gate passes.
// They need python3 with build123d, trimesh, scipy, rtree and shapely (cad/requirements.txt); without them they are
// skipped. Run them with
//   node --test skills/sprue/pipeline/system.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  ],
};

// A 40 mm square tray with 2 mm walls and floor, the lid on its rim with a 3 mm hole over the block, the block on
// the floor, a foot under each corner, and the block's port looking up through the hole.
const SYSTEM = `
import json, pathlib
from system import Contact, Inside, Item, Port, System, box, cyl

P = json.loads((pathlib.Path(__file__).parent.parent / "design.json").read_text())["params"]


def system():
    tray = box(-20, 20, -20, 20, 0, 10) - box(-18, 18, -18, 18, 2, 10)
    lid = box(-20, 20, -20, 20, 10, 12) - cyl(1.5, 10, 12)
    items = [Item("tray", tray, line="tray", material="PLA"), Item("lid", lid, line="lid", material="PLA"),
             Item("blk", box(-5, P["blockHalfMm"], -5, 5, 2, P["blockTopMm"]), line="blk", mass_g=10, mass_note="bom.json", model="envelope")]
    for n, (x, y) in enumerate(((-15, -15), (-15, 15), (15, -15), (15, 15)), 1):
        items.append(Item(f"foot{n}", cyl(3, -2, 0, x, y), line="feet", mass_g=0.3, tags=("foot",), model="envelope"))
    return System(items=items, min_clearance_mm=0.2,
                  contacts=[Contact("lid", "tray"), Contact("blk", "tray"), Contact("foot*", "tray")],
                  inside=[Inside("blk", ("tray", "lid"))],
                  probes=[Port("port", "blk", (0, 0, P["blockTopMm"]), (0, 0, 1), 0.5, P["portMinOpen"])])
`;

function product(blockTopMm: number, { blockHalfMm = 5, portMinOpen = 0.95 } = {}) {
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "", architecture: [], params: { blockTopMm, blockHalfMm, portMinOpen } }));
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
  assert.equal(s.parts, 7);
  // 10 g of block and 1.2 g of feet on a PLA tray and lid; low and wide, so it tips well past 10 degrees.
  assert.ok(s.stability[0].tiltDeg > 45, String(s.stability[0].tiltDeg));
  assert.deepEqual(s.selfTest.faults.map((f) => [f.gate, f.caught]),
    [["placed", true], ["overlap", true], ["clearance", true], ["inside", true], ["contact", true],
      ["stability", true], ["stability", true], ["stability", true], ["function", true]]);
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
  assert.deepEqual(systemAudit(dir, bom).failed, ["overlap"]);
});

test("a part that sits where it should but 0.1 mm from a wall fails the clearance gate", { skip }, () => {
  product(7, { blockHalfMm: 17.9 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const clearance = result().gates.find((g) => g.id === "clearance")!;
  assert.equal(clearance.status, "fail");
  assert.match(clearance.detail, /blk is 0\.10 mm from tray beside where they touch|tray is 0\.10 mm from blk beside where they touch/);
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
