// The design stage's engineer checks. Each check reads design params and BOM lines and either
// passes, fails (the thing won't work or won't fit) or flags (needs a human decision).
// A check whose params the design has none of is skipped (listed in checks.json `skipped`), so the same list
// grows across products on the reference ladder; one with some of its params but not all fails, since that is most
// often a param left out, and a check that quietly doesn't run is how a fault gets through. A product can add its own rules in
// products/<slug>/rules.ts (export const rules: Rule[]), which run after these; a rule there with the id of
// one of these replaces it, and { id, off: true } drops it.

import type { Bom, BomLine, Check, Checks, Design, SkippedCheck } from "../types.ts";

export type Ctx = { p: Record<string, number | string>; bom: Bom };
export type Rule = { id: string; title: string; needs: string[]; run: (c: Ctx) => Omit<Check, "id" | "title"> };

const n = (c: Ctx, k: string) => Number(c.p[k]);
const qty = (c: Ctx, role: string) =>
  c.bom.lines.filter((l) => l.role === role).reduce((s, l) => s + l.qtyPerUnit, 0);
const ok = (cond: boolean, detail: string): Omit<Check, "id" | "title"> => ({
  status: cond ? "pass" : "fail",
  detail,
});

/** What print shops ask of a printed wall, by process, read 2026-10-18. `min` is the least the shop that prices the
 * print takes: Craftcloud's material guide gives one figure a material with no condition on size or on which wall
 * ("Min. wall thickness: 1 mm" for PETG, PLA, ABS, ASA and FDM TPU, 0.8 mm for HP MJF PA12 and PA11 and SLS PA12;
 * craftcloud3d.com/en/material-guide/petg, /pla, /abs, /asa, /fdm-tpu, /hp-mjf-nylon-pa12; PC, HIPS and PCTG are held
 * to FDM's figure unread). JLC3DP prints MJF PA12 too, and its blog lets a wall be at most 0.2 mm under its 1.0 mm,
 * which is the same 0.8 mm. `bySize` is JLC3DP's guideline (jlc3dp.com/help/article/3D-Printing-Design-Guideline),
 * keyed to the part's size: the column is the smallest its longest side fits in (the page says neither what size
 * means nor whether a horizontal skin counts as a wall), and past its last column it asks only for thicker walls, so a
 * wall under it, or any wall on a larger case, is a person's call. JLC3DP prints no PETG, and its own FDM pages give
 * 1.2 mm (What is FDM, its wall-thickness blog) to more than 1.6 mm (jlc3dp.com/help/article/pla-plastic), none keyed
 * to size, so it is a reference, not the shop's limit. */
export const PRINT_WALLS: Record<string, { min: number; minFrom: string; bySize: [number, number][] }> = {
  FDM: { min: 1.0, minFrom: "Craftcloud", bySize: [[50, 1.6], [100, 2.0], [200, 2.5]] },
  "MJF/SLS": { min: 0.8, minFrom: "Craftcloud", bySize: [[5, 1.0], [10, 1.2], [50, 1.5], [100, 2.0], [200, 2.0]] },
};
/** JLC3DP: "The recommended minimum wall thickness for structures such as protrusion, positioning, snaps and fasteners
 * is more than 1.5mm", whatever the process or size. */
export const FASTENER_WALL_MM = 1.5;
/** The words of plastics, as makers and shops write them: a word on its own, or run into a maker's prefix ("ePLA",
 * "rPLA", "HTPLA") or a grade ("TPU95", "PA12CF"), never inside another word ("Versatile Plastic" is not PLA). */
const plastics = (...words: string[]) => new RegExp(`(?<![A-Z0-9])(?:E|R|HT|ECO)?(?:${words.join("|")})(?![A-Z])`, "i");
/** The print processes a spec.process can name, each by the names it goes by (spec.process is one of them, or names
 * of the same process as in "Fused deposition modeling (FDM)" or "SLS/MJF", and nothing else: what else there is to
 * say of the print goes in the line's notes), and, for a plastic one, the words of the plastics it prints, one of which its
 * line's spec.material must name ("Prusament PETG", "Glass-filled PA12", "Versatile Plastic"): an alloy, a ceramic or
 * sand names none. No metal process has a row yet. */
