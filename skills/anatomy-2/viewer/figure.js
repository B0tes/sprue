// Anatomy 2.0 figure viewer. Makes a product figure live: the <svg> that `anatomy figure` writes, whose
// parts are <g class="a2-part" data-line data-step data-dx data-dy> groups, one per fig.part() call.
//   hover a part     it turns lit and the readout says what it is, how many and how it is made
//   click it         pins it and dispatches CustomEvent("a2:select", { detail: { line } }) on root;
//                    an "a2:select" dispatched anywhere else on the page highlights that line here
//   E, Take apart    every part eases out to its apart offset, staggered by assembly step, and back
//   ← →, the stepper walk the assembly steps: earlier steps shown, this one lit, later ones lifted away
//   Escape           clears the selection, then the steps and the apart pose
//   #apart #step=3 #select=pcb   start in that pose (combine with &), for screenshots and links
// An element inside a part with data-a2-with="<line>" (a clip path's <path>) is held where that line's part
// is, so a switch stays clipped at the plate it passes through while either of them moves.
// Nothing moves until touched, nothing runs offscreen, and reduced motion jumps instead of easing.
// Framework-free and no build step: figure.html inlines it, and view.html and the website can too.
// Load it as a plain script (it sets globalThis.mountFigure) or import it for that side effect.

