// What Sprue can't check (limits.ts): mains power in the product, batteries, soft goods and made metal parts, found in
// the request, the design and the parts list, said where they were found, never where the words say they aren't there,
// and never in the worked examples. The commands say it once each, with no change to their exit codes: `sprue new` from
// the brief, `sprue check`, `sprue figure`, `sprue status`, `sprue all`, and `sprue accept` at Design's gate only, once
// it accepts. A part printed in metal is not priced at a plastic's rate. Run them with
//   node --test skills/sprue/pipeline/limits.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LIMITS, limitLines, limitsIn, limitsOf, printedInMetal, type LimitKind } from "./limits.ts";
import { fabOptions } from "./adapters/fab.ts";
import { loadRates } from "./explore.ts";
import { whyUnpriced } from "./stages/quote.ts";
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
  // The words around the first of the kind's words in the text, whichever word it is: whole words, with … where the
  // text goes on.
  assert.equal(ls[0].found[0], 'request.json brief: "A lamp plugged into the wall at 230 V, with an 18650…"');
  assert.equal(ls[1].found[0], 'request.json brief: "…the wall at 230 V, with an 18650 lithium cell, a leather…"');
  assert.equal(ls[3].found[0], 'request.json brief: "…cell, a leather strap and a CNC aluminium arm. It has a second battery…"');
});

/** Each text, read as a brief, finds `kinds` and nothing else. */
function each(cases: [string, LimitKind[]][]) {
  for (const [text, want] of cases) assert.deepEqual(kinds({ request: request(text) }), want, text);
}

