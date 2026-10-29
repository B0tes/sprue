"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { mount, usd } from "../../skills/sprue/viewer/explorer.js";
import "../../skills/sprue/viewer/explorer.css";
// The skill's figure runtime: a plain script that sets globalThis.mountFigure.
import "../../skills/sprue/viewer/figure.js";
import "../../skills/sprue/viewer/figure.css";
// The 3D view, and Fig 1's tabs: it imports nothing, and three.js comes from public/vendor/three/ when the tab opens.
import { mountModel, mountTabs, threeFrom } from "../../skills/sprue/viewer/model.js";
import "../../skills/sprue/viewer/model.css";
import type { Explorer as ExplorerData } from "../../skills/sprue/pipeline/explore.ts";
import type { ModelView } from "../../skills/sprue/pipeline/model.ts";
import type { Gate, Ran, RunView, StageId, TryIt } from "@/lib/example";
import { siteModelView } from "@/lib/model-view";

type FigureView = { destroy(): void; step(n: number): number; explode(on?: boolean): boolean; select(line: string | null): string | null };
type MountFigure = (
  root: Element,
  figure: unknown,
  lines: Record<string, { id: string; name: string; short?: string; process: string; qtyPerUnit: number; qtyPerBatch?: number }>,
  opts: Record<string, unknown>,
) => FigureView;

/** `then` says what the page under the gate shows; `has`, what it has once the run's files are as new as Sprue (a run
 * whose page is older says so instead: RunView.under). */
