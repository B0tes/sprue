// The 3D view's data (pipeline/model.ts) and what the view (viewer/model.js) makes of it: modelView reads each example's
// frame, what meets what, each problem with the parts it names and each gate's count, and lists a line's files only when
// they are its own and in the folder; the panel says what a part is, leads with the problems that name it, says what
// the check couldn't put on any part, and never that it passes; a gap, a contact's gap and a part outside its case read
// as the check found them. With the vendored three, each part is readied to draw with its creases and its outline from
// the camera, the camera frames the whole product, the planes hold it near and far, and a pick finds the part drawn
// under the pointer. Then the view itself in Chromium, where Playwright can be resolved (skipped where it can't, as in
// CI): it draws, hover lights and a click pins and unpins, the readout keeps a pinned part, a drag or a pinch pins
// nothing, the list and the panel pin parts and keep the focus, Fit eases back (at once under reduced motion), the keys
// turn and zoom, the wheel zooms only once the view has focus, a pan or a zoom of a product of any size is drawn and
// then still, hover follows the camera, a theme change recolours it, destroy lets go of it all; the panel with nothing
// pinned says the check fails; Ponder's failing parts lead with their problems; a stale model says so; and without
// WebGL 2, or with a model that can't be read, it says so and the list and the panel still work. Run with
//   node --test skills/sprue/pipeline/model.test.ts
// and, for the Chromium half, NODE_PATH set to a node_modules that has playwright (SPRUE_BROWSER_TESTS=1 fails where
// it can't run, rather than skipping).

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { lineFiles, modelView, type ModelView } from "./model.ts";
import type { Bom, SystemCheck } from "./types.ts";
import * as k from "../kit/iso-kit.mjs";
import { between, fileLink, frameOf, labelOf, legendOf, look, outline, panelOf, partsList, pickAt, planesOf, prepare, readoutOf, wholeOf } from "../viewer/model.js";

const SKILL = join(import.meta.dirname, "..");
const EXAMPLES = join(SKILL, "examples");
const THREE_DIR = join(SKILL, "viewer", "vendor", "three");
const tmp = mkdtempSync(join(tmpdir(), "sprue-model-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** An example's folder as the repo has it: without fab/ and pcb/, which git ignores, so CI has neither. */
function copyOf(slug: string, name = slug) {
  const dir = join(tmp, name);
  cpSync(join(EXAMPLES, slug), dir, { recursive: true, filter: (src) => !/[/\\](fab|pcb|shots|production)$/.test(src) });
  return dir;
}

/** A keypad view as it is beside its board's zip: a copy as git has it lacks pcb/, so its check reads as of an earlier
 * design, as the test of that below says. The other tests are of a check of the files as they are. */
const current = (view: ModelView): ModelView => ({ ...view, stale: [] });

test("modelView reads each example's frame: its items, what meets what, and each problem and accepted risk with its parts", () => {
  for (const slug of ["macropad", "ponder"]) {
    const dir = copyOf(slug);
    const sys = json<SystemCheck>(join(dir, "system.json"));
    const bom = json<Bom>(join(dir, "bom.json"));
    const v = modelView(dir)!;
    assert.ok(v, slug);
    assert.equal(v.slug, slug);
    assert.deepEqual(v.model, sys.model);
    assert.deepEqual(v.items, sys.items);
    assert.deepEqual(v.relations, sys.relations);
    assert.equal(v.minClearanceMm, sys.minClearanceMm);
    assert.deepEqual(Object.keys(v.lines), bom.lines.map((l) => l.id));
    for (const l of bom.lines) {
      assert.deepEqual(v.lines[l.id], { name: l.name, ...(l.shortName ? { short: l.shortName } : {}), process: l.process, qtyPerUnit: l.qtyPerUnit,
        ...(l.qtyPerBatch !== undefined ? { qtyPerBatch: l.qtyPerBatch } : {}) }, `${slug} ${l.id}`);
    }
    // Every problem a gate lists, and every risk it accepts, with where it is, and a stability problem's pose.
    const poseOf = (g: { id: string }, text: string) => (g.id === "stability" ? (sys.stability ?? []).map((s) => s.pose).find((n) => text.startsWith(`${n}: `)) ?? null : null);
    const want = sys.gates.flatMap((g) => [
      ...(g.list ?? []).map((text, i) => ({ gate: g.id, title: g.title, text, parts: g.where![i].parts, at: g.where![i].at, accepted: false, pose: poseOf(g, text) })),
      ...(g.flags ?? []).map((text, i) => ({ gate: g.id, title: g.title, text, parts: g.flagsWhere![i].parts, at: g.flagsWhere![i].at, accepted: true, pose: poseOf(g, text) })),
    ]);
    assert.deepEqual(v.problems, want, slug);
    // Each gate, with how many problems it has and lists, and whether it ran.
    assert.deepEqual(v.gates, sys.gates.map((g) => ({ id: g.id, title: g.title, status: g.status, problems: g.problems, listed: g.list?.length ?? 0, ran: true })), slug);
    assert.equal(v.bom, true);
    assert.equal(v.ok, sys.ok);
    assert.deepEqual(v.selfTest, { ok: sys.selfTest.ok, missed: [], untested: [] }, slug);
  }
  const keypad = modelView(join(tmp, "macropad"))!, ponder = modelView(join(tmp, "ponder"))!;
  assert.equal(keypad.problems.length, 0, "the keypad passes its whole-product check");
  assert.equal(ponder.problems.filter((p) => !p.accepted).length, 10, "Ponder's 6 clearance problems and 4 in the radio's keep-out");
  assert.ok(ponder.problems.some((p) => p.accepted), "Ponder accepts some risks");
  // Each of Ponder's risks of tipping is of the pose it was weighed in: two pushes as built, and the arm pulled out four ways.
  assert.deepEqual(ponder.problems.filter((p) => p.gate === "stability").map((p) => p.pose), ["as built, head over the page", "as built, head over the page",
    ...["forward", "backward", "right", "left"].map((w) => `arm pulled straight out ${w}`)]);
  assert.ok(ponder.problems.filter((p) => p.gate !== "stability").every((p) => p.pose === null));
});

test("a line's files are the ones in the product folder now, by their paths in it, and none outside it", () => {
  const dir = copyOf("macropad", "files");
  let v = modelView(dir)!;
  const paths = (line: string, view: ModelView = v) => (view.files[line] ?? []).map((f) => f.path);
  // As git has the example: the CAD code and the drawings, no exports.
  assert.deepEqual(paths("top"), ["cad/top.py", "previews/top.svg"]);
  assert.deepEqual(paths("bot"), ["cad/bottom.py", "previews/bottom.svg"]);
  assert.deepEqual(paths("pcb"), ["cad/pcb.mjs", "previews/pcb-top.svg", "previews/pcb-bottom.svg", "firmware/code.py"]);
  // A bought part is an envelope the whole-product check draws.
  assert.deepEqual(v.files.cap, [{ path: "cad/_system.py", what: "the whole-product check, which draws its envelope" }]);
  // Once `sprue cad` and `sprue pcb` have run, their files are listed too.
  mkdirSync(join(dir, "fab"));
  mkdirSync(join(dir, "pcb"));
  for (const f of ["fab/top.stl", "fab/top.step", "pcb/macropad-gerbers.zip"]) writeFileSync(join(dir, f), "x");
  v = modelView(dir)!;
  assert.deepEqual(v.files.top, [
    { path: "cad/top.py", what: "its CAD code" }, { path: "fab/top.stl", what: "the mesh the printer gets" },
    { path: "fab/top.step", what: "its STEP model" }, { path: "previews/top.svg", what: "its drawing" }]);
  assert.deepEqual(paths("pcb"), ["cad/pcb.mjs", "pcb/macropad-gerbers.zip", "previews/pcb-top.svg", "previews/pcb-bottom.svg", "firmware/code.py"]);
  // The board's code, pictures and firmware are the board's line's: the line whose file is the zip board.json names
  // (pcb/<slug>-gerbers.zip without one), else the first board line with no file, as the order folder picks it.
  const bom = json<Bom>(join(dir, "bom.json")), sys = json<SystemCheck>(join(dir, "system.json"));
  const pcbItem = sys.items!.find((i) => i.id === "pcb")!;
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ ...bom, lines: [{ ...bom.lines.find((l) => l.id === "pcb")!, id: "pcb2", name: "Daughter board", file: undefined }, ...bom.lines] }));
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, items: [...sys.items!, { ...pcbItem, id: "pcb-b", line: "pcb2" }] }));
  v = modelView(dir)!;
  assert.deepEqual(paths("pcb"), ["cad/pcb.mjs", "pcb/macropad-gerbers.zip", "previews/pcb-top.svg", "previews/pcb-bottom.svg", "firmware/code.py"]);
  assert.deepEqual(paths("pcb2"), [], "another board line has none of the board's files");
  writeFileSync(join(dir, "pcb", "board.json"), JSON.stringify({ files: { zip: "other-gerbers.zip" } }));
  v = modelView(dir)!;
  assert.deepEqual(v.files.pcb, [{ path: "pcb/macropad-gerbers.zip", what: "the file the BOM names for it" }], "a zip that isn't the board's is only the line's file");
  assert.deepEqual(paths("pcb2"), ["cad/pcb.mjs", "previews/pcb-top.svg", "previews/pcb-bottom.svg", "firmware/code.py"], "the board line with no file");
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "system.json"), JSON.stringify(sys));
  rmSync(join(dir, "pcb", "board.json"));
  v = modelView(dir)!;
  // A folder by the file's name is no file.
  rmSync(join(dir, "fab", "top.step"));
  mkdirSync(join(dir, "fab", "top.step"));
  assert.deepEqual(paths("top", modelView(dir)!), ["cad/top.py", "fab/top.stl", "previews/top.svg"]);

  // A BOM line that names a file outside the folder, by a relative path, an absolute one or a link, lists none of it.
  const outside = join(tmp, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "lid.stl"), "x");
  writeFileSync(join(outside, "lid.py"), "x");
  const line = { id: "lid", name: "Lid", role: "case", process: "print" as const, qtyPerUnit: 1, spec: {} };
  assert.deepEqual(lineFiles(dir, { ...line, file: "../outside/lid.stl" }, false), []);
  assert.deepEqual(lineFiles(dir, { ...line, file: join(outside, "lid.stl") }, false), []);
  symlinkSync(outside, join(dir, "out"));
  assert.deepEqual(lineFiles(dir, { ...line, file: "out/lid.stl" }, false), []);
  // Inside, by any spelling, a file is listed once, by its path in the folder.
  assert.deepEqual(lineFiles(dir, { ...line, file: "./fab/../fab/top.stl" }, false).map((f) => f.path), ["cad/top.py", "fab/top.stl", "previews/top.svg"]);
  assert.deepEqual(lineFiles(dir, { ...line, process: "buy", file: "datasheet.pdf" }, true).map((f) => f.path), ["cad/_system.py"]);
  // cad/<name>.py and previews/<name>.svg are a line's own only when its file is the export `sprue cad` makes of them:
  // not a bought part's STEP of the same name, nor a mesh elsewhere, nor one outside the folder by that name.
  mkdirSync(join(dir, "datasheets"));
  writeFileSync(join(dir, "datasheets", "top.step"), "x");
  assert.deepEqual(lineFiles(dir, { ...line, process: "buy", file: "datasheets/top.step" }, false), [{ path: "datasheets/top.step", what: "its STEP model" }]);
  assert.deepEqual(lineFiles(dir, { ...line, file: "datasheets/top.step" }, false).map((f) => f.path), ["datasheets/top.step"]);
  mkdirSync(join(outside, "fab"));
  writeFileSync(join(outside, "fab", "bottom.stl"), "x");
  assert.deepEqual(lineFiles(dir, { ...line, file: "../outside/fab/bottom.stl" }, false), []);
  assert.deepEqual(lineFiles(dir, { ...line, file: "fab/_system.stl" }, false), [], "no export is named _*");
  // A page in the folder links each by its names, encoded: a '#' or a name like a scheme stays a file's name.
  assert.equal(fileLink("fab/lid #2.stl"), "./fab/lid%20%232.stl");
  assert.equal(fileLink("javascript:alert(1)"), "./javascript%3Aalert(1)");

  // With no bom.json to read, a part's line is only its id: an envelope still lists the code that draws it.
  rmSync(join(dir, "bom.json"));
  const unread = modelView(dir)!;
  assert.equal(unread.bom, false);
  assert.deepEqual(unread.lines, {});
  assert.deepEqual(paths("cap", unread), ["cad/_system.py"]);
  assert.deepEqual(paths("top", unread), []);
  // A part of a line it can't know is its id alone, which has its number already.
  assert.equal(readoutOf(unread, "sw1"), "sw1 · line sw · envelope");
  assert.equal(labelOf(unread, "sw1"), "sw1");
  assert.equal(panelOf(unread, "sw1")!.sub, "sw1 · line sw");
  assert.equal(partsList(unread).find((g) => g.line === "sw")!.items[0].label, "sw1");
  assert.deepEqual(panelOf(unread, "sw1")!.facts.find((f) => f[0] === "In the BOM"), ["In the BOM", "bom.json could not be read (line sw)"]);
  assert.equal(panelOf(unread, "top")!.filesNote, "Its files can't be known without bom.json.");
  assert.equal(panelOf(v, "cap1")!.filesNote, "", "a part with files has no note of none");
  writeFileSync(join(dir, "bom.json"), "{ half a bom");
  assert.equal(modelView(dir)!.bom, false, "nor one that doesn't parse");
});

