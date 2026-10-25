// The 3D view's data (pipeline/model.ts) and what the view (viewer/model.js) makes of it: modelView reads each example's
// frame, what meets what, each problem with the parts it names and each gate's count, and lists a line's files only when
// they are its own and in the folder; the panel says what a part is, leads with the problems that name it, says what
// the check couldn't put on any part, and never that it passes; a gap, a contact's gap and a part outside its case read
// as the check found them. With the vendored three, each part is readied to draw with its creases and its outline from
// the camera, the camera frames the whole product, the planes hold it near and far, and a pick finds the part drawn
// under the pointer. Then the view itself in Chromium, where Playwright is installed (skipped where it isn't, as in
// CI): it draws, hover lights and a click pins and unpins, the readout keeps a pinned part, a drag or a pinch pins
// nothing, the list and the panel pin parts and keep the focus, Fit eases back (at once under reduced motion), the keys
// turn and zoom, the wheel zooms only once the view has focus, a theme change recolours it, destroy lets go of it all;
// Ponder's failing parts lead with their problems; a stale model says so; and without WebGL 2, or with a model that
// can't be read, it says so and the list and the panel still work. Run with
//   node --test skills/sprue/pipeline/model.test.ts

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
import { fileLink, frameOf, labelOf, legendOf, look, outline, panelOf, partsList, pickAt, planesOf, prepare, readoutOf, wholeOf } from "../viewer/model.js";

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
    for (const l of bom.lines) assert.equal(v.lines[l.id].name, l.name);
    // Every problem a gate lists, and every risk it accepts, with where it is.
    const want = sys.gates.flatMap((g) => [
      ...(g.list ?? []).map((text, i) => ({ gate: g.id, title: g.title, text, parts: g.where![i].parts, at: g.where![i].at, accepted: false })),
      ...(g.flags ?? []).map((text, i) => ({ gate: g.id, title: g.title, text, parts: g.flagsWhere![i].parts, at: g.flagsWhere![i].at, accepted: true })),
    ]);
    assert.deepEqual(v.problems, want, slug);
    // Each gate, with how many problems it has and lists, and whether it ran.
    assert.deepEqual(v.gates, sys.gates.map((g) => ({ id: g.id, title: g.title, status: g.status, problems: g.problems, listed: g.list?.length ?? 0, ran: true })), slug);
    assert.equal(v.bom, true);
  }
  const keypad = modelView(join(tmp, "macropad"))!, ponder = modelView(join(tmp, "ponder"))!;
  assert.equal(keypad.problems.length, 0, "the keypad passes its whole-product check");
  assert.equal(ponder.problems.filter((p) => !p.accepted).length, 10, "Ponder's 6 clearance problems and 4 in the radio's keep-out");
  assert.ok(ponder.problems.some((p) => p.accepted), "Ponder accepts some risks");
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
  assert.equal(readoutOf(unread, "sw1"), "sw1 1 of 9 · line sw · envelope");
  assert.deepEqual(panelOf(unread, "sw1")!.facts.find((f) => f[0] === "In the BOM"), ["In the BOM", "bom.json could not be read (line sw)"]);
  writeFileSync(join(dir, "bom.json"), "{ half a bom");
  assert.equal(modelView(dir)!.bom, false, "nor one that doesn't parse");
});

test("modelView has nothing to show without a frame and its model", () => {
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
  put(sys);
  rmSync(join(dir, "previews", "system.glb"));
  assert.equal(modelView(dir), null, "no previews/system.glb");
  rmSync(join(dir, "system.json"));
  assert.equal(modelView(dir), null, "no system.json");
});

