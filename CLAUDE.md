# CLAUDE.md

This repo is one idea in Tobias's "World" idea lab. Claude builds it in small daily slices.

## Read first, every run
1. `PLAN.md`: the goal, the success metric, the tier and the backlog. It is the source of truth.
2. `LOG.md`: what happened on previous days and any comments from Tobias. Newest entry first.

## How a daily run works
Follow `docs/daily-loop.md`. In short: pick 1-3 backlog items, build them on a `claude/` branch,
open a PR with a Vercel preview, append to `LOG.md`, and say what decision (if any) Tobias owes.

## Stack
- Next.js (App Router, TypeScript, Tailwind) in `src/`, deployed on Vercel.
- Supabase for auth and data. Clients live in `src/lib/supabase/`; SQL migrations in `supabase/migrations/`.
- The product is a Claude Code skill in `skills/sprue/` (see README). Products live in `products/<slug>/` (a link
  to `skills/sprue/examples/`), each with its CAD as code in `cad/` (build123d).
  `skills/sprue/bin/sprue cad <slug>` exports to `fab/` (git-ignored) and `previews/`. The board is code too
  (`cad/pcb.mjs`, the kit in `skills/sprue/pipeline/pcb/`): `sprue pcb <slug>` (no Python; `cad` runs it as well)
  audits it and writes the Gerbers, drill files, zip and IPC-D-356A netlist to `pcb/` (git-ignored), its previews
  to `previews/`, and a keypad's firmware to `firmware/` (`code.py` and `README.md`, committed; `fil.json` is not).
  `sprue verify <slug>` proves the board before it is packaged: the audit, a read-back of the zip by gerbonara and
  shapely (`pipeline/pcb/readback.py`, Python), the firmware on an emulated Pico (`pipeline/firmware/`), each with a
  self-test, and only then `pcb/order/`, one zip and `ORDER.md` per fab, which nothing ever uploads or orders
  (`skills/sprue/reference/run.md`, "Proving a board"). `sprue system <slug>` (`cad/_system.py`, the checker
  `skills/sprue/cad/system.py`; `cad` runs it too) checks every part in one frame: placed, no overlaps, contacts,
  gaps, inside the case, stability and function probes, each gate with a planted fault, to `system.json`.
  `sprue faults <slug>` (`skills/sprue/pipeline/faults.ts`) checks the checks: it breaks copies of the product in each
  way `reference/faults.json` lists, runs every gate on each and on a clean copy, and writes the share caught and the
  false alarms on the clean design to `faults.json`, which the score reports.

## Rules
- Keep each PR small enough to review in five minutes.
- `npm run lint` and `npm run build` must pass before opening a PR.
- Never commit secrets. Env vars are listed in `.env.example`.
- Spending money (domains, paid APIs, ordering parts) waits for Tobias's explicit OK.
- If the idea's metric has not moved in 5 runs (Build tier), stop building and propose pausing in `LOG.md`.
