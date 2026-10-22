// What stops a gate being accepted, or the build being packaged (gateProblems, acceptProblems): a failed engineer
// check, the files the BOM names, from Inspect's gate on the whole-product check, then the pricing, the plan and the
// package. `sprue accept`, `sprue package` and `sprue status` all ask here. Before this, a part file exported from an
// earlier design shipped priced at the old volume, and only `sprue score`, which needs an answer key, looked: the CO2
// run's case was packaged at its old height.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { FabRates } from "./adapters/fab.ts";
import { catalogProblems } from "./catalog.ts";
import { loadRates } from "./explore.ts";
import { errorText } from "./io.ts";
import { whyUnpriced } from "./stages/quote.ts";
import { exportStale, firmwareShips, gerbersAudit, isBoardLine, meshAudit, systemAudit, volumeMismatch } from "./stages/score.ts";
import type { Stage } from "./state.ts";
import type { Bom, BomLine, Checks, QuoteLine, Quotes, Score, SystemCheck } from "./types.ts";

/** Why a printed part's file is not the part its line prices, or undefined when it is: the mesh is not one closed
 * body (meshAudit), or it holds another volume than `spec.volumeCm3`. `sprue cad`, accept and package say this. */
export function meshProblem(dir: string, l: BomLine): string | undefined {
  if (!l.file) return undefined;
  const path = resolve(dir, l.file);
  if (!l.file.toLowerCase().endsWith(".stl") || !existsSync(path)) return undefined;
  const m = meshAudit(path);
  if (!m.ok) return `${l.id}: ${l.file}: ${m.detail}`;
  const priced = volumeMismatch(m.volumeCm3, l.spec.volumeCm3);
  if (priced) return `${l.id}: ${l.file}: ${priced}: copy the volume sprue cad prints for it into ${l.id}'s spec.volumeCm3, then run sprue all so the quote prices it`;
  return undefined;
}

/** Each problem with the BOM's files, as one line naming its line: an export of an earlier design (exportStale) and a
 * printed part's mesh (meshProblem) always; with `built` (the build stage's gate and `sprue package`) also a file not
 * made yet, and a board that has not passed its gates with their self-tests (gerbersAudit), nor its firmware run
 * (firmwareShips). A board is proved in stage 4, so it counts only there. */
export function fileProblems(dir: string, bom: Bom, { built = false } = {}): string[] {
  const out: string[] = [];
  let board = false;
  // A made part with no file has nothing to print, cut or order from.
  if (built) for (const l of bom.lines.filter((x) => x.process !== "buy" && !x.file))
    out.push(`${l.id}: bom.json names no file for this ${l.process} part, so nothing would be made from it: give its file (fab/<part>.stl, or the board's zip)`);
  // package copies each file into production/ by its name alone, beside the plan and the order lists it writes: two
  // of one name would leave one out.
  if (built) {
    const taken = new Map<string, string>([["build-plan.md", "the build plan's"], ["order-list.csv", "an order list's"], ["order-a.csv", "an order list's"], ["order-b.csv", "an order list's"]]);
    for (const l of bom.lines.filter((x) => x.file)) {
      const path = resolve(dir, l.file!);
      for (const x of new Set([path, path.replace(/\.stl$/, ".step")])) {
        if (x !== path && !existsSync(x)) continue;
        const name = basename(x), other = taken.get(name);
        if (other && other !== x) out.push(`${l.id}: ${relative(dir, x)} would go into production/ as ${name}, which is ${other.startsWith("/") ? relative(dir, other) + "'s" : other} name there too: rename it`);
        else taken.set(name, x);
      }
    }
  }
  for (const l of bom.lines.filter((x) => x.file)) {
    const path = resolve(dir, l.file!);
    if (isBoardLine(dir, l)) {
      if (!built) continue;
      // A board whose build failed has no zip, but its drc.json says why.
      const a = gerbersAudit(dir, l.file, { selfTest: true });
      if (!existsSync(path)) out.push(`${l.id}: ${l.file} is not made yet${a.ok ? ": run sprue cad" : `: ${a.detail}`}`);
      else if (!a.ok) out.push(`${l.id}: ${l.file}: ${a.detail}`);
      else board = true;
      continue;
    }
    if (!existsSync(path)) {
      if (built) out.push(`${l.id}: ${l.file} is not made yet: run sprue cad`);
      continue;
    }
    const stale = exportStale(dir, l.file!);
    if (stale) out.push(`${l.id}: ${l.file}: ${stale}`);
    else {
      const m = meshProblem(dir, l);
      if (m) out.push(m);
    }
  }
  // The keypad's firmware goes with its board: one that would be left out of the package stops it.
  if (built && board) {
    const ships = firmwareShips(dir);
    if (!ships.ok && ships.detail) out.push(`firmware/code.py: ${ships.detail}`);
  }
  return out;
}

