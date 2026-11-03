// The 3D view's probes, as pipeline/model.ts reads them from system.json for the view to draw: each function probe's
// kind, whether it meets its need (its accepted reason aside), why the design has it and that reason, where it is in
// the frame, what the gate found, and the problems and accepted risks that are its own, by its id. A row of an earlier
// Sprue has no `ok` and no place; one whose place doesn't read (a point that isn't three numbers, a direction of no
// length, a radius or an angle out of range, a box inside out, a camera whose up isn't square to its axis) has none;
// a row of a kind the view doesn't know, or with no id, is left out. Then viewer/model.js's words for each probe (its
// state, what it found, what is in its way and which parts it names) and its lines: a speaker's or a port's disc and
// rays square to it, a camera's field at its angles out to its target, a light's cone at its half angle, a keep-out's
// box and where the distance it needs ends. Run with
//   node --test skills/sprue/pipeline/model-probe.test.ts

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { modelView, probeWhereOf, type ModelProbe, type ModelView } from "./model.ts";
import type { SystemCheck } from "./types.ts";
import {
  labelOf, partProbesOf, probeBlockersOf, probeCountOf, probeFoundOf, probeReachOf, probeReadoutOf, probeRowsOf, probeShapeOf, probesBoxOf, probeStateOf, probeSummaryOf,
} from "../viewer/model.js";

