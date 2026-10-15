// The install script `curl -fsSL <site>/install | sh` runs, run here on a zip in a folder of its own (curl reads a
// file: URL as it reads the site), in a home folder of its own. Run it with
//   node --test src/app/install/route.test.ts
// It needs sh, curl and unzip, as the script does; without them it is skipped.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { zip } from "../../../skills/sprue/pipeline/pcb/gerber.ts";

const tools = ["curl", "unzip"].every((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status === 0);

/** The script route.ts serves for `site`: its template, filled in as GET fills it. */
function script(site: string): string {
  const text = readFileSync(join(import.meta.dirname, "route.ts"), "utf8");
  const body = /const script = \(site: string\) => `([^]*?)`;\n/.exec(text)?.[1];
  assert.ok(body, "route.ts has no script template");
  return new Function("site", `return \`${body}\`;`)(site) as string;
}

test("the installer puts Sprue in ~/.claude/skills/sprue and removes Distinta, its old name, which would answer /distinta", { skip: tools ? false : "needs curl and unzip" }, (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sprue-install-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const site = join(tmp, "site"), skills = join(tmp, ".claude", "skills");
  mkdirSync(site);
  writeFileSync(join(site, "sprue.zip"), zip([{ name: "sprue/SKILL.md", data: "---\nname: sprue\n---\n" }]));
  // What the installer before the rename left: the skill as Distinta, with a /distinta of its own.
  mkdirSync(join(skills, "distinta"), { recursive: true });
  writeFileSync(join(skills, "distinta", "SKILL.md"), "---\nname: distinta\ndescription: Design a hardware product to buy the parts for and build.\n---\n");
  const run = () => spawnSync("sh", ["-c", script("https://example.invalid")], { env: { PATH: process.env.PATH, HOME: tmp, SPRUE_SITE: pathToFileURL(site).href } as Record<string, string> as NodeJS.ProcessEnv, encoding: "utf8" });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(skills, "sprue", "SKILL.md"), "utf8"), "---\nname: sprue\n---\n");
  assert.ok(!existsSync(join(skills, "distinta")), "the old skill is still installed beside the new one");
  assert.match(r.stdout, /removed .*\/\.claude\/skills\/distinta, Sprue's old copy under its old name/);
  // A folder of that name that is not the old skill is left as it is.
  mkdirSync(join(skills, "distinta"));
  writeFileSync(join(skills, "distinta", "notes.txt"), "mine\n");
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(skills, "distinta", "notes.txt")));
});
