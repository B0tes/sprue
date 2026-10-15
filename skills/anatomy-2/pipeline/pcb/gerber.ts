// The Gerber X2 (RS-274X) and Excellon writers, and the zip a fab takes. Gerber coordinates are the board's own
// (origin at the centre, y up, bottom layers not mirrored) in 4.6 format, so a millimetre is 1000000 units.

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { Aperture, Drill, GerberLayer, Item, Pt } from "./types.ts";

const unit = (v: number) => String(Math.round(v * 1e6));
const xy = (x: number, y: number) => `X${unit(x)}Y${unit(y)}`;
const six = (v: number) => v.toFixed(6);

const apertureText = (a: Aperture) =>
  a.kind === "C" ? `C,${six(a.d)}` : `${a.kind},${six(a.w)}X${six(a.h)}`;

/** A project GUID that is the same on every run: X2 wants one in %TF.ProjectId. */
function guid(slug: string): string {
  const h = createHash("sha1").update(`anatomy-2/${slug}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** One layer as a Gerber X2 file. Apertures are defined before they are used; polarity changes only when it must.
 * A D02 move is written before a draw unless the previous operation was a draw that ended at its start. A flash or a
 * region moves the pen too, and readers differ on where it is left afterwards, so a draw after either always moves first. */
export function gerber(slug: string, layer: GerberLayer): string {
  const aps = new Map<string, { code: number; ap: Aperture }>();
  const code = (ap: Aperture) => {
    const key = apertureText(ap);
    if (!aps.has(key)) aps.set(key, { code: 10 + aps.size, ap });
    return aps.get(key)!.code;
  };
  // Aperture codes are handed out in drawing order, so the definitions come from a first pass.
  const body: string[] = [];
  let current = -1, pol: "D" | "C" = "D", at = "";
  const select = (ap: Aperture) => {
    const c = code(ap);
    if (c !== current) {
      body.push(`D${c}*`);
      current = c;
    }
  };
  const setPol = (p: "D" | "C") => {
    if (p !== pol) {
      body.push(`%LP${p}*%`);
      pol = p;
    }
  };
  for (const it of layer.items as Item[]) {
    setPol(it.pol);
    if (it.op === "flash") {
      select(it.ap);
      at = "";
      body.push(`${xy(it.x, it.y)}D03*`);
    } else if (it.op === "draw") {
      select({ kind: "C", d: it.d });
      if (at !== xy(...it.a)) body.push(`${xy(...it.a)}D02*`);
      at = xy(...it.b);
      body.push(`${at}D01*`);
    } else {
      body.push("G36*", `${xy(...it.pts[0])}D02*`);
      for (const p of it.pts.slice(1)) body.push(`${xy(...p)}D01*`);
      at = "";
      body.push(`${xy(...it.pts[0])}D01*`, "G37*");
    }
  }
  setPol("D");
  return [
    "G04 Written by Anatomy 2.0 (anatomy pcb)*",
    "%TF.GenerationSoftware,Anatomy 2.0,pcb,0.1*%",
    `%TF.ProjectId,${slug},${guid(slug)},1*%`,
    "%TF.SameCoordinates,Original*%",
    `%TF.FileFunction,${layer.fn}*%`,
    `%TF.FilePolarity,${layer.polarity}*%`,
    "%FSLAX46Y46*%",
    "G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*",
    "%MOMM*%",
    ...[...aps.values()].map(({ code: c, ap }) => `%ADD${c}${apertureText(ap)}*%`),
    "%LPD*%",
    "G01*",
    ...body,
    "M02*",
    "",
  ].join("\n");
}

/** Reads a layer file this writer wrote back into items, as a Gerber reader does: a draw starts where the last
 * operation left the pen, whatever the layer list said. */
export function readBack(text: string): Item[] {
  const aps = new Map<number, Aperture>();
  const items: Item[] = [];
  const num = (v: string) => Number(v) / 1e6;
  let pol: "D" | "C" = "D", sel = -1, pen: Pt = [0, 0], region: Pt[] | null = null;
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^%ADD(\d+)(C|R|O),([\d.]+)(?:X([\d.]+))?\*%$/.exec(line)))
      aps.set(Number(m[1]), m[2] === "C" ? { kind: "C", d: Number(m[3]) } : { kind: m[2] as "R" | "O", w: Number(m[3]), h: Number(m[4]) });
    else if ((m = /^%LP([DC])\*%$/.exec(line))) pol = m[1] as "D" | "C";
    else if ((m = /^D(\d+)\*$/.exec(line))) sel = Number(m[1]);
    else if (line === "G36*") region = [];
    else if (line === "G37*" && region) {
      items.push({ op: "region", pts: region.slice(0, -1), pol });
      region = null;
    } else if ((m = /^X(-?\d+)Y(-?\d+)D0([123])\*$/.exec(line))) {
      const to: Pt = [num(m[1]), num(m[2])], ap = aps.get(sel);
      if (m[3] === "3" && ap) items.push({ op: "flash", ap, x: to[0], y: to[1], pol });
      else if (m[3] === "1" && region) region.push(to);
      else if (m[3] === "1" && ap?.kind === "C") items.push({ op: "draw", d: ap.d, a: pen, b: to, pol });
      else if (m[3] === "2" && region) region = [to];
      pen = to;
    }
  }
  return items;
}

/** The first difference between a layer's list and what its file says when read back, or undefined when the file
 * prints exactly the list (so the audit, which paints the list, has checked what a fab will see). */
export function checkGerber(layer: GerberLayer, text: string): string | undefined {
  const got = readBack(text), want = layer.items as Item[];
  const u = (v: number) => Math.round(v * 1e6);
  const at = (p: Pt) => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`;
  const same = (a: Pt, b: Pt) => u(a[0]) === u(b[0]) && u(a[1]) === u(b[1]);
  if (got.length !== want.length) return `${want.length} items in the list but ${got.length} read back`;
  for (let i = 0; i < want.length; i++) {
    const a = want[i], b = got[i];
    const here = `item ${i + 1} (${a.op})`;
    if (a.op !== b.op || a.pol !== b.pol) return `${here} reads back as a ${b.op} with polarity ${b.pol}`;
    if (a.op === "flash" && b.op === "flash" && (!same([a.x, a.y], [b.x, b.y]) || apertureText(a.ap) !== apertureText(b.ap)))
      return `${here} at ${at([a.x, a.y])} reads back at ${at([b.x, b.y])} or with another aperture`;
    if (a.op === "draw" && b.op === "draw" && (!same(a.a, b.a) || !same(a.b, b.b) || u(a.d) !== u(b.d)))
      return `${here} from ${at(a.a)} to ${at(a.b)} reads back from ${at(b.a)} to ${at(b.b)}`;
    if (a.op === "region" && b.op === "region" && (a.pts.length !== b.pts.length || a.pts.some((p, k) => !same(p, b.pts[k]))))
      return `${here} near ${at(a.pts[0])} reads back as another outline`;
  }
  return undefined;
}

/** One Excellon drill file, metric, with a tool table: plated (vias and plated pads) or non-plated. */
export function excellon(slug: string, plated: boolean, drills: Drill[]): string {
  const sizes = [...new Set(drills.map((d) => d.d))].sort((a, b) => a - b);
  const sorted = [...drills].sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  // Always with a decimal point, so no reader has to guess the number format.
  const num = (v: number) => (Math.round(v * 1e3) / 1e3 + 0).toFixed(3);
  return [
    "M48",
    `; DRILL file for ${slug}, written by Anatomy 2.0 (anatomy pcb)`,
    "; FORMAT={-:-/ absolute / metric / decimal}",
    "FMAT,2",
    "METRIC",
    plated ? "; #@! TF.FileFunction,Plated,1,2,PTH" : "; #@! TF.FileFunction,NonPlated,1,2,NPTH",
    "; #@! TF.FilePolarity,Positive",
    "; #@! TF.SameCoordinates,Original",
    ...sizes.map((d, i) => `T${i + 1}C${d.toFixed(3)}`),
    "%",
    "G90",
    "G05",
    ...sizes.flatMap((d, i) => [`T${i + 1}`, ...sorted.filter((h) => h.d === d).map((h) => `X${num(h.x)}Y${num(h.y)}`)]),
    "T0",
    "M30",
    "",
  ].join("\n");
}

// ---- zip ----

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of the files, deflated, with the 1980-01-01 timestamp so the same board gives the same bytes. */
export function zip(files: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = Buffer.from(f.data), packed = deflateRawSync(raw, { level: 9 }), crc = crc32(raw);
    const head = (size: number, signature: number, central: boolean) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(signature, 0);
      let o = 4;
      if (central) o = b.writeUInt16LE((3 << 8) | 20, o); // made by: Unix, spec 2.0
      o = b.writeUInt16LE(20, o); // version needed
      o = b.writeUInt16LE(0x0800, o); // UTF-8 names
      o = b.writeUInt16LE(8, o); // deflate
      o = b.writeUInt16LE(0, o); // time
      o = b.writeUInt16LE((0 << 9) | (1 << 5) | 1, o); // 1980-01-01
      o = b.writeUInt32LE(crc, o);
      o = b.writeUInt32LE(packed.length, o);
      o = b.writeUInt32LE(raw.length, o);
      o = b.writeUInt16LE(name.length, o);
      b.writeUInt16LE(0, o); // extra field length
      return b;
    };
    const local = head(30, 0x04034b50, false);
    const central = head(46, 0x02014b50, true);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: a regular file
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
