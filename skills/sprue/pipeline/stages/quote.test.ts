// Tests of the quote's shipping: one charge per shop, and none for a shop whose parts ride in the parcel of a fab
// that makes a line in the same order (catalog.json shipsWith, such as JLCMC's screws with a JLCPCB board). Run them with
//   node --test skills/sprue/pipeline/stages/quote.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { FabRates } from "../adapters/fab.ts";
import type { Bom, BomLine, Offer, Sourcing } from "../types.ts";
import { choose, chooseRiding, quote, rideAlong, type Option } from "./quote.ts";

const rates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rates.json"), "utf8")) as FabRates;

const screw: BomLine = { id: "scr", name: "M3 x 8 button head screw", role: "fastener-screw", process: "buy", qtyPerUnit: 4 } as BomLine;
const board: BomLine = { id: "pcb", name: "Keypad PCB", role: "pcb", process: "pcb", qtyPerUnit: 1,
  spec: { layers: 2, widthMm: 61, heightMm: 94, thicknessMm: 1.6, finish: "HASL" } } as unknown as BomLine;
const offer = (supplier: string, unitUsd: number): Offer => ({ supplier, sku: `${supplier} M3 x 8`, url: `https://example.com/${supplier}`,
  priceBreaks: [{ qty: 1, unitUsd }], stock: "unknown", leadDays: 5, source: "snapshot", capturedAt: "2026-10-15" });
const sourcing: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [offer("Bolts and Nuts", 0.11), offer("JLCMC", 0.11)] }], unsourced: [] };
const shipping = { "Bolts and Nuts": 8.95, JLCMC: 8 };
const shipsWith = { JLCMC: "JLCPCB" };

test("a shop rides free only when its fab makes a line in the order", () => {
  assert.deepEqual(rideAlong(shipping, shipsWith, new Set(["JLCPCB"])), { "Bolts and Nuts": 8.95, JLCMC: 0 });
  assert.deepEqual(rideAlong(shipping, shipsWith, new Set(["PCBWay"])), shipping);
  assert.deepEqual(rideAlong(shipping, undefined, new Set(["JLCPCB"])), shipping);
});

test("with a JLCPCB board in the order, the screws come from JLCMC with no shipping of their own", () => {
  const bom: Bom = { slug: "t", units: 1, lines: [screw, board] };
  const q = quote(bom, sourcing, rates, shipping, undefined, { shipsWith });
  const scr = q.lines.find((l) => l.lineId === "scr")!;
  assert.equal(q.lines.find((l) => l.lineId === "pcb")?.supplier, "JLCPCB");
  assert.equal(scr.supplier, "JLCMC");
  assert.equal(scr.shipsWith, "JLCPCB");
  assert.match(scr.basis, /rides in the JLCPCB order's parcel, counted as no shipping of its own/);
  assert.equal(q.lines.some((l) => l.lineId.startsWith("ship:")), false);
  assert.equal(q.batchUsd, Math.round((scr.orderUsd + q.lines.find((l) => l.lineId === "pcb")!.orderUsd) * 100) / 100);
  // The order of the lines is unchanged: bought lines first, then made ones.
  assert.deepEqual(q.lines.map((l) => l.lineId), ["scr", "pcb"]);
});

test("without the board, JLCMC charges its own shipping and the cheaper shop wins", () => {
  const bom: Bom = { slug: "t", units: 1, lines: [screw] };
  const q = quote(bom, sourcing, rates, shipping, undefined, { shipsWith });
  const scr = q.lines.find((l) => l.lineId === "scr")!;
  assert.equal(scr.supplier, "JLCMC");
  assert.equal(scr.shipsWith, undefined);
  assert.doesNotMatch(scr.basis, /parcel/);
  assert.equal(q.lines.find((l) => l.lineId === "ship:JLCMC")?.orderUsd, 8);
  assert.equal(q.batchUsd, 8.44);
});

test("no shipsWith, no change: each shop charges its shipping", () => {
  const bom: Bom = { slug: "t", units: 1, lines: [screw, board] };
  const q = quote(bom, sourcing, rates, shipping);
  assert.equal(q.lines.find((l) => l.lineId === "scr")?.supplier, "JLCMC");
  assert.equal(q.lines.find((l) => l.lineId === "ship:JLCMC")?.orderUsd, 8);
});

test("a small board moves to JLCPCB when the screws riding with it save more than the fab costs extra", () => {
  const small = { ...board, spec: { layers: 2, widthMm: 40, heightMm: 50, thicknessMm: 1.6, finish: "HASL" } } as unknown as BomLine;
  const bom: Bom = { slug: "t", units: 1, lines: [screw, small] };
  const alone = quote(bom, sourcing, rates, shipping);
  const pcbAlone = alone.lines.find((l) => l.lineId === "pcb")!;
  // Without shipsWith the board goes to the cheapest fab for it alone.
  assert.notEqual(pcbAlone.supplier, "JLCPCB");
  const q = quote(bom, sourcing, rates, shipping, undefined, { shipsWith });
  const pcb = q.lines.find((l) => l.lineId === "pcb")!;
  assert.equal(pcb.supplier, "JLCPCB");
  assert.match(pcb.basis, new RegExp(`chosen over ${pcbAlone.supplier} .* because JLCMC ships in its parcel`));
  assert.equal(q.lines.find((l) => l.lineId === "scr")?.shipsWith, "JLCPCB");
  assert.equal(q.lines.some((l) => l.lineId.startsWith("ship:")), false);
  assert.ok(q.batchUsd < alone.batchUsd, `${q.batchUsd} < ${alone.batchUsd}`);
});

test("the board stays at its cheapest fab when riding along saves less than moving it costs", () => {
  const small = { ...board, spec: { layers: 2, widthMm: 40, heightMm: 50, thicknessMm: 1.6, finish: "HASL" } } as unknown as BomLine;
  const bom: Bom = { slug: "t", units: 1, lines: [screw, small] };
  const cheapShip = { "Bolts and Nuts": 0.5, JLCMC: 0.5 };
  const base = quote(bom, sourcing, rates, cheapShip);
  const q = quote(bom, sourcing, rates, cheapShip, undefined, { shipsWith });
  assert.equal(q.lines.find((l) => l.lineId === "pcb")?.supplier, base.lines.find((l) => l.lineId === "pcb")?.supplier);
  assert.equal(q.batchUsd, base.batchUsd);
});

test("an estimated offer's basis says it wasn't read from the page", () => {
  const est: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [{ ...offer("JLCMC", 0.11), source: "estimate" }] }], unsourced: [] };
  const q = quote({ slug: "t", units: 1, lines: [screw] }, est, rates, shipping);
  assert.match(q.lines.find((l) => l.lineId === "scr")!.basis, /^estimate, not a price read from https:\/\/example.com\/JLCMC/);
});

