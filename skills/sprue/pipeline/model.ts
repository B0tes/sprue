// What the 3D view (viewer/model.js) shows beside previews/system.glb, read from the product folder as it is now:
//   items      system.json's parts in the frame (id, line, model, material, mass, box), one per node of the model, and
//              those drawn along a path (a gooseneck bent to the design pose), which no gate checks as a shape
//   relations  what meets what: fits, contacts, gaps the design accepts, and the parts meant to be inside the case
//   problems   each problem of the whole-product check, and each risk the design accepts, with the parts it names
//   gates      each gate's status and how many problems it has, so the view can say which it doesn't list or that
//              couldn't run; `ok` and `selfTest` whether the check passes and whether its self-test caught every fault;
//              `stale` the files it was run on that have changed since (systemAudit's comparison), so a check of an
//              earlier design never reads as one of this; `missing` those of them that aren't in the folder now
//   lines      the BOM lines' names and how each is made, so a part reads as its line does in the drawing; `bom` says
//              whether bom.json could be read
//   files      each line's files that are in the folder now: its CAD code, STL and STEP, drawing, the board's code,
//              Gerbers and firmware (the board's line only, chosen as the order folder chooses it), the whole-product
//              check's code for a bought part's envelope or a part it draws along a path. Nothing that isn't there
//   assembly   the drawing's assembly steps (figure.json), and for each part the step that puts it in and its move in
//              the apart pose, so the view takes the product apart and walks the steps as the drawing does; the lines
//              whose parts it can't match to the drawing's, and why
//   stability  the whole product's mass and centre of mass as the stability gate weighed it, in the pose the model is in
// modelView returns null when there is no model to show: no system.json (or not one that parses), no frame in it (its
// `inputs` gate, or a model that couldn't be made), no previews/system.glb in the folder, or a system.json of an earlier
// Sprue without `items`.

import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { inProduct, outsideProduct } from "./io.ts";
import { systemInputs } from "./stages/score.ts";
import type { Bom, BomLine, SystemCheck, SystemItem } from "./types.ts";

export type ModelFile = { path: string; what: string };
/** A problem of a gate (its `list`, where `where` places it) or a risk the design accepts (its `flags`, `accepted`).
 * `pose`: the stability pose it is of (the stability gate's texts start with its name), whose `at` is in that pose,
 * where parts may be elsewhere than the model draws them; null for every other gate's. */
export type ModelProblem = { gate: string; title: string; text: string; parts: string[]; at: number[] | null; accepted: boolean; pose: string | null };
export type ModelLine = { name: string; short?: string; process: string; qtyPerUnit: number; qtyPerBatch?: number };
/** A gate of the whole-product check: `problems` its count, `listed` how many of them system.json lists (at most 200),
 * `ran` false when it couldn't run, so what it checks wasn't checked. */
export type ModelGate = { id: string; title: string; status: "pass" | "fail"; problems: number; listed: number; ran: boolean };
/** A step of the drawing's assembly: its number and what it says to do. */
export type ModelStep = { n: number; text: string };
/** The drawing's assembly as the view shows it: figure.json's steps, in order, and for each part in the frame (by its
 * id) the step that puts it in and its move in the apart pose, [x, y, z] in mm along the frame's axes. A line the
 * drawing puts in at more than one step or moves apart more than one way (a screw at the base and another at the
 * head) has parts the model can't match to the drawing's, which draws no part's place; its parts then come in at the
 * first of those steps and stay where they are when the product comes apart, and `unsure` says why, by line. So does
 * a line the drawing doesn't draw, whose parts are in from the start. */
export type ModelAssembly = { steps: ModelStep[]; parts: Record<string, { step: number; lift: [number, number, number] }>; unsure: Record<string, string> };
/** The whole product's weighing, as the stability gate did it in the pose the model is in (system.json's first): its
 * mass, how much of it is estimated, its centre of mass in mm in the frame, and how far it tilts before it tips. */
