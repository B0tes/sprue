// Tests of the order hand-off (order.ts) and of what keeps the pipeline off the fabs. Each fab's zip must hold exactly
// the files that fab's naming says, the board's own Gerbers byte for byte and the drill files in its format; a zip
// that does not read back as the board (a drill format, a name or a netlist gone wrong) must stop the whole folder;
// a board that fails or is unverified gets none; and fetch must refuse every fab and order call. Run them with
//   node --test skills/distinta/pipeline/pcb/order.test.ts
// The read-back tests need Python 3.12 or newer with gerbonara and shapely (requirements.txt here); without them they
// are skipped, and the rest still run.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { PINNED } from "../firmware/cache.ts";
import { pcb } from "../pcb.ts";
import { handOff, installLine, readbackPython, verify, type Layer } from "../verify.ts";
import { unzip, zip } from "./gerber.ts";
import { dropStaleOrder, FAB_ORDERS, fabPackages, guardNetwork, ORDER_CALLS, orderMd, readme, refusal, STOP, verified, type BoardJson, type FabPackage, type Verified } from "./order.ts";
import { FAB_PROFILES } from "./rules.ts";

/** The params the fit check holds the test boards to: a 61 x 40 mm outline with a Pico at its centre. */
const TINY = { pcbWidthMm: 61, pcbHeightMm: 40, pcbCornerMm: 1, controllerCenterXMm: 0, controllerCenterYMm: 0, controllerLengthMm: 51, controllerWidthMm: 21 };

const ready = spawnSync(readbackPython(), ["-I", "-c", "import gerbonara, shapely"]).status === 0;
const skip = ready ? false : `gerbonara and shapely are not installed (${installLine()})`;
const PIPELINE = join(import.meta.dirname, "..");

/** Runs `fn` in `dir` (the products/ folder's parent) with console.log silenced, and gives back what it printed. */
async function quietly<T>(dir: string, fn: () => Promise<T> | T): Promise<{ value: T; said: string }> {
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

/** Every file under `dir`, relative to it, sorted. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)).map((g) => `${f}/${g}`) : [f])).sort();

/** What each fab's zip must hold, in order, for a product called `s`: written out here, not taken from order.ts. */
const EXPECTED = (s: string): Record<string, string[]> => ({
  jlcpcb: [`${s}-F_Cu.gtl`, `${s}-B_Cu.gbl`, `${s}-F_Mask.gts`, `${s}-B_Mask.gbs`, `${s}-F_Silkscreen.gto`, `${s}-Edge_Cuts.gm1`, `${s}-PTH.drl`, `${s}-NPTH.drl`],
  pcbway: [`${s}-F_Cu.gbr`, `${s}-B_Cu.gbr`, `${s}-F_Mask.gbr`, `${s}-B_Mask.gbr`, `${s}-F_SilkS.gbr`, `${s}-Edge_Cuts.gbr`, `${s}-PTH.drl`, `${s}-NPTH.drl`, "PCBWay_netlist.ipc"],
  oshpark: [`${s}.gtl`, `${s}.gbl`, `${s}.gts`, `${s}.gbs`, `${s}.gto`, `${s}.gko`, `${s}-PTH.xln`, `${s}-NPTH.xln`],
  aisler: [`${s}.toplayer.ger`, `${s}.bottomlayer.ger`, `${s}.topsoldermask.ger`, `${s}.bottomsoldermask.ger`, `${s}.topsilkscreen.ger`, `${s}.boardoutline.ger`, `${s}.drills_pth.xln`, `${s}.holes_npth.xln`],
});

/** The temporary folders the tests made, removed when they are done, passed or not. */
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

let built: Promise<string> | undefined;
/** The macropad, built once by `distinta pcb` (no Python) into a temporary products/ folder: its product folder. */
function macropad(): Promise<string> {
  built ??= (async () => {
    const tmp = temp("distinta-order-");
    const src = join(import.meta.dirname, "..", "..", "examples", "macropad"), dst = join(tmp, "products", "macropad");
    for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(src, f), join(dst, f));
    assert.equal((await quietly(tmp, () => pcb("macropad"))).value, true);
    return dst;
  })();
  return built;
}

