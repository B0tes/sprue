// The gate outputs the worked example shows (src/lib/gate-outputs.json) against the files they were run on, and the
// hash both sides use (src/lib/gate-inputs.mjs). A change to an example or to Sprue's code without `npm run build`,
// which runs the gates again where the CAD exports are, fails here, instead of the page leaving the outputs out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RECORD, currentEntry, firstChange, gateInputs, localRefusal, readRecord } from "./gate-inputs.mjs";

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

/** A small repo: an example and Sprue's code, as gateInputs reads them, with this repo's .gitignore. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), "sprue-gate-inputs-"));
  const put = (f: string, text = f) => {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  };
  put(".gitignore", readFileSync(join(root, ".gitignore"), "utf8"));
  for (const f of ["bom.json", "design.json", "cad/case.py", "cad/_system.py", "firmware/code.py", "previews/case.svg"]) put(`skills/sprue/examples/kit/${f}`);
  for (const f of ["bin/sprue", "cad/system.py", "pipeline/cli.ts", "pipeline/rates.json", "pipeline/pcb/readback.py"]) put(`skills/sprue/${f}`);
  return { dir, put };
}

/** Files under an example and under Sprue's code that the root .gitignore leaves out: the example's own folders and
 * files, and the names it leaves out at any depth (a key, an env file, a log, a build cache). */
const LEFT_OUT = [
  ...["fab/case.stl", "pcb/kit-gerbers.zip", "production/order-list.csv", "history/1.json", "shots/a.png", "view.html", "firmware/fil.json"],
  ...["cad/__pycache__/case.pyc", ".DS_Store", "notes.pem", "cad/.env.local", "npm-debug.log.1", "x.tsbuildinfo", ".vercel/project.json"],
].map((f) => `skills/sprue/examples/kit/${f}`);

test("a file git leaves out doesn't count", () => {
  const { dir, put } = tree();
  try {
    const before = gateInputs(dir, "kit");
    for (const f of LEFT_OUT) put(f);
    put("skills/sprue/pipeline/cli.test.ts");
    put("skills/sprue/pipeline/pcb/__pycache__/readback.pyc");
    put("skills/sprue/pipeline/.env.local");
    put("skills/sprue/pipeline/key.pem");
    put("skills/sprue/examples/other/bom.json");
    assert.equal(firstChange(before, gateInputs(dir, "kit")), undefined);
    // .gitignore takes .env.example back, so it counts.
    put("skills/sprue/examples/kit/.env.example");
    assert.equal(firstChange(before, gateInputs(dir, "kit")), "skills/sprue/examples/kit/.env.example");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the walk leaves out what git leaves out, where there is git", (t) => {
  const { dir, put } = tree();
  try {
    for (const f of [...LEFT_OUT, "skills/sprue/examples/kit/.env.example", "skills/sprue/pipeline/.env.local"]) put(f);
    let listed: string;
    try {
      // Every file git would add, with no global excludes, which aren't the repo's.
      execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
      listed = execFileSync("git", ["-c", "core.excludesFile=", "ls-files", "--others", "--exclude-standard", "skills/sprue"], { cwd: dir, encoding: "utf8" });
    } catch {
      return t.skip("no git here");
    }
    const git = listed.split("\n").filter((f) => f && !f.startsWith("skills/sprue/examples/other/") && !f.endsWith(".test.ts"));
    assert.deepEqual(Object.keys(gateInputs(dir, "kit")), git.sort());
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

test("a refusal of the machine the gates ran on is not the product's, and the record holds none", () => {
  const refusal = (stage: string, ...outs: string[]): Gate[] => [{ stage, ok: false, ran: outs.map((out) => ({ cmd: "sprue x kit", out, ok: false })) }];
  // What the gates print when the exports here are of an earlier design, or a tool is missing.
  for (const out of [
    "  ✗ top: fab/top.stl: exported from an earlier design (design.json's params changed since): run sprue cad\n✗ accept: design not accepted: 3 problems above",
    "  ✗ pcb: pcb/kit-gerbers.zip: pcb/drc.json is of an earlier board (the board code changed): run sprue pcb",
    "no python3 to run the whole-product check: install Python 3, then python3 -m pip install -r skills/sprue/cad/requirements.txt",
    "CircuitPython is not in the cache and could not be fetched from adafruit (offline): connect to the internet once and run it again",
  ])
    assert.ok(localRefusal(refusal("design", "design proposed", out)), out);
  assert.equal(localRefusal(refusal("inspect", "  ✗ clearance: base-top is 0.15 mm from junction\n✗ inspect: 1 problem")), undefined);
  assert.equal(localRefusal([{ stage: "design", ok: true, ran: [{ cmd: "sprue accept kit", out: "run sprue cad", ok: true }] }]), undefined);
  const record = readRecord(root);
  for (const slug of slugs.filter((s) => record[s])) assert.equal(localRefusal(record[slug].gates), undefined, slug);
});

test("the exports check says when fab/ or pcb/ is of an earlier design", (t) => {
  const src = join(examples, "macropad");
  if (!existsSync(join(src, "fab")) || !existsSync(join(src, "pcb"))) return t.skip("no fab/ and pcb/ here: sprue cad macropad makes them");
  const dir = mkdtempSync(join(tmpdir(), "sprue-exports-"));
  try {
    cpSync(src, dir, { recursive: true });
    const probe = () =>
      execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(root, "scripts", "exports-current.mjs"), dir], { encoding: "utf8" }).trim();
    assert.equal(probe(), "", "the exports here are of the files there");
    appendFileSync(join(dir, "cad", "bottom.py"), "\n# an edit sprue cad has not made the exports of\n");
    assert.match(probe(), /^fab\/\S+\.stl: exported from an earlier design \(cad\/bottom\.py changed since\): run sprue cad$/);
    cpSync(join(src, "cad", "bottom.py"), join(dir, "cad", "bottom.py"));
    appendFileSync(join(dir, "cad", "pcb.mjs"), "\n// an edit sprue pcb has not made the board of\n");
    assert.equal(probe(), "pcb/ is of an earlier board: run sprue pcb");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

