// Tests of the honest score: the mesh check finds what an edge count passes (a sealed void, a flipped face, two
// bodies), a check whose params are partly missing fails rather than skipping quietly, a line with no price fails
// the score, and so does a made product whose parts nothing has checked as one (system.json). Run them with
//   node --test skills/sprue/pipeline/stages/score.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Bom, Checks, Design, Quotes, Reference, SystemCheck } from "../types.ts";
import { runChecks } from "./check.ts";
import { exportInputs, exportStale, meshAudit, score, systemAudit, systemInputs, volumeMismatch } from "./score.ts";

type V = [number, number, number];
type Tri = [V, V, V];
const dir = mkdtempSync(join(tmpdir(), "sprue-score-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A box's 12 triangles, wound so their normals point out (or in, for a void or a part turned inside out). */
function box([x0, y0, z0]: V, [x1, y1, z1]: V, inward = false): Tri[] {
  const p = (i: number): V => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  // Each face as four corners counter-clockwise seen from outside.
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const tris = quads.flatMap(([a, b, c, d]): Tri[] => [[p(a), p(b), p(c)], [p(a), p(c), p(d)]]);
  return inward ? tris.map(([a, b, c]): Tri => [a, c, b]) : tris;
}

function stl(name: string, tris: Tri[]): string {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}

const cube = box([0, 0, 0], [10, 10, 10]);

test("a closed box is one body, and its volume is read from the mesh", () => {
  const m = meshAudit(stl("cube.stl", cube));
  assert.equal(m.ok, true, m.detail);
  assert.equal(m.bodies, 1);
  assert.equal(m.volumeCm3, 1);
  assert.match(m.detail, /^one closed body of 1\.0 cm3/);
});

test("a sealed void inside a part fails, though every edge is shared by two faces", () => {
  const m = meshAudit(stl("void.stl", [...box([0, 0, 0], [20, 20, 20]), ...box([5, 5, 5], [15, 15, 15], true)]));
  assert.equal(m.ok, false);
  assert.match(m.detail, /^1 closed shell inside the part faces inwards: a sealed void \(1\.0 cm3\)/);
  assert.equal(m.volumeCm3, 7);
});

test("a hole, a face turned over, a part inside out, two bodies and touching bodies each fail", () => {
  assert.match(meshAudit(stl("hole.stl", cube.slice(1))).detail, /3 open edges, so the surface has a hole/);
  const flipped = cube.map((t, i): Tri => (i === 0 ? [t[0], t[2], t[1]] : t));
  assert.match(meshAudit(stl("flipped.stl", flipped)).detail, /3 edges run the same way by both of their faces/);
  assert.match(meshAudit(stl("inside-out.stl", box([0, 0, 0], [10, 10, 10], true))).detail, /^the mesh is inside out/);
  assert.match(meshAudit(stl("two.stl", [...cube, ...box([20, 0, 0], [30, 10, 10])])).detail, /^2 separate bodies in one part file/);
  // Two boxes that share one edge: four faces meet on it.
  assert.match(meshAudit(stl("touching.stl", [...cube, ...box([10, 10, 0], [20, 20, 10])])).detail, /1 edge shared by more than two faces/);
});

test("a long mesh whose faces come in strip order is read without running out of stack", () => {
  // A closed cylinder of 15,000 sides, written quad by quad and then its two caps: each face joins the shell one
  // step further on, which a recursive union-find follows one call per step.
  const n = 15000, at = (i: number, z: number): V => [10 * Math.cos((2 * Math.PI * i) / n), 10 * Math.sin((2 * Math.PI * i) / n), z];
  const tris: Tri[] = [];
  for (let i = 0; i < n; i++) tris.push([at(i, 0), at(i + 1, 0), at(i + 1, 30)], [at(i, 0), at(i + 1, 30), at(i, 30)]);
  for (let i = 1; i < n - 1; i++) tris.push([at(0, 0), at(i + 1, 0), at(i, 0)], [at(0, 30), at(i, 30), at(i + 1, 30)]);
  const m = meshAudit(stl("cylinder.stl", tris));
  assert.equal(m.ok, true, m.detail);
  assert.equal(m.bodies, 1);
  assert.ok(Math.abs(m.volumeCm3! - Math.PI * 100 * 30 / 1000) < 0.01, String(m.volumeCm3));
});

test("a file that is not a binary STL fails, and so does one with no faces", () => {
  const ascii = join(dir, "ascii.stl");
  writeFileSync(ascii, "solid part\nendsolid part\n");
  assert.match(meshAudit(ascii).detail, /^not a binary STL/);
  assert.match(meshAudit(stl("empty.stl", [])).detail, /^the mesh has no faces/);
});

const bom: Bom = {
  slug: "t", units: 2, lines: [
    { id: "ctrl", name: "Controller", role: "controller", process: "buy", qtyPerUnit: 1, spec: {} },
    { id: "plate", name: "Steel plate", role: "plate", process: "sheet", qtyPerUnit: 1, spec: {} },
    { id: "lid", name: "Lid", role: "case-top", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 1 }, file: "cube.stl" },
  ],
};
const ref: Reference = { slug: "t", source: "", units: 2, roles: ["controller", "plate", "case-top"].map((role) => ({ role, spec: "", qtyPerUnit: 1 })), batchUsd: { low: 90, high: 110, basis: "" } };
const priced = (ids: string[], usd: number): Quotes => ({
  slug: "t", units: 2, batchUsd: usd, perUnitUsd: usd / 2, longestLeadDays: 3, unquoted: bom.lines.map((l) => l.id).filter((id) => !ids.includes(id)),
  lines: ids.map((lineId) => ({ lineId, supplier: "Shop", sku: lineId, mode: "snapshot" as const, orderQty: 2, orderUsd: usd / ids.length, leadDays: 3, basis: "" })),
});
const clean: Checks = { slug: "t", checks: [{ id: "a", title: "A", status: "pass", detail: "" }], failed: 0, flagged: 0, skipped: [{ id: "b", title: "B", missing: ["x"] }] };

/** A system.json for the product in dir as it is now, every gate passed and every planted fault caught, unless
 * `change` says otherwise. */
function systemJson(change: Partial<SystemCheck> = {}) {
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n", { flag: "a" });
  const s: SystemCheck = {
    slug: "t", ok: true, generatedAt: "", parts: 3, envelopes: 1,
    gates: ["placed", "overlap", "contact", "clearance", "inside", "stability", "function"].map((id) => ({ id, title: id, status: "pass" as const, detail: "", problems: 0 })),
    stability: [{ pose: "on the desk", massG: 100, com: [0, 0, 5], tiltDeg: 40, tipsToward: [1, 0, 0], estimatedG: 0, pushes: [] }],
    probes: [], selfTest: { ok: true, faults: [{ gate: "overlap", fault: "a part moved into another", caught: true, detail: "" }], untested: [] },
    inputs: systemInputs(dir), seconds: 1, ...change,
  };
  writeFileSync(join(dir, "system.json"), JSON.stringify(s));
}

test("a made product fails the score until its parts are checked as one, on the design as it is now", () => {
  const audit = () => systemAudit(dir, bom);
  rmSync(join(dir, "cad"), { recursive: true, force: true });
  rmSync(join(dir, "system.json"), { force: true });
  assert.match(audit().detail, /^no cad\/_system\.py/);
  // Bought parts alone are not assembled by us, so there is nothing to check.
  const bought = { ...bom, lines: bom.lines.filter((l) => l.process === "buy") };
  assert.equal(systemAudit(dir, bought).ok, true);
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "cad", "_system.py"), "");
  assert.match(audit().detail, /^no system\.json: run sprue system/);
  systemJson();
  assert.equal(audit().ok, true, audit().detail);
  assert.match(audit().detail, /tips at 40 deg at worst/);
  // A part file changed after the check ran: its pass is of another design.
  writeFileSync(join(dir, "cad", "lid.py"), "# a new part\n");
  assert.match(audit().detail, /^system\.json is of an earlier design \(cad\/lid\.py changed\)/);
  systemJson({ gates: [{ id: "overlap", title: "Overlap", status: "fail", detail: "bot and cable share 1.32 mm3", problems: 1 }] });
  assert.deepEqual(audit().failed, ["overlap"]);
  assert.match(audit().detail, /^the whole product fails overlap: bot and cable share 1\.32 mm3/);
  // Gates that pass prove nothing if the planted faults got through them too.
  systemJson({ ok: false, selfTest: { ok: false, faults: [{ gate: "stability", fault: "a 10 kg weight beyond the feet", caught: false, detail: "" }], untested: [] } });
  assert.match(audit().detail, /^its self-test missed stability \(a 10 kg weight beyond the feet\)/);
  writeFileSync(join(dir, "system.json"), "{");
  assert.match(audit().detail, /^system\.json is not readable/);
});

