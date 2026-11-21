// A CNC, sheet-metal or metal-printed part priced from a shop's quote that a person recorded in catalog.json: the
// quote takes it only for the line's own file and spec, from a pinned shop when pinned, and only for a count the shop
// quoted that covers the order; it says why, quote by quote, when none does; a quote's shop with no shipping figure is
// named; and catalog.json's checks catch a quote recorded wrong (euros typed as dollars among them). The file's bytes
// are held at the gates (handoff.cli.test.ts). Run them with
//   node --test skills/sprue/pipeline/adapters/fab.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catalogProblems } from "../catalog.ts";
import { buildPlan } from "../stages/plan.ts";
import { lapsedQuotes, quote, rideAlong, whyUnpriced } from "../stages/quote.ts";
import type { Bom, BomLine, Checks, Design, Offer, QuoteLine, Request, Sourcing } from "../types.ts";
import { fabOptions, quotedFile, quotedPart, type FabRates } from "./fab.ts";

const rates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rates.json"), "utf8")) as FabRates;
const SHA = "a5707be7fcb55fdd63eac5350d24f23281fdeaa395ea42ee9587ca5b1876b078";
const SPEC = { material: "aluminium 6061-T6", features: "two M4 tapped holes" };
/** bracket: 2 a unit x 20 units + 1 spare = 41. */
const bracket: BomLine = { id: "bracket", name: "Bracket", role: "bracket", process: "cnc", qtyPerUnit: 2, spares: 1, spec: SPEC, file: "fab/bracket.step" } as BomLine;
const bom = (...lines: BomLine[]): Bom => ({ slug: "lid", units: 20, lines });
const none: Sourcing = { slug: "lid", lines: [], unsourced: [] };
/** Weerg's quote for fab/bracket.stl: €120.00 for 4, €444.00 for 37, €471.50 for 41, at $1.1165 a euro. */
const weerg = (over: Partial<Offer> = {}, quoted: Partial<NonNullable<Offer["shopQuote"]>> = {}): Offer => ({
  supplier: "Weerg", sku: "Q-1", url: "https://www.weerg.com/en/global/quotation-tool/upload",
  priceBreaks: [{ qty: 4, shopTotal: 120, unitUsd: 33.495 }, { qty: 37, shopTotal: 444, unitUsd: 13.398 }, { qty: 41, shopTotal: 471.5, unitUsd: 12.83975 }],
  stock: "unknown", leadDays: 9, source: "snapshot", capturedAt: "2026-11-16",
  shopQuote: { part: "fab/bracket.stl", sha256: SHA, spec: { ...SPEC }, currency: "EUR", usdPerEur: 1.1165, vat: "excluded", expires: "2026-12-16", ...quoted }, ...over });
const withQuotes = (...offers: Offer[]): FabRates => ({ ...rates, shopQuotes: { bracket: offers } });
const priced = (q: ReturnType<typeof quote>) => q.lines.find((l) => l.lineId === "bracket");

