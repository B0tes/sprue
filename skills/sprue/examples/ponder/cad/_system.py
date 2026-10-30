"""Ponder as one thing (not a part): the base, the arm and the head in one frame, for `sprue system`
(../../cad/system.py).

Frame: the base frame of _params.py. Origin at the base centre, x right, y forward (toward the child and the page), z up
from the underside of the bottom plate; the feet stand rubberFootHeightMm - rubberFootPocketDepthMm below it, on the
desk. The base parts come from their own files as they are. The head parts are drawn in the head frame and placed at
the design pose as rules.ts and figure.mjs place them: the lens tip headReachMm in front of the arm root and
cameraHeightMm above the desk, the head turned cameraTiltDeg nose-down about its long side, which runs along x.
rules.ts' armPath is planar (the gooseneck stays in the plane x = armRootXMm), so the head's nipple sits on that plane
and the lens lands LENS_X - NIP_X further along +x; camera() measures the page from the lens, so the page is centred
under it. Bought parts are envelopes at their bom.json sizes, at _fitcheck.py's where it has them, and at the fig*
estimates (figure sizes from the boards' drawings) where the BOM gives none. The shutter is drawn OPEN, slid
shutterTravelMm toward the Pi: the product as it is used, so the camera view looks through the open window.
"""

import importlib
import math
import pathlib

import numpy as np
from build123d import Cone, Cylinder, Edge, Face, Plane, Pos, RectangleRounded, RegularPolygon, Rot, Vector, Wire, extrude, sweep
from system import (
    DENSITY, Contact, Drawn, Fit, Inside, Item, Keepout, Light, PointMass, Port, Pose, Push, Sound, System, View, bom_lines,
    box, cyl, estimates,
)

from _params import (
    ARM_X, ARM_Y, B_CLEAR, B_TOP_IN, BASE_BOSSES, BASE_CBORE_DEPTH, BASE_PAD_TOP, BH, CAM_BACK_Z, CAM_FRONT_Z,
    CAM_HOLES, CAM_X0, CAM_X1, COLUMN_BOTTOM, COUPLING_BOTTOM, DIFF_Z, FEET, HD, HEAD_BOSSES, HH, HL, IX, IY, IZ1,
    JB_HOLES, JB_TOP, JB_X, JB_Y, JB_Z, LED_GREEN_X, LED_RED_X, LED_Z, LENS_TIP_Z, LENS_X, LENS_Y, MIC_XS, MIC_Z,
    NIP_X, NIP_Y, NUT_R, PI_HOLES, PI_L, PI_W, PI_X0, PI_X1, PI_Y0, PI_Y1, PI_Z, SH_TRAVEL, SPK_X, SPK_Y, SPLIT,
    STICK_X, STICK_Y, TALK_X, TALK_Y, TOG_H, TOG_W, TOG_Y, TOG_Z, USB_BOARD_Z, USB_X, USB_Y_BACK, USB_Z,
    WELL_DEPTH, hole_x, hole_y, n, P,
)

HERE = pathlib.Path(__file__).parent
BOM, S = bom_lines(HERE.parent)  # a line or field that isn't there fails the check, naming it


def part(name):
    return importlib.import_module(name).make()  # the part files have hyphens in their names


def dims(text):
    """'13.2 x 13.2 x 9.7 (0.52 x 0.52 x 0.38 in)' -> [13.2, 13.2, 9.7]: the mm sizes before any note."""
    return [float(v) for v in str(text).split("(")[0].split("x")]


def hexagon(r_corner, z0, z1, x=0.0, y=0.0):
    return Pos(x, y, z0) * extrude(RegularPolygon(r_corner, 6), z1 - z0)


def tube(r_out, r_in, z0, z1, x=0.0, y=0.0):
    return cyl(r_out, z0, z1, x, y) - cyl(r_in, z0 - 1, z1 + 1, x, y)


# ---- sizes that are not params -------------------------------------------------------------------------------------

DESK_Z = -(n("rubberFootHeightMm") - n("rubberFootPocketDepthMm"))  # the feet stand 2 mm proud of the plate
PAGE_Y0 = n("baseDepthMm") / 2 + n("pageGapFromBaseMm")  # the page's near edge, as rules.ts' camera() has it
PIPE_R = n("pipeThreadOdMm") / 2
# The nipples are "hollow" with no published bore: NPS 1/8 schedule 40's 0.269 in, from the same Nominal Pipe Size
# table design.json takes the 0.405 in OD from. Lamp nipples are often thinner-walled, so this is the heavier case.
PIPE_BORE_R = 0.269 * 25.4 / 2
M3_D, M25_D = 3.0, 2.5  # nominal major diameters of the M3 and M2.5 threads (ISO 261)
PIPE_BOTTOM = COUPLING_BOTTOM + n("baseNippleEngagementMm") - n("baseNippleLengthMm")  # as _fitcheck.py
DISC_T = n("ballastDiscThicknessMm")
# As built, the nut run up tight under the discs lifts them columnGapMm off the ribs until they meet the column
# (assembly step 27: "coupling, shell, column and discs clamp together"), so the stack is drawn clamped, as
# _fitcheck.py draws the discs; the ribs are then columnGapMm under the lower disc.
DISCS_BOTTOM = COLUMN_BOTTOM - 2 * DISC_T

