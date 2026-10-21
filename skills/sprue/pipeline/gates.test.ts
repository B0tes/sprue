// A failure stops the run: `sprue check` and `sprue all` exit 1 on a failed check, `sprue accept` refuses a gate while
// a check fails or a part file is not the one the design describes, and `sprue package` refuses (and takes away an
// earlier package) instead of shipping a stale or broken export. The CO2 run's every failure was exit 0 and its case
// was packaged at its old height. These run the command line on a one-part product in a temporary folder, with no
// Python. Run them with
//   node --test skills/sprue/pipeline/gates.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileProblems, meshProblem } from "./gates.ts";
import { exportInputs } from "./stages/score.ts";
import type { Bom } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
type V = [number, number, number];

/** A closed box as binary STL bytes, its faces counter-clockwise from outside. */
function box([x0, y0, z0]: V, [x1, y1, z1]: V): Buffer {
  const p = (i: number): V => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const tris = quads.flatMap(([a, b, c, d]) => [[p(a), p(b), p(c)], [p(a), p(c), p(d)]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
  return buf;
}

/** A product "lid" with one printed part, a 10 mm cube (1 cm3) exported from cad/lid.py, a quote and a plan, in the
 * stage `stage`; its one rule (rules.ts) fails while design.json's `ok` param is not 1. */
function product(t: { after: (f: () => void) => void }, { stage = "design", ok = 1 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-gates-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, "products", "lid");
  mkdirSync(join(dir, "cad"), { recursive: true });
  mkdirSync(join(dir, "fab"));
  const put = (file: string, v: unknown) => writeFileSync(join(dir, file), typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2));
  const at = "2026-10-21T00:00:00.000Z";
  put("request.json", { slug: "lid", brief: "a lid", product: "lid", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: {} });
  put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok } });
  put("bom.json", { slug: "lid", units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1,
    spec: { volumeCm3: 1, material: "PETG" }, file: "fab/lid.stl" }] });
  const stages = ["design", "source", "build"];
  put("state.json", { stage, stages: Object.fromEntries(stages.slice(0, stages.indexOf(stage) + 1)
    .map((s) => [s, { status: s === stage ? "proposed" : "accepted", at }])) });
  put("rules.ts", `export const rules = [{ id: "lid-ok", title: "Lid is fine", needs: ["ok"],
  run: (c) => ({ status: Number(c.p.ok) === 1 ? "pass" : "fail", detail: "ok is " + c.p.ok }) }];\n`);
  put("cad/lid.py", "# the lid\n");
  put("fab/lid.stl", box([0, 0, 0], [10, 10, 10]));
  put("fab/build.json", { inputs: exportInputs(dir) });
  put("quotes.json", { slug: "lid", units: 1, lines: [], batchUsd: 4, perUnitUsd: 4, longestLeadDays: 3, unquoted: [] });
  put("build-plan.md", "# plan\n");
  const run = (...args: string[]) => spawnSync(SPRUE, args, { cwd: tmp, encoding: "utf8" });
  const state = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  return { dir, put, run, state };
}

test("a failed engineer check makes sprue check exit 1 and say what to do", (t) => {
  const p = product(t, { ok: 0 });
  const r = p.run("check", "lid");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /✗ Lid is fine: ok is 0/);
  assert.match(r.stdout, /✗ 1 check failed \(lid-ok\): fix the design and run it again; a check that doesn't fit this product is replaced or dropped in rules\.ts/);
  p.put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok: 1 } });
  const fixed = p.run("check", "lid");
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.doesNotMatch(fixed.stdout, /check failed/);
});

test("sprue all exits 1 on a failed check, though it runs to the end", (t) => {
  const p = product(t, { ok: 0 });
  const r = p.run("all", "lid");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /✗ 1 check failed \(lid-ok\)/);
  assert.match(r.stdout, /· source and build: skipped/);
});

test("accept refuses a gate while a check fails, even with --force, and leaves the stage as it was", (t) => {
  const p = product(t, { ok: 0 });
  for (const args of [["accept", "lid"], ["accept", "lid", "design"], ["accept", "lid", "design", "--force"]]) {
    const r = p.run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, /✗ check lid-ok fails: ok is 0\n/);
    assert.match(r.stderr, /design not accepted: 1 problem above\. Fix it, then run sprue accept lid again/);
    assert.equal(p.state().stages.design.status, "proposed");
  }
  p.put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok: 1 } });
  // design.json is one of the export's inputs, so the edit makes fab/lid.stl an export of an earlier design.
  const stale = p.run("accept", "lid");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /✗ lid: fab\/lid\.stl: exported from an earlier design \(design\.json changed since\): run sprue cad/);
  p.put("fab/build.json", { inputs: exportInputs(p.dir) });
  const r = p.run("accept", "lid");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.state().stages.design.status, "accepted");
});

