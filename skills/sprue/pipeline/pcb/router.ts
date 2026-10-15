// The maze router: A* over a grid of rules.gridMm (0.1 mm) cells on both copper layers. What may enter each cell is
// the obstacle map of field.ts (copper, holes, keepouts and the edge, grown by the clearance rule and half the track,
// so a path of cell centres is clear of everything by the rules whatever the grid does), which is kept between
// routes. A track prefers the bottom layer (a step on the top costs `topCost` times more), may change layer only
// where a via fits and `via` allows it, and prefers straight runs and 45 degree turns over sharp ones. The DRC
// (drc.ts) checks the result on the real geometry, not on the grid.
//
// A route costs about what its own length does, not what the board's area does, for two reasons:
//  - The search works in a window round the two pads (their box grown by `WINDOW_MM`), not on the whole board. A path
//    cheaper than the best one found stays inside an ellipse with the pads for foci, so when the window holds that
//    ellipse the best path is the cheapest on the board, and if it does not, one more search in the ellipse's window
//    settles it. The answer is the same as a search of the whole board, found in less time when the pads are near.
//  - The heuristic is a map of exact distances to the goal. It is found backwards from the goal, by Dijkstra's
//    algorithm with a bucket queue (a heap when one step can add so much that the buckets would be many, a via that
//    costs thousands of cells), on the same graph and with the same step costs but for the turns. A* then
//    walks along the cheapest way round walls and dead ends instead of flooding them, and a goal that cannot be
//    reached is known before a single step is taken.

import { bbox, dist, padShape, ptShape, type Box } from "./geometry.ts";
import { fieldFor, LAYERS } from "./field.ts";
import type { Rules } from "./rules.ts";
import type { BoardData, Layer, Pad, Pt, Track, Via } from "./types.ts";

/** `topCost`, `viaCost` and `turnCost` are numbers from 0 to COST_MAX and `window` is 0 or more (or Infinity): any
 * other value is refused with an error, not searched with. */
export type RouteOpts = {
  /** Track width; default the rules' signal trace. */
  width?: number;
  /** Allow layer changes through vias. Default false: the track stays on the pads' layer. Pads on different layers
   * get one via, from the first pad's layer to the second's; two pads on one layer may hop to the other and back. */
  via?: boolean;
  /** Which layers to use; default the pads' layers, plus the other when `via` is allowed. */
  layers?: Layer[];
  /** A step on the top layer costs this many times a step on the bottom (at least 1). Default 4. */
  topCost?: number;
  /** A via costs this many cells of track. Default 30. */
  viaCost?: number;
  /** A 45 degree turn costs this many cells of track. Default 2. */
  turnCost?: number;
  /** Cells within this distance (mm) beyond the clearance of another net's copper cost extra, so tracks keep to the
   * middle of a channel and leave room for the next one. Default 0.6; 0 turns it off. */
  softMm?: number;
  /** How far (mm) beyond the two pads' box the first search looks; default 5, 0 looks in the box alone. It changes how
   * long a route takes, not which one is found; Infinity searches the whole board at once. */
  window?: number;
};
/** `cost` is what the search minimised, in cells of straight track on the bottom layer. */
export type Routed = { tracks: Track[]; vias: Via[]; lengthMm: number; cost: number };

const DIRS: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const NONE = 8;
/** How far beyond the two pads' box the first search looks, in mm, when the route does not say. */
const WINDOW_MM = 5;
/** The most a cost option may be, in cells of track or times a step: far more than any route on a board costs, so it
 * means "never", and little enough that the distance map's sums stay exact. */
const COST_MAX = 1e6;
/** The distance map counts in 1/SCALE of a cell, rounded down so that it never overestimates. */
const SCALE = 100;
/** The most buckets the distance map's ring may have (one per distance a step can add); beyond that it uses a heap. */
const RING_MAX = 1 << 14;
/** Among states of equal cost the search takes the one nearer the goal: the goal's distance counts this much more. */
const PULL = 1 + 1e-5;

