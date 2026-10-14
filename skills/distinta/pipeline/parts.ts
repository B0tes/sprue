// `distinta bom <slug> [line]` before stage 2 has a quote: the lines of bom.json with their specs, no offers.
// Once quotes.json exists, explore.ts prints the BOM with every offer instead.

import { readJson } from "./io.ts";
import type { Bom, BomLine } from "./types.ts";

const spec = (l: BomLine) => Object.entries(l.spec).map(([k, v]) => `${k} ${v}`).join(", ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function printBomLines(slug: string, lineId?: string) {
  const bom = readJson<Bom>(slug, "bom.json");
  if (lineId) {
    const l = bom.lines.find((x) => x.id === lineId);
    if (!l) {
      console.error(`no line "${lineId}"; lines: ${bom.lines.map((x) => x.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${l.id}: ${l.name} · ${l.qtyPerUnit} per unit · ${l.process}${l.mpn ? ` · ${l.mpn}` : ""} · role ${l.role}`);
    for (const [k, v] of Object.entries(l.spec)) console.log(`  ${k}: ${v}`);
    if (l.file) console.log(`  file: ${l.file}`);
    if (l.notes) console.log(`  notes: ${l.notes}`);
    console.log("no offers yet: stage 2 (source) finds them once the design is accepted");
    return;
  }
  console.log(`products/${slug}: ${bom.lines.length} lines, ${bom.units} unit(s); no quote yet, so no offers or prices (stage 2)`);
  for (const [title, lines] of [["bought", bom.lines.filter((l) => l.process === "buy")], ["made", bom.lines.filter((l) => l.process !== "buy")]] as const) {
    if (!lines.length) continue;
    console.log(`  ${title}`);
    for (const l of lines)
      console.log(`    ${l.id.padEnd(7)} ${clip(l.name, 34).padEnd(34)} ${String(l.qtyPerUnit).padStart(3)} ×  ${l.process === "buy" ? "" : `${l.process} · `}${clip(spec(l), 60)}`);
  }
}
