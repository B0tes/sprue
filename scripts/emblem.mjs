// The emblem: the moment an idea becomes hardware. A pen soldering iron comes down from the upper right, held the way
// you hold one (about 38 degrees off the board, the handle toward you), a small bead of fresh tinning hanging under its
// conical point, a hair from a header pin and level with the middle of its tail. The header's first pin is already
// soldered: done, and about to be done. The echo is the two fingers of the Creation of Adam, almost touching.
//
// Drawn with the skill's drawing kit, so it matches the product figures, and themed by the page through the kit's iso-*
// classes and --anatomy-* variables (put it inside .fig-art). Only the bead, its glow, the pool of its light on the
// board and the hot end of the tip use var(--accent) (and the two specular glints, a near-white taken from it).
//
// World: millimetres, z up, the focal pin's hole at the origin on the board's top face (z = 0). The face we see is
// the solder side: the header's body is under the board, its pins come up through it.
// Run: node scripts/emblem.mjs  ->  src/components/emblem.svg (the site inlines it at the top and in the footer).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "../skills/sprue/kit/iso-kit.mjs";
import * as G from "../skills/sprue/kit/lathe.mjs";

const HERE = join(import.meta.dirname, "..", "src", "components");
const W = 640, H = 290;

// ---- the real numbers -------------------------------------------------------------------------------------------
const BOARD_T = 1.6;            // FR4, two copper layers
const PITCH = 2.54;
const PIN = 0.64;               // a 0.64 mm square header pin
const PIN_UP = 3.0;             // its tail on the solder side, not yet soldered
const HOLE_R = 0.5;             // 1.0 mm plated drill
const PAD_R = 0.85;             // 1.7 mm pad
const TRACE_W = 0.5;
const BUS_PITCH = 1.27;
const M3 = { x: 3.4, y: 8.0, drill: 1.6, ring: 1.85 };   // an unplated M3 mounting hole near the corner, its mask pulled back
const GRIP_R = 5.1;             // a 10 mm grip
const TILT = 38;                // the iron's axis above the board, degrees
const HEADING = -52;            // the handle's way across the board, degrees from +x (the handle comes toward you)
const FADE = [34, 45];          // the iron fades out between these distances from the point (and at the frame)
const S_END = FADE[1] + 2;

// ---- camera: fixed scale, the focal pin placed in the lower middle ------------------------------------------------
const AZ = 45, EL = 30;
const KS = 7.8;                 // screen units per mm
const JOINT_AT = [286, 220];    // where the focal pin's hole lands in the viewBox
const P = { origin: JOINT_AT, scale: KS / Math.sqrt(1.6), azimuth: AZ, elevation: EL };
const px = 1 / KS;
const at = (p) => k.iso(p, P);
const V = G.viewOf(P);
const rad = (d) => (d * Math.PI) / 180;

// ---- the iron's axis and the drop ---------------------------------------------------------------------------------
const A = G.unit3([Math.cos(rad(TILT)) * Math.cos(rad(HEADING)), Math.cos(rad(TILT)) * Math.sin(rad(HEADING)), Math.sin(rad(TILT))]);
const down = G.unit3(G.sub3([0, 0, -1], G.mul3(A, -A[2])));
const across = G.unit3([Math.SQRT1_2, -Math.SQRT1_2, 0]);   // screen-horizontal, to the right, in this camera

// The cone of the tip: straight, r = CONE_R0 + CONE_K * s from the point (s = 0) up the axis, then the plated shank.
const CONE_R0 = 0.2, CONE_K = (1.45 - CONE_R0) / 8.4;   // a T18-B style conical tip: 0.2 mm at the point
const coneR = (s) => CONE_R0 + CONE_K * s;
// The drop: turned about an axis that sags SAG below the iron's at the point and meets it where the solder ends
// (S_JOIN up the cone), so it hangs a little under the point and runs up the cone in a meniscus with no step.
const SAG = 0.36, S_JOIN = 1.4, NOSE = -0.42, WIDE = 0.12, R_WIDE = 0.6;
const DROP_LEN = Math.hypot(S_JOIN, SAG);
const R_JOIN = coneR(S_JOIN);
function dropR(s) {
  if (s <= WIDE) {
    const q = (WIDE - s) / (WIDE - NOSE);
    return R_WIDE * Math.sqrt(Math.max(0, 1 - q * q));
  }
  const d = DROP_LEN - WIDE, t = (s - WIDE) / d;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * R_WIDE + (-2 * t ** 3 + 3 * t ** 2) * R_JOIN + (t ** 3 - t ** 2) * d * CONE_K;
}
function dropSlope(s) {
  if (s <= WIDE) {
    const L = WIDE - NOSE, q = (WIDE - s) / L, root = Math.sqrt(Math.max(1e-6, 1 - q * q));
    return Math.min(40, (R_WIDE * q) / (L * root));
  }
  const d = DROP_LEN - WIDE, t = (s - WIDE) / d;
  return ((6 * t * t - 6 * t) * R_WIDE + (-6 * t * t + 6 * t) * R_JOIN) / d + (3 * t * t - 2 * t) * CONE_K;
}

