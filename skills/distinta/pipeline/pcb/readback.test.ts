// Tests of the read-back (readback.py) and of what rests on it: the scorer's gate and `distinta verify`. Each check of
// the read-back gets a board that is broken where it looks, put into a copy of the macropad's files, and must fail.
// Run them with
//   node --test skills/distinta/pipeline/pcb/readback.test.ts
// They need Python 3.12 or newer with gerbonara and shapely (requirements.txt here); without them they are skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pcb } from "../pcb.ts";
import { drcAudit, gerbersAudit, readbackAudit } from "../stages/score.ts";
import { runReadback, verify, type Readback } from "../verify.ts";
import { zip } from "./gerber.ts";

const READBACK = join(import.meta.dirname, "readback.py");
const ready = spawnSync("python3", ["-I", "-c", "import gerbonara, shapely"]).status === 0;
const skip = ready ? false : "gerbonara and shapely are not installed (python3 -m pip install --no-deps -r skills/distinta/pipeline/pcb/requirements.txt)";

type Pad = { id: string; ref: string; num: string; name: string | null; kind: string | null; net: string; x: number; y: number; w: number; h: number; layers: string[] };
type Board = {
  inputs: string; slug: string; files: Record<string, string>; pads: Pad[];
  drills: { plated: { x: number; y: number; d: number }[]; nonPlated: { x: number; y: number; d: number }[] };
  intended: { net: string; pads: string[]; anyOf?: string[] }[];
};
/** A copy of the files the read-back reads: the ones in the zip by name, the .d356 and board.json. */
type Files = { files: Record<string, string>; d356: string; board: Board };

/** Runs `fn` in `dir` (the products/ folder's parent) with console.log silenced, and gives back what it printed. */
async function quietly<T>(dir: string, fn: () => Promise<T>): Promise<{ value: T; said: string }> {
  const here = process.cwd(), log = console.log, lines: string[] = [];
  try {
    process.chdir(dir);
    console.log = (...xs: unknown[]) => lines.push(xs.join(" "));
    return { value: await fn(), said: lines.join("\n") };
  } finally {
    console.log = log;
    process.chdir(here);
  }
}

let built: Promise<string> | undefined;
/** The macropad, built once into a temporary products/ folder: its product folder. */
function macropad(): Promise<string> {
  built ??= (async () => {
    const tmp = mkdtempSync(join(tmpdir(), "distinta-readback-"));
    const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
    for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
    assert.equal((await quietly(tmp, () => pcb("macropad"))).value, true);
    return dst;
  })();
  return built;
}

/** The built macropad's files, to change. */
async function files(): Promise<Files> {
  const dir = join(await macropad(), "pcb");
  const board = JSON.parse(readFileSync(join(dir, "board.json"), "utf8")) as Board;
  const inZip = Object.entries(board.files).filter(([role]) => role !== "netlist" && role !== "zip").map(([, name]) => name);
  return { files: Object.fromEntries(inZip.map((n) => [n, readFileSync(join(dir, n), "utf8")])), d356: readFileSync(join(dir, board.files.netlist), "utf8"), board };
}

/** Reads back a copy of the macropad's files after `change`, in a folder of its own. */
async function readBack(change: (f: Files) => void = () => {}, flags: string[] = []): Promise<{ status: number; report: Readback; text: string }> {
  const f = await files();
  change(f);
  const dir = mkdtempSync(join(tmpdir(), "distinta-readback-copy-"));
  writeFileSync(join(dir, "board.json"), JSON.stringify(f.board));
  writeFileSync(join(dir, f.board.files.netlist), f.d356);
  writeFileSync(join(dir, f.board.files.zip), zip(Object.entries(f.files).map(([name, data]) => ({ name, data }))));
  const r = spawnSync("python3", ["-I", READBACK, dir, ...flags], { encoding: "utf8" });
  const report = JSON.parse(readFileSync(join(dir, "readback.json"), "utf8")) as Readback;
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status ?? -1, report, text: report.errors.join("\n") };
}

