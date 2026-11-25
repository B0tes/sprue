// Tests of what the product page shows at Inspect: build() reads system.json as systemAudit judges it against the
// files there are now (current, stale, missing, unreadable, not written, or nothing to assemble), and the page's own
// words for it (viewer/explorer.js) never call a product passed on an earlier design, say Ponder's 10 problems, and
// read a check with no scope as a part check. The explorer is mounted too, on a small DOM written here (no library),
// and the head's note at Inspect (page.ts) is read from the view.html it writes. Run them with
//   node --test skills/sprue/pipeline/explore.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build, loadRates, printBom, requote as requoteTs, withWay as withWayTs, type Explorer, type InspectSummary } from "./explore.ts";
import { reportUrl } from "./gallery.ts";
import { writePage } from "./page.ts";
import { quote } from "./stages/quote.ts";
import { systemInputs } from "./stages/score.ts";
import { source } from "./stages/source.ts";
import type { State } from "./state.ts";
import type { Bom, BomLine, Checks, Offer, SystemCheck } from "./types.ts";
import { faultsWord, inspectVerdict, mount, movedWhy, notCheapestWhy, probeText, requote, scopeOf, shippingReadNote, STAGES, TABS, withWay } from "../viewer/explorer.js";

const root = mkdtempSync(join(tmpdir(), "sprue-explore-"));
after(() => rmSync(root, { recursive: true, force: true }));
const dir = join(root, "products", "t");
mkdirSync(dir, { recursive: true });
const put = (file: string, data: unknown) => writeFileSync(join(dir, file), typeof data === "string" ? data : JSON.stringify(data));

const bom: Bom = { slug: "t", units: 1, lines: [
  { id: "case", name: "Case", role: "enclosure", process: "print", qtyPerUnit: 1, spec: { material: "PETG" } },
  { id: "scr", name: "Screw", role: "fastener", process: "buy", qtyPerUnit: 4, spec: {} },
] };
put("bom.json", bom);
const checks: Checks = { slug: "t", failed: 0, flagged: 1, unscoped: ["my-rule"], checks: [
  { id: "bom-roles", title: "Roles", status: "pass", detail: "", scope: "part" },
  { id: "screw-engagement", title: "Screws reach", status: "flag", detail: "", scope: "assembly" },
  { id: "my-rule", title: "Mine", status: "pass", detail: "", scope: "part" },
] };
put("checks.json", checks);

/** `fn` run from the folder the temporary product is in, as the commands run. */
function inRoot<T>(fn: () => T): T {
  const here = process.cwd();
  try {
    process.chdir(root);
    return fn();
  } finally {
    process.chdir(here);
  }
}

/** build() in the temporary product, as `sprue view` runs it. */
const explorer = () => inRoot(() => build("t", loadRates(), { shipping: {}, offers: {} }, { quiet: true }));
const inspect = (): InspectSummary => explorer().inspect!;

/** A system.json of the product as it is now: Ponder's own, gates and all, unless `change` says otherwise. */
const ponder = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "ponder", "system.json"), "utf8")) as SystemCheck;
function systemJson(change: Partial<SystemCheck> = {}) {
  put("system.json", { ...ponder, slug: "t", inputs: systemInputs(dir), ...change });
}

test("Inspect reads system.json against the files there are now, and names the command when it isn't current", () => {
  let ins = inspect();
  assert.equal(ins.system, "unwritten");
  assert.equal(ins.run, "sprue inspect t");
  assert.equal(ins.report, undefined);
  assert.deepEqual(ins.unscoped, ["my-rule"]);
  // No seeded faults are listed for this product, so there are none to show.
  assert.equal("faults" in ins, false);

  mkdirSync(join(dir, "cad"), { recursive: true });
  writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
  ins = inspect();
  assert.equal(ins.system, "missing");
  assert.equal(ins.run, "sprue inspect t");

  systemJson();
  ins = inspect();
  assert.equal(ins.system, "current");
  assert.equal(ins.run, undefined);
  assert.equal(ins.verdict.ok, false);
  assert.deepEqual(ins.verdict.failed, ["clearance", "function"]);
  assert.equal(ins.report?.parts, 62);
  assert.equal(ins.report?.envelopes, 56);
  assert.equal(ins.report?.gates.find((g) => g.id === "clearance")?.list?.length, 6);
  assert.equal(ins.report?.gates.find((g) => g.id === "stability")?.flags?.length, 6);
  assert.deepEqual(ins.report?.gates.find((g) => g.id === "function")?.notes, ["speaker: 30% of it sees out, under the 40% the design aims for"]);
  assert.equal(ins.report?.stability.length, 5);
  assert.equal(ins.report?.probes.length, 9);
  assert.equal(ins.report?.selfTest.faults.length, 19);

  // A part file changed after the check ran: what it found is kept, but it is of an earlier design.
  writeFileSync(join(dir, "cad", "case.py"), "# a new part\n");
  ins = inspect();
  assert.equal(ins.system, "stale");
  assert.equal(ins.run, "sprue inspect t");
  assert.equal(ins.report?.parts, 62);
  assert.match(ins.verdict.detail, /^system\.json is of an earlier design \(cad\/case\.py changed\)/);

  put("system.json", "{");
  assert.equal(inspect().system, "unreadable");

  // A product of bought parts alone is not assembled by us: there is nothing to check.
  rmSync(join(dir, "cad"), { recursive: true, force: true });
  put("bom.json", { ...bom, lines: bom.lines.filter((l) => l.process === "buy") });
  ins = inspect();
  assert.equal(ins.system, "none");
  assert.equal(ins.verdict.ok, true);
  put("bom.json", bom);
  rmSync(join(dir, "system.json"));
});

test("the page has four stages, Inspect second, and reads a check with no scope as a part check", () => {
  assert.deepEqual(STAGES.map((s) => `${s.n} ${s.id}`), ["1 design", "2 inspect", "3 source", "4 build"]);
  assert.deepEqual(TABS.map((t) => t.id), STAGES.map((s) => s.id));
  assert.equal(scopeOf({ id: "old", title: "", status: "pass", detail: "" }), "part");
  assert.equal(scopeOf({ id: "usb-power", title: "", status: "pass", detail: "", scope: "assembly" }), "assembly");
});

test("Inspect's verdict line: Ponder's 10 problems, and never a pass on an earlier design", () => {
  const ins: InspectSummary = {
    verdict: { ok: false, detail: "the whole product fails clearance, function: ...", failed: ["clearance", "function"] }, system: "current",
    report: { generatedAt: ponder.generatedAt, parts: ponder.parts, envelopes: ponder.envelopes, gates: ponder.gates, stability: ponder.stability,
      probes: ponder.probes, selfTest: ponder.selfTest },
  };
  assert.deepEqual(inspectVerdict(ins), { state: "fail",
    text: "Whole product fails: 5 of 7 gates pass (10 problems); self-test 19 of 19 faults caught; 56 of 62 parts are envelopes." });
  // Every gate passed and every fault caught, but on files that have changed since: not a pass.
  const passed = { ...ins, verdict: { ok: true, detail: "", failed: [] },
    report: { ...ins.report!, gates: ponder.gates.map((g) => ({ ...g, status: "pass" as const, problems: 0 })) } };
  assert.equal(inspectVerdict(passed).state, "pass");
  assert.match(inspectVerdict(passed).text, /^Whole product passes: 7 of 7 gates pass; /);
  const stale = inspectVerdict({ ...passed, system: "stale", verdict: { ok: false, detail: "system.json is of an earlier design", failed: [] } });
  assert.equal(stale.state, "open");
  assert.match(stale.text, /^Whole product not checked on this design\. Its last check, of an earlier design: 7 of 7 gates pass/);
  assert.equal(inspectVerdict({ ...ins, system: "missing", report: undefined }).state, "open");
  // A gate with no fault planted in it proves nothing, and the line says which.
  assert.match(inspectVerdict({ ...passed, report: { ...passed.report, selfTest: { ...ponder.selfTest, untested: ["function"] } } }).text,
    /self-test 19 of 19 faults caught, none planted for function;/);
  assert.equal(inspectVerdict({ verdict: { ok: true, detail: "", failed: [] }, system: "none" }).state, "pass");
  assert.equal(inspectVerdict(undefined).state, "open");
});

test("each probe says what it measured against what it needs", () => {
  const probe = (id: string) => ponder.probes.find((p) => p.id === id)!;
  assert.equal(probeText(probe("pi-radio")), "the nearest metal part, scr25-4, is 8.91 mm away; it needs 15 mm, and 4 metal parts are closer than that");
  assert.equal(probeText(probe("speaker")), "30.4% of it sees out; it needs 20%, and the design aims for 40%");
  assert.equal(probeText(probe("pixel1")), "76.2% of its light gets through; it needs 70%");
  assert.equal(probeText(probe("camera")),
    "15.4% of the image is the product itself (base-top, coupling-base, diffuser, talk); of its target, 0% is outside the image and 0% hidden");
  assert.equal(probeText({ id: "r", kind: "keepout", nearestMetalMm: null, nearest: null, need: 15 }), "no metal part near it; it needs 15 mm clear");
});

// ---- the page itself: mount() on a stub DOM

/** Just enough of the DOM for mount() to build every stage: elements with attributes, children and text. Appending a
 * node that has a parent moves it, as in a browser, so a node used in two places is seen to leave the first. Events
 * do nothing: these read what the page says, not what a click does. */
