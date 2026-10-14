// Tests of the PCB kit's own guarantees, on small boards built in memory. Run them with
//   node --test skills/distinta/pipeline/pcb/kit.test.ts
// They use only node:test: the skill has no dependencies.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pcb } from "../pcb.ts";
import { drcAudit, gerbersAudit } from "../stages/score.ts";
import { audit } from "./drc.ts";
import { createBoard } from "./board.ts";
import { fieldFor, LAYERS } from "./field.ts";
import { FOOTPRINTS } from "./footprints.ts";
import { boardModules, inputsHash, watch } from "./fresh.ts";
import { checkGerber, gerber, readBack } from "./gerber.ts";
import { checkIntent, type DesignIntent } from "./intent.ts";
import { checkD356, d356, readD356 } from "./ipc356.ts";
import { buildFab, spokes } from "./layers.ts";
import { newRaster, paint } from "./raster.ts";
import { route } from "./router.ts";
import { FAB_PROFILES, looserThanFabs, RULES } from "./rules.ts";
import { thin } from "./thin.ts";
import type { BoardData, GerberLayer, Item, Pt } from "./types.ts";

const layer = (items: Item[]): GerberLayer => ({ file: "T.gtl", fn: "Copper,L1,Top", polarity: "Positive", items });
const dot = (x: number, y: number): Item => ({ op: "flash", ap: { kind: "C", d: 1 }, x, y, pol: "D" });
const line = (a: [number, number], b: [number, number]): Item => ({ op: "draw", d: 0.3, a, b, pol: "D" });

test("a draw after a flash or a region moves the pen first", () => {
  const items: Item[] = [
    line([0, 0], [1, 0]), dot(5, 5), line([1, 0], [2, 0]),
    { op: "region", pts: [[10, 10], [11, 10], [11, 11]], pol: "D" }, line([2, 0], [3, 0]),
  ];
  const text = gerber("t", layer(items));
  assert.deepEqual(readBack(text).filter((i) => i.op === "draw").map((i) => i.op === "draw" && [i.a, i.b]), [
    [[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]],
  ]);
  assert.equal(checkGerber(layer(items), text), undefined);
});

test("a layer that does not print its list is caught", () => {
  const items: Item[] = [line([0, 0], [1, 0]), line([1, 0], [2, 0])];
  const text = gerber("t", layer(items)).replace("X2000000Y0D01*", "X2000000Y1000000D01*");
  assert.match(checkGerber(layer(items), text) ?? "", /reads back/);
});

test("copper narrower than the minimum is found, a track of the right width is not", () => {
  const box = { x0: -5, y0: -5, x1: 5, y1: 5 };
  const found = (w: number, angle: number) => {
    const r = newRaster(box, RULES.thinGridMm), a = (angle * Math.PI) / 180;
    paint(r, [{ op: "draw", d: w, a: [-3 * Math.cos(a), -3 * Math.sin(a)], b: [3 * Math.cos(a), 3 * Math.sin(a)], pol: "D" }]);
    return thin(r, RULES.copperMinMm, RULES.thinTipMm2).parts.length;
  };
  for (const angle of [0, 30, 45, 90]) {
    assert.equal(found(0.3, angle), 0, `0.3 mm at ${angle} degrees`);
    assert.equal(found(0.1, angle), 1, `0.1 mm at ${angle} degrees`);
  }
});

test("a track at the minimum width passes the audit wherever it lies, and one under it fails on its width", () => {
  // The thin-copper raster has pixel centres at odd multiples of half a pixel, and so do the edges of a 0.25 mm track
  // on the router's grid (y = 2.1, 2.35, 2.6 on a 60 x 40 board): whether the track's edge rows are painted is down to
  // float rounding, and a pixel-wide test of its width would fail it. The board's own copper is checked on the track
  // itself, and the raster only looks at the pour.
  const board = (pour: boolean) => {
    const { api, data } = createBoard("t");
    api.outline(60, 40, 1);
    if (pour) api.pour("GND", "B.Cu");
    [[-25, -15, 2.1], [-10, 0, 2.35], [5, 15, 2.6], [20, 28, 2.85]].forEach(([x0, x1, y]) => api.track("X", "B.Cu", [[x0, y], [x1, y]], RULES.trackMinMm));
    api.track("X", "B.Cu", [[-20, -18], [-20, 10]], RULES.trackMinMm);
    return audit(data, buildFab(data, RULES), RULES).errors;
  };
  assert.deepEqual(board(false), []);
  assert.deepEqual(board(true), []);
  const { api, data } = createBoard("t");
  api.outline(20, 20, 1);
  api.track("X", "B.Cu", [[-5, 0], [5, 0]], 0.1);
  const errors = audit(data, buildFab(data, RULES), RULES).errors;
  assert.ok(errors.some((e) => /is 0\.1 mm wide, the minimum is 0\.25 mm/.test(e)), errors.join("\n"));
});

/** A 20 x 20 board with a ground pour and two vias of another net close enough to leave a neck between them. */
function twoVias(gap: number) {
  const { api, data } = createBoard("t");
  api.outline(20, 20, 1);
  api.pour("GND", "F.Cu");
  const d = RULES.viaPadMm + 2 * RULES.pourClearanceMm + gap;
  api.via("A", -d / 2, 0);
  api.via("B", d / 2, 0);
  return { data, fab: buildFab(data, RULES) };
}

test("the pour fill cuts out a neck, and the audit would see it if it did not", () => {
  const { data, fab } = twoVias(0.1);
  assert.deepEqual(audit(data, fab, RULES).errors.filter((e) => /thin pour/.test(e)), []);
  const bare = buildFab(data, { ...RULES, thinTipMm2: Infinity });
  assert.equal(audit(data, bare, RULES).errors.filter((e) => /thin pour/.test(e)).length, 1);
});

test("a net with one pad is an error unless it is declared", () => {
  const board = (declare: boolean) => {
    const { api, data } = createBoard("t");
    api.outline(40, 40, 1);
    api.place("kailh-mx-hotswap", { ref: "K1", x: 0, y: 0, side: "bottom", nets: { A: "ALONE", B: "GND" } });
    api.place("kailh-mx-hotswap", { ref: "K2", x: 0, y: 15, side: "bottom", nets: { A: "SIG", B: "GND" } });
    if (declare) api.single("ALONE");
    return audit(data, buildFab(data, RULES), RULES);
  };
  assert.ok(board(false).errors.some((e) => /net ALONE has only one pad/.test(e)));
  assert.ok(!board(true).errors.some((e) => /ALONE/.test(e)));
});

