// From the board to the layers a fab reads. `buildFab` turns BoardData into Gerber-level primitives, one list per
// layer file, in the order they are drawn, and the two drill lists. The Gerber writer prints these lists, the DRC
// rasterises them and the SVG previews paint them, so what is checked is what is made.
//
// A copper layer with a pour is drawn in four steps, as a fab's CAM reads it:
//   1. the pour: one region, dark, inset from the edge;
//   2. the clearances: everything of another net (and every hole and keepout) cut out of it, clear polarity;
//   3. the necks: where two cut-outs leave pour narrower than the rules allow, that is cut out too (thin.ts);
//   4. all the copper again, dark: pads, tracks, vias and the thermal spokes of the pour's own pads.

import { bbox, grow, insideBoard, padShape, ptShape, roundedRect, type Shape } from "./geometry.ts";
import { newRaster, paint, type Raster } from "./raster.ts";
import type { Rules } from "./rules.ts";
import { knockouts, thin } from "./thin.ts";
import type { Aperture, BoardData, Drill, Dot, GerberLayer, Item, Layer, Pad, Pt, Stroke } from "./types.ts";

export type Fab = { layers: GerberLayer[]; pth: Drill[]; npth: Drill[]; silk: { strokes: Stroke[]; dots: Dot[] } };

const bit = (n: number) => Math.round(n * 1e6) / 1e6;

/** The aperture that flashes a pad grown by `by` on every side. */
export function padAperture(p: Pad, by = 0): Aperture {
  if (p.shape === "circle") return { kind: "C", d: bit(p.w + 2 * by) };
  return { kind: p.shape === "oval" ? "O" : "R", w: bit(p.w + 2 * by), h: bit(p.h + 2 * by) };
}

const flash = (ap: Aperture, x: number, y: number, pol: "D" | "C"): Item => ({ op: "flash", ap, x, y, pol });
const draw = (a: Pt, b: Pt, d: number, pol: "D" | "C"): Item =>
  a[0] === b[0] && a[1] === b[1] ? flash({ kind: "C", d: bit(d) }, a[0], a[1], pol) : { op: "draw", d: bit(d), a, b, pol };

/** The pour's polygon: the board outline pulled in by the rules' inset. */
export function pourOutline(data: BoardData, rules: Rules): Pt[] {
  const w = data.width - 2 * rules.pourInsetMm, h = data.height - 2 * rules.pourInsetMm;
  return roundedRect(w, h, Math.max(0, data.corner - rules.pourInsetMm));
}

/** A thermal spoke: from a pour-net pad's centre out across the pour's clearance ring to the pour. It is copper of
 * the pad's net, so the router and the audit treat it as such. */
export type Spoke = { pad: Pad; a: Pt; b: Pt };

export function spokes(data: BoardData, rules: Rules, layer: Layer): Spoke[] {
  const pour = data.pours.find((p) => p.layer === layer);
  if (!pour) return [];
  return data.pads
    .filter((p) => p.layers.includes(layer) && p.net === pour.net)
    .flatMap((p) =>
      (p.spokes ?? []).map(([sx, sy]): Spoke => {
        const reach = (Math.abs(sx) * p.w) / 2 + (Math.abs(sy) * p.h) / 2 + pour.clearance + 0.2;
        return { pad: p, a: [p.x, p.y], b: [bit(p.x + sx * reach), bit(p.y + sy * reach)] };
      }));
}

/** The raster the thin-copper check works on: the board's outline at the rules' `thinGridMm`. Both the fill below
 * and the audit use it, so their pixels are the same pixels. */
export function thinRaster(data: BoardData, rules: Rules): Raster {
  return newRaster(grow(bbox({ kind: "poly", pts: data.outline }), 0.1), rules.thinGridMm);
}

/** Cut-outs over the pour's necks, found on a raster of the pour as it stands in `items` (a cut-out can leave
 * another neck, so a few rounds). */
