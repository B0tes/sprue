// The product page, products/<slug>/view.html: one page for the whole run, which grows with it.
//   top      the product, the brief, the four stages with their gates (state.json) and what to type at the
//            current one
//   Fig 1    the figure figure.mjs draws (figure.svg and figure.json, from `sprue figure`), live with
//            viewer/figure.js; until it is drawn, one line says so. With a model (previews/system.glb, which the
//            whole-product check draws, and what pipeline/model.ts reads beside it) it has a Drawing and a 3D tab in
//            one card: viewer/model.js, three.js (viewer/vendor/three/, with its licence) and the model are inlined,
//            and the 3D view is made the first time its tab opens
//   stages   viewer/explorer.js in its stages layout: Design (parts, numbers, checks, CAD, what to know before
//            accepting), Inspect (the whole product), Source once there is a quote, Build once there is a plan
// `sprue figure` and `sprue view` write it, `sprue all` too, and every other command that changes what it
// shows (a gate, the checks, the quote, the plan) rewrites it when it is there. Everything is inline, so the
// page opens from disk with no server. The template is viewer/view.html.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { batchNeed, exists, productDir, readJson, writeText } from "./io.ts";
import { build, loadCatalog, loadRates, type Explorer, type InspectSummary } from "./explore.ts";
import { wholeProduct } from "./gates.ts";
import { readQuotes } from "./stages/quote.ts";
import { gateOf, readState, STAGES, type Stage, type State } from "./state.ts";
import { modelView, type ModelView } from "./model.ts";
import type { FigureJson } from "./figure.ts";
import type { Bom, Request } from "./types.ts";

const VIEWER = join(import.meta.dirname, "..", "viewer");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline JSON and JS can't close their own script tag. */
const inline = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
/** JSON for a script element the page holds as data: every < escaped, so no text in it (a part's name, a problem's)
 * can end the script or open a comment that would hide its end. */
const jsonScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export type PageFigure = { figure: FigureJson; svg: string };

/** ISO_CSS's light block again under prefers-color-scheme: the page is dark unless the system is light. */
function lightUnderMedia() {
  const block = k.ISO_CSS.match(/\.iso\[data-theme="light"\]\{([^}]*)\}/);
  return block ? `@media (prefers-color-scheme:light){html{color-scheme:light}.iso[data-theme="auto"]{${block[1]}}}` : "";
}

const STAGE_WORDS: Record<Stage, string> = { design: "the design", inspect: "the whole product, inspected", source: "the parts and the quote", build: "the build plan and the package" };

/** What to type in Claude Code at the current gate, one command a row. `system` is how system.json stands against the
 * files as they are (explore.ts inspectOf), for Inspect's gate. */
