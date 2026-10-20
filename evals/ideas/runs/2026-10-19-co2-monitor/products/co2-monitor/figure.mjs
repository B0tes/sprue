// The desk CO2 monitor, drawn for the person who will build it.
// World: millimetres, the frame of cad/_params.py: origin at the centre of the case's footprint on its underside,
// x to the right (the USB side), y toward the back lid, z up. Every number below is in that frame.
// The kit's projection is left-handed (k.iso sends +x and +y to opposite sides of the screen from a right-handed
// view), so drawn as they are the CAD's right-handed coordinates come out mirrored: the USB opening would show on
// the left. Every point therefore goes to the kit through m(), which flips y, and the camera sits at azimuth +40:
// it sees the front, the right side with the USB opening and the top, the right way round.
//
// Paint order is call order: the feet and the lid's screws (behind everything), the lid with its standoffs and
// vents, a dark backing for the inside of the case, the inserts at the rim, the Pico and the sensor on the lid, the
// OLED, the shell (clipped open at the window, the LED hole and the USB opening, with the cut faces you see through them),
// the x-rays of what the shell hides, the LED's lens in front, and the USB cable at the right.
// Apart, the two halves separate: the lid with the Pico and the sensor comes off the back and up; the shell keeps
// what is glued and screwed into it (inserts, LED, OLED); the feet drop; the cable pulls out to the right.

