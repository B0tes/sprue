// Stage 1's circuit board. products/<slug>/cad/pcb.mjs (written by Claude) draws the board with the PCB kit in
// pcb/; this harness runs it, audits the result and, only if the audit finds no errors, writes the fab files:
//   export default function board({ pcb, params, bom, design }) { ...; return { title?, pinMap? } }
// In products/<slug>/:
//   pcb/<slug>-F_Cu.gtl, -B_Cu.gbl, -F_Mask.gts, -B_Mask.gbs, -F_Silkscreen.gto, -Edge_Cuts.gm1   Gerber X2
//   pcb/<slug>-PTH.drl, -NPTH.drl          Excellon drill files (vias and plated pads, then non-plated holes)
//   pcb/<slug>-gerbers.zip                 those eight files, the one to upload to the fab
//   pcb/<slug>.d356                        the IPC-D-356A netlist, for a fab's electrical test (pcb/ipc356.ts)
//   pcb/drc.json                           rules, errors, warnings, nets, pin map, intent, what fit checked, the board's smallest
//                                          features and the fab profiles they pass, and stats of the audit
//   pcb/board.json                         the board as drawn (pads, vias, drills, nets, the intended netlist), for
//                                          the read-back of the written files
//   previews/pcb-top.svg, pcb-bottom.svg   the board as the files draw it
//   firmware/code.py, README.md            for a keypad: its firmware (KMK on CircuitPython), each key read on the
//                                          GPIO the routed board wires it to (firmware/code.ts), and how to put it on
// (pcb/readback.json and verify.json are the read-back of these files, by Python, firmware/fil.json the firmware run
// on what it read, and pcb/order/ the hand-off to the fabs once all of it passed: `distinta verify`, verify.ts.)
// The audit is the DRC (pcb/drc.ts), the intent check (pcb/intent.ts: the footprints against their references and
// the drawn nets against design.json's keys and keyMap) and the fit check (pcb/fit.ts: the outline, the sockets, the
// controller and the screw holes where the params the case is built from put them); an error of any counts, and so
// does a written file that does not read back as what was audited (each Gerber, and the netlist).
// With errors, drc.json, board.json and the previews are still written (to see what is wrong), the Gerbers, the
// netlist, the zip and the firmware are not, and old ones are removed. So are they when the board code throws: then
// drc.json says why. drc.json and board.json also carry a fingerprint of the board code, the params, the keyMap, what
// the board code read of design.json and bom.json, and the kit (pcb/fresh.ts), so the scorer knows if they are out of
// date.
// `distinta pcb <slug>` runs this, and `distinta cad <slug>` runs it after the CAD.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exists, productDir, readJson, writeJson, writeText } from "./io.ts";
import { codePy, firmwareKeys, readme, type FirmwareKey } from "./firmware/code.ts";
import { createBoard } from "./pcb/board.ts";
import { audit, ruleTable, type Audit } from "./pcb/drc.ts";
import { inputsHash, watch, type Reads } from "./pcb/fresh.ts";
import { checkFit, type Fit } from "./pcb/fit.ts";
import { checkIntent, intendedNets, type Intent } from "./pcb/intent.ts";
import { checkGerber, excellon, gerber, zip } from "./pcb/gerber.ts";
import { checkD356, d356 } from "./pcb/ipc356.ts";
import { clearOrder } from "./pcb/order.ts";
import { buildFab, type Fab } from "./pcb/layers.ts";
import { previewSvg } from "./pcb/preview.ts";
import { FAB_PROFILES, RULES } from "./pcb/rules.ts";
import type { BoardData, Pad } from "./pcb/types.ts";
import type { Bom, Design } from "./types.ts";