test("modelView has nothing to show without a frame and its model, and says which gates couldn't run, aren't all listed or weren't proven", () => {
  const dir = copyOf("macropad", "none");
  const sys = json<SystemCheck>(join(dir, "system.json"));
  const put = (s: unknown) => writeFileSync(join(dir, "system.json"), typeof s === "string" ? s : JSON.stringify(s));
  put("{ not json");
  assert.equal(modelView(dir), null, "a system.json that doesn't parse");
  put({ ...sys, model: null });
  assert.equal(modelView(dir), null, "no model was made");
  put({ ...sys, items: undefined });
  assert.equal(modelView(dir), null, "a system.json of an earlier Sprue");
  put({ ...sys, items: [] });
  assert.equal(modelView(dir), null, "no frame: the inputs gate");
  // The model is the folder's own, as the page inlines it.
  mkdirSync(join(tmp, "elsewhere", "previews"), { recursive: true });
  cpSync(join(dir, "previews", "system.glb"), join(tmp, "elsewhere", "previews", "system.glb"));
  put({ ...sys, model: { ...sys.model!, file: "../elsewhere/previews/system.glb" } });
  assert.equal(modelView(dir), null, "a model outside the folder");
  put({ ...sys, model: { ...sys.model!, file: "./previews/../previews/system.glb" } });
  assert.equal(modelView(dir)!.model.file, "previews/system.glb", "by its path in the folder");
  // A gate that couldn't run, one whose list is cut at 200, and a self-test that missed a fault, as system.json has them.
  const gates = sys.gates.map((g) => g.id === "overlap"
    ? { ...g, status: "fail" as const, detail: "Can't run: no fab/top.stl", problems: 1, list: ["Can't run: no fab/top.stl"], where: [{ parts: [], at: null }] }
    : g.id === "clearance" ? { ...g, status: "fail" as const, detail: "250 pairs", problems: 250,
      list: Array.from({ length: 200 }, (_, i) => `cap1 is 0.1 mm from cap2 (${i})`), where: Array.from({ length: 200 }, () => ({ parts: ["cap1", "cap2"], at: null })) } : g);
  put({ ...sys, ok: false, gates, selfTest: { ok: false, faults: [{ ...sys.selfTest.faults[0], caught: false }, ...sys.selfTest.faults.slice(1)], untested: ["inside"] } });
  const cut = current(modelView(dir)!);
  assert.deepEqual(cut.gates.filter((g) => !g.ran || g.listed !== g.problems).map((g) => [g.id, g.ran, g.problems, g.listed]),
    [["overlap", false, 1, 1], ["clearance", true, 250, 200]]);
  assert.equal(cut.ok, false);
  assert.deepEqual(cut.selfTest, { ok: false, missed: [`${sys.selfTest.faults[0].gate}: ${sys.selfTest.faults[0].fault}`], untested: ["inside"] });
  assert.deepEqual(panelOf(cut, "cap1")!.notes.map((n) => n.label), ["Not checked", "Not listed", "Not proven"]);
  assert.equal(panelOf(cut, "cap1")!.count, "200 problems · 3 caveats");
  assert.deepEqual(wholeOf(cut).problems.map((p) => p.text), ["Can't run: no fab/top.stl"], "a gate that couldn't run names no part");
  put(sys);
  rmSync(join(dir, "previews", "system.glb"));
  assert.equal(modelView(dir), null, "no previews/system.glb");
  rmSync(join(dir, "system.json"));
  assert.equal(modelView(dir), null, "no system.json");
});

test("the panel says what a part is, what it meets, the problems that name it and its files, and never that it passes", () => {
  const keypad = current(modelView(copyOf("macropad", "panel-keypad"))!);
  const cap = panelOf(keypad, "cap6")!;
  assert.equal(cap.title, keypad.lines.cap.name);
  assert.equal(cap.sub, "cap6 · 6 of 9 · bought");
  assert.deepEqual(cap.facts[0], ["Drawn", "as an envelope: stand-in shapes (boxes, cylinders, cones, prisms) at the sizes its datasheet or an estimate gives, not its maker's model"]);
  assert.deepEqual(cap.facts.find((f) => f[0] === "In the BOM"), ["In the BOM", "9 a unit (cap)"]);
  assert.deepEqual(cap.facts.find((f) => f[0] === "Mass"), ["Mass", "2 g, estimate: typical for the part, no published mass"]);
  assert.deepEqual(cap.facts.find((f) => f[0] === "Size"), ["Size", "18.2 × 18.2 × 7.4 mm (x, y, z), of what is drawn"]);
  assert.equal(cap.count, "");
  assert.deepEqual(cap.meets, [{ kind: "fit", with: ["sw6"], why: "the cap's skirt goes over the switch housing and its socket onto the stem" }]);
  assert.deepEqual(cap.problems, []);
  assert.equal(readoutOf(keypad, "cap6"), "Keycap 6 of 9 · bought · envelope");
  assert.equal(readoutOf(keypad, "top"), "Top / plate · printed · CAD");
  assert.equal(labelOf(keypad, "sw6"), "Switch 6");
  assert.equal(labelOf(keypad, "pcb"), "PCB");
  assert.equal(panelOf(keypad, "nothing"), null);

  // A case part holds everything inside it in one row; a part inside it says what it is inside.
  const top = panelOf(keypad, "top")!;
  assert.deepEqual(top.facts.find((f) => f[0] === "Material"), ["Material", "PETG"]);
  const holds = top.meets.filter((m) => m.kind === "holds");
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].with, ["ctrl", ...Array.from({ length: 9 }, (_, i) => `sock${i + 1}`), "ins1", "ins2", "ins3", "ins4"]);
  assert.deepEqual(panelOf(keypad, "ctrl")!.meets.find((m) => m.kind === "inside"), { kind: "inside", with: ["top", "bot"], why: "the Pico" });
  assert.equal(holds[0].why, "");
  // A contact keeps the rule's gap elsewhere, or its own; one at 0 need only not overlap, and says nothing of one.
  const sw1 = panelOf(keypad, "sw1")!.meets.filter((m) => m.kind === "contact");
  assert.deepEqual(sw1.map((m) => [m.with, m.why]), [
    [["pcb"], keypad.relations.contacts.find((c) => c.a === "sw*" && c.b === "pcb")!.why],
    [["top"], `${keypad.relations.contacts.find((c) => c.a === "sw*" && c.b === "top")!.why}; elsewhere their faces must keep 0.2 mm apart, the rule for every pair`]]);

  // The keypad passes, and no part of it says so: the whole-product check is Inspect's to judge.
  for (const { id } of keypad.items) {
    const p = panelOf(keypad, id)!;
    assert.deepEqual(p.problems, [], id);
    assert.doesNotMatch(JSON.stringify(p), /✓|\bpass(es|ed)?\b/i, id);
  }

  // Ponder fails: each problem is on the panel of each part it names, and of no other.
  const ponder = modelView(copyOf("ponder", "panel-ponder"))!;
  for (const { id } of ponder.items) {
    const want = ponder.problems.filter((p) => p.parts.includes(id)).map((p) => p.text);
    assert.deepEqual(panelOf(ponder, id)!.problems.map((p) => p.text), want, id);
  }
  const shell = panelOf(ponder, "head-upper")!;
  assert.deepEqual(shell.problems.map((p) => [p.gate, p.accepted]), [["clearance", false], ["clearance", false], ["clearance", false]]);
  assert.ok(partsList(ponder).flatMap((g) => g.items).find((i) => i.id === "head-upper")!.label.endsWith(" · 3 problems"), "the list says which parts have problems");
  assert.match(shell.problems[1].text, /^head-upper is 0\.09 mm from ledmute/);
  assert.deepEqual(panelOf(ponder, "scr25-4")!.problems.map((p) => p.text), ["pi-radio: scr25-4 is 8.9 mm away, under 15 mm"]);
  assert.deepEqual(shell.files.map((f) => f.path), ["cad/head-upper.py", "previews/head-upper.svg"]);
  assert.equal(shell.count, "3 problems");
  // With nothing pinned, the panel says first that Ponder fails, which gates and on which parts, then what no one
  // part's panel carries: its risks of the product as a whole.
  const whole = wholeOf(ponder);
  const on = (gate: string) => [...new Set(ponder.problems.filter((p) => p.gate === gate && !p.accepted).flatMap((p) => p.parts))];
  assert.deepEqual(whole.failing, [
    { gate: "clearance", title: ponder.gates.find((g) => g.id === "clearance")!.title, problems: 6, parts: on("clearance") },
    { gate: "function", title: ponder.gates.find((g) => g.id === "function")!.title, problems: 4, parts: on("function") }]);
  assert.equal(whole.ok, false);
  assert.equal(whole.summary, `It fails 2 of its 7 gates, with 10 problems on ${new Set([...on("clearance"), ...on("function")]).size} parts: pick one to see its own.`);
  assert.deepEqual(whole.problems.map((p) => [p.gate, p.accepted]), Array(6).fill(["stability", true]));
  assert.deepEqual(whole.notes, []);
  // Then the risks it accepts on parts, gate by gate, with the parts they name.
  const risks = ponder.gates.map((g) => {
    const of = ponder.problems.filter((p) => p.accepted && p.gate === g.id && p.parts.some((x) => ponder.items.some((i) => i.id === x)));
    return { gate: g.id, title: g.title, problems: of.length, parts: [...new Set(of.flatMap((p) => p.parts))] };
  }).filter((g) => g.problems);
  assert.deepEqual(whole.accepted, risks);
  assert.deepEqual(wholeOf(keypad), { ok: true, summary: "It passes all 7 gates.", failing: [], accepted: [], problems: [], notes: [] });
});

/** A copy of a view with its data changed, as a system.json the examples don't have would give it. */
const variant = (view: ModelView, change: (v: ModelView) => void) => { const v = structuredClone(view); change(v); return v; };

