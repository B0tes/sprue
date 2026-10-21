// The four gates in state.json: a file from before the Inspect stage, its design accepted, reads as at Inspect, with
// the stages after it not started, and is not rewritten until a command saves; accepting Inspect then resumes where
// the run was, and a fix made at Inspect reopens the later stages it changed. A new file drafts Inspect once the design
// is accepted, and a changed or declined design reopens it. At Inspect the hints name sprue inspect, not sprue propose.
// Run with
//   node --test skills/sprue/pipeline/state.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accept, autoPropose, decline, gateLine, gateOf, printState, propose, readState, reopenAtInspect, STAGES, startState, waiting } from "./state.ts";

const at = "2026-10-14T00:00:00.000Z";

/** A product folder "kb" in a temporary products/, with `stages` as its state.json, if any. `run` calls `f` from the
 * folder that holds products/, as the command line does, and returns what it printed. */
function product(t: { after: (f: () => void) => void }, stages?: Record<string, { status: string; at: string; note?: string }>) {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-state-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const file = join(tmp, "products", "kb", "state.json");
  mkdirSync(join(tmp, "products", "kb"), { recursive: true });
  if (stages) writeFileSync(file, JSON.stringify({ stage: "source", stages }, null, 2) + "\n");
  const run = <T>(f: () => T) => {
    const here = process.cwd(), log = console.log, lines: string[] = [];
    try {
      process.chdir(tmp);
      console.log = (...xs: unknown[]) => lines.push(xs.join(" "));
      const value = f();
      return { value, said: lines.join("\n") };
    } finally {
      console.log = log;
      process.chdir(here);
    }
  };
  const text = () => readFileSync(file, "utf8");
  return { run, text, saved: () => JSON.parse(text()) };
}

test("the stages are design, inspect, source and build, and the counts say four", (t) => {
  assert.deepEqual(STAGES, ["design", "inspect", "source", "build"]);
  const p = product(t, { design: { status: "proposed", at } });
  const said = p.run(() => printState("kb")).said;
  assert.match(said, /^gates \(state\.json\): stage 1 of 4, design$/m);
  assert.match(said, /^  ○ 2 inspect   not started$/m);
});

test("a state.json from before Inspect, its design accepted, reads as at Inspect with the stages after it not started", (t) => {
  const p = product(t, { design: { status: "accepted", at }, source: { status: "proposed", at: "2026-10-15T00:00:00.000Z" } });
  const before = p.text();
  const s = p.run(() => readState("kb")).value;
  assert.equal(s.stage, "inspect");
  assert.deepEqual(s.stages.inspect, { status: "drafting", at, note: "added: Sprue now inspects the whole product before sourcing" });
  for (const stage of ["source", "build"] as const) {
    assert.equal(gateOf(s, stage), undefined, stage);
    assert.match(gateLine(s, stage), / not started$/, stage);
  }
  assert.match(gateLine(s, "inspect"), /^… 2 inspect ← drafting  2026-10-14 00:00 UTC  added: Sprue now inspects the whole product before sourcing$/);
  const said = p.run(() => printState("kb")).said;
  assert.match(said, /^gates \(state\.json\): stage 2 of 4, inspect$/m);
  assert.match(said, /^  ○ 3 source    not started$/m);
  // Reading it, or proposing anything after Inspect, changes nothing on disk: nothing is accepted for the person.
  assert.equal(p.run(() => autoPropose("kb", "source")).value, false);
  assert.equal(p.text(), before);
  // Accepting Inspect resumes where the run was: the quote it had proposed is back at its gate.
  const ok = p.run(() => accept("kb", ["inspect"])).said;
  assert.match(ok, /^note: inspect was never proposed$/m);
  assert.match(ok, /^now at stage 3 of 4, source: the offers and the quote \(already proposed: review it\)$/m);
  const saved = p.saved();
  assert.equal(saved.stage, "source");
  assert.deepEqual(Object.keys(saved.stages), ["design", "inspect", "source"]);
  assert.deepEqual(saved.stages.design, { status: "accepted", at });
  assert.equal(saved.stages.inspect.status, "accepted");
  assert.equal(saved.stages.source.status, "proposed");
});

