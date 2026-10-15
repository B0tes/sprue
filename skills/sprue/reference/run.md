# A new idea: three stages, three gates

Read this when a new idea comes in. `A` means `${CLAUDE_SKILL_DIR}/bin/sprue`. Run every command from the
user's current folder; products live in `products/<slug>/` there. Formats for every file:
`${CLAUDE_SKILL_DIR}/reference/formats.md`. A finished example to copy shapes from:
`${CLAUDE_SKILL_DIR}/examples/macropad/` (a 3x3 USB keypad, 1 unit) and `examples/ponder/` (an AI tutor desk
unit, 20 units, with spares and two orders); `A where` lists them all.

The user is going to buy these parts and build this thing. Every stage ends at a gate: show what it made, then
ask. `products/<slug>/state.json` records where the run is. `A state <slug>` prints it, and `A status <slug>`
shows it with the files. The commands mark a stage proposed when they finish it; only the user accepts.

| Stage | Commands | Proposed by | The user sees |
| --- | --- | --- | --- |
| 1 Design | `new`, `validate`, `cad`, `pcb`, `check`, `figure`, `shot` | `A figure` | `view.html`: the product, interactive, and the design |
| 2 Source | `digikey`, `source`, `quote`, `view` | `A quote` | `view.html` again, now with every offer and the quote |
| 3 Build | `plan`, `verify`, `package`, `score` | `A plan` | `view.html` with the build plan, `production/` and, for a board, `pcb/order/` |

One page shows the whole run: `products/<slug>/view.html`. `A figure` and `A view` write it, and every command that
changes what it shows (a gate, the checks, the quote, the plan) rewrites it. At the top are the three stages and
what to type at the current gate. Then the figure, then Design, then Source once there is a quote, then Build once
there is a plan.

A later stage's commands still run before an earlier stage is accepted (they print a note saying so, and never
mark their own stage proposed while an earlier one is open), but don't start a stage until the user says yes at the
gate before it, unless they asked for the whole run without stopping. "Step" in what you tell the user means an
assembly step of the product; the work below is in stages and moves.

## Before anything: the brief

Design nothing from a request that doesn't say what to build. The user's own words are the brief; never fill it
from notes, files or examples you find on disk.

