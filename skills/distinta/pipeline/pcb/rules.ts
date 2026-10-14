// The design rules the PCB kit holds a board to, and the published 2-layer limits of four fabs (FAB_PROFILES). The
// rules are at least as strict as every profile (kit.test.ts holds them to it), so a board that passes our DRC is
// inside what each of them says it can make. It is still our DRC, not a fab's own check. The audit (drc.ts) also
// measures the board's smallest features and lists, in drc.json, which profiles they pass and why any does not.

const values = {
  /** A signal trace. */
  trackMm: 0.3,
  /** The thinnest trace the DRC accepts. */
  trackMinMm: 0.25,
  /** Between copper of different nets on one layer. */
  clearanceMm: 0.2,
  /** Copper to the board edge. */
  edgeMm: 0.5,
  /** Copper to the edge of a non-plated hole. */
  holeClearMm: 0.3,
  /** A via: the drill and the pad. */
  viaDrillMm: 0.4,
  viaPadMm: 0.8,
  /** Smallest and largest via drill: Aisler makes vias of 0.3 to 0.45 mm, and a larger plated hole is a component hole. */
  drillMinMm: 0.3,
  viaDrillMaxMm: 0.45,
  /** A via's annular ring, pad edge to drill edge all round (Aisler: 0.2 mm). */
  viaRingMm: 0.2,
  /** A plated component hole (a pad with a drill): smallest drill and ring (Aisler: 0.5 mm and 0.3 mm). */
  pthDrillMinMm: 0.5,
  pthRingMm: 0.3,
  /** Smallest non-plated hole. */
  npthMinMm: 0.5,
  /** Hole edge to hole edge. JLCPCB publishes 0.45 mm for pad holes; below `holeGapWarnMm` is reported. */
  holeGapMm: 0.45,
  holeGapWarnMm: 0.5,
  /** Hole edge to the board edge. */
  holeEdgeMm: 0.5,
  /** Silkscreen: thinnest line, smallest text, and how far it stays from the pads' mask openings and the holes, and
   * from the edge. 0.15 mm from an opening is 0.2 mm from the copper, above JLCPCB's 0.15 mm. */
  silkLineMm: 0.15,
  silkTextMm: 1.0,
  silkPadGapMm: 0.15,
  silkEdgeMm: 0.25,
  /** Solder mask: each opening is its pad grown by this on every side, and two openings keep this much between them. */
  maskExpandMm: 0.05,
  maskWebMm: 0.1,
  /** The pour: clearance to other-net copper, inset from the edge, and the width of a thermal spoke. */
  pourClearanceMm: 0.3,
  pourInsetMm: 0.5,
  spokeMm: 0.4,
  /** A pad joined to its pour through a thermal relief reaches the pour by at least this many spokes (KiCad's
   * default: fewer is a starved thermal, an error there). */
  minSpokes: 2,
  /** The narrowest copper the fab is asked to etch in the pour, such as the neck between two cut-outs. It is measured
   * on a raster of `thinGridMm` (thin.ts), so to within a pixel or two. The pour fill clears thinner necks, as a zone
   * fill does; the audit rejects any left. The board's own copper (pads, tracks, vias, spokes) is not measured on the
   * raster: a track is held to `trackMinMm` on the track itself. `thinTipMm2` is the area of thin pour let through:
   * the point of a corner is always thin at its tip. */
  copperMinMm: 0.25,
  thinTipMm2: 0.03,
  thinGridMm: 0.05,
  /** A via stays this far from any pad's edge, so its mask stays closed over it (tented). */
  viaTentGapMm: 0.1,
  /** The router's grid. */
  gridMm: 0.1,
};

export type Rules = Readonly<typeof values>;

/** Frozen: the audit and the board code (as `pcb.rules`) hold this very object, so no one may loosen it. */
export const RULES: Rules = Object.freeze(values);

