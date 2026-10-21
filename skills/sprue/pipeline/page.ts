// The product page, products/<slug>/view.html: one page for the whole run, which grows with it.
//   top      the product, the brief, the four stages with their gates (state.json) and what to type at the
//            current one
//   Fig 1    the figure figure.mjs draws (figure.svg and figure.json, from `sprue figure`), live with
//            viewer/figure.js; until it is drawn, one line says so
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
import { gateOf, readState, STAGES, type Stage, type State } from "./state.ts";
import type { FigureJson } from "./figure.ts";
import type { Bom, Quotes, Request } from "./types.ts";

const VIEWER = join(import.meta.dirname, "..", "viewer");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline JSON and JS can't close their own script tag. */
const inline = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");

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
  if (state.stage === "design" || state.stage === "inspect" || !exists(slug, "quotes.json")) return prices;
  const quotes = readJson<Quotes>(slug, "quotes.json");
  for (const q of quotes.lines) {
    const line = bom.lines.find((l) => l.id === q.lineId);
    if (!line) continue;
    const need = q.needQty ?? batchNeed(line, quotes.units);
    prices[q.lineId] = { usd: q.orderUsd, ...(quotes.units > 1 || q.orderQty > need ? { qty: q.orderQty } : {}) };
  }
  return prices;
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
  if (fig) {
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
    .replace("/*PAGE_CSS*/", () => k.ISO_CSS + read("figure.css") + read("explorer.css") + read("page.css") + lightUnderMedia())
    .replace("<!--PAGE_HEAD-->", () => head)
    .replace("<!--PAGE_FIGURE-->", () => figureHtml)
    .replace("/*PAGE_DATA*/", () => inline(JSON.stringify(payload)))
    .replace("/*FIGURE_JS*/", () => inline(read("figure.js")))
    .replace("/*EXPLORER_JS*/", () => inline(read("explorer.js")));
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