// Place the drop: its side a clear GAP (in screen units) from the pin, its belly CLEAR above the mask (so it hangs
// beside the middle of the 3 mm tail, not down by the pad).
const GAP_UNITS = 9.5, CLEAR = 1.05;
function dropFrameFor(tip) {
  const o = G.add3(tip, G.mul3(down, SAG));
  const a = G.unit3(G.sub3(G.add3(tip, G.mul3(A, S_JOIN)), o));
  const u = G.unit3(G.cross3(a, [0, 0, 1]));
  return G.frameOf(o, a, u, G.cross3(a, u));
}
function dropPoints(F) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const s = NOSE + ((DROP_LEN - NOSE) * i) / 40;
    for (let j = 0; j < 48; j++) pts.push(G.pointOf(F, s, dropR(s), (j / 48) * Math.PI * 2));
  }
  return pts;
}
const PIN_EDGE = at([PIN / 2, -PIN / 2, 0])[0];          // the pin's right-hand edge on screen
let TIP = [1.6, -1.6, 1.4];
for (let pass = 0; pass < 3; pass++) {
  const pts = dropPoints(dropFrameFor(TIP));
  const lowZ = Math.min(...pts.map((p) => p[2]));
  const left = Math.min(...pts.map((p) => at(p)[0]));
  TIP = G.add3(TIP, G.add3([0, 0, CLEAR - lowZ], G.mul3(across, (PIN_EDGE + GAP_UNITS - left) / KS)));
}
const F = G.frameOf(TIP, A, down, G.cross3(A, down));     // the iron: s = 0 at the point, rising toward the handle
const FD = dropFrameFor(TIP);
const BEAD = G.pointOf(FD, WIDE, 0, 0);                   // the drop's widest ring

// ---- the board: one corner of a larger board; past the fade it goes on. Plan coordinates, mm --------------------
const CORNER = [6.5, 11];
const BOARD = { x: CORNER[0] - 52, y: CORNER[1] - 50, w: 52, d: 50, r: 1.6 };
const P1 = [0, PITCH];          // the header's first pin: square pad, soldered and trimmed
// An empty 1x4 header footprint behind the pair. The focal pin's trace runs between its middle pads, its four pads'
// traces join it, and the five run off as a bus at 1.27 mm.
const J2X = -5.6;
const J2 = [-1.5, -0.5, 0.5, 1.5].map((j) => [J2X, j * PITCH]);
const BUS_END = -34;

// ---- helpers -------------------------------------------------------------------------------------------------------
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const path = (points, closed = true) => k.pathOf(points, closed);
const flatOn = (ring, z = 0) => path(ring.map(([x, y]) => at([x, y, z])));
const cu = (d) => `<path class="emb-cu" d="${d}"/>`;
const voidOf = (d) => `<path class="emb-void" d="${d}"/>`;
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const squarePlan = (x, y, half, r) => k.roundedPlan({ x: x - half, y: y - half, w: 2 * half, d: 2 * half, r }, 3);

