"""The keypad as one thing (not a part): every part in one frame, for `sprue system` (../../cad/system.py).

Frame: PCB coordinates, as _params.py: origin at the board's centre, x to the USB end, y to the controller end, z up
from the board's underside (top.py's z = 0). The printed parts come from their own files, the board from the shipped
zip (its outline and drills, as the fab gets them, not from the params), and the bought parts are envelopes at the
sizes their bom.json lines give.
"""

import pathlib

from build123d import Pos
from system import (
    Contact, Fit, Inside, Item, Light, Port, Pose, Push, System, board_from_gerbers, box, cyl,
)

import bottom
import top
from _params import P, controller_box, hole_centres, key_centres

HERE = pathlib.Path(__file__).parent
BOM = {l["id"]: l for l in __import__("json").loads((HERE.parent / "bom.json").read_text())["lines"]}
S = {k: l.get("spec", {}) for k, l in BOM.items()}

PCB_T = P["pcbThicknessMm"]
PLATE_TOP = P["plateTopToPcbTopMm"] + PCB_T  # the plate's top face
TRAY_H = P["trayFloorMm"] + P["standoffHeightMm"]  # the tray, from its underside to the board's underside


def mass(line, note=None):
    """A bought part's mass from its bom.json line, or None when the line gives none."""
    m = S[line].get("massG")
    return (float(m), note or "bom.json") if isinstance(m, (int, float)) else (None, "")


# Bought parts with no published mass: weights typical of the part, marked as estimates. The keypad stands on four
# feet 50 x 68 mm apart under a 149 g product (98 g of it these estimates), so none of them moves the result.
EST = {"ctrl": 3.0, "sw": 5.0, "sock": 0.3, "cap": 2.0, "ins": 0.3, "scr": 0.5, "feet": 0.3, "cable": 25.0}


def bought(id, line, shape, tags=()):
    m, note = mass(line)
    if m is None:
        m, note = EST[line], "estimate: typical for the part, no published mass"
    return Item(id, shape, line=line, mass_g=m, mass_note=note, tags=tags, model="envelope")


