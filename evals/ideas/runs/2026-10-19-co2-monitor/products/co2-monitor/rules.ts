// Engineer checks for the desk CO2 monitor. Every number comes from design.json params (p) or bom.json lines
// (bom.lines); where a number is a limit from a datasheet or a shop, design.md names the source.

const num = (p, k) => Number(p[k]);
const qty = (bom, role) => bom.lines.filter((l) => l.role === role).reduce((s, l) => s + (l.qtyPerUnit || 0) + (l.qtyPerBatch ? 1 : 0), 0);
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);
const ok = (cond, detail) => ({ status: cond ? "pass" : "fail", detail });
const gpioNo = (s) => Number(String(s).replace(/^GP/, ""));

// LED current through one anode: (GPIO high - forward voltage) / resistor, in mA.
const ledMa = (p, vf) => ((num(p, "gpioV") - vf) / num(p, "ledResistorOhm")) * 1000;

// Everything on the Pico's 3V3(OUT), worst case: the sensor's peak, the OLED all on, both LED colours full.
function load3v3(p) {
  const leds = ledMa(p, num(p, "ledRedVfV")) + ledMa(p, num(p, "ledGreenVfV"));
  return { co2: num(p, "co2PeakMa"), oled: num(p, "oledMaxMa"), leds, total: num(p, "co2PeakMa") + num(p, "oledMaxMa") + leds };
}

