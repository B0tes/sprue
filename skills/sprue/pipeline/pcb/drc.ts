// The audit. Two kinds of check, both on the data that is written:
//  (a) geometry on the board's primitives: clearance, edge, hole, ring, via and silkscreen rules;
//  (b) connectivity on a raster of the very layer lists the Gerber writer prints (layers.ts), painted in order with
//      dark and clear polarity, at RASTER_MM per pixel: which pads end up in one piece of copper, and whether two
//      nets ended up in the same piece (a short).
//  (c) thin pour: on each layer's raster, pour narrower than the rules' minimum (a neck between two cut-outs) over
//      more than a corner's tip. The board's own copper is held to its width rules on the primitives instead.
// It is our own DRC at the rules in rules.ts, not the fab's. On the way it measures the board's smallest features
// (`measured`: the narrowest copper, the closest nets, the smallest rings and holes) and holds them to each fab's
// published limits (rules.ts FAB_PROFILES), so drc.json can say which fabs the board is inside and why not.

import { bbox, gap, grow, holeShape, insideBoard, padShape, ptShape, segShape, viaShape, boxesTouch, type Box, type Shape } from "./geometry.ts";
import { ownCopper, spokes, thinRaster, type Fab, type Spoke } from "./layers.ts";
import { label, link, newRaster, paint, pieceAt, pieces, rootOf, stack, type Raster } from "./raster.ts";
import { FAB_FEATURES, fabFits, RULE_NOTES, type FabFeature, type Measured, type Rules } from "./rules.ts";
import { thin } from "./thin.ts";
import type { BoardData, Layer, Pt } from "./types.ts";

export const RASTER_MM = 0.025;
/** Tolerance on a measured gap, for the float arithmetic of rounded coordinates. */
const EPS = 0.001;
/** Silkscreen is clipped by walking each stroke in 0.04 mm steps (layers.ts), so between two steps it may come this
 * much closer to an opening than the rule. */
const SILK_EPS = 0.005;
/** How far apart two things may be and still be measured, for `measured`: the closest of anything farther apart
 * reads as farther than every fab's limit. */
const NEAR = 1;

export type Audit = {
  rules: Record<string, { value: number; note: string }>;
  errors: string[];
  warnings: string[];
  nets: Record<string, { pads: string[]; connected: boolean }>;
  /** The board's smallest of each feature a fab limits, and where. */
  measured: Measured;
  /** Each fab profile, and whether `measured` is inside its limits. */
  fabs: ReturnType<typeof fabFits>;
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

/** Whether the layer's raster has copper at (x, y). */
function copperAt(r: Raster, x: number, y: number): boolean {
  const i = Math.floor((x - r.x0) / r.res), j = Math.floor((y - r.y0) / r.res);
  return i >= 0 && j >= 0 && i < r.w && j < r.h && r.data[j * r.w + i] === 1;
}

/** Starved thermals: a pad joined to its pour through spokes must reach it by at least `minSpokes` of them. A spoke
 * reaches the pour when the written layer has copper just past its tip, round its outer half, that is not the pad's
 * own copper: a spoke that ends in a cut-out or a keepout joins nothing. */
function starved(data: BoardData, rules: Rules, rasters: Raster[]): string[] {
  const out: string[] = [];
  (["F.Cu", "B.Cu"] as Layer[]).forEach((layer, n) => {
    const byPad = new Map<string, Spoke[]>();
    for (const sp of spokes(data, rules, layer)) byPad.set(padId(sp.pad), [...(byPad.get(padId(sp.pad)) ?? []), sp]);
    for (const [id, list] of byPad) {
      const own: Shape[] = [padShape(list[0].pad), ...list.map((sp): Shape => ({ kind: "capsule", a: sp.a, b: sp.b, r: rules.spokeMm / 2 }))];
      const reaching = list.filter((sp) => {
        const l = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]), ux = (sp.b[0] - sp.a[0]) / l, uy = (sp.b[1] - sp.a[1]) / l;
        const r = rules.spokeMm / 2 + 2 * RASTER_MM;
        return [-90, -60, -30, 0, 30, 60, 90].some((deg) => {
          const t = (deg * Math.PI) / 180;
          const p: Pt = [sp.b[0] + r * (ux * Math.cos(t) - uy * Math.sin(t)), sp.b[1] + r * (ux * Math.sin(t) + uy * Math.cos(t))];
          return copperAt(rasters[n], ...p) && own.every((s) => ptShape(p, s) > 0);
        });
      }).length;
      if (reaching < rules.minSpokes)
        out.push(`starved thermal: ${id} reaches the pour on ${layer} by ${reaching} spoke${reaching === 1 ? "" : "s"}, the rule is ${rules.minSpokes}`);
    }
  });
  return out;
}

