---
name: distinta
description: Design a hardware product to buy the parts for and build. Stage 1 draws the real product as an interactive isometric figure on a page you can open at once, which grows with the run; after you accept it, stage 2 finds real supplier offers and a quote with packs and shipping, and stage 3 writes the build plan, the order list and the fab files. Then inspect and change it (bom, edit, swap, supplier, view). Use when someone types /distinta, or asks to design, source, price or plan a physical product, or to change one made earlier.
argument-hint: <idea> | accept <slug> | decline <slug> [why] | next <slug> | status <slug> | figure <slug> | bom <slug> [line] | edit <slug> <change> | swap <slug> <line> [what] | supplier <slug> [name] | view <slug> | diff <slug> | example [slug] | list | help
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/bin/distinta *), Bash(python3 -m pip install build123d*), Bash(open products/*), Bash(xdg-open products/*), Bash(mkdir -p products), Bash(cp -R ${CLAUDE_SKILL_DIR}/examples/*), Bash(date*), Read(${CLAUDE_SKILL_DIR}/**), WebFetch, WebSearch
license: MIT
---

# Distinta

Input: $ARGUMENTS

Distinta designs a product someone will buy the parts for and build. A run has three stages, and each ends
at a gate where the user accepts, edits or declines before the next one starts:

1. **Design.** The real numbers, the CAD, every part in a bill of materials, engineer checks, and a crafted,
   interactive isometric figure of the product on its page, `view.html`, which the user opens at once. The page
   grows with the run: the parts and the quote, then the build plan, appear on it as each stage makes them.
2. **Source.** Real offers from supplier pages and a quote that rounds up to packs and counts shipping.
3. **Build.** The build plan with its assembly steps, the order list and the fab files. Nothing is ordered.

When talking to the user, "stage" means one of these three and "step" means an assembly step of the product.

Claude does the judgement (the design, the drawing, finding offers); a command line does the arithmetic, so the
same inputs always give the same price.

**The command.** Every step runs `${CLAUDE_SKILL_DIR}/bin/distinta <command> ...` from the user's current folder.
Products live in `products/<slug>/` there. In the reference files, `A` means this command and "the skill folder"
means `${CLAUDE_SKILL_DIR}`. (If `${CLAUDE_SKILL_DIR}` appears literally, it means the folder that holds this
SKILL.md.) It needs Node 22.6+; the CAD needs Python 3 with build123d (`python3 -m pip install build123d`);
screenshots of the figure need Chrome or Chromium (set `CHROME_PATH` if it isn't found).

## What to do with the input

Read the first word of the input:

| Input | Do |
| --- | --- |
| empty, `help` | Show the commands in this table in a few lines, run `A list` to show the products here, and end with: describe what you want to build after `/distinta`, or try `/distinta example ponder`. Start nothing. |
| `accept <slug> [stage]` | Run `A accept <slug> [stage]`. It prints the stage the run is at now and rewrites the page (it writes `view.html` if there was none). If that stage is already proposed (a run made without stopping), show it and ask its gate question; if it was declined before, say why and ask what to change; otherwise do it, from `${CLAUDE_SKILL_DIR}/reference/run.md`. After the build stage the run is done: say so, and that nothing was ordered. |
| `decline <slug> [why]` | Run `A decline <slug> '<why>'` (single quotes, so zsh leaves the words alone). Ask what to change, or stop if the user is done. |
| `next <slug>` | Run `A state <slug>`. If the current stage is proposed, show it and ask its gate question; if it is declined, say why and ask what to change; if every stage is accepted, say the run is done; otherwise do that stage from `run.md`. |
| `figure <slug>` | Run `A figure <slug>` (it proposes the design if it is still being drafted), then open the page with its relative path, `open products/<slug>/view.html` on macOS or `xdg-open products/<slug>/view.html` on Linux, and print the full path and `file://` link that `A figure` printed. |
| `bom <slug> [line]` | Run `A bom <slug> [line]` and show the result. Before stage 2 has a quote it lists the lines and their specs, with no offers or prices yet (a copied example has a quote from its earlier run, so it shows prices at gate 1). After: without a line, the parts by bought and made, with cost and shop; then offer to open one line or the browser view. With a line: every offer for the batch, the chosen one marked, with links, and what picking each other offer does to the whole order, shipping included. |
| `edit <slug> <change>` | Follow `${CLAUDE_SKILL_DIR}/reference/edit.md`. |
| `swap <slug> <line> [what]` | Follow `${CLAUDE_SKILL_DIR}/reference/swap.md`. |
| `supplier <slug> [name or line]` | Run `A suppliers <slug> [name]`: the shops in the order with their lines, subtotals and shipping. Given a line id, run `A bom <slug> <line>` instead. To move a line to a shop, use the swap flow. Open a supplier link (`open '<url>'` on macOS, in single quotes) only when asked. |
| `view <slug>` | Run `A view <slug>`, then open `products/<slug>/view.html` as in the `figure` row. It is the same page `A figure` writes: the three stages and what to type at the current gate, the figure, then Design (the parts, the numbers, the checks, the CAD), Source (the BOM with every offer: pick one and the total updates) and Build (the steps, linked to the figure, the order list and the files). Source and Build show once they exist. |
| `status <slug>`, `list` | Run `A status <slug>` or `A list`. |
| `diff <slug>` | Run `A diff <slug>`: what changed between the last two runs. |
| `example [slug]` | Copy a finished run from the skill into `products/` here, to try the other commands on. Without a slug, run `A where` and ask which. If `products/<slug>` exists already, ask before replacing it; once the user agrees, remove it first (`rm -rf products/<slug>`), so no old file stays. Run `mkdir -p products` and `cp -R ${CLAUDE_SKILL_DIR}/examples/<slug> products/`, then `A figure <slug>` (the page isn't shipped; this writes it), open `products/<slug>/view.html` as in the `figure` row and print its path. The example arrives at gate 1 with its design proposed: show it as gate 1 in `run.md` does. Then run `A view <slug>`, which records its first run, so a later `diff` has a before, and suggest `accept`, `bom`, `swap`, `edit` or `view` on it. It ships without `fab/` and `pcb/`: run `A cad <slug>` (the case and the board; `A pcb <slug>` builds the board alone, without Python) before stage 3 packages it. |
| a bare example name (`ponder`, `macropad`) | Ask whether they mean `example <slug>` (open the finished run) or a new design of that kind. Start nothing until they answer. |
| anything else | A new idea: follow `${CLAUDE_SKILL_DIR}/reference/run.md`, which starts with the brief: if the words don't say what to build, ask before any work. If it names a product already in `products/`, ask whether to change that one (edit) or start a new one. |

If the slug is missing and only one product exists, use it. If several exist, run `A list` and ask which.

## Rules for every command

- **Never invent a price, stock level, part number or dimension.** A number comes from a page you fetched, a
  datasheet or the CAD, or it is marked as an estimate with where it came from. That holds for the figure too.
- **Nothing gets ordered.** Placing orders, paid quotes or anything that spends money waits for the user's explicit OK.
- **Stop at every gate.** Don't start the next stage until the user accepts, unless they asked for the whole run
  without stopping. Then run the stages back to back, leave each one proposed, and ask once at the end.
- **Change inputs, not outputs.** Edit `request.json`, `design.json`, `bom.json`, `catalog.json`, `rules.ts`,
  `figure.mjs` or the CAD; never hand-edit `checks.json`, `quotes.json`, `build-plan.md`, `figure.json`,
  `state.json` or `explorer.json`. Rerun the stage's commands.
- **Say what moved.** After any change, run `A diff <slug>` and report the cost before and after and any check that
  changed status.
- **Keep it short.** Show command output, not the files. A table of parts or offers is fine; long prose is not.
- **Shell.** The user may be on macOS with zsh: keep commands simple, quote paths, and put in single quotes a
  reason or a brief (`A decline macropad 'too tall'`), a shop's name (`A pick ponder scr3 'Bolt Depot'`), a URL
  (`?` and `&` mean something to the shell) and anything that starts with `=`.

## Reference

- `${CLAUDE_SKILL_DIR}/reference/run.md`: the three stages and their gates, command by command.
- `${CLAUDE_SKILL_DIR}/reference/figure.md`: how to draw the product (`figure.mjs`), the kit calls it needs, the
  craft rules and the screenshot loop. Depth in `${CLAUDE_SKILL_DIR}/reference/anatomy/craft.md` and
  `${CLAUDE_SKILL_DIR}/reference/anatomy/kit.md`.
- `${CLAUDE_SKILL_DIR}/reference/formats.md`: every file's format, including check rules (`rules.ts`), the board (`cad/pcb.mjs`, `pcb/`) and `state.json`.
- `${CLAUDE_SKILL_DIR}/reference/edit.md`, `${CLAUDE_SKILL_DIR}/reference/swap.md`: changing a design or a part.
- `${CLAUDE_SKILL_DIR}/examples/`: finished runs to copy shapes from (`A where` lists them). You don't need to
  read the pipeline's source code.
