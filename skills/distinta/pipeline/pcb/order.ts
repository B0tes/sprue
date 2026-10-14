// The order hand-off. Once every layer of `distinta verify` has passed (verify.ts), it writes products/<slug>/pcb/order/
// for a person to order the board by hand:
//   README.md                       the board (size, layers, thickness, copper), its smallest features, the fab
//                                   profiles they pass, and the verification, layer by layer
//   <slug>.d356                     the IPC-D-356A netlist, for a fab's electrical test
//   pcb-top.svg, pcb-bottom.svg     the previews
//   <fab>/<slug>-<fab>.zip          one folder per fab profile the board passes (drc.json `fabs`): the zip in that
//   <fab>/ORDER.md                  fab's own file names and drill format, and how to order it there: where to upload,
//                                   the settings, the price with its source and date, and last the STOP line
// The Gerbers in every zip are the very files the read-back passed (in pcb/<slug>-gerbers.zip), renamed, and so are
// the drill files for a fab that takes mm; for one that wants inches they are written again from board.json's holes
// (gerber.ts `DrillFormat`). verify.ts reads each fab's zip back with readback.py, as it read the board's own, before
// anything is written here, and the folder is written whole or not at all. `distinta pcb` removes it, since it is of
// the board as it was verified.
// Nothing here, or anywhere in the pipeline, uploads to, quotes with or orders from a fab: `guardNetwork` makes fetch
// refuse every fab's host, and every order or payment call on any host, whoever calls it. An ORDER.md's upload steps
// are for a person, after the user's own OK.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { batchNeed } from "../io.ts";
import type { Bom } from "../types.ts";
import { excellon, unzip, zip, type DrillFormat } from "./gerber.ts";
import { inputsHash, type Reads } from "./fresh.ts";
import { FAB_FEATURES, FAB_PROFILES, type FabFeature, type Measured } from "./rules.ts";
import type { Drill } from "./types.ts";

/** pcb/order/, the folder the hand-off writes. */
export const ORDER_DIR = "order";
/** The last line of every ORDER.md (and of the README). */
export const STOP = "STOP: do not upload, quote or pay without your explicit OK.";
/** When the fabs' pages and files below were read (research/pcb-verification.md, section 6). */
const READ = "2026-10-14";

/** A layer of the board's zip, as board.json `files` names it. */
const ROLES = ["F.Cu", "B.Cu", "F.Mask", "B.Mask", "F.Silkscreen", "Edge.Cuts", "PTH", "NPTH"] as const;
type Role = (typeof ROLES)[number];

/** What of pcb/board.json the hand-off reads. */
export type BoardJson = {
  inputs: string; slug: string; board: { width: number; height: number; corner: number };
  files: Record<string, string>; drills: { plated: Drill[]; nonPlated: Drill[] };
};
type DrcJson = { inputs?: string; measured?: Measured; fabs?: Record<string, { name: string; ok: boolean; why: string[] }> };
type ReadbackJson = { inputs?: string; ok?: boolean; files?: { zip?: { name?: string; sha256?: string } }; stats?: { d356Records?: number } };

/** The board as a fab's order form asks for it. */
export type BoardSpec = {
  widthMm: number; heightMm: number; cornerMm: number; areaCm2: number; layers: number; thicknessMm: number;
  /** Where the thickness comes from, when no file gives one. */
  thicknessNote?: string;
  copper: string; finish: string;
};

/** What an ORDER.md is worked out from. */
type Ctx = {
  slug: string; zip: string; spec: BoardSpec; qty: number; need: number; measured: Measured;
  /** The smallest hole, and the smallest non-plated one (mm), and how many of each kind. */
  smallestHoleMm: number; smallestNpthMm: number; holes: { plated: number; nonPlated: number };
};
type Price = { short: string; text: string; source: string; unverified: string };

