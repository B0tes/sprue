"""Macro keypad, bottom tray: floor, low walls and standoffs with counterbored screw holes."""

from build123d import (
    Align, BuildPart, BuildSketch, Cylinder, Locations, Mode, Part, RectangleRounded, extrude,
)

from parts._macropad import CORNER_R, INNER_H, INNER_W, OUTER_H, OUTER_W, P, hole_centres

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
            Cylinder(3.5, STANDOFF, align=(Align.CENTER, Align.CENTER, Align.MIN))
        with Locations(*[(x, y, 0) for x, y in hole_centres()]):
            Cylinder(1.7, FLOOR + STANDOFF, align=(Align.CENTER, Align.CENTER, Align.MIN),
                     mode=Mode.SUBTRACT)
            Cylinder(3.0, P["screwHeadHeightMm"], align=(Align.CENTER, Align.CENTER, Align.MIN),
                     mode=Mode.SUBTRACT)
    return tray.part
