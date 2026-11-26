// Tests of what catalog.json must hold before anything prices from it: the CO2 run's misspelt price break
// ({ qty, unitPrice }) gave a $NaN total with exit 0. Run them with
//   node --test skills/sprue/pipeline/catalog.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catalogError, catalogProblems } from "./catalog.ts";
import { QUOTED } from "./landed.ts";
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
    ['offers.cap[0] (Adafruit 4997) has a field nothing reads ("price"; the fields are supplier, sku, mpn, url, packSize, priceBreaks, stock, leadDays, source, capturedAt, note, shopQuote)']);
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
  // The small order's shipping, where a figure came from, which fab's parcel a shop rides in, filament and part numbers.
  assert.deepEqual(problems({ shippingFirstArticle: { X: "5" }, shipsWith: { X: 3 }, shippingBasis: { X: 1 },
    filament: { PETG: { usdPerKg: "20", gPerCm3: 0, url: "u", capturedAt: "d", leadDays: "2" } }, offers: { cap: [offer({ mpn: 5187 })] } }), [
    'shippingFirstArticle.X must be a number of USD, 0 or more, not "5"',
    'shippingBasis must map each shop to a sentence, not {"X":1}',
    'shipsWith must map each shop to the fab whose parcel carries it, not {"X":3}',
    'filament.PETG.usdPerKg must be a number over 0, not "20"',
    "filament.PETG.gPerCm3 must be a number over 0, not 0",
    'filament.PETG.leadDays must be a number of days, not "2"',
    "offers.cap[0] (Adafruit 4997): mpn must be text, not 5187",
  ]);
  // A shop riding with itself, or round a loop, has no parcel; a chain ends at a fab that rides in none.
  assert.deepEqual(problems({ shipsWith: { JLC3DP: "JLC3DP" }, offers: {} }), ["shipsWith.JLC3DP rides with itself: name the fab whose parcel carries it, or leave it out"]);
  assert.deepEqual(problems({ shipsWith: { C: "A", A: "B", B: "A" }, offers: {} }),
    ["shipsWith goes round a loop (A rides with B rides with A): one of them must carry the parcel, riding in no other's"]);
  assert.deepEqual(problems({ shipsWith: { JLCMC: "JLCCNC", JLCCNC: "JLC3DP", _note: "x" }, offers: {} }), []);
  assert.deepEqual(problems({ offers: { cap: [offer({ priceBreaks: [] })] } }),
    ["offers.cap[0] (Adafruit 4997): priceBreaks must list at least one { qty, unitUsd }, not []"]);
  assert.deepEqual(problems({ offers: { cap: offer() } }), ["offers.cap must be a list of offers, not " + JSON.stringify(offer())]);
  assert.deepEqual(problems([]), ["the file is not a JSON object"]);
});