- **No product named** (the input is a single word, a slug, a question, or only an example's name): ask what they
  want to build in one line, offer `/sprue example ponder` to see a finished run, and stop.
- **A product, but thin** (it lacks what it must do, how many, or a budget): ask once with the AskUserQuestion tool,
  at most four questions with two to four options each, a sensible default first: how many units (1 / 10 / 100),
  a budget per unit, the one or two things it must do, and anything it must fit (size, power, tools at home). Use
  what they answer; anything they skip takes the default in move 2, and the brief you say back names it as one.
- **Enough to start**: say the brief back in two lines (what, how many, budget, the must-haves) and go on to move 1.

## Stage 1: Design

This is Anatomy's workflow, aimed at a product to build instead of an idea to explain. The ten moves below are
adapted from Anatomy by Ryan (https://github.com/wheresryan22/anatomy, MIT). Run `date` at the start.

1. **Size it.** Name the size before any other work. Count the solids the figure will draw: every bought and made
   part, plus the details on them (screw heads, seams, ports).
   - **Figure**, 40-80 solids: one product, one mechanism. The default. Say the size and go.
   - **Hero**, 80-150 solids: a dense product. Say so and that it takes about 2-4 hours, then go.
   - **Epic**: a switchgear line-up, a vehicle, a plant. Don't start it. Propose a smaller first build that keeps
     the core (one panel of the line-up, one bay), say what the full build adds, and wait for the user's choice.
2. **Truth first.** Choose a short slug (`desk-lamp`) and run `A new <slug> '<the user's words>'` (single quotes;
   write an apostrophe in them as `'\''`, or use double quotes when the words have no `$`, `!` or backquote). Fill
   `request.json`: `product`, `units` (default 1), `region` (default US), `budgetUsd` if given, `mustHave`,
   `niceToHave`, and `constraints` as fields, not prose (power source, max size, tools available). Then collect the
   real numbers: the datasheet dimensions of every bought part, and every size, current and count the design needs.
   Design the simplest version of something that already exists and works, base it on a known open design, and
   name it in `design.md`; that design is also the answer key for scoring later. Write `design.json`: `summary`,
   `architecture` (one line per block, e.g. "USB 5V -> Pico VSYS"), `params` (every number the CAD, the figure and
   the checks read, in mm, mA and counts) and `assembly` (ordered build steps).
3. **Say what it is.** The product itself is the object; there is no metaphor to find. Write one sentence in
   `design.md` on what it does and how it goes together: "Nine switches clip into the printed plate, the PCB presses
   onto their pins from below, and four screws close the plate onto the tray."
4. **Parts list.** Write `bom.json`: one line per part, with a stable `id`, `name`, functional `role`, `process`
   (buy, pcb, print, cnc, sheet), `qtyPerUnit`, `spec` with its real dimensions, and `mpn` where there is one. No
   offers yet. Made parts need `file`, relative to the product folder (`fab/case.stl`); prints need
   `spec.material` and `spec.volumeCm3` (from the CAD output); PCBs need `spec.widthMm`, `heightMm` and `layers`,
   and `file: pcb/<slug>-gerbers.zip` when you draw the board (move 6).
   Include fasteners, cables and feet: the small parts are where real builds fail. Run `A validate <slug>` until it
   passes. Before the CAD has built a print it lists that print's `volumeCm3` as pending rather than failing:
   fill it in from `A cad` (move 6) and validate again.
5. **Plan the world.** Millimetres, x and y on the floor, z up, the origin at a datum you can name (the PCB centre,
   the floor under the cabinet). Choose the camera. `figure.md` has the details.
6. **Build the geometry.** For every made part, write `cad/<part>.py` with `make()` returning a build123d Part,
   reading its numbers from `../design.json` through a shared `cad/_params.py` (copy the pattern from the example).
   Run `A cad <slug>`: it writes STL and STEP to `fab/` and SVG previews to `previews/`, and prints each part's
   volume and size; copy those into the BOM (`volumeCm3`, `bboxMm`). Then write `figure.mjs`, the whole product
   drawn with the kit, reading
   the same `design.json` params, so an edit moves both. Follow `${CLAUDE_SKILL_DIR}/reference/figure.md`.
   **A board you design is code too.** Write `cad/pcb.mjs` (the contract is in `formats.md`; copy the keypad's):
   the outline, holes, parts from the footprint library, a ground pour (before the routes, so they keep clear of its
   spokes), routed nets and silkscreen, every number read from `design.json` params. Run `A pcb <slug>` (no Python;
   `A cad` runs it after the parts). Its audit is ours, not the fab's: say so. It runs three checks:
   - **Intent.** Every placed footprint against its reference, so a mirrored or moved one fails, and the nets
     against the circuit `design.json` means: each key's socket on its own GPIO and on ground. Put the pin map
     `A pcb` prints (which GPIO serves which key) in `design.json` as `keyMap`, and the audit holds the board to it.
   - **Fit.** The parts against the params the case is built from: each socket on the key grid in design.json's
     numbering, the Pico at its place with its USB end to +x, the screw holes under the case's bosses, so a part
     moved in `pcb.mjs` alone fails. Keep those params under the names the case and the design checks read
     (`keyPitchMm`, `controllerCenterXMm`, `holeInsetMm` and the rest, `formats.md`): a part whose params design.json
     does not give under them is an error that names them, since nothing would hold it to the case.
   - **DRC.** Our rules, at least as strict as the published 2-layer limits of JLCPCB, PCBWay, OSH Park and Aisler,
     and which of those fabs the board's smallest features pass.

   Only with no errors does it write the Gerbers, drill files, a zip and the IPC-D-356A netlist to `pcb/`; with
   errors too it writes `pcb/drc.json`, `pcb/board.json` (the board as drawn, for the read-back) and the top and
   bottom previews, so you can see what is wrong. Read the errors, fix the board, run it again, and look at the
   previews. Give the key map in the firmware step of `assembly` too, as the keypad does, because the labels on the
   board are hidden once the case is on; `pcb.warn` can check that the notes still say it. For a board with key
   sockets and a Pico it also writes `firmware/code.py`, KMK on CircuitPython that reads each key on the GPIO the
   board wires it to, and `firmware/README.md`, which says how to put it on the Pico: the firmware steps in
   `assembly` tell the user to copy those, not to write code (a `code.py` it did not write is left as it is, and the
   board's goes to `code.sprue.py` beside it; one that `distinta pcb`, its name before the rename, wrote is its own,
   and is written again). Say which footprint numbers are not from a datasheet
   (`estimates`). A board with a part outside the library (`kailh-mx-hotswap`, `rpi-pico-castellated`) needs a
   footprint added to `pipeline/pcb/footprints.ts`, with its source for every number.
   Once the audit passes, run `A verify <slug>` too ("Proving a board", after stage 3): stage 3 needs it before the
   board is packaged, and a fault it finds now is cheaper to fix before gate 1. `A cad` runs its read-back as well,
   without the self-test, when there is a Python with gerbonara and shapely.
7. **Paint back to front.** In `figure.mjs`, call order is paint order: the base first, far before near.
8. **Frame it** and 9. **make it live**: `A figure <slug> --draft` does both while you work. It writes
   `view.html` with the card (hover, take apart and the assembly steps) and the parts list under it, and prints
   which BOM lines are drawn. `--draft` keeps the design from being proposed before it is finished.
10. **Verify like a critic.** Run `A check <slug>` (below), read the coverage table `A figure` prints, then `A shot`
    the rest pose, the apart pose, every step and 4x zooms (`figure.md`, "Verify"). Read every PNG, fix, repeat.

**Open early.** As soon as a first pass draws every part, run `A figure <slug> --draft`, then open the page with
its relative path: `open products/<slug>/view.html` on macOS, `xdg-open products/<slug>/view.html` on Linux.
If neither works (a remote or headless shell), say so and give the full path and `file://` link `A figure`
printed for the user to open in a browser. Print them either way, so the user sees the product while you deepen
the detail; they reload the page after each `A figure`.

**Engineer checks.** `A check <slug>` runs the built-in rules (they cover the keypad). For anything else, write the
rules this product needs in `products/<slug>/rules.ts` as `export const rules = [{ id, title, needs, run }]`, where
`needs` lists the design params a rule reads and `run({ p, bom })` returns `{ status: "pass" | "fail" | "flag",
detail }` (see `formats.md`). Cover the power budget, voltages, pin counts, mechanical fits and clearances, and the
standards it falls under. Read numbers from `design.json` and `bom.json`, never hard-code them. When a check fails,
fix the design, rebuild the CAD and the figure and rerun. Don't loosen a rule to make it pass unless the rule was
wrong, and say so if it was.

**Gate 1.** When the figure, the checks and the shots are done, run `A figure <slug>` without `--draft`: it
marks the design proposed (if the design was declined or edited after a proposal, run `A propose <slug> design`
instead). While the design is open the page shows a "Before you accept" list. Show, in a few lines: the page's path and
`file://` link, the one sentence from move 3, the size and part count, failed or flagged checks, and any number
that is still an estimate (`design.json` `estimates`). For a board, add the audit's result from `A pcb` (errors,
which must be none, warnings, the fabs it passes) and, when `A verify` has run, what "Proving a board" says to tell
the user. No price yet: that is stage 2. Then ask with the AskUserQuestion
tool when it is available, else in one line:

- **Accept and source it**: run `A accept <slug>`, then stage 2.
- **Edit something**: follow `edit.md` (it ends with `A propose <slug> design`), reopen the page and ask again.
- **Decline**: run `A decline <slug> '<why>'`, then ask what to change, or stop.

## Stage 2: Source

1. Write `catalog.json` (same shape as the example's): for each bought line, at least two real offers read from
   the supplier's product page with WebFetch (supplier, sku, url, packSize, priceBreaks, stock, leadDays,
   `source: "snapshot"`, `capturedAt` today), and flat shipping per shop. Prefer shops that carry several lines,
   because each shop adds shipping. If `catalog.json` is there already (a copied example, or a design that came
   back from gate 2), keep it: add offers for any new line, and refetch the ones older than a month or that the
   user doubts. If `DIGIKEY_CLIENT_ID` and `DIGIKEY_CLIENT_SECRET` are set, also run `A digikey <slug>` for live
   offers. `formats.md` has the rules for each field: break quantities and stock in pieces, an order multiple as
   `packSize`, a backorder date as unknown stock with a longer lead.
   - **Shipping.** Read each shop's shipping page. When it gives a flat rate for this order, use it and list the
     shop in `shippingRead`. Most shops show the rate only at checkout. Then estimate it from a carrier's
     published table (for the US, USPS Ground Advantage retail by weight and zone), and write in `shippingBasis`
     the table, its date, the weight you guessed and why. The quote and the page mark every shop not in
     `shippingRead` as an estimate.
   - **One parcel.** A small part that would bring in a shop just for itself (four screws) costs that shop's
     whole shipping. Look first at a shop that ships with the board's fab: JLCMC's mechanical parts ship in the
     JLCPCB parcel. Add its offer and `"shipsWith": { "JLCMC": "JLCPCB" }` to `catalog.json`, with the page that
     says so in `shippingBasis`.
   - **Made at home.** When the request says the user has a 3D printer that fits the part, pin each print line to
     it (`"pin": { "supplier": "home" }` in `bom.json`) and add `filament` to `catalog.json`: the price per kg
     from a spool's product page and the density from the material's datasheet, with their URLs. The quote then
     prices the filament only, with no shipping.
   - For a batch, add `spares` to the BOM lines that get lost or broken in a build (small parts, printed parts).
   - Write in `design.json` `costNotes` the costs the quote leaves out: duty, a shop's small-order fee or minimum
     order, consumables.
2. Run `A source <slug>`, then `A quote <slug>`. Sourcing drops an offer whose stock is below what the batch needs
   and says so. The quote rounds up to whole packs (it prints the packs to order), buys up to a higher price break
   when that costs less, adds one shipping charge per shop and picks the cheapest mix of shops. PCB and print
   prices come from published pricing rules in `${CLAUDE_SKILL_DIR}/pipeline/rates.json`; a print rate that lists
   `materials` only quotes those. For more than a few units, suggest building a few first: set
   `firstArticleUnits` in `design.json` params, and the quote also prices order A (those units) and order B (the
   rest and the spares), and what two orders cost over one. Spares, `costNotes` and `firstArticleUnits` change
   the order, not the design, so they don't reopen gate 1.
3. Run `A view <slug>` and reopen `products/<slug>/view.html` (or ask the user to reload it). Under the design it
   now shows Source: the BOM with every offer, the shops and the quote.

**Gate 2.** `A quote` has marked sourcing proposed. Show: the total and whether it fits the budget, the costs left
out of it (`costNotes`), the two or three lines that drive the cost (shipping counts), and any line with one offer,
unknown stock, offers dropped for short stock or an estimated price or shipping. With orders A and B, show both and
the extra cost. Then ask:

- **Accept and plan the build**: run `A accept <slug>`, then stage 3.
- **Swap a part**: follow `swap.md`.
- **Change a supplier**: run `A suppliers <slug>`, then `A pick <slug> <line> '<supplier>'` (`swap.md`). Quote
  the shop's name: many have a space in it ('Bolt Depot').
- **Edit the design**: follow `edit.md`. `A propose <slug> design` sends the run back to gate 1: show the figure
  again, and once the user accepts it, requote and ask gate 2 again.

After a swap or a new supplier, ask again. Declining works as in gate 1.

## Stage 3: Build

1. Run `A plan <slug>`: it writes `build-plan.md`. Its assembly steps come from `design.json` `assembly`, and a
   table after them lists the figure's steps (`figure.json` `steps`) with the parts each one places, so check
   first that the two agree in order and words; `assembly` may add steps that place no part, such as flashing the
   firmware and testing.
2. **Prove the board.** A copied example ships without `fab/` and `pcb/`: run `A cad <slug>` first (it needs
   build123d; a board alone is `A pcb <slug>`, no Python), or `production/` gets no STL, STEP or Gerbers. Then, for
   a product with `cad/pcb.mjs`, run `A verify <slug>` (below, "Proving a board") and read its last line. Go on to
   `A package` on VERIFIED. On FAILED, the board needs an edit of the design (`edit.md`, which sends the run back
   to gate 1); on UNVERIFIED, do what it printed (with the user's OK for an install) and run it again. Without a
   pass the zip stays out of `production/` and `A score` reads "not yet": the zip goes in only with a current
   `pcb/readback.json` that passed (for `A package`, its self-test too, which `A verify` runs, and for a keypad the
   run of the board's firmware on that zip, `firmware/fil.json`, passed as well), and not when that run failed:
   building the same board again does not clear that, nor does a `code.py` of the user's own. Nor does it go in
   while bom.json's PCB line and design.json do not give one board to order (the thickness or the layers the order
   files check, step 7 below). The BOM line that names the zip must name `pcb/<slug>-gerbers.zip` itself: a line is
   the board's when its `process` or `role` is `pcb`, or its file is in `pcb/` (however the path is written, through
   a link too) or a copy of a file there. `A status` counts `pcb/verify.json` only while it is of the board as it is
   now, bom.json and design.json still give one board, and the order folder it wrote is there and of this order;
   after an edit it shows `(stale)`, and `A verify` is next again.
3. Run `A package <slug>`. That writes `products/<slug>/production/` with the build plan, `order-list.csv` and
   every fab file (STL, STEP, the Gerber zip when present), and a keypad's `firmware/` with the zip (only the
   `code.py` `A pcb` wrote for this board, or the user's own whose run passed on this zip). The order list gives
   each line's pieces needed and bought, and the packs to put in the cart. With `firstArticleUnits` it also writes
   `order-a.csv` and `order-b.csv`, and the plan has a section for the two orders. If `reference/reference.json`
   exists, run `A score <slug>`.
4. Run `A view <slug>`. The page now shows Build: the steps (choosing one shows it in the figure), the order list
   and the files. The user can click through the whole run on it.

**Gate 3.** `A plan` has marked the build proposed. End with one short summary: what was designed, the total
against the budget, the costs left out of it (`costNotes`), orders A and B if there are two, any failed or
flagged checks, what's in `production/` and what's still missing (for example a PCB with no Gerbers, because
`cad/pcb.mjs` isn't written, its audit has errors or `A verify` has not passed), and the one change that would cut
cost or risk the most. For a board, say what "Proving a board" says to tell the user, and that `pcb/order/` holds
it ready to order by hand, after the user's OK, never by you. Nothing gets ordered. Ask whether to accept the build
(`A accept <slug>`, which marks the run done) or change something, then ask what felt wrong: that is how the
pipeline gets better.

## Proving a board: `A verify`

`A verify <slug>` asks whether the board works, as far as we can tell before a fab makes it. It runs the layers
below in order (the read-back only on files from a passing audit, the firmware only once the read-back has passed,
the order files only once every layer has), prints one line per layer (what it checked, its first errors and what
to do) and ends with one word. For the keypad it takes about a minute, most of it the firmware.

1. **PCB audit.** The audit `A pcb` runs (intent, fit and DRC, stage 1 move 6), on the board built again. A
   board with a Pico and no keys is held to what the Pico's pins are for: no supply or control pin on ground, and
   no 5 V (VBUS, VSYS) on any pin but VBUS, VSYS and 3V3_EN. Board code that reads anything but what it is handed
   and the modules it imports by a path relative to it (a file through `node:fs` or `process.getBuiltinModule`,
   a module by its absolute path, a CommonJS module) is not run, since an edit there would not show; each module
   it loads is in the fingerprint, however its path is written.
2. **Read-back.** gerbonara and shapely (Python, not our writer) read the very files in the zip and the `.d356`,
   rebuild the copper and hold the netlist it makes to the one `design.json` means, and each feature to the rules
   the audit used. It fails an OPEN; a SHORT, where a pad meant to be joined to nothing, such as the Pico's VBUS, is
   a net of its own; a pad with no copper, or one a later object eats into; a mask opening short of a pad or open
   over a track; a track, pad or via under its size, or two nets too close; a file whose name and
   `%TF.FileFunction%` disagree, or that holds a statement a fab's CAM applies and our writer never writes (step and
   repeat, mirroring, a macro); an outline that is not exactly one closed loop where `board.json` has it.
3. **Read-back self-test.** A cut round a key's pad, a sliver across a key's socket and one from VBUS through VSYS
   to GND, each put into a copy of the files where the board has something to put it on: the read-back must fail
   each, and pass an unchanged copy.
4. **Firmware** (a board with key sockets and a Pico). CircuitPython 10.3.1 and KMK boot the board's own firmware
   (the `code.py` `A pcb` wrote) on an emulated Pico (rp2040js), each GPIO wired to what the read-back's netlist
   joins it to. Every key and every pair of keys is pressed and must type its own keycodes and let go, and with no
   key pressed nothing may be typed.
5. **Firmware self-test.** A key's GPIO joined to ground and, with two keys or more, two keys swapped and two keys'
   GPIOs joined, each put into that netlist: each must make a key come out wrong.
6. **Your firmware** (only when `firmware/code.py` is the user's own; the board's is then `code.sprue.py`). The
   user's code runs after the board's on the same copper, and the line says what each key types. It fails only when
   the code cannot be run (too large for the Pico's drive) or does not start, a key reads held or does not let go,
   or no key types anything. That is the code's fault, not the board's: it is marked ⚑ and the board is VERIFIED
   without it.
7. **Order files.** The zip for each fab profile the board passes (JLCPCB, PCBWay, OSH Park, Aisler), in that fab's
   own file names and drill format, each read back as the board's own zip was. Then it writes `pcb/order/`. It
   fails when `bom.json`'s PCB line and `design.json` do not give one board: another thickness in each, a thickness
   other than the 1.6 mm every fab profile was checked for, a thickness that is not a number of mm, or other than 2
   layers. The PCB line it reads is the one whose file is the board's zip (else the first that names no file), so a
   switch plate ordered as a PCB is not held to the board's thickness.

The last line is one of three:

- **VERIFIED** (exit 0): every layer passed, and `products/<slug>/pcb/order/` is written.
- **FAILED** (exit 1): a layer found a fault. Don't order the board. Read that layer's errors and the fix it
  prints, change `cad/pcb.mjs` or `design.json` (an edit of the design: `edit.md`), then run `A verify` again. A
  self-test that fails means the check misses faults on this board, so its pass means nothing: report it.
- **UNVERIFIED** (exit 2): a layer could not run. That is not a pass. A product with no `cad/pcb.mjs` exits 2 as
  well, with nothing to verify.
  - The read-back needs Python 3.12 or newer with gerbonara and shapely at their pins. Without them it prints the
    line that installs them in a venv of their own,
    `python3 -m venv --clear ~/.cache/sprue/venv && ~/.cache/sprue/venv/bin/python -m pip install --no-deps -r <skill folder>/pipeline/pcb/requirements.txt`,
    which works where pip may not install into the system Python (Debian, Ubuntu, Homebrew). When `python3` is
    older, the line names a Python 3.12 or newer in its place (Debian 12 and Ubuntu 22.04 keep `python3` at 3.11 or
    3.10 beside a newer `python3.12`). Run the line it prints, then `A verify` again: it finds the venv itself, and
    `SPRUE_PYTHON` names another Python (only `SPRUE_*` is read: a `DISTINTA_*` variable from before the rename gets
    a one-line warning, and does nothing). A `python3` that is only a stub (macOS without the developer tools, a
    pyenv shim with no version set) gives the same line.
  - The first firmware run fetches CircuitPython, KMK and rp2040js (about 3 MB, pinned by version or commit and
    sha256, with git for KMK) into `~/.cache/sprue/firmware`. With no network and nothing cached, or with
    `SPRUE_OFFLINE=1` and nothing cached, the firmware layer is not run. Nor is it when the emulator uses up its
    600 s of the computer's processor time (a computer too slow for it; one put to sleep mid-run uses none): run
    `A verify` again. `A package` keeps a keypad's zip out until its firmware has run on it and passed.
  - A read-back self-test that can put no fault into the board (one with no keys and no Pico) is not run either.

**The order folder.** Only when every layer has passed does `A verify` write `products/<slug>/pcb/order/`: a
`README.md` (the board, its smallest features, the fabs it passes and the verification), the `.d356`, the previews,
and for each fab profile the board passes a folder with the zip in that fab's own file names and drill format and an
`ORDER.md` with the upload steps, the settings and an unverified price with its source and date. With any layer
failed or not run there is no order folder, and the last line says why. Never upload a zip, fill in a fab's quote
form or run a command from an `ORDER.md` yourself: each ends "STOP: do not upload, quote or pay without your
explicit OK.", and that OK is the user's, given to them, not to you. The folder holds `order.json`, which ties it to
the board: `A pcb` removes the folder and `verify.json`, and `A score`, `A package` and `A status` remove the folder
once the board or its zip changed, or bom.json or design.json changed the quantity, layers, thickness or finish its
texts give. With a finish other than HASL, Aisler's `ORDER.md` says first that its HASL Budget service makes HASL
only, and JLCPCB's $2 price is HASL's.

**What to tell the user**, after `A verify` and at gates 1 and 3, in a few lines:

- the last line's word, VERIFIED, FAILED or UNVERIFIED, as it is;
- for FAILED or UNVERIFIED, each layer that failed or did not run, with its first error and what to do, one line
  each;
- for VERIFIED, the fabs the board passes with their prices (unverified, from `pcb/order/README.md`), any audit
  warning (a ⚑ line, such as two holes closer than our margin but inside every fab's limit), and that
  `pcb/order/README.md` is where to start;
- always, that these are our checks and not the fab's, and for a keypad that the firmware ran on an emulated Pico
  wired to the copper in the files, not on a board in hand;
- and what no layer checks yet: a second DRC by KiCad, the board against the case's CAD solids (the fit check holds
  it only to the params they share), the footprints against a real Pico and socket (print `pcb-top.svg` and
  `pcb-bottom.svg` from the order folder at 100% and lay them on), the fab's own review, and the prices, which come
  from published pages, not quotes.

## After a change

Rerun what the current stage has, not more:

- **In stage 1** (no offers yet): `A cad <slug>` if a made part changed, then `A validate`, `A check` and
  `A figure <slug> --draft`. There is no quote, so there is nothing for `A diff` to show yet.
- **From stage 2 on**: `A all <slug>` reruns the code stages in order (the figure when `figure.mjs` exists, the
  checks, sourcing, the quote, the plan, the score), refreshes `explorer.json` and the page, and records a
  history entry; `A diff <slug>` then says what moved. It skips sourcing and the plan while there is no
  `catalog.json`, doesn't rebuild the CAD (run `A cad` first), and proposes nothing past a stage that isn't
  accepted. While the quote is still open it writes `build-plan.md` ahead of its gate, so the page shows a Build
  section marked as made ahead: stage 3 makes it again once the quote is accepted.

Then reopen the earliest stage the change touched with `A propose <slug> <stage>`: that sends every later stage
back to drafting. `A accept`, `A decline` and `A propose` also rewrite the page, so its stages and what it says
to type stay true.
