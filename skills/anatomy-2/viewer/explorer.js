// Anatomy 2.0 explorer. Renders a run's explorer.json (the Explorer type in pipeline/explore.ts)
// as one tab per stage, with a live BOM: pick another offer for a line and the batch total is
// recomputed with the same rule as totalFor() in explore.ts. The standalone view.html the CLI
// writes and the website both use this file. Plain modern JS, no dependencies, no network.

/**
 * @typedef {{ supplier: string, sku: string, mpn?: string, url: string, packSize?: number, unitUsd: number,
 *   orderQty: number, orderUsd: number, stock: number | string, leadDays: number, source: string,
 *   capturedAt: string }} ExplorerOption
 * @typedef {{ supplier: string, sku: string, orderQty: number, orderUsd: number, leadDays: number, mode: string,
 *   basis: string }} ExplorerMade
 * @typedef {{ id: string, name: string, role: string, process: string, qtyPerUnit: number,
 *   spec: Record<string, string | number | undefined>, mpn?: string, notes?: string, file?: string,
 *   pin?: { supplier: string, sku?: string }, options: ExplorerOption[], chosen: number, made?: ExplorerMade,
 *   shipsFree?: boolean }} ExplorerLine
 * @typedef {{ id: string, title: string, status: string, detail: string, lines?: string[] }} ExplorerCheck
 * @typedef {{ slug: string, product: string, brief: string, units: number, region: string, budgetUsd?: number,
 *   summary: string, architecture: string[], params: Record<string, number | string | undefined>, assembly: string[],
 *   lines: ExplorerLine[], shipping: Record<string, number>,
 *   totals: { batchUsd: number, perUnitUsd: number, longestLeadDays: number, unquoted: string[] },
 *   checks: ExplorerCheck[], score?: any, previews: { name: string, svg: string }[], designMd?: string,
 *   buildPlanMd?: string, generatedAt: string }} Explorer
 * @typedef {{ initialTab?: string, compact?: boolean, headingLevel?: number }} MountOptions
 */

const SVGNS = "http://www.w3.org/2000/svg";
let seq = 0;
/** One explorer per element: mounting again destroys the one already there. */
const mounted = new WeakMap();

/** The three gated stages of a run. Each tab below is one step inside one of them. */
export const STAGES = [
  { id: "design", n: "1", label: "Design" },
  { id: "source", n: "2", label: "Source" },
  { id: "build", n: "3", label: "Build" },
];

/** Tabs, numbered by the pipeline step whose file they show (steps 0-6 of the command line). */
export const TABS = [
  { id: "request", n: "0", stage: "design", label: "Request", title: "The request", lede: "What was asked for, turned into fields the later steps check against." },
  { id: "design", n: "1", stage: "design", label: "Design", title: "Design and CAD", lede: "The numbers the design is built from, and the CAD drawn from them." },
  { id: "bom", n: "2", stage: "design", label: "BOM", title: "Bill of materials", lede: "Every part, what to order and where from. Open a bought line to see every offer and pick another." },
  { id: "checks", n: "3", stage: "design", label: "Checks", title: "Engineer checks", lede: "Rules the design has to pass. Anything a rule can't settle goes to a person." },
  { id: "suppliers", n: "4–5", stage: "source", label: "Suppliers", title: "Suppliers and shipping", lede: "The shops in this order, what each one supplies and what it charges to ship." },
  { id: "plan", n: "6", stage: "build", label: "Plan", title: "Build plan", lede: "How to put it together once the parts arrive." },
];

const MODES = {
  snapshot: ["Snapshot", "Price read from the product page"],
  api: ["API", "Live price from the supplier's API"],
  formula: ["Scripted", "Worked out from the shop's published price rule"],
  scripted: ["Scripted", "Worked out from the fab's published price rule"],
  estimate: ["Estimate", "An assumed rate, not a quote or a published price"],
  agent: ["Agent RFQ", "Quote requested from the shop"],
};

// ---- numbers -----------------------------------------------------------------------------

const round = (x) => Math.round(x * 100) / 100;
const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** $1,234.56, with a real minus sign for negatives. */
export const usd = (x) => (round(x) < 0 ? "−" : "") + moneyFmt.format(Math.abs(round(x)));
/** +$1.65 / −$1.65 / $0.00 */
const signed = (x) => (round(x) > 0 ? "+" : "") + usd(x);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A unit price: to the cent when that is exact, else to four places ("about" if even that rounds). */
function unitUsd(x) {
  if (Math.abs(x * 100 - Math.round(x * 100)) < 1e-6) return usd(x);
  const four = Math.round(x * 1e4) / 1e4;
  return `${Math.abs(x - four) < 1e-9 ? "" : "about "}$${four.toFixed(4).replace(/0+$/, "")}`;
}

/** What an offer orders, written so the numbers multiply out to its cost: "1 pack of 50 × $5.95". */
function orderText(o) {
  const pack = o.packSize > 1 ? o.packSize : 0;
  const unit = o.orderUsd / Math.max(1, o.orderQty);
  if (!pack) return { main: `${numFmt.format(o.orderQty)} × ${unitUsd(unit)}`, sub: "" };
  const packs = Math.max(1, Math.round(o.orderQty / pack));
  const per = round(o.orderUsd / packs);
  const exact = Math.abs(per * packs - o.orderUsd) < 0.005;
  return { main: `${plural(packs, "pack")} of ${numFmt.format(pack)}${exact ? ` × ${usd(per)}` : ""}`, sub: `${unitUsd(unit)} each` };
}

/**
 * The batch total for a choice of option per line, exactly as totalFor() in explore.ts: each bought
 * line's chosen option, each made line's fab price, and one shipping charge per shop used (made lines
 * whose price includes shipping add no shop).
 * @param {Explorer} ex @param {number[]} choice
 */
export function totalFor(ex, choice) {
  return breakdown(ex, choice).total;
}

/** totalFor, with its parts kept: the same additions in the same order, so the totals match to the cent. */
function breakdown(ex, choice) {
  let sum = 0;
  let parts = 0;
  const shops = new Set();
  /** @type {Map<string, { rows: { line: ExplorerLine, i: number, usd: number, opt?: ExplorerOption }[], made: boolean, shipsFree: boolean }>} */
  const byShop = new Map();
  let lead = { days: 0, line: /** @type {ExplorerLine | null} */ (null), supplier: "" };
  const put = (s, row, made, shipsFree) => {
    const e = byShop.get(s) ?? { rows: [], made, shipsFree: true };
    e.rows.push(row);
    e.shipsFree = e.shipsFree && shipsFree;
    byShop.set(s, e);
  };
  ex.lines.forEach((l, i) => {
    if (l.made) {
      sum += l.made.orderUsd;
      parts += l.made.orderUsd;
      if (!l.shipsFree) shops.add(l.made.supplier);
      put(l.made.supplier, { line: l, i, usd: l.made.orderUsd }, true, !!l.shipsFree);
      if (l.made.leadDays > lead.days) lead = { days: l.made.leadDays, line: l, supplier: l.made.supplier };
    } else if (l.options[choice[i]]) {
      // A bought line with no choice (-1: quotes.json is older than the offers) adds nothing until one is picked.
      const o = l.options[choice[i]];
      sum += o.orderUsd;
      parts += o.orderUsd;
      shops.add(o.supplier);
      put(o.supplier, { line: l, i, usd: o.orderUsd, opt: o }, false, false);
      if (o.leadDays > lead.days) lead = { days: o.leadDays, line: l, supplier: o.supplier };
    }
  });
  /** @type {[string, number][]} */
  const shipping = [];
  for (const s of shops) {
    const c = ex.shipping[s] ?? 0;
    sum += c;
    shipping.push([s, c]);
  }
  return { total: round(sum), parts: round(parts), shipUsd: round(shipping.reduce((t, [, c]) => t + c, 0)), shipping, shops, byShop, lead };
}