test("mains: in the product, by its words or what it is; not a plug-in supply that keeps it outside", () => {
  each([
    ["runs off mains", ["mains"]], ["a 120 V AC heater", ["mains"]], ["an AC/DC converter inside", ["mains"]], ["IEC C14 inlet on the back", ["mains"]],
    ["a power cord", ["mains"]], ["a Schuko plug", ["mains"]], ["an E27 bulb socket", ["mains"]], ["a triac dimmer", ["mains"]], ["line-voltage wiring", ["mains"]],
    ["A Wi-Fi smart plug that switches my lamp on a schedule", ["mains"]], ["A two-slice toaster with a bagel button", ["mains"]],
    ["An electric kettle with a temperature dial", ["mains"]], ["A ceiling light fixture with a pull-cord switch", ["mains"]],
    ["A desk fan that runs on AC", ["mains"]], ["A lamp plugged into the wall", ["mains"]], ["A lamp for an Edison bulb", ["mains"]],
    ["Non-isolated 230 V AC to 5 V", ["mains"]],
    // A plug-in supply in the same sentence keeps it outside; built in, it doesn't.
    ["A USB-C desk lamp powered by a 5 V phone charger that plugs into the wall", []],
    ["A sensor hub powered by a 5 V adapter that plugs into the wall", []], ["A night light that runs from a USB phone charger in the wall socket", []],
    ["Powered by a bought 12 V wall adapter (100-240 V AC input)", []], ["Powered by an AC power adapter, 12 V", []], ["A USB lamp with a mains adapter", []],
    ["A USB-C desk lamp with a 1.5 m braided USB power cord", []], ["Mains -> 12 V plug-in adapter -> barrel jack -> buck -> 5 V", []],
    ["A lamp with a built-in 230 V supply and a USB charger port", ["mains"]], ["No wall adapter: it runs from mains directly", ["mains"]],
    ["A lamp plugged into the wall. A phone charger is not part of it", ["mains"]],
    ["A 230 V lamp. The clock beside it runs from a wall adapter", ["mains"]],
    // The board, a module or a case in the sentence is not the supply built in; a supply that is, is.
    ["The board is powered by a 5 V USB charger that plugs into the wall", []], ["An ESP32 board powered by a 5 V adapter that plugs into the wall", []],
    ["A clock with an LED matrix module, powered by a USB charger that plugs into the wall", []],
    ["USB-C wall adapter (100-240 V AC) -> USB-C socket on the board -> 3.3 V LDO", []],
    ["Mains -> 12 V plug-in adapter -> barrel jack -> buck module -> 5 V", []], ["A desk lamp with a 12 V wall adapter (100-240 V input)", []],
    ["An LED sign with a 12 V power brick, 100-240 V in", []], ["Mains -> USB charger -> USB-C socket", []],
    ["Mains -> 5 V wall adapter -> board -> LEDs", []], ["The board sits inside the case and a 12 V wall adapter takes 100-240 V", []], ["A lamp powered from a USB built-in supply, 230 V in", ["mains"]],
    ["Powered by a 12 V wall adapter, with a built-in 230 V outlet for a second lamp", ["mains"]],
    ["A 230 V lamp that charges your phone through a Qi charger", ["mains"]],
    ["A 230 V bedside clock that also charges via a USB charger port", ["mains"]],
    ["A 230 V bedside clock that also charges via a USB charger for your phone", ["mains"]],
    ["A lamp that plugs into the wall and has a USB charger", ["mains"]],
    ["A lamp powered by a wall adapter module, 230 V", ["mains"]], ["A lamp with a built-in USB charger, plugged into the wall", ["mains"]],
    // A charger or adapter the product has, or is, doesn't keep its own mains outside: only one that powers it does.
    ["A mains-powered alarm clock with a USB charger for my phone", ["mains"]], ["A 230 V desk lamp with a Qi wireless charger", ["mains"]],
    ["A mains-powered desk lamp with a USB charger port", ["mains"]], ["A 65 W USB-C GaN charger that plugs into the wall", ["mains"]],
    ["A plug-in night light with a PIR sensor, 230 V", ["mains"]], ["A 230 V inline duct fan with a 100 mm duct adapter", ["mains"]],
    ["A lamp that runs from a 230 V supply", ["mains"]], ["A 230 V AC battery charger for my drill packs", ["mains", "battery"]],
    // What it is, not what it is for: a stand for my kettle, a remote for the ceiling light, a key wired to a GPIO.
    ["A ceramic heater with a thermostat", ["mains"]], ["A ceiling light hardwired to the mains", ["mains"]],
    ["A stand for my kettle", []], ["A Zigbee remote for my ceiling light", []], ["A bracket for my power strip", []],
    ["A remote for the living room ceiling light", []],
    ["A toaster-shaped enclosure for a Pico", []], ["A 2 m USB extension cord for the keypad", []],
    ["A 3x3 macro keypad, each key hardwired to a GPIO", []], ["The I2C address is hard-wired to 0x3C", []],
    ["A cordless drill holder for my pegboard", []], ["A hair dryer wall mount", []], ["A cable organizer for power cords under the desk", []],
    // The user's own product is what it is: "build my own smart plug".
    ["Build my own smart plug that reports power use", ["mains"]], ["Design my own toaster", ["mains"]],
    // Mains the product switches or dims is inside it, whatever powers the logic; a switch on the logic isn't mains.
    ["A dimmer for a 230 V lamp, powered by a USB charger", ["mains"]],
    ["A Sonoff-style smart switch with a relay for 230 V loads, powered by a 5 V USB wall adapter", ["mains"]],
    ["A keypad with nine switches powered by a USB charger plugged into the wall", []], ["Powered by a 230 V switching wall adapter", []],
    // Built in, said before the supply; the board as the subject is not the supply built in.
    ["Mains -> internal 5 V adapter -> LEDs", ["mains"]], ["A clock that plugs into the wall and runs from an internal 5 V adapter", ["mains"]],
    ["A lamp with a 230 V to 5 V module, powered by a wall adapter", ["mains"]], ["The LEDs inside run from a USB charger that plugs into the wall", []],
    ["The board gets 5 V from a USB charger plugged into the wall", []],
    // Only near the mains words: a display board at the clause's far end is not the supply built in.
    ["A desk clock that plugs into the wall through a small 5 V USB phone charger beside the display board", []],
    // Other ways to say a charger powers it.
    ["A clock powered over USB from a phone charger plugged into the wall", []], ["Uses a 5 V phone charger that plugs into the wall", []],
    ["A bedside clock that plugs into the wall with a USB charger", []], ["A lamp that plugs into the wall with a Qi charger", ["mains"]],
    ["A night light powered by your phone's USB charger in the wall socket", []],
  ]);
});

