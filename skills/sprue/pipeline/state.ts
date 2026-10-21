// The four gates a run passes through, kept in products/<slug>/state.json:
//   1 design:  the figure, the BOM and the checks of each part on its own  (sprue figure proposes it)
//   2 inspect: the whole product, the parts together                       (sprue inspect proposes it)
//   3 source:  the offers and the quote                                    (sprue quote proposes it)
//   4 build:   the build plan, order list and fab files                    (sprue plan proposes it)
// Claude proposes a stage, the person accepts it, has it edited or declines it, and only an accepted
// stage moves the run on. A command for a later stage still runs (the daily loop and `sprue all`
// need that) and prints one line naming the earlier stage that is still open, but it never proposes its
// stage until every stage before it is accepted. state.json is not part of the cost history: `sprue
// diff` never shows it.

import { exists, readJson, writeJson } from "./io.ts";

export const STAGES = ["design", "inspect", "source", "build"] as const;
export type Stage = (typeof STAGES)[number];
export type GateStatus = "drafting" | "proposed" | "accepted" | "declined";
export type Gate = { status: GateStatus; at: string; note?: string };
export type State = { stage: Stage | "done"; stages: Partial<Record<Stage, Gate>> };

export const WHAT: Record<Stage, string> = {
  design: "the figure, the BOM and the checks",
  inspect: "the whole product: the parts together, their fits, gaps, stability and function",
  source: "the offers and the quote",
  build: "the build plan, order list and fab files",
};

export const isStage = (s: string | undefined): s is Stage => STAGES.includes(s as Stage);

/** A usage mistake: say what is wrong in one line, no stack trace. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function readState(slug: string): State {
  if (!exists(slug, "state.json")) return { stage: "design", stages: {} };
  const s = readJson<Partial<State>>(slug, "state.json");
  const state: State = { stage: "design", stages: s.stages ?? {} };
  // A state.json from before the Inspect stage, its design accepted: the run is at Inspect, drafted here in memory. No
  // gate the person accepted is rewritten here (sprue inspect reopens one a fix at Inspect changed), and Inspect is never
  // accepted for them, nor by a bare accept before gate 2 is shown; the file changes when a command saves.
  const d = state.stages.design;
  if (d?.status === "accepted" && !state.stages.inspect)
    state.stages.inspect = { status: "drafting", at: d.at, note: "added: Sprue now inspects the whole product before sourcing" };
  state.stage = current(state);
  return state;
}

/** The current stage is the first one not accepted yet. */
const current = (s: State): Stage | "done" => STAGES.find((x) => s.stages[x]?.status !== "accepted") ?? "done";

/** The first stage before `stage` that isn't accepted, if any. */
const openBefore = (s: State, stage: Stage) => STAGES.slice(0, STAGES.indexOf(stage)).find((x) => s.stages[x]?.status !== "accepted");

function save(slug: string, s: State) {
  s.stage = current(s);
  // In the order of the stages, so an Inspect added to an old file reads after its design.
  const stages = Object.fromEntries(STAGES.filter((x) => s.stages[x]).map((x) => [x, s.stages[x]]));
  writeJson(slug, "state.json", { stage: s.stage, stages });
  return s;
}

function set(s: State, stage: Stage, status: GateStatus, note?: string) {
  s.stages[stage] = { status, at: new Date().toISOString(), ...(note ? { note } : {}) };
}

/** Every stage after `stage` (of `only`, if given) that has a status goes back to drafting: what it showed was built
 * on the old one. */
function reopenAfter(s: State, stage: Stage, why: string, only?: Stage[]) {
  for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) {
    const g = s.stages[later];
    if (!g || g.status === "drafting" || (only && !only.includes(later))) continue;
    set(s, later, "drafting", `reopened: ${why}`);
    console.log(`${later}: ${g.status} -> drafting, because ${why}; rerun its commands once ${stage} is accepted`);
  }
}

/** `sprue new`: the design is being drafted. */
export function startState(slug: string) {
  const s: State = { stage: "design", stages: {} };
  set(s, "design", "drafting");
  save(slug, s);
}

/** Called by the command that finishes a stage (figure, inspect, quote, plan): marks it proposed when it has no
 * status yet or is still drafting, and only once every stage before it is accepted, so a quote made while
 * the design is open never reaches a gate. An accepted or proposed stage is left alone, and a declined one too
 * unless `declined` (sprue inspect, whose passing is what a decline at Inspect asks for: the stages after it are
 * drafting already); after an edit the skill runs `sprue propose` itself. */
