"""Ponder head, upper shell: the top with the arm-nipple hole, the mute toggle on the camera end with MUTE engraved under it,
the two privacy lights and the mic ports on the front face, vents over the Pi, and four bosses
for M3 heat-set inserts.

Head frame (see _params.py). Printed top down. The nut for the 1/2 in nipple sits flat on the
inside of the top, in the gap between the Pi and the camera.
"""

from build123d import FontStyle, Part, Plane, Text, extrude

from _params import (
    HD, HEAD_BOSSES, HH, HL, IX, IY, IZ1, LED_GREEN_X, LED_RED_X, LED_Z, M3_BOSS, M3_INSERT_DEPTH,
    M3_INSERT_HOLE, MIC_XS, MIC_Z, NIP_X, NIP_Y, PI_X0, PI_X1, SPLIT, TOG_Y, TOG_Z, box, cyl,
    head_inner, head_lip_ring, head_outer, hole_x, hole_y, n, slot_y, union,
)

MIC_L, MIC_W = n("micBoardLengthMm"), n("micBoardWidthMm")
RIM, RIM_H, RIM_C = n("micPocketRimMm"), n("micPocketRimHeightMm"), n("micPocketClearanceMm")


def make() -> Part:
    outer = head_outer()
    shell = outer - head_inner()
    upper = shell & box(-200, 200, -200, 200, SPLIT, HH + 1)

    feats = []
    for x, y in HEAD_BOSSES:
        feats.append(cyl(M3_BOSS / 2, SPLIT, IZ1 + 1.0, x, y))
    # Mic pockets: a rim on the inside of the front wall that locates each breakout over its port.
    for x in MIC_XS:
        w, h = MIC_L + 2 * RIM_C, MIC_W + 2 * RIM_C
        frame = box(x - w / 2 - RIM, x + w / 2 + RIM, IY - RIM_H, IY + 0.5,
                    MIC_Z - h / 2 - RIM, MIC_Z + h / 2 + RIM) \
            - box(x - w / 2, x + w / 2, IY - RIM_H - 1, IY + 1, MIC_Z - h / 2, MIC_Z + h / 2)
        feats.append(frame)
    upper = upper + (union(feats) & outer)

    # Groove for the lower shell's lap lip (cut after the bosses so it runs through them too).
    cuts = [head_lip_ring(grow=n("headLipClearanceMm"))]
    for x, y in HEAD_BOSSES:
        cuts.append(cyl(M3_INSERT_HOLE / 2, SPLIT - 1, SPLIT + M3_INSERT_DEPTH, x, y))
    # Arm nipple through the top.
    cuts.append(cyl(n("armHoleMm") / 2, IZ1 - 1, HH + 1, NIP_X, NIP_Y))
    # Mute toggle through the +x end wall.
    cuts.append(hole_x(TOG_Y, TOG_Z, n("muteToggleHoleMm") / 2, IX - 1, HL / 2 + 1))
    # "MUTE" engraved under the toggle hole, clear of its panel nut: the lever thrown down, toward the word, mutes.
    depth = n("muteLabelDepthMm")
    label_z = TOG_Z - n("muteToggleHoleMm") / 2 - n("muteLabelGapMm") - n("muteLabelHeightMm") / 2
    label = Plane(origin=(HL / 2 - depth, TOG_Y, label_z), x_dir=(0, 1, 0), z_dir=(1, 0, 0)) * extrude(
        Text("MUTE", n("muteLabelHeightMm"), font_style=FontStyle.BOLD), depth + 1.0)
    cuts.append(label)
    # Camera-on (green) and mic-off (red) lights through the front wall.
    for x in (LED_GREEN_X, LED_RED_X):
        cuts.append(hole_y(x, LED_Z, n("ledHoleMm") / 2, IY - 1, HD / 2 + 1))
    # Mic ports.
    for x in MIC_XS:
        cuts.append(hole_y(x, MIC_Z, n("micPortMm") / 2, IY - RIM_H - 0.5, HD / 2 + 1))
    # Vents in the back wall over the Pi.
    vw, vl, pitch = n("headVentWidthMm"), n("headVentLengthMm"), n("headVentPitchMm")
    z0 = IZ1 - 3 - vl
    x = PI_X0 + 6
    while x <= PI_X1 - 8:
        cuts.append(slot_y(x, z0 + vl / 2, vl, vw, -HD / 2 - 1, -IY + 1))
        x += pitch
    return upper - union(cuts)