/** How one fab wants the files, and how to order there. */
type FabOrder = {
  /** Each layer's file name in this fab's naming. */
  names: (slug: string) => Record<Role, string>;
  /** The netlist goes into the zip too, under this name. */
  netlistInZip?: string;
  drills: DrillFormat;
  /** How the files are named and written, for ORDER.md. */
  naming: string;
  /** What sets it apart, for the README's table. */
  fit: string;
  /** How many boards an order has at least, and the step a larger one goes up by. */
  quantity: { min: number; step: number };
  warning?: (c: Ctx) => string;
  steps: (c: Ctx) => string[];
  settings: (c: Ctx) => [string, string][];
  price: (c: Ctx) => Price;
  /** Optional routes, after the steps. */
  also?: (c: Ctx) => string[];
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const eur = (n: number) => `€${n.toFixed(2)}`;
const mil = (mm: number) => `${(mm / 0.0254).toFixed(1)} mil`;
const size = (c: Ctx) => `${c.spec.widthMm} x ${c.spec.heightMm} mm`;
const qtyWhy = (c: Ctx, why: string) => `${c.qty} (${why}${c.need > 1 ? `; this product needs ${c.need}` : ""})`;
const finishOf = (c: Ctx) => (/hasl/i.test(c.spec.finish) ? "HASL, lead-free" : c.spec.finish);
const look = (c: Ctx) => `a ${size(c)} outline, copper on both sides and the holes, as ../pcb-top.svg and ../pcb-bottom.svg show them`;

/** The fabs the hand-off knows, by FAB_PROFILES id, from research/pcb-verification.md section 6 and the sources it
 * names (read 2026-10-14). Each fab profile has one (order.test.ts holds it to that). */
export const FAB_ORDERS: Readonly<Record<string, FabOrder>> = Object.freeze({
  jlcpcb: {
    names: (s) => ({
      "F.Cu": `${s}-F_Cu.gtl`, "B.Cu": `${s}-B_Cu.gbl`, "F.Mask": `${s}-F_Mask.gts`, "B.Mask": `${s}-B_Mask.gbs`,
      "F.Silkscreen": `${s}-F_Silkscreen.gto`, "Edge.Cuts": `${s}-Edge_Cuts.gm1`, PTH: `${s}-PTH.drl`, NPTH: `${s}-NPTH.drl`,
    }),
    drills: "mm",
    naming: "the Protel extensions (.gtl, .gbl, .gts, .gbs, .gto and one outline, .gm1) with X2 attributes whose file functions match them, since JLCPCB lets X2 override a name, and the drill files in mm with a decimal point, plated and non-plated apart, as JLCPCB's KiCad 9 guide asks. They are the very files of pcb/<zip>, which the read-back passed.",
    fit: "the cheapest; it ships from China, so choose DDP shipping",
    quantity: { min: 5, step: 5 },
    steps: (c) => [
      `Open https://cart.jlcpcb.com/quote and upload \`${c.zip}\`. JLCPCB reads the size and the layers from it.`,
      `Check JLCPCB's Gerber viewer: ${look(c)}.`,
      "Choose the settings below and leave the others as JLCPCB sets them.",
      "Pick \"Review Before Payment\": an engineer reviews the files before anything is charged, and an order that fails the review is cancelled. JLCPCB recommends \"Pay Directly\", which charges first and refunds if the review fails.",
      "Choose a DDP shipping option where it is offered, so import duty and VAT are paid at checkout. Into the EU, since 1 July 2026, that is €3 per HS code plus VAT, and IOSS collects only the VAT; without DDP, DHL charges 2.5% (at least €16) to advance the duty.",
      "Stop at the cart.",
    ],
    settings: (c) => [
      ["Base material", "FR-4"], ["Layers", String(c.spec.layers)], ["Dimensions", `${size(c)} (read from the zip)`],
      ["PCB Qty", qtyWhy(c, "the quantity of JLCPCB's $2 price")], ["PCB Thickness", `${c.spec.thicknessMm} mm`], ["PCB Color", "green"],
      ["Surface Finish", finishOf(c)], ["Outer Copper Weight", "1 oz"],
      ["Vias", "tented, as the files have them: the solder mask is closed over every via"],
      ["Electrical test", "JLCPCB tests orders of no more than 50 pieces fully, for free; the X2 netlist attributes in the files help its short and open checks"],
    ],
    price: (c) => ({
      short: "from $2.00 for 5",
      text: `From $2.00 for 5 pcs${c.qty > 5 ? `; this order is ${c.qty}` : ""}.`,
      source: "https://jlcpcb.com (its home page)",
      unverified: `the page ties the price to no board size, so it is not checked for ${size(c)}, and no shipping price to your address was obtained`,
    }),
    also: (c) => [`Upload the same zip to https://jlcdfm.com for JLCPCB's free DFM report (a PDF), and read it before step 4. Uploading it shares \`${c.zip}\` with JLCPCB, so it waits for the same OK.`],
  },
  pcbway: {
    names: (s) => ({
      "F.Cu": `${s}-F_Cu.gbr`, "B.Cu": `${s}-B_Cu.gbr`, "F.Mask": `${s}-F_Mask.gbr`, "B.Mask": `${s}-B_Mask.gbr`,
      "F.Silkscreen": `${s}-F_SilkS.gbr`, "Edge.Cuts": `${s}-Edge_Cuts.gbr`, PTH: `${s}-PTH.drl`, NPTH: `${s}-NPTH.drl`,
    }),
    netlistInZip: "PCBWay_netlist.ipc",
    drills: "inch",
    naming: "KiCad's own layer names (-F_Cu.gbr and so on), as PCBWay's KiCad plugin v1.0.5 writes them, with X2 attributes; the drill files in inches with a decimal point, plated and non-plated apart, as the plugin writes them; and the IPC-D-356 netlist as PCBWay_netlist.ipc, the name the plugin gives it (the same file as ../<netlist>).",
    fit: "a second option; it ships from China, and its quote has no duty or VAT in it",
    quantity: { min: 10, step: 5 },
    steps: (c) => [
      `Open https://www.pcbway.com/orderonline.aspx and upload \`${c.zip}\` (it takes a zip of up to 50 MB). PCBWay reads the size, the holes and the track and spacing from it.`,
      "Check what it read against the settings below.",
      "Add it to the cart and stop there. PCBWay's engineers review the files before the quote is final, and the quote has no customs duty or VAT in it.",
    ],
    settings: (c) => [
      ["Size", size(c)], ["Quantity", qtyWhy(c, "the quantity of PCBWay's $5 price")], ["Layers", String(c.spec.layers)],
      ["Material", "FR-4 (PCBWay upgrades 2-layer boards to TG150 at no charge)"], ["Thickness", `${c.spec.thicknessMm} mm`],
      ["Min track/spacing", `the board's narrowest copper is ${c.measured.trackMinMm?.mm ?? "?"} mm (${mil(c.measured.trackMinMm?.mm ?? 0)}) and its closest two nets ${c.measured.clearanceMm?.mm ?? "?"} mm (${mil(c.measured.clearanceMm?.mm ?? 0)})`],
      ["Min hole size", `the board's smallest hole is ${c.smallestHoleMm} mm`],
      ["Solder mask", "green"], ["Silkscreen", "white"], ["Surface finish", finishOf(c)], ["Finished copper", "1 oz"],
      ["Via process", "tented vias, as the files have them"],
    ],
    price: (c) => ({
      short: "$5 for 10",
      text: `$5 for 10 pcs, with TG150-160 material and a 24-hour standard build${c.qty > 10 ? `; this order is ${c.qty}` : ""}.`,
      source: "the metadata.json of PCBWay's KiCad plugin v1.0.5 (https://github.com/pcbway/PCBWay-Plug-in-for-Kicad)",
      unverified: "a quote for this board is final only after PCBWay's engineers review the files, it has no customs duty or VAT in it, and no shipping price to your address was obtained",
    }),
    also: (c) => [
      `PCBWay's own plugin uploads the zip with one call, and you may make the same call from your own machine (never this pipeline): \`curl -F "upload[file]=@${c.zip}" -F boardWidth=${c.spec.widthMm} -F boardHeight=${c.spec.heightMm} -F boardLayer=${c.spec.layers} https://www.pcbway.com/Common/KiCadUpFile/\`, then open the \`redirect\` URL in the JSON it answers, log in and stop at the cart.`,
      "That endpoint is undocumented: it is copied from the plugin's MIT source (v1.0.5, plugins/thread.py), so it may stop working without notice. Whether it takes an upload without a login was not tested, and the upload shares the design with PCBWay.",
    ],
  },
  oshpark: {
    names: (s) => ({
      "F.Cu": `${s}.gtl`, "B.Cu": `${s}.gbl`, "F.Mask": `${s}.gts`, "B.Mask": `${s}.gbs`,
      "F.Silkscreen": `${s}.gto`, "Edge.Cuts": `${s}.gko`, PTH: `${s}-PTH.xln`, NPTH: `${s}-NPTH.xln`,
    }),
    drills: "inch 2:4",
    naming: "the Protel extensions OSH Park recognizes (.gtl, .gbl, .gts, .gbs, .gto and the outline as .gko), with X2 attributes, and the drill files as .xln in inches in the 2:4 format with every zero kept (OSH Park takes no or leading zero suppression), plated and non-plated apart.",
    fit: "in the US, ENIG only; it does not document how it handles non-plated holes",
    quantity: { min: 3, step: 3 },
    warning: (c) => `OSH Park does not document how it handles non-plated holes, and this board depends on them: ${c.holes.nonPlated} of its holes are non-plated, from ${c.smallestNpthMm} mm up. Check that its preview shows them as holes, and ask OSH Park before paying.`,
    steps: (c) => [
      `At https://oshpark.com, upload \`${c.zip}\`.`,
      `Check its preview of every layer: ${look(c)}. OSH Park has no approval step after it.`,
      "Choose the settings below; the 2-layer service fixes the rest.",
      "Stop before paying.",
    ],
    settings: (c) => [
      ["Service", `2-layer (${c.spec.thicknessMm} mm, ENIG, purple: OSH Park's own, so the finish is ENIG there, not ${c.spec.finish})`],
      ["Quantity", qtyWhy(c, "OSH Park makes 2-layer boards in threes")],
    ],
    price: (c) => {
      const sq = (c.spec.widthMm * c.spec.heightMm) / 645.16;
      return {
        short: `about ${usd(5 * sq * (c.qty / 3))} for ${c.qty}`,
        text: `$5 per square inch for 3 boards: ${(c.spec.widthMm / 25.4).toFixed(2)} x ${(c.spec.heightMm / 25.4).toFixed(2)} in is ${sq.toFixed(2)} sq in, so ${usd(5 * sq * (c.qty / 3))} for ${c.qty}.`,
        source: "https://docs.oshpark.com/services/two-layer/",
        unverified: "it is arithmetic on the published rate, not a quote; import duty and VAT, where your country charges them (into the EU: VAT and €3 per HS code), are due on arrival, and the free international shipping is untracked",
      };
    },
    also: (c) => [`You may upload it from your own machine instead (never this pipeline): \`curl -F file=@${c.zip} https://oshpark.com/import.json\` answers with a token and a URL to open. The upload is not tied to an account.`],
  },
  aisler: {
    names: (s) => ({
      "F.Cu": `${s}.toplayer.ger`, "B.Cu": `${s}.bottomlayer.ger`, "F.Mask": `${s}.topsoldermask.ger`, "B.Mask": `${s}.bottomsoldermask.ger`,
      "F.Silkscreen": `${s}.topsilkscreen.ger`, "Edge.Cuts": `${s}.boardoutline.ger`, PTH: `${s}.drills_pth.xln`, NPTH: `${s}.holes_npth.xln`,
    }),
    drills: "inch 2:4",
    naming: "Aisler's own names for Gerber files (community.aisler.net/t/naming-convention-for-traditional-gerber-files/99), with X2 attributes, and the drill files in inches in the 2:4 format with every zero kept, plated and non-plated as separate .xln files. Nothing else is in the zip, as Aisler asks.",
    fit: "in Germany: to an address inside the EU, VAT at checkout, free shipping and no customs",
    quantity: { min: 6, step: 3 },
    steps: (c) => [
      `Log in at https://aisler.net and drop \`${c.zip}\` into a new project.`,
      `Read the Board Viewer's Processing Notes (a missing milling path or drill file shows there) and check its render: ${look(c)}. Aisler makes the boards again for free if they do not match what it rendered, provided the render was checked first.`,
      "Choose the settings below.",
      "Stop at checkout. VAT is collected there; shipping inside the EU is free and untracked (4 to 14 business days), with no customs.",
    ],
    settings: (c) => [
      ["Service", `HASL Budget: 2 layers, 1.6 mm, 35 µm copper, HASL, the profile this board was checked against`],
      ["Quantity", qtyWhy(c, `${c.qty / 3} sets of 3, as Aisler sells them`)],
      ["Smart Test, assembly", "not offered for a Gerber upload"],
    ],
    price: (c) => {
      const net = (perCm2: number, n: number) => 12 + perCm2 * c.spec.areaCm2 * n;
      const three = c.qty === 3 ? "" : ` (3 pcs: ${eur(net(0.067, 3))} net)`;
      return {
        short: `about ${eur(net(0.067, c.qty))} net for ${c.qty}`,
        text: `HASL Budget is €12 a job plus €0.067 per cm² of each board: €12 + €0.067 x ${c.spec.areaCm2.toFixed(2)} cm² x ${c.qty} = ${eur(net(0.067, c.qty))} net, before the VAT Aisler adds at checkout${three}.`,
        source: "https://community.aisler.net/t/our-simple-pricing",
        unverified: `it is arithmetic on Aisler's pricing post, which dates from 2023 and whose own worked example uses €0.051 per cm² (${eur(net(0.051, c.qty))} for ${c.qty}): confirm it in Aisler's configurator`,
      };
    },
  },
});

// ---- the packages ---------------------------------------------------------------------------------------------

/** One fab's zip, worked out but not yet written. */
export type FabPackage = {
  id: string;
  name: string;
  zip: string;
  /** The files in the zip, in order. */
  files: { name: string; data: string }[];
  /** The zip as it will be written, and its sha256. */
  bytes: Buffer;
  sha256: string;
  /** board.json's `files` for a read-back of this zip: each layer's name in it (and the netlist's, when it carries
   * one), the netlist beside it and the zip. */
  roles: Record<string, string>;
  drills: DrillFormat;
};

/** What the hand-off works from, read from products/<slug>/pcb/ as `distinta verify` left it. */
export type Verified = {
  board: BoardJson; drc: DrcJson; readback: ReadbackJson; d356: string;
  /** The board's own zip's files, the ones the read-back passed, by name. */
  files: Map<string, string>;
};

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Reads products/<slug>/pcb/: board.json, drc.json, readback.json, the zip and the netlist. Throws when one is
 * missing, or when the zip, the netlist or the audit is not what the read-back passed. */
export function verified(product: string): Verified {
  const pcb = join(product, "pcb");
  for (const f of ["board.json", "drc.json", "readback.json"])
    if (!existsSync(join(pcb, f))) throw new Error(`there is no pcb/${f} to hand off from: run distinta verify`);
  const board = read<BoardJson>(join(pcb, "board.json")), drc = read<DrcJson>(join(pcb, "drc.json")), rb = read<ReadbackJson>(join(pcb, "readback.json"));
  if (!rb.ok || rb.inputs !== board.inputs || drc.inputs !== board.inputs) throw new Error("pcb/readback.json did not pass this very board: run distinta verify");
  const zipPath = join(pcb, board.files.zip);
  if (!existsSync(zipPath) || rb.files?.zip?.name !== board.files.zip || sha256(readFileSync(zipPath)) !== rb.files?.zip?.sha256)
    throw new Error(`pcb/${board.files.zip} is not the zip the read-back passed: run distinta verify`);
  const files = new Map(unzip(readFileSync(zipPath)).map((f) => [f.name, f.data.toString("utf8")]));
  return { board, drc, readback: rb, d356: readFileSync(join(pcb, board.files.netlist), "utf8"), files };
}

/** One fab's zip: the board's own Gerbers under the fab's names, the drill files in its format and its netlist when
 * it takes one in the zip. */
export function fabPackage(id: string, v: Verified): FabPackage {
  const f = FAB_ORDERS[id], slug = v.board.slug, names = f.names(slug);
  const files = ROLES.map((role) => {
    const own = v.files.get(v.board.files[role]);
    if (own === undefined) throw new Error(`the board's zip has no ${v.board.files[role]} (${role})`);
    const drill = role === "PTH" || role === "NPTH";
    const data = drill && f.drills !== "mm" ? excellon(slug, role === "PTH", role === "PTH" ? v.board.drills.plated : v.board.drills.nonPlated, f.drills) : own;
    return { name: names[role], data };
  });
  if (f.netlistInZip) files.push({ name: f.netlistInZip, data: v.d356 });
  const bytes = zip(files), name = `${slug}-${id}.zip`;
  return {
    id, name: FAB_PROFILES[id].name, zip: name, files, bytes, sha256: sha256(bytes), drills: f.drills,
    roles: { ...names, ...(f.netlistInZip ? { netlistInZip: f.netlistInZip } : {}), netlist: v.board.files.netlist, zip: name },
  };
}

/** A fab profile the hand-off writes no folder for, and why. */
export type Skipped = { id: string; name: string; why: string };

/** The zips of every fab profile the board passes, and the ones it writes none for. */
export function fabPackages(v: Verified): { packages: FabPackage[]; skipped: Skipped[] } {
  const packages: FabPackage[] = [], skipped: Skipped[] = [];
  for (const [id, p] of Object.entries(FAB_PROFILES)) {
    const fit = v.drc.fabs?.[id];
    if (!fit?.ok) skipped.push({ id, name: p.name, why: fit ? fit.why.join("; ") : "drc.json does not say whether the board passes it" });
    else if (!FAB_ORDERS[id]) skipped.push({ id, name: p.name, why: "the hand-off does not know how to order from it yet" });
    else packages.push(fabPackage(id, v));
  }
  return { packages, skipped };
}

// ---- the texts ------------------------------------------------------------------------------------------------

/** The board as the order forms ask for it: the size from board.json, the thickness and finish from bom.json's PCB
 * line (or design.json's pcbThicknessMm), and 1 oz copper, which every profile above assumes. */
export function boardSpec(product: string, board: BoardJson): BoardSpec {
  const bom = existsSync(join(product, "bom.json")) ? read<Bom>(join(product, "bom.json")) : undefined;
  const design = existsSync(join(product, "design.json")) ? read<{ params?: Record<string, unknown> }>(join(product, "design.json")) : undefined;
  const line = pcbLine(bom, board);
  const thickness = Number(line?.spec.thicknessMm ?? design?.params?.pcbThicknessMm ?? NaN);
  const { width, height, corner } = board.board;
  return {
    widthMm: width, heightMm: height, cornerMm: corner, areaCm2: (width * height) / 100, layers: 2,
    thicknessMm: Number.isFinite(thickness) ? thickness : 1.6,
    ...(Number.isFinite(thickness) ? {} : { thicknessNote: "neither bom.json nor design.json gives a thickness, so the fabs' standard 1.6 mm" }),
    copper: "1 oz (35 µm)", finish: String(line?.spec.finish ?? "HASL"),
  };
}

/** bom.json's line for this board: the PCB line whose file is its zip, or the first PCB line. */
const pcbLine = (bom: Bom | undefined, board: BoardJson) =>
  bom?.lines.find((l) => l.process === "pcb" && l.file === `pcb/${board.files.zip}`) ?? bom?.lines.find((l) => l.process === "pcb");

/** How many boards the product needs: its PCB line for the batch, spares included. */
function needed(product: string, board: BoardJson): number {
  const bom = existsSync(join(product, "bom.json")) ? read<Bom>(join(product, "bom.json")) : undefined;
  const line = pcbLine(bom, board);
  return line ? Math.max(1, batchNeed(line, bom!.units ?? 1)) : 1;
}

const smallest = (ds: Drill[]) => (ds.length ? Math.min(...ds.map((d) => d.d)) : 0);

function ctx(product: string, v: Verified, pkg: FabPackage): Ctx {
  const q = FAB_ORDERS[pkg.id].quantity, need = needed(product, v.board), { plated, nonPlated } = v.board.drills;
  return {
    slug: v.board.slug, zip: pkg.zip, spec: boardSpec(product, v.board), need, measured: v.drc.measured ?? {},
    qty: Math.max(q.min, Math.ceil(need / q.step) * q.step), smallestHoleMm: smallest([...plated, ...nonPlated]), smallestNpthMm: smallest(nonPlated),
    holes: { plated: plated.length, nonPlated: nonPlated.length },
  };
}

/** The read-back's tools, as readback.json names them. */
export type Tools = { gerbonara: string; shapely: string };
const readBackText = (t: Tools, which: "this zip" | "each zip") =>
  `gerbonara ${t.gerbonara} and shapely ${t.shapely} read ${which} back as the board the read-back passed: 0 errors${which === "each zip" ? " in each" : ""}.`;

/** A fab's ORDER.md: the zip and what is in it, the steps, the settings, the price, and the STOP line last. */
export function orderMd(product: string, v: Verified, pkg: FabPackage, tools: Tools): string {
  const f = FAB_ORDERS[pkg.id], p = FAB_PROFILES[pkg.id], c = ctx(product, v, pkg), price = f.price(c);
  const naming = f.naming.replace("<zip>", v.board.files.zip).replace("<netlist>", v.board.files.netlist);
  const also = f.also?.(c) ?? [];
  return [
    `# Order ${c.slug}'s board from ${p.name}`,
    "",
    `Upload \`${pkg.zip}\` (sha256 ${pkg.sha256}). It holds ${pkg.files.length} files: ${pkg.files.map((x) => `\`${x.name}\``).join(", ")}.`,
    `They are written as ${p.name} asks: ${naming} ${readBackText(tools, "this zip")}`,
    "",
    `The board is ${size(c)}, ${c.spec.layers} layers, ${c.spec.thicknessMm} mm FR-4 with ${c.spec.copper} copper, and its smallest features are inside ${p.name}'s published ${p.service} limits (${p.source}, read ${p.read}). ../README.md has the rest, and what was verified.`,
    ...(f.warning ? ["", `**Read this first.** ${f.warning(c)}`] : []),
    "",
    "## Steps",
    "",
    ...f.steps(c).map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Settings",
    "",
    "| Setting | Choose |",
    "| --- | --- |",
    ...f.settings(c).map(([k, val]) => `| ${k} | ${val} |`),
    "",
    "## Price",
    "",
    `${price.text} Source: ${price.source}, read ${READ}. Unverified: ${price.unverified}.`,
    ...(also.length ? ["", "## Also", "", ...also.map((a) => `- ${a}`)] : []),
    "",
    STOP,
    "",
  ].join("\n");
}

