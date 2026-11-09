// The euro figures landed in Italy (landed.ts): fx.json and what it refuses, the carts the quote makes, and each
// cart's low and high figures, worked out here by hand. The words are handoff.ts's, tested in handoff.test.ts.
//   node --test skills/sprue/pipeline/landed.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRates } from "./explore.ts";
import { cartsOf, DUTY_EUR, FEE_EUR, FX_OLD_DAYS, fxAge, ITALY, landed, LOW_VALUE_EUR, loadFx, VAT_IT, type Cart, type Fx } from "./landed.ts";
import type { QuoteLine, Quotes } from "./types.ts";

const FX: Fx = { usdPerEur: 1.25, date: "2026-11-06", source: "test", url: "https://example.org/rate", read: "2026-11-09" };
const near = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
const nearAll = (a: [number, number] | undefined, b: [number, number], what = "") => {
  assert.ok(a, `${what} has no figures`);
  near(a[0], b[0], `${what} low`);
  near(a[1], b[1], `${what} high`);
};
const q = (lineId: string, supplier: string, orderUsd: number, orderQty = 1): QuoteLine =>
  ({ lineId, supplier, sku: lineId, mode: "estimate", orderQty, orderUsd, leadDays: 1, basis: "test" });
const quotes = (lines: QuoteLine[], phases?: { name: string; lines: QuoteLine[] }[]): Quotes =>
  ({ slug: "rig", units: 1, lines, batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [],
    ...(phases ? { phases: phases.map((p) => ({ ...p, units: 1, batchUsd: 0, perUnitUsd: 0, longestLeadDays: 0, unquoted: [] })) } : {}) }) as unknown as Quotes;