test("a pour's thermal spoke counts as copper of its net", () => {
  const { api, data } = createBoard("t");
  api.outline(60, 60, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, side: "top", nets: { GND: "GND" } });
  api.pour("GND", "F.Cu");
  // A track of another net just past the end of U1.3's spoke, closer to it than the clearance rule.
  const pad = data.pads.find((p) => p.ref === "U1" && p.num === "3")!;
  const tip = pad.y + pad.h / 2 + RULES.pourClearanceMm + 0.2 + RULES.spokeMm / 2 + 0.1;
  api.track("X", "F.Cu", [[pad.x - 1, tip + 0.15], [pad.x + 1, tip + 0.15]]);
  const errors = audit(data, buildFab(data, RULES), RULES).errors;
  assert.ok(errors.some((e) => /clearance on F\.Cu:.*U1\.3 spoke/.test(e)), errors.join("\n"));
});

test("a hole's keepout never falls under its edge plus the clearance rule, and a second pour is refused", () => {
  const { api, data } = createBoard("t");
  api.outline(30, 30, 1);
  api.hole(0, 0, 3.4, { keepout: 1 });
  assert.equal(data.holes[0].keepout, 3.4 / 2 + RULES.holeClearMm);
  api.pour("GND", "B.Cu");
  api.pour("SIG", "B.Cu");
  assert.ok(data.problems.some((p) => /second pour/.test(p)));
});

test("route refuses a net that is not the pads' net", () => {
  const { api } = createBoard("t");
  api.outline(60, 60, 1);
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: 0, side: "bottom", nets: { A: "SIG", B: "GND" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 10, y: 0, side: "bottom", nets: { A: "SIG" } });
  assert.throws(() => api.route("OTHER", "K1.A", "K2.A"), /is on net SIG, not OTHER/);
  assert.throws(() => api.route("GND", "K1.B", "K2.B"), /on no net/);
  assert.throws(() => api.route("", "K1.A", "K2.A"), /needs a name/);
});

/** Two sockets on the back, joined by `net`, with a wall of keepout between them that is open only above y = `gap`. */
function walled(gap: number) {
  const { api, data } = createBoard("t");
  api.outline(90, 70, 1);
  api.place("kailh-mx-hotswap", { ref: "K1", x: -28, y: -5, side: "bottom", nets: { A: "SIG", B: "G1" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 28, y: -5, side: "bottom", nets: { A: "SIG", B: "G2" } });
  api.keepout("B.Cu", [[-1, -40], [1, -40], [1, gap], [-1, gap]], { tracks: true, pour: false });
  return { api, data };
}

test("a route is the cheapest on the board whether or not its first window holds it", () => {
  const { api } = walled(22);
  const near = api.route("SIG", "K1.A", "K2.A");
  // The wall is open only 22 mm above the pads, well beyond a 5 mm window: the search had to grow.
  assert.ok(near.tracks.some((t) => t.pts.some((p) => p[1] > 22)), "the track goes round the end of the wall");
  const { api: other } = walled(22);
  const whole = other.route("SIG", "K1.A", "K2.A", { window: Infinity });
  assert.ok(Math.abs(near.cost - whole.cost) < 1e-3, `windowed ${near.cost} against whole board ${whole.cost}`);
  assert.ok(Math.abs(near.lengthMm - whole.lengthMm) < 1e-6);
  // And with no wall a small window is enough, with the same answer.
  const { api: free } = walled(-40);
  assert.ok(Math.abs(free.route("SIG", "K1.A", "K2.A").cost - walled(-40).api.route("SIG", "K1.A", "K2.A", { window: Infinity }).cost) < 1e-3);
});

test("a route with no way round is refused, not looped on", () => {
  const { api } = walled(40);
  assert.throws(() => api.route("SIG", "K1.A", "K2.A"), /no path/);
});


test("a cheaper route outside the first window is found by the second search", () => {
  // The wall on the back ends at y = 6, a few mm above the pads. A window 5 mm round the pads reaches only y = 3.8, so
  // the first search finds the way over the wall (a via up, along the top, a via down), and the way round its end, which
  // is cheaper but all on the back, lies outside that window: only the search in the ellipse of the first cost sees it.
  const dear = { via: true, viaCost: 100 };
  const { api } = walled(6);
  const found = api.route("SIG", "K1.A", "K2.A", dear);
  const whole = walled(6).api.route("SIG", "K1.A", "K2.A", { ...dear, window: Infinity });
  assert.ok(Math.abs(found.cost - whole.cost) < 1e-3, `windowed ${found.cost} against whole board ${whole.cost}`);
  assert.equal(found.vias.length, 0, "round the end of the wall, not over it");
  assert.ok(found.tracks.some((t) => t.pts.some((p) => p[1] > 6)));
  // A wall that closes the back leaves only the way over, which the first window finds: dearer than the way round.
  const over = walled(40).api.route("SIG", "K1.A", "K2.A", dear);
  assert.equal(over.vias.length, 2);
  assert.ok(found.cost < over.cost - 100, `round ${found.cost}, over ${over.cost}`);
});

test("a window that is not 0 or more is refused, and 0 looks in the pads' box first and then widens", () => {
  const { api, data } = walled(22);
  for (const window of [-1, -3, NaN, "5"]) assert.throws(() => api.route("SIG", "K1.A", "K2.A", { window: window as number }), /window must be a number from 0 to Infinity, got /);
  assert.deepEqual(data.tracks, []);
  const zero = api.route("SIG", "K1.A", "K2.A", { window: 0 });
  const whole = walled(22).api.route("SIG", "K1.A", "K2.A", { window: Infinity });
  assert.ok(Math.abs(zero.cost - whole.cost) < 1e-3, `window 0 ${zero.cost} against whole board ${whole.cost}`);
});

/** The Pico's GP2 on the top and a socket's A pad on the back, joined by SIG: a route between them needs one via. */
function forcedVia() {
  const { api, data } = createBoard("t");
  api.outline(100, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: -20, y: 0, nets: { GP2: "SIG" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 30, y: 0, side: "bottom", nets: { A: "SIG" } });
  return { api, data };
}

test("a cost that is not a number from 0 up is refused, and a dear via is searched as fast as a cheap one", () => {
  const { api, data } = forcedVia();
  for (const key of ["viaCost", "topCost", "turnCost"] as const)
    for (const v of [Infinity, NaN, -1, 1e7, "30"])
      assert.throws(() => api.route("SIG", "U1.GP2", "K2.A", { via: true, [key]: v as number }), new RegExp(`${key} must be a number from 0 to 1000000, got `));
  assert.deepEqual([data.tracks, data.vias], [[], []]);
  // The distance map keeps a bucket for every cost a step can add: a via of 100 cells has 10,000, one of 5,000 would
  // have 500,000 and one of a million 100 million, so those wait in a heap instead. The via is forced, so the route is
  // the same and costs exactly what the via costs more.
  const run = (viaCost: number) => forcedVia().api.route("SIG", "U1.GP2", "K2.A", { via: true, viaCost });
  const cheap = run(100), dear = run(5000), dearest = run(1e6);
  assert.equal(cheap.vias.length, 1);
  assert.deepEqual(dear.tracks, cheap.tracks);
  assert.deepEqual(dearest.tracks, cheap.tracks);
  assert.ok(Math.abs(dear.cost - cheap.cost - 4900) < 0.05, `${cheap.cost} at 100, ${dear.cost} at 5000`);
});

/** Net X on three pads: the Pico's GP2 on the top and two sockets on the back, so each route to a socket needs a via. */
function threePads() {
  const { api, data } = createBoard("t");
  api.outline(61, 94, 2);
  api.place("rpi-pico-castellated", { ref: "U1", x: 5, y: 26.5, side: "top", nets: { GP2: "X" } });
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: -30, side: "bottom", nets: { A: "X" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 15, y: -30, side: "bottom", nets: { A: "X" } });
  api.single("X");
  return { api, data };
}

