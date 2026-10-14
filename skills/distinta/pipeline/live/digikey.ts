// Live DigiKey offers for one product's bought lines:
//   DIGIKEY_CLIENT_ID=... DIGIKEY_CLIENT_SECRET=... distinta digikey macropad
// Writes products/<slug>/offers.digikey.json, which the source stage merges with catalog.json (loadCatalog).
// Runs in GitHub Actions (.github/workflows/quote.yml) because the Claude session's
// network can't reach api.digikey.com.

import { readJson, writeJson } from "../io.ts";
import type { Bom, Offer } from "../types.ts";

const API = "https://api.digikey.com";
const id = process.env.DIGIKEY_CLIENT_ID;
const secret = process.env.DIGIKEY_CLIENT_SECRET;
const slug = process.argv[2];
if (!slug) throw new Error("usage: distinta digikey <slug>");
if (!id || !secret) throw new Error("DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET must be set");

type Pricing = { BreakQuantity: number; UnitPrice: number };
type Variation = {
  DigiKeyProductNumber: string;
  StandardPricing?: Pricing[];
  MinimumOrderQuantity?: number;
  PackageType?: { Name?: string };
};
type Product = {
  ManufacturerProductNumber: string;
  QuantityAvailable?: number;
  ProductUrl?: string;
  Description?: { ProductDescription?: string };
  ProductVariations?: Variation[];
};

async function token(): Promise<string> {
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id!, client_secret: secret!, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function search(bearer: string, keywords: string): Promise<Product[]> {
  const res = await fetch(`${API}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-DIGIKEY-Client-Id": id!,
      "X-DIGIKEY-Locale-Site": "US",
      "X-DIGIKEY-Locale-Currency": "USD",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Keywords: keywords, Limit: 5 }),
  });
  if (!res.ok) throw new Error(`search "${keywords}": ${res.status} ${await res.text()}`);
  return ((await res.json()) as { Products?: Product[] }).Products ?? [];
}

function toOffers(p: Product, today: string): Offer[] {
  return (p.ProductVariations ?? [])
    .filter((v) => v.StandardPricing?.length)
    // Tape-and-reel variations have large minimums; cut tape and bulk suit prototypes.
    .filter((v) => (v.MinimumOrderQuantity ?? 1) <= 100)
    .map((v) => ({
      supplier: "DigiKey",
      sku: v.DigiKeyProductNumber,
      mpn: p.ManufacturerProductNumber,
      url: p.ProductUrl ?? `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(v.DigiKeyProductNumber)}`,
      priceBreaks: v.StandardPricing!.map((b) => ({ qty: b.BreakQuantity, unitUsd: b.UnitPrice })),
      stock: p.QuantityAvailable ?? "unknown",
      leadDays: 3,
      source: "api" as const,
      capturedAt: today,
    }));
}

const bom = readJson<Bom>(slug, "bom.json");
const bearer = await token();
const today = new Date().toISOString().slice(0, 10);
const offers: Record<string, Offer[]> = {};
for (const line of bom.lines.filter((l) => l.process === "buy")) {
  const keywords = line.mpn ?? line.name;
  const products = await search(bearer, keywords);
  // With an MPN, keep exact matches only; a keyword search keeps the top results.
  const matches = line.mpn
    ? products.filter((p) => p.ManufacturerProductNumber.toUpperCase() === line.mpn!.toUpperCase())
    : products.slice(0, 3);
  offers[line.id] = matches.flatMap((p) => toOffers(p, today));
  console.log(`${line.id}: "${keywords}" -> ${offers[line.id].length} offers`);
}
writeJson(slug, "offers.digikey.json", { fetchedAt: new Date().toISOString(), offers });
