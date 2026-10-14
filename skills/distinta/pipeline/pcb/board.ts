// The board that pcb.mjs draws on. `createBoard` returns the API pcb.mjs is given (`pcb`) and the BoardData it
// fills in. Nothing here writes a file or judges the result: the harness (../pcb.ts) runs the DRC, then the writers.
//
//   pcb.outline(w, h, cornerR)                       the board, a rounded rectangle centred on the origin
//   pcb.hole(x, y, drill, { keepout? })              a non-plated hole; copper stays `keepout` (a radius) from its centre
//   pcb.place(footprint, { ref, x, y, rotDeg, side, nets, ...footprint options })
//   pcb.pad("K1.A")                                  a placed pad (by pad name, or by function when that is unique)
//   pcb.track(net, layer, points, width)             copper by hand
//   pcb.via(net, x, y)                               a plated through hole joining both layers, tented
//   pcb.route(net, fromPad, toPad, { via, width })   a track found by the maze router (router.ts)
//   pcb.pour(net, layer, { clearance })              the net's copper over the board, clear of everything else (one per layer;
//                                                    declare it before routing, so the router keeps clear of its spokes)
//   pcb.warn(text)                                   a warning for the audit, such as a number the notes should carry
//   pcb.single(net, ...)                             nets that have one pad on purpose (a test point); any other one-pad net is an error
//   pcb.text("F.Silk", x, y, string, height)         top silkscreen
//   pcb.keepout(layer, points, { tracks, pour })     an area copper stays out of
//   pcb.rules                                        the design rules (rules.ts), read-only: the audit holds the board to them

import { FOOTPRINTS, type FootprintOpts } from "./footprints.ts";
import { rotate, roundedRect } from "./geometry.ts";
import { route, type RouteOpts, type Routed } from "./router.ts";
import { RULES, type Rules } from "./rules.ts";
import { hasGlyph, textStrokes, type TextOpts } from "./font.ts";
import type { BoardData, Layer, Pad, Pt, Side } from "./types.ts";

export type PlaceOpts = { ref: string; x: number; y: number; rotDeg?: number; side?: Side; nets?: Record<string, string> } & FootprintOpts;