function gateNote(slug: string, state: State, bom: Bom, system?: InspectSummary["system"]) {
  const cmd = (s: string, does: string) => `<li><code>/sprue ${esc(s)}</code><span>${does}</span></li>`;
  const list = (...rows: string[]) => `<ul class="a2-cmds">${rows.join("")}</ul>`;
  const note = (lead: string, body = "") =>
    `<div class="a2-gate-note" data-stage="${state.stage}" data-status="${state.stage === "done" ? "done" : state.stages[state.stage]?.status ?? "drafting"}"><p>${lead}</p>${body}</div>`;
  if (state.stage === "done")
    return note(existsSync(join(productDir(slug), "production"))
      ? `Every stage is accepted: the design, the whole product, the parts and the quote, and the build package in <code>products/${esc(slug)}/production/</code>. Nothing has been ordered.`
      : "Every stage is accepted: the design, the whole product, the parts and the quote, and the build plan. Nothing has been ordered.");
  const g = state.stages[state.stage];
  const n = STAGES.indexOf(state.stage) + 1;
  const edit = cmd(`edit ${slug} <change>`, "change the design: a size, a part, the units");
  const decline = cmd(`decline ${slug} <why>`, "decline it, with the reason");
  if (g?.status === "declined")
    return note(`You declined stage ${n}, ${STAGE_WORDS[state.stage]}${g.note ? `: ${esc(g.note)}` : ""}. Tell Claude what to change, and the page shows it again when it is ready.`,
      list(...(state.stage === "source" ? [cmd(`swap ${slug} <line>`, "another part or another shop for one line")] : []), edit));
  // Inspect's gate is not offered while the whole product fails its check: the accept would be refused.
  if (state.stage === "inspect") {
    const w = wholeProduct(productDir(slug), bom);
    if (!w.ok) {
      const again = "the gate opens once it passes. Nothing is ordered.";
      // A check that failed has problems to count, and the design is what changes.
      if (w.failed.length)
        return note(`Stage ${n}: the whole product fails its check, with ${w.problems} problem${w.problems === 1 ? "" : "s"}. Claude fixes the design and inspects it again; ${again}`);
      // One not run on the files as they are (none written, stale, missing, unreadable) has nothing to fix yet:
      // `sprue inspect` runs it and proposes the gate (`sprue system`, which systemAudit's detail names, proposes nothing).
      const inspect = list(cmd(`inspect ${slug}`, "check the whole product as it is now; it proposes the gate once it passes"));
      if (system === "unwritten")
        return note(`Stage ${n}: nothing checks the whole product yet: there is no <code>cad/_system.py</code>. Claude writes it, then inspects the product; ${again}`, inspect);
      const why = esc(w.detail.replace(/:\s*run sprue system\s*$/, ""));
      if (system !== "current")
        return note(`Stage ${n}: the whole product has not been checked on this design (${why}). Type this in Claude Code to check it; ${again}`, inspect);
      // Run on this design but not proved: its self-test missed a planted fault, say.
      return note(`Stage ${n}: the whole product has not passed its check (${why}). Claude fixes it and inspects it again; ${again}`);
    }
  }
  if (g?.status === "proposed") {
    const ready = (what: string) => `Gate ${n}: ${what} ready for you. Type one of these in Claude Code. Nothing is ordered.`;
    if (state.stage === "design")
      return note(ready("the design is"), list(cmd(`accept ${slug}`, `accept it; stage ${n + 1} then inspects the whole product`), edit, decline));
    if (state.stage === "inspect")
      return note(ready("the whole product, inspected, is"), list(cmd(`accept ${slug}`, `accept it; stage ${n + 1} then finds the parts and quotes them`), edit, decline));
    if (state.stage === "source")
      return note(ready("the parts and the quote are"),
        list(cmd(`accept ${slug}`, `accept the quote; stage ${n + 1} then writes the build plan`),
          cmd(`swap ${slug} <line>`, "another part or another shop for one line"),
          cmd(`supplier ${slug}`, "the shops in the order, with their lines and shipping"),
          edit, decline));
    return note(ready("the build plan, the order list and the fab files are"),
      list(cmd(`accept ${slug}`, "accept the build; that ends the run"), edit, decline));
  }
  if (state.stage === "design") return note("The design is still being drawn. Reload this page when Claude says it is ready.");
  return note(`Stage ${n - 1} is accepted. Next is stage ${n}, ${STAGE_WORDS[state.stage]}. Nothing is ordered.`,
    list(cmd(`next ${slug}`, `start stage ${n}`)));
}

/** Each line's price in the quote for the figure's readout, once the run has reached the source stage: the order's cost
 * in whole packs (before shipping), and how many that buys when that isn't plainly one unit's worth: for a batch of
 * several units ("$459.90 for 21", not a price next to "1 ×"), or when packs buy more than the build needs. */
function pricesOf(slug: string, bom: Bom, state: State) {
  const prices: Record<string, { usd: number; qty?: number }> = {};
  // Until then a quote on disk is of an earlier run (or made ahead of its gate), not one to show.
  const quotes = state.stage === "design" || state.stage === "inspect" ? undefined : readQuotes(productDir(slug));
  if (!quotes) return prices;
  for (const q of quotes.lines) {
    const line = bom.lines.find((l) => l.id === q.lineId);
    if (!line) continue;
    const need = q.needQty ?? batchNeed(line, quotes.units);
    prices[q.lineId] = { usd: q.orderUsd, ...(quotes.units > 1 || q.orderQty > need ? { qty: q.orderQty } : {}) };
  }
  return prices;
}

