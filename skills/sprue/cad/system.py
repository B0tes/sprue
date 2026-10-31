"""Check the whole product: every part in one frame, as it is assembled, checked as one thing.

Run: python3 system.py <product folder>   (what `sprue system <slug>` does; `sprue cad` runs it too)

The product's cad/_system.py defines system() returning a System: each printed part from its own module, each bought
part as an envelope (a box or cylinder at the sizes its datasheet gives) or its maker's model, all placed in one frame
in mm with z up. This file then checks the product as a whole, from that geometry rather than from the numbers
design.json types for the engineer checks:

- placed     every BOM line the product needs is in the frame, as many times as the BOM says, or named in `unplaced`
             with the reason (a cable that ships loose), or drawn along a path (a gooseneck bent to the design pose),
             which the 3D model and previews/system.svg show and no other gate checks as a shape
- overlap    no two parts share volume, except the fits the design means (an insert pressed into its boss), and
             each part of a fit does share volume with its partner
- contact    the parts meant to touch do (a board on its standoffs)
- clearance  every other pair is at least the design's minimum gap apart, so a part that comes out of the printer
             a little large still goes in; or as close as a Gap the design accepts for it, with its reason
- inside     the parts meant to be inside the case are inside it
- stability  each part's mass (a printed part's volume times its material's density, a bought part's from bom.json),
             the centre of mass, what the product stands on, the tilt that tips it over and the push that does, in
             each pose
- function   sound out of each speaker (the share of its cone that sees out through the grille), each microphone
             port open, each camera's view clear of the product, each light reaching its window or diffuser, and
             metal kept away from each radio antenna

A design may accept a known risk with its reason (a Pose's or Push's tipping, a probe falling short, a Gap): it is a
flag in the gate, not a failure.

Each gate then runs again on copies of the product with a fault put in (a part moved into its neighbour, or just
under the gap, or under the one a Gap accepts, one of the parts of a line left out, a fitted part pulled out of its fit, a contact lifted, a part
moved out of the case, the centre of mass pushed past a foot, a grille or a port closed, a plate across a camera's
view or in front of a light, metal on an antenna) and the check fails unless every gate catches its fault, as a
problem that names the parts the fault moved and that the product without the fault does not have (a fault in a
probe the design accepts falling short is judged with its reason set aside): the self-test. The result is system.json, which
`sprue score` reads, and previews/system.svg. system.json also says, for the 3D view, where each problem is (the parts it
is of and a point in the frame), each part's BOM line, model, material, mass and bounding box, and which parts meet each
fit, contact, gap and inside; and previews/system.glb is the frame as a 3D model, a node per part, the board wearing its
two faces drawn from its zip, and a part drawn along a path with them (in previews/system.svg too), which no gate
checks as a shape.
"""

from __future__ import annotations

import copy
import fnmatch
import hashlib
import importlib
import json
import math
import os
import pathlib
import re
import sys
import time
import traceback
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

import numpy as np
from build123d import Box, CenterOf, Compound, Cylinder, Location, Pos, Rot, Vector

# Densities in g/cm3, used when design.json gives none (its <material>DensityGPerCm3 params win: pa12DensityGPerCm3).
# Each is the maker's or the standard's figure for the printed or bought material.
DENSITY = {
    "PLA": 1.24,     # Prusament PLA datasheet
    "PETG": 1.27,    # Prusament PETG datasheet
    "ABS": 1.04,     # Prusament ABS datasheet
    "ASA": 1.07,     # Prusament ASA datasheet
    "PA12": 1.01,    # HP 3D High Reusability PA 12 (MJF) datasheet, part density
    "FR4": 1.85,     # typical FR-4 laminate
    "steel": 7.85,   # carbon steel
    "stainless": 7.93,
    "brass": 8.5,
    "aluminium": 2.70,
    "zinc": 7.14,
}
METALS = {"steel", "stainless", "brass", "aluminium", "zinc", "copper"}
TOUCH_MM = 0.02  # closer than this counts as touching
OVERLAP_MM3 = 0.01  # shared volume below this is round-off


# ---- what a product's _system.py builds ---------------------------------------------------------------------------


@dataclass
class Item:
    """One physical part, placed. `shape` is a build123d shape in the product frame (mm)."""

    id: str
    shape: object
    line: str | None = None  # the bom.json line it is one of
    material: str | None = None  # its mass is its volume times this material's density (printed and metal parts)
    mass_g: float | None = None  # a bought part's mass, from its bom.json line's spec.massG or its datasheet (wins over material)
    mass_note: str = ""  # where mass_g comes from; "estimate" anywhere in it marks the mass as a guess
    tags: tuple = ()  # "foot" (stands on the desk), "metal", "transparent" (light passes: a diffuser or window)
    model: str = "cad"  # "cad" (the product's own part file), "envelope" (a box or cylinder at datasheet sizes, or estimates)

    @property
    def metal(self) -> bool:
        return "metal" in self.tags or (self.material or "") in METALS


@dataclass
class PointMass:
    """Mass that isn't an item in the frame: a cable, or a gooseneck bent to a pose (which the 3D model may draw as a
    Drawn of the same id). The stability gate weighs it; system.json gives a Drawn the mass of those of its id in the
    first pose."""

    id: str
    at: tuple
    mass_g: float
    line: str | None = None
    note: str = ""


@dataclass
class Drawn:
    """A part the 3D model draws along the path it takes as built, that no gate checks as a shape: a gooseneck, which
    bends to each pose, so the stability gate weighs it as a PointMass of each instead, by the same id. `shape` is a
    build123d shape in the product frame (mm); `why` says what path it is drawn along and how the gates weigh it
    instead. Placed counts it for its line; system.json gives it the mass of the first pose's PointMass of its id."""

    id: str
    shape: object
    line: str | None = None
    why: str = ""
    model: str = "path"


@dataclass
class Fit:
    """Two parts meant to share volume (an insert pressed into a boss, a screw cut into its insert)."""

    a: str
    b: str
    why: str


@dataclass
class Contact:
    """Two parts meant to touch: a board on its standoffs, a lid on its tray. Their other faces keep `gap` from each
    other (the system's min_clearance_mm when None); 0 for a part a fit locates, as a switch's post locates it in its
    footprint's hole, whose faces then need only not overlap the other's."""

    a: str
    b: str
    why: str = ""
    gap: float | None = None


@dataclass
class Gap:
    """Two parts (id patterns, as a Contact's) the design lets sit closer than the system's min_clearance_mm, down to
    `mm` (0 or more), for `accept`, its reason: a known risk, flagged by the clearance gate, not failed. Under `mm` the
    pair still fails, as it does sharing volume; and a Gap with no reason is a problem."""

    a: str
    b: str
    mm: float
    accept: str = ""


@dataclass
class Inside:
    """Parts (an id pattern) meant to be inside the case those parts (patterns) make."""

    items: str
    within: tuple
    why: str = ""


@dataclass
class Push:
    """A force on the product in a pose: a hand pressing a key or pulling the head sideways (newtons). `accept` is the
    design's reason to live with it tipping (as rules.ts flags it): a flag, not a failure."""

    name: str
    at: tuple
    force: tuple
    accept: str = ""


@dataclass
class Pose:
    """A way the product stands: the items that move (a head on its arm) and the forces it must stand. The 3D model
    draws a pose as the frame with the items `drop` takes out moved by `moved` and `drawn` in place of the frame's
    Drawns of their ids; no gate checks either as a shape there, as the stability gate weighs `items` instead."""

    name: str
    items: list = field(default_factory=list)  # Items and PointMasses added in this pose
    pushes: list = field(default_factory=list)
    drop: tuple = ()  # id patterns of the frame's items this pose moves: they leave, and `items` stand in for them
    accept: str = ""  # the design's reason to live with this pose tipping over: a flag, not a failure
    drawn: list = field(default_factory=list)  # Drawns along the paths this pose bends them to (the arm pulled out)
    moved: object = None  # a build123d Location: where the 3D model draws the items `drop` takes out (None: not drawn)


@dataclass
class Sound:
    """Sound out of a speaker: rays from its cone, `normal` pointing out of the product, must see out."""

    id: str
    source: str  # the speaker's item id (its own hits don't count)
    center: tuple
    normal: tuple
    radius: float
    min_open: float  # the share of the cone that must see out
    why: str = ""
    aim_open: float | None = None  # the share the design aims for: under it is noted in the gate, not failed
    accept: str = ""  # the design's reason to live with it falling short: a flag, not a failure (every probe has one)


@dataclass
class Port:
    """A microphone's sound port: rays from the sensor along the port must reach open air."""

    id: str
    source: str
    center: tuple
    normal: tuple
    radius: float
    min_open: float = 0.95
    why: str = ""
    accept: str = ""


@dataclass
class View:
    """A camera's field of view. With no `target`, it must not see any part of the product. With one (a region such
    as the page on the desk, a build123d shape), every point of its upper surface must be in the image with no part in
    front of it, and how much of the image the product fills is reported, not failed. A transparent part (a diffuser,
    a window) counts as in the view: a camera sees a diffuser, and through a window only what its maker says."""

    id: str
    origin: tuple
    axis: tuple
    up: tuple
    hfov_deg: float
    vfov_deg: float
    ignore: tuple = ()  # the camera's own items
    why: str = ""
    target: object = None
    accept: str = ""


@dataclass
class Light:
    """Light from an LED, in a cone, must first meet `target` (a diffuser's or window's id pattern, or "out")."""

    id: str
    origin: tuple
    axis: tuple
    half_angle_deg: float
    target: str
    min_share: float
    ignore: tuple = ()
    why: str = ""
    accept: str = ""


@dataclass
class Keepout:
    """No metal within `min_mm` of a region, such as a radio antenna."""

    id: str
    region: object  # a build123d shape
    min_mm: float
    why: str = ""
    ignore: tuple = ()
    accept: str = ""


@dataclass
class System:
    items: list
    min_clearance_mm: float
    fits: list = field(default_factory=list)
    contacts: list = field(default_factory=list)
    gaps: list = field(default_factory=list)  # Gaps: pairs the design lets sit closer than min_clearance_mm
    inside: list = field(default_factory=list)
    unplaced: dict = field(default_factory=dict)  # bom line id -> why it isn't in the frame
    drawn: list = field(default_factory=list)  # Drawns: parts the 3D model draws along a path, which no gate checks
    poses: list = field(default_factory=list)  # none: one pose, as built
    min_tilt_deg: float = 10.0
    probes: list = field(default_factory=list)
    note: str = ""


class Missing(KeyError):
    """A BOM line, a field of one or a file the product's _system.py needs that is not there. The check fails saying
    which and what to do, in system.json, instead of stopping on a bare KeyError or FileNotFoundError."""

    def __str__(self):
        return str(self.args[0])


class Need(dict):
    """A dict that, read at a key it lacks, raises Missing with `say(key)`; .get() still gives None or its default."""

    def __init__(self, data, say):
        super().__init__(data)
        self.say = say

    def __missing__(self, key):
        raise Missing(self.say(key))


def bom_lines(product):
    """(BOM, S) for a product's _system.py: bom.json's lines by id, and each line's spec by id. A line, or a field of
    a line or of its spec, that isn't there raises Missing naming it."""
    path = pathlib.Path(product) / "bom.json"
    if not path.is_file():
        raise Missing("there is no bom.json, which cad/_system.py reads the parts from: write it, then run sprue system")
    lines = [l for l in json.loads(path.read_text())["lines"] if isinstance(l, dict) and "id" in l]
    gone = lambda id: (f"bom.json has no {id} line, which cad/_system.py puts in the frame: put the line back, or take "
                       "its part out of cad/_system.py")
    field = lambda id, where: lambda k: f"bom.json's {id} line has no {where}{k}, which cad/_system.py reads: give it"
    bom = Need({l["id"]: Need(l, field(l["id"], "")) for l in lines}, gone)
    return bom, Need({id: Need(l.get("spec") or {}, field(id, "spec.")) for id, l in bom.items()}, gone)


def estimates(table):
    """A product's mass estimates by BOM line, for a line with no spec.massG: one with neither fails the check naming
    it, rather than stopping on a KeyError."""
    return Need(table, lambda id: f"bom.json's {id} line has no spec.massG, and cad/_system.py has no estimate for it: "
                                  "give its massG")


# ---- geometry helpers ---------------------------------------------------------------------------------------------


