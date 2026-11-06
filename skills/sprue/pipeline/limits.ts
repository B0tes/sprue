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
    detail: "Sprue has no rule for mains voltage: no creepage or clearance, insulation, earthing or fuse, and nothing " +
      "toward a UL listing or CE's low-voltage directive. Keep mains outside the product with a bought, certified plug-in " +
      "(wall) supply, as Ponder does, or have a qualified person design the mains side and a test lab check it.",
  },
  battery: {
    title: "Batteries",
    detail: "Sprue has no battery rule: no charger or protection circuit, runtime or heat, nothing on a lithium cell's " +
      "fire risk, and nothing on the rules for shipping one (UN 38.3). A rechargeable cell should be a bought, certified " +
      "pack with its own protection and charger, and a rechargeable coin cell (LIR, ML) a charger made for it; a " +
      "single-use cell (a CR coin cell, an alkaline AA) is never charged. A coin or button cell of any kind goes behind " +
      "a lid that takes a tool (a screwdriver or a coin) to open, since a swallowed one can kill a child (in the US, " +
      "16 CFR 1263, or 16 CFR 1250 for a toy, which takes a tool). Have the battery side checked by someone qualified.",
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
 * only on a supply's line, a mains load's (a heater's, a fan's, a bulb's) or a spec field that gives a line's input or
 * supply (a switch's, a fuse's or a capacitor's "250 V" is its rating, not mains in the product). `plugIn`: dropped
 * where its sentence names a plug-in supply that powers the product and keeps mains outside ("powered by a 5 V charger
 * that plugs into the wall"). `owner`: dropped right after "my", "your", "for a", "clips onto" and the like (OWNER), or
 * right before what holds it (HOLDER_AFTER), where it is what the product is for, not what it is ("a stand for my
 * kettle", "a hook for my backpack", "a hair dryer wall mount"); but not a dimmer's, a relay's or a thermostat's mains
 * appliance, which it switches (SWITCHES_IT). `unlessSentence`: dropped where its sentence has this; `unlessBefore`:
 * where the sentence before it ends with this. */
type Word = { re: RegExp; supply?: boolean; plugIn?: boolean; owner?: boolean; unlessSentence?: RegExp; unlessBefore?: RegExp };

const METALS = "aluminium|aluminum|steel|stainless|brass|bronze|copper|titanium|iron|zinc|metal";
/** A metal, or a way of printing one, in a printed line's material or process. */
const METAL = /\b(?:aluminium|aluminum|alsi10mg|steel|stainless|316l|17-4\s?ph|titanium|ti-?6al-?4v|inconel|brass|bronze|copper|maraging|cobalt[- ]chrome|slm|dmls|lpbf|metal)\b/i;
/** A plastic, or a filament that only looks like or holds some metal ("Copper-filled PLA", "PLA Metal", "silk copper"). */
const PLASTIC = /\b(?:pla|petg|pet|abs|asa|tpu|pc|pa\d*|nylon|resin|pp|hips|filled|silk|look|colou?r(?:ed)?)\b/i;
/** A sentence that names wood, plastic or stone and no metal but its hardware ("steel screws", "brass threaded inserts"):
 * what a CNC or a lathe cuts there is not a metal part. */
const NONMETAL_ONLY = new RegExp(`^(?![^]*\\b(?:${METALS})\\b(?![- ](?:[\\w-]+[- ])?(?:inserts?|screws?|bolts?|nuts?|washers?|standoffs?|magnets?|pins?|dowels?|hinges?|weights?|discs?|disks?|hardware|fasteners?)\\b))[^]*\\b(?:wood|wooden|plywood|mdf|hardwood|walnut|oak|maple|birch|beech|cherry|teak|ash|pine|cedar|bamboo|cork|acrylic|plexiglass?|perspex|polycarbonate|hdpe|uhmw|delrin|pom|nylon|foam|plastic|marble|granite|stone)\\b`, "i");
/** A dimmer, relay, thermostat or smart switch for the owner's appliance switches its mains: "a dimmer for my ceiling light". */
const SWITCHES_IT = /\b(?:dimmers?|relays?|thermostats?|pid(?:\s+controllers?)?|(?:smart|wi-?fi|in[- ]wall)\s+(?:switch(?:es)?|timers?))\s+(?:for|to\s+(?:control|switch|dim|run))\s+(?:(?:my|our|your|his|her|their|a|an|the)\s+)?(?:[\w'-]+\s+){0,2}$/i;
/** A switch that is a remote: wireless, or on a battery. */
const REMOTE = /\b(?:batter(?:y|ies)|coin[- ]cells?|cr\d{4}|wireless|remotes?|kinetic|self[- ]powered)\b/i;
/** A rack, mount or organizer for the user's own cells: "a wall rack for my drill batteries". */
const HELD = /\b(?:holders?|mounts?|hangers?|hooks?|racks?|brackets?|caddy|caddies|organi[sz]ers?|shel(?:f|ves)|dispensers?|storage(?:\s+(?:box(?:es)?|cases?|bins?|drawers?))?)\s+for\s+(?:my|our|your|their)\s+(?:(?!(?:with|that|which|has|have|plus|including|built|inside|and\s+an?)\b)[\w'-]+\s+){0,4}$/i;
/** Right after the owner of what it names, or what it goes on: "my", "your", "for a", "clips onto a" and up to two words
 * (and an "and" or "or"); not after "build", "make", "design" or "create", nor before "own", where it is the user's own
 * product ("build my own smart plug"). */
const OWNER = /(?<!\b(?:build|make|design|create|building|making|designing|creating)\s+)\b(?:my|our|your|his|her|their|for(?:\s+(?:a|an|the))?|(?:clips?|clipped|attach(?:es|ed)?|straps?|fits?|hangs?)\s+(?:on(?:to)?|to)(?:\s+(?:a|an|the))?)\s+(?!own\b)(?:[\w'-]+\s+){0,2}(?:(?:and|or|&)\s+)?$/i;
/** Right before what holds it, up to two words on: "a hair dryer wall mount", "a rechargeable toothbrush holder". */
const HOLDER_AFTER = /^(?:[- ](?!(?:with|and|or|for|to|a|an|the|that|which|on|in|of)\b)[\w'-]+){0,2}?[- ](?:holders?|mounts?|hangers?|hooks?|racks?|brackets?|stands?|caddy|caddies|organi[sz]ers?|shel(?:f|ves)|storage)\b(?=\s*(?:$|[,.;:!?)]|(?:for|that|which|to|on|in|under|over|with|so|by|from|at|and|or|of|i|we|made|printed|screwed|mounted|attached)\b))/i;

const WORDS: Record<LimitKind, Word[]> = {
  mains: [
    { re: /\bmains\b(?![- ](?:adapter|charger))/i, plugIn: true },
    { re: /\b(?:line|household|grid)[- ]voltage\b/i, plugIn: true },
    { re: /\b(?:100|110|115|120|127|200|208|220|230|240|250|277)\s?(?:v|volts?)\b/i, supply: true, plugIn: true },
    { re: /\b[1-4]\d\d\s?v\s?ac\b|\b[1-4]\d\dvac\b/i, supply: true, plugIn: true },
    { re: /\bac\s?(?:-|\/|to)\s?dc\b/i, plugIn: true },
    { re: /\bac[- ](?:powered|power|mains|inlet|cord|plug|outlet|line)\b/i, plugIn: true },
    { re: /\bruns? (?:on|off|from) ac\b/i, plugIn: true },
    { re: /\b(?:iec(?:[- ]?(?:60)?320)?(?:[- ]?c\d{1,2})?|c(?:6|8|14|20))(?:[\s-]+(?:panel|chassis|male|female|fused|switched|power|snap[- ]in|mount(?:ed|ing)?)){0,3}[\s-]+(?:inlets?|sockets?|connectors?|receptacles?)\b|\bpower entry modules?\b/i },
    { re: /\b(?:iec(?:[- ]?60320)?(?:[- ]?c\d{1,2})?|c(?:5|7|13|19))\s(?:cord|lead|cable|plug)\b/i, plugIn: true },
    { re: /(?<!\b(?:usb(?:[- ]?c)?|dc|barrel)[- ])\b(?:(?:power|lamp|mains) (?:cords?|leads?)|lamp (?:cables?|flex)|cord ?sets?)\b/i, plugIn: true, owner: true },
    { re: /\b(?:wall|ac|electrical|mains) (?:outlet|socket|receptacle)\b/i, plugIn: true },
    { re: /\bplug(?:s|ged|ging)? (?:straight |directly )?in(?:to)? (?:the |a |an |any )?(?:(?:regular|normal|standard|ordinary|nearby|household|electrical|power|wall)\s+)?(?:wall|mains|outlets?|power ?points?)\b/i, plugIn: true },
    { re: /\b(?:schuko|nema ?\d{1,2}-\d{2}|bs ?1363)\b/i, plugIn: true },
    {
      re: /(?<!\b(?:suppl(?:y|ies)|adapters?|chargers?|psus?|bricks?|warts?)\b[\s,(]+(?:with\s+)?(?:(?:an?|the)\s+)?)\b(?:eu|uk|au|euro|swiss|british|american|european|australian|(?<!\b(?:let|lets|letting|help|helps|helping|make|makes|making)\s+)us)\s+(?:mains\s+|wall\s+|power\s+)?plugs?\b(?![- ](?:(?:and|n)[- ]play|adapters?)\b)/i,
      plugIn: true, owner: true,
    },
    { re: /\b(?:e26|e27|e14|gu10|b22)(?:[\s-]+[\w-]+){0,2}?[\s-]+(?:bulbs?|lamps?|sockets?|holders?|bases?)\b|\b(?:bulbs?|lamps?|sockets?|holders?),?\s+(?:e26|e27|e14|gu10|b22)\b|\bedison (?:bulb|lamp|socket)\b/i },
    { re: /\b(?:triac|solid[- ]state relay)\b/i },
    { re: /\bhlk-?(?:pm\d{2}|\d{1,2}m\d{2})\b|\b(?:lrs|rs(?!-(?:232|422|423|485)\b)|irm|hdr|mdr|lpv|lpc|hlg|apv|elg|xlg|uhp|rsp|nes|se)-\d{2,4}[a-z]?-\d{1,2}[a-z]?\b/i },
    { re: /\bin[- ]wall (?:smart )?(?:switch(?:es)?|dimmers?|outlets?|sockets?|relays?)\b/i },
    { re: /\breplac(?:e|es|ed|ing)\s+(?:(?:my|our|your|the|a|an|existing|old|normal|regular|standard|ordinary)\s+){0,2}(?:(?:wall|light|lighting)\s+switch(?:es)?|(?:wall\s+)?(?:dimmers?|outlets?))\b(?![- ](?:plates?|covers?|faceplates?|guards?))/i, unlessSentence: REMOTE },
    { re: /\b(?:mains|isolation|step[- ]down) transformer\b/i },
    { re: /\bhard[- ]?wired (?:in|into|to) (?:the |a |my |your )?(?:mains|wall|ceiling|house|household|building|breaker|consumer unit|fuse ?box|junction box|lighting circuit)\b/i },
    { re: /\bwired (?:directly |straight )?(?:in|into|to) (?:the |a |my |your |our )?(?:existing )?(?:breaker|consumer unit|fuse ?box|junction box|(?:lighting|light) circuit|(?:house|household|mains) wiring|wall box|back ?box)\b/i },
    // What a product that plugs into the wall is; not a stand for my kettle, or a remote for the ceiling light.
    {
      re: /\b(?:smart (?:plugs?|outlets?|sockets?)|power strips?|(?<!\busb[- ])extension (?:leads?|cords?)|toasters?|kettles?|(?:space|fan|ceramic|convector|oil[- ]filled|towel|patio|infrared|electric|aquarium) heaters?|hair ?dryers?|ceiling (?:lights?|lamps?|fixtures?)|(?<!\b(?:pour[- ]?over|cold[- ]brew|french[- ]press|manual|portable|stove[- ]?top|travel|camping|hand|siphon|vacuum)\s+)(?:coffee (?:makers?|machines?)|espresso machines?)|(?:rice|slow) cookers?|air[- ]?fryers?|(?<!\bfilament )(?:food )?dehydrators?|sous[- ]vide (?:cookers?|circulators?|sticks?|machines?)|immersion circulators?|waffle (?:makers?|irons?)|induction (?:hobs?|cooktops?|cookers?)|electric (?:blankets?|ovens?|fireplaces?|grills?|smokers?))\b(?![- ](?:shaped|style|like|liners?|inserts?|baskets?|trays?|drip|lids?|knobs?|handles?|feet|legs?|tampers?|tamping|stations?|cups?|pods?|capsules?|filters?|scoops?|parts?|accessor(?:y|ies)|covers?|funnels?|rings?|spacers?|cheat|magnets?|knock)\b)/i,
      owner: true,
    },
  ],
  battery: [
    { re: /\bbatter(?:y|ies)\b(?![- ](?:organi[sz]ers?|dispensers?|caddy|caddies)\b)/i },
    { re: /\blithium\b(?!\s+grease)/i },
    { re: /\bli[- ]?ion\b/i },
    { re: /\bli[- ]?po(?:ly(?:mer)?)?\b/i },
    { re: /\blifepo4?\b/i },
    { re: /\b(?:nimh|ni[- ]?cd)\b/i },
    { re: /\b(?:10440|14500|16340|18650|21700|26650|32650)s?\b/i },
    { re: /\b(?:cr|lir|ml)\s?(?:927|1025|1216|1220|1225|1616|1620|1632|2016|2025|2032|2430|2450|2477)s?\b/i },
    { re: /\b(?:lr|sr)\s?(?:41|43|44|54|521|621|626|920|927|1130|1154)(?:sw|w)?s?\b|\bag(?:3|4|10|12|13)s?\b/i },
    { re: /\bcr123a?s?\b/i },
    { re: /\b(?:coin|button)[- ]cells?\b/i },
    { re: /\b(?:\d\s?x\s?)?aaa?\s(?:cells?|alkalines?)\b|\b\d\s?x\s?aaa?\b|\baaa?['’]?s\b|(?<![\d.])\b(?:\d|one|two|three|four|six|eight)\s+aaa?s?\b/i },
    { re: /\bpower ?banks?\b/i },
    {
      re: /\b(?:re)?charg(?:es|ed)\s+(?:over|via|through|from|with|using|by|off|on|in)\s+(?:(?:a|an|the|its|any)\s+)?(?:usb(?:[- ]?c)?|micro[- ]?usb|magnetic|pogo|solar)\b(?![- ](?:c\b[- ]?)?chargers?\b)/i,
      unlessSentence: /\b(?:phones?|tablets?|ipads?|earbuds|airpods|watch(?:es)?|devices?|laptops?|docks?|docking|cradles?|stands?|pads?|mats?|chargers?|hubs?)\b/i,
    },
    { re: /\b\d+(?:[.,]\d+)?\s?m?ah\b|\bpouch cells?\b|\blead[- ]acid\b/i },
    // Not a holder for my cordless drill, or a dock for my rechargeable toothbrush.
    { re: /\b(?:rechargeable|cordless)\b/i, owner: true },
    { re: /\b(?:tp4056|mcp7383\d|bq2[45]\d{3}\w*|ip5306|max1704\d|lc709203)\b/i },
  ],
  soft: [
    { re: /\b(?:fabric|textiles?|cloth)\b(?!(?:[- ](?:covered|braided|wrapped|sleeved|jacketed|insulated|lamp|power|usb(?:-c)?))*[- ](?:cables?|cords?|wires?|leads?|flex|sleeving)\b)/i },
    { re: /\bneoprene\b(?![- ](?:(?:rubber|foam|sponge)[- ])?(?:gaskets?|seals?|washers?|o-?rings?|feet|foot|bumpers?|grommets?|tape|cords?|strips?)\b)/i },
    { re: /\b(?:denim|suede|webbing|velcro|plush|felted|knit(?:ted)?|quilt(?:ed|ing)?|burlap|ripstop|cordura|flannel)\b|\b(?:linen|velvet|fleece)\b(?![- ](?:closets?|cupboards?|cabinets?|textured?|look|finish|effect|pattern|style|like)\b)/i },
    { re: /\b(?:felt|velvet|flock(?:ed)?)-lined\b|\blined with (?:felt|velvet)\b|\b(?:made|cut|sewn) (?:of|from|in) (?:wool )?felt\b|\bfelt (?:lining|liner|backing|bottom|case|sleeve|bag|mat)s?\b/i },
    // Not a crafter's tools, or a painting: "a rack for my leather-working tools", "a hanger for a canvas painting".
    { re: /\b(?:leather|canvas|sew|sewing|sewn)\b(?![- ](?:tools?|machines?|thread|spools?|working|worker|work|painting|prints?|needles?|patterns?|kits?|punch(?:es)?|stamps?))/i },
    { re: /\bupholster(?:y|ed)\b/i },
    { re: /\bhook[- ]and[- ]loop\b/i },
    // Not a board's via stitching.
    { re: /(?<!\bvia[- ])\bstitch(?:ed|ing|es)?\b(?![- ]vias?\b)/i },
    { re: /\b(?:padded|stuffed|stuffing)\b|\b(?:seat|ear|foam|fabric|pillow) cushions?\b|\bcushioned (?:seat|strap|lid|case|base|pad|cover)\b/i },
    { re: /\bfoam[- ]lined\b|\b(?:memory|eva) foam\b|\bfoam (?:padding|cushions?|linings?|inserts?|liners?|pads?|sheets?|layers?|covers?|blocks?)\b/i },
    // The bag or strap that is the product, or holds it; not a hook for my backpack, a lanyard's hole, a pillow block
    // bearing, or a glove the user wears to press it.
    {
      re: /\b(?:(?:elastic|nylon|adjustable|arm|ankle|leg|helmet|shoulder|wrist|chin|head|watch|carry(?:ing)?|camera|neck|guitar|bag|luggage|chest|hand|waist|backpack) straps?|backpacks?|rucksacks?|vests?|(?<!\b(?:cable|wire|wiring|pvc|silicone|ptfe|teflon|rubber|braided|outer|inner|water|cooling|coolant|heater|heating|insulation|insulating|thermal|vacuum|lead|tpe|pu|lszh|steel|metal|copper)[- ])jackets?(?![- ](?:heaters?|strippers?|stripping)\b|\s*:)|hoodies?|t-?shirts?|sweatshirts?|socks|insoles?|armbands?|(?<!\b(?:in|into|inside|onto|on|off|from|above|under|fits?)\s+(?:(?:a|an|the|any|most|my|your|its|their|our)\s+)?)(?:tote|messenger|laptop|sling|shoulder|cross[- ]?body|duffel|duffle|gym|camera|bike|bicycle|saddle|handlebar|frame|top[- ]tube|seat|bum|belt|hip|dry|sleeping|drawstring|bean|toiletry|lunch|diaper|nappy|courier|tool|hand) ?bags?|duffel|duffle|lanyards?|wristbands?|beanies?|pillows?|(?<!\b(?:with|wearing|wear|wears|in|through|using)\s+(?:[\w'-]+\s+)?)gloves?|pouch(?:es)?|(?:dog|cat|pet) (?:collars?|harness(?:es)?)|felt (?:base|lining|liner|cover))\b(?![- ](?:box(?:es)?|compartments?|holes?|slots?|loops?|eyelets?|rings?|clips?|hooks?|hangers?|holders?|attachments?|mounts?|points?|friendly|blocks?|cells?)\b)/i,
      owner: true,
    },
  ],
  metal: [
    // Machined in a metal, said so: "a CNC aluminium faceplate", "CNC-machined steel".
    { re: new RegExp(`\\bcnc(?:[- ](?:machined|milled|turned|cut))?[- ](?:${METALS})\\b`, "i") },
    // CNC'd, of what the sentence says: not wood, acrylic or another plastic.
    { re: /\bcnc[- ](?:machined|machining|milled|milling|turned|turning|cut)\b(?![- ](?:machines?|cent(?:er|re)s?|lathes?|routers?)\b)/i, unlessSentence: NONMETAL_ONLY },
    // A CNC part, not the machine: not "a pendant for my CNC", "a tray I cut on my CNC router", or wood.
    {
      re: /\bcnc\b(?![- ](?:(?:machined|machining|milled|milling|turned|turning|cut)\b(?![- ](?:machines?|cent(?:er|re)s?|lathes?|routers?)\b)|bits?|end[- ]?mills?|collets?|spindles?|spoilboards?|kitchen|routers?|mills?|machines?|pendants?|controllers?|jog|lathes?|shield|plotters?|software|g-?code)\b)/i,
      unlessSentence: NONMETAL_ONLY,
      unlessBefore: /\b(?:my|our|your|their|for\s+(?:a|an|the))\s+(?:[\w'-]+\s+){0,2}(?:(?:and|or|&)\s+)?$/i,
    },
    { re: new RegExp(`\\b(?:machined|milled|turned) (?:${METALS})\\b`, "i") },
    {
      re: new RegExp(`\\b(?:milled|machined|turned|bent|folded|cut) (?:from|out of) (?:an? |solid |[\\d.]+ ?mm )?(?:billet|solid|${METALS}|sheet[- ]metal)\\b`, "i"),
      unlessSentence: NONMETAL_ONLY,
    },
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
const PLUG_IN = /\b(?:wall[- ]?(?:adapter|supply|wart|plug|charger)|plug[- ]in(?: supply| adapter)?|power brick|(?:phone|laptop|desktop) (?:charger|adapter|power[- ]supply|supply)|\busb(?:[- ]?c)?\b[^,;.]*?\b(?:power[- ]supply|supply|charger|adapter)|(?:ac|mains|power) adapter|adapter|charger|(?:eu|uk|us|au|euro|schuko|type [a-n])\s+plug)\b/i;
const BUILT_IN = /\b(?:open[- ]frame|modules?|board|internal|inside|din[- ]rail|built[- ]in(?:to)?|pcb[- ]mount(?:ed)?|enclosed|chassis|screw[- ]terminals?|on[- ]board|panel[- ]mount(?:ed)?)\b/i;
/** Built in, said in the three words after a supply: "a wall adapter module", "a charger built into the base". */
const BUILT_IN_AFTER = new RegExp(`^(?:\\W+[\\w-]+){0,2}?\\W+(?:${BUILT_IN.source})`, "i");
const BUILT_IN_SAID = /\b(?:open[- ]frame|internal|din[- ]rail|built[- ]in|integrated|pcb[- ]mount(?:ed)?|enclosed|chassis|on[- ]?board|panel[- ]mount(?:ed)?)/i;
const BUILT_IN_BEFORE = new RegExp(`(?:${BUILT_IN_SAID.source})(?:\\W+(?:[\\d.]+\\s?(?:v|a|w|ma|vdc|vac)?|v|a|w|ma|dc|ac|ac[- /]?dc|usb(?:[- ]?c)?|switching|smps|power))*\\W+$`, "i");
/** A line that is a supply or names one, whose voltages are its input. */
const SUPPLY_LINE = /\b(?:power[- ]?supply|psu|supply|adapter|charger|converter|ac[- ]?dc|transformer|smps|(?:led|lamp) drivers?|ballast|wall[- ]?warts?|power[- ]?bricks?)\b/i;
/** A line that is a mains load, whose voltage is what it runs on: a heater, a fan, a pump, a bulb. */
const LOAD_LINE = /\b(?:heaters?|heating|elements?|fans?|blowers?|motors?|pumps?|compressors?|bulbs?|lamps?|solenoids?|valves?|appliances?)\b/i;
/** A part whose voltage is a rating, not what it runs on: a switch, a fuse, a relay, a capacitor. */
const RATED_LINE = /\b(?:switch(?:es)?|fuses?|relays?|contactors?|capacitors?|caps?|mosfets?|transistors?|igbts?|varistors?|movs?|connectors?|terminals?|diodes?|rectifiers?|thermostats?|cut-?offs?|resistors?|sockets?|holders?|optocouplers?)\b/i;
/** A spec field that gives a line's input or supply. */
const SUPPLY_KEY = /\b(?:input|supply|mains|vin|line|ac)\b/i;

/** In the request's and the design's words, a supply outside the product, by what it is: a wall adapter, a plug-in
 * supply, a power brick. */
const PLUG_IN_PROSE = /\b(?:wall[- ]?(?:adapters?|warts?|suppl(?:y|ies)|power[- ]suppl(?:y|ies)|psus?)|plug[- ]in (?:power[- ])?(?:suppl(?:y|ies)|adapters?|psus?|chargers?)|power bricks?|(?:ac|mains|power|ac[- /]?dc) adapters?|external (?:power[- ])?(?:suppl(?:y|ies)|adapters?|psus?|bricks?))\b/i;
/** Or a charger or adapter (a USB one, or a USB supply), but only where it powers the product: after POWERED_BY.
 * A lamp with a USB charger for your phone still has its own mains. */
const PLUG_IN_POWERING = /\b(?:usb(?:[- ]?c)?(?:[- ]+(?!(?:from|by|via|through|off|using|with|on|in|into)\b)[\w.-]+){0,4}?[- ]+(?:power[- ])?(?:suppl(?:y|ies)|psus?|chargers?|adapters?)|chargers?|(?<!\b(?:duct|hose|tube|pipe|lens|bulb|thread|nozzle|mm|e\d\d|gu10|b22|bsp|npt)[- ]+)adapters?)\b/i;
/** Said right before such a charger or adapter (up to five words between): it is what powers the product. */
const POWERED_BY = /(?:\b(?:powered|powers?|supplied|fed|feeds?|runs?|running|charged|charges|works?|plugs?|plugged)\s+(?:(?:only|just|entirely|directly|straight|solely|over\s+usb(?:[- ]?c)?)\s+)?(?:by|from|off|on|via|through|with|using|into|in)|\b(?:via|through|from|using|uses?|off)|->|→|\b(?:power|supply|psu)\s*:)\s+(?:[\w.()/+'’-]+\s+){0,5}$/i;
/** A charger the product has for something else: a wireless one, a charger port, one for your phone. */
const OFFERED_BEFORE = /\b(?:wireless|qi|inductive|induction|magsafe)\s+(?:[\w-]+\s+)?$/i;
const OFFERED_AFTER = /^(?:[- ](?:ports?|pads?|outputs?|coils?|sockets?|slots?|docks?|stations?|cradles?|bays?)\b|\s+(?:for|to charge)\s+(?:(?:my|your|a|an|the|their|our)\s+)?(?:[\w-]+\s+)?(?:phones?|devices?|tablets?|watch(?:es)?|earbuds|gadgets?|laptops?))/i;

/** A word that says the thing is not there, right before it: "no battery", "without a battery", "not a CNC part",
 * "instead of mains", "doesn't need a battery", "not powered by mains", "no batteries or mains", "neither a battery
 * nor mains". Only the word it governs, with at most one word, a preposition or an "or" between: "a speaker with no
 * buttons and a LiPo" has one, and so does "a non-rechargeable CR2032" and a "No-name LiPo". The word between is never
 * one that says the thing is there ("no removable battery", "without replacing the battery"). */
const NOT = /(?:(?:\b(?:no|not|without|never|neither|nor|excluding|avoids?|avoiding)|n't|\b(?:instead|rather) (?:of|than)|\bfree of)(?:\s+(?:a|an|any|the|its))?(?:\s+(?!(?:(?:drain|remov|replac|swap|chang|kill|charg|recharg|deplet|damag|open|overheat|overcharg|access)(?:e|es|ed|ing|ping|s)?|removable|replaceable|user[- ]replaceable|swappable|accessible|exposed|loose|spare)\b)[\w'-]+)?(?:\s+(?:on|by|from|off|for|of|in|to|or|nor))?(?:\s+(?:a|an|any|the|its))?\s+|\b(?:no|non)-)$/i;
/** The same, said after the words: "battery-free", "battery-less", "Batteries: none". */
const NOT_AFTER = /^(?:[- ]?free\b|-?less\b|\s*[:=]\s*(?:none|no|nil|n\/a|0|false|not (?:needed|required|used|wanted|allowed)|avoid(?:ed)?)\b)/i;
const SWITCHED = /\b(?:switch(?:es|ed)?(?![- ]mode\b)|switching(?![- ](?:[\w-]+[- ])?(?:wall|mode|power|adapters?|suppl(?:y|ies)|psus?|chargers?|converters?|regulators?)\b)|relays?|dimm(?:er|ers|ing|able)|dims?|loads?|contacts?)\b/i;
/** Where a clause ends: a negation before it governs nothing after it. */
const CLAUSE = /[.;,!?()\n]|->|→|\b(?:but|however|although|though|except|while|whereas|and|with|that|which)\b/gi;
/** Where a clause ends for POWERED_BY: as CLAUSE, but an arrow says what powers what, and "with" after the wall, "into
 * the mains" or a power verb says what with ("plugs into the wall with a USB charger", "powered with a USB charger");
 * after "runs off mains" it doesn't ("a lamp that runs off mains with a USB charger on its base"). */
const POWER_CLAUSE = /[.;,!?()\n]|\b(?:but|however|although|though|except|while|whereas|and|that|which)\b|(?<!\b(?:wall|outlets?|sockets?|in(?:to)?\s+(?:the\s+)?mains|powered|supplied|fed|runs?|running|charged|works?)\s+)\bwith\b/gi;
/** Where a sentence ends: a plug-in supply in it keeps the mains it names outside. */
const SENTENCE = /[.;!?\n]/g;
/** How far either way a clause or sentence is read: enough for any real one, and a long text stays quick. */
const REACH = 400;

type Text = { where: string; text: string; supply: boolean };

/** Where the run of text holding `at` starts, after the last `breaks` before it (within REACH). */
function startOf(text: string, at: number, breaks: RegExp): number {
  const from = Math.max(0, at - REACH);
  let start = from;
  for (const m of text.slice(from, at).matchAll(new RegExp(breaks.source, "gi"))) start = from + m.index + m[0].length;
  return start;
}
/** And where it ends (within REACH). */
function endOf(text: string, at: number, breaks: RegExp): number {
  const m = new RegExp(breaks.source, "i").exec(text.slice(at, at + REACH));
  return m ? at + m.index : Math.min(text.length, at + REACH);
}

/** Whether the words at `at` in `text` are said not to be there. */
function negated(text: string, at: number, length: number): boolean {
  return NOT.test(text.slice(startOf(text, at, CLAUSE), at)) || NOT_AFTER.test(text.slice(at + length, at + length + 40));
}

/** Whether the sentence starting at `from` in `text` names a plug-in supply that powers the product: not said not to
 * be there, not one the product offers, nor built in ("a wall adapter module"). */
function powersFromOutside(text: string, from: number): boolean {
  const sentence = text.slice(from, endOf(text, from, SENTENCE));
  const at = (re: RegExp) => [...sentence.matchAll(new RegExp(re.source, "gi"))];
  return [...at(PLUG_IN_PROSE).map((m) => [m, true] as const), ...at(PLUG_IN_POWERING).map((m) => [m, false] as const)].some(([m, outside]) => {
    // Its own clause, an arrow kept: "powered by a USB charger", "Mains -> USB charger", not "plugs into the wall and
    // has a USB charger".
    const before = sentence.slice(startOf(sentence, m.index, POWER_CLAUSE), m.index);
    const end = m.index + m[0].length;
    if (negated(sentence, m.index, m[0].length) || OFFERED_BEFORE.test(before) || OFFERED_AFTER.test(sentence.slice(end, end + 60))) return false;
    // Built in, said of it, right before it or in its clause's next three words: "a wall adapter module", "an internal 5 V
    // adapter", "a charger built into the base".
    if (BUILT_IN.test(m[0]) || BUILT_IN_BEFORE.test(before) || BUILT_IN_AFTER.test(sentence.slice(end, endOf(sentence, end, CLAUSE)))) return false;
    return outside || POWERED_BY.test(before);
  });
}

/** Whether a word at `at` is in a sentence that names a plug-in supply powering the product, and has no word near it in
 * its clause that says it is built in or switched by the product ("a lamp with a built-in 230 V supply and a USB charger
 * port", "a dimmer for a 230 V lamp, powered by a USB charger"). */
function plugInSentence(text: string, at: number): boolean {
  const s = startOf(text, at, CLAUSE), e = endOf(text, at + 1, CLAUSE);
  // Within four words before it and six after, in its clause (read on to the clause's end, so a word's lookahead sees on).
  const lead = text.slice(s, at).match(/(?:\S+\s+){0,4}$/)?.[0] ?? "";
  const near = lead + (text.slice(at, e).match(/^(?:\S+\s*){0,6}/)?.[0] ?? "");
  const said = (re: RegExp) => [...text.slice(at - lead.length, e).matchAll(new RegExp(re.source, "gi"))].some((m) => m.index < near.length);
  // Built in ("a built-in 230 V supply", "a 230 V to 5 V module"), or switched or dimmed by the product ("a smart
  // switch for a 120 V lamp", "a relay for 230 V loads"): its mains is inside, whatever powers the logic.
  if (said(BUILT_IN) || said(SWITCHED)) return false;
  return powersFromOutside(text, startOf(text, at, SENTENCE));
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
    const sentence = (m: RegExpExecArray) => text.slice(startOf(text, m.index, SENTENCE), endOf(text, m.index + m[0].length, SENTENCE));
    const before = (m: RegExpExecArray) => text.slice(startOf(text, m.index, SENTENCE), m.index);
    const hits = WORDS[kind].filter((w) => supply || !w.supply).flatMap((w) =>
      [...text.matchAll(new RegExp(w.re.source, `${w.re.flags.replace("g", "")}g`))].filter((m) =>
        !negated(text, m.index, m[0].length) &&
        !(w.plugIn && plugInSentence(text, m.index)) &&
        !(w.owner && !(kind === "mains" && SWITCHES_IT.test(before(m)) && !REMOTE.test(sentence(m))) && (OWNER.test(before(m)) || HOLDER_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 60)))) &&
        !(w.unlessBefore && w.unlessBefore.test(before(m))) &&
        !(kind === "battery" && HELD.test(before(m))) &&
        !(w.unlessSentence && w.unlessSentence.test(sentence(m)))));
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
/** A name's head, before what it comes with or is for: "USB-C wall adapter, 1.5 m cable" is an adapter. */
const head = (s: string) => s.split(/[,;(]|\b(?:with|for)\b/i)[0];
/** A name's noun: the first piece, before what it comes with or is for, that names a load or a rated part ("PTC heater
 * with thermostat, 230 V" is a heater, "SRD-05VDC, relay for the fan" a relay). */
const noun = (s: string) => s.split(/[(]|\b(?:with|for)\b/i)[0].split(/[,;]/).find((p) => LOAD_LINE.test(p) || RATED_LINE.test(p)) ?? "";
/** A mains load (a heater, a fan, a bulb) and not a part rated for one (a switch, a fuse, a relay), by its noun. */
const isLoad = (l: BomLine) => lineWords(l).some((s) => LOAD_LINE.test(s)) && !lineWords(l).some((s) => RATED_LINE.test(noun(s)));

/** A line's own words: its name, short name, role and spec (not its notes, which say what it isn't as often as what
 * it is, nor its part numbers). A voltage is read from them only on a supply's or a mains load's line, or from a spec
 * field that gives the line's input or supply. */
function lineTexts(l: BomLine): Text[] {
  const supply = isSupply(l) || isLoad(l);
  const t: Text[] = [];
  for (const f of ["name", "shortName", "role"] as const) {
    const v = l[f];
    if (typeof v === "string" && v) t.push({ where: `bom.json line ${l.id} ${f}`, text: v, supply });
  }
  for (const [k, v] of fields(l.spec))
    t.push({ where: `bom.json line ${l.id} spec.${k}`, text: field(k, v), supply: supply || SUPPLY_KEY.test(words(k)) });
  return t;
}

/** A bought supply that says it plugs into the wall: a supply, adapter or charger by its words, that says it plugs in
 * by its words or a `plug` field in its spec (Ponder's psu). A cord, lead or inlet with a plug brings mains in. */
function plugIn(l: BomLine): boolean {
  if (l.process !== "buy" || !isSupply(l) || lineWords(l).some((s) => /\b(?:cords?|leads?|cables?|inlets?)\b/i.test(head(s)))) return false;
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

/** A line made of metal for this product: machined (unless its material is only wood, plastic or stone), sheet metal, or
 * printed in a metal. */
function madeMetal(l: BomLine): string | undefined {
  if (l.process === "cnc" && !NONMETAL_ONLY.test(typeof l.spec?.material === "string" ? l.spec.material : "")) return `bom.json line ${l.id}: made by CNC (process "cnc")`;
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
