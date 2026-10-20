// The drawing kit's camera (kit/iso-kit.mjs, kit/lathe.mjs, kit/audit.mjs). Sprue changes one thing in Anatomy's
// kit: iso() is right-handed, so a figure drawn in the CAD's frame comes out the right way round, not as its mirror
// image. The camera sits where it did (the same faces turn toward you, the same depth), the light stays on the
// screen's upper left, and face text still reads the right way round. `leftHanded: true` gives back Anatomy's
// projection and light exactly, for art that is not of a CAD (the site's emblem). Run them with
//   node --test skills/sprue/pipeline/projection.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";

type Vec3 = [number, number, number];
type Camera = { origin: number[]; scale: number; azimuth: number; elevation: number; leftHanded?: boolean };

/** [azimuth, elevation]: the default, the keypad's -40, Ponder's 52, and cameras all round. */
const CAMERAS: [number, number][] = [[45, 30], [-40, 30], [52, 30], [10, 45], [80, 15], [135, 20], [-120, 60], [200, 30], [300, 40]];
const cam = (azimuth: number, elevation: number, more: Partial<Camera> = {}): Camera =>
  ({ origin: [320, 240], scale: 2, azimuth, elevation, ...more });
const RAD = Math.PI / 180;
const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const close = (a: number[], b: number[], what: string, eps = 1e-9) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < eps, `${what}: [${a.map((v) => v.toFixed(4))}] is not [${b.map((v) => v.toFixed(4))}]`));

/** Screen right and screen up as world directions, read off k.iso by finite differences, and toward the viewer
 * from k.depthOf. Screen y grows down, so up is minus its gradient. */
function axesOf(P: Camera) {
  const o = k.iso([0, 0, 0], P);
  const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => { const s = k.iso(e, P); return [s[0] - o[0], s[1] - o[1]]; });
  return {
    right: unit(cols.map((c) => c[0])),
    up: unit(cols.map((c) => -c[1])),
    toward: unit(([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => k.depthOf(e, P))),
  };
}

/** Anatomy's own projection (iso-kit.mjs at 454a0ef), written out with the same operations in the same order. */
function anatomyIso([x, y, z]: Vec3, P: Camera): [number, number] {
  const a = P.azimuth * (Math.PI / 180), e = P.elevation * (Math.PI / 180);
  const [sinA, cosA, sinE, cosE, kk] = [Math.sin(a), Math.cos(a), Math.sin(e), Math.cos(e), P.scale * Math.sqrt(1.6)];
  return [P.origin[0] + (x * sinA - y * cosA) * kk, P.origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * kk];
}

/** The mean screen x of every point in an SVG path. */
const meanX = (d: string) => {
  const xs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
  return xs.reduce((s, x) => s + x, 0) / xs.length;
};
/** An SVG matrix(a b c d e f) as text reads on it: det above 0 is not mirrored, and the baseline (a, b) running
 * right with the text's down (c, d) running down is the right way up, not turned half round. */
const textOf = (transform: string) => {
  const [a, b, c, d] = transform.slice(7, -1).split(" ").map(Number);
  return { det: a * d - b * c, rightward: a > 0, downward: d > 0 };
};

test("iso is right-handed: screen right x screen up is toward the viewer, at every camera", () => {
  for (const [a, e] of CAMERAS) {
    const { right, up, toward } = axesOf(cam(a, e));
    close(G.cross3(right, up), toward, `azimuth ${a}, elevation ${e}: right x up`);
  }
});

test("the camera is where Anatomy put it: the same depth and screen height, only screen x is mirrored", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e);
    close(k.towardViewer(P), [Math.cos(a * RAD), Math.sin(a * RAD)], `azimuth ${a}: toward the viewer`);
    close(axesOf(P).toward, [Math.cos(a * RAD) * Math.cos(e * RAD), Math.sin(a * RAD) * Math.cos(e * RAD), Math.sin(e * RAD)], `azimuth ${a}: depth`);
    for (const p of [[12, -7, 3], [-30, 18, -9], [0, 0, 25]] as Vec3[]) {
      const [x, y] = k.iso(p, P), [ox, oy] = anatomyIso(p, P);
      close([x - P.origin[0], y], [-(ox - P.origin[0]), oy], `azimuth ${a}: [${p}] on screen`, 1e-9);
    }
  }
});

