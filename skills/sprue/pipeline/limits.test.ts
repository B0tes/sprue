// What Sprue can't check (limits.ts): mains power in the product, batteries, soft goods and made metal parts, found in
// the request, the design and the parts list, said where they were found, never where the words say they aren't there,
// and never in the worked examples. The commands say it: `sprue new` from the brief, `sprue check`, `sprue figure`,
// `sprue status` and `sprue accept` at Design's gate, which still accepts. Run them with
//   node --test skills/sprue/pipeline/limits.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LIMITS, limitLines, limitsIn, limitsOf, type LimitKind } from "./limits.ts";
import type { Bom, BomLine, Design, Request } from "./types.ts";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
const EXAMPLES = join(import.meta.dirname, "..", "examples");
const cwd = mkdtempSync(join(tmpdir(), "sprue-limits-"));
after(() => rmSync(cwd, { recursive: true, force: true }));

const request = (brief: string, more: Partial<Request> = {}): Request =>
  ({ slug: "t", brief, product: "", units: 1, region: "EU", mustHave: [], niceToHave: [], constraints: {}, ...more });
const kinds = (r: { request?: Partial<Request>; design?: Partial<Design>; bom?: Partial<Bom> }) => limitsOf(r).map((l) => l.kind);
const line = (id: string, more: Partial<BomLine>): BomLine =>
  ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1, spec: {}, ...more });
const bomOf = (...lines: BomLine[]): Bom => ({ slug: "t", units: 1, lines });

test("the worked examples, the keypad and Ponder, have nothing out of Sprue's reach", () => {
  for (const slug of ["macropad", "ponder"]) {
    const read = (f: string) => JSON.parse(readFileSync(join(EXAMPLES, slug, f), "utf8"));
    assert.deepEqual(limitsOf({ request: read("request.json"), design: read("design.json"), bom: read("bom.json") }), [], slug);
  }
});