test("a line with no price fails the score instead of counting as $0", () => {
  stl("cube.stl", cube);
  systemJson();
  const all = score(dir, bom, clean, priced(["ctrl", "plate", "lid"], 100), ref);
  assert.equal(all.pass, true, JSON.stringify(all));
  assert.deepEqual(all.checks, { failed: 0, flagged: 0, ran: 1, skipped: ["b"] });
  // The sheet-metal plate has no fab adapter, so the quote leaves it out: the total looks in band and is not.
  const noPlate = score(dir, bom, clean, priced(["ctrl", "lid"], 100), ref);
  assert.equal(noPlate.pass, false);
  assert.deepEqual(noPlate.cost.unpriced, ["plate"]);
  // A line added to the BOM after the quote ran is not priced either, though quotes.json doesn't list it as unquoted.
  const older = { ...priced(["ctrl", "lid"], 100), unquoted: [] };
  assert.deepEqual(score(dir, bom, clean, older, ref).cost.unpriced, ["plate"]);
  // A line the batch needs none of is not ordered, so it needs no price.
  const none = { ...bom, lines: bom.lines.map((l) => (l.id === "plate" ? { ...l, qtyPerUnit: 0 } : l)) };
  assert.equal(score(dir, none, clean, priced(["ctrl", "lid"], 100), ref).pass, true);
});

