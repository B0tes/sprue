"""The read-back: the files a fab gets, read by another reader than the one that wrote them.

Run: python3 -I readback.py <product>/pcb [--self-test]   (what `distinta verify <slug>` and `distinta cad <slug>` do)

It reads only what ships: the Gerbers and Excellon drill files inside <slug>-gerbers.zip and the IPC-D-356A netlist
<slug>.d356, with gerbonara and shapely (pinned in requirements.txt next to this file), not with the kit that wrote
them. board.json, written with them by `distinta pcb`, says where each pad is and which netlist design.json means.
The checks:
  files    the zip holds exactly the files board.json lists; each Gerber's %TF.FileFunction% matches its extension
           and each drill file's matches its name (PTH or NPTH); each file states its unit once; every one parses
  outline  the profile layer is exactly one closed outline, of the board's size, with all the copper inside it
  drills   the drill files hold exactly the board's plated and non-plated holes
  copper   each copper layer is painted from its objects in file order (dark adds, clear removes), the non-plated
           holes are punched out, and it falls into islands; a plated drill joins every island it lands on, on both
           layers. Every pad, joined to anything or not, has copper at its centre and a mask opening over it
  intent   the netlist that copper makes against the one design.json means (board.json `intended`): OPEN, a net in
           two or more pieces; SHORT, two nets in one piece, where a pad meant to be joined to nothing (a Pico's
           VBUS) counts as a net of its own, as drc.ts does with ~<pad>
  netlist  the .d356 as gerbonara reads it: a record for every pad, via and hole, where board.json has it and on its
           net, and the copper joins exactly what it says (what a fab's flying probe will test)
  x2       each copper object's %TO.N net (the attribute a fab may check against) is the net its copper joins, and
           each pad has its %TO.P flash
It writes readback.json beside board.json, with board.json's fingerprint (`inputs`, the same as drc.json's) and the
sha256 of the zip and the netlist it read, so the scorer can tell when it is stale. With --self-test it then puts
three faults into copies of the files (a cut round a key's pad; a sliver between a key's two pads, round the socket's
holes, which would drill a straight one away; a sliver from VBUS through VSYS to GND) and expects each to fail, and an
unchanged copy to pass.
Exit status: 0 every check passed, 1 one failed, 2 the files to read are missing (run `distinta pcb`), 3 Python is
older than 3.12 or gerbonara or shapely is missing (the message says how to install them).
"""

import hashlib
import io
import json
import math
import platform
import re
import sys
import tempfile
import time
import warnings
import zipfile
from importlib.metadata import version
from pathlib import Path

REQUIREMENTS = Path(__file__).with_name("requirements.txt")
INSTALL = f"python3 -m pip install --no-deps -r {REQUIREMENTS}"

if sys.version_info < (3, 12):
    print(f"the read-back needs Python 3.12 or newer (gerbonara does), and this is {platform.python_version()}", file=sys.stderr)
    sys.exit(3)
try:
    from gerbonara import ExcellonFile, GerberFile
    from gerbonara import graphic_objects as go
    from gerbonara import graphic_primitives as gp
    from gerbonara.ipc356 import Netlist, PadType
    from gerbonara.utils import MM, approximate_arc
    from shapely import affinity
    from shapely.geometry import LineString, Point, Polygon, box
    from shapely.ops import polygonize_full, unary_union
    from shapely.strtree import STRtree
except ImportError as error:
    print(f"the read-back needs gerbonara and shapely, and {error.name} is not installed: {INSTALL}", file=sys.stderr)
    sys.exit(3)

CHECKS = {
    "files": "the zip holds the files board.json lists, each with the file function its name says and its unit "
             "stated once, and every one parses",
    "outline": "one closed outline, of the board's size, with the copper inside it",
    "drills": "the drill files hold the board's plated and non-plated holes",
    "copper": "every pad has copper at its centre and a mask opening over it, and every plated drill lands on copper "
              "on both layers",
    "intent": "the copper makes the netlist design.json means: no OPEN, no SHORT",
    "netlist": "the .d356 holds every pad, via and hole on its net, and the copper joins exactly what it says",
    "x2": "each copper object's netlist attribute is the net its copper joins, and each pad has its flash",
}
# How far a position or a size may read back from board.json's: Gerber and Excellon are written to 0.001 mm or finer,
# the .d356 to 0.0001 inch.
TOL = 0.002
TOL_D356 = 0.00254 / 2 + 0.001
# What each Gerber extension is (the Protel names fabs go by) and what its %TF.FileFunction% must start with. None is
# the bottom copper's layer number, the number of copper layers.
EXTENSIONS = {
    ".gtl": ("Copper", "L1", "Top"), ".gbl": ("Copper", None, "Bot"),
    ".gts": ("Soldermask", "Top"), ".gbs": ("Soldermask", "Bot"),
    ".gto": ("Legend", "Top"), ".gbo": ("Legend", "Bot"),
    ".gtp": ("Paste", "Top"), ".gbp": ("Paste", "Bot"),
    ".gm1": ("Profile",), ".gko": ("Profile",), ".gml": ("Profile",),
}
DRILL_EXTENSIONS = (".drl", ".xln")
# board.json's name for each layer, and the file function it must have.
ROLES = {
    "F.Cu": ("Copper", "L1", "Top"), "B.Cu": ("Copper", None, "Bot"), "F.Mask": ("Soldermask", "Top"),
    "B.Mask": ("Soldermask", "Bot"), "F.Silkscreen": ("Legend", "Top"), "B.Silkscreen": ("Legend", "Bot"),
    "Edge.Cuts": ("Profile",), "PTH": ("Plated",), "NPTH": ("NonPlated",),
}
COPPER = ("F.Cu", "B.Cu")
MASK = {"F.Cu": "F.Mask", "B.Cu": "B.Mask"}


