// The firmware in the loop: the keypad's own firmware (firmware/code.py, code.ts), on real CircuitPython and KMK,
// on an emulated RP2040 (rp2040js), wired to the copper the read-back found in the shipped Gerbers
// (pcb/readback.json, not the board code's nets and not design.json). Each key is pressed by joining its socket's two
// pieces of copper, so what reaches a GPIO is what the board would put there; each key must make the keyboard
// report its own keycode and nothing else, and each pair of keys both of theirs, and every key must let go. That
// catches a key on the wrong GPIO, a dead key, a key held down by a short to ground, and two GPIO nets shorted
// together, as the firmware a user flashes would meet them.
// The pieces it runs on are pinned and cached (cache.ts). rp2040js needs four workarounds, each explained where it
// is made: the CIRCUITPY drive as a FAT12 image in flash, BOOTSEL held released, the pull-ups resolved here, and the
// keycodes read from a KMK hook (harness.py).
// `sprue verify` runs it (firmwareCheck) and writes firmware/fil.json; with no network and nothing cached the
// firmware layer is unverified, which is not a pass. What it runs is the board's own firmware, the code.py
// `sprue pcb` wrote for these keys (board.json `firmware` and `firmwareCode`), so what it finds is of the copper;
// a code.py of the user's own beside it is run after (yourFirmware), to say what each key of it types, and what that
// finds is the user's and not the board's.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureTools, PINNED, type Tools } from "./cache.ts";
import { codePy, KEYS, type FirmwareKey } from "./code.ts";
import { fat12, type FatFile } from "./fat.ts";

export const HARNESS = join(import.meta.dirname, "harness.py");

// ---- the board, as the firmware meets it ---------------------------------------------------------------------

/** A pad as board.json lists it. */
export type BoardPad = { id: string; ref: string; num: string; name: string | null; kind: string | null };
/** One piece of copper and what of the Pico is on it. */
export type Piece = { pads: string[]; gpios: number[]; ground: boolean; supplies: string[]; controls: string[] };
export type Model = { pieces: Piece[]; pieceOf: Map<string, number>; keys: Map<string, { a: number; b: number }> };

const gpioNumber = (name: string | null) => (name && /^GP(\d+)/.test(name) ? Number(/^GP(\d+)/.exec(name)![1]) : undefined);

/** The board from the read-back's nets (each piece of copper with two pads or more, by pad id): every other pad is a
 * piece of its own. Every ground pin of the Pico is ground whether the copper joins it or not, since the Pico's own
 * board does; a supply pin is held high by the Pico. `keys` are the sockets. */
export function boardModel(nets: Record<string, string[]>, pads: BoardPad[], keys: string[]): Model {
  const pieceOf = new Map<string, number>();
  const groups = Object.values(nets).map((ids) => [...ids]);
  groups.forEach((ids, i) => ids.forEach((id) => pieceOf.set(id, i)));
  for (const p of pads) if (!pieceOf.has(p.id)) pieceOf.set(p.id, groups.push([p.id]) - 1);
  const byId = new Map(pads.map((p) => [p.id, p]));
  const pieces = groups.map((ids): Piece => {
    const on = ids.map((id) => byId.get(id)).filter((p): p is BoardPad => !!p);
    return {
      pads: ids,
      gpios: on.filter((p) => p.kind === "gpio").map((p) => gpioNumber(p.name)!).filter((g) => g !== undefined),
      ground: on.some((p) => p.kind === "gnd"),
      supplies: on.filter((p) => p.kind === "power").map((p) => `${p.id} (${p.name})`),
      controls: on.filter((p) => p.kind === "control").map((p) => `${p.id} (${p.name})`),
    };
  });
  return { pieces, pieceOf, keys: new Map(keys.map((k) => [k, { a: pieceOf.get(`${k}.A`) ?? -1, b: pieceOf.get(`${k}.B`) ?? -1 }])) };
}