test("the score's files fail on a part with a sealed void", () => {
  stl("cube.stl", [...box([0, 0, 0], [20, 20, 20]), ...box([5, 5, 5], [15, 15, 15], true)]);
  const s = score(dir, bom, clean, priced(["ctrl", "plate", "lid"], 100), ref);
  assert.equal(s.pass, false);
  assert.match(s.files[0].detail, /sealed void/);
});

test("the score's files fail on a print whose mesh is not the volume its price is worked out from", () => {
  // The lid is priced at 1 cm3; a CAD edit made it twice as tall and was exported, but bom.json was not updated.
  stl("cube.stl", box([0, 0, 0], [10, 10, 20]));
  systemJson();
  const s = score(dir, bom, clean, priced(["ctrl", "plate", "lid"], 100), ref);
  assert.equal(s.pass, false);
  assert.equal(s.files[0].detail, "the mesh holds 2.00 cm3 but bom.json prices 1.00 cm3 (spec.volumeCm3): copy the volume sprue cad prints for it (or the mesh's, for a part not built from cad/) into lid's spec.volumeCm3, then run sprue all so the quote prices it");
  // A tessellated curve holds a few thousandths of a cm3 less than the solid it was cut from, which is the same part.
  assert.equal(volumeMismatch(90.96, 90.97), undefined);
  assert.equal(volumeMismatch(0.765, 0.77), undefined);
  assert.match(volumeMismatch(0.7, 0.77) ?? "", /^the mesh holds 0\.70 cm3 but bom\.json prices 0\.77 cm3/);
  assert.match(volumeMismatch(92, 90.97) ?? "", /holds 92\.00 cm3/);
  // A line with no volume yet is the checks' to report (it can't be quoted), not the files'.
  assert.equal(volumeMismatch(2, undefined), undefined);
  // A volume written as a string is priced as the number it reads as (adapters/fab.ts), so it is checked as one.
  assert.match(volumeMismatch(11.05, "5") ?? "", /^the mesh holds 11\.05 cm3 but bom\.json prices 5\.00 cm3/);
  assert.equal(volumeMismatch(11.05, "11.05"), undefined);
  assert.equal(volumeMismatch(11.05, ""), undefined);
  stl("cube.stl", cube);
});

