import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Explorer } from "../../skills/sprue/pipeline/explore.ts";
import { inspectVerdict, requote, totalFor, usd } from "../../skills/sprue/viewer/explorer.js";
import { currentEntry } from "./gate-inputs.mjs";

/** The run shown in section 02. Every run writes products/<slug>/explorer.json; change this one line to
 * show another run. The copy around it is worked out from that run's data, apart from the two sentences in
 * EXAMPLE_COPY below. The keypad (KEYPAD_SLUG) is the second run in the example's switch. */
export const EXAMPLE_SLUG: string = "ponder";

/** The two sentences the data can't write: an edit to try, and what the product is in a few words. */
export const EXAMPLE_COPY: Record<string, { edit: string; what: string }> = {
  macropad: { edit: "make the case 2 mm taller", what: "a 3x3 USB macro keypad" },
  ponder: { edit: "print the shells in PETG instead of PA12", what: "Ponder, an AI tutor desk device with a camera, mics and a speaker" },
};

/** The keypad is rung 1 and its score is the project's metric, so the score table always reads its run. */
export const KEYPAD_SLUG: string = "macropad";

const ROOT = process.cwd();
const EXAMPLES = join(ROOT, "skills", "sprue", "examples");

export async function loadRun(slug: string): Promise<Explorer> {
  const mod = await import(`../../skills/sprue/examples/${slug}/explorer.json`);
  return mod.default as Explorer;
}

export const loadExample = () => loadRun(EXAMPLE_SLUG);

/** Every finished run in the examples folder: slug and product name. */
export function finishedRuns(): { slug: string; product: string }[] {
  return readdirSync(EXAMPLES)
    .filter((d) => existsSync(join(EXAMPLES, d, "explorer.json")))
    .map((slug) => ({ slug, product: (JSON.parse(readFileSync(join(EXAMPLES, slug, "explorer.json"), "utf8")) as Explorer).product }));
}

export { usd };

/** The quote's choice per bought line; -1 (a line quotes.json doesn't cover) stays -1. */
const quoteChoice = (ex: Explorer) => ex.lines.map((l) => (l.chosen >= 0 && l.chosen < l.options.length ? l.chosen : -1));

/** Shops the quote orders from, and the ones among them that charge shipping. */
function shopsFor(ex: Explorer, choice: number[]) {
  const all = new Set<string>();
  const charging = new Set<string>();
  ex.lines.forEach((l, i) => {
    if (l.made) {
      all.add(l.made.supplier);
      if (!l.shipsFree) charging.add(l.made.supplier);
    } else if (l.options[choice[i]]) {
      const shop = l.options[choice[i]].supplier;
      all.add(shop);
      // A shop whose parts ride in a fab's parcel (catalog.json shipsWith) charges no shipping of its own.
      if (!ex.shipsWith?.[shop]) charging.add(shop);
    }
  });
  return { all, charging };
}

export type TryIt = {
  line: string;
  lineId: string;
  from: string;
  to: string;
  partDelta: number;
  totalDelta: number;
  newTotal: number;
  /** The quoted shop leaves the order, and the shipping it saves. */
  leaves?: number;
  /** The new shop joins the order, and the shipping it adds. */
  joins?: number;
  /** Other lines the requote moves to the new shop with it. */
  moves?: string[];
};

/** One offer worth picking in the explorer: another shop for a bought line, where shipping moves the
 * total by more than the part's own price difference. The smallest such change wins. Worked out with the
 * explorer's own requote (the line pinned, the rest free to move, as `sprue pick` does), so it matches what the
 * page shows and what the swap would quote. */
export function tryIt(ex: Explorer): TryIt | undefined {
  const base = quoteChoice(ex);
  const before = totalFor(ex, base);
  const { charging } = shopsFor(ex, base);
  const found: TryIt[] = [];
  ex.lines.forEach((l, i) => {
    if (l.made || base[i] < 0) return;
    const cur = l.options[base[i]];
    l.options.forEach((o, k) => {
      if (k === base[i] || o.supplier === cur.supplier) return;
      const { choice, total: after } = requote(ex, new Map([[i, k]]));
      const stillUsed = ex.lines.some(
        (m, j) => j !== i && !m.made && m.options[choice[j]]?.supplier === cur.supplier,
      );
      const moves = ex.lines.filter((m, j) => j !== i && !m.made && choice[j] >= 0 && choice[j] !== base[j]).map((m) => m.name);
      found.push({
        line: l.name,
        lineId: l.id,
        from: cur.supplier,
        to: o.supplier,
        partDelta: Math.round((o.orderUsd - cur.orderUsd) * 100) / 100,
        totalDelta: Math.round((after - before) * 100) / 100,
        newTotal: after,
        leaves: stillUsed ? undefined : (ex.shipping[cur.supplier] ?? 0),
        joins: charging.has(o.supplier) ? undefined : (ex.shipping[o.supplier] ?? 0),
        moves: moves.length ? moves : undefined,
      });
    });
  });
  return found
    .filter((t) => Math.abs(t.totalDelta - t.partDelta) > 0.005)
    .sort((a, b) => Math.abs(a.totalDelta) - Math.abs(b.totalDelta))[0];
}

export type Rounding = { name: string; need: number; order: number; why: string };

export type ExampleFacts = {
  slug: string;
  product: string;
  units: number;
  total: number;
  perUnit: number;
  lines: number;
  bought: number;
  made: number;
  /** Every shop in the order, and the ones that add a shipping charge (a PCB fab's price includes its own). */
  shops: number;
  shopsCharging: number;
  shippingUsd: number;
  shipsFree: string[];
  checks: number;
  failed: number;
  flagged: number;
  /** The latest date an offer was read from a supplier page. */
  pricesRead: string;
  modes: Record<"api" | "scripted" | "agent" | "snapshot" | "estimate", number>;
  /** Lines whose order rounds up: to a pack, or to a fab's minimum. */
  roundings: Rounding[];
  /** The shop that adds the most shipping for the least it supplies. */
  dearShipping?: { shop: string; shipping: number; parts: number; lines: string[]; onlyShop: boolean };
  /** Shops with offers for bought lines, and the sets of them the quote tries. */
  partShops: number;
  sets: number;
  demoLine?: { id: string; name: string; other?: string };
  /** A bought line with more than one shop, and another shop to swap it to. */
  swap?: { lineId: string; to: string };
};