const EXAMPLES = join(import.meta.dirname, "..", "examples");
const tmp = mkdtempSync(join(tmpdir(), "sprue-probe-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** An example's folder as the repo has it: without fab/ and pcb/, which git ignores, so CI has neither. */
function copyOf(slug: string, name = slug) {
  const dir = join(tmp, name);
  cpSync(join(EXAMPLES, slug), dir, { recursive: true, filter: (src) => !/[/\\](fab|pcb|shots|production)$/.test(src) });
  return dir;
}

const WHERE = ["source", "center", "normal", "radius", "origin", "axis", "up", "hfovDeg", "vfovDeg", "targetBox", "halfAngleDeg", "target", "region"];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("modelView reads each example's probes: where each is, whether it meets its need, why, what it found and its own problems", () => {
  for (const slug of ["macropad", "ponder"]) {
    const dir = copyOf(slug);
    const sys = json<SystemCheck>(join(dir, "system.json"));
    const v = modelView(dir)!;
    // Every row, in the gate's order, read as system.json has it: its place from the keys that say where, its `ok`,
    // `why` and `accept`, and the rest as what it found.
    assert.deepEqual(v.probes.map((p) => p.id), sys.probes.map((r) => r.id), slug);
    for (const [i, p] of v.probes.entries()) {
      const row = sys.probes[i];
      assert.deepEqual([p.kind, p.ok, p.why, p.accept], [row.kind, row.ok, row.why, row.accept], `${slug} ${p.id}`);
      assert.deepEqual(p.where, Object.fromEntries(WHERE.filter((key) => key in row).map((key) => [key, row[key]])), `${slug} ${p.id}`);
      assert.deepEqual(p.found, Object.fromEntries(Object.entries(row).filter(([key]) => !WHERE.includes(key) && !["id", "kind", "ok", "why", "accept"].includes(key))));
      assert.ok(p.why, `${slug} ${p.id}: each probe of the examples says why it is there`);
      // Each problem it has is the function gate's and starts with its id, and every one of those is its own.
      assert.deepEqual(p.problems, v.problems.flatMap((q, k) => (q.gate === "function" && q.text.startsWith(`${p.id}: `) ? [k] : [])));
    }
  }
  const keypad = modelView(join(tmp, "macropad"))!, ponder = modelView(join(tmp, "ponder"))!;
  assert.deepEqual(keypad.probes.map((p) => [p.id, p.kind, p.ok, p.problems]), [["bootsel", "port", true, []], ["led", "light", true, []]]);
  assert.deepEqual(keypad.probes[0].where, { source: "ctrl", center: [19, 30.1, 5.4], normal: [0, 0, 1], radius: 0.5 });
  // Ponder's nine: the speaker's grille, the two mic ports, the camera's view of the page, four lights, and the radio's
  // keep-out, the one that fails, with its four problems: two screws and their inserts too near the Pi's antenna.
  assert.deepEqual(ponder.probes.map((p) => [p.id, p.kind, p.ok]), [
    ["speaker", "sound", true], ["mic1-port", "port", true], ["mic2-port", "port", true], ["camera", "view", true],
    ["pixel1", "light", true], ["pixel8", "light", true], ["ledcam-light", "light", true], ["ledmute-light", "light", true],
    ["pi-radio", "keepout", false]]);
  const radio = ponder.probes.at(-1)!;
  assert.deepEqual(radio.problems.map((k) => [ponder.problems[k].parts, ponder.problems[k].accepted]),
    [[["scr25-4"], false], [["ins25-4"], false], [["scr25-3"], false], [["ins25-3"], false]]);
  assert.deepEqual((radio.found.within as { id: string; mm: number }[]).map((w) => [w.id, Math.round(w.mm * 10) / 10]),
    [["scr25-4", 8.9], ["ins25-4", 9.1], ["scr25-3", 11.3], ["ins25-3", 11.5]]);
  assert.deepEqual([radio.found.need, radio.found.nearest], [15, "scr25-4"]);
  assert.ok(ponder.probes.slice(0, -1).every((p) => p.problems.length === 0), "the rest pass, and accept nothing");
  // The camera looks down at the page, its up square to where it looks, and the page's box is on the desk, under it.
  const cam = ponder.probes.find((p) => p.id === "camera")!.where as { origin: number[]; axis: number[]; up: number[]; targetBox: number[] };
  assert.ok(cam.axis[2] < -0.9, "it looks down");
  assert.ok(Math.abs(dot(cam.axis, cam.up)) < 1e-3);
  assert.ok(cam.targetBox[5] <= 0, "the page is on the desk");
  assert.ok([0, 1].every((k) => cam.targetBox[k] < cam.origin[k] && cam.origin[k] < cam.targetBox[k + 3]), "the page is under the camera");
  // The speaker's grille faces up through the base, and the radio's keep-out is a box of some size in the Pi's.
  assert.deepEqual(ponder.probes[0].where, { source: "spk", center: [-45, -5, 37.5], normal: [0, 0, 1], radius: 17.8 });
  const region = (radio.where as { region: number[] }).region;
  const pi = ponder.items.find((i) => i.id === "pi")!.bbox!;
  assert.ok([0, 1, 2].every((k) => region[k] < region[k + 3]), "a box of some size");
  assert.ok([0, 1, 2].every((k) => region[k] >= pi[k] && region[k + 3] <= pi[k + 3]), "the keep-out is in the Pi's box");
});

test("a probe's problems are its own by its id, accepted or not, and never another's whose id starts the same, even with a colon", () => {
  const dir = copyOf("macropad", "own");
  const sys = json<SystemCheck>(join(dir, "system.json"));
  const at = (x: number) => ({ parts: ["ctrl"], at: [x, 0, 0] });
  // A problem of another gate that starts with a probe's id isn't the probe's.
  const gates = sys.gates.map((g) => (g.id === "function" ? {
    ...g, status: "fail" as const, problems: 5,
    list: ["bootsel: 50% of it sees out, under 95% (blocked by top)", "boot: 0% of it sees out, under 95%", "mic: left: 50% of it sees out, under 95%",
      "mic: 10% of it sees out, under 95%", "boots: it smells"], where: [at(1), at(2), at(5), at(6), at(7)],
    flags: ["led: 40% of its light reaches out, under 50% (blocked by top) (accepted: a test)"], flagsWhere: [at(3)],
  } : g.id === "clearance" ? { ...g, status: "fail" as const, problems: 1, list: ["led: a part named as a probe is"], where: [at(4)] } : g));
  // A probe of a kind the view doesn't know, "boots", is left out, and its problem is no other probe's.
  const probes = [...sys.probes, { ...sys.probes[0], id: "boot" }, { ...sys.probes[0], id: "mic" }, { ...sys.probes[0], id: "mic: left" },
    { ...sys.probes[0], id: "boots", kind: "smell" }];
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, ok: false, gates, probes }));
  const v = modelView(dir)!;
  const own = (id: string) => v.probes.find((p) => p.id === id)!.problems.map((k) => [v.problems[k].text, v.problems[k].accepted]);
  assert.deepEqual(own("bootsel"), [["bootsel: 50% of it sees out, under 95% (blocked by top)", false]]);
  assert.deepEqual(own("boot"), [["boot: 0% of it sees out, under 95%", false]]);
  assert.deepEqual(own("mic"), [["mic: 10% of it sees out, under 95%", false]]);
  assert.deepEqual(own("mic: left"), [["mic: left: 50% of it sees out, under 95%", false]]);
  assert.deepEqual(own("led"), [["led: 40% of its light reaches out, under 50% (blocked by top) (accepted: a test)", true]], "an accepted risk is the probe's too");
  assert.equal(v.probes.some((p) => p.id === "boots"), false);
  assert.ok(v.problems.some((p) => p.text === "boots: it smells"), "its problem is still the view's");
});

