// The euro figures landed in Italy (landed.ts): fx.json and what it refuses, the carts the quote makes, and each
// cart's low and high figures, worked out here by hand. The words are handoff.ts's, tested in handoff.test.ts.
//   node --test skills/sprue/pipeline/landed.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRates } from "./explore.ts";
import { cartsOf, cents, DUTY_EUR, FEE_EUR, FX_OLD_DAYS, fxAge, ITALY, landed, LOW_VALUE_EUR, loadFx, NEAR_EUR, toEur, USD_PER_EUR, VAT_IT, type Cart, type Fx } from "./landed.ts";
import type { QuoteLine, Quotes } from "./types.ts";

const FX: Fx = { usdPerEur: 1.25, date: "2026-11-06", source: "test", url: "https://example.org/rate", read: "2026-11-09" };
/** To the cent, as landed.ts gives each figure. */
const c2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
const nearAll = (a: [number, number] | undefined, b: [number, number], what = "") => {
  assert.ok(a, `${what} has no figures`);
  near(a[0], c2(b[0]), `${what} low`);
  near(a[1], c2(b[1]), `${what} high`);
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
  const rate = /usdPerEur is not a number of dollars to the euro \(0\.5 to 2\)/;
  const cases: [string, unknown, RegExp][] = [
    ["not JSON", "{", /can't be read/],
    ["null", null, /it is not an object/],
    ["a rate in quotes", { ...good, usdPerEur: "1.1" }, rate],
    ["a rate of 0", { ...good, usdPerEur: 0 }, rate],
    ["a rate below 0", { ...good, usdPerEur: -1.1 }, rate],
    ["euros to the dollar, the rate upside down", { ...good, usdPerEur: 0.4 }, rate],
    ["a rate in cents", { ...good, usdPerEur: 111.65 }, rate],
    ["just under the floor", { ...good, usdPerEur: 0.4999 }, rate],
    ["just over the ceiling", { ...good, usdPerEur: 2.0001 }, rate],
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
  // The bounds themselves, and a rate read on its own day, are taken.
  for (const ok of [good, { ...good, usdPerEur: USD_PER_EUR[0] }, { ...good, usdPerEur: USD_PER_EUR[1] }, { ...good, read: good.date }]) {
    writeFileSync(join(dir, "ok.json"), JSON.stringify(ok));
    assert.deepEqual(loadFx(join(dir, "ok.json")), ok);
  }
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
  assert.equal(ITALY.JLC3DP.ddp, true);
  assert.equal(ITALY.Craftcloud.from, "either");
  assert.ok(ITALY.Craftcloud.allIn);
});

test("carts: one a shop, or one a shop and an order, with its shipping and what rides in it; only the parts handed off", () => {
  assert.deepEqual(cartsOf(undefined, new Set(["a"])), []);
  const lines = [q("top", "Craftcloud", 6), q("bot", "Craftcloud", 6), q("ship:Craftcloud", "Craftcloud", 10.25), q("nut", "Craftcloud", 1),
    q("jig", "JLC3DP", 1.4), { ...q("pin", "JLCMC", 3), shipsWith: "JLC3DP" }, { ...q("pin0", "JLCMC", 0, 0), shipsWith: "JLC3DP" },
    q("feet", "home printer", 0.5), q("gone", "JLC3DP", 0, 0)];
  const carts = cartsOf(quotes(lines), new Set(["top", "bot", "jig", "gone"]));
  assert.deepEqual(carts, [
    { shop: "Craftcloud", order: undefined, ids: ["top", "bot"], partsUsd: 12, lines: [{ id: "top", usd: 6 }, { id: "bot", usd: 6 }], shipUsd: 10.25, shipBasis: "test", riders: [] },
    { shop: "JLC3DP", order: undefined, ids: ["jig"], partsUsd: 1.4, lines: [{ id: "jig", usd: 1.4 }], shipUsd: undefined, shipBasis: undefined, riders: [{ id: "pin", supplier: "JLCMC", usd: 3 }] },
  ]);
  // A quote split in two: each order is a parcel of its own, with its own shipping.
  const split = quotes(lines, [{ name: "A", lines: [q("top", "Craftcloud", 6), q("ship:Craftcloud", "Craftcloud", 10.25)] },
    { name: "B", lines: [q("top", "Craftcloud", 30, 5), q("bot", "Craftcloud", 12, 2), q("ship:Craftcloud", "Craftcloud", 11)] }]);
  assert.deepEqual(cartsOf(split, new Set(["top", "bot"])), [
    { shop: "Craftcloud", order: "A", ids: ["top"], partsUsd: 6, lines: [{ id: "top", usd: 6 }], shipUsd: 10.25, shipBasis: "test", riders: [] },
    { shop: "Craftcloud", order: "B", ids: ["top", "bot"], partsUsd: 42, lines: [{ id: "top", usd: 30 }, { id: "bot", usd: 12 }], shipUsd: 11, shipBasis: "test", riders: [] },
  ]);
  // A cart with no shipping line says none.
  assert.equal(cartsOf(quotes([q("top", "Craftcloud", 6)]), new Set(["top"]))[0].shipUsd, undefined);
});

test("Craftcloud: from the EU the parts alone up to parts and shipping with VAT; from outside, the duty and the fee for 1 to n items", () => {
  const c: Cart = { shop: "Craftcloud", ids: ["top", "bot"], partsUsd: 12, shipUsd: 10.25, riders: [] };
  const x = landed(c, FX), parts = 12 / 1.25, ship = 10.25 / 1.25;
  near(x.parts, parts, "parts");
  near(x.ship!, ship, "ship");
  assert.equal(x.small, true);
  assert.equal(x.near, false);
  assert.deepEqual(x.items, [1, 2]);
  nearAll(x.eu, [parts, (parts + ship) * 1.22], "eu");
  nearAll(x.outside, [parts + 3 + 2, (parts + ship + 3 * 2) * 1.22 + 2 * 1.22 * 2], "outside");
  // The keypad's cart at the ECB's rate of 2026-11-06, to the cent, as its README shows it: each $6.00 part is €5.37
  // (5.374), and the cart's parts are the two, €10.74, not $12.00 converted at once (€10.75).
  const k = landed({ ...c, lines: [{ id: "top", usd: 6 }, { id: "bot", usd: 6 }] }, { ...FX, usdPerEur: 1.1165 });
  assert.equal(toEur(6, { ...FX, usdPerEur: 1.1165 }), 5.37);
  assert.deepEqual([k.parts, k.ship!, k.parts + k.ship!, ...k.eu!, ...k.outside!].map((n) => n.toFixed(2)), ["10.74", "9.18", "19.92", "10.74", "24.30", "15.74", "36.50"]);
  // One part: one item, whatever its tariff sub-heading.
  const one = landed({ ...c, ids: ["top"] }, FX);
  assert.deepEqual(one.items, [1, 1]);
  nearAll(one.outside, [parts + DUTY_EUR + FEE_EUR, (parts + ship + DUTY_EUR) * (1 + VAT_IT) + FEE_EUR * (1 + VAT_IT)], "one part");
});

test("every figure is to the cent, so a total shown is the sum of the figures shown", () => {
  // $1.12 twice at 1.1165 is €1.0031 twice, shown €1.00 each: their total shows €2.00, not the €2.01 the raw sum rounds to.
  const x = landed({ shop: "Craftcloud", ids: ["a"], partsUsd: 1.12, shipUsd: 1.12, riders: [] }, { ...FX, usdPerEur: 1.1165 });
  assert.equal(c2(1.12 / 1.1165 * 2).toFixed(2), "2.01");
  assert.equal(x.parts, 1);
  assert.equal(x.ship, 1);
  for (const n of [x.parts, x.ship!, ...x.eu!, ...x.outside!]) assert.equal(Math.round(n * 100) / 100, n, `${n} is not to the cent`);
  assert.equal((x.parts + x.ship!).toFixed(2), "2.00");
  assert.equal(x.eu![1], 2.44);
  // A cart's parts are the sum of its lines' figures as each part's sheet shows them.
  const two = landed({ shop: "Craftcloud", ids: ["a", "b"], partsUsd: 2.24, lines: [{ id: "a", usd: 1.12 }, { id: "b", usd: 1.12 }], riders: [] }, { ...FX, usdPerEur: 1.1165 });
  assert.equal(two.parts, 2);
  assert.equal(landed({ shop: "Craftcloud", ids: ["a", "b"], partsUsd: 2.24, riders: [] }, { ...FX, usdPerEur: 1.1165 }).parts, 2.01, "without lines, the parts as one");
  // Riders too, each to the cent.
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 1.4, riders: [{ id: "p", supplier: "JLCMC", usd: 1.12 }, { id: "q", supplier: "JLCMC", usd: 1.12 }] }, { ...FX, usdPerEur: 1.1165 }).riders, 2);
});

