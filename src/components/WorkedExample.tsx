"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { mount, usd } from "../../skills/distinta/viewer/explorer.js";
import "../../skills/distinta/viewer/explorer.css";
// The skill's figure runtime: a plain script that sets globalThis.mountFigure.
import "../../skills/distinta/viewer/figure.js";
import "../../skills/distinta/viewer/figure.css";
import type { Explorer as ExplorerData } from "../../skills/distinta/pipeline/explore.ts";
import type { Gate, RunView, StageId, TryIt } from "@/lib/example";

type FigureView = { destroy(): void; step(n: number): number; explode(on?: boolean): boolean; select(line: string | null): string | null };
type MountFigure = (
  root: Element,
  figure: unknown,
  lines: Record<string, { id: string; name: string; short?: string; process: string; qtyPerUnit: number; qtyPerBatch?: number }>,
  opts: Record<string, unknown>,
) => FigureView;

const STAGES: { id: StageId; n: number; label: string; sub: string }[] = [
  { id: "design", n: 1, label: "Design", sub: "the figure, the parts, the checks" },
  { id: "source", n: 2, label: "Source", sub: "every offer, and the quote" },
  { id: "build", n: 3, label: "Build", sub: "the steps and the order list" },
];

/** Text with `code` spans in backticks. */
function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function TryThis({ t }: { t: TryIt }) {
  const part =
    t.partDelta > 0 ? `costs ${usd(t.partDelta)} more` : t.partDelta < 0 ? `costs ${usd(-t.partDelta)} less` : "costs the same";
  const total =
    t.totalDelta > 0 ? `goes up ${usd(t.totalDelta)}` : t.totalDelta < 0 ? `goes down ${usd(-t.totalDelta)}` : "stays the same";
  // "and" when the total moves the same way as the part, "but" when shipping turns it around.
  const same = Math.sign(t.partDelta) === Math.sign(t.totalDelta);
  const why: string[] = [];
  if (t.moves?.length) why.push(`the requote buys the ${t.moves.join(" and the ")} there too`);
  if (t.leaves !== undefined) why.push(`${t.from} leaves the order, which saves its ${usd(t.leaves)} shipping`);
  if (t.joins !== undefined) why.push(`${t.to} adds ${usd(t.joins)} of shipping`);
  return (
    <p className="try">
      <strong>Try this.</strong> Open the <strong>{t.line}</strong> line and pick <strong>{t.to}</strong>. The part{" "}
      {part}, {same ? "and" : "but"} the total {total}, to {usd(t.newTotal)}
      {why.length ? `: ${why.join(", and ")}` : ""}. Reset puts the quote back.
    </p>
  );
}

