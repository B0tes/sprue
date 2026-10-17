"""The KiCad cross-check: the board rebuilt in KiCad from the files a fab gets, and checked by KiCad's own DRC.

Run: python3 -I kicad.py <product>/pcb [--rules <rules.json>] [--self-test]   (what `sprue verify <slug>` does once
the read-back has found no errors; `kicad.py --find` says which Python with KiCad's pcbnew it would use)

The read-back (readback.py) reads the shipped files with another reader than the one that wrote them; this check
measures them with another DRC than ours (drc.ts). It reads only what ships, the zip, as the read-back does: the
copper layers, the outline and both drill files, with gerbonara (pinned in requirements.txt), and nothing of
board.json but the file names and our rules. From them it builds a KiCad board:
  outline  each line and arc of the profile layer, on Edge.Cuts
  pads     each dark flash with a %TO.P (part, pin) becomes a pad of that part's footprint, on its net (%TO.N, where
           "N/C" is no net), at its aperture's size and shape; with a plated drill at its centre it is a through-hole
           pad (its flashes on both sides one pad, so a pin may also have a surface pad beside it), otherwise a surface
           pad on its layer
  vias     each other plated drill, at the size of the copper flashed over it and on that copper's net
  holes    each non-plated drill, as a non-plated pad
  tracks   each dark draw with a round aperture, at the aperture's width, on its %TO.N net
  pours    each dark region, less every clear object drawn after it, becomes a zone whose fill is stored as that
           copper and never refilled (KiCad would fill it its own way, and then it checks KiCad's copper, not ours).
           gerbonara keeps no attributes on a region, so the zone's net is the net of the pads, tracks and vias its
           copper touches; copper touching two nets is a short, and KiCad's DRC says so
Copper that KiCad cannot hold as items (a clear flash, draw or region that erases a pad or track drawn before it, a
draw with a square aperture, a flash that is neither a pad nor a via, a through-hole pad of another shape on each
side) stops the check with the reason: it is not a pass.
Then KiCad's DRC runs on that board once per rule set (`--rules`, which `sprue verify` writes: our rules, and each
fab profile's published numbers with the fab's own rule file where one exists), each time with a canary rule
appended to the rule file that must fire (on a marker line the rebuild draws on User.9): KiCad drops a whole rule
file it cannot parse, and `kicad-cli` does so
without a word, so a run whose canary is silent has not checked that file's rules and says so. A rule whose
condition KiCad cannot compile (a syntax it does not take, a function it does not have) is skipped as silently, the
rest of the file still checked, so each fab file also gets a probe run: one rule per condition of the file (read as
KiCad 7 reads it: a line starting with '#' is a comment, a rule's last condition is the one kept) that must fire on
the marker unless KiCad skips it, and the rules it skipped are named. What no probe sees is a property
KiCad does not know, which reads as no match: the pinned files were proved on KiCad 7.0.11 (TESTED), and the report
says which KiCad ran. The board's design settings (clearance, track width, edge clearance, drills, rings, hole gaps,
mask web) are each rule set's numbers. A violation counts as an error unless KiCad calls it a warning, so a report
KiCad words some other way fails rather than passes.
KiCad also writes its IPC-D-356 netlist of the rebuilt board, which is diffed against the .d356 we ship, record by
record on net and position (in mm, within a unit of the file, which two writers may round either way), with
gerbonara.ipc356 (part names and the solder-mask field are left out: KiCad 7
writes the mask field one column early).
With --self-test it puts faults into copies of the rebuilt board (a track joining two nets, a track whose removal
cuts its net in two, the pour grown over a pad of another net, copper at the board edge) and expects KiCad's DRC with
our rules to report each as an error it did not report on the clean board, at the fault's place or on its net.
It writes kicad.json beside board.json, with the sha256 of the zip it read. It does not hold back the board: it is
a second opinion, and `sprue verify` reports it as one.

The DRC needs KiCad's own Python (pcbnew), which is rarely the read-back's: KiCad ships its Python inside the app.
So the board is built and checked in a second process, this file run with `--pcbnew <job.json> <out.json>` by the
first Python of: $SPRUE_KICAD_PYTHON; the Python running this; python3 on the PATH; KiCad's own (macOS:
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3; Windows:
C:\\Program Files\\KiCad\\<version>\\bin\\python.exe) that imports pcbnew. KiCad 7.0.11 is what it was built on;
pcbnew's API changes between versions, so a newer one may need a fix here, which the report says.
Exit status: 0 KiCad found nothing any rule set forbids and the netlists agree (a fab's rule file that did not load
is said, and is not a failure), 1 it did, they do not, the self-test missed a fault, or the rebuild found copper it
cannot hold or a pour joining nets, 2 the files to read are missing (run `sprue pcb`), 3 gerbonara or shapely is
missing, 4 Python is older than 3.12, 5 no Python with KiCad's pcbnew was found, so it did not run, 6 KiCad was found
but its DRC with our rules did not run (this KiCad may need a fix here: the report says why).
"""

import platform
import sys

if __name__ == "__main__" and "--pcbnew" not in sys.argv:
    print(f"kicad check: running on Python {platform.python_version()} ({sys.executable})", file=sys.stderr)
    if sys.version_info < (3, 12):
        print(f"the KiCad check needs Python 3.12 or newer (gerbonara does), and {sys.executable} is {'.'.join(map(str, sys.version_info[:3]))}", file=sys.stderr)
        sys.exit(4)

import glob
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import warnings
import zipfile
from pathlib import Path

LAYERS = ("F.Cu", "B.Cu", "Edge.Cuts", "PTH", "NPTH")
COPPER = ("F.Cu", "B.Cu")
# The rebuild draws one short line on MARKER, a layer nothing else uses, for the canary and the probes to fire on:
# once each, as KiCad stops reporting a kind of violation after about 200 of them, and a rule that fired on every
# line of an outline could use them up before the rules after it were checked.
MARKER = "User.9"
# The canary appended to every rule file: an assertion that the marker is not on its layer, which is never true, so it
# fires on the marker, and a run in which it does not fire did not load the file.
CANARY = "sprue canary: this rule must fire"
CANARY_RULE = f'\n(rule "{CANARY}"\n\t(condition "A.Layer == \'{MARKER}\'")\n\t(constraint assertion "A.Layer != \'{MARKER}\'"))\n'
# The probe of a rule's condition: the same assertion, on what the condition or the marker's layer matches, so it
# fires on the marker (and only there) when KiCad compiled the condition.
PROBE = "sprue probe"
# The KiCad this check, and the fabs' rule files it pins, were proved on.
TESTED = "7.0.11"
# Violations that are about what this board does not have, not about the copper: the rebuild has no footprint
# library, courtyard or silkscreen, so KiCad's checks of those say nothing here.
NOT_OURS = {"lib_footprint_issues", "lib_footprint_mismatch", "missing_courtyard", "malformed_courtyard",
            "courtyards_overlap", "silk_overlap", "silk_over_copper", "silk_edge_clearance", "text_height",
            "text_thickness", "footprint_type_mismatch", "npth_inside_courtyard", "pth_inside_courtyard",
            "duplicate_footprints", "extra_footprint", "missing_footprint", "net_conflict", "footprint"}
