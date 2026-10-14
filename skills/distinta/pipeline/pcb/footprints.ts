// The footprint library. Each footprint is drawn as seen from the top, origin at its own centre, x right, y up,
// and is placed by Board.place() (board.ts), which rotates and moves it and puts its pads on the side asked for.
// A footprint on the bottom is NOT mirrored: its pads sit at the coordinates given, seen from the top through the
// board, which is how the Kailh drawing and the research note (research/keypad-pcb-footprints.md) give them.
// Every copper and drill number names its source in [brackets]:
//   [kicad-pico]  KiCad's RaspberryPi_Pico_SMD, gitlab.com/kicad/libraries/kicad-footprints @18227ee1
//   [kicad-mx]    KiCad's SW_Cherry_MX_1.00u_PCB, the same commit
//   [rpi-pico]    Raspberry Pi's own RPi_Pico_SMD_TH, github.com/HeadBoffin/RP_Silicon_KiCad @8ab84dd9 (a copy)
//   [kailh]       Kailh CPG151101S11 specification KH-PS1607-10 Rev A, page 9/10, Recommended PCB Layout
//   [marbastlib]  github.com/ebastler/marbastlib @6b0a9a73; [keebio] github.com/keebio/Keebio-Parts.pretty @1486bef2
//   [measured]    read off a manufacturer's drawing that does not dimension it: an estimate, which the product's
//                 design.json lists under `estimates`
// fixtures/footprint-refs.json holds those numbers as each source gives them, with the full URLs. footprints.test.ts
// holds this library to them to 0.01 mm, and the audit (intent.ts) holds every placed part to them.

import { textStrokes } from "./font.ts";
import { rectPts } from "./geometry.ts";
import type { Rules } from "./rules.ts";
import type { Dot, PadKind, PadShape, Pt, Stroke } from "./types.ts";

export type PadDef = {
  num: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: PadShape;
  kind?: PadKind;
  /** The pad must be on a net (a socket's contacts): the intent check fails a board that leaves it floating. */
  mustConnect?: boolean;
  /** "side": the copper layer of the side the footprint is placed on; "both": a plated hole through the board. */
  on: "side" | "both";
  drill?: number;
  /** Thermal spoke directions for when the pour is of this pad's net. */
  spokes?: Pt[];
};
export type HoleDef = { x: number; y: number; drill: number };
export type KeepoutDef = { pts: Pt[]; tracks: boolean; pour: boolean };
export type Footprint = {
  name: string;
  sides: ("top" | "bottom")[];
  pads: PadDef[];
  /** Non-plated holes. */
  holes: HoleDef[];
  /** On the copper side given: no track or pour here. */
  keepouts: KeepoutDef[];
  /** Top silkscreen, whichever side the part is on. */
  silk: { strokes: Stroke[]; dots: Dot[] };
};
export type FootprintOpts = Record<string, unknown>;
type Make = (rules: Rules, opts: FootprintOpts) => Footprint;

const closed = (pts: Pt[]): Pt[] => [...pts, pts[0]];
const outline = (pts: Pt[], width: number): Stroke => ({ pts: closed(pts), width });

// ---- Kailh MX hot-swap socket under a Cherry MX switch ------------------------------------------------------

/** The Cherry MX pattern (switch frame, seen from the switch side): the two contact pins above the centre, the
 * centre post, and the side pegs of a 5-pin switch. */
const MX = {
  centreHoleMm: 4.0, // [kicad-mx] drill 4; Cherry's MX catalogue gives 4.0 +0.1
  /** [kicad-mx] drill 1.7; Cherry gives 0.067 +-0.002 in (1.70 +-0.05). With the 3.05 socket holes it leaves 0.465 mm
   * of board between a peg hole and a socket hole, as 1.75 did with 3.0. */
  pegHoleMm: 1.7,
  pegs: [[-5.08, 0], [5.08, 0]] as Pt[], // [kicad-mx]
  pins: { A: [-3.81, 2.54], B: [2.54, 5.08] } as Record<string, Pt>, // [kicad-mx] its pins 2 and 1
};

/** Kailh CPG151101S11: the pins push through its holes into the clips, whose terminals are the SMD pads, one
 * outboard of each pin along x. `body` is the socket's plastic body (the part under the board). */
