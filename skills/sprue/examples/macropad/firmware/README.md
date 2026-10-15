# The macropad's firmware

`code.py` is the keypad's firmware: KMK on CircuitPython, for the Raspberry Pi Pico. `sprue pcb macropad` wrote it
from the routed board, so each key is read on the GPIO its socket is wired to. `sprue verify macropad` boots it,
with the CircuitPython and the KMK below, on an emulated Pico (rp2040js 1.4.0) and presses each key
and each pair of keys on the copper read back from the Gerbers, and writes its report to
`products/macropad/firmware/fil.json`. Both files are written again on every run, so keep your own copy of anything
you change.

## Put it on the Pico

1. Hold the Pico's BOOTSEL button while you plug it in. A drive called RPI-RP2 appears.
2. Copy CircuitPython 10.3.1 for the Raspberry Pi Pico onto it: [adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.1.uf2](https://adafruit-circuit-python.s3.amazonaws.com/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.1.uf2).
   The Pico restarts, and a drive called CIRCUITPY appears.
3. Copy KMK's `kmk` folder onto CIRCUITPY, from KMK at commit 8afe569, the one `sprue verify`
   tests: [the zip of that commit](https://github.com/KMKfw/kmk_firmware/archive/8afe56905af4df3b9e4dcb0a21b670a1bd3aab18.zip).
4. Copy this `code.py` onto CIRCUITPY, over the one there. The keypad restarts as a USB keyboard.

## What the keys type

| Key | GPIO | Types | KMK name |
| --- | --- | --- | --- |
| K1 | GP10 | 1 | `KC.N1` |
| K2 | GP7 | 2 | `KC.N2` |
| K3 | GP4 | 3 | `KC.N3` |
| K4 | GP9 | 4 | `KC.N4` |
| K5 | GP6 | 5 | `KC.N5` |
| K6 | GP3 | 6 | `KC.N6` |
| K7 | GP8 | 7 | `KC.N7` |
| K8 | GP5 | 8 | `KC.N8` |
| K9 | GP2 | 9 | `KC.N9` |

As you look down on the keypad, the top row first:

    K7  K8  K9
    K4  K5  K6
    K1  K2  K3

To make a key send a shortcut, change its name in `keyboard.keymap` in your copy of `code.py` on CIRCUITPY, such as
`KC.LCTL(KC.C)` for Ctrl+C; KMK's key names are in its docs/en/keycodes.md. Leave the list of pins as it is: it is
the board's wiring.
