"""The CO2 monitor as one thing (not a part): every part in one frame, for `sprue system` (the skill's cad/system.py).

Frame: as _params.py: origin at the centre of the case's footprint on its underside, x to the USB side, y to the back
lid, z up. The two prints come from their own files; the bought parts are envelopes at the sizes their bom.json lines,
their makers' board files and datasheets give (design.json `estimates` names the sizes that are not published).
"""

from build123d import Pos, Sphere
from system import (Contact, Fit, Inside, Item, Light, Port, Pose, Push, System, bom_lines, box, cyl, estimates)

import lid
import shell
from _params import (ACTIVE_CZ, BACK, CO2_BACK, CO2_CX, CO2_CZ, CO2_SENSOR_TOP, CO2_SX, CO2_SZ, CO2_TOP, FRONT_IN,
                     GLASS_CZ, LED_DIE, LED_SEAT, LED_TIP, LED_X, LED_Z, OLED_BACK, OLED_FRONT, OLED_GLASS_BACK, OLED_Z0,
                     P, PICO_BACK, PICO_CZ, PICO_TOP, PICO_X0, PICO_X1, RIM, USB_Y, USB_Z, boss_centres, co2_holes,
                     co2_screw_holes, feet, oled_holes, oled_screw_holes, pico_holes, pico_screw_holes)
from _shapes import ycyl

import pathlib  # noqa: E402

HERE = pathlib.Path(__file__).parent
BOM, S = bom_lines(HERE.parent)

# Bought parts with no published mass: typical weights for the part, marked as estimates (design.json estimates).
EST = estimates({"pico": 3.0, "led": 0.3, "ins": 0.3, "scr3": 0.5, "scr2": 0.2, "scr2s": 0.15, "feet": 0.3,
                 "usbcable": 3.0})


def bought(id, line, shape, tags=()):
    m = S[line].get("massG")
    if isinstance(m, (int, float)):
        mass, note = float(m), "bom.json"
    else:
        mass, note = EST[line], "estimate: typical for the part, no published mass"
    return Item(id, shape, line=line, mass_g=mass, mass_note=note, tags=tags, model="envelope")


def holes_cut(part, holes, d, y0, y1):
    for x, z in holes:
        part -= ycyl(d / 2, y0 - 0.1, y1 + 0.1, x, z)
    return part


def pico():
    """The Pico: its board with its four holes, the micro-USB socket at the +x end, and one block for the parts on
    its face (RP2040, flash, button, regulator), kept clear of the screw heads at the far end."""
    z0, z1 = PICO_CZ - P["picoWidthMm"] / 2, PICO_CZ + P["picoWidthMm"] / 2
    board = holes_cut(box(PICO_X0, PICO_X1, PICO_TOP, PICO_BACK, z0, z1), pico_holes(), P["picoHoleMm"], PICO_TOP, PICO_BACK)
    uw = S["pico"]["usbWidthMm"]
    socket = box(PICO_X1 - S["pico"]["usbDepthMm"], PICO_X1, PICO_TOP - P["picoTallestAboveBoardMm"], PICO_TOP,
                 USB_Z - uw / 2, USB_Z + uw / 2)
    head = S["scr2"]["headMm"]
    parts = box(PICO_X0 + 2 + head / 2 + 0.5, PICO_X1 - S["pico"]["usbDepthMm"] - 0.5, PICO_TOP - 1.6, PICO_TOP,
                PICO_CZ - 6, PICO_CZ + 6)
    return board + socket + parts


def co2():
    """The SCD-40 breakout: its board with its four holes, the sensor on the side toward the lid, and the two
    STEMMA QT sockets at its side edges on that face."""
    w, h = P["co2BoardWidthMm"], P["co2BoardHeightMm"]
    board = holes_cut(box(CO2_CX - w / 2, CO2_CX + w / 2, CO2_BACK, CO2_TOP, CO2_CZ - h / 2, CO2_CZ + h / 2),
                      co2_holes(), P["co2HoleMm"], CO2_BACK, CO2_TOP)
    s = P["co2SensorSizeMm"]
    sensor = box(CO2_SX - s / 2, CO2_SX + s / 2, CO2_TOP, CO2_SENSOR_TOP, CO2_SZ - s / 2, CO2_SZ + s / 2)
    jd, ja, jh = P["jstBodyDepthMm"], P["jstBodyAlongEdgeMm"], P["jstBodyHeightMm"]
    out = board + sensor
    for sx in (-1, 1):
        edge = CO2_CX + sx * w / 2
        out += box(min(edge, edge - sx * jd), max(edge, edge - sx * jd), CO2_TOP, CO2_TOP + jh, CO2_CZ - ja / 2, CO2_CZ + ja / 2)
    return out


