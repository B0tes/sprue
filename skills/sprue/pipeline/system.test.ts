// The whole-product check (`sprue system`, cad/system.py) on a small product made here: a printed tray and lid, a
// bought block inside on the tray's floor, a pin pressed into the floor, four feet and a port up through a hole in
// the lid. It passes as drawn and its self-test catches a fault in every gate. A block drawn into the lid fails the
// overlap gate and the score, one drawn 0.1 mm from the tray's wall fails the clearance gate though it sits on the
// floor, a pin drawn on the floor instead of in it is no fit, and a port that can't fail (open to 0% is enough) makes
// the self-test miss its fault, which fails the score though every gate passes. A gate that cannot run fails with why.
// What the check never reads (a pick, spares, the batch's size, a costNote) leaves system.json current, where any
// other edit of bom.json or design.json's params, or a run of cad/system.py by hand, makes it stale, and so does a file
// changed while the check ran. A risk the design accepts with its reason (a probe of each kind falling short, a Gap)
// is a flag, not a failure, and the self-test still catches the fault put in each gate. The frame is written as a 3D
// model, a node per part, a board read from its zip meshed coarse and wearing its two faces drawn from the zip.
// They need python3 with build123d, trimesh, scipy, rtree and shapely (cad/requirements.txt), and the board's model
// gerbonara and Pillow too; without them they are skipped. Run them with
//   node --test skills/sprue/pipeline/system.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
// A board read from its zip needs gerbonara too, which cad/requirements.txt says to install on its own, and Pillow.
const boardSkip = skip || (spawnSync("python3", ["-c", "import gerbonara, PIL"]).status === 0 ? false
  : "python3 has no gerbonara or Pillow (python3 -m pip install --no-deps gerbonara==1.6.3; pip install -r skills/sprue/cad/requirements.txt)");

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
/** Each number of `got` within 0.01 of `want`'s. */
const close = (got: number[] | null | undefined, want: number[], what = "") =>
  assert.ok(got && got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= 0.01), `${what} ${JSON.stringify(got)} is not ${JSON.stringify(want)}`);

