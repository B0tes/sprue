// Sprue's 3D view: previews/system.glb, the product as the whole-product check placed it, to turn and pick parts in.
// Read-only for now:
//   drag              turns it; right-drag or shift-drag pans, a pinch zooms, and so does the wheel once the view has
//                     focus (a click gives it), or with Ctrl or ⌘ held: until then the wheel scrolls the page (three.js
//                     OrbitControls)
//   Fit, F            frames the whole product again
//   ← → ↑ ↓, + -      turn, tilt and zoom from the keyboard, while the view has focus
//   hover a part      it lights, every other part steps down a tone, and the readout says what it is
//   click or tap it   pins it (again, or on nothing, unpins): the panel says what it is (its line, how it is drawn,
//                     material, mass, size), the problems and accepted risks of the whole-product check that name it,
//                     what it meets (fits, contacts, gaps the design allows, the case it is meant to be inside or the
//                     parts it is meant to hold) and its line's files that are in the product folder; a part it meets
//                     is a button. With nothing pinned the panel says whether the check passes, which gates fail
//                     and on which parts, the parts the risks it accepts are on, and its problems of no one part.
//                     Every panel says what the check couldn't: a gate that couldn't run, problems it doesn't list,
//                     a self-test that missed a fault, a check of an earlier design
//   the Part list     pins a part from the keyboard, or where there is no 3D
//   E, Take apart     every part eases out along its move in the drawing's apart pose (figure.json's lifts), staggered
//                     by assembly step, and back; the camera follows, framing what is shown
//   [ ], the stepper  walk the drawing's assembly steps: earlier steps in place, this one lit, later ones lifted away
//                     and gone; Home and End (while the view has focus) go to the whole product and the last step
//   Escape            unpins, then lets go of a line, then of the steps and the apart pose
// It and the drawing (figure.js) on one page keep each other's pose: each says "a2:select" { line, part } when a part
// is pinned (the drawing, which draws lines, says only line), "a2:hover" { line, part } when one is pointed at,
// "a2:step" { n } and "a2:apart" { on }, and each shows what the other says. A line chosen elsewhere lights all its
// parts, with a panel of the line; one part of it lights alone. The page's hash starts it in a pose:
// #apart #step=3 #part=sw5 #select=sw (a line), combined with &, as the drawing reads them (it leaves part to this).
// Solid edges are parts drawn from their own CAD, dashed ones envelopes: bought parts as stand-in shapes (boxes,
// cylinders, cones, prisms) at the sizes their datasheets or estimates give. Each part's creases are drawn, and its outline from where the camera is, so
// a rounded shell keeps its edge. The legend says so and names the BOM lines that are not in the model. Without WebGL 2
// the view says so and keeps the list and the panel. Nothing draws until something changes, so nothing runs offscreen,
// and reduced motion jumps instead of easing. The colours are the drawing kit's (--anatomy-*), read again when the theme
// changes.
// It imports nothing: mountModel takes three as an argument ({ THREE, OrbitControls, GLTFLoader }, the vendored
// modules in viewer/vendor/three/), so the page loads three as it can. What the panel says (panelOf, readoutOf,
// legendOf, wholeOf, partsList) is plain functions of the data pipeline/model.ts makes; prepare, outline, frameOf,
// planesOf, between and pickAt need three but no page. Tests call all of them in Node.

const PROCESS = { buy: "bought", print: "printed", pcb: "PCB", cnc: "machined", sheet: "sheet metal" };
/** The view the camera starts from, in the model's frame (glTF: y up, z toward the viewer): from the front, to the
 * right and above, as build.py draws each part's preview, (1, -1, 0.8) in the product's frame with z up. */
const VIEW_FROM = [1, 0.8, 1];
const FOV = 30; // degrees; a long lens keeps the parts near the drawing's shapes
const EDGE_DEG = 30; // a crease sharper than this between faces is drawn as an edge
const DASH = [1.2, 0.8]; // mm, an envelope's dashed edges
const MOVED = 5; // px a pointer may stray from where it went down and still click
const FIT_S = 0.45; // seconds the camera takes to frame the product
const ZOOM = 1.25; // how far + and - move the camera in or out
const STILL = 1e-4; // a camera that moves less than this share of its distance from what it looks at in a frame is still
const HOLDS_SHOWN = 10; // parts a case part's "Meant to hold" row shows before "and N more"
/** The drawing's exploded-view spring (figure.js): just under critical, so parts land with a hint of weight. */
const SPRING = { stiffness: 64, damping: 14.2, substeps: 4, stagger: 0.045 };
const FADE = 0.14; // seconds, opacity follow for steps that come and go

/** The kit's tokens, read from the page (with the dark theme's values where a page has none). */
const TOKENS = {
  face: ["--anatomy-face", "#1b1b1b"], top: ["--anatomy-lit-top", "#262626"], paper: ["--anatomy-paper", "#131313"],
  hi: ["--anatomy-hi", "#d4d4d4"], mid: ["--anatomy-mid", "#6a6a6a"], lo: ["--anatomy-lo", "#3e3e3e"],
  faint: ["--anatomy-faint", "#2a2a2a"], lit: ["--anatomy-lit", "#ffffff"],
};

/**
 * The view's data, as pipeline/model.ts modelView makes it.
 * @typedef {{ id: string, line: string | null, model: string, material: string | null, tags: string[],
 *   massG: number | null, massNote: string, estimated: boolean, bbox: number[] | null }} Item
 * @typedef {{ a: string, b: string, pairs: [string, string][] | null }} Pairing
 * @typedef {{ fits?: (Pairing & { why: string })[], contacts?: (Pairing & { why: string, gap: number | null })[],
 *   gaps?: (Pairing & { mm: number, accept: string })[],
 *   inside?: { items: string, within: string[], why: string, parts: string[], case: string[] }[],
 *   unplaced?: Record<string, string> }} Relations
 * @typedef {{ name: string, short?: string, process: string, qtyPerUnit: number, qtyPerBatch?: number }} Line
 * @typedef {{ path: string, what: string }} File
 * @typedef {{ gate: string, title: string, text: string, parts: string[], at: number[] | null, accepted: boolean }} Problem
 * @typedef {{ id: string, title: string, status: string, problems: number, listed: number, ran: boolean }} Gate
 * @typedef {{ slug: string, model: { file: string, inputs: string, triangles: number }, minClearanceMm: number | null,
 *   items: Item[], relations: Relations, problems: Problem[], gates?: Gate[], ok?: boolean,
 *   selfTest?: { ok: boolean, missed: string[], untested: string[] }, stale?: string[], bom?: boolean,
 *   lines: Record<string, Line>, files: Record<string, File[]>, assembly?: Assembly | null,
 *   stability?: { pose: string, massG: number, estimatedG: number, com: number[], tiltDeg: number | null } | null }} View
 * @typedef {{ steps: { n: number, text: string }[], parts: Record<string, { step: number, lift: number[] }>,
 *   unsure: Record<string, string> }} Assembly
 * @typedef {{ kind: "fit" | "contact" | "gap" | "inside" | "holds", with: string[], why: string }} Meet
 * @typedef {{ gate: string, title: string, text: string, accepted: boolean }} Shown
 * @typedef {{ label: string, text: string }} Note
 * @typedef {{ id: string, title: string, sub: string, count: string, facts: [string, string][], meets: Meet[],
 *   problems: Shown[], notes: Note[], files: File[], filesNote: string }} Panel
 * @typedef {{ gate: string, title: string, problems: number, parts: string[] }} Failing
 */

/** @param {number} n @param {number} [d] */
const fmt = (n, d = 1) => String(Number(n.toFixed(d)));
/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- what the panel says: plain functions of the view's data (pipeline/model.ts) -----------------------------------

/** The item by its id, or undefined. @param {View} view @param {string} id @returns {Item | undefined} */
export const itemOf = (view, id) => view.items.find((i) => i.id === id);

/** The item's place among the parts of its line in the frame ({ k, n }), when its line has more than one.
 * @param {View} view @param {Item} item */
function countOf(view, item) {
  if (!item.line) return null;
  const same = view.items.filter((i) => i.line === item.line);
  return same.length > 1 ? { k: same.indexOf(item) + 1, n: same.length } : null;
}

/** How a part is made, in the drawing's words, or what is known of its line when the BOM doesn't say.
 * @param {View} view @param {Item} item */
function madeOf(view, item) {
  const line = item.line ? view.lines[item.line] : undefined;
  if (line) return PROCESS[line.process] || line.process;
  if (!item.line) return "not a BOM line";
  return view.bom === false ? `line ${item.line}` : `${item.line}, not in the BOM`;
}

/** A part as a few words: its line's short name, and its number when the line has several ("Keycap 6").
 * @param {View} view @param {string} id @returns {string} */
export function labelOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return id;
  const line = item.line ? view.lines[item.line] : undefined;
  if (!line) return item.id; // its id has its number already
  const c = countOf(view, item);
  return `${line.short || line.name}${c ? ` ${c.k}` : ""}`;
}

/** What the readout says of a part, in the drawing's words: "Keycap 6 of 9 · bought · envelope".
 * @param {View} view @param {string} id @returns {string} */
export function readoutOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return "";
  const line = item.line ? view.lines[item.line] : undefined;
  const c = line ? countOf(view, item) : null;
  return [`${line ? line.short || line.name : item.id}${c ? ` ${c.k} of ${c.n}` : ""}`, madeOf(view, item),
    item.model === "envelope" ? "envelope" : "CAD"].join(" · ");
}

/** Whether a problem of the gate, not one the design accepts, names every part of `ids`.
 * @param {View} view @param {string} gate @param {string[]} ids */
const fails = (view, gate, ids) => view.problems.some((p) => !p.accepted && p.gate === gate && ids.every((i) => p.parts.includes(i)));

