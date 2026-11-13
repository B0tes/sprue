// The 3D view's poses and marks. pipeline/model.ts reads the drawing's assembly from figure.json (its steps, and each
// part's step and lift, or why the model can't match a line's parts to the drawing's) and the stability gate's
// weighing, and tags a stability problem with the pose it is of; viewer/model.js says what a step, a line and a hash
// ask for, which problems it marks and why the rest aren't, and what the Mass line says. With the vendored three, a
// pose's box holds the parts where the pose moves them, and a pick goes through a case drawn as glass. Then the view in
// Chromium beside the drawing (viewer/figure.js), where Playwright can be resolved (skipped where it can't, as in CI's
// pipeline job; its browser job runs it): Take apart and E move the parts out and back, and the drawing with them; the
// steps hide later parts, which can't be picked; each view follows the other's step, apart pose, line and hover without
// saying it back, and on one card without scrolling or taking the focus; the hash starts a pose and follows it,
// whichever view reads it first; Escape lets go in order; reduced motion jumps, and once still nothing draws; Ponder's
// marks show while their parts are in place, faint behind a part, and Show frames them; the X-ray picks through the
// case; the centre of mass shows only for the whole product; a lit part's edges show through what hides it; Probes
// draws each function probe as built, lit by whether it passes, and Show frames one with the parts it names lit.
// Run with
//   node --test skills/sprue/pipeline/model-pose.test.ts
// and, for the Chromium half, NODE_PATH set to a node_modules that has playwright (SPRUE_BROWSER_TESTS=1 fails where
// it can't run, rather than skipping).

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { assemblyOf, matchCalls, modelView, type ModelView } from "./model.ts";
import type { Bom, SystemCheck, SystemItem } from "./types.ts";
import * as k from "../kit/iso-kit.mjs";
import {
  faceNear, hashOf, labelOf, legendOf, lineReadoutOf, linePanelOf, markInPose, markReadoutOf, marksOf, massTextOf, panelOf, partsOfLine, pickAt,
  markFaceOf, placeOf, poseBox, poseOptionOf, posePartsOf, poseTextOf, prepare, frameOf, probeReachOf, probeReadoutOf, probeShapeOf, readoutOf, stepReadoutOf, stepsOf,
  wholeOf,
} from "../viewer/model.js";

const SKILL = join(import.meta.dirname, "..");
const EXAMPLES = join(SKILL, "examples");
const THREE_DIR = join(SKILL, "viewer", "vendor", "three");
const tmp = mkdtempSync(join(tmpdir(), "sprue-pose-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** An example's folder as the repo has it: without fab/ and pcb/, which git ignores, so CI has neither. */
function copyOf(slug: string, name = slug) {
  const dir = join(tmp, name);
  cpSync(join(EXAMPLES, slug), dir, { recursive: true, filter: (src) => !/[/\\](fab|pcb|shots|production)$/.test(src) });
  return dir;
}
const variant = (view: ModelView, change: (v: ModelView) => void) => { const v = structuredClone(view); change(v); return v; };

type Figure = { steps: { n: number; text: string }[]; parts: { line: string; step: number; count: number; lift: number[]; at?: number[][] }[] };
const item = (id: string, line: string | null, bbox: number[] | null = [0, 0, 0, 1, 1, 1]): SystemItem => ({ id, line, model: "envelope", material: null, tags: [], massG: 1, massNote: "", estimated: false, bbox });
const inBox = (at: number[], b: number[] | null) => !!b && [0, 1, 2].every((k) => at[k] >= b[k] - 1 && at[k] <= b[k + 3] + 1);

test("the drawing's assembly: its steps, each part's step and move apart, matched by where each call says its part is, and why a line's parts can't follow it", () => {
  for (const slug of ["macropad", "ponder"]) {
    const dir = copyOf(slug, `assembly-${slug}`);
    const view = modelView(dir)!;
    const fig = json<Figure>(join(dir, "figure.json"));
    const a = view.assembly!;
    assert.deepEqual(a.steps, fig.steps.map((s) => ({ n: s.n, text: s.text })), slug);
    assert.deepEqual(stepsOf(view), a.steps);
    for (const it of view.items) {
      const calls = fig.parts.filter((p) => p.line === it.line && p.count !== 0);
      const at = new Set(calls.map((c) => c.step)), ways = new Set(calls.map((c) => c.lift.join(",")));
      const p = a.parts[it.id];
      if (at.size === 1 && ways.size === 1) {
        assert.deepEqual(p, { step: calls[0].step, lift: calls[0].lift }, `${slug} ${it.id}`);
        assert.ok(!(it.line! in a.unsure), `${slug} ${it.id}`);
      } else if (calls.length && calls.every((c) => c.at)) {
        // The calls disagree, so each part goes with the one call whose point is in it.
        const mine = calls.filter((c) => c.at!.some((q) => inBox(q, it.bbox)));
        assert.equal(mine.length, 1, `${slug} ${it.id}: one call's point is in it`);
        assert.deepEqual(p, { step: mine[0].step, lift: mine[0].lift }, `${slug} ${it.id}: follows the call whose point is in it`);
        assert.ok(!(it.line! in a.unsure), `${slug} ${it.id}`);
      } else {
        assert.deepEqual(p, { step: calls.length ? Math.min(...at) : fig.steps[0].n, lift: [0, 0, 0] }, `${slug} ${it.id}: in at its first step, unmoved`);
        assert.ok(it.line! in a.unsure, `${slug} ${it.id}: says why`);
      }
      assert.deepEqual(placeOf(view, it.id), p);
    }
  }
  const keypad = modelView(join(tmp, "assembly-macropad"))!, ponder = modelView(join(tmp, "assembly-ponder"))!;
  // Every keypad line is drawn once a step and moved one way; the caps go up, the tray and the feet down.
  assert.deepEqual(keypad.assembly!.unsure, {});
  assert.deepEqual(keypad.assembly!.parts.cap5, { step: 8, lift: [0, 0, 62.4] });
  assert.deepEqual(keypad.assembly!.parts.foot1, { step: 7, lift: [0, 0, -38.5] });
  assert.deepEqual(keypad.assembly!.parts.pcb, { step: 1, lift: [0, 0, 0] });
  // Ponder's base and head each have nuts, inserts and screws of one line, which the drawing places twice: each call
  // says where its part is, so the base's go in and come off with the base and the head's with the head.
  assert.deepEqual(ponder.assembly!.unsure, {});
  const pp = ponder.assembly!.parts;
  assert.deepEqual([pp["nut-base"], pp["nut-head"].step], [{ step: 10, lift: [0, 0, -146] }, 4]);
  assert.deepEqual([pp["scr3-base1"], pp["scr3-base6"], pp["scr3-head1"].step, pp["scr3-head4"].step], [{ step: 15, lift: [0, 0, -190] }, { step: 15, lift: [0, 0, -190] }, 14, 14]);
  assert.deepEqual([pp["ins3-base1"], pp["ins3-head1"].step], [{ step: 2, lift: [0, 0, -17] }, 2]);
  assert.ok(pp["ins3-head1"].lift[1] > 0 && pp["ins3-head1"].lift[2] < 0 && pp["ins3-head3"].lift.join() === pp["ins3-head1"].lift.join(), "the head's inserts come off along the head's tilt");
  assert.deepEqual(pp["nut-head"].lift, json<Figure>(join(tmp, "assembly-ponder", "figure.json")).parts.find((c) => c.line === "nut" && c.step === 4)!.lift);
  assert.deepEqual(legendOf(ponder).unsure, []);
  assert.equal(legendOf(ponder).steps, true);
  // Without the calls' points, which of a line's parts is which the model can't tell: the three lines say why.
  const blind = copyOf("ponder", "assembly-ponder-blind");
  const blindFig = json<Figure>(join(blind, "figure.json"));
  for (const p of blindFig.parts) delete p.at;
  writeFileSync(join(blind, "figure.json"), JSON.stringify(blindFig));
  const unmatched = modelView(blind)!;
  assert.deepEqual(unmatched.assembly!.unsure, {
    nut: "the drawing puts its parts in at steps 4 and 10, and which part is which the model can't tell, so its parts come in at step 4 and don't move apart",
    ins3: "the drawing moves its parts apart 2 ways, and which part is which the model can't tell, so its parts come in at step 2 and don't move apart",
    scr3: "the drawing puts its parts in at steps 14 and 15, and which part is which the model can't tell, so its parts come in at step 14 and don't move apart",
  });
  const up = unmatched.assembly!.parts;
  assert.deepEqual([up["nut-base"], up["nut-head"], up["scr3-base1"], up["scr3-head1"], up["ins3-base1"], up["ins3-head1"]],
    [{ step: 4, lift: [0, 0, 0] }, { step: 4, lift: [0, 0, 0] }, { step: 14, lift: [0, 0, 0] }, { step: 14, lift: [0, 0, 0] }, { step: 2, lift: [0, 0, 0] }, { step: 2, lift: [0, 0, 0] }]);
  const legend = legendOf(unmatched);
  assert.deepEqual(legend.unsure.map((u) => [u.line, u.name]), Object.keys(unmatched.assembly!.unsure).map((l) => [l, unmatched.lines[l].name]));

  // What assemblyOf makes of a drawing it can read only some of.
  const items = [item("a1", "a"), item("a2", "a"), item("b1", "b"), item("c1", "c"), item("x", null), item("d1", "d")];
  assert.equal(assemblyOf(null, items), null);
  assert.equal(assemblyOf({}, items), null);
  assert.equal(assemblyOf({ steps: [] }, items), null);
  assert.equal(assemblyOf({ steps: "1" }, items), null);
  const got = assemblyOf({
    steps: [{ n: 2, text: "Two" }, { n: 0, text: "none" }, { n: 1.5, text: "half" }, { n: "3", text: "a string" }, { n: 1, text: "One" }, { n: 2, text: "again" }, null],
    parts: [
      { line: "a", step: 1, count: 1, lift: [0, 0, 5] }, { line: "a", step: 1, count: 1, lift: [0, 0, 5] },
      { line: "a", step: 4, count: 0, lift: [9, 9, 9] }, // the second half of a split part: goes with the call that counts it
      { line: "b", step: 2, count: 1, lift: [1, 0, 0] }, { line: "b", step: 3, count: 1, lift: [1, 0, 0] }, { line: "b", step: 5, count: 1, lift: [1, 0, 0] },
      { line: "c", step: 2, count: 1, lift: [0, "up", 0] },
      { line: "e", step: 0, count: 1, lift: [0, 0, 1] }, { line: 7, step: 2, count: 1 }, null,
    ],
  }, items)!;
  assert.deepEqual(got.steps, [{ n: 1, text: "One" }, { n: 2, text: "Two" }, { n: 3, text: "" }, { n: 5, text: "" }], "steps in order, once each, with those only the parts name");
  assert.deepEqual(got.parts, {
    a1: { step: 1, lift: [0, 0, 5] }, a2: { step: 1, lift: [0, 0, 5] },
    b1: { step: 2, lift: [0, 0, 0] },
    c1: { step: 2, lift: [0, 0, 0] }, // a lift that isn't three numbers moves nothing
    x: { step: 1, lift: [0, 0, 0] },
    d1: { step: 1, lift: [0, 0, 0] },
  });
  assert.deepEqual(got.unsure, {
    b: "the drawing puts its parts in at steps 2, 3 and 5, and which part is which the model can't tell, so its parts come in at step 2 and don't move apart",
    d: "the drawing doesn't draw it, so it is in from the start and doesn't move",
  }, "a part of no line is in from the start, unsaid");

  // A line whose calls disagree is matched part by part by the points the calls give: each point goes to the part
  // whose box, grown by 1 mm, holds it, and of several the one whose box's centre is nearest.
  const box = (x: number) => [x, 0, 0, x + 2, 2, 2];
  const parts3 = [item("s1", "s", box(0)), item("s2", "s", box(10)), item("s3", "s", box(20)), item("t1", "t", box(0)), item("t2", "t", box(1))];
  const call = (line: string, step: number, lift: number[], at?: unknown, count = 1) => ({ line, step, count, lift, ...(at === undefined ? {} : { at }) });
  const of = (calls: unknown[], its = parts3) => assemblyOf({ steps: [{ n: 1, text: "" }], parts: calls }, its)!;
  let m = of([
    call("s", 3, [0, 0, -5], [[21, 1, 1]]), call("s", 2, [0, 0, 5], [[1, 1, 1], [12.9, -0.9, 2.9]], 2), // 1 mm past s2's box is in it
    call("t", 4, [1, 0, 0], [[2.4, 1, 1]]), call("t", 4, [0, 1, 0], [[1.4, 1, 1]]), // in both boxes: the nearer centre
  ]);
  assert.deepEqual(m.unsure, {});
  assert.deepEqual(m.parts, {
    s1: { step: 2, lift: [0, 0, 5] }, s2: { step: 2, lift: [0, 0, 5] }, s3: { step: 3, lift: [0, 0, -5] },
    t1: { step: 4, lift: [0, 1, 0] }, t2: { step: 4, lift: [1, 0, 0] },
  });
  // A line whose calls agree ignores their points, even ones that are in none of its parts.
  m = of([call("s", 2, [0, 0, 1], [[99, 99, 99]]), call("s", 2, [0, 0, 1], [[1, 1, 1], [11, 1, 1]], 2)]);
  assert.deepEqual([m.unsure, m.parts.s3], [{ t: "the drawing doesn't draw it, so it is in from the start and doesn't move" }, { step: 2, lift: [0, 0, 1] }]);
  // Why the model can't match them, and then the line's parts come in at its first step and don't move.
  const why = (calls: unknown[], its = parts3) => of(calls, its).unsure.s;
  const two = (a: unknown, b: unknown) => [call("s", 3, [0, 0, -5], a), call("s", 2, [0, 0, 5], b, 2)];
  const was = "the drawing puts its parts in at steps 2 and 3, and ";
  const then = ", so its parts come in at step 2 and don't move apart";
  assert.equal(why(two(undefined, [[1, 1, 1], [11, 1, 1]])), `${was}which part is which the model can't tell${then}`, "a call gives no point");
  assert.equal(why(two([[21, 1]], [[1, 1, 1], [11, 1, 1]])), `${was}which part is which the model can't tell${then}`, "a point that isn't three numbers is none");
  assert.equal(why(two([[21, 1, 1], [22, 1, 1]], [[1, 1, 1], [11, 1, 1]])), `${was}which part is which the model can't tell${then}`, "two points for a call that draws one part are none");
  assert.equal(why(two([[21, 1, 1]], [[1, 1, 1], [11, 1, 1]]), parts3.slice(0, 2)), `${was}the drawing gives 3 points for its 2 parts in the frame${then}`);
  assert.equal(why([call("s", 3, [0, 0, -5], [[21, 1, 1]]), call("s", 2, [0, 0, 5], [[1, 1, 1]])], parts3.slice(0, 1)), `${was}the drawing gives 2 points for its 1 part in the frame${then}`);
  assert.equal(why([call("s", 3, [0, 0, -5], [[21, 1, 1]])], [parts3[0], parts3[1]]), undefined, "one call agrees with itself: both parts go with it");
  assert.equal(why(two([[23.04, 1, 1]], [[1, 1, 1], [11, 1, 1]])), `${was}its point [23, 1, 1] for a part at step 3 is in none of them${then}`);
  assert.equal(why(two([[21, 1, 3.1]], [[1, 1, 1], [11, 1, 1]])), `${was}its point [21, 1, 3.1] for a part at step 3 is in none of them${then}`, "past the box along z");
  assert.equal(why(two([[21, -1.1, 1]], [[1, 1, 1], [11, 1, 1]])), `${was}its point [21, -1.1, 1] for a part at step 3 is in none of them${then}`, "past the box along y");
  assert.equal(why(two([[21, 1, 1]], [[1, 1, 1], [1.5, 0.5, 1]])), `${was}two of its points, [1, 1, 1] and [1.5, 0.5, 1], are in s1${then}`);
  assert.equal(why(two([[21, 1, 1]], [[1, 1, 1], [11, 1, 1]]), [parts3[0], { ...parts3[1], bbox: null }, parts3[2]]), `${was}its point [11, 1, 1] for a part at step 2 is in none of them${then}`, "a part with no box holds no point");
  assert.equal(why([call("s", 2, [0, 0, -5], [[21, 1, 1]]), call("s", 2, [0, 0, 5], [[1, 1, 1], [11, 1, 1]], 2)], parts3.slice(0, 2).concat(item("s3", "s", null))),
    "the drawing moves its parts apart 2 ways, and its point [21, 1, 1] for a part at step 2 is in none of them, so its parts come in at step 2 and don't move apart");
  m = of(two([[23.04, 1, 1]], [[1, 1, 1], [11, 1, 1]]));
  assert.deepEqual([m.parts.s1, m.parts.s3], [{ step: 2, lift: [0, 0, 0] }, { step: 2, lift: [0, 0, 0] }]);
  // matchCalls on its own: one point for two parts, and boxes that overlap along y and along z.
  assert.equal(matchCalls([{ step: 1, lift: [0, 0, 0], at: [[1, 1, 1]] }], parts3.slice(0, 2)), "the drawing gives 1 point for its 2 parts in the frame");
  for (const k of [1, 2]) {
    const shift = (d: number) => [0, 1, 2].map((i) => (i === k ? d : 0));
    const lo = item("lo", "u", [0, 0, 0, 2, 2, 2]), hi = item("hi", "u", [0, 0, 0, 2, 2, 2].map((v, i) => v + shift(1)[i % 3]));
    const up = { step: 2, lift: [0, 0, 1] as [number, number, number], at: [[1, 1, 1].map((v, i) => v + shift(0.8)[i]) as [number, number, number]] };
    const down = { step: 3, lift: [0, 0, -1] as [number, number, number], at: [[1, 1, 1].map((v, i) => v + shift(0.4)[i]) as [number, number, number]] };
    const got = matchCalls([up, down], [lo, hi]);
    assert.ok(got instanceof Map, `axis ${k}: ${got}`);
    assert.deepEqual([got.get("lo"), got.get("hi")], [down, up], `axis ${k}: each point goes to the box whose centre is nearer along it`);
  }

  // No figure.json, or one that isn't JSON: no assembly, and the legend says there is nothing to follow.
  for (const [name, write] of [["no-figure", () => rmSync(join(tmp, "no-figure", "figure.json"))], ["bad-figure", () => writeFileSync(join(tmp, "bad-figure", "figure.json"), "{")]] as const) {
    copyOf("macropad", name);
    write();
    const v = modelView(join(tmp, name))!;
    assert.equal(v.assembly, null, name);
    assert.equal(legendOf(v).steps, false);
    assert.deepEqual(stepsOf(v), []);
    assert.deepEqual(placeOf(v, "cap5"), { step: 1, lift: [0, 0, 0] });
  }
});

test("the whole product's weighing is the stability gate's first pose; a stability problem says which pose it is of", () => {
  for (const slug of ["macropad", "ponder"]) {
    const sys = json<SystemCheck>(join(EXAMPLES, slug, "system.json"));
    const s = sys.stability![0];
    const view = modelView(copyOf(slug, `mass-${slug}`))!;
    assert.deepEqual(view.stability, { pose: s.pose, massG: s.massG, estimatedG: s.estimatedG, com: s.com, tiltDeg: s.tiltDeg }, slug);
  }
  const keypad = modelView(join(tmp, "mass-macropad"))!, ponder = modelView(join(tmp, "mass-ponder"))!;
  assert.deepEqual(keypad.stability, { pose: "on the desk", massG: 149.3, estimatedG: 98.1, com: [5.6, -0.5, 4.2], tiltDeg: 58.7 });
  assert.equal(ponder.stability!.pose, "as built, head over the page");
  // A weighing that doesn't read is none; a tip angle that isn't a number is unknown.
  const sys = json<SystemCheck & { stability: unknown[] }>(join(EXAMPLES, "macropad", "system.json"));
  const base = sys.stability[0] as Record<string, unknown>;
  for (const [stability, want] of [
    [undefined, null], [[], null], [[{ ...base, com: [1, 2] }], null], [[{ ...base, com: [1, Number.NaN, 2] }], null], [[{ ...base, massG: "149" }], null],
    [[{ ...base, tiltDeg: null, estimatedG: undefined }], { pose: "on the desk", massG: 149.3, estimatedG: 0, com: [5.6, -0.5, 4.2], tiltDeg: null }],
  ] as const) {
    const dir = copyOf("macropad", `mass-${JSON.stringify(stability ?? "none").length}-${Math.random().toString(36).slice(2, 7)}`);
    writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, stability }));
    assert.deepEqual(modelView(dir)!.stability, want, JSON.stringify(stability));
  }
  // A pose whose name begins another's text is told apart by the longer: "on the desk: " begins the tilted pose's too.
  const dir = copyOf("macropad", "mass-poses");
  const gate = sys.gates.find((g) => g.id === "stability")!;
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys,
    stability: [base, { ...base, pose: "on the desk: tilted" }],
    gates: sys.gates.map((g) => (g.id === "stability" ? { ...gate, status: "fail", problems: 3, list: ["on the desk: tilted: it tips", "on the desk: it tips", "on the deskette: it tips"],
      where: [{ parts: [], at: [0, 0, 0] }, { parts: [], at: [0, 0, 0] }, { parts: [], at: [0, 0, 0] }] } : g)) }));
  assert.deepEqual(modelView(dir)!.problems.filter((p) => p.gate === "stability").map((p) => p.pose), ["on the desk: tilted", "on the desk", null]);
});

