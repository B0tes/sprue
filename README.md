# Anatomy 2.0

Describe a hardware product in chat; get back a design, CAD, a checked bill of materials priced with offers read
from real supplier pages, and a build plan.
Idea to RFQ. Part of Tobias's World idea lab.

## Install

You need [Claude Code](https://claude.com/claude-code) and Node 22.6 or newer. The CAD step also needs Python 3 with
build123d (`python3 -m pip install build123d`; on Homebrew Python, install it in a venv and start Claude Code from
there). Figure screenshots need Chrome or Chromium (set `CHROME_PATH` if it isn't found).

Download the zip from the site and unzip it into your skills folder:

```sh
curl -fsSL https://anatomy-2.vercel.app/anatomy-2.zip -o /tmp/anatomy-2.zip && unzip -oq /tmp/anatomy-2.zip -d ~/.claude/skills
```

Then restart Claude Code and type `/anatomy-2`. To update, remove the old copy first, so files dropped upstream go
too (`unzip -o` only overwrites), then run the same line again:

```sh
rm -rf ~/.claude/skills/anatomy-2
```

Once this repo is public with the skill on `main`, `npx skills add B0tes/anatomy-2 -g` installs it too, and
`npx skills update anatomy-2` updates it. Until then the zip is the only install that works for anyone but Tobias.

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
/anatomy-2 a 3x3 USB macro keypad for my desk       stage 1: design it and open the figure
/anatomy-2 accept macropad                          accept the current stage and go on to the next
/anatomy-2 edit macropad make the case 2 mm taller  change the design, redraw the figure, rebuild the CAD
/anatomy-2 decline macropad too big for my desk     decline the current stage, with a reason
/anatomy-2 next macropad                            where the run is, and what it does next
/anatomy-2 status macropad                          the three stages, their files, and what's next
/anatomy-2 figure macropad                          redraw the figure and open the page
/anatomy-2 bom macropad                             the bill of materials (with cost and shop once quoted)
/anatomy-2 bom macropad sw                          one line: every offer for the batch, with links
/anatomy-2 swap macropad ctrl SparkFun              buy a line from another shop, or swap the part
/anatomy-2 supplier macropad                        the shops in the order, subtotals and shipping
/anatomy-2 view macropad                            open the page: figure, design, offers and quote, plan
/anatomy-2 example macropad                         copy the finished keypad run into products/ here
```

Each run writes `products/<slug>/` in the current folder: the request, design numbers, CAD and its STL/STEP files,
the figure (`figure.mjs`), the BOM, checks, offers, quote, build plan, `state.json` with where each stage stands,
`production/` with the order list and the fab files, and `view.html`, the one page that shows it all. Ask for the whole run without stopping and
it goes through all three stages, then asks once at the end.

The command line behind the skill also runs on its own, with nothing but Node:
`~/.claude/skills/anatomy-2/bin/anatomy <command> <slug>` after installing (in this repo,
`skills/anatomy-2/bin/anatomy` or `npm run anatomy -- <command> <slug>`). It is not on your PATH. It reads
`products/<slug>/` in the current folder, so copy an example there first:
`mkdir -p products && cp -R ~/.claude/skills/anatomy-2/examples/macropad products/`, then
`anatomy figure macropad` writes its page (it isn't shipped) and prints the path to open. Run it with no
arguments for the list of commands. Live DigiKey prices: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET`, then
`anatomy digikey <slug>`.

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | The site: one page about the skill, with a real run in the explorer (`src/lib/example.ts` picks which) |
| `skills/anatomy-2/` | The skill: `SKILL.md`, `reference/` guides, `bin/anatomy`, `pipeline/` (TypeScript on plain Node), `cad/build.py`, `viewer/`, and `kit/` (Anatomy's drawing kit, MIT, by Ryan) |
| `skills/anatomy-2/examples/` | Finished runs (`macropad` and `ponder`), each with its CAD in `cad/` and its figure in `figure.mjs`; `products/` links here, so the command line run from the repo root sees them |
| `scripts/build-skill-zip.mjs` | Packs the skill into `public/anatomy-2.zip` before each site build |
| `scripts/copy-figures.mjs` | Before each site build, writes each example's `view.html` (`anatomy figure <slug> --draft`, or `anatomy view <slug> --page` while it has no figure; the page is git-ignored) and copies it into `public/examples/` |
| `.claude/skills/anatomy/` | Anatomy itself, vendored for working on this repo: its scripts (such as `scripts/lines.mjs`, the line-end check) check the figures. The skill doesn't need it; it ships the drawing kit in `skills/anatomy-2/kit/` |
| `supabase/migrations/` | SQL migrations (waitlist) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.

## Credit and license

Anatomy 2.0 is by Tobias and is MIT licensed (`skills/anatomy-2/LICENSE`). It is not made by Ryan and is not a new
version of [Anatomy](https://skills.wheresryan.sh/anatomy). Stage 1 draws with Anatomy's drawing kit, bundled
unchanged in `skills/anatomy-2/kit/` under its own MIT license (copyright Ryan). `skills/anatomy-2/NOTICE` lists
the files that are Ryan's.