test("a probe row of an earlier Sprue has no ok and no place, one of a kind the view doesn't know or with no id is left out, and none is none", () => {
  const dir = copyOf("macropad", "earlier");
  const sys = json<SystemCheck>(join(dir, "system.json"));
  const put = (s: unknown) => writeFileSync(join(dir, "system.json"), JSON.stringify(s));
  // An earlier Sprue wrote what the gate found, and no more.
  put({ ...sys, probes: [{ id: "bootsel", kind: "port", openShare: 1, need: 0.95 }, { id: "led", kind: "light", share: 1, need: 0.5 }] });
  assert.deepEqual(modelView(dir)!.probes, [
    { id: "bootsel", kind: "port", ok: null, why: "", accept: "", problems: [], where: null, found: { openShare: 1, need: 0.95 } },
    { id: "led", kind: "light", ok: null, why: "", accept: "", problems: [], where: null, found: { share: 1, need: 0.5 } }]);
  put({ ...sys, probes: [null, { ...sys.probes[0], kind: "smell" }, { ...sys.probes[0], id: "" }, { ...sys.probes[0], id: 7 }, sys.probes[1]] });
  assert.deepEqual(modelView(dir)!.probes.map((p) => p.id), ["led"]);
  put({ ...sys, probes: undefined });
  assert.deepEqual(modelView(dir)!.probes, []);
  put({ ...sys, probes: { bootsel: sys.probes[0] } });
  assert.deepEqual(modelView(dir)!.probes, []);
});

test("a probe's place reads only when each of its numbers does: three for a point, a direction of some length, a radius and angles in range, a box the right way round, a camera's up square to its axis", () => {
  const port = { kind: "port", source: "ctrl", center: [1, 2, 3], normal: [0, 0, 2], radius: 0.5 };
  const view = { kind: "view", origin: [0, 0, 30], axis: [0, 0, -1], up: [0, 1, 0], hfovDeg: 40, vfovDeg: 30, targetBox: [-30, -5, -2.1, 30, 5, -2] };
  const light = { kind: "light", origin: [0, 0, 3], axis: [0, 0, 1], halfAngleDeg: 20, target: "out" };
  const keepout = { kind: "keepout", region: [12, 9, 2, 14, 11, 4] };
  // As written, each reads, a direction as long as it was given.
  assert.deepEqual(probeWhereOf(port), { source: "ctrl", center: [1, 2, 3], normal: [0, 0, 2], radius: 0.5 });
  assert.deepEqual(probeWhereOf({ ...port, kind: "sound" }), probeWhereOf(port));
  assert.deepEqual(probeWhereOf(view), { origin: [0, 0, 30], axis: [0, 0, -1], up: [0, 1, 0], hfovDeg: 40, vfovDeg: 30, targetBox: [-30, -5, -2.1, 30, 5, -2] });
  assert.deepEqual(probeWhereOf({ ...view, targetBox: null })!, { ...probeWhereOf(view)!, targetBox: null }, "a camera that must see none of the product");
  assert.deepEqual(probeWhereOf(light), { origin: [0, 0, 3], axis: [0, 0, 1], halfAngleDeg: 20, target: "out" });
  assert.deepEqual(probeWhereOf(keepout), { region: [12, 9, 2, 14, 11, 4] });
  assert.deepEqual(probeWhereOf({ ...light, halfAngleDeg: 120 }), { ...probeWhereOf(light)!, halfAngleDeg: 120 }, "a cone wider than half of all round");
  assert.deepEqual(probeWhereOf({ ...keepout, region: [1, 1, 1, 1, 1, 1] }), { region: [1, 1, 1, 1, 1, 1] }, "a box of no size is still a place");
  // Each that doesn't read is none.
  const bad: [string, Record<string, unknown>][] = [
    ["a point of two numbers", { ...port, center: [1, 2] }], ["a point with a string in it", { ...port, center: [1, "2", 3] }],
    ["a point of null", { ...port, center: [1, null, 3] }], ["a point of four", { ...port, center: [1, 2, 3, 4] }], ["a direction of no length", { ...port, normal: [0, 0, 0] }],
    ["a radius of none", { ...port, radius: 0 }], ["a radius under none", { ...port, radius: -1 }], ["no source", { ...port, source: undefined }],
    ["no origin", { ...view, origin: undefined }], ["an axis of no length", { ...view, axis: [0, 0, 0] }], ["an up of no length", { ...view, up: [0, 0, 0] }],
    ["an up not square to the axis", { ...view, up: [0, 1, 1] }], ["a field of no width", { ...view, hfovDeg: 0 }], ["a field all round", { ...view, vfovDeg: 180 }],
    ["a field of no height", { ...view, vfovDeg: 0 }], ["a field all round, across", { ...view, hfovDeg: 180 }],
    ["a target box inside out", { ...view, targetBox: [30, -5, -2.1, -30, 5, -2] }], ["a target box of five", { ...view, targetBox: [0, 0, 0, 1, 1] }],
    ["a target box of seven", { ...view, targetBox: [0, 0, 0, 1, 1, 1, 1] }],
    ["no target box at all", { ...view, targetBox: undefined }],
    ["a cone of none", { ...light, halfAngleDeg: 0 }], ["a cone all round", { ...light, halfAngleDeg: 180 }], ["no target", { ...light, target: null }],
    ["a light of no axis", { ...light, axis: [0, 0, 0] }],
    ["a region inside out", { ...keepout, region: [14, 9, 2, 12, 11, 4] }], ["a region inside out in y", { ...keepout, region: [12, 11, 2, 14, 9, 4] }],
    ["a region inside out in z", { ...keepout, region: [12, 9, 4, 14, 11, 2] }], ["a region of none", { ...keepout, region: null }],
    ["a kind it doesn't know", { ...keepout, kind: "smell" }],
  ];
  for (const [what, row] of bad) assert.equal(probeWhereOf(row), null, what);
});

