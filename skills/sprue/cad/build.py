"""Build one product's CAD parts and export STEP, STL and an SVG preview.

Run: python3 build.py <product folder>   (what `sprue cad <slug>` does)
Each module in <product>/cad/ that doesn't start with "_" must define `make()` returning a
build123d Part. STEP and STL go to <product>/fab/, previews to <product>/previews/. The SVG is an
isometric line drawing with hidden lines removed, so it shows the real geometry. fab/build.json records what they
were built from (the sha256 of every cad/ file but _system.py and the board's code, and design.json's params), which
`sprue accept`, `package` and `score` compare to tell an export of an earlier design (score.ts exportStale).
"""

import hashlib
import importlib
import json
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


def inputs(product: pathlib.Path) -> dict:
    """sha256 of every file under cad/ but _system.py, the board's code (.mjs, .js, .ts: sprue pcb's, which keeps its
    own record), the caches and an editor's dotfiles and backups, by their paths in the product. design.json goes in
    as its params (main), the only part of it the parts read."""
    cad = product / "cad"
    files = [f for f in sorted(cad.rglob("*")) if f.is_file()
             and not {"__pycache__", "node_modules"} & set(f.relative_to(cad).parts)
             and not any(p.startswith(".") or p.endswith(("~", ".swp")) for p in f.relative_to(cad).parts)
             and f.relative_to(cad).as_posix() != "_system.py"
             and f.suffix not in {".mjs", ".js", ".ts"}]
    return {f.relative_to(product).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest() for f in files}


def main() -> None:
    product = pathlib.Path(sys.argv[1]).resolve()
    src = product / "cad"
    fab, previews = product / "fab", product / "previews"
    fab.mkdir(exist_ok=True)
    previews.mkdir(exist_ok=True)
    # What is exported is what was there when the export began.
    began = inputs(product)
    params = json.loads((product / "design.json").read_text()).get("params") if (product / "design.json").is_file() else None
    (fab / "build.json").unlink(missing_ok=True)  # until every part is out, nothing in fab/ is a whole export
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
    (fab / "build.json").write_text(json.dumps({"inputs": began, "params": params}, indent=2) + "\n")


if __name__ == "__main__":
    main()