/** The gate as Claude Code shows it: what Claude says, then the question (AskUserQuestion) with its options. */
function GateCard({ gate, slug, picked, onPick }: { gate: Gate; slug: string; picked: number | null; onPick: (i: number) => void }) {
  const [cursor, setCursor] = useState(0);
  const chosen = picked == null ? null : gate.options[picked];
  return (
    <figure className="cc" aria-label={`${gate.header}, as Claude Code shows it`}>
      <figcaption className="cc-bar">
        <span>Claude Code</span>
        <span className="cc-where">products/{slug} · {gate.header.toLowerCase()}</span>
      </figcaption>
      <div className="cc-body">
        <ul className="cc-says">
          {gate.says.map((s, i) => (
            <li key={i}>
              <Ticks text={s.text} />
              {s.items && (
                <ul>
                  {s.items.map((x, k) => (
                    <li key={k}>
                      <Ticks text={x} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="cc-ask" role="group" aria-labelledby={`cc-q-${slug}-${gate.n}`}>
          <p className="cc-chip">
            <span aria-hidden="true">☐</span> {gate.header}
          </p>
          <p className="cc-q" id={`cc-q-${slug}-${gate.n}`}>
            {gate.question}
          </p>
          <ol className="cc-opts" onMouseLeave={() => setCursor(picked ?? 0)}>
            {gate.options.map((o, i) => (
              <li key={o.label}>
                <button
                  type="button"
                  className="cc-opt"
                  aria-pressed={picked === i}
                  data-cursor={cursor === i ? "" : undefined}
                  onMouseEnter={() => setCursor(i)}
                  onFocus={() => setCursor(i)}
                  onClick={() => onPick(i)}
                >
                  <span className="cc-mark" aria-hidden="true">
                    {cursor === i ? "❯" : ""}
                  </span>
                  <span className="cc-n">{i + 1}.</span>
                  <span className="cc-l">{o.label}</span>
                  <span className="cc-d">
                    <Ticks text={o.does} />
                  </span>
                </button>
              </li>
            ))}
            <li className="cc-other" aria-hidden="true">
              <span className="cc-mark" />
              <span className="cc-n">{gate.options.length + 1}.</span>
              <span className="cc-l">Type something.</span>
            </li>
          </ol>
          <p className="cc-keys">{chosen ? "Pick another to compare." : "Pick an answer to see what Claude does next."}</p>
        </div>
        <div className="cc-reply" aria-live="polite">
          {chosen && (
            <>
              <p className="cc-you">
                <span aria-hidden="true">&gt;</span> {chosen.label}
              </p>
              {chosen.ran && (
                <div className="cc-ran">
                  <p>
                    <span className="cc-tool">Bash</span>({chosen.ran.cmd})
                  </p>
                  <pre>{chosen.ran.out}</pre>
                </div>
              )}
              <p>
                <Ticks text={chosen.reply} />
              </p>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}

/** What a run's files load into: the figure, the lines it names, and the explorer's data. Kept per page view. */
type Loaded = { svg: string; figure: unknown; ex: ExplorerData };
const cache = new Map<string, Promise<Loaded>>();
function load(run: RunView): Promise<Loaded> {
  let p = cache.get(run.slug);
  if (!p) {
    const get = (f: string) =>
      fetch(run.base + f).then((r) => {
        if (!r.ok) throw new Error(`${run.base}${f}: ${r.status}`);
        return r;
      });
    p = Promise.all([
      run.figure ? get("figure.svg").then((r) => r.text()) : Promise.resolve(""),
      run.figure ? get("figure.json").then((r) => r.json()) : Promise.resolve(null),
      get("explorer.json").then((r) => r.json() as Promise<ExplorerData>),
    ]).then(([svg, figure, ex]) => ({ svg, figure, ex }));
    p.catch(() => cache.delete(run.slug));
    cache.set(run.slug, p);
  }
  return p;
}

/** Our own pipeline wrote the svg, but it goes into the page: drawing elements only. */
const clean = (svg: string) =>
  svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href="(?!#)[^"]*"/gi, "");

/** One run: the figure card on the left, the stage on the right. Mounted again (key) when the run changes. */
function RunPane({ run, tab, children }: { run: RunView; tab: StageId; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let alive = true;
    let fig: FigureView | undefined;
    let ex: { destroy(): void } | undefined;
    load(run).then(
      (d) => {
        if (!alive) return;
        const app = appRef.current;
        const stage = stageRef.current;
        if (app) ex = mount(app, { ...d.ex, state: undefined, designMd: undefined }, { layout: "stages", headingLevel: 3, compact: true });
        const mountFigure = (globalThis as unknown as { mountFigure?: MountFigure }).mountFigure;
        if (stage && d.svg && d.figure && mountFigure) {
          stage.innerHTML = clean(d.svg);
          const lines = Object.fromEntries(
            d.ex.lines.map((l) => [l.id, { id: l.id, name: l.name, short: l.shortName, process: l.process, qtyPerUnit: l.qtyPerUnit, qtyPerBatch: l.qtyPerBatch }]),
          );
          // hash: false, because this page's hash is its sections; the keys work while the card is on screen.
          fig = mountFigure(stage, d.figure, lines, { keys: "document", legend: false, hash: false });
        }
        setState("ready");
      },
      () => alive && setState("failed"),
    );
    return () => {
      alive = false;
      fig?.destroy();
      ex?.destroy();
    };
  }, [run]);

  const f = run.figure;
  return (
    <div className="wx-grid">
      <div className="wx-figcol">
        {f ? (
          <section className="a2-figure wx-fig" data-a2-figure aria-label={`Figure 1, ${run.name}`}>
            <figure className="iso-figure">
              <div className="iso-plate">
                <div className="iso-plate-corners" aria-hidden="true">
                  <span className="iso-plate-corner" data-corner="fig">
                    Fig 1
                  </span>
                  <span className="iso-plate-corner" data-corner="title">
                    {f.title}
                  </span>
                  <span className="iso-plate-corner" data-corner="hint">
                    {f.hint}
                  </span>
                  <span className="iso-plate-corner" data-corner="readout" data-readout="">
                    {`assembled · ${f.parts} parts`}
                  </span>
                </div>
                <div ref={stageRef} className="iso-stage a2-stage" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
              </div>
            </figure>
            <div data-a2-controls="" />
          </section>
        ) : (
          <p className="wx-nofig">Fig 1 isn&apos;t drawn for this run yet.</p>
        )}
        {run.pageHref && (
          <p className="wx-pagelink">
            The same figure and stages, as the run wrote them:{" "}
            <a href={run.pageHref} target="_blank" rel="noopener">
              products/{run.slug}/view.html
            </a>
          </p>
        )}
      </div>
      <div className="wx-main">
        {children}
        {state === "loading" && (
          <p className="example-loading" role="status">
            Loading the run…
          </p>
        )}
        {state === "failed" && <p className="example-loading">The run&apos;s files didn&apos;t load. Reload the page to try again.</p>}
        <div ref={appRef} className="wx-app" data-show={tab} />
      </div>
    </div>
  );
}

/** The worked example: one run in its three stages, each ending at its gate, with the live figure beside them. */
export function WorkedExample({ runs }: { runs: RunView[] }) {
  const [which, setWhich] = useState(0);
  const [tab, setTab] = useState<StageId>("design");
  const [picked, setPicked] = useState<Record<string, number | null>>({});
  const [accepted, setAccepted] = useState<StageId[]>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const run = runs[which];
  const gate = run.gates.find((g) => g.stage === tab)!;
  const key = (slug: string, n: number) => `${slug}:${n}`;
  const previous = run.gates.find((g) => g.n === gate.n - 1);
  const previousPick = previous ? picked[key(run.slug, previous.n)] : null;
  const arrived = previous && previousPick != null && previous.options[previousPick]?.go === tab ? previous.options[previousPick] : null;

  /** Show a stage. After an answer at a gate, bring the new stage's top into view and put the focus on its heading. */
  function go(id: StageId, moved = false) {
    setTab(id);
    if (!moved) return;
    requestAnimationFrame(() => {
      const h = document.getElementById("wx-panel-h");
      if (!h) return;
      const top = h.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6)
        h.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      h.focus({ preventScroll: true });
    });
  }

  function pick(g: Gate, i: number) {
    setPicked((p) => ({ ...p, [key(run.slug, g.n)]: i }));
    const o = g.options[i];
    const accept = i === 0;
    setAccepted((a) => (accept ? [...new Set([...a, g.stage])] : a.filter((s) => s !== g.stage)));
    if (o.go) go(o.go, true);
  }

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const k = STAGES.findIndex((s) => s.id === tab);
    const next = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: STAGES.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const s = STAGES[(next + STAGES.length) % STAGES.length];
    go(s.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-stage="${s.id}"]`)?.focus();
  }

  const stage = STAGES.find((s) => s.id === tab)!;
  return (
    <div className="wx example">
      <div className="wx-head">
        <div className="wx-title">
          <p className="wx-kicker">
            products/{run.slug} · {run.units} {run.units === 1 ? "unit" : "units"} · {usd(run.total)}
          </p>
          <h3>{run.product}</h3>
          <p className="wx-brief">{run.brief}</p>
        </div>
        {runs.length > 1 && (
          <div className="wx-runs" role="group" aria-label="Which run">
            {runs.map((r, i) => (
              <button
                key={r.slug}
                type="button"
                aria-pressed={i === which}
                onClick={() => {
                  setWhich(i);
                  setAccepted([]);
                }}
              >
                {r.slug === "macropad" ? "Keypad" : r.name}
                <span>
                  {r.units} {r.units === 1 ? "unit" : "units"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wx-tabs" role="tablist" aria-label="Stages of the run" ref={tabsRef} onKeyDown={onTabKey}>
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`wx-tab-${s.id}`}
            aria-selected={s.id === tab}
            aria-controls="wx-panel"
            tabIndex={s.id === tab ? 0 : -1}
            data-stage={s.id}
            data-accepted={accepted.includes(s.id) ? "" : undefined}
            onClick={() => go(s.id)}
          >
            <span className="wx-tab-n">{s.n}</span>
            <span className="wx-tab-t">
              <span className="wx-tab-l">{s.label}</span>
              <span className="wx-tab-s">{s.sub}</span>
            </span>
            <span className="wx-tab-g">{accepted.includes(s.id) ? "✓ accepted" : `gate ${s.n}`}</span>
          </button>
        ))}
      </div>

      <RunPane key={run.slug} run={run} tab={tab}>
        <div className="wx-panel" role="tabpanel" id="wx-panel" aria-labelledby={`wx-tab-${tab}`}>
          <h3 className="wx-h" id="wx-panel-h" tabIndex={-1}>
            Stage {stage.n}: {stage.label}
          </h3>
          {arrived?.ran && (
            <div className="cc-arrived">
              <p>
                You accepted gate {previous!.n}. <span className="cc-tool">Bash</span>({arrived.ran.cmd})
              </p>
              <pre>{arrived.ran.out}</pre>
            </div>
          )}
          <p className="wx-intro">
            <Ticks text={run.intro[tab]} />
          </p>
          <GateCard
            key={`${run.slug}-${gate.n}`}
            gate={gate}
            slug={run.slug}
            picked={picked[key(run.slug, gate.n)] ?? null}
            onPick={(i) => pick(gate, i)}
          />
          <p className="wx-then">
            {tab === "design"
              ? "Under the gate, what the page shows for stage 1. Point at a part in the list to light it in Fig 1."
              : tab === "source"
                ? "Under the gate, what the page shows for stage 2. Point at a line to light it in Fig 1; open it for every offer."
                : "Under the gate, what the page shows for stage 3. Choose a step to show it in Fig 1."}
          </p>
          {tab === "source" && run.tryIt && <TryThis t={run.tryIt} />}
        </div>
      </RunPane>
      <p className="caption">
        <b>The run.</b> {run.caption}
      </p>
    </div>
  );
}
