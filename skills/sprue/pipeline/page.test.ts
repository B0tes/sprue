// Fig 1 on the product page (pipeline/page.ts writePage, viewer/view.html). With a model (pipeline/model.ts
// modelView) it has a Drawing and a 3D tab: the drawing shows, the 3D tab's corners and the bar under it are hidden,
// the vendored three.js is in the page as text (each module as vendored, under its licence, which is in the page once)
// and the view's data holds the model in base64; without a model, or without a drawing, Fig 1 is as it was. No text
// in the page's data (a part's name) can end its script. viewer/model.js points each module's imports at the modules
// before it (rewriteImports, as V8 lists them), and says which tab a hash opens (tabOfHash) and what the line over a
// model of an earlier design says (staleOf). Then the page from file:// in Chromium, where Playwright can be resolved
// (skipped where it can't, as in CI): the 3D view is made only when its tab opens, ready with no console error, as
// tall as the drawing, its bar, legend and panel under the card; a click picks a part; the drawing's keys stay off
// while it is hidden and its readout is its own; the tab is remembered, and #3d or #part= opens it; the arrow keys,
// Home and End move between the tabs; a three.js that won't load says so and leaves the drawing; a colour the page
// gives with color-mix() is read; on a phone the page scrolls past the model. Run with
//   node --test skills/sprue/pipeline/page.test.ts
// and, for the Chromium half, NODE_PATH set to a node_modules that has playwright (SPRUE_BROWSER_TESTS=1 fails where
// it can't run, rather than skipping).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { modelView } from "./model.ts";
import { writePage } from "./page.ts";
import type { Bom } from "./types.ts";
import { rewriteImports, staleOf, tabOfHash } from "../viewer/model.js";

const SKILL = join(import.meta.dirname, "..");
const VIEWER = join(SKILL, "viewer");
const THREE_DIR = join(VIEWER, "vendor", "three");
const root = mkdtempSync(join(tmpdir(), "sprue-page-"));
after(() => rmSync(root, { recursive: true, force: true }));
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

type ThreeFile = { file: string; name?: string; imports?: string[] };
const vendor = json<{ package: { version: string }; files: ThreeFile[] }>(join(THREE_DIR, "vendor.json"));
const modules = vendor.files.filter((f) => f.name);
const license = readFileSync(join(THREE_DIR, "LICENSE"), "utf8").trim();

/** An example as products/<name> in the temporary root, as the repo has it: without fab/ and pcb/, which git ignores,
 * so the keypad's whole-product check reads as of an earlier design (it was run on the board's zip). */
function product(slug: string, name: string) {
  const dir = join(root, "products", name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(SKILL, "examples", slug), dir, { recursive: true, filter: (src) => !/[/\\](fab|pcb|shots|production|history)$/.test(src) });
  return dir;
}
/** view.html, written from the temporary root as the commands write it. */
function pageOf(name: string) {
  const here = process.cwd();
  try {
    process.chdir(root);
    writePage(name);
  } finally {
    process.chdir(here);
  }
  return readFileSync(join(root, "products", name, "view.html"), "utf8");
}
/** The page's script elements as an HTML parser splits them: each ends at the first "</script" after it opens. */
const scriptsOf = (html: string) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script/gi)].map((m) => ({ attrs: m[1], text: m[2] }));
/** The tags with data-a2-pane="name" in the page. */
const paneTags = (html: string, name: string) => html.match(new RegExp(`<[a-z]+\\b[^>]*data-a2-pane="${name}"[^>]*>`, "g")) ?? [];

