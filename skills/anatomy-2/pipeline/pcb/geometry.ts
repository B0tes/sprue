// Plane geometry for the PCB kit: the shapes copper is made of, the distance between two of them, and the
// polygons the rasteriser fills. Everything is in millimetres, y up.

import type { Pad, Pt, Track, Via } from "./types.ts";

/** A circle (a round pad, a via), a capsule (a track segment, an oval pad: a segment with round ends) or a simple
 * polygon (a rectangle, a keepout, the board outline). */
export type Shape =
  | { kind: "circle"; c: Pt; r: number }
  | { kind: "capsule"; a: Pt; b: Pt; r: number }
  | { kind: "poly"; pts: Pt[] };

export type Box = { x0: number; y0: number; x1: number; y1: number };

const EPS = 1e-9;

/** Rotates p counter-clockwise by deg about the origin; multiples of 90 stay exact. */
export function rotate([x, y]: Pt, deg: number): Pt {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return [x, y];
  if (q === 90) return [-y, x];
  if (q === 180) return [-x, -y];
  if (q === 270) return [y, -x];
  const t = (deg * Math.PI) / 180;
  return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Distance from p to the segment ab. */
export function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance between segments ab and cd (either may be a point); 0 when they cross. */
export function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b));
}

/** Even-odd point in polygon. */
export function inPoly(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smallest distance from p to the polygon's boundary. */
export function ptEdgeDist(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) best = Math.min(best, ptSegDist(p, pts[j], pts[i]));
  return best;
}

type Core = { pts: Pt[]; r: number; poly: boolean };
const core = (s: Shape): Core =>
  s.kind === "circle" ? { pts: [s.c], r: s.r, poly: false }
    : s.kind === "capsule" ? { pts: [s.a, s.b], r: s.r, poly: false }
      : { pts: s.pts, r: 0, poly: true };

/** Distance between a polygon and a point or segment; 0 when they overlap. */
function polyToSeg(poly: Pt[], a: Pt, b: Pt): number {
  if (inPoly(a, poly) || inPoly(b, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segSegDist(poly[j], poly[i], a, b));
  return best;
}

function polyToPoly(p: Pt[], q: Pt[]): number {
  if (inPoly(p[0], q) || inPoly(q[0], p)) return 0;
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    for (let k = 0, l = q.length - 1; k < q.length; l = k++) best = Math.min(best, segSegDist(p[j], p[i], q[l], q[k]));
  return best;
}

/** The gap between the edges of two shapes: 0 when they touch or overlap. */
export function gap(a: Shape, b: Shape): number {
  const A = core(a), B = core(b);
  let d: number;
  if (A.poly && B.poly) d = polyToPoly(A.pts, B.pts);
  else if (A.poly) d = polyToSeg(A.pts, B.pts[0], B.pts[B.pts.length - 1]);
  else if (B.poly) d = polyToSeg(B.pts, A.pts[0], A.pts[A.pts.length - 1]);
  else d = segSegDist(A.pts[0], A.pts[A.pts.length - 1], B.pts[0], B.pts[B.pts.length - 1]);
  return Math.max(0, d - A.r - B.r);
}

/** The distance from a point to the filled shape (0 inside it). */
export function ptShape(p: Pt, s: Shape): number {
  if (s.kind === "circle") return Math.max(0, dist(p, s.c) - s.r);
  if (s.kind === "capsule") return Math.max(0, ptSegDist(p, s.a, s.b) - s.r);
  return inPoly(p, s.pts) ? 0 : ptEdgeDist(p, s.pts);
}

export function bbox(s: Shape): Box {
  const pts = s.kind === "circle" ? [s.c] : s.kind === "capsule" ? [s.a, s.b] : s.pts;
  const r = s.kind === "poly" ? 0 : s.r;
  return {
    x0: Math.min(...pts.map((p) => p[0])) - r, y0: Math.min(...pts.map((p) => p[1])) - r,
    x1: Math.max(...pts.map((p) => p[0])) + r, y1: Math.max(...pts.map((p) => p[1])) + r,
  };
}

export const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });
export const boxesTouch = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

export const rectPts = (cx: number, cy: number, w: number, h: number): Pt[] =>
  [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];

/** A rounded rectangle centred on the origin, counter-clockwise, its corner arcs as `segs` chords each. */
export function roundedRect(w: number, h: number, r: number, segs = 16): Pt[] {
  if (r <= 0) return rectPts(0, 0, w, h);
  const out: Pt[] = [];
  const corners: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let k = 0; k <= segs; k++) {
      const t = ((a0 + (90 * k) / segs) * Math.PI) / 180;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  return out;
}

/** True when (x, y) is inside the board outline (a rounded rectangle) pulled in by `inset`. */
export function insideBoard(width: number, height: number, corner: number, x: number, y: number, inset = 0): boolean {
  const hw = width / 2, hh = height / 2, r = Math.max(0, corner - inset);
  const dx = Math.max(Math.abs(x) - (hw - inset - r), 0), dy = Math.max(Math.abs(y) - (hh - inset - r), 0);
  return Math.abs(x) <= hw - inset && Math.abs(y) <= hh - inset && dx * dx + dy * dy <= r * r + 1e-9;
}

/** A circle as a polygon with `n` vertices (enough that the chord error is far below the raster's pixel). */
export function circlePts(c: Pt, r: number, n = Math.max(24, Math.min(96, Math.ceil((2 * Math.PI * r) / 0.04)))): Pt[] {
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as Pt;
  });
}

/** A segment with round ends as a convex polygon. */
export function capsulePts(a: Pt, b: Pt, r: number): Pt[] {
  if (dist(a, b) < EPS) return circlePts(a, r);
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const n = Math.max(8, Math.min(32, Math.ceil((Math.PI * r) / 0.04)));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = th - Math.PI / 2 + (Math.PI * k) / n;
    out.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let k = 0; k <= n; k++) {
    const t = th + Math.PI / 2 + (Math.PI * k) / n;
    out.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  return out;
}

// ---- the shapes of board items ----------------------------------------------------------------------------

/** A pad's copper shape, grown by `by` on every side (a mask opening, a clearance). */
export function padShape(p: Pad, by = 0): Shape {
  if (p.shape === "circle") return { kind: "circle", c: [p.x, p.y], r: p.w / 2 + by };
  if (p.shape === "oval") {
    const r = Math.min(p.w, p.h) / 2;
    const half = Math.abs(p.w - p.h) / 2;
    return p.w >= p.h
      ? { kind: "capsule", a: [p.x - half, p.y], b: [p.x + half, p.y], r: r + by }
      : { kind: "capsule", a: [p.x, p.y - half], b: [p.x, p.y + half], r: r + by };
  }
  return { kind: "poly", pts: rectPts(p.x, p.y, p.w + 2 * by, p.h + 2 * by) };
}

export const viaShape = (v: Via, by = 0): Shape => ({ kind: "circle", c: [v.x, v.y], r: v.dia / 2 + by });

/** One segment of a track (or the whole of a one-point track). */
export function segShape(t: Track, i: number): Shape {
  const a = t.pts[i], b = t.pts[Math.min(i + 1, t.pts.length - 1)];
  return { kind: "capsule", a, b, r: t.width / 2 };
}

export const holeShape = (x: number, y: number, d: number): Shape => ({ kind: "circle", c: [x, y], r: d / 2 });