NEAR_MM = 1.5


class Unbuildable(Exception):
    """Copper the rebuild cannot hold as KiCad items: the message says what, and the check stops there."""


# A circle as a polygon of 256 sides drawn just outside it (its sides touch the circle), so a cut-out made of it
# takes at least what the Gerber's circle takes and never leaves the pour closer to anything than it is: by at
# most 0.0002 mm farther for a 2.5 mm hole.
OUT = 1 / math.cos(math.pi / 256)


def flash_shape(f):
    """A pad's or flash's copper (shape, w, h at x, y), as a shapely polygon."""
    from shapely.geometry import LineString, Point, box
    if f["shape"] == "circle":
        return Point(f["x"], f["y"]).buffer(f["w"] / 2 * OUT, quad_segs=64)
    if f["shape"] == "rect":
        return box(f["x"] - f["w"] / 2, f["y"] - f["h"] / 2, f["x"] + f["w"] / 2, f["y"] + f["h"] / 2)
    r = min(f["w"], f["h"]) / 2
    dx, dy = (f["w"] / 2 - r, 0) if f["w"] >= f["h"] else (0, f["h"] / 2 - r)
    return LineString([(f["x"] - dx, f["y"] - dy), (f["x"] + dx, f["y"] + dy)]).buffer(r * OUT, quad_segs=64)


def track_shape(t):
    """A track's or draw's copper, as a shapely polygon."""
    from gerbonara.utils import approximate_arc
    from shapely.geometry import LineString, Point
    pts = [(t["x1"], t["y1"]), (t["x2"], t["y2"])] if "cx" not in t else list(approximate_arc(t["cx"], t["cy"], t["x1"], t["y1"], t["x2"], t["y2"], t["clockwise"], max_error=1e-4))
    line = LineString(pts) if pts[0] != pts[-1] or len(pts) > 2 else Point(pts[0])
    return line.buffer(t["width"] / 2 * OUT, quad_segs=64)


# ---- the reader: the shipped zip, as gerbonara reads it ----

