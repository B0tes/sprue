"""Shared numbers for Ponder's printed parts, read from ../design.json.

Two frames:
- Base parts (base-top, base-bottom, diffuser): origin at the base centre on the desk, +x right,
  +y forward toward the page and the child, z up. z = 0 is the underside of the bottom plate.
- Head parts (head-upper, head-lower, shutter): origin at the head centre in plan, z = 0 on the
  head's bottom face (the face with the camera window), x along the head's length, +y toward
  the child. The 15 deg nose-down tilt is applied at assembly, not in the parts.

Every number comes from design.json params; this file only derives positions from them.
"""

import json
import math
import pathlib

from build123d import (
    Axis, Box, Cylinder, Part, Pos, RectangleRounded, Rot, SlotCenterToCenter, extrude, fillet,
)

P = json.loads((pathlib.Path(__file__).parents[1] / "design.json").read_text())["params"]


def n(key: str) -> float:
    return float(P[key])


# ---- helpers ------------------------------------------------------------------------------


def rounded_block(w, d, h, r_plan, r_top=0.0, r_bot=0.0, z0=0.0) -> Part:
    """A rounded-rectangle block from z0 to z0 + h with filleted top and bottom edges."""
    b = extrude(RectangleRounded(w, d, r_plan), h)
    if r_top > 0:
        b = fillet(b.edges().group_by(Axis.Z)[-1], r_top)
    if r_bot > 0:
        b = fillet(b.edges().group_by(Axis.Z)[0], r_bot)
    return Pos(0, 0, z0) * b


def cyl(r, z0, z1, x=0.0, y=0.0) -> Part:
    """Vertical cylinder of radius r from z0 to z1."""
    return Pos(x, y, (z0 + z1) / 2) * Cylinder(r, z1 - z0)


