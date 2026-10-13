"""Build every part in cad/parts and export STEP, STL and an SVG preview to cad/out/.

Run: pip install -r cad/requirements.txt && python cad/build.py [slug]
Each module in cad/parts must define `make()` returning a build123d Part. With a slug, only
modules named `<slug>_*.py` are built (that's what `npm run anatomy -- cad <slug>` does).
The SVG is an isometric line drawing with hidden lines removed, so it shows the real geometry.
"""

import importlib
import pathlib
import sys

from build123d import ExportSVG, LineType, Unit, export_step, export_stl

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out"
VIEW_FROM = (1, -1, 0.8)


def preview(part, svg_path: pathlib.Path) -> None:
    visible, hidden = part.project_to_viewport(VIEW_FROM)
    size = max(*part.bounding_box().size)
    svg = ExportSVG(unit=Unit.MM, scale=100 / size, line_weight=0.5)
    svg.add_layer("visible")
    svg.add_layer("hidden", line_color="gray", line_type=LineType.ISO_DOT)
    svg.add_shape(visible, layer="visible")
    svg.add_shape(hidden, layer="hidden")
    svg.write(str(svg_path))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    sys.path.insert(0, str(ROOT))
    pattern = f"{sys.argv[1]}_*.py" if len(sys.argv) > 1 else "*.py"
    for path in sorted((ROOT / "parts").glob(pattern)):
        if path.stem.startswith("_"):
            continue
        part = importlib.import_module(f"parts.{path.stem}").make()
        export_step(part, str(OUT / f"{path.stem}.step"))
        export_stl(part, str(OUT / f"{path.stem}.stl"))
        preview(part, OUT / f"{path.stem}.svg")
        bb = part.bounding_box().size
        print(f"built {path.stem}: {part.volume / 1000:.2f} cm3, {bb.X:.1f} x {bb.Y:.1f} x {bb.Z:.1f} mm")


if __name__ == "__main__":
    main()