/** What systemAudit says of a system.json that is not of the files as they are (or of none), so its gates say nothing. */
const NOT_CURRENT = /^(nothing made|no cad\/_system\.py|no system\.json|system\.json is of an earlier design|system\.json is not readable)/;

/** The whole-product check (cad/_system.py, read from system.json by score.ts systemAudit), as the gates from
 * Inspect's on hold it, with system.json's gates while it is of the files as they are. `problems`: how many stop the
 * gate, each failing gate's own, or 1 when it fails with none counted (stale, missing, or a self-test that missed a
 * fault); 0 when it passes. Nothing here runs the check, which takes minutes: a stale one says to run it. */
export function wholeProduct(dir: string, bom: Bom): Score["system"] & { problems: number; gates: SystemCheck["gates"] } {
  const a = systemAudit(dir, bom);
  let gates: SystemCheck["gates"] = [];
  if (!NOT_CURRENT.test(a.detail)) {
    try { gates = (JSON.parse(readFileSync(join(dir, "system.json"), "utf8")) as SystemCheck).gates ?? []; } catch { /* systemAudit said so */ }
  }
  const counted = gates.filter((g) => a.failed.includes(g.id)).reduce((n, g) => n + Math.max(1, g.problems ?? 0), 0);
  return { ...a, gates, problems: a.ok ? 0 : Math.max(1, counted) };
}

/** The whole-product check as one problem of a gate, or undefined when it passes. */
export function wholeProductProblem(dir: string, bom: Bom): string | undefined {
  const w = wholeProduct(dir, bom);
  return w.ok ? undefined : `the whole-product check: ${w.detail}`;
}

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** What a quote is priced from: bom.json, the offers (catalog.json, offers.digikey.json) and Sprue's own rates.json,
 * by their sha256, and design.json's firstArticleUnits, which splits the order. `sprue quote` writes it into
 * quotes.json, and pricingProblems compares. */
export function quoteInputs(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ["bom.json", "catalog.json", "offers.digikey.json"]) if (existsSync(join(dir, f))) out[f] = sha(join(dir, f));
  out["sprue:rates.json"] = sha(join(import.meta.dirname, "rates.json"));
  let split: unknown;
  try { split = (JSON.parse(readFileSync(join(dir, "design.json"), "utf8")) as { params?: Record<string, unknown> }).params?.firstArticleUnits; } catch { /* none */ }
  out["design.json's firstArticleUnits"] = JSON.stringify(split ?? null);
  return out;
}

/** Why the order can't be accepted (the source and build gates) or packaged: a catalog file nothing can price from,
 * no quote, a quote of an earlier bom.json or catalog, a line with no price, or a shop with no shipping figure (each
 * counted as $0 in the total). */
export function pricingProblems(dir: string, bom: Bom): string[] {
  const out = pricing(dir, bom);
  // With no offers at all sprue all skips the quote, so a quote it would write again can't be: say what is missing.
  return out.some((p) => p.endsWith(": run sprue all")) && !existsSync(join(dir, "catalog.json")) && !existsSync(join(dir, "offers.digikey.json"))
    ? ["no catalog.json, so nothing can be priced: write catalog.json (two real offers per bought line), then run sprue all", ...out] : out;
}