/** What a GPIO does itself: drives a level (an output) or pulls one (an input with a pull resistor on). */
export type PinState = { out?: boolean; pull?: "up" | "down" };

/** The level each GPIO sees with the `pressed` keys down, a pressed key joining its two pieces. Ground wins (a key's
 * whole job is to pull its GPIO to it), then a supply, then a GPIO driving, then a pull-up or pull-down; a piece with
 * none of these floats and is left out. A supply or a control pin (RUN, 3V3_EN) put on ground is a fault: the
 * regulator shorted, or the Pico reset or switched off. */
export function levels(model: Model, pressed: Iterable<string>, pin: (gpio: number) => PinState): { level: Map<number, boolean>; faults: string[] } {
  const parent = model.pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const k of pressed) {
    const { a, b } = model.keys.get(k) ?? { a: -1, b: -1 };
    if (a >= 0 && b >= 0) parent[find(a)] = find(b);
  }
  const groups = new Map<number, Piece[]>();
  model.pieces.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  const level = new Map<number, boolean>(), faults: string[] = [];
  for (const g of groups.values()) {
    const gpios = g.flatMap((p) => p.gpios), ground = g.some((p) => p.ground);
    const supplies = g.flatMap((p) => p.supplies), controls = g.flatMap((p) => p.controls);
    if (ground && supplies.length) faults.push(`it joins ${supplies.join(" and ")} to ground: a short across the supply`);
    if (ground && controls.length) faults.push(`it pulls ${controls.join(" and ")} to ground, which resets or switches off the Pico`);
    const states = gpios.map(pin);
    const v = ground ? false : supplies.length ? true : states.find((s) => s.out !== undefined)?.out ??
      (states.some((s) => s.pull === "up") ? true : states.some((s) => s.pull === "down") ? false : undefined);
    if (v !== undefined) for (const n of gpios) level.set(n, v);
  }
  return { level, faults };
}

/** What a key's copper says about it, for an error: why the firmware may not see it as it should. */
export function copperNote(model: Model, key: FirmwareKey): string | undefined {
  const { a, b } = model.keys.get(key.key) ?? { a: -1, b: -1 };
  const pa = model.pieces[a], pb = model.pieces[b];
  const gp = (ns: number[]) => ns.map((n) => `GP${n}`).join(" and ");
  if (!pa || !pb) return `the read-back has no ${!pa ? `${key.key}.A` : `${key.key}.B`}`;
  if (pa.ground) return `on the copper read back, ${key.key}.A is on ground, so ${pa.gpios.length ? gp(pa.gpios) : "its GPIO"} reads pressed all the time`;
  if (!pb.ground) return `on the copper read back, ${key.key}.B does not reach ground, so the key cannot pull its GPIO low`;
  if (!pa.gpios.length) return `on the copper read back, ${key.key}.A reaches no GPIO`;
  if (pa.gpios.length > 1) return `on the copper read back, ${key.key}'s socket reaches ${gp(pa.gpios)}, so one key is two`;
  if (`GP${pa.gpios[0]}` !== key.gpio) return `on the copper read back, ${key.key}'s socket reaches GP${pa.gpios[0]}, and code.py reads ${key.key} on ${key.gpio}`;
  return undefined;
}

// ---- the emulated Pico ----------------------------------------------------------------------------------------

/** One fault-finding run over the keys: on one netlist, every key and every pair of keys; `stopAtFirst` ends it at
 * the first key that is wrong (enough for a self-test case). */
