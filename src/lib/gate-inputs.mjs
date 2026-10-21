// What the site's gate outputs (src/lib/gate-outputs.json) were run on: the sha256 of every file of an example that
// git tracks, and of Sprue's own code that decides what the gate commands print. scripts/gate-outputs.mjs records it
// when it runs the gates, and src/lib/example.ts hashes the files again when the page is built, so a record of other
// files is never shown. Plain JavaScript, so the script runs it with plain node and the page and the tests import it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where the record lives, from the repo root. */
export const RECORD = "src/lib/gate-outputs.json";

/** An example's folders that .gitignore leaves out: the CAD exports, the package and the run's own records. */
const IGNORED_DIRS = ["fab", "pcb", "production", "history", "shots"];
/** An example's files that .gitignore leaves out: the page (copy-figures writes it) and the firmware run's report. */
const IGNORED_FILES = ["view.html", "firmware/fil.json"];
/** Left out at any depth, as .gitignore does: Python's caches and the folder files macOS writes. */
const IGNORED_NAMES = ["__pycache__", ".DS_Store"];

/** Sprue's own code that decides what the gate commands print: the command, the pipeline with its rates, the board's
 * proof (Python and data, which `sprue verify` runs before the build gate) and the whole-product checker. */
const SPRUE = ["skills/sprue/bin/sprue", "skills/sprue/cad/system.py", "skills/sprue/pipeline"];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every file under `dir` (relative to `root`, with / between folders) that `skip` keeps, in sorted order. Vercel's
 * build has no .git to ask what is tracked, so the folder is walked. */
function walk(root, dir, skip) {
  const out = [];
  const go = (rel) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const path = `${rel}/${name}`;
      if (IGNORED_NAMES.includes(name) || skip(path)) continue;
      if (statSync(join(root, path)).isDirectory()) go(path);
      else out.push(path);
    }
  };
  if (existsSync(join(root, dir))) go(dir);
  return out;
}

/** The files the gate outputs of `slug` depend on, each with its sha256, by path from the repo root. */
export function gateInputs(root, slug) {
  const example = `skills/sprue/examples/${slug}`;
  const inExample = (path) => path.slice(example.length + 1);
  const files = [
    ...walk(root, example, (path) => {
      const rel = inExample(path);
      return IGNORED_DIRS.includes(rel) || IGNORED_FILES.includes(rel);
    }),
    ...SPRUE.flatMap((p) => (existsSync(join(root, p)) && statSync(join(root, p)).isFile() ? [p] : walk(root, p, (path) => path.endsWith(".test.ts")))),
  ];
  return Object.fromEntries(files.sort().map((f) => [f, sha256(join(root, f))]));
}

/** The first file, in sorted order, that is in one set of inputs and not the other, or has another hash; undefined
 * when the two are the same. */
export function firstChange(recorded, now) {
  return [...new Set([...Object.keys(recorded ?? {}), ...Object.keys(now)])].sort().find((f) => recorded?.[f] !== now[f]);
}

/** The record, or an empty one when it is missing or not readable. */
export function readRecord(root) {
  try {
    const r = JSON.parse(readFileSync(join(root, RECORD), "utf8"));
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

/** A slug's entry in the record while its inputs are the files there are now (`entry`), else the first file that
 * differs (`changed`: "no record" when there is none). */
export function currentEntry(root, slug, record = readRecord(root)) {
  const entry = record[slug];
  if (!entry || typeof entry !== "object" || !entry.inputs || !Array.isArray(entry.gates)) return { changed: "no record" };
  const changed = firstChange(entry.inputs, gateInputs(root, slug));
  return changed ? { changed } : { entry };
}
