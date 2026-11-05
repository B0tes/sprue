// The figure (`sprue figure`, figure.ts) on a small product made here: one block, drawn from its BOM line's spec. A
// line bom.json doesn't have stops the figure with a sentence naming it, and a part or x-ray drawn from a number
// that isn't there (NaN or undefined in its drawing) is a problem, not a figure drawn wrong. A lift along the CAD's +x
// moves its part right on screen at the keypad's camera, figure.json keeps that lift in mm and each call's `at`, one
// point for each part it draws, and a figure can't ask for the kit's mirror-image camera. `board()` gives the
// product's circuit board as cad/pcb.mjs draws it, its silkscreen as the fab prints it and its top pads, read from
// pcb/board.json while that is of this board and built otherwise, and the keypad's figure prints exactly that
// silkscreen on its board, over its top face, with the board's own pads.
// Run them with
//   node --test skills/sprue/pipeline/figure.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import * as k from "../kit/iso-kit.mjs";
import { buildFigure, type FigureBoard, type FigureJson } from "./figure.ts";
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

test("a call's `at` says where each part it draws is: figure.json keeps it, one point for each, and refuses any other", () => {
  // One point for one part, a list of points for several, and none where the call gives none.
  let r = drawWith(`
  fig.camera([[-20, -20, 0], [20, 20, 10]]);
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [1, 2, 3] });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 2, count: 2, at: [[4, 5, 6], [-7, 8.5, 0]] });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 3 });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 3, count: 0, at: [] });`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parts = (JSON.parse(readFileSync(join(dir, "figure.json"), "utf8")) as FigureJson).parts;
  assert.deepEqual(parts.map((p) => [p.step, p.count, p.at]), [[1, 1, [[1, 2, 3]]], [2, 2, [[4, 5, 6], [-7, 8.5, 0]]], [3, 1, undefined], [3, 0, undefined]]);
  assert.ok(parts.slice(2).every((p) => !("at" in p)), "a call that gives no point has no `at`");
  // Not points, or not one for each part the call draws: a problem naming the call.
  r = drawWith(`
  fig.camera([[-20, -20, 0], [20, 20, 10]]);
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [1, 2] });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [[1, 2, 3], [4, 5, "6"]], count: 2 });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [1, 2, Infinity] });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [[1, 2, 3]], count: 2 });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [] });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: [1, 2, 3], count: 0 });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, at: null });
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1, count: "2", at: [[1, 2, 3], [4, 5, 6]] });`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const problems = r.stdout.split("\n").filter((l) => l.includes("at "));
  assert.deepEqual(problems.map((l) => l.trim()), [
    '✗ fig.part("blk"): at must be a point [x, y, z] in mm, or a list of them, got [1,2]',
    '✗ fig.part("blk"): at must be a point [x, y, z] in mm, or a list of them, got [[1,2,3],[4,5,"6"]]',
    '✗ fig.part("blk"): at must be a point [x, y, z] in mm, or a list of them, got [1,2,null]',
    '✗ fig.part("blk"): at gives 1 point for a count of 2: give one for each instance the call draws',
    '✗ fig.part("blk"): at gives 0 points for a count of 1: give one for each instance the call draws',
    '✗ fig.part("blk"): at gives 1 point for a count of 0: give one for each instance the call draws',
    '✗ fig.part("blk"): at must be a point [x, y, z] in mm, or a list of them, got null',
  ], r.stdout);
  // A count that isn't a whole number is the call's one problem: its points aren't held to the count it falls back to,
  // nor kept with it in figure.json, which is written with the problems.
  assert.match(r.stdout, /✗ fig\.part\("blk"\): count must be a whole number, got "2"/);
  const kept = (JSON.parse(readFileSync(join(dir, "figure.json"), "utf8")) as FigureJson).parts;
  assert.equal(kept.length, 8);
  assert.ok(kept.every((p) => !("at" in p)), "no call above gives a point figure.json can keep");
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

// ---- board(): the product's circuit board, for its silkscreen -------------------------------------------------

/** Board code for the box: a 61 x 60 mm board with a Pico on top and a key socket under it, and a hole whose keepout
 * cuts into the text over it. */
const boardCode = (text: string) => `export default function board({ pcb }) {
  pcb.outline(61, 60, 1);
  pcb.place("rpi-pico-castellated", { ref: "U1", x: 0, y: 16, nets: { GND: "GND" } });
  pcb.place("kailh-mx-hotswap", { ref: "K1", x: -15, y: -10, side: "bottom", nets: { A: "GP2", B: "GND" }, switchMm: 14 });
  pcb.hole(0, -20, 1, { keepout: 1.2, ref: "M3" });
  pcb.text("F.Silk", 0, -20, ${JSON.stringify(text)}, 3);
}
`;

/** The box with `code` as its cad/pcb.mjs (none for null) and a figure that asks for the board twice and writes what
 * it got into figure.svg; `sprue figure box --draft` on it, and what board() gave. */
function drawBoard(code: string | null) {
  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "box", summary: "A block.", architecture: [], params: {} }));
  if (code === null) rmSync(join(dir, "cad", "pcb.mjs"), { force: true });
  else writeFileSync(join(dir, "cad", "pcb.mjs"), code);
  writeFileSync(join(dir, "figure.mjs"), `export default async function draw({ fig, board }) {
  fig.camera([[-20, -15, 0], [20, 15, 2]]);
  const b = await board();
  await board();
  fig.part("blk", "<path d='M0 0L1 1'/>", { step: 1 });
  fig.over("<desc>" + JSON.stringify(b) + "</desc>");
  return { title: "Box" };
}
`);
  rmSync(join(dir, "figure.svg"), { force: true });
  const r = spawnSync(SPRUE, ["figure", "box", "--draft"], { cwd, encoding: "utf8", timeout: 120_000 });
  const svg = existsSync(join(dir, "figure.svg")) ? readFileSync(join(dir, "figure.svg"), "utf8") : "";
  const got = /<desc>(.*?)<\/desc>/.exec(svg)?.[1];
  return { r, got: got ? (JSON.parse(got) as FigureBoard) : undefined, built: (r.stdout.match(/· board\(\) built the board from cad\/pcb\.mjs/g) ?? []).length };
}

/** The box's board as `sprue pcb` builds it, in this process: what the fab prints, what the board code drew, and the
 * pads on the top copper. */
async function boxBoard() {
  const here = process.cwd();
  process.chdir(cwd);
  try {
    const { buildPcb } = await import("./pcb.ts");
    const b = await buildPcb("box");
    const pads = b.data.pads.filter((p) => p.layers.includes("F.Cu")).map(({ ref, num, x, y, w, h, shape, drill }) => ({ ref, num, x, y, w, h, shape, drill: drill ?? null }));
    return { printed: b.fab.silk, drawn: b.data.silk, pads };
  } finally {
    process.chdir(here);
  }
}

test("board() is the board's silkscreen as the fab prints it and its top pads, from pcb/board.json while that is of this board, else built", async () => {
  try {
    // No pcb/ yet: board() builds the board, once however often the figure asks, and says so.
    let { r, got, built } = drawBoard(boardCode("HI"));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(built, 1, r.stdout);
    assert.match(r.stdout, /· board\(\) built the board from cad\/pcb\.mjs, since pcb\/board\.json is not there or is of an earlier board: `sprue pcb box` writes it, and the figure then reads it/);
    const hi = await boxBoard();
    assert.deepEqual(got, { width: 61, height: 60, silk: hi.printed, pads: hi.pads });
    // As printed: the hole's keepout cuts the H's bar and the I's stem, so it is not the text as drawn.
    assert.notDeepEqual(hi.printed.strokes, hi.drawn.strokes);
    assert.ok(hi.printed.strokes.every((st) => st.pts.every(([x, y]) => Math.hypot(x, y + 20) >= 1.2)), "a stroke runs into the hole's keepout");
    assert.ok(hi.printed.strokes.length > 0 && hi.printed.dots.length === 1, "no silkscreen, or no pin-1 dot by the Pico");
    // The top copper only: the Pico's 40 pads, none of the socket's, which are on the back.
    assert.equal(hi.pads.length, 40);
    assert.ok(hi.pads.every((p) => p.ref === "U1"));

    // `sprue pcb` writes the printed silkscreen into board.json, and the figure reads it from there.
    const pcb = spawnSync(SPRUE, ["pcb", "box"], { cwd, encoding: "utf8", timeout: 120_000 });
    const boardJson = join(dir, "pcb", "board.json");
    const saved = JSON.parse(readFileSync(boardJson, "utf8"));
    assert.deepEqual(saved.silk, hi.printed, pcb.stdout + pcb.stderr);
    ({ r, got, built } = drawBoard(boardCode("HI")));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(built, 0, r.stdout);
    assert.deepEqual(got, { width: 61, height: 60, silk: hi.printed, pads: hi.pads });
    // Read, not built again: a mark put into board.json shows in the figure.
    const marked = { strokes: [], dots: [{ x: 9, y: 9, d: 0.5 }] };
    writeFileSync(boardJson, JSON.stringify({ ...saved, silk: marked }));
    ({ got, built } = drawBoard(boardCode("HI")));
    assert.equal(built, 0);
    assert.deepEqual(got?.silk, marked);
    // But only while board.json is of the board drc.json audited: one of another fingerprint is built over.
    writeFileSync(boardJson, JSON.stringify({ ...saved, inputs: "0123456789abcdef", silk: marked }));
    ({ got, built } = drawBoard(boardCode("HI")));
    assert.equal(built, 1);
    assert.deepEqual(got?.silk, hi.printed);
    writeFileSync(boardJson, JSON.stringify(saved));

    // The board code changed since: board.json and drc.json are both of an earlier board (their fingerprints agree,
    // but not with the files drc.json read), so board() builds the board as it now is.
    ({ r, got, built } = drawBoard(boardCode("HO")));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(built, 1, r.stdout);
    const ho = await boxBoard();
    assert.deepEqual(got, { width: 61, height: 60, silk: ho.printed, pads: ho.pads });
    assert.notDeepEqual(got?.silk, hi.printed);

    // A board.json of this board written before it carried the silkscreen: built too.
    spawnSync(SPRUE, ["pcb", "box"], { cwd, encoding: "utf8", timeout: 120_000 });
    const old = JSON.parse(readFileSync(boardJson, "utf8"));
    delete old.silk;
    writeFileSync(boardJson, JSON.stringify(old));
    ({ got, built } = drawBoard(boardCode("HO")));
    assert.equal(built, 1);
    assert.ok(got?.silk.strokes.length);

    // Board code that throws stops the figure, saying why and where in cad/pcb.mjs first (then where figure.mjs
    // asked for the board); so does a syntax error in it, and asking for a board a product doesn't have.
    ({ r } = drawBoard(`export default function board() {\n  throw new Error("no outline yet");\n}\n`));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^✗ figure: board\(\): cad\/pcb\.mjs could not draw the board, so the figure can't draw it: .*no outline yet/m);
    assert.match(r.stderr.split("\n")[1], /^\s+at .*cad\/pcb\.mjs[^\n]*:2:9\)?$/);
    ({ r } = drawBoard(`export default function board() {\n  pcb.outline(61, 60, 1));\n}\n`));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^✗ figure: board\(\): cad\/pcb\.mjs could not draw the board, .*SyntaxError/m);
    assert.match(r.stderr, /cad\/pcb\.mjs:2\n/);
    // A syntax error in a module the board code imports, which Node's loader names nowhere: that module, by line.
    writeFileSync(join(dir, "cad", "layout.mjs"), "export const W = 61;\nexport const H = 60);\n");
    ({ r } = drawBoard(`import { W } from "./layout.mjs";\nexport default function board({ pcb }) {\n  pcb.outline(W, 60, 1);\n}\n`));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^✗ figure: board\(\): cad\/pcb\.mjs could not draw the board, .*SyntaxError/m);
    assert.match(r.stderr, /cad\/layout\.mjs:2\n/);
    rmSync(join(dir, "cad", "layout.mjs"));
    ({ r } = drawBoard(null));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^✗ figure: figure\.mjs asks for the board, but products\/box has none: board\(\) draws the one cad\/pcb\.mjs draws$/m);
  } finally {
    rmSync(join(dir, "cad"), { recursive: true, force: true });
    rmSync(join(dir, "pcb"), { recursive: true, force: true });
  }
});

