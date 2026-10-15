// Ponder, drawn for the person who will buy its parts and build it.
// Two frames, the same as cad/_params.py. The base frame: millimetres, origin at the base centre, x right, y forward
// toward the page and the child, z up, z = 0 on the underside of the bottom plate (the rubber feet stand 2 mm proud,
// so the desk is at z = -2). The head frame: origin at the head centre in plan, z = 0 on its bottom face, x along it,
// y toward the child. The head hangs nose-down by cameraTiltDeg with its nipple over the arm root and its lens
// headReachMm in front of the root and cameraHeightMm above the desk, the pose of assembly step 32, and H() carries a
// head-frame point into the base frame. Every size comes from design.json params or a BOM line's spec; the few the
// datasheets don't give are in EST below, marked as estimates. Run `anatomy figure ponder`.
//
// Paint order is call order. The base first: the screws and feet under the plate, the plate, the USB-C board on it,
// then the parts the top shell carries (harness tail, nut, discs, junction board, speaker, light bar), the inserts,
// the top shell, the talk button and the diffuser in their openings, the coupling on the collar. Then the head: the
// screws under it, the lower shell, what sits in it (shutter, camera, Pi), what hangs from the upper shell (bonnet,
// amp, mics, wiring), the upper shell, the LEDs and the toggle in their holes, the coupling on top. Then the x-rays,
// and the gooseneck last, piece by piece from far to near.
//
// Taken apart, the two shells that hold the arm stay where they are, and what is inside them drops out of their
// open bottoms, layer by layer, so the base and the head both open. A part held in an opening of a shell (the talk
// button, the diffuser, the LEDs, the toggle) is painted after the shell and clipped to what of it shows: outside
// the shell, or in front of its opening. Clips that stay with a part carry data-a2-with.
//
// The step walk shows the open halves first. Seen from above, the base top and the head upper would hide all the
// work, so each goes on at the step that closes it (15 and 14), with its screws. Before that a faint dashed outline
// marks where it will be, and the clips of the parts in its openings are open (data-a2-until: they end when that
// shell is placed). The bottom plate and the head lower are there from step 1.

