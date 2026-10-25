// What the 3D view (viewer/model.js) shows beside previews/system.glb, read from the product folder as it is now:
//   items      system.json's parts in the frame (id, line, model, material, mass, box), one per node of the model
//   relations  what meets what: fits, contacts, gaps the design accepts, and the parts inside the case
//   problems   each problem of the whole-product check, and each risk the design accepts, with the parts it names
//   lines      the BOM lines' names and how each is made, so a part reads as its line does in the drawing
//   files      each line's files that are in the folder now: its CAD code, STL and STEP, drawing, the board's code
//              and Gerbers, the whole-product check's code for a bought part's envelope. Nothing that isn't there
// modelView returns null when there is no model to show: no system.json (or not one that parses), no frame in it (its
// `inputs` gate, or a model that couldn't be made), no previews/system.glb, or a system.json of an earlier Sprue
// without `items`. Whether the model is of the files as they are now is the page's to say, as Inspect does.

import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { inProduct, outsideProduct } from "./io.ts";
import type { Bom, BomLine, SystemCheck, SystemItem } from "./types.ts";

export type ModelFile = { path: string; what: string };
/** A problem of a gate (its `list`, where `where` places it) or a risk the design accepts (its `flags`, `accepted`). */
export type ModelProblem = { gate: string; title: string; text: string; parts: string[]; at: number[] | null; accepted: boolean };
export type ModelLine = { name: string; short?: string; process: string; qtyPerUnit: number; qtyPerBatch?: number };
export type ModelView = {
  slug: string;
  /** system.json's `model`: previews/system.glb, the digest of the inputs it was made from (its asset.extras.inputs
   * too) and its triangles. */
  model: { file: string; inputs: string; triangles: number };
  minClearanceMm: number | null;
  items: SystemItem[];
  relations: NonNullable<SystemCheck["relations"]>;
  problems: ModelProblem[];
  lines: Record<string, ModelLine>;
  files: Record<string, ModelFile[]>;
};

const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

/** A line's files that are in the product folder now, by their paths in it. A path that leaves the folder is none of
 * its files, though the BOM names it. */
export function lineFiles(dir: string, line: BomLine, envelope: boolean): ModelFile[] {
  const out: ModelFile[] = [];
  const add = (path: string, what: string) => {
    const rel = inProduct(dir, path);
    if (!outsideProduct(rel) && isFile(join(dir, rel)) && !out.some((f) => f.path === rel)) out.push({ path: rel, what });
  };
  const file = typeof line.file === "string" && line.file ? line.file : undefined;
  if (line.process === "pcb") {
    add("cad/pcb.mjs", "the board's code");
    if (file) add(file, "its Gerbers and drill files, for the fab");
    add("previews/pcb-top.svg", "its top, as those files draw it");
    add("previews/pcb-bottom.svg", "its bottom, as those files draw it");
  } else if (file && /\.(stl|step)$/i.test(file)) {
    // `sprue cad` builds cad/<name>.py into fab/<name>.stl and .step, and draws previews/<name>.svg.
    const at = posix.dirname(file.replace(/\\/g, "/")), name = posix.basename(file.replace(/\\/g, "/")).replace(/\.(stl|step)$/i, "");
    add(`cad/${name}.py`, "its CAD code");
    add(`${at}/${name}.stl`, line.process === "print" ? "the mesh the printer gets" : "its mesh");
    add(`${at}/${name}.step`, "its STEP model");
    add(`previews/${name}.svg`, "its drawing");
  } else if (file) add(file, "the file the BOM names for it");
  if (envelope) add("cad/_system.py", "the whole-product check, which draws its envelope");
  return out;
}

/** The 3D view's data for the product in `dir`, or null when there is no model to show. */
export function modelView(dir: string): ModelView | null {
  let sys: SystemCheck;
  try {
    sys = JSON.parse(readFileSync(join(dir, "system.json"), "utf8")) as SystemCheck;
  } catch {
    return null;
  }
  const model = sys?.model;
  if (!model || typeof model.file !== "string" || !Array.isArray(sys.items) || !sys.items.length || !sys.relations) return null;
  if (!isFile(join(dir, model.file))) return null;
  let bom: Bom | undefined;
  try {
    bom = JSON.parse(readFileSync(join(dir, "bom.json"), "utf8")) as Bom;
  } catch {
    bom = undefined;
  }
  const bomLines = Array.isArray(bom?.lines) ? bom.lines : [];
  const lines: Record<string, ModelLine> = {};
  const files: Record<string, ModelFile[]> = {};
  for (const l of bomLines) {
    if (!l || typeof l.id !== "string") continue;
    lines[l.id] = { name: l.name, ...(l.shortName ? { short: l.shortName } : {}), process: l.process, qtyPerUnit: l.qtyPerUnit,
      ...(l.qtyPerBatch !== undefined ? { qtyPerBatch: l.qtyPerBatch } : {}) };
    const of = sys.items.filter((i) => i.line === l.id);
    if (!of.length) continue;
    const found = lineFiles(dir, l, of.some((i) => i.model === "envelope"));
    if (found.length) files[l.id] = found;
  }
  const problems: ModelProblem[] = [];
  for (const g of Array.isArray(sys.gates) ? sys.gates : []) {
    const add = (texts: string[] | undefined, where: SystemCheck["gates"][number]["where"], accepted: boolean) =>
      (texts ?? []).forEach((text, i) => {
        const w = where?.[i];
        if (w && Array.isArray(w.parts)) problems.push({ gate: g.id, title: g.title, text, parts: w.parts, at: w.at ?? null, accepted });
      });
    add(g.list, g.where, false);
    add(g.flags, g.flagsWhere, true);
  }
  return {
    slug: sys.slug,
    model: { file: model.file, inputs: model.inputs, triangles: model.triangles },
    minClearanceMm: sys.minClearanceMm ?? null,
    items: sys.items,
    relations: sys.relations,
    problems,
    lines,
    files,
  };
}