/** A convex polyhedron from its faces, shaded like the kit's extrude: tops in the top tone, sides by their heading. */
function polySolid(faces) {
  const all = faces.flat();
  const centre = G.mul3(all.reduce((s, p) => G.add3(s, p), [0, 0, 0]), 1 / all.length);
  const { sinA, cosA } = k.cameraOf(P);
  const keyOf = (p) => p.map((v) => v.toFixed(4)).join(",");
  const info = faces.map((face) => {
    let n = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const [a, b] = [face[i], face[(i + 1) % face.length]];
      n = G.add3(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    n = G.unit3(n);
    const c = G.mul3(face.reduce((s, p) => G.add3(s, p), [0, 0, 0]), 1 / face.length);
    if (G.dot3(n, G.sub3(c, centre)) < 0) n = G.mul3(n, -1);
    const kind = n[2] > 0.8 ? "top" : Math.abs(n[2]) < 0.3 ? "side" : "chamfer";
    return { face, n, kind, seen: G.dot3(n, V) > 1e-6 };
  });
  const shades = [[], [], [], []], top = [];
  for (const { face, n, kind, seen } of info) {
    if (!seen) continue;
    const d = path(face.map(at));
    if (kind === "top") { top.push(d); continue; }
    const h = Math.hypot(n[0], n[1]) || 1;
    const lit = ((n[0] / h) * -sinA + (n[1] / h) * cosA + 1) / 2;
    shades[Math.min(3, Math.floor(lit * 4) + (kind === "chamfer" ? 1 : 0))].push(d);
  }
  const owners = new Map();
  info.forEach((f, i) => f.face.forEach((p, j) => {
    const q = f.face[(j + 1) % f.face.length];
    const key = [keyOf(p), keyOf(q)].sort().join("|");
    owners.set(key, [...(owners.get(key) ?? []), i]);
    owners.get(key).edge = [p, q];
  }));
  const crease = [];
  for (const list of owners.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list.map((i) => info[i]);
    if (a.seen && b.seen && !(a.kind === "side" && b.kind === "side")) crease.push(path(list.edge.map(at), false));
  }
  const hull = path(G.hullOf(all.map(at)));
  return { fill: hull, outline: hull, crease: crease.join(""), top: top.join(""), shades: shades.map((l) => l.join("")) };
}
/** A square pin from z0 up, its top either chamfered (a header tail) or cut flush on a slant (a trimmed stub). */
function squarePin([x, y], half, z0, z1, { chamfer = 0, slant = 0 } = {}) {
  const sq = (h, z) => [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]].map(([a, b]) => [a, b, typeof z === "function" ? z(a, b) : z]);
  const zTop = slant ? (a) => z1 + slant * ((a - x) / half) : z1 - chamfer;
  const bottom = sq(half, z0), body = sq(half, zTop);
  const sides = (lo, hi) => lo.map((p, i) => [p, lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]]);
  const faces = [bottom, ...sides(bottom, body)];
  if (chamfer) {
    const cap = sq(half * 0.45, z1);
    faces.push(...sides(body, cap), cap);
  } else faces.push(body);
  return polySolid(faces);
}
/** A copper trace under the mask: a band of width w along a polyline, mitred round its 45-degree bends. */
function bandOf(route, w) {
  const side = (sign) => route.map(([x, y], i) => {
    const prev = route[Math.max(0, i - 1)], next = route[Math.min(route.length - 1, i + 1)];
    const d0 = G.unit3([x - prev[0], y - prev[1], 0]), d1 = G.unit3([next[0] - x, next[1] - y, 0]);
    const n0 = [-d0[1], d0[0]], n1 = [-d1[1], d1[0]];
    const first = i === 0, last = i === route.length - 1;
    const n = first ? n1 : last ? n0 : G.unit3([n0[0] + n1[0], n0[1] + n1[1], 0]);
    const scale = first || last ? 1 : 1 / Math.max(0.5, n[0] * n0[0] + n[1] * n0[1]);
    return [x + (sign * n[0] * w * scale) / 2, y + (sign * n[1] * w * scale) / 2];
  });
  return [side(1), side(-1)];
}
function trace(route, w = TRACE_W) {
  const [a, b] = bandOf(route, w);
  return cu(k.onTop([...a, ...[...b].reverse()], 0, P, true)) + L(k.onTop(a, 0, P) + k.onTop(b, 0, P), { tone: "lo" });
}
/** A plated through hole: copper pad (round or square), its mask opening, and the drill. */
function pad([x, y], { square = false, r = PAD_R, hole = HOLE_R, mask = r + 0.2 } = {}) {
  const outer = square ? flatOn(squarePlan(x, y, r, 0.12)) : k.ring(x, y, r, 0, P, 56);
  const opening = square ? flatOn(squarePlan(x, y, mask, 0.3)) : k.ring(x, y, mask, 0, P, 56);
  const drill = k.ring(x, y, hole, 0, P, 36);
  return L(opening, { tone: "lo" }) + cu(outer) + L(outer, { tone: "lo" }) + voidOf(drill) + L(drill, { tone: "lo" });
}

