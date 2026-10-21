// `sprue status <slug>`: the files each stage has written, its gate, and the one thing to do next.
// Grouped by the four stages the user sees (design, inspect, source, build), so nothing here numbers steps.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageProblem } from "./gates.ts";
import { exists, productDir, readJson } from "./io.ts";
import { faultsAudit, isBoardLine, systemAudit, verifyState } from "./stages/score.ts";
import { gateLine, readState, STAGES, waiting, type Stage } from "./state.ts";
import type { Bom } from "./types.ts";

// `done` is for a file whose being there is not enough: verify.json counts only once it says verified, of the board
// as it is now.
type Item = { file: string; dir?: boolean; optional?: boolean; next?: string; done?: boolean };

function items(slug: string): Record<Stage, Item[]> {
  const bom = exists(slug, "bom.json") ? readJson<Bom>(slug, "bom.json") : undefined;
  const made = !bom || bom.lines.some((l) => l.process === "print" || l.process === "cnc" || l.process === "sheet");
  const board = !!bom?.lines.some((l) => isBoardLine(productDir(slug), l)); // a PCB whose Gerbers come from cad/pcb.mjs
  const verified = verifyStatus(slug) === "verified";
  const system = bom ? systemAudit(productDir(slug), bom) : undefined;
  // A system.json of the files as they are that fails: sprue inspect would only fail too, so the design is fixed first.
  const fails = system && !system.ok && !/^(no system\.json|system\.json is (of an earlier design|not readable))/.test(system.detail);
  return {
    design: [
      { file: "request.json", next: `sprue new ${slug} '<brief>', then fill request.json` },
      { file: "design.json", next: "write design.json: summary, architecture, params, assembly" },
      { file: "design.md", optional: true },
      { file: "bom.json", next: `write bom.json, then sprue validate ${slug}` },
      { file: "cad", dir: true, optional: !made && !board, next: `write cad/<part>.py for each made part, then sprue cad ${slug}` },
      { file: "fab", dir: true, optional: !made, next: `sprue cad ${slug}` },
      { file: "pcb", dir: true, optional: !board, next: `sprue pcb ${slug}` },
      { file: "rules.ts", optional: true },
      { file: "checks.json", next: `sprue check ${slug}` },
      { file: "figure.mjs", next: `write figure.mjs (reference/figure.md), then sprue figure ${slug} --draft` },
      { file: "view.html", next: `sprue figure ${slug} --draft` },
      { file: "shots", dir: true, optional: true },
    ],
    inspect: [
      // Every part in one frame: they fit, touch where they should, stand up and do their physical job.
      { file: "system.json", optional: !made || !bom, done: system?.ok,
        next: !exists(slug, "cad/_system.py") ? `write cad/_system.py, then sprue system ${slug}`
          : fails ? `fix the design (system.json ${system.failed.length ? `fails ${system.failed.join(", ")}` : "is not ok"}), then sprue inspect ${slug}`
          : `sprue inspect ${slug} proposes inspect for review` },
    ],
    source: [
      { file: "catalog.json", next: "write catalog.json: two real offers per bought line" },
      { file: "offers.digikey.json", optional: true },
      { file: "sourcing.json", next: `sprue source ${slug}` },
      { file: "quotes.json", next: `sprue quote ${slug}` },
    ],
    build: [
      { file: "build-plan.md", next: `sprue plan ${slug}` },
      // The board is proven before it is packaged: package leaves out a zip the read-back has not passed.
      { file: "pcb/verify.json", optional: !board, done: verified, next: `sprue verify ${slug}, until it ends VERIFIED` },
      // production/ counts only while it is what package would write from the files as they are (the build gate's too).
      { file: "production", dir: true, done: exists(slug, "production") && !(bom && packageProblem(productDir(slug), bom)), next: `sprue package ${slug}` },
      { file: "reference/reference.json", optional: true },
      { file: "score.json", optional: true },
      // The checks, checked: each fault reference/faults.json lists, put into a copy, is caught (sprue faults).
      { file: "faults.json", optional: true, done: faultsAudit(productDir(slug))?.ok ?? false, next: `sprue faults ${slug}` },
    ],
  };
}

