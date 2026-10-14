// Thin copper. A fab etches what the Gerber draws, so a neck of pour between two cut-outs that is a tenth of a
// millimetre wide is a sliver it may flag or lose. This finds copper narrower than a minimum width on a raster by
// morphological opening (erode by half the width, grow back): whatever the opening cannot restore is too thin.
// layers.ts clears such necks from a pour, as a zone fill does, and the audit (drc.ts) checks what is left.
//
// The tip of a corner is always thin where it ends, so a piece smaller than `tip` mm2 is let through; a neck is
// far larger. Distances are measured between pixel centres, so a width is found to within a pixel or two: a strip
// exactly `width` wide may lose its edge rows, depending on where its edges fall between pixel centres. That is why
// the audit does not hold the board's own copper to this test (see `except`): a track's width is checked on the
// track, exactly, and a track at the rules' minimum must not fail here for where it happens to sit on the raster.

import { label, type Raster } from "./raster.ts";
import type { Pt } from "./types.ts";

const FAR = 1e12;

/** One line of Felzenszwalb and Huttenlocher's squared distance transform: `f` holds 0 at a feature and FAR
 * elsewhere, `d` gets, for every cell, the squared distance to the nearest feature. */
function line(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  const meet = (q: number, p: number) => (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k]);
    while (s <= z[k]) s = meet(q, v[--k]);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance, in pixels, from every pixel to the nearest one where `feature` is set. */
function distance2(w: number, h: number, feature: Uint8Array): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : FAR;
  const m = Math.max(w, h);
  const f = new Float32Array(m), d = new Float32Array(m), v = new Int32Array(m), z = new Float32Array(m + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    line(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    line(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  return g;
}

export type ThinPart = { area: number; cx: number; cy: number };
export type Thin = { parts: ThinPart[]; mask: Uint8Array };

/** The copper of `r` narrower than `width` mm. `except` marks pixels that are not held to it (the board's own copper,
 * checked elsewhere): thin copper there is left out. `parts` are the pieces of at least `tip` mm2, with their area and
 * centre; `mask` marks the pixels of those pieces. */
export function thin(r: Raster, width: number, tip: number, except?: Uint8Array): Thin {
  const n = r.w * r.h;
  const half = width / r.res / 2; // pixels, centre to centre
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = r.data[i] ? 0 : 1;
  const away = distance2(r.w, r.h, outside);
  const eroded = new Uint8Array(n);
  for (let i = 0; i < n; i++) eroded[i] = r.data[i] && away[i] >= half * half ? 1 : 0;
  const back = distance2(r.w, r.h, eroded); // grown again, by a pixel more, so the edge of a slanted track comes back
  const lost: Raster = { ...r, data: new Uint8Array(n) };
  let any = false;
  for (let i = 0; i < n; i++)
    if (r.data[i] && !except?.[i] && back[i] > (half + 1) * (half + 1)) {
      lost.data[i] = 1;
      any = true;
    }
  if (!any) return { parts: [], mask: new Uint8Array(n) };

  const L = label(lost);
  const roots = new Map<number, { runs: number[]; area: number; cx: number; cy: number }>();
  const find = (k: number) => {
    while (L.parent[k] !== k) k = L.parent[k] = L.parent[L.parent[k]];
    return k;
  };
  for (let k = 0; k < L.row.length; k++) {
    const root = find(k);
    const c = roots.get(root) ?? { runs: [], area: 0, cx: 0, cy: 0 };
    const a = (L.x1[k] - L.x0[k]) * r.res * r.res;
    c.runs.push(k);
    c.area += a;
    c.cx += a * (r.x0 + ((L.x0[k] + L.x1[k]) / 2) * r.res);
    c.cy += a * (r.y0 + (L.row[k] + 0.5) * r.res);
    roots.set(root, c);
  }
  const parts: ThinPart[] = [], mask = new Uint8Array(r.w * r.h);
  for (const c of roots.values()) {
    if (c.area < tip) continue;
    parts.push({ area: c.area, cx: c.cx / c.area, cy: c.cy / c.area });
    for (const k of c.runs) mask.fill(1, L.row[k] * r.w + L.x0[k], L.row[k] * r.w + L.x1[k]);
  }
  return { parts: parts.sort((a, b) => b.area - a.area), mask };
}

/** Rectangles covering the marked pixels grown by one pixel (so no sub-pixel crumb of copper is left beside
 * them): each is a clear region for the Gerber. Runs that repeat on the next row are merged into one rectangle. */
export function knockouts(r: Raster, mask: Uint8Array): Pt[][] {
  const grown = new Uint8Array(r.w * r.h);
  for (let j = 0; j < r.h; j++)
    for (let i = 0; i < r.w; i++) {
      if (!mask[j * r.w + i]) continue;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < r.w && b < r.h) grown[b * r.w + a] = 1;
        }
    }
  const out: Pt[][] = [];
  let open = new Map<string, { x0: number; x1: number; j0: number }>();
  const close = (rect: { x0: number; x1: number; j0: number }, j1: number) => {
    const x0 = r.x0 + rect.x0 * r.res, x1 = r.x0 + rect.x1 * r.res, y0 = r.y0 + rect.j0 * r.res, y1 = r.y0 + j1 * r.res;
    out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  };
  for (let j = 0; j <= r.h; j++) {
    const next = new Map<string, { x0: number; x1: number; j0: number }>();
    for (let i = 0; j < r.h && i < r.w; ) {
      if (!grown[j * r.w + i]) { i++; continue; }
      const s = i;
      while (i < r.w && grown[j * r.w + i]) i++;
      const key = `${s}|${i}`;
      next.set(key, open.get(key) ?? { x0: s, x1: i, j0: j });
    }
    for (const [key, rect] of open) if (next.get(key) !== rect) close(rect, j);
    open = next;
  }
  return out;
}
