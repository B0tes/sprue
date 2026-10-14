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
- The product is a Claude Code skill in `skills/distinta/` (see README). Products live in `products/<slug>/` (a link
  to `skills/distinta/examples/`), each with its CAD as code in `cad/` (build123d).
  `skills/distinta/bin/distinta cad <slug>` exports to `fab/` (git-ignored) and `previews/`. The board is code too
  (`cad/pcb.mjs`, the kit in `skills/distinta/pipeline/pcb/`): `distinta pcb <slug>` (no Python; `cad` runs it as well)
  audits it and writes the Gerbers, drill files, zip and IPC-D-356A netlist to `pcb/` (git-ignored), its previews
  to `previews/`, and a keypad's firmware to `firmware/` (`code.py`, KMK on CircuitPython, and `README.md`).
  `distinta verify <slug>` runs that audit (with the fit check against the case's params), then the read-back of the
  zip (`pipeline/pcb/readback.py`, Python with gerbonara and shapely from `pipeline/pcb/requirements.txt`, in the venv
  `~/.cache/distinta/venv` or `$DISTINTA_PYTHON`; it holds the files to board.json's rules too) and its self-test, then the firmware in the loop
  (`pipeline/firmware/`: the firmware on an emulated Pico, rp2040js, wired to the copper read back, every key and
  pair pressed; CircuitPython, KMK and rp2040js are fetched once, pinned, into `~/.cache/distinta`) and its
  self-test, and only when every layer passed writes `pcb/order/` (`pipeline/pcb/order.ts`: a README, and per fab
  profile the zip in that fab's names and drill format, read back too, and an `ORDER.md`; fetch refuses every fab
  host and order call, and nothing is ever uploaded or ordered); `cad` runs the read-back too, and the scorer and
  `package` take the zip only once it has passed and no firmware run on it failed.

## Rules
- Keep each PR small enough to review in five minutes.
- `npm run lint` and `npm run build` must pass before opening a PR.
- Never commit secrets. Env vars are listed in `.env.example`.
- Spending money (domains, paid APIs, ordering parts) waits for Tobias's explicit OK.
- If the idea's metric has not moved in 5 runs (Build tier), stop building and propose pausing in `LOG.md`.
