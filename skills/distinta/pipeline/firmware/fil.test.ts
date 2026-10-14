// Tests of the firmware in the loop on the emulator: the macropad's generated code.py, on CircuitPython 10.3.1 and
// KMK in rp2040js, wired to netlists with a fault put in by hand, each of which must fail with the key it breaks.
// (verify.test.ts runs it on the macropad's own copper, through `distinta verify`.) Run them with
//   node --test skills/distinta/pipeline/firmware/fil.test.ts
// The first run fetches CircuitPython, KMK and rp2040js into ~/.cache/distinta (cache.ts); with no network and
// nothing cached the test is skipped.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pcb } from "../pcb.ts";
import { ensureTools } from "./cache.ts";
import type { FirmwareKey } from "./code.ts";
import { runFirmware, type BoardPad } from "./fil.ts";

const got = await ensureTools();
const skip = got.ok ? false : `the emulator could not be fetched: ${got.message}`;

test("a K5 shorted to ground, K1 and K2 swapped, or a K5 cut off ground each make the macropad's firmware fail at that key", { skip }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-fil-"));
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
  rmSync(tmp, { recursive: true, force: true });
});