test("package refuses a stale export and takes away the package of an earlier run; a current one is packaged", (t) => {
  const p = product(t, { stage: "build" });
  const ok = p.run("package", "lid");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(existsSync(join(p.dir, "production", "lid.stl")));
  p.put("cad/lid.py", "# the lid, 2 mm taller\n");
  const r = p.run("package", "lid");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ lid: fab\/lid\.stl: exported from an earlier design \(cad\/lid\.py changed since\): run sprue cad\n/);
  assert.match(r.stderr, /removed products\/lid\/production\/, which was of an earlier run/);
  assert.match(r.stderr, /nothing packaged: 1 problem above\. Fix it, then run sprue package lid again/);
  assert.equal(existsSync(join(p.dir, "production")), false);
});

test("package and the build gate refuse a part file not made yet; the design gate does not need one", (t) => {
  const p = product(t, { stage: "build" });
  rmSync(join(p.dir, "fab", "lid.stl"));
  const r = p.run("package", "lid");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ lid: fab\/lid\.stl is not made yet: run sprue cad\n/);
  assert.equal(p.run("accept", "lid", "build").status, 1);
  const d = product(t);
  rmSync(join(d.dir, "fab", "lid.stl"));
  assert.equal(d.run("accept", "lid").status, 0);
});

test("a mesh that is not one closed body, or holds another volume than bom.json prices, is a problem", (t) => {
  const p = product(t);
  const bom = JSON.parse(readFileSync(join(p.dir, "bom.json"), "utf8")) as Bom;
  const lid = bom.lines[0];
  assert.equal(meshProblem(p.dir, lid), undefined);
  assert.deepEqual(fileProblems(p.dir, bom, { built: true }), []);
  // Exported again, now 10 x 10 x 12 mm: 1.2 cm3 against the 1 cm3 the quote prices.
  p.put("fab/lid.stl", box([0, 0, 0], [10, 10, 12]));
  assert.equal(meshProblem(p.dir, lid), "lid: fab/lid.stl: the mesh holds 1.20 cm3 but bom.json prices 1.00 cm3 (spec.volumeCm3): " +
    "copy the volume sprue cad prints for it into lid's spec.volumeCm3, then run sprue all so the quote prices it");
  assert.equal(fileProblems(p.dir, bom).length, 1);
  // Half a box, cut open.
  const open = box([0, 0, 0], [10, 10, 10]);
  p.put("fab/lid.stl", Buffer.concat([open.subarray(0, 80), Buffer.from(new Uint32Array([10]).buffer), open.subarray(84, 84 + 10 * 50)]));
  assert.match(meshProblem(p.dir, lid)!, /^lid: fab\/lid\.stl: /);
  const r = p.run("accept", "lid");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ lid: fab\/lid\.stl: /);
  // A STEP file, or a line with no file, is not read as a mesh.
  assert.equal(meshProblem(p.dir, { ...lid, file: "fab/lid.step" }), undefined);
});

test("validate names a catalog field the quote can't read, and a print volume that is not a number", (t) => {
  const p = product(t);
  p.put("catalog.json", { shipping: {}, offers: { lid: [] }, shiping: {} });
  const bom = JSON.parse(readFileSync(join(p.dir, "bom.json"), "utf8")) as Bom;
  bom.lines[0].spec.volumeCm3 = "abc";
  p.put("bom.json", bom);
  const r = p.run("validate", "lid");
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /lid \(print\): spec\.volumeCm3 must be a number of cm3 over 0, not "abc"/);
  assert.match(r.stdout + r.stderr, /catalog\.json: its top level has a field nothing reads \("shiping"/);
  assert.match(r.stdout + r.stderr, /· catalog\.json: offers for lid, which is made \(print\), not bought, so nothing reads them/);
  // The quote and the offers refuse it in one line, rather than price from it.
  const s = p.run("source", "lid");
  assert.equal(s.status, 1);
  assert.match(s.stderr, /catalog\.json can't be priced from: its top level has a field nothing reads \("shiping"/);
});
