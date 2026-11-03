// Sprue's 3D view: previews/system.glb, the product as the whole-product check placed it, to turn, pick parts in, take
// apart, and see where the check found its problems:
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
//                     by assembly step, and back; the camera follows, framing what is shown. The button says what it
//                     does ("Put together" once apart), so it is no toggle
//   [ ], the stepper  walk the drawing's assembly steps: earlier steps in place, this one lit, later ones lifted away
//                     and gone; Home and End (while the view has focus) go to the whole product and the last step.
//                     [ and ] count typed with AltGr or Option too, as many layouts type them; a stepper button that
//                     reaches an end gives the focus to the other
//   Problems, P       each problem and accepted risk the check gives a place, marked there (a disc, a ring for a risk,
//                     drawn whole in front of the face it sits on), while the parts it names are in place, faint where
//                     a part is in front of it, a tone down while
//                     something else is lit. On by default. Each problem in a panel, and each gate that fails or
//                     accepts risks, has Show: it puts the product together if it must, frames the marks from where the
//                     camera looks, and lights them and their parts. A risk of a stability pose is marked while the
//                     Pose list shows that pose, where its parts are in it; the legend says how many
//   X-ray, X          every part another is meant to be inside (relations.inside) is glass, and a pick goes through it
//   Mass, M           the whole product's centre of mass as the stability gate weighed it, a cross with a plumb line to
//                     the desk, while the whole product is put together, with its mass and how far it tilts
//   Probes, R         each function probe (system.json's probes) as lines where the check casts it, while the whole
//                     product is put together as built: a speaker's or a mic port's disc and its rays out, a camera's
//                     image, its field and the box of what it must see, a light's cone, a radio keep-out's region and
//                     where the distance it needs round it ends; green where it passes, red where it fails, grey where
//                     it falls short with the design's reason, fainter where a part hides it. Off by default. With
//                     nothing pinned the panel lists each probe, what it found, what is in its way and its source as
//                     buttons, and why; a part's panel, the probes it is the source of, is in the way of or is metal
//                     too near. Each has Show: it puts the product together as built, frames the probe and lights it and
//                     the parts it names
//   the Pose list     each way the product stands as the stability gate weighs it (system.json's poses; the first is
//                     the frame's, as built): the parts it moves where it puts them, the parts it bends drawn along the
//                     path it bends them to (its own scene in the model), the parts it takes out and doesn't say where
//                     it puts not drawn; its centre of mass and its risks marked, and the line under the bar saying no
//                     gate checks how the parts fit there. A pose is of the whole product put together: Take apart, a
//                     step and Escape go back to the product as built, and a risk's Show goes to its pose
//   a part lit        its edges show faint where another part is in front of them (dashed for an envelope, dotted
//                     for a part drawn along a path), as do the
//                     step's own parts with nothing lit; not the part under the pointer
//   Escape            lets go of the marks or the probe shown, then unpins, then lets go of a line, then of the steps and the apart
//                     pose
// A line under the view (aria-live) says what each key and button did, and what the Problems toggle marks now.
// It and the drawing (figure.js) on one page keep each other's pose: each says "a2:select" { line, part } when a part
// is pinned (the drawing, which draws lines, says only line), "a2:hover" { line, part } when one is pointed at,
// "a2:step" { n } and "a2:apart" { on }, and each shows what the other says. A line chosen elsewhere lights all its
// parts, with a panel of the line; one part of it lights alone. The page's hash starts it in a pose:
// #apart #step=3 #part=sw5 #select=sw (a line), combined with &, as the drawing reads them (it leaves part to this);
// #pose=<a pose's name> is this view's alone, and with apart or a step, which the drawing follows, it is the frame's.
// A view that mounts after the other asks where it is ("a2:ask"): the other says its step, apart pose and line again,
// each with { reply: true }, and this one goes there at once; it asks the same as it mounts. The step's text is read
// out by the view that walked to it, not again by the one that followed.
// Solid edges are parts drawn from their own CAD, dashed ones envelopes: bought parts as stand-in shapes (boxes,
// cylinders, cones, prisms) at the sizes their datasheets or estimates give; dotted ones parts drawn along the path they
// take as built (a gooseneck bent to the design pose), which no gate checks as a shape. Each part's creases are drawn, and its outline from where the camera is, so
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
const DOT = [0.5, 2]; // mm, a path's dotted ones
/** How each kind of part that stands in for its maker's shape draws its edges: dashes or dots (mm). */
const STROKE = { envelope: DASH, path: DOT };
const MOVED = 5; // px a pointer may stray from where it went down and still click
const FIT_S = 0.45; // seconds the camera takes to frame the product
const ZOOM = 1.25; // how far + and - move the camera in or out
const STILL = 1e-4; // a camera that moves less than this share of its distance from what it looks at in a frame is still
const HOLDS_SHOWN = 10; // parts a case part's "Meant to hold" row shows before "and N more"
/** The drawing's exploded-view spring (figure.js): just under critical, so parts land with a hint of weight. */
const SPRING = { stiffness: 64, damping: 14.2, substeps: 4, stagger: 0.045 };
const FADE = 0.14; // seconds, opacity follow for steps that come and go
const MARK_PX = 13; // a problem's mark, across in CSS px; one shown from a panel's Show is half as big again
const BEHIND = 0.35; // a mark's opacity where a part hides it
const LIFT = 3; // a mark comes toward the eye up to this many half widths, off a face seen at a slant
const GLASS = { face: 0.08, edge: 0.4 }; // X-ray: a case's opacity
const GHOST = 0.3; // the opacity of a lit part's edges where other parts hide them
const PROBE_FAINT = 0.45; // a probe's faint lines (a speaker's rays, a camera's field), as a share of its others
const DIM = 0.4; // a probe's opacity, as a share, while something else is lit
const NEAR = 0.15; // Show frames a mark with this share of the whole product's radius round it

