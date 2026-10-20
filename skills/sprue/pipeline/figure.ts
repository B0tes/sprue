// Stage 1's picture. products/<slug>/figure.mjs (written by Claude) draws the product with the Anatomy kit;
// this harness runs it and writes, in products/<slug>/:
//   figure.svg   the bare <svg>: one <g class="a2-part"> per fig.part() call, tagged with its BOM line,
//                assembly step and apart offset, so viewer/figure.js can light it and take it apart
//   figure.json  size, title, steps, parts, which BOM lines are drawn, and which are left out and why
//   view.html    the product page (page.ts), to open right away: the stages, the figure as Fig 1, then
//                Design, Source and Build
// figure.mjs:
//   export default function draw({ k, G, T, fig, params, bom, design, line, spec }) { ...; return { title, hint?, caption? } }
// `sprue figure <slug>` proposes the design (stage 1's gate); `--draft` writes the same files without proposing,
// for the passes Claude makes while it is still drawing.
// World units are millimetres, x and y on the floor, z up; otherwise Anatomy's conventions.

import { existsSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as T from "../kit/tube.mjs";
import { errorText, exists, productDir, readJson, writeJson, writeText } from "./io.ts";
import { autoPropose } from "./state.ts";
import { printPage, writePage } from "./page.ts";
import type { Bom, Design, Request } from "./types.ts";

type Vec3 = [number, number, number];
type Projection = ReturnType<typeof k.fitProjection>;
type Svg = string | string[];
type Part = { line: string; svg: string; step: number; lift: Vec3; count: number };
/** What the harness paints, in call order: the parts, and the x-ray outlines placed between them. */
type Item = { part: Part } | { raw: string };
type Xray = { line: string; step?: number };

export type FigureJson = {
  width: number;
  height: number;
  title: string;
  hint: string;
  caption: string;
  /** counts: how many of each line's pieces the step puts on (the sum of its parts' counts; 0 for the second half
   * of a split part). */
  steps: { n: number; text: string; lines: string[]; counts: Record<string, number> }[];
  parts: { line: string; step: number; count: number; dx: number; dy: number }[];
  coverage: Record<string, { drawn: number; needed: number }>;
  hidden: Record<string, string>;
};

export type FigureBuild = { figure: FigureJson; svg: string; problems: string[]; warnings: string[]; notes: string[] };

const SKILL = join(import.meta.dirname, "..");
export const DEFAULT_HINT = "Hover a part · E apart · ← → steps";
const round2 = (x: number) => Math.round(x * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A number figure.mjs read that is not there (a design.json param or a field of a line's spec) draws as NaN or
 * undefined: a problem, since the part would be drawn wrong or not at all. */
const UNSET = /NaN|undefined/; // anywhere: a path command letter runs straight into its number (LNaN)
const UNSET_WHY = "its drawing has NaN or undefined in it, so a number it is drawn from is not there: a design.json param or a field of a bom.json line's spec";

/** What figure.mjs reads a BOM line by: `line(id)`, and `spec(id)` for its spec. A line bom.json does not have
 * throws, naming it, so the figure fails saying what to put back rather than on whatever its missing numbers break. */
export function lines(bom: Bom) {
  const line = (id: string) => {
    const l = bom.lines.find((x) => x.id === id);
    if (!l) throw new Error(`bom.json has no ${id} line, which figure.mjs draws: put the line back, or take its part out of figure.mjs`);
    return l;
  };
  return { line, spec: (id: string) => line(id).spec ?? {} };
}

/** The `fig` object figure.mjs draws with. */
function harness(bom: Bom) {
  let width = 640;
  let height = 480;
  let P: Projection | undefined;
  const under: string[] = [];
  const over: string[] = [];
  const parts: Part[] = [];
  const items: Item[] = [];
  const xrays: Xray[] = [];
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
      if (UNSET.test(part.svg)) problems.push(`${where}: ${UNSET_WHY}`);
      parts.push(part);
      items.push({ part });
    },
    /** The outline of BOM line `line` where other parts hide it, painted here in call order: after the parts that
     * hide it (`by`), before the nearer ones, so they still cover it. The page shows it only while the line is lit
     * and one of `by` is in place, and moves it with the line's part. `step` ties it to the part of the line placed
     * at that step (a line placed in two steps, such as screws that close the head and then the base, gets one
     * x-ray per step); without it, it follows the line's first part and lights at any step that places the line. */
    xray(line: string, svg: Svg, { by = [] as string[], step }: { by?: string[]; step?: number } = {}) {
      const where = `fig.xray("${line}")`;
      if (!known.has(line)) problems.push(`${where}: no BOM line with that id`);
      const bad = (Array.isArray(by) ? by : []).filter((id) => !known.has(id));
      if (!Array.isArray(by)) problems.push(`${where}: by must be a list of BOM line ids`);
      else if (bad.length) problems.push(`${where}: by names no BOM line ${bad.join(", ")}`);
      if (step !== undefined && !whole(step, 1)) problems.push(`${where}: step must be a whole number from 1, got ${JSON.stringify(step)}`);
      const at = step !== undefined && whole(step, 1) ? step : undefined;
      xrays.push({ line, step: at });
      const hiders = Array.isArray(by) ? by.filter((id) => known.has(id)) : [];
      if (UNSET.test(text(svg))) problems.push(`${where}: ${UNSET_WHY}`);
      items.push({ raw: `<g data-a2-xray="${esc(line)}"${hiders.length ? ` data-a2-xray-by="${esc(hiders.join(" "))}"` : ""}${at ? ` data-a2-xray-step="${at}"` : ""} display="none">${text(svg)}</g>` });
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
  return { fig, result: () => ({ width, height, P, under, over, parts, items, xrays, hidden, stepText, problems }) };
}

const and = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Runs products/<slug>/figure.mjs. Throws if it is missing or its draw() throws; collects every other problem. */
export async function buildFigure(slug: string): Promise<FigureBuild> {
  const file = join(productDir(slug), "figure.mjs");
  if (!existsSync(file)) throw new Error(`no products/${slug}/figure.mjs: write one that exports default function draw({ k, G, T, fig, params, bom, design, line, spec })`);
  if (!exists(slug, "bom.json")) throw new Error(`no products/${slug}/bom.json yet: the figure draws its lines, so write the BOM first`);
  const bom = readJson<Bom>(slug, "bom.json");
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : ({ params: {} } as unknown as Design);
  const request = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const { fig, result } = harness(bom);
  // Cache-busted, so a second build in one process (sprue all) sees an edited file.
  const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  if (typeof mod.default !== "function")
    throw new Error(`products/${slug}/figure.mjs must \`export default function draw({ k, G, T, fig, params, bom, design, line, spec })\``);
  const out = ((await mod.default({ k, G, T, fig, params: design.params ?? {}, bom, design, ...lines(bom) })) ?? {}) as { title?: string; hint?: string; caption?: string };
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

  for (const x of r.xrays)
    if (x.step !== undefined && !placed.some((p) => p.line === x.line && p.step === x.step))
      problems.push(`fig.xray("${x.line}", ..., { step: ${x.step} }): no fig.part("${x.line}") is placed at step ${x.step}`);

  const name = (id: string) => bom.lines.find((l) => l.id === id)?.name ?? id;
  const numbers = [...new Set([...placed.map((p) => p.step), ...r.stepText.keys()])].sort((a, b) => a - b);
  const steps = numbers.map((n) => {
    const at = placed.filter((p) => p.step === n);
    const ids = [...new Set(at.map((p) => p.line))];
    const counts = Object.fromEntries(ids.map((id) => [id, at.filter((p) => p.line === id).reduce((sum, p) => sum + p.count, 0)]));
    if (!ids.length) warnings.push(`fig.step(${n}) has no parts`);
    let text = r.stepText.get(n);
    if (!text) {
      text = `Fit the ${and(ids.map(name))}`;
      notes.push(`step ${n} has no caption, so it reads "${text}"; add fig.step(${n}, "...")`);
    }
    return { n, text, lines: ids, counts };
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

function write(slug: string, built: FigureBuild) {
  writeText(slug, "figure.svg", built.svg + "\n");
  writeJson(slug, "figure.json", built.figure);
  writePage(slug, { figure: { figure: built.figure, svg: built.svg } });
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

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
  console.error(`✗ figure: ${errorText(error)}${where ? `\n${where}` : ""}`);
}

/** `sprue figure <slug> [--draft]`: build, print the coverage, write the three files. False when a problem needs
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
      const stepsOf = [...new Set(f.parts.filter((p) => p.line === l.id).map((p) => p.step))].sort((a, b) => a - b).join(",");
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
  console.log(`${ok ? "wrote" : "wrote (with problems)"} products/${slug}/figure.svg, figure.json and view.html${draft ? " (draft: the design is not proposed)" : ""}`);
  printPage(slug);
  return ok;
}

// ---- screenshots ----------------------------------------------------------------------------------

/** `sprue shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]`:
 * the figure's card on view.html. */
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
    else throw new Error(`unknown option ${a}; usage: sprue shot <slug> [--apart] [--step n] [--select line] [--zoom x,y,w,h] [--width px] [--light] [--chrome path]`);
  }
  if (opts.step !== undefined && !(Number.isInteger(opts.step) && opts.step >= 0)) throw new Error("--step needs a whole number (0 is the whole product)");
  if (opts.width !== undefined && !(opts.width >= 200)) throw new Error("--width needs a number of px, e.g. 390");
  if (opts.zoom !== undefined && !/^\d+(\.\d+)?(,\d+(\.\d+)?){3}$/.test(opts.zoom)) throw new Error("--zoom needs x,y,w,h in CSS px inside the card, e.g. 200,150,160,120");
  if (!exists(slug, "figure.svg") || !exists(slug, "figure.json"))
    throw new Error(`products/${slug} has no figure yet: write figure.mjs (reference/figure.md), then run \`sprue figure ${slug} --draft\``);
  if (!exists(slug, "view.html")) throw new Error(`no products/${slug}/view.html yet: run \`sprue figure ${slug} --draft\` first`);
  const dir = productDir(slug);
  if (exists(slug, "figure.mjs") && statSync(join(dir, "figure.mjs")).mtimeMs > statSync(join(dir, "figure.svg")).mtimeMs)
    console.log(`note: figure.mjs changed after the figure was drawn; run \`sprue figure ${slug}\` to see the change`);
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
  const url = pathToFileURL(join(dir, "view.html")).href + (hash ? `#${hash}` : "");
  const capture = join(SKILL, "kit", "scripts", "capture.mjs");
  const run = spawnSync(process.execPath, [
    capture, url, "--out", out, "--wait", "1200", "--theme", opts.light ? "light" : "dark",
    // 1100 px by default: under view.html's two-column width (1180), so the card is its full 720 px.
    "--width", String(opts.width ?? 1100),
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
