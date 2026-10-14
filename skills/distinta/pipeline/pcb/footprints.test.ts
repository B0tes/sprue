// The footprint library against its sources (fixtures/footprint-refs.json, read through refs.ts), to 0.01 mm. Run
//   node --test skills/distinta/pipeline/pcb/footprints.test.ts
// Each check is also shown to fail on a footprint broken on purpose: moved, mirrored, drilled to the wrong size.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FOOTPRINTS, picoKind, type Footprint } from "./footprints.ts";
import { drift, REF_TOL_MM, REFS, type LocalHole, type LocalPad } from "./refs.ts";
import { RULES } from "./rules.ts";

const local = (fp: Footprint): { pads: LocalPad[]; holes: LocalHole[] } => ({
  pads: fp.pads.map((p) => ({ num: p.num, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h, plated: p.on === "both" })),
  holes: fp.holes.map((h) => ({ x: h.x, y: h.y, drill: h.drill })),
});
const driftOf = (fp: Footprint) => {
  const { pads, holes } = local(fp);
  return drift(REFS[fp.name], pads, holes);
};
const pico = (opts = {}) => FOOTPRINTS["rpi-pico-castellated"](RULES, opts);
const kailh = () => FOOTPRINTS["kailh-mx-hotswap"](RULES, { switchMm: 14 });
/** The footprint seen from the other side: every pad and hole at its mirror image across the x axis. */
const mirrored = (fp: Footprint): Footprint => ({
  ...fp,
  pads: fp.pads.map((p) => ({ ...p, y: -p.y })),
  holes: fp.holes.map((h) => ({ ...h, y: -h.y })),
});

test("every footprint in the library has a reference, and matches it to 0.01 mm", () => {
  assert.deepEqual(Object.keys(FOOTPRINTS).filter((f) => !REFS[f]), []);
  assert.deepEqual(driftOf(pico()), []);
  assert.deepEqual(driftOf(pico({ throughHoles: { drillMm: 1.0, padMm: 1.6 } })), []);
  assert.deepEqual(driftOf(kailh()), []);
  // Each goes only on the side its reference is drawn for, since a footprint is not mirrored on the bottom: the socket
  // on the back, the Pico on the top.
  for (const [name, make] of Object.entries(FOOTPRINTS)) assert.deepEqual(make(RULES, {}).sides, [REFS[name].side], name);
  assert.deepEqual([REFS["kailh-mx-hotswap"].side, REFS["rpi-pico-castellated"].side], ["bottom", "top"]);
  // The Pico's body, which its keepout and silkscreen outline follow, is the reference's 51 x 21.
  const xs = pico().keepouts[0].pts.map((p) => p[0]), ys = pico().keepouts[0].pts.map((p) => p[1]);
  const body = REFS["rpi-pico-castellated"].body!;
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [body.x0, body.x1, body.y0, body.y1]);
});

