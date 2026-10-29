// Writes each example's product page (examples/<slug>/view.html: the figure, then the design, the quote and the
// build plan) and copies it to public/examples/<slug>/view.html, so the site can link to it. Runs before
// `next build` and `next dev`. view.html is git-ignored, so a fresh clone (a Vercel build) has none.
// For an example with a figure.mjs this runs `sprue figure <slug> --draft`, which draws the figure, writes the
// page and leaves state.json alone. For one without a figure yet, or when that fails, it runs
// `sprue view <slug> --page`, which writes the page from the files there and changes no tracked file.
// An example whose page can't be written is skipped.
// It also copies what the site's worked example loads in the browser: figure.svg and figure.json (the live
// figure), explorer.json (the stages, without design.md, which the site doesn't show), and for Fig 1's 3D tab the
// model, previews/system.glb, beside model.json, what pipeline/model.ts reads with it (modelView), without the files
// git ignores, which aren't on GitHub, where the site links the others. Once, three.js's vendored modules and their
// licence go to public/vendor/three/, which the site loads when the 3D tab first opens.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const examples = join(root, "skills", "sprue", "examples");
const cli = join(root, "skills", "sprue", "pipeline", "cli.ts");
const out = join(root, "public", "examples");
const three = join(root, "skills", "sprue", "viewer", "vendor", "three");
const threeOut = join(root, "public", "vendor", "three");
const STRIP = ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning"];
/** Where .gitignore keeps a product's own outputs: none of them is on GitHub. */
const IGNORED = /^(fab|pcb|production|history|shots)\//;

/** One `sprue` command, run from a folder whose products/ is the examples folder (the repo root). Null when it
 * worked, else the last lines it printed. */
function sprue(...args) {
  const run = spawnSync(process.execPath, [...STRIP, cli, ...args], { cwd: root, encoding: "utf8" });
  if (run.status === 0) return null;
  return (run.stderr || run.stdout || String(run.error ?? "")).trim().split("\n").slice(-3).join(" ");
}

/** The 3D view's data for an example (pipeline/model.ts modelView), or null when it has no model, or the error. */
function modelOf(slug) {
  const code = `const { modelView } = await import(${JSON.stringify(pathToFileURL(join(root, "skills", "sprue", "pipeline", "model.ts")).href)});` +
    "process.stdout.write(JSON.stringify(modelView(process.argv[1])));";
  const run = spawnSync(process.execPath, [...STRIP, "--input-type=module", "-e", code, join(examples, slug)], { cwd: root, encoding: "utf8" });
  if (run.status !== 0) return { error: (run.stderr || String(run.error ?? "")).trim().split("\n").slice(-2).join(" ") };
  return { view: JSON.parse(run.stdout) };
}

rmSync(out, { recursive: true, force: true });
rmSync(threeOut, { recursive: true, force: true });
const copied = [];
for (const slug of readdirSync(examples)) {
  if (!existsSync(join(examples, slug, "bom.json"))) continue;
  if (!existsSync(join(root, "products", slug))) {
    console.warn(`copy-figures: products/${slug} is missing (the products link to the examples); skipping ${slug}`);
    continue;
  }
  let failed = existsSync(join(examples, slug, "figure.mjs")) ? sprue("figure", slug, "--draft") : "no figure.mjs";
  if (failed) {
    if (failed !== "no figure.mjs") console.warn(`copy-figures: sprue figure ${slug} --draft failed (${failed}); writing the page from the files there`);
    failed = sprue("view", slug, "--page");
    if (failed) console.warn(`copy-figures: sprue view ${slug} --page failed (${failed})`);
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
  const model = modelOf(slug);
  if (model.error) console.warn(`copy-figures: ${slug}'s 3D view couldn't be read (${model.error}); the site shows the drawing only`);
  else if (model.view) {
    const view = model.view;
    for (const [line, list] of Object.entries(view.files)) {
      const kept = list.filter((f) => !IGNORED.test(f.path));
      if (kept.length) view.files[line] = kept;
      else delete view.files[line];
    }
    copyFileSync(join(examples, slug, view.model.file), join(dir, "system.glb"));
    writeFileSync(join(dir, "model.json"), JSON.stringify(view));
    files.push("model.json", "system.glb");
  }
  copied.push(`${slug}/{${files.join(",")}}`);
}
// three.js for the 3D tab: the modules vendor.json lists, and their licence.
const vendor = JSON.parse(readFileSync(join(three, "vendor.json"), "utf8"));
for (const f of [...vendor.files.map((x) => x.file), "vendor.json"]) {
  mkdirSync(join(threeOut, f, ".."), { recursive: true });
  copyFileSync(join(three, f), join(threeOut, f));
}
console.log(`public/examples: ${copied.length ? copied.join(", ") : "no page written"}; public/vendor/three: ${vendor.files.length + 1} files`);
