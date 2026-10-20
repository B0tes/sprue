"""Front shell: the front wall with the OLED window and the LED hole, four side walls, the micro-USB opening in the
right wall, the OLED's ledge and two bosses, and four corner columns that take the M3 inserts. Printed face down."""

from _params import (ACTIVE_CZ, FRONT, FRONT_IN, H, LED_X, LED_Z, OLED_FRONT, OLED_Z0, P, RIM, USB_Y, USB_Z, W, WALL,
                     X_IN, Z_IN0, Z_IN1, boss_centres, oled_screw_holes)
from _shapes import box, rounded_x, rounded_y, ycyl


def make():
    r = P["caseEdgeRadiusMm"]
    shell = rounded_y(box(-W / 2, W / 2, FRONT, RIM, 0, H), r)
    shell -= rounded_y(box(-X_IN, X_IN, FRONT_IN, RIM + 1, Z_IN0, Z_IN1), r - WALL)

    # Corner columns, front wall to rim, each with a hole for an M3 insert at the rim.
    for x, z in boss_centres():
        shell += ycyl(P["bossDiameterMm"] / 2, FRONT_IN - 0.5, RIM, x, z)
        shell -= ycyl(P["insertHoleMm"] / 2, RIM - P["insertHoleDepthMm"], RIM + 0.1, x, z)

    # The OLED: a ledge under its bottom edge and two bosses at its upper holes, as tall as its glass, with pilots
    # for M2 screws that stop short of the front face.
    lw = P["oledLedgeWidthMm"]
    shell += box(P["oledCentreXMm"] - lw / 2, P["oledCentreXMm"] + lw / 2, FRONT_IN - 0.5, FRONT_IN + P["oledLedgeDepthMm"],
                 OLED_Z0 - P["oledLedgeHeightMm"], OLED_Z0)
    for x, z in oled_screw_holes():
        shell += ycyl(P["oledBossDiameterMm"] / 2, FRONT_IN - 0.5, OLED_FRONT, x, z)
        shell -= ycyl(P["m2PilotMm"] / 2, FRONT + P["minSkinOverPilotMm"], OLED_FRONT + 0.1, x, z)

    # The window over the OLED's active area, and the LED's hole.
    ww, wh = P["windowWidthMm"], P["windowHeightMm"]
    shell -= box(P["oledCentreXMm"] - ww / 2, P["oledCentreXMm"] + ww / 2, FRONT - 1, FRONT_IN + 0.1,
                 ACTIVE_CZ - wh / 2, ACTIVE_CZ + wh / 2)
    shell -= ycyl(P["ledHoleMm"] / 2, FRONT - 1, FRONT_IN + 0.1, LED_X, LED_Z)

    # The micro-USB opening in the right wall, centred on the Pico's socket, rounded so the plug's moulding goes in.
    ay, az = P["usbOpeningAlongYMm"], P["usbOpeningAlongZMm"]
    shell -= rounded_x(box(X_IN - 0.5, W / 2 + 1, USB_Y - ay / 2, USB_Y + ay / 2, USB_Z - az / 2, USB_Z + az / 2), 1.5)
    return shell
