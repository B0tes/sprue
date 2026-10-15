// The keypad's firmware, written from the routed board: products/<slug>/firmware/code.py, KMK on CircuitPython for
// the Raspberry Pi Pico, and a README.md that says how to put it on the Pico. Each key is read on the GPIO its
// socket's A pad is wired to on the board as drawn and audited (whatever order the routing gave them), with the
// Pico's internal pull-ups, since each key joins its GPIO to ground and nothing else. Key K<n> types the n-th key
// name of KEYS (KC.N1 to KC.N9 for a 3x3 pad) until the user puts a shortcut there. The file lists the keys in
// reading order, the top row first as the board is seen from the top, so it reads like the keypad.
// `sprue pcb` (../pcb.ts) writes it once the audit passes, and `sprue verify` (fil.ts) boots it.

import { PINNED } from "./cache.ts";
import type { BoardData } from "../pcb/types.ts";

/** KMK's names for what the keys type at first, in key order, and the HID usage code each sends (USB HID usage
 * tables, keyboard page: 1 to 9 are 30 to 38, 0 is 39, A to Z are 4 to 29). */
export const KEYS: { kc: string; code: number }[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ kc: `N${i + 1}`, code: 30 + i })),
  { kc: "N0", code: 39 },
  ...Array.from({ length: 26 }, (_, i) => ({ kc: String.fromCharCode(65 + i), code: 4 + i })),
];

/** A key as the firmware has it: its socket, the GPIO it is wired to, where it is (its row from the top and its
 * column from the left) and what it types. */
export type FirmwareKey = { key: string; gpio: string; row: number; col: number; kc: string; code: number };

const SOCKET = "kailh-mx-hotswap";
const CONTROLLER = "rpi-pico-castellated";
const byRef = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** The keys of a board with sockets and one Pico, from its drawn nets: each socket's A pad, the Pico GPIO on the
 * same net. Undefined for a board without keys; a key wired to no GPIO, or to two, throws (the audit fails such a
 * board first). */
export function firmwareKeys(data: BoardData): FirmwareKey[] | undefined {
  const sockets = data.parts.filter((p) => p.footprint === SOCKET).sort((a, b) => byRef(a.ref, b.ref));
  const ctrl = data.parts.filter((p) => p.footprint === CONTROLLER);
  if (!sockets.length || ctrl.length !== 1) return undefined;
  if (sockets.length > KEYS.length) throw new Error(`the firmware names ${KEYS.length} keys at most, and the board has ${sockets.length}`);
  // Rows: sockets whose centres are within a millimetre of each other in y, from the top down.
  const ys = [...new Set(sockets.map((s) => Math.round(s.y)))].sort((a, b) => b - a);
  const rowOf = (y: number) => ys.findIndex((r) => Math.abs(r - y) <= 1);
  return sockets.map((s) => {
    const a = data.pads.find((p) => p.ref === s.ref && p.num === "A");
    const on = data.pads.filter((p) => p.ref === ctrl[0].ref && p.kind === "gpio" && a?.net && p.net === a.net);
    const gpios = [...new Set(on.map((p) => p.name?.match(/^GP\d+/)?.[0]))];
    if (gpios.length !== 1 || !gpios[0]) throw new Error(`${s.ref} is wired to ${gpios.length ? gpios.join(" and ") : "no GPIO"}, so no firmware can read it`);
    const row = rowOf(s.y);
    const col = sockets.filter((o) => rowOf(o.y) === row && o.x < s.x).length;
    const n = Number(s.ref.match(/\d+$/)?.[0] ?? sockets.indexOf(s) + 1);
    const { kc, code } = KEYS[n - 1] ?? KEYS[sockets.indexOf(s)];
    return { key: s.ref, gpio: gpios[0], row, col, kc, code };
  });
}

/** The keys in reading order: the top row first, each row from the left. */
export const readingOrder = (keys: FirmwareKey[]) => [...keys].sort((a, b) => a.row - b.row || a.col - b.col);
const rows = (keys: FirmwareKey[]) => [...new Set(keys.map((k) => k.row))].sort((a, b) => a - b).map((r) => readingOrder(keys).filter((k) => k.row === r));