test("a part drawn along a path, Ponder's gooseneck, reads as one: in the model, where the drawing puts it in, and checked by no gate as a shape", () => {
  const dir = copyOf("ponder", "path-ponder");
  const ponder = modelView(dir)!;
  const sys = json<SystemCheck>(join(EXAMPLES, "ponder", "system.json"));
  const arm = ponder.items.find((i) => i.id === "arm")!;
  const params = json<{ params: Record<string, unknown> }>(join(dir, "design.json")).params;
  assert.deepEqual([arm.line, arm.model, arm.material, arm.tags, arm.massG, arm.massNote, arm.estimated],
    ["arm", "path", null, [], params.armMassG, params.armMassNote, true], "weighed as the design pose's PointMass weighs it");
  assert.match(arm.why!, /^the route the design pose bends it to \(arm_solve, .*placed counts it for its BOM line, and no other gate sees it$/);
  assert.equal(ponder.items.filter((i) => i.model === "path").length, 1);
  assert.equal(ponder.items.length, sys.parts + 1, "the parts the gates check, and the gooseneck");
  // It runs from the base coupling up past the head and down into the head coupling.
  const [x0, y0, z0, x1, y1, z1] = arm.bbox!;
  assert.ok(Math.abs(x1 - x0 - 12.7) < 0.01, `as wide as the gooseneck (${x1 - x0} mm)`);
  const head = ponder.items.find((i) => i.id === "head-upper")!.bbox!;
  assert.ok(z1 > head[5] + 50 && z0 < 60 && y0 < 0 && y1 > head[1], JSON.stringify(arm.bbox));
  assert.equal(readoutOf(ponder, "arm"), "Gooseneck · bought · path");
  const panel = panelOf(ponder, "arm")!;
  assert.deepEqual(panel.facts[0], ["Drawn", `along a path, which no gate checks as a shape: ${arm.why}`]);
  assert.equal(panel.facts.find((f) => f[0] === "Mass")![1], `${params.armMassG} g, ${params.armMassNote}`);
  assert.match(panel.facts.find((f) => f[0] === "Size")![1], /, of what is drawn$/);
  assert.deepEqual(panel.files, [{ path: "cad/_system.py", what: "the whole-product check, which draws it along its path" }]);
  assert.deepEqual(panel.problems, [], "no gate names it");
  // The drawing puts the gooseneck in at its step and moves it apart its way; the model follows it.
  const figure = json<{ parts: { line?: string; step?: number }[] }>(join(dir, "figure.json"));
  const step = figure.parts.find((q) => q.line === "arm")!.step;
  assert.equal(ponder.assembly!.parts.arm.step, step);
  assert.equal(ponder.assembly!.unsure.arm, undefined);
  // Its mass is the PointMass the stability gate weighs in the pose drawn: the rest it weighs as points is the harness.
  const points = sys.stability[0].massG - ponder.items.reduce((t, i) => t + (i.massG ?? 0), 0);
  assert.ok(points > 0 && points < 60, `${points} g the model has no part for`);
  // Without a reason, the panel still says no gate checks it.
  const bare = variant(ponder, (v) => { delete v.items.find((i) => i.id === "arm")!.why; });
  assert.deepEqual(panelOf(bare, "arm")!.facts[0], ["Drawn", "along a path, which no gate checks as a shape"]);
  // The code that draws it is the line's file, as an envelope's is, and only once.
  const line = { id: "arm", name: "Gooseneck", role: "arm", process: "buy" as const, qtyPerUnit: 1, spec: {} };
  assert.deepEqual(lineFiles(dir, line, false, false, true), [{ path: "cad/_system.py", what: "the whole-product check, which draws it along its path" }]);
  assert.deepEqual(lineFiles(dir, line, true, false, true).map((f) => f.path), ["cad/_system.py"]);
});

test("what the panel says of a gap the design allows, a contact's gap, a part outside its case, and problems it can't place", () => {
  const keypad = current(modelView(copyOf("macropad", "panel-variants"))!);
  // Two gaps: one with a reason the check accepts; one with none, so the check fails the pair, as its problem says.
  const gaps = variant(keypad, (v) => {
    v.relations.gaps = [{ a: "scr1", b: "bot", mm: 0.1, accept: "the head sits in a counterbore", pairs: [["scr1", "bot"]] },
      { a: "scr2", b: "bot", mm: 0.1, accept: "", pairs: [["scr2", "bot"]] }];
    v.problems.push({ gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "scr2 is 0.15 mm from bot", parts: ["scr2", "bot"], at: null, accepted: false, pose: null });
  });
  assert.deepEqual(panelOf(gaps, "scr1")!.meets.find((m) => m.kind === "gap"),
    { kind: "gap", with: ["bot"], why: "down to 0.1 mm, where the rule for other pairs is 0.2 mm: the head sits in a counterbore" });
  assert.deepEqual(panelOf(gaps, "scr2")!.meets.find((m) => m.kind === "gap"), { kind: "gap", with: ["bot"],
    why: "down to 0.1 mm, where the rule for other pairs is 0.2 mm: the design gives no reason, so it isn't accepted. The check fails it with Tray: see the problem" });
  assert.deepEqual(panelOf(gaps, "scr2")!.problems.map((p) => p.text), ["scr2 is 0.15 mm from bot"]);
  assert.equal(panelOf(gaps, "scr2")!.count, "1 problem");
  // A contact's gap is what their other faces must keep; the check finding them closer says so.
  const apart = variant(keypad, (v) => { v.relations.contacts![0].gap = 0.5; });
  assert.equal(panelOf(apart, "pcb")!.meets.find((m) => m.kind === "contact")!.why, "the board on the tray's standoffs; elsewhere their faces must keep 0.5 mm apart");
  const close = variant(apart, (v) => {
    v.problems.push({ gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "pcb is 0.31 mm from bot beside where they touch, at (0.0, 0.0, 1.6)", parts: ["pcb", "bot"], at: [0, 0, 1.6], accepted: false, pose: null });
  });
  assert.equal(panelOf(close, "pcb")!.meets.find((m) => m.kind === "contact")!.why,
    "the board on the tray's standoffs; elsewhere their faces must keep 0.5 mm apart. The check finds them closer than that beside where they touch: see the problem");
  // Of a row of several parts, the ones the check finds closer.
  const sock = variant(keypad, (v) => {
    v.problems.push({ gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "sock3 is 0.11 mm from pcb beside where they touch", parts: ["sock3", "pcb"], at: null, accepted: false, pose: null });
  });
  const row = panelOf(sock, "pcb")!.meets.find((m) => m.kind === "contact" && m.with.includes("sock3"))!;
  assert.ok(row.with.length > 1 && row.why.endsWith(`. The check finds ${labelOf(keypad, "sock3")} closer than that beside where they touch: see the problem`), row.why);
  // The Pico meant to be inside the case, which the check finds sticking out: its row and the case's say so.
  const out = variant(keypad, (v) => {
    v.problems.push({ gate: "inside", title: "The parts meant to be inside the case are inside it", text: "ctrl reaches 2.10 mm outside the case top/bot", parts: ["ctrl"], at: [0, 0, 0], accepted: false, pose: null });
  });
  assert.deepEqual(panelOf(out, "ctrl")!.meets.find((m) => m.kind === "inside"),
    { kind: "inside", with: ["top", "bot"], why: "the Pico. The check finds it outside: see the problem" });
  assert.equal(panelOf(out, "top")!.meets.find((m) => m.kind === "holds")!.why, "The check finds Pico outside: see its panel");
  // A gate whose list system.json cut at 200, and one that couldn't run: every panel says what it can't show, and
  // so does the panel with nothing pinned.
  const cut = variant(keypad, (v) => {
    v.gates.find((g) => g.id === "clearance")!.status = "fail";
    Object.assign(v.gates.find((g) => g.id === "clearance")!, { problems: 250, listed: 200 });
    Object.assign(v.gates.find((g) => g.id === "overlap")!, { status: "fail", problems: 1, listed: 1, ran: false, title: "overlap" });
  });
  assert.deepEqual(panelOf(cut, "cap1")!.notes, [
    { label: "Not checked", text: "overlap couldn't run, so it checked no part, this one too." },
    { label: "Not listed", text: "50 more problems of “Every other pair is at least 0.2 mm apart” aren't listed by part: this part may be among them." }]);
  assert.equal(panelOf(cut, "cap1")!.count, "2 caveats", "they count on the panel, so a part never reads as having nothing said of it");
  assert.deepEqual(wholeOf(cut).notes, [
    { label: "Not checked", text: "overlap couldn't run, so it checked no part." },
    { label: "Not listed", text: "50 more problems of “Every other pair is at least 0.2 mm apart” aren't listed by part." }]);
  assert.equal(wholeOf(cut).summary, "It fails 2 of its 7 gates, with 251 problems.");
  // A self-test that missed a fault: every gate passes, but that is not proven.
  const unproven = variant(keypad, (v) => { v.ok = false; v.selfTest = { ok: false, missed: ["clearance: a pair moved 0.1 mm closer"], untested: [] }; });
  assert.deepEqual(wholeOf(unproven).notes, [{ label: "Not proven", text: "The check's self-test missed 1 fault it plants (clearance: a pair moved 0.1 mm closer), so a gate it names may pass what it should fail." }]);
  assert.deepEqual([wholeOf(unproven).ok, wholeOf(unproven).summary], [false, "It passes all 7 gates, but not all of it is proven: see below."]);
  // A product that passes but carries risks the design accepts says so.
  assert.equal(wholeOf(variant(keypad, (v) => { v.problems.push({ gate: "stability", title: "It stands", text: "a test", parts: [], at: null, accepted: true, pose: null }); })).summary,
    "It passes all 7 gates, with 1 risk the design accepts.");
  // Risks it accepts on parts: with nothing pinned, the panel names those parts, gate by gate.
  const clearance = keypad.gates.find((g) => g.id === "clearance")!.title;
  const risky = variant(keypad, (v) => {
    v.problems.push({ gate: "clearance", title: clearance, text: "cap1 is 0.15 mm from cap2 (accepted: a test)", parts: ["cap1", "cap2"], at: null, accepted: true, pose: null },
      { gate: "clearance", title: clearance, text: "cap2 is 0.15 mm from cap3 (accepted: a test)", parts: ["cap2", "cap3"], at: null, accepted: true, pose: null });
  });
  assert.deepEqual(wholeOf(risky).accepted, [{ gate: "clearance", title: clearance, problems: 2, parts: ["cap1", "cap2", "cap3"] }]);
  assert.deepEqual([wholeOf(risky).ok, wholeOf(risky).summary, wholeOf(risky).problems], [true, "It passes all 7 gates, with 2 risks the design accepts.", []]);
  // A problem that names only what isn't a part of the frame (a pose) is of no one part.
  const pose = variant(keypad, (v) => { v.problems.push({ gate: "stability", title: "It stands", text: "arm-mass: no mass", parts: ["arm-mass"], at: null, accepted: false, pose: null }); });
  assert.deepEqual(wholeOf(pose).problems.map((p) => p.text), ["arm-mass: no mass"]);
  // A part of a line the BOM lacks says so.
  const lost = variant(keypad, (v) => { delete v.lines.cap; });
  assert.equal(readoutOf(lost, "cap6"), "cap6 · cap, not in the BOM · envelope");
  // A line for the batch says so.
  const batch = variant(keypad, (v) => { v.lines.cap = { ...v.lines.cap, qtyPerUnit: 0, qtyPerBatch: 20 }; });
  assert.deepEqual(panelOf(batch, "cap6")!.facts.find((f) => f[0] === "In the BOM"), ["In the BOM", "20 for the batch (cap)"]);
});

test("a check of an earlier design says so on every panel, and says what it found then", () => {
  // A copy as git has the keypad lacks the board's zip the check was run on, so the check may be of an earlier design:
  // nothing here can say.
  const keypad = modelView(copyOf("macropad", "stale-keypad"))!;
  assert.deepEqual([keypad.stale, keypad.missing], [["pcb/macropad-gerbers.zip"], ["pcb/macropad-gerbers.zip"]]);
  const whole = wholeOf(keypad);
  assert.deepEqual([whole.ok, whole.summary], [false, "When it ran it passed all 7 gates; it may have been of an earlier design: see below."]);
  assert.deepEqual(whole.notes, [{ label: "Not compared",
    text: "It ran with pcb/macropad-gerbers.zip, which isn't here, so it can't be told whether it ran on the design as it is now: what it says may not hold." }]);
  const cap = panelOf(keypad, "cap1")!;
  assert.equal(cap.count, "1 caveat");
  assert.match(cap.notes[0].text, /what it says of this part may not hold\.$/);
  // A file changed as well: of an earlier design, and both said.
  const both = variant(keypad, (v) => { v.stale = ["cad/top.py", ...v.stale]; });
  assert.equal(wholeOf(both).summary, "On an earlier design it passed all 7 gates; the design has changed since: see below.");
  assert.deepEqual(wholeOf(both).notes.map((n) => n.label), ["Out of date", "Not compared"]);
  assert.equal(wholeOf(both).notes[0].text, "The check ran on an earlier design (cad/top.py changed since), so what it says may not hold now: run sprue system macropad again.");
  // Ponder's check is of its files as they are, until a param changes: then it failed, on an earlier design.
  const dir = copyOf("ponder", "stale-ponder");
  assert.deepEqual(modelView(dir)!.stale, []);
  const design = json<{ params: Record<string, unknown> }>(join(dir, "design.json"));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ ...design, params: { ...design.params, ballastClearanceMm: 2 } }));
  const ponder = modelView(dir)!;
  assert.deepEqual(ponder.stale, ["design.json params"]);
  assert.match(wholeOf(ponder).summary, /^On an earlier design it failed 2 of its 7 gates, with 10 problems on \d+ parts: pick one to see its own\.$/);
  assert.deepEqual(wholeOf(ponder).notes.map((n) => n.label), ["Out of date"]);
});

