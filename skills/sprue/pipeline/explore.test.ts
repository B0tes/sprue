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
import { build, loadRates, printBom, requote as requoteTs, type Explorer, type InspectSummary } from "./explore.ts";
import { reportUrl } from "./gallery.ts";
import { writePage } from "./page.ts";
import { quote } from "./stages/quote.ts";
import { systemInputs } from "./stages/score.ts";
import { source } from "./stages/source.ts";
import type { State } from "./state.ts";
import type { Bom, BomLine, Checks, Offer, SystemCheck } from "./types.ts";
import { faultsWord, inspectVerdict, mount, movedWhy, notCheapestWhy, probeText, requote, scopeOf, shippingReadNote, STAGES, TABS } from "../viewer/explorer.js";

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
  // The order of gates.test.ts's twoRiders: JLC3DP prints the lid for R1's washer, riding in its parcel, which the
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
    "The cheapest offer isn't in the quote because the order holds only with a line riding in JLC3DP's parcel (the quote moves a print or a board there only where one does), and R1's rides in it.",
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
}

test("on a pick, the page says why the requote moved another line: one riding in the parcel of the fab the order needs one in", () => {
  // gates.test.ts's twoRiders again: a pick of Adafruit's washer leaves no line riding in JLC3DP's parcel, so the
  // requote buys R2's nut to ride (the page said the pick brought R2 into the order).
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
  // The quote buys R1's $1.50 washer to ride with JLC3DP. Bolt and Adafruit both sell it at its lowest price, and the
  // cheapest mix whatever rides buys Adafruit's, the second of them, whose shipping the cap pays: so a line riding is
  // why, not shipping. With Adafruit's at $1.004, within half a cent, still; at $1.30, the mix buys a dearer offer, and
  // Bolt's $5 shipping is why.
  const at = (adafruit: number) => ({ ...ex0, units: 1, lines: [lid, buy("cap", 0, offer("Adafruit", 2)), buy("washer", 2, offer("Bolt", 1), offer("Adafruit", adafruit), offer("R1", 1.5))],
    shipping: { JLC3DP: 3, Adafruit: 5, Bolt: 5, R1: 0 }, shipsWith: { R1: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1"] }) as unknown as Explorer;
  const says = (e: Explorer, id = "washer") => {
    const out: string[] = [], log = console.log;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    try { printBom(e, id); } finally { console.log = log; }
    return [notCheapestWhy(e, e.lines.findIndex((l) => l.id === id), requote(e, new Map(), false).choice), out.map((x) => x.trim()).find((x) => x.startsWith("The cheapest offer"))];
  };
  const holds = "because the order holds only with a line riding in JLC3DP's parcel (the quote moves a print or a board there only where one does), and R1's rides in it.";
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
  const both = "because the order holds only with a line riding in JLC3DP's parcel (the quote moves a print or a board there only where one does): with a line from R1 and R2 riding there, the cheapest mix of shops buys this one at A.";
  assert.deepEqual(says(two, "l2"), [`The cheapest offer isn't in the quote ${both}`, `The cheapest offer isn't chosen ${both}`]);
  // riders lists every shop that ships in JLC3DP's parcel and sells a line, as quote() and build() write it: R2 too, though
  // the quote buys nothing there (w at B, as b is, n at R1 to ride, $19.13). The words name R1 only. With m at R1 as
  // well ($20.03), they name it once.
  const oneOfTwo = (m: boolean) => ({ ...at(1), lines: [lid, buy("w", 1, offer("A", 1), offer("B", 1.4)), buy("n", 1, offer("A", 1), offer("R1", m ? 1.45 : 2), offer("R2", 5)),
    ...(m ? [buy("m", 1, offer("A", 1), offer("R1", 1.45))] : []), buy("b", 0, offer("B", 1), offer("R2", 10))],
    shipping: { JLC3DP: 3, A: m ? 1 : 0.5, B: 2, R1: 0, R2: 0 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, riders: ["R1", "R2"] }) as unknown as Explorer;
  const fromR1 = "because the order holds only with a line riding in JLC3DP's parcel (the quote moves a print or a board there only where one does): with a line from R1 riding there, the cheapest mix of shops buys this one at B.";
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
  const fromR = "because the order holds only with a line riding in JLC3DP's parcel (the quote moves a print or a board there only where one does): with a line from R riding there, the cheapest mix of shops buys this one at P.";
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

test("the page counts as riding in a fab's parcel only a shop riding there, not one a made line pays, and of riding mixes that cost the same keeps the first, as the quote does", () => {
  // S quotes L0 and sells b1: L0 pays S's shipping, so b1 adds none, but S does not ride with JLC3DP. The lid at JLC3DP
  // needs a line riding there, R's $7 b2 (fab.test.ts's paidS, b3 beside it). Built as `sprue view` builds the page.
  const slug = "rides", spec = { material: "aluminium 6061-T6", features: "two M4 tapped holes" };
  mkdirSync(join(root, "products", slug), { recursive: true });
  const lines = [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PA12", volumeCm3: 25 }, file: "fab/lid.stl" },
    { id: "L0", name: "L0", role: "bracket", process: "cnc", qtyPerUnit: 1, spec, file: "fab/L0.step" },
    ...["b1", "b2", "b3"].map((id) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: `${id}-1` }))] as BomLine[];
  const bom: Bom = { slug, units: 1, lines };
  const sells = (supplier: string, id: string, unitUsd: number) => ({ supplier, sku: `${supplier}-${id}`, mpn: `${id}-1`, url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-21" }) as Offer;
  const catalog = { shipping: { S: 10, R: 20, Z: 5, A: 3, B: 3, JLC3DP: 3, Craftcloud: 13 }, shipsWith: { R: "JLC3DP" },
    offers: { b1: [sells("S", "b1", 1)], b2: [sells("R", "b2", 7), sells("Z", "b2", 1)], b3: [sells("A", "b3", 1), sells("B", "b3", 1.2)] } };
  const rates = { ...loadRates(), shopQuotes: { L0: [{ supplier: "S", sku: "S-L0", url: "https://example.com/q", priceBreaks: [{ qty: 1, shopTotal: 10, unitUsd: 10 }],
    stock: "unknown", leadDays: 9, source: "snapshot", capturedAt: "2026-11-21", shopQuote: { part: "fab/L0.stl",
      sha256: "a5707be7fcb55fdd63eac5350d24f23281fdeaa395ea42ee9587ca5b1876b078", spec, currency: "USD", vat: "excluded", expires: "not stated" } } as Offer] } };
  const priced = (b: Bom) => quote(b, source(b, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith });
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(priced(bom)));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const shops = (x: Explorer, r: ReturnType<typeof requote>) => [r.choice.map((j, i) => x.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  assert.deepEqual([ex.needsRider, ex.riders, ex.totals.batchUsd, shops(ex, requote(ex, new Map()))], ["JLC3DP", ["R"], 44.73, ["- - S R A", 44.73]]);
  // With B's b3 picked, R's b2 still rides, on the page as with `sprue pick` (S's b1 counted as riding, the page kept
  // Z's b2, $43.93).
  const pins = new Map([[4, 1]]), b3AtB = priced({ ...bom, lines: lines.map((l) => (l.id === "b3" ? { ...l, pin: { supplier: "B" } } : l)) });
  assert.deepEqual([shops(ex, requote(ex, pins)), shops(ex, requoteTs(ex, pins)), b3AtB.batchUsd], [["- - S R B", 44.93], ["- - S R B", 44.93], 44.93]);
  // R1's $0.10 l1 with Y's $0.20 l2 and A's $0 l1 with R2's $0.30 l2 cost the same, though 0.1 + 0.2 is
  // 0.30000000000000004 and not 0.3: the page keeps the first, by line, as the quote does.
  const offer = (supplier: string, usd: number) => ({ supplier, sku: `${supplier}-${usd}`, url: "https://example.com/s", unitUsd: usd, orderQty: 1,
    orderUsd: usd, stock: "in stock", leadDays: 5, source: "snapshot", capturedAt: "2026-11-21" });
  const buy = (id: string, chosen: number, ...options: ReturnType<typeof offer>[]) => ({ id, name: id, role: "part", process: "buy", qtyPerUnit: 1, needQty: 1,
    spec: {}, mpn: `${id}-1`, chosen, options });
  const tie = { ...ex, lines: [ex.lines[0], buy("l1", 1, offer("A", 0), offer("R1", 0.1)), buy("l2", 0, offer("Y", 0.2), offer("R2", 0.3))],
    shipping: { JLC3DP: 3, A: 0, Y: 0, R1: 0, R2: 0 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" }, needsRider: "JLC3DP", riders: ["R1", "R2"] } as unknown as Explorer;
  assert.deepEqual([shops(tie, requote(tie, new Map())), shops(tie, requoteTs(tie, new Map()))], [["- R1 Y", 13.03], ["- R1 Y", 13.03]]);
});

test("of one line's offers from shops riding in a fab's parcel, the page buys the cheapest, whatever order catalog.json lists them in, as the quote does", () => {
  // A's $1 washer rides nowhere; R1's $2 and R2's $1.50 ride with JLC3DP, R1's listed first. The lid at JLC3DP needs a
  // line riding there: R2's washer, $14.23 (fab.test.ts's later). Built as `sprue view` builds the page.
  const slug = "later";
  mkdirSync(join(root, "products", slug), { recursive: true });
  const lines = [{ id: "lid", name: "Lid", role: "case", process: "print", qtyPerUnit: 1, spec: { material: "PA12", volumeCm3: 25 }, file: "fab/lid.stl" },
    { id: "w", name: "Washer", role: "part", process: "buy", qtyPerUnit: 1, spec: {}, mpn: "w-1" }] as BomLine[];
  const bom: Bom = { slug, units: 1, lines };
  const sells = (supplier: string, unitUsd: number) => ({ supplier, sku: `${supplier}-w`, mpn: "w-1", url: "https://example.com/s",
    priceBreaks: [{ qty: 1, unitUsd }], stock: 100, leadDays: 3, source: "snapshot", capturedAt: "2026-11-21" }) as Offer;
  const catalog = { shipping: { A: 0, R1: 8, R2: 8, JLC3DP: 3, Craftcloud: 13 }, shipsWith: { R1: "JLC3DP", R2: "JLC3DP" },
    offers: { w: [sells("A", 1), sells("R1", 2), sells("R2", 1.5)] } };
  const rates = loadRates();
  writeFileSync(join(root, "products", slug, "bom.json"), JSON.stringify(bom));
  writeFileSync(join(root, "products", slug, "quotes.json"), JSON.stringify(quote(bom, source(bom, catalog.offers), rates, catalog.shipping, undefined, { shipsWith: catalog.shipsWith })));
  const ex = inRoot(() => build(slug, rates, catalog, { quiet: true }));
  const shops = (r: ReturnType<typeof requote>) => [r.choice.map((j, i) => ex.lines[i].options[j]?.supplier ?? "-").join(" "), r.total];
  assert.deepEqual([ex.needsRider, ex.riders, ex.lines[1].offerOrder, ex.totals.batchUsd, shops(requote(ex, new Map())), shops(requoteTs(ex, new Map()))],
    ["JLC3DP", ["R2", "R1"], [0, 2, 1], 14.23, ["- R2", 14.23], ["- R2", 14.23]]);
});
