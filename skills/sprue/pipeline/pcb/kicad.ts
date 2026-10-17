// The KiCad cross-check (kicad.py) as `sprue verify` runs it once the read-back has passed: the rule sets it checks
// the rebuilt board against (ours, and each fab profile's published numbers with the fab's own KiCad rule file where
// one exists), the rule files fetched once into the cache and pinned, and its result as a layer of verify's summary.
// The layer does not hold back the board: it is a second opinion on the files, from another DRC than ours.
// The rule files are not copied into Sprue: Aisler's repository names no licence, and kicad-druid's (MIT) are
// generated upstream from its own capability tables. Each is fetched at one commit and held to its sha256 every time
// it is used; one that cannot be fetched (offline, SPRUE_OFFLINE=1) leaves that fab's run to its published numbers,
// and the layer says so.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheDir } from "../firmware/cache.ts";
import type { Layer } from "../verify.ts";
import { guardNetwork } from "./order.ts";
import { FAB_PROFILES, type Rules } from "./rules.ts";

export const KICAD = join(import.meta.dirname, "kicad.py");

/** The fabs' own KiCad rule files, each at one commit. */
export const RULE_FILES = {
  aisler: {
    name: "Aisler's 2-layer rule file",
    repo: "AislerHQ/aisler-support",
    url: "https://raw.githubusercontent.com/AislerHQ/aisler-support/00fe215f96ce7a938946e1a176de4ca8cac291ef/kicad/aisler-2-layer-simple-drc/aisler-2-layer-simple-drc.kicad_dru",
    sha256: "0b209f19ce1fcd28e7d23634f8d77f059e175b10bbfe24b6cb73f14fc9458bd5",
  },
  jlcpcb: {
    name: "kicad-druid's JLCPCB 2-layer 1 oz rules",
    repo: "Cimos/kicad-druid",
    url: "https://raw.githubusercontent.com/Cimos/kicad-druid/8af046d6a1839320a360a4b6790ac11eb27a78ae/JLCPCB/JLCPCB-2L-1oz.kicad_dru",
    sha256: "292b812a764c76785446b9de5e00c9e76bc58bd4019071f1f99294e81f3874d2",
  },
  pcbway: {
    name: "kicad-druid's PCBWay 2-layer 1 oz rules",
    repo: "Cimos/kicad-druid",
    url: "https://raw.githubusercontent.com/Cimos/kicad-druid/8af046d6a1839320a360a4b6790ac11eb27a78ae/PCBWay/PCBWay-2L-1oz.kicad_dru",
    sha256: "2458a722d55cc4778baab294dc7559477983160686ef1a6f86c344cd450e42ba",
  },
} as const;
type RuleFileId = keyof typeof RULE_FILES;

/** The numbers kicad.py puts into the board's design settings. */
export type KicadRules = {
  clearanceMm: number; trackMinMm: number; edgeMm: number; holeClearMm: number; holeGapMm: number;
  drillMinMm: number; viaRingMm: number; maskExpandMm: number; maskWebMm: number; pourClearanceMm?: number;
};
export type RuleSet = { id: string; title: string; source: string; ruleFile: string | null; rules: KicadRules; dru: string };

/** Our rules, as KiCad's design settings. */
export const ourKicadRules = (r: Rules): KicadRules => ({
  clearanceMm: r.clearanceMm, trackMinMm: Math.min(r.trackMinMm, r.copperMinMm), edgeMm: r.edgeMm, holeClearMm: r.holeClearMm,
  holeGapMm: r.holeGapMm, drillMinMm: r.drillMinMm, viaRingMm: r.viaRingMm, maskExpandMm: r.maskExpandMm, maskWebMm: r.maskWebMm,
  pourClearanceMm: r.pourClearanceMm,
});

/** A fab profile's published limits as KiCad's design settings: a limit it does not publish is 0, not checked, as
 * the audit does not check it either. KiCad holds every hole to one gap, so it is the profile's hole gap. The mask
 * openings are ours (the files open the mask that much), and the pour keeps the fab's clearance. */
