// What Sprue can't check: mains power inside the product, batteries, soft goods and made metal parts (the limits
// audit, research/sprue-limits-2026-10-20.md, (a)). No rule in the pipeline or the CAD covers them, so a run that
// reaches every gate with one of them in it looks complete when nothing has checked that part of it. This finds
// them in the user's words (request.json), the design's (design.json's summary, architecture and param names) and
// the parts list (bom.json), and says so as a plain flag: up front at `sprue new`, then with the checks, at the
// design gate (`sprue figure`, `sprue accept`, the page's "Before you accept"), and in `sprue status`. It is never a
// check, so a rules.ts can't replace or turn it off, and never a failure: the user decides, knowing.
//
// It reads words, so it is a net, not a proof: it can miss one said another way, and it can read a word out of
// context. The words below are chosen against both, and limits.test.ts holds each choice to an example.

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
      "(UL, CE's low-voltage directive). Keep mains outside the product with a bought, certified plug-in (wall) supply, " +
      "as Ponder does, or have a qualified person design and certify the mains side.",
  },
  battery: {
    title: "Batteries",
    detail: "Sprue has no battery rule: no charger or protection circuit, runtime or heat, nothing on a lithium cell's " +
      "fire risk, and nothing on the rules for shipping one (UN 38.3). A rechargeable cell should be a bought, certified " +
      "pack with its own protection and charger. A coin or other single-use cell is never charged, and goes in a holder " +
      "behind a lid that takes a tool to open, since a swallowed coin cell can kill a child (the US requires this, " +
      "16 CFR 1263). Have the battery side checked by someone qualified.",
  },
  soft: {
    title: "Soft goods",
    detail: "Sprue has no process for soft goods: nothing here draws a pattern, picks a fabric, foam or leather, or " +
      "finds a maker who sews, and no check reads one. A bought soft part (a strap, a pad) is bought like any other; " +
      "one made for this product needs a pattern maker.",
  },
  metal: {
    title: "Made metal parts",
    detail: "Sprue can't price or check a metal part made for the product: no shop here prices a CNC or sheet-metal " +
      "line, so it stays unpriced and stops the source gate, no shop here prints in metal, and no rule reads bends, " +
      "tool reach or tolerances. Buy the part (a shop's quote goes in as a bought line, with its offer in " +
      "catalog.json) or print it in plastic.",
  },
};

/** A word that names a kind. `supply`: a voltage, read in the request's and the design's words, but in the parts list
 * only on a supply's line or a spec field that gives a line's input or supply (a switch's, a fuse's or a capacitor's
 * "250 V" is its rating, not mains in the product). `plugIn`: dropped where its sentence names a plug-in supply that
 * keeps mains outside ("a 5 V charger that plugs into the wall"). `unless`: dropped where its clause has this, and
 * `unlessSentence` where its sentence has this. */
type Word = { re: RegExp; supply?: boolean; plugIn?: boolean; unless?: RegExp; unlessSentence?: RegExp };

const METALS = "aluminium|aluminum|steel|stainless|brass|bronze|copper|titanium|iron|zinc|metal";
/** A metal, or a way of printing one, in a printed line's material or process. */
const METAL = /\b(?:aluminium|aluminum|alsi10mg|steel|stainless|316l|17-4\s?ph|titanium|ti-?6al-?4v|inconel|brass|bronze|copper|maraging|cobalt[- ]chrome|slm|dmls|lpbf|metal)\b/i;
/** A plastic, or a filament that only looks like or holds some metal ("Copper-filled PLA", "PLA Metal", "silk copper"). */
const PLASTIC = /\b(?:pla|petg|pet|abs|asa|tpu|pc|pa\d*|nylon|resin|pp|hips|filled|silk|look|colou?r(?:ed)?)\b/i;

