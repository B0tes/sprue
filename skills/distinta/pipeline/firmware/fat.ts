// A FAT12 volume, written in memory: the CIRCUITPY drive the firmware in the loop (fil.ts) hands the emulated Pico.
// rp2040js does not emulate writes to flash, so CircuitPython cannot format a drive of its own or have files copied
// onto it over USB; the drive is put into the flash image instead, where CircuitPython's filesystem lives on the
// 2 MB Pico (from 1 MB in). Written here rather than with mtools or dosfstools, so nothing needs installing.
// The layout is what `mkfs.fat -F 12` gives a 1 MB volume, which CircuitPython 10.3.1 mounts: 512-byte sectors, one
// per cluster, 1 reserved sector, two FATs, 512 root entries. Names that are not plain upper-case 8.3 get long-name
// (VFAT) entries, as CircuitPython's own drive has. Every date is the same fixed one, so the same files give the
// same image.

export type FatFile = { path: string; data: Uint8Array };

const SECTOR = 512;
const ROOT_ENTRIES = 512;
const FATS = 2;
const ATTR_DIR = 0x10, ATTR_ARCHIVE = 0x20, ATTR_LABEL = 0x08, ATTR_LFN = 0x0f;
/** 2026-01-01, midnight, as FAT stores a date and a time. */
const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1, TIME = 0;

type Dir = { name: string; files: Map<string, Uint8Array>; dirs: Map<string, Dir>; cluster: number };

const ascii = (s: string) => new TextEncoder().encode(s);
/** How many long-name entries a name takes: 13 characters each, then a 0 if there is room. */
const lfnParts = (name: string) => Math.ceil(name.length / 13) || 1;

/** The checksum of an 8.3 name that ties its long-name entries to it. */
export function lfnChecksum(short: Uint8Array): number {
  let sum = 0;
  for (const b of short) sum = (((sum & 1) << 7) + (sum >> 1) + b) & 0xff;
  return sum;
}

const SHORT_OK = /^[A-Z0-9!#$%&'()\-@^_`{}~]+$/;

/** The 8.3 name (11 bytes, space padded) for `name` in a folder whose short names are `taken`, and whether the name
 * needs long-name entries to be kept as it is. */
function shortName(name: string, taken: Set<string>): { short: Uint8Array; long: boolean } {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot + 1) : "";
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, "_");
  const plain = base.length <= 8 && ext.length <= 3 && SHORT_OK.test(base) && (!ext || SHORT_OK.test(ext));
  // The name itself, upper-cased, when it fits 8.3 and is free; else its first letters and a number: KMK_KE~1.PY.
  const fits = base.length <= 8 && ext.length <= 3 && clean(base) === base.toUpperCase() && clean(ext) === ext.toUpperCase();
  const e = clean(ext).slice(0, 3);
  let b = clean(base).slice(0, 8);
  for (let n = 1; !fits || taken.has(`${b}.${e}`); n++) {
    b = `${clean(base).slice(0, 8 - `~${n}`.length)}~${n}`;
    if (!taken.has(`${b}.${e}`)) break;
  }
  taken.add(`${b}.${e}`);
  return { short: ascii(b.padEnd(8, " ") + e.padEnd(3, " ")), long: !plain };
}

/** One 32-byte directory entry. */
function entry(short: Uint8Array, attr: number, cluster: number, size: number): Uint8Array {
  const e = new Uint8Array(32), v = new DataView(e.buffer);
  e.set(short, 0);
  e[11] = attr;
  for (const at of [14, 22]) v.setUint16(at, TIME, true);
  for (const at of [16, 18, 24]) v.setUint16(at, DATE, true);
  v.setUint16(26, cluster & 0xffff, true);
  v.setUint32(28, size, true);
  return e;
}

/** The long-name entries for `name`, last part first, as they come before its 8.3 entry. */
function lfnEntries(name: string, short: Uint8Array): Uint8Array[] {
  const units = [...name].map((c) => c.charCodeAt(0));
  const parts = lfnParts(name);
  const sum = lfnChecksum(short);
  const out: Uint8Array[] = [];
  for (let p = parts; p >= 1; p--) {
    const e = new Uint8Array(32), v = new DataView(e.buffer);
    e[0] = p | (p === parts ? 0x40 : 0);
    e[11] = ATTR_LFN;
    e[13] = sum;
    const slots = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
    slots.forEach((at, i) => {
      const k = (p - 1) * 13 + i;
      v.setUint16(at, k < units.length ? units[k] : k === units.length ? 0 : 0xffff, true);
    });
    out.push(e);
  }
  return out;
}

/** The files as a folder tree. */
function tree(files: FatFile[]): Dir {
  const root: Dir = { name: "", files: new Map(), dirs: new Map(), cluster: 0 };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let d = root;
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { name: p, files: new Map(), dirs: new Map(), cluster: 0 });
      d = d.dirs.get(p)!;
    }
    d.files.set(parts.at(-1)!, f.data);
  }
  return root;
}

