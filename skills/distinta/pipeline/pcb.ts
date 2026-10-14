// Stage 1's circuit board. products/<slug>/cad/pcb.mjs (written by Claude) draws the board with the PCB kit in
// pcb/; this harness runs it, audits the result and, only if the audit finds no errors, writes the fab files:
//   export default function board({ pcb, params, bom, design }) { ...; return { title?, pinMap? } }
// In products/<slug>/:
//   pcb/<slug>-F_Cu.gtl, -B_Cu.gbl, -F_Mask.gts, -B_Mask.gbs, -F_Silkscreen.gto, -Edge_Cuts.gm1   Gerber X2
//   pcb/<slug>-PTH.drl, -NPTH.drl          Excellon drill files (vias and plated pads, then non-plated holes)
//   pcb/<slug>-gerbers.zip                 those eight files, the one to upload to the fab
//   pcb/drc.json                           rules, errors, warnings, nets, pin map and stats of the audit
//   previews/pcb-top.svg, pcb-bottom.svg   the board as the files draw it
// With errors, drc.json and the previews are still written (to see what is wrong), the Gerbers and the zip are not,
// and an old zip is removed. So is it when the board code throws: then drc.json says why. drc.json also carries a
// fingerprint of the board code, the params and the kit (pcb/fresh.ts), so the scorer knows if it is out of date.
// `distinta pcb <slug>` runs this, and `distinta cad <slug>` runs it after the CAD.

import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exists, productDir, readJson, writeJson, writeText } from "./io.ts";
import { createBoard } from "./pcb/board.ts";
import { audit, ruleTable, type Audit } from "./pcb/drc.ts";
import { inputsHash } from "./pcb/fresh.ts";
import { checkGerber, excellon, gerber, zip } from "./pcb/gerber.ts";
import { buildFab, type Fab } from "./pcb/layers.ts";
import { previewSvg } from "./pcb/preview.ts";
import { RULES } from "./pcb/rules.ts";
import type { BoardData } from "./pcb/types.ts";
import type { Bom, Design } from "./types.ts";

export type PcbBuild = { data: BoardData; fab: Fab; audit: Audit; title: string; pinMap: unknown; ms: number };

/** Runs products/<slug>/cad/pcb.mjs and audits what it drew. Throws if the file is missing, draw() throws, or the
 * router finds no way; any other problem is in the audit. */
export async function buildPcb(slug: string): Promise<PcbBuild> {
  const file = join(productDir(slug), "cad", "pcb.mjs");
  if (!existsSync(file)) throw new Error(`no products/${slug}/cad/pcb.mjs: write one that exports default function board({ pcb, params, bom, design }) (reference/formats.md)`);
  const bom = exists(slug, "bom.json") ? readJson<Bom>(slug, "bom.json") : ({ slug, units: 1, lines: [] } as Bom);
  const design = exists(slug, "design.json") ? readJson<Design>(slug, "design.json") : ({ slug, params: {} } as unknown as Design);
  const started = Date.now();
  const { api, data } = createBoard(slug);
  // Cache-busted, so a second build in one process (distinta cad, then pcb) sees an edited file.
  const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  if (typeof mod.default !== "function")
    throw new Error(`products/${slug}/cad/pcb.mjs must \`export default function board({ pcb, params, bom, design })\``);
  const out = ((await mod.default({ pcb: api, params: design.params ?? {}, bom, design })) ?? {}) as { title?: string; pinMap?: unknown };
  const fab = buildFab(data, RULES);
  return { data, fab, audit: audit(data, fab, RULES), title: out.title ?? slug, pinMap: out.pinMap ?? {}, ms: Date.now() - started };
}

/** A throw inside board() gets its stack trimmed to the frames in the product's own files. */
function explain(slug: string, error: unknown) {
  const file = join(productDir(slug), "cad", "pcb.mjs");
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const dirs = existsSync(productDir(slug)) ? [productDir(slug), realpathSync(productDir(slug))] : [];
  const own = stack.split("\n").filter((l) => /^\s+at /.test(l) && dirs.some((d) => l.includes(d)));
  let where = own.join("\n");
  if (!own.length && existsSync(file) && (error instanceof SyntaxError || /SyntaxError/.test(stack))) {
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    where = (check.stderr || "").split("\n").filter((l) => l.trim() && !/^Node\.js v/.test(l) && !/^\s+at /.test(l)).join("\n");
  }
  console.error(`✗ pcb: ${error instanceof Error ? error.message : String(error)}${where ? `\n${where}` : ""}`);
}

