// Tests of the read-back (readback.py) and of what rests on it: the scorer's gate and `sprue verify`. Each check of
// the read-back gets a board that is broken where it looks, put into a copy of the macropad's files, and must fail.
// Run them with
//   node --test skills/sprue/pipeline/pcb/readback.test.ts
// They need Python 3.12 or newer with gerbonara and shapely (requirements.txt here); without them they are skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pcb } from "../pcb.ts";
import { drcAudit, firmwareAudit, firmwareShips, gerbersAudit, readbackAudit, score } from "../stages/score.ts";
import type { Bom, Checks, Quotes, Reference } from "../types.ts";
import { installLine, readbackAfterBuild, readbackPython, runReadback, verify, type Readback } from "../verify.ts";
import { zip } from "./gerber.ts";

/** The params the fit check holds the test boards to: a 61 x 40 mm outline with a Pico at its centre. */
const TINY = { pcbWidthMm: 61, pcbHeightMm: 40, pcbCornerMm: 1, controllerCenterXMm: 0, controllerCenterYMm: 0, controllerLengthMm: 51, controllerWidthMm: 21 };

const READBACK = join(import.meta.dirname, "readback.py");
const PYTHON = readbackPython();
const ready = spawnSync(PYTHON, ["-I", "-c", "import gerbonara, shapely"]).status === 0;
const skip = ready ? false : `gerbonara and shapely are not installed (${installLine()})`;
/** The temporary folders the tests made, removed when they are done. */
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

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
    const tmp = temp("sprue-readback-");
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