# Bought parts with no massG in bom.json: the weight their maker's page gives (fetched 2026-10-16), else one typical of
# the part, marked as an estimate. Together about 35 g of a product near 1.1 kg, most of it in the head.
PUBLISHED = {
    "mic": (0.4, "Adafruit 3421 product page"),
    "amp": (1.2, "Adafruit 3006 product page"),
    "usbc": (1.3, "Adafruit 4090 product page"),
    "junction": (6.0, "Adafruit 1608 product page, the bare board (its diode and resistor are a gram or so more)"),
    "stick": (2.57, "Adafruit 1426 product page"),
    "bonnet": (5.3, "Adafruit 3203 product page, the kit"),
    "talk": (4.6, "Adafruit 1440 product page"),
}
EST = estimates({
    "sd": (0.4, "a microSD card"),
    "cam": (4.0, "a 25 x 24 mm camera board with its lens; Raspberry Pi's product brief gives no weight"),
    "camcable": (0.3, "38 mm of flat cable"),
    "mute": (5.0, "a miniature toggle with its panel nut"),
    "ledcam": (0.3, "a 5 mm LED"),
    "ledmute": (0.3, "a 5 mm LED"),
    "ins25": (0.4, "a brass M2.5 x 4 insert"),
    "scr25": (0.3, "an M2.5 x 6 steel pan-head screw"),
    "feet": (0.3, "a small rubber bumper; Adafruit gives none"),
})


def mass(line):
    m = S[line].get("massG")
    if isinstance(m, (int, float)):
        return float(m), "bom.json"
    if line in PUBLISHED:
        return PUBLISHED[line]
    g, why = EST[line]
    return g, f"estimate: {why}"


def bought(id, line, shape, tags=(), material=None):
    """A bought part. A metal one whose bom.json line names its metal gets that material, so its mass is its volume
    at that density (system.py's rule for metal parts) and the antenna keepout sees it; the rest get bom.json's massG,
    their maker's published weight or an estimate, and "metal" in their tags if they are metal."""
    if material:
        return Item(id, shape, line=line, material=material, tags=tags, model="envelope")
    m, note = mass(line)
    return Item(id, shape, line=line, mass_g=m, mass_note=note, tags=tags, model="envelope")


def grams(it):
    """An item's mass by system.py's rule, for the head that the straight-out poses swap for one PointMass."""
    if it.material:
        key = f"{it.material}DensityGPerCm3".lower()
        rho = next((float(v) for k, v in P.items() if k.lower() == key),
                   next(v for m, v in DENSITY.items() if m.lower() == it.material.lower()))
        return it.shape.volume / 1000 * rho
    return it.mass_g


# ---- the head at the design pose -----------------------------------------------------------------------------------

TILT = n("cameraTiltDeg")
_t = math.radians(TILT)
_R = np.array([[1, 0, 0], [0, math.cos(_t), -math.sin(_t)], [0, math.sin(_t), math.cos(_t)]])  # = Rot(TILT, 0, 0)
LENS_HEAD = np.array([LENS_X, LENS_Y, LENS_TIP_Z])  # the lens tip, head frame (rules.ts' headLensToTopMm is HH - this z)
LENS_AT = np.array([ARM_X + (LENS_X - NIP_X), ARM_Y + n("headReachMm"), DESK_Z + n("cameraHeightMm")])


def H(p):
    """A head-frame point in the product frame."""
    return tuple(LENS_AT + _R @ (np.asarray(p, float) - LENS_HEAD))


def Hd(v):
    """A head-frame direction in the product frame."""
    return tuple(_R @ np.asarray(v, float))


def place(shape):
    return Pos(*LENS_AT) * Rot(TILT, 0, 0) * Pos(*(-LENS_HEAD)) * shape


# ---- the gooseneck at the design pose, as figure.mjs lays it (rules.ts' armPath ends) ------------------------------

C_H = n("couplingHeightMm")
L_ARM = n("armLengthMm")
ENG_B = C_H - n("baseNippleEngagementMm")  # the gooseneck's thread inside the base coupling
ENG_H = C_H - (n("headNippleLengthMm") - n("headWallMm") - n("nutThicknessMm"))  # and inside the head coupling
OUT_B, OUT_H = (max(0.0, n("armEndRigidMm") - e) for e in (ENG_B, ENG_H))
BASE_COUPLING_TOP = COUPLING_BOTTOM + C_H


def arm_solve():
    """The gooseneck's route, coupling to coupling, in the plane x = ARM_X as (y, z) points: in the base coupling, its
    rigid end straight up, a rise, one bend and a straight into the head coupling along the head's -z, solved for
    armLengthMm (figure.mjs route). Returns the points it passes (its bottom in the base coupling, the base coupling's
    top, the rigid end's top, the bend's start), the bend's centre, radius and turn, and the points after it (the head
    rigid end's start, the head coupling's top, its end in the head coupling)."""
    hz = np.array(Hd((0, 0, 1)))
    e0 = np.array(H((NIP_X, NIP_Y, HH + C_H)))  # the head coupling's top
    s0 = np.array([ARM_X, ARM_Y, BASE_COUPLING_TOP])
    s1, e1 = s0 + [0, 0, OUT_B], e0 + hz * OUT_H
    flex = L_ARM - ENG_B - ENG_H - OUT_B - OUT_H
    de = np.array([-hz[1], -hz[2]])  # heading into the head coupling, (y, z)
    turn = math.pi / 2 - math.atan2(de[1], de[0])
    arc = np.array([1 - math.sin(math.pi / 2 - turn), math.cos(math.pi / 2 - turn)])
    a, R, b = np.linalg.solve([[0, arc[0], de[0]], [1, arc[1], de[1]], [1, turn, 1]], [e1[1] - s1[1], e1[2] - s1[2], flex])
    assert a > 0 and b >= 0 and R >= n("armMinBendRadiusMm"), (a, R, b)
    before = [(s0[1], s0[2] - ENG_B), (s0[1], s0[2]), (s1[1], s1[2]), (s1[1], s1[2] + a)]
    after = [(e1[1], e1[2]), (e0[1], e0[2]), (e0[1] - hz[1] * ENG_H, e0[2] - hz[2] * ENG_H)]
    return before, (s1[1] + R, s1[2] + a), R, turn, after


