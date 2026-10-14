"""Ponder head, lower shell: the floor with the camera window, the lens-shutter track, the
camera cradle on the Camera Module 3 hole pattern, the Pi Zero posts and the screw wells.

Head frame (see _params.py). Printed floor down. The camera sits lens-down on four pins whose
ledges reach in from outside the shutter's path, so the shutter slides underneath them.
"""

from build123d import Cone, Part, Pos

from _params import (
    CAM_FRONT_Z, CAM_HOLES, HEAD_BOSSES, IZ0, LENS_X, LENS_Y, LIP_X1, LIP_Z0, M25_BOSS, M25_HOLE,
    M3_CBORE, M3_CLEAR, NUB_L, NUB_W, NUB_X_CLOSED, PI_HOLES, PI_X0, PI_X1, PI_Y0, PI_Y1, PI_Z,
    RAIL_X0, RAIL_X1, RAIL_Y_IN, RAIL_Y_OUT, SH_CLEAR, SH_TRAVEL, SPLIT, TAIL_Y, WELL_DEPTH,
    WIN_R, WIN_R_OUT, box, cyl, head_inner, head_lip_ring, head_outer, n, slot_z, union,
)

LEDGE_T = n("cameraLedgeThicknessMm")
POST_W = n("cameraPostWidthMm")
POST_Y_OUT = RAIL_Y_OUT + 2.4  # the cradle posts stand just outside the shutter rails
LIP = n("shutterLipMm")
LIP_T = n("shutterLipThicknessMm")
WELL_R = n("headScrewWellOuterMm") / 2


def window() -> Part:
    """Camera window: straight at the floor's top face, flared toward the outside."""
    below = 0.5  # start under the bottom face so the cut is clean
    r_bot = WIN_R_OUT + (WIN_R_OUT - WIN_R) * below / IZ0
    flare = Pos(LENS_X, LENS_Y, (IZ0 - below) / 2) * Cone(r_bot, WIN_R, IZ0 + below)
    return flare + cyl(WIN_R, IZ0 - 0.2, IZ0 + 0.6, LENS_X, LENS_Y)


def make() -> Part:
    outer = head_outer()
    shell = outer - head_inner()
    lower = (shell & box(-200, 200, -200, 200, -1, SPLIT)) + (shell & head_lip_ring())

    feats = []
    # Shutter rails, with hold-down lips over the open half of the travel.
    for s in (-1, 1):
        y_in, y_out = sorted((s * RAIL_Y_IN, s * RAIL_Y_OUT))
        feats.append(box(RAIL_X0, RAIL_X1, y_in, y_out, IZ0 - 0.5, LIP_Z0 + LIP_T))
        ly_in, ly_out = sorted((s * (RAIL_Y_IN - LIP), s * RAIL_Y_OUT))
        feats.append(box(RAIL_X0, LIP_X1, ly_in, ly_out, LIP_Z0, LIP_Z0 + LIP_T))

    # Camera cradle: a post outside the rail at each hole, a ledge reaching in, a locating pin.
    for hx, hy in CAM_HOLES:
        s = 1 if hy > 0 else -1
        y0, y1 = sorted((s * RAIL_Y_OUT, s * POST_Y_OUT))
        feats.append(box(hx - POST_W / 2, hx + POST_W / 2, y0, y1, IZ0 - 0.5, CAM_FRONT_Z))
        l0, l1 = sorted((s * (abs(hy) - 1.5), s * POST_Y_OUT))
        feats.append(box(hx - POST_W / 2, hx + POST_W / 2, l0, l1, CAM_FRONT_Z - LEDGE_T, CAM_FRONT_Z))
        feats.append(cyl(n("cameraPinDiameterMm") / 2, CAM_FRONT_Z - 0.2,
                         CAM_FRONT_Z + n("cameraPinHeightMm"), hx, hy))

    # Pi Zero 2 W posts for M2.5 heat-set inserts.
    for x, y in PI_HOLES:
        feats.append(cyl(M25_BOSS / 2, IZ0 - 0.5, PI_Z, x, y))

    # Lower halves of the four shell-screw bosses: wells for the screw heads.
    for x, y in HEAD_BOSSES:
        feats.append(cyl(WELL_R, IZ0 - 0.5, SPLIT, x, y))

    lower = lower + (union(feats) & outer)

    cuts = [window()]
    # Floor slot for the shutter's thumb nub, from open to closed.
    half = (NUB_L - NUB_W) / 2
    sw = NUB_W + 2 * SH_CLEAR
    cuts.append(slot_z(NUB_X_CLOSED - SH_TRAVEL - half, TAIL_Y, NUB_X_CLOSED + half, TAIL_Y, sw,
                       -1, IZ0 + 0.3))
    # Insert holes in the Pi posts: insert length plus m25BlindExtraMm, so an M2.5 x 6 through a thin
    # board can't bottom out. The hole goes into the floor and leaves at least 1 mm under it.
    m25_bottom = PI_Z - n("m25InsertLengthMm") - n("m25BlindExtraMm")
    for x, y in PI_HOLES:
        cuts.append(cyl(M25_HOLE / 2, m25_bottom, PI_Z + 1, x, y))
    # Screw wells: counterbore from the bottom, then a clearance hole through the 3 mm flange.
    for x, y in HEAD_BOSSES:
        cuts.append(cyl(M3_CBORE / 2, -1, WELL_DEPTH, x, y))
        cuts.append(cyl(M3_CLEAR / 2, WELL_DEPTH - 0.1, SPLIT + 3, x, y))
    # Floor vents under the Pi, between its posts.
    vx0, vx1 = PI_X0 + 9.5, PI_X1 - 9.5
    k = 0
    while vx0 + k * 6 <= vx1:
        x = vx0 + k * 6
        cuts.append(slot_z(x, PI_Y0 + 8, x, PI_Y1 - 8, n("headVentWidthMm"), -1, IZ0 + 0.6))
        k += 1
    return lower - union(cuts)
