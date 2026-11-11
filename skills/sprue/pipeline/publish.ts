// `sprue publish <slug> [--out <dir>]`: what a gallery entry of a product would hold, printed for its author to read
// (research/gallery.md, 3.2 and step 1). Print only: it uploads nothing, needs no account and writes nothing in the
// product or the repo; `--out` writes the bundle to a new or empty folder outside any git work tree.
//
// A bundle is the design's sources and nothing else, so a gallery can build the rest again from them: request.json,
// design.json, design.md, bom.json, the CAD's code under cad/ (.py, .mjs, .js, .ts and .json, at any depth), figure.mjs
// and rules.ts, and the licence the product is under. What a run makes (fab/, pcb/, previews/, the figure, the checks,
// the page, the firmware sprue pcb writes) is left out, as are the prices and offers (catalog.json, sourcing.json,
// quotes.json, offers.*.json: entry.json sums the cost instead), the answer key (reference/), the history, the shots,
// the gates' state (entry.json gives the stage), hidden files, and every link, which is never sent and no claim is read
// through. Beside them goes entry.json: the title, the brief, the stage, the licence, what this product's own runs say
// of it (each in a fixed word: passes, fails, stale, not run; never a record's own text, which can name files that are
// not sent), the cost, what Sprue can't check in it, and every file by its size and sha256.
//
// It refuses, naming the file and line, a sent file (the licence too) that is not UTF-8 text, or with an email address,
// a phone number, a home folder's path (which has a user name in it) or something that looks like a key, token or
// password; firmware/code.py when pcb/board.json shows it is not the one sprue pcb wrote for this board, since
// hand-written firmware could do anything on a builder's computer and no emulator run can show it doesn't (it is never
// sent: a builder's sprue pcb writes it again); and a module the sent code imports, by its own import lines or
// pcb/drc.json's, that the bundle would not send. No scan finds a name or an address written in prose: that is why it
// prints the brief, and asks the author to read design.md. It reads files only: none of the product's code (rules.ts,
// figure.mjs, cad/*) runs.

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { realPath } from "./io.ts";
import { faultsAudit, faultsInputs, gatesDigest, isBoardLine, systemAudit, systemInputs, verifyState } from "./stages/score.ts";
import { pricingProblems, quoteFreshness } from "./gates.ts";
import { limitsOf, type LimitKind } from "./limits.ts";
import type { Bom, BomLine, Checks, Design, Offer, Quotes, Request } from "./types.ts";

/** The design's sources: what a bundle sends. */
const SOURCES = new Set(["request.json", "design.json", "design.md", "bom.json", "figure.mjs", "rules.ts"]);
/** The CAD's code and data: what cad/*.py, cad/pcb.mjs and the modules they import are written in. */
const CAD_SOURCE = /^cad\/(?:[^/]+\/)*[^/]+\.(?:py|mjs|js|ts|json)$/;
export const isSource = (path: string) => SOURCES.has(path) || CAD_SOURCE.test(path);
/** Without these there is no design to publish. */
export const REQUIRED = ["request.json", "design.json", "bom.json"];
/** A licence file's name, which findLicence looks for. */
const LICENCE_NAME = /^(?:LICEN[CS]E|COPYING)(?:\.(?:md|txt))?$/i;

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

// Every pattern is anchored at the start of a run (a lookbehind) and bounded, so a long unbroken line (a hash list, a
// base64 blob) is scanned in linear time.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
/** Addresses that are no one's: documentation's (RFC 2606), a machine's on the local network (a Raspberry Pi's
 * pi@ponder.local), a git remote's and GitHub's no-reply ones; and an image's name at 2x (top@2x.png). */
const NOT_SOMEONE = /@(?:(?:[\w-]+\.)*example\.(?:com|org|net)|(?:[\w-]+\.)+(?:example|invalid|test|localhost|local|lan|internal|home\.arpa)|users\.noreply\.github\.com)$|^(?:git|noreply|no-reply)@|@\d+(?:\.\d+)?x\.(?:png|jpe?g|webp|gif|svg|avif)$/i;
/** In code, `R@np.array` is a matrix product, not an address: outside a comment or a string, an address must end in
 * a two-letter country's domain or one of these. */
const TLD = new Set(["com", "org", "net", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "app", "dev", "io", "ai",
  "xyz", "online", "site", "tech", "store", "shop", "email", "mail", "cloud", "page", "studio", "design", "works", "me"]);
const CODE = /\.(?:py|mjs|js|ts)$/;
/** Whether `at` in a line of code is in a comment or a string (a # or // before it, or an odd number of one kind of
 * quote), or right after < or mailto:. */
const inCommentOrString = (line: string, at: number) => {
  const before = line.slice(0, at);
  return /#|\/\//.test(before) || ["'", '"', "`"].some((q) => before.split(q).length % 2 === 0) || /(?:<|mailto:)$/i.test(before);
};
/** A number with a unit after it is a size, a count or a rating, not a phone number (18650 3500 mAh). */
const NOT_UNIT = String.raw`(?!\s?(?:mm|cm|m|in|mAh|Ah|Wh|mWh|V|mV|W|mW|A|mA|Hz|kHz|MHz|rpm|g|kg|ms|s|pcs|deg)\b)(?!\s?°)`;
/** Unquoted, a password has a digit or a sign in it; a plain name (`token = next_token`) is code. */
const BARE = String.raw`(?=[A-Za-z0-9!#$%^&*+/=~@_-]{0,200}[0-9!#$%^&*+/=~@])[A-Za-z0-9!#$%^&*+/=~@_-]{8,200}`;
const SECRET_WORD = String.raw`(?:secret|token|passw(?:or)?d|pwd|passphrase|api[_-]?key|apikey|access[_-]?key|private[_-]?key)`;
/** A name's `pass` or `psk` (WIFI_PASS, wifi_pass, wifiPass, WIFI_PSK), never the end of another word (compass,
 * bypass). */
const PASS_NAME = String.raw`[A-Za-z0-9_-]{0,40}?(?:(?<![A-Za-z])|(?<=[a-z0-9])(?=P))(?:pass|Pass|PASS|psk|Psk|PSK)(?![A-Za-z])`;
/** Between a name and its value: quotes, Markdown's ** or a backtick around the name, then = or :, or a table's |;
 * then the value quoted (in ", ', a backtick, triple quotes, Python's b'' or f''), or bare. */