/** Each relation of system.json that names the part, as the panel lists it: what (fit, contact, gap, inside, holds),
 * the other parts, and why. A fit's, a contact's and a gap's parts are those the gates found meeting; a relation whose
 * gate couldn't run (its pairs null) names none. An inside is the design's intent, which the inside gate checks, so its
 * row says where the check finds the part outside.
 * @param {View} view @param {string} id @returns {Meet[]} */
function meetsOf(view, id) {
  const r = view.relations || {};
  /** @type {Meet[]} */
  const out = [];
  /** @param {[string, string][] | null} pairs */
  const others = (pairs) => (pairs || []).filter((p) => p.includes(id)).map((p) => (p[0] === id ? p[1] : p[0]));
  /** @param {string[]} ids */
  const names = (ids) => ids.map((x) => labelOf(view, x)).join(", ");
  for (const f of r.fits || []) { const w = others(f.pairs); if (w.length) out.push({ kind: "fit", with: w, why: f.why }); }
  for (const c of r.contacts || []) {
    const w = others(c.pairs);
    if (!w.length) continue;
    // Beside where they touch, their other faces must keep the contact's gap, or the rule's when it gives none (0: they
    // need only not overlap); the clearance gate fails a pair closer than that, and its problem says where.
    const keep = c.gap != null ? c.gap : view.minClearanceMm;
    const rule = keep > 0 ? `elsewhere their faces must keep ${fmt(keep, 2)} mm apart${c.gap == null ? ", the rule for every pair" : ""}` : "";
    const failed = w.filter((o) => fails(view, "clearance", [id, o]));
    out.push({ kind: "contact", with: w, why: [[c.why, rule].filter(Boolean).join("; "),
      failed.length ? `The check finds ${failed.length === w.length && w.length === 1 ? "them" : names(failed)} closer than that beside where they touch: see the problem` : ""].filter(Boolean).join(". ") });
  }
  for (const g of r.gaps || []) {
    const w = others(g.pairs);
    if (!w.length) continue;
    // A Gap is the design's floor for the pair and its reason; the clearance gate fails a pair under it, or one with no
    // reason, and its problem says how far apart they are.
    const accept = String(g.accept || "").trim();
    const rule = view.minClearanceMm != null ? `, where the rule for other pairs is ${fmt(view.minClearanceMm, 2)} mm` : "";
    const failed = w.filter((o) => fails(view, "clearance", [id, o]));
    out.push({ kind: "gap", with: w, why: `down to ${fmt(g.mm, 2)} mm${rule}: ${accept || "the design gives no reason, so it isn't accepted"}${
      failed.length ? `. The check fails it with ${names(failed)}: see the problem` : ""}` });
  }
  // What a case part holds is one row of every part meant to be inside it: each Inside's why only names its parts again.
  /** @type {string[]} */
  const holds = [];
  for (const s of r.inside || []) {
    if ((s.parts || []).includes(id)) {
      out.push({ kind: "inside", with: s.case || [], why: [s.why, fails(view, "inside", [id]) ? "The check finds it outside: see the problem" : ""].filter(Boolean).join(". ") });
    }
    if ((s.case || []).includes(id)) for (const p of s.parts || []) if (p !== id && !holds.includes(p)) holds.push(p);
  }
  const out_ = holds.filter((p) => fails(view, "inside", [p]));
  if (holds.length) out.push({ kind: "holds", with: holds, why: out_.length ? `The check finds ${names(out_)} outside: see ${out_.length === 1 ? "its panel" : "their panels"}` : "" });
  return out;
}

/** The part's mass as the stability gate weighs it, with how it was found. @param {Item} item */
function massOf(item) {
  if (item.massG == null) return `not known: ${item.massNote || "no mass"}`;
  return `${fmt(item.massG, 2)} g${item.massNote ? `, ${item.massNote}` : ""}`;
}

/** What the check can't put on any one part's panel: a gate that couldn't run, a gate's problems beyond the 200
 * system.json lists, and faults its self-test missed. `part`: said on a part's panel, which may be among them.
 * @param {View} view @param {boolean} part @returns {Note[]} */
function notesOf(view, part) {
  /** @type {Note[]} */
  const out = [];
  const stale = view.stale || [];
  if (stale.length) {
    out.push({ label: "Out of date", text: `The check ran on an earlier design (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""} changed since), so what it says${part ? " of this part" : ""} may not hold now: run sprue system again.` });
  }
  for (const g of view.gates || []) {
    if (!g.ran) out.push({ label: "Not checked", text: `${g.title} couldn't run, so it checked no part${part ? ", this one too" : ""}.` });
    else if (g.status === "fail" && g.problems > g.listed) {
      out.push({ label: "Not listed", text: `${plural(g.problems - g.listed, "more problem")} of “${g.title}” ${g.problems - g.listed === 1 ? "isn't" : "aren't"} listed by part${part ? ": this part may be among them" : ""}.` });
    }
  }
  const st = view.selfTest;
  if (st && !st.ok) {
    const what = [st.missed.length ? `missed ${plural(st.missed.length, "fault")} it plants (${st.missed.join("; ")})` : "",
      st.untested.length ? `has no fault for ${st.untested.join("; ")}` : ""].filter(Boolean).join(" and ");
    out.push({ label: "Not proven", text: `The check's self-test ${what || "did not pass"}, so a gate it names may pass what it should fail.` });
  }
  return out;
}

/** What the panel shows of a part: { id, title, sub, count, facts: [[label, text]], meets, problems, notes, files }, or
 * null. Only problems that name the part are listed, with what the check couldn't say of any part, so a part of a
 * product that fails never reads as passing.
 * @param {View} view @param {string} id @returns {Panel | null} */
export function panelOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return null;
  const line = item.line ? view.lines[item.line] : undefined;
  const c = countOf(view, item);
  const env = item.model === "envelope";
  /** @type {[string, string][]} */
  const facts = [["Drawn", env
    ? "as an envelope: stand-in shapes (boxes, cylinders, cones, prisms) at the sizes its datasheet or an estimate gives, not its maker's model"
    : "from its own CAD"]];
  if (item.material) facts.push(["Material", item.material]);
  facts.push(["Mass", massOf(item)]);
  if (Array.isArray(item.bbox) && item.bbox.length === 6) {
    const [x0, y0, z0, x1, y1, z1] = item.bbox;
    facts.push(["Size", `${fmt(x1 - x0)} × ${fmt(y1 - y0)} × ${fmt(z1 - z0)} mm (x, y, z)${env ? ", of what is drawn" : ""}`]);
  }
  if (item.tags && item.tags.length) facts.push(["Tags", item.tags.join(", ")]);
  if (line) facts.push(["In the BOM", `${line.qtyPerUnit || !line.qtyPerBatch ? `${line.qtyPerUnit ?? 1} a unit` : `${line.qtyPerBatch} for the batch`} (${item.line})`]);
  else if (item.line && view.bom === false) facts.push(["In the BOM", `bom.json could not be read (line ${item.line})`]);
  const problems = view.problems.filter((p) => p.parts.includes(id)).map((p) => ({ gate: p.gate, title: p.title, text: p.text, accepted: p.accepted }));
  const n = problems.filter((p) => !p.accepted).length, a = problems.length - n;
  const notes = notesOf(view, true);
  const files = (item.line && view.files[item.line]) || [];
  return {
    id: item.id,
    title: line ? line.name : item.id,
    sub: [item.id, line && c ? `${c.k} of ${c.n}` : "", madeOf(view, item)].filter(Boolean).join(" · "),
    count: [n ? plural(n, "problem") : "", a ? plural(a, "accepted risk") : "", notes.length ? plural(notes.length, "caveat") : ""]
      .filter(Boolean).join(" · "),
    facts,
    meets: meetsOf(view, id),
    problems,
    notes,
    files,
    filesNote: files.length ? "" : view.bom === false ? "Its files can't be known without bom.json." : "None of its own in the product folder.",
  };
}

/** What the panel shows with nothing pinned: whether the check passes (`summary`, `ok`), each gate that fails with
 * how many problems it has and the parts they name, each gate with risks the design accepts on parts and those parts
 * (`accepted`), its problems and accepted risks of no one part (a part's panel lists the rest), and what it couldn't
 * say of any part.
 * @param {View} view
 * @returns {{ ok: boolean, summary: string, failing: Failing[], accepted: Failing[], problems: Shown[], notes: Note[] }} */
export function wholeOf(view) {
  const ids = new Set(view.items.map((i) => i.id));
  const gates = view.gates || [];
  /** A gate's problems, or its accepted risks, that name parts in the frame: how many, and those parts. */
  const onParts = (g, accepted) => {
    /** @type {string[]} */
    const parts = [];
    let k = 0;
    for (const p of view.problems) {
      if (p.accepted !== accepted || p.gate !== g.id || !p.parts.some((x) => ids.has(x))) continue;
      k++;
      for (const x of p.parts) if (ids.has(x) && !parts.includes(x)) parts.push(x);
    }
    return { gate: g.id, title: g.title, problems: k, parts };
  };
  /** @type {Failing[]} */
  const failing = gates.filter((g) => g.status === "fail").map((g) => ({ ...onParts(g, false), problems: g.problems }));
  /** @type {Failing[]} */
  const accepted = gates.map((g) => onParts(g, true)).filter((g) => g.problems);
  const notes = notesOf(view, false);
  const ok = view.ok !== false && !failing.length && !notes.length;
  const n = failing.reduce((s, g) => s + g.problems, 0);
  const on = new Set(failing.flatMap((g) => g.parts)).size;
  const risks = view.problems.filter((p) => p.accepted).length;
  // A check of an earlier design says what it found then.
  const then = (view.stale || []).length > 0;
  const summary = !gates.length ? ""
    : failing.length ? `${then ? "On an earlier design it failed" : "It fails"} ${failing.length} of its ${plural(gates.length, "gate")}, with ${plural(n, "problem")}${on ? ` on ${plural(on, "part")}: pick one to see its own` : ""}.`
    : `${then ? "On an earlier design it passed" : "It passes"} all ${plural(gates.length, "gate")}${risks ? `, with ${plural(risks, "risk")} the design accepts` : ""}${
      then ? "; the design has changed since: see below" : notes.length ? ", but not all of it is proven: see below"
        : view.ok === false ? ", but system.json says it fails: run sprue system again" : ""}.`;
  return {
    ok,
    summary,
    failing,
    accepted,
    problems: view.problems.filter((p) => !p.parts.some((x) => ids.has(x)))
      .map((p) => ({ gate: p.gate, title: p.title, text: p.text, accepted: p.accepted })),
    notes,
  };
}

