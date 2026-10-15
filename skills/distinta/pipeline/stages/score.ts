// Scores a pipeline run against the reference product's answer key (docs/pipeline.md).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { inputsHash, type Reads } from "../pcb/fresh.ts";
import type { Bom, Checks, Quotes, Reference, Score } from "../types.ts";

/** Binary STL is a closed surface if every edge is shared by exactly two triangles. */
export function stlIsWatertight(path: string): boolean {
  const buf = readFileSync(path);
  const tris = buf.readUInt32LE(80);
  if (buf.length !== 84 + tris * 50) return false; // not a binary STL
  const key = (o: number) =>
    [0, 4, 8].map((d) => Math.round(buf.readFloatLE(o + d) * 1e3)).join(",");
  const edges = new Map<string, number>();
  for (let t = 0; t < tris; t++) {
    const base = 84 + t * 50 + 12;
    const v = [key(base), key(base + 12), key(base + 24)];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((n) => n === 2);
}

/** The board's own audit (pcb/drc.json, written with the zip) is ok if it found no errors, every net is joined, and it
 * is of the board as it is now (the board code, the params, what it read of design.json and bom.json, the PCB kit and
 * the read-back have not changed since). */
export function drcAudit(dir: string): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return { ok: false, detail: "no pcb/drc.json: run distinta pcb" };
  try {
    const drc = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; reads?: Reads; errors?: string[]; nets?: Record<string, { connected?: boolean }> };
    const errors = drc.errors ?? ["pcb/drc.json lists no errors field"];
    const open = Object.entries(drc.nets ?? {}).filter(([, n]) => !n.connected).map(([name]) => name);
    if (errors.length) return { ok: false, detail: `our DRC found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (open.length) return { ok: false, detail: `net${open.length === 1 ? "" : "s"} not connected: ${open.join(", ")}` };
    if (drc.inputs !== inputsHash(dir, drc.reads)) return { ok: false, detail: "pcb/drc.json is of an earlier board (the board code, what it reads of design.json or bom.json, or the PCB kit changed): run distinta pcb" };
    return { ok: true, detail: "our DRC, at least as strict as JLCPCB's, PCBWay's, OSH Park's and Aisler's 2-layer limits: 0 errors, every net connected" };
  } catch {
    return { ok: false, detail: "pcb/drc.json is not readable: run distinta pcb" };
  }
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A BOM line's file as the path in the product folder it names, with / between its parts: "./pcb/x.zip" and
 * "pcb/rev1/../x.zip" are both "pcb/x.zip". */
export const inProduct = (dir: string, file: string) => relative(resolve(dir), resolve(dir, file)).split(sep).join("/");

/** Whether a BOM line is the board: a PCB line, or any line whose file is in pcb/, however its path is written. Its
 * file goes only through the board's gates (gerbersAudit), which pass nothing but the zip the read-back read. */
export const isBoardLine = (dir: string, l: { process?: string; file?: string }) =>
  !!l.file && (l.process === "pcb" || inProduct(dir, l.file).startsWith("pcb/"));

/** The read-back (pcb/readback.json, written by pipeline/pcb/readback.py) is ok if it passed, read the zip and the
 * netlist that are in pcb/ now (by their sha256), and carries the audit's fingerprint. `zip` is the zip a BOM line
 * names, when there is one, which must be the one read back. With `selfTest` (what `distinta package` asks) its
 * self-test must have run and passed too: `distinta cad` reads the zip back without one. */
export function readbackAudit(dir: string, zip?: string, { selfTest = false } = {}): { ok: boolean; detail: string } {
  const path = join(dir, "pcb", "readback.json");
  const again = "run distinta verify";
  if (!existsSync(path)) return { ok: false, detail: `no pcb/readback.json, so nothing but our own code has read the files: ${again} (it needs gerbonara and shapely)` };
  try {
    const rb = JSON.parse(readFileSync(path, "utf8")) as {
      inputs?: string; ok?: boolean; errors?: string[]; selfTest?: { ok?: boolean; ran?: boolean };
      files?: { zip?: { name?: string; sha256?: string }; netlist?: { name?: string; sha256?: string } };
    };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const errors = rb.errors ?? ["pcb/readback.json lists no errors field"];
    if (errors.length) return { ok: false, detail: `the read-back found ${errors.length} error${errors.length === 1 ? "" : "s"}: ${errors[0]}` };
    if (rb.selfTest?.ran === false) return { ok: false, detail: `the read-back's self-test could put no fault into this board, so its pass is not shown to mean anything here: report it` };
    if (rb.selfTest && !rb.selfTest.ok) return { ok: false, detail: `the read-back's self-test failed, so its pass proves nothing: see pcb/readback.json` };
    if (!rb.ok) return { ok: false, detail: "pcb/readback.json does not say it passed" };
    if (rb.inputs !== drc.inputs) return { ok: false, detail: `pcb/readback.json is of an earlier board than pcb/drc.json: ${again}` };
    for (const f of [rb.files?.zip, rb.files?.netlist]) {
      const file = f?.name ? join(dir, "pcb", f.name) : "";
      if (!file || !existsSync(file) || sha256(file) !== f!.sha256) return { ok: false, detail: `pcb/${f?.name ?? "?"} is not the file the read-back read: ${again}` };
    }
    // The very file a BOM line names, not one of the same name elsewhere (an old revision, another board's).
    const read = `pcb/${rb.files!.zip!.name}`;
    if (zip && inProduct(dir, zip) !== read) return { ok: false, detail: `bom.json names ${zip}, and the read-back read ${read}, the board's zip: name ${read} in bom.json` };
    if (selfTest && !rb.selfTest) return { ok: false, detail: `the read-back's self-test has not run on this zip, so its pass is not shown to mean anything here: ${again}` };
    return { ok: true, detail: `the read-back (gerbonara and shapely on the zip and the netlist) finds the nets design.json means${rb.selfTest ? ", and its self-test catches each fault put in" : ""}` };
  } catch {
    return { ok: false, detail: `pcb/readback.json is not readable: ${again}` };
  }
}

