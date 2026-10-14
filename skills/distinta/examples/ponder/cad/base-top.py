"""Ponder base, top shell: the rounded cover with the speaker grille, talk-button hole, light-bar
slot, arm hole and a collar with the coupling seat, the printed column that clamps on the steel discs, the USB-C
opening in the back wall, posts for the junction board, and six bosses for M3 heat-set inserts.

Base frame (see _params.py). Printed top down. The walls stand on the bottom plate at z = baseFloorMm.
"""

import math

from build123d import Part, Pos, RectangleRounded, Rot, SlotCenterToCenter, extrude

from _params import (
    ARM_X, ARM_Y, B_INNER_D, B_INNER_R, B_INNER_W, B_TOP_IN, BASE_BOSSES, BASE_PAD_TOP, BD, BFLOOR,
    BH, BR, BTOP, BW, BWALL, COLLAR_H, COLLAR_R, COLUMN_BOTTOM, COUPLING_BOTTOM, DIFF_CLEAR, DIFF_FLANGE, DIFF_L, DIFF_RIB_L, DIFF_RIB_W,
    DIFF_W, JB_HOLES, JB_TOP, JB_Z, M3_INSERT_DEPTH, M3_INSERT_HOLE, SPK_X, SPK_Y,
    STICK_X, STICK_Y, TALK_X, TALK_Y, USB_X, USB_Z, box, cyl, n, rounded_block, union,
)


def grille_holes():
    r = n("grilleDiameterMm") / 2
    pitch = n("grillePitchMm")
    hr = n("grilleHoleMm") / 2
    holes = []
    rows = int(r // (pitch * math.sqrt(3) / 2)) + 1
    for j in range(-rows, rows + 1):
        y = j * pitch * math.sqrt(3) / 2
        off = (pitch / 2) if j % 2 else 0.0
        for i in range(-rows - 1, rows + 2):
            x = i * pitch + off
            if math.hypot(x, y) + hr <= r:
                holes.append(cyl(hr, B_TOP_IN - 1, BH + 1, SPK_X + x, SPK_Y + y))
    return holes


def make() -> Part:
    h = BH - BFLOOR
    outer = rounded_block(BW, BD, h, BR, n("baseTopFilletMm"), 0, z0=BFLOOR)
    inner = rounded_block(B_INNER_W, B_INNER_D, h - BTOP + 1.0, B_INNER_R,
                          n("baseTopFilletMm") - BWALL, 0, z0=BFLOOR - 1.0)
    shell = outer - inner

    feats = []
    # Column around the arm nipple: carries the clamp load from the coupling into the discs.
    feats.append(cyl(n("columnOuterMm") / 2, COLUMN_BOTTOM, B_TOP_IN + 0.5, ARM_X, ARM_Y))
    # Insert bosses, from the plate's pads up to the top skin.
    for x, y in BASE_BOSSES:
        feats.append(cyl(n("baseBossDiameterMm") / 2, BASE_PAD_TOP, B_TOP_IN + 0.5, x, y))
    # Speaker locating ring under the grille.
    spk_in = n("speakerDiameterMm") / 2 + n("speakerRingClearanceMm")
    ring_h = n("speakerRingHeightMm")
    feats.append(cyl(spk_in + n("speakerRingWallMm"), B_TOP_IN - ring_h, B_TOP_IN + 0.5, SPK_X, SPK_Y)
                 - cyl(spk_in, B_TOP_IN - ring_h - 1, B_TOP_IN + 1, SPK_X, SPK_Y))
    # Light-bar frame: two rails that hold the diffuser flange and the NeoPixel stick, an end stop.
    fw = n("ledFrameWallMm")
    depth = DIFF_FLANGE + n("ledStickHeightMm") + 1.0
    yin = DIFF_W / 2 + DIFF_CLEAR
    x0 = n("ledFrameStartXMm")
    x1 = STICK_X + DIFF_L / 2 + DIFF_CLEAR
    for s in (-1, 1):
        y0, y1 = sorted((STICK_Y + s * yin, STICK_Y + s * (yin + fw)))
        feats.append(box(x0, x1 + fw, y0, y1, B_TOP_IN - depth, B_TOP_IN + 0.5))
    feats.append(box(x1, x1 + fw, STICK_Y - yin - fw, STICK_Y + yin + fw, B_TOP_IN - depth, B_TOP_IN + 0.5))
    # Junction board posts with locating pins for its two 3.2 mm mounting holes.
    for x, y in JB_HOLES:
        feats.append(cyl(n("junctionPostMm") / 2, JB_TOP, B_TOP_IN + 0.5, x, y))
        # The pin stands junctionPinStakeMm proud of the board's underside: melt it over with the
        # iron to rivet the board on.
        feats.append(cyl(n("junctionHoleMm") / 2 - 0.15, JB_Z - n("junctionPinStakeMm"), JB_TOP + 0.5, x, y))
    top = shell + (union(feats) & outer)
    # Low collar on the top surface that the arm coupling seats in.
    top = top + cyl(COLLAR_R, BH - 0.5, BH + COLLAR_H, ARM_X, ARM_Y)

    cuts = grille_holes()
    # Talk button.
    cuts.append(cyl(n("talkButtonHoleMm") / 2, B_TOP_IN - 1, BH + 1, TALK_X, TALK_Y))
    # Light-bar slot for the diffuser rib.
    sw, sl = DIFF_RIB_W + 2 * DIFF_CLEAR, DIFF_RIB_L + 2 * DIFF_CLEAR
    cuts.append(Pos(STICK_X, STICK_Y, B_TOP_IN - 1) * extrude(SlotCenterToCenter(sl - sw, sw), BTOP + 2))
    # Arm hole through the top and the column, and a shallow seat for the coupling.
    cuts.append(cyl(n("armHoleMm") / 2, COLUMN_BOTTOM - 1, BH + COLLAR_H + 1, ARM_X, ARM_Y))
    seat = n("couplingDiameterMm") / 2 + 0.3
    cuts.append(cyl(seat, COUPLING_BOTTOM, BH + COLLAR_H + 1, ARM_X, ARM_Y))
    # Insert holes.
    for x, y in BASE_BOSSES:
        cuts.append(cyl(M3_INSERT_HOLE / 2, BASE_PAD_TOP - 1, BASE_PAD_TOP + M3_INSERT_DEPTH, x, y))
    # USB-C opening in the back wall.
    ow, oh = n("usbOpeningWidthMm"), n("usbOpeningHeightMm")
    cuts.append(Pos(USB_X, -BD / 2 + BWALL / 2, USB_Z) * _xz_rounded(ow, oh, oh / 2 - 0.5, BWALL + 2))
    return top - union(cuts)


def _xz_rounded(w, h, r, depth):
    """Rounded rectangle in the x-z plane, extruded along y and centred on the origin."""
    s = extrude(RectangleRounded(w, h, r), depth)
    return Rot(90, 0, 0) * Pos(0, 0, -depth / 2) * s