def box(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def cyl(r, z0, z1, x=0.0, y=0.0):
    return Pos(x, y, (z0 + z1) / 2) * Cylinder(r, z1 - z0)


def board_from_gerbers(zip_path, thickness_mm):
    """The board as the fab makes it: the outline in the shipped zip's profile layer with every drill punched through,
    extruded to its thickness from z = 0. Needs gerbonara and shapely (as the read-back does)."""
    if not pathlib.Path(zip_path).is_file():
        raise Missing(f"no {zip_path}, which the board is read from: sprue pcb writes it once the board passes its "
                      "audit, so fix what sprue pcb reports, then run sprue cad")
    import zipfile

    from build123d import Face, Polyline, extrude, make_face
    from gerbonara import ExcellonFile, GerberFile
    from gerbonara.utils import MM
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union

    zf = zipfile.ZipFile(zip_path)
    names = zf.namelist()
    edge = [n for n in names if n.lower().endswith((".gm1", ".gko", "edge_cuts.gbr", ".boardoutline.ger"))]
    if len(edge) != 1:
        raise ValueError(f"{zip_path}: expected one outline layer, found {edge or 'none'}")
    import warnings

    def arc_points(p):
        """An arc primitive as points along it (its centre cx, cy is absolute in gerbonara)."""
        a0, a1 = math.atan2(p.y1 - p.cy, p.x1 - p.cx), math.atan2(p.y2 - p.cy, p.x2 - p.cx)
        r = math.hypot(p.x1 - p.cx, p.y1 - p.cy)
        if p.clockwise and a1 >= a0:
            a1 -= 2 * math.pi
        elif not p.clockwise and a1 <= a0:
            a1 += 2 * math.pi
        steps = max(4, int(abs(a1 - a0) / math.radians(5)))
        return [(p.cx + r * math.cos(a0 + (a1 - a0) * i / steps), p.cy + r * math.sin(a0 + (a1 - a0) * i / steps))
                for i in range(steps + 1)]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # gerbonara warns about statement order our own writer is free to use
        g = GerberFile.from_string(zf.read(edge[0]).decode())
        drills = [ExcellonFile.from_string(zf.read(n).decode()) for n in names if n.lower().endswith(".drl")]
    segments = []
    for obj in g.objects:
        for prim in obj.to_primitives(MM):
            if hasattr(prim, "cx"):
                segments.append(LineString(arc_points(prim)))
            elif hasattr(prim, "x1"):
                segments.append(LineString([(prim.x1, prim.y1), (prim.x2, prim.y2)]))
            elif getattr(prim, "outline", None):
                pts = list(prim.outline)
                segments.append(LineString(pts + [pts[0]]))
    # The profile is drawn as lines with a thin aperture: their centre lines are the board edge.
    polys = list(polygonize(unary_union(segments)))
    if not polys:
        raise ValueError(f"{zip_path}: the outline doesn't close")
    outline = max(polys, key=lambda p: p.area)
    from build123d import Cylinder as _Cyl, SlotCenterToCenter, Rot as _Rot

    holes = []  # exact cylinders, so a gap round a screw is measured to the drill, not to a polygon inside it
    for ex in drills:
        for obj in ex.objects:
            d = MM(obj.aperture.diameter, obj.aperture.unit)
            if hasattr(obj, "x1"):  # a routed slot
                x1, y1, x2, y2 = (MM(v, obj.unit) for v in (obj.x1, obj.y1, obj.x2, obj.y2))
                length = math.hypot(x2 - x1, y2 - y1)
                slot = extrude(SlotCenterToCenter(max(length, 1e-3), d), thickness_mm + 2)
                holes.append(Pos((x1 + x2) / 2, (y1 + y2) / 2, -1) * _Rot(0, 0, math.degrees(math.atan2(y2 - y1, x2 - x1))) * slot)
            else:
                holes.append(Pos(MM(obj.x, obj.unit), MM(obj.y, obj.unit), thickness_mm / 2) * _Cyl(d / 2, thickness_mm + 2))
    face = make_face(Polyline(*[(x, y) for x, y in outline.exterior.coords]))
    solid = extrude(face, thickness_mm)
    for ring in outline.interiors:  # a cutout drawn on the profile layer
        solid = solid - extrude(make_face(Polyline(*[(x, y) for x, y in ring.coords])), thickness_mm)
    if holes:
        solid = solid - Compound(holes)
    # So the 3D model draws its faces on it (model_glb): a copy, which shares its geometry but keeps its own place when
    # the board is moved in place (move(), locate()), its vertices, which know it however it is placed, and a mark a
    # copy of it (mirror(), located(), deepcopy) carries.
    solid.sprue_board = len(BOARDS)
    BOARDS.append((copy.copy(solid), pathlib.Path(zip_path), _points(solid)))
    return solid, outline.bounds


# ---- running the gates --------------------------------------------------------------------------------------------


def matches(item_id, pattern):
    return fnmatch.fnmatchcase(item_id, pattern)


def pair_in(pairs, a, b):
    """The relation (a Fit or Contact) naming a and b, either way round."""
    for r in pairs:
        if (matches(a, r.a) and matches(b, r.b)) or (matches(a, r.b) and matches(b, r.a)):
            return r
    return None


def reason(x):
    """The design's reason to live with a known risk (a Gap's or a probe's `accept`), or "" when it gives none."""
    return str(getattr(x, "accept", "") or "").strip()


class Problem(str):
    """A gate's problem: its text, the ids of the parts it is of and a point in the product frame (mm) where it is, or
    None where it is of the parts as a whole (a line short of a part, a fit that shares no volume). system.json writes
    them as `where` beside the text, for the 3D view to mark; the text is the problem as the gates always told it."""

    def __new__(cls, text, parts=(), at=None):
        p = super().__new__(cls, text)
        p.parts = tuple(str(i) for i in parts)
        p.at = None if at is None else tuple(float(v) for v in at)
        return p

    def but(self, text):
        """The same problem told another way (a flag, with the design's reason), where it was."""
        return Problem(text, self.parts, self.at)


def where(problem):
    """A problem's `{parts, at}` as system.json writes it; a plain text (a gate that can't run) is of no part, nowhere."""
    at = getattr(problem, "at", None)
    return {"parts": list(getattr(problem, "parts", ())), "at": None if at is None else [round(v, 3) for v in at]}


def mid(p, q):
    return tuple((a + b) / 2 for a, b in zip(p, q))


def bbox(item):
    if not hasattr(item, "_bb"):
        b = item.shape.bounding_box()
        item._bb = (b.min.X, b.min.Y, b.min.Z, b.max.X, b.max.Y, b.max.Z)
    return item._bb


def near(a, b, pad):
    p, q = bbox(a), bbox(b)
    return all(p[i] - pad <= q[i + 3] and q[i] - pad <= p[i + 3] for i in range(3))


def common(a, b):
    """What two parts share, as a shape."""
    try:
        return a.shape & b.shape
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"can't intersect {a.id} and {b.id}: {e}") from e


def shared(a, b):
    return max(0.0, common(a, b).volume)


def inner_point(shape):
    """A point inside a shape near its middle, where the 3D view marks it, or None when none is found. The centre of
    mass of its largest solid when that is inside it; else the middle of a stretch between two crossings of the
    surface, along a line through that centre (an axis or a diagonal) or into the solid from one of its largest faces,
    the nearest the centre that is inside: where a ring, a shell or a plate round a hole is (what a peg shares with a
    hole drawn too small has its centre on the peg's axis, in the hole)."""
    pieces = shape.solids()
    if not pieces:
        return None
    s = max(pieces, key=lambda x: x.volume)
    c = s.center(CenterOf.MASS)
    if s.is_inside(c):
        return (c.X, c.Y, c.Z)
    from build123d import Axis

    lines = [(c, Vector(*d)) for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, -1, 0), (1, 0, 1), (1, 0, -1),
                                       (0, 1, 1), (0, 1, -1), (1, 1, 1), (1, 1, -1), (1, -1, 1), (-1, 1, 1))]
    for f in sorted(s.faces(), key=lambda f: f.area, reverse=True)[:3]:
        at = f.center()
        lines.append((at, f.normal_at(at)))
    middles = []
    for o, d in lines:
        try:
            hits = sorted((h - o).dot(d) for h, _ in s.find_intersection_points(Axis(o, d)))
        except Exception:  # noqa: BLE001  a line OpenCascade can't intersect: the others may
            continue
        middles += [o + d * ((t0 + t1) / 2) for t0, t1 in zip(hits, hits[1:]) if t1 - t0 > 1e-6]
    for m in sorted(middles, key=lambda m: (m - c).length)[:40]:
        if s.is_inside(m):
            return (m.X, m.Y, m.Z)
    return None


def gap(a, b):
    """Distance between two parts and the closest points (from a to b)."""
    d, pa, pb = a.shape.distance_to_with_closest_points(b.shape)
    return d, (pa.X, pa.Y, pa.Z), (pb.X, pb.Y, pb.Z)


def contact_gap(a, b, need):
    """For two parts meant to touch: the smallest gap, under `need`, between a face of one that doesn't touch the
    other and that other part, with where it is, or None. The faces that touch (closer than TOUCH_MM) are where the
    contact is. A gap counts only where the other part is in front of the face: the rim of a hole in a board, beside
    a socket it rests on, is that far from the socket's edge across the face they share, with no air between them."""
    worst = None
    for x, y in ((a, b), (b, a)):
        yb = bbox(y)
        for f in x.shape.faces():
            fb = f.bounding_box()
            lo, hi = (fb.min.X, fb.min.Y, fb.min.Z), (fb.max.X, fb.max.Y, fb.max.Z)
            if not all(lo[i] - need <= yb[i + 3] and yb[i] - need <= hi[i] for i in range(3)):
                continue
            d, p, q = f.distance_to_with_closest_points(y.shape)
            if not (TOUCH_MM < d < need - 1e-6) or (worst is not None and d >= worst[0]):
                continue
            if f.normal_at(p).dot(q - p) > 0.5 * d:
                worst = (d, (p.X, p.Y, p.Z))
    return worst


def mesh(item, tolerance=0.05):
    if not hasattr(item, "_mesh"):
        import trimesh

        verts, faces = item.shape.tessellate(tolerance, 0.3)
        item._mesh = trimesh.Trimesh(np.array([[v.X, v.Y, v.Z] for v in verts]), np.array(faces), process=False)
    return item._mesh


def moved(item, dx, dy, dz, suffix=""):
    m = replace(item, shape=Pos(dx, dy, dz) * item.shape, id=item.id + suffix)
    return m


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


