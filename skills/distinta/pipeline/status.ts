// `distinta status <slug>`: the files each stage has written, its gate, and the one thing to do next.
// Grouped by the three stages the user sees (design, source, build), so nothing here numbers steps.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exists, productDir, readJson } from "./io.ts";
import { gateLine, readState, STAGES, waiting, type Stage } from "./state.ts";
import type { Bom } from "./types.ts";

// `done` is for a file whose being there is not enough: verify.json counts only once it says verified.
type Item = { file: string; dir?: boolean; optional?: boolean; next?: string; done?: boolean };

function items(slug: string): Record<Stage, Item[]> {
  const bom = exists(slug, "bom.json") ? readJson<Bom>(slug, "bom.json") : undefined;
  const made = !bom || bom.lines.some((l) => l.process === "print" || l.process === "cnc" || l.process === "sheet");
  const board = !!bom?.lines.some((l) => l.file?.startsWith("pcb/")); // a PCB whose Gerbers come from cad/pcb.mjs
  const verified = verifyStatus(slug) === "verified";
  return {
    design: [
      { file: "request.json", next: `distinta new ${slug} '<brief>', then fill request.json` },
      { file: "design.json", next: "write design.json: summary, architecture, params, assembly" },
      { file: "design.md", optional: true },
      { file: "bom.json", next: `write bom.json, then distinta validate ${slug}` },
      { file: "cad", dir: true, optional: !made && !board, next: `write cad/<part>.py for each made part, then distinta cad ${slug}` },
      { file: "fab", dir: true, optional: !made, next: `distinta cad ${slug}` },
      { file: "pcb", dir: true, optional: !board, next: `distinta pcb ${slug}` },
      { file: "rules.ts", optional: true },
      { file: "checks.json", next: `distinta check ${slug}` },
      { file: "figure.mjs", next: `write figure.mjs (reference/figure.md), then distinta figure ${slug} --draft` },
      { file: "view.html", next: `distinta figure ${slug} --draft` },
      { file: "shots", dir: true, optional: true },
    ],
    source: [
      { file: "catalog.json", next: "write catalog.json: two real offers per bought line" },
      { file: "offers.digikey.json", optional: true },
      { file: "sourcing.json", next: `distinta source ${slug}` },
      { file: "quotes.json", next: `distinta quote ${slug}` },
    ],
    build: [
      { file: "build-plan.md", next: `distinta plan ${slug}` },
      // The board is proven before it is packaged: package leaves out a zip the read-back has not passed.
      { file: "pcb/verify.json", optional: !board, done: verified, next: `distinta verify ${slug}, until it ends VERIFIED` },
      { file: "production", dir: true, next: `distinta package ${slug}` },
      { file: "reference/reference.json", optional: true },
      { file: "score.json", optional: true },
    ],
  };
}

/** What pcb/verify.json says of the board: verified, failed or unverified (undefined with none). */
function verifyStatus(slug: string): string | undefined {
  return exists(slug, "pcb/verify.json") ? readJson<{ status?: string }>(slug, "pcb/verify.json").status : undefined;
}

const done = (slug: string, item: Item) => item.done ?? exists(slug, item.file);

const PROPOSER: Record<Stage, string> = { design: "figure", source: "quote", build: "plan" };

function label(slug: string, item: Item) {
  if (item.file === "pcb/verify.json" && exists(slug, item.file)) return `${item.file} (${verifyStatus(slug) ?? "unreadable"})`;
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
    console.log(`      ${row.join("  ")}`);
  }
  if (exists(slug, "view.html")) {
    const page = join(productDir(slug), "view.html");
    console.log(`page: ${page}\n      ${pathToFileURL(page).href}`);
  }
  console.log(`next: ${next(slug, s, all)}`);
}

function next(slug: string, s: ReturnType<typeof readState>, all: Record<Stage, Item[]>) {
  if (s.stage === "done") return "nothing: every stage is accepted. Edit an input and rerun to iterate; nothing has been ordered.";
  const line = waiting(slug, s);
  if (line) return line.replace(/^waiting for you/, "ask the user");
  const missing = all[s.stage].find((it) => !it.optional && !done(slug, it));
  if (missing) return missing.next ?? missing.file;
  return `distinta ${PROPOSER[s.stage]} ${slug} proposes ${s.stage} for review (or distinta propose ${slug} ${s.stage})`;
}
