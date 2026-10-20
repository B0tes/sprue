"""Shared numbers for the CO2 monitor's case, read from ../design.json.

Frame (mm): origin at the centre of the case's footprint on its underside; x to the right (the USB side), y toward the
back (the lid), z up. The front face is at y = -caseDepthMm / 2. The figure (figure.mjs) and the whole-product check
(_system.py) use the same frame.
"""

import json
import pathlib

P = json.loads((pathlib.Path(__file__).parents[1] / "design.json").read_text())["params"]

W, D, H = P["caseWidthMm"], P["caseDepthMm"], P["caseHeightMm"]
WALL, LID = P["shellWallMm"], P["lidThicknessMm"]
FRONT = -D / 2                      # the front face
FRONT_IN = FRONT + WALL             # the front wall's inner face
RIM = D / 2 - LID                   # the shell's back rim = the lid's inner face
BACK = D / 2                        # the lid's outer face
X_IN = W / 2 - WALL                 # the side walls' inner faces at +-X_IN
Z_IN0, Z_IN1 = WALL, H - WALL       # the floor's and the top's inner faces


def boss_centres():
    """(x, z) of the four corner columns that take the M3 inserts and the lid screws."""
    dx = X_IN - P["bossInsetMm"]
    return [(sx * dx, z) for sx in (-1, 1) for z in (Z_IN0 + P["bossInsetMm"], Z_IN1 - P["bossInsetMm"])]


# The Pico: on the lid, components toward the front, its USB end at the +x side wall.
PICO_BACK = RIM - P["picoStandoffMm"]               # the board's back face (on the standoffs)
PICO_TOP = PICO_BACK - P["picoBoardMm"]             # its component face
PICO_X1 = X_IN - P["picoUsbEndGapMm"]               # the USB end
PICO_X0 = PICO_X1 - P["picoLengthMm"]
PICO_CX = (PICO_X0 + PICO_X1) / 2
PICO_Z0 = P["picoBottomZMm"]
PICO_CZ = PICO_Z0 + P["picoWidthMm"] / 2
USB_Y = PICO_TOP - P["picoUsbCentreAboveBoardMm"]   # the micro-USB socket's centre
USB_Z = PICO_CZ


def pico_holes():
    """The Pico's four holes (x, z), as [far end low, far end high, usb end low, usb end high]."""
    hx, hz = P["picoHolePitchXMm"] / 2, P["picoHolePitchYMm"] / 2
    return [(PICO_CX - hx, PICO_CZ - hz), (PICO_CX - hx, PICO_CZ + hz),
            (PICO_CX + hx, PICO_CZ - hz), (PICO_CX + hx, PICO_CZ + hz)]


def pico_screw_holes():
    """Screws go in the far end's holes; next to the USB socket a pan head would touch the socket, so the USB end's
    two holes sit on printed pins instead."""
    return pico_holes()[:2]


def pico_pin_holes():
    return pico_holes()[2:]


# The SCD-40 breakout: on the lid, the sensor facing the lid's vents. Seen from the front its board x runs to -x.
CO2_SENSOR_TOP = RIM - P["co2SensorToLidMm"]
CO2_TOP = CO2_SENSOR_TOP - P["co2SensorHeightMm"]   # the board's sensor-side face
CO2_BACK = CO2_TOP - P["co2BoardThicknessMm"]       # its other face (toward the front of the case)
CO2_CX, CO2_CZ = P["co2CentreXMm"], P["co2CentreZMm"]
CO2_SX, CO2_SZ = CO2_CX, CO2_CZ + P["co2SensorOffsetUpMm"]  # the sensor's centre


def co2_holes():
    """The breakout's four holes (x, z): [right low, left low, right high, left high] as seen from the front."""
    dx = P["co2BoardWidthMm"] / 2 - P["co2HoleInsetMm"]
    dz = P["co2BoardHeightMm"] / 2 - P["co2HoleInsetMm"]
    return [(CO2_CX + dx, CO2_CZ - dz), (CO2_CX - dx, CO2_CZ - dz), (CO2_CX + dx, CO2_CZ + dz), (CO2_CX - dx, CO2_CZ + dz)]


def co2_screw_holes():
    """Two diagonal holes take screws."""
    h = co2_holes()
    return [h[0], h[3]]


# The OLED: display side to the front wall, glass against its inner face.
OLED_GLASS_BACK = FRONT_IN + P["oledGlassThicknessMm"]
OLED_FRONT = OLED_GLASS_BACK + P["oledTapeMm"]      # the board's display-side face
OLED_BACK = OLED_FRONT + P["oledBoardThicknessMm"]
OLED_X0 = P["oledCentreXMm"] - P["oledBoardWidthMm"] / 2
OLED_Z0 = P["oledBottomZMm"]
GLASS_CZ = OLED_Z0 + P["oledGlassCentreFromBottomMm"]
ACTIVE_CZ = GLASS_CZ + P["oledGlassHeightMm"] / 2 - P["oledActiveFromGlassTopMm"] - P["oledActiveHeightMm"] / 2
WINDOW_CZ = ACTIVE_CZ


def oled_holes():
    """(x, z) of the OLED's four holes: [low left, low right, high left, high right]."""
    dx = P["oledBoardWidthMm"] / 2 - P["oledHoleInsetXMm"]
    cx = P["oledCentreXMm"]
    return [(cx - dx, OLED_Z0 + P["oledLowerHoleFromBottomMm"]), (cx + dx, OLED_Z0 + P["oledLowerHoleFromBottomMm"]),
            (cx - dx, OLED_Z0 + P["oledUpperHoleFromBottomMm"]), (cx + dx, OLED_Z0 + P["oledUpperHoleFromBottomMm"])]


def oled_screw_holes():
    return oled_holes()[2:]


# The LED: lens out through the front wall, flange on the wall's inner face.
LED_X, LED_Z = P["ledCentreXMm"], P["ledCentreZMm"]
LED_SEAT = FRONT_IN + P["ledFlangeThicknessMm"]     # the seating plane (where the leads leave)
LED_TIP = LED_SEAT - P["ledSeatedHeightMm"]          # the lens's tip, in front of the case
LED_DIE = LED_SEAT - P["ledDieAboveSeatMm"]


def vent_slots():
    """(x, z, w, h) of each slot in the lid: the sensor's vents, then the low intake slots."""
    n, pitch, w = int(P["ventSlotCount"]), P["ventSlotPitchMm"], P["ventSlotWidthMm"]
    vents = [(CO2_SX + (i - (n - 1) / 2) * pitch, CO2_SZ, w, P["ventSlotLengthMm"]) for i in range(n)]
    m = int(P["intakeSlotCount"])
    intake = [((i - (m - 1) / 2) * pitch, P["intakeCentreZMm"], w, P["intakeSlotLengthMm"]) for i in range(m)]
    return vents + intake


def feet():
    return [(sx * P["footCentreXMm"], sy * P["footCentreYMm"]) for sx in (-1, 1) for sy in (-1, 1)]
