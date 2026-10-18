// Scores a pipeline run against the reference product's answer key (docs/pipeline.md).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { batchNeed, inProduct, linkInProduct, outsideProduct } from "../io.ts";
import { inputsHash, type Reads } from "../pcb/fresh.ts";
import { ORDER_DIR, orderStaleness, specProblems, type BoardJson } from "../pcb/order.ts";
import type { Bom, Checks, FaultsReport, Quotes, Reference, Score, SystemCheck } from "../types.ts";

/** A printed part's mesh (a binary STL), read the way trimesh's `split(only_watertight=False, repair=False)` and its
 * signed volume see it: every edge is shared by exactly two faces that run it in opposite directions (the surface is
 * closed and wound one way), and the faces joined through their edges make one body of positive volume. Counting
 * edges alone passes a part with a sealed void inside: the void is a second closed shell, wound the other way, so its
 * volume is negative. Vertices are welded on a 1 µm grid, and a face with two of its vertices welded together (the
 * slivers OpenCascade writes at a sphere's pole or a cone's tip) is dropped first, where trimesh keeps it and calls
 * the mesh open. */
export function meshAudit(path: string): { ok: boolean; detail: string; bodies?: number; volumeCm3?: number } {
  const buf = readFileSync(path);
  const tris = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  if (tris < 0 || buf.length !== 84 + tris * 50) return { ok: false, detail: "not a binary STL (its size does not match its triangle count)" };
  const ids = new Map<string, number>(), pts: number[][] = [];
  const vertex = (o: number) => {
    const p = [0, 4, 8].map((d) => buf.readFloatLE(o + d));
    const key = p.map((x) => Math.round(x * 1e3)).join(",");
    let i = ids.get(key);
    if (i === undefined) ids.set(key, (i = pts.push(p) - 1));
    return i;
  };
  const faces: number[][] = [];
  for (let t = 0; t < tris; t++) {
    const base = 84 + t * 50 + 12;
    const v = [vertex(base), vertex(base + 12), vertex(base + 24)];
    if (v[0] !== v[1] && v[1] !== v[2] && v[0] !== v[2]) faces.push(v); // a sliver with two vertices welded has no edges
  }
  if (!faces.length) return { ok: false, detail: "the mesh has no faces" };
  // Each edge (keyed by its two vertices, low one first): the faces that use it, and how many run it low to high.
  const nv = pts.length, edges = new Map<number, { faces: number[]; up: number }>();
  faces.forEach((v, f) => {
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      const key = a < b ? a * nv + b : b * nv + a;
      const e = edges.get(key);
      if (e) e.faces.push(f);
      else edges.set(key, { faces: [f], up: 0 });
      if (a < b) edges.get(key)!.up++;
    }
  });
  // The shells: faces joined through shared edges (union-find, iterative, so a long mesh can't overflow the stack).
  const parent = Int32Array.from(faces, (_, i) => i), size = new Int32Array(faces.length).fill(1);
  const root = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a: number, b: number) => {
    let [x, y] = [root(a), root(b)];
    if (x === y) return;
    if (size[x] < size[y]) [x, y] = [y, x];
    parent[y] = x;
    size[x] += size[y];
  };
  let open = 0, crowded = 0, turned = 0;
  for (const e of edges.values()) {
    if (e.faces.length === 1) open++;
    else if (e.faces.length > 2) crowded++;
    else if (e.up !== 1) turned++;
    for (const f of e.faces.slice(1)) join(f, e.faces[0]);
  }
  const s = (n: number) => (n === 1 ? "" : "s");
  const problems = [
    open && `${open} open edge${s(open)}, so the surface has a hole`,
    crowded && `${crowded} edge${s(crowded)} shared by more than two faces, where surfaces touch or cross`,
    turned && `${turned} edge${s(turned)} run the same way by both of ${turned === 1 ? "its" : "their"} faces, so some faces are turned inside out`,
  ].filter(Boolean);
  if (problems.length) return { ok: false, detail: `the mesh is not one closed surface: ${problems.join("; ")}` };
  // Signed volume of each shell (the sum of the tetrahedra from the origin to each face), in cm3.
  const vol = new Map<number, number>();
  faces.forEach(([a, b, c], f) => {
    const [p, q, r] = [pts[a], pts[b], pts[c]];
    const v = (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6000;
    vol.set(root(f), (vol.get(root(f)) ?? 0) + v);
  });
  const shells = [...vol.values()], total = shells.reduce((x, y) => x + y, 0);
  const bodies = shells.filter((v) => v > 0).length, inward = shells.length - bodies;
  const cm3 = (v: number) => `${Math.abs(v) < 0.1 ? Math.abs(v).toPrecision(2) : Math.abs(v).toFixed(1)} cm3`;
  const at = { bodies, volumeCm3: Math.round(total * 1000) / 1000 };
  if (!bodies) return { ok: false, detail: `the mesh is inside out: its faces point inwards (${cm3(total)} enclosed)`, ...at };
  if (inward) return { ok: false, detail: `${inward} closed shell${s(inward)} inside the part face${inward === 1 ? "s" : ""} inwards: a sealed void (${shells.filter((v) => v <= 0).map(cm3).join(", ")}), which traps resin or powder and is usually a modelling mistake`, ...at };
  if (bodies > 1) return { ok: false, detail: `${bodies} separate bodies in one part file (${shells.map(cm3).join(", ")}): print them as separate parts, or join them`, ...at };
  return { ok: true, detail: `one closed body of ${cm3(total)}, each edge shared by two faces`, ...at };
}