function pricing(dir: string, bom: Bom): string[] {
  const out: string[] = [];
  let filament: FabRates["filament"];
  for (const file of ["catalog.json", "offers.digikey.json"]) {
    if (!existsSync(join(dir, file))) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      out.push(`${file} is not readable JSON (${errorText(e)})`);
      continue;
    }
    const problems = catalogProblems(raw, file, bom).problems;
    for (const p of problems) out.push(`${file}: ${p}`);
    if (file === "catalog.json" && !problems.length) filament = (raw as { filament?: FabRates["filament"] }).filament;
  }
  if (!existsSync(join(dir, "quotes.json"))) return [...out, "no quotes.json, so nothing is priced: run sprue all"];
  let q: Quotes;
  try {
    q = JSON.parse(readFileSync(join(dir, "quotes.json"), "utf8")) as Quotes;
  } catch (e) {
    return [...out, `quotes.json is not readable JSON (${errorText(e)}): run sprue all`];
  }
  const was = q.inputs, now = quoteInputs(dir);
  if (!was) out.push("quotes.json does not say what it was priced from (an earlier Sprue wrote it): run sprue all");
  else {
    const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
    if (changed.length) out.push(`quotes.json was priced from an earlier ${changed.join(", ")} (changed since): run sprue all`);
  }
  const rates = { ...loadRates(), ...(filament ? { filament } : {}) };
  for (const id of new Set([...(q.unquoted ?? []), ...(q.phases ?? []).flatMap((p) => p.unquoted ?? [])])) {
    const line = bom.lines.find((l) => l.id === id);
    out.push(`${id} (${line?.name ?? id}) has no price, so the total leaves it out: ${line ? whyUnpriced(line, rates) : "bom.json has no such line now: run sprue all"}`);
  }
  for (const shop of q.noShipping ?? [])
    out.push(`catalog.json's shipping has no figure for ${shop}, which the order buys from, so the total counts its shipping as $0: add it (0 if it ships free)`);
  return out;
}

/** What build-plan.md was written from: quotes.json (its order tables and total) and design.json (its steps), by their
 * sha256. `sprue plan` writes it as the plan's last line, a Markdown comment, and planProblem compares. */
export function planInputs(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ["quotes.json", "design.json"]) if (existsSync(join(dir, f))) out[f] = sha(join(dir, f));
  return out;
}

const PLAN_RECORD = /^<!-- sprue: written from (.*) -->$/m;
/** The line `sprue plan` ends build-plan.md with. */
export const planRecord = (dir: string) =>
  `<!-- sprue: written from ${Object.entries(planInputs(dir)).map(([f, h]) => `${f} ${h}`).join(", ")} -->`;

/** Why build-plan.md is not the plan of the quote and design as they are (the build gate and `sprue package`, which
 * ships it beside the order lists), or undefined when it is. */
export function planProblem(dir: string): string | undefined {
  const file = join(dir, "build-plan.md");
  if (!existsSync(file)) return "no build-plan.md, so there is no plan to build from: run sprue all";
  const m = PLAN_RECORD.exec(readFileSync(file, "utf8"));
  if (!m) return "build-plan.md does not say what it was written from (an earlier Sprue wrote it): run sprue all";
  const was = Object.fromEntries(m[1].split(", ").map((x) => x.split(" ")));
  const now = planInputs(dir);
  const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((k) => now[k] !== was[k]);
  return changed.length ? `build-plan.md was written from an earlier ${changed.join(", ")} (changed since), so its order tables are not the order: run sprue all` : undefined;
}

/** What a gate's accept refuses but the order of the stages, and `sprue package` all of it but the package itself,
 * upstream first: a failed engineer check (at Design, only those of a part on its own), the BOM's files (Build's:
 * made, and the board proved), from Inspect's gate on the whole-product check, from Source's the pricing, at Build
 * the plan. */
export function gateProblems(dir: string, stage: Stage, checks: Checks): string[] {
  const failed = checks.checks.filter((c) => c.status === "fail" && (stage !== "design" || c.scope !== "assembly"))
    .map((c) => `check ${c.id} fails: ${c.detail}`);
  const bom = JSON.parse(readFileSync(join(dir, "bom.json"), "utf8")) as Bom;
  const whole = stage === "design" ? undefined : wholeProductProblem(dir, bom);
  const plan = stage === "build" ? planProblem(dir) : undefined;
  return [...failed, ...fileProblems(dir, bom, { built: stage === "build" }), ...(whole ? [whole] : []),
    ...(stage === "design" || stage === "inspect" ? [] : pricingProblems(dir, bom)), ...(plan ? [plan] : [])];
}

/** What `sprue accept` refuses a gate for, but the order of the stages: its gate's problems, and at Build a package
 * of other files than there are now, as "the package is in production/" says. `sprue status` asks the same. */
