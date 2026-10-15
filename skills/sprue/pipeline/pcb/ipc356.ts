// The bare-board netlist as IPC-D-356A, the file a fab's electrical test (a flying probe) reads to know which pads
// should be joined and which must not be. Without it a fab can only test the board against its own reading of the
// Gerbers. One record per pad, via and non-plated hole, in fixed columns:
//   317  a plated through hole: a via (ref "VIA", a mid-net point) or a part's plated pad
//   327  an SMD pad, on the top (access 01) or the bottom (02)
//   367  a non-plated hole
// A pad on no net is written as "N/C", each one a net of its own: the test then checks that it is joined to nothing
// (a Pico's VBUS, VSYS, 3V3). Units are inches (UNITS CUST 0, in 0.0001 in), as KiCad and PCBWay's plugin write
// them; coordinates are the Gerbers' (origin at the board centre, y up, seen from the top). A net name over 14
// characters gets an NNAME alias. readD356 reads a file back, and checkD356 says whether it holds exactly the board.

import type { BoardData } from "./types.ts";

export type D356Record = {
  code: 317 | 327 | 367;
  /** The net, or "N/C" for a pad on none. */
  net: string;
  ref: string;
  pin: string;
  /** A point in the middle of a net, not at a part's pin: a via. */
  mid: boolean;
  /** The hole, when there is one: its diameter (mm) and whether it is plated. */
  drill?: number;
  plated?: boolean;
  /** 0 from both sides (a hole), 1 the top, 2 the bottom. */
  access: number;
  x: number;
  y: number;
  /** The feature's size (mm). A round one has `h` 0, as IPC-D-356 asks. */
  w: number;
  h: number;
  rot: number;
  /** Which sides the solder mask covers: 0 neither, 1 the top, 2 the bottom, 3 both (a tented via). */
  mask: number;
};

/** Millimetres in one unit of CUST 0 (0.0001 in) and of CUST 1 (0.001 mm). */
const UNIT = { 0: 0.00254, 1: 0.001 } as Record<number, number>;
/** Half a unit, and a little: how far a number may read back from what was meant. */
const TOL = UNIT[0] / 2 + 1e-6;

/** The board's records, in mm: its pads, then its vias, then its non-plated holes. */
export function records(data: BoardData): D356Record[] {
  const out: D356Record[] = [];
  for (const p of data.pads) {
    const through = !!p.drill && p.layers.length === 2, round = p.shape === "circle";
    const top = p.layers[0] === "F.Cu";
    out.push({
      code: through ? 317 : 327, net: p.net || "N/C", ref: p.ref, pin: p.num, mid: false,
      ...(through ? { drill: p.drill, plated: true } : {}),
      access: through ? 0 : top ? 1 : 2, x: p.x, y: p.y, w: p.w, h: round ? 0 : p.h, rot: 0,
      // A pad is open in the mask of its own side, so the mask covers only the other (both are open for a hole).
      mask: through ? 0 : top ? 2 : 1,
    });
  }
  for (const v of data.vias)
    out.push({ code: 317, net: v.net || "N/C", ref: "VIA", pin: "", mid: true, drill: v.drill, plated: true, access: 0, x: v.x, y: v.y, w: v.dia, h: 0, rot: 0, mask: 3 });
  for (const h of data.holes)
    out.push({ code: 367, net: "N/C", ref: h.ref, pin: "", mid: false, drill: h.drill, plated: false, access: 0, x: h.x, y: h.y, w: h.drill, h: 0, rot: 0, mask: 0 });
  return out;
}

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
/** A length in 0.0001 in, `digits` wide, with a sign when asked. */
const len = (mm: number, digits: number, sign = false) => {
  const v = Math.round(mm / UNIT[0]), s = String(Math.min(Math.abs(v), 10 ** digits - 1)).padStart(digits, "0");
  return sign ? (v < 0 ? "-" : "+") + s : s;
};
const fits = (net: string) => net.length <= 14 && !/\s/.test(net);

/** One record as its 74 columns. */
function line(r: D356Record, alias: Map<string, string>): string {
  const hole = r.drill !== undefined ? `D${len(r.drill, 4)}${r.plated ? "P" : "U"}` : "      ";
  return `${r.code}${pad(alias.get(r.net) ?? r.net, 14)}   ${pad(r.ref, 6)}${r.pin ? "-" : " "}${pad(r.pin, 4)}${r.mid ? "M" : " "}${hole}` +
    `A${String(r.access).padStart(2, "0")}X${len(r.x, 6, true)}Y${len(r.y, 6, true)}X${len(r.w, 4)}Y${len(r.h, 4)}R${String(r.rot).padStart(3, "0")} S${r.mask}`;
}

