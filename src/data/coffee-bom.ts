// Illustrative BOM for the landing page demo. Prices are ballpark figures for a
// 10-unit prototype run, not live quotes. The daily loop replaces them with real
// quotes as each supplier integration lands.

export type QuoteMode = "api" | "scripted" | "agent";

export type BomLine = {
  id: string;
  part: string;
  spec: string;
  process: string;
  supplier: string;
  mode: QuoteMode;
  unitUsd: number;
  leadDays: number;
};

export const brief =
  "A single-cup coffee machine that grinds the beans, weighs the dose and brews pour-over style. Countertop, 120V.";

export const bom: BomLine[] = [
  { id: "01", part: "Bean hopper", spec: "Clear PETG, 120 ml", process: "3D print · FDM", supplier: "Slant 3D", mode: "api", unitUsd: 9.4, leadDays: 6 },
  { id: "02", part: "Conical burr set", spec: "38 mm, hardened steel", process: "Off-the-shelf", supplier: "Burr OEM", mode: "agent", unitUsd: 17.5, leadDays: 14 },
  { id: "03", part: "Grinder motor", spec: "24V DC, 60 W, gearhead", process: "Distributor", supplier: "DigiKey", mode: "api", unitUsd: 21.0, leadDays: 3 },
  { id: "04", part: "Shell", spec: "PA12, 2 halves, 220 × 160 × 300 mm", process: "3D print · SLS", supplier: "Sculpteo", mode: "api", unitUsd: 48.0, leadDays: 7 },
  { id: "05", part: "Brew chamber", spec: "304 stainless, Ø70 mm", process: "CNC turning", supplier: "Xometry", mode: "agent", unitUsd: 36.0, leadDays: 10 },
  { id: "06", part: "Control board", spec: "2-layer, 80 × 60 mm, assembled", process: "PCB fab + assembly", supplier: "JLCPCB", mode: "api", unitUsd: 13.8, leadDays: 8 },
  { id: "07", part: "ESP32-S3 module", spec: "WROOM-1, 8 MB flash", process: "Distributor", supplier: "Mouser", mode: "api", unitUsd: 3.9, leadDays: 3 },
  { id: "08", part: "Load cell + ADC", spec: "1 kg bar, HX711", process: "Distributor", supplier: "LCSC", mode: "scripted", unitUsd: 4.2, leadDays: 6 },
  { id: "09", part: "Thermoblock heater", spec: "1200 W, 120V, NTC", process: "Off-the-shelf", supplier: "Heater OEM", mode: "agent", unitUsd: 22.0, leadDays: 18 },
  { id: "10", part: "Diaphragm pump", spec: "12V, food-safe", process: "Distributor", supplier: "DigiKey", mode: "api", unitUsd: 9.1, leadDays: 3 },
  { id: "11", part: "Drip tray", spec: "1.2 mm 304 stainless, bent", process: "Sheet metal", supplier: "SendCutSend", mode: "agent", unitUsd: 11.0, leadDays: 5 },
  { id: "12", part: "Fasteners + tubing", spec: "M3 SS kit, silicone 4 mm", process: "Catalog", supplier: "McMaster-Carr", mode: "scripted", unitUsd: 5.5, leadDays: 2 },
];

export const modeLabel: Record<QuoteMode, string> = {
  api: "API quote",
  scripted: "Scripted",
  agent: "Agent RFQ",
};

export const modeHint: Record<QuoteMode, string> = {
  api: "Priced by a documented API call",
  scripted: "Priced by a few lines of code against the supplier's calculator or catalog",
  agent: "An agent fills in the quote form or writes the RFQ, then reads the reply",
};
