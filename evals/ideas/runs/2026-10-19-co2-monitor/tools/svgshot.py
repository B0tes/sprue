"""A crude rasteriser for a Sprue figure.svg, because `sprue shot` needs Chrome and none is installed here.

Fills the kit's paths in grey levels by class (no CSS, no text, no x-rays), honours clip paths and the a2-part
groups, and writes a PNG. Usage: python3 -I svgshot.py figure.svg out.png [rest|apart|step:N] [scale] [crop x,y,w,h]
"""
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

SRC, OUT = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else "rest"
K = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
CROP = [float(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 else None
root = ET.parse(SRC).getroot()
NS = "{http://www.w3.org/2000/svg}"
vb = [float(v) for v in root.get("viewBox").split()]
X0, Y0, VW, VH = CROP if CROP else vb
W, H = int(VW * K), int(VH * K)
img = bytearray(b"\xff" * (W * H * 3))
SHADE = {"0": 0x5a, "1": 0x8a, "2": 0xb0, "3": 0xd0}
TONE = {"lo": 0x22, "mid": 0x44, "hi": 0x00, "faint": 0xaa}
clips = {}


def subpaths(d, dx, dy):
    out, cur, x, y = [], [], 0.0, 0.0
    for cmd, args in re.findall(r"([MLHVZ])([^MLHVZ]*)", d):
        nums = [float(v) for v in re.findall(r"-?[\d.]+(?:e-?\d+)?", args)]
        if cmd == "M":
            if cur: out.append(cur)
            x, y = nums[0], nums[1]; cur = [(x, y)]
            for i in range(2, len(nums), 2): x, y = nums[i], nums[i + 1]; cur.append((x, y))
        elif cmd == "L":
            for i in range(0, len(nums), 2): x, y = nums[i], nums[i + 1]; cur.append((x, y))
        elif cmd == "H": x = nums[-1]; cur.append((x, y))
        elif cmd == "V": y = nums[-1]; cur.append((x, y))
        elif cmd == "Z" and cur: out.append(cur + ["Z"]); cur = []
    if cur: out.append(cur)
    return [[((px + dx - X0) * K, (py + dy - Y0) * K) for px, py in (q for q in s if q != "Z")] for s in out]


def spans(polys):
    """Even-odd spans per row over all the polygons given together: {row: [(x0, x1), ...]}."""
    rows = {}
    edges = [(p[i], p[(i + 1) % len(p)]) for p in polys if len(p) > 2 for i in range(len(p))]
    if not edges: return rows
    ys = [q[1] for e in edges for q in e]
    for r in range(max(0, int(min(ys))), min(H, int(max(ys)) + 1)):
        yc = r + 0.5
        xs = sorted(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) for a, b in edges if (a[1] <= yc) != (b[1] <= yc))
        rows[r] = [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]
    return rows


def mask_of(polys):
    m = bytearray(W * H)
    for r, ss in spans(polys).items():
        for a, b in ss:
            for c in range(max(0, int(a + 0.5)), min(W, int(b + 0.5))): m[r * W + c] = 1
    return m


def fill(polys, grey, mask, alpha=1.0):
    for poly in polys:  # nonzero per subpath, as the kit's paths need
        for r, ss in spans([poly]).items():
            for a, b in ss:
                for c in range(max(0, int(a + 0.5)), min(W, int(b + 0.5))):
                    if mask is None or mask[r * W + c]:
                        i = (r * W + c) * 3
                        img[i:i + 3] = bytes([int(img[i] * (1 - alpha) + grey * alpha)] * 3)


def stroke(polys, grey, mask, closed):
    for p in polys:
        pts = p + [p[0]] if closed and p else p
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            n = int(max(abs(bx - ax), abs(by - ay))) + 1
            for t in range(n + 1):
                c, r = int(ax + (bx - ax) * t / n), int(ay + (by - ay) * t / n)
                if 0 <= c < W and 0 <= r < H and (mask is None or mask[r * W + c]):
                    img[(r * W + c) * 3:(r * W + c) * 3 + 3] = bytes([grey] * 3)


def walk(el, dx, dy, mask):
    tag, cls = el.tag.replace(NS, ""), el.get("class", "")
    if tag == "clipPath":
        clips[el.get("id")] = el; return
    if "a2-part" in cls:
        if MODE.startswith("step:") and int(el.get("data-step")) > int(MODE[5:]): return
        if MODE == "apart": dx, dy = dx + float(el.get("data-dx")), dy + float(el.get("data-dy"))
    if el.get("clip-path"):
        cp = clips[re.search(r"#([^)]+)", el.get("clip-path")).group(1)]
        path = next(iter(cp))
        m2 = mask_of(subpaths(path.get("d"), dx, dy))  # even-odd, as the kit's evenodd clips need
        mask = m2 if mask is None else bytearray(a & b for a, b in zip(mask, m2))
    if tag == "path" and "a2-ghost" not in cls and el.get("data-dashed") is None:
        polys = subpaths(el.get("d", ""), dx, dy)
        if "iso-halo" in cls: fill(polys, 0xc8, mask, 0.5)
        elif "iso-fill" in cls: fill(polys, 0xff, mask)
        elif "iso-shade" in cls: fill(polys, SHADE.get(el.get("data-shade"), 0x80), mask)
        elif "iso-top" in cls: fill(polys, 0xf0, mask)
        elif "tb-body" in cls: fill(polys, 0x9a, mask)
        elif "iso-line" in cls and el.get("data-tone") != "lit":
            stroke(polys, TONE.get(el.get("data-tone"), 0x30), mask, "Z" in el.get("d", ""))
    if tag == "circle":
        cx, cy, r = (float(el.get(a)) for a in ("cx", "cy", "r"))
        fill([[((cx + dx - X0 + r * c) * K, (cy + dy - Y0 + r * s) * K) for c, s in ((1, 0), (0, 1), (-1, 0), (0, -1))]], 0x30, mask)
    for child in el: walk(child, dx, dy, mask)


walk(root, 0.0, 0.0, None)
raw = b"".join(b"\x00" + bytes(img[r * W * 3:(r + 1) * W * 3]) for r in range(H))
chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
open(OUT, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                      + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
print(OUT, W, H)
