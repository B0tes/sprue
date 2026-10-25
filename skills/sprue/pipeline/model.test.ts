// The 3D view's data (pipeline/model.ts) and what the view (viewer/model.js) makes of it: modelView reads each example's
// frame, what meets what and each problem with the parts it names, and lists a line's files only when they are in the
// folder; the panel says what a part is and lists only the problems that name it, so a part never reads as passing;
// with the vendored three, each part is readied to draw, the camera frames the whole product and a pick finds the part
// under the pointer. Then the view itself in Chromium, where Playwright is installed (skipped where it isn't, as in
// CI): it draws, a click pins a part and the readout keeps it, the list and the panel pin parts, Fit frames the product
// again (at once under reduced motion), and without WebGL 2 it says so and the list and the panel still work. Run with
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
import { frameOf, labelOf, legendOf, look, panelOf, partsList, pickAt, prepare, readoutOf } from "../viewer/model.js";

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
  assert.deepEqual(paths("pcb"), ["cad/pcb.mjs", "previews/pcb-top.svg", "previews/pcb-bottom.svg"]);
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
  assert.deepEqual(paths("pcb"), ["cad/pcb.mjs", "pcb/macropad-gerbers.zip", "previews/pcb-top.svg", "previews/pcb-bottom.svg"]);
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
  assert.deepEqual(cap.facts[0], ["Drawn", "as an envelope: boxes and cylinders at its datasheet sizes, not its maker's model"]);
  assert.deepEqual(cap.facts.find((f) => f[0] === "Mass"), ["Mass", "2 g, estimate: typical for the part, no published mass"]);
  assert.deepEqual(cap.facts.find((f) => f[0] === "Size"), ["Size", "18.2 × 18.2 × 7.4 mm (x, y, z)"]);
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
  // A contact counted at no gap says nothing of one.
  for (const id of keypad.items.map((i) => i.id)) for (const m of panelOf(keypad, id)!.meets) assert.doesNotMatch(m.why, /within 0 mm/, id);

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
  const aim = (from: number[], at: number[]) => {
    camera.position.copy(mm(from));
    camera.up.set(0, 0, -1);
    camera.lookAt(mm(at));
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
  evaluate<R, A = undefined>(fn: (arg: A) => R, arg?: A): Promise<R>;
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
  locator(selector: string): { screenshot(): Promise<Buffer>; boundingBox(): Promise<Box | null> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number, opts?: { steps: number }): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
};
type Context = { newPage(): Promise<Tab>; addInitScript(fn: () => void): Promise<void>; close(): Promise<void> };
type Browser = { newContext(opts: { viewport: { width: number; height: number } }): Promise<Context>; close(): Promise<void> };

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

/** A page that mounts the view on an example, with three from the vendored folder by an import map. */
function page(view: ModelView, light: boolean) {
  const css = k.ISO_CSS + readFileSync(join(SKILL, "viewer", "figure.css"), "utf8") + readFileSync(join(SKILL, "viewer", "model.css"), "utf8");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css} body{margin:0} main{width:720px;margin:0 auto}</style>