def arm_route():
    """Points along the whole gooseneck, coupling to coupling (arm_solve), the bend in 60 steps."""
    before, c, R, turn, after = arm_solve()
    bend = [(c[0] + R * math.cos(math.pi - turn * i / 60), c[1] + R * math.sin(math.pi - turn * i / 60)) for i in range(1, 61)]
    return [np.array([ARM_X, y, z]) for y, z in before + bend + after]


def arm_tube():
    """The gooseneck as the 3D model draws it: a tube armOuterDiameterMm across (an estimate) along arm_solve()'s route,
    one straight from its end in the base coupling up to the bend, the bend, and one straight into the head coupling to
    its end there. The corrugations aren't drawn."""
    before, c, R, turn, after = arm_solve()
    at = lambda yz: Vector(ARM_X, *yz)  # noqa: E731
    bend = [(c[0] + R * math.cos(math.pi - turn * t), c[1] + R * math.sin(math.pi - turn * t)) for t in (0.5, 1)]
    path = Wire([Edge.make_line(at(before[0]), at(before[-1])), Edge.make_three_point_arc(at(before[-1]), at(bend[0]), at(bend[1])),
                 Edge.make_line(at(bend[1]), at(after[-1]))])
    return sweep(Face(Wire.make_circle(n("armOuterDiameterMm") / 2, Plane(origin=path @ 0, z_dir=path % 0))), path)


def centroid(pts):
    """The centre of mass of a uniform wire along the points."""
    seg = [(a + b) / 2 for a, b in zip(pts, pts[1:])]
    w = [np.linalg.norm(b - a) for a, b in zip(pts, pts[1:])]
    return sum(s * l for s, l in zip(seg, w)) / sum(w), sum(w)


ROUTE_COM, ROUTE_LEN = centroid(arm_route())


# ---- the parts -----------------------------------------------------------------------------------------------------


def coupling(id, shape):
    # Grand Brass names the finish (black powdercoat), not the metal: the envelope's volume at steel's density.
    g = shape.volume / 1000 * DENSITY["steel"]
    return Item(id, shape, line="coupling", mass_g=g, mass_note="estimate: the envelope's volume at steel's 7.85 g/cm3",
                tags=("metal",), model="envelope")


def base_items():
    items = [
        Item("base-top", part("base-top"), line="basetop", material=S["basetop"]["material"]),
        Item("base-bottom", part("base-bottom"), line="basebot", material=S["basebot"]["material"]),
        Item("diffuser", part("diffuser"), line="diffuser", material=S["diffuser"]["material"], tags=("transparent",)),
    ]
    # The speaker, cone up, its rim against the top skin under the grille (assembly step 23): the magnet, then the
    # basket flaring out to the rim.
    mag_d, mag_h = dims(P["figSpeakerMagnetMm"])
    z0 = B_TOP_IN - n("speakerHeightMm")
    basket = B_TOP_IN - z0 - mag_h
    spk = cyl(mag_d / 2, z0, z0 + mag_h, SPK_X, SPK_Y) + \
        Pos(SPK_X, SPK_Y, z0 + mag_h + basket / 2) * Cone(mag_d / 2, n("speakerDiameterMm") / 2, basket)
    items.append(bought("spk", "spk", spk))
    # The talk button inside Adafruit's "max dimensions" (the BOM's bodyMm, 18.06 x 18 mm): its body, lugs and ring
    # nut as one block from talkButtonDepthMm under the top up to the skin, which the nut clamps; then the cap
    # (accessibleDimsMm) through the 16 mm hole and the 5 mm it stands above the top.
    bw, bd, _ = dims(S["talk"]["bodyMm"])
    cap_w, _, cap_h = dims(S["talk"]["accessibleDimsMm"])
    talk = box(TALK_X - bw / 2, TALK_X + bw / 2, TALK_Y - bd / 2, TALK_Y + bd / 2, BH - n("talkButtonDepthMm"), B_TOP_IN) + \
        cyl(cap_w / 2, B_TOP_IN, BH + cap_h, TALK_X, TALK_Y)
    items.append(bought("talk", "talk", talk))
    # The NeoPixel stick in its frame, LEDs up against the diffuser flange.
    sl, sw, sh = dims(S["stick"]["sizeMm"])
    items.append(bought("stick", "stick", box(STICK_X - sl / 2, STICK_X + sl / 2, STICK_Y - sw / 2, STICK_Y + sw / 2, DIFF_Z - sh, DIFF_Z)))
    # The USB-C breakout on its cradle: the board, and the receptacle with its mouth at the board's back edge, which
    # the cradle holds plateClearanceMm off the back wall.
    uw, ud, _ = dims(S["usbc"]["sizeMm"])
    rw, rd, rh = dims(P["figUsbcReceptacleMm"])
    y0 = USB_Y_BACK + B_CLEAR
    usb = box(USB_X - uw / 2, USB_X + uw / 2, y0, y0 + ud, USB_BOARD_Z, USB_BOARD_Z + n("figBreakoutPcbMm")) + \
        box(USB_X - rw / 2, USB_X + rw / 2, y0, y0 + rd, USB_Z - rh / 2, USB_Z + rh / 2)
    items.append(bought("usbc", "usbc", usb))
    # The junction board as _fitcheck.py has it: the board with 1.5 mm of trimmed leads under it and up to 4.5 mm of
    # parts over it (diode, resistor, wire ends), cut round its two posts and their pins.
    jx, jy = n("junctionBoardDepthMm") / 2, n("junctionBoardWidthMm") / 2
    jb = box(JB_X - jx, JB_X + jx, JB_Y - jy, JB_Y + jy, JB_Z - 1.5, JB_TOP + 4.5)
    for x, y in JB_HOLES:
        jb = jb - cyl(n("junctionPostMm") / 2 + 0.01, JB_TOP - 0.01, JB_TOP + 10, x, y) - cyl(n("junctionHoleMm") / 2, JB_Z - 5, JB_TOP + 10, x, y)
    items.append(bought("junction", "junction", jb))

    # The arm root: two discs clamped on the column by the nut, the base nipple 8 mm into the coupling on the collar.
    disc = S["ballast"]
    for k in (0, 1):
        z = DISCS_BOTTOM + k * DISC_T
        items.append(bought(f"ballast-{k + 1}", "ballast", tube(disc["diameterMm"] / 2, disc["holeMm"] / 2, z, z + DISC_T, ARM_X, ARM_Y), tags=("metal",)))
    nut_t = S["nut"]["thicknessMm"]
    items.append(bought("nut-base", "nut", hexagon(NUT_R, DISCS_BOTTOM - nut_t, DISCS_BOTTOM, ARM_X, ARM_Y)
                        - cyl(PIPE_R, 0, 60, ARM_X, ARM_Y), material="steel"))
    items.append(bought("nipple-base", "nipbase", tube(PIPE_R, PIPE_BORE_R, PIPE_BOTTOM, COUPLING_BOTTOM + n("baseNippleEngagementMm"), ARM_X, ARM_Y), material="steel"))
    items.append(coupling("coupling-base", tube(S["coupling"]["diameterMm"] / 2, PIPE_R, COUPLING_BOTTOM, BASE_COUPLING_TOP, ARM_X, ARM_Y)))

    # Six M3 inserts flush with the bosses' faces, six M3 x 8 up through the plate's counterbores into them.
    ins, scr = S["ins3"], S["scr3"]
    for k, (x, y) in enumerate(BASE_BOSSES, 1):
        items.append(bought(f"ins3-base{k}", "ins3", tube(ins["outerMm"] / 2, M3_D / 2, BASE_PAD_TOP, BASE_PAD_TOP + ins["lengthMm"], x, y), material="brass"))
        z = BASE_CBORE_DEPTH  # the counterbore's floor, under the head
        items.append(bought(f"scr3-base{k}", "scr3", cyl(n("m3HeadDiameterMm") / 2, z - n("m3HeadHeightMm"), z, x, y)
                            + cyl(M3_D / 2, z, z + scr["lengthMm"], x, y), material="steel"))
    # Rubber feet in their pockets: the BOM's 8 x 4 mm, the part below the plate tapering to half its radius as the
    # figure draws the dome, so it stands on the middle of each foot.
    f = S["feet"]
    pocket = n("rubberFootPocketDepthMm")
    for k, (x, y) in enumerate(FEET, 1):
        foot = cyl(f["diameterMm"] / 2, 0, pocket, x, y) + \
            Pos(x, y, DESK_Z / 2) * Cone(f["diameterMm"] / 4, f["diameterMm"] / 2, -DESK_Z)
        items.append(bought(f"foot{k}", "feet", foot, tags=("foot",)))
    return items