export function audit(data: BoardData, fab: Fab, rules: Rules): Audit {
  const errors: string[] = [...data.problems];
  const warnings: string[] = [...data.notes];
  const outline = data.outline;
  if (!outline.length) return { rules: {}, errors: ["no board outline: call pcb.outline(w, h, cornerR)"], warnings, nets: {}, measured: {}, fabs: {}, stats: {} };
  const measured: Measured = {};
  const measure = (k: FabFeature, v: number, where: string) => {
    const m = measured[k], max = "max" in FAB_FEATURES[k];
    if (!m || (max ? v > m.mm + 1e-9 : v < m.mm - 1e-9)) measured[k] = { mm: Math.round(v * 1000) / 1000 + 0, at: where };
  };
  const named = (c: { id: string; net: string }) => `${c.id} (${c.net.startsWith("~") ? "no net" : c.net})`;

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
      if (A.layer !== B.layer || A.net === B.net || !boxesTouch(grow(A.box, NEAR), B.box)) continue;
      const d = gap(A.shape, B.shape);
      measure("clearanceMm", d, `${named(A)} and ${named(B)} on ${A.layer} near ${at(centre(A.box))}`);
      const key = `${A.layer}|${A.id}|${B.id}`;
      if (d < rules.clearanceMm - EPS && !seen.has(key)) {
        seen.add(key);
        errors.push(`clearance on ${A.layer}: ${named(A)} and ${named(B)} are ${mm(d)} apart near ${at(centre(A.box))}, the rule is ${mm(rules.clearanceMm)}`);
      }
    }
  // The pour keeps its own clearance to the other nets' copper, and its edge its inset from the board's; its necks
  // are no narrower than the thin-pour check below lets through.
  for (const p of data.pours) {
    measure("clearanceMm", p.clearance, `the ${p.net} pour on ${p.layer}, to other nets' copper`);
    measure("edgeMm", rules.pourInsetMm, `the ${p.net} pour on ${p.layer}`);
    measure("trackMinMm", rules.copperMinMm, `a neck of the ${p.net} pour on ${p.layer}, at most this thin by the thin-pour check`);
  }

  // trace width
  data.tracks.forEach((t, n) => {
    measure("trackMinMm", t.width, `track ${t.net || "(no net)"} #${n + 1} on ${t.layer}`);
    if (t.width < rules.trackMinMm - EPS) errors.push(`track ${t.net || "(no net)"} #${n + 1} on ${t.layer} is ${mm(t.width)} wide, the minimum is ${mm(rules.trackMinMm)}`);
  });
  if (copper.some((c) => c.id.endsWith(" spoke"))) measure("trackMinMm", rules.spokeMm, "the thermal spokes");

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
    if (d < Infinity) measure("edgeMm", d, `${c.id} on ${c.layer} near ${at(centre(c.box))}`);
    if (d < rules.edgeMm - EPS && !edgeSeen.has(c.id)) {
      edgeSeen.add(c.id);
      errors.push(`edge: ${c.id} on ${c.layer} is ${mm(d)} from the board edge near ${at(centre(c.box))}, the rule is ${mm(rules.edgeMm)}`);
    }
  }

  // copper to non-plated holes (the pour is cut back to each hole's keepout)
  for (const h of data.holes) {
    const keep = h.keepout; // never under the hole's edge plus the clearance rule: pcb.hole() sees to that
    const ring: Shape = holeShape(h.x, h.y, 2 * keep), edge = holeShape(h.x, h.y, h.drill);
    const rb = bbox(ring), near = grow(bbox(edge), NEAR);
    for (const p of data.pours) measure("holeClearMm", keep - h.drill / 2, `the ${p.net} pour on ${p.layer} round the ${h.drill} mm hole at ${at([h.x, h.y])}`);
    for (const c of copper) if (boxesTouch(c.box, near)) measure("holeClearMm", gap(c.shape, edge), `${c.id} on ${c.layer} and the ${h.drill} mm hole at ${at([h.x, h.y])}`);
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
  // A via and a part's plated hole are held to different rules: a fab such as Aisler makes vias only up to 0.45 mm, and
  // asks a larger ring of a component hole.
  const holes: { x: number; y: number; d: number; via: boolean; name: string; ref: string }[] = [];
  for (const v of data.vias) {
    const where = `via ${at([v.x, v.y])}`, ring = (v.dia - v.drill) / 2;
    holes.push({ x: v.x, y: v.y, d: v.drill, via: true, name: "via", ref: "via" });
    measure("drillMinMm", v.drill, where);
    measure("viaDrillMaxMm", v.drill, where);
    measure("viaRingMm", ring, where);
    if (v.drill < rules.drillMinMm - EPS) errors.push(`${where}: drill ${mm(v.drill)} is under the ${mm(rules.drillMinMm)} minimum`);
    if (v.drill > rules.viaDrillMaxMm + EPS) errors.push(`${where}: drill ${mm(v.drill)} is over the ${mm(rules.viaDrillMaxMm)} a via may have; a larger plated hole is a component hole`);
    if (ring < rules.viaRingMm - EPS) errors.push(`${where}: annular ring ${mm(ring)} is under the ${mm(rules.viaRingMm)} minimum for a via`);
  }
  for (const p of data.pads.filter((p) => p.drill)) {
    const ring = Math.min(p.w, p.h) / 2 - p.drill! / 2;
    holes.push({ x: p.x, y: p.y, d: p.drill!, via: false, name: padId(p), ref: p.ref });
    measure("pthDrillMinMm", p.drill!, padId(p));
    measure("pthRingMm", ring, padId(p));
    if (p.drill! < rules.pthDrillMinMm - EPS) errors.push(`${padId(p)}: plated hole ${mm(p.drill!)} is under the ${mm(rules.pthDrillMinMm)} minimum for a component hole`);
    if (ring < rules.pthRingMm - EPS) errors.push(`${padId(p)}: annular ring ${mm(ring)} is under the ${mm(rules.pthRingMm)} minimum for a component hole`);
  }
  for (const h of data.holes) {
    holes.push({ x: h.x, y: h.y, d: h.drill, via: false, name: `${h.drill} mm hole`, ref: h.ref });
    measure("npthMinMm", h.drill, `the hole at ${at([h.x, h.y])}${h.ref ? ` (${h.ref})` : ""}`);
    if (h.drill < rules.npthMinMm - EPS) errors.push(`hole ${at([h.x, h.y])}: ${mm(h.drill)} is under the ${mm(rules.npthMinMm)} minimum for a non-plated hole`);
  }
  const holeAt = (h: (typeof holes)[number]) => `${h.via ? "the via" : h.ref && h.name !== `${h.d} mm hole` ? `${h.name}'s hole` : `the ${h.name}`} at ${at([h.x, h.y])}`;
  // Every drill against every other by position in the list, not by coordinates: two drills at one spot are a gap of
  // minus their size, and reported like any other pair that is too close.
  const close = new Map<string, { gap: number; d: [number, number]; refs: Set<string> }>();
  for (let a = 0; a < holes.length; a++)
    for (let b = a + 1; b < holes.length; b++) {
      const A = holes[a], B = holes[b];
      const d = Math.hypot(A.x - B.x, A.y - B.y) - (A.d + B.d) / 2;
      measure(A.via && B.via ? "viaGapMm" : "holeGapMm", d, `${holeAt(A)} and ${holeAt(B)}`);
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
        if (d > 0) measure("maskWebMm", d, `${padId(pads[a])} and ${padId(pads[b])} on ${side}`);
        if (d > 0 && d < rules.maskWebMm - EPS)
          errors.push(`mask: ${padId(pads[a])} and ${padId(pads[b])} openings are ${mm(d)} apart on ${side}, the mask web needs ${mm(rules.maskWebMm)}`);
      }
  }

  // silkscreen, after the clip: it keeps the rule's gap from every mask opening and hole
  const topPads = data.pads.filter((p) => p.layers.includes("F.Cu"));
  const openings: { id: string; s: Shape; box: Box }[] = [
    ...topPads.map((p) => ({ id: padId(p), s: padShape(p, rules.maskExpandMm) })),
    ...data.holes.map((h) => ({ id: `${h.drill} mm hole at ${at([h.x, h.y])}`, s: holeShape(h.x, h.y, h.drill + 2 * rules.maskExpandMm) })),
  ].map((o) => ({ ...o, box: grow(bbox(o.s), rules.silkPadGapMm) }));
  const padCu = topPads.map((p) => ({ id: padId(p), s: padShape(p), box: grow(bbox(padShape(p)), NEAR) }));
  for (const t of data.texts) measure("silkTextMm", t.height, `"${t.s}" at ${at([t.x, t.y])}`);
  for (const d of fab.silk.dots) measure("silkLineMm", d.d, `the silkscreen dot at ${at([d.x, d.y])}`);
  let silkBad = 0;
  for (const st of fab.silk.strokes) {
    measure("silkLineMm", st.width, `the silkscreen line at ${at(st.pts[0])}`);
    if (st.width < rules.silkLineMm - EPS) errors.push(`silkscreen line ${at(st.pts[0])} is ${mm(st.width)} wide, the minimum is ${mm(rules.silkLineMm)}`);
    for (let i = 0; i < Math.max(1, st.pts.length - 1); i++) {
      const s: Shape = { kind: "capsule", a: st.pts[i], b: st.pts[Math.min(i + 1, st.pts.length - 1)], r: st.width / 2 };
      const sb = bbox(s);
      for (const c of padCu) if (boxesTouch(sb, c.box)) measure("silkPadMm", gap(s, c.s), `the silkscreen at ${at(st.pts[i])} and ${c.id}`);
      const o = openings.find((o) => boxesTouch(sb, o.box) && gap(s, o.s) < rules.silkPadGapMm - SILK_EPS);
      if (o && silkBad++ < 5) {
        const d = gap(s, o.s);
        errors.push(d > 0 ? `silkscreen at ${at(st.pts[i])} is ${mm(d)} from ${o.id}'s opening, the rule is ${mm(rules.silkPadGapMm)}` : `silkscreen at ${at(st.pts[i])} is over ${o.id}'s opening`);
      }
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
  errors.push(...starved(data, rules, rasters));

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
  const netNames = [...new Set(data.pads.filter((p) => p.net).map((p) => p.net))].sort();
  for (const name of netNames) {
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
    errors, warnings, nets, measured, fabs: fabFits(measured),
    stats: {
      boardMm: `${data.width} x ${data.height}`, parts: data.parts.length, pads: data.pads.length, tracks: data.tracks.length,
      trackMm: Math.round(trackMm * 10) / 10, vias: data.vias.length, platedHoles: fab.pth.length, nonPlatedHoles: fab.npth.length,
      silkStrokes: fab.silk.strokes.length, pieces: all.size, rasterMmPerPixel: RASTER_MM,
    },
  };
}