/** One layer of `distinta verify`, as the README lists it. */
export type LayerSummary = { title: string; checked: string; status: string; result: string };

/** pcb/order/README.md: the board, its smallest features, the fabs, and the verification. */
export function readme(product: string, v: Verified, packages: FabPackage[], skipped: Skipped[], layers: LayerSummary[], tools: Tools): string {
  const slug = v.board.slug, spec = boardSpec(product, v.board), m = v.drc.measured ?? {}, { plated, nonPlated } = v.board.drills;
  const range = (ds: Drill[]) => {
    const lo = smallest(ds), hi = Math.max(0, ...ds.map((d) => d.d));
    return !ds.length ? "none" : lo === hi ? `${lo} mm` : `${lo} to ${hi} mm`;
  };
  const feature = (k: FabFeature) => (m[k] ? [`| ${FAB_FEATURES[k].what} | ${m[k]!.mm} mm | ${m[k]!.at} |`] : []);
  const priced = (pkg: FabPackage) => FAB_ORDERS[pkg.id].price(ctx(product, v, pkg)).short;
  return [
    `# ${slug}: the board, ready to order`,
    "",
    `\`distinta verify ${slug}\` wrote this folder on ${new Date().toISOString().slice(0, 10)}, after every layer below passed: VERIFIED. Nothing has been uploaded, quoted or ordered. Pick a fab and follow the ORDER.md in its folder.`,
    "",
    "## The board",
    "",
    `- ${spec.widthMm} x ${spec.heightMm} mm (${spec.areaCm2.toFixed(2)} cm²), its corners rounded to a ${spec.cornerMm} mm radius`,
    `- ${spec.layers} copper layers, ${spec.thicknessMm} mm FR-4${spec.thicknessNote ? ` (${spec.thicknessNote})` : ""}, ${spec.copper} copper, ${spec.finish}`,
    "- solder mask on both sides, silkscreen on the top",
    `- ${plated.length} plated holes (${range(plated)}) and ${nonPlated.length} non-plated (${range(nonPlated)})`,
    `- \`${v.board.files.netlist}\`: the IPC-D-356A netlist${v.readback.stats?.d356Records ? ` (${v.readback.stats.d356Records} records)` : ""}, for a fab's electrical test`,
    "- `pcb-top.svg` and `pcb-bottom.svg`: the board as the files draw it",
    "",
    "## Smallest features",
    "",
    "| Feature | On the board | Where |",
    "| --- | --- | --- |",
    ...(Object.keys(FAB_FEATURES) as FabFeature[]).flatMap(feature),
    "",
    "## Fabs",
    "",
    `The board's smallest features are inside each fab's published limits below. Each folder holds the zip in that fab's own file names and drill format, and an ORDER.md; ${readBackText(tools, "each zip")}`,
    "",
    "| Fab | Limits | Folder | Price, unverified | Why this one |",
    "| --- | --- | --- | --- | --- |",
    ...packages.map((pkg) => `| ${pkg.name} | ${FAB_PROFILES[pkg.id].service} | \`${pkg.id}/\` | ${priced(pkg)} | ${FAB_ORDERS[pkg.id].fit} |`),
    ...skipped.map((s) => `| ${s.name} | ${FAB_PROFILES[s.id].service} | none: ${s.why} | | |`),
    "",
    "## Verification: VERIFIED",
    "",
    ...layers.map((l) => `- **${l.title}** (${l.status === "pass" ? "passed" : l.status}): ${l.checked}: ${l.result}.`),
    "",
    "These are our own checks, not a fab's. The firmware ran on an emulated Pico wired to the copper in the files, not on a board you can hold. Before the first order, print `pcb-top.svg` and `pcb-bottom.svg` at 100% scale (they carry their size in mm, so they print 1:1; check a ruler against the outline) and lay a real Pico and a real socket on them.",
    "",
    `Fingerprint of the board code, its inputs and the kit: ${v.board.inputs}. The zip the read-back passed: \`${v.board.files.zip}\`, sha256 ${v.readback.files?.zip?.sha256}.`,
    "",
    STOP,
    "",
  ].join("\n");
}