test("a host fab with nothing to carry doesn't move the board", () => {
  const small = { ...board, spec: { layers: 2, widthMm: 40, heightMm: 50, thicknessMm: 1.6, finish: "HASL" } } as unknown as BomLine;
  const bom: Bom = { slug: "t", units: 1, lines: [screw, small] };
  const noJlcmc: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [offer("Bolts and Nuts", 0.11)] }], unsourced: [] };
  const base = quote(bom, noJlcmc, rates, shipping);
  const q = quote(bom, noJlcmc, rates, shipping, undefined, { shipsWith });
  assert.deepEqual(q, base);
  assert.doesNotMatch(q.lines.find((l) => l.lineId === "pcb")!.basis, /chosen over/);
});

test("a print stays at the service cheapest for it where another costs more with its shipping and carries no bought line", () => {
  const print = { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1,
    spec: { volumeCm3: 50, material: "PA12" } } as unknown as BomLine;
  const bom: Bom = { slug: "t", units: 1, lines: [screw, print] };
  const noJlcmc: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [offer("Bolts and Nuts", 0.11)] }], unsourced: [] };
  // The case costs least at Craftcloud, $15 and its rates' $10.25 shipping, against $19.45 and $8 at JLC3DP.
  const ship = { ...shipping, JLC3DP: 8 };
  const base = quote(bom, noJlcmc, rates, ship);
  const q = quote(bom, noJlcmc, rates, ship, undefined, { shipsWith: { JLCMC: "JLC3DP" } });
  assert.deepEqual(q, base);
  assert.equal(q.lines.find((l) => l.lineId === "case")!.supplier, "Craftcloud");
  assert.doesNotMatch(q.lines.find((l) => l.lineId === "case")!.basis, /chosen over/);
});

test("a plastic print goes to the service where the order costs least with each shop's shipping counted", () => {
  const kase = { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 50, material: "PA12" } } as unknown as BomLine;
  const lens = { id: "lens", name: "Lens", role: "diffuser", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 10, material: "PETG" } } as unknown as BomLine;
  const bolts: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [offer("Bolts and Nuts", 0.11)] }], unsourced: [] };
  const at = (q: ReturnType<typeof quote>, id: string) => q.lines.find((l) => l.lineId === id)!;
  // Craftcloud prints the PA12 case for $15 and JLC3DP for $19.45, but Craftcloud's shipping is $10.25 (rates.json, as
  // catalog.json has no figure) and JLC3DP's $0, its rates.json placeholder: the case goes to JLC3DP, $28.84, where at
  // Craftcloud it would be $34.64. (Before 2026-11-22 a print went to the service cheapest for it before shipping.)
  const alone = quote({ slug: "t", units: 1, lines: [screw, kase] }, bolts, rates, shipping);
  assert.deepEqual([alone.batchUsd, at(alone, "case").supplier], [28.84, "JLC3DP"]);
  assert.match(at(alone, "case").basis, /; chosen over Craftcloud \(\$15\.00\) because the order costs less with each shop's shipping counted$/);
  // With JLC3DP's shipping read at $8, Craftcloud's case costs less: $34.64.
  const read = quote({ slug: "t", units: 1, lines: [screw, kase] }, bolts, rates, { ...shipping, JLC3DP: 8 });
  assert.deepEqual([read.batchUsd, at(read, "case").supplier], [34.64, "Craftcloud"]);
  // A PETG lens only Craftcloud prints pays its shipping whatever the case does, so the case is cheapest there too, $15
  // and no more shipping: $40.64, against $45.09 with the case at JLC3DP.
  const both = quote({ slug: "t", units: 1, lines: [screw, kase, lens] }, bolts, rates, shipping);
  assert.deepEqual([both.batchUsd, at(both, "case").supplier, at(both, "lens").supplier], [40.64, "Craftcloud", "Craftcloud"]);
  assert.doesNotMatch(at(both, "case").basis, /chosen over/);
});