// ---- the view's half: viewer/model.js draws each probe and says what it found ----

type Seg = number[][];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const crossOf = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a: number, b: number, what: string, e = 1e-6) => assert.ok(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), `${what}: ${a} is not ${b}`);
/** How far a point is from a box (0 inside it). */
const fromBox = (p: number[], b: number[]) => Math.hypot(...[0, 1, 2].map((k) => Math.max(b[k] - p[k], 0, p[k] - b[k + 3])));
let read: { keypad: ModelView; ponder: ModelView } | null = null;
const views = () => (read ??= { keypad: modelView(copyOf("macropad", "view-keypad"))!, ponder: modelView(copyOf("ponder", "view-ponder"))! });
const vary = (v: ModelView, change: (v: ModelView) => void) => { const c = structuredClone(v); change(c); return c; };

test("the view says of each probe whether it passes, what it found, what is in its way and which parts it names", () => {
  const { keypad, ponder } = views();
  assert.deepEqual(probeRowsOf(ponder).map((p) => [p.i, p.id, p.state]), ponder.probes.map((p, i) => [i, p.id, p.id === "pi-radio" ? "fail" : "pass"]));
  assert.deepEqual(probeCountOf(ponder), { n: 9, pass: 8, unknown: 0, fail: ["pi-radio"], accepted: [] });
  assert.equal(probeSummaryOf(ponder), "8 of 9 pass; pi-radio fails");
  assert.equal(probeSummaryOf(keypad), "both pass");
  const said = (v: ModelView, id: string) => probeReadoutOf(v, v.probes.find((p) => p.id === id)!);
  assert.equal(said(ponder, "speaker"), "speaker · sound · 30.4% of its sound gets out, needs 20%, falls short of the 40% it aims for · passes");
  assert.equal(said(ponder, "mic1-port"), "mic1-port · port · 99.6% of the port is open, needs 95% · passes");
  assert.equal(said(ponder, "camera"), "camera · view · all of its target in the image, none of it hidden; the product fills 15.4% of its image · passes");
  assert.equal(said(ponder, "pixel1"), "pixel1 · light · 76.2% of its light gets out, needs 70% · passes");
  assert.equal(said(ponder, "pi-radio"), `pi-radio · keep-out · the nearest metal is 8.91 mm from it (${labelOf(ponder, "scr25-4")}), needs 15 mm · fails`);
  assert.equal(said(keypad, "bootsel"), "bootsel · port · 100% of the port is open, needs 95% · passes");
  const of = (v: ModelView, id: string) => probeBlockersOf(v.probes.find((p) => p.id === id)!);
  assert.deepEqual(of(ponder, "speaker"), { label: "Its rays hit", ids: ["base-top"] });
  assert.deepEqual(of(ponder, "pixel8"), { label: "Its light hits", ids: ["base-top", "cam", "head-lower", "head-upper"] });
  assert.equal(of(ponder, "camera"), null, "nothing hides the page");
  assert.equal(of(ponder, "ledcam-light"), null);
  assert.deepEqual(of(ponder, "pi-radio"), { label: "Metal too near", ids: ["scr25-4", "ins25-4", "scr25-3", "ins25-3"], mm: [8.91, 9.11, 11.29, 11.49] });
  // A part's panel lists the probes it is the source of, in the way of, or metal too near.
  assert.deepEqual(partProbesOf(ponder, "spk"), [{ i: 0, role: "its source" }]);
  assert.deepEqual(partProbesOf(ponder, "head-upper"), [{ i: 1, role: "its rays hit this part" }, { i: 2, role: "its rays hit this part" },
    { i: 4, role: "its light hits this part" }, { i: 5, role: "its light hits this part" }]);
  assert.deepEqual(partProbesOf(ponder, "ins25-3"), [{ i: 8, role: "metal too near it: 11.49 mm" }]);
  assert.deepEqual(partProbesOf(ponder, "bonnet"), []);
  assert.deepEqual(partProbesOf(keypad, "ctrl"), [{ i: 0, role: "its source" }]);
});