def read_zip(pcb, board):
    """The board in the shipped zip, as plain data the KiCad half builds from: outline, pads, vias, holes, tracks and
    pours, in mm, y up (as the Gerbers are)."""
    try:
        from gerbonara import ExcellonFile, GerberFile
        from gerbonara import graphic_objects as go
        from gerbonara import graphic_primitives as gp
        from gerbonara.apertures import CircleAperture, ObroundAperture, RectangleAperture
        from gerbonara.utils import MM
        from shapely.geometry import Point, Polygon
        from shapely.ops import unary_union
    except ImportError as error:
        print(f"the KiCad check needs gerbonara and shapely (as the read-back does), and {error.name} is not installed for {sys.executable}", file=sys.stderr)
        sys.exit(3)
    files = board["files"]
    with zipfile.ZipFile(pcb / files["zip"]) as z:
        texts = {role: z.read(files[role]).decode() for role in LAYERS if role in files}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        parsed = {role: (ExcellonFile if role in ("PTH", "NPTH") else GerberFile).from_string(t, filename=Path(files[role])) for role, t in texts.items()}

    def attrs(obj):
        a = obj.__dict__.get("attrs")
        undo = lambda v: re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), v)
        return {k: tuple(undo(v) for v in vs) for k, vs in a.items()} if isinstance(a, dict) else {}

    def net_of(obj):
        n = (attrs(obj).get(".N") or ("",))[0]
        return "" if n == "N/C" else n

    def aperture(ap):
        u = ap.unit
        if isinstance(ap, CircleAperture) and not ap.hole_dia:
            return {"shape": "circle", "w": MM(ap.diameter, u), "h": MM(ap.diameter, u)}
        if isinstance(ap, RectangleAperture) and not ap.hole_dia:
            return {"shape": "rect", "w": MM(ap.w, u), "h": MM(ap.h, u)}
        if isinstance(ap, ObroundAperture) and not ap.hole_dia:
            return {"shape": "oval", "w": MM(ap.w, u), "h": MM(ap.h, u)}
        raise Unbuildable(f"a flash with a {type(ap).__name__} ({ap}) has no KiCad pad shape here")

    def erases(geom):
        return any(d.intersects(geom) and d.intersection(geom).area > 1e-6 for d in drawn)

    outline = []
    for obj in parsed["Edge.Cuts"].objects:
        for p in obj.to_primitives(unit=MM):
            if isinstance(p, gp.Line):
                outline.append({"x1": p.x1, "y1": p.y1, "x2": p.x2, "y2": p.y2})
            elif isinstance(p, gp.Arc):
                outline.append({"x1": p.x1, "y1": p.y1, "x2": p.x2, "y2": p.y2, "cx": p.cx, "cy": p.cy, "clockwise": p.clockwise})
            else:
                raise Unbuildable(f"the outline has a {type(p).__name__}, which is not a line or an arc")
    holes = {}
    for role in ("PTH", "NPTH"):
        holes[role] = []
        for o in parsed[role].objects if role in parsed else []:
            if not isinstance(o, go.Flash):
                raise Unbuildable(f"{files[role]} has a slot, which the rebuild does not make yet")
            holes[role].append({"x": MM(o.x, o.unit), "y": MM(o.y, o.unit), "d": MM(o.tool.diameter, o.tool.unit)})

    flashes, tracks, pours = [], [], []
    for layer in COPPER:
        if layer not in parsed:
            continue
        regions, clears, drawn = [], [], []  # drawn: the dark items so far, to tell when a clear object erases one
        for obj in parsed[layer].objects:
            if isinstance(obj, go.Region):
                outline_pts = obj.approximate_arcs(max_error=1e-3).outline if obj.arc_centers and any(obj.arc_centers) else obj.outline
                poly = Polygon([(MM(x, obj.unit), MM(y, obj.unit)) for x, y in outline_pts]).buffer(0)
                if obj.polarity_dark:
                    regions.append({"poly": poly, "clears": len(clears)})
                else:
                    # A clear region takes copper out of the pours drawn before it; out of a pad or track it cannot.
                    clears.append(poly)
                    if erases(poly):
                        x, y = poly.representative_point().coords[0]
                        raise Unbuildable(f"{layer}: a clear region at ({x:.2f}, {y:.2f}) erases copper drawn before it, which KiCad cannot hold as a pad or track")
                continue
            if isinstance(obj, go.Flash):
                f = {"layer": layer, "x": MM(obj.x, obj.unit), "y": MM(obj.y, obj.unit), **aperture(obj.aperture)}
                geom = flash_shape(f)
                if not obj.polarity_dark:
                    clears.append(geom)
                    if erases(geom):
                        raise Unbuildable(f"{layer}: a clear flash at ({f['x']:.2f}, {f['y']:.2f}) erases copper drawn before it, which KiCad cannot hold as a pad or track")
                    continue
                a = attrs(obj)
                f["net"] = net_of(obj)
                if ".P" in a:
                    f["ref"], f["num"] = a[".P"][0], a[".P"][1]
                    f["fn"] = a[".P"][2] if len(a[".P"]) > 2 else ""
                flashes.append(f)
                drawn.append(geom)
                continue
            if isinstance(obj, (go.Line, go.Arc)):
                ap = obj.aperture
                if not isinstance(ap, CircleAperture):
                    raise Unbuildable(f"{layer}: a draw with a {type(ap).__name__}, which a KiCad track cannot be")
                t = {"layer": layer, "width": MM(ap.diameter, ap.unit), "net": net_of(obj)}
                p = obj.to_primitives(unit=MM)
                p = next(iter(p))
                t.update({"x1": p.x1, "y1": p.y1, "x2": p.x2, "y2": p.y2})
                if isinstance(obj, go.Arc):
                    t.update({"cx": p.cx, "cy": p.cy, "clockwise": p.clockwise})
                geom = track_shape(t)
                if not obj.polarity_dark:
                    clears.append(geom)
                    if erases(geom):
                        raise Unbuildable(f"{layer}: a clear draw at ({t['x1']:.2f}, {t['y1']:.2f}) erases copper drawn before it, which KiCad cannot hold as a pad or track")
                    continue
                tracks.append(t)
                drawn.append(geom)
                continue
            raise Unbuildable(f"{layer}: a {type(obj).__name__}, which the rebuild does not make")
        for r in regions:
            fill = r["poly"].difference(unary_union(clears[r["clears"]:])) if clears[r["clears"]:] else r["poly"]
            pours.append({"layer": layer, "outline": list(r["poly"].exterior.coords)[:-1], "fill": fill})

    # Pads: by part and pin; a plated drill at a pad's centre makes it a through-hole pad on every copper layer, its
    # flashes on each side one pad (keyed by part, pin and hole, as a pin may have a surface pad beside it too).
    def hole_at(x, y, role):
        return next((h for h in holes[role] if math.hypot(h["x"] - x, h["y"] - y) < 1e-3), None)

    pads, plated, used, others = {}, {}, set(), []
    for f in flashes:
        if "ref" not in f:
            others.append(f)
            continue
        h = hole_at(f["x"], f["y"], "PTH")
        at = h and (f["ref"], f["num"], round(h["x"], 3), round(h["y"], 3))
        if at in plated:
            p = plated[at]
            if (p["shape"], round(p["w"], 3), round(p["h"], 3)) != (f["shape"], round(f["w"], 3), round(f["h"], 3)):
                raise Unbuildable(f"{f['ref']}.{f['num']} at ({f['x']:.2f}, {f['y']:.2f}) is a {p['shape']} of {p['w']:.2f} x {p['h']:.2f} mm on {p['layers'][0]} and a {f['shape']} of {f['w']:.2f} x {f['h']:.2f} mm on {f['layer']}, which one KiCad 7 pad cannot be")
            p["layers"].append(f["layer"])
            continue
        key = (f["ref"], f["num"])
        if key in pads:
            key = (f["ref"], f["num"], len(pads))
        pads[key] = {**f, "layers": [f["layer"]], "drill": h["d"] if h else None}
        if h:
            plated[at] = pads[key]
            used.add((h["x"], h["y"]))
    vias = []
    for h in holes["PTH"]:
        if (h["x"], h["y"]) in used:
            continue
        over = [f for f in others if math.hypot(f["x"] - h["x"], f["y"] - h["y"]) < 1e-3]
        if not over:
            raise Unbuildable(f"the plated hole at ({h['x']:.2f}, {h['y']:.2f}) has no copper flashed over it")
        if any(f["shape"] != "circle" for f in over):
            raise Unbuildable(f"the via at ({h['x']:.2f}, {h['y']:.2f}) is flashed with a {over[0]['shape']}, not a circle")
        nets = {f["net"] for f in over}
        if len(nets) > 1:
            raise Unbuildable(f"the via at ({h['x']:.2f}, {h['y']:.2f}) is flashed with copper of {' and '.join(sorted(nets))}")
        vias.append({"x": h["x"], "y": h["y"], "drill": h["d"], "dia": min(f["w"] for f in over), "net": over[0]["net"],
                     "layers": sorted({f["layer"] for f in over})})
        for f in over:
            others.remove(f)
    if others:
        f = others[0]
        raise Unbuildable(f"{len(others)} flash{'es' if len(others) > 1 else ''} with no part and pin and no plated hole under {'them' if len(others) > 1 else 'it'} (the first on {f['layer']} at ({f['x']:.2f}, {f['y']:.2f})), which are neither a pad nor a via")

    # Each pour's net: the nets of the copper its fill touches, on its layer.
    items = [(p["net"], l, flash_shape(p)) for p in pads.values() for l in p["layers"]] + \
            [(t["net"], t["layer"], track_shape(t)) for t in tracks] + \
            [(v["net"], l, Point(v["x"], v["y"]).buffer(v["dia"] / 2)) for v in vias for l in COPPER]
    out_pours = []
    for p in pours:
        touched = {}
        for net, layer, geom in items:
            if layer == p["layer"] and net and geom.intersects(p["fill"]):
                touched[net] = touched.get(net, 0) + 1
        net = max(touched, key=touched.get) if touched else ""
        polys = [g for g in getattr(p["fill"], "geoms", [p["fill"]]) if g.area > 1e-9]
        out_pours.append({"layer": p["layer"], "net": net, "touches": sorted(touched), "outline": p["outline"],
                          "fill": [{"outline": list(g.exterior.coords)[:-1], "holes": [list(i.coords)[:-1] for i in g.interiors]} for g in polys]})
    return {"outline": outline, "pads": list(pads.values()), "vias": vias, "npth": holes["NPTH"], "tracks": tracks, "pours": out_pours}


# ---- the KiCad half: build the board, run the DRC, export the netlist (run with KiCad's Python) ----

