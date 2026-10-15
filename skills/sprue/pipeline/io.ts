import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { BomLine } from "./types.ts";

export const productDir = (slug: string) => join(process.cwd(), "products", slug);

export function readJson<T>(slug: string, file: string): T {
  return JSON.parse(readFileSync(join(productDir(slug), file), "utf8")) as T;
}

export function writeJson(slug: string, file: string, data: unknown) {
  writeFileSync(join(productDir(slug), file), JSON.stringify(data, null, 2) + "\n");
}

export function writeText(slug: string, file: string, text: string) {
  writeFileSync(join(productDir(slug), file), text);
}

export function exists(slug: string, file: string) {
  return existsSync(join(productDir(slug), file));
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** Pieces of one line the batch needs: qtyPerBatch, or qtyPerUnit x units, plus spares. */
export const batchNeed = (l: BomLine, units: number) => (l.qtyPerBatch ?? l.qtyPerUnit * units) + (l.spares ?? 0);

/** A path as the file system finds it, through every link on the way; the part that does not exist, as written. */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(path);
    return up === path ? path : join(realPath(up), basename(path));
  }
}

/** A BOM line's file as the path in the product folder it is, with / between its parts, through links:
 * "./pcb/x.zip", "pcb/rev1/../x.zip", its absolute path and "board/x.zip" with board/ a link to pcb/ are all
 * "pcb/x.zip". */
export const inProduct = (dir: string, file: string) => relative(realPath(resolve(dir)), realPath(resolve(dir, file))).split(sep).join("/");

/** The line to warn with when a variable of Distinta, Sprue's name before the rename, is set: only SPRUE_* is read,
 * so DISTINTA_OFFLINE=1 would no longer stop a fetch, and DISTINTA_PYTHON no longer picks the Python, without a word. */
export function renamedEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const old = Object.keys(env).filter((k) => k.startsWith("DISTINTA_") && env[k] !== undefined).sort();
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  if (old.length) return `⚑ ${and(old)} ${old.length > 1 ? "are" : "is"} set, and Sprue (Distinta before the rename) reads only SPRUE_*: set ${and(old.map((k) => k.replace(/^DISTINTA_/, "SPRUE_")))} instead`;
}