test("batteries: cells, packs, chargers and what runs on one", () => {
  each([
    ["a LiPo pack", ["battery"]], ["Li-ion", ["battery"]], ["a CR2032 holder", ["battery"]], ["a coin cell", ["battery"]], ["a TP4056 charger", ["battery"]],
    ["NiMH cells", ["battery"]], ["a power bank", ["battery"]], ["LiFePO4", ["battery"]], ["A rechargeable bike light", ["battery"]],
    ["A cordless handheld vacuum", ["battery"]], ["A TV remote that runs on two AA cells", ["battery"]], ["powered by 3 x AAA", ["battery"]],
    ["A key finder with a non-rechargeable CR2032", ["battery"]], ["A bike light with a non-removable LiPo", ["battery"]],
    ["A wearable without a screen that runs on a 100 mAh LiPo", ["battery"]], ["A small speaker with no display that runs on an 18650", ["battery"]],
    ["A tag no bigger than a matchbox with a CR2032 inside", ["battery"]], ["It shouldn't be heavy and runs on a LiPo", ["battery"]],
    ["A no-solder kit with a coin cell holder", ["battery"]], ["A speaker with no buttons and a LiPo battery", ["battery"]],
    ["No-name LiPo 1000 mAh", ["battery"]], ["Non-protected 18650 cell, 3000 mAh", ["battery"]],
    ["lube the rails with lithium grease", []], ["A battery-less badge", []], ["a supercap, battery-less", []],
    // Said to be there by what is done to it: drained, removed, replaced, or less than 2 g.
    ["A doorbell that doesn't drain the battery", ["battery"]], ["A torch you can charge without removing the battery", ["battery"]],
    ["Runs for a year without replacing the battery", ["battery"]], ["A wearable with a battery less than 2 g", ["battery"]],
    ["A kids' toy with no removable batteries", ["battery"]], ["A speaker with no user-replaceable battery", ["battery"]],
    ["A nightlight with no accessible coin cell", ["battery"]],
    // Not what the product is for: a holder for my cordless drill.
    ["A wall holder for my cordless drill", []], ["A charging dock for my rechargeable toothbrush", []], ["A rechargeable toothbrush holder", []],
    ["A rechargeable wall mount lamp", ["battery"]], ["I want to build my own rechargeable bike light", ["battery"]],
    ["Help me design my rechargeable reading lamp", ["battery"]],
    // Coin and button cells and AAs, however they are written; not a sensor's or a standard's name.
    ["A coin-cell powered key finder for kids", ["battery"]], ["A key finder that runs on two CR2032s", ["battery"]],
    ["A keychain light that runs on three LR44s", ["battery"]], ["A night light toy with an AG13 cell", ["battery"]],
    ["A remote that runs on two AAAs", ["battery"]], ["A clock that takes AAs", ["battery"]],
    ["An HC-SR04 distance sensor on a USB-powered board", []], ["Meets WCAG 2.1 AA contrast", []], ["An AG 4 channel relay board", []],
  ]);
});