test("prints go where the order costs least beside a board moved to a fab, a service a shop rides with taking one where that costs least", () => {
  const one = () => 1;
  const print = (id: string, material: string, volumeCm3: number) => ({ id, name: id, role: id, process: "print", qtyPerUnit: 1,
    spec: { volumeCm3, material } }) as unknown as BomLine;
  const buy = (id: string) => ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1 }) as BomLine;
  const sold = (lines: Record<string, [string, number][]>): Sourcing => ({ slug: "t", unsourced: [],
    lines: Object.entries(lines).map(([lineId, offers]) => ({ lineId, offers: offers.map(([s, usd]) => offer(s, usd)) })) });
  const small = { ...board, spec: { ...board.spec, widthMm: 50, heightMm: 40 } } as BomLine;
  const at = (q: ReturnType<typeof quote>, id: string) => q.lines.find((l) => l.lineId === id)!;
  // The board goes to JLCPCB ($17 against OSH Park's $15.50) for JLCMC's nut to ride there, and on that try the lid
  // goes to JLC3DP ($9.73 and $3 shipping against Craftcloud's $7.50 and $10): $30.73. Laying the print services'
  // sets on the first try alone, the lid stayed at Craftcloud: $35.50.
  const lid = quote({ slug: "t", units: 1, lines: [print("lid", "PA12", 25), small, buy("nut")] }, sold({ nut: [["JLCMC", 1], ["Z", 0.5]] }), rates,
    { Craftcloud: 10, JLC3DP: 3, JLCMC: 8, Z: 9 }, one, { shipsWith: { JLCMC: "JLCPCB" } });
  assert.deepEqual([lid.batchUsd, at(lid, "lid").supplier, at(lid, "pcb").supplier, at(lid, "nut").shipsWith, lid.needsRider], [30.73, "JLC3DP", "JLCPCB", "JLCPCB", "JLCPCB"]);
  // A made line with no price yet listed first (a CNC bracket whose shop's quote isn't recorded) changes none of it.
  const bracket = { id: "bracket", name: "Bracket", role: "bracket", process: "cnc", qtyPerUnit: 1, spec: { material: "aluminium 6061-T6" }, file: "fab/bracket.step" } as unknown as BomLine;
  const pending = quote({ slug: "t", units: 1, lines: [bracket, print("lid", "PA12", 25), small, buy("nut")] }, sold({ nut: [["JLCMC", 1], ["Z", 0.5]] }), rates,
    { Craftcloud: 10, JLC3DP: 3, JLCMC: 8, Z: 9 }, one, { shipsWith: { JLCMC: "JLCPCB" } });
  assert.deepEqual([pending.batchUsd, at(pending, "lid").supplier, at(pending, "pcb").supplier, pending.needsRider, pending.unquoted], [30.73, "JLC3DP", "JLCPCB", "JLCPCB", ["bracket"]]);
  // JLC3DP rides with JLCPCB too and sells the washer: the lid and the washer, at JLC3DP, ride in JLCPCB's parcel, but
  // JLC3DP's own shipping, as the lid alone has it, is its rates.json $0, so the lid riding saves none, and the order
  // holds only with a bought line riding there (needsRider), as the washer and JLCMC's nut do: $36.63.
  const sells = quote({ slug: "t", units: 1, lines: [print("lid", "PA12", 25), small, buy("cap"), buy("washer"), buy("nut"), buy("bolt")] },
    sold({ cap: [["Adafruit", 2]], washer: [["Adafruit", 1], ["JLC3DP", 0.9], ["W", 0.85]], nut: [["JLCMC", 1], ["Z", 0.5], ["W", 0.45]], bolt: [["Adafruit", 1], ["W", 0.8]] }),
    rates, { Craftcloud: 10, Adafruit: 5, JLCMC: 8, Z: 9, W: 4 }, one, { shipsWith: { JLCMC: "JLCPCB", JLC3DP: "JLCPCB" } });
  assert.deepEqual([sells.batchUsd, ...["lid", "washer", "nut", "pcb"].map((id) => `${at(sells, id).supplier}${at(sells, id).shipsWith ? ` rides ${at(sells, id).shipsWith}` : ""}`), sells.needsRider],
    [36.63, "JLC3DP rides JLCPCB", "JLC3DP rides JLCPCB", "JLCMC rides JLCPCB", "JLCPCB", "JLCPCB"]);
  // With R3 riding with JLC3DP and JLCMC with JLCPCB, the cheapest order has the board at JLCPCB and one PA12 print at
  // JLC3DP, the one costing least extra there (P0, $7.39 against $6), the other at Craftcloud, where a PETG print pays
  // its shipping anyway: $52.44. Each set of the services alone gave $54.75, both PA12 prints at JLC3DP.
  const two = quote({ slug: "t", units: 1, lines: [print("P0", "PA12", 19), print("P2", "PA12", 26), print("P1", "PETG", 10), small, buy("b1"), buy("b2")] },
    sold({ b1: [["JLCMC", 1], ["Z1", 1]], b2: [["R3", 1], ["Z2", 1]] }), rates, { Craftcloud: 10.25, JLC3DP: 2, JLCMC: 8, Z1: 8, R3: 8, Z2: 8 }, one,
    { shipsWith: { JLCMC: "JLCPCB", R3: "JLC3DP" } });
  assert.deepEqual([two.batchUsd, ...["P0", "P2", "P1", "pcb", "b1", "b2"].map((id) => `${at(two, id).supplier}${at(two, id).shipsWith ? ` rides ${at(two, id).shipsWith}` : ""}`)],
    [52.44, "JLC3DP", "Craftcloud", "Craftcloud", "JLCPCB", "JLCMC rides JLCPCB", "R3 rides JLC3DP"]);
  // A print says why it moved as any line but a board does: the order costs less with shipping counted, and who rides.
  assert.match(at(two, "P0").basis, /; chosen over Craftcloud \(\$6\.00\) because the order costs less with each shop's shipping counted \(R3 ships in its parcel\)$/);
  assert.match(at(two, "pcb").basis, /; chosen over OSH Park \(\$15\.50\) because JLCMC ships in its parcel$/);
  // The print given to such a service is the one costing least extra against where the set puts it, not against the
  // service cheapest for it: with a third service, X, cheapest for the PETG lens, the set of Craftcloud and JLC3DP
  // gives JLC3DP the lens ($6 against Craftcloud's $4), not the case ($7.50 against $5): $16.
  const svc = (name: string, usdPerCm3: number, materials?: string[], minPerPartUsd = 0, shippingUsd = 10) => ({ name, url: `https://example.com/${name}`,
    capturedAt: "2026-11-01", verified: false, leadDays: 5, usdPerCm3, minPerPartUsd, shippingUsd, ...(materials ? { materials } : {}) });
  const three = quote({ slug: "t", units: 1, lines: [print("case", "PA12", 10), print("lens", "PETG", 8), buy("b")] }, sold({ b: [["R", 1]] }),
    { ...rates, print: { c: svc("Craftcloud", 0.5), j: svc("JLC3DP", 0.75), x: svc("X", 0.1, ["PETG"]) } } as FabRates,
    { Craftcloud: 1, JLC3DP: 3, X: 20, R: 20 }, one, { shipsWith: { R: "JLC3DP" } });
  assert.deepEqual([three.batchUsd, at(three, "case").supplier, at(three, "lens").supplier, at(three, "b").shipsWith], [16, "Craftcloud", "JLC3DP", "JLC3DP"]);
  // Three such services each take a print of their own, a different one each: R rides with JLC3DP, S with X and T with
  // Y, each print $10 at each of them against $5 at Craftcloud (the clip $1). Three prints there, one at each, and the
  // clip at Craftcloud: $38. (Where a print given to one of them could be moved on to another, standing for both, the
  // quote came to $46.)
  const three3 = quote({ slug: "t", units: 1, lines: [print("case", "PA12", 10), print("lid", "PA12", 10), print("cover", "PA12", 10), print("clip", "PA12", 2),
    buy("b"), buy("d"), buy("e")] }, sold({ b: [["R", 1]], d: [["S", 1]], e: [["T", 1]] }),
  { ...rates, print: { c: svc("Craftcloud", 0.5), j: svc("JLC3DP", 0.75, undefined, 10), x: svc("X", 0.8, undefined, 10), y: svc("Y", 0.8, undefined, 10) } } as FabRates,
  { Craftcloud: 1, JLC3DP: 1, X: 1, Y: 1, R: 20, S: 20, T: 20 }, one, { shipsWith: { R: "JLC3DP", S: "X", T: "Y" } });
  assert.deepEqual([three3.batchUsd, at(three3, "clip").supplier, ...["b", "d", "e"].map((id) => at(three3, id).shipsWith),
    new Set(["case", "lid", "cover"].map((id) => at(three3, id).supplier)).size], [38, "Craftcloud", "JLC3DP", "X", "Y", 3]);
  // Of prints costing as much extra there, the one leaving most lines at the service cheapest for each: the case and
  // the PETG lens each cost $1 more at JLC3DP than at Craftcloud, but the lens, cheapest at X, has left its service
  // either way, so it goes, and the case stays at Craftcloud: $14.
  const fewest = quote({ slug: "t", units: 1, lines: [print("case", "PA12", 10), print("lens", "PETG", 10), buy("b")] }, sold({ b: [["R", 1]] }),
    { ...rates, print: { c: svc("Craftcloud", 0.5), j: svc("JLC3DP", 0.6), x: svc("X", 0.4, ["PETG"]) } } as FabRates,
    { Craftcloud: 1, JLC3DP: 1, X: 20, R: 20 }, one, { shipsWith: { R: "JLC3DP" } });
  assert.deepEqual([fewest.batchUsd, at(fewest, "case").supplier, at(fewest, "lens").supplier, at(fewest, "b").shipsWith], [14, "Craftcloud", "JLC3DP", "JLC3DP"]);
  // But one moving fewer lines wins only at the same cost: on the board's try, J taking the clip, $4 extra, beats it
  // taking the case, $4.80 extra, which moves one line fewer: $26.20 (the case there, the board went back to OSH Park,
  // $26.70).
  const leaf = quote({ slug: "t", units: 1, lines: [print("clip", "PETG", 5), print("case", "PETG", 20), small, buy("b0"), buy("b1")] },
    sold({ b0: [["R1", 0.5]], b1: [["R2", 0.5]] }),
    { ...rates, print: { c: svc("CC", 0.1, undefined, 3, 1), j: svc("J", 0.4, undefined, 5, 0), x: svc("X", 0.16, undefined, 1, 0) } } as FabRates,
    { R1: 2, R2: 20 }, one, { shipsWith: { R1: "JLCPCB", R2: "J" } });
  assert.deepEqual([leaf.batchUsd, ...["pcb", "clip", "case"].map((id) => at(leaf, id).supplier)], [26.2, "JLCPCB", "J", "X"]);
  // The print a service takes is the one costing least extra there over where the set puts it, the big case, $9.10
  // at J against $7 at X, not the one cheapest there, the clip, $5 against $2: $11.60 (and $12.50).
  const extra = quote({ slug: "t", units: 1, lines: [print("case", "PETG", 35), print("clip", "PETG", 10), buy("b")] }, sold({ b: [["R", 0.5]] }),
    { ...rates, print: { c: svc("CC", 0.1, undefined, 0, 5), j: svc("J", 0.26, undefined, 5, 0), x: svc("X", 0.2, undefined, 1, 0) } } as FabRates,
    { R: 5 }, one, { shipsWith: { R: "J" } });
  assert.deepEqual([extra.batchUsd, at(extra, "case").supplier, at(extra, "clip").supplier], [11.6, "J", "X"]);
  // R1 rides with J and R2 with CC, and X prints PETG alone: the cheapest order has the PETG clip at CC, the PA12 case
  // at J and the PETG lid at X, $8. The set of all three puts the case at J, the cheapest there for it, and giving CC
  // a print leaves J that one (the case to CC instead: $8.50).
  const held = quote({ slug: "t", units: 1, lines: [print("clip", "PETG", 5), print("case", "PA12", 10), print("lid", "PETG", 20), buy("b0"), buy("b1")] },
    sold({ b0: [["R1", 0.5]], b1: [["R2", 0.5]] }),
    { ...rates, print: { c: svc("CC", 0.4, undefined, 0, 0), j: svc("J", 0.3, undefined, 1, 0), x: svc("X", 0.1, ["PETG"], 0, 0) } } as FabRates,
    { R1: 10, R2: 5 }, one, { shipsWith: { R1: "J", R2: "CC" } });
  assert.deepEqual([held.batchUsd, ...["clip", "case", "lid"].map((id) => at(held, id).supplier)], [8, "CC", "J", "X"]);
  // A set gives a print only to the services in it that a shop rides with: four services at $0.10/cm³, R1 riding with
  // Y, R2 with X and R3 with J, and Y's $10 shipping costs more than R1's $2, so the cheapest order leaves Y out, a
  // print each at J, X and CC: $17.50 (each set giving Y a print as well, $18.50).
  const outside = quote({ slug: "t", units: 1, lines: [print("case", "PA12", 5), print("lid", "PETG", 5), print("cap", "PETG", 5), buy("b0"), buy("b1"), buy("b2")] },
    sold({ b0: [["R1", 0.5]], b1: [["R2", 0.5]], b2: [["R3", 0.5]] }),
    { ...rates, print: { c: svc("CC", 0.1, undefined, 4, 0), j: svc("J", 0.1, undefined, 5, 0), x: svc("X", 0.1, undefined, 5, 0), y: svc("Y", 0.1, undefined, 1, 10) } } as FabRates,
    { R1: 2, R2: 2, R3: 10 }, one, { shipsWith: { R1: "Y", R2: "X", R3: "J" } });
  assert.deepEqual([outside.batchUsd, new Set(["case", "lid", "cap"].map((id) => at(outside, id).supplier))], [17.5, new Set(["J", "X", "CC"])]);
  // A set that can't make every print is passed over, not the end of the search: X, which prints only PA12, comes
  // first of the services, and Y, after it, makes both prints: $3.50 (and $8.50, the case at X).
  const missing = quote({ slug: "t", units: 1, lines: [print("case", "PA12", 5), print("lid", "PETG", 25)] }, sold({}),
    { ...rates, print: { j: svc("J", 0.1, undefined, 5, 0), x: svc("X", 0.1, ["PA12"], 1, 5), y: svc("Y", 0.1, undefined, 1, 0) } } as FabRates, {}, one);
  assert.deepEqual([missing.batchUsd, at(missing, "case").supplier, at(missing, "lid").supplier], [3.5, "Y", "Y"]);
});

