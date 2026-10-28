// The build stage (stage 4): the build plan a person orders and assembles from.

import type { Bom, Checks, Design, QuoteLine, Quotes, Request } from "../types.ts";
import { usd } from "../io.ts";

const modeLabel: Record<string, string> = {
  api: "API quote",
  scripted: "Scripted (published rule)",
  agent: "Agent RFQ",
  snapshot: "Snapshot (price read from the product page)",
  estimate: "Estimate",
};

export type FigureStep = { n: number; text: string; lines: string[]; counts?: Record<string, number> };

/** What one figure step puts on, line by line: "4 × M3 x 8 mm screw". The count is the step's own (figure.json
 * counts), so a line used in two steps is split between them; a part's second half (count 0) is named without a
 * number. An older figure.json without counts gives qtyPerUnit for a line used in one step only. */
export function stepParts(step: FigureStep, all: FigureStep[], lines: { id: string; name: string; qtyPerUnit: number; qtyPerBatch?: number }[]) {
  return step.lines.map((id) => {
    const l = lines.find((x) => x.id === id);
    if (!l) return id;
    if (!l.qtyPerUnit && l.qtyPerBatch) return `${l.name} (${l.qtyPerBatch} for the batch)`;
    const once = all.filter((f) => f.lines.includes(id)).length === 1;
    const n = step.counts?.[id] ?? (once ? l.qtyPerUnit : 0);
    return n > 0 ? `${n} × ${l.name}` : l.name;
  });
}

/** `firmware`: the firmware files `sprue pcb` wrote for the board (firmware/code.py and README.md), listed under
 * Files. */
export function buildPlan(req: Request, design: Design, bom: Bom, checks: Checks, quotes: Quotes, steps: string[], figureSteps: FigureStep[] = [], firmware: string[] = []) {
  const name = (id: string) =>
    id.startsWith("ship:") ? `Shipping (${id.slice(5)})` : bom.lines.find((l) => l.id === id)?.name ?? id;
  // Packs are what goes in the cart; pieces are what the batch gets.
  const buy = (q: QuoteLine) => (q.packs ? `${q.packs} x pack of ${q.packSize} (${q.orderQty} pcs)` : `${q.orderQty}`);
  const how = (q: QuoteLine) => modeLabel[q.mode] + (q.basis.startsWith("unverified") ? " (unverified rate)" : "");
  // A shop whose parts ride in a fab's parcel was quoted with no shipping: say to check out with that fab.
  const together = (lines: QuoteLine[]) => [...new Set(lines.filter((q) => q.shipsWith).map((q) => `${q.supplier}|${q.shipsWith}`))]
    .map((k) => {
      const [shop, fab] = k.split("|");
      const parts = lines.filter((q) => q.supplier === shop && q.shipsWith === fab).map((q) => name(q.lineId));
      return `\n\n${shop} ships in the ${fab} parcel: order the ${parts.join(", ")} in the same checkout as the ${fab} order. Ordered on its own, ${shop} adds its own shipping, which this total leaves out.`;
    }).join("");
  const table = (lines: QuoteLine[]) => `| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
${lines.map((q) => `| ${name(q.lineId)} | ${q.supplier} | ${q.sku}${q.alternate ? ` (the alternate ${q.alternate.replaceAll("|", "\\|")}, not bom.json's part)` : ""} | ${q.needQty ?? "–"} | ${buy(q)} | ${usd(q.orderUsd)} | ${q.leadDays ? q.leadDays + " d" : "–"} | ${how(q)} |`).join("\n")}${together(lines)}`;
  // A first-article run (design.params.firstArticleUnits): order A builds a few units, order B the rest.
  const phases = quotes.phases ?? [];
  const both = phases.reduce((s, p) => s + p.batchUsd, 0);
  const phaseText = phases.length ? `
### Order in two phases
Order A buys enough for ${phases[0].units} unit(s) to build and measure first. Order B buys the rest of the batch and the spares, once the first units pass and any change to the design has been rerun. Two orders cost ${usd(both)}, ${usd(both - quotes.batchUsd)} more than one: shipping is paid twice, and packs and price breaks are split between the orders. Order A is in \`order-a.csv\` and order B in \`order-b.csv\`.

| Order | Builds | Cost | Longest lead |
| --- | --- | --- | --- |
${phases.map((p) => `| ${p.name} | ${p.units} unit(s)${p.name === "B" ? " and the spares" : ""} | ${usd(p.batchUsd)} | ${p.longestLeadDays} d |`).join("\n")}

#### Order A
${table(phases[0].lines)}

#### Order B
${table(phases[1].lines)}
` : "";
  const checkRows = checks.checks
    .map((c) => `| ${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚑"} | ${c.title} | ${c.detail} |`)
    .join("\n");
  return `# Build plan: ${req.product}

> ${req.brief}

**${req.units} unit${req.units > 1 ? "s" : ""} · ${usd(quotes.batchUsd)} for parts, fab and estimated shipping · longest lead ${quotes.longestLeadDays} days**
${req.budgetUsd ? `Budget ${usd(req.budgetUsd)}: ${quotes.batchUsd <= req.budgetUsd ? "within budget" : "OVER budget"}.` : ""}
${design.costNotes?.length ? `\n**Not in this total:**\n${design.costNotes.map((x) => `- ${x}`).join("\n")}\n` : ""}${quotes.unquoted.length ? `\n**Not priced yet:** ${quotes.unquoted.map(name).join(", ")}\n` : ""}
## What it is
${design.summary}

## Order list
The whole batch as one order. Need is pieces, spares included; Buy is what goes in the cart.

${table(quotes.lines)}
${phaseText}
## Engineer checks (${checks.failed} failed, ${checks.flagged} flagged)
| | Check | Result |
| --- | --- | --- |
${checkRows}

## Assembly
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
${figureSteps.length ? `
### What goes on at each step (from the figure)
Open \`view.html\` and walk the steps with ← → (or choose one under Build), or open \`view.html#step=<n>\` for one.

| Step | Do | Parts |
| --- | --- | --- |
${figureSteps.map((f, i) => `| ${i + 1} | ${f.text} | ${stepParts(f, figureSteps, bom.lines).join(", ")} |`).join("\n")}
` : ""}
## Files
In production/ these sit next to this plan; in the product folder they are at the paths shown.
${bom.lines.filter((l) => l.file).map((l) => `- ${l.name}: \`${l.file!.split("/").pop()}\` (\`${l.file}\`)`).join("\n")}
${firmware.length ? `- Firmware, to copy onto the Pico: ${firmware.map((f) => `\`${f}\``).join(" and ")}\n` : ""}`;
}
