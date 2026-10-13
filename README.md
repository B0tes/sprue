# Anatomy 2.0

Describe a hardware product in chat; get back a validated, priced bill of materials with real supplier quotes.
Idea to RFQ. Part of Tobias's World idea lab.

## Try it

You need Node 22.18 or newer, Python 3.10+ and [Claude Code](https://claude.com/claude-code).

```sh
git clone https://github.com/B0tes/anatomy-2 && cd anatomy-2
npm ci
python3 -m pip install -r cad/requirements.txt   # build123d, for the CAD stage
claude
```

Then, inside Claude Code:

```
/anatomy-2 a 3x3 USB macro keypad for my desk
```

Claude walks every stage in order (request, design and CAD, BOM, engineer checks, sourcing, quotes, build plan),
shows what each one produced and waits for you to say continue, change something, or redo. Each stage writes one
file in `products/<slug>/`, so you can open, edit and rerun any of them. The skill is
`.claude/skills/anatomy-2/SKILL.md`; edit it to change how the pipeline is run.

The code stages also run on their own:

```sh
npm run anatomy -- status macropad   # which stages exist, what's next
npm run anatomy -- cad macropad      # build the case, print volumes, write previews
npm run anatomy -- check macropad    # stage 3: engineer checks
npm run anatomy -- quote macropad    # stage 5 (after source)
npm run anatomy -- all macropad      # stages 3 to 6 and the score
```

Optional: set `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` in your shell for live DigiKey prices
(`node src/pipeline/live/digikey.ts <slug>`).

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | Next.js landing page (and, soon, the app) |
| `src/pipeline/` | The pipeline: stage code and the `npm run anatomy` CLI |
| `products/<slug>/` | One folder per product run; `macropad` is the finished example |
| `.claude/skills/` | `anatomy-2` (walks the pipeline) and `anatomy` (stage 1 figures) |
| `src/data/coffee-bom.ts` | The demo BOM (illustrative prices) |
| `supabase/migrations/` | SQL migrations (waitlist) |
| `cad/` | Parametric CAD as code (`npm run anatomy -- cad <slug>`) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.