test("Fig 1 has a Drawing and a 3D tab when the folder has a model: three.js inlined as text under its licence, and the view's data", () => {
  const dir = product("macropad", "keypad");
  const html = pageOf("keypad");
  const view = modelView(dir)!;
  const fig = json<{ title: string; width: number; height: number; parts: { count: number }[] }>(join(dir, "figure.json"));
  // The tabs: the drawing chosen, the 3D tab reached by the arrow keys.
  const tabs = html.match(/<button\b[^>]*role="tab"[^>]*>[^<]*<\/button>/g)!;
  assert.equal(tabs.length, 2);
  assert.match(tabs[0], /id="a2-tab-drawing" data-a2-tab="drawing" aria-controls="a2-pane-drawing" aria-selected="true">Drawing</);
  assert.match(tabs[1], /id="a2-tab-3d" data-a2-tab="3d" aria-controls="a2-pane-3d" aria-selected="false" tabindex="-1">3D</);
  assert.match(html, /<div class="a2-tabs" role="tablist" aria-label="Fig 1"><button/);
  // The panes: the drawing in its own, the 3D one empty until its tab opens, as wide and as tall as the drawing.
  assert.match(html, /<div id="a2-pane-drawing" role="tabpanel" aria-labelledby="a2-tab-drawing" data-a2-pane="drawing"><div class="iso-stage a2-stage"><svg/);
  assert.ok(html.includes(`<div id="a2-pane-3d" role="tabpanel" aria-labelledby="a2-tab-3d" data-a2-pane="3d" hidden><div class="a2-model-pane" style="--a2-aspect:${fig.width}/${fig.height}"></div></div>`));
  // Each tab's readout in the card's corner, the 3D one hidden; the drawing's controls and caption on its tab, the
  // 3D view's place under the card on the other.
  const total = fig.parts.reduce((s, p) => s + p.count, 0);
  assert.ok(html.includes(`data-corner="readout" data-readout data-a2-pane="drawing">assembled · ${total} parts</span>`));
  assert.ok(html.includes(`data-corner="readout" data-a2-readout="3d" data-a2-pane="3d" hidden>3D · ${view.items.length} parts</span>`));
  assert.ok(html.includes(`<div data-a2-controls data-a2-pane="drawing"></div><div class="a2-model-under" data-a2-model="under" data-a2-pane="3d" hidden></div>`));
  assert.ok(paneTags(html, "3d").length >= 3);
  for (const tag of paneTags(html, "3d")) assert.match(tag, / hidden[ >]/, tag);
  for (const tag of paneTags(html, "drawing")) assert.doesNotMatch(tag, / hidden[ >]/, tag);
  // Every script ends where it should: as many end tags as there are scripts, and none opens inside another.
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, (html.match(/<\/script>/g) ?? []).length);
  for (const s of scripts) assert.doesNotMatch(s.text, /<script/i);
  // three.js: each module as text, as vendored, in vendor.json's order (each after what it imports).
  const three = scripts.filter((s) => /type="text\/plain" data-a2-three=/.test(s.attrs));
  assert.deepEqual(three.map((s) => /data-a2-three="([^"]*)"/.exec(s.attrs)![1]), modules.map((m) => m.name));
  for (const [i, m] of modules.entries()) assert.ok(three[i].text === readFileSync(join(THREE_DIR, m.file), "utf8"), `${m.file} is in the page as vendored`);
  // Its licence once, in a comment before the modules, with nothing in it that ends the comment early.
  const notice = /<!-- three\.js (\S+) \(https:\/\/threejs\.org\)([\s\S]*?)-->/.exec(html)!;
  assert.equal(notice[1], vendor.package.version);
  assert.ok(notice[2].includes(license), "the LICENSE, whole");
  assert.equal(html.split("The MIT License").length - 1, 1);
  assert.ok(notice.index < html.indexOf("data-a2-three="));
  // The data: the view as modelView makes it, the model's bytes, the modules' names and imports, the product's name.
  const data = JSON.parse(scripts.find((s) => / id="a2-model-data"/.test(s.attrs))!.text);
  assert.deepEqual(data.view, JSON.parse(JSON.stringify(view)));
  assert.deepEqual(view.stale, ["pcb/macropad-gerbers.zip"], "without the board's zip, the check reads as of an earlier design");
  assert.equal(data.glb, readFileSync(join(dir, view.model.file)).toString("base64"));
  assert.deepEqual(data.three, modules.map((m) => ({ name: m.name, file: m.file, imports: m.imports ?? [] })));
  assert.equal(data.title, fig.title);
  // The 3D view's code and look are in the page, and none of the template's marks is left.
  assert.ok(html.includes(readFileSync(join(VIEWER, "model.css"), "utf8")));
  assert.ok(html.includes(readFileSync(join(VIEWER, "model.js"), "utf8")));
  assert.doesNotMatch(html, /<!--\/?MODEL(_DATA)?-->|\/\*(MODEL_JS|PAGE_[A-Z]+|FIGURE_JS|EXPLORER_JS)\*\//);
});