const KAILH = {
  /** [kailh] 3.05 +-0.05. Its 2016 and 2021 revisions print 3.00, which is inside that tolerance; marbastlib drills 3.0. */
  holeMm: 3.05,
  /** [marbastlib] [keebio] pads 1 and 2. Kailh does not dimension where they are; ai03 and kiswitch put them 0.25 mm
   * further in (fixtures/footprint-refs.json). */
  pads: [{ num: "A", x: -7.36, y: 2.54 }, { num: "B", x: 6.09, y: 5.08 }],
  padW: 2.55, // [kailh] (2.55) x (2.5), printed in brackets as a reference size; [marbastlib] [keebio] the same
  padH: 2.5,
  /** [measured] off [kailh] page 9, +-0.05: only its length (10.90) and widths (5.89, 4.00) are dimensioned. */
  body: [[-6.085, 0.85], [-2.8, 0.85], [-2.45, 1.15], [-2.27, 1.57], [-1.96, 2], [-1.65, 2.28], [-1.33, 2.52], [-0.86, 2.69],
    [-0.4, 2.75], [4.32, 2.75], [4.815, 3.25], [4.815, 6.7], [-4.085, 6.7], [-5.5, 6.11], [-6.085, 4.7]] as Pt[],
};

/** `kailh-mx-hotswap`: the socket's two SMD pads on the side it is placed on (both must connect: a floating one is a
 * dead key), the switch's centre hole, the two 3.05 mm pin holes and the two peg holes (non-plated). The socket body
 * is a no-track area on that side, and with `switchMm` (the plate cutout) the switch's outline is drawn on the top
 * silkscreen. */
const kailh: Make = (rules, opts) => {
  const holes: HoleDef[] = [
    { x: 0, y: 0, drill: MX.centreHoleMm },
    { x: MX.pins.A[0], y: MX.pins.A[1], drill: KAILH.holeMm },
    { x: MX.pins.B[0], y: MX.pins.B[1], drill: KAILH.holeMm },
    ...MX.pegs.map(([x, y]) => ({ x, y, drill: MX.pegHoleMm })),
  ];
  const switchMm = Number(opts.switchMm);
  return {
    name: "kailh-mx-hotswap",
    sides: ["top", "bottom"],
    pads: KAILH.pads.map((p) => ({
      num: p.num, x: p.x, y: p.y, w: KAILH.padW, h: KAILH.padH, shape: "rect" as const, on: "side" as const, kind: "switch" as const, mustConnect: true,
    })),
    holes,
    keepouts: [{ pts: KAILH.body, tracks: true, pour: false }],
    silk: { strokes: switchMm > 0 ? [outline(rectPts(0, 0, switchMm, switchMm), rules.silkLineMm)] : [], dots: [] },
  };
};

// ---- Raspberry Pi Pico, flat on the board by its castellated edges ----------------------------------------

/** Pico pins in the Pico frame (x toward the USB end, y up): pins 1-20 on the +y row from the USB end, pins 21-40
 * on the -y row from the far end. [rpi-pico] prints these names beside the pins; for GP26, GP27, GP28 and 3V3 the kit
 * adds what the official pinout adds (GP26_ADC0, 3V3(OUT)). */
const PICO_NAMES = ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND", "GP6", "GP7", "GP8", "GP9", "GND", "GP10", "GP11",
  "GP12", "GP13", "GND", "GP14", "GP15", "GP16", "GP17", "GND", "GP18", "GP19", "GP20", "GP21", "GND", "GP22", "RUN",
  "GP26_ADC0", "GP27_ADC1", "AGND", "GP28_ADC2", "ADC_VREF", "3V3(OUT)", "3V3_EN", "GND", "VSYS", "VBUS"];

/** What a Pico pin is for: GP0-GP22 and GP26-GP28 are GPIOs; GND and AGND (the ADC's ground) are grounds; RUN and
 * 3V3_EN switch the chip and its regulator; VBUS, VSYS, 3V3(OUT) and ADC_VREF are supplies. */