export function acceptProblems(dir: string, stage: Stage, checks: Checks): string[] {
  const pack = stage === "build" ? packageProblem(dir, JSON.parse(readFileSync(join(dir, "bom.json"), "utf8")) as Bom) : undefined;
  return [...gateProblems(dir, stage, checks), ...(pack ? [pack] : [])];
}

/** The firmware `sprue pcb` writes for a keypad, which the plan lists and `package` copies with the board. */
export const FIRMWARE = ["firmware/code.py", "firmware/README.md"];

/** The order lists `sprue package` writes beside the plan, by their names in production/: the whole order, and one
 * per order when the quote splits it in two. Type packs_to_order into a cart that sells packs; order_pcs is the pieces
 * that buys. */
export function orderLists(bom: Bom, quotes: Quotes): Record<string, string> {
  const name = (id: string) => (id.startsWith("ship:") ? `Shipping (${id.slice(5)})` : bom.lines.find((l) => l.id === id)?.name ?? id);
  const cell = (x: string | number | undefined) => `"${String(x ?? "").replaceAll('"', '""')}"`;
  const header = ["part", "supplier", "order", "need_pcs", "order_pcs", "pack_size", "packs_to_order", "usd", "lead_days", "priced_by", "basis"];
  const csvOf = (lines: QuoteLine[]) => [header.join(",")]
    .concat(lines.map((q) => [name(q.lineId), q.supplier, q.sku, q.needQty, q.orderQty, q.packSize ?? 1, q.packs ?? q.orderQty,
      q.orderUsd.toFixed(2), q.leadDays, q.mode, q.basis].map(cell).join(",")))
    .join("\n") + "\n";
  return Object.fromEntries([["order-list.csv", csvOf(quotes.lines)],
    ...(quotes.phases ?? []).map((p) => [`order-${p.name.toLowerCase()}.csv`, csvOf(p.lines)])]);
}

/** Why production/ is not what `sprue package` would write from the files as they are, or undefined when it is (or
 * there is none): a file in it that changed since or that package would not write, or one it would that is not there. */
export function packageProblem(dir: string, bom: Bom): string | undefined {
  const out = join(dir, "production");
  if (!existsSync(out)) return undefined;
  const held = readdirSync(out, { recursive: true, encoding: "utf8" })
    .filter((f) => !basename(f).startsWith(".") && statSync(join(out, f)).isFile());
  // What package writes, by its path in production/: the plan, the order lists of quotes.json, each line's file and
  // the STEP beside an STL, and the keypad's firmware with its board's zip.
  let quotes: Quotes | undefined;
  try {
    quotes = JSON.parse(readFileSync(join(dir, "quotes.json"), "utf8")) as Quotes;
  } catch {
    quotes = undefined; // no quote, so no order list package would write
  }
  let lists: Record<string, string> = {};
  try {
    if (quotes) lists = orderLists(bom, quotes);
  } catch {
    lists = {}; // not a quote: pricingProblems says so
  }
  const files = bom.lines.filter((l) => l.file).map((l) => resolve(dir, l.file!));
  const from = new Map([["build-plan.md", join(dir, "build-plan.md")]]);
  for (const f of files) for (const x of [f, f.replace(/\.stl$/, ".step")]) from.set(basename(x), x);
  const board = bom.lines.some((l) => l.file && isBoardLine(dir, l) && held.includes(basename(resolve(dir, l.file))));
  if (board && firmwareShips(dir).ok) for (const f of FIRMWARE) from.set(f, join(dir, f));
  for (const f of held) {
    if (f in lists) {
      if (readFileSync(join(out, f), "utf8") !== lists[f]) return `production/${f} is not the order in quotes.json as it is now: run sprue package`;
      continue;
    }
    const src = from.get(f);
    if (!src || !existsSync(src)) return `production/${f} is a copy of no file there is now: run sprue package`;
    if (!readFileSync(src).equals(readFileSync(join(out, f))))
      return `production/${f} is not ${relative(dir, src)} as it is now (changed since it was packaged): run sprue package`;
  }
  const left = files.find((f) => existsSync(f) && !held.includes(basename(f)));
  if (left) return `production/ has no ${basename(left)}, which bom.json names: run sprue package`;
  const gone = [...Object.keys(lists), ...[...from].filter(([, src]) => existsSync(src)).map(([f]) => f)].find((f) => !held.includes(f));
  return gone ? `production/ has no ${gone}, which sprue package writes: run sprue package` : undefined;
}

