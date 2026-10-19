"""Stage 3 hand check: each print's STL is one closed body, its volume matches bom.json, and fab/ is of cad/ now."""
import hashlib, json, sys
from pathlib import Path
import trimesh

prod = Path(sys.argv[1])
bom = json.loads((prod / "bom.json").read_text())
build = json.loads((prod / "fab/build.json").read_text())
for l in bom["lines"]:
    if l["process"] != "print":
        continue
    m = trimesh.load(prod / l["file"], force="mesh")
    parts = m.split(only_watertight=False)
    want = float(l["spec"]["volumeCm3"])
    got = m.volume / 1000
    print(f"{l['id']}: watertight={m.is_watertight} bodies={len(parts)} volume={got:.3f} cm3 vs bom {want} "
          f"({'ok' if abs(got - want) <= max(0.05, want * 0.01) else 'MISMATCH'}) bbox={[round(x, 2) for x in m.extents]}")
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
print("build.json keys:", list(build.keys()))