const ROOT = join(import.meta.dirname, "..", "..", "..");

test("the keypad's figure prints the board's own silkscreen on the board's top face, each stroke as wide as its pen, and its pads", async () => {
  const here = process.cwd();
  process.chdir(ROOT);
  try {
    const built = await buildFigure("macropad");
    const board = built.board;
    assert.ok(board, "the keypad's figure did not ask for its board");
    assert.equal(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "figure.svg"), "utf8"), built.svg + "\n",
      "examples/macropad/figure.svg is not what figure.mjs draws now: run sprue figure macropad");
    const P = built.projection;
    // The PCB's part, up to the next part.
    const from = built.svg.indexOf('<g class="a2-part" data-line="pcb"');
    const part = built.svg.slice(from, built.svg.indexOf('<g class="a2-part"', from + 1));
    assert.ok(from >= 0 && part.length > 0, "the figure has no pcb part");
    // Every stroke the fab prints, as a line in the board's own mm under a transform onto its top face (z = 0), each
    // as wide as its pen in mm: as wide as the board's ink along every direction, at any zoom (the kit's lines keep
    // one width on screen; the board's ink doesn't).
    const o = k.iso([0, 0, 0], P), ux = k.iso([1, 0, 0], P), uy = k.iso([0, 1, 0], P);
    const m = [ux[0] - o[0], ux[1] - o[1], uy[0] - o[0], uy[1] - o[1], o[0], o[1]];
    const group = /<g transform="matrix\(([^)]*)\)">((?:<path [^>]*\/>)*)<\/g>/.exec(part);
    assert.ok(group, "no silkscreen drawn on the board's top face");
    const got = group[1].split(" ").map(Number);
    got.forEach((v, i) => assert.ok(Math.abs(v - m[i]) < 1e-3, `the silkscreen's transform is not the board's top face: ${group[1]}`));
    const mm = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${+x.toFixed(3)} ${+y.toFixed(3)}`).join("");
    const want = [
      ...board.silk.strokes.map((st) => `${st.width} ${mm(st.pts)}`),
      ...board.silk.dots.map((d) => `${d.d} ${mm([[d.x, d.y], [d.x, d.y]])}`),
    ].sort();
    const silk = [...group[2].matchAll(/<path class="iso-line" data-tone="lo" style="vector-effect:none;stroke-width:([\d.]+)" d="([^"]*)"\/>/g)];
    assert.equal(silk.map((x) => x[0]).join(""), group[2], "the silkscreen's group holds something else");
    const drawn = silk.flatMap(([, width, d]) => d.split(/(?=M)/).map((sub) => `${width} ${sub}`)).sort();
    assert.deepEqual(drawn, want);
    // On top of the board, not under its top face (which is opaque).
    assert.ok(group.index > part.lastIndexOf('class="iso-top"'), "the silkscreen is painted under the board's top");
    // The board's own top pads, the Pico's 40, each outlined on the top face where the board has it.
    assert.equal(board.pads.length, 40);
    for (const pad of board.pads)
      assert.ok(part.includes(k.planOutline({ x: pad.x - pad.w / 2, y: pad.y - pad.h / 2, w: pad.w, d: pad.h, r: 0.1 }, 0, P, 2)), `pad ${pad.ref}.${pad.num} isn't drawn where the board has it`);
    assert.ok(board.silk.strokes.length > 100, `the keypad's silkscreen has only ${board.silk.strokes.length} strokes`);
    assert.ok(board.silk.dots.length >= 1, "the Pico's pin-1 dot is gone");
    // And no made-up markings: past the board itself (its solid), every other line and shade on it is a round hole
    // (or its ring) or one of the board's pads, read back onto the board through the inverse of its top face's
    // transform.
    const det = m[0] * m[3] - m[1] * m[2];
    const onBoard = ([sx, sy]: number[]) => {
      const [dx, dy] = [sx - m[4], sy - m[5]];
      return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det];
    };
    const rest = (part.slice(0, group.index) + part.slice(group.index + group[0].length)).replace(/<g class="iso-solid">.*?<\/g>/, "");
    assert.ok(!rest.includes("iso-solid") && !rest.includes("iso-top"), "the board's solid is not one group");
    const marks = [...rest.matchAll(/<path class="(?:iso-line|iso-shade)"[^>]* d="([^"]*)"/g)].flatMap(([, d]) => d.split(/(?=M)/));
    assert.ok(marks.length > 40, `only ${marks.length} marks on the board`);
    // The drawing keeps a tenth of a pixel, about 0.03 mm on the board at this scale.
    const tol = 0.1;
    for (const sub of marks) {
      const pts = [...sub.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => onBoard([+x, +y]));
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const rs = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
      const [x0, x1, y0, y1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
      // Round: every point as far from the middle, and as wide and as deep as that circle (a rounded square drawn by
      // its corners alone has the first, not the second).
      const r = rs.reduce((a, b) => a + b, 0) / rs.length;
      const round = pts.length >= 12 && Math.max(...rs) - Math.min(...rs) < tol && Math.abs(x1 - x0 - 2 * r) < tol && Math.abs(y1 - y0 - 2 * r) < tol;
      const isPad = board.pads.some((p) => Math.abs(x0 - (p.x - p.w / 2)) < tol && Math.abs(x1 - (p.x + p.w / 2)) < tol && Math.abs(y0 - (p.y - p.h / 2)) < tol && Math.abs(y1 - (p.y + p.h / 2)) < tol);
      assert.ok(round || isPad, `a made-up marking on the board, from (${x0.toFixed(2)}, ${y0.toFixed(2)}) to (${x1.toFixed(2)}, ${y1.toFixed(2)}) mm: ${sub.slice(0, 80)}`);
    }
  } finally {
    process.chdir(here);
  }
});