class Run:
    """One pass of the gates over a list of items; the self-test makes more of these with faults put in."""

    def __init__(self, sysm: System, items, bom, params, only=None):
        self.s, self.items, self.bom, self.params = sysm, items, bom, params
        self.only = only  # item ids a fault touched: pair gates look only at pairs with one of them
        self._casters = {}
        self.met = {}  # id of a Fit, Contact or Gap -> the pairs of items it names that meet it, as the gates found them

    def meets(self, rels, a, b):
        """Note a pair of items as meeting each of `rels` (Fits, Contacts or Gaps) that names it: the item its `a` side
        matches first, and a pair both its sides match (half* / half*) once."""
        for r in rels:
            if not ((matches(a, r.a) and matches(b, r.b)) or (matches(a, r.b) and matches(b, r.a))):
                continue
            met = self.met.setdefault(id(r), {})
            if (b, a) not in met:
                met[(a, b) if matches(a, r.a) and matches(b, r.b) else (b, a)] = None

    def pairs(self, pad):
        out = []
        for i, a in enumerate(self.items):
            for b in self.items[i + 1:]:
                if self.only and a.id not in self.only and b.id not in self.only:
                    continue
                if near(a, b, pad):
                    out.append((a, b))
        return out

    # -- placed ---------------------------------------------------------------------------------------------------

    def placed(self):
        lines = {l["id"]: l for l in self.bom["lines"]}
        count = {}
        problems = []
        # A part drawn along a path is of its line as an item is; the 3D model names each node by its part's id.
        ids, drawn_ids = {it.id for it in self.items}, set()
        for d in self.s.drawn:
            if d.id in drawn_ids:
                problems.append(Problem(f"{d.id} is drawn along a path twice: give each its own id", [d.id]))
            elif d.id in ids:
                problems.append(Problem(f"{d.id} is drawn along a path and is a part in the frame too: give it one id or the other", [d.id]))
            drawn_ids.add(d.id)
            if d.line in self.s.unplaced:
                problems.append(Problem(f"{d.id} is drawn along a path, and unplaced names its line {d.line} as not in the frame", [d.id]))
        # A pose draws again what the frame draws along a path, and moves the items it takes out.
        lines_of = {d.id: d.line for d in self.s.drawn}
        for pose in self.s.poses:
            seen = set()
            for d in pose.drawn:
                if d.id in seen:
                    problems.append(Problem(f"{pose.name}: {d.id} is drawn along a path twice in this pose", [d.id]))
                seen.add(d.id)
                if d.id in ids:
                    problems.append(Problem(f"{pose.name}: {d.id} is a part in the frame, which a pose moves (moved) "
                                            "rather than draws along a path", [d.id]))
                elif d.id not in drawn_ids:
                    problems.append(Problem(f"{pose.name}: {d.id} is drawn along a path in this pose and not as built: "
                                            "draw it along its path as built too"))
                elif d.line != lines_of[d.id]:
                    problems.append(Problem(f"{pose.name}: {d.id} is drawn on bom.json line {d.line} in this pose and on "
                                            f"{lines_of[d.id]} as built: it is one part", [d.id]))
            if pose.moved is not None and not isinstance(pose.moved, Location):
                problems.append(Problem(f"{pose.name}: moved is a {type(pose.moved).__name__}, not a build123d Location "
                                        "(Pos(...) * Rot(...)), so the 3D model can't draw the parts it drops"))
            elif pose.moved is not None and not pose.drop:
                problems.append(Problem(f"{pose.name}: it moves the parts it drops, and drops none"))
        for it in self.items + self.s.drawn:
            if it.line is None:
                problems.append(Problem(f"{it.id} names no bom.json line", [it.id]))
            elif it.line not in lines:
                problems.append(Problem(f"{it.id} is on bom.json line {it.line}, which the BOM doesn't have", [it.id]))
            else:
                count[it.line] = count.get(it.line, 0) + 1
        for lid, l in lines.items():
            need = l.get("qtyPerUnit", 0)
            if not need:
                continue
            if lid in self.s.unplaced:
                continue
            have = count.get(lid, 0)
            if have != need:
                problems.append(Problem(f"{lid} ({l['name']}): {have} in the frame, the BOM has {need:g} per unit",
                                        [it.id for it in self.items + self.s.drawn if it.line == lid]))
        stale = [k for k in self.s.unplaced if k not in lines]
        problems += [Problem(f"unplaced names {k}, which bom.json doesn't have") for k in stale]
        n_lines = sum(1 for l in lines.values() if l.get("qtyPerUnit", 0))
        drawn = self.s.drawn
        detail = (f"{len(self.items)} parts" + (f" and {', '.join(d.id for d in drawn)} drawn along "
                                                 f"{'its path' if len(drawn) == 1 else 'their paths'}, which no gate checks as a shape,"
                                                 if drawn else "")
                  + f" from {n_lines - len([k for k in self.s.unplaced if k in lines])} of {n_lines} "
                  f"BOM lines in one frame" + (f"; not in it: " + "; ".join(f"{k} ({v})" for k, v in self.s.unplaced.items()) if self.s.unplaced else ""))
        return gate("placed", "Every part of the BOM is in the product, as many as the BOM says", problems, detail)

    # -- overlap, contact, clearance -------------------------------------------------------------------------------

    def overlap(self):
        problems, fits = [], []
        for a, b in self.pairs(0.0):
            both = common(a, b)
            v = max(0.0, both.volume)
            if v <= OVERLAP_MM3:
                continue
            f = pair_in(self.s.fits, a.id, b.id)
            if f:
                fits.append(f"{a.id}/{b.id} {v:.2f} mm3")
                self.meets(self.s.fits, a.id, b.id)
                continue
            problems.append(Problem(f"{a.id} and {b.id} share {v:.2f} mm3", [a.id, b.id], inner_point(both)))
        problems += self.fits_meet()
        detail = f"{len(self.items)} parts, no two share volume" + (f" but the fits meant to ({len(fits)})" if fits else "")
        return gate("overlap", "No two parts are in the same place", problems, detail)

    def fits_meet(self):
        """Each part a fit names shares volume with a part on its other side: an insert in its boss, not beside it. One
        that only touches is a contact, whose other faces must then keep the gap, which a fit is excused."""
        problems = []
        for r in self.s.fits:
            named = False
            for side, other in ((r.a, r.b), (r.b, r.a)):
                for it in self.items:
                    if not matches(it.id, side):
                        continue
                    named = True
                    if self.only and it.id not in self.only:
                        continue
                    partners = [o for o in self.items if o is not it and matches(o.id, other) and near(it, o, TOUCH_MM)]
                    if any(shared(it, o) > OVERLAP_MM3 for o in partners):
                        continue
                    touching = [(o, g) for o in partners for g in [gap(it, o)] if g[0] <= TOUCH_MM]
                    if touching:
                        o, (_, at, _) = touching[0]
                        problems.append(Problem(f"{it.id} only touches {o.id}, so it is not a fit ({r.why}): make it a Contact",
                                                [it.id, o.id], at))
                    else:
                        problems.append(Problem(f"{it.id} is meant to fit {other} ({r.why}) but shares no volume with it", [it.id]))
            if not named and not self.only:
                problems.append(Problem(f"fit {r.a} / {r.b} names no parts"))
        return problems

    def contact(self):
        """Each part a contact names touches a part on its other side: each screw its insert (scr*, ins*), the board
        its standoffs."""
        problems = []
        n = 0
        for r in self.s.contacts:
            named = False
            for side, other in ((r.a, r.b), (r.b, r.a)):
                for it in self.items:
                    if not matches(it.id, side):
                        continue
                    named = True
                    partners = [o for o in self.items if o is not it and matches(o.id, other)]
                    if self.only and it.id not in self.only and not any(o.id in self.only for o in partners):
                        continue
                    n += 1
                    ds = [(*gap(it, o), o) for o in partners if near(it, o, 1.0)]
                    for d, _, _, o in ds:
                        if d <= TOUCH_MM:
                            self.meets([r], it.id, o.id)
                    d, at, _, o = min(ds, key=lambda x: x[0], default=(math.inf, None, None, None))
                    if d > TOUCH_MM:
                        problems.append(Problem(f"{it.id} should touch {other}" + (f" ({r.why})" if r.why else "") +
                                                (f" but is {d:.2f} mm away" if d < math.inf else " but is nowhere near it"),
                                                [it.id] + ([o.id] if o else []), at))
            if not named and not self.only:
                problems.append(Problem(f"contact {r.a} / {r.b} names no parts"))
        return gate("contact", "The parts meant to touch do", problems, f"{n} parts touch the parts the design means them to")

    def clearance(self):
        need = self.s.min_clearance_mm
        problems, flags = [], []
        closest = None
        if not self.only:
            for g in self.s.gaps:
                if not reason(g):
                    problems.append(Problem(f"gap {g.a} / {g.b} gives no reason: give its accept, why the design lets them "
                                            f"sit closer than {need:g} mm"))
                if g.mm < 0:
                    problems.append(Problem(f"gap {g.a} / {g.b} is down to {g.mm:g} mm: a gap is 0 or more (sharing volume is a Fit)"))
                if not (any(matches(i.id, g.a) for i in self.items) and any(matches(i.id, g.b) for i in self.items)):
                    problems.append(Problem(f"gap {g.a} / {g.b} names no parts"))
        for a, b in self.pairs(need):
            # A fit or a contact is a pair that meets (scr1 and ins1, not scr1 and ins2, though both match scr*/ins*):
            # one that doesn't keeps the gap like any other pair.
            d, pa, pb = gap(a, b)
            if d <= TOUCH_MM and pair_in(self.s.fits, a.id, b.id):
                continue
            c = pair_in(self.s.contacts, a.id, b.id) if d <= TOUCH_MM else None
            if c:
                # They touch where the design means; every other face of either keeps the gap from the other (the
                # board's edge from the case walls, though the board sits on the standoffs).
                worst = contact_gap(a, b, need if c.gap is None else c.gap)
                if worst is not None:
                    d, at = worst
                    problems.append(Problem(f"{a.id} is {d:.2f} mm from {b.id} beside where they touch, at "
                                            f"({', '.join(f'{v:.1f}' for v in at)})", [a.id, b.id], at))
                continue
            if d <= TOUCH_MM and shared(a, b) > OVERLAP_MM3:
                continue  # the overlap gate reports it
            say = Problem(f"{a.id} is {'touching' if d <= TOUCH_MM else f'{d:.2f} mm from'} {b.id}", [a.id, b.id], mid(pa, pb))
            g = pair_in(self.s.gaps, a.id, b.id) if d < need - 1e-6 else None
            if g:
                self.meets(self.s.gaps, a.id, b.id)
            if g and reason(g) and d >= g.mm - 1e-6:
                # Closer than the gap, as close as the design accepts with its reason: a flag, not a failure.
                flags.append(say.but(f"{say} (accepted: {reason(g)})"))
                continue
            if closest is None or d < closest[0]:
                closest = (d, a.id, b.id)
            if d < need - 1e-6:
                problems.append(say.but(say + (f", under the {g.mm:g} mm the design accepts" if g and reason(g) else "")))
        detail = f"every other pair is at least {need:g} mm apart" + (f" but the gaps the design accepts ({len(flags)})" if flags else "") + (
            f"; the closest within that reach are {closest[1]} and {closest[2]}, {closest[0]:.2f} mm" if closest else "")
        return gate("clearance", f"Every other pair is at least {need:g} mm apart", problems, detail, flags)

    # -- inside -----------------------------------------------------------------------------------------------------

    def inside(self):
        from scipy.spatial import ConvexHull

        problems, n = [], 0
        for r in self.s.inside:
            case = [it for it in self.items if any(matches(it.id, w) for w in r.within)]
            parts = [it for it in self.items if matches(it.id, r.items)]
            if self.only:
                parts = [it for it in parts if it.id in self.only]
            if not case:
                problems.append(Problem(f"inside: no parts match {', '.join(r.within)}"))
                continue
            if not parts and not self.only:
                problems.append(Problem(f"inside: no parts match {r.items}"))
                continue
            pts = np.vstack([mesh(it).vertices for it in case])
            hull = ConvexHull(pts)
            eq = hull.equations  # n.x + d <= 0 inside
            for it in parts:
                n += 1
                v = mesh(it).vertices
                out = (v @ eq[:, :3].T + eq[:, 3]).max(axis=1)
                worst = float(out.max())
                if worst > 0.01:
                    problems.append(Problem(f"{it.id} reaches {worst:.2f} mm outside the case {'/'.join(r.within)}", [it.id],
                                            v[int(out.argmax())]))
        return gate("inside", "The parts meant to be inside the case are inside it", problems,
                    f"{n} parts inside the case")

    # -- stability --------------------------------------------------------------------------------------------------

    def mass(self, it):
        """(grams, where they come from, the centre of mass) of an item."""
        if it.mass_g is not None:  # a published mass beats the volume of an envelope
            m, note = float(it.mass_g), it.mass_note or "bom.json"
        elif it.material:
            key = f"{it.material.lower()}densitygpercm3"
            rho = next((float(v) for k, v in self.params.items() if k.lower() == key),
                       next((v for m, v in DENSITY.items() if m.lower() == it.material.lower()), None))
            if rho is None:
                raise MissingMass(f"{it.id}: no density for {it.material} (add {it.material.lower()}DensityGPerCm3 to design.json)", it.id)
            m, note = it.shape.volume / 1000 * rho, f"{it.shape.volume / 1000:.2f} cm3 of {it.material} at {rho:g} g/cm3"
        else:
            raise MissingMass(f"{it.id}: no mass (give its bom.json line {it.line} a spec.massG, or the Item a material)", it.id)
        c = it.shape.center(CenterOf.MASS) if it.model == "cad" or it.material else it.shape.center(CenterOf.BOUNDING_BOX)
        return m, note, (c.X, c.Y, c.Z)

    def masses(self, extra=(), drop=()):
        out = []
        for it in [i for i in self.items if not any(matches(i.id, d) for d in drop)] + [x for x in extra if isinstance(x, Item)]:
            m, note, c = self.mass(it)
            out.append((it.id, m, c, note))
        for p in extra:
            if isinstance(p, PointMass):
                out.append((p.id, float(p.mass_g), tuple(p.at), p.note or "point mass"))
        return out

    def stability(self):
        from shapely.geometry import MultiPoint, Point
        from shapely.geometry.polygon import orient

        poses = self.s.poses or [Pose("as built")]
        problems, rows, flags = [], [], []
        for pose in poses:
            # A pose or push the design accepts tipping in (with its reason) is flagged, not failed.
            report = (lambda msg, why=pose.accept: flags.append(msg.but(f"{msg} (accepted: {why})")) if why else problems.append(msg))
            for d in pose.drop:
                if not any(matches(i.id, d) for i in self.items):
                    problems.append(Problem(f"{pose.name}: drop {d} names no parts"))
            try:
                ms = self.masses(pose.items, pose.drop)
            except MissingMass as e:
                problems.append(Problem(f"{pose.name}: can't run: {e}", [e.id]))
                continue
            geo = [i for i in self.items if not any(matches(i.id, d) for d in pose.drop)] + [x for x in pose.items if isinstance(x, Item)]
            z0 = min(bbox(it)[2] for it in geo)
            feet = [it for it in geo if "foot" in it.tags]
            if feet:
                low = min(bbox(it)[2] for it in feet)
                if low > z0 + TOUCH_MM:
                    under = min(geo, key=lambda it: bbox(it)[2])
                    problems.append(Problem(f"{pose.name}: {under.id} hangs {low - z0:.2f} mm below the feet, so the product stands on it",
                                            [under.id]))
            base = feet or geo
            pts = []
            for it in base:
                v = mesh(it).vertices
                pts += [tuple(p[:2]) for p in v[v[:, 2] <= z0 + 0.05]]
            hull = MultiPoint(pts).convex_hull
            if hull.geom_type != "Polygon":
                problems.append(Problem(f"{pose.name}: it stands on a point or a line", [it.id for it in base]))
                continue
            hull = orient(hull, 1.0)
            M = sum(m for _, m, _, _ in ms)
            com = tuple(sum(m * c[i] for _, m, c, _ in ms) / M for i in range(3))
            h = com[2] - z0
            ring = list(hull.exterior.coords)
            edges = []
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                e = unit((x2 - x1, y2 - y1, 0))
                nrm = np.array([e[1], -e[0], 0.0])  # outward for a counter-clockwise ring
                d = float(np.dot(np.array([x1, y1, 0.0]) - np.array([com[0], com[1], 0.0]), nrm))  # COM inside: d > 0
                edges.append(((x1, y1), (x2, y2), nrm, d))
            inside = hull.contains(Point(com[0], com[1]))
            tilt = min((math.degrees(math.atan2(d, h)), i) for i, (_, _, _, d) in enumerate(edges))
            row = {"pose": pose.name, "massG": round(M, 1), "com": [round(c, 1) for c in com],
                   "tiltDeg": round(tilt[0], 1), "tipsToward": [round(v, 2) for v in edges[tilt[1]][2][:2]],
                   "estimatedG": round(sum(m for _, m, _, note in ms if "estimate" in note.lower()), 1), "pushes": []}
            if not inside:
                report(Problem(f"{pose.name}: the centre of mass ({com[0]:.1f}, {com[1]:.1f}) is outside what it stands on", (), com))
            elif tilt[0] < self.s.min_tilt_deg:
                report(Problem(f"{pose.name}: tips at {tilt[0]:.1f} deg, under {self.s.min_tilt_deg:g}", (), com))
            for push in pose.pushes:
                f = unit(push.force)
                need = float(np.linalg.norm(push.force))
                worst = math.inf
                for p1, p2, nrm, d in edges:
                    u = np.cross([0, 0, 1.0], nrm)
                    arm = float(np.dot(np.cross(np.array(push.at) - np.array([*p1, z0]), f), u))  # tipping moment per N
                    if arm > 1e-9:
                        worst = min(worst, (M / 1000 * 9.81 * d / 1000) / (arm / 1000))
                row["pushes"].append({"name": push.name, "tipN": None if worst == math.inf else round(worst, 2), "needN": need})
                if worst < need:
                    report(Problem(f"{pose.name}: {push.name} tips it at {worst:.2f} N, under the {need:g} N it must stand", (), push.at),
                           push.accept or pose.accept)
            rows.append(row)
        self.stab = rows
        detail = "; ".join(f"{r['pose']}: {r['massG']:g} g, tips at {r['tiltDeg']:g} deg" +
                           "".join(f", {p['name']} at {p['tipN']} N" for p in r["pushes"] if p["tipN"] is not None) for r in rows)
        return gate("stability", f"It stands, tilted {self.s.min_tilt_deg:g} deg and pushed", problems, detail or "no pose ran", flags)

    # -- function: rays ---------------------------------------------------------------------------------------------

    def caster(self, ignore):
        """Every part but the ignored ones as one mesh to cast rays at, once per set of ignored ids."""
        key = tuple(sorted(ignore))
        if key not in self._casters:
            import trimesh

            keep = [it for it in self.items if not any(matches(it.id, p) for p in ignore)]
            meshes = [mesh(it) for it in keep]
            owner = np.concatenate([[i] * len(m.faces) for i, m in enumerate(meshes)]) if meshes else np.array([], int)
            whole = trimesh.util.concatenate(meshes)
            self._casters[key] = (trimesh.ray.ray_triangle.RayMeshIntersector(whole), owner, keep)
        return self._casters[key]

    def first_hits(self, origins, dirs, ignore):
        ray, owner, keep = self.caster(ignore)
        tri = ray.intersects_first(np.asarray(origins, float), np.asarray(dirs, float))
        return [None if t < 0 else keep[owner[t]].id for t in tri]

    def first_hits_at(self, origins, dirs, ignore):
        """(id, distance) of the first part each ray meets, or (None, inf)."""
        ray, owner, keep = self.caster(ignore)
        o, d = np.asarray(origins, float), np.asarray(dirs, float)
        tri, idx, loc = ray.intersects_id(o, d, multiple_hits=False, return_locations=True)
        out = [(None, math.inf)] * len(o)
        for t, i, at in zip(tri, idx, loc):
            out[i] = (keep[owner[t]].id, float(np.linalg.norm(at - o[i])))
        return out

    def disc_rays(self, center, normal, radius, n_rays=2000):
        """Rays along `normal` from points spread evenly over the disc. A square grid can line up with a grille's pitch
        and read a quarter more open than it is (Ponder's 3.2 mm grille on a 0.8 mm grid), so the points lie on a
        sunflower (golden-angle) spiral, which has no pitch."""
        n = unit(normal)
        a = unit(np.cross(n, [1, 0, 0] if abs(n[0]) < 0.9 else [0, 1, 0]))
        b = np.cross(n, a)
        k = np.arange(n_rays) + 0.5
        r = radius * np.sqrt(k / n_rays)
        t = k * math.pi * (3 - math.sqrt(5))
        pts = np.array(center, float) + n * 0.05 + np.outer(r * np.cos(t), a) + np.outer(r * np.sin(t), b)
        return pts, np.tile(n, (len(pts), 1))

    def function(self):
        problems, rows, notes, flags, accepted = [], [], [], [], set()
        clear = tuple(it.id for it in self.items if "transparent" in it.tags)  # windows and diffusers light passes

        def report(p, msg):
            """A probe falling short: a problem, or, when the design accepts it with its reason, a flag."""
            if reason(p):
                flags.append(msg.but(f"{msg} (accepted: {reason(p)})"))
                accepted.add(p.id)
            else:
                problems.append(msg)

        for p in self.s.probes:
            if self.only and not (set(self.only) & {p.id, getattr(p, "source", None)}):
                continue
            if isinstance(p, (Sound, Port)):
                o, d = self.disc_rays(p.center, p.normal, p.radius)
                hits = self.first_hits(o, d, (p.source,))
                share = sum(h is None for h in hits) / len(hits)
                blockers = sorted({h for h in hits if h})
                aim = getattr(p, "aim_open", None)
                rows.append({"id": p.id, "kind": type(p).__name__.lower(), "openShare": round(share, 3), "need": p.min_open,
                             **({"aim": aim} if aim is not None else {})})
                if share < p.min_open:
                    report(p, Problem(f"{p.id}: {share:.0%} of it sees out, under {p.min_open:.0%}" + (f" (blocked by {', '.join(blockers)})" if blockers else ""),
                                      [p.source, *blockers], p.center))
                elif aim is not None and share < aim:
                    notes.append(f"{p.id}: {share:.0%} of it sees out, under the {aim:.0%} the design aims for")
            elif isinstance(p, View):
                ax, up = unit(p.axis), unit(p.up)
                right = unit(np.cross(ax, up))
                up = np.cross(right, ax)
                dirs = []
                # Even over the image, not in angle: a flat (rectilinear) lens gives the edges of the view more pixels.
                th, tv = math.tan(math.radians(p.hfov_deg / 2)), math.tan(math.radians(p.vfov_deg / 2))
                for i in np.linspace(-1, 1, 41):
                    for j in np.linspace(-1, 1, 31):
                        dirs.append(unit(ax + right * th * i + up * tv * j))
                o = np.tile(np.array(p.origin, float), (len(dirs), 1))
                hits = self.first_hits(o, dirs, tuple(p.ignore))
                blocked = [h for h in hits if h]
                row = {"id": p.id, "kind": "view", "blockedShare": round(len(blocked) / len(hits), 4),
                       "inImage": sorted(set(blocked))}
                if p.target is None:
                    if blocked:
                        report(p, Problem(f"{p.id}: the product fills {len(blocked) / len(hits):.1%} of the image ({', '.join(sorted(set(blocked)))})",
                                          sorted(set(blocked)), p.origin))
                else:
                    # Every point of the target's upper surface (a grid dropped onto it from above): in the frame, and
                    # nothing of the product before it.
                    import trimesh

                    tgt = Item(p.id, p.target)
                    x0, y0, _, x1, y1, z1 = bbox(tgt)
                    e = 1e-3 * max(x1 - x0, y1 - y0)
                    grid = np.array([(x, y, z1 + 1.0) for x in np.linspace(x0 + e, x1 - e, 25) for y in np.linspace(y0 + e, y1 - e, 25)])
                    pts, _, _ = trimesh.ray.ray_triangle.RayMeshIntersector(mesh(tgt)).intersects_location(
                        grid, np.tile([0.0, 0.0, -1.0], (len(grid), 1)), multiple_hits=False)
                    if not len(pts):  # a probe that can't look is no risk the design can accept
                        problems.append(Problem(f"{p.id}: its target has no upper surface to see", (), p.origin))
                        rows.append(row)
                        continue
                    org = np.array(p.origin, float)
                    vec = pts - org
                    dist = np.linalg.norm(vec, axis=1)
                    dirs_t = vec / dist[:, None]
                    depth = dirs_t @ ax
                    with np.errstate(divide="ignore", invalid="ignore"):
                        outside = (depth <= 0) | (np.abs(dirs_t @ right / depth) > th + 1e-9) | (np.abs(dirs_t @ up / depth) > tv + 1e-9)
                    seen = self.first_hits_at(np.tile(org, (len(pts), 1)), dirs_t, tuple(p.ignore))
                    hidden = [h for (h, d), far, out in zip(seen, dist, outside) if not out and h and d < far - 0.5]
                    row.update({"targetOutside": round(float(outside.mean()), 4), "targetHidden": round(len(hidden) / len(pts), 4)})
                    if outside.any():
                        report(p, Problem(f"{p.id}: {outside.mean():.1%} of its target is outside the image", (), p.origin))
                    if hidden:
                        report(p, Problem(f"{p.id}: {len(hidden) / len(pts):.1%} of its target is hidden ({', '.join(sorted(set(hidden)))})",
                                          sorted(set(hidden)), p.origin))
                rows.append(row)
            elif isinstance(p, Light):
                ax = unit(p.axis)
                a = unit(np.cross(ax, [1, 0, 0] if abs(ax[0]) < 0.9 else [0, 1, 0]))
                b = np.cross(ax, a)
                # Each ray stands for the same solid angle (cos t even over the cap, on a golden-angle spiral): even
                # steps in angle would weight the cone's centre and pass a light that is mostly blocked.
                k = np.arange(400) + 0.5
                ct = 1 - k / 400 * (1 - math.cos(math.radians(p.half_angle_deg)))
                st, f = np.sqrt(1 - ct * ct), k * math.pi * (3 - math.sqrt(5))
                dirs = [unit(ax * c + (a * math.cos(q) + b * math.sin(q)) * sn) for c, sn, q in zip(ct, st, f)]
                o = np.tile(np.array(p.origin, float), (len(dirs), 1)) + np.array(dirs) * 0.05
                hits = self.first_hits(o, dirs, tuple(p.ignore) + (clear if p.target == "out" else ()))
                good = sum((h is None) if p.target == "out" else (h is not None and matches(h, p.target)) for h in hits)
                share = good / len(hits)
                rows.append({"id": p.id, "kind": "light", "share": round(share, 3), "need": p.min_share})
                if share < p.min_share:
                    others = sorted({h for h in hits if h and not (p.target != "out" and matches(h, p.target))})
                    report(p, Problem(f"{p.id}: {share:.0%} of its light reaches {p.target}, under {p.min_share:.0%}" + (f" (blocked by {', '.join(others)})" if others else ""),
                                      others, p.origin))
            elif isinstance(p, Keepout):
                from build123d import Box as _B  # noqa: F401

                region = Item(p.id, p.region)
                close = []  # (distance, id, the point of the part nearest the region) of every metal part nearer than min_mm
                nearest = None
                for it in self.items:
                    if not it.metal or any(matches(it.id, x) for x in p.ignore):
                        continue
                    d, _, at = gap(region, it) if near(region, it, p.min_mm) else (math.inf, None, None)
                    both = common(region, it) if near(region, it, 0) else None
                    if both is not None and both.volume > OVERLAP_MM3:
                        # Inside the region: the distance between surfaces would read its depth instead.
                        d, at = 0.0, inner_point(both)
                    if nearest is None or d < nearest[0]:
                        nearest = (d, it.id)
                    if d < p.min_mm:
                        close.append((d, it.id, at))
                close.sort(key=lambda x: x[:2])
                rows.append({"id": p.id, "kind": "keepout", "nearestMetalMm": None if nearest is None or nearest[0] == math.inf else round(nearest[0], 2),
                             "nearest": nearest[1] if nearest else None, "need": p.min_mm,
                             **({"within": [{"id": i, "mm": round(d, 2)} for d, i, _ in close]} if close else {})})
                for d, i, at in close:
                    report(p, Problem(f"{p.id}: {i} is in the keep-out" if d == 0.0 else f"{p.id}: {i} is {d:.1f} mm away, under {p.min_mm:g} mm",
                                      [i], at))
        self.probes = rows
        passed = [r["id"] for r in rows if r["id"] not in accepted]  # the ones the design accepts are in its flags
        out = gate("function", "Sound gets out, ports and views are clear, light reaches its window, radios keep clear of metal",
                   problems, ((f"{len(passed)} probes pass: {', '.join(passed)}" if passed else "no probe passes but those the design accepts")
                              if rows else "no probes") +
                   "".join(f"; {x}" for x in notes), flags)
        if notes:
            out["notes"] = notes
        return out