test("a half cent rounds up, though binary floats hold it a hair below", () => {
  assert.equal(13.75 * 1.22 * 100 < 1677.5, true, "the float this guards against");
  assert.equal(cents(16.775), 16.78);
  assert.equal(cents(2.135), 2.14);
  assert.equal(cents(1.005), 1.01);
  assert.equal(cents(0.004999), 0);
  const one = { ...FX, usdPerEur: 1 };
  assert.equal(landed({ shop: "Craftcloud", ids: ["a"], partsUsd: 13.75, riders: [] }, one).eu![1], 16.78);
  // JLC3DP parts of €1.75 (with the US tax, $2.45): VAT at checkout €2.135, €2.14, and the duty and fee on top.
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 2.45, riders: [] }, one).outside![0], 7.14);
});

test("JLC3DP: the US tax taken off, VAT at its checkout and the duty and fee on top; shipping only where the quote counts it", () => {
  const x = landed({ shop: "JLC3DP", ids: ["a", "b", "c"], partsUsd: 14, riders: [] }, FX), parts = 14 / 1.4 / 1.25;
  near(x.parts, parts, "parts");
  assert.equal(x.ship, undefined, "the quote counts no shipping for it");
  assert.equal(x.eu, undefined, "it ships from China");
  assert.deepEqual(x.items, [1, 3]);
  nearAll(x.outside, [parts * 1.22 + 3 + 2, parts * 1.22 + 3 * 3 + 2 * 1.22 * 3], "outside");
  // catalog.json's shipping for it, when the quote counts it, is in the VAT the checkout collects.
  const shipped = landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 14, shipUsd: 5, riders: [] }, FX);
  near(shipped.ship!, 4, "ship");
  nearAll(shipped.outside, [(parts + 4) * 1.22 + 5, (parts + 4) * 1.22 + 3 + 2 * 1.22], "shipped");
});