test("the bought lines' shops are chosen with each shop's shipping weighed as the total counts it", () => {
  const lid = (material: string) => ({ id: "lid", name: "Lid", role: "enclosure", process: "print", qtyPerUnit: 1,
    spec: { volumeCm3: 5, material } }) as unknown as BomLine;
  const buy = (offers: Offer[], ship: Record<string, number>, lines: BomLine[]) =>
    quote({ slug: "t", units: 1, lines: [screw, ...lines] }, { slug: "t", lines: [{ lineId: "scr", offers }], unsourced: [] }, rates, ship);
  const at = (q: ReturnType<typeof quote>, id: string) => q.lines.find((l) => l.lineId === id)!;
  // Craftcloud prints the lid and its $10 shipping is paid whatever the screws do: they come from it at $2, not from
  // Bolts and Nuts at $0.44 and $8.95 shipping (weighing Craftcloud's $10 again, the quote bought those).
  const paid = buy([offer("Craftcloud", 0.5), offer("Bolts and Nuts", 0.11)], { "Bolts and Nuts": 8.95, Craftcloud: 10 }, [lid("PETG")]);
  assert.deepEqual([at(paid, "lid").supplier, at(paid, "scr").supplier, paid.lines.filter((l) => l.lineId.startsWith("ship:")).map((l) => l.lineId)],
    ["Craftcloud", "Craftcloud", ["ship:Craftcloud"]]);
  assert.equal(paid.batchUsd, Math.round((at(paid, "lid").orderUsd + 2 + 10) * 100) / 100);
  // JLC3DP prints a PA12 lid, so Craftcloud sends only the screws: with no figure in catalog.json, the total counts its
  // print rates' shipping, and so does the search. $0.40 and that beat $0.44 and $8.95 no longer (weighing it at $0,
  // the quote bought them there).
  const unpaid = buy([offer("Craftcloud", 0.1), offer("Bolts and Nuts", 0.11)], { "Bolts and Nuts": 8.95 }, [lid("PA12")]);
  assert.deepEqual([at(unpaid, "lid").supplier, at(unpaid, "scr").supplier, unpaid.noShipping], ["JLC3DP", "Bolts and Nuts", undefined]);
  assert.equal(Object.values(rates.print).find((p) => p.name === "Craftcloud")?.shippingUsd, 10.25);
  // A board's shipping is in its price, so JLCPCB making one pays none the screws could share: theirs at $0.80 and its
  // $9 lose to $0.44 and $8.95.
  const fab = buy([offer("JLCPCB", 0.2), offer("Bolts and Nuts", 0.11)], { "Bolts and Nuts": 8.95, JLCPCB: 9 }, [board]);
  assert.deepEqual([at(fab, "pcb").supplier, at(fab, "scr").supplier], ["JLCPCB", "Bolts and Nuts"]);
  // But a shop riding in the board fab's parcel (shipsWith) sends nothing of its own where the board goes there: a
  // small board at JLCPCB, $17, with R's screws riding, $29, beats it at OSH Park, $3.10, with Z's and Z's $30.
  const small = { ...board, spec: { ...board.spec, widthMm: 20, heightMm: 20 } } as BomLine;
  const rides = (offers: Offer[]) => quote({ slug: "t", units: 1, lines: [screw, small] }, { slug: "t", lines: [{ lineId: "scr", offers }], unsourced: [] },
    rates, { R: 40, Z: 30 }, undefined, { shipsWith: { R: "JLCPCB" } });
  const r = rides([offer("R", 3), offer("Z", 1)]);
  assert.deepEqual([r.batchUsd, at(r, "pcb").supplier, at(r, "scr").supplier, at(r, "scr").shipsWith, r.needsRider], [29, "JLCPCB", "R", "JLCPCB", "JLCPCB"]);
  const z = rides([offer("Z", 1)]);
  assert.deepEqual([z.batchUsd, at(z, "pcb").supplier, z.needsRider], [37.1, "OSH Park", undefined]);
});

