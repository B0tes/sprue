// Copies each example's stage 1 figure (examples/<slug>/figure.html) to public/examples/<slug>/figure.html, so the
// site can link to the interactive figure. Runs before `next build` and `next dev`. figure.html is git-ignored, so
// a fresh clone (a Vercel build) has none: for every example with a figure.mjs this first runs
// `anatomy figure <slug> --draft`, which writes the page and leaves state.json alone. If that fails, whatever
// figure.html is there is copied, and an example without one is skipped.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const examples = join(root, "skills", "anatomy-2", "examples");
const cli = join(root, "skills", "anatomy-2", "pipeline", "cli.ts");
const out = join(root, "public", "examples");

/** `anatomy figure <slug> --draft`, run from a folder whose products/ is the examples folder (the repo root). */
function draw(slug) {
  if (!existsSync(join(root, "products", slug))) return `products/${slug} is missing (the products link to the examples)`;
  const run = spawnSync(process.execPath, [
    "--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning",
    cli, "figure", slug, "--draft",
  ], { cwd: root, encoding: "utf8" });
  if (run.status === 0) return null;
  return (run.stderr || run.stdout || String(run.error ?? "")).trim().split("\n").slice(-3).join(" ");
}

rmSync(out, { recursive: true, force: true });
const copied = [];
for (const slug of readdirSync(examples)) {
  if (existsSync(join(examples, slug, "figure.mjs"))) {
    const failed = draw(slug);
    if (failed) console.warn(`copy-figures: anatomy figure ${slug} --draft failed (${failed}); copying the figure.html that is there, if any`);
  }
  const src = join(examples, slug, "figure.html");
  if (!existsSync(src)) continue;
  mkdirSync(join(out, slug), { recursive: true });
  copyFileSync(src, join(out, slug, "figure.html"));
  copied.push(slug);
}
console.log(`public/examples: ${copied.length ? copied.join(", ") : "no figure.html found"}`);
