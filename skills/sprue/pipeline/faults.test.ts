// Tests of the seeded faults (`sprue faults`): a fault's edits go in exactly as written or not at all, a problem the
// clean copy also has (its numbers and the copy's folder aside) catches nothing, a problem must name what the fault broke, the clean copy's
// problems are false alarms unless the list knows them, and the score reads faults.json only while it is of the
// product and the gates there are now. The last test runs the real steps on a small product of bought parts. Run with
//   node --test skills/sprue/pipeline/faults.test.ts

import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { applyEdits, collect, copyProduct, falseAlarms, faults, judge, names, readFaultList, shape } from "./faults.ts";
import { faultsAudit, faultsInputs, productFiles, productLinks } from "./stages/score.ts";
import type { FaultList, FaultsReport, Problem } from "./types.ts";

const tmp = mkdtempSync(join(tmpdir(), "sprue-faults-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** A folder of files, each given as path to text (an object is written as JSON). */
function folder(files: Record<string, unknown>): string {
  const dir = join(tmp, `p${n++}`);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}
const json = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

test("a problem's shape is its text with the numbers taken out, not the digits of a name", () => {
  assert.equal(shape("bot is 0.15 mm from scr1 beside where they touch, at (-24.0, -43.5, -4.3)"), "bot is # mm from scr1 beside where they touch, at (#, #, #)");
  assert.equal(shape("K1 is wired to GP7 (U1 pin 10), 28% open"), "K1 is wired to GP7 (U1 pin #), #% open");
  assert.equal(shape("U1.14 and sw9 at 3.5"), "U1.14 and sw9 at #");
});

test("a problem names a word only as a whole word, in any case", () => {
  assert.ok(names("mx-plate: Cutout 13.5 mm (14.0)", "cutout"));
  assert.ok(names("Missing: cable", "cable"));
  assert.ok(!names("K10 is wired to GP2", "K1"));
  assert.ok(!names("fault-sw1 moved", "sw1"));
  assert.ok(!names("sw1-cap", "sw1"));
  assert.ok(names("a.b is off", "a.b"));
  assert.ok(!names("axb is off", "a.b"), "a dot in the word is a dot, not any character");
});

test("edits: set and delete by path, replace once; anything that does not apply throws", () => {
  const dir = folder({
    "design.json": { params: { caseWallMm: 2.4 } },
    "bom.json": { lines: [{ id: "sw", qtyPerUnit: 9 }, { id: "cable", qtyPerUnit: 1 }] },
    "catalog.json": { offers: { ctrl: [], sw: [] } },
    "cad/top.py": "a = 1\nb = 2\nb = 2\n",
  });
  applyEdits(dir, [
    { file: "design.json", set: { "params.caseWallMm": 0.8 } },
    { file: "bom.json", set: { "lines[id=sw].qtyPerUnit": 8 }, delete: ["lines[id=cable]"] },
    { file: "catalog.json", delete: ["offers.ctrl"] },
    { file: "cad/top.py", replace: [{ from: "a = 1", to: "a = $& 2" }] },
  ]);
  assert.equal(json(dir, "design.json").params.caseWallMm, 0.8);
  assert.deepEqual(json(dir, "bom.json").lines, [{ id: "sw", qtyPerUnit: 8 }]);
  assert.deepEqual(Object.keys(json(dir, "catalog.json").offers), ["sw"]);
  assert.equal(readFileSync(join(dir, "cad/top.py"), "utf8"), "a = $& 2\nb = 2\nb = 2\n", "the replacement is taken as written");
  const fails = (edit: Parameters<typeof applyEdits>[1][number], msg: RegExp) => assert.throws(() => applyEdits(dir, [edit]), msg);
  fails({ file: "design.json", set: { "params.caseWalMm": 1 } }, /there is no caseWalMm/);
  fails({ file: "bom.json", set: { "lines[id=sock].qtyPerUnit": 1 } }, /lines has none with id sock/);
  fails({ file: "design.json", set: { "params[id=x].y": 1 } }, /params is not a list/);
  fails({ file: "cad/top.py", replace: [{ from: "b = 2", to: "b = 3" }] }, /is there 2 times, not once/);
  fails({ file: "cad/top.py", replace: [{ from: "c = 3", to: "" }] }, /is there 0 times, not once/);
  fails({ file: "cad/top.py", set: { a: 1 } }, /set and delete are for JSON files/);
  fails({ file: "cad/none.py", replace: [{ from: "a", to: "b" }] }, /cad\/none.py is not in the product/);
  // An edit that would put no fault in: a misspelt key, a `to` left out, a value already there.
  fails({ file: "bom.json", sett: { "lines[id=sw].qtyPerUnit": 7 } } as never, /sett: an edit takes only file, set, delete, replace and optional/);
  fails({ file: "cad/top.py", replace: [{ from: "a = $& 2", too: "x" }] } as never, /replace must be a list of \{ from, to \}/);
  fails({ file: "design.json" }, /needs set, delete or replace/);
  fails({ file: "design.json", set: { "params.caseWallMm": 0.8 } }, /design.json: the edit changes nothing/);
  fails({ file: "cad/top.py", replace: [{ from: "a = $& 2", to: "a = $& 2" }] }, /the edit changes nothing/);
  // A file the product may not have is skipped when optional; a replace sees the file as written, before a set rewrites it.
  applyEdits(dir, [{ file: "offers.digikey.json", delete: ["offers.ctrl"], optional: true }]);
  writeFileSync(join(dir, "design.json"), '{ "params": { "caseWallMm": 0.8, "plateCutoutMm": 14.0 } }');
  applyEdits(dir, [{ file: "design.json", replace: [{ from: '"plateCutoutMm": 14.0', to: '"plateCutoutMm": 13.5' }], set: { "params.caseWallMm": 1 } }]);
  assert.deepEqual(json(dir, "design.json").params, { caseWallMm: 1, plateCutoutMm: 13.5 });
});

test("the fault list is held to its shape before anything runs", () => {
  const fault = { id: "a", area: "bom", fault: "x", edit: [{ file: "bom.json", delete: ["lines[id=x]"] }], expect: ["x"] };
  const list = (faults: unknown[], known?: unknown) => folder({ "reference/faults.json": { slug: "x", faults, ...(known ? { known } : {}) } });
  assert.deepEqual(readFaultList(list([fault])).known, []);
  assert.throws(() => readFaultList(folder({ "design.json": "{}" })), /reference\/faults.json: there is none/);
  assert.throws(() => readFaultList(list([])), /faults is empty/);
  assert.throws(() => readFaultList(list([fault, fault])), /a: the id is taken/);
  assert.throws(() => readFaultList(list([{ ...fault, id: "clean" }])), /clean: the id is taken/);
  assert.throws(() => readFaultList(list([{ ...fault, id: "A b" }])), /lower-case letters/);
  assert.throws(() => readFaultList(list([{ ...fault, area: "firmware" }])), /area must be/);
  assert.throws(() => readFaultList(list([{ ...fault, expect: [] }])), /expect must be a list/);
  assert.throws(() => readFaultList(list([{ ...fault, expect: "x" }])), /expect must be a list/, "a string is not a list, though it has a length");
  assert.throws(() => readFaultList(list([{ ...fault, edit: [] }])), /edit must be a list of edits/);
  assert.throws(() => readFaultList(list([{ ...fault, edit: [{ file: "bom.json", sets: { a: 1 } }] }])), /a: edit 1: sets: an edit takes only/);
  assert.throws(() => readFaultList(list([fault], { problem: "x", why: "y" })), /known must be a list/);
  assert.throws(() => readFaultList(list([fault], [{ problem: "x" }])), /needs problem and why/);
});

test("a copy holds the product's own files, not what a run wrote", () => {
  const dir = folder({
    "design.json": "{}", "cad/top.py": "", "cad/__pycache__/top.pyc": "", "cad/.top.py.swp": "", "reference/faults.json": "{}",
    "firmware/code.py": "", "firmware/fil.json": "", "fab/top.stl": "", "pcb/x.zip": "", "score.json": "", "system.json": "",
    "faults.json": "", "state.json": "", "view.html": "",
  });
  assert.deepEqual(productFiles(dir), ["cad/top.py", "design.json", "firmware/code.py", "reference/faults.json"]);
  // A link to the product's own pcb/ (a board line written board/x.zip) stays a link, to the copy's own pcb/.
  symlinkSync("pcb", join(dir, "board"));
  assert.deepEqual([productFiles(dir).length, productLinks(dir)], [4, ["board"]]);
  const to = join(tmp, `copy${n++}`);
  copyProduct(dir, to);
  assert.deepEqual(productFiles(to), productFiles(dir));
  assert.ok(lstatSync(join(to, "board")).isSymbolicLink() && readlinkSync(join(to, "board")) === "pcb");
  assert.ok(!existsSync(join(to, "fab")) && !existsSync(join(to, "score.json")));
  // The firmware sprue pcb wrote is made again in each copy, so it is no input of the result; a user's own is.
  writeFileSync(join(dir, "firmware/code.py"), "# The x's firmware. `sprue pcb x` wrote it from the routed board.\n");
  assert.equal(faultsInputs(dir)["firmware/code.py"], undefined);
  writeFileSync(join(dir, "firmware/code.py"), "# mine\n");
  assert.ok(faultsInputs(dir)["firmware/code.py"]);
});

test("every gate's problems are collected, and a stage that did not run is said apart", () => {
  const dir = folder({
    "checks.json": { checks: [{ id: "mx-plate", status: "fail", detail: "Cutout 13.5 mm (14.0)" }, { id: "standards", status: "flag", detail: "FCC" }] },
    "pcb/drc.json": { errors: ["track GND #5 on B.Cu is 0.20 mm wide, the minimum is 0.25 mm"] },
    "pcb/verify.json": { layers: [
      { id: "audit", status: "fail", errors: ["repeated from drc.json"] },
      { id: "readback", status: "fail", errors: ["OPEN: GP10 is in 2 pieces"] },
      { id: "firmware", status: "skip" },
      { id: "kicad", status: "fail", blocks: false, errors: ["KiCad: a short"] },
    ] },
    "system.json": { gates: [
      { id: "overlap", status: "fail", detail: "a; and 1 more", list: ["top and ins1 share 3.2 mm3", "bot and cable share 1.04 mm3"] },
      { id: "clearance", status: "fail", detail: "x is 0.1 mm from y; z is 0.1 mm from w" },
      { id: "inside", status: "pass", detail: "all inside" },
    ] },
    "score.json": {
      coverage: { missing: ["cable"] }, cost: { unpriced: ["ctrl"], withinBand: false, deltaPct: -31.2 },
      files: [{ name: "fab/top.stl", ok: true, detail: "one body" }, { name: "fab/bottom.stl", ok: false, detail: "exported from an earlier design (design.json changed since): run sprue cad" },
        { name: "pcb/x-gerbers.zip", ok: false, detail: "no pcb/readback.json, so nothing but our own code has read the files: run sprue verify" },
        { name: "pcb/y-gerbers.zip", ok: false, detail: "the board's firmware has not been run on that copper yet: run sprue verify" }],
    },
  });
  const got = collect(dir, [
    { step: "cad", code: 1, out: "", err: `Traceback (most recent call last):\n  File "top.py", line 3\nValueError: the lid's boss is outside the plate\n✗ cad: Command failed: python3 ${dirname(dirname(dir))}/products/x/cad\n` },
    { step: "validate", code: 1, out: "  ✗ bom.json: sw has no role\n  · pending\n", err: "" },
    { step: "all", code: 0, out: "  ✗ printed by all, not a problem list\n", err: "" },
  ]);
  const texts = got.problems.map((p) => `${p.gate} | ${p.text}`);
  assert.deepEqual(texts, [
    "cad:crash | ValueError: the lid's boss is outside the plate",
    "cad:crash | Command failed: python3 products/x/cad",
    "validate | bom.json: sw has no role",
    "checks | mx-plate: Cutout 13.5 mm (14.0)",
    "pcb | track GND #5 on B.Cu is 0.20 mm wide, the minimum is 0.25 mm",
    "readback | OPEN: GP10 is in 2 pieces",
    "system:overlap | top and ins1 share 3.2 mm3",
    "system:overlap | bot and cable share 1.04 mm3",
    "system:clearance | x is 0.1 mm from y",
    "system:clearance | z is 0.1 mm from w",
    "score | the BOM has no cable (a role of the reference's)",
    "score | ctrl has no price, so the total counts it as $0",
    "score | the cost is -31.2% from the reference's, outside its 25% band",
  ]);
  assert.deepEqual(got.stale, ["score: fab/bottom.stl: exported from an earlier design (design.json changed since): run sprue cad",
    "score: pcb/x-gerbers.zip: no pcb/readback.json, so nothing but our own code has read the files: run sprue verify",
    "score: pcb/y-gerbers.zip: the board's firmware has not been run on that copper yet: run sprue verify"]);
  assert.equal(got.kicad, "caught");
  assert.equal(collect(folder({}), []).kicad, "not run");
  // A whole-product check that could not run leaves no system.json: the score's word for it is kept, as stale.
  const system = (detail: string, files: Record<string, unknown> = {}) => collect(folder({ ...files,
    "score.json": { coverage: { missing: [] }, cost: { unpriced: [], withinBand: true, deltaPct: 0 }, files: [], system: { ok: false, detail, failed: [] } } }), []);
  assert.deepEqual(system("no system.json: run sprue system").stale, ["score: no system.json: run sprue system"]);
  const missed = system("its self-test missed overlap (a part moved into its neighbour), so its pass proves nothing: see system.json", { "system.json": { gates: [{ id: "overlap", status: "pass", detail: "none" }] } });
  assert.deepEqual(missed.problems.map((p) => p.gate), ["score"]);
  const old = system("system.json is of an earlier design (bom.json changed): run sprue system", { "system.json": { gates: [{ id: "overlap", status: "fail", detail: "a and b share 1 mm3" }] } });
  assert.deepEqual([old.problems, old.stale], [[], ["score: system.json is of an earlier design (bom.json changed): run sprue system"]], "an earlier design's gates are not this copy's problems");
});

test("a fault is caught only by a new problem that names what it broke", () => {
  const clean: Problem[] = [{ gate: "system:overlap", text: "bot and cable share 1.04 mm3" }];
  const fault = { id: "boss-off", area: "mechanical" as const, fault: "a boss 1 mm off", edit: [], expect: ["ins1", "boss"] };
  const run = (problems: Problem[]) => judge(fault, clean, { problems, stale: [], kicad: "not run" });
  // The clean copy's problem with its numbers moved is not new, and a new one that names something else catches nothing.
  const missed = run([{ gate: "system:overlap", text: "bot and cable share 1.31 mm3" }, { gate: "checks", text: "lid-headroom: 0.2 mm" }]);
  assert.equal(missed.caught, false);
  assert.deepEqual(missed.new.map((p) => p.text), ["lid-headroom: 0.2 mm"]);
  assert.equal(missed.kicad, undefined, "KiCad is said only for a board fault");
  const caught = run([{ gate: "system:overlap", text: "top and ins1 share 3.2 mm3" }, { gate: "system:contact", text: "ins1 does not touch top" }]);
  assert.equal(caught.caught, true);
  assert.deepEqual(caught.by, ["system:overlap", "system:contact"]);
  assert.equal(caught.got, "system:overlap: top and ins1 share 3.2 mm3");
  // A clean copy that already has the problem: the fault cannot be caught by it.
  assert.equal(judge(fault, [{ gate: "x", text: "top and ins1 share 9 mm3" }], { problems: [{ gate: "x", text: "top and ins1 share 3.2 mm3" }], stale: [], kicad: "not run" }).caught, false);
  assert.equal(judge({ ...fault, area: "pcb" }, clean, { problems: [], stale: [], kicad: "missed" }).kicad, "missed");
  // A crash that names the part, the score's volume note on it and the file a score line starts with catch nothing.
  const lid = { ...fault, expect: ["boss", "top", "pcb"] };
  const none = judge(lid, clean, { problems: [
    { gate: "cad:crash", text: "TypeError: Cannot read properties of undefined (reading 'boss')" },
    { gate: "score", text: "fab/top.stl: the mesh holds 7.74 cm3 but bom.json prices 11.05 cm3 (spec.volumeCm3): copy the volume into top's spec.volumeCm3" },
    { gate: "score", text: "pcb/x-gerbers.zip: our DRC found 1 error: silkscreen line at (1, 2) is 0.1 mm wide" },
  ], stale: [], kicad: "not run" });
  assert.deepEqual([none.caught, none.broke, none.new.length], [false, "cad:crash: TypeError: Cannot read properties of undefined (reading 'boss')", 3]);
});

test("the clean copy's problems are false alarms unless the list knows them, numbers aside", () => {
  const known: FaultList["known"] = [{ problem: "bot and cable share 1.04 mm3", why: "real" }, { problem: "gone 1 mm", why: "fixed since" }];
  const r = falseAlarms([{ gate: "system:overlap", text: "bot and cable share 1.2 mm3" }, { gate: "checks", text: "key-count: 9 keys" }], known);
  assert.deepEqual(r.falseAlarms, [{ gate: "checks", text: "key-count: 9 keys" }]);
  assert.deepEqual(r.known.map((k) => k.seen), [true, false]);
});

test("the score reads faults.json only while it is of the product and the gates there are now", () => {
  assert.equal(faultsAudit(folder({ "design.json": "{}" })), undefined, "no fault list, no faults line");
  const dir = folder({ "design.json": "{}", "reference/faults.json": "{}" });
  assert.match(faultsAudit(dir)!.detail, /^no faults.json: run sprue faults$/);
  const report = (over: Partial<FaultsReport>) => {
    const r = { slug: "x", ok: false, generatedAt: "", ran: 2, caught: 1, pct: 50, missed: ["b"], falseAlarms: 0,
      control: { problems: [], stale: [], falseAlarms: [], known: [] }, cases: [], inputs: faultsInputs(dir), seconds: 1, ...over } as FaultsReport;
    writeFileSync(join(dir, "faults.json"), JSON.stringify(r));
  };
  report({});
  assert.deepEqual(faultsAudit(dir), { ok: false, detail: "1 of 2 seeded faults caught (50%), missed b, 0 false alarms on the clean design", ran: 2, caught: 1, pct: 50, missed: ["b"], falseAlarms: 0 });
  report({ ok: true, caught: 2, pct: 100, missed: [] });
  assert.equal(faultsAudit(dir)!.ok, true);
  report({ ok: true, caught: 2, pct: 100, missed: [], inputs: { ...faultsInputs(dir), "sprue:gates": "0" } });
  assert.match(faultsAudit(dir)!.detail, /^faults.json was measured on earlier code of Sprue's gates \(it caught 2 of 2 then\): run sprue faults$/);
  assert.equal(faultsAudit(dir)!.ok, false);
  report({ ok: true, caught: 2, pct: 100, missed: [] });
  writeFileSync(join(dir, "design.json"), '{"params":{}}');
  assert.match(faultsAudit(dir)!.detail, /^faults.json is of an earlier design \(design.json changed; it caught 2 of 2 then\)/);
  writeFileSync(join(dir, "faults.json"), "{");
  assert.match(faultsAudit(dir)!.detail, /^faults.json is not readable/);
});

test("sprue faults runs every step on each copy: an unpriced line is caught, a param nothing reads is missed", async () => {
  const root = join(tmp, "run"), dir = join(root, "products", "kit");
  const offer = (sku: string, usd: number) => [{ supplier: "Shop", sku, url: `https://example.com/${sku}`, priceBreaks: [{ qty: 1, unitUsd: usd }], stock: "in stock", leadDays: 3, source: "snapshot", capturedAt: "2026-10-18" }];
  const files: Record<string, unknown> = {
    "request.json": { slug: "kit", brief: "a desk lamp kit", product: "Desk lamp kit", units: 1, region: "US", mustHave: ["gives light"], niceToHave: [], constraints: {} },
    "design.json": { summary: "A bulb and a cord, bought.", params: { shadeMm: 120 }, assembly: ["Screw the bulb into the cord's socket."] },
    "bom.json": { slug: "kit", units: 1, lines: [
      { id: "bulb", name: "LED bulb", role: "light", process: "buy", qtyPerUnit: 1, spec: {} },
      { id: "cord", name: "Socket cord", role: "cable", process: "buy", qtyPerUnit: 1, spec: {} }] },
    "catalog.json": { shipping: { Shop: 5 }, offers: { bulb: offer("B1", 4), cord: offer("C1", 6) } },
    "reference/reference.json": { slug: "kit", source: "https://example.com/kit", units: 1, roles: [{ role: "light", spec: "a bulb", qtyPerUnit: 1 }, { role: "cable", spec: "a cord", qtyPerUnit: 1 }],
      batchUsd: { low: 10, high: 20, basis: "a guess for the test" } },
    "reference/faults.json": { slug: "kit", faults: [
      { id: "unpriced", area: "bom", fault: "the bulb has no offer", edit: [{ file: "catalog.json", delete: ["offers.bulb"] }], expect: ["bulb"] },
      { id: "shade", area: "mechanical", fault: "the shade is four times as wide", edit: [{ file: "design.json", set: { "params.shadeMm": 500 } }], expect: ["shade", "shadeMm"] },
      { id: "typo", area: "bom", fault: "an edit that does not apply", edit: [{ file: "bom.json", set: { "lines[id=lamp].qtyPerUnit": 2 } }], expect: ["lamp"] }] },
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), JSON.stringify(body, null, 2));
  }
  const cwd = process.cwd(), log = console.log;
  const said: string[] = [];
  process.chdir(root);
  console.log = (...a: unknown[]) => said.push(a.join(" "));
  let ok: boolean;
  try {
    ok = await faults("kit", { jobs: 2 });
  } finally {
    console.log = log;
    process.chdir(cwd);
  }
  assert.equal(ok, false);
  const r = json(dir, "faults.json") as FaultsReport;
  assert.deepEqual([r.ran, r.caught, r.pct, r.missed, r.falseAlarms], [2, 1, 50, ["shade", "typo"], 0]);
  assert.deepEqual(r.control.problems, [], "the clean kit has no problem: cad and verify do not run on a product with no cad/");
  const [unpriced, shade, typo] = r.cases;
  assert.deepEqual([unpriced.caught, unpriced.by, unpriced.got], [true, ["score"], "score: bulb has no price, so the total counts it as $0"]);
  assert.deepEqual([shade.ran, shade.caught, shade.new], [true, false, []]);
  assert.equal(typo.ran, false);
  assert.match(typo.error!, /^the fault could not be put in: lines\[id=lamp\]\.qtyPerUnit: lines has none with id lamp$/);
  assert.match(said.at(-1)!, /^seeded faults: 1 of 2 caught \(50%\), 1 not put in, 0 false alarms on the clean design, [\d.]+ s; wrote products\/kit\/faults.json$/);
  assert.deepEqual(productFiles(dir), [...Object.keys(files)].sort(), "the product itself is untouched but for faults.json");
  assert.ok(existsSync(join(dir, "faults.json")) && !existsSync(join(dir, "score.json")));
  assert.equal(faultsAudit(dir)!.ok, false);
  assert.match(faultsAudit(dir)!.detail, /^1 of 2 seeded faults caught \(50%\), missed shade, typo, 0 false alarms on the clean design; 1 could not be put in$/);
});
