// The audit. Two kinds of check, both on the data that is written:
//  (a) geometry on the board's primitives: clearance, edge, hole, ring, via and silkscreen rules;
//  (b) connectivity on a raster of the very layer lists the Gerber writer prints (layers.ts), painted in order with
//      dark and clear polarity, at RASTER_MM per pixel: which pads end up in one piece of copper, and whether two
//      nets ended up in the same piece (a short).
//  (c) thin pour: on each layer's raster, pour narrower than the rules' minimum (a neck between two cut-outs) over
//      more than a corner's tip. The board's own copper is held to its width rules on the primitives instead.
// It is our own DRC at the rules in rules.ts, not the fab's.

import { bbox, gap, grow, holeShape, insideBoard, padShape, segShape, viaShape, boxesTouch, type Box, type Shape } from "./geometry.ts";
import { ownCopper, spokes, thinRaster, type Fab } from "./layers.ts";
import { label, link, newRaster, paint, pieceAt, pieces, rootOf, stack } from "./raster.ts";
import { RULE_NOTES, type Rules } from "./rules.ts";
import { thin } from "./thin.ts";
import type { BoardData, Layer, Pt } from "./types.ts";

export const RASTER_MM = 0.025;
/** Tolerance on a measured gap, for the float arithmetic of rounded coordinates. */
const EPS = 0.001;

export type Audit = {
  rules: Record<string, { value: number; note: string }>;
  errors: string[];
  warnings: string[];
  nets: Record<string, { pads: string[]; connected: boolean }>;
  stats: Record<string, number | string>;
};

type Cu = { id: string; net: string; shape: Shape; box: Box; layer: Layer; ref: string };

const at = ([x, y]: Pt) => `(${x.toFixed(2)}, ${y.toFixed(2)})`;
const mm = (v: number) => `${Math.round(v * 1000) / 1000} mm`;
const padId = (p: { ref: string; num: string }) => (p.ref ? `${p.ref}.${p.num}` : `pad ${p.num}`);
const centre = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

/** The rules with what each is for, as drc.json lists them. */
export const ruleTable = (rules: Rules): Audit["rules"] =>
  Object.fromEntries((Object.keys(rules) as (keyof Rules)[]).map((k) => [k, { value: rules[k], note: RULE_NOTES[k] }]));

