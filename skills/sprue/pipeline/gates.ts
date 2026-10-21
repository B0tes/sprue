// What stops a gate being accepted, or the build being packaged, in the files the BOM names (cli.ts adds the failed
// engineer checks). Before this, a part file exported from an earlier design shipped priced at the old volume, and only
// `sprue score`, which needs an answer key, looked: the CO2 run's case was packaged at its old height.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { exportStale, firmwareShips, gerbersAudit, isBoardLine, meshAudit, volumeMismatch } from "./stages/score.ts";
import type { Bom, BomLine } from "./types.ts";

/** Why a printed part's file is not the part its line prices, or undefined when it is: the mesh is not one closed
 * body (meshAudit), or it holds another volume than `spec.volumeCm3`. `sprue cad`, accept and package say this. */
export function meshProblem(dir: string, l: BomLine): string | undefined {
  const path = resolve(dir, l.file!);
  if (!l.file!.toLowerCase().endsWith(".stl") || !existsSync(path)) return undefined;
  const m = meshAudit(path);
  if (!m.ok) return `${l.id}: ${l.file}: ${m.detail}`;
  const priced = volumeMismatch(m.volumeCm3, l.spec.volumeCm3);
  if (priced) return `${l.id}: ${l.file}: ${priced}: copy the volume sprue cad prints for it into ${l.id}'s spec.volumeCm3, then run sprue all so the quote prices it`;
  return undefined;
}

/** Each problem with the BOM's files, as one line naming its line: an export of an earlier design (exportStale) and a
 * printed part's mesh (meshProblem) always; with `built` (the build stage's gate and `sprue package`) also a file not
 * made yet, and a board that has not passed its gates with their self-tests (gerbersAudit), nor its firmware run
 * (firmwareShips). A board is proved in stage 3, so it counts only there. */
export function fileProblems(dir: string, bom: Bom, { built = false } = {}): string[] {
  const out: string[] = [];
  let board = false;
  for (const l of bom.lines.filter((x) => x.file)) {
    const path = resolve(dir, l.file!);
    if (isBoardLine(dir, l)) {
      if (!built) continue;
      // A board whose build failed has no zip, but its drc.json says why.
      const a = gerbersAudit(dir, l.file, { selfTest: true });
      if (!existsSync(path)) out.push(`${l.id}: ${l.file} is not made yet${a.ok ? ": run sprue cad" : `: ${a.detail}`}`);
      else if (!a.ok) out.push(`${l.id}: ${l.file}: ${a.detail}`);
      else board = true;
      continue;
    }
    if (!existsSync(path)) {
      if (built) out.push(`${l.id}: ${l.file} is not made yet: run sprue cad`);
      continue;
    }
    const stale = exportStale(dir, l.file!);
    if (stale) out.push(`${l.id}: ${l.file}: ${stale}`);
    else {
      const m = meshProblem(dir, l);
      if (m) out.push(m);
    }
  }
  // The keypad's firmware goes with its board: one that would be left out of the package stops it.
  if (built && board) {
    const ships = firmwareShips(dir);
    if (!ships.ok && ships.detail) out.push(`firmware/code.py: ${ships.detail}`);
  }
  return out;
}
