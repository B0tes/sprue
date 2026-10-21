# Drawing the product: `figure.mjs`

Stage 1 ends with a picture of the real product that the user opens at once: a crafted isometric figure at the
top of the product page, `view.html`, with every part they will buy or make, which they can hover, take apart and
step through in the order it is built. Claude writes `products/<slug>/figure.mjs`; `A figure <slug> --draft` runs
it and writes the page while you work, and `A figure <slug>` (no `--draft`) does the same and proposes the design
at gate 1. The same page later shows the whole product inspected, the quote and the build plan under the figure.

This page has what you need to draw a good one. For depth, read `${CLAUDE_SKILL_DIR}/reference/anatomy/craft.md`
(the look, part recipes, painter's order, round parts and pipes) and `${CLAUDE_SKILL_DIR}/reference/anatomy/kit.md`
(every kit call). Both come from Anatomy, where a world unit is about 1 px and the camera is left-handed; here a unit is 1 mm and
the camera is right-handed, like the CAD (see "Units and the camera"), and only some of the kit files they mention are
shipped here (`kit/`).

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
| `view.html` | `A figure`, `A view` | the product page: the card with all the live behaviour, the parts list and the stages |
| `shots/<name>.png` | `A shot` | screenshots of the card on `view.html`, for checking |

## The contract

```js
// products/<slug>/figure.mjs
export default function draw({ k, G, T, fig, params, bom, design, line, spec }) {
  // ... fig.size, fig.camera, then fig.under / fig.part / fig.xray / fig.hidden / fig.step / fig.over
  return { title, hint, caption }; // hint and caption are optional
}
```

- `k` is `kit/iso-kit.mjs`, `G` is `kit/lathe.mjs` (round parts on any axis), `T` is `kit/tube.mjs` (cables, pipes,
  hoses). They are passed in, so the product folder never imports anything by path.
- `params` is `design.json` `params`, `bom` is `bom.json`, `design` is all of `design.json`. Read every size from
  them, so an edit moves the figure and the CAD together. A size the figure needs that isn't there yet goes into
  `params` (or the BOM line's `spec`) first, from the datasheet.
- `line(id)` is a BOM line and `spec(id)` its `spec`. Read lines through them: a line bom.json doesn't have stops
  the figure with `bom.json has no <id> line, which figure.mjs draws`, rather than on whatever its missing numbers
  break. A part or x-ray whose drawing has `NaN` or `undefined` in it (a param or spec field that isn't there) is a
  problem too.
- `title` is the product's short name (top right of the card; default `request.json` `product`). `hint` replaces
  the default hint, "Hover a part · E apart · ← → steps" (bottom left). `caption` is one true sentence under the
  card (default `design.json` `summary`).

| Call | What it does |
| --- | --- |
| `fig.size(w, h)` | The card's viewBox, before the camera. Default 640 x 480. Taller (640 x 520-600) for a tall stack. |
| `fig.camera(points, opts?)` | Returns `P`: `k.fitProjection(points, fig.width, fig.height, { pad: 30, azimuth: 45, ...opts })`, except `leftHanded`, which it does not pass on: the camera stays right-handed, like the CAD, and `leftHanded: true` is a problem, since it would draw the product as its CAD's mirror image. The points must include the apart pose. |
| `fig.under(svg)` | Drawn first, not a part: the halo under the base, and context that isn't in the BOM (a desk edge, a bench mat, the laptop a cable plugs into). Context never goes in `fig.part`, so it is never lit, listed or taken apart. It is always shown, so the camera keeps it in the frame at every step. |
| `fig.part(line, svg, { step, lift, count })` | Instances of BOM line `line`. Call order is paint order. `step` (required): the assembly step that places it, a whole number from 1 (1 goes on first). `lift`: `[dx, dy, dz]` in mm, its offset in the apart pose (default `[0, 0, 0]`). `count`: how many instances this call draws (default 1; 0 for the second half of a split part). |
| `fig.xray(line, svg, { by, step })` | The dashed outline of a part the others hide (sockets under a board, inserts in a lid, feet under a tray), drawn where the call is in paint order. The page shows it only while `line` is lit and one of the lines in `by` is in place over it, and moves it with `line`'s part. `by` defaults to "whenever assembled". `step` ties it to the part of `line` placed at that step: the step walk lights it at that step only, and it moves with that part. Give a line placed at two steps (the head's screws and the base's) one x-ray per step. See "Craft rules". |
| `fig.hidden(line, why)` | A BOM line that is not drawn. |
| `fig.step(n, text)` | The caption for step `n`, an instruction: "Press the four inserts into the lid". |
| `fig.over(svg)` | Drawn last, not a part. |

The harness wraps each part call in `<g class="a2-part" data-line data-step data-dx data-dy>` and does all the live
behaviour: hover lights the part and names it in the readout, a click pins it, `E` or "Take apart" eases every part
to its lift, staggered by step, and the arrow keys walk the steps; the page's camera eases in and out so whatever
is shown fills the card. Above the card are the four stages from `state.json` and the commands to type at the
current gate (accept, edit, decline). Under it is the Design stage: every BOM line in a parts list (point at a row
to light the part), and the "Before you accept" list while the design is open; then Inspect, the whole product.
Later the BOM in Source and the assembly steps in Build are linked to the card too. Write no live code in
`figure.mjs`. A step with no `fig.step` caption reads "Fit the ..." and `A figure` says so.

Coverage: the `count`s for a line must add up to its `qtyPerUnit` (a different total is a warning), and every line
is drawn or hidden (anything else is an error). A line bought for the whole batch (`qtyPerBatch`, with
`qtyPerUnit` 0), such as a spool of wire, counts as needing 1: hide it with `fig.hidden` and say why, or draw it once. Several calls may share a line: one per instance when two lines
interleave in depth (see "Painter's order"), or a back half and a front half of one part with `count: 0` on the
second.

## Units and the camera

- **1 world unit = 1 mm.** x and y on the floor, z up. Put the origin at a datum the design already uses (the PCB
  centre on its top face, the floor under a cabinet's front corner), the same as `cad/_params.py`, so a number
  means the same thing in the CAD and the figure. The kit's camera is right-handed, like build123d's, so the figure
  shows the CAD as it is, not its mirror image: don't swap or flip axes to make up for it.
- **Plans.** Lay out footprints as rounded rectangles `{ x, y, w, d, r }` (x, y is the corner with the smallest
  coordinates) and circles. Datasheet sizes go in as they are; never scale a part to make it read.
- **Camera.** Azimuth 45 by default. The camera is up and out along the floor direction (cos a, sin a), looking at
  the origin, so at 45 +x runs to the lower left and +y to the lower right. A lower azimuth (30-40) turns the +x face
  toward the viewer, a higher one (50-60) the +y face, and a negative one (-30 to -50) shows the +x and -y faces,
  with +x on the right (the keypad's USB end): point the face with the ports, controls or open side at the viewer.
  The light is on the screen's upper left at every azimuth (`k.lightAcross(P)` is its floor direction). Elevation
  30; 40-45 to look into an open enclosure or a tray.
- **Fit both poses.** Pass the corners of the assembled product and of the apart pose:
  `[...k.boxCorners(CASE, lowestApart, top), ...k.boxCorners(CASE, bottom, highestApart)]`, plus any point a part
  slides out to. That is the drawing's extent; the page's camera then frames what is shown (the assembled product,
  a step, the apart pose) so it fills the card, so a long lift no longer shrinks the assembled view. Still lift
  each part only as far as it needs to read clearly (its own height plus a few mm), so the apart pose stays one
  product and not a scatter.
- **Pixels and millimetres.** Anatomy's craft sizes are screen pixels: bevels 0.4-1.6, knurl inset 0.4, tube
  spacing 2.2, chunk length 30. After `fig.camera`, `const px = 1 / P.scale` is about one screen pixel in mm, so pass
  `bevel` as `0.8 * px`, a knurl inset as `0.4 * px` and tube options as `{ spacing: 2.2 * px, maxLength: 30 * px }`.
  Arguments that are already screen units stay as they are: `dotsSvg` `size`, `wireSvg` `size` and line widths.

## A worked example

A first pass at the keypad in `examples/macropad`, in about 100 lines, reading every size from the shipped
`params` and BOM specs. Besides the apart lifts, the numbers typed in are corner radii, the pad row's 0.6 mm inset
and the 7 x 7 mm RP2040; in a real figure, put such numbers in `params` too.

```js
// World: mm, origin at the PCB centre on its top face, x toward the USB end, y toward the controller, z up.
export default function draw({ k, fig, params: p, spec }) {
  const SW = spec("sw"), CAP = spec("cap"), SOCK = spec("sock"), PI = spec("ctrl"), SCR = spec("scr"), FOOT = spec("feet");
  const PCB = { x: -p.pcbWidthMm / 2, y: -p.pcbHeightMm / 2, w: p.pcbWidthMm, d: p.pcbHeightMm, r: p.pcbCornerMm };
  const CASE = { ...k.insetPlan(PCB, -(p.caseWallMm + p.caseClearanceMm)), r: p.caseCornerMm };
  const pcbLow = -p.pcbThicknessMm;
  const trayLow = pcbLow - p.standoffHeightMm - p.trayFloorMm;
  const plateTop = p.plateTopToPcbTopMm;
  const swTop = plateTop + SW.abovePlateMm;
  const capLow = plateTop + p.capSkirtAbovePlateMm, capTop = capLow + CAP.heightMm;
  const footLow = trayLow - FOOT.heightMm;
  const holes = k.corners(PCB, p.holeInsetMm);
  const feet = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * p.footCentreXMm, sy * p.footCentreYMm]));
  const keys = [];
  for (let r = 0; r < p.keyRows; r++)
    for (let c = 0; c < p.keyCols; c++)
      keys.push([(c - (p.keyCols - 1) / 2) * p.keyPitchMm, PCB.y + p.pcbEdgeToKeyMm + p.keyPitchMm * (r + 0.5)]);

  // Apart: each layer lifts straight up just past the one below; what goes in from below drops.
  const up = { ctrl: 8, ins: 20, top: 30, sw: 44, cap: 58, sock: -8, bot: -18, scr: -30, feet: -38 };
  fig.size(640, 560);
  const P = fig.camera([
    ...k.boxCorners(CASE, footLow + up.feet, capTop), // lowest point, apart
    ...k.boxCorners(CASE, footLow, capTop + up.cap),  // highest point, apart
  ], { azimuth: -40 });
  const px = 1 / P.scale;
  const S = k.solidSvg, L = k.lineSvg;
  const byDepth = (list) => [...list].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  const rise = (dz) => [0, 0, dz];

  fig.under(`<path class="iso-halo" data-a2-with="bot" d="${k.haloOf(CASE, footLow, trayLow - footLow, P)}"/>`);

  // Under the tray first: the tray hides them at rest, and they drop out below it when apart.
  fig.part("feet", byDepth(feet).map(([x, y]) =>
    S(k.cylinder(x, y, FOOT.diameterMm / 2, footLow, FOOT.heightMm, P, 24), { tone: "lo" })).join(""),
    { step: 7, count: 4, lift: rise(up.feet) });
  fig.part("scr", byDepth(holes).map(([x, y]) =>
    S(k.cylinder(x, y, SCR.headMm / 2, trayLow, p.screwHeadHeightMm, P, 20, px), { tone: "mid" })
    + S(k.cylinder(x, y, SCR.diameterMm / 2, trayLow + p.screwHeadHeightMm, p.screwLengthMm, P, 16), { tone: "mid" })).join(""),
    { step: 6, count: 4, lift: rise(up.scr) });

  // The tray: a seam where the floor meets the walls, the walls' inner edge on top.
  fig.part("bot",
    S(k.slabOf(CASE, trayLow, pcbLow - trayLow, P, 8, px),
      { tone: "lo", inner: L(k.sideSeam(CASE, trayLow + p.trayFloorMm, P), { tone: "faint" }) })
    + L(k.planOutline(k.insetPlan(CASE, p.caseWallMm), pcbLow, P), { tone: "faint" }),
    { step: 6, lift: rise(up.bot) });

  const sockets = byDepth(keys).map(([x, y]) => k.slabOf({ x: x - SOCK.lengthMm / 2, y: y - SOCK.widthMm / 2,
    w: SOCK.lengthMm, d: SOCK.widthMm, r: 0.6 }, pcbLow - p.socketHeightMm, p.socketHeightMm, P, 3));
  fig.part("sock", sockets.map((paths) => S(paths, { tone: "lo" })).join(""), { step: 2, count: 9, lift: rise(up.sock) });

  fig.part("pcb", S(k.slabOf(PCB, pcbLow, p.pcbThicknessMm, P, 4, px), { tone: "mid" })
    + holes.map(([x, y]) => L(k.ring(x, y, spec("pcb").holeMm / 2, 0, P, 20), { tone: "mid" })).join(""),
    { step: 1 });

  // The Pico: board, castellated pads as dots on the near edge, the RP2040, the USB socket.
  const PICO = { x: p.controllerCenterXMm - p.controllerLengthMm / 2, y: p.controllerCenterYMm - p.controllerWidthMm / 2,
    w: p.controllerLengthMm, d: p.controllerWidthMm, r: 0.5 };
  const board = PI.boardMm;
  const first = (PICO.w - (PI.padsPerSide - 1) * PI.padPitchMm) / 2;
  const pads = Array.from({ length: PI.padsPerSide }, (_, i) => [PICO.x + first + i * PI.padPitchMm, PICO.y + 0.6, board]);
  const usb = { x: PICO.x + PICO.w - PI.usbDepthMm, y: p.controllerCenterYMm - PI.usbWidthMm / 2,
    w: PI.usbDepthMm, d: PI.usbWidthMm, r: 0.5 };
  fig.part("ctrl", S(k.slabOf(PICO, 0, board, P, 3), { tone: "hi" })
    + k.dotsSvg(k.pointsAt(pads, P), { size: 0.5 })
    + S(k.slabOf({ x: p.controllerCenterXMm - 3.5, y: p.controllerCenterYMm - 3.5, w: 7, d: 7, r: 0.3 },
      board, 0.9, P, 2), { tone: "mid" })
    + S(k.slabOf(usb, board, p.controllerHeightAbovePcbMm - board, P, 3, px), { tone: "hi" }),
    { step: 3, lift: rise(up.ctrl) });

  // The inserts sit in the top's bosses, open end down on the PCB, so they go with the top's step.
  fig.part("ins", byDepth(holes).map(([x, y]) =>
    S(k.cylinder(x, y, p.insertOuterMm / 2, 0, p.insertLengthMm, P, 20), { tone: "mid" })
    + L(k.knurl(x, y, p.insertOuterMm / 2, 0, p.insertLengthMm, 10, P, 0.4 * px), { tone: "faint" })).join(""),
    { step: 4, count: 4, lift: rise(up.ins) });

  // The top doubles as the switch plate: nine cutouts, a bevelled edge.
  const cut = p.plateCutoutMm;
  fig.part("top", S(k.slabOf(CASE, pcbLow, plateTop - pcbLow, P, 8, 1.2 * px), { tone: "mid" })
    + keys.map(([x, y]) => L(k.planOutline({ x: x - cut / 2, y: y - cut / 2, w: cut, d: cut, r: 0.4 }, plateTop, P, 2),
      { tone: "faint" })).join(""),
    { step: 4, lift: rise(up.top) });

  // A switch and its keycap per key, far to near: one call per instance, so a near switch paints over a far cap.
  const hs = SW.housingMm, base = CAP.baseMm, dish = CAP.topMm, half = CAP.heightMm / 2;
  for (const [x, y] of byDepth(keys)) {
    fig.part("sw", S(k.slabOf({ x: x - hs / 2, y: y - hs / 2, w: hs, d: hs, r: 1 }, plateTop, swTop - plateTop, P, 3, px),
      { tone: "hi" }), { step: 5, lift: rise(up.sw) });
    fig.part("cap", S(k.slabOf({ x: x - base / 2, y: y - base / 2, w: base, d: base, r: 1.6 }, capLow, half, P, 4), { tone: "mid" })
      + S(k.slabOf({ x: x - dish / 2, y: y - dish / 2, w: dish, d: dish, r: 2 }, capLow + half, half, P, 6, px), { tone: "mid" }),
      { step: 8, lift: rise(up.cap) });
  }

  // The sockets under the board, seen through it while they are lit: after everything that hides them.
  fig.xray("sock", L(sockets.map((paths) => paths.outline).join(""), { tone: "lit", dashed: true }), { by: ["pcb"] });

  fig.hidden("cable", "plugged in after the build");
  fig.step(1, "Start with the bare PCB, face up");
  fig.step(2, "Solder the 9 sockets onto the back");
  fig.step(3, "Solder the Pico flat onto the PCB");
  fig.step(4, "Press the 4 inserts in, set the top on");
  fig.step(5, "Clip the 9 switches into the plate");
  fig.step(6, "Set it in the tray, 4 screws from below");
  fig.step(7, "Stick on the 4 rubber feet");
  fig.step(8, "Press a keycap onto each switch");
  return { title: "3x3 macro keypad", caption: "Nine MX switches on a Raspberry Pi Pico, in a two-part PETG case." };
}
```

That is a first pass: about 55 solids, every line covered, every step in build order. The shipped
`examples/macropad/figure.mjs` is the finished figure, for a sense of where it goes: the top drawn by hand so the
cutouts and the USB opening are open, with their inner walls; a switch's stem, flange and lower housing held at the
plate; a tapered keycap with its dish; the Pico's castellations, chips and micro-B socket; the tray's walls, floor
and standoffs; threaded screws, knurled inserts, domed feet; x-rays of the sockets, the Pico, the inserts, the
screws and the feet; and the cable from the Pico to a USB-A plug on the desk.

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

**Parts on a tilted face or any axis** (a plug in a side wall, a button on a sloped panel, a bracket at an angle)

| Call | For |
| --- | --- |
| `G.frameOf(o, a, u, v)` | A frame at `o`: `a` is the part's axis (out of the face), `u` and `v` lie in the face. Give unit vectors at right angles; `u`, `v` fix which way a non-round outline points. |
| `G.frameAlong(o, a)` | The same with `u`, `v` chosen for you, for round parts where the turn doesn't matter. |
| `G.prismOf(F, polygon, s0, s1, P)` | A `[u, v]` outline extruded along `a` from `s0` to `s1`: a USB plug's body, a key on a slope. Convex outlines only (round its corners with `k.roundedPlan`); build an L or a notch from convex pieces, painted far to near. |
| `G.circleOf(F, s, r, P)` | A circle on that face at `s` along the axis: a port's mouth, an LED, a bore (fill it as a void). |
| `G.solidOf(profile, F, P)` | A turned part on that axis (above). |

Points on the face are `F.o + s·a + x·u + y·v`; the shipped macropad's cable builds its plugs this way.

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
| `k.topMatrix(at, z, P)`, `k.sideMatrix([x, y], z, P, "left" or "right")` | A transform to draw flat on a face: a display, a label plate. Its text reads the right way round. For an azimuth from 0 to 90, `"left"` is the face across x (the plane `x = at[0]`, on the screen's left) and `"right"` the face across y. Local x runs toward +y on `"left"` and on a top face along `"y"`, and toward −x on `"right"` and on a top face along `"x"`: for start-anchored text, put `at` at that face's −y or +x end. |
| `k.lightAcross(P)` | The floor direction `[x, y]` the light comes from, for shading an upright face you draw yourself (see `shade` below). |
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
  Two solids meeting at the split each draw their outline there, a crease across the part that isn't on the real
  one. Instead draw the whole part in both calls and clip each copy to its side of the split (the clip helper
  below), so the only outline is the part's own.
- The order is fixed, so check it apart as well as assembled: a lifted part must still be drawn after everything it
  covers. If it isn't, change the lift or the order.
- A part that passes through another (a switch's lower housing through the plate, a plug into a notch in a wall) is
  clipped to what shows of it, and the clip must stay with the part it passes through while either moves: put
  `data-a2-with="<line>"` on the clip path's `<path>` and the page holds it where that line's part is. Clip ids must
  be unique on the page, so build them from `bom.slug`.
- `data-a2-with` on an element outside every part (a halo in `fig.under`) moves and fades it with that line's part:
  the shadow under the base goes with the base when the base drops away. Add `data-a2-until="<line>"` to show it
  only in the steps before that line is placed: a board's own shadow, for the steps before the tray it sits in.
  `data-a2-until` also works on a clip region: a region of the whole card (`EVERYWHERE` below) with
  `data-a2-until="<shell>"` keeps a part in a shell's opening whole in the steps before that shell goes on, and the
  clip cuts it to the opening once the shell is placed. Size the base's halo to the part it moves with (the plate
  it stands on), so taken apart it does not stay as a base-sized smudge.
- `data-a2-dark` on a part's group (`<g data-a2-dark>...</g>` round its svg) draws its tubes nearer the shadow
  tone: a part made in a dark material (a matte black gooseneck) then does not read as chrome in the light theme.
- Past a few dozen overlapping round parts, cables and pipes, stop tuning by eye. `kit/audit.mjs` (shipped from
  Anatomy but not wired into `A figure`: nothing here runs it for you) can measure true depth from a scratch
  script; see `reference/anatomy/craft.md`, section 5, and `kit.md`, section 12.

**Recipe: a clip that stays with a part.** A switch's lower housing shows only above the plate it passes through:

```js
let clips = 0;
const clipped = (poly, content, { withLine, evenodd = false } = {}) => {
  const id = `a2-${bom.slug}-clip-${clips++}`; // unique on the page
  return `<clipPath id="${id}"><path${withLine ? ` data-a2-with="${withLine}"` : ""}${evenodd ? ' clip-rule="evenodd"' : ""}`
    + ` d="${poly}"/></clipPath><g clip-path="url(#${id})">${content}</g>`;
};
// The screen region above the plate's opening: what you can see of a part through it.
const column = (points, z, h = 400) => k.pathOf(G.hullOf([...points.map(([x, y]) => k.iso([x, y, z], P)),
  ...points.map(([x, y]) => k.iso([x, y, z + h], P))]));
fig.part("sw", clipped(column(hole, plateTop), lowerHousing, { withLine: "top" }) + upperHousing, { step: 5, lift });
```

`withLine` names the part the clip belongs to (the plate), so the clip moves with the plate while the switch
comes off. For the opposite, a region cut away (the wall in front of a plug in a notch), clip to a big rectangle
with the region as a hole: `` `M-2000 -2000H4000V4000H-2000Z${region}` `` with `evenodd: true`.

**Recipe: the inside of an open box** (a tray, a drawer, a lid seen from below). Fill the floor, then each inner
wall that faces you, clipped to the opening, so the near walls never show through the rim:

```js
const open = lip.map(([x, y]) => k.iso([x, y, top], P)); // lip: the inner outline, counter-clockwise
const inside = [`<path class="iso-shade" data-shade="1" d="${k.onTop(lip, floor, P, true)}"/>`];
lip.forEach(([ax, ay], i) => {
  const [bx, by] = lip[(i + 1) % lip.length];
  const n = [-(by - ay), bx - ax, 0]; // the inner wall's normal, into the box
  if (G.dot3(n, G.viewOf(P)) <= 0) return; // a near wall: it faces away
  inside.push(`<path class="iso-shade" data-shade="${shade(n)}" d="${k.pathOf([[ax, ay, top], [bx, by, top],
    [bx, by, floor], [ax, ay, floor]].map((q) => k.iso(q, P)))}"/>`);
});
body + clipped(k.pathOf(open), inside.join("")) + k.lineSvg(k.pathOf(open), { tone: "lo" });
```

Draw the seam where those far walls meet the floor from the same edges. (`k.ringSeam` and `k.sideSeam` draw the
near, outward-facing side of a ring, which inside a box is hidden under the rim.) `shade` is the kit's rule for an
upright face, as `k.extrude` shades its sides; the shipped macropad has it as `shadeOf`:

```js
const [lx, ly] = k.lightAcross(P);
const shade = ([nx, ny]) => Math.min(3, Math.max(0, Math.floor(((nx * lx + ny * ly) / (Math.hypot(nx, ny) || 1) + 1) / 2 * 4)));
```

## Taking it apart, and the steps

- Lift each part along its real way out: up for a layer stack and a lid, down for screws and feet put in from
  below, out sideways for a drawer, a card or a module that slides. Far enough to clear its neighbours, no more.
- A part that stays attached goes with the part that holds it: give them the same lift.
- Don't lift toward the camera. A lift whose direction is close to the line of sight (the unit lift's dot with
  `G.viewOf(P)` above about 0.4) hardly moves on screen, and it brings the part in front of parts painted after it,
  which still cover it. Lift across the view instead, or paint the part after what it comes out in front of.
- `step` is the step that places the part. Write one `fig.step` caption per step, as a short instruction, in build
  order: under about 45 characters for the desktop readout, and about 30 to stay on one line on a phone (it wraps
  to two there; the full text always shows under the card).
- The build plan's assembly steps come from `design.json` `assembly`: keep its placing steps in the same order and
  words as the figure's. `assembly` also has the steps that place no part (order the prints, flash the firmware,
  test it); leave those out of the figure.
- The step walk shows the parts of earlier steps in place, lights the current step's parts, and lifts the later
  ones away along their `lift` as they fade out. So the figure must read at every step, and a lift must look
  right in motion too: check each step in a shot.

## Craft rules (short form)

From Anatomy's craft rules, aimed at a product. `reference/anatomy/craft.md` has the reasons and recipes.

- **Solids, not wireframes.** Every part is filled and painted in order, so what is in front hides what is behind.
  No see-through boxes, no dashed hidden edges. The one exception is a part the others hide from every side you
  see (sockets under a board, inserts in a lid, feet under a tray): give it an x-ray with
  `fig.xray(line, svg, { by })`, its outline as a dashed `lit` line and, if you like, a faint fill of its body
  (`<path class="a2-ghost" d="...">`). Call it after every part that hides it, so it draws over them, and before
  any part that really stands in front of it. `by` names the parts that hide it: the page shows the x-ray only
  while its line is lit (on hover, a pick or the step that places it) and one of those is in place over it, so it
  never appears before the lid that hides it is on, and never in the apart pose. It moves with its part.
- **Enclosures in the step walk.** The camera looks down, so a closed top shell hides every step done inside it.
  Place each shell at the step that really closes it (the lid at "Close the case"), with its screws, and show the
  open half that holds the parts from step 1. Until the shell goes on, draw its outline as a faint dashed line
  (`fig.under`, `data-a2-with` on the open half, `data-a2-until` on the shell) so the parts it will carry have a
  place, and open the clips of the parts in its openings with `data-a2-until`. Ponder's figure does this for its
  base top and head upper. Then check that the closing steps visibly add the shell.
- **Let the kit shade.** `slabOf`, `cylinder` and `extrude` give four side tones and a lighter top. Use `flat`
  only for inlays thinner than 1 mm.
- **Tone hierarchy.** The base, tray and feet are `lo`; the case, frame and boards `mid`; the parts the build is
  about (the switches, the controller, the lamp head) `hi`. The page lights one part at a time on hover and in the
  step walk, so don't mark anything `lit` yourself. Grooves and inset outlines are `faint`.
- **Small precise detail.** Bevels of `0.4 * px` to `1.6 * px`, seams inset from the edge, screws as small dots or
  heads with a ring, real hole patterns, connector shells, label plates. Each detail belongs to a part.
- **Lines resolve.** Every line ends on a face, another line or a terminal dot. No leader lines, balloons,
  dimension arrows or floating labels: names go in the readout and the parts list, which the page builds from the BOM.
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
2. `A figure <slug> --draft`: read the coverage table. Every line is drawn the right number of times or hidden with a
   reason; the command exits 1 otherwise.
3. Shots: `A shot <slug>` (assembled), `A shot <slug> --apart`, `A shot <slug> --step <n>` for every step,
   `A shot <slug> --select <line>` for the parts that matter, `A shot <slug> --width 390` (phone),
   `A shot <slug> --light`, and 4x zooms over every junction with `--zoom x,y,w,h` (a box in CSS px from the
   card's top left corner, shot at 4x). Flags combine (`--apart --select pcb`). Shots are 1100 px wide unless
   `--width` says otherwise: at that width the page has one column and the card is its full 720 px. Each writes
   `products/<slug>/shots/<name>.png` (`rest.png`, `apart.png`, `step-3.png`, ...) and prints its path. It needs
   Chrome or Chromium; set `CHROME_PATH` if it isn't found.
4. Ask of every shot: is it instantly this product? Could someone build it from the steps? Is every part from the
   BOM there, at its true size? Does every line end on something? At 4x, is there a bare face or an empty corner?
   Is anything drawn over something that should hide it, assembled or apart?
5. Fix in `figure.mjs` (or `design.json` when a number was wrong), rerun `A figure <slug> --draft`, reload, shoot
   again. Repeat until the answers are yes; then `A figure <slug>` proposes the design (`run.md`, gate 1).

## Sizes and big products

Name the size before drawing (`run.md`, stage 1, move 1). A Figure is 40-80 solids, a Hero 80-150. An Epic (a
switchgear line-up, a vehicle, a plant) is not drawn whole on the first pass: propose a smaller first build that
keeps the core (one panel of the line-up with its breaker, busbars and cable box; one bay of the frame), say what
the full build adds, and draw the full one only if the user chooses it. A big product is still millimetres: the
camera fits it, and `px` keeps the details a pixel or two wide.
