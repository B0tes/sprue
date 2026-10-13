// Stage 1's picture. products/<slug>/figure.mjs (written by Claude) draws the product with the Anatomy kit;
// this harness runs it and writes, in products/<slug>/:
//   figure.svg   the bare <svg>: one <g class="a2-part"> per fig.part() call, tagged with its BOM line,
//                assembly step and apart offset, so viewer/figure.js can light it and take it apart
//   figure.json  size, title, steps, parts, which BOM lines are drawn, and which are left out and why
//   figure.html  a standalone page to open right away: the card, the controls, the parts list
// figure.mjs:
//   export default function draw({ k, G, T, fig, params, bom, design }) { ...; return { title, hint?, caption? } }
// `anatomy figure <slug>` proposes the design (stage 1's gate); `--draft` writes the same files without proposing,
// for the passes Claude makes while it is still drawing.
// World units are millimetres, x and y on the floor, z up; otherwise Anatomy's conventions.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as T from "../kit/tube.mjs";
import { exists, productDir, readJson, writeJson, writeText } from "./io.ts";
import { autoPropose, gateOf, readState, STAGES, type State } from "./state.ts";
import type { Bom, Checks, Design, Quotes, Request } from "./types.ts";

type Vec3 = [number, number, number];
type Projection = ReturnType<typeof k.fitProjection>;
type Svg = string | string[];
type Part = { line: string; svg: string; step: number; lift: Vec3; count: number };
/** What the harness paints, in call order: the parts, and the x-ray outlines placed between them. */
type Item = { part: Part } | { raw: string };

export type FigureJson = {
  width: number;
  height: number;
  title: string;
  hint: string;
  caption: string;
  steps: { n: number; text: string; lines: string[] }[];
  parts: { line: string; step: number; count: number; dx: number; dy: number }[];
  coverage: Record<string, { drawn: number; needed: number }>;
  hidden: Record<string, string>;
};

export type FigureBuild = { figure: FigureJson; svg: string; problems: string[]; warnings: string[]; notes: string[] };

