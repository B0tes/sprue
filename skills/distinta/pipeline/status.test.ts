// `distinta status` in the build stage of a product with a board: verify.json counts only once it says verified, of
// the board as it is now, so the next step stays `distinta verify` after a failed or unverified run, or once the board
// changed since it was verified. Run with
//   node --test skills/distinta/pipeline/status.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inputsHash } from "./pcb/fresh.ts";
import { printStatus } from "./status.ts";

/** What `distinta status <slug>` prints in `tmp`. */
function status(tmp: string, slug: string) {
  const here = process.cwd(), log = console.log, lines: string[] = [];
  try {
    process.chdir(tmp);
    console.log = (...xs: unknown[]) => lines.push(xs.join(" "));
    printStatus(slug);
    return lines.join("\n");
  } finally {
    console.log = log;
    process.chdir(here);
  }
}

test("status asks for distinta verify until it ends VERIFIED, then for distinta package", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-status-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, "products", "kb");
  mkdirSync(join(dir, "pcb"), { recursive: true });
  const at = "2026-10-14T00:00:00.000Z";
  writeFileSync(join(dir, "state.json"), JSON.stringify({ stage: "build", stages: { design: { status: "accepted", at },
    source: { status: "accepted", at }, build: { status: "drafting", at } } }));
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1, lines: [{ id: "pcb", name: "PCB", role: "pcb",
    process: "pcb", qtyPerUnit: 1, spec: { widthMm: 61, heightMm: 94, layers: 2 }, file: "pcb/kb-gerbers.zip" }] }));
  writeFileSync(join(dir, "build-plan.md"), "# plan\n");

  let said = status(tmp, "kb");
  assert.match(said, /○ pcb\/verify\.json /);
  assert.match(said, /next: distinta verify kb, until it ends VERIFIED$/);
  // What a verified board leaves in pcb/: an audit of the board as it is, and a read-back of its zip and netlist with
  // its self-test passed (this board has no keys, so no firmware run).
  const inputs = inputsHash(dir);
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const put = (file: string, v: unknown) => writeFileSync(join(dir, "pcb", file), typeof v === "string" ? v : JSON.stringify(v));
  put("kb-gerbers.zip", "the zip");
  put("kb.d356", "the netlist");
  put("drc.json", { inputs, reads: { design: [], bom: [] }, errors: [], nets: {} });
  put("board.json", { inputs, firmware: null });
  put("readback.json", { inputs, ok: true, errors: [], selfTest: { ok: true },
    files: { zip: { name: "kb-gerbers.zip", sha256: sha("the zip") }, netlist: { name: "kb.d356", sha256: sha("the netlist") } } });
  for (const word of ["failed", "unverified"]) {
    put("verify.json", { slug: "kb", inputs, status: word, zip: null, layers: [] });
    said = status(tmp, "kb");
    assert.match(said, new RegExp(`○ pcb/verify\\.json \\(${word}\\)`), word);
    assert.match(said, /next: distinta verify kb, until it ends VERIFIED$/, word);
  }
  put("verify.json", { slug: "kb", inputs, status: "verified", zip: { name: "kb-gerbers.zip", sha256: sha("the zip") }, layers: [] });
  said = status(tmp, "kb");
  assert.match(said, /✓ pcb\/verify\.json \(verified\)/);
  assert.match(said, /next: distinta package kb$/);
  // The board's line, its path written another way or not a PCB line, is still the board.
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1, lines: [{ id: "pcb", name: "PCB", role: "pcb",
    process: "print", qtyPerUnit: 1, spec: {}, file: "./pcb/kb-gerbers.zip" }] }));
  assert.match(status(tmp, "kb"), /next: distinta package kb$/);
  // Once the board changes (design.json's params here), or its zip does, verify.json is of an earlier board: stale,
  // and verify is next again, though it still says verified.
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "kb", params: { pcbEdgeToKeyMm: 5.9 } }));
  said = status(tmp, "kb");
  assert.match(said, /○ pcb\/verify\.json \(stale\)/);
  assert.match(said, /next: distinta verify kb, until it ends VERIFIED$/);
  rmSync(join(dir, "design.json"));
  assert.match(status(tmp, "kb"), /✓ pcb\/verify\.json \(verified\)/);
  put("kb-gerbers.zip", "another zip");
  assert.match(status(tmp, "kb"), /○ pcb\/verify\.json \(stale\)/);
  writeFileSync(join(dir, "pcb", "verify.json"), JSON.stringify({ slug: "kb", status: "verified", layers: [] }));
  assert.match(status(tmp, "kb"), /○ pcb\/verify\.json \(stale\)/);

  // A product with no board is never asked to verify.
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1, lines: [{ id: "case", name: "Case", role: "case",
    process: "print", qtyPerUnit: 1, spec: { material: "PETG", volumeCm3: 10 }, file: "fab/case.stl" }] }));
  rmSync(join(dir, "pcb"), { recursive: true });
  said = status(tmp, "kb");
  assert.doesNotMatch(said, /verify/);
  assert.match(said, /next: distinta package kb$/);
});
