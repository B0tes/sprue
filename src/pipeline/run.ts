// Runs stages 3-6 and the scorer for one product:
//   node src/pipeline/run.ts macropad
// Stages 0-2 (request, design, bom) are written by Claude in the daily run, using the
// Anatomy skill for the design; this script turns them into checks, offers, quotes,
// a build plan and a score. Run from the repo root.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exists, productDir, readJson, usd, writeJson, writeText } from "./io.ts";
import { runChecks } from "./stages/check.ts";
import { source, type Catalog } from "./stages/source.ts";
import { quote } from "./stages/quote.ts";
import { buildPlan } from "./stages/plan.ts";
import { score } from "./stages/score.ts";
import type { FabRates } from "./adapters/fab.ts";
import type { Bom, Design, Reference, Request } from "./types.ts";

const slug = process.argv[2];
if (!slug) throw new Error("usage: node src/pipeline/run.ts <slug>");

const req = readJson<Request>(slug, "request.json");
const design = readJson<Design>(slug, "design.json");
const bom = readJson<Bom>(slug, "bom.json");
const catalog = readJson<{ shipping: Record<string, number>; offers: Catalog }>(slug, "catalog.json");
const rates = JSON.parse(readFileSync(join(import.meta.dirname, "rates.json"), "utf8")) as FabRates;

const checks = runChecks(design, bom);
writeJson(slug, "checks.json", checks);

const sourcing = source(bom, catalog.offers);
writeJson(slug, "sourcing.json", sourcing);

const quotes = quote(bom, sourcing, rates, catalog.shipping);
writeJson(slug, "quotes.json", quotes);

writeText(slug, "build-plan.md", buildPlan(req, design, bom, checks, quotes, design.assembly ?? []));

console.log(`checks: ${checks.checks.length} run, ${checks.failed} failed, ${checks.flagged} flagged`);
for (const c of checks.checks.filter((c) => c.status !== "pass")) console.log(`  ${c.status}: ${c.title}: ${c.detail}`);
console.log(`sourcing: ${sourcing.lines.length - sourcing.unsourced.length}/${sourcing.lines.length} bought lines have offers`);
console.log(`quotes: ${usd(quotes.batchUsd)} for ${quotes.units} unit(s), longest lead ${quotes.longestLeadDays} d, unquoted: ${quotes.unquoted.join(", ") || "none"}`);

if (exists(slug, "reference/reference.json")) {
  const ref = readJson<Reference>(slug, "reference/reference.json");
  const s = score(productDir(slug), bom, checks, quotes, ref);
  writeJson(slug, "score.json", s);
  console.log(`score: coverage ${s.coverage.pct}% (missing: ${s.coverage.missing.join(", ") || "none"}), ` +
    `cost ${s.cost.deltaPct > 0 ? "+" : ""}${s.cost.deltaPct}% vs reference, ` +
    `files ${s.files.filter((f) => f.ok).length}/${s.files.length} ok -> ${s.pass ? "PASS" : "not yet"}`);
}
