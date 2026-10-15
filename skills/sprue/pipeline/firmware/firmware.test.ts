// Tests of the generated firmware and of the parts of the firmware in the loop that need no emulator: code.py from
// the routed board, the FAT12 drive, the board model that wires the GPIOs, the keyboard report, and the cache when
// it may not fetch. The emulator itself is tested in fil.test.ts. Run them with
//   node --test skills/sprue/pipeline/firmware/firmware.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pcb } from "../pcb.ts";
import { createBoard } from "../pcb/board.ts";
import { cacheDir, ensureTools, PINNED, treeDigest, untar } from "./cache.ts";
import { codePy, firmwareKeys, readme } from "./code.ts";
import { fat12, lfnChecksum } from "./fat.ts";
import { boardModel, copperNote, faultCases, firmwareCheck, levels, reportCodes, type BoardPad } from "./fil.ts";

/** Runs `fn` in `dir` (the products/ folder's parent) with console.log silenced. */
async function quietly<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const here = process.cwd(), log = console.log;
  try {
    process.chdir(dir);
    console.log = () => {};
    return await fn();
  } finally {
    console.log = log;
    process.chdir(here);
  }
}

let built: Promise<string> | undefined;
let builtIn: string | undefined;
after(() => { if (builtIn) rmSync(builtIn, { recursive: true, force: true }); });
/** The macropad's board, built once into a temporary products/ folder (removed when the tests are done): its product
 * folder. */
function macropad(): Promise<string> {
  built ??= (async () => {
    const tmp = (builtIn = mkdtempSync(join(tmpdir(), "sprue-firmware-")));
    const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
    for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
    assert.equal(await quietly(tmp, () => pcb("macropad")), true);
    return dst;
  })();
  return built;
}
const boardOf = async () => JSON.parse(readFileSync(join(await macropad(), "pcb", "board.json"), "utf8")) as { pads: BoardPad[]; nets: Record<string, string[]>; firmware: ReturnType<typeof firmwareKeys> };

// ---- code.py, from the routed board ----

