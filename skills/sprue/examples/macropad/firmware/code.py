# The macropad's firmware: KMK on CircuitPython 10.3.1, for the Raspberry Pi Pico. `sprue pcb macropad` wrote it from
# the routed board, so each key is read on the GPIO its socket is wired to, and `sprue verify macropad` boots it in an
# emulated Pico and presses each key, and each pair of keys, on the copper read back from the Gerbers. It is written
# again on every run: change your copy on CIRCUITPY, not this one. README.md, next to it, says how to put it on.
#
# The keys as you look down on the keypad, with the GPIO each is wired to:
#   K7 GP8    K8 GP5    K9 GP2
#   K4 GP9    K5 GP6    K6 GP3
#   K1 GP10   K2 GP7    K3 GP4
# A key joins its GPIO to ground, so the Pico's own pull-ups hold each GPIO high and a pressed key reads low.

import board
from kmk.keys import KC
from kmk.kmk_keyboard import KMKKeyboard
from kmk.scanners.keypad import KeysScanner

keyboard = KMKKeyboard()

# The board's wiring, key by key in the order above. Leave it as it is: it is the copper.
keyboard.matrix = KeysScanner(
    pins=[
        board.GP8, board.GP5, board.GP2,
        board.GP9, board.GP6, board.GP3,
        board.GP10, board.GP7, board.GP4,
    ],
    value_when_pressed=False,
    pull=True,
)

# What each key types, in the same order. Put your shortcuts here (KMK's key names, such as KC.LCTL(KC.C) for Ctrl+C).
keyboard.keymap = [
    [
        KC.N7, KC.N8, KC.N9,
        KC.N4, KC.N5, KC.N6,
        KC.N1, KC.N2, KC.N3,
    ]
]

if __name__ == "__main__":
    keyboard.go()
