// Is pcb/drc.json still the audit of this board? The Gerbers are made from the product's own board code
// (cad/pcb.mjs), the numbers in design.json params that it reads, and the PCB kit (this folder and ../pcb.ts); the
// audit also reads design.json's keyMap (the intent check) and the footprints' references (fixtures/). The board code
// is handed all of design.json and bom.json too, so whatever it reads of them counts: the harness watches which of
// their keys it reads (`watch`, such as design.json's slug for the silkscreen and its assembly text for a warning),
// drc.json lists them as `reads`, and their values go into the fingerprint. A fingerprint of all that goes into
// drc.json when the board is built, and the scorer compares it, so an edit that has not been through `distinta pcb`
// yet does not pass on the strength of an old audit, and an edit the board never reads does not stale it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The keys of design.json and bom.json the board code read; "*" is the whole file. */
export type Reads = { design: string[]; bom: string[] };

/** `obj` as the board code sees it, noting each top-level key it reads in `seen` (all of them, as "*", when it lists
 * or copies the object). Nested values are not watched: reading `design.assembly` counts the whole of it. */
export function watch<T extends object>(obj: T, seen: Set<string>): T {
  const note = (k: string | symbol) => {
    if (typeof k === "string") seen.add(k);
  };
  return new Proxy(obj, {
    get(o, k, r) {
      note(k);
      return Reflect.get(o, k, r);
    },
    has(o, k) {
      note(k);
      return Reflect.has(o, k);
    },
    ownKeys(o) {
      seen.add("*");
      return Reflect.ownKeys(o);
    },
  });
}

const readJson = (path: string): Record<string, unknown> => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const picked = (obj: Record<string, unknown>, keys: string[]) =>
  keys.includes("*") ? obj : Object.fromEntries([...new Set(keys)].sort().map((k) => [k, Object.hasOwn(obj, k) ? obj[k] : null]));

export function inputsHash(dir: string, reads: Reads = { design: [], bom: [] }): string {
  const kit = import.meta.dirname;
  const files = [
    join(dir, "cad", "pcb.mjs"),
    ...readdirSync(kit).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort().map((f) => join(kit, f)),
    join(kit, "..", "pcb.ts"),
    join(kit, "fixtures", "footprint-refs.json"),
  ];
  const h = createHash("sha1");
  for (const f of files) h.update(existsSync(f) ? readFileSync(f) : "missing");
  const d = readJson(join(dir, "design.json")) as { params?: unknown; keyMap?: unknown };
  h.update(JSON.stringify(d.params ?? {}));
  if (d.keyMap) h.update(JSON.stringify(d.keyMap));
  if (reads.design.length) h.update(JSON.stringify(picked(d, reads.design)));
  if (reads.bom.length) h.update(JSON.stringify(picked(readJson(join(dir, "bom.json")), reads.bom)));
  return h.digest("hex").slice(0, 16);
}
