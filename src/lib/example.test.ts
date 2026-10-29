// The worked example's gates (runView in src/lib/example.ts) on the examples as committed: Ponder fails Inspect and
// says so at gate 2, the keypad passes, and with no record of the files as they are neither reads as passing a gate
// nothing says it passes. Run from the repo root, as the page is built.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Explorer } from "../../skills/sprue/pipeline/explore.ts";
import { modelView } from "../../skills/sprue/pipeline/model.ts";
import { checkedOnFiles, inspectPrinted, runView, type Gate, type RunView } from "./example.ts";
import { siteModelView } from "./model-view.ts";
import { currentEntry, readRecord } from "./gate-inputs.mjs";

const root = join(import.meta.dirname, "..", "..");
const load = (slug: string) => JSON.parse(readFileSync(join(root, "skills", "sprue", "examples", slug, "explorer.json"), "utf8")) as Explorer;
const said = (g: Gate) => g.says.flatMap((s) => [s.text, ...(s.items ?? []), ...(s.more ?? [])]).join("\n");
const accept = (g: Gate) => g.options[0];
/** The gates while the record is of the files here (of explorer.json as it is, or as `edit` makes it); else the test is
 * skipped, as gate-outputs.test.ts fails then. */
function withRecord(t: TestContext, slug: string, edit = (ex: Explorer) => ex): RunView | undefined {
  if (!currentEntry(root, slug).entry) {
    t.skip(`src/lib/gate-outputs.json is not of ${slug}'s files: gate-outputs.test.ts says which`);
    return undefined;
  }
  return runView(edit(load(slug)));
}
/** explorer.json as `sprue view` wrote it before checks had a scope and Sprue had Inspect. */
const beforeInspect = (ex: Explorer): Explorer => ({ ...ex, checks: ex.checks.map((c) => ({ ...c, scope: undefined })), inspect: undefined });
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

test("Ponder's gate 1 counts the checks of its parts alone, as checks.json sorts them", (t) => {
  const v = withRecord(t, "ponder");
  if (!v) return;
  const g1 = said(v.gates[0]);
  assert.match(g1, /^Part checks: 7 run, 0 failed, 2 flagged for you:$/m);
  // The checks of the parts together are gate 2's.
  assert.doesNotMatch(g1, /Survives a fall from desk height|Camera-on light/);
  assert.match(v.intro.design, /ran 7 part checks/);
  assert.match(v.intro.inspect, /ran 19 checks of the parts together/);
  // explorer.json is of Inspect: nothing on the page is older than the run's files.
  assert.deepEqual(v.under, {});
});

test("an explorer.json from before Inspect takes the scopes and the verdict from the record's sprue inspect", (t) => {
  const v = withRecord(t, "ponder", beforeInspect);
  if (!v) return;
  const [g1, g2] = v.gates;
  assert.match(said(g1), /^Part checks: 7 run, 0 failed, 2 flagged for you:$/m);
  assert.match(v.under?.design ?? "", /all 26 checks here, the 19 of the parts together too/);
  assert.match(v.under?.inspect ?? "", /from before Sprue had Inspect.*from `sprue inspect ponder`, run on these files/);
  assert.deepEqual(v.stops, { gate: 2, why: "the whole product fails its check" });
  const text = said(g2);
  assert.match(text, /^Whole product fails: 10 problems\.$/m);
  assert.match(text, /^Failed: clearance \(6 problems\):/m);
  assert.match(text, /^Assembly checks: 19 run, 0 failed, 7 flagged\.$/m);
  assert.equal(accept(g2).accepts, false);
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
  assert.match(said(g2), /^Whole product passes: 7 of 7 gates pass; self-test (\d+) of \1 faults caught; 41 of 44 parts are envelopes\.$/m);
  // The verdict counts the envelopes, so the line after it only says what one is.
  assert.match(said(g2), /^Envelopes are bought parts drawn at their datasheet sizes/m);
  assert.doesNotMatch(said(g2), /Not inspected|^\d+ of \d+ parts are envelopes, /m);
  assert.deepEqual(g4.ran?.map((r) => r.cmd), ["sprue verify macropad", "sprue package macropad"]);
  assert.match(g4.ran![0].out, /^VERIFIED/m);
});

test("with no record of its files, Ponder still stops at gate 2, as its Inspect fails the whole product", (t) => {
  const v = noRecord(t, load("ponder"));
  const [, g2, g3, g4] = v.gates;
  assert.deepEqual(v.stops, { gate: 2, why: "the whole product fails its check" });
  assert.equal(g2.question, "The whole product fails. How do you want to go on?");
  assert.match(said(g2), /^Whole product fails: 5 of 7 gates pass \(10 problems\)/m);
  for (const g of [g2, g3, g4]) assert.equal(accept(g).accepts, false, g.header);
  assert.equal(accept(g2).go, undefined);
  assert.ok(g3.ahead && g4.ahead);
});

