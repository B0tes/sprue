# Daily loop

This is the prompt a scheduled routine runs once per day (or per the tier in `PLAN.md`).

1. Read `CLAUDE.md`, `PLAN.md` and the latest three entries of `LOG.md`.
2. If `PLAN.md` status is Paused, append a one-line LOG entry saying so and stop.
3. Plan: choose the top 1-3 unchecked backlog items that fit in one small PR.
   Write acceptance checks for each before writing code.
4. Build on a branch named `claude/YYYY-MM-DD-<slug>`. Run `npm run lint` and `npm run build`.
   For hardware work, run `cad/build.py` and include the SVG previews from `cad/out/` in the PR.
5. Open a PR. Wait for the Vercel preview and include its URL.
6. Tick finished backlog items in `PLAN.md` and add any new ones you discovered.
7. Prepend a `LOG.md` entry using the template in that file.
8. Report in the idea's project thread: what shipped, the preview link, and the one decision needed, in three lines.

Model guidance: plan and review with Opus, build with Sonnet, summarize logs with Haiku.
Keep the run bounded: if a task is clearly larger than one PR, split it in the backlog instead.