const role = (f: Files, r: string) => f.board.files[r];
const pad = (f: Files, id: string) => f.board.pads.find((p) => p.id === id)!;
/** A Gerber layer with one more stroke along `pts` before its end: dark adds copper, clear takes it away. */
function stroke(text: string, width: number, pts: [number, number][], dark: boolean): string {
  const code = Math.max(9, ...[...text.matchAll(/%ADD(\d+)/g)].map((m) => Number(m[1]))) + 1;
  const xy = ([x, y]: [number, number]) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
  const cmds = [`%ADD${code}C,${width.toFixed(6)}*%`, dark ? "%LPD*%" : "%LPC*%", `D${code}*`, `${xy(pts[0])}D02*`, ...pts.slice(1).map((p) => `${xy(p)}D01*`), "%LPD*%"];
  return text.replace(/M02\*\n$/, `${cmds.join("\n")}\nM02*\n`);
}
/** A clear ring all round a pad, 0.4 mm out: it cuts every track and spoke that reaches the pad on its layer. */
const ringRound = (p: Pad): [number, number][] => {
  const hx = p.w / 2 + 0.4, hy = p.h / 2 + 0.4;
  return [[p.x - hx, p.y - hy], [p.x + hx, p.y - hy], [p.x + hx, p.y + hy], [p.x - hx, p.y + hy], [p.x - hx, p.y - hy]];
};
const copperOf = (f: Files, p: Pad) => role(f, p.layers[0]);

test("the read-back passes the macropad as built and finds the nets design.json means", { skip }, async () => {
  const { status, report } = await readBack();
  assert.equal(status, 0, report.errors.join("\n"));
  assert.ok(report.checks.every((c) => c.ok));
  const f = await files();
  assert.equal(report.inputs, f.board.inputs);
  for (const n of f.board.intended) {
    const got = report.nets[n.net];
    assert.ok(got, `no net ${n.net} read back`);
    assert.ok(n.pads.every((p) => got.includes(p)), `${n.net}: ${got}`);
    if (n.anyOf) assert.ok(n.anyOf.some((p) => got.includes(p)));
  }
  assert.equal(Object.keys(report.nets).length, 10);
  assert.deepEqual(report.stats.islands, { "F.Cu": 33, "B.Cu": 18 });
  assert.equal(report.stats.platedDrills, 18);
  assert.equal(report.stats.d356Records, 129);
});

test("its self-test puts in a cut, a sliver across K5 and a sliver from VBUS through VSYS to GND, and catches each", { skip }, async () => {
  const { status, report } = await readBack(() => {}, ["--self-test"]);
  assert.equal(status, 0, JSON.stringify(report.selfTest, null, 1));
  const t = report.selfTest!;
  assert.ok(t.ok && t.control.ok);
  assert.deepEqual(t.cases.map((c) => [c.ran, c.ok]), [[true, true], [true, true], [true, true]]);
  assert.match(t.cases[0].got.join("\n"), /OPEN: GP10 is in 2 pieces of copper: K1\.A \| U1\.14/);
  assert.match(t.cases[1].got.join("\n"), /SHORT: .* joins GND \(.*\) and GP6 \(K5\.A, U1\.9\)/);
  assert.match(t.cases[2].got.join("\n"), /SHORT: .* joins GND \(.*\), U1\.39 \(VSYS\) and U1\.40 \(VBUS\); U1\.39 \(VSYS\) and U1\.40 \(VBUS\) are meant to be joined to nothing/);
});

