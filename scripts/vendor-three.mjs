// Vendors three.js for the 3D view: six of its modules, minified, into skills/sprue/viewer/vendor/three/, with its
// LICENSE, a package.json that maps the names they import each other by to their files, and vendor.json, which says
// where each file came from and gives its hash. The npm tarball is held to the integrity hash npm publishes for it,
// pinned below, and minified with the terser package.json pins, so the same bytes come out each time: to review the
// folder, run this again and see no diff.
//
//   node scripts/vendor-three.mjs           fetch, check and write the folder
//   node scripts/vendor-three.mjs --check   fetch, check and compare with the folder; exit 1 if anything differs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
export const OUT = join(root, "skills", "sprue", "viewer", "vendor", "three");

export const PACKAGE = {
  name: "three",
  version: "0.186.1",
  tarball: "https://registry.npmjs.org/three/-/three-0.186.1.tgz",
  // dist.integrity at https://registry.npmjs.org/three/0.186.1
  integrity: "sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==",
};

/** The minifier, at the version package.json pins, and its options. Comments marked @license are kept. */
export const MINIFIER = {
  name: "terser",
  version: "5.51.2",
  options: { module: true, compress: { passes: 2 }, mangle: true, format: { comments: "some" } },
};

/** Each module: its file in the folder, its path in the package, the name the others import it by, and its imports
 * of other files in the package, each renamed to that file's name. A module may import only modules listed before it,
 * so a page can load them in this order. */
export const MODULES = [
  { file: "three.core.js", from: "build/three.core.js", name: "three/core", rename: {} },
  { file: "three.module.js", from: "build/three.module.js", name: "three", rename: { "./three.core.js": "three/core" } },
  {
    file: "addons/utils/BufferGeometryUtils.js",
    from: "examples/jsm/utils/BufferGeometryUtils.js",
    name: "three/addons/utils/BufferGeometryUtils.js",
    rename: {},
  },
  {
    file: "addons/utils/SkeletonUtils.js",
    from: "examples/jsm/utils/SkeletonUtils.js",
    name: "three/addons/utils/SkeletonUtils.js",
    rename: {},
  },
  {
    file: "addons/controls/OrbitControls.js",
    from: "examples/jsm/controls/OrbitControls.js",
    name: "three/addons/controls/OrbitControls.js",
    rename: {},
  },
  {
    file: "addons/loaders/GLTFLoader.js",
    from: "examples/jsm/loaders/GLTFLoader.js",
    name: "three/addons/loaders/GLTFLoader.js",
    rename: {
      "../utils/BufferGeometryUtils.js": "three/addons/utils/BufferGeometryUtils.js",
      "../utils/SkeletonUtils.js": "three/addons/utils/SkeletonUtils.js",
    },
  },
];

export const sri = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The regular files of an uncompressed tar, by name. Reads ustar and pax headers (npm's tarballs are ustar), checks
 * each header's checksum and refuses a tar cut short. Nothing in it is written anywhere. */
export function readTar(tar) {
  const files = new Map();
  let longName = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) return files;
    const text = (o, n) => h.subarray(o, o + n).toString("utf8").replace(/\0[^]*$/, "");
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseInt(text(148, 8).trim(), 8)) throw new Error(`the tarball is damaged: a header's checksum is wrong at byte ${at}`);
    const size = parseInt(text(124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || h[124] & 0x80) throw new Error(`the tarball is damaged: a size it can't read at byte ${at}`);
    const data = tar.subarray(at + 512, at + 512 + size);
    if (data.length < size) throw new Error("the tarball is cut short");
    at += 512 + Math.ceil(size / 512) * 512;
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
    if (type === "x" || type === "L") {
      longName = type === "L" ? data.toString("utf8").replace(/\0[^]*$/, "") : (paxPath(data) ?? longName);
      continue;
    }
    const prefix = text(257, 6) === "ustar" ? text(345, 155) : "";
    const name = longName ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    longName = null;
    if (type === "0" || type === "7") files.set(name, Buffer.from(data));
  }
  throw new Error("the tarball is cut short: it has no end");
}

/** The path a pax header gives, if any: records of "<length> <key>=<value>\n". */
function paxPath(data) {
  let path = null;
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at);
    const n = parseInt(data.subarray(at, space).toString("latin1"), 10);
    if (space < 0 || !(n > 0)) break;
    const record = data.subarray(space + 1, at + n - 1).toString("utf8");
    if (record.startsWith("path=")) path = record.slice(5);
    at += n;
  }
  return path;
}