function necks(data: BoardData, rules: Rules, items: Item[]): Item[] {
  const raster = thinRaster(data, rules);
  paint(raster, items);
  const cuts: Item[] = [];
  for (let round = 0; round < 4; round++) {
    const { parts, mask } = thin(raster, rules.copperMinMm, rules.thinTipMm2);
    if (!parts.length) break;
    const more = knockouts(raster, mask).map((pts): Item => ({ op: "region", pts, pol: "C" }));
    paint(raster, more);
    cuts.push(...more);
  }
  return cuts;
}

function copperItems(data: BoardData, rules: Rules, layer: Layer): Item[] {
  const items: Item[] = [];
  const pour = data.pours.find((p) => p.layer === layer);
  const pads = data.pads.filter((p) => p.layers.includes(layer));
  const tracks = data.tracks.filter((t) => t.layer === layer);
  if (pour) {
    const c = pour.clearance;
    items.push({ op: "region", pts: pourOutline(data, rules), pol: "D" });
    for (const p of pads) if (p.net !== pour.net || p.spokes?.length) items.push(flash(padAperture(p, c), p.x, p.y, "C"));
    for (const t of tracks)
      if (t.net !== pour.net) for (let i = 0; i < Math.max(1, t.pts.length - 1); i++) items.push(draw(t.pts[i], t.pts[Math.min(i + 1, t.pts.length - 1)], t.width + 2 * c, "C"));
    for (const v of data.vias) if (v.net !== pour.net) items.push(flash({ kind: "C", d: bit(v.dia + 2 * c) }, v.x, v.y, "C"));
    for (const h of data.holes) items.push(flash({ kind: "C", d: bit(2 * h.keepout) }, h.x, h.y, "C"));
    for (const k of data.keepouts.filter((k) => k.layer === layer && k.pour)) {
      items.push({ op: "region", pts: k.pts, pol: "C" });
      for (let i = 0; i < k.pts.length; i++) items.push(draw(k.pts[i], k.pts[(i + 1) % k.pts.length], 2 * c, "C"));
    }
    items.push(...necks(data, rules, items));
  }
  items.push(...ownCopper(data, rules, layer));
  return items;
}

/** The board's own copper on a layer, drawn dark: pads, tracks, vias and the pour's thermal spokes. The pour is
 * everything else the layer has, and the only copper the thin-copper check measures (a track's width is checked on
 * the track). */
export function ownCopper(data: BoardData, rules: Rules, layer: Layer): Item[] {
  const items: Item[] = [];
  for (const p of data.pads.filter((p) => p.layers.includes(layer))) items.push(flash(padAperture(p), p.x, p.y, "D"));
  for (const t of data.tracks.filter((t) => t.layer === layer))
    for (let i = 0; i < Math.max(1, t.pts.length - 1); i++) items.push(draw(t.pts[i], t.pts[Math.min(i + 1, t.pts.length - 1)], t.width, "D"));
  for (const v of data.vias) items.push(flash({ kind: "C", d: bit(v.dia) }, v.x, v.y, "D"));
  for (const s of spokes(data, rules, layer)) items.push(draw(s.a, s.b, rules.spokeMm, "D"));
  return items;
}

function maskItems(data: BoardData, rules: Rules, layer: Layer): Item[] {
  const e = rules.maskExpandMm;
  const items = data.pads.filter((p) => p.layers.includes(layer)).map((p) => flash(padAperture(p, e), p.x, p.y, "D"));
  for (const h of data.holes) items.push(flash({ kind: "C", d: bit(h.drill + 2 * e) }, h.x, h.y, "D"));
  return items;
}

/** The silkscreen with what falls on a mask opening, a via, a hole's keepout (where a boss or a screw head sits) or
 * the board edge cut away. A stroke is walked in 0.04 mm steps and the steps that stay clear are kept. */