// ---- the board ----------------------------------------------------------------------------------------------------
function board() {
  const parts = [];
  parts.push(`<path class="iso-halo" d="${k.haloOf(BOARD, -BOARD_T - 1.2, 1.2, P)}"/>`);
  // The laminate: two faint seams where the copper and mask layers end on the edge, round the visible corner.
  const seams = L(k.sideSeam(BOARD, -0.16, P, 6) + k.sideSeam(BOARD, -BOARD_T + 0.16, P, 6), { tone: "faint" });
  parts.push(S(k.slabOf(BOARD, -BOARD_T, BOARD_T, P, 6, 0.5 * px), { tone: "mid", inner: seams }));
  // The bus: the focal pin's trace runs out between the empty header's middle pads; the header's four traces leave
  // their pads alongside it, the outer two jog in at 45 degrees, and the five run off into the fade at 1.27 mm.
  parts.push(trace([[0, 0], [BUS_END, 0]], 0.4));
  J2.forEach(([x, y]) => {
    const inner = Math.abs(y) < PITCH ? y : Math.sign(y) * 2 * BUS_PITCH;
    const jog = Math.abs(y - inner);
    parts.push(trace(jog > 1e-6 ? [[x, y], [x - 1.1, y], [x - 1.1 - jog, inner], [BUS_END, inner]] : [[x, y], [BUS_END, y]]));
  });
  // The first pin to a ground via.
  parts.push(trace([[P1[0], P1[1]], [0, 4.3], [-1.0, 5.3]], 0.4));
  parts.push(pad([-1.0, 5.3], { r: 0.45, hole: 0.2, mask: 0.55 }));
  // The pads: the empty header (its first pad square), and the pair.
  J2.forEach((p, i) => parts.push(pad(p, { square: i === 0 })));
  parts.push(pad(P1, { square: true }), pad([0, 0]));
  // The mounting hole: unplated, so no copper ring to compete with the pads; the mask stops short of it, the drill
  // shows the bare laminate inside and the bottom edge of the hole.
  const { x, y, drill, ring } = M3;
  parts.push(L(k.ring(x, y, ring, 0, P, 96), { tone: "faint" }));
  parts.push(voidOf(k.ring(x, y, drill, 0, P, 64)) + `<path class="emb-wall" d="${k.ring(x, y, drill, 0, P, 64)}"/>`);
  const clip = `<clipPath id="emb-m3"><path d="${k.ring(x, y, drill, 0, P, 64)}"/></clipPath>`;
  parts.push(`<defs>${clip}</defs><g clip-path="url(#emb-m3)">${voidOf(k.ring(x, y, drill, -BOARD_T, P, 64))}${L(k.ring(x, y, drill, -BOARD_T, P, 64), { tone: "faint" })}</g>`);
  parts.push(L(k.ring(x, y, drill, 0, P, 64), { tone: "lo" }));
  // Silkscreen: a pin-1 tick by each square pad.
  const tick = ([px0, py0]) => L(k.onTop([[px0 + 1.4, py0 - 0.35], [px0 + 1.4, py0 + 0.35], [px0 + 1.1, py0]], 0, P, true), { tone: "lo" });
  parts.push(tick(P1));
  return `<g class="emb-board">${parts.join("")}</g>`;
}

// ---- the first pin: soldered. A concave cone of bright solder wets its square pad and climbs the pin, whose tail
// stands out of it full length, as the focal pin's will once it is done -----------------------------------------------
const FIL_H = 0.9, FIL_BASE = 0.8, FIL_TOP = 0.47, FIL_N = 2.2;   // the top just wider than the pin's corners
const filR = (z) => FIL_TOP + (FIL_BASE - FIL_TOP) * (1 - z / FIL_H) ** FIL_N;
const filSlope = (z) => (-(FIL_BASE - FIL_TOP) * FIL_N * (1 - z / FIL_H) ** (FIL_N - 1)) / FIL_H;
function joint() {
  const [x, y] = P1;
  const Fz = G.frameAlong([x, y, 0], [0, 0, 1]);
  const foot = flatOn(squarePlan(x, y, PAD_R, 0.16));
  const rows = Array.from({ length: 13 }, (_, i) => { const z = FIL_H * (i / 12) ** 1.4; return [z, filR(z), i > 0 && i < 12 ? 1 : 0]; });
  const fillet = G.lathe([[0, 0], ...rows, [FIL_H, 0]], Fz, P, { smooth: { radius: filR, slope: filSlope } });
  // one glint down the cone's flank, beside the pin on the side the light comes from
  const facing = G.angleToward(Fz, V), Lt = G.lightOf(P);
  const glintAt = [facing - 0.6, facing + 0.6].sort((a, b) => G.dot3(G.radialOf(Fz, b), Lt) - G.dot3(G.radialOf(Fz, a), Lt))[0];
  const glint = Array.from({ length: 9 }, (_, i) => { const z = 0.12 + 0.45 * (i / 8); return at(G.pointOf(Fz, z, filR(z) + 0.01, glintAt)); });
  const stub = squarePin(P1, PIN / 2, FIL_H - 0.05, PIN_UP, { chamfer: 0.2 });
  return `<g class="emb-metal"><path class="iso-top" d="${foot}"/>${L(foot, { tone: "faint" })}`
    + S(fillet, { tone: "mid", crease: "lo", className: "emb-solder", inner: `<path class="emb-glint" d="${path(glint, false)}"/>` })
    + `${S(stub, { tone: "mid", crease: "lo" })}</g>`;
}

// ---- the focal pin -------------------------------------------------------------------------------------------------
const lead = () => `<g class="emb-metal">${S(squarePin([0, 0], PIN / 2, 0, PIN_UP, { chamfer: 0.2 }), { tone: "hi", crease: "lo" })}</g>`;