export function autoPropose(slug: string, stage: Stage, { declined = false } = {}): boolean {
  const s = readState(slug);
  if (openBefore(s, stage)) return false;
  const g = s.stages[stage];
  if (g && g.status !== "drafting" && !(declined && g.status === "declined")) return false;
  set(s, stage, "proposed");
  save(slug, s);
  console.log(`${stage} proposed: waiting for accept, edit or decline (sprue state ${slug})`);
  return true;
}

/** `sprue inspect` passing at Inspect, in a run from before it (readState) whose `stages` after Inspect had a status: a
 * fix made at Inspect changed what their gates showed (the quote, the plan, the files), so they go back to drafting,
 * as when Inspect is proposed again, and nothing accepted is of the parts as they were. */
export function reopenAtInspect(slug: string, stages: Stage[], why: string) {
  const s = readState(slug);
  reopenAfter(s, "inspect", why, stages);
  save(slug, s);
}

/** A bare accept or decline refuses at an Inspect never proposed, so gate 2 was never shown: on a file from before
 * Inspect the run is there, and the person's words were for the gate they last saw. Naming the stage still does it. */
function unshown(slug: string, s: State) {
  if (s.stage === "inspect" && unseen(s))
    fail(`inspect has not been proposed: run sprue inspect ${slug} and ask gate ${STAGES.indexOf("inspect") + 1} first (or name the stage)`);
}

/** Inspect never proposed: on a file from before Inspect readState adds it as drafting, and gate 2 was never shown. */
function unseen(s: State) {
  const g = s.stages.inspect;
  return !g || g.status === "drafting";
}

/** What `sprue inspect` says to do before a later stage, at an Inspect never shown: never "accept inspect", which would
 * take a gate the person has not seen. */
const inspectFirst = (slug: string) => `run sprue inspect ${slug} and ask gate ${STAGES.indexOf("inspect") + 1} first`;

/** The command that puts a stage at its gate again, after an edit: at Inspect `sprue inspect`, which checks the parts
 * first (and proposes a drafting or declined Inspect once they pass); elsewhere `sprue propose`. */
const proposeHint = (slug: string, stage: Stage) => (stage === "inspect" ? `sprue inspect ${slug}` : `sprue propose ${slug} ${stage}`);

/** One line when an earlier stage than `stage` isn't accepted yet. The command runs anyway. */
export function gateNote(slug: string, stage: Stage) {
  const open = openBefore(readState(slug), stage);
  if (open) console.log(`note: ${open} not accepted yet; this runs, but nothing after ${open} is proposed for review (sprue state ${slug})`);
}

/** The stage `sprue accept <slug> [stage] [--force]` would accept, or the refusal of the order of the stages: an Inspect
 * never shown, every stage done, no such stage, an earlier one open. `sprue accept` says these before its gate's
 * problems, so a fix it asks for is never followed by a refusal of the same command. */
export function acceptable(slug: string, args: string[]): Stage {
  const force = args.includes("--force");
  const which = args.find((a) => a !== "--force");
  const s = readState(slug);
  if (!which) unshown(slug, s);
  const stage = which ?? s.stage;
  if (stage === "done") fail(`every stage of ${slug} is accepted already; reopen one with \`sprue propose ${slug} <stage>\``);
  if (!isStage(stage)) fail(`no stage "${stage}"; stages: ${STAGES.join(", ")}`);
  const before = openBefore(s, stage);
  if (before && !force) fail(before === "inspect" && unseen(s) ? `inspect is not accepted yet, so ${stage} can't be: ${inspectFirst(slug)}`
    : `${before} is not accepted yet, so ${stage} can't be: accept ${before} first (or add --force)`);
  return stage;
}

