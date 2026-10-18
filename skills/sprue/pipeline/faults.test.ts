// Tests of the seeded faults (`sprue faults`): a fault's edits go in exactly as written or not at all, a problem the
// clean copy also has (its numbers and the copy's folder aside) catches nothing, a problem must name what the fault broke, the clean copy's
// problems are false alarms unless the list knows them, and the score reads faults.json only while it is of the
// product and the gates there are now. The last test runs the real steps on a small product of bought parts. Run with
//   node --test skills/sprue/pipeline/faults.test.ts

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { applyEdits, collect, copyProduct, falseAlarms, faults, judge, names, readFaultList, shape } from "./faults.ts";
import { errorText, linkInProduct, outsideProduct } from "./io.ts";
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
const BIN = join(import.meta.dirname, "..", "bin", "sprue");

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
  // A file the product may not have is skipped when optional, but a fault whose every edit was skipped put nothing in;
  // a replace sees the file as written, before a set rewrites it.
  applyEdits(dir, [{ file: "offers.digikey.json", delete: ["offers.ctrl"], optional: true }, { file: "catalog.json", delete: ["offers.sw"] }]);
  assert.deepEqual(json(dir, "catalog.json").offers, {});
  fails({ file: "offers.digikey.json", delete: ["offers.ctrl"], optional: true }, /offers.digikey.json: not in the product, and every edit is optional, so nothing was put in/);
  applyEdits(dir, []);
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

test("a copy's links lead into the copy, however the product's are written", () => {
  const real = folder({ "design.json": '{ "a": 1 }', "cad/top.py": "" });
  // The product as products/<slug> reaches it, through a link; an absolute link through that one to what a run has not
  // made yet, and a relative one that leaves the product and comes back in by its real folder's name.
  const named = join(tmp, `named${n++}`);
  symlinkSync(real, named);
  symlinkSync(join(named, "pcb"), join(real, "board"));
  symlinkSync(join("..", "..", basename(real), "design.json"), join(real, "cad", "params.json"));
  assert.deepEqual(productLinks(named), ["board", "cad/params.json"]);
  assert.deepEqual([linkInProduct(named, "board"), linkInProduct(named, "cad/params.json")], ["pcb", "design.json"]);
  // The repo's own layout: products/<slug> a relative link from a folder of its own, by another name, so the link's
  // text leads somewhere else when read from where the product is named.
  const repo = join(tmp, `repo${n++}`), there = join(repo, "a", "real"), here = join(repo, "products", "named");
  mkdirSync(join(there, "cad"), { recursive: true });
  mkdirSync(dirname(here));
  writeFileSync(join(there, "design.json"), "{}");
  symlinkSync(join("..", "a", "real"), here);
  symlinkSync(join("..", "..", "real", "design.json"), join(there, "cad", "params.json"));
  assert.deepEqual([linkInProduct(here, "cad/params.json"), productLinks(here)], ["design.json", ["cad/params.json"]]);
  const to = join(tmp, `copy${n++}`);
  copyProduct(named, to);
  assert.deepEqual([readlinkSync(join(to, "board")), readlinkSync(join(to, "cad", "params.json"))], ["pcb", "../design.json"]);
  applyEdits(to, [{ file: "cad/params.json", set: { a: 2 } }]);
  assert.deepEqual([json(to, "design.json").a, json(real, "design.json").a], [2, 1], "the copy's edit lands in the copy, not in the product");
});

