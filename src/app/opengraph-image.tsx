import { ImageResponse } from "next/og";
import { EXAMPLE_SLUG, factsOf, figureArt, loadExample, usd } from "@/lib/example";

export const alt = "Anatomy 2.0: a one-line hardware idea taken to a design, a priced bill of materials and a build plan";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The share card is drawn without a stylesheet, so the kit's iso-* classes become plain fill and stroke
// attributes, in the light colours the site uses for the figure.
const C = {
  paper: "#ffffff",
  top: "#ffffff",
  shade: ["#dddad3", "#e5e2dc", "#edebe6", "#f5f3ef"],
  hi: "#1c1b18",
  mid: "#69655c",
  lo: "#b2aea5",
  faint: "#d6d2c9",
  lit: "#1c1b18",
  red: "#b42318",
  green: "#1e7a4b",
  blue: "#3e63dd",
};
const TONE: Record<string, string> = { hi: C.hi, mid: C.mid, lo: C.lo, faint: C.faint, lit: C.lit, red: C.red, green: C.green, blue: C.blue };

const DOTS: Record<string, number> = { hi: 0.85, mid: 0.45, lo: 0.22, faint: 0.12 };

function inlineStyles(svg: string): string {
  return svg
    .replace(/<path[^>]*class="iso-halo"[^>]*\/>/g, "")
    .replace(/<g class="iso-dots"(?: data-tone="(\w+)")?/g, (_, tone?: string) => `<g fill="${C.hi}" fill-opacity="${DOTS[tone ?? ""] ?? 0.32}"`)
    .replace(/<(path|circle|rect|ellipse|polygon|polyline|line)\b([^>]*?)(\/?)>/g, (all, tag: string, attrs: string, close: string) => {
      const cls = /\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? [];
      if (!cls.length) return all;
      const shade = /\sdata-shade="(\d)"/.exec(attrs)?.[1];
      const tone = /\sdata-tone="(\w+)"/.exec(attrs)?.[1];
      let paint = "";
      if (cls.includes("iso-line")) paint = `fill="none" stroke="${TONE[tone ?? "lo"] ?? C.lo}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"`;
      else if (cls.includes("iso-shade")) paint = `fill="${C.shade[Number(shade ?? 2)] ?? C.shade[2]}" stroke="none"`;
      else if (cls.includes("iso-top")) paint = `fill="${C.top}" stroke="none"`;
      else if (cls.includes("iso-fill")) paint = `fill="${C.paper}" stroke="none"`;
      else if (cls.includes("tb-body")) paint = `fill="${C.shade[2]}" stroke="none"`;
      else if (cls.includes("tb-shine")) paint = `fill="${C.top}" stroke="none"`;
      else if (cls.includes("tb-shade")) paint = `fill="${C.shade[0]}" stroke="none"`;
      else if (cls.includes("tb-ring")) paint = `fill="none" stroke="${TONE[tone ?? "lo"] ?? C.lo}" stroke-width="0.45"`;
      else if (cls.includes("iso-wire-end")) paint = `fill="${C.paper}" stroke="${C.lo}" stroke-width="0.9"`;
      else if (cls.includes("a2-ghost")) paint = `fill="none" stroke="none"`;
      else return all;
      return `<${tag}${attrs.replace(/\sclass="[^"]*"/, "")} ${paint}${close}>`;
    })
    .replace(/\sclass="iso-face-text"/g, ` fill="${C.mid}"`)
    .replace(/\sclass="[^"]*"/g, "");
}

export default async function Image() {
  const ex = await loadExample();
  const f = factsOf(ex);
  const art = figureArt(EXAMPLE_SLUG);
  let img: { src: string; width: number; height: number } | undefined;
  if (art) {
    const svg = inlineStyles(art.svg).replace(/<svg\b/, `<svg width="${art.width}" height="${art.height}"`);
    const scale = Math.min(500 / art.width, 470 / art.height);
    img = {
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      width: Math.round(art.width * scale),
      height: Math.round(art.height * scale),
    };
  }
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#fbfaf7",
          color: "#1c1b18",
          padding: "64px 64px 56px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 600, paddingRight: 24 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#b23d0e" }}>
              <div style={{ width: 18, height: 18, border: "3px solid #b23d0e", transform: "rotate(45deg)" }} />
              A Claude Code skill for hardware
            </div>
            <div style={{ fontSize: 88, lineHeight: 1.02, marginTop: 28, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>Anatomy 2.0</div>
            <div style={{ fontSize: 32, lineHeight: 1.35, marginTop: 24, color: "#3b3934", maxWidth: 560 }}>
              From a one-line idea to a design, a priced bill of materials and a build plan.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 24, color: "#69655c", lineHeight: 1.4 }}>
            <div style={{ display: "flex" }}>{`${f.product.split(",")[0]}: ${usd(f.total)} for ${f.units} ${f.units === 1 ? "unit" : "units"}`}</div>
            <div style={{ display: "flex" }}>{`${f.lines} BOM lines from ${f.shops} shops, shipping included`}</div>
          </div>
        </div>
        {img && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img src={img.src} width={img.width} height={img.height} />
          </div>
        )}
      </div>
    ),
    size,
  );
}