export function clipSilk(data: BoardData, rules: Rules): { strokes: Stroke[]; dots: Dot[] } {
  const keep = rules.silkPadGapMm;
  const shapes: { s: Shape; by: number }[] = [];
  for (const p of data.pads) if (p.layers.includes("F.Cu")) shapes.push({ s: padShape(p), by: rules.maskExpandMm + keep });
  for (const v of data.vias) shapes.push({ s: { kind: "circle", c: [v.x, v.y], r: v.dia / 2 }, by: keep });
  for (const h of data.holes) shapes.push({ s: { kind: "circle", c: [h.x, h.y], r: h.keepout }, by: 0 });
  const clear = (p: Pt, w: number) =>
    insideBoard(data.width, data.height, data.corner, p[0], p[1], rules.silkEdgeMm + w / 2) &&
    shapes.every(({ s, by }) => ptShape(p, s) >= by + w / 2);

  const strokes: Stroke[] = [];
  for (const st of data.silk.strokes) {
    const samples: { p: Pt; vertex: boolean }[] = [];
    st.pts.forEach((b, i) => {
      if (i > 0) {
        const a = st.pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04));
        for (let k = 1; k < n; k++) samples.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], vertex: false });
      }
      samples.push({ p: b, vertex: true });
    });
    const dot = samples.every((s) => s.p[0] === samples[0].p[0] && s.p[1] === samples[0].p[1]);
    let run: typeof samples = [];
    const flush = () => {
      const len = run.reduce((sum, s, i) => (i ? sum + Math.hypot(s.p[0] - run[i - 1].p[0], s.p[1] - run[i - 1].p[1]) : 0), 0);
      if (run.length && (dot || len >= 0.1))
        strokes.push({ width: st.width, pts: run.filter((s, i) => s.vertex || i === 0 || i === run.length - 1).map((s) => s.p) });
      run = [];
    };
    for (const s of samples) {
      if (clear(s.p, st.width)) run.push(s);
      else flush();
    }
    flush();
  }
  return { strokes, dots: data.silk.dots.filter((d) => clear([d.x, d.y], d.d)) };
}

export function buildFab(data: BoardData, rules: Rules): Fab {
  const silk = clipSilk(data, rules);
  const outline = data.outline;
  const layers: GerberLayer[] = [
    { file: "F_Cu.gtl", fn: "Copper,L1,Top", polarity: "Positive", items: copperItems(data, rules, "F.Cu") },
    { file: "B_Cu.gbl", fn: "Copper,L2,Bot", polarity: "Positive", items: copperItems(data, rules, "B.Cu") },
    // A mask file is drawn with the openings: dark is where the mask is left off.
    { file: "F_Mask.gts", fn: "Soldermask,Top", polarity: "Negative", items: maskItems(data, rules, "F.Cu") },
    { file: "B_Mask.gbs", fn: "Soldermask,Bot", polarity: "Negative", items: maskItems(data, rules, "B.Cu") },
    {
      file: "F_Silkscreen.gto", fn: "Legend,Top", polarity: "Positive",
      items: [
        ...silk.strokes.flatMap((s): Item[] =>
          s.pts.length < 2 ? [draw(s.pts[0], s.pts[0], s.width, "D")] : s.pts.slice(1).map((b, i) => draw(s.pts[i], b, s.width, "D"))),
        ...silk.dots.map((d) => flash({ kind: "C", d: bit(d.d) }, d.x, d.y, "D")),
      ],
    },
    { file: "Edge_Cuts.gm1", fn: "Profile,NP", polarity: "Positive", items: outline.map((p, i) => draw(p, outline[(i + 1) % outline.length], 0.1, "D")) },
  ];
  const pth: Drill[] = [
    ...data.vias.map((v) => ({ x: v.x, y: v.y, d: v.drill })),
    ...data.pads.filter((p) => p.drill).map((p) => ({ x: p.x, y: p.y, d: p.drill! })),
  ];
  const npth: Drill[] = data.holes.map((h) => ({ x: h.x, y: h.y, d: h.drill }));
  return { layers, pth, npth, silk };
}