test("fx.json: the ECB's rate, read on or after its day, and every field Sprue needs", () => {
  const fx = loadFx();
  assert.ok(fx.usdPerEur > 0.5 && fx.usdPerEur < 2, `${fx.usdPerEur} is not a dollar rate to the euro`);
  assert.ok(fx.read >= fx.date);
  assert.match(fx.url, /^https:\/\/www\.ecb\.europa\.eu\//);
  assert.equal(fxAge(fx, fx.read) >= 0, true);
});

test("fx.json Sprue can't use is refused, saying which field", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sprue-fx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const good = { ...FX };
  const cases: [string, unknown, RegExp][] = [
    ["not JSON", "{", /can't be read/],
    ["null", null, /it is not an object/],
    ["a rate in quotes", { ...good, usdPerEur: "1.1" }, /usdPerEur is not a number above 0/],
    ["a rate of 0", { ...good, usdPerEur: 0 }, /usdPerEur is not a number above 0/],
    ["a rate below 0", { ...good, usdPerEur: -1.1 }, /usdPerEur is not a number above 0/],
    ["no date", { ...good, date: undefined }, /date is not a day/],
    ["a month 13", { ...good, date: "2026-13-01" }, /date is not a day/],
    ["30 February", { ...good, date: "2026-02-30" }, /date is not a day/],
    ["a date with a time", { ...good, date: "2026-11-06T00:00" }, /date is not a day/],
    ["read not a day", { ...good, read: "9 Nov" }, /read is not a day/],
    ["read before its day", { ...good, read: "2026-11-05" }, /read is before date/],
    ["an http page", { ...good, url: "http://www.ecb.europa.eu/" }, /url is not an https page/],
    ["no source", { ...good, source: " " }, /source is empty/],
  ];
  for (const [name, body, why] of cases) {
    const f = join(dir, `${name}.json`);
    writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
    assert.throws(() => loadFx(f), (e: Error) => e.message.startsWith("pipeline/fx.json") && why.test(e.message), name);
  }
  assert.throws(() => loadFx(join(dir, "none.json")), /pipeline\/fx\.json can't be read/);
  writeFileSync(join(dir, "ok.json"), JSON.stringify(good));
  assert.deepEqual(loadFx(join(dir, "ok.json")), good);
});

test("fxAge counts whole days from the rate's day, across a month and a clock change", () => {
  assert.equal(fxAge(FX, "2026-11-06"), 0);
  assert.equal(fxAge(FX, "2026-11-09"), 3);
  assert.equal(fxAge(FX, "2026-12-07"), FX_OLD_DAYS);
  assert.equal(fxAge({ ...FX, date: "2026-03-28" }, "2026-03-30"), 2);
  assert.equal(fxAge({ ...FX, date: "2026-10-24" }, "2026-10-26"), 2);
});

test("a rule for each print service rates.json prices, and JLC3DP's US tax as rates.json counts it", () => {
  const print = loadRates().print;
  for (const s of Object.values(print)) assert.ok(ITALY[s.name], `${s.name} (rates.json) has no rule for Italy`);
  // landed.ts divides by the tax rates.json multiplies by: the two must stay the same number.
  const note = (print as Record<string, { _note?: string }>).jlc3dp._note ?? "";
  assert.match(note, /x 1\.40 for the 40% US advance tax/);
  assert.equal(ITALY.JLC3DP.usTax, 1.4);
  assert.equal(ITALY.JLC3DP.from, "outside");
  assert.equal(ITALY.JLC3DP.shipPriced, false);
  assert.equal(print.jlc3dp.shippingUsd, 0, "JLC3DP's shipping is no longer the $0 placeholder: set shipPriced");
  assert.equal(ITALY.Craftcloud.from, "either");
  assert.ok(ITALY.Craftcloud.allIn);
});

test("carts: one a shop, or one a shop and an order, with its shipping; only the parts handed off, and none bought", () => {
  assert.deepEqual(cartsOf(undefined, new Set(["a"])), []);
  const lines = [q("top", "Craftcloud", 6), q("bot", "Craftcloud", 6), q("ship:Craftcloud", "Craftcloud", 10.25), q("nut", "Craftcloud", 1),
    q("jig", "JLC3DP", 1.4), q("ship:JLC3DP", "JLC3DP", 0), q("feet", "home printer", 0.5), q("gone", "JLC3DP", 0, 0)];
  const carts = cartsOf(quotes(lines), new Set(["top", "bot", "jig", "gone"]));
  assert.deepEqual(carts, [
    { shop: "Craftcloud", order: undefined, ids: ["top", "bot"], partsUsd: 12, shipUsd: 10.25 },
    { shop: "JLC3DP", order: undefined, ids: ["jig"], partsUsd: 1.4, shipUsd: 0 },
  ]);
  // A quote split in two: each order is a parcel of its own, with its own shipping.
  const split = quotes(lines, [{ name: "A", lines: [q("top", "Craftcloud", 6), q("ship:Craftcloud", "Craftcloud", 10.25)] },
    { name: "B", lines: [q("top", "Craftcloud", 30, 5), q("bot", "Craftcloud", 12, 2), q("ship:Craftcloud", "Craftcloud", 11)] }]);
  assert.deepEqual(cartsOf(split, new Set(["top", "bot"])), [
    { shop: "Craftcloud", order: "A", ids: ["top"], partsUsd: 6, shipUsd: 10.25 },
    { shop: "Craftcloud", order: "B", ids: ["top", "bot"], partsUsd: 42, shipUsd: 11 },
  ]);
  // A cart with no shipping line says none.
  assert.equal(cartsOf(quotes([q("top", "Craftcloud", 6)]), new Set(["top"]))[0].shipUsd, undefined);
});

test("Craftcloud: from the EU the parts alone up to parts and shipping with VAT; from outside, the duty and the fee for 1 to n items", () => {
  const c: Cart = { shop: "Craftcloud", ids: ["top", "bot"], partsUsd: 12, shipUsd: 10.25 };
  const x = landed(c, FX), parts = 12 / 1.25, ship = 10.25 / 1.25;
  near(x.parts, parts, "parts");
  near(x.ship!, ship, "ship");
  assert.equal(x.small, true);
  assert.deepEqual(x.items, [1, 2]);
  nearAll(x.eu, [parts, (parts + ship) * 1.22], "eu");
  nearAll(x.outside, [parts + 3 + 2, (parts + ship + 3 * 2) * 1.22 + 2 * 1.22 * 2], "outside");
  // The keypad's cart at the ECB's rate of 2026-11-06, to the cent, as its README shows it.
  const k = landed(c, { ...FX, usdPerEur: 1.1165 });
  assert.deepEqual([k.parts, k.parts + k.ship!, ...k.eu!, ...k.outside!].map((n) => n.toFixed(2)), ["10.75", "19.93", "10.75", "24.31", "15.75", "36.51"]);
  // One part: one item, whatever its tariff sub-heading.
  const one = landed({ ...c, ids: ["top"] }, FX);
  assert.deepEqual(one.items, [1, 1]);
  nearAll(one.outside, [parts + DUTY_EUR + FEE_EUR, (parts + ship + DUTY_EUR) * (1 + VAT_IT) + FEE_EUR * (1 + VAT_IT)], "one part");
});

test("JLC3DP: the US tax taken off, no shipping it can price, VAT at its checkout and the duty and fee on top", () => {
  const x = landed({ shop: "JLC3DP", ids: ["a", "b", "c"], partsUsd: 14, shipUsd: 0 }, FX), parts = 14 / 1.4 / 1.25;
  near(x.parts, parts, "parts");
  assert.equal(x.ship, undefined, "$0 is a placeholder, not free shipping");
  assert.equal(x.eu, undefined, "it ships from China");
  assert.deepEqual(x.items, [1, 3]);
  nearAll(x.outside, [parts * 1.22 + 3 + 2, parts * 1.22 + 3 * 3 + 2 * 1.22 * 3], "outside");
});

test("€150: up to it the €3 duty and IOSS; over it, no figure from outside the EU, the EU one still", () => {
  const at = (eur: number) => landed({ shop: "Craftcloud", ids: ["a"], partsUsd: eur * FX.usdPerEur, shipUsd: 10 }, FX);
  assert.equal(at(LOW_VALUE_EUR).small, true);
  assert.ok(at(LOW_VALUE_EUR).outside);
  const over = at(LOW_VALUE_EUR + 0.01);
  assert.equal(over.small, false);
  assert.equal(over.outside, undefined);
  assert.ok(over.eu);
  // JLC3DP's value is its parts without the US tax: $200 with it is €114.29, under €150.
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 200, shipUsd: 0 }, FX).small, true);
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 270, shipUsd: 0 }, FX).small, false);
});

test("a shop with no rule: its figure in euros, and nothing Sprue can't stand behind", () => {
  const x = landed({ shop: "Acme Prints", ids: ["a", "b"], partsUsd: 25, shipUsd: 5 }, FX);
  assert.equal(x.rule, undefined);
  near(x.parts, 20);
  near(x.ship!, 4);
  assert.equal(x.eu, undefined);
  assert.equal(x.outside, undefined);
});