class MissingMass(Exception):
    """An item with no mass to weigh: `id` is the item's."""

    def __init__(self, text, id):
        super().__init__(text)
        self.id = id


def gate(gid, title, problems, detail, flags=()):
    """A gate's result. `flags` are problems the design accepts, each with its reason: they don't fail the gate."""
    out = {"id": gid, "title": title, "status": "fail" if problems else "pass",
           "detail": "; ".join(problems[:8]) + (f"; and {len(problems) - 8} more" if len(problems) > 8 else "") if problems else detail,
           "problems": len(problems), "all": list(problems)}
    if flags:
        out["flags"] = list(flags)
        if not problems:
            out["detail"] += f"; {len(flags)} accepted by the design: " + "; ".join(flags[:4]) + ("; ..." if len(flags) > 4 else "")
    return out


GATES = ["placed", "overlap", "contact", "clearance", "inside", "stability", "function"]


def run_all(sysm, items, bom, params, only=None, which=GATES):
    r = Run(sysm, items, bom, params, only)
    out = []
    for g in which:
        try:
            out.append(getattr(r, g)())
        except Exception as e:  # noqa: BLE001  a gate that can't run fails, with why
            out.append({"id": g, "title": g, "status": "fail", "detail": f"Can't run: {e}", "problems": 1, "all": [f"Can't run: {e}"]})
    return out, r


