// `sprue publish <slug> [--out <dir>]`: what a gallery entry of a product would hold, printed for its author to read
// (research/gallery.md, 3.2 and step 1). Print only: it uploads nothing, needs no account and writes nothing in the
// product or the repo; `--out` writes the bundle to a new or empty folder outside them.
//
// A bundle is the design's sources and nothing else, so a gallery can build the rest again from them: request.json,
// design.json, design.md, bom.json, cad/*.py, cad/pcb.mjs, figure.mjs and rules.ts, and the licence the product is
// under. What a run makes (fab/, pcb/, previews/, the figure, the checks, the page, the firmware sprue pcb writes) is
// left out, as are the prices and offers (catalog.json, sourcing.json, quotes.json, offers.*.json: entry.json sums the
// cost instead), the answer key (reference/), the history, the shots, the gates' state (entry.json gives the stage),
// hidden files, and every link, which is never followed. Beside them goes entry.json: the title, the brief, the stage,
// the licence, which Sprue's gates the claims are of, what this product's own runs say of it (each as it holds for
// the files now, where Sprue can tell), the cost, what Sprue can't check in it, and every file by its size and sha256.
//
// It refuses, naming the file and line, a sent file with an email address, a phone number, a home folder's path (which
// has a user name in it) or something that looks like a key, token or password; and firmware/code.py when sprue pcb
// did not write it, since a hand-written one could do anything on a builder's computer and no emulator run can show
// it doesn't. No scan finds a name or an address written in prose: that is why it prints the brief for the author to
// read. It reads files only: none of the product's code (rules.ts, figure.mjs, cad/*) runs.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { realPath } from "./io.ts";
import { sprueWrote } from "./pcb.ts";
import { faultsAudit, gatesDigest, isBoardLine, systemAudit, verifyState } from "./stages/score.ts";
import { quoteFreshness } from "./gates.ts";
import { limitsOf, type LimitKind } from "./limits.ts";
import type { Bom, BomLine, Checks, Design, Offer, Quotes, Request } from "./types.ts";

/** The design's sources: what a bundle sends. */
const SOURCES = new Set(["request.json", "design.json", "design.md", "bom.json", "figure.mjs", "rules.ts", "cad/pcb.mjs"]);
export const isSource = (path: string) => SOURCES.has(path) || /^cad\/[^/]+\.py$/.test(path);
/** Without these there is no design to publish. */
export const REQUIRED = ["request.json", "design.json", "bom.json"];

/** What a run makes from the sources, which a gallery makes again: left out. */
const REBUILT = new Set(["fab", "pcb", "previews", "production", "figure.svg", "figure.json", "view.html", "explorer.json",
  "build-plan.md", "checks.json", "system.json", "score.json", "faults.json"]);
/** Never sent, each for its reason. */
const NEVER: Record<string, string> = {
  "catalog.json": "offers and prices", "sourcing.json": "offers and prices", "quotes.json": "offers and prices",
  reference: "your answer key and seeded faults", history: "your runs", shots: "your screenshots",
  "state.json": "the gates' state; entry.json gives the stage", "firmware/fil.json": "a firmware run's report",
  "firmware/code.sprue.py": "firmware sprue pcb wrote beside yours",
};
/** Folders the walk skips without a word: caches. */
const CACHES = new Set(["__pycache__", "node_modules"]);