/** Why a print's mesh and the volume its price is worked out from (the BOM line's `spec.volumeCm3`, typed from the
 * same `sprue cad` run) do not describe one part, or nothing if they agree within 1% or 0.05 cm3, whichever is more.
 * The mesh is OpenCascade's tessellation of the solid whose exact volume `sprue cad` prints, so they differ by a few
 * thousandths of a cm3 on curved parts; an edit to the CAD that was exported but never copied into the BOM differs
 * by far more. */
export function volumeMismatch(meshCm3: number | undefined, specCm3: unknown): string | undefined {
  // A line with no volume (none, "", 0) is the checks' to report: it can't be quoted.
  if (meshCm3 === undefined || !specCm3) return undefined;
  // Read as the quote reads it (adapters/fab.ts: Number(spec.volumeCm3)), so "5" is checked as the 5 it is priced at,
  // and "  " as the 0 it would be.
  const spec = Number(specCm3);
  if (!Number.isFinite(spec)) return `spec.volumeCm3 (${JSON.stringify(specCm3)}) is not a number`;
  if (Math.abs(meshCm3 - spec) <= Math.max(0.05, Math.abs(spec) * 0.01)) return undefined;
  const cm3 = (v: number) => `${v.toFixed(2)} cm3`;
  return `the mesh holds ${cm3(meshCm3)} but bom.json prices ${cm3(spec)} (spec.volumeCm3)`;
}

/** The board's own audit (pcb/drc.json, written with the zip) is ok if it found no errors, every net is joined, and it
 * is of the board as it is now (the board code, the params, what it read of design.json and bom.json, the PCB kit and
 * the read-back have not changed since). */