export function factsOf(ex: Explorer): ExampleFacts {
  const modes = { api: 0, scripted: 0, agent: 0, snapshot: 0, estimate: 0 };
  const base = quoteChoice(ex);
  for (const [i, l] of ex.lines.entries()) {
    const raw = l.made ? l.made.mode : base[i] >= 0 ? l.options[base[i]].source : "";
    const m = raw === "formula" ? "scripted" : raw;
    if (m in modes) modes[m as keyof typeof modes]++;
  }
  const { all, charging } = shopsFor(ex, base);
  const roundings: Rounding[] = [];
  ex.lines.forEach((l, i) => {
    const need = l.needQty ?? l.qtyPerUnit * ex.units;
    const o = l.made ?? l.options[base[i]];
    if (!o || o.orderQty <= need) return;
    const pack = "packSize" in o && o.packSize && o.packSize > 1 ? o.packSize : 0;
    roundings.push({ name: l.name, need, order: o.orderQty, why: pack ? `${pack}-pack` : l.made ? `${o.supplier}'s minimum` : "price break" });
  });
  // Shipping that outweighs what the shop supplies.
  const byShop = new Map<string, { parts: number; lines: string[]; only: boolean }>();
  ex.lines.forEach((l, i) => {
    const o = l.options[base[i]];
    if (l.made || !o) return;
    const e = byShop.get(o.supplier) ?? { parts: 0, lines: [], only: true };
    e.parts += o.orderUsd;
    e.lines.push(l.name);
    e.only &&= l.options.every((x) => x.supplier === o.supplier);
    byShop.set(o.supplier, e);
  });
  const dear = [...byShop]
    .map(([shop, e]) => ({ shop, shipping: ex.shipping[shop] ?? 0, parts: Math.round(e.parts * 100) / 100, lines: e.lines, onlyShop: e.only }))
    .filter((x) => x.shipping > x.parts)
    .sort((a, b) => b.shipping / Math.max(0.01, b.parts) - a.shipping / Math.max(0.01, a.parts))[0];
  const partShops = new Set(ex.lines.filter((l) => !l.made).flatMap((l) => l.options.map((o) => o.supplier))).size;
  const demo = ex.lines.find((l) => !l.made && new Set(l.options.map((o) => o.supplier)).size > 1) ?? ex.lines.find((l) => !l.made && l.options.length);
  const demoIndex = demo ? ex.lines.indexOf(demo) : -1;
  const other = demo && demoIndex >= 0 ? demo.options.find((o, k) => k !== base[demoIndex] && o.supplier !== demo.options[base[demoIndex]]?.supplier) : undefined;
  // The last day a price was read: an estimate's date is when it was written down, not a read.
  const latest = ex.lines.flatMap((l) => l.options.filter((o) => o.source !== "estimate").map((o) => o.capturedAt)).filter(Boolean).sort().pop() ?? "";
  return {
    slug: ex.slug,
    product: ex.product,
    units: ex.units,
    total: ex.totals.batchUsd,
    perUnit: ex.totals.perUnitUsd,
    lines: ex.lines.length,
    bought: ex.lines.filter((l) => !l.made && l.process === "buy").length,
    made: ex.lines.filter((l) => l.made || l.process !== "buy").length,
    shops: all.size,
    shopsCharging: charging.size,
    shippingUsd: Math.round([...charging].reduce((s, x) => s + (ex.shipping[x] ?? 0), 0) * 100) / 100,
    shipsFree: [...all].filter((s) => !charging.has(s)),
    checks: ex.checks.length,
    failed: ex.checks.filter((c) => c.status === "fail").length,
    flagged: ex.checks.filter((c) => c.status === "flag").length,
    pricesRead: latest,
    modes,
    roundings,
    dearShipping: dear,
    partShops,
    sets: partShops > 20 ? 0 : 2 ** partShops - 1,
    demoLine: demo ? { id: demo.id, name: demo.name, other: other?.supplier } : undefined,
    swap: demo && other ? { lineId: demo.id, to: other.supplier } : undefined,
  };
}

/** The real output of `bin/sprue bom <slug> <line>`, run when the page is built, so the page shows
 * exactly what the command prints. Undefined if the command can't run here. */
export function cliOutput(slug: string, line: string): string | undefined {
  try {
    return execFileSync(join(ROOT, "skills", "sprue", "bin", "sprue"), ["bom", slug, line], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000,
    }).trimEnd();
  } catch (e) {
    console.warn(`sprue bom ${slug} ${line} failed while building the page:`, (e as Error).message);
    return undefined;
  }
}

/** Where the drawing sits in the run's figure.svg: the extent of every drawn path, with a margin, as a viewBox.
 * Clip paths are left out (they cover far more than the drawing), and H and V take one number each. */
function cropOf(svg: string): number[] | undefined {
  const drawn = svg.replace(/<clipPath[\s\S]*?<\/clipPath>/g, "").replace(/<defs[\s\S]*?<\/defs>/g, "");
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const at = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const m of drawn.matchAll(/\sd="([^"]+)"/g)) {
    let [x, y] = [0, 0];
    for (const [, cmd, args] of m[1].matchAll(/([MLHVZ])([^MLHVZ]*)/gi)) {
      const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
      const c = cmd.toUpperCase();
      const rel = cmd !== c;
      if (c === "M" || c === "L")
        for (let k = 0; k + 1 < n.length; k += 2) {
          [x, y] = rel ? [x + n[k], y + n[k + 1]] : [n[k], n[k + 1]];
          at(x, y);
        }
      else if (c === "H") for (const v of n) at((x = rel ? x + v : v), y);
      else if (c === "V") for (const v of n) at(x, (y = rel ? y + v : v));
    }
  }
  for (const m of drawn.matchAll(/<circle\b[^>]*>/g)) {
    const num = (k: string) => Number(new RegExp(`\\s${k}="(-?[\\d.]+)"`).exec(m[0])?.[1] ?? NaN);
    const [cx, cy, r] = [num("cx"), num("cy"), num("r")];
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    at(cx - (r || 0), cy - (r || 0));
    at(cx + (r || 0), cy + (r || 0));
  }
  if (!Number.isFinite(x0)) return undefined;
  const pad = 14;
  return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map((n) => Math.round(n * 10) / 10);
}

