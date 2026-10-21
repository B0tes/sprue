# A public gallery for Sprue: research and design (2026-10-20, reviewed)

Written for Tobias's idea of 2026-10-20: a public list of products built with Sprue, like Anatomy's community gallery, with ratings and how many people built each one.

## What the review changed

I opened every page the draft cites (on 2026-10-20), read the vendored Anatomy scripts and checked the Sprue repo. Three kinds of change:

- **Claims fixed.** The important ones:
  - Several "staff said" claims about Printables and MakerWorld were made by forum users.
  - Thingiverse's makes count isn't shown by any cited page.
  - The OSHWA fine ladder starts at $500 a month, not $10,000.
  - The bundle sizes were off: they are 104 kB and 438 kB, not 113 kB and 490 kB.
  - The example `entry.json` misstated the macropad. It is at stage "design", not "build". Its board verdict comes from `pcb/verify.json`, not `score.json`. Its prices were captured 13 to 15 Oct. Its $83.34 includes estimates and is over its $75 budget. Today it is MIT-licensed, not CERN-OHL-S.
  - "No telemetry is needed" to count fetches was wrong.
- **Problems the draft missed:**
  - Git can't forget anything.
  - Every ordinary Sprue command runs the product's own code, not just `cad`.
  - An emulator can't clear firmware of a payload that waits for a time or a condition.
  - CI must not use `pull_request_target`.
  - GitHub's licence rule (content takes the repo's licence) and the DSA's report-and-removal duties apply.
  - Supplier API data may sit in the quotes.
  - Supabase's free plan pauses after a quiet week, and egress, not storage, limits photos.
  - Children's products and devices with cameras and microphones need their own rules.
- **A smaller MVP.** PR 1 becomes a print-only `sprue publish <slug>` that writes nothing into the repo. It leaves out the quote files, the reference files and every output. The draft's `products/<slug>/publish/` folder is dropped: it would have been committed and shipped in the skill zip. PR 2 is a GitHub issue form for build reports, which starts the build-reports-to-evals loop with no server. Fetch counts, the "ordered" ping, stars and Supabase move to later steps, or are dropped.

---

## What I recommend