def mm(v):
    return f"{round(v, 3) + 0:g}"


def at(x, y):
    return f"({x:.2f}, {y:.2f})"


def listed(xs):
    xs = list(xs)
    return " and ".join(xs) if len(xs) < 3 else f"{', '.join(xs[:-1])} and {xs[-1]}"


def few(xs, n=6):
    xs = list(xs)
    return ", ".join(xs[:n]) + (f" and {len(xs) - n} more" if len(xs) > n else "")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Findings:
    """What the checks found: errors that fail the board, each with its check, its kind (OPEN, SHORT, ...) and the
    nets it names, and warnings that do not."""

    def __init__(self):
        self.errors, self.warnings = [], []

    def error(self, check, text, kind="error", labels=()):
        self.errors.append({"check": check, "kind": kind, "text": text, "labels": sorted(set(labels))})

    def warn(self, check, text):
        if text not in (w["text"] for w in self.warnings):
            self.warnings.append({"check": check, "text": text})

    def of(self, check):
        return [e["text"] for e in self.errors if e["check"] == check]


# ---- geometry from gerbonara's primitives ----

def shape(p):
    """One gerbonara primitive, in mm, as a shapely polygon."""
    if isinstance(p, gp.Circle):
        return Point(p.x, p.y).buffer(p.r, quad_segs=16)
    if isinstance(p, gp.Rectangle):
        r = box(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2)
        return affinity.rotate(r, p.rotation, origin=(p.x, p.y), use_radians=True) if p.rotation else r
    if isinstance(p, gp.Line):
        if math.isclose(p.x1, p.x2, abs_tol=1e-9) and math.isclose(p.y1, p.y2, abs_tol=1e-9):
            return Point(p.x1, p.y1).buffer(p.width / 2, quad_segs=16)
        return LineString([(p.x1, p.y1), (p.x2, p.y2)]).buffer(p.width / 2, quad_segs=16)
    if isinstance(p, gp.Arc):
        pts = list(approximate_arc(p.cx, p.cy, p.x1, p.y1, p.x2, p.y2, p.clockwise, max_error=1e-3))
        return LineString(pts).buffer(p.width / 2, quad_segs=16)
    if isinstance(p, gp.ArcPoly):
        q = p.approximate_arcs(max_error=1e-3) if p.arc_centers else p
        return Polygon(q.outline).buffer(0) if len(q.outline) >= 3 else Polygon()
    raise TypeError(f"no shape for a {type(p).__name__}")


def paint(gerber):
    """A Gerber layer as shapely geometry: its objects painted in file order, dark ones added and clear ones removed
    from what is painted before them."""
    geom, run, dark = Polygon(), [], True
    for obj in gerber.objects:
        for p in obj.to_primitives(unit=MM):
            if p.polarity_dark != dark and run:
                geom = geom.union(unary_union(run)) if dark else geom.difference(unary_union(run))
                run = []
            dark = p.polarity_dark
            run.append(shape(p))
    if run:
        geom = geom.union(unary_union(run)) if dark else geom.difference(unary_union(run))
    return geom


def polygons(geom):
    """The pieces of a geometry, each a polygon with some area."""
    parts = getattr(geom, "geoms", [geom])
    return [g for g in parts if isinstance(g, Polygon) and g.area > 1e-9]


def attrs(obj):
    """A Gerber object's X2 attributes ({".N": ("GND",), ...}), with the writer's \\uXXXX escapes undone. gerbonara
    keeps none on a region, so a pour has none here."""
    a = obj.__dict__.get("attrs")
    if not isinstance(a, dict):
        return {}
    undo = lambda v: re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), v)
    return {k: tuple(undo(v) for v in vs) for k, vs in a.items()}


# ---- the files ----

def unpack(pcb, board, found):
    """The zip's files and the netlist, as text, checked against board.json's list."""
    files = board["files"]
    zip_name = files.get("zip") or f"{board['slug']}-gerbers.zip"
    want = {role: name for role, name in files.items() if role not in ("zip", "netlist")}
    data = (pcb / zip_name).read_bytes()
    texts = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            if info.filename in texts:
                found.error("files", f"the zip holds {info.filename} twice")
            texts[info.filename] = z.read(info).decode("utf-8", errors="replace")
    for role, name in sorted(want.items()):
        if name not in texts:
            found.error("files", f"the zip has no {name} ({role}), which board.json lists")
    for name in sorted(set(texts) - set(want.values())):
        found.error("files", f"the zip holds {name}, which board.json does not list")
    netlist = (pcb / files["netlist"]).read_bytes()
    return zip_name, data, texts, files["netlist"], netlist


def file_function(text, drill):
    """A file's %TF.FileFunction% fields, and how many times it says one."""
    pattern = r"^; #@! TF\.FileFunction,(.*)$" if drill else r"^%TF\.FileFunction,(.*)\*%$"
    said = re.findall(pattern, text, re.M)
    return (tuple(said[0].split(",")) if said else None), len(said)


def expected_function(name, copper_layers):
    """What a file's name says its file function is, or None for a name no fab knows."""
    ext = Path(name).suffix.lower()
    if ext in DRILL_EXTENSIONS:
        stem = Path(name).stem.upper()
        return ("NonPlated",) if stem.endswith("NPTH") else ("Plated",) if stem.endswith("PTH") else None
    want = EXTENSIONS.get(ext)
    return tuple(f"L{copper_layers}" if f is None else f for f in want) if want else None


