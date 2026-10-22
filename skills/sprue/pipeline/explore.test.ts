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
import { build, loadRates, type Explorer, type InspectSummary } from "./explore.ts";
import { writePage } from "./page.ts";
import { systemInputs } from "./stages/score.ts";
import type { State } from "./state.ts";
import type { Bom, Checks, SystemCheck } from "./types.ts";
import { faultsWord, inspectVerdict, mount, probeText, scopeOf, STAGES, TABS } from "../viewer/explorer.js";

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