test("a CNC part is priced from the shop's quote recorded for its file and spec", () => {
  const q = quote(bom(bracket), none, withQuotes(weerg()), { Weerg: 21.33 });
  const l = priced(q)!;
  assert.deepEqual([l.supplier, l.sku, l.mode, l.needQty, l.orderQty, l.orderUsd, l.leadDays], ["Weerg", "Q-1", "snapshot", 41, 41, 526.43, 9]);
  assert.match(l.basis, /^Weerg's quote Q-1 for fab\/bracket\.stl \(sha256 a5707be7fcb5\) and bom\.json's spec, read by a person on 2026-11-16 from https:\/\/www\.weerg\.com\/\S+ and recorded in catalog\.json, holding until 2026-12-16: €471\.50 for 41, VAT excluded, at \$1\.1165 a euro \(catalog\.json shopQuote\.usdPerEur\)$/);
  assert.deepEqual(l.shopQuote, { part: "fab/bracket.stl", sha256: SHA, currency: "EUR", usdPerEur: 1.1165, vat: "excluded", expires: "2026-12-16", total: 471.5, read: "2026-11-16" });
  assert.deepEqual(q.lines.find((x) => x.lineId === "ship:Weerg")?.orderUsd, 21.33);
  assert.deepEqual([q.unquoted, q.noShipping, q.batchUsd], [[], undefined, 547.76]);
  // A quote in dollars needs no rate; one the shop calls a reference is an estimate.
  const usd = priced(quote(bom(bracket), none, withQuotes(weerg({ priceBreaks: [{ qty: 41, shopTotal: 500, unitUsd: 12.195 }], source: "estimate" }, { currency: "USD", usdPerEur: undefined, vat: "not stated" })), { Weerg: 20 }))!;
  assert.deepEqual([usd.orderUsd, usd.mode], [500, "estimate"]);
  assert.match(usd.basis, /^estimate, not a firm quote: Weerg's quote Q-1 .*: \$500\.00 for 41, VAT not stated$/);
  // A quote whose page does not say how long it holds says so.
  const open = priced(quote(bom(bracket), none, withQuotes(weerg({}, { expires: "not stated" })), { Weerg: 20 }))!;
  assert.match(open.basis, / and recorded in catalog\.json, its page not saying how long it holds: €471\.50 for 41,/);
  assert.equal(open.shopQuote?.expires, "not stated");
});

test("each order takes the cheapest count the shop quoted that covers it, and never a count it did not quote", () => {
  const at = (need: number) => fabOptions(bracket, need, withQuotes(weerg()))[0];
  assert.deepEqual([at(4).orderQty, at(4).orderUsd], [4, 133.98]);
  assert.deepEqual([at(37).orderQty, at(37).orderUsd], [37, 495.73]);
  assert.deepEqual([at(3).orderQty, at(3).needQty, at(3).orderUsd], [4, 3, 133.98]);
  assert.match(at(3).basis, /: €120\.00 for 4, more than the 3 this order needs, VAT excluded/);
  // 38 is more than 37: the 41's total covers it, never 37's price a piece times 38.
  assert.deepEqual([at(38).orderQty, at(38).orderUsd], [41, 526.43]);
  // Planted: more than every count the shop quoted has no price.
  assert.deepEqual(fabOptions(bracket, 42, withQuotes(weerg())), []);
  const big = { ...bracket, qtyPerUnit: 3 };
  const q = quote(bom(big), none, withQuotes(weerg()), { Weerg: 20 });
  assert.deepEqual(q.unquoted, ["bracket"]);
  assert.match(whyUnpriced(big, withQuotes(weerg())), /^no shop's quote in catalog\.json prices it as it is now \(Weerg Q-1 prices 4, 37 and 41 pieces, fewer than an order of it buys\): Sprue prices a CNC part only from a shop's quote/);
  // Of two shops' quotes, the cheaper for the order.
  const jlc = weerg({ supplier: "JLCCNC", sku: "J-9", priceBreaks: [{ qty: 41, shopTotal: 400, unitUsd: 400 * 1.1165 / 41 }] });
  assert.equal(fabOptions(bracket, 41, withQuotes(weerg(), jlc))[0].supplier, "JLCCNC");
});

test("of two shops' quotes, the quote takes the one that makes the order cost less with each shop's shipping counted", () => {
  // JLCCNC's part is $80.85 less ($445.58 against Weerg's $526.43), but its shipping is $120 against Weerg's $20.
  const jlc = weerg({ supplier: "JLCCNC", sku: "J-9", priceBreaks: [{ qty: 41, shopTotal: 399.09, unitUsd: 399.09 * 1.1165 / 41 }] });
  const q = quote(bom(bracket), none, withQuotes(weerg(), jlc), { Weerg: 20, JLCCNC: 120 });
  const l = priced(q)!;
  assert.deepEqual([l.supplier, l.orderUsd, q.batchUsd], ["Weerg", 526.43, 546.43]);
  assert.match(l.basis, /; chosen over JLCCNC \(\$445\.58\) because the order costs less with each shop's shipping counted$/);
  // With shipping the same, the part's own price decides, and no word is added.
  const even = quote(bom(bracket), none, withQuotes(weerg(), jlc), { Weerg: 20, JLCCNC: 20 });
  assert.deepEqual([priced(even)!.supplier, priced(even)!.basis.includes("chosen over")], ["JLCCNC", false]);
  // Two quoted parts each cheapest at another shop, $11.17 apart on the plate: one shop for both saves a $50 shipping
  // charge, and is taken.
  const plate: BomLine = { id: "plate", name: "Plate", role: "plate", process: "sheet", qtyPerUnit: 1, spec: { material: "aluminium 5052", thicknessMm: 1.5 }, file: "fab/plate.step" } as BomLine;
  const on = (shop: string, sku: string, total: number) => weerg({ supplier: shop, sku, priceBreaks: [{ qty: 20, shopTotal: total, unitUsd: total * 1.1165 / 20 }] }, { part: "fab/plate.stl", spec: plate.spec });
  const rates2: FabRates = { ...rates, shopQuotes: { bracket: [weerg(), jlc], plate: [on("Weerg", "Q-2", 80), on("JLCCNC", "J-10", 90)] } };
  const two = quote(bom(bracket, plate), none, rates2, { Weerg: 50, JLCCNC: 50 });
  const by = (id: string) => two.lines.find((x) => x.lineId === id)!;
  assert.deepEqual([by("bracket").supplier, by("plate").supplier, two.lines.filter((x) => x.lineId.startsWith("ship:")).length], ["JLCCNC", "JLCCNC", 1]);
  // Where a part saves more at its own cheapest shop than a shipping charge, it stays there.
  const apart = quote(bom(bracket, plate), none, { ...rates, shopQuotes: { bracket: [weerg(), jlc], plate: [on("Weerg", "Q-2", 10), on("JLCCNC", "J-10", 90)] } }, { Weerg: 50, JLCCNC: 50 });
  assert.deepEqual(["bracket", "plate"].map((id) => apart.lines.find((x) => x.lineId === id)!.supplier), ["JLCCNC", "Weerg"]);
});

test("the quote finds the cheapest set of quoting shops, even where no one move and no one shop for all gets there", () => {
  // p1 and p2 are cheapest at A, each $5 dearer elsewhere (p1 at B, p2 at C); p3 is quoted by B only, p4 by C only.
  // Moving p1 alone or p2 alone keeps A's shipping, and no one shop quoted both: only p1 at B with p2 at C drops A's
  // $50, for $10 more on the parts. $510, not the base's $550.
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 20, shopTotal: usd, unitUsd: usd / 20 }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const shopQuotes = { p1: [at("A", "p1", 100), at("B", "p1", 105)], p2: [at("A", "p2", 100), at("C", "p2", 105)], p3: [at("B", "p3", 100)], p4: [at("C", "p4", 100)] };
  const q = quote(bom(part("p1"), part("p2"), part("p3"), part("p4")), none, { ...rates, shopQuotes }, { A: 50, B: 50, C: 50 });
  const by = (id: string) => q.lines.find((x) => x.lineId === id)!;
  assert.deepEqual([by("p1").supplier, by("p2").supplier, q.batchUsd], ["B", "C", 510]);
  // Each moved part says why, by its own shop: the shipping, as no bought line rides in its parcel.
  assert.match(by("p1").basis, /; chosen over A \(\$100\.00\) because the order costs less with each shop's shipping counted$/);
  assert.match(by("p2").basis, /; chosen over A \(\$100\.00\) because the order costs less with each shop's shipping counted$/);
  assert.ok(!by("p3").basis.includes("chosen over") && !by("p4").basis.includes("chosen over"));
});

test("a shop that carries another's parts (shipsWith) is found for a quoted part, and says why only when they ride because of it", () => {
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const scr = { id: "scr", name: "scr", role: "scr", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "S1" } as unknown as BomLine;
  const from = (supplier: string, unitUsd: number) => ({ supplier, sku: `${supplier}-S1`, mpn: "S1", url: "https://example.com/s1", priceBreaks: [{ qty: 1, unitUsd }],
    stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" }) as Offer;
  const sold = (...offers: Offer[]): Sourcing => ({ slug: "lid", unsourced: [], lines: [{ lineId: "scr", offers }] } as Sourcing);
  const one = () => 1;
  // L1 costs $2 more at F than at A, and B's screw rides in F's parcel, saving B's $20. Every set with F has a shop
  // cheaper than F for each part, so only a set that also moves a part to F finds $47: L1 at F, L2 and L3 at A.
  const shopQuotes = { L1: [at("A", "L1", 10), at("F", "L1", 12)], L2: [at("A", "L2", 10), at("C", "L2", 9)], L3: [at("A", "L3", 10), at("D", "L3", 9)] };
  const q = quote(bom(part("L1"), part("L2"), part("L3"), scr), sold(from("B", 5)), { ...rates, shopQuotes }, { A: 5, C: 5, D: 5, F: 5, B: 20 }, one, { shipsWith: { B: "F" } });
  const by = (id: string) => q.lines.find((x) => x.lineId === id)!;
  assert.deepEqual([q.batchUsd, by("L1").supplier, by("L2").supplier, by("L3").supplier, by("scr").shipsWith], [47, "F", "A", "A", "F"]);
  assert.match(by("L1").basis, /; chosen over A \(\$10\.00\) because B ships in its parcel$/);
  // A screw that rode with that shop already (a plastic print there in the base order) is not why a part moved there:
  // the hinge moves to JLC3DP to save Weerg's shipping.
  const hingeSpec = { material: "stainless steel 316L", process: "SLM" };
  const hinge = { id: "hinge", name: "Hinge", role: "hinge", process: "print", qtyPerUnit: 1, spec: hingeSpec, file: "fab/hinge.stl" } as BomLine;
  const kase = { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 10, material: "PA12" } } as BomLine;
  const hq = (shop: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-H`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: "fab/hinge.stl", spec: hingeSpec, currency: "USD", usdPerEur: undefined });
  const ride = (lines: BomLine[]) => quote(bom(...lines), sold(from("JLCMC", 1), from("Bolts and Nuts", 1)), { ...rates, shopQuotes: { hinge: [hq("Weerg", 50), hq("JLC3DP", 52)] } },
    { Weerg: 20, JLCMC: 8, "Bolts and Nuts": 8.95, JLC3DP: 0 }, one, { shipsWith: { JLCMC: "JLC3DP" } }).lines.find((x) => x.lineId === "hinge")!;
  const rode = ride([scr, kase, hinge]);
  assert.equal(rode.supplier, "JLC3DP");
  assert.match(rode.basis, /; chosen over Weerg \(\$50\.00\) because the order costs less with each shop's shipping counted$/);
  // With no print there, the screw rides because the hinge moved, and that is why.
  assert.match(ride([scr, hinge]).basis, /; chosen over Weerg \(\$50\.00\) because JLCMC ships in its parcel$/);
});

test("two or three carrier shops each take the part that suits them, whatever their order in catalog.json", () => {
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const buy = (id: string) => ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1, spec: {}, mpn: `M-${id}` }) as unknown as BomLine;
  const sells = (supplier: string, id: string, unitUsd: number) => ({ lineId: id, offers: [{ supplier, sku: `${supplier}-${id}`, mpn: `M-${id}`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" } as Offer] });
  const run = (quotes: Record<string, [string, number][]>, buys: [string, string, number][], shipping: Record<string, number>, shipsWith: Record<string, string>) => {
    const q = quote(bom(...Object.keys(quotes).map(part), ...buys.map(([, id]) => buy(id))),
      { slug: "lid", unsourced: [], lines: buys.map(([s, id, usd]) => sells(s, id, usd)) } as Sourcing,
      { ...rates, shopQuotes: Object.fromEntries(Object.entries(quotes).map(([id, qs]) => [id, qs.map(([s, usd]) => at(s, id, usd))])) }, shipping, () => 1, { shipsWith });
    return [q.batchUsd, ...Object.keys(quotes).map((id) => q.lines.find((x) => x.lineId === id)!.supplier)];
  };
  // F's cheapest extra part is L1 (+$1), which leaves G only L2 (+$10): taken in turn, the order of catalog.json's
  // shipsWith decided the total. L1 at G and L2 at F, both screws riding, is $49.70.
  const two = { L1: [["A", 10], ["F", 11], ["G", 11.5]], L2: [["A", 10], ["F", 11.2], ["G", 20]], L3: [["A", 10]] } as Record<string, [string, number][]>;
  const buys2: [string, string, number][] = [["B", "scr", 1], ["E", "nut", 1]], ship2 = { A: 5, F: 5, G: 5, B: 20, E: 20 };
  assert.deepEqual(run(two, buys2, ship2, { B: "F", E: "G" }), [49.7, "G", "F", "A"]);
  assert.deepEqual(run(two, buys2, ship2, { E: "G", B: "F" }), [49.7, "G", "F", "A"]);
  // A carrier the set uses (A, for L2) can lose its part to another (C takes L2), and then needs one back (L0): $73.48.
  // Found by comparing the quote with every assignment, on random catalogs with one to three carriers.
  const cascade = { L0: [["A", 20.31], ["D", 16.05], ["F", 18.74]], L1: [["A", 20.53], ["C", 17.24], ["D", 21.22], ["F", 9.95]], L2: [["A", 18.55], ["C", 23.73]] } as Record<string, [string, number][]>;
  assert.deepEqual(run(cascade, [["B0", "p0", 0.18], ["B1", "p1", 3.31]], { A: 6, C: 9, D: 7, F: 1, B0: 9, B1: 23 }, { B0: "A", B1: "C" }), [73.48, "A", "F", "C"]);
  // Three carriers.
  const three = { L0: [["C", 17.96], ["D", 5.07], ["F", 23.52]], L1: [["A", 24.49], ["F", 6.36]], L2: [["A", 7.78], ["C", 7.59], ["F", 8.87]], L3: [["A", 6.6], ["D", 21.52], ["F", 6.18]] } as Record<string, [string, number][]>;
  assert.deepEqual(run(three, [["B0", "p0", 4.64], ["B1", "p1", 4.32], ["B2", "p2", 0.41]], { A: 14, C: 0, D: 7, F: 11, B0: 21, B1: 19, B2: 21 }, { B0: "A", B1: "C", B2: "D" })[0], 66.99);
});

test("up to eight quoting shops, carriers and riders among them and printed parts beside: the quote is the cheapest of every way to give each part to a shop that quoted it", () => {
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const print = ([id, material, volumeCm3]: Print) => ({ id, name: id, role: id, process: "print", qtyPerUnit: 1, spec: { material, volumeCm3 }, file: `fab/${id}.stl` }) as BomLine;
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const buy = (id: string) => ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1, spec: {}, mpn: `M-${id}` }) as unknown as BomLine;
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `M-${id}`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" }) as Offer;
  type Quotes = Record<string, [string, number][]>;
  type Print = [string, string, number];
  /** Parts quoted by shops, printed parts priced from print rates, screws, shipping and who rides with whom. */
  type Cat = { quotes: Quotes; prints: Print[]; buys: [string, string, number][]; shipping: Record<string, number>; shipsWith: Record<string, string> };
  const run = (c: Cat, quotes = c.quotes) => {
    const ids = [...new Set(c.buys.map(([, id]) => id))];
    return quote(bom(...Object.keys(quotes).map(part), ...c.prints.map(print), ...ids.map(buy)),
      { slug: "lid", unsourced: [], lines: ids.map((id) => ({ lineId: id, offers: c.buys.filter(([, i]) => i === id).map(([s, i, usd]) => sells(s, i, usd)) })) } as Sourcing,
      { ...rates, shopQuotes: Object.fromEntries(Object.entries(quotes).map(([id, qs]) => [id, qs.map(([s, usd]) => at(s, id, usd))])) }, c.shipping, () => 1, { shipsWith: c.shipsWith });
  };
  const picked = (c: Cat) => {
    const q = run(c);
    return [q.batchUsd, ...[...Object.keys(c.quotes), ...c.prints.map(([id]) => id)].map((id) => q.lines.find((x) => x.lineId === id)!.supplier)];
  };
  // The least of every way: each part given only one of its quotes, every way, each such order priced by the quote.
  const everyWay = (c: Cat) => {
    const ids = Object.keys(c.quotes);
    const go = (i: number, one: Quotes): number => (i === ids.length ? run(c, one).batchUsd
      : Math.min(...c.quotes[ids[i]].map((x) => go(i + 1, { ...one, [ids[i]]: [x] }))));
    return go(0, {});
  };
  // Four carriers, each carrying a screw shop. Past three, the search tried only each carrier the set left unused
  // alone and all of them at once, each in turn taking the part that cost it least extra: L2 went to B, $101.72. With
  // L2 at C, R2's screw rides in C's parcel: $100.20.
  const four: Cat = { quotes: { L0: [["B", 26.96], ["D", 6.81]], L1: [["B", 11.14]], L2: [["A", 20.78], ["B", 13.93], ["C", 21.39]], L3: [["A", 13.01], ["B", 20.41], ["C", 16.66], ["D", 15.72]] },
    prints: [], buys: [["R0", "p0", 3.44], ["R1", "p1", 4.42], ["Z1", "p1", 1.68], ["R2", "p2", 0.33], ["R3", "p3", 2.96], ["Z3", "p3", 2.1]],
    shipping: { A: 1.65, B: 20.38, C: 12.75, D: 1.92, R0: 15.06, R1: 10.37, Z1: 15.7, R2: 21.73, R3: 20.46, Z3: 16.5 }, shipsWith: { R0: "A", R1: "B", R2: "C", R3: "D" } };
  assert.deepEqual(picked(four), [100.2, "D", "B", "C", "A"]);
  assert.equal(everyWay(four), 100.2);
  // A printed case beside two quoted parts, JLC3DP carrying JLCMC's screw. The base order has L1 at JLC3DP, so the
  // case was never tried there: $132.25, the case at Craftcloud. With the case at JLC3DP too: $122.22.
  const printed: Cat = { quotes: { L1: [["JLC3DP", 50], ["Weerg", 51]], L2: [["Weerg", 40]] }, prints: [["case", "PA12", 16]],
    buys: [["JLCMC", "scr", 1]], shipping: { JLC3DP: 5, Weerg: 20, JLCMC: 8 }, shipsWith: { JLCMC: "JLC3DP" } };
  assert.deepEqual(picked(printed), [122.22, "JLC3DP", "Weerg", "JLC3DP"]);
  assert.equal(everyWay(printed), 122.22);
  // Of ways that cost the same, one found later that moves more parts is not kept: in the set of B, C and D, D keeps
  // L2 rather than taking L1 from B for nothing, which would say L1 moved for a saving the move does not make.
  const tie: Cat = { quotes: { L0: [["A", 20], ["B", 15], ["D", 25], ["E", 15]], L1: [["B", 10], ["D", 10]], L2: [["A", 20], ["B", 20], ["C", 15], ["D", 10], ["E", 25]],
    L3: [["A", 5], ["B", 20], ["C", 20], ["D", 25], ["E", 20]] }, prints: [],
  buys: [["R0", "p0", 0], ["Z0", "p0", 0], ["R1", "p1", 0], ["Z1", "p1", 0], ["R2", "p2", 0], ["Z2", "p2", 5]],
  shipping: { A: 15, B: 5, C: 15, D: 15, E: 25, R0: 15, Z0: 20, R1: 25, Z1: 20, R2: 20, Z2: 15 }, shipsWith: { R0: "D", R1: "E", R2: "C" } };
  assert.deepEqual(picked(tie), [110, "B", "B", "D", "C"]);
  // And where an earlier carrier would take a part already at a later one: X takes L2 from Q, and L1 stays at Y,
  // rather than X taking L1 and Y then L2, two parts moved for the same $26.
  const stay: Cat = { quotes: { L1: [["Y", 10], ["X", 12]], L2: [["Q", 10], ["Y", 10], ["X", 12]] }, prints: [], buys: [["RX", "px", 1], ["RY", "py", 1]],
    shipping: { X: 1, Y: 1, Q: 1, RX: 20, RY: 20 }, shipsWith: { RX: "X", RY: "Y" } };
  assert.deepEqual(picked(stay), [26, "Y", "X"]);
  // And of ways that cost the same and move as many parts, the first found: F, the first carrier, takes L1 and G takes
  // L2, rather than the other way round for the same $26.
  const first: Cat = { quotes: { L1: [["X", 10], ["F", 11], ["G", 11]], L2: [["X", 10], ["F", 11], ["G", 11]] }, prints: [],
    buys: [["RF", "pf", 1], ["RG", "pg", 1]], shipping: { X: 1, F: 1, G: 1, RF: 20, RG: 20 }, shipsWith: { RF: "F", RG: "G" } };
  assert.deepEqual(picked(first), [26, "F", "G"]);
  // And where no shop carries another's: the set of A and the set of B each cost $26 and move one part, and neither
  // needs a line riding, so A's, found first, is kept.
  const tied: Cat = { quotes: { L0: [["A", 10], ["B", 11]], L1: [["B", 10], ["A", 11]] }, prints: [], buys: [], shipping: { A: 5, B: 5 }, shipsWith: {} };
  assert.deepEqual(picked(tied), [26, "A", "A"]);
  // Counted from the shop cheapest for each, not from the set's picks: in the set of B and Craftcloud, whose picks are
  // L0 and L1 at B, Craftcloud takes L0 (cheapest at A) and L1 stays at B, one part moved for $72, rather than L0 at B
  // and L1 at Craftcloud, two.
  const fewest: Cat = { quotes: { L0: [["JLC3DP", 20], ["Craftcloud", 20], ["A", 16], ["B", 18]], L1: [["JLC3DP", 27], ["Craftcloud", 16], ["B", 14]] }, prints: [],
    buys: [["R0", "p0", 0], ["R1", "p1", 4], ["R2", "p2", 3], ["R3", "p3", 3], ["Z3", "p3", 1]],
    shipping: { JLC3DP: 4, Craftcloud: 8, A: 19, B: 4, R0: 14, R1: 18, R2: 22, R3: 18, Z3: 0 }, shipsWith: { R0: "B", R1: "A", R2: "Craftcloud", R3: "JLC3DP" } };
  assert.deepEqual(picked(fewest), [72, "Craftcloud", "B"]);
  // Fewest moves decide between ways that free the same: C rides with E, so both take a part; E keeps L0, C takes L3
  // and R1's screw rides, $55.50, rather than E taking L1 from D as well for the same, a part more moved.
  const keep: Cat = { quotes: { L0: [["E", 5]], L1: [["D", 10], ["E", 10]], L2: [["B", 10]], L3: [["C", 15], ["B", 10]] }, prints: [["P0", "PA12", 27]],
    buys: [["R1", "p1", 0], ["R3", "p3", 5]], shipping: { JLC3DP: 0, Craftcloud: 0, B: 0, C: 0, D: 0, E: 0, R1: 20, R3: 15 },
    shipsWith: { R1: "C", R3: "JLC3DP", C: "E" } };
  assert.deepEqual(picked(keep), [55.5, "E", "D", "B", "C", "JLC3DP"]);
  // And between two sets' orders: L1 stays at JLC3DP and only L0 moves, rather than both at Craftcloud, the same $94.10.
  const between: Cat = { quotes: { L0: [["Craftcloud", 13], ["F", 10]], L1: [["JLC3DP", 25], ["Craftcloud", 30], ["F", 26]] }, prints: [["P0", "PETG", 43], ["P1", "PA12", 34]],
    buys: [["R0", "p0", 1], ["Z0", "p0", 2], ["R1", "p1", 1], ["Z1", "p1", 2], ["R2", "p2", 2]],
    shipping: { JLC3DP: 14, Craftcloud: 10, F: 21, R0: 9, Z0: 11, R1: 5, Z1: 9, R2: 8 }, shipsWith: { R0: "JLC3DP", R1: "F", R2: "Craftcloud" } };
  assert.deepEqual(picked(between), [94.1, "Craftcloud", "JLC3DP", "Craftcloud", "Craftcloud"]);
  // A quoting shop riding with a print service, as JLCCNC can with JLC3DP: with L1 at JLCCNC, the case goes to JLC3DP
  // and JLCCNC's parcel rides in it, $29.22. Every set gave L1 to A, its cheapest, so nothing rode with JLC3DP and the
  // case stayed at Craftcloud: $34.
  const rider: Cat = { quotes: { L1: [["JLCCNC", 10], ["A", 8]], L2: [["A", 5]] }, prints: [["P0", "PA12", 16]], buys: [],
    shipping: { A: 5, JLC3DP: 3, Craftcloud: 10, JLCCNC: 20 }, shipsWith: { JLCCNC: "JLC3DP" } };
  assert.deepEqual(picked(rider), [29.22, "JLCCNC", "A", "JLC3DP"]);
  assert.equal(everyWay(rider), 29.22);
  // A made line rides there, so the order needs no bought line riding (needsRider).
  assert.equal(run(rider).needsRider, undefined);
  // A print moves to a carrier only where a line then rides with it (quote.test.ts, "a fab that would carry no bought
  // line doesn't take the print"), and so on a set's try that gives another carrier, B, a part: where R2 sells nothing
  // here, no line rides with JLC3DP, so the case stays at Craftcloud, $40.50. Where R2 sells p2, Z2's is cheaper, but
  // R2's, $0.50 more, rides with JLC3DP and the case goes there, $33.23; before 2026-11-21 the quote bought Z2's, so
  // nothing rode there and the case stayed at Craftcloud, $40.50.
  const riding: Cat = { quotes: { L0: [["B", 7], ["C", 5.5]] }, prints: [["P0", "PA12", 25]],
    buys: [["R0", "p0", 1.5], ["Z0", "p0", 1], ["R1", "p1", 4], ["R2", "p2", 3.5], ["Z2", "p2", 3]],
    shipping: { A: 3.5, B: 3.5, C: 14.5, JLC3DP: 3, Craftcloud: 13, R0: 1, Z0: 12, R1: 13.5, R2: 9.5, Z2: 0 }, shipsWith: { R0: "A", R1: "B", R2: "JLC3DP" } };
  assert.deepEqual(picked({ ...riding, buys: riding.buys.filter(([s]) => s !== "R2") }), [40.5, "B", "Craftcloud"]);
  assert.deepEqual(picked(riding), [33.23, "B", "JLC3DP"]);
  assert.deepEqual([run(riding).lines.find((x) => x.lineId === "p2")?.shipsWith, run(riding).needsRider], ["JLC3DP", "JLC3DP"]);
  assert.equal(everyWay(riding), 33.23);
  // S's p2, $0.20 dearer than Z2's, rides with JLC3DP too, but for $0 of its own shipping, which riding saves none, so
  // no line of it rides there: R2's is bought still, $33.23.
  const free: Cat = { ...riding, buys: [...riding.buys, ["S", "p2", 3.2]], shipping: { ...riding.shipping, S: 0 }, shipsWith: { ...riding.shipsWith, S: "JLC3DP" } };
  assert.deepEqual(picked(free), [33.23, "B", "JLC3DP"]);
  assert.equal(run(free).lines.find((x) => x.lineId === "p2")?.supplier, "R2");
  // Where a made line rides with the fab, no bought line need: JLCCNC's L1 rides with JLC3DP, so the screw is Z's, $1
  // with no shipping, not JLCMC's, riding there too at $3.50 ($30.72, L1 then at A).
  const madeRides: Cat = { ...rider, buys: [["Z", "b1", 1], ["JLCMC", "b1", 3.5]], shipping: { ...rider.shipping, Z: 0, JLCMC: 8 },
    shipsWith: { ...rider.shipsWith, JLCMC: "JLC3DP" } };
  assert.deepEqual([...picked(madeRides), run(madeRides).lines.find((x) => x.lineId === "b1")?.supplier, run(madeRides).needsRider],
    [30.22, "JLCCNC", "A", "JLC3DP", "Z", undefined]);
  // Of two buying JLCMC's or R2's screw to ride with JLC3DP, the cheaper with shipping: R2's ($15.23), not JLCMC's,
  // the first by line ($16.73). With A's shipping at $0.45, JLCMC's $1.50 screw with B's ($15.23), not R2's $1.40 one
  // with A's, $0.10 less before A's shipping ($15.58).
  const twoMixes: Cat = { quotes: {}, prints: [["P0", "PA12", 25]], buys: [["A", "b1", 1], ["JLCMC", "b1", 3], ["B", "b2", 1], ["R2", "b2", 1.5]],
    shipping: { JLC3DP: 3, Craftcloud: 13, A: 0, B: 0, JLCMC: 20, R2: 20 }, shipsWith: { JLCMC: "JLC3DP", R2: "JLC3DP" } };
  const sellers = (c: Cat) => ["b1", "b2"].map((id) => run(c).lines.find((x) => x.lineId === id)?.supplier);
  assert.deepEqual([run(twoMixes).batchUsd, ...sellers(twoMixes)], [15.23, "A", "R2"]);
  const shipped: Cat = { ...twoMixes, buys: [["A", "b1", 1], ["JLCMC", "b1", 1.5], ["B", "b2", 1], ["R2", "b2", 1.4]], shipping: { ...twoMixes.shipping, A: 0.45 } };
  assert.deepEqual([run(shipped).batchUsd, ...sellers(shipped)], [15.23, "JLCMC", "B"]);
  // L0 costs less at F, $11 and $1 shipping, than at A, $10 and $10, in a set of no fab as in F's own try, and R's
  // screw, riding with F, is as cheap as Z's: the same order, $30, holds with no line riding, so it needs none (it used
  // to say it did, so a pick of Z's b bought R's $3 b2 to ride there).
  const atFab: Cat = { quotes: { L0: [["A", 10], ["F", 11]], L1: [["B", 10]] }, prints: [], buys: [["R", "b", 1], ["Z", "b", 1], ["R", "b2", 3], ["Y", "b2", 1]],
    shipping: { A: 10, B: 5, F: 1, R: 20, Z: 20, Y: 1 }, shipsWith: { R: "F" } };
  assert.deepEqual([...picked(atFab), run(atFab).needsRider], [30, "F", "B", undefined]);
  // Q's try and JLC3DP's weigh the bought lines' shops alike (L0 at Q and L1 at JLC3DP on both), but R2 rides with Q and
  // R1 with JLC3DP: each buys a line riding in its own fab's parcel, R1's p1 on JLC3DP's ($35.23), not the mix Q's
  // found first (R2's p2), with which nothing rides with JLC3DP and the order costs $45.50.
  const alike: Cat = { quotes: { L0: [["A", 10], ["Q", 10.5]], L1: [["A", 10], ["JLC3DP", 10.5]] }, prints: [["P0", "PA12", 25]],
    buys: [["R1", "p1", 1.5], ["Z", "p1", 1], ["R2", "p2", 1.5], ["Z", "p2", 1]],
    shipping: { A: 20, Q: 1, JLC3DP: 1, Craftcloud: 13, R1: 5, R2: 5, Z: 0 }, shipsWith: { R2: "Q", R1: "JLC3DP" } };
  assert.deepEqual([...picked(alike), run(alike).lines.find((x) => x.lineId === "p1")?.supplier, run(alike).needsRider], [35.23, "Q", "JLC3DP", "JLC3DP", "R1", "JLC3DP"]);
  assert.equal(everyWay(alike), 35.23);
  // JLCCNC quotes L0, rides with JLC3DP and has no figure in catalog.json: as it sends a quoted part, that is no known
  // $0 of its own, so L0 rides there by itself and the order needs no bought line riding (read as a print service's
  // figure, $0, it said it did, and the page, with a pick of Y's b0, bought JLCMC's b1 to ride, $0.50 more than `sprue
  // pick`).
  const quotedRides: Cat = { quotes: { L0: [["JLCCNC", 10]] }, prints: [["P0", "PA12", 23]],
    buys: [["Y", "b0", 0.61], ["JLCMC", "b0", 1.61], ["Y", "b1", 0.5], ["JLCMC", "b1", 1]],
    shipping: { JLC3DP: 5.32, Craftcloud: 10.38, Y: 9.4, JLCMC: 8 }, shipsWith: { JLCCNC: "JLC3DP", JLCMC: "JLC3DP" } };
  assert.deepEqual([...picked(quotedRides), run(quotedRides).lines.find((x) => x.lineId === "L0")?.shipsWith, run(quotedRides).needsRider], [26.88, "JLCCNC", "JLC3DP", "JLC3DP", undefined]);
  // A made line riding in another fab's parcel is not one riding in this fab's: JLCCNC's L0 rides with B, and the case
  // is at JLC3DP only for R's c riding there, so the order needs that line (with it read as riding anywhere, it said it
  // didn't, and the page, with a pick of Y's c, kept Z's b, $0.50 under `sprue pick`, which buys R's b to ride).
  const elsewhere: Cat = { quotes: { L0: [["JLCCNC", 10], ["A", 9]], L1: [["B", 10]] }, prints: [["P0", "PA12", 25]],
    buys: [["Z", "b", 1], ["R", "b", 1.5], ["Y", "c", 1], ["R", "c", 1.3]],
    shipping: { JLCCNC: 20, A: 15, B: 5, JLC3DP: 3, Craftcloud: 13, Z: 0, Y: 0, R: 8 }, shipsWith: { JLCCNC: "B", R: "JLC3DP" } };
  const away = run(elsewhere);
  assert.deepEqual([...picked(elsewhere), ...["b", "c"].map((id) => away.lines.find((x) => x.lineId === id)?.supplier),
    away.lines.find((x) => x.lineId === "L0")?.shipsWith, away.needsRider], [40.03, "JLCCNC", "B", "JLC3DP", "Z", "R", "B", "JLC3DP"]);
  // Random catalogs (seeded, so the same each run): two to eight shops, JLC3DP and Craftcloud among them now and then,
  // each part quoted by some of them; up to two printed parts; one to eight carriers, most of them shops that quote,
  // each carrying a screw shop, and half the screws sold too by a shop that rides with none, now and then cheaper and
  // with no shipping; and now and then a quoting shop riding with a print service or another quoting shop.
  // Seed 14's 40: the search before 2026-11-19 fails 8 of them, each way priced by it (7 dearer than the cheapest way,
  // 1 cheaper by counting a print at a fab nothing rode with), every set of only seven shops 2, each idle carrier alone
  // and all at once 1, and no try of a print alone at a carrier 3.
  let seed = 14;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cents = (x: number) => Math.round(x * 100) / 100;
  const POOL = ["JLC3DP", "Craftcloud", "A", "B", "C", "D", "E", "F"];
  for (let n = 0; n < 40; n++) {
    const pool = [...POOL].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 7));
    const quotes: Quotes = {};
    for (let i = 0, parts = 2 + Math.floor(rnd() * 3); i < parts; i++) {
      const by = pool.filter(() => rnd() < 0.55);
      quotes[`L${i}`] = (by.length ? by : [pool[i % pool.length]]).map((s) => [s, cents(5 + rnd() * 25)]);
    }
    const prints: Print[] = [];
    for (let i = 0, k = Math.floor(rnd() * 3); i < k; i++) prints.push([`P${i}`, rnd() < 0.7 ? "PA12" : "PETG", Math.round(5 + rnd() * 40)]);
    const quoting = [...new Set(Object.values(quotes).flat().map(([s]) => s))];
    const cands = [...new Set([...quoting, ...(rnd() < 0.3 ? ["JLC3DP", "Craftcloud"] : [])])].sort(() => rnd() - 0.5);
    const carriers = cands.slice(0, Math.min(cands.length, 1 + Math.floor(rnd() * 8)));
    const c: Cat = { quotes, prints, buys: [], shipping: {}, shipsWith: {} };
    carriers.forEach((f, k) => {
      c.shipsWith[`R${k}`] = f;
      c.buys.push([`R${k}`, `p${k}`, cents(rnd() * 5)]);
      if (rnd() < 0.5) c.buys.push([`Z${k}`, `p${k}`, cents(1 + rnd() * 5)]);
    });
    for (const s of POOL) c.shipping[s] = cents(rnd() * 25);
    for (const [s] of c.buys) c.shipping[s] = cents(5 + rnd() * 20);
    for (const x of c.buys) if (x[0].startsWith("Z") && rnd() < 0.3) [x[2], c.shipping[x[0]]] = [cents(rnd() * 2), 0];
    for (const q of quoting) if (rnd() < 0.25) {
      const to = ["JLC3DP", "Craftcloud", ...quoting].filter((f) => f !== q && c.shipsWith[f] !== q);
      c.shipsWith[q] = to[Math.floor(rnd() * to.length)];
    }
    const got = run(c).batchUsd, least = everyWay(c);
    assert.ok(Math.abs(got - least) < 1e-6, `catalog ${n}: the quote is $${got}, the least of every way $${least}`);
  }
  // A shop that quotes a part also sells the nut: the order that sends it the part pays its shipping already, so the
  // nut comes from it at $1 with the bracket, $113.50, where the bracket at Weerg and the nut there or at Bolt come to
  // $122 or $129. Weighing the shops' shipping again for the nut, the quote bought it at Bolt: $121.50.
  const maker: Cat = { quotes: { L0: [["Weerg", 100], ["JLCCNC", 100.5]] }, prints: [], buys: [["JLCCNC", "nut", 1], ["Bolt", "nut", 1], ["Weerg", "nut", 2]],
    shipping: { Weerg: 20, JLCCNC: 12, Bolt: 8 }, shipsWith: {} };
  assert.deepEqual(picked(maker), [113.5, "JLCCNC"]);
  assert.equal(run(maker).lines.find((x) => x.lineId === "nut")?.supplier, "JLCCNC");
  assert.equal(everyWay(maker), 113.5);
  // The cheapest screws can leave nothing riding in a fab's parcel where dearer ones would. L0 at Y, its cheapest, and
  // the case at JLC3DP: the screws cost least at Z ($12 for b1 and b2 with Z's shipping), so nothing rides with
  // JLC3DP and that order counts for nothing; JLCMC's b1, riding there, and X's b2 cost $13 with X's shipping, and
  // then it counts: $56.48. Before 2026-11-21 the quote was $59.25, the case at Craftcloud and the screws at Z.
  const paidRider: Cat = { quotes: { L0: [["X", 10], ["Y", 9.5]], L1: [["Y", 10]] }, prints: [["P0", "PA12", 25]],
    buys: [["JLCMC", "b1", 5], ["Z", "b1", 1], ["X", "b2", 1], ["Z", "b2", 1], ["JLC3DP", "b3", 1], ["Z", "b3", 5]],
    shipping: { X: 7, Y: 5, Z: 10, JLCMC: 20, JLC3DP: 8.25 }, shipsWith: { JLCMC: "JLC3DP" } };
  assert.deepEqual(picked(paidRider), [56.48, "Y", "Y", "JLC3DP"]);
  assert.deepEqual(["b1", "b2", "b3"].map((id) => run(paidRider).lines.find((x) => x.lineId === id)?.supplier), ["JLCMC", "X", "JLC3DP"]);
  assert.equal(everyWay(paidRider), 56.48);
  // Random catalogs as above (seed 21), but the shops that quote, and the print services, now and then sell a screw
  // too, and Craftcloud now and then has no figure in catalog.json (its print rates' then counts): the quote is still
  // the least of every way, each way's screws bought as the quote buys them (the catalogs below check that too).
  seed = 21;
  for (let n = 0; n < 40; n++) {
    const pool = [...POOL].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 7));
    const quotes: Quotes = {};
    for (let i = 0, parts = 2 + Math.floor(rnd() * 3); i < parts; i++) {
      const by = pool.filter(() => rnd() < 0.55);
      quotes[`L${i}`] = (by.length ? by : [pool[i % pool.length]]).map((s) => [s, cents(5 + rnd() * 25)]);
    }
    const prints: Print[] = [];
    for (let i = 0, k = Math.floor(rnd() * 3); i < k; i++) prints.push([`P${i}`, rnd() < 0.7 ? "PA12" : "PETG", Math.round(5 + rnd() * 40)]);
    const quoting = [...new Set(Object.values(quotes).flat().map(([s]) => s))];
    const cands = [...new Set([...quoting, ...(rnd() < 0.3 ? ["JLC3DP", "Craftcloud"] : [])])].sort(() => rnd() - 0.5);
    const carriers = cands.slice(0, Math.min(cands.length, 1 + Math.floor(rnd() * 8)));
    const c: Cat = { quotes, prints, buys: [], shipping: {}, shipsWith: {} };
    carriers.forEach((f, k) => {
      c.shipsWith[`R${k}`] = f;
      c.buys.push([`R${k}`, `p${k}`, cents(rnd() * 5)]);
      if (rnd() < 0.5) c.buys.push([`Z${k}`, `p${k}`, cents(1 + rnd() * 5)]);
    });
    for (const s of POOL) c.shipping[s] = cents(rnd() * 25);
    for (const [s] of c.buys) c.shipping[s] = cents(5 + rnd() * 20);
    const makers = [...quoting, "JLC3DP", "Craftcloud"];
    carriers.forEach((_, k) => { if (rnd() < 0.6) c.buys.push([makers[Math.floor(rnd() * makers.length)], `p${k}`, cents(rnd() * 6)]); });
    if (rnd() < 0.3) c.shipping = Object.fromEntries(Object.entries(c.shipping).filter(([s]) => s !== "Craftcloud"));
    for (const q of quoting) if (rnd() < 0.25) {
      const to = ["JLC3DP", "Craftcloud", ...quoting].filter((f) => f !== q && c.shipsWith[f] !== q);
      c.shipsWith[q] = to[Math.floor(rnd() * to.length)];
    }
    const got = run(c).batchUsd, least = everyWay(c);
    assert.ok(Math.abs(got - least) < 1e-6, `catalog ${n} (seed 21): the quote is $${got}, the least of every way $${least}`);
  }
  // And against every way to give each part a shop that quoted it and each screw one of its sellers, each priced by
  // the quote with only that one for each: smaller random catalogs (seed 31), a print beside now and then, the shops
  // that quote, JLCMC (riding with JLC3DP), a shop riding with a quoting shop and the print services selling screws,
  // shipping now and then $0, and Craftcloud now and then with no figure. Before 2026-11-21 the quote was dearer on
  // 22 of them.
  const everyOffer = (c: Cat) => {
    const ids = Object.keys(c.quotes), screws = [...new Set(c.buys.map(([, id]) => id))];
    const go = (i: number, one: Quotes, sold: Cat["buys"]): number => (i < ids.length
      ? Math.min(...c.quotes[ids[i]].map((x) => go(i + 1, { ...one, [ids[i]]: [x] }, sold)))
      : i - ids.length < screws.length ? Math.min(...c.buys.filter(([, id]) => id === screws[i - ids.length]).map((b) => go(i + 1, one, [...sold, b])))
        : run({ ...c, buys: sold }, one).batchUsd);
    return go(0, {}, []);
  };
  seed = 31;
  for (let n = 0; n < 80; n++) {
    const shops = ["X", "Y", "JLCCNC", "JLC3DP", "Craftcloud"].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 2));
    const quotes: Quotes = {};
    for (let i = 0, parts = 1 + Math.floor(rnd() * 2); i < parts; i++) {
      const by = shops.filter(() => rnd() < 0.6);
      quotes[`L${i}`] = (by.length ? by : [shops[i % shops.length]]).map((s) => [s, cents(5 + rnd() * 25)]);
    }
    const quoting = [...new Set(Object.values(quotes).flat().map(([s]) => s))];
    const prints: Print[] = rnd() < 0.7 ? [["P0", rnd() < 0.7 ? "PA12" : "PETG", Math.round(5 + rnd() * 40)]] : [];
    const sellers = [...quoting, "JLCMC", "R", "Z", "JLC3DP", "Craftcloud"];
    const c: Cat = { quotes, prints, buys: [], shipping: {}, shipsWith: { JLCMC: "JLC3DP", R: quoting[Math.floor(rnd() * quoting.length)] } };
    for (let i = 0, k = 1 + Math.floor(rnd() * 3); i < k; i++)
      for (const s of new Set([sellers[Math.floor(rnd() * sellers.length)], ...(rnd() < 0.6 ? ["Z"] : []), ...(rnd() < 0.4 ? ["JLCMC"] : []), ...(rnd() < 0.4 ? [quoting[Math.floor(rnd() * quoting.length)]] : [])]))
        c.buys.push([s, `b${i}`, cents(rnd() < 0.15 ? 0 : rnd() * 6)]);
    for (const s of ["X", "Y", "JLCCNC", "JLC3DP", "Craftcloud", "JLCMC", "R", "Z"]) c.shipping[s] = rnd() < 0.12 ? 0 : cents(rnd() * 25);
    if (!quoting.includes("Craftcloud") && rnd() < 0.3) c.shipping = Object.fromEntries(Object.entries(c.shipping).filter(([s]) => s !== "Craftcloud"));
    const got = run(c).batchUsd, least = everyOffer(c);
    assert.ok(Math.abs(got - least) < 1e-6, `catalog ${n} (seed 31): the quote is $${got}, the least of every way and every seller $${least}`);
  }
});

