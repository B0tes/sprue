# LOG

Newest entry first. Each run adds one entry; Tobias can reply inline.

## 2026-10-13 (daily run)
**Shipped:** Cheaper keypad. The quoter now finds Adafruit switches and a 50-pack of M3 x 4 inserts, so two shops
(and their shipping) drop out of the order. The longer inserts needed a deeper boss; a new check confirms 1.0 mm of
plastic stays over each insert. Also: live DigiKey adapter and a `quote.yml` workflow that pushes offers to the
`live-quotes` branch, idle until the DigiKey secrets exist.
**Preview:** anatomy-2.vercel.app (landing page only)
**PR:** cheaper keypad + live quote job (stacked on pipeline v0)
**Metric:** coverage 100%, 0 failed of 14 checks, $88.34 vs $55-80 (+31%), files 2/3. Not passing.
**Needs Tobias:** DigiKey client ID and secret as repo Actions secrets; merge PRs #1 and #2.

## 2026-10-13 (re-plan)
**Shipped:** Re-planned around a seven-stage pipeline (`docs/pipeline.md`) and a ladder of reference products.
First rung: 3×3 USB macro keypad. Nexar dropped; DigiKey v4 is the primary parts API.
**Preview:** blocked (Vercel deploys need environment network settings)
**PR:** pushed to main (repo was empty)
**Metric:** no score yet
**Needs Tobias:** DigiKey API client ID and secret.

## 2026-10-13
**Shipped:** Repo set up from the World template. Landing page (hero with exploded coffee-machine drawing, animated
BOM demo with quote modes, automation gradient, hard-parts section, waitlist). Supplier API research in
`research/supplier-apis.md`.
**Preview:** pending Vercel
**PR:** initial commit
**Metric:** 0 of 12 demo lines live-quoted; 0 signups
**Needs Tobias:** create the GitHub repo, then Vercel + Supabase access and a Nexar API key.

## 2026-10-13 (first end-to-end run)
**Shipped:** Stage file formats, keypad answer key, case CAD (2 printable parts), stages 3-6 and the scorer.
`npm run pipeline macropad` writes checks, sourcing, quotes, `build-plan.md` and `score.json`.
The checks caught two real faults in the first design: the key grid was 0.15 mm wider than the PCB allowed, and
M3x10 screws would have bottomed out in the 3 mm inserts. Both fixed (1.9 mm edge margin, M3x8).
**Preview:** anatomy-2.vercel.app (landing page only)
**PR:** pipeline v0
**Metric:** coverage 100%, 0 failed checks, $109.75 vs $55-80 (+63%), 2/3 files. Not passing.
**Needs Tobias:** DigiKey client ID and secret as repo Actions secrets (live quotes will run in GitHub Actions).

<!-- Template:
## YYYY-MM-DD
**Shipped:** ...
**Preview:** <Vercel URL>
**PR:** <link>
**Metric:** <value or "n/a yet">
**Needs Tobias:** <one decision, or "nothing">
-->