test("a CAD point at +x lands where a right-handed camera puts it: right of the origin at the keypad's -40", () => {
  const P = cam(-40, 30);
  const [o, px, py] = ([[0, 0, 0], [10, 0, 0], [0, -10, 0]] as Vec3[]).map((p) => k.iso(p, P));
  assert.ok(px[0] > o[0] + 1, `+x drew at screen x ${px[0].toFixed(1)}, left of the origin at ${o[0].toFixed(1)}`);
  assert.ok(py[0] < o[0] - 1, "-y should draw left of the origin at azimuth -40");
  // At the default 45 the camera is on the +x +y diagonal: +x goes left, +y right, as a photo from there shows them.
  const D = cam(45, 30);
  assert.ok(k.iso([10, 0, 0], D)[0] < k.iso([0, 0, 0], D)[0] && k.iso([0, 10, 0], D)[0] > k.iso([0, 0, 0], D)[0]);
});

test("extrude lights the side that faces the screen's left, at every camera", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e);
    const { shades } = k.cylinder(0, 0, 10, 0, 6, P, 48);
    const filled = shades.map((d: string, i: number) => [i, d] as const).filter(([, d]) => d);
    const [darkest, lightest] = [filled[0], filled[filled.length - 1]];
    assert.equal(lightest[0], 3, `azimuth ${a}: no side is in the lightest tone`);
    assert.ok(meanX(lightest[1]) < k.iso([0, 0, 0], P)[0] && meanX(darkest[1]) > k.iso([0, 0, 0], P)[0],
      `azimuth ${a}, elevation ${e}: the lightest sides are not on the screen's left`);
  }
});

test("lathe's light is on the screen's upper left, at every camera", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e);
    const { right, up } = axesOf(P);
    const L = G.lightOf(P);
    assert.ok(G.dot3(L, right) < -0.5, `azimuth ${a}: the light is not on the screen's left`);
    assert.ok(G.dot3(L, up) > 0.2, `azimuth ${a}, elevation ${e}: the light is not above`);
    const left = right.map((v) => -v);
    assert.ok(G.toneOf(left, P) > G.toneOf(right, P), `azimuth ${a}: a face turned left is not lighter than one turned right`);
  }
});

test("audit's camera basis is the projection iso draws, and right-handed", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e);
    const { R, D, V, k: kk } = A.cameraBasis(P);
    const o = k.iso([0, 0, 0], P);
    for (const p of [[12, -7, 3], [-30, 18, -9]] as Vec3[]) {
      const s = k.iso(p, P);
      close([s[0] - o[0], s[1] - o[1]], [kk * G.dot3(R, p), kk * G.dot3(D, p)], `azimuth ${a}: cameraBasis against iso`, 1e-6);
    }
    close(G.cross3(R, D.map((v: number) => -v)), V, `azimuth ${a}: R x up`);
  }
});

test("face text reads the right way round and the right way up, on a top face and on both sides", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e);
    for (const along of ["x", "y"]) assert.ok(textOf(k.topMatrix([3, 4], 2, P, along)).det > 0, `azimuth ${a}: topMatrix along ${along} is mirrored`);
  }
  // The faces' names hold for an azimuth from 0 to 90, as in Anatomy: there the text also runs left to right.
  for (const a of [10, 38, 45, 52, 80]) {
    const P = cam(a, 30);
    for (const along of ["x", "y"]) {
      const t = textOf(k.topMatrix([3, 4], 2, P, along));
      assert.ok(t.rightward && t.downward, `azimuth ${a}: topMatrix along ${along} reads backwards or upside down`);
    }
    for (const face of ["left", "right"]) {
      const t = textOf(k.sideMatrix([3, 4], 2, P, face));
      assert.ok(t.det > 0 && t.rightward && t.downward, `azimuth ${a}: sideMatrix ${face} is mirrored or upside down`);
    }
    // "left" is the face across x, the one on the screen's left; "right" the face across y. To read the right way
    // round, the text's baseline runs along +y on the face across x and along -x on the face across y, with its down
    // along -z; on a top face, along "x" runs toward -x and along "y" toward +y.
    const { right } = axesOf(P);
    assert.ok(right[0] < 0 && right[1] > 0, `azimuth ${a}: the +x face is not on the screen's left`);
    const o = k.iso([3, 4, 2], P);
    const image = (d: Vec3) => { const s = k.iso([3 + d[0], 4 + d[1], 2 + d[2]], P); return [s[0] - o[0], s[1] - o[1]]; };
    const columns = (m: string) => { const [p, q, r, s] = m.slice(7, -1).split(" ").map(Number); return [[p, q], [r, s]]; };
    const [left, across] = (["left", "right"] as const).map((face) => columns(k.sideMatrix([3, 4], 2, P, face)));
    close(left[0], image([0, 1, 0]), `azimuth ${a}: sideMatrix left is not on the face across x`, 1e-3);
    close(across[0], image([-1, 0, 0]), `azimuth ${a}: sideMatrix right is not on the face across y`, 1e-3);
    for (const m of [left, across]) close(m[1], image([0, 0, -1]), `azimuth ${a}: side text's down is not -z`, 1e-3);
    close(columns(k.topMatrix([3, 4], 2, P, "x"))[0], image([-1, 0, 0]), `azimuth ${a}: topMatrix along x does not run along x`, 1e-3);
    close(columns(k.topMatrix([3, 4], 2, P, "y"))[0], image([0, 1, 0]), `azimuth ${a}: topMatrix along y does not run along y`, 1e-3);
  }
});