/** The run's stage 1 figure (figure.svg, drawn with Anatomy's kit), cropped to the drawing, or undefined. */
export function figureArt(slug: string): { svg: string; width: number; height: number } | undefined {
  const file = join(EXAMPLES, slug, "figure.svg");
  if (!existsSync(file)) return undefined;
  let svg = readFileSync(file, "utf8");
  // Our own pipeline wrote it, but it is inlined into the page: keep drawing elements only.
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\s(?:xlink:)?href="[^"]*"/gi, "");
  const vb = cropOf(svg);
  if (!vb) return undefined;
  svg = svg
    .replace(/viewBox="[^"]*"/, `viewBox="${vb.join(" ")}"`)
    .replace(/\srole="img"/, "")
    .replace(/\saria-label="[^"]*"/, ' aria-hidden="true" focusable="false"');
  return { svg, width: vb[2], height: vb[3] };
}

/** The same crop, for a copy of figure.svg the browser loads itself (the hero): only the viewBox. */
export function figureCrop(slug: string): { viewBox: string; width: number; height: number } | undefined {
  const file = join(EXAMPLES, slug, "figure.svg");
  if (!existsSync(file)) return undefined;
  const vb = cropOf(readFileSync(file, "utf8"));
  return vb ? { viewBox: vb.join(" "), width: vb[2], height: vb[3] } : undefined;
}

// ---- the worked example: what each stage shows, and the gate Claude asks in Claude Code ----------------

type FigureFile = {
  width: number;
  height: number;
  title?: string;
  hint?: string;
  caption?: string;
  steps: { n: number; text: string; lines: string[] }[];
  parts: { line: string; step: number; count: number }[];
  hidden?: Record<string, string>;
};

export type StageId = "design" | "inspect" | "source" | "build";

const STAGE_IDS: StageId[] = ["design", "inspect", "source", "build"];

/** One of Claude's lines at a gate. `code` spans are written in backticks. `more` is a long list's rest, folded. */
export type Said = { text: string; items?: string[]; more?: string[] };

/** One command a gate ran on a copy of the run (src/lib/gate-outputs.json): as typed, what it printed, and whether it
 * went through. */
export type Ran = { cmd: string; out: string; ok: boolean };

export type GateOption = {
  label: string;
  /** The option's one-line description, as the question shows it. */
  does: string;
  /** What happens when it is picked: Claude's reply, and the lines the command printed, when it runs one. */
  reply: string;
  ran?: Ran;
  /** The stage the run moves on to. */
  go?: StageId;
  /** true: picking it accepts the gate's stage, an accept that goes through. false: the gate's accept, which doesn't
   * go through here (it refuses, isn't reached, or can't be told), so the page never marks it as passing. */
  accepts?: boolean;
};

export type Gate = {
  n: 1 | 2 | 3 | 4;
  stage: StageId;
  header: string;
  question: string;
  says: Said[];
  options: GateOption[];
  /** On a gate the run doesn't reach, as an accept before it refuses: why, and that the stage was made ahead of it. */
  ahead?: string;
  /** The commands the stage ran before Claude asks (`sprue inspect`, a board's `sprue verify`, `sprue package`), as
   * the record has them: Claude Code shows each, then what Claude says. */
  ran?: Ran[];
};

