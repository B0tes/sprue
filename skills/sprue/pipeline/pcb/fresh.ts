// Is pcb/drc.json still the audit of this board? The Gerbers are made from the product's own board code
// (cad/pcb.mjs and the modules it imports by a literal path, the only other things it may read: buildPcb refuses
// board code that reads more, `unfollowed`), the numbers in design.json params that it reads, and the PCB kit (this
// folder, ../pcb.ts and the firmware's generator and runner, ../firmware/); the audit also reads design.json's keyMap
// and assembly steps (the intent check) and the footprints' references (fixtures/), and the read-back (readback.py,
// at the pins of requirements.txt) checks the written files, so its readback.json carries the same fingerprint. The
// board code is handed all of design.json and bom.json too, so whatever it reads of them counts: the harness watches
// which of their keys it reads (`watch`, such as design.json's slug for the silkscreen and its assembly text for a
// warning), drc.json lists them as `reads`, and their values go into the fingerprint, each object's keys in order. A
// fingerprint of all that goes into drc.json when the board is built, and the scorer compares it, so an edit that has
// not been through `sprue pcb` yet does not pass on the strength of an old audit, and an edit the board never
// reads, or one that only reorders keys, does not stale it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

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
/** JSON with every object's keys in order: the same values written in another order are the same board. */
const stable = (v: unknown) => JSON.stringify(v, (_, x: unknown) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const picked = (obj: Record<string, unknown>, keys: string[]) =>
  keys.includes("*") ? obj : Object.fromEntries([...new Set(keys)].sort().map((k) => [k, Object.hasOwn(obj, k) ? obj[k] : null]));

/** A module's imports by a literal path: `import ... from "./keys.mjs"`, `export ... from`, `import "./x.js"` and
 * `import("./x.js")` or import(`./x.js`) with no `${}` in it. A ?query or #hash is not part of the file. */
const SPEC = /\b(?:import|export)\b[^"'`;]*?\bfrom\s*(["'])([^"']+)\1|\bimport\s*\(\s*(["'`])([^"'`$]+)\3\s*[,)]|\bimport\s+(["'])([^"']+)\5/g;
const specs = (text: string) => [...text.matchAll(SPEC)].map((m) => (m[2] ?? m[4] ?? m[6]).replace(/[?#].*$/, ""));
const relativeSpec = (to: string) => to.startsWith("./") || to.startsWith("../");

/** The board code and every module it imports by a relative path (`import ... from "./keys.mjs"`, `import("./x.js")`),
 * and theirs in turn: an edit to any of them changes the board. A package import (`node:path`) is not followed. */
export function boardModules(entry: string): string[] {
  const seen: string[] = [], todo = [resolve(entry)];
  while (todo.length) {
    const f = todo.shift()!;
    if (seen.includes(f)) continue;
    seen.push(f);
    if (!existsSync(f)) continue;
    for (const to of specs(readFileSync(f, "utf8"))) if (relativeSpec(to)) todo.push(resolve(dirname(f), to));
  }
  return seen;
}

/** Packages through which a module reads files or runs code the fingerprint cannot see. */
const READERS = /^(?:node:)?(?:fs|fs\/promises|child_process|module|worker_threads)$/;
/** An import( of anything but a literal path: a name, a sum or a template with `${}` in it. */
const COMPUTED = /\bimport\s*\(\s*(?!(["'`])[^"'`$]*\1\s*[,)])([^)\n]{0,40})/g;

/** What in the board code (`entry` and the modules boardModules finds) the fingerprint cannot follow, one line each:
 * an import( whose path is not a literal, and a package that reads files or loads modules by itself (`node:fs`,
 * `child_process`, `module`, `worker_threads`, `process.getBuiltinModule`). The board code may read only what board()
 * is handed and the modules it imports by a literal path, so that an edit to anything it reads stales the board;
 * buildPcb refuses one that does more. */
export function unfollowed(entry: string): string[] {
  const root = dirname(dirname(resolve(entry)));
  const out: string[] = [];
  for (const f of boardModules(entry)) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8"), name = relative(root, f).split(sep).join("/");
    for (const m of text.matchAll(COMPUTED)) out.push(`${name} imports a path it works out, import(${m[2].trim()}), which the fingerprint cannot follow`);
    for (const to of specs(text)) if (READERS.test(to)) out.push(`${name} imports ${to}, through which it could read files the fingerprint does not cover`);
    if (/\bgetBuiltinModule\b/.test(text)) out.push(`${name} calls process.getBuiltinModule, through which it could read files the fingerprint does not cover`);
  }
  return out;
}

/** The kit's own files that make or check the board: this folder's code, ../pcb.ts, the footprints' references, the
 * read-back (readback.py, at the pins of requirements.txt) and the firmware's generator and runner (../firmware/: the
 * firmware written for a keypad comes from the board, and its run on the read-back's copper checks it). */
export function kitFiles(): string[] {
  const kit = import.meta.dirname, firmware = join(kit, "..", "firmware");
  const code = (d: string) => readdirSync(d).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort().map((f) => join(d, f));
  return [
    ...code(kit),
    join(kit, "..", "pcb.ts"),
    ...code(firmware),
    join(firmware, "harness.py"),
    join(kit, "fixtures", "footprint-refs.json"),
    join(kit, "readback.py"),
    join(kit, "requirements.txt"),
  ];
}

export function inputsHash(dir: string, reads: Reads = { design: [], bom: [] }): string {
  const files = [...boardModules(join(dir, "cad", "pcb.mjs")), ...kitFiles()];
  const h = createHash("sha1");
  for (const f of files) h.update(existsSync(f) ? readFileSync(f) : "missing");
  const d = readJson(join(dir, "design.json")) as { params?: unknown; keyMap?: unknown; assembly?: unknown };
  h.update(stable(d.params ?? {}));
  if (d.keyMap) h.update(stable(d.keyMap));
  // The intent check holds design.json's assembly steps to keyMap (intent.ts).
  if (d.assembly) h.update(stable(d.assembly));
  if (reads.design.length) h.update(stable(picked(d, reads.design)));
  if (reads.bom.length) h.update(stable(picked(readJson(join(dir, "bom.json")), reads.bom)));
  return h.digest("hex").slice(0, 16);
}