test("a probe's state: accepted only when every problem of its own is, failing when it falls short with none listed, unknown for an earlier Sprue", () => {
  const { ponder } = views();
  const radio = ponder.probes.length - 1;
  const state = (change: (v: ModelView) => void) => { const v = vary(ponder, change); return probeStateOf(v, v.probes[radio]); };
  assert.equal(state(() => {}), "fail");
  assert.equal(state((v) => { for (const k of v.probes[radio].problems) v.problems[k].accepted = true; }), "accepted");
  assert.equal(state((v) => { v.problems[v.probes[radio].problems[0]].accepted = true; }), "fail", "one of four accepted");
  assert.equal(state((v) => { v.probes[radio].problems = []; }), "fail", "its problems past the 200 listed");
  assert.equal(state((v) => { v.probes[radio].ok = null; }), "unknown");
  assert.equal(state((v) => { v.probes[radio].ok = true; }), "pass");
  const v = vary(ponder, (v) => { for (const k of v.probes[radio].problems) v.problems[k].accepted = true; v.probes[1].ok = null; v.probes[2].ok = false; });
  assert.equal(probeSummaryOf(v), "6 of 9 pass; mic2-port fails; pi-radio falls short, accepted; 1 not said");
  assert.equal(probeReadoutOf(v, v.probes[radio]).split(" · ").at(-1), "falls short, accepted");
  assert.equal(probeReadoutOf(v, v.probes[1]).split(" · ").at(-1), "system.json doesn't say whether it passes");
  const many = vary(ponder, (v) => { for (const p of v.probes.slice(0, 5)) p.ok = false; });
  assert.equal(probeSummaryOf(many), "3 of 9 pass; speaker, mic1-port, mic2-port and 3 more fail");
  const one = vary(ponder, (v) => { v.probes = v.probes.slice(0, 1); });
  assert.equal(probeSummaryOf(one), "it passes");
  assert.equal(probeSummaryOf(vary(one, (v) => { v.probes[0].ok = false; })), "0 of 1 pass; speaker fails");
  assert.equal(probeSummaryOf(vary(ponder, (v) => { v.probes = []; })), "");
});