def system():
    items = [
        Item("top", top.make(), line="top", material=S["top"]["material"]),
        Item("bot", Pos(0, 0, -TRAY_H) * bottom.make(), line="bot", material=S["bot"]["material"]),
    ]
    board, _ = board_from_gerbers(HERE.parent / BOM["pcb"]["file"], PCB_T)
    items.append(Item("pcb", board, line="pcb", material="FR4"))

    # Raspberry Pi Pico, soldered flat on the top: its 1 mm board and, over all of it, the 3.8 mm the design gives for
    # its tallest part (the micro-B socket), which is how lid-headroom treats it.
    x0, x1, y0, y1 = controller_box()
    tall = P["controllerHeightAbovePcbMm"]
    items.append(bought("ctrl", "ctrl", box(x0, x1, y0, y1, PCB_T, PCB_T + tall)))

    sw, cap = S["sw"], S["cap"]
    for n, (x, y) in enumerate(key_centres(), 1):
        cut = sw["plateCutoutMm"]
        lower = box(x - cut / 2, x + cut / 2, y - cut / 2, y + cut / 2, PCB_T, PLATE_TOP)  # under the plate and in its cutout
        upper = box(x - sw["housingMm"] / 2, x + sw["housingMm"] / 2, y - sw["housingMm"] / 2, y + sw["housingMm"] / 2,
                    PLATE_TOP, PLATE_TOP + sw["abovePlateMm"])
        post = cyl(sw["centrePostMm"] / 2, PCB_T - sw["centrePostLengthMm"], PCB_T, x, y)
        pins = [box(x + px - sw["pinWidthMm"] / 2, x + px + sw["pinWidthMm"] / 2, y + py - sw["pinThicknessMm"] / 2,
                    y + py + sw["pinThicknessMm"] / 2, PCB_T - sw["pinLengthMm"], PCB_T)
                for px, py in ((sw["pin1XMm"], sw["pin1YMm"]), (sw["pin2XMm"], sw["pin2YMm"]))]
        items.append(bought(f"sw{n}", "sw", lower + upper + post + pins[0] + pins[1]))
        # The socket's body under the board, as the Kailh drawing gives it (pipeline/pcb/footprints.ts), drawn as a
        # box round that outline: x -6.09 to 4.82, y 0.85 to 6.7 from the key's centre.
        items.append(bought(f"sock{n}", "sock", box(x - 6.085, x + 4.815, y + 0.85, y + 6.7, -S["sock"]["heightMm"], 0)))
        skirt = PLATE_TOP + P["capSkirtAbovePlateMm"]
        items.append(bought(f"cap{n}", "cap", box(x - cap["baseMm"] / 2, x + cap["baseMm"] / 2, y - cap["baseMm"] / 2,
                                                   y + cap["baseMm"] / 2, skirt, skirt + cap["heightMm"])))

    ins, scr = S["ins"], S["scr"]
    for n, (x, y) in enumerate(hole_centres(), 1):
        items.append(bought(f"ins{n}", "ins", cyl(ins["outerMm"] / 2, PCB_T, PCB_T + ins["lengthMm"], x, y)
                            - cyl(scr["diameterMm"] / 2, PCB_T, PCB_T + ins["lengthMm"], x, y)))
        z = -TRAY_H  # the tray's underside: the head sits in its counterbore, flush
        items.append(bought(f"scr{n}", "scr", cyl(scr["headMm"] / 2, z, z + scr["headHeightMm"], x, y)
                            + cyl(scr["diameterMm"] / 2, z + scr["headHeightMm"], z + scr["headHeightMm"] + scr["lengthMm"], x, y)))

    feet = S["feet"]
    for n, (sx, sy) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1)), 1):
        x, y = sx * P["footCentreXMm"], sy * P["footCentreYMm"]
        items.append(bought(f"foot{n}", "feet", cyl(feet["diameterMm"] / 2, -TRAY_H - feet["heightMm"], -TRAY_H, x, y), tags=("foot",)))

    # The cable, plugged in: the micro-B plug in the Pico's socket, its overmold out through the opening in the wall.
    # The plug is longer than the socket is deep (bom.json), so it bottoms out with that much metal showing past the
    # socket's mouth at the Pico's end, and the overmold starts there.
    c = S["cable"]
    cy, cz = P["controllerCenterYMm"], PCB_T + P["usbOpeningZMm"]
    face = x1 + c["microBLengthMm"] - S["ctrl"]["usbDepthMm"]
    plug = box(face - c["microBLengthMm"], face, cy - c["microBWidthMm"] / 2, cy + c["microBWidthMm"] / 2,
               cz - c["microBHeightMm"] / 2, cz + c["microBHeightMm"] / 2)
    ow, oh = (float(v) for v in c["overmoldMaxMm"].split(" x "))
    over = box(face, face + c["plugLengthMm"] - c["microBLengthMm"], cy - ow / 2, cy + ow / 2, cz - oh / 2, cz + oh / 2)
    items.append(bought("cable", "cable", plug + over))

    usb_end = P["controllerCenterXMm"] + P["controllerLengthMm"] / 2
    pico_top = PCB_T + tall
    return System(
        items=items,
        min_clearance_mm=P["minClearanceMm"],
        fits=[
            Fit("cap*", "sw*", "the cap's skirt goes over the switch housing and its socket onto the stem"),
            Fit("sw*", "sock*", "the switch pins push into the socket's clips"),
            Fit("cable", "ctrl", "the plug is in the Pico's socket"),
        ],
        contacts=[
            Contact("pcb", "bot", "the board on the tray's standoffs"),
            Contact("top", "bot", "the top's walls on the tray's"),
            Contact("top", "pcb", "the top's bosses on the board"),
            Contact("ctrl", "pcb", "the Pico soldered flat"),
            Contact("sw*", "pcb", "each switch's housing on the board, its 3.9 mm centre post located in the "
                    "footprint's 4.0 mm hole", gap=0),
            Contact("sw*", "top", "each switch clipped into the plate"),
            Contact("sock*", "pcb", "each socket under the board"),
            Contact("ins*", "top", "each insert in its boss"),
            Contact("ins*", "pcb", "each insert flush with its boss face on the board"),
            Contact("scr*", "bot", "each screw head in its counterbore"),
            Contact("scr*", "ins*", "each screw drawn at its insert's bore, which its thread cuts into", gap=0),
            Contact("foot*", "bot", "the feet stuck under the tray"),
        ],
        inside=[Inside("ctrl", ("top", "bot"), "the Pico"), Inside("sock*", ("top", "bot"), "the sockets"),
                Inside("ins*", ("top", "bot"), "the inserts")],
        unplaced={},
        poses=[Pose("on the desk", pushes=[
            Push("a 2 N press on the corner key", (key_centres()[0][0], key_centres()[0][1], PLATE_TOP + 12), (0, 0, -2.0)),
        ])],
        probes=[
            Port("bootsel", "ctrl", (usb_end - P["bootselFromUsbEndMm"], cy + P["bootselAcrossMm"], pico_top), (0, 0, 1),
                 0.5, why="a 1 mm pin reaches BOOTSEL through the lid"),
            Light("led", (usb_end - P["ledFromUsbEndMm"], cy + P["ledAcrossMm"], pico_top), (0, 0, 1), 10, "out", 0.9,
                  ignore=("ctrl",), why="the Pico's LED shows through its window"),
        ],
    )
