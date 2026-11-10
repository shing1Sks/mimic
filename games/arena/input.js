/*
 * Duskwater - input layer.
 *
 * Top half: pure functions (mapping tables, hat decoding, dead zones, curves, look acceleration).
 * They run in Node for the tests. Bottom half: InputManager, the browser side that polls the
 * Gamepad API, keyboard and mouse (pointer lock) and hands the game one merged frame.
 *
 * A mapping fix is a one-line change in PAD_LAYOUTS or ACTIONS below.
 *
 * Classic script: defines window.ArenaInput. Node: module.exports.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- mapping tables (edit here)

  /** How each kind of pad reports its controls. Indices into gamepad.buttons / gamepad.axes. */
  const PAD_LAYOUTS = {
    // Mimic's Pad mode as Chrome sees it (NOT the "standard" mapping). 16 buttons.
    mimic: {
      buttons: { a: 0, b: 1, x: 2, y: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, home: 12 },
      axes: { lx: 0, ly: 1, rx: 2, ry: 5, lt: 3, rt: 4 },
      triggerAxisRest: -1,   // L2/R2 analog axes rest at -1 and go to +1 when pulled
      hatAxis: 9,            // D-pad as a hat switch (see decodeHat)
    },
    // Xbox / PlayStation / anything Chrome maps to the W3C standard layout.
    standard: {
      buttons: { a: 0, b: 1, x: 2, y: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16 },
      axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
      triggerButtons: { lt: 6, rt: 7 },  // analog triggers come as button values 0..1
    },
    // Unknown HID pad: best guess, close to the Mimic layout.
    generic: {
      buttons: { a: 0, b: 1, x: 2, y: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, home: 12 },
      axes: { lx: 0, ly: 1, rx: 2, ry: 3 },
      triggerButtons: { lt: 6, rt: 7 },
      hatAxis: 9,
    },
  };

  /**
   * Game actions -> pad controls (names from PAD_LAYOUTS, plus 'lt'/'rt' for analog triggers and
   * up/down/left/right for the D-pad) and keyboard codes (KeyboardEvent.code, Mouse0/1/2, WheelUp/Down).
   */
  const ACTIONS = {
    fire:       { pad: ['rt'],          keys: ['Mouse0'] },
    aim:        { pad: ['lt'],          keys: ['Mouse2'] },
    jump:       { pad: ['a'],           keys: ['Space'] },
    crouch:     { pad: ['b'],           keys: ['ControlLeft', 'KeyC'] },
    crouchToggle: { pad: ['l3'],        keys: [] },
    walk:       { pad: [],              keys: ['ShiftLeft', 'ShiftRight'] },
    reload:     { pad: ['x'],           keys: ['KeyR'] },
    nextWeapon: { pad: ['y', 'r1', 'right'], keys: ['WheelDown'] },
    prevWeapon: { pad: ['l1', 'left'],  keys: ['WheelUp', 'KeyQ'] },
    slot1:      { pad: [],              keys: ['Digit1'] },
    slot2:      { pad: [],              keys: ['Digit2'] },
    buy:        { pad: ['select'],      keys: ['KeyB'] },
    scoreboard: { pad: ['select', 'r3'], keys: ['Tab'] },
    pause:      { pad: ['start'],       keys: ['Escape', 'KeyP'] },
    guide:      { pad: ['home'],        keys: ['KeyH'] },
    // menus
    menuUp:     { pad: ['up'],          keys: ['ArrowUp', 'KeyW'] },
    menuDown:   { pad: ['down'],        keys: ['ArrowDown', 'KeyS'] },
    menuLeft:   { pad: ['left'],        keys: ['ArrowLeft', 'KeyA'] },
    menuRight:  { pad: ['right'],       keys: ['ArrowRight', 'KeyD'] },
    menuOk:     { pad: ['a'],           keys: ['Enter', 'Space'] },
    menuBack:   { pad: ['b'],           keys: ['Escape', 'Backspace'] },
  };

  const PAD_BUTTON_NAMES = ['a', 'b', 'x', 'y', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'home', 'up', 'down', 'left', 'right'];
  const TRIGGER_PRESS = 0.35;

  // ---------------------------------------------------------------- pure helpers

  /** Kind of pad: 'mimic' (16-button Pad mode), 'mimic-motion' (12-button, ignored), 'standard', 'generic'. */
  function classifyPad(gp) {
    if (!gp) return null;
    const mimic = /mimic/i.test(gp.id || '');
    const nb = gp.buttons ? gp.buttons.length : 0;
    if (mimic && nb === 16) return 'mimic';
    if (nb === 12 && (mimic || (gp.axes && gp.axes.length >= 6 && gp.mapping !== 'standard'))) return 'mimic-motion';
    if (mimic && nb < 16) return 'mimic-motion';
    if (gp.mapping === 'standard') return 'standard';
    return 'generic';
  }

  /** The pad to play with: the Mimic Pad first, then a standard pad, then anything but the motion controller. */
  function pickPad(list) {
    let best = null, rank = 0;
    for (const gp of list || []) {
      if (!gp || gp.connected === false) continue;
      const k = classifyPad(gp);
      const r = k === 'mimic' ? 3 : k === 'standard' ? 2 : k === 'generic' ? 1 : 0;
      if (r > rank) { best = gp; rank = r; }
    }
    return best;
  }

  /** Pads usable for play (not the 12-button motion controller), in gamepad index order. */
  function playPads(list) {
    return (list || []).filter(gp => gp && gp.connected !== false && classifyPad(gp) !== 'mimic-motion');
  }

  /**
   * Which pads an input source reads. source: 'auto' (the best single pad, the solo game),
   * 'all' (every play pad merged, for menus) or { pad: gamepad index } (one split-screen player).
   */
  function padsFor(source, list) {
    if (source === 'auto') { const p = pickPad(list); return p ? [p] : []; }
    if (source === 'all') return playPads(list);
    if (source && source.pad != null) return playPads(list).filter(gp => gp.index === source.pad);
    return [];
  }

  /** Several pad snapshots as one: any button held counts, each stick comes from the pad pushing it furthest. */
  function mergePadStates(states) {
    if (!states.length) return null;
    if (states.length === 1) return states[0];
    const out = Object.assign({}, states[0], { buttons: {} });
    PAD_BUTTON_NAMES.forEach(n => { out.buttons[n] = states.some(s => s.buttons[n]); });
    const pickStick = (x, y) => states.reduce((b, s) => Math.hypot(s[x], s[y]) > Math.hypot(b[x], b[y]) ? s : b, states[0]);
    const l = pickStick('lx', 'ly'), r = pickStick('rx', 'ry');
    out.lx = l.lx; out.ly = l.ly; out.rx = r.rx; out.ry = r.ry; out.layout = r.layout;
    out.lt = Math.max(...states.map(s => s.lt)); out.rt = Math.max(...states.map(s => s.rt));
    return out;
  }

  /**
   * Chrome reports a HID hat switch on one axis: -1 + (2/7) * d for d = 0 (up) .. 7 (up-left),
   * clockwise; centred is about 1.2857. An axis that never reported reads exactly 0.
   */
  function decodeHat(v) {
    const out = { up: false, down: false, left: false, right: false };
    if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) < 0.05 || v > 1.1 || v < -1.1) return out;
    const d = ((Math.round((v + 1) * 3.5) % 8) + 8) % 8;
    out.up = d === 7 || d === 0 || d === 1;
    out.right = d >= 1 && d <= 3;
    out.down = d >= 3 && d <= 5;
    out.left = d >= 5 && d <= 7;
    return out;
  }

  const btnPressed = b => !!b && (typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5);
  const btnValue = b => !b ? 0 : (typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : +b);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /** Normalised snapshot of any pad: sticks -1..1 (y + down), triggers 0..1, named booleans. */
  function readPad(gp, layoutName) {
    const layout = layoutName || (classifyPad(gp) === 'mimic' ? 'mimic' : classifyPad(gp) === 'standard' ? 'standard' : 'generic');
    const L = PAD_LAYOUTS[layout];
    const ax = gp.axes || [], bt = gp.buttons || [];
    const axis = i => (i == null || typeof ax[i] !== 'number' || !isFinite(ax[i])) ? 0 : ax[i];
    const s = {
      layout, id: gp.id || '',
      lx: clamp(axis(L.axes.lx), -1, 1), ly: clamp(axis(L.axes.ly), -1, 1),
      rx: clamp(axis(L.axes.rx), -1, 1), ry: clamp(axis(L.axes.ry), -1, 1),
      lt: 0, rt: 0, buttons: {},
    };
    PAD_BUTTON_NAMES.forEach(n => { s.buttons[n] = L.buttons[n] != null ? btnPressed(bt[L.buttons[n]]) : false; });
    // triggers: analog axis (Mimic), analog button value (standard), and the digital button
    ['lt', 'rt'].forEach(t => {
      let v = 0;
      if (L.axes[t] != null && L.triggerAxisRest != null) {
        const raw = axis(L.axes[t]);
        v = raw === 0 ? 0 : clamp((raw - L.triggerAxisRest) / (1 - L.triggerAxisRest), 0, 1);
      }
      if (L.triggerButtons && L.triggerButtons[t] != null) v = Math.max(v, btnValue(bt[L.triggerButtons[t]]));
      const dig = t === 'lt' ? 'l2' : 'r2';
      if (s.buttons[dig] && v < TRIGGER_PRESS) v = 1; // digital-only trigger: full pull
      s[t] = v;
      if (v > TRIGGER_PRESS) s.buttons[dig] = true;
    });
    if (L.hatAxis != null && ax.length > L.hatAxis) {
      const h = decodeHat(ax[L.hatAxis]);
      ['up', 'down', 'left', 'right'].forEach(k => { s.buttons[k] = s.buttons[k] || h[k]; });
    }
    return s;
  }

  /** Radial dead zone: inside `inner` is zero, then rescaled so it ramps from 0 at the edge to 1 at `outer`. */
  function radialDeadzone(x, y, inner, outer) {
    const m = Math.hypot(x, y);
    if (m <= inner || m === 0) return { x: 0, y: 0, m: 0 };
    const n = clamp((m - inner) / Math.max(1e-6, (outer - inner)), 0, 1);
    return { x: x / m * n, y: y / m * n, m: n };
  }

  /** Sign-preserving power curve: exponent > 1 gives fine control near centre. */
  function responseCurve(v, exponent) {
    return Math.sign(v) * Math.pow(Math.abs(v), exponent);
  }

  /**
   * Two-zone curve for 0..1: a linear share `inner` dominates near centre (fine aim moves at a
   * steady, predictable rate) and the power term takes over toward the rim (fast turns).
   */
  function blendCurve(m, inner, exponent) {
    return inner * m + (1 - inner) * Math.pow(m, exponent);
  }

  function createLookState() { return { held: 0, mult: 1 }; }

  /** Look acceleration: hold the stick past the threshold and turn speed ramps up after a short delay. */
  function lookAccelStep(st, mag, dt, o) {
    if (mag < o.accelThreshold) return { held: 0, mult: 1 };
    const held = st.held + dt;
    const k = clamp((held - o.accelDelay) / Math.max(1e-6, o.accelRamp), 0, 1);
    return { held, mult: 1 + o.accelBoost * k };
  }

  /** Right stick -> yaw/pitch rates (rad/s). Three.js yaw: positive turns left, so stick right = negative. */
  function processStickLook(rx, ry, st, dt, o) {
    const dz = radialDeadzone(rx, ry, o.deadzone, o.outer || 0.95);
    const next = lookAccelStep(st, dz.m, dt, o);
    st.held = next.held; st.mult = next.mult;
    if (dz.m === 0) return { yawRate: 0, pitchRate: 0, mag: 0 };
    const curved = (o.inner != null ? blendCurve(dz.m, o.inner, o.curve) : responseCurve(dz.m, o.curve)) / dz.m;
    const x = dz.x * curved, y = dz.y * curved;
    return {
      yawRate: -x * o.yawSpeed * next.mult,
      pitchRate: (o.invertY ? y : -y) * o.pitchSpeed * Math.min(next.mult, 1.3),
      mag: dz.m,
    };
  }

  /**
   * Look tuning per controller. A phone touch stick is short-throw (the thumb hits the rim with a
   * tiny move), so it gets a slower top speed, no look acceleration and light smoothing. Real
   * sticks keep the console-style profile.
   *
   * Phone stick, tuned on a real Pad-mode session: the phone sends nothing until the thumb is 12%
   * out (its own engage dead zone), so ours sits just under that and the turn starts from a crawl
   * the moment the stick engages. Most aim strokes stayed under half tilt, so the curve is
   * two-zone: a linear share keeps 0.2-0.5 tilt at 10-40 deg/s (the old pure 2.4 power curve gave
   * 2-25), the cubic part reaches the same top speed at the rim. The curve slider sets the linear
   * share (default 1.8 -> 0.45; more curve = slower centre). Smoothing is time-based so it lags the
   * same at 24 fps as at 60.
   */
  const PHONE_ENGAGE = 0.12;
  function lookProfile(kind, o) {
    const s = o.padSens;
    const base = { outer: 0.95, invertY: o.invertY, accelThreshold: 0.88, accelDelay: 0.12, accelRamp: 0.35 };
    if (kind === 'mimic') return Object.assign(base, {
      deadzone: o.deadzone > PHONE_ENGAGE ? o.deadzone : 0.1,
      inner: clamp(1.26 - 0.45 * o.curve, 0.15, 0.85), curve: 3,
      yawSpeed: 2.4 * s, pitchSpeed: 1.6 * s, accelBoost: 0, smooth: 1, smoothTau: 0.03,
    });
    return Object.assign(base, {
      deadzone: o.deadzone, curve: o.curve, yawSpeed: 3.6 * s, pitchSpeed: 2.4 * s,
      accelBoost: o.accel ? 0.75 : 0, smooth: 0,
    });
  }
  /** Exponential smoothing of look rates (per frame); st holds the running values. */
  function smoothLook(st, yaw, pitch, a) {
    st.y += (yaw - st.y) * a; st.p += (pitch - st.p) * a;
    return { yaw: st.y, pitch: st.p };
  }
  /** Per-frame smoothing factor for a time constant tau (s), so smoothing is frame-rate independent. */
  function smoothAlpha(dt, tau) {
    return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
  }

  /**
   * The on-screen key guide. device 'pad' (names match the phone's Pad buttons) or 'kbm';
   * phase 'buy' | 'live' | 'post' | 'dead'. Rows: [key, what it does, 'hot'?]. During the buy
   * phase the shop comes first and is highlighted.
   */
  function guide(device, phase) {
    const pad = device === 'pad', buy = phase === 'buy';
    if (phase === 'gull') {
      // after death the player flies as a gull (gull.js): same sticks, new verbs
      return {
        goal: 'You are a gull: spot enemies for your team',
        rows: pad ? [
          ['R2', 'Dive at an enemy to blind them', 'hot'], ['Left stick', 'Fly'], ['Right stick', 'Look'],
          ['A', 'Climb'], ['B', 'Sink'], ['SELECT', 'Hold for scores'], ['START', 'Pause'], ['HOME', 'Hide this guide'],
        ] : [
          ['Left click', 'Dive at an enemy to blind them', 'hot'], ['WASD', 'Fly'], ['Mouse', 'Look'],
          ['Space', 'Climb'], ['Ctrl / C', 'Sink'], ['Tab', 'Hold for scores'], ['Esc', 'Pause'], ['H', 'Hide this guide'],
        ],
      };
    }
    const shop = pad ? 'SELECT' : 'B';
    const rows = pad ? [
      ['Left stick', 'Move (tilt part-way to walk quietly)'], ['Right stick', 'Look and aim'],
      ['R2', 'Fire'], ['L2', 'Aim down sights'], ['X', 'Reload'], ['Y / R1 / L1', 'Switch weapon'],
      ['A', 'Jump'], ['B', 'Crouch'], ['SELECT', 'Hold for scores'], ['START', 'Pause'], ['HOME', 'Hide this guide'],
    ] : [
      ['WASD', 'Move (Shift walks quietly)'], ['Mouse', 'Look and aim'],
      ['Left click', 'Fire'], ['Right click', 'Aim down sights'], ['R', 'Reload'], ['Q / wheel / 1 2', 'Switch weapon'],
      ['Space', 'Jump'], ['Ctrl / C', 'Crouch'], ['B', 'Shop (buy time only)'], ['Tab', 'Hold for scores'], ['Esc', 'Pause'], ['H', 'Hide this guide'],
    ];
    if (buy) {
      const i = rows.findIndex(r => r[0] === shop);
      if (i >= 0) rows.splice(i, 1);
      rows.unshift([shop, 'Open the shop: buy a gun and armour', 'hot']);
    }
    const goal = buy ? 'Buy time: open the shop and gear up'
      : phase === 'dead' ? 'You are out: your gull rises in a moment'
      : phase === 'post' ? 'Round over' : 'Take out the other team';
    return { goal, rows };
  }

  const api = { playPads, padsFor, mergePadStates, guide, lookProfile, smoothLook, smoothAlpha, blendCurve, PAD_LAYOUTS, ACTIONS, PAD_BUTTON_NAMES, classifyPad, pickPad, decodeHat, readPad, radialDeadzone, responseCurve, createLookState, lookAccelStep, processStickLook };

  // ---------------------------------------------------------------- browser side

  if (typeof window !== 'undefined') {
    class InputManager {
      /**
       * source: 'auto' (keyboard, mouse and the best pad: the solo game), 'all' (keyboard and every
       * pad merged: menus) or { kbm: bool, pad: gamepad index | null } (one split-screen player).
       */
      constructor(target, source = 'auto') {
        this.target = target;
        this.source = source;
        this.useKbm = source === 'auto' || source === 'all' || !!(source && source.kbm);
        this.padPressed = {};
        this.keys = {};          // code -> held
        this.pressedKeys = {};   // code -> pressed since last update
        this.mouseDX = 0; this.mouseDY = 0;
        this.locked = false;
        this.pad = null; this.padState = null; this.padKind = null;
        this.prevPadButtons = {};
        this.lastDevice = 'kbm';
        this.lookState = createLookState();
        this.opts = { mouseSens: 1, padSens: 1, invertY: false, deadzone: 0.12, moveDeadzone: 0.15, curve: 1.8, accel: true };
        this.menuRepeat = { dir: null, t: 0 };
        this.frame = this._emptyFrame();
        this._install();
      }

      _emptyFrame() {
        const f = { moveX: 0, moveY: 0, moveMag: 0, lookYaw: 0, lookPitch: 0, padYaw: 0, padPitch: 0, padLookMag: 0, held: {}, pressed: {} };
        Object.keys(ACTIONS).forEach(a => { f.held[a] = false; f.pressed[a] = false; });
        return f;
      }

      _install() {
        const down = code => { if (!this.useKbm) return; if (!this.keys[code]) this.pressedKeys[code] = true; this.keys[code] = true; this.lastDevice = 'kbm'; };
        const up = code => { this.keys[code] = false; };
        addEventListener('keydown', e => {
          if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(e.code) || (e.ctrlKey && e.code !== 'ControlLeft')) e.preventDefault();
          down(e.code);
        });
        addEventListener('keyup', e => up(e.code));
        addEventListener('mousedown', e => { down('Mouse' + e.button); });
        addEventListener('mouseup', e => up('Mouse' + e.button));
        addEventListener('contextmenu', e => e.preventDefault());
        addEventListener('wheel', e => { down(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'); setTimeout(() => up(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'), 0); }, { passive: true });
        addEventListener('mousemove', e => {
          if (!this.locked || !this.useKbm) return;
          // ignore the occasional huge jump Chrome emits when the lock engages
          if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
          this.mouseDX += e.movementX; this.mouseDY += e.movementY;
          this.lastDevice = 'kbm';
        });
        addEventListener('blur', () => { this.keys = {}; });
        document.addEventListener('pointerlockchange', () => {
          this.locked = document.pointerLockElement === this.target;
          if (this.onLockChange) this.onLockChange(this.locked);
        });
      }

      lock() {
        if (this.locked || !this.target.requestPointerLock) return;
        try { const p = this.target.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed now */ }
      }
      unlock() { if (document.exitPointerLock && this.locked) document.exitPointerLock(); }

      padInfo() {
        const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        return list.filter(Boolean).map(p => ({ index: p.index, id: p.id, kind: classifyPad(p), mapping: p.mapping, buttons: p.buttons.map(b => b.pressed ? 1 : +(b.value || 0).toFixed(2)), axes: Array.from(p.axes) }));
      }

      update(dt) {
        const f = this._emptyFrame();
        const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
        const pads = padsFor(this.source, list);
        this.pad = pads[0] || null;
        this.padKind = this.pad ? classifyPad(this.pad) : null;
        // each pad keeps its own previous buttons so a press is seen once, however the pads merge
        const states = pads.map(gp => readPad(gp));
        const padPressed = {};
        const prev = this.prevPadButtons, next = {};
        states.forEach((st, i) => {
          const key = pads[i].index, was = prev[key] || {};
          PAD_BUTTON_NAMES.forEach(n => { if (st.buttons[n] && !was[n]) padPressed[n] = true; });
          next[key] = Object.assign({}, st.buttons);
        });
        this.prevPadButtons = next;
        this.padPressed = padPressed;
        this.padState = mergePadStates(states);
        const ps = this.padState;
        if (ps) {
          const any = PAD_BUTTON_NAMES.some(n => n !== 'home' && ps.buttons[n]) || Math.hypot(ps.lx, ps.ly) > 0.3 || Math.hypot(ps.rx, ps.ry) > 0.3;
          if (any) this.lastDevice = 'pad';
        }
        if (!this.useKbm) { this.keys = {}; this.pressedKeys = {}; this.mouseDX = 0; this.mouseDY = 0; this.lastDevice = 'pad'; }
        this.keysPressed = this.pressedKeys;

        for (const [name, b] of Object.entries(ACTIONS)) {
          let held = b.keys.some(k => this.keys[k]);
          let pressed = b.keys.some(k => this.pressedKeys[k]);
          if (ps) {
            held = held || b.pad.some(p => ps.buttons[p === 'lt' ? 'l2' : p === 'rt' ? 'r2' : p]);
            pressed = pressed || b.pad.some(p => padPressed[p === 'lt' ? 'l2' : p === 'rt' ? 'r2' : p]);
          }
          f.held[name] = held; f.pressed[name] = pressed;
        }

        // movement: keys + left stick (radial dead zone; partial tilt = quiet walk)
        let mx = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
        let my = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
        let mag = Math.hypot(mx, my);
        if (mag > 0) { mx /= mag; my /= mag; mag = 1; }
        if (ps) {
          const dz = radialDeadzone(ps.lx, ps.ly, this.opts.moveDeadzone, 0.92);
          if (dz.m > mag) { mx = dz.x; my = -dz.y; mag = dz.m; }
        }
        f.moveX = mx; f.moveY = my; f.moveMag = mag;

        // look: mouse (radians) + right stick (rates * dt, sensitivity scaled)
        const ms = 0.0022 * this.opts.mouseSens;
        f.lookYaw = -this.mouseDX * ms;
        f.lookPitch = -this.mouseDY * ms * (this.opts.invertY ? -1 : 1);
        this.mouseDX = 0; this.mouseDY = 0;
        if (ps) {
          const prof = lookProfile(this.padKind, this.opts);
          const r = processStickLook(ps.rx, ps.ry, this.lookState, dt, prof);
          let yawR = r.yawRate, pitchR = r.pitchRate;
          if (prof.smooth > 0) {
            this.lookSmooth = this.lookSmooth || { y: 0, p: 0 };
            const a = prof.smoothTau != null ? smoothAlpha(dt, prof.smoothTau) : prof.smooth;
            const sm = smoothLook(this.lookSmooth, yawR, pitchR, a);
            yawR = sm.yaw; pitchR = sm.pitch;
          }
          f.padYaw = yawR * dt; f.padPitch = pitchR * dt; f.padLookMag = r.mag;
        }

        // menu navigation with stick repeat
        if (ps) {
          const dz = radialDeadzone(ps.lx, ps.ly, 0.5, 1);
          let dir = null;
          if (dz.m > 0) dir = Math.abs(dz.x) > Math.abs(dz.y) ? (dz.x > 0 ? 'menuRight' : 'menuLeft') : (dz.y > 0 ? 'menuDown' : 'menuUp');
          ['menuUp', 'menuDown', 'menuLeft', 'menuRight'].forEach(d => { if (f.held[d]) dir = dir || d; });
          const r = this.menuRepeat;
          if (dir && dir !== r.dir) { f.pressed[dir] = true; r.dir = dir; r.t = 0.38; }
          else if (dir) { r.t -= dt; if (r.t <= 0) { f.pressed[dir] = true; r.t = 0.12; } }
          else r.dir = null;
        }

        this.pressedKeys = {};
        this.frame = f;
        return f;
      }
    }
    api.InputManager = InputManager;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaInput = api;
})(typeof window !== 'undefined' ? window : this);