test("a number that drifts more than 0.01 mm from its reference is found, one within it is not", () => {
  const nudge = (fp: Footprint, num: string, by: number): Footprint => ({ ...fp, pads: fp.pads.map((p) => (p.num === num ? { ...p, x: p.x + by } : p)) });
  assert.deepEqual(driftOf(nudge(pico(), "14", REF_TOL_MM / 2)), []);
  assert.match(driftOf(nudge(pico(), "14", 0.02)).join("\n"), /pad 14 \(GP10\) is at \(-8\.87, 9\.69\), the reference has it at \(-8\.89, 9\.69\) \[kicad-pico\]/);
  assert.match(driftOf(nudge(kailh(), "A", -1)).join("\n"), /pad A is at \(-8\.36, 2\.54\), the reference has it at \(-7\.36, 2\.54\) \[marbastlib\]/);
  // Pads shrunk to 1 mm square, socket holes drilled 2.5 mm, peg holes back at 1.75: each is drift.
  const small = { ...kailh(), pads: kailh().pads.map((p) => ({ ...p, w: 1, h: 1 })) };
  assert.match(driftOf(small).join("\n"), /pad A is 1 x 1, the reference's is 2\.55 x 2\.5/);
  const drilled = (d: number, was: number) => ({ ...kailh(), holes: kailh().holes.map((h) => (h.drill === was ? { ...h, drill: d } : h)) });
  assert.match(driftOf(drilled(2.5, 3.05)).join("\n"), /the hole at \(-3\.81, 2\.54\) is 2\.5 mm, the reference's is 3\.05 mm \[kailh\]/);
  assert.match(driftOf(drilled(1.75, 1.7)).join("\n"), /the hole at \(-5\.08, 0\) is 1\.75 mm, the reference's is 1\.7 mm \[kicad-mx\]/);
  // A pad left out is missing.
  assert.match(driftOf({ ...pico(), pads: pico().pads.filter((p) => p.num !== "40") }).join("\n"), /the reference's pin 40 \(VBUS\) is missing/);
});

test("pad 1 of the Pico is at the USB end, on the same row end as the USB shell's holes", () => {
  const pads = pico().pads, shell = pico().holes;
  const pad = (n: string) => pads.find((p) => p.num === n)!;
  assert.equal(pad("1").name, "GP0");
  assert.ok(shell.every((h) => h.x > 0), "the USB shell's holes are at the +x end");
  assert.equal(pad("1").x, Math.max(...pads.map((p) => p.x)), "pad 1 is the outermost pad toward +x");
  assert.ok(pad("1").y > 0 && pad("40").y < 0 && pad("40").x === pad("1").x, "pads 1 and 40 face each other at the USB end");
  assert.ok(pad("20").x < 0 && pad("21").x < 0, "pads 20 and 21 are at the far end");
  // In the reference (KiCad, y down, USB toward -y) pad 1 is at (-9.69, -24.13): the kit's (24.13, 9.69).
  const ref = REFS["rpi-pico-castellated"].pads.find((p) => p.num === "1" && !p.plated)!;
  assert.deepEqual([ref.x, ref.y, ref.name], [24.13, 9.69, "GP0"]);
});

test("a mirrored Pico puts other functions where the pads are, and drift says which", () => {
  const ref = REFS["rpi-pico-castellated"];
  const at = (fp: Footprint) => (x: number, y: number) => fp.pads.find((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6)?.name;
  const layout = (fp: Footprint) => ref.pads.filter((p) => !p.plated).map((p) => at(fp)(p.x, p.y));
  const want = ref.pads.filter((p) => !p.plated).map((p) => p.name);
  assert.deepEqual(layout(pico()), want);
  const flipped = layout(mirrored(pico()));
  const moved = want.filter((n, i) => flipped[i] !== n).length;
  // Only the grounds that face each other (3 and 38, 13 and 28, 18 and 23) keep their function.
  assert.equal(moved, 34);
  // Where the keypad's GP2, GP3 and GP8 would land: 3V3_EN, 3V3(OUT) and RUN.
  const where = (name: string) => want[flipped.indexOf(name)];
  assert.deepEqual(["GP2", "GP3", "GP8"].map(where), ["3V3_EN", "3V3(OUT)", "RUN"]);
  const found = driftOf(mirrored(pico())).join("\n");
  assert.match(found, /pad 4 \(GP2\) is at \(16\.51, -9\.69\), the reference has it at \(16\.51, 9\.69\), where its pin 37 \(3V3_EN\) is/);
  assert.match(found, /pad 5 \(GP3\) is at \(13\.97, -9\.69\), the reference has it at \(13\.97, 9\.69\), where its pin 36 \(3V3\(OUT\)\) is/);
});

test("pad kinds: the Pico's pins by function, the socket's contacts must connect", () => {
  const byKind = (k: string) => pico().pads.filter((p) => p.kind === k).map((p) => p.num);
  assert.deepEqual(byKind("gnd"), ["3", "8", "13", "18", "23", "28", "33", "38"]);
  assert.deepEqual(byKind("control"), ["30", "37"]);
  assert.deepEqual(byKind("power"), ["35", "36", "39", "40"]);
  assert.equal(byKind("gpio").length, 26);
  assert.ok(pico().pads.every((p) => p.kind === picoKind(p.name!)));
  assert.deepEqual(kailh().pads.map((p) => [p.num, p.kind, p.mustConnect]), [["A", "switch", true], ["B", "switch", true]]);
});

test("socket holes of 3.05 mm and peg holes of 1.70 mm keep 0.465 mm between them", () => {
  const holes = kailh().holes;
  const peg = holes.find((h) => h.x === -5.08)!, socket = holes.find((h) => h.drill === 3.05 && h.x < 0)!;
  const gap = Math.hypot(peg.x - socket.x, peg.y - socket.y) - (peg.drill + socket.drill) / 2;
  assert.ok(Math.abs(gap - 0.465) < 0.001, `${gap}`);
  assert.ok(gap >= RULES.holeGapMm);
});
