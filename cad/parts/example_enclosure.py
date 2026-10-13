"""Example: a simple rounded enclosure shell. Delete once the idea has real parts."""

from build123d import Box, Part, fillet, offset

WIDTH, DEPTH, HEIGHT = 80, 50, 25  # mm
WALL = 2  # mm


def make() -> Part:
    body = Box(WIDTH, DEPTH, HEIGHT)
    body = fillet(body.edges(), radius=4)
    top = body.faces().sort_by().last
    return offset(body, amount=-WALL, openings=top)
