// The intent check. The board code (cad/pcb.mjs) says which pad is on which net, and the audit (drc.ts) proves the
// copper joins exactly those nets. This says whether they are the circuit meant, from sources other than the board
// code:
//  (a) footprints: every placed part that has a reference (refs.ts) is on the side the reference is drawn for, with
//      its pads on that side's copper, and has its pads and holes where the reference has them, so a mirrored, moved
//      or flipped footprint fails; and each pad does what the reference's pin at its spot does;
//  (b) pin functions: a pad that must connect (a socket's A and B) is on a net; a key's A pad reaches exactly one GPIO
//      of the controller and no other pin of it; no GPIO serves two keys; a key's B pad reaches a GND pin and no
//      supply or control pin; and on a board with no keys, no supply or control pin of the controller is on its
//      ground, and a net with VBUS or VSYS on it holds no other of its pins but 3V3_EN (no GPIO, RUN, ADC_VREF or
//      3V3(OUT): 5 V there would damage the Pico);
//  (c) the intended netlist, from design.json alone (the keys from params keyRows x keyCols, the GPIO of each from
//      keyMap), against the nets drawn: each key's A pad with its GPIO, its B pad on ground, and no other pad of the
//      controller or the sockets joined to anything; and any key-to-GPIO map design.json's assembly steps give the
//      user ("K1 GP10, ...") is that one.
// Its errors go into drc.json with the audit's (pcb.ts), so a board that fails it gets no zip.

import { picoKind } from "./footprints.ts";
import { rotate } from "./geometry.ts";
import { drift, refAt, REFS } from "./refs.ts";
import type { BoardData, Pad, PadKind } from "./types.ts";

export type DesignIntent = { params?: Record<string, number | string>; keyMap?: Record<string, string>; assembly?: string[] };
/** The circuit design.json means, as drc.json records it: each key's GPIO and the controller pin it is (by the
 * reference's numbering), and the pads that go to ground with the controller's ground pins, any of which will do. */
export type Intent = {
  controller: string;
  keys: Record<string, { gpio: string; pin: string }>;
  ground: { pads: string[]; pins: string[] };
};

const SOCKET = "kailh-mx-hotswap";
const CONTROLLER = "rpi-pico-castellated";
/** The RP2040 GPIOs the Pico uses on its own board, so none of them is on its edge (Pico datasheet, section 2.1). */
const ON_BOARD: Record<string, string> = { GP23: "the regulator's power-save pin", GP24: "VBUS sense", GP25: "the LED", GP29: "VSYS sense" };

/** What a pad is, by the reference's pin at its spot: its number there and its name. */
type Fn = { num?: string; name?: string };

const byRef = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** The GPIO a pin name is: "GP26_ADC0" and "GP26" are both GP26. */
const gpioOf = (name?: string) => name?.match(/^GP\d+/)?.[0];

/** (a): each placed part held to its reference, and each pad's function from the reference. One error per footprint
 * and difference, naming every part that has it. */
function functions(data: BoardData, errors: string[]): Map<Pad, Fn> {
  const fn = new Map<Pad, Fn>();
  const found = new Map<string, { footprint: string; refs: string[]; diffs: string[] }>();
  for (const part of data.parts) {
    const own = data.pads.filter((p) => p.ref === part.ref);
    const ref = REFS[part.footprint];
    if (!ref) {
      for (const p of own) fn.set(p, { num: p.num, name: p.name });
      continue;
    }
    // Back into the footprint frame: a part on the bottom is not mirrored (board.ts), so only the rotation is undone.
    const local = (x: number, y: number) => rotate([x - part.x, y - part.y], -part.rotDeg);
    const quarter = part.rotDeg % 180 !== 0;
    const pads = own.map((p) => {
      const [x, y] = local(p.x, p.y);
      return { num: p.num, name: p.name, x, y, w: quarter ? p.h : p.w, h: quarter ? p.w : p.h, plated: !!p.drill && p.layers.length === 2 };
    });
    const holes = data.holes.filter((h) => h.ref === part.ref).map((h) => {
      const [x, y] = local(h.x, h.y);
      return { x, y, drill: h.drill };
    });
    own.forEach((p, i) => {
      const r = refAt(ref, pads[i].x, pads[i].y, pads[i].plated);
      fn.set(p, { num: r?.num, name: r?.name });
    });
    // The reference holds on the side it is drawn for, with each SMD pad on that side's copper: on the other side,
    // unmirrored, the pads are the mirror image of the real part's.
    const copper = ref.side === "top" ? "F.Cu" : "B.Cu";
    const offSide = own.filter((p, i) => !pads[i].plated && (p.layers.length !== 1 || p.layers[0] !== copper));
    const diffs = [
      ...(part.side !== ref.side ? [`it is on the ${part.side}, and the reference is drawn for the ${ref.side}, so there its pads are the mirror image of the real part's`] : []),
      ...(offSide.length ? [`pad${offSide.length > 1 ? "s" : ""} ${list(offSide.map((p) => p.num))} ${offSide.length > 1 ? "are" : "is"} on ${list([...new Set(offSide.flatMap((p) => p.layers))])}, not ${copper}, the ${ref.side}'s copper`] : []),
      ...drift(ref, pads, holes),
    ];
    if (!diffs.length) continue;
    const key = `${part.footprint}|${diffs.join("|")}`;
    const f = found.get(key) ?? { footprint: part.footprint, refs: [], diffs };
    f.refs.push(part.ref);
    found.set(key, f);
  }
  for (const f of found.values()) {
    const refs = f.refs.sort(byRef);
    const who = refs.length > 4 ? `${refs.slice(0, 3).join(", ")} and ${refs.length - 3} more` : list(refs);
    const more = f.diffs.length > 3 ? `; and ${f.diffs.length - 3} more` : "";
    const their = refs.length > 1 ? "do not match their" : "does not match its";
    errors.push(`footprint: ${who} (${f.footprint}) ${their} reference, ${REFS[f.footprint].title} (fixtures/footprint-refs.json): ${f.diffs.slice(0, 3).join("; ")}${more}`);
  }
  return fn;
}