# ---- the self-test: a fault for each gate, which the gate must catch ------------------------------------------------


def faults(sysm, items):
    """(gate, what was done, the items after, the ids it touched, the System after or None, the words a problem it
    causes must name) for each gate the system has something to break."""
    out = []
    lines = {}
    for it in items:
        lines.setdefault(it.line, []).append(it)
    many = max((v for k, v in lines.items() if k and k not in sysm.unplaced), key=len, default=None)
    if many:
        gone = many[-1]
        out.append(("placed", f"left out {gone.id}, one of {len(many)} on line {gone.line}", [i for i in items if i is not gone], None, None,
                    [gone.line]))

    # Overlap and clearance: move a part toward its nearest neighbour that it neither fits nor touches, nor may sit
    # closer to (a Gap, which would flag the move, not fail it), a part meant to be inside the case first, else any.
    need = sysm.min_clearance_mm
    inner = [it for r in sysm.inside for it in items if matches(it.id, r.items)]
    pick = None
    for it in inner + [i for i in items if i not in inner]:
        best = None
        for o in items:
            if (o is it or pair_in(sysm.fits, it.id, o.id) or pair_in(sysm.contacts, it.id, o.id) or pair_in(sysm.gaps, it.id, o.id)
                    or not near(it, o, 20)):
                continue
            d, pa, pb = gap(it, o)
            if d > need and (best is None or d < best[0]):
                best = (d, pa, pb, o)
        if best:
            pick = (it, best)
            break
    if pick:
        it, (d, pa, pb, o) = pick
        v = (np.array(pb) - np.array(pa)) / d
        into = moved(it, *(v * (d + 0.5)))
        out.append(("overlap", f"moved {it.id} {d + 0.5:.2f} mm toward {o.id}", [into if i is it else i for i in items], [it.id], None,
                    [it.id, o.id]))
        left = max(need - 0.05, need / 2)  # just under the gap
        close = moved(it, *(v * (d - left)))
        out.append(("clearance", f"moved {it.id} to {left:g} mm from {o.id}", [close if i is it else i for i in items], [it.id], None,
                    [it.id, o.id]))

    # Overlap, a fit's side: a fitted part lifted out of its fit (an insert out of its boss) to 2 mm above the whole
    # product, where it meets nothing.
    top = max(bbox(i)[5] for i in items)
    for r in sysm.fits:
        it = next((i for i in items if matches(i.id, r.a)), None)
        if it is not None:
            dz = top - bbox(it)[2] + 2.0
            out.append(("overlap", f"lifted {it.id} {dz:.1f} mm, out of its fit with {r.b}", [moved(it, 0, 0, dz) if i is it else i for i in items],
                        [it.id], None, [it.id, "meant to fit"]))
            break

    # Inside: a part meant to be inside, lifted until it sits 2 mm above the case.
    for r in sysm.inside:
        it = next((i for i in items if matches(i.id, r.items)), None)
        case = [i for i in items if any(matches(i.id, w) for w in r.within)]
        if it and case:
            dz = max(bbox(c)[5] for c in case) - bbox(it)[2] + 2.0
            up = moved(it, 0, 0, dz)
            out.append(("inside", f"lifted {it.id} {dz:.1f} mm, 2 mm clear of the case", [up if i is it else i for i in items], [it.id], None,
                        [it.id]))
            break

    # Contact: lift a part 0.5 mm off its partners, in whichever of the six directions parts it from all of them.
    six = ((0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))
    free = lambda x, others: all(not near(x, o, TOUCH_MM) or (gap(x, o)[0] > TOUCH_MM and shared(x, o) <= OVERLAP_MM3) for o in others)  # noqa: E731
    done = False
    for r in sysm.contacts:
        for a in (i for i in items if matches(i.id, r.a)):
            partners = [o for o in items if o is not a and matches(o.id, r.b)]
            for dv in six:
                lifted = moved(a, *(np.array(dv, float) * 0.5))
                if partners and free(lifted, partners):
                    out.append(("contact", f"moved {a.id} 0.5 mm off {r.b}", [lifted if i is a else i for i in items], [a.id], None,
                                [a.id, "should touch"]))
                    done = True
                    break
            break  # the first part of each contact only
        if done:
            break

    # Clearance beside a contact: a part slid along its partner, still touching it, until another of their faces is
    # half the gap from the other part: under the gap those faces keep. A pair already short of it would prove
    # nothing, so it is passed over.
    done = False
    for r in sysm.contacts:
        g = need if r.gap is None else r.gap
        if g <= 2 * TOUCH_MM:
            continue
        for a in (i for i in items if matches(i.id, r.a)):
            b = next((o for o in items if o is not a and matches(o.id, r.b) and near(a, o, TOUCH_MM) and gap(a, o)[0] <= TOUCH_MM), None)
            if b is None or contact_gap(a, b, g) is not None:
                continue
            for dv in _slides(a, b, g):
                off = moved(a, *dv)
                if gap(off, b)[0] <= TOUCH_MM and shared(off, b) <= OVERLAP_MM3 and contact_gap(off, b, g) is not None:
                    out.append(("clearance", f"slid {a.id} {np.linalg.norm(dv):.2f} mm along {b.id}, to {g / 2:g} mm beside a contact",
                                [off if i is a else i for i in items], [a.id], None, [a.id, b.id, "beside where they touch"]))
                    done = True
                    break
            if done:
                break
        if done:
            break

    # Clearance under a Gap: a part the design lets sit closer to another moved to just under the gap it accepts, where
    # it fails again. A Gap down to touching has nothing under it but an overlap, which the overlap gate's fault covers.
    done = False
    for r in accepted_gaps(sysm):
        left = max(r.mm - 0.05, r.mm / 2)
        for a in (i for i in items if matches(i.id, r.a)):
            for (d, pa, pb), b in sorted(((gap(a, o), o) for o in items if o is not a and matches(o.id, r.b) and near(a, o, 20)),
                                         key=lambda x: x[0][0]):
                if d <= left:
                    continue
                off = moved(a, *((np.array(pb) - np.array(pa)) / d * (d - left)))
                if TOUCH_MM < gap(off, b)[0] < r.mm - 1e-6 and shared(off, b) <= OVERLAP_MM3:
                    out.append(("clearance", f"moved {a.id} to {left:g} mm from {b.id}, under the {r.mm:g} mm of a gap the design accepts",
                                [off if i is a else i for i in items], [a.id], None, [a.id, b.id]))
                    done = True
                    break
            if done:
                break
        if done:
            break

    # Stability, each way it can fail: the centre of mass past the feet, a tilt under the minimum, and a push.
    xs = [bbox(i) for i in items]
    lo = (min(b[0] for b in xs), min(b[1] for b in xs))
    hi = (max(b[3] for b in xs), max(b[4] for b in xs))
    span = max(hi[0] - lo[0], hi[1] - lo[1])
    top = max(b[5] for b in xs)
    cx = hi[0] + span
    heavy = Item("fault-weight", box(cx, cx + 10, -5, 5, top, top + 10), line=None, mass_g=10000.0, mass_note="planted")
    out.append(("stability", "put 10 kg one product-width beyond the feet", items + [heavy], ["fault-weight"], None, []))
    feet = [bbox(i) for i in items if "foot" in i.tags] or xs
    fx = sum((b[0] + b[3]) / 2 for b in feet) / len(feet)
    fy = sum((b[1] + b[4]) / 2 for b in feet) / len(feet)
    h = top + span / math.tan(math.radians(max(sysm.min_tilt_deg, 1) / 2))  # high enough to tip at under half the minimum
    tall = Item("fault-mast", box(fx - 5, fx + 5, fy - 5, fy + 5, h, h + 10), line=None, mass_g=10000.0, mass_note="planted")
    out.append(("stability", f"put 10 kg over the feet, {h:.0f} mm up", items + [tall], ["fault-mast"], None, []))
    shove = Push("a planted 1000 N shove", ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, top), (1000.0, 0, 0))
    poses = [replace(q, pushes=list(q.pushes) + [shove]) for q in (sysm.poses or [Pose("as built")])]
    out.append(("stability", "pushed it sideways at the top with 1000 N", items, None, replace(sysm, poses=poses), []))

    for p in sysm.probes:
        if isinstance(p, (Sound, Port)):
            n = unit(p.normal)
            c = np.array(p.center) + n * (2.0 if isinstance(p, Sound) else 0.6)
            lid = Item("fault-lid-" + p.id, Pos(*c) * _towards(Cylinder(p.radius * 1.3, 0.4), n), line=None)
            out.append(("function", f"closed {p.id} with a disc", items + [lid], [lid.id, p.id], None, [p.id]))
        elif isinstance(p, View):
            ax = unit(p.axis)
            c = np.array(p.origin) + ax * 10
            plate = Item("fault-plate-" + p.id, Pos(*c) * _towards(Box(20, 20, 0.5), ax), line=None)
            out.append(("function", f"put a plate 10 mm in front of {p.id}", items + [plate], [plate.id, p.id], None, [p.id]))
        elif isinstance(p, Light):
            ax = unit(p.axis)
            c = np.array(p.origin) + ax * 0.3
            plate = Item("fault-plate-" + p.id, Pos(*c) * _towards(Box(30, 30, 0.2), ax), line=None)
            out.append(("function", f"put a plate in front of {p.id}", items + [plate], [plate.id, p.id], None, [p.id]))
        elif isinstance(p, Keepout):
            c = p.region.center(CenterOf.BOUNDING_BOX)
            nut = Item("fault-metal-" + p.id, Pos(c.X, c.Y, c.Z) * Box(2, 2, 2), line=None, material="steel")
            out.append(("function", f"put a steel block on {p.id}", items + [nut], [nut.id, p.id], None, [p.id]))
    return out


def accepted_gaps(sysm):
    """The Gaps the design accepts, with a reason, down to more than touching: each needs a fault under it."""
    return [r for r in sysm.gaps if reason(r) and isinstance(r.mm, (int, float)) and r.mm > 2 * TOUCH_MM]


def _slides(a, b, g, reach=25.0):
    """Moves of a that bring a face of one of a and b, facing the other from under `reach`, to g/2 from it: nearest
    first."""
    out = []
    for x, y, sign in ((a, b, 1.0), (b, a, -1.0)):
        for f in x.shape.faces():
            d, p, q = f.distance_to_with_closest_points(y.shape)
            if not (TOUCH_MM < d < reach) or f.normal_at(p).dot(q - p) <= 0.5 * d:
                continue
            v = np.array([q.X - p.X, q.Y - p.Y, q.Z - p.Z]) / d
            out.append((d, tuple(sign * v * (d - g / 2))))
    return [m for _, m in sorted(out)][:12]


def _towards(shape, n):
    """Turn a shape built along +z so that its z axis points along n."""
    n = unit(n)
    z = np.array([0, 0, 1.0])
    axis = np.cross(z, n)
    s = np.linalg.norm(axis)
    if s < 1e-9:
        return shape if n[2] > 0 else Rot(180, 0, 0) * shape
    from build123d import Axis, Location

    ang = math.degrees(math.atan2(s, float(np.dot(z, n))))
    return shape.rotate(Axis((0, 0, 0), tuple(axis / s)), ang)


NUMBER = re.compile(r"(?<![\w.-])-?\d+(?:\.\d+)?(?!\w)")  # 4.79, -0.05, 28 (in 28%); not the 9 of sw9 or the 4 of scr25-4


def _shape_of(problem):
    """A problem with its numbers taken out, so the same problem with a number moved a little is the same problem."""
    return NUMBER.sub("#", problem)


def names(problem, word):
    """Whether a problem names `word` (a part's id, or a phrase) as a whole: sw1 is not in sw10 or fault-sw1."""
    return re.search(rf"(?<![\w-]){re.escape(word)}(?![\w-])", problem) is not None


