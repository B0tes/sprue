// Sprue's 3D view: previews/system.glb, the product as the whole-product check placed it, to turn and pick parts in.
// Read-only for now:
//   drag              turns it; right-drag or shift-drag pans, the wheel or a pinch zooms (three.js OrbitControls)
//   Fit, F            frames the whole product again
//   ← → ↑ ↓, + -      turn, tilt and zoom from the keyboard, while the view has focus
//   hover a part      it lights, every other part steps down a tone, and the readout says what it is
//   click or tap it   pins it (again, or on nothing, unpins): the panel says what it is (its line, how it is drawn,
//                     material, mass, size), what it meets (fits, contacts, gaps the design accepts, the case it is
//                     inside or what it holds inside), the problems and accepted risks of the whole-product check that
//                     name it, and its line's files that are in the product folder; a part it meets is a button
//   the Part list     pins a part from the keyboard, or where there is no 3D
//   Escape            unpins
// Solid edges are parts drawn from their own CAD, dashed ones envelopes: bought parts as boxes and cylinders at their
// datasheet sizes. The legend says so and names the BOM lines that are not in the model. Without WebGL 2 the view says
// so and keeps the list and the panel. Nothing draws until something changes, so nothing runs offscreen, and reduced
// motion jumps instead of easing. The colours are the drawing kit's (--anatomy-*), read again when the theme changes.
// It imports nothing: mountModel takes three as an argument ({ THREE, OrbitControls, GLTFLoader }, the vendored
// modules in viewer/vendor/three/), so the page loads three as it can. What the panel says (panelOf, readoutOf,
// legendOf, partsList) is plain functions of the data pipeline/model.ts makes; prepare, frameOf and pickAt need three
// but no page. Tests call all of them in Node.

const PROCESS = { buy: "bought", print: "printed", pcb: "PCB", cnc: "machined", sheet: "sheet metal" };
/** The view the camera starts from, in the model's frame (glTF: y up, z toward the viewer): from the front, to the
 * right and above, as build.py draws each part's preview, (1, -1, 0.8) in the product's frame with z up. */
const VIEW_FROM = [1, 0.8, 1];
const FOV = 30; // degrees; a long lens keeps the parts near the drawing's shapes
const EDGE_DEG = 30; // a crease sharper than this between faces is drawn as an edge
const DASH = [1.2, 0.8]; // mm, an envelope's dashed edges
const MOVED = 5; // px a pointer may move between down and up and still click
const FIT_S = 0.45; // seconds the camera takes to frame the product

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
 * @typedef {{ slug: string, model: { file: string, inputs: string, triangles: number }, minClearanceMm: number | null,
 *   items: Item[], relations: Relations, problems: Problem[], lines: Record<string, Line>,
 *   files: Record<string, File[]> }} View
 * @typedef {{ kind: "fit" | "contact" | "gap" | "inside" | "holds", with: string[], why: string }} Meet
 * @typedef {{ id: string, title: string, sub: string, facts: [string, string][], meets: Meet[],
 *   problems: { gate: string, title: string, text: string, accepted: boolean }[], files: File[] }} Panel
 */

/** @param {number} n @param {number} [d] */
const fmt = (n, d = 1) => String(Number(n.toFixed(d)));
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

/** A part as a few words: its line's short name, and its number when the line has several ("Keycap 6").
 * @param {View} view @param {string} id @returns {string} */
export function labelOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return id;
  const line = item.line ? view.lines[item.line] : undefined;
  const c = countOf(view, item);
  return `${line ? line.short || line.name : item.id}${c ? ` ${c.k}` : ""}`;
}

/** What the readout says of a part, in the drawing's words: "Keycap 6 of 9 · bought · envelope".
 * @param {View} view @param {string} id @returns {string} */
export function readoutOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return "";
  const line = item.line ? view.lines[item.line] : undefined;
  const c = countOf(view, item);
  return [`${line ? line.short || line.name : item.id}${c ? ` ${c.k} of ${c.n}` : ""}`,
    line ? PROCESS[line.process] || line.process : "not a BOM line", item.model === "envelope" ? "envelope" : "CAD"].join(" · ");
}

