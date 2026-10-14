// Tests of the fit check (fit.ts) and of the footprints' sides: the macropad's own board code, with one part moved,
// turned, renumbered or put on the wrong side, as an edit to cad/pcb.mjs would do it, must fail. Each of these
// boards passed every other check before. Run them with
//   node --test skills/distinta/pipeline/pcb/fit.test.ts

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { pcb } from "../pcb.ts";
import { createBoard } from "./board.ts";
import { checkFit } from "./fit.ts";
import { FOOTPRINTS } from "./footprints.ts";
import { checkIntent } from "./intent.ts";
import type { BoardData } from "./types.ts";

const MACROPAD = join(import.meta.dirname, "..", "..", "examples", "macropad");
type Design = { slug: string; params: Record<string, number | string>; keyMap: Record<string, string>; assembly: string[] };
const design = (): Design => JSON.parse(readFileSync(join(MACROPAD, "design.json"), "utf8"));

/** `src` with `from` replaced by `to`, which must be there. */
const edit = (from: string, to: string) => (src: string) => {
  assert.ok(src.includes(from), `cad/pcb.mjs has no ${JSON.stringify(from)}`);
  return src.replace(from, to);
};

/** The macropad's board code, with `change` made to its source, drawn without its routes: the fit and intent checks
 * look at the parts and their pads' nets, not at the copper between them, and routing takes seconds. */