export type Case = {
  id: string; nets: Record<string, string[]>; stopAtFirst?: boolean;
  /** Only to see what each key types, on its own: a firmware of the user's own, whose keymap is not known here. */
  observe?: boolean;
};
export type Press = { keys: string[]; want: number[]; got: number[]; ok: boolean };
export type CaseResult = { id: string; ok: boolean; errors: string[]; presses: Press[] };
export type FirmwareRun = {
  /** The firmware started and every case ran; each case says whether its keys came out right. */
  ok: boolean; started: boolean; errors: string[]; cases: CaseResult[];
  /** The run used up the computer's time it is given (cpuMs) before every case had run: a slow or busy computer, not
   * a fault of the board, so it proves nothing either way. */
  timedOut?: boolean;
  stats: { bootSimMs: number; simMs: number; seconds: number }; serial: string;
};

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
/** KMK's names of the modifiers, by their codes 224 to 231 (USB HID usage tables, keyboard page). */
const MODIFIERS = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
const nameOf = (code: number) => {
  const k = KEYS.find((x) => x.code === code);
  return k ? `KC.${k.kc}` : code >= 224 && code <= 231 ? `KC.${MODIFIERS[code - 224]}` : `keycode ${code}`;
};
const said = (codes: number[]) => (codes.length ? `${codes.map(nameOf).join(" and ")} (${codes.join(", ")})` : "nothing");
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The keycodes in a keyboard report: the 8-byte boot report (modifiers, a reserved byte, 6 keys) or KMK's NKRO
 * bitmap (modifiers, then a bit for each code). Modifiers come back as codes 224 to 231. */
export function reportCodes(bytes: Uint8Array): number[] {
  const mods = [...Array(8).keys()].filter((b) => bytes[0] & (1 << b)).map((b) => 224 + b);
  const keys = bytes.length === 8 ? [...bytes.subarray(2)].filter(Boolean)
    : [...bytes.subarray(1)].flatMap((v, i) => [...Array(8).keys()].filter((b) => v & (1 << b)).map((b) => i * 8 + b));
  return [...keys, ...mods].sort((x, y) => x - y);
}

/** Every file under `dir`, for the drive. */
function files(dir: string, under: string): FatFile[] {
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, under) : [{ path: `kmk/${relative(under, p).split("\\").join("/")}`, data: readFileSync(p) }];
  });
}

/** Boots `firmware` (code.py's text) with KMK on the emulated Pico, then runs each case on it, one after the other,
 * on one boot: a case only changes the copper the GPIOs are wired to, which the firmware cannot tell apart from a
 * board swapped under it, and each starts with every key released and the keyboard reporting nothing. */
