"""Back lid: a flat plate that closes the shell with four M3 screws. It carries the Pico on four 4 mm standoffs (two
screws at the far end, two pins at the USB end) and the SCD-40 breakout on four tall standoffs (two screws), with
five vent slots over the sensor and five intake slots low down. Printed flat, inner face up."""

from _params import (BACK, CO2_TOP, H, P, PICO_BACK, PICO_TOP, RIM, W, boss_centres, co2_holes, co2_screw_holes,
                     pico_holes, pico_pin_holes, pico_screw_holes, vent_slots)
from _shapes import box, rounded_y, ycyl


def make():
    lid = rounded_y(box(-W / 2, W / 2, RIM, BACK, 0, H), P["caseEdgeRadiusMm"])
    for x, z in boss_centres():
        lid -= ycyl(P["lidScrewClearanceMm"] / 2, RIM - 1, BACK + 1, x, z)

    skin = BACK - P["minSkinOverPilotMm"]  # pilots stop this far inside the back face
    for x, z in pico_holes():
        lid += ycyl(P["picoStandoffDiameterMm"] / 2, PICO_BACK, RIM + 0.5, x, z)
    for x, z in pico_screw_holes():
        lid -= ycyl(P["m2PilotMm"] / 2, PICO_BACK - 0.1, skin, x, z)
    for x, z in pico_pin_holes():  # a pin through the hole, 0.5 mm proud of the board
        lid += ycyl((P["picoHoleMm"] - 0.3) / 2, PICO_TOP - 0.5, PICO_BACK + 0.1, x, z)

    for x, z in co2_holes():
        lid += ycyl(P["co2StandoffDiameterMm"] / 2, CO2_TOP, RIM + 0.5, x, z)
    for x, z in co2_screw_holes():
        lid -= ycyl(P["m2PilotMm"] / 2, CO2_TOP - 0.1, skin, x, z)

    for x, z, w, h in vent_slots():
        lid -= box(x - w / 2, x + w / 2, RIM - 1, BACK + 1, z - h / 2, z + h / 2)
    return lid