/** What the hand-off works from, read straight from the built files, as verified() would after a read-back. */
async function asVerified(): Promise<Verified> {
  const pcbDir = join(await macropad(), "pcb");
  const board = JSON.parse(readFileSync(join(pcbDir, "board.json"), "utf8")) as BoardJson;
  return {
    board, drc: JSON.parse(readFileSync(join(pcbDir, "drc.json"), "utf8")), readback: { ok: true, inputs: board.inputs, stats: { d356Records: 129 } },
    d356: readFileSync(join(pcbDir, board.files.netlist), "utf8"),
    files: new Map(unzip(readFileSync(join(pcbDir, board.files.zip))).map((f) => [f.name, f.data.toString("utf8")])),
  };
}

/** A drill file's tools (mm) and holes (mm), read by this test on its own: a decimal point means the number as it
 * is, and none means the 2:4 inch format. */
function drillsOf(text: string): { inch: boolean; holes: [number, number, number][] } {
  const inch = /^INCH/m.test(text), unit = inch ? 25.4 : 1, tools = new Map<string, number>(), holes: [number, number, number][] = [];
  const num = (v: string) => (v.includes(".") ? Number(v) : Number(v) / 1e4) * unit;
  let tool = "";
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^T(\d+)C([\d.]+)$/.exec(line))) tools.set(m[1], Number(m[2]) * unit);
    else if ((m = /^T(\d+)$/.exec(line))) tool = m[1];
    else if ((m = /^X(-?[\d.]+)Y(-?[\d.]+)$/.exec(line))) holes.push([num(m[1]), num(m[2]), tools.get(tool)!]);
  }
  return { inch, holes };
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Every hole of `want` in `got`, to within `tol` mm in place and size. */
function sameHoles(got: [number, number, number][], want: { x: number; y: number; d: number }[], tol: number) {
  assert.equal(got.length, want.length);
  for (const w of want) assert.ok(got.some(([x, y, d]) => near(x, w.x, tol) && near(y, w.y, tol) && near(d, w.d, tol)), `no hole of ${w.d} mm at (${w.x}, ${w.y})`);
}

// ---- the zips and the texts, with no Python ----

test("every fab profile has a hand-off, and each fab's zip holds exactly its files: the board's Gerbers byte for byte, the drills in its format", async () => {
  assert.deepEqual(Object.keys(FAB_ORDERS).sort(), Object.keys(FAB_PROFILES).sort());
  const v = await asVerified();
  const { packages, skipped } = fabPackages(v);
  assert.deepEqual(skipped, []);
  assert.deepEqual(packages.map((p) => p.id), ["jlcpcb", "pcbway", "oshpark", "aisler"]);
  const own = [...v.files.values()];
  for (const p of packages) {
    const inZip = unzip(p.bytes);
    assert.deepEqual(inZip.map((f) => f.name), EXPECTED("macropad")[p.id], p.id);
    assert.equal(p.zip, `macropad-${p.id}.zip`);
    // The six Gerbers, in board.json's order, are the files the read-back passed.
    inZip.slice(0, 6).forEach((f, i) => assert.equal(f.data.toString("utf8"), own[i], `${p.id}: ${f.name}`));
    const [pth, npth] = inZip.slice(6, 8).map((f) => f.data.toString("utf8"));
    const format = { jlcpcb: /^METRIC$/m, pcbway: /^INCH$/m, oshpark: /^INCH,TZ,00\.0000$/m, aisler: /^INCH,TZ,00\.0000$/m }[p.id]!;
    assert.match(pth, format, p.id);
    assert.match(npth, format, p.id);
    // The comment KiCad writes says the same as the header a fab reads.
    const comment = { jlcpcb: "metric / decimal", pcbway: "inch / decimal", oshpark: "2:4/ absolute / inch / keep zeros", aisler: "2:4/ absolute / inch / keep zeros" }[p.id]!;
    for (const text of [pth, npth]) assert.ok(text.split("\n").some((l) => l.startsWith("; FORMAT={") && l.includes(comment)), p.id);
    for (const [text, want] of [[pth, v.board.drills.plated], [npth, v.board.drills.nonPlated]] as const) {
      const got = drillsOf(text);
      assert.equal(got.inch, p.id !== "jlcpcb");
      // 2:4 keeps every digit: six of them, with a sign when below zero.
      if (p.drills === "inch 2:4") assert.ok(text.split("\n").filter((l) => /^X/.test(l)).every((l) => /^X-?\d{6}Y-?\d{6}$/.test(l)), p.id);
      sameHoles(got.holes, want, p.id === "jlcpcb" ? 0.0005 : 0.0013);
    }
    assert.match(pth, /TF\.FileFunction,Plated,1,2,PTH/);
    assert.match(npth, /TF\.FileFunction,NonPlated,1,2,NPTH/);
  }
  // JLCPCB's is the board's own zip, renamed; PCBWay's carries the netlist, the same file as the .d356.
  const jlc = packages.find((p) => p.id === "jlcpcb")!;
  assert.deepEqual(jlc.bytes, readFileSync(join(await macropad(), "pcb", "macropad-gerbers.zip")));
  assert.equal(unzip(packages.find((p) => p.id === "pcbway")!.bytes).at(-1)!.data.toString("utf8"), v.d356);
  // A profile the board's features do not pass gets no zip, and says why.
  const out = fabPackages({ ...v, drc: { ...v.drc, fabs: { ...v.drc.fabs, aisler: { name: "Aisler", ok: false, why: ["narrowest copper is 0.1 mm, under Aisler's 0.2 mm"] } } } });
  assert.deepEqual(out.packages.map((p) => p.id), ["jlcpcb", "pcbway", "oshpark"]);
  assert.deepEqual(out.skipped, [{ id: "aisler", name: "Aisler", why: "narrowest copper is 0.1 mm, under Aisler's 0.2 mm" }]);
});

