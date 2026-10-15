// The command line itself: what it says before any command runs. Run with
//   node --test skills/sprue/pipeline/cli.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

const SPRUE = join(import.meta.dirname, "..", "bin", "sprue");
/** `sprue where` with this environment's variables but its DISTINTA_* ones, and `env` on top. */
const where = (env: Record<string, string>) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("DISTINTA_")));
  return spawnSync(SPRUE, ["where"], { encoding: "utf8", env: { ...clean, ...env } as NodeJS.ProcessEnv });
};

test("a DISTINTA_* variable, from before the rename, gets a one-line warning that only SPRUE_* is read", () => {
  const one = where({ DISTINTA_OFFLINE: "1" });
  assert.equal(one.status, 0);
  assert.equal(one.stderr, "⚑ DISTINTA_OFFLINE is set, and Sprue (Distinta before the rename) reads only SPRUE_*: set SPRUE_OFFLINE instead\n");
  assert.match(one.stdout, /^pipeline: /);
  const two = where({ DISTINTA_PYTHON: "/nonexistent/python", DISTINTA_OFFLINE: "1" });
  assert.match(two.stderr, /^⚑ DISTINTA_OFFLINE and DISTINTA_PYTHON are set, .*: set SPRUE_OFFLINE and SPRUE_PYTHON instead\n$/);
  assert.equal(where({}).stderr, "");
});
