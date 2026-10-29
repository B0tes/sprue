// Sprue figure viewer. Makes a product figure live: the <svg> that `sprue figure` writes, whose
// parts are <g class="a2-part" data-line data-step data-dx data-dy> groups, one per fig.part() call.
//   hover a part     it turns lit and the readout says what it is, how many and how it is made
//   click it         pins it and dispatches CustomEvent("a2:select", { detail: { line } }) on root;
//                    an "a2:select" dispatched anywhere else on the page highlights that line here
//   pointing at it   dispatches "a2:hover" { line } (null when the pointer leaves); an "a2:hover" from
//                    elsewhere (a BOM row) lights that line here while it lasts
//   E, Take apart    every part eases out to its apart offset, staggered by assembly step, and back; the button
//                    says what it does ("Put together" once apart), so it is no toggle
//   ← →, the stepper walk the assembly steps: earlier steps shown, this one lit, later ones lifted away (a stepper
//                    button that reaches an end gives the focus to the other, and the step's text is read out
//                    here only when it was walked here);
//                    every change dispatches "a2:step" { n, of, text } on root (n 0 is the whole product),
//                    and an "a2:step" { n } from elsewhere (a list of the steps) goes to that step, bringing the
//                    card into view; one from inside the figure's own card (its 3D view) only goes to it
//   E, Take apart    also dispatches "a2:apart" { on } when the pose changes, and an "a2:apart" from elsewhere (the
//                    3D view) takes it apart or puts it together
//   a view mounted   after it (the 3D view) dispatches "a2:ask", and it replies with its pose and line, each with
//                    { reply: true }; it asks the same when it mounts, and goes to the pose the replies say
//   Escape           clears the selection, then the steps and the apart pose
//                    (none of these keys while the page hides the drawing, as Fig 1's 3D tab does)
//   #apart #step=3 #select=pcb   start in that pose (combine with &), for screenshots and links; #part=<id> is the
//                    3D view's (a part of the model), which says its line itself, so the drawing leaves it to it
// The camera frames what is shown: the assembled product fills the card, and it eases out with the parts when they
// come apart (the drawing itself never changes; only the svg's viewBox moves). opts.frame: false keeps it still.
// data-a2-with="<line>" on an element inside a part (a clip path's <path>) holds it where that line's part is,
// so a switch stays clipped at the plate it passes through while either of them moves; on an element outside
// every part (a halo in fig.under) it moves and fades with that line's part. data-a2-until="<line>" on either
// shows it only in the steps before that line is placed: the PCB's shadow before the tray arrives, or a clip region
// that keeps a part whole until the shell whose opening it sits in goes on.
// data-a2-xray="<line>" (fig.xray) also follows its line, and shows only while that line is lit and one of the
// lines in data-a2-xray-by is in place over it: the dashed outline of a part that others hide. With
// data-a2-xray-step="<n>" it belongs to the part of that line placed at step n, and the step walk lights it at that
// step only; without, it follows the line's first part and lights at every step that places the line.
// Nothing moves until touched, nothing runs offscreen, and reduced motion jumps instead of easing.
// Framework-free and no build step: view.html, the product page, inlines it, and the website can too.
// Load it as a plain script (it sets globalThis.mountFigure) or import it for that side effect.