export type PcbBuild = {
  data: BoardData; fab: Fab; audit: Audit; intent?: Intent; intentErrors: number; fit: Fit; title: string; pinMap: unknown; ms: number;
  /** The keys of design.json and bom.json the board code read, for the fingerprint. */
  reads: Reads;
};

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
  const seen = { design: new Set<string>(), bom: new Set<string>() };
  const out = ((await mod.default({ pcb: api, params: design.params ?? {}, bom: watch(bom, seen.bom), design: watch(design, seen.design) })) ?? {}) as { title?: string; pinMap?: unknown };
  const reads: Reads = { design: [...seen.design].sort(), bom: [...seen.bom].sort() };
  const fab = buildFab(data, RULES);
  const a = audit(data, fab, RULES);
  const meant = checkIntent(data, design);
  const fit = checkFit(data, design.params ?? {});
  a.errors.push(...meant.errors, ...fit.errors);
  return { data, fab, audit: a, intent: meant.intent, intentErrors: meant.errors.length, fit, title: out.title ?? slug, pinMap: out.pinMap ?? {}, ms: Date.now() - started, reads };
}

const padId = (p: Pad) => (p.ref ? `${p.ref}.${p.num}` : `pad ${p.num}`);

/** pcb/board.json: the board as drawn, in the Gerbers' frame, for the read-back of the written files (and for a
 * person reading what went wrong): every pad with its kind and net, the vias, the drills, the nets the board code
 * drew (a pad on none is a net of its own and listed under none) and the ones design.json means. */
function boardJson(slug: string, built: PcbBuild, inputs: string, firmware: FirmwareKey[] | undefined, code: { file: string; sha256: string } | undefined) {
  const { data, fab } = built;
  const nets: Record<string, string[]> = {};
  for (const p of data.pads) if (p.net) nets[p.net] = [...new Set([...(nets[p.net] ?? []), padId(p)])];
  return {
    inputs, slug,
    frame: "mm; origin at the board centre, x right, y up, seen from the top, as in the Gerbers and the .d356",
    board: { width: data.width, height: data.height, corner: data.corner, outline: data.outline },
    // The rules the audit held the board to: the read-back holds the files to the same numbers.
    rules: RULES,
    files: {
      ...Object.fromEntries(fab.layers.map((l) => [l.file.replace(/\..*$/, "").replace("_", "."), `${slug}-${l.file}`])),
      PTH: `${slug}-PTH.drl`, NPTH: `${slug}-NPTH.drl`, netlist: `${slug}.d356`, zip: `${slug}-gerbers.zip`,
    },
    pads: data.pads.map((p) => ({
      id: padId(p), ref: p.ref, num: p.num, name: p.name ?? null, kind: p.kind ?? null, mustConnect: !!p.mustConnect, net: p.net,
      x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape, layers: p.layers, drill: p.drill ?? null,
    })),
    vias: data.vias,
    drills: { plated: fab.pth, nonPlated: fab.npth },
    pours: data.pours,
    nets, singles: data.singles,
    intent: built.intent ?? null,
    intended: built.intent ? intendedNets(built.intent) : null,
    firmware: firmware ?? null,
    // The code.py written for these keys, by its sha256: `distinta package` ships firmware/code.py only when it is
    // this one, or one the firmware run passed on this zip.
    firmwareCode: code ?? null,
  };
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

const names = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "JLCPCB, PCBWay, OSH Park and Aisler pass", or which pass and which do not. */
function fabLine(fabs: Audit["fabs"]): string {
  const name = (id: string) => FAB_PROFILES[id].name;
  const pass = Object.keys(fabs).filter((id) => fabs[id].ok).map(name), fail = Object.keys(fabs).filter((id) => !fabs[id].ok).map(name);
  if (!fail.length) return `${names(pass)} pass${pass.length === 1 ? "es" : ""}`;
  return `${pass.length ? `${names(pass)} pass${pass.length === 1 ? "es" : ""}; ` : ""}${names(fail)} ${fail.length === 1 ? "does" : "do"} not`;
}

const pinMapText = (map: unknown) =>
  map && typeof map === "object" ? Object.entries(map).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";

/** Removes the Gerbers, drill files, netlist and zip of an earlier build, and what `distinta verify` wrote from them
 * (verify.json and the order folder): what is in pcb/ must be of the board as it is now. */
function clearFabFiles(slug: string) {
  const dir = join(productDir(slug), "pcb");
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.startsWith(`${slug}-`) || f === `${slug}.d356`) rmSync(join(dir, f), { force: true });
  rmSync(join(dir, "verify.json"), { force: true });
  clearOrder(dir);
}

