// Tests of the quote's shipping: one charge per shop, and none for a shop whose parts ride in the parcel of a fab
// that makes a line in the same order (catalog.json shipsWith, such as JLCMC's screws with a JLCPCB board). Run them with
//   node --test skills/sprue/pipeline/stages/quote.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { FabRates } from "../adapters/fab.ts";
import type { Bom, BomLine, Offer, Sourcing } from "../types.ts";
import { quote, rideAlong } from "./quote.ts";

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
