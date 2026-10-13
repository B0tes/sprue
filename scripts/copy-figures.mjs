// Copies each example's stage 1 figure (examples/<slug>/figure.html, written by `anatomy figure`) to
// public/examples/<slug>/figure.html, so the site can link to the interactive figure. Runs before
// `next build` and `next dev`. figure.html is git-ignored and generated, so a missing one is skipped.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const examples = join(root, "skills", "anatomy-2", "examples");
const out = join(root, "public", "examples");

rmSync(out, { recursive: true, force: true });
const copied = [];
for (const slug of readdirSync(examples)) {
  const src = join(examples, slug, "figure.html");
  if (!existsSync(src)) continue;
  mkdirSync(join(out, slug), { recursive: true });
  copyFileSync(src, join(out, slug, "figure.html"));
  copied.push(slug);
}
console.log(`public/examples: ${copied.length ? copied.join(", ") : "no figure.html found"}`);
