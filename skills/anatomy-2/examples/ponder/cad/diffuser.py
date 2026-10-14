"""Ponder light-bar diffuser (natural PETG): a flange that sits under the base top skin and a rib
that fills the slot over the NeoPixel stick, flush with the top surface.

Base frame, in its fitted position.
"""

from build123d import Axis, Part, Pos, RectangleRounded, SlotCenterToCenter, extrude, fillet

from _params import (
    B_TOP_IN, DIFF_FLANGE, DIFF_L, DIFF_RIB_H, DIFF_RIB_L, DIFF_RIB_W, DIFF_W, DIFF_Z, STICK_X,
    STICK_Y,
)


def make() -> Part:
    flange = Pos(STICK_X, STICK_Y, DIFF_Z) * extrude(RectangleRounded(DIFF_L, DIFF_W, 2.0), DIFF_FLANGE)
    rib = extrude(SlotCenterToCenter(DIFF_RIB_L - DIFF_RIB_W, DIFF_RIB_W), DIFF_RIB_H + 0.1)
    rib = fillet(rib.edges().group_by(Axis.Z)[-1], 0.8)
    rib = Pos(STICK_X, STICK_Y, B_TOP_IN - 0.1) * rib
    return flange + rib