/** products/<slug>/firmware/code.py. */
export function codePy(slug: string, keys: FirmwareKey[]): string {
  const grid = rows(keys);
  const w = Math.max(...keys.map((k) => `${k.key} ${k.gpio}`.length));
  const lines = (f: (k: FirmwareKey) => string) => grid.map((r) => `        ${r.map(f).join(" ")}`).join("\n");
  return `# The ${slug}'s firmware: KMK on CircuitPython ${PINNED.circuitpython.version}, for the Raspberry Pi Pico. \`sprue pcb ${slug}\` wrote it from
# the routed board, so each key is read on the GPIO its socket is wired to, and \`sprue verify ${slug}\` boots it in an
# emulated Pico and presses each key, and each pair of keys, on the copper read back from the Gerbers. It is written
# again on every run: change your copy on CIRCUITPY, not this one. README.md, next to it, says how to put it on.
#
# The keys as you look down on the keypad, with the GPIO each is wired to:
${grid.map((r) => `#   ${r.map((k) => `${k.key} ${k.gpio}`.padEnd(w)).join("   ").trimEnd()}`).join("\n")}
# A key joins its GPIO to ground, so the Pico's own pull-ups hold each GPIO high and a pressed key reads low.

import board
from kmk.keys import KC
from kmk.kmk_keyboard import KMKKeyboard
from kmk.scanners.keypad import KeysScanner

keyboard = KMKKeyboard()

# The board's wiring, key by key in the order above. Leave it as it is: it is the copper.
keyboard.matrix = KeysScanner(
    pins=[
${lines((k) => `board.${k.gpio},`)}
    ],
    value_when_pressed=False,
    pull=True,
)

# What each key types, in the same order. Put your shortcuts here (KMK's key names, such as KC.LCTL(KC.C) for Ctrl+C).
keyboard.keymap = [
    [
${lines((k) => `KC.${k.kc},`)}
    ]
]

if __name__ == "__main__":
    keyboard.go()
`;
}

/** products/<slug>/firmware/README.md. */
export function readme(slug: string, keys: FirmwareKey[]): string {
  const cp = PINNED.circuitpython, kmk = PINNED.kmk;
  const zip = `https://github.com/KMKfw/kmk_firmware/archive/${kmk.commit}.zip`;
  const typed = (k: FirmwareKey) => (k.kc.startsWith("N") ? k.kc.slice(1) : k.kc.toLowerCase());
  return `# The ${slug}'s firmware

\`code.py\` is the keypad's firmware: KMK on CircuitPython, for the Raspberry Pi Pico. \`sprue pcb ${slug}\` wrote it
from the routed board, so each key is read on the GPIO its socket is wired to. \`sprue verify ${slug}\` boots it,
with the CircuitPython and the KMK below, on an emulated Pico (rp2040js ${PINNED.rp2040js.version}) and presses each key
and each pair of keys on the copper read back from the Gerbers, and writes its report to
\`products/${slug}/firmware/fil.json\`. Both files are written again on every run, so keep your own copy of anything
you change.

## Put it on the Pico

1. Hold the Pico's BOOTSEL button while you plug it in. A drive called RPI-RP2 appears.
2. Copy ${cp.name} onto it: [${cp.url.split("/").pop()}](${cp.url}).
   The Pico restarts, and a drive called CIRCUITPY appears.
3. Copy KMK's \`kmk\` folder onto CIRCUITPY, from KMK at commit ${kmk.commit.slice(0, 7)}, the one \`sprue verify\`
   tests: [the zip of that commit](${zip}).
4. Copy this \`code.py\` onto CIRCUITPY, over the one there. The keypad restarts as a USB keyboard.

## What the keys type

| Key | GPIO | Types | KMK name |
| --- | --- | --- | --- |
${[...keys].sort((a, b) => byRef(a.key, b.key)).map((k) => `| ${k.key} | ${k.gpio} | ${typed(k)} | \`KC.${k.kc}\` |`).join("\n")}

As you look down on the keypad, the top row first:

${rows(keys).map((r) => `    ${r.map((k) => k.key.padEnd(4)).join("").trimEnd()}`).join("\n")}

To make a key send a shortcut, change its name in \`keyboard.keymap\` in your copy of \`code.py\` on CIRCUITPY, such as
\`KC.LCTL(KC.C)\` for Ctrl+C; KMK's key names are in its docs/en/keycodes.md. Leave the list of pins as it is: it is
the board's wiring.
`;
}