def self_test(sysm, items, bom, params):
    """Each fault is caught only if its gate finds a problem the product without the fault doesn't have (numbers
    aside), naming the parts the fault moved: a gate that already fails would otherwise "catch" any fault at all, even
    a 1 g cube 5 m away, and a part moved into its neighbour must be caught there, not where it left a gap."""
    rows = []
    base = {}
    # A probe the design accepts falling short would flag the fault put in it as it flags its own shortfall, and catch
    # nothing: the probes' faults are judged with every probe's reason set aside, on the product with and without them.
    strict = replace(sysm, probes=[replace(p, accept="") for p in sysm.probes])
    for g, what, broken, only, changed, expect in faults(sysm, items):
        frame = strict if g == "function" else sysm
        key = (g, tuple(only or ()))
        if key not in base:
            ref, _ = run_all(frame, items, bom, params, only=only, which=[g])
            base[key] = {_shape_of(x) for x in ref[0].get("all", [])}
        res, _ = run_all(changed or frame, broken, bom, params, only=only, which=[g])
        new = [x for x in res[0].get("all", []) if _shape_of(x) not in base[key] and all(names(x, w) for w in expect)]
        caught = res[0]["status"] == "fail" and not res[0]["detail"].startswith("Can't run") and bool(new)
        detail = "; ".join(new[:3]) if new else (res[0]["detail"] if res[0]["status"] == "pass" else
                                                  "the gate fails without the fault too, the same way, so this fault proves nothing")
        rows.append({"gate": g, "fault": what, "caught": caught, "detail": detail})
    # A gate with something to break and no fault for it has not been tested: inside needs an Inside, contact a Contact.
    wanted = ["overlap", "clearance", "stability"] + (["inside"] if sysm.inside else []) + (["contact"] if sysm.contacts else [])
    missing = [g for g in wanted if not any(r["gate"] == g for r in rows)]
    # The fits' side of overlap, and clearance beside a contact, each need a fault of their own when the system has them.
    if sysm.fits and not any(r["gate"] == "overlap" and "out of its fit" in r["fault"] for r in rows):
        missing.append("overlap, for a fit")
    gapped = [r for r in sysm.contacts if (sysm.min_clearance_mm if r.gap is None else r.gap) > 2 * TOUCH_MM]
    if gapped and not any(r["gate"] == "clearance" and "beside a contact" in r["fault"] for r in rows):
        missing.append("clearance, beside a contact (every pair is already short of its gap)")
    if accepted_gaps(sysm) and not any(r["gate"] == "clearance" and "a gap the design accepts" in r["fault"] for r in rows):
        missing.append("clearance, under a gap the design accepts (each pair it names is under it already, or none is within 20 mm)")
    return {"ok": bool(rows) and all(r["caught"] for r in rows) and not missing, "faults": rows,
            "untested": missing}


# ---- main ---------------------------------------------------------------------------------------------------------


SKIP_DIRS = {"__pycache__", "node_modules"}


def skipped(rel: pathlib.PurePath) -> bool:
    """Files no result depends on: caches, and an editor's dotfiles and backups (.case.py.swp, case.py~)."""
    return bool(SKIP_DIRS & set(rel.parts)) or any(p.startswith(".") for p in rel.parts) or rel.name.endswith(("~", ".swp"))


# design.json and bom.json as sprue records them, by the key each goes by and the variable it passes the digest in.
PASSED = {"design.json": ("design.json params", "SPRUE_DESIGN_DIGEST"), "bom.json": ("bom.json for one unit", "SPRUE_BOM_DIGEST")}
CHANGED = "changed while the check ran"  # a file's input then, which no file's digest matches


def digest(product: pathlib.Path, extra=()):
    """sha256 of every file the result depends on, by its path in the product: every file under cad/ (but caches and
    an editor's dotfiles and backups), design.json, bom.json and pcb/*-gerbers.zip, plus `extra`, the files in the
    product the run read; and this checker as sprue:cad/system.py."""
    cad = product / "cad"
    files = sorted(f for f in cad.rglob("*") if f.is_file() and not skipped(f.relative_to(cad))) if cad.exists() else []
    files += [product / "design.json", product / "bom.json"]
    files += sorted((product / "pcb").glob("*-gerbers.zip")) if (product / "pcb").exists() else []
    files += [product / e for e in extra]
    out = {f.relative_to(product).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest() for f in files if f.is_file()}
    out["sprue:cad/system.py"] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    return out


def recorded(hashes, moved=()):
    """The inputs as system.json records them, which `sprue score` compares to tell a stale system.json (score.ts
    systemInputs does the same): design.json and bom.json as the digests sprue passed in for them, of design.json's
    params and of bom.json for one unit (score.ts designParams, bomForOneUnit: what nothing here reads left out, a
    pick's pins among it). Run by hand, their own hashes stand, which sprue reads as stale, and runs the check again. A
    file in `moved` changed while the check ran: it goes in as CHANGED, which reads as stale too, where its digest from
    before could still match the file (a pin added) and stand for the run that failed on it."""
    out = {**hashes, **{k: CHANGED for k in moved}}
    for f, (key, var) in PASSED.items():
        if os.environ.get(var) and f in out:
            out[key] = CHANGED if out.pop(f) == CHANGED else os.environ[var]
    return out


class Reads:
    """The files in the product this process reads from now on (a STEP model, a data file, a board zip by any name),
    each with its sha256 when it was first opened, so the result records what was read, not what was there after.
    Python's opens are seen by an audit hook; build123d's importers read in OpenCascade's C++, which Python doesn't see,
    so they are wrapped to note their path first."""

    IMPORTERS = ("import_step", "import_stl", "import_brep", "import_dxf", "import_svg", "import_svg_as_buildline_code",
                 "import_svg_document")

    def __init__(self, product: pathlib.Path):
        self.product, self.seen, self._busy = product, {}, False
        sys.addaudithook(self._hook)
        import build123d

        mods = [build123d] + [m for m in (getattr(build123d, "importers", None),) if m is not None]
        for name in self.IMPORTERS:
            for m in mods:
                f = getattr(m, name, None)
                if callable(f) and not getattr(f, "_sprue_reads", False):
                    setattr(m, name, self._wrap(f))
        mesher = getattr(build123d, "Mesher", None)
        if mesher is not None and hasattr(mesher, "read") and not getattr(mesher.read, "_sprue_reads", False):
            mesher.read = self._wrap(mesher.read, arg=1)

    def _wrap(self, f, arg=0):
        def wrapped(*a, **k):
            path = a[arg] if len(a) > arg else next((v for key, v in k.items() if "file" in key or key == "path"), None)
            self.note(path)
            return f(*a, **k)

        wrapped._sprue_reads = True
        wrapped.__wrapped__ = f
        return wrapped

    def note(self, path_like):
        if not isinstance(path_like, (str, bytes, pathlib.PurePath)):
            return
        try:
            path = pathlib.Path(path_like.decode() if isinstance(path_like, bytes) else path_like).resolve()
            rel = path.relative_to(self.product)
        except (ValueError, OSError):
            return
        key = rel.as_posix()
        if not rel.parts or skipped(rel) or rel.parts[0] == "previews" or key == "system.json" or key in self.seen:
            return
        if not path.is_file():
            return
        self._busy = True  # hashing opens the file too
        try:
            self.seen[key] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            pass
        finally:
            self._busy = False

    def _hook(self, event, args):
        if self._busy or event != "open" or not args:
            return
        mode = args[1] if len(args) > 1 else "r"
        if isinstance(mode, str) and any(c in mode for c in "wax+"):
            return
        self.note(args[0])

    def modules(self):
        """The modules imported from the product, whose source a warm .pyc lets Python load without opening it."""
        for m in list(sys.modules.values()):
            f = getattr(m, "__file__", None)
            if f:
                self.note(f)


def written(g):
    """A gate as system.json writes it. A failing gate's problems in full as `list` (its detail has the first 8), for
    sprue faults to tell them apart, and beside them `where`, each one's {parts, at} for the 3D view; `flagsWhere` the
    same for its flags."""
    out = {k: v for k, v in g.items() if k != "all"}
    if g["status"] == "fail":
        out["list"] = g.get("all", [g["detail"]])[:200]
        out["where"] = [where(x) for x in out["list"]]
    if g.get("flags"):
        out["flagsWhere"] = [where(x) for x in g["flags"]]
    return out


def _point_masses(pose, pid):
    return [p for p in pose.items if isinstance(p, PointMass) and p.id == pid]


def _weighed(pose, pid, whose):
    """The mass of a pose's PointMasses of an id, added up as the stability gate adds them, and their notes: (None,
    None) when it has none, and (None, why) when one has no number, which that gate can't weigh either."""
    ps = _point_masses(pose, pid)
    if not ps:
        return None, None
    try:
        return sum(float(p.mass_g) for p in ps), "; ".join(dict.fromkeys(p.note or "point mass" for p in ps))
    except (TypeError, ValueError) as e:  # the stability gate says it couldn't weigh it (Can't run)
        return None, f"{whose} PointMass {pid} has no mass: {e}"


def _drawn_row(d, m, note):
    """A part drawn along a path as system.json lists it, with the mass and note it is weighed at."""
    try:
        box_ = [round(v, 3) for v in bbox(d)]
    except Exception:  # noqa: BLE001  the model draws what it can of it
        box_ = None
    return {"id": d.id, "line": d.line, "model": "path", "material": None, "tags": [],
            "massG": None if m is None else round(m, 2), "massNote": note,
            "estimated": m is not None and "estimate" in note.lower(), "bbox": box_, "why": d.why}


def _matrix(loc):
    """A build123d Location as a 4x4 matrix, row by row, in mm."""
    t = loc.wrapped.Transformation()
    return [[round(t.Value(i, j), 9) + 0.0 for j in range(1, 5)] for i in range(1, 4)] + [[0.0, 0.0, 0.0, 1.0]]


def pose_frames(sysm, scenes):
    """Each pose as the 3D model draws it, for the view's pose switch, in the stability gate's order: its name; the
    items its `drop` takes out; the matrix it draws them moved by (4x4, row by row, mm in the frame; null: not drawn
    in this pose); each part it draws along its path in place of the frame's of that id, as `items` lists a drawn
    part, weighed in this pose; and the scene of previews/system.glb that holds those (`scenes`, by pose; null for
    none)."""
    out = []
    for pose, scene in zip(sysm.poses, scenes):
        drawn = []
        for d in pose.drawn:
            m, note = _weighed(pose, d.id, f"{pose.name}:")
            drawn.append(_drawn_row(d, m, note or f"not weighed: {pose.name} has no PointMass named {d.id}, so the "
                                                  "stability gate leaves it out of this pose"))
        out.append({"name": pose.name, "drop": [it.id for it in sysm.items if any(matches(it.id, x) for x in pose.drop)],
                    "moved": _matrix(pose.moved) if isinstance(pose.moved, Location) else None,  # placed names any other
                    "drawn": drawn, "scene": scene})
    return out


def frame(sysm, r, gates):
    """The parts in the frame and what the design says of them, for the 3D view: each item's BOM line, model,
    material, tags, mass (as the stability gate weighs it) and bounding box in mm, then each part drawn along a path
    (model "path", its mass the first pose's PointMasses of its id, and `why`); and each fit, contact, gap and inside
    with the items that meet it: a fit's pairs that share volume, a contact's that touch and a gap's closer than the
    minimum, as the overlap, contact and clearance gates found them (None where that gate couldn't run, so found only
    some), and an inside's parts and case, the items its patterns match. sysm None: no System, so none of them."""
    if sysm is None:
        return [], {"fits": [], "contacts": [], "gaps": [], "inside": [], "unplaced": {}}
    items = []
    for it in sysm.items:
        try:
            m, note, _ = r.mass(it)
        except Exception as e:  # noqa: BLE001  the stability gate says why it couldn't weigh it (Can't run)
            m, note = None, str(e)
        try:
            box_ = [round(v, 3) for v in bbox(it)]
        except Exception:  # noqa: BLE001  a shape with no box: the gates that needed one said so
            box_ = None
        items.append({"id": it.id, "line": it.line, "model": it.model, "material": it.material, "tags": list(it.tags),
                      "massG": None if m is None else round(m, 2), "massNote": note,
                      "estimated": m is not None and "estimate" in note.lower(), "bbox": box_})
    # A drawn part weighs what the stability gate weighs for it in the pose the 3D view draws, the first: the
    # PointMasses of its id there, added up as that gate adds them. Without one, its note says which poses weigh it.
    for d in sysm.drawn:
        m, note = _weighed(sysm.poses[0], d.id, "the first pose's") if sysm.poses else (None, None)
        if note is None:
            later = [q.name for q in sysm.poses[1:] if _point_masses(q, d.id)]
            note = (f"not weighed in the first pose, the one the model draws: it has no PointMass named {d.id}, as "
                    f"{', '.join(later)} {'has' if len(later) == 1 else 'have'}" if later else
                    f"not weighed: {'no pose has a' if sysm.poses else 'the pose as built has no'} PointMass named {d.id}, "
                    f"so the stability gate leaves it out")
        items.append(_drawn_row(d, m, note))
    ran = {g["id"] for g in gates if not str(g.get("detail", "")).startswith("Can't run")}
    pairs = lambda x, gid: [list(p) for p in r.met.get(id(x), {})] if gid in ran else None  # noqa: E731
    ids = lambda pats: [it.id for it in sysm.items if any(matches(it.id, p) for p in pats)]  # noqa: E731
    return items, {
        "fits": [{"a": x.a, "b": x.b, "why": x.why, "pairs": pairs(x, "overlap")} for x in sysm.fits],
        "contacts": [{"a": x.a, "b": x.b, "why": x.why, "gap": x.gap, "pairs": pairs(x, "contact")} for x in sysm.contacts],
        "gaps": [{"a": x.a, "b": x.b, "mm": x.mm, "accept": x.accept, "pairs": pairs(x, "clearance")} for x in sysm.gaps],
        "inside": [{"items": x.items, "within": list(x.within), "why": x.why, "parts": ids([x.items]), "case": ids(x.within)}
                   for x in sysm.inside],
        "unplaced": dict(sysm.unplaced),
    }


