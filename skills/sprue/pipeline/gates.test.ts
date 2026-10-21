// A failure stops the run: `sprue check` and `sprue all` exit 1 on a failed check, `sprue inspect` and `sprue all` on a
// whole product or a part file that fails Inspect, `sprue accept` refuses a gate while a check fails (at Design's, a
// check of a part on its own), a part file is not the one the design describes, (from Inspect's gate on) the
// whole-product check fails or (from the source gate on) the order is not priced whole from the BOM and offers as they
// are, and `sprue package` refuses (and takes away an earlier package) instead of shipping a stale or broken export.
// The CO2 run's every failure was exit 0, its case was packaged at its old height and its order bought another board
// than its BOM's. At Inspect, a gate never shown is not accepted or declined unnamed, and in a run from before Inspect
// a fix there reopens the later gate it changed.
// These run the command line on a one- or two-part product in a temporary folder, with no Python. Run them with
//   node --test skills/sprue/pipeline/gates.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileProblems, meshProblem, packageProblem, planRecord, quoteInputs } from "./gates.ts";
import { exportRecord, systemInputs } from "./stages/score.ts";
import type { Bom, SystemCheck } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
const CAD = spawnSync("python3", ["-c", "import build123d"]).status === 0;
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

/** An offer in catalog.json. */
const offer = (supplier: string, sku: string, mpn: string, unitUsd = 2) => ({ supplier, sku, mpn, url: `https://example.com/${sku}`,
  priceBreaks: [{ qty: 1, unitUsd }], stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-10-21" });

type Gate = SystemCheck["gates"][number];
/** system.json as `sprue system` writes it of the product at `dir` as it is now: one part, its gates passed and its
 * self-test passed, but for `gates`, which are put in beside them (a failing one, or one with a risk it accepts). */
const systemJson = (dir: string, gates: Gate[] = []): SystemCheck => ({
  slug: "lid", ok: gates.every((g) => g.status === "pass"), generatedAt: "2026-10-21T00:00:00.000Z", parts: 1, envelopes: 0,
  gates: [{ id: "overlap", title: "No two parts are in the same place", status: "pass", detail: "1 part", problems: 0 }, ...gates],
  stability: [], probes: [], selfTest: { ok: true, faults: [{ gate: "overlap", fault: "two parts in one place", caught: true, detail: "caught" }], untested: [] },
  inputs: systemInputs(dir), seconds: 1,
});
/** A clearance gate that fails on two pairs. */
const clearance: Gate = { id: "clearance", title: "Every other pair is at least 0.2 mm apart", status: "fail", problems: 2,
  detail: "lid is 0.1 mm from cap; lid is 0.05 mm from foot", list: ["lid is 0.1 mm from cap", "lid is 0.05 mm from foot"] };

/** A product "lid" with one printed part, a 10 mm cube (1 cm3) exported from cad/lid.py, a whole-product check of it
 * that passes (cad/_system.py and its system.json), a quote of the files as they are and a plan, in the stage `stage`
 * at `status` (the stages before it accepted). Its rules (rules.ts): lid-ok, which says no scope, so it is a check of a
 * part, fails while design.json's `ok` param is not 1; lid-fits, of the parts together, while `fit` is not 1. With
 * `buy`, also a bought cap (Adafruit 4997), offered by Adafruit and, as another part (Adafruit 5000), by Cheap. */
function product(t: { after: (f: () => void) => void }, { stage = "design", status = "proposed", ok = 1, fit = 1, buy = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-gates-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, "products", "lid");
  mkdirSync(join(dir, "cad"), { recursive: true });
  mkdirSync(join(dir, "fab"));
  const put = (file: string, v: unknown) => writeFileSync(join(dir, file), typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2));
  const at = "2026-10-21T00:00:00.000Z";
  put("request.json", { slug: "lid", brief: "a lid", product: "lid", units: 1, region: "US", mustHave: ["a lid"], niceToHave: [], constraints: {} });
  put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok, fit }, assembly: ["Put the lid on"] });
  put("bom.json", { slug: "lid", units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1,
    spec: { volumeCm3: 1, material: "PETG" }, file: "fab/lid.stl" },
  ...(buy ? [{ id: "cap", name: "Cap", role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "Adafruit 4997" }] : [])] });
  if (buy) put("catalog.json", { shipping: { Adafruit: 5, Cheap: 1 },
    offers: { cap: [offer("Adafruit", "4997", "Adafruit 4997"), offer("Cheap", "c1", "Adafruit 5000", 0.5)] } });
  const stages = ["design", "inspect", "source", "build"];
  put("state.json", { stage, stages: Object.fromEntries(stages.slice(0, stages.indexOf(stage) + 1)
    .map((s) => [s, { status: s === stage ? status : "accepted", at }])) });
  put("rules.ts", `export const rules = [{ id: "lid-ok", title: "Lid is fine", needs: ["ok"],
  run: (c) => ({ status: Number(c.p.ok) === 1 ? "pass" : "fail", detail: "ok is " + c.p.ok }) },
  { id: "lid-fits", title: "Lid fits the cap", needs: ["fit"], scope: "assembly",
  run: (c) => ({ status: Number(c.p.fit) === 1 ? "pass" : "fail", detail: "fit is " + c.p.fit }) }];\n`);
  put("cad/lid.py", "# the lid\n");
  put("cad/_system.py", "# the whole product\n");
  put("fab/lid.stl", box([0, 0, 0], [10, 10, 10]));
  put("fab/build.json", exportRecord(dir));
  put("system.json", systemJson(dir));
  put("quotes.json", { slug: "lid", units: 1, lines: [], batchUsd: 4, perUnitUsd: 4, longestLeadDays: 3, unquoted: [], inputs: quoteInputs(dir) });
  put("build-plan.md", `# plan\n\n${planRecord(dir)}\n`);
  const run = (...args: string[]) => spawnSync(SPRUE, args, { cwd: tmp, encoding: "utf8" });
  const state = () => JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  /** The whole-product check run again on the files as they are, as `sprue system` would, with `gates` beside. */
  const whole = (gates: Gate[] = []) => put("system.json", systemJson(dir, gates));
  return { dir, put, run, state, read, whole };
}