test("soft goods: fabric, foam, leather, straps, bags and anything sewn; not a board's stitching or a crafter's tools", () => {
  each([
    ["a canvas cover", ["soft"]], ["sewn seams", ["soft"]], ["A cover I'll sew myself", ["soft"]], ["a padded lid", ["soft"]], ["hook-and-loop closure", ["soft"]],
    ["a wrist strap", ["soft"]], ["a foam insert", ["soft"]], ["upholstered seat", ["soft"]], ["A backpack with a built-in light", ["soft"]],
    ["A camera strap with quick-release buckles", ["soft"]], ["A badge with a lanyard", ["soft"]], ["A tote bag with an LED panel", ["soft"]],
    ["A guitar strap with an LED", ["soft"]], ["A headphone stand with a foam-lined cradle", ["soft"]], ["A pillow speaker with memory foam", ["soft"]],
    ["An EVA foam case for my drone", ["soft"]], ["A dog collar with a GPS tag", ["soft"]], ["a phone stand with a foam pad", ["soft"]],
    ["a lamp with a felt base", ["soft"]],
    ["A 4-layer LoRa board with ground stitching vias", []], ["A 2-layer board with via stitching around the edge", []],
    ["Silicone feet cushion the speaker", []], ["A wall rack for sewing thread spools", []], ["A rack for my leather-working tools", []],
    ["A wall hanger for a canvas painting", []], ["standoffs and a strap wrench to assemble", []], ["felt pads under the feet", []],
    ["a holder for a LiPo pouch cell", ["battery"]],
    // Not a bearing, a glove the user wears, a lanyard's hole, a storage tote, or a hook for the user's bag.
    ["A pillow block bearing mount for a camera slider", []], ["Buttons big enough to press with gloves on", []],
    ["A glove-friendly remote", []], ["A keychain with a lanyard hole", []], ["A latch for a plastic storage tote", []],
    ["A wall hook for my backpack", []], ["A clip for my backpack strap", []], ["A storage tote with a lid that clicks shut", []],
    ["A pair of touchscreen gloves", ["soft"]], ["A camera strap on the side", ["soft"]], ["A drone case with foam inserts", ["soft"]],
    ["An LED pet harness", ["soft"]], ["A wiring harness for the LEDs, USB powered", []],
  ]);
  assert.deepEqual(kinds({ design: { params: { stitchViaPitchMm: 3, pcbPaddingMm: 1 } } }), []);
});

test("made metal parts: machined, sheet, welded, cast or metal-printed for the product; not the machine, or wood and acrylic", () => {
  each([
    ["a machined aluminium plate", ["metal"]], ["a sheet-metal bracket", ["metal"]], ["a welded frame", ["metal"]], ["a die-cast body", ["metal"]],
    ["metal 3D printed hinge", ["metal"]], ["a laser-cut steel panel", ["metal"]], ["forged", ["metal"]], ["DMLS", ["metal"]], ["a CNC part", ["metal"]],
    ["A bracket made of sheet steel", ["metal"]], ["A wall bracket bent from 1.5 mm steel sheet", ["metal"]],
    ["An enclosure folded from 2 mm aluminium sheet", ["metal"]], ["An aluminium case milled from billet", ["metal"]],
    ["A steel bracket, laser cut and bent", ["metal"]], ["A volume knob turned from brass", ["metal"]],
    ["An aluminium enclosure, CNC machined, with a walnut lid", ["metal"]],
    ["A 3x3 macro keypad to jog my CNC router", []], ["A USB pendant for my CNC mill", []], ["A control panel for my CNC machine", []],
    ["A button box for my laser cutter and CNC", []], ["A walnut desk tray I'll cut on my CNC router", []],
    ["A laser-cut sheet of 3 mm acrylic for the front panel", []], ["a CNC-cut plywood panel", []], ["CNC Kitchen heat-set inserts", []],
    ["a holder for welding rods", []], ["a bought aluminium extrusion", []],
    // A metal part the user's words make for their own things, and CNC'd metal said anywhere in the sentence.
    ["For my mechanical keyboard, a CNC aluminium case", ["metal"]], ["I want my keyboard case CNC machined in aluminium", ["metal"]],
    ["A replacement part for my bike, CNC machined", ["metal"]], ["A walnut speaker with a CNC aluminium grille", ["metal"]],
    ["A case milled from a solid block of aluminium", ["metal"]], ["An aluminium case, machined from solid", ["metal"]],
    // Wood said anywhere in the sentence, and no metal; or the user's own CNC.
    ["A walnut desk organizer, CNC milled", []], ["A plywood box that is CNC cut", []], ["A pen turned from solid walnut", []],
    ["A pendant for my CNC with an aluminium jog wheel", []], ["a dust shoe for my CNC", []], ["A walnut box with a CNC-carved lid", []],
    // Metal hardware in the sentence is not the part; accessories for the machine are not parts.
    ["A CNC-cut plywood enclosure held together with steel screws", []], ["A walnut case with a CNC-machined brass weight", ["metal"]],
    ["A dust boot for the CNC spindle", []], ["A storage box for CNC bits", []], ["A faceplate designed for CNC", ["metal"]],
  ]);
});

