// The design stage's engineer checks. Each check reads design params and BOM lines and either
// passes, fails (the thing won't work or won't fit) or flags (needs a human decision).
// A check whose params the design has none of is skipped (listed in checks.json `skipped`), so the same list
// grows across products on the reference ladder; one with some of its params but not all fails, since that is most
// often a param left out, and a check that quietly doesn't run is how a fault gets through. A product can add its own rules in
// products/<slug>/rules.ts (export const rules: Rule[]), which run after these; a rule there with the id of
// one of these replaces it, and { id, off: true } drops it.

import type { Bom, Check, Checks, Design, SkippedCheck } from "../types.ts";

export type Ctx = { p: Record<string, number | string>; bom: Bom };
export type Rule = { id: string; title: string; needs: string[]; run: (c: Ctx) => Omit<Check, "id" | "title"> };

const n = (c: Ctx, k: string) => Number(c.p[k]);
const qty = (c: Ctx, role: string) =>
  c.bom.lines.filter((l) => l.role === role).reduce((s, l) => s + l.qtyPerUnit, 0);
const ok = (cond: boolean, detail: string): Omit<Check, "id" | "title"> => ({
  status: cond ? "pass" : "fail",
  detail,
});

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
      return {
        id: r.id, title: r.title, status: "fail",
        detail: `Can't run: design.json has ${has.join(", ")} but not ${lack.join(", ")}. Add ${lack.length === 1 ? "it" : "them"}, or if the check doesn't fit this product, drop it in rules.ts with { id: "${r.id}", off: true }`,
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
