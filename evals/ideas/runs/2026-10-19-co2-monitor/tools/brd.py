"""Read an Eagle .brd (XML): outline, holes, elements with their package's holes/pads, in mm."""
import sys, math
import xml.etree.ElementTree as ET
t = ET.parse(sys.argv[1]).getroot()
board = t.find("drawing/board")
xs, ys = [], []
for w in board.findall("plain/wire"):
    if w.get("layer") == "20":
        for k in ("x1", "x2"): xs.append(float(w.get(k)))
        for k in ("y1", "y2"): ys.append(float(w.get(k)))
print("outline x", min(xs), max(xs), "y", min(ys), max(ys), "size", round(max(xs)-min(xs),3), round(max(ys)-min(ys),3))
for h in board.findall("plain/hole"):
    print("plain hole", h.attrib)
pk = {}
for lib in board.findall("libraries/library"):
    for p in lib.findall("packages/package"):
        pk[(lib.get("name"), p.get("name"))] = p
for e in board.findall("elements/element"):
    p = pk.get((e.get("library"), e.get("package")))
    x, y = float(e.get("x")), float(e.get("y"))
    rot = e.get("rot", "R0")
    info = []
    if p is not None:
        for h in p.findall("hole"): info.append(("hole", h.get("x"), h.get("y"), h.get("drill")))
        pads = p.findall("pad")
        if pads: info.append(("pads", len(pads), [(q.get("name"), q.get("x"), q.get("y"), q.get("drill")) for q in pads][:8]))
        smd = p.findall("smd")
        if smd and len(smd) < 12: info.append(("smd", [(q.get("name"), q.get("x"), q.get("y"), q.get("dx"), q.get("dy")) for q in smd]))
    print(e.get("name"), e.get("value"), e.get("package"), "at", x, y, rot, info[:3])
