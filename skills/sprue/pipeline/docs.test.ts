// The reference docs against the code, where the two share a name someone reading a file looks up: the keys
// system.json records its inputs under, as formats.md gives them. Run it with
//   node --test skills/sprue/pipeline/docs.test.ts

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { systemInputs } from "./stages/score.ts";

const dir = mkdtempSync(join(tmpdir(), "sprue-docs-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const formats = readFileSync(new URL("../reference/formats.md", import.meta.url), "utf8");

test("formats.md names each key system.json records an input under that is not a file's path", () => {
  mkdirSync(join(dir, "cad"));
  writeFileSync(join(dir, "cad", "top.py"), "");
  writeFileSync(join(dir, "design.json"), JSON.stringify({ params: { wallMm: 2 }, costNotes: ["duty"] }));
  writeFileSync(join(dir, "bom.json"), JSON.stringify({ units: 1, lines: [{ id: "top", name: "Top", role: "case-top", process: "print", qtyPerUnit: 1, spec: {} }] }));
  // A file goes by its path; what is recorded by another name (a digest of what the check reads of a file, the checker
  // itself) is what someone reading system.json has to look up.
  const keys = Object.keys(systemInputs(dir)).filter((k) => !existsSync(join(dir, k)));
  assert.ok(keys.length >= 2, keys.join(", "));
  for (const k of keys) assert.ok(formats.includes(`\`${k}\``) || formats.includes(`"${k}"`), `formats.md does not name ${k}`);
});
