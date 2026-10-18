// `sprue status` in the build stage of a product with a board: verify.json counts only once it says verified, of
// the board as it is now, so the next step stays `sprue verify` after a failed or unverified run, or once the board
// changed since it was verified. Run with
//   node --test skills/sprue/pipeline/status.test.ts

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inProduct } from "./io.ts";
import { inputsHash } from "./pcb/fresh.ts";
import { faultsInputs, isBoardLine, score } from "./stages/score.ts";
import { printStatus } from "./status.ts";
import type { Bom, BomLine, Checks, Quotes, Reference } from "./types.ts";

/** What `sprue status <slug>` prints in `tmp`. */
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

test("status asks for sprue verify until it ends VERIFIED, then for sprue package", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-status-"));
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
  assert.match(said, /next: sprue verify kb, until it ends VERIFIED$/);
  // What a verified board leaves in pcb/: an audit of the board as it is, and a read-back of its zip and netlist with
  // its self-test passed (this board has no keys, so no firmware run).
  const inputs = inputsHash(dir);
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const put = (file: string, v: unknown) => writeFileSync(join(dir, "pcb", file), typeof v === "string" ? v : JSON.stringify(v));
  put("kb-gerbers.zip", "the zip");
  put("kb.d356", "the netlist");
  put("drc.json", { inputs, reads: { design: [], bom: [] }, errors: [], nets: {} });
  put("board.json", { inputs, firmware: null, files: { zip: "kb-gerbers.zip" } });
  put("readback.json", { inputs, ok: true, errors: [], selfTest: { ok: true },
    files: { zip: { name: "kb-gerbers.zip", sha256: sha("the zip") }, netlist: { name: "kb.d356", sha256: sha("the netlist") } } });
  for (const word of ["failed", "unverified"]) {
    put("verify.json", { slug: "kb", inputs, status: word, zip: null, layers: [] });
    said = status(tmp, "kb");
    assert.match(said, new RegExp(`○ pcb/verify\\.json \\(${word}\\)`), word);
    assert.match(said, /next: sprue verify kb, until it ends VERIFIED$/, word);
  }
  put("verify.json", { slug: "kb", inputs, status: "verified", zip: { name: "kb-gerbers.zip", sha256: sha("the zip") }, layers: [] });
  said = status(tmp, "kb");
  assert.match(said, /✓ pcb\/verify\.json \(verified\)/);
  assert.match(said, /next: sprue package kb$/);
  // bom.json then orders a board verify would fail (4 layers, or another thickness than the 1.6 mm the fab profiles
  // were checked for): stale, and verify is next again.
  const bomWith = (spec: Record<string, unknown>) => writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1,
    lines: [{ id: "pcb", name: "PCB", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 61, heightMm: 94, ...spec }, file: "pcb/kb-gerbers.zip" }] }));
  for (const spec of [{ layers: 4 }, { layers: 2, thicknessMm: 1.2 }]) {
    bomWith(spec);
    said = status(tmp, "kb");
    assert.match(said, /○ pcb\/verify\.json \(stale\)/, JSON.stringify(spec));
    assert.match(said, /next: sprue verify kb, until it ends VERIFIED$/);
  }
  bomWith({ layers: 2 });
  // A run that wrote an order folder counts only while the folder is there: status removes one of another order.
  put("verify.json", { slug: "kb", inputs, status: "verified", zip: { name: "kb-gerbers.zip" }, order: { dir: "pcb/order", fabs: [], skipped: [] }, layers: [] });
  assert.match(status(tmp, "kb"), /○ pcb\/verify\.json \(stale\)/);
  put("verify.json", { slug: "kb", inputs, status: "verified", zip: { name: "kb-gerbers.zip", sha256: sha("the zip") }, layers: [] });
  assert.match(status(tmp, "kb"), /✓ pcb\/verify\.json \(verified\)/);
  // The board's line, its path written another way or not a PCB line, is still the board.
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "kb", units: 1, lines: [{ id: "pcb", name: "PCB", role: "pcb",
    process: "print", qtyPerUnit: 1, spec: {}, file: "./pcb/kb-gerbers.zip" }] }));
  assert.match(status(tmp, "kb"), /next: sprue package kb$/);
  // Once the board changes (design.json's params here), or its zip does, verify.json is of an earlier board: stale,
  // and verify is next again, though it still says verified.
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "kb", params: { pcbEdgeToKeyMm: 5.9 } }));
  said = status(tmp, "kb");
  assert.match(said, /○ pcb\/verify\.json \(stale\)/);
  assert.match(said, /next: sprue verify kb, until it ends VERIFIED$/);
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
  assert.match(said, /next: sprue package kb$/);
});

