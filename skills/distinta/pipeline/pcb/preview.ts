// The SVG previews, drawn from the same lists the Gerbers are written from: the copper layer's items in order
// (the pour, its cut-outs in the board colour, then the copper), the pads left open in the mask, the clipped
// silkscreen, the drills and the outline. The bottom view is mirrored, as you see the board turned over, and
// says so in its title. Fills and strokes are plain attributes (no style, no ids), so the product page can inline it.

import { textStrokes } from "./font.ts";
import type { Fab } from "./layers.ts";
import type { BoardData, Item, Pt } from "./types.ts";

export type View = "top" | "bottom";

const COLOR = {
  paper: "#fbfbf8",
  board: "#eef1e6",
  pour: "#dcc7a3",
  copper: "#b3701d",
  pad: "#f0c24f",
  padEdge: "#6b4710",
  silk: "#20306a",
  hole: "#ffffff",
  ink: "#222222",
};

const f = (n: number) => String(Math.round(n * 1000) / 1000);
const pts = (list: Pt[]) => list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

export function previewSvg(data: BoardData, fab: Fab, view: View, name = `${data.slug} PCB`): string {
  const top = view === "top";
  const P = ([x, y]: Pt): Pt => [top ? x : -x, -y];
  const cu = fab.layers[top ? 0 : 1];
  const out: string[] = [];
  const W = data.width, H = data.height, m = 3, head = 7;
  const layer = top ? "F.Cu" : "B.Cu";

  // A paper-white ground, so the picture reads the same on a dark page as in a file viewer.
  out.push(`<rect x="${f(-W / 2 - m)}" y="${f(-H / 2 - m - head)}" width="${f(W + 2 * m)}" height="${f(H + 2 * m + head)}" fill="${COLOR.paper}"/>`);
  out.push(`<polygon points="${pts(data.outline.map(P))}" fill="${COLOR.board}"/>`);

  // The copper layer, item by item in file order. A clear item is painted in the board colour.
  const paint = (it: Item) => (it.pol === "D" ? null : COLOR.board);
  let run: { d: number; fill: string; segs: string[] } | undefined;
  const flush = () => {
    if (run) out.push(`<path d="${run.segs.join("")}" fill="none" stroke="${run.fill}" stroke-width="${f(run.d)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    run = undefined;
  };
  for (const it of cu.items) {
    const fill = paint(it) ?? COLOR.copper;
    if (it.op === "draw") {
      const [ax, ay] = P(it.a), [bx, by] = P(it.b);
      if (!run || run.d !== it.d || run.fill !== fill) {
        flush();
        run = { d: it.d, fill, segs: [] };
      }
      run.segs.push(`M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}`);
      continue;
    }
    flush();
    if (it.op === "region") out.push(`<polygon points="${pts(it.pts.map(P))}" fill="${paint(it) ?? COLOR.pour}"/>`);
    else {
      const [x, y] = P([it.x, it.y]);
      if (it.ap.kind === "C") out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(it.ap.d / 2)}" fill="${fill}"/>`);
      else {
        const { w, h } = it.ap, r = it.ap.kind === "O" ? Math.min(w, h) / 2 : 0;
        out.push(`<rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ""} fill="${fill}"/>`);
      }
    }
  }
  flush();

  // Pads that the mask leaves open.
  for (const p of data.pads.filter((p) => p.layers.includes(layer))) {
    const [x, y] = P([p.x, p.y]);
    const edge = `stroke="${COLOR.padEdge}" stroke-width="0.08"`;
    out.push(p.shape === "circle"
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(p.w / 2)}" fill="${COLOR.pad}" ${edge}/>`
      : `<rect x="${f(x - p.w / 2)}" y="${f(y - p.h / 2)}" width="${f(p.w)}" height="${f(p.h)}"${p.shape === "oval" ? ` rx="${f(Math.min(p.w, p.h) / 2)}"` : ""} fill="${COLOR.pad}" ${edge}/>`);
  }
  // Vias are tented: the copper ring shows through the mask, with its drill.
  for (const v of data.vias) {
    const [x, y] = P([v.x, v.y]);
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(v.dia / 2)}" fill="${COLOR.copper}" stroke="${COLOR.padEdge}" stroke-width="0.06"/>`,
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(v.drill / 2)}" fill="${COLOR.hole}" stroke="${COLOR.ink}" stroke-width="0.05"/>`);
  }
  // Pads with a plated hole, and the non-plated holes.
  for (const p of data.pads.filter((p) => p.drill)) {
    const [x, y] = P([p.x, p.y]);
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(p.drill! / 2)}" fill="${COLOR.hole}" stroke="${COLOR.ink}" stroke-width="0.06"/>`);
  }
  for (const h of data.holes) {
    const [x, y] = P([h.x, h.y]);
    out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(h.drill / 2)}" fill="${COLOR.hole}" stroke="${COLOR.ink}" stroke-width="0.1"/>`);
  }

  // The silkscreen is on the top only.
  if (top) {
    for (const s of fab.silk.strokes) {
      const d = s.pts.length < 2 ? `M${f(P(s.pts[0])[0])} ${f(P(s.pts[0])[1])}h0` : s.pts.map((p, i) => `${i ? "L" : "M"}${f(P(p)[0])} ${f(P(p)[1])}`).join("");
      out.push(`<path d="${d}" fill="none" stroke="${COLOR.silk}" stroke-width="${f(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    for (const d of fab.silk.dots) {
      const [x, y] = P([d.x, d.y]);
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(d.d / 2)}" fill="${COLOR.silk}"/>`);
    }
  } else {
    // Without silkscreen on the back, name the parts on it so the sockets can be told apart.
    for (const part of data.parts.filter((p) => p.side === "bottom")) {
      const [x, y] = P([part.x, part.y - 4.5]);
      out.push(...textStrokes(x, -y, part.ref, 1.6, 0.1).map((s) => stroke(s.pts.map(([px, py]) => [px, -py] as Pt), s.width, COLOR.ink)));
    }
  }

  out.push(`<polygon points="${pts(data.outline.map(P))}" fill="none" stroke="${COLOR.ink}" stroke-width="0.2" stroke-linejoin="round"/>`);

  const title = top ? "TOP" : "BOTTOM (MIRRORED)";
  for (const s of textStrokes(0, H / 2 + head / 2, title, 2.4, 0.1))
    out.push(stroke(s.pts.map(([x, y]) => [x, -y] as Pt), s.width, COLOR.ink));

  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const label = esc(name) + (top ? ", top: copper, pads open in the mask, silkscreen and drills" : ", bottom seen from below and mirrored: copper, pads open in the mask and drills");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-W / 2 - m)} ${f(-H / 2 - m - head)} ${f(W + 2 * m)} ${f(H + 2 * m + head)}" role="img" aria-label="${label}">\n` +
    `<title>${label}</title>\n${out.join("\n")}\n</svg>\n`;
}

function stroke(p: Pt[], width: number, color: string): string {
  const d = p.length < 2 ? `M${f(p[0][0])} ${f(p[0][1])}h0` : p.map((q, i) => `${i ? "L" : "M"}${f(q[0])} ${f(q[1])}`).join("");
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
