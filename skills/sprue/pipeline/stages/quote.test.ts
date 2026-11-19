// Tests of the quote's shipping: one charge per shop, and none for a shop whose parts ride in the parcel of a fab
// that makes a line in the same order (catalog.json shipsWith, such as JLCMC's screws with a JLCPCB board). Run them with
//   node --test skills/sprue/pipeline/stages/quote.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { FabRates } from "../adapters/fab.ts";
import type { Bom, BomLine, Offer, Sourcing } from "../types.ts";
import { choose, quote, rideAlong, type Option } from "./quote.ts";

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

test("a fab that would carry no bought line doesn't take the print", () => {
  const print = { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1,
    spec: { volumeCm3: 50, material: "PA12" } } as unknown as BomLine;
  const bom: Bom = { slug: "t", units: 1, lines: [screw, print] };
  const noJlcmc: Sourcing = { slug: "t", lines: [{ lineId: "scr", offers: [offer("Bolts and Nuts", 0.11)] }], unsourced: [] };
  const base = quote(bom, noJlcmc, rates, shipping);
  const q = quote(bom, noJlcmc, rates, shipping, undefined, { shipsWith: { JLCMC: "JLC3DP" } });
  assert.deepEqual(q, base);
  assert.doesNotMatch(q.lines.find((l) => l.lineId === "case")!.basis, /chosen over/);
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
  // Tried first, B alone has no total, and C's $5 is kept over it.
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
  // Nor, past twenty, for the order in which shops are dropped: Q for both, as without it.
  const g = Array.from({ length: 18 }, (_, k) => [opt(`G${k}`, 1)]), gs = g.map(([x]) => x.o.supplier);
  const order = (q: Option[]) => at(choose([[...q, opt("R", 1)], [opt("P", 1), opt("Q", 1)], [opt("Q", 1), opt("P", 1)], ...g], { P: 1.2, Q: 1 }));
  assert.deepEqual([order([opt("Q", NaN)]), order([])], [["R", "Q", "Q", ...gs], ["R", "Q", "Q", ...gs]]);
});