test("the legend counts the parts drawn from CAD and the envelopes, names those drawn along a path and the lines not in the model; the list has every part once", () => {
  const keypad = modelView(copyOf("macropad", "legend-keypad"))!;
  assert.deepEqual(legendOf(keypad), { cad: 3, envelopes: 41, paths: [], unplaced: [], steps: true, unsure: [], marks: { problems: 0, risks: 0, otherPose: 0, noPlace: 0 } });
  const ponder = modelView(copyOf("ponder", "legend-ponder"))!;
  const sys = json<SystemCheck>(join(EXAMPLES, "ponder", "system.json"));
  const legend = legendOf(ponder);
  assert.equal(legend.cad + legend.envelopes + legend.paths.length, ponder.items.length);
  assert.equal(legend.envelopes, sys.envelopes);
  // The gooseneck is drawn along the design pose, by its short name; it is in the model, so not among the lines that aren't.
  assert.deepEqual(legend.paths, ["Gooseneck"]);
  assert.equal(legend.cad, sys.parts - sys.envelopes, "the parts the gates check, less the envelopes");
  // The lines the check doesn't place, with its reasons, then a line for the batch, which it never draws.
  assert.deepEqual(legend.unplaced.map((u) => u.line), ["psu", "diode", "r220", "r1k", "harness", "wire22"]);
  assert.equal(legend.unplaced[0].name, ponder.lines.psu.name);
  assert.equal(legend.unplaced[0].why, sys.relations!.unplaced.psu);
  assert.deepEqual(legend.unplaced[5], { line: "wire22", name: ponder.lines.wire22.name, why: "for the batch, not a unit: not drawn" });
  assert.deepEqual(legendOf(variant(keypad, (v) => { v.lines.spare = { name: "Spare switch", process: "buy", qtyPerUnit: 1 }; })).unplaced,
    [{ line: "spare", name: "Spare switch", why: "no part of it is in the frame" }]);
  for (const view of [keypad, ponder]) {
    const list = partsList(view);
    assert.deepEqual(list.flatMap((g) => g.items.map((i) => i.id)).sort(), view.items.map((i) => i.id).sort());
    assert.equal(new Set(list.map((g) => g.line)).size, list.length, "a group per line");
  }
  assert.deepEqual(partsList(keypad).find((g) => g.line === "feet")!.items.map((i) => i.label),
    ["Rubber foot 1 (foot1)", "Rubber foot 2 (foot2)", "Rubber foot 3 (foot3)", "Rubber foot 4 (foot4)"]);
});

/** The vendored three, loaded as a page would have it (by its files), with what GLTFLoader needs of a browser. */
async function three() {
  const g = globalThis as Record<string, unknown>;
  g.self ??= globalThis;
  g.createImageBitmap ??= async (blob: Blob) => {
    const png = Buffer.from(await blob.arrayBuffer());
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), close() {} };
  };
  const THREE = await import(pathToFileURL(join(THREE_DIR, "three.module.js")).href);
  const { OrbitControls } = await import(pathToFileURL(join(THREE_DIR, "addons", "controls", "OrbitControls.js")).href);
  const { GLTFLoader } = await import(pathToFileURL(join(THREE_DIR, "addons", "loaders", "GLTFLoader.js")).href);
  return { THREE, OrbitControls, GLTFLoader };
}
/** The share of Ponder's stage that is ink in the light theme, at most: 0.55% as it is drawn, 2.95% with its faces
 * hiding nothing behind them. */
const INK_MAX = 0.015;
const COLORS = { face: "#1b1b1b", top: "#262626", paper: "#131313", hi: "#d4d4d4", mid: "#6a6a6a", lo: "#3e3e3e", faint: "#2a2a2a", lit: "#ffffff" };

test("with the vendored three: each part readied to draw, the whole product framed, and a pick finds the part under it", async () => {
  const t = await three();
  const { THREE } = t;
  const view = modelView(copyOf("macropad", "three"))!;
  const glb = readFileSync(join(EXAMPLES, "macropad", view.model.file));
  const gltf = await new t.GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  const parts = prepare(t, gltf.scene, COLORS, new Set(view.items.map((i) => i.id)));
  assert.deepEqual([...parts.keys()], view.items.map((i) => i.id));
  for (const [id, part] of parts) {
    const item = view.items.find((i) => i.id === id)!;
    assert.ok(part.mesh.geometry.attributes.normal, `${id}: smooth normals made`);
    assert.equal(part.mesh.material.flatShading, false, id);
    assert.equal(part.kind, part.mesh.material.map ? "board" : item.model === "envelope" ? "envelope" : "cad", id);
    assert.equal(part.edges.parent, part.mesh, id);
    assert.equal(part.edges.material.isLineDashedMaterial === true, item.model === "envelope", `${id}: an envelope's edges are dashed`);
    assert.ok(part.edges.geometry.attributes.position.count > 0, `${id}: has edges`);
    if (item.model === "envelope") {
      // Dashes need each segment's distance along the line; without them a dashed line draws solid.
      const d = part.edges.geometry.attributes.lineDistance;
      assert.ok(d && d.count === part.edges.geometry.attributes.position.count, `${id}: its dashes are measured`);
      assert.ok(Math.max(...d.array) > 1.2, id);
    }
  }
  assert.ok(parts.get("pcb")!.mesh.material.map, "the board keeps its picture");
  // Lit, a part's edges take the lit tone and its faces lighten; a tone down, its edges step down.
  const top = parts.get("top")!;
  look(t, top, "on", COLORS);
  assert.equal(top.edges.material.color.getHexString(), "ffffff");
  assert.ok(top.mesh.material.color.r > new THREE.Color(COLORS.face).r);
  look(t, top, "dim", COLORS);
  assert.equal(top.edges.material.color.getHexString(), "3e3e3e");
  look(t, top, "rest", COLORS);
  assert.equal(top.edges.material.color.getHexString(), "d4d4d4");
  // An envelope's edges are a tone below a CAD part's, and its faces are the paper's.
  const cap = parts.get("cap1")!;
  look(t, cap, "rest", COLORS);
  assert.deepEqual([cap.edges.material.color.getHexString(), cap.mesh.material.color.getHexString()], ["6a6a6a", "131313"]);
  look(t, cap, "dim", COLORS);
  assert.equal(cap.edges.material.color.getHexString(), "2a2a2a");
  look(t, cap, "on", COLORS);
  assert.equal(cap.edges.material.color.getHexString(), "ffffff");
  look(t, cap, "rest", COLORS);

  // Framed from the front, right and above at 4:3: every corner of the product's box is in view, and it fills it.
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.001, 10);
  const f = frameOf(t, gltf.scene, 4 / 3);
  camera.position.copy(f.position);
  camera.near = f.near;
  camera.far = f.far;
  camera.lookAt(f.center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(gltf.scene);
  let widest = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z > -1 && p.z < 1, `a corner out of view: ${p.toArray()}`);
    widest = Math.max(widest, Math.abs(p.x), Math.abs(p.y));
  }
  assert.ok(widest > 0.85, `the product fills the view (${widest.toFixed(2)})`);
  assert.ok(camera.position.y > f.center.y && camera.position.x > f.center.x && camera.position.z > f.center.z, "from the front, right and above");
  // Each part's box is its own: its outline, drawn from nothing yet, doesn't stretch it to the part's origin.
  gltf.scene.updateMatrixWorld(true);
  for (const [id, part] of parts) {
    const own = part.mesh.geometry.boundingBox!.clone().applyMatrix4(part.mesh.matrixWorld);
    const box = new THREE.Box3().setFromObject(part.mesh);
    assert.ok(box.min.distanceTo(own.min) < 1e-9 && box.max.distanceTo(own.max) < 1e-9, `${id}: its box is its own`);
  }
  // Fit swings the camera round what it looks at, never through it: framing the product from the other side, the
  // camera keeps at least the nearer of its two distances from it, and ends where it is asked to.
  const from = new THREE.Vector3(0, 0, 0.5), to = new THREE.Vector3(0.01, 0.02, -0.3), aim0 = new THREE.Vector3(), aim1 = new THREE.Vector3(0.01, 0.02, 0);
  for (let i = 0; i <= 20; i++) {
    const e = i / 20, p = between(t, from, aim0, to, aim1, e);
    assert.ok(p.position.distanceTo(p.target) >= 0.3 - 1e-9, `at ${e}, ${p.position.distanceTo(p.target).toFixed(3)} from what it looks at`);
    assert.ok(p.target.distanceTo(new THREE.Vector3().lerpVectors(aim0, aim1, e)) < 1e-12);
  }
  assert.ok(between(t, from, aim0, to, aim1, 0).position.distanceTo(from) < 1e-9 && between(t, from, aim0, to, aim1, 1).position.distanceTo(to) < 1e-9);
  // Round the short way: from 170 degrees to -170, through 180.
  const deg = (d: number) => new THREE.Vector3(Math.sin((d * Math.PI) / 180), 0, Math.cos((d * Math.PI) / 180));
  assert.ok(between(t, deg(170), aim0, deg(-170), aim0, 0.5).position.distanceTo(deg(180)) < 1e-9, "the short way round");
  // From the product's back to its front, the camera keeps its height and goes round, never over the top.
  const back = new THREE.Vector3(-1, 0.8, -1), front = new THREE.Vector3(1, 0.8, 1);
  for (let i = 0; i <= 20; i++) {
    const p = between(t, back, aim0, front, aim0, i / 20).position;
    assert.ok(Math.abs(p.y - 0.8) < 1e-9 && Math.abs(Math.hypot(p.x, p.z) - Math.SQRT2) < 1e-9, `at ${i / 20}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  }

  // From above each keycap, the pick in the middle of the view is that keycap; from below the board's middle, the tray.
  const mm = (v: number[]) => new THREE.Vector3(...v).applyMatrix4(gltf.scene.children[0].matrixWorld);
  gltf.scene.updateMatrixWorld(true);
  const aim = (from: number[], at: number[], near?: number) => {
    camera.position.copy(mm(from));
    camera.up.set(0, 0, -1);
    camera.lookAt(mm(at));
    // The planes the view sets wherever the camera is, or a near plane that cuts into the product.
    Object.assign(camera, planesOf(camera.position.distanceTo(f.center), f.radius), near === undefined ? {} : { near });
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return pickAt(t, camera, parts, 0, 0);
  };
  for (const item of view.items.filter((i) => i.line === "cap")) {
    const [x0, y0, , x1, y1, z1] = item.bbox!;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    assert.equal(aim([cx, cy, z1 + 100], [cx, cy, 0]), item.id);
  }
  assert.equal(aim([0, 0, -100], [0, 0, 0]), "bot");
  assert.equal(aim([200, 200, 100], [400, 400, 100]), null, "looking away from it, nothing");
  // The planes hold the product from close in to far out; a part the near plane cuts away is not picked.
  for (const d of [0.05, 0.3, 1, 4, 10]) {
    const { near, far } = planesOf(d * f.distance, f.radius);
    assert.ok(near > 0 && near <= Math.max(d * f.distance - f.radius, f.radius / 1000) && far >= d * f.distance + f.radius, `at ${d} × the frame's distance`);
  }
  const c5 = view.items.find((i) => i.id === "cap5")!.bbox!;
  const over5 = [(c5[0] + c5[3]) / 2, (c5[1] + c5[4]) / 2];
  assert.equal(aim([over5[0], over5[1], c5[5] + 100], [over5[0], over5[1], 0]), "cap5");
  const cutAway = aim([over5[0], over5[1], c5[5] + 100], [over5[0], over5[1], 0], (100 + (c5[5] - c5[2]) + 0.5) / 1000);
  assert.ok(cutAway && cutAway !== "cap5", `behind the near plane, cap5 is not picked (${cutAway})`);

  // Each part draws its outline from where the camera is: a box's is its creases, so none of its own; a rounded
  // part's, where its faces turn from the camera; seen from elsewhere, another outline.
  gltf.scene.updateMatrixWorld(true);
  assert.equal(outline(t, cap, f.position), 0, "a box's outline is its creases");
  const ponder = modelView(copyOf("ponder", "three-ponder"))!;
  const pglb = readFileSync(join(EXAMPLES, "ponder", ponder.model.file));
  const pg = await new t.GLTFLoader().parseAsync(pglb.buffer.slice(pglb.byteOffset, pglb.byteOffset + pglb.byteLength), "");
  const pparts = prepare(t, pg.scene, COLORS, new Set(ponder.items.map((i) => i.id)));
  pg.scene.updateMatrixWorld(true);
  const shell = pparts.get("head-upper")!;
  const pf = frameOf(t, pg.scene, 4 / 3);
  const drawn = outline(t, shell, pf.position);
  assert.ok(drawn > 20, `the shell's rounded outline (${drawn} edges)`);
  assert.equal(shell.outline!.line.geometry.drawRange.count, 2 * drawn);
  assert.equal(shell.outline!.line.material, shell.edges.material, "it lights with its creases");
  const below = pf.center.clone().add(new THREE.Vector3(0, -3 * pf.radius, 0.01));
  const fromBelow = outline(t, shell, below);
  assert.ok(fromBelow > 0, "from below, it has an outline too");
  const first = Array.from(shell.outline!.line.geometry.attributes.position.array.slice(0, 6 * fromBelow));
  outline(t, shell, pf.position);
  assert.notDeepEqual(Array.from(shell.outline!.line.geometry.attributes.position.array.slice(0, 6 * fromBelow)), first, "another outline");
  // An envelope's outline is dashed: each segment measured.
  const env = [...pparts.values()].find((p) => p.kind === "envelope" && p.outline && outline(t, p, pf.position) > 0)!;
  assert.ok(env, "a rounded envelope draws an outline");
  const ld = env.outline!.line.geometry.attributes.lineDistance;
  assert.ok(ld && ld.array[1] > 0, "its outline's dashes are measured");
  // The gooseneck, drawn along its path, is dotted, its creases and its outline, with an envelope's tones; and a pick
  // from over the top of its bend finds it.
  const arm = pparts.get("arm")!;
  assert.equal(arm.kind, "path");
  assert.ok(arm.edges.material.isLineDashedMaterial && arm.edges.material.dashSize < arm.edges.material.gapSize, "dotted");
  assert.ok(arm.edges.geometry.attributes.lineDistance.count === arm.edges.geometry.attributes.position.count, "its dots are measured");
  assert.ok(outline(t, arm, pf.position) > 0, "a tube draws its outline");
  assert.ok(arm.outline!.line.geometry.attributes.lineDistance.array[1] > 0, "and its outline's dots are measured");
  look(t, arm, "rest", COLORS);
  assert.deepEqual([arm.edges.material.color.getHexString(), arm.mesh.material.color.getHexString()], ["6a6a6a", "131313"]);
  const ab = ponder.items.find((i) => i.id === "arm")!.bbox!;
  const pmm = (v: number[]) => new THREE.Vector3(...v).applyMatrix4(pg.scene.children[0].matrixWorld);
  const pcam = new THREE.PerspectiveCamera(30, 4 / 3, 0.001, 10);
  pcam.position.copy(pmm([(ab[0] + ab[3]) / 2, ab[4] - 60, ab[5] + 100]));
  pcam.up.set(0, 0, -1);
  pcam.lookAt(pmm([(ab[0] + ab[3]) / 2, ab[4] - 60, 0]));
  Object.assign(pcam, planesOf(pcam.position.distanceTo(pf.center), pf.radius));
  pcam.updateProjectionMatrix();
  pcam.updateMatrixWorld();
  assert.equal(pickAt(t, pcam, pparts, 0, 0), "arm", "from over the bend, the gooseneck");

  // A node GLTFLoader renames (it drops '.' and turns spaces to '_', and a clash with the product's own node gets
  // '_1') is still its item's, by the name the GLB gives it.
  const again = await new t.GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
  const m5 = again.scene.getObjectByName("cap5")!;
  Object.assign(m5, { name: "cap_5a" });
  m5.userData.name = "cap 5.a";
  const renamed = prepare(t, again.scene, COLORS, new Set([...view.items.map((i) => i.id), "cap 5.a"]));
  assert.ok(renamed.has("cap 5.a") && !renamed.has("cap_5a"));
  again.scene.updateMatrixWorld(true);
  camera.position.copy(new THREE.Vector3(over5[0], over5[1], c5[5] + 100).applyMatrix4(again.scene.children[0].matrixWorld));
  camera.lookAt(new THREE.Vector3(over5[0], over5[1], 0).applyMatrix4(again.scene.children[0].matrixWorld));
  Object.assign(camera, planesOf(camera.position.distanceTo(f.center), f.radius));
  camera.updateProjectionMatrix();
  assert.equal(pickAt(t, camera, renamed, 0, 0), "cap 5.a");
  // A part the list shows but the model hides is not picked.
  parts.get("cap5")!.mesh.visible = false;
  const five = view.items.find((i) => i.id === "cap5")!.bbox!;
  assert.equal(aim([(five[0] + five[3]) / 2, (five[1] + five[4]) / 2, 100], [(five[0] + five[3]) / 2, (five[1] + five[4]) / 2, 0]), "sw5");
});

