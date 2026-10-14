// The design rules the PCB kit holds a board to. They are conservative: at or above the published limits of
// JLCPCB's 2-layer service (https://jlcpcb.com/capabilities/pcb-capabilities, read 2026-10-14), so a board that
// passes our DRC is inside what they say they can make. It is still our DRC, not the fab's own.

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
  /** Plated hole: pad edge to drill edge, all round. JLCPCB publishes 0.18 mm as the absolute minimum. */
  ringMm: 0.18,
  /** Smallest plated hole and smallest non-plated hole. */
  drillMinMm: 0.3,
  npthMinMm: 0.5,
  /** Hole edge to hole edge. JLCPCB publishes 0.45 mm for pad holes; below `holeGapWarnMm` is reported. */
  holeGapMm: 0.45,
  holeGapWarnMm: 0.5,
  /** Hole edge to the board edge. */
  holeEdgeMm: 0.5,
  /** Silkscreen: thinnest line, smallest text, and how far it stays from pads, holes and the edge. */
  silkLineMm: 0.15,
  silkTextMm: 1.0,
  silkPadGapMm: 0.1,
  silkEdgeMm: 0.25,
  /** Solder mask: each opening is its pad grown by this on every side, and two openings keep this much between them. */
  maskExpandMm: 0.05,
  maskWebMm: 0.1,
  /** The pour: clearance to other-net copper, inset from the edge, and the width of a thermal spoke. */
  pourClearanceMm: 0.3,
  pourInsetMm: 0.5,
  spokeMm: 0.4,
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

/** What each rule is checked against, for drc.json. */
export const RULE_NOTES: Record<keyof Rules, string> = {
  trackMm: "signal trace width (JLCPCB: 0.10 mm minimum)",
  trackMinMm: "thinnest trace the DRC accepts",
  clearanceMm: "copper to copper, different nets (JLCPCB: 0.10 mm)",
  edgeMm: "copper to board edge (JLCPCB: 0.20 mm)",
  holeClearMm: "copper to non-plated hole edge",
  viaDrillMm: "via drill (JLCPCB: 0.15 mm minimum)",
  viaPadMm: "via pad (JLCPCB: 0.25 mm minimum)",
  ringMm: "plated hole annular ring (JLCPCB: 0.18 mm absolute minimum)",
  drillMinMm: "smallest plated hole",
  npthMinMm: "smallest non-plated hole (JLCPCB: 0.50 mm)",
  holeGapMm: "hole edge to hole edge, error below (JLCPCB: 0.45 mm for pad holes)",
  holeGapWarnMm: "hole edge to hole edge, warning below",
  holeEdgeMm: "hole edge to board edge",
  silkLineMm: "silkscreen line width (JLCPCB: 0.15 mm)",
  silkTextMm: "silkscreen text height (JLCPCB: 1.0 mm)",
  silkPadGapMm: "silkscreen to mask openings and holes",
  silkEdgeMm: "silkscreen to board edge",
  maskExpandMm: "mask opening growth per side",
  maskWebMm: "mask between two openings (JLCPCB: 0.10 mm green)",
  pourClearanceMm: "pour to other-net copper",
  pourInsetMm: "pour inset from the board edge",
  spokeMm: "thermal relief spoke width",
  copperMinMm: "narrowest neck of pour: the fill clears thinner ones, the audit rejects any left (JLCPCB: 0.10 mm)",
  thinTipMm2: "area of thin pour let through, the tip of a corner",
  thinGridMm: "raster pixel of the thin-copper check",
  viaTentGapMm: "via pad to pad edge, so the via stays tented",
  gridMm: "router grid",
};
