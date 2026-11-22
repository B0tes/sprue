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