// ---- the iron, from its point to its grip (the point is furthest from you, so it is drawn first) -----------------
function iron() {
  const out = [];
  // the tinned end of the tip carries the heat: a wash of the accent over the cone's last couple of millimetres
  const [h0x, h0y] = at(G.pointOf(F, S_JOIN, 0, 0)), [h1x, h1y] = at(G.pointOf(F, S_JOIN + 1.3, 0, 0));
  const hot = `<linearGradient id="emb-hot-g" gradientUnits="userSpaceOnUse" x1="${fmt(h0x)}" y1="${fmt(h0y)}" x2="${fmt(h1x)}" y2="${fmt(h1y)}">`
    + `<stop offset="0" stop-opacity=".36" style="stop-color:var(--accent)"/><stop offset=".45" stop-opacity=".1" style="stop-color:var(--accent)"/><stop offset="1" stop-opacity="0" style="stop-color:var(--accent)"/></linearGradient>`;
  const S_WET = S_JOIN - 0.03;
  const tip = G.bandOfProfile([[S_WET, coneR(S_WET)], [8.4, 1.45], [13.4, 1.45]], F, P, { rims: "none" });
  const wet = `<path class="emb-wet" d="${G.arcOf(F, S_WET, coneR(S_WET), P, { slope: CONE_K })}"/>`;
  out.push(`<defs>${hot}</defs>` + S(tip, { tone: "hi", crease: "lo", inner: `<path class="emb-hot" fill="url(#emb-hot-g)" d="${tip.fill}"/>${wet}` }));
  // the heater barrel (the steel tip enclosure), its rolled front lip, a seam where it enters the nut
  const barrel = G.solidOf([[13, 2.0], [13.5, 2.6], [30, 2.6]], F, P);
  out.push(S(barrel, { tone: "mid", crease: "lo", inner: L(G.arcOf(F, 28.6, 2.6, P), { tone: "faint" }) }));
  // the knurled nut that holds the barrel
  const nut = G.solidOf([[30, 3.6], [30.6, 4.6], [37, 4.6], [37.5, 4.0]], F, P);
  out.push(S(nut, { tone: "mid", crease: "faint", inner: k.fadedSvg(G.ribsOf(F, 30.6, 37, 4.6, 30, P, { fade: [0.1, 0.55] }), { tone: "faint" }) }));
  // the thread collar between the nut and the grip
  out.push(S(G.disc(37.5, 38.6, 3.6, F, P), { tone: "mid", crease: "faint" }));
  // the grip: a finger guard at its front, then grooves round it
  const grip = G.solidOf([[38.6, 6.3], [39.7, 6.3], [42.7, GRIP_R], [S_END, GRIP_R]], F, P);
  const grooves = [];
  for (let s = 44.6; s < FADE[1]; s += 2.4) grooves.push(G.arcOf(F, s, GRIP_R, P));
  out.push(S(grip, { tone: "mid", crease: "faint", inner: L(grooves.join(""), { tone: "faint" }) }));
  return out.join("");
}

// ---- the drop and its glow -----------------------------------------------------------------------------------------
const knots = Array.from({ length: 29 }, (_, i) => {
  const s = NOSE + (DROP_LEN - NOSE) * (i / 28) ** 1;
  return [s, i === 0 ? 0 : dropR(s), i > 0 && i < 28 ? 1 : 0];
});
const dropPaths = G.lathe(knots, FD, P, { smooth: { slope: dropSlope, radius: dropR }, rims: "first" });
const SHINE = G.add3(BEAD, G.mul3(G.unit3(G.add3(G.lightOf(P), V)), R_WIDE * 0.7));
const drop = () => S(dropPaths, { tone: "hi", crease: "none", className: "emb-bead" })
  + `<circle class="emb-shine" cx="${fmt(at(SHINE)[0])}" cy="${fmt(at(SHINE)[1])}" r="${(R_WIDE * KS * 0.13).toFixed(2)}"/>`;
const [gx, gy] = at(G.add3(BEAD, G.mul3(A, 0.45)));
const glow = `<circle class="emb-glow" cx="${fmt(gx)}" cy="${fmt(gy)}" r="10.8"/>`;
// What shows the drop is in the air: a pool of its light on the mask straight under it, and a soft shadow of the
// point and the first few millimetres of the cone, cast straight down and fading as the cone climbs away.
const pool = `<path class="emb-pool" d="${k.ring(BEAD[0], BEAD[1], 1.3, 0, P, 48)}"/>`;
const CAST_TO = 6;
const castPts = [];
for (let i = 0; i <= 24; i++) {
  const s = NOSE + ((CAST_TO - NOSE) * i) / 24;
  for (let j = 0; j < 24; j++) {
    const ang = (j / 24) * Math.PI * 2;
    const p = s < S_JOIN ? G.pointOf(FD, s, dropR(s), ang) : G.pointOf(F, s, coneR(s), ang);
    castPts.push(at([p[0], p[1], 0]));
  }
}
const [c0x, c0y] = at([TIP[0], TIP[1], 0]), [c1x, c1y] = at((([a, b]) => [a, b, 0])(G.pointOf(F, CAST_TO, 0, 0)));
const cast = `<defs><linearGradient id="emb-cast-g" gradientUnits="userSpaceOnUse" x1="${fmt(c0x)}" y1="${fmt(c0y)}" x2="${fmt(c1x)}" y2="${fmt(c1y)}">`
  + `<stop offset="0" style="stop-color:var(--anatomy-halo);stop-opacity:.9"/><stop offset=".35" style="stop-color:var(--anatomy-halo);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--anatomy-halo);stop-opacity:0"/></linearGradient></defs>`
  + `<path class="emb-cast" fill="url(#emb-cast-g)" d="${path(G.hullOf(castPts))}"/>`;

