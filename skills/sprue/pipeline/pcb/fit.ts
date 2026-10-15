// The fit check: the placed board against the params the case is built from. The case (cad/*.py, through
// cad/_params.py) and the design checks (stages/check.ts) work out where the keys, the controller and the screw holes
// are from design.json's params alone; the board code (cad/pcb.mjs) places them itself. A board that places one
// elsewhere passes every electrical check and still does not go into its case: a switch clipped into the plate
// misses its socket's holes, the USB receptacle sits behind the wall or faces into the case, a screw misses its
// insert. So each is held to the params, to FIT_TOL_MM:
//  (a) the outline: pcbWidthMm x pcbHeightMm, its corners pcbCornerMm, centred on the origin (board.ts centres it);
//  (b) the keys: socket K<n> at the centre of key n of the grid, which is row floor((n-1) / keyCols) from the bottom
//      and column (n-1) % keyCols from the left, at ((c - (keyCols-1)/2) keyPitchMm, -H/2 + pcbEdgeToKeyMm +
//      keyPitchMm (r + 1/2)), as _params.py key_centres and check.ts holes-clear-keys have it, and turned 0 or 180
//      degrees, the two ways a switch sits in its square plate cutout with its pins over the socket's holes;
//  (c) the controller: its centre at controllerCenterXMm, controllerCenterYMm, turned so its USB end faces +x, where
//      the case's USB opening and the lid's BOOTSEL hole are (top.py, check.ts usb-reach), and its body the
//      controllerLengthMm x controllerWidthMm the lid pockets;
//  (d) the screw holes: a non-plated hole of screwClearanceMm at each of (±(W/2 - holeInsetMm), ±(H/2 - holeInsetMm)),
//      under the case's bosses and inserts, with copper kept bossOuterMm / 2 from its centre, where the boss presses.
// The params are named as the case and the design checks read them (NEEDS). A part the board places whose params
// design.json does not give under those names is an error that names them, since then nothing holds the part to its
// case; the controller's turn is checked whatever the params. drc.json `fit` lists what was checked. Its errors go into
// drc.json with the audit's (pcb.ts), so a board that does not fit its case gets no zip.

import { rotate } from "./geometry.ts";
import { REFS } from "./refs.ts";
import type { BoardData } from "./types.ts";

/** How far a placed part may be from where the params put it. */
export const FIT_TOL_MM = 0.05;

const SOCKET = "kailh-mx-hotswap";
const CONTROLLER = "rpi-pico-castellated";
/** The way the controller's USB end faces in its footprint frame (footprints.ts: pin 1 and the shell's holes at +x). */
const USB_END: [number, number] = [1, 0];

export type Fit = { checked: string[]; errors: string[] };

/** The params each thing on the board is held to, under the names the case (cad/_params.py) and the design checks
 * (stages/check.ts) read, and what they place for the case. */
export const NEEDS = {
  outline: { params: ["pcbWidthMm", "pcbHeightMm", "pcbCornerMm"], case: "the case built round it" },
  sockets: { params: ["keyRows", "keyCols", "keyPitchMm", "pcbEdgeToKeyMm"], case: "the key grid the case's plate is cut for" },
  controller: { params: ["controllerCenterXMm", "controllerCenterYMm", "controllerLengthMm", "controllerWidthMm"], case: "the case's USB opening, its pocket and the lid's BOOTSEL hole" },
  holes: { params: ["holeInsetMm", "screwClearanceMm", "bossOuterMm"], case: "the case's bosses and inserts" },
} as const;

