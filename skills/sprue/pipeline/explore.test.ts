// Tests of what the product page shows at Inspect: build() reads system.json as systemAudit judges it against the
// files there are now (current, stale, missing, unreadable, not written, or nothing to assemble), and the page's own
// words for it (viewer/explorer.js) never call a product passed on an earlier design, say Ponder's 10 problems, and
// read a check with no scope as a part check. Run them with
//   node --test skills/sprue/pipeline/explore.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build, loadRates, type InspectSummary } from "./explore.ts";
import { systemInputs } from "./stages/score.ts";
import type { Bom, Checks, SystemCheck } from "./types.ts";
import { inspectVerdict, probeText, scopeOf, STAGES, TABS } from "../viewer/explorer.js";

const root = mkdtempSync(join(tmpdir(), "sprue-explore-"));
after(() => rmSync(root, { recursive: true, force: true }));
const dir = join(root, "products", "t");
mkdirSync(dir, { recursive: true });
const put = (file: string, data: unknown) => writeFileSync(join(dir, file), typeof data === "string" ? data : JSON.stringify(data));

const bom: Bom = { slug: "t", units: 1, lines: [
  { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1, spec: { material: "PETG" } },
  { id: "scr", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 4, spec: {} },
] };
put("bom.json", bom);
const checks: Checks = { slug: "t", failed: 0, flagged: 1, unscoped: ["my-rule"], checks: [
  { id: "bom-roles", title: "Roles", status: "pass", detail: "", scope: "part" },
  { id: "screw-engagement", title: "Screws reach", status: "flag", detail: "", scope: "assembly" },
  { id: "my-rule", title: "Mine", status: "pass", detail: "", scope: "part" },
] };
put("checks.json", checks);

/** build() in the temporary product, as `sprue view` runs it. */
function inspect(): InspectSummary {
  const here = process.cwd();
  try {
    process.chdir(root);
    return build("t", loadRates(), { shipping: {}, offers: {} }, { quiet: true }).inspect!;
  } finally {
    process.chdir(here);
  }
}

/** A system.json of the product as it is now: Ponder's own, gates and all, unless `change` says otherwise. */
const ponder = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "ponder", "system.json"), "utf8")) as SystemCheck;
function systemJson(change: Partial<SystemCheck> = {}) {
  put("system.json", { ...ponder, slug: "t", inputs: systemInputs(dir), ...change });
}

test("Inspect reads system.json against the files there are now, and names the command when it isn't current", () => {
  let ins = inspect();
  assert.equal(ins.system, "unwritten");
  assert.equal(ins.run, "sprue inspect t");
  assert.equal(ins.report, undefined);
  assert.deepEqual(ins.unscoped, ["my-rule"]);
  // No seeded faults are listed for this product, so there are none to show.
  assert.equal("faults" in ins, false);

  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
  ins = inspect();
  assert.equal(ins.system, "missing");
  assert.equal(ins.run, "sprue inspect t");

  systemJson();
  ins = inspect();
  assert.equal(ins.system, "current");
  assert.equal(ins.run, undefined);
  assert.equal(ins.verdict.ok, false);
  assert.deepEqual(ins.verdict.failed, ["clearance", "function"]);
  assert.equal(ins.report?.parts, 62);
  assert.equal(ins.report?.envelopes, 56);
  assert.equal(ins.report?.gates.find((g) => g.id === "clearance")?.list?.length, 6);
  assert.equal(ins.report?.gates.find((g) => g.id === "stability")?.flags?.length, 6);
  assert.deepEqual(ins.report?.gates.find((g) => g.id === "function")?.notes, ["speaker: 30% of it sees out, under the 40% the design aims for"]);
  assert.equal(ins.report?.stability.length, 5);
  assert.equal(ins.report?.probes.length, 9);
  assert.equal(ins.report?.selfTest.faults.length, 19);

  // A part file changed after the check ran: what it found is kept, but it is of an earlier design.
  writeFileSync(join(dir, "cad", "case.py"), "# a new part\n");
  ins = inspect();
  assert.equal(ins.system, "stale");
  assert.equal(ins.run, "sprue inspect t");
  assert.equal(ins.report?.parts, 62);
  assert.match(ins.verdict.detail, /^system\.json is of an earlier design \(cad\/case\.py changed\)/);

  put("system.json", "{");
  assert.equal(inspect().system, "unreadable");

  // A product of bought parts alone is not assembled by us: there is nothing to check.
  rmSync(join(dir, "cad"), { recursive: true, force: true });
  put("bom.json", { ...bom, lines: bom.lines.filter((l) => l.process === "buy") });
  ins = inspect();
  assert.equal(ins.system, "none");
  assert.equal(ins.verdict.ok, true);
  put("bom.json", bom);
  rmSync(join(dir, "system.json"));
});

