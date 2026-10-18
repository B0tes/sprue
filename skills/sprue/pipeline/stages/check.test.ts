// Tests of the printed-wall checks on the keypad as it is and as seeded faults v0 broke it: a case wall under the
// least wall the print shop takes fails and names its param, one under JLC3DP's figure for the part's size is a
// person's call, and so is a skin, since no shop says whether its table holds for one. Run them with
//   node --test skills/sprue/pipeline/stages/check.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { names } from "../faults.ts";
import type { Bom, Design } from "../types.ts";
import { printProcess, runChecks } from "./check.ts";

const examples = join(import.meta.dirname, "..", "..", "examples");
const read = <T>(slug: string, file: string) => JSON.parse(readFileSync(join(examples, slug, file), "utf8")) as T;
const keypad = read<Design>("macropad", "design.json"), keypadBom = read<Bom>("macropad", "bom.json");

/** The keypad with some params changed and its case lines' specs and processes changed, and its two wall checks. */
function walls(params: Record<string, number> = {}, line: (l: Bom["lines"][number]) => Partial<Bom["lines"][number]> = () => ({})) {
  const design = { ...keypad, params: { ...keypad.params, ...params } };
  const bom = { ...keypadBom, lines: keypadBom.lines.map((l) => (/^case-/.test(l.role) ? { ...l, ...line(l) } : l)) };
  const all = runChecks(design, bom);
  const get = (id: string) => all.checks.find((c) => c.id === id)!;
  return { walls: get("print-walls"), skins: get("print-skins") };
}