test("a link to a folder the product is in is not walked, nor one a loop out of it leads back to, but each name for a folder is", () => {
  // products/p in a repo of its own, beside another product and below a file at the repo's top, which a walk up
  // through up/ or repo/ would count as this one's.
  const base = join(tmp, `deep${n++}`), dir = join(base, "products", "p"), out = join(base, "outside");
  for (const [f, body] of Object.entries({ "products/p/design.json": "{}", "products/p/cad/top.py": "", "products/other/bom.json": "{}",
    "PLAN.md": "x", "outside/notes.md": "x", "outside/lib/k.py": "" })) {
    mkdirSync(dirname(join(base, f)), { recursive: true });
    writeFileSync(join(base, f), body);
  }
  symlinkSync("..", join(dir, "up"));
  symlinkSync(dirname(dir), join(dir, "parent"));
  symlinkSync(join("..", ".."), join(dir, "repo"));
  symlinkSync(out, join(dir, "ext"));
  symlinkSync(".", join(out, "self"));
  // Two more names for a folder out of the product, one a link within it through ext/: the product reaches its files
  // by each, so each is walked.
  symlinkSync(join("..", "..", "..", "outside", "lib"), join(dir, "cad", "lib"));
  symlinkSync(join("ext", "lib"), join(dir, "lib"));
  assert.deepEqual([linkInProduct(dir, "up"), linkInProduct(dir, "parent"), linkInProduct(dir, "repo")], ["..", "..", "../.."]);
  assert.ok(outsideProduct(".."), "a link to the folder above leaves the product");
  const files = ["cad/lib/k.py", "cad/top.py", "design.json", "ext/lib/k.py", "ext/notes.md", "lib/k.py"];
  assert.deepEqual([productFiles(dir), productLinks(dir)], [files, []]);
  assert.deepEqual(Object.keys(faultsInputs(dir)).sort(), [...files, "sprue:gates"]);
  const to = join(tmp, `copy${n++}`);
  copyProduct(dir, to);
  assert.deepEqual(productFiles(to), files);
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

test("a crash is one wherever it is read, and a print cad did not build is a problem", () => {
  const broke = folder({
    "pcb/drc.json": { errors: ["TypeError: p.hole is not a function"] },
    "pcb/verify.json": { layers: [{ id: "readback", status: "fail", errors: ["the read-back stopped with an error, so it proves nothing: ValueError: no outline",
      "the read-back cannot read through the files (KeyError: 'G04'), so it stopped there: they hold something our writer never writes"] }] },
    "system.json": { gates: [{ id: "function", status: "fail", detail: "Can't run: 'cable'", list: ["Can't run: 'cable'"] }] },
    "score.json": { coverage: { missing: [] }, cost: { unpriced: [], withinBand: true, deltaPct: 0 }, files: [
      { name: "pcb/x-gerbers.zip", ok: false, detail: "our DRC found 1 error: TypeError: p.hole is not a function" },
      { name: "pcb/x-order.zip", ok: false, detail: "ENOENT: no such file or directory, open 'pcb/x-order.zip'" }] },
  });
  const got = collect(broke, [
    { step: "cad", code: 1, out: "  ✗ top: fab/top.stl not built\n", err: "✗ pcb: TypeError: p.hole is not a function\n" },
    { step: "verify", code: 1, out: "", err: "✗ verify: ENOENT: no such file or directory, rename 'pcb/firmware.uf2' -> 'x'\n" },
    { step: "all", code: 1, out: "", err: "✗ figure: Cannot access 'track' before initialization\n✗ all: Unexpected identifier 'hole'\n" +
      "✗ all: Cannot use 'in' operator to search for 'hole' in null\n✗ all: Reduce of empty array with no initial value\n" +
      "✗ all: Cannot convert undefined or null to object\n✗ all: Invalid array length\n✗ all: Converting circular structure to JSON\n" },
  ]);
  assert.deepEqual(got.problems.map((p) => p.gate), ["cad:crash", "cad", "verify:crash", ...Array(7).fill("all:crash"), "pcb:crash",
    "readback:crash", "readback:crash", "system:function:crash", "score:crash", "score:crash"]);
  const f = { id: "f", area: "pcb" as const, fault: "x", edit: [], expect: ["hole", "track", "cable", "firmware", "outline", "G04", "order"] };
  assert.deepEqual([judge(f, [], got).caught, judge(f, [], got).broke], [false, "cad:crash: TypeError: p.hole is not a function"]);
  // A print the BOM names that cad did not build is the design's, though a step of cad broke after it.
  assert.equal(judge({ ...f, expect: ["top"] }, [], got).caught, true);
  // The board and figure code print an engine's exception with its class, which is how CRASH knows it; the kit's own
  // refusal is a plain Error, printed as it is worded.
  assert.deepEqual([errorText(new TypeError("p.hole is not a function")), errorText(new Error("hole x must be a number, got null")), errorText("x")],
    ["TypeError: p.hole is not a function", "hole x must be a number, got null", "x"]);
  // The board kit refusing a design in its own words is a check, and so is a print the BOM names that nothing builds.
  const refused = collect(folder({ "pcb/drc.json": { errors: ["hole x must be a number, got null"] } }), [
    { step: "cad", code: 1, out: "built top: 7.74 cm3\n  ✗ top: fab/lid.stl not built\n", err: "✗ pcb: hole x must be a number, got null\n" },
  ]);
  assert.deepEqual(refused.problems, [{ gate: "cad", text: "hole x must be a number, got null" }, { gate: "cad", text: "top: fab/lid.stl not built" },
    { gate: "pcb", text: "hole x must be a number, got null" }]);
  assert.equal(judge({ ...f, expect: ["lid"] }, [], refused).caught, true);
  // As sprue pcb says it and leaves it in drc.json: an engine's exception with its class, the kit's refusal as worded.
  const root = join(tmp, `board${n++}`), board = join(root, "products", "b");
  mkdirSync(join(board, "cad"), { recursive: true });
  for (const [code, said] of [["const p = null;\nexport default p.hole;\n", "TypeError: Cannot read properties of null (reading 'hole')"],
    ['throw new Error("hole x must be a number, got null");\n', "hole x must be a number, got null"]]) {
    writeFileSync(join(board, "cad", "pcb.mjs"), code);
    const r = spawnSync(BIN, ["pcb", "b"], { cwd: root, encoding: "utf8" });
    assert.deepEqual([r.status, r.stderr.split("\n")[0], json(board, "pcb/drc.json").errors], [1, `✗ pcb: ${said}`, [said]]);
  }
  // And any command, stopped by an engine's exception, says it with its class.
  writeFileSync(join(board, "bom.json"), JSON.stringify({ slug: "b", units: 1, lines: 5 }));
  assert.match(spawnSync(BIN, ["validate", "b"], { cwd: root, encoding: "utf8" }).stderr.split("\n")[0], /^✗ validate: TypeError: /);
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
  const cwd = process.cwd(), log = console.log, temp = process.env.TMPDIR, copies = join(root, "tmp");
  const said: string[] = [];
  mkdirSync(copies);
  process.chdir(root);
  console.log = (...a: unknown[]) => said.push(a.join(" "));
  process.env.TMPDIR = copies;
  let ok: boolean;
  try {
    ok = await faults("kit", { jobs: 2 });
  } finally {
    console.log = log;
    process.chdir(cwd);
    if (temp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = temp;
  }
  assert.equal(ok, false);
  assert.deepEqual(readdirSync(copies), [], "the copies are removed at the end");
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

test("a signal, at any point, twice, or the output's reader going stops every step sprue faults started and removes the copies", async () => {
  const root = join(tmp, "signal"), marks = join(root, "marks"), temp = join(root, "tmp");
  mkdirSync(marks, { recursive: true });
  mkdirSync(temp);
  const product = (slug: string, files: Record<string, string>) => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, "products", slug, f)), { recursive: true });
      writeFileSync(join(root, "products", slug, f), body);
    }
  };
  // Many files, so that removing the copies takes a while.
  const many = (slug: string) => {
    for (let i = 0; i < 5_000; i++) {
      if (i % 1000 === 0) mkdirSync(join(root, "products", slug, "data", `d${i / 1000}`), { recursive: true });
      writeFileSync(join(root, "products", slug, "data", `d${Math.floor(i / 1000)}`, `f${i}.txt`), "x");
    }
  };
  const fault = (id: string, x: number) => ({ id, area: "mechanical", fault: `x is ${x}`, edit: [{ file: "design.json", set: { "params.x": x } }], expect: ["x"] });
  // A part whose build never ends on the clean design (x 1), and that says when it began; on the faults' (x 2, x 3)
  // it stops at once, so their copies' steps run to their end.
  product("slow", {
    "design.json": JSON.stringify({ params: { x: 1 } }),
    "bom.json": JSON.stringify({ slug: "slow", units: 1, lines: [{ id: "slow", name: "Slow part", role: "case", process: "print", qtyPerUnit: 1, file: "fab/slow.stl", spec: {} }] }),
    "cad/slow.py": "import json, os, time\nhere = os.path.dirname(os.path.abspath(__file__))\n" +
      "if json.load(open(os.path.join(here, '..', 'design.json')))['params']['x'] == 1:\n" +
      "    open(os.path.join(os.environ['SPRUE_TEST_MARKS'], str(os.getpid())), 'w').close()\n    time.sleep(120)\n",
    "reference/faults.json": JSON.stringify({ slug: "slow", faults: [fault("x", 2), fault("y", 3)] }),
  });
  const wait = async (what: string, done: () => boolean, ms = 60_000, every = 100) => {
    for (const t0 = Date.now(); !done(); await new Promise((r) => setTimeout(r, every))) if (Date.now() - t0 > ms) assert.fail(`waited ${ms / 1000} s for ${what}`);
  };
  // Gone, or a zombie no one has reaped yet: either way it runs no more.
  const stat = (pid: number) => { try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" "); } catch { return undefined; } };
  const gone = (pid: number) => (stat(pid)?.[0] ?? "Z") === "Z";
  const builds = () => readdirSync(marks).map(Number);
  // Each run leads a process group of its own, so a test that fails can stop all of it, and its builds by theirs.
  const runs: ChildProcess[] = [];
  const start = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, { cwd: root, env: { ...process.env, TMPDIR: temp, SPRUE_TEST_MARKS: marks }, stdio: "ignore", detached: true });
    runs.push(child);
    return { child, closed: new Promise<number | null>((r) => child.on("close", (c) => r(c))) };
  };
  const sprue = (slug: string) => start(BIN, ["faults", slug, "--jobs", "1"]);
  const after = async (how: string) => {
    for (const pid of builds()) await wait(`the build (pid ${pid}) to stop`, () => gone(pid), 5_000);
    assert.deepEqual(readdirSync(temp), [], `${how}: the copies are removed`);
    for (const m of readdirSync(marks)) rmSync(join(marks, m));
  };
  try {
    // A closed terminal (SIGHUP) as well as Ctrl-C: the steps are in groups of their own, which neither reaches.
    for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130]] as const) {
      const { child, closed } = sprue("slow");
      await wait("the slow part's build to begin", () => builds().length > 0);
      child.kill(signal);
      assert.equal(await closed, code, `${signal} exits as killed by it`);
      await after(signal);
    }
    // The output's reader goes (sprue faults | head -c 1): a line after it, when the faults' copies have run (Node lets
    // the first EPIPE pass, not the next), fails uncaught while the clean copy's build runs on; the exit stops it and
    // removes the copies all the same.
    {
      const { closed } = start("bash", ["-c", '"$0" faults slow --jobs 3 | head -c 1 >/dev/null; exit "${PIPESTATUS[0]}"', BIN]);
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise((r) => (timer = setTimeout(() => r("still running"), 60_000)));
      try {
        assert.equal(await Promise.race([closed, late]), 1, "EPIPE ends the run");
      } finally {
        clearTimeout(timer);
      }
      assert.equal(builds().length, 1, "the clean copy's build was running");
      await after("EPIPE");
    }
    // Ctrl-C twice: the second comes while the copies are being removed, and waits for them rather than killing the
    // run halfway.
    many("slow");
    {
      const { child, closed } = sprue("slow");
      await wait("the slow part's build to begin", () => builds().length > 0);
      child.kill("SIGINT");
      // The build stops just before the copies' removal begins.
      await wait("the build to stop", () => builds().every(gone), 5_000, 1);
      child.kill("SIGINT");
      assert.equal(await closed, 130, "a second Ctrl-C does not kill the run while it removes the copies");
      await after("SIGINT twice");
    }
    // Ctrl-C when every step has run, as faults.json is written and the copies removed: it is not lost, and the run
    // exits as killed by it rather than as if it had ended.
    product("done", { "design.json": JSON.stringify({ params: { x: 1 } }), "reference/faults.json": JSON.stringify({ slug: "done", faults: [fault("x", 2)] }) });
    many("done");
    {
      const { child, closed } = sprue("done");
      await wait("faults.json", () => existsSync(join(root, "products", "done", "faults.json")), 120_000, 1);
      child.kill("SIGINT");
      assert.equal(await closed, 130, "a Ctrl-C at the end is not dropped");
      await after("SIGINT at the end");
    }
  } finally {
    for (const r of runs) if (r.exitCode === null && r.signalCode === null) try { process.kill(-r.pid!, "SIGKILL"); } catch { /* gone */ }
    for (const pid of builds()) if (!gone(pid)) try { process.kill(-Number(stat(pid)![2]), "SIGKILL"); } catch { /* gone */ }
  }
});