test("a quote for a made part from a shop handoff.ts does not list is a note: the hand-off lands its cart in Italy by no rule", () => {
  const bom = { slug: "t", units: 1, lines: [{ id: "bracket", name: "Bracket", role: "bracket", process: "cnc", qtyPerUnit: 1, spec: {}, file: "fab/bracket.step" }] } as Bom;
  const quote = (supplier: string) => ({ supplier, sku: "Q-1", url: "https://example.com/q", stock: "unknown", leadDays: 9, source: "snapshot",
    capturedAt: "2026-11-16", priceBreaks: [{ qty: 1, unitUsd: 90, shopTotal: 90 }],
    shopQuote: { part: "fab/bracket.stl", sha256: "0".repeat(64), spec: {}, currency: "USD", vat: "excluded", expires: "not stated" } });
  assert.deepEqual(catalogProblems({ offers: { bracket: [quote("Weerg"), quote("Acme Machining")] } }, "catalog.json", bom), { problems: [], notes: [
    "catalog.json: offers.bracket[1] (Acme Machining Q-1) is a quote from Acme Machining, which handoff.ts's SHOPS does not list, so Sprue has no rule " +
      "for the charges into Italy from it: `sprue handoff` gives a cart of it Sprue's figure and no landed figure of its own",
  ] });
  // Every shop with a rule, whether it ships from inside the EU, from outside or from either: no note.
  assert.deepEqual(catalogProblems({ offers: { bracket: Object.keys(QUOTED).map(quote) } }, "catalog.json", bom).notes, []);
  assert.ok(["JLCCNC", "Craftcloud", "Weerg"].every((s) => Object.hasOwn(QUOTED, s)));
  // The hand-off looks a shop's rule up by its name as written, so a name in other capitals has none: a note.
  for (const name of ["weerg", "JLCcnc"])
    assert.equal(catalogProblems({ offers: { bracket: [quote(name)] } }, "catalog.json", bom).notes.filter((n) => n.includes(`a quote from ${name}, which handoff.ts's SHOPS does not list`)).length, 1, name);
  // An offer that names no shop is refused for that, and is a quote from no shop the note could name.
  for (const supplier of [undefined, ""]) {
    const { problems, notes } = catalogProblems({ offers: { bracket: [quote(supplier as unknown as string)] } }, "catalog.json", bom);
    assert.deepEqual([problems.some((x) => /supplier must be text/.test(x)), notes.some((n) => /SHOPS/.test(n))], [true, false], String(supplier));
  }
  // A sheet-metal part's quote too, and a print's in metal: each is priced from a shop's quote (quotedPart).
  for (const l of [{ process: "sheet" }, { process: "print", spec: { material: "316L stainless steel", volumeCm3: 1 } }]) {
    const made = { ...bom, lines: [{ ...bom.lines[0], ...l }] } as Bom;
    assert.equal(catalogProblems({ offers: { bracket: [quote("Acme Machining")] } }, "catalog.json", made).notes.filter((n) => /SHOPS/.test(n)).length, 1, l.process);
  }
  // An offer with no shopQuote prices nothing, so only that is said of it.
  const plain = { ...quote("Acme Machining"), shopQuote: undefined, priceBreaks: [{ qty: 1, unitUsd: 90 }] };
  assert.deepEqual(catalogProblems({ offers: { bracket: [plain] } }, "catalog.json", bom).notes, [
    "catalog.json: offers.bracket[0] (Acme Machining Q-1) has no shopQuote, so the quote prices nothing from it: bracket is made (cnc), and Sprue prices it only from a shop's quote recorded as fab/order/bracket/ORDER.md shows",
  ]);
  // A bought line's offer with a shopQuote is read as a plain offer, and a plastic print's is read by nothing (it is
  // priced from rates.json): no cart of either lands as a quote's.
  for (const l of [{ process: "buy" }, { process: "print", spec: { material: "PETG", volumeCm3: 1 } }]) {
    const other = { ...bom, lines: [{ ...bom.lines[0], ...l }] } as Bom;
    assert.equal(catalogProblems({ offers: { bracket: [quote("Acme Machining")] } }, "catalog.json", other).notes.some((n) => /SHOPS/.test(n)), false, l.process);
  }
});

test("offers for a line bom.json lacks, or makes, are notes: they change no price", () => {
  const bom = { slug: "t", units: 1, lines: [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: {} }] } as Bom;
  assert.deepEqual(catalogProblems({ offers: { lid: [offer()], gone: [offer()] } }, "catalog.json", bom), { problems: [], notes: [
    "catalog.json: offers for lid, which is made (print), not bought, so nothing reads them",
    'catalog.json: offers for "gone", which bom.json has no line for, so nothing reads them',
  ] });
});

test("a shop named as a property every object has is a problem, so no command prices from it", () => {
  // Where a map of shops has no entry for "toString", a lookup by it finds Object.prototype's function, so the page
  // summed a shop so named as no number and said it rode in a "function Object()" parcel. A key starting with _ is a
  // comment. A line's offers and a material's filament are found by their own keys, so those can be any name.
  const raw = JSON.parse(JSON.stringify({ shipping: { toString: 2, Adafruit: 1, _note: "x" }, shippingRead: ["valueOf"],
    shipsWith: { toString: "constructor", R: "JLCPCB" }, filament: { constructor: { usdPerKg: 20, gPerCm3: 1.24, url: "https://example.com/pla", capturedAt: "2026-11-26" }, _note: "x" },
    offers: { cap: [offer({ supplier: "toString" }), offer()], hasOwnProperty: [offer()] } }));
  raw.shippingBasis = JSON.parse('{"__proto__": "a comment, as it starts with _"}');
  const said = (name: string, where: string) => `"${name}" (${where}) is a name every object in JavaScript has as a property: where Sprue `
    + "has no figure for it, it would read that property as one, so name it another way (with a capital or a word added)";
  assert.deepEqual(problems(raw), [
    said("toString", "shipping.toString, shipsWith.toString, offers.cap[0].supplier"),
    said("constructor", "shipsWith.toString's fab"),
    said("valueOf", "shippingRead[0]"),
  ]);
  assert.match(catalogError("catalog.json", problems(raw)), /^catalog\.json can't be priced from: "toString" \(shipping\.toString/);
  // With a capital, a shop is a name like any other.
  assert.deepEqual(problems({ shipping: { ToString: 2 }, shipsWith: { ToString: "JLCPCB" }, offers: { cap: [offer({ supplier: "ToString" })] } }), []);
});
