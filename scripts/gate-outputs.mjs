// Runs each example's four gates on a copy of it, as a run in Claude Code does, and records what each command printed
// in src/lib/gate-outputs.json, with whether it went through and the sha256 of every file it ran on
// (src/lib/gate-inputs.mjs). The worked example shows those outputs at its gates (src/lib/example.ts) while the files
// are still the ones they were run on. Runs before `next build` and `next dev`, after copy-figures.
// The gates check the CAD exports, which git leaves out (fab/, and pcb/ for a board), so a record is written only
// where they are and are of the files as they are: locally, after `sprue cad <slug>`. On Vercel and in CI the
// committed record is left as it is. A slug's record is written again only when its files changed or it has none, as
// the whole-product check and a board's proof take minutes. A refusal that comes from this machine (an export to make
// again, a tool to install or fetch) is not the product's, so it is not written either.

import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { RECORD, currentEntry, gateInputs, localRefusal, readRecord } from "../src/lib/gate-inputs.mjs";

const root = join(import.meta.dirname, "..");
const examples = join(root, "skills", "sprue", "examples");
const bin = join(root, "skills", "sprue", "bin", "sprue");
/** Per command: Ponder's whole-product check takes 3 to 5 minutes, the keypad's board proof 2 or 3. */
const TIMEOUT_MS = 20 * 60 * 1000;

const say = (line) => console.log(`gate-outputs: ${line}`);

/** What a person would see of a command's output: the copy's folder taken out of its paths (so they read
 * products/<slug>/..., and the record is the same from run to run), and no warning of this machine's fonts. */
function clean(text, tmp) {
  let t = text;
  for (const dir of new Set([tmp, realpathSync(tmp)])) t = t.replaceAll(`${pathToFileURL(dir).href}/`, "").replaceAll(`${dir}/`, "").replaceAll(dir, ".");
  return t.split("\n").filter((l) => !/^Fontconfig (warning|error)/.test(l)).join("\n").trimEnd();
}

/** One `sprue` command in the copy: what it printed, stdout and stderr in the order they came, and whether it exited 0.
 * `shown` is the command as a person types it, where that differs. */
function sprue(tmp, args, shown) {
  const log = join(tmp, "output.txt");
  const fd = openSync(log, "w");
  let r;
  try {
    r = spawnSync(bin, args, { cwd: tmp, stdio: ["ignore", fd, fd], timeout: TIMEOUT_MS, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  } finally {
    closeSync(fd);
  }
  const cmd = `sprue ${shown ?? args.join(" ")}`;
  if (r.error || r.signal) throw new Error(`${cmd} ${r.signal ? `was stopped after ${TIMEOUT_MS / 60000} minutes` : `could not run (${r.error.message})`}`);
  return { cmd, out: clean(readFileSync(log, "utf8"), tmp), ok: r.status === 0 };
}

/** The gates in order, each with the commands a run has done by then. Inspect is proposed by `sprue inspect` (which
 * checks the whole product again when system.json is stale); Source and Build by `sprue propose`, so their gates judge
 * the quote and the plan as committed. Stage 4 proves a board and packages the build before its gate. A gate whose
 * accept refuses ends the sequence: nothing after it can be proposed. */
function runGates(slug) {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-gates-"));
  try {
    const src = join(examples, slug);
    // The run's files as they are here, CAD exports included; not its history, shots, page or an old package.
    cpSync(src, join(tmp, "products", slug), {
      recursive: true,
      filter: (path) => !/^(history|shots|production|view\.html)$/.test(relative(src, path)) && !/(^|[\\/])__pycache__$/.test(path),
    });
    const board = existsSync(join(src, "cad", "pcb.mjs"));
    const run = (...args) => ({ args });
    const sequence = [
      ["design", [run("propose", slug, "design"), { args: ["decline", slug, "<why>"], shown: `decline ${slug} '<why>'` }, run("propose", slug, "design"), run("accept", slug)]],
      ["inspect", [run("inspect", slug), run("accept", slug)]],
      ["source", [run("propose", slug, "source"), run("accept", slug)]],
      ["build", [run("propose", slug, "build"), ...(board ? [run("verify", slug)] : []), run("package", slug), run("accept", slug)]],
    ];
    const gates = [];
    for (const [stage, steps] of sequence) {
      const ran = steps.map((s) => sprue(tmp, s.args, s.shown));
      const ok = ran.at(-1).ok;
      gates.push({ stage, ok, ran });
      if (!ok) break;
    }
    return gates;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Why the CAD exports here can't be run on, or undefined: fab/ (and pcb/ for a board) not made, or made from an
 * earlier design (scripts/exports-current.mjs, which asks the pipeline as the gates do). */
function exportsProblem(slug) {
  const dir = join(examples, slug);
  const cad = join(dir, "cad");
  const parts = existsSync(cad) && readdirSync(cad).some((f) => f.endsWith(".py") && !f.startsWith("_"));
  const missing = [parts && !existsSync(join(dir, "fab")) ? "fab/" : "", existsSync(join(cad, "pcb.mjs")) && !existsSync(join(dir, "pcb")) ? "pcb/" : ""].filter(Boolean);
  if (missing.length) return `there is no ${missing.join(" or ")} here`;
  const flags = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
  const r = spawnSync(process.execPath, [...flags, join(import.meta.dirname, "exports-current.mjs"), dir], { encoding: "utf8" });
  if (r.status !== 0) return `its exports could not be checked (${(r.stderr || r.error?.message || "").trim().split("\n")[0]})`;
  const stale = r.stdout.trim().replace(/: run sprue (cad|pcb)$/, "");
  return stale ? `the exports here are not of these files (${stale})` : undefined;
}

function write(record) {
  const sorted = Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
  writeFileSync(join(root, RECORD), `${JSON.stringify(sorted, null, 2)}\n`);
}

if (process.env.VERCEL || process.env.CI) {
  say(`${process.env.VERCEL ? "on Vercel" : "in CI"}, so ${RECORD} stays as committed (the gates need the CAD exports, which only a local sprue cad makes)`);
} else {
  const record = readRecord(root);
  const slugs = readdirSync(examples).filter((d) => existsSync(join(examples, d, "explorer.json"))).sort();
  for (const slug of slugs) {
    const now = currentEntry(root, slug, record);
    if (now.entry) {
      say(`${slug}: current`);
      continue;
    }
    const why = now.changed === "no record" ? "no record yet" : `${now.changed} changed`;
    const exports = exportsProblem(slug);
    if (exports) {
      say(`${slug}: ${why}, but ${exports}, so its record stays as committed (sprue cad ${slug} makes them)`);
      continue;
    }
    say(`${slug}: ${why}, so its gates run again on a copy (the whole-product check and a board's proof take minutes)`);
    const started = Date.now();
    try {
      const inputs = gateInputs(root, slug);
      const gates = runGates(slug);
      const local = localRefusal(gates);
      if (local) {
        say(`${slug}: ${local.stage} refused because of this machine, not the product (${local.line}), so its record stays as it was`);
        continue;
      }
      record[slug] = { inputs, gates };
      write(record);
      const words = gates.map((g) => `${g.stage} ${g.ok ? "accepted" : "refused"}`).join(", ");
      say(`${slug}: ${words}; wrote its record in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (e) {
      say(`${slug}: ${e.message}, so its record stays as it was`);
    }
  }
}
