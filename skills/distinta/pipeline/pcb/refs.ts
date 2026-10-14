// The footprints' reference numbers. fixtures/footprint-refs.json copies them from each source (KiCad's library,
// Raspberry Pi's own footprint, Kailh's datasheet, two hot-swap libraries) as the source gives them, in its own frame;
// here they are turned into the footprint frame (x right, y up, seen from the top, origin at the part's centre).
// drift() lists where a footprint differs from its reference by more than REF_TOL_MM. footprints.test.ts runs it on
// the library and the intent check (intent.ts) on every placed part, so a footprint that drifts, or is mirrored,
// cannot reach the Gerbers.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pt } from "./types.ts";

export const REFS_FILE = join(import.meta.dirname, "fixtures", "footprint-refs.json");
/** How far a footprint's number may be from its reference's. */
export const REF_TOL_MM = 0.01;

/** A source's frame to the footprint frame: x = x[0] sx + x[1] sy + x[2], and y likewise. */
type ToKit = { x: [number, number, number]; y: [number, number, number] };
type RawPad = { num: string; name?: string; at: Pt; size?: Pt; plated?: boolean; src: string };
type RawHole = { at: Pt; drill: number; src: string; drillSrc?: string };
type RawFootprint = { title: string; aliases?: Record<string, string>; pads: RawPad[]; holes: RawHole[]; body?: { from: Pt; to: Pt; src: string } };
type Raw = { sources: Record<string, { toKit?: ToKit }>; footprints: Record<string, RawFootprint> };

/** A reference pad (or, `plated`, a pin's through hole), named as the kit names it. A size is given where the source
 * gives one. */
export type RefPad = { num: string; name?: string; x: number; y: number; w?: number; h?: number; plated: boolean; src: string };
export type RefHole = { x: number; y: number; drill: number; src: string };
export type Ref = { title: string; pads: RefPad[]; holes: RefHole[]; body?: { x0: number; y0: number; x1: number; y1: number } };

/** What drift() compares: a footprint's pads and non-plated holes in its own frame. */
export type LocalPad = { num: string; name?: string; x: number; y: number; w: number; h: number; plated: boolean };
export type LocalHole = { x: number; y: number; drill: number };

const toKit = (m: ToKit, [x, y]: Pt): Pt => [m.x[0] * x + m.x[1] * y + m.x[2], m.y[0] * x + m.y[1] * y + m.y[2]];
/** A size turns with its frame: only the axes swap. */
const sizeToKit = (m: ToKit, [w, h]: Pt): Pt => [Math.abs(m.x[0]) * w + Math.abs(m.x[1]) * h, Math.abs(m.y[0]) * w + Math.abs(m.y[1]) * h];

function load(): Record<string, Ref> {
  const raw = JSON.parse(readFileSync(REFS_FILE, "utf8")) as Raw;
  const frame = (src: string) => {
    const m = raw.sources[src]?.toKit;
    if (!m) throw new Error(`fixtures/footprint-refs.json: source "${src}" gives no frame (toKit)`);
    return m;
  };
  const refs: Record<string, Ref> = {};
  for (const [name, f] of Object.entries(raw.footprints)) {
    const kitName = new Map(Object.entries(f.aliases ?? {}).map(([kit, src]) => [src, kit]));
    const pads = f.pads.map((p): RefPad => {
      const m = frame(p.src);
      const [x, y] = toKit(m, p.at);
      const size = p.size && sizeToKit(m, p.size);
      return { num: p.num, name: p.name && (kitName.get(p.name) ?? p.name), x, y, w: size?.[0], h: size?.[1], plated: !!p.plated, src: p.src };
    });
    const holes = f.holes.map((h): RefHole => {
      const [x, y] = toKit(frame(h.src), h.at);
      return { x, y, drill: h.drill, src: h.drillSrc ?? h.src };
    });
    let body: Ref["body"];
    if (f.body) {
      const [a, b] = [toKit(frame(f.body.src), f.body.from), toKit(frame(f.body.src), f.body.to)];
      body = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    }
    refs[name] = { title: f.title, pads, holes, body };
  }
  return refs;
}

/** The references, by footprint name. */
export const REFS: Record<string, Ref> = load();

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= REF_TOL_MM && Math.abs(a.y - b.y) <= REF_TOL_MM;
const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const at = (x: number, y: number) => `(${r3(x)}, ${r3(y)})`;
const pinText = (p: RefPad) => `pin ${p.num}${p.name ? ` (${p.name})` : ""}`;

/** The reference pad (or plated pin) at x, y in the footprint frame, if there is one. */
export const refAt = (ref: Ref, x: number, y: number, plated: boolean): RefPad | undefined =>
  ref.pads.find((q) => q.plated === plated && near(q, { x, y }));

/** Where a footprint's pads and holes differ from its reference by more than REF_TOL_MM, one sentence each. A
 * reference pad is required when the footprint has pads of its kind (SMD or plated); every hole is required. */
export function drift(ref: Ref, pads: LocalPad[], holes: LocalHole[]): string[] {
  const out: string[] = [];
  for (const p of pads) {
    const r = ref.pads.find((q) => q.num === p.num && q.plated === p.plated);
    const label = `${p.plated ? "plated pin" : "pad"} ${p.num}${p.name ? ` (${p.name})` : ""}`;
    if (!r) {
      out.push(`${label} is not in the reference`);
      continue;
    }
    if (!near(p, r)) {
      const there = refAt(ref, p.x, p.y, p.plated);
      out.push(`${label} is at ${at(p.x, p.y)}, the reference has it at ${at(r.x, r.y)}${there ? `, where its ${pinText(there)} is` : ""} [${r.src}]`);
    }
    if (r.w !== undefined && r.h !== undefined && (Math.abs(p.w - r.w) > REF_TOL_MM || Math.abs(p.h - r.h) > REF_TOL_MM))
      out.push(`${label} is ${r3(p.w)} x ${r3(p.h)}, the reference's is ${r3(r.w)} x ${r3(r.h)} [${r.src}]`);
    if (r.name !== undefined && p.name !== r.name) out.push(`${label} is named ${p.name ?? "nothing"}, the reference names it ${r.name}`);
  }
  for (const r of ref.pads)
    if (pads.some((p) => p.plated === r.plated) && !pads.some((p) => p.num === r.num && p.plated === r.plated))
      out.push(`the reference's ${r.plated ? "plated " : ""}${pinText(r)} is missing [${r.src}]`);
  for (const r of ref.holes) {
    const h = holes.find((h) => near(h, r));
    if (!h) out.push(`no hole at ${at(r.x, r.y)}, where the reference has a ${r.drill} mm one [${r.src}]`);
    else if (Math.abs(h.drill - r.drill) > REF_TOL_MM) out.push(`the hole at ${at(r.x, r.y)} is ${h.drill} mm, the reference's is ${r.drill} mm [${r.src}]`);
  }
  for (const h of holes) if (!ref.holes.some((r) => near(h, r))) out.push(`the ${h.drill} mm hole at ${at(h.x, h.y)} is not in the reference`);
  return out;
}