def kicad_half(job_path, out_path):
    """Runs every DRC the job lists on the board it describes, in KiCad's Python. Writes the results to out_path."""
    import pcbnew

    job = json.loads(Path(job_path).read_text())
    mm = pcbnew.FromMM

    def P(x, y):
        return pcbnew.VECTOR2I(mm(x), mm(-y))  # KiCad's y points down

    def chain(pts):
        c = pcbnew.SHAPE_LINE_CHAIN()
        for x, y in pts:
            c.Append(mm(x), mm(-y))
        c.SetClosed(True)
        return c

    def build(data, rules):
        b = pcbnew.BOARD()
        nets = {}

        def net(name):
            if not name:
                return None
            if name not in nets:
                nets[name] = pcbnew.NETINFO_ITEM(b, name)
                b.Add(nets[name])
            return nets[name]

        for s in data["outline"]:
            sh = pcbnew.PCB_SHAPE(b)
            sh.SetLayer(pcbnew.Edge_Cuts)
            sh.SetWidth(mm(0.05))
            if "cx" in s:
                a0 = math.atan2(s["y1"] - s["cy"], s["x1"] - s["cx"])
                a1 = math.atan2(s["y2"] - s["cy"], s["x2"] - s["cx"])
                sweep = (a1 - a0) % (2 * math.pi) if not s["clockwise"] else -((a0 - a1) % (2 * math.pi))
                r = math.hypot(s["x1"] - s["cx"], s["y1"] - s["cy"])
                am = a0 + sweep / 2
                sh.SetShape(pcbnew.SHAPE_T_ARC)
                sh.SetArcGeometry(P(s["x1"], s["y1"]), P(s["cx"] + r * math.cos(am), s["cy"] + r * math.sin(am)), P(s["x2"], s["y2"]))
            else:
                sh.SetShape(pcbnew.SHAPE_T_SEGMENT)
                sh.SetStart(P(s["x1"], s["y1"]))
                sh.SetEnd(P(s["x2"], s["y2"]))
            b.Add(sh)
        # The marker the canary and the probes fire on, on a layer of its own (enabled, so the DRC sees it).
        marker = pcbnew.PCB_SHAPE(b)
        marker_layer = b.GetLayerID(MARKER)
        enabled = b.GetEnabledLayers()
        enabled.AddLayer(marker_layer)
        b.SetEnabledLayers(enabled)
        marker.SetLayer(marker_layer)
        marker.SetShape(pcbnew.SHAPE_T_SEGMENT)
        marker.SetWidth(mm(0.1))
        marker.SetStart(P(0, 0))
        marker.SetEnd(P(1, 0))
        b.Add(marker)

        shapes = {"circle": pcbnew.PAD_SHAPE_CIRCLE, "rect": pcbnew.PAD_SHAPE_RECT, "oval": pcbnew.PAD_SHAPE_OVAL}
        feet = {}

        def foot(ref):
            if ref not in feet:
                fp = pcbnew.FOOTPRINT(b)
                fp.SetReference(ref)
                fp.Reference().SetVisible(False)  # no legend: the rebuild has no silkscreen to check
                fp.Value().SetVisible(False)
                fp.SetPosition(P(0, 0))
                b.Add(fp)
                feet[ref] = fp
            return feet[ref]

        def place(pd, x, y):
            pd.SetPosition(P(x, y))
            if hasattr(pd, "SetFPRelativePosition"):
                pd.SetFPRelativePosition(P(x, y))
            elif hasattr(pd, "SetPos0"):
                pd.SetPos0(P(x, y))

        for p in data["pads"]:
            fp = foot(p["ref"])
            pd = pcbnew.PAD(fp)
            pd.SetNumber(p["num"])
            pd.SetShape(shapes[p["shape"]])
            pd.SetSize(pcbnew.VECTOR2I(mm(p["w"]), mm(p["h"])))
            if p["drill"]:
                pd.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
                pd.SetDrillSize(pcbnew.VECTOR2I(mm(p["drill"]), mm(p["drill"])))
                pd.SetLayerSet(pd.PTHMask())
            else:
                pd.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
                ls = pcbnew.LSET()
                front = p["layers"][0] == "F.Cu"
                ls.AddLayer(pcbnew.F_Cu if front else pcbnew.B_Cu)
                ls.AddLayer(pcbnew.F_Mask if front else pcbnew.B_Mask)
                pd.SetLayerSet(ls)
            place(pd, p["x"], p["y"])
            n = net(p["net"])
            if n:
                pd.SetNet(n)
            fp.Add(pd)
        for i, h in enumerate(data["npth"]):
            fp = foot("H")
            pd = pcbnew.PAD(fp)
            pd.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
            pd.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
            pd.SetSize(pcbnew.VECTOR2I(mm(h["d"]), mm(h["d"])))
            pd.SetDrillSize(pcbnew.VECTOR2I(mm(h["d"]), mm(h["d"])))
            pd.SetLayerSet(pd.UnplatedHoleMask())
            place(pd, h["x"], h["y"])
            fp.Add(pd)
        for v in data["vias"]:
            via = pcbnew.PCB_VIA(b)
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetPosition(P(v["x"], v["y"]))
            via.SetDrill(mm(v["drill"]))
            via.SetWidth(mm(v["dia"]))
            n = net(v["net"])
            if n:
                via.SetNet(n)
            b.Add(via)
        layer_id = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}
        for t in data["tracks"]:
            if "cx" in t:
                tr = pcbnew.PCB_ARC(b)
                a0 = math.atan2(t["y1"] - t["cy"], t["x1"] - t["cx"])
                a1 = math.atan2(t["y2"] - t["cy"], t["x2"] - t["cx"])
                sweep = (a1 - a0) % (2 * math.pi) if not t["clockwise"] else -((a0 - a1) % (2 * math.pi))
                r = math.hypot(t["x1"] - t["cx"], t["y1"] - t["cy"])
                tr.SetMid(P(t["cx"] + r * math.cos(a0 + sweep / 2), t["cy"] + r * math.sin(a0 + sweep / 2)))
            else:
                tr = pcbnew.PCB_TRACK(b)
            tr.SetStart(P(t["x1"], t["y1"]))
            tr.SetEnd(P(t["x2"], t["y2"]))
            tr.SetWidth(mm(t["width"]))
            tr.SetLayer(layer_id[t["layer"]])
            n = net(t["net"])
            if n:
                tr.SetNet(n)
            b.Add(tr)
        for z in data["pours"]:
            zone = pcbnew.ZONE(b)
            lid = layer_id[z["layer"]]
            zone.SetLayer(lid)
            n = net(z["net"])
            if n:
                zone.SetNet(n)
            zone.Outline().AddOutline(chain(z["outline"]))
            fill = pcbnew.SHAPE_POLY_SET()
            for poly in z["fill"]:
                i = fill.AddOutline(chain(poly["outline"]))
                for hole in poly["holes"]:
                    fill.AddHole(chain(hole), i)
            fill.Fracture(pcbnew.SHAPE_POLY_SET.PM_FAST)
            zone.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
            zone.SetLocalClearance(mm(rules.get("pourClearanceMm", rules["clearanceMm"])))
            zone.SetMinThickness(mm(0.01))
            zone.SetFilledPolysList(lid, fill)
            zone.SetIsFilled(True)
            zone.SetNeedRefill(False)
            b.Add(zone)

        ds = b.GetDesignSettings()
        ds.SetBoardThickness(mm(rules.get("thicknessMm", 1.6)))
        ds.m_MinClearance = mm(rules["clearanceMm"])
        ds.m_TrackMinWidth = mm(rules["trackMinMm"])
        ds.m_CopperEdgeClearance = mm(rules["edgeMm"])
        ds.m_HoleClearance = mm(rules["holeClearMm"])
        ds.m_HoleToHoleMin = mm(rules["holeGapMm"])
        ds.m_MinThroughDrill = mm(rules["drillMinMm"])
        ds.m_ViasMinAnnularWidth = mm(rules["viaRingMm"])
        ds.m_ViasMinSize = mm(rules["drillMinMm"] + 2 * rules["viaRingMm"])
        ds.m_SolderMaskExpansion = mm(rules.get("maskExpandMm", 0))
        ds.m_SolderMaskMinWidth = mm(rules.get("maskWebMm", 0))
        netclass = getattr(ds.m_NetSettings, "m_DefaultNetClass", None)
        if netclass is None:
            netclass = ds.m_NetSettings.GetDefaultNetclass()
        netclass.SetClearance(mm(rules["clearanceMm"]))
        return b

    def drc(data, rules, dru, d356=None):
        """Builds the board in a folder of its own, with the rule file beside it, and runs the DRC on it as loaded back
        from the file (as kicad-cli would)."""
        with tempfile.TemporaryDirectory(prefix="sprue-kicad-") as t:
            path = os.path.join(t, "b.kicad_pcb")
            pcbnew.SaveBoard(path, build(data, rules))
            if dru is not None:
                Path(t, "b.kicad_dru").write_text(dru)
            b = pcbnew.LoadBoard(path)
            filled = sum(z.GetFilledPolysList(z.GetLayer()).Area() for z in b.Zones()) / 1e12
            report = os.path.join(t, "b.rpt")
            loaded = pcbnew.WriteDRCReport(b, report, pcbnew.EDA_UNITS_MILLIMETRES, True)
            text = Path(report).read_text() if os.path.exists(report) else ""
            after = sum(z.GetFilledPolysList(z.GetLayer()).Area() for z in b.Zones()) / 1e12
            if d356:
                pcbnew.IPC356D_WRITER(b).Write(d356)
            return {"loaded": bool(loaded), "violations": parse_report(text), "fillMm2": round(filled, 3), "fillAfterMm2": round(after, 3)}

    results = {"kicad": pcbnew.Version(), "runs": []}
    for run in job["runs"]:
        try:
            r = drc(run["board"], run["rules"], run.get("dru"), run.get("d356"))
        except Exception as error:
            r = {"loaded": False, "violations": [], "error": f"{type(error).__name__}: {error}"}
        results["runs"].append({"id": run["id"], **r})
    Path(out_path).write_text(json.dumps(results))


