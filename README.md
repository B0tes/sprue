# Anatomy 2.0

Describe a hardware product in chat; get back a validated, priced bill of materials with real supplier quotes.
Idea to RFQ. Part of Tobias's World idea lab.

| Path | What it is |
| --- | --- |
| `PLAN.md` | Goal, metric, backlog, supplier roadmap |
| `LOG.md` | One entry per daily run, newest first |
| `research/` | Supplier API research |
| `src/` | Next.js landing page (and, soon, the app) |
| `src/data/coffee-bom.ts` | The demo BOM (illustrative prices) |
| `supabase/migrations/` | SQL migrations (waitlist) |
| `cad/` | Parametric CAD for demo parts (`python cad/build.py`) |

Run locally: `npm ci && npm run dev`. Env vars are in `.env.example`.