test("with no record and an explorer.json from before Inspect, Ponder stops at gate 2, as its score fails the whole product", (t) => {
  const v = noRecord(t, beforeInspect(load("ponder")));
  const [, g2, g3, g4] = v.gates;
  assert.deepEqual(v.stops, { gate: 2, why: "the whole product fails its check" });
  assert.match(said(g2), /score, written with the same data, has the whole product failing clearance and function/);
  for (const g of [g2, g3, g4]) assert.equal(accept(g).accepts, false, g.header);
  // With no record, the checks' scopes aren't known: none is called a part's.
  assert.match(said(v.gates[0]), /^Checks: 26 run, 0 failed, 9 flagged for you:$/m);
  assert.match(v.intro.design, /ran 26 checks/);
});

test("with no record, the keypad's Inspect of these files takes it through gate 2", (t) => {
  const v = noRecord(t, load("macropad"));
  const g2 = v.gates[1];
  assert.equal(v.stops, undefined);
  assert.equal(accept(g2).accepts, true);
  assert.equal(accept(g2).go, "source");
  // Nothing was run on these files: no command's output is shown.
  assert.equal(g2.ran, undefined);
  assert.equal(accept(g2).ran, undefined);
});

test("with no record and no verdict of its files, the keypad isn't shown past gate 2", (t) => {
  const v = noRecord(t, beforeInspect(load("macropad")));
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
  // The record's: system.json was current, so the check didn't run again and only cli.ts's lines are there.
  const p = inspectPrinted(out("ponder"))!;
  assert.equal(p.ok, false);
  assert.equal(p.whole, false);
  assert.deepEqual(p.failing.map((g) => [g.id, g.title, g.problems.length]), [["clearance", "clearance", 6], ["function", "function", 4]]);
  assert.deepEqual(p.counts, { run: 19, failed: 0, flagged: 7 });
  assert.equal(p.checks.length, 19);
  assert.equal(p.flags.length, 6);
  assert.equal(p.gates, undefined);
  assert.equal(p.selfTest, undefined);
  const k = inspectPrinted(out("macropad"))!;
  assert.equal(k.ok && k.whole, true);
  assert.deepEqual(k.failing, []);
  // When the check ran again, cad/system.py's lines come between: a line per gate, then one per fault its self-test put
  // in (cut from a run of sprue inspect ponder).
  const ranAgain = inspectPrinted([
    "  ✓ Tallest parts fit inside the base: 35 mm inside",
    "assembly checks: 1 run, 0 failed, 0 flagged",
    "· the whole product (cad/_system.py)",
    "  ✓ No two parts are in the same place: 62 parts, no two share volume but the fits meant to (15)",
    "  ✗ Every other pair is at least 0.2 mm apart: head-lower is 0.10 mm from sd",
    "  ✗ Sound gets out, ports and views are clear, light reaches its window, radios keep clear of metal: pi-radio: scr25-4 is 8.9 mm away, under 15 mm",
    "  ✓ self-test, clearance: moved spk to 0.15 mm from talk: caught",
    "  ✗ self-test, function: put a steel block on pi-radio: missed",
    "system: FAIL, 62 parts, 357.5 s; system.json",
    "✗ the whole product: the whole product fails clearance, function: head-lower is 0.10 mm from sd",
    "  ✗ clearance: head-lower is 0.10 mm from sd",
    "  ✗ function: pi-radio: scr25-4 is 8.9 mm away, under 15 mm",
    "✗ inspect: 2 problems: fix the design, then run sprue inspect ponder again",
  ].join("\n"))!;
  assert.deepEqual(ranAgain.gates, { passed: 1, of: 3 });
  assert.deepEqual(ranAgain.selfTest, { caught: 1, of: 2 });
  assert.deepEqual(ranAgain.failing.map((g) => g.title), ["Every other pair is at least 0.2 mm apart", "Sound gets out, ports and views are clear, light reaches its window, radios keep clear of metal"]);
  assert.equal(ranAgain.checks.length, 1);
  // Only cli.ts's lines, as when system.json was current and the check didn't run again: no gates or self-test.
  const short = inspectPrinted("  ✓ A check: fine\nassembly checks: 1 run, 0 failed, 0 flagged\n✗ the whole product: fails x\n  ✗ x: a problem\n✗ inspect: 1 problem: fix it");
  assert.deepEqual(short?.failing, [{ id: "x", title: "x", problems: ["a problem"] }]);
  assert.equal(short?.gates, undefined);
  assert.equal(inspectPrinted("design accepted"), undefined);
});

/** Files copy-figures would put in public/examples/<slug>/ (model.json, system.glb), made here where the build hasn't
 * (it hasn't in CI's test job), and taken away again after the test with the folders made for them. */
