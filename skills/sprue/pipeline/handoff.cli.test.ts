// `sprue handoff` through the command line, on a product "lid" in a temporary folder with no Python: it writes
// fab/order/ whole, refuses (and takes away an earlier folder) on each planted fault, says when there is nothing to
// hand off, and `sprue status`, `score`, `package` and `all` remove a folder once it is out of date, and keep it
// otherwise, while `sprue cad` always does.
//   node --test skills/sprue/pipeline/handoff.cli.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { packageProblem } from "./gates.ts";
import { handoffStaleness } from "./handoff.ts";
import { exportRecord, systemInputs } from "./stages/score.ts";
import type { Bom, BomLine, SystemCheck } from "./types.ts";

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
const STEP = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=SI_UNIT(.MILLI.,.METRE.);\nENDSEC;\nEND-ISO-10303-21;\n";
type Gate = SystemCheck["gates"][number];
const systemJson = (dir: string, gates: Gate[] = []): SystemCheck => ({
  slug: "lid", ok: gates.every((g) => g.status === "pass"), generatedAt: "2026-11-07T00:00:00.000Z", parts: 1, envelopes: 0,
  gates: [{ id: "overlap", title: "No two parts are in the same place", status: "pass", detail: "1 part", problems: 0 }, ...gates],
  stability: [], probes: [], selfTest: { ok: true, faults: [{ gate: "overlap", fault: "two parts in one place", caught: true, detail: "caught" }], untested: [] },
  inputs: systemInputs(dir), seconds: 1,
});
const clearance: Gate = { id: "clearance", title: "Every other pair is at least 0.2 mm apart", status: "fail", problems: 1,
  detail: "lid is 0.1 mm from cap", list: ["lid is 0.1 mm from cap"] };
/** An STL with its last two triangles dropped: a hole in the surface. */
const holed = (stl: Buffer) => {
  const n = stl.readUInt32LE(80) - 2, out = Buffer.from(stl.subarray(0, 84 + n * 50));
  out.writeUInt32LE(n, 80);
  return out;
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** fab/build.json as sprue cad writes it: what the parts were built from, and the sha256 of each file it wrote. */
const exported = (dir: string) => {
  const outputs: Record<string, string> = {};
  for (const d of ["fab", "previews"]) for (const f of readdirSync(join(dir, d)))
    if (/\.(stl|step|svg)$/.test(f) && statSync(join(dir, d, f)).isFile()) outputs[`${d}/${f}`] = sha(readFileSync(join(dir, d, f)));
  return { ...exportRecord(dir), outputs };
};

const LID: BomLine = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 1, material: "PETG" }, file: "fab/lid.stl" };
const BRACKET: BomLine = { id: "bracket", name: "Bracket", role: "bracket", process: "cnc", qtyPerUnit: 2, spares: 1,
  spec: { material: "aluminium 6061-T6", features: "two M4 tapped holes" }, file: "fab/bracket.step" };
const PLATE: BomLine = { id: "plate", name: "Plate", role: "plate", process: "sheet", qtyPerUnit: 1, spec: { material: "aluminium 5052", thicknessMm: 1.5 }, file: "fab/plate.step" };

/** Product "lid": a 10 mm printed cube (fab/lid.stl and .step, cad/lid.py, previews/lid.svg), with `cnc` a machined
 * bracket and with `sheet` a sheet-metal plate (each a box STL and a STEP, no preview); exports and a whole-product
 * check current, rules lid-ok (a part's, on param ok) and lid-fits (the parts together, on fit), and a quote written
 * by `sprue quote` (which leaves a CNC or sheet part unpriced). */
