// Tests of the source stage's hold on part numbers: an offer of another part is dropped, one of an alternate stays
// and is flagged, and the quote says when it buys one (the CO2 run's order bought an SCD-41 on its SCD-40 line
// without a word). Also the flags for a line with one offer or one shop, and the quote's refusal of a $NaN total.
// Run them with
//   node --test skills/sprue/pipeline/stages/source.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { FabRates } from "../adapters/fab.ts";
import type { Bom, BomLine, Offer } from "../types.ts";
import { quote } from "./quote.ts";
import { partCodes, partNumber, partOf, source } from "./source.ts";

const rates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rates.json"), "utf8")) as FabRates;
const offer = (supplier: string, mpn: string | undefined, unitUsd: number, sku = `${supplier}-${mpn ?? "x"}`): Offer => ({
  supplier, sku, ...(mpn ? { mpn } : {}), url: `https://example.com/${sku}`, priceBreaks: [{ qty: 1, unitUsd }], stock: "in stock",
  leadDays: 5, source: "snapshot", capturedAt: "2026-10-21" });
const co2: BomLine = { id: "co2", name: "SCD-40 breakout", role: "sensor", process: "buy", qtyPerUnit: 1, spec: {},
  mpn: "Adafruit 5187", alternates: ["Adafruit 5190 (SCD-41: 400-5000 ppm, same board, about 5 USD more)"] };
const bom: Bom = { slug: "t", units: 1, lines: [co2] };

test("an offer's part number is the line's, an alternate's, another part's, or nothing to tell by", () => {
  assert.deepEqual([...partCodes("WP-59SURKCGKW (now L-59SURKCGKW)")], ["wp59surkcgkw", "l59surkcgkw"]);
  // Sizes, threads, amounts, packs and dates are no part numbers; a maker's name neither.
  assert.deepEqual([...partCodes("Hammond 1/4-40 x 5/8in M2.5x6 M3 128x64 3.3V 26AWG 4.0 1.3in 25 pcs 2026-10-21 32 GB")], []);
  assert.deepEqual([...partCodes("150 mm, 100 pcs, M3x8mm M2.5x6mm ISO 7380 DIN 912 0805 A2 400-5000 ppm 1000 mAh 4-pin 5V2A 3V3 100uF 10kohm 390R")], []);
  assert.deepEqual([...partCodes("Satco 90-2155 1/8ips nipple, DEV-14809, #4-40, SC0915.")], ["902155", "dev14809", "sc0915"]);
  assert.deepEqual(partOf(co2, "Adafruit 5187"), { as: "mpn" });
  // A maker's name may be left out, and letters and marks inside a code don't count.
  assert.deepEqual(partOf(co2, "5187"), { as: "mpn" });
  assert.deepEqual(partOf({ mpn: "Kingbright WP59SURKCGKW" }, "wp-59surkcgkw"), { as: "mpn" });
  assert.deepEqual(partOf(co2, "Adafruit 5190"), { as: "alternate", alternate: co2.alternates![0] });
  assert.deepEqual(partOf(co2, "SparkFun SEN-22395"), { as: "other" });
  assert.deepEqual(partOf(co2, "Adafruit 5188"), { as: "other" });
  // Each text is its own (first) part number: a part named in the comment after it is not that part.
  assert.deepEqual(partOf(co2, "SCD-41"), { as: "other" });
  assert.deepEqual(partOf(co2, "SparkFun SCD41"), { as: "other" });
  assert.deepEqual(partOf(co2, "Adafruit 5190 (replaces 5187)"), { as: "alternate", alternate: co2.alternates![0] });
  assert.deepEqual(partOf({ mpn: "Raspberry Pi SC0915", alternates: ["Raspberry Pi Pico 2 (SC1631, RP2350, pin-compatible)"] }, "RP2350"), { as: "other" });
  assert.equal(partNumber("Grand Brass 1/8ips 5/8in x 5/8in Cylinder Coupling - Black Powdercoat (NE438BL)"), "ne438bl");
  assert.deepEqual(partOf({ mpn: "Adafruit 3157 (150 mm, too long for the head)" }, "Raspberry Pi camera cable 150 mm"), { as: "unknown" });
  // A longer description of the part on the line's side, and a comment in brackets on the offer's, still match.
  const sd = { mpn: "SanDisk 32 GB", alternates: ["Raspberry Pi SC1628 32 GB A2 (PiShop 907-1)"] };
  assert.deepEqual(partOf(sd, "SC1628"), { as: "alternate", alternate: sd.alternates[0] });
  // Not the alternate, and "SanDisk 32 GB" has no part number to tell it from: it may be that card.
  assert.deepEqual(partOf(sd, "SC1628M"), { as: "unknown" });
  assert.deepEqual(partOf({ ...sd, mpn: "SanDisk SDSQUA4-032G" }, "SC1628M"), { as: "other" });
  assert.deepEqual(partOf({ mpn: "Grand Brass gooseneck (image code PIGN15BL)" }, "PIGN15BL (image code; no SKU on the page)"), { as: "mpn" });
  // No number, a number with no digit, or a line with no mpn: nothing holds the offer to a part.
  assert.deepEqual(partOf(co2, undefined), { as: "unknown" });
  assert.deepEqual(partOf(co2, "Adafruit"), { as: "unknown" });
  assert.deepEqual(partOf({}, "Adafruit 5187"), { as: "unknown" });
});

