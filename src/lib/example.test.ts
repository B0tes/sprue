// The worked example's gates (runView in src/lib/example.ts) on the examples as committed: Ponder fails Inspect and
// says so at gate 2, the keypad passes, and with no record of the files as they are neither reads as passing a gate
// nothing says it passes. Run from the repo root, as the page is built.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Explorer } from "../../skills/sprue/pipeline/explore.ts";
import { inspectPrinted, runView, type Gate, type RunView } from "./example.ts";
import { currentEntry, readRecord } from "./gate-inputs.mjs";

const root = join(import.meta.dirname, "..", "..");
const load = (slug: string) => JSON.parse(readFileSync(join(root, "skills", "sprue", "examples", slug, "explorer.json"), "utf8")) as Explorer;
const said = (g: Gate) => g.says.flatMap((s) => [s.text, ...(s.items ?? []), ...(s.more ?? [])]).join("\n");
const accept = (g: Gate) => g.options[0];
/** The gates while the record is of the files here; else the test is skipped, as gate-outputs.test.ts fails then. */
function withRecord(t: TestContext, slug: string): RunView | undefined {
  if (!currentEntry(root, slug).entry) {
    t.skip(`src/lib/gate-outputs.json is not of ${slug}'s files: gate-outputs.test.ts says which`);
    return undefined;
  }
  return runView(load(slug));
}
/** The gates of a run's data with no record of its files: another slug, which the record doesn't have. */
function noRecord(t: TestContext, ex: Explorer): RunView {
  t.mock.method(console, "warn", () => {});
  return runView({ ...ex, slug: `${ex.slug}-unrecorded` });
}

test("Ponder fails Inspect at gate 2, says what fails, and nothing after it reads as reached", (t) => {
  const v = withRecord(t, "ponder");
  if (!v) return;
  const [, g2, g3, g4] = v.gates;
  assert.deepEqual(v.stops, { gate: 2, why: "the whole product fails its check" });
  assert.equal(g2.question, "The whole product fails. How do you want to go on?");
  assert.equal(g2.ran?.[0].cmd, "sprue inspect ponder");
  assert.match(g2.ran![0].out, /✗ inspect: 10 problems/);
  const text = said(g2);
  assert.doesNotMatch(text, /Not inspected/);
  assert.match(text, /^Whole product fails: 5 of 7 gates pass \(10 problems\)/m);
  assert.match(text, /^Failed: Every other pair is at least 0\.2 mm apart \(6 problems\):/m);
  assert.match(text, /\(4 problems\):/);
  assert.equal(text.match(/^pi-radio: .* under 15 mm$/gm)?.length, 4);
  assert.match(text, /^Assembly checks: 19 run, 0 failed, 7 flagged\.$/m);
  assert.equal(accept(g2).accepts, false);
  assert.equal(accept(g2).go, undefined);
  assert.equal(accept(g2).ran?.ok, false);
  for (const g of [g3, g4]) {
    assert.match(g.ahead ?? "", /refuses at gate 2/);
    assert.equal(accept(g).accepts, false);
  }
  assert.match(v.caption, /the whole product fails Inspect/);
});

test("Ponder's gate 1 counts the checks of its parts alone, as the record's inspect sorts them", (t) => {
  const v = withRecord(t, "ponder");
  if (!v) return;
  const g1 = said(v.gates[0]);
  assert.match(g1, /^Part checks: 7 run, 0 failed, 2 flagged for you:$/m);
  // The checks of the parts together are gate 2's.
  assert.doesNotMatch(g1, /Survives a fall from desk height|Camera-on light/);
  assert.match(v.intro.design, /ran 7 part checks/);
  assert.match(v.intro.inspect, /ran 19 checks of the parts together/);
  assert.match(v.under?.design ?? "", /all 26 checks here, the 19 of the parts together too/);
});

