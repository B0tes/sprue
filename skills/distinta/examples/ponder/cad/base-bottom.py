"""Ponder base, bottom plate: radial ribs and a locating ring for the two steel discs, room for
the arm nut, a relief and groove that let the harness out of the nipple's bottom end, a cradle
for the USB-C breakout, a locating lip inside the top shell's walls, six counterbored screw
holes on 3 mm pads, four pockets for the rubber feet, and an engraved supply warning and unit-number field underneath.

Base frame (see _params.py). Printed flat, ribs up.
"""

import math

from build123d import FontStyle, Part, Plane, Pos, Rot, Text, extrude

from _params import (
    ARM_X, ARM_Y, BASE_BOSSES, BASE_CBORE_DEPTH, BASE_PAD_TOP, BD, BFLOOR, BR, BW, B_CLEAR,
    DISC_CLEAR, DISC_R, FEET, M3_CBORE, M3_CLEAR, RIB_TOP, USB_BOARD_Z, USB_X,
    USB_Y_BACK, USB_Y_FRONT, base_inner_outline, box, cyl, n, rounded_block, union,
)


def make() -> Part:
    plate = rounded_block(BW, BD, BFLOOR, BR, 0, n("baseBottomFilletMm"))
    inside = base_inner_outline(-B_CLEAR, BFLOOR - 0.5, 20)  # everything on the plate stays in here

    feats = []
    # Locating lip just inside the top shell's walls, broken at the USB-C breakout.
    lip_w, lip_h = n("plateLipWidthMm"), n("plateLipHeightMm")
    lip = base_inner_outline(-B_CLEAR, BFLOOR - 0.5, lip_h + 0.5) \
        - base_inner_outline(-B_CLEAR - lip_w, BFLOOR - 1, lip_h + 2)
    usb_w = n("usbcWidthMm") + 2 * (n("usbCradleWallMm") + 0.3)
    lip = lip - box(USB_X - usb_w / 2, USB_X + usb_w / 2, -BD, USB_Y_FRONT, 0, 20)
    feats.append(lip)

    # Pads under the screw heads so each screw passes through shellFlangeMm of plastic.
    for x, y in BASE_BOSSES:
        feats.append(cyl(n("basePadDiameterMm") / 2, BFLOOR - 0.5, BASE_PAD_TOP, x, y))

    # Radial ribs the discs rest on; the nut sits inside their inner ends.
    count = int(n("ballastRibCount"))
    r0, r1 = n("ballastRibInnerRadiusMm"), DISC_R - 2.0
    rw = n("ballastRibWidthMm")
    for k in range(count):
        ang = 45 + k * 360 / count
        rib = box(r0, r1, -rw / 2, rw / 2, BFLOOR - 0.5, RIB_TOP)
        feats.append(Pos(ARM_X, ARM_Y, 0) * Rot(0, 0, ang) * rib)
    # Locating ring around the discs, open toward +y where the harness leaves.
    ring_in = DISC_R + DISC_CLEAR
    ring_out = ring_in + n("ballastRingWallMm")
    ring_top = BFLOOR + n("ballastRingHeightMm")
    ring = cyl(ring_out, BFLOOR - 0.5, ring_top, ARM_X, ARM_Y) - cyl(ring_in, BFLOOR - 1, ring_top + 1, ARM_X, ARM_Y)
    gw = n("harnessGrooveWidthMm") + 2.0
    ring = ring - box(ARM_X - gw / 2, ARM_X + gw / 2, ARM_Y, ARM_Y + ring_out + 2, 0, 30)
    feats.append(ring)

    # USB-C breakout cradle: a platform and three low walls; the connector edge meets the back wall.
    cw = n("usbCradleWallMm")
    bw = n("usbcWidthMm") + 0.4
    y0 = USB_Y_BACK + B_CLEAR
    y1 = y0 + n("usbcDepthMm") + 0.3
    feats.append(box(USB_X - bw / 2, USB_X + bw / 2, y0, y1, BFLOOR - 0.5, USB_BOARD_Z))
    wall_top = USB_BOARD_Z + n("usbCradleHeightMm")
    for s in (-1, 1):
        xa, xb = sorted((USB_X + s * bw / 2, USB_X + s * (bw / 2 + cw)))
        feats.append(box(xa, xb, y0, y1 + cw, BFLOOR - 0.5, wall_top))
    feats.append(box(USB_X - bw / 2 - cw, USB_X + bw / 2 + cw, y1, y1 + cw, BFLOOR - 0.5, wall_top))

    plate = plate + (union(feats) & inside)

    cuts = []
    for x, y in BASE_BOSSES:
        cuts.append(cyl(M3_CLEAR / 2, -1, BASE_PAD_TOP + 1, x, y))
        cuts.append(cyl(M3_CBORE / 2, -1, BASE_CBORE_DEPTH, x, y))
    fr = n("rubberFootDiameterMm") / 2 + 0.2
    for x, y in FEET:
        cuts.append(cyl(fr, -1, n("rubberFootPocketDepthMm"), x, y))
    # Relief under the nipple's bottom end and a groove that leads the harness out between the ribs.
    gd = n("harnessGrooveDepthMm")
    cuts.append(cyl(n("nippleReliefMm") / 2, BFLOOR - gd, BFLOOR + 1, ARM_X, ARM_Y))
    gwi = n("harnessGrooveWidthMm")
    cuts.append(box(ARM_X - gwi / 2, ARM_X + gwi / 2, ARM_Y, ARM_Y + ring_out + 1.0, BFLOOR - gd, BFLOOR + 1))
    # Underside marking, readable with the base turned over: name, supply warning, a field for the
    # unit number (written in paint marker).
    depth = n("baseLabelDepthMm")
    for y, size, words in ((-14, 5, "PONDER"), (-6, 3.5, "USE ONLY THE SUPPLIED"), (0, 3.5, "5.1V 3A USB-C ADAPTER"), (8, 3.5, "UNIT NO.")):
        cuts.append(Plane(origin=(n("baseLabelCenterXMm"), y, depth), x_dir=(1, 0, 0), z_dir=(0, 0, -1))
                    * extrude(Text(words, size, font_style=FontStyle.BOLD), depth + 1.0))
    return plate - union(cuts)