# ---- the 3D model: previews/system.glb ----------------------------------------------------------------------------
# Every placed item as one node named by its id, in one GLB the 3D view draws: each item's own shape meshed, a board
# read from its zip meshed coarser and wearing a picture of its two faces drawn from that zip, which carries its pads,
# tracks and silkscreen. No normals, to keep it small: each face of a shape has vertices of its own, so a viewer that
# makes smooth normals (three.js computeVertexNormals, with the flat shading GLTFLoader sets on a mesh without normals
# turned off) shades each face smooth and leaves each edge between faces sharp; one that doesn't draws it flat.
# Written from the same run as system.json, with the digest of the inputs system.json records, so a model of an
# earlier design can be told apart.

# mm and radians: the deflection OpenCascade meshes each item's faces to (its facets within about 0.1 mm of the
# surface, a sphere's within 0.25 mm), and the most its facets turn between them.
MODEL_MESH = (0.1, 0.5)
BOARD_MESH = (0.2, 0.8)  # a board's, coarser: its drills come out about 8-sided, and its picture draws each round
BOARD_PX_PER_MM, BOARD_MAX_PX, BOARD_GAP_PX = 10, 2048, 8  # the picture's pixels a mm, at most this wide or high
# The picture's colours, a green-mask board with gold pads: the look of a board, not the fab's options for it.
BOARD_RGB = {"mask": (29, 90, 54), "copper": (45, 122, 74), "laminate": (201, 183, 122), "pad": (214, 178, 94),
             "silk": (238, 238, 230), "hole": (13, 15, 14)}
BOARD_LAYERS = {".gtl": ("top", "copper"), ".gbl": ("bottom", "copper"), ".gts": ("top", "mask"),
                ".gbs": ("bottom", "mask"), ".gto": ("top", "silk"), ".gbo": ("bottom", "silk")}
# glTF is in metres with y up, the frame in mm with z up: the root node turns one into the other (column-major).
TO_GLTF = [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1]
BOARDS = []  # (solid, zip, vertices) of each board board_from_gerbers read, as it read it, to know an item as one


def inputs_digest(inputs):
    """The sha256 of system.json's `inputs`, as JSON with its keys in order and no spaces."""
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _tessellate(shape, tolerance):
    """A shape's triangles in the frame, meshed afresh (a copy, so the mesh the gates made of it doesn't stand in):
    vertices (n x 3) and faces (m x 3), each face of the shape with vertices of its own, one at each point."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRepTools import BRepTools
    from OCP.TopAbs import TopAbs_Orientation
    from OCP.TopLoc import TopLoc_Location
    from scipy.spatial import cKDTree

    s = copy.deepcopy(shape)
    BRepTools.Clean_s(s.wrapped)
    # In mm, and read as meshed: build123d's tessellate() asks for a share of each edge's length, which leaves a big
    # round part's facets mm from its surface, and meshes again a face OpenCascade says it meshed a little coarser.
    BRepMesh_IncrementalMesh(s.wrapped, tolerance[0], False, tolerance[1], True)
    verts, faces = [], []
    for face in s.faces():
        loc = TopLoc_Location()
        poly = BRep_Tool.Triangulation_s(face.wrapped, loc)
        if poly is None:
            continue
        t = loc.Transformation()
        nodes = (poly.Node(i).Transformed(t) for i in range(1, poly.NbNodes() + 1))
        pts = np.array([(q.X(), q.Y(), q.Z()) for q in nodes], float).reshape(-1, 3)
        # A round face's seam and a sphere's pole are meshed as nodes of their own at one point: made one vertex, so a
        # viewer's smooth normals don't crease the face there (never one across faces, whose edges stay sharp).
        twin = np.array([min(near) for near in cKDTree(pts).query_ball_point(pts, 1e-6)], np.int64).reshape(-1)
        keep = np.unique(twin)
        index = np.searchsorted(keep, twin) + len(verts)
        verts += [tuple(q) for q in pts[keep]]
        flip = face.wrapped.Orientation() == TopAbs_Orientation.TopAbs_REVERSED
        for tri in poly.Triangles():
            a, b, c = (int(index[tri.Value(k) - 1]) for k in (1, 2, 3))
            if a != b and b != c and a != c:  # one at a pole has no area left
                faces.append((a, c, b) if flip else (a, b, c))
    return np.array(verts, float).reshape(-1, 3), np.array(faces, np.int64).reshape(-1, 3)


def _normals(v, f):
    """Each vertex's normal, the area-weighted mean of its triangles': smooth across a face, since only a face's own
    triangles share its vertices."""
    tri = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], tri)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    return np.where(length > 1e-12, n / np.maximum(length, 1e-12), [0.0, 0.0, 1.0])


def _primitive(p):
    """A gerbonara primitive in mm as a shapely polygon, as readback.py's shape() makes it (which can't be imported
    here: it checks its own pins as it loads)."""
    from gerbonara import graphic_primitives as gp
    from gerbonara.utils import approximate_arc
    from shapely import affinity
    from shapely.geometry import LineString, Point, Polygon
    from shapely.geometry import box as rect

    if isinstance(p, gp.Circle):
        return Point(p.x, p.y).buffer(p.r, quad_segs=8)
    if isinstance(p, gp.Rectangle):
        r = rect(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2)
        return affinity.rotate(r, p.rotation, origin=(p.x, p.y), use_radians=True) if p.rotation else r
    if isinstance(p, gp.Line):
        if math.isclose(p.x1, p.x2, abs_tol=1e-9) and math.isclose(p.y1, p.y2, abs_tol=1e-9):
            return Point(p.x1, p.y1).buffer(p.width / 2, quad_segs=8)
        return LineString([(p.x1, p.y1), (p.x2, p.y2)]).buffer(p.width / 2, quad_segs=8)
    if isinstance(p, gp.Arc):
        pts = list(approximate_arc(p.cx, p.cy, p.x1, p.y1, p.x2, p.y2, p.clockwise, max_error=0.01))
        return LineString(pts).buffer(p.width / 2, quad_segs=8)
    if isinstance(p, gp.ArcPoly):
        q = p.approximate_arcs(max_error=0.01) if p.arc_centers else p
        return Polygon(q.outline).buffer(0) if len(q.outline) >= 3 else Polygon()
    raise TypeError(f"no shape for a {type(p).__name__}")


def _paint(objects):
    """Gerber or Excellon objects in mm as shapely geometry, painted in file order: dark ones added, clear ones taken
    out of what is painted before them."""
    from gerbonara.utils import MM
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    geom, run, dark = Polygon(), [], True
    for obj in objects:
        for p in obj.to_primitives(unit=MM):
            if p.polarity_dark != dark and run:
                geom = geom.union(unary_union(run)) if dark else geom.difference(unary_union(run))
                run = []
            dark = p.polarity_dark
            run.append(_primitive(p))
    if run:
        geom = geom.union(unary_union(run)) if dark else geom.difference(unary_union(run))
    return geom


def board_picture(zip_path, x0, y0, x1, y1):
    """The board's two faces drawn from its zip over x0..x1, y0..y1 (mm, the zip's frame): the top's left of the
    bottom's, both as seen from above, so each face takes its colour by x and y alike, and under them a band in the
    laminate's colour for its edges. On each face the mask, copper under it lighter, bare laminate where the mask is
    open, pads where it is open over copper, the silkscreen but on pads, and the drills. A PIL image, and the width and
    height of a face in its pixels."""
    import warnings
    import zipfile

    from gerbonara import ExcellonFile, GerberFile
    from PIL import Image, ImageDraw
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    zf = zipfile.ZipFile(zip_path)
    layers, holes = {}, []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # gerbonara warns about statement order our own writer is free to use
        for name in sorted(zf.namelist()):
            kind = BOARD_LAYERS.get(pathlib.PurePath(name).suffix.lower())
            if kind:
                layers[kind] = _paint(GerberFile.from_string(zf.read(name).decode()).objects)
            elif name.lower().endswith(".drl"):
                holes.append(_paint(ExcellonFile.from_string(zf.read(name).decode()).objects))
    drills = unary_union(holes) if holes else Polygon()
    ppm = min(BOARD_PX_PER_MM, BOARD_MAX_PX / max(x1 - x0, y1 - y0))
    w, h = max(1, round((x1 - x0) * ppm)), max(1, round((y1 - y0) * ppm))
    ss = 2  # drawn at twice the size and shrunk, so its edges are smooth
    img = Image.new("RGB", ((2 * w + BOARD_GAP_PX) * ss, (h + BOARD_GAP_PX) * ss), BOARD_RGB["laminate"])

    def fill(geom, colour, dx):
        for poly in getattr(geom, "geoms", [geom]):
            if not isinstance(poly, Polygon) or poly.is_empty:
                continue
            px = lambda ring: [(dx + (x - x0) / (x1 - x0) * w * ss, (y1 - y) / (y1 - y0) * h * ss) for x, y in ring.coords]  # noqa: E731
            out = px(poly.exterior)
            left, top = max(0, int(min(x for x, _ in out))), max(0, int(min(y for _, y in out)))
            right, bottom = min(img.width, int(max(x for x, _ in out)) + 2), min(img.height, int(max(y for _, y in out)) + 2)
            if right <= left or bottom <= top:
                continue
            mask = Image.new("L", (right - left, bottom - top), 0)
            draw = ImageDraw.Draw(mask)
            draw.polygon([(x - left, y - top) for x, y in out], fill=255)
            for ring in poly.interiors:
                draw.polygon([(x - left, y - top) for x, y in px(ring)], fill=0)
            img.paste(BOARD_RGB[colour], (left, top, right, bottom), mask)

    for i, side in enumerate(("top", "bottom")):
        dx = i * (w + BOARD_GAP_PX) * ss
        ImageDraw.Draw(img).rectangle((dx, 0, dx + w * ss - 1, h * ss - 1), fill=BOARD_RGB["mask"])
        copper, openings = layers.get((side, "copper"), Polygon()), layers.get((side, "mask"), Polygon())
        fill(copper, "copper", dx)
        fill(openings, "laminate", dx)
        fill(copper.intersection(openings), "pad", dx)
        fill(layers.get((side, "silk"), Polygon()).difference(openings), "silk", dx)
        fill(drills, "hole", dx)
    return img.reduce(ss), w, h


def _points(shape):
    """A shape's vertices (n x 3), in the order OpenCascade walks them."""
    return np.array([[v.X, v.Y, v.Z] for v in shape.vertices()], float).reshape(-1, 3)


def _rigid(a, b):
    """The rotation and translation (3 x 4) that puts each of points a on its own of points b to within 1 µm, or None:
    none does, or only one that turns things inside out, a mirror."""
    if len(a) != len(b) or len(a) < 4:
        return None
    p = np.hstack([a, np.ones((len(a), 1))])
    x = np.linalg.lstsq(p, b, rcond=None)[0]
    r = x[:3].T
    if np.abs(p @ x - b).max() < 1e-3 and np.allclose(r.T @ r, np.eye(3), atol=1e-6) and np.linalg.det(r) > 0:
        return x.T
    return None


def _similar(a, b):
    """Whether a turn or a mirror, one scale in every direction and a translation put each of points a on its own of
    points b to within 1 µm. (Not one scale in some directions: a pad extruded from a board's face is the board made
    thinner, and no board.)"""
    if len(a) != len(b) or len(a) < 4:
        return False
    p = np.hstack([a, np.ones((len(a), 1))])
    x = np.linalg.lstsq(p, b, rcond=None)[0]
    g = x[:3] @ x[:3].T
    s2 = np.trace(g) / 3
    even = s2 > 1e-12 and np.allclose(g, s2 * np.eye(3), atol=1e-6 * max(1, s2))
    return bool(even and np.abs(p @ x - b).max() < 1e-3)


def _board_of(shape):
    """The board a placed item's shape is, or None: its solid as board_from_gerbers read it, its zip, and the rotation
    and translation (3 x 4) from that solid to the shape. The shape is that board when its vertices are the board's,
    in order, each where one rotation and translation puts it: however it was placed (Pos * board, moved, move,
    located, transformed, rotate(transform=True), solid()), but not mirrored, scaled, cut or joined to another shape,
    which the zip's picture is not of. Of boards alike, it is the one whose mark it carries, or else (its solid(), in
    a compound) the one whose faces it keeps."""
    k, points, fits = getattr(shape, "sprue_board", None), None, []
    for i in sorted(range(len(BOARDS)), key=lambda i: i != k):
        solid, zip_path, mine = BOARDS[i]
        if points is None:
            points = _points(shape)
        m = _rigid(mine, points)
        if m is not None:
            if i == k:
                return solid, zip_path, m
            fits.append((solid, zip_path, m))
    if len(fits) > 1:
        faces = [f.wrapped for f in shape.faces()]
        fits.sort(key=lambda b: not any(f.IsPartner(o.wrapped) for o in b[0].faces() for f in faces))
    return fits[0] if fits else None