export default function draw({ k, G, T, fig, params: p, bom, spec }) {
  const PI = spec("pico"), INS = spec("ins"), S3 = spec("scr3"), S2 = spec("scr2"), S2S = spec("scr2s");
  const FOOT = spec("feet"), CORD = spec("usbcable");

  // ---- the frame and the numbers, as cad/_params.py ---------------------------------------------------------
  const W = p.caseWidthMm, D = p.caseDepthMm, H = p.caseHeightMm, WALL = p.shellWallMm;
  const FRONT = -D / 2, FRONT_IN = FRONT + WALL, RIM = D / 2 - p.lidThicknessMm, BACK = D / 2, X_IN = W / 2 - WALL;
  const bosses = [-1, 1].flatMap((sx) => [WALL + p.bossInsetMm, H - WALL - p.bossInsetMm].map((z) => [sx * (X_IN - p.bossInsetMm), z]));
  // The Pico, on the lid, components toward the front, its USB end at the right wall.
  const PICO_BACK = RIM - p.picoStandoffMm, PICO_TOP = PICO_BACK - p.picoBoardMm;
  const PICO_X1 = X_IN - p.picoUsbEndGapMm, PICO_X0 = PICO_X1 - p.picoLengthMm, PICO_CX = (PICO_X0 + PICO_X1) / 2;
  const PICO_Z0 = p.picoBottomZMm, PICO_Z1 = PICO_Z0 + p.picoWidthMm, PICO_CZ = (PICO_Z0 + PICO_Z1) / 2;
  const USB_Y = PICO_TOP - p.picoUsbCentreAboveBoardMm, USB_Z = PICO_CZ;
  const picoHoles = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [PICO_CX + (sx * p.picoHolePitchXMm) / 2, PICO_CZ + (sz * p.picoHolePitchYMm) / 2]));
  const picoScrews = picoHoles.slice(0, 2); // the far end; the USB end sits on printed pins
  // The SCD-40 breakout, on the lid's tall standoffs, its sensor toward the lid's vents.
  const CO2_SENSOR_TOP = RIM - p.co2SensorToLidMm, CO2_TOP = CO2_SENSOR_TOP - p.co2SensorHeightMm, CO2_BACK = CO2_TOP - p.co2BoardThicknessMm;
  const CO2_CX = p.co2CentreXMm, CO2_CZ = p.co2CentreZMm, CO2_SZ = CO2_CZ + p.co2SensorOffsetUpMm;
  const cw = p.co2BoardWidthMm, ch = p.co2BoardHeightMm;
  const cdx = cw / 2 - p.co2HoleInsetMm, cdz = ch / 2 - p.co2HoleInsetMm;
  const co2Holes = [[CO2_CX + cdx, CO2_CZ - cdz], [CO2_CX - cdx, CO2_CZ - cdz], [CO2_CX + cdx, CO2_CZ + cdz], [CO2_CX - cdx, CO2_CZ + cdz]];
  const co2Screws = [co2Holes[0], co2Holes[3]];
  // The OLED: glass on the front wall's inner face, the board behind it.
  const OLED_FRONT = FRONT_IN + p.oledGlassThicknessMm + p.oledTapeMm, OLED_BACK = OLED_FRONT + p.oledBoardThicknessMm;
  const OCX = p.oledCentreXMm, OLED_Z0 = p.oledBottomZMm, ow = p.oledBoardWidthMm, oh = p.oledBoardHeightMm;
  const GLASS_CZ = OLED_Z0 + p.oledGlassCentreFromBottomMm;
  const ACTIVE_CZ = GLASS_CZ + p.oledGlassHeightMm / 2 - p.oledActiveFromGlassTopMm - p.oledActiveHeightMm / 2;
  const odx = ow / 2 - p.oledHoleInsetXMm;
  const oledScrews = [[OCX - odx, OLED_Z0 + p.oledUpperHoleFromBottomMm], [OCX + odx, OLED_Z0 + p.oledUpperHoleFromBottomMm]];
  const oledHoles = [...oledScrews, [OCX - odx, OLED_Z0 + p.oledLowerHoleFromBottomMm], [OCX + odx, OLED_Z0 + p.oledLowerHoleFromBottomMm]];
  // The LED, the window and the USB opening.
  const LED_X = p.ledCentreXMm, LED_Z = p.ledCentreZMm;
  const LED_TIP = FRONT_IN + p.ledFlangeThicknessMm - p.ledSeatedHeightMm, LENS_R = p.ledLensMm / 2;
  const ww = p.windowWidthMm, wh = p.windowHeightMm;
  const ay = p.usbOpeningAlongYMm, az = p.usbOpeningAlongZMm;
  const feet = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * p.footCentreXMm, sy * p.footCentreYMm]));
  const DESK = -FOOT.heightMm;
  // The USB plug: the moulding from the wall's outer face (its first 1.5 mm, inside the opening, is left out),
  // as far as cad/_system.py's envelope reaches, then a strain relief and the cord.
  const MOULD_END = PICO_X1 - PI.usbDepthMm + CORD.plugLengthMm;
  const CORD_R = CORD.cordDiameterMm / 2;

  // ---- apart -------------------------------------------------------------------------------------------------
  const m = ([x, y, z]) => [x, -y, z]; // the CAD frame to the kit's (see the top)
  const LID_UP = [0, 20, H + 12]; // the lid and all it carries: off the back, then up clear of the shell
  const SCREW_OUT = [0, LID_UP[1] + 12, LID_UP[2]]; // the lid's screws, out of the back of the lid
  const FEET_DOWN = [0, 0, -12];
  const PULL = [26, 0, 0]; // the cable slides out of the opening to the right

  // ---- the cord's route: out of the strain relief, down to the desk, round toward you to a USB-A plug ---------
  const relief = MOULD_END + 8;
  const A_BODY_H = CORD.aShellHeightMm + 3.2; // a typical USB-A moulding round the standard shell
  const A_Z = DESK + A_BODY_H / 2;
  const route = [
    [relief + 10, USB_Y, USB_Z - 2],
    [relief + 22, USB_Y - 12, DESK + CORD_R],
    [relief + 22, USB_Y - 44, DESK + CORD_R],
    [relief + 10, USB_Y - 62, A_Z],
  ];

  // ---- camera ------------------------------------------------------------------------------------------------
  fig.size(640, 600);
  const CASE = { x: -W / 2, y: FRONT, w: W, d: D, r: 0 };
  const lifted = (pts, [dx, dy, dz]) => pts.map(([x, y, z]) => [x + dx, y + dy, z + dz]);
  const P = fig.camera([
    ...k.boxCorners(CASE, DESK + FEET_DOWN[2], H),
    ...lifted(k.boxCorners(CASE, 0, H), LID_UP),
    [LED_X, LED_TIP - 1, LED_Z],
    ...route.flatMap((q) => [q, lifted([q], PULL)[0], [q[0] + 8, q[1] - 12, q[2]]]),
  ].map(m), { azimuth: 40, pad: 26 });
  const px = 1 / P.scale;

  // ---- drawing helpers ---------------------------------------------------------------------------------------
  const at = (q) => k.iso(m(q), P);
  const path = (pts, closed = true) => k.pathOf(pts, closed);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const depth = (q) => k.depthOf(m(q), P);
  const byDepth = (list, of = (item) => item) => [...list].sort((a, b) => depth(of(a)) - depth(of(b)));
  const rr = (u0, u1, v0, v1, r = 0, steps = 4) => k.roundedPlan({ x: u0, y: v0, w: u1 - u0, d: v1 - v0, r }, steps);
  // A box or rounded slab whose outline lies in x-z, from y0 to y1 (boards, the case, the lid).
  const FY = G.frameOf([0, 0, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1]); // s is the CAD's y
  const slabY = (x0, x1, z0, z1, y0, y1, r = 0, steps = 4) => G.prismOf(FY, rr(x0, x1, z0, z1, r, steps), y0, y1, P);
  // A round part on the y axis at (x, z), from the face at y0 along `dir` (+1 back, -1 toward the front).
  const yAxis = (x, y0, z, dir) => G.frameAlong(m([x, y0, z]), [0, -dir, 0]);
  const ringY = (x, y, z, r) => G.circleOf(G.frameAlong(m([x, y, z]), [0, 1, 0]), 0, r, P);
  /** A pan or button head on the y axis, from the face it sits on (y0) along dir: domed, with a cross. */
  const headOf = (x, y0, z, dir, d, h) => {
    const F = yAxis(x, y0, z, dir), r = d / 2;
    const solid = G.solidOf([[0, r], [h * 0.45, r, 1], [h * 0.8, r * 0.78, 1], [h, r * 0.4, 1]], F, P);
    const cross = path([at([x - r * 0.45, y0 + dir * h, z]), at([x + r * 0.45, y0 + dir * h, z])], false)
      + path([at([x, y0 + dir * h, z - r * 0.45]), at([x, y0 + dir * h, z + r * 0.45])], false);
    return { solid, svg: S(solid, { tone: "mid", inner: L(cross, { tone: "faint" }) }) };
  };
  const voidOf = (d) => `<path class="iso-shade" data-shade="0" d="${d}"/>`;
  /** A flat face with the kit's tone for its normal: the cut faces seen through an opening. */
  const faceOf = (pts, n) => {
    const band = G.toneOf(m(n), P), d = path(pts.map(at));
    return `<g class="iso-solid"><path class="iso-fill" d="${d}"/>${band >= 4 ? `<path class="iso-top" d="${d}"/>`
      : `<path class="iso-shade" data-shade="${band}" d="${d}"/>`}<path class="iso-line iso-edge" data-tone="faint" d="${d}"/></g>`;
  };
  let clips = 0;
  function clipped(poly, content, { withLine, evenodd = false } = {}) {
    const id = `a2-${bom.slug}-clip-${clips++}`;
    return `<clipPath id="${id}"><path${withLine ? ` data-a2-with="${withLine}"` : ""}${evenodd ? ' clip-rule="evenodd"' : ""} d="${poly}"/></clipPath><g clip-path="url(#${id})">${content}</g>`;
  }
  /** The parts the shell or the lid hide, by BOM line: fig.xray draws their outline dashed and a faint body. */
  const xray = {};
  const hide = (line, ...solids) => { (xray[line] ??= []).push(...solids); };
  const xrayOf = (line) => `<path class="a2-ghost" d="${(xray[line] ?? []).map((s) => s.fill).join("")}"/>`
    + L((xray[line] ?? []).map((s) => s.outline).join(""), { tone: "lit", dashed: true });

  fig.under(`<path class="iso-halo" data-a2-with="shell" d="${k.haloOf({ ...CASE, r: 3 }, DESK, FOOT.heightMm, P)}"/>`);

  // ---- 7 the feet, under the shell ----------------------------------------------------------------------------
  const footSolids = byDepth(feet, ([x, y]) => [x, y, DESK]).map(([x, y]) => k.cylinder(x, -y, FOOT.diameterMm / 2, DESK, FOOT.heightMm, P, 20, px));
  hide("feet", ...footSolids);
  fig.part("feet", footSolids.map((s) => S(s, { tone: "lo" })).join(""), { step: 7, count: feet.length, lift: m(FEET_DOWN) });

  // ---- 6 the lid's four M3 screws, button heads on its back face: behind everything from here -----------------
  const m3 = bosses.map(([x, z]) => {
    const head = headOf(x, BACK, z, 1, S3.headMm, S3.headHeightMm);
    const shank = G.disc(0, S3.lengthMm, S3.diameterMm / 2, yAxis(x, BACK, z, -1), P);
    hide("scr3", head.solid);
    return S(shank, { tone: "mid" }) + head.svg;
  });
  fig.part("scr3", m3.join(""), { step: 6, count: bosses.length, lift: m(SCREW_OUT) });

  // ---- 6 the lid: a plate with the Pico's and the sensor's standoffs and ten slots, seen inside when apart ------
  {
    const plate = slabY(-W / 2, W / 2, 0, H, RIM, BACK, p.caseEdgeRadiusMm, 6);
    const slots = [];
    const n = p.ventSlotCount, ni = p.intakeSlotCount, pitch = p.ventSlotPitchMm, sw = p.ventSlotWidthMm;
    for (let i = 0; i < n; i++) slots.push([CO2_CX + (i - (n - 1) / 2) * pitch, CO2_SZ, sw, p.ventSlotLengthMm]);
    for (let i = 0; i < ni; i++) slots.push([(i - (ni - 1) / 2) * pitch, p.intakeCentreZMm, sw, p.intakeSlotLengthMm]);
    const slotSvg = slots.map(([x, z, w, h]) => {
      const d = path(rr(x - w / 2, x + w / 2, z - h / 2, z + h / 2, w / 2, 4).map(([u, v]) => at([u, RIM - 0.01, v])));
      return voidOf(d) + L(d, { tone: "lo" });
    }).join("");
    const posts = [
      ...picoHoles.map(([x, z]) => [x, z, RIM - PICO_BACK, p.picoStandoffDiameterMm / 2]),
      ...co2Holes.map(([x, z]) => [x, z, RIM - CO2_TOP, p.co2StandoffDiameterMm / 2]),
    ];
    const postSvg = byDepth(posts, ([x, z]) => [x, RIM, z]).map(([x, z, len, r]) =>
      S(G.disc(0, len, r, yAxis(x, RIM, z, -1), P), { tone: "lo" })).join("");
    const holeSvg = bosses.map(([x, z]) => L(ringY(x, RIM - 0.01, z, p.lidScrewClearanceMm / 2), { tone: "lo" })).join("");
    fig.part("lid", S(plate, { tone: "mid", inner: slotSvg + holeSvg }) + postSvg, { step: 6, lift: m(LID_UP) });
  }

  // ---- the shell's three openings, on screen -------------------------------------------------------------------
  const wx0 = OCX - ww / 2, wx1 = OCX + ww / 2, wz0 = ACTIVE_CZ - wh / 2, wz1 = ACTIVE_CZ + wh / 2;
  const windowHole = path([[wx0, FRONT, wz0], [wx1, FRONT, wz0], [wx1, FRONT, wz1], [wx0, FRONT, wz1]].map(at));
  const ledHole = ringY(LED_X, FRONT, LED_Z, p.ledHoleMm / 2);
  const uy0 = USB_Y - ay / 2, uy1 = USB_Y + ay / 2, uz0 = USB_Z - az / 2, uz1 = USB_Z + az / 2;
  const usbHole = path(rr(uy0, uy1, uz0, uz1, 1.5, 4).map(([y, z]) => at([W / 2, y, z])));

  // ---- 1 the shell, first half: the dark inside of the case, only where an opening shows it ----------------------
  {
    const cavity = [-X_IN, X_IN].flatMap((x) => [FRONT_IN, RIM].flatMap((y) => [WALL, H - WALL].map((z) => at([x, y, z]))));
    fig.part("shell", clipped(windowHole + ledHole + usbHole, voidOf(path(G.hullOf(cavity)))), { step: 1 });
  }

  // ---- 1 the inserts in the corner columns, at the rim, behind all but the lid---------------------------------------------------------
  {
    const inserts = bosses.map(([x, z]) => G.disc(0, INS.lengthMm, INS.outerMm / 2, yAxis(x, RIM, z, -1), P));
    hide("ins", ...inserts);
    // Each sits in its corner column's hole, which opens only to the back: never seen through the shell's openings.
    fig.part("ins", clipped(`M-4000 -4000H8000V8000H-4000Z${windowHole}${ledHole}${usbHole}`,
      inserts.map((s) => S(s, { tone: "mid" })).join(""), { evenodd: true }), { step: 1, count: bosses.length });
  }

  // ---- 4 the Pico on its standoffs, and its two screws ----------------------------------------------------------
  {
    const board = slabY(PICO_X0, PICO_X1, PICO_Z0, PICO_Z1, PICO_TOP, PICO_BACK, 0.5);
    const first = (p.picoLengthMm - (PI.padsPerSide - 1) * PI.padPitchMm) / 2;
    const pads = [PICO_Z0 + 0.6, PICO_Z1 - 0.6].flatMap((z) =>
      Array.from({ length: PI.padsPerSide }, (_, i) => [PICO_X0 + first + i * PI.padPitchMm, PICO_TOP - 0.01, z]));
    const chip = slabY(PICO_CX - 3.5, PICO_CX + 3.5, PICO_CZ - 3.5, PICO_CZ + 3.5, PICO_TOP - 0.9, PICO_TOP, 0.3);
    const socket = slabY(PICO_X1 - PI.usbDepthMm, PICO_X1, USB_Z - PI.usbWidthMm / 2, USB_Z + PI.usbWidthMm / 2,
      PICO_TOP - p.picoTallestAboveBoardMm, PICO_TOP, 0.4);
    const holes = picoHoles.map(([x, z]) => L(ringY(x, PICO_TOP - 0.01, z, p.picoHoleMm / 2), { tone: "lo" })).join("");
    hide("pico", board, socket);
    fig.part("pico", S(board, { tone: "hi", inner: holes }) + k.dotsSvg(k.pointsAt(pads.map(m), P), { size: 0.5 })
      + S(chip, { tone: "mid" }) + S(socket, { tone: "hi" }), { step: 4, lift: m(LID_UP) });
    const heads = byDepth(picoScrews, ([x, z]) => [x, PICO_TOP, z]).map(([x, z]) => headOf(x, PICO_TOP, z, -1, S2.headMm, S2.headHeightMm));
    hide("scr2", ...heads.map((h) => h.solid));
    fig.part("scr2", heads.map((h) => h.svg).join(""), { step: 4, count: picoScrews.length, lift: m(LID_UP) });
  }

  // ---- 5 the SCD-40 breakout: the sensor block behind its board, the 5-pin header row, and its two screws -----------
  {
    const s = p.co2SensorSizeMm;
    const sensor = slabY(CO2_CX - s / 2, CO2_CX + s / 2, CO2_SZ - s / 2, CO2_SZ + s / 2, CO2_TOP, CO2_SENSOR_TOP, 0.3);
    const board = slabY(CO2_CX - cw / 2, CO2_CX + cw / 2, CO2_CZ - ch / 2, CO2_CZ + ch / 2, CO2_BACK, CO2_TOP, 1);
    const holes = co2Holes.map(([x, z]) => L(ringY(x, CO2_BACK - 0.01, z, p.co2HoleMm / 2), { tone: "lo" })).join("");
    const zh = CO2_CZ - ch / 2 + p.co2HeaderFromBottomMm;
    const header = Array.from({ length: 5 }, (_, i) => [CO2_CX + (i - 2) * 2.54, CO2_BACK - 0.01, zh]);
    hide("co2", board);
    fig.part("co2", S(sensor, { tone: "hi" }) + S(board, { tone: "mid", inner: holes })
      + k.dotsSvg(k.pointsAt(header.map(m), P), { size: 0.7, tone: "lo" }), { step: 5, lift: m(LID_UP) });
    const heads = byDepth(co2Screws, ([x, z]) => [x, CO2_BACK, z]).map(([x, z]) => headOf(x, CO2_BACK, z, -1, S2.headMm, S2.headHeightMm));
    hide("scr2b", ...heads.map((h) => h.solid));
    fig.part("scr2", heads.map((h) => h.svg).join(""), { step: 5, count: co2Screws.length, lift: m(LID_UP) });
  }

  // ---- 3 the OLED: its two screws (heads on its back), the board, the glass and the lit screen --------------------
  {
    const heads = oledScrews.map(([x, z]) => headOf(x, OLED_BACK, z, 1, S2S.headMm, S2S.headHeightMm));
    hide("scr2s", ...heads.map((h) => h.solid));
    fig.part("scr2s", heads.map((h) => h.svg).join(""), { step: 3, count: oledScrews.length });
    const board = slabY(OCX - ow / 2, OCX + ow / 2, OLED_Z0, OLED_Z0 + oh, OLED_FRONT, OLED_BACK, 1);
    const gw = p.oledGlassWidthMm, gh = p.oledGlassHeightMm;
    const glass = slabY(OCX - gw / 2, OCX + gw / 2, GLASS_CZ - gh / 2, GLASS_CZ + gh / 2, FRONT_IN, OLED_FRONT - p.oledTapeMm, 0.2);
    const aw = p.oledActiveWidthMm, ah = p.oledActiveHeightMm;
    const active = path(rr(OCX - aw / 2, OCX + aw / 2, ACTIVE_CZ - ah / 2, ACTIVE_CZ + ah / 2).map(([u, v]) => at([u, FRONT_IN - 0.02, v])));
    const reading = k.faceTextSvg(k.sideMatrix([OCX, -(FRONT_IN - 0.03)], ACTIVE_CZ - 1.8, P, "left"), "640 ppm",
      { size: 4.6, tone: "hi", anchor: "middle" });
    const holes = oledHoles.map(([x, z]) => L(ringY(x, OLED_FRONT - 0.01, z, p.oledHoleMm / 2), { tone: "lo" })).join("");
    hide("oled", board);
    fig.part("oled", S(board, { tone: "mid", inner: holes }) + S(glass, { tone: "lo" }) + voidOf(active) + reading,
      { step: 3 });
  }

  // ---- 1 the shell, second half: the body, open at the window, the LED hole and the USB opening -------------------
  {
    const body = slabY(-W / 2, W / 2, 0, H, FRONT, RIM, p.caseEdgeRadiusMm, 6);
    // What you see of the cut faces through each opening: the sill and the left side of the window, the floor
    // and the back side of the USB opening.
    const cuts = faceOf([[wx0, FRONT, wz0], [wx1, FRONT, wz0], [wx1, FRONT_IN, wz0], [wx0, FRONT_IN, wz0]], [0, 0, 1])
      + faceOf([[wx0, FRONT, wz0], [wx0, FRONT_IN, wz0], [wx0, FRONT_IN, wz1], [wx0, FRONT, wz1]], [1, 0, 0])
      + faceOf([[X_IN, uy0, uz0], [W / 2, uy0, uz0], [W / 2, uy1, uz0], [X_IN, uy1, uz0]], [0, 0, 1])
      + faceOf([[X_IN, uy1, uz0], [W / 2, uy1, uz0], [W / 2, uy1, uz1], [X_IN, uy1, uz1]], [0, -1, 0]);
    const seam = path([[W / 2, RIM, p.caseEdgeRadiusMm], [W / 2, RIM, H - p.caseEdgeRadiusMm]].map(at), false);
    fig.part("shell", clipped(`M-4000 -4000H8000V8000H-4000Z${windowHole}${ledHole}${usbHole}`, S(body, { tone: "mid" }), { evenodd: true })
      + clipped(windowHole + usbHole, cuts) + L(windowHole + ledHole + usbHole, { tone: "lo" }) + L(seam, { tone: "faint" }),
      { step: 1, count: 0 });
  }

  // ---- what the shell and the lid hide, while they are in place over it -------------------------------------------
  for (const [line, by] of [["feet", ["shell"]], ["ins", ["shell"]], ["oled", ["shell"]], ["scr2s", ["shell"]], ["pico", ["shell"]], ["co2", ["shell"]], ["scr3", ["lid"]]])
    fig.xray(line, xrayOf(line), { by });
  fig.xray("scr2", xrayOf("scr2"), { by: ["shell"], step: 4 });
  fig.xray("scr2", xrayOf("scr2b"), { by: ["shell"], step: 5 });

  // ---- 2 the LED's lens, out through the front wall: a short barrel and a dome --------------------------------------
  {
    const out = FRONT - LED_TIP, barrel = out - LENS_R;
    const dome = [15, 30, 45, 60, 75].map((deg) => [barrel + LENS_R * Math.sin((deg * Math.PI) / 180), LENS_R * Math.cos((deg * Math.PI) / 180), 1]);
    const lens = G.solidOf([[0, LENS_R], [barrel, LENS_R, 1], ...dome, [out - 0.05, 0.35, 1]], yAxis(LED_X, FRONT, LED_Z, -1), P);
    fig.part("led", S(lens, { tone: "hi" }), { step: 2 });
  }

  // ---- 8 the USB cable: the micro-B moulding out of the opening, a cord to the desk, a USB-A plug ---------------------
  {
    const along = G.frameOf(m([0, USB_Y, USB_Z]), [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const roundRect = (w, h, r) => k.roundedPlan({ x: -w / 2, y: -h / 2, w, d: h, r }, 4);
    const mould = G.prismOf(along, roundRect(p.usbOvermoldHeightMm, p.usbOvermoldWidthMm, 1.8), W / 2, MOULD_END, P);
    const sleeve = G.solidOf([[MOULD_END, 3.0], [MOULD_END + 3, 2.6, 1], [MOULD_END + 6, 2.1, 1], [relief, CORD_R]], along, P);
    const cord = G.fillet([[relief - 0.5, USB_Y, USB_Z], ...route].map(m), 14, 12, { P, tube: CORD_R });
    const pieces = T.tubePieces(cord, CORD_R, P, { spacing: 2.2 * px, maxLength: 30 * px });
    const tube = byDepth(pieces, (piece) => piece.mid).map((piece) => T.tubeSvg(piece, { tone: "mid" })).join("");
    const end = m(route[route.length - 1]), before = m(route[route.length - 2]);
    const dir = G.unit3([end[0] - before[0], end[1] - before[1], 0]);
    const lay = G.frameOf([end[0], end[1], A_Z], dir, G.unit3(G.cross3([0, 0, 1], dir)), [0, 0, 1]);
    const aRelief = G.solidOf([[0, CORD_R], [3, 2.3, 1], [6, 2.9]], lay, P);
    const aBody = G.prismOf(lay, roundRect(CORD.aShellWidthMm + 4, A_BODY_H, 1.6), 6, 6 + 18, P);
    const aShell = G.prismOf(lay, roundRect(CORD.aShellWidthMm, CORD.aShellHeightMm, 0.3), 24, 24 + CORD.aShellLengthMm, P);
    const halo = `<path class="iso-halo" d="${aBody.fill}${aShell.fill}"/>`;
    fig.part("usbcable", S(mould, { tone: "mid" }) + S(sleeve, { tone: "mid" }) + tube + halo + S(aRelief, { tone: "mid" })
      + S(aBody, { tone: "mid" }) + S(aShell, { tone: "mid" }), { step: 8, lift: m(PULL) });
  }

  fig.hidden("res", "on the LED's anode leads inside the case, under heat-shrink");
  fig.hidden("qtcable", "inside the case, from the sensor's socket to the OLED's, routed by hand");
  fig.hidden("wire", "hook-up wire inside the case, cut to length from a reel");

  fig.step(1, `Press the ${bosses.length} inserts into the shell`);
  fig.step(2, "Glue the LED into its hole");
  fig.step(3, "Screw the OLED in behind the window");
  fig.step(4, "Screw the Pico onto the lid");
  fig.step(5, "Screw the CO2 sensor onto the lid");
  fig.step(6, `Close the lid with ${bosses.length} M3 screws`);
  fig.step(7, `Stick on the ${feet.length} rubber feet`);
  fig.step(8, "Plug the USB cable into the Pico");

  return {
    title: "Desk CO2 monitor",
    caption: "An SCD-40 CO2 sensor and a Raspberry Pi Pico on the back lid, a 0.96 in OLED and a red/green LED in the "
      + `front shell, ${W} x ${D} x ${H} mm in printed PLA; four M3 screws close it, USB powers it from the right side.`,
  };
}
