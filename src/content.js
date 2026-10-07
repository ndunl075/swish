// Swish — turns file upload fields into a basketball hoop.
// Runs as a content script; also loads as a plain <script> (see demo/index.html),
// so every chrome.* call is guarded.
//
// Two steps: drop files anywhere and they sit on the page as a ball, then
// drag the ball to aim and release to shoot it into the hoop.
(() => {
  // A DOM marker rather than a window global: the extension's isolated world
  // and the page's own world don't share globals, but they share the DOM.
  if (document.documentElement.hasAttribute('data-swish')) return;
  document.documentElement.setAttribute('data-swish', '');

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage;
  const settings = { enabled: true, sound: true };
  let swishCount = 0;

  if (hasChrome) {
    chrome.storage.sync.get(settings, (s) => Object.assign(settings, s));
    chrome.storage.local.get({ swishCount: 0 }, (s) => { swishCount = s.swishCount; });
    chrome.storage.onChanged.addListener((changes) => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key === 'swishCount') swishCount = newValue;
        else if (key in settings) settings[key] = newValue;
      }
    });
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hoop geometry, in the hoop SVG's local coordinates.
  const HOOP_W = 140;
  const HOOP_H = 170;
  const RIM_X = 70;
  const RIM_Y = 84;

  const FLIGHT_MS = 650;
  const DROP_MS = 320;
  const STAGGER_MS = 140;
  // A press that moves less than this is a click, not a shot.
  const MIN_PULL_PX = 12;
  // Backstop only; dragleave normally hides the overlay. Browsers may space
  // dragover up to ~550ms apart while the pointer is still, so stay above that.
  const IDLE_HIDE_MS = 1000;

  const HINTS = {
    incoming: 'Drop it anywhere',
    holding: 'Drag the file to take the shot',
    aiming: 'Release to shoot!',
  };

  // ---------- target discovery ----------

  // The visible box for an input: the input itself, or the nearest sized
  // ancestor when the input is hidden behind a custom dropzone. Every ancestor
  // we climb through must render: an input inside a closed <details> or a
  // display:none panel isn't a real target, even if an outer box is visible.
  function visibleRect(el) {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const rendered = node.checkVisibility({ visibilityProperty: true });
      if (!rendered && node !== el) return null;
      const r = node.getBoundingClientRect();
      if (rendered && r.width >= 24 && r.height >= 16) return r;
    }
    return null;
  }

  function onScreen(r) {
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function distanceTo(r, x, y) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  }

  function pickTarget(x, y) {
    let best = null;
    for (const input of document.querySelectorAll('input[type=file]')) {
      if (input.disabled) continue;
      const rect = visibleRect(input);
      if (!rect) continue;
      const score = distanceTo(rect, x, y) + (onScreen(rect) ? 0 : 1e6);
      if (!best || score < best.score) best = { input, rect, score };
    }
    return best;
  }

  // ---------- overlay ----------

  // Layer phases (data-phase): incoming (an OS file drag is over the page),
  // holding (files dropped, ball resting), aiming (ball being dragged),
  // shooting (ball in flight). Only incoming blocks the page; after that just
  // the ball takes pointer input, so the page stays scrollable.
  const STYLE = `
    :host { all: initial; }
    .layer {
      position: fixed; inset: 0; z-index: 2147483647;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      opacity: 0; transition: opacity .15s ease;
      pointer-events: none;
    }
    .layer[data-phase] { opacity: 1; }
    .layer[data-phase="incoming"] { pointer-events: auto; }
    .scrim {
      position: absolute; inset: 0; opacity: 0;
      background: rgba(15, 23, 42, .12);
      backdrop-filter: blur(1px);
      transition: opacity .25s ease;
    }
    [data-phase="incoming"] .scrim { opacity: 1; }
    .bare .scrim, .bare .outline, .bare .pill, .bare .hint { display: none; }
    .outline {
      position: absolute; border: 2px dashed rgba(79, 70, 229, .7);
      border-radius: 12px; background: rgba(79, 70, 229, .05);
      transition: opacity .2s ease;
    }
    [data-phase="shooting"] .outline, [data-phase="shooting"] .hint { opacity: 0; }
    .trail, .balls { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .trail { opacity: 0; transition: opacity .15s ease; }
    [data-phase="aiming"] .trail { opacity: 1; }
    .trail circle { fill: #4f46e5; }
    .hoop { position: absolute; width: ${HOOP_W}px; height: ${HOOP_H}px; overflow: visible; }
    .hoop.in { animation: hoop-in .35s cubic-bezier(.2, 1.4, .4, 1) both; }
    @keyframes hoop-in { from { transform: translateY(-14px) scale(.85); opacity: 0; } }
    .net { transform-origin: ${RIM_X}px ${RIM_Y}px; transform-box: view-box; }
    .net.swish { animation: swish .45s ease-out; }
    @keyframes swish {
      30% { transform: scale(.86, 1.28); }
      60% { transform: scale(1.05, .92); }
    }
    .ball {
      position: absolute; left: 0; top: 0; width: 40px; height: 50px;
      margin: -25px 0 0 -20px; will-change: transform;
    }
    .card {
      width: 100%; height: 100%; box-sizing: border-box; position: relative;
      background: #fff; border-radius: 6px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, .22), 0 0 0 1px rgba(15, 23, 42, .08);
      clip-path: polygon(0 0, 72% 0, 100% 20%, 100% 100%, 0 100%);
    }
    .card::before {
      content: ""; position: absolute; left: 7px; right: 12px; top: 10px; height: 2px;
      background: #e2e8f0; box-shadow: 0 5px 0 #e2e8f0, 0 10px 0 #e2e8f0;
    }
    .card span {
      position: absolute; left: 5px; right: 5px; bottom: 6px;
      background: #2563eb; color: #fff; border-radius: 3px;
      font: 700 8px/13px ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em;
      text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .badge {
      position: absolute; right: -9px; top: -9px; min-width: 18px; height: 18px; padding: 0 5px;
      box-sizing: border-box; border-radius: 9px; background: #f97316; color: #fff;
      font: 700 11px/18px ui-sans-serif, system-ui, sans-serif; text-align: center;
    }
    .ghost { display: none; }
    [data-phase="incoming"] .ghost { display: block; }
    .held { display: none; pointer-events: auto; cursor: grab; touch-action: none; }
    [data-phase="holding"] .held, [data-phase="aiming"] .held { display: block; }
    [data-phase="aiming"] .held { cursor: grabbing; }
    .held .card { transition: transform .15s ease; }
    .held:hover .card { transform: scale(1.08); }
    [data-phase="aiming"] .held .card { transform: scale(1.12); }
    .held.landed .card { animation: land .45s cubic-bezier(.3, 1.6, .5, 1); }
    @keyframes land { from { transform: translateY(-18px) scale(1.2); } }
    .cancel {
      position: absolute; left: -10px; top: -10px; width: 20px; height: 20px; padding: 0;
      border: 0; border-radius: 50%; background: #334155; color: #fff; cursor: pointer;
      font: 700 13px/20px ui-sans-serif, system-ui, sans-serif; text-align: center;
      opacity: 0; transition: opacity .15s ease;
    }
    [data-phase="holding"] .held:hover .cancel, .cancel:focus-visible { opacity: 1; }
    .hint, .pill {
      position: absolute; transform: translateX(-50%); white-space: nowrap;
      font-size: 13px; color: #334155; transition: opacity .2s ease;
    }
    .hint {
      background: rgba(255, 255, 255, .92); padding: 6px 12px; border-radius: 999px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, .12);
    }
    .pill {
      background: #eef2ff; color: #3730a3; padding: 4px 10px; border-radius: 999px;
      border: 1px solid #c7d2fe; font-weight: 600; font-size: 12px;
    }
    .pill.bump { animation: bump .4s ease; }
    @keyframes bump { 40% { transform: translateX(-50%) scale(1.18); } }
  `;

  const HOOP_BACK = `
    <rect x="12" y="2" width="116" height="84" rx="8" fill="#fff" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="46" y="34" width="48" height="36" rx="2" fill="none" stroke="#1e3a8a" stroke-width="3"/>
    <rect x="64" y="80" width="12" height="8" rx="2" fill="#94a3b8"/>
    <path d="M26 ${RIM_Y} A44 8 0 0 1 114 ${RIM_Y}" fill="none" stroke="#3730a3" stroke-width="4"/>`;

  function netPath() {
    // Tapered mesh: 8 strands from the rim down to a narrower bottom ring,
    // plus diagonal cross-ties so it reads as a net rather than bars.
    const top = RIM_Y, bottom = RIM_Y + 66, n = 8;
    const topX = (i) => 28 + (84 * i) / n;
    const botX = (i) => 46 + (48 * i) / n;
    let d = '';
    for (let i = 0; i <= n; i++) d += `M${topX(i)} ${top + 4} L${botX(i)} ${bottom} `;
    for (let row = 1; row <= 3; row++) {
      const t = row / 4, y = top + 4 + (bottom - top - 4) * t;
      for (let i = 0; i < n; i++) {
        const x1 = topX(i) + (botX(i) - topX(i)) * t;
        const x2 = topX(i + 1) + (botX(i + 1) - topX(i + 1)) * t;
        d += `M${x1} ${y - 6} L${x2} ${y + 6} M${x2} ${y - 6} L${x1} ${y + 6} `;
      }
    }
    return d;
  }

  const HOOP_FRONT = `
    <g class="net"><path d="${netPath()}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-linecap="round"/></g>
    <path d="M26 ${RIM_Y} A44 8 0 0 0 114 ${RIM_Y}" fill="none" stroke="#4f46e5" stroke-width="5" stroke-linecap="round"/>`;

  const BALL = '<div class="card"><span></span></div><div class="badge"></div>';

  let ui = null;

  function buildUI() {
    const host = document.createElement('swish-overlay');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="layer">
        <div class="scrim"></div>
        <div class="outline"></div>
        <div class="pill"></div>
        <svg class="hoop back" viewBox="0 0 ${HOOP_W} ${HOOP_H}">${HOOP_BACK}</svg>
        <svg class="trail"></svg>
        <div class="balls"></div>
        <svg class="hoop front" viewBox="0 0 ${HOOP_W} ${HOOP_H}">${HOOP_FRONT}</svg>
        <div class="ball ghost">${BALL}</div>
        <div class="ball held" role="button" aria-label="Drag to shoot">
          ${BALL}<button class="cancel" type="button" aria-label="Cancel">×</button>
        </div>
        <div class="hint"></div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    ui = {
      host,
      layer: $('.layer'),
      outline: $('.outline'),
      pill: $('.pill'),
      back: $('.hoop.back'),
      front: $('.hoop.front'),
      net: $('.net'),
      trail: $('.trail'),
      balls: $('.balls'),
      ghost: $('.ghost'),
      held: $('.held'),
      hint: $('.hint'),
    };
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);
    ui.held.addEventListener('pointerdown', onGrab);
    ui.held.addEventListener('pointermove', onAim);
    ui.held.addEventListener('pointerup', onRelease);
    ui.held.addEventListener('pointercancel', onRelease);
    $('.cancel').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('.cancel').addEventListener('click', reset);
    return ui;
  }

  function mount() {
    if (!ui) buildUI();
    if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);
    return ui;
  }

  function setBall(el, label, count) {
    el.querySelector('.card span').textContent = label;
    const badge = el.querySelector('.badge');
    badge.textContent = count;
    badge.style.display = count > 1 ? '' : 'none';
  }

  function moveTo(el, x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ---------- state ----------

  // { phase, target, hoop, label, count, files, pos: {x, y}, grab }
  let state = null;
  let hideTimer = 0;
  let inFlight = 0;

  // Mirrors the phase on the overlay and on <html data-swish-state> so pages
  // can react to it.
  function setPhase(phase) {
    if (state) state.phase = phase;
    if (phase) {
      ui.layer.dataset.phase = phase;
      document.documentElement.setAttribute('data-swish-state', phase);
    } else {
      delete ui.layer.dataset.phase;
      document.documentElement.removeAttribute('data-swish-state');
    }
    ui.hint.textContent = HINTS[phase] || '';
  }

  function labelFor(nameOrType) {
    if (!nameOrType) return 'FILE';
    if (nameOrType.includes('/')) {
      const sub = nameOrType.split('/')[1].replace(/^x-|vnd\.|\+.*$/g, '');
      return (sub.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
    }
    const dot = nameOrType.lastIndexOf('.');
    return dot > 0 ? nameOrType.slice(dot + 1, dot + 5).toUpperCase() : 'FILE';
  }

  // Rim sits on the field's bottom edge, centered: backboard inside the
  // field, net hanging below it. Clamped so the whole hoop stays on screen.
  function placeHoop(rect) {
    const cx = Math.min(Math.max(rect.left + rect.width / 2, HOOP_W / 2 + 8), innerWidth - HOOP_W / 2 - 8);
    const cy = Math.min(Math.max(rect.bottom, RIM_Y + 40), innerHeight - (HOOP_H - RIM_Y) - 52);
    return { x: cx, y: cy };
  }

  function layout() {
    const { rect } = state.target;
    const { x, y } = state.hoop;
    Object.assign(ui.outline.style, {
      left: `${rect.left - 6}px`, top: `${rect.top - 6}px`,
      width: `${rect.width + 12}px`, height: `${rect.height + 12}px`,
    });
    for (const svg of [ui.back, ui.front]) {
      svg.style.left = `${x - RIM_X}px`;
      svg.style.top = `${y - RIM_Y}px`;
    }
    ui.pill.style.left = `${x}px`;
    ui.pill.style.top = `${y - RIM_Y - 34}px`;
    ui.pill.textContent = `Swishes ${swishCount}`;
    ui.hint.style.left = `${x}px`;
    ui.hint.style.top = `${Math.min(y + (HOOP_H - RIM_Y) + 18, innerHeight - 40)}px`;
  }

  // The page can scroll or reflow while a ball is waiting; keep the hoop on
  // the field.
  function relayout() {
    if (!state || state.phase === 'incoming') return;
    const rect = visibleRect(state.target.input);
    if (!rect) return;
    state.target.rect = rect;
    state.hoop = placeHoop(rect);
    layout();
    if (state.phase === 'aiming') drawTrail(state.pos.x, state.pos.y);
  }
  addEventListener('scroll', relayout, { capture: true, passive: true });
  addEventListener('resize', relayout);

  function reset() {
    clearTimeout(hideTimer);
    state = null;
    if (!ui) return;
    if (inFlight) {
      // Let shots already in the air finish; the last one clears the phase.
      ui.layer.dataset.phase = 'shooting';
      document.documentElement.setAttribute('data-swish-state', 'shooting');
    } else {
      setPhase(null);
    }
  }

  // ---------- step 1: drop the files onto the page ----------

  function isFileDrag(e) {
    return settings.enabled && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  }

  function show(e) {
    const target = pickTarget(e.clientX, e.clientY);
    if (!target) return false;
    mount();
    const items = [...(e.dataTransfer?.items || [])].filter((i) => i.kind === 'file');
    state = {
      phase: 'incoming',
      target,
      hoop: placeHoop(target.rect),
      label: labelFor(items[0]?.type),
      count: items.length,
    };
    layout();
    setBall(ui.ghost, state.label, state.count);
    // Pages that draw their own upload UI can ask for just the hoop and ball.
    ui.layer.classList.toggle('bare', document.documentElement.hasAttribute('data-swish-bare'));
    for (const svg of [ui.back, ui.front]) {
      svg.classList.remove('in');
      void svg.getBoundingClientRect();
      svg.classList.add('in');
    }
    setPhase('incoming');
    return true;
  }

  function armIdleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(reset, IDLE_HIDE_MS);
  }

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    // A new file drag replaces a ball that is waiting to be shot.
    if (state && state.phase !== 'holding') return;
    if (show(e)) {
      e.preventDefault();
      armIdleHide();
    }
  }, true);

  function onDragOver(e) {
    if (state?.phase !== 'incoming') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    moveTo(ui.ghost, e.clientX, e.clientY);
    armIdleHide();
  }

  function onDragLeave(e) {
    e.stopPropagation();
    // relatedTarget is null only when the pointer leaves the window.
    if (state?.phase === 'incoming' && !e.relatedTarget) reset();
  }

  function onDrop(e) {
    if (state?.phase !== 'incoming') return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(hideTimer);

    const { input } = state.target;
    const all = [...e.dataTransfer.files];
    const files = input.multiple ? all : all.slice(0, 1);
    if (!files.length) return reset();

    state.files = files;
    state.label = labelFor(files[0].name);
    state.count = files.length;
    state.pos = {
      x: Math.min(Math.max(e.clientX, 30), innerWidth - 30),
      y: Math.min(Math.max(e.clientY, 35), innerHeight - 35),
    };
    setBall(ui.held, state.label, state.count);
    moveTo(ui.held, state.pos.x, state.pos.y);
    ui.held.classList.remove('landed');
    void ui.held.offsetWidth;
    ui.held.classList.add('landed');
    setPhase('holding');
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state?.phase === 'holding' || state?.phase === 'aiming')) reset();
  });

  // ---------- step 2: drag the ball and release to shoot ----------

  function onGrab(e) {
    if (state?.phase !== 'holding' || e.button !== 0) return;
    e.preventDefault();
    try {
      ui.held.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only for smoother dragging; aiming works without it.
    }
    state.grab = {
      dx: state.pos.x - e.clientX,
      dy: state.pos.y - e.clientY,
      startX: state.pos.x,
      startY: state.pos.y,
    };
    setPhase('aiming');
    drawTrail(state.pos.x, state.pos.y);
  }

  function onAim(e) {
    if (state?.phase !== 'aiming') return;
    state.pos = { x: e.clientX + state.grab.dx, y: e.clientY + state.grab.dy };
    moveTo(ui.held, state.pos.x, state.pos.y);
    drawTrail(state.pos.x, state.pos.y);
  }

  function onRelease(e) {
    if (state?.phase !== 'aiming') return;
    const pulled = Math.hypot(state.pos.x - state.grab.startX, state.pos.y - state.grab.startY);
    if (e.type === 'pointercancel' || pulled < MIN_PULL_PX) {
      setPhase('holding');
      return;
    }
    shootAll();
  }

  // Quadratic bezier from the release point up and over into the rim.
  function arc(x0, y0) {
    const x1 = state.hoop.x, y1 = state.hoop.y - 10;
    const lift = Math.max(140, Math.hypot(x1 - x0, y1 - y0) * 0.45);
    const cx = (x0 + x1) / 2, cy = Math.max(Math.min(y0, y1) - lift, -60);
    return (t) => {
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
    };
  }

  function drawTrail(x, y) {
    const path = arc(x, y);
    let dots = '';
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      const [px, py] = path(t);
      dots += `<circle cx="${px}" cy="${py}" r="${2.6 - t * 1.4}" opacity="${0.85 - t * 0.5}"/>`;
    }
    ui.trail.innerHTML = dots;
  }

  function shootAll() {
    const { input } = state.target;
    const { files } = state;
    const shot = { path: arc(state.pos.x, state.pos.y), hoop: { ...state.hoop } };
    setPhase('shooting');
    state = null;

    files.forEach((file, i) => {
      inFlight++;
      setTimeout(() => shoot(file, shot, () => {
        if (--inFlight === 0 && !state) setPhase(null);
      }), i * STAGGER_MS);
    });

    // On a timer rather than at the end of the animation: rAF pauses in
    // background tabs, and the upload must never wait on a cosmetic effect.
    const lastLands = (files.length - 1) * STAGGER_MS + (reducedMotion ? 0 : FLIGHT_MS) + DROP_MS / 2;
    setTimeout(() => deliver(input, files), lastLands);
  }

  function shoot(file, { path, hoop }, done) {
    const ball = document.createElement('div');
    ball.className = 'ball';
    ball.innerHTML = BALL;
    setBall(ball, labelFor(file.name), 1);
    ui.balls.appendChild(ball);

    const flight = reducedMotion ? 0 : FLIGHT_MS;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 180);
    const start = performance.now();
    let swished = false;

    const frame = (now) => {
      const t = now - start;
      let x, y, rot, scale, opacity = 1;
      if (t < flight) {
        const p = t / flight;
        const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        [x, y] = path(eased);
        rot = spin * eased;
        scale = 1 - 0.2 * eased;
      } else {
        const p = Math.min((t - flight) / DROP_MS, 1);
        if (!swished) {
          swished = true;
          onSwish();
        }
        x = hoop.x;
        y = hoop.y - 10 + 72 * p * p;
        rot = spin;
        scale = 0.8 - 0.1 * p;
        opacity = 1 - Math.max(0, (p - 0.5) * 2);
        if (p === 1) {
          ball.remove();
          done();
          return;
        }
      }
      ball.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`;
      ball.style.opacity = opacity;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function onSwish() {
    ui.net.classList.remove('swish');
    void ui.net.getBoundingClientRect();
    ui.net.classList.add('swish');
    swishCount++;
    ui.pill.textContent = `Swishes ${swishCount}`;
    ui.pill.classList.remove('bump');
    void ui.pill.offsetWidth;
    ui.pill.classList.add('bump');
    if (hasChrome) chrome.storage.local.set({ swishCount });
    if (settings.sound && !document.documentElement.hasAttribute('data-swish-muted')) playSwish();
  }

  // Hand the files to the page exactly as if the user had picked them.
  function deliver(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- sound ----------

  let audio = null;

  // Net "swish": a burst of noise through a bandpass that sweeps downward.
  function playSwish() {
    try {
      audio ||= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime, dur = 0.38;
      const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = audio.createBufferSource();
      src.buffer = buf;
      const band = audio.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.9;
      band.frequency.setValueAtTime(5200, now);
      band.frequency.exponentialRampToValueAtTime(900, now + dur);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(band).connect(gain).connect(audio.destination);
      src.start(now);
    } catch {
      // Audio is a nicety; never let it break an upload.
    }
  }
})();
