// Is pcb/drc.json still the audit of this board? The Gerbers are made from the product's own board code
// (cad/pcb.mjs and the modules it loads, the only other things it may read: `runBoard` notes each module it loads and
// refuses anything else), the numbers in design.json params that it reads, and the PCB kit (this folder, ../pcb.ts and
// the firmware's generator and runner, ../firmware/); the audit also reads design.json's keyMap and assembly steps
// (the intent check) and the footprints' references (fixtures/), and the read-back (readback.py, at the pins of
// requirements.txt) checks the written files, so its readback.json carries the same fingerprint. The board code is
// handed all of design.json and bom.json too, so whatever it reads of them counts: the harness watches which of their
// keys it reads (`watch`, such as design.json's slug for the silkscreen and its assembly text for a warning), drc.json
// lists them as `reads` with the modules, and their values go into the fingerprint, each object's keys in order. A
// fingerprint of all that goes into drc.json when the board is built, and the scorer compares it, so an edit that has
// not been through `sprue pcb` yet does not pass on the strength of an old audit, and an edit the board never
// reads, or one that only reorders keys, does not stale it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import module from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realPath } from "../io.ts";

/** The keys of design.json and bom.json the board code read ("*" is the whole file), and the modules it loaded, by
 * their path from the product folder. */
export type Reads = { design: string[]; bom: string[]; modules?: string[] };

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
    getOwnPropertyDescriptor(o, k) {
      note(k);
      return Reflect.getOwnPropertyDescriptor(o, k);
    },
    defineProperty(o, k, d) {
      note(k);
      return Reflect.defineProperty(o, k, d);
    },
    ownKeys(o) {
      seen.add("*");
      return Reflect.ownKeys(o);
    },
  });
}

/** The builtins board code may import: none of them reads a file or loads code. */
const SAFE = new Set(["path", "path/posix", "path/win32", "url", "util", "assert", "assert/strict"]);
/** What process has that reads files or loads code past the module hooks: each throws while the board code runs. */
const DENIED = ["getBuiltinModule", "binding", "_linkedBinding", "dlopen", "loadEnvFile"] as const;
/** The module formats board code may be in. CommonJS could require what it likes. */
const FORMATS = new Set(["module", "module-typescript", "json"]);

type Hooks = {
  registerHooks?: (hooks: {
    resolve: (spec: string, ctx: { parentURL?: string }, next: (spec: string, ctx: object) => { url: string; format?: string | null }) => { url: string; format?: string | null };
    load: (url: string, ctx: object, next: (url: string, ctx: object) => { format?: string | null }) => { format?: string | null };
  }) => { deregister(): void };
};
let builds = 0;

/** Runs the board code in `dir` (the product folder): `run` imports `entry` by the URL it is handed and calls its
 * board(). While it runs, every module it loads (the entry, the modules and JSON it imports, theirs in turn, and a
 * relative one that is not there) is noted for the fingerprint, by its path from `dir`, and loaded afresh, so a second
 * build in one process sees an edited file. An import of anything but a relative path ("./", "../") or a builtin that
 * reads nothing (SAFE), a module in CommonJS, and a call of process.getBuiltinModule, binding, _linkedBinding, dlopen or
 * loadEnvFile are refused: through them it could read what the fingerprint does not cover, and then an edit there
 * would leave an old audit standing. Once any was refused, the build throws, even when the board code went on
 * without it. */
