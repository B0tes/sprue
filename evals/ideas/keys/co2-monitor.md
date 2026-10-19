# Answer key: desk CO2 monitor (co2-monitor)

**Idea:** "A desk CO2 monitor with a small screen and a light that goes green to red, powered by USB."
**User:** Italy, one unit. **Key version:** 2026-10-19 (draft plus two reviews applied). Full key: `co2-monitor.json`.

## Required roles

| Role | Accepts |
|---|---|
| CO2 sensor | True CO2 only (NDIR or photoacoustic): SCD40/41, SCD30, Senseair S8/S88, MH-Z19C/E, MH-Z16, PAS CO2. Discontinued MH-Z19B/MH-Z14A only with a named in-stock source; B-Ware only if flagged. Never eCO2 (CCS811, SGP30/4x, ENS160, BME68x). |
| Controller | Any MCU that reads the sensor and drives screen and light (RP2040/RP2350, ESP32 family, ESP8266, SAMD21, AVR with level handling, custom). Wi-Fi not needed. |
| Small screen | Shows ppm digits: small OLED, TFT, e-paper (within maker refresh limits), 16x2 LCD, a board's built-in screen; a 4-digit 7-segment at the low end. |
| Green-to-red light | Separate from the screen's pixels: addressable RGB, discrete RGB or bicolour, R/A/G LEDs behind a diffuser, or a board's on-board RGB LED shown through a window. |
| USB power input | Board's own micro-USB/USB-C, or an own USB-C with separate 5.1 kOhm Rd on CC1 and CC2. |
| USB cable | A bom.json line naming both ends (data-capable for flashing); may be marked "owned / not purchased". |
| Interconnect | Netlist or wiring table covering every sensor, screen and light connection. |
| Enclosure | Printed, laser-cut, off-the-shelf (Hammond, a dev kit's own case) or main case plus pod; vents at the sensor, screen window, light aperture, USB opening. |
| Mounting and stance | Parts fixed by their PCBs (never the sensor's optical body); stands on a desk facing the user. |

Optional (never required): Wi-Fi, buttons/menus, buzzer, battery, T/RH readout, USB wall adapter (only if the budget exceeds 500 mA).

## Traps (15)

Electrical
1. **sensor-rail-in-range-at-peak** (works-badly): the sensor's supply pin stays inside its datasheet range at peak current (MH-Z19C/14A 4.5-5.5 V, S8 4.5-5.25 V, SCD4x 2.4-5.5 V, SCD30 3.3-5.5 V), with a flag-and-measure note at a range edge, a source rated for the peak, and no more than ~10 uF added on VBUS unless noted.
2. **signal-logic-levels** (works-badly): no 3.3 V MCU pin sees a 5 V pull-up or drive unless the datasheet rates it 5 V tolerant; SCD4x at 5 V needs a 3.25 V I2C high; SCD30 pull-ups at 3.3 V or less.
3. **led-data-and-supply-level** (works-badly): a 5 V WS2812B/SK6812 fed from a 3.3 V GPIO needs a buffer with a low enough threshold, a supply diode, or a part whose VIH fits; on-board LEDs are exempt.
4. **usb-current-budget** (works-badly): a coincident-peak current table that fits 500 mA under limits the firmware actually enforces, or a rated supply in the BOM.
5. **usb-c-cc-pulldowns** (would-not-work): an own USB-C receptacle or breakout has two separate 5.1 kOhm Rd; N/A for a dev board's connector or micro-USB.

Mechanical
6. **sensor-vents-and-clearance** (works-badly): openings face the sensor inlet, nothing covers or touches the sensing body (S8 1.5 mm filter gap, 1 mm allowance otherwise), and the sensor's air is separated from the electronics'.
7. **sensor-away-from-heat** (works-badly): the sensor is not above an active radio, a hot regulator, a backlight or bright LEDs, and is 10 mm or more away or behind a wall, pod or slot.
8. **screen-light-usb-accessible** (would-not-work): with the case closed, the screen's active area is visible, the light can be seen, the USB plug fits (shell-sized hole when the receptacle is flush), and the unit stands facing the user.

Firmware
9. **scd30-i2c-bus-speed** (works-badly, SCD30 only): its bus runs at 100 kHz or less and tolerates up to 150 ms of clock stretching, or the SCD30 uses UART.
10. **thresholds-ppm-sourced** (works-badly): sourced ppm thresholds, green ending at 800-1000 ppm and full red at 1000-2000 ppm (bands 100 ppm apart, or a monotonic blend), with hysteresis or averaging.
11. **calibration-and-asc** (works-badly): the ASC state is set explicitly (SCD4x only while idle) or its default is documented; the plan gives a correct outdoor calibration; HD is never held low; persist_settings is not called on every boot.
12. **warmup-and-fault-state** (works-badly): the light is never steady green during the preheat, and it leaves green with an on-screen error on a read failure or stale data (about 3 measurement intervals).

Source and quote
13. **eu-sourcing-italy** (cost): every purchased line is from an EU shop (or carries import VAT and duty) with URL, price and stock; the sensor is a true CO2 part in stock; B-Ware is flagged; 3 shops or fewer.
14. **landed-cost-it** (cost): VAT and per-shop shipping are in the quote, plus the EUR 3 per-category duty on non-EU fab lines; the total is EUR 60-175 or explained; under ~EUR 40 needs line-by-line justification.

Build plan
15. **build-plan-flash-test-calibrate** (works-badly): the plan covers flashing, an unloaded rail check before fitting the sensor and a loaded check after, a breath test, calibration after assembly, sensor-handling cautions before fitting, and placement.

## Cost band (delivered to Italy, VAT included)

**EUR 60 to 175.**
- **Low, about EUR 60:** an all-new, single-shop Reichelt IT build (MH-Z19C, Pico, 0.96 in OLED, WS2812 stick, jumpers, micro-USB cable, DHL EUR 9.95) costs EUR 60.63. A home-printed case brings it to about EUR 61.5.
- **Below the band:** itemised builds of EUR 40-60 can be sound. A Berrybase build with a B-Ware MH-Z19C lands at about EUR 44-47 (reviewer estimate). A total under about EUR 40 is a red flag.
- **High, about EUR 175:** a KnowCO2-style Berrybase build (Reverse TFT Feather, Adafruit SCD-41, NeoPixel Jewel) is EUR 102.31. A service-printed case brings it to about EUR 115-140, and a 5 V supply or a custom carrier PCB takes it to about EUR 175. Above about EUR 200 is overbuying.
- **Real products for comparison:**
  - Curious Electric kit: about EUR 53, sold out at the maker.
  - Watterott CO2-Ampel Pro: EUR 81 incl. 19% VAT.
  - KnowCO2 BOM: about EUR 77 before case, shipping and VAT.
  - AirGradient ONE kit: about EUR 123.

## Accepted architectures

- Dev board plus breakout modules, hand-wired with solder or Dupont jumpers, in a printed or cut case. Example: Pico + MH-Z19C + SSD1306 + WS2812B stick.
- Dev board and modules plugged into a custom 2-layer carrier PCB, perfboard or stripboard.
- A solderless STEMMA QT, Qwiic or Grove chain.
- A dev board with a built-in screen, plus the sensor in a pod or compartment and a separate or exposed RGB LED.
- A fully custom PCB (MCU, regulator, USB-C with Rd, LEDs) with the sensor as a module or a reflowed SCD4x, if the quote covers fabrication and assembly.
- **Sensor rail:** 5 V (any listed sensor) or 3.3 V (SCD4x; SCD30 only with a flag).
- **Light:** addressable, discrete or R/A/G LEDs; one LED or a bar.
- **Case:** FDM print, laser-cut sandwich, a bought vented box or a dev kit's housing, or a main case plus pod.
- **Firmware:** any toolchain (CircuitPython, MicroPython, Arduino, ESP-IDF, ESPHome), Wi-Fi on or off.
- **Power:** a wall adapter or computer port, through micro-USB or USB-C.

## Not required

These are never marked down:
- Wi-Fi or cloud features.
- Buttons and menus.
- A buzzer.
- A battery.
- A T/RH readout (a temperature offset is needed only if one is shown).
- Pressure compensation.
- PM, VOC or NOx sensing.
- Auto-dimming.
- Graphs and logging.
- A hardware watchdog.
- A power switch.
- Wall mounting.
- A wall adapter (unless the budget exceeds 500 mA).
- An ESD/PTC on dev-board power.
- A colour-blind palette.
- A light bar.
- A large or colour display.
- Certification.
- Antenna keep-outs without Wi-Fi.
- Buying the USB cable.
- An I2C rise-time calculation (advisory for long pod cables).
- OLED burn-in mitigation (advisory).