const opt = (supplier: string, orderUsd: number): Option => ({ o: { supplier, sku: supplier, mpn: "M", url: "https://example.com", priceBreaks: [],
  stock: 9, leadDays: 1, source: "snapshot", capturedAt: "2026-11-19" } as unknown as Offer, orderQty: 1, orderUsd });
const at = (picks: Option[]) => picks.map((x) => x.o.supplier);

test("choose() counts a shop's shipping once, however many lines go there, and adds up as the quote does", () => {
  // All three at Y, $4 and Y's $3 shipping, beat the two screws at X and the nut at Y, $3 and both shops' $5. Counting
  // each shop's shipping for each line it sends would pick X ($10 against Y's three lines at $13).
  assert.deepEqual(at(choose([[opt("X", 1), opt("Y", 1.5)], [opt("X", 1), opt("Y", 1.5)], [opt("Y", 1)]], { X: 2, Y: 3 })), ["Y", "Y", "Y"]);
  // Totals a hair over 1e-9 apart: the parts, then each shop's shipping the first time a line goes there, added up as
  // before 2026-11-19, so S0, S1 and S2 at $74.27 beat S3 alone at $74.270000001.
  assert.deepEqual(at(choose([[opt("S0", 18.62), opt("S3", 26.020000001000014)], [opt("S1", 7.28), opt("S3", 7.18)], [opt("S2", 14.09), opt("S3", 22.54)]],
    { S0: 16.83, S1: 7.33, S2: 10.12, S3: 18.53 })), ["S0", "S1", "S2"]);
});