/** Each relation of system.json that names the part, as the panel lists it: what (fit, contact, gap, inside, holds),
 * the other parts, and why. A relation whose gate couldn't run (its pairs null) names none.
 * @param {View} view @param {string} id @returns {Meet[]} */
function meetsOf(view, id) {
  const r = view.relations || {};
  /** @type {Meet[]} */
  const out = [];
  /** @param {[string, string][] | null} pairs */
  const others = (pairs) => (pairs || []).filter((p) => p.includes(id)).map((p) => (p[0] === id ? p[1] : p[0]));
  for (const f of r.fits || []) { const w = others(f.pairs); if (w.length) out.push({ kind: "fit", with: w, why: f.why }); }
  for (const c of r.contacts || []) {
    const w = others(c.pairs);
    if (w.length) out.push({ kind: "contact", with: w, why: c.gap > 0 ? `${c.why} (within ${fmt(c.gap, 2)} mm)` : c.why });
  }
  for (const g of r.gaps || []) {
    const w = others(g.pairs);
    if (w.length) out.push({ kind: "gap", with: w, why: `${fmt(g.mm, 2)} mm, under the ${fmt(view.minClearanceMm ?? 0, 2)} mm every other pair keeps (accepted: ${g.accept})` });
  }
  // What a case part holds is one row of every part inside it: each Inside's why only names its parts again.
  /** @type {string[]} */
  const holds = [];
  for (const s of r.inside || []) {
    if ((s.parts || []).includes(id)) out.push({ kind: "inside", with: s.case || [], why: s.why });
    if ((s.case || []).includes(id)) for (const p of s.parts || []) if (p !== id && !holds.includes(p)) holds.push(p);
  }
  if (holds.length) out.push({ kind: "holds", with: holds, why: "" });
  return out;
}

/** The part's mass as the stability gate weighs it, with how it was found. @param {Item} item */
function massOf(item) {
  if (item.massG == null) return `not known: ${item.massNote || "no mass"}`;
  return `${fmt(item.massG, 2)} g${item.massNote ? `, ${item.massNote}` : ""}`;
}

/** What the panel shows of a part: { id, title, sub, facts: [[label, text]], meets, problems, files }, or null. Only
 * problems that name the part are listed, so a part of a product that fails never reads as passing.
 * @param {View} view @param {string} id @returns {Panel | null} */
export function panelOf(view, id) {
  const item = itemOf(view, id);
  if (!item) return null;
  const line = item.line ? view.lines[item.line] : undefined;
  const c = countOf(view, item);
  /** @type {[string, string][]} */
  const facts = [["Drawn", item.model === "envelope"
    ? "as an envelope: boxes and cylinders at its datasheet sizes, not its maker's model"
    : "from its own CAD"]];
  if (item.material) facts.push(["Material", item.material]);
  facts.push(["Mass", massOf(item)]);
  if (Array.isArray(item.bbox) && item.bbox.length === 6) {
    const [x0, y0, z0, x1, y1, z1] = item.bbox;
    facts.push(["Size", `${fmt(x1 - x0)} × ${fmt(y1 - y0)} × ${fmt(z1 - z0)} mm (x, y, z)`]);
  }
  if (item.tags && item.tags.length) facts.push(["Tags", item.tags.join(", ")]);
  if (line) facts.push(["In the BOM", `${line.qtyPerUnit || !line.qtyPerBatch ? `${line.qtyPerUnit ?? 1} a unit` : `${line.qtyPerBatch} for the batch`} (${item.line})`]);
  return {
    id: item.id,
    title: line ? line.name : item.id,
    sub: [item.id, c ? `${c.k} of ${c.n}` : "", line ? PROCESS[line.process] || line.process : "not a BOM line"].filter(Boolean).join(" · "),
    facts,
    meets: meetsOf(view, id),
    problems: view.problems.filter((p) => p.parts.includes(id)).map((p) => ({ gate: p.gate, title: p.title, text: p.text, accepted: p.accepted })),
    files: (item.line && view.files[item.line]) || [],
  };
}

/** The legend: how many parts are drawn from CAD and how many are envelopes, and the BOM lines not in the model.
 * @param {View} view @returns {{ cad: number, envelopes: number, unplaced: { line: string, name: string, why: string }[] }} */
