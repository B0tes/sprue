// What Sprue can't check: mains power inside the product, batteries, soft goods and made metal parts (the limits
// audit, research/sprue-limits-2026-10-20.md, (a)). No rule in the pipeline or the CAD covers them, so a run that
// reaches every gate with one of them in it looks complete when nothing has checked that part of it. This finds
// them in the user's words (request.json), the design's (design.json's summary, architecture and param names) and
// the parts list (bom.json), and says so as a plain flag: up front at `sprue new`, then with the checks, at the
// design gate (`sprue figure`, the page's "Before you accept"), and in `sprue status`. It is never a check, so a
// rules.ts can't replace or turn it off, and never a failure: the user decides, knowing.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { productDir } from "./io.ts";
import type { Bom, BomLine, Design, Request } from "./types.ts";

export type LimitKind = "mains" | "battery" | "soft" | "metal";
/** One kind of thing Sprue can't check, with where it was found (a file and field, and the words there). */
export type Limit = { kind: LimitKind; title: string; detail: string; found: string[] };

export const LIMITS: Record<LimitKind, { title: string; detail: string }> = {
  mains: {
    title: "Mains power",
    detail: "Sprue has no rule for mains voltage: no creepage or clearance, insulation, earthing, fuse or certification " +
      "(UL, CE's low-voltage directive). Keep mains outside the product with a bought, certified plug-in supply, as " +
      "Ponder does, or have a qualified person design and certify the mains side.",
  },
  battery: {
    title: "Batteries",
    detail: "Sprue has no battery rule: no charger or protection circuit, runtime or heat, nothing on a lithium cell's " +
      "fire risk, and nothing on the rules for shipping one (UN 38.3). Use a bought, certified pack with its own " +
      "protection and charger, and have the battery side checked by someone qualified.",
  },
  soft: {
    title: "Soft goods",
    detail: "Sprue has no process for soft goods: nothing here draws a pattern, picks a fabric, foam or leather, or " +
      "finds a maker who sews, and no check reads one. A bought soft part (a strap, a pad) is bought like any other; " +
      "one made for this product needs a pattern maker.",
  },
  metal: {
    title: "Made metal parts",
    detail: "Sprue can't price or check a made metal part: no shop here prices a CNC or sheet-metal line (an unpriced " +
      "line stops the source gate) and no rule reads bends, tool reach or tolerances; metal printing has none either. " +
      "Buy the part, print it in plastic, or get a shop's quote by hand.",
  },
};

/** The words that name each kind, in the request's, the design's and the parts list's text. A metal part made for
 * the product is found by its line's process too (`madeMetal`); a bought metal part is fine, so the BOM's words
 * aren't read for it, and neither is a part number ("CNC Kitchen" makes inserts). */
const WORDS: Record<LimitKind, RegExp[]> = {
  mains: [
    /\bmains\b/i,
    /\b(?:line|household|grid)[- ]voltage\b/i,
    /\b(?:100|110|115|120|127|200|208|220|230|240|250|277)\s?(?:v|volts?)\b/i,
    /\b[1-4]\d\d\s?v\s?ac\b|\b[1-4]\d\dvac\b/i,
    /\bac\s?(?:-|\/|to)\s?dc\b/i,
    /\bac[- ](?:powered|power|mains|inlet|cord|plug|outlet|line)\b/i,
    /\biec(?:[- ]?60320)?(?:[- ]?c\d{1,2})?\s(?:inlet|socket|connector|cord|lead|cable)\b/i,
    /\bc(?:5|6|7|8|13|14|19|20)\s(?:inlet|socket|connector|cord|lead|plug)\b/i,
    /\bpower (?:cord|lead)\b/i,
    /\b(?:wall|ac|electrical|mains) (?:outlet|socket|receptacle)\b/i,
    /\bplugs? (?:straight |directly )?in(?:to)? (?:the |a )?(?:wall|mains|outlet)\b/i,
    /\b(?:schuko|nema ?\d{1,2}-\d{2}|bs ?1363)\b/i,
    /\b(?:e26|e27|e14|gu10|b22) (?:bulb|lamp|socket|holder|base)\b/i,
    /\b(?:triac|solid[- ]state relay)\b/i,
    /\b(?:mains|isolation|step[- ]down) transformer\b/i,
  ],
  battery: [
    /\bbatter(?:y|ies)\b/i,
    /\blithium\b/i,
    /\bli[- ]?ion\b/i,
    /\bli[- ]?po(?:ly(?:mer)?)?\b/i,
    /\blifepo4?\b/i,
    /\b(?:nimh|ni[- ]?cd)\b/i,
    /\b(?:10440|14500|16340|18650|21700|26650|32650)\b/,
    /\b(?:cr|lir|ml)\s?(?:927|1025|1216|1220|1225|1616|1620|1632|2016|2025|2032|2430|2450|2477)\b/i,
    /\bcr123a?\b/i,
    /\b(?:coin|button) cells?\b/i,
    /\bpower ?banks?\b/i,
    /\b(?:tp4056|mcp7383\d|bq2[45]\d{3}\w*|ip5306|max1704\d|lc709203)\b/i,
  ],
  soft: [
    /\b(?:fabric|textiles?|cloth|canvas|denim|leather|suede|neoprene|webbing|velcro|plush|felted|knit(?:ted)?|quilt(?:ed|ing)?)\b/i,
    /\bupholster(?:y|ed)\b/i,
    /\bhook[- ]and[- ]loop\b/i,
    /\b(?:sewn|sewing|stitch(?:ed|ing|es)?)\b/i,
    /\b(?:cushion(?:s|ed)?|padded|padding|stuffed|stuffing)\b/i,
    /\bfoam (?:padding|cushion|lining|insert|liner)\b/i,
    /\b(?:shoulder|wrist|chin|head|watch|carry(?:ing)?) straps?\b/i,
  ],
  metal: [
    /\bcnc(?! kitchen)(?:[- ]?(?:machined|milled|cut|routed))?\b/i,
    /\b(?:machined|milled|turned) (?:aluminium|aluminum|steel|stainless|brass|bronze|copper|titanium|metal)\b/i,
    /\bsheet[- ]metal\b/i,
    /\b(?:bent|folded|stamped|punched|laser[- ]cut|water[- ]?jet(?:[- ]cut)?|plasma[- ]cut) (?:aluminium|aluminum|steel|stainless|brass|copper|metal|sheet)\b/i,
    /\b(?:welded|welding|brazed|brazing)\b/i,
    /\b(?:die|investment|sand)[- ]cast(?:ing)?\b/i,
    /\bcast (?:aluminium|aluminum|iron|zinc|bronze|brass|metal|steel)\b/i,
    /\b(?:forged|forging)\b/i,
    /\bmetal (?:3d[- ])?print(?:ed|ing)?\b/i,
    /\b(?:slm|dmls|lpbf)\b/i,
  ],
};

