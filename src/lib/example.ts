import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Explorer } from "../../skills/sprue/pipeline/explore.ts";
import { requote, totalFor, usd } from "../../skills/sprue/viewer/explorer.js";

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

export type StageId = "design" | "source" | "build";

/** One of Claude's lines at a gate. `code` spans are written in backticks. */
export type Said = { text: string; items?: string[] };

export type GateOption = {
  label: string;
  /** The option's one-line description, as the question shows it. */
  does: string;
  /** What happens when it is picked: Claude's reply, and the lines the command printed, when it runs one. */
  reply: string;
  ran?: { cmd: string; out: string };
  /** The stage the run moves on to. */
  go?: StageId;
};

export type Gate = { n: 1 | 2 | 3; stage: StageId; header: string; question: string; says: Said[]; options: GateOption[] };

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
  tryIt?: TryIt;
  caption: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const PROCESS: Record<string, string> = { pcb: "PCB", print: "printed", cnc: "machined", sheet: "sheet metal" };

/** The lines the gate commands print, from a copy of the run in a scratch folder, so the real example keeps its own
 * state. `accept` at each gate, and `decline` at the first. Undefined if the command can't run. A gate checks the run's
 * files, so an `accept` that refuses (the build gate where the CAD exports, which git leaves out, are not there, as on
 * Vercel) leaves that gate's output out rather than show a refusal the run itself would not get. */
