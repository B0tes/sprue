// What the 3D view (viewer/model.js) shows beside previews/system.glb, read from the product folder as it is now:
//   items      system.json's parts in the frame (id, line, model, material, mass, box), one per node of the model
//   relations  what meets what: fits, contacts, gaps the design accepts, and the parts meant to be inside the case
//   problems   each problem of the whole-product check, and each risk the design accepts, with the parts it names
//   gates      each gate's status and how many problems it has, so the view can say which it doesn't list or that
//              couldn't run
//   lines      the BOM lines' names and how each is made, so a part reads as its line does in the drawing; `bom` says
//              whether bom.json could be read
//   files      each line's files that are in the folder now: its CAD code, STL and STEP, drawing, the board's code,
//              Gerbers and firmware, the whole-product check's code for a bought part's envelope. Nothing that isn't there
// modelView returns null when there is no model to show: no system.json (or not one that parses), no frame in it (its
// `inputs` gate, or a model that couldn't be made), no previews/system.glb in the folder, or a system.json of an earlier
// Sprue without `items`. Whether the model is of the files as they are now is the page's to say, as Inspect does.

import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { inProduct, outsideProduct } from "./io.ts";
import type { Bom, BomLine, SystemCheck, SystemItem } from "./types.ts";

export type ModelFile = { path: string; what: string };
/** A problem of a gate (its `list`, where `where` places it) or a risk the design accepts (its `flags`, `accepted`). */
export type ModelProblem = { gate: string; title: string; text: string; parts: string[]; at: number[] | null; accepted: boolean };
export type ModelLine = { name: string; short?: string; process: string; qtyPerUnit: number; qtyPerBatch?: number };
/** A gate of the whole-product check: `problems` its count, `listed` how many of them system.json lists (at most 200),
 * `ran` false when it couldn't run, so what it checks wasn't checked. */
export type ModelGate = { id: string; title: string; status: "pass" | "fail"; problems: number; listed: number; ran: boolean };
export type ModelView = {
  slug: string;
  /** system.json's `model`: previews/system.glb, the digest of the inputs it was made from (its asset.extras.inputs
   * too) and its triangles. */
  model: { file: string; inputs: string; triangles: number };
  minClearanceMm: number | null;
  items: SystemItem[];
  relations: NonNullable<SystemCheck["relations"]>;
  problems: ModelProblem[];
  gates: ModelGate[];
  /** Whether bom.json could be read: without it the lines are unknown, not missing. */
  bom: boolean;
  lines: Record<string, ModelLine>;
  files: Record<string, ModelFile[]>;
};

const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

/** A line's files that are in the product folder now, by their paths in it. A path that leaves the folder is none of
 * its files, though the BOM names it. `line` may be only the item's line id, when bom.json couldn't be read. */
export function lineFiles(dir: string, line: Partial<BomLine>, envelope: boolean): ModelFile[] {
  const out: ModelFile[] = [];
  const here = (path: string) => { const rel = inProduct(dir, path); return outsideProduct(rel) ? null : rel; };
  const add = (path: string, what: string) => {
    const rel = here(path);
    if (rel !== null && isFile(join(dir, rel)) && !out.some((f) => f.path === rel)) out.push({ path: rel, what });
  };
  const file = typeof line.file === "string" && line.file ? line.file : undefined;
  if (line.process === "pcb") {
    add("cad/pcb.mjs", "the board's code");
    if (file) add(file, "its Gerbers and drill files, for the fab");
    add("previews/pcb-top.svg", "its top, drawn from its Gerbers");
    add("previews/pcb-bottom.svg", "its bottom, drawn from its Gerbers");
    add("firmware/code.py", "the firmware for it");
  } else if (file && /\.(stl|step)$/i.test(file)) {
    const rel = here(file.replace(/\\/g, "/"));
    if (rel !== null) {
      const at = posix.dirname(rel), name = posix.basename(rel).replace(/\.(stl|step)$/i, "");
      // `sprue cad` builds cad/<name>.py (never one named _*) into fab/<name>.stl and .step and draws previews/<name>.svg,
      // so those are the line's own only when it is made and its file is that export.
      const made = at === "fab" && line.process !== "buy" && !name.startsWith("_");
      if (made) add(`cad/${name}.py`, "its CAD code");
      add(`${at}/${name}.stl`, line.process === "print" ? "the mesh the printer gets" : "its mesh");
      add(`${at}/${name}.step`, "its STEP model");
      if (made) add(`previews/${name}.svg`, "its drawing");
    }
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
  // The model is the folder's own: the page inlines it.
  const glb = inProduct(dir, model.file);
  if (outsideProduct(glb) || !isFile(join(dir, glb))) return null;
  let bom: Bom | undefined;
  try {
    bom = JSON.parse(readFileSync(join(dir, "bom.json"), "utf8")) as Bom;
  } catch {
    bom = undefined;
  }
  const bomLines = Array.isArray(bom?.lines) ? bom.lines.filter((l) => l && typeof l.id === "string") : [];
  const lines: Record<string, ModelLine> = {};
  for (const l of bomLines) {
    lines[l.id] = { name: l.name, ...(l.shortName ? { short: l.shortName } : {}), process: l.process, qtyPerUnit: l.qtyPerUnit,
      ...(l.qtyPerBatch !== undefined ? { qtyPerBatch: l.qtyPerBatch } : {}) };
  }
  // Each line of a part in the frame: its BOM line when there is one, else only its id (bom.json unread, or a part of
  // a line the BOM lacks), whose files are then at most its envelope's code.
  const files: Record<string, ModelFile[]> = {};
  for (const id of new Set(sys.items.map((i) => i.line).filter((l): l is string => typeof l === "string"))) {
    const of = sys.items.filter((i) => i.line === id);
    const found = lineFiles(dir, bomLines.find((l) => l.id === id) ?? { id }, of.some((i) => i.model === "envelope"));
    if (found.length) files[id] = found;
  }
  const problems: ModelProblem[] = [];
  const gates: ModelGate[] = [];
  for (const g of Array.isArray(sys.gates) ? sys.gates : []) {
    const add = (texts: string[] | undefined, where: SystemCheck["gates"][number]["where"], accepted: boolean) =>
      (texts ?? []).forEach((text, i) => {
        const w = where?.[i];
        if (w && Array.isArray(w.parts)) problems.push({ gate: g.id, title: g.title, text, parts: w.parts, at: w.at ?? null, accepted });
      });
    add(g.list, g.where, false);
    add(g.flags, g.flagsWhere, true);
    gates.push({ id: g.id, title: g.title, status: g.status, problems: g.problems ?? 0, listed: g.list?.length ?? 0,
      ran: !String(g.detail ?? "").startsWith("Can't run") });
  }
  return {
    slug: sys.slug,
    model: { file: glb, inputs: model.inputs, triangles: model.triangles },
    minClearanceMm: sys.minClearanceMm ?? null,
    items: sys.items,
    relations: sys.relations,
    problems,
    gates,
    bom: Boolean(bom && Array.isArray(bom.lines)),
    lines,
    files,
  };
}
