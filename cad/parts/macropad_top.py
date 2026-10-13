"""Macro keypad, top shell: switch plate, walls, insert bosses and the USB opening.

Printed upside down (plate on the bed). The plate is 1.5 mm, which the MX switch clips need.
"""

from build123d import (
    Align, Box, BuildPart, BuildSketch, Cylinder, Locations, Mode, Part, Rectangle,
    RectangleRounded, extrude,
)

from parts._macropad import (
    INNER_H, INNER_W, OUTER_H, OUTER_W, CORNER_R, P, controller_box, hole_centres, key_centres,
)

PLATE = P["plateThicknessMm"]
DROP = P["plateTopToPcbTopMm"]  # plate top down to PCB top
WALL_H = DROP + P["pcbThicknessMm"]  # walls cover the PCB edge


def make() -> Part:
    with BuildPart() as top:
        # Outer shell, top face at z = DROP (PCB top is z = 0).
        with BuildSketch() as s:
            RectangleRounded(OUTER_W, OUTER_H, CORNER_R)
        extrude(amount=WALL_H)
        with BuildSketch() as s:
            RectangleRounded(INNER_W, INNER_H, CORNER_R - P["caseWallMm"] / 2)
        extrude(amount=WALL_H - PLATE, mode=Mode.SUBTRACT)

        # Pocket over the controller so its USB connector clears the lid.
        x0, x1, y0, y1 = controller_box()
        skin = P["lidSkinOverControllerMm"]
        with Locations(((x0 + x1) / 2, (y0 + y1) / 2, WALL_H - PLATE)):
            Box(x1 - x0 + 0.8, y1 - y0 + 0.8, PLATE - skin,
                align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)

        # Switch cutouts.
        with Locations(*[(x, y, WALL_H - PLATE) for x, y in key_centres()]):
            Box(P["plateCutoutMm"], P["plateCutoutMm"], PLATE,
                align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)

        # Bosses for heat-set inserts, from the plate underside down to the PCB top.
        boss_h = WALL_H - PLATE - P["pcbThicknessMm"]
        with Locations(*[(x, y, P["pcbThicknessMm"]) for x, y in hole_centres()]):
            Cylinder(P["bossOuterMm"] / 2, boss_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
            Cylinder(P["insertOuterMm"] / 2, P["insertLengthMm"],
                     align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)

        # USB opening in the +x wall, centred on the connector.
        usb_z = P["pcbThicknessMm"] + 2.35
        with Locations((OUTER_W / 2 - P["caseWallMm"] / 2, P["controllerCenterYMm"], usb_z)):
            Box(P["caseWallMm"] + 1, P["usbOpeningWidthMm"], P["usbOpeningHeightMm"],
                mode=Mode.SUBTRACT)
    # z = 0 is the PCB bottom in this part, so the walls sit on the tray.
    return top.part