export type ModelMass = { pose: string; massG: number; estimatedG: number; com: [number, number, number]; tiltDeg: number | null };
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
  /** system.json's `ok`: every gate passes and the self-test caught every fault. */
  ok: boolean;
  /** The self-test: `ok` when it caught every fault it plants and left no gate untested; `missed` the faults it didn't
   * catch and `untested` the gates it has no fault for. */
  selfTest: { ok: boolean; missed: string[]; untested: string[] };
  /** The inputs system.json was run on that are not as they are now (as systemAudit compares them: a CAD file, the
   * board's zip, design.json's params, the BOM for one unit, the checker): when there are any, all it says is of an
   * earlier design. */
  stale: string[];
  /** Those of `stale` that aren't in the folder now (a folder without pcb/, which git ignores, has no board's zip): the
   * model may be of these files, but nothing here can say. */
  missing: string[];
  /** Whether bom.json could be read: without it the lines are unknown, not missing. */
  bom: boolean;
  lines: Record<string, ModelLine>;
  files: Record<string, ModelFile[]>;
  /** null without a figure.json with steps: the view then has no apart pose and no steps. */
  assembly: ModelAssembly | null;
  /** null when system.json weighed no pose. */
  stability: ModelMass | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The drawing's assembly for the parts in the frame (ModelAssembly), from figure.json, or null without one that has
 * steps. A part a call draws only a piece of (count 0: the second half of a split part) goes with the call that
 * counts it. */
export function assemblyOf(figure: unknown, items: SystemItem[]): ModelAssembly | null {
  const f = figure as { steps?: { n?: unknown; text?: unknown }[]; parts?: { line?: unknown; step?: unknown; count?: unknown; lift?: unknown }[] } | null;
  if (!f || !Array.isArray(f.steps) || !f.steps.length) return null;
  const steps: ModelStep[] = [];
  const add = (n: number, text: string) => { if (!steps.some((s) => s.n === n)) steps.push({ n, text }); };
  for (const s of f.steps) if (s && Number.isInteger(s.n) && (s.n as number) >= 1) add(s.n as number, typeof s.text === "string" ? s.text : "");
  type Call = { step: number; lift: [number, number, number] };
  const calls = new Map<string, Call[]>();
  for (const p of Array.isArray(f.parts) ? f.parts : []) {
    if (!p || typeof p.line !== "string" || !Number.isInteger(p.step) || (p.step as number) < 1) continue;
    if (p.count === 0) continue;
    const lift = Array.isArray(p.lift) && p.lift.length === 3 && p.lift.every(finite) ? p.lift as [number, number, number] : [0, 0, 0] as [number, number, number];
    add(p.step as number, "");
    calls.set(p.line, [...(calls.get(p.line) ?? []), { step: p.step as number, lift }]);
  }
  if (!steps.length) return null;
  steps.sort((a, b) => a.n - b.n);
  const parts: ModelAssembly["parts"] = {};
  const unsure: Record<string, string> = {};
  for (const item of items) {
    const line = item.line ?? "";
    const of = calls.get(line) ?? [];
    if (!of.length) {
      parts[item.id] = { step: steps[0].n, lift: [0, 0, 0] };
      if (item.line) unsure[line] = "the drawing doesn't draw it, so it is in from the start and doesn't move";
      continue;
    }
    const first = Math.min(...of.map((c) => c.step));
    const at = [...new Set(of.map((c) => c.step))].sort((a, b) => a - b);
    const ways = new Set(of.map((c) => c.lift.join(",")));
    if (at.length === 1 && ways.size === 1) {
      parts[item.id] = { step: first, lift: [...of[0].lift] as [number, number, number] };
      continue;
    }
    parts[item.id] = { step: first, lift: [0, 0, 0] };
    const list = at.length > 2 ? `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}` : at.join(" and ");
    unsure[line] = `${at.length > 1 ? `the drawing puts its parts in at steps ${list}` : `the drawing moves its parts apart ${ways.size} ways`}, and which part is which the model can't tell, so its parts come in at step ${first} and don't move apart`;
  }
  return { steps, parts, unsure };
}

const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

/** A line's files that are in the product folder now, by their paths in it. A path that leaves the folder is none of
 * its files, though the BOM names it. `line` may be only the item's line id, when bom.json couldn't be read. `board`:
 * the line is the board's, so the board's code, pictures and firmware are its files too. `envelope` and `path`: a part
 * of the line is drawn by the whole-product check's code, as an envelope or along a path. */