test("what a step, a line and the page's hash ask for", () => {
  const keypad = modelView(copyOf("macropad", "hash"))!;
  const ponder = modelView(copyOf("ponder", "hash-ponder"))!;
  const steps = stepsOf(keypad);
  assert.equal(stepReadoutOf(keypad, 3), `Step 3 of 9 · ${steps[2].text}`);
  assert.equal(stepReadoutOf(keypad, 0), "");
  assert.equal(stepReadoutOf(keypad, 10), "");
  assert.equal(stepReadoutOf(variant(keypad, (v) => { v.assembly!.steps[2].text = ""; }), 3), "Step 3 of 9");

  const none = { apart: false, at: 0, part: null, line: null, pose: 0 };
  for (const [hash, want] of [
    ["", none], ["#", none], ["#apart", { ...none, apart: true }], ["#apart=0", none], ["#apart=1", { ...none, apart: true }],
    ["#step=3", { ...none, at: 3 }], ["#step=99", { ...none, at: 9 }], ["#step=-2", none], ["#step=x", none], ["#step", none],
    ["#part=sw5", { ...none, part: "sw5" }], ["#part=nope", none], ["#part=", none],
    ["#select=cap", { ...none, line: "cap" }], ["#select=nope", none], ["#select=__proto__", none], ["#select=toString", none],
    ["#apart&step=3&part=sw5&select=sw", { apart: true, at: 3, part: "sw5", line: "sw", pose: 0 }],
    ["#select=sw&apart&&step=2", { apart: true, at: 2, part: null, line: "sw", pose: 0 }],
    ["#pose=on%20the%20desk", none], ["#pose=nope", none],
    ["#%E0&part=%E0", none], ["#part=sw%35", { ...none, part: "sw5" }], ["#3d&apart", { ...none, apart: true }],
  ] as const) assert.deepEqual(hashOf(hash, keypad), want, hash);
  assert.deepEqual(hashOf("#step=3&apart", variant(keypad, (v) => { v.assembly = null; })), { ...none, apart: true }, "no steps to walk to");
  // A pose by its name, this view's alone: with apart or a step, which the drawing follows, the frame's.
  const left = encodeURIComponent(ponder.poses[4].name);
  for (const [hash, want] of [
    [`#pose=${left}`, { ...none, pose: 4 }], [`#part=cam&pose=${left}`, { ...none, part: "cam", pose: 4 }],
    [`#pose=${encodeURIComponent(ponder.poses[1].name)}&pose=${left}`, { ...none, pose: 4 }], [`#pose=${left}&pose=nope`, none],
    [`#pose=${left}&apart`, { ...none, apart: true }], [`#step=2&pose=${left}`, { ...none, at: 2 }], [`#pose=${left}&step=0`, { ...none, pose: 4 }],
    ["#pose=arm pulled straight out left", { ...none, pose: 4 }], ["#pose=Arm%20pulled%20straight%20out%20left", none], ["#pose=", none],
  ] as const) assert.deepEqual(hashOf(hash, ponder), want, hash);
  assert.deepEqual(hashOf(`#pose=${left}`, variant(ponder, (v) => { v.poses = []; })), none, "a system.json of an earlier Sprue: no poses");

  // A line, as one chosen in the drawing or a BOM row.
  assert.deepEqual(partsOfLine(keypad, "cap"), ["cap1", "cap2", "cap3", "cap4", "cap5", "cap6", "cap7", "cap8", "cap9"]);
  assert.equal(lineReadoutOf(keypad, "cap"), "Keycap · 9 parts · bought");
  assert.equal(lineReadoutOf(keypad, "pcb"), `${keypad.lines.pcb.short || keypad.lines.pcb.name} · 1 part · PCB`);
  assert.equal(lineReadoutOf(ponder, "psu"), `${ponder.lines.psu.short || ponder.lines.psu.name} · not in the model · bought`);
  assert.equal(linePanelOf(keypad, "nope"), null);
  const caps = linePanelOf(keypad, "cap")!;
  assert.deepEqual([caps.title, caps.sub, caps.parts.length, caps.missing, caps.problems], [keypad.lines.cap.name, "cap · 9 parts in the model · bought", 9, "", []]);
  const psu = linePanelOf(ponder, "psu")!;
  assert.deepEqual([psu.parts, psu.missing, psu.notes], [[], ponder.relations.unplaced!.psu, []], "a line not in the model says why, and no caveat of parts it hasn't");
  // A line's problems are those that name any of its parts, each once, with its place in the view's list.
  const screws = linePanelOf(ponder, "scr25")!;
  const want = ponder.problems.flatMap((p, i) => (p.parts.some((x) => x.startsWith("scr25-")) ? [i] : []));
  assert.deepEqual(screws.problems.map((p) => p.i), want);
  assert.equal(screws.count, "2 problems");
  for (const p of screws.problems) assert.equal(ponder.problems[p.i].text, p.text);
  for (const id of ["head-upper", "scr25-4"]) for (const p of panelOf(ponder, id)!.problems) assert.ok(ponder.problems[p.i].parts.includes(id));
  for (const p of wholeOf(ponder).problems) assert.equal(ponder.problems[p.i].parts.length, 0);
});