test("a file whose name and file function disagree, a second unit, a drill file that does not parse, or a zip short of a file fails", { skip }, async () => {
  let r = await readBack((f) => { f.files[role(f, "F.Cu")] = f.files[role(f, "F.Cu")].replace("%TF.FileFunction,Copper,L1,Top*%", "%TF.FileFunction,Copper,L2,Bot*%"); });
  assert.equal(r.status, 1);
  assert.match(r.text, /macropad-F_Cu\.gtl's %TF\.FileFunction% is Copper,L2,Bot, but its name says Copper,L1,Top/);
  r = await readBack((f) => { f.files[role(f, "PTH")] = f.files[role(f, "PTH")].replace("TF.FileFunction,Plated,1,2,PTH", "TF.FileFunction,NonPlated,1,2,NPTH"); });
  assert.match(r.text, /macropad-PTH\.drl's %TF\.FileFunction% is NonPlated,1,2,NPTH, but its name says Plated/);
  r = await readBack((f) => { f.files[role(f, "NPTH")] = f.files[role(f, "NPTH")].replace("METRIC\n", "METRIC\nINCH\n"); });
  assert.match(r.text, /macropad-NPTH\.drl states its unit 2 times \(METRIC, INCH\), not once/);
  r = await readBack((f) => { f.files[role(f, "PTH")] = f.files[role(f, "PTH")].replace("G05\n", "G05\nQ123\n"); });
  assert.match(r.text, /macropad-PTH\.drl does not parse/);
  r = await readBack((f) => { delete f.files[role(f, "B.Mask")]; });
  assert.match(r.text, /the zip has no macropad-B_Mask\.gbs \(B\.Mask\), which board\.json lists/);
  r = await readBack((f) => { f.files["notes.txt"] = "hello"; });
  assert.match(r.text, /the zip holds notes\.txt, which board\.json does not list/);
});

test("an outline left open or drawn twice, or copper past it, fails", { skip }, async () => {
  const edge = (f: Files) => role(f, "Edge.Cuts");
  // The top edge moved over instead of drawn: the outline is open.
  let r = await readBack((f) => { f.files[edge(f)] = f.files[edge(f)].replace("X-29500000Y47000000D01*", "X-29500000Y47000000D02*"); });
  assert.match(r.text, /the profile layer makes 0 closed outlines and \d+ open or crossing pieces?, not exactly one closed outline/);
  r = await readBack((f) => { f.files[edge(f)] = stroke(f.files[edge(f)], 0.1, [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], true); });
  assert.match(r.text, /the profile layer makes 2 closed outlines/);
  r = await readBack((f) => { f.files[role(f, "F.Cu")] = stroke(f.files[role(f, "F.Cu")], 1, [[29, 0], [33, 0]], true); });
  assert.match(r.text, /mm2 of F\.Cu copper lies outside the outline, near .*: the fab would cut it off/);
});

test("a drill moved, or the socket holes drilled 2.5 mm, fails, and so does a plated drill on bare board", { skip }, async () => {
  let r = await readBack((f) => { f.files[role(f, "NPTH")] = f.files[role(f, "NPTH")].replace(/T(\d+)C3\.050/, "T$1C2.500"); });
  assert.match(r.text, /the NPTH file lacks 18 of the board's holes: 3\.05 mm at/);
  assert.match(r.text, /the NPTH file has 18 holes the board does not: 2\.5 mm at/);
  r = await readBack((f) => { f.files[role(f, "PTH")] = f.files[role(f, "PTH")].replace("T1\n", "T1\nX0.000Y-45.000\n"); });
  assert.match(r.text, /the PTH file has 1 hole the board does not: 0\.4 mm at \(0\.00, -45\.00\)/);
  assert.match(r.text, /the plated drill at \(0\.00, -45\.00\) \(0\.4 mm\) lands on no copper on B\.Cu: it joins nothing there/);
});

test("a pad knocked out of the copper, or under the solder mask, fails", { skip }, async () => {
  let r = await readBack((f) => {
    const p = pad(f, "K5.A");
    f.files[copperOf(f, p)] = stroke(f.files[copperOf(f, p)], 0.6, [[p.x, p.y], [p.x, p.y]], false);
  });
  assert.match(r.text, /pad K5\.A has no copper at its centre \(-7\.36, -10\.49\) on B\.Cu/);
  r = await readBack((f) => {
    const p = pad(f, "U1.40"), mask = role(f, "F.Mask");
    f.files[mask] = f.files[mask].replace(`X${Math.round(p.x * 1e6)}Y${Math.round(p.y * 1e6)}D03*\n`, "");
  });
  assert.match(r.text, /pad U1\.40 \(VBUS\) is under the solder mask: F\.Mask has no opening at its centre/);
});

test("the copper is held to design.json's netlist, not to the nets drawn: two keys swapped in it, or a ground cut off every ground pin, fail", { skip }, async () => {
  // board.json's intended netlist with K1 and K2 on each other's GPIO, the files as built: a short and an open each.
  let r = await readBack((f) => {
    const [a, b] = [f.board.intended.find((n) => n.pads[0] === "K1.A")!, f.board.intended.find((n) => n.pads[0] === "K2.A")!];
    [a.pads[1], b.pads[1]] = [b.pads[1], a.pads[1]];
  });
  assert.match(r.text, /SHORT: one piece of copper on .* joins GP7 \(U1\.14\) and GP10 \(K1\.A\)/);
  assert.match(r.text, /OPEN: GP10 is in 2 pieces of copper: K1\.A \| U1\.10/);
  // Every Pico ground pin cut off the pour: the keys' ground still joins its B pads, but none of the ground pins.
  r = await readBack((f) => {
    for (const p of f.board.pads.filter((p) => p.ref === "U1" && p.kind === "gnd")) f.files[copperOf(f, p)] = stroke(f.files[copperOf(f, p)], 0.3, ringRound(p), false);
  });
  assert.match(r.text, /OPEN: GND \(K1\.B, K2\.B, K3\.B and 6 more\) reaches none of U1\.3, U1\.8, U1\.13 and 5 more, of which it needs one/);
});

test("a .d356 record on another net, missing or moved fails, and so does copper that splits or joins its nets", { skip }, async () => {
  const k5a = (d356: string) => d356.split("\n").find((l) => /^327GP6 .*K5 {4}-A/.test(l))!;
  let r = await readBack((f) => { f.d356 = f.d356.replace(k5a(f.d356), k5a(f.d356).replace("327GP6 ", "327GP7 ")); });
  assert.match(r.text, /macropad\.d356 puts K5\.A on GP7, and board\.json on GP6/);
  assert.match(r.text, /macropad\.d356 says GP7 is one net, but the copper has it in 2 pieces/);
  assert.match(r.text, /the copper joins what macropad\.d356 keeps apart: GP6 and GP7/);
  r = await readBack((f) => { f.d356 = f.d356.replace(`${k5a(f.d356)}\n`, ""); });
  assert.match(r.text, /macropad\.d356 has 0 records for K5\.A, not one/);
  r = await readBack((f) => { f.d356 = f.d356.replace(k5a(f.d356), k5a(f.d356).replace(/X-00(\d{4})/, (_, d) => `X-01${d}`)); });
  assert.match(r.text, /macropad\.d356 has K5\.A at \(-\d+\.\d+, -10\.49\), and board\.json at \(-7\.36, -10\.49\)/);
  r = await readBack((f) => { f.d356 = f.d356.replace(/^367.*\n/m, ""); });
  assert.match(r.text, /macropad\.d356 has no record of the \d\.\d+ mm non-plated hole at/);
});

test("an X2 netlist attribute naming another net, or a pad without its %TO.P flash, fails", { skip }, async () => {
  let r = await readBack((f) => { const b = role(f, "B.Cu"); f.files[b] = f.files[b].replace("%TO.N,GP10*%\n%TO.P,K1,A*%", "%TO.N,GP7*%\n%TO.P,K1,A*%"); });
  assert.match(r.text, /B\.Cu: the flash of K1\.A says %TO\.N,GP7, and the pad is on GP10/);
  assert.match(r.text, /B\.Cu: a flash at \(-26\.41, -29\.54\) says %TO\.N,GP7, but its copper joins GP10/);
  r = await readBack((f) => { const b = role(f, "B.Cu"); f.files[b] = f.files[b].replace("%TO.P,K9,B*%\n", ""); });
  assert.match(r.text, /B\.Cu has no flash with %TO\.P,K9,B at K9\.B's place/);
});

// ---- the scorer's gate and the verify command ----

test("the scorer and the packager refuse a zip with no read-back, a failed or stale one, and take a current one", { skip }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-gate-")), dst = join(tmp, "products", "macropad");
  cpSync(await macropad(), dst, { recursive: true });
  const rb = join(dst, "pcb", "readback.json"), zipFile = join(dst, "pcb", "macropad-gerbers.zip");
  rmSync(rb, { force: true });
  assert.ok(drcAudit(dst).ok);
  assert.match(gerbersAudit(dst).detail, /no pcb\/readback\.json, so nothing but our own code has read the files: run distinta verify/);
  assert.equal((await quietly(tmp, async () => runReadback("macropad"))).value.status, "pass");
  assert.ok(gerbersAudit(dst, "pcb/macropad-gerbers.zip").ok, gerbersAudit(dst).detail);
  assert.match(gerbersAudit(dst).detail, /and the read-back \(gerbonara and shapely on the zip and the netlist\) finds the nets design\.json means/);
  const good = readFileSync(rb, "utf8"), report = JSON.parse(good) as Readback;
  const write = (r: unknown) => writeFileSync(rb, JSON.stringify(r));
  write({ ...report, ok: false, errors: ["SHORT: one piece of copper joins GND and GP6"] });
  assert.match(gerbersAudit(dst).detail, /the read-back found 1 error: SHORT/);
  write({ ...report, selfTest: { ok: false } });
  assert.match(gerbersAudit(dst).detail, /the read-back's self-test failed/);
  write({ ...report, inputs: "0000000000000000" });
  assert.match(readbackAudit(dst).detail, /pcb\/readback\.json is of an earlier board than pcb\/drc\.json/);
  write(report);
  assert.match(gerbersAudit(dst, "pcb/other-gerbers.zip").detail, /the read-back read macropad-gerbers\.zip, not pcb\/other-gerbers\.zip/);
  writeFileSync(zipFile, Buffer.concat([readFileSync(zipFile), Buffer.from([0])]));
  assert.match(gerbersAudit(dst).detail, /pcb\/macropad-gerbers\.zip is not the file the read-back read/);
  rmSync(tmp, { recursive: true, force: true });
});

test("distinta verify passes a sound board, says UNVERIFIED without gerbonara or Python, and FAILED on an audit error", { skip }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "distinta-verify-")), dst = join(tmp, "products", "tiny");
  mkdirSync(join(dst, "cad"), { recursive: true });
  const board = (extra: string) => `export default function board({ pcb }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  pcb.pour("GND", "F.Cu");${extra}
}
`;
  writeFileSync(join(dst, "cad", "pcb.mjs"), board(""));
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: {} }));
  const run = async () => {
    const { value, said } = await quietly(tmp, () => verify("tiny"));
    return { code: value, said, json: JSON.parse(readFileSync(join(dst, "pcb", "verify.json"), "utf8")) };
  };
  let v = await run();
  assert.equal(v.code, 0, v.said);
  assert.equal(v.json.status, "verified");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "pass"], ["readback", "pass"], ["self-test", "pass"], ["order", "pass"]]);
  assert.match(v.said, /✓ read-back self-test: a 0\.3 mm cut all round U1\.3 on F\.Cu, each put into a copy of the files, must fail and an unchanged copy pass: each was caught/);
  assert.match(v.said, /VERIFIED: every layer passed/);

  // python3 that sees no installed packages (-S), then no python3 at all: the board is unverified, and it says how to
  // install what is missing.
  const python = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  const bin = join(tmp, "bin"), empty = join(tmp, "empty"), path = process.env.PATH;
  mkdirSync(bin);
  mkdirSync(empty);
  writeFileSync(join(bin, "python3"), `#!/bin/sh\nexec "${python}" -S "$@"\n`);
  chmodSync(join(bin, "python3"), 0o755);
  try {
    process.env.PATH = `${bin}:${path}`;
    v = await run();
    assert.equal(v.code, 2);
    assert.equal(v.json.status, "unverified");
    assert.match(v.said, /· read-back: .*: not run: the read-back needs gerbonara and shapely, and gerbonara is not installed: python3 -m pip install --no-deps -r .*requirements\.txt/);
    assert.match(v.said, /UNVERIFIED: the read-back did not run, so the board is not verified/);
    assert.match(gerbersAudit(dst).detail, /no pcb\/readback\.json/);
    process.env.PATH = empty;
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.match(r.value.message, /there is no python3 to run it: install Python 3\.12 or newer, then python3 -m pip install --no-deps -r/);
  } finally {
    process.env.PATH = path;
  }

  // A pad that should be on a net and is on a typo of it: the audit fails, so nothing is read back.
  writeFileSync(join(dst, "cad", "pcb.mjs"), board(`\n  pcb.place("kailh-mx-hotswap", { ref: "K1", x: -15, y: 0, side: "bottom", nets: { A: "GP2", B: "GDN" } });`));
  v = await run();
  assert.equal(v.code, 1);
  assert.equal(v.json.status, "failed");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "fail"], ["readback", "not run"], ["order", "not run"]]);
  assert.match(v.said, /FAILED: do not order this board/);
  assert.ok(!readdirSync(join(dst, "pcb")).includes("readback.json"));
  rmSync(tmp, { recursive: true, force: true });
});