def parse_report(text):
    """KiCad's DRC report (the text WriteDRCReport writes) as a list of violations: kind, what it says, the rule and
    severity, and the items it names with their places (y back up)."""
    out, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^\[(\w+)\]: (.*)$", line)
        if m:
            cur = {"kind": m[1], "text": m[2], "rule": "", "severity": "", "items": []}
            out.append(cur)
            continue
        if not cur:
            continue
        # "Rule: <name>; Severity: <s>", or "Local override; Severity: <s>" for a violation of no named rule (an open
        # net, a zone's own clearance, a short, holes in one place).
        m = re.match(r"^\s+(?:Rule: (.*?)|Local override); Severity: (\w+)", line)
        if m:
            cur["rule"], cur["severity"] = m[1] or "", m[2]
            continue
        m = re.match(r"^\s+Rule: (.*?);?\s*$", line)
        if m:
            cur["rule"] = m[1]
            continue
        m = re.match(r"^\s+Severity: (\w+)", line)
        if m:
            cur["severity"] = m[1]
            continue
        m = re.match(r"^\s+@\((-?[\d.]+) mm, (-?[\d.]+) mm\): (.*)$", line)
        if m:
            cur["items"].append({"x": float(m[1]), "y": -float(m[2]), "what": m[3]})
    return out


# ---- the first process: rule sets, the run, the self-test, the netlist diff ----

def kicad_pythons():
    """Where KiCad's Python may be, in the order tried."""
    yield from filter(None, [os.environ.get("SPRUE_KICAD_PYTHON"), sys.executable, shutil.which("python3"), "/usr/bin/python3"])
    yield "/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3"
    yield from sorted(glob.glob(r"C:\Program Files\KiCad\*\bin\python.exe"), reverse=True)


