// `distinta status` in the build stage of a product with a board: verify.json counts only once it says verified, so
// the next step stays `distinta verify` after a failed or unverified run. Run with
//   node --test skills/distinta/pipeline/status.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  for (const word of ["failed", "unverified"]) {
    writeFileSync(join(dir, "pcb", "verify.json"), JSON.stringify({ slug: "kb", status: word, layers: [] }));
    said = status(tmp, "kb");
    assert.match(said, new RegExp(`○ pcb/verify\\.json \\(${word}\\)`), word);
    assert.match(said, /next: distinta verify kb, until it ends VERIFIED$/, word);
  }
  writeFileSync(join(dir, "pcb", "verify.json"), JSON.stringify({ slug: "kb", status: "verified", layers: [] }));
  said = status(tmp, "kb");
  assert.match(said, /✓ pcb\/verify\.json \(verified\)/);
  assert.match(said, /next: distinta package kb$/);

  // A product with no board is never asked to verify.
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1, lines: [{ id: "case", name: "Case", role: "case",
    process: "print", qtyPerUnit: 1, spec: { material: "PETG", volumeCm3: 10 }, file: "fab/case.stl" }] }));
  rmSync(join(dir, "pcb"), { recursive: true });
  said = status(tmp, "kb");
  assert.doesNotMatch(said, /verify/);
  assert.match(said, /next: distinta package kb$/);
});