test("the keypad's walls pass, and its skins under JLC3DP's figure for its size are a person's call", () => {
  const { walls: w, skins: s } = walls();
  assert.equal(w.status, "pass", w.detail);
  assert.equal(w.detail, "Case walls 2.4 mm (caseWallMm), standoff walls 1.8 mm (standoffOuterMm, screwClearanceMm) and boss walls 2.1 mm (bossOuterMm, insertOuterMm) are thick enough (printed FDM; the case is 66.8 x 99.8 mm)");
  assert.equal(s.status, "flag");
  assert.match(s.detail, /^The plate 1\.5 mm \(plateThicknessMm\), the skin over the controller 1 mm \(lidSkinOverControllerMm\) and the skin over the inserts 1 mm \(plateTopToPcbTopMm, insertLengthMm\) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; the tray floor 2 mm \(trayFloorMm\) is thick enough/);
  assert.match(s.detail, /JLC3DP doesn't say whether its table holds for a horizontal skin: ask the print shop before ordering$/);
});

test("a case wall under the least wall the shop takes fails, naming the param seeded faults v0 thinned", () => {
  const { walls: w } = walls({ caseWallMm: 0.8, caseCornerMm: 2.2 });
  assert.equal(w.status, "fail");
  assert.match(w.detail, /^Case walls 0\.8 mm \(caseWallMm\) are under the 1 mm Craftcloud takes of FDM; standoff walls/);
  assert.ok(names(w.detail, "caseWallMm"), "the wall-thin fault expects caseWallMm");
  // Down to the shop's least wall is in: 1 mm passes it, and is under JLC3DP's 2 mm for a part this size.
  assert.equal(walls({ caseWallMm: 1 }).walls.status, "flag");
  assert.equal(walls({ caseWallMm: 2 }).walls.status, "pass");
});

test("JLC3DP's column is the smallest the case's longest side fits in, the last past its table", () => {
  assert.match(walls({ pcbHeightMm: 120 }).walls.detail, /^Case walls 2\.4 mm \(caseWallMm\) are under the 2\.5 mm JLC3DP asks of FDM up to 200 mm long/);
  assert.match(walls({ pcbHeightMm: 300 }).walls.detail, /under the 2\.5 mm JLC3DP asks of FDM past 200 mm long/);
  // A case 42 x 42 mm is in the 50 mm column, the smallest FDM has.
  const small = walls({ pcbWidthMm: 38, pcbHeightMm: 38, caseWallMm: 1.5 });
  assert.match(small.walls.detail, /^Case walls 1\.5 mm \(caseWallMm\) are under the 1\.6 mm JLC3DP asks of FDM up to 50 mm long; .*the case is 42 x 42 mm/);
  assert.equal(walls({ pcbWidthMm: 38, pcbHeightMm: 38, caseWallMm: 1.6 }).walls.status, "pass");
});

test("a wall round a fastener needs more than 1.5 mm, and the shop's least wall", () => {
  const at = walls({ standoffOuterMm: 6.4 }).walls;
  assert.equal(at.status, "flag");
  assert.match(at.detail, /^Standoff walls 1\.5 mm \(standoffOuterMm, screwClearanceMm\) are not over the 1\.5 mm JLC3DP asks round fasteners; case walls/);
  assert.equal(walls({ standoffOuterMm: 6.6 }).walls.status, "pass", "1.6 mm is over 1.5 mm, though under the 2 mm of walls");
  assert.match(walls({ bossOuterMm: 5.8 }).walls.detail, /^Boss walls 0\.8 mm \(bossOuterMm, insertOuterMm\) are under the 1 mm Craftcloud takes of FDM/);
});

test("a skin under the shop's least wall fails", () => {
  const s = walls({ plateThicknessMm: 0.9 }).skins;
  assert.equal(s.status, "fail");
  assert.match(s.detail, /^The plate 0\.9 mm \(plateThicknessMm\) is under the 1 mm Craftcloud takes of FDM; the skin over the controller/);
});

test("each case part is held to its own process, a wall in two parts to the stricter", () => {
  assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "ABS" } }), "FDM");
  assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "PA12", process: "MJF" } }), "MJF/SLS");
  assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "PA 12" } }), "MJF/SLS");
  assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "Tough resin" } }), "SLA");
  assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "PETG", process: "fff" } }), "FDM");
  // Both parts in nylon: Craftcloud takes 0.8 mm, so a 0.9 mm wall is a person's call, not a failure.
  const nylon = walls({ caseWallMm: 0.9 }, () => ({ spec: { material: "PA12", process: "MJF" } }));
  assert.match(`${nylon.walls.status} ${nylon.walls.detail}`, /^flag Case walls 0\.9 mm \(caseWallMm\) are under the 2 mm JLC3DP asks of MJF\/SLS up to 100 mm long/);
  // A nylon lid on a PETG tray: the case walls are in both, so FDM's 1 mm holds; the bosses are the lid's alone.
  const mixed = walls({ caseWallMm: 0.9, bossOuterMm: 6.0 }, (l) => (l.role === "case-top" ? { spec: { material: "PA12", process: "MJF" } } : {}));
  assert.match(mixed.walls.detail, /^Case walls 0\.9 mm \(caseWallMm\) are under the 1 mm Craftcloud takes of FDM; boss walls 0\.9 mm \(bossOuterMm, insertOuterMm\) are not over the 1\.5 mm JLC3DP asks round fasteners/);
  assert.match(mixed.walls.detail, /\(printed MJF\/SLS and FDM; the case is/);
});

test("a print the checks can't place, or whose process has no shop's least wall here, fails rather than passing", () => {
  const sla = walls({}, () => ({ spec: { material: "Standard resin", process: "SLA" } })).walls;
  assert.match(`${sla.status} ${sla.detail}`, /^fail Sprue has no print shop's least wall for SLA yet: add one, with its page, to PRINT_WALLS in pipeline\/stages\/check\.ts$/);
  const odd = walls({}, (l) => ({ spec: { material: "Unobtainium" }, ...(l.role === "case-bottom" ? { process: "cnc" as const } : {}) })).walls;
  assert.match(`${odd.status} ${odd.detail}`, /^fail Can't tell how top is printed: give its spec\.process \(FDM, MJF, SLS or SLA\)$/);
  // A case that is machined is not the print checks' to hold.
  const cnc = walls({}, () => ({ process: "cnc" as const }));
  assert.deepEqual([cnc.walls.status, cnc.walls.detail], ["pass", "The case isn't printed (no print line with role case-top or case-bottom)"]);
});

test("a product with none of the keypad's case params skips both", () => {
  const ponder = runChecks(read<Design>("ponder", "design.json"), read<Bom>("ponder", "bom.json"));
  assert.deepEqual((ponder.skipped ?? []).filter((s) => s.id.startsWith("print-")).map((s) => s.id), ["print-walls", "print-skins"]);
});