export function legendOf(view) {
  const envelopes = view.items.filter((i) => i.model === "envelope").length;
  const unplaced = Object.entries((view.relations && view.relations.unplaced) || {})
    .map(([line, why]) => ({ line, name: view.lines[line] ? view.lines[line].name : line, why }));
  return { cad: view.items.length - envelopes, envelopes, unplaced };
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
    g.items.push({ id: item.id, label: `${labelOf(view, item.id)} (${item.id})` });
  }
  return groups;
}

// ---- the model: three, but no page ---------------------------------------------------------------------------------

/** Readies the loaded model to draw: each mesh named by an item gets smooth normals (the model has none, so each face
 * shades smooth and each edge stays sharp), a material of its own in the kit's tones (a board keeps its picture) and
 * its edges, dashed for an envelope. Returns the meshes by item id; a node no item names is drawn but not picked. */
export function prepare(three, scene, colors, ids) {
  const { THREE } = three;
  const parts = new Map();
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const was = mesh.material;
    const kind = was && was.name === "envelope" ? "envelope" : was && was.map ? "board" : "cad";
    mesh.geometry.computeVertexNormals();
    mesh.material = new THREE.MeshLambertMaterial({
      color: 0xffffff, map: kind === "board" ? was.map : null,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // edges sit on the faces, never under them
    });
    mesh.material.name = was ? was.name : kind;
    if (was) was.dispose();
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_DEG),
      kind === "envelope"
        ? new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: DASH[0], gapSize: DASH[1] })
        : new THREE.LineBasicMaterial({ color: 0xffffff }));
    if (kind === "envelope") edges.computeLineDistances();
    edges.raycast = () => {}; // a pick hits the part, never its edges
    edges.name = `${mesh.name} edges`;
    mesh.add(edges);
    const part = { mesh, edges, kind };
    mesh.userData.sprue = part;
    if (!ids || ids.has(mesh.name)) parts.set(mesh.name, part);
    look(three, part, "rest", colors);
  }
  return parts;
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

/** Where the camera goes to frame `object` from `dir`: the centre and radius of its bounding sphere, the position, and
 * near and far planes that hold it, for a camera of `fovDeg` (vertical) and `aspect`. */
export function frameOf(three, object, aspect, fovDeg = FOV, dir = VIEW_FROM) {
  const { THREE } = three;
  const box = new THREE.Box3().setFromObject(object);
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
  return { center, radius, distance, position, near: Math.max(distance - radius * 1.5, distance / 100), far: distance + radius * 4 };
}