/** The intent check of a drawn board against design.json. */
export function checkIntent(data: BoardData, design: DesignIntent): { errors: string[]; intent?: Intent } {
  const errors: string[] = [];
  const fn = functions(data, errors);
  const name = (p: Pad) => fn.get(p)?.name;
  const kind = (p: Pad): PadKind | undefined => (name(p) ? picoKind(name(p)!) : undefined);
  const num = (p: Pad) => fn.get(p)?.num ?? `${p.num}, which is not where any pin of the reference is`;
  const pin = (p: Pad) => `${p.ref} pin ${num(p)}${name(p) ? ` (${name(p)})` : ""}`;
  /** Controller pins in a sentence, those of one name together: "U1 pins 3, 8 and 13 (GND)". */
  const pins = (pads: Pad[]) => {
    const byName = new Map<string, Pad[]>();
    for (const p of pads) byName.set(name(p) ?? "", [...(byName.get(name(p) ?? "") ?? []), p]);
    return list([...byName].map(([n, ps]) => {
      const nums = [...new Set(ps.map(num))].sort(byRef);
      return nums.length === 1 ? pin(ps[0]) : `${ps[0].ref} pins ${list(nums)}${n ? ` (${n})` : ""}`;
    }));
  };

  // A pad that must connect has a net.
  for (const p of data.pads)
    if (p.mustConnect && !p.net)
      errors.push(`${p.ref}.${p.num} has no net: ${p.kind === "switch" ? `a socket's two pads must both connect, or ${p.ref} is a dead key` : "this pad must connect"}`);

  const sockets = data.parts.filter((p) => p.footprint === SOCKET).map((p) => p.ref).sort(byRef);
  const controllers = data.parts.filter((p) => p.footprint === CONTROLLER).map((p) => p.ref);
  if (!sockets.length && !design.keyMap) {
    // No keys, so no circuit from design.json to hold the nets to; the controller's pins still do what they do. (For
    // a keypad, (c) below leaves every pin but the keys' GPIOs and grounds joined to nothing.)
    for (const U of controllers) {
      const byNet = new Map<string, Pad[]>();
      for (const p of data.pads) if (p.ref === U && p.net) byNet.set(p.net, [...(byNet.get(p.net) ?? []), p]);
      for (const [net, pads] of [...byNet].sort(([x], [y]) => byRef(x, y))) {
        const ground = pads.some((p) => kind(p) === "gnd");
        const supplies = pads.filter((p) => kind(p) === "power"), controls = pads.filter((p) => kind(p) === "control");
        if (ground && supplies.length) errors.push(`net ${net} joins ${pins(supplies)} to ${U}'s ground: a short across the supply`);
        if (ground && controls.length) errors.push(`net ${net} pulls ${pins(controls)} to ground, which holds the Pico in reset or switches it off`);
        // A 5 V net may hold VBUS, VSYS and 3V3_EN (which the Pico pulls up to VSYS itself), and no other pin: the
        // RP2040's GPIOs, RUN and ADC_VREF take 3.3 V at most.
        const out = pads.filter((p) => name(p) === "3V3(OUT)"), five = pads.filter((p) => name(p) === "VBUS" || name(p) === "VSYS");
        const low = five.length ? pads.filter((p) => kind(p) !== "gnd" && !["VBUS", "VSYS", "3V3_EN", "3V3(OUT)"].includes(name(p) ?? "")) : [];
        if (!ground && out.length && five.length) errors.push(`net ${net} joins ${pins([...out, ...five])}: the 5 V supply would drive the 3.3 V regulator's output`);
        if (!ground && low.length) errors.push(`net ${net} puts the 5 V of ${pins(five)} on ${pins(low)}, which ${low.length > 1 ? "take" : "takes"} 3.3 V at most: it would damage the Pico`);
      }
    }
    return { errors };
  }
  if (controllers.length !== 1) {
    errors.push(`the keys need one controller (${CONTROLLER}) to wire to, and the board places ${controllers.length}`);
    return { errors };
  }
  const U = controllers[0];
  const nets = new Map<string, Pad[]>();
  for (const p of data.pads) if (p.net) nets.set(p.net, [...(nets.get(p.net) ?? []), p]);
  const padOf = (ref: string, num: string) => data.pads.find((p) => p.ref === ref && p.num === num);
  const ctrlOn = (net: string) => nets.get(net)!.filter((p) => p.ref === U);

  // ---- (b) pin functions, on the drawn nets ----
  const bad = new Set<string>(); // keys whose wiring is already reported
  const told = new Set<Pad>(); // controller pads an error has named
  const tell = (pads: Pad[]) => pads.forEach((p) => told.add(p));
  const twice = new Set<string>();
  const groundSeen = new Set<string>();
  for (const k of sockets) {
    const a = padOf(k, "A"), b = padOf(k, "B");
    if (a?.net) {
      const ctrl = ctrlOn(a.net);
      const gpios = ctrl.filter((p) => kind(p) === "gpio"), other = ctrl.filter((p) => kind(p) !== "gpio");
      if (other.length) errors.push(`${k}'s net ${a.net} reaches ${pins(other)}: a key may only pull a GPIO to ground`);
      else if (!gpios.length) errors.push(`${k}'s net ${a.net} reaches no GPIO of ${U}, so the key is read by nothing`);
      else if (new Set(gpios.map((p) => gpioOf(name(p)))).size > 1) errors.push(`${k}'s net ${a.net} joins ${pins(gpios)}: each key needs one GPIO`);
      if (other.length || new Set(gpios.map((p) => gpioOf(name(p)))).size !== 1) bad.add(k);
      tell(other);
      const keys = nets.get(a.net)!.filter((p) => p.num === "A" && sockets.includes(p.ref)).map((p) => p.ref).sort(byRef);
      if (keys.length > 1 && !twice.has(a.net)) {
        twice.add(a.net);
        const g = [...new Set(gpios.map((p) => gpioOf(name(p))))];
        errors.push(`${g.length === 1 ? `${g[0]} (net ${a.net})` : `net ${a.net}`} serves ${keys.length} keys, ${list(keys)}: each key needs a GPIO of its own`);
        keys.forEach((x) => bad.add(x));
      }
    }
    if (b?.net) {
      const ctrl = ctrlOn(b.net);
      if (!ctrl.some((p) => name(p) === "GND")) {
        errors.push(`${k}.B is on net ${b.net}, which reaches no GND pin of ${U}: the key could never pull its GPIO low`);
        bad.add(k);
      }
      const other = ctrl.filter((p) => kind(p) !== "gnd");
      if (other.length && !groundSeen.has(b.net)) {
        groundSeen.add(b.net);
        errors.push(`the keys' ground, net ${b.net}, reaches ${pins(other)}, which ${other.length > 1 ? "are not grounds" : "is not a ground"}`);
        tell(other);
      }
    }
  }

  // ---- (c) the intended netlist, from design.json ----
  const keyMap = design.keyMap;
  if (!keyMap) {
    errors.push(`design.json has no keyMap: give the GPIO each key's socket is wired to ({ "K1": "GP2", ... }) so the audit can check the board against it`);
    return { errors };
  }
  const rows = Number(design.params?.keyRows), cols = Number(design.params?.keyCols);
  const keys = rows > 0 && cols > 0 ? Array.from({ length: rows * cols }, (_, i) => `K${i + 1}`) : Object.keys(keyMap).sort(byRef);
  const span = `K1 to K${keys.length}${rows > 0 && cols > 0 ? ", from keyRows x keyCols" : ""}`;
  const mapErrors: string[] = [];
  const refPads = REFS[CONTROLLER].pads.filter((p) => !p.plated);
  const pinNum = (gpio: string) => refPads.find((p) => gpioOf(p.name) === gpio)?.num;
  for (const k of keys) if (!(k in keyMap)) mapErrors.push(`design.json keyMap gives no GPIO for ${k} (the keys are ${span})`);
  const byGpio = new Map<string, string[]>();
  for (const [k, g] of Object.entries(keyMap)) {
    if (!keys.includes(k)) mapErrors.push(`design.json keyMap names ${k}, which is not one of the keys (${span})`);
    const gpio = gpioOf(String(g)) ?? String(g);
    if (ON_BOARD[gpio]) mapErrors.push(`design.json keyMap puts ${k} on ${g}, which is not on the Pico's edge: the Pico uses it for ${ON_BOARD[gpio]}`);
    else if (!pinNum(gpio)) mapErrors.push(`design.json keyMap puts ${k} on ${g}, which is not a GPIO on the Pico's edge (GP0 to GP22, GP26 to GP28)`);
    byGpio.set(gpio, [...(byGpio.get(gpio) ?? []), k]);
  }
  for (const [g, ks] of byGpio) if (ks.length > 1) mapErrors.push(`design.json keyMap puts ${list(ks.sort(byRef))} on ${g}: each key needs a GPIO of its own`);
  for (const k of keys) if (!sockets.includes(k)) mapErrors.push(`design.json has key ${k}, but the board places no socket ${k}`);
  for (const s of sockets) if (!keys.includes(s)) mapErrors.push(`the board places socket ${s}, which is not one of design.json's keys (${span})`);
  // The map the assembly steps give the user ("K1 GP10, K2 GP7, ..."), once the labels under the keys are hidden, is
  // the one the board is held to.
  const wrongly = new Set<string>();
  for (const [, k, g] of (design.assembly ?? []).flatMap((line) => [...String(line).matchAll(/\b(K\d+) (GP\d+)\b/g)]))
    if (k in keyMap && gpioOf(String(keyMap[k])) !== g && !wrongly.has(k)) {
      wrongly.add(k);
      errors.push(`design.json's assembly tells the user ${k} is on ${g}, and keyMap, which the board is held to, puts it on ${keyMap[k]}`);
    }
  errors.push(...mapErrors);
  if (mapErrors.length) return { errors };

  const intent: Intent = {
    controller: U,
    keys: Object.fromEntries(keys.map((k) => {
      const gpio = gpioOf(keyMap[k])!;
      return [k, { gpio, pin: `${U}.${pinNum(gpio)}` }];
    })),
    ground: { pads: keys.map((k) => `${k}.B`), pins: refPads.filter((p) => p.name && picoKind(p.name) === "gnd").map((p) => `${U}.${p.num}`) },
  };

  // Each key's A pad on its own GPIO, compared by the controller pin the pad really is (its reference spot).
  const phys = (p: Pad) => (p.ref === U ? `${U}.${fn.get(p)?.num ?? `?${p.num}`}` : `${p.ref}.${p.num}`);
  for (const k of keys) {
    const a = padOf(k, "A");
    if (bad.has(k) || !a?.net) continue;
    const want = intent.keys[k];
    const got = ctrlOn(a.net).find((p) => kind(p) === "gpio");
    if (got && phys(got) !== want.pin) errors.push(`${k} is wired to ${gpioOf(name(got))} (${U} pin ${num(got)}), but design.json's keyMap says ${want.gpio} (${U} pin ${want.pin.slice(U.length + 1)})`);
  }
  // No other pad joined to anything: a drawn net of two or more pads holds only what the intent puts on it.
  const meant = new Set<string>([...Object.entries(intent.keys).flatMap(([k, v]) => [`${k}.A`, v.pin]), ...intent.ground.pads, ...intent.ground.pins]);
  for (const [net, pads] of [...nets].sort(([x], [y]) => byRef(x, y))) {
    if (pads.length < 2) continue;
    const stray = pads.filter((p) => (p.ref === U || sockets.includes(p.ref)) && !meant.has(phys(p)) && !told.has(p));
    const ctrl = stray.filter((p) => p.ref === U), keyPads = [...new Set(stray.filter((p) => p.ref !== U).map((p) => `${p.ref}.${p.num}`))];
    const labels = [...(ctrl.length ? [pins(ctrl)] : []), ...keyPads];
    if (labels.length) errors.push(`net ${net} joins ${list(labels)}, which design.json's intent leaves unconnected`);
  }
  return { errors, intent };
}

/** The intended netlist, as the read-back of the written files (board.json) takes it: each key's A pad with its GPIO
 * pin, named after the GPIO, and the ground: every key's B pad, joined to at least one of the controller's ground pins
 * (`anyOf`; the others may join it too). Any pad of the controller or a socket not listed is meant to be joined to
 * nothing. */
export type IntendedNet = { net: string; pads: string[]; anyOf?: string[] };

export const intendedNets = (intent: Intent): IntendedNet[] => [
  ...Object.entries(intent.keys).map(([k, v]) => ({ net: v.gpio, pads: [`${k}.A`, v.pin] })),
  { net: "GND", pads: intent.ground.pads, anyOf: intent.ground.pins },
];