// ---- flux smoke: it boils off the wetted point and rises in thin strands, leaning away from the iron -------------
const SMOKE_H = 13;
function smoke() {
  const base = G.add3(G.add3(BEAD, G.mul3(A, 0.7)), [0, 0, 1.35]);
  const strands = [
    { h: SMOKE_H, amp: 1.3, turns: 1.1, phase: 0.5, drift: -2.2, lift: 0, fade: [28, 62], tone: "mid" },
    { h: SMOKE_H * 0.78, amp: 1.1, turns: 1.3, phase: 3.4, drift: -1.2, lift: 0.6, fade: [26, 40], tone: "lo" },
    { h: SMOKE_H * 0.62, amp: 0.9, turns: 0.9, phase: 1.9, drift: -2.9, lift: 2.6, fade: [18, 26], tone: "faint" },
  ];
  return `<g class="emb-smoke">${strands.map((st, i) => {
    const pts = [];
    for (let j = 0; j <= 80; j++) {
      const t = j / 80;
      const grow = Math.pow(t, 1.6);
      const sway = st.amp * grow * Math.sin(st.phase + t * st.turns * Math.PI * 2);
      pts.push(at(G.add3(base, G.add3(G.mul3(across, sway + st.drift * t * t), [0, 0, st.lift + st.h * t]))));
    }
    return `<g class="emb-wisp" data-wisp="${i}">${k.fadeLineSvg(pts, { fade: st.fade, tone: st.tone })}</g>`;
  }).join("")}</g>`;
}

// ---- fades: the board and the grip go on past what is shown -------------------------------------------------------
const stops = (pairs) => pairs.map(([o, a]) => `<stop offset="${o}" stop-opacity="${a}" style="stop-color:var(--anatomy-hi)"/>`).join("");
const ease = (n, from = 0) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [(from + (1 - from) * t).toFixed(3), (1 - t * t * (3 - 2 * t)).toFixed(3)]; });
const [f0x, f0y] = at(G.pointOf(F, FADE[0], 0, 0)), [f1x, f1y] = at(G.pointOf(F, FADE[1], 0, 0));
// The board's fade: an ellipse round the pair that reaches nothing by the edges of the view.
const FC = [JOINT_AT[0] - 30, JOINT_AT[1] + 12], RX = 285, RY = 118;
const FRAME_FEATHER = 30;
const all = `x="-200" y="-200" width="${W + 400}" height="${H + 400}"`;
const defs = `<defs>`
  + `<linearGradient id="emb-iron-g" gradientUnits="userSpaceOnUse" x1="${fmt(f0x)}" y1="${fmt(f0y)}" x2="${fmt(f1x)}" y2="${fmt(f1y)}">${stops(ease(10))}</linearGradient>`
  + `<mask id="emb-iron-m" mask-type="alpha" maskUnits="userSpaceOnUse" ${all}><rect ${all} fill="url(#emb-iron-g)"/></mask>`
  // the frame's top edge: the grip runs out of the picture there, so it dissolves into it instead of being cut
  + `<linearGradient id="emb-top-g" gradientUnits="userSpaceOnUse" x1="0" y1="${FRAME_FEATHER}" x2="0" y2="0">${stops(ease(8))}</linearGradient>`
  + `<mask id="emb-top-m" mask-type="alpha" maskUnits="userSpaceOnUse" ${all}><rect ${all} fill="url(#emb-top-g)"/></mask>`
  + `<radialGradient id="emb-board-g" gradientUnits="userSpaceOnUse" cx="${fmt(FC[0])}" cy="${fmt(FC[1])}" r="${RX}" gradientTransform="translate(${fmt(FC[0])} ${fmt(FC[1])}) scale(1 ${(RY / RX).toFixed(3)}) translate(${fmt(-FC[0])} ${fmt(-FC[1])})">${stops([["0", 1], ...ease(12, 0.42)])}</radialGradient>`
  + `<mask id="emb-board-m" mask-type="alpha" maskUnits="userSpaceOnUse" ${all}><rect ${all} fill="url(#emb-board-g)"/></mask>`
  + `</defs>`;