test("what rides in the parcel counts toward €150 and the items, not toward the figures", () => {
  const c: Cart = { shop: "JLC3DP", ids: ["a", "b"], partsUsd: 14, riders: [{ id: "pin", supplier: "JLCMC", usd: 5 }, { id: "nut", supplier: "JLCMC", usd: 2.5 }] };
  const x = landed(c, FX), alone = landed({ ...c, riders: [] }, FX);
  near(x.riders, 6);
  near(x.value, x.parts + 6);
  assert.deepEqual(x.items, [2, 4]);
  assert.deepEqual(alone.items, [1, 2]);
  near(x.outside![0], c2(x.parts * 1.22 + 2 * 5), "two items at the least: the made parts and what rides with them");
  // Riders worth enough push the parcel over €150: no figure from outside the EU.
  const heavy = landed({ ...c, riders: [{ id: "pin", supplier: "JLCMC", usd: 180 }] }, FX);
  assert.equal(heavy.small, false);
  assert.equal(heavy.outside, undefined);
});

test("€150: up to it the €3 duty and IOSS; over it, no figure from outside the EU, the EU one still; within €20, near", () => {
  const at = (eur: number) => landed({ shop: "Craftcloud", ids: ["a"], partsUsd: eur * FX.usdPerEur, shipUsd: 10, riders: [] }, FX);
  assert.equal(at(LOW_VALUE_EUR).value, 150);
  assert.equal(at(LOW_VALUE_EUR).small, true);
  assert.ok(at(LOW_VALUE_EUR).outside);
  const over = at(LOW_VALUE_EUR + 0.01);
  assert.equal(over.small, false);
  assert.equal(over.outside, undefined);
  assert.ok(over.eu);
  for (const [eur, isNear] of [[129.99, false], [130, true], [150, true], [170, true], [170.01, false]] as const)
    assert.equal(at(eur).near, isNear, `€${eur}`);
  assert.equal(NEAR_EUR, 20);
  // JLC3DP's value is its parts without the US tax: $200 with it is €114.29, under €150.
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 200, riders: [] }, FX).small, true);
  assert.equal(landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 270, riders: [] }, FX).small, false);
});

test("a shop with no rule: its figure in euros, and nothing Sprue can't stand behind", () => {
  const x = landed({ shop: "Acme Prints", ids: ["a", "b"], partsUsd: 25, shipUsd: 5, riders: [] }, FX);
  assert.equal(x.rule, undefined);
  near(x.parts, 20);
  near(x.ship!, 4);
  assert.equal(x.eu, undefined);
  assert.equal(x.outside, undefined);
});
