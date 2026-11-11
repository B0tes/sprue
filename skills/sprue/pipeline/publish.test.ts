// `sprue publish`: what a bundle sends and leaves out, what the privacy scan refuses and lets through, the licence,
// entry.json's claims and cost, where --out may write, and the command on both worked examples, which publish clean.
//   node --test skills/sprue/pipeline/publish.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { exampleOf, isReportUrl, reportUrl } from "./gallery.ts";
import { bundle, bundleText, findLicence, outProblem, privacyFindings, spdxOf, writeBundle } from "./publish.ts";

const SKILL = join(import.meta.dirname, "..");
const SPRUE = join(SKILL, "bin", "sprue");
const EXAMPLES = join(SKILL, "examples");
const MIT = "MIT License\n\nCopyright (c) 2026 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n";

/** A temporary folder holding products/<slug> with the files given (a Buffer or a string each), and a LICENSE beside
 * products/ unless `licence` is false. */
function product(files: Record<string, string>, { slug = "lid", licence = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sprue-publish-"));
  const dir = join(root, "products", slug);
  mkdirSync(dir, { recursive: true });
  if (licence) writeFileSync(join(root, "LICENSE"), MIT);
  const base: Record<string, string> = {
    "request.json": JSON.stringify({ slug, brief: "A lid for a jar.", product: "Jar lid", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: {} }),
    "design.json": JSON.stringify({ slug, summary: "A lid", architecture: [], params: { wallMm: 2 } }),
    "bom.json": JSON.stringify({ slug, units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 1 }, file: "fab/lid.stl" }] }),
    ...files,
  };
  for (const [path, text] of Object.entries(base)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return { root, dir, slug };
}
const run = (cwd: string, ...args: string[]) => spawnSync(SPRUE, args, { cwd, encoding: "utf8" });
/** Every file under a folder by its sha256, to show that nothing in it changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out[path] = createHash("sha256").update(readFileSync(join(dir, path))).digest("hex");
      else out[path] = "link";
    }
  };
  walk("");
  return out;
}

test("the privacy scan finds emails, phone numbers, home paths and keys, with the line, and masks what it found", () => {
  const found = (text: string) => privacyFindings("f", text).map((f) => f.kind);
  assert.deepEqual(found("ask jane.doe@gmail.com for it"), ["an email address"]);
  assert.deepEqual(found("+39 06 1234 5678"), ["a phone number"]);
  assert.deepEqual(found("call +1 (555) 123-4567"), ["a phone number"]);
  assert.deepEqual(found("tel 555-123-4567"), ["a phone number"]);
  assert.deepEqual(found("tel (555) 123-4567"), ["a phone number"]);
  assert.deepEqual(found("+391234567890"), ["a phone number"]);
  assert.deepEqual(found('"file": "/Users/jane/cad/top.step"'), ["a home folder's path (a user name)"]);
  assert.deepEqual(found("# built in /home/bob/projects/lid"), ["a home folder's path (a user name)"]);
  assert.deepEqual(found("C:\\Users\\Ann\\Desktop"), ["a home folder's path (a user name)"]);
  assert.deepEqual(found('"C:\\\\Users\\\\Ann\\\\x"'), ["a home folder's path (a user name)"]);
  assert.deepEqual(found("DIGIKEY_CLIENT_SECRET=abcd1234efgh"), ["a key, token or password"]);
  assert.deepEqual(found('NEXAR_CLIENT_SECRET = "abc123xyz"'), ["a key, token or password"]);
  assert.deepEqual(found('{"api_key": "abcdef123456"}'), ["a key, token or password"]);
  assert.deepEqual(found("https://example.org/p?api_key=abcdef12"), ["a key, token or password in a link"]);
  assert.deepEqual(found(`const t = "ghp_${"a".repeat(36)}"`), ["a key or token"]);
  assert.deepEqual(found("AKIAABCDEFGHIJKLMNOP"), ["a key or token"]);
  assert.deepEqual(found("-----BEGIN RSA PRIVATE KEY-----"), ["a private key"]);
  // Each with its line, and only the start of what it found.
  const f = privacyFindings("design.md", "one\ntwo jane.doe@gmail.com\n");
  assert.deepEqual(f.map((x) => [x.file, x.line]), [["design.md", 2]]);
  assert.ok(!f[0].sample.includes("gmail"), f[0].sample);
  assert.ok(f[0].sample.endsWith("…"));
  const k = privacyFindings("x", "DIGIKEY_CLIENT_SECRET=abcd1234efgh")[0];
  assert.ok(!k.sample.includes("abcd1234"), k.sample);
});

test("the privacy scan lets a design's own words and numbers through", () => {
  const none = (text: string) => assert.deepEqual(privacyFindings("f", text), [], text);
  none("git@github.com:B0tes/sprue.git");
  none("noreply@anthropic.com");
  none("someone@example.com and a@b.example");
  none("12345678+someone@users.noreply.github.com");
  none('"capturedAt": "2026-10-13T19:36:56.903Z"');
  none("sku 90-2155, CF1/4W221JRC, 1528-1546-ND, 200MDP1T1B1M2QEH, 571-1-2199230-6");
  none("x = a +12 * b; y = +1.5; z = -0.4; offset = +0.25");
  none("version 1.2.3, 0.15 mm, 19.05 mm pitch, 3.3 V, 220 ohm");
  none("tuple(LENS_AT + _R @ (np.asarray(p, float) - LENS_HEAD))");
  none("@property\ndef x(self): pass");
  none("/Users/Shared/cad and /usr/home and C:\\Users\\Public\\x");
  none('DIGIKEY_CLIENT_SECRET = os.environ["DIGIKEY_CLIENT_SECRET"]');
  none("const secret = process.env.DIGIKEY_CLIENT_SECRET;");
  none("KEY_PITCH_MM = 19.05\nHOLE_KEY = 3\nkeyMap = {}");
  none("token = parts[0]\npassword field on the shop's form");
  none("https://jlcpcb.com/quote?orderType=1&stencil=0");
});

test("spdxOf names the licences a design is most often under, and no other", () => {
  assert.equal(spdxOf(MIT), "MIT");
  assert.equal(spdxOf("CERN Open Hardware Licence Version 2 - Strongly Reciprocal\n\nPreamble"), "CERN-OHL-S-2.0");
  assert.equal(spdxOf("CERN Open Hardware Licence Version 2 - Permissive\n"), "CERN-OHL-P-2.0");
  assert.equal(spdxOf("                                 Apache License\n                           Version 2.0, January 2004\n"), "Apache-2.0");
  assert.equal(spdxOf("Attribution-ShareAlike 4.0 International\n"), "CC-BY-SA-4.0");
  assert.equal(spdxOf("All rights reserved."), null);
});

test("a bundle sends the design's sources and leaves the rest out, by why", () => {
  const p = product({
    "design.md": "# Lid\n", "figure.mjs": "export default {}\n", "rules.ts": "export default []\n",
    "cad/lid.py": "print(1)\n", "cad/_params.py": "P = 1\n", "cad/pcb.mjs": "export default {}\n", "cad/notes.txt": "n\n",
    "cad/lib/k.py": "K = 1\n", "cad/__pycache__/lid.cpython-312.pyc": "x",
    "catalog.json": "{}", "sourcing.json": "{}", "quotes.json": "{}", "offers.digikey.json": "{}", "state.json": "{}",
    "checks.json": "{}", "score.json": "{}", "system.json": "{}", "faults.json": "{}", "explorer.json": "{}", "figure.svg": "<svg/>",
    "figure.json": "{}", "view.html": "<p>", "build-plan.md": "#", "fab/lid.stl": "solid", "fab/order/README.md": "#",
    "pcb/lid-gerbers.zip": "PK", "previews/lid.svg": "<svg/>", "production/x.csv": "a", "history/1.json": "{}",
    "shots/a.png": "png", "reference/faults.json": "{}", "firmware/fil.json": "{}", "firmware/code.sprue.py": "x",
    ".env": "DIGIKEY_CLIENT_SECRET=abcd1234efgh", "photo.jpg": "jpg",
  });
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.files.map((f) => f.path),
    ["LICENSE", "bom.json", "cad/_params.py", "cad/lid.py", "cad/pcb.mjs", "design.json", "design.md", "figure.mjs", "request.json", "rules.ts"]);
  assert.deepEqual(b.left.rebuilt, ["build-plan.md", "checks.json", "explorer.json", "fab/", "faults.json", "figure.json", "figure.svg", "pcb/", "previews/", "production/", "score.json", "system.json", "view.html"]);
  assert.deepEqual(b.left.never.map((x) => x.replace(/ \(.*$/, "")),
    [".env", "catalog.json", "firmware/code.sprue.py", "firmware/fil.json", "history/", "offers.digikey.json", "quotes.json", "reference/", "shots/", "sourcing.json", "state.json"]);
  assert.deepEqual(b.left.other, ["cad/lib/", "cad/notes.txt", "photo.jpg"]);
  // entry.json lists each file sent by its size and sha256, and nothing else.
  assert.deepEqual(Object.keys(b.entry.files), b.files.map((f) => f.path));
  assert.equal(b.entry.files["design.md"].sha256, `sha256:${createHash("sha256").update("# Lid\n").digest("hex")}`);
  assert.equal(b.entry.files["design.md"].bytes, 6);
  assert.match(b.entry.bundle, /^sha256:[0-9a-f]{64}$/);
  assert.match(b.entry.sprue.gates, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(b.entry.licence, { spdx: "MIT", file: "LICENSE" });
  assert.equal(b.entry.title, "Jar lid");
  // The secret in .env is never read, so it is not a problem: .env is never sent.
  assert.ok(!bundleText(b).includes("abcd1234"));
});

test("two bundles of the same files are the same, and the bundle id is of the sources only", () => {
  const p = product({ "design.md": "# Lid\n" });
  const a = bundle(p.dir, p.slug), b = bundle(p.dir, p.slug);
  assert.equal(JSON.stringify(a.entry), JSON.stringify(b.entry));
  assert.equal(bundleText(a), bundleText(b));
  // A run's record changes the claims, not the bundle id.
  writeFileSync(join(p.dir, "checks.json"), JSON.stringify({ slug: "lid", checks: [{ id: "x", status: "fail" }], failed: 1, flagged: 0 }));
  const c = bundle(p.dir, p.slug);
  assert.equal(c.entry.bundle, a.entry.bundle);
  assert.deepEqual(c.entry.claimed.checks, { ran: 1, failed: 1, flagged: 0 });
  // A source's change does.
  writeFileSync(join(p.dir, "design.md"), "# Lid, v2\n");
  assert.notEqual(bundle(p.dir, p.slug).entry.bundle, a.entry.bundle);
});

test("it refuses personal data in a sent file, naming the file and line", () => {
  const p = product({
    "design.md": "# Lid\n\nMail jane.doe@gmail.com for the STEP.\n",
    "cad/lid.py": "OUT = '/home/jane/lid'\n",
    "rules.ts": 'const DIGIKEY_CLIENT_SECRET = "abcd1234efgh";\n',
    "bom.json": JSON.stringify({ slug: "lid", units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { maker: "+39 333 123 4567" } }] }),
  });
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.problems.map((x) => x.replace(/ \(.*$/, "")), [
    "bom.json:1: a phone number", "cad/lid.py:1: a home folder's path", "design.md:3: an email address", "rules.ts:1: a key, token or password"]);
  for (const x of b.problems) assert.ok(!/gmail|jane\/lid|abcd1234|123 4567/.test(x), x);
});

test("it refuses firmware sprue pcb did not write, and leaves out the firmware it did", () => {
  const hand = product({ "firmware/code.py": "import board\nprint('mine')\n" });
  assert.match(bundle(hand.dir, hand.slug).problems.join("\n"), /firmware\/code\.py is not one sprue pcb wrote for lid: hand-written firmware isn't published/);
  // One sprue pcb wrote for another product is not this board's: refused too.
  const other = product({ "firmware/code.py": "# `sprue pcb macropad` wrote it\n" });
  assert.match(bundle(other.dir, other.slug).problems.join("\n"), /firmware\/code\.py is not one sprue pcb wrote for lid/);
  const own = product({ "firmware/code.py": "# `sprue pcb lid` wrote it\n", "firmware/README.md": "`sprue pcb lid` wrote it\n" });
  const b = bundle(own.dir, own.slug);
  assert.deepEqual(b.problems, []);
  assert.ok(!b.files.some((f) => f.path.startsWith("firmware/")));
  assert.deepEqual(b.left.rebuilt.filter((x) => x.startsWith("firmware/")).map((x) => x.replace(/ \(.*$/, "")), ["firmware/README.md", "firmware/code.py"]);
  // A README of the user's own, beside no firmware, is not a source: left out, not refused.
  const notes = product({ "firmware/README.md": "how I flash it\n" });
  assert.deepEqual(bundle(notes.dir, notes.slug).problems, []);
  assert.deepEqual(bundle(notes.dir, notes.slug).left.other, ["firmware/README.md"]);
});

test("it refuses a link where a source goes, never follows one, and needs request, design and bom", () => {
  const p = product({});
  const outside = mkdtempSync(join(tmpdir(), "sprue-publish-out-"));
  writeFileSync(join(outside, "secret.md"), "jane.doe@gmail.com\n");
  symlinkSync(join(outside, "secret.md"), join(p.dir, "design.md"));
  symlinkSync(outside, join(p.dir, "notes"));
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.problems.map((x) => x.replace(/ \(to .*$/, "")), ["design.md is a link"]);
  assert.deepEqual(b.left.never, ["notes (a link, never followed)"]);
  // A cad/ folder that is a link is refused whole.
  const q = product({});
  mkdirSync(join(outside, "cad"));
  writeFileSync(join(outside, "cad", "lid.py"), "x = 1\n");
  symlinkSync(join(outside, "cad"), join(q.dir, "cad"));
  assert.match(bundle(q.dir, q.slug).problems.join("\n"), /^cad is a link/);
  const r = product({});
  rmSync(join(r.dir, "bom.json"));
  assert.deepEqual(bundle(r.dir, r.slug).problems, ["there is no bom.json, so there is no design to publish yet: run sprue status lid to see what's next"]);
  const s = product({ "design.json": "{ not json" });
  assert.match(bundle(s.dir, s.slug).problems.join("\n"), /design\.json is not readable JSON/);
});

test("the licence is found in the product's folder or above it, and its absence is said, not refused", () => {
  const p = product({ LICENSE: "CERN Open Hardware Licence Version 2 - Strongly Reciprocal\n" });
  assert.equal(findLicence(p.dir)?.spdx, "CERN-OHL-S-2.0");
  assert.equal(bundle(p.dir, p.slug).entry.licence?.spdx, "CERN-OHL-S-2.0");
  const none = product({}, { licence: false });
  const b = bundle(none.dir, none.slug);
  assert.deepEqual(b.problems, []);
  assert.equal(b.entry.licence, null);
  assert.match(b.notes.join("\n"), /no LICENSE in the product's folder or the folders it is in/);
  const odd = product({ LICENSE: "All rights reserved, except as below.\n" });
  assert.match(bundle(odd.dir, odd.slug).notes.join("\n"), /Sprue can't tell which licence/);
  // A licence with an address in it is scanned like any file sent.
  const mail = product({ "LICENSE.md": `${MIT}\nContact: jane.doe@gmail.com\n` });
  assert.match(bundle(mail.dir, mail.slug).problems.join("\n"), /LICENSE\.md:7: an email address/);
});

test("claims and cost come from the records, and say when they are not of the files now", () => {
  const quotes = { slug: "lid", units: 2, batchUsd: 12.5, perUnitUsd: 6.25, longestLeadDays: 3, unquoted: [],
    lines: [{ lineId: "lid", supplier: "Craftcloud", sku: "x", mode: "estimate", orderQty: 2, orderUsd: 12.5, leadDays: 3, basis: "rate" }] };
  const p = product({
    "quotes.json": JSON.stringify(quotes),
    "catalog.json": JSON.stringify({ shipping: {}, offers: { lid: [{ supplier: "Craftcloud", sku: "x", capturedAt: "2026-10-14", priceBreaks: [] }, { supplier: "Other", sku: "y", capturedAt: "2026-01-01" }] } }),
    "score.json": JSON.stringify({ pass: false }),
  });
  const e = bundle(p.dir, p.slug).entry;
  assert.deepEqual({ ...e.cost, why: undefined }, { batchUsd: 12.5, units: 2, region: "US", includesEstimates: true, pricesRead: { from: "2026-10-14", to: "2026-10-14" }, current: false, why: undefined });
  assert.match(e.cost!.why!, /quotes\.json does not say what it was priced from/);
  assert.deepEqual(e.claimed.score, { pass: false });
  // The whole product: a made part with no cad/_system.py says so, as the score would.
  assert.equal(e.claimed.system?.ok, false);
  assert.match(e.claimed.system!.detail, /no cad\/_system\.py/);
  assert.equal(e.claimed.board, undefined);
  // No records at all: no claims, said plainly.
  const bare = product({});
  assert.match(bundleText(bundle(bare.dir, bare.slug)), /Claims, [^\n]*\n {2}the whole product: doesn't pass/);
});

test("it flags a product for children, and one with a camera or a microphone, from the request and the BOM", () => {
  const p = product({
    "request.json": JSON.stringify({ slug: "lid", brief: "A night light for a toddler's room.", product: "Night light", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: { userAgeMin: 3 } }),
    "bom.json": JSON.stringify({ slug: "lid", units: 1, lines: [
      { id: "cam", name: "Camera module", role: "camera", process: "buy", qtyPerUnit: 1, spec: {} },
      { id: "mic", name: "MEMS mic", role: "audio-in", process: "buy", qtyPerUnit: 1, spec: {} },
      { id: "led", name: "LED", role: "light", process: "buy", qtyPerUnit: 1, spec: {} }] }),
  });
  const e = bundle(p.dir, p.slug).entry;
  assert.deepEqual(e.flags?.map((f) => [f.kind, f.found]), [
    ["children", ["request.json constraints.userAgeMin: 3", 'request.json brief: "toddler"']],
    ["recording", ['bom.json line cam: "camera"', 'bom.json line mic: "mic"']]]);
  const plain = product({});
  assert.equal(bundle(plain.dir, plain.slug).entry.flags, undefined);
});

test("--out writes only outside the product and any git work tree, to a new or empty folder", () => {
  const p = product({});
  const skill = SKILL;
  const ok = (out: string) => outProblem(out, { product: p.dir, skill, cwd: p.root });
  assert.match(ok("products/lid/bundle") ?? "", /is in the product's folder/);
  assert.match(ok("products/x") ?? "", /is in products\//);
  assert.match(ok(join(SKILL, "examples", "x")) ?? "", /Sprue's own folder/);
  const fresh = join(mkdtempSync(join(tmpdir(), "sprue-out-")), "bundle");
  assert.equal(ok(fresh), undefined);
  const full = mkdtempSync(join(tmpdir(), "sprue-out-"));
  writeFileSync(join(full, "keep.txt"), "mine");
  assert.match(ok(full) ?? "", /is not empty/);
  assert.match(ok(join(full, "keep.txt")) ?? "", /is a file/);
  // The project the products are in is a git work tree: nothing in it.
  mkdirSync(join(p.root, ".git"));
  assert.match(ok(join(p.root, "out")) ?? "", /the git work tree at/);
  // Through a link into the product, too.
  const via = mkdtempSync(join(tmpdir(), "sprue-out-"));
  symlinkSync(p.dir, join(via, "here"));
  assert.match(ok(join(via, "here", "b")) ?? "", /is in the product's folder/);
});

test("sprue publish prints the bundle and changes nothing; --out writes it; a refusal writes nothing and exits 1", () => {
  const p = product({ "design.md": "# Lid\n", "checks.json": JSON.stringify({ slug: "lid", checks: [], failed: 0, flagged: 0 }) });
  const before = snapshot(p.root);
  const r = run(p.root, "publish", "lid");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^sprue publish lid: what a gallery entry of it would hold\. Print only/);
  assert.match(r.stdout, /\nentry\.json:\n\{\n {2}"format": 1,/);
  assert.deepEqual(snapshot(p.root), before);
  const out = join(mkdtempSync(join(tmpdir(), "sprue-out-")), "b");
  const w = run(p.root, "publish", "lid", "--out", out);
  assert.equal(w.status, 0, w.stderr);
  assert.deepEqual(snapshot(p.root), before);
  const entry = JSON.parse(readFileSync(join(out, "entry.json"), "utf8"));
  const sent = snapshot(out);
  delete sent["entry.json"];
  assert.deepEqual(Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, `sha256:${v}`])),
    Object.fromEntries(Object.entries(entry.files as Record<string, { sha256: string }>).map(([k, v]) => [k, v.sha256])));
  assert.match(w.stdout, /wrote 6 files to .* \(the 5 above and entry\.json\); nothing was uploaded/);
  // Refused: the reasons on stderr, nothing on stdout, nothing written.
  writeFileSync(join(p.dir, "design.md"), "jane.doe@gmail.com\n");
  const out2 = join(mkdtempSync(join(tmpdir(), "sprue-out-")), "b");
  const no = run(p.root, "publish", "lid", "--out", out2);
  assert.equal(no.status, 1);
  assert.equal(no.stdout, "");
  assert.match(no.stderr, /^sprue publish lid refuses, and writes nothing:\n {2}✗ design\.md:1: an email address/);
  assert.ok(!existsSync(out2));
  // Usage mistakes.
  writeFileSync(join(p.dir, "design.md"), "# Lid\n");
  assert.match(run(p.root, "publish", "lid", "--json").stderr, /unknown option --json; usage: sprue publish lid \[--out dir\]/);
  assert.match(run(p.root, "publish", "lid", "--out").stderr, /--out needs a folder/);
  assert.match(run(p.root, "publish", "lid", "extra").stderr, /unexpected extra/);
  assert.match(run(p.root, "publish", "lid", "--out", join(p.dir, "x")).stderr, /✗ --out .* is in the product's folder/);
  assert.ok(!existsSync(join(p.dir, "x")));
});

test("both worked examples publish clean, under 1 MB, with no run output, offer or price in them", () => {
  for (const slug of ["macropad", "ponder"]) {
    const dir = join(EXAMPLES, slug);
    const b = bundle(dir, slug);
    assert.deepEqual(b.problems, [], slug);
    assert.ok(b.files.reduce((s, f) => s + f.bytes, 0) < 1_000_000, slug);
    for (const f of b.files) assert.ok(/^(LICENSE|request\.json|design\.json|design\.md|bom\.json|figure\.mjs|rules\.ts|cad\/[^/]+\.(py|mjs))$/.test(f.path), f.path);
    assert.deepEqual(b.entry.licence, { spdx: "MIT", file: "LICENSE" }, slug);
    assert.equal(relative(dir, join(SKILL, "LICENSE")), "../../LICENSE");
    assert.equal(b.files.find((f) => f.path === "LICENSE")?.from, join(SKILL, "LICENSE"));
  }
  assert.equal(bundle(join(EXAMPLES, "macropad"), "macropad").entry.flags, undefined);
  assert.deepEqual(bundle(join(EXAMPLES, "ponder"), "ponder").entry.flags?.map((f) => f.kind), ["children", "recording"]);
});

test("writeBundle writes each file at its path and entry.json beside them", () => {
  const p = product({ "cad/lid.py": "x = 1\n" });
  const out = join(mkdtempSync(join(tmpdir(), "sprue-out-")), "b");
  mkdirSync(out);
  assert.deepEqual(writeBundle(bundle(p.dir, p.slug), out), ["LICENSE", "bom.json", "cad/lid.py", "design.json", "request.json", "entry.json"]);
  assert.equal(readFileSync(join(out, "cad", "lid.py"), "utf8"), "x = 1\n");
  assert.ok(statSync(join(out, "entry.json")).size > 0);
});

test("a build report links only from one of the skill's examples, or a copy of one", () => {
  const ex = mkdtempSync(join(tmpdir(), "sprue-examples-"));
  mkdirSync(join(ex, "lid"));
  writeFileSync(join(ex, "lid", "request.json"), JSON.stringify({ brief: "A lid for a jar." }));
  const copy = product({});
  assert.equal(exampleOf(copy.dir, "lid", ex), "lid");
  const mine = product({ "request.json": JSON.stringify({ brief: "My own lid." }) });
  assert.equal(exampleOf(mine.dir, "lid", ex), undefined);
  assert.equal(exampleOf(copy.dir, "other", ex), undefined);
  assert.equal(exampleOf(copy.dir, "../lid", ex), undefined);
  assert.equal(exampleOf(join(EXAMPLES, "macropad"), "macropad"), "macropad");
  assert.equal(reportUrl("macropad"), "https://github.com/B0tes/sprue/issues/new?template=build-report.yml&product=macropad");
  assert.ok(isReportUrl(reportUrl("ponder")));
  assert.ok(!isReportUrl("javascript:alert(1)"));
  assert.ok(!isReportUrl("https://github.com/someone/else/issues/new?template=build-report.yml&product=x"));
  assert.ok(!isReportUrl(`${reportUrl("x")}"><script>`));
});