def box(x0, x1, y0, y1, z0, z1) -> Part:
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def slot_z(x0, y0, x1, y1, width, z0, z1) -> Part:
    """Stadium-ended slot between two centres, extruded along z."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    length = math.hypot(x1 - x0, y1 - y0)
    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    s = extrude(SlotCenterToCenter(max(length, 1e-3), width), z1 - z0)
    return Pos(cx, cy, z0) * Rot(0, 0, ang) * s


def hole_y(x, z, r, y0, y1) -> Part:
    """Cylinder along y (through a front or back wall)."""
    return Pos(x, (y0 + y1) / 2, z) * Rot(90, 0, 0) * Cylinder(r, abs(y1 - y0))


def hole_x(y, z, r, x0, x1) -> Part:
    """Cylinder along x (through an end wall)."""
    return Pos((x0 + x1) / 2, y, z) * Rot(0, 90, 0) * Cylinder(r, abs(x1 - x0))


def slot_y(x, z, length, width, y0, y1) -> Part:
    """Stadium slot through a front or back wall, long axis along z."""
    s = extrude(SlotCenterToCenter(max(length - width, 1e-3), width), abs(y1 - y0))
    return Pos(x, max(y0, y1), z) * Rot(90, 0, 0) * Rot(0, 0, 90) * s


def union(parts) -> Part:
    out = None
    for p in parts:
        out = p if out is None else out + p
    return out


# ---- fasteners ----------------------------------------------------------------------------

M3_INSERT_HOLE = n("m3InsertHoleMm")
M3_INSERT_DEPTH = n("m3InsertLengthMm") + n("insertBlindExtraMm")
M3_CLEAR = n("m3ClearanceHoleMm")
M3_CBORE = n("m3HeadDiameterMm") + 2 * n("screwHeadClearanceMm")
M3_HEAD_H = n("m3HeadHeightMm")
FLANGE = n("shellFlangeMm")
M3_BOSS = n("m3BossDiameterMm")
M25_HOLE = n("m25InsertHoleMm")
M25_BOSS = M25_HOLE + 2 * n("insertMinWallMm")

# ---- base ---------------------------------------------------------------------------------

BW, BD, BH = n("baseWidthMm"), n("baseDepthMm"), n("baseHeightMm")
BWALL, BTOP, BFLOOR = n("baseWallMm"), n("baseTopMm"), n("baseFloorMm")
BR = n("baseCornerRadiusMm")
B_TOP_IN = BH - BTOP  # underside of the top skin
B_INNER_W, B_INNER_D = BW - 2 * BWALL, BD - 2 * BWALL
B_INNER_R = BR - BWALL
B_CLEAR = n("plateClearanceMm")

ARM_X, ARM_Y = n("armRootXMm"), n("armRootYMm")
DISC_R = n("ballastDiscDiameterMm") / 2
DISC_CLEAR = n("ballastClearanceMm")
RIB_TOP = BFLOOR + n("ballastStandoffMm")  # discs rest here
DISC_TOP = RIB_TOP + 2 * n("ballastDiscThicknessMm")
COLUMN_BOTTOM = DISC_TOP + n("columnGapMm")
# The arm coupling sits in a shallow seat on a low collar above the top skin, which lifts the base
# nipple's lower end clear of the floor so the harness can turn out from under it.
COLLAR_H = n("armCollarHeightMm")
COLLAR_R = n("couplingDiameterMm") / 2 + 0.3 + n("armCollarWallMm")
COUPLING_BOTTOM = BH + COLLAR_H - n("couplingSeatDepthMm")
NUT_BOTTOM = RIB_TOP - n("nutThicknessMm")  # the base nut sits under the discs
HARNESS_FLOOR = BFLOOR - n("harnessGrooveDepthMm")  # relief and groove floor under the nipple

# Screw positions: insert bosses in the top shell, counterbored holes in the plate. The plate
# has a pad at each so the screw passes through exactly shellFlangeMm of plastic.
BASE_BOSSES = [tuple(float(v) for v in xy.split(",")) for xy in P["baseBossXY"].split(";")]
BASE_CBORE_DEPTH = M3_HEAD_H + 0.2
BASE_PAD_TOP = BASE_CBORE_DEPTH + FLANGE  # boss bottom face in the top shell

FEET = [(sx * (BW / 2 - n("feetInsetMm")), sy * (BD / 2 - n("feetInsetMm")))
        for sx in (-1, 1) for sy in (-1, 1)]

SPK_X, SPK_Y = n("speakerCenterXMm"), n("speakerCenterYMm")
TALK_X, TALK_Y = n("talkButtonCenterXMm"), n("talkButtonCenterYMm")
STICK_X, STICK_Y = n("ledStickCenterXMm"), n("ledStickCenterYMm")
USB_X = n("usbcCenterXMm")
USB_BOARD_Z = BFLOOR + n("usbPlatformMm")  # underside of the USB-C breakout
USB_Z = USB_BOARD_Z + n("usbConnectorAboveBoardMm")  # receptacle centre
USB_Y_BACK = -BD / 2 + BWALL  # the breakout's connector edge sits on the back wall's inner face
USB_Y_FRONT = USB_Y_BACK + n("usbcDepthMm")

JB_X, JB_Y = n("junctionCenterXMm"), n("junctionCenterYMm")
JB_Z = n("junctionBoardZMm")  # underside of the junction board
JB_TOP = JB_Z + n("junctionBoardThicknessMm")
JB_HOLES = [(JB_X + s * n("junctionHoleSpacingMm") / 2, JB_Y) for s in (-1, 1)]

DIFF_L, DIFF_W = n("diffuserLengthMm"), n("diffuserWidthMm")
DIFF_FLANGE = n("diffuserFlangeMm")
DIFF_RIB_L, DIFF_RIB_W, DIFF_RIB_H = n("diffuserRibLengthMm"), n("diffuserRibWidthMm"), n("diffuserRibHeightMm")
DIFF_CLEAR = n("diffuserClearanceMm")
DIFF_Z = B_TOP_IN - DIFF_FLANGE  # flange underside (the flange sits against the top skin)


def base_inner_outline(offset=0.0, z0=0.0, h=1.0) -> Part:
    """The base cavity outline (inside of the walls) grown by `offset`, as a prism."""
    return Pos(0, 0, z0) * extrude(
        RectangleRounded(B_INNER_W + 2 * offset, B_INNER_D + 2 * offset, B_INNER_R + offset), h)


# ---- head ---------------------------------------------------------------------------------

HL, HD, HH = n("headLengthMm"), n("headDepthMm"), n("headHeightMm")
HWALL = n("headWallMm")
HR = n("headCornerRadiusMm")
H_TOPF, H_BOTF = n("headTopFilletMm"), n("headBottomFilletMm")
SPLIT = n("headSplitZMm")
IX, IY = HL / 2 - HWALL, HD / 2 - HWALL  # inner half-length and half-depth
IZ0, IZ1 = HWALL, HH - HWALL  # inner floor and inner ceiling

# Camera Module 3, mounted lens down, sensor long axis (the board's 25 mm side) along y.
# The edge with the mounting holes faces +x (the end wall); the FPC edge faces the Pi.
CAM_ALONG = n("cameraBoardWidthMm")  # 25, along y
CAM_ACROSS = n("cameraBoardOutlineMm")  # 23.862, along x
CAM_X1 = IX - n("cameraEndClearanceMm")  # hole-side edge
CAM_X0 = CAM_X1 - CAM_ACROSS  # FPC edge
LENS_X = CAM_X1 - n("cameraLensFromHoleEdgeMm")
LENS_Y = 0.0
CAM_HOLES = [(CAM_X1 - n("cameraHoleEdgeMm") - k * n("cameraHoleSpacingAcrossMm"),
              LENS_Y + s * n("cameraHoleSpacingAlongMm") / 2) for k in (0, 1) for s in (-1, 1)]
SH_T = n("shutterThicknessMm")
SH_CLEAR = n("shutterClearanceMm")
SH_TOP = IZ0 + SH_T  # shutter rests on the floor
LIP_Z0 = SH_TOP + 2 * SH_CLEAR
LENS_TIP_Z = SH_TOP + SH_CLEAR + n("cameraLensGapMm")
CAM_FRONT_Z = LENS_TIP_Z + n("cameraLensProtrusionMm")  # board's lens-side face
CAM_BACK_Z = LENS_TIP_Z + n("cameraDepthMm")  # top of the connector side
WIN_R = n("cameraWindowMm") / 2
WIN_R_OUT = n("cameraWindowOuterMm") / 2

# Lens shutter: closed covers the window with shutterOverlapMm all round; open is shutterTravelMm
# toward the Pi. The nub runs in a floor slot beside the window; the tail carries it.
SH_LEN = 2 * (WIN_R + n("shutterOverlapMm"))
SH_W = n("shutterWidthMm")
SH_TRAVEL = n("shutterTravelMm")
SH_X1_CLOSED = LENS_X + SH_LEN / 2
SH_X0_CLOSED = SH_X1_CLOSED - SH_LEN
TAIL_L, TAIL_W, TAIL_Y = n("shutterTailLengthMm"), n("shutterTailWidthMm"), n("shutterTailOffsetYMm")
NUB_L, NUB_W, NUB_DROP = n("shutterNubLengthMm"), n("shutterNubWidthMm"), n("shutterNubDropMm")
NUB_X_CLOSED = SH_X0_CLOSED - TAIL_L / 2
RAIL_Y_IN = SH_W / 2 + SH_CLEAR
RAIL_Y_OUT = RAIL_Y_IN + n("shutterRailWidthMm")
RAIL_X0 = SH_X0_CLOSED - SH_TRAVEL - 1.0
RAIL_X1 = IX - 0.01
LIP_X1 = SH_X0_CLOSED - 0.5  # lips stop where the closed shutter sits, so it drops in there

# Pi Zero 2 W, flat on posts in the lower shell, SD end at -x, CSI end toward the camera.
PI_L, PI_W = n("piBoardLengthMm"), n("piBoardWidthMm")
PI_X0 = -IX + n("piSdClearanceMm")
PI_X1 = PI_X0 + PI_L
PI_Y0 = -IY + n("piWallClearanceMm")
PI_Y1 = PI_Y0 + PI_W
PI_Z = IZ0 + n("piPostHeightMm")  # Pi underside
PI_HOLES = [(PI_X0 + n("piHoleInsetMm") + i * n("piHoleSpacingXMm"),
             PI_Y0 + n("piHoleInsetMm") + j * n("piHoleSpacingYMm")) for i in (0, 1) for j in (0, 1)]

# Arm nipple through the head top, in the gap between the Pi's CSI end and the camera.
NIP_X = (PI_X1 + CAM_X0) / 2
NIP_Y = n("headNippleYMm")
NUT_R = n("nutDiameterMm") / 2 / math.cos(math.radians(30))  # across corners

# Shell screws: front-left corner, back wall between the Pi and the camera, both camera-end
# corners (clear of the camera board's 25 mm width).
# The corner wells (radius 4) overlap the end and side walls by a few tenths of a millimetre:
# a well exactly tangent to the wall (IX - 4.0) left sliver triangles in the STL.
HEAD_BOSSES = [
    (-(IX - 3.6), IY - 3.7),
    (PI_X1 + 0.7 + n("headScrewWellOuterMm") / 2, -(IY - 3.5)),
    (IX - 3.6, IY - 3.7),
    (IX - 3.6, -(IY - 3.7)),
]
WELL_DEPTH = SPLIT - FLANGE  # screw head well from the bottom face

# Front face: two mic ports, the two privacy lights near the camera end.
MIC_XS = [n("micCenterXMm") + s * n("micSpacingMm") / 2 for s in (-1, 1)]
MIC_Z = n("micPortZMm")
LED_GREEN_X = LENS_X + n("cameraLedXOffsetMm")
LED_RED_X = LED_GREEN_X - n("ledSpacingMm")
LED_Z = n("ledZMm")

# Mute toggle on the +x end wall, above the camera, body lying along -x.
TOG_W, TOG_H = n("toggleBodyWidthMm"), n("toggleBodyHeightMm")
TOG_Z = IZ1 - 0.4 - TOG_H / 2
TOG_Y = 0.0


def head_outer() -> Part:
    return rounded_block(HL, HD, HH, HR, H_TOPF, H_BOTF)


def head_inner() -> Part:
    return rounded_block(HL - 2 * HWALL, HD - 2 * HWALL, HH - 2 * HWALL, HR - HWALL,
                         max(H_TOPF - HWALL, 0), max(H_BOTF - HWALL, 0), z0=HWALL)


def head_lip_ring(grow=0.0) -> Part:
    """Inner half of the wall, used as the lap joint at the split."""
    w = n("headLipWidthMm") + grow
    h = n("headLipHeightMm") + grow
    ring = extrude(RectangleRounded(HL - 2 * HWALL + 2 * w, HD - 2 * HWALL + 2 * w, HR - HWALL + w), h) \
        - extrude(RectangleRounded(HL - 2 * HWALL - 0.02, HD - 2 * HWALL - 0.02, HR - HWALL - 0.01), h)
    return Pos(0, 0, SPLIT) * ring