function product(t: { after: (f: () => void) => void }, { cnc = true, sheet = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-handoff-cli-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, "products", "lid");
  for (const d of ["cad", "fab", "previews"]) mkdirSync(join(dir, d), { recursive: true });
  const put = (file: string, v: unknown) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2));
  };
  const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  put("request.json", { slug: "lid", brief: "a lid", product: "lid", units: 1, region: "US", mustHave: ["a lid"], niceToHave: [], constraints: {} });
  put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok: 1, fit: 1 }, assembly: ["Put the lid on"] });
  put("bom.json", { slug: "lid", units: 1, lines: [LID, ...(cnc ? [BRACKET] : []), ...(sheet ? [PLATE] : [])] });
  put("catalog.json", { shipping: {}, offers: {} });
  put("state.json", { stage: "source", stages: { design: { status: "accepted", at: "2026-11-07T00:00:00.000Z" }, inspect: { status: "accepted", at: "2026-11-07T00:00:00.000Z" }, source: { status: "proposed", at: "2026-11-07T00:00:00.000Z" } } });
  put("rules.ts", `export const rules = [{ id: "lid-ok", title: "Lid is fine", needs: ["ok"],
  run: (c) => ({ status: Number(c.p.ok) === 1 ? "pass" : "fail", detail: "ok is " + c.p.ok }) },
  { id: "lid-fits", title: "Lid fits the cap", needs: ["fit"], scope: "assembly",
  run: (c) => ({ status: Number(c.p.fit) === 1 ? "pass" : "fail", detail: "fit is " + c.p.fit }) }];\n`);
  put("cad/_system.py", "# the whole product\n");
  const part = (stem: string, size: V) => {
    put(`cad/${stem}.py`, `# the ${stem}\n`);
    put(`fab/${stem}.stl`, box([0, 0, 0], size));
    put(`fab/${stem}.step`, STEP);
  };
  part("lid", [10, 10, 10]);
  put("previews/lid.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>\n`);
  if (cnc) part("bracket", [42, 30, 12]);
  if (sheet) part("plate", [60, 40, 1.5]);
  const run = (...args: string[]) => spawnSync(SPRUE, args, { cwd: tmp, encoding: "utf8" });
  /** Exports and the whole-product check as `sprue cad` and `sprue system` would leave them, then the quote. */
  const current = (gates: Gate[] = []) => {
    put("fab/build.json", exported(dir));
    put("system.json", systemJson(dir, gates));
    run("quote", "lid");
  };
  current();
  const order = join(dir, "fab", "order");
  const tree = () => readdirSync(order, { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(order, f)).isFile()).sort();
  const handoff = () => run("handoff", "lid");
  const bom = (): Bom => read("bom.json");
  return { tmp, dir, put, read, run, current, order, tree, handoff, bom };
}

test("sprue handoff writes fab/order/ whole: the one file to upload, byte for byte, each ORDER.md and the record", (t) => {
  const p = product(t);
  const r = p.handoff();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(p.tree(), ["README.md", "bracket/ORDER.md", "bracket/lid-bracket.step", "lid.svg", "lid/ORDER.md", "lid/lid-lid.stl", "order.json"]);
  for (const [copy, src] of [["lid/lid-lid.stl", "fab/lid.stl"], ["bracket/lid-bracket.step", "fab/bracket.step"], ["lid.svg", "previews/lid.svg"]]) {
    const bytes = readFileSync(join(p.order, copy));
    assert.ok(bytes.equals(readFileSync(join(p.dir, src))), copy);
    if (!copy.endsWith(".svg")) assert.ok(readFileSync(join(p.order, copy.split("/")[0], "ORDER.md"), "utf8").includes(`sha256 ${sha(bytes)}`), copy);
  }
  const record = p.read("fab/order/order.json");
  assert.match(record.written, /^\d{4}-\d\d-\d\d$/);
  for (const f of p.tree().filter((x) => x !== "order.json")) assert.equal(record.files[f], sha(readFileSync(join(p.order, f))), f);
  assert.equal(Object.keys(record.files).length, 6);
  assert.ok(!existsSync(join(p.dir, "fab", "order.part")));
  assert.match(r.stdout, /wrote products\/lid\/fab\/order\/: lid \(lid-lid\.stl, \$6\.00 at Craftcloud, an estimate\), bracket \(lid-bracket\.step, not priced\)\. Start with fab\/order\/README\.md\. Nothing was uploaded, quoted or ordered/);
  assert.match(r.stdout, / {2}· bracket: not priced: its ORDER\.md lists the shops to ask/);
  // Written again, it is the same folder.
  assert.equal(p.handoff().status, 0);
  assert.equal(handoffStaleness(p.dir), undefined);
});