/** Text for a script element the page holds as data (type="text/plain"): nothing in it may end or reopen a script. */
function plainScript(text: string, what: string) {
  if (/<!--|<script/i.test(text)) throw new Error(`${what} can't be inlined: it has "<!--" or "<script" in it`);
  return inline(text);
}

/** The vendored three.js (viewer/vendor/three/vendor.json): its modules in order, each with its name and imports. */
type ThreeFile = { file: string; name?: string; imports?: string[] };
export const THREE_DIR = join(VIEWER, "vendor", "three");

/** Fig 1's 3D tab, when the folder has a model (modelView): what the page inlines for it, after its scripts: the
 * vendored three.js modules as text, under their licence, and the view's data with the model in base64. */
function modelPart(slug: string, title: string): { view: ModelView; html: string } | null {
  const dir = productDir(slug);
  const view = modelView(dir);
  if (!view) return null;
  const vendor = JSON.parse(readFileSync(join(THREE_DIR, "vendor.json"), "utf8")) as { package: { version: string }; files: ThreeFile[] };
  const modules = vendor.files.filter((f) => f.name);
  const scripts = modules.map((f) =>
    `<script type="text/plain" data-a2-three="${esc(f.name!)}">${plainScript(readFileSync(join(THREE_DIR, f.file), "utf8"), f.file)}</script>`);
  // Two of the six modules carry a notice of their own: the licence is here, once, for all of them.
  const license = readFileSync(join(THREE_DIR, "LICENSE"), "utf8").trim().replace(/-{2,}/g, (m) => m.split("").join(" "));
  const data = {
    title,
    view,
    glb: readFileSync(join(dir, view.model.file)).toString("base64"),
    three: modules.map((f) => ({ name: f.name, file: f.file, imports: f.imports ?? [] })),
  };
  const html = [
    `<!-- three.js ${esc(vendor.package.version)} (https://threejs.org), six of its modules, minified, for Fig 1's 3D view, in the scripts below.`,
    `     Sprue vendors them in viewer/vendor/three/ (scripts/vendor-three.mjs). Their licence:`, "", license, "-->",
    ...scripts,
    `<script type="application/json" id="a2-model-data">${jsonScript(data)}</script>`,
  ].join("\n");
  return { view, html };
}

/** The figure files `sprue figure` wrote last, if it has. */
function figureOnDisk(slug: string): PageFigure | undefined {
  if (!exists(slug, "figure.svg") || !exists(slug, "figure.json")) return undefined;
  return { figure: readJson<FigureJson>(slug, "figure.json"), svg: readFileSync(join(productDir(slug), "figure.svg"), "utf8") };
}

/** Writes products/<slug>/view.html. `figure` is the figure just built (else figure.svg and figure.json are read);
 * `ex` is the data just built (else it is built here, quietly). Needs bom.json. */