/** A GLB's JSON chunk, its header and chunks checked. */
function readGlb(file: string) {
  const b = readFileSync(file);
  assert.deepEqual([b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8)], [0x46546c67, 2, b.length], "a glTF 2 binary, its length in its header");
  const length = b.readUInt32LE(12);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, "JSON first");
  assert.equal(b.readUInt32LE(24 + length), 0x004e4942, "then BIN");
  assert.equal(28 + length + b.readUInt32LE(20 + length), b.length);
  return JSON.parse(b.subarray(20, 20 + length).toString("utf8"));
}

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
  // What the 3D view draws: each part with its BOM line, model, material, mass and box, and each relation with the
  // pairs of parts the gates found meeting it. A gate that passes has nothing to mark.
  assert.equal(s.minClearanceMm, 0.2);
  assert.deepEqual(s.items!.map((i) => [i.id, i.line, i.model, i.material, i.massG, i.estimated]), [
    ["tray", "tray", "cad", "PLA", 6.98, false], ["lid", "lid", "cad", "PLA", 3.95, false], ["blk", "blk", "envelope", null, 10, false],
    ...[1, 2, 3, 4].map((n) => [`foot${n}`, "feet", "envelope", null, 0.3, false]), ["pin", "pin", "envelope", null, 0.1, false]]);
  // 40 x 40 x 10 mm less 36 x 36 x 8 inside is 5.632 cm3 of PLA at 1.24 g/cm3.
  assert.equal(s.items![0].massNote, "5.63 cm3 of PLA at 1.24 g/cm3");
  assert.deepEqual([s.items![2].massNote, s.items![3].tags, s.items![7].tags], ["bom.json", ["foot"], ["metal"]]);
  close(s.items![0].bbox, [-20, -20, 0, 20, 20, 10], "the tray's box");
  close(s.items![2].bbox, [-5, -5, 2, 5, 5, 7], "the block's box");
  assert.deepEqual(s.relations, {
    fits: [{ a: "pin", b: "tray", why: "pressed 1 mm into the floor", pairs: [["pin", "tray"]] }],
    contacts: [{ a: "lid", b: "tray", why: "", gap: null, pairs: [["lid", "tray"]] }, { a: "blk", b: "tray", why: "", gap: null, pairs: [["blk", "tray"]] },
      { a: "foot*", b: "tray", why: "", gap: null, pairs: [1, 2, 3, 4].map((n) => [`foot${n}`, "tray"]) }],
    gaps: [], inside: [{ items: "blk", within: ["tray", "lid"], why: "", parts: ["blk"], case: ["tray", "lid"] }], unplaced: {},
  });
  assert.deepEqual(s.gates.filter((g) => "where" in g || "flagsWhere" in g), []);
  // The 3D model: under a root named for the product that makes the frame glTF's (metres, y up), a node per part named
  // by its id, its material how it is modelled, each mesh within the part's box; made from the inputs system.json
  // records, by their digest.
  const gltf = readGlb(join(dir, "previews", "system.glb"));
  const digest = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(s.inputs).sort()))).digest("hex");
  const triangles = gltf.meshes.reduce((n: number, m: { primitives: { indices: number }[] }) => n + gltf.accessors[m.primitives[0].indices].count / 3, 0);
  assert.deepEqual(s.model, { file: "previews/system.glb", inputs: digest, triangles });
  assert.deepEqual(gltf.asset.extras, { slug: "box", inputs: digest, frame: "mm with z up, under a root node that makes it metres with y up" });
  assert.deepEqual(gltf.nodes[0], { name: "box", matrix: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1], children: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.deepEqual(gltf.nodes.slice(1).map((n: { name: string }) => n.name), s.items!.map((i) => i.id));
  for (const [i, it] of s.items!.entries()) {
    const prim = gltf.meshes[gltf.nodes[i + 1].mesh].primitives[0];
    assert.deepEqual(Object.keys(prim.attributes), ["POSITION"], `${it.id}: positions only; a viewer's smooth normals shade each face`);
    assert.equal(gltf.materials[prim.material].name, it.model, it.id);
    const { min, max } = gltf.accessors[prim.attributes.POSITION];
    assert.ok(min.every((v: number, k: number) => v >= it.bbox![k] - 0.01) && max.every((v: number, k: number) => v <= it.bbox![k + 3] + 0.01),
      `${it.id}: ${JSON.stringify([min, max])} is in its box ${JSON.stringify(it.bbox)}`);
  }
  close([...gltf.accessors[gltf.meshes[gltf.nodes[1].mesh].primitives[0].attributes.POSITION].min,
    ...gltf.accessors[gltf.meshes[gltf.nodes[1].mesh].primitives[0].attributes.POSITION].max], s.items![0].bbox!, "the tray's mesh fills its box");
  assert.equal(gltf.images, undefined, "no board, no picture");
  assert.ok(r.stdout.includes(`; system.json, previews/system.glb (${triangles.toLocaleString("en-US")} triangles)\n`), r.stdout);
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
  // Beside it, the parts it is of and a point where they clash, inside both: the middle of what they share is in the
  // lid's hole, so not that.
  assert.equal(overlap.where!.length, 1);
  assert.deepEqual([...overlap.where![0].parts].sort(), ["blk", "lid"]);
  const [x, y, z] = overlap.where![0].at!;
  assert.ok(Math.abs(x) < 5 && Math.abs(y) < 5 && z > 10 && z < 10.5 && Math.hypot(x, y) > 1.5, JSON.stringify(overlap.where));
  assert.deepEqual(systemAudit(dir, bom).failed, ["overlap"]);
});

test("a gate that cannot run fails with why, and system.json is still written", { skip }, () => {
  product(7, { portMinOpen: null as unknown as number });
  let r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const fn = result().gates.find((g) => g.id === "function")!;
  assert.equal(fn.status, "fail");
  assert.match(fn.detail, /^Can't run: /);
  assert.deepEqual(fn.list, [fn.detail]);
  assert.deepEqual(fn.where, [{ parts: [], at: null }], "of no part, nowhere");
  // A density that isn't a number: the stability gate can't weigh the tray, and the parts are still listed, the
  // tray with no mass and why.
  product(7);
  const design = JSON.parse(readFileSync(join(dir, "design.json"), "utf8"));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ ...design, params: { ...design.params, plaDensityGPerCm3: "1,24" } }));
  r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Traceback/);
  const s = result();
  assert.match(s.gates.find((g) => g.id === "stability")!.detail, /^Can't run: could not convert string to float: '1,24'/);
  assert.deepEqual([s.items![0].id, s.items![0].massG, s.items![2].massG], ["tray", null, 10]);
  assert.match(s.items![0].massNote, /could not convert string to float/);
  assert.deepEqual(s.relations!.fits[0].pairs, [["pin", "tray"]], "the gates that ran still say what meets");
});

