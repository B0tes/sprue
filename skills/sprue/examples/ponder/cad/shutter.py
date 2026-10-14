"""Ponder lens shutter: a plate that slides in the head lower shell's track, with a thumb nub
that pokes out through the floor slot beside the camera window.

Head frame, drawn in the closed position (plate over the window). Slide the nub toward the Pi
end by shutterTravelMm to open. The plate drops into the lip-free end of the track (under where
the camera sits) before the camera is seated, then the camera and the rail lips keep it captive.
"""

from build123d import Part, Pos, RectangleRounded, extrude

from _params import (
    IZ0, LENS_Y, NUB_DROP, NUB_L, NUB_W, NUB_X_CLOSED, SH_LEN, SH_T, SH_W, SH_X0_CLOSED,
    SH_X1_CLOSED, TAIL_L, TAIL_W, TAIL_Y, box, slot_z,
)


def make() -> Part:
    plate = Pos((SH_X0_CLOSED + SH_X1_CLOSED) / 2, LENS_Y, IZ0) * extrude(
        RectangleRounded(SH_LEN, SH_W, 2.0), SH_T)
    tail = box(SH_X0_CLOSED - TAIL_L, SH_X0_CLOSED + 1.0, TAIL_Y - TAIL_W / 2, TAIL_Y + TAIL_W / 2,
               IZ0, IZ0 + SH_T * 0.75)
    half = (NUB_L - NUB_W) / 2
    nub = slot_z(NUB_X_CLOSED - half, TAIL_Y, NUB_X_CLOSED + half, TAIL_Y, NUB_W,
                 -NUB_DROP, IZ0 + 0.5)
    return plate + tail + nub