export function picoKind(name: string): PadKind {
  if (/^GP\d+/.test(name)) return "gpio";
  if (name === "GND" || name === "AGND") return "gnd";
  return name === "RUN" || name === "3V3_EN" ? "control" : "power";
}

const PICO = {
  lengthMm: 51, // [rpi-pico] the body outline, 51 x 21
  widthMm: 21,
  pitchMm: 2.54, // [rpi-pico] [kicad-pico]
  rowMm: 8.89, // [rpi-pico] the pin centres
  /** [kicad-pico] the host pad: 1.6 along the row, 3.2 across it, centred 0.8 outboard of the pin (at 9.69) so it reaches
   * 0.79 past the edge. Raspberry Pi's own is 3.5 x 1.7, 0.9 outboard. */
  padW: 1.6,
  padH: 3.2,
  padOutMm: 0.8,
  /** The pin-1 mark (ours, silkscreen only): the number and a dot beside it, centred this far past the end of the pad
   * row, kept low and to the module's end so a boss round a corner hole of the board does not cover it. */
  markOutMm: 1.0,
  /** [rpi-pico] where the USB receptacle's shell tabs push through (NPTH): pcb x, y relative to the Pico centre, and
   * the drill. KiCad's hand-solder variant opens them to 2.2 and 1.85. */
  shell: [[24, 2.725, 1.8], [24, -2.725, 1.8], [20.97, 2.425, 1.5], [20.97, -2.425, 1.5]] as [number, number, number][],
};

/** The Pico pin n (1 to 40) in the Pico frame. */
export function picoPin(n: number): { x: number; y: number; name: string } {
  const top = n <= 20;
  const k = top ? n - 1 : n - 21;
  const span = (19 * PICO.pitchMm) / 2;
  return { x: top ? span - k * PICO.pitchMm : -span + k * PICO.pitchMm, y: top ? PICO.rowMm : -PICO.rowMm, name: PICO_NAMES[n - 1] };
}

/** `rpi-pico-castellated`: 40 SMD pads named by pin number (the function, "GP2", "GND", is each pad's `name`, and its
 * `kind` is picoKind's), on the top. Nothing else is copper inside the Pico's outline (a keepout on the top), and the
 * pour stays clear of the pad rows. The shell tabs get four non-plated holes. `throughHoles: { drillMm, padMm }` adds a plated
 * hole and ring at each pin, for a Pico soldered through its own holes; the keypad does not use it. */
const pico: Make = (rules, opts) => {
  const through = opts.throughHoles as { drillMm: number; padMm: number } | undefined;
  const pads: PadDef[] = [];
  for (let n = 1; n <= 40; n++) {
    const { x, y, name } = picoPin(n);
    const out = Math.sign(y);
    const kind = picoKind(name);
    pads.push({ num: String(n), name, kind, x, y: y + out * PICO.padOutMm, w: PICO.padW, h: PICO.padH, shape: "rect", on: "side", spokes: [[0, out]] });
    if (through)
      pads.push({ num: String(n), name, kind, x, y, w: through.padMm, h: through.padMm, shape: "circle", on: "both", drill: through.drillMm });
  }
  const padEdge = PICO.rowMm + PICO.padOutMm + PICO.padH / 2;
  const { x: x1 } = picoPin(1);
  return {
    name: "rpi-pico-castellated",
    sides: ["top"],
    pads,
    holes: PICO.shell.map(([x, y, drill]) => ({ x, y, drill })),
    keepouts: [
      { pts: rectPts(0, 0, PICO.lengthMm, PICO.widthMm), tracks: true, pour: true },
      { pts: rectPts(0, 0, PICO.lengthMm, 2 * padEdge), tracks: false, pour: true },
    ],
    silk: {
      strokes: [outline(rectPts(0, 0, PICO.lengthMm, PICO.widthMm), rules.silkLineMm), ...textStrokes(x1 - 0.3, padEdge + PICO.markOutMm, "1", rules.silkTextMm, rules.silkLineMm)],
      dots: [{ x: x1 + 0.7, y: padEdge + PICO.markOutMm, d: 0.5 }],
    },
  };
};

export const FOOTPRINTS: Record<string, Make> = {
  "kailh-mx-hotswap": kailh,
  "rpi-pico-castellated": pico,
};