const WORDS: Record<LimitKind, Word[]> = {
  mains: [
    { re: /\bmains\b(?![- ](?:adapter|charger))/i, plugIn: true },
    { re: /\b(?:line|household|grid)[- ]voltage\b/i, plugIn: true },
    { re: /\b(?:100|110|115|120|127|200|208|220|230|240|250|277)\s?(?:v|volts?)\b/i, supply: true, plugIn: true },
    { re: /\b[1-4]\d\d\s?v\s?ac\b|\b[1-4]\d\dvac\b/i, supply: true, plugIn: true },
    { re: /\bac\s?(?:-|\/|to)\s?dc\b/i, plugIn: true },
    { re: /\bac[- ](?:powered|power|mains|inlet|cord|plug|outlet|line)\b/i, plugIn: true },
    { re: /\bruns? (?:on|off|from) ac\b/i, plugIn: true },
    { re: /\b(?:iec(?:[- ]?60320)?(?:[- ]?c\d{1,2})?|c(?:6|8|14|20))\s(?:inlet|socket|connector)\b/i },
    { re: /\b(?:iec(?:[- ]?60320)?(?:[- ]?c\d{1,2})?|c(?:5|7|13|19))\s(?:cord|lead|cable|plug)\b/i, plugIn: true },
    { re: /(?<!\b(?:usb(?:[- ]?c)?|dc|barrel)[- ])\bpower (?:cord|lead)\b/i, plugIn: true },
    { re: /\b(?:wall|ac|electrical|mains) (?:outlet|socket|receptacle)\b/i, plugIn: true },
    { re: /\bplug(?:s|ged|ging)? (?:straight |directly )?in(?:to)? (?:the |a )?(?:wall|mains|outlet)\b/i, plugIn: true },
    { re: /\b(?:schuko|nema ?\d{1,2}-\d{2}|bs ?1363)\b/i, plugIn: true },
    { re: /\b(?:e26|e27|e14|gu10|b22) (?:bulb|lamp|socket|holder|base)\b|\bedison (?:bulb|lamp|socket)\b/i },
    { re: /\b(?:triac|solid[- ]state relay)\b/i },
    { re: /\b(?:mains|isolation|step[- ]down) transformer\b/i },
    { re: /\b(?:smart plug|power strip|extension (?:lead|cord)|toaster|kettle|space heater|hair ?dryer|hard[- ]?wired|ceiling (?:light|lamp|fixture))\b/i },
  ],
  battery: [
    { re: /\bbatter(?:y|ies)\b/i },
    { re: /\blithium\b(?!\s+grease)/i },
    { re: /\bli[- ]?ion\b/i },
    { re: /\bli[- ]?po(?:ly(?:mer)?)?\b/i },
    { re: /\blifepo4?\b/i },
    { re: /\b(?:nimh|ni[- ]?cd)\b/i },
    { re: /\b(?:10440|14500|16340|18650|21700|26650|32650)\b/ },
    { re: /\b(?:cr|lir|ml)\s?(?:927|1025|1216|1220|1225|1616|1620|1632|2016|2025|2032|2430|2450|2477)\b/i },
    { re: /\bcr123a?\b/i },
    { re: /\b(?:coin|button) cells?\b/i },
    { re: /\b(?:\d\s?x\s?)?aaa?\s(?:cells?|alkalines?)\b|\b\d\s?x\s?aaa?\b/i },
    { re: /\bpower ?banks?\b/i },
    { re: /\b(?:rechargeable|cordless)\b/i },
    { re: /\b(?:tp4056|mcp7383\d|bq2[45]\d{3}\w*|ip5306|max1704\d|lc709203)\b/i },
  ],
  soft: [
    { re: /\b(?:fabric|textiles?|cloth|denim|suede|neoprene|webbing|velcro|plush|felted|knit(?:ted)?|quilt(?:ed|ing)?)\b/i },
    // Not a crafter's tools, or a painting: "a rack for my leather-working tools", "a hanger for a canvas painting".
    { re: /\b(?:leather|canvas|sew|sewing|sewn)\b(?![- ](?:tools?|machines?|thread|spools?|working|worker|work|painting|prints?|needles?|patterns?|kits?|punch(?:es)?|stamps?))/i },
    { re: /\bupholster(?:y|ed)\b/i },
    { re: /\bhook[- ]and[- ]loop\b/i },
    // Not a board's via stitching.
    { re: /(?<!\bvia[- ])\bstitch(?:ed|ing|es)?\b(?![- ]vias?\b)/i },
    { re: /\b(?:padded|stuffed|stuffing)\b|\b(?:seat|ear|foam|fabric|pillow) cushions?\b|\bcushioned (?:seat|strap|lid|case|base|pad|cover)\b/i },
    { re: /\bfoam[- ]lined\b|\b(?:memory|eva) foam\b|\bfoam (?:padding|cushion|lining|insert|liner|pad|sheet|layer|cover|block)\b/i },
    { re: /\b(?:shoulder|wrist|chin|head|watch|carry(?:ing)?|camera|neck|guitar|bag|luggage|chest|hand|waist|backpack) straps?\b/i },
    { re: /\b(?:backpack|rucksack|tote(?: bag)?|duffel|duffle|lanyard|wristband|beanie|pillow|gloves?)\b(?![- ](?:box|compartment))|\bpouch(?:es)?\b(?![- ]cells?)|\b(?:dog|cat|pet) collar\b|\bfelt (?:base|lining|liner|cover)\b/i },
  ],
  metal: [
    // A made part, not the machine: not "a pendant for my CNC mill", "a tray I cut on my CNC router", or wood.
    {
      re: /\bcnc\b(?![- ](?:kitchen|routers?|mills?|machines?|pendants?|controllers?|jog|lathes?|shield|plotters?|software|g-?code)\b)/i,
      unless: /\b(?:wood|wooden|plywood|mdf|acrylic|walnut|oak|maple|birch|bamboo|hdpe|delrin|pom|foam|plastic)\b/i,
      unlessSentence: /\b(?:my|our|your)\b[^.;!?]*\bcnc\b/i,
    },
    { re: new RegExp(`\\b(?:machined|milled|turned) (?:${METALS})\\b`, "i") },
    { re: new RegExp(`\\b(?:milled|machined|turned|bent|folded|cut) (?:from|out of) (?:an? |solid |[\\d.]+ ?mm )?(?:billet|solid|${METALS}|sheet[- ]metal)\\b`, "i") },
    { re: /\bsheet[- ]metal\b/i },
    { re: new RegExp(`\\bsheet[- ](?:${METALS})\\b|\\b(?:${METALS}) sheet\\b`, "i") },
    { re: new RegExp(`\\b(?:bent|folded|stamped|punched|laser[- ]cut|water[- ]?jet(?:[- ]cut)?|plasma[- ]cut) (?:${METALS})\\b|\\blaser[- ]cut and (?:bent|folded)\\b`, "i") },
    { re: /\b(?:welded|welding|brazed|brazing)\b(?![- ](?:helmets?|rods?|wire|torch(?:es)?|magnets?|tables?|carts?|gloves?|clamps?))/i },
    { re: /\b(?:die|investment|sand)[- ]cast(?:ing)?\b/i },
    { re: /\bcast (?:aluminium|aluminum|iron|zinc|bronze|brass|metal|steel)\b/i },
    { re: /\b(?:forged|forging)\b/i },
    { re: /\bmetal (?:3d[- ])?print(?:ed|ing)?\b/i },
    { re: /\b(?:slm|dmls|lpbf)\b/i },
  ],
};