test("two vias of one net keep the hole spacing apart, and two drills at one spot are an error", () => {
  const { api, data } = threePads();
  api.route("X", "U1.GP2", "K1.A", { via: true });
  api.route("X", "U1.GP2", "K2.A", { via: true });
  assert.equal(data.vias.length, 2);
  const apart = Math.hypot(data.vias[0].x - data.vias[1].x, data.vias[0].y - data.vias[1].y);
  assert.ok(apart >= RULES.viaDrillMm + RULES.holeGapWarnMm - 1e-9, `vias ${apart} mm apart, centre to centre`);
  const audited = audit(data, buildFab(data, RULES), RULES);
  assert.deepEqual(audited.errors, []);
  assert.ok(!audited.warnings.some((w) => /0\.4 mm and 0\.4 mm/.test(w)), audited.warnings.join("\n"));
  // The audit compares drills one by one, not by where they are: a second drill on the first is the worst gap there is.
  const { api: hand, data: board } = forcedVia();
  hand.via("SIG", 0, 0);
  hand.via("SIG", 0, 0);
  const errors = audit(board, buildFab(board, RULES), RULES).errors;
  assert.ok(errors.some((e) => /holes 0\.4 mm and 0\.4 mm are -0\.4 mm edge to edge/.test(e)), errors.join("\n"));
});

test("pcb.rules is the frozen object the audit uses, so board code cannot loosen its own DRC", () => {
  const { api, data } = createBoard("t");
  assert.equal(api.rules, RULES);
  assert.ok(Object.isFrozen(RULES));
  assert.throws(() => { (api.rules as { trackMinMm: number }).trackMinMm = 0.05; }, TypeError);
  api.outline(20, 20, 1);
  api.track("X", "B.Cu", [[-5, 0], [5, 0]], 0.1);
  assert.ok(audit(data, buildFab(data, RULES), RULES).errors.some((e) => /is 0\.1 mm wide, the minimum is 0\.25 mm/.test(e)));
});

/** How many cells of the router's kept map of `data` differ from a map built from scratch on a copy of the board
 * (net ids are numbered in the order they are met, so they are compared by net, not by number). */
function staleCells(data: BoardData): number {
  const kept = fieldFor(data, RULES, RULES.trackMm, 0.6), fresh = fieldFor(structuredClone(data), RULES, RULES.trackMm, 0.6);
  const nets = new Set([...data.pads, ...data.tracks, ...data.vias].map((i) => i.net).filter(Boolean));
  const keptId = new Map([...nets].map((n) => [fresh.idOf(n), kept.idOf(n)]));
  const maps = [...LAYERS.flatMap((l) => [[kept.owner[l], fresh.owner[l]], [kept.near[l], fresh.near[l]]]), [kept.viaMap, fresh.viaMap]];
  let stale = 0;
  for (const [a, b] of maps) for (let k = 0; k < a.length; k++) if (a[k] !== (keptId.get(b[k]) ?? b[k])) stale++;
  return stale;
}
const padOf = (data: BoardData, ref: string, num: string) => data.pads.find((p) => p.ref === ref && p.num === num)!;

test("the router's map, brought up to date between routes, is the one a fresh map would be", () => {
  const { api, data } = createBoard("t");
  api.outline(80, 60, 1);
  api.pour("GND", "F.Cu");
  api.place("kailh-mx-hotswap", { ref: "K1", x: -25, y: -10, side: "bottom", nets: { A: "S1", B: "GND" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 25, y: -10, side: "bottom", nets: { A: "S1", B: "GND" } });
  api.place("kailh-mx-hotswap", { ref: "K3", x: -25, y: 15, side: "bottom", nets: { A: "S2", B: "GND" } });
  api.place("kailh-mx-hotswap", { ref: "K4", x: 25, y: 15, side: "bottom", nets: { A: "S2", B: "GND" } });
  api.route("S1", "K1.A", "K2.A");
  assert.equal(staleCells(data), 0);
  // More goes on the board after the first route (a hand track, a via, a part, a hole and a keepout), and a second follows.
  api.track("GND", "B.Cu", [[0, 5], [0, 25]]);
  api.via("GND", 3, 6);
  api.hole(10, 20, 3.4);
  api.keepout("F.Cu", [[-5, -25], [5, -25], [5, -20], [-5, -20]], { tracks: true, pour: true });
  api.place("kailh-mx-hotswap", { ref: "K5", x: 0, y: -25, side: "bottom", nets: { A: "S3", B: "GND" } });
  const before = structuredClone(data);
  const cached = api.route("S2", "K3.A", "K4.A", { via: true });
  assert.equal(staleCells(data), 0);
  // The route on the kept map is the route on a map built from scratch for the board as it was before this route.
  const fresh = route(before, RULES, "S2", padOf(before, "K3", "A"), padOf(before, "K4", "A"), { width: RULES.trackMm, via: true });
  assert.equal(fresh.cost, cached.cost);
  assert.deepEqual(fresh.tracks, cached.tracks);
  assert.deepEqual(fresh.vias, cached.vias);
});

test("a pour declared between two routes puts its spokes in the router's map", () => {
  const { api, data } = createBoard("t");
  api.outline(70, 50, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 5, side: "top", nets: { GND: "GND", GP2: "S1" } });
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: -17, side: "bottom", nets: { A: "S1" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 10, y: -17, side: "bottom", nets: { A: "S2" } });
  api.single("S2");
  api.route("S1", "U1.GP2", "K1.A", { via: true });
  const blocked = () => fieldFor(data, RULES, RULES.trackMm, 0.6).owner["F.Cu"].filter((v) => v !== 0).length;
  const without = blocked();
  api.pour("GND", "F.Cu");
  // The Pico's ground pads grow thermal spokes once the pour is declared: copper of GND that tracks must keep clear of.
  assert.ok(blocked() > without, "the spokes are in the map");
  assert.equal(staleCells(data), 0);
});

