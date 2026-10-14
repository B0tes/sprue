// Is pcb/drc.json still the audit of this board? The Gerbers are made from three things: the product's own board code
// (cad/pcb.mjs), the numbers in design.json params that it reads, and the PCB kit (this folder and ../pcb.ts). A
// fingerprint of them goes into drc.json when the board is built, and the scorer compares it, so an edit that has
// not been through `sprue pcb` yet does not pass on the strength of an old audit.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function inputsHash(dir: string): string {
  const kit = import.meta.dirname;
  const files = [
    join(dir, "cad", "pcb.mjs"),
    ...readdirSync(kit).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort().map((f) => join(kit, f)),
    join(kit, "..", "pcb.ts"),
  ];
  const h = createHash("sha1");
  for (const f of files) h.update(existsSync(f) ? readFileSync(f) : "missing");
  const design = join(dir, "design.json");
  h.update(JSON.stringify(existsSync(design) ? (JSON.parse(readFileSync(design, "utf8")) as { params?: unknown }).params ?? {} : {}));
  return h.digest("hex").slice(0, 16);
}