def oled():
    """The OLED breakout: the glass against the front wall, the board behind it with its four holes, and the two
    STEMMA QT sockets on its back at the side edges."""
    w, h = P["oledBoardWidthMm"], P["oledBoardHeightMm"]
    cx = P["oledCentreXMm"]
    board = holes_cut(box(cx - w / 2, cx + w / 2, OLED_FRONT, OLED_BACK, OLED_Z0, OLED_Z0 + h), oled_holes(),
                      P["oledHoleMm"], OLED_FRONT, OLED_BACK)
    gw, gh = P["oledGlassWidthMm"], P["oledGlassHeightMm"]
    glass = box(cx - gw / 2, cx + gw / 2, FRONT_IN, OLED_FRONT, GLASS_CZ - gh / 2, GLASS_CZ + gh / 2)  # with its tape
    jd, ja, jh = P["jstBodyDepthMm"], P["jstBodyAlongEdgeMm"], P["jstBodyHeightMm"]
    zc = OLED_Z0 + P["oledConnectorFromBottomMm"]
    out = board + glass
    for sx in (-1, 1):
        edge = cx + sx * w / 2
        out += box(min(edge, edge - sx * jd), max(edge, edge - sx * jd), OLED_BACK, OLED_BACK + jh, zc - ja / 2, zc + ja / 2)
    return out


def led():
    """The bi-colour LED: its flange on the front wall's inner face, the lens through the hole, a domed tip."""
    r = P["ledLensMm"] / 2
    flange = ycyl(P["ledFlangeMm"] / 2, FRONT_IN, LED_SEAT, LED_X, LED_Z)
    lens = ycyl(r, LED_TIP + r, FRONT_IN, LED_X, LED_Z)
    return flange + lens + Pos(LED_X, LED_TIP + r, LED_Z) * Sphere(r)