/** The winding number of a closed SVG path (M, L and Z only) round a screen point: 0 is outside, under nonzero fill. */
function windingOf(d: string, [px, py]: number[]) {
  let turns = 0;
  for (const ring of d.split("M").filter(Boolean).map((sub) => [...sub.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]))) {
    let sum = 0;
    ring.forEach(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % ring.length];
      sum += Math.atan2((ax - px) * (by - py) - (ay - py) * (bx - px), (ax - px) * (bx - px) + (ay - py) * (by - py));
    });
    turns += Math.round(sum / (2 * Math.PI));
  }
  return turns;
}

test("a lathe's hole is open whichever way its frame points, with either hand", () => {
  // A washer, its bore at the s = 6 end: the fill must leave the bore's centre outside, or it paints over the bore.
  const washer = [[0, 4], [0, 10], [6, 10], [6, 4], [0, 4]];
  // The kit's JSDoc types `hole` from its default, null.
  const hole = (s: number, r: number) => [s, r] as unknown as null;
  for (const leftHanded of [false, true]) for (const axis of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as Vec3[]) {
    const P = cam(45, 30, { origin: [200, 200], scale: 8, leftHanded });
    const F = G.frameAlong([0, 0, 0], axis);
    const centre = k.iso(G.pointOf(F, 6, 0, 0) as Vec3, P);
    assert.equal(windingOf(G.lathe(washer, F, P, { hole: hole(6, 4) }).fill, centre), 0, `axis [${axis}]${leftHanded ? ", leftHanded" : ""}: the bore is filled`);
    assert.equal(windingOf(G.outlineOf([[0, 10], [6, 10]], F, P, { hole: hole(6, 9) }).fill, centre), 0, `axis [${axis}]: outlineOf's bore is filled`);
  }
});