test("each ORDER.md names its zip and ends with the STOP line, and the README gives the board, the fabs and the verification", async () => {
  const v = await asVerified(), product = await macropad(), tools = { gerbonara: "1.6.3", shapely: "2.2.0" };
  const { packages } = fabPackages(v);
  const layers = [{ title: "PCB audit", checked: "the footprints", status: "pass", result: "0 errors" }];
  const texts: string[] = [readme(product, v, packages, [], layers, tools)];
  for (const p of packages) {
    const md = orderMd(product, v, p, tools);
    texts.push(md);
    assert.ok(md.endsWith(`\n\n${STOP}\n`), p.id);
    assert.match(md, new RegExp(`Upload \`macropad-${p.id}\\.zip\` \\(sha256 ${p.sha256}\\)`));
    assert.match(md, /The board is 61 x 94 mm, 2 layers, 1\.6 mm FR-4 with 1 oz \(35 µm\) copper/);
    assert.match(md, /## Price\n\n.* Source: .*, read 2026-10-14\. Unverified: /);
  }
  const md = Object.fromEntries(packages.map((p, i) => [p.id, texts[i + 1]]));
  assert.match(md.jlcpcb, /\| PCB Qty \| 5 \(the quantity of JLCPCB's \$2 price\) \|/);
  assert.match(md.jlcpcb, /Pick "Review Before Payment"/);
  assert.match(md.aisler, /€12 \+ €0\.067 x 57\.34 cm² x 6 = €35\.05 net, before the VAT Aisler adds at checkout \(3 pcs: €23\.53 net\)/);
  assert.match(md.aisler, /€0\.051 per cm² \(€29\.55 for 6\)/);
  assert.match(md.aisler, /\| Quantity \| 6 \(2 sets of 3, as Aisler sells them\) \|/);
  assert.match(md.oshpark, /8\.89 sq in, so \$44\.44 for 3/);
  assert.match(md.oshpark, /\*\*Read this first\.\*\* OSH Park does not document how it handles non-plated holes.*53 of its holes are non-plated, from 1\.5 mm up/);
  assert.match(md.pcbway, /\| Min hole size \| the board's smallest hole is 0\.4 mm \|/);
  const r = texts[0];
  assert.match(r, /^# macropad: the board, ready to order/);
  assert.match(r, /- 61 x 94 mm \(57\.34 cm²\), its corners rounded to a 1 mm radius/);
  assert.match(r, /- 18 plated holes \(0\.4 mm\) and 53 non-plated \(1\.5 to 4 mm\)/);
  assert.match(r, /\| hole to hole, edge to edge, of a component or non-plated hole \| 0\.465 mm \|/);
  for (const p of packages) assert.match(r, new RegExp(`\\| ${FAB_PROFILES[p.id].name} \\| .* \\| \`${p.id}/\` \\|`));
  assert.match(r, /## Verification: VERIFIED\n\n- \*\*PCB audit\*\* \(passed\): the footprints: 0 errors\./);
  // The firmware is said to have run only when its layer passed; the keypad places a Pico and sockets.
  assert.match(r, /These are our own checks, not a fab's\. Before the first order, .* and lay a real Pico and a real socket on them\./);
  const ran = readme(product, v, packages, [], [...layers, { id: "firmware", title: "firmware", checked: "the board's firmware", status: "pass", result: "0 errors" }], tools);
  assert.match(ran, /These are our own checks, not a fab's\. The firmware ran on an emulated Pico wired to the copper in the files/);
  assert.ok(r.endsWith(`${STOP}\n`));
  // No text names an order or payment call.
  for (const t of texts) for (const c of ORDER_CALLS) assert.ok(!t.toLowerCase().includes(c.toLowerCase()), c);
});

// ---- never a fab ----

test("fetch refuses every fab's host and every order call, before it connects and at each redirect, and lets the rest through", async () => {
  const refused = [
    "https://api-partner.pcbway.com/api/Pcb/PlaceOrder", "https://api-partner.pcbway.com/api/Pcb/ConfirmOrder",
    "https://api-partner.pcbway.com/api/Pcb/PayTGroupOrder", "https://api-partner.pcbway.com/api/Pcb/CancelOrder",
    "https://api-partner.pcbway.com/api/Pcb/CancelTGroupOrder", "https://www.pcbway.com/Common/KiCadUpFile/",
    // The same calls through any other host, a mirror or a proxy.
    "https://example.com/api/Pcb/PlaceOrder", "https://proxy.example/forward?to=%2Fapi%2FPcb%2FPayTGroupOrder",
    "https://cart.jlcpcb.com/quote", "https://api.jlcpcb.com/overseas/openapi/pcb/order/create", "https://JLCPCB.com./",
    "https://jlcpcb.cn/api/order/submit", "https://jlcdfm.com/", "https://aisler.net/", "https://community.aisler.net/t/our-simple-pricing",
    "https://push-to-aisler.s3.amazonaws.com/token/board.zip", "https://s3.amazonaws.com/push-to-aisler/token/",
    "https://oshpark.com/import.json", "https://docs.oshpark.com/services/two-layer/", "https://be.eurocircuits.com/", "not a url",
  ];
  for (const url of refused) assert.ok(refusal(url), url);
  const allowed = [PINNED.circuitpython.url, PINNED.rp2040js.url, PINNED.bootrom.url, PINNED.kmk.repo, "https://api.digikey.com/v1/oauth2/token"];
  for (const url of allowed) assert.equal(refusal(url), undefined, url);

  const real = globalThis.fetch, calls: string[] = [];
  try {
    // A stand-in for the network: a GitHub URL that redirects to PCBWay, and one that answers.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith("/moved") ? new Response(null, { status: 302, headers: { location: "https://www.pcbway.com/Common/KiCadUpFile/" } }) : new Response("ok");
    }) as typeof fetch;
    guardNetwork();
    guardNetwork();
    await assert.rejects(fetch("https://api-partner.pcbway.com/api/Pcb/PlaceOrder", { method: "POST", body: "{}" }), /refused: api-partner\.pcbway\.com is a fab's/);
    await assert.rejects(fetch(new URL("https://example.com/api/Pcb/ConfirmOrder")), /refused: .* is a fab's order call \(ConfirmOrder\), which is never made/);
    await assert.rejects(fetch("https://cart.jlcpcb.com/quote"), /refused/);
    assert.deepEqual(calls, []);
    assert.equal(await (await fetch(PINNED.circuitpython.url)).text(), "ok");
    await assert.rejects(fetch("https://github.com/moved"), /refused: www\.pcbway\.com is a fab's/);
    assert.deepEqual(calls, [PINNED.circuitpython.url, "https://github.com/moved"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("nothing in the pipeline reaches the network but through the guarded fetch, and only order.ts names the order calls", () => {
  const files = walk(PIPELINE).filter((f) => /\.(ts|mjs|py)$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes("__pycache__"));
  assert.ok(files.length > 30);
  for (const f of files) {
    const text = readFileSync(join(PIPELINE, f), "utf8");
    if (f !== "pcb/order.ts") for (const c of ORDER_CALLS) assert.ok(!text.toLowerCase().includes(c.toLowerCase()), `${f} names ${c}`);
    if (/\bfetch\(/.test(text)) assert.match(text, /guardNetwork\(\)/, `${f} fetches without guardNetwork()`);
    assert.doesNotMatch(text, /from "(node:)?(http|https|net|tls|dgram)"|require\("(node:)?(http|https|net|tls)"\)/, `${f} opens its own connections`);
    assert.doesNotMatch(text, /spawn(Sync)?\("(curl|wget)"|exec(File)?(Sync)?\("(curl|wget)"/, `${f} runs curl or wget`);
    if (f.endsWith(".py")) assert.doesNotMatch(text, /^\s*(import|from)\s+(urllib|requests|http\.client|socket|httpx)\b/m, `${f} opens connections`);
  }
});

// ---- with the read-back ----

/** A board with only a Pico on it, in a products/ folder of its own; `extra` is board code added to it. */
function tiny(extra = ""): { tmp: string; dst: string } {
  const tmp = temp("distinta-order-tiny-"), dst = join(tmp, "products", "tiny");
  mkdirSync(join(dst, "cad"), { recursive: true });
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: { ...TINY, pcbThicknessMm: 1.6 } }));
  writeTiny(dst, extra);
  return { tmp, dst };
}
const writeTiny = (dst: string, extra: string) => writeFileSync(join(dst, "cad", "pcb.mjs"), `export default function board({ pcb }) {
  pcb.outline(61, 40, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 0, nets: { GND: "GND" } });
  pcb.pour("GND", "F.Cu");${extra}
}
`);

test("distinta verify writes the order folder for a verified board, and none for one that fails or is unverified", { skip }, async () => {
  const { tmp, dst } = tiny();
  const run = async () => {
    const { value, said } = await quietly(tmp, () => verify("tiny"));
    return { code: value, said, json: JSON.parse(readFileSync(join(dst, "pcb", "verify.json"), "utf8")) };
  };
  let v = await run();
  assert.equal(v.code, 0, v.said);
  assert.deepEqual(v.json.layers.map((l: Layer) => [l.id, l.status]), [["audit", "pass"], ["readback", "pass"], ["self-test", "pass"], ["order", "pass"]]);
  assert.match(v.said, /✓ order files: the zip for each fab profile the board passes, .*: 0 errors in each; wrote products\/tiny\/pcb\/order\/ for JLCPCB, PCBWay, OSH Park and Aisler/);
  assert.match(v.said, /VERIFIED: every layer passed\. Wrote products\/tiny\/pcb\/verify\.json and the order folder products\/tiny\/pcb\/order\//);
  const order = join(dst, "pcb", "order");
  const fabs = ["aisler", "jlcpcb", "oshpark", "pcbway"];
  assert.deepEqual(walk(order), ["README.md", ...fabs.flatMap((id) => [`${id}/ORDER.md`, `${id}/tiny-${id}.zip`]), "order.json", "pcb-bottom.svg", "pcb-top.svg", "tiny.d356"].sort());
  // The previews print 1:1: their size is in mm, as their viewBox is.
  assert.match(readFileSync(join(order, "pcb-top.svg"), "utf8"), /^<svg width="67mm" height="\d+(\.\d+)?mm" xmlns=/);
  for (const id of fabs) {
    const zipped = readFileSync(join(order, id, `tiny-${id}.zip`));
    assert.deepEqual(unzip(zipped).map((f) => f.name), EXPECTED("tiny")[id], id);
    assert.ok(readFileSync(join(order, id, "ORDER.md"), "utf8").endsWith(`${STOP}\n`));
    assert.equal(v.json.order.fabs.find((f: { id: string }) => f.id === id).sha256, createHash("sha256").update(zipped).digest("hex"));
  }
  assert.equal(readFileSync(join(order, "tiny.d356"), "utf8"), readFileSync(join(dst, "pcb", "tiny.d356"), "utf8"));
  const readmeText = readFileSync(join(order, "README.md"), "utf8");
  assert.match(readmeText, /## Verification: VERIFIED\n\n- \*\*PCB audit\*\* \(passed\): .*: 0 errors\.\n- \*\*read-back\*\* \(passed\)/);
  assert.match(readmeText, /gerbonara 1\.6\.3 and shapely 2\.2\.0 read each zip back as the board the read-back passed: 0 errors in each/);

  // Current, it stays; once the board's inputs change, the scorer, package and status remove it, before distinta
  // pcb has even run: it is of the board as it was verified.
  assert.equal(dropStaleOrder(dst), undefined);
  assert.ok(existsSync(order));
  const design = readFileSync(join(dst, "design.json"), "utf8");
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: { ...TINY, pcbThicknessMm: 1.2 } }));
  assert.match(dropStaleOrder(dst) ?? "", /^it is of an earlier board: the board code, what it reads or the kit changed since `distinta verify` wrote it$/);
  assert.ok(!existsSync(order));
  writeFileSync(join(dst, "design.json"), design);
  await run();
  writeFileSync(join(dst, "pcb", "tiny-gerbers.zip"), Buffer.concat([readFileSync(join(dst, "pcb", "tiny-gerbers.zip")), Buffer.from([0])]));
  assert.equal(dropStaleOrder(dst), "pcb/tiny-gerbers.zip is not the zip it was made from");
  await run();
  // A bom.json that wants 20 boards 1.0 mm thick: the board code reads none of it, so the board and its zip are as
  // they were, and the ORDER.md texts are not. The folder goes.
  const line = { id: "pcb", name: "PCB", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { thicknessMm: 1.6, finish: "HASL" }, file: "pcb/tiny-gerbers.zip" };
  writeFileSync(join(dst, "bom.json"), JSON.stringify({ slug: "tiny", units: 1, lines: [line] }));
  await run();
  assert.match(readFileSync(join(order, "jlcpcb", "ORDER.md"), "utf8"), /\| PCB Thickness \| 1\.6 mm \|/);
  assert.equal(dropStaleOrder(dst), undefined);
  writeFileSync(join(dst, "bom.json"), JSON.stringify({ slug: "tiny", units: 20, lines: [line] }));
  assert.equal(dropStaleOrder(dst), "its texts are of another order: bom.json or design.json changed the quantity, the thickness or the finish since `distinta verify` wrote them");
  assert.ok(!existsSync(order));
  await run();
  assert.match(readFileSync(join(order, "jlcpcb", "ORDER.md"), "utf8"), /\| PCB Qty \| 20 \(the quantity of JLCPCB's \$2 price; this product needs 20\) \|/);
  writeFileSync(join(dst, "bom.json"), JSON.stringify({ slug: "tiny", units: 1, lines: [line] }));
  assert.match(dropStaleOrder(dst) ?? "", /^its texts are of another order/);
  // 1.0 mm in bom.json, and 1.6 mm in design.json, which the case is built for and the fab profiles were checked
  // for: the board is not one thing, so no order folder, and the order layer says both.
  writeFileSync(join(dst, "bom.json"), JSON.stringify({ slug: "tiny", units: 1, lines: [{ ...line, spec: { ...line.spec, thicknessMm: 1.0 } }] }));
  v = await run();
  assert.equal(v.code, 1, v.said);
  assert.deepEqual(v.json.layers.at(-1).errors, ["bom.json's PCB line (pcb) orders boards 1 mm thick, and design.json's pcbThicknessMm, which the case is built for, is 1.6 mm"]);
  assert.match(v.said, /✗ order files: .*: bom\.json and design\.json do not give one board to order/);
  assert.ok(!existsSync(order));
  // Both at 1.0 mm: one board, but not the one the fab profiles were checked for.
  writeFileSync(join(dst, "design.json"), JSON.stringify({ slug: "tiny", params: { ...TINY, pcbThicknessMm: 1.0 } }));
  v = await run();
  assert.equal(v.code, 1, v.said);
  assert.match(v.json.layers.at(-1).errors[0], /^the board is 1 mm thick \(bom\.json's PCB line\), and every fab profile here was checked for 1\.6 mm boards/);
  writeFileSync(join(dst, "design.json"), design);
  rmSync(join(dst, "bom.json"));
  await run();
  // A board with no keys ran no firmware, and places no socket: the README says neither.
  const readmeNow = readFileSync(join(order, "README.md"), "utf8");
  assert.doesNotMatch(readmeNow, /firmware ran/);
  assert.match(readmeNow, /and lay a real Pico on them\./);
  // distinta pcb removes it too.
  assert.equal((await quietly(tmp, () => pcb("tiny"))).value, true);
  assert.ok(!existsSync(order));

  // Without gerbonara (a Python that sees no packages, named by DISTINTA_PYTHON): unverified, and no order folder.
  const python = spawnSync(readbackPython(), ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  const bin = join(tmp, "bin"), given = process.env.DISTINTA_PYTHON;
  mkdirSync(bin);
  writeFileSync(join(bin, "python3"), `#!/bin/sh\nexec "${python}" -S "$@"\n`);
  chmodSync(join(bin, "python3"), 0o755);
  await run();
  try {
    process.env.DISTINTA_PYTHON = join(bin, "python3");
    v = await run();
  } finally {
    if (given === undefined) delete process.env.DISTINTA_PYTHON;
    else process.env.DISTINTA_PYTHON = given;
  }
  assert.equal(v.code, 2);
  assert.equal(v.json.order, null);
  assert.deepEqual(v.json.layers.at(-1), {
    id: "order", title: "order files", status: "not run", errors: [],
    checked: "the zip for each fab profile the board passes, in that fab's own file names and drill format, read back by gerbonara and shapely as the board's own zip was",
    result: "not run: the read-back did not run, so the board is not verified, and no order folder is written",
  });
  assert.match(v.said, /UNVERIFIED: the read-back did not run, so the board is not verified and no order folder was written/);
  assert.ok(!existsSync(order));

  // A board whose audit fails: no order folder, and an earlier one is gone.
  await run();
  assert.ok(existsSync(order));
  writeTiny(dst, `\n  pcb.place("kailh-mx-hotswap", { ref: "K1", x: -15, y: 0, side: "bottom", nets: { A: "GP2", B: "GDN" } });`);
  v = await run();
  assert.equal(v.code, 1);
  assert.deepEqual(v.json.layers.map((l: Layer) => [l.id, l.status]), [["audit", "fail"], ["readback", "not run"], ["order", "not run"]]);
  assert.match(v.said, /· order files: .*: not run: a layer above failed, and no order folder is written/);
  assert.match(v.said, /FAILED: do not order this board; no order folder was written/);
  assert.ok(!existsSync(order));
  rmSync(tmp, { recursive: true, force: true });
});

test("a fab's zip that does not read back as the board stops the whole order folder: a drill format, a name, a netlist or a stray file gone wrong", { skip }, async () => {
  const { tmp, dst } = tiny();
  assert.equal((await quietly(tmp, () => verify("tiny"))).value, 0);
  const order = join(dst, "pcb", "order"), layers = JSON.parse(readFileSync(join(dst, "pcb", "verify.json"), "utf8")).layers.slice(0, -1) as Layer[];
  const v = verified(dst);
  /** The hand-off with one fab's zip changed by `change`, and only that zip: it must fail as `expect` says, and an
   * order folder of an earlier run must be gone. */
  const broken = async (id: string, change: (files: FabPackage["files"]) => void, expect: RegExp) => {
    const p = fabPackages(v).packages.find((x) => x.id === id)!;
    change(p.files);
    p.bytes = zip(p.files);
    mkdirSync(order, { recursive: true });
    writeFileSync(join(order, "README.md"), "an earlier run's");
    const { value } = await quietly(tmp, () => handOff("tiny", layers, { packages: [p], skipped: [] }));
    assert.equal(value.layer.status, "fail", value.layer.result);
    assert.equal(value.order, null);
    assert.match(value.layer.errors.join("\n"), expect);
    assert.match(value.layer.result, new RegExp(`^${FAB_PROFILES[id].name}'s zip does not read back as the board`));
    assert.ok(!existsSync(order), "no order folder");
  };
  const file = (files: FabPackage["files"], end: string) => files.find((f) => f.name.endsWith(end))!;
  // The tiny board's only holes are its four non-plated ones. The 2:4 drill file read as 3:3: every hole ten times as far from the origin as it is.
  await broken("aisler", (files) => { const f = file(files, ".holes_npth.xln"); f.data = f.data.replace("INCH,TZ,00.0000", "INCH,TZ,000.000"); },
    /tiny-aisler\.zip: the NPTH file lacks 4 of the board's holes/);
  // Inches written as if they were mm.
  await broken("pcbway", (files) => { const f = file(files, "-NPTH.drl"); f.data = f.data.replace(/^INCH$/m, "METRIC"); },
    /tiny-pcbway\.zip: the NPTH file lacks 4 of the board's holes/);
  // The top and bottom copper under each other's names.
  await broken("oshpark", (files) => { const [a, b] = [file(files, ".gtl"), file(files, ".gbl")]; [a.name, b.name] = [b.name, a.name]; },
    /tiny-oshpark\.zip: tiny\.gbl's %TF\.FileFunction% is Copper,L1,Top, but its name says Copper,L2,Bot/);
  // A netlist in the zip that is not the .d356 beside it.
  await broken("pcbway", (files) => { file(files, ".ipc").data += "C a line that is not in tiny.d356\n"; },
    /tiny-pcbway\.zip: the zip's PCBWay_netlist\.ipc is not tiny\.d356/);
  // Something Aisler did not ask for.
  await broken("aisler", (files) => files.push({ name: "notes.txt", data: "hello" }), /tiny-aisler\.zip: the zip holds notes\.txt, which board\.json does not list/);
  // A file a fab cannot place by its name.
  await broken("jlcpcb", (files) => { file(files, ".gm1").name = "tiny-outline.gbr"; }, /tiny-jlcpcb\.zip: tiny-outline\.gbr: a fab cannot tell from its name what it is/);
  // The same swap in KiCad's names, and in Aisler's.
  await broken("pcbway", (files) => { const [a, b] = [file(files, "-F_Mask.gbr"), file(files, "-B_Mask.gbr")]; [a.name, b.name] = [b.name, a.name]; },
    /tiny-pcbway\.zip: tiny-B_Mask\.gbr's %TF\.FileFunction% is Soldermask,Top, but its name says Soldermask,Bot/);
  await broken("aisler", (files) => { const [a, b] = [file(files, ".toplayer.ger"), file(files, ".bottomlayer.ger")]; [a.name, b.name] = [b.name, a.name]; },
    /tiny-aisler\.zip: tiny\.bottomlayer\.ger's %TF\.FileFunction% is Copper,L1,Top, but its name says Copper,L2,Bot/);

  // No profile passes: nothing to hand off.
  const none = await quietly(tmp, () => handOff("tiny", layers, { packages: [], skipped: [{ id: "aisler", name: "Aisler", why: "too small" }] }));
  assert.deepEqual([none.value.layer.status, none.value.layer.result, none.value.layer.errors], ["fail", "no fab profile passes the board", ["Aisler: too small"]]);
  // Unchanged, every zip reads back and the folder is written again.
  const again = await quietly(tmp, () => handOff("tiny", layers));
  assert.equal(again.value.layer.status, "pass", again.value.layer.errors.join("\n"));
  assert.ok(existsSync(join(order, "aisler", "tiny-aisler.zip")));
  // The board's zip changed after its read-back: the hand-off stops before it reads a file, and the folder is gone.
  const own = join(dst, "pcb", "tiny-gerbers.zip");
  writeFileSync(own, Buffer.concat([readFileSync(own), Buffer.from([0])]));
  const changed = await quietly(tmp, () => handOff("tiny", layers));
  assert.deepEqual([changed.value.layer.status, changed.value.layer.result], ["fail", "it stopped"]);
  assert.match(changed.value.layer.errors[0], /pcb\/tiny-gerbers\.zip is not the zip the read-back passed: run distinta verify/);
  assert.ok(!existsSync(order));
  rmSync(tmp, { recursive: true, force: true });
});
