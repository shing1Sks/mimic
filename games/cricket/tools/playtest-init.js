// Willowlight playtest: up to two fake Mimic phones in Grip mode (Gamepad API), loaded as a
// Playwright init script (see playtest.py). Each phone plays like a person: a bowler points to
// aim, holds HOLD, runs in and swings the arm over, letting go near the top (with human timing
// noise); a batter stands with the bat down and swings so its fastest moment meets the ball.
//
// The pad reports axes 0..2 = orientation quaternion x, y, z in the PHONE frame, 3..5 = acceleration
// incl. gravity / 8 g, and hides Grip's mode code (0x6) in the lowest bit of axes 0..3 (mimic.js).
(function () {
  'use strict';
  const S = Math.SQRT1_2, C = { x: -S, y: 0, z: 0, w: S }, Ci = { x: S, y: 0, z: 0, w: S };
  const mul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
  const norm = q => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };
  const aa = (x, y, z, a) => { const l = Math.hypot(x, y, z) || 1, s = Math.sin(a / 2) / l; return { x: x * s, y: y * s, z: z * s, w: Math.cos(a / 2) }; };
  const rot = (q, v) => { const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w }); return { x: p.x, y: p.y, z: p.z }; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const NAMES = ['a', 'b', 'one', 'two', 'minus', 'plus', 'home', 'up', 'down', 'left', 'right', 'center'];
  // the same poses as bowl.js armQuat and bat.js batQuat (world quaternions)
  const armQuat = (phi, yaw, rho) => norm(mul(mul(mul(aa(0, 1, 0, -(yaw || 0)), aa(1, 0, 0, Math.PI / 2 - phi)), aa(0, 0, 1, Math.PI)), aa(0, 0, -1, rho || 0)));
  function batQuat(theta, dir, plane, lift, sweep) {
    if (plane === 'flat') return norm(mul(aa(0, 1, 0, (sweep || 1) * theta - (dir || 0)), aa(1, 0, 0, lift || 0)));
    return norm(mul(mul(aa(0, 1, 0, -(dir || 0)), aa(1, 0, 0, lift || 0)), aa(1, 0, 0, -Math.PI / 2 + theta)));
  }

  function makePhone(index, web) {
    const P = {
      index, on: true, q: batQuat(0, 0, 'vertical'), buttons: new Array(12).fill(false), prog: null, log: [], n: 0,
      // autoplay: 'bat' | 'bowl' | null; timing noise (s); arm speed (rad/s); seam / wrist settings
      auto: null, timing: 0.03, arm: [16, 24], spinChance: 0.3, lofted: 0.25, busy: false,
      pad: { index, id: web ? 'Mimic Web Android (Vendor: 038f Product: 1200)' : 'Mimic (Vendor: 038f Product: 1200)', connected: true, mapping: '', timestamp: 0,
        axes: [0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })) },
    };
    P.press = (name, ms) => { const i = NAMES.indexOf(name); P.buttons[i] = true; setTimeout(() => { P.buttons[i] = false; }, ms || 300); };
    P.hold = (name, v) => { P.buttons[NAMES.indexOf(name)] = v; };
    P.sample = () => {
      const now = performance.now();
      if (P.prog) P.prog(now);
      let p = mul(mul(Ci, P.q), C);
      if (p.w < 0) p = { x: -p.x, y: -p.y, z: -p.z, w: -p.w };
      const g = rot({ x: -P.q.x, y: -P.q.y, z: -P.q.z, w: P.q.w }, { x: 0, y: 9.80665, z: 0 });
      const ga = rot(Ci, g);
      const ints = [p.x, p.y, p.z, ga.x / 78.45, ga.y / 78.45, ga.z / 78.45].map(v => Math.round(v * 32767));
      ints[5] += (P.n++ % 7) - 3;          // a real phone's numbers never repeat exactly
      const bits = 0x6;                   // Grip's mode code, tag 0
      for (let i = 0; i < 6; i++) { const want = (bits >> i) & 1; if ((ints[i] & 1) !== want) ints[i] += ints[i] > 0 ? -1 : 1; }
      P.pad.axes = ints.map(v => v / 32767);
      P.pad.buttons = P.buttons.map(b => ({ pressed: b, touched: b, value: b ? 1 : 0 }));
      P.pad.timestamp = now;
      return P.pad;
    };
    /** Point to aim, hold HOLD, run in, arm over the top; let go at the ideal moment + noise. */
    P.bowl = function (o) {
      o = Object.assign({ peakW: 20, yaw: 0, rho0: 0, twist: 0, upOffset: 0, aimElev: -15, aimHead: 0, runMs: 1100 }, o);
      const A = 2.4, tau = A / o.peakW, t0 = performance.now();
      const tAim = t0 + 700, tPress = tAim, tVert = tPress + o.runMs;
      // a person lets go a little before the whip peaks (the arm passing straight up at tVert)
      const tUp = tVert - 30 + o.upOffset;
      P.busy = true;
      P.log.push({ k: 'bowl', o });
      return new Promise(res => {
        P.prog = now => {
          if (now < tAim) {   // aiming: the phone pointed at the far end, a little down
            P.q = norm(mul(aa(0, 1, 0, -o.aimHead * Math.PI / 180), aa(1, 0, 0, o.aimElev * Math.PI / 180)));
            return;
          }
          const k = (now - tVert) / 1000 / tau;
          P.hold('a', now < tUp);
          P.q = armQuat(A * Math.tanh(k), o.yaw, o.rho0 + o.twist * tau * Math.tanh(k));
          if (now > tUp + 900) { P.prog = null; P.busy = false; P.q = armQuat(-2.4, 0, 0); res(); }
        };
      });
    };
    /** A bat swing whose fastest moment comes at tPeak (performance.now() ms). */
    P.swing = function (o) {
      o = Object.assign({ peakW: 18, dir: 0, thetaPeak: 0, plane: 'vertical', sweep: 1, lift: 0 }, o);
      const A = 2.2, tau = A / o.peakW;
      P.busy = true;
      P.log.push({ k: 'swing', o: Object.assign({}, o) });
      return new Promise(res => {
        P.prog = now => {
          const k = (now - o.tPeak) / 1000 / tau;
          if (k < -2.2) { P.q = batQuat(-A * 0.95 + o.thetaPeak, o.dir, o.plane, o.lift, o.sweep); return; }   // the backlift, held
          P.q = batQuat(o.thetaPeak + A * Math.tanh(k), o.dir, o.plane, o.lift, o.sweep);
          if (k > 4) { P.prog = null; P.busy = false; P.q = batQuat(0, 0, 'vertical'); res(); }
        };
      });
    };
    return P;
  }
  const phones = [makePhone(0, false), makePhone(1, false)];
  window.__phones = phones;
  navigator.getGamepads = () => phones.map(P => (P.on ? P.sample() : null));

  // autoplay: each phone looks at the game and does its job when its turn comes
  let scheduled = null;
  function tick() {
    requestAnimationFrame(tick);
    const T = window.__cricket;
    if (!T || !T.G.match || !T.G.inGame) return;
    const G = T.G, inn = T.inn();
    const role = i => (inn.bat === i ? 'bat' : 'bowl');
    phones.forEach((P, pi) => {
      // the seat this phone sat in (seats follow the order phones joined, not their index)
      const i = T.seats.findIndex(s => s.kind === 'phone' && s.mc && s.mc.slot === pi);
      if (!P.on || P.auto !== 'play' || i < 0) return;
      if (role(i) === 'bowl' && G.phase === 'ready' && !P.busy && G.phaseT > 0.8 && G.screen === 'game') {
        const spin = Math.random() < P.spinChance;
        P.bowl({ peakW: spin ? 12 + Math.random() * 3 : P.arm[0] + Math.random() * (P.arm[1] - P.arm[0]), yaw: gauss() * 0.06, rho0: spin ? 0 : gauss() * 0.3,
          twist: spin ? (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 10) : 0, upOffset: gauss() * 18, aimElev: P.aimElev != null ? P.aimElev : -12 - Math.random() * 8, aimHead: P.aimElev != null ? 0 : gauss() * 3 });
      }
      if (role(i) === 'bat' && G.phase === 'flight' && G.path && !P.busy && scheduled !== G.path) {
        scheduled = G.path;
        const h = G.path.heightAtBat, x = G.path.atContact.x;
        const tArr = performance.now() + (G.path.atContact.t - G.t) * 1000;
        // no Bluetooth here: be as late as the game's SWING DELAY FIX expects a real phone to be
        const tPeak = tArr + [0, 30, 60, 90, 120][T.settings.lag] + gauss() * P.timing * 1000;
        if (Math.abs(x) > 0.75 && Math.random() < 0.6) return;               // leave it
        if (h > 0.95) P.swing({ tPeak, plane: 'flat', sweep: 1, peakW: 15 + Math.random() * 4, dir: gauss() * 0.3 });
        else P.swing({ tPeak, dir: (x > 0.15 ? 0.5 : x < -0.1 ? -0.4 : 0) + gauss() * 0.25, thetaPeak: Math.random() < P.lofted ? 0.35 : 0, peakW: 14 + Math.random() * 7 });
      }
    });
  }
  requestAnimationFrame(tick);
})();