/** A bought supply that says it plugs into the wall: it keeps mains outside the product (the safe way), so its own
 * words ("100-240 V AC in") are not mains in the product. One built in (a module, an open frame, screw terminals) is,
 * and so is a supply that doesn't say it plugs in: put `plug` in its spec, or say wall adapter or charger in its name. */
const PLUG_IN = /\b(?:wall[- ]?(?:adapter|supply|wart|plug|charger)|plug[- ]in(?: supply| adapter)?|power brick|(?:phone|laptop|desktop) (?:charger|adapter|power[- ]supply|supply)|\busb(?:[- ]?c)?\b[^,;.]*?\b(?:power[- ]supply|supply|charger|adapter)|(?:ac|mains|power) adapter|adapter|charger)\b/i;
const BUILT_IN = /\b(?:open[- ]frame|modules?|board|internal|inside|din[- ]rail|built[- ]in|pcb[- ]mount(?:ed)?|enclosed|chassis|screw[- ]terminals?|on[- ]board|panel[- ]mount(?:ed)?)\b/i;
/** A line that is a supply or names one, whose voltages are its input. */
const SUPPLY_LINE = /\b(?:power[- ]?supply|psu|supply|adapter|charger|converter|ac[- ]?dc|transformer|smps)\b/i;
/** A spec field that gives a line's input or supply. */
const SUPPLY_KEY = /\b(?:input|supply|mains|vin|line|ac)\b/i;

/** A word that says the thing is not there, right before it: "no battery", "without a battery", "not a CNC part",
 * "instead of mains", "doesn't need a battery". Only the word it governs, with at most one word and articles between: "a speaker with no
 * buttons and a LiPo" has one, and so does "a non-rechargeable CR2032" and a "No-name LiPo". */