test("the board's line is found by its role, through a link or as a copy of the zip, and its file goes only through the board's gates", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-boardline-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const real = join(tmp, "examples", "kb"), dir = join(tmp, "products", "kb");
  mkdirSync(join(real, "pcb"), { recursive: true });
  mkdirSync(join(real, "fab"), { recursive: true });
  symlinkSync(join(tmp, "examples"), join(tmp, "products"));
  // A zip sprue pcb wrote, which nothing has read back: no line may pass it as a plain file.
  writeFileSync(join(real, "pcb", "kb-gerbers.zip"), "the zip");
  writeFileSync(join(real, "fab", "copy.zip"), "the zip");
  writeFileSync(join(real, "fab", "case.stl"), "solid");
  symlinkSync("pcb", join(real, "board"));
  const line = (file: string, more: Partial<BomLine> = {}) => ({ id: "x", name: "X", role: "case", process: "cnc", qtyPerUnit: 1, spec: {}, file, ...more }) as BomLine;
  const board = [line("board/kb-gerbers.zip"), line("../../examples/kb/pcb/kb-gerbers.zip"), line(join(real, "pcb", "kb-gerbers.zip")),
    line("fab/copy.zip"), line("fab/case.stl", { role: "pcb" }), line("fab/case.stl", { process: "pcb" })];
  for (const l of board) assert.ok(isBoardLine(dir, l), l.file);
  assert.ok(!isBoardLine(dir, line("fab/case.stl")));
  assert.equal(inProduct(dir, "board/kb-gerbers.zip"), "pcb/kb-gerbers.zip");
  assert.equal(inProduct(dir, join(real, "pcb", "kb-gerbers.zip")), "pcb/kb-gerbers.zip");
  const s = score(dir, { slug: "kb", units: 1, lines: board.slice(0, 4) } as Bom, { failed: 0, flagged: 0 } as Checks, { batchUsd: 1 } as Quotes,
    { roles: [], batchUsd: { low: 1, high: 1 } } as unknown as Reference);
  for (const f of s.files) {
    assert.equal(f.ok, false, f.name);
    assert.doesNotMatch(f.detail, /present|not generated yet/, f.name);
  }
});

test("status says a faults.json that is stale or unreadable is so, and gives the counts only of one that is fresh", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-status-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, "products", "kb");
  mkdirSync(join(dir, "reference"), { recursive: true });
  writeFileSync(join(dir, "design.json"), "{}");
  writeFileSync(join(dir, "reference", "faults.json"), "{}");
  const report = (inputs: Record<string, string>) => writeFileSync(join(dir, "faults.json"), JSON.stringify({ slug: "kb", ok: false, ran: 2, caught: 1, pct: 50,
    missed: ["b"], falseAlarms: 0, control: { problems: [], stale: [], falseAlarms: [], known: [] }, cases: [], inputs, seconds: 1 }));
  writeFileSync(join(dir, "faults.json"), "{");
  assert.match(status(tmp, "kb"), /○ faults\.json \(unreadable\)/);
  report({ ...faultsInputs(dir), "design.json": "0" });
  assert.match(status(tmp, "kb"), /○ faults\.json \(stale\)/);
  report({ ...faultsInputs(dir), "sprue:gates": "0" });
  assert.match(status(tmp, "kb"), /○ faults\.json \(stale\)/, "measured on earlier code of the gates");
  report(faultsInputs(dir));
  assert.match(status(tmp, "kb"), /○ faults\.json \(1 of 2 caught, 0 false alarms\)/);
});
