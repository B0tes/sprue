# Drawing the product: `figure.mjs`

Stage 1 ends with a picture of the real product that the user opens at once: a crafted isometric figure on a
standalone page, with every part they will buy or make, which they can hover, take apart and step through in the
order it is built. Claude writes `products/<slug>/figure.mjs`; `A figure <slug>` runs it and writes the page.

This page has what you need to draw a good one. For depth, read `reference/anatomy/craft.md` (the look, part
recipes, painter's order, round parts and pipes) and `reference/anatomy/kit.md` (every kit call). Both come from
Anatomy, where a world unit is about 1 px; here it is 1 mm (see "Units and the camera").

## What a good product figure is

- **It is the product.** Someone who will build it knows it at a glance: true sizes and proportions from
  `design.json` params, every part where it really sits. There is no metaphor; the thing itself is the subject.
- **Every drawn part is a BOM line.** Each `fig.part` call draws instances of one `bom.json` line. A line you don't
  draw (firmware, glue, a cable that comes later) is `fig.hidden` with a reason. `A figure` fails on any other.
- **Highly detailed, never noise.** Draw it the way it is built: screw heads, inserts, standoffs, seams, ports,
  connectors, cables with their plugs, vents, label plates, feet. At 1x it reads as one clear product; at 4x every
  region still has something true to find. Detail comes from real parts, never from texture for its own sake.
- **It shows how it goes together.** `lift` is the direction and distance each part comes off; `step` is when it
  goes on. The page's take apart and step walk come from those two numbers.
- Two ways it fails: **too abstract** (labelled boxes standing in for parts) and **too flat** (one big slab with a
  few lines on it). The fix for both is the real product, built from many small, precise parts.

## The files

| File | Written by | What it is |
| --- | --- | --- |
| `figure.mjs` | Claude | `draw()`: the whole product, drawn with the kit |
| `figure.svg` | `A figure` | the bare `<svg>` |
| `figure.json` | `A figure` | size, title, steps, parts with their lifts, coverage, hidden lines |
| `figure.html` | `A figure` | the standalone page: the card, the parts legend, all the live behaviour |
| `shots/<name>.png` | `A shot` | screenshots of the page, for checking |

## The contract

```js
// products/<slug>/figure.mjs
export default function draw({ k, G, T, fig, params, bom, design }) {
  // ... fig.size, fig.camera, then fig.under / fig.part / fig.hidden / fig.step / fig.over
  return { title, hint, caption }; // hint and caption are optional
}
```

- `k` is `kit/iso-kit.mjs`, `G` is `kit/lathe.mjs` (round parts on any axis), `T` is `kit/tube.mjs` (cables, pipes,
  hoses). They are passed in, so the product folder never imports anything by path.
- `params` is `design.json` `params`, `bom` is `bom.json`, `design` is all of `design.json`. Read every size from
  them, so an edit moves the figure and the CAD together. A size the figure needs that isn't there yet goes into
  `params` (or the BOM line's `spec`) first, from the datasheet.
- `title` is the product's short name (top right of the card; default `request.json` `product`). `hint` replaces
  the default hint, "Hover a part · E apart · ← → steps" (bottom left). `caption` is one true sentence under the
  card (default `design.json` `summary`).

| Call | What it does |
| --- | --- |
| `fig.size(w, h)` | The card's viewBox, before the camera. Default 640 x 480. Taller (640 x 520-600) for a tall stack. |
| `fig.camera(points, opts?)` | Returns `P`: `k.fitProjection(points, fig.width, fig.height, { pad: 30, azimuth: 45, ...opts })`. The points must include the apart pose. |
| `fig.under(svg)` | Drawn first, not a part: the halo under the base, a bench mat. |
| `fig.part(line, svg, { step, lift, count })` | Instances of BOM line `line`. Call order is paint order. `step` (required): the assembly step that places it, a whole number from 1 (1 goes on first). `lift`: `[dx, dy, dz]` in mm, its offset in the apart pose (default `[0, 0, 0]`). `count`: how many instances this call draws (default 1; 0 for the second half of a split part). |
| `fig.hidden(line, why)` | A BOM line that is not drawn. |
| `fig.step(n, text)` | The caption for step `n`, an instruction: "Press the four inserts into the lid". |
| `fig.over(svg)` | Drawn last, not a part. |

The harness wraps each part call in `<g class="a2-part" data-line data-step data-dx data-dy>` and does all the live
behaviour: hover lights the part and names it in the readout, a click pins it, `E` or "Take apart" eases every part
to its lift, staggered by step, and the arrow keys walk the steps. Under the card it lists every BOM line (hover a
row to light the part), the stages from `state.json`, and the commands to accept, edit or decline. Write no live
code in `figure.mjs`. A step with no `fig.step` caption reads "Fit the ..." and `A figure` says so.

Coverage: the `count`s for a line must add up to its `qtyPerUnit` (a different total is a warning), and every line
is drawn or hidden (anything else is an error). Several calls may share a line: one per instance when two lines
interleave in depth (see "Painter's order"), or a back half and a front half of one part with `count: 0` on the
second.

## Units and the camera

- **1 world unit = 1 mm.** x and y on the floor, z up. Put the origin at a datum the design already uses (the PCB
  centre on its top face, the floor under a cabinet's front corner), the same as `cad/_params.py`, so a number
  means the same thing in the CAD and the figure.
- **Plans.** Lay out footprints as rounded rectangles `{ x, y, w, d, r }` (x, y is the corner with the smallest
  coordinates) and circles. Datasheet sizes go in as they are; never scale a part to make it read.
- **Camera.** Azimuth 45 by default. A lower azimuth (30-40) turns the +x face toward the viewer, a higher one
  (50-60) the +y face: point the face with the ports, controls or open side at the viewer. Elevation 30; 40-45 to
  look into an open enclosure or a tray.
- **Fit both poses.** Pass the corners of the assembled product and of the apart pose:
  `[...k.boxCorners(CASE, lowestApart, top), ...k.boxCorners(CASE, bottom, highestApart)]`. Lift each part only
  as far as it needs to clear its neighbour (its own height plus a few mm), so the assembled product still fills
  about half the card.
- **Pixels and millimetres.** Anatomy's craft sizes are screen pixels: bevels 0.4-1.6, knurl inset 0.4, tube
  spacing 2.2, chunk length 30. After `fig.camera`, `const px = 1 / P.scale` is about one screen pixel in mm, so pass
  `bevel` as `0.8 * px`, a knurl inset as `0.4 * px` and tube options as `{ spacing: 2.2 * px, maxLength: 30 * px }`.
  Arguments that are already screen units stay as they are: `dotsSvg` `size`, `wireSvg` `size` and line widths.

## A worked example

The keypad in `examples/macropad`, drawn in about 100 lines. It reads a few sizes the shipped example doesn't
have yet: in `params`, the case corner, switch, keycap, Pico board, USB socket, screw head and hole sizes; in the
`sock` line's `spec`, `widthMm` and `depthMm`. Add them from the datasheets before running it. The few numbers
typed in are corner radii and Pico datasheet values (the 2.54 mm pad pitch, the 7 x 7 mm RP2040).

```js
// World: mm, origin at the PCB centre on its top face, x toward the USB end, y toward the controller, z up.
export default function draw({ k, fig, params: p, bom }) {
  const spec = (id) => bom.lines.find((l) => l.id === id).spec;
  const PCB = { x: -p.pcbWidthMm / 2, y: -p.pcbHeightMm / 2, w: p.pcbWidthMm, d: p.pcbHeightMm, r: 1 };
  const CASE = k.insetPlan({ ...PCB, r: p.caseCornerMm }, -(p.caseWallMm + p.caseClearanceMm));
  const pcbLow = -p.pcbThicknessMm;
  const trayLow = pcbLow - p.standoffHeightMm - p.trayFloorMm;
  const plateTop = p.plateTopToPcbTopMm;
  const swTop = plateTop + p.switchAbovePlateMm;
  const capTop = swTop + p.keycapHeightMm;
  const feet = spec("feet");
  const footLow = trayLow - feet.heightMm;
  const holes = k.corners(PCB, p.holeInsetMm);
  const keys = [];
  for (let r = 0; r < p.keyRows; r++)
    for (let c = 0; c < p.keyCols; c++)
      keys.push([(c - (p.keyCols - 1) / 2) * p.keyPitchMm, PCB.y + p.pcbEdgeToKeyMm + p.keyPitchMm * (r + 0.5)]);

  // Apart: each layer lifts straight up just past the one below; what goes in from below drops.
  const up = { sock: 6, pcb: 12, ctrl: 14, ins: 20, top: 26, sw: 38, cap: 52, scr: -10, feet: -18 };
  fig.size(640, 520);
  const P = fig.camera([
    ...k.boxCorners(CASE, footLow + up.feet, capTop), // lowest point, apart
    ...k.boxCorners(CASE, footLow, capTop + up.cap),  // highest point, apart
  ], { azimuth: 38 });
  const px = 1 / P.scale;
  const S = k.solidSvg, L = k.lineSvg;
  const byDepth = (list) => [...list].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  const rise = (dz) => [0, 0, dz];

  fig.under(`<path class="iso-halo" d="${k.haloOf(CASE, footLow, trayLow - footLow, P)}"/>`);

  // Under the tray first: the tray hides them at rest, and they drop out below it when apart.
  fig.part("feet", byDepth(holes).map(([x, y]) =>
    S(k.cylinder(x, y, feet.diameterMm / 2, footLow, feet.heightMm, P, 24), { tone: "lo" })).join(""),
    { step: 8, count: 4, lift: rise(up.feet) });
  fig.part("scr", byDepth(holes).map(([x, y]) =>
    S(k.cylinder(x, y, p.screwHeadMm / 2, trayLow - p.screwHeadHeightMm, p.screwHeadHeightMm, P, 20, px),
      { tone: "mid" })).join(""),
    { step: 7, count: 4, lift: rise(up.scr) });

  // The tray: a seam where the floor meets the walls, the walls' inner edge on top.
  fig.part("bot",
    S(k.slabOf(CASE, trayLow, pcbLow - trayLow, P, 8, px),
      { tone: "mid", inner: L(k.sideSeam(CASE, trayLow + p.trayFloorMm, P), { tone: "faint" }) })
    + L(k.planOutline(k.insetPlan(CASE, p.caseWallMm), pcbLow, P), { tone: "faint" }),
    { step: 7 });

  const sock = spec("sock");
  fig.part("sock", byDepth(keys).map(([x, y]) =>
    S(k.slabOf({ x: x - sock.widthMm / 2, y: y - sock.depthMm / 2, w: sock.widthMm, d: sock.depthMm, r: 0.6 },
      pcbLow - sock.heightMm, sock.heightMm, P, 3), { tone: "lo" })).join(""),
    { step: 3, count: 9, lift: rise(up.sock) });

  fig.part("pcb", S(k.slabOf(PCB, pcbLow, p.pcbThicknessMm, P, 4, px), { tone: "lo" })
    + holes.map(([x, y]) => L(k.ring(x, y, p.holeMm / 2, 0, P, 20), { tone: "mid" })).join(""),
    { step: 1, lift: rise(up.pcb) });

  // The Pico: board, castellated pads as dots on the near edge, the RP2040, the USB socket.
  const PICO = { x: p.controllerCenterXMm - p.controllerLengthMm / 2, y: p.controllerCenterYMm - p.controllerWidthMm / 2,
    w: p.controllerLengthMm, d: p.controllerWidthMm, r: 0.8 };
  const board = p.controllerBoardMm;
  const pads = Array.from({ length: 20 }, (_, i) => [PICO.x + 1.61 + i * 2.54, PICO.y + 0.6, board]);
  const usb = { x: PICO.x + PICO.w - p.usbSocketDepthMm, y: p.controllerCenterYMm - p.usbSocketWidthMm / 2,
    w: p.usbSocketDepthMm, d: p.usbSocketWidthMm, r: 0.5 };
  fig.part("ctrl", S(k.slabOf(PICO, 0, board, P, 3), { tone: "mid" })
    + k.dotsSvg(k.pointsAt(pads, P), { size: 0.5 })
    + S(k.slabOf({ x: p.controllerCenterXMm - 3.5, y: p.controllerCenterYMm - 3.5, w: 7, d: 7, r: 0.3 },
      board, 0.9, P, 2), { tone: "lo" })
    + S(k.slabOf(usb, board, p.controllerHeightAbovePcbMm - board, P, 3, px), { tone: "hi" }),
    { step: 2, lift: rise(up.ctrl) });

  const insLow = plateTop - p.lidSkinOverControllerMm - p.insertLengthMm;
  fig.part("ins", byDepth(holes).map(([x, y]) =>
    S(k.cylinder(x, y, p.insertOuterMm / 2, insLow, p.insertLengthMm, P, 20), { tone: "hi" })
    + L(k.knurl(x, y, p.insertOuterMm / 2, insLow, insLow + p.insertLengthMm, 10, P, 0.4 * px), { tone: "mid" })).join(""),
    { step: 4, count: 4, lift: rise(up.ins) });

  // The top doubles as the switch plate: nine cutouts, a bevelled edge.
  const cut = p.plateCutoutMm;
  fig.part("top", S(k.slabOf(CASE, pcbLow, plateTop - pcbLow, P, 8, 1.2 * px), { tone: "mid" })
    + keys.map(([x, y]) => L(k.planOutline({ x: x - cut / 2, y: y - cut / 2, w: cut, d: cut, r: 0.4 }, plateTop, P, 2),
      { tone: "faint" })).join(""),
    { step: 4, lift: rise(up.top) });

  // A switch and its keycap per key, far to near: one call per instance, so a near switch paints over a far cap.
  const hs = p.switchHousingMm, cap = p.keycapMm, dish = p.keycapTopMm, half = p.keycapHeightMm / 2;
  for (const [x, y] of byDepth(keys)) {
    fig.part("sw", S(k.slabOf({ x: x - hs / 2, y: y - hs / 2, w: hs, d: hs, r: 1 }, plateTop, p.switchAbovePlateMm, P, 3, px),
      { tone: "hi" }), { step: 5, lift: rise(up.sw) });
    fig.part("cap", S(k.slabOf({ x: x - cap / 2, y: y - cap / 2, w: cap, d: cap, r: 1.6 }, swTop, half, P, 4), { tone: "hi" })
      + S(k.slabOf({ x: x - dish / 2, y: y - dish / 2, w: dish, d: dish, r: 2 }, swTop + half, half, P, 6, px), { tone: "hi" }),
      { step: 6, lift: rise(up.cap) });
  }

  fig.hidden("cable", "plugged in after the build");
  fig.step(1, "Lay the PCB face up");
  fig.step(2, "Solder the Pico flat onto the PCB");
  fig.step(3, "Solder the nine hot-swap sockets onto the back");
  fig.step(4, "Press the four M3 inserts into the top's bosses");
  fig.step(5, "Clip the switches in and press the PCB onto them");
  fig.step(6, "Press on the nine keycaps");
  fig.step(7, "Drop it in the tray, screw it from below");
  fig.step(8, "Stick on the four feet");
  return { title: "3x3 macro keypad", caption: "Nine MX switches on a Raspberry Pi Pico, in a two-part PETG case." };
}
```

That is a first pass: about 55 solids, every line covered. To finish it, deepen the detail where a 4x shot is
plain (the switch's stem and clips, the keycap's dish, the Pico's pin labels plate and LED, the tray's screw bosses
and USB opening, a cable from the Pico's socket to a plug on the bench).

## Kit cheat sheet

Signatures as in `kit/iso-kit.mjs`, `kit/lathe.mjs` and `kit/tube.mjs`. Every call takes the projection `P`.

**Solids** (each returns paths for `k.solidSvg`)

| Call | For |
| --- | --- |
| `k.slabOf(plan, z, h, P, steps = 8, bevel = 0)` | Any rounded box: a case, a board, a key, a panel. `steps` per corner: 2-4 small, 8-10 large. |
| `k.cylinder(cx, cy, r, z, h, P, steps = 32, bevel = 0)` | Upright round parts: feet, standoffs, screw heads, knobs, inserts. 16-24 steps when small. |
| `k.extrude(ring, z, h, P, { convex = true, bevel })` | Any floor outline; `convex: false` for an L, a U or a notch. A hex nut is a six-point `ring`. |
| `k.circleRing(cx, cy, r, steps = 40)`, `k.ringOf(plan, steps = 8)` | Outlines to extrude. |
| `G.solidOf(profile, F, P)` with `F = G.frameAlong(origin, axis)` | A turned part on any axis from `[s, r]` points: a knob, a bolt, a lens, a jack, a fan hub. `[s, r, 1]` marks a smooth point. |
| `G.disc(s0, s1, r, F, P)`, `G.ringBand(s0, s1, rIn, rOut, F, P)` | A short cylinder or a collar on any axis: a barrel jack in a side wall, a button, a flange. |
| `G.sphereOf(centre, r, P)` | A ball: a ball joint, a dome nut. |

**Placing**

| Call | For |
| --- | --- |
| `k.insetPlan(plan, by)` | Shrink a plan (negative `by` grows it): walls, lids, grooves. |
| `k.corners(plan, inset = 0)` | Four floor points inset from the corners: feet, screws, standoffs. |
| `k.boxCorners(plan, z0, z1)` | The eight corners, for `fig.camera`. |
| `k.depthOf(point, P)` | Larger is nearer the viewer; sort ascending to paint far to near. |
| `k.iso(point, P)`, `k.pointsAt(points, P)` | World to screen, for dots and wires. |
| `k.haloOf(plan, z, h, P)` | The soft shadow under the base: `<path class="iso-halo" d="...">` in `fig.under`. |

**Lines and details** (each returns a path `d` for `k.lineSvg`, unless noted)

| Call | For |
| --- | --- |
| `k.planOutline(plan, z, P, steps = 8)` | A groove, cutout, inlay or panel line on a top face. |
| `k.ring(cx, cy, r, z, P, steps = 40)` | A hole, a screw ring or a bezel on a top face. |
| `k.lineOnTop([x0, y0], [x1, y1], z, P)`, `k.onTop(points, z, P, closed)` | Lines on a top face. |
| `k.segment(a, b, P)`, `k.rise([x, y], z0, z1, P)` | Any 3D segment; a vertical one. |
| `k.sideSeam(plan, z, P, steps = 8)` | A seam, lid line or weld round a box's visible sides, ending on its silhouette. Pass it as the slab's `inner`. |
| `k.sideRing([x, y, z], r, "x" or "y", P)` | A circle on a vertical face whose normal is that axis: a port, an LED, a jack. |
| `k.sideArc(cx, cy, r, z, P)` | A band round a cylinder. |
| `k.knurl(cx, cy, r, z0, z1, count, P, inset = 0.4)` | Knurling on a knob or an insert. |
| `k.coil(from, to, [c1, c2], r, turns, "x" or "y", P)` | A spring along an axis; returns `{ back, front }` halves to paint around the rod. |
| `k.dotGrid(x, y, cols, rows, gap, z, P)` | Screen points for vents, a speaker grille, perforated panels (`k.dotsSvg`). |
| `k.topTicks(from, to, step, every, edge, z, [minor, major], P, axis)` | Ruler ticks; returns `{ minor, major }`. |
| `k.topMatrix(at, z, P)`, `k.sideMatrix([x, y], z, P, "left" or "right")` | A transform to draw flat on a face: a display, a label plate. |
| `G.arcOf(F, s, r, P)`, `G.ribsOf(F, s0, s1, r, count, P, { fade, seams })`, `G.dotsOf(F, s, r, count, P, { fade })` | Seams, ribs and bolt circles on a round body; draw faded ribs with `k.fadedSvg`. |
| `T.tubePieces(points, r, P, { spacing, maxLength, gaps })`, then `T.tubeSvg(piece)` | A cable, hose or pipe along 3D points; round its corners with `G.fillet(points, radius)`. |

**SVG strings**

| Call | Notes |
| --- | --- |
| `k.solidSvg(paths, { tone = "hi", crease = "faint", lit, flat, inner })` | `inner` is line markup drawn under the outline (seams). |
| `k.lineSvg(d, { tone = "lo", dotted, dashed, free })` | `free` marks a line meant to stop on a bare face (printed text rules). |
| `k.dotsSvg(points, { size = 0.5, tone = "mid" })` | Screw heads seen end on, pads, LEDs. `size` in screen px. |
| `k.wireSvg(from, to, { via, tone, ends, size = 1.2 })` | A thin wire between screen points, with terminal dots. |
| `k.faceTextSvg(transform, text, { size = 3, tone, anchor })` | At most one tiny engraved label. |

## Painter's order

There is no depth buffer: what you call later covers what you called earlier.

- The base first, then what rests on it, layer by layer upward. Parts that go in from below (screws, feet) come
  before the part they go into.
- Within a layer, sort repeated parts with `k.depthOf`, far to near (`byDepth` in the example).
- When two lines interleave in depth (a switch and its keycap, a fuse and its holder), call `fig.part` once per
  instance, in depth order, with the default `count: 1`.
- Split anything that wraps another part into a back half and a front half: a case around a board seen through an
  opening, a frame around a drawer, a spring around a rod. Two calls on the same line, `count: 0` on the second.
- The order is fixed, so check it apart as well as assembled: a lifted part must still be drawn after everything it
  covers. If it isn't, change the lift or the order.
- Past a few dozen overlapping round parts, cables and pipes, stop tuning by eye: `kit/audit.mjs` can measure true
  depth (`reference/anatomy/craft.md`, section 5, and `kit.md`, section 12).

## Taking it apart, and the steps

- Lift each part along its real way out: up for a layer stack and a lid, down for screws and feet put in from
  below, out sideways for a drawer, a card or a module that slides. Far enough to clear its neighbours, no more.
- A part that stays attached goes with the part that holds it: give them the same lift.
- `step` is the step that places the part. Write one `fig.step` caption per step, as a short instruction (under
  about 45 characters, or the card's readout cuts it; the full text shows under the card), in build order.
- The build plan's assembly steps come from `design.json` `assembly`: keep its placing steps in the same order and
  words as the figure's. `assembly` also has the steps that place no part (order the prints, flash the firmware,
  test it); leave those out of the figure.
- The step walk shows the parts of earlier steps in place, lights the current step's parts, and lifts the later
  ones away along their `lift` as they fade out. So the figure must read at every step, and a lift must look
  right in motion too: check each step in a shot.

## Craft rules (short form)

From Anatomy's craft rules, aimed at a product. `reference/anatomy/craft.md` has the reasons and recipes.

- **Solids, not wireframes.** Every part is filled and painted in order, so what is in front hides what is behind.
  No see-through boxes, no dashed hidden edges.
- **Let the kit shade.** `slabOf`, `cylinder` and `extrude` give four side tones and a lighter top. Use `flat`
  only for inlays thinner than 1 mm.
- **Tone hierarchy.** The base, tray and feet are `lo`; the case, frame and boards `mid`; the parts the build is
  about (the switches, the controller, the lamp head) `hi`. The page lights one part at a time on hover and in the
  step walk, so don't mark anything `lit` yourself. Grooves and inset outlines are `faint`.
- **Small precise detail.** Bevels of `0.4 * px` to `1.6 * px`, seams inset from the edge, screws as small dots or
  heads with a ring, real hole patterns, connector shells, label plates. Each detail belongs to a part.
- **Lines resolve.** Every line ends on a face, another line or a terminal dot. No leader lines, balloons,
  dimension arrows or floating labels: names go in the legend and the readout, which the page builds from the BOM.
- **No cable or pipe through anything.** Keep about 1.5 radii of clearance, run cables along the structure, end
  each one on a connector, a gland or a terminal, and keep that true apart.
- **Curves shade smoothly.** Turned parts come from `G.solidOf` with smooth points; a texture on a round body ends
  on a seam or fades (`G.ribsOf(..., { fade })`).
- **Text and colour.** At most one tiny engraved label in the drawing. Monochrome, unless colour is the subject (an
  RGB LED, coloured wires the build depends on).
- **Volume and composition.** Real thicknesses from the datasheet, a soft halo under the base, the assembled product
  centred and filling about half the card, still readable at 390 px wide.

## Verify

The owner finds faults by zooming in, so zoom in first. Read every PNG you make.

1. `A check <slug>`: the engineer checks pass, or each failure is explained.
2. `A figure <slug>`: read the coverage table. Every line is drawn the right number of times or hidden with a
   reason; the command exits 1 otherwise.
3. Shots: `A shot <slug>` (assembled), `A shot <slug> --apart`, `A shot <slug> --step <n>` for every step,
   `A shot <slug> --select <line>` for the parts that matter, `A shot <slug> --width 390` (phone),
   `A shot <slug> --light`, and 4x zooms over every junction with `--zoom x,y,w,h` (a box in CSS px from the
   card's top left corner, shot at 4x). Flags combine (`--apart --select pcb`). Each writes
   `products/<slug>/shots/<name>.png` (`rest.png`, `apart.png`, `step-3.png`, ...) and prints its path. It needs
   Chrome or Chromium; set `CHROME_PATH` if it isn't found.
4. Ask of every shot: is it instantly this product? Could someone build it from the steps? Is every part from the
   BOM there, at its true size? Does every line end on something? At 4x, is there a bare face or an empty corner?
   Is anything drawn over something that should hide it, assembled or apart?
5. Fix in `figure.mjs` (or `design.json` when a number was wrong), rerun `A figure`, reload, shoot again. Repeat
   until the answers are yes.

## Sizes and big products

Name the size before drawing (`run.md`, stage 1, step 1). A Figure is 40-80 solids, a Hero 80-150. An Epic (a
switchgear line-up, a vehicle, a plant) is not drawn whole on the first pass: propose a smaller first build that
keeps the core (one panel of the line-up with its breaker, busbars and cable box; one bay of the frame), say what
the full build adds, and draw the full one only if the user chooses it. A big product is still millimetres: the
camera fits it, and `px` keeps the details a pixel or two wide.