// ---- text --------------------------------------------------------------------------------

const ACRONYMS = new Set(["usb", "gpio", "mcu", "pcb", "mx", "led", "leds", "adc", "dac", "cpu", "ram", "rom", "mpn",
  "sku", "id", "rgb", "ic", "smd", "tht", "i2c", "i2s", "spi", "uart", "pwm", "ac", "dc", "vbus", "vsys", "fps",
  "hdmi", "csi", "poe", "uv", "pla", "petg", "abs", "tpu", "cnc", "bom", "esp32", "fov", "sd"]);
// Longest first, so "Mm" wins over "M".
const UNITS = [["Cm3", "cm³"], ["Mah", "mAh"], ["Mhz", "MHz"], ["Khz", "kHz"], ["Hz", "Hz"], ["Mm", "mm"],
  ["Cm", "cm"], ["Kg", "kg"], ["Ma", "mA"], ["Mw", "mW"], ["Pct", "%"], ["Deg", "°"], ["Db", "dB"], ["Ms", "ms"],
  ["Days", "days"], ["Usd", "$"], ["M", "m"], ["G", "g"], ["V", "V"], ["W", "W"], ["A", "A"]];

/** "plateTopToPcbTopMm" -> ["Plate top to PCB top", "mm"] */
function splitKey(key) {
  let unit = "";
  let stem = key;
  for (const [suf, u] of UNITS) {
    if (key.length > suf.length && key.endsWith(suf) && /[a-z0-9]/.test(key[key.length - suf.length - 1])) {
      unit = u;
      stem = key.slice(0, -suf.length);
      break;
    }
  }
  const words = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().split(/\s+/)
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (ACRONYMS.has(lw)) return lw.toUpperCase();
      return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
    });
  return [words.join(" "), unit];
}

function valueText(v, unit) {
  const numeric = typeof v === "number";
  const text = numeric ? numFmt.format(v) : String(v);
  if (!unit) return text;
  if (unit === "$") return numeric ? usd(v) : text;
  if (!numeric && !/^[\d.,\s x×-]+$/.test(text)) return text;
  return unit === "%" || unit === "°" ? text + unit : `${text} ${unit}`;
}