/** The kit's tokens, read from the page (with the dark theme's values where a page has none). */
const TOKENS = {
  face: ["--anatomy-face", "#1b1b1b"], top: ["--anatomy-lit-top", "#262626"], paper: ["--anatomy-paper", "#131313"],
  hi: ["--anatomy-hi", "#d4d4d4"], mid: ["--anatomy-mid", "#6a6a6a"], lo: ["--anatomy-lo", "#3e3e3e"],
  faint: ["--anatomy-faint", "#2a2a2a"], lit: ["--anatomy-lit", "#ffffff"], red: ["--anatomy-red", "#ff6b6b"],
  green: ["--anatomy-green", "#6be0a0"],
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
 * @typedef {{ gate: string, title: string, text: string, parts: string[], at: number[] | null, accepted: boolean,
 *   pose?: string | null }} Problem
 * @typedef {{ id: string, title: string, status: string, problems: number, listed: number, ran: boolean }} Gate
 * @typedef {{ slug: string, model: { file: string, inputs: string, triangles: number }, minClearanceMm: number | null,
 *   items: Item[], relations: Relations, problems: Problem[], gates?: Gate[], ok?: boolean,
 *   selfTest?: { ok: boolean, missed: string[], untested: string[] }, stale?: string[], missing?: string[], bom?: boolean,
 *   lines: Record<string, Line>, files: Record<string, File[]>, assembly?: Assembly | null,
 *   stability?: Weighing | null, poses?: Pose[], probes?: Probe[] }} View
 * @typedef {{ pose: string, massG: number, estimatedG: number, com: number[], tiltDeg: number | null }} Weighing
 * @typedef {{ name: string, drop: string[], moved: number[][] | null, drawn: Item[], scene: number | null,
 *   mass: Weighing | null }} Pose
 * @typedef {{ id: string, kind: "sound" | "port" | "view" | "light" | "keepout", ok: boolean | null, why: string, accept: string,
 *   problems: number[], where: Record<string, any> | null, found: Record<string, any> }} Probe
 * @typedef {{ steps: { n: number, text: string }[], parts: Record<string, { step: number, lift: number[] }>,
 *   unsure: Record<string, string> }} Assembly
 * @typedef {{ kind: "fit" | "contact" | "gap" | "inside" | "holds", with: string[], why: string }} Meet
 * @typedef {{ i: number, gate: string, title: string, text: string, accepted: boolean }} Shown
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

/** What the readout says of a part, in the drawing's words: "Keycap 6 of 9 · bought · envelope" ("· path" for a part
 * drawn along one).
 * @param {View} view @param {string} id @returns {string} */
export function readoutOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return "";
  const line = item.line ? view.lines[item.line] : undefined;
  const c = line ? countOf(view, item) : null;
  return [`${line ? line.short || line.name : item.id}${c ? ` ${c.k} of ${c.n}` : ""}`, madeOf(view, item),
    item.model === "envelope" ? "envelope" : item.model === "path" ? "path" : "CAD"].join(" · ");
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

/** The problems that `keep` keeps, as a panel lists them, each with its place in view.problems (`i`).
 * @param {View} view @param {(p: Problem) => boolean} keep @returns {Shown[]} */
const shownOf = (view, keep) => view.problems.flatMap((p, i) => (keep(p) ? [{ i, gate: p.gate, title: p.title, text: p.text, accepted: p.accepted }] : []));

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
  const { changed, missing } = staleParts(view);
  if (changed.length) {
    out.push({ label: "Out of date", text: `The check ran on an earlier design (${namesOf(changed)} changed since), so what it says${part ? " of this part" : ""} may not hold now: run ${systemCommand(view)} again.` });
  }
  if (missing.length) {
    out.push({ label: "Not compared", text: `It ran with ${namesOf(missing)}, which ${missing.length === 1 ? "isn't" : "aren't"} here, so it can't be told whether it ran on the design as it is now: what it says${part ? " of this part" : ""} may not hold.` });
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
 * product that fails never reads as passing. In pose `k` of view.poses, a part the pose draws along a path of its own
 * is that path (how it is drawn, its mass and size there), and one it moves is the size it is as built.
 * @param {View} view @param {string} id @param {number} [k] @returns {Panel | null} */
export function panelOf(view, id, k = 0) {
  const frameItem = itemOf(view, id);
  if (!frameItem) return null;
  const { moved } = posePartsOf(view, k);
  const own = posesOf(view)[k] ? posesOf(view)[k].drawn.find((d) => d.id === id) : undefined;
  const item = own ? { ...frameItem, ...own } : frameItem;
  const line = item.line ? view.lines[item.line] : undefined;
  const c = countOf(view, item);
  const env = item.model === "envelope", path = item.model === "path";
  /** @type {[string, string][]} */
  const facts = [["Drawn", env
    ? "as an envelope: stand-in shapes (boxes, cylinders, cones, prisms) at the sizes its datasheet or an estimate gives, not its maker's model"
    : path ? `along a path, which no gate checks as a shape${item.why ? `: ${item.why}` : ""}`
    : "from its own CAD"]];
  if (item.material) facts.push(["Material", item.material]);
  facts.push(["Mass", massOf(item)]);
  if (Array.isArray(item.bbox) && item.bbox.length === 6) {
    const [x0, y0, z0, x1, y1, z1] = item.bbox;
    facts.push(["Size", `${fmt(x1 - x0)} × ${fmt(y1 - y0)} × ${fmt(z1 - z0)} mm (x, y, z)${env || path ? ", of what is drawn" : ""}${moved.includes(id) ? ", as built" : ""}`]);
  }
  if (item.tags && item.tags.length) facts.push(["Tags", item.tags.join(", ")]);
  if (line) facts.push(["In the BOM", `${line.qtyPerUnit || !line.qtyPerBatch ? `${line.qtyPerUnit ?? 1} a unit` : `${line.qtyPerBatch} for the batch`} (${item.line})`]);
  else if (item.line && view.bom === false) facts.push(["In the BOM", `bom.json could not be read (line ${item.line})`]);
  const problems = shownOf(view, (p) => p.parts.includes(id));
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
  // A check of an earlier design says what it found then, and one that may be of one, what it found when it ran.
  const { changed, missing } = staleParts(view);
  const then = changed.length > 0, unsure = !then && missing.length > 0;
  const summary = !gates.length ? ""
    : failing.length ? `${then ? "On an earlier design it failed" : unsure ? "When it ran it failed" : "It fails"} ${failing.length} of its ${plural(gates.length, "gate")}, with ${plural(n, "problem")}${on ? ` on ${plural(on, "part")}: pick one to see its own` : ""}.`
    : `${then ? "On an earlier design it passed" : unsure ? "When it ran it passed" : "It passes"} all ${plural(gates.length, "gate")}${risks ? `, with ${plural(risks, "risk")} the design accepts` : ""}${
      then ? "; the design has changed since: see below" : unsure ? "; it may have been of an earlier design: see below" : notes.length ? ", but not all of it is proven: see below"
        : view.ok === false ? ", but system.json says it fails: run sprue system again" : ""}.`;
  return {
    ok,
    summary,
    failing,
    accepted,
    problems: shownOf(view, (p) => !p.parts.some((x) => ids.has(x))),
    notes,
  };
}

/** The poses the model draws (view.poses), the first the frame's, as built. @param {View} view @returns {Pose[]} */
const posesOf = (view) => (Array.isArray(view.poses) ? view.poses : []);
/** A pose's name as the start of a sentence. @param {string} name */
const cap = (name) => (name ? `${name[0].toUpperCase()}${name.slice(1)}` : name);

/** The pose named `name` by its place in view.poses, or -1 for one the model doesn't draw. Without view.poses (a
 * system.json of an earlier Sprue) the model draws only the frame, the first weighing's pose (0).
 * @param {View} view @param {string} name */
export function poseIndexOf(view, name) {
  const poses = posesOf(view);
  if (poses.length) return poses.findIndex((p) => p.name === name);
  return view.stability != null && name === view.stability.pose ? 0 : -1;
}

/** What pose `k` of view.poses does to the parts of the frame the model draws, by their ids: those it moves (`moved`),
 * those it takes out and doesn't say where it puts (`hidden`: not drawn), and those it draws along another path in
 * place of the frame's (`redrawn`). None for a pose it doesn't have. @param {View} view @param {number} k */
export function posePartsOf(view, k) {
  const pose = posesOf(view)[k];
  if (!pose) return { moved: [], hidden: [], redrawn: [] };
  const ids = new Set(view.items.map((i) => i.id));
  const drop = [...new Set(pose.drop)].filter((id) => ids.has(id));
  return { moved: pose.moved ? drop : [], hidden: pose.moved ? [] : drop, redrawn: [...new Set(pose.drawn.map((d) => d.id))].filter((id) => ids.has(id)) };
}

/** Whether problem `p`'s mark is where its parts are in pose `k`: a stability pose's in its own pose; any other's, of
 * the frame as built, where the pose leaves every part it names as built (one of no one part where it leaves them all).
 * @param {View} view @param {Problem} p @param {number} k */
export function markInPose(view, p, k) {
  if (p.pose) return poseIndexOf(view, p.pose) === k;
  const { moved, hidden, redrawn } = posePartsOf(view, k);
  const changed = new Set([...moved, ...hidden, ...redrawn]);
  return p.parts.length ? p.parts.every((id) => !changed.has(id)) : !changed.size;
}

/** The line that says what pose `k` draws: what it moves, what it draws along another path and what it doesn't draw,
 * and that no gate checks how the parts fit there; null for the frame's pose when it changes nothing, which is the
 * product as built. @param {View} view @param {number} k */
export function poseTextOf(view, k) {
  const pose = posesOf(view)[k];
  if (!pose) return null;
  const { moved, hidden, redrawn } = posePartsOf(view, k);
  const did = [
    moved.length ? `${plural(moved.length, "part")} moved where it puts ${moved.length === 1 ? "it" : "them"}` : "",
    redrawn.length ? `${redrawn.map((id) => labelOf(view, id)).join(", ")} drawn as it bends ${redrawn.length === 1 ? "it" : "them"}` : "",
    hidden.length ? `${plural(hidden.length, "part")} not drawn, as it doesn't say where ${hidden.length === 1 ? "it goes" : "they go"}` : "",
  ].filter(Boolean);
  if (!did.length) return k ? `${cap(pose.name)}: every part where it is as built.` : null;
  return `${cap(pose.name)}, as the stability gate weighs it: ${did.join("; ")}. No gate checks how the parts fit in this pose.`;
}

/** A pose as the Pose list names it: its name, and the stability gate's problems and accepted risks of it.
 * @param {View} view @param {number} k */
export function poseOptionOf(view, k) {
  const pose = posesOf(view)[k];
  if (!pose) return "";
  const of = view.problems.filter((p) => p.pose === pose.name);
  const risks = of.filter((p) => p.accepted).length, problems = of.length - risks;
  return [cap(pose.name), problems ? plural(problems, "stability problem") : "", risks ? `${plural(risks, "stability risk")} accepted` : ""]
    .filter(Boolean).join(" · ");
}

/** Whether a problem has a place in a pose the model draws: an `at` of three numbers, and for a stability pose's
 * (`pose`) a pose in view.poses, whose parts the model draws where the pose has them.
 * @param {View} view @param {Problem} p */
const placed = (view, p) => Array.isArray(p.at) && p.at.length === 3 && p.at.every(Number.isFinite)
  && (!p.pose || poseIndexOf(view, p.pose) >= 0);

/** The problems and accepted risks the view marks where the check found them, each with its place in view.problems
 * (`i`) and `at` in mm in the frame.
 * @param {View} view @returns {(Problem & { i: number })[]} */
export const marksOf = (view) => view.problems.flatMap((p, i) => (placed(view, p) ? [{ ...p, i }] : []));

/** What the readout says of marks shown (`list`, indices into view.problems): one, "Problem · clearance · Base top,
 * Junction" (or "the whole product" for a problem of no one part); several, "6 problems · clearance".
 * @param {View} view @param {number[]} list */
export function markReadoutOf(view, list) {
  const ps = list.map((i) => view.problems[i]).filter(Boolean);
  if (!ps.length) return "";
  const gates = [...new Set(ps.map((p) => p.gate))].join(", ");
  const risks = ps.every((p) => p.accepted);
  if (ps.length > 1) return `${plural(ps.length, risks ? "accepted risk" : "problem")} · ${gates}`;
  const p = ps[0];
  return [p.accepted ? "Accepted risk" : "Problem", p.gate, p.parts.length ? p.parts.map((id) => labelOf(view, id)).join(", ") : "the whole product"].join(" · ");
}

/** What the Mass line says of the whole product, as the stability gate weighed it in pose `k` of view.poses (the
 * first, the frame's, by default; view.stability for a view of no poses): the pose, its mass, how much is estimated
 * and how much has no part in the model (what the check weighs as points, such as an arm or a cable, which the parts
 * drawn in that pose don't sum to), its centre of mass in mm in the frame, and how far it tilts before it tips; null
 * without a weighing of that pose.
 * @param {View} view @param {number} [k] */
export function massTextOf(view, k = 0) {
  const pose = posesOf(view)[k];
  // A pose's own weighing, none for one the gate couldn't weigh; without poses (an earlier Sprue's) the first weighing.
  const s = posesOf(view).length ? (pose ? pose.mass : null) : k ? null : view.stability;
  if (!s) return null;
  // The parts drawn in the pose: its own along a path in place of the frame's of their ids, none it doesn't draw.
  const { hidden } = posePartsOf(view, k);
  const own = new Map((pose ? pose.drawn : []).map((d) => [d.id, d]));
  const drawn = view.items.reduce((t, i) => {
    const m = hidden.includes(i.id) ? null : (own.get(i.id) || i).massG;
    return t + (Number.isFinite(m) ? m : 0);
  }, 0);
  // Each part's mass is rounded to a tenth of a gram: a sum that far off is the rounding, not a part left out.
  const off = s.massG - drawn;
  return [
    `${s.pose ? `${cap(s.pose)}: ` : ""}${fmt(s.massG)} g${s.estimatedG > 0 ? `, ${fmt(s.estimatedG)} g of it estimated (${Math.round((100 * s.estimatedG) / s.massG)}%)` : ""}${
      off > 0.05 + 0.005 * view.items.length ? `, ${fmt(off)} g of it with no part in the model (the check weighs it as points)` : ""}`,
    `centre of mass at (${s.com.map((c) => fmt(c)).join(", ")}) mm`,
    s.tiltDeg == null ? "" : s.tiltDeg > 0 ? `tilted past ${fmt(s.tiltDeg)}° it tips over` : "its centre of mass is outside what it stands on, so it tips over",
  ].filter(Boolean).join(" · ");
}

/** The legend: how many parts are drawn from CAD, how many are envelopes and which are drawn along a path (`paths`,
 * by name, as the readout names them), the BOM lines not in the model (those
 * the check says it doesn't place, with its reason, and any other line no part in the frame is of: a line for the
 * batch, such as a reel of wire, or one the check lost), the lines whose parts don't follow the drawing's steps
 * and apart pose, with why (`unsure`; `steps` false when there is no drawing to follow at all), and how many problems
 * and accepted risks are marked, how many of them are of a pose other than the frame's (`inPose`: marked while the
 * view shows it), and of those that aren't, how many are of a stability pose the model doesn't draw (`otherPose`), how
 * many are on parts no pose the model draws leaves as built (`noPose`) and how many the check gives no place
 * (`noPlace`).
 * @param {View} view @returns {{ cad: number, envelopes: number, paths: string[], unplaced: { line: string, name: string, why: string }[],
 *   steps: boolean, unsure: { line: string, name: string, why: string }[],
 *   marks: { problems: number, risks: number, inPose: number, otherPose: number, noPose: number, noPlace: number } }} */
export function legendOf(view) {
  const envelopes = view.items.filter((i) => i.model === "envelope").length;
  const paths = view.items.filter((i) => i.model === "path").map((i) => labelOf(view, i.id));
  const said = (view.relations && view.relations.unplaced) || {};
  const unplaced = Object.entries(said).map(([line, why]) => ({ line, name: view.lines[line] ? view.lines[line].name : line, why }));
  const drawn = new Set(view.items.map((i) => i.line));
  for (const [id, line] of Object.entries(view.lines || {})) {
    if (drawn.has(id) || id in said) continue;
    unplaced.push({ line: id, name: line.name, why: !line.qtyPerUnit && line.qtyPerBatch ? "for the batch, not a unit: not drawn" : "no part of it is in the frame" });
  }
  const a = view.assembly;
  const unsure = a ? Object.entries(a.unsure || {}).map(([line, why]) => ({ line, name: view.lines[line] ? view.lines[line].name : line, why })) : [];
  // A mark is drawn in the poses that leave its parts where the check found it: none, when every pose moves one.
  const ks = Array.from({ length: Math.max(posesOf(view).length, 1) }, (_, k) => k);
  const placedAt = marksOf(view), marked = placedAt.filter((p) => ks.some((k) => markInPose(view, p, k)));
  const rest = view.problems.filter((p) => !placed(view, p));
  const otherPose = rest.filter((p) => p.pose && Array.isArray(p.at) && p.at.length === 3 && p.at.every(Number.isFinite)).length;
  return { cad: view.items.length - envelopes - paths.length, envelopes, paths, unplaced, steps: Boolean(a && a.steps.length), unsure,
    marks: { problems: marked.filter((p) => !p.accepted).length, risks: marked.filter((p) => p.accepted).length,
      inPose: marked.filter((p) => !markInPose(view, p, 0)).length, otherPose, noPose: placedAt.length - marked.length,
      noPlace: rest.length - otherPose } };
}

// ---- the function probes: plain functions of view.probes (pipeline/model.ts) -----------------------------------------

/** Each kind of probe in a word, as the panel and the readout name it. */
const PROBE_KINDS = { sound: "sound", port: "port", view: "view", light: "light", keepout: "keep-out" };
/** What the panel and the readout say of a probe's state. */
const PROBE_STATES = { pass: "passes", fail: "fails", accepted: "falls short, accepted", unknown: "system.json doesn't say whether it passes" };
/** A share as a percentage, to a tenth where that's what tells it from its need. @param {number} x */
const pct = (x) => `${fmt(x * 100)}%`;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / Math.hypot(...a));
/** Two directions square to `n` and to each other. @param {number[]} n */
function squareTo(n) {
  const u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return [u, cross(unit(n), u)];
}
/** A circle of radius `r` round `c`, square to `n`, as `k` segments. */
function circle(c, n, r, k = 32) {
  const [u, w] = squareTo(n);
  const at = (j) => add(c, add(mul(u, r * Math.cos((2 * Math.PI * j) / k)), mul(w, r * Math.sin((2 * Math.PI * j) / k))));
  return Array.from({ length: k }, (_, j) => [at(j), at(j + 1)]);
}
/** A box's twelve edges. @param {number[]} b [x0, y0, z0, x1, y1, z1] */
function boxEdges(b) {
  const p = (i) => [b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]];
  return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].map(([i, j]) => [p(i), p(j)]);
}
/** Where the points within `r` of a box end, cut through its middle square to each axis: three rectangles with round
 * corners, each the box's face grown by `r`. @param {number[]} b @param {number} r */
function zoneOf(b, r, k = 8) {
  const out = [];
  const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], half = [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const at = (s, t) => { const p = [...c]; p[i] += s; p[j] += t; return p; };
    // Round the rectangle: each corner's quarter circle, then the side to the next corner.
    for (const [si, sj, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
      const ci = si * half[i], cj = sj * half[j];
      for (let q = 0; q < k; q++) {
        const t0 = ((a0 + (90 * q) / k) * Math.PI) / 180, t1 = ((a0 + (90 * (q + 1)) / k) * Math.PI) / 180;
        out.push([at(ci + r * Math.cos(t0), cj + r * Math.sin(t0)), at(ci + r * Math.cos(t1), cj + r * Math.sin(t1))]);
      }
      // From the end of this corner's arc to the start of the next corner's, counterclockwise.
      const e = ((a0 + 90) * Math.PI) / 180;
      const n = [[-1, 1], [-1, -1], [1, -1], [1, 1]][a0 / 90];
      out.push([at(ci + r * Math.cos(e), cj + r * Math.sin(e)), at(n[0] * half[i] + r * Math.cos(e), n[1] * half[j] + r * Math.sin(e))]);
    }
  }
  return out;
}

/** A probe's state: "pass" when it meets its need, "accepted" when it falls short and every problem of its own is a
 * risk the design accepts, "fail" when it falls short otherwise (a camera whose target has no surface to see fails
 * even with a reason), "unknown" where system.json doesn't say (an earlier Sprue).
 * @param {View} view @param {Probe} probe @returns {"pass" | "fail" | "accepted" | "unknown"} */
export function probeStateOf(view, probe) {
  if (probe.ok === true) return "pass";
  if (probe.ok !== false) return "unknown";
  const own = (probe.problems || []).map((k) => view.problems[k]).filter(Boolean);
  return own.length && own.every((p) => p.accepted) ? "accepted" : "fail";
}

/** The function gate's probes, in its order, each with its place in view.probes (`i`) and its state.
 * @param {View} view @returns {(Probe & { i: number, state: string })[]} */
export const probeRowsOf = (view) => (Array.isArray(view.probes) ? view.probes : []).map((p, i) => ({ ...p, i, state: probeStateOf(view, p) }));

/** How long the view draws what a probe casts with no end of its own (a speaker's rays, a light's cone, a camera with
 * no target): a tenth of the diagonal of the box round the product's parts as built, in mm; 10 without one.
 * @param {View} view */
export function probeReachOf(view) {
  const boxes = view.items.map((i) => i.bbox).filter((b) => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite));
  if (!boxes.length) return 10;
  const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b[a]))), hi = [3, 4, 5].map((a) => Math.max(...boxes.map((b) => b[a])));
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 10 || 10;
}

/** A probe as lines to draw, in mm in the frame, each [from, to]: `lines` at full strength, `faint` lighter, and the
 * box round them all ([x0, y0, z0, x1, y1, z1]); null for a probe with no place. A speaker's or a port's disc, its
 * rays out along its normal (`reach` long, at least its diameter) and an arrow; a camera's image near it, the edges of
 * its field out to its target's middle (`reach` three times, with none) and its target's box; a light's cone `reach`
 * long round its axis; a keep-out's region, and where `need` mm round it ends, cut through its middle three ways.
 * @param {Probe} probe @param {number} reach
 * @returns {{ lines: number[][][], faint: number[][][], box: number[] } | null} */