test("without a model, or without a drawing, Fig 1 is as it was: no tabs and no three.js", () => {
  const assertNoModel = (html: string, why: string) => {
    for (const s of ['role="tablist"', "data-a2-pane", "data-a2-three", "a2-model-data", "a2-model-under", ".a2-tabs{", "MODEL", "The MIT License"])
      assert.ok(!html.includes(s), `${why}: no ${s}`);
  };
  const dir = product("macropad", "flat");
  rmSync(join(dir, "previews", "system.glb"));
  let html = pageOf("flat");
  assertNoModel(html, "no system.glb");
  assert.match(html, /<span class="iso-plate-corner" data-corner="readout" data-readout>assembled · \d+ parts<\/span>/);
  assert.match(html, /<div data-a2-controls><\/div>/);
  rmSync(join(dir, "system.json"));
  html = pageOf("flat");
  assertNoModel(html, "no system.json");
  // A model but no drawing: the 3D tab needs the drawing's card.
  const bare = product("macropad", "bare");
  rmSync(join(bare, "figure.svg"));
  assert.ok(modelView(bare));
  html = pageOf("bare");
  assertNoModel(html, "no figure.svg");
  assert.match(html, /<p class="a2-nofig">/);
});

test("no text in the page's data can end its script or open a comment in it: a part named </script><!--<script>", () => {
  const dir = product("macropad", "odd");
  const name = `Case </script><!--<script> "quoted" & <b>`;
  const bom = json<Bom>(join(dir, "bom.json"));
  const id = bom.lines[0].id;
  bom.lines[0].name = name;
  writeFileSync(join(dir, "bom.json"), JSON.stringify(bom, null, 2));
  const html = pageOf("odd");
  assert.ok(!html.includes("</script><!--"));
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, (html.match(/<\/script>/g) ?? []).length);
  const data = (sid: string) => JSON.parse(scripts.find((s) => s.attrs.includes(` id="${sid}"`))!.text);
  assert.equal(data("a2-model-data").view.lines[id].name, name);
  assert.equal(data("a2-page-data").lines[id].name, name);
});

/** V8's own list of each module's static imports and re-exports (vm.SourceTextModule), which a comment or a string
 * can't fool; it needs --experimental-vm-modules, so it runs in a child. */