async function placed(change: (src: string) => string = (s) => s, d: Design = design()): Promise<BoardData> {
  const dir = mkdtempSync(join(tmpdir(), "distinta-fit-"));
  try {
    writeFileSync(join(dir, "pcb.mjs"), change(readFileSync(join(MACROPAD, "cad", "pcb.mjs"), "utf8")));
    const { api, data } = createBoard("macropad");
    const mod = await import(pathToFileURL(join(dir, "pcb.mjs")).href);
    mod.default({ pcb: { ...api, route: () => ({ tracks: [], vias: [] }) }, params: d.params, design: d, bom: { lines: [] } });
    return data;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** design.json with keyMap as the board wires the keys, as someone who copied drc.json's pin map in would have it,
 * so only the fit check is left to catch what was moved. */
const synced = (data: BoardData): Design => ({
  ...design(),
  keyMap: Object.fromEntries(data.pads.filter((p) => p.ref.startsWith("K") && p.num === "A").map((p) => [p.ref, p.net])),
});

test("the macropad as it is fits its case: the outline, every socket on the key grid, the Pico and the screw holes", async () => {
  const data = await placed();
  const fit = checkFit(data, design().params);
  assert.deepEqual(fit.errors, []);
  assert.deepEqual(fit.checked, ["the 61 x 94 mm outline", "9 sockets on the key grid", "U1 at its place with its USB end to +x", "4 screw holes under the case's bosses"]);
  assert.deepEqual(checkIntent(data, design()).errors, []);
  // Without the params there is nothing to hold the board to, and nothing is checked.
  assert.deepEqual(checkFit(data, {}), { checked: [], errors: [] });
});

test("a socket off the key grid, or turned a quarter, fails", async () => {
  const data = await placed(edit("  // One GPIO per key", "  keys[4].x += 2;\n  // One GPIO per key"));
  assert.deepEqual(checkFit(data, design().params).errors, [
    "K5 is at (2, -13.03), and key 5 of design.json's grid (row 2 from the bottom, column 2 from the left) at (0, -13.02): the switch clipped into the plate's cutout there would miss its socket's holes by 2 mm",
  ]);
  const turned = await placed(edit(`ref: \`K\${k.n}\`, x: k.x`, `ref: \`K\${k.n}\`, rotDeg: k.n === 5 ? 90 : 0, x: k.x`));
  assert.match(checkFit(turned, design().params).errors.join("\n"), /K5 is turned 90 degrees: under a switch in its plate cutout a socket is turned 0 or 180/);
});

test("keys numbered another way than design.json's grid fail, and so does an assembly step that gives the user another map", async () => {
  // Numbered from the top right, with keyMap copied from the wiring: every net is as keyMap says, and K1 types 1, but
  // K1 is where key 9 is.
  const data = await placed(edit("keys.push({ n: r * cols + c + 1,", "keys.push({ n: rows * cols - (r * cols + c),"));
  const errors = checkFit(data, design().params).errors;
  assert.equal(errors.length, 8);
  assert.match(errors.join("\n"), /K1 is at \(19\.05, 6\.02\), and key 1 of design\.json's grid \(row 1 from the bottom, column 1 from the left\) at \(-19\.05, -32\.08\)/);
  const intent = checkIntent(data, synced(data)).errors;
  assert.match(intent.join("\n"), /design\.json's assembly tells the user K1 is on GP10, and keyMap, which the board is held to, puts it on GP2/);
});

test("a Pico turned 180 degrees, or moved, fails: its USB end faces into the case, or is not where the opening is", async () => {
  const turned = await placed(edit(`ref: "U1", x: p.controllerCenterXMm,`, `ref: "U1", rotDeg: 180, x: p.controllerCenterXMm,`));
  const d = { ...synced(turned), assembly: [] };
  // The keys, wired to where the turned Pico's GPIOs now are, pass the intent check: only the fit check sees it.
  assert.deepEqual(checkIntent(turned, d).errors, []);
  assert.deepEqual(checkFit(turned, d.params).errors, [
    "U1 is turned 180 degrees, so its USB end faces -x, into the case: the case's USB opening and the lid's BOOTSEL hole are at its +x end (check.ts usb-reach), so it goes in with rotDeg 0",
  ]);
  const moved = await placed(edit("x: p.controllerCenterXMm, y", "x: p.controllerCenterXMm - 3, y"));
  assert.deepEqual(checkFit(moved, design().params).errors, [
    "U1 is centred at (2, 26.5), and design.json's controllerCenterXMm, controllerCenterYMm at (5, 26.5): 3 mm from where the case's USB opening, its pocket and the lid's BOOTSEL hole are",
  ]);
});

test("screw holes moved off the case's bosses, drilled to another size, or an outline of another size fail", async () => {
  const moved = await placed(edit("sx * (W / 2 - p.holeInsetMm)", "sx * (W / 2 - p.holeInsetMm - 2)"));
  const errors = checkFit(moved, design().params).errors;
  assert.equal(errors.length, 4);
  assert.equal(errors[0], "there is no hole at (-27, -43.5), the bottom left screw hole design.json's holeInsetMm puts under the case's boss and insert (the nearest is at (-25, -43.5), 2 mm away)");
  const small = await placed(edit("p.screwClearanceMm, { keepout", "3.0, { keepout"));
  assert.match(checkFit(small, design().params).errors.join("\n"), /the bottom left screw hole is 3 mm, and design\.json's screwClearanceMm 3\.4 mm/);
  const wide = await placed(edit("pcb.outline(W, H,", "pcb.outline(W + 1, H,"));
  assert.match(checkFit(wide, design().params).errors.join("\n"), /the outline is 62 x 94 mm, and design\.json's pcbWidthMm x pcbHeightMm, which the case is built round, 61 x 94 mm/);
});

test("a socket goes only on the back, where its reference is drawn, and one put on the top fails the intent check", async () => {
  await assert.rejects(placed(edit(`side: "bottom", nets: { A:`, `side: k.n === 5 ? "top" : "bottom", nets: { A:`)), /K5: kailh-mx-hotswap can only be placed on the bottom/);
  // A library that let it on the top would still not get it past the audit: there its pads are the real socket's
  // mirror image.
  const real = FOOTPRINTS["kailh-mx-hotswap"];
  FOOTPRINTS["kailh-mx-hotswap"] = (rules, opts) => ({ ...real(rules, opts), sides: ["top", "bottom"] });
  try {
    const data = await placed(edit(`side: "bottom", nets: { A:`, `side: k.n === 5 ? "top" : "bottom", nets: { A:`));
    assert.match(checkIntent(data, design()).errors.join("\n"),
      /footprint: K5 \(kailh-mx-hotswap\) does not match its reference, .*: it is on the top, and the reference is drawn for the bottom, so there its pads are the mirror image of the real part's; pads A and B are on F\.Cu, not B\.Cu, the bottom's copper/);
  } finally {
    FOOTPRINTS["kailh-mx-hotswap"] = real;
  }
});

test("a board that does not fit its case gets drc.json's errors and no zip", async () => {
  const here = process.cwd(), tmp = mkdtempSync(join(tmpdir(), "distinta-fit-build-"));
  const dst = join(tmp, "products", "macropad");
  for (const f of ["cad/pcb.mjs", "design.json", "bom.json"]) cpSync(join(MACROPAD, f), join(dst, f));
  writeFileSync(join(dst, "cad", "pcb.mjs"), edit("  // One GPIO per key", "  keys[4].x += 2;\n  // One GPIO per key")(readFileSync(join(dst, "cad", "pcb.mjs"), "utf8")));
  const log = console.log;
  try {
    process.chdir(tmp);
    console.log = () => {};
    assert.equal(await pcb("macropad"), false);
  } finally {
    console.log = log;
    process.chdir(here);
  }
  const drc = JSON.parse(readFileSync(join(dst, "pcb", "drc.json"), "utf8"));
  assert.ok(drc.errors.some((e: string) => /^K5 is at \(2, -13\.03\)/.test(e)), drc.errors.join("\n"));
  assert.ok(!existsSync(join(dst, "pcb", "macropad-gerbers.zip")));
  rmSync(tmp, { recursive: true, force: true });
});