/** Each module's static imports and re-exports, in order, as V8 reads them, so neither a comment nor a string that
 * looks like one counts. They come back as one line behind a mark, so a preload in NODE_OPTIONS that prints can't
 * shift them; NODE_OPTIONS is cleared as well. */
export function importLists(codes) {
  const mark = "vendor-three imports: ";
  const list = `import vm from "node:vm"; import { readFileSync } from "node:fs";
    const lists = JSON.parse(readFileSync(0, "utf8")).map((code, i) => {
      try { return new vm.SourceTextModule(code).dependencySpecifiers; }
      catch (e) { console.error("module " + i + ": " + e.message); process.exit(1); }
    });
    console.log(${JSON.stringify(mark)} + JSON.stringify(lists));`;
  let out;
  try {
    out = execFileSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e", list],
      { input: JSON.stringify(codes), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 26,
        env: { ...process.env, NODE_OPTIONS: "" } });
  } catch (e) {
    if (e.status === 1 && e.stderr?.trim()) throw new Error(`a module does not parse as one (${e.stderr.trim()})`);
    throw new Error(`V8 could not list the modules' imports (${e.signal ?? e.code ?? `exit ${e.status}`})`);
  }
  const line = out.split("\n").find((l) => l.startsWith(mark));
  const lists = line ? JSON.parse(line.slice(mark.length)) : null;
  if (!Array.isArray(lists) || lists.length !== codes.length) throw new Error(`V8 did not list the imports of all ${codes.length} modules`);
  return lists;
}

/** Renames a module's imports of other files in the package, each of which must still be there. */
export function renamed(code, mod) {
  for (const [from, to] of Object.entries(mod.rename)) {
    const quoted = new RegExp(`(["'])${from.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\1`, "g");
    if (!quoted.test(code)) throw new Error(`${mod.from} no longer imports ${from}: MODULES is out of date`);
    code = code.replace(quoted, JSON.stringify(to));
  }
  return code;
}

/** The folder's files, by path in it, made from the tarball's bytes with `minify` (code in, code out). Refuses a
 * tarball that isn't npm's, a module that is missing, and a module that imports anything not in MODULES. The tests
 * give their own package and modules. */