- **Don't let the gallery take runs from the success metric.** PLAN.md's metric is the keypad pipeline (`PLAN.md` line 5), and the macropad's `score.json` has `"pass": false` today: the whole-product check fails with "bot and cable share 1.04 mm3". So keep gallery work to one daily run at a time until the keypad passes (CLAUDE.md's five-run rule).
- **PR 1: `sprue publish <slug>`, print only.** It decides what a design bundle holds, refuses personal data, and prints a manifest and file hashes. It uses no network, no account and no money, and writes nothing into the repo. Details in section 4.
- **PR 2: an "I built this" issue form on `B0tes/sprue`** for the two existing examples. GitHub then handles accounts, spam and storage. The structured outcome (works / works after fixes / doesn't work, and what went wrong, by area and BOM line) goes straight into the seeded-fault and trap triage of section 3.9. A gallery repo, a `/gallery` page and Supabase come only when an outside author asks to publish.
- **Keep designs in Git and people's data out of it.** Git keeps everything: deleted files stay in history, in forks and in pull-request refs ([GitHub docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)). A design's source can live there, but photos, build reports with personal detail, and anything a person may later ask to delete cannot.
- **Show separate counts, never one blended number, and only counts you can stand behind.** Use "build reports" (by outcome) and "works first time". Drop "fetched": counting it needs telemetry, and a release `download_count` is public and anyone can inflate it. "Said they ordered" waits for `/sprue track` (PLAN.md line 114).
- **Only builders can rate, and authors can't remove reviews.** MakerWorld users complain that critical ratings are removed after uploaders report them ([forum, Feb 2026](https://forum.bambulab.com/t/ratings-dont-mean-anything-anymore/232135)).
- **A design from a stranger is code.** Sprue `import()`s a product's `rules.ts` (`skills/sprue/pipeline/cli.ts:248`), `figure.mjs` (`pipeline/figure.ts:171`) and `cad/pcb.mjs` (`pipeline/pcb.ts:69`), and `cad/build.py` imports each `cad/*.py`. That gives them full user rights on ordinary commands (`check`, `figure`, `pcb`, `cad`). So a builder's fetch should bring CI-built outputs and data with no code. Firmware is accepted only if Sprue's generator wrote it.

---

## 1. How Anatomy's community gallery works

**What gets published.** Only the figure's source: `build.mjs`, the files it reads, `figure.json` and an optional README, in `figures/<author>/<id>/` of `wheresryan22/anatomy-community`. "There are no built pages or images in `main`"; CI builds the pages and the preview ([repo README](https://github.com/wheresryan22/anatomy-community)). The local preview the script takes is "not committed; CI makes the real one" (vendored `.claude/skills/anatomy/scripts/publish.mjs`, line 317).

- `figure.json` holds: `id`, `title`, `author`, `prompt`, `kind` (one of "SVG", "SVG + WebGL", "SVG + 3D", "SVG + WebGL + 3D"), `agent`, `model`, `minutes`, `tokens`, `skill.kit` (the kit fingerprint), `build`, `pages`, `preview`, `audit`, `license`, `tags` and `created` (`publish.mjs` lines 13 and 208–226).
- **The prompt is published.** The skill tells the agent to reuse it, "trimmed to 600 characters" (`references/publish.md`, step 2); `publish.mjs` itself doesn't trim it.
- The licence is MIT (the default) or CC-BY-4.0 (`publish.md`; the README: "MIT, unless a figure's `figure.json` says `CC-BY-4.0`").
- In Claude Code, minutes and tokens are read from the session's own log: from the request that made the figure to the request to publish it, leaving out idle gaps over 10 minutes and cache reads (`publish.md`).

**How it is published: a pull request, not an API.**
- `publish.mjs --submit` uses the `gh` CLI. It refuses to go on unless the signed-in login matches `--author`, forks the gallery if you can't push to it, and starts branch `figure/<id>` from the gallery's latest main. It commits only that folder, force-pushes, and opens a PR or reuses one that is already open (`submitPlan` and `submit`, lines 232–300).
- `--dry-run` shows the plan and stops. Without `--yes` it asks, and answers no when there is no terminal (lines 251–258, 279–280).
- The skill says: "Never send anything without their explicit yes" (`publish.md`).
- Without a terminal: put the source in a Gist and fill in the "Submit a figure" issue form. "A bot puts the files in the right folder, opens the pull request for you and links it in a comment" ([README](https://github.com/wheresryan22/anatomy-community)).

**The eight checks** ([README](https://github.com/wheresryan22/anatomy-community)):
1. **Scope:** only the author's own folder; no deletions, no CI changes, no edits to other people's figures.
2. **Files:** `.mjs .js .css .html .json .md .txt .svg` only, "at most 1 MB each and 2 MB in all", no built pages, images or symlinks.
3. **Code analysis:** refused if it reaches the network, environment variables, cookies or other windows, or uses `eval` or `Function`. Imports only from the skill, the figure's own files and five `node:` built-ins.
4. **Skill version:** read from the kit fingerprint.
5. **Locked build:** run twice in a pinned container (Node 22.23.3, Chrome for Testing 155) with no network, a read-only system, no privileges, and limited memory, processes and time. Both runs must match "byte for byte".
6. **Output:** the same scan on the built pages; 4 MB per page.
7. **Browser:** Chrome loads each page; the line check passes, nothing loads from outside, and the figure holds still with reduced motion on.
8. **Preview:** the chosen page becomes the poster.

"The checker always comes from `main`, never from the pull request. Figure code only ever runs inside the sandbox, with a read-only token and no secrets, and the jobs that write previews never run figure code." A check takes "about 2 minutes for a simple figure and 10–20 for a heavy one".

**Moderation.** "A maintainer reviews and merges." For maintainers the README recommends:
- protecting `main` with a review and the Scope and Check figures checks;
- requiring approval before workflows run for outside contributors;
- turning on private vulnerability reporting.

To take a figure down, a maintainer deletes its folder in a PR, and the Previews workflow drops its preview and index entry. There is a "Report a figure" form, a `SECURITY.md` and a code of conduct. Note that the deleted folder stays in Git history. Section 3.7 covers why that matters for Sprue.

**What a visitor sees** ([community page](https://skills.wheresryan.sh/anatomy/community), read 2026-10-20):
- 54 figures by 27 authors using 12 models, on 2 pages.
- Each card shows a preview, title, date, the author's avatar and handle, the start of the prompt, the model, the time and tokens (on some cards) and a kind badge.
- Counts by kind and tag are shown. They are not links, so whether they filter the list is unconfirmed.
- No ratings, likes, view counts or build counts.
- The site reads the `previews` branch: `index.json`, `feed/page-N.json` (48 per page), `feed/search.json` and one file per figure. It refreshes about a minute after a merge if `SITE_REVALIDATE_URL` is set, otherwise within five minutes ([README](https://github.com/wheresryan22/anatomy-community)).
- The repo showed 1 star, 1 fork and 45 commits on 2026-10-20 ([repo](https://github.com/wheresryan22/anatomy-community)).

**What to copy and what doesn't fit.**
- **Copy:** source only, rebuilt by CI; a fingerprint of the tool's version; a dry run and the user's yes; a folder per author; the checker run from `main` with no secrets; report and security channels.
- **Doesn't fit, part 1.** An Anatomy visitor only looks at a sandboxed page. A Sprue builder would run the design's Python CAD and its JavaScript board, rules and figure code, all through Sprue's ordinary commands, plus CircuitPython firmware on their own Pico.
- **Doesn't fit, part 2.** Builds, photos and ratings have no natural home in a PR-only gallery, and Git can't delete them.
- **Leave out:** reading the session log for minutes and tokens. It isn't needed, and it reads a private file.

---

## 2. Other public galleries: ratings, makes, remixes and proof of a build

| Platform | How someone says "I made it" | Shows how many built it? | How that is checked | Ratings | Remixes | Source |
|---|---|---|---|---|---|---|
| **Printables** | A "Make", a photo post. Forum members (no staff in the thread, Nov 2022) say it must link to a Printables model | One combined "Makes & Comments" count (1 on the sample) | None; self-reported photo. Makes earn 1–10 Prusameters, up to 100 a month; fewer points for a model with many makes; none for a make of your own model or for repeat makes of the same model | Reviews ("1 reviews" on the sample). A forum "Member Admin" said in Jul 2022 that you must download a model to rate it | "Remixes" count (0 on the sample) | [model page](https://www.printables.com/model/73427-adafruit-macropad-rp2040-notched-standsholder-rota), [make needs a model](https://forum.prusa3d.com/forum/english-forum-general-discussion-announcements-and-releases/printables-model-required-to-post-a-make), [rating thread](https://forum.prusa3d.com/forum/english-forum-general-discussion-announcements-and-releases/printables-rating-system-issue), [Prusameters](https://help.prusa3d.com/ja/article/prusameters-review_365065) |
| **Thingiverse** | Makes: a photo of the print with printer details, "evidence that other people have had success" | **Unconfirmed:** no cited page says a makes count is shown | None (photo) | Likes and collections | "Information about the heritage of most 3D models" (Fabbaloo); remixing "is the basis for half of the designs" (a contributor's summary of a study, 2017). MyMiniFactory bought it in Feb 2026 | [JMU guide](https://sites.lib.jmu.edu/adrihooker/how-to-use-thingiverse), [Fabbaloo](https://www.fabbaloo.com/2017/09/analyzed-remixing-3d-models-on-thingiverse), [Wikipedia](https://en.wikipedia.org/wiki/Thingiverse) |
| **MakerWorld** (Bambu) | A print recorded in Bambu Cloud's print history | Prints are counted | The closest to proof here, with caveats. Nov 2023: "the rating feature depends on the print history"; incognito, SD-card and printer-started prints aren't recorded. These come from poster Tanklet, whom the page doesn't label as staff; the LAN point is from a user. Jan 2024, Tanklet: "We consider adding a model rating feature", so this may be out of date. Users (Feb 2026): you can rate after sending a print and cancelling it, and critical ratings get removed after uploader reports. Users (Oct 2025, Feb 2026): a failed print can't get more than 3 stars. A user (Aug 2024) says only five downloads or prints a day count; a quoted footnote, author not shown, says "daily user download count ≤ 5" | Stars on print profiles, not on models (users, Oct 2025). One user says 95% of the ratings they give are 5 stars; that is one person's habit, not a measurement | Yes | [rating thread](https://forum.bambulab.com/t/why-cant-i-rate-anything/37828), [complaints](https://forum.bambulab.com/t/ratings-dont-mean-anything-anymore/232135), [rating system](https://forum.bambulab.com/t/makerworld-rating-system/201143), [what counts as a print](https://forum.bambulab.com/t/what-exactly-constitutes-a-print/95303) |
| **Cults3D** | A "📸 Make" button | Yes: "📸 0 makes" | None (photo) | "Creation quality: 5/5 (1 vote)"; 2 likes, 9 downloads, 670 views | None on the page ("Other designs you may like" only) | [model page](https://cults3d.com/:990153) |
| **Instructables** | "I Made It" posts that share "results and modifications"; students aged 13 and over can hand in work without a full Instructable | Unconfirmed (pages are drawn by JavaScript) | None (photo) | Favorites | No | [EngineerFix, 10 Nov 2025](https://engineerfix.com/how-to-use-instructables-for-diy-projects/), [teacher's guide](https://www.instructables.com/I-Made-It-a-Teachers-Guide/) |
| **Hackaday.io** | "Things I've Built" is for your own projects "that you don't have enough material to document": one image and a summary. It isn't a way to say you built someone else's design | No; likes, followers and views (e.g. "46 likes", "55 followers") | None | Likes | No | [Everything 101](https://hackaday.io/project/46/log/460), [Kitspace project page](https://hackaday.io/project/11871-kit-space) |
| **Kitspace** | None. A public Git repo is added by editing `boards.txt` (v2 README; the older Hackaday page describes a `1-click-bom.tsv` setup). It processes a 1-click BOM, Gerbers and an Interactive HTML BOM assembly guide | No | n/a | No | Through Git | [kitspace-v2](https://github.com/kitspace/kitspace-v2), [Hackaday.io page](https://hackaday.io/project/11871-kit-space) |
| **PCBWay shared projects** | Order the shared board from PCBWay | **No.** The sample shows "3,508 views", Likes(1), "Download Gerber file 33", 0 votes, and a "Donation Received ($)" label with no amount; no order count | PCBWay approves projects "after review" and gives the sharer "10% of the order amount" as PCBWay credit | Votes (0) | No | [help centre](https://www.pcbway.com/blog/help_center/Shared_Projects_PCBWay_Community_PCBWay_Website_Exploration_05_17c562d8.html), [3x3 keypad](https://www.pcbway.com/project/shareproject/Macro_Keypad_8f98031d.html) |
| **OSH Park shared projects** | Order the shared board | No; cards show size, upload and shared dates, and price | n/a | No | No | [shared projects](https://oshpark.com/shared_projects/page/69.html) |
| **OSHWA certification** | Not a gallery of builds: a registry of designs that meet the open source hardware definition | No | Self-certification; "Registration is free". UID: a country code plus six digits (US000001), with each new version registered. OSHWA reviews public documentation for projects certified before launch. Complaints go to certification@oshwa.org. Penalties climb in stages: none at first, a public noncompliance list after 120 days, up to $500 a month after 180 days, $1,000 after a year, and up to $10,000 a month after two years. Neither page addresses quality or safety | No | Can name the hardware it builds on | [requirements](https://certification.oshwa.org/requirements.html), [FAQ](https://certification.oshwa.org/basics/faq.html) |

**What the photo galleries get right:** a make is cheap to post, a photo persuades, and the count sits next to the model (Cults shows "0 makes"; Printables combines makes and comments in one count). Printables limits points farming: fewer points for popular models, and none for your own model or repeat makes ([Prusameters](https://help.prusa3d.com/ja/article/prusameters-review_365065)).

**What they get wrong:**
- A photo says nothing about whether the device works.
- Ratings stop meaning anything when critical ones can be removed on the uploader's report ([MakerWorld users](https://forum.bambulab.com/t/ratings-dont-mean-anything-anymore/232135)).
- Counting downloads or prints is not counting builds: "There are no metrics that will tell you if 50 copies of your model have been made" (user MalcTheOracle, Aug 2024, [forum](https://forum.bambulab.com/t/what-exactly-constitutes-a-print/95303)).
- Even a fab that sees the orders doesn't show them (PCBWay's sample page).

**What OSHWA adds:** it "asks for information about three separate licenses": hardware, software and documentation ([Weinberg, 5 Oct 2025](https://michaelweinberg.org/blog/2025/10/05/leading-licenses/)). Sprue's manifest does the same.

---

## 3. Design for Sprue

### 3.1 Where it lives, in order

| Step | What | Why this order |
|---|---|---|
| **Now** | Build reports as a GitHub issue form on `B0tes/sprue` for the two examples | No server and no new accounts. GitHub's own reporting and moderation apply. It tests whether anyone builds at all before anything is built for them |
| **When an outside author asks to publish** | A separate gallery repo (e.g. `B0tes/sprue-gallery`), designs added by PR, CI rebuilds them | Untrusted CI stays out of the Sprue repo. A remix is a fork; review happens before merge. Actions are free for public repos on standard runners ([GitHub docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)), so the repo must be public |
| **When issues can't carry it** | Supabase for builds, photos and ratings, signed in with GitHub ([docs](https://supabase.com/docs/guides/auth/social-login/auth-github)) | Brings a privacy notice, deletion, photo moderation and probably a paid plan (section 3.7). PLAN.md defers Supabase "until there is an app to store runs in" (line 118) and plans a fallback for when its env vars are missing (line 117) |

Platform limits, read 2026-10-20:
- **Supabase Free:** 500 MB database, 1 GB storage, 5 GB egress (plus 5 GB cached), 50 MB per upload, 2 active projects, and "Free projects are paused after 1 week of inactivity". No image transformations. Pro is from $25 a month, with 100 origin images included, then $5 per 1,000 ([pricing](https://supabase.com/pricing.md)).
- **Vercel Hobby:** "restricts users to non-commercial, personal use only". On Pro, developer seats cost "$20 per user / month" ([Vercel](https://vercel.com/docs/plans/hobby)).

My arithmetic: at about 300 KB a photo, 1 GB of storage holds about 3,300 photos, but 5 GB of egress is only about 17,000 photo views a month. Egress is the limit that binds. Any paid plan is spending money and waits for Tobias's OK (CLAUDE.md).

### 3.2 What a bundle holds (PR 1)

An allowlist of source only, so outputs can be rebuilt. Measured with `du -b` on today's files: **104 kB for the macropad and 438 kB for Ponder**, including `reference/`. Without `reference/` they are 98 kB and 432 kB. The full folders are 4.2 MB and 27 MB; 20 MB of Ponder's is STLs in `fab/`.

| Sent | Rebuilt by CI (later) | Never sent |
|---|---|---|
| `request.json`; the brief is printed for the author to read, since no scan can find a name | `fab/`, `pcb/`, `previews/`, `figure.svg`, `view.html`, `explorer.json`, `build-plan.md` | `catalog.json`, `sourcing.json`, `quotes.json` in v1 (a cost summary goes in the manifest instead; see 3.7, "Supplier data") |
| `design.json`, `design.md`, `bom.json` | `checks.json`, `system.json`, `score.json`, `faults.json`, `pcb/verify.json` | `offers.*.json`. The skill zip already skips these (`scripts/build-skill-zip.mjs`, line 18) |
| `cad/*.py`, `cad/pcb.mjs`, `figure.mjs`, `rules.ts` | | `reference/` in v1 (the author's answer key and seeded faults; add later) |
| `firmware/README.md`, and `firmware/code.py` only if Sprue's generator wrote it (the `ours()` test in `pipeline/pcb.ts`, lines 161 and 225); hand-written firmware is refused in v1 | | `pcb/order/`, `history/`, `shots/`, `state.json` (only the stage is sent), `firmware/fil.json`, `.env*`, symlinks, files outside the folder |

**Privacy scan** (refuse, and name the file and line):
- absolute home paths (`/Users/<name>`, `/home/<name>`, `C:\Users\`);
- email addresses and phone numbers;
- assignments that look like secrets (`*_SECRET=`, `*_TOKEN=`, `*_KEY=`, e.g. `NEXAR_CLIENT_SECRET=` from `.env.example`, `DIGIKEY_CLIENT_SECRET` from `cli.ts:508`) and URL query keys like `api_key=`.

It can't find names or street addresses written in prose. That is why the brief is printed and the author reads it. Today's two products contain none of these: I grepped every file in both folders for names, `Italy`, home paths and emails, and found none.

**Manifest:** `entry.json`. Sprue's two examples would produce this one:

```json
{
  "id": "macropad", "version": 1,
  "title": "3x3 USB macro keypad", "brief": "...<=600 chars, read by the author...",
  "stage": "design",
  "licence": { "hardware": "MIT", "software": "MIT", "documentation": "MIT", "from": "skills/sprue/LICENSE" },
  "parent": null,
  "sprue": { "fingerprint": "sha256:..." },
  "claimed": {
    "board":  { "status": "verified", "from": "pcb/verify.json", "note": "our own checks, not a fab's" },
    "system": { "ok": false, "failed": ["overlap", "clearance"], "detail": "bot and cable share 1.04 mm3" },
    "faults": { "caught": 10, "ran": 10, "falseAlarms": 0 },
    "checks": { "ran": 17, "failed": 0, "flagged": 3 },
    "pass": false
  },
  "cost": { "batchUsd": 83.34, "units": 1, "region": "US", "budgetUsd": 75,
            "captured": "2026-10-13..15", "includesEstimates": true },
  "files": { "design.json": "sha256:...", "cad/top.py": "sha256:..." }
}
```

Where each value comes from, read 2026-10-20:
- `stage` and its status ("proposed") are from `state.json`.
- `system`, `faults`, `checks` and `pass` are from `score.json`.
- `board` is from `pcb/verify.json` (git-ignored, so CI must rebuild it).
- The cost is from `quotes.json` and `request.json`. Its lines mix shop-page snapshots with estimates: Craftcloud's line says "unverified rate, not a quote", and several shipping lines are estimates. So the card must say "estimate". The $83.34 is also over the request's $75 budget.
- The licence is MIT because the examples sit under `skills/sprue/LICENSE`.

The manifest has no `author` (CI takes it from the PR) and no agent, model, minutes or tokens.

**Consent:** the command prints every file, its size and hash, and the brief. Later, `--submit` (PR 4) asks for an explicit yes, as Anatomy does. The consent text should say that published source is permanent, because Git history and forks keep it.

### 3.3 Verdicts: what the author claims and what CI finds

A verdict chip shows only when the gallery's CI produced it, labelled "passed Sprue `<fingerprint>` checks on `<date>`; our own checks, not a fab's". That last phrase is the note `pcb/verify.json` already carries. Don't use a bare "VERIFIED" for a stranger's design: it reads as Sprue vouching for it.

CI runs `validate`, `cad`, `pcb`, `verify`, `system` and `check` (and `faults` if the entry has seeded faults) in a pinned container with no network.

**The run-twice rule needs one exception.** Two runs of `cad/build.py` on the macropad in a scratch copy gave byte-identical `top.stl`, `bottom.stl` and preview SVGs, matching the repo's own `top.stl`. The two `.step` files differed only in the `FILE_NAME` timestamp line. The Gerber zip is written with a fixed 1980 timestamp so the same board gives the same bytes (`pipeline/pcb/gerber.ts:230`). So: compare STL, SVG, Gerbers and verdict JSON byte for byte, and STEP with the header line removed. Whether output matches across machines (other OCCT builds or CPUs) is unconfirmed.

If CI disagrees with the author's claims, the entry stays pending and shows the difference. After each change to Sprue's gates, all entries are checked again, in batches as Anatomy does with 30 at a time: "fails under Sprue vX: <problem>" and "caught since vX".

**CI security.** Run untrusted code only under `pull_request`, with no write token and no secrets. Do any commenting or preview publishing in a separate `workflow_run` job that treats the artifacts as data. Never use `pull_request_target` with a checkout of the PR: GitHub Security Lab calls that "a dangerous practice that may lead to repository compromise" ([GitHub Security Lab](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)).

### 3.4 What a builder fetches (PR 4)

`sprue example <author>/<id>[@v]` fetches a merged version by its hash:
- the data files (`design.json`, `bom.json`, `design.md`);
- the CI-built outputs (STL, Gerbers, `board.json`, build plan, figure);
- firmware regenerated on the builder's machine by the builder's own Sprue from the board.

It doesn't fetch the code (`cad/*.py`, `*.mjs`, `rules.ts`), because Sprue's ordinary commands would run it. Remixing needs the code. That takes an explicit `--with-code`, which says plainly that the code will run with the user's rights, and preferably runs it in a container. A yes/no prompt alone is not a security control.

### 3.5 Counting

- **Build reports: K, by outcome.** Taken from the issue form now and from a `builds` table later.
  - Below 5 reports, show raw counts and no percentage.
  - The author's own report shows as "author's build" and isn't counted.
  - An `abandoned` report keeps its reason.
- **Works first time: x of K.**
- **Dropped: "fetched by N".**
  - Counting fetches means the CLI calls a Sprue server, which sees an identity or an IP address. IP addresses are personal data ([GDPR Recital 30](https://gdpr-info.eu/recitals/no-30/)), so this is telemetry, contrary to the draft.
  - A GitHub release's `download_count` is public. The docs don't say whether repeats count ([GitHub docs](https://docs.github.com/en/rest/releases/assets)), and anyone can raise it with a script. It counts downloads, not people.
- **Later: "said they ordered",** an opt-in from `/sprue track` (PLAN.md line 114) that sends only the version id.
- **Later: "photo with code".** Sprue would write `<author>/<id> v<n>` on the board's back silkscreen. This is a new change to `cad/pcb.mjs`. The PLAN.md item cited for it (line 37) is about drawing, in the figure, the silkscreen `pcb.mjs` already writes. A photo of the board proves which version was made, not that the device works.

### 3.6 Ratings (later, once entries have 5 or more builds)

- Only people with a build report can rate.
- The headline is the outcome and what went wrong, by area and BOM line. Stars, "would build again" and "the quote was under / about / over" come second.
- Authors can reply but not delete. A maintainer removes a review only for breaking a rule, with a public note that says why (see the DSA row in 3.7).
- Show the whole spread of stars, not only the average.

### 3.7 Risks and controls

| Risk | Control |
|---|---|
| **Code runs on the builder's machine.** Ordinary commands `import()` `rules.ts`, `figure.mjs` and `pcb.mjs`, and `cad/build.py` imports `cad/*.py` (they use `build123d`, `_params`, `json`, `math`, `pathlib`, `importlib`, `sys`, `numpy` and Sprue's `system` module) | Fetch outputs, not code (3.4); remixing with code is explicit and preferably in a container. In the gallery: Anatomy-style scope and file checks, a static import scan (a first filter only: audit hooks are "not sandboxing", [PEP 578](https://peps.python.org/pep-0578/)), the locked rebuild, and pinning the hash CI checked |
| **Malicious firmware.** A CircuitPython Pico can act as a keystroke-injection device ([PicoW-Ducky](https://github.com/SourasishBasu/PicoW-Ducky)). An emulator run only covers what it exercises, so a payload that waits for a time or the 50th key press gets past it | v1 accepts only generator-written `code.py` (`ours()`), and the builder regenerates it locally. Hand-written firmware is refused, not just marked. The emulated-Pico check and reading HID reports off rp2040js's USB (PLAN.md line 84) still run as an extra check |
| **Git keeps everything.** Deleted folders stay in history, forks and PR refs. "GitHub Support won't remove non-sensitive data" ([GitHub docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)) | Nothing personal in the gallery repo beyond the GitHub login the author chose to make public. Consent says the source is permanent. Photos and builder details never go in Git |
| **Personal data in Supabase (later).** Signing in with GitHub stores an account. Which GitHub fields Supabase keeps (email?) isn't on its page: unconfirmed | Before it ships: a privacy notice (the site has none today; nothing in `src/` mentions privacy), a list of processors (GitHub, Supabase, Vercel), and account deletion that removes builds, photos and ratings "without undue delay" and recomputes counts ([GDPR Art. 17](https://gdpr-info.eu/art-17-gdpr/)). No address, order-number or country fields |
| **Photos.** Phone photos carry GPS in EXIF ([blur.me, Jun 2026](https://www.blur.me/blog/remove-exif-gps-metadata-from-photos/)), and they can also show faces, children, rooms and parcel labels | Issue-form era: the form tells people to crop and remove location data. Whether GitHub strips EXIF from issue attachments is unconfirmed. Supabase era: strip EXIF on the server and hold every photo for review before it shows |
| **Minors.** GitHub requires age 13 or over ([GitHub terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)). GDPR's default age of consent for online services is 16, and member states may lower it to no less than 13 ([Art. 8](https://gdpr-info.eu/art-8-gdpr/)); Italy's age is unconfirmed. Ponder is "for kids 6 to 14" (`products/ponder/request.json`) | Sign-in with GitHub only; no photos of children; the age rule is in the privacy notice |
| **Reports become eval data** | The form asks for consent to turn a report into a test case in the Sprue repo under its licence. Copied cases carry `"source": "build:<n>"`, never the person's id, so deleting an account leaves no trace in the repo |
| **Products that can hurt people** | Refuse mains voltage and weapons (Thingiverse's terms bar content that "contributes to the creation of weapons" and it took down a gun design in 2012, [Wikipedia](https://en.wikipedia.org/wiki/Thingiverse)). Flag lithium batteries, heaters, children's products and devices with cameras or microphones. Ponder is all of the last two: camera and microphones to the cloud, `toyClassification: "undecided"` (`design.json`). Every entry carries "not certified, personal build" |
| **Fake builds and stuffed counts** | GitHub login, one report per user per version, a minimum account age (a design choice, e.g. 30 days), the author's own activity left out, outliers reviewed, no fetch counts |
| **Hiding critical reviews** | Authors can't remove reviews (the MakerWorld lesson) |
| **Reports and removals (EU DSA)** | Recital 50 says notice-and-action mechanisms apply to "all providers of hosting services, regardless of their size". Recital 57 limits the micro and small enterprise carve-out to the extra duties of online platforms ([DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065)). I couldn't read the articles themselves (the page was cut off), so the exact duties are unconfirmed. Plan for a Report form and a short public reason for each removal |
| **Licences in a shared repo.** GitHub's terms: content added to a repository with a licence notice is licensed "under the same terms" ([GitHub terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service), D.6) | The gallery README states the rule, as Anatomy's does ("MIT, unless a figure's `figure.json` says `CC-BY-4.0`"), and each entry folder carries its own LICENSE files for the three parts |
| **Supplier data.** `sprue digikey` writes live API offers to `offers.digikey.json`, and `explore.ts` (lines 143–149) merges them into the catalog, so a chosen DigiKey offer can reach `quotes.json` | Whether DigiKey's API terms allow republishing is unconfirmed. v1 sends no catalog or quote files, only the cost summary; offers from public shop pages can come later with their dates |
| **AI-made designs and copyright** | Whether a mostly AI-generated design is protected by copyright, and so whether its licence binds anyone, is unconfirmed. The statement reads "I made this with Sprue and have the right to share it", not "my own work" |
| **Product liability** | Unconfirmed, and a question for a lawyer if the gallery turns commercial. Until then: the "personal build" banner, and chips that describe checks, not guarantees |
| **Spam** | A maintainer approves a first-time publisher; workflows for outside contributors need approval, as Anatomy recommends |

### 3.8 Licences

The manifest asks for three licences, as OSHWA does ([Weinberg](https://michaelweinberg.org/blog/2025/10/05/leading-licenses/)). **The two examples are MIT today** (`skills/sprue/LICENSE` covers `skills/sprue/examples/`), so their manifest says MIT. Relicensing them is Tobias's call. My understanding, not legal advice and unconfirmed: copies already published under MIT stay usable under MIT.

For new entries:

| Part | Default | Alternatives | Why |
|---|---|---|---|
| **Hardware**: CAD and board code, `design.json`, `bom.json`, their exports | **Tobias's call:** CERN-OHL-S-2.0 ("Permissions of this strongly reciprocal license for hardware designs are conditioned on making available complete sources", [choosealicense](https://choosealicense.com/licenses/cern-ohl-s-2.0/)) or CERN-OHL-P-2.0 ("A permissive license for hardware designs, with conditions only requiring preservation of notices", [choosealicense](https://choosealicense.com/licenses/cern-ohl-p-2.0)) | CERN-OHL-W; CC BY-SA 4.0 for print-only products. The JMU guide says most Thingiverse designers use Attribution-ShareAlike ([JMU](https://sites.lib.jmu.edu/adrihooker/how-to-use-thingiverse)); Stacksheriff only lists CC BY-SA among common Printables licences ([Stacksheriff](https://stacksheriff.com/3d-printing/printables-guide/?format=md)) | OSHWA hardware licences in "2025 (so far)", to about 5 Oct 2025: CERN-OHL-S 52, Other 46, CERN-OHL-P 35 ([Weinberg](https://michaelweinberg.org/blog/2025/10/05/leading-licenses/)). CERN's open source office: "There is no particular variant which is recommended by default" ([CERN OSPO](https://ospo.docs.cern.ch/recommendations/licensing)). S keeps remixes open; a remix of an S entry can't be relicensed P |
| **Software**: firmware, `rules.ts`, `figure.mjs` | MIT | GPL-3.0-or-later | MIT is Sprue's licence and Anatomy's, and the most used software licence in 2025 OSHWA certifications (79) |
| **Documentation**: `design.md`, build plan, figure, photos | CC BY-SA 4.0 | CC BY 4.0 | In 2025 OSHWA documentation counts, CC BY-SA appears as "CC BY-SA" 48 and "CC-BY-SA-4.0" 45; MIT became a hardware and documentation option in Aug 2025 |

Bought parts' STEP files and datasheet drawings are never bundled, only envelopes and numbers, as today. A finished entry can get a "Ready for OSHWA" checklist pointing to the free self-certification ([FAQ](https://certification.oshwa.org/basics/faq.html)); Sprue never applies on anyone's behalf.

### 3.9 How real builds feed Sprue's evals

1. **Triage each reported problem** (Claude proposes, Tobias confirms) into one of:
   - **Seeded fault:** a gate should have caught it. Add to the product's `reference/faults.json`. Today's entries have `id`, `area`, `fault`, `edit` and `expect`; `source` would be a new field, and whether `sprue faults` accepts unknown fields is unconfirmed. Until a gate catches the new fault, `faults.ok` fails. That is the loop that produced the printed-wall check (PLAN.md line 32).
   - **Trap:** a design-judgment miss. Add to `traps[]` in `evals/ideas/keys/<idea>.json`, with the CO2 key's fields: `id`, `stage`, `requirement`, `why`, `evidence`, `pass_if`, `severity`.
   - **Calibration:** paid against quoted, per line. Feeds the ±25% cost band (PLAN.md line 5) and the "Quotes for Italy" item (line 41).
   - **Tolerance:** a measured fit. Feeds the later worst-case tolerance stack of "±0.3 mm per printed part" (line 57).
   - **Won't fix.**
2. **Compare verdicts with outcomes:**
   - real-world misses: the design passed and the build failed;
   - false alarms: the design was flagged and builders say it was fine.
   Report both next to the seeded-fault rate once there are enough reports. With a handful of reports these are anecdotes, and should be called that.
3. **Check every entry again after each change to the gates.** A new failure on a build reported as working is a false-alarm regression.

### 3.10 What a visitor sees (later)

- **The card:** the figure as a poster, the title and author.
  - The cost as an estimate: "about $83 for 1 unit, US, prices from 13–15 Oct 2026, includes estimates".
  - CI chips: board passed Sprue's checks · whole product: 2 fails · seeded faults 10/10 · checks 0 failed, 3 flagged.
  - Build reports by outcome.
  - Filters: has a board, print-only, cost band, verdict.
- **The entry page:**
  - the interactive figure (the site's existing `WorkedExample`, `src/components/WorkedExample.tsx`);
  - the BOM lines, and the checks with their flags;
  - build reports, each linked to what Sprue changed since;
  - versions and parents, and the three licences;
  - one line to copy: `/sprue example <author>/macropad@1`.

---

## 4. MVP and later steps

Each step is one small PR sized for a daily run. Efforts are my estimates.

| # | PR | What it delivers | Effort | Depends on |
|---|---|---|---|---|
| **1 (MVP)** | **`sprue publish <slug>`**, print only | Prints the allowlisted files (3.2) with size and sha256, the brief to read, and `entry.json`, all to stdout. It writes nothing under `products/`: `products` links to `skills/sprue/examples/`, which is tracked and zipped into the skill, and the draft's `publish/` folder would be in neither `.gitignore` (lines 43–50) nor the zip's skip list. An optional `--out <dir>` writes the bundle outside the repo and refuses a path inside it. The privacy scan refuses with file and line. Hand-written firmware is refused. **Tests:** a planted email, home path, phone number and `*_SECRET=` are refused; a hand-written `code.py` is refused; `offers.*.json`, `fab/`, `pcb/`, `history/`, `shots/`, `state.json`, `fil.json`, `.env*`, symlinks and the quote files never get in; two runs print the same hashes; both bundles stay under 1 MB; the repo's `git status` is unchanged afterwards. **Docs:** a SKILL.md row and a run.md section. No network, no account | 1 run | nothing |
| 2 | "I built this" issue form on `B0tes/sprue` | `.github/ISSUE_TEMPLATE/build-report.yml`: product and version, outcome, problems by area and BOM line, actual cost and currency, hours, an optional photo with a warning about faces and location, and consent to reuse the report as a test case. Plus a link from `view.html` and the worked example. Triage by hand into 3.9 | under 1 run | nothing (can come before 1) |
| 3 | Gallery repo and CI | `B0tes/sprue-gallery`: scope, file and static checks; a locked rebuild run twice (STEP header removed); the gates re-run; generator-only firmware; the claimed-vs-found diff; `pull_request` plus `workflow_run` only. Creating a repo is Tobias's call | 2–3 runs | 1; an outside author who wants to publish |
| 4 | Submit and fetch | `sprue publish --submit` through `gh`, mirroring Anatomy's `submitPlan`. `sprue example <author>/<id>[@v]` fetches outputs and data by hash, with no code unless `--with-code` | 1–2 runs | 3 |
| 5 | `/gallery` on the site, read-only | Static pages at `prebuild` (as `scripts/copy-figures.mjs` does) from the gallery repo and the build-report issues. No accounts | 1 run | 3 |
| Later | Supabase layer | Only if issues can't carry it: the privacy notice, deletion, photo moderation queue, DSA reasons, ratings for builders only, the opt-in "ordered" ping, the silkscreen id, remix licence checks | 4–6 runs | 5; a Supabase project and probably a paid plan |

**Dropped from the draft:** fetch counts; the `uses` table; minutes and tokens from the session log; writing `products/<slug>/publish/`; quote and catalog files in the bundle; the per-user-per-day dedup route.

**Decisions Tobias owes:**
1. Whether to start gallery work now, at one run at a time, while the keypad's `pass` is false. I recommend PR 1 and PR 2 only.
2. Whether to add the build-report issue form to `B0tes/sprue` (recommended: yes).
3. When the time comes, a separate gallery repo or a folder in `B0tes/sprue` (recommended: separate, to keep untrusted CI out).
4. The default hardware licence for new entries (CERN-OHL-S or P), and whether to relicense the two MIT examples.
5. Whether entries with failing verdicts may be listed (recommended: yes, shown as they are).
6. Whether children's products and camera or microphone devices may be listed in v1, with flags, or are refused. This decides Ponder.

## Not confirmed

- Whether the Anatomy community page's kind and tag labels filter the list (they aren't links).
- Whether Thingiverse shows a makes count on model pages, and how makes work since MyMiniFactory took over in Feb 2026.
- Whether Instructables shows an "I Made It" count.
- MakerWorld's rules: the five-a-day limit (from a user and an unattributed footnote), whether Tanklet is staff, and whether 2023's "rating depends on print history" still holds.
- Whether Printables still requires a download before rating (forum admin, 2022).
- Whether any PCBWay shared project shows an order count (the sample doesn't).
- Whether GitHub's release `download_count` counts repeats.
- Which GitHub fields Supabase stores at sign-in.
- Whether GitHub strips EXIF from issue attachments.
- Italy's age of digital consent.
- The DSA article text; I read only recitals 50 and 57.
- DigiKey's API terms on republishing offer data.
- Copyright in AI-generated designs, and product liability for a design gallery.
- Whether CAD outputs match byte for byte across machines (they match on one machine, apart from the STEP timestamp).
- Whether `sprue faults` accepts a new `source` field.
- My web search budget ran out partway through, so the DSA, age-of-consent, DigiKey, Copyright Office and product-liability points weren't searched.

## Sources

- **Anatomy:**
  - [community page](https://skills.wheresryan.sh/anatomy/community)
  - [anatomy-community README](https://github.com/wheresryan22/anatomy-community)
  - vendored `/home/claude/sprue/.claude/skills/anatomy/references/publish.md` and `/home/claude/sprue/.claude/skills/anatomy/scripts/publish.mjs` (upstream wheresryan22/anatomy at 454a0ef, `VENDORED.md`)
- **Printables:**
  - [model page](https://www.printables.com/model/73427-adafruit-macropad-rp2040-notched-standsholder-rota)
  - [make needs a model](https://forum.prusa3d.com/forum/english-forum-general-discussion-announcements-and-releases/printables-model-required-to-post-a-make)
  - [rating thread](https://forum.prusa3d.com/forum/english-forum-general-discussion-announcements-and-releases/printables-rating-system-issue)
  - [Prusameters](https://help.prusa3d.com/ja/article/prusameters-review_365065)
  - [Stacksheriff](https://stacksheriff.com/3d-printing/printables-guide/?format=md)
- **Thingiverse:**
  - [JMU guide](https://sites.lib.jmu.edu/adrihooker/how-to-use-thingiverse)
  - [Fabbaloo 2017](https://www.fabbaloo.com/2017/09/analyzed-remixing-3d-models-on-thingiverse)
  - [Wikipedia](https://en.wikipedia.org/wiki/Thingiverse)
- **MakerWorld:**
  - [rating and print history](https://forum.bambulab.com/t/why-cant-i-rate-anything/37828)
  - [ratings complaints](https://forum.bambulab.com/t/ratings-dont-mean-anything-anymore/232135)
  - [rating system](https://forum.bambulab.com/t/makerworld-rating-system/201143)
  - [what counts as a print](https://forum.bambulab.com/t/what-exactly-constitutes-a-print/95303)
- **Other galleries:**
  - Cults3D: [model page](https://cults3d.com/:990153)
  - Instructables: [EngineerFix](https://engineerfix.com/how-to-use-instructables-for-diy-projects/), [teacher's guide](https://www.instructables.com/I-Made-It-a-Teachers-Guide/)
  - Hackaday.io: [Everything 101](https://hackaday.io/project/46/log/460), [Kitspace project](https://hackaday.io/project/11871-kit-space)
  - Kitspace: [kitspace-v2](https://github.com/kitspace/kitspace-v2)
  - PCBWay: [shared projects help](https://www.pcbway.com/blog/help_center/Shared_Projects_PCBWay_Community_PCBWay_Website_Exploration_05_17c562d8.html), [3x3 keypad](https://www.pcbway.com/project/shareproject/Macro_Keypad_8f98031d.html)
  - OSH Park: [shared projects](https://oshpark.com/shared_projects/page/69.html)
- **OSHWA and licences:**
  - [OSHWA requirements](https://certification.oshwa.org/requirements.html)
  - [OSHWA FAQ](https://certification.oshwa.org/basics/faq.html)
  - [Weinberg licence counts](https://michaelweinberg.org/blog/2025/10/05/leading-licenses/)
  - [CERN-OHL-S](https://choosealicense.com/licenses/cern-ohl-s-2.0/)
  - [CERN-OHL-P](https://choosealicense.com/licenses/cern-ohl-p-2.0)
  - [CERN OSPO](https://ospo.docs.cern.ch/recommendations/licensing)
- **Platforms:**
  - [Supabase pricing](https://supabase.com/pricing.md)
  - [Supabase GitHub login](https://supabase.com/docs/guides/auth/social-login/auth-github)
  - [Vercel Hobby](https://vercel.com/docs/plans/hobby)
  - [GitHub release assets](https://docs.github.com/en/rest/releases/assets)
  - [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  - [GitHub removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
  - [GitHub terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
  - [GitHub Security Lab on pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
- **Security, privacy and law:**
  - [PEP 578](https://peps.python.org/pep-0578/)
  - [PicoW-Ducky](https://github.com/SourasishBasu/PicoW-Ducky)
  - [GDPR Art. 17](https://gdpr-info.eu/art-17-gdpr/)
  - [GDPR Art. 8](https://gdpr-info.eu/art-8-gdpr/)
  - [GDPR Recital 30](https://gdpr-info.eu/recitals/no-30/)
  - [DSA (Regulation 2022/2065)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065)
  - [EXIF GPS](https://www.blur.me/blog/remove-exif-gps-metadata-from-photos/)
- **Sprue files read:**
  - `/home/claude/sprue/PLAN.md` (lines 5, 32, 37, 41, 57, 84, 114, 117, 118)
  - `/home/claude/sprue/.gitignore` (lines 43–50) and `/home/claude/sprue/scripts/build-skill-zip.mjs` (lines 17–18)
  - `/home/claude/sprue/.env.example` and `/home/claude/sprue/skills/sprue/LICENSE`
  - `/home/claude/sprue/skills/sprue/pipeline/cli.ts` (lines 248, 508), `/home/claude/sprue/skills/sprue/pipeline/figure.ts` (line 171), `/home/claude/sprue/skills/sprue/pipeline/pcb.ts` (lines 69, 161, 225), `/home/claude/sprue/skills/sprue/pipeline/explore.ts` (lines 143–149), `/home/claude/sprue/skills/sprue/pipeline/pcb/gerber.ts` (line 230)
  - `/home/claude/sprue/skills/sprue/cad/build.py`
  - in `/home/claude/sprue/skills/sprue/examples/macropad/`: `request.json`, `state.json`, `score.json`, `quotes.json`, `sourcing.json`, `catalog.json`, `pcb/verify.json`, `reference/faults.json`
  - `/home/claude/sprue/skills/sprue/examples/ponder/request.json` and `/home/claude/sprue/skills/sprue/examples/ponder/design.json`
  - `/home/claude/sprue/evals/ideas/keys/co2-monitor.json`
  - `/home/claude/sprue/supabase/migrations/0001_waitlist.sql`
- **Determinism test:** two runs of `cad/build.py` on copies of the macropad in `/tmp/claude-0/-home-claude/534706e8-678b-590c-8823-c322e70c1461/scratchpad/next-2026-10-20/gallery-review/det/`.