/** A metal, or a way of printing one, in a printed line's material or process. */
const METAL = /\b(?:aluminium|aluminum|alsi10mg|steel|stainless|316l|17-4\s?ph|titanium|ti-?6al-?4v|inconel|brass|bronze|copper|maraging|cobalt[- ]chrome|slm|dmls|lpbf|metal)\b/i;

/** A bought supply that plugs into the wall: it keeps mains outside the product (the safe way), so its own words
 * ("100-240 V AC in") are not mains in the product. One built in (a module, an open frame) is. */
const PLUG_IN = /\b(?:power supply|psu|power adapter|adapter|charger|wall (?:supply|adapter|wart|plug)|plug[- ]in supply|power brick)\b/i;
const BUILT_IN = /\b(?:open[- ]frame|module|board|internal|din[- ]rail|built[- ]in|pcb[- ]mount|enclosed|chassis)\b/i;

/** A word that says the thing is not there ("no battery in this version", "without mains", "battery-free"). */
const NOT = /\b(?:no|not|without|never|nor|none|non|avoids?|avoiding|instead of|rather than|free of|excluding)\b|n't\b/i;
/** The same, said after the words: "battery-free", "Batteries: none". */
const NOT_AFTER = /^(?:[- ]?free\b|\s*[:=]\s*(?:none|no|nil|n\/a|0)\b)/i;
const CLAUSE = /[.;,!?()\n]|\b(?:but|however|although|though|except|while|whereas)\b/i;

type Text = { where: string; text: string };

/** Whether the words at `at` in `text` are said not to be there, within their clause. */
function negated(text: string, at: number, length: number): boolean {
  let start = 0;
  for (const m of text.slice(0, at).matchAll(new RegExp(CLAUSE.source, "gi"))) start = m.index + m[0].length;
  return NOT.test(text.slice(start, at)) || NOT_AFTER.test(text.slice(at + length));
}