const NOT = /(?:\b(?:no|not|without|never|nor|excluding|avoids?|avoiding)|n't|\b(?:instead|rather) (?:of|than)|\bfree of)(?:\s+(?:a|an|any|the|its))?(?:\s+[\w'-]+)?(?:\s+(?:a|an|any|the|its))?\s+$/i;
/** The same, said after the words: "battery-free", "battery-less", "Batteries: none". */
const NOT_AFTER = /^(?:[- ]?(?:free|less)\b|\s*[:=]\s*(?:none|no|nil|n\/a|0|false|not (?:needed|required|used|wanted|allowed)|avoid(?:ed)?)\b)/i;
/** Where a clause ends: a negation before it governs nothing after it. */
const CLAUSE = /[.;,!?()\n]|->|→|\b(?:but|however|although|though|except|while|whereas|and|with|that|which)\b/gi;
/** Where a sentence ends: a plug-in supply in it keeps the mains it names outside. */
const SENTENCE = /[.;!?\n]/g;

type Text = { where: string; text: string; supply: boolean };

/** Where the run of text holding `at` starts, after the last `breaks` before it. */
function startOf(text: string, at: number, breaks: RegExp): number {
  let start = 0;
  for (const m of text.slice(0, at).matchAll(new RegExp(breaks.source, "gi"))) start = m.index + m[0].length;
  return start;
}
/** And where it ends. */
function endOf(text: string, at: number, breaks: RegExp): number {
  const m = new RegExp(breaks.source, "i").exec(text.slice(at));
  return m ? at + m.index : text.length;
}

/** Whether the words at `at` in `text` are said not to be there. */
function negated(text: string, at: number, length: number): boolean {
  return NOT.test(text.slice(startOf(text, at, CLAUSE), at)) || NOT_AFTER.test(text.slice(at + length));
}

/** Whether the sentence holding `at` names a plug-in supply (not said not to be there, nor built in). */
function plugInSentence(text: string, at: number): boolean {
  const sentence = text.slice(startOf(text, at, SENTENCE), endOf(text, at, SENTENCE));
  if (BUILT_IN.test(sentence)) return false;
  return [...sentence.matchAll(new RegExp(PLUG_IN.source, "gi"))].some((m) => !negated(sentence, m.index, m[0].length));
}