/** The legend: how many parts are drawn from CAD and how many are envelopes, the BOM lines not in the model (those
 * the check says it doesn't place, with its reason, and any other line no part in the frame is of: a line for the
 * batch, such as a reel of wire, or one the check lost), and the lines whose parts don't follow the drawing's steps
 * and apart pose, with why (`unsure`; `steps` false when there is no drawing to follow at all).
 * @param {View} view @returns {{ cad: number, envelopes: number, unplaced: { line: string, name: string, why: string }[],
 *   steps: boolean, unsure: { line: string, name: string, why: string }[] }} */
export function legendOf(view) {
  const envelopes = view.items.filter((i) => i.model === "envelope").length;
  const said = (view.relations && view.relations.unplaced) || {};
  const unplaced = Object.entries(said).map(([line, why]) => ({ line, name: view.lines[line] ? view.lines[line].name : line, why }));
  const drawn = new Set(view.items.map((i) => i.line));
  for (const [id, line] of Object.entries(view.lines || {})) {
    if (drawn.has(id) || id in said) continue;
    unplaced.push({ line: id, name: line.name, why: !line.qtyPerUnit && line.qtyPerBatch ? "for the batch, not a unit: not drawn" : "no part of it is in the frame" });
  }
  const a = view.assembly;
  const unsure = a ? Object.entries(a.unsure || {}).map(([line, why]) => ({ line, name: view.lines[line] ? view.lines[line].name : line, why })) : [];
  return { cad: view.items.length - envelopes, envelopes, unplaced, steps: Boolean(a && a.steps.length), unsure };
}

/** The drawing's assembly steps, in order ({ n, text }), or none. @param {View} view */
export const stepsOf = (view) => (view.assembly && Array.isArray(view.assembly.steps) ? view.assembly.steps : []);

/** The step that puts a part in and its move in the apart pose (mm, the frame's axes): a part the drawing can't place
 * is in from the first step and doesn't move. @param {View} view @param {string} id @returns {{ step: number, lift: number[] }} */
export function placeOf(view, id) {
  const p = view.assembly && view.assembly.parts ? view.assembly.parts[id] : undefined;
  if (p && Number.isFinite(p.step) && Array.isArray(p.lift) && p.lift.length === 3 && p.lift.every(Number.isFinite)) return p;
  const s = stepsOf(view);
  return { step: s.length ? s[0].n : 1, lift: [0, 0, 0] };
}

/** What the readout says on step `at` (1 to the number of steps) with nothing lit: "Step 3 of 9 · Solder the Pico".
 * @param {View} view @param {number} at */
export function stepReadoutOf(view, at) {
  const s = stepsOf(view);
  const step = s[at - 1];
  return step ? `Step ${at} of ${s.length}${step.text ? ` · ${step.text}` : ""}` : "";
}

/** The parts in the frame of a BOM line, by id, in the frame's order. @param {View} view @param {string} line */
export const partsOfLine = (view, line) => view.items.filter((i) => i.line === line).map((i) => i.id);

/** What the readout says of a line chosen elsewhere: "Keycap · 9 parts · bought", or that it isn't in the model.
 * @param {View} view @param {string} line */
export function lineReadoutOf(view, line) {
  const l = view.lines[line];
  const n = partsOfLine(view, line).length;
  return [l ? l.short || l.name : line, n ? plural(n, "part") : "not in the model", l ? PROCESS[l.process] || l.process : ""].filter(Boolean).join(" · ");
}

/** What the panel shows of a line chosen elsewhere (a row of the drawing's parts list, a BOM row): its name, its parts
 * in the frame (each a button, so one can be pinned), the problems and accepted risks that name any of them, each once,
 * what the check couldn't say, and its files; a line with no part in the frame says why. null for a line the view
 * doesn't know.
 * @param {View} view @param {string} line */
export function linePanelOf(view, line) {
  const l = view.lines[line];
  const parts = partsOfLine(view, line);
  if (!l && !parts.length) return null;
  const problems = view.problems.filter((p) => p.parts.some((x) => parts.includes(x)))
    .map((p) => ({ gate: p.gate, title: p.title, text: p.text, accepted: p.accepted }));
  const n = problems.filter((p) => !p.accepted).length, a = problems.length - n;
  const notes = parts.length ? notesOf(view, true) : [];
  const files = view.files[line] || [];
  const missing = parts.length ? "" : (legendOf(view).unplaced.find((u) => u.line === line) || { why: "no part of it is in the frame" }).why;
  return {
    line,
    title: l ? l.name : line,
    sub: [line, parts.length ? `${plural(parts.length, "part")} in the model` : "not in the model", l ? PROCESS[l.process] || l.process : ""].filter(Boolean).join(" · "),
    count: [n ? plural(n, "problem") : "", a ? plural(a, "accepted risk") : "", notes.length ? plural(notes.length, "caveat") : ""].filter(Boolean).join(" · "),
    parts,
    problems,
    notes,
    missing,
    files,
    filesNote: files.length ? "" : view.bom === false ? "Its files can't be known without bom.json." : "None of its own in the product folder.",
  };
}

/** The pose a page's hash asks for, as the drawing reads it: #apart, #step=3, #part=<a part's id> (this view's),
 * #select=<a BOM line> (the drawing's), combined with &. A step past the last is the last; a part or line the view
 * doesn't know is none.
 * @param {string} hash @param {View} view @returns {{ apart: boolean, at: number, part: string | null, line: string | null }} */
