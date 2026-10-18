# Daily loop

This is the prompt a scheduled routine runs once per day (or per the tier in `PLAN.md`).

1. Read `CLAUDE.md`, `PLAN.md` and the latest three entries of `LOG.md`.
2. If `PLAN.md` status is Paused, append a one-line LOG entry saying so and stop.
3. Plan: choose the top 1-3 unchecked backlog items that fit in one small PR.
   Write acceptance checks for each before writing code.
4. Build on a branch named `claude/YYYY-MM-DD-<slug>`. Run `npm run lint` and `npm run build`.
   For hardware work, run `skills/sprue/bin/sprue cad <slug>` (it runs `sprue system` too) and include the SVG previews from `products/<slug>/previews/` in the PR.
5. Open a PR. Wait for the Vercel preview and include its URL.
6. Pull live supplier offers first: `git fetch origin live-quotes && git checkout origin/live-quotes -- 'products/*/offers.*.json'`
   (skip if the branch doesn't exist yet). Then, once the scorer exists, run the pipeline end to end on the current reference product
   (`docs/pipeline.md`) and record the score in the PR and LOG. The score is this idea's metric. For a product with a
   board, run `skills/sprue/bin/sprue verify <slug>` before the score: it takes the board only with its self-tests. For a
   product with made parts, `skills/sprue/bin/sprue system <slug>` must have run on the files as they are, or the score fails.
   For a product with `reference/faults.json`, run `skills/sprue/bin/sprue faults <slug>` before the score (a few
   minutes, after the last change to the product or to the gates' code) and record the share caught and the false
   alarms with the score: the score passes only with every seeded fault caught and no false alarm.
7. Tick finished backlog items in `PLAN.md` and add any new ones you discovered.
8. Prepend a `LOG.md` entry using the template in that file.
9. Report in the idea's project thread: what shipped, the preview link, and the one decision needed, in three lines.

Model guidance: plan and review with Opus, build with Sonnet, summarize logs with Haiku.
Keep the run bounded: if a task is clearly larger than one PR, split it in the backlog instead.