export function drcAudit(dir: string): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return { ok: false, detail: "no pcb/drc.json: run sprue pcb" };
  try {
    const drc = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; reads?: Reads; errors?: string[]; nets?: Record<string, { connected?: boolean }> };
    const errors = drc.errors ?? ["pcb/drc.json lists no errors field"];
    const open = Object.entries(drc.nets ?? {}).filter(([, n]) => !n.connected).map(([name]) => name);
    if (errors.length) return { ok: false, detail: `our DRC found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (open.length) return { ok: false, detail: `net${open.length === 1 ? "" : "s"} not connected: ${open.join(", ")}` };
    if (drc.inputs !== inputsHash(dir, drc.reads)) return { ok: false, detail: "pcb/drc.json is of an earlier board (the board code, what it reads of design.json or bom.json, or the PCB kit changed): run sprue pcb" };
    return { ok: true, detail: "our DRC, at least as strict as JLCPCB's, PCBWay's, OSH Park's and Aisler's 2-layer limits: 0 errors, every net connected" };
  } catch {
    return { ok: false, detail: "pcb/drc.json is not readable: run sprue pcb" };
  }
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export { inProduct };

const stat = (path: string) => {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
};

/** Whether a BOM line is the board: a PCB line (by its process or its role), any line whose file is in pcb/, however
 * its path is written and through any link, or one whose file is a copy of a file there, such as the zip. Its file
 * goes only through the board's gates (gerbersAudit), which pass nothing but the zip the read-back read. */
export function isBoardLine(dir: string, l: { process?: string; role?: string; file?: string }): boolean {
  if (!l.file) return false;
  if (l.process === "pcb" || l.role === "pcb" || inProduct(dir, l.file).startsWith("pcb/")) return true;
  const file = resolve(dir, l.file), pcb = join(dir, "pcb"), size = stat(file)?.isFile() ? stat(file)!.size : -1;
  if (size < 0 || !existsSync(pcb)) return false;
  return readdirSync(pcb).some((f) => stat(join(pcb, f))?.isFile() && stat(join(pcb, f))!.size === size && sha256(join(pcb, f)) === sha256(file));
}

/** The read-back (pcb/readback.json, written by pipeline/pcb/readback.py) is ok if it passed, read the zip and the
 * netlist that are in pcb/ now (by their sha256), and carries the audit's fingerprint. `zip` is the zip a BOM line
 * names, when there is one, which must be the one read back. With `selfTest` (what `sprue score` and `package` ask) its
 * self-test must have run and passed too: `sprue cad` reads the zip back without one. */
export function readbackAudit(dir: string, zip?: string, { selfTest = false } = {}): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "readback.json");
  const again = "run sprue verify";
  if (!existsSync(path)) return { ok: false, detail: `no pcb/readback.json, so nothing but our own code has read the files: ${again} (it needs gerbonara and shapely)` };
  try {
    const rb = JSON.parse(readFileSync(path, "utf8")) as {
      inputs?: string; ok?: boolean; errors?: string[]; selfTest?: { ok?: boolean; ran?: boolean };
      files?: { zip?: { name?: string; sha256?: string }; netlist?: { name?: string; sha256?: string } };
    };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const errors = rb.errors ?? ["pcb/readback.json lists no errors field"];
    if (errors.length) return { ok: false, detail: `the read-back found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (rb.selfTest?.ran === false) return { ok: false, detail: `the read-back's self-test could put no fault into this board, so its pass is not shown to mean anything here: report it` };
    if (rb.selfTest && !rb.selfTest.ok) return { ok: false, detail: `the read-back's self-test failed, so its pass proves nothing: see pcb/readback.json` };
    if (!rb.ok) return { ok: false, detail: "pcb/readback.json does not say it passed" };
    if (rb.inputs !== drc.inputs) return { ok: false, detail: `pcb/readback.json is of an earlier board than pcb/drc.json: ${again}` };
    for (const f of [rb.files?.zip, rb.files?.netlist]) {
      const file = f?.name ? join(dir, "pcb", f.name) : "";
      if (!file || !existsSync(file) || sha256(file) !== f!.sha256) return { ok: false, detail: `pcb/${f?.name ?? "?"} is not the file the read-back read: ${again}` };
    }
    // The very file a BOM line names, not one of the same name elsewhere (an old revision, another board's).
    const read = `pcb/${rb.files!.zip!.name}`;
    if (zip && inProduct(dir, zip) !== read) return { ok: false, detail: `bom.json names ${zip}, and the read-back read ${read}, the board's zip: name ${read} in bom.json` };
    if (selfTest && !rb.selfTest) return { ok: false, detail: `the read-back's self-test has not run on this zip, so its pass is not shown to mean anything here: ${again}` };
    return { ok: true, detail: `the read-back (gerbonara and shapely on the zip and the netlist) finds the nets design.json means${rb.selfTest ? ", and its self-test catches each fault put in" : ""}` };
  } catch {
    return { ok: false, detail: `pcb/readback.json is not readable: ${again}` };
  }
}

/** The firmware in the loop (firmware/fil.json, written by `sprue verify`): a run of the board's own firmware (the
 * code.py sprue pcb wrote for its keys, board.json `firmwareCode`) that failed on this zip (by their sha256)
 * refuses the zip, since the copper does not give the keys their codes, until either changes; rebuilding the same
 * board does not clear it, and neither does a code.py of the user's own, whose run (fil.json `yours`) is the code's
 * and refuses nothing here. One that passed on them, for this board's fingerprint, says so. None, or one of other
 * files, refuses nothing (it needs the emulator, fetched once), and the detail says to run it; with `required` (what
 * `sprue score` and `package` ask) it refuses the zip, since a keypad's board is not verified until its firmware has
 * run on it, and fil.json's `ok` holds only when the run's self-test caught each wiring fault too. A board with no keys (board.json `firmware`) has no firmware to check. */