test("a failed engineer check makes sprue check exit 1 and say what to do", (t) => {
  const p = product(t, { ok: 0 });
  const r = p.run("check", "lid");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /✗ Lid is fine: ok is 0/);
  assert.match(r.stdout, /✗ 1 check failed \(lid-ok\): fix the design and run it again; a check that doesn't fit this product is replaced or dropped in rules\.ts/);
  p.put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok: 1 }, assembly: ["Put the lid on"] });
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
  p.put("design.json", { slug: "lid", summary: "a lid", architecture: [], params: { ok: 1 }, assembly: ["Put the lid on"] });
  // design.json's params are the export's inputs, so the edit makes fab/lid.stl an export of an earlier design.
  const stale = p.run("accept", "lid");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /✗ lid: fab\/lid\.stl: exported from an earlier design \(design\.json's params changed since\): run sprue cad/);
  p.put("fab/build.json", exportRecord(p.dir));
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
  // The whole-product check was of the part as it was, too.
  assert.match(r.stderr, /✗ the whole-product check: system\.json is of an earlier design \(cad\/lid\.py changed\): run sprue system\n/);
  assert.match(r.stderr, /removed products\/lid\/production\/, which was of an earlier run/);
  assert.match(r.stderr, /nothing packaged: 2 problems above\. Fix them, then run sprue package lid again/);
  assert.equal(existsSync(join(p.dir, "production")), false);
});

test("package writes production/ afresh, so a file of an earlier run is not left beside this one's", (t) => {
  const p = product(t, { stage: "build" });
  mkdirSync(join(p.dir, "production"));
  p.put("production/old-bracket.stl", "solid old\n");
  const r = p.run("package", "lid");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(p.dir, "production", "lid.stl")));
  assert.equal(existsSync(join(p.dir, "production", "old-bracket.stl")), false);
});

test("the source and build gates and package refuse an order not priced whole, or priced from earlier files", (t) => {
  const p = product(t, { stage: "source" });
  const refused = (re: RegExp) => {
    const r = p.run("accept", "lid");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, re);
    assert.match(r.stderr, /source not accepted: /);
    assert.equal(p.state().stages.source.status, "proposed");
  };
  const quotes = p.read("quotes.json");
  // A quote of an earlier bom.json: a part since added is not in it.
  const bom = p.read("bom.json");
  p.put("bom.json", { ...bom, lines: [...bom.lines, { ...bom.lines[0], id: "lid2", name: "Second lid" }] });
  refused(/✗ quotes\.json was priced from an earlier bom\.json \(changed since\): run sprue all\n/);
  p.put("bom.json", bom);
  p.put("quotes.json", { ...quotes, inputs: undefined });
  refused(/✗ quotes\.json does not say what it was priced from \(an earlier Sprue wrote it\): run sprue all\n/);
  p.put("quotes.json", { ...quotes, unquoted: ["lid"] });
  refused(/✗ lid \(Lid\) has no price, so the total leaves it out: /);
  p.put("quotes.json", { ...quotes, noShipping: ["Adafruit"] });
  refused(/✗ catalog\.json's shipping has no figure for Adafruit, which the order buys from, so the total counts its shipping as \$0: add it \(0 if it ships free\)\n/);
  rmSync(join(p.dir, "quotes.json"));
  refused(/✗ no quotes\.json, so nothing is priced: run sprue all\n/);
  p.put("quotes.json", quotes);
  const ok = p.run("accept", "lid");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(p.state().stages.source.status, "accepted");
  // Package, which is the build gate's, refuses the same.
  p.put("quotes.json", { ...quotes, unquoted: ["lid"] });
  const pack = p.run("package", "lid");
  assert.equal(pack.status, 1);
  assert.match(pack.stderr, /✗ lid \(Lid\) has no price/);
  // The design gate prices nothing, so it doesn't ask for a quote.
  const d = product(t);
  rmSync(join(d.dir, "quotes.json"));
  assert.equal(d.run("accept", "lid").status, 0);
});