test("radialTicks turns from -y toward +x: counterclockwise seen from above, on the screen as in the CAD", () => {
  for (const a of [10, 45, -40, 135]) {
    const P = cam(a, 30);
    const tips = [...k.radialTicks(0, 0, 10, 4, 1, 0, [1, 2], P, 0, 1.5 * Math.PI).major.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const c = k.iso([0, 0, 0], P);
    close(tips[0], k.iso([0, -10, 0], P), `azimuth ${a}: angle 0 is not -y`, 0.06);
    // Screen y grows down, so a turn that is counterclockwise to the eye has a negative cross product.
    const turn = tips.reduce((sum, [x, y], i) => { const [nx, ny] = tips[(i + 1) % tips.length]; return sum + (x - c[0]) * (ny - c[1]) - (y - c[1]) * (nx - c[0]); }, 0);
    assert.ok(turn < 0, `azimuth ${a}: radialTicks runs clockwise on the screen`);
  }
});

// Anatomy's kit at 454a0ef, k.slabOf({ x: -10, y: -6, w: 20, d: 12, r: 3 }, 0, 5, P, 2, 0.8) at the keypad's camera.
const ANATOMY_SLAB = {
  fill: "M75.2 73.7L77 70.9L99.8 57.4L104.9 56L110.4 56.9L122.1 61.8L124.8 64.4L124.8 75.3L123 78.1L100.2 91.7L95.1 93L89.6 92.1L77.9 87.3L75.2 84.7Z",
  outline: "M75.2 73.7L77 70.9L99.8 57.4L104.9 56L110.4 56.9L122.1 61.8L124.8 64.4M124.8 75.3L123 78.1L100.2 91.7L95.1 93L89.6 92.1L77.9 87.3L75.2 84.7M75.2 73.7L75.2 84.7M124.8 64.4L124.8 75.3",
  crease: "M124.8 64.4L123 67.1L100.2 80.7L95.1 82L89.6 81.2L77.9 76.3L75.2 73.7",
  top: "M100.2 80.7L95.1 82L89.6 81.2L77.9 76.3L75.2 73.7L77 70.9L99.8 57.4L104.9 56L110.4 56.9L122.1 61.8L124.8 64.4L123 67.1Z",
  shades: [
    "M124.8 75.3L123 78.1L123 67.1L124.8 64.4ZM123 78.1L100.2 91.7L100.2 80.7L123 67.1Z",
    "M100.2 91.7L95.1 93L95.1 82L100.2 80.7Z",
    "M95.1 93L89.6 92.1L89.6 81.2L95.1 82Z",
    "M89.6 92.1L77.9 87.3L77.9 76.3L89.6 81.2ZM77.9 87.3L75.2 84.7L75.2 73.7L77.9 76.3Z",
  ],
  bevel: "M124.8 64.4L121.2 66.7L99 79.9L94.9 81L90.5 80.3L79.5 75.7L75.2 73.7",
};

test("leftHanded: true is Anatomy's projection, light and face text, exactly", () => {
  for (const [a, e] of CAMERAS) {
    const P = cam(a, e, { leftHanded: true });
    for (const p of [[12, -7, 3], [-30, 18, -9], [0.1, 0.2, 0.3]] as Vec3[]) assert.deepEqual(k.iso(p, P), anatomyIso(p, P));
    const [sinA, cosA] = [Math.sin(a * (Math.PI / 180)), Math.cos(a * (Math.PI / 180))];
    assert.deepEqual(G.lightOf(P), G.unit3([-sinA, cosA, 1.2]));
    assert.deepEqual(A.cameraBasis(P).R, [sinA, -cosA, 0]);
  }
  const P = { origin: [100, 80], scale: 2, azimuth: -40, elevation: 30, leftHanded: true };
  assert.deepEqual(k.slabOf({ x: -10, y: -6, w: 20, d: 12, r: 3 }, 0, 5, P, 2, 0.8), ANATOMY_SLAB);
  // Face text, as Anatomy's kit lays it at this camera.
  assert.deepEqual(["x", "y"].map((along) => k.topMatrix([3, 4], 2, P, along)),
    ["matrix(-1.626 0.969 -1.938 -0.813 87.37 75.273)", "matrix(1.938 0.813 -1.626 0.969 87.37 75.273)"]);
  assert.deepEqual(["left", "right"].map((face) => k.sideMatrix([3, 4], 2, P, face)),
    ["matrix(-1.626 0.969 0 2.191 87.37 75.273)", "matrix(1.938 0.813 0 2.191 87.37 75.273)"]);
  // fitProjection keeps the flag and fits the points as Anatomy's does (its origin and scale), so a fitted camera
  // draws the same picture as before.
  const fitted = k.fitProjection([[0, 0, 0], [20, 10, 5]], 640, 480, { azimuth: 45, leftHanded: true });
  close([...fitted.origin, fitted.scale], [76.65469540784443, 24, 54.413664307345165], "the fitted camera");
  assert.deepEqual(k.iso([20, 10, 5], fitted), anatomyIso([20, 10, 5], fitted));
});

test("the shipped keypad figure pulls its USB cable out to the right, where its CAD has it (+x)", () => {
  const svg = readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "figure.svg"), "utf8");
  const dx = Number(/<g class="a2-part" data-line="cable"[^>]* data-dx="(-?[\d.]+)"/.exec(svg)?.[1]);
  assert.ok(dx > 0, `the cable lifts to screen dx ${dx}: run sprue figure macropad`);
});