test("an offer priced at no number is left out where its line has a priced one, and is picked only where nothing else prices its line", () => {
  // B's nut has no price (a field catalog.json's checks missed): the screw at A and C's free nut, $3, as without it.
  assert.deepEqual(at(choose([[opt("A", 2)], [opt("A", 1), opt("B", NaN), opt("C", 0)]], { A: 1, B: 0, C: 0 })), ["A", "C"]);
  // C prices the line, so B's offer is left out: C's $5.
  assert.deepEqual(at(choose([[opt("B", NaN), opt("C", 5)]], { B: 0, C: 0 })), ["C"]);
  // Where only B sells the line, B is picked, so the quote can say which line has no price, and it counts no price, so
  // the other lines still go where they cost least: A's $1 over C's $5.
  assert.deepEqual(at(choose([[opt("B", NaN)], [opt("A", 1)]], { A: 1, B: 0 })), ["B", "A"]);
  assert.deepEqual(at(choose([[opt("B", NaN)], [opt("C", 5), opt("A", 1)]], { A: 0, B: 0, C: 0 })), ["B", "A"]);
  // And past twenty shops, where choose() drops one shop at a time from all of them: C's $5 still.
  const many = Array.from({ length: 20 }, (_, k) => [opt(`F${k}`, 10 + k)]);
  assert.deepEqual(at(choose([[opt("B", NaN), opt("C", 5)], ...many], { B: 0, C: 0 })), ["C", ...many.map(([x]) => x.o.supplier)]);
  // Where B alone sells one line, its offer with no price for another line is not picked there either: C's $5.
  assert.deepEqual(at(choose([[opt("B", NaN)], [opt("B", NaN), opt("C", 5)]], { B: 0, C: 0 })), ["B", "C"]);
  assert.deepEqual(at(choose([[opt("B", NaN)], [opt("B", NaN), opt("C", 5)], ...many], { B: 0, C: 0 })), ["B", "C", ...many.map(([x]) => x.o.supplier)]);
  // Its shop counts for nothing either. Not for which of two sets that cost the same comes first: A and C, as without it.
  const tie = (b: Option[]) => at(choose([[...b, opt("A", 5)], [opt("C", 5), opt("B", 5)]], { A: 0, B: 0, C: 0 }));
  assert.deepEqual([tie([opt("B", NaN)]), tie([])], [["A", "C"], ["A", "C"]]);
  // Not toward the twenty shops past which choose() drops one at a time: Z for both, $23, as without it (dropping X or
  // Y alone from all twenty-one costs more, so that search keeps X and Y, $25).
  const f = Array.from({ length: 17 }, (_, k) => [opt(`F${k}`, 1)]), fs = f.map(([x]) => x.o.supplier);
  const twenty = (b: Option[]) => at(choose([[opt("X", 0), opt("Z", 0.5), ...b], [opt("Y", 0), opt("Z", 0.5)], ...f], { X: 4, Y: 4, Z: 5, B: 0 }));
  assert.deepEqual([twenty([opt("B", NaN)]), twenty([])], [["Z", "Z", ...fs], ["Z", "Z", ...fs]]);
  // chooseRiding(), which the quote's search for the bought lines' shops is, counts them the same way: Z for both.
  const riding = (b: Option[]) => at(chooseRiding([[opt("X", 0), opt("Z", 0.5), ...b], [opt("Y", 0), opt("Z", 0.5)], ...f], { X: 4, Y: 4, Z: 5, B: 0 }, []));
  assert.deepEqual([riding([opt("B", NaN)]), riding([])], [["Z", "Z", ...fs], ["Z", "Z", ...fs]]);
  // At twenty shops, both search every set: X for both lines, $12, where dropping one shop at a time from all twenty
  // keeps P and Q, $13.
  const d = Array.from({ length: 17 }, (_, k) => opt(`D${k}`, 100));
  const lists20 = [[opt("X", 1), opt("P", 0.5), ...d], [opt("X", 1), opt("Q", 0.5)]];
  const ship20 = { X: 10, P: 6, Q: 6, ...Object.fromEntries(d.map((x) => [x.o.supplier, 1])) };
  assert.deepEqual([at(choose(lists20, ship20)), at(chooseRiding(lists20, ship20, []))], [["X", "X"], ["X", "X"]]);
  // Nor, past twenty, for the order in which shops are dropped: Q for both, as without it.
  const g = Array.from({ length: 18 }, (_, k) => [opt(`G${k}`, 1)]), gs = g.map(([x]) => x.o.supplier);
  const order = (q: Option[]) => at(choose([[...q, opt("R", 1)], [opt("P", 1), opt("Q", 1)], [opt("Q", 1), opt("P", 1)], ...g], { P: 1.2, Q: 1 }));
  assert.deepEqual([order([opt("Q", NaN)]), order([])], [["R", "Q", "Q", ...gs], ["R", "Q", "Q", ...gs]]);
});

