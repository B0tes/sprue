// The router's obstacle map, kept between routes. For one board and one track width it holds, on the router's grid
// (rules.gridMm cells), which net may enter each cell of each layer: 0 free, a net's id when only that net may, -1
// nobody. Every copper item already on the board (pads, tracks, vias, the thermal spokes of a declared pour), every
// hole, keepout and the board edge is stamped into it, grown by the clearance rule plus half the track and a margin
// for a diagonal step cutting a corner, so a path of cell centres is clear of everything by the rules whatever the
// grid does. A second map keeps the cells where a via fits (a via also keeps the hole spacing from every other via,
// whatever the net: copper of one net may touch, drills may not), and a third marks the cells close to another net's
// copper, which the router makes a little dearer so tracks keep to the middle of a channel.
//
// A stamp never undoes another (a cell two nets both claim is -1), so the order does not matter and a map can be
// brought up to date by stamping only what was added since: that is `sync`, which the router calls before every route.
// It rebuilds from scratch if the board changed in another way (a pour declared late changes the spokes, an outline
// drawn again moves the edge).

import { bbox, grow, holeShape, insideBoard, padShape, ptShape, segShape, viaShape, type Shape } from "./geometry.ts";
import { spokes } from "./layers.ts";
import type { Rules } from "./rules.ts";
import type { BoardData, Layer } from "./types.ts";

export const LAYERS: Layer[] = ["F.Cu", "B.Cu"];

export type Field = {
  nx: number;
  ny: number;
  /** The centre of cell (i, j) is (px(i), py(j)); the cell's number is j * nx + i. */
  px(i: number): number;
  py(j: number): number;
  /** The id of a net (0 is never one): -1 for no net. */
  idOf(net: string): number;
  owner: Record<Layer, Int16Array>;
  viaMap: Int16Array;
  /** Per layer: the net whose copper is within the soft distance, -1 when two nets' is. Empty when `softMm` is 0. */
  near: Record<Layer, Int16Array>;
  /** Stamps what was added to the board since the last call. */
  sync(): void;
};

const cache = new WeakMap<BoardData, Map<string, Field & { rules: Rules; pours: number; board: string }>>();

/** The obstacle map of `data` for tracks `width` wide and a soft zone of `softMm`, brought up to date. */
export function fieldFor(data: BoardData, rules: Rules, width: number, softMm: number): Field {
  const key = `${width}|${softMm}`;
  let byKey = cache.get(data);
  if (!byKey) cache.set(data, (byKey = new Map()));
  let f = byKey.get(key);
  const board = `${data.width}|${data.height}|${data.corner}`; // what the edge is stamped from
  if (!f || f.rules !== rules || f.pours !== data.pours.length || f.board !== board)
    byKey.set(key, (f = { ...makeField(data, rules, width, softMm), rules, pours: data.pours.length, board }));
  f.sync();
  return f;
}