def parse_files(texts, board, found):
    """Each file parsed with gerbonara, its file function held to its name and to board.json's role for it, and its
    unit stated once. Returns the parsed layers by role."""
    roles = {name: role for role, name in board["files"].items()}
    copper_layers = sum(1 for n in texts if Path(n).suffix.lower() in (".gtl", ".gbl") or re.match(r"\.g\d+$", Path(n).suffix.lower()))
    parsed = {}
    for name, text in sorted(texts.items()):
        drill = Path(name).suffix.lower() in DRILL_EXTENSIONS
        fn, said = file_function(text, drill)
        want = expected_function(name, copper_layers)
        role_fn = ROLES.get(roles.get(name, ""))
        role_fn = tuple(f"L{copper_layers}" if f is None else f for f in role_fn) if role_fn else None
        if said != 1:
            found.error("files", f"{name} states its file function {said} times, not once")
        elif want is None:
            found.error("files", f"{name}: a fab cannot tell from its name what it is (a Protel extension such as .gtl, or a drill file ending in PTH or NPTH)")
        elif fn[:len(want)] != want:
            found.error("files", f"{name}'s %TF.FileFunction% is {','.join(fn)}, but its name says {','.join(want)}: a fab that trusts the attribute and one that trusts the name would read different layers")
        elif role_fn and fn[:len(role_fn)] != role_fn:
            found.error("files", f"{name} is board.json's {roles[name]}, but its file function is {','.join(fn)}")
        if drill and fn and len(fn) >= 3 and (fn[1], fn[2]) != ("1", str(copper_layers)):
            found.error("files", f"{name} drills layers {fn[1]} to {fn[2]}, not 1 to {copper_layers}")
        units = re.findall(r"^(METRIC|INCH|M71|M72)\b", text, re.M) if drill else re.findall(r"%MO(MM|IN)\*%", text)
        if len(units) != 1:
            found.error("files", f"{name} states its unit {len(units)} times ({', '.join(units) or 'never'}), not once")
        with warnings.catch_warnings(record=True) as heard:
            warnings.simplefilter("always")
            try:
                parsed[roles.get(name, name)] = (ExcellonFile if drill else GerberFile).from_string(text, filename=Path(name))
            except Exception as error:
                found.error("files", f"{name} does not parse: {error}")
        for w in heard:
            found.warn("files", f"gerbonara on {name}: {str(w.message).split(': ', 1)[-1]}")
    return parsed


# ---- the outline and the drills ----

def outline(layers, board, copper, found):
    """The board's outline from the profile layer: exactly one closed loop, of the board's size."""
    edge = layers.get("Edge.Cuts")
    if not isinstance(edge, GerberFile):
        found.error("outline", "there is no profile layer (Edge.Cuts) to read the outline from")
        return None
    lines = []
    for obj in edge.objects:
        for p in obj.to_primitives(unit=MM):
            if isinstance(p, gp.Line):
                lines.append(LineString([(p.x1, p.y1), (p.x2, p.y2)]))
            elif isinstance(p, gp.Arc):
                lines.append(LineString(list(approximate_arc(p.cx, p.cy, p.x1, p.y1, p.x2, p.y2, p.clockwise, max_error=1e-3))))
            else:
                found.error("outline", f"the profile layer has a {type(p).__name__.lower()}, not a line or an arc")
    if not lines:
        found.error("outline", "the profile layer draws nothing")
        return None
    loops, cuts, dangles, invalid = polygonize_full(unary_union(lines))
    loops = polygons(loops)
    open_ends = sum(len(getattr(g, "geoms", [])) for g in (cuts, dangles, invalid))
    if len(loops) != 1 or open_ends:
        found.error("outline", f"the profile layer makes {len(loops)} closed outline{'' if len(loops) == 1 else 's'}"
                    + (f" and {open_ends} open or crossing piece{'' if open_ends == 1 else 's'}" if open_ends else "") + ", not exactly one closed outline")
        return None
    shape_ = loops[0]
    x0, y0, x1, y1 = shape_.bounds
    w, h = board["board"]["width"], board["board"]["height"]
    if abs((x1 - x0) - w) > 0.01 or abs((y1 - y0) - h) > 0.01:
        found.error("outline", f"the outline is {mm(x1 - x0)} x {mm(y1 - y0)} mm, and board.json's board {mm(w)} x {mm(h)} mm")
    for layer, geom in copper.items():
        out = geom.difference(shape_)
        if out.area > 1e-4:
            c = out.representative_point()
            found.error("outline", f"{mm(out.area)} mm2 of {layer} copper lies outside the outline, near {at(c.x, c.y)}: the fab would cut it off")
    return shape_


def holes(drill):
    """A drill file's holes as (x, y, diameter) in mm, and its slots."""
    flashes, slots = [], 0
    for o in drill.objects:
        if isinstance(o, go.Flash):
            flashes.append((MM(o.x, o.unit), MM(o.y, o.unit), MM(o.tool.diameter, o.tool.unit)))
        else:
            slots += 1
    return flashes, slots


def drills(layers, board, found):
    """The plated and non-plated holes in the drill files against board.json's."""
    got = {}
    for role, key in (("PTH", "plated"), ("NPTH", "nonPlated")):
        f = layers.get(role)
        if not isinstance(f, ExcellonFile):
            found.error("drills", f"there is no {role} drill file to read")
            got[role] = []
            continue
        have, slots = holes(f)
        got[role] = have
        if slots:
            found.error("drills", f"the {role} file has {slots} slot{'' if slots == 1 else 's'}, and the board none")
        want = [(d["x"], d["y"], d["d"]) for d in board["drills"][key]]
        left = list(have)
        missing = []
        for x, y, d in want:
            hit = next((h for h in left if abs(h[0] - x) <= TOL and abs(h[1] - y) <= TOL and abs(h[2] - d) <= TOL), None)
            if hit:
                left.remove(hit)
            else:
                missing.append(f"{mm(d)} mm at {at(x, y)}")
        if missing:
            found.error("drills", f"the {role} file lacks {len(missing)} of the board's holes: {few(missing, 4)}")
        if left:
            found.error("drills", f"the {role} file has {len(left)} hole{'' if len(left) == 1 else 's'} the board does not: {few([f'{mm(d)} mm at {at(x, y)}' for x, y, d in left], 4)}")
    return got