/** `sprue accept <slug> [stage] [--force]`. Only the current stage, unless --force. */
export function accept(slug: string, args: string[]) {
  const stage = acceptable(slug, args);
  const s = readState(slug);
  const before = openBefore(s, stage);
  if (before) console.log(`note: ${before} not accepted yet (--force)`);
  if (!s.stages[stage] || s.stages[stage]!.status === "drafting") console.log(`note: ${stage} was never proposed`);
  set(s, stage, "accepted");
  const next = STAGES[STAGES.indexOf(stage) + 1];
  if (next && !s.stages[next]) set(s, next, "drafting");
  save(slug, s);
  console.log(`${stage} accepted`);
  if (s.stage === "done") {
    console.log(`every stage accepted${exists(slug, "production") ? "; the package is in production/" : `; \`sprue package ${slug}\` writes production/`}. Nothing has been ordered.`);
    return;
  }
  const g = s.stages[s.stage];
  console.log(`now at stage ${STAGES.indexOf(s.stage) + 1} of ${STAGES.length}, ${s.stage}: ${WHAT[s.stage]}` +
    (g?.status === "proposed" ? " (already proposed: review it)" : g?.status === "declined" ? ` (declined before${g.note ? `: ${g.note}` : ""})` : ""));
}

/** `sprue decline <slug> [stage] [why...]`: the current stage, or the stage named first. */
export function decline(slug: string, words: string[]) {
  const s = readState(slug);
  const named = isStage(words[0]) ? words[0] : undefined;
  const note = (named ? words.slice(1) : words).join(" ").trim();
  if (!named) unshown(slug, s);
  const stage = named ?? s.stage;
  if (stage === "done") fail(`every stage of ${slug} is accepted; name the stage to decline (\`sprue decline ${slug} design '<why>'\`) or reopen one with \`sprue propose ${slug} <stage>\``);
  if (s.stage !== "done" && STAGES.indexOf(stage) > STAGES.indexOf(s.stage))
    fail(s.stage === "inspect" && unseen(s) ? `${stage} hasn't been reached yet; the run is at inspect, which has not been proposed: ${inspectFirst(slug)}`
      : `${stage} hasn't been reached yet; the current stage is ${s.stage} (\`sprue decline ${slug} ${s.stage} '<why>'\`)`);
  set(s, stage, "declined", note || undefined);
  reopenAfter(s, stage, `${stage} declined`);
  save(slug, s);
  console.log(`${stage} declined${note ? `: ${note}` : ""}`);
  console.log(`change it (then \`${proposeHint(slug, stage)}\`) or stop here`);
}

export function propose(slug: string, stage: string | undefined) {
  if (!isStage(stage)) fail(`usage: sprue propose <slug> <${STAGES.join("|")}>`);
  const s = readState(slug);
  const open = openBefore(s, stage);
  if (open) fail(`${open} is not accepted yet, so ${stage} can't be proposed: propose ${open} instead (\`${proposeHint(slug, open)}\`)`);
  set(s, stage, "proposed");
  // A changed design invalidates the inspection, the quote and the plan built on it: they are drafted again.
  reopenAfter(s, stage, `${stage} changed`);
  save(slug, s);
  console.log(`${stage} proposed: waiting for accept, edit or decline`);
}

const MARK: Record<GateStatus, string> = { drafting: "…", proposed: "●", accepted: "✓", declined: "✗" };
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** What a stage's gate reads as now. A stage after the current one is "not started", whatever state.json says. */
export function gateOf(s: State, stage: Stage): Gate | undefined {
  if (s.stage !== "done" && STAGES.indexOf(stage) > STAGES.indexOf(s.stage)) return undefined;
  return s.stages[stage];
}

/** The stage names in one column, with a space after the longest. */
const NAME_WIDTH = Math.max(...STAGES.map((x) => x.length)) + 1;

export function gateLine(s: State, stage: Stage) {
  const g = gateOf(s, stage);
  const status = g ? `${g.status.padEnd(9)} ${when(g.at)}${g.note ? `  ${g.note}` : ""}` : "not started";
  return `${g ? MARK[g.status] : "○"} ${STAGES.indexOf(stage) + 1} ${stage.padEnd(NAME_WIDTH)}${s.stage === stage ? "←" : " "} ${status}`;
}

/** The one thing to do next at the gates, or undefined while the current stage is still being drafted. */
export function waiting(slug: string, s: State) {
  if (s.stage === "done") return "done: every stage accepted. Nothing has been ordered.";
  const g = s.stages[s.stage];
  if (g?.status === "proposed")
    return `waiting for you at gate ${STAGES.indexOf(s.stage) + 1}: sprue accept ${slug} | sprue decline ${slug} '<why>' | edit, then ${proposeHint(slug, s.stage)}`;
  if (g?.status === "declined") return `declined${g.note ? ` (${g.note})` : ""}: change it, then ${proposeHint(slug, s.stage)}`;
  return undefined;
}

export function printState(slug: string, indent = "") {
  const s = readState(slug);
  const where = s.stage === "done" ? "done: every stage accepted" : `stage ${STAGES.indexOf(s.stage) + 1} of ${STAGES.length}, ${s.stage}`;
  console.log(`${indent}gates (state.json): ${where}${exists(slug, "state.json") ? "" : " (no state.json yet)"}`);
  for (const stage of STAGES) console.log(`${indent}  ${gateLine(s, stage)}`);
  const line = waiting(slug, s);
  if (line && s.stage !== "done") console.log(`${indent}${line}`);
}