/** One thing the privacy scan found: where, what kind, and the start of it (the rest masked). */
export type Finding = { file: string; line: number; kind: string; sample: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Addresses that are no one's: documentation's (RFC 2606), a git remote's and GitHub's no-reply ones. */
const NOT_SOMEONE = /@(?:(?:[\w-]+\.)*example\.(?:com|org|net)|[\w-]+\.(?:example|invalid|test|localhost)|users\.noreply\.github\.com)$|^(?:git|noreply|no-reply)@/i;
const SCAN: { kind: string; re: RegExp; ok?: (match: string) => boolean; digits?: [number, number] }[] = [
  { kind: "an email address", re: EMAIL, ok: (m) => NOT_SOMEONE.test(m) },
  // An international number, +<country> and 7 to 14 more digits in groups; and the US's (555) 123-4567 and 555-123-4567.
  { kind: "a phone number", re: /(?<![\w.+)\]])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){1,5}(?:[ .-]?\d{2,4})(?![\w.])/g, digits: [8, 15] },
  { kind: "a phone number", re: /(?<![\w.-])(?:\(\d{3}\) ?|\d{3}[-.])\d{3}[-.]\d{4}(?![\w.-])/g },
  // A home folder has its user's name in it: /Users/<name>, /home/<name>, C:\Users\<name> (or \\ in JSON).
  { kind: "a home folder's path (a user name)", re: /(?<![\w.~-])\/(?:Users|home)\/(?!Shared\b)[^/\s"'`<>]+/g },
  { kind: "a home folder's path (a user name)", re: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)(?!Public\b)[^\\/\s"'`<>]+/gi },
  // Keys, tokens and passwords: by the shape a service gives them, or by the name they are assigned to.
  { kind: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "a key or token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})/g },
  { kind: "a key, token or password", re: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY)\b["']?\s*[:=]\s*(?:"[^"\s]{6,}"|'[^'\s]{6,}'|[^\s"'`,;)}\]]{8,})/g,
    ok: (m) => /[:=]\s*(?:os\.|process\.env|getenv|env\(|\$\{|\$\(|<)/.test(m) },
  { kind: "a key, token or password", re: /["']?\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|token)["']?\s*[:=]\s*(?:"[^"\s]{8,}"|'[^'\s]{8,}')/gi },
  { kind: "a key, token or password in a link", re: /[?&](?:api[_-]?key|apikey|key|access[_-]?token|token|client[_-]?secret|secret|sig|signature|password)=[^&\s"'#)<>]{6,}/gi },
];

/** What in a file's text a stranger must not get: each finding with its line, its kind, and its first few characters. */
export function privacyFindings(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, n) => {
    for (const s of SCAN) {
      for (const m of line.matchAll(s.re)) {
        const hit = m[0];
        if (s.ok?.(hit)) continue;
        if (s.digits) {
          const d = hit.replace(/\D/g, "").length;
          if (d < s.digits[0] || d > s.digits[1]) continue;
        }
        if (out.some((f) => f.line === n + 1 && f.kind === s.kind)) continue;
        out.push({ file, line: n + 1, kind: s.kind, sample: mask(hit) });
      }
    }
  });
  return out;
}

/** The first few characters of what was found, so the author can find it, and not the rest of it. */
const mask = (s: string) => `${s.slice(0, Math.min(4, Math.ceil(s.length / 3)))}…`;

/** The licence a product is under: the first LICENSE (or LICENCE, COPYING) in its folder or a folder it is in, up to
 * the top of the git work tree it is in, or two folders up (the folder that holds products/) when it is in none. */
export function findLicence(realDir: string): { path: string; spdx: string | null } | undefined {
  let here = realDir;
  for (let up = 0; ; up++) {
    const names = (() => {
      try {
        return readdirSync(here);
      } catch {
        return [];
      }
    })();
    const name = names.filter((n) => /^(?:LICEN[CS]E|COPYING)(?:\.(?:md|txt))?$/i.test(n)).sort()[0];
    if (name && statSync(join(here, name)).isFile()) {
      const path = join(here, name);
      return { path, spdx: spdxOf(readFileSync(path, "utf8")) };
    }
    const top = existsSync(join(here, ".git"));
    const parent = dirname(here);
    if (top || parent === here || (up >= 2 && !inGitTree(here))) return undefined;
    here = parent;
  }
}

const inGitTree = (dir: string): boolean => {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
};

/** The top of the git work tree a folder is in, if any. */
export function gitTop(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** The SPDX id of a licence's text, for the ones a hardware design is most often under; null for any other. */
export function spdxOf(text: string): string | null {
  const head = text.slice(0, 600).replace(/\s+/g, " ");
  if (/^\s*(?:The )?MIT License\b/i.test(head) || /Permission is hereby granted, free of charge, to any person obtaining a copy/.test(text)) return "MIT";
  if (/Apache License,? Version 2\.0/i.test(head)) return "Apache-2.0";
  const cern = /CERN Open Hardware Licen[cs]e Version 2 [-–] (Strongly Reciprocal|Weakly Reciprocal|Permissive)/i.exec(head);
  if (cern) return `CERN-OHL-${cern[1][0].toUpperCase()}-2.0`;
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(head)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(head)) return "GPL-2.0";
  if (/Attribution-ShareAlike 4\.0 International/i.test(head)) return "CC-BY-SA-4.0";
  if (/Attribution 4\.0 International/i.test(head)) return "CC-BY-4.0";
  return null;
}

/** One file a bundle sends: its path in the bundle, its size and its sha256. */
export type BundleFile = { path: string; bytes: number; sha256: string; from: string };

/** What a gallery entry of the product would hold, or why it can't be one. */
export type Bundle = {
  slug: string;
  files: BundleFile[];
  /** What is left out, by why. */
  left: { rebuilt: string[]; never: string[]; other: string[] };
  entry: Entry;
  /** Why it refuses: nothing is printed as a bundle, and nothing is written, while there are any. */
  problems: string[];
  /** What the author should know, which doesn't stop it. */
  notes: string[];
};

/** entry.json: everything a gallery would show of the entry, but its files' contents. */
export type Entry = {
  format: 1;
  id: string;
  title: string;
  brief: string;
  stage?: { stage: string; status?: string };
  licence: { spdx: string | null; file: string } | null;
  sprue: { gates: string };
  claimed: Claims;
  cost?: Cost;
  limits?: { kind: LimitKind; title: string; found: string[] }[];
  flags?: { kind: "children" | "recording"; title: string; found: string[] }[];
  /** sha256 over the files' paths and sha256s: one id for these sources, whatever the runs say. */
  bundle: string;
  files: Record<string, { bytes: number; sha256: string }>;
};

/** What this product's own runs say of it: our own checks, not a fab's. Each is as the record has it, and `current`
 * says whether Sprue can tell it is of the files as they are now (false when it can tell it isn't). */
export type Claims = {
  note: string;
  checks?: { ran: number; failed: number; flagged: number };
  system?: { ok: boolean; detail: string };
  board?: { status: string };
  faults?: { ok: boolean; ran: number; caught: number; falseAlarms: number; detail: string };
  score?: { pass: boolean };
};

export type Cost = {
  batchUsd: number; units: number; region: string; budgetUsd?: number; includesEstimates: boolean;
  pricesRead?: { from: string; to: string }; current: boolean; why?: string;
};

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** The bundle of the product at `dir` (named `slug`), and what it leaves out, or why it refuses. */
export function bundle(dir: string, slug: string): Bundle {
  const problems: string[] = [], notes: string[] = [];
  const left = { rebuilt: [] as string[], never: [] as string[], other: [] as string[] };
  const files: BundleFile[] = [];
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    root = resolve(dir);
  }
  // Every name in the product, never through a link: a link is named and left out (one where a source goes refuses).
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(join(root, rel)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = rel ? `${rel}/${name}` : name, at = join(root, path);
      const ls = lstatSync(at);
      const folder = ls.isDirectory(), shown = folder ? `${path}/` : path;
      if (folder && CACHES.has(name)) continue;
      if (ls.isSymbolicLink()) {
        const to = (() => {
          try {
            return readlinkSync(at);
          } catch {
            return "?";
          }
        })();
        if (isSource(path) || path === "cad" || path === "firmware" || path === "LICENSE")
          problems.push(`${path} is a link (to ${to}), which a bundle never follows: put the file itself there`);
        else left.never.push(`${path} (a link, never followed)`);
        continue;
      }
      if (name.startsWith(".")) { left.never.push(`${shown} (hidden)`); continue; }
      if (!rel && REBUILT.has(name)) { left.rebuilt.push(shown); continue; }
      const never = NEVER[path] ?? (!rel && /^offers\..+\.json$/.test(name) ? "offers and prices" : undefined);
      if (never) { left.never.push(`${shown} (${never})`); continue; }
      if (folder) {
        if (path === "cad" || path === "firmware") walk(path);
        else left.other.push(shown);
        continue;
      }
      if (!ls.isFile()) { left.never.push(`${path} (not a file)`); continue; }
      if (path === "firmware/code.py" || path === "firmware/README.md") {
        const text = readFileSync(at, "utf8");
        if (sprueWrote(slug, text)) { left.rebuilt.push(`${path} (sprue pcb writes it from the board)`); continue; }
        if (path === "firmware/code.py") {
          problems.push(`firmware/code.py is not one sprue pcb wrote for ${slug}: hand-written firmware isn't published, since it could do anything on a builder's computer and no emulator run shows it doesn't. Take it out, or run sprue pcb ${slug} to write the board's own (keep yours elsewhere)`);
          continue;
        }
      }
      if (!isSource(path)) { left.other.push(path); continue; }
      const data = readFileSync(at);
      files.push({ path, bytes: data.length, sha256: sha(data), from: at });
    }
  };
  walk("");
  for (const f of REQUIRED) if (!files.some((x) => x.path === f) && !problems.some((p) => p.startsWith(`${f} `)))
    problems.push(`there is no ${f}, so there is no design to publish yet: run sprue status ${slug} to see what's next`);

  // The files a bundle sends must be text; each is scanned.
  for (const f of files) {
    const text = readFileSync(f.from, "utf8");
    if (text.includes("\uFFFD") && !Buffer.from(text, "utf8").equals(readFileSync(f.from)))
      problems.push(`${f.path} is not text (UTF-8): a design's sources are`);
    for (const x of privacyFindings(f.path, text)) problems.push(`${x.file}:${x.line}: ${x.kind} (${x.sample}): take it out`);
  }

  const read = <T,>(file: string): T | undefined => {
    try {
      return existsSync(join(root, file)) ? (JSON.parse(readFileSync(join(root, file), "utf8")) as T) : undefined;
    } catch {
      if (REQUIRED.includes(file)) problems.push(`${file} is not readable JSON: run sprue validate ${slug}`);
      return undefined;
    }
  };
  const request = read<Partial<Request>>("request.json") ?? {};
  const design = read<Partial<Design>>("design.json") ?? {};
  const bom = read<Partial<Bom>>("bom.json") ?? {};
  const lines = Array.isArray(bom.lines) ? bom.lines.filter((l): l is BomLine => !!l && typeof l === "object" && typeof l.id === "string") : [];

  // The licence goes in the bundle as LICENSE.
  const lic = findLicence(root);
  if (lic) {
    const data = readFileSync(lic.path);
    const at = relative(process.cwd(), lic.path).split(sep).join("/");
    if (!files.some((f) => f.path === "LICENSE")) files.push({ path: "LICENSE", bytes: data.length, sha256: sha(data), from: lic.path });
    for (const x of privacyFindings("LICENSE", data.toString("utf8"))) problems.push(`${at}:${x.line}: ${x.kind} (${x.sample}): take it out`);
    if (!lic.spdx) notes.push(`Sprue can't tell which licence ${at} is: say it in the entry when you submit it`);
  } else notes.push("no LICENSE in the product's folder or the folders it is in: without one nobody may reuse the design, so add one (a gallery would ask which)");

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = sha(files.map((f) => `${f.path}\0${f.sha256}\n`).join(""));
  const state = read<{ stage?: string; stages?: Record<string, { status?: string }> }>("state.json");
  const entry: Entry = {
    format: 1,
    id: slug,
    title: typeof request.product === "string" ? request.product : slug,
    brief: typeof request.brief === "string" ? request.brief : "",
    ...(typeof state?.stage === "string" ? { stage: { stage: state.stage, ...(typeof state.stages?.[state.stage]?.status === "string" ? { status: state.stages[state.stage]!.status } : {}) } } : {}),
    licence: lic ? { spdx: lic.spdx, file: "LICENSE" } : null,
    sprue: { gates: `sha256:${gatesDigest()}` },
    claimed: claims(root, lines as BomLine[], read),
    ...costOf(root, request, read),
    ...limitsAndFlags(request, design, bom),
    bundle: `sha256:${digest}`,
    files: Object.fromEntries(files.map((f) => [f.path, { bytes: f.bytes, sha256: `sha256:${f.sha256}` }])),
  };
  // What entry.json says comes from the runs' records too (a detail can hold a path): scan it as it would be sent.
  for (const x of privacyFindings("entry.json", JSON.stringify(entry, null, 2))) problems.push(`entry.json:${x.line}: ${x.kind} (${x.sample}), from a run's record: take it out of the file it came from`);
  return { slug, files, left, entry, problems, notes };
}

/** The claims, each from its record, as they hold for the files now where Sprue can tell (system.json, faults.json and
 * pcb/verify.json are held to the files they were of). A record that is missing is left out. */
function claims(root: string, lines: BomLine[], read: <T>(file: string) => T | undefined): Claims {
  const out: Claims = { note: "what this product's own runs say of it: Sprue's own checks, not a fab's, which a gallery would run again" };
  const checks = read<Partial<Checks>>("checks.json");
  if (checks && Array.isArray(checks.checks))
    out.checks = { ran: checks.checks.length, failed: checks.checks.filter((c) => c?.status === "fail").length, flagged: checks.checks.filter((c) => c?.status === "flag").length };
  const quiet = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  if (lines.length) {
    const s = quiet(() => systemAudit(root, { lines } as Bom));
    if (s && !/^nothing made/.test(s.detail)) out.system = { ok: s.ok, detail: s.detail };
    if (lines.some((l) => quiet(() => isBoardLine(root, l)))) {
      // verified, stale (verified, but of another board than the one there is now), or what verify.json says.
      const v = quiet(() => verifyState(root));
      out.board = { status: v ?? "not verified" };
    }
  }
  const f = quiet(() => faultsAudit(root));
  if (f) out.faults = { ok: f.ok, ran: f.ran, caught: f.caught, falseAlarms: f.falseAlarms, detail: f.detail };
  const score = read<{ pass?: unknown }>("score.json");
  if (score && typeof score.pass === "boolean") out.score = { pass: score.pass };
  return out;
}

/** The order's cost, from quotes.json, said as an estimate where it is one: entry.json sends no offer or price list. */
function costOf(root: string, request: Partial<Request>, read: <T>(file: string) => T | undefined): { cost?: Cost } {
  const q = read<Partial<Quotes>>("quotes.json");
  if (!q || typeof q.batchUsd !== "number" || !Array.isArray(q.lines)) return {};
  const fresh = (() => {
    try {
      return quoteFreshness(root).problems;
    } catch {
      return ["quotes.json can't be held to its files"];
    }
  })();
  // When the chosen offers' prices were read, from the catalog (and the live offers) the quote picked them from.
  const offers: Record<string, Offer[]> = {};
  for (const file of ["catalog.json", "offers.digikey.json"]) {
    const c = read<{ offers?: Record<string, Offer[]> }>(file);
    for (const [id, list] of Object.entries(c?.offers ?? {})) if (Array.isArray(list)) offers[id] = [...(offers[id] ?? []), ...list];
  }
  const dates = q.lines.flatMap((l) => (offers[l?.lineId] ?? []).filter((o) => o?.supplier === l.supplier && o?.sku === l.sku).map((o) => o.capturedAt))
    .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  return {
    cost: {
      batchUsd: q.batchUsd, units: typeof q.units === "number" ? q.units : (request.units ?? 1), region: typeof request.region === "string" ? request.region : "",
      ...(typeof request.budgetUsd === "number" ? { budgetUsd: request.budgetUsd } : {}),
      includesEstimates: q.lines.some((l) => l?.mode === "estimate"),
      ...(dates.length ? { pricesRead: { from: dates[0], to: dates.at(-1)! } } : {}),
      current: !fresh.length, ...(fresh.length ? { why: fresh[0] } : {}),
    },
  };
}

/** What Sprue can't check in it (limits.ts), and what a gallery decides whether to list: a product for children, and
 * one with a camera or a microphone, which can record people. */
function limitsAndFlags(request: Partial<Request>, design: Partial<Design>, bom: Partial<Bom>): Pick<Entry, "limits" | "flags"> {
  const limits = (() => {
    try {
      return limitsOf({ request, design, bom }).map((l) => ({ kind: l.kind, title: l.title, found: l.found }));
    } catch {
      return [];
    }
  })();
  const flags: NonNullable<Entry["flags"]> = [];
  const c = request.constraints && typeof request.constraints === "object" ? request.constraints : {};
  const kids: string[] = [];
  if (typeof c.userAgeMin === "number" && c.userAgeMin < 14) kids.push(`request.json constraints.userAgeMin: ${c.userAgeMin}`);
  for (const [field, text] of [["brief", request.brief], ["product", request.product]] as const)
    if (typeof text === "string") { const m = /\b(?:kids?|child(?:ren)?(?:'s)?|toddlers?|bab(?:y|ies)|toys?)\b/i.exec(text); if (m) kids.push(`request.json ${field}: "${m[0]}"`); }
  if (kids.length) flags.push({ kind: "children", title: "Made for children", found: kids });
  const rec: string[] = [];
  for (const l of Array.isArray(bom.lines) ? bom.lines : []) {
    if (!l || typeof l !== "object") continue;
    const words = [l.role, l.name, l.shortName].filter((x): x is string => typeof x === "string").join(" ");
    const m = /\b(?:cameras?|microphones?|mics?)\b/i.exec(words);
    if (m && typeof l.id === "string") rec.push(`bom.json line ${l.id}: "${m[0]}"`);
  }
  if (rec.length) flags.push({ kind: "recording", title: "A camera or a microphone", found: rec });
  return { ...(limits.length ? { limits } : {}), ...(flags.length ? { flags } : {}) };
}

const kB = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** The bundle as the author reads it before anything leaves their computer, then entry.json. */
export function bundleText(b: Bundle): string {
  const e = b.entry, out: string[] = [];
  out.push(`sprue publish ${b.slug}: what a gallery entry of it would hold. Print only: nothing is uploaded, and nothing is written in the product or the repo.`);
  out.push("", "The brief, as request.json has it. Read it: no scan finds a name or an address written in prose.");
  out.push(`  ${JSON.stringify(e.brief)}`);
  const total = b.files.reduce((s, f) => s + f.bytes, 0);
  out.push("", `Sent: ${b.files.length} file${b.files.length === 1 ? "" : "s"}, ${kB(total)}, each by its sha256 (bundle ${e.bundle.slice(7, 19)}):`);
  const w = Math.max(...b.files.map((f) => kB(f.bytes).length));
  for (const f of b.files) out.push(`  ${kB(f.bytes).padStart(w)}  ${f.sha256}  ${f.path}`);
  const list = (xs: string[]) => xs.join(", ");
  out.push("", "Left out:");
  if (b.left.rebuilt.length) out.push(`  made again from the files above, by a gallery: ${list(b.left.rebuilt)}`);
  if (b.left.never.length) out.push(`  never sent: ${list(b.left.never)}`);
  if (b.left.other.length) out.push(`  not a source Sprue knows, so not sent (if the CAD, the figure or rules.ts reads one, the bundle can't be built again from what is sent): ${list(b.left.other)}`);
  if (!b.left.rebuilt.length && !b.left.never.length && !b.left.other.length) out.push("  nothing");
  out.push("", `Claims, as this product's own runs recorded them (${e.claimed.note.replace(/^what this product's own runs say of it: /, "")}):`);
  const c = e.claimed;
  if (c.checks) out.push(`  checks: ${c.checks.ran} run, ${c.checks.failed} failed, ${c.checks.flagged} flagged (checks.json)`);
  if (c.system) out.push(`  the whole product: ${c.system.ok ? "passes" : "doesn't pass"}: ${c.system.detail}`);
  if (c.board) out.push(`  the board: ${c.board.status === "verified" ? "verified (pcb/verify.json)" : c.board.status === "stale" ? "verified once, but not the board as it is now: run sprue verify" : c.board.status === "not verified" ? "not verified yet: run sprue verify" : `${c.board.status} (pcb/verify.json)`}`);
  if (c.faults) out.push(`  seeded faults: ${c.faults.caught} of ${c.faults.ran} caught, ${c.faults.falseAlarms} false alarm${c.faults.falseAlarms === 1 ? "" : "s"}${c.faults.ok ? "" : `: ${c.faults.detail}`}`);
  if (c.score) out.push(`  score: ${c.score.pass ? "PASS" : "not passing"} (score.json)`);
  if (!c.checks && !c.system && !c.board && !c.faults && !c.score) out.push("  none yet: no run has recorded a check");
  if (e.cost) {
    const k = e.cost;
    out.push(`  cost: ${usd(k.batchUsd)} for ${k.units} unit${k.units === 1 ? "" : "s"}${k.region ? ` (${k.region})` : ""}` +
      `${k.budgetUsd !== undefined ? `, ${k.batchUsd > k.budgetUsd ? "over" : "within"} the ${usd(k.budgetUsd)} budget` : ""}` +
      `${k.includesEstimates ? "; some prices are estimates" : ""}${k.pricesRead ? `; prices read ${k.pricesRead.from === k.pricesRead.to ? k.pricesRead.from : `${k.pricesRead.from} to ${k.pricesRead.to}`}` : ""}` +
      `${k.current ? "" : `; not of the files now: ${k.why}`}`);
  }
  for (const l of e.limits ?? []) out.push(`⚑ out of Sprue's reach: ${l.title} (${l.found.slice(0, 2).join("; ")})`);
  for (const f of e.flags ?? [])
    out.push(`⚑ ${f.title} (${f.found.slice(0, 2).join("; ")}): ${f.kind === "children" ? "a gallery decides whether to list a children's product, and its page says it is one" : "it can record people, so a gallery decides whether to list it, and its page says where the recordings go"}`);
  out.push("", e.licence ? `Licence: ${e.licence.spdx ?? "one Sprue can't name"}, sent as LICENSE.` : "Licence: none found.");
  for (const n of b.notes) out.push(`⚑ ${n}`);
  out.push("", "entry.json:", JSON.stringify(e, null, 2));
  return out.join("\n");
}

/** Where `--out` may not write: in the product, the products folder, Sprue's own folder, or the git work tree any of
 * them (or the folder Sprue runs in) is in. The reason, or undefined. */
export function outProblem(out: string, { product, skill, cwd = process.cwd() }: { product: string; skill: string; cwd?: string }): string | undefined {
  const at = realPath(resolve(cwd, out));
  const inside = (a: string, b: string) => {
    const r = relative(b, a);
    return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
  };
  const real = (p: string) => realPath(resolve(p));
  const places: [string, string][] = [[real(product), "the product's folder"], [real(join(cwd, "products")), "products/"], [real(skill), "Sprue's own folder"]];
  for (const p of [real(product), real(cwd), real(skill)]) { const top = gitTop(p); if (top) places.push([top, `the git work tree at ${top}`]); }
  for (const [p, what] of places) if (inside(at, p)) return `--out ${out} is in ${what}: a bundle is written outside it, so nothing is added to the product or the repo (try a folder in /tmp)`;
  try {
    const st = statSync(at);
    if (!st.isDirectory()) return `--out ${out} is a file: name a new or empty folder`;
    if (readdirSync(at).length) return `--out ${out} is not empty: name a new or empty folder, so no file of yours is written over`;
  } catch {
    // Not there yet: it is made.
  }
  return undefined;
}

/** Writes the bundle's files and entry.json to `out` (outProblem said yes). The paths it wrote. */
export function writeBundle(b: Bundle, out: string): string[] {
  const at = resolve(out), wrote: string[] = [];
  for (const f of b.files) {
    mkdirSync(dirname(join(at, f.path)), { recursive: true });
    writeFileSync(join(at, f.path), readFileSync(f.from));
    wrote.push(f.path);
  }
  writeFileSync(join(at, "entry.json"), JSON.stringify(b.entry, null, 2) + "\n");
  wrote.push("entry.json");
  return wrote;
}