export const PROCESSES: [string, string[], RegExp?][] = [
  ["FDM", ["FDM", "FFF", "FLM", "FUSED DEPOSITION", "FUSED DEPOSITION MODELING", "FUSED DEPOSITION MODELLING", "FUSED FILAMENT FABRICATION",
    "FUSED LAYER MODELING", "FUSED LAYER MODELLING", "FUSED LAYER MANUFACTURING"],
    plastics("PETG", "PET", "PCTG", "PLA", "ABSPLUS", "ABS", "ASA", "TPU", "TPE", "CPE", "COPE", "CO[- ]?POLYESTER", "HIPS", "PC", "PPS", "PP", "PVB", "PEEK", "PEI",
      "PEKK", "ULTEM", "PAHT", "P?PA\\d*", "COPA", "NYLON", "POL[YI]AM+ID[EA]?", "POLYCARBONATE", "POLYPROPYLENE", "ONYX", "ANTERO", "POLYSMOOTH")],
  ["MJF/SLS", ["MJF", "HP MJF", "MULTI JET FUSION", "MULTIJET FUSION", "HP MULTI JET FUSION", "SLS", "SELECTIVE LASER SINTERING", "LASER SINTERING"],
    plastics("PAHT", "P?PA\\d*", "NYLON", "POL[YI]AM+ID[EA]?", "TPU", "TPE", "TPA", "PP", "POLYPROPYLENE", "PEBA", "PEEK",
      "VERSATILE PLASTIC", "STRONG (?:&|AND) FLEXIBLE", "DURAFORM", "ALUMIDE", "CARBONMIDE", "PRIMEPART", "WINDFORM")],
  ["SLA", ["SLA", "MSLA", "DLP", "LCD", "STEREOLITHOGRAPHY", "RESIN"]],
];
/** Words in a spec.material that make the part a metal or a ceramic held in a plastic binder that is burnt out, or a
 * part debound and fired after printing ("Copper Filamet (PLA binder)", "316L, POM binder"): a print no plastic row's
 * least wall holds. Sintering is SLS's own; after FFF it is one of these. */
const BOUND = /\b(BINDER|LIANT|LEGANTE|FILAMET|DE ?BIND\w*|DE ?BOUND|ENTBINDER\w*|DELIANT\w*|KILN\w*|FURNACE|OFEN|FORNO|FIRED)\b/;
const SINTERED = /SINTER\w*|\bFRITT\w*/;
/** A spec field as its words: accents off, upper case, hyphens and runs of spaces as one space. */
const words = (v: unknown) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
/** The row whose name, or whose names, a spec.process is. */
const named = (process: unknown) => {
  const parts = words(process).split(/\s*[/()]\s*/).filter(Boolean);
  return PROCESSES.find(([, names]) => parts.length > 0 && parts.every((n) => names.includes(n)));
};

/** How a printed line is made, or why that can't be told: its spec.process is not a process's name, or names a
 * plastic process its spec.material names no plastic of, or a material bound in a plastic or fired after printing; or,
 * with no spec.process, its material is printed more than one way (a nylon with anything after its grade but the word
 * nylon, such as PA12-CF, PA12+CF15 or PA12 CCF, is FDM at one shop, SLS at another and continuous fibre at a third) or
 * isn't a plastic Sprue knows. */
function readProcess(l: BomLine): { process?: string; why?: string } {
  const m = String(l.spec.material ?? "").trim(), said = JSON.stringify(l.spec.process);
  const add = "add its process, with its names and its shop's page, to PROCESSES and PRINT_WALLS in pipeline/stages/check.ts, and write one of those names in spec.process";
  const bound = (k: string) => {
    const w = BOUND.exec(words(m))?.[0] ?? (k === "FDM" ? SINTERED.exec(words(m))?.[0] : undefined);
    return w && `${l.id}'s spec.material ${JSON.stringify(m)} reads as a metal or ceramic held in a plastic binder, or a part debound or fired after printing (it says "${w}"), which Sprue has no least wall for yet: if it is a plastic part, leave that word out; if not, ${add}`;
  };
  if (!String(l.spec.process ?? "").trim()) {
    const p = byMaterial(m), why = p && p !== "SLA" ? bound(p) : undefined;
    return why ? { why } : p ? { process: p } : { why: `can't tell how ${l.id} is printed: give its spec.process (FDM, FFF, MJF, SLS or SLA)` };
  }
  const row = named(l.spec.process);
  if (!row) return { why: `${l.id}'s spec.process ${said} is not the name of a process Sprue reads: write just its name there, as in FDM, FFF, MJF, SLS, SLA or "Fused deposition modeling (FDM)", and the rest in the line's notes; if it is another process, ${add}` };
  const [k, , prints] = row;
  if (!prints) return { process: k };
  const was = `${l.id}'s spec.process ${said} is ${k}`;
  if (!m) return { why: `${was}, but the line has no spec.material: give it` };
  if (!prints.test(m)) return {
    why: `${was}, but its spec.material ${JSON.stringify(m)} names no plastic Sprue knows ${k} prints: if it is one, write the plastic there (as in "PETG" or "Onyx (nylon)"); if it is a plastic Sprue doesn't list, add it, with its shop's page for its least wall, to ${k}'s plastics in PROCESSES in pipeline/stages/check.ts; if it is a metal, ceramic or sand, ${add}`,
  };
  const why = bound(k);
  return why ? { why } : { process: k };
}
export const printProcess = (line: BomLine): string | undefined => readProcess(line).process;

