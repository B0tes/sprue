import type { ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Code, Prompts } from "@/components/Code";
import { Cmd } from "@/components/Cmd";
import { Explorer } from "@/components/Explorer";
import { InstallLine } from "@/components/InstallLine";
import {
  EXAMPLE_COPY,
  EXAMPLE_SLUG,
  KEYPAD_SLUG,
  cliOutput,
  factsOf,
  figureArt,
  finishedRuns,
  loadExample,
  loadRun,
  tryIt,
  usd,
  type TryIt,
} from "@/lib/example";
import { ANATOMY, BUILD123D, GITHUB, REPO_PUBLIC, SITE } from "@/lib/site";
// Anatomy's drawing kit styles the stage 1 figure; the site sets its colours (.fig-art in globals.css).
import "../../skills/anatomy-2/kit/iso.css";

const SECTIONS = [
  { id: "run", n: "01", title: "How a run works" },
  { id: "example", n: "02", title: "A worked example" },
  { id: "install", n: "03", title: "Install" },
  { id: "commands", n: "04", title: "Commands" },
  { id: "prices", n: "05", title: "How prices are found" },
  { id: "history", n: "06", title: "How we got here" },
  { id: "limits", n: "07", title: "Limits" },
  { id: "questions", n: "08", title: "Questions" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const NOTES: { id: string; body: ReactNode }[] = [
  {
    id: "same-price",
    body: (
      <>
        Offers are saved in the product folder (<code>catalog.json</code>), so a rerun reads the same ones. A live API
        run reads new offers, and <code>/anatomy-2 diff</code> shows what moved.
      </>
    ),
  },
  {
    id: "band",
    body: (
      <>
        The answer key is two open keypads:{" "}
        <a href="https://github.com/jaysongiroux/pico-macro-pad">jaysongiroux/pico-macro-pad</a> (a Pico wired
        straight to the keys) and <a href="https://github.com/jboucly/macropad-3x3">jboucly/macropad-3x3</a> (PCB,
        printed case, M3 inserts). The $55 to $80 band is one build bought retail in the US: about $31 of parts, plus
        shipping from four or five shops, full packs and a print minimum. Cost is scored against the middle, $67.50.
      </>
    ),
  },
  {
    id: "search",
    body: <>Above 20 shops it starts from all of them and drops one at a time while the total keeps falling.</>,
  },
  {
    id: "rates",
    body: (
      <>
        Each rule in the skill&apos;s <code>pipeline/rates.json</code> carries its source, the date it was read and
        whether it was checked. OSH Park&apos;s is checked. JLCPCB&apos;s is not, and neither is its $15 shipping. The
        print rate is marked not checked: it was set from one third-party Craftcloud quote (all3dp, June 2026), not
        read from a price list.
      </>
    ),
  },
];

function Fn({ id }: { id: string }) {
  const n = NOTES.findIndex((x) => x.id === id) + 1;
  return (
    <sup className="fn" id={`ref-${id}`}>
      <a href={`#note-${id}`} aria-label={`Note ${n}`}>
        {n}
      </a>
    </sup>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.id === id)!;
  return (
    <section id={id} className="sec flow" aria-labelledby={`${id}-h`}>
      <header>
        <span className="sec-n" aria-hidden="true">
          {s.n}
        </span>
        <h2 id={`${id}-h`}>{s.title}</h2>
      </header>
      {children}
    </section>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.4" y="3.4" width="9.2" height="9.2" transform="rotate(45 8 8)" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

function Who({ kind }: { kind: "claude" | "code" | "both" }) {
  const label = { claude: "Claude", code: "Code", both: "Claude + code" }[kind];
  return <span className={`who who-${kind}`}>{label}</span>;
}

const pct = (n: number) => `${Math.round(n)}%`;
const countWord = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);

function TryThis({ t }: { t: TryIt }) {
  const part =
    t.partDelta > 0 ? `costs ${usd(t.partDelta)} more` : t.partDelta < 0 ? `costs ${usd(-t.partDelta)} less` : "costs the same";
  const total =
    t.totalDelta > 0 ? `goes up ${usd(t.totalDelta)}` : t.totalDelta < 0 ? `goes down ${usd(-t.totalDelta)}` : "stays the same";
  // "and" when the total moves the same way as the part, "but" when shipping turns it around.
  const same = Math.sign(t.partDelta) === Math.sign(t.totalDelta);
  const why: string[] = [];
  if (t.leaves !== undefined) why.push(`${t.from} leaves the order, which saves its ${usd(t.leaves)} shipping`);
  if (t.joins !== undefined) why.push(`${t.to} adds ${usd(t.joins)} of its own`);
  return (
    <p className="try">
      <strong>Try this.</strong> Open the <strong>{t.line}</strong> line and pick <strong>{t.to}</strong>. The part{" "}
      {part}, {same ? "and" : "but"} the total {total}, to {usd(t.newTotal)}
      {why.length ? `: ${why.join(", and ")}` : ""}. Reset puts the quote back.
    </p>
  );
}

const STAGES: { n: string; stage: string; gives: ReactNode; steps: string; gate: string }[] = [
  {
    n: "1",
    stage: "Design",
    gives: (
      <>
        The real numbers, the CAD, every part in a bill of materials, the engineer checks, and{" "}
        <code>figure.html</code>: an interactive drawing of the product
      </>
    ),
    steps: "0 to 3",
    gate: "Accept and source it, edit it, or decline it",
  },
  {
    n: "2",
    stage: "Source",
    gives: (
      <>
        Offers read from supplier pages, live DigiKey prices when you have keys, and a quote that rounds up to packs
        and counts shipping once per shop, in <code>view.html</code>
      </>
    ),
    steps: "4 and 5",
    gate: "Accept and plan the build, swap a part, change a supplier, or edit the design",
  },
  {
    n: "3",
    stage: "Build",
    gives: (
      <>
        The build plan with its assembly steps, the order list as CSV and the fab files, in <code>production/</code>
      </>
    ),
    steps: "6",
    gate: "Accept the build. Nothing is ordered",
  },
];

const STEPS: { n: string; step: string; writes: ReactNode; who: "claude" | "code" | "both" }[] = [
  {
    n: "0",
    step: "Request",
    writes: (
      <>
        <code>request.json</code>: what it does, units, budget, region and hard limits, as fields
      </>
    ),
    who: "claude",
  },
  {
    n: "1",
    step: "Design and CAD",
    writes: (
      <>
        <code>design.json</code> with every dimension, current and count; <code>design.md</code>;{" "}
        <code>cad/*.py</code> built to STL, STEP and SVG; <code>figure.mjs</code> drawn into{" "}
        <code>figure.html</code> with Anatomy&apos;s kit
      </>
    ),
    who: "both",
  },
  {
    n: "2",
    step: "Bill of materials",
    writes: (
      <>
        <code>bom.json</code>: every part with its spec, quantity and process (buy, PCB, print, CNC, sheet)
      </>
    ),
    who: "claude",
  },
  {
    n: "3",
    step: "Engineer checks",
    writes: (
      <>
        <code>checks.json</code>: power budget, pins, fits, clearances, screw lengths, standards. Pass, fail, or
        flagged for a person
      </>
    ),
    who: "code",
  },
  {
    n: "4",
    step: "Sourcing",
    writes: (
      <>
        <code>catalog.json</code> and <code>sourcing.json</code>: offers for each bought line with SKU, pack size,
        price breaks, stock and lead time
      </>
    ),
    who: "both",
  },
  {
    n: "5",
    step: "Quote",
    writes: (
      <>
        <code>quotes.json</code>: what to order from which shop, rounded to packs, with shipping and the total
      </>
    ),
    who: "code",
  },
  {
    n: "6",
    step: "Build plan",
    writes: (
      <>
        <code>build-plan.md</code>, and <code>production/</code> with the order list as CSV and every fab file
      </>
    ),
    who: "code",
  },
];

function keypadBand(): { low: number; high: number } | undefined {
  try {
    const f = join(process.cwd(), "skills", "anatomy-2", "examples", KEYPAD_SLUG, "reference", "reference.json");
    const r = JSON.parse(readFileSync(f, "utf8")) as { batchUsd?: { low: number; high: number } };
    return r.batchUsd;
  } catch {
    return undefined;
  }
}

export default async function Home() {
  const example = await loadExample();
  const keypad = EXAMPLE_SLUG === KEYPAD_SLUG ? example : await loadRun(KEYPAD_SLUG);
  const f = factsOf(example);
  const t = tryIt(example);
  const slug = EXAMPLE_SLUG;
  const copy = EXAMPLE_COPY[slug] ?? { edit: "make it 2 units", what: `the ${f.product}` };
  const unitWord = f.units === 1 ? "unit" : "units";
  const art = figureArt(slug);
  const figureHref = existsSync(join(process.cwd(), "skills", "anatomy-2", "examples", slug, "figure.html"))
    ? `/examples/${slug}/figure.html`
    : undefined;
  const demo = f.demoLine;
  const cli = demo ? cliOutput(slug, demo.id) : undefined;
  const runs = finishedRuns();
  const ponderDone = runs.some((r) => r.slug === "ponder");
  const band = keypadBand();
  const score = keypad.score;
  const keypadFiles = score?.files ?? [];
  const filesOk = keypadFiles.filter((x) => x.ok).length;
  const missingFiles = keypadFiles.filter((x) => !x.ok);
  const scoreGaps = score
    ? [
        score.coverage.pct < 90 ? "coverage" : "",
        score.checks.failed > 0 ? "failed checks" : "",
        !score.cost.withinBand ? "cost" : "",
        missingFiles.length ? (missingFiles.some((x) => x.name.startsWith("pcb/")) ? "the PCB files" : "the fab files") : "",
      ].filter(Boolean)
    : [];
  const costLine = score
    ? `${usd(score.cost.batchUsd)}, ${pct(Math.abs(score.cost.deltaPct))} ${score.cost.deltaPct >= 0 ? "over" : "under"} ${usd(score.cost.referenceMidUsd)}${band ? `, the middle of the $${band.low} to $${band.high} band` : ""}`
    : "";
  const sets = f.sets;
  const dear = f.dearShipping;
  const free = f.shipsFree;
  // The explorer only renders what it uses; design.md stays out of the page.
  const exampleData = { ...example, designMd: undefined };

  const install = REPO_PUBLIC ? <Code label="Terminal" code="npx skills add B0tes/anatomy-2 -g" /> : <InstallLine site={SITE} />;
  const zipLink = (
    <a href="/anatomy-2.zip" download>
      anatomy-2.zip
    </a>
  );

  const COMMANDS: { cmd: string; ex?: string; does: ReactNode; idea?: boolean }[] = [
    {
      cmd: "<idea>",
      ex: "/anatomy-2 a 3x3 USB macro keypad for my desk",
      does: (
        <>
          Starts a new run in <code>products/&lt;slug&gt;/</code> and does stage 1: the numbers, the CAD, the BOM, the
          checks and the figure. Then it stops at the first gate. Ask for the whole run without stopping, and it runs
          all three stages and asks once at the end.
        </>
      ),
    },
    {
      cmd: "accept <slug> [stage]",
      ex: `/anatomy-2 accept ${slug}`,
      does: <>Accepts the stage at its gate and starts the next one. After the build stage, the run is done.</>,
    },
    {
      cmd: "decline <slug> [why]",
      ex: `/anatomy-2 decline ${slug} too big for my desk`,
      does: <>Declines the stage with your reason, then asks what to change.</>,
    },
    {
      cmd: "edit <slug> <change>",
      ex: `/anatomy-2 edit ${slug} ${copy.edit}`,
      does: (
        <>
          Changes the design where it starts (a number or the CAD code), rebuilds the CAD and the figure, reruns the
          checks and the quote, says what moved, and asks at the gate again.
        </>
      ),
    },
    {
      cmd: "next <slug>",
      ex: `/anatomy-2 next ${slug}`,
      does: <>Where the run is, and its next step.</>,
    },
    {
      cmd: "figure <slug>",
      ex: `/anatomy-2 figure ${slug}`,
      does: <>Rebuilds the figure page and opens it.</>,
    },
    {
      cmd: "bom <slug> [line]",
      ex: demo ? `/anatomy-2 bom ${slug} ${demo.id}` : `/anatomy-2 bom ${slug}`,
      does: <>The parts, bought and made, with cost and shop. With a line: every offer for the batch, with links.</>,
    },
    {
      cmd: "swap <slug> <line> [what]",
      ex: f.swap ? `/anatomy-2 swap ${slug} ${f.swap.lineId} ${f.swap.to}` : undefined,
      does: (
        <>
          Buys a line from another shop, or finds a different part that still passes the checks. Reports the cost
          overall, shipping included.
        </>
      ),
    },
    {
      cmd: "supplier <slug> [name]",
      ex: `/anatomy-2 supplier ${slug}`,
      does: <>The shops in the order with their lines, subtotals and shipping. With a name: what that shop offers.</>,
    },
    {
      cmd: "view <slug>",
      ex: `/anatomy-2 view ${slug}`,
      does: (
        <>
          Writes <code>view.html</code>, the explorer in section 02, and opens it. It works offline.
        </>
      ),
    },
    {
      cmd: "example [slug]",
      ex: `/anatomy-2 example ${slug}`,
      does: <>Copies a finished run from the skill into <code>products/</code> here, to try the other commands on.</>,
    },
    {
      cmd: "status <slug>, diff <slug>, list",
      ex: `/anatomy-2 diff ${slug}`,
      does: <>The files and gates of a run, what changed between its last two runs, or the products in this folder.</>,
    },
    {
      cmd: "track <slug>",
      idea: true,
      does: <>Orders and deliveries per line: ordered, shipped, arrived, and what is still missing.</>,
    },
    {
      cmd: "build <slug>",
      idea: true,
      does: <>A guided build: one step of the plan at a time, with what to check before the next one.</>,
    },
  ];

  const HISTORY: { label: string; title: string; body: ReactNode }[] = [
    {
      label: "Idea",
      title: "Idea to RFQ",
      body: (
        <>
          Describe a hardware product in chat and get back a bill of materials priced from real suppliers. The first
          page showed a coffee machine with made-up prices, next to a survey of which suppliers answer by API.
        </>
      ),
    },
    {
      label: "Re-plan",
      title: "Start with hardware that is already solved",
      body: (
        <>
          Instead of the coffee machine, start with products that exist and work, and climb a ladder of them. Each rung
          adds one new difficulty: a 3x3 USB keypad, the Ponder tutor desk device, a USB-C desk lamp, a kitchen scale,
          a self-watering planter, and then the coffee machine. The work was split into seven steps, with Anatomy at
          the first. DigiKey&apos;s API was chosen over Nexar, which Tobias had found unreliable.
        </>
      ),
    },
    {
      label: "Run 1",
      title: "Keypad, run 1: $109.75",
      body: (
        <>
          Every step ran end to end. It chose 100% of the known keypad&apos;s parts and no check failed, but the total
          was 63% over. Before that, the checks caught two real faults: the key grid was 0.15 mm wider than the PCB
          allowed, and M3 x 10 screws would have bottomed out in the inserts.
        </>
      ),
    },
    {
      label: "Run 2",
      title: "Keypad, run 2: $88.34",
      body: (
        <>
          The problem was shipping, not parts. Switches from Adafruit and a 50-pack of M3 x 4 inserts moved two lines
          to a shop already in the order, so MaxGaming US and 3DJake dropped out, and $16 of shipping with them. The
          longer inserts needed a deeper boss, and a new check confirms 1.0 mm of plastic stays above each one. The
          live DigiKey adapter was written the same run.
        </>
      ),
    },
    {
      label: "Rung 2",
      title: "Ponder becomes rung 2",
      body: (
        <>
          Ponder, an AI tutor desk device for children, was paused and became the case study: camera, mics, speaker and
          a Raspberry Pi Zero 2 W, in a weighted base with an arm and a head pod. It is to be quoted first at 20
          units, for a school pilot.
        </>
      ),
    },
    {
      label: "Skill",
      title: "A skill anyone can install",
      body: <>First a Claude Code plugin, then one standalone skill with the commands in section 04 and a zip download.</>,
    },
    {
      label: "Explorer",
      title: "One explorer for the run",
      body: (
        <>
          One renderer for the page <code>view</code> opens and for this site, so the example in section 02 is the
          run&apos;s own output.
        </>
      ),
    },
    {
      label: "Gates",
      title: "Three stages with gates, figure first",
      body: (
        <>
          A run now stops after the design, after sourcing and after the build plan, and waits for a yes. Stage 1 draws
          the real product with Anatomy&apos;s drawing kit, which the skill now bundles under its MIT license, so the
          figure is the first thing you see and decide on.
        </>
      ),
    },
  ];

  const LIMITS: ReactNode[] = [
    <>
      <strong>Prices are snapshots unless an API answers.</strong> Most were read from product pages on{" "}
      <span className="nw">{f.pricesRead || "2026-10-13"}</span>. Prices and stock will drift until you rerun sourcing.
    </>,
    <>
      <strong>Shipping is a flat estimate per shop</strong>, not read from the shop&apos;s checkout, to the US. Tax and
      import duty are not counted.
    </>,
    <>
      <strong>3D print prices are an assumed rate</strong>, $0.30 per cm³ with a $6 minimum per part, not a quote.
    </>,
    <>
      <strong>CAD is simple parametric parts</strong> in build123d: plates, trays, bosses and cutouts. Nothing organic,
      and no moving assemblies.
    </>,
    <>
      <strong>There is no PCB layout yet.</strong> The board is priced from its size, but there are no Gerbers, so it
      can&apos;t be ordered yet. That is why the keypad has {filesOk} of {keypadFiles.length || 3} fab files.
    </>,
    <>
      <strong>The figure is a drawing.</strong> Claude draws it from the same numbers as the CAD, but the CAD is what
      gets made.
    </>,
    <>
      <strong>Checks are only as good as the rules written for each product.</strong> The keypad has{" "}
      {keypad.checks.length}. A new product gets rules Claude writes for it, and those need a person to read them.
    </>,
    <>
      <strong>Certification is flagged, not done.</strong> Mains power, radios or children as users get the standards
      named (FCC, CE, CPSIA and so on), not tested.
    </>,
    <>
      <strong>Nothing is ordered.</strong> Placing orders, paid quotes and anything else that spends money waits for your
      OK.
    </>,
    <>
      <strong>
        {runs.length === 1 ? "One product has" : `${runs.length} products have`} gone all the way through:{" "}
        {runs.map((r) => r.product).join(" and ")}.
      </strong>{" "}
      {score && !score.pass ? <>The keypad is still at {costLine}, so it doesn&apos;t pass its own score yet.</> : null}
    </>,
  ];

  const FAQ: { q: string; a: ReactNode }[] = [
    {
      q: "Does it order parts?",
      a: (
        <>
          No. It writes <code>production/order-list.csv</code> with every line, shop, SKU and link, and stops there.
          Anything that spends money waits for your OK.
        </>
      ),
    },
    {
      q: "How is it different from Anatomy?",
      a: (
        <>
          <a href={ANATOMY}>Anatomy</a> draws a figure that explains an idea. Anatomy 2.0 turns a request into something
          you can price, buy and build. It is a separate project by Tobias, not made by Ryan and not a new version of
          Anatomy. Stage 1 draws the real product with Anatomy&apos;s drawing kit, which the skill bundles in{" "}
          <code>kit/</code> under Anatomy&apos;s MIT license.
        </>
      ),
    },
    {
      q: "Can I change the design afterwards?",
      a: (
        <>
          Yes, at any gate or later. <code>edit</code> changes a number or the CAD and reruns everything after it.{" "}
          <code>swap</code> changes a part or a shop. Both end with what moved, the total before and after and any check
          that changed, and then ask the gate question again.
        </>
      ),
    },
    {
      q: "Where do files go?",
      a: (
        <>
          Into <code>products/&lt;slug&gt;/</code> in the folder you run it from: the request, design numbers, CAD with
          its STL and STEP files, the figure, the BOM, checks, offers, quote, build plan and <code>production/</code>.
        </>
      ),
    },
    {
      q: "What does it cost to run?",
      a: (
        <>
          The skill is free. A run uses your Claude Code plan like any other session, mostly to read supplier pages and
          write the design. The checks, the quote and the CAD run on your machine. Paid quotes wait for your OK.
        </>
      ),
    },
    {
      q: "What is the license?",
      a: (
        <>
          MIT. The drawing kit in <code>kit/</code> and the notes in <code>reference/anatomy/</code> are Anatomy&apos;s,
          copyright Ryan, also MIT. The skill&apos;s <code>NOTICE</code> file says which files those are.
        </>
      ),
    },
  ];

  return (
    <>
      <a className="skip" href="#main">
        Skip to the content
      </a>

      <div className="flow">
        <header className={art ? "topbar wide" : "topbar"}>
          <a className="mark" href="#top" aria-label="Anatomy 2.0, top of the page">
            <Mark />
            Anatomy 2.0
          </a>
          <nav className="topnav" aria-label="Page">
            <a href="#example">Example</a>
            <a href="#install">Install</a>
            {REPO_PUBLIC ? <a href={GITHUB}>GitHub</a> : <a href="/anatomy-2.zip">Download</a>}
          </nav>
        </header>
      </div>

      <main id="main">
        <div className="flow" id="top">
          <div className={art ? "hero wide" : "hero"}>
            <div className="hero-head">
              <p className="kicker">A Claude Code skill for hardware</p>
              <h1>Anatomy 2.0</h1>
              <p className="tagline">
                Describe a hardware product in one line. Claude designs it, draws it, finds offers for the bought parts
                on real supplier pages, prices the made parts from fab rules or estimates, and writes the build plan. It
                stops for your yes after each stage.
              </p>
            </div>
            {art && (
              <figure className="hero-art">
                <div
                  className="fig-art"
                  role="img"
                  aria-label={`${f.product}, drawn at stage 1`}
                  style={{ aspectRatio: `${art.width} / ${art.height}` }}
                  dangerouslySetInnerHTML={{ __html: art.svg }}
                />
                <figcaption>
                  The {f.product} from section 02, as stage 1 drew it.{" "}
                  {figureHref && (
                    <a href={figureHref} target="_blank" rel="noopener">
                      Open the interactive figure
                    </a>
                  )}
                </figcaption>
              </figure>
            )}
            <div className="hero-rest">
              {install}
              <p className="hero-sub">
                {REPO_PUBLIC ? <>Or download {zipLink}.</> : <>Or download {zipLink} and unzip it into <code>~/.claude/skills</code>.</>}{" "}
                Then restart Claude Code and type <code>/anatomy-2</code>. Needs Claude Code and Node 22.6 or newer.
              </p>
              <p className="disclaim">
                Anatomy 2.0 is not made by Ryan and is not a new version of <a href={ANATOMY}>Anatomy</a>. It uses
                Anatomy&apos;s drawing kit, under its MIT license, to draw the product at stage 1.
              </p>
              <p className="byline">
                <span>
                  By Tobias{REPO_PUBLIC ? <> (<a href="https://github.com/B0tes">B0tes</a>)</> : " (B0tes)"}
                </span>
                <span>Started 2026-10-13</span>
                <span>MIT</span>
              </p>
            </div>
          </div>

          <nav className="toc" aria-labelledby="toc-h">
            <h2 id="toc-h">Contents</h2>
            <ol>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span className="n">{s.n}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        <section className="sec intro flow" aria-label="What it is">
          <div className="prose">
            <p className="lede">
              Anatomy 2.0 is a skill for Claude Code. You type one line about a hardware product. You get back a folder
              to price it, buy the parts and build it: design numbers, CAD you can print, a drawing you can take apart,
              every part in a bill of materials, engineer checks, offers from real shops, a quote that counts packs and
              shipping, and a build plan. The one thing it can&apos;t make yet is a PCB layout, so a board has no Gerbers
              to order from.
            </p>
            <p>
              It grew out of <a href={ANATOMY}>Anatomy</a>, Ryan&apos;s skill that draws a technical idea as a
              detailed, interactive isometric machine. The two do different jobs.
            </p>
          </div>
          <div className="tbl-wrap">
            <table className="tbl tbl-compare">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Compared on</span>
                  </th>
                  <th scope="col">Anatomy</th>
                  <th scope="col">Anatomy 2.0</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Starts from</th>
                  <td>An idea to explain</td>
                  <td>A product to build</td>
                </tr>
                <tr>
                  <th scope="row">Gives back</th>
                  <td>An interactive isometric figure</td>
                  <td>A figure of the product, and its CAD, BOM, checks, quote, build plan and fab files</td>
                </tr>
                <tr>
                  <th scope="row">Numbers from</th>
                  <td>The drawing&apos;s own model</td>
                  <td>Datasheets, the CAD and supplier pages</td>
                </tr>
                <tr>
                  <th scope="row">You use it to</th>
                  <td>Show how something works</td>
                  <td>Price it, buy the parts yourself and put it together</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="prose">
            <p>
              Anatomy 2.0 uses Anatomy in one place. Stage 1 draws the real product, at true size and in the order it
              goes together, with Anatomy&apos;s drawing kit. The skill bundles the kit in <code>kit/</code>, unchanged
              and under its MIT license. The drawing is for looking at and deciding on. The CAD is what gets made.
            </p>
          </div>
        </section>

        <Section id="run">
          <div className="prose">
            <p>
              A run has three stages. Each one ends at a gate: Claude shows what it made and asks whether to accept it,
              change it or decline it. The next stage doesn&apos;t start until you say yes, unless you ask for the whole
              run without stopping.
            </p>
          </div>
          <div className="tbl-wrap wide">
            <table className="tbl tbl-gates">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">What you get</th>
                  <th scope="col">Steps</th>
                  <th scope="col">At the gate</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((s) => (
                  <tr key={s.n}>
                    <th scope="row">
                      <span className="mono">{s.n}</span> {s.stage}
                    </th>
                    <td>{s.gives}</td>
                    <td className="num" data-label="Steps">
                      {s.steps}
                    </td>
                    <td data-label="At the gate">{s.gate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>The steps inside</h3>
          <div className="prose">
            <p>
              Inside the stages are seven steps, numbered 0 to 6, the way the command line numbers them. Each step reads
              the files before it and writes its own into <code>products/&lt;slug&gt;/</code>, so you can rerun, read
              or change any step by itself.
            </p>
          </div>
          <div className="tbl-wrap wide">
            <table className="tbl tbl-stages">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Step</th>
                  <th scope="col">What it writes</th>
                  <th scope="col">Who</th>
                </tr>
              </thead>
              <tbody>
                {STEPS.map((s) => (
                  <tr key={s.n}>
                    <td className="mono">{s.n}</td>
                    <th scope="row">{s.step}</th>
                    <td className="writes">{s.writes}</td>
                    <td className="who-cell">
                      <Who kind={s.who} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Why the split matters</h3>
          <div className="prose">
            <p>
              Claude does the parts that need judgement: what to build, how to draw it, which parts fit, which offers on
              a page are real. Code does everything that is arithmetic or a rule. The checks are code, the quote is
              code, and the plan is written from the files. So the same inputs always give the same price
              <Fn id="same-price" />, and a change shows up as a diff you can read.
            </p>
            {score && (
              <p>
                Each product starts from a working design that already exists. For a product with an answer key, like
                the keypad, a scorer compares the run with it on four measures. A product passes when it meets all four
                in two runs in a row. The keypad&apos;s latest run:
              </p>
            )}
          </div>
          {score && (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col">Target</th>
                      <th scope="col">Keypad, latest run</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">BOM coverage</th>
                      <td>90% of the known design&apos;s parts</td>
                      <td className="num">{score.coverage.pct}%</td>
                    </tr>
                    <tr>
                      <th scope="row">Failed checks</th>
                      <td>None</td>
                      <td>
                        {score.checks.failed} of {keypad.checks.length}
                        {score.checks.flagged ? `, with ${score.checks.flagged} left for a person` : ""}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Cost</th>
                      <td>Within 25% of the known build</td>
                      <td>
                        {costLine}
                        <Fn id="band" />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Fab files</th>
                      <td>Every file a fab needs</td>
                      <td>
                        {filesOk} of {keypadFiles.length}
                        {missingFiles.length ? `: no ${missingFiles.some((x) => x.name.startsWith("pcb/")) ? "PCB Gerbers" : missingFiles.map((x) => x.name).join(", ")} yet` : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="prose">
                <p>
                  {score.pass
                    ? "It passes."
                    : `It doesn't pass yet. ${scoreGaps.length === 1 ? "The gap is" : `The ${countWord(scoreGaps.length)} gaps are`} ${scoreGaps.join(" and ")}.`}
                </p>
              </div>
            </>
          )}
        </Section>

        <Section id="example">
          <div className="prose">
            <p>
              This is a real run: {copy.what}, {f.units} {unitWord}, quoted at {usd(f.total)} from {f.shops} shops
              {free.length ? `, ${f.shopsCharging} of them charging shipping (${free.join(" and ")} ${free.length === 1 ? "includes it" : "include it"} in the price)` : ""}
              . Stage 1 ended with the drawing at the top of this page
              {figureHref ? (
                <>
                  {" "}
                  (
                  <a href={figureHref} target="_blank" rel="noopener">
                    open it
                  </a>
                  : hover a part to name it, press E to take it apart, use the arrow keys to walk the build)
                </>
              ) : null}
              .
            </p>
            <p>
              Below is the explorer, the page <code>/anatomy-2 view</code> opens on your machine, drawn from the
              run&apos;s <code>explorer.json</code>. Its tabs are the steps inside the three stages, and the BOM is
              open. Click a bought line to see every in-stock offer the run found, priced for the whole batch. Pick
              another and the total is worked out again with the quote&apos;s own rule: parts, rounded to packs, plus
              one shipping charge for each shop in the order. Click a shop name to see that shop&apos;s card.
            </p>
          </div>
          {t && <TryThis t={t} />}
          <figure className="example wide" aria-label={`Explorer for the ${f.product} run`}>
            <Explorer data={exampleData} />
            <figcaption className="caption">
              <b>Figure 1.</b> {f.product}
              {f.pricesRead ? (
                <>
                  , prices read on <span className="nw">{f.pricesRead}</span>
                </>
              ) : null}
              . {f.lines} lines ({f.bought} bought, {f.made} made), {f.checks} checks,{" "}
              {f.failed ? `${f.failed} failed` : "none failed"}
              {f.flagged ? `, ${f.flagged} left for a person` : ""}. Nothing was ordered.
            </figcaption>
          </figure>
        </Section>

        <Section id="install">
          <div className="prose">
            <p>
              {REPO_PUBLIC ? "Add the skill for every project:" : "Unzip the skill into your Claude Code skills folder:"}
            </p>
          </div>
          {install}
          <div className="prose">
            <p>
              {REPO_PUBLIC ? (
                <>
                  Or download {zipLink} and unzip it into <code>~/.claude/skills</code>. Update with{" "}
                  <code>npx skills update anatomy-2</code>.
                </>
              ) : (
                <>
                  Or download {zipLink} and unzip it into <code>~/.claude/skills</code> yourself. Run the same line again
                  to update.
                </>
              )}{" "}
              Then restart Claude Code and type <code>/anatomy-2</code>.
            </p>
            <ul className="notes-list">
              <li>
                Needs <a href="https://claude.com/claude-code">Claude Code</a> and Node 22.6 or newer.
              </li>
              <li>
                The CAD step needs <a href={BUILD123D}>build123d</a> in Python 3: <Cmd>python3 -m pip install build123d</Cmd>.
                On Homebrew Python, install it in a venv and start Claude Code from there.
              </li>
              <li>
                Screenshots of the figure need Chrome or Chromium. Set <code>CHROME_PATH</code> if it isn&apos;t found.
              </li>
            </ul>
          </div>

          <h3>Try it</h3>
          <div className="prose">
            <p>
              Type these into Claude Code, in any folder. The first starts a new run and stops at the first gate. The
              second copies the finished {f.product} from this page into <code>products/{slug}</code>, so
              the rest work on it.
            </p>
          </div>
          <Prompts
            items={[
              { prompt: "/anatomy-2 a USB-C desk lamp with a hinge", note: "a new run" },
              { prompt: `/anatomy-2 example ${slug}`, note: "copy the example here" },
              { prompt: `/anatomy-2 bom ${slug}`, note: "its parts, cost and shops" },
              ...(f.swap ? [{ prompt: `/anatomy-2 swap ${slug} ${f.swap.lineId} ${f.swap.to}`, note: "buy one line elsewhere" }] : []),
              { prompt: `/anatomy-2 edit ${slug} ${copy.edit}`, note: "change the design" },
              { prompt: `/anatomy-2 view ${slug}`, note: "open the explorer" },
            ]}
          />
        </Section>

        <Section id="commands">
          <div className="prose">
            <p>
              Everything starts with <code>/anatomy-2</code> in Claude Code. A new idea starts a run. The other commands
              move a run through its gates, or open a product made earlier to look at it or change it.
            </p>
          </div>
          <div className="tbl-wrap wide">
            <table className="tbl tbl-stack tbl-commands">
              <thead>
                <tr>
                  <th scope="col">Command</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                {COMMANDS.map((c) => (
                  <tr key={c.cmd} className={c.idea ? "later" : undefined}>
                    <td className="cmd">
                      <Cmd>{c.cmd}</Cmd>
                      {c.idea && <span className="next">Idea</span>}
                    </td>
                    <td>
                      {c.does}
                      <span className="ex">{c.ex ? <Cmd>{c.ex}</Cmd> : "Not built yet."}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>The command line underneath</h3>
          <div className="prose">
            <p>
              Every price in the example comes from one command line, <code>bin/anatomy</code> in the skill folder.
              Claude runs it for you, and it also works by itself with nothing but Node. After installing the skill,
              copy the example into a <code>products</code> folder and ask it for one line:
            </p>
          </div>
          {demo && (
            <Code
              label="Terminal"
              code={`mkdir -p products && cp -R ~/.claude/skills/anatomy-2/examples/${slug} products/
~/.claude/skills/anatomy-2/bin/anatomy bom ${slug} ${demo.id}`}
            />
          )}
          {cli && <Code label="Output" output code={cli} />}
          <div className="prose">
            <p>
              Run it with no arguments for every command. It has one for each step (<code>check</code>,{" "}
              <code>source</code>, <code>quote</code>, <code>plan</code>, <code>package</code>, and <code>cad</code>{" "}
              for the CAD), the gates (<code>state</code>, <code>accept</code>, <code>decline</code>,{" "}
              <code>propose</code>), <code>figure</code> and <code>shot</code> for the drawing, <code>score</code> to
              compare a run with its answer key, <code>pick</code> to pin a line to a shop, and <code>digikey</code> for
              live offers.
            </p>
          </div>
        </Section>

        <Section id="prices">
          <div className="prose">
            <p>
              A price is only as good as where it came from, so every line carries its mode and its source. There are
              five modes. The last column counts the lines in the example in section 02.
            </p>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  <th scope="col">Where the number comes from</th>
                  <th scope="col" className="r">
                    Lines
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">API</th>
                  <td>
                    Live price and stock from a supplier&apos;s API. DigiKey first; the adapter is written and waits for
                    your keys.
                  </td>
                  <td className="num r">{f.modes.api}</td>
                </tr>
                <tr>
                  <th scope="row">Scripted</th>
                  <td>
                    Worked out from a fab&apos;s published price rule: OSH Park&apos;s price per square inch,
                    JLCPCB&apos;s base price for five boards.
                  </td>
                  <td className="num r">{f.modes.scripted}</td>
                </tr>
                <tr>
                  <th scope="row">Agent RFQ</th>
                  <td>
                    Claude asks the shop for a quote, for parts no API or calculator covers (CNC, sheet metal, OEM
                    parts). Planned, and nothing is sent without your OK.
                  </td>
                  <td className="num r">{f.modes.agent}</td>
                </tr>
                <tr>
                  <th scope="row">Snapshot</th>
                  <td>Claude reads the price from the product page and keeps the link and the date.</td>
                  <td className="num r">{f.modes.snapshot}</td>
                </tr>
                <tr>
                  <th scope="row">Estimate</th>
                  <td>
                    An assumed rate, not a quote or a published price. 3D prints use $0.30 per cm³ with a $6 minimum
                    per part, set from one third-party Craftcloud quote (all3dp, June 2026), and not checked yet.
                  </td>
                  <td className="num r">{f.modes.estimate}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Packs round up</h3>
          <div className="prose">
            <p>
              You can&apos;t buy 9 switches. The quote orders what the shop sells and prices the whole pack, because that
              is what you pay. In the example:
            </p>
          </div>
          {f.roundings.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col" className="r">
                      Need
                    </th>
                    <th scope="col" className="r">
                      Order
                    </th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {f.roundings.map((r) => (
                    <tr key={r.name}>
                      <th scope="row">{r.name}</th>
                      <td className="num r">{r.need}</td>
                      <td className="num r">{r.order}</td>
                      <td>{r.why.replace("-pack", "‑pack")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Shipping counts once per shop</h3>
          <div className="prose">
            <p>
              Each shop in the order adds its flat shipping once, however many lines it supplies. That is why the
              cheapest part can be the wrong one.
              {dear ? (
                <>
                  {" "}
                  In the example, {dear.shop} adds {usd(dear.shipping)} of shipping to {usd(dear.parts)} of parts (
                  {dear.lines.join(", ")}).
                  {dear.onlyShop
                    ? ` It stays in the order because no other shop in the catalog lists ${dear.lines.length === 1 ? "that part" : "those parts"} yet.`
                    : ""}
                </>
              ) : null}
              {free.length ? ` ${free.join(" and ")} ${free.length === 1 ? "includes" : "include"} shipping in the price, so ${free.length === 1 ? "it adds" : "they add"} no extra charge.` : ""}
            </p>
          </div>

          <h3>The cheapest mix of shops</h3>
          <div className="prose">
            <p>
              The quote doesn&apos;t take the cheapest offer for each line. It tries every set of shops, gives each line
              its cheapest offer inside that set, adds one shipping charge per shop used, and keeps the lowest total.
              {sets ? (
                <>
                  {" "}
                  The example has {f.partShops} parts shops, so that is {sets} sets, which takes no time
                  <Fn id="search" />.
                </>
              ) : (
                <>
                  {" "}
                  The example has {f.partShops} parts shops, too many to try every set
                  <Fn id="search" />.
                </>
              )}
            </p>
          </div>

          <h3>What is live as of 2026-10-13</h3>
          <div className="prose">
            <p>
              Not much yet. Most prices are snapshots that Claude read from product pages on{" "}
              <span className="nw">{f.pricesRead || "2026-10-13"}</span>. They were right that day and will change.
              Shipping is a flat estimate per shop, not read from the shop&apos;s checkout, and the JLCPCB rule and the
              print rate haven&apos;t been checked against a real quote
              <Fn id="rates" />.
            </p>
            <p>
              DigiKey is the first live source. Set <code>DIGIKEY_CLIENT_ID</code> and{" "}
              <code>DIGIKEY_CLIENT_SECRET</code>, and <Cmd>anatomy digikey &lt;slug&gt;</Cmd> adds live offers next to
              the snapshots. Mouser, the JLCPCB and PCBWay APIs, and print quotes from Slant 3D and Sculpteo are next.
            </p>
          </div>
        </Section>

        <Section id="history">
          <div className="prose">
            <p>
              The project started on <span className="nw">2026-10-13</span>. These steps come from the commit history
              and <code>LOG.md</code>.
            </p>
          </div>
          <ol className="log">
            {HISTORY.map((h) => (
              <li key={h.label}>
                <span className="log-label">{h.label}</span>
                <div>
                  <h3>{h.title}</h3>
                  <p>{h.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="tbl-wrap">
            <table className="tbl">
              <caption>Against the middle of the $55 to $80 band, $67.50.</caption>
              <thead>
                <tr>
                  <th scope="col">Keypad</th>
                  <th scope="col" className="r">
                    Parts and fab
                  </th>
                  <th scope="col" className="r">
                    Shipping
                  </th>
                  <th scope="col" className="r">
                    Total
                  </th>
                  <th scope="col" className="r">
                    Over
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Run 1</th>
                  <td className="num r">$66.50</td>
                  <td className="num r">$43.25, 6 shops</td>
                  <td className="num r">$109.75</td>
                  <td className="num r">63%</td>
                </tr>
                <tr>
                  <th scope="row">Run 2</th>
                  <td className="num r">$61.09</td>
                  <td className="num r">$27.25, 4 shops</td>
                  <td className="num r">$88.34</td>
                  <td className="num r">31%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="prose">
            <p>
              The shipping column counts the shops that charge shipping. Next on the keypad: screws from a shop already
              in the order, a real print quote, and the PCB as code with its Gerbers.{" "}
              {ponderDone ? "The Ponder run is in the examples too." : "Then the Ponder run, at 20 units."}
            </p>
          </div>
        </Section>

        <Section id="limits">
          <div className="prose">
            <ul>
              {LIMITS.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="questions">
          <dl className="faq">
            {FAQ.map((x) => (
              <div key={x.q}>
                <dt>{x.q}</dt>
                <dd>{x.a}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="flow">
          <aside className="notes" aria-labelledby="notes-h">
            <h2 id="notes-h">Notes</h2>
            <ol>
              {NOTES.map((n) => (
                <li key={n.id} id={`note-${n.id}`}>
                  {n.body}
                  <a className="back" href={`#ref-${n.id}`} aria-label="Back to the text">
                    ↩
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </main>

      <div className="flow">
        <footer className="foot">
          <p>
            Anatomy 2.0 is by Tobias (B0tes), built with Claude Code. It is not made by Ryan. Stage 1 draws with the
            drawing kit from <a href={ANATOMY}>Anatomy</a> by Ryan (MIT), bundled in the skill&apos;s <code>kit/</code>{" "}
            folder. The CAD is built with <a href={BUILD123D}>build123d</a>.
          </p>
          <ul className="foot-links">
            {REPO_PUBLIC && (
              <li>
                <a href={GITHUB}>GitHub</a>
              </li>
            )}
            <li>
              <a href="/anatomy-2.zip">anatomy-2.zip</a>
            </li>
            <li>MIT license</li>
          </ul>
        </footer>
      </div>
    </>
  );
}
