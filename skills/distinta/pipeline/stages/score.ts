// Scores a pipeline run against the reference product's answer key (docs/pipeline.md).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inputsHash, type Reads } from "../pcb/fresh.ts";
import type { Bom, Checks, Quotes, Reference, Score } from "../types.ts";

/** Binary STL is a closed surface if every edge is shared by exactly two triangles. */
export function stlIsWatertight(path: string): boolean {
  const buf = readFileSync(path);
  const tris = buf.readUInt32LE(80);
  if (buf.length !== 84 + tris * 50) return false; // not a binary STL
  const key = (o: number) =>
    [0, 4, 8].map((d) => Math.round(buf.readFloatLE(o + d) * 1e3)).join(",");
  const edges = new Map<string, number>();
  for (let t = 0; t < tris; t++) {
    const base = 84 + t * 50 + 12;
    const v = [key(base), key(base + 12), key(base + 24)];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((n) => n === 2);
}

/** The board's own audit (pcb/drc.json, written with the zip) is ok if it found no errors, every net is joined, and it
 * is of the board as it is now (the board code, the params, what it read of design.json and bom.json, the PCB kit and
 * the read-back have not changed since). */
export function drcAudit(dir: string): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return { ok: false, detail: "no pcb/drc.json: run distinta pcb" };
  try {
    const drc = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; reads?: Reads; errors?: string[]; nets?: Record<string, { connected?: boolean }> };
    const errors = drc.errors ?? ["pcb/drc.json lists no errors field"];
    const open = Object.entries(drc.nets ?? {}).filter(([, n]) => !n.connected).map(([name]) => name);
    if (errors.length) return { ok: false, detail: `our DRC found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (open.length) return { ok: false, detail: `net${open.length === 1 ? "" : "s"} not connected: ${open.join(", ")}` };
    if (drc.inputs !== inputsHash(dir, drc.reads)) return { ok: false, detail: "pcb/drc.json is of an earlier board (the board code, what it reads of design.json or bom.json, or the PCB kit changed): run distinta pcb" };
    return { ok: true, detail: "our DRC, at least as strict as JLCPCB's, PCBWay's, OSH Park's and Aisler's 2-layer limits: 0 errors, every net connected" };
  } catch {
    return { ok: false, detail: "pcb/drc.json is not readable: run distinta pcb" };
  }
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The read-back (pcb/readback.json, written by pipeline/pcb/readback.py) is ok if it passed, read the zip and the
 * netlist that are in pcb/ now (by their sha256), and carries the audit's fingerprint. `zip` is the zip a BOM line
 * names, when there is one, which must be the one read back. */
export function readbackAudit(dir: string, zip?: string): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "readback.json");
  const again = "run distinta verify";
  if (!existsSync(path)) return { ok: false, detail: `no pcb/readback.json, so nothing but our own code has read the files: ${again} (it needs gerbonara and shapely)` };
  try {
    const rb = JSON.parse(readFileSync(path, "utf8")) as {
      inputs?: string; ok?: boolean; errors?: string[]; selfTest?: { ok?: boolean };
      files?: { zip?: { name?: string; sha256?: string }; netlist?: { name?: string; sha256?: string } };
    };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const errors = rb.errors ?? ["pcb/readback.json lists no errors field"];
    if (errors.length) return { ok: false, detail: `the read-back found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (rb.selfTest && !rb.selfTest.ok) return { ok: false, detail: `the read-back's self-test failed, so its pass proves nothing: see pcb/readback.json` };
    if (!rb.ok) return { ok: false, detail: "pcb/readback.json does not say it passed" };
    if (rb.inputs !== drc.inputs) return { ok: false, detail: `pcb/readback.json is of an earlier board than pcb/drc.json: ${again}` };
    for (const f of [rb.files?.zip, rb.files?.netlist]) {
      const file = f?.name ? join(dir, "pcb", f.name) : "";
      if (!file || !existsSync(file) || sha256(file) !== f!.sha256) return { ok: false, detail: `pcb/${f?.name ?? "?"} is not the file the read-back read: ${again}` };
    }
    if (zip && basename(zip) !== rb.files!.zip!.name) return { ok: false, detail: `the read-back read ${rb.files!.zip!.name}, not ${zip}: ${again}` };
    return { ok: true, detail: "the read-back (gerbonara and shapely on the zip and the netlist) finds the nets design.json means" };
  } catch {
    return { ok: false, detail: `pcb/readback.json is not readable: ${again}` };
  }
}