test("chooseRiding() buys a line from a shop riding in a fab's parcel where the cheapest mix buys none: the cheapest such mix, of equal ones the first", () => {
  const free = { A: 0, B: 0, R: 0, S: 0 };
  // The cheapest mix buys from R already, or no rider sells a line: choose()'s. Where it buys from S, A's washer and
  // S's nut, choose()'s still, though R's washer with S's nut costs as much and R's comes first by line.
  assert.deepEqual(at(chooseRiding([[opt("R", 1), opt("A", 2)]], free, ["R"])), ["R"]);
  assert.deepEqual(at(chooseRiding([[opt("A", 1)]], free, ["R"])), ["A"]);
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R", 1)], [opt("S", 1)]], free, ["R", "S"])), ["A", "S"]);
  // A and B, $2, buy from neither R nor S; R's washer with B's nut and A's washer with S's nut both cost $3: the first,
  // by line, whichever order the riders come in; and of R's and S's washers, $2 each, the first, by offer.
  const two = [[opt("A", 1), opt("R", 2)], [opt("B", 1), opt("S", 2)]];
  assert.deepEqual([at(chooseRiding(two, free, ["R", "S"])), at(chooseRiding(two, free, ["S", "R"]))], [["R", "B"], ["R", "B"]]);
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R", 2), opt("S", 2)]], free, ["S", "R"])), ["R"]);
  // R1's $0.10 washer with Y's $0.20 nut and A's $0 washer with R2's $0.30 nut cost the same, though 0.1 + 0.2 is
  // 0.30000000000000004 and not 0.3: the first, by line.
  assert.deepEqual(at(chooseRiding([[opt("A", 0), opt("R1", 0.1)], [opt("Y", 0.2), opt("R2", 0.3)]], { A: 0, Y: 0, R1: 0, R2: 0 }, ["R1", "R2"])), ["R1", "Y"]);
  // Of mixes that cost differently, the cheapest: A's washer with S's $1.50 nut, $2.50, not R's $3 washer with B's nut.
  // And with each shop's shipping: R's $1.50 washer with B's nut, $2.50, not S's $1.40 nut with A's washer and A's
  // $0.45 shipping, $2.85.
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R", 3)], [opt("B", 1), opt("S", 1.5)]], free, ["R", "S"])), ["A", "S"]);
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R", 1.5)], [opt("B", 1), opt("S", 1.4)]], { ...free, A: 0.45 }, ["R", "S"])), ["R", "B"]);
  // Of one line's offers from riders, the cheapest, though catalog.json lists a dearer one first: R2's $1.50 washer, not
  // R1's $2.
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R1", 2), opt("R2", 1.5)]], { A: 0, R1: 0, R2: 0 }, ["R1", "R2"])), ["R2"]);
  // A shop's shipping counts once however many lines it sends: A's washer and bolt with R2's nut, $3.60 + $2.20 + $0.70
  // and A's $2.10 once, $8.60, not all three at R2, $10.10 (with A's $2.10 for each line, $10.70).
  assert.deepEqual(at(chooseRiding([[opt("A", 3.6), opt("R2", 4.5)], [opt("A", 1.4), opt("B", 2.1), opt("C", 4.8), opt("R1", 3.9), opt("R2", 2.2)],
    [opt("A", 0.7), opt("R1", 4.2), opt("R2", 3.4)]], { A: 2.1, B: 2, C: 3.6, R1: 0, R2: 0 }, ["R1", "R2"])), ["A", "R2", "A"]);
  // A rider's offer priced at no number is not bought to keep a line riding where its line has a priced one: S's nut,
  // $3, not R's washer, which would count for $1.
  assert.deepEqual(at(chooseRiding([[opt("A", 1), opt("R", NaN)], [opt("B", 1), opt("S", 2)]], free, ["R", "S"])), ["A", "S"]);
  // Where nothing prices its line, it is, as any offer of that line is picked (and the quote then stops and names it):
  // R's washer, not B's, both priced at no number.
  assert.deepEqual(at(chooseRiding([[opt("B", NaN), opt("R", NaN)], [opt("A", 1)]], free, ["R"])), ["R", "A"]);
  // Where the cheapest mix already buys a line from a rider, it is the pick, though pinning another rider's offer costs
  // the same, whichever rider it buys from and on whichever line: A's washer, R1's nut and B's bolt, not R2's washer,
  // with the nut in the middle or last.
  assert.deepEqual([at(chooseRiding([[opt("A", 1), opt("R2", 1)], [opt("R1", 1)], [opt("B", 1)]], free, ["R1", "R2"])),
    at(chooseRiding([[opt("A", 1), opt("R2", 1)], [opt("B", 1)], [opt("R1", 1)]], free, ["R1", "R2"]))], [["A", "R1", "B"], ["A", "B", "R1"]]);
  // With the nut first, which Y sells too, for $5: the cheapest mix meets Y before Z and of their caps, at the same
  // price, buys Y's; pinned to R1's nut, the search leaves Y out of that line, meets Z first and would buy Z's.
  assert.deepEqual(at(chooseRiding([[opt("R1", 1), opt("Y", 5)], [opt("Z", 1), opt("Y", 1)]], free, ["R1"])), ["R1", "Y"]);
});