test("a made line with no file is named by validate, the build gate and package", (t) => {
  const p = product(t, { stage: "build" });
  const bom = p.read("bom.json");
  delete bom.lines[0].file;
  p.put("bom.json", bom);
  const v = p.run("validate", "lid");
  assert.equal(v.status, 1);
  assert.match(v.stdout, /✗ bom\.json: lid \(print\) names no file, so nothing would be made from it: give its file \(fab\/<part>\.stl, or the board's zip\)/);
  const r = p.run("package", "lid");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ lid: bom\.json names no file for this print part, so nothing would be made from it/);
});

test("pick refuses an offer the source stage drops; the quote exits 1 on a shop with no shipping figure or a pin it can't keep", (t) => {
  const p = product(t, { stage: "source", buy: true });
  assert.equal(p.run("check", "lid").status, 0); // pick writes the plan, which reads checks.json
  assert.equal(p.run("source", "lid").status, 0);
  for (const [args, said] of [[["Cheap"], "no offer from Cheap can be pinned, as the source stage drops each"],
    [["Cheap", "c1"], "Cheap c1 can't be pinned, as the source stage drops it"]] as const) {
    const r = p.run("pick", "lid", "cap", ...args);
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.stderr, `✗ pick: ${said}: dropped as another part (bom.json's mpn is Adafruit 4997): Cheap c1 is Adafruit 5000. ` +
      "To buy it, add its part number (Adafruit 5000) to cap's alternates in bom.json, if it is a part the design works with\n");
  }
  assert.equal(p.read("bom.json").lines[1].pin, undefined);
  const picked = p.run("pick", "lid", "cap", "Adafruit");
  assert.equal(picked.status, 0, picked.stdout + picked.stderr);
  assert.deepEqual(p.read("bom.json").lines[1].pin, { supplier: "Adafruit" });
  // Adafruit then sells out, and Cheap now sells the cap: a pick of another line requotes, can't keep cap's pin, and
  // says so (it used to exit 1 with no reason).
  const bom0 = p.read("bom.json"), catalog = p.read("catalog.json");
  p.put("bom.json", { ...bom0, lines: [...bom0.lines, { id: "foot", name: "Foot", role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "Adafruit 550" }] });
  p.put("catalog.json", { ...catalog, offers: { cap: [{ ...catalog.offers.cap[0], stock: 0 }, { ...catalog.offers.cap[1], mpn: "Adafruit 4997" }],
    foot: [offer("Adafruit", "550", "Adafruit 550"), offer("Cheap", "f1", "Adafruit 550")] } });
  const other = p.run("pick", "lid", "foot", "Cheap");
  assert.equal(other.status, 1, other.stdout);
  assert.match(other.stdout, /foot: pinned to Cheap\n/);
  assert.match(other.stdout, /✗ Cap: pinned to Adafruit, but no offer of it is left in sourcing\.json \(dropped as out of stock: Adafruit 4997\), so it is bought from Cheap: sprue pick lid cap auto, or fix the offer\n/);
  p.put("bom.json", bom0);
  p.put("catalog.json", catalog);
  // A pin written by hand to the other part's shop: the quote buys from Adafruit, and says it could not keep the pin.
  // `sprue quote` alone prices from the files as they are, not from the sourcing.json of an earlier run.
  const bom = p.read("bom.json");
  bom.lines[1].pin = { supplier: "Cheap" };
  p.put("bom.json", bom);
  const q = p.run("quote", "lid");
  assert.equal(q.status, 1);
  assert.match(q.stdout, /✗ Cap: pinned to Cheap, but no offer of it is left in sourcing\.json \(dropped as another part .*\), so it is bought from Adafruit: sprue pick lid cap auto, or fix the offer\n/);
  bom.lines[1].pin = undefined;
  p.put("bom.json", bom);
  const cat = p.read("catalog.json");
  p.put("catalog.json", { ...cat, shipping: { Cheap: 1 } });
  const s = p.run("quote", "lid");
  assert.equal(s.status, 1);
  assert.match(s.stdout, /✗ catalog\.json's shipping has no figure for Adafruit, which the order buys from, so the total counts its shipping as \$0: add it \(0 for a shop that ships free\)\n/);
  assert.deepEqual(p.read("quotes.json").noShipping, ["Adafruit"]);
  assert.match(p.run("accept", "lid").stderr, /✗ catalog\.json's shipping has no figure for Adafruit/);
  assert.match(p.run("validate", "lid").stdout, /· catalog\.json: shipping has no figure for Adafruit: an order that buys from it can't be priced whole/);
  // With its figure back, the quote is whole and of the files as they are: the gate passes.
  p.put("catalog.json", cat);
  const whole = p.run("quote", "lid");
  assert.equal(whole.status, 0, whole.stdout);
  const ok = p.run("accept", "lid");
  assert.equal(ok.status, 0, ok.stderr);
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
  assert.equal(meshProblem(p.dir, { ...lid, file: undefined }), undefined);
});

test("validate names a catalog field the quote can't read, and a print volume that is not a number, each on its own", (t) => {
  const p = product(t);
  const clean = p.run("validate", "lid");
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /^request, design, BOM are complete$/m);
  // A misspelt top-level field alone.
  p.put("catalog.json", { shipping: {}, offers: { lid: [] }, shiping: {} });
  const c = p.run("validate", "lid");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /^  ✗ catalog\.json: its top level has a field nothing reads \("shiping"/m);
  assert.match(c.stdout, /^  · catalog\.json: offers for lid, which is made \(print\), not bought, so nothing reads them$/m);
  // The quote and the offers refuse it in one line, rather than price from it.
  const s = p.run("source", "lid");
  assert.equal(s.status, 1);
  assert.match(s.stderr, /catalog\.json can't be priced from: its top level has a field nothing reads \("shiping"/);
  // A print volume that is not a number alone.
  p.put("catalog.json", { shipping: {}, offers: {} });
  const bom = JSON.parse(readFileSync(join(p.dir, "bom.json"), "utf8")) as Bom;
  p.put("bom.json", { ...bom, lines: [{ ...bom.lines[0], spec: { ...bom.lines[0].spec, volumeCm3: "abc" } }] });
  const v = p.run("validate", "lid");
  assert.equal(v.status, 1, v.stdout);
  assert.match(v.stdout, /^  ✗ bom\.json: lid \(print\): spec\.volumeCm3 must be a number of cm3 over 0, not "abc"$/m);
  p.put("bom.json", bom);
  // The live offers alone, held to their own fields, by validate and by the commands that price.
  p.put("offers.digikey.json", { fetchedAt: "2026-10-21", offers: { lid: [{ supplier: "DigiKey", sku: "1", unitPrice: 2 }] }, shipping: {} });
  const d = p.run("validate", "lid");
  assert.equal(d.status, 1, d.stdout);
  assert.match(d.stdout, /^  ✗ offers\.digikey\.json: its top level has a field nothing reads \("shipping"/m);
  const ds = p.run("source", "lid");
  assert.equal(ds.status, 1);
  assert.match(ds.stderr, /^✗ source: offers\.digikey\.json can't be priced from: its top level has a field nothing reads \("shipping"/m);
});

test("validate names quantities, part numbers and alternates that are not what the quote and the source stage read", (t) => {
  const p = product(t);
  const bom = p.read("bom.json");
  p.put("bom.json", { ...bom, units: "2", lines: [{ ...bom.lines[0], qtyPerUnit: "1", spares: 1.5, mpn: 4997, alternates: "Adafruit 5000" }] });
  const r = p.run("validate", "lid");
  assert.equal(r.status, 1);
  for (const said of ['units must be a whole number of units, 1 or more, not "2"', 'lid: qtyPerUnit must be a number of pieces, 0 or more, not "1"',
    "lid: spares must be a whole number of pieces, 0 or more, not 1.5", "lid: mpn must be the maker's part number as text, not 4997",
    'lid: alternates must be a list of part numbers as text, not "Adafruit 5000"'])
    assert.ok(r.stdout.includes(`✗ bom.json: ${said}\n`), said);
  // An empty place for the volume (null or 0) waits for sprue cad, as a missing one does.
  rmSync(join(p.dir, "fab", "lid.stl"));
  for (const volumeCm3 of [null, 0]) {
    p.put("bom.json", { ...bom, lines: [{ ...bom.lines[0], spec: { volumeCm3, material: "PETG" } }] });
    const v = p.run("validate", "lid");
    assert.equal(v.status, 0, v.stdout);
    assert.match(v.stdout, /· lid \(print\): spec\.volumeCm3 comes from `sprue cad lid` \(fab\/lid\.stl isn't built yet\)/);
  }
});

test("source and quote exit 1 on a line with no offer left, and the quote says why it has no price", (t) => {
  const p = product(t, { buy: true });
  const catalog = p.read("catalog.json");
  // Only the offer of another part is left for the cap.
  p.put("catalog.json", { ...catalog, offers: { cap: [catalog.offers.cap[1]] } });
  const s = p.run("source", "lid");
  assert.equal(s.status, 1, s.stdout);
  assert.match(s.stdout, /✗ Cap: no offer to buy it from; dropped as another part/);
  const q = p.run("quote", "lid");
  assert.equal(q.status, 1, q.stdout);
  assert.match(q.stdout, /^  ✗ the total leaves out Cap \(cap\), which has no price: no offer is left to buy it from: add one to catalog\.json/m);
  p.put("catalog.json", catalog);
  assert.equal(p.run("source", "lid").status, 0);
  assert.equal(p.run("quote", "lid").status, 0);
  // A made line the quote can't price says why: here a print pinned to a service rates.json doesn't have.
  const bom = p.read("bom.json");
  p.put("bom.json", { ...bom, lines: bom.lines.map((l: { id: string }) => (l.id === "lid" ? { ...l, pin: { supplier: "Craftclod" } } : l)) });
  const pinned = p.run("quote", "lid");
  assert.equal(pinned.status, 1);
  assert.match(pinned.stdout, /✗ the total leaves out Lid \(lid\), which has no price: it is pinned to Craftclod, which is no print service in rates\.json \(/);
});

test("the build gate and package refuse a plan of an earlier quote, and one with no record of it", (t) => {
  const p = product(t, { stage: "build" });
  const quotes = p.read("quotes.json");
  p.put("quotes.json", { ...quotes, batchUsd: 5 });
  const r = p.run("package", "lid");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /✗ build-plan\.md was written from an earlier quotes\.json \(changed since\), so its order tables are not the order: run sprue all\n/);
  assert.equal(p.run("accept", "lid").status, 1);
  p.put("build-plan.md", "# plan\n");
  assert.match(p.run("package", "lid").stderr, /✗ build-plan\.md does not say what it was written from \(an earlier Sprue wrote it\): run sprue all\n/);
  rmSync(join(p.dir, "build-plan.md"));
  assert.match(p.run("accept", "lid").stderr, /✗ no build-plan\.md, so there is no plan to build from: run sprue all\n/);
});

test("Design's gate holds the checks of each part, Inspect's every check and the whole product, and so do the gates after", (t) => {
  // A check of the parts together that fails does not stop Design's gate, which then drafts Inspect.
  const d = product(t, { fit: 0 });
  const c = d.run("check", "lid");
  assert.equal(c.status, 1);
  assert.match(c.stdout, /^  ✗ Lid fits the cap: fit is 0$/m);
  assert.match(c.stdout, /^  no scope in rules\.ts, so read as part: lid-ok \(give each scope: "part" for one part on its own, or "assembly" for the parts together\)$/m);
  const checks = d.read("checks.json");
  assert.deepEqual(checks.checks.map((x: { id: string; scope: string }) => [x.id, x.scope]).filter(([id]: string[]) => id.startsWith("lid-")), [["lid-ok", "part"], ["lid-fits", "assembly"]]);
  assert.deepEqual(checks.unscoped, ["lid-ok"]);
  const r = d.run("accept", "lid");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^now at stage 2 of 4, inspect: the whole product: the parts together, their fits, gaps, stability and function$/m);
  assert.equal(d.state().stages.inspect.status, "drafting");
  // At Inspect's gate it does, even with --force.
  for (const args of [["accept", "lid"], ["accept", "lid", "inspect", "--force"]]) {
    const i = d.run(...args);
    assert.equal(i.status, 1, args.join(" "));
    assert.match(i.stderr, /^  ✗ check lid-fits fails: fit is 0$/m);
    assert.match(i.stderr, /inspect not accepted: 1 problem above\. Fix it, then run sprue accept lid again/);
  }
  assert.equal(d.state().stages.inspect.status, "drafting");

  // The whole-product check, failing or of an earlier design, stops Inspect's gate.
  const w = product(t, { stage: "inspect" });
  w.whole([clearance]);
  const f = w.run("accept", "lid");
  assert.equal(f.status, 1, f.stdout);
  assert.match(f.stderr, /^  ✗ the whole-product check: the whole product fails clearance: lid is 0\.1 mm from cap; lid is 0\.05 mm from foot$/m);
  assert.equal(w.state().stages.inspect.status, "proposed");
  w.whole();
  w.put("cad/_system.py", "# the whole product, the lid turned over\n");
  assert.match(w.run("accept", "lid").stderr, /^  ✗ the whole-product check: system\.json is of an earlier design \(cad\/_system\.py changed\): run sprue system$/m);
  w.whole();
  const ok = w.run("accept", "lid");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^now at stage 3 of 4, source: the offers and the quote$/m);
  assert.deepEqual(Object.keys(w.state().stages), ["design", "inspect", "source"]);
  assert.equal(w.state().stages.source.status, "drafting");
  // So do the source and build gates, and package, which is the build gate's; Design's gate does not read it.
  for (const stage of ["source", "build"]) {
    const s = product(t, { stage });
    s.whole([clearance]);
    const g = s.run("accept", "lid");
    assert.equal(g.status, 1, stage);
    assert.match(g.stderr, /^  ✗ the whole-product check: the whole product fails clearance: /m, stage);
    assert.match(g.stderr, new RegExp(`${stage} not accepted: 1 problem above`), stage);
  }
  const pk = product(t, { stage: "build" });
  pk.whole([clearance]);
  const pack = pk.run("package", "lid");
  assert.equal(pack.status, 1);
  assert.match(pack.stderr, /^  ✗ the whole-product check: the whole product fails clearance: /m);
  assert.equal(existsSync(join(pk.dir, "production")), false);
  const early = product(t);
  early.whole([clearance]);
  assert.equal(early.run("accept", "lid").status, 0);
});

test("sprue inspect proposes Inspect only when no check fails and the whole product passes, and exits 1 otherwise", (t) => {
  const p = product(t, { stage: "inspect", status: "drafting", fit: 0 });
  const a = p.run("inspect", "lid");
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.match(a.stdout, /^  ✗ Lid fits the cap: fit is 0$/m);
  assert.doesNotMatch(a.stdout, /Lid is fine/, "a check of a part is Design's to list");
  assert.match(a.stdout, /^assembly checks: 1 run, 1 failed, 0 flagged$/m);
  assert.match(a.stdout, /^✓ the whole product: 1 parts in one frame: /m);
  assert.match(a.stdout, /^✗ inspect: 1 problem: fix the design, then run sprue inspect lid again$/m);
  assert.equal(p.state().stages.inspect.status, "drafting");
  // A check of a part that fails stops it too, and is said to stop Design's gate. (design.json's params are the
  // export's inputs too, so the parts are exported again with each change.)
  p.put("design.json", { ...p.read("design.json"), params: { ok: 0, fit: 1 } });
  p.put("fab/build.json", exportRecord(p.dir));
  p.whole();
  const b = p.run("inspect", "lid");
  assert.equal(b.status, 1, b.stdout);
  assert.match(b.stdout, /^  1 part check fails: it stops Design's gate too$/m);
  assert.match(b.stdout, /^✗ inspect: 1 problem: /m);
  // The whole product failing: its verdict, each problem of the failing gate, and a risk the design accepts as a flag.
  p.put("design.json", { ...p.read("design.json"), params: { ok: 1, fit: 1 } });
  p.put("fab/build.json", exportRecord(p.dir));
  const tip: Gate = { id: "stability", title: "It stands, tilted 10 deg and pushed", status: "pass", detail: "on the desk: 20 g", problems: 0,
    flags: ["2 N at the top tips it at 1.5 N (accepted: it is held by hand)"] };
  p.whole([clearance, tip]);
  const c = p.run("inspect", "lid");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /^✗ the whole product: the whole product fails clearance: lid is 0\.1 mm from cap; lid is 0\.05 mm from foot$/m);
  assert.match(c.stdout, /^  ✗ clearance: lid is 0\.1 mm from cap\n  ✗ clearance: lid is 0\.05 mm from foot$/m);
  assert.match(c.stdout, /^  ⚑ stability: 2 N at the top tips it at 1\.5 N \(accepted: it is held by hand\)$/m);
  assert.match(c.stdout, /^✗ inspect: 2 problems: fix the design, then run sprue inspect lid again$/m);
  assert.equal(p.state().stages.inspect.status, "drafting");
  // Everything passing, the flag beside it: proposed.
  p.whole([tip]);
  const ok = p.run("inspect", "lid");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^  ⚑ stability: 2 N at the top tips it at 1\.5 N/m);
  assert.match(ok.stdout, /^inspect proposed: waiting for accept, edit or decline/m);
  assert.equal(p.state().stages.inspect.status, "proposed");
  // Before Design is accepted it runs, and proposes nothing.
  const d = product(t);
  const early = d.run("inspect", "lid");
  assert.equal(early.status, 0, early.stdout);
  assert.match(early.stdout, /^note: design not accepted yet; this runs, but nothing after design is proposed for review/m);
  assert.equal(d.state().stages.inspect, undefined);
});

test("sprue inspect holds the BOM's files as the Inspect gate does, and proposes a declined Inspect again once it passes", (t) => {
  const p = product(t, { stage: "inspect", status: "drafting" });
  // Exported again, 10 x 10 x 12 mm (1.2 cm3) against the 1 cm3 bom.json prices: no check nor system.json reads the mesh.
  p.put("fab/lid.stl", box([0, 0, 0], [10, 10, 12]));
  const r = p.run("inspect", "lid");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✓ the whole product: /m);
  assert.match(r.stdout, /^✗ lid: fab\/lid\.stl: the mesh holds 1\.20 cm3 but bom\.json prices 1\.00 cm3 \(spec\.volumeCm3\)/m);
  assert.match(r.stdout, /^✗ inspect: 1 problem: fix the design, then run sprue inspect lid again$/m);
  assert.equal(p.state().stages.inspect.status, "drafting", "not proposed, as accept at its gate refuses it");
  assert.match(p.run("accept", "lid", "inspect").stderr, /^ {2}✗ lid: fab\/lid\.stl: the mesh holds 1\.20 cm3/m);
  p.put("fab/lid.stl", box([0, 0, 0], [10, 10, 10]));
  assert.equal(p.run("inspect", "lid").status, 0);
  assert.equal(p.state().stages.inspect.status, "proposed");
  // Declined, fixed and inspected again: gate 2 is back, as the decline's hint says.
  const d = p.run("decline", "lid", "move the usb");
  assert.match(d.stdout, /^change it \(then `sprue inspect lid`\) or stop here$/m);
  const again = p.run("inspect", "lid");
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /^inspect proposed: waiting for accept, edit or decline/m);
  assert.equal(p.state().stages.inspect.status, "proposed");
  assert.match(p.run("state", "lid").stdout, /\| edit, then sprue inspect lid$/m);
});

/** A product "lid" whose state.json is from before Inspect: its design, source (with a note) and build accepted, or
 * `build` as given, and its package written. */
function migrated(t: { after: (f: () => void) => void }, build = "accepted") {
  const p = product(t, { stage: "build", status: "accepted" });
  const at = "2026-10-15T00:00:00.000Z";
  p.put("state.json", { stage: "build", stages: { design: { status: "accepted", at }, source: { status: "accepted", at, note: "ok with the shipping" },
    build: { status: build, at } } });
  const pack = p.run("package", "lid");
  assert.equal(pack.status, 0, pack.stdout + pack.stderr);
  return p;
}

test("a bare accept or decline at an Inspect never proposed refuses; naming the stage still does it", (t) => {
  const p = migrated(t, "proposed");
  const before = p.state();
  for (const args of [["accept", "lid"], ["accept", "lid", "--force"], ["decline", "lid", "the plan skips the feet"]]) {
    const r = p.run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.stderr, "inspect has not been proposed: run sprue inspect lid and ask gate 2 first (or name the stage)\n", args.join(" "));
    assert.deepEqual(p.state(), before, "the source stage keeps its gate and note");
  }
  const named = p.run("accept", "lid", "inspect");
  assert.equal(named.status, 0, named.stderr);
  assert.match(named.stdout, /^note: inspect was never proposed\ninspect accepted\nnow at stage 4 of 4, build: .* \(already proposed: review it\)$/m);
  // A new run's drafting Inspect too; and proposing a later stage there names sprue inspect, which proposes Inspect.
  const n = product(t, { stage: "inspect", status: "drafting" });
  assert.match(n.run("propose", "lid", "source").stderr, /^inspect is not accepted yet, so source can't be proposed: propose inspect instead \(`sprue inspect lid`\)$/m);
  assert.equal(n.run("decline", "lid", "too", "tall").status, 1);
  assert.equal(n.run("decline", "lid", "inspect", "too", "tall").status, 0);
  assert.equal(n.state().stages.inspect.status, "declined");
});

test("in a run from before Inspect, a fix at Inspect reopens the later gate it changed, and only that one", (t) => {
  const reopened = (said: string, stage: string, why: RegExp) =>
    assert.match(said, new RegExp(`^${stage}: accepted -> drafting, because inspect changed the parts \\(${why.source}\\); rerun its commands once inspect is accepted$`, "m"));
  // Nothing changed: Inspect is proposed and accepting it resumes where the run was, the package as it is.
  const same = migrated(t);
  const s = same.run("inspect", "lid");
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.doesNotMatch(s.stdout, /-> drafting/);
  assert.match(same.run("accept", "lid").stdout, /^every stage accepted; the package is in production\/\. Nothing has been ordered\.$/m);

  // The lid made 2 mm taller within the design: its file and bom.json's volume change, so the accepted quote is of the
  // part as it was. The source and build stages go back to drafting, and accepting Inspect leads to the quote.
  const tall = migrated(t);
  tall.put("cad/lid.py", "# the lid, 2 mm taller\n");
  tall.put("fab/lid.stl", box([0, 0, 0], [10, 10, 12]));
  tall.put("fab/build.json", exportRecord(tall.dir));
  const bom = tall.read("bom.json");
  tall.put("bom.json", { ...bom, lines: [{ ...bom.lines[0], spec: { volumeCm3: 1.2, material: "PETG" } }] });
  tall.whole();
  const r = tall.run("inspect", "lid");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const quote = /quotes\.json was priced from an earlier bom\.json \(changed since\): run sprue all/;
  reopened(r.stdout, "source", quote);
  reopened(r.stdout, "build", quote);
  assert.match(r.stdout, /-> drafting[^]*^inspect proposed: /m);
  const st = tall.state();
  assert.equal(st.stages.source.status, "drafting");
  assert.equal(st.stages.source.note, `reopened: inspect changed the parts (${quote.source.replace(/\\/g, "")})`);
  assert.equal(st.stages.build.status, "drafting");
  assert.match(tall.run("accept", "lid").stdout, /^now at stage 3 of 4, source: the offers and the quote$/m);

  // Made taller while a check of the parts together fails: `sprue all` prices and plans again right after, whatever
  // Inspect says, so the quote of the part as it was is reopened as Inspect fails, not left for the pass to find current.
  const failing = migrated(t);
  failing.put("fab/lid.stl", box([0, 0, 0], [10, 10, 12]));
  failing.put("bom.json", { ...bom, lines: [{ ...bom.lines[0], spec: { volumeCm3: 1.2, material: "PETG" } }] });
  const params = (fit: number) => {
    failing.put("design.json", { ...failing.read("design.json"), params: { ok: 1, fit } });
    failing.put("fab/build.json", exportRecord(failing.dir));
    failing.whole();
  };
  params(0);
  const f = failing.run("inspect", "lid");
  assert.equal(f.status, 1, f.stdout + f.stderr);
  assert.match(f.stdout, /^✗ inspect: 1 problem: /m);
  reopened(f.stdout, "source", quote);
  reopened(f.stdout, "build", quote);
  // Priced and planned again, as `sprue all` does next; the check fixed, Inspect passes and the quote is asked again.
  failing.put("quotes.json", { ...failing.read("quotes.json"), inputs: quoteInputs(failing.dir) });
  params(1);
  failing.put("build-plan.md", `# plan\n\n${planRecord(failing.dir)}\n`);
  const passed = failing.run("inspect", "lid");
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.equal(failing.state().stages.source.status, "drafting");
  assert.match(failing.run("accept", "lid").stdout, /^now at stage 3 of 4, source: the offers and the quote$/m);
  // Failing, nothing but the quote and the plan reopens a gate: the check's failure is Inspect's own, and a production/
  // of the plan before waits for the pass.
  const fit = migrated(t);
  fit.put("design.json", { ...fit.read("design.json"), params: { ok: 1, fit: 0 } });
  fit.put("fab/build.json", exportRecord(fit.dir));
  fit.whole();
  fit.put("build-plan.md", `# plan\n\n${planRecord(fit.dir)}\n`);
  const k = fit.run("inspect", "lid");
  assert.equal(k.status, 1, k.stdout + k.stderr);
  assert.doesNotMatch(k.stdout, /-> drafting/);
  assert.equal(fit.state().stages.source.status, "accepted");

  // An assembly step added: the quote holds, the plan does not. Build alone reopens; the source keeps its gate and note.
  const step = migrated(t);
  step.put("design.json", { ...step.read("design.json"), assembly: ["Put the lid on", "Press it down"] });
  step.whole();
  const b = step.run("inspect", "lid");
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.doesNotMatch(b.stdout, /^source: /m);
  reopened(b.stdout, "build", /build-plan\.md was written from an earlier design\.json \(changed since\), so its order tables are not the order: run sprue all/);
  assert.deepEqual(step.state().stages.source, { status: "accepted", at: "2026-10-15T00:00:00.000Z", note: "ok with the shipping" });

  // The part exported again, the same volume and every gate's files current, but production/ holds the copy before.
  const moved = migrated(t);
  moved.put("fab/lid.stl", box([1, 0, 0], [11, 10, 10]));
  const m = moved.run("inspect", "lid");
  assert.equal(m.status, 0, m.stdout + m.stderr);
  reopened(m.stdout, "build", /production\/lid\.stl is not fab\/lid\.stl as it is now \(changed since it was packaged\): run sprue package/);
  assert.equal(moved.state().stages.source.status, "accepted");

  // Past Inspect, sprue inspect reopens nothing: each later stage's own command and gate hold it.
  const later = product(t, { stage: "build" });
  later.put("design.json", { ...later.read("design.json"), assembly: ["Put the lid on", "Press it down"] });
  later.whole();
  const l = later.run("inspect", "lid");
  assert.equal(l.status, 0, l.stdout + l.stderr);
  assert.doesNotMatch(l.stdout, /-> drafting|proposed/);
  assert.equal(later.state().stages.build.status, "proposed");
});

test("packageProblem says when production/ is not what package would write from the files as they are", (t) => {
  const p = product(t, { stage: "build" });
  const bom = p.read("bom.json") as Bom;
  assert.equal(packageProblem(p.dir, bom), undefined, "no production/ yet");
  assert.equal(p.run("package", "lid").status, 0);
  assert.equal(packageProblem(p.dir, bom), undefined);
  p.put("build-plan.md", `# plan, with a step more\n\n${planRecord(p.dir)}\n`);
  assert.equal(packageProblem(p.dir, bom), "production/build-plan.md is not build-plan.md as it is now (changed since it was packaged): run sprue package");
  assert.equal(p.run("package", "lid").status, 0);
  // A part since taken out of the BOM, and one since added.
  assert.equal(packageProblem(p.dir, { ...bom, lines: [] }), "production/lid.stl is a copy of no file there is now: run sprue package");
  p.put("fab/foot.stl", box([0, 0, 0], [10, 10, 10]));
  assert.equal(packageProblem(p.dir, { ...bom, lines: [...bom.lines, { ...bom.lines[0], id: "foot", file: "fab/foot.stl" }] }),
    "production/ has no foot.stl, which bom.json names: run sprue package");
});

test("sprue all runs Inspect right after the checks, and exits 1 when the whole product fails it", (t) => {
  const p = product(t);
  const ok = p.run("all", "lid");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^· design: check\n[^·]*^· inspect: the whole product\n[^·]*^✓ the whole product: /m);
  p.whole([clearance]);
  const r = p.run("all", "lid");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^✗ inspect: 2 problems: fix the design, then run sprue inspect lid again$/m);
  assert.match(r.stdout, /· source and build: skipped/, "it runs to the end");
});