<script type="importmap">{"imports":{"three":"/three/three.module.js","three/core":"/three/three.core.js","three/addons/":"/three/addons/"}}</script>
</head><body class="iso" data-theme="${light ? "light" : "dark"}"><main><section data-a2-figure><span data-readout>assembled</span><div id="m"></div></section></main>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountModel } from "/model.js";
const [view, glb] = await Promise.all([fetch("/view.json").then((r) => r.json()), fetch("/system.glb").then((r) => r.arrayBuffer())]);
window.view3d = mountModel(document.getElementById("m"), view, glb, { THREE, OrbitControls, GLTFLoader }, { fileHref: (p) => "/file/" + p });
window.view3d.ready.then((r) => { window.view3dReady = r; });
</script></body></html>`;
}

function serve(view: ModelView, glbPath: string): Promise<Server> {
  const types: Record<string, string> = { js: "text/javascript", json: "application/json", glb: "model/gltf-binary", html: "text/html" };
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const send = (body: string | Buffer, type: string) => { res.writeHead(200, { "content-type": type }); res.end(body); };
    if (path === "/" || path === "/light") return send(page(view, path === "/light"), types.html);
    if (path === "/model.js") return send(readFileSync(join(SKILL, "viewer", "model.js")), types.js);
    if (path === "/view.json") return send(JSON.stringify(view), types.json);
    if (path === "/system.glb") return send(readFileSync(glbPath), types.glb);
    if (path.startsWith("/three/") && !path.includes("..")) return send(readFileSync(join(THREE_DIR, path.slice("/three/".length))), types.js);
    res.writeHead(404);
    res.end();
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

test("in Chromium: it draws, a click pins a part, the list and the panel pin parts, Fit frames it, and without WebGL it says so", async (t) => {
  const { browser, why } = await chromium();
  if (!browser) return t.skip(why);
  const view = modelView(copyOf("macropad", "browser"))!;
  const server = await serve(view, join(EXAMPLES, "macropad", view.model.file));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    const tab = await context.newPage();
    const said: string[] = [];
    tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") said.push(`${m.type()}: ${m.text()}`); });
    tab.on("pageerror", (e) => said.push(`pageerror: ${e.message}`));
    const webgl = await tab.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    if (!webgl) return t.skip("this Chromium has no WebGL 2");
    await tab.goto(base);
    await tab.waitForFunction(() => (window as unknown as { view3dReady?: unknown }).view3dReady, null, { timeout: 30000 });
    type W = { view3dReady: { ok: boolean }; view3d: { pinned: string | null; screenOf(id: string): { x: number; y: number } | null; select(id: string | null): void } };
    assert.deepEqual(await tab.evaluate(() => (window as unknown as W).view3dReady), { ok: true });
    assert.equal(await tab.getAttribute("#m", "data-state"), "ready");
    // It drew something: the stage is not one colour.
    const shot = await tab.locator(".a2-model-stage").screenshot();
    assert.ok(new Set(Array.from({ length: 400 }, (_, i) => shot[Math.floor((shot.length * i) / 400)])).size > 8, "the stage is blank");

    const screenOf = (id: string) => tab.evaluate((id) => (window as unknown as W).view3d.screenOf(id), id);
    const pinned = () => tab.evaluate(() => (window as unknown as W).view3d.pinned);
    const readout = () => tab.textContent("[data-readout]");
    const at = (await screenOf("cap5"))!;
    await tab.mouse.click(at.x, at.y + 4);
    assert.equal(await pinned(), "cap5");
    assert.equal(await readout(), "Keycap 5 of 9 · bought · envelope");
    assert.equal(await tab.textContent(".a2-model-title"), view.lines.cap.name);
    assert.equal(await tab.inputValue(".a2-model-select"), "cap5");
    // The pointer over another part lights it, and the readout still says the pinned one.
    const other = (await screenOf("cap1"))!;
    await tab.mouse.move(other.x, other.y + 4);
    await tab.waitForTimeout(100);
    assert.equal(await readout(), "Keycap 5 of 9 · bought · envelope");
    // A part it meets is a button that pins that part; Escape unpins.
    await tab.click('.a2-model-panel [data-a2m-pick="sw5"]');
    assert.equal(await pinned(), "sw5");
    await tab.focus(".a2-model-stage");
    await tab.keyboard.press("Escape");
    assert.equal(await pinned(), null);
    assert.equal(await readout(), `3D · ${view.items.length} parts`);
    assert.match((await tab.textContent(".a2-model-panel"))!, /^Click a part/);
    // The list pins a part; the panel's files link as the page asks.
    await tab.selectOption(".a2-model-select", "pcb");
    assert.equal(await pinned(), "pcb");
    assert.deepEqual(await tab.$$eval(".a2-model-files a", (as) => as.map((a) => a.getAttribute("href"))),
      view.files.pcb.map((f) => `/file/${f.path}`));
    await tab.click('[data-a2m="clear"]');
    assert.equal(await pinned(), null);
    // Clicking on nothing pins nothing.
    const box = (await tab.locator(".a2-model-stage").boundingBox())!;
    await tab.mouse.click(box.x + 6, box.y + 6);
    assert.equal(await pinned(), null);

    // Turned by a drag, Fit eases back to the product's frame; F does it too.
    const home = (await screenOf("cap5"))!;
    const drag = async () => {
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.mouse.down();
      await tab.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
      await tab.mouse.up();
      await tab.waitForTimeout(700);
    };
    const away = async () => { const p = (await screenOf("cap5"))!; return Math.hypot(p.x - home.x, p.y - home.y); };
    await drag();
    assert.ok((await away()) > 20, "the drag turned it");
    assert.equal(await pinned(), null, "a drag pins nothing");
    await tab.click('[data-a2m="fit"]');
    await tab.waitForTimeout(80);
    assert.ok((await away()) > 2, "it eases, not jumps");
    await tab.waitForTimeout(900);
    assert.ok((await away()) < 1, "back in its frame");
    await drag();
    await tab.focus(".a2-model-stage");
    await tab.keyboard.press("f");
    await tab.waitForTimeout(900);
    assert.ok((await away()) < 1, "F fits too");
    // The arrow keys turn it.
    await tab.keyboard.press("ArrowLeft");
    await tab.waitForTimeout(700);
    assert.ok((await away()) > 5, "an arrow key turns it");
    // Under reduced motion, Fit jumps.
    await tab.emulateMedia({ reducedMotion: "reduce" });
    await tab.click('[data-a2m="fit"]');
    await tab.waitForTimeout(80);
    assert.ok((await away()) < 1, "under reduced motion Fit is there at once");
    assert.deepEqual(said, [], "the console stays quiet");
    await context.close();

    // Without WebGL 2 it says so, and the list and the panel still work.
    const flat = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    await flat.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return /webgl/.test(kind) ? null : (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof get;
    });
    const bare = await flat.newPage();
    const quiet: string[] = [];
    bare.on("pageerror", (e) => quiet.push(e.message));
    await bare.goto(`${base}/light`);
    await bare.waitForFunction(() => (window as unknown as { view3dReady?: unknown }).view3dReady, null, { timeout: 30000 });
    const r = await bare.evaluate(() => (window as unknown as W).view3dReady) as { ok: boolean; why?: string };
    assert.equal(r.ok, false);
    assert.match(r.why!, /WebGL 2/);
    assert.equal(await bare.getAttribute("#m", "data-state"), "no-webgl");
    assert.equal(await bare.isVisible(".a2-model-note"), true);
    assert.equal(await bare.isVisible('[data-a2m="fit"]'), false);
    await bare.selectOption(".a2-model-select", "cap6");
    assert.equal(await bare.textContent("[data-readout]"), "Keycap 6 of 9 · bought · envelope");
    assert.match((await bare.textContent(".a2-model-panel"))!, /Fits\s*Switch 6/);
    assert.deepEqual(quiet, []);
    await flat.close();
  } finally {
    await browser.close();
    server.close();
  }
});