export async function runFirmware(o: {
  firmware: string; pads: BoardPad[]; keys: FirmwareKey[]; cases: Case[]; tools: Tools; cpuMs?: number;
}): Promise<FirmwareRun> {
  const started = Date.now();
  // The run's budget is the computer's processor time, not the clock's: a computer put to sleep, or the process
  // stopped, uses none of it.
  const cpu = () => {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  };
  const cpuStart = cpu(), budget = o.cpuMs ?? 600_000;
  const rp = await import(pathToFileURL(join(o.tools.rp2040js, "dist", "esm", "index.js")).href);
  const sim = new rp.Simulator();
  const mcu = sim.rp2040;
  const logged: string[] = [];
  mcu.logger = { debug() {}, info() {}, warn() {}, error: (c: string, m: string) => logged.push(`${c}: ${m}`) };
  // The boot ROM is a TypeScript file of hex words in rp2040js's repository: read as text, its words parsed.
  mcu.loadBootrom(new Uint32Array([...readFileSync(o.tools.bootrom, "utf8").matchAll(/0x([0-9a-f]{8})/gi)].map((m) => parseInt(m[1], 16))));
  // The UF2: 512-byte blocks (magic 0x0A324655, 0x9E5D5157), each with its flash address at 12, its size at 16 and
  // its data from 32.
  const uf2 = readFileSync(o.tools.uf2);
  for (let at = 0; at + 512 <= uf2.length; at += 512) {
    const v = new DataView(uf2.buffer, uf2.byteOffset + at, 512);
    if (v.getUint32(0, true) !== 0x0a324655 || v.getUint32(4, true) !== 0x9e5d5157) continue;
    mcu.flash.set(uf2.subarray(at + 32, at + 32 + v.getUint32(16, true)), v.getUint32(12, true) - 0x10000000);
  }
  // Workaround 1: rp2040js does not emulate writes to flash, so CircuitPython can neither format its CIRCUITPY drive
  // nor be given files over USB. The drive goes into the flash image instead, as a FAT12 volume (fat.ts) where
  // CircuitPython keeps it on the 2 MB Pico, 1 MB in: KMK's kmk folder, the firmware under test as firmware.py, and
  // the harness (harness.py) as the code.py that runs it.
  const drive = fat12([
    { path: "code.py", data: readFileSync(HARNESS) },
    { path: "firmware.py", data: new TextEncoder().encode(o.firmware) },
    ...files(o.tools.kmk, o.tools.kmk),
  ]);
  mcu.flash.set(drive, 0x100000);
  // Workaround 2: the Pico's BOOTSEL button is read on the flash's chip-select line, the QSPI SS bit (bit 1) of SIO's
  // GPIO_HI_IN. rp2040js leaves it low, which CircuitPython takes for the button held, so it would start in safe
  // mode; the bit reads high here, the button released.
  const read = mcu.sio.readUint32.bind(mcu.sio);
  mcu.sio.readUint32 = (offset: number) => (offset === 0x008 ? read(offset) | 2 : read(offset));

  // The serial console, over the emulated USB: the harness's lines and anything CircuitPython prints.
  const cdc = new rp.USBCDC(mcu.usbCtrl);
  let serial = "", pending = "", ready = false;
  const reports: { at: number; codes: number[] }[] = [];
  const simMs = () => Number(sim.clock.nanos) / 1e6;
  cdc.onSerialData = (buf: Uint8Array) => {
    const text = Buffer.from(buf).toString("latin1");
    serial = (serial + text).slice(-20000);
    pending += text;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).replace(/\r$/, "");
      pending = pending.slice(nl + 1);
      const m = /SPRUE (READY|HID (\d+) ([0-9a-f]+))/.exec(line);
      if (m?.[1] === "READY") ready = true;
      else if (m?.[2]) reports.push({ at: simMs(), codes: reportCodes(Buffer.from(m[3], "hex")) });
    }
  };
  const last = () => reports.at(-1)?.codes ?? [];

  // Workaround 3: rp2040js does not apply a pad's pull-up or pull-down to its input, and knows nothing of the board.
  // Whenever a GPIO's state changes, or a key moves, each piece of copper's level is worked out here (levels()) and
  // set on the inputs of the GPIOs on it.
  let model: Model = boardModel({}, o.pads, []);
  let pressed = new Set<string>();
  const faults: string[] = [];
  const state = (g: number): PinState => {
    const p = mcu.gpio[g];
    if (p.outputEnable) return { out: p.outputValue };
    return { pull: p.pullupEnabled && !p.pulldownEnabled ? "up" : p.pulldownEnabled && !p.pullupEnabled ? "down" : undefined };
  };
  const apply = () => {
    const r = levels(model, pressed, state);
    faults.push(...r.faults);
    for (const [g, v] of r.level) if (!mcu.gpio[g].outputEnable && mcu.gpio[g].rawInputValue !== v) mcu.gpio[g].setInputValue(v);
  };
  const used = new Set(o.pads.map((p) => (p.kind === "gpio" ? gpioNumber(p.name) : undefined)).filter((g): g is number => g !== undefined && g < 30));
  for (const g of used) mcu.gpio[g].addListener(() => apply());

  // Waiting is in the emulated Pico's time, not the computer's, so a slow computer gives the same run.
  const after = (ms: number) => new Promise<void>((done) => sim.clock.createAlarm(() => done()).schedule(ms * 1e6));
  const until = async (ok: () => boolean, ms: number) => {
    const end = simMs() + ms;
    while (!ok()) {
      if (simMs() >= end) return false;
      if (cpu() - cpuStart > budget) {
        out.timedOut = true;
        throw new Error(`the emulator ran out of time (${Math.round(budget / 1000)} s of the computer's processor time) before every case had run`);
      }
      await after(2);
    }
    return true;
  };

  const out: FirmwareRun = { ok: false, started: false, errors: [], cases: [], stats: { bootSimMs: 0, simMs: 0, seconds: 0 }, serial: "" };
  const finish = () => {
    sim.stop();
    out.stats = { bootSimMs: out.stats.bootSimMs, simMs: Math.round(simMs()), seconds: Math.round((Date.now() - started) / 100) / 10 };
    out.serial = serial.slice(-2000);
    out.ok = out.started && !out.errors.length;
    return out;
  };
  mcu.core.PC = 0x10000000;
  sim.execute();
  try {
    // CircuitPython boots, mounts the drive, runs the harness and the firmware; KMK sets up its USB HID devices.
    if (!(await until(() => ready, 60_000))) {
      const tail = serial.trim().split("\n").slice(-4).join(" | ").replace(/\x1b\][^\\]*\\|\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
      out.errors.push(`the firmware never became a keyboard in 60 s of the emulated Pico's time: ${tail || "it printed nothing"}${logged.length ? `; the emulator said: ${logged[0]}` : ""}`);
      return finish();
    }
    out.started = true;
    out.stats.bootSimMs = Math.round(simMs());
    for (const c of o.cases) out.cases.push(await sweep(c));
    return finish();
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
    return finish();
  }

  /** One case: the keys released and the keyboard quiet, then every key, then every pair. */
  async function sweep(c: Case): Promise<CaseResult> {
    const r: CaseResult = { id: c.id, ok: true, errors: [], presses: [] };
    const byKey = new Map(o.keys.map((k) => [k.key, k]));
    const keys = [...o.keys].sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
    model = boardModel(c.nets, o.pads, keys.map((k) => k.key));
    pressed = new Set();
    faults.length = 0;
    apply();
    const note = (ks: string[]) => [...new Set(ks.map((k) => copperNote(model, byKey.get(k)!)).filter(Boolean))].join("; ");
    const fail = (text: string) => {
      r.ok = false;
      r.errors.push(text);
      return !c.stopAtFirst;
    };
    // Quiet: with every key up, a few of the keypad's 20 ms scans for the new copper to be seen, then no report for
    // 100 ms and nothing held.
    await after(100);
    await until(() => last().length === 0 && simMs() - (reports.at(-1)?.at ?? 0) > 100, 1000);
    if (last().length) {
      const held = keys.filter((k) => last().includes(k.code)).map((k) => k.key);
      if (!fail(`with no key pressed the keyboard reports ${said(last())}${held.length ? `: ${note(held) || `${held.join(" and ")} reads pressed`}` : ""}`)) return r;
    }
    if (faults.length && !fail(`with no key pressed, the copper read back is wrong: ${[...new Set(faults)].join("; ")}`)) return r;
    const press = async (ks: FirmwareKey[]): Promise<boolean> => {
      // Observed, a key types what the firmware's keymap says, which is whatever it reports.
      const want = ks.map((k) => k.code).sort((a, b) => a - b);
      const names = ks.map((k) => k.key).join(" and ");
      faults.length = 0;
      pressed = new Set(ks.map((k) => k.key));
      apply();
      // The report changes once per KMK loop, a key at a time, so a second code a short adds comes a loop later.
      await until(() => (c.observe ? last().length > 0 : same(last(), want)), 200);
      await after(30);
      const got = last(), shorted = [...new Set(faults)];
      pressed = new Set();
      apply();
      const released = await until(() => last().length === 0, 200);
      await after(10);
      const p: Press = { keys: ks.map((k) => k.key), want: c.observe ? got : want, got, ok: (c.observe || same(got, want)) && released && !shorted.length };
      r.presses.push(p);
      if (p.ok) return true;
      const why = note(p.keys);
      const wanted = `${said(want)} expected`;
      if (!c.observe && !same(got, want)) return fail(`${names} ${ks.length > 1 ? "together type" : "types"} ${said(got)}, ${wanted}${why ? `: ${why}` : ""}`);
      if (shorted.length) return fail(`pressing ${names}: ${shorted.join("; ")}`);
      return fail(`after ${names} ${ks.length > 1 ? "are" : "is"} let go the keyboard still reports ${said(last())}${why ? `: ${why}` : ""}`);
    };
    for (const k of keys) if (!(await press([k]))) return r;
    if (c.observe) return r;
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) if (!(await press([keys[i], keys[j]]))) return r;
    return r;
  }
}