/** A binary min-heap of (priority, state) pairs in typed arrays. */
function heap() {
  let keys = new Float64Array(1 << 16);
  let vals = new Int32Array(1 << 16);
  let n = 0;
  return {
    get size() { return n; },
    /** The smallest key, the one `pop` is about to take. */
    get min() { return keys[0]; },
    push(k: number, v: number) {
      if (n === keys.length) {
        const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2);
        k2.set(keys); v2.set(vals);
        keys = k2; vals = v2;
      }
      let i = n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p]; vals[i] = vals[p];
        i = p;
      }
      keys[i] = k; vals[i] = v;
    },
    pop(): number {
      const top = vals[0];
      const k = keys[--n], v = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; vals[i] = vals[c];
        i = c;
      }
      keys[i] = k; vals[i] = v;
      return top;
    },
  };
}

export function route(data: BoardData, rules: Rules, net: string, from: Pad, to: Pad, opts: RouteOpts): Routed {
  const name = `route ${net} ${from.ref}.${from.num} to ${to.ref}.${to.num}`;
  if (!data.outline.length) throw new Error("route: call pcb.outline() first");
  if (!net) throw new Error(`${name}: the net needs a name`);
  for (const p of [from, to])
    if (p.net !== net) throw new Error(`${name}: ${p.ref}.${p.num} is ${p.net ? `on net ${p.net}` : "on no net (name its net in place(..., { nets }))"}, not ${net}`);
  /** An option that must be a number from 0 to `max`: a NaN or a negative one would stall or corrupt the search, a huge one swell its maps. */
  const within = (what: string, v: number | undefined, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !(v >= 0 && v <= max)) throw new Error(`${name}: ${what} must be a number from 0 to ${max}, got ${String(v)}`);
    return v;
  };
  const width = opts.width ?? rules.trackMm;
  const topCost = Math.max(1, within("topCost", opts.topCost, 4, COST_MAX)), viaCost = within("viaCost", opts.viaCost, 30, COST_MAX);
  const turnCost = within("turnCost", opts.turnCost, 2, COST_MAX), softMm = opts.softMm ?? 0.6;
  let around = within("window", opts.window, WINDOW_MM, Infinity); // how far beyond the pads' box the search looks, grown while it finds nothing
  const g = rules.gridMm;
  const oneWay = from.layers.length === 1 && to.layers.length === 1 && from.layers[0] !== to.layers[0];
  const useLayers: Layer[] = opts.layers ?? (opts.via ? LAYERS : LAYERS.filter((l) => from.layers.includes(l) && to.layers.includes(l)));
  if (!useLayers.length) throw new Error(`${name}: the pads share no layer, so a via is needed (pass { via: true })`);
  if (!from.layers.some((l) => useLayers.includes(l)) || !to.layers.some((l) => useLayers.includes(l)))
    throw new Error(`${name}: a pad is on a layer the route may not use (${useLayers.join(", ")})`);

  // ---- the grid and what may enter each cell; layers are numbered 0 (F.Cu) and 1 (B.Cu) ----
  const F = fieldFor(data, rules, width, softMm);
  const { nx, ny, px, py } = F;
  const n = nx * ny;
  const me = F.idOf(net);
  const owners = [F.owner["F.Cu"], F.owner["B.Cu"]], nears = [F.near["F.Cu"], F.near["B.Cu"]];
  const open = (l: number, k: number) => owners[l][k] === 0 || owners[l][k] === me;
  const viaOpen = (k: number) => F.viaMap[k] === 0 || F.viaMap[k] === me;
  /** A cell near another net's copper: a step into it costs more. */
  const dear = (l: number, k: number) => softMm > 0 && nears[l][k] !== 0 && nears[l][k] !== me;
  const may = LAYERS.map((l) => useLayers.includes(l));
  const toLayer = LAYERS.indexOf(to.layers[0]);

  // ---- the ends: cells inside the pads ----
  const goal = [new Uint8Array(n), new Uint8Array(n)];
  const cellsIn = (pad: Pad, f: (l: number, k: number) => void) => {
    const s = padShape(pad), b = bbox(s);
    const i0 = Math.max(0, Math.ceil((b.x0 - px(0)) / g)), i1 = Math.min(nx - 1, Math.floor((b.x1 - px(0)) / g));
    const j0 = Math.max(0, Math.ceil((b.y0 - py(0)) / g)), j1 = Math.min(ny - 1, Math.floor((b.y1 - py(0)) / g));
    for (const layer of pad.layers) {
      const l = LAYERS.indexOf(layer);
      if (may[l])
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) if (ptShape([px(i), py(j)], s) === 0 && open(l, j * nx + i)) f(l, j * nx + i);
    }
  };
  const goals: [number, number][] = [], starts: [number, number][] = [];
  cellsIn(to, (l, k) => { goal[l][k] = 1; goals.push([l, k]); });
  cellsIn(from, (l, k) => starts.push([l, k]));
  if (!starts.length) throw new Error(`${name}: no room to start on ${from.ref}.${from.num}: its copper is boxed in by keepouts, the edge or other nets`);
  if (!goals.length) throw new Error(`${name}: no room to end on ${to.ref}.${to.num}: its copper is boxed in by keepouts, the edge or other nets`);

  // ---- step costs, as the distance map counts them: integers, rounded down so the map is a lower bound ----
  const mul = [topCost, 1];
  const steps = mul.map((m) => Int32Array.from([1, Math.SQRT2, 1.5, Math.SQRT2 + 0.5], (c) => Math.floor(c * m * SCALE + 1e-6)));
  const viaInt = Math.floor(viaCost * SCALE + 1e-6);
  const spread = Math.max(viaInt, ...steps.map((t) => Math.max(...t))) + 1; // the most one step adds, for the bucket ring

  type Found = { cells: { l: number; k: number }[]; cost: number };

  const boxes = [bbox(padShape(from)), bbox(padShape(to))];

  /** The least a path from the start pad to cell (i, j) can cost: the straight way. */
  const toStart = (i: number, j: number) => {
    const b = boxes[0], dx = Math.max(0, b.x0 - px(i), px(i) - b.x1) / g, dy = Math.max(0, b.y0 - py(j), py(j) - b.y1) / g;
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  /** One search in the window of cells i0..i1, j0..j1 (inclusive), for a path of at most `limit`. */
  const search = (i0: number, j0: number, i1: number, j1: number, limit: number): Found | undefined => {
    const wnx = i1 - i0 + 1, wn = wnx * (j1 - j0 + 1);
    const at = (l: number, i: number, j: number) => l * wn + (j - j0) * wnx + (i - i0);

    // The distance to the goal from every state (layer, cell) of the window: 0 for not reached, else distance + 1. States
    // wait for their turn in a ring of buckets, one per distance a step can add, or in a heap when that is too many.
    const D = new Float64Array(2 * wn);
    const ring: number[][] = spread <= RING_MAX ? Array.from({ length: spread }, () => []) : [];
    const queue = ring.length ? undefined : heap();
    let pending = 0;
    const reach = (s: number, d: number) => {
      D[s] = d + 1;
      if (queue) queue.push(d, s);
      else ring[d % spread].push(s);
      pending++;
    };
    for (const [l, k] of goals) {
      const i = k % nx, j = (k / nx) | 0;
      if (i >= i0 && i <= i1 && j >= j0 && j <= j1) reach(at(l, i, j), 0);
    }
    /** Settles state s at distance d: offers its neighbours, over the layer and through a via. */
    const settle = (s: number, d: number) => {
      const l = s >= wn ? 1 : 0, c = s - l * wn;
      const i = i0 + (c % wnx), j = j0 + ((c / wnx) | 0), k = j * nx + i;
      const cost = steps[l], dearer = dear(l, k) ? 2 : 0; // the cost of a step into this cell, from any neighbour
      for (let m = 0; m < 8; m++) {
        const ni = i + DIRS[m][0], nj = j + DIRS[m][1];
        if (ni < i0 || nj < j0 || ni > i1 || nj > j1 || !open(l, nj * nx + ni)) continue;
        if (m & 1 && !(open(l, j * nx + ni) && open(l, nj * nx + i))) continue;
        const v = at(l, ni, nj), nd = d + cost[dearer + (m & 1)];
        if ((D[v] === 0 || nd + 1 < D[v]) && (limit === Infinity || nd / SCALE + toStart(ni, nj) <= limit)) reach(v, nd);
      }
      // Backwards over a via: the state on the other layer came here through one.
      const o = 1 - l;
      if (opts.via && may[o] && (!oneWay || l === toLayer) && viaOpen(k) && open(o, k)) {
        const v = at(o, i, j), nd = d + viaInt;
        if ((D[v] === 0 || nd + 1 < D[v]) && (limit === Infinity || nd / SCALE + toStart(i, j) <= limit)) reach(v, nd);
      }
    };
    if (queue) {
      while (queue.size) {
        const d = queue.min, s = queue.pop();
        if (D[s] === d + 1) settle(s, d);
      }
    } else {
      for (let d = 0; pending > 0; d++) {
        const bucket = ring[d % spread];
        for (let a = 0; a < bucket.length; a++) {
          const s = bucket[a];
          pending--;
          if (D[s] === d + 1) settle(s, d);
        }
        bucket.length = 0;
      }
    }

    // A* from the starts over (layer, cell, direction of the last step). Costs are kept plus one so that 0 is "not seen".
    const size = 2 * wn * 9;
    const gs = new Float32Array(size), parent = new Int32Array(size), done = new Uint8Array(size);
    const q = heap();
    const dc = (s: number) => (D[s] - 1) / SCALE;
    for (const [l, k] of starts) {
      const i = k % nx, j = (k / nx) | 0, at0 = at(l, i, j);
      if (i < i0 || i > i1 || j < j0 || j > j1) throw new Error(`${name}: a start cell is outside the search window (a bug in the router)`);
      if (!D[at0]) continue;
      const s = at0 * 9 + NONE;
      gs[s] = 1;
      q.push(dc(at0) * PULL, s);
    }
    let end = -1;
    while (q.size) {
      const s = q.pop();
      if (done[s]) continue;
      done[s] = 1;
      const dir = s % 9, c = (s - dir) / 9, l = c >= wn ? 1 : 0, w = c - l * wn;
      const i = i0 + (w % wnx), j = j0 + ((w / wnx) | 0), k = j * nx + i;
      if (goal[l][k]) { end = s; break; }
      const base = gs[s] - 1;
      for (let d = 0; d < 8; d++) {
        const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
        if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
        const nk = nj * nx + ni;
        if (!open(l, nk)) continue;
        if (d & 1 && !(open(l, j * nx + ni) && open(l, nj * nx + i))) continue;
        const nc = at(l, ni, nj);
        if (!D[nc]) continue; // the goal cannot be reached from there
        const turn = dir === NONE ? 0 : Math.min((d - dir + 8) % 8, (dir - d + 8) % 8);
        const cost = Math.fround(base + ((d & 1 ? Math.SQRT2 : 1) + (dear(l, nk) ? 0.5 : 0)) * mul[l] + turn * turnCost + 1);
        const ns = nc * 9 + d;
        if (!gs[ns] || cost < gs[ns]) {
          gs[ns] = cost; parent[ns] = s + 1;
          q.push(cost - 1 + dc(nc) * PULL, ns);
        }
      }
      if (opts.via && may[1 - l] && (!oneWay || 1 - l === toLayer) && viaOpen(k) && open(1 - l, k)) {
        const nc = at(1 - l, i, j), ns = nc * 9 + NONE, cost = Math.fround(base + viaCost + 1);
        if (D[nc] && (!gs[ns] || cost < gs[ns])) {
          gs[ns] = cost; parent[ns] = s + 1;
          q.push(cost - 1 + dc(nc) * PULL, ns);
        }
      }
    }
    if (end < 0) return undefined;

    // Back along the parents.
    const cells: { l: number; k: number }[] = [];
    for (let s = end; ; s = parent[s] - 1) {
      const c = (s - (s % 9)) / 9, l = c >= wn ? 1 : 0, w = c - l * wn;
      cells.push({ l, k: (j0 + ((w / wnx) | 0)) * nx + i0 + (w % wnx) });
      if (!parent[s]) break;
    }
    return { cells: cells.reverse(), cost: gs[end] - 1 };
  };

  // ---- windows ----
  // A path through cell e costs at least the straight way from the pads to e and on to the goal (a step costs at
  // least its length), so a path cheaper than `best` stays inside an ellipse with the two pads for foci. The first
  // window is the pads' box grown by WINDOW_MM (grown threefold while it finds no path). If it finds one and the
  // window holds the ellipse of its cost, that path is the cheapest on the whole board; if not, one more search in the
  // ellipse's own window settles it.
  type Win = { i0: number; j0: number; i1: number; j1: number };
  const cell = (v: number, at0: number, top: number) => Math.max(0, Math.min(top, Math.round((v - at0) / g)));
  const cover = (b: Box, by: number): Win => ({
    i0: cell(b.x0 - by, px(0), nx - 1), i1: cell(b.x1 + by, px(0), nx - 1), j0: cell(b.y0 - by, py(0), ny - 1), j1: cell(b.y1 + by, py(0), ny - 1),
  });
  const area = (w: Win) => (w.i1 - w.i0 + 1) * (w.j1 - w.j0 + 1);
  const holds = (w: Win, o: Win) => w.i0 <= o.i0 && w.j0 <= o.j0 && w.i1 >= o.i1 && w.j1 >= o.j1;
  const both: Box = { x0: Math.min(boxes[0].x0, boxes[1].x0), y0: Math.min(boxes[0].y0, boxes[1].y0), x1: Math.max(boxes[0].x1, boxes[1].x1), y1: Math.max(boxes[0].y1, boxes[1].y1) };
  const ellipse = (cost: number): Win => {
    const [a, b] = boxes.map((o) => ({ c: [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2], r: Math.hypot(o.x1 - o.x0, o.y1 - o.y0) / 2 }));
    const sum = cost * g + a.r + b.r, f = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1]) / 2;
    const major = sum / 2, minor = Math.sqrt(Math.max(0, major * major - f * f)), t = Math.atan2(b.c[1] - a.c[1], b.c[0] - a.c[0]);
    const mx = (a.c[0] + b.c[0]) / 2, my = (a.c[1] + b.c[1]) / 2;
    const hw = Math.hypot(major * Math.cos(t), minor * Math.sin(t)), hh = Math.hypot(major * Math.sin(t), minor * Math.cos(t));
    return cover({ x0: Math.min(mx - hw, both.x0), y0: Math.min(my - hh, both.y0), x1: Math.max(mx + hw, both.x1), y1: Math.max(my + hh, both.y1) }, 2 * g);
  };
  let best: Found | undefined, win = cover(both, around);
  for (let proving = false; ; ) {
    const found = search(win.i0, win.j0, win.i1, win.j1, proving && best ? best.cost + 1e-6 : Infinity);
    if (found && (!best || found.cost < best.cost)) best = found;
    if (proving || area(win) === n) break;
    if (!best) {
      win = cover(both, (around = Math.max(around * 3, WINDOW_MM))); // always wider, even from 0
      continue;
    }
    const e = ellipse(best.cost);
    if (holds(win, e)) break;
    win = e;
    proving = true;
  }
  if (!best) {
    throw new Error(`${name}: no path${opts.via ? "" : " (vias are not allowed: pass { via: true } if the pads are on different layers)"}; ` +
      `${starts.length} start cells, ${goals.length} end cells, the board may be too full for a ${width} mm track`);
  }

  // ---- back to tracks and vias ----
  const { cells } = best;
  const tracks: Track[] = [], vias: Via[] = [];
  let run: Pt[] = [], runLayer = cells[0].l, lengthMm = 0;
  const flush = () => {
    if (run.length > 1) {
      const pts: Pt[] = [run[0]];
      for (let m = 1; m < run.length - 1; m++) {
        const a = pts[pts.length - 1], b = run[m], c = run[m + 1];
        if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9) pts.push(b);
      }
      pts.push(run[run.length - 1]);
      tracks.push({ net, layer: LAYERS[runLayer], pts, width });
      for (let m = 1; m < pts.length; m++) lengthMm += dist(pts[m - 1], pts[m]);
    }
  };
  for (const { l, k } of cells) {
    const p: Pt = [px(k % nx), py((k / nx) | 0)];
    if (l !== runLayer) {
      flush();
      vias.push({ net, x: p[0], y: p[1], drill: rules.viaDrillMm, dia: rules.viaPadMm });
      run = [];
      runLayer = l;
    }
    run.push(p);
  }
  flush();
  return { tracks, vias, lengthMm, cost: best.cost };
}
