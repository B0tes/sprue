// Tests of what catalog.json must hold before anything prices from it: the CO2 run's misspelt price break
// ({ qty, unitPrice }) gave a $NaN total with exit 0. Run them with
//   node --test skills/sprue/pipeline/catalog.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catalogError, catalogProblems } from "./catalog.ts";
import type { Bom } from "./types.ts";

const examples = join(import.meta.dirname, "..", "examples");
const offer = (more: Record<string, unknown> = {}) => ({ supplier: "Adafruit", sku: "4997", mpn: "Adafruit 4997", url: "https://example.com",
  priceBreaks: [{ qty: 1, unitUsd: 2.5 }], stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-10-21", ...more });
const problems = (raw: unknown, file?: string) => catalogProblems(raw, file).problems;

test("the examples' catalogs hold nothing the quote can't read", () => {
  for (const slug of ["macropad", "ponder"]) {
    const raw = JSON.parse(readFileSync(join(examples, slug, "catalog.json"), "utf8"));
    const bom = JSON.parse(readFileSync(join(examples, slug, "bom.json"), "utf8")) as Bom;
    assert.deepEqual(catalogProblems(raw, "catalog.json", bom), { problems: [], notes: [] }, slug);
  }
});

test("a misspelt price break is named, field and offer, instead of pricing at NaN", () => {
  const raw = { shipping: { Adafruit: 9 }, offers: { cap: [offer({ priceBreaks: [{ qty: 1, unitPrice: 2.5 }] })] } };
  assert.deepEqual(problems(raw), [
    'offers.cap[0] (Adafruit 4997): priceBreaks[0] has a field nothing reads ("unitPrice"; the fields are qty, unitUsd)',
    "offers.cap[0] (Adafruit 4997): priceBreaks[0].unitUsd must be a number of USD per piece, 0 or more, not nothing",
  ]);
  assert.equal(catalogError("catalog.json", problems(raw)),
    'catalog.json can\'t be priced from: offers.cap[0] (Adafruit 4997): priceBreaks[0] has a field nothing reads ("unitPrice"; the fields are qty, unitUsd) (and 1 more: run sprue validate)');
});

test("fields nothing reads, at the top, in an offer or a filament, are problems; _comments and an offer's note are not", () => {
  assert.deepEqual(problems({ shiping: {}, offers: {} }),
    ['its top level has a field nothing reads ("shiping"; the fields are shipping, shippingFirstArticle, shippingRead, shippingBasis, shipsWith, filament, offers)']);
  assert.deepEqual(problems({ offers: { cap: [offer({ price: 3 })] } }),
    ['offers.cap[0] (Adafruit 4997) has a field nothing reads ("price"; the fields are supplier, sku, mpn, url, packSize, priceBreaks, stock, leadDays, source, capturedAt, note)']);
  assert.deepEqual(problems({ filament: { PETG: { usdPerKg: 20, gPerCm3: 1.27, url: "u", capturedAt: "d", density: 1 } }, offers: {} }),
    ['filament.PETG has a field nothing reads ("density"; the fields are usdPerKg, gPerCm3, url, capturedAt, densityUrl, leadDays)']);
  const commented = { _why: "prices read 2026-10-21", shipping: { _note: "EU", Adafruit: 9 },
    offers: { _comment: "x", cap: [offer({ _seen: "page", note: "sold in tens" })] } };
  assert.deepEqual(problems(commented), []);
  // offers.digikey.json has its own top level.
  assert.deepEqual(problems({ fetchedAt: "2026-10-21", offers: {} }, "offers.digikey.json"), []);
  assert.deepEqual(problems({ shipping: {}, offers: {} }, "offers.digikey.json"),
    ['its top level has a field nothing reads ("shipping"; the fields are fetchedAt, offers)']);
});

test("each number, stock and source is checked for what the quote does with it", () => {
  const bad = offer({ priceBreaks: [{ qty: 0.5, unitUsd: -1 }], stock: "plenty", leadDays: "5", source: "web", packSize: 0 });
  assert.deepEqual(problems({ shipping: { Adafruit: "9" }, offers: { cap: [bad] } }), [
    'shipping.Adafruit must be a number of USD, 0 or more, not "9"',
    "offers.cap[0] (Adafruit 4997): packSize must be a whole number of pieces, 1 or more, not 0",
    'offers.cap[0] (Adafruit 4997): leadDays must be a number of days, not "5"',
    'offers.cap[0] (Adafruit 4997): source must be one of api, snapshot, formula, estimate, not "web"',
    'offers.cap[0] (Adafruit 4997): stock must be a whole number of pieces, "in stock" or "unknown", not "plenty"',
    "offers.cap[0] (Adafruit 4997): priceBreaks[0].qty must be a whole number of pieces, 1 or more, not 0.5",
    "offers.cap[0] (Adafruit 4997): priceBreaks[0].unitUsd must be a number of USD per piece, 0 or more, not -1",
  ]);
  for (const stock of [0, 120, "in stock", "unknown"]) assert.deepEqual(problems({ offers: { cap: [offer({ stock })] } }), [], String(stock));
  assert.deepEqual(problems({ offers: { cap: [offer({ priceBreaks: [] })] } }),
    ["offers.cap[0] (Adafruit 4997): priceBreaks must list at least one { qty, unitUsd }, not []"]);
  assert.deepEqual(problems({ offers: { cap: offer() } }), ["offers.cap must be a list of offers, not " + JSON.stringify(offer())]);
  assert.deepEqual(problems([]), ["the file is not a JSON object"]);
});

test("offers for a line bom.json lacks, or makes, are notes: they change no price", () => {
  const bom = { slug: "t", units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: {} }] } as Bom;
  assert.deepEqual(catalogProblems({ offers: { lid: [offer()], gone: [offer()] } }, "catalog.json", bom), { problems: [], notes: [
    "catalog.json: offers for lid, which is made (print), not bought, so nothing reads them",
    'catalog.json: offers for "gone", which bom.json has no line for, so nothing reads them',
  ] });
});