// ---- the folder -----------------------------------------------------------------------------------------------

/** A preview with its size in mm (its viewBox is in mm), so it prints 1:1 at 100% scale. */
export function printable(svg: string): string {
  const box = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  return box && !/^<svg[^>]* width=/.test(svg) ? svg.replace("<svg ", `<svg width="${box[3]}mm" height="${box[4]}mm" `) : svg;
}

/** Removes pcb/order/ when it is not of the board in pcb/ now: its order.json names another fingerprint than the
 * audit's, an audit that is itself stale, or another zip than the one there. Returns why, or undefined when it is
 * current or there is none. `distinta score`, `package` and `status` call it, so an order folder of an earlier board is
 * not left for someone to upload. */
export function dropStaleOrder(product: string): string | undefined {
  const pcb = join(product, "pcb");
  if (!existsSync(join(pcb, ORDER_DIR))) return undefined;
  let why: string | undefined;
  try {
    const o = read<{ inputs?: string; zip?: { name?: string; sha256?: string } }>(join(pcb, ORDER_DIR, "order.json"));
    const drc = existsSync(join(pcb, "drc.json")) ? read<{ inputs?: string; reads?: Reads }>(join(pcb, "drc.json")) : undefined;
    const zip = o.zip?.name ? join(pcb, o.zip.name) : "";
    if (!drc || o.inputs !== drc.inputs || inputsHash(product, drc.reads) !== drc.inputs) why = "it is of an earlier board: the board code, what it reads or the kit changed since `distinta verify` wrote it";
    else if (!zip || !existsSync(zip) || sha256(readFileSync(zip)) !== o.zip?.sha256) why = `pcb/${o.zip?.name ?? "the zip"} is not the zip it was made from`;
  } catch {
    why = "it has no order.json to tie it to the board";
  }
  if (why) clearOrder(pcb);
  return why;
}

