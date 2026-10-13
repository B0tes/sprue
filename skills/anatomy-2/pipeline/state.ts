// The three gates a run passes through, kept in products/<slug>/state.json:
//   1 design: the figure, the BOM and the checks       (anatomy figure proposes it)
//   2 source: the offers and the quote                 (anatomy quote proposes it)
//   3 build:  the build plan, order list and fab files (anatomy plan proposes it)
// Claude proposes a stage, the person accepts it, has it edited or declines it, and only an accepted
// stage moves the run on. A command for a later stage still runs (the daily loop and `anatomy all`
// need that) and prints one line naming the earlier stage that is still open. state.json is not part
// of the cost history: `anatomy diff` never shows it.

import { exists, readJson, writeJson } from "./io.ts";

export const STAGES = ["design", "source", "build"] as const;
export type Stage = (typeof STAGES)[number];
export type GateStatus = "drafting" | "proposed" | "accepted" | "declined";
export type Gate = { status: GateStatus; at: string; note?: string };
export type State = { stage: Stage | "done"; stages: Partial<Record<Stage, Gate>> };

const WHAT: Record<Stage, string> = {
  design: "the figure, the BOM and the checks",
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
  state.stage = current(state);
  return state;
}

/** The current stage is the first one not accepted yet. */
const current = (s: State): Stage | "done" => STAGES.find((x) => s.stages[x]?.status !== "accepted") ?? "done";

function save(slug: string, s: State) {
  s.stage = current(s);
  writeJson(slug, "state.json", { stage: s.stage, stages: s.stages });
  return s;
}

function set(s: State, stage: Stage, status: GateStatus, note?: string) {
  s.stages[stage] = { status, at: new Date().toISOString(), ...(note ? { note } : {}) };
}

/** `anatomy new`: the design is being drafted. */
export function startState(slug: string) {
  const s: State = { stage: "design", stages: {} };
  set(s, "design", "drafting");
  save(slug, s);
}

/** Called by the command that finishes a stage (figure, quote, plan): marks it proposed when it has no
 * status yet or is still drafting. An accepted, declined or proposed stage is left alone; after an edit
 * the skill runs `anatomy propose` itself. */
export function autoPropose(slug: string, stage: Stage): boolean {
  const s = readState(slug);
  const g = s.stages[stage];
  if (g && g.status !== "drafting") return false;
  set(s, stage, "proposed");
  save(slug, s);
  console.log(`${stage} proposed: waiting for accept, edit or decline (anatomy state ${slug})`);
  return true;
}

/** One line when an earlier stage than `stage` isn't accepted yet. The command runs anyway. */
export function gateNote(slug: string, stage: Stage) {
  const s = readState(slug);
  const open = STAGES.slice(0, STAGES.indexOf(stage)).find((x) => s.stages[x]?.status !== "accepted");
  if (open) console.log(`note: ${open} not accepted yet (anatomy state ${slug})`);
}

export function accept(slug: string, which?: string) {
  const s = readState(slug);
  const stage = which ?? s.stage;
  if (stage === "done") fail(`every stage of ${slug} is accepted already; reopen one with \`anatomy propose ${slug} <stage>\``);
  if (!isStage(stage)) fail(`no stage "${stage}"; stages: ${STAGES.join(", ")}`);
  const before = STAGES.slice(0, STAGES.indexOf(stage)).find((x) => s.stages[x]?.status !== "accepted");
  if (before) console.log(`note: ${before} not accepted yet`);
  if (!s.stages[stage] || s.stages[stage]!.status === "drafting") console.log(`note: ${stage} was never proposed`);
  set(s, stage, "accepted");
  const next = STAGES[STAGES.indexOf(stage) + 1];
  if (next && !s.stages[next]) set(s, next, "drafting");
  save(slug, s);
  console.log(`${stage} accepted`);
  console.log(s.stage === "done"
    ? `every stage accepted${exists(slug, "production") ? "; the package is in production/" : `; \`anatomy package ${slug}\` writes production/`}. Nothing has been ordered.`
    : `now at stage ${STAGES.indexOf(s.stage) + 1} of 3, ${s.stage}: ${WHAT[s.stage]}`);
}

export function decline(slug: string, note: string) {
  const s = readState(slug);
  if (s.stage === "done") fail(`every stage of ${slug} is accepted; reopen one with \`anatomy propose ${slug} <stage>\` first`);
  set(s, s.stage, "declined", note || undefined);
  save(slug, s);
  console.log(`${s.stage} declined${note ? `: ${note}` : ""}`);
  console.log(`change it (then \`anatomy propose ${slug} ${s.stage}\`) or stop here`);
}

export function propose(slug: string, stage: string | undefined) {
  if (!isStage(stage)) fail(`usage: anatomy propose <slug> <${STAGES.join("|")}>`);
  const s = readState(slug);
  set(s, stage, "proposed");
  // A changed design invalidates the quote and the plan built on it: they need accepting again.
  for (const later of STAGES.slice(STAGES.indexOf(stage) + 1))
    if (s.stages[later]?.status === "accepted") {
      set(s, later, "proposed", `reopened: ${stage} changed`);
      console.log(`${later}: accepted -> proposed again, because ${stage} changed`);
    }
  save(slug, s);
  console.log(`${stage} proposed: waiting for accept, edit or decline`);
}

const MARK: Record<GateStatus, string> = { drafting: "…", proposed: "●", accepted: "✓", declined: "✗" };
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function printState(slug: string, indent = "") {
  const s = readState(slug);
  const where = s.stage === "done" ? "done: every stage accepted" : `stage ${STAGES.indexOf(s.stage) + 1} of 3, ${s.stage}`;
  console.log(`${indent}gates (state.json): ${where}${exists(slug, "state.json") ? "" : " (no state.json yet)"}`);
  STAGES.forEach((stage, i) => {
    const g = s.stages[stage];
    const status = g ? `${g.status.padEnd(9)} ${when(g.at)}${g.note ? `  ${g.note}` : ""}` : "not started";
    console.log(`${indent}  ${g ? MARK[g.status] : "○"} ${i + 1} ${stage.padEnd(7)}${s.stage === stage ? "←" : " "} ${status}`);
  });
  if (s.stage !== "done") {
    const g = s.stages[s.stage];
    if (g?.status === "proposed")
      console.log(`${indent}waiting for you: anatomy accept ${slug} | anatomy decline ${slug} <why> | edit, then anatomy propose ${slug} ${s.stage}`);
    else if (g?.status === "declined") console.log(`${indent}declined: change it, then anatomy propose ${slug} ${s.stage}`);
  }
}
