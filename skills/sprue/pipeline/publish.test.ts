// `sprue publish`: what a bundle sends and leaves out, what the privacy scan refuses and lets through, the licence,
// entry.json's claims and cost, where --out may write, and the command on both worked examples, which publish clean.
//   node --test skills/sprue/pipeline/publish.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { exampleOf, isReportUrl, reportUrl } from "./gallery.ts";
import { quoteInputs } from "./gates.ts";
import { inputsHash } from "./pcb/fresh.ts";
import { faultsInputs, systemInputs } from "./stages/score.ts";
import { bundle, bundleText, findLicence, importsOf, lex, outProblem, privacyFindings, scanImports, spdxOf, writeBundle } from "./publish.ts";

const SKILL = join(import.meta.dirname, "..");
const SPRUE = join(SKILL, "bin", "sprue");
const EXAMPLES = join(SKILL, "examples");
const MIT = "MIT License\n\nCopyright (c) 2026 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n";

/** Every temporary folder a test makes (some hold sample secrets), removed when the tests end. */
const temps: string[] = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};

/** A temporary folder holding products/<slug> with the files given (a Buffer or a string each), and a LICENSE beside
 * products/ unless `licence` is false. */
function product(files: Record<string, string | Buffer>, { slug = "lid", licence = true } = {}) {
  const root = temp("sprue-publish-");
  const dir = join(root, "products", slug);
  mkdirSync(dir, { recursive: true });
  if (licence) writeFileSync(join(root, "LICENSE"), MIT);
  const base: Record<string, string | Buffer> = {
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
    ["LICENSE", "bom.json", "cad/_params.py", "cad/lib/k.py", "cad/lid.py", "cad/pcb.mjs", "design.json", "design.md", "figure.mjs", "request.json", "rules.ts"]);
  assert.deepEqual(b.left.rebuilt, ["build-plan.md", "checks.json", "explorer.json", "fab/", "faults.json", "figure.json", "figure.svg", "pcb/", "previews/", "production/", "score.json", "system.json", "view.html"]);
  assert.deepEqual(b.left.never.map((x) => x.replace(/ \(.*$/, "")),
    [".env", "catalog.json", "firmware/code.sprue.py", "firmware/fil.json", "history/", "offers.digikey.json", "quotes.json", "reference/", "shots/", "sourcing.json", "state.json"]);
  // The CAD's code at any depth goes (a module cad/*.py imports); other files in cad/ are listed.
  assert.deepEqual(b.left.other, ["cad/notes.txt", "photo.jpg"]);
  // entry.json lists each file sent by its size and sha256, and nothing else.
  assert.deepEqual(Object.keys(b.entry.files), b.files.map((f) => f.path));
  assert.equal(b.entry.files["design.md"].sha256, `sha256:${createHash("sha256").update("# Lid\n").digest("hex")}`);
  assert.equal(b.entry.files["design.md"].bytes, 6);
  assert.match(b.entry.bundle, /^sha256:[0-9a-f]{64}$/);
  assert.match(b.entry.sprue.publishedWith, /^sha256:[0-9a-f]{64}$/);
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

test("it refuses firmware sprue pcb did not write for this board, and leaves out the firmware it did", () => {
  const hand = product({ "firmware/code.py": "import board\nprint('mine')\n" });
  assert.equal(bundle(hand.dir, hand.slug).problems.join("\n"),
    "firmware/code.py is not one sprue pcb wrote: hand-written firmware isn't published, since it could do anything on a builder's computer and no emulator run shows it doesn't. Move it out of the product (keep it elsewhere), then run sprue pcb lid to write the board's own");
  // With the board's own beside it (sprue pcb kept yours), the advice is to copy that over it.
  const beside = product({ "firmware/code.py": "print('mine')\n", "firmware/code.sprue.py": "# `sprue pcb lid` wrote it\n" });
  assert.match(bundle(beside.dir, beside.slug).problems.join("\n"), /, or copy firmware\/code\.sprue\.py over it$/);
  // One sprue pcb wrote for another product is not this board's, and sprue pcb lid keeps it: move it out first.
  const other = product({ "firmware/code.py": "# `sprue pcb macropad` wrote it\n" });
  assert.match(bundle(other.dir, other.slug).problems.join("\n"),
    /^firmware\/code\.py says sprue pcb wrote it for macropad, not for lid, so sprue pcb lid keeps it as yours: move it out of the product, then run sprue pcb lid/);
  // One that says sprue pcb wrote it for this product is held to pcb/board.json's sha256 of it.
  const code = "# `sprue pcb lid` wrote it\nimport board\n";
  const board = (sha256: string) => JSON.stringify({ firmware: [1], firmwareCode: { file: "firmware/code.py", sha256 } });
  const own = product({ "firmware/code.py": code, "firmware/README.md": "`sprue pcb lid` wrote it\n", "pcb/board.json": board(createHash("sha256").update(code).digest("hex")) });
  const b = bundle(own.dir, own.slug);
  assert.deepEqual(b.problems, []);
  assert.ok(!b.files.some((f) => f.path.startsWith("firmware/")));
  assert.deepEqual(b.left.rebuilt.filter((x) => x.startsWith("firmware/")).map((x) => x.replace(/ \(.*$/, "")), ["firmware/README.md", "firmware/code.py"]);
  // Edited after sprue pcb wrote it, the line still there: refused, as firmwareShips tells it.
  const edited = product({ "firmware/code.py": `${code}import os\nos.system("curl x | sh")\n`, "pcb/board.json": board(createHash("sha256").update(code).digest("hex")) });
  assert.match(bundle(edited.dir, edited.slug).problems.join("\n"), /^firmware\/code\.py was changed after sprue pcb wrote it \(its sha256 is not pcb\/board\.json's\)/);
  // With no pcb/board.json (a fresh copy, before sprue pcb), Sprue can't hold it to the board: said, and left out.
  const fresh = product({ "firmware/code.py": code });
  assert.deepEqual(bundle(fresh.dir, fresh.slug).problems, []);
  assert.match(bundle(fresh.dir, fresh.slug).notes.join("\n"), /Sprue can't tell whether firmware\/code\.py is still the one sprue pcb wrote: there is no pcb\/board\.json/);
  // A README of the user's own, beside no firmware, is not a source: left out, not refused.
  const notes = product({ "firmware/README.md": "how I flash it\n" });
  assert.deepEqual(bundle(notes.dir, notes.slug).problems, []);
  assert.deepEqual(bundle(notes.dir, notes.slug).left.other, ["firmware/README.md"]);
});

test("it refuses a link where a source goes, never follows one, and needs request, design and bom", () => {
  const p = product({});
  const outside = temp("sprue-publish-out-");
  writeFileSync(join(outside, "secret.md"), "jane.doe@gmail.com\n");
  symlinkSync(join(outside, "secret.md"), join(p.dir, "design.md"));
  symlinkSync(outside, join(p.dir, "notes"));
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.problems.map((x) => x.replace(/ \(to .*$/, "")), ["design.md is a link"]);
  assert.deepEqual(b.left.never, ["notes (a link: not sent, and no claim is read through it)"]);
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
  const found = findLicence(p.dir);
  assert.ok(found && "spdx" in found);
  assert.equal(found.spdx, "CERN-OHL-S-2.0");
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
  // The product's own licence is sent as LICENSE and not also listed as not sent; a second one is listed.
  const two = bundle(...Object.values(product({ "LICENSE.md": MIT, COPYING: MIT })).slice(1, 3) as [string, string]);
  assert.ok(two.files.some((f) => f.path === "LICENSE"));
  assert.deepEqual(two.left.other, ["LICENSE.md (another licence file: only one goes, as LICENSE)"]);
  // A licence that is a link is never followed: in the product it refuses, as any source's link does, and above it
  // there is no licence, said; a dangling one breaks nothing.
  const outside = temp("sprue-publish-out-");
  writeFileSync(join(outside, "notes.txt"), `${MIT}\nPRIVATE NOTES FROM OUTSIDE THE PRODUCT\n`);
  for (const name of ["LICENSE.md", "COPYING", "license"]) {
    const q = product({}, { licence: false });
    symlinkSync(join(outside, "notes.txt"), join(q.dir, name));
    const b = bundle(q.dir, q.slug);
    assert.deepEqual(b.problems.map((x) => x.replace(/ \(to .*$/, "")), [`${name} is a link`], name);
    assert.ok(!b.files.some((f) => f.path === "LICENSE"), name);
  }
  const up = product({}, { licence: false });
  symlinkSync(join(outside, "notes.txt"), join(up.root, "LICENSE"));
  const ub = bundle(up.dir, up.slug);
  assert.deepEqual(ub.problems, []);
  assert.equal(ub.entry.licence, null);
  assert.ok(!ub.files.some((f) => f.path === "LICENSE"));
  assert.match(ub.notes.join("\n"), /the licence at .*LICENSE is a link, which a bundle never follows, so no licence is sent/);
  const dangling = product({}, { licence: false });
  symlinkSync(join(outside, "gone"), join(dangling.dir, "LICENSE"));
  assert.deepEqual(bundle(dangling.dir, dangling.slug).problems.map((x) => x.replace(/ \(to .*$/, "")), ["LICENSE is a link"]);
});

test("claims and cost come from the records, and say when they are not of the files now", () => {
  const quotes = { slug: "lid", units: 2, batchUsd: 12.5, perUnitUsd: 6.25, longestLeadDays: 3, unquoted: [],
    lines: [{ lineId: "lid", supplier: "Craftcloud", sku: "x", mode: "estimate", orderQty: 2, orderUsd: 12.5, leadDays: 3, basis: "rate" }] };
  const p = product({
    "quotes.json": JSON.stringify(quotes),
    "catalog.json": JSON.stringify({ shipping: {}, offers: { lid: [{ supplier: "Craftcloud", sku: "x", capturedAt: "2026-10-14", priceBreaks: [] }, { supplier: "Other", sku: "y", capturedAt: "2026-01-01" }] } }),
    "score.json": JSON.stringify({ pass: false }),
  });
  const pb = bundle(p.dir, p.slug), e = pb.entry;
  assert.deepEqual({ ...e.cost, why: undefined }, { batchUsd: 12.5, units: 2, region: "US", includesEstimates: true, pricesRead: { from: "2026-10-14", to: "2026-10-14" }, current: false, complete: false, why: undefined });
  assert.equal(e.cost!.why, "stale");
  assert.match(pb.said.cost!, /quotes\.json does not say what it was priced from/);
  assert.deepEqual(e.claimed.score, { pass: false, state: "fails" });
  // The whole product: a made part with no cad/_system.py says so, as the score would; entry.json has one word for it,
  // and the record's own words are for the terminal.
  assert.deepEqual(e.claimed.system, { ok: false, state: "not run" });
  assert.match(pb.said.system!, /no cad\/_system\.py/);
  assert.match(bundleText(pb), /the whole product: not run: no cad\/_system\.py/);
  assert.equal(e.claimed.board, undefined);
  // A quote of the files as they are that leaves a line unpriced and a shop's shipping out is not the whole order: no
  // "within the budget" then. Malformed offers and line ids break nothing.
  const offer = { supplier: "Shop", sku: "s1", url: "https://shop.example.com/s1", leadDays: 3, source: "snapshot", stock: "in stock", priceBreaks: [{ qty: 1, unitUsd: 0.25 }], capturedAt: "2026-10-01T00:00:00Z" };
  const q = product({
    "request.json": JSON.stringify({ slug: "lid", brief: "A bracket.", product: "Bracket", units: 1, region: "US", budgetUsd: 20, mustHave: [], niceToHave: [], constraints: {} }),
    "bom.json": JSON.stringify({ slug: "lid", units: 1, lines: [
      { id: "screw", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 6, spec: {} },
      { id: "bracket", name: "Bracket", role: "bracket", process: "cnc", qtyPerUnit: 1, spec: { material: "6061" }, file: "fab/bracket.step" }] }),
    "catalog.json": JSON.stringify({ shipping: {}, offers: { screw: [offer] } }),
  });
  writeFileSync(join(q.dir, "quotes.json"), JSON.stringify({ slug: "lid", units: 1, batchUsd: 1.5, perUnitUsd: 1.5, longestLeadDays: 3, unquoted: ["bracket"], noShipping: ["Shop"],
    lines: [{ lineId: "screw", supplier: "Shop", sku: "s1", mode: "snapshot", orderQty: 6, orderUsd: 1.5, leadDays: 3, basis: "snapshot" }],
    inputs: quoteInputs(q.dir) }));
  const qb = bundle(q.dir, q.slug);
  assert.deepEqual(qb.problems, []);
  assert.equal(qb.entry.cost?.current, true, JSON.stringify(qb.entry.cost));
  assert.equal(qb.entry.cost?.complete, false);
  // Why, in a word; the reason's own words (which can quote catalog.json), for the terminal only.
  assert.equal(qb.entry.cost!.why, "incomplete");
  assert.match(qb.said.cost!, /bracket \(Bracket\) has no price/);
  assert.match(qb.said.cost!, /shipping has no figure for Shop/);
  assert.doesNotMatch(qb.said.cost!, /NaN/);
  assert.match(bundleText(qb), /cost: \$1\.50 for 1 unit \(US\); prices read 2026-10-01; not the whole order: /);
  assert.doesNotMatch(bundleText(qb), /within the \$20\.00 budget/);
  // A catalog keyed "__proto__" and a quote line "constructor" are read as data, not as an object's own parts.
  const odd = product({
    "catalog.json": '{"shipping": {}, "offers": {"__proto__": [{"supplier": "S", "sku": "x", "capturedAt": "2026-10-02"}], "constructor": "x"}}',
    "quotes.json": JSON.stringify({ slug: "lid", units: 1, batchUsd: 1, lines: [{ lineId: "constructor", supplier: "S", sku: "x" }, { lineId: "__proto__", supplier: "S", sku: "x" }, null] }),
  });
  assert.equal(bundle(odd.dir, odd.slug).entry.cost?.pricesRead?.from, "2026-10-02");
  // No records at all: no claims, said plainly.
  const bare = product({});
  assert.match(bundleText(bundle(bare.dir, bare.slug)), /Claims, [^\n]*\n {2}the whole product: not run: no cad\/_system\.py/);
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
    ["recording", ['bom.json line cam: "camera"', 'bom.json line mic: "audio-in"']]]);
  const plain = product({});
  assert.equal(bundle(plain.dir, plain.slug).entry.flags, undefined);
  // Cameras and microphones by their usual parts' names, and not a screw for a camera's plate or a child lock.
  const flagsOf = (brief: string, lines: object[]) => bundle(...Object.values(product({
    "request.json": JSON.stringify({ slug: "lid", brief, product: "Thing", units: 1, region: "US", mustHave: [], niceToHave: [], constraints: {} }),
    "bom.json": JSON.stringify({ slug: "lid", units: 1, lines: lines.map((l, k) => ({ id: `l${k}`, process: "buy", qtyPerUnit: 1, spec: {}, ...l })) }),
  })).slice(1, 3) as [string, string]).entry.flags?.map((f) => f.found.join("; ")) ?? [];
  assert.deepEqual(flagsOf("A doorbell.", [{ name: "ESP32-CAM board", role: "controller" }]), ['bom.json line l0: "ESP32-CAM"']);
  assert.deepEqual(flagsOf("A doorbell.", [{ name: "USB webcam", role: "sensor" }]), ['bom.json line l0: "webcam"']);
  assert.deepEqual(flagsOf("A doorbell.", [{ name: "Sensor", role: "sensor", spec: { mpn: "OV2640" } }]), ['bom.json line l0: "OV2640"']);
  assert.deepEqual(flagsOf("A doorbell.", [{ name: "INMP441 module", role: "sensor" }]), ['bom.json line l0: "INMP441"']);
  assert.deepEqual(flagsOf("A mount.", [{ name: "Camera plate screw", role: "fastener" }]), []);
  assert.deepEqual(flagsOf("A cabinet with a child lock.", []), []);
  assert.deepEqual(flagsOf("A child-resistant cap.", []), []);
  assert.deepEqual(flagsOf("A Toyota key fob, with a microcontroller and a dynamic display.", [{ name: "MIC5219 regulator", role: "power" }]), []);
});

test("--out writes only outside the product and any git work tree, to a new or empty folder", () => {
  const p = product({});
  const skill = SKILL;
  const ok = (out: string) => outProblem(out, { product: p.dir, skill, cwd: p.root });
  assert.match(ok("products/lid/bundle") ?? "", /is in the product's folder/);
  assert.match(ok("products/x") ?? "", /is in products\//);
  assert.match(ok(join(SKILL, "examples", "x")) ?? "", /Sprue's own folder/);
  const fresh = join(temp("sprue-out-"), "bundle");
  assert.equal(ok(fresh), undefined);
  const full = temp("sprue-out-");
  writeFileSync(join(full, "keep.txt"), "mine");
  assert.match(ok(full) ?? "", /is not empty/);
  assert.match(ok(join(full, "keep.txt")) ?? "", /is a file/);
  // The project the products are in is a git work tree: nothing in it.
  mkdirSync(join(p.root, ".git"));
  assert.match(ok(join(p.root, "out")) ?? "", /the git work tree at/);
  // Through a link into the product, too.
  const via = temp("sprue-out-");
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
  const out = join(temp("sprue-out-"), "b");
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
  const out2 = join(temp("sprue-out-"), "b");
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
  const out = join(temp("sprue-out-"), "b");
  mkdirSync(out);
  assert.deepEqual(writeBundle(bundle(p.dir, p.slug), out), ["LICENSE", "bom.json", "cad/lid.py", "design.json", "request.json", "entry.json"]);
  assert.equal(readFileSync(join(out, "cad", "lid.py"), "utf8"), "x = 1\n");
  assert.ok(statSync(join(out, "entry.json")).size > 0);
});

test("a build report links only from one of the skill's examples, or a copy of one", () => {
  const ex = temp("sprue-examples-");
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

test("the scan finds the usual shapes of keys, passwords, phone numbers and home folders, after an escape too", () => {
  const found = (text: string, file = "f") => privacyFindings(file, text).map((f) => f.kind);
  const key = "a key, token or password", token = "a key or token", phone = "a phone number", home = "a home folder's path (a user name)";
  for (const line of ['wifi_password = "MyHomeWifi2024"', '"wifiPassword": "MyHomeWifi2024"', 'mqtt_password = "Sup3rS3cret!"', "password: Sup3rS3cret!",
    '"password": "correct horse battery staple"', "api_key=abcd1234efgh5678", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG", 'AIO_KEY = "abcdEFGH1234ijklMNOP5678"',
    "SUPABASE_SERVICE_ROLE_KEY=abcdefgh12345678abcdefgh"])
    assert.deepEqual(found(line), [key], line);
  for (const line of [`sk-proj-${"Ab1".repeat(16)}`, `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${"a".repeat(20)}`, `glpat-${"x".repeat(20)}`,
    `sk_live_${"a1".repeat(12)}`, `aio_${"aB3".repeat(8)}`, `Authorization: Bearer ${"a1B2".repeat(6)}`])
    assert.deepEqual(found(line), [token], line);
  assert.deepEqual(found("-----BEGIN PGP PRIVATE KEY BLOCK-----"), ["a private key"]);
  for (const line of ["Cell: 333 123 4567", "Tel. 06 1234 5678", "Mobil 0176 1234 5678", "phone 0044 7700 900123", "call me: 415 555 0132", "1-415-555-0132", "07700 900123", "0049 176 12345678", "333 1234567"])
    assert.deepEqual(found(line), [phone], line);
  for (const line of ["/mnt/c/Users/Tobias/Downloads/ds.pdf", "/var/home/tobias/keypad", "/cygdrive/c/Users/Tobias/x", "/c/Users/Tobias/x", "/usr/home/tobias/x", "/Volumes/Macintosh HD/Users/tobias/x"])
    assert.deepEqual(found(line), [home], line);
  // Right after a \n or \t escape in a JSON, JS or Python string.
  for (const [line, kind] of [['"x": "call\\n+39 333 123 4567"', phone], ['"f": "from\\n/Users/jane/cad"', home], ['"t": "x\\t555-123-4567"', phone],
    ['"e": "a\\nDIGIKEY_CLIENT_SECRET=abcd1234efgh"', key], [`"g": "\\nghp_${"a".repeat(36)}"`, token], ['"k": "\\nAKIAABCDEFGHIJKLMNOP"', token],
    ['"p": "C:\\\\Users\\\\nancy\\\\x"', home]] as const)
    assert.deepEqual(found(line), [kind], line);
  // A link with a password in it: named as one, and only its scheme shown.
  const link = privacyFindings("f", "mqtt://keypad:Sup3rS3cret@192.168.1.20:1883 and https://tobias:hunter2pass@github.com/x.git");
  assert.deepEqual(link.map((f) => [f.kind, f.sample]), [["a password in a link", "mqtt://…"]]);
  assert.ok(!JSON.stringify(privacyFindings("f", "https://tobias:hunter2pass@github.com/x.git")).includes("hunt"));
});

test("the scan lets code, data and the usual placeholders through, and takes linear time on a long line", () => {
  const none = (text: string, file = "f") => assert.deepEqual(privacyFindings(file, text), [], text);
  none("p = R@np.array([0, 0, 1])", "cad/x.py");
  none("tip = pose@self.offset", "cad/x.py");
  none("world = M@pts.transpose()", "cad/_system.py");
  none("token: string;\nconst tokenCount = 3;\npassword = getpass()\napi_key = os.environ['API_KEY']", "rules.ts");
  none('api_key = "YOUR_API_KEY"\nsecret = "<your secret>"');
  none('"capturedAt": "2026-10-13T19:36:56.903Z", "qty": 100, "unitUsd": 0.25');
  none("0.15 mm, 2026-11-11, 19.05 mm pitch, M3x8, 3.3 V, 1000 pcs");
  // An address in code still counts when it is one.
  assert.deepEqual(privacyFindings("cad/x.py", "# ask jane.doe@gmail.com").map((f) => f.kind), ["an email address"]);
  for (const line of ["A".repeat(60_000).replace(/A/g, (_, i) => "Ab1_-."[i % 6]), `+${"1".repeat(200_000)}`, "+1".repeat(100_000), `${"a".repeat(100_000)}@`, "0".repeat(100_000), "3 ".repeat(50_000)]) {
    const t = performance.now();
    privacyFindings("f", line);
    assert.ok(performance.now() - t < 2000, `${line.slice(0, 12)}…: ${Math.round(performance.now() - t)} ms`);
  }
});

test("a source that is not UTF-8 text, or UTF-16 with no BOM, is refused, since the scan can't read it", () => {
  const latin = product({ "design.md": Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]) });
  assert.match(bundle(latin.dir, latin.slug).problems.join("\n"), /^design\.md is not text \(UTF-8\)/);
  const wide = product({ "design.md": Buffer.from("Made for jane.doe@gmail.com\n", "utf16le") });
  assert.match(bundle(wide.dir, wide.slug).problems.join("\n"), /^design\.md is not text \(UTF-8\)/);
});

test("entry.json holds each claim as one word, never a record's text, and no claim is read through a link", () => {
  const p = product({ "cad/_system.py": "# check\n", "cad/lid.py": "x = 1\n" });
  writeFileSync(join(p.dir, "system.json"), JSON.stringify({ slug: "lid", ok: true, inputs: systemInputs(p.dir), gates: [], selfTest: { ok: true } }));
  // A file added under cad/ after the check makes it stale, and its name (a person's) is in the check's own words.
  mkdirSync(join(p.dir, "cad", "ref"));
  writeFileSync(join(p.dir, "cad", "ref", "Jane Doe desk photo.jpg"), "jpg");
  writeFileSync(join(p.dir, "score.json"), JSON.stringify({ pass: true }));
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.entry.claimed.system, { ok: false, state: "stale" });
  assert.match(b.said.system!, /Jane Doe desk photo\.jpg/);
  assert.ok(!JSON.stringify(b.entry).includes("Jane Doe"));
  // The score's pass is held to the whole product as it is now: score.json's PASS is stale.
  assert.deepEqual(b.entry.claimed.score, { pass: false, state: "stale" });
  assert.match(bundleText(b), /score: score\.json says PASS, but not of the whole product and the quote as they are now: run sprue all/);
  // A record that is a link lends no claim.
  const q = product({});
  const elsewhere = temp("sprue-publish-out-");
  writeFileSync(join(elsewhere, "score.json"), JSON.stringify({ pass: true }));
  writeFileSync(join(elsewhere, "checks.json"), JSON.stringify({ checks: [{ id: "a", status: "pass" }] }));
  symlinkSync(join(elsewhere, "score.json"), join(q.dir, "score.json"));
  symlinkSync(join(elsewhere, "checks.json"), join(q.dir, "checks.json"));
  const qb = bundle(q.dir, q.slug);
  assert.equal(qb.entry.claimed.score, undefined);
  assert.equal(qb.entry.claimed.checks, undefined);
  assert.match(qb.notes.join("\n"), /checks\.json is a link, so no claim is read from it/);
  // A faults.json missing its counts says what it can, never "undefined".
  const f = product({ "reference/faults.json": "[]", "faults.json": '{"ok": true}' });
  const fb = bundle(f.dir, f.slug);
  assert.equal(fb.entry.claimed.faults?.ran, undefined);
  assert.ok(!bundleText(fb).includes("undefined"));
  // The stage is a word from state.json or nothing; what entry.json copies from a sent file (the brief) is reported
  // once, by the file.
  const s = product({ "state.json": JSON.stringify({ stage: "/home/jane/x", stages: {} }) });
  assert.equal(bundle(s.dir, s.slug).entry.stage, undefined);
  assert.deepEqual(bundle(s.dir, s.slug).problems, []);
  const w = product({ "state.json": JSON.stringify({ stage: "build", stages: { build: { status: "jane@gmail.com" } } }) });
  assert.deepEqual(bundle(w.dir, w.slug).entry.stage, { stage: "build" });
  const brief = product({ "request.json": JSON.stringify({ slug: "lid", brief: "Mail jane.doe@gmail.com", product: "Lid", units: 1, region: "US", constraints: {} }) });
  assert.deepEqual(bundle(brief.dir, brief.slug).problems.map((x) => x.replace(/ \(.*$/, "")), ["request.json:1: an email address"]);
});

test("every module the board's code imports must be one the bundle sends", () => {
  // pcb/drc.json as sprue pcb writes it: of the board as it is now.
  const withDrc = (files: Record<string, string>, modules: string[]) => {
    const p = product(files);
    mkdirSync(join(p.dir, "pcb"));
    const reads = { design: [], bom: [], modules };
    writeFileSync(join(p.dir, "pcb", "drc.json"), JSON.stringify({ inputs: inputsHash(p.dir, reads), reads }));
    return p;
  };
  const out = product({ "cad/pcb.mjs": "export default {}\n" });
  mkdirSync(join(out.root, "shared"));
  writeFileSync(join(out.root, "shared", "layout.json"), "{}");
  mkdirSync(join(out.dir, "pcb"));
  const reads = { design: [], bom: [], modules: ["../../shared/layout.json", "cad/pcb.mjs"] };
  writeFileSync(join(out.dir, "pcb", "drc.json"), JSON.stringify({ inputs: inputsHash(out.dir, reads), reads }));
  assert.deepEqual(bundle(out.dir, out.slug).problems, ["the board's code imports ../../shared/layout.json, outside the product, which a bundle doesn't send: move it into cad/ and import it from there"]);
  const top = withDrc({ "cad/pcb.mjs": "export default {}\n", "layout.json": "{}" }, ["cad/pcb.mjs", "layout.json"]);
  assert.match(bundle(top.dir, top.slug).problems.join("\n"), /^the board's code imports layout\.json, which a bundle doesn't send/);
  const inCad = withDrc({ "cad/pcb.mjs": "export default {}\n", "cad/layout.json": "{}" }, ["cad/layout.json", "cad/pcb.mjs"]);
  const b = bundle(inCad.dir, inCad.slug);
  assert.deepEqual(b.problems, []);
  assert.ok(b.files.some((f) => f.path === "cad/layout.json"));
});

test("--out is refused in any git work tree and under a file; a path is no product's name", () => {
  const p = product({});
  const other = temp("sprue-out-");
  mkdirSync(join(other, ".git"));
  assert.match(outProblem(join(other, "bundle"), { product: p.dir, skill: SKILL, cwd: p.root }) ?? "", /is in the git work tree at /);
  const file = join(temp("sprue-out-"), "f");
  writeFileSync(file, "x");
  assert.match(outProblem(join(file, "b"), { product: p.dir, skill: SKILL, cwd: p.root }) ?? "", /is under a file/);
  const r = run(p.root, "publish", "../products/lid");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.\.\/products\/lid is not a product's name/);
});

test("--out writes the bytes that were scanned, even when a file changes after", () => {
  const p = product({ "design.md": "# Lid\n" });
  const b = bundle(p.dir, p.slug);
  writeFileSync(join(p.dir, "design.md"), "jane.doe@gmail.com\n");
  const out = join(temp("sprue-out-"), "b");
  writeBundle(b, out);
  assert.equal(readFileSync(join(out, "design.md"), "utf8"), "# Lid\n");
});

test("spdxOf tells MIT No Attribution from MIT", () => {
  assert.equal(spdxOf("MIT No Attribution\n\nCopyright 2026 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this\nsoftware"), "MIT-0");
  assert.equal(spdxOf("Permission is hereby granted, free of charge, to any person obtaining a copy of this software, and that is all."), null);
  assert.equal(spdxOf("Copyright x\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n...\nThe above copyright notice and this permission notice shall be included in all copies"), "MIT");
});

test("only the form itself is a build report's link: no other parameter, template or repo", () => {
  for (const bad of [`${reportUrl("x")}&template=other.yml`, `${reportUrl("x")}&title=Spam&labels=bug`, `${reportUrl("x")}#x`, reportUrl("a/b"), reportUrl("")])
    assert.ok(!isReportUrl(bad), bad);
});

test("the scan lets a design's own numbers through: part numbers, footprints, angles, cells, coordinates", () => {
  const none = (text: string, file = "design.md") => assert.deepEqual(privacyFindings(file, text), [], text);
  for (const line of ['"mpn": "0022232031"', "Molex KK 254 3-pin header, MPN 0039012040", '"ean": "0012345678905"', '"sku": "001-0001-1234"',
    "Footprints: 0402 0603 0805", "Cell: 18650 3500 mAh", "cell 2: 3.7 V", "steps 300 450 1200", "lat +45.123456, lon +9.187123", "3 speeds: 300 450 1200 rpm"])
    none(line);
  for (const line of ["TILT_DEG = 352.456789", '{"angle": 345.123456}', "p = (12.5, 330.125000)"]) none(line, "cad/_params.py");
  // Each still finds the number it is for.
  const phone = (line: string) => assert.deepEqual(privacyFindings("design.md", line).map((f) => f.kind), ["a phone number"], line);
  for (const line of ["0044 7700 900123", "0039 333 1234567", "333.123.4567", "Tel. 06 1234 5678", "Cell: 333 123 4567", "+39 333 123 4567", "+1 (415) 555-0132", "(415) 555-0132", "415.555.0132"])
    phone(line);
});

test("the scan reads a number spaced with Unicode's spaces, as typed or escaped", () => {
  const phone = (line: string) => assert.deepEqual(privacyFindings("f", line).map((f) => f.kind), ["a phone number"], JSON.stringify(line));
  for (const sp of [" ", " ", " "]) {
    phone(`Call me on +39${sp}333${sp}123${sp}4567`);
    phone(`Tel.${sp}06${sp}1234${sp}5678`);
    phone(`+33${sp}6${sp}12${sp}34${sp}56${sp}78`);
  }
  phone("+49 176‐12345678");
  phone('{"brief": "Ring me on +39\\u00a0333\\u00a0123\\u00a04567"}');
  phone("'call me on +39\\x20333 123 4567'");
});

test("the scan finds a password in Markdown, in a template or byte string, and under a pass or psk name", () => {
  const key = (line: string, file = "f") => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a key, token or password"], line);
  for (const line of ["- **Password:** Sup3rS3cret!", "- Wi-Fi password: `HomeWifi2024`", "| WiFi password | Sup3rS3cret! |", "**password**: Sup3rS3cret!"]) key(line, "design.md");
  for (const line of ["const WIFI_PASS = `MyHomeWifi2024`;", "const apiKey = `abcd1234efgh5678ijkl`;", 'WIFI_PASS = "MyHomeWifi2024"', 'wifi_pass = "MyHomeWifi2024"',
    'const wifiPass = "MyHomeWifi2024";', 'WIFI_PSK = "MyHomeWifi2024"']) key(line, "figure.mjs");
  for (const line of ["PASSWORD = b'Sup3rS3cret!'", "password = f'Sup3rS3cret{1}'", 'password = """Sup3rS3cret!"""', "SECRET = r'abc\\d123xyz'"]) key(line, "cad/x.py");
  // Not a password: another word's end (compass, bypass), a placeholder, a milling pass's name, code.
  for (const line of ['compass = "north-east-12"', 'bypass_valve = "open-circuit-3"', 'first_pass = "rough-cut-01"', 'WIFI_PASS = os.environ["WIFI_PASS"]',
    "WIFI_PASS = `${process.env.WIFI_PASS}`", "passes = 3", "pass"])
    assert.deepEqual(privacyFindings("cad/x.py", line), [], line);
});

test("the scan lets a Raspberry Pi's own account, a .local host, an image at 2x and ids in code through", () => {
  const none = (text: string, file = "design.md") => assert.deepEqual(privacyFindings(file, text), [], text);
  none("ssh pi@ponder.local, copy tutor.py to /home/pi/ponder/ and enable the service.");
  none("user@arduino.local, admin@router.lan, /home/ubuntu/x, /home/runner/work");
  none("![top](shots/top@2x.png)");
  none('"image": "previews/top@2x.png"', "design.json");
  for (const line of ['const stepKey = "step-03-insert-switches";', 'partKey: "switch-row-1-col-2-cherry"', 'sortKey = "bom-line-order-2026-v1"', 'const colorToken = "accent-blue-500"'])
    none(line, "figure.mjs");
  // A random or hex value under such a name is still a key: a UUID, letters and digits.
  for (const line of ['const apiKey = "550e8400-e29b-41d4-a716-446655440000";', 'const apiKey = "abcd1234efgh5678ijkl";'])
    assert.deepEqual(privacyFindings("figure.mjs", line).map((f) => f.kind), ["a key, token or password"], line);
  // /home/<name> is still a person's.
  assert.deepEqual(privacyFindings("design.md", "/home/tobias/keypad").map((f) => f.kind), ["a home folder's path (a user name)"]);
});

test("in code, an address in a comment or a string is found whatever its domain; a matrix product is not one", () => {
  const email = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["an email address"], line);
  email("# Author: Tobias Benetton <tobias@benetton.family>", "cad/top.py");
  email("# contact tobias@posteo.berlin", "cad/top.py");
  email("AUTHOR = 'tobias@benetton.family'", "cad/top.py");
  email("// jane@doe.art", "figure.mjs");
  for (const line of ["p = R@np.array([0, 0, 1])", "tip = pose@self.offset", "world = M@pts.transpose()"]) assert.deepEqual(privacyFindings("cad/x.py", line), [], line);
});

test("a licence that is not UTF-8 text is refused like any source", () => {
  const p = product({ LICENSE: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("MIT License\nCopyright (c) 2026 Jane Doe <jane.doe@gmail.com>\n", "utf16le")]) }, { licence: false });
  assert.match(bundle(p.dir, p.slug).problems.join("\n"), /LICENSE is not text \(UTF-8\)/);
  const q = product({ LICENSE: Buffer.from("MIT License\nCopyright (c) 2026 Jane <jane.doe@gmail.com>\n", "utf16le") }, { licence: false });
  assert.match(bundle(q.dir, q.slug).problems.join("\n"), /LICENSE is not text \(UTF-8\)/);
});

test("the score is a pass only with the quote it was scored on still of these files, and never through a link", () => {
  // A product of bought parts with no seeded faults: score.json's PASS rests on the quote alone.
  const bought = JSON.stringify({ slug: "lid", units: 1, lines: [{ id: "screw", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 1, spec: {} }] });
  const p = product({ "bom.json": bought, "score.json": '{"pass": true, "cost": {"batchUsd": 1}}' });
  const quote = (batchUsd: number) => JSON.stringify({ slug: "lid", units: 1, batchUsd, perUnitUsd: batchUsd, longestLeadDays: 1, unquoted: [], noShipping: [], lines: [], inputs: quoteInputs(p.dir) });
  writeFileSync(join(p.dir, "quotes.json"), quote(1));
  assert.deepEqual(bundle(p.dir, p.slug).entry.claimed.score, { pass: true, state: "passes" });
  // sprue quote again after a catalog edit: quotes.json is of the files now, but not the quote score.json was scored on.
  writeFileSync(join(p.dir, "quotes.json"), quote(10));
  assert.deepEqual(bundle(p.dir, p.slug).entry.claimed.score, { pass: false, state: "stale" });
  assert.match(bundleText(bundle(p.dir, p.slug)), /score: score\.json says PASS, but not of the quote as it is now: run sprue all/);
  writeFileSync(join(p.dir, "quotes.json"), quote(1));
  writeFileSync(join(p.dir, "bom.json"), bought.replace('"units":1', '"units":50'));
  const b = bundle(p.dir, p.slug);
  assert.deepEqual(b.entry.claimed.score, { pass: false, state: "stale" });
  assert.match(bundleText(b), /score: score\.json says PASS, but not of the quote as it is now: run sprue all/);
  // A record the score rests on that is a link: the score can't be held to anything.
  const q = product({ "score.json": '{"pass": true}' });
  const keys = temp("sprue-keys-");
  writeFileSync(join(keys, "faults.json"), "[]");
  mkdirSync(join(q.dir, "reference"));
  symlinkSync(join(keys, "faults.json"), join(q.dir, "reference", "faults.json"));
  const qb = bundle(q.dir, q.slug);
  assert.deepEqual(qb.entry.claimed.score, { pass: false, state: "unreadable" });
  assert.match(bundleText(qb), /score: score\.json can't be held to the files now: reference\/faults\.json is a link/);
});

test("the claims' words come from what is there, not from a record's text", () => {
  const p = product({ "reference/faults.json": JSON.stringify([{ id: "keycap-pitch-changed" }]) });
  // A faults.json of these files that missed a fault named "...-changed" fails; it is not stale.
  const record = (extra: object) => JSON.stringify({ slug: "lid", ok: false, ran: 1, caught: 0, pct: 0, missed: ["keycap-pitch-changed"], falseAlarms: 0, cases: [], inputs: faultsInputs(p.dir), ...extra });
  writeFileSync(join(p.dir, "faults.json"), record({}));
  assert.deepEqual({ ...bundle(p.dir, p.slug).entry.claimed.faults, gates: undefined }, { ok: false, state: "fails", ran: 1, caught: 0, falseAlarms: 0, gates: undefined });
  // None: not run, and no counts made up. Not JSON: unreadable, no counts.
  rmSync(join(p.dir, "faults.json"));
  assert.deepEqual(bundle(p.dir, p.slug).entry.claimed.faults, { ok: false, state: "not run" });
  writeFileSync(join(p.dir, "faults.json"), "{not json");
  assert.deepEqual(bundle(p.dir, p.slug).entry.claimed.faults, { ok: false, state: "unreadable" });
  assert.ok(!bundleText(bundle(p.dir, p.slug)).includes("0 of 0"));
  // The board's state is one of its words; anything else verify.json says is "unreadable", never copied.
  const board = product({ "bom.json": JSON.stringify({ slug: "lid", units: 1, lines: [{ id: "pcb", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: {}, file: "pcb/lid.zip" }] }) });
  mkdirSync(join(board.dir, "pcb"));
  const h = inputsHash(board.dir, { design: [], bom: [] });
  writeFileSync(join(board.dir, "pcb", "drc.json"), JSON.stringify({ inputs: h, reads: { design: [], bom: [] } }));
  writeFileSync(join(board.dir, "pcb", "verify.json"), JSON.stringify({ status: "sent to Anna Rossi for a look", inputs: h }));
  const bb = bundle(board.dir, board.slug);
  assert.deepEqual(bb.entry.claimed.board, { state: "unreadable" });
  assert.ok(!JSON.stringify(bb.entry).includes("Anna"));
  writeFileSync(join(board.dir, "pcb", "verify.json"), JSON.stringify({ status: "failed", inputs: h }));
  assert.deepEqual(bundle(board.dir, board.slug).entry.claimed.board, { state: "failed" });
});

test("a module the sent code imports must be sent too, read from the code with no pcb/ there", () => {
  assert.deepEqual(importsOf([
    'import layout from "../../../shared/layout.json" with { type: "json" };', "import {\n  a,\n  b,\n} from './parts.mjs';", 'export * from "./more.js";',
    'import "./side.mjs";', 'const x = await import("../x.mjs");', 'const y = require("/abs/y.js");', 'import fs from "node:fs";', 'import * as THREE from "three";',
    "// taken from 'elsewhere'", 'const s = "import me from \'./nothing\'";'].join("\n")).sort(),
  ["../../../shared/layout.json", "../x.mjs", "./more.js", "./parts.mjs", "./side.mjs", "/abs/y.js"].sort());
  const out = product({ "cad/pcb.mjs": 'import layout from "../../../shared/layout.json" with { type: "json" };\nexport default {}\n' });
  assert.deepEqual(bundle(out.dir, out.slug).problems, ["cad/pcb.mjs imports ../../../shared/layout.json, outside the product, which a bundle doesn't send: move it into cad/ and import it from there"]);
  const unsent = product({ "figure.mjs": 'import { grid } from "./notes/grid.mjs";\n', "notes/grid.mjs": "export const grid = 1;\n" });
  assert.match(bundle(unsent.dir, unsent.slug).problems.join("\n"), /^figure\.mjs imports notes\/grid\.mjs, which a bundle doesn't send/);
  const sent = product({ "cad/pcb.mjs": 'import { grid } from "./grid.mjs";\nimport { a } from "./lib/a";\nimport fs from "node:fs";\n', "cad/grid.mjs": "export const grid = 1;\n", "cad/lib/a.ts": "export const a = 1;\n" });
  assert.deepEqual(bundle(sent.dir, sent.slug).problems, []);
});

test("a number before more words is still a phone number; only a unit after it, in its own case, makes it a size", () => {
  const phone = (line: string) => assert.deepEqual(privacyFindings("design.md", line).map((f) => f.kind), ["a phone number"], line);
  for (const line of ["Call 415-555-0132 in the evening.", "Text me at 415-555-0132 in case a part is missing.", "+44 7700 900123 in the evening", "+1 415 555 0132 in the evening",
    "+49 176 12345678 in Berlin", "Tel. 06 1234 5678 in ufficio", "My mobile is 333 123 4567 in the evenings", "0039 333 1234567 in the evening", "Cell: 3331234567 a casa",
    "Phone: 0176 12345678 s.v.p.", "Phone number: 415 555 0132", "(415) 555 0132", "415 555-0132", "my cell is 415 555 0132"])
    phone(line);
  for (const line of ["Cell: 18650 3500 mAh", "Cell: 18650 3.7 V", "cell 2: 3.7 V", "3 speeds: 300 450 1200 rpm", "Load cell: 1000 2000 5000 g"])
    assert.deepEqual(privacyFindings("design.md", line), [], line);
});

test("France's, Germany's, the UK's and Italy's ways of writing a number are found, and a number under a key", () => {
  const phone = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a phone number"], line);
  for (const line of ["06 12 34 56 78", "06.12.34.56.78", "Portable: 06 12 34 56 78", "Tél : 01 23 45 67 89", "tél. 06.12.34.56.78", "0033 6 12 34 56 78",
    "0176 / 1234 5678", "030 / 123 456 78", "(0176) 12345678", "Telefon: 0176 / 1234 5678", "030 1234567-89", "Handynummer: 01761234567",
    "(020) 7946 0958", "(01632) 960 001", "07700900123", "347-1234567", "Cel. 347 12 34 567", "Cel. 3471234567"])
    phone(line);
  for (const line of ['"phone": "3331234567"', '{"tel": "06 12 34 56 78"}', '{"mobile": "07700900123"}']) phone(line, "cad/supplier.json");
  phone('const owner = { phone: "3331234567" };', "figure.mjs");
  phone('PHONE = "3331234567"', "cad/_params.py");
  // A part number of ten digits is still a part number.
  for (const line of ['"mpn": "0430450212"', '"mpn": "0533980671"']) assert.deepEqual(privacyFindings("bom.json", line), [], line);
});

test("a list of sizes or values, a run of numbers and a date after 'call' are not phone numbers", () => {
  const none = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ["Footprints: 0805 1206 2512", "Footprints: 0603 0805 1206 2512", "Sizes 0805 1210 2010 all fit.", "Resistors (ohm): 330 470 1000 4700",
    "Microstep table: 320 640 1280 3200", "steps 350 450 1200", "01 02 03 04 05", "Review call 2026-11-11: switch to M3 inserts.", "Decided on the call on 11/11/2026.",
    "Supplier call at 2026-11-12, then reorder."])
    none(line);
  none('"spec": { "footprints": "0805 1206 2512" }', "bom.json");
  none("# was [350 450 1200]", "cad/x.py");
  none('const pts = "310 120 330 140 350 160";', "figure.mjs");
});

test("a passphrase under a credential's name is found, and a default after a read; a design token's id is not", () => {
  const key = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a key, token or password"], line);
  for (const line of ['api_key = "purple-monkey-dishwasher"', 'access_token = "my-secret-token-2024"', 'WIFI_PASS = "purple-monkey-dishwasher"', 'WPA_KEY = "correct-horse-battery-staple"',
    'WIFI_PASSWORD = os.getenv("WIFI_PASSWORD", "MyHomeWifi2024")', 'password = os.environ.get("PW", "Sup3rS3cret!")', 'password = input("pw") or "Sup3rS3cret!"', "db_pass=hunter22!",
    'MY_WIFI_PASS = "MyHomeWifi2024"'])
    key(line, "cad/x.py");
  for (const line of ['const mqttToken = "garden-gnome-sunset-77";', 'const password = process.env.PW ?? "Sup3rS3cret!";', '"wifi_pass": "MyHomeWifi2024"']) key(line, "figure.mjs");
  key('"wifiPass": "correct.horse.battery.staple",', "bom.json");
  for (const line of ["api_key: purple-monkey-dishwasher-2024", "Wi-Fi pass: purple-monkey-dishwasher", "password: correct-horse-battery-staple"]) key(line, "design.md");
  // A read with no default, or a placeholder for one, holds no secret; nor does a design token's id.
  for (const line of ['WIFI_PASSWORD = os.getenv("WIFI_PASSWORD")', 'password: str = os.environ["PW"]', 'WIFI_PASS = os.getenv("WIFI_PASS", "changeme")'])
    assert.deepEqual(privacyFindings("cad/x.py", line), [], line);
  for (const line of ['const colorToken = "accent-blue-500"', 'const designToken = "space-inset-large"']) assert.deepEqual(privacyFindings("figure.mjs", line), [], line);
});

test("a password in a table cell with emphasis or code, after 'API key', or under a typed name is found", () => {
  const key = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a key, token or password"], line);
  for (const line of ["| **Password** | `Sup3rS3cret!` |", "| **Password** | Sup3rS3cret! |", "| **Wi-Fi password** | Sup3rS3cret! |", "| *password* | Sup3rS3cret! |",
    "| `password` | `Sup3rS3cret!` |", "**API key:** abcd1234efgh5678ijkl", "- **API key**: `abcd1234efgh5678ijkl`", "API key: abcd1234efgh5678ijkl"])
    key(line, "design.md");
  for (const line of ['WIFI_PASSWORD: str = "Sup3rS3cret!"', "OCTOPRINT_API_KEY: Final = 'ABCDEF0123456789ABCDEF0123456789'"]) key(line, "cad/_params.py");
  for (const line of ["export const apiKey: string = 'abcd1234efgh5678ijkl';", "const password: string = 'Sup3rS3cret!';", "private readonly token: string = 'abcd1234efgh5678';"])
    key(line, "rules.ts");
  // A table that only names a secret's place says none.
  for (const line of ["| Secret | not-in-the-repo |", "| Password | set on first boot |"]) assert.deepEqual(privacyFindings("design.md", line), [], line);
});

test("a user's name under /media or /run/media is found; a drive's label there is not", () => {
  for (const line of ["Copy code.py to /media/tobias/CIRCUITPY/", "cp code.py /run/media/tobias/CIRCUITPY/", "cp tutor.py /media/tobias/rootfs/home/pi/ponder/"])
    assert.deepEqual(privacyFindings("design.md", line).map((f) => f.kind), ["a home folder's path (a user name)"], line);
  for (const line of ["Copy code.py to /media/CIRCUITPY/code.py", "/media/usb/firmware.uf2", "/media/pi/CIRCUITPY/code.py"]) assert.deepEqual(privacyFindings("design.md", line), [], line);
});

test("pass is a password's name only in a compound name: filters, machining passes, results and pass/fail maps go through", () => {
  const none = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ["RC low-pass: 10k/100nF", "Band-pass: 300-3400 Hz", "High-pass: 1uF/10k", "| Low-pass | 10k/100nF |", "| Arm fit | pass | 2026-11-10 |", "Fit check pass: 2026-11-10",
    "Cut pass: 80%/12mm/s", "Roughing pass: 6mm-2F-flat endmill"])
    none(line, "design.md");
  none('  "notes": "RC low-pass: 10k/100nF"', "bom.json");
  none('"brief": "Band-pass: 300-3400 Hz voice filter"', "request.json");
  for (const line of ['LOW_PASS = "RC-10k-100nF"', 'MY_LOW_PASS = "RC-10k-100nF"']) none(line, "cad/_params.py");
  for (const line of ['const TONE = { pass: "#16a34a", fail: "#dc2626" };', '{ pass: "var(--ok)" }', 'const t = ok ? "Pass" : "Not yet";', 'return s.pass ? "PASS" : "not yet";',
    'const W = { pass: "passes", fail: "fails", stale: "stale" };', 'const isPass = "passes";', 'const filterLowPass = "RC-10k-100nF";'])
    none(line, "figure.mjs");
  // The viewer's own words, which a figure may copy, go through too.
  const model = readFileSync(join(SKILL, "viewer", "model.js"), "utf8");
  assert.deepEqual(privacyFindings("figure.mjs", model), []);
});

test("an address in a docstring or a block comment is found; a matrix product in a comment or a string is not", () => {
  const email = (text: string, file: string) => assert.deepEqual(privacyFindings(file, text).map((f) => f.kind), ["an email address"], text);
  email('"""Lid for the keypad.\n\nAuthor: Tobias Benetton, tobias@benetton.family\n"""', "cad/top.py");
  email('def f():\n    """\n    jane@doe.family\n    """', "cad/top.py");
  for (const text of ["/*\n * Figure for the keypad.\n * Contact: jane@doe.family\n */", "/** @author Jane Doe jane@doe.art */", "const credits = `\n  Made by jane@doe.family\n`;"])
    email(text, "figure.mjs");
  email("/* jane@doe.family */", "rules.ts");
  for (const line of ["# tip = R@np.array([0, 0, 1])", "# p_world = T@np.append(p, 1)", '"""Return R@np.asarray(p), the rotated point."""', 'print(f"tip at {R@np.array(tip)}")',
    "row, col = i // 3, i % 3; p = R@np.array([col, row, 0])", "# tip = pose@self.offset"])
    assert.deepEqual(privacyFindings("cad/x.py", line), [], line);
  assert.deepEqual(privacyFindings("rules.ts", "// was: tip = R@np.array([0, 0, 1]) in cad/top.py"), []);
  // Which lines start inside a comment, a docstring or a template, and a regex's quote opens nothing.
  assert.deepEqual(lex('a = """x\ny"""\nb = 1', true).opened, [false, true, false]);
  assert.deepEqual(lex("/*\n*/\nconst re = /\"/;\nconst t = `a\nb`;\nx", false).opened, [false, true, false, false, true, false]);
});

test("imports are read from the code, not its comments or strings, in every form; a path made at run time is refused", () => {
  const specs = (code: string) => scanImports(code).specs;
  for (const [code, want] of [['const layout = (await import("../../../shared/layout.json", { with: { type: "json" } })).default;', ["../../../shared/layout.json"]],
    ['import("../x.mjs" /* c */)', ["../x.mjs"]], ['import a from "./a.mjs"; import b from "./b.mjs";', ["./a.mjs", "./b.mjs"]], ['const A = 1; import c from "../c.mjs";', ["../c.mjs"]],
    ['/** b */ import d from "../d.mjs";', ["../d.mjs"]], ["import(`../t.mjs`)", ["../t.mjs"]], ["const u = \"http://x\"; import e from './e.mjs';", ["./e.mjs"]],
    ['// const old = await import("../legacy/figure-old.mjs");', []], ['// const old = require("../legacy/figure-old.js");', []], ['/*\nimport old from "../legacy/figure-old.mjs";\n*/', []],
    ["const s = \"load it with import('./parts.mjs') in the console\";", []]] as const)
    assert.deepEqual(specs(code), want, code);
  assert.deepEqual(scanImports("const a = 1;\nconst m = await import(`./parts/${name}.mjs`);\nconst n = await import(url);").built, [2, 3]);
  assert.deepEqual(scanImports("const o = await import(`https://cdn.jsdelivr.net/npm/three@${v}/build/three.module.js`);").built, []);
  const p = product({ "figure.mjs": "export default async (name) => (await import(`./parts/${name}.mjs`)).default;\n" });
  assert.deepEqual(bundle(p.dir, p.slug).problems, ["figure.mjs:1 imports a module by a path made when the code runs, which Sprue can't follow to see that the bundle sends it: import it by a plain path (a file in cad/, or a package's name)"]);
  // An import moved into cad/, as the refusal says, is no refusal, even with a commented-out one left.
  const moved = product({ "cad/pcb.mjs": '// import layout from "../../../shared/layout.json" with { type: "json" };\nimport layout from "./layout.json" with { type: "json" };\nexport default {}\n', "cad/layout.json": "{}" });
  assert.deepEqual(bundle(moved.dir, moved.slug).problems, []);
});

test("pcb/drc.json's modules count only while it is of the board now; an earlier one asks for sprue pcb, not a move", () => {
  const p = product({ "cad/pcb.mjs": 'import layout from "./layout.json" with { type: "json" };\nexport default {}\n', "cad/layout.json": "{}" });
  mkdirSync(join(p.dir, "pcb"));
  // Of the board now, and naming a module outside the product: refused, by name.
  const reads = { design: [], bom: [], modules: ["../../shared/x.json", "cad/pcb.mjs"] };
  mkdirSync(join(p.root, "shared"));
  writeFileSync(join(p.root, "shared", "x.json"), "{}");
  writeFileSync(join(p.dir, "pcb", "drc.json"), JSON.stringify({ inputs: inputsHash(p.dir, reads), reads }));
  assert.deepEqual(bundle(p.dir, p.slug).problems, ["the board's code imports ../../shared/x.json, outside the product, which a bundle doesn't send: move it into cad/ and import it from there"]);
  // The code changed since, or a module it named is gone: drc.json can't say what the board imports now.
  writeFileSync(join(p.dir, "cad", "pcb.mjs"), 'import layout from "./layout.json" with { type: "json" };\nexport default { edited: true }\n');
  assert.deepEqual(bundle(p.dir, p.slug).problems, ["pcb/drc.json is of an earlier board, so Sprue can't tell what the board's code imports now: run sprue pcb lid, then publish again"]);
  const renamed = { design: [], bom: [], modules: ["cad/old.json", "cad/pcb.mjs"] };
  writeFileSync(join(p.dir, "pcb", "drc.json"), JSON.stringify({ inputs: "0123456789abcdef", reads: renamed }));
  assert.deepEqual(bundle(p.dir, p.slug).problems, ["pcb/drc.json is of an earlier board, so Sprue can't tell what the board's code imports now: run sprue pcb lid, then publish again"]);
  // An earlier drc.json whose modules the bundle sends anyway is no reason to refuse.
  writeFileSync(join(p.dir, "pcb", "drc.json"), JSON.stringify({ inputs: "0123456789abcdef", reads: { design: [], bom: [], modules: ["cad/layout.json", "cad/pcb.mjs"] } }));
  assert.deepEqual(bundle(p.dir, p.slug).problems, []);
});

test("Italy's kept 0 after 00, a number after a house number, a bare call, labels in Markdown and German words for a phone lead to a number", () => {
  const phone = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a phone number"], line);
  for (const line of ["Ufficio: 0039 06 1234 5678", "0039 02 12345678", "0039 0521 123456", "0039-06-1234-5678", "0039 (0)6 1234 5678", "Via Roma 12 06 1234 5678", "Box 2 0176 12345678",
    "Call 415 555 0132", "Please call 415 555 0132 after 6.", "Call: 3331234567", "Call at 415 555 0132", "Call 079 123 45 67",
    "**Phone:** 4155550132", "| Phone | 3331234567 |", "**Tel.:** 0612345678", "_Phone_: 4155550132", "Phone (mobile): 415 555 0132", "Telefonnummer: 01761234567", "Tel.-Nr.: 01761234567", "Handynr.: 01761234567",
    // Switzerland's, Austria's, Germany's, Sweden's and Belgium's pairs after the area code.
    "079 123 45 67", "044 123 45 67", "0664 123 45 67", "0171 123 45 67", "070-123 45 67", "0470 12 34 56"])
    phone(line);
  phone('"notes": "Fornitore 0039 02 1234 5678"', "bom.json");
  phone('"brief": "Call\\n4155550132"', "request.json");
});

test("a sum after cell, a list of values with a unit, bytes, pins, ranges and box sizes are no phone numbers", () => {
  const none = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ["Review call 2026-11-11 14:30: decided on M3.", "The cell is 18650 (65 x 18 mm).", "Cell at 20 / 50 / 80 / 100 %", "Load cell: 100 / 200 / 500 g max", "Load cell: 1 / 5 / 10 / 20 / 50 lb",
    "Frame: 02 10 00 01 03", "Reply bytes 01 03 02 00 64", "Steps 01 02 03 05 06 need the jig.", "GPIO 04 05 12 13 14", "Bits: 01 02 04 08 16", "Photo 05-11-26-14-30 shows the gap.",
    "Microstep options: 200 400-3200 steps/rev", "Speeds 250 500-1000", "Hole at 215 130.2500", "Box: 320 25 40 125", "Enclosure (mm): 352 148 225"])
    none(line);
  for (const line of ["cell = 19.05 / 2 - 0.25", "CELL = (19.05 - 0.4) / 2  # one key's square"]) none(line, "cad/keys.py");
  none("const cell = 19.05 / 2 - 0.25;", "figure.mjs");
  none('const pts = "250.125 1000 300.250 1100";', "figure.mjs");
});

test("a password with a date in it and a bare psk are found; a machining or render pass's id, a token's id and a design token's style are not", () => {
  const key = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a key, token or password"], line);
  for (const line of ['WIFI_PASS = "anna12.05.1985"', 'WIFI_PASS = "Luca-2016-05-12"', "db_pass=Rossi12/03/88"]) key(line, "cad/x.py");
  key('const wifiPass = "bella01/02/1990";', "figure.mjs");
  key("- **Wi-Fi pass:** `marco1985-06-14`", "design.md");
  for (const line of ['    psk="MyHomeWifi2024"', "psk=MyHomeWifi2024"]) key(line, "design.md");
  assert.deepEqual(privacyFindings("design.md", 'network={\n    ssid="Home"\n    psk="MyHomeWifi2024"\n}').map((f) => f.line), [3]);
  const none = (line: string, file: string) => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ['contour_pass = "contour-6mm-flat"', 'PROFILE_PASS = "profile-cut-02"', 'pocket_pass = "pocket-3mm-ramp"', 'token = "coin-25mm-brass"']) none(line, "cad/top.py");
  none('{"token": "coin-25mm-brass"}', "design.json");
  for (const line of ['const renderPass = "scene-main-pass";', 'const accentToken = "#16a34a";', 'export const tokens = { surfaceToken: "#f4f4f5", inkToken: "#18181b" };', 'const colorToken = "rgb(22,163,74)";',
    'const fontToken = "Inter-600-14px";', 'const shadowToken = "0 1px 2px rgba(0,0,0,.2)";'])
    none(line, "figure.mjs");
  // A credential's token holding a colour is still a token.
  key('const apiToken = "#16a34a-9f8e7d6c5b4a";', "figure.mjs");
});

test("where a secret is kept (a variable, a file, a command, a Wi-Fi mode) is no secret", () => {
  for (const line of ["| `CIRCUITPY_WIFI_PASSWORD` | `settings.toml` on the drive |", "| `OCTOPART_API_KEY` | `sprue source` reads it |", "| `NEXAR_CLIENT_SECRET` | `sprue quote` |",
    "- **API key:** `OCTOPART_API_KEY` in your shell, never in the repo", "| API key | `.env.local` |", "API key: `$OCTOPART_API_KEY`", "Network key: WPA2-PSK, set on first boot"])
    assert.deepEqual(privacyFindings("design.md", line), [], line);
  assert.deepEqual(privacyFindings("design.md", "| API key | `abcd1234efgh5678ijkl` |").map((f) => f.kind), ["a key, token or password"]);
});

test("an address before ( or [ in prose is found; a matrix product of the code's own names in a docstring is not", () => {
  for (const line of ["Questions: jane.doe@gmail.com(evenings only)", "Maintainer: jane.doe@gmail.com[^1]", "jane@np.nl", "mario@cls.it"])
    assert.deepEqual(privacyFindings("design.md", line).map((f) => f.kind), ["an email address"], line);
  assert.deepEqual(privacyFindings("cad/x.py", "# Contact: mario@tf.it").map((f) => f.kind), ["an email address"]);
  const doc = 'def tip(pose):\n    """Where the probe tip is, in the world frame.\n\n    world = pose@tool.offset, with tool from _params.\n    """\n    return pose @ TOOL\n';
  assert.deepEqual(privacyFindings("cad/_system.py", doc), []);
  // Names the code doesn't use make it an address again.
  assert.deepEqual(privacyFindings("cad/_system.py", doc.replace("pose@tool.offset", "anna@studio.offset")).map((f) => f.kind), ["an email address"]);
});

test("a require of the file's own, an import method and a path added to are told apart from a load; a nested template hides no import", () => {
  const scan = (code: string) => scanImports(code);
  assert.deepEqual(scan('const require = (cond, detail) => ({ status: cond ? "pass" : "fail", detail });\nexport const rules = [{ run: ({ p }) => require(p.wallMm >= 1.2, `wall ${p.wallMm} mm`) }];'), { specs: [], built: [] });
  assert.deepEqual(scan("class Layout {\n  constructor() { this.keys = []; }\n  import(json) { this.keys = json.keys; return this; }\n}"), { specs: [], built: [] });
  assert.deepEqual(scan("interface L { import(spec: string): void; }"), { specs: [], built: [] });
  assert.deepEqual(scan('import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const x = require("./x.cjs");'), { specs: ["./x.cjs"], built: [] });
  assert.deepEqual(scan('export default async (p) => (await import("./cad/" + p.variant + ".mjs")).default;'), { specs: [], built: [1] });
  assert.deepEqual(scan('import("./cad/layout.mjs?" + v)'), { specs: [], built: [1] });
  const nested = 'const row = (keys) => `<g class="row">${keys.map((k) => `<text x="${k.x}">${k.label}</text>`).join("")}</g>`;\nexport default async function figure(params) {\n  const { caps } = await import("../../shared/keycaps.mjs");\n  return row(caps(params));\n}\nexport { more } from "../../shared/more.mjs";\n';
  assert.deepEqual(scan(nested).specs.sort(), ["../../shared/keycaps.mjs", "../../shared/more.mjs"]);
  assert.deepEqual(lex(nested, false).opened, [false, false, false, false, false, false, false]);
  assert.equal(lex(nested, false).ended, true);
  assert.deepEqual(scan("const q = (s) => `'${s.replaceAll(\"'\", `'\\\\''`)}'`;\nimport z from \"./z.mjs\";").specs, ["./z.mjs"]);
  // A file whose lexing ends inside a string or a template still has its local imports read.
  const unclosed = 'import a from "./a.mjs";\nconst s = `never closed\nimport b from "./b.mjs";';
  assert.equal(lex(unclosed, false).ended, false);
  assert.deepEqual(scan(unclosed).specs.sort(), ["./a.mjs", "./b.mjs"]);
  const p = product({ "figure.mjs": 'export default async (p) => (await import("./cad/" + p.variant + ".mjs")).default;\n', "cad/a.mjs": "export default 1;\n" });
  assert.deepEqual(bundle(p.dir, p.slug).problems, ["figure.mjs:1 imports a module by a path made when the code runs, which Sprue can't follow to see that the bundle sends it: import it by a plain path (a file in cad/, or a package's name)"]);
});

test("a number after a phone word is found with dots, a note in brackets, an = and no quote, a line's name, Italian and French 'call me', a padded table, bold, # and a full stop", () => {
  const phone = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a phone number"], line);
  for (const line of ["Tél : 01.23.45.67.89", "Tel: 01-23-45-67-89", "| Téléphone | 01.23.45.67.89 |", "Phone: 415 555 0132 (9am-5pm PT)", "Cell: 3331234567 (9-18)", "Phone 415 555 0132 (1st floor)",
    "Questions? WhatsApp: https://api.whatsapp.com/send?phone=393331234567", "Tél. fixe : 01 23 45 67 89", "Tél. (bureau) : 01 23 45 67 89", "Fixe : 01 23 45 67 89", "| Fixe | 01 23 45 67 89 |", "Tel. ufficio: 347 12 34 567",
    "Chiamami al 347 12 34 567", "Appelez-moi au 01 23 45 67 89", "| Tél.       | 01 23 45 67 89 |", "Supplier: (310) 550-1230", "Phone **4155550132**", "Tel. **01 23 45 67 89**",
    "Handy-Nr.: 01761234567", "Fax-Nr.: 0301234567", "Mobilfunknummer: 01761234567", "Contact: Mario Rossi, +39 333 1234567.", "Cell: 333 123 4567.", "Phone #: 4155550132", "Tel #4155550132"])
    phone(line);
  phone('TEL = "01.23.45.67.89"', "cad/x.py");
  phone('{"brief": "Lampe de bureau. Tél. 04.72.12.34.56"}', "request.json");
  for (const line of ["PHONE = 3331234567", "OWNER_PHONE = 4155550132"]) phone(line, "cad/_params.py");
  phone("const phone = 4155550132;", "figure.mjs");
});

test("dates with times, battery cell lists, passive values, sums and comments after cell, and French and Italian words around values are no phone numbers", () => {
  const none = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ["Review call 2026-11-11 14.30: decided on M3.", "Call 2026-11-12 10-11 CET with the fab.", "call 12.11. 14.30 with JLC", "call on 11.11.-12.11.2026",
    "| Cell | 18650 / 21700 |", "Cell: 18650 21700", "Decoupling caps 0402 10 22 47 nF", "Inductors 0805 10 22 47 uH", "Fixe : 2 vis M3 x 12.", "Base fixe : 120 80 30", "Il pezzo al 1200 1300 1400",
    "| Cell         | 18650 (65 x 18 mm) |", "Cell #1: 18650 2600 mAh", "Steps 300 450 1200.", "Coordinates +45.123456, +9.123456."])
    none(line);
  for (const line of ["x = cell * (19.05 - 0.5) / 2", "CELL = 19.05  # 1905 0000 0000 um", "grid(cell=19.05 - 0.4)"]) none(line, "cad/keys.py");
});

test("a password joined by _, a note after a password in a table, a command that sets a secret, a passphrase under a pass name and a service's token are found; where a secret is kept and a keycap's id are not", () => {
  const key = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line).map((f) => f.kind), ["a key, token or password"], line);
  for (const line of ['CIRCUITPY_WIFI_PASSWORD = "Rossi_Casa_1985"', "| Wi-Fi password | Sup3rS3cret! (on the router sticker) |", "- **Client secret:** `export DIGIKEY_CLIENT_SECRET=abcd1234efgh5678`"]) key(line);
  for (const line of ['OTA_PASS = "purple-monkey-dishwasher"', 'BROKER_PASS = "purple-monkey-dishwasher"', 'LINE_TOKEN = "Abc123XyZ456DeF789GhI012JkL345MnO678PqR901s"']) key(line, "cad/_params.py");
  for (const line of ['const token = "mysecret-2024";', 'const designToken = "my-pass-2024";']) key(line, "figure.mjs");
  const none = (line: string, file = "design.md") => assert.deepEqual(privacyFindings(file, line), [], line);
  for (const line of ["| `CIRCUITPY_WIFI_PASSWORD` | `CIRCUITPY/settings.toml` |", "| `OCTOPART_API_KEY` | `~/.zshrc` |", "API key: `$env:OCTOPART_API_KEY`", "API key: `%OCTOPART_API_KEY%`",
    "API key: `op://Private/Octopart/credential`", "Network key: WPA2-PSK-AES, set on first boot", "| Token | `export GITHUB_TOKEN=$(gh auth token)` |"])
    none(line);
  for (const line of ['contour_pass = "6mm-2F-flat"', 'wall_pass = "walls-thick-enough"']) none(line, "cad/cam.py");
  for (const line of ['const designToken = "keycap-legend-large";', 'const lineToken = "hairline";']) none(line, "figure.mjs");
});

test("a matrix product on self or a call in code passes; an address the lexer blanks or a comment it misreads, and one before a footnote, is found; a home folder's placeholder is no one's", () => {
  const frame = 'import numpy as np\n\nclass Frame:\n    def __init__(self, R):\n        self.R = R\n        self.to_world = np.eye(4)\n\n    def world(self, pts):\n        """Points in the world frame: pts@self.to_world."""\n        return pts@self.to_world\n';
  assert.deepEqual(privacyFindings("cad/_system.py", frame), []);
  for (const line of ["T_ee = T_base@robot.fk(q)", "W = M@torch.as_tensor(v)"]) assert.deepEqual(privacyFindings("cad/x.py", line), [], line);
  const email = (file: string, text: string) => assert.deepEqual(privacyFindings(file, text).map((f) => f.kind), ["an email address"], text);
  email("figure.mjs", 'const svg = `<svg viewBox="0 0 ${w} ${h}">${parts\n  .map(drawPart)\n  .join("")}<text>Design: jane@doe.family</text></svg>`;');
  email("figure.mjs", "const pitch = (width - 2 * margin)\n  / (cols - 1); // spacing from jane@doe.family, see her sketch\n");
  email("design.md", "Maintainer: tobias@posteo.berlin[^1]");
  assert.deepEqual(privacyFindings("design.md", "p = R@frame.apply(v)"), []);
  for (const line of ["Put the library in C:\\Users\\%USERNAME%\\Documents\\Arduino\\libraries", "cp code.py /home/$USER/ponder/"]) assert.deepEqual(privacyFindings("design.md", line), [], line);
  assert.deepEqual(privacyFindings("design.md", "cp code.py /home/tobias/ponder/").map((f) => f.kind), ["a home folder's path (a user name)"]);
});

test("a key named require, a typed import method and an imported require helper are no load, and the real require still is", () => {
  assert.deepEqual(scanImports('const shared = require("../../../shared/fdm-limits.json");\nmodule.exports = { wall: { min: shared.minWallMm, require: "perimeters" } };\n'),
    { specs: ["../../../shared/fdm-limits.json"], built: [] });
  assert.deepEqual(scanImports("export class KeyLayout {\n  keys: number[] = [];\n  constructor(public pitch = 19.05) {}\n  import(kle: string): this {\n    this.keys = JSON.parse(kle);\n    return this;\n  }\n}\n"), { specs: [], built: [] });
  assert.deepEqual(scanImports('import { require } from "./cad/checks.mjs";\nexport const rules = [{ run: ({ p }) => require(p.wallMm >= 0.84, `wall ${p.wallMm} mm`) }];\n'), { specs: ["./cad/checks.mjs"], built: [] });
  // A CommonJS file's require of a name is still made at run time.
  assert.deepEqual(scanImports("const name = pick();\nconst m = require(name);\n").built, [2]);
});
