// Engineer checks for Ponder. Every number comes from design.json params (p) or bom.json lines (bom.lines).
// Nothing here is a product number; change the design, not the rules. Each says its scope: "part" for one part on
// its own (Design's gate), "assembly" for the parts together (Inspect's).

const num = (p, k) => Number(p[k]);
const lines = (bom, role) => bom.lines.filter((l) => l.role === role);
const qty = (bom, role) => lines(bom, role).reduce((s, l) => s + l.qtyPerUnit, 0);
const specOf = (bom, role, key) => {
  const l = lines(bom, role)[0];
  return l ? l.spec[key] : undefined;
};
const pins = (s) => String(s).split(",").map((x) => Number(x.trim()));
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const f1 = (x) => x.toFixed(1);
const ok = (cond, detail) => ({ status: cond ? "pass" : "fail", detail });

// Supply current by block, in mA. Shared by the budget and the voltage-drop checks.
// mode "budget": hardware maximum, steady (amp at full output, light bar full white).
// mode "typical": the software caps in design.json (amp volume, light-bar brightness).
// mode "peak": hardware maximum with the amp's supply current at its sine-wave peak.
function loads(p, bom, mode = "budget") {
  const ampW = mode === "typical" ? num(p, "ampVolumeCapW") : num(p, "ampMaxOutputW");
  const peak = mode === "peak" ? num(p, "ampPeakFactor") : 1;
  const amp = (ampW / (num(p, "ampEfficiencyPct") / 100) / num(p, "supplyVoltageV")) * 1000 * peak;
  const ledScale = mode === "typical" ? num(p, "statusLedBrightnessCapPct") / 100 : 1;
  const pixels = Number(specOf(bom, "wake-light", "pixels") ?? 0);
  const head = {
    pi: num(p, "piPeakMa"),
    camera: num(p, "cameraMa"),
    amp,
    mics: qty(bom, "microphone") * num(p, "micMaEach"),
    cameraLed: num(p, "cameraLedMa"),
    muteLed: num(p, "muteLedMa"),
  };
  const base = {
    statusLeds: pixels * num(p, "ledChannelMa") * num(p, "ledChannelsPerPixel") * ledScale,
    buttonLed: num(p, "talkButtonLedMa"),
  };
  const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
  return { head, base, headMa: sum(head), totalMa: sum(head) + sum(base) };
}

// Shortest planar path with a minimum bend radius R between two poses (y, z, heading), as a
// gooseneck would take it: the six Dubins words, lengths in mm.
function dubins(p0, p1, R) {
  const m = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const d = Math.hypot(dx, dy) / R;
  const th = m(Math.atan2(dy, dx));
  const a = m(p0[2] - th), b = m(p1[2] - th);
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), cab = Math.cos(a - b);
  const out = [];
  let q = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (q >= 0) { const t = Math.atan2(cb - ca, d + sa - sb); out.push(m(-a + t) + Math.sqrt(q) + m(b - t)); }
  q = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (q >= 0) { const t = Math.atan2(ca - cb, d - sa + sb); out.push(m(a - t) + Math.sqrt(q) + m(-b + t)); }
  q = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (q >= 0) { const r = Math.sqrt(q); const t = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, r); out.push(m(-a + t) + r + m(-m(b) + t)); }
  q = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
  if (q >= 0) { const r = Math.sqrt(q); const t = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, r); out.push(m(a - t) + r + m(b - t)); }
  let c = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
  if (Math.abs(c) <= 1) { const r = m(2 * Math.PI - Math.acos(c)); const t = m(a - Math.atan2(ca - cb, d - sa + sb) + r / 2); out.push(t + r + m(a - b - t + r)); }
  c = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8;
  if (Math.abs(c) <= 1) { const r = m(2 * Math.PI - Math.acos(c)); const t = m(-a - Math.atan2(ca - cb, d + sa - sb) + r / 2); out.push(t + r + m(m(b) - a - t + r)); }
  return Math.min(...out) * R;
}

// The gooseneck between the two couplings at the design pose. Planar: the head is turned so its
// nipple sits over the arm root and the lens over the middle of the page. The base end leaves its
// coupling pointing straight up; the head end enters the head's top coupling along the head's z
// axis, which is tilted cameraTiltDeg back from vertical, so the arm turns through 180 - tilt deg.
function armPath(p, R) {
  const t = rad(num(p, "cameraTiltDeg"));
  const cH = num(p, "couplingHeightMm");
  const baseTop = num(p, "baseHeightMm") + num(p, "armCollarHeightMm") - num(p, "couplingSeatDepthMm") + cH;
  const engBase = cH - num(p, "baseNippleEngagementMm");
  const engHead = cH - (num(p, "headNippleLengthMm") - num(p, "headWallMm") - num(p, "nutThicknessMm"));
  const rigid = num(p, "armEndRigidMm");
  const outBase = Math.max(0, rigid - engBase), outHead = Math.max(0, rigid - engHead);
  const yl = num(p, "armRootYMm") + num(p, "headReachMm"), zl = num(p, "cameraHeightMm");
  const up = num(p, "headLensToTopMm") + cH; // lens tip to the head coupling's top, along the head's z axis
  const ny = num(p, "headNippleYMm");
  const yh = yl - up * Math.sin(t) + ny * Math.cos(t), zh = zl + up * Math.cos(t) + ny * Math.sin(t);
  const start = [num(p, "armRootYMm"), baseTop + outBase, Math.PI / 2];
  const end = [yh - outHead * Math.sin(t), zh + outHead * Math.cos(t), Math.atan2(-Math.cos(t), Math.sin(t))];
  const need = dubins(start, end, R) + outBase + outHead + engBase + engHead;
  return { need, baseTop, yh, zh, engBase, engHead };
}

