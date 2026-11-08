// What `sprue handoff` needs of a made line's own entry in bom.json before it can hand the part off: an id that can be
// a folder, a file that is an export of cad/, a material, and a sheet part's thickness. handoff.ts holds every line to
// these (lineProblems), and the quote says them where it points to sprue handoff for a price (quote.ts whyUnpriced),
// so it never points to a hand-off that can only refuse. A leaf: it reads only bom.json's line and the folder.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { inProduct } from "./io.ts";
import type { BomLine } from "./types.ts";

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

/** The first reason `sprue handoff` would refuse a made line for its entry alone, or undefined when it can take it
 * (its files' bytes, its quantity and the other lines are lineProblems' to say). */
export function handoffBlock(dir: string, l: BomLine): string | undefined {
  if (typeof l.id !== "string" || !ID.test(l.id)) return BAD_ID;
  if (!l.file) return "it names no file, so there is nothing to send a shop: give its file (fab/<part>.stl), exported from cad/<part>.py";
  if (!exportOf(dir, l)) return `${l.file} is not an export of cad/ (fab/<part>.stl or .step, with cad/<part>.py beside it): sprue handoff hands off only parts sprue cad exports`;
  return specGaps(l)[0];
}