// ---- sprue verify's firmware layer -----------------------------------------------------------------------------

/** The faults the self-test puts into the read-back's netlist, each of which the run must catch: a key's GPIO net
 * joined to ground, and with two keys or more, two keys' GPIO nets swapped and two keys' GPIO nets joined. */
export function faultCases(nets: Record<string, string[]>, keys: string[]): (Case & { fault: string })[] {
  const sorted = [...keys].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!sorted.length) return [];
  const mid = sorted[Math.floor((sorted.length - 1) / 2)], [k1, k2] = sorted, [y1, y2] = sorted.slice(-2);
  const copy = () => Object.fromEntries(Object.entries(nets).map(([n, ps]) => [n, [...ps]]));
  const netOf = (n: Record<string, string[]>, pad: string) => Object.keys(n).find((k) => n[k].includes(pad));
  const join = (n: Record<string, string[]>, a: string, b: string) => {
    const na = netOf(n, a), nb = netOf(n, b);
    if (!na || !nb || na === nb) return n;
    n[nb].push(...n[na]);
    delete n[na];
    return n;
  };
  const swap = (n: Record<string, string[]>, a: string, b: string) => {
    const na = netOf(n, a), nb = netOf(n, b);
    if (na && nb) {
      n[na] = n[na].map((p) => (p === a ? b : p));
      n[nb] = n[nb].map((p) => (p === b ? a : p));
    }
    return n;
  };
  // A key to ground needs one key; a swap and two GPIOs joined need two.
  const short = { id: "short", fault: `${mid}'s GPIO net joined to ground`, nets: join(copy(), `${mid}.A`, `${mid}.B`), stopAtFirst: true };
  if (sorted.length < 2) return [short];
  return [
    short,
    { id: "swap", fault: `${k1} and ${k2} swapped`, nets: swap(copy(), `${k1}.A`, `${k2}.A`), stopAtFirst: true },
    { id: "gpios", fault: `the GPIO nets of ${y1} and ${y2} joined`, nets: join(copy(), `${y1}.A`, `${y2}.A`), stopAtFirst: true },
  ];
}

