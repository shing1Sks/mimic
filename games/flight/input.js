/*
 * GYROWING input: turns the phone (Mimic Wand), a Mimic Pad, any standard gamepad and the
 * keyboard into flight controls and one-shot actions.
 *
 * "The phone is the plane": hold it flat, screen up, top pointing at the monitor. Its attitude,
 * relative to the neutral captured on Center, deflects the controls like a yoke (position
 * control with dead zone, expo and sensitivity): tilt the nose down/up for pitch, bank for roll,
 * twist for rudder. The aircraft responds to the deflection; it is not slaved to the phone.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const DEG = Math.PI / 180;

  /** Stick shaping: normalise by full-scale, dead zone, expo blend. */
  function shape(v, full, dz, expo) {
    let n = clamp(v / full, -1, 1);
    const a = Math.abs(n);
    if (a < dz) return 0;
    n = Math.sign(n) * (a - dz) / (1 - dz);
    return n * (1 - expo) + n * n * n * expo;
  }

  const KEY_ACTIONS = {
    KeyF: 'flapsDown', KeyV: 'flapsUp', KeyG: 'gear', KeyC: 'camera', Escape: 'pause', KeyP: 'pause',
    Enter: 'confirm', NumpadEnter: 'confirm', Backspace: 'back', KeyH: 'legend', KeyR: 'restart', KeyT: 'timeSkip', Digit1: 'rollKey', Digit2: 'loop',
  };
  const NAV_KEYS = { ArrowUp: 'navUp', ArrowDown: 'navDown', ArrowLeft: 'navLeft', ArrowRight: 'navRight', KeyW: 'navUp', KeyS: 'navDown', KeyA: 'navLeft', KeyD: 'navRight' };

  class FlightInput {
    constructor(mc, settings) {
      this.mc = mc;
      this.settings = settings;          // live object: sens, expo, invert, twist
      this.keys = Object.create(null);
      this.queue = [];
      this.throttle = 0;
      this.trim = 0;
      this.kb = { elevator: 0, aileron: 0, rudder: 0 };
      this.wandRudder = 0;
      this.neutral = { pitch: 0, roll: 0, yaw: 0 };
      this.recenterAt = 0; this.time = 0;
      this.phone = { pitch: 0, roll: 0, yaw: 0, active: false, calibrated: false };
      this.out = { elevator: 0, aileron: 0, rudder: 0, brake: 0 };
      this.lastSource = 'keyboard';
      this.padState = new Map();
      this.aHold = { wand: -1 };
      this.wheel = 0;
      addEventListener('keydown', e => {
        if (e.target && e.target.tagName === 'INPUT') return;   // typing an airport code is not flying
        if (e.repeat) { if (this._blockKey(e.code)) e.preventDefault(); return; }
        this.keys[e.code] = true;
        this.lastSource = 'keyboard';
        const a = KEY_ACTIONS[e.code]; if (a) this.queue.push(a);
        const n = NAV_KEYS[e.code]; if (n) this.queue.push(n);
        if (e.code === 'Space') this.queue.push('confirmSoft');
        if (this._blockKey(e.code)) e.preventDefault();
      });
      addEventListener('keyup', e => { this.keys[e.code] = false; });
      addEventListener('blur', () => { this.keys = Object.create(null); });
      addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    }
    _blockKey(c) { return /^(Arrow|Space|Page|Tab|Backspace|Bracket)/.test(c); }
    k(...codes) { for (const c of codes) if (this.keys[c]) return true; return false; }

    /** Capture the phone's current attitude as neutral (after it has applied its own reset). */
    recenter() { this.recenterAt = this.time + 0.15; }

    /** Read every source. Returns { elevator, aileron, rudder, brake, actions: Set, throttle, trim }. */
    update(dt, flying) {
      this.time += dt;
      const S = this.settings;
      const actions = new Set(this.queue); this.queue.length = 0;
      let elev = 0, ail = 0, rud = 0, brake = 0, thrRate = 0, trimRate = 0;

      // ---------------- keyboard
      const kbT = { elevator: (this.k('KeyS', 'ArrowDown') ? 1 : 0) - (this.k('KeyW', 'ArrowUp') ? 1 : 0),
        aileron: (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0),
        rudder: (this.k('KeyE', 'KeyX') ? 1 : 0) - (this.k('KeyQ', 'KeyZ') ? 1 : 0) };
      for (const ax of ['elevator', 'aileron', 'rudder']) {
        const tgt = kbT[ax], cur = this.kb[ax];
        const rate = tgt === 0 ? 4 : (Math.sign(tgt) !== Math.sign(cur) && cur !== 0 ? 6 : (ax === 'rudder' ? 1.6 : 2.2));
        this.kb[ax] = cur + clamp(tgt - cur, -rate * dt, rate * dt);
      }
      elev += this.kb.elevator * (S.invert ? -1 : 1); ail += this.kb.aileron; rud += this.kb.rudder;
      // stunts on the keyboard are keys (1 roll, toward A or D if held; 2 loop): a double tap of a
      // key is how keyboard pilots make small corrections, so flicks are for sticks only
      if (actions.delete('rollKey')) actions.add(kbT.aileron < 0 ? 'rollLeft' : 'rollRight');
      let rawAil = 0, rawElev = 0;
      if (this.k('ShiftLeft', 'ShiftRight', 'PageUp', 'Equal', 'NumpadAdd')) thrRate += 0.6;
      if (this.k('ControlLeft', 'ControlRight', 'PageDown', 'Minus', 'NumpadSubtract')) thrRate -= 0.6;
      if (this.k('BracketRight', 'End')) trimRate += 0.25;
      if (this.k('BracketLeft', 'Home')) trimRate -= 0.25;
      if (this.k('Space', 'KeyB')) brake = 1;

      // ---------------- phone: Gyrowing is flown with the Mimic Pad (or keyboard / any gamepad).
      // Tilt-flying with the Wand felt awkward in play, so the Wand is not used here.
      this.phone.active = false;

      // ---------------- gamepads (Mimic Pad + standard), never the Wand
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        if (p.buttons.length === 12 && p.axes.length >= 6) continue;           // the Wand
        if (/mimic/i.test(p.id) && p.buttons.length < 16) continue;
        const mimicPad = /mimic/i.test(p.id) && p.buttons.length >= 16;
        if (!mimicPad && p.mapping !== 'standard' && p.buttons.length < 10) continue;
        let st = this.padState.get(p.index);
        if (!st) { st = { prev: [], trigRest: [false, false], aHold: -1 }; this.padState.set(p.index, st); }
        const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
        const bp = i => b(i) && !st.prev[i];
        const ax = i => (p.axes[i] === undefined ? 0 : p.axes[i]);
        const lx = ax(0), ly = ax(1), rx = ax(2);
        let l2, r2;
        if (mimicPad) {
          const a3 = ax(3), a4 = ax(4);
          if (a3 <= -0.98) st.trigRest[0] = true; if (a4 <= -0.98) st.trigRest[1] = true;
          l2 = st.trigRest[0] ? clamp((a3 + 1) / 2, 0, 1) : 0; r2 = st.trigRest[1] ? clamp((a4 + 1) / 2, 0, 1) : 0;
        } else {
          l2 = p.buttons[6] ? p.buttons[6].value : 0; r2 = p.buttons[7] ? p.buttons[7].value : 0;
        }
        const sf = 1 / (S.sens || 1);   // stick sensitivity: above 1x, full deflection before the stick's end
        const se = shape(ly, sf, 0.08, S.expo) * (S.invert ? -1 : 1);
        const sa = shape(lx, sf, 0.08, S.expo);
        const sr = shape(rx, 1, 0.12, S.expo * 0.5);
        elev += se; ail += sa; rud += sr;
        if (Math.abs(sa) > Math.abs(rawAil)) rawAil = sa;
        if (Math.abs(se) > Math.abs(rawElev)) rawElev = se;
        thrRate += (r2 - l2) * 0.9;
        // A and B: "go" and "slow" (the user's recording: A pressed seven times in flight expecting
        // power, which used to lower the flaps a notch each time). B also brakes on the ground.
        // A only counts once it has been let go after the menu press that started the flight.
        if (!b(0)) st.aArmed = true;
        if (b(0) && st.aArmed && flying) thrRate += 0.9;
        if (b(1) && flying) thrRate -= 0.9;
        // D-pad: standard pads use buttons 12-15; the Mimic Pad sends a hat on axis 9 (and its
        // button 12 is Home, not a direction)
        const hd = mimicPad ? hatDirs(p.axes[9]) : { up: b(12), down: b(13), left: b(14), right: b(15) };
        // what the hand is doing, raw, for the on-screen controller guide (guide.js)
        if (Math.abs(lx) + Math.abs(ly) > 0.05 || l2 > 0.05 || r2 > 0.05 || p.buttons.some(x => x.pressed) || !this.raw || this.raw.index === p.index)
          this.raw = { index: p.index, lx, ly, rx, l2, r2, a: b(0), b: b(1), x: b(2), y: b(3), l1: b(4), r1: b(5), hat: hd, t: this.time };
        const ph = st.prevHat || {};
        if (hd.up) thrRate += 0.45;
        if (hd.down) thrRate -= 0.45;
        if (b(1)) brake = Math.max(brake, 1);
        if (b(4)) trimRate -= 0.25;
        if (b(5)) trimRate += 0.25;
        if (bp(0)) actions.add('confirm');
        if (bp(1)) actions.add('back');
        if (bp(2)) actions.add('gear');
        if (bp(3)) actions.add('camera');
        if (bp(9)) actions.add('pause');
        if (bp(8)) actions.add('center');
        if (hd.up && !ph.up) actions.add('navUp');
        if (hd.down && !ph.down) actions.add('navDown');
        if (hd.left && !ph.left) { actions.add('navLeft'); if (flying) actions.add('flapsUp'); }
        if (hd.right && !ph.right) { actions.add('navRight'); if (flying) actions.add('flapsDown'); }
        st.prevHat = hd;
        // stick flicks navigate menus
        const ny = ly < -0.6 ? -1 : ly > 0.6 ? 1 : 0, nx = lx < -0.6 ? -1 : lx > 0.6 ? 1 : 0;
        if (ny !== (st.ny || 0) && ny) actions.add(ny < 0 ? 'navUp' : 'navDown');
        if (nx !== (st.nx || 0) && nx) actions.add(nx < 0 ? 'navLeft' : 'navRight');
        st.ny = ny; st.nx = nx;
        if (Math.abs(lx) + Math.abs(ly) > 0.3 || p.buttons.some(x => x.pressed)) this.lastSource = mimicPad ? 'Mimic Pad' : 'gamepad';
        st.prev = p.buttons.map(x => x.pressed);
      }

      // ---------------- stunt flicks: two quick full deflections of a stick the same way
      if (flying) {
        const f = this.flick || (this.flick = new Flick());
        const g = f.update(dt, rawAil, rawElev);
        if (g.roll) actions.add(g.roll > 0 ? 'rollRight' : 'rollLeft');
        if (g.loop > 0) actions.add('loop');
      }

      // ---------------- integrate throttle/trim, mix
      this.throttle = clamp(this.throttle + thrRate * dt, 0, 1);
      this.trim = clamp(this.trim + trimRate * dt, -1, 1);
      if (this.wheel) { actions.add(this.wheel > 0 ? 'zoomOut' : 'zoomIn'); this.wheel = 0; }
      const out = this.out;
      out.elevator = clamp(elev, -1, 1); out.aileron = clamp(ail, -1, 1); out.rudder = clamp(rud, -1, 1); out.brake = brake;
      out.actions = actions; out.throttle = this.throttle; out.trim = this.trim; out.trimming = trimRate !== 0;
      return out;
    }

    /** Forget button presses in progress (a menu-confirming A must not become a flap tap on release). */
    resetHolds() {
      this.aHold.wand = this.aHold.wand > 0 ? 0 : -1;
      this.padState.forEach(st => { st.aHold = st.aHold > 0 ? 0 : -1; st.aArmed = false; });
      this.queue.length = 0;
    }

  }

  /**
   * The Mimic Pad's D-pad arrives as a hat switch on axis 9 (Chrome: -1 + 2/7 * direction,
   * 0 = up, clockwise; > 1 or missing = centred). Returns which of the four keys are held.
   */
  function hatDirs(v) {
    const none = { up: false, right: false, down: false, left: false };
    if (typeof v !== 'number' || !isFinite(v) || v > 1.05 || v < -1.05) return none;
    const i = ((Math.round((v + 1) * 3.5) % 8) + 8) % 8;
    return { up: i === 7 || i <= 1, right: i >= 1 && i <= 3, down: i >= 3 && i <= 5, left: i >= 5 && i <= 7 };
  }

  // ---------------------------------------------------------------- phone attitude (pure)
  function qrot(q, v) {
    const ux = q.x, uy = q.y, uz = q.z;
    const tx = 2 * (uy * v.z - uz * v.y), ty = 2 * (uz * v.x - ux * v.z), tz = 2 * (ux * v.y - uy * v.x);
    return { x: v.x + q.w * tx + (uy * tz - uz * ty), y: v.y + q.w * ty + (uz * tx - ux * tz), z: v.z + q.w * tz + (ux * ty - uy * tx) };
  }
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  /** Gravity-referenced pitch, roll (+ = right side up) and yaw (+ = top left) of a world quaternion. */
  function phoneAttitude(q) {
    const f = qrot(q, { x: 0, y: 0, z: -1 }), r = qrot(q, { x: 1, y: 0, z: 0 }), u = qrot(q, { x: 0, y: 1, z: 0 });
    return { pitch: Math.asin(clamp(f.y, -1, 1)), roll: Math.atan2(r.y, u.y), yaw: Math.atan2(-f.x, -f.z) };
  }
  /** Tilt relative to the neutral pose. Pitch and roll depend only on gravity, never on heading. */
  function relative(a, n) { return { pitch: a.pitch - n.pitch, roll: wrap(a.roll - n.roll), yaw: wrap(a.yaw - n.yaw) }; }
  /** Move a neutral angle toward the current one with time constant tau (s). */
  function washout(n, cur, dt, tau) { return n + wrap(cur - n) * (1 - Math.exp(-dt / tau)); }
  function fromEuler(yaw, pitch, roll) {   // 'YXZ', like three.js
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    const m = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
    return m(m({ x: 0, y: sy, z: 0, w: cy }, { x: sp, y: 0, z: 0, w: cp }), { x: 0, y: 0, z: sr, w: cr });
  }

  /**
   * Stunt gesture: a double flick of an axis to full (out, back under half, out again the same way
   * within `win` s). A held stick or key never fires, so a long turn stays a turn.
   */
  function Flick(win) { this.win = win || 0.35; this.t = 0; this.ax = { a: 0, at: -9, dir: 0 }; this.el = { a: 0, at: -9, dir: 0 }; }
  Flick.prototype.axis = function (st, v) {
    const dir = v > 0.9 ? 1 : v < -0.9 ? -1 : 0;
    let fired = 0;
    if (dir && !st.a) {
      if (st.dir === dir && this.t - st.at < this.win) { fired = dir; st.at = -9; } else st.at = this.t;
      st.dir = dir; st.a = 1;
    } else if (!dir && Math.abs(v) < 0.3) st.a = 0;
    return fired;
  };
  Flick.prototype.update = function (dt, ail, elev) { this.t += dt; return { roll: this.axis(this.ax, ail), loop: this.axis(this.el, elev) }; };

  window.FlightInputFlick = Flick;
  window.FlightInputPhone = { attitude: phoneAttitude, relative, washout, fromEuler };
  window.FlightInput = FlightInput;
  window.FlightInputHat = hatDirs;
  window.FlightInputShape = shape;
})();
