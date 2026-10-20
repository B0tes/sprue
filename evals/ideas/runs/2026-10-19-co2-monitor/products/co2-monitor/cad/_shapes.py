"""Small build123d helpers shared by the case parts (not a part: the name starts with _)."""

from build123d import Axis, Box, Cylinder, Pos, Rot, fillet


def box(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def ycyl(r, y0, y1, x, z):
    """A cylinder along y, from y0 to y1, centred on (x, z)."""
    return Pos(x, (y0 + y1) / 2, z) * Rot(90, 0, 0) * Cylinder(r, abs(y1 - y0))


def rounded_y(part, r):
    """Round the edges that run along y (the case's corners as seen from the front)."""
    return fillet(part.edges().filter_by(Axis.Y), radius=r)


def rounded_x(part, r):
    return fillet(part.edges().filter_by(Axis.X), radius=r)
