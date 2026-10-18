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
import { PRINT_WALLS, PROCESSES, printProcess, runChecks } from "./check.ts";

const examples = join(import.meta.dirname, "..", "..", "examples");
const read = <T>(slug: string, file: string) => JSON.parse(readFileSync(join(examples, slug, file), "utf8")) as T;
const keypad = read<Design>("macropad", "design.json"), keypadBom = read<Bom>("macropad", "bom.json");
type Line = Bom["lines"][number];

/** The keypad with some params changed (undefined takes one out) and its case lines changed, and its two wall checks.
 * `lines` replaces the case lines altogether. */
function walls(params: Record<string, number | string | undefined> = {}, line: (l: Line) => Partial<Line> = () => ({}), lines?: (ls: Line[]) => Line[]) {
  const p: Design["params"] = { ...keypad.params };
  for (const [k, v] of Object.entries(params)) if (v === undefined) delete p[k]; else p[k] = v;
  const cases = keypadBom.lines.filter((l) => /^case-/.test(l.role)).map((l) => ({ ...l, ...line(l) }));
  const bom = { ...keypadBom, lines: [...keypadBom.lines.filter((l) => !/^case-/.test(l.role)), ...(lines ? lines(cases) : cases)] };
  const all = runChecks({ ...keypad, params: p }, bom);
  const get = (id: string) => all.checks.find((c) => c.id === id)!;
  return { walls: get("print-walls"), skins: get("print-skins") };
}