export function audit(data: BoardData, fab: Fab, rules: Rules): Audit {
  const errors: string[] = [...data.problems];
  const warnings: string[] = [...data.notes];
  const outline = data.outline;
  if (!outline.length) return { rules: {}, errors: ["no board outline: call pcb.outline(w, h, cornerR)"], warnings, nets: {}, stats: {} };

  // ---- the copper, per layer ----
  const copper: Cu[] = [];
  const add = (c: Omit<Cu, "box">) => copper.push({ ...c, box: bbox(c.shape) });
  for (const p of data.pads)
    for (const l of p.layers) add({ id: padId(p), net: p.net || `~${padId(p)}`, shape: padShape(p), layer: l, ref: p.ref });
  data.tracks.forEach((t, n) => {
    for (let i = 0; i < Math.max(1, t.pts.length - 1); i++)
      add({ id: `track ${t.net || "(no net)"} #${n + 1}`, net: t.net || `~track${n}`, shape: segShape(t, i), layer: t.layer, ref: "" });
  });
  for (const v of data.vias)
    for (const l of ["F.Cu", "B.Cu"] as Layer[]) add({ id: `via ${at([v.x, v.y])}`, net: v.net || `~via${v.x},${v.y}`, shape: viaShape(v), layer: l, ref: "" });
  // The thermal spokes are drawn in the Gerber, so they are copper like any other: clearance, edge and hole checks apply.
  for (const l of ["F.Cu", "B.Cu"] as Layer[])
    for (const sp of spokes(data, rules, l))
      add({ id: `${padId(sp.pad)} spoke`, net: sp.pad.net, shape: { kind: "capsule", a: sp.a, b: sp.b, r: rules.spokeMm / 2 }, layer: l, ref: sp.pad.ref });

  // clearance between nets
  const seen = new Set<string>();
  for (let a = 0; a < copper.length; a++)
    for (let b = a + 1; b < copper.length; b++) {
      const A = copper[a], B = copper[b];
      if (A.layer !== B.layer || A.net === B.net || !boxesTouch(grow(A.box, rules.clearanceMm), B.box)) continue;
      const d = gap(A.shape, B.shape);
      const key = `${A.layer}|${A.id}|${B.id}`;
      if (d < rules.clearanceMm - EPS && !seen.has(key)) {
        seen.add(key);
        errors.push(`clearance on ${A.layer}: ${A.id} (${A.net.startsWith("~") ? "no net" : A.net}) and ${B.id} (${B.net.startsWith("~") ? "no net" : B.net}) are ${mm(d)} apart near ${at(centre(A.box))}, the rule is ${mm(rules.clearanceMm)}`);
      }
    }

  // trace width
  data.tracks.forEach((t, n) => {
    if (t.width < rules.trackMinMm - EPS) errors.push(`track ${t.net || "(no net)"} #${n + 1} on ${t.layer} is ${mm(t.width)} wide, the minimum is ${mm(rules.trackMinMm)}`);
  });

  // copper to the board edge
  const edges: Shape[] = outline.map((p, i) => ({ kind: "capsule", a: p, b: outline[(i + 1) % outline.length], r: 0 }));
  const edgeGap = (s: Shape, b: Box) => {
    const [cx, cy] = centre(b);
    if (!insideBoard(data.width, data.height, data.corner, cx, cy)) return 0;
    const corners: Pt[] = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    if (corners.every(([x, y]) => insideBoard(data.width, data.height, data.corner, x, y, rules.edgeMm + 0.5))) return Infinity;
    return Math.min(...edges.map((e) => gap(s, e)));
  };
  const edgeSeen = new Set<string>();
  for (const c of copper) {
    const d = edgeGap(c.shape, c.box);
    if (d < rules.edgeMm - EPS && !edgeSeen.has(c.id)) {
      edgeSeen.add(c.id);
      errors.push(`edge: ${c.id} on ${c.layer} is ${mm(d)} from the board edge near ${at(centre(c.box))}, the rule is ${mm(rules.edgeMm)}`);
    }
  }

  // copper to non-plated holes
  for (const h of data.holes) {
    const keep = h.keepout; // never under the hole's edge plus the clearance rule: pcb.hole() sees to that
    const ring: Shape = holeShape(h.x, h.y, 2 * keep);
    const rb = bbox(ring);
    for (const c of copper) {
      if (!boxesTouch(c.box, rb) || gap(c.shape, ring) > 0) continue;
      errors.push(`hole: ${c.id} on ${c.layer} is inside the ${mm(keep)} copper keepout of the ${h.drill} mm hole at ${at([h.x, h.y])}${h.ref ? ` (${h.ref})` : ""}`);
    }
  }

  // keepouts
  for (const k of data.keepouts.filter((k) => k.tracks)) {
    const poly: Shape = { kind: "poly", pts: k.pts };
    const kb = bbox(poly);
    const hit = new Set<string>();
    for (const c of copper) {
      if (c.layer !== k.layer || c.ref === k.ref && c.ref !== "" || !boxesTouch(c.box, kb) || gap(c.shape, poly) > 1e-6) continue;
      if (!hit.has(c.id)) {
        errors.push(`keepout${k.ref ? ` of ${k.ref}` : ""} on ${k.layer}: ${c.id} is inside it near ${at(centre(c.box))}`);
        hit.add(c.id);
      }
    }
  }

  // vias, plated pads and drills
  const holes: { x: number; y: number; d: number; plated: boolean; name: string; ref: string }[] = [];
  for (const v of data.vias) {
    holes.push({ x: v.x, y: v.y, d: v.drill, plated: true, name: "via", ref: "via" });
    if (v.drill < rules.drillMinMm - EPS) errors.push(`via ${at([v.x, v.y])}: drill ${mm(v.drill)} is under the ${mm(rules.drillMinMm)} minimum`);
    if ((v.dia - v.drill) / 2 < rules.ringMm - EPS) errors.push(`via ${at([v.x, v.y])}: annular ring ${mm((v.dia - v.drill) / 2)} is under the ${mm(rules.ringMm)} minimum`);
  }
  for (const p of data.pads.filter((p) => p.drill)) {
    holes.push({ x: p.x, y: p.y, d: p.drill!, plated: true, name: padId(p), ref: p.ref });
    if (p.drill! < rules.drillMinMm - EPS) errors.push(`${padId(p)}: plated hole ${mm(p.drill!)} is under the ${mm(rules.drillMinMm)} minimum`);
    const ring = Math.min(p.w, p.h) / 2 - p.drill! / 2;
    if (ring < rules.ringMm - EPS) errors.push(`${padId(p)}: annular ring ${mm(ring)} is under the ${mm(rules.ringMm)} minimum`);
  }
  for (const h of data.holes) {
    holes.push({ x: h.x, y: h.y, d: h.drill, plated: false, name: `${h.drill} mm hole`, ref: h.ref });
    if (h.drill < rules.npthMinMm - EPS) errors.push(`hole ${at([h.x, h.y])}: ${mm(h.drill)} is under the ${mm(rules.npthMinMm)} minimum for a non-plated hole`);
  }
  // Every drill against every other by position in the list, not by coordinates: two drills at one spot are a gap of
  // minus their size, and reported like any other pair that is too close.
  const close = new Map<string, { gap: number; d: [number, number]; refs: Set<string> }>();
  for (let a = 0; a < holes.length; a++)
    for (let b = a + 1; b < holes.length; b++) {
      const A = holes[a], B = holes[b];
      const d = Math.hypot(A.x - B.x, A.y - B.y) - (A.d + B.d) / 2;
      if (d >= rules.holeGapWarnMm - EPS) continue;
      const sizes: [number, number] = A.d <= B.d ? [A.d, B.d] : [B.d, A.d];
      const key = `${d < rules.holeGapMm - EPS ? "e" : "w"}|${sizes}|${d.toFixed(3)}`;
      const g = close.get(key) ?? { gap: d, d: sizes, refs: new Set<string>() };
      g.refs.add(A.ref || B.ref || at([A.x, A.y]));
      close.set(key, g);
    }
  for (const [key, g] of close) {
    const refs = [...g.refs];
    const where = `${refs.slice(0, 4).join(", ")}${refs.length > 4 ? ` and ${refs.length - 4} more` : ""}`;
    const text = `holes ${mm(g.d[0])} and ${mm(g.d[1])} are ${mm(g.gap)} edge to edge at ${where}`;
    if (key.startsWith("e")) errors.push(`${text}, the minimum is ${mm(rules.holeGapMm)}`);
    else warnings.push(`${text}: above JLCPCB's ${mm(rules.holeGapMm)} limit, under our ${mm(rules.holeGapWarnMm)} margin`);
  }
  for (const h of holes) {
    const d = Math.min(...edges.map((e) => gap({ kind: "circle", c: [h.x, h.y], r: h.d / 2 }, e)));
    const inside = insideBoard(data.width, data.height, data.corner, h.x, h.y);
    if (!inside || d < rules.holeEdgeMm - EPS) errors.push(`hole edge: the ${mm(h.d)} hole at ${at([h.x, h.y])} (${h.name}) is ${mm(inside ? d : 0)} from the board edge, the rule is ${mm(rules.holeEdgeMm)}`);
  }

  // a via stays tented: no pad opening reaches it
  for (const v of data.vias)
    for (const p of data.pads) {
      const d = gap(viaShape(v), padShape(p));
      if (d < rules.viaTentGapMm - EPS) errors.push(`via ${at([v.x, v.y])} is ${mm(d)} from ${padId(p)}, so ${padId(p)}'s mask opening would reach it; keep ${mm(rules.viaTentGapMm)} so the via stays tented`);
    }

  // mask web between two openings on one side
  for (const side of ["F.Cu", "B.Cu"] as Layer[]) {
    const pads = data.pads.filter((p) => p.layers.includes(side));
    for (let a = 0; a < pads.length; a++)
      for (let b = a + 1; b < pads.length; b++) {
        if (padId(pads[a]) === padId(pads[b])) continue;
        const d = gap(padShape(pads[a]), padShape(pads[b])) - 2 * rules.maskExpandMm;
        if (d > 0 && d < rules.maskWebMm - EPS)
          errors.push(`mask: ${padId(pads[a])} and ${padId(pads[b])} openings are ${mm(d)} apart on ${side}, the mask web needs ${mm(rules.maskWebMm)}`);
      }
  }

  // silkscreen, after the clip
  const openings: { id: string; s: Shape }[] = [
    ...data.pads.filter((p) => p.layers.includes("F.Cu")).map((p) => ({ id: padId(p), s: padShape(p, rules.maskExpandMm) })),
    ...data.holes.map((h) => ({ id: `${h.drill} mm hole at ${at([h.x, h.y])}`, s: holeShape(h.x, h.y, h.drill + 2 * rules.maskExpandMm) })),
  ];
  let silkBad = 0;
  for (const st of fab.silk.strokes) {
    if (st.width < rules.silkLineMm - EPS) errors.push(`silkscreen line ${at(st.pts[0])} is ${mm(st.width)} wide, the minimum is ${mm(rules.silkLineMm)}`);
    for (let i = 0; i < Math.max(1, st.pts.length - 1); i++) {
      const s: Shape = { kind: "capsule", a: st.pts[i], b: st.pts[Math.min(i + 1, st.pts.length - 1)], r: st.width / 2 };
      const sb = bbox(s);
      const o = openings.find((o) => boxesTouch(sb, bbox(o.s)) && gap(s, o.s) <= 0);
      if (o && silkBad++ < 5) errors.push(`silkscreen at ${at(st.pts[i])} is over ${o.id}'s opening`);
      const e = Math.min(...edges.map((e) => gap(s, e)));
      if ((e < rules.silkEdgeMm - 0.05 || !insideBoard(data.width, data.height, data.corner, ...st.pts[i])) && silkBad++ < 5)
        errors.push(`silkscreen at ${at(st.pts[i])} is ${mm(e)} from the board edge, the rule is ${mm(rules.silkEdgeMm)}`);
    }
  }

  // ---- (b) connectivity, on the raster of the written layers ----
  const b = bbox({ kind: "poly", pts: outline });
  const box: Box = grow(b, 0.1);
  const layerOf = (n: number) => fab.layers[n].items;
  const rasters = [0, 1].map((n) => {
    const r = newRaster(box, RASTER_MM);
    paint(r, layerOf(n));
    return r;
  });
  const S = stack(rasters.map(label));
  const where = (l: number) => (l === 0 ? "F.Cu" : "B.Cu");
  const through: { x: number; y: number; what: string }[] = [
    ...data.vias.map((v) => ({ x: v.x, y: v.y, what: `via ${at([v.x, v.y])}` })),
    ...data.pads.filter((p) => p.drill && p.layers.length === 2).map((p) => ({ x: p.x, y: p.y, what: padId(p) })),
  ];
  for (const t of through) {
    const f = pieceAt(S, 0, t.x, t.y), bo = pieceAt(S, 1, t.x, t.y);
    if (f < 0 || bo < 0) errors.push(`${t.what} has no copper on ${f < 0 ? "F.Cu" : "B.Cu"} where it is drilled: it joins nothing on that layer`);
    else link(S, f, bo);
  }
  type PadAt = { id: string; net: string; piece: number };
  const padPieces: PadAt[] = [];
  for (const p of data.pads)
    p.layers.forEach((l) => {
      const n = l === "F.Cu" ? 0 : 1;
      const piece = pieceAt(S, n, p.x, p.y);
      if (piece < 0) errors.push(`${padId(p)} has no copper at its centre on ${where(n)} (knocked out by another item?)`);
      else padPieces.push({ id: padId(p), net: p.net || `~${padId(p)}`, piece });
    });
  // Rooted after all the links, so compare roots again here.
  const root = (k: number) => rootOf(S, k);
  const byPiece = new Map<number, PadAt[]>();
  for (const pp of padPieces) {
    const r = root(pp.piece);
    byPiece.set(r, [...(byPiece.get(r) ?? []), pp]);
  }
  const all = pieces(S);
  for (const [r, pads] of byPiece) {
    const nets = [...new Set(pads.map((p) => p.net))];
    if (nets.length > 1) {
      const c = all.get(r)!;
      const label = (n: string) => (n.startsWith("~") ? "an unconnected pad" : `net ${n}`);
      errors.push(`short: ${nets.map(label).join(" and ")} are in one piece of copper near ${at([c.cx, c.cy])} (${[...new Set(pads.map((p) => p.id))].slice(0, 6).join(", ")})`);
    }
  }
  const nets: Audit["nets"] = {};
  const named = [...new Set(data.pads.filter((p) => p.net).map((p) => p.net))].sort();
  for (const name of named) {
    const ids = [...new Set(data.pads.filter((p) => p.net === name).map(padId))];
    const roots = new Set(padPieces.filter((p) => p.net === name).map((p) => root(p.piece)));
    const reached = roots.size === 1 && padPieces.filter((p) => p.net === name).length >= ids.length;
    const alone = ids.length === 1 && !data.singles.includes(name);
    nets[name] = { pads: ids, connected: reached && !alone };
    if (!reached && ids.length > 1) errors.push(`net ${name} is not connected: ${ids.join(", ")} fall in ${roots.size} separate pieces of copper`);
    if (alone) errors.push(`net ${name} has only one pad (${ids[0]}): a typo in a net name, so the pad floats? If one pad is right, say so with pcb.single("${name}")`);
  }
  const padded = new Set(byPiece.keys());
  const islands = [...all.entries()].filter(([r]) => !padded.has(r)).map(([, c]) => c).sort((x, y) => y.area - x.area);
  for (const c of islands.slice(0, 5))
    warnings.push(`copper island on ${[...c.layers].map(where).join("+")} near ${at([c.cx, c.cy])}, ${c.area.toFixed(2)} mm2, touches no pad`);
  if (islands.length > 5) warnings.push(`${islands.length - 5} more copper islands touching no pad, the largest of the rest ${islands[5].area.toFixed(2)} mm2`);

  // ---- (c) thin pour, on its own raster: the pour is what the layer holds besides the board's own copper ----
  [0, 1].forEach((n) => {
    const r = thinRaster(data, rules), own = thinRaster(data, rules);
    paint(r, layerOf(n));
    paint(own, ownCopper(data, rules, where(n)));
    const parts = thin(r, rules.copperMinMm, rules.thinTipMm2, own.data).parts;
    for (const t of parts.slice(0, 5))
      errors.push(`thin pour on ${where(n)} near ${at([t.cx, t.cy])}: ${t.area.toFixed(3)} mm2 of it is narrower than ${mm(rules.copperMinMm)} (a neck between two cut-outs)`);
    if (parts.length > 5) errors.push(`${parts.length - 5} more pieces of thin pour on ${where(n)}`);
  });

  const trackMm = data.tracks.reduce((s, t) => s + t.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - t.pts[i][0], p[1] - t.pts[i][1]), 0), 0);
  return {
    rules: ruleTable(rules),
    errors, warnings, nets,
    stats: {
      boardMm: `${data.width} x ${data.height}`, parts: data.parts.length, pads: data.pads.length, tracks: data.tracks.length,
      trackMm: Math.round(trackMm * 10) / 10, vias: data.vias.length, platedHoles: fab.pth.length, nonPlatedHoles: fab.npth.length,
      silkStrokes: fab.silk.strokes.length, pieces: all.size, rasterMmPerPixel: RASTER_MM,
    },
  };
}
