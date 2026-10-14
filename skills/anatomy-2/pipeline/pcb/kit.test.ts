// Tests of the PCB kit's own guarantees, on small boards built in memory. Run them with
//   node --test skills/anatomy-2/pipeline/pcb/kit.test.ts
// They use only node:test: the skill has no dependencies.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "./drc.ts";
import { createBoard } from "./board.ts";
import { fieldFor, LAYERS } from "./field.ts";
import { checkGerber, gerber, readBack } from "./gerber.ts";
import { buildFab } from "./layers.ts";
import { newRaster, paint } from "./raster.ts";
import { route } from "./router.ts";
import { RULES } from "./rules.ts";
import { thin } from "./thin.ts";
import type { BoardData, GerberLayer, Item } from "./types.ts";

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

/** K1 on the top and K2 on the back, joined by SIG: a route between them needs one via. */
function forcedVia() {
  const { api, data } = createBoard("t");
  api.outline(50, 30, 1);
  api.place("kailh-mx-hotswap", { ref: "K1", x: -10, y: 0, side: "top", nets: { A: "SIG" } });
  api.place("kailh-mx-hotswap", { ref: "K2", x: 10, y: 0, side: "bottom", nets: { A: "SIG" } });
  return { api, data };
}

test("a cost that is not a number from 0 up is refused, and a dear via is searched as fast as a cheap one", () => {
  const { api, data } = forcedVia();
  for (const key of ["viaCost", "topCost", "turnCost"] as const)
    for (const v of [Infinity, NaN, -1, 1e7, "30"])
      assert.throws(() => api.route("SIG", "K1.A", "K2.A", { via: true, [key]: v as number }), new RegExp(`${key} must be a number from 0 to 1000000, got `));
  assert.deepEqual([data.tracks, data.vias], [[], []]);
  // The distance map keeps a bucket for every cost a step can add: a via of 100 cells has 10,000, one of 5,000 would
  // have 500,000 and one of a million 100 million, so those wait in a heap instead. The via is forced, so the route is
  // the same and costs exactly what the via costs more.
  const run = (viaCost: number) => forcedVia().api.route("SIG", "K1.A", "K2.A", { via: true, viaCost });
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