test("the keypad's walls and skins under JLC3DP's figure for its size are a person's call", () => {
  const { walls: w, skins: s } = walls();
  // The standoffs are over the 1.5 mm JLC3DP asks round fasteners, but under the 2 mm it asks of a wall this size.
  assert.equal(w.status, "flag");
  assert.equal(w.detail, "Standoff walls 1.8 mm (standoffOuterMm, screwClearanceMm) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; case walls 2.4 mm (caseWallMm) and boss walls 2.1 mm (bossOuterMm, insertOuterMm) are thick enough (printed FDM; the case is 66.8 x 99.8 mm): ask the print shop before ordering");
  assert.equal(s.status, "flag");
  assert.match(s.detail, /^The plate 1\.5 mm \(plateThicknessMm\), the skin over the controller 1 mm \(lidSkinOverControllerMm\) and the skin over the inserts 1 mm \(plateTopToPcbTopMm, insertLengthMm\) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; the tray floor 2 mm \(trayFloorMm\) is thick enough/);
  assert.match(s.detail, /JLC3DP doesn't say whether its table holds for a horizontal skin: ask the print shop before ordering$/);
});

test("a case wall under the least wall the shop takes fails, naming the param seeded faults v0 thinned", () => {
  const { walls: w } = walls({ caseWallMm: 0.8, caseCornerMm: 2.2 });
  assert.equal(w.status, "fail");
  assert.match(w.detail, /^Case walls 0\.8 mm \(caseWallMm\) are under the 1 mm Craftcloud takes of FDM; standoff walls/);
  assert.ok(names(w.detail, "caseWallMm"), "the wall-thin fault expects caseWallMm");
  // The flagged walls beside it are named for the shop, so they don't read as failures too.
  assert.match(w.detail, /: ask the print shop about standoff walls before ordering$/);
  // Down to the shop's least wall is in: 1 mm passes it, and is under JLC3DP's 2 mm for a part this size.
  const one = walls({ caseWallMm: 1, standoffOuterMm: 7.4 }).walls;
  assert.match(`${one.status} ${one.detail}`, /^flag Case walls 1 mm \(caseWallMm\) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; standoff walls 2 mm/);
  assert.equal(walls({ caseWallMm: 2, standoffOuterMm: 7.4 }).walls.status, "pass");
});

test("failures are said first, whatever order the walls are in", () => {
  // The boss walls are last in the list, but they fail, so they lead.
  assert.match(walls({ bossOuterMm: 5.8 }).walls.detail, /^Boss walls 0\.8 mm \(bossOuterMm, insertOuterMm\) are under the 1 mm Craftcloud takes of FDM; standoff walls 1\.8 mm/);
});

test("JLC3DP's column is the smallest the case's longest side fits in", () => {
  assert.match(walls({ pcbHeightMm: 120 }).walls.detail, /^Case walls 2\.4 mm \(caseWallMm\), standoff walls 1\.8 mm \(standoffOuterMm, screwClearanceMm\) and boss walls 2\.1 mm \(bossOuterMm, insertOuterMm\) are under the 2\.5 mm JLC3DP asks of FDM up to 200 mm long/);
  // A case 42 x 42 mm is in the 50 mm column, the smallest FDM has.
  const small = walls({ pcbWidthMm: 38, pcbHeightMm: 38, caseWallMm: 1.5 });
  assert.match(small.walls.detail, /^Case walls 1\.5 mm \(caseWallMm\) are under the 1\.6 mm JLC3DP asks of FDM up to 50 mm long; .*the case is 42 x 42 mm/);
  assert.equal(walls({ pcbWidthMm: 38, pcbHeightMm: 38, caseWallMm: 1.6 }).walls.status, "pass");
});

test("on a case past JLC3DP's table every wall is a person's call, with no figure put in its mouth", () => {
  const big = walls({ pcbHeightMm: 300, caseWallMm: 2.6 });
  assert.equal(big.walls.status, "flag");
  assert.match(big.walls.detail, /^Case walls 2\.6 mm \(caseWallMm\), standoff walls 1\.8 mm \(standoffOuterMm, screwClearanceMm\) and boss walls 2\.1 mm \(bossOuterMm, insertOuterMm\) are on a case longer than JLC3DP's FDM table goes \(2\.5 mm up to 200 mm, and thicker past that, it says\) \(printed FDM; the case is 67\.2 x 306\.2 mm\): ask the print shop before ordering$/);
  assert.doesNotMatch(`${big.walls.detail} ${big.skins.detail}`, /past 200 mm long/);
  assert.match(big.skins.detail, /^The plate 1\.5 mm \(plateThicknessMm\), .* the tray floor 2 mm \(trayFloorMm\) are on a case longer than JLC3DP's FDM table goes/);
  // A nylon lid on a PETG tray: each table is named with its own last figure.
  const mixed = walls({ pcbHeightMm: 300, caseWallMm: 2.6 }, (l) => (l.role === "case-top" ? { spec: { material: "PA12", process: "MJF" } } : {})).walls;
  assert.match(mixed.detail, /^Case walls 2\.6 mm \(caseWallMm\) and standoff walls 1\.8 mm \(standoffOuterMm, screwClearanceMm\) are on a case longer than JLC3DP's FDM table goes \(2\.5 mm up to 200 mm, and thicker past that, it says\); boss walls 2\.1 mm \(bossOuterMm, insertOuterMm\) are on a case longer than JLC3DP's MJF\/SLS table goes \(2 mm up to 200 mm/);
  // Beside a failure, walls flagged only for the case's size are named, not said to be under a figure.
  const failing = walls({ pcbHeightMm: 300, caseWallMm: 2.6, standoffOuterMm: 9, bossOuterMm: 5.8 }).walls;
  assert.match(`${failing.status} ${failing.detail}`, /^fail Boss walls 0\.8 mm .*: ask the print shop about case walls and standoff walls before ordering$/);
  assert.doesNotMatch(failing.detail, /under JLC3DP's figures/);
});

test("a wall round a fastener needs more than 1.5 mm, and JLC3DP's figure for its size, and the shop's least wall", () => {
  const at = walls({ standoffOuterMm: 6.4 }).walls;
  assert.equal(at.status, "flag");
  assert.match(at.detail, /^Standoff walls 1\.5 mm \(standoffOuterMm, screwClearanceMm\) are not over the 1\.5 mm JLC3DP asks round fasteners; case walls/);
  // 1.6 mm is over 1.5 mm, but under the 2 mm JLC3DP asks of a wall on a case this size.
  assert.match(walls({ standoffOuterMm: 6.6 }).walls.detail, /^Standoff walls 1\.6 mm \(standoffOuterMm, screwClearanceMm\) are under the 2 mm JLC3DP asks of FDM up to 100 mm long/);
  assert.equal(walls({ standoffOuterMm: 7.4 }).walls.status, "pass");
  assert.match(walls({ bossOuterMm: 5.8 }).walls.detail, /^Boss walls 0\.8 mm \(bossOuterMm, insertOuterMm\) are under the 1 mm Craftcloud takes of FDM/);
});

test("a skin under the shop's least wall fails, and the skins beside it under JLC3DP's are still the shop's call", () => {
  const s = walls({ plateThicknessMm: 0.9 }).skins;
  assert.equal(s.status, "fail");
  assert.match(s.detail, /^The plate 0\.9 mm \(plateThicknessMm\) is under the 1 mm Craftcloud takes of FDM; the skin over the controller/);
  assert.match(s.detail, /\. JLC3DP doesn't say whether its table holds for a horizontal skin: ask the print shop about the skin over the controller and the skin over the inserts before ordering$/);
  // With nothing flagged beside a failure there is nothing to ask the shop.
  const only = walls({ caseWallMm: 0.8, caseCornerMm: 2.2, standoffOuterMm: 7.4 }).walls;
  assert.match(`${only.status} ${only.detail}`, /^fail Case walls 0\.8 mm \(caseWallMm\) are under the 1 mm Craftcloud takes of FDM; standoff walls 2 mm .* are thick enough \(printed FDM; the case is [\d.]+ x [\d.]+ mm\)$/);
});

test("a value is shown with the decimals it takes to be on the side of the limit it is", () => {
  assert.match(walls({ caseWallMm: 0.996 }).walls.detail, /^Case walls 0\.996 mm \(caseWallMm\) are under the 1 mm Craftcloud takes/);
  assert.match(walls({ caseWallMm: 1.996, standoffOuterMm: 7.4 }).walls.detail, /^Case walls 1\.996 mm \(caseWallMm\) are under the 2 mm JLC3DP asks/);
  assert.match(walls({ lidSkinOverControllerMm: 0.996 }).skins.detail, /^The skin over the controller 0\.996 mm \(lidSkinOverControllerMm\) is under the 1 mm/);
  // A wall of 1.502 mm is over the 1.5 mm round fasteners, and doesn't read as 1.5 mm.
  assert.match(walls({ standoffOuterMm: 6.404 }).walls.detail, /^Standoff walls 1\.502 mm \(standoffOuterMm, screwClearanceMm\) are under the 2 mm JLC3DP asks of FDM/);
  // A case 100.004 mm long is past the 100 mm column, and doesn't read as 100 mm.
  assert.match(walls({ pcbHeightMm: 94.204 }).walls.detail, /up to 200 mm long.*the case is 66\.8 x 100\.004 mm/);
  // However close to the limit.
  assert.match(walls({ caseWallMm: 0.9999999 }).walls.detail, /^Case walls 0\.9999999 mm \(caseWallMm\) are under the 1 mm/);
  assert.match(walls({ pcbHeightMm: 94.2000005 }).walls.detail, /the case is 66\.8 x 100\.0000005 mm/);
  assert.match(walls().walls.detail, /standoff walls 1\.8 mm .*the case is 66\.8 x 99\.8 mm/i);
});

test("each case part is held to its own process, a wall in two parts to the stricter", () => {
  const as = (spec: Record<string, string>) => printProcess({ ...keypadBom.lines[0], spec });
  assert.equal(as({ material: "ABS" }), "FDM");
  assert.equal(as({ material: "PA12", process: "MJF" }), "MJF/SLS");
  assert.equal(as({ material: "PA 12" }), "MJF/SLS");
  assert.equal(as({ material: "Tough resin" }), "SLA");
  assert.equal(as({ material: "PETG", process: "fff" }), "FDM");
  // Resins named after the plastic they act like are resins, with the word resin or without.
  for (const m of ["ABS-like resin", "PC-like resin", "ABS-Like White", "PC-like", "ABS Like White", "Siraya Tech Fast ABS-like", "Tough 2000 (ABS-like)", "Durable (PP-like)", "Flexible TPU-like"])
    assert.equal(as({ material: m }), "SLA", m);
  // A filament can be like something too, and stays a filament.
  for (const m of ["PLA (wood-like)", "TPU (rubber-like)", "PCTG (PETG-like)", "PLA Silk (metal-like)"]) assert.equal(as({ material: m }), "FDM", m);
  assert.equal(as({ material: "Marble-like PLA" }), undefined);
  // A nylon with anything after its grade but the word nylon is FDM at one shop, SLS or MJF at another and continuous
  // fibre at a third, so it needs its spec.process.
  for (const m of ["PA12-CF", "PA12 GB", "PA12 glass filled", "PA12+CF15", "PA12-GF30", "PA12 CF15", "PA12 CCF", "PA12-CCF", "PA12 CBF"]) assert.equal(as({ material: m }), undefined, m);
  assert.equal(as({ material: "PA12 nylon" }), "MJF/SLS");
  assert.equal(as({ material: "PA12-CF", process: "FDM" }), "FDM");
  // The ways shops spell the processes, and processes that only sound like them.
  for (const [p, is] of [["HP MJF", "MJF/SLS"], ["Multi Jet Fusion", "MJF/SLS"], ["Multi-Jet Fusion", "MJF/SLS"], ["Selective laser sintering", "MJF/SLS"], ["SLS/MJF", "MJF/SLS"], ["FDM/FFF", "FDM"], ["Fused deposition", "FDM"], ["MSLA", "SLA"],
    ["FDM/SLA", undefined], ["Binder jetting", undefined], ["MultiJet Printing (MJP)", undefined], ["Multi Jet Modeling", undefined], ["Direct metal laser sintering", undefined], ["Metal SLS", undefined], ["Binder jet, sintered", undefined],
    ["DMLS", undefined], ["Selective laser melting", undefined], ["Electron beam melting", undefined],
    ["FDM (metallic silver)", "FDM"], ["FDM, PLA melted at 210C", "FDM"], ["FDM, metal-filled PLA", "FDM"], ["FDM with metal inserts", "FDM"], ["MJF, metallic grey dye", "MJF/SLS"],
    // A metal print is none of the plastic rows', whatever plastic process it is done like.
    ["Metal FFF", undefined], ["Markforged Metal X (FFF)", undefined], ["Bound metal FFF", undefined], ["Metal DLP", undefined],
    ["Laser sintering (metals)", undefined], ["Metall-Lasersintern", undefined], ["Laser sintering / melting", undefined]])
    assert.equal(as({ material: "PETG", process: p! }), is, p);
  // Both parts in nylon: Craftcloud takes 0.8 mm, so a 0.9 mm wall is a person's call, not a failure.
  const nylon = walls({ caseWallMm: 0.9 }, () => ({ spec: { material: "PA12", process: "MJF" } }));
  assert.match(`${nylon.walls.status} ${nylon.walls.detail}`, /^flag Case walls 0\.9 mm \(caseWallMm\) and standoff walls 1\.8 mm \(standoffOuterMm, screwClearanceMm\) are under the 2 mm JLC3DP asks of MJF\/SLS up to 100 mm long/);
  // A nylon lid on a PETG tray: the case walls are in both, so FDM's 1 mm holds; the bosses are the lid's alone.
  const mixed = walls({ caseWallMm: 0.9, bossOuterMm: 6.0 }, (l) => (l.role === "case-top" ? { spec: { material: "PA12", process: "MJF" } } : {}));
  assert.match(mixed.walls.detail, /^Case walls 0\.9 mm \(caseWallMm\) are under the 1 mm Craftcloud takes of FDM; standoff walls 1\.8 mm \(standoffOuterMm, screwClearanceMm\) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; boss walls 0\.9 mm \(bossOuterMm, insertOuterMm\) are not over the 1\.5 mm JLC3DP asks round fasteners/);
  assert.match(mixed.walls.detail, /\(printed MJF\/SLS and FDM; the case is/);
});

test("a print the checks can't place, or whose process has no shop's least wall here, fails rather than passing", () => {
  const sla = walls({}, () => ({ spec: { material: "Standard resin", process: "SLA" } })).walls;
  assert.match(`${sla.status} ${sla.detail}`, /^fail Sprue has no print shop's least wall for SLA yet: add one, with its page, to PRINT_WALLS in pipeline\/stages\/check\.ts$/);
  assert.equal(walls({}, () => ({ spec: { material: "ABS-like resin" } })).walls.status, "fail");
  const odd = walls({}, (l) => ({ spec: { material: "Unobtainium" }, ...(l.role === "case-bottom" ? { process: "cnc" as const } : {}) })).walls;
  assert.match(`${odd.status} ${odd.detail}`, /^fail Can't tell how top is printed: give its spec\.process \(FDM, FFF, MJF, SLS or SLA\)$/);
  // A process with no figure here is either one Sprue has spelt another way, or one to add to both tables.
  const bj = walls({}, () => ({ spec: { material: "316L", process: "Binder jetting" } })).walls;
  assert.match(`${bj.status} ${bj.detail}`, /^fail Top's spec\.process "Binder jetting" is not a process Sprue has a least wall for: if it is FDM, FFF, MJF or SLS spelt another way, use that name; if not, add it, with its shop's page, to PROCESSES and PRINT_WALLS in pipeline\/stages\/check\.ts; bot's spec\.process/);
  // One that names two processes is to be given one.
  const two = walls({}, () => ({ spec: { material: "PETG", process: "FDM/SLA" } })).walls;
  assert.match(`${two.status} ${two.detail}`, /^fail Top's spec\.process "FDM\/SLA" names more than one process \(FDM and SLA\): give one; bot's/);
  assert.notEqual(walls({}, () => ({ spec: { material: "PA12", process: "HP MJF" } })).walls.status, "fail");
  // A case that is machined is not the print checks' to hold.
  const cnc = walls({}, () => ({ process: "cnc" as const }));
  assert.deepEqual([cnc.walls.status, cnc.walls.detail], ["pass", "The case isn't printed (no print line with role case-top or case-bottom)"]);
  // Nor is a printed part of it that isn't the lid or the tray, beside a machined lid and tray.
  const gasket = walls({}, () => ({ process: "cnc" as const }), (ls) => [...ls, { ...ls[0], id: "gasket", role: "case-gasket", process: "print" }]);
  assert.equal(gasket.walls.status, "pass");
});

test("a process added to both tables, as the fail says, is found, a metal one too", () => {
  const as = (process: string) => printProcess({ ...keypadBom.lines[0], spec: { material: "316L", process } });
  PROCESSES.push(["DMLS", /\b(DMLS|SLM)\b|METAL LASER/], ["Metal FFF", /\bMETAL\b.*\b(FFF|FDM)\b/]);
  PRINT_WALLS.DMLS = { min: 0.4, minFrom: "a test", bySize: [[200, 1.0]] };
  try {
    assert.equal(as("DMLS"), "DMLS");
    assert.equal(as("Direct metal laser sintering"), "DMLS");
    assert.equal(as("Metal FFF"), "Metal FFF");
    const thin = walls({ caseWallMm: 0.3 }, () => ({ spec: { material: "316L", process: "DMLS" } })).walls;
    assert.match(`${thin.status} ${thin.detail}`, /^fail Case walls 0\.3 mm \(caseWallMm\) are under the 0\.4 mm a test takes of DMLS/);
    assert.equal(walls({ caseWallMm: 1.2 }, () => ({ spec: { material: "316L", process: "DMLS" } })).walls.status, "pass");
  } finally {
    PROCESSES.splice(-2);
    delete PRINT_WALLS.DMLS;
  }
});

test("a printed case under other roles fails rather than passing as not printed", () => {
  // One printed shell, called case, with a 0.5 mm wall.
  const one = walls({ caseWallMm: 0.5 }, () => ({}), (ls) => [{ ...ls[0], role: "case" }]);
  assert.match(`${one.walls.status} ${one.walls.detail}`, /^fail No line has role case-top or case-bottom, but top \(role case\) is printed: if they are the case, give its lid and tray those roles; if not, drop or replace this check in the product's rules\.ts$/);
  assert.equal(one.skins.status, "fail");
  // Whatever the roles are called.
  const lidTray = walls({ caseWallMm: 0.5 }, () => ({}), (ls) => [{ ...ls[0], role: "lid" }, { ...ls[1], role: "tray" }]);
  assert.match(`${lidTray.walls.status} ${lidTray.walls.detail}`, /^fail No line has role case-top or case-bottom, but top \(role lid\) and bot \(role tray\) are printed/);
  assert.equal(walls({ plateThicknessMm: 0.4 }, () => ({}), (ls) => [{ ...ls[0], role: "enclosure" }]).skins.status, "fail");
});

test("a printed tray with none of the params of its skins is a person's call, not a case that isn't printed", () => {
  const s = walls({ trayFloorMm: undefined }, (l) => (l.role === "case-top" ? { process: "cnc" as const } : {})).skins;
  assert.deepEqual([s.status, s.detail], ["flag", "Bot (role case-bottom) is printed, but design.json has no trayFloorMm, so nothing of it is held here: a person checks the skins"]);
  // With its param, the floor is held.
  assert.match(walls({}, (l) => (l.role === "case-top" ? { process: "cnc" as const } : {})).skins.detail, /^The tray floor 2 mm \(trayFloorMm\) is thick enough/);
});

test("a wall or size param that isn't a number fails, naming it, rather than passing as thick enough", () => {
  const thin = walls({ caseWallMm: "0.8 mm" }).walls;
  assert.deepEqual([thin.status, thin.detail], ["fail", 'caseWallMm is "0.8 mm", not a number of mm']);
  assert.equal(walls({ insertOuterMm: "4.2 mm", screwClearanceMm: "" }).walls.detail, 'screwClearanceMm is "", insertOuterMm is "4.2 mm", not numbers of mm');
  assert.equal(walls({ insertOuterMm: "4.2 mm" }).walls.status, "fail");
  assert.equal(walls({ pcbWidthMm: "61 mm" }).walls.status, "fail");
  assert.deepEqual([walls({ trayFloorMm: "thin" }).skins.status, walls({ trayFloorMm: "thin" }).skins.detail], ["fail", 'trayFloorMm is "thin", not a number of mm']);
  // A number written as a string is still that number.
  assert.equal(walls({ caseWallMm: "2.4" }).walls.detail, walls().walls.detail);
});

test("a wall with some of its params but not all fails, naming the one left out", () => {
  assert.deepEqual([walls({ insertOuterMm: undefined }).walls.status, walls({ insertOuterMm: undefined }).walls.detail],
    ["fail", "Can't hold boss walls: design.json has bossOuterMm but not insertOuterMm"]);
  assert.match(walls({ screwClearanceMm: undefined }).walls.detail, /^Can't hold standoff walls: design\.json has standoffOuterMm but not screwClearanceMm$/);
  assert.match(walls({ insertLengthMm: undefined }).skins.detail, /^Can't hold the skin over the inserts: design\.json has plateTopToPcbTopMm but not insertLengthMm$/);
  // With neither, the wall isn't the design's, and the rest are still held.
  const none = walls({ bossOuterMm: undefined, insertOuterMm: undefined }).walls;
  assert.equal(none.detail, "Standoff walls 1.8 mm (standoffOuterMm, screwClearanceMm) are under the 2 mm JLC3DP asks of FDM up to 100 mm long; case walls 2.4 mm (caseWallMm) are thick enough (printed FDM; the case is 66.8 x 99.8 mm): ask the print shop before ordering");
});

test("a product with none of the keypad's case params skips both", () => {
  const ponder = runChecks(read<Design>("ponder", "design.json"), read<Bom>("ponder", "bom.json"));
  assert.deepEqual((ponder.skipped ?? []).filter((s) => s.id.startsWith("print-")).map((s) => s.id), ["print-walls", "print-skins"]);
});