test("an offer of another part is dropped, one of an alternate is flagged, and the quote says when it buys one", () => {
  const offers = { co2: [offer("Opencircuit", "Adafruit 5187", 22), offer("BerryBase", "Adafruit 5190", 21), offer("Cheap", "Adafruit 5188", 5)] };
  const s = source(bom, offers);
  const line = s.lines[0];
  assert.deepEqual(line.offers.map((o) => o.supplier), ["Opencircuit", "BerryBase"]);
  assert.equal(line.note, "dropped as another part (bom.json's mpn is Adafruit 5187, or an alternate it lists): Cheap Cheap-Adafruit 5188 is Adafruit 5188");
  assert.deepEqual(line.alternates, [{ supplier: "BerryBase", sku: "BerryBase-Adafruit 5190", alternate: co2.alternates![0] }]);
  assert.ok(line.flags!.some((f) => f.startsWith("BerryBase BerryBase-Adafruit 5190 is the alternate Adafruit 5190 (SCD-41")));
  const q = quote(bom, s, rates, { Opencircuit: 5, BerryBase: 5 });
  const bought = q.lines.find((l) => l.lineId === "co2")!;
  assert.equal(bought.supplier, "BerryBase");
  assert.equal(bought.alternate, co2.alternates![0]);
  assert.match(bought.basis, /; the alternate Adafruit 5190 \(SCD-41.*\), not Adafruit 5187 \(bom\.json\)$/);
  // Bought as the line's own part, the quote line carries no alternate.
  const own = quote(bom, s, rates, { Opencircuit: 0, BerryBase: 5 }).lines.find((l) => l.lineId === "co2")!;
  assert.equal(own.supplier, "Opencircuit");
  assert.equal(own.alternate, undefined);
});

test("a line whose every offer is of another part has none, and says why", () => {
  const s = source(bom, { co2: [offer("Cheap", "Adafruit 5188", 5)] });
  assert.deepEqual(s.unsourced, ["co2"]);
  assert.match(s.lines[0].note!, /^no offer to buy it from; dropped as another part/);
});

test("one offer, one shop, and offers with no part number are flagged; a line with no mpn holds nothing", () => {
  const one = source(bom, { co2: [offer("Opencircuit", "Adafruit 5187", 22)] }).lines[0];
  assert.deepEqual(one.flags, ["one offer (Opencircuit): no second source if it sells out"]);
  const shop = source(bom, { co2: [offer("Adafruit", "Adafruit 5187", 22, "a"), offer("Adafruit", undefined, 20, "b")] }).lines[0];
  assert.deepEqual(shop.flags, ["every offer is from Adafruit: no second shop",
    "1 of its 2 offers gives no part number to check against Adafruit 5187 (Adafruit b): check that page shows that part"]);
  const loose: Bom = { slug: "t", units: 1, lines: [{ ...co2, mpn: undefined, alternates: undefined }] };
  const free = source(loose, { co2: [offer("A", undefined, 1), offer("B", "Anything 123", 2)] }).lines[0];
  assert.equal(free.offers.length, 2);
  assert.equal(free.flags, undefined);
  // A line whose mpn is a description, with no part number in it, keeps its offers and asks for one.
  const described: Bom = { slug: "t", units: 1, lines: [{ ...co2, mpn: "Satco brass lock nut", alternates: undefined }] };
  const nut = source(described, { co2: [offer("A", "Satco 90-280", 1), offer("B", "Satco 90-280", 2)] }).lines[0];
  assert.equal(nut.offers.length, 2);
  assert.deepEqual(nut.flags, ["bom.json's mpn for it has no part number in it (a code with a letter and a digit, or 3 or more digits), so no offer can be checked against it: give the maker's part number"]);
});

test("an offer with nothing on hand is dropped and named; one short of the batch says how many it has", () => {
  const s = source({ ...bom, units: 3 }, { co2: [{ ...offer("A", "Adafruit 5187", 20), stock: 0 }, { ...offer("B", "Adafruit 5187", 21), stock: 2 }] });
  assert.deepEqual(s.unsourced, ["co2"]);
  assert.equal(s.lines[0].note, "no offer to buy it from; dropped as out of stock: A A-Adafruit 5187; dropped for short stock (need 3): B B-Adafruit 5187 has 2");
});

test("a price that is not a number stops the quote, naming the line, instead of a $NaN total", () => {
  const bad = { ...offer("Opencircuit", "Adafruit 5187", 22), priceBreaks: [{ qty: 1 }] } as unknown as Offer;
  assert.throws(() => quote(bom, source(bom, { co2: [bad] }), rates, { Opencircuit: 5 }), /the quote came to \$NaN: co2 \(Opencircuit /);
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: "abc", material: "PETG" } } as unknown as BomLine;
  const printed: Bom = { slug: "t", units: 1, lines: [lid] };
  assert.throws(() => quote(printed, source(printed, {}), rates, {}), /the quote came to \$NaN: lid \(/);
});
