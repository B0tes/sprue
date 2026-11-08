// What `sprue handoff` needs of the made lines' entries in bom.json before it can hand the parts off: ids that can be
// folders, files that are exports of cad/, a material, a sheet part's thickness, a whole number to order, and no two
// lines sharing a file or a folder. handoff.ts holds every line to these (lineProblems), and the quote says them where
// it points to sprue handoff for a price (quote.ts whyUnpriced), so it never points to a hand-off that its BOM alone
// stops (its files' bytes, the checks and the quote are lineProblems' and handoffProblems' to say). A leaf: it reads
// bom.json's lines, design.json and the folder's names.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { batchNeed, inProduct } from "./io.ts";
import { isBoardLine } from "./stages/score.ts";
import type { Bom, BomLine, Design } from "./types.ts";

/** The lines `sprue handoff` hands off: each printed, CNC or sheet-metal part but the board's (pcb/order/). */
export const handoffLines = (dir: string, bom: Bom): BomLine[] =>
  bom.lines.filter((l) => (l.process === "print" || l.process === "cnc" || l.process === "sheet") && !isBoardLine(dir, l));

/** The folder name rule: a line id is a folder in fab/order/. */
export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Why a line's id can't be a folder in fab/order/, as said after it. */
export const BAD_ID = "a line id names a folder here, so it takes letters, digits, - and _ only (up to 64, starting with a letter or digit): rename the line";

/** A made line's export, by its path in the product: fab/<stem>.stl or .step, with cad/<stem>.py beside it. */
export function exportOf(dir: string, l: BomLine): string | undefined {
  if (typeof l.file !== "string" || !l.file) return undefined;
  const m = /^fab\/([^/]+)\.(stl|step)$/.exec(inProduct(dir, l.file));
  return m && existsSync(join(dir, "cad", `${m[1]}.py`)) ? m[1] : undefined;
}

/** What every shop asks of a part that its line does not say: a material, and a sheet part's thickness. */
export function specGaps(l: BomLine): string[] {
  const spec = l.spec && typeof l.spec === "object" ? l.spec : {}, out: string[] = [];
  if (!String(spec.material ?? "").trim()) out.push("spec.material is empty, and every shop asks for it: give it in bom.json");
  if (l.process === "sheet" && !(Number(spec.thicknessMm) > 0)) out.push("a sheet-metal part needs spec.thicknessMm (every shop asks for it): give it in bom.json");
  return out;
}

/** design.json's firstArticleUnits, or 0 when it has none (or can't be read). */
export function firstArticle(dir: string): number {
  try {
    return Number((JSON.parse(readFileSync(join(dir, "design.json"), "utf8")) as Design)?.params?.firstArticleUnits ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** How the quote splits a line's n in two (order A for the first `fa` units, order B the rest), as sprue quote's phases
 * do; none when it doesn't split, or order B would be empty. */
export function splitOf(l: BomLine, n: number, fa: number, units: number): { a: number; b: number } | undefined {
  if (!(fa > 0 && fa < units)) return undefined;
  const a = l.qtyPerBatch ?? l.qtyPerUnit * fa;
  return n - a > 0 ? { a, b: n - a } : undefined;
}

/** What is wrong with how many of a line to order: not a whole number of at least 1, in all or in the quote's order A. */
export function countGaps(dir: string, l: BomLine, units: number): string[] {
  const n = batchNeed(l, units);
  if (!Number.isInteger(n) || n < 1) return [`${n} to order is not a whole number of at least 1 (qtyPerUnit x units + spares, or qtyPerBatch): fix bom.json`];
  const fa = firstArticle(dir), split = splitOf(l, n, fa, units);
  return split && !Number.isInteger(split.a)
    ? [`the quote's order A would be ${split.a} (qtyPerUnit ${l.qtyPerUnit} x firstArticleUnits ${fa}), not a whole number: change qtyPerUnit or design.json firstArticleUnits`] : [];
}

/** The first thing in a made line's own entry that stops the hand-off. */
function entryBlock(dir: string, l: BomLine, units: number): string | undefined {
  if (typeof l.id !== "string" || !ID.test(l.id)) return BAD_ID;
  if (!l.file) return "it names no file, so there is nothing to send a shop: give its file (fab/<part>.stl), exported from cad/<part>.py";
  if (!exportOf(dir, l)) return `${l.file} is not an export of cad/ (fab/<part>.stl or .step, with cad/<part>.py beside it): sprue handoff hands off only parts sprue cad exports`;
  return [...specGaps(l), ...countGaps(dir, l, units)][0];
}

/** Why `sprue handoff` would refuse, for the BOM's entries alone, when asked for a made line `l` of `bom`: first its
 * own entry, then another made line's (it hands off every made part or none), then two lines sharing a folder or a
 * file; or undefined when it can take them. */
export function handoffBlock(dir: string, l: BomLine, bom: Bom): string | undefined {
  const own = entryBlock(dir, l, bom.units);
  if (own) return own;
  const lines = handoffLines(dir, bom);
  for (const o of lines.filter((x) => x !== l)) {
    const why = entryBlock(dir, o, bom.units);
    if (why) return `it hands off every made part or none, and ${o.id}: ${why}`;
  }
  const ids = new Map<string, string>(), stems = new Map<string, string>();
  for (const o of lines) {
    const other = ids.get(o.id.toLowerCase()), stem = exportOf(dir, o)!, twin = stems.get(stem);
    if (other) return `${other} and ${o.id}: two line ids that differ only in case would share a folder on a Mac or Windows disk: rename one`;
    if (twin) return `${twin} and ${o.id}: both name fab/${stem}, so one part would be ordered twice: give each line its own file`;
    ids.set(o.id.toLowerCase(), o.id);
    stems.set(stem, o.id);
  }
  return undefined;
}