def head_items():
    """Everything in the head, in the head frame (placed by the caller)."""
    items = [
        Item("head-upper", part("head-upper"), line="headtop", material=S["headtop"]["material"]),
        Item("head-lower", part("head-lower"), line="headbot", material=S["headbot"]["material"]),
        # Open: slid shutterTravelMm toward the Pi, off the window.
        Item("shutter", Pos(-SH_TRAVEL, 0, 0) * part("shutter"), line="shutter", material=S["shutter"]["material"]),
    ]
    # The Pi Zero 2 W: the board, the 2x20 header with the bonnet's socket pressed on it (one stack, figPiHeaderHeightMm
    # tall), and the parts on its top at the figure's positions (along it from the SD end, across it from the port
    # edge, which faces the back wall).
    pcb_t = n("figPiPcbMm")
    top = PI_Z + pcb_t
    board = Pos((PI_X0 + PI_X1) / 2, (PI_Y0 + PI_Y1) / 2, PI_Z) * extrude(RectangleRounded(PI_L, PI_W, n("figPiCornerRadiusMm")), pcb_t)
    for x, y in PI_HOLES:
        board = board - cyl(n("figPiHoleMm") / 2, PI_Z - 1, top + 1, x, y)
    mid_x, mid_y = (PI_X0 + PI_X1) / 2, (PI_Y0 + PI_Y1) / 2

    def on_top(along, across, size, y_edge=None):
        l, w, h = dims(size)
        x, y = PI_X0 + along, (PI_Y0 + across) if y_edge is None else y_edge + w / 2
        return box(x - l / 2, x + l / 2, y - w / 2, y + w / 2, top, top + h)

    pitch = n("figHeaderPitchMm")
    hx0, hy = mid_x - 9.5 * pitch, PI_Y1 - n("piHoleInsetMm")  # pin 1 at the SD end, on the hole line
    pi = board + box(hx0 - pitch / 2, hx0 + 19.5 * pitch, hy - pitch, hy + pitch, top, top + n("figPiHeaderHeightMm"))
    pi = pi + on_top(n("figPiSocAlongMm"), n("figPiSocAcrossMm"), P["figPiSocSizeMm"])
    pi = pi + on_top(n("figPiRadioAlongMm"), n("figPiRadioAcrossMm"), P["figPiRadioSizeMm"])
    pi = pi + on_top(n("figPiHdmiAlongMm"), 0, P["figPiHdmiSizeMm"], y_edge=PI_Y0)
    for u in (n("figPiUsbAlongMm"), n("figPiPowerUsbAlongMm")):
        pi = pi + on_top(u, 0, P["figPiUsbSizeMm"], y_edge=PI_Y0)
    cl, cw, ch = dims(P["figPiCsiSizeMm"])
    pi = pi + box(PI_X1 - cw, PI_X1, mid_y - cl / 2, mid_y + cl / 2, top, top + ch)  # camera socket at the +x end
    sl, sw, sh = dims(P["figPiSdSlotSizeMm"])
    pi = pi + box(PI_X0, PI_X0 + sl, mid_y - sw / 2, mid_y + sw / 2, top, top + sh)  # SD slot at the -x end
    items.append(bought("pi", "pi", pi))
    # The card in its slot, standing out of the SD end as far as _fitcheck.py has it (2.4 mm).
    cl, cw, ct = dims(S["sd"]["accessibleDimsMm"])
    x0 = PI_X0 - 2.4
    items.append(bought("sd", "sd", box(x0, x0 + cl, mid_y - cw / 2, mid_y + cw / 2, top + (sh - ct) / 2, top + (sh + ct) / 2)))
    # The bonnet on the header, the amp on 1 mm of foam tape over the Pi's middle (the foam, inset as the figure has
    # it, is drawn with the amp).
    bon_z = top + n("figPiHeaderHeightMm")
    bon_t = dims(S["bonnet"]["sizeMm"])[2]
    bon_l, bon_w, _ = dims(S["bonnet"]["sizeMm"])
    items.append(bought("bonnet", "bonnet", Pos(mid_x, mid_y, bon_z) * extrude(RectangleRounded(bon_l, bon_w, n("figPiCornerRadiusMm")), bon_t)))
    al, aw, ah = dims(S["amp"]["sizeMm"])
    foam, amp_z = n("figFoamTapeMm"), bon_z + bon_t
    inset = 2.5  # the figure's inset of the foam square
    amp = box(mid_x - al / 2 + inset, mid_x + al / 2 - inset, mid_y - aw / 2 + inset, mid_y + aw / 2 - inset, amp_z, amp_z + foam) + \
        box(mid_x - al / 2, mid_x + al / 2, mid_y - aw / 2, mid_y + aw / 2, amp_z + foam, amp_z + foam + ah)
    items.append(bought("amp", "amp", amp))
    # The camera, lens down on its four pins: the board and its connector side as one box (as _fitcheck.py), with the
    # holes the pins go in, and the lens holder down to the lens tip.
    hw = n("cameraBoardWidthMm") / 2
    cam = box(CAM_X0, CAM_X1, LENS_Y - hw, LENS_Y + hw, CAM_FRONT_Z, CAM_BACK_Z)
    for x, y in CAM_HOLES:
        cam = cam - cyl(n("cameraHoleDiameterMm") / 2, CAM_FRONT_Z - 1, CAM_BACK_Z + 1, x, y)
    lb = n("figCameraLensBoxMm") / 2
    cam = cam + box(LENS_X - lb, LENS_X + lb, LENS_Y - lb, LENS_Y + lb, LENS_TIP_Z, CAM_FRONT_Z)
    items.append(bought("cam", "cam", cam))
    # The 38 mm cable's S-bend between the Pi's socket and the camera's FPC edge, as _fitcheck.py boxes it: the narrow
    # end centred on the Pi, the wide end on the camera.
    zc0, zc1 = PI_Z + 1.0, CAM_FRONT_Z + 2.5
    camcable = box(PI_X1, NIP_X, mid_y - n("figCameraCableNarrowEndMm") / 2, mid_y + n("figCameraCableNarrowEndMm") / 2, zc0, zc1) + \
        box(NIP_X, CAM_X0, LENS_Y - n("figCameraCableWideEndMm") / 2, LENS_Y + n("figCameraCableWideEndMm") / 2, zc0, zc1)
    items.append(bought("camcable", "camcable", camcable))
    # The mics, each board against the inside of the front wall with its sound hole on the port.
    ml, mw, mt = dims(S["mic"]["sizeMm"])
    for k, x in enumerate(MIC_XS, 1):
        items.append(bought(f"mic{k}", "mic", box(x - ml / 2, x + ml / 2, IY - mt, IY, MIC_Z - mw / 2, MIC_Z + mw / 2)))
    # The LEDs, pushed in from inside: the flange against the wall, the body through the 5 mm hole and the
    # accessibleDimsMm it stands proud of the front face.
    fl, ft = n("figLedFlangeMm") / 2, n("figLedFlangeThicknessMm")
    for id, x in (("ledcam", LED_GREEN_X), ("ledmute", LED_RED_X)):
        out = dims(S[id]["accessibleDimsMm"])[2]
        items.append(bought(id, id, hole_y(x, LED_Z, fl, IY - ft, IY) + hole_y(x, LED_Z, n("ledHoleMm") / 2, IY, HD / 2 + out)))
    # The mute toggle on the end wall, as the figure draws it: lugs, body, collar against the wall, bushing through it,
    # panel nut outside, and the lever, thrown up (live mics, the product in use; MUTE is down, toward the word).
    _, _, body_l = dims(S["mute"]["bodyMm"])
    bx1 = IX - 2  # the body stops 2 mm in from the wall, the collar between (figure.mjs and _fitcheck.py)
    bx0 = bx1 - body_l
    lug_w, lug_t = dims(P["figToggleLugMm"])
    nut_af, nut_t = dims(P["figToggleNutMm"])
    bush_r = S["mute"]["holeMm"] / 2
    bush_x1 = HL / 2 + nut_t + n("figToggleThreadPastNutMm")
    lever_l, lever_r, ang = S["mute"]["actuatorMm"], n("figToggleLeverMm") / 2, 20  # a miniature toggle throws ~20 deg
    lever_c = np.array([bush_x1, TOG_Y, TOG_Z]) + np.array([math.cos(math.radians(ang)), 0, math.sin(math.radians(ang))]) * lever_l / 2
    # The six lugs on the figure's grid (figure.mjs TOG_LUGS: 2.6 mm either side, 4 mm apart up the body), as one box.
    mute = box(bx0 - n("figToggleLugsMm"), bx0, TOG_Y - 2.6 - lug_w / 2, TOG_Y + 2.6 + lug_w / 2, TOG_Z - 4 - lug_t / 2, TOG_Z + 4 + lug_t / 2) + \
        box(bx0, bx1, TOG_Y - TOG_W / 2, TOG_Y + TOG_W / 2, TOG_Z - TOG_H / 2, TOG_Z + TOG_H / 2) + \
        hole_x(TOG_Y, TOG_Z, n("figToggleCollarMm") / 2, bx1, IX) + hole_x(TOG_Y, TOG_Z, bush_r, IX, bush_x1) + \
        Pos(HL / 2, TOG_Y, TOG_Z) * Rot(0, 90, 0) * extrude(RegularPolygon(nut_af / 2 / math.cos(math.radians(30)), 6), nut_t) + \
        Pos(*lever_c) * Rot(0, 90 - ang, 0) * Cylinder(lever_r, lever_l)
    items.append(bought("mute", "mute", mute))
    # The arm through the top: the nut flat under the top, the 1/2 in nipple through it, the coupling on the top face.
    nut_t = S["nut"]["thicknessMm"]
    z_nut = IZ1 - nut_t
    items.append(bought("nut-head", "nut", hexagon(NUT_R, z_nut, IZ1, NIP_X, NIP_Y) - cyl(PIPE_R, 0, 60, NIP_X, NIP_Y), material="steel"))
    items.append(bought("nipple-head", "niphead", tube(PIPE_R, PIPE_BORE_R, z_nut, z_nut + n("headNippleLengthMm"), NIP_X, NIP_Y), material="steel"))
    items.append(coupling("coupling-head", tube(S["coupling"]["diameterMm"] / 2, PIPE_R, HH, HH + C_H, NIP_X, NIP_Y)))
    # Four M3 inserts flush with the upper bosses' faces at the split; four M3 x 8 up through the lower shell's wells.
    ins, scr = S["ins3"], S["scr3"]
    for k, (x, y) in enumerate(HEAD_BOSSES, 1):
        items.append(bought(f"ins3-head{k}", "ins3", tube(ins["outerMm"] / 2, M3_D / 2, SPLIT, SPLIT + ins["lengthMm"], x, y), material="brass"))
        items.append(bought(f"scr3-head{k}", "scr3", cyl(n("m3HeadDiameterMm") / 2, WELL_DEPTH - n("m3HeadHeightMm"), WELL_DEPTH, x, y)
                            + cyl(M3_D / 2, WELL_DEPTH, WELL_DEPTH + scr["lengthMm"], x, y), material="steel"))
    # Four M2.5 inserts flush with the Pi posts, four M2.5 x 6 down through the Pi into them.
    i25, s25 = S["ins25"], S["scr25"]
    head_d, head_h = dims(P["figM25HeadMm"])
    for k, (x, y) in enumerate(PI_HOLES, 1):
        items.append(bought(f"ins25-{k}", "ins25", tube(i25["outerMm"] / 2, M25_D / 2, PI_Z - i25["lengthMm"], PI_Z, x, y), tags=("metal",)))
        items.append(bought(f"scr25-{k}", "scr25", cyl(head_d / 2, top, top + head_h, x, y) + cyl(M25_D / 2, top - s25["lengthMm"], top, x, y), tags=("metal",)))
    return [Item(i.id, place(i.shape), line=i.line, material=i.material, mass_g=i.mass_g, mass_note=i.mass_note,
                 tags=i.tags, model=i.model) for i in items]