export function firmwareAudit(dir: string, { required = false } = {}): { ok: boolean; detail: string } {
  const path = join(dir, "firmware", "fil.json"), board = join(dir, "pcb", "board.json");
  let own: string | undefined;
  try {
    const b = existsSync(board) ? (JSON.parse(readFileSync(board, "utf8")) as { firmware?: unknown; firmwareCode?: { sha256?: string } | null }) : {};
    if (!Array.isArray(b.firmware) || !b.firmware.length || !b.firmwareCode?.sha256) return { ok: true, detail: "" };
    own = b.firmwareCode.sha256;
  } catch {
    return { ok: false, detail: "pcb/board.json is not readable: run sprue pcb" };
  }
  const notRun = (detail: string) => (required ? { ok: false, detail: `${detail}: run sprue verify, which runs it, until it ends VERIFIED` } : { ok: true, detail: `${detail} (sprue verify runs it)` });
  if (!existsSync(path)) return notRun("the board's firmware has not been run on that copper yet");
  try {
    const fil = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; ok?: boolean; errors?: string[]; firmware?: { sha256?: string }; netlist?: { zip?: string; zipSha256?: string }; selfTest?: { ok?: boolean } };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const zip = fil.netlist?.zip ? join(dir, "pcb", fil.netlist.zip) : "";
    const same = fil.firmware?.sha256 === own && !!zip && existsSync(zip) && fil.netlist?.zipSha256 === sha256(zip);
    if (same && !fil.ok) return { ok: false, detail: `the board's firmware, run on the copper read back, ${fil.errors?.length ? `found: ${fil.errors[0]}` : "failed: see firmware/fil.json"}` };
    if (!same || fil.inputs !== drc.inputs) return notRun("firmware/fil.json is of an earlier board, zip or firmware, so the board's firmware has not been run on this zip's copper");
    return { ok: true, detail: `the board's firmware, run on that copper, types each key's code${fil.selfTest?.ok ? ", and its self-test catches each wiring fault put in" : ""}` };
  } catch {
    return { ok: false, detail: "firmware/fil.json is not readable: run sprue verify" };
  }
}

/** Whether `sprue package` ships firmware/code.py with the board: only the code.py `sprue pcb` wrote for this
 * board (board.json `firmwareCode`, by its sha256), or one of the user's own whose run on this very zip's copper passed
 * (fil.json `yours`). An edited or older code.py, or one whose run failed, stays out, and `detail` says why. `ok` is
 * false with no detail for a board with no keys. */
export function firmwareShips(dir: string): { ok: boolean; detail: string } {
  const code = join(dir, "firmware", "code.py"), board = join(dir, "pcb", "board.json"), path = join(dir, "firmware", "fil.json");
  try {
    const b = existsSync(board) ? (JSON.parse(readFileSync(board, "utf8")) as { firmware?: unknown; firmwareCode?: { file?: string; sha256?: string } | null }) : {};
    if (!Array.isArray(b.firmware) || !b.firmware.length) return { ok: false, detail: "" };
    if (!existsSync(code)) return { ok: false, detail: "there is no firmware/code.py: run sprue pcb, which writes it" };
    const have = sha256(code);
    if (b.firmwareCode?.sha256 === have) return { ok: true, detail: "the firmware sprue pcb wrote for this board" };
    const fil = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { ok?: boolean; yours?: { ok?: boolean; sha256?: string }; netlist?: { zip?: string; zipSha256?: string } }) : {};
    const zip = fil.netlist?.zip ? join(dir, "pcb", fil.netlist.zip) : "";
    if (fil.ok && fil.yours?.ok && fil.yours.sha256 === have && zip && existsSync(zip) && fil.netlist?.zipSha256 === sha256(zip))
      return { ok: true, detail: "your firmware/code.py, which the firmware run passed on this zip" };
    return {
      ok: false,
      detail: `firmware/code.py is not the one sprue pcb wrote for this board (it was edited, or is of an earlier board), and no firmware run passed it on this zip: run sprue verify to test yours${b.firmwareCode?.file === "firmware/code.sprue.py" ? ", or copy firmware/code.sprue.py over it" : ", or sprue pcb to write the board's again"}`,
    };
  } catch {
    return { ok: false, detail: "pcb/board.json or firmware/fil.json is not readable: run sprue verify" };
  }
}

/** A Gerber package is ok if the board's own audit passed and is current, the read-back of the very files in the
 * zip passed too, no run of the firmware on that copper failed, and bom.json and design.json give one board to order
 * from it (specProblems, which fails `sprue verify`'s order layer). With `selfTest` (what `sprue score` and `package` ask) the
 * read-back's self-test must have passed on this zip, and for a keypad its firmware's run too. */
export function gerbersAudit(dir: string, zip?: string, { selfTest = false } = {}): { ok: boolean; detail: string } {
  const a = drcAudit(dir);
  if (!a.ok) return a;
  const r = readbackAudit(dir, zip, { selfTest });
  if (!r.ok) return r;
  const f = firmwareAudit(dir, { required: selfTest });
  if (!f.ok) return f;
  const boardPath = join(dir, "pcb", "board.json");
  try {
    const spec = existsSync(boardPath) ? specProblems(dir, JSON.parse(readFileSync(boardPath, "utf8")) as BoardJson) : [];
    if (spec.length) return { ok: false, detail: `bom.json and design.json do not give one board to order, so sprue verify does not pass it: ${spec.join("; ")}` };
  } catch {
    return { ok: false, detail: "pcb/board.json, bom.json or design.json is not readable: run sprue pcb" };
  }
  return { ok: true, detail: `Gerbers and drill files; ${a.detail}, and ${r.detail}${f.detail ? `; ${f.detail}` : ""} (not a fab's own check)` };
}