export async function vendor(tgz, minify, { pkg = PACKAGE, modules = MODULES } = {}) {
  const got = sri(tgz);
  if (got !== pkg.integrity) throw new Error(`the tarball's hash is ${got}, not npm's ${pkg.integrity}`);
  const tar = readTar(gunzipSync(tgz));
  const read = (path) => {
    const bytes = tar.get(`package/${path}`);
    if (!bytes) throw new Error(`the tarball has no ${path}`);
    return bytes;
  };
  const meta = JSON.parse(read("package.json").toString("utf8"));
  if (meta.name !== pkg.name || meta.version !== pkg.version) {
    throw new Error(`the tarball is ${meta.name}@${meta.version}, not ${pkg.name}@${pkg.version}`);
  }

  const made = [];
  for (const mod of modules) {
    const source = read(mod.from);
    made.push({ mod, source, code: (await minify(renamed(source.toString("utf8"), mod))) + "\n" });
  }
  const lists = importLists(made.map((m) => m.code));
  const out = new Map(), listed = [], before = new Set();
  for (const [i, { mod, source, code }] of made.entries()) {
    const stray = lists[i].find((s) => !before.has(s));
    if (stray) {
      const why = stray === mod.name ? "itself" : modules.some((m) => m.name === stray) ? "listed after it in MODULES"
        : "not vendored: add it to MODULES, or rename it";
      throw new Error(`${mod.from} imports ${stray}, which is ${why}`);
    }
    if (/\bimport\s*\(/.test(code)) throw new Error(`${mod.from} imports a module as it runs (import()), which a page can't map`);
    before.add(mod.name);
    const bytes = Buffer.from(code, "utf8");
    out.set(mod.file, bytes);
    listed.push({ file: mod.file, name: mod.name, from: mod.from, sourceSha256: sha256(source), imports: lists[i],
      bytes: bytes.length, sha256: sha256(bytes) });
  }
  const license = read("LICENSE");
  out.set("LICENSE", license);
  listed.push({ file: "LICENSE", from: "LICENSE", sourceSha256: sha256(license), bytes: license.length, sha256: sha256(license) });

  // Node finds the modules by these names from inside this folder, as a package importing itself (the tests load the
  // model through GLTFLoader so); a page maps them to its own URLs.
  const exports = Object.fromEntries(modules.map((m) => ["." + m.name.slice(pkg.name.length), `./${m.file}`]));
  const json = { name: pkg.name, version: pkg.version, private: true, license: meta.license, type: "module", exports };
  out.set("package.json", Buffer.from(JSON.stringify(json, null, 2) + "\n"));
  const manifest = {
    about: "Six modules of three.js, minified, for Sprue's 3D view. Made by scripts/vendor-three.mjs in "
      + "https://github.com/B0tes/sprue, which fetches the tarball below, holds it to npm's integrity hash and "
      + "makes these same bytes again.",
    package: pkg,
    minifier: MINIFIER,
    files: listed,
  };
  out.set("vendor.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return out;
}

/** The files under a folder, by path in it, but for a Finder's .DS_Store, which git ignores too. */
function filesIn(dir) {
  if (!existsSync(dir)) return new Map();
  const walk = (d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== ".DS_Store")
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  return new Map(walk(dir).map((p) => [relative(dir, p).split("\\").join("/"), readFileSync(p)]));
}

/** What differs between the files the script makes and a folder: one line each, none when they are the same. */
export function differences(out, dir) {
  const have = filesIn(dir), lines = [];
  for (const [file, bytes] of out) {
    if (!have.has(file)) lines.push(`missing: ${file}`);
    else if (!have.get(file).equals(bytes)) lines.push(`different: ${file}`);
  }
  for (const file of have.keys()) if (!out.has(file)) lines.push(`not made by the script: ${file}`);
  return lines;
}

async function terser() {
  const require = createRequire(import.meta.url);
  let version;
  try {
    version = JSON.parse(readFileSync(require.resolve("terser/package.json"), "utf8")).version;
  } catch {
    throw new Error("terser is not installed: run npm ci");
  }
  if (version !== MINIFIER.version) throw new Error(`terser ${version} is installed, not ${MINIFIER.version}: run npm ci`);
  const { minify } = await import("terser");
  return async (code) => (await minify(code, structuredClone(MINIFIER.options))).code;
}

async function fetched(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(args) {
  const check = args[0] === "--check";
  const extra = args.slice(check ? 1 : 0);
  if (extra.length) throw new Error(`unexpected argument ${extra[0]}: the only option is --check, once`);
  const minify = await terser();
  const meta = JSON.parse((await fetched(`https://registry.npmjs.org/${PACKAGE.name}/${PACKAGE.version}`)).toString("utf8"));
  if (meta.dist?.integrity !== PACKAGE.integrity || meta.dist?.tarball !== PACKAGE.tarball) {
    throw new Error(`npm now gives ${meta.dist?.tarball} with ${meta.dist?.integrity} for ${PACKAGE.name}@${PACKAGE.version}`);
  }
  const out = await vendor(await fetched(PACKAGE.tarball), minify);
  const rel = relative(root, OUT);
  if (check) {
    const diff = differences(out, OUT);
    if (diff.length) throw new Error(`${rel} is not what this script makes:\n  ${diff.join("\n  ")}\nRun node scripts/vendor-three.mjs and commit it.`);
    console.log(`${rel}: the same ${out.size} files this script makes from ${PACKAGE.name}@${PACKAGE.version}`);
    return;
  }
  rmSync(OUT, { recursive: true, force: true });
  for (const [file, bytes] of out) {
    mkdirSync(dirname(join(OUT, file)), { recursive: true });
    writeFileSync(join(OUT, file), bytes);
  }
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const total = [...out.values()].reduce((n, b) => n + b.length, 0);
  console.log(`${rel}: ${out.size} files, ${kb(total)}, from ${PACKAGE.name}@${PACKAGE.version} minified by ${MINIFIER.name} ${MINIFIER.version}`);
}

// Run directly, by its own path or a symlink's: Node runs a script from its real path, which argv doesn't give through
// a symlink, unless --preserve-symlinks-main keeps the symlink's, so both sides are made real.
const real = (path) => { try { return realpathSync(path); } catch { return null; } };
if (process.argv[1] && real(process.argv[1]) === real(import.meta.filename)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`vendor-three: ${e.message}`);
    process.exit(1);
  });
}