export type RunView = {
  slug: string;
  /** The figure's title, else the product. */
  name: string;
  product: string;
  brief: string;
  units: number;
  total: number;
  /** Where the browser loads the run's files (scripts/copy-figures.mjs puts them there). */
  base: string;
  pageHref?: string;
  figure?: { width: number; height: number; title: string; hint: string; parts: number; steps: number };
  /** One line per stage: who did what. */
  intro: Record<StageId, string>;
  gates: Gate[];
  /** The gate whose accept refuses, and why: the run stops there. `unknown`: the page can't say how that gate ends
   * (gate 2, with no result of the whole product on these files), so it shows nothing past it as reached. */
  stops?: { gate: number; why: string; unknown?: boolean };
  /** Where what the page shows under a gate is older than the run's files (an explorer.json from before Inspect). */
  under?: Partial<Record<StageId, string>>;
  tryIt?: TryIt;
  caption: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const PROCESS: Record<string, string> = { pcb: "PCB", print: "printed", cnc: "machined", sheet: "sheet metal" };

/** A gate of src/lib/gate-outputs.json: its stage, whether its accept went through, and the commands run by then. */
type GateRecord = { stage: StageId; ok: boolean; ran: Ran[] };

/** What `sprue inspect` printed (pipeline/cli.ts inspect), as gate 2 tells it: the checks of the parts together, the
 * whole product's verdict, its failing gates with their problems and the risks it accepts; and, when the whole-product
 * check ran again (cad/system.py prints each gate and each fault its self-test put in), how many gates passed and how
 * many faults were caught. */
export type InspectPrinted = {
  /** Inspect passes: no check fails, and the whole product passes. */
  ok: boolean;
  /** The whole-product check passes. */
  whole: boolean;
  /** Each check of the parts together, as printed: its mark (✓, ✗ or ⚑) and "title: detail". */
  checks: { mark: string; line: string }[];
  counts: { run: number; failed: number; flagged: number };
  /** Failed checks of a part on their own: printed as a count only. */
  partFailed: number;
  /** Each failing gate of the whole product, by its id, with its title where cad/system.py printed it. */
  failing: { id: string; title: string; problems: string[] }[];
  /** The risks the design accepts in cad/_system.py, each with its reason. */
  flags: string[];
  gates?: { passed: number; of: number };
  selfTest?: { caught: number; of: number };
};

/** Reads `sprue inspect`'s output, or undefined where it isn't that (no assembly-checks line or no verdict). */
export function inspectPrinted(out: string | undefined): InspectPrinted | undefined {
  const lines = (out ?? "").split("\n");
  const at = lines.findIndex((l) => l.startsWith("assembly checks: "));
  const whole = lines.findIndex((l) => /^[✓✗] the whole product: /.test(l));
  const counts = /^assembly checks: (\d+) run, (\d+) failed, (\d+) flagged/.exec(lines[at] ?? "");
  if (!counts || whole < at) return undefined;
  /** An indented line with its mark: [mark, the rest]. */
  const items = (ls: string[]) => ls.map((l) => /^ {2}([✓✗⚑]) (.+)$/.exec(l)).filter((m) => m !== null).map((m) => [m[1], m[2]]);
  const checks = items(lines.slice(0, at)).map(([mark, line]) => ({ mark, line }));
  // cad/system.py's own lines, when it ran: a line per gate, then one per fault its self-test put in.
  const sys = items(lines.slice(at + 1, whole));
  const tests = sys.filter(([, l]) => l.startsWith("self-test, "));
  const gateLines = sys.filter(([, l]) => !l.startsWith("self-test, ") && !l.includes(" changed while the check ran"));
  // After the verdict, system.json's own words: each failing gate's problems, then each risk, by the gate's id.
  const failing: InspectPrinted["failing"] = [];
  const flags: string[] = [];
  for (const l of lines.slice(whole + 1)) {
    const m = /^ {2}([✗⚑]) (\S+): (.*)$/.exec(l);
    if (!m) break;
    if (m[1] === "⚑") {
      flags.push(m[3]);
      continue;
    }
    let g = failing.find((x) => x.id === m[2]);
    if (!g) failing.push((g = { id: m[2], title: m[2], problems: [] }));
    g.problems.push(m[3]);
  }
  // cad/system.py prints the gates in system.json's order, as cli.ts prints their problems: so its failing gates are
  // these ones, by title, while there are as many.
  const failedTitles = gateLines.filter(([mark]) => mark === "✗").map(([, l]) => l.split(": ")[0]);
  if (failedTitles.length === failing.length) failing.forEach((g, i) => (g.title = failedTitles[i]));
  const part = /^ {2}(\d+) part checks? fails?/.exec(lines[at + 1] ?? "");
  return {
    ok: lines[whole].startsWith("✓") && !lines.some((l) => l.startsWith("✗ inspect: ")),
    whole: lines[whole].startsWith("✓"),
    checks,
    counts: { run: Number(counts[1]), failed: Number(counts[2]), flagged: Number(counts[3]) },
    partFailed: part ? Number(part[1]) : 0,
    failing,
    flags,
    gates: gateLines.length ? { passed: gateLines.filter(([mark]) => mark === "✓").length, of: gateLines.length } : undefined,
    selfTest: tests.length ? { caught: tests.filter(([, l]) => l.endsWith(": caught")).length, of: tests.length } : undefined,
  };
}

/** The slugs the build has warned about already: the page is rendered more than once. */
const warned = new Set<string>();

/** What the gate commands printed on a copy of the run, from src/lib/gate-outputs.json, while it is of the files there
 * are now. scripts/gate-outputs.mjs runs them, locally, where the CAD exports the gates check are (git leaves them
 * out, so Vercel has none). A record of other files is not this run's: the build says which file changed, and the page
 * leaves the outputs out. */
function gateRecord(slug: string): GateRecord[] | undefined {
  const now = currentEntry(ROOT, slug);
  if (now.entry) return now.entry.gates as GateRecord[];
  if (!warned.has(slug)) {
    warned.add(slug);
    console.warn(
      `src/lib/gate-outputs.json has ${now.changed === "no record" ? "no gate outputs" : `the gate outputs of other files (${now.changed} changed)`} for ${slug}, so the page leaves them out: ` +
        `run npm run build where sprue cad ${slug} has made the exports, and commit the record`,
    );
  }
  return undefined;
}

/** Everything the worked example shows for one run, worked out from its files. */
export function runView(ex: Explorer): RunView {
  const slug = ex.slug;
  const figFile = join(EXAMPLES, slug, "figure.json");
  const fig = existsSync(figFile) ? (JSON.parse(readFileSync(figFile, "utf8")) as FigureFile) : undefined;
  const f = factsOf(ex);
  const record = gateRecord(slug);
  /** The last `sprue <verb>` a gate ran, as the record has it. */
  const ran = (stage: StageId, verb: string) => record?.find((g) => g.stage === stage)?.ran.findLast((r) => r.cmd.startsWith(`sprue ${verb} `));
  const name = fig?.title || ex.product;
  const page = `products/${slug}/view.html`;
  const copy = EXAMPLE_COPY[slug];
  const lineName = (id: string) => {
    const l = ex.lines.find((x) => x.id === id);
    return l ? l.shortName || l.name : id;
  };

  // What `sprue inspect` printed on these files, while the record is of them.
  const printed = inspectPrinted(ran("inspect", "inspect")?.out);
  // The checks by scope, as the explorer sorts them: each part on its own is Design's, the parts together Inspect's.
  // A checks.json older than scopes has none. Then the record's `sprue inspect`, which lists the checks of the parts
  // together, gives each its scope, while as many checks have the titles it printed as it counted; without it the
  // split isn't known, and the checks aren't called a part's or the parts' together.
  const unscopedFile = ex.checks.length > 0 && ex.checks.every((c) => !c.scope);
  const printedAsm = (c: (typeof ex.checks)[number]) => !!printed?.checks.some((x) => x.line.startsWith(`${c.title}: `));
  const scopedByRecord = unscopedFile && !!printed && ex.checks.filter(printedAsm).length === printed.counts.run;
  const scopeKnown = !unscopedFile || scopedByRecord;
  const isAsm = (c: (typeof ex.checks)[number]) => (scopedByRecord ? printedAsm(c) : c.scope === "assembly");
  const partChecks = ex.checks.filter((c) => !isAsm(c));
  const asmChecks = ex.checks.filter(isAsm);
  const withStatus = (checks: typeof ex.checks, status: string) => checks.filter((c) => c.status === status);
  const partFailed = withStatus(partChecks, "fail");
  const asmFailed = withStatus(asmChecks, "fail");
  const ins = ex.inspect;
  // The whole product's verdict: explorer.json's, while its Inspect is of these files; else what `sprue inspect`
  // printed on them (the record); else explorer.json's score, which can fail it (Gate 4 says so too) but never pass it
  // alone, as it may be of an earlier design.
  const verdict: { state: string; text: string } = inspectVerdict(ins);
  const fromExplorer = verdict.state !== "open";
  const fromRecord = fromExplorer ? undefined : printed;
  // The gates the score found failing (none when its system.json was of an earlier design).
  const scoreFailed = ex.score?.system?.ok === false ? ex.score.system.failed ?? [] : [];
  const wholeState = fromExplorer ? verdict.state : fromRecord ? (fromRecord.whole ? "pass" : "fail") : scoreFailed.length ? "fail" : "open";
  // Where the run stops: the first gate whose accept refuses. The record says, while it is current; without it, the
  // checks and the verdict do, as the gates hold them (a failed part check stops Design; any failed check, or a whole
  // product that fails, stops Inspect).
  const refused = record?.find((g) => !g.ok);
  const wholeFails = wholeState === "fail" || /✗ the whole-product check/.test(refused?.ran.at(-1)?.out ?? "");
  const refusedAt: StageId | undefined = record
    ? refused?.stage
    : partFailed.length ? "design" : asmFailed.length || wholeFails ? "inspect" : undefined;
  // With no record, a whole product nothing says passes isn't shown going through gate 2 either: how it ends is unknown.
  const unknownAt: StageId | undefined = !record && !refusedAt && wholeState !== "pass" ? "inspect" : undefined;
  const stopStage = refusedAt ?? unknownAt;
  const stopsAt = stopStage ? STAGE_IDS.indexOf(stopStage) + 1 : 0;
  const WHY: Record<StageId, string> = {
    design: "a check of a part fails",
    inspect: wholeFails ? "the whole product fails its check" : "a check fails",
    source: "the order can't be accepted as it is",
    build: "the build can't be accepted as it is",
  };
  const UNKNOWN = "this page has no result of the whole-product check on these files";
  /** A gate after the one that refuses isn't reached: what its stage shows was made ahead of it, as the explorer says. */
  const aheadOf = (n: number) =>
    stopsAt && n > stopsAt
      ? (refusedAt
          ? `Stage ${n} hasn't started: ${WHY[refusedAt]}, so \`sprue accept ${slug}\` refuses at gate ${stopsAt} and nothing after it is proposed. `
          : `Stage ${n} isn't shown as reached: ${UNKNOWN}, so it can't say that \`sprue accept ${slug}\` goes through at gate ${stopsAt}. `) +
        `What this stage shows was made ahead of its gate, by an earlier run or by \`sprue all\`. Claude asks this once gate ${stopsAt} is accepted.`
      : undefined;
  /** The accept at gate n: it goes through and moves the run on, refuses with what the record has it print, is not
   * reached yet, or (gate 2 with no result of the whole product) can't be told. Only an accept that goes through
   * reads as one. */
  const acceptAt = (n: number, o: { label: string; does: string; refusedDoes: string; reply: string; refused: string; go?: StageId }): GateOption => {
    const stage = STAGE_IDS[n - 1];
    const r = ran(stage, "accept");
    if (aheadOf(n)) return { label: o.label, does: o.does, reply: `Not yet: ${name} is still at gate ${stopsAt}. Once it gets this far: ${o.reply}`, accepts: false };
    if (refusedAt === stage) return { label: o.label, does: o.refusedDoes, reply: o.refused, ran: r, accepts: false };
    if (unknownAt === stage)
      return {
        label: o.label,
        does: `Runs \`sprue accept ${slug}\`, which goes through only once every check and the whole product pass.`,
        reply: `Not shown: ${UNKNOWN}, so whether it goes through isn't known here. In Claude Code, \`sprue inspect ${slug}\` checks the whole product first, and Claude asks this only once it passes.`,
        accepts: false,
      };
    return { label: o.label, does: o.does, reply: o.reply, ran: r, go: o.go, accepts: true };
  };
  /** A long list as Claude gives it: the first few, the rest folded. */
  const fold = (xs: string[], few = 3) => ({ items: xs.slice(0, few), more: xs.length > few ? xs.slice(few) : undefined });

  // Gate 1: the design, each part on its own.
  const made = ex.lines.filter((l) => l.process !== "buy");
  const kindList = [...new Set(made.map((l) => l.process))];
  const kinds = !kindList.length ? ""
    : kindList.length === 1 ? `, ${made.length === 1 ? "" : "all "}${PROCESS[kindList[0]] ?? kindList[0]}`
    : ` (${kindList.map((p) => `${made.filter((l) => l.process === p).length} ${PROCESS[p] ?? p}`).join(", ")})`;
  const parts = fig ? fig.parts.reduce((s, p) => s + p.count, 0) : 0;
  const hidden = Object.keys(fig?.hidden ?? {});
  const partNotPass = partChecks.filter((c) => c.status !== "pass");
  const g1: Gate = {
    n: 1,
    stage: "design",
    header: "Gate 1",
    question: `Accept the design of ${name}?`,
    says: [
      { text: `The design is ready. Fig 1 and everything under it are on its page: \`${page}\`` },
      ...(fig?.caption || ex.summary ? [{ text: fig?.caption || ex.summary }] : []),
      {
        text:
          `${plural(ex.lines.length, "BOM line")}: ${f.bought} bought, ${made.length} made${kinds}.` +
          (fig ? ` Fig 1 draws ${plural(parts, "part")} in ${plural(fig.steps.length, "assembly step")}` : "") +
          (fig && hidden.length ? `; ${hidden.length === 1 ? "one line isn't" : `${countWords(hidden.length)} lines aren't`} drawn:` : fig ? "." : ""),
        items: fig && hidden.length ? hidden.map(lineName) : undefined,
      },
      {
        text: `${scopeKnown ? "Part checks" : "Checks"}: ${partChecks.length} run, ${partFailed.length} failed, ${withStatus(partChecks, "flag").length} flagged for you${partNotPass.length ? ":" : "."}`,
        items: partNotPass.length ? partNotPass.map((c) => `${c.status === "fail" ? "Failed" : "Flagged"}: ${c.title}`) : undefined,
      },
      ...(scopeKnown ? [] : [{ text: `Its checks.json is from before checks had a scope, so the checks of the parts together are among these: \`sprue check ${slug}\` sorts them.` }]),
      // A check of the parts together that fails now doesn't stop this gate: Claude names it as stage 2's.
      ...(asmFailed.length
        ? [{ text: `${plural(asmFailed.length, "check")} of the parts together ${asmFailed.length === 1 ? "fails" : "fail"}, which stage 2 holds:`, items: asmFailed.map((c) => c.title) }]
        : []),
      ...(ex.estimates?.length ? [{ text: "Still estimates:", items: ex.estimates }] : []),
      { text: "The whole product is checked next, at stage 2, and the price is stage 3's." },
    ],
    options: [
      acceptAt(1, {
        label: "Accept and inspect it",
        does: `Runs \`sprue accept ${slug}\`, then stage 2 inspects the whole product.`,
        refusedDoes: `Runs \`sprue accept ${slug}\`, which refuses while a check of a part fails.`,
        reply: `Claude starts stage 2: it runs \`sprue inspect ${slug}\`, which checks the parts together as one product, and says what it found.`,
        refused: "It refuses while a check of a part fails, so the run stays at gate 1: Claude fixes the design and asks again.",
        go: "inspect",
      }),
      {
        label: "Edit something",
        does: "Say what to change. Claude changes it, redraws and asks again.",
        reply:
          `Claude asks what to change and makes it at the source: a number in design.json, the CAD or figure.mjs. It reruns the checks and the figure, says what moved and asks gate 1 again.` +
          (copy ? ` For example, you could type \`/sprue edit ${slug} ${copy.edit}\` (an example, not run here).` : ""),
      },
      {
        label: "Decline",
        does: "Say why. Claude asks what to change, or stops.",
        reply: "Claude records why and asks what to change, or stops here.",
        ran: ran("design", "decline"),
      },
    ],
  };

  // Gate 2: the whole product, the parts together, as the explorer's Inspect reads it (explore.ts inspectOf); while
  // explorer.json has no Inspect of these files (one written before Inspect), as `sprue inspect` printed it on them.
  const report = ins?.report;
  // system.json's gates say something of this design only while it is of the files as they are.
  const sysGates = ins?.system === "current" ? report?.gates ?? [] : [];
  const problemsOf = (g: (typeof sysGates)[number]) => (g.list?.length ? g.list : String(g.detail ?? "").split("; "));
  const failing = fromRecord
    ? fromRecord.failing.map((g) => ({ title: g.title, problems: g.problems, count: g.problems.length }))
    : sysGates.filter((g) => g.status !== "pass").map((g) => ({ title: g.title, problems: problemsOf(g), count: Number(g.problems) || problemsOf(g).length }));
  const risks = fromRecord
    ? [...fromRecord.flags, ...fromRecord.checks.filter((c) => c.mark === "⚑").map((c) => c.line)]
    : [...sysGates.flatMap((g) => g.flags ?? []), ...withStatus(asmChecks, "flag").map((c) => `${c.title}: ${c.detail}`)];
  const problems = failing.reduce((n, g) => n + g.count, 0);
  const printedNumbers = [
    fromRecord?.gates ? `${fromRecord.gates.passed} of ${plural(fromRecord.gates.of, "gate")} pass${problems ? ` (${plural(problems, "problem")})` : ""}` : problems ? plural(problems, "problem") : "",
    fromRecord?.selfTest ? `self-test ${fromRecord.selfTest.caught} of ${plural(fromRecord.selfTest.of, "fault")} caught` : "",
  ].filter(Boolean).join("; ");
  /** The verdict line: the explorer's (inspectVerdict), the same words from what the record printed, or what
   * explorer.json has with neither. */
  const wholeText = fromRecord
    ? `Whole product ${fromRecord.whole ? "passes" : "fails"}${printedNumbers ? `: ${printedNumbers}` : ""}.`
    : verdict.text +
      (ins?.run && ins.system !== "current" ? ` \`${ins.run}\` checks this design.` : "") +
      (!fromExplorer && scoreFailed.length ? ` Its score, written with the same data, has the whole product failing ${list(scoreFailed)}.` : "");
  const titleOf = (line: string) => ex.checks.find((c) => line.startsWith(`${c.title}: `))?.title ?? line.split(": ")[0];
  const asmFailedTitles = fromRecord ? fromRecord.checks.filter((c) => c.mark === "✗").map((c) => titleOf(c.line)) : asmFailed.map((c) => c.title);
  const asmCounts = fromRecord?.counts ?? { run: asmChecks.length, failed: asmFailed.length, flagged: withStatus(asmChecks, "flag").length };
  // Every failed check stops this gate, a part's too: the record counts them, explorer.json names them.
  const partFails = fromRecord ? fromRecord.partFailed : partFailed.length;
  const faults = ins ? ins.faults : ex.score?.faults;
  const pose = report?.stability?.[0];
  const usb = ex.checks.some((c) => c.id === "usb-power");
  const inspectRan = ran("inspect", "inspect");
  const g2: Gate = {
    n: 2,
    stage: "inspect",
    header: "Gate 2",
    // Claude asks how to go on where the gate refuses, and where it will (a whole product that fails, ahead of it).
    question: refusedAt === "inspect" || wholeFails ? `${wholeFails ? "The whole product fails" : "A check fails"}. How do you want to go on?` : "Accept the whole product and source it?",
    ahead: aheadOf(2),
    ran: inspectRan ? [inspectRan] : undefined,
    says: [
      { text: `The whole product is on the page, under the design: \`${page}\`` },
      { text: wholeText },
      ...failing.map((g) => ({ text: `Failed: ${g.title} (${plural(g.count, "problem")}):`, ...fold(g.problems) })),
      {
        text: !scopeKnown
          ? `Its checks.json is from before checks had a scope, so every check is under Design: \`sprue check ${slug}\` sorts them.`
          : asmCounts.run
            ? `Assembly checks: ${asmCounts.run} run, ${asmCounts.failed} failed, ${asmCounts.flagged} flagged${asmFailedTitles.length ? ":" : "."}`
            : "Assembly checks: none ran.",
        items: asmFailedTitles.length ? asmFailedTitles.map((t) => `Failed: ${t}`) : undefined,
      },
      ...(partFails
        ? [{ text: `${plural(partFails, "part check")} ${partFails === 1 ? "fails" : "fail"} too, under Design${partFailed.length === partFails ? `: ${list(partFailed.map((c) => c.title))}` : ""}.` }]
        : []),
      ...(risks.length ? [{ text: "Risks the design accepts, each with its reason:", ...fold(risks) }] : []),
      ...(ins || fromRecord ? [{ text: faults ? `Seeded faults: ${faults.detail}.` : "Seeded faults: none listed, as there is no `reference/faults.json`." }] : []),
      ...(report?.envelopes
        ? [{
            text:
              `${report.envelopes} of ${report.parts} parts are envelopes, bought parts drawn at their datasheet sizes, so no fit with one is proven on them alone` +
              (pose && pose.estimatedG > 0 ? `; ${Math.round(pose.estimatedG)} g of its ${Math.round(pose.massG)} g is estimated, and its stability with it.` : "."),
          }]
        : []),
      { text: `Not checked yet: electricity beyond ${usb ? "the controller's USB current (`usb-power`)" : "the checks of the parts together the product writes for itself"}, strength and materials.` },
      { text: "No price yet: that is stage 3." },
    ],
    options: [
      acceptAt(2, {
        label: "Accept and source it",
        does: `Runs \`sprue accept ${slug}\`, then stage 3 finds the offers.`,
        refusedDoes: `Runs \`sprue accept ${slug}\`, which refuses while ${wholeFails ? "the whole product fails" : "a check fails"}.`,
        reply: "Claude starts stage 3: it reads offers from supplier pages, then quotes the batch.",
        refused:
          `It refuses: from this gate on every check and the whole product must pass, so the run stays at gate 2 and nothing after it is proposed. ` +
          `Claude fixes what failed and runs \`sprue inspect ${slug}\` again.`,
        go: "source",
      }),
      {
        label: "Fix something",
        does: "Say what to fix, or let Claude fix what failed. It inspects again.",
        reply:
          `Claude fixes the design, not the check: \`cad/_system.py\` changes only where it models a part wrongly, and Claude says so. ` +
          `A fix within the design, such as a hole widened or a boss moved, stays at this gate: \`sprue cad ${slug}\`, \`sprue inspect ${slug}\`, and it asks again. ` +
          `A fix that changes the parts list or the figure reopens the design: \`sprue propose ${slug} design\`, gate 1 again, then Inspect. ` +
          "When every fix is a choice for you, Claude asks: its smallest fix, or live with the risk, which goes in `cad/_system.py` with your reason.",
      },
      {
        label: "Decline",
        does: "Say why. Claude asks what to change, or stops.",
        reply: "Claude records why and asks what to change, or stops here.",
      },
    ],
  };

  // Gate 3: the offers and the quote.
  const cost = ex.lines
    .map((l) => ({ l, o: l.made ?? l.options[l.chosen] }))
    .filter((x) => x.o)
    .sort((a, b) => b.o!.orderUsd - a.o!.orderUsd)
    .slice(0, 3)
    .map(({ l, o }) => `${l.shortName || l.name} ${usd(o!.orderUsd)} (${o!.supplier})`);
  const oneShop = ex.lines.filter((l) => !l.made && l.options.length && new Set(l.options.map((o) => o.supplier)).size === 1);
  const dropped = ex.lines.filter((l) => l.sourceNote);
  const estimated = ex.lines.filter((l) => l.made?.mode === "estimate");
  const estUsd = Math.round(estimated.reduce((s, l) => s + l.made!.orderUsd, 0) * 100) / 100;
  const phases = ex.phases ?? [];
  const both = Math.round(phases.reduce((s, p) => s + p.batchUsd, 0) * 100) / 100;
  const budget = ex.budgetUsd != null
    ? f.total <= ex.budgetUsd ? `${usd(ex.budgetUsd - f.total)} under the ${usd(ex.budgetUsd)} budget.` : `${usd(f.total - ex.budgetUsd)} over the ${usd(ex.budgetUsd)} budget.`
    : "No budget was given.";
  const g3: Gate = {
    n: 3,
    stage: "source",
    header: "Gate 3",
    question: `Accept the quote and plan the build?`,
    ahead: aheadOf(3),
    says: [
      { text: `The offers and the quote are on the page, under the whole product: \`${page}\`` },
      {
        text:
          `${usd(f.total)} for ${plural(f.units, "unit")}${f.units > 1 ? `, ${usd(f.perUnit)} a unit` : ""}, from ${plural(f.shops, "shop")}` +
          ` (${f.shopsCharging === f.shops ? "all charge" : `${f.shopsCharging} charge`} shipping, ${usd(f.shippingUsd)}). ${budget}`,
      },
      { text: `The lines that cost the most: ${list(cost)}.` },
      ...(phases.length === 2
        ? [{
            text: `Order A is ${usd(phases[0].batchUsd)} for ${plural(phases[0].units, "unit")} to build and check first; order B is ${usd(phases[1].batchUsd)} for the other ${phases[1].units} and the spares. Two orders cost ${usd(both)}, ${usd(both - f.total)} more than one.`,
          }]
        : []),
      ...(dropped.length ? [{ text: "Offers left out:", items: dropped.map((l) => `${l.shortName || l.name}: ${l.sourceNote}`) }] : []),
      ...(oneShop.length
        ? [{ text: oneShop.length > 4 ? `${plural(oneShop.length, "line")} have offers from one shop only.` : `One shop only: ${list(oneShop.map((l) => l.shortName || l.name))}.` }]
        : []),
      ...(estimated.length
        ? [{ text: `${plural(estimated.length, "made part")} ${estimated.length === 1 ? "is" : "are"} priced at an assumed rate, not a quote: ${usd(estUsd)} in all.` }]
        : []),
      { text: "Nothing is ordered." },
    ],
    options: [
      acceptAt(3, {
        label: "Accept and plan the build",
        does: `Runs \`sprue accept ${slug}\`, then stage 4 writes the plan.`,
        refusedDoes: `Runs \`sprue accept ${slug}\`, which refuses while the order is not priced whole.`,
        reply: "Claude starts stage 4: the build plan, the order list and the fab files.",
        refused: "It refuses, so the run stays at gate 3: Claude says what it printed, requotes and asks again.",
        go: "build",
      }),
      {
        label: "Swap a part",
        does: "Another part, or the same part from another shop.",
        reply:
          `Claude finds a part that still passes the checks, or moves the line to another shop, requotes and says what the total did, shipping included.` +
          (f.swap ? ` For example \`/sprue swap ${slug} ${f.swap.lineId} ${f.swap.to}\`, which runs \`sprue pick ${slug} ${f.swap.lineId} ${f.swap.to}\`.` : "") +
          " Try it below: open a line and pick another offer.",
      },
      {
        label: "Change a supplier",
        does: "See the shops in the order, then move a line.",
        reply: `Claude runs \`sprue suppliers ${slug}\`: the ${plural(f.shops, "shop")} in the order with their lines, subtotals and shipping. Then \`sprue pick ${slug} <line> '<shop>'\` moves a line, with the shop's name in single quotes. A pick never reopens Inspect. The shops are under Suppliers and shipping below.`,
      },
      {
        label: "Edit the design",
        does: "Back to gate 1 with the change, then Inspect and a new quote.",
        reply:
          `Claude changes the design and runs \`sprue propose ${slug} design\`, which sends the run back to gate 1. Once you accept the design again, it inspects the whole product again at gate 2, requotes and asks this again. ` +
          `A reshape within the design goes back to gate 2 only (\`sprue propose ${slug} inspect\`).`,
      },
    ],
  };

  // Gate 4: the build plan and the package.
  const files = ex.lines.filter((l) => l.file && l.process !== "buy");
  const fileKinds = [...new Set(files.map((l) => l.process))].map((p) => `${files.filter((l) => l.process === p).length} ${PROCESS[p] ?? p}`);
  const missing = (ex.score?.files ?? []).filter((x) => !x.ok).map((x) => `${x.name} (${x.detail})`);
  const csvs = ["order-list.csv", ...phases.map((p) => p.file.replace(/^production\//, ""))];
  const score = ex.score;
  const board = ex.lines.some((l) => l.process === "pcb");
  const g4: Gate = {
    n: 4,
    stage: "build",
    header: "Gate 4",
    question: "Accept the build? That ends the run.",
    ahead: aheadOf(4),
    ran: ["verify", "package"].flatMap((verb) => ran("build", verb) ?? []),
    says: [
      { text: `The build plan is on the page, under the quote: \`${page}\`` },
      {
        text: `build-plan.md has ${plural(ex.assembly.length, "written step")}.${fig ? ` Fig 1 walks the build in ${plural(fig.steps.length, "step")}.` : ""}`,
      },
      {
        text:
          `production/ has the plan, the order ${csvs.length === 1 ? "list" : "lists"} (${csvs.join(", ")}) and the fab files for the ${list(fileKinds)} ${files.length === 1 ? "part" : "parts"}.` +
          (missing.length ? ` Still missing: ${list(missing)}.` : ""),
      },
      {
        text: `${usd(f.total)} for the batch. ${budget}` + (ex.costNotes?.length ? ` ${plural(ex.costNotes.length, "cost is", "costs are")} not in it; they are listed under Not in the total.` : ""),
      },
      { text: `Checks: ${f.failed} failed, ${f.flagged} flagged.` },
      ...(score
        ? [{
            text: `Against the answer key it ${score.pass && score.system?.ok && (!score.faults || score.faults.ok) ? "passes" : "doesn't pass yet"}: ${score.coverage.pct}% of its parts, cost ${score.cost.deltaPct > 0 ? "+" : ""}${score.cost.deltaPct}% on ${usd(score.cost.referenceMidUsd)}.` +
              (!score.system ? " The whole-product check has not run on it." : !score.system.ok ? ` The whole-product check doesn't pass: ${score.system.detail}.` : "") +
              (score.faults && !score.faults.ok ? ` The seeded faults don't pass: ${score.faults.detail}.` : ""),
          }]
        : []),
      { text: "Nothing has been ordered." },
    ],
    options: [
      acceptAt(4, {
        label: "Accept the build",
        does: `Runs \`sprue accept ${slug}\`. The run is done.`,
        refusedDoes: `Runs \`sprue accept ${slug}\`, which refuses until the build can be packaged.`,
        reply: "The run is done, and nothing is ordered: the order lists are what you put in each cart. Claude then asks what felt wrong, so the next run goes better.",
        refused: "It refuses, so the run stays at gate 4: Claude says what it printed, fixes it and asks again.",
      }),
      {
        label: "Change something",
        does: "Edit, swap or move a line; the plan is written again.",
        reply: `Claude makes the change, reruns what it touched (\`sprue all ${slug}\`), says what moved and asks again.`,
      },
    ],
  };

  const charged = ex.lines.filter((l) => l.options.length).length;
  const systemPy = existsSync(join(EXAMPLES, slug, "cad", "_system.py"));
  const passes = ins?.system === "current" ? ins.verdict.ok : fromRecord?.ok;
  const whole = passes === undefined ? "" : `, and the whole product ${passes ? "passes" : "fails"} Inspect`;
  return {
    slug,
    name,
    product: ex.product,
    brief: ex.brief,
    units: ex.units,
    total: f.total,
    base: `/examples/${slug}/`,
    pageHref: existsSync(join(ROOT, "public", "examples", slug, "view.html")) ? `/examples/${slug}/view.html` : undefined,
    figure: fig
      ? { width: fig.width, height: fig.height, title: name, hint: fig.hint || "Hover a part · E apart · ← → steps", parts, steps: fig.steps.length }
      : undefined,
    intro: {
      design: `Claude wrote the request, the design numbers, the parts list, the CAD and \`figure.mjs\`. The command line built the CAD, ran ${plural(partChecks.length, scopeKnown ? "part check" : "check")} and drew Fig 1.`,
      inspect: (systemPy
        ? `Claude wrote \`cad/_system.py\`: every part in one frame, with the fits and contacts the design means, the poses it stands in and what each opening must let through. `
        : "") +
        // Without each check's scope (a checks.json from before scopes, and no record to sort them), no count.
        `The command line (\`sprue inspect\`) ran ${scopeKnown ? plural(asmChecks.length, "check") : "the checks"} of the parts together` +
        (systemPy ? " and the whole-product check, which plants a fault in each of its gates to show it can fail." : ". Nothing checks them as one product yet: there is no `cad/_system.py`."),
      source: `Claude read offers for ${plural(charged, "bought line")} from supplier pages into \`catalog.json\`. The command line dropped offers short of stock, rounded each order up to packs and price breaks, and picked the cheapest mix of shops.`,
      build: `The command line wrote \`build-plan.md\` from the design's steps and the figure's${board ? ", proved the board (`sprue verify`)" : ""}, then \`production/\` with the order ${csvs.length === 1 ? "list" : "lists"} and the fab files.`,
    },
    gates: [g1, g2, g3, g4],
    stops: refusedAt ? { gate: stopsAt, why: WHY[refusedAt] } : unknownAt ? { gate: stopsAt, why: UNKNOWN, unknown: true } : undefined,
    under: {
      ...(unscopedFile
        ? { design: `This run's page is from before checks had a scope, so it lists all ${plural(ex.checks.length, "check")} here${scopedByRecord ? `, the ${asmChecks.length} of the parts together too` : ""}.` }
        : {}),
      ...(!ins
        ? { inspect: `This run's page is from before Sprue had Inspect, so its Inspect is empty${fromRecord ? `: what Claude says above is from \`sprue inspect ${slug}\`, run on these files` : ""}. \`sprue view ${slug}\` writes the page again.` }
        : {}),
    },
    tryIt: tryIt(ex),
    caption:
      `${ex.product}, ${plural(ex.units, "unit")}` +
      (f.pricesRead ? `, prices read on ${f.pricesRead}` : "") +
      `. ${f.lines} lines (${f.bought} bought, ${f.made} made), ${f.checks} checks, ${f.failed ? `${f.failed} failed` : "none failed"}` +
      (f.flagged ? `, ${f.flagged} left for a person` : "") +
      `${whole}. Nothing was ordered.`,
  };
}

const countWords = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