test("the page at Inspect says the whole product fails, with how many problems, and shows no prices until Source", (t) => {
  const page = (p: ReturnType<typeof product>) => {
    assert.equal(p.run("view", "lid", "--page").status, 0);
    const html = readFileSync(join(p.dir, "view.html"), "utf8");
    const note = /<div class="a2-gate-note"[^>]*><p>(.*?)<\/p>/.exec(html)![1];
    const data = JSON.parse(/<script type="application\/json" id="a2-page-data">([^]*?)<\/script>/.exec(html)![1].replace(/<\\\//g, "</"));
    return { html, note, prices: data.prices as Record<string, unknown> };
  };
  const p = product(t, { stage: "inspect", status: "drafting" });
  // A quote made ahead of its gate, which the figure's readout must not show before Source.
  p.put("quotes.json", { ...p.read("quotes.json"), lines: [{ lineId: "lid", supplier: "Craftcloud", sku: "lid", needQty: 1, orderQty: 1, orderUsd: 4, leadDays: 3, mode: "estimate" }] });
  p.whole([clearance]);
  let at = page(p);
  assert.match(at.html, /stage 2 of 4, inspect/);
  assert.equal(at.note, "Stage 2: the whole product fails its check, with 2 problems. Claude fixes the design and inspects it again; the gate opens once it passes. Nothing is ordered.");
  assert.deepEqual(at.prices, {});
  // Stale, it says why rather than count.
  p.whole();
  p.put("cad/_system.py", "# the whole product, the lid turned over\n");
  assert.match(page(p).note, /^Stage 2: the whole product has not passed its check \(system\.json is of an earlier design \(cad\/_system\.py changed\): run sprue system\)\. Claude fixes/);
  // Passing and proposed, it is gate 2, and accepting it leads to stage 3.
  p.whole();
  assert.equal(p.run("inspect", "lid").status, 0);
  at = page(p);
  assert.match(at.note, /^Gate 2: the whole product, inspected, is ready for you\./);
  assert.match(at.html, /<code>\/sprue accept lid<\/code><span>accept it; stage 3 then finds the parts and quotes them<\/span>/);
  assert.equal(p.run("accept", "lid").status, 0);
  at = page(p);
  assert.equal(at.note, "Stage 2 is accepted. Next is stage 3, the parts and the quote. Nothing is ordered.");
  assert.deepEqual(Object.keys(at.prices), ["lid"]);
  // At Design, gate 1 leads to Inspect.
  const d = product(t);
  assert.match(page(d).html, /<code>\/sprue accept lid<\/code><span>accept it; stage 2 then inspects the whole product<\/span>/);
});

test("sprue cad exits 1 and names a printed part whose mesh holds another volume than its line prices", { skip: !CAD && "python3 has no build123d" }, (t) => {
  const p = product(t);
  // This is of the part's mesh: no whole-product check, which sprue cad would run.
  rmSync(join(p.dir, "cad", "_system.py"));
  p.put("cad/lid.py", "from build123d import Box\n\n\ndef make():\n    return Box(10, 10, 12)\n");
  const r = p.run("cad", "lid");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^  ✗ lid: fab\/lid\.stl: the mesh holds 1\.20 cm3 but bom\.json prices 1\.00 cm3 \(spec\.volumeCm3\)/m);
  const bom = p.read("bom.json");
  p.put("bom.json", { ...bom, lines: [{ ...bom.lines[0], spec: { volumeCm3: 1.2, material: "PETG" } }] });
  const ok = p.run("cad", "lid");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