# ---- system --------------------------------------------------------------------------------------------------------


def system():
    base, head = base_items(), head_items()
    items = base + head
    head_ids = tuple(i.id for i in head)

    # Mass that isn't a shape here. The gooseneck at the design pose: armMassG at armComForwardMm in front of its root,
    # as rules.ts has it, at the height of the centre of the route figure.mjs draws for it (a rise, one bend and a
    # straight into the head coupling): the arm climbs to about 310 mm before it turns down into the head, so its
    # centre is about 217 mm above the desk, not at the head or the root.
    arm_z = float(ROUTE_COM[2])
    rib = S["harness"]["massG"] / (S["harness"]["lengthMm"] / 1000)  # g per metre of the 10-wire ribbon
    in_arm = (L_ARM + n("armHardwareRunMm")) / 1000 * rib
    jumpers = 3500 / 1000 * rib / S["harness"]["conductors"] / 2  # bom.json: about 3.5 m of single wires; half each end
    head_c, head_top = H((0, 0, HH / 2)), H((0, 0, HH))
    wiring_head = n("harnessHeadRunMm") / 1000 * rib + jumpers
    wiring_base = PointMass("wiring-base", (JB_X, JB_Y, JB_TOP), n("harnessBaseRunMm") / 1000 * rib + jumpers, line="harness",
                            note="estimate: the harness's base run and half the jumpers, at the junction board")

    def arm_at(at):
        return [PointMass("arm", at, n("armMassG"), line="arm", note=P["armMassNote"]),
                PointMass("harness-arm", at, in_arm, line="harness", note="estimate: the ribbon in the arm and fittings")]

    # rules.ts flags both tipping cases and the design accepts them, so they are flags here too, with its reasons.
    push_ok = ("the gooseneck takes more force to bend than tips the unit, so the base is held with the other hand while "
               "the arm is adjusted (rules.ts tip-push; the build plan and teacher notes say so)")
    straight_ok = ("the unit falls over on the desk rather than off it, and there is no room for the steel that would hold "
                   "it (rules.ts tip-arm-straight; check it in the first-unit tip test)")
    design = Pose("as built, head over the page", items=arm_at((ARM_X, ARM_Y + n("armComForwardMm"), arm_z)) + [
        PointMass("wiring-head", head_c, wiring_head, line="harness", note="estimate: the harness's head run and half the jumpers"),
        wiring_base,
    ], pushes=[
        Push(f"{n('pushDownN'):g} N down on the head", head_top, (0, 0, -n("pushDownN")), accept=push_ok),
        *[Push(f"{n('pushSideN'):g} N {name} at head height", head_c, tuple(n("pushSideN") * v for v in d), accept=push_ok)
          for name, d in (("forward", (0, 1, 0)), ("backward", (0, -1, 0)), ("to the right", (1, 0, 0)), ("to the left", (-1, 0, 0)))],
    ])
    # A child pulls the gooseneck straight out, as rules.ts' tip-arm-straight has it: the arm's centre L/2 from the
    # root and the head's headDepthMm/2 past its end, level with the base coupling's top where the arm leaves it. The
    # head's items leave and two PointMasses of their mass stand in: what is known, and what is an estimate, so the
    # pose's estimatedG still counts the guesses.
    guess = lambda i: "estimate" in (i.mass_note or "").lower()  # noqa: E731
    head_g = sum(grams(i) for i in head if not guess(i))
    head_est = sum(grams(i) for i in head if guess(i)) + wiring_head
    straight = []
    for name, (dx, dy) in (("forward", (0, 1)), ("backward", (0, -1)), ("right", (1, 0)), ("left", (-1, 0))):
        at = lambda d: (ARM_X + dx * d, ARM_Y + dy * d, BASE_COUPLING_TOP)  # noqa: E731
        straight.append(Pose(f"arm pulled straight out {name}", drop=head_ids, items=arm_at(at(L_ARM / 2)) + [
            PointMass("head", at(L_ARM + HD / 2), head_g, note="the head's items whose mass is known, by system.py's mass rule"),
            PointMass("head-estimated", at(L_ARM + HD / 2), head_est,
                      note="estimate: the head's items whose mass is an estimate, and the harness's head run"), wiring_base],
            accept=straight_ok))

    in_base, in_head = ("base-top", "base-bottom"), ("head-upper", "head-lower")
    radio = dims(P["figPiRadioSizeMm"])
    rx, ry = PI_X0 + n("figPiRadioAlongMm"), PI_Y0 + n("figPiRadioAcrossMm")
    pixel = dims(S["stick"]["sizeMm"])[0] / S["stick"]["pixels"]
    # The page must sit inside the image with fovMarginDeg to spare on every side, as rules.ts' camera-fov has it.
    hfov, vfov = n("cameraHfovDeg") - 2 * n("fovMarginDeg"), n("cameraVfovDeg") - 2 * n("fovMarginDeg")
    return System(
        items=items,
        # The gap the design gives a bought board in a printed pocket (the mics in their rims); the shutter's track
        # and the diffuser's slot use the same 0.2 mm between printed parts. No engineer check reads a general minimum.
        min_clearance_mm=n("micPocketClearanceMm"),
        fits=[
            Fit("ins3-base*", "base-top", "each insert pressed hot into its 4.0 mm hole in a boss"),
            Fit("ins3-head*", "head-upper", "each insert pressed hot into its 4.0 mm hole in a boss"),
            Fit("ins25-*", "head-lower", "each insert pressed hot into its Pi post"),
            Fit("sd", "pi", "the card in its slot"),
        ],
        contacts=[
            # Threads and sockets drawn at their mating size: they touch all round, and the fit locates them (gap 0).
            Contact("scr3-*", "ins3-*", "each screw drawn at its insert's bore, which its thread cuts into", gap=0),
            Contact("scr25-*", "ins25-*", "each screw drawn at its insert's bore, which its thread cuts into", gap=0),
            Contact("nut-*", "nipple-*", "each nut on its nipple's thread", gap=0),
            Contact("nipple-*", "coupling-*", "each nipple screwed into its coupling", gap=0),
            Contact("camcable", "pi", "the narrow end in the Pi's camera socket", gap=0),
            Contact("camcable", "cam", "the wide end in the camera's socket", gap=0),
            Contact("ballast-2", "ballast-1", "the discs stacked on the nipple"),
            Contact("ballast-2", "base-top", "the nut clamps the discs up against the column"),
            Contact("nut-base", "ballast-1", "the nut run up tight under the discs"),
            Contact("coupling-base", "base-top", "the coupling in its seat on the collar"),
            Contact("base-top", "base-bottom", "the top's walls on the plate"),
            Contact("diffuser", "base-top", "the flange glued under the top skin, the rib in the slot"),
            Contact("stick", "diffuser", "the LEDs against the diffuser flange"),
            Contact("spk", "base-top", "the speaker's rim against the skin under the grille, in its ring"),
            Contact("talk", "base-top", "the ring nut clamps the top skin"),
            Contact("usbc", "base-bottom", "the breakout on its cradle"),
            Contact("junction", "base-top", "the board on its two posts, pins staked over it"),
            Contact("scr3-base*", "base-bottom", "each screw head on its counterbore's floor"),
            Contact("ins3-base*", "base-bottom", "each insert flush with its boss's face, which stands on the plate's pad"),
            Contact("foot*", "base-bottom", "each foot stuck into its pocket"),
            Contact("head-upper", "head-lower", "the lap joint: the upper's face on the lower's, the lip in the groove"),
            Contact("shutter", "head-lower", "the shutter slides on the floor of its track"),
            Contact("cam", "head-lower", "the camera on its four ledges and pins"),
            Contact("pi", "head-lower", "the Pi on its four posts"),
            Contact("pi", "ins25-*", "the Pi clamped on the inserts' faces"),
            Contact("scr25-*", "pi", "each screw head on the Pi, its M2.5 shank through the Pi's 2.75 mm hole "
                    "(Raspberry Pi's drawing)", gap=0),
            Contact("bonnet", "pi", "the bonnet's socket pressed onto the header"),
            Contact("amp", "bonnet", "the amp stuck on with foam tape"),
            Contact("mic*", "head-upper", "each mic against the front wall, in its rim"),
            Contact("led*", "head-upper", "the 5 mm body through its 5 mm hole, hot-glued, the flange against the wall inside"),
            Contact("mute", "head-upper", "the collar and the panel nut clamp the end wall"),
            Contact("nut-head", "head-upper", "the nut under the top, the coupling on it: they clamp the top"),
            Contact("coupling-head", "head-upper", "the coupling on the top face"),
            Contact("scr3-head*", "head-lower", "each screw head on its well's floor"),
            Contact("ins3-head*", "head-lower", "each insert flush with its boss's face, which stands on the lower shell's well"),
        ],
        inside=[Inside(p, in_base, w) for p, w in (
            ("spk", "the speaker"), ("stick", "the light bar"), ("usbc", "the USB-C breakout"), ("junction", "the junction board"),
            ("ballast-*", "the discs"), ("nut-base", "the base nut"), ("ins3-base*", "the inserts"), ("scr3-base*", "the screws, heads in their counterbores"))
        ] + [Inside(p, in_head, w) for p, w in (
            ("pi", "the Pi"), ("sd", "the SD card (captive)"), ("cam", "the camera"), ("camcable", "its cable"), ("bonnet", "the bonnet"),
            ("amp", "the amp"), ("mic*", "the mics"), ("nut-head", "the head nut"), ("ins3-head*", "the inserts"),
            ("scr3-head*", "the screws, heads in their wells"), ("ins25-*", "the Pi's inserts"), ("scr25-*", "the Pi's screws"))
        ],  # out by design: the talk cap, the feet, the nipples and couplings, the LEDs, the toggle, the shutter's nub
        unplaced={
            "psu": "the supply stands on the desk or in the wall socket; only its cable reaches the product",
            "diode": "on the junction board, inside the board's 4.5 mm parts envelope",
            "r220": "one on the junction board (in its envelope), two in-line at the stick, three on the LED legs: in the wiring",
            "r1k": "in-line in the mic clock wires on the bonnet (assembly step 13): wiring, not modelled",
            "harness": "ribbon: 690 mm through the arm, the rest peeled into jumpers; its mass rides as PointMasses",
        },
        drawn=[Drawn("arm", arm_tube(), line="arm",
                     why="the route the design pose bends it to (arm_solve, as figure.mjs draws it), armOuterDiameterMm "
                         "across (an estimate); it bends to each pose, so the stability gate weighs it as a PointMass in each "
                         "(armMassG, an estimate), placed counts it for its BOM line, and no other gate sees it")],
        poses=[design] + straight,
        min_tilt_deg=10.0,
        probes=[
            Sound("speaker", "spk", (SPK_X, SPK_Y, B_TOP_IN), (0, 0, 1), n("grilleDiameterMm") / 2, 0.20, aim_open=0.40,
                  why="the speaker's baffle opening (grilleDiameterMm, PUI's spec sheet) under the grille; Same Sky's micro "
                      "speaker enclosure guide: holes opening as little as 20% of the front protect the speaker, and 40 to "
                      "60% is a reasonable compromise"),
            *[Port(f"mic{k}-port", f"mic{k}", H((x, IY, MIC_Z)), Hd((0, 1, 0)), n("micPortMm") / 2,
                   why="the sound hole through the front wall, on the breakout's port") for k, x in enumerate(MIC_XS, 1)],
            # The page as rules.ts' camera() lays it: pageGapFromBaseMm in front of the base, centred under the lens.
            View("camera", H(LENS_HEAD), Hd((0, 0, -1)), Hd((1, 0, 0)), hfov, vfov, ignore=("cam",),
                 target=box(LENS_AT[0] - n("pageWidthMm") / 2, LENS_AT[0] + n("pageWidthMm") / 2, PAGE_Y0, PAGE_Y0 + n("pageLengthMm"),
                            DESK_Z - 0.1, DESK_Z),
                 why=f"Camera Module 3 Wide, {n('cameraHfovDeg'):g} x {n('cameraVfovDeg'):g} deg less fovMarginDeg each side, the long "
                     "side along the page (y); the shutter open; the whole page in the image with nothing in front of it"),
            # From just under the flange the stick lies against (from on it, the rays would start inside the diffuser
            # and meet nothing else), through the diffuser and out of the slot in the top skin.
            *[Light(f"pixel{k}", (STICK_X - dims(S['stick']['sizeMm'])[0] / 2 + pixel * (k - 0.5), STICK_Y, DIFF_Z - 0.06), (0, 0, 1), 60,
                    "out", 0.70, ignore=("stick",),
                    why="an end pixel of the stick (the worst placed); estimate: a 5050 RGB LED lights about 120 deg. 76% of "
                        "it gets out as drawn and no source gives a share, so 0.70 holds what the slot lets out now")
              for k in (1, S["stick"]["pixels"])],
            *[Light(f"{id}-light", H((x, IY, LED_Z)), Hd((0, 1, 0)), 30, "out", 0.9, ignore=(id,),
                    why="estimate: a diffused 5 mm LED lights about +/-30 deg; from where its body enters the 2 mm wall "
                        "(the die is further out), all of it should clear the hole")
              for id, x in (("ledcam", LED_GREEN_X), ("ledmute", LED_RED_X))],
            Keepout("pi-radio", place(box(rx - radio[0] / 2, rx + radio[0] / 2, ry - radio[1] / 2, ry + radio[1] / 2, PI_Z, PI_Z + n("figPiPcbMm") + radio[2])),
                    15.0, why="the Zero 2 W's radio (figPiRadio*, an estimate: Raspberry Pi's brief and drawing don't locate "
                              "the antenna); Espressif's hardware design guidelines ask for 15 mm of clearance round an antenna "
                              "inside the housing, in all directions, and give no number for metal: we apply the 15 mm to metal"),
        ],
        note=(f"Design pose: lens tip at ({LENS_AT[0]:.1f}, {LENS_AT[1]:.1f}, {LENS_AT[2]:.1f}), the head nipple on x = "
              f"armRootXMm; the arm's route is {ROUTE_LEN:.0f} mm with its centre {ROUTE_COM[1] - ARM_Y:.1f} mm in front "
              f"of the root and {ROUTE_COM[2] - DESK_Z:.0f} mm above the desk. Shutter open."),
    )
