// The figure (`sprue figure`, figure.ts) on a small product made here: one block, drawn from its BOM line's spec. A
// line bom.json doesn't have stops the figure with a sentence naming it, and a part or x-ray drawn from a number
// that isn't there (NaN or undefined in its drawing) is a problem, not a figure drawn wrong. Run them with
//   node --test skills/sprue/pipeline/figure.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
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