const STAGES: { id: StageId; n: number; label: string; sub: string; then: string; has?: string }[] = [
  {
    id: "design",
    n: 1,
    label: "Design",
    sub: "the figure, the parts, the checks",
    then: "Under the gate, what the page shows for stage 1. Point at a part in the list to light it in Fig 1.",
  },
  {
    id: "inspect",
    n: 2,
    label: "Inspect",
    sub: "the parts together, as one product",
    then: "Under the gate, what the page shows for stage 2.",
    has: "It has the verdict, each gate of the whole product with its problems, stability, the function probes and the checks of the parts together.",
  },
  {
    id: "source",
    n: 3,
    label: "Source",
    sub: "every offer, and the quote",
    then: "Under the gate, what the page shows for stage 3. Point at a line to light it in Fig 1; open it for every offer.",
  },
  {
    id: "build",
    n: 4,
    label: "Build",
    sub: "the steps and the order list",
    then: "Under the gate, what the page shows for stage 4. Choose a step to show it in Fig 1.",
  },
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

/** A list Claude gives, with the rest of a long one folded. */
function Items({ items, more }: { items: string[]; more?: string[] }) {
  return (
    <>
      <ul>
        {items.map((x, k) => (
          <li key={k}>
            <Ticks text={x} />
          </li>
        ))}
      </ul>
      {more && (
        <details className="cc-more">
          <summary>{more.length} more</summary>
          <ul>
            {more.map((x, k) => (
              <li key={k}>
                <Ticks text={x} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** How many lines of a long output Claude Code shows before it folds the rest. */
const SHOWN = 2;

/** A command and what it printed, as Claude Code shows a Bash call: a refusal reads as one. `fold` shows the first few
 * lines and folds the rest, as Claude Code does for a long output. */
function Bash({ ran, refusal, fold = false }: { ran: Ran; refusal: string; fold?: boolean }) {
  const lines = ran.out.split("\n");
  const rest = fold && lines.length > SHOWN + 1 ? lines.slice(SHOWN) : [];
  return (
    <div className="cc-ran" data-refused={ran.ok ? undefined : ""}>
      <p>
        <span className="cc-tool">Bash</span>({ran.cmd})
      </p>
      <pre>
        {!ran.ok && <span className="cc-err">{`Error: ${refusal}\n`}</span>}
        {rest.length ? lines.slice(0, SHOWN).join("\n") : ran.out}
      </pre>
      {rest.length > 0 && (
        <details className="cc-more cc-out">
          <summary>+{rest.length} lines</summary>
          <pre>{rest.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

/** The gate as Claude Code shows it: the commands its stage ran, what Claude says, then the question (AskUserQuestion)
 * with its options. */
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
        {gate.ran?.map((r) => <Bash key={r.cmd} ran={r} refusal="it exited with an error" fold />)}
        <ul className="cc-says">
          {gate.says.map((s, i) => (
            <li key={i}>
              <Ticks text={s.text} />
              {s.items && <Items items={s.items} more={s.more} />}
            </li>
          ))}
        </ul>
        <div className="cc-ask" role="group" aria-labelledby={`cc-q-${slug}-${gate.n}`}>
          <p className="cc-chip">
            <span aria-hidden="true">☐</span> {gate.header}
            {gate.ahead ? " · not reached yet" : ""}
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
                  data-refused={o.accepts === false || (o.ran && !o.ran.ok) ? "" : undefined}
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
              {chosen.ran && <Bash ran={chosen.ran} refusal="it refused, so nothing was accepted" />}
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

/** three.js, from the vendored modules copy-figures puts in public/vendor/three/: once a page view, when a 3D tab
 * first opens. */
const THREE_BASE = "/vendor/three/";
let three: ReturnType<typeof threeFrom> | null = null;
function loadThree() {
  if (!three) {
    const text = (f: { file: string }) =>
      fetch(THREE_BASE + f.file).then((r) => {
        if (!r.ok) throw new Error(`${THREE_BASE}${f.file}: ${r.status}`);
        return r.text();
      });
    three = fetch(THREE_BASE + "vendor.json")
      .then((r) => {
        if (!r.ok) throw new Error(`${THREE_BASE}vendor.json: ${r.status}`);
        return r.json() as Promise<{ files: { file: string; name?: string; imports?: string[] }[] }>;
      })
      .then((v) => threeFrom(v.files, text as (f: object) => Promise<string>));
    three.catch(() => (three = null));
  }
  return three;
}

/** A run's model for the 3D tab: model.json (pipeline/model.ts modelView) and previews/system.glb. */
const models = new Map<string, Promise<{ view: ModelView; glb: ArrayBuffer }>>();
function loadModel(run: RunView) {
  let p = models.get(run.slug);
  if (!p) {
    const get = (f: string) =>
      fetch(run.base + f).then((r) => {
        if (!r.ok) throw new Error(`${run.base}${f}: ${r.status}`);
        return r;
      });
    p = Promise.all([get("model.json").then((r) => r.json() as Promise<ModelView>), get("system.glb").then((r) => r.arrayBuffer())]).then(
      ([view, glb]) => ({ view, glb }),
    );
    p.catch(() => models.delete(run.slug));
    models.set(run.slug, p);
  }
  return p;
}

/** Our own pipeline wrote the svg, but it goes into the page: drawing elements only. */
const clean = (svg: string) =>
  svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href="(?!#)[^"]*"/gi, "");

/** Where the reader was on this page when they left it, saved only while the run was on the page (so it is a position
 * in the whole page), for a reload or Back to put them back once the run is in again. Per tab; empty without storage. */
const PLACE = "sprue:place";
function savePlace() {
  try {
    sessionStorage.setItem(PLACE, JSON.stringify({ path: location.pathname, y: Math.round(scrollY) }));
  } catch {}
}
function savedPlace(): number | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PLACE) ?? "null") as { path?: string; y?: number } | null;
    return v && v.path === location.pathname && typeof v.y === "number" ? v.y : null;
  } catch {
    return null;
  }
}

/** One run: the figure card on the left, the stage on the right. Mounted again (key) when the run changes. */
function RunPane({ run, tab, children }: { run: RunView; tab: StageId; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  /** How to keep the reader's place while the run mounts (see the layout effect): the example's bottom in the window
   * when they were past it, or the place they left the page at. */
  const keep = useRef<{ wrap: Element; bottom: number } | { y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let fig: FigureView | undefined;
    let ex: { destroy(): void } | undefined;
    let tabs: { destroy(): void } | undefined;
    let model: { destroy(): void } | undefined;
    // Whether the reader has moved the page themselves since it loaded (see below).
    let moved = false;
    const MOVES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const onMove = () => (moved = true);
    MOVES.forEach((t) => addEventListener(t, onMove, { capture: true, passive: true }));
    let ready = false;
    const onHide = () => ready && savePlace();
    addEventListener("pagehide", onHide);
    const drawn = load(run).then(
      (d) => {
        if (!alive) return;
        const app = appRef.current;
        const stage = stageRef.current;
        // The run adds thousands of pixels to the example. A reader already past it (a link to #install, or
        // scrolling on before the files came) stays where they were. After a reload or Back they haven't moved from,
        // they go back to where they left: the browser's own guess, made before the run was in, lands short of it.
        const wrap = app?.closest(".example-wrap");
        const bottom = wrap?.getBoundingClientRect().bottom;
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const place = !moved && (nav?.type === "reload" || nav?.type === "back_forward") ? savedPlace() : null;
        keep.current =
          place !== null ? { y: place } : wrap && bottom !== undefined && bottom < innerHeight / 3 ? { wrap, bottom } : null;
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
        ready = true;
        setState("ready");
      },
      () => alive && setState("failed"),
    );
    // Fig 1's tabs work from the first paint: the 3D view is made the first time its tab opens, once the run's files
    // are in (so the drawing, when it mounted, is there to say where it is, and the view starts there).
    const section = sectionRef.current;
    const pane = modelRef.current;
    const m = run.model;
    if (section && pane && m) {
      let made: Promise<unknown> | null = null;
      const make = () =>
        (made ??= Promise.all([loadModel(run), loadThree(), drawn])
          .then(([{ view, glb }, t]) => {
            if (!alive) return;
            const under = section.querySelector('[data-a2-model="under"]') ?? undefined;
            model = mountModel(pane, siteModelView(view, m.current), glb, t, {
              readout: section.querySelector('[data-a2-readout="3d"]') ?? false,
              controls: under,
              legend: under,
              panel: under,
              title: run.name,
              headingLevel: 4,
              hash: false,
              fileHref: (path: string) => m.files + path.split("/").map(encodeURIComponent).join("/"),
            });
          })
          .catch((error: unknown) => {
            if (!alive) return;
            made = null;
            const why = document.createElement("p");
            why.className = "a2-model-wait";
            why.textContent = `The 3D view didn't load (${error instanceof Error ? error.message : String(error)}). The drawing shows the product.`;
            pane.replaceChildren(why);
          }));
      tabs = mountTabs(section, { remember: "sprue:fig1", onShow: (name: string) => name === "3d" && void make() });
    }
    return () => {
      alive = false;
      MOVES.forEach((t) => removeEventListener(t, onMove, { capture: true }));
      removeEventListener("pagehide", onHide);
      tabs?.destroy();
      model?.destroy();
      fig?.destroy();
      ex?.destroy();
    };
  }, [run]);

  // Once the run is on the page: back to where the reader left, or scroll by however much the example grew above a
  // reader who was past it (measured in the window, so if the browser's scroll anchoring already kept the place this
  // moves nothing).
  useLayoutEffect(() => {
    if (state === "loading") return;
    const k = keep.current;
    keep.current = null;
    if (k && "y" in k) {
      if (Math.abs(scrollY - k.y) >= 1) window.scrollTo({ top: k.y, behavior: "instant" });
    } else if (k) {
      const grew = k.wrap.getBoundingClientRect().bottom - k.bottom;
      if (Math.abs(grew) >= 1) window.scrollBy({ top: grew, behavior: "instant" });
    }
    // From now on the page's height holds still, so in-page links may scroll smoothly (globals.css, html[data-smooth]).
    document.documentElement.dataset.smooth = "";
  }, [state]);

  const f = run.figure;
  // With a model, Fig 1 has a Drawing and a 3D tab in one card (model.js mountTabs, which owns aria-selected, tabIndex
  // and hidden from then on: their props here never change, so React leaves them).
  const m = f && run.model;
  const id = `fig1-${run.slug}`;
  const pane = (name: string) => (m ? { "data-a2-pane": name } : {});
  return (
    <div className="wx-grid">
      <div className="wx-figcol">
        {f ? (
          <section ref={sectionRef} className="a2-figure wx-fig" data-a2-figure aria-label={`Figure 1, ${run.name}`}>
            {m && (
              <div className="a2-tabs" role="tablist" aria-label="Fig 1">
                <button type="button" className="a2-btn a2-tab" role="tab" id={`${id}-tab-drawing`} data-a2-tab="drawing" aria-controls={`${id}-drawing`} aria-selected="true">
                  Drawing
                </button>
                <button type="button" className="a2-btn a2-tab" role="tab" id={`${id}-tab-3d`} data-a2-tab="3d" aria-controls={`${id}-3d`} aria-selected="false" tabIndex={-1}>
                  3D
                </button>
              </div>
            )}
            <figure className="iso-figure">
              <div className="iso-plate">
                <div className="iso-plate-corners" aria-hidden="true">
                  <span className="iso-plate-corner" data-corner="fig">
                    Fig 1
                  </span>
                  <span className="iso-plate-corner" data-corner="title">
                    {f.title}
                  </span>
                  <span className="iso-plate-corner" data-corner="hint" {...pane("drawing")}>
                    {f.hint}
                  </span>
                  <span className="iso-plate-corner" data-corner="readout" data-readout="" {...pane("drawing")}>
                    {`assembled · ${f.parts} parts`}
                  </span>
                  {m && (
                    <span className="iso-plate-corner" data-corner="readout" data-a2-readout="3d" data-a2-pane="3d" hidden>
                      3D
                    </span>
                  )}
                </div>
                <div id={`${id}-drawing`} role={m ? "tabpanel" : undefined} aria-labelledby={m ? `${id}-tab-drawing` : undefined} {...pane("drawing")}>
                  <div ref={stageRef} className="iso-stage a2-stage" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                </div>
                {m && (
                  <div id={`${id}-3d`} role="tabpanel" aria-labelledby={`${id}-tab-3d`} data-a2-pane="3d" hidden>
                    <div ref={modelRef} className="a2-model-pane" style={{ "--a2-aspect": `${f.width} / ${f.height}` } as CSSProperties} />
                  </div>
                )}
              </div>
            </figure>
            <div data-a2-controls="" {...pane("drawing")} />
            {m && <div className="a2-model-under" data-a2-model="under" data-a2-pane="3d" hidden />}
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

/** The worked example: one run in its four stages, each ending at its gate, with the live figure beside them. */
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

  /** An accept that goes through marks its stage and moves on; any other answer, a refused accept too, takes the mark
   * back and stays at the gate. */
  function pick(g: Gate, i: number) {
    setPicked((p) => ({ ...p, [key(run.slug, g.n)]: i }));
    const o = g.options[i];
    setAccepted((a) => (o.accepts ? [...new Set([...a, g.stage])] : a.filter((s) => s !== g.stage)));
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
          {gate.ahead && (
            <p className="wx-ahead">
              <Ticks text={gate.ahead} />
            </p>
          )}
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
            {stage.then} <Ticks text={run.under?.[tab] ?? stage.has ?? ""} />
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