/** What pcb/verify.json says of the board as it is now: verified, failed or unverified, or stale once the board, its
 * zip or what verified it changed (undefined with none). */
const verifyStatus = (slug: string) => verifyState(productDir(slug));

const done = (slug: string, item: Item) => item.done ?? exists(slug, item.file);

const PROPOSER: Record<Stage, string> = { design: "figure", inspect: "inspect", source: "quote", build: "plan" };

function label(slug: string, item: Item) {
  if (item.file === "pcb/verify.json" && exists(slug, item.file)) return `${item.file} (${verifyStatus(slug) ?? "unreadable"})`;
  if (item.file === "system.json" && exists(slug, item.file)) {
    if (!exists(slug, "bom.json")) return `${item.file} (no bom.json)`;
    const s = systemAudit(productDir(slug), readJson<Bom>(slug, "bom.json"));
    return `${item.file} (${s.ok ? "passes" : s.failed.length ? `fails ${s.failed.join(", ")}` : "not ok"})`;
  }
  if (item.file === "faults.json" && exists(slug, item.file)) {
    const f = faultsAudit(productDir(slug));
    if (!f) return `${item.file} (no reference/faults.json)`;
    const counts = `${f.caught} of ${f.ran} caught, ${f.falseAlarms} false alarm${f.falseAlarms === 1 ? "" : "s"}`;
    return `${item.file} (${/^faults\.json (is of|was measured)/.test(f.detail) ? "stale" : /^faults\.json is not readable/.test(f.detail) ? "unreadable" : /^faults\.json could not be checked/.test(f.detail) ? "unchecked" : counts})`;
  }
  if (item.file === "production" && exists(slug, item.file) && exists(slug, "bom.json") && packageProblem(productDir(slug), readJson<Bom>(slug, "bom.json")))
    return `${item.file}/ (stale)`;
  if (!item.dir) return item.file;
  const dir = join(productDir(slug), item.file);
  const n = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith("_") && !f.startsWith(".")).length : 0;
  return `${item.file}/${n ? ` (${n})` : ""}`;
}

export function printStatus(slug: string) {
  const s = readState(slug);
  const all = items(slug);
  console.log(`products/${slug}/${exists(slug, "state.json") ? "" : "  (no state.json yet)"}`);
  for (const stage of STAGES) {
    console.log(`  ${gateLine(s, stage)}`);
    const row = all[stage]
      .filter((it) => !it.optional || exists(slug, it.file))
      .map((it) => `${done(slug, it) ? "✓" : "○"} ${label(slug, it)}`);
    // Inspect of a product with nothing made and no whole-product check has no file to show.
    if (row.length) console.log(`      ${row.join("  ")}`);
  }
  if (exists(slug, "view.html")) {
    const page = join(productDir(slug), "view.html");
    console.log(`page: ${page}\n      ${pathToFileURL(page).href}`);
  }
  console.log(`next: ${next(slug, s, all)}`);
}

function next(slug: string, s: ReturnType<typeof readState>, all: Record<Stage, Item[]>) {
  if (s.stage === "done") return "nothing: every stage is accepted. Edit an input and rerun to iterate; nothing has been ordered.";
  // At a gate waiting for the user, a file its accept would refuse (a package of other files, a board not proved, a
  // whole-product check that fails or is stale) is put right first, as accept would only say so.
  const refused = all[s.stage].find((it) => !it.optional && it.done !== undefined && exists(slug, it.file) && !done(slug, it));
  if (refused && s.stages[s.stage]?.status === "proposed") return refused.next ?? refused.file;
  const line = waiting(slug, s);
  if (line) return line.replace(/^waiting for you/, "ask the user");
  const missing = all[s.stage].find((it) => !it.optional && !done(slug, it));
  if (missing) return missing.next ?? missing.file;
  // At Inspect only sprue inspect, which checks the parts first: sprue propose would skip that.
  return `sprue ${PROPOSER[s.stage]} ${slug} proposes ${s.stage} for review${s.stage === "inspect" ? "" : ` (or sprue propose ${slug} ${s.stage})`}`;
}
