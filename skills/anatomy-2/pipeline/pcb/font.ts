// A small stroke font for the silkscreen: capitals, digits and a few marks, each glyph a set of polylines on a
// 4 x 6 grid (x right, y up from the baseline). A stroke font has no outlines to clip, so the harness can cut
// a letter off a pad exactly and the Gerber needs only round-pen draws.

import { rotate } from "./geometry.ts";
import type { Pt, Stroke } from "./types.ts";

const GLYPHS: Record<string, Pt[][]> = {
  A: [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
  C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
  D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2.5]], [[1.5, 3.8], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  Q: [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2.5, 2], [4, 0]]],
  R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
  S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  "0": [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
  "1": [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
  "2": [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  "3": [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  "4": [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  "5": [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
  "6": [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  "7": [[[0, 6], [4, 6], [1.5, 0]]],
  "8": [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  "9": [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]],
  "-": [[[0.5, 3], [3.5, 3]]],
  "+": [[[0.5, 3], [3.5, 3]], [[2, 1.5], [2, 4.5]]],
  ".": [[[2, 0], [2, 0]]],
  ":": [[[2, 1], [2, 1]], [[2, 4.5], [2, 4.5]]],
  "/": [[[0, 0], [4, 6]]],
  "_": [[[0, 0], [4, 0]]],
  "(": [[[3, 6], [2, 5], [2, 1], [3, 0]]],
  ")": [[[1, 6], [2, 5], [2, 1], [1, 0]]],
  ">": [[[0.5, 5], [3.5, 3], [0.5, 1]]],
  "<": [[[3.5, 5], [0.5, 3], [3.5, 1]]],
  " ": [],
};

/** Glyph width and the distance from one glyph to the next, in grid units; the cap height is 6. */
const CAP = 6, ADVANCE = 5.2;

/** The stroke width for text `height` tall: thin enough to read at small sizes, never under `min`. */
export const strokeFor = (height: number, min: number) => Math.max(min, Math.min(0.3, height * 0.14));

export type TextOpts = {
  /** Counter-clockwise, as seen from the top. Default 0. */
  rotDeg?: number;
  /** Where x, y is on the text's baseline-centre line. Default "center". */
  align?: "left" | "center" | "right";
  /** The pen width; default from the height. */
  width?: number;
};

/** The strokes that spell `s`, `height` tall (capitals; lower case is drawn as capitals), centred on x, y. */
export function textStrokes(x: number, y: number, s: string, height: number, minLine: number, opts: TextOpts = {}): Stroke[] {
  const k = height / CAP;
  const text = s.toUpperCase();
  const total = Math.max(0, text.length * ADVANCE - (ADVANCE - 4));
  const left = opts.align === "left" ? 0 : opts.align === "right" ? -total : -total / 2;
  const width = opts.width ?? strokeFor(height, minLine);
  const out: Stroke[] = [];
  [...text].forEach((ch, i) => {
    for (const line of GLYPHS[ch] ?? GLYPHS["-"])
      out.push({
        width,
        pts: line.map(([gx, gy]) => {
          const [rx, ry] = rotate([(left + i * ADVANCE + gx) * k, (gy - CAP / 2) * k], opts.rotDeg ?? 0);
          return [x + rx, y + ry] as Pt;
        }),
      });
  });
  return out;
}

export const hasGlyph = (ch: string) => ch.toUpperCase() in GLYPHS;