const arrows = (s) => String(s).replace(/\s?->\s?/g, " → ");
const fileBase = (f) => String(f).split("/").pop().replace(/\.[^.]+$/, "");
const safeUrl = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};
/** One argument, single-quoted unless it is plainly safe ('=' first is quoted too, for zsh). */
const shQuote = (s) => {
  const t = String(s);
  return /^[\w.@%+:,/-][\w.@%+=:,/-]*$/.test(t) ? t : `'${t.replace(/'/g, `'\\''`)}'`;
};
/** A link's label: "Page" for a product page, "Shop" when it only goes to the shop's home page. */
const pageLabel = (u) => {
  try {
    const p = new URL(String(u)).pathname;
    return p === "/" || p === "" ? "Shop" : "Page";
  } catch {
    return "Page";
  }
};

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

// ---- DOM helpers -------------------------------------------------------------------------

/** createElement with attributes and children; strings become text nodes, so nothing is parsed as HTML. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  add(el, kids);
  return el;
}

function add(el, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === "") continue;
    el.append(typeof k === "object" ? k : String(k));
  }
  return el;
}

function fill(el, ...kids) {
  el.replaceChildren();
  return add(el, kids);
}

const ICONS = {
  chev: "M6 3.5 10.5 8 6 12.5",
  check: "M3.2 8.6 6.4 11.6 12.8 4.6",
  cross: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
  flag: "M4 14.5V2M4 2.6h7.6L9.8 5.6l1.8 3H4",
  out: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6",
  arrow: "M2.5 8h11M9.5 4l4 4-4 4",
  reset: "M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8",
};

function icon(name, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.setAttribute("class", "ax-i" + (cls ? " " + cls : ""));
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", ICONS[name]);
  s.append(p);
  return s;
}

function link(url, label, aria) {
  const href = safeUrl(url);
  if (!href) return null;
  return h("a", { class: "ax-link", href, target: "_blank", rel: "noopener noreferrer", "aria-label": aria },
    label, icon("out", "ax-i-out"));
}

/** Text with any http(s) URLs in it turned into links. */
function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s,)]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    const host = safeUrl(m[0]) ? new URL(m[0]).host.replace(/^www\./, "") : m[0];
    out.push(link(m[0], host, `${host}, opens in a new tab`) ?? m[0]);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function modeTag(mode) {
  const [label, hint] = MODES[mode] ?? [mode, ""];
  return h("span", { class: "ax-tag", "data-mode": mode, title: hint }, label);
}

function stockText(s) {
  if (typeof s === "number") return `${numFmt.format(s)} in stock`;
  if (s === "in stock") return "In stock";
  return "Stock unknown";
}

// ---- CAD previews ------------------------------------------------------------------------

const SVG_OK = new Set(["svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text",
  "tspan", "title", "desc", "defs"]);

function luminance(color) {
  const c = String(color).trim().toLowerCase();
  let r, g, b;
  let m;
  if ((m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/))) [r, g, b] = m.slice(1, 4).map(Number);
  else if ((m = c.match(/^#([0-9a-f]{3})$/))) [r, g, b] = [...m[1]].map((x) => parseInt(x + x, 16));
  else if ((m = c.match(/^#([0-9a-f]{6})/))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else return c === "white" ? 1 : 0;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * A build123d line drawing, made safe to inline: only drawing elements survive, no scripts, event
 * handlers, links or ids; every stroke becomes currentColor (grey hidden lines become faint), and line
 * weights are rescaled so the drawing reads at screen size.
 */
function cadSvg(src, label) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(String(src), "image/svg+xml");
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVGNS || doc.getElementsByTagName("parsererror").length) return null;
  let vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((x) => !isFinite(x)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(root.getAttribute("width") || ""), hh = parseFloat(root.getAttribute("height") || "");
    if (!(w > 0 && hh > 0)) return null;
    vb = [0, 0, w, hh];
  }
  const target = Math.max(vb[2], vb[3]) / 560; // about 1 px at the size it's shown
  const clean = (el) => {
    for (const c of [...el.children]) {
      if (c.namespaceURI !== SVGNS || !SVG_OK.has(c.localName)) c.remove();
      else clean(c);
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "href" || n.endsWith(":href") || n === "id" || n === "class" || n === "style"
        || n.startsWith("xml:") || /url\s*\(|javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    const stroke = el.getAttribute("stroke");
    if (stroke && stroke !== "none" && stroke !== "currentColor") {
      el.setAttribute("stroke", "currentColor");
      if (luminance(stroke) > 0.2) el.setAttribute("stroke-opacity", "0.38");
    }
    const fillC = el.getAttribute("fill");
    if (fillC && fillC !== "none" && fillC !== "currentColor") {
      el.setAttribute("fill", "currentColor");
      el.setAttribute("fill-opacity", luminance(fillC) > 0.8 ? "0" : "0.08");
    }
    const sw = parseFloat(el.getAttribute("stroke-width") || "");
    if (sw > 0) {
      const k = target / sw;
      el.setAttribute("stroke-width", String(target));
      const dash = el.getAttribute("stroke-dasharray");
      if (dash && dash !== "none") el.setAttribute("stroke-dasharray", dash.split(/[\s,]+/).map((x) => String(parseFloat(x) * k)).join(" "));
    }
  };
  clean(root);
  for (const a of ["width", "height", "x", "y", "version"]) root.removeAttribute(a);
  root.setAttribute("viewBox", vb.join(" "));
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", label);
  root.setAttribute("focusable", "false");
  const svg = /** @type {SVGSVGElement} */ (document.importNode(root, true));
  svg.style.aspectRatio = `${vb[2]} / ${vb[3]}`;
  return svg;
}

// ---- mount -------------------------------------------------------------------------------

/**
 * Render an Explorer into element. Returns { destroy, select }.
 * @param {HTMLElement} element
 * @param {Explorer} data
 * @param {MountOptions} [options]
 */
export function mount(element, data, options = {}) {
  if (!element) throw new Error("mount: no element to render into");
  mounted.get(element)?.destroy();
  const uid = `ax${++seq}`;
  const ctrl = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ctrl.signal });
  const prevClass = element.getAttribute("class");
  element.classList.add("ax");
  if (options.compact) element.setAttribute("data-ax-compact", "");
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const destroy = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    for (const t of timers) clearTimeout(t);
    element.replaceChildren();
    if (prevClass == null) element.removeAttribute("class");
    else element.setAttribute("class", prevClass);
    element.removeAttribute("data-ax-compact");
    if (mounted.get(element)?.destroy === destroy) mounted.delete(element);
  };

  if (!data || !Array.isArray(data.lines)) {
    fill(element, h("p", { class: "ax-empty" }, "No run to show yet. After a run, type /anatomy-2 view <slug> in Claude Code."));
    const view = { destroy, select() {} };
    mounted.set(element, view);
    return view;
  }

  /** @type {Explorer} */
  const ex = typeof structuredClone === "function" ? structuredClone(data) : JSON.parse(JSON.stringify(data));
  for (const k of ["architecture", "assembly", "checks", "previews"]) if (!Array.isArray(ex[k])) ex[k] = [];
  ex.params ??= {};
  ex.shipping ??= {};
  ex.totals ??= { batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [] };
  ex.totals.unquoted ??= [];
  for (const l of ex.lines) {
    l.options ??= [];
    l.spec ??= {};
  }

  const units = Math.max(1, ex.units || 1);
  const H = `h${Math.min(6, Math.max(1, options.headingLevel ?? 2))}`;
  const H3 = `h${Math.min(6, Math.max(1, (options.headingLevel ?? 2) + 1))}`;
  // The quote's pick per bought line. -1 stays -1: that line isn't in quotes.json (it is older than the offers).
  const quoteChoice = ex.lines.map((l) => (l.chosen >= 0 && l.chosen < l.options.length ? l.chosen : -1));
  let choice = quoteChoice.slice();
  const quoted = breakdown(ex, quoteChoice);
  const stale = Math.abs(quoted.total - (ex.totals.batchUsd ?? quoted.total)) > 0.011
    || ex.lines.some((l, i) => !l.made && l.options.length && quoteChoice[i] < 0);
  let now = quoted;
  const bought = ex.lines.map((l, i) => [l, i]).filter(([l]) => !l.made && l.process === "buy");
  const made = ex.lines.map((l, i) => [l, i]).filter(([l]) => l.made || l.process !== "buy");
  const id = (s) => `${uid}-${s}`;
  const tabIds = TABS.map((t) => t.id);
  let current = tabIds.includes(options.initialTab ?? "") ? options.initialTab : "request";

  // ---- shell
  const tablist = h("div", { class: "ax-tabs", role: "tablist", "aria-label": "Stages of the run" },
    TABS.map((t) => h("button", {
      class: "ax-tab", type: "button", role: "tab", id: id(`tab-${t.id}`), "aria-controls": id(`panel-${t.id}`),
      "aria-selected": String(t.id === current), tabindex: t.id === current ? "0" : "-1", "data-tab": t.id,
    }, h("span", { class: "ax-tab-n" }, t.n), h("span", { class: "ax-tab-l" }, t.label))));
  const panels = Object.fromEntries(TABS.map((t, k) => {
    const next = TABS[k + 1];
    const body = h("div", { class: "ax-body" });
    const p = h("section", {
      class: "ax-panel", role: "tabpanel", id: id(`panel-${t.id}`), "aria-labelledby": id(`tab-${t.id}`), tabindex: "0",
      hidden: t.id !== current, "data-panel": t.id,
    },
    h("header", { class: "ax-head" },
      h("p", { class: "ax-kicker" }, ((s) => (s ? `Stage ${s.n}, ${s.label} · step ${t.n}` : `Step ${t.n}`))(STAGES.find((s) => s.id === t.stage))),
      h(H, { class: "ax-h" }, t.title),
      h("p", { class: "ax-lede" }, t.lede)),
    body,
    next ? h("footer", { class: "ax-foot" },
      h("button", { class: "ax-next", type: "button", "data-goto": next.id },
        h("span", { class: "ax-next-l" }, "Next"), h("span", { class: "ax-tab-n" }, next.n), next.label, icon("arrow"))) : null);
    return [t.id, { el: p, body }];
  }));
  const live = h("div", { class: "ax-sr", "aria-live": "polite", "aria-atomic": "true" });
  fill(element, tablist, Object.values(panels).map((p) => p.el), live);

  // ---- 0 request
  const glance = h("div", { class: "ax-glance" });
  add(panels.request.body,
    h("blockquote", { class: "ax-brief" }, h("p", null, ex.brief)),
    h("dl", { class: "ax-facts" },
      fact("Product", ex.product),
      fact("Units", numFmt.format(units)),
      fact("Ships to", ex.region),
      fact("Budget", ex.budgetUsd != null ? `${usd(ex.budgetUsd)} for the batch` : "None given")),
    h(H3, { class: "ax-h3" }, "What came back"),
    glance);

  function fact(label, value) {
    return h("div", { class: "ax-fact" }, h("dt", null, label), h("dd", null, value));
  }

  /** "5 shops, 4 charge shipping": every shop in the order, and how many of them add a shipping charge. */
  function shopWords(b) {
    const all = b.byShop.size;
    const charging = b.shipping.length;
    return { all: plural(all, "shop"), charging: charging === all ? (all === 1 ? "it charges shipping" : "all charge shipping") : `${charging} charge${charging === 1 ? "s" : ""} shipping` };
  }

  function renderGlance() {
    const checks = tally();
    const sw = shopWords(now);
    const card = (tab, label, value, sub) =>
      h("button", { class: "ax-card", type: "button", "data-goto": tab },
        h("span", { class: "ax-card-l" }, label), h("span", { class: "ax-card-v" }, value), h("span", { class: "ax-card-s" }, sub));
    fill(glance,
      card("bom", "Batch total", usd(now.total), units > 1 ? `${usd(now.total / units)} a unit` : budgetText(now.total, true)),
      card("bom", "Parts", plural(ex.lines.length, "line"), `${bought.length} bought, ${made.length} made`),
      card("suppliers", "Shops", sw.all, `${sw.charging}, ${usd(now.shipUsd)}`),
      card("checks", "Checks", `${checks.pass} of ${ex.checks.length} pass`,
        [checks.fail ? `${checks.fail} failed` : "", checks.flag ? `${checks.flag} ${checks.flag === 1 ? "needs" : "need"} a person` : ""].filter(Boolean).join(", ") || "Nothing to review"),
      card("plan", "Longest lead", plural(now.lead.days, "day"), now.lead.line ? `${now.lead.line.name}, ${now.lead.supplier}` : ""));
  }

  function budgetText(total, short) {
    if (ex.budgetUsd == null) return short ? "No budget given" : "";
    const d = round(total - ex.budgetUsd);
    if (d > 0) return `${usd(d)} over the ${usd(ex.budgetUsd)} budget`;
    return `${usd(-d)} under the ${usd(ex.budgetUsd)} budget`;
  }

  function tally() {
    const t = { pass: 0, fail: 0, flag: 0 };
    for (const c of ex.checks) t[c.status] = (t[c.status] ?? 0) + 1;
    return t;
  }

  // ---- 1 design
  {
    const b = panels.design.body;
    add(b, h("p", { class: "ax-summary" }, ex.summary));
    if (ex.architecture.length)
      add(b, h(H3, { class: "ax-h3" }, "How it works"),
        h("ul", { class: "ax-arch" }, ex.architecture.map((a) => h("li", null, arrows(a)))));
    if (ex.previews.length) {
      const madeByBase = new Map(ex.lines.filter((l) => l.file).map((l) => [fileBase(l.file), l]));
      const order = (p) => {
        const l = madeByBase.get(p.name);
        return l ? ex.lines.indexOf(l) : 999;
      };
      const figs = ex.previews.slice().sort((a, b2) => order(a) - order(b2)).map((p) => {
        const l = madeByBase.get(p.name);
        const title = l ? l.name : splitKey(p.name)[0];
        const svg = cadSvg(p.svg, `CAD drawing: ${title}`);
        return h("figure", { class: "ax-fig" },
          h("div", { class: "ax-fig-art" }, svg ?? h("span", { class: "ax-muted" }, "Preview unavailable")),
          h("figcaption", null, h("span", null, title), l?.file ? h("code", null, l.file) : null));
      });
      add(b, h(H3, { class: "ax-h3" }, "CAD"), h("div", { class: "ax-figs" }, figs),
        h("p", { class: "ax-note" }, "Drawn from the build123d code in ", h("code", null, `products/${ex.slug}/cad/`), ". Solid lines are visible edges, dotted lines are hidden ones."));
    }
    const params = Object.entries(ex.params).filter(([, v]) => v != null);
    if (params.length) {
      const LIMIT = 18;
      const list = h("dl", { class: "ax-params", id: id("params") }, params.map(([k, v], n) => {
        const [label, unit] = splitKey(k);
        return h("div", { class: "ax-param", hidden: n >= LIMIT && params.length > LIMIT + 3 },
          h("dt", { title: k }, label), h("dd", null, valueText(v, unit)));
      }));
      add(b, h(H3, { class: "ax-h3" }, "Design numbers"), list);
      if (params.length > LIMIT + 3)
        add(b, h("button", { class: "ax-more", type: "button", "data-more": "params", "aria-expanded": "false", "aria-controls": id("params") },
          `Show all ${params.length} numbers`));
    }
  }

  // ---- 2 BOM
  const rowRefs = new Map(); // line index -> { row, qty, shop, cost, mode, opts: Map<optIndex, {el, pick}> , detail, change }
  const groupRefs = [];
  const sumAside = h("aside", { class: "ax-sum", "aria-label": "Quote for the batch" });
  const sumBar = h("div", { class: "ax-sumbar" });
  {
    const table = h("table", { class: "ax-bom" },
      h("caption", { class: "ax-sr" }, `Bill of materials for ${units} ${units === 1 ? "unit" : "units"}. Open a line for its offers.`),
      h("thead", null, h("tr", null,
        h("th", { scope: "col", class: "ax-c-part" }, "Part"),
        h("th", { scope: "col", class: "ax-c-qty" }, "Qty"),
        h("th", { scope: "col", class: "ax-c-shop" }, "Shop"),
        h("th", { scope: "col", class: "ax-c-cost ax-num" }, "Cost"),
        h("th", { scope: "col", class: "ax-c-mode" }, "Priced"))));
    for (const [title, group] of [["Bought", bought], ["Made", made]]) {
      if (!group.length) continue;
      const sub = h("span", { class: "ax-group-sub" });
      const tb = h("tbody", { class: "ax-group" },
        h("tr", { class: "ax-group-head" }, h("th", { colspan: "5", scope: "rowgroup" }, h("span", null, title), sub)));
      groupRefs.push({ sub, group });
      for (const [l, i] of group) {
        const refs = lineRows(l, i);
        add(tb, refs.row, refs.detail);
        rowRefs.set(i, refs);
      }
      add(table, tb);
    }
    const latest = ex.lines.flatMap((l) => l.options.map((o) => o.capturedAt)).filter(Boolean).sort().pop();
    add(panels.bom.body, h("div", { class: "ax-bom-wrap" },
      h("div", { class: "ax-bom-main" }, table,
        h("p", { class: "ax-note" },
          latest ? `Offers were read from supplier pages up to ${latest}. ` : "",
          "Packs round the order up, and each shop's shipping is counted once. Nothing has been ordered.")),
      sumBar, sumAside));
  }

  function lineRows(l, i) {
    const detailId = id(`line-${i}`);
    const qty = h("td", { class: "ax-c-qty" });
    const shop = h("td", { class: "ax-c-shop" });
    const cost = h("td", { class: "ax-c-cost ax-num" });
    const mode = h("td", { class: "ax-c-mode" });
    const toggle = h("button", { class: "ax-toggle", type: "button", "aria-expanded": "false", "aria-controls": detailId, "data-line": i },
      icon("chev", "ax-chev"), h("span", { class: "ax-pname" }, l.name));
    const row = h("tr", { class: "ax-row", "data-line": i },
      h("td", { class: "ax-c-part" }, toggle, h("span", { class: "ax-pid" }, h("code", null, l.id), l.role && l.role !== l.id ? ` ${l.role}` : "")),
      qty, shop, cost, mode);
    const td = h("td", { colspan: "5" });
    const detail = h("tr", { class: "ax-detail", id: detailId, hidden: true }, td);
    const opts = new Map();
    const change = h("div", { class: "ax-linechange", hidden: true });

    const spec = Object.entries(l.spec).filter(([, v]) => v != null);
    const facts = h("dl", { class: "ax-spec" },
      spec.map(([k, v]) => {
        const [label, unit] = splitKey(k);
        return h("div", null, h("dt", null, label), h("dd", null, valueText(v, unit)));
      }),
      l.mpn ? h("div", null, h("dt", null, "MPN"), h("dd", null, h("code", null, l.mpn))) : null,
      h("div", null, h("dt", null, "Need"), h("dd", null, `${l.qtyPerUnit} per unit × ${plural(units, "unit")} = ${l.qtyPerUnit * units}`)));
    const inner = h("div", { class: "ax-detail-in" }, facts,
      l.notes ? h("p", { class: "ax-linenote" }, l.notes) : null);

    if (l.made) {
      const m = l.made;
      add(inner, h("dl", { class: "ax-made" },
        h("div", null, h("dt", null, "Made by"), h("dd", null, m.supplier)),
        h("div", null, h("dt", null, "Order"), h("dd", null, m.sku)),
        h("div", null, h("dt", null, "Quantity"), h("dd", null, numFmt.format(m.orderQty))),
        h("div", null, h("dt", null, "Cost"), h("dd", { class: "ax-num" }, usd(m.orderUsd))),
        h("div", null, h("dt", null, "Lead"), h("dd", null, plural(m.leadDays, "day"))),
        h("div", null, h("dt", null, "Shipping"), h("dd", null,
          l.shipsFree ? "Included in the price" : `${usd(ex.shipping[m.supplier] ?? 0)}, once for the order`)),
        h("div", { class: "ax-made-wide" }, h("dt", null, "Priced"), h("dd", null, modeTag(m.mode), " ", linkify(m.basis))),
        l.file ? h("div", { class: "ax-made-wide" }, h("dt", null, "File"), h("dd", null, h("code", null, `products/${ex.slug}/${l.file}`))) : null));
    } else if (l.options.length) {
      const name = id(`opt-${i}`);
      const multi = new Map();
      for (const o of l.options) multi.set(o.supplier, (multi.get(o.supplier) ?? 0) + 1);
      const group = h("div", { class: "ax-opts", role: "radiogroup", "aria-label": `Offers for ${l.name}` },
        h("div", { class: "ax-opt ax-opt-head", "aria-hidden": "true" },
          h("span", { class: "ax-o-r" }), h("span", { class: "ax-o-offer" }, "Offer"), h("span", { class: "ax-o-order" }, "Order"),
          h("span", { class: "ax-o-cost ax-num" }, "Cost"), h("span", { class: "ax-o-avail" }, "Stock and lead"),
          h("span", { class: "ax-o-mode" }, "Priced"), h("span", { class: "ax-o-pick ax-num" }, "If picked"), h("span", { class: "ax-o-link" })));
      // Every offer at the lowest price is "Cheapest", ties included; none is when they all cost the same.
      const low = Math.min(...l.options.map((o) => o.orderUsd));
      const someDearer = l.options.some((o) => o.orderUsd > low + 0.005);
      const cheapest = (o) => someDearer && o.orderUsd <= low + 0.005;
      l.options.forEach((o, j) => {
        const order = orderText(o);
        const input = h("input", {
          type: "radio", name, value: j, "data-line": i, checked: j === choice[i],
          "aria-label": `${o.supplier}, ${o.sku}: ${order.main}, ${usd(o.orderUsd)}, ${stockText(o.stock).toLowerCase()}, ${plural(o.leadDays, "day")}`,
        });
        const pick = h("span", { class: "ax-o-pick ax-num" });
        const tags = [
          j === quoteChoice[i] ? h("span", { class: "ax-badge", "data-kind": "quote" }, "In the quote") : null,
          cheapest(o) ? h("span", { class: "ax-badge" }, "Cheapest") : null,
          l.pin && l.pin.supplier === o.supplier && (!l.pin.sku || l.pin.sku === o.sku) ? h("span", { class: "ax-badge" }, "Pinned") : null,
        ];
        const el = h("label", { class: "ax-opt", "data-opt": j },
          h("span", { class: "ax-o-r" }, input),
          h("span", { class: "ax-o-offer" }, h("span", { class: "ax-o-shop" }, o.supplier), h("span", { class: "ax-o-sku" }, o.sku),
            tags.some(Boolean) ? h("span", { class: "ax-o-tags" }, tags) : null),
          h("span", { class: "ax-o-order ax-tnum" }, order.main, order.sub ? h("span", { class: "ax-sub" }, order.sub) : null),
          h("span", { class: "ax-o-cost ax-num" }, usd(o.orderUsd)),
          h("span", { class: "ax-o-avail" }, stockText(o.stock), h("span", { class: "ax-sub" }, `${plural(o.leadDays, "day")} lead`)),
          h("span", { class: "ax-o-mode" }, modeTag(o.source), h("span", { class: "ax-sub" }, o.capturedAt)),
          pick,
          h("span", { class: "ax-o-link" }, ((label) => link(o.url, label, label === "Shop" ? `${o.supplier} home page, opens in a new tab` : `${o.supplier} product page, opens in a new tab`))(pageLabel(o.url))));
        opts.set(j, { el, pick, input, multi: (multi.get(o.supplier) ?? 0) > 1 });
        add(group, el);
      });
      add(inner, group);
      const q = l.options[quoteChoice[i]];
      if (!q)
        add(inner, h("p", { class: "ax-note ax-warn" }, "Not in the quote: the quote is older than these offers. Pick one to see the total with it, and ask Claude to requote the run."));
      else if (q.orderUsd > low + 0.005 && !l.pin)
        add(inner, h("p", { class: "ax-note" }, "The cheapest offer isn't in the quote because its shop would add shipping the rest of the order doesn't need."));
      if (l.pin) add(inner, h("p", { class: "ax-note" }, `Pinned to ${l.pin.supplier}${l.pin.sku ? ` ${l.pin.sku}` : ""} with /anatomy-2 swap.`));
      add(inner, change);
    } else {
      add(inner, h("p", { class: "ax-note" }, "Not priced yet: no offers for this line."));
    }
    add(td, inner);
    return { row, toggle, detail, qty, shop, cost, mode, opts, change, line: l };
  }

  function renderRow(i) {
    const r = rowRefs.get(i);
    const l = r.line;
    const need = l.qtyPerUnit * units;
    const o = l.made ?? l.options[choice[i]];
    const packed = o && "packSize" in o && o.packSize > 1;
    fill(r.qty, numFmt.format(need), o && o.orderQty !== need ? h("span", { class: "ax-round" }, ` → ${numFmt.format(o.orderQty)}`) : null,
      packed ? h("span", { class: "ax-sub" }, `packs of ${o.packSize}`) : null,
      l.made && o && o.orderQty !== need ? h("span", { class: "ax-sub" }, "fab minimum") : null);
    fill(r.shop, o ? h("button", { class: "ax-textbtn ax-shopbtn", type: "button", "data-show-shop": o.supplier, "aria-label": `${o.supplier}: open its shop in Suppliers` }, o.supplier)
      : h("span", { class: "ax-muted" }, l.options.length ? "Not in the quote" : "Not priced"),
      l.made ? h("span", { class: "ax-sub" }, l.process === "pcb" ? "PCB fab" : l.process === "print" ? "3D print" : l.process)
        : l.options.length > 1 ? h("span", { class: "ax-sub" }, `${l.options.length} offers`) : l.options.length ? h("span", { class: "ax-sub" }, "1 offer") : null);
    fill(r.cost, o ? usd(o.orderUsd) : "–");
    fill(r.mode, o ? modeTag(l.made ? l.made.mode : /** @type {ExplorerOption} */ (o).source) : null);
    const changed = !l.made && choice[i] !== quoteChoice[i];
    r.row.toggleAttribute("data-changed", changed);
    for (const [j, x] of r.opts) {
      x.input.checked = j === choice[i];
      x.el.toggleAttribute("data-checked", j === choice[i]);
    }
    if (r.opts.size) {
      r.change.hidden = !changed;
      if (changed) {
        const qo = l.options[quoteChoice[i]];
        const cur = l.options[choice[i]];
        // The skill's own command: /anatomy-2 swap pins the line to that shop and requotes (reference/swap.md).
        const args = [ex.slug, l.id, cur.supplier, ...(r.opts.get(choice[i]).multi ? [cur.sku] : [])];
        const cmd = `/anatomy-2 swap ${args.map(shQuote).join(" ")}`;
        fill(r.change,
          h("p", null, qo ? `Changed from ${qo.supplier}. To keep this pick, type this in Claude Code:` : "To keep this pick, type this in Claude Code:"),
          h("div", { class: "ax-cmdrow" }, h("code", { class: "ax-cmd" }, cmd),
            h("button", { class: "ax-btn ax-btn-sm ax-copy", type: "button", "data-copy": cmd, "aria-label": `Copy ${cmd}` }, "Copy")),
          h("p", null, "Or ", h("button", { class: "ax-textbtn", type: "button", "data-reset-line": i }, qo ? `go back to ${qo.supplier}` : "clear the pick"), "."));
      }
    }
  }

  function renderPicks() {
    for (const [i, r] of rowRefs) {
      if (r.detail.hidden || !r.opts.size) continue;
      for (const [j, x] of r.opts) {
        if (j === choice[i]) {
          fill(x.pick, h("span", { class: "ax-muted" }, "Current"));
          continue;
        }
        const c = choice.slice();
        c[i] = j;
        const d = round(totalFor(ex, c) - now.total);
        fill(x.pick, h("span", { "data-sign": d > 0 ? "up" : d < 0 ? "down" : "zero" }, d === 0 ? "No change" : signed(d)));
      }
    }
  }

  function explain() {
    /** @type {[string, number][]} */
    const rows = [];
    for (const [s, c] of now.shipping) if (!quoted.shops.has(s)) rows.push([`${s} shipping`, c]);
    for (const [s, c] of quoted.shipping) if (!now.shops.has(s)) rows.push([`${s} drops out`, -c]);
    const dp = round(now.parts - quoted.parts);
    if (dp !== 0) rows.push(["Parts", dp]);
    const words = [
      ...now.shipping.filter(([s]) => !quoted.shops.has(s)).map(([s, c]) => `${s} adds ${usd(c)} shipping`),
      ...quoted.shipping.filter(([s]) => !now.shops.has(s)).map(([s, c]) => `${s} drops out, saving ${usd(c)} shipping`),
      ...(dp ? [`parts cost ${usd(Math.abs(dp))} ${dp > 0 ? "more" : "less"}`] : []),
    ];
    return { rows, words };
  }

  function renderSummary() {
    const d = round(now.total - quoted.total);
    const changedLines = ex.lines.filter((l, i) => !l.made && choice[i] !== quoteChoice[i]).length;
    const status = ex.budgetUsd == null ? "none" : now.total > ex.budgetUsd ? "over" : "under";
    const { rows, words } = explain();
    // The heading counts the shops that charge shipping, so it matches the rows under it; a shop whose
    // price already includes shipping (a PCB fab) gets its own line below.
    const shipList = h("ul", { class: "ax-sum-ship" }, now.shipping.map(([s, c]) => h("li", null, h("span", null, s), h("span", { class: "ax-num" }, usd(c)))));
    const free = [...now.byShop].filter(([, e]) => e.shipsFree).map(([s]) => s);
    const freeNote = free.length ? h("p", { class: "ax-sum-free" }, `${free.join(", ")}: shipping is in the price.`) : null;
    fill(sumAside,
      h("div", { class: "ax-sum-top" },
        h("div", { class: "ax-sum-label" }, h("span", { class: "ax-tab-n" }, "5"), changedLines ? "Batch total with your picks" : "Batch total"),
        h("div", { class: "ax-sum-total ax-num", tabindex: "-1", "data-total": now.total }, usd(now.total)),
        h("div", { class: "ax-sum-unit" }, units > 1 ? `${usd(now.total / units)} a unit, ${units} units` : "1 unit"),
        ex.budgetUsd != null ? h("div", { class: "ax-sum-budget", "data-state": status }, h("span", { class: "ax-dot" }), budgetText(now.total)) : null),
      changedLines ? h("div", { class: "ax-delta" },
        h("div", { class: "ax-delta-head" }, h("strong", { class: "ax-num", "data-delta": d }, `${signed(d)} vs the quote`),
          h("span", { class: "ax-muted" }, `Quote ${usd(quoted.total)}, ${plural(changedLines, "line")} changed`)),
        rows.length ? h("dl", { class: "ax-delta-rows" }, rows.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", { class: "ax-num" }, signed(v))))) : null,
        h("button", { class: "ax-btn", type: "button", "data-reset": "" }, icon("reset"), "Reset to the quote")) : null,
      h("dl", { class: "ax-sum-rows" },
        h("div", null, h("dt", null, "Parts and fab"), h("dd", { class: "ax-num" }, usd(now.parts))),
        h("div", null, h("dt", null, `Shipping, ${plural(now.shipping.length, "shop")}`), h("dd", { class: "ax-num" }, usd(now.shipUsd)))),
      shipList,
      freeNote,
      h("dl", { class: "ax-sum-rows ax-sum-foot" },
        h("div", null, h("dt", null, "Longest lead"), h("dd", null, plural(now.lead.days, "day"))),
        ex.totals.unquoted.length ? h("div", null, h("dt", null, "Not priced"), h("dd", null, ex.totals.unquoted.join(", "))) : null),
      stale ? h("p", { class: "ax-note ax-warn" }, `The quote is out of date: quotes.json says ${usd(ex.totals.batchUsd)}, and its picks add up to ${usd(quoted.total)} here. Ask Claude to requote the run.`) : null);
    fill(sumBar,
      h("div", { class: "ax-sumbar-t" }, h("span", { class: "ax-muted" }, "Batch "), h("strong", { class: "ax-num ax-sumbar-total", tabindex: "-1" }, usd(now.total)),
        changedLines ? h("span", { class: "ax-sumbar-d ax-num", "data-delta": d }, ` ${signed(d)} vs the quote`) : h("span", { class: "ax-muted" }, ex.budgetUsd != null ? `, ${status} budget` : "")),
      changedLines ? h("button", { class: "ax-btn ax-btn-sm", type: "button", "data-reset": "" }, "Reset") : null);
    return { d, words, changedLines };
  }

  function renderGroups() {
    for (const { sub, group } of groupRefs) {
      const t = round(group.reduce((s, [l, i]) => s + (l.made ? l.made.orderUsd : l.options[choice[i]]?.orderUsd ?? 0), 0));
      fill(sub, `${plural(group.length, "line")}, ${usd(t)}`);
    }
  }

  // ---- 3 checks
  {
    const t = tally();
    const rank = { fail: 0, flag: 1, pass: 2 };
    const sorted = ex.checks.map((c, k) => [c, k]).sort((a, b) => (rank[a[0].status] ?? 3) - (rank[b[0].status] ?? 3) || a[1] - b[1]).map(([c]) => c);
    const label = { pass: "Pass", fail: "Fails", flag: "Needs a person" };
    const glyph = { pass: "check", fail: "cross", flag: "flag" };
    add(panels.checks.body,
      h("p", { class: "ax-tally" },
        h("span", { "data-status": "pass", "data-zero": !t.pass }, icon("check"), `${t.pass} pass`),
        h("span", { "data-status": "fail", "data-zero": !t.fail }, icon("cross"), `${t.fail} fail`),
        h("span", { "data-status": "flag", "data-zero": !t.flag }, icon("flag"), `${t.flag} ${t.flag === 1 ? "needs" : "need"} a person`)),
      h("ul", { class: "ax-checks" }, sorted.map((c) =>
        h("li", { class: "ax-check", "data-status": c.status },
          h("span", { class: "ax-check-i" }, icon(glyph[c.status] ?? "flag")),
          h("div", { class: "ax-check-t" }, h("span", { class: "ax-check-title" }, c.title), h("span", { class: "ax-check-d" }, c.detail)),
          h("span", { class: "ax-check-s" }, label[c.status] ?? c.status)))));
    const s = ex.score;
    if (s && s.cost && s.coverage) {
      const files = Array.isArray(s.files) ? s.files : [];
      add(panels.checks.body,
        h(H3, { class: "ax-h3" }, "Against a known-good build"),
        h("p", { class: "ax-note" }, `The run is scored against a working ${ex.product} built from parts: it passes when every number below is in range.`),
        h("dl", { class: "ax-score" },
          h("div", null, h("dt", null, "Parts covered"), h("dd", null, `${s.coverage.pct}%`), h("span", { class: "ax-sub" },
            s.coverage.missing?.length ? `Missing: ${s.coverage.missing.join(", ")}` : "Every part the reference has")),
          h("div", null, h("dt", null, "Cost"), h("dd", null, `${s.cost.deltaPct > 0 ? "+" : ""}${numFmt.format(s.cost.deltaPct)}%`), h("span", { class: "ax-sub" },
            `${usd(s.cost.batchUsd)} vs ${usd(s.cost.referenceMidUsd)}, ${s.cost.withinBand ? "within" : "outside"} the ±25% band`)),
          h("div", null, h("dt", null, "Failed checks"), h("dd", null, String(s.checks?.failed ?? 0)), h("span", { class: "ax-sub" }, `${s.checks?.flagged ?? 0} flagged for a person`)),
          h("div", null, h("dt", null, "Files"), h("dd", null, `${files.filter((f) => f.ok).length} of ${files.length}`), h("span", { class: "ax-sub" },
            files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.detail}`).join("; ") || "All ready"))),
        h("p", { class: "ax-verdict", "data-pass": String(!!s.pass) }, s.pass ? "Passes against the reference." : "Not passing yet."));
    }
  }

  // ---- 4-5 suppliers
  const supBody = h("div", { class: "ax-shops" });
  add(panels.suppliers.body, supBody);
  const shopEls = new Map(); // shop name -> its card, or its row under "Other shops"

  function renderSuppliers() {
    const shops = [...now.byShop].map(([s, e]) => {
      const sub = round(e.rows.reduce((t, r) => t + r.usd, 0));
      const ship = now.shops.has(s) ? ex.shipping[s] ?? 0 : 0;
      return { s, e, sub, ship, total: round(sub + ship) };
    }).sort((a, b) => b.total - a.total);
    const shopLink = (e) => {
      const url = e.rows.map((r) => r.opt?.url ?? (r.line.made?.basis.match(/https?:\/\/[^\s,)]+/) ?? [])[0]).find((u) => safeUrl(u));
      if (!url) return null;
      const u = new URL(url);
      return link(`${u.protocol}//${u.host}`, u.host.replace(/^www\./, ""), `${u.host}, opens in a new tab`);
    };
    const others = new Map();
    ex.lines.forEach((l, i) => l.options.forEach((o, j) => {
      if (now.byShop.has(o.supplier)) return;
      const arr = others.get(o.supplier) ?? [];
      arr.push({ l, i, o, j });
      others.set(o.supplier, arr);
    }));
    shopEls.clear();
    const sw = shopWords(now);
    // Every shop card is one table with the same fixed columns, so line costs and totals line up from card to card.
    const cols = () => h("colgroup", null, h("col", { class: "ax-col-name" }), h("col", { class: "ax-col-qty" }),
      h("col", { class: "ax-col-cost" }), h("col", { class: "ax-col-link" }));
    const sumRow = (label, value, cls) => h("tr", { class: cls }, h("th", { scope: "row", colspan: "2" }, label),
      h("td", { class: "ax-num" }, value), h("td", null));
    fill(supBody,
      h("ul", { class: "ax-shoplist" }, shops.map(({ s, e, sub, ship, total }) => {
        const card = h("li", { class: "ax-shop", id: id(`shop-${shops.findIndex((x) => x.s === s)}`) },
          h("div", { class: "ax-shop-head" },
            h(H3, { class: "ax-shop-name", tabindex: "-1" }, s),
            h("span", { class: "ax-sub" }, h("span", null, `${plural(e.rows.length, "line")}${e.made ? ", made to order" : ""}`), shopLink(e))),
          h("table", { class: "ax-shop-t" },
            h("caption", { class: "ax-sr" }, `What ${s} supplies for this order`),
            cols(),
            h("thead", null, h("tr", null,
              h("th", { scope: "col" }, "Line"), h("th", { scope: "col", class: "ax-num" }, "Qty"),
              h("th", { scope: "col", class: "ax-num" }, "Cost"), h("th", { scope: "col" }, h("span", { class: "ax-sr" }, "Link")))),
            h("tbody", null, e.rows.map((r) => h("tr", null,
              h("td", { class: "ax-sl-name" }, r.line.name, h("span", { class: "ax-sub" }, r.opt ? r.opt.sku : r.line.made?.sku)),
              h("td", { class: "ax-num" }, numFmt.format(r.opt ? r.opt.orderQty : r.line.made?.orderQty ?? 0)),
              h("td", { class: "ax-num" }, usd(r.usd)),
              h("td", { class: "ax-sl-link" }, r.opt
                ? ((label) => link(r.opt.url, label, `${s} ${label === "Shop" ? "home" : "product"} page for ${r.line.name}, opens in a new tab`))(pageLabel(r.opt.url))
                : h("button", { class: "ax-textbtn", type: "button", "data-show-line": r.i }, "Details"))))),
            h("tfoot", null,
              sumRow("Parts", usd(sub)),
              sumRow("Shipping", e.shipsFree ? "In the price" : usd(ship)),
              sumRow("Shop total", usd(total), "ax-shop-total"))));
        shopEls.set(s, card);
        return card;
      })),
      h("dl", { class: "ax-shops-total" },
        h("div", null, h("dt", null, `${sw.all}, ${sw.charging}`), h("dd", { class: "ax-num" }, `${usd(now.parts)} + ${usd(now.shipUsd)}`)),
        h("div", null, h("dt", null, "Batch total"), h("dd", { class: "ax-num" }, usd(now.total)))),
      others.size ? h("div", { class: "ax-others" },
        h(H3, { class: "ax-h3" }, "Other shops with offers"),
        h("p", { class: "ax-note" }, "Not in the order right now. Pick one of their offers in the BOM to see what it does to the total."),
        h("ul", { class: "ax-otherlist" }, [...others].map(([s, arr]) => {
          const row = h("li", null,
            h("span", { class: "ax-o-shop" }, s),
            h("span", { class: "ax-sub" }, `${usd(ex.shipping[s] ?? 0)} shipping`),
            h("ul", null, arr.map(({ l, i, o }) => h("li", null,
              h("span", null, l.name), h("span", { class: "ax-num" }, usd(o.orderUsd)),
              h("button", { class: "ax-textbtn", type: "button", "data-show-line": i }, "Compare")))));
          shopEls.set(s, row);
          return row;
        }))) : null);
  }

  /** From a shop name in the BOM to that shop's card in Suppliers. */
  function showShop(name) {
    select("suppliers");
    const el = shopEls.get(name);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.setAttribute("data-flash", "");
    later(() => el.removeAttribute("data-flash"), 1800);
    /** @type {HTMLElement | null} */ (el.querySelector(".ax-shop-name") ?? el).focus?.({ preventScroll: true });
  }

  // ---- 6 plan
  const leadEl = h("div", { class: "ax-lead" });
  {
    const files = ex.lines.filter((l) => l.file && (l.made || l.process !== "buy"));
    const fileState = new Map((Array.isArray(ex.score?.files) ? ex.score.files : []).map((f) => [f.name, f]));
    const missing = [...fileState.values()].filter((f) => !f.ok).map((f) => String(f.name));
    // A step that names a file (or the folder of a file) that isn't generated yet can't be done yet.
    const blockedBy = (step) => missing.filter((f) => step.includes(f) || (f.includes("/") && step.includes(f.slice(0, f.indexOf("/") + 1))));
    const steps = ex.assembly.map((s) => {
      const by = blockedBy(s);
      return h("li", { "data-blocked": by.length ? "" : null }, h("span", null, s,
        by.length ? h("span", { class: "ax-sub ax-file-missing" }, `Blocked: ${by.join(", ")} ${by.length === 1 ? "is" : "are"} not generated yet.`) : null));
    });
    const plan = ex.buildPlanMd
      ? h("button", { class: "ax-btn ax-btn-sm", type: "button", "data-download": "build-plan.md" }, "Download build-plan.md")
      : null;
    add(panels.plan.body, h("div", { class: "ax-plan" },
      h("div", null,
        missing.length ? h("p", { class: "ax-note ax-warn ax-plan-warn" }, `Not ready to order everything yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not generated.`) : null,
        ex.assembly.length ? h("ol", { class: "ax-steps" }, steps) : h("p", { class: "ax-note" }, "No assembly steps in this run yet.")),
      h("aside", { class: "ax-plan-side" }, leadEl,
        files.length ? h("div", { class: "ax-files" },
          h(H3, { class: "ax-h3" }, "Files for the fabs"),
          h("ul", null, files.map((l) => {
            const st = fileState.get(l.file);
            return h("li", { "data-missing": st && !st.ok ? "" : null }, h("code", null, l.file),
              h("span", { class: "ax-sub" }, `${l.name}${l.made ? `, ${l.made.supplier}` : ""}`),
              st && !st.ok ? h("span", { class: "ax-sub ax-file-missing" }, st.detail.charAt(0).toUpperCase() + st.detail.slice(1)) : null);
          }))) : null,
        h("div", { class: "ax-plan-file" },
          options.compact
            ? h("p", { class: "ax-note" }, "The full plan has the order list and the checks too.")
            : h("p", { class: "ax-note" }, "The full plan, with the order list and the checks, is in ", h("code", null, `products/${ex.slug}/build-plan.md`), "."),
          plan))));
  }

  function renderLead() {
    const q = quoted.lead.days;
    fill(leadEl,
      h("div", { class: "ax-sum-label" }, "Longest lead"),
      h("div", { class: "ax-lead-v ax-num" }, plural(now.lead.days, "day")),
      h("p", { class: "ax-sub" }, now.lead.line ? `Set by ${now.lead.line.name} from ${now.lead.supplier}. If the listed lead times hold, ordering everything on day one gets it all by then.` : ""),
      now.lead.days !== q ? h("p", { class: "ax-sub" }, `The quote's picks take ${plural(q, "day")}.`) : null);
  }

  // ---- state
  function update(announce) {
    now = breakdown(ex, choice);
    for (const i of rowRefs.keys()) renderRow(i);
    renderPicks();
    renderGroups();
    const s = renderSummary();
    renderGlance();
    renderSuppliers();
    renderLead();
    if (announce) {
      live.textContent = s.changedLines
        ? `Batch total ${usd(now.total)}, ${signed(s.d)} vs the quote${s.words.length ? `: ${s.words.join(", ")}` : ""}.`
        : `Batch total ${usd(now.total)}, back to the quote.`;
    }
  }

  function select(tab, focus) {
    if (!tabIds.includes(tab)) return;
    current = tab;
    for (const b of tablist.querySelectorAll("[role=tab]")) {
      const sel = b.getAttribute("data-tab") === tab;
      b.setAttribute("aria-selected", String(sel));
      b.setAttribute("tabindex", sel ? "0" : "-1");
      if (sel && focus === "tab") /** @type {HTMLElement} */ (b).focus();
    }
    for (const [k, p] of Object.entries(panels)) p.el.hidden = k !== tab;
    if (focus === "panel") {
      if (tablist.getBoundingClientRect().top < 0) tablist.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      panels[tab].el.focus({ preventScroll: true });
    }
  }

  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setOpen(i, open) {
    const r = rowRefs.get(i);
    if (!r) return;
    r.detail.hidden = !open;
    r.toggle.setAttribute("aria-expanded", String(open));
    r.row.toggleAttribute("data-open", open);
    if (open) renderPicks();
  }

  function showLine(i) {
    select("bom");
    setOpen(i, true);
    const r = rowRefs.get(i);
    r.row.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    r.toggle.focus({ preventScroll: true });
  }

  on(tablist, "keydown", (e) => {
    const k = TABS.findIndex((t) => t.id === current);
    const next = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    select(TABS[(next + TABS.length) % TABS.length].id, "tab");
  });

  on(element, "click", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!(t instanceof Element)) return;
    const hit = (sel) => /** @type {HTMLElement | null} */ (t.closest(sel));
    let x;
    if ((x = hit("[role=tab]"))) return select(x.getAttribute("data-tab"));
    if ((x = hit("[data-goto]"))) return select(x.getAttribute("data-goto"), "panel");
    if ((x = hit("[data-reset]"))) {
      // Keep focus where the person is: the sticky bar's total on narrow layouts, the summary card's when it is the sticky one.
      const fromBar = !!x.closest(".ax-sumbar") && getComputedStyle(sumBar).display !== "none";
      choice = quoteChoice.slice();
      update(true);
      /** @type {HTMLElement | null} */ ((fromBar ? sumBar : sumAside).querySelector(fromBar ? ".ax-sumbar-total" : ".ax-sum-total"))?.focus({ preventScroll: true });
      return;
    }
    if ((x = hit("[data-reset-line]"))) {
      const i = Number(x.getAttribute("data-reset-line"));
      choice[i] = quoteChoice[i];
      update(true);
      const r = rowRefs.get(i);
      (r?.opts.get(choice[i]) ?? r?.opts.get(0))?.input.focus();
      return;
    }
    if ((x = hit("[data-copy]"))) {
      const btn = x;
      copyText(btn.getAttribute("data-copy") ?? "").then(
        () => { btn.textContent = "Copied"; },
        () => { btn.textContent = "Select and copy"; });
      later(() => { btn.textContent = "Copy"; }, 1800);
      return;
    }
    if ((x = hit("[data-download]")) && ex.buildPlanMd) {
      const url = URL.createObjectURL(new Blob([ex.buildPlanMd], { type: "text/markdown;charset=utf-8" }));
      const a = h("a", { href: url, download: `${ex.slug}-${x.getAttribute("data-download")}` });
      document.body.append(a);
      a.click();
      a.remove();
      later(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if ((x = hit("[data-show-shop]"))) return showShop(x.getAttribute("data-show-shop"));
    if ((x = hit("[data-show-line]"))) return showLine(Number(x.getAttribute("data-show-line")));
    if ((x = hit("[data-more]"))) {
      const list = element.querySelector(`#${id("params")}`);
      const open = x.getAttribute("aria-expanded") !== "true";
      list?.querySelectorAll(".ax-param").forEach((p, n) => { /** @type {HTMLElement} */ (p).hidden = !open && n >= 18; });
      x.setAttribute("aria-expanded", String(open));
      x.textContent = open ? "Show fewer" : `Show all ${list?.querySelectorAll(".ax-param").length ?? ""} numbers`;
      return;
    }
    if (hit("a, input, label, .ax-detail")) return;
    if ((x = hit(".ax-toggle, .ax-row"))) {
      const i = Number(x.getAttribute("data-line"));
      setOpen(i, rowRefs.get(i).detail.hidden);
    }
  });

  on(element, "change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "radio" || !t.hasAttribute("data-line")) return;
    const i = Number(t.getAttribute("data-line"));
    choice[i] = Number(t.value);
    update(true);
    clearBar(rowRefs.get(i)?.change);
  });

  /** On narrow layouts the sticky total bar sits over the bottom of the screen: keep the note
   * about the pick that just changed above it. */
  function clearBar(el) {
    if (!el || el.hidden || getComputedStyle(sumBar).display === "none") return;
    const bar = sumBar.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > bar.top - 8 && r.top < bar.top) window.scrollBy({ top: r.bottom - bar.top + 16, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  update(false);
  const view = { destroy, select: (tab) => select(tab) };
  mounted.set(element, view);
  return view;
}