/** The firmware in the loop (firmware/fil.json, written by `distinta verify`): a run of the board's own firmware (the
 * code.py distinta pcb wrote for its keys, board.json `firmwareCode`) that failed on this zip (by their sha256)
 * refuses the zip, since the copper does not give the keys their codes, until either changes; rebuilding the same
 * board does not clear it, and neither does a code.py of the user's own, whose run (fil.json `yours`) is the code's
 * and refuses nothing here. One that passed on them, for this board's fingerprint, says so. None, or one of other
 * files, refuses nothing to the scorer (it needs the emulator, fetched once), and the detail says to run it; with
 * `required` (what `distinta package` asks) it refuses the zip, since a keypad's board is not verified until its
 * firmware has run on it. A board with no keys (board.json `firmware`) has no firmware to check. */
export function firmwareAudit(dir: string, { required = false } = {}): { ok: boolean; detail: string } {
  const path = join(dir, "firmware", "fil.json"), board = join(dir, "pcb", "board.json");
  let own: string | undefined;
  try {
    const b = existsSync(board) ? (JSON.parse(readFileSync(board, "utf8")) as { firmware?: unknown; firmwareCode?: { sha256?: string } | null }) : {};
    if (!Array.isArray(b.firmware) || !b.firmware.length || !b.firmwareCode?.sha256) return { ok: true, detail: "" };
    own = b.firmwareCode.sha256;
  } catch {
    return { ok: false, detail: "pcb/board.json is not readable: run distinta pcb" };
  }
  const notRun = (detail: string) => (required ? { ok: false, detail: `${detail}: run distinta verify, which runs it, until it ends VERIFIED` } : { ok: true, detail: `${detail} (distinta verify runs it)` });
  if (!existsSync(path)) return notRun("the board's firmware has not been run on that copper yet");
  try {
    const fil = JSON.parse(readFileSync(path, "utf8")) as { inputs?: string; ok?: boolean; errors?: string[]; firmware?: { sha256?: string }; netlist?: { zip?: string; zipSha256?: string } };
    const drc = existsSync(join(dir, "pcb", "drc.json")) ? (JSON.parse(readFileSync(join(dir, "pcb", "drc.json"), "utf8")) as { inputs?: string }) : {};
    const zip = fil.netlist?.zip ? join(dir, "pcb", fil.netlist.zip) : "";
    const same = fil.firmware?.sha256 === own && !!zip && existsSync(zip) && fil.netlist?.zipSha256 === sha256(zip);
    if (same && !fil.ok) return { ok: false, detail: `the board's firmware, run on the copper read back, ${fil.errors?.length ? `found: ${fil.errors[0]}` : "failed: see firmware/fil.json"}` };
    if (!same || fil.inputs !== drc.inputs) return notRun("firmware/fil.json is of an earlier board, zip or firmware, so the board's firmware has not been run on this zip's copper");
    return { ok: true, detail: "the board's firmware, run on that copper, types each key's code" };
  } catch {
    return { ok: false, detail: "firmware/fil.json is not readable: run distinta verify" };
  }
}

/** Whether `distinta package` ships firmware/code.py with the board: only the code.py `distinta pcb` wrote for this
 * board (board.json `firmwareCode`, by its sha256), or one of the user's own whose run on this very zip's copper passed
 * (fil.json `yours`). An edited or older code.py, or one whose run failed, stays out, and `detail` says why. `ok` is
 * false with no detail for a board with no keys. */