/** A comment as C records, each at most 80 columns, the width of every IPC-D-356A record, split between words. */
export function comment(text: string): string[] {
  const out: string[] = [];
  let at = "";
  for (const word of text.split(" ")) {
    if (at && `C  ${at} ${word}`.length > 80) {
      out.push(`C  ${at}`);
      at = word;
    } else at = at ? `${at} ${word}` : word;
  }
  return [...out, `C  ${at}`.slice(0, 80)];
}

/** The board's IPC-D-356A netlist. */
export function d356(slug: string, data: BoardData): string {
  const recs = records(data);
  const long = [...new Set(recs.map((r) => r.net))].filter((n) => !fits(n)).sort();
  const alias = new Map(long.map((n, i) => [n, `NNAME${i + 1}`]));
  return [
    ...comment(`IPC-D-356A netlist of ${slug}, written by Sprue (sprue pcb)`),
    ...comment("Coordinates as in the Gerbers: origin at the board centre, x right, y up, seen from the top, in 0.0001 inch"),
    `P  JOB   ${slug}`.slice(0, 80),
    "P  UNITS CUST 0",
    "P  VER   IPC-D-356A",
    "P  IMAGE PRIMARY",
    ...long.map((n) => `P  ${alias.get(n)} ${n}`),
    ...comment("317: a plated through hole (VIA: a via), 327: an SMD pad, 367: a non-plated hole; N/C: a pad on no net"),
    ...recs.map((r) => line(r, alias)),
    "999",
    "",
  ].join("\n");
}

/** Reads an IPC-D-356(A) netlist's test records, in mm, with NNAME aliases resolved. Throws on a record before the
 * units or on units other than CUST 0 and CUST 1. */
export function readD356(text: string): D356Record[] {
  const names = new Map<string, string>();
  const out: D356Record[] = [];
  let unit: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.padEnd(80);
    if (l.startsWith("P  ")) {
      const [key, ...rest] = l.slice(3).trim().split(/\s+/);
      if (key === "UNITS") {
        const cust = rest.join(" ");
        if (!(cust === "CUST 0" || cust === "CUST 1")) throw new Error(`IPC-D-356: units "${cust}" are not CUST 0 or CUST 1`);
        unit = UNIT[Number(cust.slice(5))];
      } else if (/^NNAME\d+$/.test(key)) names.set(key, rest.join(" "));
      continue;
    }
    if (!/^3[126]7/.test(l)) continue;
    if (unit === undefined) throw new Error("IPC-D-356: a test record comes before the units (P  UNITS)");
    const n = (a: number, b: number) => Number(l.slice(a, b)) * unit!;
    const net = l.slice(3, 17).trim();
    out.push({
      code: Number(l.slice(0, 3)) as D356Record["code"], net: names.get(net) ?? net, ref: l.slice(20, 26).trim(), pin: l.slice(27, 31).trim(),
      mid: l[31] === "M", ...(l[32] === "D" ? { drill: n(33, 37), plated: l[37] === "P" } : {}),
      access: Number(l.slice(39, 41)), x: n(42, 49), y: n(50, 57), w: n(58, 62), h: n(63, 67), rot: Number(l.slice(68, 71)), mask: Number(l[73]),
    });
  }
  return out;
}

const what = (r: D356Record) => `${r.code} ${r.ref || "(no ref)"}${r.pin ? `-${r.pin}` : ""} at (${r.x.toFixed(3)}, ${r.y.toFixed(3)})`;

/** The first difference between the board and what its netlist file says, or undefined when the file holds every pad,
 * via and hole of the board, each on its net, where it is, to the file's resolution. */
export function checkD356(data: BoardData, text: string): string | undefined {
  const want = records(data);
  let got: D356Record[];
  try {
    got = readD356(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (got.length !== want.length) return `${want.length} records on the board but ${got.length} in the file`;
  for (let i = 0; i < want.length; i++) {
    const a = want[i], b = got[i];
    for (const k of ["code", "net", "ref", "pin", "mid", "plated", "access", "rot", "mask"] as const)
      if (a[k] !== b[k]) return `record ${i + 1} (${what(a)}) reads back with ${k} ${JSON.stringify(b[k])}, not ${JSON.stringify(a[k])}`;
    for (const k of ["drill", "x", "y", "w", "h"] as const)
      if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > TOL) return `record ${i + 1} (${what(a)}) reads back with ${k} ${b[k]?.toFixed(4)} mm, not ${a[k]?.toFixed(4)} mm`;
  }
  return undefined;
}