def _made_from_board(shape):
    """Whether a shape that is no board is made from one: it carries board_from_gerbers' mark (mirrored or scaled by
    its own method), its vertices are a board's mirrored or scaled evenly (by build123d's mirror() or scale()), or it
    keeps one of a board's faces once (cut, or joined to another shape). A part made from a board's face (extruded)
    keeps that face twice, as its base and its end, and is no board."""
    if getattr(shape, "sprue_board", None) is not None:
        return True
    points = _points(shape)
    if any(_similar(mine, points) for *_, mine in BOARDS):
        return True
    faces = [f.wrapped for f in shape.faces()]
    return any(sum(f.IsPartner(o.wrapped) for f in faces) == 1 for solid, *_ in BOARDS for o in solid.faces())


def _board_mesh(solid, zip_path, m):
    """A board item meshed coarse in the zip's frame (the one board_from_gerbers built it in), each vertex with the
    point of the picture over it (its top's, its bottom's or the edge band's, by its normal), then put where the item
    is (m): vertices, faces, the points, and the picture."""
    v, f = _tessellate(solid, BOARD_MESH)
    n = _normals(v, f)
    (x0, y0, _), (x1, y1, _) = v.min(axis=0), v.max(axis=0)
    img, w, h = board_picture(zip_path, x0, y0, x1, y1)
    side = np.where(n[:, 2] > 0.9, 0, np.where(n[:, 2] < -0.9, 1, 2))
    face_u = (side * (w + BOARD_GAP_PX) + (v[:, 0] - x0) / (x1 - x0) * w) / img.width
    face_v = (y1 - v[:, 1]) / (y1 - y0) * h / img.height
    uv = np.stack([np.where(side == 2, 0.5, face_u), np.where(side == 2, (h + BOARD_GAP_PX / 2) / img.height, face_v)], axis=1)
    return v @ m[:, :3].T + m[:, 3], f, uv, img


def model_glb(items, slug, digest_, poses=()):
    """The items as one GLB: a root node named for the product that turns the frame into glTF's, and under it a node
    per item named by its id, with its mesh (positions and indices; a board's with its picture's points). An
    item's material says how it is modelled: "cad" (its own part file), "envelope" (a box or cylinder at datasheet
    sizes), "path" (a Drawn, along the path it takes as built) or a board's picture. That is the default scene; each
    of `poses` ((name, Drawns) by pose) that draws parts along its own paths has a scene of its own after it, a root
    node named "<slug> · <pose>" over a node per Drawn. The bytes, the default scene's triangles, and each pose's
    scene (None for one that draws none)."""
    import io
    import struct

    bin_, views, accessors = bytearray(), [], []

    def view(data, target=None):
        bin_.extend(b"\0" * (-len(bin_) % 4))
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), **({"target": target} if target else {})})
        bin_.extend(data)
        return len(views) - 1

    def accessor(a, kind, component, target, bounds=False):
        a = np.ascontiguousarray(a)
        out = {"bufferView": view(a.tobytes(), target), "componentType": component, "count": len(a), "type": kind}
        if bounds:
            out["min"], out["max"] = [float(x) for x in a.min(axis=0)], [float(x) for x in a.max(axis=0)]
        accessors.append(out)
        return len(accessors) - 1

    materials = [{"name": "cad", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.78, 1], "metallicFactor": 0, "roughnessFactor": 0.7}},
                 {"name": "envelope", "pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.68, 0.8, 1], "metallicFactor": 0, "roughnessFactor": 0.8}},
                 {"name": "path", "pbrMetallicRoughness": {"baseColorFactor": [0.25, 0.25, 0.27, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}]
    kinds = {"cad": 0, "envelope": 1, "path": 2}
    images, textures, nodes, meshes = [], [], [], []

    def node_of(it):
        """A node for an item, with its mesh if it has a face; and the mesh's triangles."""
        board = _board_of(it.shape)
        if board is None and BOARDS and _made_from_board(it.shape):
            print(f"  (previews/system.glb: {it.id} is drawn without its board's picture: it is made from a board "
                  "board_from_gerbers read, but mirrored, scaled, cut or joined to another shape, so the picture is "
                  "not of it)")
        if board:
            v, f, uv, img = _board_mesh(*board)
            png = io.BytesIO()
            img.save(png, "PNG", optimize=True)
            images.append({"bufferView": view(png.getvalue()), "mimeType": "image/png"})
            textures.append({"sampler": 0, "source": len(images) - 1})
            materials.append({"name": f"board {it.id}", "pbrMetallicRoughness": {
                "baseColorTexture": {"index": len(textures) - 1}, "metallicFactor": 0, "roughnessFactor": 0.6}})
            material = len(materials) - 1
        else:
            v, f = _tessellate(it.shape, MODEL_MESH)
            uv, material = None, kinds.get(it.model, 1)
        node = {"name": it.id}
        if len(f):
            attributes = {"POSITION": accessor(v.astype(np.float32), "VEC3", 5126, 34962, bounds=True)}
            if uv is not None:
                attributes["TEXCOORD_0"] = accessor(uv.astype(np.float32), "VEC2", 5126, 34962)
            small = len(v) < 65535  # 65535 itself is the restart index in some graphics APIs
            index = accessor(f.reshape(-1).astype(np.uint16 if small else np.uint32), "SCALAR", 5123 if small else 5125, 34963)
            meshes.append({"name": it.id, "primitives": [{"attributes": attributes, "indices": index, "material": material}]})
            node["mesh"] = len(meshes) - 1
        return node, len(f)

    nodes.append({"name": slug, "matrix": TO_GLTF, "children": []})
    triangles = 0
    for it in items:
        node, n = node_of(it)
        nodes[0]["children"].append(len(nodes))
        nodes.append(node)
        triangles += n
    if not triangles:
        raise ValueError("no item has a face to draw")
    scenes, of_pose = [{"nodes": [0]}], []
    for name, drawn in poses:
        if not drawn:
            of_pose.append(None)
            continue
        root = len(nodes)
        nodes.append({"name": f"{slug} · {name}", "matrix": TO_GLTF, "children": []})
        for d in drawn:
            nodes[root]["children"].append(len(nodes))
            nodes.append(node_of(d)[0])
        scenes.append({"name": name, "nodes": [root]})
        of_pose.append(len(scenes) - 1)
    gltf = {
        "asset": {"version": "2.0", "generator": "Sprue cad/system.py",
                  "extras": {"slug": slug, "inputs": digest_, "frame": "mm with z up, under a root node that makes it metres with y up"}},
        "scene": 0, "scenes": scenes,
        "nodes": nodes,
        "meshes": meshes, "materials": materials, "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(bin_)}],
    }
    if images:
        gltf.update(images=images, textures=textures,
                    samplers=[{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}])
    bin_.extend(b"\0" * (-len(bin_) % 4))
    gltf["buffers"][0]["byteLength"] = len(bin_)
    head = json.dumps(gltf, separators=(",", ":")).encode()
    head += b" " * (-len(head) % 4)
    data = (struct.pack("<III", 0x46546C67, 2, 28 + len(head) + len(bin_)) + struct.pack("<II", len(head), 0x4E4F534A) + head
            + struct.pack("<II", len(bin_), 0x004E4942) + bytes(bin_))
    return data, triangles, of_pose


def main() -> int:
    product = pathlib.Path(sys.argv[1]).resolve()
    src = product / "cad"
    if not (src / "_system.py").exists():
        print(f"no {src / '_system.py'}: write system() there (see {pathlib.Path(__file__).name})")
        return 2
    import importlib.util

    # build123d is there (this file imported it); the gates need these too, a board read from its zip gerbonara.
    need = ["trimesh", "scipy", "rtree", "shapely"] + (["gerbonara"] if (product / "pcb").exists() else [])
    missing = [m for m in need if importlib.util.find_spec(m) is None]
    if missing:
        req = pathlib.Path(__file__).with_name("requirements.txt")
        lines = ([f"python3 -m pip install -r {req}"] if set(missing) - {"gerbonara"} else []) + \
                (["python3 -m pip install --no-deps gerbonara==1.6.3"] if "gerbonara" in missing else [])
        print(f"the whole-product check needs {', '.join(missing)}: {' && '.join(lines)}")
        return 3
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    sys.path.insert(0, str(src))
    t0 = time.time()
    before = digest(product)  # what is checked is what was there when the run began
    reads = Reads(product)
    try:
        sysm = importlib.import_module("_system").system()
    except Missing as e:
        # A line, field or file _system.py needs is not there (a BOM line taken out, a board whose audit failed): no
        # gate can run, and system.json says which, by its path in the product.
        sysm, why = None, str(e).replace(f"{product}/", "")
    except Exception as e:  # noqa: BLE001  the product's own code: what it stopped on is the check's result
        # _system.py stops on an error of its own: no gate can run either, and system.json says so of the files as
        # they are, so what is named next is the fix, not a run that would only stop the same way.
        traceback.print_exc()
        sysm, why = None, f"cad/_system.py stopped on {type(e).__name__}: {e}".replace(f"{product}/", "")
    else:
        if not isinstance(sysm, System):
            why = f"cad/_system.py's system() returned {type(sysm).__name__}, not a System: return the System it builds"
            print(f"TypeError: {why}", file=sys.stderr)
            sysm = None
    if sysm is None:
        gates, r = [{"id": "inputs", "title": "inputs", "status": "fail", "detail": why, "problems": 1, "all": [why]}], None
        st = {"ok": False, "faults": [], "untested": list(GATES)}
    else:
        bom = json.loads((product / "bom.json").read_text())
        params = json.loads((product / "design.json").read_text()).get("params", {})
        gates, r = run_all(sysm, sysm.items, bom, params)
    for g in gates:
        print(f"  {'✓' if g['status'] == 'pass' else '✗'} {g['title']}: {g['detail']}")
    if sysm is not None:
        st = self_test(sysm, sysm.items, bom, params)
    for f in st["faults"]:
        print(f"  {'✓' if f['caught'] else '✗'} self-test, {f['gate']}: {f['fault']}: {'caught' if f['caught'] else 'missed'}")
    ok = all(g["status"] == "pass" for g in gates) and st["ok"]
    reads.modules()
    # The inputs are the files as the run found them: the usual ones as it began, the rest as each was first read. Any
    # that differ at the end, or were read as other than they began, changed under the run.
    was = {**before, **{k: v for k, v in reads.seen.items() if k not in before}}
    after = digest(product, sorted(reads.seen))
    moved_under = sorted({k for k in set(was) | set(after) if after.get(k) != was.get(k)} |
                         {k for k, v in reads.seen.items() if k in before and before[k] != v})
    inputs = recorded(was, moved_under)
    if moved_under:
        print(f"  ✗ {', '.join(moved_under)} changed while the check ran: run it again")
        ok = False
    try:
        items, relations = frame(sysm, r, gates)
    except Exception:  # noqa: BLE001  what the 3D view draws is a nicety; the gates' result is still written
        traceback.print_exc()
        items, relations = frame(None, None, [])
    # The 3D model of the frame, of these inputs; with no frame, or none written, one of the frame as it was is not of
    # this run, so it goes.
    glb, model, scenes = product / "previews" / "system.glb", None, [None] * len(sysm.poses if sysm else [])
    if sysm is not None:
        try:
            data, triangles, scenes = model_glb(sysm.items + sysm.drawn, product.name, inputs_digest(inputs),
                                                [(p.name, p.drawn) for p in sysm.poses])
            glb.parent.mkdir(exist_ok=True)
            glb.write_bytes(data)
            model = {"file": "previews/system.glb", "inputs": inputs_digest(inputs), "triangles": triangles}
        except Exception as e:  # noqa: BLE001  a nicety too
            print(f"  (no previews/system.glb: {type(e).__name__}: {e})")
    if model is None:
        glb.unlink(missing_ok=True)
        scenes = [None] * len(scenes)
    try:
        poses = pose_frames(sysm, scenes) if sysm is not None else []
    except Exception:  # noqa: BLE001  a nicety, as the frame is
        traceback.print_exc()
        poses = []
    out = {
        "slug": product.name, "ok": ok, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "parts": len(sysm.items) if sysm else 0, "envelopes": sum(1 for i in sysm.items if i.model == "envelope") if sysm else 0,
        "minClearanceMm": sysm.min_clearance_mm if sysm else None, "items": items, "relations": relations, "poses": poses, "model": model,
        "gates": [written(g) for g in gates],
        "stability": getattr(r, "stab", []), "probes": getattr(r, "probes", []),
        "selfTest": st, "inputs": inputs, "seconds": round(time.time() - t0, 1),
    }
    (product / "system.json").write_text(json.dumps(out, indent=2) + "\n")
    if sysm is None:
        (product / "previews" / "system.svg").unlink(missing_ok=True)  # a drawing of the frame as it was is not of this
        print("system: FAIL, the product can't be put in one frame; system.json")
        return 1
    try:
        from build import preview

        (product / "previews").mkdir(exist_ok=True)
        preview(Compound([i.shape for i in sysm.items + sysm.drawn]), product / "previews" / "system.svg")
    except Exception as e:  # noqa: BLE001  the drawing is a nicety; the gates are what count
        print(f"  (no previews/system.svg: {e})")
    print(f"system: {'PASS' if ok else 'FAIL'}, {len(sysm.items)} parts, {out['seconds']} s; system.json"
          + (f", previews/system.glb ({model['triangles']:,} triangles in the frame)" if model else ""))
    return 0 if ok else 1


if __name__ == "__main__":
    # Run as the module `system`, the one a product's _system.py imports, so its Items and probes are this file's.
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    import system

    sys.exit(system.main())
