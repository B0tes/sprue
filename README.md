# Anatomy 2.0

Describe a hardware product in chat; get back a validated, priced bill of materials with real supplier quotes.
Idea to RFQ. Part of Tobias's World idea lab.

## Try it

You need [Claude Code](https://claude.com/claude-code), Node 22.6 or newer and Python 3 with build123d
(`python3 -m pip install build123d`). Install the plugin once:

```
/plugin install anatomy-2 --marketplace B0tes/anatomy-2
```

On Claude Code older than 2.1.275, use `/plugin marketplace add B0tes/anatomy-2` and then
`/plugin install anatomy-2@anatomy-2`. From a shell: `claude plugin marketplace add B0tes/anatomy-2 && claude
plugin install anatomy-2@anatomy-2`.

Then, in any folder:

```
/anatomy-2 a 3x3 USB macro keypad for my desk
```

Claude runs the whole pipeline: request, design and CAD, BOM, engineer checks, sourcing from real product pages,
quotes, build plan, and a production package in `products/<slug>/production/` (build plan, order list as CSV, STL
and STEP files). Add `--step` to stop after each stage so you can look, change something or redo it. Nothing gets
ordered. If `/anatomy-2` clashes with another command, it's also `/anatomy-2:anatomy-2`.

Every stage is also a plain command (`anatomy` is on PATH while the plugin is installed; in this repo use
`plugin/bin/anatomy` or `npm run anatomy --`):

```sh
anatomy status macropad    # which stages exist, what's next
anatomy cad macropad       # build the CAD, print volumes, write previews
anatomy all macropad       # stages 3 to 6 and the score
anatomy package macropad   # production/ folder
anatomy where              # where the pipeline and the worked example live
```

Live DigiKey prices: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET`, then `anatomy digikey <slug>`.

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | Next.js landing page (and, soon, the app) |
| `plugin/` | The Claude Code plugin: `/anatomy-2` skill, `anatomy` command, pipeline code, CAD builder |
| `plugin/pipeline/` | Stage code (TypeScript, runs on plain Node) |
| `plugin/examples/macropad/` | The finished keypad run, with its CAD in `cad/` (`products/` links here) |
| `plugin/skills/anatomy-2/` | The `/anatomy-2` skill that runs the pipeline |
| `.claude/skills/anatomy/` | Vendored Anatomy skill (stage 1 figures) for runs inside this repo |
| `src/data/coffee-bom.ts` | The demo BOM (illustrative prices) |
| `supabase/migrations/` | SQL migrations (waitlist) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.
