import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Explorer } from "../../skills/anatomy-2/pipeline/explore.ts";
import { totalFor, usd } from "../../skills/anatomy-2/viewer/explorer.js";

/** The run shown in section 02. Every run writes products/<slug>/explorer.json; change this one line to
 * show another run (the Ponder tutor device lands as "ponder"). The copy around it is worked out from that
 * run's data, apart from the two sentences in EXAMPLE_COPY below. */
export const EXAMPLE_SLUG = "macropad";

/** The two sentences the data can't write: an edit to try, and what the product is in a few words. */
export const EXAMPLE_COPY: Record<string, { edit: string; what: string }> = {
  macropad: { edit: "make the case 2 mm taller", what: "a 3x3 USB macro keypad" },
  ponder: { edit: "make the arm 30 mm taller", what: "Ponder, an AI tutor desk device with a camera, mics and a speaker" },
};

/** The keypad is rung 1 and its score is the project's metric, so the score table always reads its run. */
export const KEYPAD_SLUG = "macropad";

const ROOT = process.cwd();
const EXAMPLES = join(ROOT, "skills", "anatomy-2", "examples");

export async function loadRun(slug: string): Promise<Explorer> {
  const mod = await import(`../../skills/anatomy-2/examples/${slug}/explorer.json`);
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
      all.add(l.options[choice[i]].supplier);
      charging.add(l.options[choice[i]].supplier);
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
};

/** One offer worth picking in the explorer: another shop for a bought line, where shipping moves the
 * total by more than the part's own price difference. The smallest such change wins. Worked out with the
 * explorer's own totalFor, so it matches what the page shows. */
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
      const choice = base.slice();
      choice[i] = k;
      const after = totalFor(ex, choice);
      const stillUsed = ex.lines.some(
        (m, j) => j !== i && !m.made && m.options[base[j]]?.supplier === cur.supplier,
      );
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
    const need = l.qtyPerUnit * ex.units;
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
  const latest = ex.lines.flatMap((l) => l.options.map((o) => o.capturedAt)).filter(Boolean).sort().pop() ?? "";
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

/** The real output of `bin/anatomy bom <slug> <line>`, run when the page is built, so the page shows
 * exactly what the command prints. Undefined if the command can't run here. */
export function cliOutput(slug: string, line: string): string | undefined {
  try {
    return execFileSync(join(ROOT, "skills", "anatomy-2", "bin", "anatomy"), ["bom", slug, line], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000,
    }).trimEnd();
  } catch (e) {
    console.warn(`anatomy bom ${slug} ${line} failed while building the page:`, (e as Error).message);
    return undefined;
  }
}

/** The run's stage 1 figure (figure.svg, drawn with Anatomy's kit), cropped to the drawing, or undefined. */
export function figureArt(slug: string): { svg: string; width: number; height: number } | undefined {
  const file = join(EXAMPLES, slug, "figure.svg");
  if (!existsSync(file)) return undefined;
  let svg = readFileSync(file, "utf8");
  // Our own pipeline wrote it, but it is inlined into the page: keep drawing elements only.
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\s(?:xlink:)?href="[^"]*"/gi, "");
  const nums = [...svg.matchAll(/\sd="([^"]+)"/g)].flatMap((m) => m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length < 4) return undefined;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < nums.length; k += 2) {
    x0 = Math.min(x0, nums[k]);
    x1 = Math.max(x1, nums[k]);
    y0 = Math.min(y0, nums[k + 1]);
    y1 = Math.max(y1, nums[k + 1]);
  }
  const pad = 14;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map((n) => Math.round(n * 10) / 10);
  svg = svg
    .replace(/viewBox="[^"]*"/, `viewBox="${vb.join(" ")}"`)
    .replace(/\srole="img"/, "")
    .replace(/\saria-label="[^"]*"/, ' aria-hidden="true" focusable="false"');
  return { svg, width: vb[2], height: vb[3] };
}
