// Packs skills/anatomy-2/ into public/anatomy-2.zip for the site's download link
// (unzip anatomy-2.zip -d ~/.claude/skills). Runs before `next build` and `next dev`.
// A small zip writer so the build needs no zip binary; file modes are kept, so bin/anatomy stays executable.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
const src = join(root, "skills", "anatomy-2");
const out = join(root, "public", "anatomy-2.zip");

// Generated per run, or local only: not part of the skill.
const skip = [/(^|\/)__pycache__(\/|$)/, /^examples\/[^/]+\/(fab|production|history|shots)(\/|$)/, /^examples\/[^/]+\/(view|figure)\.html$/, /\.DS_Store$/];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    const rel = relative(src, p).split("\\").join("/");
    if (skip.some((r) => r.test(rel))) return [];
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(src).sort();
const locals = [];
const centrals = [];
let offset = 0;
// 1980-01-01, so the zip is the same bytes on every build.
const dosTime = 0, dosDate = (0 << 9) | (1 << 5) | 1;

for (const p of files) {
  const name = Buffer.from("anatomy-2/" + relative(src, p).split("\\").join("/"));
  const data = readFileSync(p);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const mode = statSync(p).mode & 0o777 & 0o111 ? 0o100755 : 0o100644;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so unzip applies the mode
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + packed.length;
}

const centralSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(root, "public"), { recursive: true });
const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(out, zip);
console.log(`public/anatomy-2.zip: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB`);
