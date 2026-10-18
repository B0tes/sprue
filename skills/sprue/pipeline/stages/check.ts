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
 * ("Min. wall thickness: 1 mm" for PETG and PLA, 0.8 mm for HP MJF PA12; craftcloud3d.com/en/material-guide/petg,
 * /pla, /hp-mjf-nylon-pa12). `bySize` is JLC3DP's guideline (jlc3dp.com/help/article/3D-Printing-Design-Guideline),
 * keyed to the part's size: the column is the smallest its longest side fits in, the last for a larger part (the page
 * says neither what size means nor whether a horizontal skin counts as a wall), so a wall under it is a person's call.
 * JLC3DP prints no PETG, and its own FDM pages say 1.2 mm with no size, so it is a reference, not the shop's limit. */
export const PRINT_WALLS: Record<string, { min: number; minFrom: string; bySize: [number, number][] }> = {
  FDM: { min: 1.0, minFrom: "Craftcloud", bySize: [[50, 1.6], [100, 2.0], [200, 2.5]] },
  "MJF/SLS": { min: 0.8, minFrom: "Craftcloud", bySize: [[5, 1.0], [10, 1.2], [50, 1.5], [100, 2.0], [200, 2.0]] },
};
/** JLC3DP: "The recommended minimum wall thickness for structures such as protrusion, positioning, snaps and fasteners
 * is more than 1.5mm", whatever the process or size. */
export const FASTENER_WALL_MM = 1.5;

/** How a printed line is made: its spec.process when it names one, else what its material is printed by. */
export function printProcess(line: BomLine): string | undefined {
  const p = String(line.spec.process ?? "").trim().toUpperCase(), m = String(line.spec.material ?? "");
  if (p) return /^(FDM|FFF)$/.test(p) ? "FDM" : /^(MJF|SLS)$/.test(p) ? "MJF/SLS" : /^(M?SLA|DLP)$/.test(p) ? "SLA" : p;
  if (/^(r?PETG|PCTG|PLA|ABS|ASA|TPU|HIPS|PC)\b/i.test(m)) return "FDM";
  if (/^PA ?1[12]\b/i.test(m)) return "MJF/SLS";
  if (/resin/i.test(m)) return "SLA";
  return undefined;
}

/** A printed wall, skin or wall round a fastener of the case, held to the print processes of the parts it is in: under
 * the shop's least wall fails, under JLC3DP's figure for the part's size (for a wall round a fastener, not over
 * 1.5 mm) is flagged. `from`: the params it is worked out from, so the problem names what to change; `many`: the name
 * is plural ("case walls"). */