test("a part exported from an earlier cad/ fails the score's files, and an editor's backup doesn't count", () => {
  const sub = mkdtempSync(join(tmpdir(), "sprue-export-"));
  try {
    mkdirSync(join(sub, "cad"), { recursive: true });
    mkdirSync(join(sub, "fab"), { recursive: true });
    writeFileSync(join(sub, "cad", "lid.py"), "# the lid\n");
    writeFileSync(join(sub, "design.json"), "{}");
    writeFileSync(join(sub, "fab", "lid.stl"), "");
    // A part with no cad/<part>.py, or not in fab/, is not ours to date.
    assert.equal(exportStale(sub, "fab/other.stl"), undefined);
    assert.equal(exportStale(sub, "cube.stl"), undefined);
    assert.match(exportStale(sub, "fab/lid.stl") ?? "", /^no fab\/build\.json/);
    writeFileSync(join(sub, "fab", "build.json"), JSON.stringify({ inputs: exportInputs(sub) }));
    assert.equal(exportStale(sub, "fab/lid.stl"), undefined);
    assert.equal(exportStale(sub, "./fab/lid.step"), undefined);
    // An editor's swap file and backup, and the whole-product check, are not what the parts are built from.
    writeFileSync(join(sub, "cad", ".lid.py.swp"), "x");
    writeFileSync(join(sub, "cad", "lid.py~"), "x");
    writeFileSync(join(sub, "cad", "_system.py"), "x");
    assert.equal(exportStale(sub, "fab/lid.stl"), undefined);
    assert.ok(!Object.keys(systemInputs(sub)).some((k) => k.endsWith(".swp") || k.endsWith("~")));
    writeFileSync(join(sub, "cad", "lid.py"), "# the lid, 1 mm taller\n");
    assert.match(exportStale(sub, "fab/lid.stl") ?? "", /^exported from an earlier design \(cad\/lid\.py changed since\): run sprue cad/);
  } finally {
    rmSync(sub, { recursive: true, force: true });
  }
});

test("a check runs, is skipped when the design has none of its params, and fails when it has only some", () => {
  const design = (params: Design["params"]): Design => ({ slug: "t", summary: "", architecture: [], params });
  const keys = { id: "keypad", lines: [] } as unknown as Bom;
  const all = runChecks(design({ controllerCurrentMa: 50, usbBudgetMa: 500 }), keys);
  assert.equal(all.checks.find((c) => c.id === "usb-power")?.status, "pass");
  assert.ok(all.skipped?.some((s) => s.id === "mx-plate" && s.missing.join() === "plateCutoutMm,plateThicknessMm,plateTopToPcbTopMm"));
  assert.ok(!all.checks.some((c) => c.id === "mx-plate"));
  const part = runChecks(design({ controllerCurrentMa: 50 }), keys);
  const usb = part.checks.find((c) => c.id === "usb-power")!;
  assert.equal(usb.status, "fail");
  assert.match(usb.detail, /^Can't run: design.json has controllerCurrentMa but not usbBudgetMa\. Add it, or .*\{ id: "usb-power", off: true \}/);
  assert.equal(part.failed, 1);
  assert.ok(!part.skipped?.some((s) => s.id === "usb-power"));
  // A rule of rules.ts itself is deleted there, not turned off (that would give its id twice).
  const lamp = { id: "lamp-power", title: "Lamp", needs: ["lampMa", "supplyMa"], run: () => ({ status: "pass" as const, detail: "" }) };
  assert.match(runChecks(design({ lampMa: 100 }), keys, [lamp]).checks.find((c) => c.id === "lamp-power")!.detail, /or if the check doesn't fit this product, delete it from rules\.ts$/);
  // A rule turned off in rules.ts is neither run nor counted as skipped.
  const off = runChecks(design({ controllerCurrentMa: 50 }), keys, [{ id: "usb-power", off: true }]);
  assert.equal(off.failed, 0);
  assert.ok(!off.skipped?.some((s) => s.id === "usb-power"));
});