test("each kind is found in the brief, said once, in a fixed order, with where and the words there", () => {
  const ls = limitsOf({ request: request("A lamp plugged into the wall at 230 V, with an 18650 lithium cell, a leather strap and a CNC aluminium arm. " +
    "It has a second battery too.") });
  assert.deepEqual(ls.map((l) => l.kind), ["mains", "battery", "soft", "metal"]);
  for (const l of ls) {
    assert.equal(l.title, LIMITS[l.kind].title);
    assert.equal(l.detail, LIMITS[l.kind].detail);
    // One place: the brief, however many of the kind's words it has.
    assert.equal(l.found.length, 1, l.kind);
    assert.match(l.found[0], /^request\.json brief: "/);
  }
  // The words around the match, whole words, with … where the text goes on.
  assert.equal(ls[0].found[0], 'request.json brief: "…plugged into the wall at 230 V, with an 18650 lithium cell,…"');
  // The first of the kind's words in the text, whichever word it is.
  assert.equal(ls[1].found[0], 'request.json brief: "…the wall at 230 V, with an 18650 lithium cell, a leather…"');
  assert.equal(ls[3].found[0], 'request.json brief: "…cell, a leather strap and a CNC aluminium arm. It has a…"');
});

test("every kind's words: what each finds", () => {
  const cases: [LimitKind, string][] = [
    ["mains", "runs off mains"], ["mains", "a 120 V AC heater"], ["mains", "an AC/DC converter inside"], ["mains", "IEC C14 inlet on the back"],
    ["mains", "a power cord"], ["mains", "a Schuko plug"], ["mains", "an E27 bulb socket"], ["mains", "a triac dimmer"], ["mains", "line-voltage wiring"],
    ["battery", "a LiPo pack"], ["battery", "Li-ion"], ["battery", "a CR2032 holder"], ["battery", "a coin cell"], ["battery", "a TP4056 charger"],
    ["battery", "NiMH cells"], ["battery", "a power bank"], ["battery", "LiFePO4"],
    ["soft", "a canvas cover"], ["soft", "sewn seams"], ["soft", "a padded lid"], ["soft", "hook-and-loop closure"], ["soft", "a wrist strap"],
    ["soft", "a foam insert"], ["soft", "upholstered seat"],
    ["metal", "a machined aluminium plate"], ["metal", "a sheet-metal bracket"], ["metal", "a welded frame"], ["metal", "a die-cast body"],
    ["metal", "metal 3D printed hinge"], ["metal", "a laser-cut steel panel"], ["metal", "forged"], ["metal", "DMLS"],
  ];
  for (const [kind, text] of cases) assert.deepEqual(kinds({ request: request(text) }), [kind], text);
  // Words that only look like one: a 5 V supply, a C-clip, a felt-tip pen label, CNC Kitchen's inserts, a 2400 mAh in
  // nothing, a 1200 mm desk.
  for (const text of ["5 V DC from USB", "a 12 V barrel jack", "PCB-mounted USB-C socket", "CNC Kitchen heat-set inserts", "a 1200 mm desk",
    "a bought aluminium extrusion", "the case's wall is 2 mm", "standoffs and a strap wrench to assemble", "a stamp of the logo"])
    assert.deepEqual(kinds({ request: request(text) }), [], text);
});

test("words that say it isn't there are not a limit, within their clause", () => {
  for (const text of ["no battery in this version", "battery-free", "without a battery", "never mains", "not a CNC part", "free of batteries",
    "USB powered instead of mains", "Batteries: none"])
    assert.deepEqual(kinds({ request: request(text) }), [], text);
  // A new clause, or a "but", starts again.
  assert.deepEqual(kinds({ request: request("No battery, but a coin cell keeps the clock") }), ["battery"]);
  assert.deepEqual(kinds({ request: request("No mains. A lithium cell runs it") }), ["battery"]);
  // The first mention of a kind that is there is the one shown.
  assert.equal(limitsOf({ request: request("no battery here; a LiPo pack runs it") })[0].found[0], 'request.json brief: "no battery here; a LiPo pack runs it"');
});

test("the request's other fields, and constraints by name and value: false, none and no aren't there", () => {
  const r = request("A lamp", {
    product: "Fabric lamp", mustHave: ["dims to 10%", "runs a day on its battery"], niceToHave: ["a leather strap"],
    constraints: { power: "USB-C, no mains", lithiumBattery: true, mainsInlet: false, metalParts: "none", sheetMetal: "no", cnc: 0 },
  });
  const ls = limitsOf({ request: r });
  assert.deepEqual(ls.map((l) => [l.kind, l.found]), [
    ["battery", ['request.json mustHave[1]: "runs a day on its battery"', 'request.json constraints.lithiumBattery: "lithium Battery"']],
    ["soft", ['request.json product: "Fabric lamp"', 'request.json niceToHave[0]: "a leather strap"']],
  ]);
});

test("the design's summary, architecture and param names", () => {
  const design: Partial<Design> = {
    summary: "A desk fan.", architecture: ["The motor runs from a 230 V AC supply."], params: { batteryMah: 2000, wristStrapMm: 20, wallMm: 2 },
  };
  assert.deepEqual(limitsOf({ design }).map((l) => [l.kind, l.found]), [
    ["mains", ['design.json architecture[0]: "The motor runs from a 230 V AC supply."']],
    ["battery", ['design.json params.batteryMah: "battery Mah"']],
    ["soft", ['design.json params.wristStrapMm: "wrist Strap Mm"']],
  ]);
});

test("the parts list: a bought plug-in supply keeps mains outside; one built in, a cell, soft goods and made metal parts are found", () => {
  const supply = line("psu", { name: "USB-C wall adapter, 5 V 3 A", role: "power-supply", spec: { input: "100-240 V AC", plug: "EU" } });
  assert.deepEqual(kinds({ bom: bomOf(supply) }), []);
  // Built in, it is mains in the product.
  const module = line("acdc", { name: "Power supply module, 230 V in", role: "power-supply", spec: {} });
  assert.deepEqual(limitsOf({ bom: bomOf(supply, module) }).map((l) => [l.kind, l.found]),
    [["mains", ['bom.json line acdc name: "Power supply module, 230 V in"']]]);
  // A mains line in the product, said in a spec.
  assert.deepEqual(limitsOf({ bom: bomOf(line("relay", { name: "Relay", spec: { contacts: "250 V AC 10 A" } })) })[0].found,
    ['bom.json line relay spec.contacts: "contacts: 250 V AC 10 A"']);
  assert.deepEqual(limitsOf({ bom: bomOf(line("cell", { name: "18650 cell holder", role: "battery-holder" })) })[0].found,
    ['bom.json line cell name: "18650 cell holder"', 'bom.json line cell role: "battery-holder"']);
  assert.deepEqual(kinds({ bom: bomOf(line("sleeve", { name: "Neoprene sleeve" })) }), ["soft"]);
  // Made metal: machined, sheet and printed in a metal; a bought metal part, a printed plastic one, and words in a
  // line's notes or part number are not.
  const made = bomOf(
    line("plate", { process: "cnc" }), line("bracket", { process: "sheet" }),
    line("hinge", { process: "print", spec: { material: "AlSi10Mg", process: "SLM" } }),
    line("case", { process: "print", spec: { material: "PETG" } }),
    line("rod", { name: "Machined aluminium rod, bought", process: "buy" }),
    line("ins", { name: "M3 insert", notes: "CNC Kitchen, no battery, not mains", mpn: "CR2032" }),
  );
  assert.deepEqual(limitsOf({ bom: made }).map((l) => [l.kind, l.found]), [["metal", [
    'bom.json line plate: made by CNC (process "cnc")', 'bom.json line bracket: made from sheet metal (process "sheet")',
    "bom.json line hinge: printed in AlSi10Mg",
  ]]]);
  // A line that isn't one (no id) is not read.
  assert.deepEqual(kinds({ bom: { lines: [null, { name: "lithium" }] as unknown as BomLine[] } }), []);
});

test("the lines that say it: kind, what to do, and the first two places with how many more", () => {
  const ls = limitsOf({ request: request("A battery lamp", { mustHave: ["battery", "battery"], niceToHave: ["battery"] }) });
  assert.equal(ls[0].found.length, 4);
  const [text] = limitLines(ls);
  assert.equal(text, `⚑ out of Sprue's reach: Batteries. ${LIMITS.battery.detail} Found in request.json brief: "A battery lamp"; ` +
    'request.json mustHave[0]: "battery"; and 2 more places.');
  assert.match(limitLines(limitsOf({ request: request("a battery", { mustHave: ["battery", "x"], niceToHave: ["battery"] }) }))[0], /; and 1 more place\.$/);
  assert.match(limitLines(limitsOf({ request: request("a battery") }))[0], /Found in request\.json brief: "a battery"\.$/);
  assert.deepEqual(limitLines([]), []);
});

test("limitsIn reads the product's files as they are, and leaves out one that is missing or isn't JSON", () => {
  const dir = join(cwd, "products", "r");
  mkdirSync(dir, { recursive: true });
  const here = process.cwd();
  try {
    process.chdir(cwd);
    assert.deepEqual(limitsIn("r"), []);
    writeFileSync(join(dir, "request.json"), JSON.stringify(request("a lithium lamp")));
    writeFileSync(join(dir, "design.json"), "{");
    writeFileSync(join(dir, "bom.json"), JSON.stringify([1]));
    assert.deepEqual(limitsIn("r").map((l) => l.kind), ["battery"]);
    writeFileSync(join(dir, "design.json"), JSON.stringify({ summary: "A felted cover", params: {} }));
    writeFileSync(join(dir, "bom.json"), JSON.stringify(bomOf(line("arm", { process: "cnc" }))));
    assert.deepEqual(limitsIn("r").map((l) => l.kind), ["battery", "soft", "metal"]);
  } finally {
    process.chdir(here);
  }
});

/** A product with a battery, `sprue <args>` on it. */
const sprue = (...args: string[]) => spawnSync(SPRUE, args, { cwd, encoding: "utf8", timeout: 60_000 });

test("the commands say it: new from the brief, then check, figure, status and accept at Design, which still accepts", () => {
  const made = sprue("new", "lamp", "A desk lamp with a LiPo battery");
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.match(made.stdout, /^ {2}⚑ out of Sprue's reach: Batteries\. .* Found in request\.json brief: "A desk lamp with a LiPo battery"\.$/m);
  const plain = sprue("new", "plain", "A USB desk lamp, no battery");
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(plain.stdout, /out of Sprue's reach/);

  const dir = join(cwd, "products", "lamp");
  const r = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as Request;
  writeFileSync(join(dir, "request.json"), JSON.stringify({ ...r, product: "Desk lamp", mustHave: ["light"] }));
  writeFileSync(join(dir, "design.json"), JSON.stringify({ slug: "lamp", summary: "A lamp.", architecture: [], params: {} }));
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ slug: "lamp", units: 1, lines: [
    { id: "led", name: "LED", role: "light", process: "buy", qtyPerUnit: 1, spec: {} },
    { id: "cell", name: "LiPo cell, 1000 mAh", role: "battery", process: "buy", qtyPerUnit: 1, spec: {} },
  ] }));
  writeFileSync(join(dir, "figure.mjs"), `export default function draw({ k, fig }) {
  const P = fig.camera([[0, 0, 0], [10, 10, 10]]);
  const [a, b] = [[0, 0, 0], [10, 0, 0]].map((p) => k.iso(p, P));
  fig.part("led", \`<path d="M\${a[0]} \${a[1]}L\${b[0]} \${b[1]}"/>\`, { step: 1 });
  fig.part("cell", \`<path d="M\${a[0]} \${a[1]}L\${b[0]} \${b[1]}"/>\`, { step: 1 });
  return { title: "Lamp" };
}\n`);
  const said = /^ {2}⚑ out of Sprue's reach: Batteries\. .* Found in request\.json brief: "A desk lamp with a LiPo battery"; bom\.json line cell name: "LiPo cell, 1000 mAh"; and 1 more place\.$/m;
  for (const args of [["check", "lamp"], ["figure", "lamp"], ["status", "lamp"]]) {
    const out = sprue(...args);
    assert.match(out.stdout, said, `${args.join(" ")}: ${out.stdout}${out.stderr}`);
  }
  const accepted = sprue("accept", "lamp");
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, said);
  assert.match(accepted.stdout, /^design accepted$/m);
  // Past Design, status still says it.
  assert.match(sprue("status", "lamp").stdout, said);
});