/** What pcb/verify.json says of the board in pcb/ now: its status ("verified", "failed" or "unverified") while it is
 * of this board (its inputs are drc.json's, which are still the board's), and "verified" only while package would
 * take the zip it passed (gerbersAudit, with the self-tests, the firmware's run and the board bom.json orders) and the
 * order folder it wrote is there and of this board and order (orderStaleness); else "stale". Undefined with none. */
export function verifyState(dir: string): string | undefined {
  const path = join(dir, "pcb", "verify.json"), drcPath = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { status?: string; inputs?: string; zip?: { name?: string } | null; order?: unknown };
    const drc = existsSync(drcPath) ? (JSON.parse(readFileSync(drcPath, "utf8")) as { inputs?: string; reads?: Reads }) : undefined;
    if (!drc || v.inputs !== drc.inputs || inputsHash(dir, drc.reads) !== drc.inputs) return "stale";
    if (v.status === "verified" && !(v.zip?.name && gerbersAudit(dir, `pcb/${v.zip.name}`, { selfTest: true }).ok)) return "stale";
    if (v.status === "verified" && v.order && (!existsSync(join(dir, "pcb", ORDER_DIR)) || orderStaleness(dir))) return "stale";
    return v.status ?? "unreadable";
  } catch {
    return "unreadable";
  }
}

/** A product with parts that are made, not bought (printed, machined, sheet metal), is assembled from them: it needs
 * the whole-product check (cad/_system.py, `sprue system`). */
export const isMade = (bom: Bom) => bom.lines.some((l) => l.process === "print" || l.process === "cnc" || l.process === "sheet");

const CHECKER = fileURLToPath(new URL("../../cad/system.py", import.meta.url));

/** The files system.json's result depends on, by their sha256 (cad/system.py `digest`): every file under cad/ (but
 * __pycache__), design.json, bom.json and pcb/*-gerbers.zip, plus `also` (the other files the run read, as system.json
 * lists them), by their paths in the product; and the checker itself as sprue:cad/system.py. */
export function systemInputs(dir: string, also: string[] = []): Record<string, string> {
  const files = cadFiles(dir);
  files.push("design.json", "bom.json");
  const pcb = join(dir, "pcb");
  if (existsSync(pcb)) files.push(...readdirSync(pcb).filter((f) => f.endsWith("-gerbers.zip")).sort().map((f) => `pcb/${f}`));
  files.push(...also.filter((k) => !k.startsWith("sprue:")));
  const out: Record<string, string> = {};
  for (const f of files) if (statSync(join(dir, f), { throwIfNoEntry: false })?.isFile()) out[f] = sha256(join(dir, f));
  out["sprue:cad/system.py"] = sha256(CHECKER);
  return out;
}
const SKIP_DIRS = new Set(["__pycache__", "node_modules"]);

/** Every file under cad/ that a result can depend on, as system.py's digest() walks it: not the caches, and not an
 * editor's dotfiles and backups (.case.py.swp, case.py~). */
function cadFiles(dir: string): string[] {
  const files: string[] = [];
  const skip = (name: string) => name.startsWith(".") || name.endsWith("~") || name.endsWith(".swp");
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (skip(e.name)) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(`${rel}/${e.name}`); }
      else if (e.isFile() || (e.isSymbolicLink() && statSync(join(dir, rel, e.name), { throwIfNoEntry: false })?.isFile())) files.push(`${rel}/${e.name}`);
    }
  };
  if (existsSync(join(dir, "cad"))) walk("cad");
  return files;
}

/** What cad/build.py exported fab/ from (fab/build.json): every cad/ file but _system.py, and design.json. A part file
 * edited after the export makes the STL and STEP in fab/ stale, though the whole-product check, which builds the
 * parts afresh, passes on the edit. */
export function exportInputs(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...cadFiles(dir).filter((f) => f !== "cad/_system.py"), "design.json"])
    if (statSync(join(dir, f), { throwIfNoEntry: false })?.isFile()) out[f] = sha256(join(dir, f));
  return out;
}