/** What a material with no spec.process is printed by, when only one process prints it. */
function byMaterial(m: string): string | undefined {
  // Resin before the FDM plastics, whose names the resins borrow ("ABS-like resin", "PC-Like Clear", "Tough 2000
  // (ABS-like)"). A filament can be like something too ("PLA (wood-like)", "TPU (rubber-like)"): a plastic-like word
  // is a resin's when the name starts with it, or when nothing else in the name is a plastic or a filament.
  const like = /(ABS|PC|PP|PE|PA|nylon|PETG?|TPU|rubber)[- ]like\b/gi;
  const rest = /\b(r?PETG|PCTG|PLA|ABS|ASA|TPU|TPE|CPE|HIPS|PC|PP|P?PA ?\d*|nylon|filament)\b/i;
  if (/resin/i.test(m) || /^(ABS|PC|PP|PE|PA|nylon|PETG?|TPU|rubber)[- ]like\b/i.test(m) || (like.test(m) && !rest.test(m.replace(like, "")))) return "SLA";
  if (/^PA ?1[12](\s+nylon)?$/i.test(m)) return "MJF/SLS";
  if (/^P?PA ?\d/i.test(m)) return undefined;
  if (/^(r?PETG|PCTG|PLA|ABS|ASA|TPU|HIPS|PC)\b/i.test(m)) return "FDM";
  return undefined;
}

