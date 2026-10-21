// Sprue explorer. Renders a run's explorer.json (the Explorer type in pipeline/explore.ts) by the
// run's four stages, Design, Inspect, Source and Build, with a live BOM: pick another offer for a line and the batch is
// requoted the way `sprue pick` does it (requote() in explore.ts): that line pinned to the offer, every other
// line free to move to the cheapest mix of shops, and the total summed as totalFor() there sums it. Two layouts:
//   tabs (the default)  one tab per stage; the website embeds this one
//   stages              the four stages one after another, for the product page (view.html) the CLI writes,
//                       where the figure sits above them
// It talks to a figure on the same page (viewer/figure.js) with events that bubble to document; each side
// ignores the events it sent itself:
//   a2:select { line }  a line is chosen: opening a BOM row or clicking a part in the parts list sends it,
//                       a click on a part in the figure lights that line's rows here
//   a2:hover  { line }  a line is pointed at (null when the pointer leaves), both ways
//   a2:step   { n }     an assembly step of the figure: choosing one under Build sends it, and the figure's
//                       own steps mark the one it shows
// Plain modern JS, no dependencies, no network.

/**
 * @typedef {{ supplier: string, sku: string, mpn?: string, url: string, packSize?: number, unitUsd: number,
 *   orderQty: number, orderUsd: number, stock: number | string, leadDays: number, source: string,
 *   capturedAt: string }} ExplorerOption
 * @typedef {{ supplier: string, sku: string, orderQty: number, orderUsd: number, leadDays: number, mode: string,
 *   basis: string }} ExplorerMade
 * @typedef {{ id: string, name: string, shortName?: string, role: string, process: string, qtyPerUnit: number,
 *   needQty?: number, spares?: number, qtyPerBatch?: number,
 *   spec: Record<string, string | number | undefined>, mpn?: string, notes?: string, file?: string,
 *   pin?: { supplier: string, sku?: string }, options: ExplorerOption[], chosen: number, made?: ExplorerMade,
 *   shipsFree?: boolean, sourceNote?: string }} ExplorerLine
 * @typedef {{ id: string, title: string, status: string, detail: string, lines?: string[], scope?: string }} ExplorerCheck
 * @typedef {{ id: string, title: string, status: string, detail: string, problems: number, list?: string[], flags?: string[],
 *   notes?: string[] }} ExplorerSystemGate
 * @typedef {{ pose: string, massG: number, com: number[], tiltDeg: number, estimatedG: number,
 *   pushes: { name: string, tipN: number | null, needN: number }[] }} ExplorerPose
 * @typedef {{ verdict: { ok: boolean, detail: string, failed: string[] },
 *   system: "current" | "stale" | "unwritten" | "missing" | "unreadable" | "none", run?: string,
 *   report?: { generatedAt: string, parts: number, envelopes: number, gates: ExplorerSystemGate[], stability: ExplorerPose[],
 *     probes: ({ id: string, kind: string } & Record<string, any>)[],
 *     selfTest: { ok: boolean, faults: { gate: string, fault: string, caught: boolean, detail: string }[], untested: string[] } },
 *   faults?: { ok: boolean, detail: string, ran: number, caught: number, falseAlarms: number }, unscoped?: string[] }} ExplorerInspect
 * @typedef {{ status: string, at?: string, note?: string }} ExplorerGate
 * @typedef {{ slug: string, product: string, brief: string, units: number, region: string, budgetUsd?: number,
 *   summary: string, architecture: string[], params: Record<string, number | string | undefined>, assembly: string[],
 *   lines: ExplorerLine[], shipping: Record<string, number>, shippingRead?: string[], shipsWith?: Record<string, string>, quoted?: boolean,
 *   totals: { batchUsd: number, perUnitUsd: number, longestLeadDays: number, unquoted: string[] },
 *   phases?: { name: string, units: number, batchUsd: number, longestLeadDays: number, file: string }[],
 *   costNotes?: string[], estimates?: string[], checks: ExplorerCheck[], inspect?: ExplorerInspect, score?: any,
 *   previews: { name: string, svg: string }[], designMd?: string, buildPlanMd?: string,
 *   figure?: { caption?: string, steps: { n: number, text: string, lines: string[], counts?: Record<string, number> }[], hidden?: Record<string, string>,
 *     coverage?: Record<string, { drawn: number, needed: number }> },
 *   state?: { stage?: string, stages: Record<string, ExplorerGate | undefined> }, production?: string[],
 *   generatedAt: string }} Explorer
 *   (production: the files in production/, which the product page adds; explorer.json never has it)
 * @typedef {{ initialTab?: string, compact?: boolean, headingLevel?: number, layout?: "tabs" | "stages" }} MountOptions
 */

const SVGNS = "http://www.w3.org/2000/svg";
let seq = 0;
/** One explorer per element: mounting again destroys the one already there. */
const mounted = new WeakMap();

/** The four gated stages of a run. Each is one tab, or one section in the stages layout. */
export const STAGES = [
  { id: "design", n: "1", label: "Design" },
  { id: "inspect", n: "2", label: "Inspect" },
  { id: "source", n: "3", label: "Source" },
  { id: "build", n: "4", label: "Build" },
];

/** One tab per stage. */
export const TABS = [
  { id: "design", n: "1", stage: "design", label: "Design", title: "Design", lede: "What was asked for, the numbers the design is built from, the checks of each part and the CAD." },
  { id: "inspect", n: "2", stage: "inspect", label: "Inspect", title: "Inspect", lede: "The parts together: do they fit, keep their gaps, stand up and do their job." },
  { id: "source", n: "3", stage: "source", label: "Source", title: "Source", lede: "Every part with every offer read from supplier pages, and the quote. Open a bought line to see its offers and pick another." },
  { id: "build", n: "4", stage: "build", label: "Build", title: "Build", lede: "How to put it together once the parts arrive, what to put in each cart, and the files for the fabs." },
];

/** The older tab names, still taken by initialTab and select(): each is now a part of one stage. */
const PART_OF = { request: "design", checks: "design", bom: "source", suppliers: "source", plan: "build" };

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

/** Pieces of a line the batch needs: explorer.json's needQty (spares and batch-level items included), or per unit × units. */
const needOf = (l, units) => l.needQty ?? l.qtyPerUnit * units;

/** "4 per unit × 20 units + 2 spares = 82", or "1 for the batch = 1". */
function needText(l, units) {
  const per = l.qtyPerBatch != null ? `${numFmt.format(l.qtyPerBatch)} for the batch` : `${l.qtyPerUnit} per unit × ${plural(units, "unit")}`;
  return `${per}${l.spares ? ` + ${plural(l.spares, "spare")}` : ""} = ${numFmt.format(needOf(l, units))}`;
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
    // A shop whose parts ride in a fab's parcel (catalog.json shipsWith) charges no shipping of its own.
    if (ex.shipsWith?.[s]) continue;
    const c = ex.shipping[s] ?? 0;
    sum += c;
    shipping.push([s, c]);
  }
  return { total: round(sum), parts: round(parts), shipUsd: round(shipping.reduce((t, [, c]) => t + c, 0)), shipping, shops, byShop, lead };
}

/**
 * What `sprue pick` quotes with some bought lines pinned (line index -> option index): every other bought line takes
 * the cheapest mix of shops, parts plus one shipping charge per shop, the same search as choose() in quote.ts and
 * requote() in explore.ts, over the same offers in the same order (cheapest first). Returns the option per line (-1
 * for made and unpriced lines) and the batch total.
 * @param {Explorer} ex @param {Map<number, number>} pins
 */
