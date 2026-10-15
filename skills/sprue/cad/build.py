"""Build one product's CAD parts and export STEP, STL and an SVG preview.

Run: python3 build.py <product folder>   (what `sprue cad <slug>` does)
Each module in <product>/cad/ that doesn't start with "_" must define `make()` returning a
build123d Part. STEP and STL go to <product>/fab/, previews to <product>/previews/. The SVG is an
isometric line drawing with hidden lines removed, so it shows the real geometry.
"""

import importlib
import pathlib
import sys

from build123d import ExportSVG, LineType, Unit, export_step, export_stl

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
    product = pathlib.Path(sys.argv[1]).resolve()
    src = product / "cad"
    fab, previews = product / "fab", product / "previews"
    fab.mkdir(exist_ok=True)
    previews.mkdir(exist_ok=True)
    sys.path.insert(0, str(src))
    for path in sorted(src.glob("*.py")):
        if path.stem.startswith("_"):
            continue
        part = importlib.import_module(path.stem).make()
        export_step(part, str(fab / f"{path.stem}.step"))
        export_stl(part, str(fab / f"{path.stem}.stl"))
        preview(part, previews / f"{path.stem}.svg")
        bb = part.bounding_box().size
        print(f"built {path.stem}: {part.volume / 1000:.2f} cm3, {bb.X:.1f} x {bb.Y:.1f} x {bb.Z:.1f} mm")


if __name__ == "__main__":
    main()