export function probeShapeOf(probe, reach) {
  const w = probe && probe.where;
  if (!w) return null;
  const lines = [], faint = [];
  if (probe.kind === "sound" || probe.kind === "port") {
    const n = unit(w.normal), long = Math.max(reach, 2 * w.radius), end = add(w.center, mul(n, long));
    const [u] = squareTo(n), head = Math.min(long / 5, Math.max(w.radius, long / 10));
    lines.push(...circle(w.center, n, w.radius), [w.center, end], [end, add(end, add(mul(n, -head), mul(u, head / 2)))],
      [end, add(end, add(mul(n, -head), mul(u, -head / 2)))]);
    faint.push(...circle(end, n, w.radius), ...circle(w.center, n, w.radius, 8).map(([a]) => [a, add(a, mul(n, long))]));
  } else if (probe.kind === "view") {
    const ax = unit(w.axis), up = unit(w.up), right = cross(ax, up);
    const th = Math.tan((w.hfovDeg * Math.PI) / 360), tv = Math.tan((w.vfovDeg * Math.PI) / 360);
    const mid = w.targetBox ? dot(sub([0, 1, 2].map((a) => (w.targetBox[a] + w.targetBox[a + 3]) / 2), w.origin), ax) : 0;
    const far = mid > 0 ? mid : 3 * reach, near = Math.min(reach / 2, far);
    const corners = (d) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => add(w.origin, mul(add(ax, add(mul(right, th * i), mul(up, tv * j))), d)));
    const rect = (ps) => ps.map((p, k) => [p, ps[(k + 1) % 4]]);
    const n = corners(near), f = corners(far);
    // The image near the camera, its top marked, as a camera's icon is.
    lines.push(...rect(n), [add(w.origin, mul(add(ax, mul(up, tv * 1.3)), near)), add(w.origin, mul(add(ax, add(mul(right, th * 0.3), mul(up, tv))), near))],
      [add(w.origin, mul(add(ax, mul(up, tv * 1.3)), near)), add(w.origin, mul(add(ax, add(mul(right, -th * 0.3), mul(up, tv))), near))]);
    faint.push(...n.map((p) => [w.origin, p]), ...n.map((p, k) => [p, f[k]]), ...rect(f));
    if (w.targetBox) lines.push(...boxEdges(w.targetBox));
  } else if (probe.kind === "light") {
    const ax = unit(w.axis), a = (w.halfAngleDeg * Math.PI) / 180;
    const c = add(w.origin, mul(ax, reach * Math.cos(a))), r = reach * Math.sin(a);
    lines.push(...circle(c, ax, r), [w.origin, add(w.origin, mul(ax, reach))]);
    faint.push(...circle(c, ax, r, 8).map(([p]) => [w.origin, p]));
  } else if (probe.kind === "keepout") {
    lines.push(...boxEdges(w.region));
    const need = probe.found && probe.found.need;
    if (num(need) && need > 0) faint.push(...zoneOf(w.region, need));
  } else return null;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const seg of [...lines, ...faint]) for (const p of seg) for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], p[a]); box[a + 3] = Math.max(box[a + 3], p[a]); }
  return { lines, faint, box };
}

/** What a probe found, in words: "30.4% of its sound gets out, needs 20%, aims for 40%"; "" where system.json doesn't
 * say. A part it names is named as the readout names it. @param {View} view @param {Probe} probe */
export function probeFoundOf(view, probe) {
  const f = probe.found || {};
  switch (probe.kind) {
    case "sound":
      return num(f.openShare) && num(f.need) ? `${pct(f.openShare)} of its sound gets out, needs ${pct(f.need)}${num(f.aim) ? `, aims for ${pct(f.aim)}` : ""}` : "";
    case "port":
      return num(f.openShare) && num(f.need) ? `${pct(f.openShare)} of the port is open, needs ${pct(f.need)}` : "";
    case "light":
      return num(f.share) && num(f.need) ? `${pct(f.share)} of its light gets ${probe.where && probe.where.target && probe.where.target !== "out" ? `to ${probe.where.target}` : "out"}, needs ${pct(f.need)}` : "";
    case "view": {
      if (!num(f.blockedShare)) return "";
      const fills = `the product fills ${pct(f.blockedShare)} of its image`;
      if (!("targetOutside" in f)) return f.blockedShare ? `${fills}, which must show none of it` : "it sees none of the product, as it must";
      if (f.targetOutside == null || f.targetHidden == null) return `its target has no upper surface to see; ${fills}`;
      if (!num(f.targetOutside) || !num(f.targetHidden)) return "";
      return `${f.targetOutside || f.targetHidden ? `${pct(f.targetOutside)} of its target out of the image, ${pct(f.targetHidden)} hidden`
        : "all of its target in the image, none of it hidden"}; ${fills}`;
    }
    case "keepout":
      if (!num(f.need)) return "";
      return num(f.nearestMetalMm) ? `the nearest metal is ${fmt(f.nearestMetalMm, 2)} mm from it${typeof f.nearest === "string" && f.nearest ? ` (${labelOf(view, f.nearest)})` : ""}, needs ${fmt(f.need, 2)} mm`
        : `no metal near it, needs ${fmt(f.need, 2)} mm clear`;
    default:
      return "";
  }
}

/** The parts a probe names, as its panel row lists them: `label` and `ids` of what is in its way (a sound's, a port's
 * or a light's rays hit them; a camera with no target sees them; one with a target finds them hiding it), or for a
 * keep-out, the metal too near (`mm` each) or else the nearest; null for none.
 * @param {Probe} probe @returns {{ label: string, ids: string[], mm?: number[] } | null} */
export function probeBlockersOf(probe) {
  const f = probe.found || {};
  if (probe.kind === "keepout") {
    const within = Array.isArray(f.within) ? f.within.filter((x) => x && typeof x.id === "string") : [];
    if (within.length) return { label: "Metal too near", ids: within.map((x) => x.id), mm: within.map((x) => x.mm) };
    return typeof f.nearest === "string" && f.nearest ? { label: "Nearest metal", ids: [f.nearest] } : null;
  }
  const ids = Array.isArray(f.blockedBy) ? f.blockedBy.filter((x) => typeof x === "string") : [];
  if (!ids.length) return null;
  const label = probe.kind === "view" ? ("targetOutside" in f ? "Hiding its target" : "In its image") : probe.kind === "light" ? "Its light hits" : "Its rays hit";
  return { label, ids };
}

/** What the readout says of a probe shown: "speaker · sound · 30.4% of its sound gets out, needs 20% · passes".
 * @param {View} view @param {Probe} probe */
export function probeReadoutOf(view, probe) {
  return [probe.id, PROBE_KINDS[probe.kind] || probe.kind, probeFoundOf(view, probe), PROBE_STATES[probeStateOf(view, probe)]].filter(Boolean).join(" · ");
}

/** The probes that name a part, as its panel lists them: each probe's place in view.probes (`i`), and what the part is
 * to it: its source, in its way, metal too near (with how near) or the nearest metal.
 * @param {View} view @param {string} id @returns {{ i: number, role: string }[]} */
export function partProbesOf(view, id) {
  return probeRowsOf(view).flatMap((p) => {
    const roles = [];
    if (p.where && p.where.source === id) roles.push("its source");
    const b = probeBlockersOf(p);
    const k = b ? b.ids.indexOf(id) : -1;
    if (k >= 0) {
      roles.push(b.mm ? `metal too near it: ${num(b.mm[k]) ? `${fmt(b.mm[k], 2)} mm` : "how near isn't said"}`
        : b.label === "Nearest metal" ? `the nearest metal${num(p.found.nearestMetalMm) ? `, ${fmt(p.found.nearestMetalMm, 2)} mm from it` : ""}`
          : { "Hiding its target": "hides part of its target", "In its image": "in its image", "Its light hits": "its light hits this part" }[b.label] || "its rays hit this part");
    }
    return roles.length ? [{ i: p.i, role: roles.join("; ") }] : [];
  });
}

/** What the legend and the Probes toggle say of the probes: how many there are, drawn (`placed`, with a place), and
 * of each state, with the ids of those that fail and those that fall short with a reason.
 * @param {View} view */
export function probeCountOf(view) {
  const rows = probeRowsOf(view);
  const of = (s) => rows.filter((p) => p.state === s);
  return { n: rows.length, placed: rows.filter((p) => p.where).length, pass: of("pass").length, unknown: of("unknown").length,
    fail: of("fail").map((p) => p.id), accepted: of("accepted").map((p) => p.id) };
}

/** The probes in a sentence: "8 of 9 pass; pi-radio fails", "both pass", "1 of 3 passes; a fails; b falls short,
 * accepted". @param {View} view */