test("words that only look like one of them are not", () => {
  each([["5 V DC from USB", []], ["a 12 V barrel jack", []], ["PCB-mounted USB-C socket", []], ["a 1200 mm desk", []],
    ["the case's wall is 2 mm", []], ["a stamp of the logo", []], ["a cast shadow", []], ["a datasheet", []]]);
});

test("words that say it isn't there are not a limit, only right before it or right after", () => {
  each([["no battery in this version", []], ["battery-free", []], ["without a battery", []], ["never mains", []], ["not a CNC part", []],
    ["free of batteries", []], ["USB powered instead of mains", []], ["Batteries: none", []], ["avoid batteries", []], ["It doesn't need a battery", []],
    ["a lamp with no battery", []], ["no rechargeable battery", []], ["It doesn't run on batteries; it's USB powered", []],
    ["Not powered by mains", []], ["There's no need for a battery", []], ["No batteries or mains", []], ["No battery or LiPo", []],
    ["It needs neither a battery nor mains", []], ["A no-battery light switch", []], ["A sensor that works without using batteries", []]]);
  // A new clause, or a "but", starts again.
  assert.deepEqual(kinds({ request: request("No battery, but a coin cell keeps the clock") }), ["battery"]);
  assert.deepEqual(kinds({ request: request("No mains. A lithium cell runs it") }), ["battery"]);
  // The first mention of a kind that is there is the one shown.
  assert.equal(limitsOf({ request: request("no battery here; a LiPo pack runs it") })[0].found[0], 'request.json brief: "no battery here; a LiPo pack runs it"');
});