test("code.py reads each key on the GPIO the routed board wires it to, which is keyMap's scrambled order, in reading order", async () => {
  const dir = await macropad();
  const design = JSON.parse(readFileSync(join(dir, "design.json"), "utf8")) as { keyMap: Record<string, string> };
  const keys = (await boardOf()).firmware!;
  assert.deepEqual(Object.fromEntries(keys.map((k) => [k.key, k.gpio])), design.keyMap);
  assert.deepEqual(keys.map((k) => [k.key, k.kc, k.code]), [...Array(9).keys()].map((i) => [`K${i + 1}`, `N${i + 1}`, 30 + i]));
  const code = readFileSync(join(dir, "firmware", "code.py"), "utf8");
  // The top row first, as the board is seen from the top: K7 K8 K9, then K4 K5 K6, then K1 K2 K3.
  assert.match(code, /pins=\[\n {8}board\.GP8, board\.GP5, board\.GP2,\n {8}board\.GP9, board\.GP6, board\.GP3,\n {8}board\.GP10, board\.GP7, board\.GP4,\n {4}\]/);
  assert.match(code, /keyboard\.keymap = \[\n {4}\[\n {8}KC\.N7, KC\.N8, KC\.N9,\n {8}KC\.N4, KC\.N5, KC\.N6,\n {8}KC\.N1, KC\.N2, KC\.N3,\n/);
  assert.match(code, /KeysScanner\([^)]*value_when_pressed=False,\n {4}pull=True,/);
  assert.match(code, /#   K7 GP8 {4}K8 GP5 {4}K9 GP2\n#   K4 GP9 {4}K5 GP6 {4}K6 GP3\n#   K1 GP10 {3}K2 GP7 {4}K3 GP4\n/);
  const python = spawnSync("python3", ["-I", "-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: code });
  if (!python.error) assert.equal(python.status, 0, String(python.stderr));
  const text = readFileSync(join(dir, "firmware", "README.md"), "utf8");
  assert.match(text, /adafruit-circuitpython-raspberry_pi_pico-en_US-10\.3\.1\.uf2/);
  assert.match(text, /KMK at commit 8afe569/);
  assert.match(text, /\| K1 \| GP10 \| 1 \| `KC\.N1` \|/);
  assert.equal(code, codePy("macropad", keys));
  assert.equal(text, readme("macropad", keys));
});

test("a board with no keys gets no firmware, a key on no GPIO is an error, and a board that fails loses its old firmware", async () => {
  const { api, data } = createBoard("t");
  api.outline(61, 40, 1);
  api.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  assert.equal(firmwareKeys(data), undefined);
  api.place("kailh-mx-hotswap", { ref: "K1", x: -15, y: 0, side: "bottom", nets: { A: "GP2", B: "GND" } });
  assert.throws(() => firmwareKeys(data), /K1 is wired to no GPIO, so no firmware can read it/);

  const tmp = mkdtempSync(join(tmpdir(), "sprue-firmware-fail-")), dst = join(tmp, "products", "macropad");
  cpSync(await macropad(), dst, { recursive: true });
  assert.ok(existsSync(join(dst, "firmware", "code.py")));
  writeFileSync(join(dst, "firmware", "fil.json"), "{}");
  const design = JSON.parse(readFileSync(join(dst, "design.json"), "utf8"));
  [design.keyMap.K1, design.keyMap.K2] = [design.keyMap.K2, design.keyMap.K1];
  writeFileSync(join(dst, "design.json"), JSON.stringify(design));
  assert.equal(await quietly(tmp, () => pcb("macropad")), false);
  for (const f of ["code.py", "README.md"]) assert.ok(!existsSync(join(dst, "firmware", f)), f);
  // The report of a run stays: the scorer holds a failure in it to the zip and the code.py it ran on.
  assert.ok(existsSync(join(dst, "firmware", "fil.json")));
  assert.equal(JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8")).firmware, null);
  // A code.py the pipeline did not write is someone's own, and stays.
  writeFileSync(join(dst, "firmware", "code.py"), "print('mine')\n");
  assert.equal(await quietly(tmp, () => pcb("macropad")), false);
  assert.equal(readFileSync(join(dst, "firmware", "code.py"), "utf8"), "print('mine')\n");
  rmSync(tmp, { recursive: true, force: true });
});

test("a code.py and README.md that sprue pcb wrote as distinta pcb, before the rename, are its own and are written again", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-firmware-old-")), dst = join(tmp, "products", "macropad");
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(await macropad(), dst, { recursive: true });
  writeFileSync(join(dst, "firmware", "code.py"), "# The macropad's firmware. `distinta pcb macropad` wrote it from the routed board.\nprint('old')\n");
  writeFileSync(join(dst, "firmware", "README.md"), "# The macropad's firmware\n\n`distinta pcb macropad` wrote it. `distinta verify macropad` boots it.\n");
  assert.equal(await quietly(tmp, () => pcb("macropad")), true);
  const keys = (JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8")) as { firmware: ReturnType<typeof firmwareKeys> }).firmware!;
  assert.equal(readFileSync(join(dst, "firmware", "code.py"), "utf8"), codePy("macropad", keys));
  assert.equal(readFileSync(join(dst, "firmware", "README.md"), "utf8"), readme("macropad", keys));
  assert.ok(!existsSync(join(dst, "firmware", "code.sprue.py")));
});

// ---- the CIRCUITPY drive ----

/** A FAT12 reader, written apart from the writer: the BIOS parameter block, the FAT chains, the folders and their
 * long names. Gives every file by path. */
function readFat(img: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(img.buffer, img.byteOffset);
  const bps = v.getUint16(11, true), spc = img[13], reserved = v.getUint16(14, true), fats = img[16];
  const rootEntries = v.getUint16(17, true), fatSize = v.getUint16(22, true);
  const rootAt = (reserved + fats * fatSize) * bps, dataAt = rootAt + rootEntries * 32;
  const next = (n: number) => {
    const at = reserved * bps + Math.floor((n * 3) / 2), w = img[at] | (img[at + 1] << 8);
    return n % 2 ? w >> 4 : w & 0xfff;
  };
  const chain = (first: number) => {
    const out: number[] = [];
    for (let n = first; n >= 2 && n < 0xff8; n = next(n)) out.push(n);
    return out;
  };
  const cluster = (n: number) => img.subarray(dataAt + (n - 2) * spc * bps, dataAt + (n - 1) * spc * bps);
  const files = new Map<string, Uint8Array>();
  const walk = (raw: Uint8Array, path: string) => {
    let long: string[] = [];
    for (let at = 0; at + 32 <= raw.length && raw[at]; at += 32) {
      const e = raw.subarray(at, at + 32), ev = new DataView(e.buffer, e.byteOffset, 32);
      if (e[11] === 0x0f) {
        const units = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30].map((o) => ev.getUint16(o, true));
        long.unshift(String.fromCharCode(...units.filter((u) => u !== 0 && u !== 0xffff)));
        continue;
      }
      const short = new TextDecoder().decode(e.subarray(0, 8)).trim() + (e[8] !== 32 ? `.${new TextDecoder().decode(e.subarray(8, 11)).trim()}` : "");
      const name = long.length ? long.join("") : short;
      long = [];
      if (e[11] & 0x08 || name === "." || name === "..") continue;
      const first = ev.getUint16(26, true), size = ev.getUint32(28, true);
      const data = chain(first).map(cluster);
      const all = new Uint8Array(data.length * spc * bps);
      data.forEach((d, i) => all.set(d, i * spc * bps));
      if (e[11] & 0x10) walk(all, `${path}${name}/`);
      else files.set(`${path}${name}`, all.subarray(0, size));
    }
  };
  walk(img.subarray(rootAt, dataAt), "");
  return files;
}

test("the FAT12 drive holds every file, long names and folders and all, as a separate reader and mtools read it", () => {
  const files = [
    { path: "code.py", data: new TextEncoder().encode("print('hi')\n") },
    { path: "kmk/kmk_keyboard.py", data: new Uint8Array(1300).map((_, i) => i % 251) },
    { path: "kmk/modules/string_substitution.py", data: new Uint8Array(700).fill(66) },
    { path: "kmk/modules/__init__.py", data: new Uint8Array(0) },
    { path: "kmk/KEYS.PY", data: new TextEncoder().encode("x") },
    { path: "abcdefghijklm", data: new Uint8Array(3) },
    { path: "kmk/modules/string_substitution2.py", data: new Uint8Array(1) },
  ];
  const img = fat12(files);
  assert.equal(img.length, 1024 * 1024);
  assert.deepEqual([img[510], img[511]], [0x55, 0xaa]);
  assert.equal(new TextDecoder().decode(img.subarray(43, 54)), "CIRCUITPY  ");
  const read = readFat(img);
  assert.deepEqual([...read.keys()].sort(), files.map((f) => f.path).sort());
  for (const f of files) assert.deepEqual(read.get(f.path), f.data, f.path);
  assert.deepEqual(fat12(files), img);
  // The checksum of "KMK_KE~1PY ", as Microsoft's FAT specification computes it.
  assert.equal(lfnChecksum(new TextEncoder().encode("KMK_KE~1PY ")), [..."KMK_KE~1PY "].reduce((s, c) => (((s & 1) << 7) + (s >> 1) + c.charCodeAt(0)) & 0xff, 0));
  // mtools, where it is installed, reads the same files.
  const dir = mkdtempSync(join(tmpdir(), "sprue-fat-"));
  writeFileSync(join(dir, "img"), img);
  mkdirSync(join(dir, "out"));
  const m = spawnSync("mcopy", ["-s", "-n", "-i", join(dir, "img"), "::*", join(dir, "out")]);
  if (!m.error) {
    assert.equal(m.status, 0, String(m.stderr));
    for (const f of files) assert.deepEqual(new Uint8Array(readFileSync(join(dir, "out", f.path))), f.data, f.path);
  }
  rmSync(dir, { recursive: true, force: true });
  assert.throws(() => fat12([{ path: "big", data: new Uint8Array(2 * 1024 * 1024) }]), /do not fit in a 1024 KB drive/);
});

// ---- the board model: what each GPIO sees ----

const pads: BoardPad[] = [
  { id: "U1.3", ref: "U1", num: "3", name: "GND", kind: "gnd" },
  { id: "U1.4", ref: "U1", num: "4", name: "GP2", kind: "gpio" },
  { id: "U1.5", ref: "U1", num: "5", name: "GP3", kind: "gpio" },
  { id: "U1.30", ref: "U1", num: "30", name: "RUN", kind: "control" },
  { id: "U1.36", ref: "U1", num: "36", name: "3V3(OUT)", kind: "power" },
  { id: "K1.A", ref: "K1", num: "A", name: null, kind: "switch" },
  { id: "K1.B", ref: "K1", num: "B", name: null, kind: "switch" },
  { id: "K2.A", ref: "K2", num: "A", name: null, kind: "switch" },
  { id: "K2.B", ref: "K2", num: "B", name: null, kind: "switch" },
];
const NETS = { GP2: ["K1.A", "U1.4"], GP3: ["K2.A", "U1.5"], GND: ["K1.B", "K2.B", "U1.3"] };
const pulledUp = () => ({ pull: "up" as const });
const keys2 = [{ key: "K1", gpio: "GP2", row: 0, col: 0, kc: "N1", code: 30 }, { key: "K2", gpio: "GP3", row: 0, col: 1, kc: "N2", code: 31 }];

test("the harness resolves the pull-ups: a key up reads high, a key down joins its GPIO to ground", () => {
  const m = boardModel(NETS, pads, ["K1", "K2"]);
  assert.deepEqual([...levels(m, [], pulledUp).level].sort(), [[2, true], [3, true]]);
  assert.deepEqual([...levels(m, ["K1"], pulledUp).level].sort(), [[2, false], [3, true]]);
  assert.deepEqual([...levels(m, ["K1", "K2"], pulledUp).level].sort(), [[2, false], [3, false]]);
  // No pull and nothing driving: the GPIO floats and is left alone; one driving sets its piece.
  assert.deepEqual([...levels(m, [], () => ({})).level], []);
  assert.deepEqual([...levels(m, [], (g) => (g === 2 ? { out: false } : { pull: "up" })).level].sort(), [[2, false], [3, true]]);
  assert.equal(copperNote(m, keys2[0]), undefined);
});

test("on a K2 shorted to ground, or two keys swapped, the GPIOs read what that copper gives, and the note says why", () => {
  const short = boardModel({ GP2: NETS.GP2, GND: ["K2.A", "U1.5", ...NETS.GND] }, pads, ["K1", "K2"]);
  assert.deepEqual([...levels(short, [], pulledUp).level].sort(), [[2, true], [3, false]]);
  assert.equal(copperNote(short, keys2[1]), "on the copper read back, K2.A is on ground, so GP3 reads pressed all the time");
  const swapped = boardModel({ GP2: ["K2.A", "U1.4"], GP3: ["K1.A", "U1.5"], GND: NETS.GND }, pads, ["K1", "K2"]);
  assert.deepEqual([...levels(swapped, ["K1"], pulledUp).level].sort(), [[2, true], [3, false]]);
  assert.equal(copperNote(swapped, keys2[0]), "on the copper read back, K1's socket reaches GP3, and code.py reads K1 on GP2");
  const joined = boardModel({ GP2: ["K1.A", "U1.4", "K2.A", "U1.5"], GND: NETS.GND }, pads, ["K1", "K2"]);
  assert.deepEqual([...levels(joined, ["K1"], pulledUp).level].sort(), [[2, false], [3, false]]);
  assert.match(copperNote(joined, keys2[0])!, /K1's socket reaches GP2 and GP3, so one key is two/);
  // A pad on no piece of copper with others is a piece of its own: a socket left off the ground.
  const open = boardModel({ GP2: NETS.GP2, GP3: NETS.GP3, GND: ["K1.B", "U1.3"] }, pads, ["K1", "K2"]);
  assert.deepEqual([...levels(open, ["K2"], pulledUp).level].sort(), [[2, true], [3, true]]);
  assert.match(copperNote(open, keys2[1])!, /K2\.B does not reach ground/);
});

test("a key that joins a supply or RUN to ground is a fault, and every Pico ground pin is ground", () => {
  const supply = boardModel({ GP2: NETS.GP2, S: ["K2.A", "U1.36"], GND: NETS.GND }, pads, ["K1", "K2"]);
  assert.deepEqual(levels(supply, [], pulledUp).faults, []);
  assert.deepEqual(levels(supply, ["K2"], pulledUp).faults, ["it joins U1.36 (3V3(OUT)) to ground: a short across the supply"]);
  const run = boardModel({ GP2: NETS.GP2, R: ["K2.A", "U1.30"], GND: NETS.GND }, pads, ["K1", "K2"]);
  assert.match(levels(run, ["K2"], pulledUp).faults.join(), /pulls U1\.30 \(RUN\) to ground, which resets or switches off the Pico/);
  // The ground pin need not be on the keys' copper: the Pico's own board joins its grounds.
  const apart = boardModel({ GP2: NETS.GP2, GND: ["K1.B", "U1.3"] }, pads, ["K1"]);
  assert.equal(apart.pieces[apart.pieceOf.get("U1.3")!].ground, true);
});

test("the self-test's faults are put into a copy of the netlist: a key to ground, two keys swapped, two GPIO nets joined", () => {
  const cases = faultCases(NETS, ["K1", "K2"]);
  assert.deepEqual(cases.map((c) => c.fault), ["K1's GPIO net joined to ground", "K1 and K2 swapped", "the GPIO nets of K1 and K2 joined"]);
  assert.deepEqual(cases[0].nets, { GP3: NETS.GP3, GND: [...NETS.GND, ...NETS.GP2] });
  assert.deepEqual(cases[1].nets, { GP2: ["K2.A", "U1.4"], GP3: ["K1.A", "U1.5"], GND: NETS.GND });
  assert.deepEqual(cases[2].nets, { GP3: [...NETS.GP3, ...NETS.GP2], GND: NETS.GND });
  assert.deepEqual(NETS.GND, ["K1.B", "K2.B", "U1.3"]);
  // One key takes the fault of its GPIO joined to ground, the one that needs no second key.
  const one = faultCases({ GP2: NETS.GP2, GND: ["K1.B", "U1.3"] }, ["K1"]);
  assert.deepEqual(one.map((c) => [c.fault, c.nets]), [["K1's GPIO net joined to ground", { GND: ["K1.B", "U1.3", ...NETS.GP2] }]]);
});

test("a keyboard report gives its keycodes: the 8-byte boot report and KMK's NKRO bitmap", () => {
  assert.deepEqual(reportCodes(Uint8Array.from([0, 0, 0x1e, 0x22, 0, 0, 0, 0])), [30, 34]);
  assert.deepEqual(reportCodes(Uint8Array.from([0x01, 0, 0x06, 0, 0, 0, 0, 0])), [6, 224]);
  const nkro = new Uint8Array(16);
  nkro[(30 >> 3) + 1] |= 1 << (30 & 7);
  nkro[(38 >> 3) + 1] |= 1 << (38 & 7);
  assert.deepEqual(reportCodes(nkro), [30, 38]);
  assert.deepEqual(reportCodes(new Uint8Array(8)), []);
});

// ---- the cache, when it may not fetch ----

test("git that is there but does not run (the macOS stub) is said to be that, not a network failure", async (t) => {
  // The other pieces are copied from the cache, so nothing is fetched: only KMK is missing.
  const have = join(cacheDir(), "firmware");
  if (!existsSync(join(have, `rp2040js-${PINNED.rp2040js.version}`))) return t.skip("the emulator is not in the cache");
  const empty = mkdtempSync(join(tmpdir(), "sprue-cache-")), was = { cache: process.env.SPRUE_CACHE, path: process.env.PATH };
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  for (const f of readdirSync(have).filter((f) => !f.startsWith("kmk-"))) cpSync(join(have, f), join(empty, "firmware", f), { recursive: true });
  mkdirSync(join(empty, "bin"));
  writeFileSync(join(empty, "bin", "git"), "#!/bin/sh\necho 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun' >&2\nexit 1\n");
  chmodSync(join(empty, "bin", "git"), 0o755);
  try {
    process.env.SPRUE_CACHE = empty;
    process.env.PATH = `${join(empty, "bin")}:${was.path}`;
    const r = await ensureTools();
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.message : "", /^KMK .* is not in the cache, and git, which fetches it, does not run \(xcrun: error: invalid active developer path .*\): on macOS, install the Command Line Tools \(xcode-select --install\), then run it again$/);
  } finally {
    for (const [k, v] of [["SPRUE_CACHE", was.cache], ["PATH", was.path]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("with nothing cached and no fetching, the firmware layer is unverified and says what is missing", async () => {
  const empty = mkdtempSync(join(tmpdir(), "sprue-cache-")), was = process.env.SPRUE_CACHE;
  try {
    process.env.SPRUE_CACHE = empty;
    const t = await ensureTools({ offline: true });
    assert.equal(t.ok, false);
    assert.match(!t.ok ? t.message : "", /CircuitPython 10\.3\.1 for the Raspberry Pi Pico is not in the cache \(.*sprue-cache-.*\/firmware\) and SPRUE_OFFLINE=1 says not to fetch it/);
    // A cached file that is not the one pinned is not used either.
    mkdirSync(join(empty, "firmware"));
    writeFileSync(join(empty, "firmware", "circuitpython-10.3.1-raspberry_pi_pico.uf2"), "not a UF2");
    assert.equal((await ensureTools({ offline: true })).ok, false);
    const dir = await macropad();
    // The read-back's report, as the firmware layer reads it: the board's own nets stand in for it here.
    const board = await boardOf();
    writeFileSync(join(dir, "pcb", "readback.json"), JSON.stringify({ slug: "macropad", inputs: "x", nets: board.nets }));
    const r = await firmwareCheck(dir, { offline: true });
    assert.equal(r.status, "unverified");
    assert.match(r.message, /is not in the cache/);
    rmSync(join(dir, "pcb", "readback.json"));
    assert.equal((await firmwareCheck(dir, { offline: true })).status, "missing");
  } finally {
    if (was === undefined) delete process.env.SPRUE_CACHE;
    else process.env.SPRUE_CACHE = was;
    rmSync(empty, { recursive: true, force: true });
  }
});

test("a folder's digest is of its files' contents and paths, and the tar reader finds the files", () => {
  const dir = mkdtempSync(join(tmpdir(), "sprue-digest-"));
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "a", "x.py"), "x");
  writeFileSync(join(dir, "y.py"), "y");
  const d = treeDigest(dir);
  writeFileSync(join(dir, "y.py"), "Y");
  assert.notEqual(treeDigest(dir), d);
  writeFileSync(join(dir, "y.py"), "y");
  assert.equal(treeDigest(dir), d);
  // A ustar archive by hand: one header block, the data padded to a block, two empty blocks.
  const header = new Uint8Array(512), body = new TextEncoder().encode("hello");
  header.set(new TextEncoder().encode("package/dist/x.js"), 0);
  header.set(new TextEncoder().encode(body.length.toString(8).padStart(11, "0")), 124);
  header[156] = 48;
  const tar = new Uint8Array(512 * 4);
  tar.set(header, 0);
  tar.set(body, 512);
  assert.deepEqual([...untar(tar)].map(([n, b]) => [n, new TextDecoder().decode(b)]), [["package/dist/x.js", "hello"]]);
  rmSync(dir, { recursive: true, force: true });
});