# ---- the copper, as islands joined by plated drills ----

class Copper:
    """Each copper layer's islands, and which of them the plated drills join (union-find over (layer, island))."""

    def __init__(self, layers, drill_holes, found):
        self.islands, self.trees, self.parent = {}, {}, {}
        self.geom = {}
        punch = unary_union([Point(x, y).buffer(d / 2, quad_segs=16) for x, y, d in drill_holes.get("NPTH", [])])
        for layer in COPPER:
            g = layers.get(layer)
            if not isinstance(g, GerberFile):
                found.error("copper", f"there is no {layer} layer to read")
                g = None
            # A non-plated hole is drilled through whatever copper is there.
            self.geom[layer] = paint(g).difference(punch) if g else Polygon()
            self.islands[layer] = polygons(self.geom[layer])
            self.trees[layer] = STRtree(self.islands[layer])
        self.plated = len(drill_holes.get("PTH", []))
        for x, y, d in drill_holes.get("PTH", []):
            disc = Point(x, y).buffer(d / 2, quad_segs=16)
            hits = {layer: self.touching(layer, disc) for layer in COPPER}
            for layer, ids in hits.items():
                if not ids:
                    found.error("copper", f"the plated drill at {at(x, y)} ({mm(d)} mm) lands on no copper on {layer}: it joins nothing there", kind="no copper")
            nodes = [(layer, i) for layer, ids in hits.items() for i in ids]
            for n in nodes[1:]:
                self.union(nodes[0], n)

    def touching(self, layer, geom):
        return [int(i) for i in self.trees[layer].query(geom) if self.islands[layer][i].intersects(geom)]

    def at(self, layer, x, y):
        """The island under a point, or None."""
        ids = self.touching(layer, Point(x, y))
        return (layer, ids[0]) if ids else None

    def find(self, n):
        self.parent.setdefault(n, n)
        while self.parent[n] != n:
            self.parent[n] = self.parent[self.parent[n]]
            n = self.parent[n]
        return n

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def pads_on_copper(board, copper, layers, found):
    """Each pad's piece of copper on each of its layers, and its mask opening. A pad has a piece only where its centre
    is on copper."""
    masks = {side: paint(layers[side]) if isinstance(layers.get(side), GerberFile) else None for side in MASK.values()}
    for side, mask in masks.items():
        if mask is None:
            found.error("copper", f"there is no {side} layer to find the pads' mask openings in")
    pieces = {}
    for p in board["pads"]:
        for layer in p["layers"]:
            node = copper.at(layer, p["x"], p["y"])
            if node is None:
                found.error("copper", f"pad {label_of(p)} has no copper at its centre {at(p['x'], p['y'])} on {layer}", kind="no copper", labels=[p["id"]])
            else:
                pieces.setdefault(p["id"], set()).add(node)
            mask = masks[MASK[layer]]
            if mask is not None and not mask.intersects(Point(p["x"], p["y"])):
                found.error("copper", f"pad {label_of(p)} is under the solder mask: {MASK[layer]} has no opening at its centre {at(p['x'], p['y'])}", kind="masked", labels=[p["id"]])
    return pieces


def label_of(p):
    return f"{p['id']} ({p['name']})" if p.get("name") and p["name"] != p["num"] else p["id"]


# ---- the netlist the copper makes ----

def meant(board):
    """Each pad's net as design.json means it: `want` the net a pad must be on, `may` the net it may join (the ground
    pins, any of which will do). A controller or socket pad the intent lists nowhere is a net of its own ("~U1.40"),
    meant to be joined to nothing; a pad of another part keeps the net the board code drew (or is a net of its own)."""
    intent, intended = board.get("intent"), board.get("intended")
    want, may, covered = {}, {}, set()
    if intent and intended:
        covered = {intent["controller"], *intent["keys"]}
        for n in intended:
            for p in n["pads"]:
                want[p] = n["net"]
            for p in n.get("anyOf") or []:
                may[p] = n["net"]
    for p in board["pads"]:
        if p["id"] in want or p["id"] in may:
            continue
        want[p["id"]] = f"~{p['id']}" if p["ref"] in covered or not p["net"] else p["net"]
    return want, may


def pieces_of(copper, pieces):
    """Pad ids by the piece of copper (its root) they sit on."""
    out = {}
    for pid, nodes in pieces.items():
        for n in nodes:
            out.setdefault(copper.find(n), set()).add(pid)
    return out


def layers_of(copper, root):
    """The layers a piece of copper is on."""
    return listed([layer for layer in COPPER if any(copper.find((layer, i)) == root for i in range(len(copper.islands[layer])))])