export function writePage(slug: string, { figure, ex }: { figure?: PageFigure; ex?: Explorer } = {}) {
  const bom = readJson<Bom>(slug, "bom.json");
  const request = exists(slug, "request.json") ? readJson<Request>(slug, "request.json") : undefined;
  const state = readState(slug);
  const fig = figure ?? figureOnDisk(slug);
  // production/ is what `sprue package` wrote: the page names it, but explorer.json doesn't carry it, so the
  // examples' tracked explorer.json never depends on a folder git ignores.
  const prod = join(productDir(slug), "production");
  const production = existsSync(prod) ? readdirSync(prod).filter((f) => !f.startsWith(".")).sort() : undefined;
  // A catalog.json nothing can price from stops sourcing and the quote, not the page: it is drawn without offers and
  // says why, so the figure and the design stage go on.
  let unpriced: string | undefined;
  const offers = () => {
    try { return loadCatalog(slug); } catch (e) { unpriced = (e as Error).message; return { shipping: {}, offers: {} }; }
  };
  const data: Explorer & { production?: string[] } = { ...(ex ?? build(slug, loadRates(), offers(), { quiet: true })), state, designMd: undefined, production };
  const title = fig?.figure.title || request?.product || slug;
  const lines = Object.fromEntries(bom.lines.map((l) => [l.id, { id: l.id, name: l.name, short: l.shortName, process: l.process, qtyPerUnit: l.qtyPerUnit, qtyPerBatch: l.qtyPerBatch }]));
  const where = state.stage === "done" ? "every stage accepted" : `stage ${STAGES.indexOf(state.stage) + 1} of ${STAGES.length}, ${state.stage}`;
  const gates = STAGES.map((s, i) => {
    const g = gateOf(state, s);
    return `<li class="a2-gate" data-status="${g?.status ?? "none"}"${state.stage === s ? ' data-current aria-current="step"' : ""}><b>${i + 1} ${s}</b><i>${g ? g.status : "not started"}</i></li>`;
  }).join("");
  const head = [
    `<header class="a2-head a2-col"><p class="a2-kicker">Sprue · products/${esc(slug)} · ${where}</p>`,
    `<h1 class="a2-title">${esc(title)}</h1>`,
    request?.brief ? `<p class="a2-brief">${esc(request.brief)}</p>` : "",
    `<ol class="a2-gates" aria-label="Stages">${gates}</ol>`,
    gateNote(slug, state, bom, data.inspect?.system),
    unpriced ? `<div class="a2-gate-note" data-status="declined"><p>${esc(unpriced)}. The page shows no offers until it is fixed.</p></div>` : "",
    `</header>`,
  ].join("");
  let figureHtml: string;
  // The 3D tab needs the drawing beside it: the card is the drawing's, and the model is as tall as it is.
  const model = fig ? modelPart(slug, title) : null;
  if (fig && model) {
    const total = fig.figure.parts.reduce((s, p) => s + p.count, 0);
    const n = model.view.items.length;
    const corner = (name: string, text: string, extra = "") => `<span class="iso-plate-corner" data-corner="${name}"${extra}>${esc(text)}</span>`;
    const tab = (name: string, label: string, on: boolean) =>
      `<button type="button" class="a2-btn a2-tab" role="tab" id="a2-tab-${name}" data-a2-tab="${name}" aria-controls="a2-pane-${name}" aria-selected="${on}"${on ? "" : ' tabindex="-1"'}>${label}</button>`;
    // As the kit's plateHtml draws a card, with a readout for each tab and the drawing's hint on its tab only.
    figureHtml = `<section class="a2-figure a2-col" data-a2-figure aria-label="Figure 1">` +
      `<div class="a2-tabs" role="tablist" aria-label="Fig 1">${tab("drawing", "Drawing", true)}${tab("3d", "3D", false)}</div>` +
      `<figure class="iso-figure"><div class="iso-plate"><div class="iso-plate-corners" aria-hidden="true">` +
      corner("fig", "Fig 1") + (fig.figure.title ? corner("title", fig.figure.title) : "") +
      (fig.figure.hint ? corner("hint", fig.figure.hint, ' data-a2-pane="drawing"') : "") +
      corner("readout", `assembled · ${total} parts`, ' data-readout data-a2-pane="drawing"') +
      corner("readout", `3D · ${n} ${n === 1 ? "part" : "parts"}`, ' data-a2-readout="3d" data-a2-pane="3d" hidden') + `</div>` +
      `<div id="a2-pane-drawing" role="tabpanel" aria-labelledby="a2-tab-drawing" data-a2-pane="drawing"><div class="iso-stage a2-stage">${fig.svg}</div></div>` +
      `<div id="a2-pane-3d" role="tabpanel" aria-labelledby="a2-tab-3d" data-a2-pane="3d" hidden>` +
      `<div class="a2-model-pane" style="--a2-aspect:${fig.figure.width || 4}/${fig.figure.height || 3}"></div></div>` +
      `</div></figure>` +
      `<div data-a2-controls data-a2-pane="drawing"></div><div class="a2-model-under" data-a2-model="under" data-a2-pane="3d" hidden></div>` +
      (fig.figure.caption ? `<p class="a2-caption" data-a2-pane="drawing">${esc(fig.figure.caption)}</p>` : "") + `</section>`;
  } else if (fig) {
    const total = fig.figure.parts.reduce((s, p) => s + p.count, 0);
    const plate = k.plateHtml({
      fig: "Fig 1",
      title: fig.figure.title,
      hint: fig.figure.hint,
      readout: `assembled · ${total} parts`,
      body: `<div class="iso-stage a2-stage">${fig.svg}</div>`,
      caption: undefined, // under the controls instead, so the step text sits right under the card
    });
    figureHtml = `<section class="a2-figure a2-col" data-a2-figure aria-label="Figure 1">${plate}<div data-a2-controls></div>` +
      (fig.figure.caption ? `<p class="a2-caption">${esc(fig.figure.caption)}</p>` : "") + `</section>`;
  } else {
    figureHtml = `<section class="a2-figure a2-col" aria-label="Figure 1"><p class="a2-nofig"><span class="a2-nofig-k">Fig 1</span> ` +
      `<span>Not drawn yet. Claude draws the product in <code>products/${esc(slug)}/figure.mjs</code>, and it shows here.</span></p></section>`;
  }
  const payload = { explorer: data, figure: fig?.figure ?? null, lines, prices: pricesOf(slug, bom, state) };
  const read = (f: string) => readFileSync(join(VIEWER, f), "utf8");
  const page = read("view.html")
    .replace("<title>Sprue</title>", () => `<title>${esc(title)} · Sprue</title>`)
    .replace("/*PAGE_CSS*/", () => k.ISO_CSS + read("figure.css") + (model ? read("model.css") : "") + read("explorer.css") + read("page.css") + lightUnderMedia())
    .replace("<!--PAGE_HEAD-->", () => head)
    .replace("<!--PAGE_FIGURE-->", () => figureHtml)
    .replace("/*PAGE_DATA*/", () => jsonScript(payload))
    .replace("/*FIGURE_JS*/", () => inline(read("figure.js")))
    .replace("/*EXPLORER_JS*/", () => inline(read("explorer.js")))
    // Last, as the code inlined above can't hold the block's marks.
    .replace(/<!--MODEL-->([\s\S]*?)<!--\/MODEL-->\n?/, (_, block: string) =>
      // One pass, so nothing put in is read for a mark again.
      model ? block.replace(/<!--MODEL_DATA-->|\/\*MODEL_JS\*\//g, (m) => (m === "<!--MODEL_DATA-->" ? model.html : inline(read("model.js")))) : "");
  writeText(slug, "view.html", page);
  // The page used to be two: a figure.html that `sprue figure` wrote. One left from then would go stale.
  const old = join(productDir(slug), "figure.html");
  if (existsSync(old) && readFileSync(old, "utf8").includes('id="a2-figure-data"')) {
    rmSync(old);
    console.log(`removed products/${slug}/figure.html: the figure is on view.html now`);
  }
}

/** Rewrites view.html, if it is there, after something it shows changed. Silent: the command reports. With
 * `create`, it is written even when it isn't there yet, as long as there is a figure to show. */
export function refreshPage(slug: string, { create = false } = {}) {
  if (!exists(slug, "bom.json")) return;
  if (!exists(slug, "view.html") && !(create && exists(slug, "figure.json") && exists(slug, "figure.svg"))) return;
  try {
    writePage(slug);
  } catch {
    // The command that changed the files says what is wrong with them; a refresh only keeps the page current.
  }
}

/** Where the page is, as a path and a link to click. */
export function printPage(slug: string) {
  if (!exists(slug, "view.html")) return;
  const page = join(productDir(slug), "view.html");
  console.log(`page: ${page}`);
  console.log(`      ${pathToFileURL(page).href}`);
}