(() => {
  const PROCESS = { buy: "bought", print: "printed", pcb: "PCB", cnc: "machined", sheet: "sheet metal" };
  /** Anatomy's exploded-view spring (references/motion.md): just under critical, so parts land with a hint of weight. */
  const SPRING = { stiffness: 64, damping: 14.2, substeps: 4, stagger: 0.045 };
  const FADE = 0.14; // seconds, opacity follow for steps that come and go
  const SWATCH = {
    drawn: '<path d="M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z"/><path class="a2-swatch-crease" d="M2 4.5 8 7.5 14 4.5"/>',
    hidden: '<path d="M1.5 5h13"/>',
  };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : String(v));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * @param {Element} root  holds the figure's <svg>; it becomes the focusable stage
   * @param {object} figure figure.json: { title, steps: [{ n, text, lines }], coverage, hidden, ... }
   * @param {Record<string, { name?: string, process?: string, qtyPerUnit?: number }>} lines BOM lines by id
   * @param {{ prices?: Record<string, number | string>, readout?: Element | false, controls?: Element | false,
   *   legend?: Element | false, scope?: Element, keys?: "root" | "document", hash?: boolean }} opts
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
    // An element marked data-a2-with="<line>" inside a part (a clip path, usually) stays with that line's part
    // while its own part moves: a switch clipped at the plate it passes through, a plug clipped at the wall.
    const holders = [...svg.querySelectorAll("[data-a2-with]")].flatMap((el) => {
      const host = items.find((it) => it.el.contains(el));
      const target = items.find((it) => it.line === el.getAttribute("data-a2-with"));
      return host && target ? [{ el, host, target }] : [];
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

    let apart = false; // the reader's choice; the springs follow
    let at = 0; // 0 = the whole product, 1..N = assembly step
    let hover = null;
    let pinned = null;
    let frame = 0, last = 0, clock = 0;
    let visible = typeof IntersectionObserver === "undefined";
    const rest = (readout && readout.textContent.trim()) || `assembled · ${total} parts`;

    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "0");
    if (!root.hasAttribute("role")) root.setAttribute("role", "group");
    if (!root.hasAttribute("aria-label"))
      root.setAttribute("aria-label", `${figure.title || "Product"}. Hover or tap a part to see what it is; E takes it apart; the arrow keys walk the assembly steps.`);
    root.classList.add("a2-fig");

    // ---- what each part reads ------------------------------------------------------------------
    function describe(id) {
      const l = lines[id] || {};
      const qty = l.qtyPerUnit ?? (figure.coverage && figure.coverage[id] ? figure.coverage[id].needed : 1);
      const bits = [l.name || id, `${qty} ×`, PROCESS[l.process] || l.process || ""];
      if (prices[id] !== undefined && prices[id] !== null && prices[id] !== "") bits.push(money(prices[id]));
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
    function light() {
      const focus = hover ?? pinned;
      const now = at ? steps[at - 1].n : null;
      root.toggleAttribute("data-a2-focus", Boolean(focus));
      for (const it of items) {
        it.el.toggleAttribute("data-on", it.line === focus);
        it.el.toggleAttribute("data-now", it.step === now);
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
        const a = groups.get(host.step).x, b = groups.get(target.step).x;
        const tx = target.dx * b - host.dx * a, ty = target.dy * b - host.dy * a;
        if (Math.abs(tx) < 0.005 && Math.abs(ty) < 0.005) el.removeAttribute("transform");
        else el.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
      }
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
      pinned = line || null;
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
      const hasPrices = Object.keys(prices).length > 0;
      legend.classList.add("a2-legend");
      const rows = ids.map((id) => {
        const l = lines[id] || {};
        const qty = l.qtyPerUnit ?? (figure.coverage && figure.coverage[id] ? figure.coverage[id].needed : 1);
        const why = figure.hidden && figure.hidden[id];
        const note = drawn.has(id) ? "" : `<span class="a2-row-note">not drawn${why ? ` · ${esc(why)}` : ""}</span>`;
        const price = prices[id] !== undefined && prices[id] !== null && prices[id] !== "" ? money(prices[id]) : "–";
        return `<li><button type="button" class="a2-row" data-line="${esc(id)}"${drawn.has(id) ? "" : " data-hidden"} aria-pressed="false">` +
          `<svg class="a2-swatch" viewBox="0 0 16 10" aria-hidden="true">${drawn.has(id) ? SWATCH.drawn : SWATCH.hidden}</svg>` +
          `<span class="a2-row-name">${esc(l.name || id)}${note}</span>` +
          `<span class="a2-row-qty">${esc(qty)} ×</span>` +
          `<span class="a2-row-how">${esc(PROCESS[l.process] || l.process || "")}</span>` +
          (hasPrices ? `<span class="a2-row-price">${esc(price)}</span>` : "") +
          `</button></li>`;
      });
      legend.innerHTML = `<div class="a2-legend-head"><span>Parts</span><span>${ids.length} lines · ${total} drawn</span></div>` +
        `<ul class="a2-rows"${hasPrices ? " data-prices" : ""}>${rows.join("")}</ul>`;
    }
    const rowOf = (event) => event.target.closest && event.target.closest(".a2-row");
    const onLegendOver = (event) => { if (event.pointerType !== "touch") { const row = rowOf(event); if (row) setHover(row.getAttribute("data-line")); } };
    const onLegendLeave = () => setHover(null);
    const onLegendFocus = (event) => { const row = rowOf(event); if (row) setHover(row.getAttribute("data-line")); };
    const onLegendClick = (event) => { const row = rowOf(event); if (row) { const id = row.getAttribute("data-line"); choose(id === pinned ? null : id); } };
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
      if (keyTarget === document && event.target.closest && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const key = event.key;
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
      let next = { apart: false, at: 0, pinned: null };
      for (const token of decodeURIComponent(location.hash.slice(1)).split("&").filter(Boolean)) {
        const [key, value] = token.split("=");
        if (key === "apart") next.apart = value !== "0";
        else if (key === "step") next.at = clamp(parseInt(value, 10) || 0, 0, steps.length);
        else if (key === "select") next.pinned = value || null;
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

    if (useHash && location.hash.length > 1) fromHash(true);
    else retarget(true);

    function destroy() {
      cancelAnimationFrame(frame);
      frame = 0;
      io?.disconnect();
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
      for (const { el } of holders) el.removeAttribute("transform");
      root.removeAttribute("data-a2-focus");
      if (readout) readout.textContent = rest;
    }

    return { destroy, select, explode, step };
  }

  globalThis.mountFigure = mountFigure;
  if (typeof module === "object" && module && module.exports) module.exports = { mountFigure };
})();
