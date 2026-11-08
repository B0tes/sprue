// Whether a product's CAD exports here are of its files as they are, as the gates judge them: each made part's file
// in fab/ (score.ts exportStale) and a board's pcb/ (drc.json's fingerprint, pcb/fresh.ts). Prints the first that
// isn't, or nothing. scripts/gate-outputs.mjs runs it before a slug's gates: a gate that reads an export from an
// earlier design refuses, or the whole-product check measures an old board, because of this machine, not the product.
// It imports the pipeline's own code, so it runs with type stripping on, as bin/sprue runs the pipeline.
// Usage: node --experimental-strip-types scripts/exports-current.mjs <product folder>

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { realPath } from "../skills/sprue/pipeline/io.ts";
import { inputsHash } from "../skills/sprue/pipeline/pcb/fresh.ts";
import { exportStale, isBoardLine } from "../skills/sprue/pipeline/stages/score.ts";

const dir = process.argv[2];
const bom = JSON.parse(readFileSync(join(dir, "bom.json"), "utf8"));
const why = [];
// Each part's file however its line writes the path (./fab/x, its absolute path, a folder linked to fab/), as the
// gates read it; one missing is not made yet only when it would be in fab/.
for (const l of bom.lines ?? []) {
  if (!l.file || isBoardLine(dir, l)) continue;
  const at = resolve(dir, l.file);
  const stale = existsSync(at) ? exportStale(dir, l.file) : realPath(dirname(at)) === realPath(join(dir, "fab")) ? "not made yet: run sprue cad" : undefined;
  if (stale) why.push(`${l.file}: ${stale}`);
}
if (existsSync(join(dir, "cad", "pcb.mjs"))) {
  let drc;
  try {
    drc = JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8"));
  } catch {
    why.push("pcb/drc.json is missing or not readable: run sprue pcb");
  }
  if (drc && drc.inputs !== inputsHash(dir, drc.reads)) why.push("pcb/ is of an earlier board: run sprue pcb");
}
if (why.length) console.log(why[0]);