test("where an overlap or a metal part in a keep-out is marked is inside the parts, though the middle of what they share is not, and a pair is listed once under each relation naming it", { skip }, () => {
  // What a peg shares with a hole drawn too small, a lid dropped into its tray's walls, a lid's lip drawn too wide
  // and a thin fence in a radio's region each have their centre in empty space.
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, "..", "cad"))})
from build123d import Vector
from system import Contact, Fit, Gap, Item, Run, System, box, cyl, inner_point
cases = {
    "peg": (cyl(5, -5, 8), box(-20, 20, -20, 20, 0, 3) - cyl(4.8, 0, 3)),
    "lid": (box(-20, 20, -20, 20, 0, 10) - box(-18, 18, -18, 18, 2, 10), box(-20, 20, -20, 20, 9, 11) - cyl(1.5, 9, 11)),
    "lip": (box(-20, 20, -20, 20, 0, 10) - box(-18, 18, -18, 18, 2, 10), box(-18.1, 18.1, -18.1, 18.1, 8, 10) - box(-16.1, 16.1, -16.1, 16.1, 8, 10)),
    "fence": (box(1, 9, 1, 9, 0, 2) - box(1.2, 8.8, 1.2, 8.8, 0, 2), box(0, 10, 0, 10, 0, 4)),
}
out = {}
for k, (a, b) in cases.items():
    c = (a & b).solids()[0].center()
    p = Vector(*inner_point(a & b))
    out[k] = [a.is_inside(c) and b.is_inside(c), a.is_inside(p) and b.is_inside(p)]
halves = [Item(f"half{i}", box(0, 10, 0, 10, i * 2, i * 2 + 2)) for i in range(3)]
r = Run(System(halves, 0.2, fits=[Fit("half0", "half1", "x"), Fit("half*", "half1", "y")],
               contacts=[Contact("half*", "half*")], gaps=[Gap("half*", "half2", 0.1, "z")]), halves, {"lines": []}, {})
for a, b in (("half0", "half1"), ("half1", "half0"), ("half1", "half2"), ("half2", "half1")):
    r.meets(r.s.contacts, a, b)
r.meets(r.s.fits, "half1", "half0")
out["contacts"] = list(r.met[id(r.s.contacts[0])])
out["fits"] = [list(r.met.get(id(f), {})) for f in r.s.fits]
# The overlap gate couldn't run, so it found only some of the fits' pairs, or none: they are null, not empty. An
# inside's parts are the items its patterns match, whether or not its gate ran.
from system import Inside, frame
r.s.inside = [Inside("half1", ("half0", "half2"))]
_, rel = frame(r.s, r, [{"id": "overlap", "detail": "Can't run: a test"}, {"id": "contact", "detail": "ok"}, {"id": "inside", "detail": "Can't run: a test"}])
out["frame"] = [[f["pairs"] for f in rel["fits"]], rel["contacts"][0]["pairs"], rel["gaps"][0]["pairs"], rel["inside"][0]["parts"], rel["inside"][0]["case"]]
print(json.dumps(out))
`;
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const k of ["peg", "lid", "lip", "fence"]) assert.deepEqual(out[k], [false, true], `${k}: the centre is outside, the mark inside both`);
  assert.deepEqual(out.contacts, [["half0", "half1"], ["half1", "half2"]], "each pair once, though both its sides match half*");
  assert.deepEqual(out.fits, [[["half0", "half1"]], [["half0", "half1"]]], "under each fit that names it, its a side first");
  assert.deepEqual(out.frame, [[null, null], [["half0", "half1"], ["half1", "half2"]], null, ["half1"], ["half0", "half2"]],
    "a gate that couldn't run (or didn't) leaves its relations' pairs null; the clearance gate didn't run here");
});

test("the model's parts are meshed to 0.1 mm, however big, and a frame with nothing to draw has no model", { skip }, () => {
  // A sphere of 50 mm radius: meshed to a share of each edge's length it would be 3 mm off its surface. A frame whose
  // one item is an empty shape: a GLB with no meshes is not valid glTF.
  const code = `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, "..", "cad"))})