// Camera geometry. y is forward (toward the page and the child) from the base centre.
function camera(p) {
  const camY = num(p, "armRootYMm") + num(p, "headReachMm");
  const h = num(p, "cameraHeightMm");
  const t = rad(num(p, "cameraTiltDeg"));
  const along = p.cameraLongAxis === "along" ? num(p, "cameraHfovDeg") : num(p, "cameraVfovDeg");
  const across = p.cameraLongAxis === "along" ? num(p, "cameraVfovDeg") : num(p, "cameraHfovDeg");
  const y0 = num(p, "baseDepthMm") / 2 + num(p, "pageGapFromBaseMm");
  const y1 = y0 + num(p, "pageLengthMm");
  const xh = num(p, "pageWidthMm") / 2;
  // Project a desk point into the camera: D is depth along the optical axis, V the along-page
  // offset in the image plane, U the across offset.
  const proj = (x, y) => {
    const dy = y - camY;
    const D = dy * Math.sin(t) + h * Math.cos(t);
    const V = dy * Math.cos(t) - h * Math.sin(t);
    return { D, U: x, V, alongDeg: deg(Math.atan2(Math.abs(V), D)), acrossDeg: deg(Math.atan2(Math.abs(x), D)) };
  };
  const corners = [proj(xh, y0), proj(xh, y1)]; // symmetric in x, so two corners cover all four
  return { camY, h, t, along, across, y0, y1, xh, proj, corners };
}

function stability(p, bom, pose) {
  const dens = { PA12: num(p, "pa12DensityGPerCm3"), PETG: num(p, "petgDensityGPerCm3") };
  const printMass = (assembly) =>
    bom.lines
      .filter((l) => l.process === "print" && l.spec.assembly === assembly)
      .reduce((s, l) => s + l.qtyPerUnit * Number(l.spec.volumeCm3) * (dens[String(l.spec.material)] ?? dens.PA12), 0);
  const rootX = num(p, "armRootXMm"), rootY = num(p, "armRootYMm");
  const ballast = qty(bom, "ballast") * num(p, "ballastDiscMassG");
  const arm = num(p, "armMassG");
  const head = printMass("head") + num(p, "headBoughtMassG");
  const baseRest = printMass("base") + num(p, "baseBoughtMassG");
  // pose "design": the arm bent to the design shape; "straight": a child pulls it straight out
  // horizontally from the root along direction (dx, dy).
  const L = num(p, "armLengthMm");
  const arms = pose === "design"
    ? [{ dx: 0, dy: 1, armOff: num(p, "armComForwardMm"), headOff: num(p, "headReachMm") }]
    : [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ dx, dy, armOff: L / 2, headOff: L + num(p, "headDepthMm") / 2 }));
  const tipX = num(p, "baseWidthMm") / 2 - num(p, "feetInsetMm");
  const tipY = num(p, "baseDepthMm") / 2 - num(p, "feetInsetMm");
  return arms.map((a) => {
    const parts = [
      { m: baseRest, x: 0, y: 0 },
      { m: ballast, x: rootX, y: rootY },
      { m: arm, x: rootX + a.dx * a.armOff, y: rootY + a.dy * a.armOff },
      { m: head, x: rootX + a.dx * a.headOff, y: rootY + a.dy * a.headOff },
    ];
    const M = parts.reduce((s, q) => s + q.m, 0);
    const cx = parts.reduce((s, q) => s + q.m * q.x, 0) / M;
    const cy = parts.reduce((s, q) => s + q.m * q.y, 0) / M;
    const margin = Math.min(tipX - Math.abs(cx), tipY - Math.abs(cy));
    return { dir: a, M, cx, cy, margin, tipX, tipY, ballast, arm, head, baseRest };
  });
}