const pinMapText = (map: unknown) =>
  map && typeof map === "object" ? Object.entries(map).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";

/** Removes the Gerbers, drill files and zip of an earlier build: what is in pcb/ must be of the board as it is now. */
function clearFabFiles(slug: string) {
  const dir = join(productDir(slug), "pcb");
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.startsWith(`${slug}-`)) rmSync(join(dir, f), { force: true });
}

/** The board could not be drawn: drop the old fab files and leave a drc.json that says why, so the scorer fails
 * the board rather than passing the audit of an earlier one. */
function failed(slug: string, error: unknown) {
  mkdirSync(join(productDir(slug), "pcb"), { recursive: true });
  clearFabFiles(slug);
  const message = error instanceof Error ? error.message : String(error);
  writeJson(slug, "pcb/drc.json", { inputs: inputsHash(productDir(slug)), rules: ruleTable(RULES), errors: [message], warnings: [], nets: {}, pinMap: {}, stats: {} });
}

/** `distinta pcb <slug>`: build, write drc.json and the previews, and (with no errors) the Gerbers, drill files and
 * zip. False when the audit found errors or the board could not be drawn. */
export async function pcb(slug: string): Promise<boolean> {
  let built: PcbBuild;
  try {
    built = await buildPcb(slug);
  } catch (error) {
    explain(slug, error);
    if (existsSync(join(productDir(slug), "cad", "pcb.mjs"))) failed(slug, error);
    return false;
  }
  const { data, fab, audit: a } = built;
  const dir = join(productDir(slug), "pcb");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(productDir(slug), "previews"), { recursive: true });
  const zipName = `${slug}-gerbers.zip`;
  const files = [
    ...fab.layers.map((l) => ({ name: `${slug}-${l.file}`, data: gerber(slug, l) })),
    { name: `${slug}-PTH.drl`, data: excellon(slug, true, fab.pth) },
    { name: `${slug}-NPTH.drl`, data: excellon(slug, false, fab.npth) },
  ];
  // The audit paints the layer lists; read each written file back and make sure it prints exactly its list.
  fab.layers.forEach((l, n) => {
    const differs = checkGerber(l, files[n].data);
    if (differs) a.errors.push(`Gerber writer: ${files[n].name} does not print what was audited: ${differs}`);
  });
  const ok = !a.errors.length;
  writeJson(slug, "pcb/drc.json", { inputs: inputsHash(productDir(slug)), rules: a.rules, errors: a.errors, warnings: a.warnings, nets: a.nets, pinMap: built.pinMap, stats: a.stats });
  writeText(slug, "previews/pcb-top.svg", previewSvg(data, fab, "top", built.title));
  writeText(slug, "previews/pcb-bottom.svg", previewSvg(data, fab, "bottom", built.title));
  clearFabFiles(slug);
  if (ok) {
    for (const f of files) writeText(slug, `pcb/${f.name}`, f.data);
    writeFileSync(join(dir, zipName), zip(files));
  }

  const nets = Object.entries(a.nets);
  const s = a.stats;
  console.log(`products/${slug}/cad/pcb.mjs: ${data.width} x ${data.height} mm, 2 layers, ${s.parts} parts, ${s.pads} pads, ${s.tracks} tracks (${s.trackMm} mm), ${s.vias} vias, ${(s.platedHoles as number) + (s.nonPlatedHoles as number)} holes (${built.ms} ms)`);
  console.log(`  nets: ${nets.map(([n, v]) => `${v.connected ? "✓" : "✗"} ${n} (${v.pads.length})`).join("  ") || "none"}`);
  console.log(`  DRC (ours, at JLCPCB's 2-layer limits): ${a.errors.length} error${a.errors.length === 1 ? "" : "s"}, ${a.warnings.length} warning${a.warnings.length === 1 ? "" : "s"}`);
  for (const e of a.errors) console.log(`  ✗ ${e}`);
  for (const w of a.warnings) console.log(`  ⚑ ${w}`);
  const map = pinMapText(built.pinMap);
  if (map) console.log(`  pin map (GPIO=key): ${map}`);
  if (ok) console.log(`wrote products/${slug}/pcb/: ${zipName} (${files.map((f) => f.name.slice(slug.length + 1)).join(", ")}), drc.json, and previews/pcb-top.svg, pcb-bottom.svg`);
  else console.log(`wrote products/${slug}/pcb/drc.json and the previews, but no Gerbers: fix the errors above and run \`distinta pcb ${slug}\``);
  return ok;
}