test("which problems are marked, why the rest aren't, and what the Mass line says", () => {
  const keypad = modelView(copyOf("macropad", "marks"))!;
  const ponder = modelView(copyOf("ponder", "marks-ponder"))!;
  assert.deepEqual(marksOf(keypad), []);
  assert.deepEqual(legendOf(keypad).marks, { problems: 0, risks: 0, inPose: 0, otherPose: 0, noPose: 0, noPlace: 0 });
  // Ponder: its 10 problems, its 2 risks of tipping as built, and its 4 of the arm pulled straight out, each in its
  // pose, which the model draws: marked while the view shows that pose.
  const marks = marksOf(ponder);
  assert.deepEqual(marks.map((m) => m.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  for (const m of marks) assert.deepEqual({ ...ponder.problems[m.i], i: m.i }, m);
  assert.deepEqual([8, 9, 10, 11].map((i) => ponder.problems[i].pose), ponder.poses.slice(1).map((p) => p.name));
  assert.deepEqual(legendOf(ponder).marks, { problems: 10, risks: 6, inPose: 4, otherPose: 0, noPose: 0, noPlace: 0 });
  // A first pose that moves the head too leaves the head's marks in no pose the model draws: not counted as marked.
  const headless = variant(ponder, (v) => { v.poses[0] = { ...v.poses[0], drop: [...v.poses[1].drop], moved: v.poses[1].moved }; });
  assert.deepEqual(legendOf(headless).marks, { problems: 1, risks: 6, inPose: 4, otherPose: 0, noPose: 9, noPlace: 0 });
  // A problem with no place, or one whose place is not three numbers, isn't marked: the check gives it none.
  const placeless = variant(ponder, (v) => { v.problems[0].at = null; v.problems[1].at = [1, 2]; v.problems[2].at = [1, Number.NaN, 3]; });
  assert.deepEqual(marksOf(placeless).map((m) => m.i), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(legendOf(placeless).marks, { problems: 7, risks: 6, inPose: 4, otherPose: 0, noPose: 0, noPlace: 3 });
  // The poses say which the model draws, weighed or not.
  assert.deepEqual(marksOf(variant(ponder, (v) => { v.stability = null; })).map((m) => m.i), marks.map((m) => m.i));
  // A system.json of an earlier Sprue has no poses: the model draws only the first weighing's, as built, and a risk of
  // the arm pulled straight out is where its parts would be in a pose it doesn't draw.
  const earlier = variant(ponder, (v) => { v.poses = []; });
  assert.deepEqual(marksOf(earlier).map((m) => m.i), [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  assert.deepEqual(legendOf(earlier).marks, { problems: 10, risks: 2, inPose: 0, otherPose: 4, noPose: 0, noPlace: 0 });
  // And with no weighing either, no pose is known to be the model's.
  const unweighed = variant(earlier, (v) => { v.stability = null; });
  assert.deepEqual(marksOf(unweighed).map((m) => m.i), [0, 1, 2, 3, 4, 5, 12, 13, 14, 15]);
  assert.deepEqual(legendOf(unweighed).marks, { problems: 10, risks: 0, inPose: 0, otherPose: 6, noPose: 0, noPlace: 0 });

  assert.equal(markReadoutOf(ponder, [0]), "Problem · clearance · Base top, Junction board");
  assert.equal(markReadoutOf(ponder, [12]), "Problem · function · M2.5 x 6 screw 4");
  assert.equal(markReadoutOf(ponder, [6]), "Accepted risk · stability · the whole product");
  assert.equal(markReadoutOf(ponder, [0, 1, 2, 3, 4, 5]), "6 problems · clearance");
  assert.equal(markReadoutOf(ponder, [6, 7]), "2 accepted risks · stability");
  assert.equal(markReadoutOf(ponder, [5, 6, 12]), "3 problems · clearance, stability, function");
  assert.equal(markReadoutOf(ponder, []), "");
  assert.equal(markReadoutOf(ponder, [99]), "");

  assert.equal(massTextOf(keypad), "On the desk: 149.3 g, 98.1 g of it estimated (66%) · centre of mass at (5.6, -0.5, 4.2) mm · tilted past 58.7° it tips over");
  // Ponder's arm and harness are weighed as points, so its parts sum to less than it weighs.
  const drawn = ponder.items.reduce((t, i) => t + (i.massG ?? 0), 0);
  assert.equal(massTextOf(ponder), `As built, head over the page: 1089.7 g, 385.1 g of it estimated (35%), ${Number((1089.7 - drawn).toFixed(1))} g of it with no part in the model (the check weighs it as points) · centre of mass at (18.3, 13, 99.6) mm · tilted past 15.9° it tips over`);
  const s = keypad.stability!;
  assert.equal(massTextOf(variant(earlierOf(keypad), (v) => { v.stability = { ...s, tiltDeg: null, estimatedG: 0, pose: "" }; })), "149.3 g · centre of mass at (5.6, -0.5, 4.2) mm");
  assert.match(massTextOf(variant(earlierOf(keypad), (v) => { v.stability = { ...s, tiltDeg: -3 }; }))!, / · its centre of mass is outside what it stands on, so it tips over$/);
  // Each part's mass is rounded to a tenth of a gram: parts that sum to a little under the whole are the rounding,
  // not weight the check put on no part.
  assert.doesNotMatch(massTextOf(variant(earlierOf(keypad), (v) => { v.stability = { ...s, massG: s.massG + 0.15 }; }))!, /no part in the model/);
  assert.match(massTextOf(variant(earlierOf(keypad), (v) => { v.stability = { ...s, massG: s.massG + 5 }; }))!, /, 5(\.\d)? g of it with no part in the model/);
  assert.equal(massTextOf(variant(earlierOf(keypad), (v) => { v.stability = null; })), null);
});

test("the poses: what each draws and weighs, which marks show in it, and what the Pose list, its line and Mass say", () => {
  const ponder = modelView(copyOf("ponder", "poses-ponder"))!, keypad = modelView(copyOf("macropad", "poses-keypad"))!;
  const sys = json<SystemCheck>(join(EXAMPLES, "ponder", "system.json"));
  // system.json's poses, each with the stability gate's weighing of it: the first is the frame's, view.stability.
  assert.deepEqual(ponder.poses.map((p) => p.name), sys.stability!.map((s) => s.pose));
  ponder.poses.forEach((p, k) => {
    const s = sys.stability![k];
    assert.deepEqual({ ...p, mass: null }, { ...sys.poses![k], mass: null }, p.name);
    assert.deepEqual(p.mass, { pose: s.pose, massG: s.massG, estimatedG: s.estimatedG, com: s.com, tiltDeg: s.tiltDeg }, p.name);
  });
  assert.deepEqual(ponder.poses[0].mass, ponder.stability);
  assert.deepEqual(keypad.poses, [{ name: "on the desk", drop: [], moved: null, drawn: [], scene: null, mass: keypad.stability }]);
  // What doesn't read is none: a move that isn't four rows of four numbers, a scene that isn't a pose's own, a dropped
  // id that isn't a string, a drawn part with no id, a pose with no name; a pose the gate didn't weigh has no weighing.
  const dir = copyOf("ponder", "poses-odd");
  const [p0, p1, p2, p3, p4] = sys.poses!;
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, poses: [
    p0, { ...p1, moved: p1.moved!.slice(0, 3), scene: 0 }, { ...p2, moved: [...p2.moved!.slice(0, 3), [0, 0, 0, "1"]], drop: ["pi", 7, null], scene: 2.5 },
    { ...p3, name: "" }, { ...p4, name: "not weighed", drawn: [null, { id: 5 }, ...p4.drawn] }, null, { ...p1, drop: "pi", drawn: "arm", scene: -1 },
  ] }));
  assert.deepEqual(modelView(dir)!.poses.map((p) => [p.name, p.drop.length, p.moved, p.drawn.map((d) => d.id), p.scene, p.mass && p.mass.pose]), [
    [p0.name, 0, null, [], null, p0.name],
    [p1.name, 33, null, ["arm"], null, p1.name],
    [p2.name, 1, null, ["arm"], null, p2.name],
    ["not weighed", 33, p4.moved, ["arm"], 4, null],
    [p1.name, 0, p1.moved, [], null, p1.name],
  ]);
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, poses: undefined }));
  assert.deepEqual(modelView(dir)!.poses, [], "a system.json of an earlier Sprue: none");
  // A pose the gate couldn't weigh has no row in stability, but its problems are still of it.
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, stability: sys.stability!.filter((s) => s.pose !== p2.name) }));
  const unweighedPose = modelView(dir)!;
  assert.equal(unweighedPose.poses[2].mass, null);
  assert.equal(unweighedPose.problems[9].pose, p2.name, "the risk of a pose not weighed is of that pose");
  assert.equal(poseOptionOf(unweighedPose, 2), "Arm pulled straight out backward · 1 stability risk accepted");
  // As built not weighed: the first weighing is another pose's, which the frame's Mass line doesn't take for its own.
  writeFileSync(join(dir, "system.json"), JSON.stringify({ ...sys, stability: sys.stability!.slice(1) }));
  const firstUnweighed = modelView(dir)!;
  assert.equal(firstUnweighed.stability!.pose, p1.name);
  assert.equal(firstUnweighed.poses[0].mass, null);
  assert.equal(massTextOf(firstUnweighed, 0), null, "no weighing as built");
  assert.equal(massTextOf(firstUnweighed, 1), massTextOf(modelView(copyOf("ponder", "poses-ponder"))!, 1));

  // What each pose does to the frame the model draws: Ponder's straight poses move the head out on the arm (all 33 of
  // its parts) and draw the gooseneck straight in place of its design path.
  const none = { moved: [], hidden: [], redrawn: [] };
  assert.deepEqual(posePartsOf(ponder, 0), none);
  for (const k of [1, 2, 3, 4]) assert.deepEqual(posePartsOf(ponder, k), { moved: ponder.poses[k].drop, hidden: [], redrawn: ["arm"] });
  assert.ok(["head-upper", "head-lower", "cam", "mic1", "scr25-4"].every((id) => ponder.poses[1].drop.includes(id)));
  assert.ok(!["base-top", "junction", "coupling-base"].some((id) => ponder.poses[1].drop.includes(id)));
  assert.deepEqual(posePartsOf(ponder, 5), none, "a pose it hasn't");
  assert.deepEqual(posePartsOf(keypad, 0), none);
  // One that doesn't say where it puts what it takes out doesn't draw it; an id the frame doesn't have is none of its.
  const unmoved = variant(ponder, (v) => {
    v.poses[1].moved = null;
    v.poses[1].drop.push("nope", "pi");
    v.poses[1].drawn.push({ ...v.poses[1].drawn[0], id: "rope" }, { ...v.poses[1].drawn[0], id: "camcable" });
  });
  assert.deepEqual(posePartsOf(unmoved, 1), { moved: [], hidden: ponder.poses[1].drop, redrawn: ["arm", "camcable"] });

  // The line under the bar.
  assert.equal(poseTextOf(ponder, 0), null, "as built: nothing to say");
  assert.equal(poseTextOf(keypad, 0), null);
  assert.equal(poseTextOf(ponder, 5), null);
  assert.equal(poseTextOf(ponder, 1), "Arm pulled straight out forward, as the stability gate weighs it: 33 parts moved where it puts them; Gooseneck drawn as it bends it. No gate checks how the parts fit in this pose.");
  assert.equal(poseTextOf(unmoved, 1), `Arm pulled straight out forward, as the stability gate weighs it: Gooseneck, ${labelOf(ponder, "camcable")} drawn as it bends them; 33 parts not drawn, as it doesn't say where they go. No gate checks how the parts fit in this pose.`);
  assert.equal(poseTextOf(variant(ponder, (v) => { v.poses[2] = { ...v.poses[2], drop: ["pi"], drawn: [] }; }), 2),
    "Arm pulled straight out backward, as the stability gate weighs it: 1 part moved where it puts it. No gate checks how the parts fit in this pose.");
  assert.equal(poseTextOf(variant(ponder, (v) => { v.poses[2] = { ...v.poses[2], drop: ["pi"], moved: null, drawn: [] }; }), 2),
    "Arm pulled straight out backward, as the stability gate weighs it: 1 part not drawn, as it doesn't say where it goes. No gate checks how the parts fit in this pose.");
  assert.equal(poseTextOf(variant(ponder, (v) => { v.poses[3] = { ...v.poses[3], drop: [], moved: null, drawn: [] }; }), 3), "Arm pulled straight out right: every part where it is as built.");
  assert.match(poseTextOf(variant(ponder, (v) => { v.poses[0] = { ...v.poses[0], drop: ["pi"], moved: v.poses[1].moved }; }), 0)!, /^As built, head over the page, as the stability gate weighs it: 1 part moved/, "the frame's pose, when it moves a part");

  // The Pose list.
  assert.deepEqual(ponder.poses.map((_, k) => poseOptionOf(ponder, k)), ["As built, head over the page · 2 stability risks accepted",
    "Arm pulled straight out forward · 1 stability risk accepted", "Arm pulled straight out backward · 1 stability risk accepted",
    "Arm pulled straight out right · 1 stability risk accepted", "Arm pulled straight out left · 1 stability risk accepted"]);
  assert.equal(poseOptionOf(variant(ponder, (v) => { v.problems[8].accepted = false; }), 1), "Arm pulled straight out forward · 1 stability problem");
  assert.equal(poseOptionOf(variant(ponder, (v) => { v.problems.push({ ...v.problems[8], accepted: false }, { ...v.problems[8], accepted: false }); }), 1),
    "Arm pulled straight out forward · 2 stability problems · 1 stability risk accepted");
  assert.equal(poseOptionOf(keypad, 0), "On the desk");
  assert.equal(poseOptionOf(ponder, 5), "");

  // Which marks show in each pose: a stability pose's in its own; any other's where the pose leaves every part it names
  // as built (the base's, not the head's), and one of no one part where it leaves them all.
  const shows = (view: ModelView, k: number) => marksOf(view).filter((m) => markInPose(view, m, k)).map((m) => m.i);
  assert.deepEqual(shows(ponder, 0), [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
  for (const k of [1, 2, 3, 4]) assert.deepEqual(shows(ponder, k), [0, 7 + k], ponder.poses[k].name);
  assert.ok(ponder.problems[0].parts.every((id) => !ponder.poses[1].drop.includes(id)), "the base's");
  assert.ok([1, 2, 3, 4, 5, 12, 13, 14, 15].every((i) => ponder.problems[i].parts.some((id) => ponder.poses[1].drop.includes(id))), "the head's");
  const whole = { gate: "function", title: "f", text: "of the whole product", parts: [], at: [0, 0, 0], accepted: false, pose: null };
  assert.deepEqual([0, 1].map((k) => markInPose(ponder, whole, k)), [true, false]);
  assert.equal(markInPose(variant(ponder, (v) => { v.poses[1] = { ...v.poses[1], drop: [], moved: null, drawn: [] }; }), whole, 1), true);
  assert.equal(markInPose(ponder, { ...whole, parts: ["arm"] }, 1), false, "the gooseneck is drawn again in it");
  // One that names a part the pose leaves and one it moves, or draws again, is where the check found it in neither.
  assert.equal(markInPose(ponder, { ...whole, parts: ["base-top", "head-upper"] }, 1), false);
  assert.equal(markInPose(ponder, { ...whole, parts: ["base-top", "arm"] }, 1), false);
  assert.equal(markInPose(ponder, { ...whole, parts: ["base-top", "junction"] }, 1), true);
  assert.equal(markInPose(earlierOf(ponder), ponder.problems[8], 0), false, "without poses, only the first weighing's");
  assert.equal(markInPose(earlierOf(ponder), ponder.problems[6], 0), true);

  // The Mass line of each pose: its own weighing, and its own parts.
  const drawn = ponder.items.reduce((t, i) => t + (i.massG ?? 0), 0);
  const off = (g: number) => `${Number(g.toFixed(1))} g of it with no part in the model (the check weighs it as points)`;
  assert.equal(massTextOf(ponder, 0), massTextOf(ponder));
  assert.equal(massTextOf(ponder, 1), `Arm pulled straight out forward: 1089.7 g, 385.1 g of it estimated (35%), ${off(1089.7 - drawn)} · centre of mass at (19.8, 92.7, 34.5) mm · its centre of mass is outside what it stands on, so it tips over`);
  assert.equal(massTextOf(ponder, 4), `Arm pulled straight out left: 1089.7 g, 385.1 g of it estimated (35%), ${off(1089.7 - drawn)} · centre of mass at (-77.6, -4.6, 34.5) mm · its centre of mass is outside what it stands on, so it tips over`);
  // The gooseneck the pose draws weighs what the pose weighs it at; parts it doesn't draw have no part in the model.
  assert.match(massTextOf(variant(ponder, (v) => { v.poses[1].drawn[0].massG = 300; }), 1)!, new RegExp(`, ${off(1089.7 - drawn + 20).replace(/[()]/g, "\\$&")} · `));
  const head = ponder.items.filter((i) => ponder.poses[1].drop.includes(i.id)).reduce((t, i) => t + (i.massG ?? 0), 0);
  assert.ok(head > 100);
  assert.match(massTextOf(unmoved, 1)!, new RegExp(`, ${off(1089.7 - drawn + head).replace(/[()]/g, "\\$&")} · `));
  assert.equal(massTextOf(variant(ponder, (v) => { v.poses[2].mass = null; }), 2), null, "a pose the gate didn't weigh");
  assert.equal(massTextOf(ponder, 5), null);
  assert.equal(massTextOf(variant(ponder, (v) => { v.poses[0].mass = null; }), 0), null, "the frame's is its pose's own");
  assert.equal(massTextOf(variant(ponder, (v) => { v.stability = null; }), 0), massTextOf(ponder, 0));
  assert.equal(massTextOf(earlierOf(ponder), 0), massTextOf(ponder, 0), "without poses, view.stability");
  assert.equal(massTextOf(earlierOf(ponder), 1), null);

  // A part's panel in a pose: the gooseneck the pose draws is that path, its size and why; a part it moves is its
  // size as built; one it leaves is as it is.
  const facts = (k: number, id: string) => Object.fromEntries(panelOf(ponder, id, k)!.facts);
  assert.equal(facts(1, "arm").Drawn, `along a path, which no gate checks as a shape: ${ponder.poses[1].drawn[0].why}`);
  assert.equal(facts(1, "arm").Size, "12.7 × 381 × 12.7 mm (x, y, z), of what is drawn");
  assert.equal(facts(1, "arm").Mass, facts(0, "arm").Mass);
  assert.notEqual(facts(0, "arm").Size, facts(1, "arm").Size);
  assert.match(facts(1, "head-upper").Size, /mm \(x, y, z\), as built$/);
  assert.equal(facts(1, "head-upper").Size, `${facts(0, "head-upper").Size}, as built`);
  assert.deepEqual(facts(1, "base-top"), facts(0, "base-top"));
  assert.deepEqual(panelOf(ponder, "head-upper", 9), panelOf(ponder, "head-upper"), "a pose it hasn't");
});

/** A view of a system.json of an earlier Sprue, which has no poses. */
const earlierOf = (view: ModelView) => variant(view, (v) => { v.poses = []; });

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
const COLORS = { face: "#1b1b1b", top: "#262626", paper: "#131313", hi: "#d4d4d4", mid: "#6a6a6a", lo: "#3e3e3e", faint: "#2a2a2a", lit: "#ffffff", red: "#ff6b6b" };

test("with the vendored three: a pose's box holds the parts where it moves them, a pick goes through the glass, and a mark sits on the face where its pose has it", async () => {
  const t = await three();
  const { THREE } = t;
  const view = modelView(copyOf("macropad", "three"))!;
  const glb = readFileSync(join(EXAMPLES, "macropad", view.model.file));
  const gltf = await new t.GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  const parts = prepare(t, gltf.scene, COLORS, new Set(view.items.map((i) => i.id)));
  gltf.scene.updateMatrixWorld(true);
  const all = [...parts.values()];
  const lift = (part: { id: string }) => placeOf(view, part.id).lift;
  const cap = parts.get("cap5")!;
  const at = (k: number | null) => poseBox(t, [cap], lift, () => k);
  // The cap's box, put together, is the cap's own; apart, it is moved by its lift: 62.4 mm up, which is the world's y.
  const own = new THREE.Box3().setFromObject(cap.mesh);
  assert.ok(at(0).min.distanceTo(own.min) < 1e-6 && at(0).max.distanceTo(own.max) < 1e-6, "in place, the part's own box");
  const moved = at(1).getCenter(new THREE.Vector3()).sub(at(0).getCenter(new THREE.Vector3()));
  assert.ok(moved.distanceTo(new THREE.Vector3(0, 0.0624, 0)) < 1e-9, `apart, 62.4 mm up: ${moved.toArray()}`);
  const half = at(0.5).getCenter(new THREE.Vector3()).sub(at(0).getCenter(new THREE.Vector3()));
  assert.ok(half.distanceTo(moved.clone().multiplyScalar(0.5)) < 1e-9, "half way, half as far");
  assert.equal(at(null).isEmpty(), true, "a part not shown is in no box");
  assert.equal(poseBox(t, all, lift, () => null).isEmpty(), true);
  // A part a stability pose moves: its box where the move puts it (a Matrix4 in the frame, mm), then lifted.
  const centre = (b: { getCenter(v: unknown): { sub(v: unknown): { distanceTo(v: unknown): number } } }) => b.getCenter(new THREE.Vector3());
  const up = new THREE.Matrix4().makeTranslation(0, 0, 10);
  assert.ok(centre(poseBox(t, [cap], lift, () => 0, () => up)).sub(centre(at(0))).distanceTo(new THREE.Vector3(0, 0.01, 0)) < 1e-9, "10 mm up");
  assert.ok(centre(poseBox(t, [cap], lift, () => 1, () => up)).sub(centre(at(0))).distanceTo(new THREE.Vector3(0, 0.0724, 0)) < 1e-9, "moved, then lifted");
  const still = poseBox(t, [cap], lift, () => 0, () => null);
  assert.ok(still.min.distanceTo(own.min) < 1e-9 && still.max.distanceTo(own.max) < 1e-9, "a part the pose doesn't move");
  // Turned a quarter round the frame's z, the board's x across is what its y across was (the frame's y is the world's
  // -z), and it is longer one way than the other.
  const pcb = parts.get("pcb")!;
  const [w0, , d0] = new THREE.Box3().setFromObject(pcb.mesh).getSize(new THREE.Vector3()).toArray();
  const [w1, , d1] = poseBox(t, [pcb], lift, () => 0, () => new THREE.Matrix4().makeRotationZ(Math.PI / 2)).getSize(new THREE.Vector3()).toArray();
  assert.ok(Math.abs(w0 - d0) > 0.005, `the board is longer one way: ${[w0, d0]}`);
  assert.ok(Math.abs(w1 - d0) < 1e-9 && Math.abs(d1 - w0) < 1e-9, `turned: ${[w0, d0]} -> ${[w1, d1]}`);
  // Apart, the keypad is taller: its caps rise and its feet drop.
  const together = poseBox(t, all, lift, () => 0), apart = poseBox(t, all, lift, () => 1);
  assert.ok(apart.max.y - apart.min.y > 2 * (together.max.y - together.min.y));
  assert.ok(apart.containsBox(together));
  // Only the parts of a step shown: the bare board, then the board and its sockets, which hang below it.
  const upTo = (n: number) => poseBox(t, all, lift, (p: { id: string }) => (placeOf(view, p.id).step <= n ? 0 : null));
  const board = new THREE.Box3().setFromObject(parts.get("pcb")!.mesh);
  assert.ok(upTo(1).min.distanceTo(board.min) < 1e-9 && upTo(1).max.distanceTo(board.max) < 1e-9);
  assert.ok(upTo(2).min.y < board.min.y);

  // From under the keypad, the middle of the tray is what a pick finds; with the case as glass, what is in it.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 10);
  const f = frameOf(t, together, 1, 30, [0, -1, 0.001]);
  camera.position.copy(f.position);
  camera.lookAt(f.center);
  camera.near = f.near;
  camera.far = f.far;
  camera.updateProjectionMatrix();
  assert.equal(pickAt(t, camera, parts, 0, 0), "bot");
  const glass = new Set(["top", "bot"]);
  const through = pickAt(t, camera, parts, 0, 0, glass);
  assert.ok(through && !glass.has(through), `through the case: ${through}`);
  assert.equal(pickAt(t, camera, parts, 0, 0, new Set(["cap5"])), "bot", "skipping a part not hit changes nothing");
  // A part not drawn (a later step's) is never picked, though it is where the pick looks.
  parts.get("bot")!.mesh.visible = false;
  assert.equal(pickAt(t, camera, parts, 0, 0), through);
  parts.get("bot")!.mesh.visible = true;

  // The face a mark sits on: the top of a cap's box faces up, its side out; a geometry with no faces has none.
  const [x0, y0, z0, x1, y1, z1] = view.items.find((i) => i.id === "cap6")!.bbox!;
  const geometry = parts.get("cap6")!.mesh.geometry;
  const top = faceNear(t, geometry, new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, z1));
  assert.ok(top.d2 < 0.01 && top.normal!.z > 0.99, `the top: ${top.normal?.toArray()} at ${Math.sqrt(top.d2)} mm`);
  const side = faceNear(t, geometry, new THREE.Vector3(x1 + 0.5, (y0 + y1) / 2, (z0 + z1) / 2));
  assert.ok(side.normal!.x > 0.7, `the side, from outside it: ${side.normal?.toArray()}`);
  assert.deepEqual(faceNear(t, new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3)), new THREE.Vector3()), { d2: Infinity, normal: null });

  // A mark on a part a pose moves sits on the face where the pose has it: Ponder's head, pulled straight out forward,
  // is level, so the top of where it is faces up and its front faces ahead along the pull, though as built it is
  // over the page, tilted, somewhere else.
  const pv = modelView(copyOf("ponder", "mark-face"))!;
  const pglb = readFileSync(join(EXAMPLES, "ponder", pv.model.file));
  const pg = await new t.GLTFLoader().parseAsync(pglb.buffer.slice(pglb.byteOffset, pglb.byteOffset + pglb.byteLength), "");
  const meshes = new Map<string, { geometry: { attributes: { position: { count: number } } } }>();
  pg.scenes[0].traverse((o: { isMesh?: boolean; userData: { name?: string } }) => { if (o.isMesh && o.userData.name) meshes.set(o.userData.name, o as unknown as { geometry: { attributes: { position: { count: number } } } }); });
  const move = new THREE.Matrix4().set(...pv.poses[1].moved!.flat());
  const head = meshes.get("head-upper")!.geometry;
  const b = new THREE.Box3();
  for (let i = 0; i < head.attributes.position.count; i++) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(head.attributes.position as never, i).applyMatrix4(move));
  const drawnOf = (id: string) => (meshes.has(id) ? { geometry: meshes.get(id)!.geometry, move: pv.poses[1].drop.includes(id) ? move : null } : null);
  const onTop = markFaceOf(t, [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z], ["head-upper"], drawnOf);
  assert.ok(onTop && onTop.z > 0.99, `the moved head's top faces up: ${onTop?.toArray()}`);
  const ahead = markFaceOf(t, [(b.min.x + b.max.x) / 2, b.max.y + 0.5, (b.min.z + b.max.z) / 2], ["head-upper"], drawnOf);
  assert.ok(ahead && ahead.y > 0.9, `its front faces ahead along the pull: ${ahead?.toArray()}`);
  // A part the pose doesn't move is where the frame has it; the nearest of the parts named counts; one not drawn, none.
  const [bx0, by0, , bx1, by1, bz1] = pv.items.find((i) => i.id === "base-top")!.bbox!;
  const baseTop = [(bx0 + bx1) / 2, (by0 + by1) / 2, bz1];
  assert.deepEqual(markFaceOf(t, baseTop, ["base-top"], drawnOf)!.toArray(), faceNear(t, meshes.get("base-top")!.geometry, new THREE.Vector3(...baseTop)).normal!.toArray());
  assert.ok(markFaceOf(t, [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z], ["base-top", "head-upper"], drawnOf)!.z > 0.99);
  assert.equal(markFaceOf(t, baseTop, ["base-top"], () => null), null);
  assert.equal(markFaceOf(t, baseTop, [], drawnOf), null);
});

