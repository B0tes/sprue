# Ponder: design

**Request:** a screenless desk tutor for kids 6 to 14. It looks down at the homework, listens, and talks back; a cloud
model does the thinking. 20 units for a school pilot, US, wall power. No budget was given, so none is set.

**What it is:** a document camera crossed with a voice kit. A weighted base (150 x 100 x 40 mm) holds the speaker, a
talk button, a status light bar and the power input. A 15 in lamp gooseneck rises from it and holds a head pod
(116 x 45 x 34 mm) with its lens about 220 mm above the desk and 120 mm in front of the arm root, nose down 15 deg.
The head holds the computer, the camera, two microphones, the amplifier, the mute switch and the two privacy lights.
The whole unit weighs about 1,075 g. Every number lives in `design.json` → `params`; the CAD and the checks read
them from there.

## Reference designs

- **Audio: Google AIY Voice Kit V1 (Voice HAT).** Two I2S MEMS mics (ICS-43432) and a MAX98357A amp on the Pi's I2S
  pins, amp shutdown on GPIO16, button on GPIO23, driven by the stock `googlevoicehat-soundcard` overlay. Ponder
  rebuilds that circuit from breakouts. [Voice Kit docs](https://aiyprojects.readthedocs.io/en/latest/voice.html),
  [schematic](https://github.com/google/aiyprojects-raspbian/blob/aiyprojects/schematics/voice_hat/voice_hat.pdf),
  [pinout](https://pinout.xyz/pinout/voice_hat).
- **Camera and privacy light: Google AIY Vision Kit.** A Pi Zero with a camera on a short flex cable and a privacy
  LED beside the lens. [Vision Kit](https://aiyprojects.withgoogle.com/vision/).
- **Mic and amp wiring:** Adafruit's guides for the
  [SPH0645 mic on a Pi](https://learn.adafruit.com/adafruit-i2s-mems-microphone-breakout/raspberry-pi-wiring-test)
  and the [MAX98357A on a Pi](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-wiring).
- **Status lights:** Adafruit's [NeoPixels on Raspberry Pi](https://learn.adafruit.com/neopixels-on-raspberry-pi/raspberry-pi-wiring)
  (GPIO10, with the 1N4001 trick so 3.3 V data drives 5 V pixels) and the
  [rpi_ws281x README](https://github.com/jgarff/rpi_ws281x) for `core_freq=250` on the Pi 3 family.
- **Arm and base: a USB document camera** such as the [IPEVO V4K](https://us.ipevo.com/pages/v4k-specs), built here
  from standard 1/8 IPS lamp parts (hollow gooseneck, couplings, nipples, nuts) with steel discs on the lamp pipe.
  [Grand Brass goosenecks](https://grandbrass.com/pipe/goose-neck-pipe/).

`reference/reference.json` turns these into the answer key the run is scored against.

## Stack

- Raspberry Pi Zero 2 W with header (SC0721), Raspberry Pi OS Lite 64-bit on a 32 GB Class 10 card.
- Camera Module 3 Wide (SC0874): IMX708, 102 x 67 deg
  ([product brief](https://datasheets.raspberrypi.com/camera/camera-module-3-product-brief.pdf)), on the 38 mm
  Standard-Mini cable from the official Pi Zero case kit (Adafruit 3446).
- 2 x SPH0645 I2S mic breakouts, MAX98357A I2S amp breakout, 40 mm 4 ohm 3 W speaker (PUI AS04004PR-R).
- NeoPixel stick (8 pixels), 16 mm green talk button, a miniature DPDT on-on toggle for mute (Jameco 66-1205),
  green and red 5 mm LEDs.
- Perma-Proto Bonnet Mini on the Pi (all head wiring), a quarter Perma-Proto in the base (power split).
- Raspberry Pi 15 W USB-C supply (5.1 V, 3 A) into a USB-C breakout in the base.
- Six prints: base top, base bottom, head upper, head lower and lens shutter in PA12 (MJF), and a light-bar
  diffuser in natural PETG, all from one print service.

## How the blocks connect

**Why the computer is in the head.** The camera's flat cable can't go through a lamp gooseneck. With the Pi beside
the camera, only round wires go through the arm. The camera cable stays in the head: the path between the two
connectors is about 32 mm, so the 38 mm cable makes one short loop.

**The arm harness** is one 10-wire 28 AWG silicone ribbon, 690 mm: 1-3 5V, 4 GND, 5 SPK+, 6 SPK-, 7 GND, 8 LED
data, 9 GND, 10 BTN. A ground sits between the unfiltered speaker pair and the light-bar data, and another between
the data and the button. The LED data reaches the stick through 440 ohm; the button is debounced in software.

**Inside the head.** The lower shell carries the camera on four pins over the lens window, the lens shutter in a track
under it, and the Pi on four posts with 6 mm deep M2.5 insert holes. The bonnet sits on the Pi, and the amp lies flat
on top of the bonnet. The upper shell carries the mics in pockets behind their ports, the two lights, the mute toggle
in the camera end (with MUTE moulded under it), and the nipple that joins the head to the arm. The toggle body sits
0.8 mm above the camera board, so the camera can't lift off its pins far even if the glue lets go. Four M3 screws
close the head from below.

**Arm and ballast.** At the base the coupling sits in a seat on a 2 mm collar. A 1-3/4 in nipple, screwed 8 mm into
it, goes down through the top shell, a printed column and two 3 in x 1/4 in steel discs (Wagner D143-.44CH, 213 g
each), and a nut under the discs clamps the stack. The pipe's lower end stays 3.9 mm above the harness groove, so the
ten wires can turn out under it. The arm holes are 11 mm for a 10.29 mm pipe. The gooseneck leaves the base pointing
up and turns about 165 deg into the head's top coupling: at a 40 mm bend radius that needs about 335 mm, so the 15 in
(381 mm) gooseneck is used. The 12 in one is too short.

**Power.** USB-C → 120 mm of 22 AWG → base protoboard → 3 x 5 V up the arm to the bonnet's 5 V rail. The check now
models the supply at its -5 % load-regulation limit, the amp's sine-wave peaks, the USB-C contacts and the base feed.
Typical use (amp capped at 2.5 W, light bar at 50 %) gives 4.77 V at the head, just above the 4.75 V USB low limit.
The worst case (supply at 4.84 V, full volume, light bar white) gives 4.31 V, so the check is a flag: measure 5 V at
the bonnet on every unit, and lower the caps if it dips. The Pi figure (635 mA) is a
[measured peak](https://www.cnx-software.com/2021/12/09/raspberry-pi-zero-2-w-power-consumption/); the amp's 85 %
efficiency into 4 ohm is an estimate (the datasheet gives 92 % only for 8 ohm at 1 W); the camera's 250 mA is an
allowance. Adafruit gives no current rating for the USB-C breakout, so the 3 A input figure is flagged too.

**Audio.** I2S on GPIO18-21 with the Pi as master. Both mics share the clocks (through 1 k resistors) and one data
line, left and right picked by SEL. The amp shares the clocks and takes GPIO21. Its SD pin is driven at 3.3 V, which
selects the left channel, so the client plays mono. An ALSA softvol control caps it at 2.5 W, under the speaker's 3 W
rating. The grille is 35.6 mm, the speaker's baffle opening.

**Lights and button.** The light bar is on SPI0 MOSI (GPIO10), which keeps it off the I2S pins. The Zero 2 W has the
Pi 3's SoC, whose SPI clock follows the core clock, so config.txt sets `core_freq=250`. Talk button on GPIO23, mute
sense on GPIO24, camera light on GPIO25 (about 10 mA), amp shutdown on GPIO16.

## Privacy, in plain terms

- **Mic mute is hardware.** Pole 2 of the toggle opens the mics' data wire and ties the Pi's input to ground, so no
  audio can reach the Pi. That cut is what makes the mute real. Pole 1 disconnects the mics' 3.3 V and lights the red
  light, so the light is on exactly when the mics are cut; the mic supply is left floating, and the clocks can part-power
  the mics through their 1 k resistors, which is why the data cut matters. Software can read the switch (GPIO24) but
  can't undo it. It covers the built-in mics only, not a Bluetooth headset's, so the client must not use one.
- **The camera light is software, by choice.** The green light is on GPIO25, and the client turns it on before it
  starts the camera. A hardware light is possible without a custom PCB: the camera connector carries the camera's
  power-enable line (CAM_GPIO0 on the Zero 2 W schematic), which could drive the LED through a transistor breakout.
  That is not in this build. The hardware guarantee is the printed lens shutter: closed means the sensor sees nothing.
- **No local storage is a configured promise.** Stock Raspberry Pi OS writes swap, logs and temp files to the card.
  The golden image turns off swap on the card, keeps the journal in RAM, puts /tmp in RAM and turns on the overlay
  file system, so nothing the client handles survives a reboot. Check it with `swapon --show`, `findmnt /tmp` and
  `raspi-config`'s overlay status.

## Software

The Ponder device client does not exist yet; the B0tes/ponder-tutor repo holds the web app only. The build plan sets
up one golden SD card (OS, config.txt, packages, ALSA config, storage settings) and copies it to all 21 cards. Each
unit then gets its hostname, its backend token in /etc/ponder/device.conf and the overlay file system, and its Wi-Fi
MAC is logged for the school's IT staff. The client still has to be written to this spec: push-to-talk on GPIO23 with
software debounce, mute from GPIO24, the camera light on GPIO25 around every capture, the light bar on SPI at no more
than 50 %, mono playback, a fixed lens position (3.6 dioptres to start), no headset microphone, frames and audio in
RAM only.

The Zero 2 W has 2.4 GHz Wi-Fi only, and many school networks need WPA2-Enterprise logins or MAC registration, so the
plan asks the school's IT staff first.

## Handling and stability

At 1,075 g the unit stands with the head over the page (26 mm inside the front feet). It is easy to tip on purpose:
pressing down on the head tips it at about 3.7 N, and a push at head height at 1.2 to 2.4 N. Bending a gooseneck
takes more force than that, so the base must be held with the other hand while the arm is adjusted. With the arm
pulled straight out the unit falls over. More steel does not fit under the junction board; a wider or deeper base,
or the arm root further back, would fix it in the next version. For the pilot this is accepted and the teachers are
told. The first unit gets a tip test and a drop test before the other units are ordered.

## What changed in review

- **Harness exit at the arm root.** The pipe end used to sit 0.65 to 1.65 mm above the groove floor, which would crush
  the wires. A collar under the coupling, 8 mm disc ribs, a deeper groove and an 8 mm thread engagement now leave
  3.9 mm (the check asks for 3.4).
- **Arm holes 11 mm** (were 10 mm, under the real 10.29 mm pipe OD).
- **15 in gooseneck** instead of 12 in (the 165 deg turn needs about 335 mm). It is also cheaper.
- **38 mm camera cable** instead of 200 mm (there was nowhere to stow 170 mm of spare flat cable).
- **M2.5 holes 2 mm deeper**, with a new check, so the Pi screws can't bottom out.
- **Junction board pins are heat-staked**, the solder side and the disc both get Kapton, the USB-C breakout is glued
  into its cradle, and the light-bar stick is glued into its frame.
- **Mouldings:** MUTE under the toggle, and "use only the supplied 5.1V 3A USB-C adapter" with a unit-number field
  under the base.
- **Order:** spares on the lines that break or get lost, a 22 AWG hook-up wire set for the power runs, pack counts in
  the order list, and a two-phase order (below). The shutter now goes to the same print service as the head lower it
  slides in.

## Cost

As one order, the quote is **$5,371.43 for 20 units, $268.57 each**, spares included. That is about $2,948 of
electronics, $786 of arm, ballast and fasteners, $1,349 of prints and $287 of shipping, 16.1 % above the middle of the
reference band ($4,250 to $5,000). The biggest lines are the cameras ($700), the base-top prints ($546), the Pi kits
($460), the SD cards ($419) and the goosenecks ($383).

The build plan orders in two phases instead: **order A ($822.65)** builds 2 units to measure, and **order B
($4,699.52)** buys the rest and the spares once they pass. Together that is $5,522.17, $150.74 more than one order,
mostly a second round of shipping. Order A buys all 20 speakers, because Master Electronics sells them in twenties.

Not in either total:

- **Import duty on the Pi kits.** The only Zero 2 W with header in stock is Seeed's Basic Kit, shipped from China
  under DAP terms. Seeed's customs page cites a 45 % base tariff on dev boards: about $207 if it applies.
- **Mouser tariffs and insurance.** A reviewer read an 8 % tariff note on the camera's Mouser page (about $56); the
  Mouser pages would not load here to confirm it. Insurance adds about $7.
- **The print rate is unverified.** Craftcloud's $0.30/cm3 with a $6 minimum a part is not on its site; upload the
  STLs for a real quote. The diffuser and shutter cost $132 each only because of that minimum.
- Consumables, tools, sales tax, and DHL transit and customs time for the Seeed order.

Shipping is an estimate for most shops (see `catalog.json` → `_shippingBasis`).

## Check on the first unit

Assembly step 1 lists every item with its pass rule; order B waits until they all pass. The main unknowns are the
gooseneck (hollow, thread gender, bore, mass, bend radius and rigid end lengths are not published), the Camera
Module 3 hole positions (read from an unlabelled drawing), the toggle size and contact material, the junction board
holes, the USB-C socket height, the mic ports, the M3 insert hole, the bonnet header's gender and the Seeed kit's
contents, the voltage at the head under load, the Wi-Fi signal inside the head next to the steel nut, and the drop
and tip tests.

## Still to decide

Whether the pilot units need the CPSIA Children's Product Certificate and FCC Part 15B steps before they go to a
school. A printed tracking label with the module's FCC ID is still to be designed. The rubber feet can be peeled off
and are small enough to swallow; that matters only for younger siblings, but a moulded foot would remove it.