/** What a firmware of the user's own types, run after the board's on the same copper: each key on its own. */
export type Yours = {
  file: string; sha256: string; ok: boolean; checked: string; errors: string[];
  /** Each key and what it types, as KMK's names ("KC.LCTL and KC.C"), or "nothing". */
  types: { key: string; codes: number[]; names: string }[];
};

/** firmware/fil.json. */
export type Fil = {
  inputs: string | null; slug: string; ok: boolean; note: string;
  /** The board's own firmware, which the run is of: the code.py sprue pcb wrote for these keys (board.json
   * `firmwareCode`), firmware/code.py or, beside a code.py of the user's own, firmware/code.sprue.py. */
  firmware: { file: string; sha256: string };
  /** The read-back the run was wired to, and the zip it read (by its sha256: what the scorer ties a failure to). */
  netlist: { file: string; zip: string | null; zipSha256: string | null; sha256: string };
  tools: { circuitpython: string; kmk: string; rp2040js: string };
  keys: FirmwareKey[]; checked: string; errors: string[]; presses: Press[];
  selfTest: { ok: boolean; cases: { fault: string; ok: boolean; got: string[] }[] };
  stats: FirmwareRun["stats"] & { presses: number };
  /** firmware/code.py when it is the user's own, run after on the same copper; a failure here is the user's code's,
   * not the board's, and refuses nothing but shipping that code.py. */
  yours?: Yours;
};