/** Removes pcb/order/ (and a half-written one): it is of the board as it was verified. */
export function clearOrder(pcbDir: string) {
  rmSync(join(pcbDir, ORDER_DIR), { recursive: true, force: true });
  rmSync(join(pcbDir, `${ORDER_DIR}.part`), { recursive: true, force: true });
}

/** Writes pcb/order/ whole: into pcb/order.part/ first, then renamed into place. Returns the paths written, relative
 * to pcb/order/. */
export function writeOrder(product: string, v: Verified, packages: FabPackage[], skipped: Skipped[], layers: LayerSummary[], tools: Tools): string[] {
  const pcb = join(product, "pcb"), part = join(pcb, `${ORDER_DIR}.part`), written: string[] = [];
  clearOrder(pcb);
  mkdirSync(part, { recursive: true });
  const put = (path: string, data: string | Buffer) => {
    writeFileSync(join(part, path), data);
    written.push(path);
  };
  put("README.md", readme(product, v, packages, skipped, layers, tools));
  // What ties the folder to the board: dropStaleOrder removes it once either is not what pcb/ holds.
  put("order.json", `${JSON.stringify({ inputs: v.board.inputs, zip: { name: v.board.files.zip, sha256: v.readback.files?.zip?.sha256 ?? null } }, null, 2)}\n`);
  put(v.board.files.netlist, v.d356);
  for (const svg of ["pcb-top.svg", "pcb-bottom.svg"]) {
    const from = join(product, "previews", svg);
    if (existsSync(from)) put(svg, printable(readFileSync(from, "utf8")));
  }
  for (const pkg of packages) {
    mkdirSync(join(part, pkg.id));
    put(join(pkg.id, pkg.zip), pkg.bytes);
    put(join(pkg.id, "ORDER.md"), orderMd(product, v, pkg, tools));
  }
  renameSync(part, join(pcb, ORDER_DIR));
  return written;
}