test("an old file with the source stage accepted keeps it once Inspect is accepted, which does not change the quote", (t) => {
  const p = product(t, { design: { status: "accepted", at }, source: { status: "accepted", at }, build: { status: "proposed", at } });
  const s = p.run(() => readState("kb")).value;
  assert.equal(s.stage, "inspect");
  assert.equal(gateOf(s, "source"), undefined);
  // Proposed as sprue inspect does once the parts pass, which leaves the source and build stages as they are.
  assert.equal(p.run(() => autoPropose("kb", "inspect")).value, true);
  assert.deepEqual(p.saved().stages.source, { status: "accepted", at });
  const said = p.run(() => accept("kb", [])).said;
  assert.match(said, /^inspect accepted$/m);
  assert.match(said, /^now at stage 4 of 4, build: the build plan, order list and fab files \(already proposed: review it\)$/m);
  const saved = p.saved();
  assert.equal(saved.stage, "build");
  assert.deepEqual(saved.stages.source, { status: "accepted", at });
  // An old run that was done is at Inspect again, until that is accepted too.
  const done = product(t, { design: { status: "accepted", at }, source: { status: "accepted", at }, build: { status: "accepted", at } });
  assert.equal(done.run(() => readState("kb")).value.stage, "inspect");
  assert.match(done.run(() => accept("kb", ["inspect"])).said, /^every stage accepted; `sprue package kb` writes production\/\. Nothing has been ordered\.$/m);
  assert.equal(done.saved().stage, "done");
});

test("a new file drafts Inspect once the design is accepted, and Inspect's own gate is next", (t) => {
  const p = product(t);
  p.run(() => startState("kb"));
  assert.deepEqual(Object.keys(p.saved().stages), ["design"]);
  // Inspect is proposed only once the design is accepted.
  assert.equal(p.run(() => autoPropose("kb", "inspect")).value, false);
  assert.equal(p.saved().stages.inspect, undefined);
  const said = p.run(() => accept("kb", [])).said;
  assert.match(said, /^now at stage 2 of 4, inspect: the whole product: the parts together, their fits, gaps, stability and function$/m);
  const saved = p.saved();
  assert.equal(saved.stage, "inspect");
  assert.equal(saved.stages.inspect.status, "drafting");
  assert.equal(saved.stages.inspect.note, undefined, "a new file's Inspect is not one added to an old file");
  assert.equal(saved.stages.source, undefined);
  assert.equal(p.run(() => autoPropose("kb", "inspect")).value, true);
  assert.equal(p.saved().stages.inspect.status, "proposed");
  assert.match(p.run(() => printState("kb")).said, /^waiting for you at gate 2: sprue accept kb \| /m);
  p.run(() => accept("kb", []));
  assert.equal(p.saved().stage, "source");
  assert.equal(p.saved().stages.source.status, "drafting");
});

