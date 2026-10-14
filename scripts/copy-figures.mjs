// Writes each example's product page (examples/<slug>/view.html: the figure, then the design, the quote and the
// build plan) and copies it to public/examples/<slug>/view.html, so the site can link to it. Runs before
// `next build` and `next dev`. view.html is git-ignored, so a fresh clone (a Vercel build) has none.
// For an example with a figure.mjs this runs `distinta figure <slug> --draft`, which draws the figure, writes the
// page and leaves state.json alone. For one without a figure yet, or when that fails, it runs
// `distinta view <slug> --page`, which writes the page from the files there and changes no tracked file.
// An example whose page can't be written is skipped.
// It also copies what the site's worked example loads in the browser: figure.svg and figure.json (the live
// figure) and explorer.json (the stages, without design.md, which the site doesn't show).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const examples = join(root, "skills", "distinta", "examples");
const cli = join(root, "skills", "distinta", "pipeline", "cli.ts");
const out = join(root, "public", "examples");

/** One `distinta` command, run from a folder whose products/ is the examples folder (the repo root). Null when it
 * worked, else the last lines it printed. */
function distinta(...args) {
  const run = spawnSync(process.execPath, [
    "--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning",
    cli, ...args,
  ], { cwd: root, encoding: "utf8" });
  if (run.status === 0) return null;
  return (run.stderr || run.stdout || String(run.error ?? "")).trim().split("\n").slice(-3).join(" ");
}

rmSync(out, { recursive: true, force: true });
const copied = [];
for (const slug of readdirSync(examples)) {
  if (!existsSync(join(examples, slug, "bom.json"))) continue;
  if (!existsSync(join(root, "products", slug))) {
    console.warn(`copy-figures: products/${slug} is missing (the products link to the examples); skipping ${slug}`);
    continue;
  }
  let failed = existsSync(join(examples, slug, "figure.mjs")) ? distinta("figure", slug, "--draft") : "no figure.mjs";
  if (failed) {
    if (failed !== "no figure.mjs") console.warn(`copy-figures: distinta figure ${slug} --draft failed (${failed}); writing the page from the files there`);
    failed = distinta("view", slug, "--page");
    if (failed) console.warn(`copy-figures: distinta view ${slug} --page failed (${failed})`);
  }
  const src = join(examples, slug, "view.html");
  if (failed || !existsSync(src)) continue;
  const dir = join(out, slug);
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, join(dir, "view.html"));
  const files = ["view.html"];
  for (const f of ["figure.svg", "figure.json"]) {
    if (!existsSync(join(examples, slug, f))) continue;
    copyFileSync(join(examples, slug, f), join(dir, f));
    files.push(f);
  }
  if (existsSync(join(examples, slug, "explorer.json"))) {
    const ex = JSON.parse(readFileSync(join(examples, slug, "explorer.json"), "utf8"));
    delete ex.designMd;
    writeFileSync(join(dir, "explorer.json"), JSON.stringify(ex));
    files.push("explorer.json");
  }
  copied.push(`${slug}/{${files.join(",")}}`);
}
console.log(`public/examples: ${copied.length ? copied.join(", ") : "no page written"}`);