test("the panel says what a part is, what it meets, the problems that name it and its files, and never that it passes", () => {
  const keypad = modelView(copyOf("macropad", "panel-keypad"))!;
  const cap = panelOf(keypad, "cap6")!;
  assert.equal(cap.title, keypad.lines.cap.name);
  assert.equal(cap.sub, "cap6 · 6 of 9 · bought");
  assert.deepEqual(cap.facts[0], ["Drawn", "as an envelope: boxes and cylinders at the sizes its datasheet or an estimate gives, not its maker's model"]);
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
  // A contact at no gap, or the system's, says nothing of one.
  for (const id of keypad.items.map((i) => i.id)) for (const m of panelOf(keypad, id)!.meets) assert.doesNotMatch(m.why, /mm apart/, id);

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
  assert.match(shell.problems[1].text, /^head-upper is 0\.09 mm from ledmute/);
  assert.deepEqual(panelOf(ponder, "scr25-4")!.problems.map((p) => p.text), ["pi-radio: scr25-4 is 8.9 mm away, under 15 mm"]);
  assert.deepEqual(shell.files.map((f) => f.path), ["cad/head-upper.py", "previews/head-upper.svg"]);
  assert.equal(shell.count, "3 problems");
  // What no one part's panel carries is on the panel with nothing pinned: Ponder's risks of the product as a whole.
  const whole = wholeOf(ponder);
  assert.deepEqual(whole.problems.map((p) => [p.gate, p.accepted]), Array(6).fill(["stability", true]));
  assert.deepEqual(whole.notes, []);
  assert.deepEqual(wholeOf(keypad), { problems: [], notes: [] });
});

/** A copy of a view with its data changed, as a system.json the examples don't have would give it. */
const variant = (view: ModelView, change: (v: ModelView) => void) => { const v = structuredClone(view); change(v); return v; };