test("an outline drawn again after a route moves the edge in the router's map", () => {
  const { api, data } = createBoard("t");
  api.outline(80, 60, 2);
  api.place("kailh-mx-hotswap", { ref: "K1", x: -20, y: 0, side: "bottom", nets: { A: "SIG" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 20, y: 0, side: "bottom", nets: { A: "SIG" } });
  api.route("SIG", "K1.A", "K2.A");
  // The same number of cells each time (800 x 600), so only the outline itself tells the map the edge has moved.
  for (const [w, h, r] of [[80, 60, 12], [80.05, 60, 12], [80, 60.05, 2]]) {
    api.outline(w, h, r);
    assert.equal(staleCells(data), 0, `outline(${w}, ${h}, ${r})`);
  }
});

// ---- the main claims: a short and an open in the copper are found ----

/** Two sockets on the back, one above the other, their A pads on nets `a` and `b` ("" for none), 25 mm apart in a
 * straight line that crosses nothing else. */
function stacked(a: string, b: string) {
  const { api, data } = createBoard("t");
  api.outline(40, 50, 1);
  api.place("kailh-mx-hotswap", { ref: "K1", x: 0, y: -15, side: "bottom", nets: a ? { A: a } : {} });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 0, y: 10, side: "bottom", nets: b ? { A: b } : {} });
  api.single(...[a, b].filter(Boolean));
  return { api, data, from: api.pad("K1.A"), to: api.pad("K2.A") };
}
const errorsOf = (data: BoardData) => audit(data, buildFab(data, RULES), RULES).errors;

test("a sliver of copper between two nets is a short, and so is one from an unconnected pad to ground", () => {
  const clean = stacked("S1", "S2");
  assert.deepEqual(errorsOf(clean.data), []);
  const { api, data, from, to } = stacked("S1", "S2");
  api.track("", "B.Cu", [[from.x, from.y], [to.x, to.y]], RULES.trackMinMm);
  assert.match(errorsOf(data).join("\n"), /short: net S1 and net S2 are in one piece of copper .*\(K1\.A, K2\.A\)/);
  // K2.A is on no net, so it is a net of its own: copper of GND that reaches it is a short too, not a join.
  const loose = stacked("GND", "");
  loose.api.track("GND", "B.Cu", [[loose.from.x, loose.from.y], [loose.to.x, loose.to.y]], RULES.trackMinMm);
  assert.match(errorsOf(loose.data).join("\n"), /short: net GND and an unconnected pad are in one piece of copper .*\(K1\.A, K2\.A\)/);
});

/** Cuts the board's first track in the middle of its longest segment, leaving `gap` mm between the two ends' centres. */
function cut(data: BoardData, gap: number) {
  const t = data.tracks[0];
  let k = 0;
  for (let i = 1; i + 1 < t.pts.length; i++)
    if (Math.hypot(t.pts[i + 1][0] - t.pts[i][0], t.pts[i + 1][1] - t.pts[i][1]) > Math.hypot(t.pts[k + 1][0] - t.pts[k][0], t.pts[k + 1][1] - t.pts[k][1])) k = i;
  const [a, b] = [t.pts[k], t.pts[k + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const h = gap / 2 / len;
  data.tracks.splice(0, 1, { ...t, pts: [...t.pts.slice(0, k + 1), at(0.5 - h)] }, { ...t, pts: [at(0.5 + h), ...t.pts.slice(k + 1)] });
}

test("a track cut through is an open net", () => {
  const { api, data } = stacked("S1", "S1");
  api.route("S1", "K1.A", "K2.A");
  assert.deepEqual(errorsOf(data), []);
  // 0.5 mm between the cut ends' centres: 0.2 mm of bare board between the round ends of a 0.3 mm track.
  cut(data, 0.5);
  assert.match(errorsOf(data).join("\n"), /net S1 is not connected: K1\.A, K2\.A fall in 2 separate pieces of copper/);
});

// ---- the intent check: the drawn nets against design.json ----

/** A two-key keypad as board code would draw it, for the intent check: a Pico and two sockets, each A pad to a GPIO
 * and each B pad to ground. `nets` changes the nets given to a part ("" leaves a pad on none). */
function keypad(nets: Partial<Record<"U1" | "K1" | "K2", Record<string, string>>> = {}) {
  const { api, data } = createBoard("t");
  api.outline(61, 70, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 5, y: 20, nets: { GND: "GND", GP2: "GP2", GP3: "GP3", ...nets.U1 } });
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: -15, side: "bottom", nets: { A: "GP2", B: "GND", ...nets.K1 } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 10, y: -15, side: "bottom", nets: { A: "GP3", B: "GND", ...nets.K2 } });
  return data;
}
const DESIGN: DesignIntent = { params: { keyRows: 1, keyCols: 2 }, keyMap: { K1: "GP2", K2: "GP3" } };
const intentErrors = (data: BoardData, design: DesignIntent = DESIGN) => checkIntent(data, design).errors;