export function requote(ex, pins) {
  const bought = [];
  ex.lines.forEach((l, i) => { if (!l.made && l.options.length) bought.push(i); });
  const shops = [];
  const index = new Map();
  const perLine = bought.map((i) => {
    const l = ex.lines[i];
    const opts = (pins.has(i) ? [pins.get(i)] : l.options.map((_, j) => j)).filter((j) => l.options[j]);
    return opts.map((j) => {
      const s = l.options[j].supplier;
      if (!index.has(s)) { index.set(s, shops.length); shops.push(s); }
      return { j, shop: index.get(s), usd: l.options[j].orderUsd };
    });
  });
  // Within a set of shops, each line takes its cheapest offer from them: the first allowed one, as each list is
  // cheapest first and a stable sort keeps ties in order, as quote.ts's sort does.
  const ship = shops.map((s) => ex.shipping[s] ?? 0);
  const evaluate = (allowed) => {
    const pick = [];
    let usd = 0;
    const used = new Set();
    for (const opts of perLine) {
      const o = opts.find((x) => allowed(x.shop));
      if (!o) return null;
      pick.push(o.j);
      usd += o.usd;
      used.add(o.shop);
    }
    for (const k of used) usd += ship[k];
    return { pick, usd };
  };
  let best = null;
  if (shops.length > 20) {
    let allowed = new Set(shops.map((_, k) => k));
    best = evaluate((k) => allowed.has(k));
    for (let improved = true; improved && best; ) {
      improved = false;
      for (const k of [...allowed]) {
        const trial = new Set([...allowed].filter((x) => x !== k));
        const r = evaluate((x) => trial.has(x));
        if (r && r.usd < best.usd - 1e-9) { best = r; allowed = trial; improved = true; }
      }
    }
  } else {
    for (let mask = 1; mask < 1 << shops.length; mask++) {
      const r = evaluate((k) => (mask & (1 << k)) !== 0);
      if (r && (!best || r.usd < best.usd - 1e-9)) best = r;
    }
  }
  const choice = ex.lines.map(() => -1);
  if (best) bought.forEach((i, k) => { choice[i] = best.pick[k]; });
  return { choice, total: totalFor(ex, choice) };
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
/** The first letter in capitals: "on the desk" -> "On the desk". */
const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
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
  dash: "M4 8h8",
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

/** Text with `code` in backticks, as the run's files write commands and paths: the code as <code>. */
function ticks(text) {
  const parts = String(text ?? "").split("`");
  if (parts.length < 3) return String(text ?? "");
  return parts.map((t, i) => (i % 2 && i < parts.length - 1 ? h("code", null, t) : i % 2 ? "`" + t : t));
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

// ---- the whole product (Inspect) ---------------------------------------------------------

/** A check's scope: "part" (Design's gate) or "assembly" (Inspect's). One from an older checks.json has none: part. */
export const scopeOf = (c) => (c.scope === "assembly" ? "assembly" : "part");

const pctFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
/** 0.304 -> "30.4%" */
const pct = (x) => (typeof x === "number" && isFinite(x) ? `${pctFmt.format(x * 100)}%` : "–");
const listOf = (x) => (Array.isArray(x) ? x : []);

/** Inspect's one line, from system.json's own numbers: the gates, the self-test and the share of envelopes. Passes
 * only while systemAudit says so: system.json of the files there are now, every gate passed and every planted fault
 * caught. @param {ExplorerInspect | undefined} ins */
export function inspectVerdict(ins) {
  if (!ins) return { state: "open", text: "Not inspected: this run's data is from before Sprue checked the whole product." };
  if (ins.system === "none") return { state: "pass", text: "Nothing is made, so nothing is assembled: there is no whole product to check." };
  const r = ins.report;
  if (!r) return { state: "open", text: ins.system === "unwritten" ? "Whole product not checked yet: nothing checks the parts as one product." : "Whole product not checked yet." };
  const gates = listOf(r.gates);
  const passed = gates.filter((g) => g.status === "pass").length;
  const problems = gates.reduce((n, g) => n + (g.status === "pass" ? 0 : Number(g.problems) || 0), 0);
  const planted = listOf(r.selfTest?.faults);
  const untested = listOf(r.selfTest?.untested);
  const numbers = [
    `${passed} of ${plural(gates.length, "gate")} pass${problems ? ` (${plural(problems, "problem")})` : ""}`,
    `self-test ${planted.filter((f) => f.caught).length} of ${plural(planted.length, "fault")} caught${untested.length ? `, none planted for ${untested.join(", ")}` : ""}`,
    `${r.envelopes} of ${r.parts} parts are envelopes`,
  ].join("; ");
  if (ins.system !== "current") return { state: "open", text: `Whole product not checked on this design. Its last check, of an earlier design: ${numbers}.` };
  return { state: ins.verdict?.ok ? "pass" : "fail", text: `Whole product ${ins.verdict?.ok ? "passes" : "fails"}: ${numbers}.` };
}

/** faults.json in a word, as the score and Inspect both name it: "Stale", "Unreadable", "Unchecked", or "Not run" (none
 * yet, or no case ran) while it measured nothing of the product and gates as they are, else the faults it caught. */
export function faultsWord(f) {
  const d = String(f.detail ?? "");
  const word = /^faults\.json (is of|was measured)/.test(d) ? "Stale" : /^faults\.json is not readable/.test(d) ? "Unreadable"
    : /^faults\.json could not be checked/.test(d) ? "Unchecked" : f.ran ? "" : "Not run";
  return { measured: !word, word: word || `${f.caught} of ${f.ran} caught` };
}

const PROBE_KIND = { sound: "Sound", port: "Port", view: "View", light: "Light", keepout: "Keep-out" };

/** What a function probe measured, against what it needs, in words. */
export function probeText(p) {
  switch (p.kind) {
    case "sound":
    case "port":
      return `${pct(p.openShare)} of it sees out; it needs ${pct(p.need)}${typeof p.aim === "number" ? `, and the design aims for ${pct(p.aim)}` : ""}`;
    case "light":
      return `${pct(p.share)} of its light gets through; it needs ${pct(p.need)}`;
    case "view": {
      const own = listOf(p.inImage).length ? ` (${listOf(p.inImage).join(", ")})` : "";
      return `${pct(p.blockedShare)} of the image is the product itself${own}` +
        (typeof p.targetOutside === "number" ? `; of its target, ${pct(p.targetOutside)} is outside the image and ${pct(p.targetHidden)} hidden` : "");
    }
    case "keepout": {
      const close = listOf(p.within).length;
      return p.nearestMetalMm == null ? `no metal part near it; it needs ${numFmt.format(p.need)} mm clear`
        : `the nearest metal part, ${p.nearest}, is ${numFmt.format(p.nearestMetalMm)} mm away; it needs ${numFmt.format(p.need)} mm` +
          (close > 1 ? `, and ${close} metal parts are closer than that` : "");
    }
    default:
      return Object.entries(p).filter(([k]) => k !== "id" && k !== "kind").map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : v}`).join(", ");
  }
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
 * weights are rescaled so the drawing reads at screen size. A `plain` picture (a board's copper and mask,
 * where the colours and widths are the content) is cleaned the same way but keeps its own.
 */
function cadSvg(src, label, plain = false) {
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
    if (plain) return;
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

const PROCESS_WORD = { buy: "bought", print: "printed", pcb: "PCB", cnc: "machined", sheet: "sheet metal" };

/** What the gates in state.json say about a stage: its status once the run has reached it, else "not started". */
function gatesOf(state) {
  if (!state || !state.stages) return null;
  const at = STAGES.find((s) => state.stages[s.id]?.status !== "accepted")?.id ?? "done";
  const index = (id) => STAGES.findIndex((s) => s.id === id);
  const reached = (id) => at === "done" || index(id) <= index(at);
  return { at, reached, status: (id) => (reached(id) ? state.stages[id]?.status ?? "not started" : "not started") };
}

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
  const stages = options.layout === "stages";
  element.classList.add("ax");
  if (options.compact) element.setAttribute("data-ax-compact", "");
  if (stages) element.setAttribute("data-ax-layout", "stages");
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
    element.removeAttribute("data-ax-layout");
    if (mounted.get(element)?.destroy === destroy) mounted.delete(element);
  };

  if (!data || !Array.isArray(data.lines)) {
    fill(element, h("p", { class: "ax-empty" }, "No run to show yet. After a run, type /sprue view <slug> in Claude Code."));
    const view = { destroy, select() {} };
    mounted.set(element, view);
    return view;
  }

  /** @type {Explorer} */
  const ex = typeof structuredClone === "function" ? structuredClone(data) : JSON.parse(JSON.stringify(data));
  for (const k of ["architecture", "assembly", "checks", "previews", "estimates"]) if (!Array.isArray(ex[k])) ex[k] = [];
  ex.params ??= {};
  ex.shipping ??= {};
  ex.totals ??= { batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [] };
  ex.totals.unquoted ??= [];
  for (const l of ex.lines) {
    l.options ??= [];
    l.spec ??= {};
  }
  const fig = ex.figure && Array.isArray(ex.figure.steps) ? ex.figure : null;
  // An explorer.json from before the quote was optional always has one.
  const quoted = ex.quoted !== false;
  const planned = ex.buildPlanMd != null;
  // The gates only show on the product page: the website's example is a finished run kept at gate 1.
  const gates = stages ? gatesOf(ex.state) : null;

  const units = Math.max(1, ex.units || 1);
  const H = `h${Math.min(6, Math.max(1, options.headingLevel ?? 2))}`;
  const H3 = `h${Math.min(6, Math.max(1, (options.headingLevel ?? 2) + 1))}`;
  // The quote's pick per bought line. -1 stays -1: that line isn't in quotes.json (it is older than the offers).
  const quoteChoice = ex.lines.map((l) => (l.chosen >= 0 && l.chosen < l.options.length ? l.chosen : -1));
  let choice = quoteChoice.slice();
  /** The lines the reader picked an offer for (line index -> option index). The rest follow the requote. */
  const pins = new Map();
  const memo = new Map();
  /** requote() for these pins, remembered: the "If picked" column asks for the same ones again and again. */
  const quoteWith = (p) => {
    if (!p.size) return { choice: quoteChoice.slice(), total: breakdown(ex, quoteChoice).total };
    const key = [...p].sort((a, b) => a[0] - b[0]).map(([i, j]) => `${i}:${j}`).join(",");
    if (!memo.has(key)) memo.set(key, requote(ex, p));
    return memo.get(key);
  };
  /** Pick offer j for line i: a pin, unless the requote would give that line j anyway. */
  function pickOffer(i, j) {
    const without = new Map(pins);
    without.delete(i);
    if (quoteWith(without).choice[i] === j) pins.delete(i);
    else pins.set(i, j);
    choice = quoteWith(pins).choice.map((c, k) => (c < 0 && !ex.lines[k].made ? quoteChoice[k] : c));
  }
  const quoted0 = breakdown(ex, quoteChoice);
  const stale = quoted && (Math.abs(quoted0.total - (ex.totals.batchUsd ?? quoted0.total)) > 0.011
    || ex.lines.some((l, i) => !l.made && l.options.length && quoteChoice[i] < 0));
  let now = quoted0;
  const bought = ex.lines.map((l, i) => [l, i]).filter(([l]) => !l.made && l.process === "buy");
  const made = ex.lines.map((l, i) => [l, i]).filter(([l]) => l.made || l.process !== "buy");
  const id = (s) => `${uid}-${s}`;
  const tabIds = TABS.map((t) => t.id);
  const tabOf = (t) => (tabIds.includes(t) ? t : PART_OF[t] ?? null);
  let current = tabOf(options.initialTab ?? "") ?? "design";

  // ---- shell: a tab per stage, or the stages one after another
  const tablist = stages ? null : h("div", { class: "ax-tabs", role: "tablist", "aria-label": "Stages of the run" },
    TABS.map((t) => h("button", {
      class: "ax-tab", type: "button", role: "tab", id: id(`tab-${t.id}`), "aria-controls": id(`panel-${t.id}`),
      "aria-selected": String(t.id === current), tabindex: t.id === current ? "0" : "-1", "data-tab": t.id,
    }, h("span", { class: "ax-tab-n" }, t.n), h("span", { class: "ax-tab-l" }, t.label))));
  const panels = Object.fromEntries(TABS.map((t, k) => {
    const next = TABS[k + 1];
    const body = h("div", { class: "ax-body" });
    const status = gates ? gates.status(t.id) : "";
    const head = h("header", { class: "ax-head" },
      h("p", { class: "ax-kicker" }, h("span", null, `Stage ${t.n} of ${STAGES.length}`),
        status ? h("span", { class: "ax-status", "data-status": status.replace(/\s+/g, "-") }, status) : null),
      h(H, { class: "ax-h", id: id(`h-${t.id}`) }, t.title),
      h("p", { class: "ax-lede" }, t.lede));
    const p = stages
      ? h("section", { class: "ax-panel ax-stage", id: id(`panel-${t.id}`), "aria-labelledby": id(`h-${t.id}`), "data-panel": t.id }, head, body)
      : h("section", {
        class: "ax-panel", role: "tabpanel", id: id(`panel-${t.id}`), "aria-labelledby": id(`tab-${t.id}`), tabindex: "0",
        hidden: t.id !== current, "data-panel": t.id,
      }, head, body,
      next ? h("footer", { class: "ax-foot" },
        h("button", { class: "ax-next", type: "button", "data-goto": next.id },
          h("span", { class: "ax-next-l" }, "Next"), h("span", { class: "ax-tab-n" }, next.n), next.label, icon("arrow"))) : null);
    return [t.id, { el: p, body }];
  }));
  const live = h("div", { class: "ax-sr", "aria-live": "polite", "aria-atomic": "true" });
  fill(element, tablist, Object.values(panels).map((p) => p.el), live);
  /** A part of a stage that the glance cards and the shop links scroll to. */
  const partEls = {};
  const h3 = (part, text) => (partEls[part] = h(H3, { class: "ax-h3", id: id(`part-${part}`), tabindex: "-1" }, text));
  /** One line where a stage has nothing to show yet. */
  const notYet = (text) => h("p", { class: "ax-notyet" }, text);
  /** On the product page, a stage whose files come from a run before the gates reached it says so. One the person
   * accepted already is from a run before Inspect: it stays accepted, unless `sprue inspect` finds that a fix there
   * changed the parts it was of, and reopens it. */
  const earlier = (stage, what, when) => {
    if (!gates || gates.reached(stage)) return null;
    const n = STAGES.find((s) => s.id === stage).n;
    if (ex.state?.stages?.[stage]?.status === "accepted")
      return h("p", { class: "ax-note ax-earlier" }, `Stage ${n} hasn't started, but ${what} was accepted before Sprue inspected the whole product. It stays accepted once the inspection is, unless a fix at Inspect changes the parts: then `,
        h("code", null, `sprue inspect ${ex.slug}`), " reopens it.");
    return h("p", { class: "ax-note ax-earlier" }, `Stage ${n} hasn't started, so ${what} was made ahead of its gate, by an earlier run or by `, h("code", null, "sprue all"), `. It is checked and proposed once ${when} is accepted.`);
  };

  function fact(label, value) {
    return h("div", { class: "ax-fact" }, h("dt", null, label), h("dd", null, value));
  }

  // ---- 1 design: the request
  const glance = h("div", { class: "ax-glance" });
  const facts = h("dl", { class: "ax-facts" },
    stages ? null : fact("Product", ex.product),
    fact("Units", numFmt.format(units)),
    fact("Ships to", ex.region),
    fact("Budget", ex.budgetUsd != null ? `${usd(ex.budgetUsd)} for the batch` : "None given"));
  if (stages) add(panels.design.body, facts);
  else
    add(panels.design.body,
      h("blockquote", { class: "ax-brief" }, h("p", null, ex.brief)),
      facts,
      quoted ? [h(H3, { class: "ax-h3" }, "What came back"), glance] : null);

  /** " est." after a shop's shipping, unless catalog.json says it was read from the shop's rates. A shop whose parts
   * ride in a fab's parcel is always marked: its $0 is the ride-along, not a rate that was read. */
  const est = (shop) => ex.shipsWith?.[shop] ? ` (in the ${ex.shipsWith[shop]} parcel, est.)` : ex.shippingRead?.includes(shop) ? "" : " est.";
  const allEst = !ex.shippingRead?.length;
  /** The costs the quote leaves out (design.json costNotes), where the total is shown. */
  const costNotesBlock = (heading) => ex.costNotes?.length ? h("div", { class: "ax-files ax-costnotes" },
    h(H3, { class: "ax-h3" }, heading),
    h("ul", null, ex.costNotes.map((n) => h("li", { class: "ax-note" }, ticks(n))))) : null;

  /** "5 shops, 4 charge shipping": every shop in the order, and how many of them add a shipping charge. */
  function shopWords(b) {
    const all = b.byShop.size;
    const charging = b.shipping.length;
    return { all: plural(all, "shop"), charging: charging === all ? (all === 1 ? "it charges shipping" : "all charge shipping") : `${charging} charge${charging === 1 ? "s" : ""} shipping` };
  }

  function renderGlance() {
    if (stages || !quoted) return;
    const checks = tally(partChecks);
    const sw = shopWords(now);
    const v = inspectVerdict(ex.inspect);
    const sys = ex.inspect?.system;
    const gatesRun = ex.inspect?.report?.gates ?? [];
    // How the whole product stands when its gates say nothing of this design. "Nothing to assemble" only when nothing
    // is made: a product with made parts and no check of them is not checked, never empty.
    const notRun = !ex.inspect ? "From before the whole-product check"
      : { unwritten: "No cad/_system.py yet", missing: "Not checked on this design", stale: "Not checked on this design", unreadable: "system.json is not readable" }[sys] ?? "";
    const card = (tab, part, label, value, sub) =>
      h("button", { class: "ax-card", type: "button", "data-goto": tab, "data-goto-part": part },
        h("span", { class: "ax-card-l" }, label), h("span", { class: "ax-card-v" }, value), h("span", { class: "ax-card-s" }, sub));
    fill(glance,
      card("source", "bom", "Batch total", usd(now.total), units > 1 ? `${usd(now.total / units)} a unit` : budgetText(now.total, true)),
      card("source", "bom", "Parts", plural(ex.lines.length, "line"), `${bought.length} bought, ${made.length} made`),
      card("source", "suppliers", "Shops", sw.all, `${sw.charging}, ${usd(now.shipUsd)}`),
      card("design", "checks", "Part checks", `${checks.pass} of ${partChecks.length} pass`,
        [checks.fail ? `${checks.fail} failed` : "", checks.flag ? `${checks.flag} ${checks.flag === 1 ? "needs" : "need"} a person` : ""].filter(Boolean).join(", ") || "Nothing to review"),
      card("inspect", "system", "Whole product", { pass: "Passes", fail: "Fails", open: "Not checked" }[v.state],
        [gatesRun.length && sys === "current" ? `${gatesRun.filter((g) => g.status === "pass").length} of ${plural(gatesRun.length, "gate")} pass` : notRun,
          asmChecks.length ? plural(asmChecks.length, "assembly check") : ""].filter(Boolean).join(", ") || (sys === "none" ? "Nothing to assemble" : "Not checked yet")),
      card("build", "plan", "Longest lead", plural(now.lead.days, "day"), now.lead.line ? `${now.lead.line.name}, ${now.lead.supplier}` : ""));
  }

  function budgetText(total, short) {
    if (ex.budgetUsd == null) return short ? "No budget given" : "";
    const d = round(total - ex.budgetUsd);
    if (d > 0) return `${usd(d)} over the ${usd(ex.budgetUsd)} budget`;
    return `${usd(-d)} under the ${usd(ex.budgetUsd)} budget`;
  }

  function tally(checks) {
    const t = { pass: 0, fail: 0, flag: 0 };
    for (const c of checks) t[c.status] = (t[c.status] ?? 0) + 1;
    return t;
  }

  // The checks by scope: each part on its own under Design, the parts together under Inspect.
  const partChecks = ex.checks.filter((c) => scopeOf(c) === "part");
  const asmChecks = ex.checks.filter((c) => scopeOf(c) === "assembly");
  /** A checks.json from before checks had a scope: every check is read as part, so Inspect has none of its own. */
  const unscopedFile = ex.checks.length > 0 && ex.checks.every((c) => !c.scope);
  const rank = { fail: 0, flag: 1, pass: 2 };
  const glyph = { pass: "check", fail: "cross", flag: "flag", none: "dash" };
  /** What needs a person first, then the order they ran in. */
  const sortChecks = (checks) => checks.map((c, k) => [c, k]).sort((a, b2) => (rank[a[0].status] ?? 3) - (rank[b2[0].status] ?? 3) || a[1] - b2[1]).map(([c]) => c);

  /** One list of checks with its tally. A long one on the product page shows what needs a person first; the passes open
   * on a click. */
  function checkList(checks, listId, empty) {
    if (!checks.length) return notYet(empty);
    const t = tally(checks);
    const label = { pass: "Pass", fail: "Fails", flag: "Needs a person" };
    const fold = stages && checks.length > 10 && t.pass > 3 && t.pass < checks.length;
    return [
      h("p", { class: "ax-tally" },
        h("span", { "data-status": "pass", "data-zero": !t.pass }, icon("check"), `${t.pass} pass`),
        h("span", { "data-status": "fail", "data-zero": !t.fail }, icon("cross"), `${t.fail} fail`),
        h("span", { "data-status": "flag", "data-zero": !t.flag }, icon("flag"), `${t.flag} ${t.flag === 1 ? "needs" : "need"} a person`)),
      h("ul", { class: "ax-checks", id: listId }, sortChecks(checks).map((c) =>
        h("li", { class: "ax-check", "data-status": c.status, hidden: fold && c.status === "pass" },
          h("span", { class: "ax-check-i" }, icon(glyph[c.status] ?? "flag")),
          h("div", { class: "ax-check-t" }, h("span", { class: "ax-check-title" }, ticks(c.title)), h("span", { class: "ax-check-d" }, ticks(c.detail))),
          h("span", { class: "ax-check-s" }, label[c.status] ?? c.status)))),
      fold ? h("button", { class: "ax-more", type: "button", "data-more-checks": listId, "aria-expanded": "false", "aria-controls": listId },
        `Show the ${t.pass} passing checks`) : null];
  }

  /** "4 ×" a unit, or "1 for the batch" for a line the whole batch shares. */
  const perUnit = (l) => (l.qtyPerBatch != null && !l.qtyPerUnit ? `${numFmt.format(l.qtyPerBatch)} for the batch` : `${numFmt.format(l.qtyPerUnit)} ×`);
  /** The same, short enough for the parts list's column. */
  const perUnitShort = (l) => (l.qtyPerBatch != null && !l.qtyPerUnit ? `${numFmt.format(l.qtyPerBatch)} / batch` : `${numFmt.format(l.qtyPerUnit)} ×`);

  /** How the whole product stands now, for Design's gate: ", which fails clearance and function today". */
  function wholeNow() {
    const v = inspectVerdict(ex.inspect);
    if (v.state === "pass") return ex.inspect?.system === "none" ? "" : ", which passes today";
    const failed = ex.inspect?.verdict.failed ?? [];
    if (v.state === "fail") return failed.length ? `, which fails ${failed.length > 1 ? `${failed.slice(0, -1).join(", ")} and ${failed.at(-1)}` : failed[0]} today` : ", which fails today";
    return ex.inspect ? ", not checked on this design yet" : "";
  }

  // ---- 1 design: what it is, the parts, the numbers, the checks, the CAD
  {
    const b = panels.design.body;
    // On the product page the figure's caption is usually this same sentence: say it once.
    if (ex.summary && !(stages && fig?.caption && fig.caption.trim() === ex.summary.trim())) add(b, h("p", { class: "ax-summary" }, ticks(ex.summary)));
    if (ex.architecture.length)
      add(b, h(H3, { class: "ax-h3" }, "How it works"),
        h("ul", { class: "ax-arch" }, ex.architecture.map((a) => h("li", null, ticks(arrows(a))))));

    // The parts list, linked to the figure: point at a row to light the part, click to pin it.
    if (stages) {
      const drawnLines = fig?.coverage ? ex.lines.filter((l) => (fig.coverage[l.id]?.drawn ?? 0) > 0).length : ex.lines.length;
      add(b, h("div", { class: "ax-parts-wrap" },
        h(H3, { class: "ax-h3 ax-h3-split", id: id("part-parts") }, h("span", null, "Parts"),
          h("span", { class: "ax-h3-aside" }, `${plural(ex.lines.length, "line")}${fig ? ` · ${drawnLines} in the figure` : ""}`)),
        h("div", { class: "ax-parts-cols", "aria-hidden": "true" }, h("span", null, "Part"), h("span", { class: "ax-num" }, "Qty"), h("span", null, "How")),
        h("ul", { class: "ax-parts" }, ex.lines.map((l) => {
          const drawn = !fig || !fig.coverage || (fig.coverage[l.id]?.drawn ?? 0) > 0;
          const why = fig?.hidden?.[l.id];
          return h("li", null, h("button", {
            class: "ax-part", type: "button", "data-line-id": l.id, "data-part-line": l.id, "aria-pressed": "false",
            "data-hidden": drawn ? null : "",
            "aria-label": `${l.name}, ${perUnit(l)}, ${PROCESS_WORD[l.process] ?? l.process}${drawn ? "" : ", not drawn"}${fig && drawn ? ". Lights it in the figure" : ""}`,
          },
          h("span", { class: "ax-part-name" }, l.name,
            !drawn ? h("span", { class: "ax-sub" }, `Not drawn${why ? `: ${why}` : ""}`) : null),
          h("span", { class: "ax-part-qty ax-num" }, perUnitShort(l)),
          h("span", { class: "ax-part-how" }, PROCESS_WORD[l.process] ?? l.process)));
        })),
        fig ? h("p", { class: "ax-note" }, "Point at a part to light it in the figure; click to keep it lit.") : null));
    }

    const params = Object.entries(ex.params).filter(([, v]) => v != null);
    if (params.length) {
      const LIMIT = 18;
      const list = h("dl", { class: "ax-params", id: id("params") }, params.map(([k, v], n) => {
        const [label, unit] = splitKey(k);
        // A note or a list in a param is text: it wraps under its name instead of running off the page.
        const text = typeof v === "string" && v.length > 24;
        // A list written with bare commas ("controller,storage,camera") reads, and wraps, as one with spaces.
        const shown = typeof v === "string" && !/\s/.test(v) && v.includes(",") ? v.split(",").join(", ") : v;
        return h("div", { class: "ax-param", hidden: n >= LIMIT && params.length > LIMIT + 3, "data-text": text },
          h("dt", { title: k }, label), h("dd", null, valueText(shown, unit)));
      }));
      add(b, h(H3, { class: "ax-h3" }, "Design numbers"), list);
      if (params.length > LIMIT + 3)
        add(b, h("button", { class: "ax-more", type: "button", "data-more": "params", "aria-expanded": "false", "aria-controls": id("params") },
          `Show all ${params.length} numbers`));
    }

    // The checks of each part on its own; the parts together are Inspect's.
    const t = tally(partChecks);
    add(b, h3("checks", "Part checks"),
      checkList(partChecks, id("checks"), asmChecks.length ? "No part checks: every check that ran is of the parts together, under Inspect." : "No checks have run yet."),
      ex.inspect?.unscoped?.length ? h("p", { class: "ax-note" }, `${plural(ex.inspect.unscoped.length, "rule")} in rules.ts ${ex.inspect.unscoped.length === 1 ? "says" : "say"} no scope, so ${ex.inspect.unscoped.length === 1 ? "it is" : "they are"} read as part checks: ${ex.inspect.unscoped.join(", ")}.`) : null);
    if (!stages) add(b, scoreBlock());

    if (ex.previews.length) {
      const madeByBase = new Map(ex.lines.filter((l) => l.file).map((l) => [fileBase(l.file), l]));
      const order = (p) => {
        const l = madeByBase.get(p.name);
        return l ? ex.lines.indexOf(l) : p.name.endsWith("-bottom") ? 1000 : 999; // a board's back after its front
      };
      const figs = ex.previews.slice().sort((a, b2) => order(a) - order(b2)).map((p) => {
        const l = madeByBase.get(p.name);
        const title = l ? l.name : splitKey(p.name)[0];
        const board = p.name.startsWith("pcb-");
        const svg = cadSvg(p.svg, `${board ? "Board drawing" : "CAD drawing"}: ${title}`, board);
        return h("figure", { class: "ax-fig" },
          h("div", { class: "ax-fig-art" }, svg ?? h("span", { class: "ax-muted" }, "Preview unavailable")),
          h("figcaption", null, h("span", null, title), l?.file ? h("code", null, l.file) : null));
      });
      add(b, h("div", { class: "ax-wide ax-cad" }, h(H3, { class: "ax-h3" }, "CAD"), h("div", { class: "ax-figs" }, figs),
        h("p", { class: "ax-note" }, "Drawn from the code in ", h("code", null, `products/${ex.slug}/cad/`), ".",
          ex.previews.some((p) => !p.name.startsWith("pcb-")) ? " In the case drawings solid lines are visible edges and dotted lines are hidden ones." : "",
          ex.previews.some((p) => p.name.startsWith("pcb-")) ? " The board is drawn from the same shapes as its Gerbers: copper tan, pads open in the mask yellow, the back mirrored." : "")));
    }

    // While the design is open: what to know before accepting it.
    if (gates && gates.at === "design") {
      const madeLines = ex.lines.filter((l) => l.process !== "buy");
      const boughtLines = ex.lines.filter((l) => l.process === "buy");
      const how = { pcb: "PCB", print: "printed", cnc: "machined", sheet: "sheet metal" };
      const kinds = [...new Set(madeLines.map((l) => l.process))].map((p) => `${madeLines.filter((l) => l.process === p).length} ${how[p] ?? p}`);
      const pieces = boughtLines.reduce((n, l) => n + (l.qtyPerUnit || 0), 0);
      add(b, h("section", { class: "ax-before", "aria-labelledby": id("before") },
        h(H3, { class: "ax-h3", id: id("before") }, "Before you accept"),
        h("ul", null,
          h("li", null, `${plural(ex.lines.length, "line")}: ${boughtLines.length} bought (${plural(pieces, "part")} a unit), ${madeLines.length} made${kinds.length ? ` (${kinds.join(", ")})` : ""}.`),
          h("li", null, partChecks.length ? `Part checks: ${partChecks.length} run, ${t.fail} failed, ${t.flag} flagged.` : "Part checks: none run yet."),
          sortChecks(partChecks).filter((c) => c.status !== "pass").map((c) =>
            h("li", { "data-status": c.status }, h("b", null, c.status === "fail" ? "Failed: " : "Flagged: "), c.title, ".")),
          ex.estimates.map((e) => h("li", null, h("b", null, "Estimate: "), ticks(e))),
          // The parts together wait for Inspect's gate: say how they stand, so nothing is a surprise there.
          h("li", null, `Next, at stage 2, Inspect: ${asmChecks.length ? `${plural(asmChecks.length, "assembly check")} (${tally(asmChecks).fail} failed, ${tally(asmChecks).flag} flagged) and ` : ""}the whole product${wholeNow()}.`),
          // Each by its title, as this list named every check before Inspect took these over: a failed one stops gate 2,
          // not this one.
          sortChecks(asmChecks).filter((c) => c.status !== "pass").map((c) =>
            h("li", { "data-status": c.status }, h("b", null, c.status === "fail" ? "At Inspect, failed: " : "At Inspect, flagged: "), c.title, ".")))));
    }
  }

  // ---- 2 inspect: the parts together (system.json and the assembly checks), and how well the checks catch faults
  {
    const b = panels.inspect.body;
    const ins = ex.inspect;
    const r = ins?.report;
    const v = inspectVerdict(ins);
    const gateList = listOf(r?.gates);
    const gate = (gid) => gateList.find((g) => g.id === gid);
    /** A failing gate's problems: its list, or for a system.json from before the list, its detail (the first 8). */
    const problemsOf = (g) => (!g || g.status === "pass" ? [] : g.list ? listOf(g.list) : String(g.detail ?? "").split("; "));
    /** What a gate says of one pose, push or probe: system.py starts each problem, risk and note with its name. */
    const about = (g, prefix) => ({
      fails: problemsOf(g).filter((p) => p.startsWith(prefix)),
      flags: listOf(g?.flags).filter((p) => p.startsWith(prefix)),
      notes: listOf(g?.notes).filter((p) => p.startsWith(prefix)),
    });
    /** One row in the style of a check: a mark, a title, what was found, and the status in words. */
    const row = (status, title, detail, word, ...more) =>
      h("li", { class: "ax-check", "data-status": status },
        h("span", { class: "ax-check-i" }, icon(glyph[status] ?? "flag")),
        h("div", { class: "ax-check-t" }, h("span", { class: "ax-check-title" }, title), detail ? h("span", { class: "ax-check-d" }, ticks(detail)) : null, more),
        h("span", { class: "ax-check-s" }, word));
    /** [text, kind] pairs as a list under a row (problems, accepted risks, planted faults); past 8 the rest fold. */
    const items = (pairs) => {
      if (!pairs.length) return null;
      const li = ([text, kind]) => h("li", { "data-kind": kind }, ticks(text));
      return [h("ul", { class: "ax-problems" }, pairs.slice(0, 8).map(li)),
        pairs.length > 8 ? h("details", { class: "ax-fold" }, h("summary", null, `${pairs.length - 8} more`), h("ul", { class: "ax-problems" }, pairs.slice(8).map(li))) : null];
    };
    const statusOf = (a) => (a.fails.length ? "fail" : a.flags.length ? "flag" : "pass");
    // A new node at each use: appending one node twice moves it, and the first place would lose its command.
    const cmd = () => (ins?.run ? h("code", null, ins.run) : null);

    // Made ahead of its gate only when there is a check to show: none at all is said below.
    add(b, r ? earlier("inspect", "this whole-product check", "the design") : null,
      h("p", { class: "ax-iverdict", "data-state": v.state }, icon(v.state === "pass" ? "check" : v.state === "fail" ? "cross" : "flag"), h("span", null, v.text)),
      // Not of the design as it is now: say why, and the command that checks it.
      !ins ? notYet("Ask Claude to write the page again (sprue view): this run's data is from before the whole-product check.")
        : ins.system === "stale" ? h("p", { class: "ax-note ax-warn ax-istale" },
          `${cap(ins.verdict.detail.replace(/:\s*run sprue system\s*$/, ""))}. What it found then is below; it says nothing of the design as it is now. Run `, cmd(), " to check this one.")
        : ins.system === "unwritten" ? h("p", { class: "ax-note ax-warn ax-istale" },
          "Nothing checks the parts as one product: there is no ", h("code", null, "cad/_system.py"), ". Claude writes it (reference/formats.md), then runs ", cmd(), ".")
        : ins.system === "missing" ? h("p", { class: "ax-note ax-warn ax-istale" }, "The whole-product check hasn't run: there is no ", h("code", null, "system.json"), ". Run ", cmd(), ".")
        : ins.system === "unreadable" ? h("p", { class: "ax-note ax-warn ax-istale" }, h("code", null, "system.json"), " is not readable. Run ", cmd(), " to write it again.")
        : null);

    // cad/_system.py could not put the product in one frame (its "inputs" gate: a line, field or file it needs is not
    // there), so no part was placed and no fit, stability or probe was checked: nothing below may read as if it were.
    const framed = !!r && r.parts > 0 && !gateList.some((g) => g.id === "inputs");
    if (r) {
      // Each gate of system.json, with its problems, or the risks the design accepts (flags, never failures).
      const date = String(r.generatedAt ?? "").slice(0, 10);
      add(b, partEls.system = h(H3, { class: "ax-h3 ax-h3-split", id: id("part-system"), tabindex: "-1" }, h("span", null, "Whole product"),
        h("span", { class: "ax-h3-aside" }, `${framed ? `${plural(r.parts, "part")} in one frame` : "not put in one frame"}${date ? ` · checked ${date}` : ""}`)),
        h("ul", { class: "ax-checks" }, gateList.map((g) => {
          const flags = listOf(g.flags);
          const problems = problemsOf(g);
          const status = g.status !== "pass" ? "fail" : flags.length ? "flag" : "pass";
          // A passing gate's detail ends with its first accepted risks (system.py gate()): they are listed in full below.
          const detail = flags.length ? String(g.detail).replace(/; \d+ accepted by the design: [\s\S]*$/, "") : g.detail;
          // The risks fold past two: each is on its pose's or probe's row too, and in full before the gate.
          const risks = flags.length > 2 ? h("details", { class: "ax-fold" }, h("summary", null, `${plural(flags.length, "risk")} the design accepts`),
            items(flags.map((p) => [p, "flag"]))) : items(flags.map((p) => [p, "flag"]));
          return row(status, g.title, problems.length ? "" : cap(detail),
            status === "fail" ? plural(Number(g.problems) || problems.length, "problem") : flags.length ? `${flags.length} accepted` : "Pass",
            items(problems.map((p) => [p, "fail"])), risks);
        })),
        // Envelopes: a fit with one is checked on datasheet sizes, so never proven by them alone.
        framed ? h("p", { class: "ax-note ax-envelopes" }, r.envelopes
          ? `${r.envelopes} of ${r.parts} parts are envelopes: bought parts drawn as boxes and cylinders at their datasheet sizes, not their makers' models. A fit, gap or contact with an envelope is checked on those sizes only, so it is not proven until the maker's model is in.`
          : "No part is an envelope: every part is drawn from its CAD.")
          : h("p", { class: "ax-note ax-warn ax-envelopes" }, "The product could not be put in one frame: ", h("code", null, "cad/_system.py"),
            gate("inputs") ? " needs what the inputs row names" : " places no part", ". So none of its fits, gaps, stability or function probes were checked."));
    }

    if (framed) {
      // Mass and stability: once for the product when every pose weighs the same, then each pose and its pushes.
      const stab = gate("stability");
      const poses = listOf(r.stability);
      const same = poses.every((p) => p.massG === poses[0].massG && p.estimatedG === poses[0].estimatedG);
      const massText = (p) => `${numFmt.format(p.massG)} g${p.massG > 0 && p.estimatedG > 0 ? `, of which ${numFmt.format(p.estimatedG)} g (${pct(p.estimatedG / p.massG)}) is estimated` : ""}`;
      if (poses.length)
        add(b, h3("stability", "Stability"),
          same ? h("p", { class: "ax-note ax-lede-note" }, `It weighs ${massText(poses[0])}${poses[0].estimatedG > 0 ? ": not weighed nor read from a datasheet, so the centre of mass and the tip angles are estimates too" : ""}.`) : null,
          h("ul", { class: "ax-checks" }, poses.map((p) => {
            const prefix = `${p.pose}: `;
            const a = about(stab, prefix);
            const said = (t) => [t.slice(prefix.length), a.fails.includes(t) ? "fail" : "flag"];
            // A push the pose falls short of reads as the gate wrote it, with the design's reason when it accepts it.
            const pushes = listOf(p.pushes).map((u) => {
              const own = [...a.fails, ...a.flags].find((t) => t.startsWith(`${prefix}${u.name} tips it`));
              return own ? said(own) : [`${u.name}: ${u.tipN == null ? "never tips it" : `tips it at ${numFmt.format(u.tipN)} N`}, and it must stand ${numFmt.format(u.needN)} N`, "pass"];
            });
            const ofPose = [...a.fails, ...a.flags].filter((t) => !listOf(p.pushes).some((u) => t.startsWith(`${prefix}${u.name} tips it`))).map(said);
            const outside = p.tiltDeg < 0;
            return row(statusOf(a), cap(p.pose),
              `${same ? "" : `${massText(p)}; `}centre of mass at (${listOf(p.com).map((c) => numFmt.format(c)).join(", ")}) mm`,
              outside ? "Falls over" : `Tips at ${numFmt.format(p.tiltDeg)}°`, items([...ofPose, ...pushes]));
          })));

      // The function probes: sound out, ports and views clear, light through its window, radios clear of metal.
      const fn = gate("function");
      const probes = listOf(r.probes);
      add(b, h3("function", "Function"), probes.length
        ? h("ul", { class: "ax-checks" }, probes.map((p) => {
          const prefix = `${p.id}: `;
          const a = about(fn, prefix);
          const status = statusOf(a);
          // A note is an aim the probe passed short of: its text already says the aim, so the status says it is short.
          return row(status, [p.id, " ", h("span", { class: "ax-kind" }, PROBE_KIND[p.kind] ?? p.kind)], cap(probeText(p)),
            status === "pass" && a.notes.length ? "Pass, under its aim" : { fail: "Fails", flag: "Accepted", pass: "Pass" }[status],
            items([...a.fails.map((t) => [t.slice(prefix.length), "fail"]), ...a.flags.map((t) => [t.slice(prefix.length), "flag"])]));
        }))
        : notYet("No function probes: cad/_system.py names no sound, port, view, light or radio keep-out to check."));
    }

    // The engineer checks of the parts together. Every failed check stops this gate, a part one too.
    const partFails = partChecks.filter((c) => c.status === "fail");
    add(b, h3("assembly", "Assembly checks"),
      unscopedFile
        ? h("p", { class: "ax-note ax-warn" }, "This run's checks.json is from before checks had a scope, so every check shows under Design. Run ",
          h("code", null, `sprue check ${ex.slug}`), " to sort them.")
        : checkList(asmChecks, id("checks-assembly"), "No assembly checks ran: none of the rules that hold parts together applies to this design."),
      partFails.length ? h("p", { class: "ax-note ax-warn ax-partfails" },
        `${plural(partFails.length, "part check")} ${partFails.length === 1 ? "fails" : "fail"}, under Design: ${partFails.map((c) => c.title).join("; ")}. Every failed check stops this gate too.`) : null);

    // The checks of the checks: the self-test system.json runs on itself, and the seeded faults of faults.json. One not
    // measured on the product and gates as they are (none, stale, unreadable) is a flag, as seeded faults stop no gate.
    const fw = ins?.faults ? faultsWord(ins.faults) : null;
    if (r || ins?.faults) {
      const planted = listOf(r?.selfTest?.faults);
      const caught = planted.filter((f) => f.caught).length;
      const untested = listOf(r?.selfTest?.untested);
      const f = ins?.faults;
      add(b, h3("evals", "Checking the checks"), h("ul", { class: "ax-checks" },
        r ? row(r.selfTest?.ok && caught === planted.length && !untested.length ? "pass" : "fail", "Self-test, in system.json",
          `Each gate runs again with a fault planted in it, such as a part moved, left out or covered, and must catch it.${untested.length ? ` No fault was planted for ${untested.join(", ")}, so ${untested.length === 1 ? "its" : "their"} pass proves nothing.` : ""}`,
          `${caught} of ${planted.length} caught`,
          planted.length ? h("details", { class: "ax-fold" }, h("summary", null, `The ${plural(planted.length, "fault")} it planted`),
            h("ul", { class: "ax-problems" }, planted.map((x) => h("li", { "data-kind": x.caught ? "pass" : "fail" },
              `${x.gate}: ${x.fault}`, h("span", { class: "ax-sub" }, x.caught ? `Caught: ${x.detail}` : "Missed"))))) : null) : null,
        f ? row(f.ok ? "pass" : fw.measured ? "fail" : "flag", "Seeded faults, in faults.json",
          `Copies of the product, each broken in one way reference/faults.json lists, through every gate: ${f.detail}.`, fw.word)
          : row("none", "Seeded faults", "None listed: the product has no reference/faults.json, so `sprue faults` has nothing to break copies of it with.", "None listed")));
    }

    // What nothing checks yet. Each says so, and never reads as a pass.
    const usb = ex.checks.find((c) => c.id === "usb-power");
    // Where the page lists it: a checks.json from before the scopes shows every check under Design.
    const usbWhere = usb && scopeOf(usb) === "assembly" && !unscopedFile ? "under Assembly checks" : "under Design";
    const withMaterial = ex.lines.filter((l) => l.spec?.material != null && String(l.spec.material) !== "");
    const materials = [...new Set(withMaterial.map((l) => String(l.spec.material)))].join(", ");
    add(b, h3("unchecked", "Not checked yet"), h("ul", { class: "ax-checks" },
      row("none", "Electricity", `${usb ? `Only the controller's USB current (usb-power, ${usbWhere}) and any assembly rule the product writes for itself` : "Only the assembly rules the product writes for itself: the built-in usb-power check doesn't apply here"}. No netlist joins the parts, so nothing follows the current from the supply through each one.`, "Not checked yet"),
      row("none", "Strength", "No load analysis: nothing works out whether a part bends or breaks under its loads, such as a press, a screw's clamp or a drop.", "Not checked yet"),
      row("none", "Materials", withMaterial.length
        ? `Only ${withMaterial.every((l) => l.process === "print") ? `the ${plural(withMaterial.length, "printed line")}` : plural(withMaterial.length, "line")} of ${ex.lines.length} ${withMaterial.length === 1 ? "carries" : "carry"} a material (${materials}), and no check reads it against heat, load or what it touches.`
        : "No line carries a material, and no check reads one.", "Not checked yet")));

    // While Inspect is open: what to know before accepting it.
    if (gates && gates.at === "inspect") {
      const t = tally(asmChecks);
      const failing = gateList.filter((g) => g.status !== "pass");
      const flags = gateList.flatMap((g) => listOf(g.flags));
      const pose = listOf(r?.stability)[0];
      const f = ins?.faults;
      add(b, h("section", { class: "ax-before", "aria-labelledby": id("before-inspect") },
        h(H3, { class: "ax-h3", id: id("before-inspect") }, "Before you accept"),
        h("ul", null,
          h("li", { "data-status": v.state === "pass" ? null : "fail" }, v.text, ins?.run ? [" Run ", cmd(), " first."] : null),
          ins?.system === "current" ? failing.map((g) => h("li", { "data-status": "fail" }, h("b", null, "Failed: "), `${g.title} (${plural(Number(g.problems) || problemsOf(g).length, "problem")}).`)) : null,
          unscopedFile ? null : h("li", null, asmChecks.length ? `Assembly checks: ${asmChecks.length} run, ${t.fail} failed, ${t.flag} flagged.` : "Assembly checks: none ran."),
          sortChecks(asmChecks).filter((c) => c.status !== "pass").map((c) =>
            h("li", { "data-status": c.status }, h("b", null, c.status === "fail" ? "Failed: " : "Flagged: "), c.title, ".")),
          partFails.map((c) => h("li", { "data-status": "fail" }, h("b", null, "Failed, a part check: "), c.title, ".")),
          flags.map((x) => h("li", { "data-status": "flag" }, h("b", null, "Accepted: "), x)),
          f && !f.ok ? h("li", { "data-status": fw.measured ? "fail" : "flag" }, h("b", null, fw.measured ? "Seeded faults: " : `Seeded faults, ${fw.word.toLowerCase()}: `), `${f.detail}.`) : null,
          r?.envelopes ? h("li", null, h("b", null, "Envelopes: "), `${r.envelopes} of ${r.parts} parts are checked on their datasheet sizes, not their makers' models.`) : null,
          pose?.estimatedG > 0 ? h("li", null, h("b", null, "Estimate: "), `${numFmt.format(pose.estimatedG)} g of the ${numFmt.format(pose.massG)} g is estimated (${pct(pose.estimatedG / pose.massG)}), and the stability with it.`) : null,
          h("li", null, h("b", null, "Not checked yet: "), "electricity across the parts, strength and materials."))));
    }
  }

  // ---- 3 source: the BOM with every offer, the quote and the shops
  const rowRefs = new Map(); // line index -> { row, qty, shop, cost, mode, opts: Map<optIndex, {el, pick}> , detail, change }
  const groupRefs = [];
  const sumAside = h("aside", { class: "ax-sum", "aria-label": "Quote for the batch" });
  const sumBar = h("div", { class: "ax-sumbar" });
  const supBody = h("div", { class: "ax-shops" });
  const shopEls = new Map(); // shop name -> its card, or its row under "Other shops"
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
    // The last day a price was read: an estimate's date is when it was written down, not a read.
    const latest = ex.lines.flatMap((l) => l.options.filter((o) => o.source !== "estimate").map((o) => o.capturedAt)).filter(Boolean).sort().pop();
    const s = panels.source.body;
    if (!quoted)
      add(s, notYet("Not started. Once the whole product is inspected and accepted, Claude reads offers from supplier pages and quotes the batch here."));
    else
      add(s, earlier("source", "this quote", "the inspection"),
        h("div", { class: "ax-wide" }, h3("bom", "Bill of materials"),
          h("div", { class: "ax-bom-wrap" },
            h("div", { class: "ax-bom-main" }, table,
              h("p", { class: "ax-note" },
                latest ? `Offers were read from supplier pages up to ${latest}. ` : "",
                "Packs round the order up, and each shop's shipping is counted once",
                allEst ? ", as an estimate: no shop's rate was read" : ex.shippingRead.length ? `; only ${ex.shippingRead.join(", ")} ${ex.shippingRead.length === 1 ? "has its" : "have their"} shipping read from ${ex.shippingRead.length === 1 ? "its" : "their"} rates, the rest are estimates` : "",
                ". Picking another offer requotes the order, as ", h("code", null, "/sprue swap"), " would. Nothing has been ordered."),
              costNotesBlock("Not in this total")),
            sumBar, sumAside)),
        h("div", { class: "ax-wide" }, h3("suppliers", "Suppliers and shipping"),
          h("p", { class: "ax-note ax-lede-note" }, "The shops in this order, what each one supplies and what it charges to ship."),
          supBody));
  }

  function lineRows(l, i) {
    const detailId = id(`line-${i}`);
    const qty = h("td", { class: "ax-c-qty" });
    const shop = h("td", { class: "ax-c-shop" });
    const cost = h("td", { class: "ax-c-cost ax-num" });
    const mode = h("td", { class: "ax-c-mode" });
    const toggle = h("button", { class: "ax-toggle", type: "button", "aria-expanded": "false", "aria-controls": detailId, "data-line": i },
      icon("chev", "ax-chev"), h("span", { class: "ax-pname" }, l.name));
    const row = h("tr", { class: "ax-row", "data-line": i, "data-line-id": l.id },
      h("td", { class: "ax-c-part" }, toggle, h("span", { class: "ax-pid" }, h("code", null, l.id), l.role && l.role !== l.id ? ` ${l.role}` : "")),
      qty, shop, cost, mode);
    const td = h("td", { colspan: "5" });
    const detail = h("tr", { class: "ax-detail", id: detailId, hidden: true, "data-line-id": l.id }, td);
    const opts = new Map();
    const change = h("div", { class: "ax-linechange", hidden: true });

    const spec = Object.entries(l.spec).filter(([, v]) => v != null);
    const facts = h("dl", { class: "ax-spec" },
      spec.map(([k, v]) => {
        const [label, unit] = splitKey(k);
        return h("div", null, h("dt", null, label), h("dd", null, valueText(v, unit)));
      }),
      l.mpn ? h("div", null, h("dt", null, "MPN"), h("dd", null, h("code", null, l.mpn))) : null,
      h("div", null, h("dt", null, "Need"), h("dd", null, needText(l, units))));
    const inner = h("div", { class: "ax-detail-in" }, facts,
      l.notes ? h("p", { class: "ax-linenote" }, ticks(l.notes)) : null);

    if (l.made) {
      const m = l.made;
      add(inner, h("dl", { class: "ax-made" },
        h("div", null, h("dt", null, "Made by"), h("dd", null, m.supplier)),
        h("div", null, h("dt", null, "Order"), h("dd", null, m.sku)),
        h("div", null, h("dt", null, "Quantity"), h("dd", null, numFmt.format(m.orderQty))),
        h("div", null, h("dt", null, "Cost"), h("dd", { class: "ax-num" }, usd(m.orderUsd))),
        h("div", null, h("dt", null, "Lead"), h("dd", null, plural(m.leadDays, "day"))),
        h("div", null, h("dt", null, "Shipping"), h("dd", null,
          l.shipsFree ? (l.process === "pcb" ? "Included in the price" : "None: it is printed at home") : `${usd(ex.shipping[m.supplier] ?? 0)}${est(m.supplier)}, once for the order`)),
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
      if (l.pin) add(inner, h("p", { class: "ax-note" }, `Pinned to ${l.pin.supplier}${l.pin.sku ? ` ${l.pin.sku}` : ""} with /sprue swap.`));
      if (l.sourceNote) add(inner, h("p", { class: "ax-note" }, `Not shown: ${l.sourceNote.replace(/(^|; )dropped for short stock/g, "$1offers with too little stock")}.`));
      add(inner, change);
    } else {
      add(inner, h("p", { class: "ax-note" }, l.sourceNote ? `Not priced: ${l.sourceNote}.` : "Not priced yet: no offers for this line."));
    }
    add(td, inner);
    return { row, toggle, detail, qty, shop, cost, mode, opts, change, line: l };
  }

  function renderRow(i) {
    const r = rowRefs.get(i);
    const l = r.line;
    const need = needOf(l, units);
    const o = l.made ?? l.options[choice[i]];
    const packed = o && "packSize" in o && o.packSize > 1;
    // More than the need: whole packs, or a price break that makes the bigger order cost less.
    const upToPacks = packed ? Math.ceil(need / o.packSize) * o.packSize : need;
    fill(r.qty, numFmt.format(need), o && o.orderQty !== need ? h("span", { class: "ax-round" }, ` → ${numFmt.format(o.orderQty)}`) : null,
      packed ? h("span", { class: "ax-sub" }, `packs of ${o.packSize}`) : null,
      !l.made && o && o.orderQty > upToPacks ? h("span", { class: "ax-sub" }, "a price break: costs less") : null,
      l.made && o && o.orderQty !== need ? h("span", { class: "ax-sub" }, "fab minimum") : null);
    fill(r.shop, o ? h("button", { class: "ax-textbtn ax-shopbtn", type: "button", "data-show-shop": o.supplier, "aria-label": `${o.supplier}: open its shop in Suppliers` }, o.supplier)
      : h("span", { class: "ax-muted" }, l.options.length ? "Not in the quote" : "Not priced"),
      l.made ? h("span", { class: "ax-sub" }, l.process === "pcb" ? "PCB fab" : l.process === "print" ? "3D print" : l.process)
        : l.options.length > 1 ? h("span", { class: "ax-sub" }, `${l.options.length} offers`) : l.options.length ? h("span", { class: "ax-sub" }, "1 offer") : null);
    fill(r.cost, o ? usd(o.orderUsd) : "–");
    fill(r.mode, o ? modeTag(l.made ? l.made.mode : /** @type {ExplorerOption} */ (o).source) : null);
    const changed = !l.made && choice[i] !== quoteChoice[i];
    const picked = pins.has(i);
    r.row.toggleAttribute("data-changed", changed);
    for (const [j, x] of r.opts) {
      x.input.checked = j === choice[i];
      x.el.toggleAttribute("data-checked", j === choice[i]);
    }
    if (r.opts.size) {
      r.change.hidden = !changed;
      if (changed && !picked) {
        // Not picked here: the requote moved it, to share a shop with a line that was.
        const qo = l.options[quoteChoice[i]];
        const cur = l.options[choice[i]];
        fill(r.change, h("p", null, `Moved${qo ? ` from ${qo.supplier}` : ""} to ${cur.supplier} by the requote: your pick brings ${cur.supplier} into the order, and this line is cheaper there with its shipping already paid. The swap for the line you picked moves it too.`));
      } else if (changed) {
        const qo = l.options[quoteChoice[i]];
        const cur = l.options[choice[i]];
        // The skill's own command: /sprue swap pins the line to that shop and requotes (reference/swap.md).
        const args = [ex.slug, l.id, cur.supplier, ...(r.opts.get(choice[i]).multi ? [cur.sku] : [])];
        const cmd = `/sprue swap ${args.map(shQuote).join(" ")}`;
        fill(r.change,
          h("p", null, qo ? `Changed from ${qo.supplier}. To keep this pick, type this in Claude Code:` : "To keep this pick, type this in Claude Code:"),
          h("div", { class: "ax-cmdrow" }, h("code", { class: "ax-cmd" }, cmd),
            h("button", { class: "ax-btn ax-btn-sm ax-copy", type: "button", "data-copy": cmd, "aria-label": `Copy ${cmd}` }, "Copy")),
          h("p", null, "Or ", h("button", { class: "ax-textbtn", type: "button", "data-reset-line": i }, qo ? `go back to ${qo.supplier}` : "clear the pick"), "."));
      } else if (picked) {
        // Picked, and the requote keeps it where the quote had it: nothing to type.
        r.change.hidden = true;
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
        const p = new Map(pins);
        p.set(i, j);
        const r2 = quoteWith(p);
        const d = round(r2.total - now.total);
        const moved = ex.lines.filter((m, k) => k !== i && !m.made && r2.choice[k] >= 0 && r2.choice[k] !== choice[k]);
        fill(x.pick, h("span", { "data-sign": d > 0 ? "up" : d < 0 ? "down" : "zero" }, d === 0 ? "No change" : signed(d)),
          moved.length ? h("span", { class: "ax-sub" }, moved.length === 1 ? `moves ${moved[0].shortName || moved[0].name} too` : `moves ${moved.length} more lines`) : null);
      }
    }
  }

  function explain() {
    /** @type {[string, number][]} */
    const rows = [];
    for (const [s, c] of now.shipping) if (!quoted0.shops.has(s)) rows.push([`${s} shipping`, c]);
    for (const [s, c] of quoted0.shipping) if (!now.shops.has(s)) rows.push([`${s} drops out`, -c]);
    const dp = round(now.parts - quoted0.parts);
    if (dp !== 0) rows.push(["Parts", dp]);
    const words = [
      ...now.shipping.filter(([s]) => !quoted0.shops.has(s)).map(([s, c]) => `${s} adds ${usd(c)} shipping`),
      ...quoted0.shipping.filter(([s]) => !now.shops.has(s)).map(([s, c]) => `${s} drops out, saving ${usd(c)} shipping`),
      ...(dp ? [`parts cost ${usd(Math.abs(dp))} ${dp > 0 ? "more" : "less"}`] : []),
    ];
    return { rows, words };
  }

  function renderSummary() {
    const d = round(now.total - quoted0.total);
    const changedLines = ex.lines.filter((l, i) => !l.made && choice[i] !== quoteChoice[i]).length;
    const status = ex.budgetUsd == null ? "none" : now.total > ex.budgetUsd ? "over" : "under";
    const { rows, words } = explain();
    // The heading counts the shops that charge shipping, so it matches the rows under it; a shop whose
    // price already includes shipping (a PCB fab) gets its own line below.
    const shipList = h("ul", { class: "ax-sum-ship" }, now.shipping.map(([s, c]) => h("li", null, h("span", null, s), h("span", { class: "ax-num" }, `${usd(c)}${est(s)}`))));
    const free = [...now.byShop].filter(([, e]) => e.shipsFree).map(([s]) => s);
    const freeNote = free.length ? h("p", { class: "ax-sum-free" }, `${free.join(", ")}: shipping is in the price.`) : null;
    fill(sumAside,
      h("div", { class: "ax-sum-top" },
        h("div", { class: "ax-sum-label" }, changedLines ? "Batch total with your picks" : "Batch total"),
        h("div", { class: "ax-sum-total ax-num", tabindex: "-1", "data-total": now.total }, usd(now.total)),
        h("div", { class: "ax-sum-unit" }, units > 1 ? `${usd(now.total / units)} a unit, ${units} units` : "1 unit"),
        ex.budgetUsd != null ? h("div", { class: "ax-sum-budget", "data-state": status }, h("span", { class: "ax-dot" }), budgetText(now.total)) : null),
      changedLines ? h("div", { class: "ax-delta" },
        h("div", { class: "ax-delta-head" }, h("strong", { class: "ax-num", "data-delta": d }, `${signed(d)} vs the quote`),
          h("span", { class: "ax-muted" }, `Quote ${usd(quoted0.total)}, ${plural(changedLines, "line")} changed`)),
        rows.length ? h("dl", { class: "ax-delta-rows" }, rows.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", { class: "ax-num" }, signed(v))))) : null,
        h("button", { class: "ax-btn", type: "button", "data-reset": "" }, icon("reset"), "Reset to the quote")) : null,
      h("dl", { class: "ax-sum-rows" },
        h("div", null, h("dt", null, "Parts and fab"), h("dd", { class: "ax-num" }, usd(now.parts))),
        h("div", null, h("dt", null, `Shipping, ${plural(now.shipping.length, "shop")}${allEst ? ", est." : ""}`), h("dd", { class: "ax-num" }, usd(now.shipUsd)))),
      shipList,
      freeNote,
      h("dl", { class: "ax-sum-rows ax-sum-foot" },
        h("div", null, h("dt", null, "Longest lead"), h("dd", null, plural(now.lead.days, "day"))),
        ex.totals.unquoted.length ? h("div", null, h("dt", null, "Not priced"), h("dd", null, ex.totals.unquoted.join(", "))) : null,
        ex.costNotes?.length ? h("div", null, h("dt", null, "Not in it"), h("dd", null, `${plural(ex.costNotes.length, "cost")}, under the BOM`)) : null),
      stale ? h("p", { class: "ax-note ax-warn" }, `The quote is out of date: quotes.json says ${usd(ex.totals.batchUsd)}, and its picks add up to ${usd(quoted0.total)} here. Ask Claude to requote the run.`) : null);
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
              sumRow("Shipping", e.shipsFree ? (e.rows.every((r) => r.line.process === "pcb") ? "In the price" : "None") : `${usd(ship)}${est(s)}`),
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
            h("span", { class: "ax-sub" }, `${usd(ex.shipping[s] ?? 0)}${est(s)} shipping`),
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

  /** How the score compares the run with a known-good build: in Design's checks as tabs, in Build on the page. */
  function scoreBlock() {
    const s = ex.score;
    if (!(s && s.cost && s.coverage)) return null;
    const files = Array.isArray(s.files) ? s.files : [];
    return [
      h(H3, { class: "ax-h3" }, "Against a known-good build"),
      h("p", { class: "ax-note" }, `The run is scored against a working ${ex.product} built from parts: it passes when every number below is in range.`),
      h("dl", { class: "ax-score" },
        h("div", null, h("dt", null, "Parts covered"), h("dd", null, `${s.coverage.pct}%`), h("span", { class: "ax-sub" },
          s.coverage.missing?.length ? `Missing: ${s.coverage.missing.join(", ")}` : "Every part the reference has")),
        h("div", null, h("dt", null, "Cost"), h("dd", null, `${s.cost.deltaPct > 0 ? "+" : ""}${numFmt.format(s.cost.deltaPct)}%`), h("span", { class: "ax-sub" },
          `${usd(s.cost.batchUsd)} vs ${usd(s.cost.referenceMidUsd)}, ${s.cost.withinBand ? "within" : "outside"} the ±25% band` +
          (s.cost.unpriced?.length ? `; no price for ${s.cost.unpriced.join(", ")}, so the total leaves ${s.cost.unpriced.length === 1 ? "it" : "them"} out` : ""))),
        h("div", null, h("dt", null, "Failed checks"), h("dd", null, String(s.checks?.failed ?? 0)), h("span", { class: "ax-sub" },
          (typeof s.checks?.ran === "number" ? `${s.checks.ran} run, ` : "") + `${s.checks?.flagged ?? 0} flagged for a person`)),
        h("div", null, h("dt", null, "Files"), h("dd", null, `${files.filter((f) => f.ok).length} of ${files.length}`), h("span", { class: "ax-sub" },
          files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.detail}`).join("; ") || "All ready")),
        // A score from before the whole-product check has no system field: it was never run.
        h("div", null, h("dt", null, "Whole product"),
          h("dd", null, !s.system ? "Not run" : s.system.ok ? "Passes" : s.system.failed?.length ? `Fails ${s.system.failed.length}` : "Not checked"),
          h("span", { class: "ax-sub" }, s.system ? s.system.detail : "This run is from before the whole-product check")),
        // Seeded faults (sprue faults) check the checks; a product with no reference/faults.json has none, and isn't
        // held to them. Counts only for a report of the product and gates as they are, as sprue status.
        ...(s.faults ? [h("div", null, h("dt", null, "Seeded faults"), h("dd", null, faultsWord(s.faults).word),
          h("span", { class: "ax-sub" }, s.faults.detail))] : [])),
      // A score from before the whole-product check, or from before the seeded faults counted, passed without them: it
      // doesn't pass now.
      h("p", { class: "ax-verdict", "data-pass": String(!!(s.pass && s.system?.ok && (!s.faults || s.faults.ok))) },
        s.pass && s.system?.ok && (!s.faults || s.faults.ok) ? "Passes against the reference." : "Not passing yet."),
    ];
  }

  // ---- 4 build: the assembly steps, the order list, the files
  const leadEl = h("div", { class: "ax-lead" });
  /** The figure's steps under Build, by position (1 is the first step), and the one the figure shows. */
  const figStepEls = [];
  let figAt = 0;
  {
    const files = ex.lines.filter((l) => l.file && (l.made || l.process !== "buy"));
    const production = Array.isArray(ex.production) && ex.production.length ? ex.production : null;
    const fileState = new Map((Array.isArray(ex.score?.files) ? ex.score.files : []).map((f) => [f.name, f]));
    const missing = [...fileState.values()].filter((f) => !f.ok).map((f) => String(f.name));
    // A step that names a file (or the folder of a file) that isn't generated yet can't be done yet.
    const blockedBy = (step) => missing.filter((f) => step.includes(f) || (f.includes("/") && step.includes(f.slice(0, f.indexOf("/") + 1))));
    const steps = ex.assembly.map((s) => {
      const by = blockedBy(s);
      return h("li", { "data-blocked": by.length ? "" : null }, h("span", null, ticks(s),
        by.length ? h("span", { class: "ax-sub ax-file-missing" }, `Blocked: ${by.join(", ")} ${by.length === 1 ? "is" : "are"} not generated yet.`) : null));
    });
    const planBtn = ex.buildPlanMd
      ? h("button", { class: "ax-btn ax-btn-sm", type: "button", "data-download": "build-plan.md" }, "Download build-plan.md")
      : null;
    // A first-article run orders twice: order A for the first units, order B for the rest (quotes.json phases).
    const phases = ex.phases ?? [];
    const both = phases.reduce((t, p) => t + p.batchUsd, 0);
    const orders = phases.length ? h("div", { class: "ax-files ax-orders" },
      h(H3, { class: "ax-h3" }, "Order in two phases, as quoted"),
      h("ul", null, phases.map((p) => h("li", null,
        h("span", null, `Order ${p.name}: ${plural(p.units, "unit")}${p.name === "B" ? " and the spares" : ""}`),
        h("span", { class: "ax-num" }, ` ${usd(p.batchUsd)}`),
        h("span", { class: "ax-sub" }, `${plural(p.longestLeadDays, "day")} lead · `, h("code", null, p.file))))),
      h("p", { class: "ax-note" }, `Build and check the first units before order B. As quoted, two orders cost ${usd(both)}, ${usd(both - ex.totals.batchUsd)} more than one; picks in the BOM don't change these.`)) : null;
    const notes = costNotesBlock("Not in the total");

    // The figure's steps, each with the parts it puts on: choosing one shows it in the figure above. The count is
    // the step's own (figure.json counts), so screws split between two steps read 4 and 6, not 10 and 10; the second
    // half of a split part (count 0) is named without one. As stepParts() in stages/plan.ts writes the build plan.
    const name = (st, lid) => {
      const l = ex.lines.find((x) => x.id === lid);
      if (!l) return lid;
      if (!l.qtyPerUnit && l.qtyPerBatch) return `${l.name} (${numFmt.format(l.qtyPerBatch)} for the batch)`;
      const once = fig.steps.filter((f) => f.lines?.includes(lid)).length === 1;
      const n = st.counts?.[lid] ?? (once ? l.qtyPerUnit : 0);
      return n > 0 ? `${numFmt.format(n)} × ${l.name}` : l.name;
    };
    const drawnSteps = stages && fig && fig.steps.length ? h("div", { class: "ax-figsteps-wrap" },
      h(H3, { class: "ax-h3 ax-h3-split", id: id("part-steps") }, h("span", null, "Assembly, as drawn"),
        h("button", { class: "ax-textbtn ax-figwhole", type: "button", "data-fig-step": "0", hidden: true }, "Show it whole")),
      h("p", { class: "ax-note" }, "Choose a step to see it in the figure. The figure's own step buttons and the arrow keys move this list too."),
      h("ol", { class: "ax-figsteps" }, fig.steps.map((st, k) => {
        const btn = h("button", { class: "ax-figstep", type: "button", "data-fig-step": String(k + 1), "aria-pressed": "false" },
          h("span", { class: "ax-figstep-n ax-num" }, String(k + 1)),
          h("span", { class: "ax-figstep-t" }, st.text,
            st.lines?.length ? h("span", { class: "ax-sub" }, st.lines.map((lid) => name(st, lid)).join(", ")) : null));
        figStepEls.push(btn);
        return h("li", null, btn);
      }))) : null;
    // Under the figure's steps, the written ones fold away on the product page: they are long, and in build-plan.md.
    const written = ex.assembly.length
      ? drawnSteps
        ? [h3("plan", "Every step, as written"),
          h("details", { class: "ax-written" },
            h("summary", null, `${plural(ex.assembly.length, "step")}, with what the figure doesn't draw, such as ordering the parts and testing`),
            h("ol", { class: "ax-steps" }, steps))]
        : [h3("plan", "Assembly steps"), h("ol", { class: "ax-steps" }, steps)]
      : [h3("plan", "Assembly steps"), h("p", { class: "ax-note" }, "No assembly steps in this run yet.")];
    const b = panels.build.body;
    if (!planned)
      add(b, notYet("Not started. Once the quote is accepted, Claude writes the build plan, the order list and the fab files, and they show here."));
    else
      add(b, earlier("build", "this plan", "the quote"),
        h("div", { class: "ax-wide ax-plan" },
          h("div", null,
            missing.length ? h("p", { class: "ax-note ax-warn ax-plan-warn" }, `Not ready to order everything yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not generated.`) : null,
            drawnSteps,
            written,
            stages && quoted ? orderList() : null,
            notes),
          h("aside", { class: "ax-plan-side" }, leadEl, orders,
            files.length ? h("div", { class: "ax-files" },
              h(H3, { class: "ax-h3" }, "Files for the fabs"),
              h("ul", null, files.map((l) => {
                const st = fileState.get(l.file);
                const step = l.file.replace(/\.stl$/i, ".step");
                const hasStep = step !== l.file && production?.includes(step.split("/").pop());
                return h("li", { "data-missing": st && !st.ok ? "" : null }, h("code", null, l.file), hasStep ? [" and ", h("code", null, step.split("/").pop())] : null,
                  h("span", { class: "ax-sub" }, `${l.name}${l.made ? `, ${l.made.supplier}` : ""}`),
                  st && !st.ok ? h("span", { class: "ax-sub ax-file-missing" }, st.detail.charAt(0).toUpperCase() + st.detail.slice(1)) : null);
              })),
              production ? h("p", { class: "ax-note" }, h("code", null, `products/${ex.slug}/production/`), ` has ${production.join(", ")}.`) : null) : null,
            h("div", { class: "ax-plan-file" },
              options.compact
                ? h("p", { class: "ax-note" }, "The full plan has the order list and the checks too.")
                : h("p", { class: "ax-note" }, "The full plan, with the order list and the checks, is in ", h("code", null, `products/${ex.slug}/build-plan.md`), "."),
              planBtn))),
        stages ? scoreBlock() : null);
  }

  /** What to put in each cart, as the quote has it: the same rows as production/order-list.csv. */
  function orderList() {
    const rows = ex.lines.map((l, i) => {
      const o = l.made ?? l.options[quoteChoice[i]];
      if (!o) return null;
      const pack = !l.made && o.packSize > 1 ? o.packSize : 0;
      const packs = pack ? Math.max(1, Math.round(o.orderQty / pack)) : 0;
      return h("tr", { "data-line-id": l.id },
        h("td", null, l.name, h("span", { class: "ax-sub" }, `${o.supplier} · ${o.sku}`)),
        h("td", { class: "ax-num" }, numFmt.format(needOf(l, units))),
        h("td", { class: "ax-num" }, pack ? `${plural(packs, "pack")} of ${numFmt.format(pack)}` : numFmt.format(o.orderQty)),
        h("td", { class: "ax-num" }, usd(o.orderUsd)));
    }).filter(Boolean);
    const b = quoted0;
    return h("div", { class: "ax-orderlist" },
      h(H3, { class: "ax-h3" }, "Order list"),
      h("p", { class: "ax-note" }, "What goes in each cart, as the quote has it: pieces the batch needs, and what to buy. ",
        ex.production?.includes("order-list.csv") ? ["It is ", h("code", null, `products/${ex.slug}/production/order-list.csv`), ". "]
          : ["It is ", h("code", null, "production/order-list.csv"), " once the package is written. "],
        "Nothing has been ordered."),
      h("table", { class: "ax-order-t" },
        h("caption", { class: "ax-sr" }, "Order list"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Part and shop"), h("th", { scope: "col", class: "ax-num" }, "Need"),
          h("th", { scope: "col", class: "ax-num" }, "Buy"), h("th", { scope: "col", class: "ax-num" }, "Cost"))),
        h("tbody", null, rows),
        h("tfoot", null,
          h("tr", null, h("th", { scope: "row", colspan: "3" }, `Shipping, ${plural(b.shipping.length, "shop")}${allEst ? ", estimated" : ""}`), h("td", { class: "ax-num" }, usd(b.shipUsd))),
          h("tr", { class: "ax-order-total" }, h("th", { scope: "row", colspan: "3" }, "Batch total"), h("td", { class: "ax-num" }, usd(b.total))))));
  }

  function renderLead() {
    const q = quoted0.lead.days;
    fill(leadEl,
      h("div", { class: "ax-sum-label" }, "Longest lead"),
      h("div", { class: "ax-lead-v ax-num" }, plural(now.lead.days, "day")),
      h("p", { class: "ax-sub" }, now.lead.line ? `Set by ${now.lead.line.name} from ${now.lead.supplier}. If the listed lead times hold, ordering everything on day one gets it all by then.` : ""),
      now.lead.days !== q ? h("p", { class: "ax-sub" }, `The quote's picks take ${plural(q, "day")}.`) : null);
  }

  // ---- the figure on the same page: a2:select, a2:hover and a2:step, both ways
  let pinned = null;
  let pointed = null;
  const emit = (type, detail) => element.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  /** Light every row of the line pointed at, or else the one pinned. */
  function paintLit() {
    const lit = pointed ?? pinned;
    for (const el of element.querySelectorAll("[data-line-id]")) {
      const lid = el.getAttribute("data-line-id");
      el.toggleAttribute("data-a2-on", lid === lit);
      if (el.hasAttribute("data-part-line")) el.setAttribute("aria-pressed", String(lid === pinned));
    }
  }
  function point(line) {
    if (line === pointed) return;
    pointed = line;
    paintLit();
    emit("a2:hover", { line });
  }
  function pin(line) {
    pinned = line;
    paintLit();
    emit("a2:select", { line });
  }
  function paintStep() {
    figStepEls.forEach((b, k) => b.setAttribute("aria-pressed", String(k + 1 === figAt)));
    const whole = element.querySelector(".ax-figwhole");
    if (whole) /** @type {HTMLElement} */ (whole).hidden = !figAt;
  }
  const fromOutside = (e) => !(e.target instanceof Node && element.contains(e.target));
  on(document, "a2:select", (e) => {
    if (!fromOutside(e)) return;
    pinned = e.detail?.line ?? null;
    paintLit();
  });
  on(document, "a2:hover", (e) => {
    if (!fromOutside(e)) return;
    pointed = e.detail?.line ?? null;
    paintLit();
  });
  on(document, "a2:step", (e) => {
    if (!fromOutside(e)) return;
    figAt = Math.max(0, Number(e.detail?.n) || 0);
    paintStep();
  });
  const lineAt = (t) => (t instanceof Element ? t.closest("[data-line-id]")?.getAttribute("data-line-id") ?? null : null);
  on(element, "pointerover", (e) => {
    if (e.pointerType !== "touch") point(lineAt(e.target));
  });
  on(element, "pointerleave", () => point(null));
  on(element, "focusin", (e) => point(lineAt(e.target)));
  on(element, "focusout", (e) => {
    if (!lineAt(e.relatedTarget)) point(null);
  });

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

  /** Show a stage (its tab, or its section in the stages layout); with focus "panel", scroll to it, or to one
   * part of it ("bom", "suppliers", "checks", "plan"). */
  function select(tab, focus, part) {
    const t = tabOf(tab);
    if (!t) return;
    if (!part && t !== tab) part = tab;
    if (!stages) {
      current = t;
      for (const b of tablist.querySelectorAll("[role=tab]")) {
        const sel = b.getAttribute("data-tab") === t;
        b.setAttribute("aria-selected", String(sel));
        b.setAttribute("tabindex", sel ? "0" : "-1");
        if (sel && focus === "tab") /** @type {HTMLElement} */ (b).focus();
      }
      for (const [k, p] of Object.entries(panels)) p.el.hidden = k !== t;
    }
    if (focus !== "panel") return;
    const target = (part && partEls[part]) || null;
    if (target) {
      target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    } else {
      const top = stages ? panels[t].el : tablist;
      if (top.getBoundingClientRect().top < 0 || stages) top.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      panels[t].el.focus?.({ preventScroll: true });
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
    pin(r.line.id);
  }

  if (tablist)
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
    if ((x = hit("[data-goto]"))) return select(x.getAttribute("data-goto"), "panel", x.getAttribute("data-goto-part") ?? undefined);
    if ((x = hit("[data-part-line]"))) {
      const lid = x.getAttribute("data-part-line");
      return pin(lid === pinned ? null : lid);
    }
    if ((x = hit("[data-fig-step]"))) {
      const n = Number(x.getAttribute("data-fig-step"));
      figAt = n && n === figAt ? 0 : n;
      paintStep();
      emit("a2:step", { n: figAt });
      return;
    }
    if ((x = hit("[data-reset]"))) {
      // Keep focus where the person is: the sticky bar's total on narrow layouts, the summary card's when it is the sticky one.
      const fromBar = !!x.closest(".ax-sumbar") && getComputedStyle(sumBar).display !== "none";
      pins.clear();
      choice = quoteChoice.slice();
      update(true);
      /** @type {HTMLElement | null} */ ((fromBar ? sumBar : sumAside).querySelector(fromBar ? ".ax-sumbar-total" : ".ax-sum-total"))?.focus({ preventScroll: true });
      return;
    }
    if ((x = hit("[data-reset-line]"))) {
      const i = Number(x.getAttribute("data-reset-line"));
      pins.delete(i);
      choice = quoteWith(pins).choice.map((c, k) => (c < 0 && !ex.lines[k].made ? quoteChoice[k] : c));
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
    if ((x = hit("[data-more-checks]"))) {
      // Part checks under Design or assembly checks under Inspect: the list the button names.
      const passes = element.querySelectorAll(`#${x.getAttribute("data-more-checks")} .ax-check[data-status="pass"]`);
      const open = x.getAttribute("aria-expanded") !== "true";
      passes.forEach((c) => { /** @type {HTMLElement} */ (c).hidden = !open; });
      x.setAttribute("aria-expanded", String(open));
      x.textContent = open ? "Hide the passing checks" : `Show the ${passes.length} passing checks`;
      return;
    }
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
      const r = rowRefs.get(i);
      const open = r.detail.hidden;
      setOpen(i, open);
      // Opening a line lights its part in the figure; closing the lit one lets it go.
      if (open) pin(r.line.id);
      else if (pinned === r.line.id) pin(null);
    }
  });

  on(element, "change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "radio" || !t.hasAttribute("data-line")) return;
    const i = Number(t.getAttribute("data-line"));
    pickOffer(i, Number(t.value));
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
  paintStep();
  const view = { destroy, select: (tab) => select(tab) };
  mounted.set(element, view);
  return view;
}