/** Reads back a copy of the macropad's files after `change`, in a folder of its own. `cut` changes the zip's bytes. */
async function readBack(change: (f: Files) => void = () => {}, flags: string[] = [], cut: (zip: Buffer) => Buffer = (b) => b): Promise<{ status: number; report: Readback; text: string }> {
  const f = await files();
  change(f);
  const dir = mkdtempSync(join(tmpdir(), "sprue-readback-copy-"));
  try {
    writeFileSync(join(dir, "board.json"), JSON.stringify(f.board));
    writeFileSync(join(dir, f.board.files.netlist), f.d356);
    writeFileSync(join(dir, f.board.files.zip), cut(zip(Object.entries(f.files).map(([name, data]) => ({ name, data })))));
    const r = spawnSync(PYTHON, ["-I", READBACK, dir, ...flags], { encoding: "utf8" });
    const report = JSON.parse(readFileSync(join(dir, "readback.json"), "utf8")) as Readback;
    return { status: r.status ?? -1, report, text: report.errors.join("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  assert.match(r.text, /macropad\.d356 has no record for K5\.A at \(-7\.36, -10\.49\)/);
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

/** `text` with `from` replaced by `to`, which must be there. */
const swap = (text: string, from: string, to: string) => {
  assert.ok(text.includes(from), `no ${from}`);
  return text.split(from).join(to);
};
/** A change to one layer of the zip, by its role in board.json. */
const layer = (r: string, change: (text: string) => string) => (f: Files) => { f.files[role(f, r)] = change(f.files[role(f, r)]); };

test("tracks, spokes and pads drawn under their size, a via with no ring, or copper of two nets too close fails", { skip }, async () => {
  // Every track of a layer drawn 0.01 mm wide: the copper still joins what it joined, as hairlines no fab can etch.
  let r = await readBack(layer("F.Cu", (t) => swap(t, "%ADD21C,0.300000*%", "%ADD21C,0.010000*%")));
  assert.match(r.text, /9 tracks or spokes are drawn under the rules' 0\.25 mm: 0\.01 mm at \(-4\.55, 37\.75\) on F\.Cu/);
  assert.match(r.text, /K1\.A, U1\.14 on F\.Cu and B\.Cu hold together only through copper under 0\.2 mm wide, which a fab may etch through: without it they fall into K1\.A \| U1\.14/);
  r = await readBack(layer("B.Cu", (t) => swap(t, "%ADD11C,0.300000*%", "%ADD11C,0.010000*%")));
  assert.match(r.text, /tracks or spokes are drawn under the rules' 0\.25 mm: 0\.01 mm at .* on B\.Cu/);
  // The pour's thermal spokes 0.01 mm: the Pico's ground pins hang on the pour by hairs.
  r = await readBack(layer("F.Cu", (t) => swap(t, "%ADD23C,0.400000*%", "%ADD23C,0.010000*%")));
  assert.match(r.text, /16 tracks or spokes are drawn under the rules' 0\.25 mm/);
  assert.match(r.text, /K1\.B, K2\.B, K3\.B and 14 more on F\.Cu and B\.Cu hold together only through copper under 0\.2 mm wide.*\| U1\.3 \| U1\.8/);
  // The vias flashed 0.42 mm round their 0.4 mm drills, and the keys' pads 0.05 mm square.
  r = await readBack((f) => {
    layer("F.Cu", (t) => swap(t, "%ADD22C,0.800000*%", "%ADD22C,0.420000*%"))(f);
    layer("B.Cu", (t) => swap(t, "%ADD12C,0.800000*%", "%ADD12C,0.420000*%"))(f);
  });
  assert.match(r.text, /the via at \(-12\.96, -25\.20\) on F\.Cu is flashed 0\.42 mm, and board\.json's is 0\.8 mm/);
  assert.match(r.text, /27 plated drills keep less than the rules' ring of copper round them \(0\.2 mm for a via\): 0\.4 mm at/);
  r = await readBack(layer("B.Cu", (t) => swap(t, "%ADD10R,2.550000X2.500000*%", "%ADD10R,0.050000X0.050000*%")));
  assert.match(r.text, /18 pads or vias are not flashed at their size and shape: K1\.A on B\.Cu is flashed 0\.05 x 0\.05 mm \(0\.002 mm2\), and board\.json's pad is a 2\.55 x 2\.5 mm rect/);
  // The pour cleared 0.41 mm round the other nets' vias instead of 0.7 mm, and a track drawn 0.005 mm from K5.A.
  r = await readBack(layer("F.Cu", (t) => swap(t, "%ADD12C,1.400000*%", "%ADD12C,0.820000*%")));
  assert.match(r.text, /9 pairs of nets keep less than the rules' 0\.2 mm between their copper, which a fab may join: GND and GP10, 0\.0\d+ mm apart at .* on F\.Cu/);
  r = await readBack((f) => {
    const p = pad(f, "K5.A"), x = p.x + p.w / 2 + 0.005 + 0.15;
    f.files[copperOf(f, p)] = stroke(f.files[copperOf(f, p)], 0.3, [[x, p.y + 1.5], [x, p.y - 1.5]], true);
  });
  assert.match(r.text, /1 pair of nets keep less than the rules' 0\.2 mm between their copper, which a fab may join: copper joined to no pad and GP6, 0\.005 mm apart at .* on B\.Cu/);
});

/** A Gerber layer with one more region before its end, the box x0, y0 to x1, y1: dark adds copper, clear takes it
 * away. */
function region(text: string, [x0, y0, x1, y1]: [number, number, number, number], dark: boolean): string {
  const xy = (x: number, y: number) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}`;
  const cmds = [dark ? "%LPD*%" : "%LPC*%", "G36*", `${xy(x0, y0)}D02*`, `${xy(x1, y0)}D01*`, `${xy(x1, y1)}D01*`, `${xy(x0, y1)}D01*`, `${xy(x0, y0)}D01*`, "G37*", "%LPD*%"];
  return text.replace(/M02\*\n$/, `${cmds.join("\n")}\nM02*\n`);
}

test("a pad eaten by a clear object drawn after its flash fails, though copper is left at its centre and its track still reaches it", { skip }, async () => {
  // K1.A cleared all over, 0.01 mm past its edges, and a 0.3 mm strip drawn back from where its track ends on it to
  // its centre: the flash is right, the key still joins its GPIO, and 8% of the pad is left to solder the socket to.
  let r = await readBack((f) => {
    const p = pad(f, "K1.A"), file = copperOf(f, p), g = 0.01;
    const end = [...f.files[file].matchAll(/X(-?\d+)Y(-?\d+)D01\*/g)].map((m) => [Number(m[1]) / 1e6, Number(m[2]) / 1e6] as [number, number])
      .find(([x, y]) => Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2);
    assert.ok(end, "no track ends on K1.A");
    f.files[file] = stroke(region(f.files[file], [p.x - p.w / 2 - g, p.y - p.h / 2 - g, p.x + p.w / 2 + g, p.y + p.h / 2 + g], false), 0.3, [end, [p.x, p.y]], true);
  });
  assert.equal(r.status, 1);
  assert.deepEqual(r.report.errors, [
    "1 pad is not whole once every object is painted: K1.A on B.Cu keeps 0.512 of its 6.375 mm2 (8%); something drawn after the pad clears the rest, so the part has too little copper to be soldered to",
  ]);
  // Every pad of the Pico cleared from its inner edge to 0.2 mm short of its centre: the castellated joints keep
  // their outer half.
  r = await readBack((f) => {
    const u1 = f.board.pads.filter((p) => p.ref === "U1" && p.layers[0] === "F.Cu" && p.h > p.w);
    const cy = (Math.max(...u1.map((p) => p.y)) + Math.min(...u1.map((p) => p.y))) / 2;
    for (const p of u1) {
      const inner = p.y > cy ? p.y - p.h / 2 - 0.01 : p.y + p.h / 2 + 0.01, short = p.y > cy ? p.y - 0.2 : p.y + 0.2;
      f.files[copperOf(f, p)] = region(f.files[copperOf(f, p)], [p.x - p.w / 2 - 0.01, Math.min(inner, short), p.x + p.w / 2 + 0.01, Math.max(inner, short)], false);
    }
  });
  assert.equal(r.status, 1);
  assert.match(r.text, /^40 pads are not whole once every object is painted: U1\.1 \(GP0\) on F\.Cu keeps 2\.88 of its 5\.12 mm2 \(56%\), U1\.2 \(GP1\)/m);
});

test("a mask opening short of its pad, a mask open over a track or the pour, or a legend on an opening fails", { skip }, async () => {
  const dots = (t: string) => t.replace(/%ADD(\d+)[RCO],[^*]*\*%/g, "%ADD$1C,0.050000*%");
  let r = await readBack((f) => { layer("F.Mask", dots)(f); layer("B.Mask", dots)(f); });
  assert.match(r.text, /F\.Mask's openings leave 40 pads partly under the mask, or with less than the rules' 0\.05 mm margin round them: U1\.1 \(GP0\)/);
  assert.match(r.text, /B\.Mask's openings leave 18 pads partly under the mask/);
  // The top copper sent as the top mask: every pad bare, and the pour and the tracks bare too.
  const objects = (t: string) => t.slice(t.indexOf("%MOMM*%\n") + "%MOMM*%\n".length);
  r = await readBack((f) => { f.files[role(f, "F.Mask")] = f.files[role(f, "F.Mask")].slice(0, f.files[role(f, "F.Mask")].indexOf("%ADD10")) + objects(f.files[role(f, "F.Cu")]); });
  assert.match(r.text, /F\.Mask is open in \d+ places over no pad \(3803\.\d+ mm2/);
  r = await readBack(layer("F.Mask", (t) => stroke(t, 0.5, [[-4.55, 37.75], [-4.55, 36.75]], true)));
  assert.match(r.text, /F\.Mask is open in 1 place over no pad \(0\.117 mm2, the largest near \(-4\.77, 37\.25\)\): the copper there, a track, a via or the pour, would be left bare/);
  // The legend: the top copper printed on it, and a blot over most of the board.
  r = await readBack((f) => { f.files[role(f, "F.Silkscreen")] = f.files[role(f, "F.Silkscreen")].slice(0, f.files[role(f, "F.Silkscreen")].indexOf("%ADD10")) + objects(f.files[role(f, "F.Cu")]); });
  assert.match(r.text, /F\.Silkscreen prints [\d.]+ mm2 on the pads' mask openings, or within the rules' 0\.15 mm of them/);
  r = await readBack(layer("F.Silkscreen", (t) => stroke(t, 50, [[0, -20], [0, 20]], true)));
  assert.match(r.text, /F\.Silkscreen prints [\d.]+ mm2 on the pads' mask openings/);
});

test("a Gerber with what a fab's CAM applies and gerbonara does not, a second end or a macro, or a zip cut short fails", { skip }, async () => {
  // Mirrored, rotated, scaled, incremental, stepped and repeated, ended early: each read one way here and another at a fab.
  for (const [from, to, said] of [
    ["%MOMM*%", "%MOMM*%\n%LMXY*%", "%LMXY*%"], ["%MOMM*%", "%MOMM*%\n%LR180*%", "%LR180*%"], ["%MOMM*%", "%MOMM*%\n%LS0.5*%", "%LS0.5*%"],
    ["%MOMM*%", "%MOMM*%\nG91*", "G91*"], ["%FSLAX46Y46*%", "%FSLIX46Y46*%", "%FSLIX46Y46*%"],
  ]) {
    const r = await readBack(layer("F.Cu", (t) => swap(t, from, to)));
    assert.equal(r.status, 1);
    assert.equal(r.text, `macropad-F_Cu.gtl has 1 statement our writer never writes, which a fab's CAM would apply and the read-back cannot trust gerbonara to: ${said}`);
  }
  let r = await readBack(layer("F.Cu", (t) => swap(swap(t, "%MOMM*%", "%MOMM*%\n%SRX2Y1I0.5J0*%"), "M02*", "%SR*%\nM02*")));
  assert.match(r.text, /macropad-F_Cu\.gtl has 2 statements our writer never writes, .*: %SRX2Y1I0\.5J0\*%, %SR\*%/);
  r = await readBack(layer("F.Cu", (t) => t.replace("%LPD*%", "M02*\n%LPD*%")));
  assert.match(r.text, /macropad-F_Cu\.gtl ends \(M02\) 2 times: it must end once, last, since a fab stops reading at the first M02/);
  // A macro whose second primitive is exposure off: gerbonara paints it as clear, a fab's CAM as a hole in the flash
  // only, so a short hidden under it would be read back as no short.
  r = await readBack(layer("B.Cu", (t) => swap(t, "%ADD12C,0.800000*%", "%ADD12C,0.800000*%\n%AMHIDE*1,1,0.05,0,3*1,0,1.0,0,0*%\n%ADD99HIDE*%")));
  assert.match(r.text, /macropad-B_Cu\.gbl has 4 statements our writer never writes, .*: %AMHIDE\*%, %1,1,0\.05,0,3\*%, %1,0,1\.0,0,0\*%, %ADD99HIDE\*%/);
  // A via aperture with a hole in it: gerbonara paints the hole clear over the copper under it, a fab only in the flash.
  r = await readBack(layer("B.Cu", (t) => swap(t, "%ADD12C,0.800000*%", "%ADD12C,0.800000X0.400000*%")));
  assert.match(r.text, /macropad-B_Cu\.gbl has 1 statement our writer never writes, .*: %ADD12C,0\.800000X0\.400000\*%/);
  // A moire, which gerbonara cannot draw: the files check fails with the reason, and readback.json is written.
  r = await readBack(layer("F.Cu", (t) => swap(swap(t, "%ADD23C,0.400000*%", "%ADD23C,0.400000*%\n%AMMOIRE*6,0,0,1.0,0.1,0.1,2,0.05,1.2,0*%\n%ADD98MOIRE*%"), "M02*", "D98*\nX0Y0D03*\nM02*")));
  assert.equal(r.status, 1);
  assert.match(r.text, /macropad-F_Cu\.gtl cannot be drawn \(AttributeError: .*\): it holds something our writer never writes/);
  assert.deepEqual(r.report.checks.filter((c) => !c.ok).map((c) => c.id), ["files", "outline", "copper", "sizes", "mask", "intent", "netlist", "x2"]);
  r = await readBack(() => {}, [], (b) => b.subarray(0, 5000));
  assert.equal(r.status, 1);
  assert.match(r.text, /^macropad-gerbers\.zip does not unzip \(.*\): it is not a whole zip, so a fab could not read it either$/);
});

test("an outline moved off where board.json has it, so copper comes nearer its edge than the rules allow, fails", { skip }, async () => {
  const r = await readBack(layer("Edge.Cuts", (t) => t.replace(/^X(-?\d+)Y(-?\d+)D0/gm, (_, x, y) => `X${Number(x) + 400000}Y${Number(y) - 500000}D0`)));
  assert.match(r.text, /the outline is 0\.4 mm in x and -0\.5 mm in y off where board\.json has it: the fab cuts the board there/);
  assert.match(r.text, /F\.Cu copper comes 0 mm from the board edge near .*, under the rules' 0\.5 mm/);
});

test("a Pico soldered through its own holes, two pads and two .d356 records a pin, reads back clean, and its self-test still has a fault to put in", { skip }, async () => {
  const tmp = temp("sprue-through-"), dst = join(tmp, "products", "through");
  try {
    mkdirSync(join(dst, "cad"), { recursive: true });
    writeFileSync(join(dst, "cad", "pcb.mjs"), `export default function board({ pcb }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" }, throughHoles: { drillMm: 1.0, padMm: 1.6 } });
  pcb.pour("GND", "B.Cu");
}
`);
    writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "through", params: TINY }));
    assert.equal((await quietly(tmp, () => pcb("through"))).value, true);
    const r = spawnSync(PYTHON, ["-I", READBACK, join(dst, "pcb"), "--self-test"], { encoding: "utf8" });
    const report = JSON.parse(readFileSync(join(dst, "pcb", "readback.json"), "utf8")) as Readback;
    assert.equal(r.status, 0, report.errors.join("\n"));
    assert.equal(report.stats.d356Records, 84);
    // With no keys and a plated hole beside every pad, the self-test can still short the Pico's VBUS, VSYS and GND.
    assert.deepEqual(report.selfTest?.cases.filter((c) => c.ran).map((c) => [c.fault, c.ok]), [["a 0.3 mm sliver from U1.40 (VBUS) through U1.39 (VSYS) to U1.38 (GND) on F.Cu", true]]);
    assert.equal(report.selfTest?.ok, true);

    // A board with nothing on it to put a fault into: the self-test did not run, which is unverified, not failed.
    writeFileSync(join(dst, "cad", "pcb.mjs"), `export default function board({ pcb }) {\n  pcb.outline(61, 40, 1);\n}\n`);
    writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "through", params: { pcbWidthMm: 61, pcbHeightMm: 40, pcbCornerMm: 1 } }));
    const v = await quietly(tmp, () => verify("through"));
    const json = JSON.parse(readFileSync(join(dst, "pcb", "verify.json"), "utf8"));
    assert.equal(v.value, 2, v.said);
    assert.deepEqual(json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "pass"], ["readback", "pass"], ["self-test", "not run"], ["order", "not run"]]);
    assert.match(v.said, /· read-back self-test: .*: not run: no fault could be put into this board/);
    assert.match(v.said, /UNVERIFIED: the read-back's self-test could put no fault into this board, so the board is not verified and no order folder was written/);
    assert.match(readbackAudit(dst, "pcb/through-gerbers.zip", { selfTest: true }).detail, /^the read-back's self-test could put no fault into this board/);
    // sprue cad's read-back, without a self-test, does not keep that as a failure.
    assert.equal((await quietly(tmp, async () => readbackAfterBuild("through"))).value, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- the scorer's gate and the verify command ----

test("the scorer and the packager refuse a zip with no read-back, a failed or stale one, and take a current one", { skip }, async () => {
  const tmp = temp("sprue-gate-"), dst = join(tmp, "products", "macropad");
  cpSync(await macropad(), dst, { recursive: true });
  const rb = join(dst, "pcb", "readback.json"), zipFile = join(dst, "pcb", "macropad-gerbers.zip");
  rmSync(rb, { force: true });
  assert.ok(drcAudit(dst).ok);
  assert.match(gerbersAudit(dst).detail, /no pcb\/readback\.json, so nothing but our own code has read the files: run sprue verify/);
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
  assert.match(gerbersAudit(dst, "pcb/other-gerbers.zip").detail, /^bom\.json names pcb\/other-gerbers\.zip, and the read-back read pcb\/macropad-gerbers\.zip, the board's zip/);
  // A zip of the same name elsewhere (an old revision, another board's) is not the one read back; the same path
  // written another way is.
  mkdirSync(join(dst, "pcb", "rev1"));
  writeFileSync(join(dst, "pcb", "rev1", "macropad-gerbers.zip"), "another board's zip");
  assert.match(gerbersAudit(dst, "pcb/rev1/macropad-gerbers.zip").detail, /^bom\.json names pcb\/rev1\/macropad-gerbers\.zip, and the read-back read pcb\/macropad-gerbers\.zip/);
  assert.ok(gerbersAudit(dst, "./pcb/macropad-gerbers.zip").ok);
  // The scorer takes any line whose file is in pcb/, however its path is written, or a PCB line, for the board, and
  // holds it to the board's gates: without a read-back none of them is ok.
  const lines = ["./pcb/macropad-gerbers.zip", "pcb/rev1/macropad-gerbers.zip", "pcb/../pcb/macropad.d356"].map((file, i) => ({ id: `l${i}`, name: file, role: "pcb", process: "print", qtyPerUnit: 1, spec: {}, file }));
  lines.push({ id: "l3", name: "PCB", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: {}, file: "fab/macropad-gerbers.zip" });
  cpSync(zipFile, join(dst, "fab", "macropad-gerbers.zip"));
  const scored = () => score(dst, { slug: "macropad", units: 1, lines } as unknown as Bom, { failed: 0, flagged: 0 } as Checks, { batchUsd: 1 } as Quotes,
    { roles: [{ role: "pcb" }], batchUsd: { low: 1, high: 1 } } as unknown as Reference).files.map((f) => [f.name, f.ok]);
  assert.deepEqual(scored(), [["./pcb/macropad-gerbers.zip", true], ["pcb/rev1/macropad-gerbers.zip", false], ["pcb/../pcb/macropad.d356", false], ["fab/macropad-gerbers.zip", false]]);
  rmSync(rb);
  assert.deepEqual(scored().map(([, ok]) => ok), [false, false, false, false]);
  write(report);
  writeFileSync(zipFile, Buffer.concat([readFileSync(zipFile), Buffer.from([0])]));
  assert.match(gerbersAudit(dst).detail, /pcb\/macropad-gerbers\.zip is not the file the read-back read/);
  rmSync(tmp, { recursive: true, force: true });
});

/** A Python for SPRUE_PYTHON that runs `prelude` and then the script it is given, as python3 -I would. */
function fakePython(dir: string, name: string, prelude: string): string {
  const python = spawnSync(PYTHON, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim(), file = join(dir, name);
  const code = `${prelude}; import runpy, sys; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")`;
  writeFileSync(file, `#!/bin/sh\n[ "$1" = "-I" ] && shift\nexec "${python}" -I -c '${code}' "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}

/** Runs `fn` with these environment variables set (undefined: unset), and puts them back after. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const put = (vs: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(vs)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    put(env);
    return await fn();
  } finally {
    put(was);
  }
}

test("sprue verify passes a sound board, says UNVERIFIED without gerbonara or Python, and FAILED on an audit error", { skip }, async () => {
  const tmp = temp("sprue-verify-"), dst = join(tmp, "products", "tiny");
  mkdirSync(join(dst, "cad"), { recursive: true });
  const board = (extra: string) => `export default function board({ pcb }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  pcb.pour("GND", "F.Cu");${extra}
}
`;
  writeFileSync(join(dst, "cad", "pcb.mjs"), board(""));
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: TINY }));
  // A code.py of the user's own on a board with no keys: board.json lists no keys, so there is no firmware to run.
  mkdirSync(join(dst, "firmware"));
  writeFileSync(join(dst, "firmware", "code.py"), "print('hello')\n");
  const run = async () => {
    const { value, said } = await quietly(tmp, () => verify("tiny"));
    return { code: value, said, json: JSON.parse(readFileSync(join(dst, "pcb", "verify.json"), "utf8")) };
  };
  let v = await run();
  assert.equal(v.code, 0, v.said);
  assert.equal(v.json.status, "verified");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "pass"], ["readback", "pass"], ["self-test", "pass"], ["order", "pass"]]);
  assert.match(v.said, /✓ read-back self-test: a 0\.3 mm cut all round U1\.3 on F\.Cu and a 0\.3 mm sliver from U1\.40 \(VBUS\) through U1\.39 \(VSYS\) to U1\.38 \(GND\) on F\.Cu, each put into a copy of the files, must fail and an unchanged copy pass: each was caught/);
  assert.match(v.said, /VERIFIED: every layer passed/);
  // The audit's line says what the fit check held to the case's params, as drc.json lists it.
  assert.match(v.said, /✓ PCB audit: .*, the parts against the params the case is built from \(the 61 x 40 mm outline and U1 at its place with its USB end to \+x\), and our DRC/);
  assert.equal(readFileSync(join(dst, "firmware", "code.py"), "utf8"), "print('hello')\n");

  // A Python that sees no installed packages (-S), named by SPRUE_PYTHON: the board is unverified, and it says how
  // to install what is missing into that Python.
  const python = spawnSync(PYTHON, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  const bin = join(tmp, "bin"), empty = join(tmp, "empty");
  mkdirSync(bin);
  mkdirSync(empty);
  writeFileSync(join(bin, "python3"), `#!/bin/sh\nexec "${python}" -S "$@"\n`);
  chmodSync(join(bin, "python3"), 0o755);
  await withEnv({ SPRUE_PYTHON: join(bin, "python3") }, async () => {
    v = await run();
    assert.equal(v.code, 2);
    assert.equal(v.json.status, "unverified");
    assert.match(v.said, new RegExp(`· read-back: .*: not run: the read-back needs gerbonara and shapely, and gerbonara is not installed for ${python.replaceAll(".", "\\.")}: ${join(bin, "python3").replaceAll(".", "\\.")} -m pip install --no-deps -r .*requirements\\.txt \\(or unset SPRUE_PYTHON to use the read-back's own venv\\)`));
    assert.match(v.said, /UNVERIFIED: the read-back did not run, so the board is not verified/);
    assert.match(gerbersAudit(dst).detail, /no pcb\/readback\.json/);
  });
  // gerbonara at another version than the pin: unverified too, not FAILED, and the line installs the pinned one.
  const fake = join(tmp, "fake");
  mkdirSync(join(fake, "gerbonara-9.9.9.dist-info"), { recursive: true });
  writeFileSync(join(fake, "gerbonara-9.9.9.dist-info", "METADATA"), "Metadata-Version: 2.1\nName: gerbonara\nVersion: 9.9.9\n");
  await withEnv({ SPRUE_PYTHON: fakePython(bin, "pinned", `import sys; sys.path.insert(0, ${JSON.stringify(fake)})`), SPRUE_CACHE: empty }, async () => {
    v = await run();
    assert.equal(v.code, 2);
    assert.match(v.said, /not run: the read-back is pinned to gerbonara 1\.6\.3 and shapely 2\.2\.0, and .* has gerbonara 9\.9\.9: .* -m pip install --no-deps -r /);
  });
  // A Python older than 3.12 named by SPRUE_PYTHON: its own exit status, and the fix is to point it at a newer
  // one, not to install into it.
  await withEnv({ SPRUE_PYTHON: fakePython(bin, "old", "import sys; sys.version_info = (3, 11, 9)") }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.match(r.value.message, /the read-back needs Python 3\.12 or newer \(gerbonara does\), and .* is 3\.11\.9: install Python 3\.12 or newer$/);
    assert.equal(r.value.fix, "point SPRUE_PYTHON at Python 3.12 or newer, or unset it to use the read-back's own venv, then run sprue verify tiny again");
  });
  // The read-back's venv made with that Python: the fix makes it again (--clear, so its old Python does not stay in
  // it) with a newer one the PATH has.
  const cache = join(tmp, "cache"), venvPython = join(cache, "venv", "bin", "python3");
  mkdirSync(join(cache, "venv", "bin"), { recursive: true });
  cpSync(fakePython(bin, "old", "import sys; sys.version_info = (3, 11, 9)"), venvPython);
  await withEnv({ SPRUE_PYTHON: undefined, SPRUE_CACHE: cache }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.match(r.value.message, /^the read-back's venv at .*cache\/venv was made with Python 3\.11\.9, and the read-back needs 3\.12 or newer \(gerbonara does\)$/);
    assert.match(r.value.fix ?? "", /^make the venv again with a Python 3\.12 or newer: python3[.\d]* -m venv --clear .*cache\/venv && .*cache\/venv\/bin\/python -m pip install --no-deps -r .*requirements\.txt, then run sprue verify tiny again$/);
  });
  // Its Python removed since (a brew upgrade, a pyenv uninstall): bin/python3 points nowhere. That is said, and not
  // passed over for another Python.
  rmSync(venvPython);
  symlinkSync(join(tmp, "gone", "python3.11"), venvPython);
  await withEnv({ SPRUE_PYTHON: undefined, SPRUE_CACHE: cache }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.match(r.value.message, /^the read-back's venv at .*cache\/venv has no Python that runs \(the Python it was made with was removed or moved\)$/);
    assert.match(r.value.fix ?? "", /^make it again: python3[.\d]* -m venv --clear .*cache\/venv && /);
  });
  rmSync(join(cache, "venv"), { recursive: true });
  // No Python at all: neither SPRUE_PYTHON's nor a python3 on the PATH (and no venv in an empty cache).
  await withEnv({ SPRUE_PYTHON: join(tmp, "nothing", "python3") }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.match(r.value.message, /^SPRUE_PYTHON is .*nothing\/python3, and there is no Python there to run it$/);
  });
  await withEnv({ SPRUE_PYTHON: undefined, SPRUE_CACHE: empty, PATH: empty }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    assert.equal(r.value.message, "there is no python3 to run it");
    assert.match(r.value.fix ?? "", /^install Python 3\.12 or newer, then python3\.12 -m venv --clear .*empty\/venv && .*empty\/venv\/bin\/python -m pip install --no-deps -r .*requirements\.txt \(with the name of the Python you installed, if it is not python3\.12\), then run sprue verify tiny again$/);
  });
  // A python3 that is not Python: the macOS stub without the developer tools (it exits 1), a pyenv shim with no
  // version set (127). The board is unverified, not failed, and verify says to install Python.
  for (const [name, said, status] of [["xcode", "xcode-select: note: No developer tools were found, requesting install.", 1], ["pyenv", "pyenv: python3: command not found", 127]] as const) {
    const stub = join(tmp, name);
    mkdirSync(stub);
    writeFileSync(join(stub, "python3"), `#!/bin/sh\necho "${said}" >&2\nexit ${status}\n`);
    chmodSync(join(stub, "python3"), 0o755);
    await withEnv({ SPRUE_PYTHON: undefined, SPRUE_CACHE: empty, PATH: stub }, async () => {
      const r = await quietly(tmp, async () => runReadback("tiny"));
      assert.equal(r.value.status, "unverified", r.value.message);
      assert.equal(r.value.message, `python3 here is not a Python that runs: it said "${said}" and exited ${status}`);
      assert.match(r.value.fix ?? "", /^install Python 3\.12 or newer, then python3\.12 -m venv --clear /);
      v = await run();
      assert.equal(v.code, 2, v.said);
      assert.match(v.said, /· read-back: .*: not run: python3 here is not a Python that runs/);
      assert.match(v.said, /UNVERIFIED: the read-back did not run/);
      // sprue cad's read-back says the same, and does not fail the build.
      const cad = await quietly(tmp, async () => readbackAfterBuild("tiny"));
      assert.equal(cad.value, true);
      assert.match(cad.said, /· read-back not run: python3 here is not a Python that runs/);
    });
  }

  // A pad that should be on a net and is on a typo of it: the audit fails, so nothing is read back.
  writeFileSync(join(dst, "cad", "pcb.mjs"), board(`\n  pcb.place("kailh-mx-hotswap", { ref: "K1", x: -15, y: 0, side: "bottom", nets: { A: "GP2", B: "GDN" } });`));
  v = await run();
  assert.equal(v.code, 1);
  assert.equal(v.json.status, "failed");
  assert.deepEqual(v.json.layers.map((l: { id: string; status: string }) => [l.id, l.status]), [["audit", "fail"], ["readback", "not run"], ["order", "not run"]]);
  assert.match(v.said, /FAILED: do not order this board/);
  assert.ok(!readdirSync(join(dst, "pcb")).includes("readback.json"));
  // A product with no board: nothing to verify, and no pcb/ is made for a verify.json.
  rmSync(join(dst, "cad", "pcb.mjs"));
  rmSync(join(dst, "pcb"), { recursive: true, force: true });
  const none = await quietly(tmp, () => verify("tiny"));
  assert.equal(none.value, 2);
  assert.match(none.said, /^verify tiny: products\/tiny has no board \(cad\/pcb\.mjs\), so there is nothing to verify/);
  assert.ok(!existsSync(join(dst, "pcb")));
});

const old311 = spawnSync("python3.11", ["-c", "pass"]).status === 0;
test("the fix printed for a venv made with Python 3.11 makes it again with a newer one, so verify does not stop there again", { skip: skip || (!old311 && "there is no python3.11 here to make an old venv with") }, async () => {
  const tmp = temp("sprue-oldvenv-"), cache = join(tmp, "cache"), dst = join(tmp, "products", "tiny");
  mkdirSync(join(dst, "cad"), { recursive: true });
  writeFileSync(join(dst, "cad", "pcb.mjs"), `export default function board({ pcb }) {\n  pcb.outline(61, 40, 1);\n  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });\n  pcb.pour("GND", "F.Cu");\n}\n`);
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: TINY }));
  assert.equal((await quietly(tmp, () => pcb("tiny"))).value, true);
  assert.equal(spawnSync("python3.11", ["-m", "venv", "--without-pip", join(cache, "venv")]).status, 0);
  await withEnv({ SPRUE_PYTHON: undefined, SPRUE_CACHE: cache }, async () => {
    const r = await quietly(tmp, async () => runReadback("tiny"));
    assert.equal(r.value.status, "unverified");
    // The first half of the line, as a user would run it: the venv made again, and its python3 now 3.12 or newer.
    const make = /(\S+ -m venv --clear \S+) &&/.exec(r.value.fix ?? "")?.[1];
    assert.ok(make, r.value.fix);
    assert.equal(spawnSync("sh", ["-c", make], { encoding: "utf8" }).status, 0);
    const v = spawnSync(join(cache, "venv", "bin", "python3"), ["-c", "import sys; print(sys.version_info >= (3, 12))"], { encoding: "utf8" });
    assert.equal(v.stdout.trim(), "True");
  });
});

test("a failed self-test or firmware run holds until the zip or code.py changes; package ships only this board's firmware with its zip", { skip }, async () => {
  const tmp = temp("sprue-hold-"), dst = join(tmp, "products", "macropad");
  cpSync(join(import.meta.dirname, "..", "..", "examples", "macropad"), dst, { recursive: true, filter: (f) => !/[/\\](production|pcb|fil\.json)$/.test(f) });
  assert.equal((await quietly(tmp, () => pcb("macropad"))).value, true);
  const sha = (f: string) => createHash("sha256").update(readFileSync(join(dst, f))).digest("hex");
  const rbFile = join(dst, "pcb", "readback.json"), zipName = "pcb/macropad-gerbers.zip";
  assert.equal((await quietly(tmp, async () => runReadback("macropad", { selfTest: true }))).value.status, "pass");
  assert.ok(readbackAudit(dst, zipName, { selfTest: true }).ok);
  // The self-test failed on this zip: sprue cad's read-back, which has none, does not wipe that out.
  const rb = JSON.parse(readFileSync(rbFile, "utf8")) as Readback;
  writeFileSync(rbFile, JSON.stringify({ ...rb, ok: false, selfTest: { ...rb.selfTest!, ok: false } }));
  assert.equal((await quietly(tmp, async () => readbackAfterBuild("macropad"))).value, false);
  assert.match(gerbersAudit(dst).detail, /the read-back's self-test failed/);
  // Without a self-test at all, the scorer takes the zip and package does not.
  assert.equal((await quietly(tmp, async () => runReadback("macropad"))).value.status, "pass");
  assert.ok(gerbersAudit(dst).ok);
  assert.match(gerbersAudit(dst, zipName, { selfTest: true }).detail, /the read-back's self-test has not run on this zip/);
  assert.equal((await quietly(tmp, async () => runReadback("macropad", { selfTest: true }))).value.status, "pass");

  // A run of the board's own firmware that failed on this zip: sprue pcb, building the same board again, keeps it.
  const drc = JSON.parse(readFileSync(join(dst, "pcb", "drc.json"), "utf8"));
  const own = JSON.parse(readFileSync(join(dst, "pcb", "board.json"), "utf8")).firmwareCode as { file: string; sha256: string };
  assert.equal(own.sha256, sha("firmware/code.py"));
  const fil = { inputs: drc.inputs, ok: false, errors: ["K5 typed nothing"], firmware: own, netlist: { zip: "macropad-gerbers.zip", zipSha256: sha(zipName) } };
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify(fil));
  assert.match(gerbersAudit(dst).detail, /^the board's firmware, run on the copper read back, found: K5 typed nothing$/);
  writeFileSync(join(dst, "pcb", "verify.json"), "{}");
  assert.equal((await quietly(tmp, () => pcb("macropad"))).value, true);
  assert.ok(!existsSync(join(dst, "pcb", "verify.json")), "sprue pcb leaves a verify.json of the board before");
  assert.ok(existsSync(join(dst, "firmware", "fil.json")));
  assert.match(firmwareAudit(dst).detail, /found: K5 typed nothing/);
  // An edited code.py does not clear it: the run was of the board's own firmware, so the failure is the copper's.
  // Package does not ship the edited code.py either.
  const code = readFileSync(join(dst, "firmware", "code.py"), "utf8");
  assert.deepEqual(firmwareShips(dst), { ok: true, detail: "the firmware sprue pcb wrote for this board" });
  writeFileSync(join(dst, "firmware", "code.py"), `${code}# an edit\n`);
  assert.match(firmwareAudit(dst).detail, /found: K5 typed nothing/);
  assert.match(firmwareShips(dst).detail, /^firmware\/code\.py is not the one sprue pcb wrote for this board/);
  // With the board's run passed, the user's code.py ships once its own run passed on this zip; a run of it that
  // failed is the code's, and refuses the zip nothing.
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: true, errors: [], yours: { ok: true, sha256: sha("firmware/code.py") } }));
  assert.deepEqual(firmwareShips(dst), { ok: true, detail: "your firmware/code.py, which the firmware run passed on this zip" });
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: true, errors: [], yours: { ok: false, sha256: sha("firmware/code.py"), errors: ["it never became a keyboard"] } }));
  assert.ok(gerbersAudit(dst).ok, gerbersAudit(dst).detail);
  assert.equal(firmwareShips(dst).ok, false);
  rmSync(join(dst, "firmware", "fil.json"));

  // `sprue package`: a keypad's zip goes in only once its firmware has run on it and passed (as when sprue
  // verify ended UNVERIFIED for want of the emulator, there is no fil.json), and the zip and the firmware go in
  // together, or neither does.
  const cli = join(import.meta.dirname, "..", "..", "bin", "sprue");
  const pack = () => spawnSync(cli, ["package", "macropad"], { cwd: tmp, encoding: "utf8" });
  let out = pack();
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /✗ not packaged: .*\(pcb\/macropad-gerbers\.zip\): the board's firmware has not been run on that copper yet: run sprue verify, which runs it, until it ends VERIFIED/);
  assert.ok(!existsSync(join(dst, "production", "macropad-gerbers.zip")));
  assert.ok(gerbersAudit(dst, zipName).ok, "the scorer still takes it, and says the firmware has not run");
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, presses: [] }));
  assert.match(gerbersAudit(dst, zipName, { selfTest: true }).detail, /found: K5 typed nothing/);
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: true, errors: [], firmware: { ...own, sha256: "0" } }));
  assert.match(gerbersAudit(dst, zipName, { selfTest: true }).detail, /^firmware\/fil\.json is of an earlier board, zip or firmware/);
  writeFileSync(join(dst, "firmware", "fil.json"), JSON.stringify({ ...fil, ok: true, errors: [] }));
  out = pack();
  assert.match(out.stdout, /✗ not packaged: firmware \(firmware\/code\.py\): firmware\/code\.py is not the one sprue pcb wrote for this board/);
  assert.ok(existsSync(join(dst, "production", "macropad-gerbers.zip")));
  assert.ok(!existsSync(join(dst, "production", "firmware")));
  writeFileSync(join(dst, "firmware", "code.py"), code);
  out = pack();
  assert.ok(existsSync(join(dst, "production", "firmware", "code.py")), out.stdout);
  rmSync(rbFile);
  out = pack();
  assert.match(out.stdout, /✗ not packaged: .*no pcb\/readback\.json/);
  assert.match(out.stdout, /✗ not packaged: firmware \(firmware\/code\.py\): it goes only with the board's zip, which is not packaged/);
  assert.ok(!existsSync(join(dst, "production", "macropad-gerbers.zip")));
  assert.ok(!existsSync(join(dst, "production", "firmware")));

  // A code.py of the user's own is left as it is: the board's firmware goes beside it.
  writeFileSync(join(dst, "firmware", "code.py"), "# mine\n");
  const built = await quietly(tmp, () => pcb("macropad"));
  assert.equal(built.value, true);
  assert.equal(readFileSync(join(dst, "firmware", "code.py"), "utf8"), "# mine\n");
  assert.equal(readFileSync(join(dst, "firmware", "code.sprue.py"), "utf8"), code);
  assert.match(built.said, /firmware\/code\.py is not one sprue pcb wrote, so it is left as it is: wrote this board's firmware to firmware\/code\.sprue\.py beside it/);
});