def intent(board, copper, pieces, found):
    """OPEN and SHORT against the netlist design.json means. Returns the extracted nets, by name."""
    want, may = meant(board)
    pads = {p["id"]: p for p in board["pads"]}
    by_root = pieces_of(copper, pieces)
    roots = {pid: {copper.find(n) for n in nodes} for pid, nodes in pieces.items()}
    name = lambda lab: label_of(pads[lab[1:]]) if lab.startswith("~") else lab
    nets = sorted({v for v in want.values() if not v.startswith("~")})
    for net in nets:
        need = sorted((p for p, v in want.items() if v == net and p in roots), key=natural)
        split = {}
        for p in need:
            for r in roots[p]:
                split.setdefault(r, []).append(p)
        if len(split) > 1:
            groups = sorted((", ".join(ps) for ps in split.values()), key=natural)
            found.error("intent", f"OPEN: {net} is in {len(split)} pieces of copper: {' | '.join(groups)}", kind="OPEN", labels=[net])
        optional = sorted((p for p, v in may.items() if v == net), key=natural)
        if optional and split and not any(roots.get(p, set()) & set(split) for p in optional):
            found.error("intent", f"OPEN: {net} ({few(need, 3)}) reaches none of {few(optional, 3)}, of which it needs one", kind="OPEN", labels=[net])
    extracted = {}
    for root, ids in sorted(by_root.items(), key=lambda kv: natural(min(kv[1], key=natural))):
        labs = sorted({want[p] for p in ids if p in want} | {may[p] for p in ids if p in may}, key=natural)
        if len(labs) > 1:
            on = lambda lab: sorted((p for p in ids if want.get(p) == lab or may.get(p) == lab), key=natural)
            joined = [f"{l} ({few(on(l), 2)})" for l in labs if not l.startswith("~")] + [name(l) for l in labs if l.startswith("~")]
            alone = [name(l) for l in labs if l.startswith("~")]
            text = f"SHORT: one piece of copper on {layers_of(copper, root)} joins {listed(joined)}"
            if alone:
                text += f"; {listed(alone)} {'is' if len(alone) == 1 else 'are'} meant to be joined to nothing"
            found.error("intent", text, kind="SHORT", labels=labs)
        if len(ids) > 1:
            key = " + ".join(l[1:] if l.startswith("~") else l for l in labs)
            n, k = key, 2
            while n in extracted:
                n, k = f"{key} ({k})", k + 1
            extracted[n] = sorted(ids, key=natural)
    return extracted