/** The words around a match, for the user to see what was read. */
function excerpt(text: string, at: number, length: number): string {
  let from = Math.max(0, at - 30), to = Math.min(text.length, at + length + 30);
  // Whole words: in to the next space on each side, unless that is the match itself.
  if (from > 0) {
    const sp = text.slice(from, at).search(/\s/);
    from = sp < 0 ? at : from + sp + 1;
  }
  if (to < text.length) {
    const sp = text.slice(at + length, to).lastIndexOf(" ");
    to = sp < 0 ? at + length : at + length + sp;
  }
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/** Every place in `texts` where a word of `kind` is said to be there, each with its first such word. */
function findIn(kind: LimitKind, texts: Text[]): string[] {
  const found: string[] = [];
  for (const { where, text, supply } of texts) {
    const hits = WORDS[kind].filter((w) => supply || !w.supply).flatMap((w) =>
      [...text.matchAll(new RegExp(w.re.source, `${w.re.flags.replace("g", "")}g`))].filter((m) =>
        !negated(text, m.index, m[0].length) &&
        !(w.plugIn && plugInSentence(text, m.index)) &&
        !(w.unless && w.unless.test(text.slice(startOf(text, m.index, CLAUSE), endOf(text, m.index + m[0].length, CLAUSE)))) &&
        !(w.unlessSentence && w.unlessSentence.test(text.slice(startOf(text, m.index, SENTENCE), endOf(text, m.index + m[0].length, SENTENCE))))));
    const first = hits.sort((a, b) => a.index - b.index)[0];
    if (first) found.push(`${where}: "${excerpt(text, first.index, first[0].length)}"`);
  }
  return found;
}

/** A param or constraint name in words ("mainsFuseA" → "mains Fuse A"), so its words can be read. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
/** A field's name and value as words: a string as it is, a number only where the name says it is a voltage (a
 * budget of 21700 is not a cell), anything else by its name alone. */
function field(name: string, v: unknown): string {
  if (typeof v === "string") return `${words(name)}: ${v}`;
  if (typeof v === "number" && /volt|[a-z0-9]V(?:ac|dc)?$|^v(?:in|ac)?$/i.test(name)) return `${words(name)}: ${v} V`;
  return words(name);
}

/** Whether a constraint's value says it isn't there at all ("battery": false, "none", "not required"). */
const absent = (v: unknown) => v === false || v === 0 || v === null ||
  (typeof v === "string" && /^\s*(?:none|no|nil|n\/a|-|0|false|not (?:needed|required|used|wanted|allowed)|avoid(?:ed)?|)\s*$/i.test(v));

const strings = (x: unknown) => (Array.isArray(x) ? x : []).map((v, i) => [i, v] as const).filter((e): e is readonly [number, string] => typeof e[1] === "string" && !!e[1]);
const fields = (x: unknown) => Object.entries(x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {});

function requestTexts(r: Partial<Request> | undefined): Text[] {
  if (!r) return [];
  const t: Text[] = [];
  const add = (where: string, v: unknown) => typeof v === "string" && v && t.push({ where, text: v, supply: true });
  add("request.json brief", r.brief);
  add("request.json product", r.product);
  for (const [i, v] of strings(r.mustHave)) add(`request.json mustHave[${i}]`, v);
  for (const [i, v] of strings(r.niceToHave)) add(`request.json niceToHave[${i}]`, v);
  for (const [k, v] of fields(r.constraints)) if (!absent(v)) add(`request.json constraints.${k}`, field(k, v));
  return t;
}

function designTexts(d: Partial<Design> | undefined): Text[] {
  if (!d) return [];
  const t: Text[] = [];
  if (typeof d.summary === "string" && d.summary) t.push({ where: "design.json summary", text: d.summary, supply: true });
  for (const [i, v] of strings(d.architecture)) t.push({ where: `design.json architecture[${i}]`, text: v, supply: true });
  for (const [k] of fields(d.params)) t.push({ where: `design.json params.${k}`, text: words(k), supply: true });
  return t;
}

const lineWords = (l: BomLine) => [l.name, l.shortName, l.role].filter((s): s is string => typeof s === "string");
const isSupply = (l: BomLine) => lineWords(l).some((s) => SUPPLY_LINE.test(s));

/** A line's own words: its name, short name, role and spec (not its notes, which say what it isn't as often as what
 * it is, nor its part numbers). A voltage is read from them only on a supply's line, or from a spec field that gives
 * the line's input or supply. */
function lineTexts(l: BomLine): Text[] {
  const supply = isSupply(l);
  const t: Text[] = [];
  for (const f of ["name", "shortName", "role"] as const) {
    const v = l[f];
    if (typeof v === "string" && v) t.push({ where: `bom.json line ${l.id} ${f}`, text: v, supply });
  }
  for (const [k, v] of fields(l.spec))
    t.push({ where: `bom.json line ${l.id} spec.${k}`, text: field(k, v), supply: supply || SUPPLY_KEY.test(words(k)) });
  return t;
}

/** A bought supply that says it plugs into the wall: by its words, or a `plug` field in its spec (Ponder's psu). */
function plugIn(l: BomLine): boolean {
  if (l.process !== "buy") return false;
  const spec = fields(l.spec);
  const said = [...lineWords(l), ...spec.filter(([, v]) => typeof v === "string").map(([, v]) => v as string)];
  return (spec.some(([k]) => /^plug/i.test(k)) || said.some((s) => PLUG_IN.test(s))) && !said.some((s) => BUILT_IN.test(s));
}

/** Whether a printed line is printed in a metal (its material or process says so, and no plastic): what it says. */
export function printedInMetal(l: Pick<BomLine, "process" | "spec">): string | undefined {
  if (l.process !== "print") return undefined;
  const said = fields(l.spec).filter(([k, v]) => (k === "material" || k === "process") && typeof v === "string").map(([, v]) => v as string);
  return said.some((s) => PLASTIC.test(s)) ? undefined : said.find((s) => METAL.test(s));
}

/** A line made of metal for this product: machined, sheet metal, or printed in a metal. */
function madeMetal(l: BomLine): string | undefined {
  if (l.process === "cnc") return `bom.json line ${l.id}: made by CNC (process "cnc")`;
  if (l.process === "sheet") return `bom.json line ${l.id}: made from sheet metal (process "sheet")`;
  const metal = printedInMetal(l);
  return metal ? `bom.json line ${l.id}: printed in ${metal}` : undefined;
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
    // A bought metal part is fine: the parts list's words aren't read for metal, only what its lines are made by.
    metal: [...lines.map(madeMetal).filter((x): x is string => !!x), ...findIn("metal", prose)],
  };
  return (Object.keys(LIMITS) as LimitKind[]).filter((k) => found[k].length).map((kind) => ({ kind, ...LIMITS[kind], found: found[kind] }));
}

/** limitsOf a product's files as they are; a file that is missing or not readable JSON is left out. */
export function limitsIn(slug: string): Limit[] {
  const read = (file: string): unknown => {
    const path = join(productDir(slug), file);
    try {
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
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
