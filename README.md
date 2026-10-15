# Sprue

Describe a hardware product in chat; get back a design, CAD, a checked bill of materials priced with offers read
from real supplier pages, and a build plan.
Idea to RFQ. Part of Tobias's World idea lab.

## Install

You need [Claude Code](https://claude.com/claude-code) and Node 22.15 or newer. The CAD step also needs Python 3 with
build123d (`python3 -m pip install build123d`; on Homebrew Python, install it in a venv and start Claude Code from
there). Reading a board's files back (`sprue verify`) needs Python 3.12 or newer with gerbonara and shapely, in
a venv of their own that `sprue verify` finds by itself:
`python3 -m venv --clear ~/.cache/sprue/venv && ~/.cache/sprue/venv/bin/python -m pip install --no-deps -r ~/.claude/skills/sprue/pipeline/pcb/requirements.txt`
(where `python3` is older than 3.12, the name of a newer one, such as `python3.12`, in its place; `SPRUE_PYTHON`
names another Python to use). For a keypad it also runs the firmware on an emulated Pico, which needs git, and the network once, to fetch
CircuitPython, KMK and rp2040js into `~/.cache/sprue`. Figure screenshots need Chrome or Chromium (set `CHROME_PATH` if it isn't found).

One line installs it (and, run again, updates it):

```sh
curl -fsSL https://anatomy-2.vercel.app/install | sh
```

It fetches the zip the site serves and puts the skill in `~/.claude/skills/sprue`, replacing an older copy, and
removes `~/.claude/skills/distinta`, where it was installed under its old name. Then restart Claude Code and type
`/sprue`. To remove it: `rm -rf ~/.claude/skills/sprue ~/.claude/skills/distinta`.

`npx skills add B0tes/sprue -g` installs it too (choose Claude Code when it asks which agents), and
`npx skills update sprue` updates it.

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
   A circuit board is proven first (`/sprue verify`, below), and only a verified one gets its files to order by
   hand. The page shows them too: choose a step and the figure shows it. Nothing gets ordered.

```
/sprue a 3x3 USB macro keypad for my desk          stage 1: design it and open the figure
/sprue accept macropad                             accept the current stage and go on to the next
/sprue edit macropad make the case 2 mm taller     change the design, redraw the figure, rebuild the CAD
/sprue decline macropad too big for my desk        decline the current stage, with a reason
/sprue next macropad                               where the run is, and what it does next
/sprue status macropad                             the three stages, their files, and what's next
/sprue figure macropad                             redraw the figure and open the page
/sprue bom macropad                                the bill of materials (with cost and shop once quoted)
/sprue bom macropad sw                             one line: every offer for the batch, with links
/sprue swap macropad ctrl SparkFun                 buy a line from another shop, or swap the part
/sprue supplier macropad                           the shops in the order, subtotals and shipping
/sprue verify macropad                             prove the board: audit, read-back, firmware, then the order folder
/sprue view macropad                               open the page: figure, design, offers and quote, plan
/sprue example macropad                            copy the finished keypad run into products/ here
```

Each run writes `products/<slug>/` in the current folder: the request, design numbers, CAD and its STL/STEP files,
the figure (`figure.mjs`), the BOM, checks, offers, quote, build plan, `state.json` with where each stage stands,
for a product with a board `pcb/` with the Gerbers (and `pcb/order/` once `sprue verify` has passed them) and
for a keypad `firmware/`, `production/` with the order list and the fab files, and `view.html`, the one page that
shows it all. Ask for the whole run without stopping and it goes through all three stages, then asks once at the end.

The command line behind the skill also runs on its own, with Node (and Python for `cad` and `verify`):
`~/.claude/skills/sprue/bin/sprue <command> <slug>` after installing (in this repo,
`skills/sprue/bin/sprue` or `npm run sprue -- <command> <slug>`). It is not on your PATH. It reads
`products/<slug>/` in the current folder, so copy an example there first:
`mkdir -p products && cp -R ~/.claude/skills/sprue/examples/macropad products/`, then
`sprue figure macropad` writes its page (it isn't shipped) and prints the path to open. Run it with no
arguments for the list of commands. Live DigiKey prices: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET`, then
`sprue digikey <slug>`.

## The circuit board

A board is code too: `cad/pcb.mjs` places the parts from a footprint library whose every number names its source,
pours the ground, routes the nets and writes the silkscreen, reading its numbers from `design.json`. Two commands
turn it into files to order, and test how far those files can be trusted. Nothing is uploaded to, quoted by or
ordered from a fab: in every command, fetch refuses each fab's host and every order or payment call.

- `sprue pcb macropad` (Node only; `sprue cad` runs it too) builds the board and audits it: every footprint
  against its source, the nets against the circuit `design.json` means, the parts against the params the case is
  built from, and our DRC, at least as strict as the published 2-layer limits of JLCPCB, PCBWay, OSH Park and
  Aisler. With no errors it writes the Gerbers, drill files, a zip and the IPC-D-356A netlist to `pcb/`, previews
  to `previews/`, and for a keypad its firmware (`firmware/code.py`, KMK on CircuitPython, each key read on the GPIO
  the board wires it to).
- `sprue verify macropad` proves it, layer by layer (the firmware only on copper that read back clean, the order
  files only once every other layer passed):
  1. the audit again;
  2. a read-back: gerbonara and shapely, not our writer, read the very files in the zip and the netlist, rebuild the
     copper and hold it to the netlist `design.json` means and to the rules (opens, shorts, sizes, mask, drills,
     outline, the files' own statements);
  3. its self-test, a cut and two slivers put into copies of the files, each of which it must catch;
  4. for a keypad, the firmware on an emulated Pico (rp2040js) wired to the copper read back, with every key and
     every pair of keys pressed;
  5. its self-test: a key shorted to ground, two keys swapped and two keys joined, each of which it must catch;
  6. a zip for each fab the board passes, in that fab's file names and drill format, read back the same way.

  It ends VERIFIED, FAILED or UNVERIFIED (a layer that could not run, such as no Python for the read-back, is not
  a pass). Only VERIFIED writes `pcb/order/`: a README with the board, its smallest features and the verification,
  and per fab the zip and an `ORDER.md` with upload steps, settings and an unverified price, ending with a STOP line.
  The scorer and `sprue package` take the zip only once its read-back has passed, and not after a firmware run on
  it failed.

These are our checks, not a fab's, and the firmware runs on an emulator, not on the board. Not checked yet: a second
DRC by KiCad, the board against the case's CAD solids (only against the params they share), and a real Pico and
socket on a 1:1 print, which the order README asks for before the first order.

## The repo

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | The site: one page about the skill, with a real run in the explorer (`src/lib/example.ts` picks which) |
| `skills/sprue/` | The skill: `SKILL.md`, `reference/` guides, `bin/sprue`, `pipeline/` (TypeScript on plain Node, with the PCB kit in `pipeline/pcb/`), `cad/build.py`, `viewer/`, and `kit/` (Anatomy's drawing kit, MIT, by Ryan) |
| `skills/sprue/examples/` | Finished runs (`macropad` and `ponder`), each with its CAD in `cad/` (the keypad's board too, `cad/pcb.mjs`) and its figure in `figure.mjs`; `products/` links here, so the command line run from the repo root sees them |
| `scripts/build-skill-zip.mjs` | Packs the skill into `public/sprue.zip` before each site build |
| `scripts/copy-figures.mjs` | Before each site build, writes each example's `view.html` (`sprue figure <slug> --draft`, or `sprue view <slug> --page` while it has no figure; the page is git-ignored) and copies it into `public/examples/` |
| `.claude/skills/anatomy/` | Anatomy itself, vendored for working on this repo: its scripts (such as `scripts/lines.mjs`, the line-end check) check the figures. The skill doesn't need it; it ships the drawing kit in `skills/sprue/kit/` |
| `supabase/migrations/` | SQL migrations (waitlist) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.

## Credit and license

Sprue is by Tobias and is MIT licensed (`skills/sprue/LICENSE`). It was inspired by
[Anatomy](https://skills.wheresryan.sh/anatomy) by Ryan: go check it out. The drawing kit in `skills/sprue/kit/` is
Anatomy's, bundled unchanged under its own MIT license, and `skills/sprue/NOTICE` lists those files.