/** What each rule is checked against, for drc.json. "Strictest" is the strictest of FAB_PROFILES. */
export const RULE_NOTES: Record<keyof Rules, string> = {
  trackMm: "signal trace width",
  trackMinMm: "thinnest trace the DRC accepts (strictest fab: Aisler 0.2 mm)",
  clearanceMm: "copper to copper, different nets (strictest fab: OSH Park 0.1524 mm)",
  edgeMm: "copper to board edge (strictest fab: OSH Park 0.381 mm)",
  holeClearMm: "copper to non-plated hole edge (strictest fab: Aisler 0.25 mm)",
  viaDrillMm: "via drill",
  viaPadMm: "via pad",
  drillMinMm: "smallest via drill (strictest fab: Aisler 0.3 mm)",
  viaDrillMaxMm: "largest via drill (Aisler: 0.45 mm; a larger plated hole is a component hole)",
  viaRingMm: "via annular ring (strictest fab: Aisler 0.2 mm)",
  pthDrillMinMm: "smallest plated component hole (Aisler: 0.5 mm)",
  pthRingMm: "plated component hole annular ring (strictest fab: Aisler 0.3 mm)",
  npthMinMm: "smallest non-plated hole (JLCPCB and Aisler: 0.5 mm)",
  holeGapMm: "hole edge to hole edge, error below (strictest fab: JLCPCB 0.45 mm for pad holes)",
  holeGapWarnMm: "hole edge to hole edge, warning below",
  holeEdgeMm: "hole edge to board edge",
  silkLineMm: "silkscreen line width (strictest fab: 0.15 mm)",
  silkTextMm: "silkscreen text height (strictest fab: JLCPCB 1.0 mm)",
  silkPadGapMm: "silkscreen to mask openings and holes (to the copper: 0.2 mm, strictest fab JLCPCB 0.15 mm)",
  silkEdgeMm: "silkscreen to board edge",
  maskExpandMm: "mask opening growth per side",
  maskWebMm: "mask between two openings (JLCPCB: 0.10 mm green)",
  pourClearanceMm: "pour to other-net copper",
  pourInsetMm: "pour inset from the board edge",
  spokeMm: "thermal relief spoke width",
  minSpokes: "thermal spokes that reach the pour, per relieved pad (KiCad's default)",
  copperMinMm: "narrowest neck of pour: the fill clears thinner ones, the audit rejects any left",
  thinTipMm2: "area of thin pour let through, the tip of a corner",
  thinGridMm: "raster pixel of the thin-copper check",
  viaTentGapMm: "via pad to pad edge, so the via stays tented",
  gridMm: "router grid",
};

// ---- the fabs ---------------------------------------------------------------------------------------------

/** A feature a fab limits, as the audit measures it on a board: the smallest on the board (the largest for
 * `viaDrillMaxMm`). `ours` is what our rules allow of it, which must be no looser than any profile's limit. */
type Feature = { what: string; max?: true; ours: (r: Rules) => number };

export const FAB_FEATURES = {
  trackMinMm: { what: "narrowest copper (a track, a spoke or a neck of pour)", ours: (r) => Math.min(r.trackMinMm, r.copperMinMm) },
  clearanceMm: { what: "copper to copper of another net", ours: (r) => r.clearanceMm },
  edgeMm: { what: "copper to the board edge", ours: (r) => r.edgeMm },
  drillMinMm: { what: "smallest via drill", ours: (r) => r.drillMinMm },
  viaDrillMaxMm: { what: "largest via drill", max: true, ours: (r) => r.viaDrillMaxMm },
  viaRingMm: { what: "via annular ring", ours: (r) => r.viaRingMm },
  pthDrillMinMm: { what: "smallest plated component hole", ours: (r) => r.pthDrillMinMm },
  pthRingMm: { what: "plated component hole annular ring", ours: (r) => r.pthRingMm },
  npthMinMm: { what: "smallest non-plated hole", ours: (r) => r.npthMinMm },
  holeClearMm: { what: "copper to a non-plated hole's edge", ours: (r) => r.holeClearMm },
  holeGapMm: { what: "hole to hole, edge to edge, of a component or non-plated hole", ours: (r) => r.holeGapMm },
  viaGapMm: { what: "via to via, edge to edge", ours: (r) => r.holeGapMm },
  silkLineMm: { what: "thinnest silkscreen line", ours: (r) => r.silkLineMm },
  silkTextMm: { what: "smallest silkscreen text", ours: (r) => r.silkTextMm },
  silkPadMm: { what: "silkscreen to pad copper", ours: (r) => r.silkPadGapMm + r.maskExpandMm },
  maskWebMm: { what: "solder mask between two openings", ours: (r) => r.maskWebMm },
} satisfies Record<string, Feature>;

export type FabFeature = keyof typeof FAB_FEATURES;
/** The board's smallest (or largest) of each feature it has, and where: drc.ts measures it. */
export type Measured = Partial<Record<FabFeature, { mm: number; at: string }>>;

export type FabProfile = {
  name: string;
  service: string;
  /** Where the numbers are published, and when they were read. */
  source: string;
  read: string;
  /** The fab's limit for each feature it publishes one for; a feature it gives none for is not checked. */
  limits: Partial<Record<FabFeature, number>>;
  /** How far the routed outline may be from the drawing, for the case fit: not checked here. */
  outlineTolMm?: number;
  notes: string[];
};

const mil = (v: number) => Math.round(v * 0.0254 * 1e4) / 1e4;

/** The four fabs' published limits for a 2-layer, 1.6 mm board, as research/pcb-verification.md section 3 gives them
 * (read 2026-10-14). Frozen, as RULES is. */
