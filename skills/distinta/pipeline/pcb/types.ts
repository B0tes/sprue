// The PCB kit's data model. pcb.mjs builds a Board (board.ts); everything after that works from these plain
// records: the router, the DRC, the Gerber and Excellon writers and the SVG previews all read the same lists.
// Units are millimetres. The frame is the PCB's: origin at the board centre, x to the right, y up, seen from the
// top. The bottom layers use the same frame (a Gerber file is never mirrored); the SVG bottom view mirrors it.

export type Pt = [number, number];
export type Layer = "F.Cu" | "B.Cu";
export type Side = "top" | "bottom";

export type PadShape = "rect" | "circle" | "oval";
/** What a pad is for, as its footprint tags it: a controller's "gpio", "gnd", "power" (a supply: VBUS, VSYS, 3V3(OUT),
 * ADC_VREF) or "control" pin (RUN, 3V3_EN), or a "switch" contact. The intent check (intent.ts) reads it. */
export type PadKind = "gpio" | "gnd" | "power" | "control" | "switch";

export type Pad = {
  /** The footprint's reference ("K1", "U1"), or "" for a pad placed by hand. */
  ref: string;
  /** The pad's name inside its footprint: "A", "B", "4". */
  num: string;
  /** What the pad is for, when several pads may share it: "GP2", "GND". */
  name?: string;
  kind?: PadKind;
  /** The pad must be on a net: a socket's contact left floating is a dead key (intent.ts). */
  mustConnect?: boolean;
  /** The net, or "" when nothing is connected to it. */
  net: string;
  x: number;
  y: number;
  /** Size in the board frame, after the footprint's rotation. A circle has w = h = diameter. */
  w: number;
  h: number;
  shape: PadShape;
  /** The copper layers it is on: one for an SMD pad, both for a plated hole. */
  layers: Layer[];
  /** Diameter of the plated hole, for a through-hole pad. */
  drill?: number;
  /** Directions (unit vectors) of the thermal spokes, when the pour is of this pad's net. */
  spokes?: Pt[];
};

export type Track = { net: string; layer: Layer; pts: Pt[]; width: number };
export type Via = { net: string; x: number; y: number; drill: number; dia: number };
/** A non-plated hole. `keepout` is the radius around its centre that stays free of copper. */
export type Hole = { ref: string; x: number; y: number; drill: number; keepout: number };
export type Pour = { net: string; layer: Layer; clearance: number };

/** An area that copper stays out of. `tracks`: no track, via or foreign pad; `pour`: the pour keeps its
 * clearance away from it. The footprint's own pads (`ref`) are exempt. */
export type Keepout = { layer: Layer; pts: Pt[]; tracks: boolean; pour: boolean; ref: string };

/** Silkscreen on the top: strokes (polylines drawn with a round pen) and dots. */
export type Stroke = { pts: Pt[]; width: number };
export type Dot = { x: number; y: number; d: number };

export type Part = { ref: string; footprint: string; x: number; y: number; rotDeg: number; side: Side };

export type BoardData = {
  slug: string;
  width: number;
  height: number;
  corner: number;
  /** The outline as a closed polygon, counter-clockwise. */
  outline: Pt[];
  parts: Part[];
  pads: Pad[];
  tracks: Track[];
  vias: Via[];
  holes: Hole[];
  pours: Pour[];
  keepouts: Keepout[];
  /** Nets that have one pad on purpose (pcb.single). */
  singles: string[];
  /** The silkscreen as written, before it is clipped off pads and the edge (layers.ts does that). */
  silk: { strokes: Stroke[]; dots: Dot[] };
  /** Mistakes caught while the board was built (text too small, a net on a pad that does not exist). */
  problems: string[];
  /** Warnings the board code raised itself (pcb.warn). */
  notes: string[];
};

// ---- Gerber-level primitives: what is written to a layer file, and what the DRC rasterises ------------------

/** An aperture: a circle, a rectangle or an obround ("O"), all centred on the flash. */
export type Aperture = { kind: "C"; d: number } | { kind: "R"; w: number; h: number } | { kind: "O"; w: number; h: number };
/** D draws dark (adds), C clears (removes what is under it): the Gerber polarities LPD and LPC. */
export type Polarity = "D" | "C";
export type Item =
  | { op: "flash"; ap: Aperture; x: number; y: number; pol: Polarity }
  | { op: "draw"; d: number; a: Pt; b: Pt; pol: Polarity }
  | { op: "region"; pts: Pt[]; pol: Polarity };

export type GerberLayer = {
  /** The file name suffix: "F_Cu.gtl". */
  file: string;
  /** The %TF.FileFunction value: "Copper,L1,Top". */
  fn: string;
  polarity: "Positive" | "Negative";
  items: Item[];
};

export type Drill = { x: number; y: number; d: number };
