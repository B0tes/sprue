// What the site's gate outputs (src/lib/gate-outputs.json) were run on: the sha256 of every file of an example that
// git tracks, and of Sprue's own code that decides what the gate commands print. scripts/gate-outputs.mjs records it
// when it runs the gates, and src/lib/example.ts hashes the files again when the page is built, so a record of other
// files is never shown. Also what the script never records: a refusal of the machine it ran on, not of the product.
// Plain JavaScript, so the script runs it with plain node and the page and the tests import it.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where the record lives, from the repo root. */
export const RECORD = "src/lib/gate-outputs.json";

/** The root .gitignore's patterns, each as a test of a path from the repo root, in order: the last that matches a path
 * says whether git leaves it out. The forms this repo's .gitignore uses: `*` and `?` within a name, `**`, a `/` that
 * anchors a pattern to the root, a trailing `/` for folders and a leading `!` that takes a path back. */
function ignoreRules(root) {
  let text = "";
  try {
    text = readFileSync(join(root, ".gitignore"), "utf8");
  } catch {
    return [];
  }
  const GLOB = new Map([["**/", "(?:.*/)?"], ["**", ".*"], ["*", "[^/]*"], ["?", "[^/]"]]);
  const glob = (p) => p.split(/(\*\*\/|\*\*|\*|\?)/).map((x) => GLOB.get(x) ?? x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((line) => {
    const not = line.startsWith("!");
    let p = not ? line.slice(1) : line;
    const dirOnly = p.endsWith("/");
    if (dirOnly) p = p.slice(0, -1);
    // A pattern with a slash before its end is of a path from the root; one without is of a name at any depth.
    const anchored = p.includes("/");
    const re = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${glob(p.replace(/^\//, ""))}$`);
    return { not, dirOnly, re };
  });
}

/** Whether git leaves out `path` (from the repo root), as the root .gitignore says. A path in a folder it leaves out is
 * never reached: the walk doesn't go in, as git doesn't. */
function ignored(rules, path, isDir) {
  let out = false;
  for (const r of rules) if ((!r.dirOnly || isDir) && r.re.test(path)) out = !r.not;
  return out;
}

/** Sprue's own code that decides what the gate commands print: the command, the pipeline with its rates, the board's
 * proof (Python and data, which `sprue verify` runs before the build gate) and the whole-product checker. */
const SPRUE = ["skills/sprue/bin/sprue", "skills/sprue/cad/system.py", "skills/sprue/pipeline"];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every file under `dir` (relative to `root`, with / between folders) that git keeps and `skip` keeps, in sorted
 * order. Vercel's build has no .git to ask what is tracked, so the folder is walked, with the root .gitignore. */
function walk(root, dir, skip) {
  const rules = ignoreRules(root);
  const out = [];
  const go = (rel) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const path = `${rel}/${name}`;
      const isDir = statSync(join(root, path)).isDirectory();
      if (ignored(rules, path, isDir) || skip(path)) continue;
      if (isDir) go(path);
      else out.push(path);
    }
  };
  if (existsSync(join(root, dir))) go(dir);
  return out;
}

/** The files the gate outputs of `slug` depend on, each with its sha256, by path from the repo root. */
export function gateInputs(root, slug) {
  const files = [
    ...walk(root, `skills/sprue/examples/${slug}`, () => false),
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

/** What a command prints when this machine, not the product, stops a gate: an export to make again (`sprue cad`
 * makes fab/ and pcb/), or a tool to install or fetch. */
const LOCAL = /\brun sprue (cad|pcb)\b|could not be fetched|is not in the cache|is not installed|pip install|\bno python3?\b|install Python|Python 3\.\d+ or newer/i;

/** The gate whose accept refused because of the machine the gates ran on, with the first line that says so, or
 * undefined. Another machine, with the exports made and the tools there, gets past it, so it is not the product's
 * result and is never recorded. */
export function localRefusal(gates) {
  const refused = gates.find((g) => !g.ok);
  const line = refused?.ran.flatMap((r) => r.out.split("\n")).find((l) => LOCAL.test(l));
  return line ? { stage: refused.stage, line: line.trim() } : undefined;
}