test("proposing or declining the design again reopens Inspect, and the stages after it", (t) => {
  const stages = { design: { status: "accepted", at }, inspect: { status: "accepted", at }, source: { status: "proposed", at } };
  const p = product(t, stages);
  const said = p.run(() => propose("kb", "design")).said;
  assert.match(said, /^inspect: accepted -> drafting, because design changed; rerun its commands once design is accepted$/m);
  assert.match(said, /^source: proposed -> drafting, because design changed/m);
  let saved = p.saved();
  assert.equal(saved.stage, "design");
  assert.deepEqual(saved.stages.inspect.status, "drafting");
  assert.equal(saved.stages.inspect.note, "reopened: design changed");
  const d = product(t, { ...stages, inspect: { status: "proposed", at } });
  assert.match(d.run(() => decline("kb", ["design", "too", "tall"])).said, /^inspect: proposed -> drafting, because design declined/m);
  saved = d.saved();
  assert.equal(saved.stages.design.status, "declined");
  assert.equal(saved.stages.design.note, "too tall");
  assert.equal(saved.stages.inspect.status, "drafting");
  // Proposing Inspect again reopens the quote and the plan, not the design.
  const i = product(t, { design: { status: "accepted", at }, inspect: { status: "accepted", at }, source: { status: "accepted", at } });
  assert.match(i.run(() => propose("kb", "inspect")).said, /^source: accepted -> drafting, because inspect changed/m);
  assert.equal(i.saved().stages.design.status, "accepted");
  assert.equal(i.saved().stage, "inspect");
});

test("at Inspect the hints name sprue inspect, never sprue propose, and sprue inspect proposes a declined Inspect again", (t) => {
  const p = product(t, { design: { status: "accepted", at }, inspect: { status: "proposed", at } });
  assert.equal(waiting("kb", p.run(() => readState("kb")).value),
    "waiting for you at gate 2: sprue accept kb | sprue decline kb '<why>' | edit, then sprue inspect kb");
  const said = p.run(() => decline("kb", ["the", "lid", "is", "too", "thin"])).said;
  assert.match(said, /^change it \(then `sprue inspect kb`\) or stop here$/m);
  assert.equal(waiting("kb", p.run(() => readState("kb")).value), "declined (the lid is too thin): change it, then sprue inspect kb");
  // Left alone by the other proposers, but sprue inspect's passing is what the decline asked for.
  assert.equal(p.run(() => autoPropose("kb", "inspect")).value, false);
  assert.equal(p.saved().stages.inspect.status, "declined");
  assert.match(p.run(() => autoPropose("kb", "inspect", { declined: true })).said, /^inspect proposed: waiting for accept, edit or decline/);
  assert.equal(p.saved().stages.inspect.status, "proposed");
  // A proposed or accepted Inspect is left as it is.
  assert.equal(p.run(() => autoPropose("kb", "inspect", { declined: true })).value, false);
  // The other stages keep sprue propose.
  const d = product(t, { design: { status: "proposed", at } });
  assert.match(waiting("kb", d.run(() => readState("kb")).value)!, /\| edit, then sprue propose kb design$/);
  assert.match(d.run(() => decline("kb", ["too", "tall"])).said, /^change it \(then `sprue propose kb design`\) or stop here$/m);
});

test("a fix at Inspect in a run from before it reopens the later stages it names, and leaves the others as they are", (t) => {
  const p = product(t, { design: { status: "accepted", at }, source: { status: "accepted", at, note: "fine" }, build: { status: "proposed", at } });
  const said = p.run(() => reopenAtInspect("kb", ["build"], "inspect changed the parts (the plan is of an earlier design.json)")).said;
  assert.equal(said, "build: proposed -> drafting, because inspect changed the parts (the plan is of an earlier design.json); rerun its commands once inspect is accepted");
  let saved = p.saved();
  assert.deepEqual(saved.stages.source, { status: "accepted", at, note: "fine" });
  assert.equal(saved.stages.build.note, "reopened: inspect changed the parts (the plan is of an earlier design.json)");
  assert.equal(saved.stages.inspect.status, "drafting", "the Inspect drafted in memory is saved with it");
  p.run(() => reopenAtInspect("kb", ["source", "build"], "inspect changed the parts (a quote of an earlier bom.json)"));
  saved = p.saved();
  assert.equal(saved.stages.source.status, "drafting");
  assert.equal(saved.stages.source.note, "reopened: inspect changed the parts (a quote of an earlier bom.json)");
  assert.equal(saved.stages.build.note, "reopened: inspect changed the parts (the plan is of an earlier design.json)", "drafting already");
  assert.equal(saved.stage, "inspect");
});