/** The firmware in the loop (firmware/fil.json, written by `distinta verify`): a run on this board (its fingerprint),
 * this firmware/code.py and this read-back that failed refuses the zip, since the copper does not give the keys
 * their codes. One that passed says so; none, or one of an earlier board, refuses nothing (it needs the emulator,
 * fetched once), and the detail says to run it. */
export function firmwareAudit(dir: string): { ok: boolean; detail: string } {
  const path = join(dir, "firmware", "fil.json");
  if (!existsSync(join(dir, "firmware", "code.py"))) return { ok: true, detail: "" };
  if (!existsSync(path)) return { ok: true, detail: "the firmware has not been run on that copper yet (distinta verify runs it)" };
  try {
    const fil = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; ok?: boolean; errors?: string[]; firmware?: { sha256?: string }; netlist?: { sha256?: string } };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const rb = join(dir, "pcb", "readback.json");
    const current = fil.inputs === drc.inputs && fil.firmware?.sha256 === sha256(join(dir, "firmware", "code.py")) && existsSync(rb) && fil.netlist?.sha256 === sha256(rb);
    if (!current) return { ok: true, detail: "firmware/fil.json is of an earlier board or firmware (distinta verify runs it again)" };
    if (!fil.ok) return { ok: false, detail: `the firmware, run on the copper read back, ${fil.errors?.length ? `found: ${fil.errors[0]}` : "failed: see firmware/fil.json"}` };
    return { ok: true, detail: "the firmware, run on that copper, types each key's code" };
  } catch {
    return { ok: false, detail: "firmware/fil.json is not readable: run distinta verify" };
  }
}

/** A Gerber package is ok if the board's own audit passed and is current, the read-back of the very files in the
 * zip passed too, and no run of the firmware on that copper failed. */
export function gerbersAudit(dir: string, zip?: string): { ok: boolean; detail: string } {
  const a = drcAudit(dir);
  if (!a.ok) return a;
  const r = readbackAudit(dir, zip);
  if (!r.ok) return r;
  const f = firmwareAudit(dir);
  if (!f.ok) return f;
  return { ok: true, detail: `Gerbers and drill files; ${a.detail}, and ${r.detail}${f.detail ? `; ${f.detail}` : ""} (not a fab's own check)` };
}

export function score(dir: string, bom: Bom, checks: Checks, quotes: Quotes, ref: Reference): Score {
  const have = new Set(bom.lines.map((l) => l.role));
  const want = ref.roles.map((r) => r.role);
  const matched = want.filter((r) => have.has(r));
  const missing = want.filter((r) => !have.has(r));
  const extra = [...have].filter((r) => !want.includes(r));

  const mid = (ref.batchUsd.low + ref.batchUsd.high) / 2;
  const deltaPct = Math.round(((quotes.batchUsd - mid) / mid) * 1000) / 10;

  const files = bom.lines
    .filter((l) => l.file)
    .map((l) => {
      const p = join(dir, l.file!);
      // A board whose build failed has no zip but does have a drc.json that says why.
      if (p.endsWith(".zip") && l.file!.startsWith("pcb/") && (existsSync(p) || existsSync(join(dir, "pcb", "drc.json")))) {
        const a = gerbersAudit(dir, l.file);
        return existsSync(p) ? { name: l.file!, ok: a.ok, detail: a.detail } : { name: l.file!, ok: false, detail: a.ok ? "not generated yet" : a.detail };
      }
      if (!existsSync(p)) return { name: l.file!, ok: false, detail: "not generated yet" };
      if (p.endsWith(".stl")) {
        const ok = stlIsWatertight(p);
        return { name: l.file!, ok, detail: ok ? "closed, printable mesh" : "mesh has holes" };
      }
      return { name: l.file!, ok: true, detail: "present" };
    });

  const coveragePct = Math.round((matched.length / want.length) * 1000) / 10;
  const withinBand = Math.abs(deltaPct) <= 25;
  return {
    slug: bom.slug,
    coverage: { matched, missing, extra, pct: coveragePct },
    checks: { failed: checks.failed, flagged: checks.flagged },
    cost: { batchUsd: quotes.batchUsd, referenceMidUsd: mid, deltaPct, withinBand },
    files,
    pass: coveragePct >= 90 && checks.failed === 0 && withinBand && files.every((f) => f.ok),
  };
}