test("what a probe found, in words, for each kind and each way its row can be", () => {
  const { ponder } = views();
  const found = (id: string, f: Record<string, unknown>, where?: Record<string, unknown> | null) => {
    const p = ponder.probes.find((x) => x.id === id)!;
    return probeFoundOf(ponder, { ...p, found: f, where: where === undefined ? p.where : where } as ModelProbe);
  };
  assert.equal(found("speaker", { openShare: 0.5, need: 0.2 }), "50% of its sound gets out, needs 20%", "no aim");
  assert.equal(found("speaker", { openShare: 0.1234, need: 0.2, aim: 0.4 }), "12.3% of its sound gets out, needs 20%, falls short of the 40% it aims for", "an earlier Sprue's row: its share is under its aim");
  assert.equal(found("speaker", { openShare: 0.45, need: 0.2, aim: 0.4, aimMet: true }), "45% of its sound gets out, needs 20%, aims for 40%");
  // A share that rounds to its aim but is under it says so, as one just under its need does; one that meets it just does.
  assert.equal(found("speaker", { openShare: 0.4, need: 0.2, aim: 0.4, aimMet: false }), "just under 40% of its sound gets out, needs 20%, falls short of the 40% it aims for", "0.3995, written 0.4");
  assert.equal(found("speaker", { openShare: 0.4, need: 0.2, aim: 0.4, aimMet: true }), "40% of its sound gets out, needs 20%, aims for 40%");
  assert.equal(found("speaker", { openShare: 0.4, need: 0.2, aim: 0.4 }), "40% of its sound gets out, needs 20%, aims for 40%", "an earlier Sprue's row at its aim");
  assert.equal(found("mic1-port", { openShare: 0.949, need: 0.95 }), "94.9% of the port is open, needs 95%", "a tenth tells it from its need");
  // One that falls short by less than a tenth says so; one that meets its need just does.
  const ok = (id: string, f: Record<string, unknown>, okNow: boolean | null) => {
    const p = ponder.probes.find((x) => x.id === id)!;
    return probeFoundOf(ponder, { ...p, ok: okNow, found: f } as ModelProbe);
  };
  assert.equal(ok("mic1-port", { openShare: 0.95, need: 0.95 }, false), "just under 95% of the port is open, needs 95%", "0.9496, written 0.95");
  assert.equal(ok("mic1-port", { openShare: 0.95, need: 0.95 }, true), "95% of the port is open, needs 95%");
  assert.equal(ok("mic1-port", { openShare: 0.95, need: 0.95 }, null), "95% of the port is open, needs 95%", "an earlier Sprue's row doesn't say it falls short");
  assert.equal(ok("speaker", { openShare: 0.2, need: 0.2, aim: 0.4, aimMet: false }, false), "just under 20% of its sound gets out, needs 20%, falls short of the 40% it aims for");
  assert.equal(ok("pixel1", { share: 0.7, need: 0.7 }, false), "just under 70% of its light gets out, needs 70%");
  assert.equal(ok("pixel1", { share: 0.69, need: 0.7 }, false), "69% of its light gets out, needs 70%");
  assert.equal(ok("pi-radio", { nearestMetalMm: 15, nearest: "pi", need: 15 }, false), `the nearest metal is just under 15 mm from it (${labelOf(ponder, "pi")}), needs 15 mm`);
  assert.equal(found("pixel1", { share: 0.8, need: 0.7 }, { ...ponder.probes[4].where, target: "diffuser*" }), "80% of its light gets to diffuser*, needs 70%");
  // Without its place, where its light must go isn't said.
  assert.equal(found("pixel1", { share: 0.8, need: 0.7 }, null), "80% of its light gets where it must, needs 70%", "an earlier Sprue's row says no target");
  // A camera that must see none of the product, and one with a target.
  assert.equal(found("camera", { blockedShare: 0, inImage: [], blockedBy: [] }, { ...ponder.probes[3].where, targetBox: null }), "it sees none of the product, as it must");
  assert.equal(found("camera", { blockedShare: 0.1, inImage: ["pi"], blockedBy: ["pi"] }, { ...ponder.probes[3].where, targetBox: null }),
    "the product fills 10% of its image, which must show none of it");
  // An earlier Sprue's row with no place, nor what of its target it sees: whether it has one isn't said.
  assert.equal(found("camera", { blockedShare: 0.1, inImage: ["pi"], blockedBy: ["pi"] }, null), "the product fills 10% of its image");
  assert.equal(found("camera", { blockedShare: 0, inImage: [], blockedBy: [] }, null), "it sees none of the product");
  assert.equal(found("camera", { blockedShare: 0.1, inImage: ["pi"], blockedBy: [] }), "the product fills 10% of its image", "a target, and not what of it it sees");
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: 0.2, targetHidden: 0.05 }),
    "20% of its target out of the image, 5% hidden; the product fills 10% of its image");
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: 0, targetHidden: 0.5 }), "0% of its target out of the image, 50% hidden; the product fills 10% of its image");
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: null, targetHidden: null }), "its target has no upper surface to see; the product fills 10% of its image");
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: "a lot", targetHidden: 0 }), "");
  // Both or neither: one null beside a number is a row that doesn't read.
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: null, targetHidden: 0.2 }), "");
  assert.equal(found("camera", { blockedShare: 0.1, targetOutside: 0.2 }), "");
  assert.equal(found("pi-radio", { nearestMetalMm: null, nearest: null, need: 15 }), "no metal near it, needs 15 mm clear");
  assert.equal(found("pi-radio", { nearestMetalMm: 20.456, nearest: "pi", need: 15 }), `the nearest metal is 20.46 mm from it (${labelOf(ponder, "pi")}), needs 15 mm`);
  assert.equal(found("pi-radio", { nearestMetalMm: 20, nearest: "", need: 15 }), "the nearest metal is 20 mm from it, needs 15 mm");
  // What system.json doesn't say isn't made up.
  for (const [id, f] of [["speaker", { openShare: 0.5 }], ["mic1-port", { need: 0.95 }], ["pixel1", { share: "most", need: 0.7 }], ["camera", {}],
    ["pi-radio", { nearestMetalMm: 3 }]] as const) assert.equal(found(id, f), "", id);
  assert.equal(probeFoundOf(ponder, { ...ponder.probes[0], kind: "smell" } as unknown as ModelProbe), "");
  // What is near a keep-out when nothing is too near: the nearest metal, as a part's panel says it.
  const clear = vary(ponder, (v) => { v.probes[8].found = { nearestMetalMm: 20.5, nearest: "pi", need: 15 }; });
  assert.deepEqual(probeBlockersOf(clear.probes[8]), { label: "Nearest metal", ids: ["pi"] });
  assert.deepEqual(partProbesOf(clear, "pi"), [{ i: 4, role: "its light hits this part" }, { i: 8, role: "the nearest metal, 20.5 mm from it" }]);
  assert.deepEqual(partProbesOf(vary(ponder, (v) => { v.probes[8].found.within = [{ id: "scr25-4" }]; }), "scr25-4"), [{ i: 8, role: "metal too near it: how near isn't said" }]);
  assert.equal(probeBlockersOf({ ...clear.probes[8], found: { need: 15 } }), null);
  // An earlier Sprue named a part as the nearest though none was near: with no distance it names none.
  const far = vary(ponder, (v) => { v.probes[8].found = { nearestMetalMm: null, nearest: "pi", need: 15 }; });
  assert.equal(probeFoundOf(far, far.probes[8]), "no metal near it, needs 15 mm clear");
  assert.equal(probeBlockersOf(far.probes[8]), null);
  assert.deepEqual(partProbesOf(far, "pi"), [{ i: 4, role: "its light hits this part" }]);
  // A camera with a target names what hides it; one without, what it sees.
  assert.deepEqual(probeBlockersOf({ ...ponder.probes[3], found: { ...ponder.probes[3].found, blockedBy: ["pi"] } }), { label: "Hiding its target", ids: ["pi"] });
  assert.deepEqual(probeBlockersOf({ ...ponder.probes[3], found: { blockedShare: 0.1, blockedBy: ["pi", 7] } }), { label: "In its image", ids: ["pi"] });
  assert.deepEqual(partProbesOf(vary(ponder, (v) => { v.probes[3].found = { blockedShare: 0.1, blockedBy: ["pi"] }; }), "pi").map((r) => r.role),
    ["in its image", "its light hits this part"]);
  assert.deepEqual(partProbesOf(vary(ponder, (v) => { v.probes[3].found.blockedBy = ["pi"]; }), "pi").map((r) => r.role),
    ["hides part of its target", "its light hits this part"]);
});

