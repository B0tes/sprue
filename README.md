# Anatomy 2.0

Describe a hardware product in chat; get back a validated, priced bill of materials with real supplier quotes.
Idea to RFQ. Part of Tobias's World idea lab.

## Install

You need [Claude Code](https://claude.com/claude-code), Node 22.6 or newer, and Python 3 with build123d for the CAD
step (`python3 -m pip install build123d`).

```sh
npx skills add B0tes/anatomy-2 -g
```

Or download `anatomy-2.zip` from the site and `unzip anatomy-2.zip -d ~/.claude/skills`. Restart Claude Code (or run
`/reload-skills`) if `/anatomy-2` doesn't show up. Update with `npx skills update anatomy-2`.

## Use

```
/anatomy-2 a 3x3 USB macro keypad for my desk       design, source, quote and plan it, start to finish
/anatomy-2 a USB-C desk lamp with a hinge --step    the same, pausing after each stage
/anatomy-2 bom macropad                             the bill of materials with cost and shop per line
/anatomy-2 bom macropad sw                          one line: every offer for the batch, with links
/anatomy-2 swap macropad ctrl SparkFun              buy a line from another shop, or swap the part
/anatomy-2 edit macropad make the case 2 mm taller  change the design, rebuild the CAD, requote
/anatomy-2 supplier macropad                        the shops in the order, subtotals and shipping
/anatomy-2 view macropad                            open an interactive page of the run
```

Each run writes `products/<slug>/` in the current folder: the request, design numbers, CAD and its STL/STEP files,
the BOM, checks, offers, quote, build plan, and `production/` with the order list as CSV and the fab files. Nothing
gets ordered.

The command line behind the skill also runs on its own: `skills/anatomy-2/bin/anatomy <command> <slug>` (in this
repo, `npm run anatomy -- <command> <slug>`). Run it with no arguments for the list of commands. Live DigiKey
prices: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET`, then `anatomy digikey <slug>`.

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | Next.js landing page (and, soon, the app) |
| `skills/anatomy-2/` | The skill: `SKILL.md`, `reference/` guides, `bin/anatomy`, `pipeline/` (TypeScript on plain Node), `cad/build.py`, `viewer/` |
| `skills/anatomy-2/examples/` | Finished runs (`macropad`, `ponder`), each with its CAD in `cad/` (`products/` links here) |
| `scripts/build-skill-zip.mjs` | Packs the skill into `public/anatomy-2.zip` before each site build |
| `.claude/skills/anatomy/` | Vendored Anatomy skill (stage 1 figures) for runs inside this repo |
| `src/data/coffee-bom.ts` | The demo BOM (illustrative prices) |
| `supabase/migrations/` | SQL migrations (waitlist) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.