(() => {
  const PROCESS = { buy: "bought", print: "printed", pcb: "PCB", cnc: "machined", sheet: "sheet metal" };
  /** Anatomy's exploded-view spring (references/motion.md): just under critical, so parts land with a hint of weight. */
  const SPRING = { stiffness: 64, damping: 14.2, substeps: 4, stagger: 0.045 };
  /** The camera follows critically damped and a little slower than the parts, so it never overshoots. */
  const CAMERA = { stiffness: 40, damping: 12.6, fill: 0.8, most: 1.6 };
  const FADE = 0.14; // seconds, opacity follow for steps that come and go
  const MOUSE_HINT = "hover a part · e apart · ← → steps";
  const TOUCH_HINT = "Tap a part · buttons below";
  const SWATCH = {
    drawn: '<path d="M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z"/><path class="a2-swatch-crease" d="M2 4.5 8 7.5 14 4.5"/>',
    hidden: '<path d="M1.5 5h13"/>',
  };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const has = (v) => v !== undefined && v !== null && v !== "";
  /** A price: a number of dollars, a string as it is, or { usd, qty } for an order that buys more than the build uses. */
  const money = (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : v && typeof v === "object" ? `${money(v.usd)}${v.qty ? ` for ${v.qty}` : ""}` : String(v));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const decode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  /** Disables the stepper's ends; a button that has the focus as it is disabled gives it to the other, or to `home`. */
  function endStepper(prev, next, at, of, home) {
    const first = at === 0, last = at === of, active = document.activeElement;
    if (!first) prev.disabled = false;
    if (!last) next.disabled = false;
    if ((first && active === prev) || (last && active === next)) ((first && !last ? next : last && !first ? prev : null) || home).focus({ preventScroll: true });
    prev.disabled = first;
    next.disabled = last;
  }
  const HELD = ["data-a2-with", "data-a2-until", "data-a2-xray", "data-a2-xray-by"];
  /** What moves a held element. A CSS transform (the kit's .iso-halo has one) beats the transform attribute this
   * viewer sets, so such an element gets a <g> round it that takes over its data-a2-* attributes. A clip path's
   * own <path> has none and can't be wrapped, so it is moved as it is. */
  function carrier(el) {
    if (el.tagName.toLowerCase() === "g" || el.closest("clipPath") || getComputedStyle(el).transform === "none") return el;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const name of HELD) if (el.hasAttribute(name)) { g.setAttribute(name, el.getAttribute(name)); el.removeAttribute(name); }
    el.replaceWith(g);
    g.appendChild(el);
    return g;
  }

  /**
   * @param {Element} root  holds the figure's <svg>; it becomes the focusable stage
   * @param {object} figure figure.json: { title, steps: [{ n, text, lines }], coverage, hidden, ... }
   * @param {Record<string, { name?: string, short?: string, process?: string, qtyPerUnit?: number, qtyPerBatch?: number }>} lines BOM lines by id
   * @param {{ prices?: Record<string, number | string | { usd: number, qty?: number }>, readout?: Element | false,
   *   controls?: Element | false, legend?: Element | false, scope?: Element, keys?: "root" | "document",
   *   hash?: boolean, frame?: boolean, touchHint?: string }} opts
   *   readout, controls and legend default to [data-readout], [data-a2-controls] and [data-a2-legend] inside
   *   scope (default: the closest [data-a2-figure] around root); false turns one off.
   */
  function mountFigure(root, figure, lines = {}, opts = {}) {
    const svg = root.querySelector("svg");
    if (!svg) throw new Error("mountFigure: no <svg> inside root");
    figure = figure || {};
    lines = lines || {};
    const scope = opts.scope || root.closest("[data-a2-figure]") || root.parentElement || root;
    const find = (given, selector) => (given === false ? null : given || scope.querySelector(selector));
    const readout = find(opts.readout, "[data-readout]");
    const controls = find(opts.controls, "[data-a2-controls]");
    const legend = find(opts.legend, "[data-a2-legend]");
    const prices = opts.prices || {};
    const still = matchMedia("(prefers-reduced-motion: reduce)");

    const items = [...svg.querySelectorAll(".a2-part")].map((el) => ({
      el,
      line: el.getAttribute("data-line") || "",
      step: Number(el.getAttribute("data-step")) || 1,
      dx: Number(el.getAttribute("data-dx")) || 0,
      dy: Number(el.getAttribute("data-dy")) || 0,
      count: el.hasAttribute("data-count") ? Number(el.getAttribute("data-count")) : 1,
    }));
    const drawn = new Set(items.map((it) => it.line));
    const firstStep = (line) => Math.min(...items.filter((it) => it.line === line).map((it) => it.step));
    // An element marked data-a2-with="<line>" stays with that line's part (its first, when it has several): inside
    // another part (a clip path, usually) while that part moves, a switch clipped at the plate it passes through;
    // outside every part, moving and fading with it, a halo under the tray. data-a2-xray="<line>" also follows.
    const holders = [...svg.querySelectorAll("[data-a2-with],[data-a2-xray]")].map(carrier).flatMap((el) => {
      const host = items.find((it) => it.el.contains(el)) || null;
      const line = el.getAttribute("data-a2-with") || el.getAttribute("data-a2-xray");
      const at = Number(el.getAttribute("data-a2-xray-step")) || null;
      const target = (at && items.find((it) => it.line === line && it.step === at)) || items.find((it) => it.line === line);
      const by = (el.getAttribute("data-a2-xray-by") || "").split(/\s+/).filter((id) => drawn.has(id));
      const until = el.getAttribute("data-a2-until");
      return target && host !== target ? [{ el, host, target, at, xray: el.hasAttribute("data-a2-xray"), by, until: until && drawn.has(until) ? until : null }] : [];
    });
    /** Whether any part of a line is placed at step n. */
    const placesAt = (line, n) => items.some((it) => it.line === line && it.step === n);
    const total = items.reduce((sum, it) => sum + it.count, 0);
    const steps = (figure.steps && figure.steps.length
      ? figure.steps.map((s) => ({ n: s.n, text: s.text || "" }))
      : [...new Set(items.map((it) => it.step))].map((n) => ({ n, text: "" }))
    ).sort((a, b) => a.n - b.n);
    const groups = new Map(steps.map((s) => [s.n, { n: s.n, x: 0, v: 0, target: 0, o: 1, oTarget: 1, pending: null }]));
    for (const it of items) if (!groups.has(it.step)) groups.set(it.step, { n: it.step, x: 0, v: 0, target: 0, o: 1, oTarget: 1, pending: null });
    const order = [...groups.values()].sort((a, b) => a.n - b.n);
    const ids = Object.keys(figure.coverage || {}).length ? Object.keys(figure.coverage) : [...new Set([...Object.keys(lines), ...drawn])];
    const known = (line) => (line && ids.includes(line) ? line : null);

    let apart = false; // the reader's choice; the springs follow
    let at = 0; // 0 = the whole product, 1..N = assembly step
    let told = 0; // the step the page was last told about (a2:step); it starts at the whole product
    let toldApart = false; // and whether it was told the parts are apart (a2:apart)
    let asking = false; // the views on the page already say where they are, as it mounts: go there at once
    let hover = null;
    let pinned = null;
    let frame = 0, last = 0, clock = 0;
    let visible = typeof IntersectionObserver === "undefined"; // near the viewport: worth animating
    let seen = visible; // a good part of it on screen: the page's arrow keys belong to it
    const rest = (readout && readout.textContent.trim()) || `assembled · ${total} parts`;

    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "0");
    if (!root.hasAttribute("role")) root.setAttribute("role", "group");
    if (!root.hasAttribute("aria-label"))
      root.setAttribute("aria-label", `${figure.title || "Product"}. Hover or tap a part to see what it is; E takes it apart; the arrow keys walk the assembly steps.`);
    root.classList.add("a2-fig");

    // On a touch screen there is no hover and no keyboard: the default hint says what does work.
    const hint = scope.querySelector('[data-corner="hint"]');
    const hintText = hint ? hint.textContent : "";
    const touch = matchMedia("(hover: none) and (pointer: coarse)");
    const setHint = () => {
      if (hint && hintText.trim().toLowerCase() === MOUSE_HINT) hint.textContent = touch.matches ? opts.touchHint || TOUCH_HINT : hintText;
    };
    setHint();
    touch.addEventListener?.("change", setHint);

    // ---- the camera: the svg's viewBox frames what is shown -------------------------------------------
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const card = vb && vb.width ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : { x: 0, y: 0, w: figure.width || 640, h: figure.height || 480 };
    const framing = opts.frame !== false;
    const boxOf = (el) => {
      try {
        const b = el.getBBox();
        return b.width || b.height ? [b.x, b.y, b.x + b.width, b.y + b.height] : null;
      } catch {
        return null;
      }
    };
    for (const it of items) it.box = boxOf(it.el);
    // Context drawn outside every part (fig.under, fig.over: a desk edge, the phone on a stand) is always shown, so it
    // is always in the frame: a step's zoom never cuts it off at the card's edge. Halos and anything that moves with
    // a part (data-a2-with) go where their part goes instead.
    const context = [...svg.children].filter((el) => !el.matches(".a2-part, defs, clipPath, style, title, desc, .iso-halo, [data-a2-with], [data-a2-xray], [data-a2-until]")
      && !el.querySelector("[data-a2-with], [data-a2-until]")).map(boxOf).filter(Boolean);
    const cam = { z: 1, cx: card.x + card.w / 2, cy: card.y + card.h / 2, vz: 0, vx: 0, vy: 0, target: null };
    /** Where the camera should be for the reader's pose: the shown parts, at rest or lifted, filling the card. */
    function shot() {
      const s = at ? steps[at - 1].n : Infinity;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of context) {
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
      }
      for (const it of items) {
        if (!it.box || it.step > s) continue;
        const ox = apart ? it.dx : 0, oy = apart ? it.dy : 0;
        x0 = Math.min(x0, it.box[0] + ox); y0 = Math.min(y0, it.box[1] + oy);
        x1 = Math.max(x1, it.box[2] + ox); y1 = Math.max(y1, it.box[3] + oy);
      }
      if (!framing || !Number.isFinite(x0)) return { z: 1, cx: card.x + card.w / 2, cy: card.y + card.h / 2 };
      const z = clamp(Math.min((card.w * CAMERA.fill) / Math.max(x1 - x0, 1), (card.h * CAMERA.fill) / Math.max(y1 - y0, 1)), 1, CAMERA.most);
      const w = card.w / z, h = card.h / z;
      return { z, cx: clamp((x0 + x1) / 2, card.x + w / 2, card.x + card.w - w / 2), cy: clamp((y0 + y1) / 2, card.y + h / 2, card.y + card.h - h / 2) };
    }
    function aim() {
      const w = card.w / cam.z, h = card.h / cam.z;
      const box = `${(cam.cx - w / 2).toFixed(2)} ${(cam.cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
      if (svg.getAttribute("viewBox") !== box) svg.setAttribute("viewBox", box);
    }

    // ---- what each part reads ------------------------------------------------------------------
    /** "4 ×" a unit, or "1 for the batch" for a line the whole batch shares (qtyPerBatch, qtyPerUnit 0). */
    function qtyOf(l, id) {
      if (!l.qtyPerUnit && l.qtyPerBatch) return `${l.qtyPerBatch} for the batch`;
      return `${l.qtyPerUnit ?? (figure.coverage && figure.coverage[id] ? figure.coverage[id].needed : 1)} ×`;
    }
    function describe(id) {
      const l = lines[id] || {};
      const bits = [l.short || l.name || id, qtyOf(l, id), PROCESS[l.process] || l.process || ""];
      if (has(prices[id])) bits.push(money(prices[id]));
      if (!drawn.has(id)) bits.push("not drawn");
      return bits.filter(Boolean).join(" · ");
    }
    // The phase word reads where the parts are: within 1% of the way they count as arrived, though the springs settle on.
    const moving = () => order.some((g) => g.pending || Math.abs(g.x - g.target) > 0.01 || Math.abs(g.o - g.oTarget) > 0.02);
    function say() {
      const focus = hover ?? pinned;
      let text;
      if (focus) text = describe(focus);
      else if (at) text = `Step ${at} of ${steps.length} · ${steps[at - 1].text}`;
      else if (moving()) text = apart ? "taking apart" : "closing up";
      else text = apart ? `apart · ${total} parts` : rest;
      if (readout && readout.textContent !== text) {
        readout.textContent = text;
        readout.setAttribute("title", text);
      }
      if (controls) {
        const button = controls.querySelector('[data-a2="apart"]');
        // Its label is what it does, so it isn't a toggle too: a pressed "Put together" would read as together.
        button.textContent = apart ? "Put together" : "Take apart";
        button.toggleAttribute("data-on", apart);
        controls.querySelector('[data-a2="count"]').textContent = at ? `Step ${at} / ${steps.length}` : `${steps.length} steps`;
        endStepper(controls.querySelector('[data-a2="prev"]'), controls.querySelector('[data-a2="next"]'), at, steps.length, root);
        const note = controls.querySelector('[data-a2="text"]');
        const want = at ? steps[at - 1].text : "";
        if (note.textContent !== want) note.textContent = want;
      }
    }
    /** A line is in place when the product is assembled up to the current step and not taken apart. */
    const placed = (line) => !apart && firstStep(line) <= (at ? steps[at - 1].n : Infinity);
    function light() {
      const focus = hover ?? pinned;
      const now = at ? steps[at - 1].n : null;
      root.toggleAttribute("data-a2-focus", Boolean(focus));
      for (const it of items) {
        it.el.toggleAttribute("data-on", it.line === focus);
        it.el.toggleAttribute("data-now", it.step === now);
      }
      for (const { el, target, at: xstep, xray, by, until } of holders) {
        if (xray) {
          // Lit with its line, or in the step walk at the step that places it: its own step when it has one, else
          // any step that places a part of the line.
          const lit = focus ? target.line === focus : now !== null && (xstep ? xstep === now : placesAt(target.line, now));
          el.toggleAttribute("data-on", lit && (by.length ? by.some(placed) : !apart));
        }
        if (until) el.toggleAttribute("data-a2-gone", apart || !at || placed(until));
      }
      if (legend)
        for (const row of legend.querySelectorAll(".a2-row")) {
          const id = row.getAttribute("data-line");
          row.toggleAttribute("data-on", id === focus);
          row.setAttribute("aria-pressed", String(id === pinned));
        }
    }

    // ---- motion ----------------------------------------------------------------------------------
    function place() {
      for (const it of items) {
        const g = groups.get(it.step);
        if (Math.abs(g.x) < 1e-4) it.el.removeAttribute("transform");
        else it.el.setAttribute("transform", `translate(${(it.dx * g.x).toFixed(2)} ${(it.dy * g.x).toFixed(2)})`);
        if (g.o >= 0.999) it.el.style.removeProperty("opacity");
        else it.el.style.opacity = g.o.toFixed(3);
        it.el.toggleAttribute("data-off", g.o < 0.01);
      }
      for (const { el, host, target } of holders) {
        const a = host ? groups.get(host.step).x : 0, g = groups.get(target.step), b = g.x;
        const tx = target.dx * b - (host ? host.dx * a : 0), ty = target.dy * b - (host ? host.dy * a : 0);
        if (Math.abs(tx) < 0.005 && Math.abs(ty) < 0.005) el.removeAttribute("transform");
        else el.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
        if (host) continue;
        if (g.o >= 0.999) el.style.removeProperty("opacity");
        else el.style.opacity = g.o.toFixed(3);
      }
      aim();
    }
    /** Point every step's spring at the pose the reader chose. Leaving, the last step placed goes first;
     * arriving, the first step placed comes first. A reversal reschedules only what changes. */
    function retarget(jump = false) {
      const calm = jump || asking || still.matches;
      const s = at ? steps[at - 1].n : Infinity;
      const leaving = [], arriving = [];
      for (const g of order) {
        const want = { x: apart || g.n > s ? 1 : 0, o: g.n > s ? 0 : 1 };
        if (calm) {
          Object.assign(g, { pending: null, target: want.x, x: want.x, v: 0, oTarget: want.o, o: want.o });
          continue;
        }
        const ahead = g.pending || { x: g.target, o: g.oTarget };
        if (want.x === ahead.x && want.o === ahead.o) continue;
        if (g.pending && want.x === g.target && want.o === g.oTarget) { g.pending = null; continue; }
        (want.o < ahead.o || (want.o === ahead.o && want.x > ahead.x) ? leaving : arriving).push([g, want]);
      }
      leaving.sort((a, b) => b[0].n - a[0].n);
      arriving.sort((a, b) => a[0].n - b[0].n);
      for (const list of [leaving, arriving])
        list.forEach(([g, want], i) => { g.pending = { x: want.x, o: want.o, at: clock + i * SPRING.stagger }; });
      cam.target = shot();
      if (calm) Object.assign(cam, cam.target, { vz: 0, vx: 0, vy: 0 });
      place();
      light();
      say();
      if (!calm) run();
      if (at !== told) {
        told = at;
        root.dispatchEvent(new CustomEvent("a2:step", { detail: { n: at, of: steps.length, text: at ? steps[at - 1].text : "" }, bubbles: true }));
      }
      if (apart !== toldApart) {
        toldApart = apart;
        root.dispatchEvent(new CustomEvent("a2:apart", { detail: { on: apart }, bubbles: true }));
      }
    }
    function tick(now) {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      clock += dt;
      let busy = false;
      const h = dt / SPRING.substeps;
      for (const g of order) {
        if (g.pending && clock >= g.pending.at) {
          g.target = g.pending.x;
          g.oTarget = g.pending.o;
          g.pending = null;
        }
        if (g.pending) busy = true;
        for (let i = 0; i < SPRING.substeps; i++) {
          g.v += (SPRING.stiffness * (g.target - g.x) - SPRING.damping * g.v) * h;
          g.x += g.v * h;
        }
        if (Math.abs(g.target - g.x) < 5e-4 && Math.abs(g.v) < 5e-4) { g.x = g.target; g.v = 0; } else busy = true;
        g.o += (g.oTarget - g.o) * (1 - Math.exp(-dt / FADE));
        if (Math.abs(g.oTarget - g.o) < 0.003) g.o = g.oTarget; else busy = true;
      }
      if (cam.target) {
        const t = cam.target;
        for (let i = 0; i < SPRING.substeps; i++) {
          cam.vz += (CAMERA.stiffness * (t.z - cam.z) - CAMERA.damping * cam.vz) * h;
          cam.vx += (CAMERA.stiffness * (t.cx - cam.cx) - CAMERA.damping * cam.vx) * h;
          cam.vy += (CAMERA.stiffness * (t.cy - cam.cy) - CAMERA.damping * cam.vy) * h;
          cam.z += cam.vz * h; cam.cx += cam.vx * h; cam.cy += cam.vy * h;
        }
        const near = Math.abs(t.z - cam.z) < 1e-4 && Math.abs(t.cx - cam.cx) < 0.02 && Math.abs(t.cy - cam.cy) < 0.02;
        if (near && Math.abs(cam.vz) < 1e-3 && Math.abs(cam.vx) < 0.05 && Math.abs(cam.vy) < 0.05) Object.assign(cam, t, { vz: 0, vx: 0, vy: 0 });
        else busy = true;
      }
      place();
      say();
      frame = busy && visible ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    }
    function run() {
      if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); }
    }

    // ---- the API --------------------------------------------------------------------------------
    function select(line) {
      pinned = known(line);
      light();
      say();
      return pinned;
    }
    function choose(line) {
      select(line);
      root.dispatchEvent(new CustomEvent("a2:select", { detail: { line: pinned }, bubbles: true }));
    }
    function explode(on) {
      apart = on === undefined ? !apart : Boolean(on);
      retarget();
      return apart;
    }
    function step(n) {
      // A pinned part would keep the readout and hide the step's x-rays: the step asked for is what to show now.
      if (pinned) choose(null);
      at = clamp(Math.round(Number(n) || 0), 0, steps.length);
      speak(true);
      retarget();
      return at;
    }
    /** The step's text is read out by the view that walked to it, not again by the one that followed. */
    const speak = (on) => controls?.querySelector('[data-a2="text"]').setAttribute("aria-live", on ? "polite" : "off");

    // ---- controls and the parts list ----------------------------------------------------------------
    if (controls) {
      controls.classList.add("a2-bar");
      controls.innerHTML =
        `<button type="button" class="a2-btn" data-a2="apart">Take apart</button>` +
        `<span class="a2-stepper" role="group" aria-label="Assembly steps">` +
        `<button type="button" class="a2-btn a2-icon" data-a2="prev" aria-label="Previous step">‹</button>` +
        `<span class="a2-count" data-a2="count"></span>` +
        `<button type="button" class="a2-btn a2-icon" data-a2="next" aria-label="Next step">›</button></span>` +
        `<p class="a2-step-text" data-a2="text" aria-live="polite"></p>`;
    }
    const onControls = (event) => {
      const button = event.target.closest("[data-a2]");
      if (!button) return;
      const what = button.getAttribute("data-a2");
      if (what === "apart") explode();
      else if (what === "prev") step(at - 1);
      else if (what === "next") step(at + 1);
    };
    controls?.addEventListener("click", onControls);

    if (legend) {
      const hasPrices = Object.values(prices).some(has);
      legend.classList.add("a2-legend");
      const rows = ids.map((id) => {
        const l = lines[id] || {};
        const qty = qtyOf(l, id);
        const why = figure.hidden && figure.hidden[id];
        const note = drawn.has(id) ? "" : `<span class="a2-row-note">not drawn${why ? ` · ${esc(why)}` : ""}</span>`;
        const p = prices[id];
        const price = !has(p) ? "–" : p && typeof p === "object"
          ? `${esc(money(p.usd))}${p.qty ? `<span class="a2-row-pack">for ${esc(p.qty)}</span>` : ""}` : esc(money(p));
        return `<li><button type="button" class="a2-row" data-line="${esc(id)}"${drawn.has(id) ? "" : " data-hidden"} aria-pressed="false">` +
          `<svg class="a2-swatch" viewBox="0 0 16 10" aria-hidden="true">${drawn.has(id) ? SWATCH.drawn : SWATCH.hidden}</svg>` +
          `<span class="a2-row-name">${esc(l.name || id)}${note}</span>` +
          `<span class="a2-row-qty">${esc(qty)}</span>` +
          `<span class="a2-row-how">${esc(PROCESS[l.process] || l.process || "")}</span>` +
          (hasPrices ? `<span class="a2-row-price">${price}</span>` : "") +
          `</button></li>`;
      });
      const heads = `<span></span><span>Part</span><span class="a2-col-qty">Qty</span><span>How</span>${hasPrices ? '<span class="a2-col-price">Cost</span>' : ""}`;
      legend.innerHTML = `<div class="a2-legend-head"><span>Parts</span><span>${ids.length} lines · ${total} drawn</span></div>` +
        `<div class="a2-cols${hasPrices ? " a2-cols-prices" : ""}" aria-hidden="true">${heads}</div>` +
        `<ul class="a2-rows"${hasPrices ? " data-prices" : ""}>${rows.join("")}</ul>`;
    }
    const rowOf = (event) => event.target.closest && event.target.closest(".a2-row");
    const onLegendOver = (event) => { if (event.pointerType !== "touch") { const row = rowOf(event); if (row) setHover(row.getAttribute("data-line")); } };
    const onLegendLeave = () => setHover(null);
    const onLegendFocus = (event) => { const row = rowOf(event); if (row) setHover(row.getAttribute("data-line")); };
    /** The parts list sits under the card: when a row is picked and the card is mostly out of view, bring it back. */
    function reveal() {
      const r = root.getBoundingClientRect(), h = innerHeight || document.documentElement.clientHeight;
      const shown = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
      if (r.height && shown < r.height / 2) root.scrollIntoView({ block: "nearest", behavior: still.matches ? "auto" : "smooth" });
    }
    const onLegendClick = (event) => {
      const row = rowOf(event);
      if (!row) return;
      const id = row.getAttribute("data-line");
      choose(id === pinned ? null : id);
      if (pinned) reveal();
    };
    if (legend) {
      legend.addEventListener("pointerover", onLegendOver);
      legend.addEventListener("pointerleave", onLegendLeave);
      legend.addEventListener("focusin", onLegendFocus);
      legend.addEventListener("focusout", onLegendLeave);
      legend.addEventListener("click", onLegendClick);
    }

    // ---- pointer, keys, the page, the hash --------------------------------------------------------
    /** What is pointed at; told to the rest of the page unless the page said it (an a2:hover from outside). */
    function setHover(line, quiet = false) {
      if (line === hover) return;
      hover = line;
      light();
      say();
      if (!quiet) root.dispatchEvent(new CustomEvent("a2:hover", { detail: { line: hover }, bubbles: true }));
    }
    const partOf = (event) => {
      const part = event.target.closest && event.target.closest(".a2-part");
      return part && svg.contains(part) ? part.getAttribute("data-line") : null;
    };
    const onOver = (event) => { if (event.pointerType !== "touch") setHover(partOf(event)); };
    const onLeave = () => setHover(null);
    const onClick = (event) => {
      const line = partOf(event);
      choose(line && line === pinned ? null : line);
      root.focus({ preventScroll: true });
    };
    svg.addEventListener("pointerover", onOver);
    svg.addEventListener("pointerleave", onLeave);
    svg.addEventListener("click", onClick);

    const keyTarget = opts.keys === "document" ? document : root;
    const onKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      // A drawing the page hides (Fig 1 on its 3D tab) takes no keys: the 3D view, or the page, has them.
      if (!root.getClientRects().length) return;
      const key = event.key;
      if (keyTarget === document) {
        // The page's keys are the figure's only while it is on screen and nothing else has focus;
        // Home and End scroll the page unless the focus is in the figure.
        const active = document.activeElement;
        const inside = Boolean(active && scope.contains(active));
        // A plain button or link just clicked elsewhere (a run switch, a step in the build list) keeps the focus but
        // has no use for these keys; a tab, a radio or a field does.
        const plain = Boolean(active && active.matches && active.matches("button, a[href], summary")
          && !active.matches("[role=tab], [role=radio], [role=option], [role=slider], [role=spinbutton], [role=menuitem]"));
        if (!inside && !plain && active && active !== document.body && active !== document.documentElement) return;
        if (event.target.closest && event.target.closest("input, textarea, select, [contenteditable]")) return;
        if (!inside && (!seen || key === "Home" || key === "End")) return;
      }
      if (key === "e" || key === "E") explode();
      else if (key === "ArrowRight") step(at + 1);
      else if (key === "ArrowLeft") step(at - 1);
      else if (key === "Home") step(0);
      else if (key === "End") step(steps.length);
      else if (key === "Escape") {
        if (pinned) choose(null);
        else if (at || apart) { at = 0; apart = false; speak(true); retarget(); }
        else return;
      } else return;
      event.preventDefault();
    };
    keyTarget.addEventListener("keydown", onKey);

    const onOutside = (event) => {
      if (root.contains(event.target)) return; // our own event, bubbling up
      select(event.detail && event.detail.line);
    };
    document.addEventListener("a2:select", onOutside);
    const onOutsideHover = (event) => {
      if (root.contains(event.target)) return;
      setHover(known(event.detail && event.detail.line), true);
    };
    document.addEventListener("a2:hover", onOutsideHover);
    /** A step chosen elsewhere on the page (the build list) is shown here: bring the card into view and take
     * the focus, so the arrow keys go on from there. */
    const onOutsideStep = (event) => {
      if (root.contains(event.target)) return;
      // From the figure's own card (its 3D view), or a view's reply as it mounts: the same figure in another view,
      // already where the reader is. That view says what it pins itself, so a line pinned here stays.
      if (scope.contains(event.target) || (event.detail && event.detail.reply)) {
        const n = clamp(Math.round(Number(event.detail && event.detail.n) || 0), 0, steps.length);
        if (n === at) return;
        told = at = n;
        speak(false);
        retarget();
        return;
      }
      step(event.detail && event.detail.n); // which also lets go of a pinned part
      const card = root.closest(".iso-plate") || root;
      const r = card.getBoundingClientRect(), h = innerHeight || document.documentElement.clientHeight;
      if (r.height && Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0)) < Math.min(r.height, h) * 0.6)
        card.scrollIntoView({ block: "start", behavior: still.matches ? "auto" : "smooth" });
      root.focus({ preventScroll: true });
    };
    document.addEventListener("a2:step", onOutsideStep);
    /** The parts taken apart or put together elsewhere (the 3D view): the same here, without telling it back. */
    const onOutsideApart = (event) => {
      if (root.contains(event.target)) return;
      const on = Boolean(event.detail && event.detail.on);
      if (on === apart) return;
      toldApart = on;
      explode(on);
    };
    document.addEventListener("a2:apart", onOutsideApart);
    /** A view mounted after this one asks where things are: this one says its pose and its line, as replies. */
    const onAsk = (event) => {
      if (root.contains(event.target)) return;
      told = at;
      toldApart = apart;
      for (const [type, detail] of [["a2:step", { n: at, of: steps.length, text: at ? steps[at - 1].text : "" }], ["a2:apart", { on: apart }],
        ["a2:select", { line: pinned }]])
        root.dispatchEvent(new CustomEvent(type, { detail: { ...detail, reply: true }, bubbles: true }));
    };
    document.addEventListener("a2:ask", onAsk);

    function fromHash(jump) {
      const next = { apart: false, at: 0, pinned: null };
      let part = false; // the hash names a part of the 3D view, which tells the page its line
      for (const token of location.hash.slice(1).split("&").filter(Boolean)) {
        const cut = token.indexOf("=");
        const key = decode(cut < 0 ? token : token.slice(0, cut)), value = cut < 0 ? undefined : decode(token.slice(cut + 1));
        if (key === "apart") next.apart = value !== "0";
        else if (key === "step") next.at = clamp(parseInt(value, 10) || 0, 0, steps.length);
        else if (key === "select") next.pinned = known(value);
        else if (key === "part") part = true;
      }
      // A part's line is the 3D view's to say, before or after this: what it said stands.
      ({ apart, at } = next);
      if (!part || next.pinned) pinned = next.pinned;
      retarget(jump);
      if (!part) root.dispatchEvent(new CustomEvent("a2:select", { detail: { line: pinned }, bubbles: true }));
    }
    const useHash = opts.hash !== false;
    const onHash = () => fromHash(false);
    if (useHash) addEventListener("hashchange", onHash);

    const io = visible ? null : new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    }, { rootMargin: "120px 0px" });
    io?.observe(root);
    const eyes = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      seen = entries[entries.length - 1].intersectionRatio >= 0.3;
    }, { threshold: [0, 0.3, 0.6] });
    eyes?.observe(root);

    if (useHash && location.hash.length > 1) fromHash(true);
    else retarget(true);
    // A view on the page already (a 3D view, moved since the page opened) says where it is, and this one goes there.
    asking = true;
    root.dispatchEvent(new CustomEvent("a2:ask", { bubbles: true }));
    asking = false;

    function destroy() {
      cancelAnimationFrame(frame);
      frame = 0;
      io?.disconnect();
      eyes?.disconnect();
      touch.removeEventListener?.("change", setHint);
      if (hint) hint.textContent = hintText;
      svg.removeEventListener("pointerover", onOver);
      svg.removeEventListener("pointerleave", onLeave);
      svg.removeEventListener("click", onClick);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("a2:select", onOutside);
      document.removeEventListener("a2:hover", onOutsideHover);
      document.removeEventListener("a2:step", onOutsideStep);
      document.removeEventListener("a2:apart", onOutsideApart);
      document.removeEventListener("a2:ask", onAsk);
      if (useHash) removeEventListener("hashchange", onHash);
      controls?.removeEventListener("click", onControls);
      if (legend) {
        legend.removeEventListener("pointerover", onLegendOver);
        legend.removeEventListener("pointerleave", onLegendLeave);
        legend.removeEventListener("focusin", onLegendFocus);
        legend.removeEventListener("focusout", onLegendLeave);
        legend.removeEventListener("click", onLegendClick);
        legend.innerHTML = "";
      }
      if (controls) controls.innerHTML = "";
      for (const it of items) {
        it.el.removeAttribute("transform");
        it.el.style.removeProperty("opacity");
        for (const a of ["data-on", "data-now", "data-off"]) it.el.removeAttribute(a);
      }
      for (const { el } of holders) {
        el.removeAttribute("transform");
        el.removeAttribute("data-on");
        el.removeAttribute("data-a2-gone");
        el.style.removeProperty("opacity");
      }
      svg.setAttribute("viewBox", `${card.x} ${card.y} ${card.w} ${card.h}`);
      root.removeAttribute("data-a2-focus");
      if (readout) readout.textContent = rest;
    }

    return { destroy, select, explode, step };
  }

  globalThis.mountFigure = mountFigure;
  if (typeof module === "object" && module && module.exports) module.exports = { mountFigure };
})();