/** How the firmware layer went: "pass" or "fail" with its report, "unverified" when it could not run for want of
 * what it runs on, "missing" when there is nothing to run (no firmware, or no read-back to wire it to). */
export type FirmwareCheck = { status: "pass" | "fail" | "unverified" | "missing"; report?: Fil; message: string };

type Board = { slug: string; pads: BoardPad[]; firmware?: FirmwareKey[] | null; firmwareCode?: { file: string; sha256: string } | null };
type ReadbackJson = { inputs?: string; slug: string; nets: Record<string, string[]>; files?: { zip?: { name?: string; sha256?: string } } };

/** The board and its read-back, as the firmware is wired to them, or why there is nothing to run. */
function wiring(dir: string): { board: Board; readback: ReadbackJson; keys: FirmwareKey[]; rb: string } | { missing: string } {
  const rb = join(dir, "pcb", "readback.json"), bj = join(dir, "pcb", "board.json");
  if (!existsSync(rb) || !existsSync(bj)) return { missing: "there is no read-back of the files (pcb/readback.json) to wire the firmware to" };
  const board = JSON.parse(readFileSync(bj, "utf8")) as Board;
  const keys = board.firmware ?? [];
  if (!keys.length) return { missing: "pcb/board.json lists no keys for the firmware" };
  return { board, readback: JSON.parse(readFileSync(rb, "utf8")) as ReadbackJson, keys, rb };
}

/** The board's own firmware: the code.py sprue pcb wrote for its keys, made again from board.json and held to the
 * sha256 board.json gives it, so a code.py edited or replaced in firmware/ does not stand in for it. */
export function boardFirmware(board: Board): { file: string; text: string } | undefined {
  if (!board.firmware?.length || !board.firmwareCode) return undefined;
  const text = codePy(board.slug, board.firmware);
  return sha256(text) === board.firmwareCode.sha256 ? { file: board.firmwareCode.file, text } : undefined;
}

/** Runs the firmware in the loop for products/<dir>: the board's own firmware (boardFirmware) on the read-back's
 * copper (pcb/readback.json, with pcb/board.json for which pad is which pin), and its self-test, on one boot. Returns
 * the report, for firmware/fil.json. */
export async function firmwareCheck(dir: string, { offline, cpuMs }: { offline?: boolean; cpuMs?: number } = {}): Promise<FirmwareCheck> {
  const w = wiring(dir);
  if ("missing" in w) return { status: "missing", message: w.missing };
  const { board, readback, keys, rb } = w;
  const own = boardFirmware(board);
  if (!own) return { status: "missing", message: "pcb/board.json's firmware is not the one this kit writes for its keys: run sprue pcb, which writes it again" };
  const got = await ensureTools({ offline });
  if (!got.ok) return { status: "unverified", message: got.message };
  const faults = faultCases(readback.nets, keys.map((k) => k.key));
  const run = await runFirmware({
    firmware: own.text, pads: board.pads, keys, tools: got.tools, cpuMs,
    cases: [{ id: "board", nets: readback.nets }, ...faults],
  });
  // Out of time is the computer's doing, not the board's: no report, so no failure is held against the zip.
  if (run.timedOut) return { status: "unverified", message: `${run.errors[0]}, which says nothing about the board either way` };
  const main = run.cases.find((c) => c.id === "board");
  const selfTest = faults.map((f) => {
    const c = run.cases.find((x) => x.id === f.id);
    return { fault: f.fault, ok: !!c && !c.ok, got: c?.errors.slice(0, 2) ?? [] };
  });
  const errors = [...run.errors, ...(main?.errors ?? [])];
  const pairs = (keys.length * (keys.length - 1)) / 2;
  const report: Fil = {
    inputs: readback.inputs ?? null, slug: readback.slug, ok: run.ok && !!main?.ok && !errors.length && selfTest.length > 0 && selfTest.every((c) => c.ok),
    note: "our own check, on an emulated Pico; not a fab's, and not the board itself",
    firmware: { file: own.file, sha256: sha256(own.text) },
    netlist: { file: "pcb/readback.json", zip: readback.files?.zip?.name ?? null, zipSha256: readback.files?.zip?.sha256 ?? null, sha256: sha256(readFileSync(rb)) },
    tools: { circuitpython: PINNED.circuitpython.version, kmk: PINNED.kmk.commit, rp2040js: PINNED.rp2040js.version },
    keys,
    checked: `${PINNED.circuitpython.name} and KMK ${PINNED.kmk.commit.slice(0, 7)} on rp2040js ${PINNED.rp2040js.version} ran the board's firmware (${own.file}) on the copper the read-back found; ` +
      `${keys.length === 1 ? "its 1 key" : `each of the ${keys.length} keys`}${pairs ? `, and each of the ${pairs} pair${pairs === 1 ? "" : "s"},` : ""} must type its own keycodes and let go`,
    errors, presses: main?.presses ?? [],
    selfTest: { ok: selfTest.length > 0 && selfTest.every((c) => c.ok), cases: selfTest },
    stats: { ...run.stats, presses: main?.presses.length ?? 0 },
  };
  return { status: report.ok ? "pass" : "fail", report, message: "" };
}