function gateOutputs(slug: string): { accept: (string | undefined)[]; decline: string } | undefined {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-gates-"));
  const run = (...args: string[]) =>
    execFileSync(join(ROOT, "skills", "sprue", "bin", "sprue"), args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).trimEnd();
  const accept = () => {
    try {
      return run("accept", slug);
    } catch (e) {
      console.warn(`sprue accept ${slug} refused while building the page, so the page leaves its output out:`, String((e as { stderr?: string }).stderr ?? e).trim());
      return undefined;
    }
  };
  try {
    const dir = join(tmp, "products", slug);
    cpSync(join(EXAMPLES, slug), dir, { recursive: true, filter: (src) => !/[\\/](history|shots|previews|production)$/.test(src) });
    run("propose", slug, "design");
    const decline = run("decline", slug, "<why>");
    run("propose", slug, "design");
    const outs = [accept()];
    run("propose", slug, "source");
    outs.push(accept());
    run("propose", slug, "build");
    mkdirSync(join(dir, "production"), { recursive: true }); // stage 3 packages the build before its gate
    outs.push(accept());
    return { accept: outs, decline };
  } catch (e) {
    console.warn(`the gate commands for ${slug} failed while building the page:`, (e as Error).message);
    return undefined;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Everything the worked example shows for one run, worked out from its files. */
export function runView(ex: Explorer): RunView {
  const slug = ex.slug;
  const figFile = join(EXAMPLES, slug, "figure.json");
  const fig = existsSync(figFile) ? (JSON.parse(readFileSync(figFile, "utf8")) as FigureFile) : undefined;
  const f = factsOf(ex);
  const out = gateOutputs(slug);
  const name = fig?.title || ex.product;
  const page = `products/${slug}/view.html`;
  const copy = EXAMPLE_COPY[slug];
  const lineName = (id: string) => {
    const l = ex.lines.find((x) => x.id === id);
    return l ? l.shortName || l.name : id;
  };

  // Gate 1: the design.
  const made = ex.lines.filter((l) => l.process !== "buy");
  const kindList = [...new Set(made.map((l) => l.process))];
  const kinds = !kindList.length ? ""
    : kindList.length === 1 ? `, ${made.length === 1 ? "" : "all "}${PROCESS[kindList[0]] ?? kindList[0]}`
    : ` (${kindList.map((p) => `${made.filter((l) => l.process === p).length} ${PROCESS[p] ?? p}`).join(", ")})`;
  const parts = fig ? fig.parts.reduce((s, p) => s + p.count, 0) : 0;
  const hidden = Object.keys(fig?.hidden ?? {});
  const notPass = ex.checks.filter((c) => c.status !== "pass");
  const failedChecks = ex.checks.filter((c) => c.status === "fail");
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
        text: `Checks: ${ex.checks.length} run, ${failedChecks.length} failed, ${f.flagged} flagged for you${notPass.length ? ":" : "."}`,
        items: notPass.length ? notPass.map((c) => `${c.status === "fail" ? "Failed" : "Flagged"}: ${c.title}`) : undefined,
      },
      ...(ex.estimates?.length ? [{ text: "Still estimates:", items: ex.estimates }] : []),
      { text: "No price yet: that is stage 2." },
    ],
    options: [
      {
        label: "Accept and source it",
        does: `Runs \`sprue accept ${slug}\`, then stage 2 finds the offers.`,
        reply: "Claude starts stage 2: it reads offers from supplier pages, then quotes the batch.",
        ran: out?.accept[0] ? { cmd: `sprue accept ${slug}`, out: out.accept[0] } : undefined,
        go: "source",
      },
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
        ran: out ? { cmd: `sprue decline ${slug} '<why>'`, out: out.decline } : undefined,
      },
    ],
  };

  // Gate 2: the offers and the quote.
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
  const g2: Gate = {
    n: 2,
    stage: "source",
    header: "Gate 2",
    question: `Accept the quote and plan the build?`,
    says: [
      { text: `The offers and the quote are on the page, under the design: \`${page}\`` },
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
      {
        label: "Accept and plan the build",
        does: `Runs \`sprue accept ${slug}\`, then stage 3 writes the plan.`,
        reply: "Claude starts stage 3: the build plan, the order list and the fab files.",
        ran: out?.accept[1] ? { cmd: `sprue accept ${slug}`, out: out.accept[1] } : undefined,
        go: "build",
      },
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
        reply: `Claude runs \`sprue suppliers ${slug}\`: the ${plural(f.shops, "shop")} in the order with their lines, subtotals and shipping. Then \`sprue pick ${slug} <line> '<shop>'\` moves a line, with the shop's name in single quotes. The shops are under Suppliers and shipping below.`,
      },
      {
        label: "Edit the design",
        does: "Back to gate 1 with the change, then a new quote.",
        reply: `Claude changes the design and runs \`sprue propose ${slug} design\`, which sends the run back to gate 1. Once you accept the design again, it requotes and asks this again.`,
      },
    ],
  };

  // Gate 3: the build plan and the package.
  const files = ex.lines.filter((l) => l.file && l.process !== "buy");
  const fileKinds = [...new Set(files.map((l) => l.process))].map((p) => `${files.filter((l) => l.process === p).length} ${PROCESS[p] ?? p}`);
  const missing = (ex.score?.files ?? []).filter((x) => !x.ok).map((x) => `${x.name} (${x.detail})`);
  const csvs = ["order-list.csv", ...phases.map((p) => p.file.replace(/^production\//, ""))];
  const score = ex.score;
  const g3: Gate = {
    n: 3,
    stage: "build",
    header: "Gate 3",
    question: "Accept the build? That ends the run.",
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
      { text: `Checks: ${failedChecks.length} failed, ${f.flagged} flagged.` },
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
      {
        label: "Accept the build",
        does: `Runs \`sprue accept ${slug}\`. The run is done.`,
        reply: "The run is done, and nothing is ordered: the order lists are what you put in each cart. Claude then asks what felt wrong, so the next run goes better.",
        ran: out?.accept[2] ? { cmd: `sprue accept ${slug}`, out: out.accept[2] } : undefined,
      },
      {
        label: "Change something",
        does: "Edit, swap or move a line; the plan is written again.",
        reply: `Claude makes the change, reruns what it touched (\`sprue all ${slug}\`), says what moved and asks again.`,
      },
    ],
  };

  const charged = ex.lines.filter((l) => l.options.length).length;
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
      design: `Claude wrote the request, the design numbers, the parts list, the CAD and \`figure.mjs\`. The command line built the CAD, ran ${plural(ex.checks.length, "check")} and drew Fig 1.`,
      source: `Claude read offers for ${plural(charged, "bought line")} from supplier pages into \`catalog.json\`. The command line dropped offers short of stock, rounded each order up to packs and price breaks, and picked the cheapest mix of shops.`,
      build: `The command line wrote \`build-plan.md\` from the design's steps and the figure's, then \`production/\` with the order ${csvs.length === 1 ? "list" : "lists"} and the fab files.`,
    },
    gates: [g1, g2, g3],
    tryIt: tryIt(ex),
    caption:
      `${ex.product}, ${plural(ex.units, "unit")}` +
      (f.pricesRead ? `, prices read on ${f.pricesRead}` : "") +
      `. ${f.lines} lines (${f.bought} bought, ${f.made} made), ${f.checks} checks, ${f.failed ? `${f.failed} failed` : "none failed"}` +
      (f.flagged ? `, ${f.flagged} left for a person` : "") +
      ". Nothing was ordered.",
  };
}

const countWords = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
