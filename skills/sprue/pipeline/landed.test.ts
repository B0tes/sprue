// The euro figures landed in Italy (landed.ts): fx.json and what it refuses, the carts the quote makes, and each
// cart's low and high figures, worked out here by hand. The words are handoff.ts's, tested in handoff.test.ts.
//   node --test skills/sprue/pipeline/landed.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRates } from "./explore.ts";
import { cartsOf, cents, DUTY_EUR, FEE_EUR, FX_OLD_DAYS, fxAge, ITALY, landed, LOW_VALUE_EUR, loadFx, NEAR_EUR, QUOTED, toEur, USD_PER_EUR, VAT_IT, type Cart, type Fx } from "./landed.ts";
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

test("JLC3DP: the US tax taken off, VAT at its checkout and the duty and fee on top, with VAT at the high; shipping only where the quote counts it", () => {
  const x = landed({ shop: "JLC3DP", ids: ["a", "b", "c"], partsUsd: 14, riders: [] }, FX), parts = 14 / 1.4 / 1.25;
  near(x.parts, parts, "parts");
  assert.equal(x.ship, undefined, "the quote counts no shipping for it");
  assert.equal(x.eu, undefined, "it ships from China");
  assert.deepEqual(x.items, [1, 3]);
  // High: the duty and the fee with 22% VAT, as when JLC charges them at checkout (DDP): €3.66 and €2.44 an item.
  nearAll(x.outside, [parts * 1.22 + 3 + 2, parts * 1.22 + 3 * 1.22 * 3 + 2 * 1.22 * 3], "outside");
  // catalog.json's shipping for it, when the quote counts it, is in the VAT the checkout collects.
  const shipped = landed({ shop: "JLC3DP", ids: ["a"], partsUsd: 14, shipUsd: 5, riders: [] }, FX);
  near(shipped.ship!, 4, "ship");
  nearAll(shipped.outside, [(parts + 4) * 1.22 + 5, (parts + 4) * 1.22 + 3 * 1.22 + 2 * 1.22], "shipped");
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

test("a made part whose shop rides in another cart's parcel counts there, as its own line has it, and its cart is no parcel of its own", () => {
  const held = { part: "fab/bracket.stl", sha256: "0".repeat(64), vat: "excluded" as const, expires: "2026-12-16", read: "2026-11-16" };
  // The bracket, Weerg's €90 quote, rides in the lid's JLC3DP parcel; the lid's rate holds JLC3DP's 40% US tax.
  const bracket = { ...q("bracket", "Weerg", 100.49, 3), shipsWith: "JLC3DP", shopQuote: { ...held, currency: "EUR" as const, usdPerEur: 1.1165, total: 90 } };
  const [lid, own] = cartsOf(quotes([q("lid", "JLC3DP", 1.4), bracket]), new Set(["lid", "bracket"]));
  assert.deepEqual(lid.riders, [{ id: "bracket", supplier: "Weerg", usd: 100.49, quoted: true, eur: 90, usdPerEur: 1.1165, vat: "excluded" }]);
  const x = landed(lid, FX);
  assert.equal(x.riders, 90);
  assert.deepEqual(x.items, [2, 2]);
  assert.equal(own.ridesWith, "JLC3DP");
  // The other way round, the lid rides in Weerg's parcel at its rate less the US tax, and its own cart is not landed.
  const lidRides = { ...q("lid", "JLC3DP", 1.4), shipsWith: "Weerg" };
  const [w, l] = cartsOf(quotes([{ ...bracket, shipsWith: undefined }, lidRides]), new Set(["lid", "bracket"]));
  assert.deepEqual(w.riders, [{ id: "lid", supplier: "JLC3DP", usd: 1.4, usTax: 1.4 }]);
  assert.equal(landed(w, FX).riders, toEur(1, FX));
  const y = landed(l, FX);
  assert.equal(l.ridesWith, "Weerg");
  assert.ok(y.rule, "JLC3DP's rule");
  assert.deepEqual([y.eu, y.outside], [undefined, undefined]);
  // A made part the quote does not price (not in ids) rides in no cart, as it has none.
  assert.deepEqual(cartsOf(quotes([q("lid", "JLC3DP", 1.4), bracket]), new Set(["lid"]), new Set(["lid", "bracket"]))[0].riders, []);
});

test("a parcel inside another's counts in the one that carries them all, and every line of a riding shop rides", () => {
  // The bracket (JLCCNC) rides in Weerg's parcel, which rides in JLC3DP's: both count in the JLC3DP cart, whose
  // parcel is then over €150, and neither of theirs is landed.
  const chain = cartsOf(quotes([q("lid", "JLC3DP", 1.4), { ...q("bracket", "JLCCNC", 200, 3), shipsWith: "Weerg" }, { ...q("plate", "Weerg", 40), shipsWith: "JLC3DP" }]),
    new Set(["lid", "bracket", "plate"]));
  const at = (carts: Cart[], shop: string) => carts.find((c) => c.shop === shop)!;
  assert.deepEqual(at(chain, "JLC3DP").riders.map((x) => x.id).sort(), ["bracket", "plate"]);
  assert.deepEqual([at(chain, "JLC3DP").ridesWith, at(chain, "Weerg").riders, at(chain, "Weerg").ridesWith, at(chain, "JLCCNC").ridesWith], [undefined, [], "JLC3DP", "JLC3DP"]);
  const x = landed(at(chain, "JLC3DP"), FX);
  assert.deepEqual([x.small, x.outside], [false, undefined]);
  // One line of a shop says it rides (its quote) and one does not (its print at the rate): the shop's cart rides, and
  // the carrier's parcel holds both.
  const mixed = cartsOf(quotes([q("lid", "JLC3DP", 140), { ...q("hook", "JLC3DP", 50), shipsWith: "Craftcloud" }, q("cap", "Craftcloud", 20)]), new Set(["lid", "hook", "cap"]));
  assert.deepEqual([at(mixed, "Craftcloud").riders.map((x) => x.id).sort(), at(mixed, "JLC3DP").ridesWith], [["hook", "lid"], "Craftcloud"]);
  // Round a loop (catalog.json's checks refuse it), each shop is its own parcel, not in none.
  const loop = cartsOf(quotes([{ ...q("lid", "JLC3DP", 1.4), shipsWith: "Weerg" }, { ...q("plate", "Weerg", 40), shipsWith: "JLC3DP" }]), new Set(["lid", "plate"]));
  assert.deepEqual(loop.map((c) => [c.shop, c.ridesWith, c.riders.length]), [["JLC3DP", undefined, 0], ["Weerg", undefined, 0]]);
  // As is a shop riding into a loop.
  const tail = cartsOf(quotes([{ ...q("cap", "Craftcloud", 20), shipsWith: "JLC3DP" }, { ...q("lid", "JLC3DP", 1.4), shipsWith: "Weerg" }, { ...q("plate", "Weerg", 40), shipsWith: "JLC3DP" }]),
    new Set(["cap", "lid", "plate"]));
  assert.deepEqual(tail.map((c) => [c.shop, c.ridesWith, c.riders.length]), [["Craftcloud", undefined, 0], ["JLC3DP", undefined, 0], ["Weerg", undefined, 0]]);
});

test("a part priced from a shop's quote: no print rate's rule but its shop's, no US tax taken off, and a quote in euros is the shop's own total", () => {
  const held = { part: "fab/hook.stl", sha256: "0".repeat(64), vat: "excluded" as const, expires: "2026-12-16", read: "2026-11-16" };
  // Planted: JLC3DP's quote for a 316L print, $125 for 1. JLC3DP's rule (its rate holds a 40% US tax, its parcel comes
  // from outside the EU) is of its print rate, not of what it quoted: €100.00, not $125 / 1.40 converted.
  const usdQuote = { ...q("hook", "JLC3DP", 125), shopQuote: { ...held, currency: "USD" as const, total: 125 } };
  const [c] = cartsOf(quotes([usdQuote]), new Set(["hook"]));
  assert.deepEqual(c.lines, [{ id: "hook", usd: 125, quoted: true, vat: "excluded" }]);
  const x = landed(c, FX);
  assert.equal(x.quoted, true);
  assert.equal(x.rule, undefined);
  assert.equal(x.landing, QUOTED.JLC3DP);
  assert.deepEqual(x.held, ["excluded"]);
  assert.equal(x.parts, 100);
  assert.equal(x.eu, undefined);
  // From China, a €100.00 parcel with no shipping counted: VAT at checkout, the duty and the fee on top.
  nearAll(x.outside, [100 * 1.22 + 3 + 2, 100 * 1.22 + (3 + 2) * 1.22], "outside");
  // Weerg's quote in euros, €90.00 for 3, is $100.49 at the rate recorded with it: in euros it is €90.00 again, not
  // $100.49 at fx.json's rate.
  const eurQuote = { ...q("bracket", "Weerg", 100.49, 3), shopQuote: { ...held, part: "fab/bracket.stl", currency: "EUR" as const, usdPerEur: 1.1165, total: 90 } };
  const [w] = cartsOf(quotes([eurQuote, q("ship:Weerg", "Weerg", 20)]), new Set(["bracket"]));
  assert.deepEqual(w.lines, [{ id: "bracket", usd: 100.49, quoted: true, eur: 90, usdPerEur: 1.1165, vat: "excluded" }]);
  const y = landed(w, FX);
  assert.equal(y.parts, 90);
  // Its shipping, read at Weerg's checkout in euros and recorded in dollars at the quote's rate, goes back at that
  // rate: €17.91, not $20 at fx.json's.
  assert.equal(y.ship, 17.91);
  assert.equal(y.shipRate, 1.1165);
  // From Weerg, in Italy: 22% on the parts, which its quote gives without VAT, and the shipping as recorded up to with
  // 22% on it; nothing from outside the EU.
  nearAll(y.eu, [90 * 1.22 + 17.91, (90 + 17.91) * 1.22], "Weerg");
  assert.equal(y.outside, undefined);
  // Two quotes in euros at two rates: no one rate is the shipping's, so it is fx.json's.
  const other = { ...q("lid", "Weerg", 55.4, 2), shopQuote: { ...held, part: "fab/lid.stl", currency: "EUR" as const, usdPerEur: 1.108, total: 50 } };
  const z = landed(cartsOf(quotes([eurQuote, other, q("ship:Weerg", "Weerg", 20)]), new Set(["bracket", "lid"]))[0], FX);
  assert.equal(z.parts, 140);
  assert.equal(z.ship, 16);
  assert.equal(z.shipRate, undefined);
  nearAll(z.eu, [140 * 1.22 + 16, (140 + 16) * 1.22], "two rates");
  // A cart with a rate-priced print beside a quoted one: the print's US tax still comes off, the quote's never does.
  const both = cartsOf(quotes([usdQuote, q("jig", "JLC3DP", 1.4)]), new Set(["hook", "jig"]))[0];
  near(landed(both, FX).parts, 100 + 0.8, "parts");
  assert.equal(landed(both, FX).rule, undefined);
  // Both leave VAT out (JLC3DP's rate does): the cart lands from China, for 1 to 2 items.
  assert.deepEqual(landed(both, FX).held, ["excluded"]);
  nearAll(landed(both, FX).outside, [100.8 * 1.22 + 5, 100.8 * 1.22 + 5 * 1.22 * 2], "both");
});

/** A line priced from `shop`'s quote in euros, `eur` for 1 at 1.25 USD a euro, whose totals hold VAT as `vat` says. */
const quoteLine = (id: string, shop: string, eur: number, vat: "excluded" | "included" | "not stated", qty = 1): QuoteLine =>
  ({ ...q(id, shop, eur * 1.25, qty), shopQuote: { part: `fab/${id}.stl`, sha256: "0".repeat(64), currency: "EUR", usdPerEur: 1.25, total: eur, vat, expires: "not stated", read: "2026-11-16" } });
const landedQuote = (lines: QuoteLine[], ship?: number) =>
  landed(cartsOf(quotes([...lines, ...(ship === undefined ? [] : [q(`ship:${lines[0].supplier}`, lines[0].supplier, ship * 1.25)])]), new Set(lines.map((x) => x.lineId)))[0], FX);

test("a shop's quote from inside the EU: no customs, VAT as its quote holds it, from the seller's own rate up to Italy's", () => {
  // Weerg sells from Italy: 22% either way. The shipping, €10, may hold VAT or not: as recorded up to with 22% on it.
  nearAll(landedQuote([quoteLine("plate", "Weerg", 100, "excluded")], 10).eu, [122 + 10, 122 + 12.2], "Weerg excluded");
  nearAll(landedQuote([quoteLine("plate", "Weerg", 100, "included")], 10).eu, [100 + 10, 100 + 12.2], "Weerg included");
  nearAll(landedQuote([quoteLine("plate", "Weerg", 100, "not stated")], 10).eu, [100 + 10, 122 + 12.2], "Weerg not stated");
  // Laserboost sells from Spain: a total without VAT takes Spain's 21% below the €10,000 line, Italy's 22% above it.
  nearAll(landedQuote([quoteLine("plate", "Laserboost", 100, "excluded")], 10).eu, [121 + 10, 122 + 12.2], "Laserboost excluded");
  // Xometry Europe sells from Germany: a total with VAT may hold Germany's 19%, which Italy's 22% replaces above it.
  nearAll(landedQuote([quoteLine("plate", "Xometry Europe", 119, "included")], 10).eu, [119 + 10, 122 + 12.2], "Xometry included");
  // A total that holds its shipping: catalog.json records 0, and the figures are the parts'.
  nearAll(landedQuote([quoteLine("plate", "Laserbend3D", 100, "included")], 0).eu, [100, 100], "Laserbend3D, shipping in its total");
  for (const shop of ["Weerg", "Laserboost", "Xometry Europe", "Laserbend3D"]) {
    const x = landedQuote([quoteLine("plate", shop, 400, "excluded")], 10);
    assert.equal(x.outside, undefined, `${shop} ships from inside the EU`);
    assert.equal(x.landing?.from, "eu");
  }
  // Two quotes, one with VAT and one without: each line takes its own.
  const two = landedQuote([quoteLine("plate", "Laserboost", 100, "excluded"), quoteLine("lid", "Laserboost", 50, "included")], 10);
  assert.deepEqual(two.held, ["excluded", "included"]);
  nearAll(two.eu, [121 + 50 + 10, 122 + (50 * 1.22) / 1.21 + 12.2], "two quotes");
  // Its worth without VAT, as a rider's would be: a total with VAT from a seller in another EU country without its own
  // rate, then without Italy's.
  const de = landedQuote([quoteLine("plate", "Xometry Europe", 119, "included")]), es = landedQuote([quoteLine("plate", "Laserboost", 121, "included")]);
  near(de.value, 100, "Xometry's value");
  near(de.valueLow!, c2(119 / 1.22), "Xometry's low value");
  near(es.value, 100, "Laserboost's value");
  near(es.valueLow!, c2(121 / 1.22), "Laserboost's low value");
  near(landedQuote([quoteLine("plate", "Weerg", 122, "included")]).value, 100, "Weerg's value");
  assert.equal(landedQuote([quoteLine("plate", "Weerg", 122, "included")]).valueLow, undefined);
});

test("a shop's quote from outside the EU: VAT as its quote holds it, the duty and the fee, and €150 counted without VAT", () => {
  const x = landedQuote([quoteLine("plate", "JLCCNC", 100, "excluded"), quoteLine("lid", "JLCCNC", 20, "not stated")], 10);
  assert.deepEqual([x.landing?.from, x.eu, x.items], ["outside", undefined, [1, 2]]);
  // Low: VAT at checkout on the total without it, the other as it is, the shipping as recorded, the duty and the fee
  // for 1 item without VAT. High: 22% on both totals, the shipping, the duty and the fee, for 2 items.
  nearAll(x.outside, [122 + 20 + 10 + 5, (100 + 20 + 10) * 1.22 + 5 * 1.22 * 2], "JLCCNC");
  // €150 counts the goods without VAT: a total whose quote does not say counts as it is, and as holding VAT.
  assert.equal(x.value, 120);
  assert.equal(x.valueLow, cents(100 + 20 / 1.22));
  // A total with VAT: 22% of it is VAT, so €170.80 is a €140.00 parcel, up to €150.
  const held = landedQuote([quoteLine("plate", "JLCCNC", 170.8, "included")], 10);
  assert.deepEqual([held.value, held.valueLow, held.small, held.near], [140, undefined, true, true]);
  nearAll(held.outside, [170.8 + 10 + 5, 170.8 + 12.2 + 5 * 1.22], "VAT included");
  // A total whose quote does not say: €160.00 may be a €131.15 parcel or a €160.00 one, on either side of €150. Over
  // it the duty is the parts' own tariff rate, which Sprue can't price, so it gives no figure from outside the EU.
  const unsaid = landedQuote([quoteLine("plate", "JLCCNC", 160, "not stated")], 10);
  assert.deepEqual([unsaid.value, unsaid.valueLow, unsaid.small, unsaid.near, unsaid.outside], [160, 131.15, false, true, undefined]);
  // €150.00 that does not say is up to €150 at both readings.
  const at = landedQuote([quoteLine("plate", "JLCCNC", 150, "not stated")], 10);
  assert.deepEqual([at.value, at.small], [150, true]);
  assert.ok(at.outside);
  // Over €150 without VAT on both readings: no figure from outside the EU.
  const over = landedQuote([quoteLine("plate", "JLCCNC", 190, "not stated")], 10);
  assert.deepEqual([over.small, over.outside], [false, undefined]);
  // A shop Sprue has no rule for: its figure only.
  const other = landedQuote([quoteLine("plate", "Acme Machining", 100, "excluded")], 10);
  assert.deepEqual([other.landing, other.eu, other.outside, other.parts], [undefined, undefined, undefined, 100]);
});

test("Craftcloud's quote: its partner may be on either side of the border, so its word on VAT counts as not saying", () => {
  // Whatever the quote records, each figure counts the price as holding VAT (low) and as not (high), and so does €150.
  for (const vat of ["included", "excluded", "not stated"] as const) {
    const x = landedQuote([quoteLine("hook", "Craftcloud", 100, vat)], 10);
    assert.equal(x.landing?.from, "either");
    assert.deepEqual(x.held, [vat], "the words say what the quote records");
    nearAll(x.eu, [100 + 10, 122 + 12.2], `from inside, ${vat}`);
    nearAll(x.outside, [100 + 10 + 5, 122 + 12.2 + 5 * 1.22], `from outside, ${vat}`);
    assert.deepEqual([x.value, x.valueLow, x.small], [100, cents(100 / 1.22), true], vat);
  }
  // €175 its quote says leaves VAT out may still be €143.44 of goods: up to €150 at one reading, so it may be over.
  const over = landedQuote([quoteLine("hook", "Craftcloud", 175, "excluded")], 10);
  assert.deepEqual([over.value, over.valueLow, over.small, over.near, over.outside], [175, cents(175 / 1.22), false, true, undefined]);
});

test("a cart's shipping is converted at the one rate its quotes in euros were recorded at, beside a line at Sprue's rate", () => {
  // fx.json moved to 1.17 after Craftcloud's quote at 1.25: its $25 of shipping is still €20.00.
  const later = { ...FX, usdPerEur: 1.17 };
  const lines = [quoteLine("hook", "Craftcloud", 40, "excluded"), q("lid", "Craftcloud", 12.5), q("ship:Craftcloud", "Craftcloud", 25)];
  const [c] = cartsOf(quotes(lines), new Set(["hook", "lid"]));
  const x = landed(c, later);
  assert.deepEqual([x.ship, x.shipRate], [20, 1.25]);
  // With a quote in dollars beside it, the shipping may be in dollars: at fx.json's rate.
  const usd = { ...q("arm", "Craftcloud", 30), shopQuote: { ...quoteLine("arm", "Craftcloud", 30, "excluded").shopQuote!, currency: "USD", usdPerEur: undefined, total: 30 } } as QuoteLine;
  const [d] = cartsOf(quotes([...lines, usd]), new Set(["hook", "lid", "arm"]));
  assert.deepEqual([landed(d, later).ship, landed(d, later).shipRate], [21.37, undefined]);
  // Only lines at Sprue's rate: fx.json's.
  const [e] = cartsOf(quotes([q("lid", "Craftcloud", 12.5), q("ship:Craftcloud", "Craftcloud", 25)]), new Set(["lid"]));
  assert.deepEqual([landed(e, later).ship, landed(e, later).shipRate], [21.37, undefined]);
});

test("a line riding in a quoted cart's parcel counts toward €150 without the VAT its quote holds", () => {
  // JLC3DP's €61 print (VAT included, Italy's 22% as a seller outside the EU charges it) rides in JLCCNC's parcel: €50
  // toward €150.
  const rider = { ...quoteLine("hook", "JLC3DP", 61, "included"), shipsWith: "JLCCNC" };
  const [c] = cartsOf(quotes([quoteLine("plate", "JLCCNC", 100, "excluded"), rider, q("ship:JLCCNC", "JLCCNC", 12.5)]), new Set(["plate", "hook"]));
  assert.deepEqual(c.riders.map((r) => [r.id, r.vat]), [["hook", "included"]]);
  const x = landed(c, FX);
  assert.deepEqual([x.riders, x.value, x.valueLow, x.small, x.items], [61, 150, undefined, true, [2, 2]]);
  // Its own price is not in the cart's figures, which are JLCCNC's.
  nearAll(x.outside, [122 + 10 + 5 * 2, (100 + 10) * 1.22 + 5 * 1.22 * 2], "with a rider");
  // From Laserboost, in Spain, the €61 may hold Spain's 21%: €50.00 to €50.41, so the parcel may be over €150.
  const spain = { ...quoteLine("sheet", "Laserboost", 61, "included"), shipsWith: "JLCCNC" };
  const [s] = cartsOf(quotes([quoteLine("plate", "JLCCNC", 100, "excluded"), spain, q("ship:JLCCNC", "JLCCNC", 12.5)]), new Set(["plate", "sheet"]));
  const y = landed(s, FX);
  assert.deepEqual([y.value, y.valueLow, y.small, y.near, y.outside], [cents(100 + 61 / 1.21), 150, false, true, undefined]);
  // Craftcloud's €120, its quote saying it holds VAT, rides in JLC3DP's parcel: as not saying, €98.36 to €120.
  const hook = { ...quoteLine("hook", "Craftcloud", 120, "included"), shipsWith: "JLC3DP" };
  const [t] = cartsOf(quotes([quoteLine("lid", "JLC3DP", 30, "excluded"), hook]), new Set(["lid", "hook"]));
  const z = landed(t, FX);
  assert.deepEqual([z.value, z.valueLow, z.small, z.outside], [150, cents(30 + 120 / 1.22), true, z.outside]);
  const [u] = cartsOf(quotes([quoteLine("lid", "JLC3DP", 31, "excluded"), hook]), new Set(["lid", "hook"]));
  assert.deepEqual([landed(u, FX).small, landed(u, FX).outside], [false, undefined], "€151 at one reading: may be over €150");
  // A shop Sprue has no rule for: its €61 with VAT may hold any rate, so it counts as not saying, €50 to €61, and the
  // parcel may be over €150.
  const acme = { ...quoteLine("arm", "Acme Machining", 61, "included"), shipsWith: "JLCCNC" };
  const [a] = cartsOf(quotes([quoteLine("plate", "JLCCNC", 100, "excluded"), acme, q("ship:JLCCNC", "JLCCNC", 12.5)]), new Set(["plate", "arm"]));
  const w = landed(a, FX);
  assert.deepEqual([w.value, w.valueLow, w.small, w.outside], [161, 150, false, undefined]);
  // A line at Craftcloud's rate counts as not saying too, as its quote's would: €110 is €90.16 to €110.
  const lid = { ...q("lid", "Craftcloud", 137.5), shipsWith: "JLCCNC" };
  const [r] = cartsOf(quotes([quoteLine("plate", "JLCCNC", 32, "excluded"), lid]), new Set(["plate", "lid"]));
  const v = landed(r, FX);
  assert.deepEqual([r.riders[0].vat, v.value, v.valueLow, v.small], [undefined, 142, cents(32 + 110 / 1.22), true]);
  // A bought line from a shop with no rule keeps its price: it has no VAT word.
  const [b] = cartsOf(quotes([quoteLine("plate", "JLCCNC", 32, "excluded"), { ...q("screw", "Misumi", 20), shipsWith: "JLCCNC" }]), new Set(["plate"]));
  assert.deepEqual([landed(b, FX).value, landed(b, FX).valueLow], [48, undefined]);
});