/** Whether firmware/code.py is a firmware of the user's own: there, and not the board's (board.json `firmwareCode`). */
export function isYours(dir: string): boolean {
  const code = join(dir, "firmware", "code.py"), bj = join(dir, "pcb", "board.json");
  if (!existsSync(code) || !existsSync(bj)) return false;
  const board = JSON.parse(readFileSync(bj, "utf8")) as Board;
  return !!board.firmware?.length && sha256(readFileSync(code)) !== board.firmwareCode?.sha256;
}

/** The report of a code.py of the user's own whose run could not be made: a failure of the code's, not the board's. */
export const yoursFailed = (text: string, error: unknown): Yours => ({
  file: "firmware/code.py", sha256: sha256(text), ok: false, errors: [`it could not be run: ${error instanceof Error ? error.message : String(error)}`],
  checked: `your firmware/code.py, on the same emulated Pico and copper: it must start as a keyboard, and each key on its own type what your keymap gives it and let go`, types: [],
});

/** Runs firmware/code.py, the user's own, on the same copper as the board's firmware ran on: whether it starts as a
 * keyboard, and what each key types on its own, which is its keymap's to say. It fails only for what no keymap means:
 * not starting, a key held with none pressed, one that does not let go, or no key typing anything at all (a key
 * that types nothing alone may be a layer key). */
export async function yourFirmware(dir: string, { offline }: { offline?: boolean } = {}): Promise<Yours | undefined> {
  const w = wiring(dir);
  if ("missing" in w || !isYours(dir)) return undefined;
  const got = await ensureTools({ offline });
  if (!got.ok) return undefined;
  const text = readFileSync(join(dir, "firmware", "code.py"), "utf8");
  const { checked } = yoursFailed(text, "");
  let run: FirmwareRun;
  try {
    run = await runFirmware({ firmware: text, pads: w.board.pads, keys: w.keys, tools: got.tools, cases: [{ id: "yours", nets: w.readback.nets, observe: true }] });
  } catch (error) {
    // Its run could not start (a code.py too large for the drive): that is the code's, and the board's run stands.
    return yoursFailed(text, error);
  }
  const c = run.cases[0];
  const errors = [...run.errors, ...(c?.errors ?? [])];
  if (run.started && c && !c.errors.length && c.presses.every((p) => !p.got.length))
    errors.push(`no key types anything: the pins or the keymap in your code.py do not read the keys as the board wires them (each key joins its GPIO to ground)`);
  return {
    file: "firmware/code.py", sha256: sha256(text), ok: run.started && !errors.length, errors, checked,
    types: (c?.presses ?? []).map((p) => ({ key: p.keys[0], codes: p.got, names: p.got.length ? p.got.map(nameOf).join(" and ") : "nothing" })),
  };
}