def system():
    items = [
        Item("shell", shell.make(), line="shell", material=S["shell"]["material"]),
        Item("lid", lid.make(), line="lid", material=S["lid"]["material"]),
        bought("pico", "pico", pico()),
        bought("co2", "co2", co2()),
        bought("oled", "oled", oled()),
        bought("led", "led", led()),
    ]

    ins, s3 = S["ins"], S["scr3"]
    for n, (x, z) in enumerate(boss_centres(), 1):
        items.append(bought(f"ins{n}", "ins", ycyl(ins["outerMm"] / 2, RIM - ins["lengthMm"], RIM, x, z)
                            - ycyl(s3["diameterMm"] / 2, RIM - ins["lengthMm"] - 0.1, RIM + 0.1, x, z)))
        items.append(bought(f"m3s{n}", "scr3", ycyl(s3["headMm"] / 2, BACK, BACK + s3["headHeightMm"], x, z)
                            + ycyl(s3["diameterMm"] / 2, BACK - s3["lengthMm"], BACK, x, z)))

    s2 = S["scr2"]
    for n, (x, z) in enumerate(pico_screw_holes(), 1):  # head on the Pico's face, thread into the lid's standoff
        items.append(bought(f"scrp{n}", "scr2", ycyl(s2["headMm"] / 2, PICO_TOP - s2["headHeightMm"], PICO_TOP, x, z)
                            + ycyl(s2["diameterMm"] / 2, PICO_TOP, PICO_TOP + s2["lengthMm"], x, z)))
    for n, (x, z) in enumerate(co2_screw_holes(), 1):  # head on the breakout's back, thread into the tall standoff
        items.append(bought(f"scrc{n}", "scr2", ycyl(s2["headMm"] / 2, CO2_BACK - s2["headHeightMm"], CO2_BACK, x, z)
                            + ycyl(s2["diameterMm"] / 2, CO2_BACK, CO2_BACK + s2["lengthMm"], x, z)))
    s2s = S["scr2s"]
    for n, (x, z) in enumerate(oled_screw_holes(), 1):  # head on the OLED's back, thread into the front boss
        items.append(bought(f"scro{n}", "scr2s", ycyl(s2s["headMm"] / 2, OLED_BACK, OLED_BACK + s2s["headHeightMm"], x, z)
                            + ycyl(s2s["diameterMm"] / 2, OLED_BACK - s2s["lengthMm"], OLED_BACK, x, z)))

    f = S["feet"]
    for n, (x, y) in enumerate(feet(), 1):
        items.append(bought(f"foot{n}", "feet", cyl(f["diameterMm"] / 2, -f["heightMm"], 0, x, y), tags=("foot",)))

    # The USB cable, plugged in: the micro-B plug in the Pico's socket and its moulding out through the side opening.
    c = S["usbcable"]
    face = PICO_X1 - S["pico"]["usbDepthMm"] + P["usbPlugMetalLengthMm"]  # where the metal ends and the moulding starts
    plug = box(PICO_X1 - S["pico"]["usbDepthMm"], face, USB_Y - c["microBHeightMm"] / 2, USB_Y + c["microBHeightMm"] / 2,
               USB_Z - c["microBWidthMm"] / 2, USB_Z + c["microBWidthMm"] / 2)
    ow, oh = P["usbOvermoldWidthMm"], P["usbOvermoldHeightMm"]
    mould_end = face + c["plugLengthMm"] - P["usbPlugMetalLengthMm"]
    mould = box(face, mould_end, USB_Y - oh / 2, USB_Y + oh / 2, USB_Z - ow / 2, USB_Z + ow / 2)
    items.append(bought("usbcable", "usbcable", plug + mould))

    die = (LED_X, LED_DIE, LED_Z)
    aw, ah = P["oledActiveWidthMm"] / 2, P["oledActiveHeightMm"] / 2
    cx = P["oledCentreXMm"]
    screen = lambda name, x, z, half: Light(name, (x, FRONT_IN - 0.05, z), (0, -1, 0), half, "out", 0.95, ignore=("oled",),
                                           why="the screen's active area is seen through the window from the desk")
    return System(
        items=items,
        min_clearance_mm=P["minClearanceMm"],
        fits=[
            Fit("ins*", "shell", "each insert melted into its corner column's 4.0 mm hole"),
            Fit("scrp*", "lid", "each M2 screw cuts its thread into the Pico standoff's 1.7 mm pilot"),
            Fit("scrc*", "lid", "each M2 screw cuts its thread into the sensor standoff's 1.7 mm pilot"),
            Fit("scro*", "shell", "each M2 screw cuts its thread into the OLED boss's 1.7 mm pilot"),
            Fit("usbcable", "pico", "the micro-B plug in the Pico's socket"),
        ],
        contacts=[
            Contact("lid", "shell", "the lid on the shell's rim"),
            Contact("ins*", "lid", "each insert flush with the rim, under the lid"),
            Contact("pico", "lid", "the Pico on its four standoffs, two of them with pins through its holes", gap=0),
            Contact("co2", "lid", "the breakout on its four standoffs"),
            Contact("oled", "shell", "the glass on the front wall, the board on its two bosses and its ledge"),
            Contact("led", "shell", "the flange on the front wall's inner face, the lens through its 5.2 mm hole", gap=0),
            Contact("m3s*", "lid", "each M3 head on the lid, its shank through the 3.4 mm hole", gap=0),
            Contact("m3s*", "ins*", "each M3 screw drawn at its insert's bore, which its thread cuts into", gap=0),
            Contact("scrp*", "pico", "each M2 head on the Pico, its shank through the 2.1 mm hole", gap=0),
            Contact("scrc*", "co2", "each M2 head on the breakout, its shank through the 3.0 mm hole", gap=0),
            Contact("scro*", "oled", "each M2 head on the OLED, its shank through the 2.5 mm hole", gap=0),
            Contact("foot*", "shell", "the feet stuck under the shell"),
        ],
        inside=[Inside("pico", ("shell", "lid"), "the Pico"), Inside("co2", ("shell", "lid"), "the CO2 sensor"),
                Inside("oled", ("shell", "lid"), "the OLED"), Inside("ins*", ("shell", "lid"), "the inserts")],
        unplaced={
            "res": "on the LED's anode leads, under heat-shrink, wherever the leads end up",
            "qtcable": "a 100 mm flexible cable from the sensor's socket to the OLED's, routed by hand",
        },
        poses=[Pose("on the desk", pushes=[
            Push("a sideways pull of the USB cable", (mould_end, USB_Y, USB_Z), (P["cableTugN"], 0, 0)),
        ])],
        min_tilt_deg=P["minTiltDeg"],
        probes=[
            Light("led", die, (0, -1, 0), P["ledViewHalfAngleDeg"], "out", 0.95, ignore=("led",),
                  why="the LED's 60 degree beam leaves the front clear of the case"),
            screen("screen", cx, ACTIVE_CZ, 30),
            screen("screen-top-left", cx - aw, ACTIVE_CZ + ah, 25),
            screen("screen-bottom-right", cx + aw, ACTIVE_CZ - ah, 25),
            Port("co2-vents", "co2", (CO2_SX, CO2_SENSOR_TOP, CO2_SZ), (0, 1, 0), P["sensorPortRadiusMm"],
                 min_open=P["sensorPortMinOpen"], why="the sensor's top face sees out through the lid's vent slots"),
        ],
    )