function publicFiles(t: TestContext, files: string[]) {
  const made: string[] = [];
  for (const file of files) {
    const path = join(root, "public", "examples", file);
    if (existsSync(path)) continue;
    let dir = dirname(path);
    const dirs: string[] = [];
    while (!existsSync(dir)) { dirs.push(dir); dir = dirname(dir); }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}");
    made.push(path, ...dirs);
  }
  t.after(() => { for (const path of made) rmSync(path, { recursive: true, force: true }); });
}
/** The VERCEL_GIT_* variables as `set` has them for the test, and as they were after it. */
function vercelEnv(t: TestContext, set: Record<string, string> = {}) {
  const keys = ["VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG", "VERCEL_GIT_COMMIT_SHA"];
  const was = keys.map((k) => process.env[k]);
  t.after(() => keys.forEach((k, i) => (was[i] === undefined ? delete process.env[k] : (process.env[k] = was[i]))));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, set);
}

test("Fig 1's 3D tab: the record says sprue inspect found both examples' system.json of their files, so neither model is called stale", (t) => {
  vercelEnv(t);
  publicFiles(t, ["macropad/model.json", "macropad/system.glb", "ponder/model.json", "ponder/system.glb"]);
  for (const slug of ["macropad", "ponder"]) {
    const v = withRecord(t, slug);
    if (!v) return;
    // Ponder's check fails, on its files as they are: its record didn't run the check again either.
    assert.deepEqual(v.model, { current: true, files: `https://github.com/B0tes/sprue/blob/main/skills/sprue/examples/${slug}/` }, slug);
  }
});

test("Fig 1 has a 3D tab only with both of the model's files; its files link to GitHub at the commit built; with no record it isn't current", (t) => {
  const ex = load("macropad");
  vercelEnv(t);
  assert.equal(noRecord(t, ex).model, undefined);
  publicFiles(t, ["macropad-unrecorded/model.json"]);
  assert.equal(noRecord(t, ex).model, undefined, "no system.glb");
  publicFiles(t, ["macropad-unrecorded/system.glb"]);
  assert.deepEqual(noRecord(t, ex).model, { current: false, files: "https://github.com/B0tes/sprue/blob/main/skills/sprue/examples/macropad-unrecorded/" });
  // At the commit Vercel builds, in the repo it builds; a repo named by half falls back to this one.
  Object.assign(process.env, { VERCEL_GIT_REPO_OWNER: "someone", VERCEL_GIT_REPO_SLUG: "fork", VERCEL_GIT_COMMIT_SHA: "0a1b2c3" });
  assert.equal(noRecord(t, ex).model?.files, "https://github.com/someone/fork/blob/0a1b2c3/skills/sprue/examples/macropad-unrecorded/");
  delete process.env.VERCEL_GIT_REPO_SLUG;
  assert.equal(noRecord(t, ex).model?.files, "https://github.com/B0tes/sprue/blob/0a1b2c3/skills/sprue/examples/macropad-unrecorded/");
});

test("an inspect that ran the whole-product check again wasn't of system.json as committed; one that didn't was", () => {
  const head = "  ✓ A check: fine\nassembly checks: 1 run, 0 failed, 0 flagged\n";
  assert.equal(checkedOnFiles(inspectPrinted(`${head}✓ the whole product: passes\n✓ inspect: proposed`)), true);
  assert.equal(checkedOnFiles(inspectPrinted(`${head}✗ the whole product: fails x\n  ✗ x: a problem\n✗ inspect: 1 problem: fix it`)), true, "a fail of these files");
  const again = `${head}  ✓ placed: every part is where it should be\n  ✓ self-test, placed: moved a part: caught\nsystem: PASS, 3 parts, 1.0 s; system.json\n✓ the whole product: passes\n✓ inspect: proposed`;
  assert.notEqual(inspectPrinted(again)?.gates, undefined);
  assert.equal(checkedOnFiles(inspectPrinted(again)), false);
  assert.equal(checkedOnFiles(undefined), false, "no record");
});

test("the site's 3D tab clears stale only when the record says the check is of the files", () => {
  const dir = mkdtempSync(join(tmpdir(), "sprue-site-model-"));
  try {
    cpSync(join(root, "skills", "sprue", "examples", "macropad"), dir, { recursive: true, filter: (src) => !/[/\\](fab|pcb|shots|production|history)$/.test(src) });
    const view = modelView(dir)!;
    assert.deepEqual([view.stale, view.missing], [["pcb/macropad-gerbers.zip"], ["pcb/macropad-gerbers.zip"]], "this build has no pcb/");
    assert.deepEqual(siteModelView(view, true), { ...view, stale: [], missing: [] });
    assert.equal(siteModelView(view, false), view);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