/** The id of the part under a point of the view (x and y from -1 to 1, y up), or null. */
export function pickAt(three, camera, parts, x, y) {
  const { THREE } = three;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const meshes = [...parts.values()].map((p) => p.mesh).filter((m) => m.visible);
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? hit.object.name : null;
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

const KIND_WORDS = { fit: "Fits", contact: "Touches", gap: "Allowed close to", inside: "Inside", holds: "Holds inside" };

/**
 * @param {Element} root      the view is drawn in it (its children are replaced)
 * @param {object} view       pipeline/model.ts modelView: items, relations, problems, lines, files
 * @param {ArrayBuffer} glb   previews/system.glb
 * @param {{ THREE: object, OrbitControls: Function, GLTFLoader: Function }} three
 * @param {{ readout?: Element | false, scope?: Element, fileHref?: (path: string) => string | null }} opts
 *   readout defaults to [data-readout] inside scope (the closest [data-a2-figure] around root); false turns it off.
 *   fileHref makes each listed file a link (a page in the product folder can pass the path itself).
 * @returns {{ ready: Promise<{ ok: boolean, why?: string }>, select(id: string | null): void, fit(): void,
 *   readonly pinned: string | null, readonly hover: string | null, screenOf(id: string): { x: number, y: number } | null,
 *   destroy(): void }}
 */
export function mountModel(root, view, glb, three, opts = {}) {
  const { THREE, OrbitControls, GLTFLoader } = three;
  const scope = opts.scope || root.closest("[data-a2-figure]") || root.parentElement || root;
  const readout = opts.readout === false ? null : opts.readout || scope.querySelector("[data-readout]");
  const restText = readout ? readout.textContent : "";
  const fileHref = typeof opts.fileHref === "function" ? opts.fileHref : null;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const touch = matchMedia("(hover: none) and (pointer: coarse)");
  const ids = new Set(view.items.map((i) => i.id));
  const total = view.items.length;
  const legend = legendOf(view);
  const rest = `3D · ${plural(total, "part")}`;

  let alive = true;
  let pinned = null, hover = null;
  let renderer = null, scene = null, camera = null, controls = null, parts = new Map(), model = null;
  let colors = readColors();
  let raf = 0, hoverRaf = 0, hoverAt = null, down = null, tween = null;
  const off = []; // listeners and observers to undo on destroy
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); off.push(() => target.removeEventListener(type, fn, o)); };

  // ---- the page's part of it ----
  root.classList.add("a2-model");
  root.setAttribute("data-state", "loading");
  const canvas = h("canvas", { class: "a2-model-canvas", "aria-hidden": "true" });
  const note = h("p", { class: "a2-model-note", hidden: true });
  const stage = h("div", { class: "a2-model-stage", tabindex: "0", role: "group",
    "aria-label": `${view.slug || "The product"} in 3D. Drag to turn it, click a part to see what it is, F to fit; the arrow keys turn it and + and - zoom.` }, canvas, note);
  const fitButton = h("button", { type: "button", class: "a2-btn", "data-a2m": "fit" }, "Fit");
  const select = h("select", { class: "a2-model-select", "data-a2m": "part" }, h("option", { value: "" }, "Pick a part"),
    partsList(view).map((g) => h("optgroup", { label: g.name }, g.items.map((i) => h("option", { value: i.id }, i.label)))));
  const hint = h("span", { class: "a2-model-hint" });
  const bar = h("div", { class: "a2-bar a2-model-bar" }, fitButton, h("label", { class: "a2-model-pick" }, h("span", null, "Part"), select), hint);
  const legendEl = h("div", { class: "a2-model-legend" },
    h("p", null,
      h("span", { class: "a2-model-key", "data-kind": "cad", "aria-hidden": "true" }), ` ${legend.cad} drawn from their own CAD`,
      legend.envelopes ? [h("span", { class: "a2-model-gap" }), h("span", { class: "a2-model-key", "data-kind": "envelope", "aria-hidden": "true" }),
        ` ${legend.envelopes} ${legend.envelopes === 1 ? "envelope" : "envelopes"}: bought parts as boxes and cylinders at their datasheet sizes, not their makers' models; one may be only the end the product holds, a cable's plug`] : null),
    legend.unplaced.length ? h("p", { class: "a2-model-unplaced" }, h("b", null, "Not in the model: "),
      legend.unplaced.map((u, i) => [i ? "; " : "", h("span", { title: u.line }, u.name), ` (${u.why})`])) : null);
  const panel = h("section", { class: "a2-model-panel", "aria-label": "The part picked" });
  const say = h("p", { class: "a2-model-say", "aria-live": "polite" });
  root.replaceChildren(stage, bar, legendEl, panel, say);

  const setHint = () => {
    hint.textContent = touch.matches ? "drag to turn · pinch to zoom · tap a part" : "drag to turn · scroll to zoom · click a part · f fits";
  };
  setHint();
  on(touch, "change", setHint);

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function readColors() {
    const style = getComputedStyle(root);
    return Object.fromEntries(Object.entries(TOKENS).map(([k, [name, fallback]]) => [k, style.getPropertyValue(name).trim() || fallback]));
  }

  // ---- what is lit, said and listed ----
  function update() {
    const focus = pinned || hover;
    for (const [id, part] of parts) look(three, part, id === pinned || id === hover ? "on" : focus ? "dim" : "rest", colors);
    // While a part is pinned the readout says it, whatever the pointer is over.
    const text = pinned ? readoutOf(view, pinned) : hover ? readoutOf(view, hover) : rest;
    if (readout && readout.textContent !== text) { readout.textContent = text; readout.setAttribute("title", text); }
    request();
  }

  function renderPanel() {
    select.value = pinned || "";
    const p = pinned ? panelOf(view, pinned) : null;
    if (!p) {
      panel.replaceChildren(h("p", { class: "a2-model-empty" },
        `${touch.matches ? "Tap" : "Click"} a part, or pick it in the list, to see what it is, what it meets and its files.`));
      return;
    }
    const pick = (id) => ids.has(id)
      ? h("button", { type: "button", class: "a2-model-link", "data-a2m-pick": id, title: readoutOf(view, id) }, labelOf(view, id))
      : h("span", { class: "a2-model-link" }, id);
    const file = (f) => {
      const href = fileHref ? fileHref(f.path) : null;
      return h("li", null, href ? h("a", { href }, h("code", null, f.path)) : h("code", null, f.path), h("span", null, f.what));
    };
    panel.replaceChildren(...[
      h("div", { class: "a2-model-head" },
        h("div", null, h("h3", { class: "a2-model-title" }, p.title), h("p", { class: "a2-model-sub" }, p.sub)),
        h("button", { type: "button", class: "a2-btn a2-icon", "data-a2m": "clear", "aria-label": "Unpin the part" }, "×")),
      h("dl", { class: "a2-model-facts" }, p.facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      p.meets.length ? h("div", { class: "a2-model-block" }, h("h4", null, "What it meets"),
        h("ul", { class: "a2-model-meets" }, p.meets.map((m) => h("li", null, h("b", null, KIND_WORDS[m.kind]), " ",
          m.with.map((id, i) => [i ? " " : "", pick(id)]), m.why ? h("span", { class: "a2-model-why" }, m.why) : null)))) : null,
      p.problems.length ? h("div", { class: "a2-model-block" }, h("h4", null, "The whole-product check"),
        h("ul", { class: "a2-model-problems" }, p.problems.map((x) => h("li", { "data-accepted": x.accepted || null },
          h("b", null, x.accepted ? "Accepted risk" : "Problem"), h("span", { class: "a2-model-gate" }, x.title), h("span", null, x.text))))) : null,
      h("div", { class: "a2-model-block" }, h("h4", null, "Files"),
        p.files.length ? h("ul", { class: "a2-model-files" }, p.files.map(file))
          : h("p", { class: "a2-model-none" }, "None of its own in the product folder.")),
    ].filter(Boolean));
  }

  function choose(id, toggle = true) {
    const next = id && ids.has(id) ? (toggle && id === pinned ? null : id) : null;
    if (next === pinned) return;
    pinned = next;
    say.textContent = pinned ? `Pinned: ${readoutOf(view, pinned)}` : "Unpinned";
    renderPanel();
    update();
  }

  function setHover(id) {
    const next = id && parts.has(id) ? id : null;
    if (next === hover) return;
    hover = next;
    update();
  }

  // ---- the panel and the bar ----
  on(panel, "click", (event) => {
    const b = event.target.closest("[data-a2m-pick],[data-a2m]");
    if (!b) return;
    if (b.hasAttribute("data-a2m-pick")) choose(b.getAttribute("data-a2m-pick"), false);
    else if (b.getAttribute("data-a2m") === "clear") { choose(null); (stage.hasAttribute("tabindex") ? stage : select).focus({ preventScroll: true }); }
  });
  on(select, "change", () => choose(select.value || null, false));
  on(fitButton, "click", () => fit());
  on(root, "keydown", (event) => {
    if (event.target.closest("select, input, textarea") || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape" && pinned) { choose(null); event.preventDefault(); return; }
    if ((event.key === "f" || event.key === "F") && controls) { fit(); event.preventDefault(); return; }
    if (event.target !== stage || !controls) return;
    const turn = Math.PI / 12;
    const keys = { ArrowLeft: () => controls.rotateLeft(turn), ArrowRight: () => controls.rotateLeft(-turn),
      ArrowUp: () => controls.rotateUp(turn), ArrowDown: () => controls.rotateUp(-turn),
      "+": () => controls.dollyIn(1.25), "=": () => controls.dollyIn(1.25), "-": () => controls.dollyOut(1.25) };
    if (keys[event.key]) { tween = null; keys[event.key](); event.preventDefault(); }
  });
  renderPanel();

  // ---- drawing ----
  function request() {
    if (alive && renderer && !raf) raf = requestAnimationFrame(draw);
  }
  function draw(now) {
    raf = 0;
    if (!alive || !renderer) return;
    let more = false;
    if (tween) more = stepTween(now);
    if (controls.enableDamping && controls.update()) more = true;
    renderer.render(scene, camera);
    if (more) request();
  }

  function fit(jump = still.matches) {
    if (!model || !camera) return;
    const f = frameOf(three, model, camera.aspect || 1);
    camera.near = f.near;
    camera.far = f.far;
    camera.updateProjectionMatrix();
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
      request();
    } else {
      tween = { t0: null, from: camera.position.clone(), to: f.position, aim: controls.target.clone(), at: f.center };
      request();
    }
  }
  function stepTween(now) {
    if (tween.t0 == null) tween.t0 = now;
    const t = Math.min(1, (now - tween.t0) / 1000 / FIT_S);
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(tween.from, tween.to, e);
    controls.target.lerpVectors(tween.aim, tween.at, e);
    camera.lookAt(controls.target);
    if (t >= 1) { tween = null; controls.update(); return false; }
    return true;
  }

  function size() {
    if (!renderer) return;
    const w = stage.clientWidth, hgt = stage.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    request();
  }

  function pickClient(x, y) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return pickAt(three, camera, parts, ((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  function recolor() {
    colors = readColors();
    update();
  }

  function fail(state, why) {
    root.setAttribute("data-state", state);
    showNote(why);
    fitButton.hidden = true;
    stage.removeAttribute("tabindex");
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
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    let gltf;
    try {
      gltf = await new GLTFLoader().parseAsync(glb, "");
    } catch (error) {
      return fail("error", `The 3D model could not be read (${error && error.message ? error.message : error}).`);
    }
    if (!alive) return { ok: false, why: "destroyed" };
    scene = new THREE.Scene();
    model = gltf.scene;
    scene.add(model);
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.001, 10);
    // Light from above, and a lamp at the camera: a face toward the viewer reads, whichever way the product is turned.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6f6f, 2.2));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.1);
    lamp.position.set(0.3, 0.6, 1);
    camera.add(lamp);
    scene.add(camera);
    parts = prepare(three, model, colors, ids);
    if (gltf.asset && gltf.asset.extras && view.model && gltf.asset.extras.inputs !== view.model.inputs)
      showNote("This model is of another run than system.json: run sprue system to draw it again.");
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !still.matches;
    controls.dampingFactor = 0.12;
    on(controls, "change", request);
    on(still, "change", () => { controls.enableDamping = !still.matches; });
    on(canvas, "pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; tween = null; });
    on(canvas, "pointerup", (e) => {
      if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < MOVED && e.button === 0)
        choose(pickClient(e.clientX, e.clientY));
      down = null;
    });
    on(canvas, "pointercancel", () => { down = null; });
    on(canvas, "pointermove", (e) => {
      if (e.pointerType === "touch" || e.buttons) return;
      hoverAt = [e.clientX, e.clientY];
      if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (hoverAt) setHover(pickClient(...hoverAt)); });
    });
    on(canvas, "pointerleave", () => { hoverAt = null; setHover(null); });
    on(canvas, "webglcontextlost", (e) => { e.preventDefault(); showNote("The 3D view lost its drawing context; it draws again when the browser gives it back."); });
    on(canvas, "webglcontextrestored", () => { showNote(""); request(); });
    const resized = new ResizeObserver(size);
    resized.observe(stage);
    off.push(() => resized.disconnect());
    const themed = new MutationObserver(recolor);
    for (const el of new Set([document.documentElement, document.body, root.closest("[data-theme]")].filter(Boolean)))
      themed.observe(el, { attributes: true, attributeFilter: ["data-theme", "class"] });
    off.push(() => themed.disconnect());
    on(matchMedia("(prefers-color-scheme: light)"), "change", recolor);
    size();
    fit(true);
    update();
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
    select: (id) => choose(id, false),
    fit: () => fit(),
    get pinned() { return pinned; },
    get hover() { return hover; },
    /** Where the middle of the top of a part's box is on the page, in client px, or null (not drawn, or behind). */
    screenOf(id) {
      const part = parts.get(id);
      if (!part || !camera) return null;
      const box = new THREE.Box3().setFromObject(part.mesh);
      const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
      if (p.z > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    destroy,
  };
}
