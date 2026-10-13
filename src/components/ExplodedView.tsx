import type { CSSProperties, ReactNode } from "react";
import { bom, type QuoteMode } from "@/data/coffee-bom";

// Stylized exploded view of the demo coffee machine. Each part is a group that
// starts pulled toward the middle and drifts out to its place on load.

type Part = {
  id: string;
  cy: number;
  edge: number; // x of the part's right edge, where the leader line starts
  draw: ReactNode;
};

const MID = 320;

const parts: Part[] = [
  {
    id: "01",
    cy: 62,
    edge: 248,
    draw: (
      <>
        <ellipse cx="200" cy="34" rx="52" ry="9" />
        <path d="M148 34 L163 90 M252 34 L237 90" />
        <ellipse cx="200" cy="90" rx="37" ry="7" />
        <path d="M172 52 Q200 60 228 52" className="opacity-40" />
      </>
    ),
  },
  {
    id: "02",
    cy: 126,
    edge: 242,
    draw: (
      <>
        <ellipse cx="200" cy="116" rx="40" ry="8" />
        <path d="M160 116 V136 M240 116 V136" />
        <path d="M160 136 A40 8 0 0 0 240 136" />
        <path d="M172 118 L178 132 M186 119 L190 134 M200 120 L200 135 M214 119 L210 134 M228 118 L222 132" className="opacity-50" />
      </>
    ),
  },
  {
    id: "03",
    cy: 178,
    edge: 230,
    draw: (
      <>
        <ellipse cx="200" cy="160" rx="28" ry="6" />
        <path d="M172 160 V196 M228 160 V196" />
        <path d="M172 196 A28 6 0 0 0 228 196" />
        <path d="M200 148 V160" />
        <path d="M178 172 H222 M178 180 H222" className="opacity-40" />
      </>
    ),
  },
  {
    id: "04",
    cy: 300,
    edge: 282,
    draw: (
      <>
        <rect x="118" y="222" width="164" height="156" rx="20" />
        <rect x="140" y="246" width="56" height="84" rx="10" className="opacity-60" />
        <circle cx="244" cy="262" r="10" />
        <path d="M232 296 H258 M232 306 H258" className="opacity-40" />
        <path d="M118 352 H282" className="opacity-40" />
      </>
    ),
  },
  {
    id: "06",
    cy: 414,
    edge: 270,
    draw: (
      <>
        <path d="M138 404 L258 404 L270 424 L150 424 Z" />
        <rect x="172" y="408" width="22" height="10" className="fill-current opacity-80" />
        <rect x="206" y="409" width="12" height="8" />
        <rect x="228" y="409" width="10" height="8" />
        <path d="M150 414 H166 M240 414 H256" className="opacity-50" />
      </>
    ),
  },
  {
    id: "05",
    cy: 472,
    edge: 236,
    draw: (
      <>
        <ellipse cx="200" cy="448" rx="34" ry="7" />
        <path d="M166 448 L172 494 M234 448 L228 494" />
        <path d="M172 494 A28 6 0 0 0 228 494" />
        <path d="M200 500 V510" />
      </>
    ),
  },
  {
    id: "09",
    cy: 532,
    edge: 254,
    draw: (
      <>
        <rect x="146" y="520" width="108" height="26" rx="4" />
        <path d="M158 520 V546 M170 520 V546 M182 520 V546 M194 520 V546 M206 520 V546 M218 520 V546 M230 520 V546 M242 520 V546" className="opacity-40" />
      </>
    ),
  },
  {
    id: "11",
    cy: 588,
    edge: 290,
    draw: (
      <>
        <path d="M110 576 L282 576 L292 596 L120 596 Z" />
        <path d="M128 586 H276" className="opacity-40" strokeDasharray="3 4" />
      </>
    ),
  },
];

const modeColor: Record<QuoteMode, string> = {
  api: "var(--api)",
  scripted: "var(--scripted)",
  agent: "var(--agent)",
};

export function ExplodedView() {
  return (
    <svg
      viewBox="0 0 600 630"
      className="h-auto w-full"
      role="img"
      aria-label="Exploded view of a single-cup coffee machine with each part labeled by supplier and price"
    >
      {/* Center axis */}
      <path d="M200 14 V616" stroke="var(--rule)" strokeDasharray="2 6" />

      {parts.map((p, i) => {
        const line = bom.find((b) => b.id === p.id)!;
        const from = { "--from": `${Math.round((MID - p.cy) * 0.6)}px` } as CSSProperties;
        const delay = { animationDelay: `${1.2 + i * 0.12}s` } as CSSProperties;
        return (
          <g key={p.id}>
            <g
              className="explode-part"
              style={from}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {p.draw}
            </g>
            <g className="callout" style={delay}>
              <path
                d={`M${p.edge + 6} ${p.cy} H360`}
                stroke="var(--muted)"
                strokeWidth="1"
                fill="none"
              />
              <circle cx={p.edge + 6} cy={p.cy} r="2.5" fill="var(--accent)" />
              <text x="370" y={p.cy - 3} className="fill-ink font-mono" fontSize="13">
                <tspan className="fill-muted">{p.id}</tspan>
                <tspan dx="8">{line.part}</tspan>
              </text>
              <circle cx="374" cy={p.cy + 13} r="3.5" fill={modeColor[line.mode]} />
              <text x="384" y={p.cy + 17} className="fill-muted font-mono" fontSize="11.5">
                {line.supplier} · ${line.unitUsd.toFixed(2)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
