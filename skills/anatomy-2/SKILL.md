---
name: anatomy-2
description: Turn a one-line hardware idea into a buildable product - design numbers, CAD, a full bill of materials, engineer checks, real supplier offers, a quote with shipping, a build plan and fab files - then inspect and change it (bom, edit, swap, supplier, view). Use when someone types /anatomy-2, or asks to design, source, price or plan a physical product, or to change one made earlier.
argument-hint: <idea> | bom <slug> [line] | edit <slug> <change> | swap <slug> <line> [what] | supplier <slug> [name] | view <slug> | list
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/bin/anatomy *), Bash(python3 -m pip install build123d*), Read(${CLAUDE_SKILL_DIR}/**)
license: MIT
---

# Anatomy 2.0

Input: $ARGUMENTS

Anatomy 2.0 takes a hardware idea from a one-line request to a folder someone could order parts from and build:
design numbers and CAD, every part in a bill of materials, engineer checks, real offers from supplier pages, a
quote that rounds up to packs and counts shipping, a build plan and the files a fab needs. Claude does the
judgement (the design, the BOM, finding offers); a command line does the arithmetic, so the same inputs always
give the same price.

**The command.** Every step below runs `${CLAUDE_SKILL_DIR}/bin/anatomy <command> ...` from the user's current
folder. Products live in `products/<slug>/` there. In the reference files, `A` means this command and "the skill
folder" means `${CLAUDE_SKILL_DIR}`. (If `${CLAUDE_SKILL_DIR}` appears literally, it means the folder that holds
this SKILL.md.) The command needs Node 22.6+; the CAD step needs Python 3 with build123d
(`python3 -m pip install build123d`).

## What to do with the input

Read the first word of the input:

| Input | Do |
| --- | --- |
| empty, `help` | Show the commands in the table below in a few lines, and run `A list` to show the products here. |
| `bom <slug> [line]` | Run `A bom <slug> [line]` and show the result. Without a line: the parts by bought and made, with cost and shop; then offer to open one line or the browser view. With a line: every offer for the batch, the chosen one marked, with links. |
| `edit <slug> <change>` | Follow `${CLAUDE_SKILL_DIR}/reference/edit.md`. |
| `swap <slug> <line> [what]` | Follow `${CLAUDE_SKILL_DIR}/reference/swap.md`. |
| `supplier <slug> [name or line]` | Run `A suppliers <slug> [name]`: the shops in the order with their lines, subtotals and shipping. Given a line id, run `A bom <slug> <line>` instead. To move a line to a shop, use the swap flow. Offer to open a supplier link (`open <url>` on macOS) only when asked. |
| `view <slug>` | Run `A view <slug>`, then open `products/<slug>/view.html` (`open` on macOS, `xdg-open` on Linux). It shows the stages, the BOM with every offer (pick one and the total updates), the checks, the CAD and the build plan. |
| `status <slug>`, `list` | Run `A status <slug>` or `A list`. |
| `diff <slug>` | Run `A diff <slug>`: what changed between the last two runs. |
| anything else | A new idea: follow `${CLAUDE_SKILL_DIR}/reference/run.md`. If it names a product already in `products/`, ask whether to change that one (edit) or start a new one. |

If the slug is missing and only one product exists, use it. If several exist, run `A list` and ask which.

## Rules for every command

- **Never invent a price, stock level, part number or dimension.** A number comes from a page you fetched, a
  datasheet or the CAD, or it is marked as an estimate with where it came from.
- **Nothing gets ordered.** Placing orders, paid quotes or anything that spends money waits for the user's explicit OK.
- **Change inputs, not outputs.** Edit `request.json`, `design.json`, `bom.json`, `catalog.json`, `rules.ts` or the
  CAD; never hand-edit `checks.json`, `quotes.json`, `build-plan.md` or `explorer.json`. Rerun with `A all <slug>`.
- **Say what moved.** After any change, run `A diff <slug>` and report the cost before and after and any check that
  changed status.
- **Keep it short.** Show command output, not the files. A table of parts or offers is fine; long prose is not.
- **Shell.** The user may be on macOS with zsh: keep commands simple, quote paths, and quote anything that starts
  with `=`.

## Reference

- `${CLAUDE_SKILL_DIR}/reference/run.md`: the full run, stage by stage (request, design and CAD, BOM, checks,
  sourcing, quotes, build plan and package). Add `--step` to the idea to pause after each stage.
- `${CLAUDE_SKILL_DIR}/reference/formats.md`: every file's format, including custom check rules (`rules.ts`).
- `${CLAUDE_SKILL_DIR}/reference/edit.md`, `${CLAUDE_SKILL_DIR}/reference/swap.md`: changing a design or a part.
- `${CLAUDE_SKILL_DIR}/examples/`: finished runs to copy shapes from (`A where` lists them). You don't need to
  read the pipeline's source code.