// The board's mask is one step off the paper, its copper one step lighter than the mask (the kit's lit tones, so it
// holds in both themes); drills are the kit's shadow tone. Metal standing on the board takes the lit top. The drop
// is the accent, lighter toward the light (relative colour, so the same rule works on light and dark paper; a
// browser without it gets the flat accent), with a small specular dot; its glow is a blurred disc of the accent.
// The smoke sways a degree or so about its root, and holds still when motion is reduced.
const STYLE = `<style>
.emb-board{--anatomy-top:var(--anatomy-lit-shade)}
.emb-metal{--anatomy-top:var(--anatomy-lit-top)}
.emb-cu{fill:var(--anatomy-lit-top);stroke:none}
.emb-void{fill:var(--anatomy-halo);fill-opacity:.38;stroke:none}
.emb-wall{fill:var(--anatomy-shade-1);fill-opacity:.5;stroke:none}
.emb-hot{stroke:none}
.emb-bead>.iso-fill,.emb-bead>.iso-shade,.emb-bead>.iso-top{fill:var(--accent);stroke:none!important}
.emb-bead>.iso-edge{stroke:var(--accent)}
.emb-wet{fill:none;stroke:var(--accent);stroke-width:var(--anatomy-weight);stroke-linecap:round}
.emb-shine{display:none}
.emb-solder{--s0:color-mix(in srgb,var(--anatomy-faint) 50%,var(--anatomy-shade-3));--s1:color-mix(in srgb,color-mix(in srgb,var(--anatomy-faint) 46%,var(--anatomy-shade-3)) 65%,var(--anatomy-lit-shade))}
.iso-solid.emb-solder[data-seamless]>.iso-shade[data-shade="0"]{fill:var(--s0);stroke:var(--s0)}
.iso-solid.emb-solder[data-seamless]>.iso-shade[data-shade="1"]{fill:var(--s1);stroke:var(--s1)}
.iso-solid.emb-solder[data-seamless]>.iso-shade[data-shade="2"]{fill:var(--anatomy-lit-shade);stroke:var(--anatomy-lit-shade)}
.iso-solid.emb-solder[data-seamless]>.iso-shade[data-shade="3"],.iso-solid.emb-solder[data-seamless]>.iso-top{fill:var(--anatomy-lit-top);stroke:var(--anatomy-lit-top)}
.emb-glint{fill:none;stroke:var(--anatomy-lit-top);stroke-width:.8;stroke-linecap:round}
.emb-pool{fill:var(--accent);opacity:.16;filter:blur(2.5px);stroke:none}
.emb-cast{stroke:none;opacity:var(--anatomy-halo-opacity);filter:blur(1.6px)}
@supports (color:oklch(from red l c h)){
.emb-bead>.iso-fill,.emb-bead>.iso-shade[data-shade="0"]{fill:oklch(from var(--accent) calc(l + .03) c h)}
.emb-bead>.iso-shade[data-shade="1"]{fill:oklch(from var(--accent) calc(l + .08) c h)}
.emb-bead>.iso-shade[data-shade="2"]{fill:oklch(from var(--accent) calc(l + .13) calc(c * .95) h)}
.emb-bead>.iso-shade[data-shade="3"]{fill:oklch(from var(--accent) calc(l + .19) calc(c * .88) h)}
.emb-bead>.iso-top{fill:oklch(from var(--accent) calc(l + .24) calc(c * .78) h)}
.emb-shine{display:inline;fill:oklch(from var(--accent) .98 .02 h)}
.emb-glint{stroke:oklch(from var(--accent) .97 .012 h);opacity:.75}
.emb-bead>.iso-edge,.emb-wet{stroke:oklch(from var(--accent) calc(l - .05) c h)}
}
.emb-glow{fill:var(--accent);opacity:.3;filter:blur(4px)}
.emb-wisp{transform-box:fill-box;transform-origin:50% 100%}
@keyframes emb-sway{0%,100%{transform:rotate(-1.4deg)}50%{transform:rotate(1.6deg)}}
@keyframes emb-breathe{0%,100%{opacity:.8}50%{opacity:1}}
@media (prefers-reduced-motion:no-preference){
.emb-wisp{animation:emb-sway 7s ease-in-out infinite}
.emb-wisp[data-wisp="1"]{animation-duration:9s;animation-delay:-3s}
.emb-wisp[data-wisp="2"]{animation-duration:6s;animation-delay:-1.5s}
.emb-smoke{animation:emb-breathe 5s ease-in-out infinite}
}
</style>`;