type Wall = { name: string; from: string; mm: number; parts: BomLine[]; fastener?: boolean; many?: boolean };
function printWalls(c: Ctx, walls: Wall[], skins: boolean): Omit<Check, "id" | "title"> {
  const side = (k: string) => n(c, k) + 2 * (n(c, "caseClearanceMm") + n(c, "caseWallMm"));
  const w = side("pcbWidthMm"), h = side("pcbHeightMm"), longest = Math.max(w, h);
  const held = walls.filter((x) => x.parts.length);
  if (!held.length) return ok(true, "The case isn't printed (no print line with role case-top or case-bottom)");
  const how = (l: BomLine) => printProcess(l) ?? `?${l.id}`;
  const unknown = [...new Set(held.flatMap((x) => x.parts.map(how)))].filter((p) => !PRINT_WALLS[p]);
  if (unknown.length) return {
    status: "fail",
    detail: cap(unknown.map((p) => p.startsWith("?")
      ? `can't tell how ${p.slice(1)} is printed: give its spec.process (FDM, MJF, SLS or SLA)`
      : `Sprue has no print shop's least wall for ${p} yet: add one, with its page, to PRINT_WALLS in pipeline/stages/check.ts`).join("; ")),
  };
  const fmt = (x: number) => Number(x.toFixed(2)).toString();
  const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  // Each wall's limits: the strictest of its parts', each by its own process. Walls under the same limit are said together.
  const groups = new Map<string, Wall[]>();
  let worst: Check["status"] = "pass";
  for (const x of held) {
    // Named by the processes whose limit it is.
    const procs = [...new Set(x.parts.map(how))];
    const min = Math.max(...procs.map((p) => PRINT_WALLS[p].min)), least = procs.filter((p) => PRINT_WALLS[p].min === min);
    const cols = procs.map((p) => PRINT_WALLS[p].bySize.find(([s]) => longest <= s) ?? PRINT_WALLS[p].bySize[PRINT_WALLS[p].bySize.length - 1]);
    const col = cols.reduce((a, b) => (b[1] > a[1] ? b : a)), asks = procs.filter((_, i) => cols[i][1] === col[1]);
    let key: string;
    if (x.mm < min - 1e-9) { key = `under the ${fmt(min)} mm ${PRINT_WALLS[least[0]].minFrom} takes of ${least.join(" and ")}`; worst = "fail"; }
    else if (x.fastener ? x.mm <= FASTENER_WALL_MM + 1e-9 : x.mm < col[1] - 1e-9) {
      key = x.fastener ? `not over the ${fmt(FASTENER_WALL_MM)} mm JLC3DP asks round fasteners`
        : `under the ${fmt(col[1])} mm JLC3DP asks of ${asks.join(" and ")} ${longest <= col[0] ? `up to ${col[0]} mm` : `past ${col[0]} mm`} long`;
      if (worst === "pass") worst = "flag";
    } else key = "thick enough";
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const order = [...groups.keys()].sort((a, b) => Number(a === "thick enough") - Number(b === "thick enough"));
  const said = order.map((k) => {
    const xs = groups.get(k)!;
    return `${list(xs.map((x) => `${x.name} ${fmt(x.mm)} mm (${x.from})`))} ${xs.length > 1 || xs[0].many ? "are" : "is"} ${k}`;
  });
  const asked = `printed ${list([...new Set(held.flatMap((x) => x.parts.map(how)))])}; the case is ${fmt(w)} x ${fmt(h)} mm`;
  const call = worst === "flag" ? (skins ? ". JLC3DP doesn't say whether its table holds for a horizontal skin: ask the print shop before ordering"
    : ": ask the print shop before ordering") : "";
  return { status: worst, detail: `${cap(said.join("; "))} (${asked})${call}` };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The printed BOM lines with one of these roles. */
const printed = (c: Ctx, ...roles: string[]) => c.bom.lines.filter((l) => l.process === "print" && roles.includes(l.role));
const has = (c: Ctx, ...ks: string[]) => ks.every((k) => k in c.p);

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
      { name: "case walls", from: "caseWallMm", mm: n(c, "caseWallMm"), parts: printed(c, "case-top", "case-bottom"), many: true },
      // The walls round each screw's hole in the tray's standoffs and round each insert in the lid's bosses.
      ...(has(c, "standoffOuterMm", "screwClearanceMm") ? [{ name: "standoff walls", from: "standoffOuterMm, screwClearanceMm", mm: (n(c, "standoffOuterMm") - n(c, "screwClearanceMm")) / 2, parts: printed(c, "case-bottom"), fastener: true, many: true }] : []),
      ...(has(c, "bossOuterMm", "insertOuterMm") ? [{ name: "boss walls", from: "bossOuterMm, insertOuterMm", mm: (n(c, "bossOuterMm") - n(c, "insertOuterMm")) / 2, parts: printed(c, "case-top"), fastener: true, many: true }] : []),
    ], false),
  },
  {
    id: "print-skins",
    title: "Printed skins are thick enough to print",
    needs: ["plateThicknessMm", "lidSkinOverControllerMm", "caseWallMm", "caseClearanceMm", "pcbWidthMm", "pcbHeightMm"],
    run: (c) => printWalls(c, [
      { name: "the plate", from: "plateThicknessMm", mm: n(c, "plateThicknessMm"), parts: printed(c, "case-top") },
      { name: "the skin over the controller", from: "lidSkinOverControllerMm", mm: n(c, "lidSkinOverControllerMm"), parts: printed(c, "case-top") },
      ...(has(c, "plateTopToPcbTopMm", "insertLengthMm") ? [{ name: "the skin over the inserts", from: "plateTopToPcbTopMm, insertLengthMm", mm: n(c, "plateTopToPcbTopMm") - n(c, "insertLengthMm"), parts: printed(c, "case-top") }] : []),
      ...(has(c, "trayFloorMm") ? [{ name: "the tray floor", from: "trayFloorMm", mm: n(c, "trayFloorMm"), parts: printed(c, "case-bottom") }] : []),
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