// ---- the view in Chromium --------------------------------------------------------------------------------------------

/** What these tests use of Playwright, which the repo does not depend on: it is used where it is installed. */
type Box = { x: number; y: number; width: number; height: number };
type Tab = {
  on(event: "console", fn: (m: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", fn: (e: Error) => void): void;
  goto(url: string): Promise<unknown>;
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  waitForFunction(fn: () => unknown, arg?: null, opts?: { timeout?: number; polling?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  textContent(selector: string): Promise<string | null>;
  inputValue(selector: string): Promise<string>;
  isVisible(selector: string): Promise<boolean>;
  click(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  $$eval<R>(selector: string, fn: (els: Element[]) => R): Promise<R>;
  emulateMedia(media: { reducedMotion?: "reduce" | "no-preference"; forcedColors?: "active" | "none" }): Promise<void>;
  screenshot(opts: { clip: Box }): Promise<Buffer>;
  locator(selector: string): { screenshot(): Promise<Buffer>; boundingBox(): Promise<Box | null> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number, opts?: { steps: number }): Promise<void>;
    down(opts?: { button: "left" | "right" }): Promise<void>; up(opts?: { button: "left" | "right" }): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
  close(): Promise<void>;
};
type Context = { newPage(): Promise<Tab>; addInitScript(fn: () => void): Promise<void>; close(): Promise<void>;
  newCDPSession(tab: Tab): Promise<{ send(method: string, params: object): Promise<unknown> }> };
type Browser = { newContext(opts: { viewport: { width: number; height: number }; hasTouch?: boolean }): Promise<Context>; close(): Promise<void> };
/** What the page has of the view. */
type W = { view3dReady: { ok: boolean; why?: string }; view3d: { pinned: string | null; hover: string | null; fit(): void;
  select(id: string | null): void; screenOf(id: string): { x: number; y: number } | null; destroy(): void } };

/** Playwright's Chromium with WebGL drawn by SwiftShader, or why there is none here. */
async function chromium(): Promise<{ browser?: Browser; why?: string }> {
  let pw: { chromium: { launch(opts: { args: string[] }): Promise<Browser> } };
  try {
    pw = createRequire(import.meta.url)("playwright");
  } catch {
    return { why: "Playwright couldn't be resolved: set NODE_PATH to a node_modules that has it" };
  }
  try {
    return { browser: await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }) };
  } catch (e) {
    return { why: `Chromium did not start (${(e as Error).message.split("\n")[0]})` };
  }
}

/** A page that mounts the view named `name`, with three from the vendored folder by an import map, in a page taller
 * than the window, so it can scroll. */
function page(name: string, light: boolean) {
  const css = k.ISO_CSS + readFileSync(join(SKILL, "viewer", "figure.css"), "utf8") + readFileSync(join(SKILL, "viewer", "model.css"), "utf8");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css} body{margin:0} main{width:720px;margin:0 auto;padding-bottom:150vh}</style>
<script type="importmap">{"imports":{"three":"/three/three.module.js","three/core":"/three/three.core.js","three/addons/":"/three/addons/"}}</script>
</head><body class="iso" data-theme="${light ? "light" : "dark"}"><main><section data-a2-figure><span data-readout>assembled</span><div id="m"></div></section></main>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountModel } from "/model.js";
const [view, glb] = await Promise.all([fetch("/${name}/view.json").then((r) => r.json()), fetch("/${name}/system.glb").then((r) => r.arrayBuffer())]);
window.view3d = mountModel(document.getElementById("m"), view, glb, { THREE, OrbitControls, GLTFLoader }, { fileHref: (p) => "/file/" + p });
window.view3d.ready.then((r) => { window.view3dReady = r; });
</script></body></html>`;
}

/** The model k times as big: its root node's matrix scaled, so a test can show a product of any size. */
function scaled(glb: Buffer, k: number): Buffer {
  const n = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + n).toString());
  const root = gltf.nodes[gltf.scenes[gltf.scene ?? 0].nodes[0]];
  root.matrix = root.matrix.map((x: number, i: number) => (i % 4 === 3 ? x : x * k));
  const json = Buffer.from(JSON.stringify(gltf).padEnd(Math.ceil(JSON.stringify(gltf).length / 4) * 4, " "));
  const rest = glb.subarray(20 + n);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); // glTF
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16); // JSON
  return Buffer.concat([head, json, rest]);
}

/** Serves each view by its name: /name (?light for the light theme), /name/view.json and /name/system.glb. */
function serve(views: Record<string, { view: ModelView; glb: Buffer }>): Promise<Server> {
  const types: Record<string, string> = { js: "text/javascript", json: "application/json", glb: "model/gltf-binary", html: "text/html" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const send = (body: string | Buffer, type: string) => { res.writeHead(200, { "content-type": type }); res.end(body); };
    const [, name, file] = path.split("/");
    if (path === "/model.js") return send(readFileSync(join(SKILL, "viewer", "model.js")), types.js);
    if (path.startsWith("/three/") && !path.includes("..")) return send(readFileSync(join(THREE_DIR, path.slice("/three/".length))), types.js);
    const v = Object.hasOwn(views, name) ? views[name] : undefined;
    if (v && !file) return send(page(name, url.searchParams.has("light")), types.html);
    if (v && file === "view.json") return send(JSON.stringify(v.view), types.json);
    if (v && file === "system.glb") return send(v.glb, types.glb);
    res.writeHead(404);
    res.end();
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

test("in Chromium: the view draws, picks, frames, zooms and recolours; its panel and legend say what the data says; and with no 3D it says so", async (t) => {
  const keypad = current(modelView(copyOf("macropad", "browser"))!);
  const ponder = modelView(copyOf("ponder", "browser-ponder"))!;
  const kglb = readFileSync(join(EXAMPLES, "macropad", keypad.model.file)), pglb = readFileSync(join(EXAMPLES, "ponder", ponder.model.file));
  const risk = { gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "cap5 is 0.15 mm from top (accepted: a test)", parts: ["cap5", "top"], at: null, accepted: true, pose: null };
  const views = {
    keypad: { view: keypad, glb: kglb },
    ponder: { view: ponder, glb: pglb },
    stale: { view: variant(keypad, (v) => { v.model.inputs = "0".repeat(64); }), glb: kglb },
    risk: { view: variant(keypad, (v) => { v.problems.push(risk); }), glb: kglb },
    broken: { view: keypad, glb: kglb.subarray(0, 4000) },
    giant: { view: keypad, glb: scaled(kglb, 1000) },
    tiny: { view: keypad, glb: scaled(kglb, 0.001) },
    notes: { view: variant(keypad, (v) => {
      Object.assign(v.gates.find((g) => g.id === "overlap")!, { status: "fail", problems: 1, listed: 1, ran: false });
      Object.assign(v.gates.find((g) => g.id === "clearance")!, { status: "fail", problems: 250, listed: 200 });
      Object.assign(v, { ok: false, selfTest: { ok: false, missed: ["clearance: a pair moved 0.1 mm closer"], untested: [] } });
    }), glb: kglb },
  };
  // SPRUE_BROWSER_TESTS=1: a run that must test the view in Chromium fails where it can't, rather than skipping it.
  const must = process.env.SPRUE_BROWSER_TESTS === "1";
  const { browser, why } = await chromium();
  if (!browser) return must ? assert.fail(why) : t.skip(why);
  let server: Server | undefined;
  try {
    server = await serve(views);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const probeContext = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const gl = await (await probeContext.newPage()).evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    await probeContext.close();
    if (!gl && must) assert.fail("this Chromium has no WebGL 2");
    // Without WebGL 2 here, only what the view does without it is tested.
    const needsGL = { skip: gl ? false : "this Chromium has no WebGL 2" };

    /** A tab on a view, once it is ready, with what its console says of errors. */
    const open = async (context: Context, name: string, light = false) => {
      const tab = await context.newPage();
      const said: string[] = [];
      tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") said.push(`${m.type()}: ${m.text()}`); });
      tab.on("pageerror", (e) => said.push(`pageerror: ${e.message}`));
      await tab.goto(`${base}/${name}${light ? "?light" : ""}`);
      await tab.waitForFunction(() => (window as unknown as { view3dReady?: unknown }).view3dReady, null, { timeout: 30000 });
      // The model fades in once it is ready: wait for it to be all there.
      await tab.waitForFunction(() => getComputedStyle(document.querySelector(".a2-model-canvas")!).opacity === "1");
      return { tab, said };
    };
    const frames = (tab: Tab) => tab.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const screenOf = (tab: Tab, id: string) => tab.evaluate((id) => (window as unknown as W).view3d.screenOf(id), id);
    /** Waits for the camera to come to rest (damping, a tween), and says where cap5 is then: cap5 and a corner keycap,
     * which moves too when the camera turns about the middle. */
    const settle = async (tab: Tab) => {
      const at = async () => [await screenOf(tab, "cap5"), await screenOf(tab, "cap1")];
      let last = await at();
      for (let i = 0; i < 100; i++) {
        await frames(tab);
        const now = await at();
        if (now.every((p, j) => p && last[j] && Math.hypot(p.x - last[j]!.x, p.y - last[j]!.y) < 0.05)) return now[0]!;
        last = now;
      }
      throw new Error("the camera never came to rest");
    };
    const spread = async (tab: Tab) => {
      const [a, b] = [(await screenOf(tab, "cap1"))!, (await screenOf(tab, "cap9"))!];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    /** Two PNGs read in the page: whether they are one size, the share of the first's pixels that differ from the
     * second's, and the share of the first's that are ink (no channel above 100). */
    const pixels = (tab: Tab, a: Buffer, b: Buffer = a) => tab.evaluate(async ([a, b]) => {
      const px = async (png: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        c.drawImage(bmp, 0, 0);
        return c.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const [x, y] = await Promise.all([px(a), px(b)]);
      let differ = 0, ink = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 6) differ++;
        if (Math.max(x[i], x[i + 1], x[i + 2]) < 100) ink++;
      }
      return { size: x.length === y.length, differ: differ / (x.length / 4), ink: ink / (x.length / 4) };
    }, [a.toString("base64"), b.toString("base64")]);
    const picture = (tab: Tab) => tab.locator(".a2-model-stage").screenshot();
    /** The share of the stage's pixels the model draws: those that change when the canvas is hidden. */
    const drawn = async (tab: Tab) => {
      const shown = await picture(tab);
      await tab.evaluate(() => { document.querySelector<HTMLElement>(".a2-model-canvas")!.style.visibility = "hidden"; });
      const hidden = await picture(tab);
      await tab.evaluate(() => { document.querySelector<HTMLElement>(".a2-model-canvas")!.style.visibility = ""; });
      return (await pixels(tab, shown, hidden)).differ;
    };
    /** How light the page is at a point, 0 to 1. */
    const lightAt = async (tab: Tab, p: { x: number; y: number }) => {
      const png = await tab.screenshot({ clip: { x: p.x - 1, y: p.y - 1, width: 3, height: 3 } });
      return tab.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        c.drawImage(bmp, 0, 0);
        const [r, g, b] = c.getImageData(1, 1, 1, 1).data;
        return (r + g + b) / 765;
      }, png.toString("base64"));
    };
    const focused = (tab: Tab) => tab.evaluate(() => document.activeElement?.className ?? "");
    /** The frames the page has asked for, and how many it is waiting on (its frames counted by an init script). */
    type Frames = { asked: number; pending: number };
    const countFrames = () => {
      const w = window as unknown as Frames;
      w.asked = 0;
      w.pending = 0;
      const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
      const waiting = new Set<number>();
      window.requestAnimationFrame = (fn) => {
        w.asked++;
        w.pending++;
        const id = raf((t) => { waiting.delete(id); w.pending--; fn(t); });
        waiting.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => { if (waiting.delete(id)) w.pending--; cancel(id); };
    };
    /** Waits until the page waits on no frame (however slowly frames come), then says how many it asks for in the
     * half second after. */
    const asks = async (tab: Tab) => {
      await tab.waitForFunction(() => (window as unknown as Frames).pending === 0, null, { timeout: 60000, polling: 50 });
      const before = await tab.evaluate(() => (window as unknown as Frames).asked);
      await tab.waitForTimeout(500);
      return (await tab.evaluate(() => (window as unknown as Frames).asked)) - before;
    };
    /** A few pixels of the page around a point, as a PNG. */
    const around = (tab: Tab, p: { x: number; y: number }) => tab.screenshot({ clip: { x: Math.round(p.x) - 8, y: Math.round(p.y) - 2, width: 16, height: 12 } });

    await t.test("the keypad: it draws, hover lights and the readout keeps a pinned part, clicks pin and unpin", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      await context.addInitScript(countFrames);
      const { tab, said } = await open(context, "keypad");
      assert.deepEqual(await tab.evaluate(() => (window as unknown as W).view3dReady), { ok: true });
      assert.equal(await tab.getAttribute("#m", "data-state"), "ready");
      assert.equal(await tab.isVisible(".a2-model-note"), false, "a model of this run has no note");
      const share = await drawn(tab);
      assert.ok(share > 0.02, `the model is drawn on the stage (${(share * 100).toFixed(1)}% of it)`);
      const legend = (await tab.textContent(".a2-model-legend"))!;
      for (const text of ["3 drawn from their own CAD", "41 envelopes", "at the sizes their datasheets or estimates give", "one may be only the end the product holds, a cable's plug"])
        assert.ok(legend.includes(text), text);
      assert.ok(!legend.includes("Not in the model"));

      const readout = () => tab.textContent("[data-readout]");
      const pinned = () => tab.evaluate(() => (window as unknown as W).view3d.pinned);
      const box = (await tab.locator(".a2-model-stage").boundingBox())!;
      const corner = { x: box.x + 6, y: box.y + 6 };
      // Hover lights a part and the readout says it (a keycap of the front row: the back row's tops are behind it).
      const c9 = (await screenOf(tab, "cap9"))!;
      const unlit = await around(tab, { x: c9.x, y: c9.y + 4 });
      await tab.mouse.move(c9.x, c9.y + 4);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), "cap9");
      assert.equal(await readout(), "Keycap 9 of 9 · bought · envelope");
      const lit = await pixels(tab, await around(tab, { x: c9.x, y: c9.y + 4 }), unlit);
      assert.ok(lit.differ > 0.3, `it lights (${(lit.differ * 100).toFixed(0)}% of its pixels change)`);
      // Where screenOf says each part is, the pointer is over that part: a corner keycap's place is its own.
      for (const id of ["cap1", "cap3", "cap7"]) {
        const c = (await screenOf(tab, id))!;
        await tab.mouse.move(c.x, c.y + 4);
        await frames(tab);
        assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), id);
      }
      await tab.mouse.move(corner.x, corner.y);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), null);
      assert.equal(await readout(), `3D · ${keypad.items.length} parts`);
      // A click pins a part; the pointer over another lights that one, and the readout still says the pinned one.
      const c5 = (await screenOf(tab, "cap5"))!;
      await tab.mouse.click(c5.x, c5.y + 4);
      assert.equal(await pinned(), "cap5");
      assert.equal(await readout(), "Keycap 5 of 9 · bought · envelope");
      assert.equal(await tab.textContent(".a2-model-title"), keypad.lines.cap.name);
      assert.equal(await tab.inputValue(".a2-model-select"), "cap5");
      assert.equal(await tab.isVisible(".a2-model-count"), false, "a part with no problem has no count");
      await tab.mouse.move(c9.x, c9.y + 4);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), "cap9");
      assert.equal(await readout(), "Keycap 5 of 9 · bought · envelope");
      // Clicked again, or on nothing, it unpins.
      await tab.mouse.click(c5.x, c5.y + 4);
      assert.equal(await pinned(), null);
      await tab.mouse.click(c5.x, c5.y + 4);
      assert.equal(await pinned(), "cap5");
      await tab.mouse.click(corner.x, corner.y);
      assert.equal(await pinned(), null);
      // A drag that comes back to where it went down turns the model and pins nothing.
      await tab.mouse.move(c5.x, c5.y + 4);
      await tab.mouse.down();
      await tab.mouse.move(c5.x + 200, c5.y + 4, { steps: 8 });
      await tab.mouse.move(c5.x + 2, c5.y + 4, { steps: 8 });
      await tab.mouse.up();
      assert.equal(await pinned(), null, "a drag is no click");

      // A part it meets is a button that pins that part, and the new panel's title takes the focus; Escape there
      // unpins, and the model takes it.
      await tab.evaluate(() => (window as unknown as W).view3d.select("cap5"));
      await tab.click('.a2-model-panel [data-a2m-pick="sw5"]');
      assert.equal(await pinned(), "sw5");
      assert.equal(await focused(tab), "a2-model-title");
      await tab.keyboard.press("Escape");
      assert.equal(await pinned(), null);
      assert.equal(await focused(tab), "a2-model-stage");
      // With nothing pinned, the panel is of the whole product: the check's verdict, then what a click does.
      assert.equal(await tab.getAttribute(".a2-model-panel", "aria-label"), "The whole product");
      assert.equal(await tab.textContent(".a2-model-panel .a2-model-count"), "It passes all 7 gates.");
      assert.match((await tab.textContent(".a2-model-empty"))!, /^Click a part/);
      // The list pins a part; the panel's files link as the page asks; × unpins, and from the keyboard gives the
      // model the focus; a click leaves it, so the wheel still scrolls the page.
      await tab.selectOption(".a2-model-select", "pcb");
      assert.equal(await pinned(), "pcb");
      assert.equal(await tab.getAttribute(".a2-model-panel", "aria-label"), "The part picked");
      assert.deepEqual(await tab.$$eval(".a2-model-files a", (as) => as.map((a) => a.getAttribute("href"))), keypad.files.pcb.map((f) => `/file/${f.path}`));
      await tab.click('[data-a2m="clear"]');
      assert.equal(await pinned(), null);
      assert.notEqual(await focused(tab), "a2-model-stage");
      await tab.selectOption(".a2-model-select", "pcb");
      await tab.focus('[data-a2m="clear"]');
      await tab.keyboard.press("Enter");
      assert.equal(await pinned(), null);
      assert.equal(await focused(tab), "a2-model-stage");
      // Escape in the panel with the model scrolled out of the window brings it back into view, as little as it takes.
      await tab.evaluate(() => (window as unknown as W).view3d.select("cap5"));
      await tab.evaluate(() => scrollTo(0, document.querySelector(".a2-model-stage")!.getBoundingClientRect().bottom + scrollY + 20));
      await tab.focus('.a2-model-panel [data-a2m-pick="sw5"]');
      await tab.keyboard.press("Escape");
      assert.equal(await focused(tab), "a2-model-stage");
      assert.ok(await tab.evaluate(() => { const r = document.querySelector(".a2-model-stage")!.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }), "the model is in view");
      await tab.evaluate(() => scrollTo(0, 0));
      // In forced colours, its links and its list keep a line a reader can see.
      await tab.evaluate(() => (window as unknown as W).view3d.select("cap5"));
      await tab.emulateMedia({ forcedColors: "active" });
      assert.deepEqual(await tab.evaluate(() => [getComputedStyle(document.querySelector(".a2-model-link")!).textDecorationLine,
        getComputedStyle(document.querySelector(".a2-model-select")!).borderTopStyle]), ["underline", "solid"]);
      await tab.emulateMedia({ forcedColors: "none" });
      await tab.evaluate(() => (window as unknown as W).view3d.select(null));
      // At rest it asks for no frame; a pointer over a part draws it lit, then it asks for none again.
      await tab.mouse.move(corner.x, corner.y);
      assert.equal(await asks(tab), 0, "at rest, nothing draws");
      const was = await tab.evaluate(() => (window as unknown as Frames).asked);
      await tab.mouse.move(c9.x, c9.y + 4);
      assert.equal(await asks(tab), 0, "a hover draws, and then nothing again");
      assert.ok((await tab.evaluate(() => (window as unknown as Frames).asked)) > was, "a hover draws");
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("the keypad: Fit eases back (jumps under reduced motion), keys turn and zoom, the wheel zooms only once the view has focus, the planes hold it near and far, hover follows the camera, and it redraws for a sharper screen", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      // The page's clock moves 1/60 s a frame, however slowly frames come here, so Fit's ease is seen midway.
      await context.addInitScript(() => {
        let frame = 0, last = -1;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => raf((real) => { if (real !== last) { last = real; frame++; } cb((frame * 1000) / 60); });
        performance.now = () => (frame * 1000) / 60;
      });
      const { tab, said } = await open(context, "keypad");
      // Tab gives the model the focus, with a ring a reader can see.
      await tab.keyboard.press("Tab");
      assert.equal(await focused(tab), "a2-model-stage");
      assert.deepEqual(await tab.evaluate(() => { const c = getComputedStyle(document.activeElement!); return [c.outlineStyle, c.outlineWidth]; }), ["solid", "2px"]);
      await tab.evaluate(() => (document.activeElement as HTMLElement).blur());
      const box = (await tab.locator(".a2-model-stage").boundingBox())!;
      const home = (await screenOf(tab, "cap5"))!;
      const away = (p: { x: number; y: number }) => Math.hypot(p.x - home.x, p.y - home.y);
      const drag = async () => {
        await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await tab.mouse.down();
        await tab.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
        await tab.mouse.up();
        return settle(tab);
      };
      assert.ok(away(await drag()) > 20, "the drag turned it");
      // Fit eases: the frame after it is between where the camera was and the product's frame.
      const [before, after] = await tab.evaluate(() => {
        const was = (window as unknown as W).view3d.screenOf("cap5")!;
        (window as unknown as W).view3d.fit();
        return new Promise<[{ x: number; y: number }, { x: number; y: number }]>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done([was, (window as unknown as W).view3d.screenOf("cap5")!]))));
      });
      assert.ok(away(after) > 2 && away(after) < away(before), `it eases, not jumps (${away(before).toFixed(1)} px, then ${away(after).toFixed(1)})`);
      assert.ok(away(await settle(tab)) < 1, "back in its frame");
      await drag();
      await tab.click('[data-a2m="fit"]');
      assert.ok(away(await settle(tab)) < 1, "the Fit button");
      await drag();
      await tab.focus(".a2-model-stage");
      await tab.keyboard.press("f");
      assert.ok(away(await settle(tab)) < 1, "F fits too");
      // Turned to face its back, Fit swings the camera round it, keeping its distance, rather than through it: the
      // keycaps never look much bigger than framed on the way.
      const framed = await spread(tab);
      for (let i = 0; i < 12; i++) await tab.keyboard.press("ArrowLeft");
      await settle(tab);
      // Nor over its top, where the picture would turn over in a frame: the line from one keycap to the other turns
      // little from frame to frame (the whole half turn at the ease's fastest is about 20 degrees a frame).
      const [widest, turn] = await tab.evaluate(() => new Promise<[number, number]>((done) => {
        const v = (window as unknown as W).view3d;
        const gap = () => { const a = v.screenOf("cap1"), b = v.screenOf("cap9"); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity; };
        const angle = () => { const a = v.screenOf("cap1")!, b = v.screenOf("cap9")!; return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; };
        let most = 0, n = 0, was = angle(), turned = 0;
        v.fit();
        const step = () => {
          most = Math.max(most, gap());
          const now = angle();
          turned = Math.max(turned, Math.abs((((now - was) % 360) + 540) % 360 - 180));
          was = now;
          if (++n < 40) requestAnimationFrame(step); else done([most, turned]);
        };
        requestAnimationFrame(step);
      }));
      assert.ok(widest < framed * 1.2, `on the way round, the keycaps span at most ${widest.toFixed(0)} px, framed ${framed.toFixed(0)}`);
      assert.ok(turn < 60, `the picture turns at most ${turn.toFixed(1)} degrees in a frame`);
      assert.ok(away(await settle(tab)) < 1, "and it ends framed");
      // The arrow keys turn it; + zooms in and - out.
      await tab.keyboard.press("ArrowLeft");
      assert.ok(away(await settle(tab)) > 5, "an arrow key turns it");
      await tab.keyboard.press("f");
      await settle(tab);
      const s0 = await spread(tab);
      await tab.keyboard.press("+");
      await settle(tab);
      const s1 = await spread(tab);
      assert.ok(s1 > s0 * 1.15, `+ zooms in (${s0.toFixed(0)} px to ${s1.toFixed(0)})`);
      await tab.keyboard.press("-");
      await settle(tab);
      assert.ok(Math.abs((await spread(tab)) - s0) < 1, "- zooms back out");

      // Without focus, the wheel over the model scrolls the page; once the view has focus, it zooms.
      await tab.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.mouse.wheel(0, 300);
      await tab.waitForTimeout(300);
      assert.ok((await tab.evaluate(() => scrollY)) > 100, "the page scrolled");
      assert.ok(Math.abs((await spread(tab)) - s0) < 1, "and the model didn't zoom");
      await tab.evaluate(() => scrollTo(0, 0));
      await tab.focus(".a2-model-stage");
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.mouse.wheel(0, -300);
      const s2 = await settle(tab).then(() => spread(tab));
      assert.equal(await tab.evaluate(() => scrollY), 0, "with focus, the page stays");
      assert.ok(s2 > s0 * 1.1, "and the model zooms");
      // As near as the controls let it and as far: the model is drawn, never cut away by the planes.
      for (let i = 0; i < 40; i++) await tab.mouse.wheel(0, -400);
      await settle(tab);
      assert.ok((await drawn(tab)) > 0.05, "zoomed all the way in, it is drawn");
      for (let i = 0; i < 80; i++) await tab.mouse.wheel(0, 400);
      await settle(tab);
      const far = await drawn(tab);
      assert.ok(far > 0.003, `zoomed all the way out, it is drawn (${(far * 100).toFixed(2)}%)`);
      for (const { id } of keypad.items) assert.ok(await screenOf(tab, id), `${id} is in front of the camera`);
      // Under reduced motion, Fit jumps: the product is framed before the next frame.
      await tab.emulateMedia({ reducedMotion: "reduce" });
      await drag();
      assert.ok(away(await tab.evaluate(() => { (window as unknown as W).view3d.fit(); return (window as unknown as W).view3d.screenOf("cap5")!; })) < 1, "under reduced motion Fit is there at once");
      // Asked mid-drag, before the next frame is drawn, screenOf says where the part is now, not where it was drawn.
      await tab.evaluate(() => addEventListener("pointermove", () => {
        (window as unknown as { asked: unknown }).asked = (window as unknown as W).view3d.screenOf("cap5");
      }));
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.mouse.down();
      await tab.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40);
      const asked = await tab.evaluate(() => (window as unknown as { asked: { x: number; y: number } }).asked);
      await tab.mouse.up();
      const rest = await settle(tab);
      assert.ok(away(rest) > 20, "the drag turned it");
      assert.ok(Math.hypot(asked.x - rest.x, asked.y - rest.y) < 1, `mid-drag, screenOf is where the part is (${asked.x.toFixed(1)}, ${asked.y.toFixed(1)} against ${rest.x.toFixed(1)}, ${rest.y.toFixed(1)})`);
      await tab.emulateMedia({ reducedMotion: "no-preference" });
      // A pointer that stays still while the camera moves under it is over what is under it once the camera stops: a
      // front-row keycap hovered, the wheel zooms out, and the keycap is no longer what the pointer is over.
      await tab.focus(".a2-model-stage");
      await tab.keyboard.press("f");
      await settle(tab);
      const c9 = (await screenOf(tab, "cap9"))!;
      await tab.mouse.move(c9.x, c9.y + 4);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), "cap9");
      for (let i = 0; i < 12; i++) await tab.mouse.wheel(0, 400);
      await settle(tab);
      await frames(tab);
      const hover = await tab.evaluate(() => (window as unknown as W).view3d.hover);
      assert.notEqual(hover, "cap9", "the hover follows the camera");
      assert.equal(await tab.textContent("[data-readout]"), hover ? readoutOf(keypad, hover) : `3D · ${keypad.items.length} parts`);
      // Moved to a sharper screen (a pixel ratio of 2), the view draws at it.
      const cdp = await context.newCDPSession(tab);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 2, mobile: false });
      await tab.waitForFunction(() => { const c = document.querySelector<HTMLCanvasElement>(".a2-model-canvas")!; return Math.abs(c.width - 2 * c.clientWidth) <= 2; }, null, { timeout: 5000 });
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("the keypad: a theme change recolours it; a pinch zooms and pins nothing, whichever finger lifts first; destroy lets everything go", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: true });
      // What the view and three listen to and observe, so a test can see that destroy lets each go.
      await context.addInitScript(() => {
        const ours = () => /\/model\.js|\/three\//.test(new Error().stack ?? "");
        const live = new Map<EventTarget, { type: string; fn: unknown; capture: boolean }[]>();
        const capture = (o: unknown) => (typeof o === "boolean" ? o : !!(o as { capture?: boolean } | undefined)?.capture);
        const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
          if (ours() && fn) {
            const list = live.get(this) ?? [];
            if (!list.some((x) => x.type === type && x.fn === fn && x.capture === capture(o))) list.push({ type, fn, capture: capture(o) });
            live.set(this, list);
          }
          return add.call(this, type, fn, o);
        };
        EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
          const list = live.get(this);
          if (list) live.set(this, list.filter((x) => !(x.type === type && x.fn === fn && x.capture === capture(o))));
          return remove.call(this, type, fn, o);
        };
        const watching = new Set<object>();
        for (const name of ["ResizeObserver", "MutationObserver"] as const) {
          const Base = window[name] as unknown as { new (cb: never): { disconnect(): void } };
          window[name] = class extends Base {
            constructor(cb: never) { super(cb); if (ours()) watching.add(this); }
            disconnect() { watching.delete(this); super.disconnect(); }
          } as never;
        }
        (window as unknown as { listening: () => string[] }).listening = () => [...live].flatMap(([target, list]) =>
          list.map((x) => `${(target as Element).className || (target as { constructor: { name: string } }).constructor.name} ${x.type}`))
          .concat([...watching].map((o) => `an observer (${(o as object).constructor.name})`));
      });
      const { tab, said } = await open(context, "keypad");
      const c5 = (await screenOf(tab, "cap5"))!;
      const face = { x: c5.x, y: c5.y + 6 };
      assert.ok((await lightAt(tab, face)) < 0.35, "a keycap is dark in the dark theme");
      await tab.evaluate(() => document.body.setAttribute("data-theme", "light"));
      await frames(tab);
      assert.ok((await lightAt(tab, face)) > 0.6, "and light in the light theme");
      // Two fingers, the second resting on a keycap while the first moves away from it: the pinch zooms in, and
      // whichever finger lifts first, it pins nothing. (A touchEnd's points are the fingers it lifts.)
      const cdp = await context.newCDPSession(tab);
      const box = (await tab.locator(".a2-model-stage").boundingBox())!;
      const touch = (type: string, points: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      for (const first of ["the moving finger", "the resting finger"]) {
        await tab.evaluate(() => (window as unknown as W).view3d.fit());
        await settle(tab);
        const c = (await screenOf(tab, "cap5"))!;
        const a = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2, id: 1 }, b = { x: c.x, y: c.y + 4, id: 2 };
        const s0 = await spread(tab);
        await touch("touchStart", [a]);
        await touch("touchStart", [a, b]);
        for (let i = 1; i <= 8; i++) await touch("touchMove", [{ ...a, x: a.x - 20 * i }, b]);
        const moved = { ...a, x: a.x - 160 };
        await touch("touchEnd", [first === "the moving finger" ? moved : b]);
        await touch("touchEnd", []);
        await settle(tab);
        assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pinned), null, `a pinch pins nothing, lifting ${first} first`);
        const s1 = await spread(tab);
        assert.ok(s1 > s0 * 1.2, `the pinch zoomed in, lifting ${first} first (${s0.toFixed(0)} px to ${s1.toFixed(0)})`);
      }
      // A tap pins.
      await tab.evaluate(() => (window as unknown as W).view3d.fit());
      const c = (await settle(tab))!;
      await touch("touchStart", [{ x: c.x, y: c.y + 4, id: 3 }]);
      await touch("touchEnd", []);
      await frames(tab);
      const tapped = await tab.evaluate(() => (window as unknown as W).view3d.pinned);
      assert.ok(tapped, "a tap pins a part");
      // destroy: the view's children and state go, the readout says what it said before, the GL context is lost and
      // nothing draws after.
      const listening = () => tab.evaluate(() => (window as unknown as { listening: () => string[] }).listening());
      assert.ok((await listening()).length > 5, "the test sees what it listens to");
      const lost = await tab.evaluate(async () => {
        const canvas = document.querySelector<HTMLCanvasElement>(".a2-model-canvas")!;
        const gl = canvas.getContext("webgl2")!;
        (window as unknown as W).view3d.destroy();
        let asked = 0;
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = (fn) => { asked++; return raf(fn); };
        document.body.setAttribute("data-theme", "dark");
        window.dispatchEvent(new Event("resize"));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
        (window as unknown as W).view3d.select("cap1");
        await new Promise((done) => setTimeout(done, 300));
        window.requestAnimationFrame = raf;
        const m = document.getElementById("m")!;
        return { kids: m.childElementCount, state: m.getAttribute("data-state"), readout: document.querySelector("[data-readout]")!.textContent, lost: gl.isContextLost(), asked };
      });
      assert.deepEqual(lost, { kids: 0, state: null, readout: "assembled", lost: true, asked: 0 });
      assert.deepEqual(await listening(), [], "nothing it listened to or observed is still held");
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("Ponder: the panel with nothing pinned says it fails, a failing part's panel leads with its problems, a case part's long list folds, the legend names the lines not in the model and the gooseneck drawn along its path", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const { tab, said } = await open(context, "ponder", true);
      assert.ok((await drawn(tab)) > 0.02, "Ponder is drawn");
      // Its rounded shells keep their edge: the outlines drawn from the camera are about two fifths of its ink here. And
      // its faces hide what is behind them: without them, every edge behind shows through.
      const { ink } = await pixels(tab, await picture(tab));
      assert.ok(ink > 0.0045 && ink < INK_MAX, `its shells' outlines are drawn and its faces hide the rest (${(ink * 100).toFixed(2)}% of the stage is ink, 0.34% without outlines)`);
      const legend = (await tab.textContent(".a2-model-unplaced"))!;
      for (const u of legendOf(ponder).unplaced) assert.ok(legend.includes(u.name), u.line);
      // The gooseneck is in the model, drawn along its path: a dotted key in the legend, by name, not a line left out.
      assert.deepEqual(await tab.evaluate(() => [...document.querySelectorAll('.a2-model-legend .a2-model-key[data-kind="path"]')].map((e) => getComputedStyle(e).borderTopStyle)), ["dotted"]);
      assert.ok((await tab.textContent(".a2-model-legend"))!.includes("Gooseneck: drawn along the path it takes as built, which no gate checks as a shape"));
      assert.ok(!legend.includes(ponder.lines.arm.name), "the gooseneck is not among the lines not in the model");
      // With nothing pinned, the panel says Ponder fails, each gate that fails with its parts as buttons, then its
      // risks of the whole, which no one part's panel lists.
      const whole = wholeOf(ponder);
      assert.equal(await tab.textContent(".a2-model-panel .a2-model-count"), whole.summary);
      assert.notEqual(await tab.getAttribute(".a2-model-panel .a2-model-count", "data-problems"), null);
      assert.deepEqual(await tab.$$eval(".a2-model-panel .a2-model-problems li", (li) => li.map((x) => [x.hasAttribute("data-accepted"), x.querySelector("b")!.textContent])),
        [[false, "Fails"], [false, "Fails"], ...Array(6).fill([true, "Accepted risk"])]);
      assert.deepEqual(await tab.$$eval(".a2-model-panel [data-failing]", (li) => li.map((x) => [...x.querySelectorAll("[data-a2m-pick]")].map((b) => b.getAttribute("data-a2m-pick")))),
        whole.failing.map((g) => g.parts));
      await tab.click(`.a2-model-panel [data-failing] [data-a2m-pick="${whole.failing[1].parts[0]}"]`);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pinned), whole.failing[1].parts[0], "a failing part's button pins it");
      await tab.selectOption(".a2-model-select", "head-upper");
      const p = panelOf(ponder, "head-upper")!;
      assert.equal(await tab.textContent(".a2-model-count"), "3 problems");
      assert.deepEqual(await tab.$$eval(".a2-model-problems li", (li) => li.map((x) => [x.querySelector("b")!.textContent, x.querySelector(":scope > span:last-of-type")!.textContent,
        x.querySelector("[data-a2m-show]")?.getAttribute("data-a2m-show")])), p.problems.map((x) => ["Problem", x.text, String(x.i)]), "each with a Show for its mark");
      assert.deepEqual(await tab.$$eval(".a2-model-panel > *", (els) => els.map((e) => e.className || e.tagName)).then((c) => c.slice(0, 3)),
        ["a2-model-head", "a2-model-block", "a2-model-facts"], "its problems come straight after its name");
      // The shell is meant to hold dozens of parts: the first few, and the rest behind a button.
      const holds = p.meets.find((m) => m.kind === "holds")!;
      assert.ok(holds.with.length > 12);
      const shown = () => tab.$$eval(".a2-model-meets li", (li) => li.find((x) => x.querySelector("b")!.textContent === "Meant to hold")!.querySelectorAll("[data-a2m-pick]").length);
      assert.equal(await shown(), 10);
      await tab.click('[data-a2m="more"]');
      assert.equal(await shown(), holds.with.length);
      assert.equal(await tab.evaluate(() => document.activeElement!.getAttribute("data-a2m-pick")), holds.with[10]);
      // The gooseneck pins from the list like any part, and its panel says no gate checks it as a shape.
      await tab.selectOption(".a2-model-select", "arm");
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pinned), "arm");
      assert.ok((await tab.textContent(".a2-model-facts"))!.includes(`Drawnalong a path, which no gate checks as a shape: ${ponder.items.find((i) => i.id === "arm")!.why}`));
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("a product a thousand times as big, or as small, is drawn as the keypad is, near and far, picked, and panned, then still", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const { tab: keypadTab } = await open(context, "keypad");
      const keypadPicture = await picture(keypadTab);
      await keypadTab.close();
      for (const name of ["giant", "tiny"]) {
        const { tab, said } = await open(context, name);
        const same = await pixels(tab, await picture(tab), keypadPicture);
        assert.ok(same.size && same.differ < 0.001, `${name}: framed, lit and drawn as the keypad is (${(same.differ * 100).toFixed(2)}% of pixels differ)`);
        const c5 = (await screenOf(tab, "cap5"))!;
        await tab.mouse.click(c5.x, c5.y + 4);
        assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pinned), "cap5", `${name}: a click pins the part under it`);
        await tab.focus(".a2-model-stage");
        await tab.keyboard.press("Escape");
        // A right-drag pans it, however small its moves in the scene's units are, and is drawn as it goes; then it
        // is still, though the pointer moves over it.
        const box = (await tab.locator(".a2-model-stage").boundingBox())!;
        await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await frames(tab); // the part under the pointer lit
        const before = await picture(tab);
        await tab.mouse.down({ button: "right" });
        await tab.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
        await frames(tab);
        const midway = await pixels(tab, await picture(tab), before);
        assert.ok(midway.differ > 0.01, `${name}: mid-drag, the pan is drawn (${(midway.differ * 100).toFixed(1)}% of pixels change)`);
        await tab.mouse.up({ button: "right" });
        const at = await settle(tab);
        const panned = await pixels(tab, await picture(tab), before);
        assert.ok(panned.differ > 0.01, `${name}: a pan moves it (${(panned.differ * 100).toFixed(1)}% of pixels change)`);
        for (const [dx, dy] of [[-150, 40], [120, -60], [0, 0]]) {
          await tab.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 3 });
          await frames(tab);
        }
        const still = (await screenOf(tab, "cap5"))!;
        assert.ok(Math.hypot(still.x - at.x, still.y - at.y) < 0.01, `${name}: still once it stops, though hover draws it again`);
        await tab.keyboard.press("f");
        await settle(tab);
        const fitted = await picture(tab);
        for (let i = 0; i < 30; i++) await tab.keyboard.press("+");
        await settle(tab);
        assert.ok((await pixels(tab, await picture(tab), fitted)).differ > 0.05, `${name}: + zooms it in, and it is drawn so`);
        assert.ok((await drawn(tab)) > 0.05, `${name}: zoomed all the way in, it is drawn`);
        for (let i = 0; i < 60; i++) await tab.keyboard.press("-");
        await settle(tab);
        assert.ok((await drawn(tab)) > 0.003, `${name}: zoomed all the way out, it is drawn`);
        assert.deepEqual(said, [], `${name}: the console stays quiet`);
        await tab.close();
      }
      await context.close();
    });

    await t.test("an accepted risk reads as one; what the check couldn't say is on every panel; a stale model says so, and still does after the GL context comes back", needsGL, async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const { tab: risky } = await open(context, "risk");
      // With nothing pinned, the panel names the parts the risk is on, and each pins its part.
      assert.deepEqual(await risky.$$eval(".a2-model-problems li", (li) => li.map((x) => [x.hasAttribute("data-accepted"), x.querySelector("b")!.textContent,
        [...x.querySelectorAll("[data-a2m-pick]")].map((b) => b.getAttribute("data-a2m-pick"))])), [[true, "Accepts", ["cap5", "top"]]]);
      await risky.click('.a2-model-problems [data-a2m-pick="cap5"]');
      assert.equal(await risky.inputValue(".a2-model-select"), "cap5");
      assert.deepEqual(await risky.$$eval(".a2-model-problems li", (li) => li.map((x) => [x.hasAttribute("data-accepted"), x.querySelector("b")!.textContent])), [[true, "Accepted risk"]]);
      assert.equal(await risky.textContent(".a2-model-count"), "1 accepted risk");
      assert.equal(await risky.getAttribute(".a2-model-count", "data-problems"), null);
      // A gate that couldn't run, one whose list was cut, and a self-test that missed a fault: on the panel with
      // nothing pinned, after the gates that fail, and on a part's.
      const { tab: noted } = await open(context, "notes");
      const rows = () => noted.$$eval(".a2-model-problems li", (li) => li.map((x) => x.querySelector("b")!.textContent));
      assert.deepEqual(await rows(), ["Fails", "Fails", "Not checked", "Not listed", "Not proven"]);
      await noted.selectOption(".a2-model-select", "cap1");
      assert.deepEqual(await rows(), ["Not checked", "Not listed", "Not proven"]);
      assert.equal(await noted.textContent(".a2-model-count"), "3 caveats");
      assert.notEqual(await noted.getAttribute(".a2-model-count", "data-problems"), null);
      const { tab, said } = await open(context, "stale");
      assert.match((await tab.textContent(".a2-model-note"))!, /another run than system\.json/);
      // The extension is the one to give the context back with: a lost context gives none.
      type Lose = { lose?: WEBGL_lose_context };
      await tab.evaluate(() => {
        const lose = document.querySelector<HTMLCanvasElement>(".a2-model-canvas")!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
        (window as unknown as Lose).lose = lose;
        lose.loseContext();
      });
      await tab.waitForFunction(() => /lost its drawing context/.test(document.querySelector(".a2-model-note")!.textContent!), null, { timeout: 5000 });
      await tab.evaluate(() => (window as unknown as Lose).lose!.restoreContext());
      await tab.waitForFunction(() => /another run/.test(document.querySelector(".a2-model-note")!.textContent!), null, { timeout: 5000 });
      assert.equal(await tab.isVisible(".a2-model-note"), true);
      assert.deepEqual(said.filter((x) => !/CONTEXT_LOST|context lost/i.test(x)), []);
      await context.close();
    });

    await t.test("with no WebGL 2, or a model that can't be read, it says so and the list and the panel still work, in their own words", async () => {
      const flat = await browser.newContext({ viewport: { width: 900, height: 900 } });
      await flat.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return /webgl/.test(kind) ? null : (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
        } as typeof get;
      });
      const cases: [Context, string, "no-webgl" | "error"][] = [[flat, "keypad", "no-webgl"]];
      if (gl) cases.push([await browser.newContext({ viewport: { width: 900, height: 900 } }), "broken", "error"]);
      for (const [context, name, state] of cases) {
        const { tab, said } = await open(context, name, true);
        const r = await tab.evaluate(() => (window as unknown as W).view3dReady);
        assert.equal(r.ok, false);
        assert.match(r.why!, state === "no-webgl" ? /WebGL 2/ : /could not be read/);
        assert.equal(await tab.getAttribute("#m", "data-state"), state);
        assert.equal(await tab.isVisible(".a2-model-note"), true);
        assert.equal(await tab.isVisible('[data-a2m="fit"]'), false);
        assert.equal(await tab.textContent(".a2-model-hint"), "pick a part in the list");
        assert.deepEqual([await tab.getAttribute(".a2-model-stage", "role"), await tab.getAttribute(".a2-model-stage", "aria-label")], [null, null]);
        assert.match((await tab.textContent(".a2-model-empty"))!, /^Pick a part in the list/);
        assert.equal(await tab.isVisible(".a2-model-legend"), true);
        // The stage is only as tall as what it says.
        assert.ok(await tab.evaluate(() => document.querySelector(".a2-model-stage")!.getBoundingClientRect().height <=
          document.querySelector(".a2-model-note")!.getBoundingClientRect().height + 2), "no empty stage under the note");
        await tab.selectOption(".a2-model-select", "cap6");
        assert.equal(await tab.textContent("[data-readout]"), "Keycap 6 of 9 · bought · envelope");
        assert.match((await tab.textContent(".a2-model-panel"))!, /Fits\s*Switch 6/);
        await tab.click('.a2-model-panel [data-a2m-pick="sw6"]');
        await tab.focus('[data-a2m="clear"]');
        await tab.keyboard.press("Enter");
        assert.equal(await focused(tab), "a2-model-select", "with no model, the list takes the focus");
        if (state === "error") assert.equal(await tab.evaluate(() => document.querySelector<HTMLCanvasElement>(".a2-model-canvas")!.getContext("webgl2")?.isContextLost() ?? true), true, "its GL context is let go");
        assert.deepEqual(said, [], name);
        await context.close();
      }
    });
  } finally {
    try { await browser.close(); } finally { server?.close(); }
  }
});
