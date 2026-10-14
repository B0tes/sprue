# Distinta

Describe a hardware product in chat; get back a design, CAD, a checked bill of materials priced with offers read
from real supplier pages, and a build plan.
Idea to RFQ. Part of Tobias's World idea lab.

## Install

You need [Claude Code](https://claude.com/claude-code) and Node 22.6 or newer. The CAD step also needs Python 3 with
build123d (`python3 -m pip install build123d`; on Homebrew Python, install it in a venv and start Claude Code from
there). Reading a board's files back (`distinta verify`) needs Python 3.12 or newer with gerbonara and shapely, in
a venv of their own that `distinta verify` finds by itself:
`python3 -m venv --clear ~/.cache/distinta/venv && ~/.cache/distinta/venv/bin/python -m pip install --no-deps -r ~/.claude/skills/distinta/pipeline/pcb/requirements.txt`
(where `python3` is older than 3.12, the name of a newer one, such as `python3.12`, in its place; `DISTINTA_PYTHON`
names another Python to use). For a keypad it also runs the firmware on an emulated Pico, which needs git, and the network once, to fetch
CircuitPython, KMK and rp2040js into `~/.cache/distinta`. Figure screenshots need Chrome or Chromium (set `CHROME_PATH` if it isn't found).

One line installs it (and, run again, updates it):

```sh
curl -fsSL https://anatomy-2.vercel.app/install | sh
```

It fetches the zip the site serves and puts the skill in `~/.claude/skills/distinta`, replacing an older copy. Then
restart Claude Code and type `/distinta`. To remove it: `rm -rf ~/.claude/skills/distinta`.

Once this repo is public with the skill on `main`, `npx skills add B0tes/anatomy-2 -g` installs it too, and
`npx skills update distinta` updates it.

## Use

A run has three stages, and you say yes before each next one starts:

1. **Design.** Claude works out the real numbers, the CAD, the bill of materials and the engineer checks, and
   draws the product as an interactive isometric figure. `products/<slug>/view.html` opens as soon as every part
   is drawn: hover a part to name it, press E to take it apart, use the arrow keys to walk the assembly steps.
   Then accept it, ask for an edit, or decline it. The page says what to type.
2. **Source.** Real offers from supplier pages and a quote that rounds up to packs and counts shipping. They show
   on the same page, under the design: pick another offer and watch the total move. Accept, swap a part, change a
   supplier, or edit the design.
3. **Build.** The build plan with its assembly steps, the order list as CSV and the fab files, in `production/`.
   The page shows them too: choose a step and the figure shows it. Nothing gets ordered.

```
/distinta a 3x3 USB macro keypad for my desk       stage 1: design it and open the figure
/distinta accept macropad                          accept the current stage and go on to the next
/distinta edit macropad make the case 2 mm taller  change the design, redraw the figure, rebuild the CAD
/distinta decline macropad too big for my desk     decline the current stage, with a reason
/distinta next macropad                            where the run is, and what it does next
/distinta status macropad                          the three stages, their files, and what's next
/distinta figure macropad                          redraw the figure and open the page
/distinta bom macropad                             the bill of materials (with cost and shop once quoted)
/distinta bom macropad sw                          one line: every offer for the batch, with links
/distinta swap macropad ctrl SparkFun              buy a line from another shop, or swap the part
/distinta supplier macropad                        the shops in the order, subtotals and shipping
/distinta view macropad                            open the page: figure, design, offers and quote, plan
/distinta example macropad                         copy the finished keypad run into products/ here
```

Each run writes `products/<slug>/` in the current folder: the request, design numbers, CAD and its STL/STEP files,
the figure (`figure.mjs`), the BOM, checks, offers, quote, build plan, `state.json` with where each stage stands,
`pcb/` with the Gerbers when the product has a board, `production/` with the order list and the fab files, and `view.html`, the one page that shows it all. Ask for the whole run without stopping and
it goes through all three stages, then asks once at the end.

The command line behind the skill also runs on its own, with nothing but Node:
`~/.claude/skills/distinta/bin/distinta <command> <slug>` after installing (in this repo,
`skills/distinta/bin/distinta` or `npm run distinta -- <command> <slug>`). It is not on your PATH. It reads
`products/<slug>/` in the current folder, so copy an example there first:
`mkdir -p products && cp -R ~/.claude/skills/distinta/examples/macropad products/`, then
`distinta figure macropad` writes its page (it isn't shipped) and prints the path to open. Run it with no
arguments for the list of commands. `distinta pcb macropad` draws the keypad's circuit board from its code
(`cad/pcb.mjs`), audits it and writes the Gerbers, drill files, a zip and the netlist to `pcb/`, and the keypad's
firmware (`firmware/code.py`, KMK on CircuitPython, each key read on the GPIO the board wires it to), needing no
Python; `distinta cad` (which needs build123d for the case) runs it too. `distinta verify macropad` runs that audit,
then reads the zip and the netlist back with gerbonara and shapely and holds the copper to the netlist `design.json`
means, with a self-test that puts faults into copies of the files. Then it boots the firmware on an emulated Pico
(rp2040js) wired to the copper it read back, presses every key and every pair of keys, and checks what they type,
with a self-test of its own. When every layer passes it writes `pcb/order/`: a README with the board, its smallest
features and the verification, and for each fab the board passes (JLCPCB, PCBWay, OSH Park, Aisler) the zip in
that fab's file names and drill format, read back the same way, with an `ORDER.md` of upload steps, settings and an
unverified price; with any layer failed or not run it writes none. The zip is scored and packaged only once that
read-back has passed, and not after a firmware run on it failed. Nothing is uploaded to, quoted by or ordered from a
fab: in every command, fetch refuses each fab's host and every order or payment call. Live DigiKey prices: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET`, then
`distinta digikey <slug>`.

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | The site: one page about the skill, with a real run in the explorer (`src/lib/example.ts` picks which) |
| `skills/distinta/` | The skill: `SKILL.md`, `reference/` guides, `bin/distinta`, `pipeline/` (TypeScript on plain Node, with the PCB kit in `pipeline/pcb/`), `cad/build.py`, `viewer/`, and `kit/` (Anatomy's drawing kit, MIT, by Ryan) |
| `skills/distinta/examples/` | Finished runs (`macropad` and `ponder`), each with its CAD in `cad/` (the keypad's board too, `cad/pcb.mjs`) and its figure in `figure.mjs`; `products/` links here, so the command line run from the repo root sees them |
| `scripts/build-skill-zip.mjs` | Packs the skill into `public/distinta.zip` before each site build |
| `scripts/copy-figures.mjs` | Before each site build, writes each example's `view.html` (`distinta figure <slug> --draft`, or `distinta view <slug> --page` while it has no figure; the page is git-ignored) and copies it into `public/examples/` |
| `.claude/skills/anatomy/` | Anatomy itself, vendored for working on this repo: its scripts (such as `scripts/lines.mjs`, the line-end check) check the figures. The skill doesn't need it; it ships the drawing kit in `skills/distinta/kit/` |
| `supabase/migrations/` | SQL migrations (waitlist) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.

## Credit and license

Distinta is by Tobias and is MIT licensed (`skills/distinta/LICENSE`). It was inspired by
[Anatomy](https://skills.wheresryan.sh/anatomy) by Ryan: go check it out. The drawing kit in `skills/distinta/kit/` is
Anatomy's, bundled unchanged under its own MIT license, and `skills/distinta/NOTICE` lists those files.
