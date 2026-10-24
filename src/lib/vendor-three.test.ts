// scripts/vendor-three.mjs on a small package made here as an npm tarball: it makes the folder (the modules with their
// imports renamed, the LICENSE, package.json and vendor.json), the same bytes twice, and refuses a tarball that isn't
// the one pinned, another version, a missing module, an import of anything not vendored before it (a relative one left,
// a module listed later or itself, one run with import()), a rename of an import that is gone, a damaged or cut-short
// tar and a module that doesn't parse. V8's import lists hold whatever NODE_OPTIONS preloads, and the script runs by a
// symlink's path too (the argument it refuses shows it ran). The real tarball is fetched only by the script itself (CI
// runs it with --check).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { differences, importLists, readTar, sri, vendor } from "../../scripts/vendor-three.mjs";

type Entry = { name: string; data: string | Buffer; type?: string };

/** An uncompressed tar of the entries, written as npm writes one (ustar), each name put in its header. */
function tar(entries: Entry[], { end = true } = {}): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const h = Buffer.alloc(512);
    h.write(e.name.slice(0, 100), 0, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(e.type ?? "0", 156);
    h.write("ustar\0" + "00", 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  if (end) blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const SOURCES: Record<string, string> = {
  "package/package.json": JSON.stringify({ name: "lib", version: "1.0.0", license: "MIT" }),
  "package/LICENSE": "The MIT License\n\nCopyright (c) the lib authors\n",
  "package/build/core.js": "/** @license MIT */\nexport const A = 1;\n",
  "package/build/main.js": "import { A } from './core.js';\nexport { A };\nexport const B = A + 1;\n",
  "package/addons/x.js": "// import { Z } from 'lib/addons/z.js';\nimport { B } from 'lib';\nexport const C = B + \"import 'q'\".length;\n",
};
const MODULES = [
  { file: "core.js", from: "build/core.js", name: "lib/core", rename: {} as Record<string, string> },
  { file: "main.js", from: "build/main.js", name: "lib", rename: { "./core.js": "lib/core" } as Record<string, string> },
  { file: "addons/x.js", from: "addons/x.js", name: "lib/addons/x.js", rename: {} as Record<string, string> },
];
const same = async (code: string) => code;

/** The made package as a tarball, with some files changed, and the pin of it. */
function made(change: Record<string, string | null> = {}) {
  const files = { ...SOURCES, ...change };
  const tgz = gzipSync(tar(Object.entries(files).filter(([, d]) => d !== null).map(([name, data]) => ({ name, data: data! }))));
  return { tgz, pkg: { name: "lib", version: "1.0.0", tarball: "https://registry.example/lib-1.0.0.tgz", integrity: sri(tgz) } };
}

test("the folder is the modules with their imports renamed, the LICENSE, package.json and vendor.json, the same twice", async () => {
  const { tgz, pkg } = made();
  const out = await vendor(tgz, same, { pkg, modules: MODULES });
  assert.deepEqual([...out.keys()].sort(), ["LICENSE", "addons/x.js", "core.js", "main.js", "package.json", "vendor.json"]);
  assert.equal(out.get("main.js")!.toString(), "import { A } from \"lib/core\";\nexport { A };\nexport const B = A + 1;\n\n");
  assert.equal(out.get("LICENSE")!.toString(), SOURCES["package/LICENSE"]);
  const json = JSON.parse(out.get("package.json")!.toString());
  assert.deepEqual(json, { name: "lib", version: "1.0.0", private: true, license: "MIT", type: "module",
    exports: { "./core": "./core.js", ".": "./main.js", "./addons/x.js": "./addons/x.js" } });
  const manifest = JSON.parse(out.get("vendor.json")!.toString());
  assert.deepEqual(manifest.package, pkg);
  // A commented import and a string that reads like one are not imports.
  assert.deepEqual(manifest.files.map((f: { imports?: string[] }) => f.imports), [[], ["lib/core"], ["lib"], undefined]);
  for (const f of manifest.files) {
    assert.equal(createHash("sha256").update(out.get(f.file)!).digest("hex"), f.sha256, f.file);
    assert.equal(out.get(f.file)!.length, f.bytes, f.file);
  }
  const again = await vendor(tgz, same, { pkg, modules: MODULES });
  assert.deepEqual([...again.entries()], [...out.entries()]);
});

test("a tarball that isn't the pinned one, of another version or without a module is refused", async () => {
  const { tgz, pkg } = made();
  await assert.rejects(vendor(tgz, same), /the tarball's hash is sha512-[^ ]+, not npm's sha512-blFeqb49/);
  await assert.rejects(vendor(tgz, same, { pkg: { ...pkg, integrity: sri(Buffer.from("other")) }, modules: MODULES }), /not npm's/);
  const v2 = made({ "package/package.json": JSON.stringify({ name: "lib", version: "2.0.0" }) });
  await assert.rejects(vendor(v2.tgz, same, { pkg: v2.pkg, modules: MODULES }), /the tarball is lib@2\.0\.0, not lib@1\.0\.0/);
  const none = made({ "package/build/core.js": null });
  await assert.rejects(vendor(none.tgz, same, { pkg: none.pkg, modules: MODULES }), /the tarball has no build\/core\.js/);
  const nolicense = made({ "package/LICENSE": null });
  await assert.rejects(vendor(nolicense.tgz, same, { pkg: nolicense.pkg, modules: MODULES }), /the tarball has no LICENSE/);
});

test("a module importing anything not vendored before it, or with a rename of an import that is gone, is refused", async () => {
  const cases: [string, Record<string, string | null>, typeof MODULES, RegExp][] = [
    ["a relative import left", {}, MODULES.map((m) => ({ ...m, rename: {} })), /build\/main\.js imports \.\/core\.js, which is not vendored/],
    ["an addon not vendored", { "package/addons/x.js": "import { Z } from 'lib/addons/z.js';\nexport const C = Z;\n" }, MODULES,
      /addons\/x\.js imports lib\/addons\/z\.js, which is not vendored/],
    ["a module listed after it", {}, [MODULES[1], MODULES[0], MODULES[2]], /build\/main\.js imports lib\/core, which is listed after it/],
    ["a module importing itself", { "package/addons/x.js": "import { C } from 'lib/addons/x.js';\nexport const D = C;\n" }, MODULES,
      /addons\/x\.js imports lib\/addons\/x\.js, which is itself/],
    ["one run with import()", { "package/addons/x.js": "export const C = () => import('lib');\n" }, MODULES,
      /addons\/x\.js imports a module as it runs/],
    ["a re-export of a file not vendored", { "package/addons/x.js": "export * from './y.js';\n" }, MODULES,
      /addons\/x\.js imports \.\/y\.js, which is not vendored/],
    ["a rename of an import that is gone", { "package/build/main.js": "export const B = 2;\n" }, MODULES,
      /build\/main\.js no longer imports \.\/core\.js: MODULES is out of date/],
    ["a module that doesn't parse", { "package/build/core.js": "export const = 1;\n" }, MODULES, /a module does not parse as one \(module 0: /],
  ];
  for (const [what, change, modules, error] of cases) {
    const { tgz, pkg } = made(change);
    await assert.rejects(vendor(tgz, same, { pkg, modules }), error, what);
  }
});

test("the tar is read whole: a pax path, a long name and a prefix are names, and a damaged or cut-short tar is refused", () => {
  const long = "package/" + "d/".repeat(60) + "file.js";
  const pax = `path=${long}\n`;
  const record = `${String(pax.length + 3).length + pax.length + 1} ${pax}`;
  assert.equal(Buffer.byteLength(record), Number(record.split(" ")[0]));
  const files = readTar(tar([
    { name: "PaxHeader", data: record, type: "x" },
    { name: "short.js", data: "a" },
    { name: "././@LongLink", data: long.replace("file", "other") + "\0", type: "L" },
    { name: "short2.js", data: "b" },
    { name: "package/dir", data: "", type: "5" },
    { name: "package/plain.js", data: "c" },
  ]));
  assert.deepEqual([...files].map(([n, d]) => [n, d.toString()]),
    [[long, "a"], [long.replace("file", "other"), "b"], ["package/plain.js", "c"]]);
  const withPrefix = tar([{ name: "plain.js", data: "d" }]);
  withPrefix.write("package/deep", 345);
  let sum = 0;
  withPrefix.fill(" ", 148, 156);
  for (const b of withPrefix.subarray(0, 512)) sum += b;
  withPrefix.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  assert.deepEqual([...readTar(withPrefix).keys()], ["package/deep/plain.js"]);

  const whole = tar([{ name: "package/a.js", data: "x".repeat(700) }]);
  const damaged = Buffer.from(whole);
  damaged[10] ^= 1;
  assert.throws(() => readTar(damaged), /a header's checksum is wrong at byte 0/);
  assert.throws(() => readTar(whole.subarray(0, 900)), /the tarball is cut short/);
  assert.throws(() => readTar(tar([{ name: "package/a.js", data: "x" }], { end: false })), /the tarball is cut short: it has no end/);
});

test("V8 lists a module's imports and re-exports in order, and no comment or string, whatever NODE_OPTIONS preloads", () => {
  const codes = [
    "import{a as b}from\"x\";export*from\"y\";export{c}from'z';import\"w\";import\"x\";",
    "/* import 'no' */ const s = \"import 'no'\"; export default s;",
  ];
  assert.deepEqual(importLists(codes), [["x", "y", "z", "w"], []]);
  // A preload that prints what reads as a list must not shift the lists.
  const before = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--import=data:text/javascript,console.log('[]')";
  try {
    assert.deepEqual(importLists(codes), [["x", "y", "z", "w"], []]);
  } finally {
    if (before === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = before;
  }
});

test("run by any path, a symlink's too, the script refuses an argument it doesn't know, before fetching anything", () => {
  const script = join(import.meta.dirname, "..", "..", "scripts", "vendor-three.mjs");
  const dir = mkdtempSync(join(tmpdir(), "vendor-three-"));
  try {
    symlinkSync(join(import.meta.dirname, "..", "..", "scripts"), join(dir, "scripts"));
    for (const [path, args, named] of [[script, ["foo", "--check"], "foo"], [script, ["--check", "--check"], "--check"],
      [join(dir, "scripts", "vendor-three.mjs"), ["--bogus"], "--bogus"]] as const) {
      const r = spawnSync(process.execPath, [path, ...args], { encoding: "utf8" });
      assert.equal(r.status, 1, `${path} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.equal(r.stderr.trim(), `vendor-three: unexpected argument ${named}: the only option is --check, once`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--check's list: a file missing, one different and one the script doesn't make", () => {
  const dir = mkdtempSync(join(tmpdir(), "vendor-three-"));
  try {
    mkdirSync(join(dir, "addons"));
    writeFileSync(join(dir, "a.js"), "same");
    writeFileSync(join(dir, "addons", "b.js"), "old");
    writeFileSync(join(dir, "extra.js"), "");
    const out = new Map([["a.js", Buffer.from("same")], ["addons/b.js", Buffer.from("new")], ["c.js", Buffer.from("")]]);
    assert.deepEqual(differences(out, dir), ["different: addons/b.js", "missing: c.js", "not made by the script: extra.js"]);
    assert.deepEqual(differences(new Map([["a.js", Buffer.from("same")]]), join(dir, "nothing")), ["missing: a.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