export const FAB_PROFILES: Readonly<Record<string, Readonly<FabProfile>>> = Object.freeze({
  jlcpcb: Object.freeze({
    name: "JLCPCB",
    service: "2-layer, 1.6 mm",
    source: "https://jlcpcb.com/capabilities/pcb-capabilities",
    read: "2026-10-14",
    limits: {
      trackMinMm: 0.1, clearanceMm: 0.1, edgeMm: 0.2,
      // Its via pad minimum (0.25 mm) is looser than its drill plus two rings, so the two below cover it.
      drillMinMm: 0.15, viaRingMm: 0.18, pthRingMm: 0.18, // the plated-hole ring: 0.18 absolute minimum, 0.25 recommended
      npthMinMm: 0.5, holeClearMm: 0.2, holeGapMm: 0.45, viaGapMm: 0.2,
      silkLineMm: 0.15, silkTextMm: 1.0, silkPadMm: 0.15, maskWebMm: 0.1, // the mask web is for green
    },
    outlineTolMm: 0.2,
    notes: ["X2 attributes override the file names when they disagree (jlcpcb.com/help/article/Misidentified-Layers-Why-Not-Follow-Gerber-X2-Standards)"],
  }),
  pcbway: Object.freeze({
    name: "PCBWay",
    service: "2-layer Standard",
    source: "https://www.pcbway.com/capabilities.html",
    read: "2026-10-14",
    limits: {
      trackMinMm: 0.1, clearanceMm: 0.1,
      edgeMm: 0.25, // for its Advanced service, CNC routed
      drillMinMm: 0.15, viaRingMm: 0.15, pthRingMm: 0.15, // the Advanced service asks 0.203 mm for component holes
      holeGapMm: mil(16), viaGapMm: mil(11), // the Advanced service's numbers: Standard gives none
      silkLineMm: 0.15, silkTextMm: 0.8,
    },
    outlineTolMm: 0.2,
    notes: ["publishes no non-plated hole minimum, no copper-to-hole and no silkscreen-to-pad limit"],
  }),
  oshpark: Object.freeze({
    name: "OSH Park",
    service: "2-layer",
    source: "https://docs.oshpark.com/services/two-layer/ and /submitting-orders/drill-specs/",
    read: "2026-10-14",
    limits: {
      trackMinMm: mil(6), clearanceMm: mil(6), edgeMm: mil(15), drillMinMm: mil(10), viaRingMm: mil(5), pthRingMm: mil(5),
      holeGapMm: mil(5), viaGapMm: mil(5), // 5 mil recommended
      silkLineMm: mil(5),
    },
    notes: ["does not document how it handles non-plated holes, and this board depends on them"],
  }),
  aisler: Object.freeze({
    name: "Aisler",
    service: "2-layer, 1.6 mm, 35 µm, HASL",
    source: "https://community.aisler.net/t/2-layer-1-6-mm-35-m-hasl-design-rules/3735",
    read: "2026-10-14",
    limits: {
      trackMinMm: 0.2, clearanceMm: 0.15, edgeMm: 0.3,
      drillMinMm: 0.3, viaDrillMaxMm: 0.45, viaRingMm: 0.2, // vias of 0.3 to 0.45 mm
      pthDrillMinMm: 0.5, pthRingMm: 0.3, npthMinMm: 0.5, holeClearMm: 0.25, holeGapMm: 0.3, viaGapMm: 0.3,
      silkLineMm: 0.15, silkTextMm: 0.8, silkPadMm: 0.125, // and no silkscreen on pads
    },
    notes: [],
  }),
});

const EPS = 0.001;

/** Why a board with these measured features is outside a profile's limits: one sentence per feature, none when it
 * is inside them all. A feature the board does not have (no vias, no plated component holes) passes. */
export function fabFit(measured: Measured, profile: FabProfile): string[] {
  const why: string[] = [];
  for (const [k, limit] of Object.entries(profile.limits) as [FabFeature, number][]) {
    const m = measured[k], f: Feature = FAB_FEATURES[k];
    if (!m || (f.max ? m.mm <= limit + EPS : m.mm >= limit - EPS)) continue;
    why.push(`${f.what} is ${m.mm} mm (${m.at}), ${f.max ? "over" : "under"} ${profile.name}'s ${limit} mm`);
  }
  return why;
}

/** Each profile, and whether the board's measured features are inside it, for drc.json. */
export function fabFits(measured: Measured): Record<string, { name: string; ok: boolean; why: string[] }> {
  return Object.fromEntries(Object.entries(FAB_PROFILES).map(([id, p]) => {
    const why = fabFit(measured, p);
    return [id, { name: `${p.name} ${p.service}`, ok: !why.length, why }];
  }));
}

/** Where our rules are looser than a profile: empty while RULES is at least as strict as every fab. */
export function looserThanFabs(rules: Rules): string[] {
  const out: string[] = [];
  for (const p of Object.values(FAB_PROFILES))
    for (const [k, limit] of Object.entries(p.limits) as [FabFeature, number][]) {
      const f: Feature = FAB_FEATURES[k], ours = f.ours(rules);
      if (f.max ? ours > limit + 1e-9 : ours < limit - 1e-9) out.push(`${f.what}: ours ${ours} mm, ${p.name}'s ${limit} mm`);
    }
  return out;
}
