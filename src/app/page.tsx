import { BomDemo } from "@/components/BomDemo";
import { ExplodedView } from "@/components/ExplodedView";
import { Waitlist } from "@/components/Waitlist";

const spine = [
  { n: "01", title: "Describe it", body: "Say what you want to build, in chat, the way you'd explain it to a friend." },
  { n: "02", title: "Design it", body: "An industrial design and parametric CAD, refined over a round or two." },
  { n: "03", title: "Take it apart", body: "Every part, board and screw becomes a line item with a real spec." },
  { n: "04", title: "Source it", body: "Each line is matched to suppliers with stock, price and lead time." },
  { n: "05", title: "Quote it", body: "Fabs that answer by API get called. The rest get an agent-written RFQ." },
  { n: "06", title: "Hand it over", body: "One priced package: BOM, files for each fab, quotes, and the open risks." },
];

const gradient = [
  { what: "Printed circuit boards", how: "A Gerber zip is the whole spec. Fab and assembly price on upload.", level: 5 },
  { what: "Electronic components", how: "Distributors expose stock and price-break APIs.", level: 5 },
  { what: "3D printed parts", how: "STL in, price out, across dozens of print shops.", level: 5 },
  { what: "CNC and sheet metal", how: "Instant quotes on the web, not by API. An agent uploads the STEP for you.", level: 3 },
  { what: "Off-the-shelf mechanisms", how: "Catalogs first, then an agent emails the OEM.", level: 2 },
  { what: "Injection molding", how: "No supplier quotes tooling by API yet.", level: 1 },
  { what: "Assembly and certification", how: "Flagged with a plan, not automated. Yet.", level: 0 },
];

const hard = [
  {
    title: "Picking parts is constraint solving",
    body: "Voltage, footprint, stock and budget all have to hold at once. Anatomy 2.0 checks each choice against the others and tells you which ones it isn't sure about.",
  },
  {
    title: "Integration is where physics shows up",
    body: "Twenty parts that each work can still overheat or not fit the case. Power budgets, clearances and thermal limits are checked across the whole build, not per line.",
  },
  {
    title: "Certification quietly kills hardware",
    body: "Anything with mains, water, heat or radios gets the standards it will need (UL, CE, FCC) flagged up front, before you spend on a single part.",
  },
];

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3.5 V8 M12 16 V20.5 M3.5 12 H8 M16 12 H20.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.2" fill="var(--accent)" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="overflow-x-hidden">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-rule/70 bg-paper/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <a href="#" className="flex items-center gap-2.5 font-medium tracking-tight">
            <Mark />
            Anatomy <span className="font-display text-xl italic leading-none">2.0</span>
          </a>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#how" className="hidden hover:text-ink sm:inline">How it works</a>
            <a href="#demo" className="hidden hover:text-ink sm:inline">Example</a>
            <a href="#join" className="rounded-full border border-ink/80 px-4 py-1.5 text-ink transition hover:bg-ink hover:text-paper">
              Early access
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="grid-paper pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-rule bg-paper px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              From idea to RFQ
            </p>
            <h1 className="font-display text-[56px] leading-[0.95] tracking-tight sm:text-[76px] lg:text-[88px]">
              Your hardware idea, <em className="text-accent">priced</em> to the last screw.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
              Describe a product in chat. Anatomy 2.0 designs it, takes it apart component by component,
              and pulls real quotes from the fabs and suppliers that answer by API. You end with a plan
              that holds up physically, and a number.
            </p>
            <div className="mt-9">
              <Waitlist />
              <p className="mt-3 pl-4 font-mono text-xs text-muted">
                For makers, founders and anyone with a garage and an idea.
              </p>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[560px]">
            <div className="absolute -left-2 top-0 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Fig. 1 · Single-cup brewer, exploded
            </div>
            <div className="pt-6">
              <ExplodedView />
            </div>
          </div>
        </div>
      </section>

      {/* Spine */}
      <section id="how" className="border-y border-rule bg-paper-2/50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
            <h2 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">
              AI made design nearly free. The hard part moved to atoms.
            </h2>
            <p className="max-w-sm text-muted">
              So we stop where the tedium is worst: between a finished design and a stack of quotes you can
              actually order from.
            </p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {spine.map((s) => (
              <li key={s.n} className="bg-paper p-6 sm:p-7">
                <div className="font-mono text-xs text-accent">{s.n}</div>
                <h3 className="mt-3 text-lg font-medium">{s.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Example</p>
          <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">One sentence in. Twelve quotes out.</h2>
          <p className="mt-4 text-muted">
            Here is the coffee machine from the drawing, priced for a ten-unit prototype run. Figures are
            illustrative today; each one becomes a live quote as its supplier integration ships.
          </p>
        </div>
        <BomDemo />
      </section>

      {/* Gradient */}
      <section className="border-t border-rule">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">The gradient</p>
            <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
              The closer a part is to a file, the faster it&apos;s priced.
            </h2>
            <p className="mt-5 max-w-md text-muted">
              A PCB is basically a file: send it, it ships back. That&apos;s why boards go first. Every
              other process sits somewhere on the same line, and the line moves a little every week.
            </p>
          </div>
          <ul className="divide-y divide-rule border-y border-rule">
            {gradient.map((g) => (
              <li key={g.what} className="grid grid-cols-[1fr_auto] items-center gap-6 py-4">
                <div>
                  <div className="font-medium">{g.what}</div>
                  <div className="text-sm text-muted">{g.how}</div>
                </div>
                <div className="flex gap-1" aria-label={`Automation readiness ${g.level} of 5`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      className={`h-5 w-2.5 rounded-sm ${i <= g.level ? "bg-accent" : "bg-rule"}`}
                      style={i <= g.level ? { opacity: 0.35 + i * 0.13 } : undefined}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Hard parts */}
      <section className="border-t border-rule bg-paper-2/50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Honest about the hard parts</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">
            A list of parts isn&apos;t a product. We check that it adds up.
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {hard.map((h, i) => (
              <div key={h.title} className="border-t border-ink pt-5">
                <div className="font-mono text-xs text-muted">0{i + 1}</div>
                <h3 className="mt-2 text-lg font-medium">{h.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="join" className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-5 py-20 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="max-w-2xl font-display text-5xl leading-[1.02] sm:text-6xl">
              What would you build if you knew <em className="text-accent">what it costs</em>?
            </h2>
            <p className="mt-5 max-w-lg text-paper/70">
              We&apos;re building this in the open, one integration a day. Join to get the first version and
              send us the idea you want priced.
            </p>
          </div>
          <Waitlist tone="inverse" />
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 font-mono text-xs text-muted sm:px-8">
          <span className="flex items-center gap-2">
            <Mark /> Anatomy 2.0
          </span>
          <span>A World idea lab project · 2026</span>
        </div>
      </footer>
    </main>
  );
}