const LAYERS: Layer[] = ["F.Cu", "B.Cu"];
const layerOf = (l: string, where: string): Layer => {
  if (!LAYERS.includes(l as Layer)) throw new Error(`${where}: layer must be "F.Cu" or "B.Cu", got ${JSON.stringify(l)}`);
  return l as Layer;
};
const num = (v: unknown, where: string) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where} must be a number, got ${JSON.stringify(v)}`);
  return v;
};
const points = (pts: unknown, where: string, min: number): Pt[] => {
  if (!Array.isArray(pts) || pts.length < min || pts.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error(`${where}: points must be a list of at least ${min} [x, y] pairs`);
  return pts.map((p) => [p[0], p[1]] as Pt);
};

export function createBoard(slug: string, rules: Rules = RULES) {
  const data: BoardData = {
    slug, width: 0, height: 0, corner: 0, outline: [], parts: [], pads: [], tracks: [], vias: [], holes: [], pours: [],
    keepouts: [], singles: [], silk: { strokes: [], dots: [] }, problems: [], notes: [],
  };
  const refs = new Set<string>();

  const padByName = (id: string): Pad => {
    const dot = id.indexOf(".");
    const ref = id.slice(0, dot), name = id.slice(dot + 1);
    const ofRef = dot > 0 ? data.pads.filter((p) => p.ref === ref) : [];
    const exact = ofRef.find((p) => p.num === name);
    const named = ofRef.filter((p) => p.name === name);
    const pad = exact ?? (named.length === 1 ? named[0] : undefined);
    if (!pad)
      throw new Error(named.length > 1 ? `pad "${id}" is ambiguous (${named.length} pads are named ${name}): use the pad number`
        : `no pad "${id}"` + (ofRef.length ? ` (${ref} has ${ofRef.map((p) => p.num).join(", ")})` : ` (no part ${ref || "?"} placed)`));
    return pad;
  };

  const api = {
    rules,
    /** The board outline: a rounded rectangle `w` x `h` centred on the origin, corners of radius `r`. */
    outline(w: number, h: number, r = 0) {
      num(w, "outline width"); num(h, "outline height"); num(r, "outline corner radius");
      if (!(w > 0 && h > 0 && r >= 0 && 2 * r <= Math.min(w, h))) throw new Error(`outline(${w}, ${h}, ${r}): sizes must be positive and the corner radius at most half the shorter side`);
      Object.assign(data, { width: w, height: h, corner: r, outline: roundedRect(w, h, r) });
    },

    /** A non-plated hole of diameter `drill`. Copper and silkscreen keep `keepout` (a radius from the centre) clear
     * of it, and never less than the hole's edge plus the rules' hole clearance, which is also the default. */
    hole(x: number, y: number, drill: number, opts: { keepout?: number; ref?: string } = {}) {
      num(x, "hole x"); num(y, "hole y"); num(drill, "hole drill");
      const keepout = Math.max(opts.keepout === undefined ? 0 : num(opts.keepout, "hole keepout"), drill / 2 + rules.holeClearMm);
      data.holes.push({ ref: opts.ref ?? "", x, y, drill, keepout });
    },

    /** Puts a footprint (footprints.ts) on the board. `nets` maps pad numbers or functions to net names. */
    place(footprint: string, opts: PlaceOpts) {
      const make = FOOTPRINTS[footprint];
      if (!make) throw new Error(`no footprint "${footprint}"; the library has ${Object.keys(FOOTPRINTS).join(", ")}`);
      const { ref, x, y, rotDeg = 0, side = "top", nets = {}, ...own } = opts ?? ({} as PlaceOpts);
      if (!ref || typeof ref !== "string") throw new Error(`place("${footprint}"): ref is required`);
      if (refs.has(ref)) throw new Error(`place("${footprint}"): ref ${ref} is already on the board`);
      num(x, `${ref} x`); num(y, `${ref} y`);
      if (rotDeg % 90 !== 0) throw new Error(`${ref}: rotDeg must be a multiple of 90, got ${rotDeg}`);
      if (side !== "top" && side !== "bottom") throw new Error(`${ref}: side must be "top" or "bottom", got ${JSON.stringify(side)}`);
      const fp = make(rules, own);
      if (!fp.sides.includes(side)) throw new Error(`${ref}: ${footprint} can only be placed on the ${fp.sides.join(" or ")}`);
      refs.add(ref);
      data.parts.push({ ref, footprint, x, y, rotDeg, side });
      const at = (p: Pt): Pt => {
        const [rx, ry] = rotate(p, rotDeg);
        return [x + rx, y + ry];
      };
      const copper: Layer = side === "top" ? "F.Cu" : "B.Cu";
      const quarter = rotDeg % 180 !== 0;
      const first = data.pads.length;
      for (const d of fp.pads) {
        const [px, py] = at([d.x, d.y]);
        data.pads.push({
          ref, num: d.num, name: d.name, kind: d.kind, mustConnect: d.mustConnect, net: "", x: px, y: py,
          w: quarter ? d.h : d.w, h: quarter ? d.w : d.h, shape: d.shape, layers: d.on === "both" ? [...LAYERS] : [copper], drill: d.drill,
          spokes: d.spokes?.map((s) => rotate(s, rotDeg)),
        });
      }
      for (const [key, net] of Object.entries(nets)) {
        const hit = data.pads.slice(first).filter((p) => p.num === key || p.name === key);
        if (!hit.length) data.problems.push(`${ref}: nets names pad "${key}", which ${footprint} does not have`);
        for (const p of hit) p.net = String(net);
      }
      for (const h of fp.holes) {
        const [hx, hy] = at([h.x, h.y]);
        api.hole(hx, hy, h.drill, { ref });
      }
      for (const k of fp.keepouts) data.keepouts.push({ layer: copper, pts: k.pts.map(at), tracks: k.tracks, pour: k.pour, ref });
      for (const s of fp.silk.strokes) data.silk.strokes.push({ width: s.width, pts: s.pts.map(at) });
      for (const d of fp.silk.dots) {
        const [dx, dy] = at([d.x, d.y]);
        data.silk.dots.push({ x: dx, y: dy, d: d.d });
      }
    },

    /** A pad placed earlier: `pcb.pad("K1.A")`. Returns a copy. */
    pad(id: string): Pad {
      return { ...padByName(id) };
    },

    /** Copper drawn by hand: a polyline of `width` (default the signal trace) on `layer`. */
    track(net: string, layer: Layer, pts: Pt[], width = rules.trackMm) {
      data.tracks.push({ net, layer: layerOf(layer, "track"), pts: points(pts, "track", 2), width: num(width, "track width") });
    },

    /** A via: a plated hole joining both layers. Its size defaults to the rules'. */
    via(net: string, x: number, y: number, opts: { drill?: number; dia?: number } = {}) {
      data.vias.push({ net, x: num(x, "via x"), y: num(y, "via y"), drill: opts.drill ?? rules.viaDrillMm, dia: opts.dia ?? rules.viaPadMm });
    },

    /** Finds a track between two pads that keeps the rules' clearance to everything already on the board, and adds
     * it. It stays on the pads' layer unless `opts.via` allows a via. Throws when there is no way. */
    route(net: string, from: string, to: string, opts: RouteOpts = {}): Routed {
      const result = route(data, rules, net, padByName(from), padByName(to), { width: rules.trackMm, ...opts });
      for (const t of result.tracks) data.tracks.push(t);
      for (const v of result.vias) data.vias.push(v);
      return result;
    },

    /** The net's copper over the whole layer, inset from the edge, clear of other nets and of keepouts. Pads and vias
     * of the net join it (a pad with spokes through a thermal relief). */
    pour(net: string, layer: Layer, opts: { clearance?: number } = {}) {
      const l = layerOf(layer, "pour"), clearance = opts.clearance === undefined ? rules.pourClearanceMm : num(opts.clearance, "pour clearance");
      if (!net) data.problems.push(`pour on ${l} has no net`);
      if (data.pours.some((p) => p.layer === l)) data.problems.push(`a second pour on ${l} (${net}): a layer has one pour, and only the first would be drawn`);
      if (clearance < rules.clearanceMm) data.problems.push(`the pour on ${l} clears other copper by ${clearance} mm, under the ${rules.clearanceMm} mm clearance rule`);
      data.pours.push({ net, layer: l, clearance });
    },

    /** A warning of the board code's own, listed with the audit's (drc.json, the CLI). */
    warn(text: string) {
      data.notes.push(String(text));
    },

    /** Nets that have a single pad on purpose, a test point or a pin brought out. A one-pad net that is not named
     * here is an error, because it is usually a typo in a net name and the pad floats. */
    single(...nets: string[]) {
      data.singles.push(...nets.map(String));
    },

    /** Top silkscreen text, `height` tall (capitals), centred on x, y. */
    text(layer: string, x: number, y: number, s: string, height: number, opts: TextOpts = {}) {
      if (layer !== "F.Silk") throw new Error(`text: only the top silkscreen ("F.Silk") is written, got ${JSON.stringify(layer)}`);
      num(x, "text x"); num(y, "text y"); num(height, "text height");
      if (height < rules.silkTextMm) data.problems.push(`text "${s}" is ${height} mm tall; silkscreen text must be at least ${rules.silkTextMm} mm`);
      const bad = [...String(s)].filter((c) => !hasGlyph(c));
      if (bad.length) data.problems.push(`text "${s}": no glyph for ${[...new Set(bad)].join(" ")}`);
      data.silk.strokes.push(...textStrokes(x, y, String(s), height, rules.silkLineMm, opts));
    },

    /** An area copper stays out of: `tracks` (no track, via or pad of another part) and/or `pour`. */
    keepout(layer: Layer, pts: Pt[], opts: { tracks?: boolean; pour?: boolean } = {}) {
      data.keepouts.push({ layer: layerOf(layer, "keepout"), pts: points(pts, "keepout", 3), tracks: opts.tracks ?? true, pour: opts.pour ?? true, ref: "" });
    },
  };

  return { api, data };
}