// ---- in Chromium, beside the drawing -------------------------------------------------------------------------------

/** What these tests use of Playwright, which the repo does not depend on: it is used where it is installed. */
type Point = { x: number; y: number };
type Tab = {
  on(event: "console", fn: (m: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", fn: (e: Error) => void): void;
  goto(url: string): Promise<unknown>;
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg?: A, opts?: { timeout?: number; polling?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  textContent(selector: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  isDisabled(selector: string): Promise<boolean>;
  click(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  hover(selector: string): Promise<void>;
  dispatchEvent(selector: string, type: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  $$eval<R>(selector: string, fn: (els: Element[]) => R): Promise<R>;
  emulateMedia(media: { reducedMotion?: "reduce" | "no-preference"; forcedColors?: "active" | "none" }): Promise<void>;
  screenshot(opts: { clip: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number, opts?: { steps: number }): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
  locator(selector: string): { count(): Promise<number>; boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> };
};
type Context = { newPage(): Promise<Tab>; addInitScript(fn: () => void): Promise<void>; close(): Promise<void> };
type Browser = { newContext(opts: { viewport: { width: number; height: number }; reducedMotion?: "reduce" | "no-preference" }): Promise<Context>; close(): Promise<void> };
type View3d = {
  apart: boolean; at: number; pinned: string | null; hover: string | null; line: string | null; spot: number[];
  toggles: { problems: boolean; xray: boolean; mass: boolean; probes: boolean };
  drawn: { marks: number[]; com: boolean; coms: number[]; parts: string[]; glass: string[]; ghosts: string[]; probes: number[] };
  probes(on?: boolean): boolean; showProbe(i: number): void; probe: number | null; probeLook(i: number): { color: string; opacity: number; behind: number } | null; inPlanes(at: number[]): boolean;
  colors: Record<string, string>;
  explode(on?: boolean): boolean; step(n: number): number; select(id: string | null): void; show(list: number | number[]): void; destroy(): void;
  marks(on?: boolean): boolean; xray(on?: boolean): boolean; mass(on?: boolean): boolean;
  pose(k?: number | string): number; posed: number; boxOf(id: string): number[] | null;
  strokeOf(id: string): { edges: number[] | null; ghost: number[] | null } | null;
  screenOf(id: string | number[]): Point | null;
};
type Fig = { step(n: number): void; explode(on?: boolean): void; select(line: string | null): void };
type W = { view3d: View3d; view3dReady?: { ok: boolean }; fig: Fig; events: [string, string, string][]; asked: number; pending: number; camera3d?: unknown;
  mountLate(): void; atMount: { count: string | null; apart: string | null } };

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

type Example = { view: ModelView; glb: Buffer; figure: unknown; svg: string; lines: Record<string, unknown> };
/** A page with the drawing and the 3D view of an example: each on its own card, with its own readout, the drawing's
 * scope taking in both (so the 3D view is the same figure in another view to it, as on one card, rather than a list
 * of steps elsewhere, which it scrolls to); or (?same) both on one card, as Fig 1's tabs will have them, the 3D view
 * leaving the card's readout to the drawing; ?scope=card keeps the drawing's scope to its own card, so the 3D view is
 * elsewhere on the page to it, as a list of the steps is. ?first=3d mounts the 3D view first; ?late=fig or ?late=3d mounts the other
 * view at once and that one only when the test calls mountLate(). The page is taller than the window, so it can
 * scroll; it records every a2:* event with the view it came from, and what the 3D view's bar says as it mounts. */
function page(name: string, q: URLSearchParams) {
  const css = k.ISO_CSS + readFileSync(join(SKILL, "viewer", "figure.css"), "utf8") + readFileSync(join(SKILL, "viewer", "model.css"), "utf8");
  const same = q.has("same");
  const fig = `<div id="fig"></div><div data-a2-controls></div>`, model = `<div id="m"></div>`;
  const cards = same ? `<section data-a2-figure id="card"><span data-readout>assembled</span>${fig}${model}</section>`
    : `<section data-a2-figure id="figcard"><span data-readout>assembled</span>${fig}</section><section data-a2-figure id="mcard"><span data-readout>assembled</span>${model}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css} body{margin:0} main{width:640px;margin:0 auto;padding:40px 0 150vh}</style>
<script type="importmap">{"imports":{"three":"/three/three.module.js","three/core":"/three/three.core.js","three/addons/":"/three/addons/"}}</script>
</head><body class="iso" data-theme="dark"><main>${cards}</main>
<script src="/figure.js"></script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountModel } from "/model.js";
const [view, glb, fig, svg, lines] = await Promise.all(["view.json", "system.glb", "figure.json", "figure.svg", "lines.json"]
  .map((f) => fetch("/${name}/" + f).then((r) => (f.endsWith(".glb") ? r.arrayBuffer() : f.endsWith(".svg") ? r.text() : r.json()))));
window.events = [];
for (const t of ["a2:select", "a2:hover", "a2:step", "a2:apart", "a2:ask"]) document.addEventListener(t, (e) =>
  window.events.push([t, e.target.closest("#m") ? "3d" : e.target.closest("#fig") ? "fig" : "page", JSON.stringify(e.detail)]));
document.getElementById("fig").innerHTML = svg;
const figure = () => { window.fig = mountFigure(document.getElementById("fig"), fig, lines, ${same ? "{}" : q.get("scope") === "card" ? '{ scope: document.getElementById("figcard") }' : '{ scope: document.querySelector("main") }'}); };
const model = () => {
  window.view3d = mountModel(document.getElementById("m"), view, glb, { THREE, OrbitControls, GLTFLoader }, ${same ? "{ readout: false }" : "{}"});
  window.atMount = { count: document.querySelector("#m .a2-count")?.textContent ?? null, apart: document.querySelector('#m [data-a2m="apart"]')?.textContent ?? null };
  window.view3d.ready.then((r) => { window.view3dReady = r; });
};
${q.get("late") === "fig" ? "model(); window.mountLate = figure;" : q.get("late") === "3d" ? "figure(); window.mountLate = model;"
    : q.get("first") === "3d" ? "model(); figure();" : "figure(); model();"}
</script></body></html>`;
}

function serve(examples: Record<string, Example>): Promise<Server> {
  const types: Record<string, string> = { js: "text/javascript", json: "application/json", glb: "model/gltf-binary", html: "text/html", svg: "image/svg+xml" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const send = (body: string | Buffer, type: string) => { res.writeHead(200, { "content-type": type }); res.end(body); };
    const [, name, file] = path.split("/");
    if (path === "/model.js") return send(readFileSync(join(SKILL, "viewer", "model.js")), types.js);
    if (path === "/figure.js") return send(readFileSync(join(SKILL, "viewer", "figure.js")), types.js);
    if (path.startsWith("/three/") && !path.includes("..")) return send(readFileSync(join(THREE_DIR, path.slice("/three/".length))), types.js);
    const x = Object.hasOwn(examples, name) ? examples[name] : undefined;
    if (x && !file) return send(page(name, url.searchParams), types.html);
    if (x && file === "view.json") return send(JSON.stringify(x.view), types.json);
    if (x && file === "system.glb") return send(x.glb, types.glb);
    if (x && file === "figure.json") return send(JSON.stringify(x.figure), types.json);
    if (x && file === "figure.svg") return send(x.svg, types.svg);
    if (x && file === "lines.json") return send(JSON.stringify(x.lines), types.json);
    res.writeHead(404);
    res.end();
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** An example as the page serves it, its check of the files as they are (a copy lacks the board's zip). */
function example(slug: string): Example {
  const dir = copyOf(slug, `browser-${slug}`);
  const view = { ...modelView(dir)!, stale: [] };
  const bom = json<Bom>(join(dir, "bom.json"));
  return { view, glb: readFileSync(join(dir, view.model.file)), figure: json(join(dir, "figure.json")), svg: readFileSync(join(dir, "figure.svg"), "utf8"),
    lines: Object.fromEntries(bom.lines.map((l) => [l.id, l])) };
}

/** The keypad with a problem planted in the middle of the top of its keycap nearest the camera (which looks from +x and
 * -y in the frame): its mark sits on a face seen at a slant. */
function planted(keypad: Example): Example {
  const mid = (b: number[]) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2];
  const cap = keypad.view.items.filter((i) => i.line === "cap").sort((a, b) => (mid(b.bbox!)[0] - mid(b.bbox!)[1]) - (mid(a.bbox!)[0] - mid(a.bbox!)[1]))[0];
  const [x, y] = mid(cap.bbox!);
  return { ...keypad, view: variant(keypad.view, (v) => {
    v.problems.push({ gate: "clearance", title: "Clearance", text: "planted on the keycap's top", parts: [cap.id], at: [x, y, cap.bbox![5]], accepted: false, pose: null });
  }) };
}

test("in Chromium, beside the drawing: apart, the steps, the line, the hash, marks, X-ray and mass", async (t) => {
  const keypad = example("macropad"), ponder = example("ponder");
  const must = process.env.SPRUE_BROWSER_TESTS === "1";
  const { browser, why } = await chromium();
  if (!browser) return must ? assert.fail(why) : t.skip(why);
  let server: Server | undefined;
  try {
    const plant = planted(keypad);
    // Pulled straight out backward, it doesn't say where the head goes, nor weigh it; forward, the head goes 2 m on.
    const odd = { ...ponder, view: variant(ponder.view, (v) => { v.poses[2].moved = null; v.poses[2].mass = null; v.poses[1].moved![1][3] += 2000; }) };
    // With no poses (as an earlier Sprue's system.json), the radio's keep-out falling short with a reason, and whether
    // the first port passes not said.
    const probed = { ...ponder, view: variant(ponder.view, (v) => {
      v.poses = [];
      for (const i of v.probes[v.probes.length - 1].problems) v.problems[i].accepted = true;
      v.probes[1].ok = null;
    }) };
    // As a drawing whose calls don't say where their parts are: the nuts, inserts and screws can't follow it.
    const blind = { ...ponder, view: variant(ponder.view, (v) => {
      v.assembly = assemblyOf({ ...(ponder.figure as object), parts: (ponder.figure as Figure).parts.map((p) => ({ ...p, at: undefined })) }, v.items);
    }) };
    server = await serve({ keypad, ponder, planted: plant, odd, probed, blind });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const probe = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const gl = await (await probe.newPage()).evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    await probe.close();
    if (!gl) return must ? assert.fail("this Chromium has no WebGL 2") : t.skip("this Chromium has no WebGL 2");

    /** The frames the page has asked for, and how many it is waiting on, counted by an init script. */
    const countFrames = () => {
      const w = window as unknown as { asked: number; pending: number };
      w.asked = 0;
      w.pending = 0;
      const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
      const waiting = new Set<number>();
      window.requestAnimationFrame = (fn) => {
        w.asked++;
        w.pending++;
        const id = raf((time) => { waiting.delete(id); w.pending--; fn(time); });
        waiting.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => { if (waiting.delete(id)) w.pending--; cancel(id); };
    };
    /** A tab on an example's page, once the 3D view is ready, with what its console says of errors. */
    const open = async (name: string, { query = "", hash = "", motion = false, ready = true } = {}) => {
      const context = await browser.newContext({ viewport: { width: 760, height: 700 }, reducedMotion: motion ? "no-preference" : "reduce" });
      await context.addInitScript(countFrames);
      const tab = await context.newPage();
      const said: string[] = [];
      tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") said.push(`${m.type()}: ${m.text()}`); });
      tab.on("pageerror", (e) => said.push(`pageerror: ${e.message}`));
      await tab.goto(`${base}/${name}${query ? `?${query}` : ""}${hash}`);
      if (!ready) {
        // window.fig is the page's #fig element until the drawing is mounted there.
        await tab.waitForFunction(() => typeof (window as unknown as W).fig?.step === "function" || (window as unknown as W).view3d, undefined, { timeout: 60000 });
        return { context, tab, said };
      }
      await tab.waitForFunction(() => (window as unknown as W).view3dReady, undefined, { timeout: 60000 });
      await idle(tab);
      await top(tab);
      return { context, tab, said };
    };
    /** Waits until the page waits on no frame, however slowly frames come: the parts and the camera are still. */
    const idle = (tab: Tab) => tab.waitForFunction(() => (window as unknown as W).pending === 0, undefined, { timeout: 90000, polling: 50 });
    /** How many frames the page asks for in the half second after it is idle. */
    const asks = async (tab: Tab) => {
      await idle(tab);
      const before = await tab.evaluate(() => (window as unknown as W).asked);
      await tab.waitForTimeout(500);
      return (await tab.evaluate(() => (window as unknown as W).asked)) - before;
    };
    const v3 = <R>(tab: Tab, fn: (v: View3d) => R) => tab.evaluate((src) => new Function("v", `return (${src})(v)`)((window as unknown as W).view3d) as R, fn.toString());
    const state = (tab: Tab) => v3(tab, (v) => ({ apart: v.apart, at: v.at, pinned: v.pinned, line: v.line, spot: v.spot, toggles: v.toggles, drawn: v.drawn }));
    const screenOf = (tab: Tab, id: string | number[]) => tab.evaluate((id) => (window as unknown as W).view3d.screenOf(id), id);
    /** Scrolls the model to the top of the window, where a click or a screenshot at a point of it lands on it. */
    const top = (tab: Tab) => tab.evaluate(() => document.querySelector("#m .a2-model-stage")!.scrollIntoView({ block: "start" }));
    /** Where a part or a point is on the page with the model in the window. */
    const inView = async (tab: Tab, id: string | number[]) => { await top(tab); return screenOf(tab, id); };
    const events = (tab: Tab) => tab.evaluate(() => (window as unknown as W).events.splice(0));
    /** How high the caps stand over the board, as a share of how far apart the corner caps are: the same at any zoom. */
    const rise = async (tab: Tab) => {
      const [c, b, a, z] = await Promise.all(["cap5", "pcb", "cap1", "cap9"].map((id) => screenOf(tab, id)));
      return Math.hypot(c!.x - b!.x, c!.y - b!.y) / Math.hypot(a!.x - z!.x, a!.y - z!.y);
    };
    // The apart buttons say what they do ("Put together"), so they aren't toggles: data-on is how they look pressed.
    const isOn = async (tab: Tab, selector: string) => String((await tab.getAttribute(selector, "data-on")) !== null);
    const figApart = (tab: Tab) => isOn(tab, '#fig ~ [data-a2-controls] [data-a2="apart"], [data-a2-controls] [data-a2="apart"]');
    const figCount = (tab: Tab) => tab.textContent('[data-a2-controls] [data-a2="count"]');
    const readout3d = (tab: Tab) => tab.textContent("#mcard [data-readout]");
    /** The pixels of a box of the page, as RGBA bytes. */
    const pixels = async (tab: Tab, clip: { x: number; y: number; width: number; height: number }) => {
      const png = await tab.screenshot({ clip });
      return tab.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        c.drawImage(bmp, 0, 0);
        return [...c.getImageData(0, 0, bmp.width, bmp.height).data];
      }, png.toString("base64"));
    };
    /** How many pixels two shots of one box differ in, by more than a little in any channel. */
    const differ = (a: number[], b: number[]) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 12) n++;
      return n;
    };
    /** The box round a part's top on the page, a few px larger. */
    const boxOf = async (tab: Tab, view: ModelView, id: string) => {
      const [x0, y0, , x1, y1, z1] = view.items.find((i) => i.id === id)!.bbox!;
      const ps = (await Promise.all([[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map(([x, y]) => screenOf(tab, [x, y, z1])))) as Point[];
      const x = Math.min(...ps.map((q) => q.x)) - 3, y = Math.min(...ps.map((q) => q.y)) - 3;
      return { x, y, width: Math.max(...ps.map((q) => q.x)) + 3 - x, height: Math.max(...ps.map((q) => q.y)) + 3 - y };
    };
    /** The share of a disc of radius `r` px round a point that is about as red as its reddest pixel. */
    const redShare = async (tab: Tab, p: Point, r: number) => {
      const w = 2 * Math.ceil(r) + 1;
      const d = await pixels(tab, { x: Math.round(p.x) - Math.ceil(r), y: Math.round(p.y) - Math.ceil(r), width: w, height: w });
      const red = [];
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        if (Math.hypot(x - (w - 1) / 2, y - (w - 1) / 2) > r) continue;
        const i = 4 * (y * w + x);
        red.push(d[i] - Math.max(d[i + 1], d[i + 2]));
      }
      const most = Math.max(...red);
      return { share: red.filter((v) => v >= 0.75 * most).length / red.length, most };
    };
    /** The reddest a mark is, round a point: the most red is over green and blue, 0 to 255, in a few px of it. */
    const redAt = async (tab: Tab, p: Point) => {
      const png = await tab.screenshot({ clip: { x: p.x - 6, y: p.y - 6, width: 13, height: 13 } });
      return tab.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        c.drawImage(bmp, 0, 0);
        const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
        let most = 0;
        for (let i = 0; i < d.length; i += 4) most = Math.max(most, d[i] - Math.max(d[i + 1], d[i + 2]));
        return most;
      }, png.toString("base64"));
    };

    await t.test("the keypad comes apart and goes back together, the drawing with it, each saying so once", async () => {
      const { context, tab, said } = await open("keypad", { motion: true });
      await events(tab);
      const together = await rise(tab);
      await tab.click('#m [data-a2m="apart"]');
      await tab.waitForFunction(() => document.querySelector("#mcard [data-readout]")!.textContent === "taking apart", undefined, { timeout: 30000, polling: 10 });
      await idle(tab);
      assert.equal(await readout3d(tab), "apart · 44 parts");
      const apart = await rise(tab);
      assert.ok(apart > together * 2, `the caps rise: ${together.toFixed(2)} -> ${apart.toFixed(2)}`);
      assert.deepEqual([await isOn(tab, '#m [data-a2m="apart"]'), await tab.textContent('#m [data-a2m="apart"]')], ["true", "Put together"]);
      assert.equal(await tab.getAttribute('#m [data-a2m="apart"]', "aria-pressed"), null, "a button that says what it does is no toggle");
      assert.equal(await figApart(tab), "true", "the drawing comes apart too");
      assert.equal(await tab.textContent("#m .a2-model-say"), "Apart · 44 parts", "said to a screen reader");
      assert.deepEqual(await events(tab), [["a2:apart", "3d", '{"on":true}']], "said once, not said back");
      assert.equal(await asks(tab), 0, "still once it is apart");
      // E puts it together again, from the view.
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.ok(Math.abs((await rise(tab)) - together) < 0.02 * together, "back in place");
      assert.equal(await figApart(tab), "false");
      assert.equal(await tab.textContent("#m .a2-model-say"), "Put together");
      assert.deepEqual(await events(tab), [["a2:apart", "3d", '{"on":false}']]);
      // The drawing's own button takes both apart, and the view says nothing back.
      await tab.click('[data-a2-controls] [data-a2="apart"]');
      await idle(tab);
      assert.equal((await state(tab)).apart, true);
      assert.ok((await rise(tab)) > together * 2);
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:apart"), [["a2:apart", "fig", '{"on":true}']]);
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("reduced motion jumps: apart at once, with no word for the parts moving", async () => {
      const { context, tab, said } = await open("keypad");
      const together = await rise(tab);
      await tab.click('#m [data-a2m="apart"]');
      assert.equal(await readout3d(tab), "apart · 44 parts", "no 'taking apart' in between");
      assert.ok((await rise(tab)) > together * 2, "the caps up as soon as it is clicked, with no frame between");
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("the steps: earlier parts in place, later ones gone and never picked, the stepper and readout say where, and the drawing follows", async () => {
      const { context, tab, said } = await open("keypad");
      const steps = keypad.view.assembly!.steps;
      assert.deepEqual(await tab.evaluate(() => (window as unknown as W).atMount), { count: "9 steps", apart: "Take apart" }, "the bar says where it is before the model loads");
      assert.equal(await tab.textContent('#m [data-a2m="prev"] ~ .a2-count'), "9 steps");
      assert.equal(await tab.isDisabled('#m [data-a2m="prev"]'), true);
      await events(tab);
      for (let i = 0; i < 3; i++) await tab.click('#m [data-a2m="next"]');
      await idle(tab);
      assert.equal((await state(tab)).at, 3);
      assert.equal(await tab.textContent("#m .a2-count"), "Step 3 / 9");
      assert.equal(await tab.textContent("#m .a2-step-text"), steps[2].text);
      assert.equal(await readout3d(tab), `Step 3 of 9 · ${steps[2].text}`);
      assert.equal(await figCount(tab), "Step 3 / 9", "the drawing walks with it");
      assert.deepEqual([await tab.getAttribute("#m .a2-step-text", "aria-live"), await tab.getAttribute('[data-a2-controls] [data-a2="text"]', "aria-live")],
        ["polite", "off"], "the step's text is read out once, by the view that walked");
      assert.deepEqual((await events(tab)).map((e) => e.slice(0, 2)), [["a2:step", "3d"], ["a2:step", "3d"], ["a2:step", "3d"]], "the drawing doesn't say it back");
      const pico = (await inView(tab, "ctrl"))!;
      await tab.mouse.click(pico.x, pico.y + 2);
      assert.equal((await state(tab)).pinned, "ctrl", "the Pico, put on at step 3, is picked");
      await tab.mouse.move(5, 5);
      // A part pinned from the list that goes on later says when.
      await tab.selectOption("#m .a2-model-select", "cap5");
      assert.equal(await tab.textContent("#m [data-later]"), "Not shown at step 3: it goes on at step 8");
      // ] walks on and lets go of what was pinned, from anywhere in the view but the list.
      await tab.focus('#m [data-a2m="fit"]');
      await tab.keyboard.press("]");
      assert.deepEqual([(await state(tab)).at, (await state(tab)).pinned], [4, null]);
      await tab.keyboard.press("[");
      assert.equal((await state(tab)).at, 3);
      // Home and End only from the model itself.
      await tab.keyboard.press("End");
      assert.equal((await state(tab)).at, 3);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("End");
      assert.equal((await state(tab)).at, 9);
      assert.equal(await tab.isDisabled('#m [data-a2m="next"]'), true);
      await tab.keyboard.press("Home");
      assert.equal((await state(tab)).at, 0);
      assert.equal(await readout3d(tab), "3D · 44 parts");
      assert.equal(await tab.textContent("#m .a2-model-say"), "The whole product");
      // [ and ] typed with Option (Alt) or AltGr (Ctrl and Alt) still walk; with Ctrl alone, or a letter with Alt, nothing.
      const key = (init: Record<string, unknown>) => tab.evaluate((init) => {
        document.querySelector("#m .a2-model-stage")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      }, init);
      await key({ key: "]", altKey: true });
      assert.equal((await state(tab)).at, 1, "Option ]");
      await key({ key: "]", altKey: true, ctrlKey: true, modifierAltGraph: true });
      assert.equal((await state(tab)).at, 2, "AltGr ]");
      await key({ key: "]", ctrlKey: true });
      await key({ key: "]", metaKey: true });
      await key({ key: "e", altKey: true });
      assert.deepEqual([(await state(tab)).at, (await state(tab)).apart], [2, false], "not Ctrl ], ⌘ ] or Alt E");
      await key({ key: "[", altKey: true });
      assert.equal((await state(tab)).at, 1);
      // A stepper button that goes to an end and is disabled there gives the focus to the other.
      for (let i = 0; i < 8; i++) await tab.click('#m [data-a2m="next"]');
      assert.deepEqual([(await state(tab)).at, await tab.evaluate(() => document.activeElement!.getAttribute("data-a2m"))], [9, "prev"]);
      for (let i = 0; i < 9; i++) await tab.click('#m [data-a2m="prev"]');
      assert.deepEqual([(await state(tab)).at, await tab.evaluate(() => document.activeElement!.getAttribute("data-a2m"))], [0, "next"]);
      for (let i = 0; i < 9; i++) await tab.click('[data-a2-controls] [data-a2="next"]');
      assert.equal(await tab.evaluate(() => document.activeElement!.getAttribute("data-a2")), "prev", "the drawing's stepper too");
      for (let i = 0; i < 9; i++) await tab.click('[data-a2-controls] [data-a2="prev"]');
      assert.equal(await tab.evaluate(() => document.activeElement!.getAttribute("data-a2")), "next");
      // The drawing's stepper walks the view, which doesn't say it back.
      await events(tab);
      await tab.click('[data-a2-controls] [data-a2="next"]');
      await tab.click('[data-a2-controls] [data-a2="next"]');
      await idle(tab);
      assert.equal((await state(tab)).at, 2);
      assert.deepEqual((await events(tab)).map((e) => e.slice(0, 2)), [["a2:step", "fig"], ["a2:step", "fig"]]);
      assert.deepEqual([await tab.getAttribute("#m .a2-step-text", "aria-live"), await tab.getAttribute('[data-a2-controls] [data-a2="text"]', "aria-live")],
        ["off", "polite"]);
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("a line chosen in the drawing lights its parts with the line's panel; a part pinned in 3D tells the drawing its line; hover goes both ways", async () => {
      const { context, tab, said } = await open("keypad");
      await events(tab);
      await tab.dispatchEvent('#fig .a2-part[data-line="cap"]', "click");
      let s = await state(tab);
      assert.deepEqual([s.line, s.pinned], ["cap", null]);
      assert.equal(await tab.getAttribute("#m .a2-model-panel", "aria-label"), "The line chosen");
      assert.equal(await tab.textContent("#m .a2-model-title"), keypad.view.lines.cap.name);
      assert.equal(await tab.evaluate(() => document.querySelectorAll("#m .a2-model-parts [data-a2m-pick]").length), 9);
      assert.equal(await readout3d(tab), "Keycap · 9 parts · bought");
      assert.deepEqual((s.drawn.ghosts as string[]).sort(), partsOfLine(keypad.view, "cap").sort(), "the line's parts show through what hides them");
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:select").map((e) => e[1]), ["fig"]);
      // One of its parts, picked in the panel: the drawing keeps the line, told by the view.
      await tab.click('#m .a2-model-parts [data-a2m-pick="cap4"]');
      s = await state(tab);
      assert.deepEqual([s.line, s.pinned, s.drawn.ghosts], [null, "cap4", ["cap4"]]);
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:select"), [["a2:select", "3d", '{"line":"cap","part":"cap4"}']]);
      const capName = keypad.view.lines.cap.name;
      assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(capName), "the drawing keeps the line");
      // A line of one part, chosen in the drawing, pins that part (a cap covers the board in the drawing: the click
      // goes to the board's own drawing).
      await tab.dispatchEvent('#fig .a2-part[data-line="pcb"]', "click");
      s = await state(tab);
      assert.deepEqual([s.line, s.pinned], [null, "pcb"]);
      // Hover in the drawing lights the line in 3D; hover in 3D lights the part's line in the drawing.
      await tab.dispatchEvent('#fig .a2-part[data-line="sw"]', "pointerover");
      assert.equal(await tab.evaluate(() => (window as unknown as W).events.some((e) => e[0] === "a2:hover" && e[1] === "fig" && e[2].includes('"sw"'))), true);
      assert.deepEqual([...(await state(tab)).drawn.ghosts].sort(), ["pcb", ...partsOfLine(keypad.view, "sw")].sort(), "the line pointed at in the drawing shows through, with the part pinned");
      await tab.dispatchEvent("#fig svg", "pointerleave");
      assert.deepEqual((await state(tab)).drawn.ghosts, ["pcb"], "and stops when the pointer leaves the drawing");
      await tab.click("#m [data-a2m=\"clear\"]");
      await events(tab);
      const cap = (await inView(tab, "cap7"))!;
      await tab.mouse.move(cap.x, cap.y + 3, { steps: 3 });
      await tab.waitForFunction(() => (window as unknown as W).view3d.hover === "cap7", undefined, { timeout: 30000 });
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:hover").at(-1), ["a2:hover", "3d", '{"line":"cap","part":"cap7"}']);
      assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(capName), "the drawing says the line pointed at");
      assert.deepEqual((await state(tab)).drawn.ghosts, [], "not the part under the pointer, which nothing hides");
      // Gone, the view lets go of what it pointed at, so the drawing doesn't keep the line lit.
      await events(tab);
      await v3(tab, (v) => v.destroy());
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:hover"), [["a2:hover", "3d", '{"line":null,"part":null}']]);
      assert.ok(!(await tab.textContent("#figcard [data-readout]"))!.startsWith(capName), "the drawing's readout lets go");
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("on one card the views keep one pose, without scrolling the page or taking the focus", async () => {
      const { context, tab, said } = await open("keypad", { query: "same" });
      await tab.focus("#m .a2-model-stage");
      await tab.evaluate(() => scrollTo(0, 120));
      const y = await tab.evaluate(() => scrollY);
      await tab.keyboard.press("]");
      await tab.keyboard.press("]");
      await idle(tab);
      assert.equal(await figCount(tab), "Step 2 / 9");
      assert.equal(await tab.evaluate(() => document.activeElement!.className), "a2-model-stage");
      assert.equal(await tab.evaluate(() => scrollY), y, "the page stays where it was");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.equal(await figApart(tab), "true");
      await tab.evaluate(() => (window as unknown as W).fig.step(5));
      await idle(tab);
      assert.equal((await state(tab)).at, 5);
      assert.equal(await tab.evaluate(() => scrollY), y);
      // One readout, the drawing's: a part pinned in 3D shows as its line there, not as the 3D view's own words.
      await tab.selectOption("#m .a2-model-select", "cap4");
      const card = (await tab.textContent("#card [data-readout]"))!;
      assert.ok(card.startsWith(keypad.view.lines.cap.name) && card !== readoutOf(keypad.view, "cap4"), card);
      // and what only the 3D view does (the X-ray) leaves it as it is.
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("x");
      await idle(tab);
      assert.equal(await tab.textContent("#card [data-readout]"), card);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("the hash starts both views in its pose and they follow it, whichever reads it first", async () => {
      // With the drawing's scope its own card too, where a step from the 3D view would be one from elsewhere on the page,
      // which lets go of its line: the 3D view reads the hash itself, so it doesn't tell the drawing the pose it read.
      for (const query of ["", "first=3d", "first=3d&scope=card"]) {
        const { context, tab, said } = await open("keypad", { query, hash: "#apart&step=3&part=ctrl" });
        let s = await state(tab);
        assert.deepEqual([s.apart, s.at, s.pinned], [true, 3, "ctrl"], query);
        assert.deepEqual([await figApart(tab), await figCount(tab)], ["true", "Step 3 / 9"], query);
        await tab.evaluate(() => { location.hash = "#select=cap"; });
        await tab.waitForFunction(() => (window as unknown as W).view3d.line === "cap", undefined, { timeout: 30000 });
        s = await state(tab);
        assert.deepEqual([s.apart, s.at, s.pinned, s.line], [false, 0, null, "cap"], query);
        assert.equal(await figApart(tab), "false");
        // A part the hash names is the view's: it tells the drawing its line.
        await tab.evaluate(() => { location.hash = "#part=sw5"; });
        await tab.waitForFunction(() => (window as unknown as W).view3d.pinned === "sw5", undefined, { timeout: 30000 });
        assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(keypad.view.lines.sw.name), `${query}: the drawing has the switch's line`);
        // A step and a part: each view goes to the step, and neither lets go of the part as the other says the step.
        for (const hash of ["#step=3&part=sw5", "#part=ctrl&step=4"]) {
          await tab.evaluate((h) => { location.hash = h; }, hash);
          await tab.waitForFunction((n) => (window as unknown as W).view3d.at === n, hash.includes("4") ? 4 : 3, { timeout: 30000 });
          await idle(tab);
          const part = hash.includes("ctrl") ? "ctrl" : "sw5";
          s = await state(tab);
          assert.deepEqual([s.at, s.pinned], [hash.includes("4") ? 4 : 3, part], `${query} ${hash}`);
          assert.equal(await figCount(tab), `Step ${s.at} / 9`, `${query} ${hash}`);
          assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(keypad.view.lines[part === "ctrl" ? "ctrl" : "sw"].name), `${query} ${hash}: the drawing keeps the line`);
        }
        assert.deepEqual(said, [], query);
        await context.close();
        const opened = await open("keypad", { query, hash: "#step=3&part=sw5" });
        s = await state(opened.tab);
        assert.deepEqual([s.at, s.pinned], [3, "sw5"], `${query}: as the page opens`);
        assert.equal(await figCount(opened.tab), "Step 3 / 9");
        assert.ok((await opened.tab.textContent("#figcard [data-readout]"))!.startsWith(keypad.view.lines.sw.name), `${query}: the drawing has the line as it opens`);
        assert.deepEqual(opened.said, [], query);
        await opened.context.close();
      }
    });

    await t.test("Escape lets go of the marks shown, then the part, then the line, then the pose", async () => {
      const { context, tab, said } = await open("ponder");
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("]");
      await tab.keyboard.press("]");
      await tab.selectOption("#m .a2-model-select", "head-upper");
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("Escape");
      assert.deepEqual([(await state(tab)).pinned, (await state(tab)).at], [null, 2]);
      await tab.keyboard.press("Escape");
      assert.equal((await state(tab)).at, 0);
      // Show from a part's panel keeps the part; Escape lets go of the marks first.
      await tab.selectOption("#m .a2-model-select", "head-upper");
      await tab.click("#m .a2-model-panel [data-a2m-show]");
      assert.deepEqual([(await state(tab)).spot, (await state(tab)).pinned], [[panelOf(ponder.view, "head-upper")!.problems[0].i], "head-upper"]);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("Escape");
      assert.deepEqual([(await state(tab)).spot, (await state(tab)).pinned], [[], "head-upper"]);
      await tab.keyboard.press("Escape");
      assert.equal((await state(tab)).pinned, null);
      // A line chosen elsewhere on the page (a BOM row), with the parts apart: the line goes first.
      await tab.keyboard.press("e");
      await tab.evaluate(() => document.querySelector("main")!.dispatchEvent(new CustomEvent("a2:select", { detail: { line: "scr25" }, bubbles: true })));
      assert.deepEqual([(await state(tab)).line, (await state(tab)).apart], ["scr25", true]);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("Escape");
      assert.deepEqual([(await state(tab)).line, (await state(tab)).apart], [null, true]);
      await tab.keyboard.press("Escape");
      assert.equal((await state(tab)).apart, false);
      assert.equal(await tab.textContent("#m .a2-model-say"), "The whole product, put together");
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("Ponder's marks: shown while their parts are in place, faint behind a part, toggled by P, and Show frames them", async () => {
      const { context, tab, said } = await open("ponder");
      // As built, every mark but the 4 risks of the arm pulled straight out, which are marked in their poses.
      const all = marksOf(ponder.view).filter((m) => markInPose(ponder.view, m, 0)).map((m) => m.i);
      assert.equal(all.length, 12);
      let s = await state(tab);
      assert.deepEqual([s.toggles.problems, s.drawn.marks], [true, all], "on at the start, every mark of the product as built");
      assert.equal(await tab.getAttribute('#m [data-a2m="problems"]', "aria-pressed"), "true");
      assert.equal(await tab.textContent("#m .a2-model-legend > p:nth-last-child(2)"),
        " 10 problems 6 accepted risks marked where the check found them, while their parts are in place; faint where a part hides one; 4 of them in another pose, marked while the Pose list shows it.");
      assert.doesNotMatch((await tab.textContent("#m .a2-model-legend"))!, /Not marked/);
      // Every problem's mark shows red, at least faint where a part hides it; with the case as glass, none is fainter
      // and one the case alone hid is as red as itself; with Problems off, none shows. (A risk's mark is grey.)
      await top(tab);
      const red = all.filter((i) => !ponder.view.problems[i].accepted);
      const points = await Promise.all(red.map((i) => screenOf(tab, ponder.view.problems[i].at!)));
      const reds = async () => {
        await top(tab);
        const out: number[] = [];
        for (const p of points) out.push(await redAt(tab, p!));
        return out;
      };
      const before = await reds();
      assert.ok(before.every((r) => r > 30), `every mark shows: ${before}`);
      // A part pinned that a mark doesn't name tones the mark down, as it does the other parts.
      const j = before.indexOf(Math.max(...before)), mark = ponder.view.problems[red[j]];
      const centre = (id: string) => { const b = ponder.view.items.find((i) => i.id === id)!.bbox!; return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; };
      const markParts = new Set(marksOf(ponder.view).flatMap((m) => m.parts));
      const other = ponder.view.items.filter((i) => i.bbox && !markParts.has(i.id))
        .sort((a, b) => Math.hypot(...centre(b.id).map((c, k) => c - mark.at![k])) - Math.hypot(...centre(a.id).map((c, k) => c - mark.at![k])))[0].id;
      await v3(tab, (v) => v.select(null));
      await tab.evaluate((id) => (window as unknown as W).view3d.select(id), other);
      await idle(tab);
      await top(tab);
      const dimmed = await redAt(tab, points[j]!);
      assert.ok(dimmed < before[j] * 0.8, `toned down with ${other} pinned: ${before[j]} -> ${dimmed}`);
      await v3(tab, (v) => v.select(null));
      await idle(tab);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("x");
      await idle(tab);
      const glass = await reds();
      assert.ok(glass.every((r, j) => r >= before[j] - 3), `none fainter through the glass: ${before} -> ${glass}`);
      assert.ok(glass.some((r, j) => before[j] < 90 && r > 110), `one the case hid shows as red as itself: ${before} -> ${glass}`);
      await tab.keyboard.press("p");
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.toggles.problems, s.drawn.marks], [false, []]);
      const none = await reds();
      assert.ok(none.every((r) => r < 15), `no mark: ${none}`);
      assert.equal(await tab.textContent("#m .a2-model-say"), "Problems not marked");
      await tab.keyboard.press("p");
      assert.equal(await tab.textContent("#m .a2-model-say"), "Marked: 10 problems and 2 accepted risks, 4 in another pose");
      await tab.keyboard.press("x");
      // Apart, the marks' parts aren't where the check found them.
      await tab.keyboard.press("e");
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.marks, []);
      await tab.keyboard.press("e");
      // At a step, the marks whose parts are all in place: never one of no one part, which is of the whole product.
      await tab.evaluate(() => (window as unknown as W).view3d.step(6));
      await idle(tab);
      const sixth = ponder.view.assembly!.steps[5].n;
      const placedBy = marksOf(ponder.view).filter((m) => m.parts.length && m.parts.every((id) => placeOf(ponder.view, id).step <= sixth)).map((m) => m.i);
      assert.ok(placedBy.length > 0 && placedBy.length < all.length, `some, not all: ${placedBy}`);
      assert.deepEqual((await state(tab)).drawn.marks, placedBy);
      // Show for a mark whose parts the step has in place keeps the step.
      await tab.evaluate((i) => (window as unknown as W).view3d.show(i), placedBy[0]);
      await idle(tab);
      assert.deepEqual([(await state(tab)).at, (await state(tab)).spot], [6, [placedBy[0]]]);
      // Show on a failing gate's row: the whole product again, the camera close on its marks, them and their parts lit.
      // From the whole product framed, taken apart.
      await tab.evaluate(() => (window as unknown as W).view3d.step(0));
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("f");
      await idle(tab);
      const clearance = marksOf(ponder.view).filter((m) => m.gate === "clearance").map((m) => m.i);
      const spread = async () => {
        const ps = await Promise.all(clearance.slice(1, 4).map((i) => screenOf(tab, ponder.view.problems[i].at!)));
        return Math.hypot(ps[0]!.x - ps[2]!.x, ps[0]!.y - ps[2]!.y);
      };
      const far = await spread();
      await tab.keyboard.press("e");
      await idle(tab);
      await tab.click('#m .a2-model-panel [data-failing] [data-a2m-show]');
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.apart, s.at, s.spot], [false, 0, clearance]);
      // Its marks spread over the whole product, so it frames them about as Fit does: each in the view.
      const stage = await tab.evaluate(() => { const r = document.querySelector("#m .a2-model-stage")!.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      for (const i of clearance) {
        const q = (await screenOf(tab, ponder.view.problems[i].at!))!;
        assert.ok(q.x > stage.l && q.x < stage.r && q.y > stage.t && q.y < stage.b, `mark ${i} in the view: ${JSON.stringify(q)} in ${JSON.stringify(stage)}`);
      }
      assert.ok((await spread()) > far * 0.9, `not framed farther off than the whole product: ${far} -> ${await spread()}`);
      assert.equal(await readout3d(tab), "6 problems · clearance");
      const named = [...new Set(clearance.flatMap((i) => ponder.view.problems[i].parts))].sort();
      assert.deepEqual([...s.drawn.ghosts].sort(), named, "their parts lit, edges through what hides them");
      // A problem's own Show, on a part's panel, frames its one mark close; then a pose change lets go of the marks.
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("f");
      await idle(tab);
      const at12 = ponder.view.problems[12].at!;
      const across = async () => {
        const [a, b] = await Promise.all([screenOf(tab, at12), screenOf(tab, [at12[0] + 5, at12[1], at12[2]])]);
        return Math.hypot(a!.x - b!.x, a!.y - b!.y);
      };
      const whole = await across();
      await tab.selectOption("#m .a2-model-select", "scr25-4");
      await tab.click("#m .a2-model-panel [data-a2m-show]");
      await idle(tab);
      assert.deepEqual((await state(tab)).spot, [12]);
      assert.ok((await across()) > whole * 2, `5 mm at its mark, framed: ${whole} -> ${await across()} px`);
      assert.equal(await readout3d(tab), readoutOf(ponder.view, "scr25-4"), "the pinned part keeps the readout");
      await tab.evaluate(() => (window as unknown as W).view3d.step(1));
      assert.deepEqual((await state(tab)).spot, []);
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("the X-ray: the case is glass and a click goes through it; the Mass: the whole product's centre, only while it is whole", async () => {
      const { context, tab, said } = await open("keypad");
      assert.equal(await tab.isVisible('#m [data-a2m="problems"]'), false, "no Problems for a keypad with none");
      // Points of the top of the Pico's box, and what the pointer is over at each: without the X-ray and with it.
      const [x0, y0, , x1, y1, z1] = keypad.view.items.find((i) => i.id === "ctrl")!.bbox!;
      const grid = [0.2, 0.35, 0.5, 0.65, 0.8].flatMap((fx) => [0.2, 0.35, 0.5, 0.65, 0.8].map((fy) => [x0 + fx * (x1 - x0), y0 + fy * (y1 - y0), z1]));
      const under = async () => {
        const out: (string | null)[] = [];
        for (const at of grid) {
          const p = (await inView(tab, at))!;
          await tab.mouse.move(p.x, p.y);
          await idle(tab);
          out.push(await v3(tab, (v) => v.hover));
        }
        await tab.mouse.move(5, 5);
        return out;
      };
      const plain = await under();
      await tab.click('#m [data-a2m="xray"]');
      let s = await state(tab);
      assert.deepEqual([s.toggles.xray, s.drawn.glass], [true, ["top", "bot"]]);
      assert.equal(await tab.getAttribute('#m [data-a2m="xray"]', "aria-pressed"), "true");
      const glassy = await under();
      assert.ok(glassy.every((id) => id !== "top" && id !== "bot"), `the glass is never what the pointer is over: ${glassy}`);
      const j = plain.findIndex((id, i) => (id === "top" || id === "bot") && glassy[i] === "ctrl");
      assert.ok(j >= 0, `a point of the Pico the case hides, and it through the glass: ${plain} / ${glassy}`);
      // A click there pins the Pico through the glass, and the case without it.
      let p = (await inView(tab, grid[j]))!;
      await tab.mouse.click(p.x, p.y);
      assert.equal((await state(tab)).pinned, "ctrl", "through the glass, the Pico");
      // What the pointer is over is picked at the next frame, which a busy machine may not have drawn yet.
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.ghosts, [], "not while the pointer is over it, which nothing hides");
      await tab.mouse.move(5, 5);
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.ghosts, ["ctrl"], "its edges through what hides it, once the pointer is off it");
      await tab.click('#m [data-a2m="xray"]');
      assert.deepEqual((await state(tab)).drawn.glass, []);
      // Without it, the Pico pinned shows its edges through the case. Pointed at as well (by another view, so the real
      // pointer stays off it), it is lit just the same but without them: what differs is its edges through the case.
      await v3(tab, (v) => v.select("ctrl"));
      await top(tab);
      const box = await boxOf(tab, keypad.view, "ctrl");
      await idle(tab);
      const ghosted = await pixels(tab, box);
      await tab.evaluate(() => document.querySelector("main")!.dispatchEvent(new CustomEvent("a2:hover", { detail: { line: "ctrl", part: "ctrl" }, bubbles: true })));
      await idle(tab);
      assert.deepEqual([(await state(tab)).drawn.ghosts, await v3(tab, (v) => v.hover)], [[], "ctrl"]);
      const plainLit = await pixels(tab, box);
      assert.ok(differ(ghosted, plainLit) > 20, `the Pico's edges through the case: ${differ(ghosted, plainLit)} px differ`);
      await tab.click('#m [data-a2m="clear"]');
      p = (await inView(tab, grid[j]))!;
      await tab.mouse.click(p.x, p.y);
      assert.equal((await state(tab)).pinned, plain[j], "without it, the case");
      await tab.mouse.move(5, 5);
      await tab.click('#m [data-a2m="clear"]');
      // Mass: the cross where the centre of mass is.
      assert.equal(await tab.isVisible("#m .a2-model-mass"), false);
      await top(tab);
      const com = (await screenOf(tab, keypad.view.stability!.com))!;
      const near = { x: Math.round(com.x) - 4, y: Math.round(com.y) - 4, width: 9, height: 9 };
      const unmarked = await pixels(tab, near);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("m");
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.toggles.mass, s.drawn.com], [true, true]);
      assert.ok(differ(unmarked, await pixels(tab, near)) >= 3, "the cross is drawn at the centre of mass");
      assert.equal(await tab.textContent("#m .a2-model-mass"), `${massTextOf(keypad.view)} · marked`);
      assert.equal(await tab.textContent("#m .a2-model-say"), `Mass: ${massTextOf(keypad.view)} · marked`);
      await tab.keyboard.press("]");
      await idle(tab);
      assert.equal((await state(tab)).drawn.com, false, "not on a step");
      assert.equal(await tab.textContent("#m .a2-model-mass"), `${massTextOf(keypad.view)} · marked when the whole product is put together, on no step`);
      await tab.keyboard.press("Home");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.equal((await state(tab)).drawn.com, false, "not apart");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.equal((await state(tab)).drawn.com, true);
      await tab.click('#m [data-a2m="mass"]');
      assert.deepEqual([(await state(tab)).drawn.com, await tab.isVisible("#m .a2-model-mass")], [false, false]);
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("Probes: R draws each probe where the check casts it, lit by whether it passes, only as built; Show frames one and lights the parts it names", async () => {
      const { context, tab, said } = await open("ponder");
      const n = ponder.view.probes.length, radio = n - 1, all = [...Array(n).keys()];
      const says = () => tab.textContent("#m .a2-model-say");
      const pressed = () => tab.getAttribute('#m [data-a2m="probes"]', "aria-pressed");
      const lookOf = (i: number) => tab.evaluate((i) => (window as unknown as W).view3d.probeLook(i), i);
      let s = await state(tab);
      assert.deepEqual([s.toggles.probes, s.drawn.probes, await pressed()], [false, [], "false"], "off at the start");
      assert.equal(await tab.getAttribute('#m [data-a2m="probes"]', "aria-keyshortcuts"), "R");
      assert.equal(await tab.textContent("#m .a2-model-legend > p:last-child"), "Function probes: 8 of 9 pass; pi-radio fails. Probes (R) draws them where "
        + "the check casts them, while the whole product is put together as built:  green where one passes,  red where one fails.");
      // The speaker's rays, out of the base: drawn where they go, in the colour of a probe that passes.
      const spk = ponder.view.probes[0].where as { center: number[] };
      const mid = [spk.center[0], spk.center[1], spk.center[2] + probeReachOf(ponder.view) / 2];
      const p0 = (await inView(tab, mid))!;
      const box = { x: Math.round(p0.x) - 4, y: Math.round(p0.y) - 4, width: 9, height: 9 };
      const before = await pixels(tab, box);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("r");
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.toggles.probes, s.drawn.probes, await pressed()], [true, all, "true"]);
      assert.equal(await says(), "Probes: 8 of 9 pass; pi-radio fails");
      const after = await pixels(tab, box);
      assert.ok(differ(before, after) >= 3, "the speaker's rays are drawn");
      let greener = 0;
      for (let i = 0; i < after.length; i += 4) if (after[i + 1] - after[i] > 40 && after[i + 1] - before[i + 1] > -5) greener++;
      assert.ok(greener >= 2, `green where they are: ${greener}`);
      const colors = await v3(tab, (v) => v.colors);
      // Where a part hides its lines, they are drawn a third as strong.
      assert.deepEqual(await lookOf(0), { color: colors.green, opacity: 1, behind: 0.35 }, "a probe that passes");
      assert.deepEqual(await lookOf(radio), { color: colors.red, opacity: 1, behind: 0.35 }, "the radio's keep-out, which fails");
      // The radio's keep-out is inside the head: drawn faint through the shell and the Pi that hide it.
      const edges = probeShapeOf(ponder.view.probes[radio], probeReachOf(ponder.view))!.lines.map(([a, b]) => a.map((x, k) => (x + b[k]) / 2));
      const redsOf = async () => {
        await top(tab);
        const out: number[] = [];
        for (const e of edges) out.push(await redAt(tab, (await screenOf(tab, e))!));
        return out;
      };
      // Without the marks, whose red is near it.
      await v3(tab, (v) => v.marks(false));
      await idle(tab);
      const hid = await redsOf();
      await v3(tab, (v) => v.probes(false));
      await idle(tab);
      const none = await redsOf();
      await v3(tab, (v) => { v.probes(true); v.marks(true); });
      await idle(tab);
      assert.ok(hid.every((r, j) => r >= none[j] + 10), `every edge drawn where the head hides it: ${none} -> ${hid}`);
      // As built only: not in another pose, apart or on a step, and back with the product as built.
      await v3(tab, (v) => v.pose(1));
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, [], "not in another pose");
      assert.equal(await lookOf(0), null);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("r");
      assert.equal(await says(), "Probes not drawn");
      await tab.keyboard.press("r");
      assert.equal(await says(), "Probes: 8 of 9 pass; pi-radio fails; they are drawn as built, not in this pose");
      await v3(tab, (v) => v.pose(0));
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, all);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, [], "not apart");
      await tab.keyboard.press("r");
      await tab.keyboard.press("r");
      assert.equal(await says(), "Probes: 8 of 9 pass; pi-radio fails; drawn once the whole product is put together");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, all);
      await tab.keyboard.press("]");
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, [], "not on a step");
      await tab.keyboard.press("Home");
      await idle(tab);
      assert.deepEqual((await state(tab)).drawn.probes, all);
      // The panel lists each probe, with Show; Show on the radio's keep-out frames it and lights the metal too near.
      assert.equal(await tab.locator("#m .a2-model-probes > li").count(), n);
      assert.equal(await tab.locator("#m [data-a2m-probe]").count(), n);
      const row = (await tab.textContent(`#m .a2-model-probes > li:nth-child(${n})`))!;
      for (const text of ["Fails", "Keep-out · pi-radio", "The nearest metal is 8.91 mm from it", `Metal too near: ${labelOf(ponder.view, "scr25-4")} (8.91 mm)`, ponder.view.probes[radio].why])
        assert.ok(row.includes(text), `${text} in ${row}`);
      await v3(tab, (v) => v.probes(false));
      await tab.click(`#m [data-a2m-probe="${radio}"]`);
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([await v3(tab, (v) => v.probe), s.toggles.probes, s.drawn.probes], [radio, true, all], "Show draws the probes");
      const readout = probeReadoutOf(ponder.view, ponder.view.probes[radio]);
      assert.equal(await readout3d(tab), readout);
      assert.equal(await says(), `Showing ${readout}`);
      assert.deepEqual([...s.drawn.ghosts].sort(), ["ins25-3", "ins25-4", "scr25-3", "scr25-4"], "the metal too near lit, its edges through what hides it");
      assert.deepEqual([(await lookOf(radio))!.opacity, (await lookOf(0))!.opacity], [1, 0.4], "the others a tone down");
      const region = (ponder.view.probes[radio].where as { region: number[] }).region;
      const at = (await screenOf(tab, [0, 1, 2].map((k) => (region[k] + region[k + 3]) / 2)))!;
      const stage = (await tab.locator("#m .a2-model-stage").boundingBox())!;
      assert.ok(Math.abs(at.x - (stage.x + stage.width / 2)) < stage.width * 0.1 && Math.abs(at.y - (stage.y + stage.height / 2)) < stage.height * 0.1, "framed");
      // Shown, it alone is drawn whole: not the others that name a part it lights (the base's top, the head's shells).
      const pixel1 = ponder.view.probes.findIndex((p) => p.id === "pixel1");
      await v3(tab, (v) => v.showProbe(4));
      await idle(tab);
      assert.equal(pixel1, 4);
      assert.deepEqual(await Promise.all([pixel1, 0, 1, 5].map(async (i) => (await lookOf(i))!.opacity)), [1, 0.4, 0.4, 0.4]);
      await tab.evaluate((i) => (window as unknown as W).view3d.showProbe(i), radio);
      await idle(tab);
      await tab.keyboard.press("Escape");
      assert.deepEqual([await v3(tab, (v) => v.probe), await says()], [null, "Let go of the probe"]);
      assert.deepEqual((await state(tab)).drawn.ghosts, []);
      // Show from another pose goes back as built; the speaker lights its source and the grille its rays hit.
      await v3(tab, (v) => v.pose(2));
      await idle(tab);
      await tab.click('#m [data-a2m-probe="0"]');
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([await v3(tab, (v) => v.posed), await v3(tab, (v) => v.probe), s.drawn.probes, [...s.drawn.ghosts].sort()], [0, 0, all, ["base-top", "spk"]]);
      // A pinned part lets it go; its panel lists the probes it is in, each with Show, which keeps it pinned.
      await v3(tab, (v) => v.select("scr25-4"));
      assert.equal(await v3(tab, (v) => v.probe), null);
      await idle(tab);
      assert.deepEqual([(await lookOf(radio))!.opacity, (await lookOf(0))!.opacity], [1, 0.4], "the probe that names the part pinned stays whole");
      const own = (await tab.textContent("#m .a2-model-panel .a2-model-probes"))!;
      assert.ok(own.includes("Keep-out · pi-radio") && own.includes("Metal too near it: 8.91 mm"), own);
      await tab.click(`#m .a2-model-panel [data-a2m-probe="${radio}"]`);
      await idle(tab);
      assert.deepEqual([await v3(tab, (v) => v.probe), await v3(tab, (v) => v.pinned)], [radio, "scr25-4"]);
      await tab.click('#m [data-a2m="probes"]');
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.toggles.probes, s.drawn.probes, await v3(tab, (v) => v.probe), await pressed()], [false, [], null, "false"]);
      assert.equal(await asks(tab), 0);
      assert.deepEqual(said, []);
      await context.close();
      // The keypad's two, both passing.
      const k = await open("keypad");
      await k.tab.focus("#m .a2-model-stage");
      await k.tab.keyboard.press("R");
      await idle(k.tab);
      assert.deepEqual((await state(k.tab)).drawn.probes, [0, 1]);
      assert.equal(await k.tab.textContent("#m .a2-model-say"), "Probes: both pass");
      assert.equal(await k.tab.textContent("#m .a2-model-legend > p:last-child"), "Function probes: both pass. Probes (R) draws them where the check casts "
        + "them, while the whole product is put together as built:  green where one passes.");
      assert.deepEqual(k.said, []);
      await k.context.close();
    });

    await t.test("a probe that falls short with a reason, or doesn't say, is grey; the planes hold every probe, though no pose reaches as far; forced colours keep the keys", async () => {
      const { context, tab, said } = await open("probed");
      const view = probed.view, radio = view.probes.length - 1;
      const lookOf = (i: number) => tab.evaluate((i) => (window as unknown as W).view3d.probeLook(i), i);
      assert.equal(await tab.textContent("#m .a2-model-legend > p:last-child"), "Function probes: 7 of 9 pass; pi-radio falls short, accepted; 1 not said. "
        + "Probes (R) draws them where the check casts them, while the whole product is put together as built:  green where one passes,  grey where one falls "
        + "short, accepted, or system.json doesn't say whether it passes.");
      await v3(tab, (v) => v.probes(true));
      await idle(tab);
      const colors = await v3(tab, (v) => v.colors);
      assert.deepEqual([(await lookOf(0))!.color, (await lookOf(1))!.color, (await lookOf(radio))!.color], [colors.green, colors.mid, colors.mid]);
      const marked = await tab.$$eval("#m .a2-model-probes > li", (ls) => ls.map((l) => [l.getAttribute("data-state"), l.querySelector("b")!.textContent]));
      assert.deepEqual([marked[0], marked[1], marked[radio]], [["pass", "Passes"], ["unknown", "Not said"], ["accepted", "Accepted"]]);
      // The camera's field runs out to the page on the desk, past every part as built and apart: the planes hold it.
      const reach = probeReachOf(view);
      const corners = view.probes.flatMap((p) => {
        const b = probeShapeOf(p, reach)!.box;
        return [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [b[c & 1 ? 3 : 0], b[c & 2 ? 4 : 1], b[c & 4 ? 5 : 2]]);
      });
      const held = await tab.evaluate((ps) => ps.map((p) => (window as unknown as W).view3d.inPlanes(p)), corners);
      assert.deepEqual(held.map((h, i) => (h ? null : corners[i])).filter(Boolean), [], "every corner of every probe");
      // The part farthest from the product is far past what the planes would hold of the parts alone.
      const far = view.probes.find((p) => p.kind === "view")!;
      assert.ok(Math.max(...probeShapeOf(far, reach)!.box.map(Math.abs)) > 400);
      // In forced colours each key keeps the colour its probes are drawn in.
      const keys = () => tab.$$eval("#m .a2-model-legend .a2-model-probe", (ks) => ks.map((k) => [k.getAttribute("data-state"), getComputedStyle(k).borderTopColor]));
      const plain = await keys();
      assert.deepEqual(plain.map(([s]) => s), ["pass", "accepted"]);
      assert.notEqual(plain[0][1], plain[1][1]);
      await tab.emulateMedia({ forcedColors: "active" });
      assert.deepEqual(await keys(), plain);
      await tab.emulateMedia({ forcedColors: "none" });
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("with reduced motion, a pointer that doesn't move is over what a step puts in front of it, though the camera stays", async () => {
      const { context, tab, said } = await open("ponder");
      // From step 4 on, Ponder's arm makes the box the camera frames: the steps that close the head don't move it.
      const n = stepsOf(ponder.view).findIndex((s) => s.n === placeOf(ponder.view, "head-upper").step) + 1;
      await v3(tab, (v) => v.step(13));
      await idle(tab);
      assert.equal(n, 14);
      // A point over the bonnet, put in at step 13, where the pointer is over a part in the head.
      const [x0, y0, , x1, y1, z1] = ponder.view.items.find((i) => i.id === "bonnet")!.bbox!;
      let was: string | null = null;
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3]]) {
        const p = (await inView(tab, [x0 + fx * (x1 - x0), y0 + fy * (y1 - y0), z1]))!;
        await tab.mouse.move(p.x, p.y);
        await idle(tab);
        was = await v3(tab, (v) => v.hover);
        if (was) break;
      }
      assert.ok(was && was !== "head-upper", `over a part in the head: ${was}`);
      // The step frames the same box from where the camera looks, so it lands where it is, to within what floats round
      // off in the trip (a 10^-13 px): to a millionth of a px.
      const pi = async () => { const p = (await screenOf(tab, "pi"))!; return [p.x, p.y].map((c) => c.toFixed(6)).join(", "); };
      const camera = await pi();
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("]");
      await idle(tab);
      assert.equal(await pi(), camera, "the camera didn't move");
      assert.equal((await state(tab)).at, 14);
      assert.equal(await v3(tab, (v) => v.hover), "head-upper", `the head's upper shell, put on over the ${was}`);
      assert.equal(await readout3d(tab), readoutOf(ponder.view, "head-upper"));
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("Show at a step goes to the whole product and keeps the part, its panel saying so, and the drawing follows without letting go", async () => {
      for (const query of ["", "same"]) {
        const { context, tab, said } = await open("ponder", { query });
        await tab.focus("#m .a2-model-stage");
        await tab.keyboard.press("]");
        await tab.keyboard.press("]");
        await tab.selectOption("#m .a2-model-select", "head-upper");
        const goes = stepsOf(ponder.view).findIndex((x) => x.n === placeOf(ponder.view, "head-upper").step) + 1;
        assert.equal(await tab.textContent("#m [data-later]"), `Not shown at step 2: it goes on at step ${goes}`, query);
        await events(tab);
        await tab.click("#m .a2-model-panel [data-a2m-show]");
        await idle(tab);
        const s = await state(tab);
        assert.deepEqual([s.at, s.pinned, s.spot.length > 0], [0, "head-upper", true], query);
        assert.equal(await tab.evaluate(() => document.querySelectorAll("#m [data-later]").length), 0, `${query}: the panel no longer says it isn't shown`);
        assert.equal(await figCount(tab), `${ponder.view.assembly!.steps.length} steps`, `${query}: the drawing goes to the whole product`);
        const sent = await events(tab);
        assert.deepEqual(sent.filter((e) => e[0] === "a2:select" && e[1] === "fig"), [], `${query}: the drawing doesn't let go of the line: ${JSON.stringify(sent)}`);
        assert.deepEqual(said, [], query);
        await context.close();
      }
    });

    await t.test("a view mounted later starts where the other is: its step, apart and what is pinned, and moves neither", async () => {
      // The drawing late: the 3D view at step 3, apart, the Pico pinned.
      let { context, tab, said } = await open("keypad", { query: "late=fig" });
      await v3(tab, (v) => { v.step(3); v.explode(true); v.select("ctrl"); });
      await idle(tab);
      await events(tab);
      const mTop = await tab.evaluate(() => document.querySelector("#mcard")!.getBoundingClientRect().top);
      await tab.evaluate(() => (window as unknown as W).mountLate());
      await idle(tab);
      assert.deepEqual([await figCount(tab), await figApart(tab)], ["Step 3 / 9", "true"]);
      assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(keypad.view.lines.ctrl.name), "the drawing has the Pico's line");
      let s = await state(tab);
      assert.deepEqual([s.at, s.apart, s.pinned], [3, true, "ctrl"], "the 3D view stays where it was");
      assert.deepEqual((await events(tab)).filter((e) => e[0] !== "a2:ask" && !e[2].includes('"reply":true')), [], "nothing said but the ask and its replies");
      // The drawing's controls make its card taller as it mounts, and the page keeps the 3D view where it was (scroll
      // anchoring), so the page moves by just that much; the drawing doesn't take the focus or scroll to itself.
      assert.equal(await tab.evaluate(() => document.querySelector("#fig")!.contains(document.activeElement)), false);
      assert.ok(Math.abs((await tab.evaluate(() => document.querySelector("#mcard")!.getBoundingClientRect().top)) - mTop) < 1, "the 3D view stays put on the page");
      assert.deepEqual(said, []);
      await context.close();
      // The 3D view late: the drawing at step 4, apart, the keycaps' line pinned.
      ({ context, tab, said } = await open("keypad", { query: "late=3d", ready: false }));
      await tab.evaluate(() => { const f = (window as unknown as W).fig; f.step(4); f.explode(true); f.select("cap"); });
      await tab.evaluate(() => (window as unknown as W).mountLate());
      await tab.waitForFunction(() => (window as unknown as W).view3dReady, undefined, { timeout: 60000 });
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([s.at, s.apart, s.line], [4, true, "cap"]);
      assert.deepEqual([await figCount(tab), await figApart(tab)], ["Step 4 / 9", "true"], "the drawing stays where it was");
      assert.ok((await tab.textContent("#figcard [data-readout]"))!.startsWith(keypad.view.lines.cap.name));
      assert.equal(await asks(tab), 0, "still: it jumped there, with nothing to ease");
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("with motion, a step's parts show through what hides them, and a part that goes takes its edges with it", async () => {
      const { context, tab, said } = await open("keypad", { motion: true });
      const steps = keypad.view.assembly!.steps;
      const placedAt = (k: number) => keypad.view.items.filter((i) => placeOf(keypad.view, i.id).step === steps[k - 1].n).map((i) => i.id).sort();
      await v3(tab, (v) => v.step(2));
      await idle(tab);
      assert.deepEqual([...(await state(tab)).drawn.ghosts].sort(), placedAt(2), "with nothing lit, the step's parts");
      // Step 3's parts come in from nothing: their edges with them, once they are drawn.
      await v3(tab, (v) => v.step(3));
      await idle(tab);
      assert.deepEqual([...(await state(tab)).drawn.ghosts].sort(), placedAt(3), "the parts that came in");
      await v3(tab, (v) => v.step(2));
      await idle(tab);
      assert.deepEqual([...(await state(tab)).drawn.ghosts].sort(), placedAt(2), "step 3's parts gone, with their edges");
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("a mark on a face seen at a slant shows whole, not cut in half by the face", async () => {
      const { context, tab, said } = await open("planted");
      const i = plant.view.problems.length - 1;
      assert.deepEqual((await state(tab)).drawn.marks, [i]);
      await top(tab);
      const p = (await screenOf(tab, plant.view.problems[i].at!))!;
      let { share, most } = await redShare(tab, p, 3.5);
      assert.ok(most > 120 && share >= 0.9, `${Math.round(share * 100)}% of the disc as red as its reddest (${most})`);
      // Lower down, the face is seen more aslant: the mark comes further toward the eye, and still shows whole.
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("ArrowDown");
      await idle(tab);
      await top(tab);
      ({ share, most } = await redShare(tab, (await screenOf(tab, plant.view.problems[i].at!))!, 4.3));
      assert.ok(most > 120 && share >= 0.9, `from lower down, ${Math.round(share * 100)}% of the disc as red as its reddest (${most})`);
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("Ponder's nuts, inserts and screws go in at the drawing's steps and come off with the base or the head they are in", async () => {
      const view = ponder.view;
      const bboxOf = (id: string) => view.items.find((i) => i.id === id)!.bbox!;
      const near = (a: number[] | null, b: number[], tol: number) => Boolean(a) && a!.length === 6 && a!.every((x, i) => Math.abs(x - b[i]) < tol);
      const ids = ["nut-base", "nut-head", "ins3-base1", "ins3-head1", "scr3-base1", "scr3-head1"];
      for (const name of ["ponder", "blind"]) {
        const { context, tab, said } = await open(name);
        const box = (id: string) => tab.evaluate((id) => (window as unknown as W).view3d.boxOf(id), id);
        const legend = (await tab.textContent("#m .a2-model-legend"))!;
        for (const id of ids) assert.ok(near(await box(id), bboxOf(id), 0.15), `${name} ${id} as built: ${await box(id)} vs ${bboxOf(id)}`);
        assert.equal(await v3(tab, (v) => v.explode(true)), true, `${name}: apart`);
        await idle(tab);
        assert.equal((await state(tab)).apart, true);
        // A part of a line the drawing moves one way comes off, so the view is apart.
        const feet = view.assembly!.parts.foot1.lift;
        assert.ok(feet.some((x) => x !== 0) && near(await box("foot1"), bboxOf("foot1").map((x, i) => x + feet[i % 3]), 0.15), `${name}: the feet come off`);
        if (name === "ponder") {
          assert.doesNotMatch(legend, /Not on the drawing's steps/);
          // Apart, each goes the way the drawing moves the call whose point is in it: the base's down, the head's
          // along its tilt, each nut its own way.
          for (const id of ids) {
            const lift = view.assembly!.parts[id].lift;
            assert.ok(lift.some((x) => x !== 0), id);
            assert.ok(near(await box(id), bboxOf(id).map((x, i) => x + lift[i % 3]), 0.15), `${id} apart: ${await box(id)} vs ${bboxOf(id)} + ${lift}`);
          }
          assert.notDeepEqual(view.assembly!.parts["nut-base"].lift, view.assembly!.parts["nut-head"].lift);
          // Each goes in at its call's step: the inserts at 2, the head's nut at 4 with the arm, the base's at 10 with
          // the discs, the head's screws at 14 and the base's at 15.
          const drawnAt = async (n: number) => { await v3(tab, (v) => v.explode(false)); await tab.evaluate((n) => (window as unknown as W).view3d.step(n), n); await idle(tab); const d = (await state(tab)).drawn.parts; return ids.map((id) => d.includes(id)); };
          assert.deepEqual(await drawnAt(1), [false, false, false, false, false, false]);
          assert.deepEqual(await drawnAt(2), [false, false, true, true, false, false]);
          assert.deepEqual(await drawnAt(4), [false, true, true, true, false, false]);
          assert.deepEqual(await drawnAt(10), [true, true, true, true, false, false]);
          assert.deepEqual(await drawnAt(14), [true, true, true, true, false, true]);
          assert.deepEqual(await drawnAt(15), [true, true, true, true, true, true]);
        } else {
          // Without the points, the legend says why, by line, and they stay where they are.
          assert.match(legend, /Not on the drawing's steps: /);
          for (const line of ["nut", "ins3", "scr3"]) assert.ok(legend.includes(`${view.lines[line].name} (${blind.view.assembly!.unsure[line]})`), `${line}: ${legend}`);
          for (const id of ids) assert.ok(near(await box(id), bboxOf(id), 0.15), `${id} unmoved: ${await box(id)} vs ${bboxOf(id)}`);
        }
        assert.deepEqual(said, [], name);
        await context.close();
      }
    });

    await t.test("Ponder's poses: the Pose list stands it each way the stability gate weighs it, with that pose's risk and centre of mass, and goes back as built", async () => {
      const view = ponder.view;
      // Where each part is in a pose, from the model's own meshes in Node: moved by its matrix, every point of it.
      const t3 = await three();
      const gltf = await new t3.GLTFLoader().parseAsync(ponder.glb.buffer.slice(ponder.glb.byteOffset, ponder.glb.byteOffset + ponder.glb.byteLength), "");
      const movedBox = (k: number, id: string) => {
        let mesh: { geometry: { attributes: { position: { count: number } } } } | undefined;
        gltf.scene.traverse((o: { isMesh?: boolean; userData: { name?: string } }) => { if (o.isMesh && o.userData.name === id) mesh = o as unknown as typeof mesh; });
        const m = new t3.THREE.Matrix4().set(...view.poses[k].moved!.flat()), v = new t3.THREE.Vector3(), b = new t3.THREE.Box3();
        for (let i = 0; i < mesh!.geometry.attributes.position.count; i++) b.expandByPoint(v.fromBufferAttribute(mesh!.geometry.attributes.position, i).applyMatrix4(m));
        return [...b.min.toArray(), ...b.max.toArray()] as number[];
      };
      const bboxOf = (id: string) => view.items.find((i) => i.id === id)!.bbox!;
      const near = (a: number[] | null, b: number[], tol: number) => Boolean(a) && a!.length === 6 && a!.every((x, i) => Math.abs(x - b[i]) < tol);
      const { context, tab, said } = await open("ponder");
      const box = (id: string) => tab.evaluate((id) => (window as unknown as W).view3d.boxOf(id), id);
      const posed = () => v3(tab, (v) => v.posed);
      // The list: each pose, with what the stability gate found in it, the frame's first and shown.
      assert.deepEqual(await tab.$$eval('#m [data-a2m="pose"] option', (os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent])),
        view.poses.map((_, k) => [String(k), poseOptionOf(view, k)]));
      assert.equal(await tab.evaluate(() => (document.querySelector('#m [data-a2m="pose"]') as HTMLSelectElement).value), "0");
      assert.equal(await tab.isVisible("#m .a2-model-pose"), false, "as built, nothing to say");
      // As built, each part where the frame has it: the head over the page, the gooseneck along its design path; each
      // part drawn once.
      for (const id of ["head-upper", "cam", "base-top", "arm"]) assert.ok(near(await box(id), bboxOf(id), 0.15), `${id}: ${await box(id)} vs ${bboxOf(id)}`);
      const every = view.items.map((i) => i.id).sort();
      assert.deepEqual((await state(tab)).drawn.parts, every);
      // A part pinned as built: its panel says what a pose does to it once the pose is chosen, and nothing once back.
      await v3(tab, (v) => v.select("head-upper"));
      assert.equal(await tab.evaluate(() => document.querySelector("#m .a2-model-panel [data-pose]")), null);
      await tab.selectOption('#m [data-a2m="pose"]', "1");
      assert.match((await tab.textContent("#m .a2-model-panel [data-pose]"))!, /^Moved in this pose \(arm pulled straight out forward\)/);
      assert.equal((await state(tab)).pinned, "head-upper");
      await tab.selectOption('#m [data-a2m="pose"]', "0");
      assert.equal(await tab.evaluate(() => document.querySelector("#m .a2-model-panel [data-pose]")), null);
      assert.equal((await state(tab)).pinned, "head-upper");
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("Escape");
      assert.deepEqual([(await state(tab)).pinned, await posed()], [null, 0]);
      await idle(tab);

      // Arm pulled straight out forward: the head where the pose moves it, every point of it; the gooseneck drawn
      // straight out, dotted as a part along a path; the base where it was.
      await tab.selectOption('#m [data-a2m="pose"]', "1");
      await idle(tab);
      assert.equal(await posed(), 1);
      for (const id of ["head-upper", "head-lower", "cam", "mic1", "scr25-4"]) assert.ok(near(await box(id), movedBox(1, id), 1e-3), `${id}: ${await box(id)} vs ${movedBox(1, id)}`);
      assert.ok(near(await box("arm"), view.poses[1].drawn[0].bbox!, 0.15), `the gooseneck straight out: ${await box("arm")}`);
      assert.ok((await box("head-upper"))![1] > (await box("arm"))![4] - 1, "the head ahead of the arm's end");
      assert.ok(near(await box("base-top"), bboxOf("base-top"), 0.15), "the base as built");
      assert.deepEqual(await v3(tab, (v) => v.strokeOf("arm")), { edges: [0.5, 2], ghost: [0.5, 2] });
      assert.deepEqual((await state(tab)).drawn.parts, every, "each part once: the gooseneck straight, not its design path too");
      // Its risk and the base's mark, not the head's nor the risks as built; the bar, the line under it and the readout say so.
      let s = await state(tab);
      assert.deepEqual(s.drawn.marks, [0, 8]);
      assert.deepEqual([s.apart, s.at, s.spot], [false, 0, []]);
      assert.equal(await tab.textContent("#m .a2-model-pose"), poseTextOf(view, 1));
      assert.equal(await tab.isVisible("#m .a2-model-pose"), true);
      assert.equal(await tab.textContent("#m .a2-model-say"), poseTextOf(view, 1));
      assert.equal(await readout3d(tab), `Arm pulled straight out forward · ${view.items.length} parts`);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("p");
      await tab.keyboard.press("p");
      assert.equal(await tab.textContent("#m .a2-model-say"), "Marked: 1 problem and 1 accepted risk, 14 in another pose");
      // Its centre of mass, out past the base, with its own Mass line: the cross there, and no other pose's.
      await top(tab);
      const com = (await screenOf(tab, view.poses[1].mass!.com))!;
      const atCom = { x: Math.round(com.x) - 4, y: Math.round(com.y) - 4, width: 9, height: 9 };
      const unmarked = await pixels(tab, atCom);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("m");
      await idle(tab);
      assert.deepEqual([(await state(tab)).drawn.com, (await state(tab)).drawn.coms], [true, [1]]);
      assert.ok(differ(unmarked, await pixels(tab, atCom)) >= 3, "the cross at this pose's centre of mass");
      assert.equal(await tab.textContent("#m .a2-model-mass"), `${massTextOf(view, 1)} · marked`);
      // The camera frames the pose: the arm's end, the head and the base all in the view.
      const stage = await tab.evaluate(() => { const r = document.querySelector("#m .a2-model-stage")!.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      await top(tab);
      for (const id of ["arm", "head-upper", "base-bottom"]) {
        const q = (await screenOf(tab, id))!;
        assert.ok(q.x > stage.l && q.x < stage.r && q.y > stage.t && q.y < stage.b, `${id} in the view: ${JSON.stringify(q)}`);
      }
      // A pick finds the gooseneck where the pose draws it, and its panel says so; the head's says the pose moved it.
      const arm = (await inView(tab, "arm"))!;
      await tab.mouse.click(arm.x, arm.y + 2);
      assert.equal((await state(tab)).pinned, "arm");
      await tab.mouse.move(1, 1); // off the model, where it would light what comes under it next
      assert.match((await tab.textContent("#m .a2-model-panel [data-pose]"))!, /^Drawn along the path this pose \(arm pulled straight out forward\) bends it to/);
      const armPanel = (await tab.textContent("#m .a2-model-panel"))!;
      for (const [, text] of panelOf(view, "arm", 1)!.facts) assert.ok(armPanel.includes(text), text);
      assert.ok(armPanel.includes("12.7 × 381 × 12.7 mm") && !armPanel.includes(view.items.find((i) => i.id === "arm")!.why!), "the straight gooseneck's, not its design path's");
      await v3(tab, (v) => v.select("head-upper"));
      assert.match((await tab.textContent("#m .a2-model-panel [data-pose]"))!, /^Moved in this pose \(arm pulled straight out forward\), where the stability gate weighs it/);
      // Escape lets go of the part, then goes back as built, which the panel follows.
      await tab.keyboard.press("Escape");
      await tab.keyboard.press("Escape");
      await idle(tab);
      assert.equal(await posed(), 0);
      assert.equal(await tab.textContent("#m .a2-model-say"), "As built, head over the page");
      assert.ok(near(await box("head-upper"), bboxOf("head-upper"), 0.15), "the head back over the page");
      assert.ok(near(await box("arm"), bboxOf("arm"), 0.15), "the gooseneck back on its design path");
      assert.equal(await tab.isVisible("#m .a2-model-pose"), false);
      assert.equal(await tab.textContent("#m .a2-model-mass"), `${massTextOf(view, 0)} · marked`);
      assert.deepEqual((await state(tab)).drawn.coms, [0]);
      assert.deepEqual((await state(tab)).drawn.parts, every);
      assert.deepEqual((await state(tab)).drawn.marks, marksOf(view).filter((m) => markInPose(view, m, 0)).map((m) => m.i));

      // A pose is of the whole product put together: from a step it goes to the whole product, and the drawing with it;
      // a step, or Take apart, goes back as built.
      await v3(tab, (v) => v.step(3));
      await idle(tab);
      await v3(tab, (v) => v.pose("arm pulled straight out right"));
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([await posed(), s.at, s.apart], [3, 0, false]);
      assert.equal(await figCount(tab), `${view.assembly!.steps.length} steps`, "the drawing back to the whole product");
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("e");
      await idle(tab);
      assert.deepEqual([await posed(), (await state(tab)).apart, await figApart(tab)], [0, true, "true"]);
      await v3(tab, (v) => v.pose(4));
      await idle(tab);
      assert.deepEqual([await posed(), (await state(tab)).apart, await figApart(tab)], [4, false, "false"]);
      await v3(tab, (v) => v.step(2));
      assert.deepEqual([await posed(), (await state(tab)).at], [0, 2]);
      // A risk's Show goes to its pose; Show on marks of none in the pose shown goes to the first one's.
      await v3(tab, (v) => v.show(10));
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([await posed(), s.at, s.spot, s.drawn.marks], [3, 0, [10], [0, 10]]);
      assert.equal(await readout3d(tab), "Accepted risk · stability · the whole product");
      // The base's mark is in every pose: Show stays in this one.
      await v3(tab, (v) => v.show(0));
      await idle(tab);
      s = await state(tab);
      assert.deepEqual([await posed(), s.spot, s.drawn.marks], [3, [0], [0, 10]]);
      await v3(tab, (v) => v.show([6, 9]));
      await idle(tab);
      assert.deepEqual([await posed(), (await state(tab)).spot], [0, [6]]);
      // A pose it hasn't, by name, changes nothing; by place, the nearest it has.
      await v3(tab, (v) => v.pose("nope"));
      assert.equal(await posed(), 0);
      await v3(tab, (v) => v.pose(99));
      assert.equal(await posed(), 4);
      assert.deepEqual((await state(tab)).spot, [], "another pose lets go of the marks shown");
      assert.equal(await readout3d(tab), `Arm pulled straight out left · ${view.items.length} parts`);
      await v3(tab, (v) => v.pose(0));
      assert.deepEqual(said, []);
      await context.close();

      // The hash starts it in a pose and follows it; with apart, the drawing's pose, it is as built.
      const right = `#pose=${encodeURIComponent(view.poses[3].name)}`;
      const h = await open("ponder", { hash: right });
      assert.equal(await v3(h.tab, (v) => v.posed), 3);
      assert.ok(near(await h.tab.evaluate((id) => (window as unknown as W).view3d.boxOf(id), "cam"), movedBox(3, "cam"), 1e-3));
      assert.equal(await h.tab.evaluate(() => (document.querySelector('#m [data-a2m="pose"]') as HTMLSelectElement).value), "3");
      await h.tab.evaluate(() => { location.hash = "#apart"; });
      await idle(h.tab);
      assert.deepEqual([await v3(h.tab, (v) => v.posed), (await state(h.tab)).apart], [0, true]);
      await h.tab.evaluate((hash) => { location.hash = `${hash}&apart`; }, right);
      await idle(h.tab);
      assert.deepEqual([await v3(h.tab, (v) => v.posed), (await state(h.tab)).apart], [0, true]);
      await h.tab.evaluate((hash) => { location.hash = hash; }, right);
      await idle(h.tab);
      assert.deepEqual([await v3(h.tab, (v) => v.posed), (await state(h.tab)).apart], [3, false]);
      assert.deepEqual(h.said, []);
      await h.context.close();
    });

    await t.test("a pose that doesn't say where it puts the head draws none of it, one that moves it far off frames and draws it, and one not weighed marks no centre of mass", async () => {
      const view = odd.view;
      const { context, tab, said } = await open("odd");
      // The drawing points at the head; a pose that doesn't draw it lets go of it, and tells the drawing.
      await tab.evaluate(() => document.querySelector("main")!.dispatchEvent(new CustomEvent("a2:hover", { detail: { line: null, part: "head-upper" }, bubbles: true })));
      assert.equal(await v3(tab, (v) => v.hover), "head-upper");
      await events(tab);
      await v3(tab, (v) => v.pose(2));
      await idle(tab);
      assert.equal(await v3(tab, (v) => v.hover), null);
      assert.deepEqual((await events(tab)).filter((e) => e[0] === "a2:hover"), [["a2:hover", "3d", '{"line":null,"part":null}']]);
      const head = view.poses[2].drop;
      const s = await state(tab);
      assert.deepEqual(s.drawn.parts, view.items.map((i) => i.id).filter((id) => !head.includes(id)).sort(), "no part of the head, the gooseneck once");
      assert.equal(await tab.evaluate((id) => (window as unknown as W).view3d.boxOf(id), "head-upper"), null);
      assert.equal(await tab.evaluate((id) => (window as unknown as W).view3d.screenOf(id), "head-upper"), null);
      assert.equal(await tab.textContent("#m .a2-model-pose"), poseTextOf(view, 2));
      assert.match(poseTextOf(view, 2)!, /33 parts not drawn/);
      await v3(tab, (v) => v.select("head-upper"));
      assert.match((await tab.textContent("#m .a2-model-panel [data-pose]"))!, /^Not drawn in this pose \(arm pulled straight out backward\)/);
      await tab.focus("#m .a2-model-stage");
      await tab.keyboard.press("Escape");
      // Mass: the pose has no weighing, so nothing is marked and nothing says it is.
      await tab.keyboard.press("m");
      await idle(tab);
      assert.equal(await tab.textContent("#m .a2-model-mass"), "Arm pulled straight out backward: the stability gate has no weighing of this pose");
      assert.equal(await tab.textContent("#m .a2-model-say"), "Mass: Arm pulled straight out backward: the stability gate has no weighing of this pose");
      assert.deepEqual([(await state(tab)).drawn.com, (await state(tab)).drawn.coms], [false, []]);
      await v3(tab, (v) => v.pose(1));
      await idle(tab);
      assert.equal(await tab.textContent("#m .a2-model-mass"), `${massTextOf(view, 1)} · marked`);
      assert.deepEqual((await state(tab)).drawn.coms, [1]);
      // The head 2 m on: the camera frames it with the base, and the planes hold it, so it is drawn, not cut off.
      assert.ok((await tab.evaluate((id) => (window as unknown as W).view3d.boxOf(id), "head-upper"))![1] > 2300);
      await top(tab);
      const stage = await tab.evaluate(() => { const r = document.querySelector("#m .a2-model-stage")!.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      for (const id of ["head-upper", "base-bottom"]) {
        const q = await screenOf(tab, id);
        assert.ok(q && q.x > stage.l && q.x < stage.r && q.y > stage.t && q.y < stage.b, `${id} in the view: ${JSON.stringify(q)} in ${JSON.stringify(stage)}`);
      }
      assert.deepEqual(said, []);
      await context.close();
    });

    await t.test("with no WebGL 2 there is nothing to mark: no toggles, no Show, no Mass line", async () => {
      const flat = await browser.newContext({ viewport: { width: 760, height: 700 } });
      await flat.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return /webgl/.test(kind) ? null : (get as (...a: unknown[]) => unknown).call(this, kind, ...rest);
        } as typeof get;
      });
      const tab = await flat.newPage();
      await tab.goto(`${base}/ponder#pose=${encodeURIComponent(ponder.view.poses[3].name)}`);
      await tab.waitForFunction(() => (window as unknown as W).view3dReady, undefined, { timeout: 60000 });
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.posed), 0);
      assert.doesNotMatch((await readout3d(tab))!, /arm pulled/i, "the pose the hash chose isn't said");
      await tab.evaluate(() => (window as unknown as W).view3d.show(10));
      assert.deepEqual(await tab.evaluate(() => [(window as unknown as W).view3d.posed, (window as unknown as W).view3d.spot]), [0, []], "Show chooses no pose");
      for (const b of ["problems", "xray", "mass", "probes", "apart", "pose"]) assert.equal(await tab.isVisible(`#m [data-a2m="${b}"]`), false, b);
      // The panel still lists the probes, with no Show; the legend has no line of how they are drawn.
      await tab.evaluate(() => (window as unknown as W).view3d.showProbe(0));
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.probe), null);
      assert.equal(await tab.locator("#m .a2-model-probes > li").count(), ponder.view.probes.length);
      assert.equal(await tab.evaluate(() => document.querySelectorAll("#m [data-a2m-probe]").length), 0);
      assert.equal(await tab.isVisible("#m .a2-model-pose"), false);
      assert.equal(await tab.evaluate(() => (window as unknown as W).view3d.pose(2)), 0, "no pose to show without 3D");
      assert.equal(await tab.evaluate(() => document.querySelectorAll("#m [data-a2m-show]").length), 0);
      await tab.focus("#m .a2-model-select");
      await tab.selectOption("#m .a2-model-select", "head-upper");
      assert.equal(await tab.evaluate(() => document.querySelectorAll("#m [data-a2m-show]").length), 0);
      assert.equal(await tab.isVisible("#m .a2-model-mass"), false);
      const legend = (await tab.textContent("#m .a2-model-legend"))!;
      assert.doesNotMatch(legend, /Not on the drawing's steps|marked where the check found them|No assembly steps|Function probes/, legend);
      await flat.close();
    });
  } finally {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    await browser.close();
  }
});
