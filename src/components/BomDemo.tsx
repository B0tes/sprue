"use client";

import { useEffect, useRef, useState } from "react";
import { bom, brief, modeHint, modeLabel, type QuoteMode } from "@/data/coffee-bom";

const modeClass: Record<QuoteMode, string> = {
  api: "text-api border-api/40 bg-api/10",
  scripted: "text-scripted border-scripted/40 bg-scripted/10",
  agent: "text-agent border-agent/40 bg-agent/10",
};

// Agent RFQs take longer than API calls, so they resolve last in the demo too.
const resolveOrder = [...bom].sort((a, b) => {
  const rank = { api: 0, scripted: 1, agent: 2 };
  return rank[a.mode] - rank[b.mode];
});

export function BomDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started || resolved >= bom.length) return;
    const next = resolveOrder[resolved];
    const wait = next.mode === "agent" ? 900 : next.mode === "scripted" ? 380 : 220;
    const t = setTimeout(() => setResolved((n) => n + 1), wait);
    return () => clearTimeout(t);
  }, [started, resolved]);

  const done = new Set(resolveOrder.slice(0, resolved).map((l) => l.id));
  const total = bom.filter((l) => done.has(l.id)).reduce((s, l) => s + l.unitUsd, 0);
  const lead = Math.max(0, ...bom.filter((l) => done.has(l.id)).map((l) => l.leadDays));
  const complete = resolved === bom.length;

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-rule bg-paper shadow-[0_1px_0_var(--rule),0_30px_60px_-30px_rgba(0,0,0,0.25)]">
      {/* Chat prompt */}
      <div className="border-b border-rule bg-paper-2/60 p-5 sm:p-6">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">You</div>
        <p className="max-w-2xl text-[17px] leading-relaxed">{brief}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          Anatomy 2.0 · bill of materials · qty 10
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(modeLabel) as QuoteMode[]).map((m) => (
            <span
              key={m}
              title={modeHint[m]}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${modeClass[m]}`}
            >
              {modeLabel[m]}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto px-2 pb-2 sm:px-3">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="font-mono text-[11px] uppercase tracking-wider text-muted">
              <th className="px-3 py-3 font-normal">#</th>
              <th className="px-3 py-3 font-normal">Part</th>
              <th className="px-3 py-3 font-normal">Process</th>
              <th className="px-3 py-3 font-normal">Supplier</th>
              <th className="px-3 py-3 font-normal">Quote</th>
              <th className="px-3 py-3 text-right font-normal">Lead</th>
              <th className="px-3 py-3 text-right font-normal">Unit</th>
            </tr>
          </thead>
          <tbody>
            {bom.map((l) => {
              const ok = done.has(l.id);
              return (
                <tr key={l.id} className="group">
                  <td className="border-t border-rule px-3 py-3 font-mono text-muted">{l.id}</td>
                  <td className="border-t border-rule px-3 py-3">
                    <div className="font-medium">{l.part}</div>
                    <div className="text-xs text-muted">{l.spec}</div>
                  </td>
                  <td className="border-t border-rule px-3 py-3 text-muted">{l.process}</td>
                  <td className="border-t border-rule px-3 py-3">{l.supplier}</td>
                  <td className="border-t border-rule px-3 py-3">
                    <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${modeClass[l.mode]}`}>
                      {modeLabel[l.mode]}
                    </span>
                  </td>
                  <td className="border-t border-rule px-3 py-3 text-right font-mono tabular-nums text-muted">
                    {ok ? `${l.leadDays}d` : "·"}
                  </td>
                  <td className="border-t border-rule px-3 py-3 text-right font-mono tabular-nums">
                    {ok ? (
                      `$${l.unitUsd.toFixed(2)}`
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        {l.mode === "agent" ? "awaiting RFQ" : "quoting"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 border-t border-rule bg-paper-2/60 p-5 sm:grid-cols-[1fr_auto] sm:items-end sm:p-6">
        <div className="text-sm text-muted">
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.18em]">Flagged for a human</div>
          <ul className="space-y-1">
            <li>Mains, water and heat in one box: plan for UL 1082 and FCC Part 15B before selling.</li>
            <li>Nothing here powers the 24V motor and 12V pump yet. Add a 24V, 100 W supply and a 12V buck converter.</li>
          </ul>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            {complete ? "Per unit, parts only" : `${resolved}/${bom.length} quoted`}
          </div>
          <div className="font-display text-5xl tabular-nums leading-none">${total.toFixed(2)}</div>
          <div className="mt-1 font-mono text-xs text-muted">longest lead {lead} days</div>
        </div>
      </div>
    </div>
  );
}
