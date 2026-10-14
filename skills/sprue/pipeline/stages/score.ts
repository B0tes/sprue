// Scores a pipeline run against the reference product's answer key (docs/pipeline.md).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inputsHash } from "../pcb/fresh.ts";
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

/** A Gerber package is ok if the board's own audit (pcb/drc.json, written with the zip) found no errors, every net is
 * joined, and the audit is of the board as it is now (the board code, params and PCB kit have not changed since). */
export function gerbersAudit(dir: string): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return { ok: false, detail: "no pcb/drc.json: run sprue pcb" };
  try {
    const drc = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; errors?: string[]; nets?: Record<string, { connected?: boolean }> };
    const errors = drc.errors ?? ["pcb/drc.json lists no errors field"];
    const open = Object.entries(drc.nets ?? {}).filter(([, n]) => !n.connected).map(([name]) => name);
    if (errors.length) return { ok: false, detail: `our DRC found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (open.length) return { ok: false, detail: `net${open.length === 1 ? "" : "s"} not connected: ${open.join(", ")}` };
    if (drc.inputs !== inputsHash(dir)) return { ok: false, detail: "pcb/drc.json is of an earlier board (the board code, params or PCB kit changed): run sprue pcb" };
    return { ok: true, detail: "Gerbers and drill files; our DRC at JLCPCB's 2-layer limits: 0 errors, every net connected (not the fab's own check)" };
  } catch {
    return { ok: false, detail: "pcb/drc.json is not readable: run sprue pcb" };
  }
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
        const a = gerbersAudit(dir);
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