test("the intended keypad passes the intent check, and drc.json is told its circuit", () => {
  const { errors, intent } = checkIntent(keypad(), DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual(intent, {
    controller: "U1",
    keys: { K1: { gpio: "GP2", pin: "U1.4" }, K2: { gpio: "GP3", pin: "U1.5" } },
    ground: { pads: ["K1.B", "K2.B"], pins: ["U1.3", "U1.8", "U1.13", "U1.18", "U1.23", "U1.28", "U1.33", "U1.38"] },
  });
});

test("a socket pad on no net is a dead key", () => {
  assert.match(intentErrors(keypad({ K2: { B: "" } })).join("\n"), /K2\.B has no net: a socket's two pads must both connect, or K2 is a dead key/);
  assert.match(intentErrors(keypad({ K1: { A: "" } })).join("\n"), /K1\.A has no net/);
});

test("a key on any pin but a GPIO fails: 3V3_EN, the supplies, RUN, ADC_VREF and the grounds", () => {
  const on = (pin: string) => intentErrors(keypad({ U1: { GP3: "", [pin]: "GP3" } })).join("\n");
  assert.match(on("3V3_EN"), /K2's net GP3 reaches U1 pin 37 \(3V3_EN\): a key may only pull a GPIO to ground/);
  for (const [pin, num] of [["VBUS", 40], ["VSYS", 39], ["3V3(OUT)", 36], ["RUN", 30], ["ADC_VREF", 35], ["AGND", 33]] as const)
    assert.ok(on(pin).includes(`K2's net GP3 reaches U1 pin ${num} (${pin}): a key may only pull a GPIO to ground`), on(pin));
  // A key straight to ground reads as always pressed.
  assert.match(intentErrors(keypad({ K2: { A: "GND" } })).join("\n"), /K2's net GND reaches U1 pins 3, 8, 13, 18, 23, 28 and 38 \(GND\): a key may only/);
});

test("two keys on one GPIO fail, on the board and in keyMap", () => {
  assert.match(intentErrors(keypad({ K2: { A: "GP2" } })).join("\n"), /GP2 \(net GP2\) serves 2 keys, K1 and K2: each key needs a GPIO of its own/);
  assert.match(intentErrors(keypad(), { ...DESIGN, keyMap: { K1: "GP2", K2: "GP2" } }).join("\n"), /design\.json keyMap puts K1 and K2 on GP2: each key needs a GPIO of its own/);
  // One key's net joined to two GPIOs is wrong too.
  assert.match(intentErrors(keypad({ U1: { GP4: "GP3" } })).join("\n"), /K2's net GP3 joins U1 pin 5 \(GP3\) and U1 pin 6 \(GP4\): each key needs one GPIO/);
});

test("a B pad that does not reach the Pico's ground fails, and so does a ground that reaches a supply", () => {
  assert.match(intentErrors(keypad({ K2: { B: "GNDX" } })).join("\n"), /K2\.B is on net GNDX, which reaches no GND pin of U1: the key could never pull its GPIO low/);
  assert.match(intentErrors(keypad({ U1: { VBUS: "GND" } })).join("\n"), /the keys' ground, net GND, reaches U1 pin 40 \(VBUS\), which is not a ground/);
});

test("a key wired to another GPIO than keyMap says, a GPIO the Pico keeps on board, or a stray net fails", () => {
  assert.match(intentErrors(keypad(), { ...DESIGN, keyMap: { K1: "GP3", K2: "GP2" } }).join("\n"),
    /K1 is wired to GP2 \(U1 pin 4\), but design\.json's keyMap says GP3 \(U1 pin 5\)/);
  assert.match(intentErrors(keypad(), { ...DESIGN, keyMap: { K1: "GP25", K2: "GP3" } }).join("\n"), /keyMap puts K1 on GP25, which is not on the Pico's edge: the Pico uses it for the LED/);
  assert.match(intentErrors(keypad(), { params: DESIGN.params }).join("\n"), /design\.json has no keyMap/);
  assert.match(intentErrors(keypad(), { params: { keyRows: 1, keyCols: 3 }, keyMap: DESIGN.keyMap }).join("\n"), /keyMap gives no GPIO for K3[^]*the board places no socket K3/);
  assert.match(intentErrors(keypad({ U1: { VBUS: "5V", VSYS: "5V" } })).join("\n"), /net 5V joins U1 pin 39 \(VSYS\) and U1 pin 40 \(VBUS\), which design\.json's intent leaves unconnected/);
});

test("a mirrored Pico fails: its pads are not where the reference has them, and the keys land on 3V3_EN and 3V3(OUT)", () => {
  const real = FOOTPRINTS["rpi-pico-castellated"];
  FOOTPRINTS["rpi-pico-castellated"] = (rules, opts) => {
    const fp = real(rules, opts);
    return { ...fp, pads: fp.pads.map((p) => ({ ...p, y: -p.y, spokes: p.spokes?.map(([x, y]) => [x, -y] as Pt) })) };
  };
  try {
    const errors = intentErrors(keypad()).join("\n");
    assert.match(errors, /footprint: U1 \(rpi-pico-castellated\) does not match its reference, Raspberry Pi Pico/);
    assert.match(errors, /K1's net GP2 reaches U1 pin 37 \(3V3_EN\)/);
    assert.match(errors, /K2's net GP3 reaches U1 pin 36 \(3V3\(OUT\)\)/);
  } finally {
    FOOTPRINTS["rpi-pico-castellated"] = real;
  }
  assert.deepEqual(intentErrors(keypad()), []);
});

test("a board that fails the intent check gets drc.json's errors and no zip", async () => {
  // The macropad as it is, but with two keys swapped in design.json's keyMap: the DRC passes, the intent does not.
  const here = process.cwd(), tmp = mkdtempSync(join(tmpdir(), "distinta-intent-"));
  const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
  for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
  const design = JSON.parse(readFileSync(join(dst, "design.json"), "utf8"));
  [design.keyMap.K1, design.keyMap.K2] = [design.keyMap.K2, design.keyMap.K1];
  writeFileSync(join(dst, "design.json"), JSON.stringify(design));
  const log = console.log;
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb("macropad"), false);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  const drc = JSON.parse(readFileSync(join(dst, "pcb", "drc.json"), "utf8"));
  assert.deepEqual(drc.errors, [
    // The assembly steps still tell the user the map the board wires, and keyMap now says another.
    "design.json's assembly tells the user K1 is on GP10, and keyMap, which the board is held to, puts it on GP7",
    "design.json's assembly tells the user K2 is on GP7, and keyMap, which the board is held to, puts it on GP10",
    "K1 is wired to GP10 (U1 pin 14), but design.json's keyMap says GP7 (U1 pin 10)",
    "K2 is wired to GP7 (U1 pin 10), but design.json's keyMap says GP10 (U1 pin 14)",
  ]);
  assert.ok(!existsSync(join(dst, "pcb", "macropad-gerbers.zip")));
  // board.json is still written, to see what is wrong; the netlist, a fab file, is not.
  assert.equal(JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8")).pads.length, 58);
  assert.ok(!existsSync(join(dst, "pcb", "macropad.d356")));
  rmSync(tmp, { recursive: true, force: true });
});

// ---- the fab profiles and the rules that cover them ----

test("our rules are at least as strict as every fab profile, and a looser rule is named", () => {
  assert.deepEqual(looserThanFabs(RULES), []);
  assert.ok(Object.isFrozen(FAB_PROFILES) && Object.values(FAB_PROFILES).every((p) => Object.isFrozen(p)));
  const loose = looserThanFabs({ ...RULES, clearanceMm: 0.12, pthRingMm: 0.25, viaDrillMaxMm: 0.6, silkPadGapMm: 0.05 });
  assert.deepEqual(loose, [
    "silkscreen to pad copper: ours 0.1 mm, JLCPCB's 0.15 mm",
    "copper to copper of another net: ours 0.12 mm, OSH Park's 0.1524 mm",
    "copper to copper of another net: ours 0.12 mm, Aisler's 0.15 mm",
    "largest via drill: ours 0.6 mm, Aisler's 0.45 mm",
    "plated component hole annular ring: ours 0.25 mm, Aisler's 0.3 mm",
    "silkscreen to pad copper: ours 0.1 mm, Aisler's 0.125 mm",
  ]);
});

test("drc.json says which fab profiles a board is inside, and why not", () => {
  // A Pico soldered through its own holes, 1.5 mm pads round 1 mm drills: a 0.25 mm ring, which JLCPCB, PCBWay and
  // OSH Park make and Aisler does not (0.3 mm for a component hole). Our rule is Aisler's, so it is an error too.
  const { api, data } = createBoard("t");
  api.outline(61, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, throughHoles: { drillMm: 1.0, padMm: 1.5 } });
  const a = audit(data, buildFab(data, RULES), RULES);
  assert.ok(a.errors.some((e) => /^U1\.1: annular ring 0\.25 mm is under the 0\.3 mm minimum for a component hole$/.test(e)), a.errors.join("\n"));
  assert.deepEqual(a.measured.pthRingMm, { mm: 0.25, at: "U1.1" });
  assert.deepEqual(Object.keys(a.fabs).filter((id) => a.fabs[id].ok), ["jlcpcb", "pcbway", "oshpark"]);
  assert.deepEqual(a.fabs.aisler.why, ["plated component hole annular ring is 0.25 mm (U1.1), under Aisler's 0.3 mm"]);
  // Two tracks 0.12 mm apart: inside JLCPCB's and PCBWay's 0.1 mm, not OSH Park's 0.1524 mm or Aisler's 0.15 mm.
  const { api: b, data: close } = createBoard("t");
  b.outline(20, 20, 1);
  b.track("A", "B.Cu", [[-5, 0], [5, 0]]);
  b.track("B", "B.Cu", [[-5, 0.42], [5, 0.42]]);
  const c = audit(close, buildFab(close, RULES), RULES);
  assert.ok(c.errors.some((e) => /clearance on B\.Cu: track A #1 \(A\) and track B #2 \(B\) are 0\.12 mm apart/.test(e)), c.errors.join("\n"));
  assert.deepEqual(Object.keys(c.fabs).filter((id) => c.fabs[id].ok), ["jlcpcb", "pcbway"]);
  assert.match(c.fabs.oshpark.why.join("\n"), /^copper to copper of another net is 0\.12 mm \(track A #1 \(A\) and track B #2 \(B\) on B\.Cu near .*\), under OSH Park's 0\.1524 mm$/);
  assert.match(c.fabs.aisler.why.join("\n"), /under Aisler's 0\.15 mm$/);
});

test("a via over 0.45 mm or with a ring under 0.2 mm fails, and so does a component hole under 0.5 mm", () => {
  const errs = (draw: (api: ReturnType<typeof createBoard>["api"]) => void) => {
    const { api, data } = createBoard("t");
    api.outline(61, 40, 1);
    draw(api);
    return errorsOf(data).join("\n");
  };
  assert.equal(errs((api) => api.via("V", 0, 0)), "");
  assert.match(errs((api) => api.via("V", 0, 0, { drill: 0.5, dia: 1.0 })), /^via \(0\.00, 0\.00\): drill 0\.5 mm is over the 0\.45 mm a via may have/);
  assert.match(errs((api) => api.via("V", 0, 0, { drill: 0.4, dia: 0.7 })), /^via \(0\.00, 0\.00\): annular ring 0\.15 mm is under the 0\.2 mm minimum for a via$/);
  const pico = (drillMm: number, padMm: number) => errs((api) => api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, throughHoles: { drillMm, padMm } }));
  assert.equal(pico(1.0, 1.6), "");
  assert.match(pico(0.45, 1.1), /U1\.1: plated hole 0\.45 mm is under the 0\.5 mm minimum for a component hole/);
});

test("silkscreen keeps 0.15 mm from every mask opening, and a line closer than that fails", () => {
  const { api, data } = createBoard("t");
  api.outline(61, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0 });
  const fab = buildFab(data, RULES);
  const clean = audit(data, fab, RULES);
  assert.deepEqual(clean.errors, []);
  // The Pico's outline crosses its pad rows: the clip leaves it 0.15 mm from each opening, 0.2 mm from the copper.
  assert.ok(clean.measured.silkPadMm!.mm >= RULES.silkPadGapMm + RULES.maskExpandMm - 0.005, JSON.stringify(clean.measured.silkPadMm));
  const pad = data.pads.find((p) => p.ref === "U1" && p.num === "3")!;
  const line = (gap: number) => {
    const x = pad.x + pad.w / 2 + RULES.maskExpandMm + gap + RULES.silkLineMm / 2;
    return audit(data, { ...fab, silk: { ...fab.silk, strokes: [...fab.silk.strokes, { width: RULES.silkLineMm, pts: [[x, pad.y - 0.5], [x, pad.y + 0.5]] }] } }, RULES).errors.join("\n");
  };
  assert.equal(line(0.16), "");
  assert.match(line(0.1), /^silkscreen at \(.*\) is 0\.1 mm from U1\.3's opening, the rule is 0\.15 mm$/);
  assert.match(line(-0.1), /^silkscreen at \(.*\) is over U1\.3's opening$/);
});

/** A Pico on a ground pour on the top, its ground pins on the pour's net. */
function picoOnPour() {
  const { api, data } = createBoard("t");
  api.outline(61, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  api.pour("GND", "F.Cu");
  return { api, data };
}

test("each Pico ground pad reaches the pour by two spokes; one spoke, or one that ends in a keepout, is a starved thermal", () => {
  const { data } = picoOnPour();
  const ground = data.pads.filter((p) => p.net === "GND");
  assert.equal(ground.length, 7);
  assert.equal(spokes(data, RULES, "F.Cu").length, 2 * ground.length);
  assert.deepEqual(errorsOf(data), []);
  // The footprint as it was: one spoke from each pad, straight out.
  const real = FOOTPRINTS["rpi-pico-castellated"];
  FOOTPRINTS["rpi-pico-castellated"] = (rules, opts) => {
    const fp = real(rules, opts);
    return { ...fp, pads: fp.pads.map((p) => ({ ...p, spokes: p.spokes && [[0, Math.sign(p.spokes[0][1])] as Pt] })) };
  };
  try {
    const errors = errorsOf(picoOnPour().data).filter((e) => /starved/.test(e));
    assert.equal(errors.length, 7);
    assert.equal(errors[0], "starved thermal: U1.3 reaches the pour on F.Cu by 1 spoke, the rule is 2");
  } finally {
    FOOTPRINTS["rpi-pico-castellated"] = real;
  }
  // A pour keepout where one of U1.3's spokes ends: that spoke joins nothing.
  const { api, data: cut } = picoOnPour();
  const [x, y] = spokes(cut, RULES, "F.Cu").find((s) => s.pad.num === "3")!.b;
  api.keepout("F.Cu", [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]], { tracks: false, pour: true });
  assert.deepEqual(errorsOf(cut).filter((e) => /starved/.test(e)), ["starved thermal: U1.3 reaches the pour on F.Cu by 1 spoke, the rule is 2"]);
});

// ---- the netlist in the files: IPC-D-356A and the Gerbers' X2 attributes ----

test("the netlist file holds every pad, via and hole of the board, on its net or N/C, and reads back", () => {
  const { api, data } = createBoard("t");
  api.outline(61, 70, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 5, y: 20, nets: { GND: "GND", GP2: "GP2", GP3: "A_LONG_NET_NAME_GP3" } });
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: -15, side: "bottom", nets: { A: "GP2", B: "GND" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 10, y: -15, side: "bottom", nets: { A: "A_LONG_NET_NAME_GP3", B: "GND" } });
  api.via("GND", -5, -5);
  api.hole(0, -30, 3.4, { ref: "M3" });
  const text = d356("t", data);
  assert.match(text, /^P {2}UNITS CUST 0$/m);
  assert.match(text, /^P {2}NNAME1 A_LONG_NET_NAME_GP3$/m);
  const recs = readD356(text);
  const count = (code: number) => recs.filter((r) => r.code === code).length;
  // 40 Pico pads and 2 x 2 socket pads (SMD), the via, and 4 USB-shell, 2 x 5 socket and 1 M3 holes.
  assert.deepEqual([count(327), count(317), count(367)], [44, 1, 15]);
  const on = (net: string) => recs.filter((r) => r.net === net).map((r) => `${r.ref}-${r.pin}`).sort();
  assert.deepEqual(on("GP2"), ["K1-A", "U1-4"]);
  assert.deepEqual(on("A_LONG_NET_NAME_GP3"), ["K2-A", "U1-5"]);
  assert.deepEqual(on("GND"), ["K1-B", "K2-B", "U1-13", "U1-18", "U1-23", "U1-28", "U1-3", "U1-38", "U1-8", "VIA-"]);
  // Every pad on no net is in the file, as N/C: the 31 Pico pins left free (VBUS and AGND among them) and the 15 holes.
  assert.equal(recs.filter((r) => r.net === "N/C").length, 46);
  const vbus = recs.find((r) => r.ref === "U1" && r.pin === "40")!, pad = data.pads.find((p) => p.ref === "U1" && p.num === "40")!;
  assert.deepEqual([vbus.net, vbus.code, vbus.access, vbus.mask], ["N/C", 327, 1, 2]);
  assert.ok(Math.abs(vbus.x - pad.x) < 0.0013 && Math.abs(vbus.y - pad.y) < 0.0013 && Math.abs(vbus.h - 3.2) < 0.0013);
  const via = recs.find((r) => r.ref === "VIA")!;
  assert.deepEqual([via.code, via.mid, via.plated, via.access, via.mask, via.h], [317, true, true, 0, 3, 0]);
  assert.equal(checkD356(data, text), undefined);
  // Each record in its columns, as IPC-D-356A (and gerbonara) read them.
  const k1 = text.split("\n").find((l) => l.startsWith("327GP2") && l.includes("K1    -A"))!;
  assert.deepEqual([k1.length, k1[32], k1[38], k1[41], k1[49], k1[57], k1[62], k1[67], k1[72]], [74, " ", "A", "X", "Y", "X", "Y", "R", "S"]);
  // A record on the wrong net, a record lost, and a pad moved by a tenth of a millimetre are each caught.
  assert.match(checkD356(data, text.replace(k1, k1.replace("GP2 ", "GND "))) ?? "", /327 K1-A at .* reads back with net "GND", not "GP2"/);
  assert.match(checkD356(data, text.replace(`${k1}\n`, "")) ?? "", /^60 records on the board but 59 in the file$/);
  const x = Number(k1.slice(42, 49)) + 39;
  const moved = `${k1.slice(0, 42)}${x < 0 ? "-" : "+"}${String(Math.abs(x)).padStart(6, "0")}${k1.slice(49)}`;
  assert.match(checkD356(data, text.replace(k1, moved)) ?? "", /reads back with x .* mm, not .* mm/);
  // Every line is at most 80 columns, the comments too (split between words), for a slug as long as any.
  const long = d356("a-product-with-a-name-as-long-as-a-slug-may-be-and-then-more", data);
  assert.deepEqual(long.split("\n").filter((l) => l.length > 80), []);
  assert.ok(long.split("\n").filter((l) => l.startsWith("C  ")).length >= 4);
  assert.equal(readD356(long).length, recs.length);
});

test("a ref over 6 characters, a pad number over 4 or either with a space is refused where it is placed, not truncated in the .d356", () => {
  const { api } = createBoard("t");
  api.outline(61, 70, 1);
  api.place("kailh-mx-hotswap", { ref: "KEY101", x: 0, y: 0, side: "bottom" }); // six is as many as fit
  assert.throws(() => api.place("kailh-mx-hotswap", { ref: "SWITCH1", x: 0, y: 0, side: "bottom" }),
    /^Error: place\("kailh-mx-hotswap"\): ref "SWITCH1" is longer than 6 characters or has a space: the IPC-D-356A netlist a fab tests the board against has 6 columns for it$/);
  assert.throws(() => api.place("kailh-mx-hotswap", { ref: "K 1", x: 0, y: 0, side: "bottom" }), /ref "K 1" is longer than 6 characters or has a space/);
  assert.throws(() => api.hole(0, -30, 3.4, { ref: "SCREW_1" }), /hole ref "SCREW_1" is longer than 6 characters/);
  const real = FOOTPRINTS["kailh-mx-hotswap"];
  FOOTPRINTS["kailh-mx-hotswap"] = (rules, opts) => ({ ...real(rules, opts), pads: real(rules, opts).pads.map((d) => ({ ...d, num: `PIN_${d.num}` })) });
  try {
    assert.throws(() => api.place("kailh-mx-hotswap", { ref: "K2", x: 0, y: 0, side: "bottom" }), /K2: pad number "PIN_A" is longer than 4 characters or has a space/);
  } finally {
    FOOTPRINTS["kailh-mx-hotswap"] = real;
  }
});

test("a Pico soldered through its holes has two pads a pin, and routing to the pin's name takes its castellation", () => {
  const { api, data } = createBoard("t");
  api.outline(61, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, throughHoles: { drillMm: 1.0, padMm: 1.6 } });
  assert.equal(data.pads.filter((p) => p.ref === "U1" && p.name === "GP2").length, 2);
  const pad = api.pad("U1.GP2");
  assert.deepEqual([pad.num, pad.layers], ["4", ["F.Cu"]]);
  assert.throws(() => api.pad("U1.GND"), /pad "U1\.GND" is ambiguous \(7 pins are named GND\): use the pad number/);
});

test("copper carries its net, part and pin as X2 attributes, and a file whose attributes differ is caught", () => {
  const { api, data } = picoOnPour();
  api.track("X", "F.Cu", [[-10, 15], [10, 15]]);
  const fab = buildFab(data, RULES);
  const top = fab.layers[0], text = gerber("t", top);
  assert.match(text, /%TO\.N,GND\*%\nG36\*/); // the pour
  assert.match(text, /%TO\.N,GND\*%\n%TO\.P,U1,3,GND\*%\n%TO\.C,U1\*%\n(D\d+\*\n)?X\d+Y\d+D03\*/); // a ground pad
  assert.match(text, /%TO\.N,N\/C\*%\n%TO\.P,U1,40,VBUS\*%\n%TO\.C,U1\*%/); // a pad on no net
  assert.match(text, /%TO\.N,X\*%\n(D\d+\*\n)?X-10000000Y15000000D02\*/); // the track
  // Every piece of copper has its net, and the cut-outs have none.
  const items = readBack(text);
  assert.ok(items.every((it) => (it.pol === "C" ? !it.attrs : !!it.attrs?.net)));
  assert.equal(checkGerber(top, text), undefined);
  assert.match(checkGerber(top, text.replace("%TO.N,X*%", "%TO.N,Y*%")) ?? "", /has the attributes %TO\.N,Y\*%, not %TO\.N,X\*%/);
  assert.match(checkGerber(top, text.replace("%TO.P,U1,3,GND*%", "%TO.P,U1,4,GND*%")) ?? "", /%TO\.P,U1,4,GND\*%.*, not .*%TO\.P,U1,3,GND\*%/);
  // The masks, the silkscreen and the outline carry none.
  for (const l of fab.layers.slice(2)) assert.doesNotMatch(gerber("t", l), /%TO/);
});

// ---- the harness: the netlist, board.json and a fingerprint of what the board code reads ----

test("the board code's reads of design.json and bom.json are watched, and listing an object reads all of it", () => {
  const seen = new Set<string>();
  const o = watch({ a: 1, b: { c: 2 }, d: 3 }, seen);
  assert.equal(o.a + o.b.c, 3);
  assert.deepEqual([...seen].sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(o), ["a", "b", "d"]);
  assert.ok(seen.has("*"));
});

test("the harness writes the netlist and board.json, and an edit stales the audit only where the board code reads", async () => {
  const here = process.cwd(), tmp = mkdtempSync(join(tmpdir(), "distinta-reads-"));
  const dst = join(tmp, "products", "tiny");
  mkdirSync(join(dst, "cad"), { recursive: true });
  writeFileSync(join(dst, "cad", "pcb.mjs"), `export default function board({ pcb, design, bom }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  pcb.pour("GND", "F.Cu");
  pcb.text("F.Silk", 0, 16, design.slug + " " + bom.lines.length, 2);
}
`);
  const design = { slug: "tiny", summary: "a test board", params: {} }, bom = { slug: "tiny", units: 1, lines: [] as unknown[] };
  const write = (file: string, v: unknown) => writeFileSync(join(dst, file), JSON.stringify(v));
  write("design.json", design);
  write("bom.json", bom);
  const log = console.log;
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb("tiny"), true);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  const drc = JSON.parse(readFileSync(join(dst, "pcb", "drc.json"), "utf8"));
  assert.deepEqual(drc.reads, { design: ["slug"], bom: ["lines"] });
  assert.ok(Object.values(drc.fabs as Record<string, { ok: boolean }>).every((f) => f.ok));
  const board = JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8"));
  assert.equal(board.inputs, drc.inputs);
  assert.equal(board.pads.length, 40);
  assert.deepEqual(board.nets.GND, ["U1.3", "U1.8", "U1.13", "U1.18", "U1.23", "U1.28", "U1.38"]);
  assert.equal(board.files["F.Cu"], "tiny-F_Cu.gtl");
  assert.equal(readD356(readFileSync(join(dst, "pcb", "tiny.d356"), "utf8")).length, 44);
  assert.equal(drc.inputs, inputsHash(dst, drc.reads));
  assert.ok(drcAudit(dst).ok, drcAudit(dst).detail);
  // The audit alone does not pass the zip: nothing but our own code has read it yet (readback.test.ts reads it).
  assert.match(gerbersAudit(dst).detail, /no pcb\/readback\.json/);
  // design.json's summary and bom.json's units are not read by this board: the audit stays current.
  write("design.json", { ...design, summary: "another text" });
  write("bom.json", { ...bom, units: 5 });
  assert.ok(drcAudit(dst).ok, drcAudit(dst).detail);
  // Its slug and the BOM's lines are: an edit to either is a board the audit has not seen.
  write("bom.json", { ...bom, lines: [{ id: "x" }] });
  assert.match(gerbersAudit(dst).detail, /of an earlier board/);
  write("bom.json", bom);
  write("design.json", { ...design, slug: "tinier" });
  assert.match(drcAudit(dst).detail, /of an earlier board/);
  write("design.json", design);
  // So is design.json's assembly text, which the intent check holds to keyMap.
  write("design.json", { ...design, assembly: ["Fit K1 GP2 first."] });
  assert.match(drcAudit(dst).detail, /of an earlier board/);
  write("design.json", design);
  assert.ok(drcAudit(dst).ok, drcAudit(dst).detail);
  rmSync(tmp, { recursive: true, force: true });
});

test("the fingerprint follows the modules the board code imports, and theirs, but not a package", () => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-imports-"));
  try {
    const cad = join(tmp, "cad");
    mkdirSync(join(tmp, "shared"), { recursive: true });
    mkdirSync(cad);
    writeFileSync(join(cad, "pcb.mjs"), `import { keys } from "./keys.mjs";\nimport { join } from "node:path";\nexport default function board({ pcb }) { keys(pcb); }\n`);
    writeFileSync(join(cad, "keys.mjs"), `export { pitch } from "../shared/grid.js";\nexport const keys = async (pcb) => (await import("./more.mjs")).more(pcb);\n`);
    writeFileSync(join(tmp, "shared", "grid.js"), "export const pitch = 19.05;\n");
    writeFileSync(join(cad, "more.mjs"), "export const more = () => {};\n");
    writeFileSync(join(tmp, "design.json"), JSON.stringify({ params: {} }));
    assert.deepEqual(boardModules(join(cad, "pcb.mjs")).map((f) => f.slice(tmp.length + 1)), ["cad/pcb.mjs", "cad/keys.mjs", "shared/grid.js", "cad/more.mjs"]);
    let last = inputsHash(tmp);
    for (const f of ["cad/keys.mjs", "shared/grid.js", "cad/more.mjs"]) {
      writeFileSync(join(tmp, f), `${readFileSync(join(tmp, f), "utf8")}// an edit\n`);
      const now = inputsHash(tmp);
      assert.notEqual(now, last, f);
      last = now;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
