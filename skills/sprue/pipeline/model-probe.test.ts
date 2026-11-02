// The 3D view's probes, as pipeline/model.ts reads them from system.json for the view to draw: each function probe's
// kind, whether it meets its need (its accepted reason aside), why the design has it and that reason, where it is in
// the frame, what the gate found, and the problems and accepted risks that are its own, by its id. A row of an earlier
// Sprue has no `ok` and no place; one whose place doesn't read (a point that isn't three numbers, a direction of no
// length, a radius or an angle out of range, a box inside out, a camera whose up isn't square to its axis) has none;
// a row of a kind the view doesn't know, or with no id, is left out. Run with
//   node --test skills/sprue/pipeline/model-probe.test.ts

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { modelView, probeWhereOf } from "./model.ts";
import type { SystemCheck } from "./types.ts";

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
  assert.ok(cam.targetBox[5] <= 0 && cam.targetBox[0] < cam.origin[0] && cam.origin[0] < cam.targetBox[3], "the page is on the desk, under the camera");
  // The speaker's grille faces up through the base, and the radio's keep-out is a box round the Pi's antenna.
  assert.deepEqual(ponder.probes[0].where, { source: "spk", center: [-45, -5, 37.5], normal: [0, 0, 1], radius: 17.8 });
  const region = (radio.where as { region: number[] }).region;
  assert.ok(region[0] < region[3] && region[1] < region[4] && region[2] < region[5]);
});

test("a probe's problems are its own by its id, accepted or not, and never another's whose id starts the same", () => {
  const dir = copyOf("macropad", "own");
  const sys = json<SystemCheck>(join(dir, "system.json"));
  const at = (x: number) => ({ parts: ["ctrl"], at: [x, 0, 0] });
  // A problem of another gate that starts with a probe's id isn't the probe's.
  const gates = sys.gates.map((g) => (g.id === "function" ? {
    ...g, status: "fail" as const, problems: 2,
    list: ["bootsel: 50% of it sees out, under 95% (blocked by top)", "boot: 0% of it sees out, under 95%"], where: [at(1), at(2)],
    flags: ["led: 40% of its light reaches out, under 50% (blocked by top) (accepted: a test)"], flagsWhere: [at(3)],
  } : g.id === "clearance" ? { ...g, status: "fail" as const, problems: 1, list: ["led: a part named as a probe is"], where: [at(4)] } : g));
  const probes = [...sys.probes, { ...sys.probes[0], id: "boot" }];
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, ok: false, gates, probes }));
  const v = modelView(dir)!;
  const own = (id: string) => v.probes.find((p) => p.id === id)!.problems.map((k) => [v.problems[k].text.split(":")[0], v.problems[k].accepted]);
  assert.deepEqual(own("bootsel"), [["bootsel", false]]);
  assert.deepEqual(own("boot"), [["boot", false]]);
  assert.deepEqual(own("led"), [["led", true]], "an accepted risk is the probe's too");
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
  assert.deepEqual(probeWhereOf({ ...keepout, region: [1, 1, 1, 1, 1, 1] }), { region: [1, 1, 1, 1, 1, 1] }, "a box of no size is still a place");
  // Each that doesn't read is none.
  const bad: [string, Record<string, unknown>][] = [
    ["a point of two numbers", { ...port, center: [1, 2] }], ["a point with a string in it", { ...port, center: [1, "2", 3] }],
    ["a point of null", { ...port, center: [1, null, 3] }], ["a point of four", { ...port, center: [1, 2, 3, 4] }], ["a direction of no length", { ...port, normal: [0, 0, 0] }],
    ["a radius of none", { ...port, radius: 0 }], ["a radius under none", { ...port, radius: -1 }], ["no source", { ...port, source: undefined }],
    ["no origin", { ...view, origin: undefined }], ["an axis of no length", { ...view, axis: [0, 0, 0] }], ["an up of no length", { ...view, up: [0, 0, 0] }],
    ["an up not square to the axis", { ...view, up: [0, 1, 1] }], ["a field of no width", { ...view, hfovDeg: 0 }], ["a field all round", { ...view, vfovDeg: 180 }],
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