export const rules = [
  // The keypad's check that its feet lift the screw heads under its tray off the desk: this case has no screws
  // underneath (the four M3 screws close the lid at the back), so it doesn't apply (design.md says so too).
  { id: "feet-clear-heads", off: true },
  {
    id: "co2-bom-roles",
    title: "Every part the design needs is in the BOM",
    needs: ["requiredRoles"],
    run: ({ p, bom }) => {
      const missing = String(p.requiredRoles).split(",").map((r) => r.trim()).filter((r) => qty(bom, r) === 0);
      return ok(missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : `All ${String(p.requiredRoles).split(",").length} roles present`);
    },
  },
  {
    id: "power-3v3",
    title: "The 3.3 V load fits the Pico's regulator",
    needs: ["co2PeakMa", "oledMaxMa", "gpioV", "ledRedVfV", "ledGreenVfV", "ledResistorOhm", "pico3v3MaxExternalMa"],
    run: ({ p }) => {
      const l = load3v3(p);
      return ok(l.total <= num(p, "pico3v3MaxExternalMa"),
        `Peak external load on 3V3(OUT): sensor ${l.co2} + OLED ${l.oled} + LED ${f1(l.leds)} = ${f1(l.total)} mA, under the ${num(p, "pico3v3MaxExternalMa")} mA the Pico datasheet asks (${f1(num(p, "pico3v3MaxExternalMa") - l.total)} mA to spare)`);
    },
  },
  {
    // Replaces the keypad's built-in, which counts only the controller.
    id: "usb-power",
    title: "The whole draw fits a USB 2.0 port",
    needs: ["picoBoardMa", "co2PeakMa", "oledMaxMa", "usbBudgetMa", "gpioV", "ledRedVfV", "ledGreenVfV", "ledResistorOhm"],
    run: ({ p }) => {
      // Counted as if the 3.3 V were made linearly from 5 V (the buck-boost draws less): a ceiling, not a typical.
      const total = num(p, "picoBoardMa") + load3v3(p).total;
      return ok(total <= num(p, "usbBudgetMa"),
        `At most ${f1(total)} mA from USB at the sensor's 205 mA pulse (Pico ${num(p, "picoBoardMa")} mA allowance + the 3.3 V load counted 1:1), vs ${num(p, "usbBudgetMa")} mA from a USB 2.0 port; about ${f1(num(p, "picoBoardMa") + num(p, "co2AverageMa") + num(p, "oledMaxMa") / 2)} mA on average`);
    },
  },
  {
    id: "led-current",
    title: "The LED's current suits the GPIO and the LED",
    needs: ["gpioV", "ledRedVfV", "ledGreenVfV", "ledVfMaxV", "ledResistorOhm", "gpioDriveMa", "ledMaxMa"],
    run: ({ p }) => {
      const red = ledMa(p, num(p, "ledRedVfV")), green = ledMa(p, num(p, "ledGreenVfV")), least = ledMa(p, num(p, "ledVfMaxV"));
      const high = Math.max(red, green);
      const fine = high <= num(p, "gpioDriveMa") && high <= num(p, "ledMaxMa") && least >= 1;
      return ok(fine,
        `${num(p, "ledResistorOhm")} ohm: red ${f2(red)} mA, green ${f2(green)} mA at typical Vf, ${f2(least)} mA at the ${num(p, "ledVfMaxV")} V maximum Vf; each under the RP2040's ${num(p, "gpioDriveMa")} mA default drive and the LED's ${num(p, "ledMaxMa")} mA, and at least 1 mA so it lights`);
    },
  },
  {
    id: "gpio-total",
    title: "The GPIO bank's total current stays in the RP2040's limit",
    needs: ["gpioV", "ledRedVfV", "ledGreenVfV", "ledResistorOhm", "rp2040IovddMaxMa"],
    run: ({ p }) => {
      const total = ledMa(p, num(p, "ledRedVfV")) + ledMa(p, num(p, "ledGreenVfV"));
      return ok(total <= num(p, "rp2040IovddMaxMa"), `${f2(total)} mA sourced by GPIOs (both colours on) vs ${num(p, "rp2040IovddMaxMa")} mA for all of IOVDD`);
    },
  },
  {
    id: "pin-map",
    title: "The pins are distinct and do what they are wired for",
    needs: ["i2cSdaGpio", "i2cSclGpio", "ledRedGpio", "ledGreenGpio"],
    run: ({ p }) => {
      const pins = ["i2cSdaGpio", "i2cSclGpio", "ledRedGpio", "ledGreenGpio"].map((k) => gpioNo(p[k]));
      const distinct = new Set(pins).size === pins.length && pins.every((n) => Number.isInteger(n) && n >= 0 && n <= 28);
      // RP2040 function table: I2C0 SDA on GP0, 4, 8, 12, 16, 20 and SCL on the GPIO after each; both pins on one bus.
      const [sda, scl, red, green] = pins;
      const i2c = sda % 4 === 0 && scl === sda + 1;
      // PWM: GPn is slice (n >> 1) & 7, channel n & 1. Two pins on one slice must be on different channels.
      const slice = (n) => (n >> 1) & 7, ch = (n) => n & 1;
      const pwm = slice(red) !== slice(green) || ch(red) !== ch(green);
      return ok(distinct && i2c && pwm,
        `I2C${(sda >> 1) & 1} SDA ${p.i2cSdaGpio}, SCL ${p.i2cSclGpio}${i2c ? "" : " (not a matching SDA/SCL pair)"}; LED red ${p.ledRedGpio} (PWM ${slice(red)}${"AB"[ch(red)]}), green ${p.ledGreenGpio} (PWM ${slice(green)}${"AB"[ch(green)]})${pwm ? "" : " share a PWM channel"}${distinct ? "" : "; a pin is used twice or out of range"}`);
    },
  },
  {
    id: "i2c-bus",
    title: "The I2C devices have their own addresses and the bus speed suits them",
    needs: ["co2I2cAddress", "oledI2cAddresses", "i2cKhz", "i2cMaxKhz"],
    run: ({ p }) => {
      const co2 = String(p.co2I2cAddress).toLowerCase();
      const oled = String(p.oledI2cAddresses).toLowerCase().split(",").map((s) => s.trim());
      const clash = oled.includes(co2);
      return ok(!clash && num(p, "i2cKhz") <= num(p, "i2cMaxKhz"),
        `SCD4x at ${co2}, OLED at ${oled.join(" or ")}${clash ? ": they clash" : ""}; bus at ${num(p, "i2cKhz")} kHz, the SCD4x takes up to ${num(p, "i2cMaxKhz")} kHz`);
    },
  },
  {
    id: "co2-thresholds",
    title: "The light's thresholds sit inside the sensor's specified range",
    needs: ["co2GreenBelowPpm", "co2RedFromPpm", "co2SpecifiedMaxPpm"],
    run: ({ p }) => {
      const g = num(p, "co2GreenBelowPpm"), r = num(p, "co2RedFromPpm"), max = num(p, "co2SpecifiedMaxPpm");
      // At the red threshold the SCD40 reads within +-(50 ppm + 5 %) (datasheet).
      const err = 50 + 0.05 * r;
      return ok(g > 400 && g < r && r <= max,
        `Green below ${g} ppm, red from ${r} ppm (UBA guide values); the SCD40 is specified to ${max} ppm, reading +-${f1(err)} ppm at ${r}`);
    },
  },
  {
    id: "screen-window",
    title: "The window shows the whole active area from 30 degrees off axis, and only glass",
    needs: ["windowWidthMm", "windowHeightMm", "oledActiveWidthMm", "oledActiveHeightMm", "oledGlassWidthMm", "oledGlassHeightMm",
      "oledActiveFromGlassTopMm", "shellWallMm"],
    run: ({ p }) => {
      const reach = num(p, "shellWallMm") * Math.tan((30 * Math.PI) / 180); // how far a 30 degree ray moves crossing the wall
      const needW = num(p, "oledActiveWidthMm") / 2 + reach, needH = num(p, "oledActiveHeightMm") / 2 + reach;
      const haveW = num(p, "windowWidthMm") / 2, haveH = num(p, "windowHeightMm") / 2;
      // The window is centred on the active area; the active area sits oledActiveFromGlassTopMm under the glass's top.
      const activeUp = num(p, "oledGlassHeightMm") / 2 - num(p, "oledActiveFromGlassTopMm") - num(p, "oledActiveHeightMm") / 2;
      const glassTop = num(p, "oledGlassHeightMm") / 2 - activeUp, glassBottom = num(p, "oledGlassHeightMm") / 2 + activeUp;
      const onGlass = haveW <= num(p, "oledGlassWidthMm") / 2 && haveH <= glassTop && haveH <= glassBottom;
      return ok(haveW >= needW && haveH >= needH && onGlass,
        `Window half-size ${f2(haveW)} x ${f2(haveH)} mm vs ${f2(needW)} x ${f2(needH)} mm needed for 30 degrees through the ${num(p, "shellWallMm")} mm wall; glass edges ${f2(num(p, "oledGlassWidthMm") / 2)} mm to the sides, ${f2(glassTop)} above and ${f2(glassBottom)} below the window's centre${onGlass ? "" : ": the window shows past the glass"}`);
    },
  },
  {
    id: "led-place",
    title: "The LED clears the OLED and the top wall",
    needs: ["ledCentreZMm", "ledFlangeMm", "oledBottomZMm", "oledBoardHeightMm", "caseHeightMm", "shellWallMm", "minClearanceMm"],
    run: ({ p }) => {
      const r = num(p, "ledFlangeMm") / 2, z = num(p, "ledCentreZMm");
      const below = z - r - (num(p, "oledBottomZMm") + num(p, "oledBoardHeightMm"));
      const above = num(p, "caseHeightMm") - num(p, "shellWallMm") - (z + r);
      const c = num(p, "minClearanceMm");
      return ok(below >= c && above >= c, `Flange ${f2(below)} mm above the OLED board, ${f2(above)} mm under the top wall (at least ${c})`);
    },
  },
  {
    id: "usb-reach",
    title: "The micro-USB plug seats through the side opening",
    needs: ["usbOpeningAlongZMm", "usbOpeningAlongYMm", "usbOvermoldWidthMm", "usbOvermoldHeightMm", "minClearanceMm",
      "usbPlugMetalLengthMm", "usbReceptacleDepthMm", "picoUsbEndGapMm", "shellWallMm"],
    run: ({ p }) => {
      const c = num(p, "minClearanceMm");
      const gz = (num(p, "usbOpeningAlongZMm") - num(p, "usbOvermoldWidthMm")) / 2;
      const gy = (num(p, "usbOpeningAlongYMm") - num(p, "usbOvermoldHeightMm")) / 2;
      // The metal sticks out of the socket by this much; the moulding then sits this far inside the outer face.
      const proud = num(p, "usbPlugMetalLengthMm") - num(p, "usbReceptacleDepthMm");
      const inside = num(p, "picoUsbEndGapMm") + num(p, "shellWallMm") - proud;
      return ok(gz >= c && gy >= c,
        `The ${num(p, "usbOvermoldWidthMm")} x ${num(p, "usbOvermoldHeightMm")} mm moulding has ${f2(gz)} and ${f2(gy)} mm each side in the opening (at least ${c}); seated, it goes ${f2(inside)} mm into the wall`);
    },
  },
  {
    id: "screws",
    title: "Every screw bites far enough and stops short of a face",
    needs: ["lidScrewLengthMm", "lidThicknessMm", "minThreadEngagementMm", "insertHoleDepthMm", "picoScrewLengthMm", "picoBoardMm",
      "picoStandoffMm", "co2ScrewLengthMm", "co2BoardThicknessMm", "co2SensorHeightMm", "co2SensorToLidMm", "oledScrewLengthMm",
      "oledBoardThicknessMm", "oledGlassThicknessMm", "oledTapeMm", "shellWallMm", "minSkinOverPilotMm", "m2MinEngagementMm"],
    run: ({ p }) => {
      const skin = num(p, "minSkinOverPilotMm"), m2 = num(p, "m2MinEngagementMm");
      const lid = num(p, "lidThicknessMm");
      const m3 = num(p, "lidScrewLengthMm") - lid;
      const rows = [
        // [name, engagement, room for it, least engagement]
        ["M3 lid screws", m3, num(p, "insertHoleDepthMm"), num(p, "minThreadEngagementMm")],
        ["M2 Pico screws", num(p, "picoScrewLengthMm") - num(p, "picoBoardMm"), num(p, "picoStandoffMm") + lid - skin, m2],
        ["M2 sensor screws", num(p, "co2ScrewLengthMm") - num(p, "co2BoardThicknessMm"),
          num(p, "co2SensorHeightMm") + num(p, "co2SensorToLidMm") + lid - skin, m2],
        ["M2 OLED screws", num(p, "oledScrewLengthMm") - num(p, "oledBoardThicknessMm"),
          num(p, "oledGlassThicknessMm") + num(p, "oledTapeMm") + num(p, "shellWallMm") - skin, m2],
      ];
      const bad = rows.filter(([, e, room, least]) => e < least || e > room);
      return ok(bad.length === 0, rows.map(([n, e, room, least]) => `${n} ${f2(e)} mm in (at least ${least}, room ${f2(room)})`).join("; "));
    },
  },
  {
    id: "print-walls",
    title: "The printed walls meet the print shops' least walls",
    needs: ["shellWallMm", "lidThicknessMm", "bossDiameterMm", "insertHoleMm", "picoStandoffDiameterMm", "co2StandoffDiameterMm",
      "oledBossDiameterMm", "m2PilotMm", "printMinWallMm", "printWallUpTo100MmMm", "fastenerWallMinMm", "caseWidthMm", "caseHeightMm"],
    run: ({ p }) => {
      const longest = Math.max(num(p, "caseWidthMm"), num(p, "caseHeightMm"));
      const walls = [["shell walls", num(p, "shellWallMm")], ["lid", num(p, "lidThicknessMm")]];
      const round = [
        ["insert columns", (num(p, "bossDiameterMm") - num(p, "insertHoleMm")) / 2],
        ["Pico standoffs", (num(p, "picoStandoffDiameterMm") - num(p, "m2PilotMm")) / 2],
        ["sensor standoffs", (num(p, "co2StandoffDiameterMm") - num(p, "m2PilotMm")) / 2],
        ["OLED bosses", (num(p, "oledBossDiameterMm") - num(p, "m2PilotMm")) / 2],
      ];
      const under = walls.filter(([, t]) => t < num(p, "printMinWallMm"));
      const thin = walls.filter(([, t]) => longest <= 100 && t < num(p, "printWallUpTo100MmMm"));
      const tight = round.filter(([, t]) => t <= num(p, "fastenerWallMinMm"));
      const status = under.length ? "fail" : thin.length || tight.length || longest > 100 ? "flag" : "pass";
      return {
        status,
        detail: `${walls.map(([n, t]) => `${n} ${t} mm`).join(", ")} (FDM: ${num(p, "printMinWallMm")} mm least, ${num(p, "printWallUpTo100MmMm")} mm for a part up to 100 mm; this case is ${longest} mm); round fasteners ${round.map(([n, t]) => `${n} ${f2(t)} mm`).join(", ")} (more than ${num(p, "fastenerWallMinMm")} mm asked)` +
          (tight.length ? `: ${tight.map(([n]) => n).join(", ")} not over it` : ""),
      };
    },
  },
  {
    id: "sensor-heat",
    title: "The CO2 sensor sits below the heat sources (Sensirion's advice)",
    needs: ["co2CentreZMm", "co2BoardHeightMm", "picoBottomZMm", "picoWidthMm"],
    run: ({ p }) => {
      const sensorLow = num(p, "co2CentreZMm") - num(p, "co2BoardHeightMm") / 2;
      const picoHigh = num(p, "picoBottomZMm") + num(p, "picoWidthMm");
      if (sensorLow < num(p, "picoBottomZMm")) return { status: "pass", detail: "The sensor is below the Pico" };
      return {
        status: "flag",
        detail: `The sensor's board starts ${f1(sensorLow - picoHigh)} mm above the Pico, so the Pico's warmth (about 0.1 W) rises past it. Chosen so the USB plug sits low (a cable pull tips it less); the CO2 reading is compensated inside the SCD40, but the temperature and humidity it shows need TEMP_OFFSET_C set against a thermometer (assembly, last step)`,
      };
    },
  },
  {
    id: "self-calibration",
    title: "The sensor's self-calibration gets fresh air",
    needs: ["ascFreshAirEveryDays", "ascFreshAirMinutes"],
    run: ({ p }) => ({
      status: "flag",
      detail: `The SCD40's automatic self-calibration assumes it sees outdoor air (about 400 ppm) for ${num(p, "ascFreshAirMinutes")} minutes at least once every ${num(p, "ascFreshAirEveryDays")} days. A room that is never aired drifts the zero; air it, or put the monitor on an open window sill now and then`,
    }),
  },
  {
    id: "standards",
    title: "Regulatory standards",
    needs: ["requiredRoles"],
    run: () => ({
      status: "flag",
      detail: "Built for your own desk it needs nothing. Selling it in the EU would need CE marking (EMC directive for the electronics, RoHS) and in the US FCC Part 15B; the Pico's own compliance doesn't cover the finished product. It is not a certified CO2 measuring instrument.",
    }),
  },
];
