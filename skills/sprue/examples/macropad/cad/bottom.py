"""Macro keypad, bottom tray: floor, low walls and standoffs with counterbored screw holes, and the foot of the USB
opening."""

from build123d import (
    Align, Box, BuildPart, BuildSketch, Cylinder, Locations, Mode, Part, RectangleRounded, extrude,
)

from _params import CORNER_R, INNER_H, INNER_W, OUTER_H, OUTER_W, P, hole_centres

FLOOR = P["trayFloorMm"]
STANDOFF = P["standoffHeightMm"]


def make() -> Part:
    with BuildPart() as tray:
        with BuildSketch():
            RectangleRounded(OUTER_W, OUTER_H, CORNER_R)
        extrude(amount=FLOOR + STANDOFF)
        with Locations((0, 0, FLOOR)):
            with BuildSketch():
                RectangleRounded(INNER_W, INNER_H, CORNER_R - P["caseWallMm"] / 2)
            extrude(amount=STANDOFF, mode=Mode.SUBTRACT)
        with Locations(*[(x, y, FLOOR) for x, y in hole_centres()]):
            Cylinder(P["standoffOuterMm"] / 2, STANDOFF, align=(Align.CENTER, Align.CENTER, Align.MIN))
        with Locations(*[(x, y, 0) for x, y in hole_centres()]):
            Cylinder(P["screwClearanceMm"] / 2, FLOOR + STANDOFF, align=(Align.CENTER, Align.CENTER, Align.MIN),
                     mode=Mode.SUBTRACT)
            Cylinder(P["counterboreMm"] / 2, P["counterboreDepthMm"], align=(Align.CENTER, Align.CENTER, Align.MIN),
                     mode=Mode.SUBTRACT)
        # The top's USB opening (cad/top.py), cut through this wall too: the opening reaches below the PCB bottom,
        # where the tray's wall meets the top's, so the plug's overmold needs that notch in the tray as well.
        usb_z = FLOOR + STANDOFF + P["pcbThicknessMm"] + P["usbOpeningZMm"]  # the tray's top is the PCB bottom
        with Locations((OUTER_W / 2 - P["caseWallMm"] / 2, P["controllerCenterYMm"], usb_z)):
            Box(P["caseWallMm"] + 1, P["usbOpeningWidthMm"], P["usbOpeningHeightMm"], mode=Mode.SUBTRACT)
    return tray.part
