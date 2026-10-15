// Tests of the firmware in the loop on the emulator: the macropad's generated code.py, on CircuitPython 10.3.1 and
// KMK in rp2040js, wired to netlists with a fault put in by hand, each of which must fail with the key it breaks.
// (verify.test.ts runs it on the macropad's own copper, through `distinta verify`.) Run them with
//   node --test skills/distinta/pipeline/firmware/fil.test.ts
// The first run fetches CircuitPython, KMK and rp2040js into ~/.cache/distinta (cache.ts); with no network and
// nothing cached the test is skipped.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pcb } from "../pcb.ts";
import { ensureTools } from "./cache.ts";
import type { FirmwareKey } from "./code.ts";
import { firmwareCheck, runFirmware, yourFirmware, type BoardPad } from "./fil.ts";

const got = await ensureTools();
const skip = got.ok ? false : `the emulator could not be fetched: ${got.message}`;

test("a K5 shorted to ground, K1 and K2 swapped, or a K5 cut off ground each make the macropad's firmware fail at that key", { skip }, async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-fil-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
  for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
  const here = process.cwd(), log = console.log;
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb("macropad"), true);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  const board = JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8")) as { pads: BoardPad[]; nets: Record<string, string[]>; firmware: FirmwareKey[] };
  // The nets as the read-back gives them (each piece of copper with two pads or more), with one fault each.
  const nets = () => Object.fromEntries(Object.entries(board.nets).map(([n, ps]) => [n, [...ps]]));
  const short = nets();
  short.GND.push(...short.GP6);
  delete short.GP6;
  const swapped = nets();
  swapped.GP10 = swapped.GP10.map((p) => (p === "K1.A" ? "K2.A" : p));
  swapped.GP7 = swapped.GP7.map((p) => (p === "K2.A" ? "K1.A" : p));
  const dead = nets();
  dead.GND = dead.GND.filter((p) => p !== "K5.B");
  const run = await runFirmware({
    firmware: readFileSync(join(dst, "firmware", "code.py"), "utf8"), pads: board.pads, keys: board.firmware, tools: got.ok ? got.tools : (undefined as never),
    cases: [{ id: "short", nets: short, stopAtFirst: true }, { id: "swap", nets: swapped, stopAtFirst: true }, { id: "dead", nets: dead, stopAtFirst: true }],
  });
  assert.ok(run.started && run.ok, `${run.errors.join("\n")}\n${run.serial}`);
  const [s, w, d] = run.cases;
  assert.equal(s.ok, false);
  assert.deepEqual(s.errors, ["with no key pressed the keyboard reports KC.N5 (34): on the copper read back, K5.A is on ground, so GP6 reads pressed all the time"]);
  assert.equal(w.ok, false);
  assert.deepEqual(w.errors, ["K1 types KC.N2 (31), KC.N1 (30) expected: on the copper read back, K1's socket reaches GP7, and code.py reads K1 on GP10"]);
  assert.equal(d.ok, false);
  // K1 to K4 come out right first: the keys are pressed in order.
  assert.deepEqual(d.presses.map((p) => [p.keys.join("+"), p.ok]), [["K1", true], ["K2", true], ["K3", true], ["K4", true], ["K5", false]]);
  assert.deepEqual(d.errors, ["K5 types nothing, KC.N5 (34) expected: on the copper read back, K5.B does not reach ground, so the key cannot pull its GPIO low"]);
});

test("a keypad of one key passes with the fault it can take caught; a run out of the computer's time is unverified and leaves no report; a code.py of the user's own too large for the drive fails as its own", { skip }, async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-fil-one-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "one");
  for (const f of ["cad/pcb.mjs", "bom.json"]) cpSync(join(src, f), join(dst, f));
  const design = JSON.parse(readFileSync(join(src, "design.json"), "utf8"));
  design.slug = "one";
  Object.assign(design.params, { keyRows: 1, keyCols: 1 });
  design.keyMap = { K1: "GP2" };
  design.assembly = design.assembly.map((a: string) => a.replace(/K1 GP\d+(, K\d+ GP\d+)*/, "K1 GP2"));
  writeFileSync(join(dst, "design.json"), JSON.stringify(design));
  const here = process.cwd(), log = console.log;
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb("one"), true);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  // The copper as the read-back would give it: the board's own nets (readback.test.ts reads the files themselves).
  const board = JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8"));
  const zip = readFileSync(join(dst, "pcb", "one-gerbers.zip"));
  writeFileSync(join(dst, "pcb", "readback.json"), JSON.stringify({ inputs: board.inputs, slug: "one", nets: board.nets,
    files: { zip: { name: "one-gerbers.zip", sha256: createHash("sha256").update(zip).digest("hex") } } }));
  const fw = await firmwareCheck(dst);
  assert.equal(fw.status, "pass", JSON.stringify(fw.report?.errors));
  assert.match(fw.report!.checked, /; its 1 key must type its own keycodes and let go$/);
  assert.deepEqual(fw.report!.selfTest, { ok: true, cases: [{ fault: "K1's GPIO net joined to ground", ok: true, got: fw.report!.selfTest.cases[0].got }] });

  // Out of the processor time it is given: the computer's doing, so unverified, with no report to hold against the zip.
  const slow = await firmwareCheck(dst, { cpuMs: 1 });
  assert.equal(slow.status, "unverified");
  assert.equal(slow.report, undefined);
  assert.match(slow.message, /^the emulator ran out of time \(0 s of the computer's processor time\) before every case had run, which says nothing about the board either way$/);

  // A code.py of the user's own that does not fit on the drive: its run fails, as its own, and nothing throws.
  writeFileSync(join(dst, "firmware", "code.py"), `${"# a long comment line, to fill the drive\n".repeat(30_000)}`);
  const yours = await yourFirmware(dst);
  assert.equal(yours?.ok, false);
  assert.deepEqual(yours?.errors, ["it could not be run: the files do not fit in a 1024 KB drive"]);
});
