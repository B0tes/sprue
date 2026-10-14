# Keypad PCB footprints: MX switch, Kailh hot-swap socket, Raspberry Pi Pico (research as of 2026-10-14)

These are the numbers the keypad PCB builder uses. Two researchers gathered them separately, one from manufacturer
datasheets (A) and one from open-source KiCad libraries (B). Where they differed by more than 0.01 mm, or one marked a
value uncertain, I went back to the primary source and decided. Section 5 lists each of those decisions.
"Measured" means read off a to-scale manufacturer drawing (about 64 px/mm), not a dimension printed on it.

## 1. Frames

| Frame | Origin | Axes | To PCB coordinates |
|---|---|---|---|
| **PCB** | PCB centre | x right (the USB end), y up (the controller end), top view | - |
| **Switch** | switch centre | top view (switch side), x right, y up; the two contact pins sit above the centre | PCB = (cx + x, cy + y). No rotation, no mirror |
| **Pico** | Pico centre | top view, components facing you, x toward the USB end, y up; pins 1-20 on the +y row | PCB = Pico + (5.0, 26.5). No rotation |

- **Everything is given as seen from the top, through the board, including the socket pads on B.Cu.** Put B.Cu pads at
  these coordinates as they are. Do not mirror them again. If you write a KiCad footprint on F and flip it to B, write it
  with x negated, because KiCad's flip mirrors x.
- KiCad files are y-down, so negate y when you write one.
- KiCad Pico footprints have USB toward -Y (y-down). The map to the Pico frame is x = -Y_kicad, y = -X_kicad. That is a
  rotation, not a mirror. Check: KiCad pad 1 at (-8.89, -24.13) becomes (+24.13, +8.89).
- Key centres: cx = -19.05, 0, +19.05; cy = -32.075, -13.025, +6.025.

## 2. Cherry MX switch, per key (switch frame)

| Feature | x, y | Hole | Source |
|---|---|---|---|
| Centre post | (0, 0) | NPTH Ø4.0 (+0.1/-0) | Cherry Keymodule MX "4 +0,1"; Cherry MX catalogue Ø0.157 in |
| Contact pin A | (-3.81, +2.54) | socket hole, see 3 (not the 1.5 mm solder hole) | Cherry 1.27 mm grid (-3, +2); KiCad SW_Cherry_MX_1.00u_PCB |
| Contact pin B | (+2.54, +5.08) | socket hole, see 3 | Cherry grid (+2, +4); KiCad |
| Fixing pegs (5-pin switches) | (-5.08, 0), (+5.08, 0) | NPTH Ø1.75 | Cherry Ø0.067 ±0.002 in (1.70 ±0.05), at the top of that band; every hot-swap library uses 1.75 |
| LED / diode holes | - | none | not used (no LEDs, no diodes) |

- The switch is single-pole, normally open, and its two pins are not numbered. Either pin can go to the GPIO.
- Pins and centre post reach 3.3 mm below the housing, so about 1.7 mm below a 1.6 mm PCB. That is inside the socket's
  1.80 mm and the 2.15 mm clearance under the board.
- Plate (in the top shell): plate top to PCB top 5.0 +0.3, plate 1.5 ±0.1, cutout 14.0 ±0.05 with corner R0.3 max.
- Courtyard: switch body 14 x 14 (±7). Key unit 19.05 x 19.05.

## 3. Kailh MX hot-swap socket CPG151101S11, per key, on the back (switch frame)