test("the page has four stages, Inspect second, and reads a check with no scope as a part check", () => {
  assert.deepEqual(STAGES.map((s) => `${s.n} ${s.id}`), ["1 design", "2 inspect", "3 source", "4 build"]);
  assert.deepEqual(TABS.map((t) => t.id), STAGES.map((s) => s.id));
  assert.equal(scopeOf({ id: "old", title: "", status: "pass", detail: "" }), "part");
  assert.equal(scopeOf({ id: "usb-power", title: "", status: "pass", detail: "", scope: "assembly" }), "assembly");
});

test("Inspect's verdict line: Ponder's 10 problems, and never a pass on an earlier design", () => {
  const ins: InspectSummary = {
    verdict: { ok: false, detail: "the whole product fails clearance, function: ...", failed: ["clearance", "function"] }, system: "current",
    report: { generatedAt: ponder.generatedAt, parts: ponder.parts, envelopes: ponder.envelopes, gates: ponder.gates, stability: ponder.stability,
      probes: ponder.probes, selfTest: ponder.selfTest },
  };
  assert.deepEqual(inspectVerdict(ins), { state: "fail",
    text: "Whole product fails: 5 of 7 gates pass (10 problems); self-test 19 of 19 faults caught; 56 of 62 parts are envelopes." });
  // Every gate passed and every fault caught, but on files that have changed since: not a pass.
  const passed = { ...ins, verdict: { ok: true, detail: "", failed: [] },
    report: { ...ins.report!, gates: ponder.gates.map((g) => ({ ...g, status: "pass" as const, problems: 0 })) } };
  assert.equal(inspectVerdict(passed).state, "pass");
  assert.match(inspectVerdict(passed).text, /^Whole product passes: 7 of 7 gates pass; /);
  const stale = inspectVerdict({ ...passed, system: "stale", verdict: { ok: false, detail: "system.json is of an earlier design", failed: [] } });
  assert.equal(stale.state, "open");
  assert.match(stale.text, /^Whole product not checked on this design\. Its last check, of an earlier design: 7 of 7 gates pass/);
  assert.equal(inspectVerdict({ ...ins, system: "missing", report: undefined }).state, "open");
  // A gate with no fault planted in it proves nothing, and the line says which.
  assert.match(inspectVerdict({ ...passed, report: { ...passed.report, selfTest: { ...ponder.selfTest, untested: ["function"] } } }).text,
    /self-test 19 of 19 faults caught, none planted for function;/);
  assert.equal(inspectVerdict({ verdict: { ok: true, detail: "", failed: [] }, system: "none" }).state, "pass");
  assert.equal(inspectVerdict(undefined).state, "open");
});

test("each probe says what it measured against what it needs", () => {
  const probe = (id: string) => ponder.probes.find((p) => p.id === id)!;
  assert.equal(probeText(probe("pi-radio")), "the nearest metal part, scr25-4, is 8.91 mm away; it needs 15 mm, and 4 metal parts are closer than that");
  assert.equal(probeText(probe("speaker")), "30.4% of it sees out; it needs 20%, and the design aims for 40%");
  assert.equal(probeText(probe("pixel1")), "76.2% of its light gets through; it needs 70%");
  assert.equal(probeText(probe("camera")),
    "15.4% of the image is the product itself (base-top, coupling-base, diffuser, talk); of its target, 0% is outside the image and 0% hidden");
  assert.equal(probeText({ id: "r", kind: "keepout", nearestMetalMm: null, nearest: null, need: 15 }), "no metal part near it; it needs 15 mm clear");
});