export const rules = [
  {
    id: "ponder-bom-roles",
    title: "Every part the design needs is in the BOM",
    scope: "part",
    needs: ["requiredRoles"],
    run: ({ p, bom }) => {
      const missing = String(p.requiredRoles).split(",").map((r) => r.trim()).filter((r) => qty(bom, r) === 0);
      return ok(missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "All required roles present");
    },
  },
  {
    id: "power-budget",
    title: "5 V load fits the supply with margin",
    scope: "assembly",
    needs: ["supplyRatingMa", "inputConnectorRatingMa", "inputConnectorRatingVerified", "powerMarginFactor", "piPeakMa", "cameraMa",
      "ampMaxOutputW", "ampEfficiencyPct", "supplyVoltageV", "micMaEach", "ledChannelMa", "ledChannelsPerPixel", "talkButtonLedMa",
      "cameraLedMa", "muteLedMa"],
    run: ({ p, bom }) => {
      const l = loads(p, bom, "budget");
      const limit = Math.min(num(p, "supplyRatingMa"), num(p, "inputConnectorRatingMa"));
      const need = l.totalMa * num(p, "powerMarginFactor");
      const parts = { ...l.head, ...l.base };
      const list = Object.entries(parts).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ");
      const fits = need <= limit;
      const verified = num(p, "inputConnectorRatingVerified") === 1;
      return {
        status: !fits ? "fail" : verified ? "pass" : "flag",
        detail:
          `${Math.round(l.totalMa)} mA worst case with the amp at full output and the light bar white (${list}) x${p.powerMarginFactor} = ` +
          `${Math.round(need)} mA vs ${limit} mA (supply ${p.supplyRatingMa}, USB-C input ${p.inputConnectorRatingMa}). ` +
          `Camera figure is an allowance: Raspberry Pi publishes none. Amp efficiency ${p.ampEfficiencyPct} % is an estimate for 4 ohm.` +
          (verified ? "" : ` The USB-C input figure has no source: ${p.inputConnectorRatingNote}. Load-test the first unit at full volume, light bar white and camera streaming.`),
      };
    },
  },
  {
    id: "head-voltage",
    title: "The Pi in the head still sees enough voltage after the supply cable, the base wiring and the arm harness",
    scope: "assembly",
    needs: ["supplyVoltageV", "supplyLoadRegulationPct", "supplyCableLengthM", "supplyCableOhmPerM", "usbContactOhm", "baseFeedLengthMm",
      "baseFeedOhmPerM", "harnessWireOhmPerM", "harnessCutLengthMm", "harness5vConductors", "harnessGndConductors", "minPiSupplyV",
      "piPeakMa", "ampVolumeCapW", "ampPeakFactor", "statusLedBrightnessCapPct"],
    run: ({ p, bom }) => {
      const rCable = 2 * num(p, "supplyCableLengthM") * num(p, "supplyCableOhmPerM");
      const rBase = num(p, "usbContactOhm") + (2 * num(p, "baseFeedLengthMm") / 1000) * num(p, "baseFeedOhmPerM");
      const lenM = num(p, "harnessCutLengthMm") / 1000;
      const rHarness = lenM * num(p, "harnessWireOhmPerM") * (1 / num(p, "harness5vConductors") + 1 / num(p, "harnessGndConductors"));
      const at = (v0, l) => v0 - (l.totalMa / 1000) * (rCable + rBase) - (l.headMa / 1000) * rHarness;
      const typ = loads(p, bom, "typical"), pk = loads(p, bom, "peak");
      const v0 = num(p, "supplyVoltageV"), vLow0 = v0 * (1 - num(p, "supplyLoadRegulationPct") / 100);
      const vTyp = at(v0, typ), vLow = at(vLow0, pk);
      const min = num(p, "minPiSupplyV");
      const status = vLow >= min ? "pass" : vTyp >= min ? "flag" : "fail";
      return {
        status,
        detail:
          `Typical (supply ${v0} V, amp capped at ${p.ampVolumeCapW} W, light bar at ${p.statusLedBrightnessCapPct} %): ${Math.round(typ.totalMa)} mA in, ` +
          `${Math.round(typ.headMa)} mA up the arm, ${vTyp.toFixed(2)} V at the head. Worst (supply at its -${p.supplyLoadRegulationPct} % ` +
          `load-regulation limit, ${vLow0.toFixed(2)} V; amp at ${p.ampMaxOutputW} W on its x${p.ampPeakFactor} sine peaks; light bar white): ` +
          `${Math.round(pk.totalMa)} mA in, ${Math.round(pk.headMa)} mA up the arm, ${vLow.toFixed(2)} V. Minimum ${min} V (USB 2.0 VBUS low limit). ` +
          `Resistance: supply cable ${rCable.toFixed(3)} ohm, USB-C contacts and base feed ${rBase.toFixed(3)} ohm, harness ${rHarness.toFixed(3)} ohm ` +
          `(${p.harness5vConductors}+${p.harnessGndConductors} x 28 AWG, ${p.harnessCutLengthMm} mm).` +
          (status === "pass" ? "" :
            " Measure 5V at the bonnet on the first unit with the volume at full, the light bar white and the camera streaming, and read `vcgencmd get_throttled`. " +
            "If it dips, lower the volume or brightness caps, or run a 22 AWG pair (from the hook-up wire set) through the arm beside the ribbon if the bore allows."),
      };
    },
  },
  {
    id: "camera-fov",
    title: "Camera sees a whole Letter / A4 page in front of the base",
    scope: "part",
    needs: ["cameraHeightMm", "cameraTiltDeg", "cameraHfovDeg", "cameraVfovDeg", "cameraLongAxis", "headReachMm",
      "armRootYMm", "baseDepthMm", "pageGapFromBaseMm", "pageWidthMm", "pageLengthMm", "fovMarginDeg"],
    run: ({ p }) => {
      const c = camera(p);
      const alongUsed = Math.max(...c.corners.map((k) => k.alongDeg));
      const acrossUsed = Math.max(...c.corners.map((k) => k.acrossDeg));
      const behind = c.corners.some((k) => k.D <= 0);
      const mAlong = c.along / 2 - alongUsed, mAcross = c.across / 2 - acrossUsed;
      const m = num(p, "fovMarginDeg");
      return ok(!behind && mAlong >= m && mAcross >= m,
        `Lens ${p.cameraHeightMm} mm up, ${f1(c.camY - num(p, "baseDepthMm") / 2)} mm past the base front, tilted ${p.cameraTiltDeg} deg; ` +
        `page ${p.pageWidthMm} x ${p.pageLengthMm} mm from ${f1(c.y0 - num(p, "baseDepthMm") / 2)} mm in front of the base. ` +
        `Along the page the corners need +/-${f1(alongUsed)} of +/-${f1(c.along / 2)} deg, across +/-${f1(acrossUsed)} of +/-${f1(c.across / 2)} deg ` +
        `(margin ${f1(mAlong)} / ${f1(mAcross)} deg, need ${m})`);
    },
  },
  {
    id: "camera-focus-resolution",
    title: "Whole page is inside the focus range and sharp enough for pencil handwriting",
    scope: "part",
    needs: ["cameraFocusMinMm", "cameraFocalLengthMm", "cameraPixelUm", "minResolutionPxPerMm", "cameraHeightMm"],
    run: ({ p }) => {
      const c = camera(p);
      const fPx = num(p, "cameraFocalLengthMm") / (num(p, "cameraPixelUm") / 1000);
      // Nearest page point: straight below the lens if the lens is over the page, else the near edge.
      const yNear = Math.min(Math.max(c.camY, c.y0), c.y1);
      const near = Math.hypot(yNear - c.camY, c.h);
      // Worst sampling is at the far corner: across scale f/D, along scale foreshortened by the tilt.
      const far = c.proj(c.xh, c.y1);
      const acrossPx = fPx / far.D;
      const alongPx = (fPx * (Math.cos(c.t) * far.D - far.V * Math.sin(c.t))) / (far.D * far.D);
      const worst = Math.min(acrossPx, alongPx);
      return ok(near >= num(p, "cameraFocusMinMm") && worst >= num(p, "minResolutionPxPerMm"),
        `Nearest page point ${Math.round(near)} mm (focus from ${p.cameraFocusMinMm} mm). Far corner at full ${p.cameraResXPx} x ${p.cameraResYPx}: ` +
        `${f1(acrossPx)} px/mm across, ${f1(alongPx)} px/mm along (need ${p.minResolutionPxPerMm}, about ${Math.round(num(p, "minResolutionPxPerMm") * 25.4)} dpi). Lens distortion not modelled.`);
    },
  },
  {
    id: "tip-design-pose",
    title: "Does not tip with the head reaching over the page",
    scope: "assembly",
    needs: ["armRootXMm", "armRootYMm", "armMassG", "armComForwardMm", "headReachMm", "headBoughtMassG", "baseBoughtMassG",
      "ballastDiscMassG", "pa12DensityGPerCm3", "feetInsetMm", "stabilityMarginMm", "baseWidthMm", "baseDepthMm"],
    run: ({ p, bom }) => {
      const s = stability(p, bom, "design")[0];
      return ok(s.margin >= num(p, "stabilityMarginMm"),
        `Mass ${Math.round(s.M)} g (base ${Math.round(s.baseRest)} + ballast ${Math.round(s.ballast)} + arm ${Math.round(s.arm)} + head ${Math.round(s.head)}). ` +
        `Centre of mass at x ${f1(s.cx)}, y ${f1(s.cy)} mm; tipping lines at the feet x +/-${s.tipX}, y +/-${s.tipY} mm: ` +
        `${f1(s.margin)} mm inside (need ${p.stabilityMarginMm})`);
    },
  },
  {
    id: "tip-arm-straight",
    title: "Stays up if a child pulls the gooseneck straight out",
    scope: "assembly",
    needs: ["armLengthMm", "armMassG", "headDepthMm", "feetInsetMm", "ballastDiscMassG"],
    run: ({ p, bom }) => {
      const all = stability(p, bom, "straight");
      const worst = all.reduce((a, b) => (b.margin < a.margin ? b : a));
      const name = (d) => (d.dy === 1 ? "forward" : d.dy === -1 ? "backward" : d.dx === 1 ? "right" : "left");
      const tips = all.filter((s) => s.margin < 0).map((s) => name(s.dir));
      // Extra ballast at the root that would bring the worst direction back to the tipping line.
      const lim = worst.dir.dy !== 0 ? worst.tipY : worst.tipX;
      const root = worst.dir.dy !== 0 ? num(p, "armRootYMm") * worst.dir.dy : num(p, "armRootXMm") * worst.dir.dx;
      const c = worst.dir.dy !== 0 ? Math.abs(worst.cy) : Math.abs(worst.cx);
      const extra = Math.max(0, (worst.M * (c - lim)) / (lim - root));
      return {
        status: tips.length ? "flag" : "pass",
        detail: tips.length
          ? `Arm (${p.armLengthMm} mm) pulled straight out tips the unit ${tips.join(", ")}: worst ${name(worst.dir)} puts the centre of mass ` +
            `${f1(-worst.margin)} mm outside the feet. About ${Math.round(extra)} g more ballast at the arm root would hold it; ` +
            `arm mass ${p.armMassG} g is an estimate (weigh the real gooseneck). Accepted for the pilot: the unit falls over on the desk rather than off it, ` +
            `and there is no room for that much steel. Say so to teachers, and check it in the first-unit tip test.`
          : `Straight-arm worst case ${name(worst.dir)}: ${f1(worst.margin)} mm inside the feet`,
      };
    },
  },
  {
    id: "tip-push",
    title: "Does not tip when someone presses or pushes the head",
    scope: "assembly",
    needs: ["pushDownN", "pushSideN", "cameraHeightMm", "headLensToTopMm", "headReachMm", "armRootYMm"],
    run: ({ p, bom }) => {
      const s = stability(p, bom, "design")[0];
      const W = (s.M / 1000) * 9.81; // N
      const headY = num(p, "armRootYMm") + num(p, "headReachMm");
      const h = num(p, "cameraHeightMm") + num(p, "headLensToTopMm") / 2; // head centre above the desk
      const down = headY > s.tipY ? (W * (s.tipY - s.cy)) / (headY - s.tipY) : Infinity;
      const fwd = (W * (s.tipY - s.cy)) / h, back = (W * (s.tipY + s.cy)) / h, side = (W * (s.tipX - Math.abs(s.cx))) / h;
      const sideMin = Math.min(fwd, back, side);
      const holds = down >= num(p, "pushDownN") && sideMin >= num(p, "pushSideN");
      return {
        status: holds ? "pass" : "flag",
        detail:
          `${Math.round(s.M)} g with its centre of mass ${f1(s.tipY - s.cy)} mm inside the front feet. Pressing down on the head ` +
          `(${f1(headY - s.tipY)} mm past the front feet) tips it at ${f1(down)} N; a push at head height (${Math.round(h)} mm) tips it at ` +
          `${f1(fwd)} N forward, ${f1(back)} N backward, ${f1(side)} N sideways. Design loads: ${p.pushDownN} N down, ${p.pushSideN} N sideways.` +
          (holds ? "" : " Bending a gooseneck takes more force than this, so the base must be held with the other hand while the arm is adjusted " +
            "(the build plan and the teacher notes in design.md say so). More steel does not fit under the junction board; a wider or deeper base, or the arm root further back, would fix it in the next version."),
      };
    },
  },
  {
    id: "drop",
    title: "Survives a fall from desk height",
    scope: "assembly",
    needs: ["dropHeightMm"],
    run: ({ p, bom }) => {
      const s = stability(p, bom, "design")[0];
      const e = (s.M / 1000) * 9.81 * (num(p, "dropHeightMm") / 1000);
      return {
        status: "flag",
        detail:
          `No check here can show it. A ${Math.round(s.M)} g unit falling ${p.dropHeightMm} mm lands with about ${e.toFixed(1)} J. ` +
          `Weak points: the ${p.headWallMm} mm head top that the arm nipple clamps (nut inside, coupling outside), the camera held by hot glue on its pins, ` +
          `the junction board on two staked pins, and the PA12 base corners. Test the first unit: drop it from desk height onto the head, then onto a base corner, ` +
          `then run the unit test sheet. Record the result in the build log before building the other units.`,
      };
    },
  },
  {
    id: "arm-reach",
    title: "Gooseneck is long enough to reach the design pose",
    scope: "assembly",
    needs: ["armLengthMm", "armMinBendRadiusMm", "armEndRigidMm", "headReachMm", "cameraHeightMm", "cameraTiltDeg", "headLensToTopMm",
      "headNippleYMm", "headNippleLengthMm", "headWallMm", "nutThicknessMm", "couplingHeightMm", "baseHeightMm", "armCollarHeightMm",
      "couplingSeatDepthMm", "baseNippleEngagementMm"],
    run: ({ p }) => {
      const R = num(p, "armMinBendRadiusMm");
      const a = armPath(p, R);
      const L = num(p, "armLengthMm");
      let rMax = R;
      while (rMax < 200 && armPath(p, rMax + 1).need <= L) rMax += 1;
      return ok(a.need <= L,
        `The arm leaves the base coupling (top ${f1(a.baseTop)} mm up) pointing straight up and enters the head's top coupling ` +
        `(${f1(a.yh - num(p, "armRootYMm"))} mm forward, ${f1(a.zh)} mm up) pointing ${p.cameraTiltDeg} deg off straight down, a turn of ` +
        `${180 - num(p, "cameraTiltDeg")} deg. At a ${R} mm minimum bend radius, with ${p.armEndRigidMm} mm rigid threaded ends and ` +
        `${f1(a.engBase)} + ${f1(a.engHead)} mm inside the couplings, it needs ${Math.round(a.need)} mm; the gooseneck is ${L} mm` +
        (a.need <= L ? `, which still fits up to a ${rMax} mm bend radius. ` : ". ") + `Bend radius and end lengths are ${p.armBendNote}.`);
    },
  },
  {
    id: "camera-cable",
    title: "Camera cable reaches the Pi without a long loose loop",
    scope: "assembly",
    needs: ["cameraCablePathMm", "cameraCableSlackMm", "cameraCableStowMaxMm", "cameraCableThroughArm"],
    run: ({ p, bom }) => {
      const len = Number(specOf(bom, "camera-cable", "lengthMm") ?? 0);
      if (num(p, "cameraCableThroughArm") === 1) return { status: "fail", detail: "The flat camera cable can't go through a gooseneck" };
      const path = num(p, "cameraCablePathMm");
      const lo = path + num(p, "cameraCableSlackMm"), hi = path + num(p, "cameraCableStowMaxMm");
      return ok(len >= lo && len <= hi,
        `${len} mm cable; the path in the head is about ${path} mm (the 20 mm gap between the Pi's camera connector and the camera's FPC edge, ` +
        `a 6 mm drop, about 4 mm into each connector), so ${lo} to ${hi} mm works: at least ${p.cameraCableSlackMm} mm spare, at most ` +
        `${p.cameraCableStowMaxMm} mm of loose loop, which is all the gap under the arm nut can hold. Pi and camera are both in the head, so the flat cable never enters the arm.`);
    },
  },
  {
    id: "harness-length",
    title: "Arm harness reaches from the base board to the head board",
    scope: "assembly",
    needs: ["harnessCutLengthMm", "armLengthMm", "harnessBaseRunMm", "harnessHeadRunMm", "armHardwareRunMm", "harnessSlackMm"],
    run: ({ p, bom }) => {
      const need = num(p, "armLengthMm") + num(p, "harnessBaseRunMm") + num(p, "harnessHeadRunMm") + num(p, "armHardwareRunMm") + num(p, "harnessSlackMm");
      const stock = Number(specOf(bom, "harness", "lengthMm") ?? 0);
      const cut = num(p, "harnessCutLengthMm");
      return ok(cut >= need && cut <= stock,
        `Cut ${cut} mm from ${stock} mm stock; path ${need} mm (arm ${p.armLengthMm} + base ${p.harnessBaseRunMm} + head ${p.harnessHeadRunMm} + pipe fittings ${p.armHardwareRunMm} + slack ${p.harnessSlackMm})`);
    },
  },
  {
    id: "harness-conductors",
    title: "Harness has a conductor for every arm signal",
    scope: "assembly",
    needs: ["harness5vConductors", "harnessGndConductors", "harnessSignalConductors"],
    run: ({ p, bom }) => {
      const have = Number(specOf(bom, "harness", "conductors") ?? 0);
      const need = num(p, "harness5vConductors") + num(p, "harnessGndConductors") + num(p, "harnessSignalConductors");
      return ok(need <= have, `${need} needed (${p.harness5vConductors} x 5V, ${p.harnessGndConductors} x GND, ${p.harnessSignalConductors} signals: SPK+, SPK-, LED, BTN) of ${have}`);
    },
  },
  {
    id: "harness-bore",
    title: "Arm harness fits through the gooseneck bore",
    scope: "assembly",
    needs: ["armBoreMm", "maxBoreFillPct"],
    run: ({ p, bom }) => {
      const n = Number(specOf(bom, "harness", "conductors") ?? 0);
      const od = Number(specOf(bom, "harness", "wireOdMm") ?? 0);
      const area = n * Math.PI * (od / 2) ** 2;
      const minBore = 2 * Math.sqrt(area / (num(p, "maxBoreFillPct") / 100) / Math.PI);
      const bore = Number(p.armBoreMm);
      if (!Number.isFinite(bore))
        return { status: "flag", detail: `Bore not published by the seller. ${n} x ${od} mm wires = ${area.toFixed(1)} mm2, which needs a ${minBore.toFixed(1)} mm bore at ${p.maxBoreFillPct}% fill. Measure the first gooseneck and the nipples, then set armBoreMm.` };
      return ok(bore >= minBore, `${n} x ${od} mm wires need ${minBore.toFixed(1)} mm at ${p.maxBoreFillPct}% fill; bore ${bore} mm`);
    },
  },
  {
    id: "pin-map",
    title: "GPIO assignments don't collide (I2S, SPI status LEDs, buttons, lights)",
    scope: "part",
    needs: ["gpioI2sBclk", "gpioI2sLrclk", "gpioI2sDin", "gpioI2sDout", "gpioAmpSd", "gpioLedData", "gpioTalkButton",
      "gpioMuteSense", "gpioCameraLed", "i2sPins", "spi0Pins", "neopixelCapablePins"],
    run: ({ p }) => {
      const use = {
        "I2S BCLK": num(p, "gpioI2sBclk"), "I2S LRCLK": num(p, "gpioI2sLrclk"), "I2S DIN": num(p, "gpioI2sDin"), "I2S DOUT": num(p, "gpioI2sDout"),
        "amp SD": num(p, "gpioAmpSd"), "status LEDs": num(p, "gpioLedData"), "talk button": num(p, "gpioTalkButton"),
        "mute sense": num(p, "gpioMuteSense"), "camera light": num(p, "gpioCameraLed"),
      };
      const problems = [];
      const seen = {};
      for (const [k, g] of Object.entries(use)) {
        if (seen[g]) problems.push(`GPIO${g} used by ${seen[g]} and ${k}`);
        seen[g] = k;
      }
      const i2s = pins(p.i2sPins), spi = pins(p.spi0Pins), npx = pins(p.neopixelCapablePins);
      const i2sUse = [use["I2S BCLK"], use["I2S LRCLK"], use["I2S DIN"], use["I2S DOUT"]];
      if (i2sUse.join() !== i2s.join()) problems.push(`I2S must sit on the PCM pins ${p.i2sPins}, got ${i2sUse.join(",")}`);
      const led = use["status LEDs"];
      if (!npx.includes(led)) problems.push(`status LEDs on GPIO${led}: NeoPixels only work on ${p.neopixelCapablePins}`);
      if (i2s.includes(led)) problems.push(`status LEDs on GPIO${led} collide with I2S`);
      const spiMode = spi.includes(led);
      for (const [k, g] of Object.entries(use)) {
        if (k.startsWith("I2S") || k === "status LEDs") continue;
        if (i2s.includes(g)) problems.push(`${k} on GPIO${g} is an I2S pin`);
        if (spiMode && spi.includes(g)) problems.push(`${k} on GPIO${g} is claimed by SPI0 (${p.spi0Pins})`);
      }
      return ok(problems.length === 0,
        problems.length ? problems.join("; ") :
          `${Object.entries(use).map(([k, g]) => `${k} ${g}`).join(", ")}; status LEDs use SPI0 MOSI, so ${p.spi0Pins} stay free of other uses`);
    },
  },
  {
    id: "gpio-current",
    title: "LEDs driven straight from a GPIO stay within the pad rating",
    scope: "assembly",
    needs: ["cameraLedMa", "gpioPinMaxMa"],
    run: ({ p }) => ok(num(p, "cameraLedMa") <= num(p, "gpioPinMaxMa"),
      `Camera light ${p.cameraLedMa} mA from GPIO${p.gpioCameraLed} vs ${p.gpioPinMaxMa} mA pad design limit`),
  },
  {
    id: "amp-speaker",
    title: "Amplifier and speaker match",
    scope: "assembly",
    needs: ["ampMaxOutputW", "speakerMaxW", "speakerRatedW", "ampMinLoadOhm"],
    run: ({ p, bom }) => {
      const z = Number(specOf(bom, "speaker", "impedanceOhm") ?? 0);
      const good = z >= num(p, "ampMinLoadOhm") && num(p, "ampMaxOutputW") <= num(p, "speakerMaxW");
      return ok(good,
        `${z} ohm speaker (amp rated into ${p.ampMinLoadOhm} ohm or more); amp peak ${p.ampMaxOutputW} W vs speaker ${p.speakerRatedW} W rated, ${p.speakerMaxW} W max` +
        (num(p, "ampMaxOutputW") > num(p, "speakerRatedW")
          ? (num(p, "ampVolumeCapW") <= num(p, "speakerRatedW")
            ? `. Software caps the volume at ${p.ampVolumeCapW} W (the datasheet's 1 % distortion point into 4 ohm), under the rated power.`
            : `. The volume cap (${p.ampVolumeCapW} W) is above the speaker's rating.`)
          : ""));
    },
  },
  {
    id: "mic-mute",
    title: "Microphone mute is hardware",
    scope: "part",
    needs: ["micMuteCutsSupply", "micMuteCutsData"],
    run: ({ p, bom }) => {
      const sw = lines(bom, "mic-mute-switch")[0];
      const poles = sw ? Number(sw.spec.poles) : 0;
      const supply = num(p, "micMuteCutsSupply") === 1, data = num(p, "micMuteCutsData") === 1;
      const needPoles = (supply ? 1 : 0) + (data ? 1 : 0);
      if (!sw) return { status: "fail", detail: "No mic-mute switch in the BOM" };
      if (poles < needPoles) return { status: "fail", detail: `Switch has ${poles} pole(s), the design needs ${needPoles}` };
      if (supply && data)
        return { status: "pass", detail: `${sw.name}: pole 2 opens the mic data line and grounds GPIO${p.gpioI2sDin}, so no audio reaches the Pi; pole 1 disconnects the mics' 3.3 V (left floating, so the clocks through the 1 k resistors can part-power them; the data cut is what makes the mute real) and lights the red light on the other throw. Software can't undo it; GPIO${p.gpioMuteSense} only reports it. It covers the built-in mics, not a Bluetooth headset's.` };
      return { status: "flag", detail: `Mute cuts only the ${supply ? "supply" : "data"}: ${supply ? "an unpowered mic can be back-fed through its clock pins" : "the mics stay powered"}` };
    },
  },
  {
    id: "camera-light",
    title: "Camera-on light",
    scope: "assembly",
    needs: ["cameraLedDrive"],
    run: ({ p, bom }) => {
      const shutter = qty(bom, "lens-shutter") > 0;
      if (p.cameraLedDrive !== "gpio")
        return { status: "pass", detail: `Camera light driven by ${p.cameraLedDrive}` };
      return {
        status: "flag",
        detail: `Software only, by choice in this build: the green light is on GPIO${p.gpioCameraLed} and the client turns it on when it starts the camera. ` +
          `A hardware light is possible without a custom PCB: the camera connector carries the camera's power-enable line (CAM_GPIO0 on the Zero 2 W schematic), ` +
          `which could drive the LED through a transistor breakout from a fine wire on that pin or an FPC pass-through. ` +
          (shutter ? "The printed lens shutter is the hardware guarantee: closed means the sensor sees nothing." : "No hardware shutter either."),
      };
    },
  },
  {
    id: "base-headroom",
    title: "Tallest parts fit inside the base",
    scope: "assembly",
    needs: ["baseHeightMm", "baseTopMm", "baseFloorMm", "talkButtonDepthMm", "speakerHeightMm", "ballastStandoffMm", "ballastDiscThicknessMm"],
    run: ({ p, bom }) => {
      const inside = num(p, "baseHeightMm") - num(p, "baseTopMm") - num(p, "baseFloorMm");
      const stack = num(p, "ballastStandoffMm") + qty(bom, "ballast") * num(p, "ballastDiscThicknessMm");
      const tallest = Math.max(num(p, "talkButtonDepthMm"), num(p, "speakerHeightMm"), stack);
      return ok(tallest <= inside,
        `${inside} mm inside; button ${p.talkButtonDepthMm}, speaker ${p.speakerHeightMm}, ballast on ribs ${f1(stack)} mm`);
    },
  },
  {
    id: "ballast-fit",
    title: "Steel discs fit inside the base around the arm root, clear of the speaker",
    scope: "assembly",
    needs: ["ballastDiscDiameterMm", "armRootXMm", "armRootYMm", "baseWallMm", "ballastClearanceMm", "speakerCenterXMm", "speakerCenterYMm", "speakerDiameterMm"],
    run: ({ p }) => {
      const r = num(p, "ballastDiscDiameterMm") / 2 + num(p, "ballastClearanceMm");
      const ix = num(p, "baseWidthMm") / 2 - num(p, "baseWallMm"), iy = num(p, "baseDepthMm") / 2 - num(p, "baseWallMm");
      const rx = num(p, "armRootXMm"), ry = num(p, "armRootYMm");
      const room = Math.min(ix - Math.abs(rx), iy - Math.abs(ry));
      const toSpeaker = Math.hypot(rx - num(p, "speakerCenterXMm"), ry - num(p, "speakerCenterYMm")) - num(p, "speakerDiameterMm") / 2;
      return ok(room >= r && toSpeaker >= r,
        `Disc radius + clearance ${f1(r)} mm; nearest wall ${f1(room)} mm from the root, speaker edge ${f1(toSpeaker)} mm`);
    },
  },
  {
    id: "arm-mount-stack",
    title: "Base nipple clamps coupling, shell, column and discs with the nut fully on, and leaves the harness room to turn out",
    scope: "assembly",
    needs: ["baseNippleLengthMm", "baseNippleEngagementMm", "couplingEngagementMinMm", "couplingEngagementMaxMm", "couplingHeightMm",
      "gooseneckEngagementMinMm", "baseHeightMm", "armCollarHeightMm", "couplingSeatDepthMm", "baseFloorMm", "harnessGrooveDepthMm",
      "harnessExitClearanceMm", "ballastStandoffMm", "nutThicknessMm"],
    run: ({ p }) => {
      const cb = num(p, "baseHeightMm") + num(p, "armCollarHeightMm") - num(p, "couplingSeatDepthMm"); // coupling's lower face
      const nutBottom = num(p, "baseFloorMm") + num(p, "ballastStandoffMm") - num(p, "nutThicknessMm");
      const groove = num(p, "baseFloorMm") - num(p, "harnessGrooveDepthMm");
      const L = num(p, "baseNippleLengthMm"), cH = num(p, "couplingHeightMm");
      const exitMin = num(p, "harnessExitClearanceMm"), gMin = num(p, "gooseneckEngagementMinMm");
      // The pipe's lower end sits at cb + e - L for e mm screwed into the coupling.
      const eMax = Math.min(num(p, "couplingEngagementMaxMm"), nutBottom - cb + L, cH - gMin);
      const eMin = Math.max(num(p, "couplingEngagementMinMm"), groove + exitMin - cb + L);
      const e = num(p, "baseNippleEngagementMm");
      const end = cb + e - L;
      return ok(eMin <= eMax && e >= eMin && e <= eMax,
        `Coupling seated at ${f1(cb)} mm (top ${p.baseHeightMm} + ${p.armCollarHeightMm} mm collar - ${p.couplingSeatDepthMm} mm seat); ` +
        `nut ${f1(nutBottom)} to ${f1(nutBottom + num(p, "nutThicknessMm"))} mm under the discs; harness groove floor ${f1(groove)} mm. ` +
        `A ${L} mm nipple works with ${f1(eMin)} to ${f1(eMax)} mm screwed into the coupling (nut fully on, at least ${exitMin} mm under the pipe end ` +
        `for the harness to turn out, at least ${gMin} mm of coupling left for the gooseneck). At the ${e} mm in the build plan the pipe end is ` +
        `${f1(end)} mm up, ${f1(end - groove)} mm above the groove floor, and the gooseneck gets ${f1(cH - e)} mm.`);
    },
  },
  {
    id: "pi-screws",
    title: "Pi screws engage the M2.5 inserts without bottoming out",
    scope: "assembly",
    needs: ["m25ScrewLengthMm", "piPcbThicknessMinMm", "piPcbThicknessMaxMm", "m25InsertLengthMm", "m25BlindExtraMm", "m3MinEngagementMm"],
    run: ({ p }) => {
      const deepest = num(p, "m25ScrewLengthMm") - num(p, "piPcbThicknessMinMm");
      const shallowest = num(p, "m25ScrewLengthMm") - num(p, "piPcbThicknessMaxMm");
      const room = num(p, "m25InsertLengthMm") + num(p, "m25BlindExtraMm");
      return ok(deepest <= room && shallowest >= num(p, "m3MinEngagementMm"),
        `M2.5 x ${p.m25ScrewLengthMm} through a ${p.piPcbThicknessMinMm} to ${p.piPcbThicknessMaxMm} mm board reaches ${f1(shallowest)} to ${f1(deepest)} mm ` +
        `into the post: a ${p.m25InsertLengthMm} mm insert over a ${p.m25BlindExtraMm} mm blind hole (${f1(room)} mm), at least ${p.m3MinEngagementMm} mm of thread`);
    },
  },
  {
    id: "shell-screws",
    title: "Shell screws engage the inserts without bottoming out",
    scope: "assembly",
    needs: ["m3ScrewLengthMm", "shellFlangeMm", "m3InsertLengthMm", "insertBlindExtraMm", "m3MinEngagementMm"],
    run: ({ p }) => {
      const e = num(p, "m3ScrewLengthMm") - num(p, "shellFlangeMm");
      const good = e >= num(p, "m3MinEngagementMm") && e <= num(p, "m3InsertLengthMm") + num(p, "insertBlindExtraMm");
      return ok(good, `M3 x ${p.m3ScrewLengthMm} through a ${p.shellFlangeMm} mm flange: ${f1(e)} mm into a ${p.m3InsertLengthMm} mm insert with ${p.insertBlindExtraMm} mm blind hole below`);
    },
  },
  {
    id: "standards",
    title: "Children's product and radio rules",
    scope: "part",
    needs: ["targetAgeMin", "targetAgeMax", "radioModule", "toyClassification"],
    run: ({ p }) => ({
      status: "flag",
      detail:
        `For ages ${p.targetAgeMin}-${p.targetAgeMax} this is a children's product in the US: CPSIA applies (third-party lab tests for lead in substrates and surface coatings, ` +
        `a Children's Product Certificate, permanent tracking labels on the unit and the box). Toy status is ${p.toyClassification}: if CPSC would call it a toy, ` +
        `ASTM F963 applies too (and phthalate limits). Radio: ${p.radioModule}; the finished unit still needs FCC Part 15 (15B unintentional-radiator testing, ` +
        `module FCC ID on the label; the speaker pair running ${p.harnessCutLengthMm} mm up the arm is the likeliest emitter). EU: CE under RED (radio, EMC, safety), RoHS, ` +
        `and the Toy Safety Directive if it is a toy. Data from children (camera, voice) also brings COPPA, which is software and policy, not hardware. ` +
        `Decision needed before units go to a school (it does not block building them): whether the pilot units need the CPC and FCC steps. ` +
        `The base underside carries a moulded supply warning and a unit-number field; a printed tracking label with the module FCC ID is still to be designed.`,
    }),
  },
  {
    id: "small-parts",
    title: "No small parts a child can detach",
    scope: "part",
    needs: ["smallPartsCylinderDiaMm", "smallPartsCylinderDepthMm", "targetAgeMin"],
    run: ({ p, bom }) => {
      const dia = num(p, "smallPartsCylinderDiaMm"), depth = num(p, "smallPartsCylinderDepthMm");
      const fits = (s) => {
        const d = String(s).split("x").map((x) => Number(x.trim())).sort((a, b) => a - b);
        return Math.hypot(d[0], d[1]) <= dia && d[2] <= depth;
      };
      const exposed = bom.lines.filter((l) => l.spec.accessibleDimsMm && fits(l.spec.accessibleDimsMm));
      const loose = exposed.filter((l) => !/^(captive|fixed)/.test(String(l.spec.retention ?? "")));
      const held = exposed.filter((l) => !loose.includes(l)).map((l) => l.id);
      const age = num(p, "targetAgeMin") >= 3 ? `The 16 CFR 1501 ban covers under-3s only, so it does not apply at ages ${p.targetAgeMin}+, but younger siblings will be near it.` : "Under-3 users: small parts are banned outright.";
      return {
        status: loose.length ? "flag" : "pass",
        detail: (loose.length
          ? `Could come off and fit the ${dia} mm test cylinder: ${loose.map((l) => `${l.name} (${l.spec.retention})`).join("; ")}. `
          : "Nothing small is detachable. ") + `Small but captive or fixed: ${held.join(", ") || "none"}. ${age}`,
      };
    },
  },
];