export function hashOf(hash, view) {
  const out = { apart: false, at: 0, part: null, line: null };
  const decode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const n = stepsOf(view).length;
  for (const token of String(hash || "").replace(/^#/, "").split("&").filter(Boolean)) {
    const cut = token.indexOf("=");
    const key = decode(cut < 0 ? token : token.slice(0, cut)), value = cut < 0 ? undefined : decode(token.slice(cut + 1));
    if (key === "apart") out.apart = value !== "0";
    else if (key === "step") out.at = Math.max(0, Math.min(n, parseInt(value, 10) || 0));
    else if (key === "part") out.part = value && view.items.some((i) => i.id === value) ? value : null;
    else if (key === "select") out.line = value && (Object.hasOwn(view.lines, value) || view.items.some((i) => i.line === value)) ? value : null;
  }
  return out;
}

/** The Part list: the frame's parts by BOM line, in the order the frame has them.
 * @param {View} view @returns {{ line: string | null, name: string, items: { id: string, label: string }[] }[]} */
export function partsList(view) {
  /** @type {{ line: string | null, name: string, items: { id: string, label: string }[] }[]} */
  const groups = [];
  for (const item of view.items) {
    const name = item.line && view.lines[item.line] ? view.lines[item.line].name : item.line || "Not a BOM line";
    let g = groups.find((x) => x.line === item.line);
    if (!g) groups.push((g = { line: item.line, name, items: [] }));
    const n = view.problems.filter((p) => !p.accepted && p.parts.includes(item.id)).length;
    const label = labelOf(view, item.id);
    g.items.push({ id: item.id, label: `${label === item.id ? label : `${label} (${item.id})`}${n ? ` · ${plural(n, "problem")}` : ""}` });
  }
  return groups;
}

/** A link to a file of the product from a page in its folder: each name encoded, so a '#', '?' or '%' in it, or a
 * name that reads as a scheme ('javascript:…'), stays a file name. A page's opts.fileHref can be this.
 * @param {string} path a path in the folder, as model.ts lists it */
export const fileLink = (path) => `./${path.split("/").map(encodeURIComponent).join("/")}`;

// ---- the model: three, but no page ---------------------------------------------------------------------------------

/** The edges of a mesh's geometry across which its faces turn less than EDGE_DEG (a crease is drawn as an edge
 * already), each with both faces' normals: { a, b, n1, n2 } of 3 floats an edge, and their count. Where one face is
 * toward the camera and the other away, the edge is on the outline: a fillet's, a cylinder's side. Vertices at one
 * place are one, so an edge between two faces of the CAD (whose vertices the model keeps apart) is found too. */
function outlineEdges(geometry) {
  const pos = geometry.attributes.position, index = geometry.index;
  const tris = (index ? index.count : pos.count) / 3;
  const corner = (i) => (index ? index.getX(i) : i);
  // One id a place, as EdgesGeometry rounds them.
  const place = new Map(), id = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const k = `${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
    let n = place.get(k);
    if (n === undefined) place.set(k, (n = place.size));
    id[v] = n;
  }
  const normals = new Float32Array(tris * 3);
  const edges = new Map(); // id a * places + id b (a < b) -> [vertex a, vertex b, face, other face or -1, or -2 for 3+]
  const places = place.size;
  for (let t = 0; t < tris; t++) {
    const v = [corner(3 * t), corner(3 * t + 1), corner(3 * t + 2)];
    const ax = pos.getX(v[0]), ay = pos.getY(v[0]), az = pos.getZ(v[0]);
    const ux = pos.getX(v[1]) - ax, uy = pos.getY(v[1]) - ay, uz = pos.getZ(v[1]) - az;
    const wx = pos.getX(v[2]) - ax, wy = pos.getY(v[2]) - ay, wz = pos.getZ(v[2]) - az;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (!len) continue; // no area, no side
    nx /= len; ny /= len; nz /= len;
    normals[3 * t] = nx; normals[3 * t + 1] = ny; normals[3 * t + 2] = nz;
    for (let j = 0; j < 3; j++) {
      const p = v[j], q = v[(j + 1) % 3];
      if (id[p] === id[q]) continue;
      const key = id[p] < id[q] ? id[p] * places + id[q] : id[q] * places + id[p];
      const e = edges.get(key);
      if (!e) edges.set(key, [p, q, t, -1]);
      else e[3] = e[3] === -1 ? t : -2;
    }
  }
  const cos = Math.cos((EDGE_DEG * Math.PI) / 180);
  const keep = [...edges.values()].filter((e) => e[3] >= 0 &&
    normals[3 * e[2]] * normals[3 * e[3]] + normals[3 * e[2] + 1] * normals[3 * e[3] + 1] + normals[3 * e[2] + 2] * normals[3 * e[3] + 2] >= cos);
  const out = { a: new Float32Array(keep.length * 3), b: new Float32Array(keep.length * 3),
    n1: new Float32Array(keep.length * 3), n2: new Float32Array(keep.length * 3), count: keep.length };
  keep.forEach(([p, q, f, g], i) => {
    out.a.set([pos.getX(p), pos.getY(p), pos.getZ(p)], 3 * i);
    out.b.set([pos.getX(q), pos.getY(q), pos.getZ(q)], 3 * i);
    out.n1.set(normals.subarray(3 * f, 3 * f + 3), 3 * i);
    out.n2.set(normals.subarray(3 * g, 3 * g + 3), 3 * i);
  });
  return out;
}

/** Readies the loaded model to draw: each mesh gets smooth normals (the model has none, so each face shades smooth and
 * each edge stays sharp), a material of its own in the kit's tones (a board keeps its picture), its creases and an
 * outline it draws from where the camera is (outline below), both dashed for an envelope. Returns the meshes named by
 * an item, by its id (the node's name in the GLB, which GLTFLoader keeps in userData.name); every mesh has its part in
 * userData.sprue, so a node no item names is drawn but not picked. */
export function prepare(three, scene, colors, ids) {
  const { THREE } = three;
  const parts = new Map();
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const was = mesh.material;
    const kind = was && was.name === "envelope" ? "envelope" : was && was.map ? "board" : "cad";
    const name = typeof mesh.userData.name === "string" ? mesh.userData.name : mesh.name;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    mesh.material = new THREE.MeshLambertMaterial({
      color: 0xffffff, map: kind === "board" ? was.map : null,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // edges sit on the faces, never under them
    });
    mesh.material.name = was ? was.name : kind;
    if (was) was.dispose();
    const material = kind === "envelope"
      ? new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: DASH[0], gapSize: DASH[1] })
      : new THREE.LineBasicMaterial({ color: 0xffffff });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_DEG), material);
    if (kind === "envelope") edges.computeLineDistances();
    edges.raycast = () => {}; // a pick hits the part, never its edges
    edges.name = `${name} edges`;
    mesh.add(edges);
    const part = { id: name, mesh, edges, kind, outline: null };
    const o = outlineEdges(mesh.geometry);
    if (o.count) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(o.count * 6), 3).setUsage(THREE.DynamicDrawUsage));
      if (kind === "envelope") geometry.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(o.count * 2), 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setDrawRange(0, 0);
      // The part's own bounds: its buffer is zeros until drawn, which would put the part's box at its origin.
      geometry.boundingSphere = mesh.geometry.boundingSphere.clone();
      geometry.boundingBox = mesh.geometry.boundingBox.clone();
      const line = new THREE.LineSegments(geometry, material); // the creases' material: it lights with them
      line.raycast = () => {};
      line.name = `${name} outline`;
      mesh.add(line);
      part.outline = { ...o, line, from: new THREE.Vector3(NaN, NaN, NaN) };
    }
    mesh.userData.sprue = part;
    if (!ids || ids.has(name)) parts.set(name, part);
    look(three, part, "rest", colors);
  }
  return parts;
}

/** Draws a part's outline as seen from `eye` (a point in the world): the edges with one face toward it and one away.
 * Returns how many it drew. The mesh's world matrix must be current. */
export function outline(three, part, eye) {
  const o = part.outline;
  if (!o) return 0;
  const at = part.mesh.worldToLocal(eye.clone());
  if (at.equals(o.from)) return o.line.geometry.drawRange.count / 2;
  o.from.copy(at);
  const pos = o.line.geometry.attributes.position, dist = o.line.geometry.attributes.lineDistance;
  const P = pos.array, D = dist ? dist.array : null;
  const { a, b, n1, n2 } = o;
  let k = 0;
  for (let i = 0; i < o.count * 3; i += 3) {
    const vx = at.x - a[i], vy = at.y - a[i + 1], vz = at.z - a[i + 2];
    const s1 = n1[i] * vx + n1[i + 1] * vy + n1[i + 2] * vz, s2 = n2[i] * vx + n2[i + 1] * vy + n2[i + 2] * vz;
    if (s1 > 0 === s2 > 0) continue;
    P[6 * k] = a[i]; P[6 * k + 1] = a[i + 1]; P[6 * k + 2] = a[i + 2];
    P[6 * k + 3] = b[i]; P[6 * k + 4] = b[i + 1]; P[6 * k + 5] = b[i + 2];
    if (D) { D[2 * k] = 0; D[2 * k + 1] = Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1], b[i + 2] - a[i + 2]); }
    k++;
  }
  o.line.geometry.setDrawRange(0, 2 * k);
  pos.clearUpdateRanges();
  pos.addUpdateRange(0, 6 * k);
  pos.needsUpdate = true;
  if (dist) { dist.clearUpdateRanges(); dist.addUpdateRange(0, 2 * k); dist.needsUpdate = true; }
  return k;
}

/** A part's tones: at rest, lit (hovered or pinned), or a tone down while another part is lit, as the drawing does. */
export function look(three, part, state, colors) {
  const { THREE } = three;
  const c = (k) => new THREE.Color(colors[k]);
  const env = part.kind === "envelope";
  // A lit part's faces go a fifth of the way to the lit tone (mixed as the page mixes colours, in sRGB): the drawing's
  // lit top is too near its face for a model whose faces are mostly not lit by the lamp.
  const toward = (from, to, t) => {
    const a = {}, b = {};
    c(from).getRGB(a, THREE.SRGBColorSpace);
    c(to).getRGB(b, THREE.SRGBColorSpace);
    return new THREE.Color().setRGB(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, THREE.SRGBColorSpace);
  };
  if (part.kind === "board") part.mesh.material.color.set(state === "on" ? 0xffffff : state === "dim" ? 0xb4b4b4 : 0xe6e6e6);
  else part.mesh.material.color.copy(state === "on" ? toward(env ? "paper" : "face", "lit", 0.2) : c(env ? "paper" : "face"));
  part.edges.material.color.copy(c(state === "on" ? "lit" : state === "dim" ? (env ? "faint" : "lo") : env ? "mid" : "hi"));
}

/** The near and far planes that hold a model of bounding sphere `radius` whose centre is `distance` from the camera,
 * wherever the camera is: zoomed in past its front, or out to the controls' farthest. */
export const planesOf = (distance, radius) => ({ near: Math.max(distance - radius * 1.1, radius / 1000), far: distance + radius * 1.1 });

/** Where the camera goes to frame `object` (or a Box3 in the world) from `dir`: the centre and radius of its bounding
 * sphere, the position, and near and far planes that hold it, for a camera of `fovDeg` (vertical) and `aspect`. */
export function frameOf(three, object, aspect, fovDeg = FOV, dir = VIEW_FROM) {
  const { THREE } = three;
  const box = object.isBox3 ? object.clone() : new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-6);
  // The camera's axes looking at the centre from `dir`, and how far back each corner of the box needs it to be to
  // sit inside the view with a margin: a flat product fills the view, where its bounding sphere would leave it small.
  const back = new THREE.Vector3(...dir).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) / 1.08, tanH = tanV * aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).sub(center);
    const depth = v.dot(back);
    distance = Math.max(distance, depth + Math.abs(v.dot(right)) / tanH, depth + Math.abs(v.dot(up)) / tanV);
  }
  distance = Math.max(distance, radius * 1.05);
  const position = back.clone().multiplyScalar(distance).add(center);
  return { center, radius, distance, position, ...planesOf(distance, radius) };
}

/** The box in the world that holds the parts `shown` says are, each moved by `k` times its lift: `shown(part)` gives
 * that k (0 in place, 1 apart), or null for a part not shown. Each part's own box, in its parent's frame, moved there;
 * an empty box when none is shown. */
export function poseBox(three, parts, lift, shown) {
  const { THREE } = three;
  const box = new THREE.Box3();
  for (const part of parts) {
    const k = shown(part);
    if (k == null || !part.mesh.geometry.boundingBox) continue;
    const [x, y, z] = lift(part);
    const b = part.mesh.geometry.boundingBox.clone().translate(new THREE.Vector3(x * k, y * k, z * k));
    if (part.mesh.parent) b.applyMatrix4(part.mesh.parent.matrixWorld); // the parents' world matrices must be current
    box.union(b);
  }
  return box;
}

/** Where the camera is a share `e` (0 to 1) of the way from `from` looking at `aim` to `to` looking at `at`: what it
 * looks at moves straight, and the camera swings round it as the controls turn it, about the up axis the short way
 * and up or down, its distance from it going straight from the one to the other. So a camera framing the product
 * from the other side goes round the product, never through it, nor over its top, where the picture would turn
 * upside down in a frame. */
export function between(three, from, aim, to, at, e) {
  const { THREE } = three;
  const target = new THREE.Vector3().lerpVectors(aim, at, e);
  const a = new THREE.Spherical().setFromVector3(from.clone().sub(aim)), b = new THREE.Spherical().setFromVector3(to.clone().sub(at));
  if (!a.radius || !b.radius) return { position: new THREE.Vector3().lerpVectors(from, to, e), target };
  const turn = b.theta - a.theta - 2 * Math.PI * Math.round((b.theta - a.theta) / (2 * Math.PI));
  const s = new THREE.Spherical(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + turn * e);
  return { position: new THREE.Vector3().setFromSpherical(s).add(target), target };
}

/** The id of the part under a point of the view (x and y from -1 to 1, y up), or null: the nearest that is drawn
 * there, so never one the near plane cuts away. */
export function pickAt(three, camera, parts, x, y) {
  const { THREE } = three;
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const meshes = [...parts.values()].map((p) => p.mesh).filter((m) => m.visible);
  const depth = new THREE.Vector3();
  const hit = ray.intersectObjects(meshes, false).find((h) => {
    const z = -depth.copy(h.point).applyMatrix4(camera.matrixWorldInverse).z;
    return z >= camera.near && z <= camera.far;
  });
  return hit ? hit.object.userData.sprue.id : null;
}

// ---- the view on a page --------------------------------------------------------------------------------------------

/** A tag with attributes (null and false are left out) and children (strings, nodes, arrays; null is skipped). */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

/** Whether this browser can draw WebGL 2, which three.js needs, tried on a canvas of its own that is let go at once. */
function hasWebGL2() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const KIND_WORDS = { fit: "Fits", contact: "Touches", gap: "May sit close to", inside: "Meant to be inside", holds: "Meant to hold" };

/**
 * @param {Element} root      the view is drawn in it (its children are replaced)
 * @param {object} view       pipeline/model.ts modelView: items, relations, problems, gates, lines, files
 * @param {ArrayBuffer} glb   previews/system.glb
 * @param {{ THREE: object, OrbitControls: Function, GLTFLoader: Function }} three
 * @param {{ readout?: Element | false, scope?: Element, fileHref?: (path: string) => string | null, title?: string,
 *   headingLevel?: number, hash?: boolean }} opts
 *   readout defaults to [data-readout] inside scope (the closest [data-a2-figure] around root); false turns it off.
 *   fileHref makes each listed file a link (a page in the product folder can pass fileLink). title names the product
 *   to a screen reader (its slug by default); headingLevel is the panel's title's (3 by default; its blocks' one below).
 *   hash (true by default): start in the pose the page's hash asks for (hashOf), and follow it when it changes.
 * @returns {{ ready: Promise<{ ok: boolean, why?: string }>, select(id: string | null): void, fit(): void,
 *   explode(on?: boolean): boolean, step(n: number): number, readonly apart: boolean, readonly at: number,
 *   readonly pinned: string | null, readonly hover: string | null, readonly line: string | null,
 *   screenOf(id: string): { x: number, y: number } | null, destroy(): void }}
 */
export function mountModel(root, view, glb, three, opts = {}) {
  const { THREE, OrbitControls, GLTFLoader } = three;
  const scope = opts.scope || root.closest("[data-a2-figure]") || root.parentElement || root;
  const readout = opts.readout === false ? null : opts.readout || scope.querySelector("[data-readout]");
  const restText = readout ? readout.textContent : "";
  const fileHref = typeof opts.fileHref === "function" ? opts.fileHref : null;
  const level = Math.min(Math.max(Math.round(opts.headingLevel || 3), 1), 5);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const touch = matchMedia("(hover: none) and (pointer: coarse)");
  const ids = new Set(view.items.map((i) => i.id));
  const total = view.items.length;
  const legend = legendOf(view);
  const rest = `3D · ${plural(total, "part")}`;

  const steps = stepsOf(view);
  let alive = true, flat = false;
  let pinned = null, hover = null;
  let chosen = null, hoverLine = null; // a line chosen, or pointed at, elsewhere on the page: all its parts light
  // The pose: apart or not, and the step walked to (0 the whole product); `told` what the page was last told of each.
  let apart = false, at = 0, told = 0, toldApart = false;
  // A spring per assembly step, as the drawing has: x 0 in place to 1 apart, o its parts' opacity.
  const groups = new Map(steps.map((st) => [st.n, { n: st.n, x: 0, v: 0, target: 0, o: 1, oTarget: 1, pending: null }]));
  const order = [...groups.values()];
  let clock = 0, last = 0, springing = false;
  const liftOf = (part) => placeOf(view, part.id).lift;
  const groupOf = (part) => groups.get(placeOf(view, part.id).step);
  let renderer = null, scene = null, camera = null, controls = null, parts = new Map(), all = [], model = null, bounds = null;
  let colors = readColors();
  let raf = 0, hoverRaf = 0, hoverAt = null, tween = null, stale = "";
  const pointers = new Map(); // each pointer down on the model: where it went down and how far it has strayed
  let many = false; // more than one pointer down since the last time none was: a pinch, never a click
  const off = []; // listeners and observers to undo on destroy
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); off.push(() => target.removeEventListener(type, fn, o)); };

  // ---- the page's part of it ----
  root.classList.add("a2-model");
  root.setAttribute("data-state", "loading");
  const canvas = h("canvas", { class: "a2-model-canvas", "aria-hidden": "true" });
  const note = h("p", { class: "a2-model-note", hidden: true });
  const stage = h("div", { class: "a2-model-stage", tabindex: "0", role: "group",
    "aria-label": `${opts.title || view.slug || "The product"} in 3D. Drag to turn it, click a part to see what it is, F to fit; the arrow keys turn it and + and - zoom${
      steps.length ? "; E takes it apart, and [ and ] walk the assembly steps" : ""}.` }, canvas, note);
  const fitButton = h("button", { type: "button", class: "a2-btn", "data-a2m": "fit" }, "Fit");
  const select = h("select", { class: "a2-model-select", "data-a2m": "part" }, h("option", { value: "" }, "Pick a part"),
    partsList(view).map((g) => h("optgroup", { label: g.name }, g.items.map((i) => h("option", { value: i.id }, i.label)))));
  const hint = h("span", { class: "a2-model-hint" });
  const apartButton = h("button", { type: "button", class: "a2-btn", "data-a2m": "apart", "aria-pressed": "false" }, "Take apart");
  const prev = h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "prev", "aria-label": "Previous step" }, "‹");
  const count = h("span", { class: "a2-count" });
  const next = h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "next", "aria-label": "Next step" }, "›");
  const stepper = h("span", { class: "a2-stepper", role: "group", "aria-label": "Assembly steps" }, prev, count, next);
  const stepText = h("p", { class: "a2-step-text", "aria-live": "polite" });
  const bar = h("div", { class: "a2-bar a2-model-bar" }, fitButton, steps.length ? [apartButton, stepper] : null,
    h("label", { class: "a2-model-pick" }, h("span", null, "Part"), select), hint, steps.length ? stepText : null);
  const legendEl = h("div", { class: "a2-model-legend" },
    h("p", null,
      h("span", { class: "a2-model-key", "data-kind": "cad", "aria-hidden": "true" }), ` ${legend.cad} drawn from their own CAD`,
      legend.envelopes ? [h("span", { class: "a2-model-gap" }), h("span", { class: "a2-model-key", "data-kind": "envelope", "aria-hidden": "true" }),
        ` ${legend.envelopes} ${legend.envelopes === 1 ? "envelope" : "envelopes"}: bought parts as stand-in shapes (boxes, cylinders, cones, prisms) at the sizes their datasheets or estimates give, not their makers' models; one may be only the end the product holds, a cable's plug`] : null),
    legend.unplaced.length ? h("p", { class: "a2-model-unplaced" }, h("b", null, "Not in the model: "),
      legend.unplaced.map((u, i) => [i ? "; " : "", h("span", { title: u.line }, u.name), ` (${u.why})`])) : null,
    legend.unsure.length ? h("p", { class: "a2-model-unplaced" }, h("b", null, "Not on the drawing's steps: "),
      legend.unsure.map((u, i) => [i ? "; " : "", h("span", { title: u.line }, u.name), ` (${u.why})`])) : null,
    legend.steps ? null : h("p", null, "No assembly steps or apart pose: there is no figure.json in the product folder (sprue figure draws one)."));
  const panel = h("section", { class: "a2-model-panel", "aria-label": "The part picked" });
  const say = h("p", { class: "a2-model-say", "aria-live": "polite" });
  root.replaceChildren(stage, bar, legendEl, panel, say);

  const setHint = () => {
    hint.textContent = flat ? "pick a part in the list"
      : touch.matches ? "drag to turn · pinch to zoom · tap a part"
        : `drag to turn · click a part · scroll zooms once clicked · f fits${steps.length ? " · e apart · [ ] steps" : ""}`;
  };
  setHint();
  on(touch, "change", () => { setHint(); if (!pinned) renderPanel(); });

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function readColors() {
    const style = getComputedStyle(root);
    return Object.fromEntries(Object.entries(TOKENS).map(([k, [name, fallback]]) => [k, style.getPropertyValue(name).trim() || fallback]));
  }

  // ---- what is lit, said and listed ----
  /** The line lit as a whole, pointed at or chosen elsewhere on the page. */
  const lineLit = () => hoverLine || chosen;
  const lineOfPart = (id) => { const item = itemOf(view, id); return item ? item.line : null; };
  function update() {
    const line = lineLit();
    const focus = pinned || hover || line;
    // With nothing lit, the parts the step walked to puts in light, as the drawing's do.
    const now = at && !focus ? steps[at - 1].n : null;
    for (const part of all) {
      const lit = part.id === pinned || part.id === hover || (line != null && lineOfPart(part.id) === line);
      look(three, part, lit ? "on" : focus ? "dim" : now !== null && placeOf(view, part.id).step === now ? "on" : "rest", colors);
    }
    sayNow();
    request();
  }
  // The phase word reads where the parts are: within 1% of the way they count as arrived, though the springs settle on.
  const moving = () => order.some((g) => g.pending || Math.abs(g.x - g.target) > 0.01 || Math.abs(g.o - g.oTarget) > 0.02);
  function readoutText() {
    // While a part is pinned the readout says it, whatever the pointer is over.
    if (pinned) return readoutOf(view, pinned);
    if (hover) return readoutOf(view, hover);
    const line = lineLit();
    if (line) return lineReadoutOf(view, line);
    if (at) return stepReadoutOf(view, at);
    if (moving()) return apart ? "taking apart" : "closing up";
    return apart ? `apart · ${plural(total, "part")}` : rest;
  }
  /** The readout and the bar, as the pose and what is lit are now. */
  function sayNow() {
    const text = readoutText();
    if (readout && readout.textContent !== text) { readout.textContent = text; readout.setAttribute("title", text); }
    if (!steps.length) return;
    apartButton.textContent = apart ? "Put together" : "Take apart";
    apartButton.setAttribute("aria-pressed", String(apart));
    count.textContent = at ? `Step ${at} / ${steps.length}` : plural(steps.length, "step");
    prev.disabled = at === 0;
    next.disabled = at === steps.length;
    const want = at ? steps[at - 1].text : "";
    if (stepText.textContent !== want) stepText.textContent = want;
  }

  /** A part another part meets, as a button that pins it (or its id, for a part not in the frame). */
  const pick = (id) => ids.has(id)
    ? h("button", { type: "button", class: "a2-model-link", "data-a2m-pick": id, title: readoutOf(view, id) }, labelOf(view, id))
    : h("span", { class: "a2-model-link" }, id);
  const heading = (n, attrs, text) => h(`h${Math.min(n, 6)}`, attrs, text);
  /** The check's rows: with nothing pinned, each gate that fails and each with risks the design accepts on parts; each
   * problem or accepted risk; then what it couldn't say of any part. */
  const checkList = (problems, notes, failing = [], accepted = []) => h("ul", { class: "a2-model-problems" },
    failing.map((g) => h("li", { "data-failing": "" }, h("b", null, "Fails"), h("span", { class: "a2-model-gate" }, g.title),
      h("span", null, plural(g.problems, "problem"), g.parts.length ? [", on ", g.parts.map((id, i) => [i ? " " : "", pick(id)])] : ", on no one part"))),
    accepted.map((g) => h("li", { "data-accepted": "" }, h("b", null, "Accepts"), h("span", { class: "a2-model-gate" }, g.title),
      h("span", null, plural(g.problems, "risk"), ", on ", g.parts.map((id, i) => [i ? " " : "", pick(id)])))),
    problems.map((x) => h("li", { "data-accepted": x.accepted || null },
      h("b", null, x.accepted ? "Accepted risk" : "Problem"), h("span", { class: "a2-model-gate" }, x.title), h("span", null, x.text))),
    notes.map((n) => h("li", { "data-note": "" }, h("b", null, n.label), h("span", null, n.text))));

  function renderPanel() {
    select.value = pinned || "";
    const p = pinned ? panelOf(view, pinned) : null;
    const lp = !p && chosen ? linePanelOf(view, chosen) : null;
    panel.setAttribute("aria-label", p ? "The part picked" : lp ? "The line chosen" : "The whole product");
    const picks = (list) => list.map((id, i) => [i ? " " : "", pick(id)]);
    const file = (f) => {
      const href = fileHref ? fileHref(f.path) : null;
      return h("li", null, href ? h("a", { href }, h("code", null, f.path)) : h("code", null, f.path), h("span", null, f.what));
    };
    const filesBlock = (x) => h("div", { class: "a2-model-block" }, heading(level + 1, null, "Files"),
      x.files.length ? h("ul", { class: "a2-model-files" }, x.files.map(file)) : h("p", { class: "a2-model-none" }, x.filesNote));
    const head = (x, unpin, extra) => h("div", { class: "a2-model-head" },
      h("div", null, heading(level, { class: "a2-model-title", tabindex: "-1" }, x.title), h("p", { class: "a2-model-sub" }, x.sub),
        extra || null,
        x.count ? h("p", { class: "a2-model-count", "data-problems": x.problems.some((y) => !y.accepted) || x.notes.length > 0 || null }, x.count) : null),
      h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "clear", "aria-label": unpin }, "×"));
    if (lp) {
      panel.replaceChildren(...[
        head(lp, "Let go of the line"),
        lp.problems.length || lp.notes.length ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "The whole-product check"),
          checkList(lp.problems, lp.notes)) : null,
        lp.missing ? h("p", { class: "a2-model-none" }, `Not in the model: ${lp.missing}.`)
          : h("div", { class: "a2-model-block" }, heading(level + 1, null, "Its parts"), h("p", { class: "a2-model-parts" }, picks(lp.parts)),
            h("p", { class: "a2-model-why" }, "Pick one to see its own.")),
        filesBlock(lp),
      ].filter(Boolean));
      return;
    }
    if (!p) {
      // The check's verdict first: a product that fails never reads as one with nothing to say.
      const whole = wholeOf(view);
      const rows = whole.failing.length || whole.accepted.length || whole.problems.length || whole.notes.length;
      panel.replaceChildren(...[
        whole.summary || rows ? h("div", { class: "a2-model-block" }, heading(level, null, "The whole-product check"),
          whole.summary ? h("p", { class: "a2-model-count", "data-problems": !whole.ok || null }, whole.summary) : null,
          rows ? checkList(whole.problems, whole.notes, whole.failing, whole.accepted) : null) : null,
        h("p", { class: "a2-model-empty" }, flat ? "Pick a part in the list to see what it is, what it meets and its files."
          : `${touch.matches ? "Tap" : "Click"} a part, or pick it in the list, to see what it is, what it meets and its files.`),
      ].filter(Boolean));
      return;
    }
    const meet = (m) => {
      // A case part may hold dozens: the first few, and the rest behind a button.
      const long = m.kind === "holds" && m.with.length > HOLDS_SHOWN + 2;
      const shown = long ? m.with.slice(0, HOLDS_SHOWN) : m.with;
      return h("li", null, h("b", null, KIND_WORDS[m.kind]), " ", picks(shown),
        long ? [" ", h("button", { type: "button", class: "a2-model-link", "data-a2m": "more", "data-rest": m.with.slice(HOLDS_SHOWN).join(" ") },
          `and ${m.with.length - HOLDS_SHOWN} more`)] : null,
        m.why ? h("span", { class: "a2-model-why" }, m.why) : null);
    };
    // A part the step walked to doesn't put in yet isn't drawn: say so, and when it goes on.
    const goes = at ? placeOf(view, p.id).step : null;
    const later = goes !== null && goes > steps[at - 1].n ? steps.findIndex((st) => st.n === goes) + 1 : 0;
    panel.replaceChildren(...[
      head(p, "Unpin the part", later ? h("p", { class: "a2-model-sub", "data-later": "" }, `Not shown at step ${at}: it goes on at step ${later}`) : null),
      // A failing part says so first.
      p.problems.length || p.notes.length ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "The whole-product check"),
        checkList(p.problems, p.notes)) : null,
      h("dl", { class: "a2-model-facts" }, p.facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      p.meets.length ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "What it meets"),
        h("ul", { class: "a2-model-meets" }, p.meets.map(meet))) : null,
      filesBlock(p),
    ].filter(Boolean));
  }

  /** Focus to `el`, scrolling the page only as far as it takes to show it. */
  const focusOn = (el) => { if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); };
  /** Where focus goes when what had it is gone: the model, or the list where there is no 3D. */
  const home = () => focusOn(stage.hasAttribute("tabindex") ? stage : select);

  /** Tells the page what is pinned: the part and its line, or the line chosen, or nothing. */
  const tellSelect = () => {
    const item = pinned ? itemOf(view, pinned) : null;
    root.dispatchEvent(new CustomEvent("a2:select", { detail: { line: item ? item.line : chosen, part: pinned }, bubbles: true }));
  };

  /** Pins a part (`toggle`: again unpins it), or unpins with null; `quiet` when the page asked, so it isn't told. */
  function choose(id, toggle = true, quiet = false) {
    if (!alive) return;
    const next = id && ids.has(id) ? (toggle && id === pinned ? null : id) : null;
    if (next === pinned && !chosen) return;
    pinned = next;
    chosen = null;
    say.textContent = pinned ? `Pinned: ${readoutOf(view, pinned)}` : "Unpinned";
    renderPanel();
    update();
    if (!quiet) tellSelect();
  }

  /** Lights a line's parts with a panel of the line, as one chosen elsewhere on the page; a line of one part pins it. */
  function chooseLine(line, quiet = false) {
    if (!alive) return;
    const of = line ? partsOfLine(view, line) : [];
    if (of.length === 1) return choose(of[0], false, quiet);
    const next = line && linePanelOf(view, line) ? line : null;
    if (next === chosen && !pinned) return;
    chosen = next;
    pinned = null;
    say.textContent = chosen ? `Chosen: ${lineReadoutOf(view, chosen)}` : "Unpinned";
    renderPanel();
    update();
    if (!quiet) tellSelect();
  }

  function setHover(id, quiet = false) {
    if (!alive) return;
    const next = id && parts.has(id) ? id : null;
    if (next === hover) return;
    hover = next;
    update();
    if (!quiet) root.dispatchEvent(new CustomEvent("a2:hover", { detail: { line: hover ? lineOfPart(hover) : null, part: hover }, bubbles: true }));
  }

  // ---- the pose: apart, and the steps ----
  /** Tells the page of a step or an apart pose it wasn't told of. */
  function tellPose() {
    if (at !== told) {
      told = at;
      root.dispatchEvent(new CustomEvent("a2:step", { detail: { n: at, of: steps.length, text: at ? steps[at - 1].text : "" }, bubbles: true }));
    }
    if (apart !== toldApart) {
      toldApart = apart;
      root.dispatchEvent(new CustomEvent("a2:apart", { detail: { on: apart }, bubbles: true }));
    }
  }
  /** Points every step's spring at the pose chosen, as the drawing does: leaving, the last step placed goes first;
   * arriving, the first step placed comes first. A reversal reschedules only what changes. The camera eases round to
   * frame what will be shown, from where it looks now (`dir`, or the start's view). */
  function retarget(jump = false, dir = null) {
    const calm = jump || still.matches || !renderer || !model;
    const s = at ? steps[at - 1].n : Infinity;
    const leaving = [], arriving = [];
    for (const g of order) {
      const want = { x: apart || g.n > s ? 1 : 0, o: g.n > s ? 0 : 1 };
      if (calm) {
        Object.assign(g, { pending: null, target: want.x, x: want.x, v: 0, oTarget: want.o, o: want.o });
        continue;
      }
      const ahead = g.pending || { x: g.target, o: g.oTarget };
      if (want.x === ahead.x && want.o === ahead.o) continue;
      if (g.pending && want.x === g.target && want.o === g.oTarget) { g.pending = null; continue; }
      (want.o < ahead.o || (want.o === ahead.o && want.x > ahead.x) ? leaving : arriving).push([g, want]);
    }
    leaving.sort((a, b) => b[0].n - a[0].n);
    arriving.sort((a, b) => a[0].n - b[0].n);
    for (const list of [leaving, arriving]) list.forEach(([g, want], i) => { g.pending = { x: want.x, o: want.o, at: clock + i * SPRING.stagger }; });
    pose();
    // A part pointed at that goes is pointed at no more.
    if (hover && parts.get(hover) && !shownAfter(parts.get(hover))) setHover(null);
    update();
    if (!calm && !springing && moving()) { springing = true; last = 0; }
    if (renderer && model) fit(calm, dir || lookDir());
    tellPose();
  }
  /** Whether a part is shown in the pose the springs are going to. */
  const shownAfter = (part) => { const g = groupOf(part); return !g || (g.pending ? g.pending.o : g.oTarget) > 0; };
  /** How far apart (0 to 1) a part will be in the pose the springs are going to, or null where it won't be shown. */
  const goingTo = (part) => {
    const g = groupOf(part);
    if (!g) return 0;
    const w = g.pending || { x: g.target, o: g.oTarget };
    return w.o > 0 ? w.x : null;
  };
  /** Each part where its step's spring has it, faded as its spring says. */
  function pose() {
    if (!model) return;
    for (const part of all) {
      const g = groupOf(part);
      const k = g ? g.x : 0, o = g ? g.o : 1;
      const [x, y, z] = liftOf(part);
      part.mesh.position.set(x * k, y * k, z * k);
      fade(part, o);
    }
    model.updateMatrixWorld(true);
  }
  /** A part's opacity: drawn through above 0.999, gone below 0.01 (and never picked), in between see-through. */
  function fade(part, o) {
    const solid = o >= 0.999;
    part.mesh.visible = o >= 0.01;
    for (const m of [part.mesh.material, part.edges.material]) {
      if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true; }
      m.opacity = solid ? 1 : o;
    }
    part.mesh.material.depthWrite = solid;
  }
  /** Moves the springs on to `now`: whether any is still moving. */
  function tick(now) {
    // Real time, as Fit's ease is, up to a tenth of a second a frame: a slow frame doesn't slow the parts down.
    const dt = last ? Math.min(Math.max((now - last) / 1000, 0), 0.1) : 1 / 60;
    last = now;
    clock += dt;
    let busy = false;
    const hs = dt / SPRING.substeps;
    for (const g of order) {
      if (g.pending && clock >= g.pending.at) {
        g.target = g.pending.x;
        g.oTarget = g.pending.o;
        g.pending = null;
      }
      if (g.pending) busy = true;
      for (let i = 0; i < SPRING.substeps; i++) {
        g.v += (SPRING.stiffness * (g.target - g.x) - SPRING.damping * g.v) * hs;
        g.x += g.v * hs;
      }
      if (Math.abs(g.target - g.x) < 5e-4 && Math.abs(g.v) < 5e-4) { g.x = g.target; g.v = 0; } else busy = true;
      g.o += (g.oTarget - g.o) * (1 - Math.exp(-dt / FADE));
      if (Math.abs(g.oTarget - g.o) < 0.003) g.o = g.oTarget; else busy = true;
    }
    pose();
    sayNow();
    return busy;
  }
  /** Where the camera looks from, as a direction in the model's frame, or the start's view when it has none yet. */
  const lookDir = () => {
    if (!camera || !controls) return VIEW_FROM;
    const d = camera.position.clone().sub(controls.target);
    return d.lengthSq() ? d.toArray() : VIEW_FROM;
  };

  function explode(on, quiet = false) {
    if (!alive || !steps.length) return apart;
    const want = on === undefined ? !apart : Boolean(on);
    if (want === apart) return apart;
    apart = want;
    if (quiet) toldApart = apart;
    retarget();
    return apart;
  }
  function step(n, quiet = false) {
    if (!alive || !steps.length) return at;
    const want = Math.max(0, Math.min(steps.length, Math.round(Number(n) || 0)));
    if (want === at) return at;
    // A part pinned would keep the readout: the step asked for is what to show now, as the drawing does.
    if (pinned || chosen) choose(null, false, quiet);
    at = want;
    if (quiet) told = at;
    retarget();
    return at;
  }
  on(apartButton, "click", () => explode());
  on(prev, "click", () => step(at - 1));
  on(next, "click", () => step(at + 1));

  // ---- the page: what the drawing and the rest of it say, and the hash ----
  const outside = (e) => !(e.target instanceof Node && root.contains(e.target));
  on(document, "a2:select", (e) => {
    if (!outside(e)) return;
    const d = e.detail || {};
    if (d.part && ids.has(d.part)) choose(d.part, false, true);
    else chooseLine(d.line ?? null, true);
  });
  on(document, "a2:hover", (e) => {
    if (!outside(e)) return;
    const d = e.detail || {};
    const line = d.line && (Object.hasOwn(view.lines, d.line) || partsOfLine(view, d.line).length) ? d.line : null;
    if (d.part && parts.has(d.part)) { hoverLine = null; setHover(d.part, true); return; }
    if (line === hoverLine) return;
    hoverLine = line;
    update();
  });
  on(document, "a2:step", (e) => { if (outside(e)) step(e.detail && e.detail.n, true); });
  on(document, "a2:apart", (e) => { if (outside(e)) explode(Boolean(e.detail && e.detail.on), true); });
  const useHash = opts.hash !== false;
  /** The pose the hash asks for: at once when the view starts, eased when the hash changes. */
  function fromHash(jump) {
    const want = hashOf(location.hash, view);
    apart = steps.length ? want.apart : false;
    at = want.at;
    if (want.part) choose(want.part, false, true);
    else chooseLine(want.line, true);
    retarget(jump);
  }
  if (useHash) {
    on(window, "hashchange", () => fromHash(false));
    if (location.hash.length > 1) fromHash(true);
  }

  // ---- the panel and the bar ----
  on(panel, "click", (event) => {
    const b = event.target.closest("[data-a2m-pick],[data-a2m]");
    if (!b) return;
    if (b.hasAttribute("data-a2m-pick")) {
      choose(b.getAttribute("data-a2m-pick"), false);
      // The button is gone with the panel it was in: the new panel's title has focus.
      focusOn(panel.querySelector(".a2-model-title"));
    } else if (b.getAttribute("data-a2m") === "clear") {
      // From the keyboard, focus goes to the model; a click leaves it where it was, so the wheel still scrolls the page.
      choose(null);
      if (!event.detail) home();
    }
    else if (b.getAttribute("data-a2m") === "more") {
      const rest = (b.getAttribute("data-rest") || "").split(" ").filter(Boolean).map((id) => pick(id));
      b.replaceWith(...rest.flatMap((x, i) => (i ? [" ", x] : [x])));
      rest[0]?.focus();
    }
  });
  on(select, "change", () => choose(select.value || null, false));
  on(fitButton, "click", () => fit());
  on(root, "keydown", (event) => {
    if (event.target.closest("select, input, textarea") || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      // A part, then a line, then the pose.
      if (pinned || chosen) {
        const inPanel = panel.contains(event.target);
        choose(null);
        if (inPanel) home();
      } else if (at || apart) {
        at = 0;
        apart = false;
        retarget();
      } else return;
      event.preventDefault();
      return;
    }
    if ((event.key === "f" || event.key === "F") && controls) { fit(); event.preventDefault(); return; }
    if (steps.length && !flat) {
      const pose = { e: () => explode(), E: () => explode(), "[": () => step(at - 1), "]": () => step(at + 1) };
      if (pose[event.key]) { pose[event.key](); event.preventDefault(); return; }
      if (event.target === stage && (event.key === "Home" || event.key === "End")) {
        step(event.key === "Home" ? 0 : steps.length);
        event.preventDefault();
        return;
      }
    }
    if (event.target !== stage || !controls) return;
    const turn = Math.PI / 12;
    // OrbitControls' dollyIn(s) moves the camera s times as far: below 1 is in.
    const keys = { ArrowLeft: () => controls.rotateLeft(turn), ArrowRight: () => controls.rotateLeft(-turn),
      ArrowUp: () => controls.rotateUp(turn), ArrowDown: () => controls.rotateUp(-turn),
      "+": () => controls.dollyIn(1 / ZOOM), "=": () => controls.dollyIn(1 / ZOOM), "-": () => controls.dollyOut(1 / ZOOM) };
    if (keys[event.key]) { tween = null; settling = true; keys[event.key](); event.preventDefault(); }
  });
  // The wheel zooms once the view has focus, or with Ctrl or ⌘ (a trackpad's pinch): until then it scrolls the page,
  // as it does over the drawing, so a reader scrolling past the figure isn't caught by it.
  on(stage, "wheel", (event) => {
    if (!stage.contains(document.activeElement) && !event.ctrlKey && !event.metaKey) event.stopPropagation();
  }, { capture: true });
  renderPanel();

  // ---- drawing ----
  function request() {
    if (alive && renderer && scene && !raf) raf = requestAnimationFrame(draw);
  }
  /** The camera's matrices and planes for where it is now, so the planes hold the model however near or far it is. */
  function place() {
    camera.updateMatrixWorld();
    if (!bounds) return;
    const { near, far } = planesOf(camera.position.distanceTo(bounds.center), bounds.radius);
    if (near !== camera.near || far !== camera.far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
  }
  /** Whether the camera is away from where it was at `then` ({ eye, at }) by more than a still camera drifts. */
  const away = (then) => !then || then.eye.distanceTo(camera.position) > STILL * camera.position.distanceTo(controls.target)
    || then.at.distanceTo(controls.target) > STILL * camera.position.distanceTo(controls.target);
  const where = () => ({ eye: camera.position.clone(), at: controls.target.clone() });
  let drawn = null, picked = null; // where the camera was at the last frame drawn, and at the last hover pick
  let settling = false; // a drag, a pinch, the wheel or a key moved the camera, and its damping is still to spend
  function draw(now) {
    raf = 0;
    if (!alive || !renderer || !scene || !camera || !controls) return;
    let more = false;
    if (springing) {
      springing = tick(now);
      if (springing) more = true;
      // Once the parts are still, a pointer that hasn't moved is over what is there now.
      else if (hoverAt && !pointers.size) hoverPick();
    }
    if (tween) more = stepTween(now) || more;
    // Only while it settles: what is left of the damping once the camera is still would creep it on with every
    // frame drawn for a hover, and a part would move under a still pointer.
    if (controls.enableDamping && settling) controls.update();
    // What counts is whether it moved more than a share of how far off it is: OrbitControls says it moved past a
    // thousandth of a unit, a millimetre of the model's metres, which a small product never does and a big one always.
    if (drawn && away(drawn)) more = true;
    drawn = where();
    place();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    for (const part of all) if (part.mesh.visible) outline(three, part, eye);
    renderer.render(scene, camera);
    if (more) return request();
    if (!pointers.size) settling = false;
    // At rest, a pointer that hasn't moved is over what is under it now, not what was there before the camera moved.
    if (hoverAt && !pointers.size && away(picked)) hoverPick();
  }
  function hoverPick() {
    picked = where();
    if (hoverAt) setHover(pickClient(...hoverAt));
  }

  /** Frames what the pose the springs are going to shows, from `dir` (the start's view by default: Fit and F). */
  function fit(jump = still.matches, dir = VIEW_FROM) {
    if (!alive || !model || !camera) return;
    const box = poseBox(three, all, liftOf, goingTo);
    if (box.isEmpty()) return;
    const f = frameOf(three, box, camera.aspect || 1, FOV, dir);
    controls.minDistance = f.radius * 0.2;
    controls.maxDistance = f.distance * 4;
    // A drag's damping still to come would turn the camera on after it is framed: spend it now, undamped, first.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    if (jump) {
      tween = null;
      camera.position.copy(f.position);
      controls.target.copy(f.center);
      controls.update();
      place();
      request();
    } else {
      tween = { t0: performance.now(), from: camera.position.clone(), to: f.position, aim: controls.target.clone(), at: f.center };
      request();
    }
  }
  function stepTween(now) {
    // A frame's time is when it began, which may be before Fit was asked for in it.
    const t = Math.max(0, Math.min(1, (now - tween.t0) / 1000 / FIT_S));
    const e = 1 - Math.pow(1 - t, 3);
    const p = between(three, tween.from, tween.aim, tween.to, tween.at, e);
    camera.position.copy(p.position);
    controls.target.copy(p.target);
    camera.lookAt(controls.target);
    if (t >= 1) { tween = null; controls.update(); return false; }
    return true;
  }

  function size() {
    if (!renderer || !camera) return;
    const w = stage.clientWidth, hgt = stage.clientHeight;
    if (!w || !hgt) return;
    // The page's pixels may have changed too: a window moved to another screen, or zoomed.
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    request();
  }

  function pickClient(x, y) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height || !camera) return null;
    place();
    return pickAt(three, camera, parts, ((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  function recolor() {
    colors = readColors();
    update();
  }

  /** No 3D: say why, let the WebGL context go, and leave the list and the panel, with words for them alone. */
  function fail(state, why) {
    flat = true;
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
    root.setAttribute("data-state", state);
    showNote(why);
    fitButton.hidden = true;
    apartButton.hidden = true;
    stepper.hidden = true;
    stepText.hidden = true;
    stage.removeAttribute("tabindex");
    stage.removeAttribute("role");
    stage.removeAttribute("aria-label");
    setHint();
    renderPanel();
    return { ok: false, why };
  }

  const ready = (async () => {
    if (!hasWebGL2()) return fail("no-webgl", "No 3D here: this browser can't draw WebGL 2. Pick a part in the list to see what it is; the drawing shows the product.");
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      renderer = null;
      return fail("no-webgl", "No 3D here: this browser would not start WebGL 2. Pick a part in the list to see what it is; the drawing shows the product.");
    }
    renderer.setClearColor(0x000000, 0);
    let gltf;
    try {
      gltf = await new GLTFLoader().parseAsync(glb, "");
    } catch (error) {
      if (!alive) return { ok: false, why: "destroyed" };
      return fail("error", `The 3D model could not be read (${error && error.message ? error.message : error}).`);
    }
    if (!alive) return { ok: false, why: "destroyed" };
    scene = new THREE.Scene();
    model = gltf.scene;
    scene.add(model);
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.001, 10);
    // Light from above, and a lamp a little above and right of the camera, aimed along it (its target rides with the
    // camera too): a face toward the viewer reads whichever way the product is turned, and alike at any size.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6f6f, 2.2));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.1);
    lamp.position.set(0.3, 0.6, 1);
    camera.add(lamp, lamp.target);
    scene.add(camera);
    parts = prepare(three, model, colors, ids);
    model.traverse((o) => { if (o.userData.sprue) all.push(o.userData.sprue); });
    model.updateMatrixWorld(true);
    // The planes hold the product in every pose: put together, and every part as far out as it goes.
    const f = frameOf(three, poseBox(three, all, liftOf, () => 0).union(poseBox(three, all, liftOf, () => 1)), 1);
    bounds = { center: f.center, radius: f.radius };
    if (gltf.asset && gltf.asset.extras && view.model && gltf.asset.extras.inputs !== view.model.inputs) {
      stale = "This model is of another run than system.json: run sprue system to draw it again.";
      showNote(stale);
    }
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !still.matches;
    controls.dampingFactor = 0.12;
    on(controls, "change", request);
    on(controls, "start", () => { settling = true; });
    on(still, "change", () => { controls.enableDamping = !still.matches; });
    on(canvas, "pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, strayed: 0 });
      if (pointers.size > 1) many = true;
      tween = null;
    });
    const lift = (e) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      const click = e.type === "pointerup" && p && !many && e.button === 0 && p.strayed < MOVED;
      if (!pointers.size) many = false;
      else if (e.type === "pointercancel") many = true;
      request(); // the drag's damping, and the hover once it is over
      return click;
    };
    on(canvas, "pointerup", (e) => { if (lift(e)) choose(pickClient(e.clientX, e.clientY)); });
    on(canvas, "pointercancel", lift);
    on(canvas, "pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (p) {
        p.strayed = Math.max(p.strayed, Math.hypot(e.clientX - p.x, e.clientY - p.y));
        request(); // a drag moves the camera, and OrbitControls says so only past a millimetre
      }
      if (e.pointerType === "touch") return;
      hoverAt = [e.clientX, e.clientY]; // where to pick once the drag is over
      if (e.buttons) return;
      if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; hoverPick(); });
    });
    on(canvas, "pointerleave", () => { hoverAt = null; setHover(null); });
    on(canvas, "webglcontextlost", (e) => { e.preventDefault(); showNote("The 3D view lost its drawing context; it draws again when the browser gives it back."); });
    on(canvas, "webglcontextrestored", () => { showNote(stale); request(); });
    const resized = new ResizeObserver(size);
    resized.observe(stage);
    off.push(() => resized.disconnect());
    const themed = new MutationObserver(recolor);
    for (const el of new Set([document.documentElement, document.body, root.closest("[data-theme]")].filter(Boolean)))
      themed.observe(el, { attributes: true, attributeFilter: ["data-theme", "class"] });
    off.push(() => themed.disconnect());
    on(matchMedia("(prefers-color-scheme: light)"), "change", recolor);
    // A change of the page's pixel ratio resizes nothing, so it is watched: each query matches one ratio, so it is
    // asked again for the new one.
    let ratio = null;
    const watchRatio = () => {
      ratio?.();
      const q = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
      const changed = () => { size(); watchRatio(); };
      q.addEventListener("change", changed);
      ratio = () => q.removeEventListener("change", changed);
    };
    watchRatio();
    off.push(() => ratio?.());
    size();
    // The pose asked for (the hash's, or one the page sent while it loaded), at once, framed from the start's view.
    retarget(true, VIEW_FROM);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    if (!alive) return { ok: false, why: "destroyed" };
    root.setAttribute("data-state", "ready");
    return { ok: true };
  })();

  function destroy() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(hoverRaf);
    for (const undo of off.splice(0)) undo();
    controls?.dispose();
    scene?.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
    });
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
    root.replaceChildren();
    root.classList.remove("a2-model");
    root.removeAttribute("data-state");
    if (readout) { readout.textContent = restText; readout.setAttribute("title", restText); }
  }

  return {
    ready,
    /** Pins a part, as the page asks, so the page isn't told. */
    select: (id) => choose(id, false, true),
    fit: () => fit(),
    /** Takes it apart or puts it together (toggles with no argument), and says so to the page as a click would. */
    explode: (on) => explode(on),
    /** Walks to step n (0 the whole product), and says so to the page as a click would. */
    step: (n) => step(n),
    get apart() { return apart; },
    get at() { return at; },
    get pinned() { return pinned; },
    get hover() { return hover; },
    get line() { return chosen; },
    /** Where the middle of the top of a part's box is on the page, in client px, now (not at the last frame drawn), or
     * null (not drawn, or behind the camera). */
    screenOf(id) {
      const part = parts.get(id);
      if (!alive || !part || !camera) return null;
      place();
      const box = part.mesh.geometry.boundingBox.clone().applyMatrix4(part.mesh.matrixWorld);
      const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
      if (p.z > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    destroy,
  };
}