class Stub {
  parent: Stub | null = null;
  nodes: Stub[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  readonly localName: string;
  private data: string;
  constructor(localName: string, data = "") {
    this.localName = localName;
    this.data = data;
  }
  get textContent(): string { return this.localName === "#text" ? this.data : this.nodes.map((n) => n.textContent).join(""); }
  set textContent(t: string) { this.replaceChildren(t); }
  get children() { return this.nodes.filter((n) => n.localName !== "#text"); }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(on: boolean) { this.toggleAttribute("hidden", on); }
  get classList() { return { add: (...names: string[]) => this.setAttribute("class", [...new Set([...this.classes(), ...names])].join(" ")) }; }
  classes() { return (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  toggleAttribute(k: string, on = !this.attrs.has(k)) {
    if (on) this.attrs.set(k, "");
    else this.attrs.delete(k);
    return on;
  }
  append(...kids: (Stub | string)[]) {
    for (const k of kids) {
      const n = typeof k === "string" ? new Stub("#text", k) : k;
      n.remove();
      n.parent = this;
      this.nodes.push(n);
    }
  }
  replaceChildren(...kids: (Stub | string)[]) {
    for (const n of [...this.nodes]) n.remove();
    this.append(...kids);
  }
  remove() {
    if (this.parent) this.parent.nodes = this.parent.nodes.filter((n) => n !== this);
    this.parent = null;
  }
  /** Every element under this one, in document order. */
  all(): Stub[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  /** One compound selector: a tag, .classes and [attr] or [attr="value"]. */
  matches(sel: string) {
    return (sel.match(/\.[\w-]+|\[[^\]]+\]|[\w-]+/g) ?? []).every((t) => {
      if (t[0] === ".") return this.classes().includes(t.slice(1));
      const m = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(t);
      return m ? (m[2] == null ? this.hasAttribute(m[1]) : this.getAttribute(m[1]) === m[2]) : this.localName === t;
    });
  }
  querySelectorAll(sel: string) { return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener() {}
  dispatchEvent() { return true; }
  focus() {}
  scrollIntoView() {}
}

/** The explorer mounted on a stub element, the stub document standing in for the browser's while it builds. */
function view(ex: Explorer, layout: "stages" | "tabs" = "stages") {
  const g = globalThis as unknown as { document?: unknown };
  const doc = { createElement: (tag: string) => new Stub(tag), createElementNS: (_ns: string, tag: string) => new Stub(tag), addEventListener() {}, body: new Stub("body") };
  g.document = doc;
  try {
    const el = new Stub("div");
    mount(el as unknown as HTMLElement, ex as unknown as Parameters<typeof mount>[1], { layout });
    const panel = (id: string) => el.all().find((e) => e.getAttribute("data-panel") === id)!;
    return { el, panel, text: (id: string) => panel(id).textContent };
  } finally {
    delete g.document;
  }
}

const gate = (status: string) => ({ status, at: "2026-10-21T00:00:00.000Z" });
/** The gates in state.json: the stages before `stage` accepted, `stage` at `status`, and any others as `more` says. */
function at(stage: string, status: string, more: Record<string, string> = {}): State {
  const stages = Object.fromEntries([...STAGES.slice(0, STAGES.findIndex((s) => s.id === stage)).map((s) => [s.id, gate("accepted")]),
    [stage, gate(status)], ...Object.entries(more).map(([k, v]) => [k, gate(v)])]);
  return { stage: stage as State["stage"], stages };
}
/** The text of every element of class `cls` under `el`. */
const texts = (el: Stub, cls: string) => el.querySelectorAll(`.${cls}`).map((e) => e.textContent);
/** The row under `el` whose title is `title`. */
const rowOf = (el: Stub, title: string) => el.querySelectorAll(".ax-check").find((r) => r.querySelector(".ax-check-title")?.textContent === title)!;
const cleanUp = () => {
  for (const f of ["cad", "system.json", "state.json", "view.html", "explorer.json"]) rmSync(join(dir, f), { recursive: true, force: true });
  put("bom.json", bom);
  put("checks.json", checks);
};

test("Design lists only the checks of each part, still names the assembly ones, and no whole-product check is made up", () => {
  try {
    const ex = { ...explorer(), state: at("design", "proposed") };
    const page = view(ex);
    const design = page.panel("design");
    assert.deepEqual(texts(design.querySelector(".ax-checks")!, "ax-check-title"), ["Roles", "Mine"]);
    // Its gate named every check that needed a person before Inspect took the assembly ones: it still does, by title.
    const before = design.querySelector(".ax-before")!.textContent;
    assert.match(before, /Next, at stage 2, Inspect: 1 assembly check \(0 failed, 1 flagged\) and the whole product, not checked on this design yet\./);
    assert.match(before, /At Inspect, flagged: Screws reach\./);
    // There is no cad/_system.py, so there is no whole-product check to have been made ahead of its gate.
    assert.doesNotMatch(page.text("inspect"), /made ahead of its gate/);
    mkdirSync(join(dir, "cad"), { recursive: true });
    writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
    assert.doesNotMatch(view({ ...explorer(), state: at("design", "proposed") }).text("inspect"), /made ahead of its gate/);
    // One made by an earlier run is.
    systemJson();
    assert.match(view({ ...explorer(), state: at("design", "proposed") }).panel("inspect").querySelector(".ax-earlier")!.textContent,
      /^Stage 2 hasn't started, so this whole-product check was made ahead of its gate/);
    // Inspect accepted out of turn (accept --force) is not a gate from before Inspect.
    assert.match(view({ ...explorer(), state: at("design", "proposed", { inspect: "accepted" }) }).panel("inspect").querySelector(".ax-earlier")!.textContent,
      /^Stage 2 hasn't started, so this whole-product check was made ahead of its gate/);
  } finally {
    cleanUp();
  }
});

test("Inspect at its gate names sprue inspect in the note that says the check is stale or missing, and before you accept", () => {
  try {
    mkdirSync(join(dir, "cad"), { recursive: true });
    writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
    systemJson();
    writeFileSync(join(dir, "cad", "case.py"), "# the case, changed after the check\n");
    // Of an earlier design: never a pass, and both the note and the gate's list name the command (one node put in both
    // would leave the note without it).
    let inspect = view({ ...explorer(), state: at("inspect", "drafting") }).panel("inspect");
    assert.equal(inspect.querySelector(".ax-iverdict")!.getAttribute("data-state"), "open");
    assert.match(inspect.querySelector(".ax-istale")!.textContent, /^System\.json is of an earlier design \(cad\/case\.py changed\)\. .* Run sprue inspect t to check this one\.$/);
    assert.match(inspect.querySelector(".ax-before")!.querySelector("li")!.textContent, /^Whole product not checked on this design\. Its last check, of an earlier design: .*\. Run sprue inspect t first\.$/);
    rmSync(join(dir, "system.json"));
    inspect = view({ ...explorer(), state: at("inspect", "drafting") }).panel("inspect");
    assert.equal(inspect.querySelector(".ax-istale")!.textContent, "The whole-product check hasn't run: there is no system.json. Run sprue inspect t.");
    assert.equal(inspect.querySelector(".ax-before")!.querySelector("li")!.textContent, "Whole product not checked yet. Run sprue inspect t first.");
  } finally {
    cleanUp();
  }
});

test("a product that can't be put in one frame claims no envelope, stability or function probe", () => {
  try {
    mkdirSync(join(dir, "cad"), { recursive: true });
    writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
    // As cad/system.py writes it when _system.py can't find a line it needs: no part placed, no gate run.
    const why = "bom.json has no feet line (cad/_system.py asks for it)";
    systemJson({ ok: false, parts: 0, envelopes: 0, stability: [], probes: [],
      gates: [{ id: "inputs", title: "inputs", status: "fail", detail: why, problems: 1, list: [why] }],
      selfTest: { ok: false, faults: [], untested: ["placed", "overlap", "contact", "clearance", "inside", "stability", "function"] } });
    const inspect = view({ ...explorer(), state: at("inspect", "drafting") }).panel("inspect");
    const text = inspect.textContent;
    assert.match(text, /Whole productnot put in one frame · checked /);
    assert.match(text, /The product could not be put in one frame: cad\/_system\.py needs what the inputs row names\. So none of its fits, gaps, stability or function probes were checked\./);
    assert.doesNotMatch(text, /No part is an envelope|No function probes|parts in one frame|their pass proves nothing/);
    // No gate ran, so the self-test planted nothing: not a pass it failed to prove.
    const self = rowOf(inspect, "Self-test, in system.json");
    assert.equal(self.getAttribute("data-status"), "none");
    assert.equal(self.querySelector(".ax-check-s")!.textContent, "Not run");
    assert.match(self.textContent, /No gate ran here, so none was planted\./);
  } finally {
    cleanUp();
  }
});

test("a quote accepted before Inspect existed reads as accepted, not as one to be proposed", () => {
  try {
    // readState puts a run from before Inspect, its design and quote accepted, at a drafting Inspect.
    const ex: Explorer = { ...explorer(), quoted: undefined, buildPlanMd: "# Build plan\n",
      state: at("inspect", "drafting", { source: "accepted", build: "proposed" }) };
    const page = view(ex);
    const source = page.panel("source").querySelector(".ax-earlier")!.textContent;
    assert.equal(source, "Stage 3 hasn't started, but this quote was accepted before Sprue inspected the whole product. It stays accepted once the inspection is, unless a fix at Inspect changes the parts: then sprue inspect t reopens it.");
    // Its plan, proposed then, waits for the inspection, not for the quote it was proposed after.
    assert.equal(page.panel("build").querySelector(".ax-earlier")!.textContent,
      "Stage 4 hasn't started, but this plan was proposed before Sprue inspected the whole product. It is at its gate again once the inspection is accepted, unless a fix at Inspect changes the parts: then sprue inspect t reopens it.");
    // One made ahead of its gate and never accepted is still checked and proposed in its turn.
    assert.match(view({ ...ex, state: at("inspect", "drafting") }).panel("source").querySelector(".ax-earlier")!.textContent,
      /so this quote was made ahead of its gate, .* It is checked and proposed once the inspection is accepted\.$/);
  } finally {
    cleanUp();
  }
});

test("Inspect says where usb-power is listed: under Design while checks.json is from before the scopes", () => {
  const usb = { id: "usb-power", title: "USB current", status: "pass" as const, detail: "" };
  const electricity = (ex: Explorer) => rowOf(view({ ...ex, state: at("inspect", "drafting") }).panel("inspect"), "Electricity").textContent;
  const ex = explorer();
  assert.match(electricity({ ...ex, checks: [{ ...usb, scope: "assembly" }] }), /usb-power, under Assembly checks/);
  assert.match(electricity({ ...ex, checks: [usb] }), /usb-power, under Design/);
  assert.match(electricity({ ...ex, checks: [] }), /the built-in usb-power check doesn't apply here/);
});

test("seeded faults not measured on this design are a flag, named as the score names them, never a failure", () => {
  const none = { pct: 0, missed: [], falseAlarms: 0 };
  const cases = [
    [{ ok: false, detail: "no faults.json: run sprue faults", ran: 0, caught: 0 }, "flag", "Not run"],
    [{ ok: false, detail: "faults.json is not readable: run sprue faults", ran: 0, caught: 0 }, "flag", "Unreadable"],
    [{ ok: false, detail: "faults.json could not be checked: the product could not be read (EACCES)", ran: 4, caught: 4 }, "flag", "Unchecked"],
    [{ ok: false, detail: "faults.json is of an earlier design (bom.json changed; it caught 4 of 4 then): run sprue faults", ran: 4, caught: 4 }, "flag", "Stale"],
    [{ ok: false, detail: "3 of 4 seeded faults caught (75%), missed lid-gone, 0 false alarms on the clean design", ran: 4, caught: 3 }, "fail", "3 of 4 caught"],
  ] as const;
  const ex = explorer();
  for (const [f, status, word] of cases) {
    const faults = { ...none, ...f };
    assert.equal(faultsWord(faults).word, word);
    const inspect = view({ ...ex, inspect: { ...ex.inspect!, faults }, state: at("inspect", "drafting") }).panel("inspect");
    const row = rowOf(inspect, "Seeded faults, in faults.json");
    assert.equal(row.getAttribute("data-status"), status, f.detail);
    assert.equal(row.querySelector(".ax-check-s")!.textContent, word);
    const item = inspect.querySelector(".ax-before")!.querySelectorAll("li").find((li) => li.textContent.startsWith("Seeded faults"))!;
    assert.equal(item.getAttribute("data-status"), status);
    assert.equal(item.textContent, `${status === "fail" ? "Seeded faults: " : `Seeded faults, ${word.toLowerCase()}: `}${f.detail}.`);
  }
});

test("the website's whole-product card says Nothing to assemble only when nothing is made", () => {
  try {
    const card = (ex: Explorer) => view({ ...ex, quoted: undefined }, "tabs").el.querySelector('.ax-card[data-goto="inspect"]')!;
    let c = card(explorer());
    assert.deepEqual([c.querySelector(".ax-card-v")!.textContent, c.querySelector(".ax-card-s")!.textContent], ["Not checked", "No cad/_system.py yet, 1 assembly check"]);
    mkdirSync(join(dir, "cad"), { recursive: true });
    writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
    assert.equal(card({ ...explorer(), checks: [] }).querySelector(".ax-card-s")!.textContent, "Not checked on this design");
    // From before Inspect, explorer.json has no inspect at all.
    assert.equal(card({ ...explorer(), inspect: undefined, checks: [] }).querySelector(".ax-card-s")!.textContent, "From before the whole-product check");
    systemJson();
    assert.equal(card(explorer()).querySelector(".ax-card-s")!.textContent, "5 of 7 gates pass, 1 assembly check");
    rmSync(join(dir, "cad"), { recursive: true, force: true });
    rmSync(join(dir, "system.json"));
    put("bom.json", { ...bom, lines: bom.lines.filter((l) => l.process === "buy") });
    c = card({ ...explorer(), checks: [] });
    assert.deepEqual([c.querySelector(".ax-card-v")!.textContent, c.querySelector(".ax-card-s")!.textContent], ["Passes", "Nothing to assemble"]);
  } finally {
    cleanUp();
  }
});

test("the head's note at Inspect names sprue inspect when the check hasn't run on this design, and fixes the design only when it fails", () => {
  const note = () => {
    inRoot(() => writePage("t"));
    const html = readFileSync(join(dir, "view.html"), "utf8");
    return /<div class="a2-gate-note"[^>]*>(.*?)<\/div>/.exec(html)![1];
  };
  try {
    put("state.json", at("inspect", "drafting"));
    assert.match(note(), /^<p>Stage 2: nothing checks the whole product yet: there is no <code>cad\/_system\.py<\/code>\. Claude writes it, then inspects the product;/);
    mkdirSync(join(dir, "cad"), { recursive: true });
    writeFileSync(join(dir, "cad", "_system.py"), "# the product in one frame\n");
    const inspect = "<ul class=\"a2-cmds\"><li><code>/sprue inspect t</code><span>check the whole product as it is now; it proposes the gate once it passes</span></li></ul>";
    assert.equal(note(), `<p>Stage 2: the whole product has not been checked on this design (no system.json). Type this in Claude Code to check it; the gate opens once it passes. Nothing is ordered.</p>${inspect}`);
    systemJson();
    writeFileSync(join(dir, "cad", "case.py"), "# the case, changed after the check\n");
    assert.equal(note(), `<p>Stage 2: the whole product has not been checked on this design (system.json is of an earlier design (cad/case.py changed)). Type this in Claude Code to check it; the gate opens once it passes. Nothing is ordered.</p>${inspect}`);
    // Checked on this design and failing: the design is what Claude changes.
    systemJson();
    assert.equal(note(), "<p>Stage 2: the whole product fails its check, with 10 problems. Claude fixes the design and inspects it again; the gate opens once it passes. Nothing is ordered.</p>");
  } finally {
    cleanUp();
  }
});

test("Design says what Sprue can't check here, its gate says it before you accept, and nothing found says nothing", () => {
  try {
    put("request.json", { slug: "t", brief: "A lamp with a lithium battery and a fabric shade", product: "Lamp", units: 1, region: "EU",
      mustHave: [], niceToHave: [], constraints: { power: "USB-C only, no mains" } });
    const ex = { ...explorer(), state: at("design", "proposed") };
    assert.deepEqual(ex.limits?.map((l) => l.kind), ["battery", "soft"]);
    const design = view(ex).panel("design");
    const limits = design.querySelector(".ax-limits")!;
    assert.equal(limits.querySelector(".ax-h3")!.textContent, "What Sprue can't check here");
    const items = limits.querySelectorAll("li");
    assert.deepEqual(items.map((li) => li.getAttribute("data-kind")), ["battery", "soft"]);
    assert.match(items[0].textContent, /^Batteries\. Sprue has no battery rule: .*someone qualified\. Found in request\.json brief: "A lamp with a lithium battery and a fabric shade"\.$/);
    // Up front: under the design's own words, before the parts.
    const order = design.all().map((e) => e.getAttribute("class"));
    assert.ok(order.indexOf("ax-limits") < order.indexOf("ax-parts"), order.join(" "));
    const flagged = design.querySelector(".ax-before")!.querySelectorAll('li[data-status="flag"]').map((li) => li.textContent);
    assert.deepEqual(flagged.filter((t) => t.startsWith("Out of Sprue's reach")),
      ["Out of Sprue's reach: Batteries, which no check here reads.", "Out of Sprue's reach: Soft goods, which no check here reads."]);
    // Past Design's gate the gate's list is gone, and the design still says it.
    const later = view({ ...ex, state: at("inspect", "drafting") }).panel("design");
    assert.equal(later.querySelector(".ax-before"), null);
    assert.equal(later.querySelector(".ax-limits")!.querySelectorAll("li").length, 2);
    // A malformed one (an older or hand-edited explorer.json) is left out, not a crash.
    const odd = view({ ...ex, limits: [null, { kind: "x" }, ...ex.limits!] as Explorer["limits"] }).panel("design");
    assert.equal(odd.querySelector(".ax-limits")!.querySelectorAll("li").length, 2);
    // Three places, and how many more.
    const many = view({ ...ex, limits: [{ ...ex.limits![0], found: ["a", "b", "c", "d"] }] }).panel("design");
    assert.match(many.querySelector(".ax-limits")!.querySelector("li")!.textContent, /Found in a; b; c; and 1 more\.$/);
    // Nothing found: no key in explorer.json, and nothing on the page.
    put("request.json", { slug: "t", brief: "A USB lamp, no battery", product: "Lamp", units: 1, region: "EU", mustHave: [], niceToHave: [], constraints: {} });
    const none = explorer();
    assert.equal("limits" in JSON.parse(JSON.stringify(none)), false);
    const plain = view({ ...none, state: at("design", "proposed") }).panel("design");
    assert.equal(plain.querySelector(".ax-limits"), null);
    assert.doesNotMatch(plain.querySelector(".ax-before")!.textContent, /Out of Sprue's reach/);
  } finally {
    rmSync(join(dir, "request.json"), { force: true });
    cleanUp();
  }
});

/** The keypad's hand-off as handoffView gives it, with a part split in two orders and one with no price. */
const handoff = (change: Partial<NonNullable<Explorer["handoff"]>> = {}): NonNullable<Explorer["handoff"]> => ({
  problems: [],
  parts: [
    { id: "case", name: "Case <b>top</b> | v2", madeBy: "3D print", material: "PETG", n: 3, split: { a: 1, b: 2 }, upload: "t-case.stl", price: "$6.00 at Craftcloud, an estimate", priced: true },
    { id: "brk", name: "Bracket", madeBy: "CNC machining", material: "aluminium 6061-T6", n: 1, upload: "t-brk.step", price: "not priced", priced: false },
  ],
  together: ["Craftcloud: case and lid. Put both in one cart: upload their files in the same upload, and pick one partner for all."],
  italy: { usdPerEur: 1.1165, date: "2026-11-06", read: "2026-11-09",
    carts: [{ cart: "Craftcloud", parcel: "case and lid", figure: "€19.92", eu: "€10.74 to €24.30", outside: "€15.74 to €36.50" }],
    notes: ["From outside the EU, the low figure counts the fewest items.", "No figure holds the courier's own fee for collecting VAT or duty."] },
  ...change,
});
/** The temporary product as quoted, as `sprue view` gives it once there is a quote, with `more` on top. */
const quotedEx = (more: Record<string, unknown> = {}) => ({ ...explorer(), quoted: undefined, state: at("source", "proposed"), generatedAt: "2026-11-10T08:00:00.000Z", ...more }) as Explorer;

test("Source shows the made parts' order sheets: each part as README.md has it, the carts in euros and what they hold", () => {
  try {
    const block = view(quotedEx({ handoff: handoff() })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(block.querySelector(".ax-h3")!.textContent, "Made parts, to order by hand");
    assert.match(block.querySelector(".ax-lede-note")!.textContent, /steps up to the cart\. Nothing is uploaded, quoted or ordered\.$/);
    // A part pinned to the user's own printer gets a sheet to slice it, and the lede says so.
    const parts0 = handoff().parts;
    const home = view(quotedEx({ handoff: handoff({ parts: [parts0[0], { ...parts0[1], madeBy: "3D print, at home" }] }) })).panel("source").querySelector(".ax-handoff")!;
    assert.match(home.querySelector(".ax-lede-note")!.textContent, /steps up to the cart\. A part bom\.json pins to your own printer gets a sheet to slice it instead, with no shop\. Nothing is uploaded/);
    // A part priced from a shop's quote: Sprue asked no shop, but the price is a quote, the one the person got.
    const quotedPart = view(quotedEx({ handoff: handoff({ parts: [parts0[0], { ...parts0[1], price: "$100.49 at Weerg", priced: true, quoted: true }] }) })).panel("source").querySelector(".ax-handoff")!;
    assert.match(quotedPart.querySelector(".ax-lede-note")!.textContent, /steps up to the cart\. Sprue uploads and orders nothing\. A part priced from a shop's quote is priced from the one you got\.$/);
    const [parts, carts] = block.querySelectorAll("table");
    const cells = (tr: Stub) => tr.children.map((td) => td.textContent);
    assert.deepEqual(parts.querySelectorAll("tr[data-line-id]").map(cells), [
      ["Case <b>top</b> | v2PETG", "3D print", "31 in order A, 2 in order B", "t-case.stlin case/, with its ORDER.md", "$6.00 at Craftcloud, an estimate"],
      ["Bracketaluminium 6061-T6", "CNC machining", "1", "t-brk.stepin brk/, with its ORDER.md", "not pricedIts ORDER.md lists the shops to ask"],
    ]);
    // How many is the one order's count, as the price beside it is: two orders that buy another count in all say so.
    const above = view(quotedEx({ handoff: handoff({ parts: [{ ...parts0[0], n: 10, split: { a: 2, b: 5 } }] }) })).panel("source").querySelector(".ax-handoff")!;
    assert.deepEqual(above.querySelectorAll("table")[0].querySelectorAll("tr[data-line-id]").map(cells)[0][2], "10as one order; as two, 7: 2 in order A, 5 in order B");
    // Text from bom.json is text: no element is made of it.
    assert.equal(parts.querySelectorAll("b").length, 0);
    assert.ok(parts.querySelectorAll("td[data-unpriced]").length === 1);
    assert.deepEqual(texts(block, "ax-handoff-together"), ["Craftcloud: case and lid. Put both in one cart: upload their files in the same upload, and pick one partner for all."]);
    assert.deepEqual(block.querySelectorAll(".ax-h4").map((e) => e.textContent), ["Order together", "In Italy, in euros"]);
    assert.deepEqual(carts.querySelector("tbody")!.querySelectorAll("tr").map(cells), [["Craftcloudcase and lid", "€19.92", "€10.74 to €24.30", "€15.74 to €36.50"]]);
    const rate = block.querySelectorAll(".ax-note").find((e) => e.textContent.startsWith("At the ECB"))!.textContent;
    assert.equal(rate, "At the ECB's reference rate of 2026-11-06, 1 EUR = 1.1165 USD (Sprue's pipeline/fx.json, read 2026-11-09). The shop and your card convert at their own rates.");
    assert.equal(block.querySelector(".ax-handoff-notes")!.querySelector("p")!.textContent,
      "From outside the EU, the low figure counts the fewest items. No figure holds the courier's own fee for collecting VAT or duty.");
    // On the website there is no folder to look at: it says which command writes it, and where.
    assert.equal(block.querySelector(".ax-handoff-where")!.textContent, "sprue handoff t writes them in products/t/fab/order/, on the machine that runs Sprue.");
    // No cart in euros (nothing priced), nothing to put together: neither heading.
    const bare = view(quotedEx({ handoff: handoff({ together: [], italy: undefined }) })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(bare.querySelectorAll(".ax-h4").length, 0);
    assert.equal(bare.querySelectorAll("table").length, 1);
  } finally {
    cleanUp();
  }
});

test("on the product page, Source says whether fab/order/ is there and current, and a rate a month old says so", () => {
  try {
    const where = (folder: unknown, more: Record<string, unknown> = {}) =>
      view(quotedEx({ handoff: handoff(), handoffFolder: folder, ...more })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(where({ state: "none" }).querySelector(".ax-handoff-where")!.textContent, "They aren't written yet: sprue handoff t writes them in products/t/fab/order/.");
    assert.equal(where({ state: "current", written: "2026-11-09" }).querySelector(".ax-handoff-where")!.textContent,
      "products/t/fab/order/ has them, written on 2026-11-09: start with its README.md.");
    assert.equal(where({ state: "stale", why: "lid/ORDER.md was changed by hand since sprue handoff wrote it." }).querySelector(".ax-handoff-where")!.textContent,
      "products/t/fab/order/ is out of date: lid/ORDER.md was changed by hand since sprue handoff wrote it. sprue status t removes it, and sprue handoff t writes it again.");
    // The commands are code.
    assert.deepEqual(where({ state: "none" }).querySelector(".ax-handoff-where")!.querySelectorAll("code").map((c) => c.textContent), ["sprue handoff t", "products/t/fab/order/"]);
    // 31 days after the rate's date is still a month; 32 is not.
    const rate = (at: string) => where({ state: "none" }, { generatedAt: at }).querySelectorAll(".ax-note").find((e) => e.textContent.startsWith("At the ECB"))!.textContent;
    assert.doesNotMatch(rate("2026-12-07T23:00:00.000Z"), /older/);
    assert.match(rate("2026-12-08T00:00:00.000Z"), /The rate is 32 days older than this page's data, so the euro figures may be off: update pipeline\/fx\.json from the ECB's page, then run sprue handoff t and sprue view t again\.$/);
    // Both commands: sprue handoff writes the folder (and this page), sprue view explorer.json.
    const old = where({ state: "none" }, { generatedAt: "2026-12-08T00:00:00.000Z" }).querySelectorAll(".ax-note").find((e) => e.textContent.startsWith("At the ECB"))!;
    assert.deepEqual(old.querySelectorAll("code").map((c) => c.textContent), ["pipeline/fx.json", "pipeline/fx.json", "sprue handoff t", "sprue view t"]);
  } finally {
    cleanUp();
  }
});

test("Source says why no order sheet is written, every problem (past three, folded), a folder left over, and nothing before the quote", () => {
  try {
    const problems = ["check case-ok fails: ok is 0", "the whole-product check: it fails clearance", "case: fab/case.stl is not made yet: run sprue cad", "four", "five"];
    const block = view(quotedEx({ handoff: handoff({ problems, parts: [], together: [], italy: undefined }), handoffFolder: { state: "none" } })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(block.querySelector(".ax-warn")!.textContent, "Sprue writes no order sheets for the made parts yet: 5 problems to fix first.");
    const [first, rest] = block.querySelectorAll(".ax-handoff-problems");
    assert.deepEqual(first.querySelectorAll("li").map((li) => li.textContent), problems.slice(0, 3));
    // The page lists them all, as the website's gate 3 says: those past the third folded.
    const more = block.querySelector(".ax-handoff-more")!;
    assert.equal(more.localName, "details");
    assert.equal(more.querySelector("summary")!.textContent, "and 2 more");
    assert.deepEqual(rest.querySelectorAll("li").map((li) => li.textContent), problems.slice(3));
    assert.equal(block.querySelectorAll("table").length, 0);
    assert.equal(block.querySelector(".ax-handoff-where")!.textContent, "Once they are fixed, sprue handoff t writes the order sheets in products/t/fab/order/.");
    // On the website there is no folder: nothing is said of one left over.
    const site = view(quotedEx({ handoff: handoff({ problems, parts: [], together: [], italy: undefined }) })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(site.querySelector(".ax-handoff-where")!.textContent, "Once they are fixed, sprue handoff t writes the order sheets in products/t/fab/order/.");
    // A folder still there from an earlier run is out of date while the problems stand, whatever order.json says.
    for (const folder of [{ state: "current", written: "2026-11-09" }, { state: "stale", why: "check case-ok fails (checks.json)" }]) {
      const left = view(quotedEx({ handoff: handoff({ problems, parts: [], together: [], italy: undefined }), handoffFolder: folder })).panel("source").querySelector(".ax-handoff")!;
      assert.equal(left.querySelector(".ax-handoff-where")!.textContent,
        "Once they are fixed, sprue handoff t writes the order sheets in products/t/fab/order/. products/t/fab/order/ is still there from an earlier run and is out of date: don't order from it. sprue status t removes it.", folder.state);
    }
    // One problem is said as one.
    const one = view(quotedEx({ handoff: handoff({ problems: problems.slice(0, 1), parts: [] }) })).panel("source").querySelector(".ax-handoff")!;
    assert.equal(one.querySelector(".ax-warn")!.textContent, "Sprue writes no order sheets for the made parts yet: 1 problem to fix first.");
    assert.equal(one.querySelector(".ax-handoff-problems")!.querySelectorAll("li").length, 1);
    assert.equal(one.querySelector(".ax-handoff-more"), null);
    // Before the quote Source hasn't started, and an explorer.json with no hand-off (no made part) shows none.
    assert.equal(view({ ...explorer(), handoff: handoff() }).panel("source").querySelector(".ax-handoff"), null);
    assert.equal(view(quotedEx()).panel("source").querySelector(".ax-handoff"), null);
  } finally {
    cleanUp();
  }
});

test("a worked example's plan ends with the build-report form, filled in with its name, and only Sprue's form", () => {
  // build(): a product with an example's name and brief (a copy `/sprue example` made) gets the form; one of the
  // person's own, even under an example's name, does not.
  const own = mkdtempSync(join(tmpdir(), "sprue-report-"));
  try {
    const mine = join(own, "products", "macropad");
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, "bom.json"), JSON.stringify({ ...bom, slug: "macropad" }));
    const made = () => {
      const here = process.cwd();
      try {
        process.chdir(own);
        return build("macropad", loadRates(), { shipping: {}, offers: {} }, { quiet: true });
      } finally {
        process.chdir(here);
      }
    };
    writeFileSync(join(mine, "request.json"), readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "request.json")));
    assert.equal(made().buildReport, "https://github.com/B0tes/sprue/issues/new?template=build-report.yml&product=macropad");
    writeFileSync(join(mine, "request.json"), JSON.stringify({ brief: "My own keypad, with a knob." }));
    assert.equal("buildReport" in made(), false);
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
  assert.equal("buildReport" in explorer(), false);

  // The page: under the plan, a link that opens a new tab, and only to the form on Sprue's repo.
  const url = "https://github.com/B0tes/sprue/issues/new?template=build-report.yml&product=macropad";
  const planned = { ...explorer(), quoted: undefined, buildPlanMd: "# Build plan\n", state: at("build", "proposed") } as Explorer;
  const note = view({ ...planned, buildReport: url }).panel("build").querySelector(".ax-report")!;
  assert.equal(note.textContent, "Built one? Tell how it went in a build report on GitHub: whether it works, what you had to fix and on " +
    "which part, and what it cost you. It is public, so leave out your name, your address and order numbers. With your OK, a report " +
    "becomes one of Sprue's test cases.");
  const a = note.querySelector("a")!;
  assert.equal(a.getAttribute("href"), url);
  assert.equal(a.getAttribute("target"), "_blank");
  assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  // The tabbed layout draws it too, and an explorer.json without one, or with any other link or parameter, shows none.
  assert.ok(view({ ...planned, buildReport: url }, "tabs").panel("build").querySelector(".ax-report"));
  for (const bad of [undefined, 42, "https://github.com/someone/sprue/issues/new?template=build-report.yml&product=macropad",
    "https://github.com/B0tes/sprue/issues/new?template=other.yml&product=macropad", `${url}"><script>`, `${url} x`,
    `${url}&template=other.yml`, `${url}&title=Spam&labels=bug`, `${url}#x`, `${url.slice(0, -8)}`,
    "javascript:alert(1)//https://github.com/B0tes/sprue/issues/new?template=build-report.yml&product="])
    assert.equal(view({ ...planned, buildReport: bad as string }).panel("build").querySelector(".ax-report"), null, String(bad));
  // Before there is a plan, nothing.
  assert.equal(view({ ...explorer(), buildReport: url }).panel("build").querySelector(".ax-report"), null);
});

test("the committed examples' explorer.json link to their own build report", () => {
  for (const slug of ["macropad", "ponder"]) {
    const ex = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", slug, "explorer.json"), "utf8")) as Explorer;
    assert.equal(ex.buildReport, reportUrl(slug), slug);
  }
});

test("the page says where each read shipping figure was read: a shop's rates, or a quoting shop's checkout", () => {
  assert.equal(shippingReadNote({ shippingRead: ["DigiKey"] }), "DigiKey has its shipping read from its rates");
  assert.equal(shippingReadNote({ shippingRead: ["DigiKey", "Mouser"] }), "DigiKey, Mouser have their shipping read from their rates");
  assert.equal(shippingReadNote({ shippingRead: ["Weerg"], shippingAtCheckout: ["Weerg"] }), "Weerg has its shipping read at its checkout or from its rates");
  assert.equal(shippingReadNote({ shippingRead: ["Craftcloud", "Weerg", "JLCCNC"], shippingAtCheckout: ["Weerg", "JLCCNC"] }),
    "Craftcloud has its shipping read from its rates, and Weerg, JLCCNC have their shipping read at their checkout or from their rates");
});

test("the page's shipping note and totals speak of the shops the order charges shipping for: a read shop it buys nothing from, or one riding in another's parcel, is none", () => {
  try {
    // The keypad's page as committed, at its Source gate.
    const ex0 = { ...JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")), state: at("source", "proposed") } as Explorer;
    const charged = [...new Set(ex0.lines.flatMap((l) => l.made ? (l.shipsFree ? [] : [l.made.supplier]) : l.chosen >= 0 ? [l.options[l.chosen].supplier] : []))];
    assert.ok(charged.length >= 2, charged.join());
    const [a, b] = charged;
    const page = (more: Partial<Explorer>) => {
      const source = view({ ...ex0, ...more } as Explorer).panel("source");
      return { note: texts(source, "ax-note").find((t) => /Packs round the order up/.test(t ?? "")) ?? "",
        heads: source.all().filter((e) => e.localName === "dt" || e.localName === "th").map((e) => e.textContent).filter((t) => /^Shipping, \d+ shops?/.test(t)) };
    };
    // Only a shop the order buys nothing from had its rate read: every figure in the order is an estimate.
    const away = page({ shipping: { ...ex0.shipping, Elsewhere: 5 }, shippingRead: ["Elsewhere"] });
    assert.match(away.note, /each shop's shipping is counted once, as an estimate: no shop's rate was read\./);
    assert.ok(away.heads.length && away.heads.every((t) => /, est(\.|imated)$/.test(t!)), away.heads.join(" | "));
    // A shop riding in another's parcel charges none, so its read figure is not one of the order's.
    const rides = page({ shippingRead: [a], shipsWith: { [a]: b } });
    assert.match(rides.note, /as an estimate: no shop's rate was read\./);
    // A shop in the order that had its rate read is named, and the totals are no longer all estimates.
    const one = page({ shipping: { ...ex0.shipping, Elsewhere: 5 }, shippingRead: [a, "Elsewhere"] });
    assert.match(one.note, new RegExp(`; only ${a} has its shipping read from its rates, the rest are estimates\\.`));
    assert.ok(one.heads.length && one.heads.every((t) => !/est/.test(t!)), one.heads.join(" | "));
  } finally {
    cleanUp();
  }
});

test("the page says why a dearer offer is in the quote: a line riding in the parcel of the fab the order needs one in, or shipping", () => {
  // An order the quote made before 2026-11-22, when it printed a lid at JLC3DP only where a line rode in its parcel,
  // as an explorer.json written then holds it: JLC3DP prints the lid for R1's washer, riding in its parcel, which the
  // cheapest mix whatever rides lacks (Adafruit's washer is $0.50 less); Adafruit's bolt is dearer than Q's for Q's
  // shipping. On the keypad's page at its Source gate.
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, sku: string, usd: number) => ({ supplier, sku, url: `https://example.com/${sku}`, unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-10-21" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1,
    needQty: 1, spec: {}, mpn: `${id}-1`, options, chosen });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  const lines = [lid, buy("cap", 0, offer("Adafruit", "a1", 2)), buy("washer", 1, offer("Adafruit", "a2", 1), offer("R1", "r1", 1.5)),
    buy("nut", 0, offer("Adafruit", "a3", 0.5), offer("R2", "r2", 1)), { ...buy("bolt", 1, offer("Q", "q4", 0.9), offer("Adafruit", "a4", 1)), offerOrder: [1, 0] }];
  const ex = { ...ex0, state: at("source", "proposed"), lines, units: 1, shipping: { Craftcloud: 10, JLC3DP: 3, Adafruit: 5, R1: 0, R2: 0, Q: 5 },
    shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1", "R2"],
    totals: { ...ex0.totals, batchUsd: 22.73, perUnitUsd: 22.73, unquoted: [] } } as unknown as Explorer;
  const why = (e: Explorer) => texts(view(e).panel("source"), "ax-note").filter((t) => /^The cheapest offer isn't in the quote/.test(t ?? ""));
  assert.deepEqual(why(ex), [
    "The cheapest offer isn't in the quote because the order holds only with a line riding in JLC3DP's parcel (the quote moved a part there for a line to ride with it), and R1's rides in it.",
    "The cheapest offer isn't in the quote because its shop would add shipping the rest of the order doesn't need."]);
  // With no rider needed, the washer at R1 is only shipping's doing.
  assert.deepEqual(why({ ...ex, needsRider: undefined, riders: undefined }), Array(2).fill("The cheapest offer isn't in the quote because its shop would add shipping the rest of the order doesn't need."));
});

/** The stub, keeping the handlers the page adds, so that a test can pick an offer. */
class Live extends Stub {
  handlers = new Map<string, ((e: unknown) => void)[]>();
  override addEventListener(type?: string, fn?: (e: unknown) => void) { if (type && fn) this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  override get classList() { return { add: (...names: string[]) => this.setAttribute("class", [...new Set([...this.classes(), ...names])].join(" ")), remove() {}, toggle() {} }; }
  getBoundingClientRect() { return { top: 0, bottom: 0 }; }
  get type() { return this.getAttribute("type"); }
  set type(v: string | null) { if (v != null) this.setAttribute("type", v); }
  get value() { return this.getAttribute("value"); }
  set value(v: string | null) { if (v != null) this.setAttribute("value", v); }
  closest(sel: string): Live | null {
    for (let e: Stub | null = this; e; e = e.parent) if (e instanceof Live && sel.split(",").some((x) => e!.matches(x.trim()))) return e;
    return null;
  }
  focus() {}
}

/** The page mounted on `ex`, to pick an offer on (line i's option j) or click an element on, as a reader does. */
function onPage<T>(ex: Explorer, act: (page: { el: Live; pick: (i: number, j: number) => void; click: (sel: string) => void }) => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new Live(tag), createElementNS: (_ns: string, tag: string) => new Live(tag), addEventListener() {}, body: new Live("body") };
  g.HTMLInputElement = { [Symbol.hasInstance]: (x: unknown) => x instanceof Live && x.localName === "input" };
  g.Element = { [Symbol.hasInstance]: (x: unknown) => x instanceof Live };
  g.getComputedStyle = () => ({ display: "none" });
  try {
    const el = new Live("div");
    mount(el as unknown as HTMLElement, ex as unknown as Parameters<typeof mount>[1], { layout: "stages" });
    const fire = (type: string, target: Live | undefined) => {
      assert.ok(target, `nothing to ${type}`);
      for (const fn of el.handlers.get(type) ?? []) fn({ target });
    };
    return act({ el,
      pick: (i, j) => fire("change", el.querySelectorAll("input").find((x) => x.getAttribute("data-line") === `${i}` && x.getAttribute("value") === `${j}`) as Live),
      click: (sel) => fire("click", el.querySelector(sel) as Live) });
  } finally {
    for (const k of ["document", "HTMLInputElement", "Element", "getComputedStyle"]) delete g[k];
  }
}

test("on a pick, the page says why the requote moved another line: one riding in the parcel of the fab the order needs one in", () => {
  // The same order: a pick of Adafruit's washer leaves no line riding in JLC3DP's parcel, so the requote buys R2's nut
  // to ride (the page said the pick brought R2 into the order).
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, sku: string, usd: number) => ({ supplier, sku, url: `https://example.com/${sku}`, unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-10-21" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1,
    needQty: 1, spec: {}, mpn: `${id}-1`, options, chosen });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  const lines = [lid, buy("cap", 0, offer("Adafruit", "a1", 2)), buy("washer", 1, offer("Adafruit", "a2", 1), offer("R1", "r1", 1.5)),
    buy("nut", 0, offer("Adafruit", "a3", 0.5), offer("R2", "r2", 1)), { ...buy("bolt", 1, offer("Q", "q4", 0.9), offer("Adafruit", "a4", 1)), offerOrder: [1, 0] }];
  const ex = { ...ex0, state: at("source", "proposed"), lines, units: 1, shipping: { Craftcloud: 10, JLC3DP: 3, Adafruit: 5, R1: 0, R2: 0, Q: 5 },
    shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1", "R2"],
    totals: { ...ex0.totals, batchUsd: 22.73, perUnitUsd: 22.73, unquoted: [] } } as unknown as Explorer;
  assert.deepEqual(movedOnPage(ex, 2, 0),
    ["Moved from Adafruit to R2 by the requote: the order holds only with a line riding in JLC3DP's parcel, your pick leaves none there, and R2 ships in it. The swap for the line you picked moves it too."]);
  // R's x rides in JLC3DP's parcel. A pick of S's y brings S in, and with S in the order the cheapest mix whatever
  // rides buys z there too: the pick is why, not a line riding (the cheapest mix whatever rides, without the pick,
  // keeps z at T).
  const lines2 = [lid, buy("x", 1, offer("T", "t1", 1), offer("R", "r1", 1.5)), buy("y", 0, offer("T", "t2", 1), offer("S", "s2", 1.2)), buy("z", 0, offer("T", "t3", 1), offer("S", "s3", 1.1))];
  const brought = { ...ex, lines: lines2, shipping: { JLC3DP: 3, R: 0, S: 5, T: 5 }, shipsWith: { R: "JLC3DP" }, riders: ["R"] } as unknown as Explorer;
  assert.deepEqual([requote(brought, new Map()).choice, requote(brought, new Map(), false).choice, requote(brought, new Map([[2, 1]]), false).choice],
    [[-1, 1, 0, 0], [-1, 0, 0, 0], [-1, 1, 1, 1]]);
  assert.deepEqual(movedOnPage(brought, 2, 1),
    ["Moved from T to S by the requote: your pick brings S into the order, and with S in it, the cheapest mix of shops buys this line there. The swap for the line you picked moves it too."]);
});

/** The page's words for each line the requote moves, on a pick of line `line`'s offer `value` on the mounted page. */
function movedOnPage(ex: Explorer, line: number, value: number) {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new Live(tag), createElementNS: (_ns: string, tag: string) => new Live(tag), addEventListener() {}, body: new Live("body") };
  g.HTMLInputElement = { [Symbol.hasInstance]: (x: unknown) => x instanceof Live && x.localName === "input" };
  g.getComputedStyle = () => ({ display: "none" });
  try {
    const el = new Live("div");
    mount(el as unknown as HTMLElement, ex as unknown as Parameters<typeof mount>[1], { layout: "stages" });
    const radio = el.querySelectorAll("input").find((x) => x.getAttribute("type") === "radio" && x.getAttribute("data-line") === `${line}` && x.getAttribute("value") === `${value}`);
    assert.ok(radio, `line ${line}'s offer ${value}`);
    for (const fn of el.handlers.get("change") ?? []) fn({ target: radio });
    return [...new Set(el.all().map((e) => e.textContent).filter((t) => /^Moved .* by the requote/.test(t)))];
  } finally {
    for (const k of ["document", "HTMLInputElement", "getComputedStyle"]) delete g[k];
  }
}

test("the page says a pick brought a shop into the order only where the quote has no line there, and a line riding first", () => {
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1,
    needQty: 1, spec: {}, mpn: `${id}-1`, options, chosen });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  const ex = (lines: unknown[], more: Record<string, unknown>) => ({ ...ex0, lines, units: 1, ...more }) as unknown as Explorer;
  /** movedWhy for line `id` with line `line` pinned to its offer at `shop`, as the page calls it. */
  const why = (e: Explorer, line: string, shop: string, id: string) => {
    const i = e.lines.findIndex((l) => l.id === line), pins = new Map([[i, e.lines[i].options.findIndex((o) => o.supplier === shop)]]);
    const choice = requote(e, pins).choice, k = e.lines.findIndex((l) => l.id === id);
    assert.notEqual(choice[k], e.lines[k].chosen, `${id} moves`);
    return movedWhy(e, pins, choice, () => requote(e, pins, false).choice, k);
  };
  // R's x rides in JLC3DP's parcel. A pick of S's x leaves none there, so the requote buys R's $4 y to ride; T then
  // sends only z, which goes to S. S had no line in the quote's order, but z is there for the line riding: the
  // cheapest mix whatever rides keeps it at T.
  // Each line's offers cheapest first, as explorer.json lists them.
  const riding = ex([lid, buy("x", 1, offer("S", 1), offer("R", 2)), buy("y", 0, offer("T", 1), offer("R", 4)), buy("z", 0, offer("T", 1), offer("S", 1.2))],
    { shipping: { JLC3DP: 3, R: 0, S: 3, T: 3 }, shipsWith: { R: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R"] });
  assert.deepEqual(requote(riding, new Map()).choice, [-1, 1, 0, 0]);
  assert.deepEqual(requote(riding, new Map([[1, 0]])).choice, [-1, 0, 1, 1]);
  assert.deepEqual(["y", "z"].map((id) => why(riding, "x", "S", id)), ["the order holds only with a line riding in JLC3DP's parcel, your pick leaves none there, and R ships in it",
    "the order holds only with a line riding in JLC3DP's parcel, your pick leaves none there, and with a line from R riding there, the cheapest mix of shops buys this one there"]);
  // R1's bolt rides. A pick of A's nut leaves it riding, and with it the cheapest mix buys B's washer (the cheapest mix
  // whatever rides keeps the washer and the bolt at Q): the pick leaves a line riding there, and the words say so.
  const kept = ex([lid, buy("washer", 1, offer("B", 1.8), offer("Q", 2.6)), buy("nut", 0, offer("Q", 1.3), offer("A", 2.3)),
    buy("bolt", 1, offer("Q", 1.1), offer("R1", 2.2), offer("B", 2.6))], { shipping: { JLC3DP: 3, A: 5, B: 5, Q: 5, R1: 0 }, shipsWith: { R1: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1"] });
  assert.deepEqual([requote(kept, new Map()).choice, requote(kept, new Map([[2, 1]])).choice, requote(kept, new Map([[2, 1]]), false).choice, requote(kept, new Map([[2, 1]])).total],
    [[-1, 1, 0, 1], [-1, 0, 1, 1], [-1, 1, 1, 0], 29.03]);
  assert.equal(why(kept, "nut", "A", "washer"),
    "the order holds only with a line riding in JLC3DP's parcel, and with your pick the cheapest mix of shops that keeps one there, with a line from R1 riding, buys this one there");
  // R2 ships in JLC3DP's parcel too and sells the bolt, so riders lists it, as quote() does every such shop, but the order
  // buys nothing from it: the words name R1 only.
  const keptR2 = { ...kept, lines: kept.lines.map((l) => (l.id === "bolt" ? { ...l, options: [...l.options, offer("R2", 5)] } : l)),
    shipping: { ...kept.shipping, R2: 0 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, riders: ["R1", "R2"] } as unknown as Explorer;
  assert.deepEqual([requote(keptR2, new Map()).choice, requote(keptR2, new Map([[2, 1]])).choice], [[-1, 1, 0, 1], [-1, 0, 1, 1]]);
  assert.equal(why(keptR2, "nut", "A", "washer"),
    "the order holds only with a line riding in JLC3DP's parcel, and with your pick the cheapest mix of shops that keeps one there, with a line from R1 riding, buys this one there");
  // S sells a, so it is in the quote's order already: a pick of its c leaves T only b, which goes to S too.
  const inOrder = ex([buy("a", 0, offer("S", 1)), buy("b", 0, offer("T", 1), offer("S", 4)), buy("c", 0, offer("T", 1), offer("S", 4))], { shipping: { S: 5, T: 5 } });
  assert.deepEqual([requote(inOrder, new Map()).choice, requote(inOrder, new Map([[2, 1]])).choice], [[0, 0, 0], [0, 1, 1]]);
  assert.equal(why(inOrder, "c", "S", "b"), "with your pick, the cheapest mix of shops buys this line there");
  // With a sold at Z instead, S had no line there: the pick brings it in.
  const brought = ex([buy("a", 0, offer("Z", 1)), buy("b", 0, offer("T", 1), offer("S", 4)), buy("c", 0, offer("T", 1), offer("S", 4))], { shipping: { S: 5, T: 5, Z: 0 } });
  assert.equal(why(brought, "c", "S", "b"), "your pick brings S into the order, and with S in it, the cheapest mix of shops buys this line there");
  // JLCPCB makes the board, whose price holds its shipping, so it is in the order: a pick of its a moves b there, and
  // the pick brings nothing in.
  const board = { id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, needQty: 1, spec: {}, options: [], chosen: -1, shipsFree: true,
    made: { supplier: "JLCPCB", sku: "board", orderQty: 1, orderUsd: 4, leadDays: 5, mode: "estimate", basis: "" } };
  const fab = ex([board, buy("a", 0, offer("T", 1), offer("JLCPCB", 1)), buy("b", 0, offer("T", 1), offer("JLCPCB", 1.1))], { shipping: { JLCPCB: 5, T: 5 } });
  assert.deepEqual([requote(fab, new Map()).choice, requote(fab, new Map([[1, 1]])).choice], [[-1, 0, 0], [-1, 1, 1]]);
  assert.equal(why(fab, "a", "JLCPCB", "b"), "with your pick, the cheapest mix of shops buys this line there");
  // P rides in JLCPCB's parcel, the board's, not JLC3DP's. A pick of B's cap keeps R's m riding there, and with it the
  // cheapest mix buys l at P (whatever rides, at A): R's line is why, not P's, which rides in another fab's parcel.
  const twoFabs = ex([lid, board, buy("m", 1, offer("A", 1), offer("R", 3)), buy("l", 0, offer("A", 1), offer("P", 1.5)), buy("cap", 0, offer("A", 2), offer("B", 2.1))],
    { shipping: { JLC3DP: 3, A: 2, B: 2, R: 0, P: 0 }, shipsWith: { R: "JLC3DP", P: "JLCPCB" }, needsRider: "JLC3DP", riders: ["R"] });
  assert.deepEqual([requote(twoFabs, new Map()).choice, requote(twoFabs, new Map([[4, 1]])), requote(twoFabs, new Map([[4, 1]]), false).choice],
    [[-1, -1, 1, 0, 0], { choice: [-1, -1, 1, 1, 1], total: 25.33 }, [-1, -1, 0, 0, 1]]);
  assert.equal(why(twoFabs, "cap", "B", "l"),
    "the order holds only with a line riding in JLC3DP's parcel, and with your pick the cheapest mix of shops that keeps one there, with a line from R riding, buys this one there");
});

test("the page and sprue bom give a line riding as why only where the cheapest mix whatever rides buys an offer at the line's lowest price", () => {
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-22" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1,
    needQty: 1, spec: {}, mpn: `${id}-1`, options, chosen });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  // An order the quote made before 2026-11-22, when it printed a lid at JLC3DP only where a line rode in its parcel, as
  // an explorer.json written then holds it: it buys R1's $1.50 washer to ride with JLC3DP. Bolt and Adafruit both sell
  // it at its lowest price, and the cheapest mix whatever rides buys Adafruit's, the second of them, whose shipping the
  // cap pays: so a line riding is why, not shipping. With Adafruit's at $1.004, within half a cent, still; at $1.30,
  // the mix buys a dearer offer, and Bolt's $5 shipping is why.
  const at = (adafruit: number) => ({ ...ex0, units: 1, lines: [lid, buy("cap", 0, offer("Adafruit", 2)), buy("washer", 2, offer("Bolt", 1), offer("Adafruit", adafruit), offer("R1", 1.5))],
    shipping: { JLC3DP: 3, Adafruit: 5, Bolt: 5, R1: 0 }, shipsWith: { R1: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1"] }) as unknown as Explorer;
  const says = (e: Explorer, id = "washer") => {
    const out: string[] = [], log = console.log;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    try { printBom(e, id); } finally { console.log = log; }
    return [notCheapestWhy(e, e.lines.findIndex((l) => l.id === id), requote(e, new Map(), false).choice), out.map((x) => x.trim()).find((x) => x.startsWith("The cheapest offer"))];
  };
  const holds = "because the order holds only with a line riding in JLC3DP's parcel (the quote moved a part there for a line to ride with it), and R1's rides in it.";
  const shipping = "because its shop would add shipping the rest of the order doesn't need.";
  for (const [adafruit, why] of [[1, holds], [1.004, holds], [1.3, shipping]] as const) {
    const e = at(adafruit);
    assert.deepEqual([requote(e, new Map(), false).choice[2], requote(e, new Map()).choice[2]], [1, 2], `${adafruit}`);
    assert.deepEqual(says(e), [`The cheapest offer isn't in the quote ${why}`, `The cheapest offer isn't chosen ${why}`], `${adafruit}`);
  }
  // R1's l1 and R2's l3 both ride: A's l2 is in the quote for both of them.
  const two = { ...at(1), lines: [at(1).lines[0], buy("l1", 2, offer("C", 1.07), offer("B", 1.1), offer("R1", 2.24)),
    buy("l2", 1, offer("C", 0.86), offer("A", 1.57), offer("B", 2.37), offer("R2", 3.59), offer("R1", 3.95)), buy("l3", 2, offer("B", 1.58), offer("C", 2.35), offer("R2", 3.1))],
    shipping: { JLC3DP: 3, A: 1, B: 3, C: 3, R1: 0, R2: 0 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, riders: ["R1", "R2"] } as unknown as Explorer;
  assert.deepEqual([requote(two, new Map()).choice, requote(two, new Map(), false).choice], [[-1, 2, 1, 2], [-1, 0, 0, 1]]);
  const both = "because the order holds only with a line riding in JLC3DP's parcel (the quote moved a part there for a line to ride with it): with a line from R1 and R2 riding there, the cheapest mix of shops buys this one at A.";
  assert.deepEqual(says(two, "l2"), [`The cheapest offer isn't in the quote ${both}`, `The cheapest offer isn't chosen ${both}`]);
  // riders lists every shop that ships in JLC3DP's parcel and sells a line, as quote() and build() write it: R2 too, though
  // the quote buys nothing there (w at B, as b is, n at R1 to ride, $19.13). The words name R1 only. With m at R1 as
  // well ($20.03), they name it once.
  const oneOfTwo = (m: boolean) => ({ ...at(1), lines: [lid, buy("w", 1, offer("A", 1), offer("B", 1.4)), buy("n", 1, offer("A", 1), offer("R1", m ? 1.45 : 2), offer("R2", 5)),
    ...(m ? [buy("m", 1, offer("A", 1), offer("R1", 1.45))] : []), buy("b", 0, offer("B", 1), offer("R2", 10))],
    shipping: { JLC3DP: 3, A: m ? 1 : 0.5, B: 2, R1: 0, R2: 0 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, riders: ["R1", "R2"] }) as unknown as Explorer;
  const fromR1 = "because the order holds only with a line riding in JLC3DP's parcel (the quote moved a part there for a line to ride with it): with a line from R1 riding there, the cheapest mix of shops buys this one at B.";
  for (const [m, quoted, plain] of [[false, { choice: [-1, 1, 1, 0], total: 19.13 }, [-1, 0, 0, 0]], [true, { choice: [-1, 1, 1, 1, 0], total: 20.03 }, [-1, 0, 0, 0, 0]]] as const) {
    const e = oneOfTwo(m);
    assert.deepEqual([requote(e, new Map()), requote(e, new Map(), false).choice], [quoted, plain], `${m}`);
    assert.deepEqual(says(e, "w"), [`The cheapest offer isn't in the quote ${fromR1}`, `The cheapest offer isn't chosen ${fromR1}`], `${m}`);
  }
  // P rides in JLCPCB's parcel, the board's, not JLC3DP's: `sprue bom`, as the page, names R as riding there, not P.
  const board = { id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, needQty: 1, spec: {}, options: [], chosen: -1, shipsFree: true,
    made: { supplier: "JLCPCB", sku: "board", orderQty: 1, orderUsd: 4, leadDays: 5, mode: "estimate", basis: "" } };
  const twoFabs = { ...at(1), lines: [lid, board, buy("m", 1, offer("A", 1), offer("R", 3)), buy("l", 1, offer("A", 1), offer("P", 2.9))],
    shipping: { JLC3DP: 3, A: 2, R: 0, P: 0 }, shipsWith: { R: "JLC3DP", P: "JLCPCB" }, riders: ["R"] } as unknown as Explorer;
  assert.deepEqual([requote(twoFabs, new Map()), requote(twoFabs, new Map(), false).choice], [{ choice: [-1, -1, 1, 1], total: 22.63 }, [-1, -1, 0, 0]]);
  const fromR = "because the order holds only with a line riding in JLC3DP's parcel (the quote moved a part there for a line to ride with it): with a line from R riding there, the cheapest mix of shops buys this one at P.";
  assert.deepEqual(says(twoFabs, "l"), [`The cheapest offer isn't in the quote ${fromR}`, `The cheapest offer isn't chosen ${fromR}`]);
});

test("past twenty shops, the search for a line riding drops one shop at a time, as the search for every line does, on the page as in the quote", () => {
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  // Twelve lines, each sold by a shop of its own (U), by R1 and R2, riding in JLC3DP's parcel, at $10, and by seven
  // others (Z) at $2 to $3.20: 21 shops. The cheapest mix buys none of R1's or R2's, so the search pins each of their
  // offers in turn, which leaves 20 shops: it searched every set of those, a million, for each of the 24 (about ten
  // seconds on the page).
  const lines = [lid, ...Array.from({ length: 12 }, (_, k) => ({ id: `b${k}`, name: `b${k}`, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1,
    spec: {}, mpn: `b${k}-1`, chosen: 0, options: [offer(`U${k}`, 1), ...Array.from({ length: 7 }, (_, j) => offer(`Z${j}`, 2 + ((k * 7 + j * 3) % 13) / 10)), offer("R1", 10), offer("R2", 10)]
      .sort((a, b) => a.orderUsd - b.orderUsd) }))];
  const shipping = Object.fromEntries([...Array.from({ length: 12 }, (_, k) => [`U${k}`, 4]), ...Array.from({ length: 7 }, (_, j) => [`Z${j}`, 5 + j]), ["R1", 0], ["R2", 0], ["JLC3DP", 3]]);
  const ex = { ...ex0, lines, units: 1, shipping, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1", "R2"] } as unknown as Explorer;
  const timed = <T>(fn: () => T): [T, number] => { const t = performance.now(); return [fn(), performance.now() - t]; };
  const [page, pageMs] = timed(() => requote(ex, new Map())), [quoted, quoteMs] = timed(() => requoteTs(ex, new Map()));
  assert.deepEqual(page, quoted);
  assert.ok(page.choice.some((j, i) => ["R1", "R2"].includes(ex.lines[i].options[j]?.supplier)), "a line riding");
  assert.ok(pageMs < 3000 && quoteMs < 3000, `${Math.round(pageMs)} ms on the page, ${Math.round(quoteMs)} ms in the quote`);
  // With twenty shops, every search tries every set of them, a rider's offer pinned or not: X for l1 and l2, and R's
  // l3 riding, $29.73 (dropping one shop at a time keeps P and Q, $1 more).
  const d = Array.from({ length: 15 }, (_, k) => offer(`D${k}`, 100));
  const buy = (id: string, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1, spec: {},
    mpn: `${id}-1`, chosen: 0, options });
  const twenty = { ...ex, lines: [lid, buy("l1", offer("P", 0.5), offer("X", 1), ...d), buy("l2", offer("Q", 0.5), offer("X", 1)), buy("l3", offer("Z", 1), offer("R", 5))],
    shipping: { X: 10, P: 6, Q: 6, Z: 0, R: 0, JLC3DP: 3, ...Object.fromEntries(d.map((o) => [o.supplier, 1])) }, shipsWith: { R: "JLC3DP" }, riders: ["R"] } as unknown as Explorer;
  const both = requote(twenty, new Map());
  assert.deepEqual(both, requoteTs(twenty, new Map()));
  assert.deepEqual([both.choice.map((j, i) => twenty.lines[i].options[j]?.supplier), both.total], [[undefined, "X", "X", "R"], 29.73]);
  // The cheapest mix whatever rides, and an order that needs no line riding, search every set of the twenty too: X for
  // l1 and l2 and Z's l3, $25.73.
  const plain = requote(twenty, new Map(), false), free = { ...twenty, needsRider: undefined, riders: [] } as unknown as Explorer;
  assert.deepEqual(plain, requoteTs(twenty, new Map(), false));
  assert.deepEqual(requote(free, new Map()), requoteTs(free, new Map()));
  assert.deepEqual([plain.choice.map((j, i) => twenty.lines[i].options[j]?.supplier), plain.total, requote(free, new Map()).total], [[undefined, "X", "X", "Z"], 25.73, 25.73]);
  // W, a 21st shop, sells l4 as Z does: a pick of Z's l4 leaves twenty, so the search with the pin tries every set of
  // them, the page's as the quote's (counted before the pin, the page dropped one shop at a time and kept P and Q, $1
  // more).
  const more = { ...twenty, lines: [...twenty.lines, buy("l4", offer("Z", 1), offer("W", 1))], shipping: { ...twenty.shipping, W: 0 } } as unknown as Explorer;
  const pinned = requote(more, new Map([[4, 0]]));
  assert.deepEqual(pinned, requoteTs(more, new Map([[4, 0]])));
  assert.deepEqual([pinned.choice.map((j, i) => more.lines[i].options[j]?.supplier), pinned.total], [[undefined, "X", "X", "R", "Z"], 30.73]);
  // And with no line needed riding, the search for every line past twenty shops: X, Y, Z, B and F0 to F16 sell, 21
  // shops. Dropping one at a time from all 21 keeps X and Y, $25, as the quote does (every set of them gives Z, $23).
  const f = Array.from({ length: 17 }, (_, k) => buy(`f${k}`, offer(`F${k}`, 1)));
  const wide = { ...ex0, units: 1, lines: [buy("l1", offer("X", 0), offer("Z", 0.5), offer("B", 100)), buy("l2", offer("Y", 0), offer("Z", 0.5)), ...f],
    shipping: { X: 4, Y: 4, Z: 5, B: 0, ...Object.fromEntries(f.map((_, k) => [`F${k}`, 0])) } } as unknown as Explorer;
  const all = requote(wide, new Map());
  assert.deepEqual(all, requoteTs(wide, new Map()));
  assert.deepEqual([all.choice.slice(0, 2).map((j, i) => wide.lines[i].options[j]?.supplier), all.total], [["X", "Y"], 25]);
});

test("the page's search drops shops in the order the quote's does, keeps a drop only where it saves, and of sets of shops that cost the same up to float noise keeps the first", () => {
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const buy = (id: string, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1, spec: {},
    mpn: `${id}-1`, chosen: 0, options: [...options].sort((a, b) => a.orderUsd - b.orderUsd) });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  // `lines`, then n lines each sold only by a shop of its own (F0, F1 ...) at $1 with no shipping, which no search drops.
  const shops = (lines: unknown[], shipping: Record<string, number>, n: number) => ({ ...ex0, units: 1,
    lines: [...lines, ...Array.from({ length: n }, (_, k) => buy(`f${k}`, offer(`F${k}`, 1)))],
    shipping: { ...shipping, ...Object.fromEntries(Array.from({ length: n }, (_, k) => [`F${k}`, 0])) } }) as unknown as Explorer;
  // The same, with a lid made at JLC3DP that needs a line riding there: R's $5 lr, where Z sells it for $1. The search
  // with R's offer pinned searches the other lines as the one for every line does.
  const riding = (ex: Explorer) => ({ ...ex, lines: [lid, ...ex.lines, buy("lr", offer("Z", 1), offer("R", 5))], shipping: { ...ex.shipping, Z: 0, R: 0, JLC3DP: 3 },
    shipsWith: { R: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R"] }) as unknown as Explorer;
  const priced = (ex: Explorer) => {
    const page = requote(ex, new Map());
    assert.deepEqual(page, requoteTs(ex, new Map()));
    return [page.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").filter((s) => !/^F\d/.test(s)).join(" "), page.total];
  };
  // Past twenty shops the search starts from all of them and drops one at a time, in the order it meets them, while a
  // drop saves. P, Q and 19 others: dropping P first leaves Q for both lines, $7.20 (dropping Q first would leave P
  // for both, $7.50).
  const pq = shops([buy("l1", offer("P", 1), offer("Q", 1.2)), buy("l2", offer("Q", 1), offer("P", 1.5))], { P: 5, Q: 5 }, 19);
  assert.deepEqual([priced(pq), priced(riding(pq))], [["Q Q", 26.2], ["- Q Q R", 43.93]]);
  // After a drop it goes on to the next shop, not back to the first: here that keeps A and C, $35.20 (going back gives
  // B and E, $32.80).
  const on = shops([buy("l0", offer("A", 1), offer("D", 1), offer("B", 1.7)), buy("l1", offer("A", 0.7), offer("E", 1.8), offer("D", 2.2)),
    buy("l2", offer("C", 2.1), offer("B", 2.6), offer("D", 3.3)), buy("l3", offer("B", 0.3), offer("A", 0.7), offer("C", 2.8), offer("E", 3.4)),
    buy("l4", offer("D", 0.1), offer("E", 2.4), offer("C", 3.7))], { A: 4, B: 2, C: 6, D: 8, E: 5 }, 17);
  assert.deepEqual([priced(on), priced(riding(on))], [["A A C A C", 35.2], ["- A A C A C R", 52.93]]);
  // A drop that costs the same is not kept: dropping A, B or C from all three costs the same, so A and C stay, $25
  // (keeping such drops ends at B for both, $23).
  const same = shops([buy("l1", offer("A", 1), offer("B", 1)), buy("l2", offer("B", 1), offer("C", 0.5))], { A: 2, B: 2, C: 2.5 }, 19);
  assert.deepEqual([priced(same), priced(riding(same))], [["A C", 25], ["- A C R", 42.73]]);
  // Nor one that saves only float noise: dropping C from all three costs 19.4 where they cost 19.400000000000002, so C
  // stays, and dropping A, then C, leaves B for both lines, $18.90 (keeping that drop ends at A for both, $19.30).
  const noiseDrop = shops([buy("l0", offer("C", 0.1), offer("B", 0.3), offer("A", 0.6)), buy("l1", offer("A", 0.1), offer("B", 0.2), offer("C", 0.2))],
    { A: 0.6, B: 0.4, C: 0.6 }, 18);
  assert.deepEqual([priced(noiseDrop), priced(riding(noiseDrop))], [["B B", 18.9], ["- B B R", 36.63]]);
  // Up to twenty shops it tries every set of them, and of two that cost the same keeps the first it meets, though
  // 0.1 + 0.2 + 0.3 is 0.6000000000000001 and not 0.6: A for both lines, not B.
  const noise = shops([buy("l1", offer("A", 0.1), offer("B", 0.3)), buy("l2", offer("B", 0), offer("A", 0.2))], { A: 0.3, B: 0.3 }, 0);
  // And in the search with R's l1 pinned: B for l2 and l3, not C.
  const noisy = { ...shops([lid, buy("l1", offer("A", 0), offer("R", 0)), buy("l2", offer("B", 0.1), offer("C", 0.3)), buy("l3", offer("C", 0), offer("B", 0.2))],
    { A: 0, R: 0, B: 0.3, C: 0.3, JLC3DP: 3 }, 0), shipsWith: { R: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R"] } as unknown as Explorer;
  assert.deepEqual([priced(noise), priced(noisy)], [["A A", 0.6], ["- R B B", 13.33]]);
});

test("where the cheapest mix already buys a line from a shop riding in the fab's parcel, the page keeps it, whichever rider and on whichever line, as the quote does", () => {
  const ex0 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "examples", "macropad", "explorer.json"), "utf8")) as Explorer;
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const buy = (id: string, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1, spec: {},
    mpn: `${id}-1`, chosen: 0, options });
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, needQty: 1, spec: { volumeCm3: 25, material: "PA12" },
    file: "fab/lid.stl", options: [], chosen: -1, shipsFree: false,
    made: { supplier: "JLC3DP", sku: "lid.stl, PA12", orderQty: 1, orderUsd: 9.73, leadDays: 3, mode: "estimate", basis: "" } };
  const priced = (...lines: unknown[]) => {
    const ex = { ...ex0, units: 1, lines: [lid, ...lines], shipping: { A: 0, B: 0, Y: 0, Z: 0, R1: 0, R2: 0, JLC3DP: 3 },
      shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1", "R2"] } as unknown as Explorer;
    const page = requote(ex, new Map());
    assert.deepEqual(page, requoteTs(ex, new Map()));
    return [page.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").join(" "), page.total];
  };
  // A's washer, the nut from one rider and B's bolt cost the same as the other rider's washer with that nut and bolt:
  // the cheapest mix rides already, so the page keeps A's washer, whether the nut's shop is listed first or last of
  // the riders and whether the nut is the last line or not (pinning the washer's rider would buy it there).
  const washer = (rider: string) => buy("washer", offer("A", 1), offer(rider, 1));
  assert.deepEqual([priced(washer("R2"), buy("nut", offer("R1", 1)), buy("bolt", offer("B", 1))), priced(washer("R1"), buy("nut", offer("R2", 1)), buy("bolt", offer("B", 1))),
    priced(washer("R2"), buy("bolt", offer("B", 1)), buy("nut", offer("R1", 1)))], [["- A R1 B", 15.73], ["- A R2 B", 15.73], ["- A B R1", 15.73]]);
  // And where the nut is the first line: Y sells it too, for $5, so the cheapest mix meets Y before Z and of their caps,
  // at the same price, buys Y's; the search with R1's nut pinned leaves Y out of that line, meets Z first and would buy
  // Z's.
  assert.deepEqual(priced(buy("nut", offer("R1", 1), offer("Y", 5)), buy("cap", offer("Z", 1), offer("Y", 1))), ["- R1 Y", 14.73]);
});

test("the page counts as riding in a fab's parcel only a shop riding there, not one a made line pays, and of riding mixes that cost the same keeps the first, as the quote does", () => {
  // The board costs $1.50 more at JLCPCB than at OSH Park, each with its shipping in the price, and R rides with JLCPCB:
  // R's $3 b2, with no shipping of its own there, saves $3 on Z's with Z's $5, so the quote makes the board at JLCPCB,
  // an order that holds only with a line riding in its parcel (needsRider). S quotes L0 and sells b1: L0 pays S's
  // shipping, so b1 adds none, but S does not ride with JLCPCB. Built as `sprue view` builds the page.
  const slug = "rides", spec = { material: "aluminium 6061-T6", features: "two M4 tapped holes" };
  mkdirSync(join(root, "products", slug), { recursive: true });
  const lines = [{ id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 50, heightMm: 40, layers: 2 } },
    { id: "L0", name: "L0", role: "bracket", process: "cnc", qtyPerUnit: 1, spec, file: "fab/L0.step" },
    ...["b1", "b2", "b3"].map((id) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }))] as BomLine[];
  const bom: Bom = { slug, units: 1, lines };
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-21" }) as Offer;
  const catalog = { shipping: { S: 10, R: 20, Z: 5, A: 3, B: 3 }, shipsWith: { R: "JLCPCB" },
    offers: { b1: [sells("S", "b1", 1)], b2: [sells("R", "b2", 3), sells("Z", "b2", 1)], b3: [sells("A", "b3", 1), sells("B", "b3", 1.2), sells("R", "b3", 4.5)] } };
  const rates = { ...loadRates(), shopQuotes: { L0: [{ supplier: "S", sku: "S-L0", url: "https://example.com/q", priceBreaks: [{ qty: 1, shopTotal: 10, unitUsd: 10 }],
    stock: "unknown", leadDays: 9, source: "snapshot", capturedAt: "2026-11-21", shopQuote: { part: "fab/L0.stl",
      sha256: "a5707be7fcb55fdd63eac5350d24f23281fdeaa395ea42ee9587ca5b1876b078", spec, currency: "USD", vat: "excluded", expires: "not stated" } } as Offer] } };
  const priced = (b: Bom) => quote(b, source(b, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const shops = (x: Explorer, r: ReturnType<typeof requote>) => [r.choice.map((j, i) => x.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  assert.deepEqual([ex.needsRider, ex.riders, ex.lines[0].made?.supplier, ex.totals.batchUsd, shops(ex, requote(ex, new Map()))],
    ["JLCPCB", ["R"], "JLCPCB", 45, ["- - S R A", 45]]);
  // With Z's b2 picked, `sprue pick` makes the board at OSH Park again, as that saves more than R's line riding does,
  // and so does the page. With the board kept where the quote made it (withWay() with no order of the made lines: the
  // quote's), the requote buys R's b3, $0.50 dearer than A's, to ride (S's b1 counted as riding, it kept A's, $48).
  const pins = new Map([[3, 0]]), b2AtZ = priced({ ...bom, lines: lines.map((l) => (l.id === "b2" ? { ...l, pin: { supplier: "Z" } } : l)) });
  const board = (r: ReturnType<typeof requote>) => withWay(ex, r.way ?? -1).lines[0].made?.supplier;
  assert.deepEqual([shops(ex, requote(ex, pins)), shops(ex, requoteTs(ex, pins)), board(requote(ex, pins)), board(requoteTs(ex, pins)),
    ["board", "b2", "b3"].map((id) => b2AtZ.lines.find((x) => x.lineId === id)?.supplier), b2AtZ.batchUsd],
    [["- - S Z A", 46.5], ["- - S Z A", 46.5], "OSH Park", "OSH Park", ["OSH Park", "Z", "A"], 46.5]);
  const kept = withWayTs(ex, -1);
  assert.deepEqual([kept.ways, shops(kept, requote(withWay(ex, -1), pins)), shops(kept, requoteTs(kept, pins))], [undefined, ["- - S Z R", 48.5], ["- - S Z R", 48.5]]);
  // R1's $0.10 l1 with Y's $0.20 l2 and A's $0 l1 with R2's $0.30 l2 cost the same, though 0.1 + 0.2 is
  // 0.30000000000000004 and not 0.3: the page keeps the first, by line, as the quote does.
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1,
    spec: {}, mpn: `${id}-1`, chosen, options });
  const tie = { ...kept, lines: [ex.lines[0], buy("l1", 1, offer("A", 0), offer("R1", 0.1)), buy("l2", 0, offer("Y", 0.2), offer("R2", 0.3))],
    shipping: { A: 0, Y: 0, R1: 0, R2: 0 }, shipsWith: { R1: "JLCPCB", R2: "JLCPCB" }, needsRider: "JLCPCB", riders: ["R1", "R2"] } as unknown as Explorer;
  assert.deepEqual([shops(tie, requote(tie, new Map())), shops(tie, requoteTs(tie, new Map()))], [["- R1 Y", 17.3], ["- R1 Y", 17.3]]);
});

test("of one line's offers from shops riding in a fab's parcel, the page buys the cheapest, whatever order catalog.json lists them in, as the quote does", () => {
  // The board costs $1.50 more at JLCPCB than at OSH Park; R1's $2 washer and R2's $1.50 ride with JLCPCB, R1's listed
  // first, and A's $1 rides nowhere. With no shipping of its own at JLCPCB, R2's washer costs $2.50 less than A's with
  // A's $3, so the quote makes the board there for it ($21.50). Built as `sprue view` builds the page.
  const slug = "later";
  mkdirSync(join(root, "products", slug), { recursive: true });
  const lines = [{ id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 50, heightMm: 40, layers: 2 } },
    { id: "w", name: "Washer", role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "w-1" },
    { id: "n", name: "Nut", role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "n-1" }] as BomLine[];
  const bom: Bom = { slug, units: 1, lines };
  const sells = (supplier: string, mpn: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${mpn}`, mpn, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-21" }) as Offer;
  const catalog = { shipping: { A: 3, Q: 2, R1: 8, R2: 8 }, shipsWith: { R1: "JLCPCB", R2: "JLCPCB" },
    offers: { w: [sells("A", "w-1", 1), sells("R1", "w-1", 2), sells("R2", "w-1", 1.5)], n: [sells("Q", "n-1", 1), sells("A", "n-1", 2.5)] } };
  const rates = loadRates();
  const priced = (b: Bom) => quote(b, source(b, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const shops = (r: ReturnType<typeof requote>) => [r.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  assert.deepEqual([ex.needsRider, ex.riders, ex.lines[1].offerOrder, ex.totals.batchUsd, shops(requote(ex, new Map()))],
    ["JLCPCB", ["R2", "R1"], [0, 2, 1], 21.5, ["- R2 Q", 21.5]]);
  // With A's nut picked, A's washer is the cheapest, A's shipping paid: `sprue pick` makes the board at OSH Park again
  // and buys A's, $22, and so does the page. With the board kept where the quote made it, the requote buys R2's washer
  // to ride, not R1's, listed first.
  const pins = new Map([[2, 1]]), nAtA = priced({ ...bom, lines: lines.map((l) => (l.id === "n" ? { ...l, pin: { supplier: "A" } } : l)) });
  const board = (r: ReturnType<typeof requote>) => withWay(ex, r.way ?? -1).lines[0].made?.supplier;
  assert.deepEqual([shops(requote(ex, pins)), shops(requoteTs(ex, pins)), board(requote(ex, pins)), board(requoteTs(ex, pins)),
    ["board", "w", "n"].map((id) => nAtA.lines.find((x) => x.lineId === id)?.supplier), nAtA.batchUsd],
    [["- A A", 22], ["- A A", 22], "OSH Park", "OSH Park", ["OSH Park", "A", "A"], 22]);
  assert.deepEqual([shops(requote(withWay(ex, -1), pins)), shops(requoteTs(withWayTs(ex, -1), pins))], [["- R2 A", 24], ["- R2 A", 24]]);
});

test("in a search with a line pinned to a rider's offer, the page meets the shops in the pinned lists' order, as the quote does: of two mixes that cost the same, both keep the first", () => {
  // The board costs $1.50 more at JLCPCB than at OSH Park, and R's l0 rides with JLCPCB: there, with no shipping of its
  // own, R's l0 with Z's l1 (Z's shipping paid by l2) comes to $2 less than both lines at Y with Y's $4, so the quote
  // makes the board at JLCPCB ($25.50). With W's l2 picked, `sprue pick` makes the board at OSH Park again and buys
  // both at Y, $26.50, and so does the page. With the board kept where the quote made it, the cheapest mix buys none of
  // R's (l0 and l1 at Y), so the search pins l0 to R, where X's l1 and Y's cost the same: R, then X, are the first
  // shops it meets, so the requote keeps X's ($29). Met in l0's unpinned order, Y's first, it kept Y's. Built as
  // `sprue view` builds the page.
  const slug = "pinned";
  mkdirSync(join(root, "products", slug), { recursive: true });
  const ids = ["l0", "l1", "l2"];
  const lines = [{ id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 50, heightMm: 40, layers: 2 } },
    ...ids.map((id) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }))] as BomLine[];
  const bom: Bom = { slug, units: 1, lines };
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-22" }) as Offer;
  const catalog = { shipping: { X: 4, Y: 4, Z: 3.5, W: 2, R: 20 }, shipsWith: { R: "JLCPCB" },
    offers: { l0: [sells("Y", "l0", 1), sells("R", "l0", 2)], l1: [sells("X", "l1", 1), sells("Y", "l1", 1), sells("Z", "l1", 2)], l2: [sells("Z", "l2", 1), sells("W", "l2", 3)] } };
  const rates = loadRates();
  const priced = (b: Bom) => quote(b, source(b, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const shops = (r: ReturnType<typeof requote>) => [r.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  const pins = new Map([[3, 1]]), l2AtW = priced({ ...bom, lines: lines.map((l) => (l.id === "l2" ? { ...l, pin: { supplier: "W" } } : l)) });
  const kept = withWay(ex, -1), keptTs = withWayTs(ex, -1);
  assert.deepEqual([ex.needsRider, ex.riders, shops(requote(ex, new Map())), shops(requote(kept, pins)), shops(requoteTs(keptTs, pins)),
    ["board", ...ids].map((id) => l2AtW.lines.find((x) => x.lineId === id)?.supplier).join(" "), l2AtW.batchUsd],
    ["JLCPCB", ["R"], ["- R Z Z", 25.5], ["- R X W", 29], ["- R X W", 29], "OSH Park Y Y W", 26.5]);
  const board = (r: ReturnType<typeof requote>) => withWay(ex, r.way ?? -1).lines[0].made?.supplier;
  assert.deepEqual([shops(requote(ex, pins)), shops(requoteTs(ex, pins)), board(requote(ex, pins)), board(requoteTs(ex, pins))],
    [["- Y Y W", 26.5], ["- Y Y W", 26.5], "OSH Park", "OSH Park"]);
});

test("explorer.json's riders are the shops selling a line here that ride with the fab the order needs one in, their own shipping not a known 0, and the page's words name them", () => {
  // Each order built as `sprue view` builds the page, from a bom and a catalog quoted as `sprue quote` quotes them.
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-22" }) as Offer;
  type Catalog = { shipping: Record<string, number>; shipsWith: Record<string, string>; offers: Record<string, Offer[]> };
  const board = { id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 50, heightMm: 40, layers: 2 } } as BomLine;
  const lid = { id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 20, material: "PETG" }, file: "fab/lid.stl" } as BomLine;
  const buy = (id: string) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }) as BomLine;
  const rates = loadRates();
  const built = (slug: string, lines: BomLine[], catalog: Catalog) => {
    mkdirSync(join(root, "products", slug), { recursive: true });
    const bom: Bom = { slug, units: 1, lines };
    writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
    writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith })));
    return inRoot(() => build(slug, rates, catalog, { quiet: true }));
  };
  const pick = (ex: Explorer, id: string, shop: string) => {
    const i = ex.lines.findIndex((l) => l.id === id);
    return new Map([[i, ex.lines[i].options.findIndex((o) => o.supplier === shop)]]);
  };
  // The requote with the made lines where the quote put them (withWay() with none of its orders of them), whose words
  // these are.
  const shops = (ex: Explorer, r: ReturnType<typeof requote>) => [r.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  const kept = (ex: Explorer, pins: Map<number, number>) => shops(ex, requote(withWay(ex, -1), pins));
  // And the page's own, every line's shop (a made line's where the requote makes it), with `sprue pick`'s and the
  // command line's: the same.
  const every = (ex: Explorer, r: ReturnType<typeof requote>) =>
    [withWay(ex, r.way ?? -1).lines.map((l, i) => l.made?.supplier ?? l.options[r.choice[i]]?.supplier ?? "-").join(" "), r.total];
  const asPick = (ex: Explorer, lines: BomLine[], catalog: Catalog, id: string, shop: string) => {
    const bom: Bom = { slug: "pick", units: 1, lines: lines.map((l) => (l.id === id ? { ...l, pin: { supplier: shop } } : l)) };
    const q = quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
    const p = pick(ex, id, shop);
    return [every(ex, requote(ex, p)), every(ex, requoteTs(ex, p)), [ex.lines.map((l) => q.lines.find((x) => x.lineId === l.id)?.supplier ?? "-").join(" "), q.batchUsd]];
  };
  // A PETG lid at Craftcloud, a board that costs $1.50 more at JLCPCB than at OSH Park, and JLCMC riding with JLCPCB:
  // JLCMC's $1 nut with no shipping of its own beats Z's $0.50 with Z's $9, so the quote makes the board at JLCPCB.
  // A pick of Z's nut leaves no line riding: with the board kept there, the requote buys a washer from a rider ($51);
  // `sprue pick` makes the board at OSH Park again and buys Adafruit's, $49, and so does the page.
  const lines = [lid, board, buy("cap"), buy("washer"), buy("nut")];
  const base: Catalog = { shipping: { Craftcloud: 10, Adafruit: 5, JLCMC: 8, Z: 9 }, shipsWith: { JLCMC: "JLCPCB" },
    offers: { cap: [sells("Adafruit", "cap", 2)], washer: [sells("Adafruit", "washer", 1), sells("JLCMC", "washer", 1.5)], nut: [sells("JLCMC", "nut", 1), sells("Z", "nut", 0.5)] } };
  const plain = built("riders", lines, base);
  assert.deepEqual([plain.needsRider, plain.riders, plain.totals.batchUsd, kept(plain, pick(plain, "nut", "Z"))],
    ["JLCPCB", ["JLCMC"], 42, ["- - Adafruit JLCMC Z", 51]]);
  const moved = ["Craftcloud OSH Park Adafruit Adafruit Z", 49];
  assert.deepEqual(asPick(plain, lines, base, "nut", "Z"), [moved, moved, moved]);
  // F rides with JLCPCB too and sells the washer for $1.10, but its own shipping is $0: riding saves it none, so the
  // quote counts no line of F's as riding, and nor does the page.
  const free = built("free", lines, { ...base, shipping: { ...base.shipping, F: 0 }, shipsWith: { ...base.shipsWith, F: "JLCPCB" },
    offers: { ...base.offers, washer: [...base.offers.washer, sells("F", "washer", 1.1)] } });
  assert.deepEqual([free.needsRider, free.riders, free.totals.batchUsd, kept(free, pick(free, "nut", "Z"))],
    ["JLCPCB", ["JLCMC"], 42, ["- - Adafruit JLCMC Z", 51]]);
  // R sells the washer for $1.20 and rides with Craftcloud, not JLCPCB: not a rider here.
  const other = built("other", lines, { ...base, shipping: { ...base.shipping, R: 8 }, shipsWith: { ...base.shipsWith, R: "Craftcloud" },
    offers: { ...base.offers, washer: [...base.offers.washer, sells("R", "washer", 1.2)] } });
  assert.deepEqual([other.needsRider, other.riders, other.totals.batchUsd, kept(other, pick(other, "nut", "Z"))],
    ["JLCPCB", ["JLCMC"], 42, ["- - Adafruit JLCMC Z", 51]]);
  // JLC3DP rides with JLCPCB, sells the washer for $1.20 and has no shipping figure in catalog.json: a rider, its
  // washer the cheapest to ride.
  const unread = built("unread", lines, { ...base, shipsWith: { ...base.shipsWith, JLC3DP: "JLCPCB" },
    offers: { ...base.offers, washer: [...base.offers.washer, sells("JLC3DP", "washer", 1.2)] } });
  assert.deepEqual([unread.needsRider, unread.riders, unread.totals.batchUsd, kept(unread, pick(unread, "nut", "Z"))],
    ["JLCPCB", ["JLC3DP", "JLCMC"], 42, ["- - Adafruit JLC3DP Z", 50.7]]);
  // R1's m and R2's n ride with JLCPCB. A pick of Y's k brings Y in, so m goes there and n to R2, to ride: R1's m still
  // riding with only the pick made, the words say the cheapest mix that keeps a line there buys n at R2.
  const swapLines = [board, buy("m"), buy("k"), buy("n")];
  const swapCat: Catalog = { shipping: { Y: 5, Z: 0, T: 0, R1: 8, R2: 8 }, shipsWith: { R1: "JLCPCB", R2: "JLCPCB" },
    offers: { m: [sells("R1", "m", 1.2), sells("Y", "m", 1)], k: [sells("Z", "k", 1), sells("Y", "k", 1.5)], n: [sells("T", "n", 1), sells("R2", "n", 1.1)] } };
  const swap = built("swap", swapLines, swapCat);
  const k = pick(swap, "k", "Y");
  assert.deepEqual([swap.needsRider, swap.riders, swap.totals.batchUsd, kept(swap, k)], ["JLCPCB", ["R1", "R2"], 20.2, ["- Y Y R2", 25.6]]);
  assert.deepEqual(movedOnPage(withWayTs(swap, -1), 2, k.get(2)!), ["Moved from R1 to Y by the requote: your pick brings Y into the order, and with Y in it, the cheapest mix of shops buys this line there. The swap for the line you picked moves it too.",
    "Moved from T to R2 by the requote: the order holds only with a line riding in JLCPCB's parcel, and with your pick the cheapest mix of shops that keeps one there buys this one at R2, which ships in it. The swap for the line you picked moves it too."]);
  // R1's y rides with JLCPCB. A pick of Y's y leaves none there: the requote buys R2's a to ride, and with a from R2
  // riding, b and c go to T: the words name R2, the rider with the pick, not R1, the quote's.
  const namedLines = [board, buy("cap"), buy("washer"), buy("a"), buy("b"), buy("c"), buy("y")];
  const namedCat: Catalog = { shipping: { Adafruit: 5, R1: 8, R2: 8, Q: 3, P: 3, T: 3, Y: 6 }, shipsWith: { R1: "JLCPCB", R2: "JLCPCB" },
    offers: { cap: [sells("Adafruit", "cap", 2)], washer: [sells("Adafruit", "washer", 1)], a: [sells("Q", "a", 1), sells("R2", "a", 5)],
      b: [sells("Q", "b", 1), sells("P", "b", 2), sells("T", "b", 1.5)], c: [sells("P", "c", 1), sells("T", "c", 1.2)], y: [sells("Y", "y", 1), sells("R1", "y", 1.2)] } };
  const named = built("named", namedLines, namedCat);
  const y = pick(named, "y", "Y");
  assert.deepEqual([named.needsRider, named.riders, named.totals.batchUsd, kept(named, y)], ["JLCPCB", ["R2", "R1"], 35.2, ["- Adafruit Adafruit R2 T T Y", 42.7]]);
  const leaves = "by the requote: the order holds only with a line riding in JLCPCB's parcel, your pick leaves none there, and";
  const too = "The swap for the line you picked moves it too.";
  assert.deepEqual(movedOnPage(withWayTs(named, -1), 6, y.get(6)!), [`Moved from Q to R2 ${leaves} R2 ships in it. ${too}`,
    `Moved from Q to T ${leaves} with a line from R2 riding there, the cheapest mix of shops buys this one there. ${too}`,
    `Moved from P to T ${leaves} with a line from R2 riding there, the cheapest mix of shops buys this one there. ${too}`]);
  // Each pick above, the board free to move as `sprue pick` moves it: the page and the command line requote as it
  // does, and the page says why the board moved.
  const freeCat = { ...base, shipping: { ...base.shipping, F: 0 }, shipsWith: { ...base.shipsWith, F: "JLCPCB" }, offers: { ...base.offers, washer: [...base.offers.washer, sells("F", "washer", 1.1)] } };
  const otherCat = { ...base, shipping: { ...base.shipping, R: 8 }, shipsWith: { ...base.shipsWith, R: "Craftcloud" }, offers: { ...base.offers, washer: [...base.offers.washer, sells("R", "washer", 1.2)] } };
  const unreadCat = { ...base, shipsWith: { ...base.shipsWith, JLC3DP: "JLCPCB" }, offers: { ...base.offers, washer: [...base.offers.washer, sells("JLC3DP", "washer", 1.2)] } };
  const same = (x: unknown) => [x, x, x];
  for (const got of [asPick(free, lines, freeCat, "nut", "Z"), asPick(other, lines, otherCat, "nut", "Z"), asPick(unread, lines, unreadCat, "nut", "Z"),
    asPick(swap, swapLines, swapCat, "k", "Y"), asPick(named, namedLines, namedCat, "y", "Y")]) assert.deepEqual(got, same(got[2]));
  assert.deepEqual([asPick(swap, swapLines, swapCat, "k", "Y")[2], asPick(named, namedLines, namedCat, "y", "Y")[2]],
    [["OSH Park Y Y T", 24], ["OSH Park Adafruit Adafruit Q Q P Y", 39.5]]);
  const back = `Moved from JLCPCB to OSH Park by the requote: the quote made it at JLCPCB for a line to ride in its parcel, and with your pick that no longer pays. ${too}`;
  assert.deepEqual([movedOnPage(swap, 2, k.get(2)!), movedOnPage(named, 6, y.get(6)!)],
    [[`Moved from R1 to Y by the requote: your pick brings Y into the order, and with Y in it, the cheapest mix of shops buys this line there. ${too}`, back], [back]]);
});

test("on random catalogs of up to eight quoting shops, the page prices every pick as sprue pick does, made lines moved where it moves them", () => {
  // Seeded catalogs: up to six shops quoting up to two CNC parts, some of them print services; up to two prints; a
  // board now and then; one to four bought lines from three of nine shops (those quoting and the print services among
  // them); shops riding with JLCPCB, a print service or a quoting shop, and a quoting shop riding with a print service or
  // JLCPCB now and then; a shipping figure of 0 or none now and then; prices on a coarse grid now and then, so that
  // orders cost the same. For every offer of a bought line the quote does not pick, and three picks of two lines: the
  // page's requote (explorer.js and explore.ts's, which `sprue bom` prints, the same) against quote() with those lines
  // pinned, as `sprue pick` quotes. Each catalog's order of the made lines the quote keeps (quoteWay) has the
  // explorer's shipping and riders.
  const SPEC = { material: "aluminium 6061-T6", features: "two M4 tapped holes" }, PRINTERS = ["JLC3DP", "Craftcloud"];
  const rates0 = loadRates();
  let picks = 0, moved = 0, dearer = 0;
  for (let n = 0; n < 400; n++) {
    let seed = Math.imul(25, 1000003) ^ Math.imul(n + 1, 2654435761);
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const cents = (x: number) => Math.round(x * 100) / 100, ties = rnd() < 0.4;
    let shops = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, k) => `S${k}`);
    if (rnd() < 0.4) shops[0] = pick(["JLCCNC", ...PRINTERS]);
    shops = [...new Set(shops)];
    const offers: Record<string, Offer[]> = {};
    for (let i = 0, k = Math.floor(rnd() * 3); i < k; i++) {
      const by = shops.filter(() => rnd() < 0.6);
      offers[`L${i}`] = (by.length ? by : [pick(shops)]).map((s) => ({ supplier: s, sku: `${s}-L${i}`, url: "https://example.com/q",
        priceBreaks: [{ qty: 1, shopTotal: ties ? pick([10, 12, 15]) : cents(5 + rnd() * 20), unitUsd: 1 }], stock: "unknown", leadDays: 9,
        source: "snapshot", capturedAt: "2026-11-25", shopQuote: { part: `fab/L${i}.stl`, sha256: "a5707be7fcb55fdd63eac5350d24f23281fdeaa395ea42ee9587ca5b1876b078",
          spec: SPEC, currency: "USD", vat: "excluded", expires: "not stated" } }) as Offer);
    }
    const parts = Object.keys(offers).map((id) => ({ id, name: id, role: id, process: "cnc", qtyPerUnit: 1, spec: SPEC, file: `fab/${id}.step` }) as BomLine);
    const prints = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `P${i}`, name: `P${i}`, role: `P${i}`, process: "print", qtyPerUnit: 1,
      spec: { material: rnd() < 0.6 ? "PA12" : "PETG", volumeCm3: ties ? pick([5, 10, 20]) : Math.round(2 + rnd() * 45) }, file: `fab/P${i}.stl` }) as BomLine);
    const board = rnd() < 0.5 ? [{ id: "pcb", name: "PCB", role: "pcb", process: "pcb", qtyPerUnit: 1,
      spec: { layers: 2, widthMm: Math.round(20 + rnd() * 70), heightMm: Math.round(15 + rnd() * 60) } } as BomLine] : [];
    const quoting = [...new Set(Object.values(offers).flat().map((o) => o.supplier))];
    const pool = ["A", "B", "Z", "R1", "R2", "JLCMC", ...PRINTERS, ...quoting], buys: [string, string, number][] = [];
    for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++)
      for (const s of new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(pool)))) buys.push([s, `b${i}`, ties ? pick([0.5, 1, 2]) : cents(rnd() * 5)]);
    const shipsWith: Record<string, string> = {}, fabs = ["JLCPCB", ...PRINTERS, ...quoting];
    for (const r of ["R1", "R2", "JLCMC"]) if (rnd() < 0.75) shipsWith[r] = r === "JLCMC" && rnd() < 0.6 ? "JLCPCB" : pick(fabs);
    for (const q of quoting) if (!PRINTERS.includes(q) && rnd() < 0.25) shipsWith[q] = pick([...PRINTERS, "JLCPCB"]);
    if (rnd() < 0.2) shipsWith.JLC3DP = "JLCPCB";
    for (const [s, f] of Object.entries(shipsWith)) if (shipsWith[f] === s || s === f) delete shipsWith[s];
    const shipping: Record<string, number> = {};
    for (const s of new Set([...quoting, ...PRINTERS, "JLCPCB", ...buys.map(([s]) => s)])) {
      const x = rnd();
      if (x >= 0.1) shipping[s] = x < 0.2 ? 0 : ties ? pick([3, 5, 9]) : cents(rnd() * 15);
    }
    const ids = [...new Set(buys.map(([, id]) => id))];
    for (const id of ids) offers[id] = buys.filter(([, i]) => i === id).map(([s, , usd]) => ({ supplier: s, sku: `${s}-${id}`, mpn: `M-${id}`, url: "https://example.com/s",
      priceBreaks: [{ qty: 1, unitUsd: usd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-25" }) as Offer);
    const slug = `random-${n}`, rates = { ...rates0, shopQuotes: offers };
    const bom: Bom = { slug, units: 1, lines: [...parts, ...prints, ...board,
      ...ids.map((id) => ({ id, name: id, role: id, process: "buy", qtyPerUnit: 1, spec: {}, mpn: `M-${id}` }) as unknown as BomLine)] };
    const priced = (b: Bom) => quote(b, source(b, offers), rates, shipping, undefined, { shipsWith });
    mkdirSync(join(root, "products", slug), { recursive: true });
    writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
    writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
    const ex = inRoot(() => build(slug, rates, { shipping, shipsWith, offers }, { quiet: true }));
    if (ex.ways) {
      // The quote's own order of the made lines, as build() has the explorer: the same shipping, the same shops riding
      // (but for a shop at $0 that makes a line here and sells one too, which the quote says rides only where the order
      // buys that line from it), and the same fab it needs a line riding with.
      const w = ex.ways[ex.quoteWay!], labels = (x?: Record<string, string>) => Object.entries(x ?? {}).filter(([s]) => ex.shipping[s] !== 0).sort();
      assert.deepEqual([w.shipping, labels(w.shipsWith), w.needsRider, w.riders], [ex.shipping, labels(ex.shipsWith), ex.needsRider, ex.riders], `catalog ${n}`);
    }
    const all = ex.lines.map((_, i) => i).filter((i) => !ex.lines[i].made && ex.lines[i].options.length);
    const tries = all.flatMap((i) => ex.lines[i].options.flatMap((_, j) => (j === ex.lines[i].chosen ? [] : [new Map([[i, j]])])));
    for (let d = 0; d < 3 && all.length > 1; d++) {
      const [a, b] = [pick(all), pick(all)];
      if (a !== b) tries.push(new Map([[a, Math.floor(rnd() * ex.lines[a].options.length)], [b, Math.floor(rnd() * ex.lines[b].options.length)]]));
    }
    for (const pins of tries) {
      const page = requote(ex, pins), q = priced({ ...bom, lines: bom.lines.map((l) => {
        const i = ex.lines.findIndex((x) => x.id === l.id), j = pins.get(i);
        return j === undefined ? l : { ...l, pin: { supplier: ex.lines[i].options[j].supplier, sku: ex.lines[i].options[j].sku } };
      }) });
      const w = withWay(ex, page.way ?? -1), shopsOf = ex.lines.map((l, i) => w.lines[i].made?.supplier ?? l.options[page.choice[i]]?.supplier ?? "-");
      const said = `catalog ${n}, pins ${JSON.stringify([...pins])}`;
      assert.deepEqual(requoteTs(ex, pins), page, said);
      assert.deepEqual([page.total, shopsOf], [q.batchUsd, ex.lines.map((l) => q.lines.find((x) => x.lineId === l.id)?.supplier ?? "-")], said);
      picks++;
      if (ex.lines.some((l, i) => l.made && w.lines[i].made?.sku !== l.made.sku)) moved++;
      if (requote(withWay(ex, -1), pins).total > page.total + 0.001) dearer++;
    }
  }
  // Picks that move a made line, and those that cost more with the made lines kept where the quote put them, as the
  // page priced them before 2026-11-25.
  assert.deepEqual([picks, moved, dearer], [1452, 114, 182]);
});

test("on a pick that moves a made line, the page shows the order sprue pick would quote: the total, the made line's shop, what changed, the shops, and a reset", () => {
  // A PETG lid at Craftcloud, a board $1.50 dearer at JLCPCB than at OSH Park, and JLCMC riding with JLCPCB: the quote
  // makes the board at JLCPCB for JLCMC's nut to ride ($42). A pick of Z's nut makes it at OSH Park again ($49).
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-25" }) as Offer;
  const slug = "moves", rates = loadRates();
  const lines = [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { volumeCm3: 20, material: "PETG" }, file: "fab/lid.stl" },
    { id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 50, heightMm: 40, layers: 2 } },
    ...["cap", "washer", "nut"].map((id) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }))] as BomLine[];
  const catalog = { shipping: { Craftcloud: 10, Adafruit: 5, JLCMC: 8, Z: 9 }, shipsWith: { JLCMC: "JLCPCB" },
    offers: { cap: [sells("Adafruit", "cap", 2)], washer: [sells("Adafruit", "washer", 1), sells("JLCMC", "washer", 1.5)], nut: [sells("JLCMC", "nut", 1), sells("Z", "nut", 0.5)] } };
  const bom: Bom = { slug, units: 1, lines };
  mkdirSync(join(root, "products", slug), { recursive: true });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith })));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const nut = 4, z = ex.lines[nut].options.findIndex((o) => o.supplier === "Z");
  assert.deepEqual([ex.ways?.length, ex.lines[1].made?.supplier, ex.totals.batchUsd], [2, "JLCPCB", 42]);
  onPage(ex, ({ el, pick, click }) => {
    // Each element's text matching `sel`, or with `inner`, of those in it matching `inner`.
    const text = (sel: string, inner?: string) => (inner ? el.querySelector(sel)?.querySelectorAll(inner) ?? [] : el.querySelectorAll(sel)).map((e) => e.textContent);
    const seen = () => ({ total: text(".ax-sum-total")[0], delta: text(".ax-delta-head")[0], groups: text(".ax-group-sub"),
      board: text('tr.ax-row[data-line-id="board"]', ".ax-c-shop")[0], made: text('tr.ax-detail[data-line-id="board"]', ".ax-made")[0]?.match(/^Made by(.*?)Order/)?.[1],
      shops: text(".ax-shop-name") });
    const first = seen();
    assert.deepEqual(first, { total: "$42.00", delta: undefined, groups: ["3 lines, $4.00", "2 lines, $23.00"], board: "JLCPCBPCB fab", made: "JLCPCB",
      shops: ["JLCPCB", "Craftcloud", "Adafruit", "JLCMC"] });
    pick(nut, z);
    click('.ax-toggle[data-line="4"]');
    assert.deepEqual({ ...seen(), ifPicked: text('tr.ax-detail[data-line-id="nut"]', ".ax-o-pick") }, { total: "$49.00", delta: "+$7.00 vs the quoteQuote $42.00, 2 lines changed",
      groups: ["3 lines, $3.50", "2 lines, $21.50"], board: "OSH ParkPCB fab", made: "OSH Park", shops: ["Craftcloud", "OSH Park", "Z", "Adafruit"],
      ifPicked: ["If picked", "Current", "−$7.00moves Board too"] });
    click("[data-reset]");
    assert.deepEqual(seen(), first);
  });
});

test("a way that makes the board at a fab is weighed without that fab's shipping, which is in the board's price, so a pick can still move the board there", () => {
  // Two PA12 prints at JLC3DP, which rides with JLCPCB. Picking R1's screw, which rides with JLC3DP, makes the board at
  // JLCPCB cheaper than at OSH Park: JLC3DP's $8.19 comes off. Counting JLCPCB's $5.86 as the way's left it out ($53.21).
  const sells = (supplier: string, unitUsd: number) => ({ supplier, sku: `${supplier}-b0`, mpn: "b0-1", url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-25" }) as Offer;
  const slug = "boardfab", rates = loadRates();
  const lines = [...[46, 33].map((volumeCm3, k) => ({ id: `P${k}`, name: `P${k}`, role: `P${k}`, process: "print", qtyPerUnit: 1, spec: { material: "PA12", volumeCm3 }, file: `fab/P${k}.stl` })),
    { id: "pcb", name: "PCB", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { layers: 2, widthMm: 70, heightMm: 18, thicknessMm: 1.6, finish: "HASL" } },
    { id: "b0", name: "b0", role: "b0", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "b0-1" }] as BomLine[];
  const catalog = { shipping: { JLC3DP: 8.19, Craftcloud: 5.27, JLCPCB: 5.86, R1: 11.43, Z: 0.45 }, shipsWith: { R1: "JLC3DP", JLC3DP: "JLCPCB" },
    offers: { b0: [sells("R1", 4.52), sells("Z", 2.79), sells("Craftcloud", 3.34)] } };
  const bom: Bom = { slug, units: 1, lines };
  const priced = (b: Bom) => quote(b, source(b, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  mkdirSync(join(root, "products", slug), { recursive: true });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const r1 = ex.lines[3].options.findIndex((o) => o.supplier === "R1"), pins = new Map([[3, r1]]);
  const q = priced({ ...bom, lines: lines.map((l) => (l.id === "b0" ? { ...l, pin: { supplier: "R1", sku: "R1-b0" } } : l)) });
  const shops = (r: { way?: number }) => withWay(ex, r.way ?? -1).lines.slice(0, 3).map((l) => l.made?.supplier);
  assert.deepEqual([q.batchUsd, q.lines.find((l) => l.lineId === "pcb")?.supplier], [52.25, "JLCPCB"]);
  for (const r of [requote(ex, pins), requoteTs(ex, pins)]) assert.deepEqual([r.total, shops(r)], [52.25, ["JLC3DP", "JLC3DP", "JLCPCB"]]);
});

test("on a pick that moves a print to a print service, the shop cards count that service's shipping and none for a shop that now rides there", () => {
  // The case prints at JLC3DP ($19.45, no shipping). S's $1 screw rides with Craftcloud, so picking it moves the case
  // there ($15 and rates.json's $10.25 shipping), and S's own $30 shipping comes off: $26.25.
  const sells = (supplier: string, unitUsd: number) => ({ supplier, sku: `${supplier}-b0`, mpn: "b0-1", url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-25" }) as Offer;
  const slug = "toprint", rates = loadRates();
  const lines = [{ id: "case", name: "Case", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PA12", volumeCm3: 50 }, file: "fab/case.stl" },
    { id: "b0", name: "b0", role: "b0", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "b0-1" }] as BomLine[];
  const catalog = { shipping: { S: 30, Z: 0.5 }, shipsWith: { S: "Craftcloud" }, offers: { b0: [sells("S", 1), sells("Z", 5)] } };
  const bom: Bom = { slug, units: 1, lines };
  mkdirSync(join(root, "products", slug), { recursive: true });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith })));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  assert.deepEqual([ex.totals.batchUsd, ex.lines[0].made?.supplier, ex.shipping.Craftcloud], [24.95, "JLC3DP", undefined]);
  onPage(ex, ({ el, pick }) => {
    const cards = () => el.querySelectorAll(".ax-shop").map((c) => [c.querySelector(".ax-shop-name")?.textContent, c.querySelector(".ax-shop-total")?.textContent]);
    pick(1, ex.lines[1].options.findIndex((o) => o.supplier === "S"));
    assert.deepEqual([el.querySelector(".ax-sum-total")?.textContent, cards()], ["$26.25", [["Craftcloud", "Shop total$25.25"], ["S", "Shop total$1.00"]]]);
  });
});

test("on a pick that moves a made line, the change rows and the words add up to the change: a shop in both orders that now rides in a fab's parcel saves its shipping", () => {
  // The board is at OSH Park and JLCMC's washer pays $8 shipping ($22.81). R1's cap rides with JLCPCB too, so picking it
  // makes the board there ($11.19 dearer), and both ride: +$3.69, of which JLCMC's shipping is -$8.
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-25" }) as Offer;
  const slug = "rides", rates = loadRates();
  const lines = [{ id: "board", name: "Board", role: "pcb", process: "pcb", qtyPerUnit: 1, spec: { widthMm: 30, heightMm: 25, layers: 2 } },
    ...["washer", "cap", "nut"].map((id) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }))] as BomLine[];
  const catalog = { shipping: { Adafruit: 5, JLCMC: 8, R1: 5 }, shipsWith: { JLCMC: "JLCPCB", R1: "JLCPCB" },
    offers: { washer: [sells("JLCMC", "washer", 1)], cap: [sells("Adafruit", "cap", 2), sells("R1", "cap", 2.5)], nut: [sells("Adafruit", "nut", 1)] } };
  const bom: Bom = { slug, units: 1, lines };
  mkdirSync(join(root, "products", slug), { recursive: true });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith })));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  assert.deepEqual([ex.totals.batchUsd, ex.lines[0].made?.supplier], [22.81, "OSH Park"]);
  onPage(ex, ({ el, pick }) => {
    pick(2, ex.lines[2].options.findIndex((o) => o.supplier === "R1"));
    const rows = (el.querySelector(".ax-delta-rows")?.querySelectorAll("div") ?? []).map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    assert.deepEqual([el.querySelector(".ax-sum-total")?.textContent, rows, el.querySelector("[aria-live]")?.textContent], ["$26.50",
      [["JLCMC rides with JLCPCB", "−$8.00"], ["Parts", "+$11.69"]],
      "Batch total $26.50, +$3.69 vs the quote: JLCMC rides with JLCPCB, saving $8.00 shipping, parts cost $11.69 more."]);
  });
});
