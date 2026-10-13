"""Shared numbers for the macro keypad case, read from ../design.json.

All positions are in PCB coordinates: origin at the PCB centre, x to the right
(the USB end), y up (the controller end), z up from the PCB top surface.
"""

import json
import pathlib

P = json.loads(
    (pathlib.Path(__file__).parents[1] / "design.json").read_text()
)["params"]

PITCH = P["keyPitchMm"]
PCB_W, PCB_H = P["pcbWidthMm"], P["pcbHeightMm"]
INNER_W = PCB_W + 2 * P["caseClearanceMm"]
INNER_H = PCB_H + 2 * P["caseClearanceMm"]
OUTER_W = INNER_W + 2 * P["caseWallMm"]
OUTER_H = INNER_H + 2 * P["caseWallMm"]
CORNER_R = P["caseCornerMm"]


def key_centres():
    """Centres of the 3x3 keys, bottom row nearest -y."""
    first_y = -PCB_H / 2 + P["pcbEdgeToKeyMm"] + PITCH / 2
    return [
        ((c - (P["keyCols"] - 1) / 2) * PITCH, first_y + r * PITCH)
        for r in range(P["keyRows"])
        for c in range(P["keyCols"])
    ]


def hole_centres():
    dx = PCB_W / 2 - P["holeInsetMm"]
    dy = PCB_H / 2 - P["holeInsetMm"]
    return [(sx * dx, sy * dy) for sx in (-1, 1) for sy in (-1, 1)]


def controller_box():
    """(xmin, xmax, ymin, ymax) of the controller footprint."""
    cx, cy = P["controllerCenterXMm"], P["controllerCenterYMm"]
    hl, hw = P["controllerLengthMm"] / 2, P["controllerWidthMm"] / 2
    return cx - hl, cx + hl, cy - hw, cy + hw