const ASSIGN = String.raw`(?:["'\x60*]{0,2}\s{0,3}[:=]|\s{0,3}\|)\s{0,3}\*{0,2}\s{0,3}`;
const VALUE = String.raw`(?:[bBrRuUfF]{0,2}(?:"""[^\n]{6,200}?"""|'''[^\n]{6,200}?'''|"[^"\n]{6,200}"|'[^'\n]{6,200}')|\x60[^\x60\n]{6,200}\x60|${BARE})`;
/** What is assigned in a matched name = value, without its quotes. */
const valueOf = (m: string) => m.replace(/^[\s\S]*?[:=|][\s*]*[bBrRuUfF]{0,2}(?:"""|'''|["'\x60])?/, "").replace(/(?:"""|'''|["'\x60])$/, "");
/** A value that is a placeholder, or read from somewhere else: no secret is written there. */
const PLACEHOLDER = /^(?:os\.|process\.env|getenv|env\(|input\(|getpass|\$\{|\$\(|<|your[_ -]|x{3,}|\*{3,}|\.\.\.|changeme|placeholder)/i;
/** A name that ends in key, token or pass with a value of words in lower case (stepKey = "step-03-insert-switches",
 * colorToken = "accent-blue-500", a milling pass's first_pass = "rough-cut-01"): an id in the code, not a secret. A hex
 * or random value (a UUID, abcd1234efgh) is none. */
const isId = (m: string) => {
  const name = m.slice(0, m.search(/["'\x60*\s]*[:=|]/)), v = valueOf(m);
  return /(?:token|key|pass)$/i.test(name) && /^[a-z0-9]+(?:[-_.:][a-z0-9]+)+$/.test(v) && v.split(/[-_.:]/).some((w) => /^[a-z]{3,}$/.test(w) && /[g-z]/.test(w));
};
type Rule = { kind: string; re: RegExp; ok?: (match: string, file: string, line: string, at: number) => boolean; digits?: [number, number] };
const SCAN: Rule[] = [
  // Before the address rule, which would otherwise take a link's password for an address's name.
  { kind: "a password in a link", re: /(?<![\w+.-])[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@"'<>]{1,128}:[^\s/@"'<>]{1,128}@/gi },
  { kind: "a key, token or password in a link", re: /[?&](?:api[_-]?key|apikey|key|access[_-]?token|token|client[_-]?secret|secret|sig|signature|password)=[^&\s"'#)<>]{6,200}/gi },
  { kind: "an email address", re: EMAIL,
    ok: (m, file, line, at) => NOT_SOMEONE.test(m) || (CODE.test(file) && !inCommentOrString(line, at) && !/\.(?:[a-z]{2})$/i.test(m) && !TLD.has(m.slice(m.lastIndexOf(".") + 1).toLowerCase())) },
  // +<country> and 7 to 14 more digits in groups (not +45.123456, a coordinate); 00<country> and groups (not a part
  // number's 0022232031); the US's (555) 123-4567, 555-123-4567, 555.123.4567; a national number that starts with 0
  // (06 1234 5678, 0176 1234 5678, not 0402 0603); an Italian mobile's 3xx (not 352.456789, a float); and any number
  // after a word for one (Tel., phone, cell, mobile, call me, cellulare, WhatsApp, fax). None with a unit after it.
  { kind: "a phone number", re: new RegExp(String.raw`(?<![\w.+)\]])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){1,5}(?:[ .-]?\d{2,4})(?![\w.])${NOT_UNIT}`, "g"), digits: [8, 15],
    ok: (m) => /^\+\d+\.\d+$/.test(m) },
  { kind: "a phone number", re: new RegExp(String.raw`(?<![\w.+-])00[1-9]\d{0,2}[ .-][1-9]\d{1,3}(?:[ .-]?\d{2,4}){1,4}(?![\w.-])${NOT_UNIT}`, "g"), digits: [10, 15] },
  { kind: "a phone number", re: new RegExp(String.raw`(?<![\w.-])(?:1[-. ])?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[-.])\d{3}[-.]\d{4}(?![\w.-])${NOT_UNIT}`, "g") },
  { kind: "a phone number", re: new RegExp(String.raw`(?<![\w.,+-])0\d{1,4}[ /.-][1-9]\d{2,3}[ .-]?\d{3,4}(?![\w.,-])${NOT_UNIT}`, "g"), digits: [9, 12] },
  { kind: "a phone number", re: new RegExp(String.raw`(?<![\w.,+-])3[1-9]\d(?: \d{3} ?\d{3,4}|\.\d{3}\.\d{3,4})(?![\w.,-])${NOT_UNIT}`, "g"), digits: [9, 10] },
  { kind: "a phone number", re: new RegExp(String.raw`\b(?:tel|phone|cell|mobile|mobil|cellulare|telefono|whatsapp|fax|call(?: me| us)?(?: on| at)?)\b\.?\s{0,3}:?\s{0,3}\+?\(?\d[\d ()./-]{5,20}\d(?!\d)${NOT_UNIT}`, "gi"), digits: [7, 15] },
  // A home folder has its user's name in it: /Users/<name>, /home/<name> (also under WSL's /mnt/c, Cygwin's
  // /cygdrive/c, Git Bash's /c, /var/home, /usr/home and /Volumes/<disk>), C:\Users\<name> (or \\ in JSON). A
  // machine's own account (/home/pi on a Raspberry Pi, ubuntu, runner) names no one.
  { kind: "a home folder's path (a user name)", re: /(?<![\w.~-])(?:\/mnt\/[a-z]|\/cygdrive\/[a-z]|\/[a-z](?=\/Users\/)|\/var|\/usr|\/Volumes\/[^/\n"'`<>]{1,64})?\/(?:Users|home)\/(?!(?:Shared|pi|ubuntu|runner|debian|user|admin|root)(?:[/\s"'`<>]|$))[^/\s"'`<>]{1,64}/g },
  { kind: "a home folder's path (a user name)", re: /(?<![\w-])[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)(?!Public\b)[^\\/\s"'`<>]{1,64}/gi },
  // Keys, tokens and passwords: by the shape a service gives them, or by the name they are assigned to.
  { kind: "a private key", re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "a key or token", re: /(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{20,255}|sk-ant-[A-Za-z0-9_-]{20,255}|sk-(?:proj-)?[A-Za-z0-9_-]{32,255}|xox[abprs]-[A-Za-z0-9-]{10,255}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,255}|[sr]k_live_[0-9A-Za-z]{16,255}|aio_[A-Za-z0-9]{20,255}|eyJ[A-Za-z0-9_-]{10,2000}\.eyJ[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,2000})/g },
  { kind: "a key or token", re: /\bBearer\s{1,3}[A-Za-z0-9._~+/-]{16,500}/g },
  { kind: "a key, token or password", re: new RegExp(String.raw`(?<![\w-])[\w-]{0,40}?${SECRET_WORD}${ASSIGN}${VALUE}`, "gi"),
    ok: (m) => PLACEHOLDER.test(valueOf(m)) || isId(m) },
  { kind: "a key, token or password", re: new RegExp(String.raw`(?<![\w-])${PASS_NAME}${ASSIGN}${VALUE}`, "g"), ok: (m) => PLACEHOLDER.test(valueOf(m)) || isId(m) },
  { kind: "a key, token or password", re: /(?<![\w-])[\w-]{0,40}?(?:_[Kk][Ee][Yy]|Key|-key)["'`]?\s{0,3}[:=]\s{0,3}["'`]?(?=[A-Za-z0-9_/+=-]{0,200}\d)(?=[A-Za-z0-9_/+=-]{0,200}[A-Za-z])[A-Za-z0-9_/+=-]{20,200}/g,
    ok: (m) => isId(m) },
];

/** A line with its escapes (\n, \t, \u00e9 in JSON, JS or Python) as spaces of the same length, so what follows one
 * starts a word, and every match is where it is in the line. */
const unescaped = (line: string) => line.replace(/\\(?:[nrtfvb0]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/g, (e) => " ".repeat(e.length));
/** A line with its escapes as what they stand for (\u00a0, a no-break space), and \n, \t as a space. */
const decoded = (line: string) =>
  line.replace(/\\(?:[nrtfvb0]|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/g, (_, u?: string, x?: string) => (u || x ? String.fromCharCode(parseInt((u ?? x)!, 16)) : " "));
/** Unicode's other spaces (no-break, thin, figure) and dashes as ASCII's, one for one, so a number pasted from a web
 * page or a word processor reads as typed. */
const plain = (line: string) => line.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/[\u2010-\u2015\u2212]/g, "-");

/** What in a file's text a stranger must not get: each finding with its line, its kind, and its first few characters. */
export function privacyFindings(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, n) => {
    // The line as it is, and with its escapes out (a key right after "\n" in a JSON string is still a key), at the
    // same places; then with its escapes read (a number spaced with \u00a0), which has places of its own.
    for (const variants of [[plain(line), plain(unescaped(line))], [plain(decoded(line))]]) {
      const taken: [number, number][] = [];
      for (const variant of new Set(variants))
        for (const s of SCAN) {
          for (const m of variant.matchAll(s.re)) {
            const hit = m[0], from = m.index, to = from + hit.length;
            if (s.ok?.(hit, file, variant, from)) continue;
            if (s.digits) {
              const d = hit.replace(/\D/g, "").length;
              if (d < s.digits[0] || d > s.digits[1]) continue;
            }
            // One finding a place: a link's password is not also an address.
            if (taken.some(([a, b]) => from < b && a < to)) continue;
            taken.push([from, to]);
            if (out.some((f) => f.line === n + 1 && f.kind === s.kind)) continue;
            out.push({ file, line: n + 1, kind: s.kind, sample: mask(hit, s.kind) });
          }
        }
    }
  });
  return out;
}

/** The first few characters of what was found, so the author can find it, and not the rest of it: for a link with a
 * password, its scheme alone. */
const mask = (s: string, kind = "") => kind === "a password in a link" ? `${s.slice(0, s.indexOf(":"))}://…` : `${s.slice(0, Math.min(4, Math.ceil(s.length / 3)))}…`;

/** The licence a product is under: the first LICENSE (or LICENCE, COPYING) in its folder or a folder it is in, up to
 * the top of the git work tree it is in, or two folders up (the folder that holds products/) when it is in none. One
 * that is a link is never followed: `link` names it, and there is no licence. */
export function findLicence(realDir: string): { path: string; spdx: string | null } | { link: string } | undefined {
  let here = realDir;
  for (let up = 0; ; up++) {
    const names = (() => {
      try {
        return readdirSync(here);
      } catch {
        return [];
      }
    })();
    const name = names.filter((n) => LICENCE_NAME.test(n)).sort()[0];
    if (name) {
      const path = join(here, name);
      const ls = (() => {
        try {
          return lstatSync(path);
        } catch {
          return undefined;
        }
      })();
      if (ls?.isSymbolicLink()) return { link: path };
      if (ls?.isFile()) return { path, spdx: spdxOf(readFileSync(path, "utf8")) };
    }
    const top = isThere(join(here, ".git"));
    const parent = dirname(here);
    if (top || parent === here || (up >= 2 && !gitTop(here))) return undefined;
    here = parent;
  }
}

/** The files a module's code names to import by a path (./x.mjs, ../y.json, /abs, file:): import ... from, export
 * ... from, a bare import, import() and require() with a string. A package's name (node:fs, three) is not a file. */
export function importsOf(code: string): string[] {
  const out = new Set<string>();
  for (const re of [/^[ \t]*(?:import|export)\b[^;'"`]{0,2000}?\bfrom\s*(['"])([^'"\n]{1,300})\1/gm, /^[ \t]*import\s*(['"])([^'"\n]{1,300})\1/gm,
    /\bimport\s*\(\s*(['"])([^'"\n]{1,300})\1\s*\)/g, /\brequire\s*\(\s*(['"])([^'"\n]{1,300})\1\s*\)/g])
    for (const m of code.matchAll(re)) if (/^(?:\.{1,2}\/|\/|file:)/.test(m[2])) out.add(m[2]);
  return [...out];
}

/** Whether something is at `path`, a dangling link too. */
const isThere = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** The top of the git work tree a folder is in, if any. */
export function gitTop(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (isThere(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** The SPDX id of a licence's text, for the ones a hardware design is most often under; null for any other. */
export function spdxOf(text: string): string | null {
  const head = text.slice(0, 600).replace(/\s+/g, " ");
  if (/^\s*MIT No Attribution\b/i.test(head)) return "MIT-0";
  // MIT's own text: its title, or its grant with the notice it asks to keep (MIT-0 has the grant, not the notice).
  if (/^\s*(?:The )?MIT License\b/i.test(head) ||
    (/Permission is hereby granted, free of charge, to any person obtaining a copy/.test(text) && /The above copyright notice and this permission notice shall be included/.test(text))) return "MIT";
  if (/Apache License,? Version 2\.0/i.test(head)) return "Apache-2.0";
  const cern = /CERN Open Hardware Licen[cs]e Version 2 [-–] (Strongly Reciprocal|Weakly Reciprocal|Permissive)/i.exec(head);
  if (cern) return `CERN-OHL-${cern[1][0].toUpperCase()}-2.0`;
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(head)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(head)) return "GPL-2.0";
  if (/Attribution-ShareAlike 4\.0 International/i.test(head)) return "CC-BY-SA-4.0";
  if (/Attribution 4\.0 International/i.test(head)) return "CC-BY-4.0";
  return null;
}

/** One file a bundle sends: its path in the bundle, its size and its sha256, and its bytes as they were read once:
 * hashed, scanned and written (--out) from the same read, so nothing written was not scanned. */
export type BundleFile = { path: string; bytes: number; sha256: string; from: string; data: Buffer };

/** What a gallery entry of the product would hold, or why it can't be one. */
export type Bundle = {
  slug: string;
  files: BundleFile[];
  /** What is left out, by why. */
  left: { rebuilt: string[]; never: string[]; other: string[] };
  entry: Entry;
  /** What each claim's record says, for the author's terminal only: it can name files that are not sent, so it is
   * never in entry.json. */
  said: { system?: string; faults?: string; score?: string; cost?: string };
  /** Why it refuses: nothing is printed as a bundle, and nothing is written, while there are any. */
  problems: string[];
  /** What the author should know, which doesn't stop it. */
  notes: string[];
};

/** entry.json: everything a gallery would show of the entry, but its files' contents. */
export type Entry = {
  format: 1;
  /** The product's slug. The bundle's own id is `bundle` (its first 12 hex digits are what sprue publish prints). */
  id: string;
  title: string;
  brief: string;
  stage?: { stage: string; status?: string };
  licence: { spdx: string | null; file: string } | null;
  /** The digest of the gate code of the Sprue that printed this entry; faults.json's own is `claimed.faults.gates`. */
  sprue: { publishedWith: string };
  claimed: Claims;
  cost?: Cost;
  limits?: { kind: LimitKind; title: string; found: string[] }[];
  flags?: { kind: "children" | "recording"; title: string; found: string[] }[];
  /** sha256 over the files' paths and sha256s: one id for these sources, whatever the runs say. */
  bundle: string;
  files: Record<string, { bytes: number; sha256: string }>;
};

/** Where a record stands, in one word: it passes, it fails, it is of other files than these (stale), it is not
 * there, or it can't be read. */
export type ClaimState = "passes" | "fails" | "stale" | "not run" | "unreadable";

/** What this product's own runs say of it: our own checks, not a fab's. Each but `checks` is held to the files as they
 * are now (a record of other files is "stale"); `checks` is as checks.json was last written. */
export type Claims = {
  note: string;
  checks?: { ran: number; failed: number; flagged: number };
  system?: { ok: boolean; state: ClaimState; failed?: string[] };
  board?: { state: BoardState };
  faults?: { ok: boolean; state: ClaimState; ran?: number; caught?: number; falseAlarms?: number; gates?: string };
  /** score.json's pass, held to the whole-product check, the seeded faults and the quote as they are now: "stale"
   * when score.json says PASS and one of them doesn't now; "unreadable" when a record it rests on is a link. */
  score?: { pass: boolean; state: "passes" | "fails" | "stale" | "unreadable" };
};

/** pcb/verify.json's verdict on the board as it is now (verifyState), in one of these words; any other is "unreadable". */
export type BoardState = "verified" | "failed" | "unverified" | "stale" | "not verified" | "unreadable";
const BOARD_STATES = new Set<string>(["verified", "failed", "unverified", "stale", "not verified", "unreadable"]);

export type Cost = {
  batchUsd: number; units: number; region: string; budgetUsd?: number; includesEstimates: boolean;
  pricesRead?: { from: string; to: string };
  /** Whether quotes.json is of the files now (quoteFreshness), and whether it prices every line and every shop's
   * shipping (pricingProblems). `why` says which isn't, in a word: "stale" (it is of other files), "catalog" (a
   * catalog file Sprue can't price from), "incomplete" (a line with no price, a shop with no shipping figure) or
   * "unreadable" (it can't be checked); the reason's own words are printed, never put in entry.json. */
  current: boolean; complete: boolean; why?: "stale" | "catalog" | "incomplete" | "unreadable";
};

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Whether `rel` in `root`, or a folder on the way to it, is a link. */
function throughLink(root: string, rel: string): boolean {
  let at = root;
  for (const part of rel.split("/")) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** The records a claim, the cost or the stage is read from: none is read through a link. */
const RECORDS = ["checks.json", "score.json", "system.json", "faults.json", "reference/faults.json", "quotes.json", "catalog.json",
  "offers.digikey.json", "state.json", "pcb/verify.json", "pcb/drc.json", "pcb/board.json", "cad/_system.py"];

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
  const licences: string[] = [];
  let firmware: string | undefined;
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
        if (isSource(path) || path === "cad" || path === "firmware" || path === "firmware/code.py" || (!rel && LICENCE_NAME.test(name)))
          problems.push(`${path} is a link (to ${to}), which a bundle never follows: put the file itself there`);
        else left.never.push(`${path} (a link: not sent, and no claim is read through it)`);
        continue;
      }
      if (name.startsWith(".")) { left.never.push(`${shown} (hidden)`); continue; }
      if (!rel && REBUILT.has(name)) { left.rebuilt.push(shown); continue; }
      const never = NEVER[path] ?? (!rel && /^offers\..+\.json$/.test(name) ? "offers and prices" : undefined);
      if (never) { left.never.push(`${shown} (${never})`); continue; }
      if (folder) {
        if (path === "cad" || path.startsWith("cad/") || path === "firmware") walk(path);
        else left.other.push(shown);
        continue;
      }
      if (!ls.isFile()) { left.never.push(`${path} (not a file)`); continue; }
      // The licence goes as LICENSE, from findLicence: the one it picks is sent, any other is listed.
      if (!rel && LICENCE_NAME.test(name)) { licences.push(path); continue; }
      if (path === "firmware/code.py") { firmware = at; continue; }
      if (path === "firmware/README.md" && /`(?:sprue|distinta) pcb [\w-]+` wrote it/.test(readFileSync(at, "utf8"))) {
        left.rebuilt.push(`${path} (sprue pcb writes it from the board)`);
        continue;
      }
      if (!isSource(path)) { left.other.push(path); continue; }
      const data = readFileSync(at);
      files.push({ path, bytes: data.length, sha256: sha(data), from: at, data });
    }
  };
  walk("");
  for (const f of REQUIRED) if (!files.some((x) => x.path === f) && !problems.some((p) => p.startsWith(`${f} `)))
    problems.push(`there is no ${f}, so there is no design to publish yet: run sprue status ${slug} to see what's next`);

  // A record that is a link is read as if it were not there: no claim comes through a link.
  const linked = new Set(RECORDS.filter((r) => throughLink(root, r)));
  for (const r of linked) notes.push(`${r} is a link, so no claim is read from it`);
  const read = <T,>(file: string): T | undefined => {
    if (linked.has(file) || throughLink(root, file)) return undefined;
    try {
      return isThere(join(root, file)) ? (JSON.parse(readFileSync(join(root, file), "utf8")) as T) : undefined;
    } catch {
      if (REQUIRED.includes(file)) problems.push(`${file} is not readable JSON: run sprue validate ${slug}`);
      return undefined;
    }
  };

  // Firmware sprue pcb wrote for this board is made again by a builder's sprue pcb; any other is refused.
  if (firmware) {
    const problem = firmwareProblem(root, slug, firmware, read);
    if (problem === undefined) left.rebuilt.push("firmware/code.py (sprue pcb writes it from the board)");
    else if (problem.startsWith("?")) { left.rebuilt.push("firmware/code.py (sprue pcb writes it from the board)"); notes.push(problem.slice(1)); }
    else problems.push(problem);
  }

  // The licence goes in the bundle as LICENSE.
  const lic = findLicence(root);
  const licAt = lic ? relative(process.cwd(), "link" in lic ? lic.link : lic.path).split(sep).join("/") : "";
  if (lic && "link" in lic) {
    if (!lic.link.startsWith(root + sep)) notes.push(`the licence at ${licAt} is a link, which a bundle never follows, so no licence is sent: put the file itself there`);
  } else if (lic) {
    const data = readFileSync(lic.path);
    files.push({ path: "LICENSE", bytes: data.length, sha256: sha(data), from: lic.path, data });
    if (!lic.spdx) notes.push(`Sprue can't tell which licence ${licAt} is: say it in the entry when you submit it`);
  } else notes.push("no LICENSE in the product's folder or the folders it is in: without one nobody may reuse the design, so add one (a gallery would ask which)");
  const sent = lic && "path" in lic ? relative(root, lic.path) : undefined;
  for (const l of licences) if (l !== sent) left.other.push(`${l} (another licence file: only one goes, as LICENSE)`);

  // Every file a bundle sends must be text (UTF-8, with no NUL, which UTF-16 has); each is scanned.
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const texts = new Map<string, string>();
  for (const f of files) {
    const shown = f.path === "LICENSE" ? licAt : f.path;
    let text: string;
    try {
      text = utf8.decode(f.data);
      if (text.includes("\0")) throw new Error("NUL");
    } catch {
      problems.push(`${shown} is not text (UTF-8): a design's sources are, so save it as UTF-8`);
      continue;
    }
    texts.set(f.path, text);
    for (const x of privacyFindings(shown, text)) problems.push(`${x.file}:${x.line}: ${x.kind} (${x.sample}): take it out`);
  }

  // Every module the sent code imports must be one the bundle sends: read from the code itself (so it holds with no
  // pcb/, which git ignores, and after an edit), and from pcb/drc.json, what the board's code imported when it ran.
  const named = new Set<string>();
  const needs = (from: string, spec: string, shown = spec) => {
    const rel = spec.startsWith("file:") ? "../" : isAbsolute(spec) ? relative(root, spec).split(sep).join("/") : posix.normalize(posix.join(posix.dirname(from || "."), spec));
    const by = from || "the board's code";
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      if (!named.has(rel)) problems.push(`${by} imports ${shown}, outside the product, which a bundle doesn't send: move it into cad/ and import it from there`);
      named.add(rel);
    } else if (![rel, ...[".mjs", ".js", ".ts", ".json"].map((x) => rel + x)].some((r) => files.some((f) => f.path === r))) {
      if (!named.has(rel)) problems.push(`${by} imports ${rel}, which a bundle doesn't send (only request.json, design.json, design.md, bom.json, figure.mjs, rules.ts and the .py, .mjs, .js, .ts and .json files in cad/ go, never through a link): move it into cad/`);
      named.add(rel);
    }
  };
  for (const [path, text] of texts) if (/\.(?:mjs|js|ts)$/.test(path)) for (const spec of importsOf(text)) needs(path, spec);
  const drc = read<{ reads?: { modules?: unknown } }>("pcb/drc.json");
  for (const m of Array.isArray(drc?.reads?.modules) ? drc.reads.modules : []) if (typeof m === "string") needs("", m, m);

  const request = read<Partial<Request>>("request.json") ?? {};
  const design = read<Partial<Design>>("design.json") ?? {};
  const bom = read<Partial<Bom>>("bom.json") ?? {};
  const lines = Array.isArray(bom.lines) ? bom.lines.filter((l): l is BomLine => !!l && typeof l === "object" && typeof l.id === "string") : [];

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = sha(files.map((f) => `${f.path}\0${f.sha256}\n`).join(""));
  const state = read<{ stage?: string; stages?: Record<string, { status?: string }> }>("state.json");
  const said: Bundle["said"] = {};
  const claimed = claims(root, lines, read, linked, said);
  const cost = costOf(root, request, { ...bom, lines } as Bom, read, linked, said);
  const word = (x: unknown) => (typeof x === "string" && /^[\w-]{1,40}$/.test(x) ? x : undefined);
  const stage = word(state?.stage), status = stage ? word(state?.stages?.[stage]?.status) : undefined;
  const entry: Entry = {
    format: 1,
    id: slug,
    title: typeof request.product === "string" ? request.product : slug,
    brief: typeof request.brief === "string" ? request.brief : "",
    ...(stage ? { stage: { stage, ...(status ? { status } : {}) } } : {}),
    licence: lic && "path" in lic ? { spdx: lic.spdx, file: "LICENSE" } : null,
    sprue: { publishedWith: `sha256:${gatesDigest()}` },
    claimed,
    ...cost,
    ...limitsAndFlags(request, design, bom),
    bundle: `sha256:${digest}`,
    files: Object.fromEntries(files.map((f) => [f.path, { bytes: f.bytes, sha256: `sha256:${f.sha256}` }])),
  };
  // What entry.json takes from the runs' records is a word or a number (the stage is a word or nothing), never their
  // text; what it copies from the sent files (the title, the brief, the limits and flags) was scanned with them. It is
  // scanned once more, in case.
  const fromRecords = JSON.stringify({ stage: entry.stage, claimed: entry.claimed, cost: entry.cost }, null, 2);
  for (const x of privacyFindings("entry.json", fromRecords))
    problems.push(`entry.json's claims, cost or stage: ${x.kind} (${x.sample}), from a run's record: report it, since entry.json should hold only words and numbers from them`);
  return { slug, files, left, entry, said, problems, notes };
}

/** Why firmware/code.py can't be published, or undefined when it is the one sprue pcb wrote for this board (by
 * pcb/board.json's sha256 of it, as firmwareShips holds it). A reason starting with "?" is a note, not a refusal:
 * sprue pcb's marker for this product is there, but with no pcb/board.json Sprue can't hold the file to it. */
function firmwareProblem(root: string, slug: string, at: string, read: <T>(file: string) => T | undefined): string | undefined {
  const data = readFileSync(at), text = data.toString("utf8");
  const sibling = isThere(join(root, "firmware", "code.sprue.py")) ? ", or copy firmware/code.sprue.py over it" : "";
  const marker = /`(?:sprue|distinta) pcb ([\w-]+)` wrote it/.exec(text)?.[1];
  const why = "hand-written firmware isn't published, since it could do anything on a builder's computer and no emulator run shows it doesn't";
  if (marker === undefined)
    return `firmware/code.py is not one sprue pcb wrote: ${why}. Move it out of the product (keep it elsewhere), then run sprue pcb ${slug} to write the board's own${sibling}`;
  if (marker !== slug)
    return `firmware/code.py says sprue pcb wrote it for ${marker}, not for ${slug}, so sprue pcb ${slug} keeps it as yours: move it out of the product, then run sprue pcb ${slug} to write this board's${sibling}`;
  const board = read<{ firmwareCode?: { file?: unknown; sha256?: unknown } | null }>("pcb/board.json");
  if (!board) return `?Sprue can't tell whether firmware/code.py is still the one sprue pcb wrote: there is no pcb/board.json to hold it to (run sprue pcb ${slug})`;
  if (board.firmwareCode?.sha256 === sha(data)) return undefined;
  return `firmware/code.py was changed after sprue pcb wrote it (its sha256 is not pcb/board.json's): ${why}. Run sprue pcb ${slug} to write it again, or move yours out of the product`;
}

/** Where a record stands, from what is there and not from its words: not run (no record, or no check to write one),
 * unreadable (not JSON, or the files it is held to can't be read), stale (what it was made from is not the files
 * now), or its own verdict. */
function stateOf(ok: boolean, root: string, file: string, inputsNow: (was: Record<string, unknown>) => Record<string, unknown>, needs: string[] = []): ClaimState {
  if (ok) return "passes";
  if (![file, ...needs].every((f) => isThere(join(root, f)))) return "not run";
  try {
    const rec = JSON.parse(readFileSync(join(root, file), "utf8")) as { inputs?: unknown };
    const was = rec && typeof rec.inputs === "object" && rec.inputs && !Array.isArray(rec.inputs) ? (rec.inputs as Record<string, unknown>) : {};
    const now = inputsNow(was);
    return [...new Set([...Object.keys(now), ...Object.keys(was)])].some((k) => now[k] !== was[k]) ? "stale" : "fails";
  } catch {
    return "unreadable";
  }
}

/** The claims, each from its record and held to the files now where Sprue can tell (system.json, faults.json and
 * pcb/verify.json; the score with them, as withSystem does). A record that is missing, or a link, is left out. Each
 * record's own words go to `said`, for the terminal, never into entry.json. */
function claims(root: string, lines: BomLine[], read: <T>(file: string) => T | undefined, linked: Set<string>, said: Bundle["said"]): Claims {
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
  if (lines.length && !linked.has("system.json") && !linked.has("cad/_system.py")) {
    const s = quiet(() => systemAudit(root, { lines } as Bom));
    if (!s) out.system = { ok: false, state: "unreadable" };
    else if (!/^nothing made/.test(s.detail)) {
      const state = quiet(() => stateOf(s.ok, root, "system.json", (was) => systemInputs(root, Object.keys(was)), ["cad/_system.py"])) ?? "unreadable";
      out.system = { ok: s.ok, state, ...(state === "fails" && s.failed?.length && s.failed.every((g) => /^[\w-]{1,40}$/.test(g)) ? { failed: s.failed } : {}) };
      said.system = s.detail;
    }
  }
  if (lines.length && !["pcb/verify.json", "pcb/drc.json"].some((r) => linked.has(r)) && lines.some((l) => quiet(() => isBoardLine(root, l)))) {
    // verified, stale (verified, but of another board than the one there is now), failed, unverified, or not yet.
    const v = quiet(() => verifyState(root)) ?? "not verified";
    out.board = { state: (BOARD_STATES.has(v) ? v : "unreadable") as BoardState };
  }
  if (!linked.has("faults.json") && !linked.has("reference/faults.json")) {
    const f = quiet(() => faultsAudit(root));
    if (f === undefined && isThere(join(root, "reference", "faults.json"))) out.faults = { ok: false, state: "unreadable" };
    else if (f) {
      // The counts are faults.json's own, when it is there and holds them as numbers.
      const rec = read<{ ran?: unknown; caught?: unknown; falseAlarms?: unknown; inputs?: Record<string, unknown> }>("faults.json");
      const n = (x: unknown) => typeof x === "number" && Number.isFinite(x);
      const gates = rec?.inputs?.["sprue:gates"];
      out.faults = {
        ok: f.ok, state: quiet(() => stateOf(f.ok, root, "faults.json", () => faultsInputs(root))) ?? "unreadable",
        ...(rec && n(rec.ran) && n(rec.caught) && n(rec.falseAlarms) ? { ran: rec.ran as number, caught: rec.caught as number, falseAlarms: rec.falseAlarms as number } : {}),
        ...(typeof gates === "string" && /^[0-9a-f]{64}$/.test(gates) ? { gates: `sha256:${gates}` } : {}),
      };
      said.faults = f.detail;
    }
  }
  const score = read<{ pass?: unknown }>("score.json");
  if (score && typeof score.pass === "boolean") {
    // Its pass as withSystem has it, with the quote it was scored on: the whole-product check, the seeded faults and
    // quotes.json as they are now. A record it rests on that is a link can't be held to anything.
    const blind = ["system.json", "cad/_system.py", "faults.json", "reference/faults.json", "quotes.json", "catalog.json", "offers.digikey.json", "bom.json"].filter((r) => linked.has(r));
    if (blind.length) {
      out.score = { pass: false, state: "unreadable" };
      said.score = `${blind.join(", ")} ${blind.length === 1 ? "is a link" : "are links"}, so score.json can't be held to the files now`;
    } else {
      const quote = quiet(() => quoteFreshness(root).problems) ?? ["quotes.json can't be held to its files"];
      const pass = score.pass && (out.system?.ok ?? true) && (out.faults?.ok ?? true) && !quote.length;
      out.score = { pass, state: pass ? "passes" : score.pass ? "stale" : "fails" };
      const not = [out.system && !out.system.ok ? "the whole product" : "", out.faults && !out.faults.ok ? "the seeded faults" : "", quote.length ? "the quote" : ""].filter(Boolean);
      if (score.pass && !pass) said.score = not.length > 1 ? `${not.slice(0, -1).join(", ")} and ${not.at(-1)}` : not[0];
    }
  }
  return out;
}

/** The order's cost, from quotes.json, said as an estimate where it is one: entry.json sends no offer or price list. */
function costOf(root: string, request: Partial<Request>, bom: Bom, read: <T>(file: string) => T | undefined, linked: Set<string>, said: Bundle["said"]): { cost?: Cost } {
  if (["quotes.json", "catalog.json", "offers.digikey.json"].some((r) => linked.has(r))) return {};
  const q = read<Partial<Quotes>>("quotes.json");
  if (!q || typeof q.batchUsd !== "number" || !Number.isFinite(q.batchUsd) || !Array.isArray(q.lines)) return {};
  const quiet = (f: () => string[], fallback: string) => {
    try {
      return f();
    } catch {
      return [fallback];
    }
  };
  let unreadable = false;
  const fresh = quiet(() => quoteFreshness(root).problems, "quotes.json can't be held to its files");
  const pricing = quiet(() => pricingProblems(root, bom), "quotes.json can't be checked against bom.json").filter((p) => !fresh.includes(p));
  if (fresh.some((p) => /can't be held|not readable|not a quote Sprue wrote/.test(p)) || pricing.some((p) => /can't be checked/.test(p))) unreadable = true;
  // When the chosen offers' prices were read, from the catalog (and the live offers) the quote picked them from.
  const offers = new Map<string, Offer[]>();
  for (const file of ["catalog.json", "offers.digikey.json"]) {
    const c = read<{ offers?: unknown }>(file);
    if (!c?.offers || typeof c.offers !== "object" || Array.isArray(c.offers)) continue;
    for (const [id, list] of Object.entries(c.offers as Record<string, unknown>)) if (Array.isArray(list)) offers.set(id, [...(offers.get(id) ?? []), ...(list as Offer[])]);
  }
  const dates = q.lines.flatMap((l) => (l && typeof l.lineId === "string" ? offers.get(l.lineId) ?? [] : []).filter((o) => o?.supplier === l.supplier && o?.sku === l.sku).map((o) => o.capturedAt))
    .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10)).sort();
  // The reason in a word; its own words (which can quote catalog.json) for the terminal only.
  const catalog = pricing.filter((p) => /^(?:catalog\.json|offers\.[\w.-]+\.json)(?::| is not readable)/.test(p));
  const why: Cost["why"] = unreadable ? "unreadable" : fresh.length ? "stale" : catalog.length ? "catalog" : pricing.length ? "incomplete" : undefined;
  if (why) said.cost = [...fresh, ...catalog, ...pricing].slice(0, 2).join("; ");
  return {
    cost: {
      batchUsd: q.batchUsd, units: typeof q.units === "number" && Number.isFinite(q.units) ? q.units : typeof request.units === "number" ? request.units : 1, region: typeof request.region === "string" ? request.region : "",
      ...(typeof request.budgetUsd === "number" ? { budgetUsd: request.budgetUsd } : {}),
      includesEstimates: q.lines.some((l) => l?.mode === "estimate"),
      ...(dates.length ? { pricesRead: { from: dates[0], to: dates.at(-1)! } } : {}),
      current: !fresh.length, complete: !pricing.length, ...(why ? { why } : {}),
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
  // A child lock or a child-resistant cap keeps children out: not a product for them.
  for (const [field, text] of [["brief", request.brief], ["product", request.product]] as const)
    if (typeof text === "string") {
      const m = /\b(?:kids?|child(?:ren)?(?:'s)?|toddlers?|bab(?:y|ies)|toys?)\b(?![\s-]*(?:lock|locks|resistant|proof|safe|safety|gate|gates)\b)/i.exec(text);
      if (m) kids.push(`request.json ${field}: "${m[0]}"`);
    }
  if (kids.length) flags.push({ kind: "children", title: "For children, its request says", found: kids });
  const rec: string[] = [];
  for (const l of Array.isArray(bom.lines) ? bom.lines : []) {
    if (!l || typeof l !== "object" || typeof l.id !== "string") continue;
    // A made part, or a screw, mount or plate, is not a camera even when it is for one.
    if (["print", "cnc", "sheet"].includes(String(l.process)) || /fastener|screw|mount|bracket|plate|case|enclosure|lid/i.test(String(l.role ?? ""))) continue;
    const mpn = l.spec && typeof l.spec === "object" ? (l.spec as { mpn?: unknown }).mpn : undefined;
    const words = [l.role, l.name, l.shortName, mpn].filter((x): x is string => typeof x === "string").join(" ");
    const m = /\b(?:cameras?|webcams?|microphones?|mics?|image sensors?|OV\d{4}\w*|[\w]+-CAM|INMP\d+\w*|SPH\d{4}\w*|ICS-\d{5}\w*|audio-in)\b/i.exec(words);
    if (m) rec.push(`bom.json line ${l.id}: "${m[0]}"`);
  }
  if (rec.length) flags.push({ kind: "recording", title: "A camera or a microphone", found: rec });
  return { ...(limits.length ? { limits } : {}), ...(flags.length ? { flags } : {}) };
}

const kB = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const STATE: Record<ClaimState, string> = { passes: "passes", fails: "doesn't pass", stale: "of other files than these", "not run": "not run", unreadable: "can't be read" };

/** The bundle as the author reads it before anything leaves their computer, then entry.json. */
export function bundleText(b: Bundle): string {
  const e = b.entry, out: string[] = [];
  out.push(`sprue publish ${b.slug}: what a gallery entry of it would hold. Print only: nothing is uploaded, and nothing is written in the product or the repo.`);
  out.push("", "The brief, as request.json has it. Read it: no scan finds a name or an address written in prose.");
  out.push(`  ${JSON.stringify(e.brief)}`);
  const md = b.files.find((f) => f.path === "design.md");
  if (md) out.push(`  Read design.md too (${kB(md.bytes)}): it is sent as it is.`);
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
  out.push("", `Claims, as this product's own runs recorded them (${e.claimed.note.replace(/^what this product's own runs say of it: /, "")}); entry.json has each as one word, and what its record says is shown here only:`);
  const c = e.claimed;
  if (c.checks) out.push(`  checks: ${c.checks.ran} run, ${c.checks.failed} failed, ${c.checks.flagged} flagged (checks.json, as sprue check last wrote it)`);
  if (c.system) out.push(`  the whole product: ${STATE[c.system.state]}${b.said.system ? `: ${b.said.system}` : ""}`);
  const BOARD: Record<BoardState, string> = { verified: "verified (pcb/verify.json)", stale: "verified once, but not the board as it is now: run sprue verify",
    "not verified": "not verified yet: run sprue verify", failed: "failed sprue verify (pcb/verify.json)", unverified: "not verified: sprue verify could not run every layer (pcb/verify.json)",
    unreadable: "pcb/verify.json can't be read: run sprue verify" };
  if (c.board) out.push(`  the board: ${BOARD[c.board.state]}`);
  if (c.faults) {
    const f = c.faults, counts = f.ran !== undefined ? `${f.caught} of ${f.ran} caught, ${f.falseAlarms} false alarm${f.falseAlarms === 1 ? "" : "s"}` : "";
    out.push(`  seeded faults: ${f.ok ? counts : `${STATE[f.state]}: ${b.said.faults ?? (counts || "faults.json")}`}`);
  }
  if (c.score) out.push(`  score: ${c.score.state === "passes" ? "PASS (score.json)" : c.score.state === "stale" ? `score.json says PASS, but not of ${b.said.score ?? "the files"} as ${/ and |faults/.test(b.said.score ?? "") ? "they are" : "it is"} now: run sprue all` : c.score.state === "unreadable" ? `score.json can't be held to the files now: ${b.said.score}` : "not passing (score.json)"}`);
  if (!c.checks && !c.system && !c.board && !c.faults && !c.score) out.push("  none yet: no run has recorded a check");
  if (e.cost) {
    const k = e.cost, whole = k.current && k.complete;
    out.push(`  cost: ${usd(k.batchUsd)} for ${k.units} unit${k.units === 1 ? "" : "s"}${k.region ? ` (${k.region})` : ""}` +
      `${k.budgetUsd !== undefined && whole ? `, ${k.batchUsd > k.budgetUsd ? "over" : "within"} the ${usd(k.budgetUsd)} budget` : ""}` +
      `${k.includesEstimates ? "; some prices are estimates" : ""}${k.pricesRead ? `; prices read ${k.pricesRead.from === k.pricesRead.to ? k.pricesRead.from : `${k.pricesRead.from} to ${k.pricesRead.to}`}` : ""}` +
      `${!k.current ? `; not of the files now: ${b.said.cost}` : !k.complete ? `; not the whole order: ${b.said.cost}` : ""}`);
  }
  for (const l of e.limits ?? []) out.push(`⚑ out of Sprue's reach: ${l.title} (${l.found.slice(0, 2).join("; ")})`);
  for (const f of e.flags ?? [])
    out.push(`⚑ ${f.title} (${f.found.slice(0, 2).join("; ")}): ${f.kind === "children" ? "a gallery decides whether to list a children's product, and its page says it is one" : "it can record people, so a gallery decides whether to list it, and its page says where the recordings go"}`);
  out.push("", e.licence ? `Licence: ${e.licence.spdx ?? "one Sprue can't name"}, sent as LICENSE.` : "Licence: none found.");
  for (const n of b.notes) out.push(`⚑ ${n}`);
  out.push("", "entry.json:", JSON.stringify(e, null, 2));
  return out.join("\n");
}

/** Where `--out` may not write: in the product, the products folder, Sprue's own folder, any git work tree (the one
 * the folder itself would be in, or the product's, the skill's, or that of the folder Sprue runs in), or under a file.
 * The reason, or undefined. */
export function outProblem(out: string, { product, skill, cwd = process.cwd() }: { product: string; skill: string; cwd?: string }): string | undefined {
  const at = realPath(resolve(cwd, out));
  const inside = (a: string, b: string) => {
    const r = relative(b, a);
    return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
  };
  const real = (p: string) => realPath(resolve(p));
  // The nearest folder on the way to it that is there: it must be a folder, and in no git work tree.
  let there = at;
  while (!isThere(there) && dirname(there) !== there) there = dirname(there);
  const places: [string, string][] = [[real(product), "the product's folder"], [real(join(cwd, "products")), "products/"], [real(skill), "Sprue's own folder"]];
  for (const p of [real(product), real(cwd), real(skill), there]) { const top = gitTop(p); if (top) places.push([top, `the git work tree at ${top}`]); }
  for (const [p, what] of places) if (inside(at, p)) return `--out ${out} is in ${what}: a bundle is written outside it, so nothing is added to the product or a repo (try a folder in /tmp)`;
  try {
    const st = statSync(there);
    if (there !== at && !st.isDirectory()) return `--out ${out} is under a file (${there}): name a new or empty folder`;
    if (there === at && !st.isDirectory()) return `--out ${out} is a file: name a new or empty folder`;
    if (there === at && readdirSync(at).length) return `--out ${out} is not empty: name a new or empty folder, so no file of yours is written over`;
  } catch {
    return `--out ${out} can't be read: name a new or empty folder`;
  }
  return undefined;
}

/** Writes the bundle's files, as they were read and scanned, and entry.json to `out` (outProblem said yes). The paths
 * it wrote. */
export function writeBundle(b: Bundle, out: string): string[] {
  const at = resolve(out), wrote: string[] = [];
  for (const f of b.files) {
    if (sha(f.data) !== f.sha256) throw new Error(`${f.path} changed while it was read: run sprue publish again`);
    mkdirSync(dirname(join(at, f.path)), { recursive: true });
    writeFileSync(join(at, f.path), f.data);
    wrote.push(f.path);
  }
  writeFileSync(join(at, "entry.json"), JSON.stringify(b.entry, null, 2) + "\n");
  wrote.push("entry.json");
  return wrote;
}