| Feature | Centre x, y | Size | Layer / type |
|---|---|---|---|
| Socket hole A (pin A) | (-3.81, +2.54) | Ø3.0 | NPTH |
| Socket hole B (pin B) | (+2.54, +5.08) | Ø3.0 | NPTH |
| Pad A (terminal of pin A's clip) | (-7.36, +2.54) | 2.55 (x) x 2.50 (y), rect | B.Cu + B.Mask; spans x -8.635..-6.085, y 1.29..3.79 |
| Pad B (terminal of pin B's clip) | (+6.09, +5.08) | 2.55 x 2.50, rect | B.Cu + B.Mask; spans x 4.815..7.365, y 3.83..6.33 |

- Each pad sits outboard along x from its own pin, at that pin's y. Its inner edge meets the body end:
  (10.90 - 6.35) / 2 + 2.55 / 2 = 3.55 mm from the hole. I measured 3.54 and 3.55 on the Kailh drawing.
- Body on the back. Bounding box x -6.085..+4.815, y +0.81..+6.70 (nominal: 10.90 ±0.1 long, 5.89 ±0.1 across the
  wide part around pin A, 4.00 ±0.1 across the narrow part around pin B). For a courtyard, use x -6.14..+4.87,
  y +0.76..+6.75.
- Outline, measured ±0.05: (-6.085, 0.85), (-2.80, 0.85), (-2.45, 1.15), (-2.27, 1.57), (-1.96, 2.00),
  (-1.65, 2.28), (-1.33, 2.52), (-0.86, 2.69), (-0.40, 2.75), (4.32, 2.75), (4.815, 3.25), (4.815, 6.70),
  (-4.085, 6.70), (-5.50, 6.11), (-6.085, 4.70).
  - The notch is an arc 2.70-2.85 mm from the switch centre. It clears the Ø4.0 centre hole by at least 0.7 mm.
  - The top-left corner is about R2, the narrow part's lower-right corner about R0.5.
  - The SMD terminals stick out to about x -7.87 and +6.64.
- Height: body 1.80 ±0.05 below the PCB (1.85 max, which is design.json `socketHeightMm`). The overall height of 3.05
  ±0.05 includes the locating bosses, which sit about 1.25 mm up inside the 3.0 holes.
- Clearances: pad to socket hole 0.78, pad A to the left peg hole 0.76, peg hole to the body edge about 0 (see
  section 7). The outer-column pads end at x -27.685 and +26.415, which is 2.8 and 4.1 mm inside the board edges.

**Per-key PCB coordinates** (holes NPTH Ø3.0, pads B.Cu 2.55 x 2.50. Every key also has the centre NPTH Ø4.0 at its
centre and peg NPTH Ø1.75 at cx ± 5.08, cy):

| Key | Centre | Hole A | Hole B | Pad A | Pad B |
|---|---|---|---|---|---|
| K1 | (-19.05, -32.075) | (-22.86, -29.535) | (-16.51, -26.995) | (-26.41, -29.535) | (-12.96, -26.995) |
| K2 | (0, -32.075) | (-3.81, -29.535) | (2.54, -26.995) | (-7.36, -29.535) | (6.09, -26.995) |
| K3 | (19.05, -32.075) | (15.24, -29.535) | (21.59, -26.995) | (11.69, -29.535) | (25.14, -26.995) |
| K4 | (-19.05, -13.025) | (-22.86, -10.485) | (-16.51, -7.945) | (-26.41, -10.485) | (-12.96, -7.945) |
| K5 | (0, -13.025) | (-3.81, -10.485) | (2.54, -7.945) | (-7.36, -10.485) | (6.09, -7.945) |
| K6 | (19.05, -13.025) | (15.24, -10.485) | (21.59, -7.945) | (11.69, -10.485) | (25.14, -7.945) |
| K7 | (-19.05, 6.025) | (-22.86, 8.565) | (-16.51, 11.105) | (-26.41, 8.565) | (-12.96, 11.105) |
| K8 | (0, 6.025) | (-3.81, 8.565) | (2.54, 11.105) | (-7.36, 8.565) | (6.09, 11.105) |
| K9 | (19.05, 6.025) | (15.24, 8.565) | (21.59, 11.105) | (11.69, 8.565) | (25.14, 11.105) |

## 4. Raspberry Pi Pico, flat-soldered face up by its castellations (Pico frame)

- **Module:** 51 x 21 x 1.0 mm. On the PCB it covers x -20.5..+30.5, y 16.0..37.0. The micro-USB receptacle (8 wide)
  overhangs the +x end by 1.3 typ, to PCB x ≈ 31.8.
- **Pins:** 2.54 pitch, rows at y = ±8.89 (17.78 apart), first and last pins 1.37 from each end.
  - Pin n = 1..20: (24.13 - 2.54(n-1), +8.89). Pin 1 is at the USB end, pin 20 at the far end.
  - Pin n = 21..40: (-24.13 + 2.54(n-21), -8.89). Pin 21 is at the far end, and the row runs back to pin 40 at the
    USB end.
  - On the PCB: pin 1 is at (29.13, 35.39), pin 20 at (-19.13, 35.39), pin 21 at (-19.13, 17.61), pin 40 at
    (29.13, 17.61).
- **Host pads:** F.Cu + F.Mask SMD pads, 1.6 along the row (x) x 3.2 across (y), centred 0.8 outboard of the pin
  centre, at y = ±9.69. They span |y| 8.09..11.29, reaching 0.79 past the module edge for the iron. On the PCB they
  span y 34.59..37.79 (pins 1-20) and 15.21..18.41 (pins 21-40). Pads 1 and 40 span x 28.33..29.93, 0.57 from the
  board edge.
  - No through-holes are needed. Rounded ends (KiCad uses stadium pads) or square pads both work.
  - For reflow only, the paste aperture is 3.8 x 2.2 at the same centre. Hand-soldered boards skip it.
- **USB shell solder pools** (under the receptacle on the Pico's underside): NPTH Ø1.8 at (24.0, ±2.725) and NPTH
  Ø1.5 at (20.97, ±2.425). On the PCB: (29.0, 29.225), (29.0, 23.775), (25.97, 28.925), (25.97, 24.075). The outer
  holes leave a 0.6 mm web to the board edge. Without them the Pico rocks.
- **Test points on the Pico's underside** (exposed copper, 1.5 x 1.5) and their PCB positions:

  | TP | Function | Pico x, y | PCB x, y |
  |---|---|---|---|
  | TP1 | GND | (21.0, 0) | (26.0, 26.5) |
  | TP2 | USB DM | (24.3, -1.0) | (29.3, 25.5) |
  | TP3 | USB DP | (24.3, +1.0) | (29.3, 27.5) |
  | TP4 | GPIO23 / SMPS PS (do not use) | (17.5, +2.5) | (22.5, 29.0) |
  | TP5 | GPIO25 / LED | (15.0, +2.5) | (20.0, 29.0) |
  | TP6 | BOOTSEL | (12.5, +2.5) | (17.5, 29.0) |

  Raspberry Pi's copper keep-outs: 2 x 2 squares centred on TP4-TP6, and a box over TP1-TP3 and the USB area at
  x 20.2..24.9, |y| ≤ 3.7 (PCB x 25.2..29.9, y 22.8..30.2). The datasheet allows the carrier to void copper under
  unused test points.
- **Debug pads (SWCLK +2.54, GND 0, SWDIO -2.54, at the far end, x ≈ -23.9):** leave them off. The keypad flashes over
  USB. Keep a copper keep-out at x -25.5..-22.6, |y| ≤ 3.5 (PCB x -20.5..-17.6, y 23.0..30.0).
- **Rule for the builder:** put no F.Cu inside the Pico outline except the 40 castellation pads. Route GP2-GP10 on
  B.Cu, and use tented vias placed outside the outline or just outboard of the pads. Also unused: the Pico's
  Ø2.1 mounting holes at (±23.5, ±5.7). BOOTSEL is reached through the lid.
- Clearance to the M3 hole at (27, 43.5): the nearest pad edge (pin 2) is 5.71 away, and the 8.4 mm boss ends 2.3 mm
  above the Pico's edge.

**Pin map** (y = +8.89 for the left half, -8.89 for the right; PCB y = 35.39 / 17.61). The keys use GP2-GP10, which are
pins 4-7, 9-12 and 14, all on the +y row. Their grounds are pins 3, 8, 13 and 18.

| Pin | Name | Pico x | PCB x | | Pin | Name | Pico x | PCB x |
|---|---|---|---|---|---|---|---|---|
| 1 | GP0 | +24.13 | +29.13 | | 40 | VBUS | +24.13 | +29.13 |
| 2 | GP1 | +21.59 | +26.59 | | 39 | VSYS | +21.59 | +26.59 |
| 3 | GND | +19.05 | +24.05 | | 38 | GND | +19.05 | +24.05 |
| 4 | GP2 | +16.51 | +21.51 | | 37 | 3V3_EN | +16.51 | +21.51 |
| 5 | GP3 | +13.97 | +18.97 | | 36 | 3V3(OUT) | +13.97 | +18.97 |
| 6 | GP4 | +11.43 | +16.43 | | 35 | ADC_VREF | +11.43 | +16.43 |
| 7 | GP5 | +8.89 | +13.89 | | 34 | GP28_ADC2 | +8.89 | +13.89 |
| 8 | GND | +6.35 | +11.35 | | 33 | AGND | +6.35 | +11.35 |
| 9 | GP6 | +3.81 | +8.81 | | 32 | GP27_ADC1 | +3.81 | +8.81 |
| 10 | GP7 | +1.27 | +6.27 | | 31 | GP26_ADC0 | +1.27 | +6.27 |
| 11 | GP8 | -1.27 | +3.73 | | 30 | RUN | -1.27 | +3.73 |
| 12 | GP9 | -3.81 | +1.19 | | 29 | GP22 | -3.81 | +1.19 |
| 13 | GND | -6.35 | -1.35 | | 28 | GND | -6.35 | -1.35 |
| 14 | GP10 | -8.89 | -3.89 | | 27 | GP21 | -8.89 | -3.89 |
| 15 | GP11 | -11.43 | -6.43 | | 26 | GP20 | -11.43 | -6.43 |
| 16 | GP12 | -13.97 | -8.97 | | 25 | GP19 | -13.97 | -8.97 |
| 17 | GP13 | -16.51 | -11.51 | | 24 | GP18 | -16.51 | -11.51 |
| 18 | GND | -19.05 | -14.05 | | 23 | GND | -19.05 | -14.05 |
| 19 | GP14 | -21.59 | -16.59 | | 22 | GP17 | -21.59 | -16.59 |
| 20 | GP15 | -24.13 | -19.13 | | 21 | GP16 | -24.13 | -19.13 |

## 5. Where the researchers disagreed, and what I chose

| Item | A (datasheets) | B (libraries) | Chosen | Why |
|---|---|---|---|---|
| Socket pad centres | (-7.36, +2.54), (+6.09, +5.08) | (-7.085, +2.54), (+5.842, +5.08) from ai03/kiswitch; marbastlib/Keebio match A | **(-7.36, +2.54), (+6.09, +5.08)** | I measured the Kailh drawing (KH-PS1607-10 Rev A, p.9) myself: the pads are 3.54/3.55 mm outboard of the holes, with their inner edge at the body end. The ai03 values sit 0.25-0.28 mm further in, under the body. Both cover the terminal tips (about -7.87 / +6.64); the Kailh position leaves 0.77 mm of pad beyond each tip for the iron |
| Socket hole | 3.0 (3.05 ±0.05 in one rev) | 3.0 (ai03) / 3.05 (kiswitch) | **Ø3.0 NPTH** | Kailh Rev B 2016 and the -2/-4 specs of 2021 say ø3.00. 3.05 is inside the 2018 sheet's ±0.05 |
| Peg holes | 1.7, optional | 1.75, drilled in every hot-swap footprint | **Ø1.75 NPTH, drilled** | Cherry's catalogue gives Ø0.067 ±0.002 in (1.65-1.75), so 1.75 is in tolerance and is the hot-swap standard. The Keymodule sheet prints "1,7 - 0,05". The holes let 5-pin switches fit and cost nothing |
| Socket height | 1.80 (body), 1.85 max | 1.85 (STEP) | **1.80 nominal, 1.85 for clearance** | Kailh profile drawing: 1.80 ±0.05; 3.05 ±0.05 with the bosses |
| Socket outline | measured from Kailh drawing, notch at r ≈ 2.75 | kiswitch polygon x -6..4.8, y 0.8..6.8, notch as an R2 arc | **Kailh-based outline (section 3)** | Kailh dimensions 10.90 / 5.89 / 4.00; kiswitch's 6.0 width disagrees with 5.89. My trace of the notch matches A's to 0.05 |
| Pico castellation pad | RPi 3.5 x 1.7 rect at \|y\| 9.79 (0.9 out) | KiCad 3.2 x 1.6 at \|y\| 9.69 (0.8 out) | **1.6 (x) x 3.2 (y) at \|y\| 9.69** | Recovered from the datasheet's own figure text. The Figure 6 stencil numbers "3.80", "2.2" and "15.58" are KiCad's paste exactly: 3.8 x 2.2 apertures centred at ±9.69 have inner edges 15.58 apart. 3.8 x 2.2 is 163% of 3.2 x 1.6, which is the datasheet's paste rule. So Figure 5's copper is 3.2 x 1.6 at 9.69. KiCad's *hand-solder* Pico footprint uses the same pad. The 3.5 x 1.7 pad of Raspberry Pi's 2020 KiCad file also works |
| Debug pads | TH 1.02 at x -23.9, SMD 3.5 at x -24.8 | KiCad 3.2 at x -24.7 | **None; keep-out only** | Both agree they are not needed. If they are ever added, use the datasheet-matching 3.2 (x) x 1.6 (y) at x -24.7 |
| GND pin list | 3, 8, 13, 18, 23, 28, 38 | the same plus 33, debug GND, TP1 | **3, 8, 13, 18, 23, 28, 38; AGND is 33** | Official pinout labels 33 "GND / AGND". The datasheet allows tying AGND to ground when the ADC doesn't matter. The keys use 3, 8 and 13 |
| Pin 36 name | 3V3(OUT) | 3V3 | **3V3(OUT)** | Official pinout; the same pin. Not used |

Points both researchers agreed on, which I also re-checked:
- Pico pin 1 is at the USB end of the +y row, and pins 21-40 run back toward USB. This matches the official pinout and
  Raspberry Pi's KiCad file.
- Debug order is SWCLK at +y, then GND, then SWDIO, from the official pinout.
- The USB-shell NPTH positions and sizes come from Raspberry Pi's KiCad file. KiCad's hand-solder variant opens them to
  2.2 / 1.85. I kept 1.8 / 1.5 for the 0.6 mm edge web.
- Handedness. The Cherry pattern drawn as a top view (pins above the centre, left pin lower) is the pattern KiCad's
  top-view footprint uses. The ai03 and Keebio footprints that use it are proven in many built boards. A mirrored
  pattern cannot be rotated onto it, so it would not take a switch.
  - Kailh's "Top View" is the mirror image. It is the socket side: the side you look at when the board is flipped to
    solder the sockets.
  - The pin-to-pad relationship holds in either case. Only the notch-to-centre-post placement rules out the other
    mirror.

## 6. Project issue found on the way (lid, not PCB)

design.json puts the BOOTSEL lid hole on the wrong side of the Pico. It has `bootselAcrossMm = -5.2` (the pins 21-40
side). The official pinout shows the button on the pin-1 (GP0) side. I measured it on the rendered SVG at 11.4 mm from
the USB-end edge and 3.55 mm toward +y. The Figure 3 copy gives about 11.8 / 3.7.

Suggested values are `bootselFromUsbEndMm ≈ 11.5` and `bootselAcrossMm ≈ +3.6`, which put the lid hole at PCB
(19.0, 30.1). TP6, BOOTSEL's underside pad, is at (12.5, +2.5), on the same side. The LED, measured again on the same
render at a finer scale, sits about 4.4-4.5 mm from the USB end and +5.7 to +5.9 across; design.json now uses
`ledFromUsbEndMm` 4.4 and `ledAcrossMm` +5.9 (it had 5.4 / +6.4). Both holes are still estimates to check on a real board.

## 7. Still uncertain

- **Pico datasheet figures.** I could not view Figures 5-6. The datasheet hosts are blocked for download and WebFetch
  returns text only. The 3.2 x 1.6 / 9.69 pad rests on the figure's text fragments (3.80, 2.2, 15.58), the 163% rule and
  KiCad's copy, not on a picture of Figure 5.
- **Kailh pads.** Pad positions and sizes are not dimensioned: positions are measured, ±0.03. The 2.55 x 2.5 size is
  printed in brackets, as a reference value. I could not get the datasheet for the currently sold CPG151101S11-16
  (LCSC C5156480). I assume it matches the 2016-2021 specs, which are identical.
- **Left peg on 5-pin switches.** The left peg hole (Ø1.75 at -5.08, 0) reaches y = +0.875, and the socket body's edge
  is at about y = +0.81-0.86. A 5-pin switch's left peg can therefore touch the socket corner below the board. Plate
  -mount 3-pin switches avoid it, and so does clipping the peg. Common hot-swap boards accept the same overlap.
- **JLCPCB tolerances.** JLCPCB publishes no NPTH drill tolerance; through-holes are +0.13/-0.08. The socket bosses
  measure about 2.90-2.92 in two STEP models, so a 3.0 hole has about 0.1 mm of room.
- **Pico underside features.** TP1-TP3 positions come only from the KiCad library, but they fall inside Raspberry Pi's
  USB keep-out box. The castellation and USB-shell labels are inferred, and the coordinates are Raspberry Pi's.

## Sources

1. Kailh CPG151101S11 Product Specification. Three revisions:
   - KH-PS1607-10 Rev A, 2018-09-07: p.3 profile, p.9 Recommended PCB Layout, rendered by me at 300 dpi and measured.
     https://github.com/keyboardio/keyswitch_documentation/blob/master/datasheets/Kailh/CPG151101S11.pdf
   - Rev B, 2016: CPG151101S11_MX_Socket.pdf.
   - CPG151101S11-2, 2021-10-13: same layout, ø3.00. CPG151101S11-2.pdf in the same folder.
2. Cherry Keymodule MX catalogue pp.70-71: drilling pattern legend "ø1,7 - 0,05 / ø1,5 ± 0,05 / ø1,0 + 0,1" and centre
   "4 +0,1", read at 600 dpi.
   https://github.com/keyboardio/keyswitch_documentation/blob/master/datasheets/Cherry/Keymodule_MX_EN.pdf
3. Cherry MX Series catalogue p.10-3, Circuit Board Layouts: Ø0.157 ±0.004, Ø0.067 ±0.002 and Ø0.059 ±0.002 in, plate
   0.197 +0.012 in, pins 0.13 in.
   https://github.com/keyboardio/keyswitch_documentation/blob/master/datasheets/Cherry/mx_series.pdf
4. Raspberry Pi Pico datasheet RP-008307-DS, read as text through WebFetch: §2.1-2.2, the TP functions, "4 USB connector
   shell ground pads", "163% larger" paste, and the Figure 6 numbers 3.80, 2.2 and 15.58.
   https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf
5. Official Pico pinout: pin names, pin 1, debug order, BOOTSEL and LED side. Rendered with cairosvg.
   https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/microcontrollers/pico-series/images/pico-pinout.svg
6. Raspberry Pi KiCad footprint RPi_Pico_SMD_TH, from RPi-Pico-R3-PUBLIC-20200119.zip, mirrored unaltered at
   HeadBoffin/RP_Silicon_KiCad @8ab84dd. It gives the pads, the USB NPTH holes and the copper keep-outs.
   https://github.com/HeadBoffin/RP_Silicon_KiCad/blob/main/KiCadLibraries/MCU_RaspberryPi_and_Boards.pretty/RPi_Pico_SMD_TH.kicad_mod
7. Pico datasheet Figure 3, a third-party screenshot: the outline dimensions and BOOTSEL position.
   https://github.com/ncarandini/KiCad-RP-Pico/blob/main/Images/Image04.png
8. KiCad library footprints RaspberryPi_Pico_SMD, RaspberryPi_Pico_SMD_HandSolder and RaspberryPi_Pico_Common_SMD
   (master, fetched 2026-10-14). They give the 3.2 x 1.6 pads, 3.8 x 2.2 paste, TP1-TP6 positions and the hand-solder
   NPTH sizes. This is a cross-check, not a manufacturer source.
   https://gitlab.com/kicad/libraries/kicad-footprints/-/tree/master/Module.pretty
9. Hot-swap libraries, from researcher B, not re-read by me:
   - kiswitch SW_Hotswap_Kailh_MX_1.00u @aefcf650
   - ai03 MXOnly-1U-Hotswap @cdbfc72a
   - marbastlib SW_MX_HS_CPG151101S11_1u @6b0a9a73
   - Keebio Kailh_MX_Socket-compat @1486bef2
   - KiCad SW_Cherry_MX_1.00u_PCB @f8440fa6
10. JLCPCB PCB capabilities: PTH +0.13/-0.08, NPTH to track 0.2, copper to routed edge ≥ 0.2.
    https://jlcpcb.com/capabilities/pcb-capabilities