const r2 = (v: number) => `${Math.round(v * 100) / 100 + 0}`;
const at = (x: number, y: number) => `(${r2(x)}, ${r2(y)})`;
const off = (dx: number, dy: number) => `${r2(Math.hypot(dx, dy))} mm`;
const deg = (d: number) => ((d % 360) + 360) % 360;
const listed = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The placed board against design.json's params. */
export function checkFit(data: BoardData, params: Record<string, number | string> = {}): Fit {
  const errors: string[] = [], checked: string[] = [];
  const has = (...ks: string[]) => ks.every((k) => Number.isFinite(Number(params[k])) && params[k] !== "" && params[k] !== null);
  const n = (k: string) => Number(params[k]);
  /** Whether design.json gives every param `what` is held to; when it does not, an error that names the missing ones. */
  const need = (what: keyof typeof NEEDS, placed: string, it = "them") => {
    const { params: ks, case: against } = NEEDS[what], missing = ks.filter((k) => !has(k));
    if (missing.length)
      errors.push(`the board ${what === "outline" ? "has" : "places"} ${placed}, and design.json has no ${listed(missing)}, so nothing holds ${it} to ${against}: ` +
        `give design.json ${listed([...ks])}, under these names, which the case and the design checks read`);
    return !missing.length;
  };
  const W = has("pcbWidthMm") ? n("pcbWidthMm") : data.width, H = has("pcbHeightMm") ? n("pcbHeightMm") : data.height;

  // (a) the outline
  if (need("outline", "an outline", "it")) {
    checked.push(`the ${r2(W)} x ${r2(H)} mm outline`);
    if (Math.abs(data.width - W) > FIT_TOL_MM || Math.abs(data.height - H) > FIT_TOL_MM)
      errors.push(`the outline is ${r2(data.width)} x ${r2(data.height)} mm, and design.json's pcbWidthMm x pcbHeightMm, which the case is built round, ${r2(W)} x ${r2(H)} mm`);
    if (Math.abs(data.corner - n("pcbCornerMm")) > FIT_TOL_MM)
      errors.push(`the outline's corners are rounded ${r2(data.corner)} mm, and design.json's pcbCornerMm ${r2(n("pcbCornerMm"))} mm`);
  }

  // (b) the keys on the grid
  const sockets = data.parts.filter((p) => p.footprint === SOCKET);
  if (sockets.length && need("sockets", `${sockets.length} key socket${sockets.length === 1 ? "" : "s"}`, sockets.length === 1 ? "it" : "them")) {
    const rows = n("keyRows"), cols = n("keyCols"), pitch = n("keyPitchMm");
    let held = 0;
    for (const s of sockets) {
      const k = Number(/^K(\d+)$/.exec(s.ref)?.[1]);
      if (!(k >= 1 && k <= rows * cols)) continue; // the intent check fails a socket that is not one of the keys
      held++;
      const r = Math.floor((k - 1) / cols), c = (k - 1) % cols;
      const x = (c - (cols - 1) / 2) * pitch, y = -H / 2 + n("pcbEdgeToKeyMm") + pitch * (r + 0.5);
      const where = `key ${k} of design.json's grid (row ${r + 1} from the bottom, column ${c + 1} from the left)`;
      if (Math.abs(s.x - x) > FIT_TOL_MM || Math.abs(s.y - y) > FIT_TOL_MM)
        errors.push(`${s.ref} is at ${at(s.x, s.y)}, and ${where} at ${at(x, y)}: the switch clipped into the plate's cutout there would miss its socket's holes by ${off(s.x - x, s.y - y)}`);
      if (deg(s.rotDeg) % 180 !== 0)
        errors.push(`${s.ref} is turned ${deg(s.rotDeg)} degrees: under a switch in its plate cutout a socket is turned 0 or 180, so its holes meet the switch's pins`);
    }
    checked.push(`${held} socket${held === 1 ? "" : "s"} on the key grid`);
  }

  // (c) the controller: its turn whatever the params, as the case's USB opening is at +x whatever they are called
  const ctrl = data.parts.filter((p) => p.footprint === CONTROLLER);
  for (const u of ctrl) {
    const [dx, dy] = rotate(USB_END, u.rotDeg);
    if (Math.abs(dx - 1) > 1e-6 || Math.abs(dy) > 1e-6) {
      const way = Math.abs(dx + 1) < 1e-6 ? "-x, into the case" : dy > 0 ? "+y" : "-y";
      errors.push(`${u.ref} is turned ${deg(u.rotDeg)} degrees, so its USB end faces ${way}: the case's USB opening and the lid's BOOTSEL hole are at its +x end (check.ts usb-reach), so it goes in with rotDeg 0`);
    }
  }
  if (ctrl.length > 1) errors.push(`the board places ${ctrl.length} controllers (${listed(ctrl.map((u) => u.ref))}), and the case has a pocket and a USB opening for one`);
  if (ctrl.length === 1 && need("controller", ctrl[0].ref, "it")) {
    const u = ctrl[0], x = n("controllerCenterXMm"), y = n("controllerCenterYMm");
    checked.push(`${u.ref} at its place with its USB end to +x`);
    if (Math.abs(u.x - x) > FIT_TOL_MM || Math.abs(u.y - y) > FIT_TOL_MM)
      errors.push(`${u.ref} is centred at ${at(u.x, u.y)}, and design.json's controllerCenterXMm, controllerCenterYMm at ${at(x, y)}: ${off(u.x - x, u.y - y)} from where the case's USB opening, its pocket and the lid's BOOTSEL hole are`);
    const body = REFS[CONTROLLER].body;
    if (body) {
      const len = body.x1 - body.x0, wid = body.y1 - body.y0;
      if (Math.abs(len - n("controllerLengthMm")) > FIT_TOL_MM || Math.abs(wid - n("controllerWidthMm")) > FIT_TOL_MM)
        errors.push(`${u.ref}'s body is ${r2(len)} x ${r2(wid)} mm (${REFS[CONTROLLER].title}), and design.json's controllerLengthMm x controllerWidthMm, which the lid pockets, ${r2(n("controllerLengthMm"))} x ${r2(n("controllerWidthMm"))} mm`);
    }
  }

  // (d) the screw holes, when the board drills holes of its own (a footprint's carry its part's ref) or design.json
  // puts them in
  const parts = new Set(data.parts.map((p) => p.ref)), own = data.holes.filter((h) => !parts.has(h.ref));
  const drilled = own.length ? `${own.length} hole${own.length === 1 ? "" : "s"} of its own` : "";
  if (drilled ? need("holes", drilled) : has("holeInsetMm")) {
    const hx = W / 2 - n("holeInsetMm"), hy = H / 2 - n("holeInsetMm");
    checked.push("4 screw holes under the case's bosses");
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const x = sx * hx, y = sy * hy;
      const near = data.holes.filter((h) => Math.abs(h.x - x) <= FIT_TOL_MM && Math.abs(h.y - y) <= FIT_TOL_MM);
      const nearest = [...data.holes].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      const corner = `${sy < 0 ? "bottom" : "top"} ${sx < 0 ? "left" : "right"}`;
      if (!near.length) {
        errors.push(`there is no hole at ${at(x, y)}, the ${corner} screw hole design.json's holeInsetMm puts under the case's boss and insert` +
          (nearest ? ` (the nearest is at ${at(nearest.x, nearest.y)}, ${off(nearest.x - x, nearest.y - y)} away)` : ""));
        continue;
      }
      const h = near[0];
      if (Math.abs(h.drill - n("screwClearanceMm")) > 0.01)
        errors.push(`the ${corner} screw hole is ${r2(h.drill)} mm, and design.json's screwClearanceMm ${r2(n("screwClearanceMm"))} mm`);
      if (h.keepout < n("bossOuterMm") / 2 - 0.01)
        errors.push(`the ${corner} screw hole keeps copper ${r2(h.keepout)} mm from its centre, and the boss that presses there is ${r2(n("bossOuterMm"))} mm across (bossOuterMm)`);
    }
  }
  return { checked, errors };
}