export async function runBoard<T>(dir: string, entry: string, run: (url: string) => Promise<T>): Promise<{ value: T; modules: string[] }> {
  const { registerHooks } = module as unknown as Hooks;
  if (!registerHooks) throw new Error(`the board code runs under Node's module hooks (module.registerHooks), which Node 22.15 and newer have, and this is Node ${process.versions.node}: update Node`);
  const token = `${process.pid}-${++builds}`, url = `${pathToFileURL(entry).href}?sprue=${token}`;
  const files = new Set<string>(), refused: string[] = [];
  // Node loads a module from its real path, through any link: products/ is one to the examples here.
  const home = realPath(dir), name = (f: string) => relative(home, f).split(sep).join("/");
  const where = (u?: string) => (u?.startsWith("file:") ? name(fileURLToPath(u)) : "the board code");
  const refuse = (what: string) => {
    refused.push(what);
    return new Error(`refused: ${what}`);
  };
  const hooks = registerHooks({
    resolve(spec, ctx, next) {
      const rel = spec.startsWith("./") || spec.startsWith("../");
      if (spec !== url && !rel) {
        if (module.isBuiltin(spec) && SAFE.has(spec.replace(/^node:/, ""))) return next(spec, ctx);
        throw refuse(`${where(ctx.parentURL)} imports ${spec}, which is not a path relative to it`);
      }
      let r;
      try {
        r = next(spec, ctx);
      } catch (error) {
        // One that is not there yet counts too: writing it later changes the board.
        if (rel && ctx.parentURL?.startsWith("file:")) files.add(fileURLToPath(new URL(spec, ctx.parentURL)));
        throw error;
      }
      if (!r.url.startsWith("file:")) throw refuse(`${where(ctx.parentURL)} imports ${spec}, which is not a file`);
      files.add(fileURLToPath(r.url));
      const fresh = new URL(r.url);
      fresh.searchParams.set("sprue", token);
      return { ...r, url: fresh.href };
    },
    load(u, ctx, next) {
      const r = next(u, ctx);
      if (u.startsWith("file:") && !FORMATS.has(String(r.format))) throw refuse(`${where(u)} is ${r.format === "commonjs" ? "CommonJS" : `of format ${r.format}`}, which can load what it likes: write it as an ES module`);
      return r;
    },
  });
  const kept = DENIED.map((k) => [k, Object.getOwnPropertyDescriptor(process, k)] as const);
  for (const k of DENIED)
    Object.defineProperty(process, k, { configurable: true, writable: true, value: () => { throw refuse(`the board code calls process.${k}`); } });
  let value: T | undefined, failed: { error: unknown } | undefined;
  try {
    value = await run(url);
  } catch (error) {
    failed = { error };
  } finally {
    hooks.deregister();
    for (const [k, d] of kept) if (d) Object.defineProperty(process, k, d);
  }
  if (refused.length)
    throw new Error(`the board code reads what its fingerprint cannot follow, so an edit there would leave an old audit standing: ${[...new Set(refused)].join("; ")}. ` +
      "Read only what board() is handed (params, design, bom) and modules it imports by a relative path: put the data in design.json's params, or in a module it imports, such as `import layout from \"./layout.json\" with { type: \"json\" }`");
  if (failed) throw failed.error;
  return { value: value as T, modules: [...files].map(name).sort() };
}

const readJson = (path: string): Record<string, unknown> => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
/** JSON with every object's keys in order: the same values written in another order are the same board. */
const stable = (v: unknown) => JSON.stringify(v, (_, x: unknown) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const picked = (obj: Record<string, unknown>, keys: string[]) =>
  keys.includes("*") ? obj : Object.fromEntries([...new Set(keys)].sort().map((k) => [k, Object.hasOwn(obj, k) ? obj[k] : null]));

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

/** A file's bytes for the fingerprint: "missing" for one that is not there, and "folder" for a folder. */
const bytes = (f: string) => {
  try {
    return statSync(f).isFile() ? readFileSync(f) : "folder";
  } catch {
    return "missing";
  }
};

/** The fingerprint of the board in `dir`: the modules the board code loaded (`reads.modules`, else cad/pcb.mjs
 * alone), the kit, the params, keyMap and assembly, and what it read of design.json and bom.json. */
export function inputsHash(dir: string, reads: Reads = { design: [], bom: [] }): string {
  const files = [...(reads.modules ?? ["cad/pcb.mjs"]).map((f) => resolve(realPath(dir), f)), ...kitFiles()];
  const h = createHash("sha1");
  for (const f of files) h.update(bytes(f));
  if (reads.modules) h.update(JSON.stringify(reads.modules));
  const d = readJson(join(dir, "design.json")) as { params?: unknown; keyMap?: unknown; assembly?: unknown };
  h.update(stable(d.params ?? {}));
  if (d.keyMap) h.update(stable(d.keyMap));
  // The intent check holds design.json's assembly steps to keyMap (intent.ts).
  if (d.assembly) h.update(stable(d.assembly));
  if (reads.design.length) h.update(stable(picked(d, reads.design)));
  if (reads.bom.length) h.update(stable(picked(readJson(join(dir, "bom.json")), reads.bom)));
  return h.digest("hex").slice(0, 16);
}