test("the request's other fields, and constraints by name and value: false, none, no and not required aren't there", () => {
  const r = request("A lamp", {
    product: "Fabric lamp", mustHave: ["dims to 10%", "runs a day on its battery"], niceToHave: ["a leather strap"],
    constraints: { power: "USB-C, no mains", lithiumBattery: true, mainsInlet: false, metalParts: "none", sheetMetal: "no", cnc: 0,
      backupBattery: "not required", batteryPack: "not needed", coinCell: "false", mainsPower: "avoid", budgetJpy: 21700, inputVoltageV: 230 },
  });
  const ls = limitsOf({ request: r });
  assert.deepEqual(ls.map((l) => [l.kind, l.found]), [
    ["mains", ['request.json constraints.inputVoltageV: "input Voltage V: 230 V"']],
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

test("the parts list: a bought supply that says it plugs in keeps mains outside; one built in, a cell, soft goods and made metal parts are found", () => {
  // Plug-in: its words say so, or its spec has a plug.
  for (const supply of [
    line("psu", { name: "USB-C wall adapter, 5 V 3 A", role: "power-supply", spec: { input: "100-240 V AC" } }),
    line("psu", { name: "12 V 3 A supply", role: "power-supply", spec: { input: "100-240 VAC", plug: "EU" } }),
    line("psu", { name: "USB-C 5 V 3 A supply", role: "power", spec: { input: "100-240 V AC" } }),
    line("psu", { name: "USB-C wall adapter, 5 V 3 A, 1.5 m cable", role: "power-supply", spec: { input: "100-240 V AC" } }),
    line("psu", { name: "12 V wall wart", role: "power", spec: { input: "100-240 V AC" } }),
    line("psu", { name: "5 V 2 A supply", role: "psu", spec: { input: "100-240 V AC", type: "EU plug" } }),
  ]) assert.deepEqual(kinds({ bom: bomOf(supply) }), [], supply.name);
  // Built in, or not said to plug in, its input is mains in the product.
  for (const [name, input] of [["Power supply module, 230 V in", undefined], ["Hi-Link HLK-PM01 5 V 600 mA power supply", "100-240 VAC"],
    ["Mean Well LRS-35-5 power supply, screw terminals", "85-264 V AC"], ["Mean Well GST36E12-P1J, 12 V 3 A", "100-240 VAC"]] as const) {
    const l = line("acdc", { name, role: "power-supply", spec: input ? { input } : {} });
    assert.deepEqual(kinds({ bom: bomOf(l) }), ["mains"], name);
  }
  assert.deepEqual(limitsOf({ bom: bomOf(line("acdc", { name: "Power supply module, 230 V in", role: "power-supply" })) })[0].found,
    ['bom.json line acdc name: "Power supply module, 230 V in"']);
  // A cord, lead or cord set with a plug brings mains in: only a supply, adapter or charger keeps it outside.
  for (const l of [
    line("cord", { name: "2-core power cord with EU plug, 2 m", role: "mains-cord", spec: { plug: "EU Schuko" } }),
    line("lead", { name: "IEC C13 lead, 1.8 m", spec: { plug: "US NEMA 5-15" } }),
    line("set", { name: "Cord set, EU plug, 2 m", spec: { plug: "EU", voltage: "230 V" } }),
    line("psu", { name: "Supply cord with Schuko plug, 2 m", role: "power-supply", spec: { plug: "EU" } }),
    // Not a supply, or a supply that is a module, or one made here, is in the product however it plugs in.
    line("dim", { name: "Triac dimmer insert", spec: { plug: "EU Schuko" } }),
    line("acdc", { name: "AC-DC charger module, 5 V", role: "power-supply", spec: { input: "230 V AC" } }),
    line("box", { name: "Charger case, 230 V", process: "print", spec: { material: "PETG", plug: "EU" } }),
  ]) assert.deepEqual(kinds({ bom: bomOf(l) }), ["mains"], l.name);
  // A mains load's voltage is what it runs on: a heater's, a fan's, a pump's, a bulb's.
  for (const l of [
    line("heat", { name: "Ceramic PTC heater 230 V 150 W" }), line("fan", { name: "230 V AC axial fan 80 mm" }),
    line("pump", { name: "Water pump", role: "pump", spec: { voltage: "230 V AC" } }), line("bulb", { name: "LED bulb, 230 V, 4 W" }),
    line("ptc", { name: "PTC heater with thermostat, 230 V 150 W", role: "heater" }),
    // And a mains part however the shop names it.
    line("inlet", { name: "IEC C14 panel inlet with fuse" }), line("holder", { name: "E27 ceramic lamp holder" }), line("bulb", { name: "LED filament bulb, E27, 4 W" }),
  ]) assert.deepEqual(kinds({ bom: bomOf(l) }), ["mains"], l.name);
  assert.deepEqual(kinds({ bom: bomOf(line("lr", { name: "LR44 alkaline cell, 1.5 V" })) }), ["battery"]);
  assert.deepEqual(kinds({ bom: bomOf(line("fan", { name: "12 V fan, 40 mm" }), line("bearing", { name: "KFL08 pillow block bearing" })) }), []);
  // A part's rating is not mains in the product: a switch's, a fuse's, a relay's, a capacitor's, a MOSFET's, a heater's
  // thermostat's.
  for (const l of [
    line("sw", { name: "KCD1 rocker switch", spec: { rating: "6 A 250 V AC" } }), line("mute", { name: "Miniature DPDT toggle, on-on", spec: { rating: "2 A 250 V AC" } }),
    line("fuse", { name: "5x20 mm glass fuse, 2 A 250 V" }), line("cap", { name: "100 nF 100 V X7R 0603", spec: { voltage: "100 V" } }),
    line("fet", { name: "IRF540N MOSFET", spec: { vds: "100 V" } }), line("cord", { name: "USB-C power cord, 1 m" }),
    line("relay", { name: "SRD-05VDC relay for the fan", spec: { rating: "10 A 250 VAC" } }),
    line("stat", { name: "KSD301 thermostat for the heater", spec: { rating: "10 A 250 V" } }), line("hr", { name: "Heater relay, 10 A 250 V AC" }),
  ]) assert.deepEqual(kinds({ bom: bomOf(l) }), [], l.name);
  // A mains line in the product, said in its words or its input.
  assert.deepEqual(limitsOf({ bom: bomOf(line("relay", { name: "Relay for the mains heater" })) })[0].found, ['bom.json line relay name: "Relay for the mains heater"']);
  assert.deepEqual(limitsOf({ bom: bomOf(line("timer", { name: "Smart timer", spec: { input: "230 V AC", rating: "250 V" } })) })[0].found,
    ['bom.json line timer spec.input: "input: 230 V AC"']);
  assert.deepEqual(limitsOf({ bom: bomOf(line("cell", { name: "18650 cell holder", role: "battery-holder" })) })[0].found,
    ['bom.json line cell name: "18650 cell holder"', 'bom.json line cell role: "battery-holder"']);
  assert.deepEqual(kinds({ bom: bomOf(line("grease", { name: "White lithium grease, 10 g tube" })) }), []);
  assert.deepEqual(kinds({ bom: bomOf(line("sleeve", { name: "Neoprene sleeve" })) }), ["soft"]);
  // Made metal: machined, sheet and printed in a metal; a bought metal part, a printed plastic one, one that only looks
  // or holds some metal, and words in a line's notes or part number are not.
  const made = bomOf(
    line("plate", { process: "cnc" }), line("bracket", { process: "sheet" }),
    line("hinge", { process: "print", spec: { material: "AlSi10Mg", process: "SLM" } }),
    line("case", { process: "print", spec: { material: "PETG" } }),
    line("fill", { process: "print", spec: { material: "Copper-filled PLA" } }), line("look", { process: "print", spec: { material: "Bambu PLA Metal, Iron Gray" } }),
    line("silk", { process: "print", spec: { material: "PLA, silk copper" } }),
    line("rod", { name: "Machined aluminium rod, bought", process: "buy" }),
    line("ins", { name: "M3 insert", notes: "CNC Kitchen, no battery, not mains", mpn: "CR2032" }),
  );
  assert.deepEqual(limitsOf({ bom: made }).map((l) => [l.kind, l.found]), [["metal", [
    'bom.json line plate: made by CNC (process "cnc")', 'bom.json line bracket: made from sheet metal (process "sheet")',
    "bom.json line hinge: printed in AlSi10Mg",
  ]]]);
  assert.equal(printedInMetal({ process: "print", spec: { material: "316L" } }), "316L");
  assert.equal(printedInMetal({ process: "print", spec: { material: "PA12" } }), undefined);
  assert.equal(printedInMetal({ process: "buy", spec: { material: "steel" } }), undefined);
  // A line that isn't one (no id) is not read, nor a value that is neither text nor a number.
  assert.deepEqual(kinds({ bom: { lines: [null, { name: "lithium" }] as unknown as BomLine[] } }), []);
  const odd = { toString: 1 } as unknown as string;
  assert.deepEqual(kinds({ bom: bomOf(line("x", { spec: { a: odd } })), request: request("a lamp", { constraints: { a: odd } }) }), []);
});

test("what to do: a coin cell of any kind behind a lid that takes a tool; only a single-use cell is never charged", () => {
  const d = LIMITS.battery.detail;
  assert.match(d, /a rechargeable coin cell \(LIR, ML\) a charger made for it/);
  assert.match(d, /a single-use cell \(a CR coin cell, an alkaline AA\) is never charged/);
  // A tool, not two hands: a toy's lid (16 CFR 1250) must take a tool, and a tool meets 16 CFR 1263 too.
  assert.match(d, /A coin or button cell of any kind goes behind a lid that takes a tool \(a screwdriver or a coin\) to open.*16 CFR 1263, or 16 CFR 1250 for a toy/);
  assert.doesNotMatch(d, /coin or other single-use cell|two hands/);
});

test("a long text stays quick: each clause and sentence is read only so far either way", () => {
  const t = performance.now();
  assert.deepEqual(kinds({ request: request("The 230 V supply. ".repeat(10000), { mustHave: ["mains usb charger ".repeat(1000)] }) }), ["mains"]);
  assert.ok(performance.now() - t < 5000, `${performance.now() - t} ms`);
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
  // Each says it once, and it changes no exit code: `sprue all` says it with its checks, not again with the figure.
  const times = (out: string) => (out.match(/out of Sprue's reach/g) ?? []).length;
  for (const args of [["check", "lamp"], ["figure", "lamp"], ["status", "lamp"], ["all", "lamp"]]) {
    const out = sprue(...args);
    assert.equal(out.status, 0, `${args.join(" ")}: ${out.stdout}${out.stderr}`);
    assert.match(out.stdout, said, `${args.join(" ")}: ${out.stdout}${out.stderr}`);
    assert.equal(times(out.stdout), 1, `${args.join(" ")}: ${out.stdout}`);
  }
  // An accept that is refused says only why: the limits are said when the design is accepted.
  writeFileSync(join(dir, "rules.ts"), `export const rules = [{ id: "nope", title: "Nope", needs: [], scope: "part", run: () => ({ status: "fail", detail: "always" }) }];\n`);
  const refused = sprue("accept", "lamp");
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(times(refused.stdout + refused.stderr), 0, refused.stdout + refused.stderr);
  rmSync(join(dir, "rules.ts"));
  const accepted = sprue("accept", "lamp");
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, said);
  assert.equal(times(accepted.stdout), 1);
  assert.match(accepted.stdout, /^design accepted$/m);
  // Past Design, status still says it, and accept no more.
  const inspected = sprue("inspect", "lamp");
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  const later = sprue("accept", "lamp");
  assert.equal(later.status, 0, later.stdout + later.stderr);
  assert.match(later.stdout, /^inspect accepted$/m);
  assert.equal(times(later.stdout), 0, later.stdout);
  assert.match(sprue("status", "lamp").stdout, said);
});

test("a part printed in metal is not priced at a plastic's rate: it stays unpriced, and says what to do", () => {
  const rates = loadRates();
  const metal = line("hinge", { process: "print", spec: { material: "AlSi10Mg", process: "SLM", volumeCm3: 5 } });
  assert.deepEqual(fabOptions(metal, 1, rates), []);
  assert.match(whyUnpriced(metal, rates), /^no print service in rates\.json prints in metal \(AlSi10Mg\): buy it instead .*or print it in plastic$/);
  // A plastic one is, and one that only looks like a metal.
  for (const material of ["PETG", "Copper-filled PLA"]) assert.ok(fabOptions(line("p", { process: "print", spec: { material, volumeCm3: 5 } }), 1, rates).length, material);
  assert.match(whyUnpriced(line("arm", { process: "cnc" }), rates), /can't pass the source gate until one does: buy it instead/);
});