test("past eight quoting shops, each one and each two of a set's carriers still take a part", () => {
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const buy = (id: string) => ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1, spec: {}, mpn: `M-${id}` }) as unknown as BomLine;
  const sells = (supplier: string, id: string) => ({ lineId: id, offers: [{ supplier, sku: `${supplier}-${id}`, mpn: `M-${id}`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd: 1 }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" } as Offer] });
  // Nine quoting shops. The base order has L1 at E and L3 at B; the set of those two and A has three carriers for two
  // parts, so not every one of them can take one, but A and B can: L1 at A and L3 at B, three screws riding, $54.11.
  const F = ["F1", "F2", "F3", "F4", "F5", "F6"];
  const shopQuotes = { L1: [at("E", "L1", 6.34), at("A", "L1", 21.57), ...F.map((f) => at(f, "L1", 50))], L3: [at("B", "L3", 9.36), at("A", "L3", 13.22), at("E", "L3", 23.1)] };
  const q = quote(bom(part("L1"), part("L3"), ...["p0", "p1", "p2", "p4"].map(buy)), { slug: "lid", unsourced: [], lines: [sells("R0", "p0"), sells("R1", "p1"), sells("R2", "p2"), sells("R4", "p4")] } as Sourcing,
    { ...rates, shopQuotes }, { A: 0, B: 0, E: 17.24, ...Object.fromEntries(F.map((f) => [f, 5])), R0: 14.53, R1: 24.35, R2: 19.18, R4: 18.76 }, () => 1,
    { shipsWith: { R0: "A", R4: "A", R1: "B", R2: "E" } });
  assert.deepEqual([q.batchUsd, q.lines.find((x) => x.lineId === "L1")!.supplier, q.lines.find((x) => x.lineId === "L3")!.supplier], [54.11, "A", "B"]);
  // Past eight, a carrier's try still moves a quoted part there too, as before: with L0 and L2 at JLC3DP beside the
  // printed case, R1's screw riding, $102.39; with only the case and L2 there, $109.39.
  const nine = { L0: [at("JLC3DP", "L0", 22), at("A", "L0", 6)], L1: [at("C", "L1", 16)], L2: [at("JLC3DP", "L2", 13), at("Craftcloud", "L2", 9), at("D", "L2", 6)],
    L3: [at("B", "L3", 17), at("E", "L3", 14), at("F", "L3", 6), at("G", "L3", 16)] };
  const kase = { id: "P0", name: "P0", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PA12", volumeCm3: 19 }, file: "fab/P0.stl" } as BomLine;
  const r = quote(bom(...Object.keys(nine).map(part), kase, buy("p1")), { slug: "lid", unsourced: [], lines: [sells("R1", "p1")] } as Sourcing, { ...rates, shopQuotes: nine },
    { JLC3DP: 4, Craftcloud: 24, A: 23, B: 2, C: 10, D: 25, E: 11, F: 23, G: 7, R1: 9 }, () => 1, { shipsWith: { R1: "JLC3DP" } });
  assert.deepEqual([r.batchUsd, ...["L0", "L1", "L2", "L3", "P0"].map((id) => r.lines.find((x) => x.lineId === id)!.supplier)], [102.39, "JLC3DP", "C", "JLC3DP", "F", "JLC3DP"]);
  // Ten quoting shops: only JLC3DP alone taking a part, L1, beside the case moved there gives the cheapest, R0's screw
  // riding, $38.39; with L1 at B, $55.39.
  const ten = { L1: [at("B", "L1", 10), at("JLC3DP", "L1", 11), ...[...F, "F7"].map((f) => at(f, "L1", 50))], L3: [at("D", "L3", 10), at("JLC3DP", "L3", 30)] };
  const t = quote(bom(part("L1"), part("L3"), kase, buy("p0"), buy("p1")), { slug: "lid", unsourced: [], lines: [sells("R0", "p0"), sells("R1", "p1")] } as Sourcing,
    { ...rates, shopQuotes: ten }, { JLC3DP: 4, Craftcloud: 24, B: 20, D: 2, F7: 5, ...Object.fromEntries(F.map((f) => [f, 5])), R0: 9, R1: 2 }, () => 1,
    { shipsWith: { R0: "JLC3DP", R1: "B" } });
  assert.deepEqual([t.batchUsd, ...["L1", "L3", "P0"].map((id) => t.lines.find((x) => x.lineId === id)!.supplier)], [38.39, "JLC3DP", "D", "JLC3DP"]);
  // Of ways that cost the same, the one whose other parts' shops ship least: in the set of CC, X and Y, X takes L3 and
  // leaves L4 where it is, which frees CC ($30), rather than keeping L4 and leaving L3 at CC ($49).
  const tied = { L1: [at("CC", "L1", 8), at("Y", "L1", 8)], L3: [at("CC", "L3", 8), at("X", "L3", 8)], L4: [at("X", "L4", 10), ...F.map((f) => at(f, "L4", 50))] };
  const u = quote(bom(part("L1"), part("L3"), part("L4"), buy("px"), buy("py")), { slug: "lid", unsourced: [], lines: [sells("RX", "px"), sells("RY", "py")] } as Sourcing,
    { ...rates, shopQuotes: tied }, { CC: 19, X: 1, Y: 1, RX: 15, RY: 15, ...Object.fromEntries(F.map((f) => [f, 5])) }, () => 1, { shipsWith: { RX: "X", RY: "Y" } });
  assert.deepEqual([u.batchUsd, ...["L1", "L3", "L4"].map((id) => u.lines.find((x) => x.lineId === id)!.supplier)], [30, "Y", "X", "X"]);
  // So too where the carriers and the other shops the parts use come to nine (up to twelve): in the set of all nine
  // shops, S1 takes L3 and S12 takes L6, which frees S0 ($77), rather than S12 taking L4 and L6 staying at S1, a part
  // fewer moved for the same extra but S0's $20 still paid ($97).
  const freed = { L0: [at("S6", "L0", 14)], L1: [at("S8", "L1", 7)], L2: [at("S11", "L2", 9)], L3: [at("S0", "L3", 5), at("S1", "L3", 7)],
    L4: [at("S12", "L4", 12), at("S9", "L4", 8)], L5: [at("S7", "L5", 11)], L6: [at("S12", "L6", 8), at("S1", "L6", 6)], L7: [at("S10", "L7", 8)] };
  const priced = (supplier: string, id: string, unitUsd: number) => {
    const line = sells(supplier, id);
    return { ...line, offers: [{ ...line.offers[0], priceBreaks: [{ qty: 1, unitUsd }] }] };
  };
  const v = quote(bom(...Object.keys(freed).map(part), buy("p0"), buy("p4")), { slug: "lid", unsourced: [], lines: [priced("R0", "p0", 3), priced("R4", "p4", 2)] } as Sourcing,
    { ...rates, shopQuotes: freed }, { S0: 20, S1: 0, S6: 0, S7: 0, S8: 0, S9: 0, S10: 0, S11: 0, S12: 0, R0: 20, R4: 0 }, () => 1, { shipsWith: { R0: "S12", R4: "S1" } });
  assert.deepEqual([v.batchUsd, ...["L3", "L4", "L6"].map((id) => v.lines.find((x) => x.lineId === id)!.supplier)], [77, "S1", "S9", "S12"]);
  // A shop that rides in a parcel the order sends whatever the way frees nothing: P rides with Craftcloud, which prints
  // the PETG case, so in the set of the base's shops and JLC3DP, JLC3DP takes LQ, which frees Q's $10 ($64.25), rather
  // than LP for the same extra, which frees only P's own $20, paid by no one ($74.25).
  const rider = { LQ: [at("Q", "LQ", 10), at("JLC3DP", "LQ", 15)], LP: [at("P", "LP", 10), at("JLC3DP", "LP", 15)],
    L3: [at("G", "L3", 5), ...F.slice(0, 5).map((f) => at(f, "L3", 40))] };
  const pa12 = { ...kase, id: "caseA", spec: { material: "PA12", volumeCm3: 40 }, file: "fab/caseA.stl" } as BomLine;
  const petg = { ...kase, id: "caseB", spec: { material: "PETG", volumeCm3: 20 }, file: "fab/caseB.stl" } as BomLine;
  const w = quote(bom(...Object.keys(rider).map(part), pa12, petg, buy("s")), { slug: "lid", unsourced: [], lines: [sells("RC", "s")] } as Sourcing,
    { ...rates, shopQuotes: rider }, { Q: 10, P: 20, JLC3DP: 5, G: 0, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])), RC: 15 }, () => 1,
    { shipsWith: { RC: "JLC3DP", P: "Craftcloud" } });
  assert.deepEqual([w.batchUsd, ...["LQ", "LP"].map((id) => w.lines.find((x) => x.lineId === id)!.supplier)], [64.25, "JLC3DP", "P"]);
  // So too a shop riding with one of the carriers given a part: B rides with G, so in the set of the base's shops, H
  // and G, G taking L0 and H taking L1, which frees C ($62), beats G taking L2 for the same extra, which frees only B's
  // own $20, paid by no one ($67).
  const withG = { L0: [at("G", "L0", 20), at("H", "L0", 10)], L1: [at("C", "L1", 15), at("H", "L1", 20)],
    L2: [at("D", "L2", 10), at("B", "L2", 5), at("JLC3DP", "L2", 10), at("G", "L2", 20), at("J", "L2", 5)], L3: [at("F", "L3", 10), at("E", "L3", 15)] };
  const y = quote(bom(...Object.keys(withG).map(part), buy("p0"), buy("p2"), buy("p4")),
    { slug: "lid", unsourced: [], lines: [priced("R0", "p0", 1), priced("R2", "p2", 1), priced("R4", "p4", 5)] } as Sourcing, { ...rates, shopQuotes: withG },
    { B: 20, C: 5, D: 0, E: 0, F: 0, G: 0, H: 0, J: 0, JLC3DP: 0, R0: 20, R2: 0, R4: 20 }, () => 1, { shipsWith: { R0: "H", R2: "C", R4: "G", B: "G" } });
  assert.deepEqual([y.batchUsd, ...["L0", "L1", "L2"].map((id) => y.lines.find((x) => x.lineId === id)!.supplier)], [62, "G", "H", "B"]);
  // Yet where the print moves to JLC3DP, which R2 rides with, G no longer rides in Craftcloud's parcel: so on that try
  // the way giving D L2 as well frees G's $20 ($49.78), where the way for the base order's lines leaves L2 at G for
  // nothing, and any order with L2 at G costs $69.78 or more on that try.
  const onTry = { L0: [at("E", "L0", 10), at("B", "L0", 10)], L1: [at("D", "L1", 5), at("J", "L1", 20)],
    L2: [at("G", "L2", 10), at("JLC3DP", "L2", 25), at("D", "L2", 10), at("C", "L2", 15), at("F", "L2", 10), at("I", "L2", 15)] };
  const pa12b = { ...kase, id: "P1", spec: { material: "PA12", volumeCm3: 38 }, file: "fab/P1.stl" } as BomLine;
  const z = quote(bom(...Object.keys(onTry).map(part), pa12b, buy("p0"), buy("p2")),
    { slug: "lid", unsourced: [], lines: [priced("R0", "p0", 1), priced("R2", "p2", 5)] } as Sourcing, { ...rates, shopQuotes: onTry },
    { B: 0, C: 0, D: 0, E: 15, F: 0, G: 20, I: 0, J: 0, JLC3DP: 4, Craftcloud: 24, R0: 0, R2: 10 }, () => 1, { shipsWith: { R0: "D", R2: "JLC3DP", G: "Craftcloud" } });
  assert.deepEqual([z.batchUsd, ...["L2", "P1"].map((id) => z.lines.find((x) => x.lineId === id)!.supplier)], [49.78, "D", "JLC3DP"]);
  // A board fab is no parcel paid whatever the way, its shipping being in the board's price: in the set of A and
  // JLCPCB, A takes L0 as well as L1 for the same, which frees JLCPCB's $8 ($50), rather than L0 staying there ($58).
  const pcb = { id: "pcb", name: "pcb", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 82, heightMm: 40, layers: 2 } } as BomLine;
  const onBoard = { L0: [at("I", "L0", 10), at("JLCPCB", "L0", 15), at("A", "L0", 15), ...F.map((f) => at(f, "L0", 50))], L1: [at("A", "L1", 5)] };
  const k = quote(bom(part("L0"), part("L1"), pcb, buy("scr")), { slug: "lid", unsourced: [], lines: [sells("R", "scr")] } as Sourcing, { ...rates, shopQuotes: onBoard },
    { I: 20, JLCPCB: 8, A: 12, R: 10, ...Object.fromEntries(F.map((f) => [f, 5])) }, () => 1, { shipsWith: { R: "A" } });
  assert.deepEqual([k.batchUsd, ...["L0", "L1", "pcb"].map((id) => k.lines.find((x) => x.lineId === id)!.supplier)], [50, "A", "A", "JLCPCB"]);
  // Yet a shop riding with a board fab rides whatever the way: with P riding with JLCPCB, which makes the board, JLC3DP
  // takes LQ, which frees Q's $10 ($68.56), rather than LP for the same extra, which frees only P's own $20, paid by no
  // one ($78.56).
  const u2 = quote(bom(...Object.keys(rider).map(part), pa12, pcb, buy("s")), { slug: "lid", unsourced: [], lines: [sells("RC", "s")] } as Sourcing,
    { ...rates, shopQuotes: rider }, { Q: 10, P: 20, JLC3DP: 5, JLCPCB: 8, G: 0, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])), RC: 15 }, () => 1,
    { shipsWith: { RC: "JLC3DP", P: "JLCPCB" } });
  assert.deepEqual([u2.batchUsd, ...["LQ", "LP"].map((id) => u2.lines.find((x) => x.lineId === id)!.supplier)], [68.56, "JLC3DP", "P"]);
  // A set's ways are tie-broken for each try's own lines. On the try with the print at JLC3DP, which B rides with, H
  // takes L0 and B keeps L2, so a line still rides there and the try counts ($46.22); by the base order's lines H
  // takes L2, which frees B's $2 but on that try leaves nothing riding with JLC3DP, and the cheapest order without the
  // other way is $56.22.
  const keepB = { L0: [at("H", "L0", 15), at("J", "L0", 9)], L1: [at("O", "L1", 16), at("C", "L1", 11)],
    L2: [at("H", "L2", 16), at("B", "L2", 10), at("JLC3DP", "L2", 13), at("G", "L2", 11), at("F", "L2", 15), at("I", "L2", 11)] };
  const pa16 = { ...kase, spec: { material: "PA12", volumeCm3: 16 } } as BomLine;
  const keepIt = (more: BomLine[], sold: ReturnType<typeof priced>[], ship: Record<string, number | undefined>, rides: Record<string, string>) => {
    const r = quote(bom(...Object.keys(keepB).map(part), pa16, buy("p0"), buy("p1"), ...more),
      { slug: "lid", unsourced: [], lines: [priced("R0", "p0", 1), priced("R1", "p1", 3), ...sold] } as Sourcing, { ...rates, shopQuotes: keepB },
      { R0: 16, B: 2, Craftcloud: 15, H: 0, J: 0, O: 0, C: 0, G: 0, F: 0, I: 0, JLC3DP: 0, R1: 0, ...ship } as Record<string, number>, () => 1,
      { shipsWith: { R0: "H", R1: "J", B: "JLC3DP", ...rides } });
    return [r.batchUsd, ...["L0", "L1", "L2", "P0"].map((id) => r.lines.find((x) => x.lineId === id)!.supplier)];
  };
  assert.deepEqual(keepIt([], [], {}, {}), [46.22, "H", "C", "B", "JLC3DP"]);
  // A shop's lines ride in a fab's parcel only where its own shipping is not 0, which riding saves none: so B still
  // keeps L2 where S, alone selling "s", rides with JLC3DP for $0 ($47.22), as does H, given a part ($46.22), or
  // JLCPCB, which makes the board and has no shipping figure, its shipping being in the board's price ($63.22). And
  // the way kept is the one keeping L2 at B, not the one keeping L0 at J, which rides with JLC3DP for $0 ($46.22), so
  // too where B has no shipping figure.
  assert.deepEqual(keepIt([buy("s")], [priced("S", "s", 1)], { S: 0 }, { S: "JLC3DP" }), [47.22, "H", "C", "B", "JLC3DP"]);
  assert.deepEqual(keepIt([], [], {}, { H: "JLC3DP" }), [46.22, "H", "C", "B", "JLC3DP"]);
  assert.deepEqual(keepIt([pcb], [], {}, { JLCPCB: "JLC3DP" }), [63.22, "H", "C", "B", "JLC3DP"]);
  assert.deepEqual(keepIt([], [], {}, { J: "JLC3DP" }), [46.22, "H", "C", "B", "JLC3DP"]);
  assert.deepEqual(keepIt([], [], { B: undefined }, { J: "JLC3DP" }), [46.22, "H", "C", "B", "JLC3DP"]);
  // So too where the try moves the print away from the service that holds it in the base order: on the try with the
  // print at JLC3DP, Craftcloud no longer prints, so JLC3DP taking L0 from it frees its $19 ($67.34), where, Craftcloud
  // paid whatever the way as in the base order, JLC3DP keeps only L5 and the cheapest order found is $72.34.
  const freeCC = { L0: [at("Craftcloud", "L0", 10), at("JLC3DP", "L0", 10)], L3: [at("JLC3DP", "L3", 14), at("I", "L3", 9)],
    L4: [at("N", "L4", 12), at("K", "L4", 12), at("F", "L4", 12)], L5: [at("H", "L5", 12), at("T", "L5", 10), at("M", "L5", 8), at("JLC3DP", "L5", 12)], L6: [at("I", "L6", 14)] };
  const pa24 = { ...kase, spec: { material: "PA12", volumeCm3: 24 } } as BomLine;
  const fc = quote(bom(...Object.keys(freeCC).map(part), pa24, buy("p0")), { slug: "lid", unsourced: [], lines: [priced("R0", "p0", 1)] } as Sourcing,
    { ...rates, shopQuotes: freeCC }, { Craftcloud: 19, M: 14, R0: 1, JLC3DP: 0, I: 0, N: 0, K: 0, F: 0, H: 0, T: 0 }, () => 1, { shipsWith: { R0: "JLC3DP" } });
  assert.deepEqual([fc.batchUsd, ...["L0", "L3", "L5", "P0"].map((id) => fc.lines.find((x) => x.lineId === id)!.supplier)], [67.34, "JLC3DP", "I", "JLC3DP", "JLC3DP"]);
  // A shop paid whatever the way on a try frees nothing there: Craftcloud prints the case, so in the set of the base's
  // shops and X, X takes Lb, which frees M's $14 ($52), rather than La from Craftcloud for the same extra, which frees
  // nothing ($66).
  const paid = { La: [at("Craftcloud", "La", 10), at("X", "La", 11)], Lb: [at("M", "Lb", 10), at("X", "Lb", 11)],
    L2: [at("G", "L2", 5), at("X", "L2", 50), ...F.slice(0, 5).map((f) => at(f, "L2", 50))] };
  const pd = quote(bom(...Object.keys(paid).map(part), pa16, buy("p0")), { slug: "lid", unsourced: [], lines: [priced("R", "p0", 1)] } as Sourcing,
    { ...rates, shopQuotes: paid }, { Craftcloud: 19, M: 14, X: 0, G: 0, R: 5, JLC3DP: 5, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])) }, () => 1, { shipsWith: { R: "X" } });
  assert.deepEqual([pd.batchUsd, ...["La", "Lb", "L2"].map((id) => pd.lines.find((x) => x.lineId === id)!.supplier)], [52, "Craftcloud", "X", "G"]);
  // So too where it is paid whatever the way on some tries only: with R2 riding with JLC3DP, a try moves the case
  // there, yet on the base order's try X still takes Lb ($56), not La ($70).
  const pd2 = quote(bom(...Object.keys(paid).map(part), pa16, buy("p0"), buy("q2")),
    { slug: "lid", unsourced: [], lines: [priced("R", "p0", 1), priced("R2", "q2", 1)] } as Sourcing, { ...rates, shopQuotes: paid },
    { Craftcloud: 19, M: 14, X: 0, G: 0, R: 5, R2: 3, JLC3DP: 25, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])) }, () => 1, { shipsWith: { R: "X", R2: "JLC3DP" } });
  assert.deepEqual([pd2.batchUsd, ...["La", "Lb", "L2"].map((id) => pd2.lines.find((x) => x.lineId === id)!.supplier)], [56, "Craftcloud", "X", "G"]);
  // And a shop riding with a carrier given a part rides: C rides with B and B with I, so in the set of the base's shops
  // and I, I takes L2 from J and B keeps L3, which leaves C riding with B ($35), rather than I taking L3 and B L1 from
  // C for the same extra, which frees C's $25 that it never pays but leaves J's $15 ($50; the base order is $40).
  const chain = { L1: [at("B", "L1", 20), at("A", "L1", 15), at("C", "L1", 10), at("E", "L1", 30)], L2: [at("I", "L2", 15), at("J", "L2", 5)],
    L3: [at("D", "L3", 15), at("B", "L3", 10), at("G", "L3", 20), at("Craftcloud", "L3", 30), at("I", "L3", 10)] };
  const ch = quote(bom(...Object.keys(chain).map(part)), { slug: "lid", unsourced: [], lines: [] } as unknown as Sourcing, { ...rates, shopQuotes: chain },
    { A: 0, B: 0, C: 25, D: 0, E: 0, G: 0, I: 0, J: 15, Craftcloud: 0 }, () => 1, { shipsWith: { C: "B", B: "I" } });
  assert.deepEqual([ch.batchUsd, ...["L1", "L2", "L3"].map((id) => ch.lines.find((x) => x.lineId === id)!.supplier)], [35, "C", "I", "B"]);
  // A shop alone selling a bought line ships it whatever the way, so it frees nothing: Y alone sells "by", so in the
  // set of the base's shops and JLC3DP, JLC3DP takes L1, which frees X's $5 ($47), rather than L2 for the same extra,
  // which frees none of Y's $8 ($52).
  const sole = { L1: [at("X", "L1", 10), at("JLC3DP", "L1", 13)], L2: [at("Y", "L2", 10), at("JLC3DP", "L2", 13)],
    L3: [at("Z", "L3", 5), ...F.slice(0, 5).map((f) => at(f, "L3", 50))] };
  const pa30 = { ...kase, spec: { material: "PA12", volumeCm3: 30 } } as BomLine;
  const so = quote(bom(...Object.keys(sole).map(part), pa30, buy("scr"), buy("by")), { slug: "lid", unsourced: [], lines: [priced("RJ", "scr", 1), priced("Y", "by", 1)] } as Sourcing,
    { ...rates, shopQuotes: sole }, { X: 5, Y: 8, Z: 0, JLC3DP: 0, Craftcloud: 0, RJ: 20, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])) }, () => 1,
    { shipsWith: { RJ: "JLC3DP" } });
  assert.deepEqual([so.batchUsd, ...["L1", "L2", "L3"].map((id) => so.lines.find((x) => x.lineId === id)!.supplier)], [47, "JLC3DP", "Y", "Z"]);
  // So too where another shop's offer for the line has no price, as choose() leaves it out.
  const byTwo = { lineId: "by", offers: [...priced("Y", "by", 1).offers, ...priced("W", "by", NaN).offers] };
  const so2 = quote(bom(...Object.keys(sole).map(part), pa30, buy("scr"), buy("by")), { slug: "lid", unsourced: [], lines: [priced("RJ", "scr", 1), byTwo] } as Sourcing,
    { ...rates, shopQuotes: sole }, { X: 5, Y: 8, W: 0, Z: 0, JLC3DP: 0, Craftcloud: 0, RJ: 20, ...Object.fromEntries(F.slice(0, 5).map((f) => [f, 5])) }, () => 1,
    { shipsWith: { RJ: "JLC3DP" } });
  assert.deepEqual([so2.batchUsd, ...["L1", "L2", "L3"].map((id) => so2.lines.find((x) => x.lineId === id)!.supplier)], [47, "JLC3DP", "Y", "Z"]);
  // And a shop paid whatever the way on every try is left out of the shops the search keeps track of, up to twelve:
  // with thirteen quoting shops and Craftcloud printing the case, X takes Lb, which frees M's $14 ($139), rather than
  // La from Craftcloud, which frees nothing ($153 where Craftcloud is counted among them, making them thirteen, so
  // that no tie turns on shipping).
  const G = Array.from({ length: 9 }, (_, k) => `G${k + 1}`);
  const many = { Lb: [at("M", "Lb", 10), at("X", "Lb", 11)], La: [at("Craftcloud", "La", 10), at("X", "La", 11)], Ld: [at("Y", "Ld", 10), at("X", "Ld", 10.5)],
    ...Object.fromEntries(G.map((g, k) => [`L${k + 1}`, [at(g, `L${k + 1}`, 10)]])) };
  const petg20 = { ...kase, spec: { material: "PETG", volumeCm3: 20 } } as BomLine;
  const mn = quote(bom(...Object.keys(many).map(part), petg20, buy("p0"), buy("p1")),
    { slug: "lid", unsourced: [], lines: [priced("RX", "p0", 1), priced("RY", "p1", 1)] } as Sourcing, { ...rates, shopQuotes: many },
    { M: 14, Craftcloud: 10, X: 0, Y: 0, RX: 20, RY: 20, ...Object.fromEntries(G.map((g) => [g, 0])) }, () => 1, { shipsWith: { RX: "X", RY: "Y" } });
  assert.deepEqual([mn.batchUsd, ...["Lb", "La", "Ld"].map((id) => mn.lines.find((x) => x.lineId === id)!.supplier)], [139, "X", "Craftcloud", "Y"]);
});