test("what the panel says of a gap the design allows, a contact's gap, a part outside its case, and problems it can't place", () => {
  const keypad = modelView(copyOf("macropad", "panel-variants"))!;
  // Two gaps: one with a reason the check accepts; one with none, so the check fails the pair, as its problem says.
  const gaps = variant(keypad, (v) => {
    v.relations.gaps = [{ a: "scr1", b: "bot", mm: 0.1, accept: "the head sits in a counterbore", pairs: [["scr1", "bot"]] },
      { a: "scr2", b: "bot", mm: 0.1, accept: "", pairs: [["scr2", "bot"]] }];
    v.problems.push({ gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "scr2 is 0.15 mm from bot", parts: ["scr2", "bot"], at: null, accepted: false });
  });
  assert.deepEqual(panelOf(gaps, "scr1")!.meets.find((m) => m.kind === "gap"),
    { kind: "gap", with: ["bot"], why: "down to 0.1 mm, where the rule for other pairs is 0.2 mm: the head sits in a counterbore" });
  assert.deepEqual(panelOf(gaps, "scr2")!.meets.find((m) => m.kind === "gap"), { kind: "gap", with: ["bot"],
    why: "down to 0.1 mm, where the rule for other pairs is 0.2 mm: the design gives no reason, so it isn't accepted. The check fails it with Tray: see the problem" });
  assert.deepEqual(panelOf(gaps, "scr2")!.problems.map((p) => p.text), ["scr2 is 0.15 mm from bot"]);
  assert.equal(panelOf(gaps, "scr2")!.count, "1 problem");
  // A contact's gap is what their other faces keep.
  const apart = variant(keypad, (v) => { v.relations.contacts![0].gap = 0.5; });
  assert.equal(panelOf(apart, "pcb")!.meets.find((m) => m.kind === "contact")!.why, "the board on the tray's standoffs; elsewhere they keep 0.5 mm apart");
  // The Pico meant to be inside the case, which the check finds sticking out: its row and the case's say so.
  const out = variant(keypad, (v) => {
    v.problems.push({ gate: "inside", title: "The parts meant to be inside the case are inside it", text: "ctrl reaches 2.10 mm outside the case top/bot", parts: ["ctrl"], at: [0, 0, 0], accepted: false });
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
  const notes = ["overlap couldn't run, so it checked no part.", "50 more problems of “Every other pair is at least 0.2 mm apart” aren't listed by part: this part may be among them."];
  assert.deepEqual(panelOf(cut, "cap1")!.notes, notes);
  assert.deepEqual(wholeOf(cut).notes, [notes[0], notes[1].replace(": this part may be among them", "")]);
  // A problem that names only what isn't a part of the frame (a pose) is of no one part.
  const pose = variant(keypad, (v) => { v.problems.push({ gate: "stability", title: "It stands", text: "arm-mass: no mass", parts: ["arm-mass"], at: null, accepted: false }); });
  assert.deepEqual(wholeOf(pose).problems.map((p) => p.text), ["arm-mass: no mass"]);
  // A part of a line the BOM lacks says so.
  const lost = variant(keypad, (v) => { delete v.lines.cap; });
  assert.equal(readoutOf(lost, "cap6"), "cap6 6 of 9 · cap, not in the BOM · envelope");
});

test("the legend counts the parts drawn from CAD and the envelopes and names the lines not in the model; the list has every part once", () => {
  const keypad = modelView(copyOf("macropad", "legend-keypad"))!;
  assert.deepEqual(legendOf(keypad), { cad: 3, envelopes: 41, unplaced: [] });
  const ponder = modelView(copyOf("ponder", "legend-ponder"))!;
  const sys = json<SystemCheck>(join(EXAMPLES, "ponder", "system.json"));
  const legend = legendOf(ponder);
  assert.equal(legend.cad + legend.envelopes, ponder.items.length);
  assert.equal(legend.envelopes, sys.envelopes);
  assert.deepEqual(legend.unplaced.map((u) => u.line), ["arm", "psu", "diode", "r220", "r1k", "harness"]);
  assert.equal(legend.unplaced[0].name, ponder.lines.arm.name);
  assert.equal(legend.unplaced[0].why, sys.relations!.unplaced.arm);
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
  waitForFunction(fn: () => unknown, arg: null, opts: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  textContent(selector: string): Promise<string | null>;
  inputValue(selector: string): Promise<string>;
  isVisible(selector: string): Promise<boolean>;
  click(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  $$eval<R>(selector: string, fn: (els: Element[]) => R): Promise<R>;
  emulateMedia(media: { reducedMotion: "reduce" | "no-preference" }): Promise<void>;
  screenshot(opts: { clip: Box }): Promise<Buffer>;
  locator(selector: string): { screenshot(): Promise<Buffer>; boundingBox(): Promise<Box | null> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number, opts?: { steps: number }): Promise<void>;
    down(): Promise<void>; up(): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
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
    return { why: "Playwright is not installed" };
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
  const keypad = modelView(copyOf("macropad", "browser"))!;
  const ponder = modelView(copyOf("ponder", "browser-ponder"))!;
  const kglb = readFileSync(join(EXAMPLES, "macropad", keypad.model.file)), pglb = readFileSync(join(EXAMPLES, "ponder", ponder.model.file));
  const risk = { gate: "clearance", title: "Every other pair is at least 0.2 mm apart", text: "cap5 is 0.15 mm from top (accepted: a test)", parts: ["cap5", "top"], at: null, accepted: true };
  const views = {
    keypad: { view: keypad, glb: kglb },
    ponder: { view: ponder, glb: pglb },
    stale: { view: variant(keypad, (v) => { v.model.inputs = "0".repeat(64); }), glb: kglb },
    risk: { view: variant(keypad, (v) => { v.problems.push(risk); }), glb: kglb },
    broken: { view: keypad, glb: kglb.subarray(0, 4000) },
    giant: { view: keypad, glb: scaled(kglb, 1000) },
    tiny: { view: keypad, glb: scaled(kglb, 0.001) },
  };
  const { browser, why } = await chromium();
  if (!browser) return t.skip(why);
  let server: Server | undefined;
  try {
    server = await serve(views);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const probe = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
    if (!(await probe.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) return t.skip("this Chromium has no WebGL 2");

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
    /** Waits for the camera to come to rest (damping, a tween), and says where cap5 is then. */
    const settle = async (tab: Tab) => {
      let last = await screenOf(tab, "cap5");
      for (let i = 0; i < 100; i++) {
        await frames(tab);
        const now = await screenOf(tab, "cap5");
        if (last && now && Math.hypot(now.x - last.x, now.y - last.y) < 0.05) return now;
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

    await t.test("the keypad: it draws, hover lights and the readout keeps a pinned part, clicks pin and unpin", async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
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
      await tab.mouse.move(c9.x, c9.y + 4);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.hover), "cap9");
      assert.equal(await readout(), "Keycap 9 of 9 · bought · envelope");
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
      assert.match((await tab.textContent(".a2-model-panel"))!, /^Click a part/);
      // The list pins a part; the panel's files link as the page asks; × unpins and gives the model the focus.
      await tab.selectOption(".a2-model-select", "pcb");
      assert.equal(await pinned(), "pcb");
      assert.deepEqual(await tab.$$eval(".a2-model-files a", (as) => as.map((a) => a.getAttribute("href"))), keypad.files.pcb.map((f) => `/file/${f.path}`));
      await tab.click('[data-a2m="clear"]');
      assert.equal(await pinned(), null);
      assert.equal(await focused(tab), "a2-model-stage");
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("the keypad: Fit eases back (jumps under reduced motion), keys turn and zoom, the wheel zooms only once the view has focus, and the planes hold it near and far", async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      // The page's clock moves 1/60 s a frame, however slowly frames come here, so Fit's ease is seen midway.
      await context.addInitScript(() => {
        let frame = 0, last = -1;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => raf((real) => { if (real !== last) { last = real; frame++; } cb((frame * 1000) / 60); });
        performance.now = () => (frame * 1000) / 60;
      });
      const { tab, said } = await open(context, "keypad");
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
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("the keypad: a theme change recolours it; a pinch pins nothing; destroy lets everything go", async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: true });
      const { tab, said } = await open(context, "keypad");
      const c5 = (await screenOf(tab, "cap5"))!;
      const face = { x: c5.x, y: c5.y + 6 };
      assert.ok((await lightAt(tab, face)) < 0.35, "a keycap is dark in the dark theme");
      await tab.evaluate(() => document.body.setAttribute("data-theme", "light"));
      await frames(tab);
      assert.ok((await lightAt(tab, face)) > 0.6, "and light in the light theme");
      // Two fingers, the second resting on a keycap while the first pinches: the pinch zooms, and lifting the
      // resting finger first pins nothing.
      const cdp = await context.newCDPSession(tab);
      const box = (await tab.locator(".a2-model-stage").boundingBox())!;
      const a = { x: box.x + 40, y: box.y + box.height / 2, id: 1 }, b = { x: c5.x, y: c5.y + 4, id: 2 };
      const touch = (type: string, points: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      await touch("touchStart", [a]);
      await touch("touchStart", [a, b]);
      for (let i = 1; i <= 8; i++) await touch("touchMove", [{ ...a, x: a.x - 6 * i }, b]);
      await touch("touchEnd", [{ ...a, x: a.x - 48 }]);
      await touch("touchEnd", []);
      await frames(tab);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pinned), null, "a pinch pins nothing");
      // A tap pins.
      await touch("touchStart", [b]);
      await touch("touchEnd", []);
      await frames(tab);
      const tapped = await tab.evaluate(() => (window as unknown as W).view3d.pinned);
      assert.ok(tapped, "a tap pins a part");
      // destroy: the view's children and state go, the readout says what it said before, the GL context is lost and
      // nothing draws after.
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
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("Ponder: a failing part's panel leads with its problems, a case part's long list folds, the legend names the lines not in the model", async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const { tab, said } = await open(context, "ponder", true);
      assert.ok((await drawn(tab)) > 0.02, "Ponder is drawn");
      // Its rounded shells keep their edge: the outlines drawn from the camera are about two fifths of its ink here.
      const { ink } = await pixels(tab, await picture(tab));
      assert.ok(ink > 0.0045, `its shells' outlines are drawn (${(ink * 100).toFixed(2)}% of the stage is ink, 0.34% without them)`);
      const legend = (await tab.textContent(".a2-model-unplaced"))!;
      for (const u of legendOf(ponder).unplaced) assert.ok(legend.includes(u.name), u.line);
      // With nothing pinned, the panel lists the check's problems of no one part: Ponder's risks of the whole.
      assert.deepEqual(await tab.$$eval(".a2-model-panel .a2-model-problems li", (li) => li.map((x) => [x.hasAttribute("data-accepted"), x.querySelector("b")!.textContent])),
        Array(6).fill([true, "Accepted risk"]));
      await tab.selectOption(".a2-model-select", "head-upper");
      const p = panelOf(ponder, "head-upper")!;
      assert.equal(await tab.textContent(".a2-model-count"), "3 problems");
      assert.deepEqual(await tab.$$eval(".a2-model-problems li", (li) => li.map((x) => [x.querySelector("b")!.textContent, x.lastElementChild!.textContent])),
        p.problems.map((x) => ["Problem", x.text]));
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
      assert.deepEqual(said, [], "the console stays quiet");
      await context.close();
    });

    await t.test("a product a thousand times as big, or as small, is drawn as the keypad is, near and far, and picked", async () => {
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
        for (let i = 0; i < 30; i++) await tab.keyboard.press("+");
        await settle(tab);
        assert.ok((await drawn(tab)) > 0.05, `${name}: zoomed all the way in, it is drawn`);
        for (let i = 0; i < 60; i++) await tab.keyboard.press("-");
        await settle(tab);
        assert.ok((await drawn(tab)) > 0.003, `${name}: zoomed all the way out, it is drawn`);
        assert.deepEqual(said, [], `${name}: the console stays quiet`);
        await tab.close();
      }
      await context.close();
    });

    await t.test("an accepted risk reads as one; a stale model says so, and still does after the GL context comes back", async () => {
      const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const { tab: risky } = await open(context, "risk");
      await risky.selectOption(".a2-model-select", "cap5");
      assert.deepEqual(await risky.$$eval(".a2-model-problems li", (li) => li.map((x) => [x.hasAttribute("data-accepted"), x.querySelector("b")!.textContent])), [[true, "Accepted risk"]]);
      assert.equal(await risky.textContent(".a2-model-count"), "1 accepted risk");
      assert.equal(await risky.getAttribute(".a2-model-count", "data-problems"), null);
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
      for (const [context, name, state] of [[flat, "keypad", "no-webgl"], [await browser.newContext({ viewport: { width: 900, height: 900 } }), "broken", "error"]] as const) {
        const { tab, said } = await open(context, name, true);
        const r = await tab.evaluate(() => (window as unknown as W).view3dReady);
        assert.equal(r.ok, false);
        assert.match(r.why!, state === "no-webgl" ? /WebGL 2/ : /could not be read/);
        assert.equal(await tab.getAttribute("#m", "data-state"), state);
        assert.equal(await tab.isVisible(".a2-model-note"), true);
        assert.equal(await tab.isVisible('[data-a2m="fit"]'), false);
        assert.equal(await tab.textContent(".a2-model-hint"), "pick a part in the list");
        assert.deepEqual([await tab.getAttribute(".a2-model-stage", "role"), await tab.getAttribute(".a2-model-stage", "aria-label")], [null, null]);
        assert.match((await tab.textContent(".a2-model-panel"))!, /^Pick a part in the list/);
        assert.equal(await tab.isVisible(".a2-model-legend"), true);
        await tab.selectOption(".a2-model-select", "cap6");
        assert.equal(await tab.textContent("[data-readout]"), "Keycap 6 of 9 · bought · envelope");
        assert.match((await tab.textContent(".a2-model-panel"))!, /Fits\s*Switch 6/);
        await tab.click('.a2-model-panel [data-a2m-pick="sw6"]');
        await tab.click('[data-a2m="clear"]');
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
