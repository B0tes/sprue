// Stage 6: the build plan a person orders and assembles from.

import type { Bom, Checks, Design, Quotes, Request } from "../types.ts";
import { usd } from "../io.ts";

const modeLabel: Record<string, string> = {
  api: "API quote",
  scripted: "Scripted (published rule)",
  agent: "Agent RFQ",
  snapshot: "Snapshot (price read from the product page)",
  estimate: "Estimate",
};

export function buildPlan(req: Request, design: Design, bom: Bom, checks: Checks, quotes: Quotes, steps: string[]) {
  const name = (id: string) =>
    id.startsWith("ship:") ? `Shipping (${id.slice(5)})` : bom.lines.find((l) => l.id === id)?.name ?? id;
  const rows = quotes.lines
    .map((q) => `| ${name(q.lineId)} | ${q.supplier} | ${q.sku} | ${q.orderQty} | ${usd(q.orderUsd)} | ${q.leadDays ? q.leadDays + " d" : "–"} | ${modeLabel[q.mode]} |`)
    .join("\n");
  const checkRows = checks.checks
    .map((c) => `| ${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚑"} | ${c.title} | ${c.detail} |`)
    .join("\n");
  return `# Build plan: ${req.product}

> ${req.brief}

**${req.units} unit${req.units > 1 ? "s" : ""} · ${usd(quotes.batchUsd)} all in (parts, fab, shipping) · longest lead ${quotes.longestLeadDays} days**
${req.budgetUsd ? `Budget ${usd(req.budgetUsd)}: ${quotes.batchUsd <= req.budgetUsd ? "within budget" : "OVER budget"}.` : ""}
${quotes.unquoted.length ? `\n**Not priced yet:** ${quotes.unquoted.map(name).join(", ")}\n` : ""}
## What it is
${design.summary}

## Order list
| Part | Supplier | What to order | Qty | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Engineer checks (${checks.failed} failed, ${checks.flagged} flagged)
| | Check | Result |
| --- | --- | --- |
${checkRows}

## Assembly
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Files
${bom.lines.filter((l) => l.file).map((l) => `- ${l.name}: \`${l.file}\``).join("\n")}
`;
}
