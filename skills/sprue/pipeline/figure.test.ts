// The figure (`sprue figure`, figure.ts) on a small product made here: one block, drawn from its BOM line's spec. A
// line bom.json doesn't have stops the figure with a sentence naming it, and a part or x-ray drawn from a number
// that isn't there (NaN or undefined in its drawing) is a problem, not a figure drawn wrong. A lift along the CAD's +x
// moves its part right on screen at the keypad's camera, figure.json keeps that lift in mm, and a figure can't ask
// for the kit's mirror-image camera.
// Run them with
//   node --test skills/sprue/pipeline/figure.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { FigureJson } from "./figure.ts";
import type { Bom } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
const cwd = mkdtempSync(join(tmpdir(), "sprue-figure-"));
after(() => rmSync(cwd, { recursive: true, force: true }));
const dir = join(cwd, "products", "box");

const bom: Bom = {
  slug: "box", units: 1, lines: [
    { id: "blk", name: "Block", role: "case", process: "buy", qtyPerUnit: 1, spec: { widthMm: 10 } },
  ],
};

/** The product, its figure reading `read` (a line id) for the block's width, and `sprue figure box --draft` on it. */
function draw(lines: Bom["lines"], read = "blk") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ ...bom, lines }));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "A block.", architecture: [], params: {} }));
  writeFileSync(join(dir, "figure.mjs"), `
export default function draw({ k, fig, spec }) {
  const w = spec(${JSON.stringify(read)}).widthMm;
  const P = fig.camera([[0, 0, 0], [w ?? 10, 10, 10]]);
  const [a, b, c] = [[0, 0, 0], [w, 0, 0], [w, 10, 0]].map((p) => k.iso(p, P));
  const d = \`M\${a[0]} \${a[1]}L\${b[0]} \${b[1]}L\${c[0]} \${c[1]}Z\`;
  fig.part("blk", \`<path d="\${d}"/>\`, { step: 1 });
  fig.xray("blk", \`<path d="\${d}" class="iso-xray"/>\`);
  return { title: "Box" };
}
`);
  return spawnSync(SPRUE, ["figure", "box", "--draft"], { cwd, encoding: "utf8", timeout: 60_000 });
}

test("a figure drawn from its lines' specs draws", () => {
  const r = draw(bom.lines);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /✗/);
});

test("a line bom.json doesn't have stops the figure with a sentence naming it, not an engine error", () => {
  const r = draw(bom.lines, "gone");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^✗ figure: bom\.json has no gone line, which figure\.mjs draws: put the line back, or take its part out of figure\.mjs$/m);
  assert.doesNotMatch(r.stderr, /TypeError|is not iterable|Cannot read/);
});

test("a part or x-ray drawn from a spec field that isn't there is a problem, naming it", () => {
  const r = draw([{ ...bom.lines[0], spec: {} }]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ fig\.part\("blk"\): its drawing has NaN or undefined in it, so a number it is drawn from is not there/);
  assert.match(r.stdout, /✗ fig\.xray\("blk"\): its drawing has NaN or undefined in it, so a number it is drawn from is not there/);
});

/** The product with a figure.mjs of its own (the body of draw({ k, fig })), and `sprue figure box --draft` on it. */
function drawWith(body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "A block.", architecture: [], params: {} }));
  writeFileSync(join(dir, "figure.mjs"), `export default function draw({ k, fig }) {\n${body}\n  return { title: "Box" };\n}\n`);
  return spawnSync(SPRUE, ["figure", "box", "--draft"], { cwd, encoding: "utf8", timeout: 60_000 });
}

test("a lift along the CAD's +x moves the part right on screen at the keypad's camera (azimuth -40)", () => {
  const r = drawWith(`
  const P = fig.camera([[-20, -20, 0], [20, 20, 10]], { azimuth: -40 });
  const [o, x] = [[0, 0, 0], [10, 0, 0]].map((p) => k.iso(p, P));
  fig.part("blk", \`<path d="M\${o[0]} \${o[1]}L\${x[0]} \${x[1]}"/>\`, { step: 1, lift: [10, 0, 0] });`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dx = Number(/data-line="blk"[^>]* data-dx="(-?[\d.]+)"/.exec(readFileSync(join(dir, "figure.svg"), "utf8"))?.[1]);
  assert.ok(dx > 0, `a lift along +x moved the part ${dx} px across the screen: it should go right`);
  // figure.json keeps the lift in mm, as figure.mjs gave it, beside its offset on the drawing: the 3D view moves the
  // part by it.
  const parts = (JSON.parse(readFileSync(join(dir, "figure.json"), "utf8")) as FigureJson).parts;
  assert.deepEqual(parts, [{ line: "blk", step: 1, count: 1, lift: [10, 0, 0], dx, dy: parts[0].dy }]);
});

test("a figure that asks for the kit's left-handed camera is a problem: it would draw its CAD's mirror image", () => {
  const r = drawWith(`
  const P = fig.camera([[-20, -20, 0], [20, 20, 10]], { azimuth: -40, leftHanded: true });
  const [o, x] = [[0, 0, 0], [10, 0, 0]].map((p) => k.iso(p, P));
  fig.part("blk", \`<path d="M\${o[0]} \${o[1]}L\${x[0]} \${x[1]}"/>\`, { step: 1, lift: [10, 0, 0] });`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ fig\.camera: leftHanded draws the product as the mirror image of its CAD/);
  // It was dropped, so what was drawn is the right way round anyway.
  const dx = Number(/data-line="blk"[^>]* data-dx="(-?[\d.]+)"/.exec(readFileSync(join(dir, "figure.svg"), "utf8"))?.[1]);
  assert.ok(dx > 0, `the part moved ${dx} px: leftHanded was not dropped`);
});