export default function draw({ k: kit, G: lathe, T: tube, fig: figure, params: p, bom }) {
  // The kit's projection is a mirror image of a right-handed frame (its screen right, up and toward-you make a
  // left-handed set), so a figure written in the CAD frame comes out mirrored: MUTE reads backwards and the toggle
  // lands on the wrong end. Everything below is written in the CAD frame and handed to the kit with x and y swapped,
  // which draws the CAD true. Only these wrappers know about the swap.
  const sw = ([x, y, z]) => [y, x, z];
  const sw2 = ([x, y]) => [y, x];
  const swPlan = ({ x, y, w, d, r }) => ({ x: y, y: x, w: d, d: w, r });
  const k = {
    ...kit,
    iso: (q, P) => kit.iso(sw(q), P),
    slabOf: (plan, ...rest) => kit.slabOf(swPlan(plan), ...rest),
    extrude: (ring, ...rest) => kit.extrude(ring.map(sw2), ...rest),
    cylinder: (cx, cy, ...rest) => kit.cylinder(cy, cx, ...rest),
    ring: (cx, cy, ...rest) => kit.ring(cy, cx, ...rest),
    lineOnTop: (a, b, ...rest) => kit.lineOnTop(sw2(a), sw2(b), ...rest),
    haloOf: (plan, ...rest) => kit.haloOf(swPlan(plan), ...rest),
  };
  const G = {
    ...lathe,
    frameOf: (o, a, u, v) => lathe.frameOf(sw(o), sw(a), sw(u), sw(v)),
    frameAlong: (o, a) => lathe.frameAlong(sw(o), sw(a)),
    viewOf: (P) => sw(lathe.viewOf(P)),
    lightOf: (P) => sw(lathe.lightOf(P)),
  };
  const T = { ...tube, tubePieces: (points, ...rest) => tube.tubePieces(points.map(sw), ...rest).map((piece) => ({ ...piece, mid: sw(piece.mid) })) };
  const fig = {
    size: (...args) => figure.size(...args),
    camera: (points, options) => figure.camera(points.map(sw), options),
    part: (line, svg, options = {}) => figure.part(line, svg, options.lift ? { ...options, lift: sw(options.lift) } : options),
    xray: (...args) => figure.xray(...args),
    hidden: (...args) => figure.hidden(...args),
    step: (...args) => figure.step(...args),
    under: (...args) => figure.under(...args),
    over: (...args) => figure.over(...args),
  };
  const lineOf = (id) => bom.lines.find((line) => line.id === id) ?? {};
  const spec = (id) => lineOf(id).spec ?? {};
  const dims = (text) => String(text).split("x").map((v) => Number.parseFloat(v));
  const rad = (deg) => (deg * Math.PI) / 180;
  const ARC = (n) => Array.from({ length: n - 1 }, (_, i) => (90 * (i + 1)) / n); // the angles inside a quarter-round fillet

  const COUP = spec("coupling"), NUT = spec("nut"), DISC = spec("ballast"), INS3 = spec("ins3"), INS25 = spec("ins25");
  const SCR3 = spec("scr3"), SCR25 = spec("scr25"), FOOT = spec("feet"), RIBBON = spec("harness");
  const [MIC_L, MIC_H, MIC_T] = dims(spec("mic").sizeMm);
  const [AMP_L, AMP_W, AMP_T] = dims(spec("amp").sizeMm);
  const [, , BON_T] = dims(spec("bonnet").sizeMm);
  const [USB_W, USB_D] = dims(spec("usbc").sizeMm);
  const [STK_L, STK_W, STK_H] = dims(spec("stick").sizeMm);
  const [TALK_BW, TALK_BD, TALK_DEPTH] = dims(spec("talk").bodyMm);
  const [TALK_CAP, , TALK_ABOVE] = dims(spec("talk").accessibleDimsMm);
  const [TOG_BW, TOG_BH, TOG_BL] = dims(spec("mute").bodyMm);
  const LED_OUT = dims(spec("ledcam").accessibleDimsMm)[2];
  const [SD_L, SD_W, SD_T] = dims(spec("sd").accessibleDimsMm);
  const PIXELS = Number(spec("stick").pixels);
  const WIRES = Number(RIBBON.conductors), WIRE_OD = Number(RIBBON.wireOdMm);

  // ---- sizes the BOM's datasheets don't give: estimates, read off product photos and drawings, drawn only -----------
  // Sizes no BOM spec gives, from design.json's fig* params (estimates, used only to draw the figure).
  const box3 = (key) => { const [l, w, h] = dims(p[key]); return { l, w, h }; };
  const EST = {
    board: p.figBreakoutPcbMm, // a breakout board's PCB
    piBoard: p.figPiPcbMm, piHeader: p.figPiHeaderHeightMm, foam: p.figFoamTapeMm, // the Pi, header and foam stack, as cad/_fitcheck.py
    piHole: p.figPiHoleMm, piCorner: p.figPiCornerRadiusMm,
    // Along the Pi from its SD end and across it from its port edge (the Zero's mechanical drawing gives the ports).
    hdmi: { at: p.figPiHdmiAlongMm, w: box3("figPiHdmiSizeMm").l, d: box3("figPiHdmiSizeMm").w, h: box3("figPiHdmiSizeMm").h },
    usb: { at: [p.figPiUsbAlongMm, p.figPiPowerUsbAlongMm], w: box3("figPiUsbSizeMm").l, d: box3("figPiUsbSizeMm").w, h: box3("figPiUsbSizeMm").h },
    soc: { at: [p.figPiSocAlongMm, p.figPiSocAcrossMm], w: box3("figPiSocSizeMm").l, h: box3("figPiSocSizeMm").h },
    radio: { at: [p.figPiRadioAlongMm, p.figPiRadioAcrossMm], w: box3("figPiRadioSizeMm").l, d: box3("figPiRadioSizeMm").w, h: box3("figPiRadioSizeMm").h },
    csi: { w: box3("figPiCsiSizeMm").l, d: box3("figPiCsiSizeMm").w, h: box3("figPiCsiSizeMm").h },
    sdSlot: { l: box3("figPiSdSlotSizeMm").l, w: box3("figPiSdSlotSizeMm").w, h: box3("figPiSdSlotSizeMm").h },
    headerBody: p.figHeaderBodyMm, headerPin: p.figHeaderPinMm, pitch: p.figHeaderPitchMm,
    camBoard: p.figCameraPcbMm, camConn: { w: box3("figCameraConnectorSizeMm").l, d: box3("figCameraConnectorSizeMm").w }, lensHolder: p.figCameraLensBoxMm, // the lens box of _fitcheck.py
    fpcWide: p.figCameraCableWideEndMm, fpcNarrow: p.figCameraCableNarrowEndMm, fpcT: p.figCameraCableThicknessMm, // camera cable ends, as _fitcheck.py
    micCan: dims(p.figMicPackageMm), // the SPH0645LM4H package
    ledFlange: p.figLedFlangeMm, ledFlangeT: p.figLedFlangeThicknessMm, ledLeg: p.figLedLegMm,
    toggleNut: { af: dims(p.figToggleNutMm)[0], t: dims(p.figToggleNutMm)[1] }, lever: p.figToggleLeverMm, lugs: p.figToggleLugsMm,
    bezel: p.figTalkBezelMm, plunger: p.figTalkPlungerMm, ringNut: { d: dims(p.figTalkRingNutMm)[0], t: dims(p.figTalkRingNutMm)[1] }, talkLugs: p.figTalkLugsMm,
    magnet: { r: dims(p.figSpeakerMagnetMm)[0] / 2, h: dims(p.figSpeakerMagnetMm)[1] }, dustCap: p.figSpeakerDustCapMm / 2,
    usbRec: { w: box3("figUsbcReceptacleMm").l, d: box3("figUsbcReceptacleMm").w, h: box3("figUsbcReceptacleMm").h }, // a USB-C receptacle shell
    resistor: { l: dims(p.figResistorBodyMm)[0], d: dims(p.figResistorBodyMm)[1] }, diode: { l: dims(p.figDiodeBodyMm)[0], d: dims(p.figDiodeBodyMm)[1] }, // 1/4 W axial, DO-41
    m25Head: { d: dims(p.figM25HeadMm)[0], h: dims(p.figM25HeadMm)[1] }, // ISO 7045 M2.5 pan head
    bundle: WIRE_OD * Math.sqrt(WIRES / p.figBundlePacking), // the peeled ribbon gathered round
    corrugation: p.figCorrugationPitchMm, // a drawn texture, not a measured pitch
    pixel: dims(p.figNeoPixelPackageMm), ampChip: dims(p.figAmpChipMm), smdCap: dims(p.figSmdCapMm),
    spkTab: dims(p.figSpeakerTabMm), talkLug: dims(p.figTalkLugMm), togLug: dims(p.figToggleLugMm),
    togCollar: p.figToggleCollarMm, togThread: p.figToggleThreadPastNutMm,
  };

  // ---- base numbers, as cad/_params.py ----------------------------------------------------------------------------
  const BW = p.baseWidthMm, BD = p.baseDepthMm, BH = p.baseHeightMm, BWALL = p.baseWallMm, BTOP = p.baseTopMm, BFLOOR = p.baseFloorMm;
  const B_TOP_IN = BH - BTOP;
  const CASE = { x: -BW / 2, y: -BD / 2, w: BW, d: BD, r: p.baseCornerRadiusMm };
  const INNER = k.insetPlan(CASE, BWALL);
  const Z_DESK = BFLOOR - (FOOT.heightMm - p.rubberFootPocketDepthMm) - BFLOOR; // the feet stand 2 mm proud
  const ARM = [p.armRootXMm, p.armRootYMm];
  const DISC_R = DISC.diameterMm / 2, DISC_T = DISC.thicknessMm, DISC_HOLE = DISC.holeMm / 2;
  const RIB_TOP = BFLOOR + p.ballastStandoffMm;
  const COLLAR_H = p.armCollarHeightMm, COLLAR_R = COUP.diameterMm / 2 + 0.3 + p.armCollarWallMm;
  const COUP_R = COUP.diameterMm / 2, COUP_H = COUP.heightMm;
  const COUP_B0 = BH + COLLAR_H - p.couplingSeatDepthMm;
  const NUT_AF = NUT.diameterMm, NUT_T = NUT.thicknessMm;
  const NUT_B0 = RIB_TOP - NUT_T;
  const PIPE_R = p.pipeThreadOdMm / 2;
  const NIPB0 = COUP_B0 + p.baseNippleEngagementMm - p.baseNippleLengthMm;
  const GROOVE_FLOOR = BFLOOR - p.harnessGrooveDepthMm;
  const BOSSES = p.baseBossXY.split(";").map((xy) => xy.split(",").map(Number));
  const CBORE_D = p.m3HeadHeightMm + 0.2, PAD_TOP = CBORE_D + p.shellFlangeMm;
  const FEET = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * (BW / 2 - p.feetInsetMm), sy * (BD / 2 - p.feetInsetMm)]));
  const SPK = [p.speakerCenterXMm, p.speakerCenterYMm], SPK_R = p.speakerDiameterMm / 2, SPK_Z0 = B_TOP_IN - p.speakerHeightMm;
  const TALK = [p.talkButtonCenterXMm, p.talkButtonCenterYMm], TALK_HOLE = p.talkButtonHoleMm / 2;
  const STICK = [p.ledStickCenterXMm, p.ledStickCenterYMm];
  const USB_X = p.usbcCenterXMm, USB_BOARD_Z = BFLOOR + p.usbPlatformMm, USB_Z = USB_BOARD_Z + p.usbConnectorAboveBoardMm;
  const USB_Y_BACK = -BD / 2 + BWALL, USB_Y_FRONT = USB_Y_BACK + USB_D;
  const JB = [p.junctionCenterXMm, p.junctionCenterYMm], JB_Z = p.junctionBoardZMm, JB_TOP = JB_Z + p.junctionBoardThicknessMm;
  // The quarter Perma-Proto lies with its 50.8 mm side along x, as cad/_fitcheck.py and its hole spacing have it.
  const JB_PLAN = { x: JB[0] - p.junctionBoardDepthMm / 2, y: JB[1] - p.junctionBoardWidthMm / 2, w: p.junctionBoardDepthMm, d: p.junctionBoardWidthMm, r: 0.6 };
  const JB_HOLES = [-1, 1].map((s) => [JB[0] + (s * p.junctionHoleSpacingMm) / 2, JB[1]]);
  const DIFF_Z = B_TOP_IN - p.diffuserFlangeMm;
  const STICK_Z = DIFF_Z - STK_H; // the stick lies in its frame, LEDs up against the diffuser flange
  const RING_IN = DISC_R + p.ballastClearanceMm, RING_OUT = RING_IN + p.ballastRingWallMm, RING_TOP = BFLOOR + p.ballastRingHeightMm;
  const GAP_W = p.harnessGrooveWidthMm + 2; // the disc ring's gap toward +y, as cad/base-bottom.py
  const GROOVE_END = ARM[1] + RING_OUT + 1;

  // ---- head numbers, as cad/_params.py ------------------------------------------------------------------------------
  const HL = p.headLengthMm, HD = p.headDepthMm, HH = p.headHeightMm, HWALL = p.headWallMm, HR = p.headCornerRadiusMm;
  const SPLIT = p.headSplitZMm, IX = HL / 2 - HWALL, IY = HD / 2 - HWALL, IZ0 = HWALL, IZ1 = HH - HWALL;
  const CAM_X1 = IX - p.cameraEndClearanceMm, CAM_X0 = CAM_X1 - p.cameraBoardOutlineMm, CAM_Y = p.cameraBoardWidthMm / 2;
  const LENS_X = CAM_X1 - p.cameraLensFromHoleEdgeMm, LENS_Y = 0;
  const CAM_HOLES = [0, 1].flatMap((i) => [-1, 1].map((s) => [CAM_X1 - p.cameraHoleEdgeMm - i * p.cameraHoleSpacingAcrossMm, LENS_Y + (s * p.cameraHoleSpacingAlongMm) / 2]));
  const SH_T = p.shutterThicknessMm, SH_CLEAR = p.shutterClearanceMm, SH_TOP = IZ0 + SH_T, LIP_Z0 = SH_TOP + 2 * SH_CLEAR;
  const LENS_TIP_Z = SH_TOP + SH_CLEAR + p.cameraLensGapMm;
  const CAM_FRONT_Z = LENS_TIP_Z + p.cameraLensProtrusionMm, CAM_BACK_Z = LENS_TIP_Z + p.cameraDepthMm;
  const WIN_R = p.cameraWindowMm / 2;
  const SH_LEN = 2 * (WIN_R + p.shutterOverlapMm), SH_W = p.shutterWidthMm, SH_TRAVEL = p.shutterTravelMm;
  const SH_X1 = LENS_X + SH_LEN / 2, SH_X0 = SH_X1 - SH_LEN;
  const TAIL_L = p.shutterTailLengthMm, TAIL_W = p.shutterTailWidthMm, TAIL_Y = p.shutterTailOffsetYMm;
  const NUB_L = p.shutterNubLengthMm, NUB_W = p.shutterNubWidthMm, NUB_X = SH_X0 - TAIL_L / 2;
  const RAIL_Y_IN = SH_W / 2 + SH_CLEAR, RAIL_Y_OUT = RAIL_Y_IN + p.shutterRailWidthMm;
  const RAIL_X0 = SH_X0 - SH_TRAVEL - 1, RAIL_X1 = IX - 0.01, LIP_X1 = SH_X0 - 0.5;
  const LIP_TOP = LIP_Z0 + p.shutterLipThicknessMm;
  const POST_W = p.cameraPostWidthMm, POST_Y_OUT = RAIL_Y_OUT + 2.4, LEDGE_T = p.cameraLedgeThicknessMm; // as head-lower.py
  const PI_L = p.piBoardLengthMm, PI_W = p.piBoardWidthMm;
  const PI_X0 = -IX + p.piSdClearanceMm, PI_X1 = PI_X0 + PI_L, PI_Y0 = -IY + p.piWallClearanceMm, PI_Y1 = PI_Y0 + PI_W;
  const PI_Z = IZ0 + p.piPostHeightMm, PI_TOP = PI_Z + EST.piBoard;
  const PI_HOLES = [0, 1].flatMap((i) => [0, 1].map((j) => [PI_X0 + p.piHoleInsetMm + i * p.piHoleSpacingXMm, PI_Y0 + p.piHoleInsetMm + j * p.piHoleSpacingYMm]));
  const PI_MID = [(PI_X0 + PI_X1) / 2, (PI_Y0 + PI_Y1) / 2];
  const BON_Z = PI_TOP + EST.piHeader, AMP_Z = BON_Z + BON_T + EST.foam;
  const NIP = [(PI_X1 + CAM_X0) / 2, p.headNippleYMm];
  const NUT_H0 = IZ1 - NUT_T; // the head nut sits flat under the top
  const HEAD_BOSSES = [[-(IX - 3.6), IY - 3.7], [PI_X1 + 0.7 + p.headScrewWellOuterMm / 2, -(IY - 3.5)], [IX - 3.6, IY - 3.7], [IX - 3.6, -(IY - 3.7)]];
  const WELL_R = p.headScrewWellOuterMm / 2, WELL_DEPTH = SPLIT - p.shellFlangeMm;
  const MIC_XS = [-1, 1].map((s) => p.micCenterXMm + (s * p.micSpacingMm) / 2), MIC_Z = p.micPortZMm;
  const LED_GREEN_X = LENS_X + p.cameraLedXOffsetMm, LED_RED_X = LED_GREEN_X - p.ledSpacingMm, LED_Z = p.ledZMm;
  const TOG_Z = IZ1 - 0.4 - p.toggleBodyHeightMm / 2, TOG_Y = 0;
  const M25_BOSS = p.m25InsertHoleMm + 2 * p.insertMinWallMm;
  const LIP_W = p.headLipWidthMm, LIP_H = p.headLipHeightMm;

  // ---- the pose: the head hangs from the arm -----------------------------------------------------------------------
  const tilt = rad(p.cameraTiltDeg), ct = Math.cos(tilt), st = Math.sin(tilt);
  const HX = [1, 0, 0], HY = [0, ct, st], HZ = [0, -st, ct];
  const LENS_AT = [ARM[0] + (LENS_X - NIP[0]), ARM[1] + p.headReachMm, Z_DESK + p.cameraHeightMm];
  const HO = [LENS_AT[0] - LENS_X, LENS_AT[1] - LENS_TIP_Z * HZ[1], LENS_AT[2] - LENS_TIP_Z * HZ[2]];
  const Hd = ([x, y, z]) => [x, y * ct - z * st, y * st + z * ct];
  const H = (q) => G.add3(HO, Hd(q));

  // The gooseneck, as rules.ts lays it out: it leaves the base coupling pointing straight up and enters the head
  // coupling along the head's z axis. Its rigid threaded ends reach engBase and engHead into the couplings; the rest
  // of its armLengthMm is a straight rise, one bend and a short straight into the head, solved for that length.
  const ENG_B = COUP_H - p.baseNippleEngagementMm, ENG_H = COUP_H - (p.headNippleLengthMm - HWALL - NUT_T);
  const OUT_B = Math.max(0, p.armEndRigidMm - ENG_B), OUT_H = Math.max(0, p.armEndRigidMm - ENG_H);
  const ARM_R = p.armOuterDiameterMm / 2;
  const S0 = [ARM[0], ARM[1], COUP_B0 + COUP_H]; // the base coupling's top
  const E0 = H([NIP[0], NIP[1], HH + COUP_H]); // the head coupling's top
  const S1 = G.add3(S0, [0, 0, OUT_B]), E1 = G.add3(E0, G.mul3(HZ, OUT_H));
  const route = (() => {
    const flex = p.armLengthMm - ENG_B - ENG_H - OUT_B - OUT_H;
    const dE = [-HZ[1], -HZ[2]]; // heading into the head coupling, in (y, z)
    const turn = Math.PI / 2 - Math.atan2(dE[1], dE[0]); // clockwise, from straight up
    const arcY = 1 - Math.sin(Math.PI / 2 - turn), arcZ = Math.cos(Math.PI / 2 - turn); // per unit radius
    const dy = E1[1] - S1[1], dz = E1[2] - S1[2];
    // a * (0, 1) + R * (arcY, arcZ) + b * dE = (dy, dz), a + R * turn + b = flex
    const M = [[0, arcY, dE[0]], [1, arcZ, dE[1]], [1, turn, 1]], rhs = [dy, dz, flex];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const [a, R, b] = [0, 1, 2].map((c) => det(M.map((row, r) => row.map((v, j) => (j === c ? rhs[r] : v)))) / det(M));
    if (!(a > 0 && b >= 0 && R >= p.armMinBendRadiusMm))
      throw new Error(`figure.mjs: no rise-bend-straight gooseneck of ${p.armLengthMm} mm reaches the head (rise ${a.toFixed(1)}, bend ${R.toFixed(1)}, straight ${b.toFixed(1)})`);
    const pts = [];
    const at2 = (y, z) => [ARM[0], y, z];
    for (let s = 0; s < a; s += 2) pts.push(at2(S1[1], S1[2] + s));
    const c = [S1[1] + R, S1[2] + a];
    const steps = Math.ceil((R * turn) / 1.5);
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI - (turn * i) / steps;
      pts.push(at2(c[0] + R * Math.cos(ang), c[1] + R * Math.sin(ang)));
    }
    const end = pts[pts.length - 1];
    for (let s = 2; s < b; s += 2) pts.push(at2(end[1] + dE[0] * s, end[2] + dE[1] * s));
    pts.push(E1);
    return { pts, a, R, b, top: c[1] + R };
  })();

  // ---- apart: what each shell holds drops out of its open bottom -----------------------------------------------------
  const down = (dz) => [0, 0, -dz];
  const hDown = (d, side = [0, 0]) => Hd([side[0], side[1], -d]); // along the head's -z, and across it
  // The base: what the top carries drops as one, so its wiring holds; the discs and their nut, which only hang on the
  // harness tail, drop further, clear of the junction board above them; the plate drops furthest, with the USB-C
  // board glued in its cradle. The diffuser is glued into its slot and stays there. The head drops less than its
  // height above the base, layer by layer. What the upper shell carries drops straight down, so the harness still
  // leaves the head nipple; the layers under it also step out along -x (to the right on the card) as they go, so
  // the lower shell clears the base top instead of landing on its grille.
  const GUTS = 100; // everything the base top carries, together, so its wiring holds
  const DISCS = GUTS + 34;
  const PLATE = GUTS + 70;
  const HEAD_LOW = 74; // the head lower shell
  const WIRED = 30; // the bonnet and what is wired to it, from the head upper
  const OUT = 0.7; // how far the lower layers step out along -x for each mm they drop
  const hOut = (d) => hDown(d, [-OUT * (d - WIRED), 0]);
  const LIFT = {
    guts: down(GUTS), discs: down(DISCS), baseNut: down(DISCS + 12), plate: down(PLATE), usbc: down(PLATE), feet: down(PLATE + 9),
    baseScrews: down(PLATE + 20), baseInserts: down(17), lower: hOut(HEAD_LOW), shutter: hOut(HEAD_LOW - 12),
    board: hOut(HEAD_LOW - 24), ins25: hOut(HEAD_LOW - 7), scr25: hOut(HEAD_LOW - 38), headScrews: hOut(HEAD_LOW + 18),
    wired: hDown(WIRED, [0, -6]), headNut: hDown(20), headInserts: hDown(10),
  };
  LIFT.sd = G.add3(LIFT.board, [-(SD_L + 2), 0, 0]); // the card slides out of its slot

  // ---- camera ------------------------------------------------------------------------------------------------------
  const headBox = (lift = [0, 0, 0], z0 = 0, z1 = HH) => [-HL / 2, HL / 2].flatMap((x) => [-HD / 2, HD / 2].flatMap((y) => [z0, z1].map((z) => G.add3(H([x, y, z]), lift))));
  fig.size(640, 620);
  const P = fig.camera([
    ...k.boxCorners(CASE, Z_DESK, BH + TALK_ABOVE),
    ...k.boxCorners(CASE, -PLATE - 24, BH),
    ...headBox(), ...headBox([0, 0, 0], HH, HH + COUP_H),
    ...headBox(LIFT.headScrews, 8, SPLIT), ...headBox(LIFT.sd, PI_Z, PI_Z + 4),
    ...route.pts.filter((_, i) => i % 10 === 0).flatMap((q) => [G.add3(q, [0, 0, ARM_R + 1]), G.add3(q, [0, -ARM_R - 1, 0]), G.add3(q, [0, ARM_R + 1, 0])]),
  ], { azimuth: 38, elevation: 30, pad: 26 });
  const px = 1 / P.scale;

  // ---- drawing helpers (generic) -------------------------------------------------------------------------------------
  const V = G.viewOf(P), LIGHT = G.lightOf(P);
  const { sinA, cosA } = k.cameraOf(P);
  const at = (q) => k.iso(q, P);
  const path = (points, closed = true) => k.pathOf(points, closed);
  /** Paint a solid; a faceted one's blend goes over its tones, under its creases and edges. */
  const S = (paths, style) => {
    const svg = k.solidSvg(paths, style);
    return paths.blend ? svg.replace(/(<path class="iso-top" d="[^"]*"\/>)/, (top) => top + paths.blend) : svg;
  };
  const L = (d, style) => k.lineSvg(d, style);
  const depth = (q) => G.dot3(q, V);
  const byDepth = (list, of = (item) => item) => [...list].sort((a, b) => depth(of(a)) - depth(of(b)));
  const facing = (n) => G.dot3(n, V) > 1e-6;
  /** The kit's shade (0-3) for an upright face with plan normal n, the same rule as k.extrude. */
  const shadeOf = ([nx, ny]) => {
    const length = Math.hypot(nx, ny) || 1;
    return Math.min(3, Math.max(0, Math.floor((((ny * -sinA + nx * cosA) / length + 1) / 2) * 4))); // in the kit's swapped frame
  };
  /** The lathe's band (0-4, 4 = a top) for a face with any normal, the rule G.solidOf shades by. */
  const bandOf = (n) => G.bandOf(G.dot3(G.unit3(n), LIGHT));
  const toneOf = (n) => {
    const band = bandOf(n);
    return band >= 4 ? `class="iso-top"` : `class="iso-shade" data-shade="${band}"`;
  };
  // The middle of each of the lathe's five tones on the light's dot product (its band edges are 0, .2, .42 and .62).
  const MIDDLES = [-0.1, 0.1, 0.31, 0.52, 0.72];
  /** A face's tone as a number from 0 to 4, between the middles of the two bands it falls between. */
  const toneValue = (n) => {
    const s = G.dot3(G.unit3(n), LIGHT);
    if (s <= MIDDLES[0]) return 0;
    for (let i = 1; i < MIDDLES.length; i++) if (s < MIDDLES[i]) return i - 1 + (s - MIDDLES[i - 1]) / (MIDDLES[i] - MIDDLES[i - 1]);
    return 4;
  };
  const toneClass = (band) => (band >= 4 ? `class="iso-top"` : `class="iso-shade" data-shade="${band}"`);
  const area2 = (points) => points.reduce((sum, [x, y], i) => sum + x * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * y, 0);
  const oriented = (points) => (area2(points) < 0 ? [...points].reverse() : points);
  const newell = (pts) => pts.reduce((n, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }, [0, 0, 0]);
  /** Any convex solid from its faces ({ pts: world points, n: outward normal }): tones by the kit's light, the hull
   * as fill and outline, creases where two visible faces meet at an angle. Same paths as k.slabOf, plus `blend`:
   * a face whose light falls between two tones takes the lower one and a quarter, half or three quarters of the next
   * laid over it, so a rounded corner or fillet goes from one tone to the next without a staircase of bands. */
  function faceted(faces, sharp = 0.45) {
    const buckets = [[], [], [], [], []];
    const over = [1, 2, 3, 4].map(() => [[], [], []]); // over[band - 1][quarter - 1]
    const flat = [];
    const seen = faces.map((face) => facing(face.n));
    faces.forEach((face, i) => {
      const screen = face.pts.map(at);
      flat.push(...screen);
      if (!seen[i]) return;
      const q = Math.round(toneValue(face.n) * 4) / 4, band = Math.floor(q + 1e-9), part = Math.round((q - band) * 4);
      buckets[band].push(path(screen));
      if (part) over[band][part - 1].push(path(screen));
    });
    const blend = over.flatMap((quarters, b) => quarters.map((list, j) => (list.length ? `<path ${toneClass(b + 1)} fill-opacity="${(j + 1) / 4}" d="${list.join("")}"/>` : ""))).join("");
    const key = (q) => q.map((v) => v.toFixed(3)).join(",");
    const edges = new Map();
    faces.forEach((face, i) => {
      if (!seen[i]) return;
      face.pts.forEach((a, j) => {
        const b = face.pts[(j + 1) % face.pts.length];
        const id = [key(a), key(b)].sort().join("|");
        if (edges.has(id)) edges.get(id).faces.push(i);
        else edges.set(id, { a, b, faces: [i] });
      });
    });
    const crease = [];
    for (const { a, b, faces: pair } of edges.values())
      if (pair.length === 2 && G.dot3(G.unit3(faces[pair[0]].n), G.unit3(faces[pair[1]].n)) < Math.cos(sharp)) crease.push(path([at(a), at(b)], false));
    const hull = path(G.hullOf(flat));
    return { fill: hull, outline: hull, crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((list) => list.join("")), blend };
  }
  /** The faces of a body between rings of world points (each counter-clockwise round the body's axis, first to last). */
  function loftFaces(rings, caps = [true, true]) {
    const faces = [];
    for (let r = 0; r + 1 < rings.length; r++) {
      const A = rings[r], B = rings[r + 1];
      A.forEach((a, i) => {
        const j = (i + 1) % A.length;
        const n = G.cross3(G.sub3(A[j], a), G.sub3(B[i], a));
        if (G.len3(n) > 1e-9) faces.push({ pts: [a, A[j], B[j], B[i]], n });
      });
    }
    if (caps[1]) faces.push({ pts: rings[rings.length - 1], n: newell(rings[rings.length - 1]) });
    if (caps[0]) faces.push({ pts: [...rings[0]].reverse(), n: newell([...rings[0]].reverse()) });
    return faces;
  }
  const loft = (rings, caps) => faceted(loftFaces(rings, caps));
  const planRing = (plan, steps = 4) => k.roundedPlan({ ...plan, r: Math.max(0.05, plan.r) }, steps);
  const box = (cx, cy, w, d, r = 0) => ({ x: cx - w / 2, y: cy - d / 2, w, d, r });
  const span = (x0, x1, y0, y1, r = 0) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), d: Math.abs(y1 - y0), r });
  const rotated = (cx, cy, w, d, angle) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([u, v]) => [cx + u * Math.cos(angle) - v * Math.sin(angle), cy + u * Math.sin(angle) + v * Math.cos(angle)]);
  const circle = (cx, cy, r, steps = 28) => k.circleRing(cx, cy, r, steps);
  const stadium = (cx, cy, length, width, steps = 10) => {
    const r = width / 2, half = (length - width) / 2, out = [];
    for (let i = 0; i <= steps; i++) out.push([cx + half + r * Math.cos(-Math.PI / 2 + (Math.PI * i) / steps), cy + r * Math.sin(-Math.PI / 2 + (Math.PI * i) / steps)]);
    for (let i = 0; i <= steps; i++) out.push([cx - half + r * Math.cos(Math.PI / 2 + (Math.PI * i) / steps), cy + r * Math.sin(Math.PI / 2 + (Math.PI * i) / steps)]);
    return out;
  };
  const hex = (cx, cy, af, phase = 0) => Array.from({ length: 6 }, (_, i) => [cx + (af / Math.sqrt(3)) * Math.cos(phase + (i * Math.PI) / 3), cy + (af / Math.sqrt(3)) * Math.sin(phase + (i * Math.PI) / 3)]);
  const voidOf = (d, shade = 0) => `<path class="iso-shade" data-shade="${shade}" d="${d}"/>`;
  const bore = (x, y, r, z, tone = "lo") => voidOf(k.ring(x, y, r, z, P, 20)) + L(k.ring(x, y, r, z, P, 20), { tone });
  const upright = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  /** The parts other parts hide, by BOM line and by the step that places them: fig.xray draws their outline (dashed)
   * and a faint fill of their body. hide() collects a solid while a part is drawn; part() places the part and files
   * what it collected under its step, so each step's x-ray shows only that step's pieces. */
  const xray = {};
  const pending = {};
  const hide = (line, ...solids) => { (pending[line] ??= []).push(...solids); return solids[0]; };
  const take = (line) => { const out = pending[line] ?? []; pending[line] = []; return out; };
  function part(line, svg, options = {}, hidden = take(line)) {
    fig.part(line, svg, options);
    ((xray[line] ??= {})[options.step ?? 1] ??= []).push(...hidden);
  }
  const xrayOf = (solids) => `<path class="a2-ghost" d="${solids.map((solid) => solid.fill).join("")}"/>`
    + L(solids.map((solid) => solid.outline).join(""), { tone: "lit", dashed: true });
  let clips = 0;
  /** Draw `content` only inside the union of `regions` ({ d, withLine, until, evenodd }), screen paths. A region with
   * `until` counts only in the steps before that line is placed: the whole card, while a shell is still off. */
  function clippedTo(regions, content) {
    const id = `a2-${bom.slug}-clip-${clips++}`;
    const paths = regions.map(({ d, withLine, until, evenodd }) => `<path${withLine ? ` data-a2-with="${withLine}"` : ""}${until ? ` data-a2-until="${until}"` : ""}${evenodd ? ' clip-rule="evenodd"' : ""} d="${d}"/>`);
    return `<clipPath id="${id}">${paths.join("")}</clipPath><g clip-path="url(#${id})">${content}</g>`;
  }
  const clipped = (d, content, { withLine, evenodd = false } = {}) => clippedTo([{ d, withLine, evenodd }], content);
  const EVERYWHERE = "M-4000 -4000H8000V8000H-4000Z";
  /** The screen region swept by a world outline moved along `dir` (a part seen through an opening, a pipe's bore). */
  const sweep = (points, dir, length = 400) => path(G.hullOf([...points.map(at), ...points.map((q) => at(G.add3(q, G.mul3(dir, length))))]));
  /** A wire: a thin line along a rounded 3D route with a solder joint (a terminal dot) at each end. */
  const wire = (points, { radius = 4, tone = "lo", ends = "both" } = {}) => {
    const flat = G.fillet(points, radius, 7).map(at);
    return k.wireSvg(flat[0], flat[flat.length - 1], { via: flat.slice(1, -1), tone, ends, size: 0.9 });
  };
  /** Loose wires dressed together into a round bundle along a rounded 3D route (world points). */
  function bundleOf(points, r, { radius = 4, tone = "mid", line = "harness", xrayFrom = 0, xray: through = true } = {}) {
    const pieces = T.tubePieces(G.fillet(points, radius, 8), r, P, { spacing: 2.2 * px, maxLength: 14 * px });
    // The x-ray takes the sides only: an end cap seen through a shell reads as a stray target, not a cable.
    const seen = T.tubePieces(G.fillet(points.slice(xrayFrom), radius, 8), r, P, { spacing: 2.2 * px, maxLength: 14 * px, caps: false });
    if (through) hide(line, ...seen.map((piece) => ({ fill: piece.body, outline: piece.edges })));
    return byDepth(pieces, (piece) => piece.mid).map((piece) => T.tubeSvg(piece, { tone })).join("");
  }
  /** A flat ribbon of `n` wires side by side (the joined end of the harness) along a rounded route; `up` is the way
   * its flat face turns. Returns the drawing and, per conductor, where it starts and ends. */
  function ribbonOf(points, n, up, { radius = 3, tone = "mid", line = "harness" } = {}) {
    const centre = G.resample(G.fillet(points, radius, 8), 0.7);
    const width = n * WIRE_OD;
    let last = null;
    const frames = centre.map((c, i) => {
      const t = G.unit3(G.sub3(centre[Math.min(centre.length - 1, i + 1)], centre[Math.max(0, i - 1)]));
      let nrm = G.sub3(up, G.mul3(t, G.dot3(up, t)));
      nrm = G.len3(nrm) < 1e-3 ? last : G.unit3(nrm);
      last = nrm;
      return { c, nrm, side: G.unit3(G.cross3(t, nrm)) };
    });
    const at3 = (f, u) => G.add3(f.c, G.mul3(f.side, u * width));
    const quads = [];
    for (let i = 0; i + 1 < frames.length; i++) {
      const [a, b] = [frames[i], frames[i + 1]];
      const pts = [at3(a, -0.5), at3(b, -0.5), at3(b, 0.5), at3(a, 0.5)];
      quads.push({ d: path(oriented(pts.map(at))), n: facing(a.nrm) ? a.nrm : G.mul3(a.nrm, -1) });
    }
    const fill = quads.map((q) => q.d).join("");
    const tones = quads.map((q) => `<path ${toneOf(q.n)} d="${q.d}"/>`).join("");
    const along = (u) => path(frames.map((f) => at(at3(f, u))), false);
    const outline = along(-0.5) + along(0.5) + [0, frames.length - 1].map((i) => path([at(at3(frames[i], -0.5)), at(at3(frames[i], 0.5))], false)).join("");
    const dividers = Array.from({ length: n - 1 }, (_, j) => along((j + 1) / n - 0.5)).join("");
    hide(line, { fill, outline });
    const conductor = (f, j) => at3(f, (j + 0.5) / n - 0.5);
    return {
      svg: `<g class="iso-solid"><path class="iso-fill" d="${fill}"/>${tones}${L(dividers, { tone: "faint" })}${L(outline, { tone, className: "iso-edge" })}</g>`,
      starts: Array.from({ length: n }, (_, j) => conductor(frames[0], j)),
      ends: Array.from({ length: n }, (_, j) => conductor(frames[frames.length - 1], j)),
      endDir: G.unit3(G.sub3(frames[frames.length - 1].c, frames[frames.length - 2].c)),
    };
  }
  /** Short wires from the end of a bundle or ribbon to their solder points, each with a gentle bend. */
  const fanOf = (pairs, { lift = 1.5, tone = "lo" } = {}) => pairs.map(([a, b, bend = [0, 0, lift]]) => wire([a, G.add3(G.lerp3(a, b, 0.5), bend), b], { radius: 3, tone, ends: "to" })).join("");

  // Head-frame versions: points, rings, boxes and turned parts on the head's axes.
  const hAt = (q) => at(H(q));
  const hPath = (pts, closed = true) => path(pts.map(hAt), closed);
  const hRing = (plan, z, steps = 4) => planRing(plan, steps).map(([x, y]) => H([x, y, z]));
  const hLoft = (rings, caps) => loft(rings.map(([plan, z, steps]) => hRing(plan, z, steps)), caps);
  const hPrism = (ring2, z0, z1) => loft([ring2.map(([x, y]) => H([x, y, z0])), ring2.map(([x, y]) => H([x, y, z1]))]);
  const hBox = (x0, x1, y0, y1, z0, z1) => {
    const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
    return hPrism([[a, c], [b, c], [b, d], [a, d]], Math.min(z0, z1), Math.max(z0, z1));
  };
  const FZ = (x, y) => G.frameOf(H([x, y, 0]), HZ, HX, HY); // s = head z
  const FY = (x, z) => G.frameOf(H([x, 0, z]), HY, HX, HZ); // s = head y
  const FX = (y, z) => G.frameOf(H([0, y, z]), HX, HY, HZ); // s = head x
  const hCircle = (x, y, r, z, steps = 28) => circle(x, y, r, steps).map(([a, b]) => [a, b, z]);
  const hVoid = (pts, shade = 0) => voidOf(hPath(pts), shade);

  /** A low wall along a run of plan points (outer[i] and inner[i] pair up across it): its top, the faces you see,
   * and its edges, split into the run where its outer face is hidden (`far`, paint it early) and where it shows
   * (`near`, paint it late). `caps` says which ends of an open run are real ends. */
  function wallOf(outer, inner, z0, z1, { closed = false, caps = [true, true], tone = "lo" } = {}) {
    const n = outer.length, segs = closed ? n : n - 1;
    const runs = { far: [], near: [] };
    const quad = (a, b, za, zb) => [at([a[0], a[1], za]), at([b[0], b[1], za]), at([b[0], b[1], zb]), at([a[0], a[1], zb])];
    const segsOf = Array.from({ length: segs }, (_, i) => {
      const j = (i + 1) % n;
      const om = [(outer[i][0] + outer[j][0]) / 2, (outer[i][1] + outer[j][1]) / 2], im = [(inner[i][0] + inner[j][0]) / 2, (inner[i][1] + inner[j][1]) / 2];
      let nrm = [-(outer[j][1] - outer[i][1]), outer[j][0] - outer[i][0]];
      if (nrm[0] * (om[0] - im[0]) + nrm[1] * (om[1] - im[1]) < 0) nrm = [-nrm[0], -nrm[1]];
      return { i, j, nrm, out: facing([...nrm, 0]), inn: facing([-nrm[0], -nrm[1], 0]) };
    });
    for (const s of segsOf) runs[s.out ? "near" : "far"].push(s);
    const draw = (list) => {
      if (!list.length) return "";
      const fills = [], shades = [[], [], [], []], tops = [], edges = [], creases = [];
      const has = new Set(list.map((s) => s.i));
      for (const s of list) {
        const { i, j, nrm } = s;
        const top = oriented([outer[i], outer[j], inner[j], inner[i]].map(([x, y]) => at([x, y, z1])));
        fills.push(path(top));
        tops.push(path(top));
        const oTop = path([at([...outer[i], z1]), at([...outer[j], z1])], false), iTop = path([at([...inner[i], z1]), at([...inner[j], z1])], false);
        if (s.out) {
          const f = oriented(quad(outer[i], outer[j], z0, z1));
          fills.push(path(f));
          shades[shadeOf(nrm)].push(path(f));
          creases.push(oTop);
          edges.push(path([at([...outer[i], z0]), at([...outer[j], z0])], false));
        } else edges.push(oTop);
        if (s.inn) {
          const f = oriented(quad(inner[i], inner[j], z0, z1));
          fills.push(path(f));
          shades[shadeOf([-nrm[0], -nrm[1]])].push(path(f));
          creases.push(iTop);
          edges.push(path([at([...inner[i], z0]), at([...inner[j], z0])], false));
        } else edges.push(iTop);
        // Vertical edges where a face you see turns away, or at an end of this part of the run.
        const prev = segsOf.find((t) => t.j === i), next = segsOf.find((t) => t.i === j);
        const edgeAt = (pt) => edges.push(path([at([...pt, z0]), at([...pt, z1])], false));
        if (s.out && (!prev || !has.has(prev.i) || !prev.out)) edgeAt(outer[i]);
        if (s.out && (!next || !has.has(next.i) || !next.out)) edgeAt(outer[j]);
        if (s.inn && (!prev || !prev.inn)) edgeAt(inner[i]);
        if (s.inn && (!next || !next.inn)) edgeAt(inner[j]);
        // The cut faces at the real ends of an open run.
        [[!closed && caps[0] && i === 0, i, -1], [!closed && caps[1] && j === n - 1, j, 1]].forEach(([real, e, sign]) => {
          if (!real) return;
          const t = sign > 0 ? [outer[e][0] - outer[e - 1][0], outer[e][1] - outer[e - 1][1]] : [outer[0][0] - outer[1][0], outer[0][1] - outer[1][1]];
          if (!facing([...t, 0])) return;
          const f = oriented(quad(outer[e], inner[e], z0, z1));
          fills.push(path(f));
          shades[shadeOf(t)].push(path(f));
          edges.push(path([at([...outer[e], z0]), at([...inner[e], z0])], false), path([at([...outer[e], z1]), at([...inner[e], z1])], false));
          edgeAt(outer[e]);
          edgeAt(inner[e]);
        });
      }
      const tone3 = shades.map((list2, shade) => (list2.length ? `<path class="iso-shade" data-shade="${shade}" d="${list2.join("")}"/>` : "")).join("");
      return `<g class="iso-solid"><path class="iso-fill" d="${fills.join("")}"/>${tone3}<path class="iso-top" d="${tops.join("")}"/>`
        + `${L(creases.join(""), { tone: "faint", className: "iso-crease" })}${L(edges.join(""), { tone, className: "iso-edge" })}</g>`;
    };
    return { far: draw(runs.far), near: draw(runs.near) };
  }

  // The base's shadow goes with the plate, which stands on the desk: the plate's own footprint, so taken apart it
  // stays the plate's size under the plate instead of a base-sized smudge.
  fig.under(`<path class="iso-halo" data-a2-with="basebot" d="${k.haloOf(CASE, Z_DESK, BFLOOR - Z_DESK, P)}"/>`);

  const STEP = { prints: 1, inserts: 2, headParts: 3, arm: 4, harness: 5, shutter: 6, camera: 7, pi: 8, baseParts: 9, discs: 10, junction: 11, usbc: 12, bonnet: 13, closeHead: 14, closeBase: 15 };

  // ===================================================================================================================
  // THE BASE
  // ===================================================================================================================

  // ---- 1 feet and screws, under the plate ---------------------------------------------------------------------------
  const footR = FOOT.diameterMm / 2, footTop = p.rubberFootPocketDepthMm;
  const footProfile = [[0, footR], [FOOT.heightMm * 0.45, footR * 0.97, 1], [FOOT.heightMm * 0.8, footR * 0.82, 1], [FOOT.heightMm, footR * 0.5]];
  const footOf = ([x, y]) => S(hide("feet", G.solidOf(footProfile, G.frameAlong([x, y, footTop], [0, 0, -1]), P)), { tone: "lo" });
  const m3R = SCR3.thread === "M3" ? 1.5 : 1.5;
  /** A pan-head machine screw on frame F (s along the shank, from under the head), drawn as solids. */
  function screwOf(F, { headD, headH, length, r, line, tone = "mid" }) {
    const head = G.solidOf([[-headH, headD * 0.38], [-headH + headH * 0.2, headD * 0.47, 1], [-headH * 0.45, headD / 2, 1], [0, headD / 2]], F, P);
    const shank = G.solidOf([[0, r], [length - r * 0.4, r], [length, r * 0.65]], F, P);
    hide(line, head, shank);
    const threads = [];
    for (let s = 1; s < length - 0.6; s += 0.5) threads.push(G.arcOf(F, s, r, P));
    return S(head, { tone }) + S(shank, { tone, inner: L(threads.join(""), { tone: "faint" }) });
  }
  const baseScrew = ([x, y]) => screwOf(G.frameOf([x, y, CBORE_D], [0, 0, 1], [1, 0, 0], [0, 1, 0]), { headD: p.m3HeadDiameterMm, headH: p.m3HeadHeightMm, length: SCR3.lengthMm, r: m3R, line: "scr3" });
  for (const item of byDepth([...FEET.map((q) => ({ q, foot: true })), ...BOSSES.map((q) => ({ q }))], (item) => [...item.q, 0])) {
    if (item.foot) part("feet", footOf(item.q), { step: STEP.closeBase, lift: LIFT.feet });
    else part("scr3", baseScrew(item.q), { step: STEP.closeBase, lift: LIFT.baseScrews });
  }

  // ---- 2 the bottom plate: ribs and ring for the discs, the harness groove, the USB-C cradle, the lip -----------------
  function plate() {
    const f = p.baseBottomFilletMm;
    const rings = [[k.insetPlan(CASE, f), 0], ...ARC(4).map((deg) => [k.insetPlan(CASE, f * (1 - Math.sin(rad(deg)))), f - f * Math.cos(rad(deg))]), [CASE, f], [CASE, BFLOOR]];
    const body = hide("basebot", loft(rings.map(([plan, z]) => planRing(plan, 16).map(([x, y]) => [x, y, z]))));
    const parts = [S(body, { tone: "lo" })];
    // The groove and the relief under the nipple, cut 1.5 mm into the floor: a floor and the far walls.
    const gw = p.harnessGrooveWidthMm / 2, rr = p.nippleReliefMm / 2, meet = Math.asin(Math.sqrt(rr * rr - gw * gw) / rr);
    const recess = [[ARM[0] + gw, GROOVE_END]];
    for (let i = 0; i <= 24; i++) {
      const ang = meet - ((Math.PI + 2 * meet) * i) / 24;
      recess.push([ARM[0] + rr * Math.cos(ang), ARM[1] + rr * Math.sin(ang)]);
    }
    recess.push([ARM[0] - gw, GROOVE_END]);
    const mouth = oriented(recess.map((q) => at([...q, BFLOOR])));
    const inside = [voidOf(path(recess.map((q) => at([...q, GROOVE_FLOOR]))), 1)];
    recess.forEach((a, i) => {
      const b = recess[(i + 1) % recess.length];
      const nIn = [-(b[1] - a[1]), b[0] - a[0]]; // the recess runs clockwise, so this points into it
      const into = area2(recess) > 0 ? nIn : [-nIn[0], -nIn[1]];
      if (!facing([...into, 0])) return;
      inside.push(`<path class="iso-shade" data-shade="${Math.max(0, shadeOf(into) - 1)}" d="${path([at([...a, BFLOOR]), at([...b, BFLOOR]), at([...b, GROOVE_FLOOR]), at([...a, GROOVE_FLOOR])])}"/>`);
    });
    parts.push(clipped(path(mouth), inside.join("")) + L(path(mouth), { tone: "lo" }));
    // The locating lip, broken where the USB-C board sits against the back wall.
    const lipOut = planRing(k.insetPlan(INNER, p.plateClearanceMm), 8), lipIn = planRing(k.insetPlan(INNER, p.plateClearanceMm + p.plateLipWidthMm), 8);
    const cutW = USB_W + 2 * (p.usbCradleWallMm + 0.3);
    const runOf = (list, y) => [[USB_X + cutW / 2, y], ...list, [USB_X - cutW / 2, y]];
    const lip = wallOf(runOf(lipOut, lipOut[0][1]), runOf(lipIn, lipIn[0][1]), BFLOOR, BFLOOR + p.plateLipHeightMm);
    // The disc ring, open toward +y where the harness leaves.
    const gapAng = Math.asin(GAP_W / 2 / RING_OUT);
    const arc = (r) => Array.from({ length: 61 }, (_, i) => {
      const ang = Math.PI / 2 + gapAng + ((2 * Math.PI - 2 * gapAng) * i) / 60;
      return [ARM[0] + r * Math.cos(ang), ARM[1] + r * Math.sin(ang)];
    });
    const ring = wallOf(arc(RING_OUT), arc(RING_IN), BFLOOR, RING_TOP);
    // Ribs the discs rest on, the pads under the screw holes, the USB-C cradle.
    const ribs = Array.from({ length: p.ballastRibCount }, (_, i) => {
      const ang = rad(45 + (i * 360) / p.ballastRibCount), r0 = p.ballastRibInnerRadiusMm, r1 = DISC_R - 2;
      const mid = (r0 + r1) / 2;
      const ringPts = rotated(ARM[0] + mid * Math.cos(ang), ARM[1] + mid * Math.sin(ang), r1 - r0, p.ballastRibWidthMm, ang);
      return { at: [ARM[0] + mid * Math.cos(ang), ARM[1] + mid * Math.sin(ang), RIB_TOP], svg: S(k.extrude(ringPts, BFLOOR, RIB_TOP - BFLOOR, P), { tone: "lo" }) };
    });
    const pads = BOSSES.map(([x, y]) => ({ at: [x, y, PAD_TOP], svg: S(k.cylinder(x, y, p.basePadDiameterMm / 2, BFLOOR, PAD_TOP - BFLOOR, P, 24), { tone: "lo" }) + bore(x, y, p.m3ClearanceHoleMm / 2, PAD_TOP) }));
    const cw = p.usbCradleWallMm, bw = USB_W + 0.4, cy0 = USB_Y_BACK + p.plateClearanceMm, cy1 = cy0 + USB_D + 0.3, wallTop = USB_BOARD_Z + p.usbCradleHeightMm;
    const cradle = S(k.slabOf(span(USB_X - bw / 2, USB_X + bw / 2, cy0, cy1), BFLOOR, USB_BOARD_Z - BFLOOR, P, 1), { tone: "lo" })
      + S(k.slabOf(span(USB_X - bw / 2 - cw, USB_X - bw / 2, cy0, cy1 + cw), BFLOOR, wallTop - BFLOOR, P, 1), { tone: "lo" })
      + S(k.slabOf(span(USB_X - bw / 2 - cw, USB_X + bw / 2 + cw, cy1, cy1 + cw), BFLOOR, wallTop - BFLOOR, P, 1), { tone: "lo" })
      + S(k.slabOf(span(USB_X + bw / 2, USB_X + bw / 2 + cw, cy0, cy1 + cw), BFLOOR, wallTop - BFLOOR, P, 1), { tone: "lo" });
    parts.push(lip.far, cradle, ring.far);
    for (const item of byDepth([...ribs, ...pads], (item) => item.at)) parts.push(item.svg);
    parts.push(ring.near, lip.near);
    return parts.join("");
  }
  part("basebot", plate(), { step: STEP.prints, lift: LIFT.plate });

  // ---- 3 the USB-C breakout, in its cradle with its socket in the back wall's opening --------------------------------
  function usbc() {
    const plan = span(USB_X - USB_W / 2, USB_X + USB_W / 2, USB_Y_BACK + p.plateClearanceMm, USB_Y_FRONT + p.plateClearanceMm, 0.5);
    const board = hide("usbc", k.slabOf(plan, USB_BOARD_Z, EST.board, P, 2));
    const z1 = USB_BOARD_Z + EST.board;
    const marks = [0, 1, 2, 3, 4, 5].map((i) => L(k.ring(USB_X - 6.35 + i * EST.pitch, plan.y + plan.d - 1.6, 0.55, z1, P, 12), { tone: "lo" }) + bore(USB_X - 6.35 + i * EST.pitch, plan.y + plan.d - 1.6, 0.3, z1, "faint"));
    for (const s of [-1, 1]) marks.push(bore(USB_X + s * (USB_W / 2 - 2.2), plan.y + plan.d - 2.4, 1.1, z1));
    const rec = EST.usbRec;
    const shell = hide("usbc", k.slabOf(span(USB_X - rec.w / 2, USB_X + rec.w / 2, plan.y, plan.y + rec.d, 1.2), USB_Z - rec.h / 2, rec.h, P, 3, 0.4 * px));
    return S(board, { tone: "mid", inner: marks.join("") }) + S(shell, { tone: "hi", inner: L(k.lineOnTop([USB_X - rec.w / 2 + 0.8, plan.y + 2], [USB_X + rec.w / 2 - 0.8, plan.y + 2], USB_Z + rec.h / 2, P), { tone: "faint" }) });
  }
  part("usbc", usbc(), { step: STEP.usbc, lift: LIFT.usbc });
  // The base nut, under the discs on the nipple. Apart, it drops below them on the arm axis, under the harness tail.
  part("nut", hexNut(ARM[0], ARM[1], NUT_B0, NUT_T, { line: "nut" }), { step: STEP.discs, lift: LIFT.baseNut });

  // ---- 4 what the top shell carries, far to near: speaker, harness tail, nut and discs, junction board, light bar ----
  const SPK_TABS = [-1, 1].map((s) => [SPK[0] + (SPK_R - 2.5) * Math.cos(rad(18 * s)), SPK[1] + (SPK_R - 2.5) * Math.sin(rad(18 * s)), SPK_Z0 + p.speakerHeightMm - 3.2]); // under the rim
  // The speaker, cone up under the grille.
  function speaker() {
    const F = upright(SPK[0], SPK[1], SPK_Z0);
    const h = p.speakerHeightMm, m = EST.magnet;
    const solid = hide("spk", G.solidOf([[0, m.r * 0.92], [0.4, m.r, 1], [m.h, m.r], [m.h + 0.6, m.r + 1.2], [h - 3.2, SPK_R - 0.8, 1], [h - 2.2, SPK_R], [h, SPK_R]], F, P));
    const face = [G.arcOf(F, h, SPK_R - 1.6, P, { least: -1 }), G.arcOf(F, h, SPK_R - 4.2, P, { least: -1 }), G.arcOf(F, h, EST.dustCap, P, { least: -1 })];
    const tabs = SPK_TABS.map((tab) => S(k.slabOf(box(tab[0], tab[1], EST.spkTab[0], EST.spkTab[1], 0.2), tab[2] - EST.spkTab[2], EST.spkTab[2], P, 1), { tone: "mid" }));
    return S(solid, { tone: "mid", inner: L(face[0], { tone: "lo" }) + L(face[1] + face[2], { tone: "faint" }) }) + tabs.join("");
  }
  part("spk", speaker(), { step: STEP.baseParts, lift: LIFT.guts });

  // The harness leaves the bottom of the base nipple, runs out along the groove and through the gap in the disc ring,
  // turns along the front of the plate and stands up beside the junction board's end as its joined 30 mm, flat. Inside
  // the nipple it is hidden (a clip that stays with the nipple), and it reaches far enough up the nipple that it still
  // leaves the nipple's end when the guts drop away.
  const bundleR = EST.bundle / 2;
  const TAIL_Z = BFLOOR + bundleR + 0.1; // on the plate's floor once it is out of the groove
  const GROOVE_Z = GROOVE_FLOOR + bundleR + 0.1;
  const RISE = [JB_PLAN.x - 4.5, 40]; // where the tail stands up, beside the board's end
  const RIBBON_TOP = JB_TOP + 1.2;
  const nippleBore = sweep(circle(ARM[0], ARM[1], PIPE_R, 24).map((q) => [...q, NIPB0]), [0, 0, 1]);
  function harnessBase() {
    const pts = [[ARM[0], ARM[1], NIPB0 + GUTS + 4], [ARM[0], ARM[1], NIPB0], [ARM[0], ARM[1], GROOVE_Z], [ARM[0], GROOVE_END, GROOVE_Z],
      [ARM[0], RISE[1], TAIL_Z], [RISE[0], RISE[1], TAIL_Z], [RISE[0], RISE[1], TAIL_Z + 8]];
    const tube = bundleOf(pts, bundleR, { radius: 7, xrayFrom: 1 });
    const ribbon = ribbonOf([[RISE[0], RISE[1], TAIL_Z + 7], [RISE[0], RISE[1], RIBBON_TOP]], WIRES, [1, 0, 0]);
    return clipped(`${EVERYWHERE}${nippleBore}`, tube, { withLine: "nipbase", evenodd: true }) + ribbon.svg;
  }
  // Its ten wires, in ribbon order from the back: 1-3 5 V and 4, 7, 9 GND to the board's front rails, 5 and 6 to the
  // speaker, 8 (LED) through two 220 ohm to the stick's DIN, 10 (BTN) to the talk button (step 25).
  const RIBBON_ENDS = Array.from({ length: WIRES }, (_, j) => [RISE[0], RISE[1] + (j + 0.5 - WIRES / 2) * WIRE_OD, RIBBON_TOP]);
  part("harness", harnessBase(), { step: STEP.harness, lift: LIFT.guts });

  // A hex nut threaded on a nipple.
  function hexNut(cx, cy, z0, h, { line, tone = "mid", frame = null }) {
    const ringPts = hex(cx, cy, NUT_AF, Math.PI / 6);
    const body = frame ? hPrism(ringPts, z0, z0 + h) : k.extrude(ringPts, z0, h, P);
    hide(line, body);
    const top = frame ? hPath(hCircle(cx, cy, PIPE_R, z0 + h, 24)) : k.ring(cx, cy, PIPE_R, z0 + h, P, 24);
    const chamfer = frame ? hPath(hCircle(cx, cy, NUT_AF / 2 - 0.2, z0 + h, 36)) : k.ring(cx, cy, NUT_AF / 2 - 0.2, z0 + h, P, 36);
    return S(body, { tone, inner: L(chamfer, { tone: "faint" }) }) + voidOf(top) + L(top, { tone: "lo" });
  }

  // The two steel discs, on the ribs; the top one has a Kapton face toward the junction board.
  const discFrame = upright(ARM[0], ARM[1]);
  function discOf(i) {
    const z0 = RIB_TOP + i * DISC_T, z1 = z0 + DISC_T;
    const solid = hide("ballast", G.ringBand(z0, z1, DISC_HOLE, DISC_R, discFrame, P));
    const marks = i === 1 ? L(G.arcOf(discFrame, z1, DISC_R - 1.2, P, { least: -1 }), { tone: "faint" }) : "";
    return S(solid, { tone: "mid", inner: marks });
  }
  for (const i of [0, 1]) part("ballast", discOf(i), { step: STEP.discs, lift: LIFT.discs });

  // The junction board: a quarter Perma-Proto on two staked pins, with the diode and the talk LED's resistor.
  const resistorAlong = (a, b, { tone = "mid", line } = {}) => {
    const dir = G.unit3(G.sub3(b, a)), len = G.len3(G.sub3(b, a));
    const F = G.frameAlong(a, dir);
    const { l, d } = EST.resistor;
    const s0 = (len - l) / 2;
    const body = G.solidOf([[s0, d * 0.36], [s0 + 0.2, d * 0.5, 1], [s0 + l * 0.22, d / 2, 1], [s0 + l * 0.3, d * 0.44, 1], [s0 + l * 0.7, d * 0.44, 1], [s0 + l * 0.78, d / 2, 1], [s0 + l - 0.2, d * 0.5, 1], [s0 + l, d * 0.36]], F, P);
    if (line) hide(line, body);
    const bands = [0.3, 0.42, 0.54, 0.86].map((t) => G.arcOf(F, s0 + l * t, d * 0.45, P)).join("");
    const leads = L(path([at(a), at(G.add3(a, G.mul3(dir, s0)))], false) + path([at(G.add3(a, G.mul3(dir, s0 + l))), at(b)], false), { tone: "mid" });
    return leads + S(body, { tone, inner: L(bands, { tone: "faint" }) });
  };
  // Holes on a 0.1 in grid from the board's corner; the power rails run along both long edges.
  const jbHole = (c, r) => [JB_PLAN.x + 2.2 + c * EST.pitch, JB_PLAN.y + 2.2 + r * EST.pitch, JB_TOP];
  const JB_ROWS = Math.floor((JB_PLAN.d - 4.4) / EST.pitch), JB_COLS = Math.floor((JB_PLAN.w - 4.4) / EST.pitch);
  function junction() {
    const board = hide("junction", k.slabOf(JB_PLAN, JB_Z, JB_TOP - JB_Z, P, 2, 0.5 * px));
    const dots = [];
    for (let c = 0; c <= JB_COLS; c++) for (let r = 0; r <= JB_ROWS; r++) {
      const q = jbHole(c, r);
      if (JB_HOLES.some(([hx, hy]) => Math.hypot(hx - q[0], hy - q[1]) < 3.4)) continue;
      if (r === 2 || r === JB_ROWS - 2) continue; // the gaps between the rails and the strips
      dots.push(at(q));
    }
    const rails = [0.5, JB_ROWS - 0.5].map((r) => L(k.lineOnTop(jbHole(0, r).slice(0, 2), jbHole(JB_COLS, r).slice(0, 2), JB_TOP, P), { tone: "faint" })).join("");
    const holes = JB_HOLES.map(([x, y]) => L(k.ring(x, y, p.junctionHoleMm / 2 + 1, JB_TOP, P, 24), { tone: "faint" }) + bore(x, y, p.junctionHoleMm / 2, JB_TOP)).join("");
    return S(board, { tone: "mid", inner: k.dotsSvg(dots, { size: 0.32, tone: "lo" }) + rails + holes });
  }
  const DIODE_AT = [jbHole(2, 3), jbHole(2, 7)].map((q) => G.add3(q, [0, 0, 1.4]));
  const R_TALK_AT = [jbHole(4, 3), jbHole(4, 7)].map((q) => G.add3(q, [0, 0, 1.3]));
  function diode() {
    const [a, b] = DIODE_AT, dir = G.unit3(G.sub3(b, a)), len = G.len3(G.sub3(b, a)), F = G.frameAlong(a, dir);
    const { l, d } = EST.diode, s0 = (len - l) / 2;
    const body = hide("diode", G.solidOf([[s0, d * 0.4], [s0 + 0.3, d / 2, 1], [s0 + l - 0.3, d / 2, 1], [s0 + l, d * 0.4]], F, P));
    const stripe = G.arcOf(F, s0 + l * 0.82, d / 2, P) + G.arcOf(F, s0 + l * 0.9, d / 2, P);
    const leads = L(path([at(G.sub3(a, [0, 0, 1.4])), at(a), at(G.add3(a, G.mul3(dir, s0)))], false) + path([at(G.add3(a, G.mul3(dir, s0 + l))), at(b), at(G.sub3(b, [0, 0, 1.4]))], false), { tone: "mid" });
    return leads + S(body, { tone: "lo", inner: L(stripe, { tone: "mid" }) });
  }
  // Where the light bar and the talk button take their wires: the stick's input pads on its underside, the switch's
  // four solder lugs under its body (two for the switch, two for its LED).
  const STICK_PADS = [-1, 0, 1].map((i) => [STICK[0] - STK_L / 2 + 1.6, STICK[1] + i * EST.pitch, STICK_Z]); // DIN, 5 V, GND
  const TALK_LUGS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [TALK[0] + a * 5, TALK[1] + b * 4.5, BH - TALK_DEPTH]);
  const INLINE_R = [[RISE[0] - 1.5, RISE[1] + 4.5, STICK_Z - 3], [RISE[0] - 1.5 - 2 * EST.resistor.l - 1, RISE[1] + 4.5, STICK_Z - 3]];
  // The board's wiring: the harness's power wires onto the front rails, and a small bundle from its end to the stick
  // and the talk button (5 V through the diode, GND, the LED's 220 ohm, the button), with the speaker pair and the
  // LED data wire beside it.
  const FORK = [STICK_PADS[0][0] - 3, STICK[1] - 4, STICK_Z - 4]; // where the bundle parts for the stick and the button
  function baseWiring() {
    const front = (c) => jbHole(c, JB_ROWS);
    const front2 = (c) => jbHole(c, JB_ROWS - 1);
    const power = [front(0), front(1), front(2), front2(0), null, null, front2(1), null, front2(2), null];
    const out = [];
    RIBBON_ENDS.forEach((end, j) => {
      if (power[j]) out.push(fanOf([[end, power[j], [0.6, 0, 2]]]));
    });
    // The speaker pair, wires 5 and 6.
    for (const j of [4, 5]) {
      const tab = SPK_TABS[j - 4];
      out.push(wire([RIBBON_ENDS[j], G.add3(RIBBON_ENDS[j], [-2, -1, 1.5]), [RISE[0] - 6, 20 + (j - 4) * 1.2, RIBBON_TOP - 1], [tab[0] + 6, tab[1] + 2, tab[2] + 1], tab], { radius: 6 }));
    }
    // Wire 8 to the two resistors in series, then to DIN; wire 10 to the button.
    out.push(wire([RIBBON_ENDS[7], G.add3(RIBBON_ENDS[7], [-1.5, 0.5, 1.2]), INLINE_R[0]], { radius: 2, ends: "to" }));
    out.push(wire([INLINE_R[1], [STICK_PADS[0][0] + 1, STICK_PADS[0][1] + 1.5, STICK_Z - 2], STICK_PADS[0]], { radius: 2, ends: "to" }));
    out.push(wire([RIBBON_ENDS[9], G.add3(RIBBON_ENDS[9], [-2, 0, 1]), [FORK[0] + 2, FORK[1] + 1, FORK[2] - 2], [TALK_LUGS[3][0] + 3, TALK_LUGS[3][1], TALK_LUGS[3][2] + 6], TALK_LUGS[3]], { radius: 5 }));
    // The bundle: from the board's end, under the stick to the split.
    const start = [JB_PLAN.x + 1.2, DIODE_AT[1][1], JB_TOP + 2.2];
    out.push(bundleOf([start, [JB_PLAN.x - 6, start[1] + 1, JB_TOP + 3], [FORK[0] + 6, FORK[1], FORK[2] + 1], FORK], WIRE_OD * Math.sqrt(5 / 0.75) / 2, { radius: 4 }));
    out.push(fanOf([[start, DIODE_AT[1]], [start, R_TALK_AT[1]], [start, front2(3)]], { lift: 1 }));
    out.push(fanOf([[FORK, STICK_PADS[1], [0, 0.5, 2]], [FORK, STICK_PADS[2], [0, 1, 2]]], { lift: 2 }));
    out.push(fanOf([[FORK, TALK_LUGS[0], [-2, -2, 2]], [FORK, TALK_LUGS[1], [1, -2, 2]], [FORK, TALK_LUGS[2], [-2, 1, 2]]], { lift: 2 }));
    return out.join("");
  }
  // The board, then what stands on it and the wiring, in one place.
  part("junction", junction(), { step: STEP.junction, lift: LIFT.guts });
  part("diode", diode(), { step: STEP.junction, lift: LIFT.guts });
  part("r220", resistorAlong(R_TALK_AT[0], R_TALK_AT[1], { line: "r220" }), { step: STEP.junction, lift: LIFT.guts });
  part("harness", baseWiring(), { step: STEP.junction, lift: LIFT.guts, count: 0 });
  // The two 220 ohm in series in the LED data wire, end to end in heat-shrink near the stick.
  part("r220", resistorAlong(INLINE_R[0], G.add3(INLINE_R[0], [-EST.resistor.l - 0.5, 0, 0]), { line: "r220" })
    + resistorAlong(G.add3(INLINE_R[0], [-EST.resistor.l - 0.5, 0, 0]), INLINE_R[1], { line: "r220" }), { step: STEP.junction, lift: LIFT.guts, count: 2 });

  // The NeoPixel stick, LEDs up in its frame.
  function stick() {
    const plan = box(STICK[0], STICK[1], STK_L, STK_W, 0.6);
    const board = hide("stick", k.slabOf(plan, STICK_Z, EST.board, P, 2));
    const pitch = STK_L / PIXELS, z1 = STICK_Z + EST.board;
    const leds = Array.from({ length: PIXELS }, (_, i) => {
      const x = plan.x + pitch * (i + 0.5);
      return S(k.slabOf(box(x, STICK[1], EST.pixel[0], EST.pixel[1], 0.3), z1, STK_H - EST.board, P, 2), { tone: "hi", inner: L(k.ring(x, STICK[1], 1.8, STK_H + STICK_Z, P, 20), { tone: "faint" }) });
    });
    return S(board, { tone: "mid" }) + byDepth(leds.map((svg, i) => ({ svg, q: [plan.x + pitch * (i + 0.5), STICK[1], z1] })), (it) => it.q).map((it) => it.svg).join("");
  }
  part("stick", stick(), { step: STEP.baseParts, lift: LIFT.guts });

  // The talk button's body under the top: its lugs, the switch body, the bushing and the ring nut. Its cap is drawn
  // after the top shell, in the shell's hole.
  function talkBody() {
    const F = upright(TALK[0], TALK[1]);
    const zBody = BH - TALK_DEPTH + EST.talkLugs, zBush = B_TOP_IN - EST.ringNut.t;
    const lugs = byDepth(TALK_LUGS).map((q) => S(k.slabOf(box(q[0], q[1], EST.talkLug[0], EST.talkLug[1], 0.1), q[2], EST.talkLugs, P, 1), { tone: "mid" }));
    const body = hide("talk", k.slabOf(box(TALK[0], TALK[1], TALK_BW, TALK_BD, 1), zBody, zBush - zBody, P, 3));
    const bushing = G.disc(zBush, B_TOP_IN, TALK_HOLE - 0.2, F, P);
    const nut = hide("talk", G.disc(zBush, B_TOP_IN, EST.ringNut.d / 2, F, P));
    return lugs.join("") + S(body, { tone: "hi" }) + S(bushing, { tone: "mid" }) + S(nut, { tone: "mid", inner: L(G.arcOf(F, zBush + 0.6, EST.ringNut.d / 2, P), { tone: "faint" }) });
  }
  part("talk", talkBody(), { step: STEP.baseParts, lift: LIFT.guts });

  // ---- 5 the inserts in the top shell's bosses --------------------------------------------------------------------
  function insertOf(F, r, h, line, s0 = 0) {
    const body = hide(line, G.disc(s0, s0 + h, r, F, P));
    const knurl = G.ribsOf(F, s0 + 0.4, s0 + h - 0.4, r, 18, P, { fade: [0.05, 0.5] });
    return S(body, { tone: "mid", inner: k.fadedSvg(knurl, { tone: "faint" }) + L(G.arcOf(F, s0 + h / 2, r, P), { tone: "faint" }) });
  }
  for (const [x, y] of byDepth(BOSSES.map((q) => [...q, 0])))
    part("ins3", insertOf(upright(x, y, PAD_TOP), INS3.outerMm / 2, INS3.lengthMm, "ins3") + bore(x, y, 1.25, PAD_TOP), { step: STEP.inserts, lift: LIFT.baseInserts });

  // The base nipple: hidden in the column and the coupling, so it shows as an x-ray.
  const nippleOf = (F, s0, s1, line) => {
    const body = hide(line, G.disc(s0, s1, PIPE_R, F, P));
    const threads = [];
    for (let s = s0 + 0.6; s < s0 + 9; s += 0.9) threads.push(G.arcOf(F, s, PIPE_R, P));
    for (let s = s1 - 0.6; s > s1 - 9; s -= 0.9) threads.push(G.arcOf(F, s, PIPE_R, P));
    return S(body, { tone: "mid", inner: L(threads.join(""), { tone: "faint" }) });
  };
  part("nipbase", nippleOf(upright(ARM[0], ARM[1]), NIPB0, COUP_B0 + p.baseNippleEngagementMm, "nipbase"), { step: STEP.arm });

  // The harness inside the arm: up the base nipple, the gooseneck and the head nipple. It is hidden all the way (its
  // x-ray shows it), and it overlaps both tails inside the nipples.
  const harnessArm = () => bundleOf([[ARM[0], ARM[1], NIPB0 + 0.5], S0, ...route.pts, E0, H([NIP[0], NIP[1], NUT_H0 + 0.5])], bundleR, { radius: 2 });
  part("harness", harnessArm(), { step: STEP.harness, count: 0 });

  // ---- 6 the top shell ------------------------------------------------------------------------------------------------
  // Built by hand so its top face has real openings: the grille, the talk-button hole and the light-bar slot.
  const GRILLE = (() => {
    const r = p.grilleDiameterMm / 2, pitch = p.grillePitchMm, hr = p.grilleHoleMm / 2, out = [];
    const rows = Math.floor(r / ((pitch * Math.sqrt(3)) / 2)) + 1;
    for (let j = -rows; j <= rows; j++) {
      const y = (j * pitch * Math.sqrt(3)) / 2, off = j % 2 ? pitch / 2 : 0;
      for (let i = -rows - 1; i <= rows + 1; i++) {
        const x = i * pitch + off;
        if (Math.hypot(x, y) + hr <= r) out.push([SPK[0] + x, SPK[1] + y]);
      }
    }
    return out;
  })();
  const SLOT = stadium(STICK[0], STICK[1], p.diffuserRibLengthMm + 2 * p.diffuserClearanceMm, p.diffuserRibWidthMm + 2 * p.diffuserClearanceMm, 12);
  const TALK_RING = circle(TALK[0], TALK[1], TALK_HOLE, 40);
  const onTopPath = (pts, z) => path(pts.map(([x, y]) => at([x, y, z])));
  function baseTop() {
    const f = p.baseTopFilletMm;
    const levels = [[0, BFLOOR], [0, BH - f], ...ARC(12).map((deg) => [f * (1 - Math.cos(rad(deg))), BH - f + f * Math.sin(rad(deg))]), [f, BH]];
    const rings = levels.map(([inset, z]) => planRing(k.insetPlan(CASE, inset), 28).map(([x, y]) => [x, y, z]));
    const shell = hide("basetop", faceted(loftFaces(rings, [false, false])));
    fig.under(`<g data-a2-with="basebot" data-a2-until="basetop">${L(shell.outline, { tone: "faint", dashed: true })}</g>`);
    const holes = [onTopPath(TALK_RING, BH), onTopPath(SLOT, BH), ...GRILLE.map(([x, y]) => onTopPath(circle(x, y, p.grilleHoleMm / 2, 12), BH))].join("");
    const topFace = path(rings[rings.length - 1].map(at));
    const tones = shell.shades.map((d, shade) => (d ? `<path class="iso-shade" data-shade="${shade}" d="${d}"/>` : "")).join("");
    // Inside each opening: the dark beyond, and the far wall of the 2.5 mm skin.
    const opening = (pts) => {
      const mouth = onTopPath(pts, BH), low = onTopPath(pts, B_TOP_IN);
      return voidOf(mouth) + clipped(mouth, `<path class="iso-shade" data-shade="2" fill-rule="evenodd" d="${mouth}${low}"/>`) + L(mouth, { tone: "mid" });
    };
    const grille = voidOf(GRILLE.map(([x, y]) => onTopPath(circle(x, y, p.grilleHoleMm / 2, 12), BH)).join("")) + L(GRILLE.map(([x, y]) => onTopPath(circle(x, y, p.grilleHoleMm / 2, 12), BH)).join(""), { tone: "lo" });
    const grilleRim = L(k.ring(SPK[0], SPK[1], p.grilleDiameterMm / 2 + 1.4, BH, P, 64), { tone: "faint" });
    // The collar the arm coupling seats in.
    const collar = G.disc(BH - 0.5, BH + COLLAR_H, COLLAR_R, upright(ARM[0], ARM[1]), P);
    const seat = k.ring(ARM[0], ARM[1], COUP_R + 0.3, BH + COLLAR_H, P, 40);
    return `<g class="iso-solid"><path class="iso-fill" fill-rule="evenodd" d="${shell.fill}${holes}"/>${tones}`
      + `<path class="iso-top" fill-rule="evenodd" d="${topFace}${holes}"/>${shell.top ? `<path class="iso-top" d="${shell.top}"/>` : ""}`
      + `${shell.blend}${L(shell.crease, { tone: "faint", className: "iso-crease" })}${L(shell.outline, { tone: "mid", className: "iso-edge" })}</g>`
      + grille + grilleRim + opening(TALK_RING) + opening(SLOT)
      + S(collar, { tone: "mid" }) + voidOf(seat) + L(seat, { tone: "lo" });
  }
  const BASE_TOP_SILHOUETTE = path(G.hullOf(k.boxCorners(CASE, BFLOOR, BH).map(at)));
  // The base top goes on last, at the step that closes the base: seen from above it would hide everything inside.
  part("basetop", baseTop(), { step: STEP.closeBase });

  // ---- 7 the talk button and the diffuser, in their openings ---------------------------------------------------------
  // What shows of a part held in a top-shell opening: everything outside the shell, and what is above the opening.
  const inOpening = (pts, line = "basetop") => [
    { d: `${EVERYWHERE}${BASE_TOP_SILHOUETTE}`, withLine: line, evenodd: true },
    { d: sweep(pts.map(([x, y]) => [x, y, BH]), [0, 0, 1]), withLine: line },
    { d: EVERYWHERE, withLine: line, until: line }, // all of it shows while the shell is off
  ];
  function talkCap() {
    const F = upright(TALK[0], TALK[1]);
    const bushing = G.disc(B_TOP_IN - 0.1, BH, TALK_HOLE - 0.2, F, P);
    const bezel = G.solidOf([[BH, TALK_CAP / 2], [BH + EST.bezel * 0.6, TALK_CAP / 2, 1], [BH + EST.bezel, TALK_CAP / 2 - 0.5]], F, P);
    const plunger = G.solidOf([[BH + EST.bezel - 0.2, EST.plunger / 2], [BH + TALK_ABOVE - 0.6, EST.plunger / 2, 1], [BH + TALK_ABOVE, EST.plunger / 2 - 0.7]], F, P);
    hide("talk", bezel, plunger);
    const glow = L(G.arcOf(F, BH + TALK_ABOVE, EST.plunger / 2 - 2.2, P, { least: -1 }), { tone: "faint" });
    return clippedTo(inOpening(TALK_RING), S(bushing, { tone: "mid" }) + S(bezel, { tone: "hi" }) + S(plunger, { tone: "hi", inner: glow }));
  }
  part("talk", talkCap(), { step: STEP.baseParts, lift: LIFT.guts, count: 0 });
  function diffuser() {
    const flange = hide("diffuser", k.slabOf(box(STICK[0], STICK[1], p.diffuserLengthMm, p.diffuserWidthMm, 2), DIFF_Z, p.diffuserFlangeMm, P, 3));
    const ribPts = stadium(STICK[0], STICK[1], p.diffuserRibLengthMm, p.diffuserRibWidthMm, 12);
    const rib = k.extrude(ribPts, B_TOP_IN - 0.1, BH - B_TOP_IN + 0.1, P);
    hide("diffuser", rib);
    // Its rib is flush with the top: with the shell on, all that shows is its face in the slot's mouth, so the clip is
    // the mouth itself (the rib's lower outline would show at the slot's ends through a clip swept up from it).
    return clippedTo([{ d: onTopPath(SLOT, BH), withLine: "basetop" }, { d: EVERYWHERE, withLine: "basetop", until: "basetop" }], S(flange, { tone: "hi" }) + S(rib, { tone: "hi" }));
  }
  part("diffuser", diffuser(), { step: STEP.baseParts }); // glued into its slot: it stays with the top

  // ---- 8 the base coupling, on its collar ---------------------------------------------------------------------------
  function couplingOf(F, s0) {
    const body = hide("coupling", G.disc(s0, s0 + COUP_H, COUP_R, F, P, { bevel: 0.6 * px }));
    return S(body, { tone: "mid", inner: L(G.arcOf(F, s0 + 0.7, COUP_R, P) + G.arcOf(F, s0 + COUP_H - 0.7, COUP_R, P), { tone: "faint" }) })
      + L(G.circleOf(F, s0 + COUP_H, PIPE_R + 0.4, P), { tone: "faint" });
  }
  part("coupling", couplingOf(upright(ARM[0], ARM[1]), COUP_B0), { step: STEP.arm });

  // ===================================================================================================================
  // THE HEAD
  // ===================================================================================================================

  // ---- 9 the four M3 screws up through the lower shell's wells --------------------------------------------------------
  for (const [x, y] of byDepth(HEAD_BOSSES.map(([x, y]) => [x, y]), (q) => H([...q, 0])))
    part("scr3", screwOf(G.frameOf(H([x, y, WELL_DEPTH]), HZ, HX, HY), { headD: p.m3HeadDiameterMm, headH: p.m3HeadHeightMm, length: SCR3.lengthMm, r: m3R, line: "scr3" }), { step: STEP.closeHead, lift: LIFT.headScrews });

  // ---- 10 the head lower shell: an open tray with the camera window, the shutter track, the cradle and the Pi posts ---
  const HEAD_PLAN = { x: -HL / 2, y: -HD / 2, w: HL, d: HD, r: HR };
  const INNER_PLAN = { x: -IX, y: -IY, w: 2 * IX, d: 2 * IY, r: HR - HWALL };
  const LIP_PLAN = k.insetPlan(INNER_PLAN, -LIP_W);
  const LOWER_TOP = SPLIT + LIP_H;
  const lowerOpening = planRing(INNER_PLAN, 6).map(([x, y]) => H([x, y, LOWER_TOP]));
  const lowerColumn = sweep(lowerOpening, HZ);
  function lower() {
    const f = p.headBottomFilletMm;
    const levels = [[f, 0], ...ARC(6).map((deg) => [f * (1 - Math.sin(rad(deg))), f - f * Math.cos(rad(deg))]), [0, f], [0, SPLIT]];
    const outer = hide("headbot", loft(levels.map(([inset, z]) => hRing(k.insetPlan(HEAD_PLAN, inset), z, 10))));
    const lip = loft([hRing(LIP_PLAN, SPLIT, 6), hRing(LIP_PLAN, LOWER_TOP, 6)]);
    // Inside: the floor, the far inner walls, and what stands on the floor, seen through the opening.
    const ring = planRing(INNER_PLAN, 6);
    const inside = [`<path ${toneOf(HZ)} d="${hPath(ring.map(([x, y]) => [x, y, IZ0]))}"/>`];
    const seams = [];
    ring.forEach(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % ring.length];
      const n = Hd([-(by - ay), bx - ax, 0]);
      if (!facing(n)) return;
      inside.push(`<path ${toneOf(n)} d="${hPath([[ax, ay, LOWER_TOP], [bx, by, LOWER_TOP], [bx, by, IZ0], [ax, ay, IZ0]])}"/>`);
      seams.push(hPath([[ax, ay, IZ0], [bx, by, IZ0]], false));
    });
    inside.push(L(seams.join(""), { tone: "faint" }));
    const floorZ = IZ0;
    // Openings in the floor: the camera window, the shutter nub's slot, the vents under the Pi.
    const holes = [hCircle(LENS_X, LENS_Y, WIN_R, floorZ, 40), stadium(NUB_X - SH_TRAVEL / 2, TAIL_Y, SH_TRAVEL + NUB_L + 2 * SH_CLEAR, NUB_W + 2 * SH_CLEAR, 8).map(([x, y]) => [x, y, floorZ])];
    for (let x = PI_X0 + 9.5; x <= PI_X1 - 9.5 + 1e-6; x += 6) holes.push(stadium(x, (PI_Y0 + PI_Y1) / 2, PI_W - 16 + p.headVentWidthMm, p.headVentWidthMm, 6).map(([u, v]) => [u, v, floorZ]).map(([u, v, z]) => [x + (v - (PI_Y0 + PI_Y1) / 2), (PI_Y0 + PI_Y1) / 2 + (u - x), z]));
    for (const pts of holes) inside.push(hVoid(pts) + L(hPath(pts), { tone: "lo" }));
    // What stands on the floor, far to near.
    const items = [];
    const put = (q, svg) => items.push({ q: H(q), svg });
    for (const s of [-1, 1]) {
      const y0 = s * RAIL_Y_IN, y1 = s * RAIL_Y_OUT;
      put([(RAIL_X0 + RAIL_X1) / 2, (y0 + y1) / 2, IZ0], S(hBox(RAIL_X0, RAIL_X1, Math.min(y0, y1), Math.max(y0, y1), IZ0, LIP_TOP), { tone: "lo" })
        + S(hBox(RAIL_X0, LIP_X1, Math.min(s * (RAIL_Y_IN - p.shutterLipMm), y1), Math.max(s * (RAIL_Y_IN - p.shutterLipMm), y1), LIP_Z0, LIP_TOP), { tone: "lo" }));
    }
    for (const [hx, hy] of CAM_HOLES) {
      const s = Math.sign(hy);
      put([hx, s * POST_Y_OUT, IZ0], S(hBox(hx - POST_W / 2, hx + POST_W / 2, Math.min(s * RAIL_Y_OUT, s * POST_Y_OUT), Math.max(s * RAIL_Y_OUT, s * POST_Y_OUT), IZ0, CAM_FRONT_Z), { tone: "lo" })
        + S(hBox(hx - POST_W / 2, hx + POST_W / 2, Math.min(s * (Math.abs(hy) - 1.5), s * POST_Y_OUT), Math.max(s * (Math.abs(hy) - 1.5), s * POST_Y_OUT), CAM_FRONT_Z - LEDGE_T, CAM_FRONT_Z), { tone: "lo" })
        + S(G.disc(CAM_FRONT_Z, CAM_FRONT_Z + p.cameraPinHeightMm, p.cameraPinDiameterMm / 2, FZ(hx, hy), P), { tone: "lo" }));
    }
    for (const [x, y] of PI_HOLES)
      put([x, y, IZ0], S(G.disc(IZ0, PI_Z, M25_BOSS / 2, FZ(x, y), P), { tone: "lo" }) + hVoid(hCircle(x, y, p.m25InsertHoleMm / 2, PI_Z, 20)));
    for (const [x, y] of HEAD_BOSSES)
      put([x, y, IZ0], S(G.disc(IZ0, SPLIT, WELL_R, FZ(x, y), P), { tone: "lo" }) + hVoid(hCircle(x, y, p.m3ClearanceHoleMm / 2, SPLIT, 20)));
    for (const item of byDepth(items, (it) => it.q)) inside.push(item.svg);
    const opening = path(lowerOpening.map(at));
    return S(outer, { tone: "mid" }) + S(lip, { tone: "mid" }) + clipped(opening, inside.join("")) + L(opening, { tone: "lo" });
  }
  part("headbot", lower(), { step: STEP.prints, lift: LIFT.lower });

  // ---- 11 what sits in the lower shell, seen only through its opening (a clip that stays with the lower shell) ------
  const inLower = (svg) => clipped(lowerColumn, svg, { withLine: "headbot" });
  for (const [x, y] of byDepth(PI_HOLES, (q) => H([...q, PI_Z])))
    part("ins25", inLower(insertOf(FZ(x, y), INS25.outerMm / 2, INS25.lengthMm, "ins25", PI_Z - INS25.lengthMm) + hVoid(hCircle(x, y, 1.05, PI_Z + 0.01, 16))), { step: STEP.inserts, lift: LIFT.ins25 });
  function shutter() {
    const plate = hide("shutter", hLoft([[box((SH_X0 + SH_X1) / 2, LENS_Y, SH_LEN, SH_W, 2), IZ0, 4], [box((SH_X0 + SH_X1) / 2, LENS_Y, SH_LEN, SH_W, 2), SH_TOP, 4]]));
    const tail = hide("shutter", hBox(SH_X0 - TAIL_L, SH_X0 + 1, TAIL_Y - TAIL_W / 2, TAIL_Y + TAIL_W / 2, IZ0, IZ0 + SH_T * 0.75));
    // The thumb nub, as cad/shutter.py: under the tail, down through the floor slot. The floor hides it, so it shows
    // only in the x-ray.
    hide("shutter", hPrism(stadium(NUB_X, TAIL_Y, NUB_L, NUB_W, 8), -p.shutterNubDropMm, IZ0 + 0.5));
    return S(tail, { tone: "mid" }) + S(plate, { tone: "mid" });
  }
  part("shutter", inLower(shutter()), { step: STEP.shutter, lift: LIFT.shutter });

  // The camera, lens down on its four pins; the cable from its connector loops over to the Pi's camera socket.
  function camera() {
    const lens = hide("cam", hBox(LENS_X - EST.lensHolder / 2, LENS_X + EST.lensHolder / 2, LENS_Y - EST.lensHolder / 2, LENS_Y + EST.lensHolder / 2, LENS_TIP_Z + 1.5, CAM_FRONT_Z));
    const z1 = CAM_FRONT_Z + EST.camBoard;
    const board = hide("cam", hLoft([[span(CAM_X0, CAM_X1, -CAM_Y, CAM_Y, 1), CAM_FRONT_Z, 2], [span(CAM_X0, CAM_X1, -CAM_Y, CAM_Y, 1), z1, 2]]));
    const holes = CAM_HOLES.map(([x, y]) => hVoid(hCircle(x, y, p.cameraHoleDiameterMm / 2, z1, 18)) + L(hPath(hCircle(x, y, p.cameraHoleDiameterMm / 2 + 0.6, z1, 18)), { tone: "faint" })).join("");
    const conn = hide("cam", hBox(CAM_X0 + 0.3, CAM_X0 + 0.3 + EST.camConn.d, -EST.camConn.w / 2, EST.camConn.w / 2, z1, CAM_BACK_Z));
    const latch = hPath([[CAM_X0 + 1.2, -EST.camConn.w / 2 + 0.6, CAM_BACK_Z], [CAM_X0 + 1.2, EST.camConn.w / 2 - 0.6, CAM_BACK_Z]], false);
    const chips = [[CAM_X0 + 10, 4, 3, 2.4], [CAM_X0 + 13.5, -6, 2, 1.4], [CAM_X0 + 17, 7.5, 1.6, 1]].map(([x, y, w, d]) => S(hBox(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z1, z1 + 0.6), { tone: "lo" })).join("");
    return S(lens, { tone: "lo" }) + S(board, { tone: "hi" }) + holes + chips + S(conn, { tone: "mid", inner: L(latch, { tone: "faint" }) });
  }
  // The flat cable: a strip of quads along its centreline (head x-z), its width across y, shaded by which way it faces.
  function flatCable(centre, widths) {
    const quads = [];
    for (let i = 0; i + 1 < centre.length; i++) {
      const [a, b] = [centre[i], centre[i + 1]];
      const [wa, wb] = [widths[i], widths[i + 1]];
      const pts = [[a[0], a[1] - wa / 2, a[2]], [b[0], b[1] - wb / 2, b[2]], [b[0], b[1] + wb / 2, b[2]], [a[0], a[1] + wa / 2, a[2]]].map(H);
      let n = newell(pts);
      if (!facing(n)) n = G.mul3(n, -1);
      quads.push({ pts, n, mid: G.lerp3(pts[0], pts[2], 0.5) });
    }
    const fill = quads.map((q) => path(oriented(q.pts.map(at)))).join("");
    const shades = quads.map((q) => `<path ${toneOf(q.n)} d="${path(oriented(q.pts.map(at)))}"/>`).join("");
    const edgeOf = (side) => path(centre.map((c, i) => hAt([c[0], c[1] + (side * widths[i]) / 2, c[2]])), false);
    const ends = [0, centre.length - 1].map((i) => path([hAt([centre[i][0], centre[i][1] - widths[i] / 2, centre[i][2]]), hAt([centre[i][0], centre[i][1] + widths[i] / 2, centre[i][2]])], false));
    const traces = [0.3, 0.5, 0.7].map((t) => path(centre.map((c, i) => hAt([c[0], c[1] + (t - 0.5) * widths[i], c[2]])), false)).join("");
    return { svg: `<g class="iso-solid"><path class="iso-fill" d="${fill}"/>${shades}${L(traces, { tone: "faint" })}${L(edgeOf(-1) + edgeOf(1) + ends.join(""), { tone: "mid", className: "iso-edge" })}</g>`, fill, outline: edgeOf(-1) + edgeOf(1) };
  }
  const CSI_AT = [PI_X1 - EST.csi.d, PI_MID[1], PI_TOP + EST.csi.h];
  function cameraCable() {
    // From the camera's connector, out toward the Pi, up over a short loop and down into the Pi's socket.
    const start = [CAM_X0 + 1.2, LENS_Y, CAM_BACK_Z - 1.2], end = [CSI_AT[0] + 1.2, CSI_AT[1], CSI_AT[2] - 0.4];
    const ctrl = [start, [CAM_X0 - 3, LENS_Y, CAM_BACK_Z - 0.4], [CAM_X0 - 7.5, (LENS_Y + PI_MID[1]) / 2, CAM_BACK_Z + 4.5], [PI_X1 + 4, PI_MID[1], CAM_BACK_Z + 3], [PI_X1 + 1.5, PI_MID[1], CSI_AT[2] + 3.5], [PI_X1 - 0.5, PI_MID[1], CSI_AT[2] + 0.4], end];
    const centre = G.resample(G.fillet(ctrl, 3.2, 8), 0.8);
    const total = G.pathLength(centre);
    let walked = 0;
    const widths = centre.map((c, i) => {
      if (i) walked += G.len3(G.sub3(c, centre[i - 1]));
      const t = Math.min(1, Math.max(0, (walked - total * 0.35) / (total * 0.3)));
      return EST.fpcWide + (EST.fpcNarrow - EST.fpcWide) * t;
    });
    const strip = flatCable(centre, widths);
    hide("camcable", { fill: strip.fill, outline: strip.outline });
    return strip.svg;
  }

  // The Pi Zero 2 W: the board, its header, the SoC, the ports along the back edge, the SD slot and the camera socket.
  function pi() {
    const plan = span(PI_X0, PI_X1, PI_Y0, PI_Y1, EST.piCorner);
    const board = hide("pi", hLoft([[plan, PI_Z, 4], [plan, PI_TOP, 4]]));
    const marks = PI_HOLES.map(([x, y]) => L(hPath(hCircle(x, y, EST.piHole / 2 + 1.1, PI_TOP, 20)), { tone: "faint" }) + hVoid(hCircle(x, y, EST.piHole / 2, PI_TOP, 20))).join("");
    const parts = [];
    const along = (u) => PI_X0 + u, across = (v) => PI_Y0 + v;
    const chip = (x, y, w, d, h, tone = "mid") => S(hBox(x - w / 2, x + w / 2, y - d / 2, y + d / 2, PI_TOP, PI_TOP + h), { tone });
    parts.push(chip(along(EST.soc.at[0]), across(EST.soc.at[1]), EST.soc.w, EST.soc.w, EST.soc.h, "mid"));
    parts.push(S(hBox(along(EST.radio.at[0]) - EST.radio.w / 2, along(EST.radio.at[0]) + EST.radio.w / 2, across(EST.radio.at[1]) - EST.radio.d / 2, across(EST.radio.at[1]) + EST.radio.d / 2, PI_TOP, PI_TOP + EST.radio.h), { tone: "mid", inner: L(hPath([[along(EST.radio.at[0]) - EST.radio.w / 2 + 0.8, across(EST.radio.at[1]) - EST.radio.d / 2 + 0.8, PI_TOP + EST.radio.h], [along(EST.radio.at[0]) + EST.radio.w / 2 - 0.8, across(EST.radio.at[1]) - EST.radio.d / 2 + 0.8, PI_TOP + EST.radio.h], [along(EST.radio.at[0]) + EST.radio.w / 2 - 0.8, across(EST.radio.at[1]) + EST.radio.d / 2 - 0.8, PI_TOP + EST.radio.h], [along(EST.radio.at[0]) - EST.radio.w / 2 + 0.8, across(EST.radio.at[1]) + EST.radio.d / 2 - 0.8, PI_TOP + EST.radio.h]]), { tone: "faint" }) }));
    // The ports: mini HDMI and two micro USB, flush with the back edge.
    const port = (u, w, d, h) => {
      const x = along(u);
      const shell = hBox(x - w / 2, x + w / 2, PI_Y0 - 0.6, PI_Y0 - 0.6 + d, PI_TOP, PI_TOP + h);
      return S(shell, { tone: "hi", inner: L(hPath([[x - w / 2 + 0.6, PI_Y0 + 0.6, PI_TOP + h], [x + w / 2 - 0.6, PI_Y0 + 0.6, PI_TOP + h]], false), { tone: "faint" }) });
    };
    parts.push(port(EST.hdmi.at, EST.hdmi.w, EST.hdmi.d, EST.hdmi.h), ...EST.usb.at.map((u) => port(u, EST.usb.w, EST.usb.d, EST.usb.h)));
    // The camera socket at the +x end, its latch toward the board's middle.
    parts.push(S(hBox(PI_X1 - EST.csi.d, PI_X1, PI_MID[1] - EST.csi.w / 2, PI_MID[1] + EST.csi.w / 2, PI_TOP, PI_TOP + EST.csi.h), { tone: "mid", inner: L(hPath([[PI_X1 - EST.csi.d + 0.8, PI_MID[1] - EST.csi.w / 2 + 0.6, PI_TOP + EST.csi.h], [PI_X1 - EST.csi.d + 0.8, PI_MID[1] + EST.csi.w / 2 - 0.6, PI_TOP + EST.csi.h]], false), { tone: "faint" }) }));
    // The SD slot at the -x end.
    parts.push(S(hBox(PI_X0 + 0.2, PI_X0 + EST.sdSlot.l, PI_MID[1] - EST.sdSlot.w / 2, PI_MID[1] + EST.sdSlot.w / 2, PI_TOP, PI_TOP + EST.sdSlot.h), { tone: "hi" }));
    // The 2 x 20 header along the front edge: a black body and its pins.
    const hx0 = PI_MID[0] - 9.5 * EST.pitch, hy = PI_Y1 - p.piHoleInsetMm;
    parts.push(S(hBox(hx0 - EST.pitch / 2, hx0 + 19.5 * EST.pitch, hy - EST.pitch, hy + EST.pitch, PI_TOP, PI_TOP + EST.headerBody), { tone: "lo" }));
    const pins = [];
    for (let i = 0; i < 20; i++) for (const r of [-0.5, 0.5]) pins.push(hAt([hx0 + i * EST.pitch, hy + r * EST.pitch, PI_TOP + EST.headerBody + 5.5]));
    parts.push(k.dotsSvg(pins, { size: 0.5, tone: "mid" }));
    return S(board, { tone: "hi", inner: marks }) + parts.join("");
  }
  function sdCard() {
    const x0 = PI_X0 - 2.4, y0 = PI_MID[1] - SD_W / 2, z0 = PI_TOP + 0.05;
    const card = hide("sd", hLoft([[span(x0, x0 + SD_L, y0, y0 + SD_W, 0.6), z0, 2], [span(x0, x0 + SD_L, y0, y0 + SD_W, 0.6), z0 + SD_T * 0.7, 2]]));
    const grip = [1, 1.8].map((u) => hPath([[x0 + u, y0 + 1.5, z0 + SD_T * 0.7], [x0 + u, y0 + SD_W - 1.5, z0 + SD_T * 0.7]], false)).join("");
    return S(card, { tone: "mid", inner: L(grip, { tone: "faint" }) });
  }
  const m25Screw = ([x, y]) => screwOf(G.frameOf(H([x, y, PI_TOP]), G.mul3(HZ, -1), HX, G.mul3(HY, -1)), { headD: EST.m25Head.d, headH: EST.m25Head.h, length: SCR25.lengthMm, r: 1.25, line: "scr25", tone: "mid" });
  part("sd", sdCard(), { step: STEP.pi, lift: LIFT.sd });
  part("pi", inLower(pi()), { step: STEP.pi, lift: LIFT.board });
  part("cam", inLower(camera()), { step: STEP.camera, lift: LIFT.board });
  part("camcable", inLower(cameraCable()), { step: STEP.camera, lift: LIFT.board });
  for (const hole of byDepth(PI_HOLES, (q) => H([...q, PI_TOP]))) part("scr25", inLower(m25Screw(hole)), { step: STEP.pi, lift: LIFT.scr25 });

  // ---- 12 what hangs from the upper shell, all wired to the bonnet: bonnet and amp, the mics, the jumpers ------------
  function bonnet() {
    const plan = span(PI_X0 - 0.05, PI_X1 + 0.05, PI_Y0 - 0.05, PI_Y1 + 0.05, EST.piCorner);
    const board = hide("bonnet", hLoft([[plan, BON_Z, 4], [plan, ZB, 4]]));
    const joints = [];
    for (let i = 0; i < 20; i++) for (const r of [-0.5, 0.5]) joints.push(hAt([HX0 + i * EST.pitch, HDR_Y + r * EST.pitch, ZB]));
    const rows = [RAIL_GND, RAIL_5V];
    for (let y = PI_Y0 + 7.28; y <= HDR_Y - 1.5 * EST.pitch + 0.01; y += EST.pitch) rows.push(y);
    const grid = [];
    for (let x = PI_X0 + 2.2; x < PI_X1 - 1.5; x += EST.pitch) for (const y of rows)
      if (!PI_HOLES.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 3.2)) grid.push(hAt([x, y, ZB]));
    const rails = [RAIL_GND, RAIL_5V].map((y) => hPath([[PI_X0 + 6, y + 1.27, ZB], [PI_X1 - 6, y + 1.27, ZB]], false)).join("");
    const holes = PI_HOLES.map(([x, y]) => hVoid(hCircle(x, y, EST.piHole / 2, ZB, 18)) + L(hPath(hCircle(x, y, EST.piHole / 2 + 1, ZB, 18)), { tone: "faint" })).join("");
    return S(board, { tone: "mid", inner: k.dotsSvg(grid, { size: 0.32, tone: "lo" }) + k.dotsSvg(joints, { size: 0.55, tone: "hi" }) + L(rails, { tone: "faint" }) + holes });
  }
  function amp() {
    const plan = box(PI_MID[0], PI_MID[1], AMP_L, AMP_W, 0.6);
    const foam = hLoft([[k.insetPlan(plan, 2.5), BON_Z + BON_T, 2], [k.insetPlan(plan, 2.5), AMP_Z, 2]]);
    const board = hide("amp", hLoft([[plan, AMP_Z, 2], [plan, AMP_Z + EST.board, 2]]));
    const z1 = AMP_Z + EST.board;
    const pads = Array.from({ length: 7 }, (_, i) => hAt([plan.x + 1.6, plan.y + 1.6 + i * EST.pitch, z1]));
    const spk = [-1, 1].map((s) => hVoid(hCircle(plan.x + plan.w - 2.6, PI_MID[1] + s * 2.5, 0.7, z1, 12)) + L(hPath(hCircle(plan.x + plan.w - 2.6, PI_MID[1] + s * 2.5, 1.5, z1, 16)), { tone: "lo" })).join("");
    const chip = S(hBox(PI_MID[0] - EST.ampChip[0] / 2, PI_MID[0] + EST.ampChip[0] / 2, PI_MID[1] - EST.ampChip[1] / 2, PI_MID[1] + EST.ampChip[1] / 2, z1, z1 + AMP_T - EST.board - 0.4), { tone: "lo" });
    const caps = [[PI_MID[0] + 4, PI_MID[1] + 4.5], [PI_MID[0] + 4, PI_MID[1] - 4.5]].map(([x, y]) => S(hBox(x - EST.smdCap[0] / 2, x + EST.smdCap[0] / 2, y - EST.smdCap[1] / 2, y + EST.smdCap[1] / 2, z1, z1 + EST.smdCap[2]), { tone: "mid" })).join("");
    return S(foam, { tone: "lo" }) + S(board, { tone: "hi", inner: k.dotsSvg(pads, { size: 0.5, tone: "hi" }) + spk }) + chip + caps;
  }
  const ZB = BON_Z + BON_T; // the bonnet's top
  // The header, 2 x 20 at 0.1 in, with pin 1 at the SD end; a wire for a pin goes on the bonnet's pad beside it.
  const HX0 = PI_MID[0] - 9.5 * EST.pitch, HDR_Y = PI_Y1 - p.piHoleInsetMm;
  const pinPad = (pin) => [HX0 + Math.floor((pin - 1) / 2) * EST.pitch, HDR_Y - 1.5 * EST.pitch, ZB];
  const RAIL_GND = PI_Y0 + 2.2, RAIL_5V = PI_Y0 + 4.74; // the bonnet's power rails along its back edge
  // The two 1 k resistors in the mic clock lines, on the bonnet's proto area at the SD end.
  const R1K = [-10.1, -7.56].map((y) => [H([PI_X0 + 2.2, y, ZB + 1.2]), H([PI_X0 + 2.2 + 4 * EST.pitch, y, ZB + 1.2])]);
  // Each mic's six pads run along its top edge on the inside face.
  const MIC_PAD_Z = MIC_Z + MIC_H / 2 - 1.6;
  const MIC_PADS = MIC_XS.map((x) => Array.from({ length: 6 }, (_, i) => [x + (i - 2.5) * EST.pitch, IY - MIC_T, MIC_PAD_Z]));
  const LUG_X = IX - 2 - TOG_BL - EST.lugs;
  const TOG_LUGS = [-1, 0, 1].flatMap((r) => [-1, 1].map((c) => [LUG_X, TOG_Y + c * 2.6, TOG_Z + r * 4]));
  const LED_BACK = IY - EST.ledFlangeT; // the flange sits against the inside of the front wall
  const LED_LEGS = [LED_GREEN_X, LED_RED_X].map((x) => [-1, 1].map((s) => [x + (s * EST.pitch) / 2, LED_BACK - 2.4, LED_Z])); // [cathode, anode]
  const R_LED = 10.3; // where the LED resistors end, toward the back
  function mic(x) {
    // The breakout stands against the front wall, its port over the shell's sound hole, the mic on its inside face.
    const y1 = IY, y0 = IY - MIC_T;
    const board = hide("mic", hBox(x - MIC_L / 2, x + MIC_L / 2, y0, y1, MIC_Z - MIC_H / 2, MIC_Z + MIC_H / 2));
    const can = S(hBox(x - EST.micCan[0] / 2, x + EST.micCan[0] / 2, y0 - EST.micCan[2], y0, MIC_Z - EST.micCan[1] / 2, MIC_Z + EST.micCan[1] / 2), { tone: "hi" });
    // Its pads are on the inside face, out of sight; on the face toward the wall is the sound hole through the board.
    const port = circle(x, MIC_Z, 0.5, 12).map(([a, b]) => [a, y1 + 0.01, b]);
    return can + S(board, { tone: "mid", inner: hVoid(port) + L(hPath(circle(x, MIC_Z, 1.6, 20).map(([a, b]) => [a, y1 + 0.01, b])), { tone: "faint" }) });
  }
  // The head end of the arm harness: out of the nipple, over the camera cable, its joined end flat on the back of the
  // bonnet; there its wires part (step 19).
  const nipHeadBore = sweep(hCircle(NIP[0], NIP[1], PIPE_R, NUT_H0, 24).map(H), HZ);
  const HEAD_RIBBON = [[13, -11, ZB + 3], [4, -11, ZB + 2], [-3, -11, ZB + 1.6]];
  function harnessHeadTail() {
    const pts = [[NIP[0], NIP[1], NUT_H0 + WIRED + 4], [NIP[0], NIP[1], NUT_H0], [NIP[0], NIP[1] - 0.5, NUT_H0 - 3], [NIP[0] - 4.5, -7.5, ZB + 4.4], [16, -10.6, ZB + 3.4], HEAD_RIBBON[0]].map(H);
    const tube = bundleOf(pts, bundleR, { radius: 4, xrayFrom: 1 });
    const ribbon = ribbonOf(HEAD_RIBBON.map(H), WIRES, HZ);
    return { svg: clipped(`${EVERYWHERE}${nipHeadBore}`, tube, { withLine: "niphead", evenodd: true }) + ribbon.svg, ends: ribbon.ends };
  }
  const headTail = harnessHeadTail();
  const headTailHidden = take("harness"); // placed later (it paints over the bonnet), at the harness step
  // Wires 1-3 to the 5 V rail, 4, 7 and 9 to GND, 5 and 6 to the amp's speaker pads, 8 to GPIO10 (pin 19), 10 to
  // GPIO23 (pin 16). The ribbon's first wire is at the back.
  const AMP_PLAN = box(PI_MID[0], PI_MID[1], AMP_L, AMP_W, 0.6), AMP_TOP = AMP_Z + EST.board;
  const AMP_SPK = [-1, 1].map((s) => [AMP_PLAN.x + AMP_PLAN.w - 2.6, PI_MID[1] + s * 2.5, AMP_TOP]);
  function headWiring() {
    const out = [];
    const targets = [[-6, RAIL_5V], [-8.54, RAIL_5V], [-11.08, RAIL_5V], [-4.5, RAIL_GND], AMP_SPK[0], AMP_SPK[1], [-7.04, RAIL_GND], pinPad(19), [-9.58, RAIL_GND], pinPad(16)];
    headTail.ends.forEach((end, j) => {
      const [x, y, z = ZB] = targets[j];
      const far = Math.hypot(x - -3, y - -11) > 8;
      out.push(fanOf([[end, H([x, y, z]), Hd([0, 0, far ? 3.2 : 1.4])]]));
    });
    // The left mic: a short bundle from its top edge back over the header to the SD end of the bonnet.
    const leftPads = MIC_PADS[0].map(H);
    const lStart = H([MIC_XS[0], IY - MIC_T - 3.6, MIC_PAD_Z - 0.6]), lEnd = H([-44, 2.6, ZB + 2.8]);
    // Short and seen nearly end-on, it is left out of the x-ray, where it read as a stray ring on the head's top.
    out.push(bundleOf([lStart, H([MIC_XS[0] - 2, 10, MIC_PAD_Z - 1.4]), H([-41, 5.2, ZB + 4.6]), lEnd], WIRE_OD * Math.sqrt(6 / 0.75) / 2, { radius: 4, xray: false }));
    out.push(fanOf(leftPads.map((pad) => [lStart, pad, Hd([0, 0.6, 1.2])])));
    out.push(fanOf(Array.from({ length: 6 }, (_, i) => [lEnd, H([-50.5 + i * EST.pitch, 0.25, ZB]), Hd([0, 0, 1.2])])));
    // The camera end: the toggle's six lugs, the right mic and the two LEDs dress into one bundle that runs along the
    // front, over the camera cable, to the bonnet's other end.
    const cR = WIRE_OD * Math.sqrt(15 / 0.75) / 2;
    const cStart = H([LUG_X - 2.4, 2, TOG_Z]), cEnd = H([7.4, 2.6, ZB + 3.4]);
    const cRoute = [cStart, H([LUG_X - 4.4, 6, TOG_Z + 0.4]), H([30, 10.2, 25.8]), H([14, 10.2, 25.4]), H([8.8, 6, ZB + 4.4]), cEnd];
    out.push(bundleOf(cRoute, cR, { radius: 4 }));
    out.push(fanOf(TOG_LUGS.map((lug) => [cStart, H(lug), Hd([0.8, 0, 0])]), { lift: 0 }));
    out.push(fanOf(MIC_PADS[1].map((pad) => [H([pad[0], 10.2 + cR - 0.6, 25.8 + 1]), H(pad), Hd([0, 0, 1.4])])));
    const [[gCath], [rCath, rAnode]] = LED_LEGS;
    out.push(fanOf([[H([33, 9.8, 25.8]), H(gCath), Hd([0, 0, 1])], [H([31, 10.4, 26.2]), H([LED_LEGS[0][1][0], R_LED, LED_Z]), Hd([0, -0.6, 1.4])], [H([32, 10.4, 26]), H(rCath), Hd([0, 0, 1])]]));
    // The mute LED's resistor goes to the toggle's throw B on pole 1.
    out.push(fanOf([[H([rAnode[0], R_LED, LED_Z]), H(TOG_LUGS[4]), Hd([0, 0, 1.2])]]));
    out.push(fanOf(Array.from({ length: 15 }, (_, i) => [cEnd, H([4.4 + (i % 3) * EST.pitch, 7.6 - Math.floor(i / 3) * EST.pitch, ZB]), Hd([0, 0, 1])])));
    return out.join("");
  }
  // The LED resistors, in-line on the anode legs in heat-shrink: two 220 ohm in parallel for the camera light, one for
  // the mute light.
  function ledResistors() {
    const [[, gAnode], [, rAnode]] = LED_LEGS;
    const along = (x, dx = 0) => resistorAlong(H([x + dx, gAnode[1], LED_Z + (dx ? 0.3 : 0)]), H([x + dx, R_LED, LED_Z + (dx ? 0.3 : 0)]), { line: "r220" });
    const bridge = (y) => L(hPath([[gAnode[0], y, LED_Z], [gAnode[0] + 2.8, y, LED_Z + 0.3]], false), { tone: "mid" });
    return along(gAnode[0]) + along(gAnode[0], 2.8) + bridge(gAnode[1]) + bridge(R_LED) + along(rAnode[0]);
  }
  // The bonnet, the wires soldered to it (the ones to pins under the amp go under it), the amp on its foam, the
  // resistors, and the harness's joined end lying over its wires.
  part("bonnet", bonnet(), { step: STEP.bonnet, lift: LIFT.wired });
  part("harness", headWiring(), { step: STEP.bonnet, lift: LIFT.wired }); // the second ribbon, peeled into jumpers
  part("amp", amp(), { step: STEP.bonnet, lift: LIFT.wired });
  part("r1k", R1K.map(([a, b]) => resistorAlong(a, b, { line: "r1k" })).join(""), { step: STEP.bonnet, lift: LIFT.wired, count: 2 });
  part("harness", headTail.svg, { step: STEP.harness, lift: LIFT.wired, count: 0 }, headTailHidden);
  part("r220", ledResistors(), { step: STEP.headParts, lift: LIFT.wired, count: 3 });
  for (const x of MIC_XS) part("mic", mic(x), { step: STEP.headParts, lift: LIFT.wired });

  // ---- 13 the head nut and the inserts in the upper shell ------------------------------------------------------------
  part("nut", hexNut(NIP[0], NIP[1], NUT_H0, NUT_T, { line: "nut", frame: true }), { step: STEP.arm, lift: LIFT.headNut });
  for (const [x, y] of byDepth(HEAD_BOSSES, (q) => H([...q, SPLIT])))
    part("ins3", insertOf(G.frameOf(H([x, y, SPLIT]), HZ, HX, HY), INS3.outerMm / 2, INS3.lengthMm, "ins3"), { step: STEP.inserts, lift: LIFT.headInserts });
  part("niphead", nippleOf(FZ(NIP[0], NIP[1]), NUT_H0, NUT_H0 + p.headNippleLengthMm, "niphead"), { step: STEP.arm });

  // ---- 14 the head upper shell ----------------------------------------------------------------------------------------
  function upper() {
    const f = p.headTopFilletMm;
    const levels = [[0, SPLIT], [0, HH - f], ...ARC(8).map((deg) => [f * (1 - Math.cos(rad(deg))), HH - f + f * Math.sin(rad(deg))]), [f, HH]];
    const shell = hide("headtop", loft(levels.map(([inset, z]) => hRing(k.insetPlan(HEAD_PLAN, inset), z, 10))));
    fig.under(`<g data-a2-with="headbot" data-a2-until="headtop">${L(shell.outline, { tone: "faint", dashed: true })}</g>`);
    // On the front face: the two mic ports and the two LED holes; on the camera end: the toggle hole and MUTE.
    const front = HD / 2;
    const ports = MIC_XS.map((x) => {
      const pts = circle(x, MIC_Z, p.micPortMm / 2, 16).map(([a, b]) => [a, front, b]);
      return hVoid(pts) + L(hPath(pts), { tone: "lo" });
    }).join("");
    const ledHoles = [LED_GREEN_X, LED_RED_X].map((x) => L(hPath(circle(x, LED_Z, p.ledHoleMm / 2, 28).map(([a, b]) => [a, front, b])), { tone: "lo" }) + hVoid(circle(x, LED_Z, p.ledHoleMm / 2, 28).map(([a, b]) => [a, front, b]), 0)).join("");
    const togHole = circle(TOG_Y, TOG_Z, p.muteToggleHoleMm / 2, 28).map(([a, b]) => [HL / 2, a, b]);
    // MUTE, engraved under the toggle hole and clear of its nut, reading along +y on the end face, as
    // cad/head-upper.py cuts it: centred at labelZ, its capitals about 0.72 of the text height.
    const labelZ = TOG_Z - p.muteToggleHoleMm / 2 - p.muteLabelGapMm - p.muteLabelHeightMm / 2;
    const o = hAt([HL / 2, TOG_Y, labelZ - 0.36 * p.muteLabelHeightMm]);
    const ex = G.sub3(H([HL / 2, 1, 0]), H([HL / 2, 0, 0])), ez = G.sub3(H([HL / 2, 0, 1]), H([HL / 2, 0, 0]));
    const u = at(G.add3(H([HL / 2, 0, 0]), ex)), u0 = at(H([HL / 2, 0, 0])), w = at(G.add3(H([HL / 2, 0, 0]), ez));
    const e1 = [u[0] - u0[0], u[1] - u0[1]], e2 = [w[0] - u0[0], w[1] - u0[1]];
    const label = k.faceTextSvg(`matrix(${e1[0].toFixed(4)} ${e1[1].toFixed(4)} ${(-e2[0]).toFixed(4)} ${(-e2[1]).toFixed(4)} ${o[0].toFixed(2)} ${o[1].toFixed(2)})`, "MUTE", { size: p.muteLabelHeightMm, tone: "lo", anchor: "middle" });
    return S(shell, { tone: "mid", inner: ports + ledHoles + hVoid(togHole) + L(hPath(togHole), { tone: "lo" }) + label });
  }
  const UPPER_SILHOUETTE = path(G.hullOf([...headBox([0, 0, 0], SPLIT, HH)].map(at)));
  // The head upper goes on at the step that closes the head, for the same reason.
  part("headtop", upper(), { step: STEP.closeHead });

  // ---- 15 the LEDs and the toggle, in their holes in the upper shell -----------------------------------------------
  const inUpperHole = (pts, dir) => [
    { d: `${EVERYWHERE}${UPPER_SILHOUETTE}`, withLine: "headtop", evenodd: true },
    { d: sweep(pts.map(H), dir), withLine: "headtop" },
    { d: EVERYWHERE, withLine: "headtop", until: "headtop" },
  ];
  function led(x, line) {
    const F = FY(x, LED_Z);
    const tip = HD / 2 + LED_OUT, r = p.ledHoleMm / 2 - 0.05;
    const s0 = LED_BACK;
    const body = hide(line, G.solidOf([[s0, EST.ledFlange / 2], [s0 + EST.ledFlangeT, EST.ledFlange / 2], [s0 + EST.ledFlangeT, r], [tip - r, r, 1], [tip - r * 0.45, r * 0.85, 1], [tip, 0]], F, P));
    // Its two legs, cut short where the wires and the in-line resistors take over, and the flange behind the wall.
    const legs = [-1, 1].map((s) => S(hide(line, G.disc(s0 - 2.4, s0 + 0.01, EST.ledLeg / 2, FY(x + (s * EST.pitch) / 2, LED_Z), P)), { tone: "mid" })).join("");
    const rims = L(G.arcOf(F, s0 + EST.ledFlangeT, EST.ledFlange / 2, P) + G.arcOf(F, s0 + EST.ledFlangeT, r, P), { tone: "lo" });
    return clippedTo(inUpperHole(circle(x, LED_Z, p.ledHoleMm / 2, 24).map(([a, b]) => [a, HD / 2, b]), HY), legs + S(body, { tone: "mid", inner: rims + L(G.arcOf(F, s0 + EST.ledFlangeT + 0.6, r, P), { tone: "faint" }) }));
  }
  function toggle() {
    const out = HL / 2;
    const zc = TOG_Z, yc = TOG_Y;
    const bodyX1 = IX - 2, bodyX0 = bodyX1 - TOG_BL;
    const body = hide("mute", hBox(bodyX0, bodyX1, yc - TOG_BW / 2, yc + TOG_BW / 2, zc - TOG_BH / 2, zc + TOG_BH / 2));
    const lugs = TOG_LUGS.map(([x, y, z]) => S(hBox(x - EST.togLug[1] / 2, bodyX0, y - EST.togLug[0] / 2, y + EST.togLug[0] / 2, z - EST.togLug[1] / 2, z + EST.togLug[1] / 2), { tone: "mid" })).join("");
    const Fx = FX(yc, zc);
    const inner = G.disc(bodyX1, IX, EST.togCollar / 2, Fx, P);
    const bushing = G.disc(IX, out + EST.toggleNut.t + EST.togThread, Number(spec("mute").holeMm) / 2, Fx, P);
    const nutPts = hex(yc, zc, EST.toggleNut.af, 0).map(([a, b]) => [a, b]);
    const nut = loft([nutPts.map(([a, b]) => H([out, a, b])), nutPts.map(([a, b]) => H([out + EST.toggleNut.t, a, b]))]);
    // Drawn at its MUTE throw: down, toward the word (assembly step 16). A miniature toggle throws about 20 degrees.
    const leverDir = G.unit3(Hd([Math.cos(rad(20)), 0, -Math.sin(rad(20))]));
    const leverBase = H([out + EST.toggleNut.t + EST.togThread, yc, zc]);
    const lever = G.solidOf([[0, EST.lever / 2 * 0.8], [Number(spec("mute").actuatorMm) - 1.2, EST.lever / 2 * 0.62, 1], [Number(spec("mute").actuatorMm) - 0.5, EST.lever / 2 * 0.6, 1], [Number(spec("mute").actuatorMm), 0]], G.frameAlong(leverBase, leverDir), P);
    hide("mute", bushing, nut, lever);
    const threads = [];
    for (let s = out + EST.toggleNut.t + 0.3; s < out + EST.toggleNut.t + EST.togThread - 0.1; s += 0.5) threads.push(G.arcOf(Fx, s, Number(spec("mute").holeMm) / 2, P));
    return clippedTo(inUpperHole(circle(yc, zc, p.muteToggleHoleMm / 2, 24).map(([a, b]) => [out, a, b]), HX),
      lugs + S(body, { tone: "hi" }) + S(inner, { tone: "mid" }) + S(bushing, { tone: "mid", inner: L(threads.join(""), { tone: "faint" }) }) + S(nut, { tone: "mid" }) + S(lever, { tone: "hi" }));
  }
  part("mute", toggle(), { step: STEP.headParts, lift: LIFT.wired });
  part("ledmute", led(LED_RED_X, "ledmute"), { step: STEP.headParts, lift: LIFT.wired });
  part("ledcam", led(LED_GREEN_X, "ledcam"), { step: STEP.headParts, lift: LIFT.wired });

  // ---- 16 the head coupling ---------------------------------------------------------------------------------------------
  part("coupling", couplingOf(FZ(NIP[0], NIP[1]), HH), { step: STEP.arm });

  // ---- 17 the gooseneck ----------------------------------------------------------------------------------------------------
  function gooseneck() {
    const ferrules = [
      G.disc(0, OUT_B + 0.01, ARM_R, G.frameAlong(S0, [0, 0, 1]), P),
      G.disc(0, OUT_H + 0.01, ARM_R, G.frameAlong(E0, HZ), P),
    ];
    const pieces = T.tubePieces(route.pts, ARM_R, P, { spacing: 2.2 * px, maxLength: 24 * px, rings: { pitch: EST.corrugation, fade: [0.08, 0.6], tone: "lo" } });
    hide("arm", ...ferrules, ...pieces.map((piece) => ({ fill: piece.body, outline: piece.edges })));
    return ferrules.map((f) => S(f, { tone: "mid" })).join("") + byDepth(pieces, (piece) => piece.mid).map((piece) => T.tubeSvg(piece, { tone: "mid" })).join("");
  }
  part("arm", `<g data-a2-dark>${gooseneck()}</g>`, { step: STEP.arm }); // matte black, as the BOM says

  // ---- what the shells hide, seen through them: after the gooseneck, which the harness runs through --------------------------------------------------
  // Per step where a line's pieces are hidden by different shells at different steps: the arm run of the harness is
  // inside the gooseneck from step 5, its base wiring only under the base top, its head wiring only under the head
  // upper (in the steps before those shells go on, those pieces are in plain sight).
  const XRAY_BY_STEP = {
    harness: { [STEP.harness]: ["basetop", "headtop", "arm"], [STEP.junction]: ["basetop"], [STEP.bonnet]: ["headtop"] },
    scr3: { [STEP.closeHead]: ["headbot"], [STEP.closeBase]: ["basebot"] },
    nut: { [STEP.arm]: ["headtop"], [STEP.discs]: ["basetop"] },
    r220: { [STEP.headParts]: ["headtop"], [STEP.junction]: ["basetop"] },
  };
  const XRAY_BY = {
    feet: ["basebot"], scr3: ["basebot", "headbot"], ins3: ["basetop", "headtop"], ins25: ["headtop", "headbot"], scr25: ["headtop", "headbot"], nipbase: ["basetop"], niphead: ["headtop"],
    nut: ["basetop", "headtop"], ballast: ["basetop"], spk: ["basetop"], junction: ["basetop"], diode: ["basetop"], r220: ["basetop", "headtop"],
    r1k: ["headtop", "headbot"], usbc: ["basetop"], stick: ["basetop"], harness: ["basetop", "headtop", "arm"], talk: ["basetop"], diffuser: ["basetop"],
    pi: ["headtop", "headbot"], sd: ["headtop", "headbot"], cam: ["headtop", "headbot"], camcable: ["headtop", "headbot"], bonnet: ["headtop", "headbot"], amp: ["headtop", "headbot"], mic: ["headtop"],
    shutter: ["headtop", "headbot"], mute: ["headtop"], ledcam: ["headtop"], ledmute: ["headtop"],
  };
  for (const [line, by] of Object.entries(XRAY_BY))
    for (const [step, solids] of Object.entries(xray[line] ?? {}))
      if (solids.length) fig.xray(line, xrayOf(solids), { by: XRAY_BY_STEP[line]?.[step] ?? by, step: Number(step) });

  // ---- not drawn ------------------------------------------------------------------------------------------------------------
  fig.hidden("psu", "The wall supply is not built in: it plugs into the USB-C socket in the base's back wall and goes in the box with the unit");
  fig.hidden("wire22", "Cut from a hook-up wire spool (one set does the batch): the two 120 mm USB-C power wires in the base and the amp's 5 V and GND jumpers, inside the shells");

  fig.step(STEP.prints, "Check the prints");
  fig.step(STEP.inserts, "Press in the 14 heat-set inserts");
  fig.step(STEP.headParts, "Fit the LEDs, toggle and mics");
  fig.step(STEP.arm, "Screw the arm together");
  fig.step(STEP.harness, "Pull the harness through the arm");
  fig.step(STEP.shutter, "Slide the shutter into its track");
  fig.step(STEP.camera, "Seat the camera on its pins");
  fig.step(STEP.pi, "SD card in, screw the Pi down");
  fig.step(STEP.baseParts, "Fit button, speaker, light bar");
  fig.step(STEP.discs, "Thread the discs and nut on");
  fig.step(STEP.junction, "Wire the junction board, fit it");
  fig.step(STEP.usbc, "Glue the USB-C board in");
  fig.step(STEP.bonnet, "Bonnet onto the Pi, amp on top");
  fig.step(STEP.closeHead, "Close the head with 4 screws");
  fig.step(STEP.closeBase, "Close the base, then the feet");

  return {
    title: "Ponder",
    caption: "A Raspberry Pi Zero 2 W in a printed head pod looks down at the page through a Camera Module 3 Wide and listens "
      + `with two I2S mics; a ${Math.round(p.armLengthMm / 25.4)} in gooseneck holds the head over the page from a weighted base `
      + "that carries the speaker, the talk button and the light bar.",
  };
}