def natural(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


# ---- the .d356 netlist ----

def netlist(text, name, board, copper, found):
    """The .d356 read by gerbonara: its records against board.json's pads, vias and holes, and the copper against
    what its nets say. Returns the number of records."""
    with warnings.catch_warnings(record=True) as heard:
        warnings.simplefilter("always")
        try:
            nl = Netlist.from_string(text, filename=name)
        except Exception as error:
            found.error("netlist", f"{name} does not parse: {error}")
            return 0
    for w in heard:
        found.warn("netlist", f"gerbonara on {name}: {w.message}")
    recs = []
    for r in nl.test_records:
        recs.append({
            "type": r.pad_type, "net": r.net_name, "via": r.is_via, "ref": r.ref_des, "pin": r.pin,
            "x": MM(r.x, r.unit), "y": MM(r.y, r.unit), "access": r.access_layer,
            "drill": MM(r.hole_dia, r.unit) if r.hole_dia is not None else None, "plated": r.is_plated,
        })
    near = lambda r, x, y: abs(r["x"] - x) <= TOL_D356 and abs(r["y"] - y) <= TOL_D356
    # Every pad has one record, on its net, where it is, of its kind.
    parts = [r for r in recs if r["type"] in (PadType.SMD_PAD, PadType.THROUGH_HOLE) and not r["via"]]
    for p in board["pads"]:
        mine = [r for r in parts if r["ref"] == p["ref"] and r["pin"] == p["num"]]
        if len(mine) != 1:
            found.error("netlist", f"{name} has {len(mine)} records for {p['id']}, not one", labels=[p["id"]])
            continue
        r = mine[0]
        through = bool(p["drill"]) and len(p["layers"]) == 2
        if (r["net"] or "") != p["net"]:
            found.error("netlist", f"{name} puts {p['id']} on {r['net'] or 'N/C'}, and board.json on {p['net'] or 'no net'}", labels=[p["id"]])
        if not near(r, p["x"], p["y"]):
            found.error("netlist", f"{name} has {p['id']} at {at(r['x'], r['y'])}, and board.json at {at(p['x'], p['y'])}", labels=[p["id"]])
        if (r["type"] == PadType.THROUGH_HOLE) != through:
            found.error("netlist", f"{name} has {p['id']} as {'a through hole' if r['type'] == PadType.THROUGH_HOLE else 'an SMD pad'}, and the board does not")
    known = {(p["ref"], p["num"]) for p in board["pads"]}
    for r in parts:
        if (r["ref"], r["pin"]) not in known:
            found.error("netlist", f"{name} has a record for {r['ref']}-{r['pin']} at {at(r['x'], r['y'])}, which is no pad of the board")
    # The vias and the non-plated holes, by where they are.
    for what, have, want in (
        ("via", [r for r in recs if r["via"]], [(v["x"], v["y"], v["net"], v["drill"]) for v in board["vias"]]),
        ("non-plated hole", [r for r in recs if r["type"] == PadType.NONPLATED_HOLE], [(d["x"], d["y"], None, d["d"]) for d in board["drills"]["nonPlated"]]),
    ):
        left = list(have)
        for x, y, net, d in want:
            hit = next((r for r in left if near(r, x, y) and (net is None or r["net"] == net) and r["drill"] is not None and abs(r["drill"] - d) <= TOL_D356), None)
            if hit:
                left.remove(hit)
            else:
                found.error("netlist", f"{name} has no record of the {mm(d)} mm {what} at {at(x, y)}{f' on {net}' if net else ''}")
        for r in left:
            found.error("netlist", f"{name} has a {what} record at {at(r['x'], r['y'])} the board does not have")
    # The copper joins what the records' nets say, and nothing else: each N/C record is a net of its own.
    side = {1: ["F.Cu"], 2: ["B.Cu"], 0: list(COPPER)}
    by_net, by_root = {}, {}
    for r in recs:
        if r["type"] == PadType.NONPLATED_HOLE:
            continue
        who = "a via" if r["via"] else f"{r['ref']}-{r['pin']}"
        net = r["net"] or f"N/C {who}"
        node = next((n for n in (copper.at(l, r["x"], r["y"]) for l in side.get(r["access"], COPPER)) if n), None)
        if node is None:
            found.error("netlist", f"{name}'s point for {who} at {at(r['x'], r['y'])} is on no copper: a probe there would touch bare board")
            continue
        root = copper.find(node)
        by_net.setdefault(net, {}).setdefault(root, []).append(who)
        by_root.setdefault(root, set()).add(net)
    for net, split in sorted(by_net.items()):
        if len(split) > 1:
            groups = sorted((", ".join(sorted(set(ws), key=natural)) for ws in split.values()), key=natural)
            found.error("netlist", f"{name} says {net} is one net, but the copper has it in {len(split)} pieces: {' | '.join(groups)}", kind="OPEN", labels=[net])
    for root, ns in by_root.items():
        if len(ns) > 1:
            found.error("netlist", f"the copper joins what {name} keeps apart: {listed(sorted(ns, key=natural))}", kind="SHORT", labels=ns)
    return len(recs)


# ---- the X2 netlist attributes ----

def x2(layers, board, copper, found):
    """Each copper flash and draw with a %TO.N net sits on copper whose pads are on that net, and each pad has a flash
    with its %TO.P where it is. Returns how many objects were checked."""
    pads = {p["id"]: p for p in board["pads"]}
    drawn = {p["id"]: p["net"] or f"~{p['id']}" for p in board["pads"]}
    nets_of = {}
    for pid, p in pads.items():
        for layer in p["layers"]:
            node = copper.at(layer, p["x"], p["y"])
            if node:
                nets_of.setdefault(copper.find(node), set()).add(drawn[pid])
    checked, flashed = 0, set()
    for layer in COPPER:
        g = layers.get(layer)
        if not isinstance(g, GerberFile):
            continue
        for obj in g.objects:
            a = attrs(obj)
            net = (a.get(".N") or ("",))[0]
            if not obj.polarity_dark or not net or isinstance(obj, go.Region):
                continue
            pin = a.get(".P")
            if isinstance(obj, go.Flash) and pin:
                pid = f"{pin[0]}.{pin[1]}"
                p = pads.get(pid)
                if p and layer in p["layers"] and abs(MM(obj.x, obj.unit) - p["x"]) <= TOL and abs(MM(obj.y, obj.unit) - p["y"]) <= TOL:
                    flashed.add((pid, layer))
                    if net != (p["net"] or "N/C"):
                        found.error("x2", f"{layer}: the flash of {pid} says %TO.N,{net}, and the pad is on {p['net'] or 'no net (N/C)'}", labels=[pid])
            geom = unary_union([shape(p) for p in obj.to_primitives(unit=MM)])
            ids = copper.touching(layer, geom)
            if not ids:
                continue
            i = max(ids, key=lambda i: copper.islands[layer][i].intersection(geom).area)
            on = nets_of.get(copper.find((layer, i)), set())
            # A pad on no net (N/C) is a net of its own; with two or more nets on it, the copper is a short, which
            # the intent and netlist checks report.
            if net == "N/C" and not pin or len(on) != 1:
                continue
            checked += 1
            want, got = (f"~{pin[0]}.{pin[1]}" if net == "N/C" else net), next(iter(on))
            if got != want:
                c = geom.representative_point()
                found.error("x2", f"{layer}: a {type(obj).__name__.lower()} at {at(c.x, c.y)} says %TO.N,{net}, but its copper joins {'only ' + got[1:] if got.startswith('~') else got}", labels=[net])
    for p in board["pads"]:
        for layer in p["layers"]:
            if (p["id"], layer) not in flashed:
                found.error("x2", f"{layer} has no flash with %TO.P,{p['ref']},{p['num']} at {p['id']}'s place {at(p['x'], p['y'])}", labels=[p["id"]])
    return checked


# ---- the whole read-back ----

def read_back(pcb):
    """Every check on the files in one pcb/ folder. Returns the report written to readback.json."""
    started = time.time()
    board = json.loads((pcb / "board.json").read_text())
    found = Findings()
    zip_name, zip_data, texts, net_name, net_data = unpack(pcb, board, found)
    layers = parse_files(texts, board, found)
    holes_ = drills(layers, board, found)
    copper = Copper(layers, holes_, found)
    outline(layers, board, copper.geom, found)
    pieces = pads_on_copper(board, copper, layers, found)
    extracted = intent(board, copper, pieces, found)
    records = netlist(net_data.decode("utf-8", errors="replace"), net_name, board, copper, found)
    objects = x2(layers, board, copper, found)
    return {
        "inputs": board.get("inputs"), "slug": board["slug"], "ok": not found.errors,
        "files": {
            "zip": {"name": zip_name, "sha256": sha256(zip_data), "files": sorted(texts)},
            "netlist": {"name": net_name, "sha256": sha256(net_data)},
        },
        "tools": {"python": platform.python_version(), "gerbonara": version("gerbonara"), "shapely": version("shapely")},
        "checks": [{"id": k, "checked": v, "ok": not found.of(k), "errors": found.of(k)} for k, v in CHECKS.items()],
        "errors": [e["text"] for e in found.errors],
        "warnings": [w["text"] for w in found.warnings],
        "nets": extracted,
        "stats": {
            "islands": {layer: len(copper.islands[layer]) for layer in COPPER},
            "platedDrills": copper.plated, "nonPlatedDrills": len(holes_.get("NPTH", [])), "pads": len(board["pads"]),
            "padsOnCopper": len(pieces), "nets": len(extracted), "d356Records": records, "x2Objects": objects,
            "seconds": round(time.time() - started, 2),
        },
        "_found": found,
    }


# ---- the self-test: faults put into copies of the files ----

def draw(text, width, pts, dark):
    """A Gerber layer with one more stroke along `pts`, dark (copper added) or clear (copper removed), before its end."""
    fmt = re.search(r"%FSLAX(\d)(\d)Y\d\d\*%", text)
    scale = 10 ** int(fmt[2]) if fmt else 10 ** 6
    xy = lambda x, y: f"X{round(x * scale)}Y{round(y * scale)}"
    code = max([int(c) for c in re.findall(r"%ADD(\d+)", text)] + [9]) + 1
    cmds = [f"%ADD{code}C,{width:.6f}*%", "%LPD*%" if dark else "%LPC*%", f"D{code}*", f"{xy(*pts[0])}D02*",
            *[f"{xy(*p)}D01*" for p in pts[1:]], "%LPD*%"]
    end = text.rindex("M02*")
    return text[:end] + "\n".join(cmds) + "\n" + text[end:]


def detour(a, b, holes, width):
    """A path from a to b that no non-plated hole cuts: straight, an L, or a U above or below, whichever is first."""
    drilled = unary_union([Point(h["x"], h["y"]).buffer(h["d"] / 2 + width / 2 + 0.1) for h in holes])
    (ax, ay), (bx, by) = a, b
    paths = [[a, b], [a, (bx, ay), b], [a, (ax, by), b]]
    for k in range(1, 9):
        paths += [[a, (ax, max(ay, by) + k), (bx, max(ay, by) + k), b], [a, (ax, min(ay, by) - k), (bx, min(ay, by) - k), b]]
    return next((p for p in paths if not LineString(p).intersects(drilled)), None)


def faults(board):
    """The faults the self-test puts in: (what, layer, width, points, dark, what must be found). Each is skipped when
    the board has nothing to put it on."""
    pads = {p["id"]: p for p in board["pads"]}
    want, may = meant(board)
    intent_ = board.get("intent") or {}
    keys = sorted(intent_.get("keys", {}), key=natural)
    plated = [(d["x"], d["y"], d["d"]) for d in board["drills"]["plated"]]
    smd = lambda p: p and len(p["layers"]) == 1
    out = []

    # A cut all round a pad on its layer, clear of any plated drill that would carry it to the other layer.
    def ring(p, gap=0.4):
        hx, hy = p["w"] / 2 + gap, p["h"] / 2 + gap
        return [(p["x"] - hx, p["y"] - hy), (p["x"] + hx, p["y"] - hy), (p["x"] + hx, p["y"] + hy), (p["x"] - hx, p["y"] + hy), (p["x"] - hx, p["y"] - hy)]

    def clear_of_drills(p, gap=0.4, width=0.3):
        hx, hy = p["w"] / 2 + gap + width, p["h"] / 2 + gap + width
        return not any(abs(x - p["x"]) < hx + d / 2 and abs(y - p["y"]) < hy + d / 2 for x, y, d in plated)

    shared = lambda p: sum(1 for v in want.values() if v == want[p["id"]]) + sum(1 for v in may.values() if v == want[p["id"]]) > 1
    candidates = [pads.get(f"{k}.A") for k in keys] or sorted(pads.values(), key=lambda p: natural(p["id"]))
    cut = next((p for p in candidates if smd(p) and not want[p["id"]].startswith("~") and shared(p) and clear_of_drills(p)), None)
    if cut:
        net = want[cut["id"]]
        out.append((f"a 0.3 mm cut all round {cut['id']} on {cut['layers'][0]}", cut["layers"][0], 0.3, ring(cut), False,
                    f"OPEN on {net}", lambda f, net=net: any(e["kind"] == "OPEN" and net in e["labels"] for e in f.errors if e["check"] == "intent")))
    else:
        out.append(("a cut round a pad", None, 0, [], False, "no pad on a shared net to cut round", None))

    # A sliver across a key's socket, from its A pad to its B pad: the GPIO shorted to ground. It goes round the
    # socket's holes, which would drill a straight one away.
    key = "K5" if "K5" in keys else keys[len(keys) // 2] if keys else None
    a, b = (pads.get(f"{key}.A"), pads.get(f"{key}.B")) if key else (None, None)
    path = detour((a["x"], a["y"]), (b["x"], b["y"]), board["drills"]["nonPlated"], 0.3) if smd(a) and smd(b) and a["layers"] == b["layers"] else None
    if path:
        labs = {want[a["id"]], want[b["id"]]}
        out.append((f"a 0.3 mm sliver from {a['id']} to {b['id']} on {a['layers'][0]}", a["layers"][0], 0.3, path, True,
                    f"SHORT of {listed(sorted(labs))}", lambda f, labs=labs: any(e["kind"] == "SHORT" and labs <= set(e["labels"]) for e in f.errors if e["check"] == "intent")))
    else:
        out.append(("a sliver across a key's socket", None, 0, [], False, "no key with both pads on one layer", None))

    # A sliver along the controller's edge from VBUS through VSYS to a ground pin: pads that are on no net, so only a
    # read-back that counts each of them as a net of its own sees it.
    ctrl = intent_.get("controller")
    named = lambda n: next((p for p in board["pads"] if p["ref"] == ctrl and p.get("name") == n), None)
    vbus, vsys = named("VBUS"), named("VSYS")
    gnd = None
    if smd(vbus) and smd(vsys):
        grounds = [p for p in board["pads"] if p["ref"] == ctrl and p.get("name") == "GND" and p["layers"] == vsys["layers"]]
        gnd = min(grounds, key=lambda p: math.hypot(p["x"] - vsys["x"], p["y"] - vsys["y"]), default=None)
    if gnd:
        labs = {want[vbus["id"]], want[vsys["id"]], may.get(gnd["id"]) or want[gnd["id"]]}
        out.append((f"a 0.3 mm sliver from {vbus['id']} (VBUS) through {vsys['id']} (VSYS) to {gnd['id']} (GND) on {vsys['layers'][0]}", vsys["layers"][0], 0.3,
                    [(vbus["x"], vbus["y"]), (vsys["x"], vsys["y"]), (gnd["x"], gnd["y"])], True,
                    "SHORT of VBUS, VSYS and GND", lambda f, labs=labs: any(e["kind"] == "SHORT" and labs <= set(e["labels"]) for e in f.errors if e["check"] == "intent")))
    else:
        out.append(("a sliver from VBUS through VSYS to GND", None, 0, [], False, "no controller with VBUS, VSYS and GND pads on one layer", None))
    return out


def copy_with(pcb, board, tmp, change=None):
    """A copy of the pcb/ folder's board.json, netlist and zip in `tmp`, with `change` made to one layer's Gerber."""
    files = board["files"]
    zip_name = files.get("zip") or f"{board['slug']}-gerbers.zip"
    for f in ("board.json", files["netlist"]):
        (tmp / f).write_bytes((pcb / f).read_bytes())
    with zipfile.ZipFile(pcb / zip_name) as z, zipfile.ZipFile(tmp / zip_name, "w", zipfile.ZIP_DEFLATED) as out:
        for info in z.infolist():
            data = z.read(info)
            if change and info.filename == files[change[0]]:
                data = change[1](data.decode()).encode()
            out.writestr(info.filename, data)


def self_test(pcb):
    """Puts each fault into a copy of the files and reads it back: each must fail as expected, and an unchanged copy
    must pass."""
    board = json.loads((pcb / "board.json").read_text())
    cases = []
    with tempfile.TemporaryDirectory(prefix="distinta-readback-") as t:
        tmp = Path(t)
        copy_with(pcb, board, tmp)
        control = read_back(tmp)
        for what, layer, width, pts, dark, expect, seen in faults(board):
            if not seen:
                cases.append({"fault": what, "expect": expect, "ran": False, "ok": True, "got": []})
                continue
            copy_with(pcb, board, tmp, (layer, lambda text: draw(text, width, pts, dark)))
            got = read_back(tmp)
            cases.append({"fault": what, "expect": expect, "ran": True, "ok": not got["ok"] and seen(got["_found"]), "got": got["errors"][:3]})
    ran = [c for c in cases if c["ran"]]
    return {
        "ok": control["ok"] and bool(ran) and all(c["ok"] for c in ran),
        "control": {"ok": control["ok"], "errors": control["errors"][:3]},
        "cases": cases,
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    if len(args) != 1 or any(f != "--self-test" for f in flags):
        print("usage: python3 -I readback.py <product>/pcb [--self-test]", file=sys.stderr)
        sys.exit(2)
    pcb = Path(args[0]).resolve()
    board_path = pcb / "board.json"
    if not board_path.exists():
        print(f"no {board_path}: run distinta pcb first", file=sys.stderr)
        sys.exit(2)
    board = json.loads(board_path.read_text())
    zip_name = board["files"].get("zip") or f"{board['slug']}-gerbers.zip"
    for f in (zip_name, board["files"]["netlist"]):
        if not (pcb / f).exists():
            print(f"no {pcb / f}: distinta pcb writes it only when its audit finds no errors", file=sys.stderr)
            sys.exit(2)
    report = read_back(pcb)
    report.pop("_found")
    if "--self-test" in flags:
        report["selfTest"] = self_test(pcb)
        report["ok"] = report["ok"] and report["selfTest"]["ok"]
    (pcb / "readback.json").write_text(json.dumps(report, indent=2) + "\n")
    s = report["stats"]
    print(f"read-back of {report['files']['zip']['name']} and {report['files']['netlist']['name']} (gerbonara {report['tools']['gerbonara']}, shapely {report['tools']['shapely']}, {s['seconds']} s): "
          f"{s['islands']['F.Cu']} islands on F.Cu, {s['islands']['B.Cu']} on B.Cu, {s['platedDrills']} plated drills, {s['nets']} nets")
    for c in report["checks"]:
        print(f"  {'✓' if c['ok'] else '✗'} {c['id']}: {c['checked']}")
        for e in c["errors"][:5]:
            print(f"      {e}")
        if len(c["errors"]) > 5:
            print(f"      and {len(c['errors']) - 5} more in readback.json")
    for w in report["warnings"]:
        print(f"  · {w}")
    if "selfTest" in report:
        t = report["selfTest"]
        print(f"  {'✓' if t['control']['ok'] else '✗'} self-test control: an unchanged copy {'passes' if t['control']['ok'] else 'fails: ' + '; '.join(t['control']['errors'])}")
        for c in t["cases"]:
            state = "skipped, " + c["expect"] if not c["ran"] else ("fails as it should" if c["ok"] else "is not caught as expected")
            print(f"  {'✓' if c['ok'] else '✗'} self-test: {c['fault']} {state}{'' if not c['ran'] else ' (' + c['expect'] + ')'}")
    print(f"wrote {pcb / 'readback.json'}: {'pass' if report['ok'] else 'FAIL'}")
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