// Paint order: the board and what is printed and plated on it, the shadow and the pool of light under the point,
// the soldered first pin, the glow, the drop, the iron from its point to its grip (the handle comes toward you, so
// each part covers the end of the one before), the focal pin, the smoke in the air over them. The pin, the drop and
// the cone don't overlap on screen.
const body = [
  STYLE,
  defs,
  `<g mask="url(#emb-board-m)">${board()}</g>`,
  cast,
  pool,
  joint(),
  glow,
  drop(),
  `<g mask="url(#emb-top-m)"><g mask="url(#emb-iron-m)">${iron()}</g></g>`,
  lead(),
  smoke(),
];
// The kit writes absolute M/L/Z paths rounded to 0.1 and samples outlines finer than that, so many points repeat.
// Rewrite each path in relative steps of whole tenths, dropping the repeats: the same geometry in half the bytes.
function compact(d) {
  const num = (t) => (t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1).replace(/^(-?)0\./, "$1."));
  const join = (list) => list.map((n, i) => (i && !n.startsWith("-") ? " " : "") + n).join("");
  let out = "", x = 0, y = 0, sx = 0, sy = 0, last = "", first = true;
  for (const [, c, a, b] of d.matchAll(/([MLZ])(?:(-?[\d.]+) (-?[\d.]+))?/g)) {
    if (c === "Z") { out += "z"; x = sx; y = sy; last = "z"; continue; }
    const tx = Math.round(Number(a) * 10), ty = Math.round(Number(b) * 10);
    if (c === "M") {
      out += first ? `M${join([num(tx), num(ty)])}` : `m${join([num(tx - x), num(ty - y)])}`;
      sx = tx; sy = ty; last = "m";
    } else {
      if (tx === x && ty === y) continue;
      const pair = join([num(tx - x), num(ty - y)]);
      out += last === "l" ? (pair.startsWith("-") ? pair : " " + pair) : `l${pair}`;
      last = "l";
    }
    x = tx; y = ty; first = false;
  }
  return out;
}
const svg = k.figureSvg({ width: W, height: H, label: "A soldering iron's tip, a hair from a header pin on a circuit board", body })
  .replace(/ d="([^"]*)"/g, (_, d) => ` d="${process.env.ABS ? d : compact(d)}"`);
writeFileSync(join(HERE, "emblem.svg"), svg + "\n");

// ---- a report: fit, angles, the gap ---------------------------------------------------------------------------------
const screenAngle = (d) => { const [x0, y0] = at([0, 0, 0]), [x1, y1] = at(d); return (Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI; };
const ironPts = [];
for (let s = 0; s <= FADE[1]; s += 1) for (let t = 0; t < 24; t++) ironPts.push(at(G.pointOf(F, s, s > 38.6 ? (s < 40 ? 6.3 : GRIP_R) : s > 30 ? 4.6 : 2.6, (t / 24) * Math.PI * 2)));
const dropScreen = dropPoints(FD).map(at);
const box = (list) => [Math.min(...list.map((p) => p[0])), Math.min(...list.map((p) => p[1])), Math.max(...list.map((p) => p[0])), Math.max(...list.map((p) => p[1]))].map(fmt);
console.log(`emblem.svg: ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB, viewBox 0 0 ${W} ${H}, ${KS} units/mm, a·V ${G.dot3(A, V).toFixed(3)}`);
console.log(`iron axis on screen ${screenAngle(A).toFixed(1)} deg, board edge ${screenAngle([0, -1, 0]).toFixed(1)} deg; iron box ${box(ironPts)}; drop box ${box(dropScreen)}`);
const fadeAt = (alpha) => { for (let s = FADE[0]; s <= FADE[1]; s += 0.05) { const t = (s - FADE[0]) / (FADE[1] - FADE[0]); if (1 - t * t * (3 - 2 * t) <= alpha) return s; } return FADE[1]; };
console.log(`grip top at 50 % fade ${fmt(Math.min(...Array.from({ length: 48 }, (_, t) => at(G.pointOf(F, fadeAt(0.5), GRIP_R, (t / 48) * Math.PI * 2))[1])))}, at 10 % ${fmt(Math.min(...Array.from({ length: 48 }, (_, t) => at(G.pointOf(F, fadeAt(0.1), GRIP_R, (t / 48) * Math.PI * 2))[1])))}, right at 10 % ${fmt(Math.max(...Array.from({ length: 48 }, (_, t) => at(G.pointOf(F, fadeAt(0.1), GRIP_R, (t / 48) * Math.PI * 2))[0])))}`);
console.log(`gap: drop left ${fmt(Math.min(...dropScreen.map((p) => p[0])))} vs pin edge ${fmt(PIN_EDGE)}; drop low z ${Math.min(...dropPoints(FD).map((p) => p[2])).toFixed(2)} mm; corner ${at([CORNER[0], CORNER[1], -BOARD_T]).map(fmt)}; smoke top ${at(G.add3(BEAD, [0, 0, SMOKE_H + 1.35])).map(fmt)}`);