/** Why fab/<part>.stl or .step is not the export of the cad/ there is now, or undefined when it is. */
export function exportStale(dir: string, file: string): string | undefined {
  const m = /^fab\/([^/]+)\.(stl|step)$/i.exec(file.replace(/^\.\//, ""));
  if (!m || !existsSync(join(dir, "cad", `${m[1]}.py`))) return undefined;
  const path = join(dir, "fab", "build.json");
  if (!existsSync(path)) return "no fab/build.json to say which cad/ it was exported from: run sprue cad";
  try {
    const was = (JSON.parse(readFileSync(path, "utf8")) as { inputs?: Record<string, string> }).inputs ?? {}, now = exportInputs(dir);
    const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
    return changed.length ? `exported from an earlier design (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""} changed since): run sprue cad` : undefined;
  } catch {
    return "fab/build.json is not readable: run sprue cad";
  }
}

/** What system.json says of the product as it is now: every gate passed and the self-test caught each fault it put in,
 * on the CAD, design.json, bom.json and board zip there are now. A made product without cad/_system.py fails: nothing
 * else checks that its parts go together, stand up and do their physical job. */
export function systemAudit(dir: string, bom: Bom): Score["system"] {
  // A product of bought parts alone is not assembled by us, unless it has a whole-product check: then it counts.
  if (!isMade(bom) && !existsSync(join(dir, "cad", "_system.py"))) return { ok: true, detail: "nothing made, so nothing to assemble", failed: [] };
  const run = "run sprue system";
  if (!existsSync(join(dir, "cad", "_system.py")))
    return { ok: false, detail: "no cad/_system.py, so nothing checks the parts as one product: write it (reference/formats.md), then run sprue system", failed: [] };
  const path = join(dir, "system.json");
  if (!existsSync(path)) return { ok: false, detail: `no system.json: ${run}`, failed: [] };
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as SystemCheck;
    const was = s.inputs ?? {}, now = systemInputs(dir, Object.keys(was));
    const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
    if (changed.length) return { ok: false, detail: `system.json is of an earlier design (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""} changed): ${run}`, failed: [] };
    const failed = (s.gates ?? []).filter((g) => g.status !== "pass");
    if (failed.length) return { ok: false, detail: `the whole product fails ${failed.map((g) => g.id).join(", ")}: ${failed[0].detail}`, failed: failed.map((g) => g.id) };
    if (!s.selfTest?.ok) {
      const missed = (s.selfTest?.faults ?? []).filter((f) => !f.caught).map((f) => `${f.gate} (${f.fault})`);
      return { ok: false, detail: `its self-test ${missed.length ? `missed ${missed.join(", ")}` : `had no fault for ${(s.selfTest?.untested ?? []).join(", ") || "a gate"}`}, so its pass proves nothing: see system.json`, failed: [] };
    }
    if (!s.ok) return { ok: false, detail: "system.json does not say it passed", failed: [] };
    const tilt = Math.min(...(s.stability ?? []).map((p) => p.tiltDeg));
    const flags = (s.gates ?? []).reduce((n, g) => n + (g.flags?.length ?? 0), 0);
    return {
      ok: true,
      detail: `${s.parts} parts in one frame: none overlap, the contacts touch, the rest keep their gap, ${Number.isFinite(tilt) ? `it tips at ${tilt} deg at worst, ` : ""}` +
        `${(s.probes ?? []).length} function probe${(s.probes ?? []).length === 1 ? "" : "s"} pass, and its self-test catches each fault put in` +
        (flags ? `; ${flags} risk${flags === 1 ? "" : "s"} the design accepts (system.json)` : ""),
      failed: [],
    };
  } catch {
    return { ok: false, detail: `system.json is not readable: ${run}`, failed: [] };
  }
}

/** What a run writes in a product folder, by path in it; the rest is the product's own. `sprue faults` copies the
 * product without them, so a fault is found by the gates run on the copy and not read from the clean run's results. */
export const RUN_OUTPUTS = new Set(["fab", "pcb", "previews", "history", "production", "shots", "view.html", "checks.json",
  "sourcing.json", "quotes.json", "score.json", "system.json", "faults.json", "explorer.json", "figure.json", "figure.svg",
  "build-plan.md", "state.json", "firmware/fil.json", "firmware/code.sprue.py"]);

/** A product's own files, and the names in it that lead to another of them, by their paths in it: not RUN_OUTPUTS,
 * caches or an editor's dotfiles and backups. A link within the product (`board/` to `pcb/`) is a name for where it
 * leads; a link out of it counts as the files it reaches, the first time the walk reaches them, and any later name
 * for a folder or file already counted (a second link to the same folder) is a name for the first. So each real folder
 * is walked once, however its links cross, and a copy made of these keeps every name. A link to a folder the product
 * is in counts as nothing, and so does a name out of it the system cannot follow (a loop of links, or too many). */
function walkProduct(dir: string): { files: string[]; links: Record<string, string> } {
  const files: string[] = [], links: Record<string, string> = {};
  const skip = (name: string) => name.startsWith(".") || name.endsWith("~") || name.endsWith(".swp") || SKIP_DIRS.has(name);
  // Where each folder and file the walk counted really is, as the system resolves it, and the name it was counted by.
  const first = new Map<string, string>([[realpathSync.native(dir), ""]]);
  // A name can be gone by now (an editor's save file), or lead nowhere the system can follow (ELOOP): skip it.
  const quiet = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch (error) {
      if (["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
      throw error;
    }
  };
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (skip(e.name) || RUN_OUTPUTS.has(path)) continue;
      const ls = quiet(() => lstatSync(join(dir, path)));
      if (!ls) continue;
      if (ls.isSymbolicLink()) {
        const to = quiet(() => linkInProduct(dir, path));
        if (to === undefined) continue;
        if (!outsideProduct(to)) { links[path] = to; continue; }
        // A link to a folder the product is in (up -> ..) would walk it, and the product again.
        if (/^\.\.(\/\.\.)*$/.test(to)) continue;
      }
      const st = quiet(() => statSync(join(dir, path))), real = st && quiet(() => realpathSync.native(join(dir, path)));
      if (!real || !(st.isDirectory() || st.isFile())) continue;
      const was = first.get(real);
      if (was !== undefined) { links[path] = was; continue; }
      first.set(real, path);
      if (st.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk("");
  return { files, links };
}

/** A product's own files (walkProduct), by their paths in it. */
export const productFiles = (dir: string) => walkProduct(dir).files;
/** The names in a product that lead to another of its files or folders, each with the path it leads to, which a copy
 * keeps as links. */
export const productLinks = (dir: string) => walkProduct(dir).links;

const SKILL = fileURLToPath(new URL("../../", import.meta.url));

/** One sha256 over the code of Sprue's gates: pipeline/ (not its tests), cad/ and bin/. */
function gatesDigest(): string {
  const h = createHash("sha256");
  const walk = (rel: string) => {
    for (const e of readdirSync(join(SKILL, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name) || e.name.endsWith(".test.ts")) continue;
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else if (e.isFile()) h.update(`${rel}/${e.name}\0`).update(readFileSync(join(SKILL, rel, e.name))).update("\0");
    }
  };
  for (const d of ["pipeline", "cad", "bin"]) if (existsSync(join(SKILL, d))) walk(d);
  return h.digest("hex");
}

/** The firmware `sprue pcb` wrote (it says so), which each copy's run writes again from its board. */
const OWN_FIRMWARE = /`(sprue|distinta) pcb [\w-]+` wrote it/;

/** The files faults.json's result depends on, by their sha256: every file of the product's own (productFiles), which
 * is what each copy starts from, reference/faults.json among them, but the firmware `sprue pcb` wrote (a user's own
 * code.py counts); each name for another of them (productLinks), by where it leads; and the code of the gates as
 * sprue:gates. */
export function faultsInputs(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const { files, links } = walkProduct(dir);
  for (const f of files) {
    if ((f === "firmware/code.py" || f === "firmware/README.md") && OWN_FIRMWARE.test(readFileSync(join(dir, f), "utf8"))) continue;
    out[f] = sha256(join(dir, f));
  }
  for (const [name, to] of Object.entries(links)) out[name] = `-> ${to}`;
  out["sprue:gates"] = gatesDigest();
  return out;
}

/** What faults.json says of the product as it is now, when reference/faults.json lists faults to seed: every fault
 * caught, none of the clean design's problems unknown, on the files and the gates there are now. */
export function faultsAudit(dir: string): Score["faults"] {
  if (!existsSync(join(dir, "reference", "faults.json"))) return undefined;
  const none = { ran: 0, caught: 0, pct: 0, missed: [], falseAlarms: 0 };
  const path = join(dir, "faults.json"), run = "run sprue faults";
  if (!existsSync(path)) return { ok: false, detail: `no faults.json: ${run}`, ...none };
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as FaultsReport;
    const n = { ran: r.ran, caught: r.caught, pct: r.pct, missed: r.missed ?? [], falseAlarms: r.falseAlarms };
    const was = r.inputs ?? {}, now = faultsInputs(dir);
    const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
    const then = `it caught ${r.caught} of ${r.ran} then`;
    if (changed.length === 1 && changed[0] === "sprue:gates") return { ok: false, detail: `faults.json was measured on earlier code of Sprue's gates (${then}): ${run}`, ...n };
    if (changed.length) return { ok: false, detail: `faults.json is of an earlier design (${changed.filter((k) => k !== "sprue:gates").slice(0, 3).join(", ")}${changed.length > 3 ? ", ..." : ""} changed; ${then}): ${run}`, ...n };
    const alarms = `${r.falseAlarms} false alarm${r.falseAlarms === 1 ? "" : "s"} on the clean design`;
    const skipped = r.cases.filter((c) => !c.ran).length;
    return {
      ok: r.ok,
      detail: `${r.caught} of ${r.ran} seeded faults caught (${r.pct}%)${r.missed.length ? `, missed ${r.missed.join(", ")}` : ""}, ${alarms}` +
        (skipped ? `; ${skipped} could not be put in` : "") + (r.control?.stale?.length ? `; the clean copy's run skipped a stage (faults.json)` : ""),
      ...n,
    };
  } catch {
    return { ok: false, detail: `faults.json is not readable: ${run}`, ...none };
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
      const p = resolve(dir, l.file!);
      // A board whose build failed has no zip but does have a drc.json that says why.
      if (isBoardLine(dir, l) && (existsSync(p) || existsSync(join(dir, "pcb", "drc.json")))) {
        // The read-back's and the firmware's self-tests too: a pass that was never shown to catch a fault counts for nothing.
        const a = gerbersAudit(dir, l.file, { selfTest: true });
        return existsSync(p) ? { name: l.file!, ok: a.ok, detail: a.detail } : { name: l.file!, ok: false, detail: a.ok ? "not generated yet" : a.detail };
      }
      if (!existsSync(p)) return { name: l.file!, ok: false, detail: "not generated yet" };
      const stale = exportStale(dir, l.file!);
      if (stale) return { name: l.file!, ok: false, detail: stale };
      if (p.toLowerCase().endsWith(".stl")) {
        const m = meshAudit(p);
        const priced = volumeMismatch(m.volumeCm3, l.spec.volumeCm3);
        if (m.ok && priced) return { name: l.file!, ok: false, detail: `${priced}: copy the volume sprue cad prints for it (or the mesh's, for a part not built from cad/) into ${l.id}'s spec.volumeCm3, then run sprue all so the quote prices it` };
        return { name: l.file!, ok: m.ok, detail: m.detail };
      }
      return { name: l.file!, ok: true, detail: "present" };
    });

  // Every line the batch needs must carry a price: one the quote could not price (a CNC or sheet-metal part has no
  // fab adapter yet, a bought part no offer) or that is missing from an older quotes.json would count as $0.
  const priced = new Set((quotes.lines ?? []).map((q) => q.lineId));
  const unpriced = bom.lines.filter((l) => batchNeed(l, bom.units) > 0 && !priced.has(l.id)).map((l) => l.id);

  const coveragePct = Math.round((matched.length / want.length) * 1000) / 10;
  const withinBand = Math.abs(deltaPct) <= 25;
  const system = systemAudit(dir, bom);
  const faults = faultsAudit(dir);
  return {
    slug: bom.slug,
    coverage: { matched, missing, extra, pct: coveragePct },
    checks: { failed: checks.failed, flagged: checks.flagged, ran: checks.checks?.length ?? 0, skipped: (checks.skipped ?? []).map((c) => c.id) },
    cost: { batchUsd: quotes.batchUsd, referenceMidUsd: mid, deltaPct, withinBand, unpriced },
    files,
    system,
    ...(faults ? { faults } : {}),
    // The seeded faults are not part of the pass yet: that changes the metric, which is Tobias's call (PLAN.md).
    pass: coveragePct >= 90 && checks.failed === 0 && withinBand && !unpriced.length && files.every((f) => f.ok) && system.ok,
  };
}

/** score.json with its whole-product check and seeded faults as system.json, faults.json and the files say now:
 * `sprue system`, `sprue cad` and `sprue faults` rewrite them without scoring again, and the page must not show the
 * pass of an earlier check. */
export function withSystem(s: Score, dir: string, bom: Bom): Score {
  const system = systemAudit(dir, bom);
  const others = s.coverage.pct >= 90 && s.checks.failed === 0 && s.cost.withinBand && !s.cost.unpriced?.length && s.files.every((f) => f.ok);
  // faults is undefined, so left out of the JSON, for a product with no reference/faults.json.
  return { ...s, system, faults: faultsAudit(dir), pass: others && system.ok };
}