/** The words around a match, for the user to see what was read. */
function excerpt(text: string, at: number, length: number): string {
  let from = Math.max(0, at - 30), to = Math.min(text.length, at + length + 30);
  // Whole words: in to the next space on each side, unless that is the match itself.
  if (from > 0) from = Math.min(at, text.slice(from).search(/\s/) < 0 ? at : from + text.slice(from).search(/\s/) + 1);
  if (to < text.length) { const sp = text.slice(at + length, to).lastIndexOf(" "); to = sp < 0 ? at + length : at + length + sp; }
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/** Every place in `texts` where a word of `kind` is said to be there, each with its first such word. */
function findIn(kind: LimitKind, texts: Text[]): string[] {
  const found: string[] = [];
  for (const { where, text } of texts) {
    const hits = WORDS[kind].flatMap((re) => [...text.matchAll(new RegExp(re.source, `${re.flags}g`))])
      .filter((x) => !negated(text, x.index, x[0].length));
    const first = hits.sort((a, b) => a.index - b.index)[0];
    if (first) found.push(`${where}: "${excerpt(text, first.index, first[0].length)}"`);
  }
  return found;
}

/** A param or constraint name in words ("mainsFuseA" → "mains Fuse A"), so its words can be read. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");

/** Whether a constraint's value says it isn't there at all ("battery": false, "none", "no"). */
const absent = (v: unknown) => v === false || v === 0 || v === null || (typeof v === "string" && /^\s*(?:none|no|n\/a|-|)\s*$/i.test(v));

function requestTexts(r: Partial<Request> | undefined): Text[] {
  if (!r) return [];
  const t: Text[] = [];
  const add = (where: string, v: unknown) => typeof v === "string" && v && t.push({ where, text: v });
  add("request.json brief", r.brief);
  add("request.json product", r.product);
  (Array.isArray(r.mustHave) ? r.mustHave : []).forEach((v, i) => add(`request.json mustHave[${i}]`, v));
  (Array.isArray(r.niceToHave) ? r.niceToHave : []).forEach((v, i) => add(`request.json niceToHave[${i}]`, v));
  for (const [k, v] of Object.entries(r.constraints && typeof r.constraints === "object" ? r.constraints : {}))
    if (!absent(v)) add(`request.json constraints.${k}`, v === true ? words(k) : `${words(k)}: ${String(v)}`);
  return t;
}

function designTexts(d: Partial<Design> | undefined): Text[] {
  if (!d) return [];
  const t: Text[] = [];
  if (typeof d.summary === "string" && d.summary) t.push({ where: "design.json summary", text: d.summary });
  (Array.isArray(d.architecture) ? d.architecture : []).forEach((v, i) => typeof v === "string" && t.push({ where: `design.json architecture[${i}]`, text: v }));
  for (const k of Object.keys(d.params && typeof d.params === "object" ? d.params : {})) t.push({ where: `design.json params.${k}`, text: words(k) });
  return t;
}

/** A line's own words: its name, short name, role and spec (not its notes, which say what it isn't as often as what
 * it is, nor its part numbers). */
function lineTexts(l: BomLine): Text[] {
  const t: Text[] = [];
  const add = (field: string, v: unknown) => (typeof v === "string" || typeof v === "number") && String(v) && t.push({ where: `bom.json line ${l.id} ${field}`, text: String(v) });
  add("name", l.name);
  add("shortName", l.shortName);
  add("role", l.role);
  for (const [k, v] of Object.entries(l.spec && typeof l.spec === "object" ? l.spec : {})) add(`spec.${k}`, `${words(k)}: ${v}`);
  return t;
}

const plugIn = (l: BomLine) => l.process === "buy" && [l.name, l.shortName, l.role].some((s) => typeof s === "string" && PLUG_IN.test(s))
  && ![l.name, l.shortName, l.role].some((s) => typeof s === "string" && BUILT_IN.test(s));

/** A line made of metal for this product: machined, sheet metal, or printed in a metal. */
function madeMetal(l: BomLine): string | undefined {
  if (l.process === "cnc") return `bom.json line ${l.id}: made by CNC (process "cnc")`;
  if (l.process === "sheet") return `bom.json line ${l.id}: made from sheet metal (process "sheet")`;
  if (l.process === "print") {
    const said = ["material", "process"].map((k) => l.spec?.[k]).find((v) => typeof v === "string" && METAL.test(v));
    if (said) return `bom.json line ${l.id}: printed in ${String(said)}`;
  }
  return undefined;
}

/** What in this request, design and parts list Sprue can't check, each kind once, in a fixed order. Any of the three
 * may be missing (the request alone at `sprue new`). */
export function limitsOf({ request, design, bom }: { request?: Partial<Request>; design?: Partial<Design>; bom?: Partial<Bom> }): Limit[] {
  const lines = Array.isArray(bom?.lines) ? bom.lines.filter((l): l is BomLine => !!l && typeof l === "object" && typeof l.id === "string") : [];
  const prose = [...requestTexts(request), ...designTexts(design)];
  const found: Record<LimitKind, string[]> = {
    mains: findIn("mains", [...prose, ...lines.filter((l) => !plugIn(l)).flatMap(lineTexts)]),
    battery: findIn("battery", [...prose, ...lines.flatMap(lineTexts)]),
    soft: findIn("soft", [...prose, ...lines.flatMap(lineTexts)]),
    metal: [...lines.map(madeMetal).filter((x): x is string => !!x), ...findIn("metal", prose)],
  };
  return (Object.keys(LIMITS) as LimitKind[]).filter((k) => found[k].length).map((kind) => ({ kind, ...LIMITS[kind], found: found[kind] }));
}

/** limitsOf a product's files as they are; a file that is missing or not readable JSON is left out. */
export function limitsIn(slug: string): Limit[] {
  const read = <T,>(file: string): T | undefined => {
    const path = join(productDir(slug), file);
    try {
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : undefined;
    } catch {
      return undefined;
    }
  };
  const obj = <T,>(v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as T : undefined);
  return limitsOf({ request: obj(read("request.json")), design: obj(read("design.json")), bom: obj(read("bom.json")) });
}

/** The lines that say it: one for each kind, its words and where they are (the first two places, and how many more). */
export function limitLines(limits: Limit[]): string[] {
  return limits.map((l) => `⚑ out of Sprue's reach: ${l.title}. ${l.detail} Found in ${l.found.slice(0, 2).join("; ")}` +
    `${l.found.length > 2 ? `; and ${l.found.length - 2} more place${l.found.length - 2 === 1 ? "" : "s"}` : ""}.`);
}