test("sprue handoff refuses on each planted fault, writes nothing and takes away the folder of an earlier run", async (t) => {
  type Fault = [string, (p: ReturnType<typeof product>) => void, RegExp, { sheet?: boolean }?];
  const withBom = (p: ReturnType<typeof product>, f: (b: Bom) => void) => { const b = p.bom(); f(b); p.put("bom.json", b); };
  const faults: Fault[] = [
    ["a part check fails", (p) => p.put("design.json", { ...p.read("design.json"), params: { ok: 0, fit: 1 } }), /✗ check lid-ok fails: ok is 0/],
    ["an assembly check fails", (p) => p.put("design.json", { ...p.read("design.json"), params: { ok: 1, fit: 0 } }), /✗ check lid-fits fails: fit is 0/],
    ["the whole product fails", (p) => p.put("system.json", systemJson(p.dir, [clearance])), /✗ the whole-product check: .*clearance/],
    ["system.json is of an earlier design", (p) => p.put("cad/_system.py", "# the whole product, edited\n"), /✗ the whole-product check: system\.json is of an earlier design/],
    ["an export is stale", (p) => p.put("cad/lid.py", "# the lid, edited\n"), /✗ lid: fab\/lid\.stl: exported from an earlier design \(cad\/lid\.py/],
    ["the volume priced is not the mesh's", (p) => withBom(p, (b) => { b.lines[0].spec.volumeCm3 = 2; }), /✗ lid: fab\/lid\.stl: the mesh holds 1\.00 cm3 but bom\.json prices 2\.00 cm3/],
    ["the lid's mesh has a hole", (p) => { p.put("fab/lid.stl", holed(readFileSync(join(p.dir, "fab/lid.stl")))); p.put("fab/build.json", exported(p.dir)); }, /✗ lid: fab\/lid\.stl: the mesh is not one closed surface/],
    ["the STL beside the bracket's STEP has a hole", (p) => { p.put("fab/bracket.stl", holed(readFileSync(join(p.dir, "fab/bracket.stl")))); p.put("fab/build.json", exported(p.dir)); }, /✗ bracket: fab\/bracket\.stl: the mesh is not one closed surface/],
    ["the STEP edited after sprue cad wrote it", (p) => p.put("fab/bracket.step", `${STEP}/* edited in a CAD program */\n`), /✗ bracket: fab\/bracket\.step was changed since sprue cad wrote it: run sprue cad/],
    ["the preview replaced", (p) => p.put("previews/lid.svg", "<svg/>\n"), /✗ lid: previews\/lid\.svg was changed since sprue cad wrote it/],
    ["a STEP sprue cad never wrote", (p) => { const b = exported(p.dir); delete b.outputs["fab/bracket.step"]; p.put("fab/build.json", b); }, /✗ bracket: fab\/bracket\.step is not a file sprue cad wrote/],
    ["a build.json of an earlier Sprue, with no outputs", (p) => p.put("fab/build.json", exportRecord(p.dir)), /✗ lid: fab\/build\.json does not record the files sprue cad wrote/],
    ["fab/lid.stl is gone", (p) => rmSync(join(p.dir, "fab/lid.stl")), /✗ lid: fab\/lid\.stl is not made yet: run sprue cad/],
    ["fab/bracket.step is gone", (p) => rmSync(join(p.dir, "fab/bracket.step")), /✗ bracket: fab\/bracket\.step is not made yet: run sprue cad/],
    ["no quotes.json", (p) => rmSync(join(p.dir, "quotes.json")), /✗ no quotes\.json, so nothing is priced/],
    ["the catalog changed since the quote", (p) => p.put("catalog.json", { shipping: { Somewhere: 1 }, offers: {} }), /✗ quotes\.json was priced from an earlier catalog\.json/],
    ["a line id that leaves the folder", (p) => withBom(p, (b) => { b.lines[0].id = "../lid"; }), /✗ \.\.\/lid: a line id names a folder here/],
    ["two ids that differ only in case", (p) => withBom(p, (b) => { b.lines.push({ ...LID, id: "Lid", file: "fab/bracket.step", process: "cnc" }); }), /✗ lid and Lid: two line ids that differ only in case/],
    ["two lines of one file", (p) => withBom(p, (b) => { b.lines.push({ ...LID, id: "lid2" }); }), /✗ lid and lid2: both name fab\/lid, so one part would be ordered twice/],
    ["a file outside fab/", (p) => withBom(p, (b) => { b.lines[0].file = "parts/lid.stl"; }), /✗ lid: parts\/lid\.stl is not an export of cad\//],
    ["a file no cad/ part exports", (p) => { p.put("fab/foo.stl", readFileSync(join(p.dir, "fab/lid.stl"))); withBom(p, (b) => { b.lines[0].file = "fab/foo.stl"; }); }, /✗ lid: fab\/foo\.stl is not an export of cad\//],
    ["no material", (p) => withBom(p, (b) => { b.lines[1].spec.material = " "; }), /✗ bracket: spec\.material is empty/],
    ["a sheet part with no thickness", (p) => withBom(p, (b) => { delete b.lines.find((l) => l.id === "plate")!.spec.thicknessMm; }), /✗ plate: a sheet-metal part needs spec\.thicknessMm/, { sheet: true }],
    ["half a part to order", (p) => withBom(p, (b) => { b.lines[0].qtyPerUnit = 0.5; }), /✗ lid: 0\.5 to order is not a whole number of at least 1/],
    ["a print with no file", (p) => withBom(p, (b) => { b.lines.push({ ...LID, id: "knob", file: undefined }); }), /✗ knob \(print\) names no file, so there is nothing to send a shop/],
    ["a preview that is a folder", (p) => { rmSync(join(p.dir, "previews/lid.svg")); mkdirSync(join(p.dir, "previews/lid.svg")); }, /✗ lid: previews\/lid\.svg is a link or not a plain file/],
    ["the STEP to upload a link to a file outside the product", (p) => {
      withBom(p, (b) => { b.lines[1].file = "fab/bracket.stl"; });
      writeFileSync(join(p.tmp, "other.step"), `${STEP}/* another product's part */\n`);
      rmSync(join(p.dir, "fab/bracket.step")); symlinkSync(join(p.tmp, "other.step"), join(p.dir, "fab/bracket.step"));
    }, /✗ bracket: fab\/bracket\.step is a link or not a plain file, so it may not be this product's export/],
    ["a bom.json line Sprue can't read", (p) => withBom(p, (b) => { delete (b.lines[0] as Partial<BomLine>).spec; }), /✗ bom\.json: lid: spec must be an object/],
    ["order A of half a part", (p) => {
      p.put("design.json", { ...p.read("design.json"), params: { ok: 1, fit: 1, firstArticleUnits: 1 } });
      withBom(p, (b) => { b.units = 4; b.lines[1].qtyPerUnit = 0.5; });
      p.current();
    }, /✗ bracket: the quote's order A would be 0\.5 \(qtyPerUnit 0\.5 x firstArticleUnits 1\), not a whole number/],
  ];
  await Promise.all(faults.map(([name, plant, says, opts]) => t.test(name, (st) => {
    const p = product(st, { sheet: !!opts?.sheet });
    const good = p.handoff();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    plant(p);
    const r = p.handoff();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, says);
    assert.match(r.stderr, /removed products\/lid\/fab\/order\/, which was of an earlier run/);
    assert.ok(!existsSync(p.order) && !existsSync(`${p.order}.part`));
    assert.deepEqual(readdirSync(join(p.tmp, "products")), ["lid"], "nothing is written beside the product");
  })));
});

test("with no made part there is nothing to hand off, and a leftover folder goes", (t) => {
  const p = product(t, { cnc: false });
  p.put("bom.json", { slug: "lid", units: 1, lines: [{ ...LID, process: "buy", mpn: "LID-1" }] });
  p.put("fab/order/README.md", "old\n");
  const r = p.handoff();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /nothing to hand off: bom\.json has no printed, CNC or sheet-metal part \(the board's is pcb\/order\/, from sprue verify\)/);
  assert.ok(!existsSync(p.order));
});

test("with no catalog.json the refusal names sprue quote, which sprue all skips, and after it the hand-off is written", (t) => {
  const p = product(t);
  rmSync(join(p.dir, "catalog.json"));
  rmSync(join(p.dir, "quotes.json"));
  const r = p.handoff();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ no quotes\.json, so nothing is priced: run sprue quote lid \(sprue all skips the quote while there is no catalog\.json\)\n/);
  assert.doesNotMatch(r.stderr, /run sprue all/);
  // sprue quote writes the quote with the bracket unpriced (and so exits 1): the hand-off is how it gets a price.
  const q = p.run("quote", "lid");
  assert.match(q.stdout + q.stderr, /bracket/);
  assert.ok(existsSync(join(p.dir, "quotes.json")), q.stdout + q.stderr);
  const again = p.handoff();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.ok(existsSync(join(p.order, "lid", "ORDER.md")));
});

test("sprue status removes fab/order/ once it is out of date, and keeps it otherwise", async (t) => {
  const removed = (r: { stdout: string }, why: RegExp) => {
    assert.match(r.stdout, new RegExp(`removed products/lid/fab/order/: ${why.source}[^\\n]*\\. Run sprue handoff lid to write it again\\n`));
  };
  const changes: [string, (p: ReturnType<typeof product>) => void, RegExp][] = [
    ["the units", (p) => { p.put("bom.json", { ...p.bom(), units: 2 }); p.run("quote", "lid"); }, /README\.md would now say something else/],
    ["the spares", (p) => { const b = p.bom(); b.lines[0].spares = 1; p.put("bom.json", b); p.run("quote", "lid"); }, /README\.md would now say something else/],
    ["a pin", (p) => { const b = p.bom(); b.lines[0].pin = { supplier: "Craftcloud" }; p.put("bom.json", b); p.run("quote", "lid"); }, /lid\/ORDER\.md would now say something else/],
    ["a part file of the same volume, exported again", (p) => { p.put("fab/lid.stl", box([0, 0, 0], [20, 5, 10])); p.put("fab/build.json", exported(p.dir)); }, /fab\/lid\.stl is not the file it was copied from/],
    ["a part file changed by hand", (p) => p.put("fab/lid.stl", box([0, 0, 0], [20, 5, 10])), /lid: fab\/lid\.stl was changed since sprue cad wrote it/],
    ["an edit to the part's CAD", (p) => p.put("cad/lid.py", "# the lid, edited\n"), /lid: fab\/lid\.stl: exported from an earlier design/],
    ["a whole product that fails", (p) => p.put("system.json", systemJson(p.dir, [clearance])), /the whole-product check no longer passes on these parts/],
    ["a check that fails", (p) => { p.put("design.json", { ...p.read("design.json"), params: { ok: 0, fit: 1 } }); p.run("check", "lid"); }, /check lid-ok fails \(checks\.json\)/],
    ["the catalog", (p) => p.put("catalog.json", { shipping: { Somewhere: 1 }, offers: {} }), /quotes\.json was priced from an earlier catalog\.json/],
    ["the copy edited", (p) => writeFileSync(join(p.order, "lid/lid-lid.stl"), box([0, 0, 0], [20, 5, 10])), /lid\/lid-lid\.stl was changed by hand since sprue handoff wrote it/],
    ["an ORDER.md edited", (p) => writeFileSync(join(p.order, "lid/ORDER.md"), "edited\n"), /lid\/ORDER\.md was changed by hand since sprue handoff wrote it/],
    ["a file of it deleted", (p) => rmSync(join(p.order, "lid.svg")), /lid\.svg was removed or changed by hand since sprue handoff wrote it/],
    ["order.json deleted", (p) => rmSync(join(p.order, "order.json")), /it has no order\.json to tie it to the parts/],
    ["a bom.json that doesn't parse", (p) => p.put("bom.json", readFileSync(join(p.dir, "bom.json"), "utf8").slice(0, -5)), /bom\.json doesn't parse \([^\n]*\), so it can't be tied to the parts/],
    ["no checks.json", (p) => rmSync(join(p.dir, "checks.json")), /there is no checks\.json, so it can't be tied to the parts/],
    ["a bom.json line Sprue can't read", (p) => { const b = p.bom(); delete (b.lines[0] as Partial<BomLine>).spec; p.put("bom.json", b); }, /bom\.json: lid: spec must be an object/],
    ["a line's file not a path", (p) => { const b = p.bom(); (b.lines[0] as unknown as { file: number }).file = 5; p.put("bom.json", b); }, /bom\.json: lid: /],
    ["a made line added", (p) => {
      p.put("cad/plate.py", "# the plate\n"); p.put("fab/plate.stl", box([0, 0, 0], [60, 40, 1.5])); p.put("fab/plate.step", STEP);
      p.put("bom.json", { ...p.bom(), lines: [...p.bom().lines, PLATE] }); p.current();
    }, /the made parts changed \(plate\//],
  ];
  await Promise.all(changes.map(([name, change, why]) => t.test(name, (st) => {
    const p = product(st);
    assert.equal(p.handoff().status, 0);
    change(p);
    const r = p.run("status", "lid");
    removed(r, why);
    assert.ok(!existsSync(p.order), name);
  })));
  await t.test("controls: these keep it", (st) => {
    const p = product(st);
    assert.equal(p.handoff().status, 0);
    const kept = (what: string) => {
      const r = p.run("status", "lid");
      assert.doesNotMatch(r.stdout, /removed products\/lid\/fab\/order/, what);
      assert.ok(existsSync(join(p.order, "README.md")), what);
    };
    kept("status once");
    kept("status twice");
    p.put("design.json", { ...p.read("design.json"), costNotes: ["Craftcloud quoted $7 on 2026-11-08"] });
    kept("a cost note");
    p.put("design.json", { ...p.read("design.json"), assembly: ["Put the lid on", "Press it down"] });
    kept("an assembly step");
    writeFileSync(join(p.order, "notes.txt"), "mine\n");
    kept("a file of the person's own");
    assert.ok(existsSync(join(p.order, "notes.txt")));
  });
});

test("score, package and all take away a stale fab/order/, and sprue cad always does", async (t) => {
  const stale = (p: ReturnType<typeof product>) => {
    assert.equal(p.handoff().status, 0);
    writeFileSync(join(p.order, "lid/ORDER.md"), "edited\n");
  };
  const gone = /removed products\/lid\/fab\/order\/: lid\/ORDER\.md was changed by hand since sprue handoff wrote it\. Run sprue handoff lid to write it again/;
  await t.test("score", (st) => {
    const p = product(st);
    stale(p);
    p.put("reference/reference.json", { slug: "lid", source: "https://example.com", units: 1, roles: [], batchUsd: { low: 1, high: 100, basis: "a guess" } });
    assert.match(p.run("score", "lid").stdout, gone);
    assert.ok(!existsSync(p.order));
  });
  await t.test("score, for a product with no reference", (st) => {
    const p = product(st);
    stale(p);
    const r = p.run("score", "lid");
    assert.match(r.stdout, gone);
    assert.match(r.stdout, /no reference at products\/lid\/reference\/reference\.json/);
    assert.ok(!existsSync(p.order));
  });
  await t.test("package", (st) => {
    const p = product(st);
    stale(p);
    p.put("build-plan.md", "# plan\n");
    assert.match(p.run("package", "lid").stdout, gone);
    assert.ok(!existsSync(p.order));
  });
  await t.test("all, with no reference", (st) => {
    const p = product(st);
    stale(p);
    assert.match(p.run("all", "lid").stdout, gone);
    assert.ok(!existsSync(p.order));
  });
  await t.test("cad, whether or not its build runs", (st) => {
    const p = product(st);
    assert.equal(p.handoff().status, 0);
    assert.match(p.run("cad", "lid").stdout, /removed products\/lid\/fab\/order\/: sprue cad exports the parts again\. Run sprue handoff lid once they pass/);
    assert.ok(!existsSync(p.order));
  });
});

test("sprue status shows fab/order/ by its parts, and fab/ counts the same with it or without", (t) => {
  const p = product(t);
  const before = p.run("status", "lid").stdout;
  assert.match(before, /✓ fab\/ \(5\)/);
  assert.doesNotMatch(before, /fab\/order/);
  assert.equal(p.handoff().status, 0);
  const after = p.run("status", "lid").stdout;
  assert.match(after, /quotes\.json \(stale\) {2}✓ fab\/order\/ \(2 parts\)\n/);
  assert.match(after, /✓ fab\/ \(5\)/);
});

test("package ships no ORDER.md, and the hand-off leaves production/ current", (t) => {
  const p = product(t, { cnc: false });
  assert.equal(p.handoff().status, 0);
  assert.equal(p.run("plan", "lid").status, 0);
  const r = p.run("package", "lid");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = join(p.dir, "production");
  assert.ok(readdirSync(out, { recursive: true, encoding: "utf8" }).every((f) => !/ORDER\.md|order\.json/.test(f)));
  assert.ok(existsSync(p.order));
  assert.equal(packageProblem(p.dir, p.bom()), undefined);
});

test("the date it was written, not today's, is what it is checked against", (t) => {
  const p = product(t);
  assert.equal(p.handoff().status, 0);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-11-07T12:00:00Z") });
  assert.equal(new Date().getFullYear(), 2027);
  assert.equal(handoffStaleness(p.dir), undefined);
  t.mock.timers.reset();
  assert.equal(relative(p.dir, p.order), join("fab", "order"));
});