// ---- never a fab ----------------------------------------------------------------------------------------------

/** The fabs' hosts, and every host under them. Nothing in the pipeline uploads to, quotes with or orders from a fab,
 * so none of them is ever fetched, not even to read a page. */
export const FAB_HOSTS = Object.freeze(["jlcpcb.com", "jlcdfm.com", "jlc.com", "pcbway.com", "aisler.net", "oshpark.com", "eurocircuits.com"]);
/** Calls that order, pay or cancel, refused on any host (a mirror or a proxy as well): PCBWay's partner API's, and
 * Aisler's CLI push bucket. A JLCPCB host's call with "order" in it is refused by name too. */
export const ORDER_CALLS = Object.freeze(["PlaceOrder", "ConfirmOrder", "PayTGroupOrder", "CancelOrder", "CancelTGroupOrder", "push-to-aisler"]);

/** Why fetching `url` is refused, or undefined when it may be fetched. */
export function refusal(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `${url} is not a URL, so it is not fetched`;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  let text = `${host}${u.pathname}${u.search}`;
  try {
    text = decodeURIComponent(text);
  } catch {
    // A broken escape: match the text as it is.
  }
  text = text.toLowerCase();
  if (FAB_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
    return `${host} is a fab's: nothing is uploaded to, quoted by or ordered from a fab, so it is never fetched`;
  const call = ORDER_CALLS.find((c) => text.includes(c.toLowerCase()));
  if (call) return `${url} is a fab's order call (${call}), which is never made`;
  if (host.includes("jlc") && text.includes("order")) return `${url} looks like a JLCPCB order call, which is never made`;
  return undefined;
}

const GUARDED = Symbol.for("distinta.noFab");

/** From now on in this process, fetch refuses what `refusal` refuses, before it connects, and checks every redirect
 * before it follows it (a redirect to a fab is refused too). The command line calls it before any command, and so
 * does everything that fetches. */
export function guardNetwork(): void {
  const inner = globalThis.fetch as typeof fetch & { [GUARDED]?: true };
  if (inner[GUARDED]) return;
  const guarded = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    let url = input instanceof Request ? input.url : String(input), next: string | URL | Request = input, opts = init;
    for (let hop = 0; hop <= 20; hop++) {
      const why = refusal(url);
      if (why) throw new Error(`refused: ${why}`);
      const r = await inner(next, { ...opts, redirect: "manual" });
      const to = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!to || init.redirect === "manual") return r;
      if (init.redirect === "error") throw new TypeError(`${url} redirects, and redirect is "error"`);
      const method = (opts.method ?? (next instanceof Request ? next.method : "GET")).toUpperCase();
      url = new URL(to, url).href;
      next = url;
      // As fetch does: a 303, or a 301 or 302 after anything but GET or HEAD, goes on as a GET with no body.
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method !== "GET" && method !== "HEAD")) opts = { ...opts, method: "GET", body: undefined };
    }
    throw new TypeError(`${String(input)} redirects more than 20 times`);
  };
  globalThis.fetch = Object.assign(guarded, { [GUARDED]: true as const }) as unknown as typeof fetch;
}