test("a probe's lines are where the check casts it: a disc and its rays, a camera's field to its target, a light's cone, a keep-out and where its distance ends", () => {
  const { keypad, ponder } = views();
  // A tenth of the diagonal of the box round the parts as built.
  const boxes = ponder.items.map((i) => i.bbox!);
  const diag = Math.hypot(...[0, 1, 2].map((k) => Math.max(...boxes.map((b) => b[k + 3])) - Math.min(...boxes.map((b) => b[k]))));
  near(probeReachOf(ponder), diag / 10, "reach");
  assert.ok(probeReachOf(keypad) > 5 && probeReachOf(keypad) < probeReachOf(ponder) / 2, "a smaller product, a shorter reach");
  assert.equal(probeReachOf(vary(ponder, (v) => { for (const i of v.items) i.bbox = null; })), 10);
  assert.equal(probeReachOf(vary(ponder, (v) => { v.items = v.items.slice(0, 1); v.items[0].bbox = [1, 1, 1, 1, 1, 1]; })), 10, "a box of no size");
  const reach = 40;
  const shape = (p: ModelProbe) => probeShapeOf(p, reach)!;
  const pts = (segs: Seg[]) => segs.flat();
  for (const v of [keypad, ponder]) for (const p of v.probes) {
    const s = shape(p);
    assert.ok(s.lines.length > 0 && pts([...s.lines, ...s.faint]).every((q) => q.length === 3 && q.every(Number.isFinite)), p.id);
    // Its box is the box round its lines, no larger.
    const all = pts([...s.lines, ...s.faint]);
    assert.deepEqual(s.box, [0, 1, 2].map((k) => Math.min(...all.map((q) => q[k]))).concat([0, 1, 2].map((k) => Math.max(...all.map((q) => q[k])))), p.id);
  }
  // The speaker: its disc, square to its normal; its rays out along the normal, as far as `reach` (its diameter at least).
  const spk = ponder.probes[0], w = spk.where as { center: number[]; normal: number[]; radius: number };
  const s = shape(spk), long = Math.max(reach, 2 * w.radius);
  for (const q of pts(s.lines.slice(0, 32))) { near(len(sub(q, w.center)), w.radius, "on the disc's rim"); near(dot(sub(q, w.center), w.normal), 0, "in its plane", 1e-9); }
  assert.ok(s.lines.some(([a, b]) => len(sub(a, w.center)) < 1e-9 && len(sub(b, [w.center[0], w.center[1], w.center[2] + long])) < 1e-9), "its axis, out along the normal");
  const rays = s.faint.filter(([a, b]) => len(sub(b, a)) > 1e-6 && len(crossOf(sub(b, a), w.normal)) < 1e-9);
  assert.equal(rays.length, 8, "rays from its rim, along its normal");
  for (const [a, b] of rays) { near(len(sub(a, w.center)), w.radius, "from the rim"); near(len(sub(b, a)), long, "as long as it reaches"); }
  // A port as wide as the reach draws its rays out twice its radius.
  const wide = { ...keypad.probes[0], where: { ...keypad.probes[0].where!, radius: 30 } } as ModelProbe;
  assert.ok(probeShapeOf(wide, reach)!.faint.some(([a, b]) => Math.abs(len(sub(b, a)) - 60) < 1e-9));
  // The camera: its field's edges at its angles, out to the middle of its target's depth, and its target's box.
  const cam = ponder.probes[3], cw = cam.where as { origin: number[]; axis: number[]; up: number[]; hfovDeg: number; vfovDeg: number; targetBox: number[] };
  const right = crossOf(cw.axis, cw.up), th = Math.tan((cw.hfovDeg * Math.PI) / 360), tv = Math.tan((cw.vfovDeg * Math.PI) / 360);
  const cs = shape(cam);
  const edges = cs.faint.filter(([a]) => len(sub(a, cw.origin)) < 1e-9);
  assert.equal(edges.length, 4);
  for (const [, b] of edges) {
    const d = sub(b, cw.origin), along = dot(d, cw.axis);
    // system.json gives a direction to four places, so square to each other only that far.
    near(Math.abs(dot(d, right) / along), th, "across", 1e-3);
    near(Math.abs(dot(d, cw.up) / along), tv, "up", 1e-3);
  }
  const depth = dot(sub([0, 1, 2].map((k) => (cw.targetBox[k] + cw.targetBox[k + 3]) / 2), cw.origin), cw.axis);
  const ends = cs.faint.flatMap(([a, b]) => [a, b]).map((q) => dot(sub(q, cw.origin), cw.axis));
  near(Math.max(...ends), depth, "out to its target's depth", 1e-3);
  const corners = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? cw.targetBox[3] : cw.targetBox[0], i & 2 ? cw.targetBox[4] : cw.targetBox[1], i & 4 ? cw.targetBox[5] : cw.targetBox[2]].join(",")));
  const boxLines = cs.lines.filter(([a, b]) => corners.has(a.join(",")) && corners.has(b.join(",")));
  assert.equal(boxLines.length, 12, "its target's box");
  const alongOne = (segs: Seg[]) => segs.every(([a, b]) => [0, 1, 2].filter((k) => Math.abs(a[k] - b[k]) > 1e-9).length === 1);
  assert.ok(alongOne(boxLines), "each an edge, along one axis");
  assert.equal(new Set(boxLines.map(([a, b]) => [a.join(","), b.join(",")].sort().join(" "))).size, 12, "each edge once");
  // With no target, its field goes three times the reach.
  const blind = probeShapeOf({ ...cam, where: { ...cw, targetBox: null } } as ModelProbe, reach)!;
  near(Math.max(...blind.faint.flatMap(([a, b]) => [a, b]).map((q) => dot(sub(q, cw.origin), cw.axis))), 3 * reach, "no target", 1e-3);
  assert.equal(blind.lines.length, cs.lines.length - 12);
  // A light: its cone, `reach` along each side, at its half angle round its axis.
  const led = ponder.probes[4], lw = led.where as { origin: number[]; axis: number[]; halfAngleDeg: number };
  const ls = shape(led);
  for (const q of pts(ls.lines.slice(0, 32))) {
    near(len(sub(q, lw.origin)), reach, "as far as the reach");
    near(Math.acos(dot(sub(q, lw.origin), lw.axis) / reach), (lw.halfAngleDeg * Math.PI) / 180, "at its half angle");
  }
  assert.equal(ls.faint.filter(([a]) => len(sub(a, lw.origin)) < 1e-9).length, 8, "its sides, from the LED");
  // A keep-out: its region's box, and three rings where the distance it needs round it ends.
  const radio = ponder.probes[8], region = (radio.where as { region: number[] }).region, need = radio.found.need as number;
  const ks = shape(radio);
  assert.equal(ks.lines.length, 12);
  for (const q of pts(ks.lines)) assert.ok(fromBox(q, region) < 1e-9, "on its box");
  assert.ok(alongOne(ks.lines), "its edges, each along one axis");
  assert.equal(new Set(ks.lines.map(([a, b]) => [a.join(","), b.join(",")].sort().join(" "))).size, 12, "each edge once");
  assert.equal(ks.faint.length, 3 * 4 * 9);
  for (const q of pts(ks.faint)) near(fromBox(q, region), need, "where its distance ends", 1e-9);
  // Each ring is through the region's middle, square to one axis.
  const mid = [0, 1, 2].map((k) => (region[k] + region[k + 3]) / 2);
  for (const cut of [0, 1, 2]) {
    const of = ks.faint.slice(cut * 36, cut * 36 + 36);
    const flat = [0, 1, 2].find((k) => pts(of).every((q) => Math.abs(q[k] - mid[k]) < 1e-9));
    assert.equal(flat, 2 - cut, `ring ${cut}`);
    // Each joins the next: a closed line.
    for (const [k, [, b]] of of.entries()) assert.ok(len(sub(b, of[(k + 1) % of.length][0])) < 1e-9, `ring ${cut} is closed at ${k}`);
  }
  assert.deepEqual(probeShapeOf({ ...radio, found: {} }, reach)!.faint, [], "without its need, no ring");
  assert.equal(probeShapeOf({ ...radio, where: null }, reach), null);
  assert.equal(probeShapeOf({ ...radio, kind: "smell" } as unknown as ModelProbe, reach), null);
  // The box round them all, for the camera's planes: each probe's box inside it, and none for no probe drawn.
  const all = probesBoxOf(ponder, reach)!;
  for (const p of ponder.probes) {
    const b = shape(p).box;
    assert.ok([0, 1, 2].every((k) => all[k] <= b[k] && b[k + 3] <= all[k + 3]), p.id);
  }
  assert.deepEqual(all, [0, 1, 2].map((k) => Math.min(...ponder.probes.map((p) => shape(p).box[k])))
    .concat([0, 1, 2].map((k) => Math.max(...ponder.probes.map((p) => shape(p).box[k + 3])))), "no larger");
  assert.equal(probesBoxOf(vary(ponder, (v) => { for (const p of v.probes) p.where = null; }), reach), null);
  assert.deepEqual(probesBoxOf(vary(ponder, (v) => { for (const p of v.probes.slice(1)) p.where = null; }), reach), shape(ponder.probes[0]).box);
});
