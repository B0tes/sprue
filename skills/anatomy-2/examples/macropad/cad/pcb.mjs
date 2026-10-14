// The 3x3 macro keypad's circuit board, as code. `anatomy pcb macropad` (and `anatomy cad macropad`) runs this
// through the PCB kit (skills/anatomy-2/pipeline/pcb/), audits the result and writes the Gerbers and drill files to
// pcb/, the previews to previews/pcb-top.svg and pcb-bottom.svg. The case parts (cad/*.py, build123d) are built by
// the same `anatomy cad`, which runs this file after them.
//
// The board: 61 x 94 mm, 2 layers, 1.6 mm. Nine Kailh hot-swap sockets on the back, one under each key; a
// Raspberry Pi Pico face up on the front, soldered flat by its castellated edge, USB end flush with the right edge.
// Each key joins one GPIO to ground (internal pull-ups, no diodes): the socket's A pad goes to the GPIO along the
// back, its B pad to ground through a via to the pour on the front. All numbers are design.json params, the
// footprint library's (pipeline/pcb/footprints.ts, whose own estimates design.json lists) or the PCB rules
// (pcb.rules). Frame: origin at the PCB centre, x to the right (the USB end), y up (the Pico end), seen from the
// top, as cad/_params.py.

export default function board({ pcb, params: p, design }) {
  const rules = pcb.rules;
  const W = p.pcbWidthMm, H = p.pcbHeightMm, pitch = p.keyPitchMm, rows = p.keyRows, cols = p.keyCols;
  pcb.outline(W, H, p.pcbCornerMm);

  // Four M3 clearance holes. A printed insert boss presses on the board around each, so copper keeps its radius out.
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      pcb.hole(sx * (W / 2 - p.holeInsetMm), sy * (H / 2 - p.holeInsetMm), p.screwClearanceMm, { keepout: p.bossOuterMm / 2, ref: "M3" });

  // Key K1 is bottom left, K3 bottom right, K7 top left (a numeric keypad); the first row is pcbEdgeToKeyMm + half a pitch from the bottom edge.
  const keys = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      keys.push({ n: r * cols + c + 1, col: c, row: r, x: (c - (cols - 1) / 2) * pitch, y: -H / 2 + p.pcbEdgeToKeyMm + pitch / 2 + r * pitch });

  // One GPIO per key, in a row from keyFirstGpio (GP2 to GP10).
  const gpios = Array.from({ length: keys.length }, (_, i) => `GP${p.keyFirstGpio + i}`);

  // The Pico. Its ground pins are the pour's; the key GPIOs are nets of their own; nothing else is connected.
  pcb.place("rpi-pico-castellated", {
    ref: "U1", x: p.controllerCenterXMm, y: p.controllerCenterYMm, side: "top",
    nets: { GND: "GND", AGND: "GND", ...Object.fromEntries(gpios.map((g) => [g, g])) },
  });

  // One GPIO to each key. The tracks on the back cannot cross, so the pads along the Pico, left to right, serve the
  // keys column by column from the left, and bottom to top within a column: the leftmost pad serves the lowest key.
  const byPad = [...gpios].sort((a, b) => pcb.pad(`U1.${a}`).x - pcb.pad(`U1.${b}`).x);
  const gpioOf = new Map();
  for (let c = 0; c < cols; c++)
    for (let i = 0; i < rows; i++) gpioOf.set(keys.find((k) => k.col === c && k.row === i).n, byPad[c * rows + i]);

  // The ground pour comes before the routes, so the router keeps clear of the thermal spokes on the Pico's ground pads.
  pcb.pour("GND", "F.Cu");

  // The sockets, on the back, under the keys: A to the key's GPIO, B to ground.
  for (const k of keys)
    pcb.place("kailh-mx-hotswap", { ref: `K${k.n}`, x: k.x, y: k.y, side: "bottom", nets: { A: gpioOf.get(k.n), B: "GND" }, switchMm: p.plateCutoutMm });

  // Ground: from each socket's B pad a short track on the back to a via above it (tented, clear of the pad's mask
  // opening), which meets the pour on the front.
  const ring = rules.viaPadMm / 2;
  for (const k of keys) {
    const b = pcb.pad(`K${k.n}.B`);
    const y = b.y + b.h / 2 + rules.maskExpandMm + rules.viaTentGapMm + ring;
    pcb.track("GND", "B.Cu", [[b.x, b.y], [b.x, y]]);
    pcb.via("GND", b.x, y);
  }

  // The GPIOs: each from its Pico pad on the front, through a via just outside the Pico's outline, along the back to
  // the key's A pad.
  const order = [...keys].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const k of order) pcb.route(gpioOf.get(k.n), `U1.${gpioOf.get(k.n)}`, `K${k.n}.A`, { via: true });

  // Silkscreen: the board's name, each key's number and GPIO under its switch, and the USB end (written on the board, between the Pico's pad rows, pointing at the edge).
  pcb.text("F.Silk", 0, H / 2 - p.holeInsetMm, `${design.slug} 3x3`, 3);
  for (const k of keys) pcb.text("F.Silk", k.x, k.y - (p.plateCutoutMm / 2 + (pitch - p.plateCutoutMm) / 4), `K${k.n} ${gpioOf.get(k.n)}`, 1.5);
  pcb.text("F.Silk", p.controllerCenterXMm + p.controllerLengthMm / 2 - p.usbLabelInsetMm, p.controllerCenterYMm, "USB >", 1.5, { align: "right" });

  // Once the switches and the top are on, the labels are hidden: the firmware notes in design.json carry the map.
  const keyMap = keys.map((k) => `K${k.n} ${gpioOf.get(k.n)}`).join(", ");
  if (!design.assembly.join(" ").includes(keyMap)) pcb.warn(`design.json's assembly should give the key to GPIO map the board wires: ${keyMap}`);

  return {
    title: `${design.slug} PCB`,
    pinMap: Object.fromEntries(gpios.map((g) => [g, `K${[...gpioOf].find(([, v]) => v === g)[0]}`])),
  };
}
