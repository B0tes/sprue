// The gate outputs the worked example shows (src/lib/gate-outputs.json) against the files they were run on, and the
// hash both sides use (src/lib/gate-inputs.mjs). A change to an example or to Sprue's code without `npm run build`,
// which runs the gates again where the CAD exports are, fails here, instead of the page leaving the outputs out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RECORD, currentEntry, firstChange, gateInputs, readRecord } from "./gate-inputs.mjs";

const root = join(import.meta.dirname, "..", "..");
const examples = join(root, "skills", "sprue", "examples");
/** The examples the site lists (finishedRuns in example.ts): each has a record. */
const slugs = readdirSync(examples).filter((d) => existsSync(join(examples, d, "explorer.json")));

type Gate = { stage: string; ok: boolean; ran: { cmd: string; out: string; ok: boolean }[] };

test("the committed record is of the committed files", () => {
  const record = readRecord(root);
  for (const slug of slugs) {
    const now = currentEntry(root, slug, record);
    assert.ok(now.entry, `${RECORD} is not of ${slug}'s files (${now.changed}): run npm run build where sprue cad ${slug} has made the exports, and commit the record`);
  }
});

test("each record runs the gates in order, stops at a refusal and holds no temp path", () => {
  const record = readRecord(root);
  // A slug with no record fails the test above.
  for (const slug of slugs.filter((s) => record[s])) {
    const gates = record[slug].gates as Gate[];
    assert.deepEqual(gates.map((g) => g.stage), ["design", "inspect", "source", "build"].slice(0, gates.length), slug);
    for (const [i, g] of gates.entries()) {
      const accept = g.ran.at(-1)!;
      assert.equal(accept.cmd, `sprue accept ${slug}`, `${slug} ${g.stage}: a gate ends at its accept`);
      assert.equal(g.ok, accept.ok, `${slug} ${g.stage}: the gate's ok is its accept's`);
      if (!g.ok) assert.equal(i, gates.length - 1, `${slug}: nothing after a refused gate can be proposed`);
      for (const r of g.ran) assert.doesNotMatch(r.out, /sprue-gates-|\/tmp\/|file:\/\//, `${slug}: ${r.cmd} prints a path of the copy it ran in`);
    }
    if (gates.at(-1)!.ok) assert.equal(gates.length, 4, `${slug}: a run with no refusal goes through all four gates`);
  }
});

test("the walk keeps what git keeps, where there is git", (t) => {
  let listed: string;
  try {
    // Tracked, or new and not ignored: what a commit would hold.
    listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "skills/sprue/examples", "skills/sprue/bin", "skills/sprue/cad/system.py", "skills/sprue/pipeline"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return t.skip("no git here");
  }
  const git = listed.split("\n").filter((f) => f && existsSync(join(root, f)));
  for (const slug of slugs) {
    const walked = Object.keys(gateInputs(root, slug));
    const ofSlug = git.filter((f) => !f.startsWith("skills/sprue/examples/") || f.startsWith(`skills/sprue/examples/${slug}/`)).filter((f) => !f.endsWith(".test.ts"));
    assert.deepEqual(walked, [...ofSlug].sort(), slug);
  }
});

/** A small repo: an example and Sprue's code, as gateInputs reads them. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), "sprue-gate-inputs-"));
  const put = (f: string, text = f) => {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  };
  for (const f of ["bom.json", "design.json", "cad/case.py", "cad/_system.py", "firmware/code.py", "previews/case.svg"]) put(`skills/sprue/examples/kit/${f}`);
  for (const f of ["bin/sprue", "cad/system.py", "pipeline/cli.ts", "pipeline/rates.json", "pipeline/pcb/readback.py"]) put(`skills/sprue/${f}`);
  return { dir, put };
}

test("a file git leaves out doesn't count", () => {
  const { dir, put } = tree();
  try {
    const before = gateInputs(dir, "kit");
    for (const f of ["fab/case.stl", "pcb/kit-gerbers.zip", "production/order-list.csv", "history/1.json", "shots/a.png", "view.html", "firmware/fil.json", "cad/__pycache__/case.pyc", ".DS_Store"])
      put(`skills/sprue/examples/kit/${f}`);
    put("skills/sprue/pipeline/cli.test.ts");
    put("skills/sprue/pipeline/pcb/__pycache__/readback.pyc");
    put("skills/sprue/examples/other/bom.json");
    assert.equal(firstChange(before, gateInputs(dir, "kit")), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file git keeps does: changed, added or removed", () => {
  const { dir, put } = tree();
  try {
    let before = gateInputs(dir, "kit");
    for (const f of ["skills/sprue/examples/kit/bom.json", "skills/sprue/examples/kit/firmware/code.py", "skills/sprue/pipeline/rates.json", "skills/sprue/cad/system.py", "skills/sprue/bin/sprue"]) {
      put(f, "changed");
      assert.equal(firstChange(before, gateInputs(dir, "kit")), f);
      before = gateInputs(dir, "kit");
    }
    put("skills/sprue/examples/kit/cad/lid.py");
    assert.equal(firstChange(before, gateInputs(dir, "kit")), "skills/sprue/examples/kit/cad/lid.py");
    before = gateInputs(dir, "kit");
    unlinkSync(join(dir, "skills/sprue/examples/kit/design.json"));
    assert.equal(firstChange(before, gateInputs(dir, "kit")), "skills/sprue/examples/kit/design.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a record is used only while it is of the files there are", () => {
  const { dir, put } = tree();
  try {
    assert.deepEqual(currentEntry(dir, "kit"), { changed: "no record" });
    const gates = [{ stage: "design", ok: true, ran: [{ cmd: "sprue accept kit", out: "design accepted", ok: true }] }];
    put(RECORD, JSON.stringify({ kit: { inputs: gateInputs(dir, "kit"), gates } }));
    assert.deepEqual(currentEntry(dir, "kit").entry?.gates, gates);
    put("skills/sprue/examples/kit/cad/case.py", "a wider case");
    assert.deepEqual(currentEntry(dir, "kit"), { changed: "skills/sprue/examples/kit/cad/case.py" });
    put(RECORD, "{ not json");
    assert.deepEqual(currentEntry(dir, "kit"), { changed: "no record" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