from build123d import Compound, Sphere
from system import MODEL_MESH, Item, _tessellate, model_glb
v, f = _tessellate(Sphere(50), MODEL_MESH)
mid = np.concatenate([(v[f[:, a]] + v[f[:, b]]) / 2 for a, b in ((0, 1), (1, 2), (2, 0))])
try:
    model_glb([Item("nothing", Compound([]))], "empty", "d")
    said = ""
except ValueError as e:
    said = str(e)
print(json.dumps({"off": float(np.abs(np.linalg.norm(np.vstack([v, mid]), axis=1) - 50).max()), "empty": said}))
`;
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.off < 0.1, `the sphere's vertices and edges within 0.1 mm of its surface (off by ${out.off} mm)`);
  assert.equal(out.empty, "no item has a face to draw");
});

test("a board read from its zip is meshed coarse in the model and wears its two faces drawn from the zip, wherever it is placed", { skip: boardSkip }, () => {
  // A 20 x 10 mm board: a 2 mm pad with a 0.8 mm drill at (5, 5), open in the mask; a 1 mm track at y 2 from x 10 to
  // 18 under the mask; a 0.5 mm silkscreen line at y 8; nothing on the bottom. Placed turned a quarter about z and
  // moved to (30, 0, 5), beside a block. Then the same board read again and put there by each other way build123d
  // places a part: moved there in place, a copy located there, one turned and moved into its geometry, its solid
  // taken out of it and placed. And made into what the picture is not of: mirrored (about the y-z plane, and about
  // the plane through its centre of mass, which leaves that centre where it was), cut and joined to a block.
  const code = `
import hashlib, io, json, struct, sys, zipfile
import numpy as np
sys.path.insert(0, ${JSON.stringify(join(import.meta.dirname, "..", "cad"))})
import contextlib
from build123d import Axis, CenterOf, Location, Plane, Pos, Rot
from PIL import Image
from system import BOARD_MESH, BOARD_RGB, MODEL_MESH, Item, _tessellate, board_from_gerbers, box, model_glb
gerber = lambda body: "%FSLAX46Y46*%\\n%MOMM*%\\n" + body + "M02*\\n"
files = {
    "tiny-Edge_Cuts.gm1": gerber("%ADD10C,0.100*%\\nD10*\\nX0Y0D02*\\nX20000000Y0D01*\\nX20000000Y10000000D01*\\nX0Y10000000D01*\\nX0Y0D01*\\n"),
    "tiny-F_Cu.gtl": gerber("%ADD10C,2.000*%\\n%ADD11C,1.000*%\\nD10*\\nX5000000Y5000000D03*\\nD11*\\nX10000000Y2000000D02*\\nX18000000Y2000000D01*\\n"),
    "tiny-F_Mask.gts": gerber("%ADD10C,2.200*%\\nD10*\\nX5000000Y5000000D03*\\n"),
    "tiny-F_Silkscreen.gto": gerber("%ADD10C,0.500*%\\nD10*\\nX10000000Y8000000D02*\\nX18000000Y8000000D01*\\n"),
    "tiny-PTH.drl": "M48\\nMETRIC\\nT1C0.800\\n%\\nT1\\nX5.0Y5.0\\nM30\\n",
}
path = ${JSON.stringify(join(cwd, "tiny-gerbers.zip"))}
with zipfile.ZipFile(path, "w") as z:
    for name, text in files.items():
        z.writestr(name, text)
board, _ = board_from_gerbers(path, 1.6)
items = [Item("pcb", Pos(30, 0, 5) * Rot(0, 0, 90) * board, line="pcb", material="FR4"), Item("blk", box(0, 5, 0, 5, 0, 5), model="envelope")]
data, triangles = model_glb(items, "tiny", "d")
length = struct.unpack("<I", data[12:16])[0]
g, b = json.loads(data[20:20 + length]), data[28 + length:]
def arr(i, dtype, width):
    a = g["accessors"][i]
    return np.frombuffer(b, dtype, a["count"] * width, g["bufferViews"][a["bufferView"]]["byteOffset"]).reshape(-1, width)
prim = g["meshes"][g["nodes"][1]["mesh"]]["primitives"][0]
pos, uv = arr(prim["attributes"]["POSITION"], np.float32, 3), arr(prim["attributes"]["TEXCOORD_0"], np.float32, 2)
tri = arr(prim["indices"], np.uint16, 1).reshape(-1, 3)
view = g["bufferViews"][g["images"][0]["bufferView"]]
img = Image.open(io.BytesIO(b[view["byteOffset"]:view["byteOffset"] + view["byteLength"]])).convert("RGB")
colour = {v: k for k, v in BOARD_RGB.items()}
at = lambda side, x, y: colour.get(img.getpixel((int(side * 208 + x * 10), int((10 - y) * 10))), "other")
# Each vertex: the edge band's point, or a face's where it is on the board (the placement undone: x is y, y is 30 - x).
edge = np.all(np.isclose(uv, [0.5, 104 / 108]), axis=1)
top, bottom = ~edge & (uv[:, 0] < 0.5), ~edge & (uv[:, 0] > 0.5)
local = np.stack([pos[:, 1], 30 - pos[:, 0]], axis=1)
from_uv = np.stack([(uv[:, 0] * 408 - np.where(bottom, 208, 0)) / 10, 10 - uv[:, 1] * 108 / 10], axis=1)
normal_z = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])[:, 2]
group = np.where(edge, 2, np.where(top, 0, 1))[tri]
def placed():
    """Each other placement's board mesh against this one's: the same positions, points and picture, or no picture."""
    out, there, new = {}, Location((30, 0, 5), (0, 0, 90)), lambda: board_from_gerbers(path, 1.6)[0]
    moved = new()
    moved.move(there)
    com = new().center(CenterOf.MASS).X
    for name, shape in (("move", moved), ("located", new().located(there)),
                        ("baked", new().rotate(Axis.Z, 90, transform=True).translate((30, 0, 5), transform=True)),
                        ("solid", Pos(30, 0, 5) * Rot(0, 0, 90) * new().solid()),
                        ("mirror", new().mirror(Plane.YZ)), ("mirror about its middle", new().mirror(Plane.YZ.offset(com))),
                        ("cut", new() - box(18, 21, 4, 6, -1, 3)), ("joined", new() + box(12, 14, 4, 6, 1.6, 4))):
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            d = model_glb([Item("pcb", shape)], "tiny", "d")[0]
        n = struct.unpack("<I", d[12:16])[0]
        h, body = json.loads(d[20:20 + n]), d[28 + n:]
        q = h["meshes"][0]["primitives"][0]
        get = lambda i, w: np.frombuffer(body, np.float32, h["accessors"][i]["count"] * w, h["bufferViews"][h["accessors"][i]["bufferView"]]["byteOffset"]).reshape(-1, w)
        same = "images" in h and get(q["attributes"]["POSITION"], 3).shape == pos.shape and \
            bool(np.allclose(get(q["attributes"]["POSITION"], 3), pos, atol=1e-4) and np.allclose(get(q["attributes"]["TEXCOORD_0"], 2), uv)) and \
            body[h["bufferViews"][h["images"][0]["bufferView"]]["byteOffset"]:][:view["byteLength"]] == b[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]
        out[name] = [same, h["materials"][q["material"]]["name"], said.getvalue().strip()]
    return out


print(json.dumps({
    "size": img.size, "texture": g["materials"][prim["material"]]["pbrMetallicRoughness"]["baseColorTexture"],
    "block": g["materials"][g["meshes"][g["nodes"][2]["mesh"]]["primitives"][0]["material"]]["name"],
    "indices": g["accessors"][prim["indices"]]["componentType"],
    "colours": [at(0, 5, 5), at(0, 5.7, 5), at(0, 14, 2), at(0, 14, 8), at(0, 2, 8), at(1, 14, 2), at(1, 5, 5), at(1, 14, 8), colour.get(img.getpixel((204, 104)))],
    "counts": [int(top.sum()), int(bottom.sum()), int(edge.sum())],
    "faces": bool(np.allclose(pos[top, 2], 6.6, atol=1e-4) and np.allclose(pos[bottom, 2], 5, atol=1e-4)),
    "where": float(np.abs(from_uv[~edge] - local[~edge]).max()),
    "one group a triangle": bool(np.all(group == group[:, :1])),
    "facing": [bool(np.all(normal_z[group[:, 0] == 0] > 0)), bool(np.all(normal_z[group[:, 0] == 1] < 0)), bool(np.allclose(normal_z[group[:, 0] == 2], 0, atol=1e-6))],
    "bounds": [g["accessors"][prim["attributes"]["POSITION"]][k] for k in ("min", "max")],
    "coarse": [int(len(tri)), int(len(_tessellate(board, MODEL_MESH)[1]))],
    "same again": model_glb(items, "tiny", "d")[0] == data, "sha": hashlib.sha256(data).hexdigest(),
    "placed": placed(),
}))
`;
  const once = (seed: string) => {
    const r = spawnSync("python3", ["-c", code], { encoding: "utf8", timeout: 120_000, env: { ...process.env, PYTHONHASHSEED: seed } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const out = once("1");
  assert.deepEqual(out.size, [408, 108], "two faces at 10 px a mm side by side, 8 px apart, and the edge band under them");
  assert.deepEqual(out.texture, { index: 0 });
  assert.equal(out.block, "envelope");
  assert.equal(out.indices, 5123, "16-bit indices for a mesh under 65535 vertices");
  assert.deepEqual(out.colours, ["hole", "pad", "copper", "silk", "mask", "mask", "hole", "mask", "laminate"],
    "on top the drill, the pad round it open in the mask, the track under the mask, the silkscreen, bare mask; under it mask but for the drill; the edges laminate");
  assert.ok(out.counts.every((n: number) => n > 0), JSON.stringify(out.counts));
  assert.equal(out.faces, true, "the top's points are on its top face (5 + 1.6 mm up), the bottom's on its bottom");
  assert.ok(out.where < 0.01, `each face's vertex takes the picture's colour where it is on the board, the placement undone (off by ${out.where} mm)`);
  assert.equal(out["one group a triangle"], true, "no triangle spans a face and an edge");
  assert.deepEqual(out.facing, [true, true, true], "the top's triangles face up, the bottom's down, the edges' sideways");
  close([...out.bounds[0], ...out.bounds[1]], [20, 0, 5, 30, 20, 6.6], "the board where it is placed");
  assert.ok(out.coarse[0] < out.coarse[1], `coarser than a part: ${out.coarse}`);
  assert.equal(out["same again"], true, "the same model each time");
  const plain = [false, "cad", "(previews/system.glb: pcb is drawn without its board's picture: it is made from a board board_from_gerbers read, but mirrored, cut or joined to another shape, so the picture is not of it)"];
  assert.deepEqual(out.placed, {
    move: [true, "board pcb", ""], located: [true, "board pcb", ""], baked: [true, "board pcb", ""], solid: [true, "board pcb", ""],
    mirror: plain, "mirror about its middle": plain, cut: plain, joined: plain,
  }, "however it is put there, the board wears its picture as placed by Pos and Rot; mirrored, cut or joined it is a plain part, said so");
  assert.equal(once("2").sha, out.sha, "and in another process");
});

test("a part that sits where it should but 0.1 mm from a wall fails the clearance gate", { skip }, () => {
  product(7, { blockHalfMm: 17.9 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const clearance = result().gates.find((g) => g.id === "clearance")!;
  assert.equal(clearance.status, "fail");
  assert.match(clearance.detail, /blk is 0\.10 mm from tray beside where they touch|tray is 0\.10 mm from blk beside where they touch/);
  // Where: between the block's side and the tray's wall, 0.1 mm apart at x 17.9 to 18.
  const i = clearance.list!.findIndex((p) => / beside where they touch/.test(p));
  const w = clearance.where![i];
  assert.deepEqual([...w.parts].sort(), ["blk", "tray"]);
  assert.ok(w.at![0] >= 17.9 - 0.01 && w.at![0] <= 18 + 0.01, JSON.stringify(w));
});

test("a part of a fit that only touches its partner is not a fit", { skip }, () => {
  product(7, { pinBottomMm: 2 });
  const r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const overlap = result().gates.find((g) => g.id === "overlap")!;
  assert.equal(overlap.status, "fail");
  assert.match(overlap.detail, /pin only touches tray, so it is not a fit \(pressed 1 mm into the floor\): make it a Contact/);
  // Where: the pin's foot on the floor, 2 mm up, from each side of the fit.
  assert.deepEqual(overlap.where!.map((w) => w.parts), [["pin", "tray"], ["tray", "pin"]]);
  assert.ok(overlap.where!.every((w) => Math.abs(w.at![2] - 2) < 0.01), JSON.stringify(overlap.where));
  assert.deepEqual(result().relations!.fits[0].pairs, [], "no pair meets the fit");
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
    writeFileSync(join(dir, "previews", "system.glb"), "glTF");
    const r = run();
    assert.equal(r.status, 1, `${what}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Traceback|Error/, what);
    const s = result();
    assert.equal(s.ok, false, what);
    assert.deepEqual(s.gates.map((g) => [g.id, g.status]), [["inputs", "fail"]], what);
    assert.match(s.gates[0].detail, says, what);
    assert.deepEqual(s.gates[0].list, [s.gates[0].detail], what);
    assert.deepEqual([s.gates[0].where, s.items, s.minClearanceMm, s.relations],
      [[{ parts: [], at: null }], [], null, { fits: [], contacts: [], gaps: [], inside: [], unplaced: {} }], `${what}: no frame`);
    assert.match(r.stdout, /✗ inputs: /, what);
    assert.ok(!existsSync(join(dir, "previews", "system.svg")), `${what}: the old drawing is gone`);
    assert.ok(!existsSync(join(dir, "previews", "system.glb")), `${what}: and the old model`);
    assert.equal(s.model, null, what);
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

test("a system() that returns no System, or stops on an error of its own, fails the check saying so, and system.json is still written", { skip }, () => {
  const cases: [string, string, RegExp, RegExp][] = [
    ["no System", SYSTEM.replace("    return System(", "    System("),
      /^TypeError: cad\/_system\.py's system\(\) returned NoneType, not a System: return the System it builds$/m,
      /^cad\/_system\.py's system\(\) returned NoneType, not a System: return the System it builds$/],
    ["an error", SYSTEM.replace("def system():\n", 'def system():\n    raise RuntimeError("the frame is broken")\n'),
      /^RuntimeError: the frame is broken$/m, /^cad\/_system\.py stopped on RuntimeError: the frame is broken$/],
  ];
  for (const [what, code, stderr, detail] of cases) {
    product(7);
    writeFileSync(join(dir, "cad", "_system.py"), code);
    writeFileSync(join(dir, "system.json"), "{}");
    const r = run();
    assert.equal(r.status, 1, `${what}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, stderr, what);
    // Not the checker's own code: what stopped is the result, of the files as they are, so the run isn't stale.
    assert.deepEqual(result().gates.map((g) => [g.id, g.status]), [["inputs", "fail"]], what);
    assert.match(result().gates[0].detail, detail, what);
    const audit = systemAudit(dir, bom);
    assert.deepEqual(audit.failed, ["inputs"], what);
    assert.equal(audit.detail, `the whole product can't be checked: ${result().gates[0].detail}`, what);
  }
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
  // A flag is marked where the problem it would be is: the port's sensor and what blocks it, at the port.
  assert.deepEqual(fn.flagsWhere, [{ parts: ["blk", "lid"], at: [0, 0, 7] }]);
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
  // Marked between the two, 0.1 mm apart under the lid; the Gap lists the pair it lets sit closer.
  assert.deepEqual([...clearance.flagsWhere![0].parts].sort(), ["blk", "lid"]);
  close([clearance.flagsWhere![0].at![2]], [9.95], "midway under the lid");
  assert.deepEqual(s.relations!.gaps.map((g) => [g.a, g.b, g.mm, g.pairs]), [["blk", "lid", 0.05, [["blk", "lid"]]]]);
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
  // Each marked at its probe, with the parts in its way; the keep-out at the pin's side nearest the radio.
  assert.deepEqual(fn.flagsWhere!.map((w) => w.parts), [["blk", "lid"], [], ["blk", "lid"], ["lid"], ["pin"]]);
  assert.deepEqual(fn.flagsWhere!.slice(0, 4).map((w) => w.at), [[0, 0, 30], [0, 0, 30], [0, 0, 30], [-10, 0, 3]]);
  close(fn.flagsWhere![4].at!.slice(0, 2), [11, 10], "the pin's side");
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