def find_kicad():
    """The first Python that imports pcbnew, and its KiCad version; or None and what was tried."""
    tried = []
    for py in dict.fromkeys(kicad_pythons()):
        if not py or not os.path.exists(py) and not shutil.which(py):
            continue
        try:
            r = subprocess.run([py, "-I", "-c", "import pcbnew; print(pcbnew.Version())"], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            tried.append(f"{py} ({type(error).__name__})")
            continue
        if r.returncode == 0 and r.stdout.strip():
            return py, r.stdout.strip().splitlines()[-1], tried
        tried.append(py)
    return None, None, tried


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def run_kicad(python, runs):
    """The runs, in KiCad's Python, in one process of their own."""
    with tempfile.TemporaryDirectory(prefix="sprue-kicad-job-") as t:
        job, out = Path(t, "job.json"), Path(t, "out.json")
        job.write_text(json.dumps({"runs": runs}))
        r = subprocess.run([python, "-I", __file__, "--pcbnew", str(job), str(out)], capture_output=True, text=True, timeout=1800)
        if r.returncode != 0 or not out.exists():
            tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
            raise RuntimeError(f"KiCad's Python stopped (exit status {r.returncode}): {' / '.join(tail) or 'no output'}")
        return json.loads(out.read_text())


def our_rules(board):
    r = board["rules"]
    return {k: r[k] for k in ("clearanceMm", "trackMinMm", "edgeMm", "holeClearMm", "holeGapMm", "drillMinMm", "viaRingMm", "maskExpandMm", "maskWebMm", "pourClearanceMm")} | {"trackMinMm": min(r["trackMinMm"], r["copperMinMm"])}


def judged(run, rule_set):
    """One rule set's run: its errors (violations of the copper KiCad calls errors), its warnings, and whether the rule
    file was loaded (its canary fired)."""
    v = run.get("violations", [])
    canary = [x for x in v if CANARY in x["rule"]]
    rest = [x for x in v if CANARY not in x["rule"]]
    counted = [x for x in rest if x["kind"] not in NOT_OURS]
    # An error unless KiCad calls it a warning: a severity the report words some other way (or not at all) fails.
    errors = [x for x in counted if not warning(x)]
    warns = [x for x in counted if warning(x)]
    file_loaded = bool(canary)
    if run.get("error"):
        status, note = "not run", run["error"]
    elif not run.get("loaded"):
        status, note = "not run", "KiCad could not load the rule file (it stops on a rule file it cannot parse)"
    elif file_loaded is False:
        status, note = "not run", "the canary rule did not fire, so the rule file was not loaded and its rules were not checked"
    else:
        status, note = ("fail" if errors else "pass"), ""
    return {
        "id": rule_set["id"], "title": rule_set["title"], "source": rule_set.get("source", ""), "ruleFile": rule_set.get("ruleFile"),
        "status": status, "note": note, "ruleFileLoaded": file_loaded, "canaryHits": len(canary), "loaded": run.get("loaded"),
        "errors": [describe(x) for x in errors], "warnings": [describe(x) for x in warns],
        "ignored": sorted({x["kind"] for x in rest if x["kind"] in NOT_OURS}),
        "fillMm2": run.get("fillMm2"), "fillAfterMm2": run.get("fillAfterMm2"),
    }


def warning(v):
    return v["severity"] == "warning"


def with_canary(dru):
    """A rule file with the canary appended; with no file of the fab's, a file of the canary alone. The canary says
    only that KiCad parsed the file: a rule in it whose condition does not compile is skipped without a word, which
    the probe run (probes()) is for."""
    return (dru.rstrip() if dru and dru.strip() else "(version 1)") + "\n" + CANARY_RULE


def sexpr(text):
    """A KiCad s-expression file (a rule file) as nested lists of atoms and strings, read the way KiCad 7's lexer
    reads it: a line whose first non-blank character is '#' is a comment. None when its brackets or quotes do not
    balance, since then which rules KiCad sees cannot be told."""
    text = "\n".join(line for line in text.split("\n") if not line.lstrip().startswith("#"))
    stack = [[]]
    for t in re.findall(r'\(|\)|"(?:[^"\\]|\\.)*"|"|[^\s()"]+', text):
        if t == "(":
            stack.append([])
        elif t == ")":
            if len(stack) == 1:
                return None
            done = stack.pop()
            stack[-1].append(done)
        elif t == '"':
            return None
        else:
            stack[-1].append(re.sub(r"\\(.)", r"\1", t[1:-1]) if t.startswith('"') else t)
    return stack[0] if len(stack) == 1 else None


def probes(dru):
    """A rule file of one probe for each rule of `dru` that has a condition: an assertion that fails on the marker
    when the condition or the marker's layer matches it, so it fires once when KiCad compiled the condition and is
    silent when KiCad skipped it. A rule given two conditions keeps the last, as in KiCad. Returns the file and the
    names of the rules, probe i being rule i, or (None, None) when the file cannot be read (see sexpr)."""
    items = sexpr(dru or "")
    if items is None:
        return None, None
    names, rules = [], []
    for item in items:
        if isinstance(item, list) and item[:1] == ["rule"] and len(item) > 1:
            conds = [c[1] for c in item[2:] if isinstance(c, list) and c[:1] == ["condition"] and len(c) > 1]
            cond = conds[-1] if conds else None
            if isinstance(cond, str):
                q = cond.replace("\\", "\\\\").replace('"', '\\"')
                rules.append(f'(rule "{PROBE} {len(names)}"\n\t(condition "({q}) || A.Layer == \'{MARKER}\'")\n\t(constraint assertion "A.Layer != \'{MARKER}\'"))')
                names.append(str(item[1]))
    return "(version 1)\n" + "\n".join(rules) + "\n", names


def skipped_rules(run, names):
    """The rules whose probe did not fire in a probe run: the ones KiCad skipped."""
    fired = {int(m[1]) for v in run.get("violations", []) if (m := re.match(rf"^{PROBE} (\d+)$", v["rule"]))}
    return [n for i, n in enumerate(names) if i not in fired]


def describe(v):
    where = "; ".join(f"{i['what']} at ({i['x']:.2f}, {i['y']:.2f})" for i in v["items"][:2])
    return f"[{v['kind']}] {v['text']}" + (f" ({v['rule']})" if v["rule"] else "") + (f": {where}" if where else "")


# How far apart in x or y two records of one net may be and still be one test point: a unit of a .d356 in inches
# (0.0001 in), since two writers may round one point either way (KiCad rounds half away from zero, our writer half up).
D356_TOL_MM = 0.00254 + 1e-6


def d356_diff(ours_path, kicad_path):
    """Our .d356 against KiCad's, record by record: each net's points in mm (a .d356 may be in inches), each of ours
    paired with the nearest of KiCad's left within D356_TOL_MM, read with gerbonara."""
    from gerbonara.ipc356 import Netlist
    from gerbonara.utils import MM

    def records(p):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            n = Netlist.open(p)
        out = {}
        for r in n.test_records:
            out.setdefault(r.net_name or "N/C", []).append((MM(r.x, r.unit), MM(r.y, r.unit)))
        return out

    a, b = records(ours_path), records(kicad_path)
    only_ours, only_kicad, matched = [], [], 0
    for net in sorted(set(a) | set(b)):
        left = sorted(b.get(net, []))
        for x, y in sorted(a.get(net, [])):
            near = [j for j, (u, v) in enumerate(left) if abs(u - x) <= D356_TOL_MM and abs(v - y) <= D356_TOL_MM]
            if near:
                left.pop(min(near, key=lambda j: math.hypot(left[j][0] - x, left[j][1] - y)))
                matched += 1
            else:
                only_ours.append((net, x, y))
        only_kicad += [(net, x, y) for x, y in left]
    fmt = lambda k: f"{k[0]} at ({k[1]:.3f}, {k[2]:.3f}) mm"
    return {"ours": sum(map(len, a.values())), "kicad": sum(map(len, b.values())), "matched": matched,
            "onlyOurs": [fmt(k) for k in only_ours[:10]], "onlyKicad": [fmt(k) for k in only_kicad[:10]],
            "ok": not only_ours and not only_kicad}


# ---- the self-test: faults put into copies of the rebuilt board ----

def faults(data):
    """Each fault: what it is, the board with it, the violation kinds that catch it, and where (a place or a net)."""
    out = []
    by_net = {}
    for p in data["pads"]:
        by_net.setdefault(p["net"], []).append(p)
    signal = sorted(n for n in by_net if n and not any(z["net"] == n for z in data["pours"]))
    # A track joining a pad of one net to the nearest pad of another, on that pad's layer.
    for n in signal:
        a = by_net[n][0]
        others = [p for p in data["pads"] if p["net"] and p["net"] != n and p["layers"][0] == a["layers"][0]]
        if not others:
            continue
        b = min(others, key=lambda p: math.hypot(p["x"] - a["x"], p["y"] - a["y"]))
        t = {"layer": a["layers"][0], "width": 0.3, "net": n, "x1": a["x"], "y1": a["y"], "x2": b["x"], "y2": b["y"]}
        out.append({"fault": f"a track joining {a['ref']}.{a['num']} ({n}) to {b['ref']}.{b['num']} ({b['net'] or 'no net'})",
                    "board": {**data, "tracks": data["tracks"] + [t]}, "kinds": ["shorting_items", "clearance", "tracks_crossing"],
                    "at": ((a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2), "reach": math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / 2 + NEAR_MM, "net": None})
        break
    # The longest track of a signal net whose removal cuts the net in two (a net routed twice, or as a loop, may have
    # none: then there is no such fault to put in).
    span = lambda t: math.hypot(t["x2"] - t["x1"], t["y2"] - t["y1"])
    whole = {}
    for t in sorted((t for t in data["tracks"] if t["net"] in signal), key=span, reverse=True):
        if t["net"] not in whole:
            items = copper_of(data, t["net"])
            whole[t["net"]] = (items, pad_pieces(items))
        items, pieces = whole[t["net"]]
        if pad_pieces([i for i in items if i[3] is not t]) > pieces:
            out.append({"fault": f"a {span(t):.1f} mm track of {t['net']} cut out",
                        "board": {**data, "tracks": [x for x in data["tracks"] if x is not t]}, "kinds": ["unconnected_items"],
                        "at": None, "reach": None, "net": t["net"]})
            break
    # The pour grown over a pad of another net.
    for zi, z in enumerate(data["pours"]):
        pads = [p for p in data["pads"] if z["layer"] in p["layers"] and p["net"] != z["net"]]
        if not pads:
            continue
        p = pads[0]
        r = math.hypot(p["w"], p["h"]) / 2 + 0.3
        square = [(p["x"] - r, p["y"] - r), (p["x"] + r, p["y"] - r), (p["x"] + r, p["y"] + r), (p["x"] - r, p["y"] + r)]
        grown = dict(z, fill=z["fill"] + [{"outline": square, "holes": []}])
        out.append({"fault": f"the {z['net'] or 'unnamed'} pour on {z['layer']} grown over {p['ref']}.{p['num']} ({p['net'] or 'no net'})",
                    "board": {**data, "pours": [grown if i == zi else x for i, x in enumerate(data["pours"])]},
                    "kinds": ["shorting_items", "clearance"], "at": (p["x"], p["y"]), "reach": r + NEAR_MM, "net": None})
        break
    # A track 0.1 mm from the board's edge, inside it.
    edge = max(data["outline"], key=lambda s: math.hypot(s["x2"] - s["x1"], s["y2"] - s["y1"]) if "cx" not in s else 0)
    length = math.hypot(edge["x2"] - edge["x1"], edge["y2"] - edge["y1"])
    if length > 4:
        ux, uy = (edge["x2"] - edge["x1"]) / length, (edge["y2"] - edge["y1"]) / length
        mx, my = (edge["x1"] + edge["x2"]) / 2, (edge["y1"] + edge["y2"]) / 2
        cx = sum(s["x1"] for s in data["outline"]) / len(data["outline"])
        cy = sum(s["y1"] for s in data["outline"]) / len(data["outline"])
        nx, ny = -uy, ux
        if (cx - mx) * nx + (cy - my) * ny < 0:
            nx, ny = -nx, -ny
        off = 0.1 + 0.15
        t = {"layer": "B.Cu", "width": 0.3, "net": "", "x1": mx - ux + nx * off, "y1": my - uy + ny * off, "x2": mx + ux + nx * off, "y2": my + uy + ny * off}
        out.append({"fault": f"a track 0.1 mm from the board edge at ({mx:.1f}, {my:.1f})", "board": {**data, "tracks": data["tracks"] + [t]},
                    "kinds": ["copper_edge_clearance"], "at": (mx, my), "reach": 1 + NEAR_MM, "net": None})
    return out


def copper_of(data, net):
    """A net's copper as items (layers, shape, is a pad, the track it is or None): its pads, vias and tracks."""
    from shapely.geometry import Point
    return [(set(p["layers"]), flash_shape(p), True, None) for p in data["pads"] if p["net"] == net] + \
           [(set(COPPER), Point(v["x"], v["y"]).buffer(v["dia"] / 2), False, None) for v in data["vias"] if v["net"] == net] + \
           [({t["layer"]}, track_shape(t), False, t) for t in data["tracks"] if t["net"] == net]


def pad_pieces(items):
    """How many pieces of copper with a pad on them the items make, joined where they meet on a layer."""
    parent = list(range(len(items)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i][0] & items[j][0] and items[i][1].intersects(items[j][1]):
                parent[root(i)] = root(j)
    return len({root(i) for i, item in enumerate(items) if item[2]})


def caught(fault, clean, got):
    """Whether a fault's run reports an error of one of its kinds (as judged() counts errors) that the clean run did
    not, where the fault is."""
    seen = {(v["kind"], v["text"], tuple((i["x"], i["y"]) for i in v["items"])) for v in clean}
    for v in got:
        if v["kind"] not in fault["kinds"] or warning(v) or (v["kind"], v["text"], tuple((i["x"], i["y"]) for i in v["items"])) in seen:
            continue
        if fault["net"] and any(f"[{fault['net']}]" in i["what"] for i in v["items"]):
            return describe(v)
        if fault["at"] and any(math.hypot(i["x"] - fault["at"][0], i["y"] - fault["at"][1]) <= fault["reach"] for i in v["items"]):
            return describe(v)
    return None


# ---- the check ----

def check(pcb, rule_sets, self_test):
    started = time.time()
    board = json.loads((pcb / "board.json").read_text())
    zip_data = (pcb / board["files"]["zip"]).read_bytes()
    report = {"inputs": board.get("inputs"), "slug": board["slug"], "ok": False, "status": "not run",
              "zip": {"name": board["files"]["zip"], "sha256": sha256(zip_data)}, "kicad": None, "tested": TESTED, "python": None,
              "errors": [], "ruleSets": [], "netlist": None, "selfTest": None}
    try:
        data = read_zip(pcb, board)
    except Unbuildable as error:
        report["errors"].append(f"the board cannot be rebuilt in KiCad from the zip: {error}")
        report["status"] = "fail"
        return report
    report["rebuilt"] = {"pads": len(data["pads"]), "vias": len(data["vias"]), "npth": len(data["npth"]), "tracks": len(data["tracks"]),
                         "pours": [{"layer": z["layer"], "net": z["net"], "touches": z["touches"]} for z in data["pours"]],
                         "outline": len(data["outline"])}
    for z in data["pours"]:
        if len(z["touches"]) > 1:
            report["errors"].append(f"the pour on {z['layer']} touches copper of {', '.join(z['touches'])}: it joins nets")
    # What the rebuild found stands without KiCad: a failure, not a check that did not run.
    stopped = "fail" if report["errors"] else "not run"
    python, version, tried = find_kicad()
    if not python:
        report["note"] = f"no Python with KiCad's pcbnew was found (tried {', '.join(tried) or 'nothing'}): install KiCad, or point SPRUE_KICAD_PYTHON at its Python"
        report["status"] = stopped
        return report
    report["kicad"], report["python"] = version, python
    rule_sets = rule_sets or [{"id": "ours", "title": "our rules (board.json)", "rules": our_rules(board), "dru": ""}]
    with tempfile.TemporaryDirectory(prefix="sprue-kicad-d356-") as t:
        d356 = os.path.join(t, "kicad.d356")
        runs = [{"id": s["id"], "board": data, "rules": s["rules"], "dru": with_canary(s.get("dru")),
                 **({"d356": d356} if i == 0 else {})} for i, s in enumerate(rule_sets)]
        # Each fab file's probe run, for the rules in it KiCad skips without a word. (A file of more than about 190
        # conditions would pass KiCad's limit of reports of one kind, and its last probes would read as skipped: a
        # partial check said, never a pass.)
        probed = {s["id"]: probes(s["dru"]) for s in rule_sets if (s.get("dru") or "").strip()}
        runs += [{"id": f"probe-{i}", "board": data, "rules": next(s for s in rule_sets if s["id"] == i)["rules"], "dru": with_canary(p[0])} for i, p in probed.items() if p[1]]
        fault_list = faults(data) if self_test else []
        runs += [{"id": f"fault{i}", "board": f["board"], "rules": rule_sets[0]["rules"], "dru": with_canary(rule_sets[0].get("dru"))} for i, f in enumerate(fault_list)]
        try:
            out = run_kicad(python, runs)
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            report["note"] = f"KiCad {version} did not finish the check: {error}"
            report["status"] = stopped
            return report
        by_id = {r["id"]: r for r in out["runs"]}
        report["ruleSets"] = [judged(by_id[s["id"]], s) for s in rule_sets]
        for rs in report["ruleSets"]:
            names = probed.get(rs["id"], ("", []))[1]
            if rs["status"] == "not run" or names == []:
                continue
            probe = by_id.get(f"probe-{rs['id']}", {})
            if names is None:
                rs["skippedRules"] = None
                rs["note"] = "the rule file's brackets or quotes do not balance as Sprue reads it, so its conditions were not probed and which of its rules KiCad compiled is not known"
            elif probe.get("error") or not probe.get("loaded") or not judged(probe, rs)["ruleFileLoaded"]:
                rs["skippedRules"] = None
                rs["note"] = "the probe of the rule file's conditions did not run, so which of its rules KiCad compiled is not known"
            else:
                rs["skippedRules"] = skipped_rules(probe, names)
                if rs["skippedRules"]:
                    rs["note"] = f"KiCad {version} skipped {len(rs['skippedRules'])} of the file's {len(names)} rules, whose conditions it could not compile: {', '.join(rs['skippedRules'][:5])}"
        if os.path.exists(d356):
            report["netlist"] = d356_diff(pcb / board["files"]["netlist"], d356)
        else:
            report["netlist"] = {"ok": False, "error": "KiCad wrote no IPC-D-356 netlist"}
    if self_test:
        clean = by_id[rule_sets[0]["id"]].get("violations", [])
        cases = []
        for i, f in enumerate(fault_list):
            r = by_id[f"fault{i}"]
            hit = caught(f, clean, r.get("violations", [])) if not r.get("error") else None
            cases.append({"fault": f["fault"], "expect": " or ".join(f["kinds"]), "ok": bool(hit), "got": hit or r.get("error") or "nothing new there"})
        # With no fault to put in, it did not run: not a pass, and not a miss either (`ran` says which).
        report["selfTest"] = {"ok": bool(cases) and all(c["ok"] for c in cases), "ran": bool(cases), "cases": cases}
    sets = report["ruleSets"]
    first = sets[0] if sets else None
    t = report["selfTest"]
    netlist_ok = bool(report["netlist"] and report["netlist"].get("ok"))
    if not first or first["status"] == "not run":
        # Said whether or not the rebuild's own errors already fail the check.
        report["note"] = f"KiCad's DRC with our rules did not run: {first['note'] if first else 'no rule set'}"
    if report["errors"]:
        report["status"] = "fail"
    elif not first or first["status"] == "not run":
        report["status"] = "not run"
    elif any(s["status"] == "fail" for s in sets) or not netlist_ok or (t and t["ran"] and not t["ok"]):
        report["status"] = "fail"
    elif any(s["status"] != "pass" or s.get("skippedRules", []) != [] for s in sets) or (t is not None and not t["ran"]):
        report["status"] = "partial"
    else:
        report["status"] = "pass"
    report["ok"] = report["status"] == "pass"
    report["seconds"] = round(time.time() - started, 1)
    return report


def main():
    if "--pcbnew" in sys.argv:
        i = sys.argv.index("--pcbnew")
        kicad_half(sys.argv[i + 1], sys.argv[i + 2])
        return
    if sys.argv[1:] == ["--find"]:
        python, version, tried = find_kicad()
        print(json.dumps({"python": python, "kicad": version, "tried": tried}))
        sys.exit(0 if python else 5)
    args, flags, rules_path = [], set(), None
    it = iter(sys.argv[1:])
    for a in it:
        if a == "--rules":
            rules_path = next(it, None)
        elif a.startswith("--"):
            flags.add(a)
        else:
            args.append(a)
    if len(args) != 1 or flags - {"--self-test"} or ("--rules" in sys.argv and not rules_path):
        print("usage: python3 -I kicad.py <product>/pcb [--rules <rules.json>] [--self-test]", file=sys.stderr)
        sys.exit(2)
    pcb = Path(args[0]).resolve()
    if not (pcb / "board.json").exists():
        print(f"no {pcb / 'board.json'}: run sprue pcb first", file=sys.stderr)
        sys.exit(2)
    board = json.loads((pcb / "board.json").read_text())
    for f in (board["files"]["zip"], board["files"]["netlist"]):
        if not (pcb / f).exists():
            print(f"no {pcb / f}: sprue pcb writes it only when its audit finds no errors", file=sys.stderr)
            sys.exit(2)
    rule_sets = json.loads(Path(rules_path).read_text())["ruleSets"] if rules_path else None
    report = check(pcb, rule_sets, "--self-test" in flags)
    (pcb / "kicad.json").write_text(json.dumps(report, indent=2) + "\n")
    b = report.get("rebuilt")
    if b:
        took = f", {report['seconds']} s" if "seconds" in report else ""
        print(f"KiCad check of {report['zip']['name']} (KiCad {report['kicad'] or 'not found'}{took}): rebuilt {b['pads']} pads, {b['vias']} vias, "
              f"{b['tracks']} tracks, {b['npth']} non-plated holes and {len(b['pours'])} pour{'s' if len(b['pours']) != 1 else ''}")
    else:
        print(f"KiCad check of {report['zip']['name']}: the rebuild stopped, so KiCad was not looked for")
    for e in report["errors"]:
        print(f"  ✗ {e}")
    for rs in report["ruleSets"]:
        mark = {"pass": "✓", "fail": "✗"}.get(rs["status"], "·")
        counts = f"{len(rs['errors'])} errors, {len(rs['warnings'])} warnings"
        print(f"  {mark} {rs['title']}: " + (rs["note"] if rs["status"] == "not run" else counts + (f"; {rs['note']}" if rs["note"] else "")))
        for e in rs["errors"][:5] + rs["warnings"][:3]:
            print(f"      {e}")
    n = report["netlist"]
    if n:
        print(f"  {'✓' if n.get('ok') else '✗'} netlist: " + (n.get("error") or f"{n['matched']} of {n['ours']} records of ours match KiCad's {n['kicad']}"
              + "".join(f"; ours only: {x}" for x in n["onlyOurs"][:3]) + "".join(f"; KiCad's only: {x}" for x in n["onlyKicad"][:3])))
    t = report["selfTest"]
    for c in (t or {}).get("cases", []):
        print(f"  {'✓' if c['ok'] else '✗'} self-test: {c['fault']}: {'caught, ' + c['got'] if c['ok'] else 'not caught (' + c['expect'] + ')'}")
    if t and not t["ran"]:
        print("  · self-test: no fault could be put into this board")
    if report.get("note"):
        print(f"  · {report['note']}")
    print(f"wrote {pcb / 'kicad.json'}: {report['status'].upper()}")
    sys.exit({"pass": 0, "partial": 0, "fail": 1}.get(report["status"], 5 if report["kicad"] is None else 6))


if __name__ == "__main__":
    main()