/** A FAT12 image of `sectors` sectors holding `files` (paths with "/"), its volume label `label`. */
export function fat12(files: FatFile[], { label = "CIRCUITPY", sectors = 2048 } = {}): Uint8Array {
  const rootSectors = (ROOT_ENTRIES * 32) / SECTOR;
  // The FAT is sized for the clusters that are left once it has its room: count down until they fit.
  let fatSectors = 1;
  while (Math.ceil((((sectors - 1 - FATS * fatSectors - rootSectors) + 2) * 3) / 2 / SECTOR) > fatSectors) fatSectors++;
  const dataStart = 1 + FATS * fatSectors + rootSectors;
  const clusters = sectors - dataStart;
  if (clusters >= 4085) throw new Error(`${sectors} sectors is too large for FAT12`);
  const img = new Uint8Array(sectors * SECTOR), view = new DataView(img.buffer);
  const fat = new Uint16Array(clusters + 2);
  fat[0] = 0xff8;
  fat[1] = 0xfff;
  let next = 2;
  /** Puts `data` in a chain of free clusters and returns the first (0 for nothing). */
  const store = (data: Uint8Array): number => {
    const n = Math.ceil(data.length / SECTOR);
    if (!n) return 0;
    if (next + n > clusters + 2) throw new Error(`the files do not fit in a ${(sectors * SECTOR) / 1024} KB drive`);
    const first = next;
    for (let i = 0; i < n; i++) {
      img.set(data.subarray(i * SECTOR, (i + 1) * SECTOR), (dataStart + next - 2) * SECTOR);
      fat[next] = i === n - 1 ? 0xfff : next + 1;
      next++;
    }
    return first;
  };
  /** The entries of folder `d`, whose own cluster is `own` (0 for the top folder), storing what it holds as it goes. */
  const entries = (d: Dir, own: number): Uint8Array[] => {
    const out: Uint8Array[] = [];
    const taken = new Set<string>();
    const named = (name: string, attr: number, cluster: number, size: number) => {
      const { short, long } = shortName(name, taken);
      if (long) out.push(...lfnEntries(name, short));
      out.push(entry(short, attr, cluster, size));
    };
    for (const [name, data] of [...d.files].sort(([a], [b]) => a.localeCompare(b))) named(name, ATTR_ARCHIVE, store(data), data.length);
    for (const [name, sub] of [...d.dirs].sort(([a], [b]) => a.localeCompare(b))) named(name, ATTR_DIR, folder(sub, own), 0);
    return out;
  };
  /** Stores a folder below the top one and returns its first cluster. Its clusters are taken before its children's,
   * so its "." entry can name them, which needs its entries counted first. */
  const folder = (d: Dir, parent: number): number => {
    const names = [...d.files.keys(), ...d.dirs.keys()];
    const count = 2 + names.reduce((s, n) => s + 1 + (shortName(n, new Set()).long ? lfnParts(n) : 0), 0);
    const first = store(new Uint8Array(Math.ceil((count * 32) / SECTOR) * SECTOR));
    d.cluster = first;
    const dots = [entry(ascii(".          "), ATTR_DIR, first, 0), entry(ascii("..         "), ATTR_DIR, parent, 0)];
    [...dots, ...entries(d, first)].forEach((e, i) => img.set(e, (dataStart + first - 2) * SECTOR + i * 32));
    return first;
  };

  const root = tree(files);
  const volume = ascii(label.toUpperCase().slice(0, 11).padEnd(11, " "));
  const rootList = [entry(volume, ATTR_LABEL, 0, 0), ...entries(root, 0)];
  if (rootList.length > ROOT_ENTRIES) throw new Error(`the drive's top folder holds at most ${ROOT_ENTRIES} entries`);
  rootList.forEach((e, i) => img.set(e, (1 + FATS * fatSectors) * SECTOR + i * 32));

  // The boot sector: the BIOS parameter block mkfs.fat writes, and the signature.
  img.set([0xeb, 0x3c, 0x90], 0);
  img.set(ascii("DISTINTA"), 3);
  view.setUint16(11, SECTOR, true);
  img[13] = 1; // sectors per cluster
  view.setUint16(14, 1, true); // reserved sectors
  img[16] = FATS;
  view.setUint16(17, ROOT_ENTRIES, true);
  view.setUint16(19, sectors, true);
  img[21] = 0xf8; // a fixed disk
  view.setUint16(22, fatSectors, true);
  view.setUint16(24, 16, true); // sectors per track and heads, which nothing reads
  view.setUint16(26, 2, true);
  img[36] = 0x80;
  img[38] = 0x29; // the extended boot signature: a serial number, a label and a type follow
  view.setUint32(39, 0x44495354, true);
  img.set(volume, 43);
  img.set(ascii("FAT12   "), 54);
  img[510] = 0x55;
  img[511] = 0xaa;

  // The FAT, 12 bits an entry, twice.
  const table = new Uint8Array(fatSectors * SECTOR);
  fat.forEach((v, n) => {
    const at = Math.floor((n * 3) / 2);
    if (n % 2 === 0) {
      table[at] = v & 0xff;
      table[at + 1] = (table[at + 1] & 0xf0) | ((v >> 8) & 0x0f);
    } else {
      table[at] = (table[at] & 0x0f) | ((v << 4) & 0xf0);
      table[at + 1] = (v >> 4) & 0xff;
    }
  });
  for (let f = 0; f < FATS; f++) img.set(table, (1 + f * fatSectors) * SECTOR);
  return img;
}
