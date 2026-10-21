import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Code, Prompts } from "@/components/Code";
import { Cmd } from "@/components/Cmd";
import { Emblem } from "@/components/Emblem";
import { HeroFigure } from "@/components/HeroFigure";
import { InstallLine } from "@/components/InstallLine";
import { Legend } from "@/components/Legend";
import { WorkedExample } from "@/components/WorkedExample";
import {
  EXAMPLE_COPY,
  EXAMPLE_SLUG,
  KEYPAD_SLUG,
  cliOutput,
  factsOf,
  figureCrop,
  finishedRuns,
  loadExample,
  loadRun,
  runView,
  usd,
} from "@/lib/example";
import { ANATOMY, BUILD123D, GITHUB, NPX_INSTALL, REPO_PUBLIC, SITE } from "@/lib/site";
// Anatomy's drawing kit styles the figures and the emblem; the site sets its colours (.fig-art, .emblem and .wx-fig in globals.css).
import "../../skills/sprue/kit/iso.css";

/** `short` is the label in the narrow left rail (Legend); the heading and the inline Contents list use `title`. */
const SECTIONS = [
  { id: "stages", n: "01", title: "The stages" },
  { id: "example", n: "02", title: "A worked example", short: "Worked example" },
  { id: "install", n: "03", title: "Install" },
  { id: "commands", n: "04", title: "Commands" },
  { id: "prices", n: "05", title: "How prices are found", short: "Prices" },
  { id: "history", n: "06", title: "How we got here", short: "History" },
  { id: "limits", n: "07", title: "Limits" },
  { id: "questions", n: "08", title: "Questions" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

type Band = { low: number; high: number };

function bandOf(slug: string): Band | undefined {
  try {
    const f = join(process.cwd(), "skills", "sprue", "examples", slug, "reference", "reference.json");
    return (JSON.parse(readFileSync(f, "utf8")) as { batchUsd?: Band }).batchUsd;
  } catch {
    return undefined;
  }
}

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

function Fn({ id, notes }: { id: string; notes: { id: string }[] }) {
  const n = notes.findIndex((x) => x.id === id) + 1;
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

function Who({ kind }: { kind: "claude" | "code" }) {
  return <span className={`who who-${kind}`}>{kind === "claude" ? "Claude" : "Command line"}</span>;
}

function Files({ names }: { names: string[] }) {
  return (
    <span className="files">
      {names.map((n, i) => (
        <span key={n}>
          <code>{n}</code>
          {i < names.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

const pct = (n: number) => `${Math.round(n)}%`;
/** A score's cost gap in percent, from the totals: score.json's deltaPct is already rounded to 0.1, and rounding it
 * again can be a point off (23.47 -> 23.5 -> 24). */
const costPct = (c: { batchUsd: number; referenceMidUsd: number }) => (c.batchUsd / c.referenceMidUsd - 1) * 100;
const countWord = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);

export default async function Home() {
  const example = await loadExample();
  const keypad = EXAMPLE_SLUG === KEYPAD_SLUG ? example : await loadRun(KEYPAD_SLUG);
  const f = factsOf(example);
  const kf = factsOf(keypad);
  const slug = EXAMPLE_SLUG;
  const copy = EXAMPLE_COPY[slug] ?? { edit: "make it 2 units", what: `the ${f.product}` };
  const unitWord = f.units === 1 ? "unit" : "units";
  const views = [runView(example), ...(EXAMPLE_SLUG === KEYPAD_SLUG ? [] : [runView(keypad)])];
  const view = views[0];
  const crop = figureCrop(slug);
  const demo = f.demoLine;
  const cli = demo ? cliOutput(slug, demo.id) : undefined;
  const runs = finishedRuns();
  const keypadBand = bandOf(KEYPAD_SLUG);
  const exampleBand = bandOf(slug);
  const kScore = keypad.score;
  const eScore = example.score;
  const made = example.lines.filter((l) => l.made);
  const madeUsd = Math.round(made.reduce((s, l) => s + l.made!.orderUsd, 0) * 100) / 100;
  const estimatedMade = made.filter((l) => l.made!.mode === "estimate");
  const estimatedUsd = Math.round(estimatedMade.reduce((s, l) => s + l.made!.orderUsd, 0) * 100) / 100;
  const phases = example.phases ?? [];
  const bothOrders = Math.round(phases.reduce((s, p) => s + p.batchUsd, 0) * 100) / 100;
  const sets = f.sets;
  const dear = f.dearShipping;
  const free = f.shipsFree;
  const firstRounding = f.roundings[0];

  const NOTES: { id: string; body: ReactNode }[] = [
    {
      id: "same-price",
      body: (
        <>
          Offers are saved in the product folder (<code>catalog.json</code>), so a rerun reads the same ones. A live API
          run reads new offers, and <code>/sprue diff</code> shows what moved.
        </>
      ),
    },
    {
      id: "band",
      body: (
        <>
          The keypad&apos;s answer key is two open keypads:{" "}
          <a href="https://github.com/jaysongiroux/pico-macro-pad">jaysongiroux/pico-macro-pad</a> (a Pico wired straight
          to the keys) and <a href="https://github.com/jboucly/macropad-3x3">jboucly/macropad-3x3</a> (PCB, printed case,
          M3 inserts).
          {keypadBand
            ? ` Its ${dollars(keypadBand.low)} to ${dollars(keypadBand.high)} band is one build bought retail in the US: about $31 of parts, plus shipping from four or five shops, full packs and a print minimum.`
            : ""}{" "}
          {slug !== KEYPAD_SLUG && exampleBand ? (
            <>
              Ponder&apos;s is built from the Google AIY Voice and Vision kits and an IPEVO V4K document camera, bought as
              parts in the US: {dollars(exampleBand.low)} to {dollars(exampleBand.high)} for {f.units} units. Both are in
              each run&apos;s <code>reference/reference.json</code>.
            </>
          ) : null}{" "}
          Cost is scored against the middle of the band.
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
          Craftcloud print rate is marked not checked: it was set from one third-party Craftcloud quote (all3dp, June
          2026), not read from a price list. A JLC3DP rate for PA12 is read from JLC3DP&apos;s own page, but its US
          shipping isn&apos;t published, so it counts none.
        </>
      ),
    },
  ];
  const fn = (id: string) => <Fn id={id} notes={NOTES} />;

  // One command wherever the page shows an install: npx once the repo is public, until then the line that fetches
  // this site's own zip (src/app/install/route.ts).
  const install = REPO_PUBLIC ? <Code label="Terminal" code={NPX_INSTALL} /> : <InstallLine site={SITE} />;

  const STAGE_ROWS: {
    n: number;
    stage: string;
    sees: ReactNode;
    claude: string[];
    code: string[];
    commands: string;
    gate: string[];
  }[] = [
    {
      n: 1,
      stage: "Design",
      sees: (
        <>
          <code>view.html</code> opens at once: Fig 1, the product drawn as a live isometric figure you can take apart and
          step through, with the parts, the numbers, the checks and the CAD under it.
        </>
      ),
      claude: ["request.json", "design.json", "design.md", "bom.json", "cad/*.py", "cad/pcb.mjs", "rules.ts", "figure.mjs"],
      code: ["checks.json", "fab/ (STL, STEP)", "pcb/ (Gerbers, drills, drc.json)", "previews/", "figure.svg", "figure.json", "view.html"],
      commands: "new, validate, cad, pcb, check, figure, shot",
      gate: ["Accept and inspect it", "Edit something", "Decline"],
    },
    {
      n: 2,
      stage: "Inspect",
      sees: (
        <>
          The same page, now with the whole product checked in one frame: the verdict, each gate with its problems and the
          risks the design accepts, whether it stands and does its job, and what is not checked yet.
        </>
      ),
      claude: ["cad/_system.py"],
      code: ["system.json", "previews/system.svg", "checks.json (the parts together)"],
      commands: "system, inspect",
      gate: ["Accept and source it", "Fix something", "Decline"],
    },
    {
      n: 3,
      stage: "Source",
      sees: (
        <>
          The same page, now with every offer for each part, the quote and the shops. Pick another offer and the total is
          worked out again.
        </>
      ),
      claude: ["catalog.json"],
      code: ["sourcing.json", "quotes.json", "explorer.json"],
      commands: "source, quote, view (digikey with your keys)",
      gate: ["Accept and plan the build", "Swap a part", "Change a supplier", "Edit the design"],
    },
    {
      n: 4,
      stage: "Build",
      sees: (
        <>
          The assembly steps, linked to Fig 1 (choose a step and the figure shows it), the order list and the fab files.
          Nothing is ordered.
        </>
      ),
      claude: [],
      code: ["build-plan.md", "production/ (order-list.csv, STL, STEP, Gerber zip)", "order-a.csv, order-b.csv with a first article", "score.json"],
      commands: "plan, package, score",
      gate: ["Accept the build", "Change something"],
    },
  ];

  const COMMANDS: { group: string; rows: { cmd: string; ex?: string; does: ReactNode; later?: boolean; cli?: boolean }[] }[] = [
    {
      group: "Start a run",
      rows: [
        {
          cmd: "<idea>",
          ex: "/sprue a USB-C desk lamp with a hinge",
          does: (
            <>
              Starts a new run in <code>products/&lt;slug&gt;/</code> and does stage 1: the numbers, the CAD, the BOM, the
              checks and Fig 1, on a page that opens as soon as every part is drawn. Then it stops at gate 1. Ask for the
              whole run without stopping, and it runs all four stages and asks once at the end.
            </>
          ),
        },
        {
          cmd: "example [slug]",
          ex: `/sprue example ${slug}`,
          does: (
            <>
              Copies a finished run ({runs.map((r) => r.slug).join(" or ")}) into <code>products/</code> here and opens its
              page. It arrives at gate 1, so you can answer the gates yourself.
            </>
          ),
        },
      ],
    },
    {
      group: "At a gate",
      rows: [
        {
          cmd: "accept <slug> [stage]",
          ex: `/sprue accept ${slug}`,
          does: <>Accepts the stage at its gate and starts the next one. After the build stage, the run is done.</>,
        },
        {
          cmd: "decline <slug> [why]",
          ex: `/sprue decline ${slug} too big for my desk`,
          does: <>Declines the stage with your reason, then asks what to change.</>,
        },
        {
          cmd: "edit <slug> <change>",
          ex: `/sprue edit ${slug} ${copy.edit}`,
          does: (
            <>
              Changes the design where it starts (a number, the CAD or the figure), reruns what it touched, says what moved,
              and asks at the gate again.
            </>
          ),
        },
        {
          cmd: "next <slug>",
          ex: `/sprue next ${slug}`,
          does: <>Asks the open gate&apos;s question again, or starts the next stage once the last one is accepted.</>,
        },
        {
          cmd: "status <slug>",
          ex: `/sprue status ${slug}`,
          does: <>The four stages and their gates, the files each has written, and the one thing to do next.</>,
        },
      ],
    },
    {
      group: "The figure",
      rows: [
        {
          cmd: "figure <slug>",
          ex: `/sprue figure ${slug}`,
          does: (
            <>
              Draws Fig 1 again from <code>figure.mjs</code> and opens the page. While the design is being drawn, it also
              proposes it at gate 1.
            </>
          ),
        },
        {
          cmd: "shot <slug>",
          ex: `~/.claude/skills/sprue/bin/sprue shot ${slug} --apart`,
          cli: true,
          does: (
            <>
              Screenshots of the card on <code>view.html</code> into <code>shots/</code>: at rest, apart, at a step, one
              part lit, zoomed, light or dark. Claude runs it to check the drawing. Command line only; needs Chrome or
              Chromium.
            </>
          ),
        },
      ],
    },
    {
      group: "The whole product",
      rows: [
        {
          cmd: "inspect <slug>",
          ex: `/sprue inspect ${slug}`,
          does: (
            <>
              Checks the parts together as one product: every part placed, none overlapping, the parts meant to touch
              touching and the rest keeping their gap, that it stands tilted and pushed, that sound gets out, ports and
              views are clear, light reaches its window and metal keeps off the antennas. It proposes stage 2 only when
              that and every check pass; otherwise it lists each problem.
            </>
          ),
        },
      ],
    },
    {
      group: "Parts and shops",
      rows: [
        {
          cmd: "bom <slug> [line]",
          ex: demo ? `/sprue bom ${slug} ${demo.id}` : `/sprue bom ${slug}`,
          does: <>The parts, bought and made, with cost and shop. With a line: every offer for the batch, with links.</>,
        },
        {
          cmd: "swap <slug> <line> [what]",
          ex: f.swap ? `/sprue swap ${slug} ${f.swap.lineId} ${f.swap.to}` : undefined,
          does: (
            <>
              Buys a line from another shop, or finds a different part that still passes the checks. Reports the cost
              overall, shipping included.
            </>
          ),
        },
        {
          cmd: "supplier <slug> [name]",
          ex: `/sprue supplier ${slug}`,
          does: <>The shops in the order with their lines, subtotals and shipping. With a name: what that shop offers.</>,
        },
      ],
    },
    {
      group: "The page and the history",
      rows: [
        {
          cmd: "view <slug>",
          ex: `/sprue view ${slug}`,
          does: (
            <>
              Writes <code>view.html</code> and opens it: one page for the run, with the stages and what to type at the
              gate, Fig 1, then the design, the quote and the build plan as each stage makes them. It works offline.
            </>
          ),
        },
        {
          cmd: "diff <slug>, list",
          ex: `/sprue diff ${slug}`,
          does: <>What changed between the last two runs, or the products in this folder.</>,
        },
      ],
    },
    {
      group: "Next, not built yet",
      rows: [
        {
          cmd: "track <slug>",
          later: true,
          does: <>Orders and deliveries per line: ordered, shipped, arrived, and what is still missing.</>,
        },
        {
          cmd: "build <slug>",
          later: true,
          does: <>A build guide: one step of the plan at a time, with what to check before the next one.</>,
        },
      ],
    },
  ];

  const HISTORY: { on?: string; at: string; title: string; body: ReactNode }[] = [
    {
      at: "01:12",
      title: "Idea to RFQ",
      body: (
        <>
          Describe a hardware product in chat and get back a bill of materials priced from real suppliers. The first page
          showed a coffee machine with made-up prices, next to a survey of which suppliers answer by API.
        </>
      ),
    },
    {
      at: "02:02",
      title: "Start with hardware that is already solved",
      body: (
        <>
          Instead of the coffee machine, start with products that exist and work, and climb a ladder of them. Each rung adds
          one new difficulty: a 3x3 USB keypad, the Ponder tutor desk device, a USB-C desk lamp, a kitchen scale, a
          self-watering planter, and then the coffee machine. DigiKey&apos;s API was chosen over Nexar, which Tobias had
          found unreliable.
        </>
      ),
    },
    {
      at: "02:28",
      title: "Keypad, run 1: $109.75",
      body: (
        <>
          Every step ran end to end. It chose 100% of the known keypad&apos;s parts and no check failed, but the total was
          63% over. Before that, the checks caught two real faults: the key grid was 0.15 mm wider than the PCB allowed,
          and M3 x 10 screws would have bottomed out in the inserts.
        </>
      ),
    },
    {
      at: "13:01",
      title: "Keypad, run 2: $88.34",
      body: (
        <>
          The problem was shipping, not parts. Switches from Adafruit and a 50-pack of M3 x 4 inserts moved two lines to a
          shop already in the order, so MaxGaming US and 3DJake dropped out, and $16 of shipping with them. The live DigiKey
          adapter was written the same run.
        </>
      ),
    },
    {
      at: "14:57",
      title: "Run it yourself",
      body: (
        <>
          A first <code>/sprue</code> skill, and one command line with a command per stage, so Tobias could run the
          pipeline himself. A minute later Ponder, an AI tutor desk device for children, became rung 2: camera, mics,
          speaker and a Pi Zero 2 W or an ESP32-S3, in a weighted base with an arched neck and a head pod, for a school
          pilot of 20 to 50 units.
        </>
      ),
    },
    {
      at: "16:00",
      title: "One standalone skill",
      body: (
        <>
          At 15:24 it became a Claude Code plugin; at 16:00, one standalone skill with subcommands (<code>bom</code>,{" "}
          <code>pick</code>, <code>suppliers</code>, <code>diff</code>, <code>view</code>) and a zip download, so it
          installs without the repo.
        </>
      ),
    },
    {
      at: "16:02",
      title: "Ponder, run end to end",
      body: (
        <>
          The second product went through the whole pipeline, until 19:10: {f.lines} BOM lines, {f.checks} checks, offers from {f.partShops} shops and a quote of {usd(f.total)} for {f.units} units, with spares and two
          orders. It passed its score then, +16.1% on the middle of its band.
          What it needed went back into the skill: spares, a batch need per line, offers dropped for short stock, packs
          and price breaks in the order list, and orders A and B.
        </>
      ),
    },
    {
      at: "19:50",
      title: "Three gates, and the figure first",
      body: (
        <>
          A run now stops after the design, after sourcing and after the build plan, and waits for a yes. Stage 1 draws the
          real product as a live isometric figure, with the drawing kit the skill bundles, so the figure is the first thing
          you see and decide on.
        </>
      ),
    },
    {
      at: "19:50",
      title: "The BOM explorer",
      body: (
        <>
          One renderer for the page <code>view</code> opens and for this site: every in-stock offer per line, priced for the
          batch. Pick one and the total is worked out again with the quote&apos;s own rule.
        </>
      ),
    },
    {
      at: "20:43",
      title: "One page that grows with the run",
      body: (
        <>
          The figure and the explorer became one page, <code>view.html</code>. It starts with the stages, what to type at
          the gate and Fig 1. The quote and the build plan appear under it as each stage makes them. Point at a part in the
          parts list or the BOM and the figure lights it, and the build steps move the figure.
        </>
      ),
    },
    {
      at: "21:57",
      title: "Ponder drawn, at gate 1",
      body: (
        <>
          Ponder got its own Fig 1: {view.figure ? `${view.figure.parts} parts in ${view.figure.steps} steps` : "the figure"},
          every one a line in its BOM, opened up so the base and the head come apart in layers. It is the worked example
          above, and it arrives at gate 1 when you copy it.
        </>
      ),
    },
    {
      on: "2026-10-14",
      at: "13:30",
      title: "Keypad, run 3: a real PCB",
      body: (
        <>
          The keypad&apos;s board became code. Claude places the sockets, the Pico and the holes from the design numbers; the
          kit routes it, audits it and writes the Gerbers and drill files only when the audit passes. Files went to 3 of 3.
          The total went up to $92.29: Bolts and Nuts charges $8.95 shipping, not the $5 guessed before, and no shop already
          in the order sells a screw that fits.
        </>
      ),
    },
    {
      on: "2026-10-15",
      at: "07:25",
      title: "Keypad, run 4: the screws ride with the board",
      body: (
        <>
          JLCMC lists ISO 7380 button head screws, the kind the case needs, and ships them in the JLCPCB parcel, so the four
          screws stop paying a shop&apos;s shipping of their own. The total fell to $83.34 and the keypad passes its score
          for the first time. The screw is an estimate: JLCMC&apos;s page shows the family, and whether it lists an M3 x 8 and
          at what price sits in a part picker.
        </>
      ),
    },
    {
      on: "2026-10-16",
      at: "19:05",
      title: "The parts checked as one product",
      body: (
        <>
          Tobias asked for a test of the whole product, not its parts: that what goes inside something fits, that it
          doesn&apos;t fall over, and that it does its job. <code>sprue system</code> puts every part in one frame and checks
          that nothing overlaps or rubs, the parts meant to touch do, it stands tilted and pushed, and rays from the
          speaker, mics, camera, LEDs and radio show each can do its job. A fault planted in each check proves it can
          fail. Neither product passes yet: the keypad&apos;s USB plug runs into the tray wall, and Ponder&apos;s speaker
          grille is too closed with a steel screw near its Wi-Fi antenna.
        </>
      ),
    },
    {
      on: "2026-10-17",
      at: "07:40",
      title: "A second opinion on the board, from KiCad",
      body: (
        <>
          <code>sprue verify</code> now rebuilds the board in KiCad from the very zip a fab gets and runs KiCad&apos;s own
          design rule check on it, with our rules, then with each fab&apos;s numbers and Aisler&apos;s, JLCPCB&apos;s and
          PCBWay&apos;s own KiCad rule files. On the keypad KiCad finds nothing, its netlist matches ours on all 129
          points a fab&apos;s tester probes, and it catches each of four faults planted in copies. The score also now
          fails a printed part whose mesh is not the volume it is priced at.
        </>
      ),
    },
  ];

  const scoreRow = (s: typeof kScore, band: Band | undefined) =>
    s ? (
      <>
        {usd(s.cost.batchUsd)}, {pct(Math.abs(costPct(s.cost)))} {s.cost.deltaPct >= 0 ? "over" : "under"} {usd(s.cost.referenceMidUsd)}
        {band ? `, the middle of ${dollars(band.low)} to ${dollars(band.high)}` : ""}
      </>
    ) : null;
  const filesOf = (s: typeof kScore) => {
    const files = s?.files ?? [];
    const missing = files.filter((x) => !x.ok);
    return `${files.filter((x) => x.ok).length} of ${files.length}${missing.length ? `: no ${missing.some((x) => x.name.startsWith("pcb/")) ? "PCB Gerbers" : missing.map((x) => x.name).join(", ")} yet` : ""}`;
  };
  // A score from before the whole-product check has no system: it was never run, so it doesn't pass now. A product
  // that lists seeded faults passes only with each caught and no false alarm.
  const passes = (s: typeof kScore) => !!s?.pass && !!s.system?.ok && (!s.faults || s.faults.ok);
  const systemOf = (s: typeof kScore) =>
    !s?.system ? "Not run" : s.system.ok ? "Passes" : s.system.failed.length ? `Fails ${s.system.failed.join(", ")}` : "Not checked yet";
  // A short word for a faults.json that is missing, stale or unreadable, as `sprue status` gives; else the counts,
  // with what else failed the run (a fault that could not be put in, a stage the clean copy skipped).
  const faultsOf = (s: typeof kScore) => {
    const f = s?.faults;
    if (!f) return "None listed yet";
    if (/^no faults\.json/.test(f.detail)) return "Not run yet";
    if (/^faults\.json (is of an|was measured on) earlier/.test(f.detail)) return "Out of date: the design or the checks changed since it ran";
    if (/^faults\.json (is not readable|could not be checked)/.test(f.detail)) return "Unreadable";
    const alarms = `${f.falseAlarms || "no"} false alarm${f.falseAlarms === 1 ? "" : "s"}`;
    const rest = (f.detail.match(/; .*$/)?.[0] ?? "").replace(/ \(faults\.json\)$/, "");
    const counts = `${f.caught} of ${f.ran} caught${f.missed.length ? ` (missed ${f.missed.join(", ")})` : ""}, ${alarms}${rest}`;
    return f.ok || f.missed.length || f.falseAlarms || rest ? counts : `Fails: ${f.detail}`;
  };
  const gapsOf = (s: typeof kScore) =>
    s
      ? [
          s.coverage.pct < 90 ? "coverage" : "",
          s.checks.failed > 0 ? "failed checks" : "",
          !s.cost.withinBand ? "cost" : "",
          s.cost.unpriced?.length ? "unpriced lines" : "",
          (s.files ?? []).some((x) => !x.ok) ? ((s.files ?? []).some((x) => !x.ok && x.name.startsWith("pcb/")) ? "the PCB files" : "the fab files") : "",
          !s.system?.ok ? "the whole-product check" : "",
          s.faults && !s.faults.ok ? "the seeded faults" : "",
        ].filter(Boolean)
      : [];
  const kGaps = gapsOf(kScore);

  const LIMITS: ReactNode[] = [
    <>
      <strong>Prices are snapshots unless an API answers.</strong> Most were read from product pages on{" "}
      <span className="nw">{f.pricesRead || "2026-10-13"}</span>. Prices and stock will drift until you rerun sourcing.
    </>,
    <>
      <strong>Shipping is a flat estimate per shop</strong>, not read from the shop&apos;s checkout, to the US. Tax and
      import duty are not counted; a run lists what it leaves out under Not in the total
      {example.costNotes?.length ? ` (${example.product.split(",")[0]} has ${example.costNotes.length})` : ""}.
    </>,
    <>
      <strong>3D print prices are an assumed rate</strong>, $0.30 per cm³ with a $6 minimum per part, not a quote.
      {estimatedMade.length && slug !== KEYPAD_SLUG
        ? ` In the worked example that is ${usd(estimatedUsd)} of the ${usd(f.total)}, for ${estimatedMade.length} printed parts.`
        : ""}
    </>,
    <>
      <strong>CAD is simple parametric parts</strong> in build123d: shells, plates, trays, bosses and cutouts. Nothing
      organic, and no moving assemblies.
    </>,
    <>
      <strong>The PCB is checked by us, not by a fab.</strong> The keypad&apos;s board is code (<code>cad/pcb.mjs</code>):
      two layers, routed, with a ground pour, written as Gerbers and drill files.{" "}
      {kScore?.files.some((x) => x.name.endsWith(".zip") && x.ok)
        ? "Our own audit passes at JLCPCB's published limits and every net is connected, but no fab has seen the files."
        : "Our own audit doesn't pass yet, and no fab has seen the files."}{" "}
      Some footprint sizes are measured off drawings or taken from a KiCad library, so they are marked as estimates to
      check against a real Kailh socket and the Pico datasheet&apos;s Figure 5 before ordering. Only simple two-layer
      boards, and only the Kailh socket and the Pico, are in the library so far. Ponder has no custom board: it is built
      from breakouts.
    </>,
    <>
      <strong>The figure is a drawing.</strong> Claude draws it from the same numbers as the CAD, and every part is a BOM
      line, but the CAD is what gets made. Sizes the figure needs that no datasheet gives are marked as estimates in{" "}
      <code>design.json</code>.
    </>,
    <>
      <strong>Checks are only as good as the rules written for each product.</strong> The keypad&apos;s{" "}
      {keypad.checks.length} are in the pipeline
      {slug !== KEYPAD_SLUG ? (
        <>
          , Ponder&apos;s {example.checks.length} in its own <code>rules.ts</code>
        </>
      ) : null}
      . A check flagged for a person needs one to read it.
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
        {runs.length === 1 ? "One product has" : `${countWord(runs.length).replace(/^./, (c) => c.toUpperCase())} products have`} gone all the
        way through: {runs.map((r) => r.product.split(",")[0]).join(" and ")}.
      </strong>{" "}
      {kScore && !passes(kScore) && !kScore.cost.withinBand ? <>The keypad is still {pct(Math.abs(costPct(kScore.cost)))} over its cost band&apos;s middle, so it doesn&apos;t pass its own score yet.</> : null}
    </>,
  ];

  const FAQ: { q: string; a: ReactNode }[] = [
    {
      q: "Does it order parts?",
      a: (
        <>
          No. It writes <code>production/order-list.csv</code> with every line, shop, SKU, link and the packs to put in the
          cart, and stops there. Anything that spends money waits for your OK.
        </>
      ),
    },
    {
      q: "Can I change the design afterwards?",
      a: (
        <>
          Yes, at any gate or later. <code>edit</code> changes a number, the CAD or the figure and reruns what it touched.{" "}
          <code>swap</code> changes a part or a shop. Both end with what moved, the total before and after and any check that
          changed, and then ask the gate question again.
        </>
      ),
    },
    {
      q: "Where do files go?",
      a: (
        <>
          Into <code>products/&lt;slug&gt;/</code> in the folder you run it from: the request, design numbers, CAD with its
          STL and STEP files, the figure, the BOM, checks, the whole-product check (<code>system.json</code>), offers, quote,
          build plan, <code>state.json</code> with the gates,{" "}
          <code>view.html</code>, <code>pcb/</code> with the Gerbers, drill files and the board&apos;s audit when the
          product has a board, and <code>production/</code>.
        </>
      ),
    },
    {
      q: "What does it cost to run?",
      a: (
        <>
          The skill is free. A run uses your Claude Code plan like any other session, mostly to read supplier pages, write
          the design and draw the figure. The checks, the quote and the CAD run on your machine. Paid quotes wait for your
          OK.
        </>
      ),
    },
    {
      q: "What is the license?",
      a: (
        <>
          MIT. Bundled third-party files keep their own licenses, listed in the skill&apos;s <code>NOTICE</code> file.
        </>
      ),
    },
    {
      q: "Why the name?",
      a: (
        <>
          A sprue is the frame a model kit comes on: every part of the thing held in one place, numbered, ready to snip
          off and put together. A run hands you the same for a real product. Every part is a line in its bill of
          materials, priced and sourced, and every part in the figure is one of those lines.
        </>
      ),
    },
  ];

  return (
    <>
      <a className="skip" href="#main">
        Skip to the content
      </a>

      <div className="flow" id="top">
        <Emblem id="emblem-top" className="emblem-top" />
        <header className={crop ? "topbar wide" : "topbar"}>
          <a className="mark" href="#top" aria-label="Sprue, top of the page">
            <Mark />
            Sprue
          </a>
          <nav className="topnav" aria-label="Page">
            <a href="#example">Example</a>
            <a href="#install">Install</a>
            {REPO_PUBLIC ? <a href={GITHUB}>GitHub</a> : <a href="/sprue.zip">Download</a>}
          </nav>
        </header>
      </div>

      <main id="main" className="main">
        <div className="legend-rail">
          <Legend
            items={[...SECTIONS.map((s) => ({ id: s.id, n: s.n, title: "short" in s ? s.short : s.title })), { id: "notes", title: "Notes" }]}
          />
        </div>

        <div className="flow">
          <div className={crop ? "hero wide" : "hero"}>
            <div className="hero-head">
              <p className="kicker">A Claude Code skill for hardware</p>
              <h1>Sprue</h1>
              <p className="tagline">
                Describe a hardware product in one line. Claude designs it and draws it as a live isometric figure you can
                take apart. Then it checks the parts together as one product, finds real offers for every part and writes the
                build plan. It stops for your yes after each stage.
              </p>
            </div>
            <div className="hero-rest">
              {install}
              <p className="hero-sub">
                Then restart Claude Code and type <code>/sprue example {slug}</code>. Needs Claude Code and Node 22.15 or
                newer.
              </p>
              <p className="byline">
                <span>By Tobias{REPO_PUBLIC ? <> (<a href="https://github.com/B0tes">B0tes</a>)</> : " (B0tes)"}</span>
                <span>Started 2026-10-13</span>
                <span>MIT</span>
              </p>
            </div>
            {crop && (
              <figure className="hero-art">
                <HeroFigure
                  src={`${view.base}figure.svg`}
                  viewBox={crop.viewBox}
                  width={crop.width}
                  height={crop.height}
                  label={`${view.name}, drawn at stage 1`}
                />
                <figcaption>
                  {view.name}, the worked example, as stage 1 drew it: {view.figure?.parts} parts, each a line in its bill of
                  materials. <a href="#example">Take it apart below</a>.
                </figcaption>
              </figure>
            )}
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
              Sprue is a skill for Claude Code. You type one line about a hardware product. You get back a folder to
              price it, buy the parts and build it: design numbers, CAD you can print, a figure of the product you can take
              apart, every part in a bill of materials, engineer checks, offers from real shops, a quote that counts packs
              and shipping, and a build plan. A simple two-layer circuit board comes out as Gerbers and drill files too,
              checked by its own rules at a fab&apos;s published limits.
            </p>
            <p>
              Each part in the figure is drawn at its real size, from datasheets and the CAD, and shown at the build step
              where it goes on. The figure is for looking at and deciding on. The CAD is what gets made.
            </p>
            <p>
              Sprue was inspired by <a href={ANATOMY}>Anatomy</a>, Ryan&apos;s Claude Code skill that draws an idea as a
              live isometric machine. Go check it out.
            </p>
          </div>
        </section>

        <Section id="stages">
          <div className="prose">
            <p>
              A run has four stages. Each one ends at a gate: Claude shows what it made and asks you to accept it, edit it
              or decline it. The next stage doesn&apos;t start until you say yes, unless you ask for the whole run without
              stopping. Every file lands in <code>products/&lt;slug&gt;/</code>, so you can read, rerun or change any part
              by itself.
            </p>
          </div>
          <ol className="stage-list wide">
            {STAGE_ROWS.map((s) => (
              <li key={s.n} className="stage-card">
                <div className="stage-top">
                  <span className="stage-n">{s.n}</span>
                  <h3>{s.stage}</h3>
                  <span className="stage-gate">ends at gate {s.n}</span>
                </div>
                <p className="stage-sees">{s.sees}</p>
                <dl className="stage-who">
                  <div>
                    <dt>
                      <Who kind="claude" />
                    </dt>
                    <dd>
                      {s.claude.length ? (
                        <>
                          writes <Files names={s.claude} />
                        </>
                      ) : (
                        <>checks that the figure&apos;s steps and the written ones agree</>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Who kind="code" />
                    </dt>
                    <dd>
                      writes <Files names={s.code} />
                      <span className="stage-cmds">
                        {" "}
                        with {s.commands}
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="stage-ask">
                  <span className="stage-ask-l">At gate {s.n}</span>
                  <ul>
                    {s.gate.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>

          <h3>Why the split matters</h3>
          <div className="prose">
            <p>
              Claude does the parts that need judgement: what to build, how to draw it, which parts fit, which offers on a
              page are real. The command line does everything that is arithmetic or a rule. The checks are code, the quote
              is code, and the plan is written from the files. So the same inputs always give the same price
              {fn("same-price")}, and a change shows up as a diff you can read.
            </p>
            {kScore && (
              <p>
                Each product starts from a working design that already exists. A scorer compares the run with it on five
                measures, and a product that lists seeded faults must also catch each one. A run passes when it meets all of
                them. A product moves up the ladder after two passing runs in a row. The latest runs:
              </p>
            )}
          </div>
          {kScore && (
            <>
              <div className="tbl-wrap">
                <table className="tbl tbl-score">
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col">Target</th>
                      <th scope="col">Keypad</th>
                      {eScore && slug !== KEYPAD_SLUG && <th scope="col">Ponder</th>}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">BOM coverage</th>
                      <td>90% of the known design&apos;s parts</td>
                      <td className="num">{kScore.coverage.pct}%</td>
                      {eScore && slug !== KEYPAD_SLUG && <td className="num">{eScore.coverage.pct}%</td>}
                    </tr>
                    <tr>
                      <th scope="row">Failed checks</th>
                      <td>None</td>
                      <td>
                        {kScore.checks.failed} of {keypad.checks.length}
                        {kScore.checks.flagged ? `, ${kScore.checks.flagged} left for a person` : ""}
                      </td>
                      {eScore && slug !== KEYPAD_SLUG && (
                        <td>
                          {eScore.checks.failed} of {example.checks.length}
                          {eScore.checks.flagged ? `, ${eScore.checks.flagged} left for a person` : ""}
                        </td>
                      )}
                    </tr>
                    <tr>
                      <th scope="row">Cost</th>
                      <td>Within 25% of the known build{fn("band")}</td>
                      <td>{scoreRow(kScore, keypadBand)}</td>
                      {eScore && slug !== KEYPAD_SLUG && <td>{scoreRow(eScore, exampleBand)}</td>}
                    </tr>
                    <tr>
                      <th scope="row">Fab files</th>
                      <td>Every file a fab needs</td>
                      <td>{filesOf(kScore)}</td>
                      {eScore && slug !== KEYPAD_SLUG && <td>{filesOf(eScore)}</td>}
                    </tr>
                    <tr>
                      <th scope="row">Whole product</th>
                      <td>Every part fits, stands and does its job, in one frame</td>
                      <td>{systemOf(kScore)}</td>
                      {eScore && slug !== KEYPAD_SLUG && <td>{systemOf(eScore)}</td>}
                    </tr>
                    <tr>
                      <th scope="row">Seeded faults</th>
                      <td>Every fault planted in a copy caught, none raised on the clean design</td>
                      <td>{faultsOf(kScore)}</td>
                      {eScore && slug !== KEYPAD_SLUG && <td>{faultsOf(eScore)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="prose">
                <p>
                  {eScore && slug !== KEYPAD_SLUG
                    ? passes(eScore)
                      ? "Ponder's run passes. One more passing run moves it up the ladder. "
                      : "Ponder's run doesn't pass yet. "
                    : ""}
                  {passes(kScore)
                    ? "The keypad's run passes."
                    : `The keypad's run doesn't pass yet. ${kGaps.length === 1 ? "The gap is" : `The ${countWord(kGaps.length)} gaps are`} ${kGaps.join(" and ")}.`}
                </p>
              </div>
            </>
          )}
        </Section>

        <Section id="example">
          <div className="prose">
            <p>
              This is a real run: {copy.what}, {f.units} {unitWord}, quoted at {usd(f.total)} ({usd(f.perUnit)} a unit) from{" "}
              {f.shops} shops in the order. Every number below comes from its files. Each tab is one stage, and each stage ends with the
              question Claude asks you in Claude Code. Answer it, and the run moves on.
              {view.stops ? ` ${view.name} stops at gate ${view.stops.gate}: ${view.stops.why}, so its later tabs show what an earlier run made ahead of their gates.` : ""}
            </p>
            <p>
              Fig 1 is the figure stage 1 drew, live, with the skill&apos;s own figure code: hover a part to name it, press{" "}
              <kbd>E</kbd> or Take apart to open it up, and use the arrow keys or the step buttons to walk the build. In stage
              3, point at a line in the bill of materials and its part lights in the figure. In stage 4, choose an assembly
              step and the figure shows it.
              {views.length > 1 ? " The keypad, rung 1, is under the switch at the top." : ""}
            </p>
          </div>
          <div className="example-wrap full">
            <WorkedExample runs={views} />
          </div>
        </Section>

        <Section id="install">
          <div className="prose">
            <p>One command installs the skill for every project:</p>
          </div>
          {install}
          <div className="prose">
            <p>
              Then restart Claude Code.{" "}
              {REPO_PUBLIC ? (
                <>
                  Update with{" "}
                  <span className="nw">
                    <code>npx skills update sprue</code>
                  </span>
                </>
              ) : (
                <>Run the same command again to update</>
              )}
              ; to remove the skill, run{" "}
              <span className="nw">
                <Cmd>rm -rf ~/.claude/skills/sprue</Cmd>
              </span>
              .
              {/* Not NPX_INSTALL itself while the repo is private: it names the repo, which keeps its old name until renamed. */}
              {REPO_PUBLIC ? null : (
                <>
                  {" "}
                  Once the repo is public, it will install with{" "}
                  <span className="nw">
                    <code>npx skills add</code>
                  </span>{" "}
                  too.
                </>
              )}
            </p>
            <p className="try-line">
              <strong>Try it:</strong> type{" "}
              <span className="nw">
                <Cmd>{`/sprue example ${slug}`}</Cmd>
              </span>
              {slug !== KEYPAD_SLUG ? (
                <>
                  {" "}
                  (or <code>{KEYPAD_SLUG}</code>)
                </>
              ) : null}
              , then{" "}
              <span className="nw">
                <Cmd>{`/sprue accept ${slug}`}</Cmd>
              </span>
              .
            </p>
            <ul className="notes-list">
              <li>
                Needs <a href="https://claude.com/claude-code">Claude Code</a> and Node 22.15 or newer.
              </li>
              <li>
                The CAD needs <a href={BUILD123D}>build123d</a> in Python 3: <Cmd>python3 -m pip install build123d</Cmd>. On
                Homebrew Python, install it in a venv and start Claude Code from there.
              </li>
              <li>
                Screenshots of the figure need Chrome or Chromium. Set <code>CHROME_PATH</code> if it isn&apos;t found.
              </li>
            </ul>
          </div>

          <h3>More to type</h3>
          <div className="prose">
            <p>
              The first line copies the finished {view.name} run into <code>products/{slug}</code> and opens its page at gate
              1. The rest work on it. The last starts a run of your own.
            </p>
          </div>
          <Prompts
            items={[
              { prompt: `/sprue example ${slug}`, note: "copy the example here; it opens at gate 1" },
              { prompt: `/sprue accept ${slug}`, note: "accept the design and go on to stage 2, Inspect" },
              { prompt: `/sprue inspect ${slug}`, note: "check the parts together as one product" },
              { prompt: `/sprue bom ${slug}`, note: "its parts, cost and shops" },
              ...(f.swap ? [{ prompt: `/sprue swap ${slug} ${f.swap.lineId} ${f.swap.to}`, note: "buy one line elsewhere" }] : []),
              { prompt: `/sprue edit ${slug} ${copy.edit}`, note: "change the design (an example change)" },
              { prompt: `/sprue view ${slug}`, note: "open its page" },
              { prompt: "/sprue a USB-C desk lamp with a hinge", note: "a new run" },
            ]}
          />
        </Section>

        <Section id="commands">
          <div className="prose">
            <p>
              Everything starts with <code>/sprue</code> in Claude Code. A new idea starts a run. The other commands
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
              {COMMANDS.map((g) => (
                <tbody key={g.group}>
                  <tr className="grp">
                    <th scope="rowgroup" colSpan={2}>
                      {g.group}
                    </th>
                  </tr>
                  {g.rows.map((c) => (
                    <tr key={c.cmd} className={c.later ? "later" : undefined}>
                      <td className="cmd">
                        <Cmd>{c.cmd}</Cmd>
                        {c.later && <span className="next">Next</span>}
                        {c.cli && <span className="next">Command line</span>}
                      </td>
                      <td>
                        {c.does}
                        <span className="ex">{c.ex ? <Cmd>{c.ex}</Cmd> : "Not built yet."}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <h3>The command line underneath</h3>
          <div className="prose">
            <p>
              Every price in the example comes from one command line, <code>bin/sprue</code> in the skill folder. Claude
              runs it for you, and it also works by itself with nothing but Node. After installing the skill, copy the
              example into a <code>products</code> folder and ask it for one line:
            </p>
          </div>
          {demo && (
            <Code
              label="Terminal"
              code={`mkdir -p products && cp -R ~/.claude/skills/sprue/examples/${slug} products/
~/.claude/skills/sprue/bin/sprue bom ${slug} ${demo.id}`}
            />
          )}
          {cli && <Code label="Output" output code={cli} />}
          <div className="prose">
            <p>
              Run it with no arguments for every command. It has one for each part of a stage (<code>validate</code>,{" "}
              <code>cad</code>, <code>check</code>, <code>system</code>, <code>inspect</code>, <code>source</code>,{" "}
              <code>quote</code>, <code>plan</code>, <code>package</code>), the gates (<code>state</code>, <code>accept</code>, <code>decline</code>,{" "}
              <code>propose</code>), <code>figure</code> and <code>shot</code> for the drawing, <code>score</code> to compare
              a run with its answer key, <code>pick</code> to pin a line to a shop, and <code>digikey</code> for live offers.
            </p>
          </div>
        </Section>

        <Section id="prices">
          <div className="prose">
            <p>
              A price is only as good as where it came from, so every line carries its mode and its source. There are five
              modes. The last column counts the lines in the example in section 02.
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
                  <td>Live price and stock from a supplier&apos;s API. DigiKey first; the adapter is written and waits for your keys.</td>
                  <td className="num r">{f.modes.api}</td>
                </tr>
                <tr>
                  <th scope="row">Scripted</th>
                  <td>
                    Worked out from a fab&apos;s published price rule: OSH Park&apos;s price per square inch, JLCPCB&apos;s base
                    price for five boards.
                  </td>
                  <td className="num r">{f.modes.scripted}</td>
                </tr>
                <tr>
                  <th scope="row">Agent RFQ</th>
                  <td>
                    Claude asks the shop for a quote, for parts no API or calculator covers (CNC, sheet metal, OEM parts).
                    Planned, and nothing is sent without your OK.
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
                    An assumed rate, not a quote or a published price. 3D prints use $0.30 per cm³ with a $6 minimum per part,
                    set from one third-party Craftcloud quote (all3dp, June 2026), and not checked yet.
                  </td>
                  <td className="num r">{f.modes.estimate}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Packs and price breaks round up</h3>
          <div className="prose">
            <p>
              {firstRounding ? (
                <>
                  You can&apos;t buy {firstRounding.need} of the {firstRounding.name.charAt(0).toLowerCase() + firstRounding.name.slice(1)}.{" "}
                </>
              ) : null}
              The quote orders what the shop sells and prices the whole pack, because that is what you pay. It also buys up
              to a higher price break when more pieces cost less in all. The batch needs each line&apos;s count per unit
              times the units, plus spares for the small parts that get lost. In the example:
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
              Each shop in the order adds its flat shipping once, however many lines it supplies. That is why the cheapest
              part can be the wrong one.
              {dear ? (
                <>
                  {" "}
                  In the example, {dear.shop} adds {usd(dear.shipping)} of shipping to {usd(dear.parts)} of parts (
                  {dear.lines.join("; ")}).
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
              The quote doesn&apos;t take the cheapest offer for each line. It tries every set of shops, gives each line its
              cheapest offer inside that set, adds one shipping charge per shop used, and keeps the lowest total.
              {sets ? (
                <>
                  {" "}
                  The example has {f.partShops} parts shops, so that is {sets.toLocaleString("en-US")} sets, which takes no time
                  {fn("search")}.
                </>
              ) : (
                <>
                  {" "}
                  The example has {f.partShops} parts shops, too many to try every set{fn("search")}.
                </>
              )}
            </p>
            {phases.length === 2 && (
              <p>
                For more than a few units, it can price a first article: order A buys the parts for {phases[0].units} units to
                build and check first ({usd(phases[0].batchUsd)}), and order B the other {phases[1].units} and the spares (
                {usd(phases[1].batchUsd)}). Two orders cost {usd(bothOrders)}, {usd(bothOrders - f.total)} more than one, because
                each shop ships twice.
              </p>
            )}
          </div>

          <h3>What is live as of 2026-10-13</h3>
          <div className="prose">
            <p>
              Not much yet. Most prices are snapshots that Claude read from product pages on{" "}
              <span className="nw">{f.pricesRead || "2026-10-13"}</span>. They were right that day and will change. Shipping
              is a flat estimate per shop, not read from the shop&apos;s checkout, and the JLCPCB rule and the print rates
              haven&apos;t been checked against a real quote{fn("rates")}.
              {madeUsd && slug !== KEYPAD_SLUG ? ` In the worked example the printed parts come to ${usd(madeUsd)} at that rate.` : ""}
            </p>
            <p>
              DigiKey is the first live source. Set <code>DIGIKEY_CLIENT_ID</code> and <code>DIGIKEY_CLIENT_SECRET</code>,
              and <Cmd>sprue digikey &lt;slug&gt;</Cmd> adds live offers next to the snapshots. Mouser, the JLCPCB and PCBWay
              APIs, and print quotes from Slant 3D and Sculpteo are next.
            </p>
          </div>
        </Section>

        <Section id="history">
          <div className="prose">
            <p>
              The project started on <span className="nw">2026-10-13</span>, and everything here happened that day unless
              another date is shown. Times are UTC, from the commit history and <code>LOG.md</code>.
            </p>
          </div>
          <ol className="log">
            {HISTORY.map((h) => (
              <li key={h.title}>
                <span className="log-label">
                  <time dateTime={`${h.on ?? "2026-10-13"}T${h.at}Z`}>{h.on ? `${h.on} ${h.at}` : h.at}</time> UTC
                </span>
                <div>
                  <h3>{h.title}</h3>
                  <p>{h.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="tbl-wrap">
            <table className="tbl">
              <caption>Against the middle of the keypad&apos;s band, {kScore ? usd(kScore.cost.referenceMidUsd) : "$67.50"}.</caption>
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
                <tr>
                  <th scope="row">Run 3</th>
                  <td className="num r">$61.09</td>
                  <td className="num r">$31.20, 4 shops</td>
                  <td className="num r">$92.29</td>
                  <td className="num r">37%</td>
                </tr>
                <tr>
                  <th scope="row">Latest run</th>
                  <td className="num r">{usd(Math.round((kf.total - kf.shippingUsd) * 100) / 100)}</td>
                  <td className="num r">
                    {usd(kf.shippingUsd)}, {kf.shopsCharging} shops
                  </td>
                  <td className="num r">{usd(kf.total)}</td>
                  <td className="num r">{kScore ? pct(costPct(kScore.cost)) : ""}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="prose">
            <p>
              The shipping column counts the shops that charge shipping. Next on the keypad: JLCMC&apos;s real price for the
              screws in place of the estimate, a real print quote, and a fab&apos;s own check of the keypad&apos;s Gerbers.
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
          <aside className="notes" id="notes" aria-labelledby="notes-h">
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
          <Emblem
            id="emblem-foot"
            className="emblem-foot"
            caption="A soldering iron a hair above a pin: the moment an idea becomes hardware."
          />
          <p>
            Sprue is by Tobias (B0tes), made with Claude Code. Its CAD uses <a href={BUILD123D}>build123d</a>.
          </p>
          <ul className="foot-links">
            {REPO_PUBLIC && (
              <li>
                <a href={GITHUB}>GitHub</a>
              </li>
            )}
            <li>
              <a href="/sprue.zip">sprue.zip</a>
            </li>
            <li>MIT license</li>
          </ul>
        </footer>
      </div>
    </>
  );
}
