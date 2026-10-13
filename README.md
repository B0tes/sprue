# World idea template

Starter for every idea in the World idea lab. To start a new idea: create a repo from this template,
fill in `PLAN.md`, connect the repo to Vercel and a Supabase project, and turn on its daily routine
(prompt: `docs/daily-loop.md`).

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Standing instructions Claude reads on every run |
| `PLAN.md` | Goal, metric, tier, backlog |
| `LOG.md` | One entry per run, newest first |
| `docs/daily-loop.md` | The daily routine prompt |
| `src/` | Next.js app (App Router, TypeScript, Tailwind) |
| `supabase/migrations/` | SQL migrations, starting with a waitlist table |
| `cad/` | Parametric CAD for hardware ideas (`python cad/build.py`) |