/** Removes the firmware an earlier build wrote (firmware/code.py, README.md, code.distinta.py): a code.py must be of
 * the board as it is now. A file this did not write is left alone, and so is the report of a run (fil.json): the
 * scorer holds a failure in it against the zip and the code.py it ran on until either changes. */
function clearFirmware(slug: string) {
  const dir = join(productDir(slug), "firmware");
  rmSync(join(dir, "code.distinta.py"), { force: true });
  for (const f of ["code.py", "README.md"]) if (ours(slug, join(dir, f))) rmSync(join(dir, f), { force: true });
}

/** Whether `distinta pcb` wrote the file, by the line that says so: one without it is the user's, and is left as it
 * is. */
const ours = (slug: string, file: string) => existsSync(file) && readFileSync(file, "utf8").includes(`\`distinta pcb ${slug}\` wrote it`);

/** The board could not be drawn: drop the old fab files and leave a drc.json that says why, so the scorer fails
 * the board rather than passing the audit of an earlier one. */
function failed(slug: string, error: unknown) {
  mkdirSync(join(productDir(slug), "pcb"), { recursive: true });
  clearFabFiles(slug);
  clearFirmware(slug);
  rmSync(join(productDir(slug), "pcb", "board.json"), { force: true });
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
  // A keypad's firmware, from the nets drawn: written below only if the audit passes, which holds them to keyMap.
  let firmware: FirmwareKey[] | undefined;
  try {
    firmware = firmwareKeys(data);
  } catch (error) {
    a.errors.push(`firmware: ${error instanceof Error ? error.message : String(error)}`);
  }
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(productDir(slug), "previews"), { recursive: true });
  const zipName = `${slug}-gerbers.zip`;
  const files = [
    ...fab.layers.map((l) => ({ name: `${slug}-${l.file}`, data: gerber(slug, l) })),
    { name: `${slug}-PTH.drl`, data: excellon(slug, true, fab.pth) },
    { name: `${slug}-NPTH.drl`, data: excellon(slug, false, fab.npth) },
  ];
  // The audit paints the layer lists; read each written file back and make sure it prints exactly its list, and the
  // netlist exactly the board's pads, vias and holes.
  fab.layers.forEach((l, n) => {
    const differs = checkGerber(l, files[n].data);
    if (differs) a.errors.push(`Gerber writer: ${files[n].name} does not print what was audited: ${differs}`);
  });
  const netlist = { name: `${slug}.d356`, data: d356(slug, data) };
  const misread = checkD356(data, netlist.data);
  if (misread) a.errors.push(`netlist writer: ${netlist.name} does not hold the board: ${misread}`);
  const ok = !a.errors.length;
  const inputs = inputsHash(productDir(slug), built.reads);
  writeJson(slug, "pcb/drc.json", {
    inputs, reads: built.reads, rules: a.rules, errors: a.errors, warnings: a.warnings, nets: a.nets, pinMap: built.pinMap,
    intent: built.intent ?? null, fit: { checked: built.fit.checked }, measured: a.measured, fabs: a.fabs, stats: a.stats,
  });
  // The firmware for these keys goes over a code.py this wrote, and beside one the user wrote, which stays as it is.
  const fw = join(productDir(slug), "firmware"), keysOk = ok ? firmware : undefined;
  const code = keysOk ? codePy(slug, keysOk) : undefined;
  const own = !!code && existsSync(join(fw, "code.py")) && !ours(slug, join(fw, "code.py"));
  const codeFile = `firmware/${own ? "code.distinta.py" : "code.py"}`;
  writeJson(slug, "pcb/board.json", boardJson(slug, built, inputs, keysOk, code ? { file: codeFile, sha256: createHash("sha256").update(code).digest("hex") } : undefined));
  writeText(slug, "previews/pcb-top.svg", previewSvg(data, fab, "top", built.title));
  writeText(slug, "previews/pcb-bottom.svg", previewSvg(data, fab, "bottom", built.title));
  clearFabFiles(slug);
  clearFirmware(slug);
  if (ok) {
    for (const f of files) writeText(slug, `pcb/${f.name}`, f.data);
    writeText(slug, `pcb/${netlist.name}`, netlist.data);
    writeFileSync(join(dir, zipName), zip(files));
    if (keysOk && code) {
      mkdirSync(fw, { recursive: true });
      writeText(slug, codeFile, code);
      if (!existsSync(join(fw, "README.md"))) writeText(slug, "firmware/README.md", readme(slug, keysOk));
    }
  }

  const nets = Object.entries(a.nets);
  const s = a.stats;
  console.log(`products/${slug}/cad/pcb.mjs: ${data.width} x ${data.height} mm, 2 layers, ${s.parts} parts, ${s.pads} pads, ${s.tracks} tracks (${s.trackMm} mm), ${s.vias} vias, ${(s.platedHoles as number) + (s.nonPlatedHoles as number)} holes (${built.ms} ms)`);
  console.log(`  nets: ${nets.map(([n, v]) => `${v.connected ? "✓" : "✗"} ${n} (${v.pads.length})`).join("  ") || "none"}`);
  const keys = built.intent ? Object.keys(built.intent.keys).length : 0;
  const fitErrors = built.fit.errors.length, drcErrors = a.errors.length - built.intentErrors - fitErrors;
  const count = (n: number) => `${n} error${n === 1 ? "" : "s"}`;
  console.log(`  intent (footprints against their references, nets against design.json): ${built.intentErrors ? count(built.intentErrors) : keys ? `0 errors, ${keys} keys each on its own GPIO and on GND, as keyMap says` : "0 errors"}`);
  console.log(`  fit (the parts against the params the case is built from): ${fitErrors ? count(fitErrors) : built.fit.checked.length ? `0 errors: ${names(built.fit.checked)}` : "nothing to check, design.json gives none of its params"}`);
  console.log(`  DRC (ours, at least as strict as each fab profile below): ${drcErrors} error${drcErrors === 1 ? "" : "s"}, ${a.warnings.length} warning${a.warnings.length === 1 ? "" : "s"}`);
  for (const e of a.errors) console.log(`  ✗ ${e}`);
  for (const w of a.warnings) console.log(`  ⚑ ${w}`);
  console.log(`  fab profiles (the board's smallest features against each fab's published 2-layer limits): ${fabLine(a.fabs)}`);
  for (const f of Object.values(a.fabs)) for (const why of f.why) console.log(`    ${f.name}: ${why}`);
  const map = pinMapText(built.pinMap);
  if (map) console.log(`  pin map (GPIO=key): ${map}`);
  if (ok) {
    console.log(`wrote products/${slug}/pcb/: ${zipName} (${files.map((f) => f.name.slice(slug.length + 1)).join(", ")}), ${netlist.name}, drc.json, board.json, and previews/pcb-top.svg, pcb-bottom.svg`);
    if (keysOk && !own) console.log(`wrote products/${slug}/firmware/code.py (KMK on CircuitPython: ${keysOk.length} keys, each on the GPIO the board wires it to) and README.md; \`distinta verify ${slug}\` runs it on an emulated Pico`);
    if (keysOk && own) console.log(`  ⚑ products/${slug}/firmware/code.py is not one distinta pcb wrote, so it is left as it is: wrote this board's firmware to ${codeFile} beside it (copy it over code.py to use it); \`distinta verify ${slug}\` runs code.py, yours`);
  } else console.log(`wrote products/${slug}/pcb/drc.json, board.json and the previews, but no Gerbers or netlist: fix the errors above and run \`distinta pcb ${slug}\``);
  return ok;
}