function specifiersOf(sources: string[]): string[][] {
  const files = sources.map((src, i) => {
    const file = join(root, `module-${i}.mjs`);
    writeFileSync(file, src);
    return file;
  });
  return JSON.parse(execFileSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e",
    `import vm from "node:vm"; import { readFileSync } from "node:fs";
     console.log(JSON.stringify(JSON.parse(process.env.FILES).map((f) => new vm.SourceTextModule(readFileSync(f, "utf8"), { identifier: f }).dependencySpecifiers)));`],
  { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", FILES: JSON.stringify(files) } }));
}

test("rewriteImports points every import of each vendored module at the URL of the module before it, as V8 lists them", () => {
  const urls = new Map(modules.map((m, i) => [m.name!, `blob:null/0000000${i}-three`]));
  const sources = modules.map((m) => readFileSync(join(THREE_DIR, m.file), "utf8"));
  const out = modules.map((m, i) => rewriteImports(sources[i], m.imports ?? [], (name: string) => urls.get(name)));
  const listed = specifiersOf(out);
  for (const [i, m] of modules.entries()) {
    assert.deepEqual(listed[i], (m.imports ?? []).map((name) => urls.get(name)), `${m.file}: every import is a URL`);
    // Only the names changed: put back, each module is as vendored.
    let back = out[i];
    for (const name of m.imports ?? []) back = back.split(urls.get(name)!).join(name);
    assert.ok(back === sources[i], `${m.file}: nothing else changed`);
  }
  // three.module.js imports three/core twice (an import and an export *): both go.
  assert.equal(out[1].split(urls.get("three/core")!).length - 1, 2);

  const blob = (name: string) => `blob:x/${name}`;
  const src = `import{a as b}from"three";export*from'three/core';import "three/core";import x from "three/addons/x.js";const s="three",t='three/core';`;
  assert.equal(rewriteImports(src, ["three", "three/core", "three/addons/x.js"], blob),
    `import{a as b}from"blob:x/three";export*from'blob:x/three/core';import "blob:x/three/core";import x from "blob:x/three/addons/x.js";const s="three",t='three/core';`);
  // "three" is not three/core, and a name vendor.json lists must be imported, and loaded before.
  assert.throws(() => rewriteImports(`import{a}from"three/core";`, ["three"], blob), /^Error: it doesn't import three, as vendor\.json says it does$/);
  assert.throws(() => rewriteImports(`import "three";`, ["three/core"], blob), /it doesn't import three\/core/);
  assert.throws(() => rewriteImports(`import "three";`, ["three"], () => undefined), /^Error: it imports three, which isn't loaded before it$/);
  assert.equal(rewriteImports(`const s = 1;`, [], () => undefined), `const s = 1;`);
});

test("tabOfHash opens the 3D tab for #3d or a part of the model, and staleOf names what changed since the model was drawn", () => {
  for (const [hash, tab] of [["#3d", "3d"], ["3d", "3d"], ["#part=sw5", "3d"], ["#apart&3d", "3d"], ["#step=2&part=cap1", "3d"],
    ["", null], ["#", null], ["#apart", null], ["#step=3", null], ["#select=pcb", null], ["#3D", null], ["#3dx", null], ["#xpart=1", null]] as const)
    assert.equal(tabOfHash(hash), tab, hash);
  assert.equal(tabOfHash(undefined as unknown as string), null);
  const view = (stale: string[]) => ({ stale }) as Parameters<typeof staleOf>[0];
  assert.equal(staleOf(view([])), "");
  assert.equal(staleOf({} as Parameters<typeof staleOf>[0]), "");
  const tail = "changed since sprue system drew it, so a part may not be where it is now. Run sprue system again to draw it.";
  assert.equal(staleOf(view(["cad/case.py"])), `A model of an earlier design: cad/case.py has ${tail}`);
  assert.equal(staleOf(view(["a", "b"])), `A model of an earlier design: a and b have ${tail}`);
  assert.equal(staleOf(view(["a", "b", "c"])), `A model of an earlier design: a, b and c have ${tail}`);
  assert.equal(staleOf(view(["a", "b", "c", "d"])), `A model of an earlier design: a, b, c and 1 more have ${tail}`);
  assert.equal(staleOf(view(["a", "b", "c", "d", "e"])), `A model of an earlier design: a, b, c and 2 more have ${tail}`);
});

// ---- in Chromium, from file:// --------------------------------------------------------------------------------------

/** What these tests use of Playwright, which the repo does not depend on: it is used where it is installed. */
type Point = { x: number; y: number };
type Tab = {
  on(event: "console", fn: (m: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", fn: (e: Error) => void): void;
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg?: A, opts?: { timeout?: number; polling?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  textContent(selector: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  click(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
};
type Context = { newPage(): Promise<Tab>; close(): Promise<void> };
type Browser = { newContext(opts: { viewport: { width: number; height: number } }): Promise<Context>; close(): Promise<void> };
type Made = { pinned: string | null; apart: boolean; at: number; screenOf(id: string): Point | null };
type W = { sprueFig1: { tabs: { now: string }; model(): Promise<Made | null> | null } };

/** Playwright's Chromium with WebGL drawn by SwiftShader, or why there is none here. */
async function chromium(): Promise<{ browser?: Browser; why?: string }> {
  let pw: { chromium: { launch(opts: { args: string[] }): Promise<Browser> } };
  try {
    pw = createRequire(import.meta.url)("playwright");
  } catch {
    return { why: "Playwright couldn't be resolved: set NODE_PATH to a node_modules that has it" };
  }
  try {
    return { browser: await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }) };
  } catch (e) {
    return { why: `Chromium did not start (${(e as Error).message.split("\n")[0]})` };
  }
}

test("in Chromium from file://: the 3D tab, made when it opens, beside the drawing", async (t) => {
  const must = process.env.SPRUE_BROWSER_TESTS === "1";
  const { browser, why } = await chromium();
  if (!browser) return must ? assert.fail(why) : t.skip(why);
  try {
    const keypadDir = product("macropad", "b-keypad");
    const keypad = pageOf("b-keypad");
    product("ponder", "b-ponder");
    pageOf("b-ponder");
    const view = modelView(keypadDir)!;
    // A three.js whose core exports nothing the rest imports: it can't be linked.
    const broken = keypad.replace(/(<script type="text\/plain" data-a2-three="three\/core">)[\s\S]*?(<\/script>)/, "$1export const nothing = 0;$2");
    assert.notEqual(broken, keypad);
    writeFileSync(join(keypadDir, "broken.html"), broken);
    const url = (name: string, hash = "", file = "view.html") => pathToFileURL(join(root, "products", name, file)).href + hash;

    let said: string[] = [];
    /** A new browser (its own storage) at `width` x `height`, its console's errors and warnings and the page's
     * uncaught errors kept in `said`. */
    const open = async (width = 1440, height = 900) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const tab = await context.newPage();
      tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") said.push(`${m.type()}: ${m.text()}`); });
      tab.on("pageerror", (e) => said.push(`pageerror: ${e.message}`));
      return { context, tab };
    };
    const probe = await open(400, 300);
    await probe.tab.goto(url("b-keypad"));
    const gl = await probe.tab.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    await probe.context.close();
    if (!gl) return must ? assert.fail("this Chromium has no WebGL 2") : t.skip("this Chromium has no WebGL 2");
    said = [];

    /** The 3D view's state once it is ready ("ready", or what it says instead). */
    const settled = async (tab: Tab) => {
      await tab.waitForFunction(() => {
        const s = document.querySelector(".a2-model")?.getAttribute("data-state");
        return (s && s !== "loading") || document.querySelector(".a2-model-wait");
      }, undefined, { timeout: 30000 });
      return tab.evaluate(() => document.querySelector(".a2-model")?.getAttribute("data-state") ?? document.querySelector(".a2-model-wait")!.textContent);
    };
    const made = <R>(tab: Tab, fn: (m: Made) => R) =>
      tab.evaluate(async (src) => new Function("m", `return (${src})(m)`)(await (window as unknown as W).sprueFig1.model()) as R, fn.toString());
    const shown = (tab: Tab) => tab.evaluate(() => ({
      view: document.querySelector("[data-a2-figure]")!.getAttribute("data-a2-view"),
      selected: [...document.querySelectorAll('[role="tab"]')].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.id),
      focused: document.activeElement?.id ?? "",
    }));
    const plate = (tab: Tab) => tab.evaluate(() => document.querySelector(".iso-plate")!.getBoundingClientRect().height);
    const drawingApart = (tab: Tab) => tab.textContent('[data-a2-controls] [data-a2="apart"]');
    /** Points at a part of the drawing (its first group of the line) as a pointer would, and what its readout says. */
    const pointAt = async (tab: Tab, line: string | null) => {
      await tab.evaluate((line) => {
        const svg = document.querySelector(".a2-stage svg")!;
        if (line) svg.querySelector(`.a2-part[data-line="${line}"] *`)!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        else svg.dispatchEvent(new PointerEvent("pointerleave"));
      }, line);
      return tab.textContent("[data-readout]");
    };

    // ---- The keypad at 1440 x 900: the drawing first, nothing of the 3D view made.
    const { context, tab } = await open();
    await tab.goto(url("b-keypad"));
    await tab.waitForTimeout(300);
    assert.deepEqual(await shown(tab), { view: "drawing", selected: ["a2-tab-drawing"], focused: "" });
    assert.equal(await tab.evaluate(() => document.querySelector(".a2-model") === null && document.querySelector(".a2-model-pane")!.childElementCount === 0
      && (window as unknown as W).sprueFig1.model() === null), true, "the 3D view is made when its tab opens, not before");
    for (const s of ["#a2-pane-drawing", "[data-a2-controls]", '[data-corner="hint"]', ".a2-caption"]) assert.equal(await tab.isVisible(s), true, s);
    for (const s of ["#a2-pane-3d", '[data-a2-readout="3d"]', ".a2-model-under"]) assert.equal(await tab.isVisible(s), false, s);
    const drawn = await plate(tab);
    const rest = await tab.textContent("[data-readout]");
    const capSays = await pointAt(tab, "cap");
    assert.notEqual(capSays, rest);
    assert.equal(await pointAt(tab, null), rest);
    // With nothing focused, E takes the drawing apart and back.
    await tab.keyboard.press("e");
    assert.equal(await drawingApart(tab), "Put together");
    await tab.keyboard.press("e");
    assert.equal(await drawingApart(tab), "Take apart");

    // The 3D tab: made, ready, as tall as the drawing, its readout in the corner, its bar, legend and panel under the
    // card, and the line that says the model is of an earlier design over its bar.
    const t0 = performance.now();
    await tab.click("#a2-tab-3d");
    assert.equal(await settled(tab), "ready");
    const took = Math.round(performance.now() - t0);
    assert.deepEqual(await shown(tab), { view: "3d", selected: ["a2-tab-3d"], focused: "a2-tab-3d" });
    for (const s of ["#a2-pane-drawing", "[data-a2-controls]", '[data-corner="hint"]', ".a2-caption", "[data-readout]"]) assert.equal(await tab.isVisible(s), false, s);
    for (const s of ["#a2-pane-3d", '[data-a2-readout="3d"]', ".a2-model-under", ".a2-model-pane .a2-model-stage canvas"]) assert.equal(await tab.isVisible(s), true, s);
    assert.ok(Math.abs((await plate(tab)) - drawn) < 1, `the card is as tall on both tabs: ${drawn} / ${await plate(tab)}`);
    assert.equal(await tab.textContent('[data-a2-readout="3d"]'), `3D · ${view.items.length} parts`);
    assert.deepEqual(await tab.evaluate(() => [...document.querySelector(".a2-model-under")!.children].map((el) => el.className)),
      ["a2-model-stale", "a2-bar a2-model-bar", "a2-model-mass", "a2-model-legend", "a2-model-panel"]);
    assert.equal(await tab.evaluate(() => document.querySelector(".a2-model-pane .a2-model-bar, .a2-model-pane .a2-model-legend, .a2-model-pane .a2-model-panel")), null);
    assert.equal(await tab.textContent(".a2-model-stale"), staleOf(view));
    assert.equal(await tab.evaluate(() => { try { return localStorage.getItem("sprue:fig1"); } catch { return "no storage"; } }), "3d");

    // A click on a keycap picks it, and the 3D readout says so, not the drawing's.
    await tab.evaluate(() => document.querySelector(".a2-model-stage")!.scrollIntoView({ block: "center" }));
    const cap = (await made(tab, (m) => m.screenOf("cap5")))!;
    await tab.mouse.click(cap.x, cap.y);
    assert.equal(await made(tab, (m) => m.pinned), "cap5");
    // Each view says it in its own readout: the 3D view the part, the drawing (which follows, its own hidden) the line.
    const partSays = await tab.textContent('[data-a2-readout="3d"]');
    assert.match(partSays!, /cap5|Keycap 5|5/);
    assert.notEqual(partSays, capSays);
    assert.equal(await tab.textContent("[data-readout]"), capSays, "the drawing's readout is its own");
    await tab.keyboard.press("Escape");
    await tab.mouse.move(2, 2);

    // The drawing's keys are off while it is hidden: E on the 3D tab, or with nothing focused, moves nothing.
    await tab.focus("#a2-tab-3d");
    await tab.keyboard.press("e");
    await tab.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tab.keyboard.press("e");
    await tab.waitForTimeout(100);
    assert.deepEqual([await drawingApart(tab), await made(tab, (m) => m.apart)], ["Take apart", false]);
    // The 3D bar's keys are the 3D view's (the bar is outside the model's own box now): ] there is one step for both
    // views, which follow each other; the arrows, the drawing's steps, move neither.
    await tab.focus('.a2-model-under [data-a2m="fit"]');
    await tab.keyboard.press("ArrowRight");
    await tab.waitForTimeout(100);
    assert.equal(await made(tab, (m) => m.at), 0);
    assert.doesNotMatch((await tab.textContent('[data-a2-controls] [data-a2="count"]'))!, /^Step/);
    await tab.keyboard.press("]");
    assert.equal(await made(tab, (m) => m.at), 1);
    assert.match((await tab.textContent('[data-a2-controls] [data-a2="count"]'))!, /^Step 1 \//);
    await tab.keyboard.press("[");
    assert.equal(await made(tab, (m) => m.at), 0);

    // Back on the drawing, the 3D view (made) leaves the drawing's readout to it, and its own corner hidden.
    await tab.click("#a2-tab-drawing");
    assert.deepEqual(await shown(tab), { view: "drawing", selected: ["a2-tab-drawing"], focused: "a2-tab-drawing" });
    assert.equal(await tab.isVisible('[data-a2-readout="3d"]'), false);
    assert.equal(await pointAt(tab, "cap"), capSays);
    await pointAt(tab, null);
    // (once the parts are back from the step the 3D view took them to: on the way it says so)
    await tab.waitForFunction((rest) => document.querySelector("[data-readout]")!.textContent === rest, rest, { timeout: 10000 });
    assert.ok(Math.abs((await plate(tab)) - drawn) < 1);

    // The arrow keys, Home and End move between the tabs (and round), and take the focus with them.
    await tab.focus("#a2-tab-drawing");
    for (const [key, to] of [["ArrowRight", "3d"], ["ArrowRight", "drawing"], ["ArrowLeft", "3d"], ["Home", "drawing"], ["End", "3d"]] as const) {
      await tab.keyboard.press(key);
      assert.deepEqual(await shown(tab), { view: to, selected: [`a2-tab-${to}`], focused: `a2-tab-${to}` }, key);
    }
    // The tab chosen last is where the page opens next time, and the model is made at once.
    await tab.reload();
    assert.equal(await settled(tab), "ready");
    assert.equal((await shown(tab)).view, "3d");
    await tab.click("#a2-tab-drawing");
    await tab.reload();
    await tab.waitForTimeout(300);
    assert.equal((await shown(tab)).view, "drawing");
    assert.equal(await tab.evaluate(() => document.querySelector(".a2-model")), null);
    await context.close();
    assert.deepEqual(said, [], "no console errors or warnings");

    // #3d opens the 3D tab, and #part=<id> with that part picked; anything else leaves the drawing.
    for (const [hash, tabName, pinned] of [["#3d", "3d", null], ["#part=cap1", "3d", "cap1"], ["#apart", "drawing", null]] as const) {
      const fresh = await open();
      await fresh.tab.goto(url("b-keypad", hash));
      if (tabName === "3d") {
        assert.equal(await settled(fresh.tab), "ready", hash);
        assert.equal(await made(fresh.tab, (m) => m.pinned), pinned, hash);
      } else {
        await fresh.tab.waitForTimeout(300);
        assert.equal(await fresh.tab.evaluate(() => document.querySelector(".a2-model")), null, hash);
      }
      assert.equal((await shown(fresh.tab)).view, tabName, hash);
      await fresh.context.close();
    }
    // A hash that asks for the model later opens its tab.
    const later = await open();
    await later.tab.goto(url("b-keypad"));
    await later.tab.evaluate(() => { location.hash = "part=cap2"; });
    assert.equal(await settled(later.tab), "ready");
    assert.equal((await shown(later.tab)).view, "3d");
    await later.context.close();
    assert.deepEqual(said, [], "no console errors or warnings");

    // A colour the page gives as color-mix(), as the website's are, is read (three.js can't parse one, and warns).
    const mixed = await open();
    await mixed.tab.goto(url("b-keypad"));
    await mixed.tab.evaluate(() => {
      const pane = document.querySelector<HTMLElement>(".a2-model-pane")!;
      pane.style.setProperty("--anatomy-face", "color-mix(in srgb, #ff0000 50%, #0000ff)");
      pane.style.setProperty("--anatomy-hi", "not a colour");
    });
    await mixed.tab.click("#a2-tab-3d");
    assert.equal(await settled(mixed.tab), "ready");
    await mixed.tab.waitForTimeout(200);
    await mixed.context.close();
    assert.deepEqual(said, [], "no THREE.Color warning");

    // Ponder: its 62 parts.
    const ponder = await open();
    await ponder.tab.goto(url("b-ponder"));
    const ponderDrawn = await plate(ponder.tab);
    await ponder.tab.click("#a2-tab-3d");
    assert.equal(await settled(ponder.tab), "ready");
    assert.equal(await ponder.tab.textContent('[data-a2-readout="3d"]'), `3D · ${modelView(join(root, "products", "b-ponder"))!.items.length} parts`);
    assert.ok(Math.abs((await plate(ponder.tab)) - ponderDrawn) < 1);
    await ponder.context.close();
    assert.deepEqual(said, [], "no console errors or warnings");

    // On a phone the model is under half the screen tall, so the page scrolls past it (a drag on it turns it), and
    // nothing is wider than the screen.
    const phone = await open(390, 844);
    await phone.tab.goto(url("b-keypad", "#3d"));
    assert.equal(await settled(phone.tab), "ready");
    const fit = await phone.tab.evaluate(() => ({ stage: document.querySelector(".a2-model-stage")!.getBoundingClientRect().height,
      wide: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight }));
    assert.ok(fit.stage < fit.height / 2, `the model is ${fit.stage} px of a ${fit.height} px screen`);
    assert.ok(fit.wide <= fit.width, `the page is ${fit.wide} px wide on a ${fit.width} px screen`);
    await phone.context.close();
    assert.deepEqual(said, [], "no console errors or warnings");

    // A three.js that can't load says so on the 3D tab, and the drawing is as it was.
    const bad = await open();
    await bad.tab.goto(url("b-keypad", "", "broken.html"));
    await bad.tab.click("#a2-tab-3d");
    assert.match(await settled(bad.tab) as string, /^The 3D view couldn't load here \(three\.js: The requested module 'three\/core' does not provide an export named '\w+'\)\. The drawing shows the product\.$/);
    await bad.tab.click("#a2-tab-drawing");
    assert.equal(await bad.tab.isVisible("#a2-pane-drawing svg"), true);
    await bad.tab.keyboard.press("e");
    assert.equal(await drawingApart(bad.tab), "Put together");
    await bad.context.close();
    t.diagnostic(`the keypad's 3D tab was ready ${took} ms after the click`);
  } finally {
    await browser.close();
  }
});