export function firmwareShips(dir: string): { ok: boolean; detail: string } {
  const code = join(dir, "firmware", "code.py"), board = join(dir, "pcb", "board.json"), path = join(dir, "firmware", "fil.json");
  try {
    const b = existsSync(board) ? (JSON.parse(readFileSync(board, "utf8")) as { firmware?: unknown; firmwareCode?: { file?: string; sha256?: string } | null }) : {};
    if (!Array.isArray(b.firmware) || !b.firmware.length) return { ok: false, detail: "" };
    if (!existsSync(code)) return { ok: false, detail: "there is no firmware/code.py: run distinta pcb, which writes it" };
    const have = sha256(code);
    if (b.firmwareCode?.sha256 === have) return { ok: true, detail: "the firmware distinta pcb wrote for this board" };
    const fil = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { ok?: boolean; yours?: { ok?: boolean; sha256?: string }; netlist?: { zip?: string; zipSha256?: string } }) : {};
    const zip = fil.netlist?.zip ? join(dir, "pcb", fil.netlist.zip) : "";
    if (fil.ok && fil.yours?.ok && fil.yours.sha256 === have && zip && existsSync(zip) && fil.netlist?.zipSha256 === sha256(zip))
      return { ok: true, detail: "your firmware/code.py, which the firmware run passed on this zip" };
    return {
      ok: false,
      detail: `firmware/code.py is not the one distinta pcb wrote for this board (it was edited, or is of an earlier board), and no firmware run passed it on this zip: run distinta verify to test yours${b.firmwareCode?.file === "firmware/code.distinta.py" ? ", or copy firmware/code.distinta.py over it" : ", or distinta pcb to write the board's again"}`,
    };
  } catch {
    return { ok: false, detail: "pcb/board.json or firmware/fil.json is not readable: run distinta verify" };
  }
}

/** A Gerber package is ok if the board's own audit passed and is current, the read-back of the very files in the
 * zip passed too, and no run of the firmware on that copper failed. With `selfTest` (what `distinta package` asks) the
 * read-back's self-test must have passed on this zip, and for a keypad its firmware's run too. */
export function gerbersAudit(dir: string, zip?: string, { selfTest = false } = {}): { ok: boolean; detail: string } {
  const a = drcAudit(dir);
  if (!a.ok) return a;
  const r = readbackAudit(dir, zip, { selfTest });
  if (!r.ok) return r;
  const f = firmwareAudit(dir, { required: selfTest });
  if (!f.ok) return f;
  return { ok: true, detail: `Gerbers and drill files; ${a.detail}, and ${r.detail}${f.detail ? `; ${f.detail}` : ""} (not a fab's own check)` };
}

/** What pcb/verify.json says of the board in pcb/ now: its status ("verified", "failed" or "unverified") while it is
 * of this board (its inputs are drc.json's, which are still the board's), and "verified" only while package would
 * take the zip it passed (gerbersAudit, with the self-tests and the firmware's run); else "stale". Undefined with
 * none. */
export function verifyState(dir: string): string | undefined {
  const path = join(dir, "pcb", "verify.json"), drcPath = join(dir, "pcb", "drc.json");
  if (!existsSync(path)) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { status?: string; inputs?: string; zip?: { name?: string } | null };
    const drc = existsSync(drcPath) ? (JSON.parse(readFileSync(drcPath, "utf8")) as { inputs?: string; reads?: Reads }) : undefined;
    if (!drc || v.inputs !== drc.inputs || inputsHash(dir, drc.reads) !== drc.inputs) return "stale";
    if (v.status === "verified" && !(v.zip?.name && gerbersAudit(dir, `pcb/${v.zip.name}`, { selfTest: true }).ok)) return "stale";
    return v.status ?? "unreadable";
  } catch {
    return "unreadable";
  }
}

export function score(dir: string, bom: Bom, checks: Checks, quotes: Quotes, ref: Reference): Score {
  const have = new Set(bom.lines.map((l) => l.role));
  const want = ref.roles.map((r) => r.role);
  const matched = want.filter((r) => have.has(r));
  const missing = want.filter((r) => !have.has(r));
  const extra = [...have].filter((r) => !want.includes(r));

  const mid = (ref.batchUsd.low + ref.batchUsd.high) / 2;
  const deltaPct = Math.round(((quotes.batchUsd - mid) / mid) * 1000) / 10;

  const files = bom.lines
    .filter((l) => l.file)
    .map((l) => {
      const p = join(dir, l.file!);
      // A board whose build failed has no zip but does have a drc.json that says why.
      if (isBoardLine(dir, l) && (existsSync(p) || existsSync(join(dir, "pcb", "drc.json")))) {
        const a = gerbersAudit(dir, l.file);
        return existsSync(p) ? { name: l.file!, ok: a.ok, detail: a.detail } : { name: l.file!, ok: false, detail: a.ok ? "not generated yet" : a.detail };
      }
      if (!existsSync(p)) return { name: l.file!, ok: false, detail: "not generated yet" };
      if (p.endsWith(".stl")) {
        const ok = stlIsWatertight(p);
        return { name: l.file!, ok, detail: ok ? "closed, printable mesh" : "mesh has holes" };
      }
      return { name: l.file!, ok: true, detail: "present" };
    });

  const coveragePct = Math.round((matched.length / want.length) * 1000) / 10;
  const withinBand = Math.abs(deltaPct) <= 25;
  return {
    slug: bom.slug,
    coverage: { matched, missing, extra, pct: coveragePct },
    checks: { failed: checks.failed, flagged: checks.flagged },
    cost: { batchUsd: quotes.batchUsd, referenceMidUsd: mid, deltaPct, withinBand },
    files,
    pass: coveragePct >= 90 && checks.failed === 0 && withinBand && files.every((f) => f.ok),
  };
}
