// Tests of `distinta verify`'s firmware layer on the macropad: the generated code.py run on the copper the read-back
// found must pass, every key and pair, and its self-test catch each fault; with nothing cached and no fetching the
// board is unverified; and the scorer refuses a zip whose firmware run failed. Run them with
//   node --test skills/distinta/pipeline/firmware/verify.test.ts
// They need the read-back's Python (gerbonara and shapely) and the emulator (fetched into ~/.cache/distinta once);
// without either they are skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { firmwareAudit, gerbersAudit } from "../stages/score.ts";
import { verify } from "../verify.ts";
import { ensureTools } from "./cache.ts";

const python = spawnSync("python3", ["-I", "-c", "import gerbonara, shapely"]).status === 0;
const tools = await ensureTools();
const skip = !python ? "gerbonara and shapely are not installed (python3 -m pip install --no-deps -r skills/distinta/pipeline/pcb/requirements.txt)"
  : !tools.ok ? `the emulator could not be fetched: ${tools.message}` : false;

/** `distinta verify macropad` in `tmp`, with what it printed and wrote. */
async function run(tmp: string) {
  const here = process.cwd(), log = console.log, lines: string[] = [];
  try {
    process.chdir(tmp);
    console.log = (...xs: unknown[]) => lines.push(xs.join(" "));
    const code = await verify("macropad");
    return { code, said: lines.join("\n"), json: JSON.parse(readFileSync(join(tmp, "products", "macropad", "pcb", "verify.json"), "utf8")) };
  } finally {
    console.log = log;
    process.chdir(here);
  }
}

test("distinta verify runs the macropad's firmware on the read-back's copper and passes it, says UNVERIFIED when it cannot fetch the emulator, and the scorer refuses a failed run", { skip }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-verify-fw-"));
  const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
  for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
  let v = await run(tmp);
  assert.equal(v.code, 0, v.said);
  assert.equal(v.json.status, "verified");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]),
    [["audit", "pass"], ["readback", "pass"], ["self-test", "pass"], ["firmware", "pass"], ["firmware-self-test", "pass"], ["order", "pass"]]);
  assert.ok(existsSync(join(dst, "pcb", "order", "README.md")));
  assert.match(v.said, /✓ firmware: .*ran firmware\/code\.py on the copper the read-back found; each of the 9 keys, and each of the 36 pairs, must type its own keycodes and let go: 0 errors in 45 presses/);
  assert.match(v.said, /✓ firmware self-test: K5's GPIO net joined to ground, K1 and K2 swapped and the GPIO nets of K8 and K9 joined, each put into the read-back's netlist, must make a key come out wrong: each was caught/);
  const fil = JSON.parse(readFileSync(join(dst, "firmware", "fil.json"), "utf8"));
  const rb = JSON.parse(readFileSync(join(dst, "pcb", "readback.json"), "utf8"));
  assert.equal(fil.ok, true);
  assert.equal(fil.inputs, rb.inputs);
  assert.deepEqual(fil.presses.filter((p: { ok: boolean }) => !p.ok), []);
  assert.deepEqual(fil.presses.find((p: { keys: string[] }) => p.keys.join() === "K1,K9"), { keys: ["K1", "K9"], want: [30, 38], got: [30, 38], ok: true });
  assert.match(gerbersAudit(dst, "pcb/macropad-gerbers.zip").detail, /; the firmware, run on that copper, types each key's code \(not a fab's own check\)/);

  // A run that failed on this board, this firmware and this read-back refuses the zip; one of an earlier firmware
  // does not.
  const good = readFileSync(join(dst, "firmware", "fil.json"), "utf8");
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: false, errors: ["K5 types nothing, KC.N5 (34) expected"] }));
  assert.deepEqual(gerbersAudit(dst), { ok: false, detail: "the firmware, run on the copper read back, found: K5 types nothing, KC.N5 (34) expected" });
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: false, firmware: { ...fil.firmware, sha256: "0" } }));
  assert.match(firmwareAudit(dst).detail, /firmware\/fil\.json is of an earlier board or firmware/);
  assert.ok(gerbersAudit(dst).ok);
  writeFileSync(join(dst, "firmware", "fil.json"), good);

  // Nothing cached and no fetching: the firmware does not run, and the board is unverified, not verified.
  const empty = mkdtempSync(join(tmpdir(), "distinta-cache-")), was = { cache: process.env.DISTINTA_CACHE, offline: process.env.DISTINTA_OFFLINE };
  try {
    process.env.DISTINTA_CACHE = empty;
    process.env.DISTINTA_OFFLINE = "1";
    v = await run(tmp);
  } finally {
    for (const [k, value] of [["DISTINTA_CACHE", was.cache], ["DISTINTA_OFFLINE", was.offline]] as const)
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    rmSync(empty, { recursive: true, force: true });
  }
  assert.equal(v.code, 2, v.said);
  assert.equal(v.json.status, "unverified");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "pass"], ["readback", "pass"], ["self-test", "pass"], ["firmware", "not run"], ["order", "not run"]]);
  assert.match(v.said, /· firmware: .*: not run: CircuitPython 10\.3\.1 for the Raspberry Pi Pico is not in the cache .* and DISTINTA_OFFLINE=1 says not to fetch it/);
  assert.match(v.said, /UNVERIFIED: the firmware did not run, so the board is not verified and no order folder was written/);
  assert.ok(!existsSync(join(dst, "firmware", "fil.json")));
  assert.ok(!existsSync(join(dst, "pcb", "order")));
  rmSync(tmp, { recursive: true, force: true });
});