test("the keypad passes every gate, with what each stage ran", (t) => {
  const v = withRecord(t, "macropad");
  if (!v) return;
  assert.equal(v.stops, undefined);
  for (const g of v.gates) {
    assert.equal(g.ahead, undefined, g.header);
    assert.equal(accept(g).accepts, true, g.header);
    assert.equal(accept(g).ran?.ok, true, g.header);
  }
  const [, g2, , g4] = v.gates;
  assert.equal(accept(g2).go, "source");
  assert.equal(g2.question, "Accept the whole product and source it?");
  assert.match(said(g2), /^Whole product passes: 7 of 7 gates pass; self-test \d+ of \d+ faults caught\.$/m);
  assert.doesNotMatch(said(g2), /Not inspected/);
  assert.deepEqual(g4.ran?.map((r) => r.cmd), ["sprue verify macropad", "sprue package macropad"]);
  assert.match(g4.ran![0].out, /^VERIFIED/m);
});

test("with no record of its files, Ponder still stops at gate 2, as its score fails the whole product", (t) => {
  const v = noRecord(t, load("ponder"));
  const [, g2, g3, g4] = v.gates;
  assert.equal(v.stops?.gate, 2);
  assert.equal(v.stops?.unknown, undefined);
  assert.equal(g2.question, "The whole product fails. How do you want to go on?");
  assert.match(said(g2), /score, written with the same data, has the whole product failing clearance and function/);
  for (const g of [g2, g3, g4]) assert.equal(accept(g).accepts, false, g.header);
  assert.equal(accept(g2).go, undefined);
  assert.ok(g3.ahead && g4.ahead);
  // With no record, the checks' scopes aren't known: none is called a part's.
  assert.match(said(v.gates[0]), /^Checks: 26 run, 0 failed, 9 flagged for you:$/m);
  assert.match(v.intro.design, /ran 26 checks/);
});

test("with no record and no verdict of its files, the keypad isn't shown past gate 2", (t) => {
  const v = noRecord(t, load("macropad"));
  const [, g2, g3, g4] = v.gates;
  assert.deepEqual(v.stops, { gate: 2, why: "this page has no result of the whole-product check on these files", unknown: true });
  assert.equal(accept(g2).accepts, false);
  assert.equal(accept(g2).go, undefined);
  assert.match(accept(g2).reply, /^Not shown: /);
  for (const g of [g3, g4]) {
    assert.match(g.ahead ?? "", /isn't shown as reached/);
    assert.equal(accept(g).accepts, false);
  }
});

test("a run that stops at gate 1 shows gate 2 as not reached", (t) => {
  const ex = load("macropad");
  const failing = { ...ex, checks: ex.checks.map((c, i) => (i === 0 ? { ...c, status: "fail" as const } : c)) };
  const v = noRecord(t, failing);
  const [g1, g2] = v.gates;
  assert.equal(v.stops?.gate, 1);
  assert.equal(accept(g1).accepts, false);
  assert.match(g2.ahead ?? "", /^Stage 2 hasn't started: a check of a part fails/);
  assert.match(accept(g2).reply, /^Not yet: /);
  assert.equal(accept(g2).accepts, false);
});

test("sprue inspect's output reads back as cli.ts and cad/system.py print it", () => {
  const record = readRecord(root);
  const out = (slug: string) => record[slug]?.gates.find((g: { stage: string }) => g.stage === "inspect")?.ran[0]?.out;
  const p = inspectPrinted(out("ponder"))!;
  assert.equal(p.ok, false);
  assert.equal(p.whole, false);
  assert.deepEqual(p.failing.map((g) => [g.id, g.problems.length]), [["clearance", 6], ["function", 4]]);
  assert.deepEqual(p.counts, { run: 19, failed: 0, flagged: 7 });
  assert.equal(p.checks.length, 19);
  assert.equal(p.flags.length, 6);
  assert.deepEqual(p.gates, { passed: 5, of: 7 });
  const k = inspectPrinted(out("macropad"))!;
  assert.equal(k.ok && k.whole, true);
  assert.deepEqual(k.failing, []);
  // Only cli.ts's lines, as when system.json was current and the check didn't run again: no gates or self-test.
  const short = inspectPrinted("  ✓ A check: fine\nassembly checks: 1 run, 0 failed, 0 flagged\n✗ the whole product: fails x\n  ✗ x: a problem\n✗ inspect: 1 problem: fix it");
  assert.deepEqual(short?.failing, [{ id: "x", title: "x", problems: ["a problem"] }]);
  assert.equal(short?.gates, undefined);
  assert.equal(inspectPrinted("design accepted"), undefined);
});
