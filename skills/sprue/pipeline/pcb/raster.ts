// Rasterising a layer's primitives, and finding the connected pieces of copper in the picture. This is how the DRC
// knows what the Gerber really connects: it paints the same flashes, draws and regions the writer prints, in the
// same order, dark adding copper and clear taking it away, then labels the pieces. A pixel is RES mm wide.

import { capsulePts, circlePts, rectPts } from "./geometry.ts";
import type { Box } from "./geometry.ts";
import type { Item, Pt } from "./types.ts";

export type Raster = { x0: number; y0: number; res: number; w: number; h: number; data: Uint8Array };

export function newRaster(box: Box, res: number): Raster {
  const w = Math.ceil((box.x1 - box.x0) / res), h = Math.ceil((box.y1 - box.y0) / res);
  return { x0: box.x0, y0: box.y0, res, w, h, data: new Uint8Array(w * h) };
}

/** The polygon an item paints. */
function polygon(it: Item): Pt[] {
  if (it.op === "region") return it.pts;
  if (it.op === "draw") return capsulePts(it.a, it.b, it.d / 2);
  if (it.ap.kind === "C") return circlePts([it.x, it.y], it.ap.d / 2);
  if (it.ap.kind === "R") return rectPts(it.x, it.y, it.ap.w, it.ap.h);
  const { w, h } = it.ap, r = Math.min(w, h) / 2, half = Math.abs(w - h) / 2;
  return w >= h ? capsulePts([it.x - half, it.y], [it.x + half, it.y], r) : capsulePts([it.x, it.y - half], [it.x, it.y + half], r);
}

/** Even-odd scanline fill of the pixels whose centres are inside the polygon. */
function fill(r: Raster, pts: Pt[], v: number) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of pts) {
    ymin = Math.min(ymin, p[1]);
    ymax = Math.max(ymax, p[1]);
  }
  const j0 = Math.max(0, Math.ceil((ymin - r.y0) / r.res - 0.5)), j1 = Math.min(r.h - 1, Math.floor((ymax - r.y0) / r.res - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const yc = r.y0 + (j + 0.5) * r.res;
    xs.length = 0;
    for (let a = pts.length - 1, b = 0; b < pts.length; a = b++) {
      const [xa, ya] = pts[a], [xb, yb] = pts[b];
      if ((ya <= yc && yc < yb) || (yb <= yc && yc < ya)) xs.push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - r.x0) / r.res - 0.5)), i1 = Math.min(r.w - 1, Math.floor((xs[k + 1] - r.x0) / r.res - 0.5));
      if (i1 >= i0) r.data.fill(v, j * r.w + i0, j * r.w + i1 + 1);
    }
  }
}

/** Paints the items in order: dark sets pixels, clear unsets them. */
export function paint(r: Raster, items: Item[]) {
  for (const it of items) fill(r, polygon(it), it.pol === "D" ? 1 : 0);
}

// ---- connected pieces -----------------------------------------------------------------------------------

export type Labels = {
  raster: Raster;
  /** Runs of copper pixels, row by row: run k is in row `row[k]`, pixels `x0[k]` up to `x1[k]` (exclusive). */
  row: Int32Array;
  x0: Int32Array;
  x1: Int32Array;
  rowStart: Int32Array;
  /** The piece (a run's root in the union-find) each run belongs to; pieces are numbered after `join`. */
  parent: Int32Array;
};

/** Finds the runs of copper pixels and joins the ones that touch (4-connected). */
export function label(r: Raster): Labels {
  const row: number[] = [], x0: number[] = [], x1: number[] = [];
  const rowStart = new Int32Array(r.h + 1);
  for (let j = 0; j < r.h; j++) {
    rowStart[j] = row.length;
    let i = 0;
    const base = j * r.w;
    while (i < r.w) {
      if (!r.data[base + i]) { i++; continue; }
      const s = i;
      while (i < r.w && r.data[base + i]) i++;
      row.push(j); x0.push(s); x1.push(i);
    }
  }
  rowStart[r.h] = row.length;
  const parent = Int32Array.from({ length: row.length }, (_, k) => k);
  const find = (k: number) => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]];
    return k;
  };
  for (let j = 1; j < r.h; j++) {
    let p = rowStart[j - 1];
    const pEnd = rowStart[j];
    for (let k = rowStart[j]; k < rowStart[j + 1]; k++) {
      while (p < pEnd && x1[p] <= x0[k]) p++;
      for (let m = p; m < pEnd && x0[m] < x1[k]; m++) {
        const a = find(k), b = find(m);
        if (a !== b) parent[a] = b;
        // The run ending last may touch the next run of this row too: keep p where it is.
      }
    }
  }
  return { raster: r, row: Int32Array.from(row), x0: Int32Array.from(x0), x1: Int32Array.from(x1), rowStart, parent };
}

/** The copper layers' pieces in one union-find, so a via can join a piece on one layer to a piece on the other. */
export type Stack = { layers: Labels[]; offset: number[]; parent: Int32Array };

export function stack(layers: Labels[]): Stack {
  const offset: number[] = [];
  let total = 0;
  for (const L of layers) {
    offset.push(total);
    total += L.parent.length;
  }
  const parent = new Int32Array(total);
  layers.forEach((L, n) => L.parent.forEach((p, k) => (parent[offset[n] + k] = offset[n] + p)));
  return { layers, offset, parent };
}

export function rootOf(S: Stack, k: number): number {
  const p = S.parent;
  while (p[k] !== k) k = p[k] = p[p[k]];
  return k;
}

/** The piece of copper under (x, y) on layer n, or -1 when that pixel has none. */
export function pieceAt(S: Stack, n: number, x: number, y: number): number {
  const L = S.layers[n], r = L.raster;
  const i = Math.floor((x - r.x0) / r.res), j = Math.floor((y - r.y0) / r.res);
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return -1;
  let lo = L.rowStart[j], hi = L.rowStart[j + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (i < L.x0[mid]) hi = mid - 1;
    else if (i >= L.x1[mid]) lo = mid + 1;
    else return rootOf(S, S.offset[n] + mid);
  }
  return -1;
}

/** Joins two pieces: a via, or a plated hole, makes them one. */
export function link(S: Stack, a: number, b: number) {
  const x = rootOf(S, a), y = rootOf(S, b);
  if (x !== y) S.parent[x] = y;
}

export type Piece = { area: number; cx: number; cy: number; layers: Set<number> };

/** Area (mm2), centroid and layers of every piece, keyed by its root. */
export function pieces(S: Stack): Map<number, Piece> {
  const out = new Map<number, Piece>();
  S.layers.forEach((L, n) => {
    const r = L.raster;
    for (let k = 0; k < L.row.length; k++) {
      const root = rootOf(S, S.offset[n] + k);
      let c = out.get(root);
      if (!c) out.set(root, (c = { area: 0, cx: 0, cy: 0, layers: new Set() }));
      const len = L.x1[k] - L.x0[k], a = len * r.res * r.res;
      c.area += a;
      c.cx += a * (r.x0 + ((L.x0[k] + L.x1[k]) / 2) * r.res);
      c.cy += a * (r.y0 + (L.row[k] + 0.5) * r.res);
      c.layers.add(n);
    }
  });
  for (const c of out.values()) {
    c.cx /= c.area;
    c.cy /= c.area;
  }
  return out;
}