test("past eight quoting shops, a set with many carriers still takes a moment", () => {
  // Twenty-two shops each quoting 24 parts, each the cheapest for some, each carried by the next: with all twenty-one
  // carriers of the set of every shop given a part at once, the search works through every set of them, about twenty
  // seconds and half a gigabyte, twice that with each shop more. Past eight it gives up to eight a part at once: a few
  // hundredths of a second.
  const shops = Array.from({ length: 22 }, (_, k) => `S${k}`), parts = Array.from({ length: 24 }, (_, i) => `L${i}`);
  const at = (shop: string, id: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-${id}`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] },
    { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined });
  const shopQuotes = Object.fromEntries(parts.map((id, i) => [id, shops.map((s, k) => at(s, id, k === i % 22 ? 5 : 10 + ((7 * i + 3 * k) % 21)))]));
  const scr = { id: "scr", name: "scr", role: "scr", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "M-scr" } as unknown as BomLine;
  const z = { supplier: "Z", sku: "Z-scr", mpn: "M-scr", url: "https://example.com/s", priceBreaks: [{ qty: 1, unitUsd: 1 }], stock: 100, leadDays: 3,
    source: "snapshot", capturedAt: "2026-11-16" } as Offer;
  const t = Date.now();
  const q = quote(bom(...parts.map((id) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine), scr),
    { slug: "lid", unsourced: [], lines: [{ lineId: "scr", offers: [z] }] } as Sourcing, { ...rates, shopQuotes },
    Object.fromEntries([...shops.map((s) => [s, 8]), ["Z", 4]]), () => 1, { shipsWith: Object.fromEntries(shops.slice(0, -1).map((s, k) => [s, shops[k + 1]])) });
  assert.equal(q.batchUsd, 133);
  assert.ok(Date.now() - t < 2_000, `${Date.now() - t} ms`);
});

test("the set search prices each different set of picks once, and again with a try's fab only where nothing rides there without it", () => {
  // 3 parts, each quoted by 6 shops in the same order of price; three shipsWith carriers among them, none carrying a
  // line here. Before, each set was priced again on top of every shipsWith try: 388 pricings for 9 different picks.
  // A carrier no shop here rides with is never worth a part, so none is tried: 11 reads, against 21 if they were.
  const part = (id: string) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine;
  const shops = ["A", "B", "C", "D", "E", "F"], parts = ["p1", "p2", "p3"];
  const shopQuotes = Object.fromEntries(parts.map((id, pi) => [id, shops.map((s, k) => weerg({ supplier: s, sku: `${s}-${id}`,
    priceBreaks: [{ qty: 20, shopTotal: 100 + 10 * k + pi, unitUsd: (100 + 10 * k + pi) / 20 }] }, { part: `fab/${id}.stl`, currency: "USD", usdPerEur: undefined }))]));
  const scr = { id: "scr", name: "scr", role: "scr", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "S1" } as unknown as BomLine;
  const offers = [{ lineId: "scr", offers: [{ supplier: "Bolts", sku: "S1", mpn: "S1", url: "https://example.com", priceBreaks: [{ qty: 1, unitUsd: 0.1 }],
    stock: "in stock", leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" } as Offer] }];
  let reads = 0;
  // priceWith reads sourcing.lines once for each bought line, one read a pricing, and the quote twice more: for the
  // shops that sell them, and for a shop that alone sells one.
  const sourcing = { slug: "lid", unsourced: [], get lines() { reads++; return offers; } } as unknown as Sourcing;
  const q = quote(bom(...parts.map(part), scr), sourcing, { ...rates, shopQuotes }, { A: 20, B: 20, C: 20, D: 20, E: 20, F: 20, Bolts: 5 },
    undefined, { shipsWith: { X1: "B", X2: "C", X3: "D" } });
  assert.deepEqual([q.batchUsd, ...parts.map((id) => q.lines.find((x) => x.lineId === id)!.supplier)], [330, "A", "A", "A"]);
  assert.ok(reads <= 12, `${reads} pricings`);
  // Where the three carriers carry a screw shop each, each set's carriers are given a part each, and still each
  // different set of picks is priced once with no fab, and again with C's or D's only where none of X2's or X3's screws
  // rides there priced without it: 29 reads here, 19 with no fab, 8 with a fab and 2 more (21 before 2026-11-21, which
  // priced none again).
  const carried = [{ lineId: "scr", offers: ["X1", "X2", "X3"].map((s) => ({ ...offers[0].offers[0], supplier: s, sku: `${s}-S1`, priceBreaks: [{ qty: 1, unitUsd: 0.1 }] })) }];
  let n = 0;
  const all = quote(bom(...parts.map(part), scr), { slug: "lid", unsourced: [], get lines() { n++; return carried; } } as unknown as Sourcing,
    { ...rates, shopQuotes }, { A: 20, B: 20, C: 20, D: 20, E: 20, F: 20, X1: 9, X2: 9, X3: 9 }, undefined, { shipsWith: { X1: "B", X2: "C", X3: "D" } });
  // A part at B costs $10 more and B's $20 shipping to save X1's $9: all at A, $334.
  assert.deepEqual([all.batchUsd, ...parts.map((id) => all.lines.find((x) => x.lineId === id)!.supplier)], [334, "A", "A", "A"]);
  assert.ok(n <= 29, `${n} pricings`);
});

test("a quoting shop whose total holds shipping keeps its $0 shipping line, with where it comes from", () => {
  const q = quote(bom(bracket), none, withQuotes(weerg()), { Weerg: 0 });
  const ship = q.lines.find((l) => l.lineId === "ship:Weerg");
  assert.ok(ship, "a ship:Weerg line");
  assert.equal(ship.orderUsd, 0);
  assert.match(ship.basis, /catalog\.json has no shippingBasis for this shop/);
  assert.equal(q.batchUsd, 526.43);

  // A 0 from riding in a fab's parcel (shipsWith) is not catalog.json's figure, so no line says it is, with or without
  // a figure of its own.
  const board = { id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 61, heightMm: 94, layers: 2 } } as BomLine;
  const notes = { shipsWith: { Weerg: "JLCPCB" }, read: ["Weerg"], basis: { Weerg: "€17.91 at Weerg's checkout" } };
  for (const shipping of [{ Weerg: 20 }, {}] as Record<string, number>[]) {
    const rode = quote(bom(bracket, board), none, withQuotes(weerg()), shipping, undefined, notes);
    assert.equal(rode.lines.find((l) => l.lineId === "board")?.supplier, "JLCPCB");
    assert.equal(rode.lines.find((l) => l.lineId === "ship:Weerg"), undefined, JSON.stringify(shipping));
    // The part says it rides, as a bought line does, and the build plan says to check out with the fab.
    const b = priced(rode)!;
    assert.equal(b.shipsWith, "JLCPCB");
    assert.match(b.basis, /; rides in the JLCPCB order's parcel, counted as no shipping of its own \(catalog\.json shipsWith, an estimate\)$/);
    assert.match(buildPlan({ product: "lid", brief: "a lid", units: 20 } as Request, { summary: "a lid" } as Design, bom(bracket, board),
      { checks: [], failed: 0, flagged: 0 } as unknown as Checks, rode, []),
      /Weerg ships in the JLCPCB parcel: order the Bracket in the same checkout as the JLCPCB order\./);
  }
  // A shop whose catalog.json shipping is 0 does not ride: its 0 is its own.
  assert.equal(priced(quote(bom(bracket, board), none, withQuotes(weerg()), { Weerg: 0 }, undefined, notes))!.shipsWith, undefined);
  // Nor does a print service whose rates.json shipping is 0 (JLC3DP): the bracket moved to JLCCNC for its own
  // shipping, not for the lid's.
  const at = (shop: string, usd: number) => weerg({ supplier: shop, sku: `${shop}-B`, priceBreaks: [{ qty: 1, shopTotal: usd, unitUsd: usd }] }, { currency: "USD", usdPerEur: undefined });
  const lid = (material: string) => ({ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 1, material }, file: "fab/lid.stl" }) as BomLine;
  const free = quote(bom(lid("PA12"), bracket), none, withQuotes(at("Weerg", 50), at("JLCCNC", 50.5)), { Weerg: 20, JLCCNC: 5 }, () => 1, { shipsWith: { JLC3DP: "JLCCNC" } });
  const l = free.lines.find((x) => x.lineId === "lid")!;
  assert.deepEqual([free.batchUsd, l.supplier, l.shipsWith, priced(free)!.supplier], [56.9, "JLC3DP", undefined, "JLCCNC"]);
  assert.doesNotMatch(l.basis, /rides in/);
  assert.match(priced(free)!.basis, /; chosen over Weerg \(\$50\.00\) because the order costs less with each shop's shipping counted$/);
  // Craftcloud's rates.json shipping is not 0: its print rides.
  const paid = quote(bom(lid("PETG"), bracket), none, withQuotes(at("Weerg", 50), at("JLCCNC", 50.5)), { Weerg: 20, JLCCNC: 5 }, () => 1, { shipsWith: { Craftcloud: "JLCCNC" } });
  assert.deepEqual(["Craftcloud", "JLCCNC"], [paid.lines.find((x) => x.lineId === "lid")!.supplier, paid.lines.find((x) => x.lineId === "lid")!.shipsWith]);
  // A shop rides whole: with JLC3DP's quote for the bracket in its order, its print at the rate rides too, though
  // rates.json's shipping for a print alone is 0, so the parcel holds every line of the shop.
  const whole = quote(bom(lid("PA12"), bracket, board), none, withQuotes(at("JLC3DP", 50)), {}, () => 1, { shipsWith: { JLC3DP: "JLCPCB" } });
  assert.deepEqual(["lid", "bracket"].map((id) => whole.lines.find((x) => x.lineId === id)).map((x) => [x!.supplier, x!.shipsWith]),
    [["JLC3DP", "JLCPCB"], ["JLC3DP", "JLCPCB"]]);
  // A shop riding with itself (catalog.json's checks refuse it) keeps its own shipping.
  assert.deepEqual(rideAlong({ JLC3DP: 8 }, { JLC3DP: "JLC3DP" }, new Set(["JLC3DP"])), { JLC3DP: 8 });
});

test("orders A and B each take their own count, as sprue quote splits a first-article run", () => {
  // As cli.ts quoteStage asks: order A the first 2 units' 4, order B what A did not buy.
  const a = quote(bom(bracket), none, withQuotes(weerg()), { Weerg: 20 }, () => 4);
  const got = priced(a)!.orderQty;
  const b = quote(bom(bracket), none, withQuotes(weerg()), { Weerg: 20 }, () => 41 - got);
  assert.deepEqual([priced(a)!.orderQty, priced(a)!.orderUsd, priced(b)!.orderQty, priced(b)!.orderUsd], [4, 133.98, 37, 495.73]);
  // A quote for the whole batch only: order A buys it all, and order B needs none.
  const only = withQuotes(weerg({ priceBreaks: [{ qty: 41, shopTotal: 471.5, unitUsd: 12.83975 }] }));
  const a1 = priced(quote(bom(bracket), none, only, { Weerg: 20 }, () => 4))!;
  assert.deepEqual([a1.needQty, a1.orderQty], [4, 41]);
  assert.equal(priced(quote(bom(bracket), none, only, { Weerg: 20 }, () => 41 - a1.orderQty)), undefined);
});

test("a shop's quote prices only its own part as it is now: another file, an earlier spec or another shop than the pin is no price", () => {
  const unpriced = (l: BomLine, ...offers: Offer[]) => {
    assert.deepEqual(quote(bom(l), none, withQuotes(...offers), { Weerg: 20 }).unquoted, ["bracket"], l.id);
    return whyUnpriced(l, withQuotes(...offers));
  };
  // Planted: the quote of another part.
  assert.match(unpriced(bracket, weerg({}, { part: "fab/lid.stl" })), /\(Weerg Q-1 is a quote for fab\/lid\.stl, not bracket's fab\/bracket\.stl\)/);
  // Planted: the spec changed since the shop quoted it, by key, then and now; the order of the keys is no change.
  const harder = { ...bracket, spec: { ...SPEC, material: "aluminium 7075-T6" } };
  assert.match(unpriced(harder, weerg()), /\(Weerg Q-1 was quoted for bom\.json's spec as it was \(material "aluminium 6061-T6", now "aluminium 7075-T6"\)\)/);
  const finished = { ...bracket, spec: { ...SPEC, finish: "anodised" } };
  assert.match(unpriced(finished, weerg()), /finish none, now "anodised"/);
  assert.equal(priced(quote(bom({ ...bracket, spec: { features: SPEC.features, material: SPEC.material } }), none, withQuotes(weerg()), { Weerg: 20 }))?.supplier, "Weerg");
  // Planted: a pin keeps only its shop's quotes, with nothing to fall back on.
  const jlc = weerg({ supplier: "JLCCNC", sku: "J-9" });
  assert.match(unpriced({ ...bracket, pin: { supplier: "Weerg" } }, jlc), /^bom\.json pins it to Weerg, and catalog\.json holds no quote from it that prices it: Sprue prices a CNC part/);
  assert.equal(priced(quote(bom({ ...bracket, pin: { supplier: "JLCCNC" } }), none, withQuotes(weerg(), jlc), { Weerg: 20, JLCCNC: 20 }))?.supplier, "JLCCNC");
  // A file sprue cad does not export can't be held to a quote.
  assert.match(unpriced({ ...bracket, file: "parts/bracket.step" }, weerg()), /^its file \(parts\/bracket\.step\) is not written in bom\.json as fab\/<part>\.step or \.stl, the path a shop's quote is held to/);
  assert.deepEqual([quotedFile(bracket), quotedFile({ file: "fab/top.stl" }), quotedFile({ file: "parts/x.step" })], ["fab/bracket.stl", "fab/top.stl", undefined]);
  // bom.json's path made regular, never looked up on disk: ./fab/x.step and fab//x.step are fab/x.step; a path out of
  // the product, or one only the disk resolves, is no file a quote can be held to.
  assert.deepEqual(["./fab/bracket.step", "fab//bracket.step", "fab/./bracket.stl", "fab/../fab/bracket.step", "fab\\bracket.step"].map((file) => quotedFile({ file })),
    Array(5).fill("fab/bracket.stl"));
  assert.deepEqual(["/home/x/fab/bracket.step", "../fab/bracket.step", "fab/sub/bracket.step", "fab/bracket.stp"].map((file) => quotedFile({ file })), Array(4).fill(undefined));
  assert.equal(priced(quote(bom({ ...bracket, file: "./fab/bracket.step" }), none, withQuotes(weerg()), { Weerg: 20 }))?.supplier, "Weerg");
});

test("an offer with no shopQuote prices no CNC part, and a shop's quote prices no plastic print", () => {
  // Planted: the offer the old hand-off had a person write, as a bought line, left on the made one.
  const plain: Offer = { supplier: "Weerg", sku: "Q-1", url: "https://www.weerg.com/x", priceBreaks: [{ qty: 41, unitUsd: 12.84 }], stock: "unknown", leadDays: 9, source: "snapshot", capturedAt: "2026-11-16" };
  assert.deepEqual(quote(bom(bracket), none, withQuotes(plain), {}).unquoted, ["bracket"]);
  assert.match(whyUnpriced(bracket, withQuotes(plain)), /^catalog\.json's offers for it \(offers\.bracket\) hold no shop's quote Sprue can read: .*, with the "shopQuote" its ORDER\.md gives$/);
  assert.match(whyUnpriced(bracket, rates), /^catalog\.json holds no shop's quote for it: Sprue prices a CNC part only from a shop's quote/);
  // A PETG print stays priced from rates.json, whatever catalog.json holds for it.
  const shell: BomLine = { id: "shell", name: "Shell", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PETG", volumeCm3: 5 }, file: "fab/shell.stl" } as BomLine;
  const opts = fabOptions(shell, 1, { ...rates, shopQuotes: { shell: [weerg({}, { part: "fab/shell.stl", spec: shell.spec })] } });
  assert.ok(opts.length && opts.every((o) => o.mode === "estimate" && !o.shopQuote), JSON.stringify(opts));
  // Which lines are priced from a shop's quote: CNC, sheet metal and a print in metal not made at home.
  const kinds: [Partial<BomLine>, boolean][] = [[{ process: "cnc" }, true], [{ process: "sheet" }, true], [{ process: "print", spec: { material: "AlSi10Mg" } }, true],
    [{ process: "print", spec: { material: "AlSi10Mg" }, pin: { supplier: "home" } }, false], [{ process: "print", spec: { material: "PETG" } }, false], [{ process: "pcb" }, false], [{ process: "buy" }, false]];
  for (const [l, want] of kinds) assert.equal(quotedPart({ ...bracket, spec: {}, ...l } as BomLine), want, JSON.stringify(l));
});

test("a shop's quote's shop with no shipping figure is named, print service or not", () => {
  // Planted: Weerg with no figure in catalog.json, which would count its shipping as $0 without a word.
  const q = quote(bom(bracket), none, withQuotes(weerg()), {});
  assert.deepEqual(q.noShipping, ["Weerg"]);
  assert.equal(q.lines.some((l) => l.lineId === "ship:Weerg"), false);
  // Planted: a print in metal quoted at JLC3DP, whose rates.json shipping ($0) is for its plastic prints.
  const hinge: BomLine = { id: "hinge", name: "Hinge", role: "hinge", process: "print", qtyPerUnit: 1, spec: { material: "AlSi10Mg", process: "SLM" }, file: "fab/hinge.stl" } as BomLine;
  const jlc = weerg({ supplier: "JLC3DP", sku: "M-1", priceBreaks: [{ qty: 20, shopTotal: 300, unitUsd: 16.7475 }] }, { part: "fab/hinge.stl", spec: hinge.spec });
  const m = quote(bom(hinge), none, { ...rates, shopQuotes: { hinge: [jlc] } }, {});
  assert.deepEqual([m.lines[0].supplier, m.noShipping], ["JLC3DP", ["JLC3DP"]]);
  // Craftcloud's rates.json shipping is for its plastic prints too: none is added for a quoted part.
  const cc = weerg({ supplier: "Craftcloud", sku: "C-1", priceBreaks: [{ qty: 20, shopTotal: 300, unitUsd: 16.7475 }] }, { part: "fab/hinge.stl", spec: hinge.spec });
  const c = quote(bom(hinge), none, { ...rates, shopQuotes: { hinge: [cc] } }, {});
  assert.deepEqual([c.noShipping, c.lines.some((l) => l.lineId === "ship:Craftcloud")], [["Craftcloud"], false]);
});

test("catalog.json says how a shop's quote is recorded wrong, each in its own words", () => {
  const problems = (o: Offer | Record<string, unknown>) => catalogProblems({ shipping: { Weerg: 20 }, offers: { bracket: [o] } }).problems;
  const at = "offers.bracket[0] (Weerg Q-1)";
  assert.deepEqual(problems(weerg()), []);
  // Planted: euros typed as dollars, the shop's €471.50 written as $11.50 a piece.
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 471.5, unitUsd: 11.5 }] })),
    [`${at}: priceBreaks[0] is 41 at $11.50 a piece, $471.50, but the shop's €471.50 for 41 at $1.1165 a euro (shopQuote.usdPerEur) is $526.43. If €471.50 is the shop's total for 41, write "unitUsd": 12.83975; if $11.50 a piece is right, the shop's total for 41 is €422.30: write "shopTotal": 422.30`]);
  // Planted: one sum written twice. Either the shop's €11.50 a piece went in as its total for 41 (and the unitUsd the
  // other message asks for would price the order at a 41st of what it costs), or the whole order went in as unitUsd:
  // only the shop's quote tells which, so both are named.
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 11.5, unitUsd: 12.83975 }] })),
    [`${at}: priceBreaks[0] gives one sum twice, €11.50 as shopTotal and $12.83975 as the price a piece: look at the shop's quote. If €11.50 is its total for 41, unitUsd was written as the whole order in dollars: write "unitUsd": 0.313165; if €11.50 is its price a piece, shopTotal must be its total for 41, before shipping: write "shopTotal": 471.50`]);
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 471.5, unitUsd: 526.43 }] })),
    [`${at}: priceBreaks[0] gives one sum twice, €471.50 as shopTotal and $526.43 as the price a piece: look at the shop's quote. If €471.50 is its total for 41, unitUsd was written as the whole order in dollars: write "unitUsd": 12.83975; if €471.50 is its price a piece, shopTotal must be its total for 41, before shipping: write "shopTotal": 19331.50`]);
  // At 1.1165 a euro and 1 piece no euro total comes to $10.01, so the message names no shopTotal it would refuse.
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 1, shopTotal: 89.7, unitUsd: 10.01 }] })),
    [`${at}: priceBreaks[0] is 1 at $10.01 a piece, $10.01, but the shop's €89.70 for 1 at $1.1165 a euro (shopQuote.usdPerEur) is $100.15. If €89.70 is the shop's total for 1, write "unitUsd": 100.15005; no total in euros comes to $10.01 a piece, so the unitUsd is the one to change`]);
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 1, shopTotal: 8.97, unitUsd: 10.01 }] })).length, 1);
  // A price a piece is shown as written, not rounded to the cent away from the figures beside it.
  assert.match(problems(weerg({ priceBreaks: [{ qty: 1, shopTotal: 50, unitUsd: 100.485 }] }))[0], /is 1 at \$100\.485 a piece, \$100\.49, but/);
  // Planted: the shop's total filled in and unitUsd left a placeholder 0: no shopTotal over 0 comes to $0.00 a piece,
  // so the message names none (it would be refused too).
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 3, shopTotal: 90, unitUsd: 0 }] })),
    [`${at}: priceBreaks[0] is 3 at $0.00 a piece, $0.00, but the shop's €90.00 for 3 at $1.1165 a euro (shopQuote.usdPerEur) is $100.49. If €90.00 is the shop's total for 3, write "unitUsd": 33.495; no total in euros over 0 comes to $0.00 a piece, so the unitUsd is the one to change`]);
  assert.doesNotMatch(problems(weerg({ priceBreaks: [{ qty: 1, shopTotal: 90, unitUsd: 0.001 }] }, { currency: "USD", usdPerEur: undefined }))[0], /"shopTotal": 0\.00/);
  // Planted: a placeholder 0 before the shop has quoted would price the part free.
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 0, unitUsd: 0 }] })),
    [`${at}: priceBreaks[0].shopTotal must be the shop's total for 41 pieces, over 0, before shipping, as its page showed it, not 0: leave the offer out until the shop has quoted`]);
  // A unit price rounded to the cent passes where the exact one ends in half a cent, either way and in binary floats:
  // €90 for 3 at 1.1165 is $33.495 a piece, $250.10 for 4 is $62.525.
  for (const unitUsd of [33.5, 33.49]) assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 3, shopTotal: 90, unitUsd }] })), [], `${unitUsd}`);
  for (const unitUsd of [62.53, 62.52]) assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 4, shopTotal: 250.1, unitUsd }] }, { currency: "USD", usdPerEur: undefined })), [], `${unitUsd}`);
  // A unit price rounded to the cent passes; the order's total typed as a unit price does not.
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 471.5, unitUsd: 12.84 }] })), []);
  assert.deepEqual(problems(weerg({ priceBreaks: [{ qty: 41, shopTotal: 500, unitUsd: 12.3 }] }, { currency: "USD", usdPerEur: undefined })),
    [`${at}: priceBreaks[0] is 41 at $12.30 a piece, $504.30, but the shop's $500.00 for 41 is $12.195122 a piece. If $500.00 is the shop's total for 41, write "unitUsd": 12.195122; if $12.30 a piece is right, the shop's total for 41 is $504.30: write "shopTotal": 504.30`]);
  const one = (o: Offer | Record<string, unknown>) => { const p = problems(o); assert.equal(p.length, 1, p.join("\n")); return p[0]; };
  const q = (quoted: Record<string, unknown>) => weerg({}, quoted as never);
  assert.equal(one(weerg({ shopQuote: "x" as never })), `${at}: shopQuote must be { part, sha256, spec, currency, usdPerEur, vat, expires }, as the part's ORDER.md gives it, not "x"`);
  assert.match(one(q({ quoteNo: 1 })), /shopQuote has a field nothing reads \("quoteNo"; the fields are part, sha256, spec, currency, usdPerEur, vat, expires\)$/);
  // The day it was read and the last day it holds: each a day on the calendar, the last not before the first.
  for (const expires of [undefined, "", "16/12/2026", "2026-12-32", "2026-02-29", "2026-12-16T00:00:00Z", 20261216, "not given"])
    assert.match(one(q({ expires })), /shopQuote\.expires must be the last day the shop's quote holds, as its page says \(YYYY-MM-DD\), or "not stated", not /, String(expires));
  assert.equal(one(q({ expires: "2026-11-15" })), `${at}: shopQuote.expires, 2026-11-15, is before capturedAt, 2026-11-16, the day the quote was read: write the last day the shop's quote says it holds`);
  for (const expires of ["2026-11-16", "2028-02-29", "not stated"]) assert.deepEqual(problems(q({ expires })), [], expires);
  for (const capturedAt of ["16 Nov 2026", "2026-11-31", "2026-11-16T09:00"])
    assert.equal(one(weerg({ capturedAt })), `${at}: a shop's quote's capturedAt must be the day you read it (YYYY-MM-DD), not ${JSON.stringify(capturedAt)}`);
  // A capturedAt that is no text at all is said once, as any offer's is, and the last day is not held to it.
  assert.deepEqual(problems(weerg({ capturedAt: "" })), [`${at}: capturedAt must be text, not ""`]);
  assert.match(one(q({ part: "fab/bracket.step" })), /shopQuote\.part must be the part's STL in fab\/ \(fab\/<part>\.stl\), as its ORDER\.md gives it, not "fab\/bracket\.step"$/);
  assert.match(one(q({ sha256: "a5707be7fcb5" })), /shopQuote\.sha256 must be the 64 hex digits its ORDER\.md gives for the part's STL, not "a5707be7fcb5"$/);
  assert.match(one(q({ spec: "6061" })), /shopQuote\.spec must be bom\.json's spec for the line as the shop priced it/);
  assert.match(one(q({ currency: "eur" })), /shopQuote\.currency must be "EUR" or "USD", the currency of the shop's totals, not "eur"$/);
  assert.match(one(q({ usdPerEur: undefined })), /a quote in euros needs shopQuote\.usdPerEur, .* between 0\.5 and 2, not nothing$/);
  assert.match(one(q({ usdPerEur: 11.165 })), /a quote in euros needs shopQuote\.usdPerEur/);
  assert.match(one(weerg({ priceBreaks: [{ qty: 41, shopTotal: 500, unitUsd: 500 / 41 }] }, { currency: "USD" })), /a quote in dollars takes no shopQuote\.usdPerEur: drop it$/);
  assert.match(one(q({ vat: "maybe" })), /shopQuote\.vat must be "excluded", "included" or "not stated", as the shop's quote shows its totals, not "maybe"$/);
  assert.match(one(weerg({ source: "api" })), /a shop's quote is read by a person, so its source is "snapshot" .* or "estimate" .*, not "api"$/);
  assert.match(one(weerg({ packSize: 10 })), /a shop's quote prices the pieces it was asked for, so it takes no packSize: drop it$/);
  // One mistake, one problem: not also the plain offer's own words for its source or packSize.
  assert.match(one(weerg({ source: undefined })), /a shop's quote is read by a person, so its source is "snapshot" .* or "estimate" .*, not nothing$/);
  assert.match(one(weerg({ packSize: 0 })), /so it takes no packSize: drop it$/);
  assert.match(one(weerg({ priceBreaks: [] })), /priceBreaks must list at least one \{ qty, unitUsd, shopTotal \}, not \[\]$/);
  assert.match(one(weerg({ priceBreaks: [{ qty: 37, unitUsd: 13.398 }] })), /priceBreaks\[0\]\.shopTotal must be the shop's total for 37 pieces, over 0, before shipping, as its page showed it, not nothing: leave the offer out until the shop has quoted$/);
  assert.match(one(weerg({ priceBreaks: [{ qty: 4, shopTotal: 120, unitUsd: 33.495 }, { qty: 4, shopTotal: 120, unitUsd: 33.495 }] })), /priceBreaks give two prices for 4: keep the one the shop's quote shows$/);
  const bare: Offer = { ...weerg(), shopQuote: undefined, priceBreaks: [{ qty: 41, shopTotal: 471.5, unitUsd: 12.84 }] };
  assert.match(one(bare), /priceBreaks\[0\] has shopTotal, which only a shop's quote for a made part \(an offer with its "shopQuote"\) reads: drop it, or add the shopQuote$/);
});

test("catalog.json's notes: a CNC part's quote is read, an offer with no shopQuote on it and a shopQuote on a bought line are not", () => {
  const screw = { id: "scr", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 4, spec: {} } as BomLine;
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PETG" }, file: "fab/lid.stl" } as BomLine;
  const plain = { ...weerg(), shopQuote: undefined, priceBreaks: [{ qty: 41, unitUsd: 12.84 }] };
  const notes = (offers: Record<string, unknown[]>) => catalogProblems({ shipping: {}, offers }, "catalog.json", bom(bracket, screw, lid)).notes;
  assert.deepEqual(notes({ bracket: [weerg()] }), []);
  assert.deepEqual(notes({ bracket: [plain] }), ["catalog.json: offers.bracket[0] (Weerg Q-1) has no shopQuote, so the quote prices nothing from it: bracket is made (cnc), and Sprue prices it only from a shop's quote recorded as fab/order/bracket/ORDER.md shows"]);
  assert.deepEqual(notes({ scr: [{ ...weerg(), priceBreaks: [{ qty: 4, shopTotal: 1, unitUsd: 0.279125 }] }] }), ["catalog.json: offers.scr[0] (Weerg Q-1) has a shopQuote, which only a CNC, sheet-metal or metal-printed part's quote carries, and scr is bought: the quote reads it as a plain offer, held to no file"]);
  assert.deepEqual(notes({ lid: [plain] }), ["catalog.json: offers for lid, which is made (print), not bought, so nothing reads them"]);
});

test("a shop's quote held until a day before today has lapsed, once each, from the one order or order A or B", () => {
  const line = (lineId: string, supplier: string, sku: string, expires?: string): QuoteLine => ({ lineId, supplier, sku, mode: "snapshot",
    orderQty: 1, orderUsd: 10, leadDays: 9, basis: "",
    ...(expires === undefined ? {} : { shopQuote: { part: `fab/${lineId}.stl`, sha256: SHA, currency: "USD" as const, vat: "excluded" as const, expires, total: 10, read: "2026-11-01" } }) });
  const quotes = {
    lines: [line("bracket", "Weerg", "Q-1", "2026-11-16"), line("plate", "JLCCNC", "J-1", "not stated"), line("cap", "Mouser", "M-1")],
    phases: [{ lines: [line("bracket", "Weerg", "Q-1", "2026-11-16"), line("bracket", "Weerg", "Q-0", "2026-11-10"), line("plate", "Laserboost", "L-1", "2026-11-17")] }],
  };
  // The last day it holds is the day itself: lapsed only from the day after.
  assert.deepEqual(lapsedQuotes(quotes, "2026-11-16"), [{ supplier: "Weerg", sku: "Q-0", lineId: "bracket", expires: "2026-11-10" }]);
  assert.deepEqual(lapsedQuotes(quotes, "2026-11-17"), [{ supplier: "Weerg", sku: "Q-1", lineId: "bracket", expires: "2026-11-16" },
    { supplier: "Weerg", sku: "Q-0", lineId: "bracket", expires: "2026-11-10" }]);
  assert.equal(lapsedQuotes(quotes, "2026-11-18").length, 3);
  // One quote number for two parts, as a shop quotes a cart at once, has lapsed for each.
  assert.deepEqual(lapsedQuotes({ lines: [line("bracket", "JLCCNC", "J-1", "2020-01-31"), line("plate", "JLCCNC", "J-1", "2020-01-31")] }, "2026-11-17")
    .map((x) => x.lineId), ["bracket", "plate"]);
  // No clock: the hand-off's page view, written on no day, has none.
  assert.deepEqual(lapsedQuotes(quotes, ""), []);
  // A quotes.json edited by hand, with no day there, is not read as one.
  assert.deepEqual(lapsedQuotes({ lines: [line("bracket", "Weerg", "Q-1", 20261110 as never), line("plate", "JLCCNC", "J-1", "2026-11-1")] }, "2026-11-18"), []);
});

test("a read shipping figure is said to be a checkout's only for a shop with a shop's quote in catalog.json, picked here or not", () => {
  const screw = { id: "scr", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 4, spec: {} } as BomLine;
  const sold = (supplier: string): Sourcing => ({ slug: "lid", unsourced: [], lines: [{ lineId: "scr", offers: [{ supplier, sku: "B-1",
    url: "https://example.com/b", priceBreaks: [{ qty: 1, unitUsd: 0.1 }], stock: 1000, leadDays: 3, source: "snapshot", capturedAt: "2026-11-16" }] }] });
  const basis = (q: ReturnType<typeof quote>, shop: string) => q.lines.find((l) => l.lineId === `ship:${shop}`)?.basis;
  const ship = { Bolts: 8.95, Weerg: 20 }, said = { Bolts: "flat $8.95 on its shipping page", Weerg: "€17.91 at the checkout to Milan" };
  const read = quote(bom(bracket, screw), sold("Bolts"), withQuotes(weerg()), ship, undefined, { read: ["Bolts", "Weerg"], basis: said });
  assert.equal(basis(read, "Bolts"), "flat order shipping read from the shop's published rates (catalog.json shippingRead): flat $8.95 on its shipping page");
  assert.equal(basis(read, "Weerg"), "shipping read at the shop's checkout or from its published rates (catalog.json shippingRead): €17.91 at the checkout to Milan");
  const est = quote(bom(bracket, screw), sold("Bolts"), withQuotes(weerg()), ship, undefined, { basis: said });
  assert.equal(basis(est, "Bolts"), "estimate, not read from the shop's rates: flat $8.95 on its shipping page");
  assert.equal(basis(est, "Weerg"), "estimate, not read from the shop's checkout or its rates: €17.91 at the checkout to Milan");
  // Planted: JLCCNC's quote takes the bracket and Weerg sells only the screw. Weerg's figure, read at its checkout for
  // its quote, is worded so all the same: the one order and orders A and B word one figure one way.
  const jlccnc = weerg({ supplier: "JLCCNC", sku: "J-1", priceBreaks: [{ qty: 41, shopTotal: 100, unitUsd: 100 / 41 }] }, { currency: "USD", usdPerEur: undefined });
  const other = quote(bom(bracket, screw), sold("Weerg"), withQuotes(weerg(), jlccnc), { Weerg: 20, JLCCNC: 20 }, undefined, { read: ["Weerg"], basis: said });
  assert.deepEqual(["bracket", "scr"].map((id) => other.lines.find((l) => l.lineId === id)?.supplier), ["JLCCNC", "Weerg"]);
  assert.equal(basis(other, "Weerg"), "shipping read at the shop's checkout or from its published rates (catalog.json shippingRead): €17.91 at the checkout to Milan");
});
