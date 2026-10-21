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
import { partOf, partWords, source } from "./source.ts";

const rates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rates.json"), "utf8")) as FabRates;
const offer = (supplier: string, mpn: string | undefined, unitUsd: number, sku = `${supplier}-${mpn ?? "x"}`): Offer => ({
  supplier, sku, ...(mpn ? { mpn } : {}), url: `https://example.com/${sku}`, priceBreaks: [{ qty: 1, unitUsd }], stock: "in stock",
  leadDays: 5, source: "snapshot", capturedAt: "2026-10-21" });
const co2: BomLine = { id: "co2", name: "SCD-40 breakout", role: "sensor", process: "buy", qtyPerUnit: 1, spec: {},
  mpn: "Adafruit 5187", alternates: ["Adafruit 5190 (SCD-41: 400-5000 ppm, same board, about 5 USD more)"] };
const bom: Bom = { slug: "t", units: 1, lines: [co2] };

test("an offer's part number is the line's, an alternate's, another part's, or nothing to tell by", () => {
  assert.deepEqual(partWords("WP-59SURKCGKW (now L-59SURKCGKW)"), ["wp59surkcgkw", "now", "l59surkcgkw"]);
  assert.deepEqual(partOf(co2, "Adafruit 5187"), { as: "mpn" });
  // A maker's name may be left out, and letters and marks inside a code don't count.
  assert.deepEqual(partOf(co2, "5187"), { as: "mpn" });
  assert.deepEqual(partOf({ mpn: "Kingbright WP59SURKCGKW" }, "wp-59surkcgkw"), { as: "mpn" });
  assert.deepEqual(partOf(co2, "Adafruit 5190"), { as: "alternate", alternate: co2.alternates![0] });
  assert.deepEqual(partOf(co2, "SparkFun SEN-22395"), { as: "other" });
  assert.deepEqual(partOf(co2, "Adafruit 5188"), { as: "other" });
  // A longer description of the part on the line's side, and a comment in brackets on the offer's, still match.
  const sd = { mpn: "SanDisk 32 GB", alternates: ["Raspberry Pi SC1628 32 GB A2 (PiShop 907-1)"] };
  assert.deepEqual(partOf(sd, "SC1628"), { as: "alternate", alternate: sd.alternates[0] });
  assert.deepEqual(partOf(sd, "SC1628M"), { as: "other" });
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
    "1 of its 2 offers name no part number to hold to Adafruit 5187 (Adafruit b): check that page shows that part"]);
  const loose: Bom = { slug: "t", units: 1, lines: [{ ...co2, mpn: undefined, alternates: undefined }] };
  const free = source(loose, { co2: [offer("A", undefined, 1), offer("B", "Anything 123", 2)] }).lines[0];
  assert.equal(free.offers.length, 2);
  assert.equal(free.flags, undefined);
});

test("a price that is not a number stops the quote, naming the line, instead of a $NaN total", () => {
  const bad = { ...offer("Opencircuit", "Adafruit 5187", 22), priceBreaks: [{ qty: 1 }] } as unknown as Offer;
  assert.throws(() => quote(bom, source(bom, { co2: [bad] }), rates, { Opencircuit: 5 }), /the quote came to \$NaN: co2 \(Opencircuit /);
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: "abc", material: "PETG" } } as unknown as BomLine;
  const printed: Bom = { slug: "t", units: 1, lines: [lid] };
  assert.throws(() => quote(printed, source(printed, {}), rates, {}), /the quote came to \$NaN: lid \(/);
});
