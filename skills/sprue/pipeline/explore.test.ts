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
import { reportUrl } from "./gallery.ts";
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
    const [parts, carts] = block.querySelectorAll("table");
    const cells = (tr: Stub) => tr.children.map((td) => td.textContent);
    assert.deepEqual(parts.querySelectorAll("tr[data-line-id]").map(cells), [
      ["Case <b>top</b> | v2PETG", "3D print", "31 in order A, 2 in order B", "t-case.stlin case/, with its ORDER.md", "$6.00 at Craftcloud, an estimate"],
      ["Bracketaluminium 6061-T6", "CNC machining", "1", "t-brk.stepin brk/, with its ORDER.md", "not pricedIts ORDER.md lists the shops to ask"],
    ]);
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