export function probeSummaryOf(view) {
  const c = probeCountOf(view);
  if (!c.n) return "";
  const lead = c.pass === c.n ? (c.n === 1 ? "it passes" : c.n === 2 ? "both pass" : `all ${c.n} pass`) : `${c.pass} of ${c.n} ${c.pass === 1 ? "passes" : "pass"}`;
  const list = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more` : ids.join(", "));
  return [lead, c.fail.length ? `${list(c.fail)} ${c.fail.length === 1 ? "fails" : "fail"}` : "",
    c.accepted.length ? `${list(c.accepted)} ${c.accepted.length === 1 ? "falls" : "fall"} short, accepted` : "",
    c.unknown ? `${c.unknown} not said` : ""].filter(Boolean).join("; ");
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
  const problems = shownOf(view, (p) => p.parts.some((x) => parts.includes(x)));
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
 * #select=<a BOM line> (the drawing's), combined with &; and #pose=<a pose's name>, this view's alone, its place in
 * view.poses (0, the frame's, by default). A step past the last is the last; a part, line or pose the view doesn't
 * know is none. A pose is of the whole product put together: with apart or a step, which the drawing follows too, it
 * is the frame's.
 * @param {string} hash @param {View} view
 * @returns {{ apart: boolean, at: number, part: string | null, line: string | null, pose: number }} */
export function hashOf(hash, view) {
  const out = { apart: false, at: 0, part: null, line: null, pose: 0 };
  const decode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const n = stepsOf(view).length;
  for (const token of String(hash || "").replace(/^#/, "").split("&").filter(Boolean)) {
    const cut = token.indexOf("=");
    const key = decode(cut < 0 ? token : token.slice(0, cut)), value = cut < 0 ? undefined : decode(token.slice(cut + 1));
    if (key === "apart") out.apart = value !== "0";
    else if (key === "step") out.at = Math.max(0, Math.min(n, parseInt(value, 10) || 0));
    else if (key === "part") out.part = value && view.items.some((i) => i.id === value) ? value : null;
    else if (key === "select") out.line = value && (Object.hasOwn(view.lines, value) || view.items.some((i) => i.line === value)) ? value : null;
    else if (key === "pose") out.pose = Math.max(0, posesOf(view).findIndex((p) => p.name === value));
  }
  if (out.apart || out.at) out.pose = 0;
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

/** The inputs the whole-product check was run on that aren't as they are now (view.stale, as systemAudit compares
 * them), split: those changed (or new) since, and those not in the folder now (view.missing: a folder without pcb/,
 * which git ignores, has no board's zip), which may be as they were. @param {View} view */
function staleParts(view) {
  const gone = new Set(view.missing || []);
  const stale = view.stale || [];
  return { changed: stale.filter((f) => !gone.has(f)), missing: stale.filter((f) => gone.has(f)) };
}

/** Files named in a sentence: "a", "a and b", "a, b and c", "a, b, c and 2 more". @param {string[]} files */
function namesOf(files) {
  const named = files.slice(0, 3), more = files.length - named.length;
  return more ? `${named.join(", ")} and ${more} more`
    : named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0] || "";
}

/** The command that draws the model again. @param {View} view */
const systemCommand = (view) => `sprue system${view.slug ? ` ${view.slug}` : ""}`;

/** The line over the bar when the model is, or may be, of an earlier design (staleParts), or "" when every file it
 * was drawn from is as it was. The model is drawn by the same run as the check, so it is as old as the check.
 * @param {View} view */
export function staleOf(view) {
  const { changed, missing } = staleParts(view);
  const gone = missing.length ? `${namesOf(missing)}, which ${missing.length === 1 ? "isn't" : "aren't"} here to compare` : "";
  if (changed.length) {
    return `A model of an earlier design: ${namesOf(changed)} ${changed.length === 1 ? "has" : "have"} changed since sprue system drew it, so a part may not be where it is now${
      gone ? ` (it was also drawn with ${gone})` : ""}. Run ${systemCommand(view)} again to draw it.`;
  }
  return gone ? `This model may be of an earlier design: it was drawn with ${gone}.` : "";
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
 * outline it draws from where the camera is (outline below), both dashed for an envelope and dotted for a part drawn
 * along a path. Returns the meshes named by
 * an item, by its id (the node's name in the GLB, which GLTFLoader keeps in userData.name); every mesh has its part in
 * userData.sprue, so a node no item names is drawn but not picked. */
export function prepare(three, scene, colors, ids) {
  const { THREE } = three;
  const parts = new Map();
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const was = mesh.material;
    const kind = was && (was.name === "envelope" || was.name === "path") ? was.name : was && was.map ? "board" : "cad";
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
    const stroke = STROKE[kind];
    const material = stroke
      ? new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: stroke[0], gapSize: stroke[1] })
      : new THREE.LineBasicMaterial({ color: 0xffffff });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_DEG), material);
    if (stroke) edges.computeLineDistances();
    edges.raycast = () => {}; // a pick hits the part, never its edges
    edges.name = `${name} edges`;
    mesh.add(edges);
    const part = { id: name, mesh, edges, kind, outline: null };
    const o = outlineEdges(mesh.geometry);
    if (o.count) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(o.count * 6), 3).setUsage(THREE.DynamicDrawUsage));
      if (stroke) geometry.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(o.count * 2), 1).setUsage(THREE.DynamicDrawUsage));
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
  const env = part.kind in STROKE; // a stand-in: paper faces, mid edges
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

/** The face of `geometry` nearest `point`, both in the geometry's own frame: how far off it is, squared, and its outward
 * normal (null for a geometry with no faces). A problem's mark sits on that face. */
export function faceNear(three, geometry, point) {
  const { THREE } = three;
  const pos = geometry.attributes.position, index = geometry.index;
  const n = index ? index.count : pos.count;
  const tri = new THREE.Triangle(), on = new THREE.Vector3();
  let d2 = Infinity, normal = null;
  for (let i = 0; i + 2 < n; i += 3) {
    tri.a.fromBufferAttribute(pos, index ? index.getX(i) : i);
    tri.b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1);
    tri.c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2);
    const d = tri.closestPointToPoint(point, on).distanceToSquared(point);
    if (d < d2 && tri.getArea() > 0) { d2 = d; normal = tri.getNormal(new THREE.Vector3()); }
  }
  return { d2, normal };
}

/** The outward normal, in the frame, of the face a mark at `at` ([x, y, z] mm in the frame) sits on: of the parts `ids`
 * where a pose draws them, the face nearest it. `drawnOf(id)` is a part's geometry (in the frame as built) and the
 * Matrix4 the pose moves it by (null for none), or null for a part the pose doesn't draw. Null for a mark of no part
 * drawn. */
export function markFaceOf(three, at, ids, drawnOf) {
  const { THREE } = three;
  let face = null;
  for (const id of ids) {
    const d = drawnOf(id);
    if (!d) continue;
    // Where the mark is on the part as built, as the move takes it back there.
    const f = faceNear(three, d.geometry, new THREE.Vector3(...at).applyMatrix4(d.move ? d.move.clone().invert() : new THREE.Matrix4()));
    if (f.normal && (!face || f.d2 < face.d2)) face = { d2: f.d2, normal: d.move ? f.normal.transformDirection(d.move) : f.normal };
  }
  return face ? face.normal : null;
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
 * that k (0 in place, 1 apart), or null for a part not shown. Each part's own box, in its parent's frame, moved there
 * (and first by `moved(part)`, a Matrix4 in that frame, for a part a stability pose moves); an empty box when none is
 * shown.
 * @param {any} three
 * @param {any[]} parts
 * @param {(part: any) => number[]} lift
 * @param {(part: any) => number | null} shown
 * @param {((part: any) => any) | null} [moved]
 */
export function poseBox(three, parts, lift, shown, moved = null) {
  const { THREE } = three;
  const box = new THREE.Box3();
  for (const part of parts) {
    const k = shown(part);
    if (k == null || !part.mesh.geometry.boundingBox) continue;
    const [x, y, z] = lift(part);
    const b = part.mesh.geometry.boundingBox.clone();
    const m = moved ? moved(part) : null;
    if (m) b.applyMatrix4(m);
    b.translate(new THREE.Vector3(x * k, y * k, z * k));
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
 * there, so never one the near plane cuts away, nor one `skip` names (a case drawn as glass, which a pick goes through).
 * @param {Set<string> | null} [skip] */
export function pickAt(three, camera, parts, x, y, skip = null) {
  const { THREE } = three;
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const meshes = [...parts.values()].filter((p) => !skip || !skip.has(p.id)).map((p) => p.mesh).filter((m) => m.visible);
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

let probe = null; // a 1 px canvas that reads a colour back
/** A token's colour as three reads it: #rgb and #rrggbb pass, and any other way a page may write one (color-mix(),
 * oklch(), #rrggbbaa, rgb(1 2 3), which three can't read) is drawn on a pixel and read back as rgb(r, g, b); one the
 * browser can't read is `fallback`. */
function cssColor(value, fallback) {
  if (!value) return fallback;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  try {
    probe ||= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!probe) return fallback;
    probe.canvas.width = probe.canvas.height = 1;
    // A colour the canvas can't read leaves fillStyle as it was: two different ones first tell that apart.
    probe.fillStyle = "#000";
    probe.fillStyle = value;
    const a = probe.fillStyle;
    probe.fillStyle = "#fff";
    probe.fillStyle = value;
    if (a !== probe.fillStyle) return fallback;
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
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
 * @param {object} view       pipeline/model.ts modelView: items, relations, problems, gates, lines, files, probes
 * @param {ArrayBuffer} glb   previews/system.glb
 * @param {{ THREE: object, OrbitControls: Function, GLTFLoader: Function }} three
 * @param {{ readout?: Element | false, scope?: Element, controls?: Element, legend?: Element, panel?: Element,
 *   fileHref?: (path: string) => string | null, title?: string, headingLevel?: number, hash?: boolean }} opts
 *   readout defaults to [data-readout] inside scope (the closest [data-a2-figure] around root); false turns it off.
 *   controls, legend and panel are where the bar (with the line under it), the legend and the part's panel go, as the
 *   drawing's controls and legend do: a page whose model sits in a card puts them under it. Each is appended to (it
 *   should hold nothing that takes keys), and by default they go under the model in root.
 *   fileHref makes each listed file a link (a page in the product folder can pass fileLink). title names the product
 *   to a screen reader (its slug by default); headingLevel is the panel's title's (3 by default; its blocks' one below).
 *   hash (true by default): start in the pose the page's hash asks for (hashOf), and follow it when it changes.
 * @returns {{ ready: Promise<{ ok: boolean, why?: string }>, select(id: string | null): void, fit(): void,
 *   explode(on?: boolean): boolean, step(n: number): number, marks(on?: boolean): boolean, xray(on?: boolean): boolean,
 *   mass(on?: boolean): boolean, show(list: number | number[]): void, pose(k?: number | string): number,
 *   probes(on?: boolean): boolean, showProbe(i: number): void, readonly probe: number | null,
 *   probeLook(i: number): { color: string, opacity: number } | null,
 *   readonly apart: boolean, readonly at: number, readonly posed: number,
 *   readonly pinned: string | null, readonly hover: string | null, readonly line: string | null,
 *   readonly spot: number[], readonly toggles: { problems: boolean, xray: boolean, mass: boolean, probes: boolean },
 *   readonly colors: Record<string, string>,
 *   readonly drawn: { marks: number[], com: boolean, coms: number[], parts: string[], glass: string[], ghosts: string[],
 *     probes: number[] },
 *   strokeOf(id: string): { edges: number[] | null, ghost: number[] | null } | null,
 *   boxOf(id: string): number[] | null,
 *   screenOf(id: string | number[]): { x: number, y: number } | null, destroy(): void }}
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
  const marks = marksOf(view);
  // The case: every part another is meant to be inside, glass in the X-ray.
  const cases = new Set(((view.relations && view.relations.inside) || []).flatMap((x) => x.case || []).filter((id) => ids.has(id)));
  const poses = posesOf(view);
  // The Mass line of each pose (of the frame's alone, without view.poses): what the stability gate weighed in it.
  const massTexts = poses.length ? poses.map((_, k) => massTextOf(view, k)) : [massTextOf(view)];
  const mass = massTexts.some(Boolean);
  // What the line under the bar says of each pose (none for the frame's, as built).
  const poseTexts = (poses.length ? poses : [null]).map((_, k) => poseTextOf(view, k));
  // Where each mark is marked: the poses (by their place in view.poses) that have its parts where it is.
  const markPoses = new Map(marks.map((m) => [m.i, new Set(Array.from({ length: Math.max(poses.length, 1) }, (_, k) => k).filter((k) => markInPose(view, m, k)))]));
  const marked = new Set(marks.filter((m) => markPoses.get(m.i).size).map((m) => m.i));
  // The function gate's probes, and those the model draws: each with a place, as built.
  const probes = probeRowsOf(view);
  const drawable = probes.filter((p) => p.where && probeShapeOf(p, 1));
  const reach = probeReachOf(view);
  let posed = 0; // the pose shown, by its place in view.poses: 0 the frame's, as built; any other is put together
  let showMarks = marks.length > 0, xray = false, showMass = false, showProbes = false;
  let spot = []; // the marks a panel's Show shows, by their place in view.problems: lit, and their parts with them
  let probeSpot = null; // the probe a panel's Show shows, by its place in view.probes: lit, and the parts it names
  let alive = true, flat = false;
  let pinned = null, hover = null;
  let chosen = null, hoverLine = null; // a line chosen, or pointed at, elsewhere on the page: all its parts light
  // The pose: apart or not, and the step walked to (0 the whole product); `told` what the page was last told of each.
  let apart = false, at = 0, told = 0, toldApart = false;
  let asking = false; // the other view is saying where it is, as this one mounts: go there at once
  // A spring per assembly step, as the drawing has: x 0 in place to 1 apart, o its parts' opacity.
  const groups = new Map(steps.map((st) => [st.n, { n: st.n, x: 0, v: 0, target: 0, o: 1, oTarget: 1, pending: null }]));
  const order = [...groups.values()];
  let clock = 0, last = 0, springing = false;
  const liftOf = (part) => placeOf(view, part.id).lift;
  const groupOf = (part) => groups.get(placeOf(view, part.id).step);
  let renderer = null, scene = null, camera = null, controls = null, parts = new Map(), all = [], model = null, bounds = null;
  let frame = null, near = 0; // the node whose frame is the product's (mm, z up), and how far round a mark Show frames
  /** Each pose's parts as the model draws them in it (one, the frame's, without view.poses): `all` every part drawn,
   * `parts` those a pick or a pin finds, by id; `moves` the move (a Matrix4 in the frame, its position and turn) of
   * each part it moves, by id; `root` its own scene, or null. Made as the model loads.
   * @type {{ all: object[], parts: Map<string, object>, moves: Map<string, object>, root: object | null }[]} */
  let plans = [];
  /** @type {{ m: Problem & { i: number }, front: object, back: object }[]} */
  const sprites = []; // each mark twice: as itself where nothing hides it, and faint through what does
  /** @type {{ p: Probe & { i: number, state: string }, group: object, mats: object[], box: number[] }[]} */
  const probeLines = []; // each probe drawn, its lines twice: where nothing hides them, and faint through what does
  let markScale = 0, comMarks = [], ghostMaterial = null, ghostDashed = null, ghostDotted = null;
  let colors = readColors();
  let raf = 0, hoverRaf = 0, hoverAt = null, tween = null, stale = "";
  let drawn = null, picked = null; // where the camera was at the last frame drawn, and at the last hover pick
  let panelLater = 0, panelPose = 0; // the step the part panel says the part goes on at (0: none), and the pose it is of
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
      steps.length ? "; E takes it apart, and [ and ] walk the assembly steps" : ""}${marks.length ? "; P marks the check's problems" : ""}${
      cases.size ? "; X sees through the case" : ""}${mass ? "; M marks the centre of mass" : ""}${
      drawable.length ? "; R draws the function probes" : ""}${
      poses.length > 1 ? "; the Pose list stands it each way the stability gate weighs it" : ""}.` }, canvas, note);
  const fitButton = h("button", { type: "button", class: "a2-btn", "data-a2m": "fit" }, "Fit");
  const select = h("select", { class: "a2-model-select", "data-a2m": "part" }, h("option", { value: "" }, "Pick a part"),
    partsList(view).map((g) => h("optgroup", { label: g.name }, g.items.map((i) => h("option", { value: i.id }, i.label)))));
  const hint = h("span", { class: "a2-model-hint" });
  const apartButton = h("button", { type: "button", class: "a2-btn", "data-a2m": "apart" }, "Take apart");
  const prev = h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "prev", "aria-label": "Previous step" }, "‹");
  const count = h("span", { class: "a2-count" });
  const next = h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "next", "aria-label": "Next step" }, "›");
  const stepper = h("span", { class: "a2-stepper", role: "group", "aria-label": "Assembly steps" }, prev, count, next);
  const stepText = h("p", { class: "a2-step-text", "aria-live": "polite" });
  const toggle = (key, label, title, shortcut = label[0]) => h("button", { type: "button", class: "a2-btn", "data-a2m": key, "aria-pressed": "false",
    "aria-keyshortcuts": shortcut, title }, label);
  const marksButton = marks.length ? toggle("problems", "Problems", "Mark the check's problems where it found them (P)") : null;
  const xrayButton = cases.size ? toggle("xray", "X-ray", "See through the case, and pick what is in it (X)") : null;
  const massButton = mass ? toggle("mass", "Mass", "Mark the whole product's centre of mass (M)") : null;
  const probesButton = drawable.length ? toggle("probes", "Probes", "Draw the function probes where the check casts them: sound, ports, a camera's view, lights, keep-outs (R)", "R") : null;
  const massLine = h("p", { class: "a2-model-mass", hidden: true });
  // The ways the product stands, as the stability gate weighs it: each with its parts where that pose has them.
  const poseSelect = poses.length > 1 ? h("select", { class: "a2-model-select", "data-a2m": "pose" },
    poses.map((_, k) => h("option", { value: String(k) }, poseOptionOf(view, k)))) : null;
  const posePick = poseSelect ? h("label", { class: "a2-model-pick" }, h("span", null, "Pose"), poseSelect) : null;
  const poseLine = poses.length > 1 || poseTexts[0] ? h("p", { class: "a2-model-pose", hidden: true }) : null;
  const bar = h("div", { class: "a2-bar a2-model-bar" }, fitButton, steps.length ? [apartButton, stepper] : null, marksButton, xrayButton,
    massButton, probesButton, h("label", { class: "a2-model-pick" }, h("span", null, "Part"), select), posePick, hint, steps.length ? stepText : null);
  // What the legend says of the steps and the marks, which a view with no 3D has none of (fail() takes them out).
  const unsureNote = legend.unsure.length ? h("p", { class: "a2-model-unplaced" }, h("b", null, "Not on the drawing's steps: "),
    legend.unsure.map((u, i) => [i ? "; " : "", h("span", { title: u.line }, u.name), ` (${u.why})`])) : null;
  const poseNote = legend.steps ? null
    : h("p", null, "No assembly steps or apart pose: the product folder has no figure.json with steps (sprue figure draws one).");
  const marksNote = marksLegend();
  const probesNote = probesLegend();
  const legendEl = h("div", { class: "a2-model-legend" },
    h("p", null,
      h("span", { class: "a2-model-key", "data-kind": "cad", "aria-hidden": "true" }), ` ${legend.cad} drawn from their own CAD`,
      legend.envelopes ? [h("span", { class: "a2-model-gap" }), h("span", { class: "a2-model-key", "data-kind": "envelope", "aria-hidden": "true" }),
        ` ${legend.envelopes} ${legend.envelopes === 1 ? "envelope" : "envelopes"}: bought parts as stand-in shapes (boxes, cylinders, cones, prisms) at the sizes their datasheets or estimates give, not their makers' models; one may be only the end the product holds, a cable's plug`] : null,
      legend.paths.length ? [h("span", { class: "a2-model-gap" }), h("span", { class: "a2-model-key", "data-kind": "path", "aria-hidden": "true" }),
        ` ${legend.paths.join(", ")}: drawn along the path ${legend.paths.length === 1 ? "it takes" : "they take"} as built, which no gate checks as a shape`] : null),
    legend.unplaced.length ? h("p", { class: "a2-model-unplaced" }, h("b", null, "Not in the model: "),
      legend.unplaced.map((u, i) => [i ? "; " : "", h("span", { title: u.line }, u.name), ` (${u.why})`])) : null,
    unsureNote,
    poseNote, marksNote, probesNote);
  const panel = h("section", { class: "a2-model-panel", "aria-label": "The part picked" });
  const say = h("p", { class: "a2-model-say", "aria-live": "polite" });
  // A model of an earlier design says so over the bar, wherever the page puts the bar.
  const staleText = staleOf(view);
  const staleLine = staleText ? h("p", { class: "a2-model-stale" }, staleText) : null;
  const homeOf = (given) => (given && typeof given.append === "function" ? given : root);
  /** What goes where: the page's places for them, or root; the panel before the legend, so a part picked shows under
   * the bar when the page puts them in one place. */
  const placed = [[homeOf(opts.controls), [staleLine, bar, poseLine, massLine]], [homeOf(opts.panel), [panel]], [homeOf(opts.legend), [legendEl]]];
  root.replaceChildren(stage);
  for (const [home, els] of placed) home.append(...els.filter(Boolean));
  root.append(say);

  const setHint = () => {
    hint.textContent = flat ? "pick a part in the list"
      : touch.matches ? "drag to turn · pinch to zoom · tap a part"
        : `drag to turn · click a part · scroll zooms once clicked · f fits${steps.length ? " · e apart · [ ] steps" : ""}`;
  };
  setHint();
  on(touch, "change", () => { setHint(); if (!pinned) renderPanel(); });

  /** The legend's line of marks: how many problems and accepted risks are marked, and why the rest aren't. */
  function marksLegend() {
    const m = legend.marks;
    const not = [m.otherPose ? `${m.otherPose} of another pose than the one drawn` : "",
      m.noPose ? `${m.noPose} on parts every pose drawn moves` : "", m.noPlace ? `${m.noPlace} the check gives no place` : ""].filter(Boolean);
    if (!m.problems && !m.risks && !not.length) return null;
    const key = (kind) => h("span", { class: "a2-model-mark", "data-kind": kind, "aria-hidden": "true" });
    return h("p", null,
      m.problems ? [key("problem"), ` ${plural(m.problems, "problem")}`] : null,
      m.problems && m.risks ? [h("span", { class: "a2-model-gap" })] : null,
      m.risks ? [key("risk"), ` ${plural(m.risks, "accepted risk")}`] : null,
      m.problems || m.risks ? " marked where the check found them, while their parts are in place; faint where a part hides one" : null,
      m.inPose ? `; ${m.inPose} of them in another pose, marked while the Pose list shows it` : null,
      not.length ? `${m.problems || m.risks ? ". " : ""}Not marked: ${not.join(", ")}, in the panel only` : null, ".");
  }

  /** The legend's line of probes: how many pass, and how the model draws them (none where there is no 3D). */
  function probesLegend() {
    if (!probes.length) return null;
    const c = probeCountOf(view), drawn = drawable.length, rest = c.n - drawn;
    const states = ["pass", "fail", "accepted", "unknown"].filter((s) => drawable.some((p) => p.state === s));
    const key = (s) => [h("span", { class: "a2-model-probe", "data-state": s, "aria-hidden": "true" }), ` ${s === "unknown" ? "not said" : PROBE_STATES[s]}`];
    return h("p", null, `Function probes: ${probeSummaryOf(view)}.`,
      drawn ? [" ", states.map((s, i) => [i ? h("span", { class: "a2-model-gap" }) : null, key(s)]),
        `: Probes (R) draws ${rest ? `${drawn} of them` : c.n === 1 ? "it" : "them"} where the check casts ${drawn === 1 ? "it" : "them"}, while the whole product is put together as built`] : null,
      rest ? `${drawn ? "; " : " "}${rest === 1 ? "one has" : `${rest} have`} no place in system.json, in the panel only` : null, ".");
  }

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function readColors() {
    const style = getComputedStyle(root);
    return Object.fromEntries(Object.entries(TOKENS).map(([k, [name, fallback]]) => [k, cssColor(style.getPropertyValue(name).trim(), fallback)]));
  }

  // ---- what is lit, said and listed ----
  /** The line lit as a whole, pointed at or chosen elsewhere on the page. */
  const lineLit = () => hoverLine || chosen;
  const lineOfPart = (id) => { const item = itemOf(view, id); return item ? item.line : null; };
  /** The parts a probe names: its source and what is in its way (or the metal near it), those in the frame. */
  const probeParts = (p) => [p.where && p.where.source, ...((probeBlockersOf(p) || { ids: [] }).ids)].filter((id) => typeof id === "string" && ids.has(id));
  /** The parts the marks or the probe shown from a panel name. */
  const spotted = () => new Set([...spot.flatMap((i) => view.problems[i].parts), ...(probeSpot !== null ? probeParts(probes[probeSpot]) : [])]);
  /** Whether a panel's Show shows something: marks, or a probe. */
  const spotOn = () => spot.length > 0 || probeSpot !== null;
  /** Whether a part is lit: pinned, pointed at, of the line lit, or named by a mark shown. */
  const litNow = () => {
    const line = lineLit(), sp = spotted();
    return (id) => id === pinned || id === hover || (line != null && lineOfPart(id) === line) || sp.has(id);
  };
  function update() {
    const focus = Boolean(pinned || hover || lineLit() || spotOn());
    const lit = litNow();
    // With nothing lit, the parts the step walked to puts in light, as the drawing's do.
    const now = at && !focus ? steps[at - 1].n : null;
    for (const part of all)
      look(three, part, lit(part.id) ? "on" : focus ? "dim" : now !== null && placeOf(view, part.id).step === now ? "on" : "rest", colors);
    ghostLook();
    markLook();
    // A part's panel says when a part the step walked to doesn't show goes on: again when the step changes under it.
    if (pinned && (laterOf(pinned) !== panelLater || posed !== panelPose)) {
      const had = panel.contains(document.activeElement);
      renderPanel();
      if (had) focusOn(panel.querySelector(".a2-model-title"));
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
    if (spot.length) return markReadoutOf(view, spot);
    if (probeSpot !== null) return probeReadoutOf(view, probes[probeSpot]);
    if (at) return stepReadoutOf(view, at);
    if (moving()) return apart ? "taking apart" : "closing up";
    return apart ? `apart · ${plural(total, "part")}` : posed ? `${cap(poses[posed].name)} · ${plural(total, "part")}` : rest;
  }
  /** The readout and the bar, as the pose and what is lit are now. */
  function sayNow() {
    const text = readoutText();
    if (readout && readout.textContent !== text) { readout.textContent = text; readout.setAttribute("title", text); }
    marksButton?.setAttribute("aria-pressed", String(showMarks));
    xrayButton?.setAttribute("aria-pressed", String(xray));
    massButton?.setAttribute("aria-pressed", String(showMass));
    probesButton?.setAttribute("aria-pressed", String(showProbes));
    // The mass is the whole product's: on a step or apart it says when it is marked; in a pose not weighed, nothing is.
    const when = massTexts[posed] ? ` · ${whole() ? "marked" : "marked when the whole product is put together, on no step"}` : "";
    const weighed = showMass && mass && !flat ? `${massNow()}${when}` : "";
    if (massLine.textContent !== weighed) massLine.textContent = weighed;
    massLine.hidden = !weighed;
    if (poseSelect && poseSelect.value !== String(posed)) poseSelect.value = String(posed);
    const stands = flat ? "" : poseTexts[posed] || "";
    if (poseLine && poseLine.textContent !== stands) poseLine.textContent = stands;
    if (poseLine) poseLine.hidden = !stands;
    if (!steps.length) return;
    // Its label is what it does, so it isn't a toggle too: a pressed "Put together" would read as together.
    apartButton.textContent = apart ? "Put together" : "Take apart";
    apartButton.toggleAttribute("data-on", apart);
    count.textContent = at ? `Step ${at} / ${steps.length}` : plural(steps.length, "step");
    // An end of the stepper that has the focus as it is disabled gives it to the other end, or to the model.
    const first = at === 0, last = at === steps.length, active = document.activeElement;
    if (!first) prev.disabled = false;
    if (!last) next.disabled = false;
    if ((first && active === prev) || (last && active === next)) {
      const to = first && !last ? next : last && !first ? prev : null;
      if (to) to.focus({ preventScroll: true });
      else home();
    }
    prev.disabled = first;
    next.disabled = last;
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
  /** A Show button for the marks of `list` (indices into view.problems) the view has, or null for none or no 3D. */
  const showOf = (list, what) => {
    const of = list.filter((i) => marked.has(i));
    return of.length && !flat ? h("button", { type: "button", class: "a2-model-link a2-model-show", "data-a2m-show": of.join(" "),
      title: `Frame ${what} in the model` }, "Show") : null;
  };
  /** The marks of a gate's problems, or its accepted risks. */
  const gateMarks = (gate, accepted) => marks.filter((m) => m.gate === gate && m.accepted === accepted).map((m) => m.i);
  const checkList = (problems, notes, failing = [], accepted = []) => h("ul", { class: "a2-model-problems" },
    failing.map((g) => h("li", { "data-failing": "" }, h("b", null, "Fails"), h("span", { class: "a2-model-gate" }, g.title),
      h("span", null, plural(g.problems, "problem"), g.parts.length ? [", on ", g.parts.map((id, i) => [i ? " " : "", pick(id)])] : ", on no one part"),
      showOf(gateMarks(g.gate, false), "its marks"))),
    accepted.map((g) => h("li", { "data-accepted": "" }, h("b", null, "Accepts"), h("span", { class: "a2-model-gate" }, g.title),
      h("span", null, plural(g.problems, "risk"), ", on ", g.parts.map((id, i) => [i ? " " : "", pick(id)])),
      showOf(gateMarks(g.gate, true), "their marks"))),
    problems.map((x) => h("li", { "data-accepted": x.accepted || null },
      h("b", null, x.accepted ? "Accepted risk" : "Problem"), h("span", { class: "a2-model-gate" }, x.title), h("span", null, x.text),
      showOf([x.i], "its mark"))),
    notes.map((n) => h("li", { "data-note": "" }, h("b", null, n.label), h("span", null, n.text))));

  /** A Show button for a probe the model draws, or null for one it doesn't or no 3D. */
  const showProbeOf = (p) => (!flat && drawable.includes(p) ? h("button", { type: "button", class: "a2-model-link a2-model-show",
    "data-a2m-probe": String(p.i), title: "Frame the probe in the model, its parts lit" }, "Show") : null);
  /** The probes as the panel lists them: each one's state, kind and id, what it found; on the whole product's panel what
   * is in its way and its source, as buttons, why the design has it and its reason to live with it falling short; on a
   * part's, what the part is to it (`roles`, by its place in view.probes). */
  const probeList = (rows, roles = null) => h("ul", { class: "a2-model-probes" }, rows.map((p) => {
    const b = probeBlockersOf(p), found = probeFoundOf(view, p), role = roles ? roles.get(p.i) : "";
    return h("li", { "data-state": p.state },
      h("b", null, { pass: "Passes", fail: "Fails", accepted: "Accepted", unknown: "Not said" }[p.state]),
      h("span", { class: "a2-model-gate" }, `${cap(PROBE_KINDS[p.kind] || p.kind)} · ${p.id}`),
      role ? h("span", null, cap(role)) : null,
      found ? h("span", null, cap(found)) : null,
      !roles && b ? h("span", null, `${b.label}: `, b.ids.map((id, i) => [i ? ", " : "", pick(id), b.mm && num(b.mm[i]) ? ` (${fmt(b.mm[i], 2)} mm)` : ""])) : null,
      !roles && p.where && typeof p.where.source === "string" ? h("span", null, "From ", pick(p.where.source)) : null,
      !roles && p.why ? h("span", { class: "a2-model-why" }, p.why) : null,
      !roles && p.accept ? h("span", { class: "a2-model-why" }, `Its reason to live with it falling short: ${p.accept}`) : null,
      showProbeOf(p));
  }));

  function renderPanel() {
    select.value = pinned || "";
    const p = pinned ? panelOf(view, pinned, posed) : null;
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
        probes.length ? h("div", { class: "a2-model-block" }, heading(level, null, "Function probes"),
          h("p", { class: "a2-model-count", "data-problems": probes.some((p) => p.state === "fail") || null }, probeSummaryOf(view)), probeList(probes)) : null,
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
    // A part the step walked to doesn't put in yet isn't drawn: say so, and when it goes on; and where a pose has it.
    const later = panelLater = laterOf(p.id);
    panelPose = posed;
    const roles = new Map(partProbesOf(view, p.id).map((r) => [r.i, r.role]));
    const stands = poseNoteOf(p.id);
    panel.replaceChildren(...[
      head(p, "Unpin the part", [later ? h("p", { class: "a2-model-sub", "data-later": "" }, `Not shown at step ${at}: it goes on at step ${later}`) : null,
        stands ? h("p", { class: "a2-model-sub", "data-pose": "" }, stands) : null]),
      // A failing part says so first.
      p.problems.length || p.notes.length ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "The whole-product check"),
        checkList(p.problems, p.notes)) : null,
      h("dl", { class: "a2-model-facts" }, p.facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      p.meets.length ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "What it meets"),
        h("ul", { class: "a2-model-meets" }, p.meets.map(meet))) : null,
      roles.size ? h("div", { class: "a2-model-block" }, heading(level + 1, null, "Function probes"),
        probeList(probes.filter((x) => roles.has(x.i)), roles)) : null,
      filesBlock(p),
    ].filter(Boolean));
  }

  /** Where the pose shown has a part that isn't where the frame has it, or "". */
  function poseNoteOf(id) {
    if (!posed) return "";
    const { moved, hidden, redrawn } = posePartsOf(view, posed), name = poses[posed].name;
    return moved.includes(id) ? `Moved in this pose (${name}), where the stability gate weighs it; no gate checks how it fits here`
      : hidden.includes(id) ? `Not drawn in this pose (${name}): it doesn't say where the part goes`
        : redrawn.includes(id) ? `Drawn along the path this pose (${name}) bends it to, which no gate checks as a shape` : "";
  }
  /** The step (1 to N) a part goes on at when the step walked to doesn't put it in yet, else 0. */
  function laterOf(id) {
    const goes = at ? placeOf(view, id).step : null;
    return goes !== null && goes > steps[at - 1].n ? steps.findIndex((st) => st.n === goes) + 1 : 0;
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
    spot = [];
    probeSpot = null;
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
    spot = [];
    probeSpot = null;
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
  /** Tells the page where this view is, as replies to a view that mounts after it and asks (a2:ask): its step, whether
   * it is apart and what is pinned or chosen. */
  function reply() {
    told = at;
    toldApart = apart;
    const item = pinned ? itemOf(view, pinned) : null;
    for (const [type, detail] of [["a2:step", { n: at, of: steps.length, text: at ? steps[at - 1].text : "" }], ["a2:apart", { on: apart }],
      ["a2:select", { line: item ? item.line : chosen, part: pinned }]])
      root.dispatchEvent(new CustomEvent(type, { detail: { ...detail, reply: true }, bubbles: true }));
  }
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
    const calm = jump || asking || still.matches || !renderer || !model;
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
    // A part pointed at that goes is pointed at no more; and once the parts are still (at once, with reduced motion), a
    // pointer that hasn't moved is over what is there now, though the camera didn't move.
    if (hover && parts.get(hover) && !shownAfter(parts.get(hover))) setHover(null);
    picked = null;
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
  /** Each part where its step's spring has it, faded as its spring says, and where the pose shown moves it. */
  function pose() {
    if (!model) return;
    const plan = plans[posed] || plans[0];
    for (const part of all) {
      const g = groupOf(part);
      const k = g ? g.x : 0, o = g ? g.o : 1;
      const [x, y, z] = liftOf(part);
      const move = plan ? plan.moves.get(part.id) : null;
      part.mesh.position.set(x * k, y * k, z * k);
      if (move) {
        part.mesh.position.add(move.position);
        part.mesh.quaternion.copy(move.turn);
      } else part.mesh.quaternion.identity();
      fade(part, o);
    }
    model.updateMatrixWorld(true);
    plan?.root?.updateMatrixWorld(true);
    ghostLook();
    markLook();
  }
  /** The pose shown's parts drawn, and those a pick finds: the frame's it doesn't take out or draw again, and its own;
   * the others' hidden. */
  function applyPose() {
    const plan = plans[posed] || plans[0];
    if (!plan) return;
    for (const p of plans) if (p.root) p.root.visible = p === plan;
    const drawnNow = new Set(plan.all);
    for (const p of plans) for (const part of p.all) if (!drawnNow.has(part)) part.mesh.visible = false;
    all = plan.all;
    parts = plan.parts;
    if (hover && !parts.has(hover)) setHover(null);
    pose();
  }
  /** Goes to pose `k` (its place in view.poses), put together on no step when it isn't the frame's, which the
   * springs and the camera then follow (retarget). Whether it changed. */
  function toPose(k) {
    if (k === posed) return false;
    posed = k;
    if (posed) { apart = false; at = 0; }
    applyPose();
    return true;
  }
  /** Shows pose `k`, as the Pose list does, and says so. */
  function setPose(k) {
    if (!alive || flat || poses.length < 2) return posed;
    const want = Math.max(0, Math.min(poses.length - 1, Math.round(Number(k) || 0)));
    if (want === posed) return posed;
    spot = [];
    probeSpot = null;
    toPose(want);
    say.textContent = poseTexts[posed] || cap(poses[posed].name);
    retarget();
    return posed;
  }
  /** Whether an object is drawn: it and everything that holds it shown (a pose's own parts are under its root). */
  function shownNow(o) {
    for (let q = o; q; q = q.parent) if (!q.visible) return false;
    return true;
  }
  /** The move of each part the pose shown moves, as a Matrix4 in the frame, for poseBox; null for one it doesn't. */
  const movedBy = (plan) => (part) => (plan && plan.moves.get(part.id) ? plan.moves.get(part.id).matrix : null);
  /** The Mass line's weighing for the pose shown. */
  const massNow = () => massTexts[posed] || `${cap(poses[posed] ? poses[posed].name : "")}: the stability gate has no weighing of this pose`;
  /** Whether the product is whole in the pose chosen: put together, on no step. */
  const whole = () => !apart && !at;
  /** Whether a part is where the frame has it, and drawn through: its step's spring at rest in place. */
  const inPlace = (part) => { const g = groupOf(part); return !g || (!g.pending && g.x < 0.01 && g.o > 0.99); };
  /** Each mark shown where its parts are in place (a mark of no one part, while the whole product is), with the
   * Problems toggle on: lit with what it names, a tone down while something else is lit; and the centre of mass, with
   * the Mass toggle on, while the whole product is. */
  function markLook() {
    if (!model) return;
    const settled = whole() && all.every(inPlace);
    const focus = Boolean(pinned || hover || lineLit() || spotOn());
    const lit = litNow();
    for (const { m, front, back } of sprites) {
      const here = m.parts.filter((id) => parts.has(id)).map((id) => parts.get(id));
      const shown = showMarks && markPoses.get(m.i).has(posed) && (here.length ? here.every(inPlace) : settled);
      front.visible = back.visible = shown;
      if (!shown) continue;
      const on = spot.includes(m.i) || here.some((part) => lit(part.id));
      const k = (spot.includes(m.i) ? 1.5 : 1) * markScale;
      front.scale.set(k, k, 1);
      back.scale.set(k, k, 1);
      front.material.opacity = focus && !on ? 0.45 : 1;
      back.material.opacity = front.material.opacity * BEHIND;
    }
    comMarks.forEach((c, k) => { if (c) c.visible = showMass && settled && k === posed; });
    // The probes are where the check cast them, as built: drawn while the product is, a tone down while something
    // else is lit (not the probe shown, nor one that names a part lit).
    for (const d of probeLines) {
      d.group.visible = showProbes && settled && posed === 0;
      if (!d.group.visible) continue;
      const on = probeSpot === d.p.i || probeParts(d.p).some((id) => lit(id));
      for (const m of d.mats) m.opacity = m.userData.base * (focus && !on ? DIM : 1);
    }
  }
  /** A lit part's edges show faint where other parts hide them, as the step's parts do with nothing lit; but not the one
   * under the pointer, which nothing hides there. As the parts move and fade too, so a part gone has none. */
  function ghostLook() {
    if (!model) return;
    const focus = Boolean(pinned || hover || lineLit() || spotOn()), lit = litNow();
    const now = at && !focus ? steps[at - 1].n : null;
    for (const part of all) {
      const on = focus ? lit(part.id) : now !== null && placeOf(view, part.id).step === now;
      const ghost = part.mesh.visible && part.id !== hover && on;
      if (ghost || part.ghost) ghostOf(part).visible = ghost;
    }
  }
  /** The material of a part's edges where something is in front of them: dashed for an envelope, dotted for a path. */
  const ghostLine = (part) => (part.kind === "envelope" ? ghostDashed : part.kind === "path" ? ghostDotted : ghostMaterial);
  /** A part's edges and outline drawn again, faint, only where something is in front of them. */
  function ghostOf(part) {
    if (part.ghost) return part.ghost;
    const group = new THREE.Group();
    for (const geometry of [part.edges.geometry, part.outline ? part.outline.line.geometry : null]) {
      if (!geometry) continue;
      const line = new THREE.LineSegments(geometry, ghostLine(part));
      line.raycast = () => {};
      line.renderOrder = 1;
      line.frustumCulled = false; // the outline's buffer changes each frame; its bounds are the part's anyway
      group.add(line);
    }
    group.name = `${part.id} ghost`;
    part.mesh.add(group);
    part.ghost = group;
    return group;
  }
  /** A part's opacity: drawn through above 0.999, gone below 0.01 (and never picked), in between see-through; in the
   * X-ray a case part is glass, which hides nothing. */
  function fade(part, o) {
    const glass = xray && cases.has(part.id);
    const solid = o >= 0.999 && !glass;
    part.mesh.visible = o >= 0.01;
    for (const [m, g] of [[part.mesh.material, GLASS.face], [part.edges.material, GLASS.edge]]) {
      if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true; }
      m.opacity = solid ? 1 : o * (glass ? g : 1);
      m.depthWrite = solid;
    }
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
    // The drawing's apart pose is the product's as built.
    if (want) toPose(0);
    apart = want;
    spot = [];
    probeSpot = null;
    if (quiet) toldApart = apart;
    else say.textContent = apart ? `Apart · ${plural(total, "part")}` : "Put together";
    retarget();
    return apart;
  }
  function step(n, quiet = false) {
    if (!alive || !steps.length) return at;
    const want = Math.max(0, Math.min(steps.length, Math.round(Number(n) || 0)));
    if (want === at) return at;
    // A part pinned would keep the readout: the step asked for is what to show now, as the drawing does.
    if (pinned || chosen) choose(null, false, quiet);
    // The drawing's steps are the product's as built.
    if (want) toPose(0);
    at = want;
    spot = [];
    probeSpot = null;
    if (quiet) told = at;
    else if (!at) say.textContent = "The whole product";
    // The step's text is read out by the view that walked to it, not again by the one that followed.
    stepText.setAttribute("aria-live", quiet ? "off" : "polite");
    retarget();
    return at;
  }
  on(apartButton, "click", () => explode());
  on(prev, "click", () => step(at - 1));
  on(next, "click", () => step(at + 1));

  // ---- what is marked: problems, the case as glass, the centre of mass ----
  function setMarks(on = !showMarks) {
    if (!alive || !marks.length || on === showMarks) return;
    showMarks = on;
    if (!on) spot = [];
    update();
    say.textContent = on ? marksSaid() : "Problems not marked";
  }
  /** What the Problems toggle marks as the pose is now: a mark shows while its parts are in place. */
  function marksSaid() {
    const shown = sprites.filter((s) => s.front.visible);
    const here = sprites.filter((s) => markPoses.get(s.m.i).has(posed)).length, away = marks.length - here;
    const risks = shown.filter((s) => s.m.accepted).length, problems = shown.length - risks;
    const more = [here > shown.length ? `${here - shown.length} more when their parts are in place` : "", away ? `${away} in another pose` : ""].filter(Boolean);
    if (!shown.length) return `Problems marked: none ${here ? "until their parts are in place" : "in this pose"} (${plural(marks.length, "mark")} in all)`;
    return `Marked: ${[problems ? plural(problems, "problem") : "", risks ? plural(risks, "accepted risk") : ""].filter(Boolean).join(" and ")}${
      more.length ? `, ${more.join(", ")}` : ""}`;
  }
  function setXray(on = !xray) {
    if (!alive || !cases.size || on === xray) return;
    xray = on;
    pose();
    // A pointer over the case is over what is in it now.
    if (xray && hover && cases.has(hover)) setHover(null);
    if (hoverAt && !pointers.size && renderer) hoverPick();
    say.textContent = xray ? "X-ray: the case is glass, and a click goes through it" : "X-ray off";
    update();
  }
  function setMass(on = !showMass) {
    if (!alive || !mass || on === showMass) return;
    showMass = on;
    say.textContent = on ? `Mass: ${massNow()}${massTexts[posed] ? ` · ${whole() ? "marked" : "not marked until the whole product is put together"}` : ""}` : "Mass not marked";
    update();
  }
  /** Shows marks (`list`, indices into view.problems): the Problems toggle on, the parts they name put together (the
   * whole product, unless the step walked to has them all in place), the camera framing them from where it looks, and
   * they and their parts lit until something else is picked or the pose changes. */
  function showSpot(list) {
    let of = list.filter((i) => marked.has(i));
    if (!alive || flat || !of.length) return;
    // In the pose shown when it marks any of them, else in the first one's: a stability pose's risk is where its parts
    // are in that pose.
    const k = of.some((i) => markPoses.get(i).has(posed)) ? posed : [...markPoses.get(of[0])][0];
    of = of.filter((i) => markPoses.get(i).has(k));
    const placedBy = (i) => {
      const p = view.problems[i];
      const here = p.parts.filter((id) => ids.has(id));
      return here.length > 0 && here.every((id) => placeOf(view, id).step <= steps[at - 1].n);
    };
    let moved = toPose(k);
    if (apart || (at && !of.every(placedBy))) {
      if (at && !of.every(placedBy)) at = 0;
      apart = false;
      moved = true;
    }
    if (moved) retarget();
    showMarks = true;
    spot = of;
    probeSpot = null;
    say.textContent = `Showing ${markReadoutOf(view, of)}`;
    update();
    frameSpot();
  }
  function setSpotOff() {
    if (!spotOn()) return false;
    say.textContent = spot.length ? "Let go of the marks" : "Let go of the probe";
    spot = [];
    probeSpot = null;
    update();
    return true;
  }
  /** Draws the function probes, or doesn't, and says how many pass and where they are drawn. */
  function setProbes(on = !showProbes) {
    if (!alive || !probesButton || on === showProbes) return;
    showProbes = on;
    if (!on) probeSpot = null;
    update();
    say.textContent = on ? probesSaid() : "Probes not drawn";
  }
  /** What the Probes toggle draws as the pose is now: the probes are where the check cast them, as built. */
  function probesSaid() {
    const where = !model || probeLines.some((d) => d.group.visible) ? ""
      : posed ? "; they are drawn as built, not in this pose" : "; drawn once the whole product is put together";
    return `Probes: ${probeSummaryOf(view)}${where}`;
  }
  /** Shows probe `i` (its place in view.probes): the Probes toggle on, the product put together as built, the camera
   * framing it from where it looks, and it and the parts it names lit until something else is picked or the pose
   * changes. */
  function showProbe(i) {
    const p = probes[i];
    if (!alive || flat || !p || !drawable.includes(p)) return;
    let moved = toPose(0);
    if (apart || at) {
      apart = false;
      at = 0;
      moved = true;
    }
    if (moved) retarget();
    showProbes = true;
    spot = [];
    probeSpot = i;
    say.textContent = `Showing ${probeReadoutOf(view, p)}`;
    update();
    frameProbe();
  }
  /** The camera to frame the probe shown, from where it looks. */
  function frameProbe() {
    const d = probeLines.find((x) => x.p.i === probeSpot);
    if (!alive || !model || !camera || !frame || !d) return;
    const box = new THREE.Box3(new THREE.Vector3(...d.box.slice(0, 3)), new THREE.Vector3(...d.box.slice(3))).applyMatrix4(frame.matrixWorld);
    frameTo(box, still.matches, lookDir(), false);
  }
  if (marksButton) on(marksButton, "click", () => setMarks());
  if (xrayButton) on(xrayButton, "click", () => setXray());
  if (massButton) on(massButton, "click", () => setMass());
  if (probesButton) on(probesButton, "click", () => setProbes());

  // ---- the page: what the drawing and the rest of it say, and the hash ----
  const outside = (e) => !(e.target instanceof Node && root.contains(e.target));
  on(document, "a2:select", (e) => {
    if (!outside(e)) return;
    const d = e.detail || {};
    if (d.part && ids.has(d.part)) choose(d.part, false, true);
    // The drawing draws lines: the line of the part pinned here is that part, which stays pinned.
    else if (!(pinned && d.line && lineOfPart(pinned) === d.line)) chooseLine(d.line ?? null, true);
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
  on(document, "a2:ask", (e) => { if (outside(e)) reply(); });
  const useHash = opts.hash !== false;
  /** The pose the hash asks for: at once when the view starts, eased when the hash changes. */
  function fromHash(jump) {
    const want = hashOf(location.hash, view);
    apart = steps.length ? want.apart : false;
    at = want.at;
    spot = [];
    probeSpot = null;
    toPose(flat ? 0 : want.pose);
    // A part is this view's to name: it tells the drawing its line, which the drawing's own reading leaves alone.
    if (want.part) choose(want.part, false);
    else chooseLine(want.line);
    // The drawing reads the hash too: told of the pose, it would take it as a step from elsewhere, and let go of a line.
    told = at;
    toldApart = apart;
    retarget(jump);
  }
  if (useHash) {
    on(window, "hashchange", () => fromHash(false));
    if (location.hash.length > 1) fromHash(true);
  }
  // A view on the page already (the drawing, moved since the page opened) says where it is, and this one goes there.
  asking = true;
  root.dispatchEvent(new CustomEvent("a2:ask", { bubbles: true }));
  asking = false;

  // ---- the panel and the bar ----
  on(panel, "click", (event) => {
    const b = event.target.closest("[data-a2m-pick],[data-a2m-show],[data-a2m-probe],[data-a2m]");
    if (!b) return;
    if (b.hasAttribute("data-a2m-probe")) {
      showProbe(Number(b.getAttribute("data-a2m-probe")));
    } else if (b.hasAttribute("data-a2m-show")) {
      showSpot((b.getAttribute("data-a2m-show") || "").split(" ").filter(Boolean).map(Number));
    } else if (b.hasAttribute("data-a2m-pick")) {
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
  if (poseSelect) on(poseSelect, "change", () => setPose(Number(poseSelect.value)));
  on(fitButton, "click", () => fit());
  function onKey(event) {
    if (event.target.closest("select, input, textarea") || event.metaKey) return;
    // [ and ] are typed with AltGr (Ctrl and Alt on Windows) or Option on many layouts: those count, and nothing else does.
    const bracket = event.key === "[" || event.key === "]";
    const altGr = Boolean(event.getModifierState && event.getModifierState("AltGraph"));
    if ((event.ctrlKey || event.altKey) && !(bracket && (altGr || !event.ctrlKey))) return;
    if (event.key === "Escape") {
      // The marks or the probe shown, then a part, then a line, then the pose.
      if (setSpotOff()) { /* let go */ } else if (pinned || chosen) {
        const inPanel = panel.contains(event.target);
        choose(null);
        if (inPanel) home();
      } else if (at || apart || posed) {
        at = 0;
        apart = false;
        say.textContent = toPose(0) ? poseTexts[0] || cap(poses[0].name) : "The whole product, put together";
        retarget();
      } else return;
      event.preventDefault();
      return;
    }
    if ((event.key === "f" || event.key === "F") && controls) { fit(); event.preventDefault(); return; }
    const marking = { p: setMarks, x: setXray, m: setMass, r: setProbes }[event.key.toLowerCase()];
    const has = { p: marksButton, x: xrayButton, m: massButton, r: probesButton }[event.key.toLowerCase()];
    if (marking && has && !flat) { marking(); event.preventDefault(); return; }
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
  }
  // The keys are the view's in root and in what it put elsewhere: the bar, the legend and the panel (never their
  // places, which a page may share).
  for (const el of [root, bar, legendEl, panel]) if (el === root || !root.contains(el)) on(el, "keydown", onKey);
  // The wheel zooms once the view has focus, or with Ctrl or ⌘ (a trackpad's pinch): until then it scrolls the page,
  // as it does over the drawing, so a reader scrolling past the figure isn't caught by it.
  on(stage, "wheel", (event) => {
    if (!stage.contains(document.activeElement) && !event.ctrlKey && !event.metaKey) event.stopPropagation();
  }, { capture: true });
  renderPanel();
  sayNow(); // the bar's buttons and count, before the model loads

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
    // A mark on a face would be cut in half by it: the disc drawn in front comes toward the eye, along the line it is
    // seen on, as far as its lower edge sinks into that face seen at a slant (its half width, which is half its scale
    // times how far off it is, as it keeps its size on screen, times the slant's tangent, up to LIFT), and not at all
    // off a face turned away, which hides it. One of no one part comes its half width.
    const to = new THREE.Vector3();
    for (const { front, at, normal } of sprites) {
      if (!front.visible) continue;
      const d = to.subVectors(eye, at).length();
      if (!d) continue;
      const c = normal ? normal.dot(to) / d : 1 / Math.SQRT2;
      const slant = c <= 0 ? 0 : Math.min(Math.sqrt(Math.max(0, 1 - c * c)) / c, LIFT);
      front.position.copy(at).lerp(eye, Math.min((front.scale.x / 2) * slant, 0.5));
    }
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
    const box = poseBox(three, all, liftOf, goingTo, movedBy(plans[posed]));
    if (box.isEmpty()) return;
    frameTo(box, jump, dir, true);
  }
  /** Frames the marks shown, from where the camera looks, with a share of the whole product round them. */
  function frameSpot() {
    if (!alive || !model || !camera || !frame || !spot.length) return;
    const box = new THREE.Box3();
    for (const i of spot) box.expandByPoint(new THREE.Vector3(...view.problems[i].at).applyMatrix4(frame.matrixWorld));
    frameTo(box.expandByScalar(near), still.matches, lookDir(), false);
  }
  /** The camera to frame `box` (in the world) from `dir`; `limits`: how near and far it may zoom follows the box. */
  function frameTo(box, jump, dir, limits) {
    const f = frameOf(three, box, camera.aspect || 1, FOV, dir);
    if (limits) {
      controls.minDistance = f.radius * 0.2;
      controls.maxDistance = f.distance * 4;
    }
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
    // A mark is as many px across at any size of the view: a sprite that keeps its size is this share of its height.
    markScale = (MARK_PX * 2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / hgt;
    markLook();
    request();
  }

  function pickClient(x, y) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height || !camera) return null;
    place();
    return pickAt(three, camera, parts, ((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, xray ? cases : null);
  }

  function recolor() {
    colors = readColors();
    tint();
    update();
  }
  /** The marks', the ghosts' and the centre of mass's colours, from the kit's. */
  function tint() {
    for (const { m, front, back } of sprites) for (const s of [front, back]) s.material.color.set(m.accepted ? colors.mid : colors.red);
    for (const m of [ghostMaterial, ghostDashed, ghostDotted]) m?.color.set(colors.lit);
    for (const c of comMarks) c?.traverse((o) => o.material?.color.set(colors.hi));
    for (const d of probeLines) for (const m of d.mats) m.color.set(d.p.state === "pass" ? colors.green : d.p.state === "fail" ? colors.red : colors.mid);
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
    for (const b of [marksButton, xrayButton, massButton, probesButton, massLine, posePick, poseLine]) if (b) b.hidden = true;
    for (const p of [unsureNote, poseNote, marksNote, probesNote]) p?.remove();
    spot = [];
    probeSpot = null;
    posed = 0;
    sayNow(); // a pose the hash or the Pose list chose while it loaded is said no more
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
    const frameParts = prepare(three, model, colors, ids), frameAll = [];
    model.traverse((o) => { if (o.userData.sprue) frameAll.push(o.userData.sprue); });
    model.updateMatrixWorld(true);
    // Each pose: the frame's parts but those it takes out and doesn't move, or draws again along its own paths (from
    // its scene in the model), and the move of those it moves.
    plans = (poses.length ? poses : [null]).map((p, k) => {
      const { moved, hidden, redrawn } = posePartsOf(view, k);
      const out = new Set([...hidden, ...redrawn]);
      const root = p && p.scene != null && gltf.scenes && gltf.scenes[p.scene] && gltf.scenes[p.scene] !== gltf.scene ? gltf.scenes[p.scene] : null;
      const own = root ? prepare(three, root, colors, ids) : new Map(), ownAll = [];
      if (root) {
        root.traverse((o) => { if (o.userData.sprue) ownAll.push(o.userData.sprue); });
        root.visible = false;
        scene.add(root);
        root.updateMatrixWorld(true);
      }
      let move = null;
      if (p && p.moved) {
        const matrix = new THREE.Matrix4().set(...p.moved.flat()), position = new THREE.Vector3(), turn = new THREE.Quaternion();
        matrix.decompose(position, turn, new THREE.Vector3());
        move = { matrix, position, turn };
      }
      return { all: frameAll.filter((part) => !out.has(part.id)).concat(ownAll),
        parts: new Map([...[...frameParts].filter(([id]) => !out.has(id)), ...own]),
        moves: new Map(move ? moved.map((id) => [id, move]) : []), root };
    });
    all = frameAll;
    parts = frameParts;
    // The planes hold the product in every pose: put together, every part as far out as it goes, and each way it stands.
    const together = poseBox(three, frameAll, liftOf, () => 0);
    const reach = together.clone().union(poseBox(three, frameAll, liftOf, () => 1));
    for (const plan of plans) reach.union(poseBox(three, plan.all, liftOf, () => 0, movedBy(plan)));
    const f = frameOf(three, reach, 1);
    bounds = { center: f.center, radius: f.radius };
    // The items' nodes have no transform of their own, so a part's parent is the frame's node: mm, z up.
    frame = frameAll.length && frameAll[0].mesh.parent ? frameAll[0].mesh.parent : model;
    near = together.isEmpty() ? 0 : together.getBoundingSphere(new THREE.Sphere()).radius * NEAR;
    // Drawn only where the depth there is nearer than the edge: where another part (or the part itself) hides it.
    const hidden = { color: colors.lit, transparent: true, opacity: GHOST, depthFunc: THREE.GreaterDepth, depthWrite: false };
    ghostMaterial = new THREE.LineBasicMaterial(hidden);
    ghostDashed = new THREE.LineDashedMaterial({ ...hidden, dashSize: DASH[0], gapSize: DASH[1] });
    ghostDotted = new THREE.LineDashedMaterial({ ...hidden, dashSize: DOT[0], gapSize: DOT[1] });
    makeMarks();
    makeProbes();
    // The centre of mass of each pose the stability gate weighed (without poses, the first weighing's), over the desk
    // the product as built stands on.
    comMarks = (poses.length ? poses.map((p) => p.mass) : [view.stability]).map((w) => (w ? makeMass(w.com, together) : null));
    applyPose();
    tint();
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

  /** A disc for a problem, a ring for a risk the design accepts: white, coloured by the material, with a dark rim so
   * it reads on a lit face as on the paper. */
  function markTexture(ring) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.beginPath();
    g.arc(32, 32, 24, 0, 2 * Math.PI);
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.stroke();
    g.beginPath();
    g.arc(32, 32, ring ? 22 : 24, 0, 2 * Math.PI);
    if (ring) { g.lineWidth = 5; g.strokeStyle = "#fff"; g.stroke(); } else { g.fillStyle = "#fff"; g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  /** Each mark as two sprites at its place: one hidden where a part is in front of it, and one faint through it. They
   * keep their size on screen (size() sets it) and a pick goes through them. */
  function makeMarks() {
    if (!marks.length) return;
    const maps = { disc: markTexture(false), ring: markTexture(true) };
    for (const m of marks) {
      const at = new THREE.Vector3(...m.at).applyMatrix4(frame.matrixWorld);
      // The face it sits on, of the parts it names where its pose has them (in their own frame, which is the frame's: a
      // part's node has no transform of its own, but for a pose's move); none for a mark of no one part.
      const plan = plans[[...markPoses.get(m.i)][0]] || plans[0];
      const face = markFaceOf(three, m.at, m.parts, (id) => {
        const part = plan.parts.get(id), move = plan.moves.get(id);
        return part ? { geometry: part.mesh.geometry, move: move ? move.matrix : null } : null;
      });
      const normal = face ? face.transformDirection(frame.matrixWorld) : null;
      const [front, back] = [true, false].map((depthTest) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: m.accepted ? maps.ring : maps.disc, transparent: true,
          depthTest, depthWrite: false, sizeAttenuation: false }));
        sprite.position.copy(at);
        sprite.renderOrder = depthTest ? 3 : 2;
        sprite.raycast = () => {};
        sprite.visible = false;
        sprite.name = `mark ${m.i}`;
        scene.add(sprite);
        return sprite;
      });
      sprites.push({ m, front, back, at, normal });
    }
  }
  /** A centre of mass (`com`, mm in the frame) as a cross, with its plumb line dashed down to the desk under the product
   * put together as built (its lowest point, `together`) and a cross there: where it falls on what it stands on. Drawn
   * through every part; hidden until markLook shows it. */
  function makeMass(com, together) {
    const at = new THREE.Vector3(...com).applyMatrix4(frame.matrixWorld);
    const r = Math.max(near * 0.5, 1e-6);
    const foot = new THREE.Vector3(at.x, together.isEmpty() ? at.y : together.min.y, at.z);
    const segs = (pairs) => new THREE.BufferGeometry().setFromPoints(pairs.flat());
    const axes = (c, s, flatOnly) => [
      [new THREE.Vector3(c.x - s, c.y, c.z), new THREE.Vector3(c.x + s, c.y, c.z)],
      [new THREE.Vector3(c.x, c.y, c.z - s), new THREE.Vector3(c.x, c.y, c.z + s)],
      ...(flatOnly ? [] : [[new THREE.Vector3(c.x, c.y - s, c.z), new THREE.Vector3(c.x, c.y + s, c.z)]]),
    ];
    const line = (geometry, material) => {
      const l = new THREE.LineSegments(geometry, material);
      l.raycast = () => {};
      l.renderOrder = 4;
      return l;
    };
    const solid = () => new THREE.LineBasicMaterial({ color: colors.hi, transparent: true, depthTest: false, depthWrite: false });
    const plumb = line(segs([[at.clone(), foot.clone()]]), new THREE.LineDashedMaterial({ color: colors.hi, dashSize: r * 0.25, gapSize: r * 0.2,
      transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
    plumb.computeLineDistances();
    const group = new THREE.Group();
    group.name = "centre of mass";
    group.add(line(segs(axes(at, r, false)), solid()), plumb, line(segs(axes(foot, r * 0.6, true)), solid()));
    group.visible = false;
    scene.add(group);
    return group;
  }

  /** Each probe the model draws as lines where the check cast it (probeShapeOf), in the frame: its own strong and its
   * faint, each twice, as itself where nothing hides it and fainter through what does. Hidden until markLook shows it. */
  function makeProbes() {
    for (const p of drawable) {
      const shape = probeShapeOf(p, reach);
      const group = new THREE.Group(), mats = [];
      for (const [segs, strength] of [[shape.lines, 1], [shape.faint, PROBE_FAINT]]) {
        if (!segs.length) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints(segs.flat().map((q) => new THREE.Vector3(...q)));
        for (const behind of [false, true]) {
          const m = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, depthFunc: behind ? THREE.GreaterDepth : THREE.LessEqualDepth });
          m.userData.base = strength * (behind ? BEHIND : 1);
          const line = new THREE.LineSegments(geometry, m);
          line.raycast = () => {};
          line.renderOrder = behind ? 2 : 3;
          group.add(line);
          mats.push(m);
        }
      }
      group.name = `probe ${p.id}`;
      // The frame's node puts mm with z up in the scene: the lines go where the parts do.
      group.matrixAutoUpdate = false;
      group.matrix.copy(frame.matrixWorld);
      group.visible = false;
      scene.add(group);
      probeLines.push({ p, group, mats, box: shape.box });
    }
  }

  function destroy() {
    if (!alive) return;
    // What the pointer was over is pointed at no more: the drawing would keep its line lit.
    if (hover) setHover(null);
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
    for (const [, els] of placed) for (const el of els) el?.remove();
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
    /** Marks the problems, sees through the case, marks the centre of mass (each toggles with no argument). */
    marks: (on) => { setMarks(on); return showMarks; },
    xray: (on) => { setXray(on); return xray; },
    mass: (on) => { setMass(on); return showMass; },
    /** Draws the function probes (toggles with no argument). */
    probes: (on) => { setProbes(on); return showProbes; },
    /** Shows a probe by its place in view.probes, as a panel's Show does. */
    showProbe: (i) => showProbe(i),
    /** The probe shown, by its place in view.probes, or null. */
    get probe() { return probeSpot; },
    /** How a probe is drawn now: its colour (as three reads it, hex) and its lines' opacity; null where it isn't drawn. */
    probeLook(i) {
      const d = probeLines.find((x) => x.p.i === i);
      return d && shownNow(d.group) ? { color: `#${d.mats[0].color.getHexString()}`, opacity: d.mats[0].opacity } : null;
    },
    /** Shows the marks of problems by their place in view.problems, as a panel's Show does. */
    show: (list) => showSpot([].concat(list)),
    /** Shows a pose, by its place in view.poses or its name (one it doesn't have changes nothing), as the Pose list
     * does; with no argument, says which is shown. Its place in view.poses. */
    pose: (k) => (k === undefined ? posed : typeof k === "string" ? (poses.some((p) => p.name === k) ? setPose(poses.findIndex((p) => p.name === k)) : posed) : setPose(k)),
    get posed() { return posed; },
    get spot() { return [...spot]; },
    /** The page's colours as it draws with them (each token as three reads it), for a page or a test to read. */
    get colors() { return { ...colors }; },
    get toggles() { return { problems: showMarks, xray, mass: showMass, probes: showProbes }; },
    /** What is drawn now, for a page or a test to read: the marks shown (their places in view.problems), whether the
     * centre of mass is and which poses' are (their places in view.poses), the parts drawn (by id, once for each mesh
     * shown, sorted), the parts drawn as glass, the parts whose edges show through what hides them, and the probes
     * drawn (their places in view.probes). */
    get drawn() {
      const meshes = [];
      scene?.traverse((o) => { if (o.isMesh && o.userData.sprue && shownNow(o)) meshes.push(o.userData.sprue.id); });
      return { marks: sprites.filter((x) => x.front.visible).map((x) => x.m.i), com: Boolean(comMarks[posed] && comMarks[posed].visible),
        coms: comMarks.flatMap((c, k) => (c && shownNow(c) ? [k] : [])), parts: meshes.sort(),
        glass: xray ? all.filter((p) => cases.has(p.id) && p.mesh.visible).map((p) => p.id) : [],
        ghosts: all.filter((p) => p.ghost && p.ghost.visible).map((p) => p.id),
        probes: probeLines.filter((d) => d.group.visible).map((d) => d.p.i) };
    },
    get apart() { return apart; },
    get at() { return at; },
    get pinned() { return pinned; },
    get hover() { return hover; },
    get line() { return chosen; },
    /** A part's box where it is drawn now, [x0, y0, z0, x1, y1, z1] in mm in the frame (where the pose shown moves it,
     * or as its pose draws it along a path); null for a part not drawn, or before the view is ready. */
    boxOf(id) {
      const part = alive && model ? parts.get(id) : null;
      if (!part || !shownNow(part.mesh) || !frame) return null;
      const pos = part.mesh.geometry.attributes.position, v = new THREE.Vector3(), box = new THREE.Box3();
      const toFrame = frame.matrixWorld.clone().invert().multiply(part.mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(toFrame));
      return [...box.min.toArray(), ...box.max.toArray()];
    },
    /** How a part's edges are drawn, and the ones that show through what hides it when it is lit: null for a solid
     * line, or [dash, gap] in mm; null for no such part, or before the view is ready. */
    strokeOf(id) {
      const part = alive && model ? parts.get(id) : null;
      if (!part) return null;
      const of = (m) => (m.isLineDashedMaterial ? [m.dashSize, m.gapSize] : null);
      return { edges: of(part.edges.material), ghost: of(ghostLine(part)) };
    },
    /** Where the middle of the top of a part's box is on the page, in client px, now (not at the last frame drawn), or
     * a point given as [x, y, z] in mm in the frame (a problem's `at`); null when the part isn't drawn, or it is behind
     * the camera. */
    screenOf(id) {
      if (!alive || !camera) return null;
      let p;
      if (Array.isArray(id)) {
        if (!frame || id.length !== 3 || !id.every(Number.isFinite)) return null;
        place();
        p = new THREE.Vector3(...id).applyMatrix4(frame.matrixWorld).project(camera);
      } else {
        const part = parts.get(id);
        if (!part) return null;
        place();
        const box = part.mesh.geometry.boundingBox.clone().applyMatrix4(part.mesh.matrixWorld);
        p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
      }
      if (p.z > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    destroy,
  };
}

// ---- the page: three.js from its vendored modules' text, and Fig 1's tabs -------------------------------------------

/** A vendored module's source with each of its imports of a bare name (`from "three"`, `import "three/core"`) made the
 * URL `urls` gives that name. Every name in `names` must be imported (vendor.json lists what each file imports), so
 * one left out throws rather than leaving a name the page can't resolve.
 * @param {string} src @param {string[]} names @param {(name: string) => string | undefined} urls */
export function rewriteImports(src, names, urls) {
  let out = src;
  for (const name of names) {
    const url = urls(name);
    if (!url) throw new Error(`it imports ${name}, which isn't loaded before it`);
    const quoted = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    let n = 0;
    out = out.replace(new RegExp(`(\\b(?:from|import)\\s*)(["'])${quoted}\\2`, "g"), (_, lead, q) => { n++; return `${lead}${q}${url}${q}`; });
    if (!n) throw new Error(`it doesn't import ${name}, as vendor.json says it does`);
  }
  return out;
}

/** three.js for a page that can't resolve the vendored modules' names ("three", "three/addons/..."): a page from disk,
 * which has no import map, or the website, which bundles none of it. `files` is viewer/vendor/three/vendor.json's
 * `files` in its order (each { name, imports }, a module after those it imports; one with no name, the licence, is
 * left alone); `text(file)` gives a file's source (an inlined script's text, or a fetch's). Each becomes a blob: URL
 * with its imports made the URLs of the modules before it, so the addons share one three.
 * @param {{ name?: string, imports?: string[] }[]} files @param {(file: object) => string | Promise<string>} text
 * @returns {Promise<{ THREE: object, OrbitControls: Function, GLTFLoader: Function }>} */
export async function threeFrom(files, text) {
  const urls = new Map();
  try {
    for (const f of files) {
      if (!f || !f.name) continue;
      let src;
      try {
        src = rewriteImports(await text(f), f.imports || [], (name) => urls.get(name));
      } catch (error) {
        throw new Error(`three.js's ${f.name}: ${error && error.message ? error.message : error}`);
      }
      urls.set(f.name, URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    }
    const get = (name) => {
      if (!urls.has(name)) throw new Error(`three.js's ${name} isn't among the files`);
      return import(/* webpackIgnore: true */ urls.get(name));
    };
    const [THREE, orbit, gltf] = await Promise.all([get("three"), get("three/addons/controls/OrbitControls.js"), get("three/addons/loaders/GLTFLoader.js")])
      .catch((error) => {
        // A module that can't be linked is named by its URL: the name it was made from says more.
        let text = String(error && error.message ? error.message : error);
        for (const [name, url] of urls) text = text.split(url).join(name);
        throw new Error(`three.js: ${text}`);
      });
    return { THREE, OrbitControls: orbit.OrbitControls, GLTFLoader: gltf.GLTFLoader };
  } finally {
    // Imported modules stay loaded: the URLs were only their names.
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

/** The tab a page's hash opens Fig 1 on: "3d" for #3d, or for a part of the model (#part=sw5) or a pose (#pose=...),
 * which only the 3D view shows; else null. @param {string} hash */
export function tabOfHash(hash) {
  const tokens = String(hash || "").replace(/^#/, "").split("&").filter(Boolean);
  return tokens.some((t) => t === "3d" || t.startsWith("part=") || t.startsWith("pose=")) ? "3d" : null;
}

/** Fig 1's tabs: role="tab" buttons with data-a2-tab="<name>" in section, and its elements of each tab, with
 * data-a2-pane="<name>" (the card's body and corners, the controls under it). Shows one tab's elements and hides the
 * others' (hidden), and calls onShow(name) each time one is shown (a page makes the 3D view the first time). A click
 * on a tab, or the arrow keys, Home and End on one, switch; that choice is kept in localStorage under `remember`, so
 * the next page starts there, unless `initial` (the hash's) says otherwise. It never writes the hash, which starts the
 * views in a pose.
 * @param {Element} section
 * @param {{ initial?: string | null, remember?: string, onShow?: (name: string) => void }} [opts]
 * @returns {{ show(name: string): string, readonly now: string, destroy(): void }} */
export function mountTabs(section, opts = {}) {
  const tabs = [...section.querySelectorAll('[role="tab"][data-a2-tab]')];
  const names = tabs.map((t) => t.getAttribute("data-a2-tab"));
  const list = (tabs[0] && tabs[0].closest('[role="tablist"]')) || section;
  let now = "";
  const recall = () => {
    try { return opts.remember ? localStorage.getItem(opts.remember) : null; } catch { return null; }
  };
  const keep = (name) => {
    try { if (opts.remember) localStorage.setItem(opts.remember, name); } catch { /* no storage: the next page starts on the first tab */ }
  };
  function show(name) {
    const to = names.includes(name) ? name : names[0] || "";
    if (to === now) return now;
    now = to;
    tabs.forEach((t, i) => {
      t.setAttribute("aria-selected", String(names[i] === to));
      t.tabIndex = names[i] === to ? 0 : -1;
    });
    for (const el of section.querySelectorAll("[data-a2-pane]")) el.hidden = el.getAttribute("data-a2-pane") !== to;
    section.setAttribute("data-a2-view", to);
    if (opts.onShow) opts.onShow(to);
    return now;
  }
  const onClick = (event) => {
    const tab = event.target.closest && event.target.closest('[role="tab"][data-a2-tab]');
    if (tab && tabs.includes(tab)) keep(show(tab.getAttribute("data-a2-tab")));
  };
  const onKey = (event) => {
    const i = tabs.indexOf(event.target);
    if (i < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    const tab = tabs[(to + tabs.length) % tabs.length];
    keep(show(tab.getAttribute("data-a2-tab")));
    tab.focus();
    event.preventDefault();
  };
  list.addEventListener("click", onClick);
  list.addEventListener("keydown", onKey);
  show((opts.initial && names.includes(opts.initial) && opts.initial) || recall() || names[0]);
  return {
    show,
    get now() { return now; },
    destroy() {
      list.removeEventListener("click", onClick);
      list.removeEventListener("keydown", onKey);
    },
  };
}