/** A param as a number, or NaN when it isn't one ("0.8 mm", "", "unpublished"). */
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
/** x to 2 decimals, or to as many more as it takes not to read as one of these limits when it isn't on it. */
const fmt = (x: number, ...limits: number[]) => {
  for (let d = 2; d <= 10; d++) {
    const r = Number(x.toFixed(d));
    if (!limits.some((l) => Math.abs(x - l) > 1e-9 && r === Number(l.toFixed(d)))) return r.toString();
  }
  return x.toString();
};
const list = (xs: string[], and = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/** A printed wall, skin or wall round a fastener of the case, held to the print processes of the parts it is in: under
 * the shop's least wall fails; not over 1.5 mm round a fastener, under JLC3DP's figure for the case's size, or on a
 * case past JLC3DP's table is flagged. `from`: the params it is worked out from, so the problem names what to change;
 * `optional`: left out when the design has none of them (it fails with some but not all); `many`: the name is plural
 * ("case walls"). */
type Wall = { name: string; from: string[]; mm: number; parts: BomLine[]; fastener?: boolean; optional?: boolean; many?: boolean };
function printWalls(c: Ctx, all: Wall[], skins: boolean): Omit<Check, "id" | "title"> {
  const partial = all.filter((x) => x.optional && x.from.some((k) => k in c.p) && !x.from.every((k) => k in c.p));
  if (partial.length) return {
    status: "fail",
    detail: partial.map((x) => `Can't hold ${x.name}: design.json has ${list(x.from.filter((k) => k in c.p))} but not ${list(x.from.filter((k) => !(k in c.p)))}`).join("; "),
  };
  const walls = all.filter((x) => !x.optional || x.from.every((k) => k in c.p));
  const held = walls.filter((x) => x.parts.length);
  if (!held.length) {
    const cases = c.bom.lines.filter((l) => l.role === "case-top" || l.role === "case-bottom");
    const prints = (cases.length ? cases : c.bom.lines).filter((l) => l.process === "print");
    const says = (ls: BomLine[]) => `${list(ls.map((l) => `${l.id} (role ${l.role})`))} ${ls.length > 1 ? "are" : "is"} printed`;
    // The design has a case (the check's params say so), so printed lines under other roles may be it: this check
    // can't see them, which is not the same as no printed case.
    if (!cases.length && prints.length) return {
      status: "fail",
      detail: `No line has role case-top or case-bottom, but ${says(prints)}: if they are the case, give its lid and tray those roles; if not, drop or replace this check in the product's rules.ts`,
    };
    // A printed lid or tray whose only walls here are ones the design gives no params for.
    if (prints.length) return {
      status: "flag",
      detail: `${cap(says(prints))}, but design.json has no ${list([...new Set(all.filter((x) => x.parts.length).flatMap((x) => x.from))], "or")}, so nothing of ${prints.length > 1 ? "them" : "it"} is held here: a person checks ${skins ? "the skins" : "the walls"}`,
    };
    return ok(true, "The case isn't printed (no print line with role case-top or case-bottom)");
  }
  const sizes = ["pcbWidthMm", "pcbHeightMm", "caseClearanceMm", "caseWallMm"];
  const nan = [...new Set([...held.flatMap((x) => x.from), ...sizes])].filter((k) => !Number.isFinite(num(c.p[k])));
  if (nan.length) return {
    status: "fail",
    detail: `${nan.map((k) => `${k} is ${JSON.stringify(c.p[k])}`).join(", ")}, not ${nan.length > 1 ? "numbers" : "a number"} of mm`,
  };
  const lines = [...new Map(held.flatMap((x) => x.parts).map((l) => [l.id, l])).values()];
  const unknown = [...new Set(lines.map((l) => {
    const { process: p, why } = readProcess(l);
    if (p === undefined) return why!;
    return PRINT_WALLS[p] ? "" : `Sprue has no print shop's least wall for ${p} yet: add one, with its page, to PRINT_WALLS in pipeline/stages/check.ts`;
  }).filter(Boolean))];
  if (unknown.length) return { status: "fail", detail: cap(unknown.join("; ")) };
  const how = (l: BomLine) => printProcess(l)!;
  const side = (k: string) => num(c.p[k]) + 2 * (num(c.p.caseClearanceMm) + num(c.p.caseWallMm));
  const w = side("pcbWidthMm"), h = side("pcbHeightMm"), longest = Math.max(w, h);
  // Each wall's limits: the strictest of its parts', each by its own process. Walls under the same limit are said
  // together, failures first and those thick enough last.
  const groups = new Map<string, { x: Wall; shown: string }[]>(), rank = new Map<string, number>();
  let worst: Check["status"] = "pass";
  for (const x of held) {
    // Named by the processes whose limit it is.
    const procs = [...new Set(x.parts.map(how))];
    const min = Math.max(...procs.map((p) => PRINT_WALLS[p].min)), least = procs.filter((p) => PRINT_WALLS[p].min === min);
    const ends = procs.map((p) => PRINT_WALLS[p].bySize[PRINT_WALLS[p].bySize.length - 1]);
    const past = procs.filter((_, i) => longest > ends[i][0] + 1e-9);
    const cols = procs.map((p, i) => PRINT_WALLS[p].bySize.find(([s]) => longest <= s + 1e-9) ?? ends[i]);
    const col = cols.reduce((a, b) => (b[1] > a[1] ? b : a)), asks = procs.filter((_, i) => cols[i][1] === col[1]);
    let key: string;
    if (x.mm < min - 1e-9) { key = `under the ${fmt(min)} mm ${PRINT_WALLS[least[0]].minFrom} takes of ${least.join(" and ")}`; worst = "fail"; }
    else {
      if (x.fastener && x.mm <= FASTENER_WALL_MM + 1e-9) key = `not over the ${fmt(FASTENER_WALL_MM)} mm JLC3DP asks round fasteners`;
      else if (past.length) {
        const end = ends.filter((_, i) => past.includes(procs[i])).reduce((a, b) => (b[1] > a[1] ? b : a));
        const its = past.filter((p) => ends[procs.indexOf(p)][1] === end[1]);
        key = `on a case longer than JLC3DP's ${its.join(" and ")} table goes (${fmt(end[1])} mm up to ${end[0]} mm, and thicker past that, it says)`;
      } else if (x.mm < col[1] - 1e-9) key = `under the ${fmt(col[1])} mm JLC3DP asks of ${asks.join(" and ")} up to ${col[0]} mm long`;
      else key = "thick enough";
      if (key !== "thick enough" && worst === "pass") worst = "flag";
    }
    rank.set(key, key === "thick enough" ? 2 : x.mm < min - 1e-9 ? 0 : 1);
    const shown = fmt(x.mm, min, col[1], ...(x.fastener ? [FASTENER_WALL_MM] : []));
    groups.set(key, [...(groups.get(key) ?? []), { x, shown }]);
  }
  const order = [...groups.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const said = order.map((k) => {
    const xs = groups.get(k)!;
    return `${list(xs.map(({ x, shown }) => `${x.name} ${shown} mm (${x.from.join(", ")})`))} ${xs.length > 1 || xs[0].x.many ? "are" : "is"} ${k}`;
  });
  const edges = [...new Set(lines.map(how))].flatMap((p) => PRINT_WALLS[p].bySize.map(([s]) => s));
  const made = `printed ${list([...new Set(lines.map(how))])}; the case is ${fmt(w, ...edges)} x ${fmt(h, ...edges)} mm`;
  // Beside a failure, the flagged walls are named, so they don't read as failures too.
  const flagged = order.filter((k) => rank.get(k) === 1).flatMap((k) => groups.get(k)!.map(({ x }) => x.name));
  const ask = worst === "fail" ? `ask the print shop about ${list(flagged)} before ordering` : "ask the print shop before ordering";
  const call = flagged.length ? (skins ? `. JLC3DP doesn't say whether its table holds for a horizontal skin: ${ask}` : `: ${ask}`) : "";
  return { status: worst, detail: `${cap(said.join("; "))} (${made})${call}` };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The printed BOM lines with one of these roles. */
const printed = (c: Ctx, ...roles: string[]) => c.bom.lines.filter((l) => l.process === "print" && roles.includes(l.role));

const rules: Rule[] = [
  {
    id: "bom-roles",
    title: "Every part the design needs is in the BOM",
    needs: ["keyRows"],
    run: (c) => {
      const required = ["controller", "switch", "keycap", "pcb", "case-top", "case-bottom", "fastener-screw", "cable"];
      const missing = required.filter((r) => qty(c, r) === 0);
      return ok(missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "All required roles present");
    },
  },
  {
    id: "key-count",
    title: "Switches, sockets and keycaps match the key grid",
    needs: ["keyRows", "keyCols"],
    run: (c) => {
      const keys = n(c, "keyRows") * n(c, "keyCols");
      const got = { switch: qty(c, "switch"), keycap: qty(c, "keycap"), socket: qty(c, "switch-socket") };
      const bad = Object.entries(got).filter(([r, q]) => q !== keys && !(r === "socket" && q === 0));
      return ok(bad.length === 0, `${keys} keys; switches ${got.switch}, keycaps ${got.keycap}, sockets ${got.socket}`);
    },
  },
  {
    id: "gpio",
    title: "Controller has a free GPIO for every directly wired key",
    needs: ["keyRows", "keyCols", "controllerFreeGpio"],
    run: (c) => {
      const keys = n(c, "keyRows") * n(c, "keyCols");
      return ok(keys <= n(c, "controllerFreeGpio"), `${keys} keys need ${keys} GPIO; ${n(c, "controllerFreeGpio")} available`);
    },
  },
  {
    id: "usb-power",
    title: "Power draw fits the USB budget",
    needs: ["controllerCurrentMa", "usbBudgetMa"],
    run: (c) =>
      ok(n(c, "controllerCurrentMa") * 2 <= n(c, "usbBudgetMa"),
        `${n(c, "controllerCurrentMa")} mA typical (x2 margin) vs ${n(c, "usbBudgetMa")} mA from USB 2.0`),
  },
  {
    id: "mx-plate",
    title: "Plate matches the MX switch standard",
    needs: ["plateCutoutMm", "plateThicknessMm", "plateTopToPcbTopMm"],
    run: (c) => {
      const cut = n(c, "plateCutoutMm"), t = n(c, "plateThicknessMm"), drop = n(c, "plateTopToPcbTopMm");
      const good = Math.abs(cut - 14.0) <= 0.05 && Math.abs(t - 1.5) <= 0.1 && Math.abs(drop - 5.0) <= 0.1;
      return ok(good, `Cutout ${cut} mm (14.0), plate ${t} mm (1.5), plate top to PCB top ${drop} mm (5.0)`);
    },
  },
  {
    id: "keys-on-pcb",
    title: "Key grid fits on the PCB",
    needs: ["keyCols", "keyRows", "keyPitchMm", "pcbWidthMm", "pcbEdgeToKeyMm"],
    run: (c) => {
      // The grid is centred across the board and starts pcbEdgeToKeyMm from its near edge (cad/_params.py).
      const w = n(c, "keyCols") * n(c, "keyPitchMm"), d = n(c, "keyRows") * n(c, "keyPitchMm");
      const side = (n(c, "pcbWidthMm") - w) / 2;
      const far = "pcbHeightMm" in c.p ? n(c, "pcbHeightMm") - n(c, "pcbEdgeToKeyMm") - d : Infinity;
      return ok(side >= -0.01 && far >= -0.01,
        `Grid ${w.toFixed(2)} x ${d.toFixed(2)} mm: ${side.toFixed(2)} mm to each side edge, ${n(c, "pcbEdgeToKeyMm")} mm to the near edge` +
        (Number.isFinite(far) ? `, ${far.toFixed(2)} mm left beyond it` : ""));
    },
  },
  {
    id: "controller-zone",
    title: "Controller fits beside the keys and clear of screw holes",
    needs: ["controllerLengthMm", "controllerWidthMm", "controllerCenterXMm", "controllerCenterYMm", "pcbHeightMm"],
    run: (c) => {
      const pitch = n(c, "keyPitchMm"), H = n(c, "pcbHeightMm"), W = n(c, "pcbWidthMm");
      const keysTop = -H / 2 + n(c, "pcbEdgeToKeyMm") + n(c, "keyRows") * pitch;
      const y0 = n(c, "controllerCenterYMm") - n(c, "controllerWidthMm") / 2;
      const y1 = n(c, "controllerCenterYMm") + n(c, "controllerWidthMm") / 2;
      const x0 = n(c, "controllerCenterXMm") - n(c, "controllerLengthMm") / 2;
      const x1 = n(c, "controllerCenterXMm") + n(c, "controllerLengthMm") / 2;
      const holeY = H / 2 - n(c, "holeInsetMm"), holeX = W / 2 - n(c, "holeInsetMm");
      const keep = n(c, "holeKeepoutMm");
      const clearKeys = y0 >= keysTop;
      const clearHoles = [-holeX, holeX].every((hx) => {
        const dx = Math.max(x0 - hx, 0, hx - x1), dy = Math.max(y0 - holeY, 0, holeY - y1);
        return Math.hypot(dx, dy) >= keep;
      });
      const onBoard = x0 >= -W / 2 - 0.01 && x1 <= W / 2 + 0.01 && y1 <= H / 2;
      return ok(clearKeys && clearHoles && onBoard,
        `Controller y ${y0.toFixed(1)}..${y1.toFixed(1)} (keys end at ${keysTop.toFixed(2)}), x ${x0}..${x1}, ` +
        `holes ${clearHoles ? "clear" : "too close"} (keep-out ${keep} mm)`);
    },
  },
  {
    id: "usb-reach",
    title: "USB plug can seat through the case wall",
    needs: ["controllerCenterXMm", "controllerLengthMm", "caseClearanceMm", "caseWallMm", "usbMaxRecessMm"],
    run: (c) => {
      const edge = n(c, "pcbWidthMm") / 2 - (n(c, "controllerCenterXMm") + n(c, "controllerLengthMm") / 2);
      const recess = edge + n(c, "caseClearanceMm") + n(c, "caseWallMm");
      if (recess <= n(c, "usbMaxRecessMm")) return ok(true, `Port ${recess.toFixed(1)} mm behind the outer wall`);
      const fits = n(c, "usbOpeningWidthMm") >= n(c, "usbOvermoldWidthMm") && n(c, "usbOpeningHeightMm") >= n(c, "usbOvermoldHeightMm");
      return ok(fits,
        `Port ${recess.toFixed(1)} mm behind the outer wall, so the plug's overmold must enter the opening: ` +
        `opening ${n(c, "usbOpeningWidthMm")} x ${n(c, "usbOpeningHeightMm")} mm vs overmold ${n(c, "usbOvermoldWidthMm")} x ${n(c, "usbOvermoldHeightMm")} mm`);
    },
  },
  {
    id: "lid-headroom",
    title: "Lid clears the controller and its USB connector",
    needs: ["plateTopToPcbTopMm", "lidSkinOverControllerMm", "controllerHeightAbovePcbMm"],
    run: (c) => {
      const cavity = n(c, "plateTopToPcbTopMm") - n(c, "lidSkinOverControllerMm");
      const gap = cavity - n(c, "controllerHeightAbovePcbMm");
      return ok(gap >= n(c, "minClearanceMm"), `Cavity ${cavity.toFixed(1)} mm over a ${n(c, "controllerHeightAbovePcbMm")} mm tall controller: ${gap.toFixed(2)} mm clear`);
    },
  },
  {
    id: "socket-headroom",
    title: "Hot-swap sockets clear the tray floor",
    needs: ["standoffHeightMm", "socketHeightMm"],
    run: (c) => {
      const gap = n(c, "standoffHeightMm") - n(c, "socketHeightMm");
      return ok(gap >= n(c, "minClearanceMm"), `${n(c, "standoffHeightMm")} mm standoffs, ${n(c, "socketHeightMm")} mm sockets: ${gap.toFixed(2)} mm clear`);
    },
  },
  {
    id: "screw-engagement",
    title: "Screws reach the inserts without bottoming out",
    needs: ["screwLengthMm", "trayFloorMm", "standoffHeightMm", "pcbThicknessMm", "insertLengthMm"],
    run: (c) => {
      const through = n(c, "trayFloorMm") - n(c, "screwHeadHeightMm") + n(c, "standoffHeightMm") + n(c, "pcbThicknessMm");
      const engage = n(c, "screwLengthMm") - through;
      const good = engage >= n(c, "minThreadEngagementMm") && engage <= n(c, "insertLengthMm");
      return ok(good, `Counterbored head, ${through.toFixed(2)} mm to the insert, ${engage.toFixed(2)} mm of thread engaged (insert ${n(c, "insertLengthMm")} mm)`);
    },
  },
  {
    id: "insert-depth",
    title: "Heat-set inserts fit inside the bosses with a closed top",
    needs: ["insertLengthMm", "plateTopToPcbTopMm", "minSkinOverInsertMm"],
    run: (c) => {
      const skin = n(c, "plateTopToPcbTopMm") - n(c, "insertLengthMm");
      return ok(skin >= n(c, "minSkinOverInsertMm"), `${n(c, "insertLengthMm")} mm insert in a ${n(c, "plateTopToPcbTopMm")} mm boss leaves ${skin.toFixed(1)} mm on top`);
    },
  },
  {
    id: "holes-clear-keys",
    title: "Screw bosses clear the switch housings",
    needs: ["keyRows", "keyCols", "keyPitchMm", "pcbWidthMm", "pcbHeightMm", "pcbEdgeToKeyMm", "holeInsetMm", "plateCutoutMm", "bossOuterMm"],
    run: (c) => {
      // Each boss runs from the PCB up to the plate, beside the switches' lower housings (the plate cutout square).
      const W = n(c, "pcbWidthMm"), H = n(c, "pcbHeightMm"), pitch = n(c, "keyPitchMm"), half = n(c, "plateCutoutMm") / 2;
      const need = n(c, "bossOuterMm") / 2 + (Number(c.p.minClearanceMm) || 0);
      const keys: [number, number][] = [];
      for (let r = 0; r < n(c, "keyRows"); r++)
        for (let k = 0; k < n(c, "keyCols"); k++)
          keys.push([(k - (n(c, "keyCols") - 1) / 2) * pitch, -H / 2 + n(c, "pcbEdgeToKeyMm") + pitch * (r + 0.5)]);
      const hx = W / 2 - n(c, "holeInsetMm"), hy = H / 2 - n(c, "holeInsetMm");
      let least = Infinity;
      for (const [x, y] of [[-hx, -hy], [-hx, hy], [hx, -hy], [hx, hy]])
        for (const [kx, ky] of keys)
          least = Math.min(least, Math.hypot(Math.max(Math.abs(x - kx) - half, 0), Math.max(Math.abs(y - ky) - half, 0)));
      return ok(least >= need - 1e-6,
        `Nearest hole centre ${least.toFixed(2)} mm from a switch housing; the ${n(c, "bossOuterMm")} mm boss needs ${need.toFixed(2)} mm`);
    },
  },
  {
    id: "feet-clear-heads",
    title: "Rubber feet keep screw heads off the desk",
    needs: ["footHeightMm", "screwHeadHeightMm", "counterboreDepthMm"],
    run: (c) => {
      const proud = Math.max(0, n(c, "screwHeadHeightMm") - n(c, "counterboreDepthMm"));
      const gap = n(c, "footHeightMm") - proud;
      return ok(gap >= (Number(c.p.minClearanceMm) || 0),
        `Heads ${proud.toFixed(2)} mm proud of the floor (${n(c, "screwHeadHeightMm")} mm heads in ${n(c, "counterboreDepthMm")} mm counterbores); ` +
        `${n(c, "footHeightMm")} mm feet leave ${gap.toFixed(2)} mm to the desk`);
    },
  },
  {
    id: "print-walls",
    title: "Printed case walls are thick enough to print",
    needs: ["caseWallMm", "caseClearanceMm", "pcbWidthMm", "pcbHeightMm"],
    run: (c) => printWalls(c, [
      { name: "case walls", from: ["caseWallMm"], mm: n(c, "caseWallMm"), parts: printed(c, "case-top", "case-bottom"), many: true },
      // The walls round each screw's hole in the tray's standoffs and round each insert in the lid's bosses.
      { name: "standoff walls", from: ["standoffOuterMm", "screwClearanceMm"], mm: (n(c, "standoffOuterMm") - n(c, "screwClearanceMm")) / 2, parts: printed(c, "case-bottom"), fastener: true, optional: true, many: true },
      { name: "boss walls", from: ["bossOuterMm", "insertOuterMm"], mm: (n(c, "bossOuterMm") - n(c, "insertOuterMm")) / 2, parts: printed(c, "case-top"), fastener: true, optional: true, many: true },
    ], false),
  },
  {
    id: "print-skins",
    title: "Printed skins are thick enough to print",
    needs: ["plateThicknessMm", "lidSkinOverControllerMm", "caseWallMm", "caseClearanceMm", "pcbWidthMm", "pcbHeightMm"],
    run: (c) => printWalls(c, [
      { name: "the plate", from: ["plateThicknessMm"], mm: n(c, "plateThicknessMm"), parts: printed(c, "case-top") },
      { name: "the skin over the controller", from: ["lidSkinOverControllerMm"], mm: n(c, "lidSkinOverControllerMm"), parts: printed(c, "case-top") },
      { name: "the skin over the inserts", from: ["plateTopToPcbTopMm", "insertLengthMm"], mm: n(c, "plateTopToPcbTopMm") - n(c, "insertLengthMm"), parts: printed(c, "case-top"), optional: true },
      { name: "the tray floor", from: ["trayFloorMm"], mm: n(c, "trayFloorMm"), parts: printed(c, "case-bottom"), optional: true },
    ], true),
  },
  {
    id: "standards",
    title: "Regulatory standards",
    needs: ["keyRows"],
    run: () => ({
      status: "flag",
      detail:
        "A USB keyboard is an unintentional radiator: selling it in the US needs FCC Part 15B (EU: CE, EMC directive). " +
        "Building one for yourself needs nothing. Using a pre-certified Pico doesn't cover the finished product.",
    }),
  },
];

/** A rule in products/<slug>/rules.ts. One with the id of a built-in replaces it; `{ id, off: true }` drops it. */
export type LocalRule = Rule | { id: string; off: true };

export function runChecks(design: Design, bom: Bom, extra: LocalRule[] = []): Checks {
  const c: Ctx = { p: design.params, bom };
  const problems: Check[] = [];
  const seen = new Set<string>();
  for (const r of extra) {
    if (seen.has(r.id)) problems.push({ id: `rules:${r.id}`, title: `rules.ts: rule id "${r.id}" is used twice`, status: "fail", detail: "Give each rule its own id; a rule with a built-in's id replaces that built-in." });
    seen.add(r.id);
  }
  const local = new Map(extra.map((r) => [r.id, r]));
  const list = [...rules.map((r) => local.get(r.id) ?? r), ...extra.filter((r) => !rules.some((b) => b.id === r.id))]
    .filter((r): r is Rule => !("off" in r && r.off));
  const missing = (r: Rule) => r.needs.filter((k) => !(k in c.p));
  const skipped: SkippedCheck[] = list.filter((r) => r.needs.length && missing(r).length === r.needs.length)
    .map((r) => ({ id: r.id, title: r.title, missing: missing(r) }));
  const checks: Check[] = [
    ...problems,
    ...list.filter((r) => !skipped.some((x) => x.id === r.id)).map((r): Check => {
      const lack = missing(r);
      if (!lack.length) return { id: r.id, title: r.title, ...r.run(c) };
      const has = r.needs.filter((k) => !lack.includes(k));
      // A built-in is dropped with { id, off: true }; a rule of rules.ts by deleting it there.
      const drop = local.has(r.id) ? "delete it from rules.ts" : `drop it in rules.ts with { id: "${r.id}", off: true }`;
      return {
        id: r.id, title: r.title, status: "fail",
        detail: `Can't run: design.json has ${has.join(", ")} but not ${lack.join(", ")}. Add ${lack.length === 1 ? "it" : "them"}, or if the check doesn't fit this product, ${drop}`,
      };
    }),
  ];
  return {
    slug: bom.slug,
    checks,
    failed: checks.filter((x) => x.status === "fail").length,
    flagged: checks.filter((x) => x.status === "flag").length,
    skipped,
  };
}