export function lineFiles(dir: string, line: Partial<BomLine>, envelope: boolean, board = line.process === "pcb", path = false): ModelFile[] {
  const out: ModelFile[] = [];
  const here = (path: string) => { const rel = inProduct(dir, path); return outsideProduct(rel) ? null : rel; };
  const add = (path: string, what: string) => {
    const rel = here(path);
    if (rel !== null && isFile(join(dir, rel)) && !out.some((f) => f.path === rel)) out.push({ path: rel, what });
  };
  const file = typeof line.file === "string" && line.file ? line.file : undefined;
  if (line.process === "pcb") {
    if (board) add("cad/pcb.mjs", "the board's code");
    if (file) add(file, board ? "its Gerbers and drill files, for the fab" : "the file the BOM names for it");
    if (board) {
      add("previews/pcb-top.svg", "its top, drawn from its Gerbers");
      add("previews/pcb-bottom.svg", "its bottom, drawn from its Gerbers");
      add("firmware/code.py", "the firmware for it");
    }
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
  if (path) add("cad/_system.py", "the whole-product check, which draws it along its path");
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
  // The board's line, as the order folder picks it (pcb/order.ts): the line whose file is the zip board.json names
  // (pcb/<slug>-gerbers.zip, as sprue pcb writes it, when board.json isn't there), else the first board line with no file.
  let zip = `${sys.slug}-gerbers.zip`;
  try {
    const named = JSON.parse(readFileSync(join(dir, "pcb", "board.json"), "utf8"))?.files?.zip;
    if (typeof named === "string" && named) zip = named;
  } catch { /* no board.json: the name sprue pcb gives it */ }
  const board = bomLines.find((l) => typeof l.file === "string" && !!l.file && inProduct(dir, l.file) === `pcb/${zip}`)
    ?? bomLines.find((l) => l.process === "pcb" && !l.file);
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
    const line = bomLines.find((l) => l.id === id);
    const found = lineFiles(dir, line ?? { id }, of.some((i) => i.model === "envelope"), !!line && line === board, of.some((i) => i.model === "path"));
    if (found.length) files[id] = found;
  }
  const problems: ModelProblem[] = [];
  const gates: ModelGate[] = [];
  // The poses the stability gate weighed, longest name first, so one whose name begins another's is told apart.
  const poses = (Array.isArray(sys.stability) ? sys.stability : []).map((s) => String(s?.pose ?? "")).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const g of Array.isArray(sys.gates) ? sys.gates : []) {
    const add = (texts: string[] | undefined, where: SystemCheck["gates"][number]["where"], accepted: boolean) =>
      (texts ?? []).forEach((text, i) => {
        const w = where?.[i];
        if (!w || !Array.isArray(w.parts)) return;
        const pose = g.id === "stability" ? poses.find((name) => text.startsWith(`${name}: `)) ?? null : null;
        problems.push({ gate: g.id, title: g.title, text, parts: w.parts, at: w.at ?? null, accepted, pose });
      });
    add(g.list, g.where, false);
    add(g.flags, g.flagsWhere, true);
    gates.push({ id: g.id, title: g.title, status: g.status, problems: g.problems ?? 0, listed: g.list?.length ?? 0,
      ran: !String(g.detail ?? "").startsWith("Can't run") });
  }
  let figure: unknown = null;
  try {
    figure = JSON.parse(readFileSync(join(dir, "figure.json"), "utf8"));
  } catch { /* not drawn yet: no apart pose and no steps */ }
  const assembly = assemblyOf(figure, sys.items);
  const was = sys.inputs ?? {}, now = systemInputs(dir, Object.keys(was));
  const stale = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
  const missing = stale.filter((k) => !(k in now));
  return {
    slug: sys.slug,
    model: { file: glb, inputs: model.inputs, triangles: model.triangles },
    minClearanceMm: sys.minClearanceMm ?? null,
    items: sys.items,
    relations: sys.relations,
    problems,
    gates,
    ok: sys.ok === true,
    selfTest: {
      ok: sys.selfTest?.ok === true,
      missed: (Array.isArray(sys.selfTest?.faults) ? sys.selfTest.faults : []).filter((f) => f && !f.caught).map((f) => `${f.gate}: ${f.fault}`),
      untested: Array.isArray(sys.selfTest?.untested) ? sys.selfTest.untested.map(String) : [],
    },
    stale,
    missing,
    bom: Boolean(bom && Array.isArray(bom.lines)),
    lines,
    files,
    assembly,
    stability: massOf(sys),
  };
}

/** The first pose's weighing (ModelMass), or null when there is none that reads. */
function massOf(sys: SystemCheck): ModelMass | null {
  const s = Array.isArray(sys.stability) ? sys.stability[0] : undefined;
  if (!s || !finite(s.massG) || !Array.isArray(s.com) || s.com.length !== 3 || !s.com.every(finite)) return null;
  return { pose: String(s.pose ?? ""), massG: s.massG, estimatedG: finite(s.estimatedG) ? s.estimatedG : 0,
    com: [...s.com] as [number, number, number], tiltDeg: finite(s.tiltDeg) ? s.tiltDeg : null };
}
