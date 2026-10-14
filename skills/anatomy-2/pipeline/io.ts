import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