function makeField(data: BoardData, rules: Rules, width: number, softMm: number): Field {
  const g = rules.gridMm;
  const nx = Math.floor(data.width / g), ny = Math.floor(data.height / g);
  const x0 = -(nx * g) / 2 + g / 2, y0 = -(ny * g) / 2 + g / 2;
  const n = nx * ny;
  const px = (i: number) => x0 + i * g, py = (j: number) => y0 + j * g;
  const margin = (g * Math.SQRT2) / 2;
  const clear = rules.clearanceMm;
  const tk = clear + width / 2 + margin;
  const vr = rules.viaPadMm / 2;
  const vk = clear + vr + margin;
  const soft = softMm > 0 ? tk + softMm : 0;

  const ids = new Map<string, number>();
  const idOf = (s: string) => (s === "" ? -1 : ids.get(s) ?? (ids.set(s, ids.size + 1), ids.size));
  const owner: Record<Layer, Int16Array> = { "F.Cu": new Int16Array(n), "B.Cu": new Int16Array(n) };
  const near: Record<Layer, Int16Array> = { "F.Cu": new Int16Array(soft ? n : 0), "B.Cu": new Int16Array(soft ? n : 0) };
  const viaMap = new Int16Array(n);
  const stamp = (map: Int16Array, s: Shape, ext: number, id: number) => {
    const b = grow(bbox(s), ext);
    const i0 = Math.max(0, Math.ceil((b.x0 - x0) / g)), i1 = Math.min(nx - 1, Math.floor((b.x1 - x0) / g));
    const j0 = Math.max(0, Math.ceil((b.y0 - y0) / g)), j1 = Math.min(ny - 1, Math.floor((b.y1 - y0) / g));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (ptShape([px(i), py(j)], s) >= ext) continue;
        const k = j * nx + i, cur = map[k];
        map[k] = cur === 0 || cur === id ? id : -1;
      }
  };
  /** Copper of net `id` on `layers`: blocks other nets' tracks and vias, and marks the soft zone round it. */
  const copper = (layers: Layer[], s: Shape, id: number) => {
    for (const l of layers) {
      if (soft) stamp(near[l], s, soft, id);
      stamp(owner[l], s, tk, id);
    }
    stamp(viaMap, s, vk, id);
  };

  // The board edge: the tracks' centres and the vias' stay inside the rules' edge distance.
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!insideBoard(data.width, data.height, data.corner, px(i), py(j), rules.edgeMm + width / 2 + margin)) {
        owner["F.Cu"][k] = -1; owner["B.Cu"][k] = -1;
      }
      if (!insideBoard(data.width, data.height, data.corner, px(i), py(j), rules.edgeMm + vr + margin)) viaMap[k] = -1;
    }

  const seen = { pads: 0, tracks: 0, vias: 0, holes: 0, keepouts: 0 };
  const sync = () => {
    for (; seen.pads < data.pads.length; seen.pads++) {
      const p = data.pads[seen.pads];
      copper(p.layers, padShape(p), idOf(p.net));
      stamp(viaMap, padShape(p), vr + rules.viaTentGapMm + margin, -1);
    }
    for (; seen.tracks < data.tracks.length; seen.tracks++) {
      const t = data.tracks[seen.tracks];
      for (let i = 0; i < Math.max(1, t.pts.length - 1); i++) copper([t.layer], segShape(t, i), idOf(t.net));
    }
    for (; seen.vias < data.vias.length; seen.vias++) {
      const v = data.vias[seen.vias];
      copper(LAYERS, viaShape(v), idOf(v.net));
      stamp(viaMap, holeShape(v.x, v.y, v.drill), rules.viaDrillMm / 2 + rules.holeGapWarnMm, -1); // drills keep apart even when the copper may touch
    }
    for (; seen.holes < data.holes.length; seen.holes++) {
      const h = data.holes[seen.holes];
      const s = holeShape(h.x, h.y, 2 * h.keepout);
      for (const l of LAYERS) stamp(owner[l], s, width / 2 + margin, -1);
      stamp(viaMap, s, vr + margin, -1);
    }
    for (; seen.keepouts < data.keepouts.length; seen.keepouts++) {
      const k = data.keepouts[seen.keepouts];
      if (!k.tracks) continue;
      const s: Shape = { kind: "poly", pts: k.pts };
      stamp(owner[k.layer], s, width / 2 + margin, -1);
      stamp(viaMap, s, vr + margin, -1);
    }
    // A pad of the pour's net gets its spokes once the pour is declared, and a pad placed later gets them too:
    // stamping a spoke again changes nothing, so they are all stamped each time.
    for (const l of LAYERS)
      for (const sp of spokes(data, rules, l)) copper([l], { kind: "capsule", a: sp.a, b: sp.b, r: rules.spokeMm / 2 }, idOf(sp.pad.net));
  };

  return { nx, ny, px, py, idOf, owner, viaMap, near, sync };
}