export function fabKicadRules(id: string, r: Rules): KicadRules {
  const l = FAB_PROFILES[id].limits;
  return {
    clearanceMm: l.clearanceMm ?? 0, trackMinMm: l.trackMinMm ?? 0, edgeMm: l.edgeMm ?? 0, holeClearMm: l.holeClearMm ?? 0,
    holeGapMm: l.holeGapMm ?? 0, drillMinMm: l.drillMinMm ?? 0, viaRingMm: l.viaRingMm ?? 0, maskExpandMm: r.maskExpandMm, maskWebMm: l.maskWebMm ?? 0,
  };
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

type Pin = { name: string; repo: string; url: string; sha256: string };
const why = (error: unknown) => (error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : String(error));

/** The fabs' rule files from the cache, fetching what is missing or does not match its pin. A file that cannot be had
 * is left out, with why; one fetched that the cache cannot keep is used all the same, and said. (`pins` and `get`
 * are the tests'.) */
export async function ruleFiles({ offline = process.env.SPRUE_OFFLINE === "1", pins = RULE_FILES as Record<string, Pin>, get }: { offline?: boolean; pins?: Record<string, Pin>; get?: typeof fetch } = {}): Promise<{ texts: Partial<Record<RuleFileId, string>>; notes: string[] }> {
  const dir = join(cacheDir(), "kicad"), texts: Partial<Record<string, string>> = {}, notes: string[] = [];
  for (const [id, pin] of Object.entries(pins)) {
    const path = join(dir, `${id}-${pin.sha256.slice(0, 12)}.kicad_dru`);
    if (existsSync(path) && sha256(readFileSync(path)) === pin.sha256) {
      texts[id] = readFileSync(path, "utf8");
      continue;
    }
    if (offline) {
      notes.push(`${pin.name} is not in the cache and SPRUE_OFFLINE=1 says not to fetch it`);
      continue;
    }
    let data: Uint8Array;
    try {
      guardNetwork();
      const r = await (get ?? fetch)(pin.url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`${new URL(pin.url).host} answered ${r.status}`);
      data = new Uint8Array(await r.arrayBuffer());
    } catch (error) {
      notes.push(`${pin.name} could not be fetched from ${pin.repo} (${why(error)})`);
      continue;
    }
    if (sha256(data) !== pin.sha256) {
      notes.push(`${pin.name} fetched from ${pin.repo} is not the file pinned (its sha256 differs), so it is not used: report it`);
      continue;
    }
    texts[id] = new TextDecoder().decode(data);
    // Kept for the next run, through a name of this process's own so two runs at once do not trip on each other.
    const part = `${path}.${process.pid}.part`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(part, data);
      renameSync(part, path);
    } catch (error) {
      try { rmSync(part, { force: true }); } catch { /* the cache folder is not there to hold it */ }
      notes.push(`${pin.name} was fetched and used, but could not be kept in the cache ${dir} (${why(error)}), so the next run fetches it again`);
    }
  }
  return { texts, notes };
}

/** What the check runs: our rules first (the run the self-test and the netlist are of), then each fab profile. */
export async function ruleSets(r: Rules): Promise<{ sets: RuleSet[]; notes: string[] }> {
  const { texts, notes } = await ruleFiles();
  const sets: RuleSet[] = [{ id: "ours", title: "our rules", source: "pipeline/pcb/rules.ts", ruleFile: null, rules: ourKicadRules(r), dru: "" }];
  for (const [id, p] of Object.entries(FAB_PROFILES)) {
    const file = id in RULE_FILES ? RULE_FILES[id as RuleFileId] : undefined;
    const text = file ? texts[id as RuleFileId] : undefined;
    sets.push({ id, title: `${p.name}'s numbers${text ? ` and ${file!.name}` : ""}`, source: p.source, ruleFile: text ? `${file!.repo} (${file!.url})` : null, rules: fabKicadRules(id, r), dru: text ?? "" });
  }
  return { sets, notes };
}

/** pcb/kicad.json, as kicad.py writes it. */
export type KicadReport = {
  ok: boolean; status: "pass" | "fail" | "partial" | "not run"; kicad: string | null; tested?: string; python: string | null; note?: string;
  zip: { name: string; sha256: string }; errors: string[];
  rebuilt?: { pads: number; vias: number; npth: number; tracks: number; outline: number; pours: { layer: string; net: string; touches: string[] }[] };
  ruleSets: {
    id: string; title: string; status: "pass" | "fail" | "not run"; note: string; ruleFileLoaded: boolean; canaryHits: number; errors: string[]; warnings: string[];
    /** The fab file's rules KiCad skipped (their conditions did not compile); null when the probe did not run. */
    skippedRules?: string[] | null;
  }[];
  netlist: { ok: boolean; ours?: number; kicad?: number; matched?: number; onlyOurs?: string[]; onlyKicad?: string[]; error?: string } | null;
  selfTest: { ok: boolean; ran?: boolean; cases: { fault: string; expect: string; ok: boolean; got: string }[] } | null;
  seconds?: number;
};
/** `upstream`: not run because a layer before it did not pass (verify says which), not for a reason of its own. */
export type KicadRun = { status: "pass" | "fail" | "not run"; report?: KicadReport; message: string; upstream?: true };

