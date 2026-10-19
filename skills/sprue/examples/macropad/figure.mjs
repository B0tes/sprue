// The 3x3 macro keypad, drawn for the person who will buy its parts and build it.
// World: millimetres, origin at the PCB centre on its top face, x toward the USB end, y toward the Pico, z up:
// the frame of cad/_params.py. Every size comes from design.json params or a BOM line's spec, so an edit to the key
// grid, the pitch, the case or a part redraws the figure along with the CAD. Run `sprue figure macropad`.
//
// Paint order is call order: under the tray first (feet, screws), then the tray, the sockets, the PCB, the Pico,
// the inserts, the top, the switches and keycaps key by key from far to near, the x-ray outlines of what the case
// and the keys hide, and the cable. Two parts pass through another one, and a clip that stays with that part
// (data-a2-with) hides what is inside it in every pose: a switch's lower housing and pins below the plate, and the
// plug behind the wall beside the USB opening. The x-rays come after everything they see through and before the
// cable, which lies in front of the Pico's end.

export default function draw({ k, G, T, fig, params: p, bom, spec }) {
  const SW = spec("sw"), CAP = spec("cap"), SOCK = spec("sock"), PI = spec("ctrl"), SCR = spec("scr");
  const FOOT = spec("feet"), INS = spec("ins"), CORD = spec("cable"), BOARD = spec("pcb");

  // ---- the product's numbers -------------------------------------------------------------------------------
  const W = p.pcbWidthMm, H = p.pcbHeightMm, pitch = p.keyPitchMm;
  const PCB = { x: -W / 2, y: -H / 2, w: W, d: H, r: p.pcbCornerMm };
  const grow = (plan, by, r) => ({ x: plan.x - by, y: plan.y - by, w: plan.w + 2 * by, d: plan.d + 2 * by, r });
  const INNER = grow(PCB, p.caseClearanceMm, p.caseCornerMm - p.caseWallMm / 2); // as cad/top.py and bottom.py
  const CASE = grow(INNER, p.caseWallMm, p.caseCornerMm);
  const Z = {};
  Z.pcbBot = -p.pcbThicknessMm;
  Z.plateTop = p.plateTopToPcbTopMm;
  Z.plateBot = Z.plateTop - p.plateThicknessMm;
  Z.skin = Z.plateTop - p.lidSkinOverControllerMm; // the plate is thinned to this over the Pico
  Z.trayTop = Z.pcbBot;
  Z.floor = Z.trayTop - p.standoffHeightMm;
  Z.trayBot = Z.floor - p.trayFloorMm;
  Z.desk = Z.trayBot - FOOT.heightMm;
  Z.sockBot = Z.pcbBot - p.socketHeightMm;
  Z.board = PI.boardMm;
  Z.usbTop = p.controllerHeightAbovePcbMm;
  Z.swTop = Z.plateTop + SW.abovePlateMm;
  Z.stemTop = Z.swTop + SW.stemMm;
  Z.capBot = Z.plateTop + p.capSkirtAbovePlateMm;
  Z.capTop = Z.capBot + CAP.heightMm;
  Z.headTop = Z.trayBot + p.screwHeadHeightMm; // button heads sit in counterbores, flush with the floor
  Z.tip = Z.headTop + p.screwLengthMm;

  const keys = [];
  for (let r = 0; r < p.keyRows; r++)
    for (let c = 0; c < p.keyCols; c++)
      keys.push([(c - (p.keyCols - 1) / 2) * pitch, PCB.y + p.pcbEdgeToKeyMm + pitch * (r + 0.5)]);
  const holes = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * (W / 2 - p.holeInsetMm), sy * (H / 2 - p.holeInsetMm)]));
  const feet = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [sx * p.footCentreXMm, sy * p.footCentreYMm]));
  const PICO = { x: p.controllerCenterXMm - p.controllerLengthMm / 2, y: p.controllerCenterYMm - p.controllerWidthMm / 2, w: p.controllerLengthMm, d: p.controllerWidthMm };
  // The USB opening (cad/top.py): a box one wall plus 1 mm wide through the +x wall, centred on the connector,
  // which reaches past the shell at both ends, so it is a notch through the wall's whole height.
  const X1 = CASE.x + CASE.w;
  const NOTCH = { x0: X1 - p.caseWallMm - 0.5, x1: X1, y0: p.controllerCenterYMm - p.usbOpeningWidthMm / 2, y1: p.controllerCenterYMm + p.usbOpeningWidthMm / 2 };
  if (p.usbOpeningZMm - p.usbOpeningHeightMm / 2 > Z.pcbBot || p.usbOpeningZMm + p.usbOpeningHeightMm / 2 < Z.plateTop)
    throw new Error("figure.mjs draws the USB opening as a notch through the wall's whole height; this one is a window now");
  const PORT = [PICO.x + PICO.w, p.controllerCenterYMm, (Z.board + Z.usbTop) / 2]; // the Pico's micro-B mouth
  const USB = { x: PICO.x + PICO.w - PI.usbDepthMm, y: p.controllerCenterYMm - PI.usbWidthMm / 2, w: PI.usbDepthMm, d: PI.usbWidthMm, r: 0.4 };

  // ---- apart: each layer comes off along its way in, just clear of the one it meets ----------------------------
  const AIR = 9;
  const UP = { pcb: 0, ctrl: AIR, sock: -AIR };
  // The sockets go on under the board, where nothing can see them; apart they also slide out toward you, far enough
  // that the near row clears the board's edge and shows what a socket is.
  const SLIDE = 24;
  UP.ins = UP.ctrl + Z.usbTop + AIR; // the inserts hang under the top's bosses, above the Pico's height
  UP.top = UP.ins + INS.lengthMm + AIR;
  UP.sw = UP.top + Z.plateTop + AIR; // switches clear of the plate
  UP.cap = UP.sw + (Z.stemTop - Z.capBot) + AIR; // keycaps clear of the stems
  UP.bot = UP.sock - p.socketHeightMm - AIR; // the tray below the sockets
  UP.scr = UP.bot + Z.trayBot - Z.tip - AIR / 2; // screws out of the tray, from below
  UP.feet = UP.scr - AIR / 2;
  const PULL = 3 * AIR; // the cable slides out along +x, at the height of the lifted Pico's socket
  const rise = (dz) => [0, 0, dz];

  // ---- camera ------------------------------------------------------------------------------------------------
  // The cord: out of the strain relief, down to the desk in one long bend, round toward you and into the USB-A plug,
  // which lies flat on the desk. Few waypoints and wide fillets, so it reads as a soft cord, not a chain of straights.
  const CORD_R = CORD.diameterMm / 2;
  const A_BODY_H = CORD.aShellHeightMm + 3.2; // the USB-A moulding round its shell (typed in: a typical cable's)
  const A_Z = Z.desk + A_BODY_H / 2; // the plug's axis, so its body rests on the desk
  const out = PORT[0] + CORD.plugLengthMm + 8; // the end of the strain relief
  const route = [
    [out + 12, PORT[1], PORT[2] - 1],
    [out + 26, PORT[1] - 16, Z.desk + CORD_R],
    [out + 22, PORT[1] - 58, Z.desk + CORD_R],
    [out + 8, PORT[1] - 76, A_Z],
  ];
  fig.size(640, 600);
  const socketsOut = k.boxCorners(PCB, Z.sockBot + UP.sock, Z.pcbBot + UP.sock).map(([x, y, z]) => [x, y - SLIDE, z]);
  const P = fig.camera([
    ...k.boxCorners(CASE, Z.desk + UP.feet, Z.capTop + UP.cap),
    ...k.boxCorners(CASE, Z.desk, Z.capTop),
    ...socketsOut,
    ...route.flatMap(([x, y, z]) => [[x, y, z - 2], [x + PULL, y, z - 2 + UP.ctrl], [x + 6, y - 14, z]]),
  ], { azimuth: -40, pad: 26 });
  const px = 1 / P.scale; // about one screen px in mm, along the floor

  // ---- drawing helpers (generic: copy them into another product's figure) -------------------------------------
  const V = G.viewOf(P), LIGHT = G.lightOf(P);
  const { sinA, cosA } = k.cameraOf(P);
  const at = (point) => k.iso(point, P);
  const path = (points, closed = true) => k.pathOf(points, closed);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const depth = ([x, y, z = 0]) => k.depthOf([x, y, z], P);
  const byDepth = (list, of = (item) => item) => [...list].sort((a, b) => depth(of(a)) - depth(of(b)));
  const facing = (n) => G.dot3(n, V) > 1e-6;
  /** The kit's shade (0-3) for an upright face with plan normal n, the same rule as k.extrude. */
  const shadeOf = ([nx, ny]) => {
    const length = Math.hypot(nx, ny) || 1;
    return Math.min(3, Math.max(0, Math.floor((((nx * -sinA + ny * cosA) / length + 1) / 2) * 4)));
  };
  const area2 = (points) => points.reduce((sum, [x, y], i) => sum + x * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * y, 0);
  /** Sutherland-Hodgman: the part of polygon `subject` inside convex polygon `clip` (both screen points). */
  function clipPoly(subject, clip) {
    let out = subject;
    const sign = Math.sign(area2(clip));
    for (let i = 0; i < clip.length && out.length; i++) {
      const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
      const side = ([x, y]) => sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax));
      const input = out;
      out = [];
      input.forEach((q, j) => {
        const r = input[(j + 1) % input.length], sq = side(q), sr = side(r);
        if (sq >= 0) out.push(q);
        if (sq * sr < 0) out.push([q[0] + ((r[0] - q[0]) * sq) / (sq - sr), q[1] + ((r[1] - q[1]) * sq) / (sq - sr)]);
      });
    }
    return out;
  }
  /** Cyrus-Beck: the part of segment p-q inside convex polygon `clip` (screen points), or null. */
  function clipSeg(p, q, clip) {
    let t0 = 0, t1 = 1;
    const sign = Math.sign(area2(clip)), d = [q[0] - p[0], q[1] - p[1]];
    for (let i = 0; i < clip.length; i++) {
      const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
      const at0 = sign * ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)), rate = sign * ((bx - ax) * d[1] - (by - ay) * d[0]);
      if (Math.abs(rate) < 1e-12) { if (at0 < 0) return null; continue; }
      if (rate > 0) t0 = Math.max(t0, -at0 / rate); else t1 = Math.min(t1, -at0 / rate);
      if (t1 - t0 < 1e-9) return null;
    }
    return [[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]];
  }
  /** Any convex solid from its faces ({ pts: world points, n: outward normal }): tones by the kit's light, the hull
   * as fill and outline, creases where two visible faces meet at an angle. Same paths as k.slabOf. */
  function faceted(faces, sharp = 0.45) {
    const buckets = [[], [], [], [], []];
    const flat = [];
    const seen = faces.map((face) => facing(face.n));
    faces.forEach((face, i) => {
      const screen = face.pts.map(at);
      flat.push(...screen);
      if (seen[i]) buckets[G.bandOf(G.dot3(G.unit3(face.n), LIGHT))].push(path(screen));
    });
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
    return { fill: hull, outline: hull, crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((list) => list.join("")) };
  }
  /** A tapered body between two rings with the same number of points (counter-clockwise): a keycap, a housing. */
  function loft(ringA, zA, ringB, zB) {
    const A = ringA.map(([x, y]) => [x, y, zA]), B = ringB.map(([x, y]) => [x, y, zB]);
    const faces = A.map((a, i) => {
      const j = (i + 1) % A.length;
      return { pts: [a, A[j], B[j], B[i]], n: G.cross3(G.sub3(A[j], a), G.sub3(B[i], a)) };
    });
    return faceted([...faces, { pts: B, n: [0, 0, 1] }, { pts: [...A].reverse(), n: [0, 0, -1] }]);
  }
  const square = (cx, cy, size, r) => ({ x: cx - size / 2, y: cy - size / 2, w: size, d: size, r });
  const box = (cx, cy, w, d, r) => ({ x: cx - w / 2, y: cy - d / 2, w, d, r });
  const ring = (plan, steps = 4) => k.roundedPlan(plan, steps);
  const rotated = (cx, cy, w, d, angle) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([u, v]) => [cx + u * Math.cos(angle) - v * Math.sin(angle), cy + u * Math.sin(angle) + v * Math.cos(angle)]);
  /** A hole seen from above: the dark bore and its rim. */
  const voidOf = (d) => `<path class="iso-shade" data-shade="0" d="${d}"/>`;
  const bore = (x, y, r, z, tone = "lo") => voidOf(k.ring(x, y, r, z, P, 20)) + L(k.ring(x, y, r, z, P, 20), { tone });
  /** The parts other parts hide, by BOM line: fig.xray draws their outline (dashed) and a faint fill of their body. */
  const xray = {};
  const hide = (line, ...solids) => { (xray[line] ??= []).push(...solids); };
  const xrayOf = (line) => `<path class="a2-ghost" d="${(xray[line] ?? []).map((solid) => solid.fill).join("")}"/>`
    + L((xray[line] ?? []).map((solid) => solid.outline).join(""), { tone: "lit", dashed: true });
  let clips = 0;
  /** Draw `content` only inside screen polygon `poly`. `withLine` keeps the clip where that BOM line's part is. */
  function clipped(poly, content, { withLine, evenodd = false } = {}) {
    const id = `a2-${bom.slug}-clip-${clips++}`;
    return `<clipPath id="${id}"><path${withLine ? ` data-a2-with="${withLine}"` : ""}${evenodd ? ' clip-rule="evenodd"' : ""} d="${poly}"/></clipPath><g clip-path="url(#${id})">${content}</g>`;
  }
  /** The screen region above a plan on a plane: what you can see of a part through an opening in that plane. */
  const column = (points, z, height = 400) => path(G.hullOf([...points.map(([x, y]) => at([x, y, z])), ...points.map(([x, y]) => at([x, y, z + height]))]));

  // The product's shadow on the desk goes with the tray, and the PCB has its own for the steps before the tray.
  fig.under(`<path class="iso-halo" data-a2-with="pcb" data-a2-until="bot" d="${k.haloOf(PCB, Z.pcbBot - 2, 2, P)}"/>`);
  fig.under(`<path class="iso-halo" data-a2-with="bot" d="${k.haloOf(CASE, Z.desk, Z.trayBot - Z.desk, P)}"/>`);

  // ---- 1 feet and screws, under the tray -----------------------------------------------------------------------
  const footR = FOOT.diameterMm / 2;
  const footProfile = [[0, footR], [FOOT.heightMm * 0.45, footR * 0.97, 1], [FOOT.heightMm * 0.8, footR * 0.82, 1], [FOOT.heightMm, footR * 0.5]];
  const footOf = ([x, y]) => {
    const foot = G.solidOf(footProfile, G.frameAlong([x, y, Z.trayBot], [0, 0, -1]), P);
    hide("feet", foot);
    return S(foot, { tone: "lo" });
  };
  const shankR = SCR.diameterMm / 2;
  function screwOf([x, y]) {
    const headPaths = k.cylinder(x, y, SCR.headMm / 2, Z.trayBot, p.screwHeadHeightMm, P, 28, 0.5 * px);
    const shankPaths = k.cylinder(x, y, shankR, Z.headTop, Z.tip - Z.headTop - 0.4, P, 20);
    hide("scr", headPaths, shankPaths);
    const head = S(headPaths, { tone: "mid" });
    const threads = [];
    for (let z = Z.headTop + 1.2; z < Z.tip - 0.6; z += 0.7) threads.push(k.sideArc(x, y, shankR, z, P, 14));
    const shank = S(shankPaths, { tone: "mid", inner: L(threads.join(""), { tone: "faint" }) });
    const tip = S(k.extrude(k.circleRing(x, y, shankR, 20), Z.tip - 0.4, 0.4, P), { tone: "mid" });
    return head + shank + tip + L(k.ring(x, y, shankR * 0.7, Z.tip, P, 16), { tone: "faint" });
  }
  for (const item of byDepth([...feet.map((at) => ({ at, foot: true })), ...holes.map((at) => ({ at }))], (item) => item.at)) {
    if (item.foot) fig.part("feet", footOf(item.at), { step: 7, lift: rise(UP.feet) });
    else fig.part("scr", screwOf(item.at), { step: 6, lift: rise(UP.scr) });
  }

  // ---- 2 the tray: walls, floor and standoffs ------------------------------------------------------------------
  function tray() {
    const body = S(k.slabOf(CASE, Z.trayBot, Z.trayTop - Z.trayBot, P, 8, 0.8 * px), { tone: "lo" });
    const lip = ring(INNER, 6);
    const open = lip.map(([x, y]) => at([x, y, Z.trayTop]));
    const inside = [`<path class="iso-shade" data-shade="1" d="${k.onTop(lip, Z.floor, P, true)}"/>`];
    // The far walls face you through the opening; where they meet the floor, a seam. (k.ringSeam draws the near
    // side of a ring, which here is hidden under the rim, so the seam is built from the same walls as the shades.)
    const runs = [];
    let run = null;
    lip.forEach(([ax, ay], i) => {
      const [bx, by] = lip[(i + 1) % lip.length];
      const n = [-(by - ay), bx - ax]; // the inner wall faces into the tray
      if (!facing([...n, 0])) { run = null; return; }
      inside.push(`<path class="iso-shade" data-shade="${shadeOf(n)}" d="${path([at([ax, ay, Z.trayTop]), at([bx, by, Z.trayTop]), at([bx, by, Z.floor]), at([ax, ay, Z.floor])])}"/>`);
      if (!run) runs.push((run = [at([ax, ay, Z.floor])]));
      run.push(at([bx, by, Z.floor]));
    });
    // A run that wraps past the ring's first point joins up with the first run.
    if (runs.length > 1 && run && facing([-(lip[1][1] - lip[0][1]), lip[1][0] - lip[0][0], 0])) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
    inside.push(L(runs.map((points) => path(points, false)).join(""), { tone: "faint" }));
    for (const [x, y] of byDepth(holes))
      inside.push(S(k.cylinder(x, y, p.standoffOuterMm / 2, Z.floor, Z.trayTop - Z.floor, P, 28), { tone: "lo" }) + bore(x, y, p.screwClearanceMm / 2, Z.trayTop));
    return body + clipped(path(open), inside.join("")) + L(path(open), { tone: "lo" });
  }
  fig.part("bot", tray(), { step: 6, lift: rise(UP.bot) });

  // ---- 3 the hot-swap sockets, under the PCB --------------------------------------------------------------------
  const pin1 = [SW.pin1XMm, SW.pin1YMm], pin2 = [SW.pin2XMm, SW.pin2YMm];
  function socketOf([kx, ky]) {
    // Two lobes, one round each switch pin, stepped like the Kailh body; a solder tab at each end.
    const cx = kx + (pin1[0] + pin2[0]) / 2, cy = ky + (pin1[1] + pin2[1]) / 2;
    const x0 = cx - SOCK.lengthMm / 2, x1 = cx + SOCK.lengthMm / 2, y0 = cy - SOCK.widthMm / 2, y1 = cy + SOCK.widthMm / 2;
    const lobeW = SOCK.lengthMm * 0.58, lobeD = SOCK.widthMm * 0.62;
    const outline = [[x0, y0], [x0 + lobeW, y0], [x0 + lobeW, y1 - lobeD], [x1, y1 - lobeD], [x1, y1], [x1 - lobeW, y1], [x1 - lobeW, y0 + lobeD], [x0, y0 + lobeD]];
    const bodyPaths = k.extrude(outline, Z.sockBot, p.socketHeightMm, P, { convex: false });
    hide("sock", bodyPaths);
    const body = S(bodyPaths, { tone: "lo" });
    const tabD = lobeD * 0.55, tabL = (SOCK.lengthMm - SOCK.lengthMm * 0.58) * 0.45;
    const tabs = [
      { x: x0 - tabL, y: y0 + (lobeD - tabD) / 2, w: tabL + 0.2, d: tabD, r: 0.2 },
      { x: x1 - 0.2, y: y1 - lobeD + (lobeD - tabD) / 2, w: tabL + 0.2, d: tabD, r: 0.2 },
    ].map((plan) => ({ plan, svg: S(k.slabOf(plan, Z.pcbBot - 0.3, 0.3, P, 2), { tone: "mid" }) }));
    const barrels = [pin1, pin2].map(([dx, dy]) => bore(kx + dx, ky + dy, SOCK.holeMm / 2 * 0.62, Z.pcbBot) + L(k.ring(kx + dx, ky + dy, SOCK.holeMm / 2, Z.pcbBot, P, 20), { tone: "faint" }));
    const [far, near] = byDepth(tabs, (t) => [t.plan.x + t.plan.w / 2, t.plan.y + t.plan.d / 2]);
    return far.svg + body + near.svg + barrels.join("");
  }
  for (const key of byDepth(keys)) fig.part("sock", socketOf(key), { step: 2, lift: [0, -SLIDE, UP.sock] });

  // ---- 4 the PCB: footprints for the switches and the Pico, the four mounting holes ------------------------------
  function pcb() {
    const marks = [];
    for (const [x, y] of keys) {
      marks.push(L(k.planOutline(square(x, y, p.plateCutoutMm, 0.3), 0, P, 2), { tone: "faint" })); // silkscreen
      marks.push(bore(x, y, SW.centreHoleMm / 2, 0));
      for (const sx of [-1, 1]) marks.push(bore(x + (sx * SW.pegPitchMm) / 2, y, SW.pegHoleMm / 2, 0, "faint"));
      for (const [dx, dy] of [pin1, pin2]) marks.push(L(k.ring(x + dx, y + dy, SOCK.holeMm / 2 + 0.45, 0, P, 20), { tone: "lo" }) + bore(x + dx, y + dy, SOCK.holeMm / 2, 0));
    }
    // The Pico's castellated pads: rows along both long edges, reaching past the module so an iron can get at them.
    const first = (PICO.w - (PI.padsPerSide - 1) * PI.padPitchMm) / 2;
    for (let i = 0; i < PI.padsPerSide; i++)
      for (const [edge, dir] of [[PICO.y, -1], [PICO.y + PICO.d, 1]])
        marks.push(L(k.planOutline(box(PICO.x + first + i * PI.padPitchMm, edge + dir * 0.3, PI.padPitchMm * 0.6, 2.4, 0.3), 0, P, 2), { tone: "lo" }));
    for (const [x, y] of holes) marks.push(L(k.ring(x, y, BOARD.holeMm / 2 + 1.2, 0, P, 28), { tone: "faint" }) + bore(x, y, BOARD.holeMm / 2, 0));
    // A silkscreen title block beside the Pico (three printed rule lines).
    const label = { x: PCB.x + 3, y: PICO.y + 2, w: PICO.x - PCB.x - 6, d: PICO.d - 4, r: 0.4 };
    marks.push(L(k.planOutline(label, 0, P, 2), { tone: "faint" }));
    marks.push(L([0.3, 0.55, 0.8].map((t, i) => k.lineOnTop([label.x + label.w * t, label.y + 2], [label.x + label.w * t, label.y + label.d - 2 - i * 3], 0, P)).join(""), { tone: "faint", free: true }));
    const board = k.slabOf(PCB, Z.pcbBot, p.pcbThicknessMm, P, 3, 0.6 * px);
    hide("pcb", board);
    return S(board, { tone: "mid" }) + marks.join("");
  }
  fig.part("pcb", pcb(), { step: 1, lift: rise(UP.pcb) });

  // ---- 5 the Raspberry Pi Pico -----------------------------------------------------------------------------------
  // Positions of the small parts on the module, in mm along it from the end away from the USB (u) and across it
  // from its centre line (v), read off the board (the datasheet doesn't dimension them): estimates.
  // BOOTSEL and the LED come from design.json, because the lid's holes over them read the same numbers.
  const fromFar = (fromUsbEnd) => p.controllerLengthMm - fromUsbEnd;
  const ON_PICO = { rp2040: [25.5, 0, 7, 7, 0.9], flash: [16, 0, 3, 2, 0.55], crystal: [20.5, -6.2, 3.2, 2.5, 0.8], inductor: [36.5, 5.6, 2.5, 2, 1.2],
    led: [fromFar(p.ledFromUsbEndMm), p.ledAcrossMm, 1.6, 0.8, 0.45], bootsel: [fromFar(p.bootselFromUsbEndMm), p.bootselAcrossMm, 3.6, 2.8, 1.1] };
  function pico() {
    const u = (along) => PICO.x + along, v = (across) => p.controllerCenterYMm + across;
    const zb = Z.board, half = PICO.d / 2;
    // The module's outline, its long edges bitten by the castellations: plated half holes the solder fills.
    const first = (PICO.w - (PI.padsPerSide - 1) * PI.padPitchMm) / 2;
    const padXs = Array.from({ length: PI.padsPerSide }, (_, i) => u(first + i * PI.padPitchMm));
    const bite = 0.5, arcOf = (cx, cy, a0, a1) => Array.from({ length: 7 }, (_, j) => [cx + bite * Math.cos(a0 + ((a1 - a0) * j) / 6), cy + bite * Math.sin(a0 + ((a1 - a0) * j) / 6)]);
    const y0 = v(-half), y1 = v(half), x0 = PICO.x, x1 = PICO.x + PICO.w;
    const outline = [
      [x0, y0], ...padXs.flatMap((x) => arcOf(x, y0, Math.PI, 0)),
      [x1, y0], [x1, y1], ...[...padXs].reverse().flatMap((x) => arcOf(x, y1, 0, -Math.PI)), [x0, y1],
    ];
    const board = k.extrude(outline, 0, zb, P, { convex: false });
    const parts = [S(board, { tone: "hi" })];
    const top = [], pads = [];
    // A pad round each half hole, and the header hole inboard, on both long edges.
    for (const x of padXs)
      for (const side of [-1, 1]) {
        const edge = v(side * half), row = v(side * (half - PI.padRowInsetMm));
        const pad = [[x - 0.8, edge], [x - 0.8, edge - side * 1.15], [x + 0.8, edge - side * 1.15], [x + 0.8, edge]];
        pads.push(path(pad.map(([ax, ay]) => at([ax, ay, zb])), false));
        top.push(k.ring(x, row, 0.5, zb, P, 12));
      }
    parts.push(L(pads.join(""), { tone: "lo" }));
    top.push(...[[PI.holePitchXMm, PI.holePitchYMm]].flatMap(([sx, sy]) => [-1, 1].flatMap((a) => [-1, 1].map((b) => k.ring(u(PICO.w / 2 + (a * sx) / 2), v((b * sy) / 2), PI.holeMm / 2, zb, P, 20)))));
    for (const across of [-PI.padPitchMm, 0, PI.padPitchMm]) top.push(k.ring(u(1.4), v(across), 0.55, zb, P, 12)); // SWD debug pads
    parts.push(L(top.join(""), { tone: "mid" }));
    const chip = ([along, across, w, d, h], angle = 0, tone = "mid") => S(k.extrude(rotated(u(along), v(across), w, d, angle), zb, h, P), { tone });
    const [rx, ry] = [u(ON_PICO.rp2040[0]), v(ON_PICO.rp2040[1])];
    parts.push(chip(ON_PICO.flash), chip(ON_PICO.crystal, 0, "lo"), chip(ON_PICO.inductor, 0, "lo"));
    parts.push(chip(ON_PICO.rp2040, Math.PI / 4) + k.dotsSvg([at([rx, ry - ON_PICO.rp2040[2] * 0.5, zb + ON_PICO.rp2040[4]])], { size: 0.45, tone: "mid" }));
    parts.push(chip(ON_PICO.led, 0, "hi"));
    const [bx, by, bw, bd, bh] = ON_PICO.bootsel;
    parts.push(S(k.slabOf(box(u(bx), v(by), bw, bd, 0.3), zb, bh, P, 2), { tone: "mid" }) + S(k.cylinder(u(bx), v(by), 0.9, zb + bh, 0.35, P, 16), { tone: "hi" }));
    // The micro-B socket: a metal shell flush with the module's end, its mouth facing +x.
    const usb = USB;
    const mouth = (inset) => { // the micro-B trapezoid on the +x face
      const w = CORD.microBWidthMm / 2 + inset, hgt = CORD.microBHeightMm / 2 + inset, zc = PORT[2], cham = 0.6;
      return [[-w, zc + hgt], [w, zc + hgt], [w, zc - hgt + cham], [w - cham, zc - hgt], [-w + cham, zc - hgt], [-w, zc - hgt + cham]].map(([dy, z]) => at([PORT[0], PORT[1] + dy, z]));
    };
    const legs = byDepth([-1, 1].map((s) => [usb.x + 1.2, v(s * (PI.usbWidthMm / 2 + 0.35))])).map(([lx, ly]) => S(k.slabOf(box(lx, ly, 1.4, 0.7, 0.1), zb, 0.9, P, 1), { tone: "mid" }));
    const shell = k.slabOf(usb, zb, Z.usbTop - zb, P, 2, 0.4 * px);
    hide("ctrl", board, shell);
    parts.push(legs[0], S(shell, { tone: "hi", inner: L(k.lineOnTop([usb.x + 1.2, usb.y], [usb.x + 1.2, usb.y + usb.d], Z.usbTop, P), { tone: "faint" }) }), legs[1]);
    // The mouth, dark, with the plastic tongue across it.
    const tongue = [[-1, 0.05], [1, 0.05], [1, 0.4], [-1, 0.4]].map(([a, dz]) => at([PORT[0], PORT[1] + a * (CORD.microBWidthMm / 2 - 1), PORT[2] + dz]));
    parts.push(voidOf(path(mouth(0))) + L(path(mouth(0)), { tone: "mid" }) + `<path class="iso-shade" data-shade="2" d="${path(tongue)}"/>` + L(path(tongue), { tone: "lo" }));
    return parts.join("");
  }
  fig.part("ctrl", pico(), { step: 3, lift: rise(UP.ctrl) });

  // ---- 6 the heat-set inserts, in the top's bosses ---------------------------------------------------------------
  function insertOf([x, y]) {
    const r = INS.outerMm / 2, h = INS.lengthMm;
    const body = k.cylinder(x, y, r, 0, h, P, 24);
    hide("ins", body);
    return S(body, { tone: "mid", inner: L(k.knurl(x, y, r, 0, h, 22, P, 0.3 * px) + k.sideArc(x, y, r, h / 2, P, 16), { tone: "faint" }) })
      + bore(x, y, shankR * 0.85, h, "lo");
  }
  for (const hole of byDepth(holes)) fig.part("ins", insertOf(hole), { step: 4, lift: rise(UP.ins) });

  // ---- 7 the top: the case lid, which is also the switch plate --------------------------------------------------
  // Drawn by hand: a notched outline, nine see-through cutouts with their inner walls, and an open USB notch, so
  // what is under the plate shows through every opening in any pose.
  function topShell() {
    const base = ring(CASE, 8);
    const at0 = base.findIndex(([x], i) => Math.abs(x - X1) < 1e-6 && Math.abs(base[(i + 1) % base.length][0] - X1) < 1e-6);
    const outline = [...base.slice(0, at0 + 1), [X1, NOTCH.y0], [NOTCH.x0, NOTCH.y0], [NOTCH.x0, NOTCH.y1], [X1, NOTCH.y1], ...base.slice(at0 + 1)];
    const n = outline.length;
    const zt = Z.plateTop, zb = Z.pcbBot;
    const sides = [], shades = [[], [], [], []], creases = [], edges = [];
    const quad = (a, b, z0, z1) => [at([a[0], a[1], z1]), at([b[0], b[1], z1]), at([b[0], b[1], z0]), at([a[0], a[1], z0])];
    const face = (pts, nrm) => { sides.push(path(pts)); shades[shadeOf(nrm)].push(path(pts)); };
    const seen = outline.map((a, i) => { const b = outline[(i + 1) % n]; return facing([b[1] - a[1], -(b[0] - a[0]), 0]); });
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n], nrm = [b[1] - a[1], -(b[0] - a[0])];
      const back = Math.abs(a[0] - NOTCH.x0) < 1e-6 && Math.abs(b[0] - NOTCH.x0) < 1e-6; // the notch's back: only the skin
      const farSide = Math.abs(a[1] - NOTCH.y1) < 1e-6 && Math.abs(b[1] - NOTCH.y1) < 1e-6;
      if (!seen[i]) { edges.push(path([at([...a, zt]), at([...b, zt])], false)); continue; }
      creases.push(path([at([...a, zt]), at([...b, zt])], false));
      if (back) {
        face(quad(a, b, Z.skin, zt), nrm);
        // The corner on your side is concave: the cheek in front of it hides that corner and the near end of the
        // skin's lower edge, so the edge starts where it comes out from behind the cheek's top edge.
        const open = [[X1 + 50, NOTCH.y0], [NOTCH.x0 - 50, NOTCH.y0], [NOTCH.x0 - 50, NOTCH.y0 + 50], [X1 + 50, NOTCH.y0 + 50]].map(([x, y]) => at([x, y, zt]));
        const low = clipSeg(at([...a, Z.skin]), at([...b, Z.skin]), open);
        if (low) edges.push(path(low, false));
      } else if (farSide) { // the wall's cut face, and the skin's over the gap inside the wall
        const inner = [INNER.x + INNER.w, NOTCH.y1];
        face(quad(inner, b, zb, zt), nrm);
        face(quad(a, inner, Z.skin, zt), nrm);
        edges.push(path([at([...a, Z.skin]), at([...inner, Z.skin]), at([...inner, zb]), at([...b, zb])], false));
        creases.push(path([at([...a, Z.skin]), at([...a, zt])], false), path([at([...b, zb]), at([...b, zt])], false));
      } else {
        face(quad(a, b, zb, zt), nrm);
        edges.push(path([at([...a, zb]), at([...b, zb])], false));
      }
      const prev = (i + n - 1) % n;
      if (!seen[prev] && !back) edges.push(path([at([...a, zb]), at([...a, zt])], false));
      if (!seen[(i + 1) % n]) edges.push(path([at([...b, zb]), at([...b, zt])], false));
    }
    // The plate's top face with the nine cutouts, and the two walls of each cutout that face you.
    const cut = keys.map(([x, y]) => [[x - p.plateCutoutMm / 2, y - p.plateCutoutMm / 2], [x + p.plateCutoutMm / 2, y - p.plateCutoutMm / 2], [x + p.plateCutoutMm / 2, y + p.plateCutoutMm / 2], [x - p.plateCutoutMm / 2, y + p.plateCutoutMm / 2]]);
    // Through the skin over the Pico: the BOOTSEL hole (a paperclip reflashes it with the case closed) and the LED
    // window, as cad/top.py cuts them. Each is a dark bore with its far wall and the rim; BOOTSEL's button shows below.
    const usbEnd = p.controllerCenterXMm + p.controllerLengthMm / 2;
    const lidHoles = [
      { x: usbEnd - p.bootselFromUsbEndMm, y: p.controllerCenterYMm + p.bootselAcrossMm, r: p.bootselHoleMm / 2, button: true },
      { x: usbEnd - p.ledFromUsbEndMm, y: p.controllerCenterYMm + p.ledAcrossMm, r: p.ledHoleMm / 2 },
    ];
    const holeAt = (h, z, r = h.r) => path(k.circleRing(h.x, h.y, r, 32).map(([x, y]) => at([x, y, z])));
    const topFace = path(outline.map(([x, y]) => at([x, y, zt]))) + cut.map((c) => path(c.map(([x, y]) => at([x, y, zt])))).join("")
      + lidHoles.map((h) => holeAt(h, zt)).join("");
    const holeMarks = lidHoles.map((h) => {
      const mouth = holeAt(h, zt), low = holeAt(h, Z.skin);
      const wall = clipped(mouth, `<path class="iso-shade" data-shade="2" fill-rule="evenodd" d="${mouth}${low}"/>`);
      const button = h.button ? clipped(low, S(k.cylinder(h.x, h.y, 0.9, Z.board + ON_PICO.bootsel[4], 0.35, P, 16), { tone: "lo" })) : "";
      return voidOf(mouth) + wall + button + L(mouth, { tone: "mid" });
    }).join("");
    const walls = [];
    for (const c of cut) {
      const mouth = c.map(([x, y]) => at([x, y, zt]));
      const rims = c.map((a, i) => {
        const b = c[(i + 1) % 4], nrm = [-(b[1] - a[1]), b[0] - a[0]]; // into the cutout
        return { a, b, nrm, seen: facing([...nrm, 0]) };
      });
      rims.forEach(({ a, b, nrm, seen }, i) => {
        const rim = path([at([...a, zt]), at([...b, zt])], false);
        if (!seen) { edges.push(rim); return; } // the near rim: the plate's edge against the opening
        creases.push(rim); // the far rim, where the top meets the wall you see inside
        walls.push(`<path class="iso-shade" data-shade="${shadeOf(nrm)}" d="${path(clipPoly(quad(a, b, Z.plateBot, zt), mouth))}"/>`);
        const low = clipSeg(at([...a, Z.plateBot]), at([...b, Z.plateBot]), mouth); // the wall's lower edge
        if (low) edges.push(path(low, false));
        if (rims[(i + 1) % 4].seen) { // the corner between two walls you see
          const corner = clipSeg(at([...b, zt]), at([...b, Z.plateBot]), mouth);
          if (corner) creases.push(path(corner, false));
        }
      });
    }
    const fill = `<path class="iso-fill" d="${sides.join("")}"/><path class="iso-fill" fill-rule="evenodd" d="${topFace}"/>`;
    // The bevel round the top edge, cut where the USB opening takes the edge away.
    const gap = path([[X1 + 2, NOTCH.y0], [NOTCH.x0, NOTCH.y0], [NOTCH.x0, NOTCH.y1], [X1 + 2, NOTCH.y1]].map(([x, y]) => at([x, y, zt])));
    const bevel = clipped(`M-2000 -2000H4000V4000H-2000Z${gap}`, L(k.slabOf(CASE, zb, zt - zb, P, 8, 1.2 * px).bevel, { tone: "faint", className: "iso-bevel" }), { evenodd: true });
    const tones = shades.map((list, shade) => (list.length ? `<path class="iso-shade" data-shade="${shade}" d="${list.join("")}"/>` : "")).join("");
    return `<g class="iso-solid">${fill}${tones}<path class="iso-top" fill-rule="evenodd" d="${topFace}"/>${walls.join("")}${holeMarks}${bevel}`
      + `${L(creases.join(""), { tone: "faint", className: "iso-crease" })}${L(edges.join(""), { tone: "mid", className: "iso-edge" })}</g>`;
  }
  fig.part("top", topShell(), { step: 4, lift: rise(UP.top) });

  // ---- 8 switches and keycaps, key by key from far to near ----------------------------------------------------------
  const plateHole = (x, y, grow = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * (p.plateCutoutMm / 2 + grow), y + b * (p.plateCutoutMm / 2 + grow)]);
  function switchOf([x, y]) {
    const cutW = p.plateCutoutMm;
    // The lower housing goes down through the plate to the PCB, with a latch each side that clips under the plate.
    // It is held at the plate's opening, so it shows above the plate only, wherever the plate is.
    // Under it, what seats in the PCB: the centre post and the two metal pins that go into the socket.
    const post = S(k.cylinder(x, y, SW.centrePostMm / 2, -SW.centrePostLengthMm, SW.centrePostLengthMm, P, 20), { tone: "lo" });
    const pins = byDepth([pin1, pin2], ([dx, dy]) => [x + dx, y + dy]).map(([dx, dy]) =>
      S(k.slabOf(box(x + dx, y + dy, SW.pinWidthMm, SW.pinThicknessMm, 0.05), -SW.pinLengthMm, SW.pinLengthMm, P, 1), { tone: "mid" }));
    const lower = post + pins.join("") + S(k.slabOf(square(x, y, cutW, 0.3), 0, Z.plateTop, P, 2), { tone: "mid" })
      + [-1, 1].map((s) => S(k.slabOf(box(x, y + s * (cutW / 2 + 0.3), 4, 0.6, 0.1), Z.plateBot - 1.2, 1.2, P, 1), { tone: "mid" })).join("");
    const hidden = clipped(column(plateHole(x, y, 0.3), Z.plateTop), lower, { withLine: "top" });
    const band = 0.8;
    const base = S(k.slabOf(square(x, y, SW.housingMm, 0.6), Z.plateTop, band, P, 3), { tone: "mid" });
    const body = S(loft(ring(square(x, y, SW.housingMm, 0.8), 3), Z.plateTop + band, ring(square(x, y, SW.housingTopMm, 1.4), 3), Z.swTop), { tone: "mid", inner: L(k.planOutline(square(x, y, SW.stemCrossMm + 2.4, 1.2), Z.swTop, P, 3), { tone: "faint" }) });
    const a = SW.stemCrossMm / 2, t = SW.stemArmMm / 2;
    const cross = [[a, -t], [a, t], [t, t], [t, a], [-t, a], [-t, t], [-a, t], [-a, -t], [-t, -t], [-t, -a], [t, -a], [t, -t]].map(([dx, dy]) => [x + dx, y + dy]);
    const stem = S(k.extrude(cross, Z.swTop, SW.stemMm, P, { convex: false }), { tone: "lo" });
    return hidden + base + body + stem;
  }
  function capOf([x, y]) {
    const cap = loft(ring(square(x, y, CAP.baseMm, 1.1), 4), Z.capBot, ring(square(x, y, CAP.topMm, 2.2), 4), Z.capTop);
    const dish = k.onTop(k.circleRing(x, y, CAP.topMm * 0.42, 40), Z.capTop, P, true);
    return S(cap, { tone: "mid", crease: "lo", inner: L(dish, { tone: "faint" }) });
  }
  for (const key of byDepth(keys)) {
    fig.part("sw", switchOf(key), { step: 5, lift: rise(UP.sw) });
    fig.part("cap", capOf(key), { step: 8, lift: rise(UP.cap) });
  }

  // ---- what the case and the keys hide, seen through them: before the cable, which lies in front of the Pico ---------
  // Each shows while its line is lit and a part named in `by` is in place over it (the sockets sit right under the
  // keys, so their outline goes over the keycaps too).
  const XRAY_BY = { pcb: ["top"], ctrl: ["top"], sock: ["pcb"], ins: ["top"], scr: ["bot"], feet: ["bot"] };
  for (const [line, by] of Object.entries(XRAY_BY)) fig.xray(line, xrayOf(line), { by });

  // ---- 9 the USB cable: micro-B into the Pico through the notch, a metre of cord, a USB-A plug on the desk ------------
  function cable() {
    const along = G.frameOf(PORT, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const roundRect = (w, h, r, steps = 4) => k.roundedPlan({ x: -w / 2, y: -h / 2, w, d: h, r }, steps);
    // The micro-B's metal: most of it goes into the Pico's socket, and is held hidden there wherever the Pico is.
    const tip = roundRect(CORD.microBWidthMm, CORD.microBHeightMm, 0.5), reach = 1.6;
    const socketHull = k.slabOf(USB, Z.board, Z.usbTop - Z.board, P, 2).fill;
    const inside = clipped(`M-2000 -2000H4000V4000H-2000Z${socketHull}`, S(G.prismOf(along, tip, reach - CORD.microBLengthMm, 0, P), { tone: "mid" }), { withLine: "ctrl", evenodd: true });
    const metal = G.prismOf(along, tip, 0, reach, P);
    const mold = G.prismOf(along, roundRect(p.usbOvermoldWidthMm, p.usbOvermoldHeightMm, 1.8), reach, CORD.plugLengthMm, P);
    const relief = G.solidOf([[CORD.plugLengthMm, 3.1], [CORD.plugLengthMm + 3, 2.7, 1], [CORD.plugLengthMm + 6, 2.1, 1], [CORD.plugLengthMm + 8, CORD_R]], along, P);
    // Grip ribs across the moulding's near face, fading out where the face rounds over.
    const grip = [4, 6.5, 9, 11.5].map((s) => k.fadeLineSvg([PORT[2] + p.usbOvermoldHeightMm / 2 - 1, PORT[2] - p.usbOvermoldHeightMm / 2 + 1]
      .map((z) => at([PORT[0] + s, PORT[1] - p.usbOvermoldWidthMm / 2, z])), { fade: [0.35, 0.35], tone: "faint" }));
    const plug = inside + S(metal, { tone: "mid" }) + S(mold, { tone: "mid", inner: grip.join("") }) + S(relief, { tone: "mid" });
    // The cord: out of the strain relief, down to the desk, round toward you and up into the USB-A plug.
    const cord = G.fillet([[out - 0.5, PORT[1], PORT[2]], ...route], 22, 12, { P, tube: CORD_R });
    const pieces = T.tubePieces(cord, CORD_R, P, { spacing: 2.2 * px, maxLength: 30 * px });
    const tube = byDepth(pieces, (piece) => piece.mid).map((piece) => T.tubeSvg(piece, { tone: "mid" })).join("");
    // USB-A: a strain relief and a moulded body round the metal shell, its body resting flat on the desk (the
    // moulding's size is a typical cable's, typed in; the shell is the USB-A standard's).
    const end = route[route.length - 1], before = route[route.length - 2];
    const dir = G.unit3([end[0] - before[0], end[1] - before[1], 0]);
    const lay = G.frameOf([end[0], end[1], A_Z], dir, G.unit3(G.cross3([0, 0, 1], dir)), [0, 0, 1]);
    const aRelief = G.solidOf([[0, CORD_R], [3, 2.3, 1], [6, 2.9]], lay, P);
    const aBody = G.prismOf(lay, roundRect(CORD.aShellWidthMm + 4, A_BODY_H, 1.6), 6, 6 + 18, P);
    const aShell = G.prismOf(lay, roundRect(CORD.aShellWidthMm, CORD.aShellHeightMm, 0.3), 24, 24 + CORD.aShellLengthMm, P);
    const shellTop = (s0, s1, dx) => path([[s0, dx - 1], [s1, dx - 1], [s1, dx + 1], [s0, dx + 1]].map(([s, w]) => at(G.add3(G.add3(lay.o, G.mul3(lay.a, s)), G.add3(G.mul3(lay.u, w), G.mul3(lay.v, CORD.aShellHeightMm / 2))))));
    const windows = L(shellTop(24 + 3, 24 + 6, -3) + shellTop(24 + 3, 24 + 6, 3), { tone: "lo" });
    const aPlug = S(aRelief, { tone: "mid" }) + S(aBody, { tone: "mid" }) + S(aShell, { tone: "mid", inner: windows });
    const halo = `<path class="iso-halo" d="${aBody.fill}${aShell.fill}"/>`; // its shadow on the desk
    return clipped(behindWall, halo + plug + tube + aPlug, { withLine: "top", evenodd: true });
  }
  // The wall beside the notch on your side hides the plug's near edge inside the notch: clip that region away.
  const WALL = { x: INNER.x + INNER.w, y: NOTCH.y0 - 10, w: X1 - (INNER.x + INNER.w), d: 10, r: 0 };
  const behindWall = `M-2000 -2000H4000V4000H-2000Z${path(G.hullOf(k.boxCorners(WALL, Z.pcbBot, Z.plateTop).map(at)))}`;
  fig.part("cable", cable(), { step: 9, lift: [PULL, 0, UP.ctrl] });

  fig.step(1, "Start with the bare PCB");
  fig.step(2, `Solder the ${keys.length} sockets onto the back`);
  fig.step(3, "Solder the Pico flat onto the face");
  fig.step(4, `Press the ${holes.length} inserts in, set the top on`);
  fig.step(5, `Clip the ${keys.length} switches into the plate`);
  fig.step(6, `Set it in the tray, ${holes.length} screws from below`);
  fig.step(7, `Stick on the ${feet.length} rubber feet`);
  fig.step(8, "Press a keycap onto each switch");
  fig.step(9, "Plug the USB cable into the Pico");

  return {
    title: `${p.keyCols} × ${p.keyRows} USB macro keypad`,
    caption: `${keys.length} MX switches in hot-swap sockets on a ${W} × ${H} mm PCB, each wired to its own pin of a Raspberry Pi `
      + `Pico, in a two-part printed case whose top is also the switch plate; ${holes.length} M3 screws from below clamp the PCB `
      + "between the tray and the heat-set inserts in the top.",
  };
}