const SKILL = join(import.meta.dirname, "..");
export const DEFAULT_HINT = "Hover a part · E apart · ← → steps";
const round2 = (x: number) => Math.round(x * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The `fig` object figure.mjs draws with. */
function harness(bom: Bom) {
  let width = 640;
  let height = 480;
  let P: Projection | undefined;
  const under: string[] = [];
  const over: string[] = [];
  const parts: Part[] = [];
  const items: Item[] = [];
  const hidden: Record<string, string> = {};
  const stepText = new Map<number, string>();
  const problems: string[] = [];
  const known = new Set(bom.lines.map((l) => l.id));
  const text = (svg: Svg) => (Array.isArray(svg) ? svg.join("") : String(svg ?? ""));
  const whole = (n: unknown, from: number) => Number.isInteger(n) && (n as number) >= from;

  const fig = {
    get width() { return width; },
    get height() { return height; },
    get P() { return P; },
    /** Card size in px; before camera(). Default 640 x 480. */
    size(w: number, h: number) {
      if (P) throw new Error("fig.size(w, h) must come before fig.camera(points)");
      if (!(w > 0 && h > 0)) throw new Error(`fig.size(${w}, ${h}): width and height must be positive`);
      width = w;
      height = h;
    },
    /** Fit the camera to world points (mm). Include the apart pose, so the exploded product fits the card too. */
    camera(points: Vec3[], opts: { pad?: number; headroom?: number; azimuth?: number; elevation?: number } = {}) {
      if (!Array.isArray(points) || !points.length) throw new Error("fig.camera(points): give the world corners of the product, assembled and apart");
      P = k.fitProjection(points, width, height, { pad: 30, azimuth: 45, ...opts });
      return P;
    },
    /** Drawn first and never a part: halos, a bench mat. */
    under(svg: Svg) { under.push(text(svg)); },
    /** Drawn last and never a part. */
    over(svg: Svg) { over.push(text(svg)); },
    /** `count` instances of BOM line `line`, put in at assembly step `step`, moved by `lift` (mm) in the apart pose. */
    part(line: string, svg: Svg, opts: { step: number; lift?: Vec3; count?: number }) {
      const { step, lift = [0, 0, 0] as Vec3, count = 1 } = opts ?? ({} as { step: number });
      const where = `fig.part("${line}")`;
      if (!known.has(line)) problems.push(`${where}: no BOM line with that id (lines: ${[...known].join(", ")})`);
      if (!whole(step, 1)) problems.push(`${where}: step must be a whole number from 1, got ${JSON.stringify(step)}`);
      const goodLift = Array.isArray(lift) && lift.length === 3 && lift.every((v) => Number.isFinite(v));
      if (!goodLift) problems.push(`${where}: lift must be [x, y, z] in mm, got ${JSON.stringify(lift)}`);
      if (!whole(count, 0)) problems.push(`${where}: count must be a whole number, got ${JSON.stringify(count)}`);
      const part = { line, svg: text(svg), step: whole(step, 1) ? step : 1, lift: goodLift ? lift as Vec3 : [0, 0, 0] as Vec3, count: whole(count, 0) ? count : 1 };
      parts.push(part);
      items.push({ part });
    },
    /** The outline of BOM line `line` where other parts hide it, painted here in call order: after the parts that
     * hide it (`by`), before the nearer ones, so they still cover it. The page shows it only while the line is lit
     * and one of `by` is in place, and moves it with the line's part. */
    xray(line: string, svg: Svg, { by = [] as string[] } = {}) {
      const where = `fig.xray("${line}")`;
      if (!known.has(line)) problems.push(`${where}: no BOM line with that id`);
      const bad = (Array.isArray(by) ? by : []).filter((id) => !known.has(id));
      if (!Array.isArray(by)) problems.push(`${where}: by must be a list of BOM line ids`);
      else if (bad.length) problems.push(`${where}: by names no BOM line ${bad.join(", ")}`);
      const hiders = Array.isArray(by) ? by.filter((id) => known.has(id)) : [];
      items.push({ raw: `<g data-a2-xray="${esc(line)}"${hiders.length ? ` data-a2-xray-by="${esc(hiders.join(" "))}"` : ""} display="none">${text(svg)}</g>` });
    },
    /** A BOM line that is not drawn (firmware, glue, a spare), and why. */
    hidden(line: string, why: string) {
      if (!known.has(line)) problems.push(`fig.hidden("${line}"): no BOM line with that id`);
      hidden[line] = String(why ?? "");
    },
    /** The caption of assembly step n, e.g. "Press the four inserts into the lid". */
    step(n: number, caption: string) {
      if (!whole(n, 1)) problems.push(`fig.step(${JSON.stringify(n)}): n must be a whole number from 1`);
      else stepText.set(n, String(caption ?? ""));
    },
  };
  return { fig, result: () => ({ width, height, P, under, over, parts, items, hidden, stepText, problems }) };
}

const and = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Runs products/<slug>/figure.mjs. Throws if it is missing or its draw() throws; collects every other problem. */
export async function buildFigure(slug: string): Promise<FigureBuild> {
  const file = join(productDir(slug), "figure.mjs");
  if (!existsSync(file)) throw new Error(`no products/${slug}/figure.mjs: write one that exports default function draw({ k, G, T, fig, params, bom, design })`);
  if (!exists(slug, "bom.json")) throw new Error(`no products/${slug}/bom.json yet: the figure draws its lines, so write the BOM first`);
  const bom = readJson<Bom>(slug, "bom.json");
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : ({ params: {} } as unknown as Design);
  const request = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const { fig, result } = harness(bom);
  // Cache-busted, so a second build in one process (anatomy all) sees an edited file.
  const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  if (typeof mod.default !== "function")
    throw new Error(`products/${slug}/figure.mjs must \`export default function draw({ k, G, T, fig, params, bom, design })\``);
  const out = ((await mod.default({ k, G, T, fig, params: design.params ?? {}, bom, design })) ?? {}) as { title?: string; hint?: string; caption?: string };
  const r = result();
  // One wrong id in a loop makes the same problem many times: say it once, with how many calls made it.
  const counts = new Map<string, number>();
  for (const p of r.problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  const problems = [...counts].map(([p, n]) => (n > 1 ? `${p} (${n} calls)` : p));
  const warnings: string[] = [];
  const notes: string[] = [];
  if (!r.P) throw new Error("figure.mjs never called fig.camera(points)");
  const P = r.P;
  const origin = k.iso([0, 0, 0], P);
  const offset = (p: Part) => {
    const [x, y] = k.iso(p.lift, P);
    return { dx: round2(x - origin[0]), dy: round2(y - origin[1]) };
  };
  const placed = r.parts.map((p) => ({ ...p, ...offset(p) }));

  const coverage: FigureJson["coverage"] = {};
  for (const l of bom.lines) {
    const calls = placed.filter((p) => p.line === l.id);
    const drawn = calls.reduce((sum, p) => sum + p.count, 0);
    const needed = l.qtyPerUnit || 1;
    coverage[l.id] = { drawn, needed };
    if (!calls.length && !(l.id in r.hidden)) problems.push(`${l.id} (${l.name}) is neither drawn nor hidden: add fig.part("${l.id}", ...) or fig.hidden("${l.id}", why)`);
    if (calls.length && l.id in r.hidden) warnings.push(`${l.id} is drawn and also hidden; drop one`);
    if (calls.length && drawn !== needed) warnings.push(`${l.id}: drawn ${drawn}, the BOM needs ${needed} per unit`);
  }

  const name = (id: string) => bom.lines.find((l) => l.id === id)?.name ?? id;
  const numbers = [...new Set([...placed.map((p) => p.step), ...r.stepText.keys()])].sort((a, b) => a - b);
  const steps = numbers.map((n) => {
    const ids = [...new Set(placed.filter((p) => p.step === n).map((p) => p.line))];
    if (!ids.length) warnings.push(`fig.step(${n}) has no parts`);
    let text = r.stepText.get(n);
    if (!text) {
      text = `Fit the ${and(ids.map(name))}`;
      notes.push(`step ${n} has no caption, so it reads "${text}"; add fig.step(${n}, "...")`);
    }
    return { n, text, lines: ids };
  });
  if (numbers.length && numbers.some((n, i) => n !== i + 1)) notes.push(`steps are ${numbers.join(", ")}; the page counts them 1 to ${numbers.length}`);

  const title = out.title || request?.product || slug;
  const caption = out.caption ?? design.summary ?? "";
  const figure: FigureJson = {
    width: r.width,
    height: r.height,
    title,
    hint: out.hint || DEFAULT_HINT,
    caption,
    steps,
    parts: placed.map((p) => ({ line: p.line, step: p.step, count: p.count, dx: p.dx, dy: p.dy })),
    coverage,
    hidden: r.hidden,
  };
  const groups = r.items.map((item) => {
    if ("raw" in item) return item.raw;
    const p = item.part, { dx, dy } = offset(p);
    return `<g class="a2-part" data-line="${esc(p.line)}" data-step="${p.step}" data-count="${p.count}" data-dx="${dx}" data-dy="${dy}">${p.svg}</g>`;
  });
  const svg = k.figureSvg({ width: r.width, height: r.height, label: caption ? `${title}. ${caption}` : title,
    body: [...r.under, ...groups, ...r.over], className: undefined });
  return { figure, svg, problems, warnings, notes };
}

// ---- the standalone page ------------------------------------------------------------------------

/** ISO_CSS's light block again under prefers-color-scheme: the page is dark unless the system is light. */
function lightUnderMedia() {
  const block = k.ISO_CSS.match(/\.iso\[data-theme="light"\]\{([^}]*)\}/);
  return block ? `@media (prefers-color-scheme:light){html{color-scheme:light}.iso[data-theme="auto"]{${block[1]}}}` : "";
}

const PAGE_CSS = `
.a2-head{margin-bottom:28px}
.a2-kicker{margin:0 0 10px;color:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
.a2-title{margin:0;color:var(--anatomy-strong);font-size:22px;font-weight:500;line-height:1.25;letter-spacing:-.01em}
.a2-brief{margin:8px 0 0;color:var(--anatomy-text)}
.a2-gates{display:flex;flex-wrap:wrap;gap:8px 22px;margin:18px 0 0;padding:0;list-style:none;font-family:var(--anatomy-mono);font-size:11px;letter-spacing:.06em}
.a2-gate{display:flex;align-items:baseline;gap:8px;color:var(--anatomy-muted)}
.a2-gate b{font-weight:400;color:var(--anatomy-text);text-transform:uppercase;letter-spacing:.1em}
.a2-gate[data-current] b{color:var(--anatomy-strong)}
.a2-gate[data-current]::before{content:"";width:6px;height:6px;align-self:center;background:var(--anatomy-lit);transform:rotate(45deg)}
.a2-gate[data-status="accepted"] i::before{content:"✓ "}
.a2-gate i{font-style:normal}
[data-a2-figure] .iso-figure{margin:0}
.a2-caption{margin:22px 0 0;color:var(--anatomy-muted);font-size:13px;line-height:1.6}
.a2-gate-note{margin:30px 0 0;padding-top:14px;box-shadow:inset 0 1px 0 var(--anatomy-faint);color:var(--anatomy-text);font-size:13px;line-height:1.6}
.a2-gate-note code{color:var(--anatomy-strong);font-family:var(--anatomy-mono);font-size:12px;overflow-wrap:anywhere}
.a2-before{margin:30px 0 0;padding-top:14px;box-shadow:inset 0 1px 0 var(--anatomy-faint)}
.a2-before h2{margin:0 0 6px;color:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:10.5px;font-weight:400;letter-spacing:.1em;text-transform:uppercase}
.a2-before ul{margin:0;padding:0;list-style:none;color:var(--anatomy-text);font-size:13px;line-height:1.6}
.a2-before li{padding:2px 0}
.a2-before b{font-weight:500;color:var(--anatomy-strong)}
.a2-before + .a2-gate-note{margin-top:18px}
`;

const STAGE_WORDS = { design: "the design", source: "the parts and the quote", build: "the build plan and package" } as const;

/** The line under the page: where the run is and what the user can say next, from state.json. */
function gateNote(slug: string, state: State) {
  const cmd = (s: string) => `<code>/anatomy-2 ${esc(s)}</code>`;
  if (state.stage === "done") return "Every stage is accepted: the design, the parts and the quote, and the build package. Nothing has been ordered.";
  const g = state.stages[state.stage];
  const n = STAGES.indexOf(state.stage) + 1;
  if (g?.status === "declined")
    return `Stage ${n}, ${STAGE_WORDS[state.stage]}, was declined${g.note ? `: ${esc(g.note)}` : ""}. Tell Claude what to change, and it redoes it here.`;
  if (g?.status === "proposed") {
    if (state.stage === "design")
      return `This is the proposed design. Accept it, change it or decline it in Claude Code: ${cmd(`accept ${slug}`)}, ${cmd(`edit ${slug} <change>`)} or ${cmd(`decline ${slug} <why>`)}. Once it is accepted, the run moves on to finding the parts and the quote. Nothing is ordered.`;
    return `The design is accepted, and ${STAGE_WORDS[state.stage]} ${state.stage === "source" ? "are" : "is"} ready for your review: ${cmd(`accept ${slug}`)}, ${state.stage === "source" ? `${cmd(`swap ${slug} <line>`)}, ` : ""}${cmd(`edit ${slug} <change>`)} or ${cmd(`decline ${slug} <why>`)}. Nothing is ordered.`;
  }
  if (state.stage === "design") return "This design is still being drawn. Reload the page when Claude says it is ready.";
  return `The design is accepted. Next: ${STAGE_WORDS[state.stage]} (${cmd(`next ${slug}`)}). Nothing is ordered.`;
}

/** At gate 1, what to know before accepting: the checks that failed or are flagged, and the numbers still estimated. */
function beforeAccept(slug: string, design: Design | undefined, bom: Bom) {
  const bits: string[] = [];
  const bought = bom.lines.filter((l) => l.process === "buy");
  const madeLines = bom.lines.filter((l) => l.process !== "buy");
  const how: Record<string, string> = { pcb: "PCB", print: "printed", cnc: "machined", sheet: "sheet metal" };
  const kinds = [...new Set(madeLines.map((l) => l.process))].map((p) => `${madeLines.filter((l) => l.process === p).length} ${how[p] ?? p}`);
  bits.push(`<li>${bom.lines.length} lines: ${bought.length} bought (${bought.reduce((n, l) => n + l.qtyPerUnit, 0)} parts), ${madeLines.length} made (${esc(kinds.join(", "))}).</li>`);
  if (exists(slug, "checks.json")) {
    const c = readJson<Checks>(slug, "checks.json");
    bits.push(`<li>Engineer checks: ${c.checks.length} run, ${c.failed} failed, ${c.flagged} flagged.</li>`);
    for (const x of c.checks.filter((x) => x.status !== "pass"))
      bits.push(`<li class="a2-check" data-status="${x.status}"><b>${x.status === "fail" ? "Failed" : "Flagged"}:</b> ${esc(x.title)}. ${esc(x.detail)}</li>`);
  } else bits.push("<li>Engineer checks: not run yet.</li>");
  for (const e of design?.estimates ?? []) bits.push(`<li><b>Estimate:</b> ${esc(e)}</li>`);
  return `<section class="a2-before"><h2>Before you accept</h2><ul>${bits.join("")}</ul></section>`;
}

/** Each line's price in the quote, for the readout and the parts list, once the run has reached stage 2:
 * the order's cost in whole packs (before shipping), and how many that buys when it is more than the build needs. */
function pricesOf(slug: string, bom: Bom, state: State) {
  const prices: Record<string, { usd: number; qty?: number }> = {};
  if (state.stage === "design" || !exists(slug, "quotes.json")) return { prices, units: 0 };
  const quotes = readJson<Quotes>(slug, "quotes.json");
  for (const q of quotes.lines) {
    const line = bom.lines.find((l) => l.id === q.lineId);
    if (!line) continue;
    const need = line.qtyPerUnit * quotes.units;
    prices[q.lineId] = { usd: q.orderUsd, ...(q.orderQty > need ? { qty: q.orderQty } : {}) };
  }
  return { prices, units: quotes.units };
}

export function figureHtml(slug: string, built: FigureBuild): string {
  const { figure, svg } = built;
  const bom = readJson<Bom>(slug, "bom.json");
  const request = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : undefined;
  const state = readState(slug);
  const lines = Object.fromEntries(bom.lines.map((l) => [l.id, { id: l.id, name: l.name, short: l.shortName, process: l.process, qtyPerUnit: l.qtyPerUnit }]));
  const { prices, units } = pricesOf(slug, bom, state);
  const read = (f: string) => readFileSync(join(SKILL, "viewer", f), "utf8");
  const total = figure.parts.reduce((s, p) => s + p.count, 0);
  const gates = STAGES.map((s, i) => {
    const g = gateOf(state, s);
    return `<li class="a2-gate" data-status="${g?.status ?? "none"}"${state.stage === s ? " data-current" : ""}><b>${i + 1} ${s}</b><i>${g ? g.status : "not started"}</i></li>`;
  }).join("");
  const plate = k.plateHtml({
    fig: "Fig 1",
    title: figure.title,
    hint: figure.hint,
    readout: `assembled · ${total} parts`,
    body: `<div class="iso-stage a2-stage">${svg}</div>`,
    caption: undefined, // the caption goes under the parts list instead
  });
  const data = JSON.stringify({ figure, lines, prices }).replaceAll("</", "<\\/");
  const where = state.stage === "done" ? "every stage accepted" : `stage ${STAGES.indexOf(state.stage) + 1} of 3, ${state.stage}`;
  const body = [
    `<style>${read("figure.css")}${PAGE_CSS}${lightUnderMedia()}</style>`,
    `<header class="a2-head"><p class="a2-kicker">Anatomy 2.0 · products/${esc(slug)} · ${where}</p>`,
    `<h1 class="a2-title">${esc(figure.title)}</h1>`,
    request?.brief ? `<p class="a2-brief">${esc(request.brief)}</p>` : "",
    `<ol class="a2-gates" aria-label="Stages">${gates}</ol></header>`,
    `<section data-a2-figure>${plate}<div data-a2-controls></div><div data-a2-legend></div>`,
    figure.caption ? `<p class="a2-caption">${esc(figure.caption)}</p>` : "",
    Object.keys(prices).length ? `<p class="a2-caption">Prices are what each line costs in the current quote for ${units} unit(s): whole packs, before shipping. "for 20" means the pack holds more than the build uses.</p>` : "",
    `</section>`,
    state.stage === "design" ? beforeAccept(slug, design, bom) : "",
    `<p class="a2-gate-note">${gateNote(slug, state)}</p>`,
    `<script type="application/json" id="a2-figure-data">${data}</script>`,
    `<script>${read("figure.js").replace(/<\/(script)/gi, "<\\/$1")}</script>`,
  ].join("");
  const script = `const data = JSON.parse(document.getElementById("a2-figure-data").textContent);
globalThis.mountFigure(document.querySelector(".a2-stage"), data.figure, data.lines, { prices: data.prices, keys: "document" });`;
  return k.pageHtml({ title: `${figure.title} · Anatomy 2.0`, theme: "auto", body, script, width: 720 });
}

function write(slug: string, built: FigureBuild) {
  writeText(slug, "figure.svg", built.svg + "\n");
  writeJson(slug, "figure.json", built.figure);
  writeText(slug, "figure.html", figureHtml(slug, built));
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

/** Where the page is, as a path and a link to click. */
export function printPage(slug: string) {
  if (!exists(slug, "figure.html")) return;
  const page = join(productDir(slug), "figure.html");
  console.log(`page: ${page}`);
  console.log(`      ${pathToFileURL(page).href}`);
}

/** A throw inside draw() gets its stack, trimmed to the frames in the product's own files. A syntax error has
 * none (Node reports it from its own loader), so `node --check` finds the line. */
function explain(slug: string, error: unknown) {
  const file = join(productDir(slug), "figure.mjs");
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const dirs = existsSync(productDir(slug)) ? [productDir(slug), realpathSync(productDir(slug))] : [];
  const own = stack.split("\n").filter((l) => /^\s+at /.test(l) && dirs.some((d) => l.includes(d)));
  let where = own.join("\n");
  if (!own.length && existsSync(file) && (error instanceof SyntaxError || /SyntaxError/.test(stack))) {
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    where = (check.stderr || "").split("\n").filter((l) => l.trim() && !/^Node\.js v/.test(l) && !/^\s+at /.test(l)).join("\n");
  }
  console.error(`✗ figure: ${error instanceof Error ? error.message : String(error)}${where ? `\n${where}` : ""}`);
}

/** `anatomy figure <slug> [--draft]`: build, print the coverage, write the three files. False when a problem needs
 * fixing. Without --draft, a clean figure proposes the design (stage 1's gate); --draft never does. */
export async function figure(slug: string, { table = true, draft = false } = {}): Promise<boolean> {
  let built: FigureBuild;
  try {
    built = await buildFigure(slug);
  } catch (error) {
    explain(slug, error);
    return false;
  }
  const bom = readJson<Bom>(slug, "bom.json");
  const { figure: f, problems, warnings, notes } = built;
  if (table) {
    console.log(`products/${slug}/figure.mjs: ${f.parts.length} part group(s), ${f.steps.length} step(s), card ${f.width} x ${f.height}`);
    console.log(`    ${pad("line", 8)} ${pad("part", 34)} ${"drawn".padStart(5)} ${"needed".padStart(6)}  steps`);
    for (const l of bom.lines) {
      const c = f.coverage[l.id];
      const stepsOf = [...new Set(f.parts.filter((p) => p.line === l.id).map((p) => p.step))].join(",");
      const hiddenWhy = f.hidden[l.id];
      const mark = c.drawn === 0 && hiddenWhy === undefined ? "✗" : hiddenWhy !== undefined && !stepsOf ? "·" : c.drawn !== c.needed ? "⚑" : "✓";
      const tail = hiddenWhy !== undefined && !stepsOf ? `hidden: ${hiddenWhy || "(no reason given)"}` : stepsOf;
      console.log(`  ${mark} ${pad(l.id, 8)} ${pad(l.name, 34)} ${String(c.drawn).padStart(5)} ${String(c.needed).padStart(6)}  ${tail}`);
    }
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const w of warnings) console.log(`  ⚑ ${w}`);
  for (const n of notes) console.log(`  · ${n}`);
  const ok = !problems.length;
  if (ok && !draft) autoPropose(slug, "design"); // before the page is written, so it shows the gate as it now is
  write(slug, built);
  console.log(`${ok ? "wrote" : "wrote (with problems)"} products/${slug}/figure.svg, figure.json and figure.html${draft ? " (draft: the design is not proposed)" : ""}`);
  printPage(slug);
  return ok;
}

/** Rewrites figure.html after a gate or a quote changes, so its stage line and prices stay true. Silent. */
export async function refreshFigure(slug: string) {
  if (!exists(slug, "figure.html") || !exists(slug, "figure.mjs")) return;
  try {
    write(slug, await buildFigure(slug));
  } catch {
    // `anatomy figure` reports problems; a refresh only keeps the page current.
  }
}

// ---- screenshots ----------------------------------------------------------------------------------

/** `anatomy shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]` */
export function shot(slug: string, args: string[]): boolean {
  try {
    return shoot(slug, args);
  } catch (error) {
    console.error(`✗ shot: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function shoot(slug: string, args: string[]): boolean {
  const opts: { apart?: boolean; step?: number; select?: string; zoom?: string; width?: number; light?: boolean; chrome?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--apart") opts.apart = true;
    else if (a === "--light") opts.light = true;
    else if (a === "--step") opts.step = Number(value());
    else if (a === "--select") opts.select = value();
    else if (a === "--zoom") opts.zoom = value();
    else if (a === "--width") opts.width = Number(value());
    else if (a === "--chrome") opts.chrome = value();
    else throw new Error(`unknown option ${a}; usage: anatomy shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]`);
  }
  if (opts.step !== undefined && !(Number.isInteger(opts.step) && opts.step >= 0)) throw new Error("--step needs a whole number (0 is the whole product)");
  if (opts.width !== undefined && !(opts.width >= 200)) throw new Error("--width needs a number of px, e.g. 390");
  if (opts.zoom !== undefined && !/^\d+(\.\d+)?(,\d+(\.\d+)?){3}$/.test(opts.zoom)) throw new Error("--zoom needs x,y,w,h in CSS px inside the card, e.g. 200,150,160,120");
  if (!exists(slug, "figure.html")) throw new Error(`no products/${slug}/figure.html yet: run \`anatomy figure ${slug}\` first`);
  const dir = productDir(slug);
  if (exists(slug, "figure.mjs") && statSync(join(dir, "figure.mjs")).mtimeMs > statSync(join(dir, "figure.html")).mtimeMs)
    console.log(`note: figure.mjs changed after figure.html was written; run \`anatomy figure ${slug}\` to see the change`);
  if (exists(slug, "figure.json")) {
    const f = readJson<FigureJson>(slug, "figure.json");
    if (opts.step && opts.step > f.steps.length) console.log(`note: the figure has ${f.steps.length} steps; --step ${opts.step} shows the last one`);
    if (opts.select && !(opts.select in f.coverage)) console.log(`note: no BOM line "${opts.select}"; lines: ${Object.keys(f.coverage).join(", ")}`);
  }
  const hash = [opts.apart ? "apart" : "", opts.step ? `step=${opts.step}` : "", opts.select ? `select=${encodeURIComponent(opts.select)}` : ""].filter(Boolean).join("&");
  const name = [
    opts.apart ? "apart" : "",
    opts.step ? `step-${opts.step}` : "",
    opts.select ? `select-${opts.select.replace(/[^\w-]+/g, "_")}` : "",
  ].filter(Boolean).join("-") || "rest";
  const suffix = [opts.zoom ? `zoom-${opts.zoom.replaceAll(",", "-")}` : "", opts.width ? `w${opts.width}` : "", opts.light ? "light" : ""].filter(Boolean);
  const out = join(dir, "shots", `${[name, ...suffix].join("-")}.png`);
  const url = pathToFileURL(join(dir, "figure.html")).href + (hash ? `#${hash}` : "");
  const capture = join(SKILL, "kit", "scripts", "capture.mjs");
  const run = spawnSync(process.execPath, [
    capture, url, "--out", out, "--wait", "1200", "--theme", opts.light ? "light" : "dark",
    ...(opts.width ? ["--width", String(opts.width)] : []),
    ...(opts.zoom ? ["--zoom", opts.zoom] : []),
  ], { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8", env: opts.chrome ? { ...process.env, CHROME_PATH: opts.chrome } : process.env });
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    const noChrome = /No Chrome found/i.test(run.stderr ?? "");
    console.error(noChrome
      ? "✗ shot failed: no Chrome or Chromium found; pass --chrome <path to the binary> or set CHROME_PATH"
      : `✗ shot failed (capture exited ${run.status ?? run.signal}); see the lines above`);
    return false;
  }
  console.log(`shot: ${out}`);
  return true;
}
