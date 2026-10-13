// Anatomy 2.0 figure viewer. Makes a product figure live: the <svg> that `anatomy figure` writes, whose
// parts are <g class="a2-part" data-line data-step data-dx data-dy> groups, one per fig.part() call.
//   hover a part     it turns lit and the readout says what it is, how many and how it is made
//   click it         pins it and dispatches CustomEvent("a2:select", { detail: { line } }) on root;
//                    an "a2:select" dispatched anywhere else on the page highlights that line here
//   E, Take apart    every part eases out to its apart offset, staggered by assembly step, and back
//   ← →, the stepper walk the assembly steps: earlier steps shown, this one lit, later ones lifted away
//   Escape           clears the selection, then the steps and the apart pose
//   #apart #step=3 #select=pcb   start in that pose (combine with &), for screenshots and links
// The camera frames what is shown: the assembled product fills the card, and it eases out with the parts when they
// come apart (the drawing itself never changes; only the svg's viewBox moves). opts.frame: false keeps it still.
// data-a2-with="<line>" on an element inside a part (a clip path's <path>) holds it where that line's part is,
// so a switch stays clipped at the plate it passes through while either of them moves; on an element outside
// every part (a halo in fig.under) it moves and fades with that line's part. data-a2-until="<line>" on such an
// element shows it only in the steps before that line is placed (the PCB's shadow before the tray arrives).
// data-a2-xray="<line>" (fig.xray) also follows its line, and shows only while that line is lit and one of the
// lines in data-a2-xray-by is in place over it: the dashed outline of a part that others hide.
// Nothing moves until touched, nothing runs offscreen, and reduced motion jumps instead of easing.
// Framework-free and no build step: figure.html inlines it, and view.html and the website can too.
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
   * @param {Record<string, { name?: string, short?: string, process?: string, qtyPerUnit?: number }>} lines BOM lines by id
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
      const target = items.find((it) => it.line === (el.getAttribute("data-a2-with") || el.getAttribute("data-a2-xray")));
      const by = (el.getAttribute("data-a2-xray-by") || "").split(/\s+/).filter((id) => drawn.has(id));
      const until = el.getAttribute("data-a2-until");
      return target && host !== target ? [{ el, host, target, xray: el.hasAttribute("data-a2-xray"), by, until: until && drawn.has(until) ? until : null }] : [];
    });
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
    for (const it of items) {
      try {
        const b = it.el.getBBox();
        it.box = b.width || b.height ? [b.x, b.y, b.x + b.width, b.y + b.height] : null;
      } catch {
        it.box = null;
      }
    }
    const cam = { z: 1, cx: card.x + card.w / 2, cy: card.y + card.h / 2, vz: 0, vx: 0, vy: 0, target: null };
    /** Where the camera should be for the reader's pose: the shown parts, at rest or lifted, filling the card. */
    function shot() {
      const s = at ? steps[at - 1].n : Infinity;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
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
    function describe(id) {
      const l = lines[id] || {};
      const qty = l.qtyPerUnit ?? (figure.coverage && figure.coverage[id] ? figure.coverage[id].needed : 1);
      const bits = [l.short || l.name || id, `${qty} ×`, PROCESS[l.process] || l.process || ""];
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
        button.textContent = apart ? "Put together" : "Take apart";
        button.setAttribute("aria-pressed", String(apart));
        controls.querySelector('[data-a2="count"]').textContent = at ? `Step ${at} / ${steps.length}` : `${steps.length} steps`;
        controls.querySelector('[data-a2="prev"]').disabled = at === 0;
        controls.querySelector('[data-a2="next"]').disabled = at === steps.length;
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
      for (const { el, target, xray, by, until } of holders) {
        if (xray) {
          const lit = focus ? target.line === focus : target.step === now;
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
      const calm = jump || still.matches;
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
      at = clamp(Math.round(Number(n) || 0), 0, steps.length);
      retarget();
      return at;
    }

    // ---- controls and the parts list ----------------------------------------------------------------
    if (controls) {
      controls.classList.add("a2-bar");
      controls.innerHTML =
        `<button type="button" class="a2-btn" data-a2="apart" aria-pressed="false">Take apart</button>` +
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
        const qty = l.qtyPerUnit ?? (figure.coverage && figure.coverage[id] ? figure.coverage[id].needed : 1);
        const why = figure.hidden && figure.hidden[id];
        const note = drawn.has(id) ? "" : `<span class="a2-row-note">not drawn${why ? ` · ${esc(why)}` : ""}</span>`;
        const p = prices[id];
        const price = !has(p) ? "–" : p && typeof p === "object"
          ? `${esc(money(p.usd))}${p.qty ? `<span class="a2-row-pack">for ${esc(p.qty)}</span>` : ""}` : esc(money(p));
        return `<li><button type="button" class="a2-row" data-line="${esc(id)}"${drawn.has(id) ? "" : " data-hidden"} aria-pressed="false">` +
          `<svg class="a2-swatch" viewBox="0 0 16 10" aria-hidden="true">${drawn.has(id) ? SWATCH.drawn : SWATCH.hidden}</svg>` +
          `<span class="a2-row-name">${esc(l.name || id)}${note}</span>` +
          `<span class="a2-row-qty">${esc(qty)} ×</span>` +
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
    function setHover(line) {
      if (line === hover) return;
      hover = line;
      light();
      say();
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
      const key = event.key;
      if (keyTarget === document) {
        // The page's keys are the figure's only while it is on screen and nothing else has focus;
        // Home and End scroll the page unless the focus is in the figure.
        const active = document.activeElement;
        const inside = Boolean(active && scope.contains(active));
        if (!inside && active && active !== document.body && active !== document.documentElement) return;
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
        else if (at || apart) { at = 0; apart = false; retarget(); }
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

    function fromHash(jump) {
      const next = { apart: false, at: 0, pinned: null };
      for (const token of location.hash.slice(1).split("&").filter(Boolean)) {
        const cut = token.indexOf("=");
        const key = decode(cut < 0 ? token : token.slice(0, cut)), value = cut < 0 ? undefined : decode(token.slice(cut + 1));
        if (key === "apart") next.apart = value !== "0";
        else if (key === "step") next.at = clamp(parseInt(value, 10) || 0, 0, steps.length);
        else if (key === "select") next.pinned = known(value);
      }
      ({ apart, at, pinned } = next);
      retarget(jump);
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
