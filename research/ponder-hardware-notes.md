# Ponder desk device: hardware notes for Anatomy 2.0

Written 2026-10-13 when Ponder (AI tutor desk device) was paused. Use it as the reference product for the Anatomy 2.0 sourcing/quoting pipeline. Repo: B0tes/ponder-tutor. Prices below are rough, from memory, not checked against suppliers.

## What the device is
A screenless desk unit for kids aged 6 to 14. It sees the homework through a downward camera, hears through a mic array, and talks through a speaker. All intelligence runs in the cloud model; the hardware is "dumb on purpose".

## Form factor (from the landing-page drawing)
- **Base:** weighted puck, about 150 x 100 x 40 mm. Holds the board, speaker, battery or USB-C power, and wake-light strip on top.
- **Neck:** arched arm, about 250 mm rise, putting the head about 220 mm above the desk and about 120 mm forward of the base.
- **Head:** about 100 x 45 mm pod, tilted down about 15 deg. Holds the camera and 2 to 3 mic holes.
- **Field of view:** must cover an A4 / US Letter sheet in front of the base, so roughly 70 deg+ diagonal at about 25 cm height, plus autofocus or a fixed focus at about 25 cm.

## Functional parts (one candidate set per block)
| Block | Prototype option | Notes |
| --- | --- | --- |
| Compute | Raspberry Pi Zero 2 W (about $15) or Pi 5 for a dev rig | ESP32-S3 is a cheaper option if it only streams audio and JPEG to the cloud |
| Camera | Pi Camera Module 3 Wide (about $35) | Autofocus, 120 deg; needs to read pencil handwriting at 25 cm |
| Mics | 2-mic I2S array (ReSpeaker-style HAT, about $10–15) | Far-field across a desk, kid voices |
| Speaker | I2S class-D amp (MAX98357A, about $6) + 3 W 40 mm speaker | |
| Wake light | Short addressable LED strip or a single ring | Should be wired so it is physically on whenever the camera is powered (privacy promise) |
| Bluetooth | On-board on Pi Zero 2 W / ESP32-S3 | Headphones and optional keyboard |
| Power | USB-C 5 V 2–3 A; optional 1S Li-ion pack | |
| Input | One physical button (wake or mute) | Mute should cut mic power, not just software |

## Custom parts (what Anatomy 2.0 should quote)
- **Enclosure base** (plastic, likely SLA/MJF for prototypes, injection moulding later), plus a steel or zinc **ballast plate** so it can't tip.
- **Neck**: bent aluminium tube or CNC part with an internal cable channel.
- **Head shell**: two-part plastic with camera window and mic ports.
- **PCB**: carrier/adapter board for the mics, amp, LED and button if not using off-the-shelf HATs.

## Constraints that matter for sourcing
- Children's product: in the US, CPSIA (lead/phthalates, tracking labels) and possibly ASTM F963 depending on whether it counts as a toy. In the EU, CE (RED for the radio, EMC, LVD) plus toy-safety rules if it is classed as a toy. FCC Part 15 for the radio (certified modules help a lot).
- Privacy: hardware camera-on indicator and hardware mic mute; no local storage of video.
- No small detachable parts; rounded edges; durable to drops from desk height.
- Pilot scale is 10–20 units per school, so the first quote run is quantity 20–50.

## Open questions
- Battery or wall-powered only (battery adds certification weight).
- Phone-on-a-stand prototype first (cheapest) vs going straight to the Pi build.