/** Runs kicad.py on a pcb/ folder with the Python that runs the read-back (it needs gerbonara too); kicad.py finds
 * KiCad's own Python for the DRC. The old kicad.json goes first. */
export function runKicad(pcbDir: string, python: string, sets: RuleSet[]): KicadRun {
  rmSync(join(pcbDir, "kicad.json"), { force: true });
  const tmp = mkdtempSync(join(tmpdir(), "sprue-kicad-rules-"));
  try {
    writeFileSync(join(tmp, "rules.json"), JSON.stringify({ ruleSets: sets }));
    const r = spawnSync(python, ["-I", KICAD, pcbDir, "--rules", join(tmp, "rules.json"), "--self-test"], { encoding: "utf8", timeout: 1_800_000 });
    const said = (r.stderr || "").trim().split("\n").filter((l) => l && !l.startsWith("kicad check: running on"));
    if (r.error) return { status: "not run", message: `${python} did not run it (${r.error.message})` };
    if (r.status === 2 || r.status === 3 || r.status === 4) return { status: "not run", message: said.at(-1) ?? `exit status ${r.status}` };
    const path = join(pcbDir, "kicad.json");
    if (!existsSync(path)) return { status: "not run", message: `it stopped with an error: ${said.slice(-2).join(" ") || `exit status ${r.status}`}` };
    const report = JSON.parse(readFileSync(path, "utf8")) as KicadReport;
    if (report.kicad === null && !report.errors.length) return { status: "not run", report, message: report.note ?? "KiCad was not found" };
    if (report.note && report.status === "not run") return { status: "not run", report, message: report.note };
    return { status: report.status === "fail" ? "fail" : report.status === "not run" ? "not run" : "pass", report, message: "" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The Python with KiCad's pcbnew kicad.py would use, run by `python` (the read-back's), or undefined if none. */
export function kicadPython(python: string): string | undefined {
  const r = spawnSync(python, ["-I", KICAD, "--find"], { encoding: "utf8", timeout: 600_000 });
  try {
    return r.status === 0 ? (JSON.parse(r.stdout) as { python: string }).python : undefined;
  } catch {
    return undefined;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listed = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const ASIDE = "a second opinion from another DRC than ours, which does not hold back the board";

const counts = (b: NonNullable<KicadReport["rebuilt"]>) =>
  `${plural(b.pads, "pad")}, ${plural(b.vias, "via")}, ${plural(b.tracks, "track")}, ${plural(b.npth, "non-plated hole")}${b.pours.length ? ", the pour as the copper the files hold, never refilled" : ""}`;
const NOT_FOUND = "no Python with KiCad's pcbnew was found";

/** The layer of verify's summary. `notes` are the rule files that could not be had (or kept). */
export function kicadLayer(slug: string, run: KicadRun, notes: string[] = []): Layer {
  const base = { id: "kicad", title: "KiCad DRC", blocks: false as const, aside: ASIDE };
  const r = run.report;
  const tested = r?.tested ?? "7.0.11";
  // Before any rebuild: what is wrong is elsewhere (the layer above says what) or in how kicad.py ran.
  if (!r)
    return {
      ...base, checked: "the board rebuilt in KiCad from the zip, and KiCad's own DRC on it", status: "not run", result: `not run: ${run.message}`, errors: [],
      fix: run.upstream ? undefined : `run sprue verify ${slug} again; if it stays, report it`,
    };
  const b = r.rebuilt;
  const rebuilt = !b ? "the board read from the zip to be rebuilt in KiCad"
    : `the board rebuilt ${r.kicad ? `in KiCad ${r.kicad}${r.kicad !== tested ? ` (the check is tested on KiCad ${tested})` : ""}` : "for KiCad"} from the zip (${counts(b)})`;
  // The rebuild stopped, or found a short, with KiCad's DRC not run: no DRC, netlist or self-test to speak of.
  if (!b || (r.kicad === null && r.errors.length) || run.status === "not run") {
    const found = r.kicad !== null, notFound = !found && (r.note ?? run.message).startsWith(NOT_FOUND);
    const drc = !b ? "" : notFound ? `; KiCad's DRC did not run: ${NOT_FOUND}` : found ? `; KiCad's DRC did not run: ${r.note ?? run.message}` : "";
    const failed = r.errors.length > 0;
    return {
      ...base, checked: `${rebuilt}${drc}`, status: failed ? "fail" : "not run",
      result: failed ? `${plural(r.errors.length, "problem")} in the rebuild${b ? "" : ", so KiCad's DRC did not run"}` : `not run: ${run.message}`,
      errors: r.errors.slice(0, 3),
      fix: !b ? "these files use something the KiCad check cannot rebuild yet (our reader stopped, not KiCad): the board's other layers stand; report it"
        : failed ? `the files join two nets where our DRC saw none: read products/${slug}/pcb/kicad.json before ordering, fix cad/pcb.mjs (or report our DRC), then run sprue verify ${slug} again`
        : found ? `KiCad ${r.kicad} was found, but the check could not run on it (it is tested on KiCad ${tested}, and pcbnew changes between versions): report it with products/${slug}/pcb/kicad.json`
        : notFound ? `install KiCad (${tested} is the version the check is tested on; its Python comes with it), or point SPRUE_KICAD_PYTHON at the Python that imports pcbnew, then run sprue verify ${slug} again`
        : `run sprue verify ${slug} again; if it stays, report it`,
    };
  }
  const loaded = r.ruleSets.filter((s) => s.status !== "not run");
  const unloaded = r.ruleSets.filter((s) => s.status === "not run");
  const failed = r.ruleSets.filter((s) => s.status === "fail");
  const partly = loaded.filter((s) => s.skippedRules !== undefined && s.skippedRules?.length !== 0);
  const t = r.selfTest, missed = t?.cases.filter((c) => !c.ok) ?? [], noFault = t?.ran === false || t?.cases.length === 0;
  const checked = `${rebuilt}, ` +
    `KiCad's DRC on it with ${listed(loaded.map((s) => s.title))}${unloaded.length ? ` (not with ${listed(unloaded.map((s) => s.title))}: ${unloaded[0].note})` : ""}, ` +
    `its IPC-D-356 netlist against ours, and ${t && !noFault ? plural(t.cases.length, "fault") : "no faults"} put into copies of the rebuilt board`;
  const netlist = r.netlist && !r.netlist.ok ? [r.netlist.error ?? `the netlists differ: ${[...(r.netlist.onlyOurs ?? []).map((x) => `ours only: ${x}`), ...(r.netlist.onlyKicad ?? []).map((x) => `KiCad's only: ${x}`)].slice(0, 3).join("; ")}`] : [];
  // Every problem counts; only the first two of each rule set are shown.
  const problems = r.errors.length + failed.reduce((sum, s) => sum + s.errors.length, 0) + netlist.length + missed.length;
  const errors = [
    ...r.errors,
    ...failed.flatMap((s) => s.errors.slice(0, 2).map((e) => `${s.title}: ${e}`)),
    ...netlist,
    ...missed.map((c) => `${c.fault} was not caught (${c.expect})`),
  ];
  const asides = [
    ...partly.map((s) => `${s.title}: ${s.note}`),
    ...notes.map((n) => (/could not be kept/.test(n) ? n : `${n}, so that fab's run used its published numbers alone`)),
  ];
  const n = r.netlist;
  const result = run.status === "pass"
    ? `0 errors with ${listed(loaded.map((s) => s.id === "ours" ? "ours" : s.title.replace(/'s numbers.*/, "'s")))}; ${n?.matched} of ${n?.ours} netlist records match KiCad's; ${!t ? "no self-test" : noFault ? "no fault could be put into this board, so the self-test did not run" : `${t.cases.length === 1 ? "the fault was" : `each of the ${t.cases.length} faults was`} caught`}`
    : plural(problems || 1, "problem");
  return {
    ...base, checked, status: run.status, result, errors: (run.status === "pass" ? asides : [...errors, ...asides]).slice(0, 3),
    fix: run.status === "pass" ? undefined : missed.length && !failed.length && !netlist.length && !r.errors.length
      ? "the KiCad check misses faults on this board, so its pass would mean nothing here: report it"
      : `KiCad and our DRC disagree about these files: read products/${slug}/pcb/kicad.json before ordering; if KiCad is right, fix cad/pcb.mjs (or report our DRC), then run sprue verify ${slug} again`,
  };
}
