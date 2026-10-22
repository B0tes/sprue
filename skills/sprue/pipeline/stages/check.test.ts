// Tests of the printed-wall checks on the keypad as it is and as seeded faults v0 broke it: a case wall under the
// least wall the print shop takes fails and names its param, one under JLC3DP's figure for the part's size is a
// person's call, and so is a skin, since no shop says whether its table holds for one. And of each check's scope: a
// part on its own (Design's gate) or the parts together (Inspect's). Run them with
//   node --test skills/sprue/pipeline/stages/check.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { names } from "../faults.ts";
import type { Bom, Design } from "../types.ts";
import { PRINT_WALLS, PROCESSES, printProcess, runChecks, type LocalRule } from "./check.ts";

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
  // spec.process is a process's name, or two of the same process's, as shops spell them, and nothing else: anything
  // else about the print (a finish, inserts, a second process, a metal) goes in the line's notes, so such a line fails,
  // saying so, rather than being read as one of the plastic rows.
  const plastic: Record<string, string> = { FDM: "PETG", "MJF/SLS": "PA12", SLA: "Standard resin" };
  for (const [k, names] of PROCESSES) for (const n of names) assert.equal(as({ material: plastic[k], process: n.toLowerCase() }), k, n);
  for (const [p, is] of [["HP  MJF", "MJF/SLS"], ["HP_MJF", "MJF/SLS"], ["Fused deposition modeling (FDM)", "FDM"], ["HP MultiJet Fusion", "MJF/SLS"], ["HP MJF", "MJF/SLS"], ["Multi Jet Fusion", "MJF/SLS"], ["Multi-Jet Fusion", "MJF/SLS"], ["Selective laser sintering", "MJF/SLS"], ["SLS/MJF", "MJF/SLS"],
    ["Selective Laser Sintering (SLS)", "MJF/SLS"], ["FDM/FFF", "FDM"], ["Fused deposition", "FDM"], ["Fused deposition modelling (FDM)", "FDM"], ["Fused filament fabrication", "FDM"],
    ["fused-filament fabrication", "FDM"], ["Fused Layer Modeling (FLM)", "FDM"], [" fdm ", "FDM"], ["MSLA", "SLA"], ["Resin", "SLA"],
    ["FDM/SLA", undefined], ["FDM or selective laser sintering", undefined], ["SLS or FFF", undefined], ["FDM (SLA)", undefined], ["FDM/FFF/SLS", undefined],
    ["Binder jetting", undefined], ["MultiJet Printing (MJP)", undefined], ["Multi Jet Modeling", undefined], ["FGF", undefined], ["Fused granulate fabrication", undefined],
    ["Direct metal laser sintering", undefined], ["Metal SLS", undefined], ["DMLS", undefined], ["Selective laser melting", undefined], ["Metal FFF", undefined],
    ["Markforged Metal X (FFF)", undefined], ["Bound metal FFF", undefined], ["SLS métal", undefined], ["Metall-Lasersintern", undefined], ["FFF, 316L stainless", undefined],
    ["FFF, sintered", undefined], ["FDM, debound", undefined], ["FFF, kiln-fired", undefined], ["FFF, gesintert", undefined], ["FFF (copper)", undefined],
    ["FDM, metal M2.5 heat-set inserts", undefined], ["FDM with metal inserts", undefined], ["FDM, XTC-3D resin coated", undefined], ["FDM (metallic silver)", undefined],
    ["FDM, PLA", undefined], ["Bambu X1C, FDM", undefined], ["", "FDM"]])
    for (const material of is ? [plastic[is]] : Object.values(plastic)) assert.equal(as({ material, process: p! }), is, `${p} in ${material}`);
  // A plastic process holds only a plastic it prints: a metal or ceramic named by itself, with any process, is none.
  for (const [material, process, is] of [["Prusament PETG", "FDM", "FDM"], ["Copper-filled PLA", "FDM", "FDM"], ["Stainless steel PLA", "FDM", "FDM"], ["Glass-filled PA12", "SLS", "MJF/SLS"], ["PA2200", "SLS", "MJF/SLS"],
    // Makers' names: a prefix or a grade run into the plastic, and the plastics with trade names of their own.
    ["eSUN ePLA-Matte", "FDM", "FDM"], ["eSUN eTPU-95A", "FDM", "FDM"], ["eSUN eASA", "FDM", "FDM"], ["eSUN ePA-CF", "FDM", "FDM"], ["Prusament rPLA", "FDM", "FDM"], ["Proto-pasta HTPLA", "FDM", "FDM"],
    ["PolyFlex TPU95", "FDM", "FDM"], ["Bambu PAHT-CF", "FDM", "FDM"], ["Bambu PET-CF", "FDM", "FDM"], ["Fiberlogy Easy PET-G", "FDM", "FDM"], ["Bambu PPS-CF", "FDM", "FDM"], ["PolyMide CoPA", "FDM", "FDM"],
    ["Markforged Onyx", "FFF", "FDM"], ["Stratasys ABSplus-P430", "FDM", "FDM"], ["PA12CF", "FDM", "FDM"],
    ["BASF Ultrasint TPU01", "MJF", "MJF/SLS"], ["Ultrasint TPU88A", "SLS", "MJF/SLS"], ["Versatile Plastic", "SLS", "MJF/SLS"], ["EOS Alumide", "SLS", "MJF/SLS"], ["DuraForm GF", "SLS", "MJF/SLS"],
    ["Polyamid 12", "SLS", "MJF/SLS"], ["Poliammide 12", "MJF", "MJF/SLS"], ["Poliamida 12", "SLS", "MJF/SLS"], ["Nylon PA12", "MJF", "MJF/SLS"], ["HP 3D HR PA 12", "MJF", "MJF/SLS"],
    ["316L stainless steel", "Laser sintering", undefined], ["BASF Ultrafuse 316L", "FFF", undefined], ["Ti6Al4V", "SLS", undefined], ["Zirconia", "FFF", undefined], ["Quartz sand", "Laser sintering", undefined],
    ["acciaio", "SLS con polveri metalliche", undefined], ["", "FDM", undefined], ["Inconel 718", "SLS", undefined], ["Edelstahl 1.4404", "Lasersintern (Edelstahl)", undefined],
    ["Copper", "FFF", undefined], ["Porcelain", "FDM", undefined],
    ["colorFabb nGen", "FDM", "FDM"], ["colorFabb XT", "FDM", "FDM"], ["colorFabb HT", "FDM", "FDM"], ["Formfutura HDglass", "FDM", "FDM"], ["Formfutura ApolloX", "FDM", "FDM"],
    ["MatterHackers NylonX", "FDM", "FDM"], ["NylonG", "FDM", "FDM"], ["Polycarbonat", "FDM", "FDM"], ["Policarbonato", "FDM", "FDM"], ["Polypropylen", "MJF", "MJF/SLS"],
    ["Polipropilene", "SLS", "MJF/SLS"], ["Polipropileno", "FDM", "FDM"], ["Windform XT", "FDM", undefined],
    ["Stratasys Antero 800NA", "FDM", "FDM"], ["White Strong & Flexible", "SLS", "MJF/SLS"], ["EOS PrimePart PLUS", "SLS", "MJF/SLS"], ["Windform SP", "SLS", "MJF/SLS"],
    ["EOS CarbonMide", "SLS", "MJF/SLS"], ["Polyamid 6", "FDM", "FDM"], ["ecoPLA", "FDM", "FDM"], ["Polymaker Panchroma CoPE", "FDM", "FDM"], ["Polymaker PolySmooth", "FDM", "FDM"],
    ["co-polyester (colorFabb XT)", "FDM", "FDM"], ["Laser-sintered PA12", "SLS", "MJF/SLS"], ["Fire-retardant PLA", "FDM", "FDM"],
    // A metal or ceramic held in a plastic binder, or a part debound and fired after printing, names a plastic but
    // isn't one: no plastic row's least wall holds it.
    ["Copper Filamet (PLA binder)", "FFF", undefined], ["316L Stainless Filamet (PLA binder)", "FFF", undefined], ["Bronze Filamet", "FDM", undefined],
    ["Copper Filamet PLA", "FDM", undefined], ["316L, POM binder", "FFF", undefined], ["Kupfer-Filamet (PLA-Binder)", "FFF", undefined], ["Filamet cuivre (liant PLA)", "FFF", undefined],
    ["PLA, sintered", "FDM", undefined], ["Sintered copper (Copper Filamet, PLA binder)", "FFF", undefined], ["PLA, debound", "FDM", undefined], ["PLA, kiln-fired", "FFF", undefined],
    ["PLA, gesintert", "FFF", undefined], ["PLA fritté", "FFF", undefined], ["PA12 (binder)", "SLS", undefined], ["PLA binder, copper", "", undefined],
    ["Cuivre (liant PLA)", "FFF", undefined], ["Rame (legante PLA)", "FFF", undefined], ["PLA, entbindert", "FFF", undefined], ["PLA, déliantage", "FFF", undefined],
    ["PLA, de-binding", "FFF", undefined], ["PLA, furnace", "FFF", undefined], ["PLA, im Ofen", "FFF", undefined], ["PLA, in forno", "FFF", undefined],
    ["PLA, kiln", "FFF", undefined], ["PLA, fired", "FFF", undefined], ["Bronze powder in PLA binders", "FFF", undefined], ["PLA binding agent, bronze", "FFF", undefined],
    ["PLA-bound bronze", "FFF", undefined], ["PLA, de-bound", "FFF", undefined], ["Porcelain PLA, needs firing", "FFF", undefined], ["PLA, binder burnt out", "FDM", undefined], ["PLA, burnt out", "FDM", undefined], ["PLA, debinding step", "FFF", undefined],
    ["PLA + bronze, burnout", "FDM", undefined], ["PLA-Ton, im Brennofen", "FFF", undefined], ["PLA-Ton, gebrannt", "FFF", undefined], ["Kupfer in PLA-Bindemittel", "FFF", undefined],
    ["PLA céramique, cuit", "FFF", undefined], ["PLA céramique, cuisson", "FFF", undefined], ["PLA céramique, au four", "FFF", undefined], ["PLA cerámico, horno", "FFF", undefined],
    ["PLA cerámico, cocido", "FFF", undefined], ["PLA cerámico, cocción", "FFF", undefined], ["Cobre (aglutinante PLA)", "FFF", undefined], ["Cobre (ligante PLA)", "FFF", undefined],
    // A resin is cured in a UV oven; one of ceramic, metal or sand is fired, and an empty material is none.
    ["Tough resin, post-cured im UV-Ofen", "SLA", "SLA"], ["Formlabs Grey Resin", "DLP", "SLA"], ["Zirconia", "LCD", undefined], ["Formlabs Ceramic Resin", "SLA", undefined],
    ["Ceramic resin", "", undefined], ["316L in photopolymer binder", "DLP", undefined], ["Porcelite resin", "SLA", undefined], ["Alumina resin", "MSLA", undefined],
    ["Silica resin", "SLA", undefined], ["Sand resin", "SLA", undefined], ["Zirconia resin", "SLA", undefined], ["316L resin", "SLA", undefined], ["PETG", "SLA", undefined], ["Metal-filled resin", "SLA", undefined], ["Steel resin", "SLA", undefined], ["Stainless resin", "SLA", undefined],
    ["Copper resin", "SLA", undefined], ["Bronze resin", "SLA", undefined], ["Titanium resin", "SLA", undefined], ["Keramik-Resin", "SLA", undefined], ["", "SLA", undefined]])
    assert.equal(as({ material: material!, process: process! }), is, `${process} in ${material}`);
  // A plastic named first and like another is a filament, not a resin.
  for (const m of ["Tough PLA (ABS-like)", "CPE (PETG-like)", "PA12 (PP-like)", "Prusament PETG (PC-like)", "Generic PETG-like filament"]) assert.notEqual(as({ material: m }), "SLA", m);
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
  // A spec.process that is not a process's name (another process, two processes, a metal print, a finish) is to be
  // written as just the name, or added to both tables.
  const add = 'add its process, with its names and its shop\'s page, to PROCESSES \\(marked "fired" if its prints are debound, sintered or fired\\) and PRINT_WALLS in pipeline\\/stages\\/check\\.ts, and write one of those names in spec\\.process';
  for (const process of ["MultiJet Printing (MJP)", "Metal SLS", "Binder jetting", "FDM/SLA", "FDM, metal M2.5 heat-set inserts"]) {
    const not = walls({}, () => ({ spec: { material: "PA12", process } })).walls;
    const said = JSON.stringify(process).replace(/[().*+?/]/g, "\\$&");
    assert.match(`${not.status} ${not.detail}`, new RegExp(`^fail Top's spec\\.process ${said} is not the name of a process Sprue reads: if it is FDM, MJF, SLS or SLA, write just the name there \\(as in FDM, FFF, MJF, SLS, SLA or "Fused deposition modeling \\(FDM\\)"\\) and the rest in the line's notes; if it is a print in metal, ceramic or sand, one fired, sintered or debound after printing, or another process, ${add}; bot's spec\\.process`), process);
  }
  // A plastic process in a material it doesn't print, or in a metal or ceramic bound in a plastic, says which and what to do.
  const steel = walls({}, () => ({ spec: { material: "316L stainless steel", process: "Laser sintering" } })).walls;
  assert.match(`${steel.status} ${steel.detail}`, new RegExp(`^fail Top's spec\\.process "Laser sintering" is MJF\\/SLS, but its spec\\.material "316L stainless steel" names no material Sprue knows MJF\\/SLS prints: if it is one, write its plastic there \\(as in "PETG", "Onyx \\(nylon\\)" or "Grey resin"\\); if it is a plastic Sprue doesn't list, add it, with its shop's page for its least wall, to MJF\\/SLS's materials in PROCESSES in pipeline\\/stages\\/check\\.ts; if it is a metal, ceramic or sand, ${add}; bot`));
  const filamet = walls({}, () => ({ spec: { material: "Copper Filamet (PLA binder)", process: "FFF" } })).walls;
  assert.match(`${filamet.status} ${filamet.detail}`, new RegExp(`^fail Top's spec\\.material "Copper Filamet \\(PLA binder\\)" reads as a metal, ceramic or sand held in a plastic binder, or a part debound, sintered or fired after printing \\(it says "FILAMET"\\), which no FDM least wall holds: if it is a plastic part used as printed, leave that word out; if not, ${add}; bot`));
  // Following the refusal of "FFF, sintered" by moving the word to the notes still fails: the notes are read too.
  const notes = walls({}, () => ({ spec: { material: "Copper-filled PLA", process: "FFF" }, notes: "Debound and sintered after printing." })).walls;
  assert.match(`${notes.status} ${notes.detail}`, /^fail Top's notes "Debound and sintered after printing\." reads as .* \(it says "DEBOUND"\)/);
  // The notes also name the hardware in the part, so only words for the part itself being debound or fired count there.
  const noted = (spec: Record<string, string>, notes: string) => printProcess({ ...keypadBom.lines[0], spec, notes });
  for (const [spec, notes, is] of [[{ material: "PETG" }, "From the CAD (sprue cad).", "FDM"], [{ material: "PETG" }, "Sintered bronze bushing pressed in.", "FDM"],
    [{ material: "PETG", process: "FDM" }, "Lid held with M4 binding screws; the bosses are bound to warp, add a brim.", "FDM"],
    [{ material: "PA12", process: "MJF" }, "Two binding posts on the back; laser-sintered price from Craftcloud.", "MJF/SLS"],
    [{ material: "Grey resin", process: "SLA" }, "M3 metal heat-set inserts, stainless steel screws, copper tape inside.", "SLA"],
    [{ material: "Copper-filled PLA", process: "FFF" }, "Sintered after printing.", undefined], [{ material: "Copper-filled PLA", process: "FFF" }, "Printed, then sintered.", undefined],
    [{ material: "Porcelain PLA" }, "Kiln-fired at 1200 C.", undefined], [{ material: "PLA" }, "Binder burnt out in a furnace.", undefined]] as const)
    assert.equal(noted(spec, notes), is, notes);
  for (const notes of ["Debound.", "Debinding step.", "Entbindert.", "Déliantage.", "Kiln.", "Furnace.", "Fired.", "Firing.", "Burnout.", "Burnt out.", "Gebrannt.", "Cuisson.", "Cocción."])
    assert.equal(noted({ material: "PLA", process: "FFF" }, notes), undefined, notes);
  assert.match(walls({}, () => ({ spec: { material: "PLA, sintered", process: "FFF" } })).walls.detail, /^Top's spec\.material "PLA, sintered" reads as .* \(it says "SINTERED"\)/);
  assert.match(walls({}, () => ({ spec: { material: "PLA, debound" } })).walls.detail, /^Top's spec\.material "PLA, debound" reads as .* \(it says "DEBOUND"\)/);
  assert.match(walls({}, () => ({ spec: { process: "FDM" } })).walls.detail, /^Top's spec\.process "FDM" is FDM, but the line has no spec\.material: give it; bot/);
  assert.notEqual(walls({}, () => ({ spec: { material: "PA12", process: "HP MJF" } })).walls.status, "fail");
  // A case that is machined is not the print checks' to hold.
  const cnc = walls({}, () => ({ process: "cnc" as const }));
  assert.deepEqual([cnc.walls.status, cnc.walls.detail], ["pass", "The case isn't printed (no print line with role case-top or case-bottom)"]);
  // Nor is a printed part of it that isn't the lid or the tray, beside a machined lid and tray.
  const gasket = walls({}, () => ({ process: "cnc" as const }), (ls) => [...ls, { ...ls[0], id: "gasket", role: "case-gasket", process: "print" }]);
  assert.equal(gasket.walls.status, "pass");
});

test("a process or a plastic added to the tables, as the fails say, is found, a metal or a ceramic one too", () => {
  const as = (material: string, process: string) => printProcess({ ...keypadBom.lines[0], spec: { material, process } });
  const fdm = PROCESSES[0];
  PROCESSES.push(["DMLS", ["DMLS", "DIRECT METAL LASER SINTERING", "METAL LASER SINTERING"]], ["Metal FFF", ["METAL FFF"], /\b(316L|COPPER)\b/i, "fired"], ["Ceramic FFF", ["CERAMIC FFF"], undefined, "fired"],
    ["FGF", ["FGF"], /\b(PLA|PETG)\b/i]);
  PRINT_WALLS.DMLS = { min: 0.4, minFrom: "a test", bySize: [[200, 1.0]] };
  try {
    assert.equal(as("316L", "DMLS"), "DMLS");
    assert.equal(as("316L", "Direct metal laser sintering"), "DMLS");
    // Following the refusals: name the added process in spec.process, and its row holds the line alone.
    assert.equal(as("316L", "Laser sintering"), undefined);
    assert.equal(as("316L", "Metal laser sintering"), "DMLS");
    assert.equal(as("Copper Filamet (PLA binder)", "FFF"), undefined);
    assert.equal(as("Copper Filamet (PLA binder)", "Metal FFF"), "Metal FFF");
    assert.equal(as("Zirconia", "FFF"), undefined);
    assert.equal(as("Zirconia", "Ceramic FFF"), "Ceramic FFF");
    assert.equal(as("316L (POM binder)", "Metal FFF"), "Metal FFF");
    // A process added unmarked is a plastic one: a binder or firing in its material or notes still fails.
    assert.equal(as("PETG pellets", "FGF"), "FGF");
    assert.equal(as("Copper Filamet (PLA binder)", "FGF"), undefined);
    assert.equal(printProcess({ ...keypadBom.lines[0], spec: { material: "PLA", process: "FGF" }, notes: "Kiln-fired." }), undefined);
    assert.equal(as("316L (POM binder)", "DMLS"), undefined);
    assert.equal(as("POM (acetal)", "FDM"), undefined);
    PROCESSES[0] = [fdm[0], fdm[1], new RegExp(`${fdm[2]!.source}|\\bPOM\\b`, "i")];
    assert.equal(as("POM (acetal)", "FDM"), "FDM");
    const thin = walls({ caseWallMm: 0.3 }, () => ({ spec: { material: "316L", process: "DMLS" } })).walls;
    assert.match(`${thin.status} ${thin.detail}`, /^fail Case walls 0\.3 mm \(caseWallMm\) are under the 0\.4 mm a test takes of DMLS/);
    assert.equal(walls({ caseWallMm: 1.2 }, () => ({ spec: { material: "316L", process: "DMLS" } })).walls.status, "pass");
  } finally {
    PROCESSES[0] = fdm;
    PROCESSES.splice(-4);
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

test("each built-in check holds a part on its own or the parts together, and says which in checks.json", () => {
  const all = runChecks(keypad, keypadBom).checks;
  const scopes = Object.fromEntries(all.map((c) => [c.id, c.scope]));
  assert.deepEqual(scopes, {
    "bom-roles": "part", "key-count": "part", gpio: "part", "usb-power": "assembly", "mx-plate": "part", "keys-on-pcb": "part",
    "controller-zone": "assembly", "usb-reach": "assembly", "lid-headroom": "assembly", "socket-headroom": "assembly",
    "screw-engagement": "assembly", "insert-depth": "assembly", "holes-clear-keys": "assembly", "feet-clear-heads": "assembly",
    "print-walls": "part", "print-skins": "part", standards: "part",
  });
  // A check that can't run for want of a param keeps its rule's scope, so it stops the gate that holds it.
  const p: Design["params"] = { ...keypad.params };
  delete p.usbMaxRecessMm;
  const usb = runChecks({ ...keypad, params: p }, keypadBom).checks.find((c) => c.id === "usb-reach")!;
  assert.deepEqual([usb.status, usb.scope], ["fail", "assembly"]);
  assert.equal(runChecks(keypad, keypadBom).unscoped, undefined, "no rules.ts, so no rule without a scope");
});

test("a rules.ts rule with no scope is a check of a part and is named in unscoped; a misspelt scope fails", () => {
  const rule = (id: string, scope?: string) => ({ id, title: id, needs: ["keyRows"], ...(scope ? { scope } : {}), run: () => ({ status: "pass", detail: "ok" }) }) as LocalRule;
  const c = runChecks(keypad, keypadBom, [rule("mine"), rule("ours", "assembly"), rule("gpio"), { id: "standards", off: true }, rule("odd", "whole")]);
  const get = (id: string) => c.checks.find((x) => x.id === id);
  assert.equal(get("mine")!.scope, "part");
  assert.equal(get("ours")!.scope, "assembly");
  // A rules.ts rule that replaces a built-in says its own scope, or none.
  assert.equal(get("gpio")!.scope, "part");
  assert.deepEqual(c.unscoped, ["mine", "gpio"]);
  const odd = get("rules:odd:scope")!;
  assert.deepEqual([odd.status, odd.scope], ["fail", "part"]);
  assert.equal(odd.title, 'rules.ts: rule "odd" has scope "whole"');
  assert.equal(get("odd")!.scope, "part");
  // The duplicate-id row is a part's, too.
  const twice = runChecks(keypad, keypadBom, [rule("mine", "assembly"), rule("mine", "assembly")]);
  assert.equal(twice.checks.find((x) => x.id === "rules:mine")!.scope, "part");
  assert.equal(twice.unscoped, undefined);
});

test("every rule of Ponder's rules.ts says its scope", async () => {
  const { rules } = (await import(pathToFileURL(join(examples, "ponder", "rules.ts")).href)) as { rules: LocalRule[] };
  const of = (scope: string) => rules.filter((r) => "scope" in r && r.scope === scope).map((r) => r.id).sort();
  assert.deepEqual(of("part"), ["camera-focus-resolution", "camera-fov", "mic-mute", "pin-map", "ponder-bom-roles", "small-parts", "standards"]);
  assert.deepEqual(of("assembly"), ["amp-speaker", "arm-mount-stack", "arm-reach", "ballast-fit", "base-headroom", "camera-cable", "camera-light", "drop",
    "gpio-current", "harness-bore", "harness-conductors", "harness-length", "head-voltage", "pi-screws", "power-budget", "shell-screws", "tip-arm-straight",
    "tip-design-pose", "tip-push"]);
  assert.equal(rules.length, 26);
  const c = runChecks(read<Design>("ponder", "design.json"), read<Bom>("ponder", "bom.json"), rules);
  assert.equal(c.unscoped, undefined);
  assert.ok(c.checks.every((x) => x.scope === "part" || x.scope === "assembly"));
});
