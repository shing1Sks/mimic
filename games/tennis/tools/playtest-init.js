// Sunvolley playtest: up to two fake Mimic Wands (Gamepad API) that play like people: they take
// the racket back, swing through on time (with human timing noise), aim with the hand, toss and
// serve. Loaded as a Playwright init script (see playtest.py).
//
// The Wand reports axes 0..2 = orientation quaternion x, y, z in the PHONE frame and 3..5 =
// acceleration incl. gravity in the phone frame / 8 g (games/lib/mimic.js). Each wand keeps a
// pose in its player's own frame (yaw, pitch, roll, three.js 'YXZ') plus the hand's linear
// acceleration, and converts both back.
(function () {
  'use strict';
  const S = Math.SQRT1_2, C = { x: -S, y: 0, z: 0, w: S }, Ci = { x: S, y: 0, z: 0, w: S };
  const G0 = 9.80665;
  function mul(a, b) {
    return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
  }
  function rot(q, v) { const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w }); return { x: p.x, y: p.y, z: p.z }; }
  function euler(yaw, pitch, roll) {
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    return mul(mul({ x: 0, y: sy, z: 0, w: cy }, { x: sp, y: 0, z: 0, w: cp }), { x: 0, y: 0, z: sr, w: cr });
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sstep = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const NAMES = ['a', 'b', 'one', 'two', 'minus', 'plus', 'home', 'up', 'down', 'left', 'right', 'center'];

  function makeWand(index) {
    const W = {
      index, on: false, yaw: 0, pitch: 0, roll: -Math.PI / 2, acc: { x: 0, y: 0, z: 0 }, buttons: new Array(12).fill(false),
      prog: null, log: [], noise: 1, dYaw: 0, dPitch: 0,
      left: false,   // a left-handed player: the whole motion mirrored across the player's x axis
      // autoplay: which player (0 / 1) this wand plays for, timing noise (s), aim spread (rad), power range
      auto: null, timing: 0.03, aim: 0.25, power: [3.2, 4.6], busy: false, lastPlan: null, serveAt: 0,
    };
    W.press = (name, ms) => { const i = NAMES.indexOf(name); W.buttons[i] = true; setTimeout(() => { W.buttons[i] = false; }, ms || 90); };
    W.hold = (name, v) => { W.buttons[NAMES.indexOf(name)] = v; };
    /** Hand velocity pulse along dir (az + = right, lift) peaking at tPeak: returns world accel. */
    function handAccel(t, tPeak, speed, az, lift, sigma) {
      const tau = t - tPeak, e = Math.exp(-tau * tau / (2 * sigma * sigma));
      const a = -speed * tau / (sigma * sigma) * e;
      const d = { x: Math.sin(az), y: lift, z: -Math.cos(az) };
      return { x: d.x * a, y: d.y * a, z: d.z * a };
    }
    /** A groundstroke. side 'fh' | 'bh'. Peak (fastest moment) at `peakIn` s from now. */
    W.stroke = function (o) {
      o = Object.assign({ side: 'fh', peakIn: 0.2, dur: 0.3, speed: 4, az: 0, lift: 0.2 }, o);
      const start = performance.now() / 1000, tPeak = o.peakIn, t0 = tPeak - o.dur / 2;
      const y0 = o.side === 'fh' ? -1.75 : 1.75, y1 = o.side === 'fh' ? 1.1 : -1.1;
      W.busy = true;
      W.log.push({ k: 'stroke', side: o.side, az: o.az, speed: o.speed });
      return new Promise(res => {
        W.prog = now => {
          const t = now - start;
          if (t < t0) { W.yaw = y0; W.pitch = -0.15; W.acc = { x: 0, y: 0, z: 0 }; return; }
          const k = (t - t0) / o.dur;
          if (k <= 1) {
            const e = (1 - Math.cos(Math.PI * k)) / 2;           // fastest through the middle
            W.yaw = lerp(y0, y1, e); W.pitch = lerp(-0.25, 0.45, e);
            W.acc = handAccel(t, tPeak, o.speed, o.az, o.lift, 0.055);
            return;
          }
          if (k < 3) { const r = sstep((k - 1) / 2); W.yaw = lerp(y1, 0, r); W.pitch = lerp(0.45, 0, r); W.acc = handAccel(t, tPeak, o.speed, o.az, o.lift, 0.055); return; }
          W.prog = null; W.busy = false; W.yaw = 0; W.pitch = 0; W.acc = { x: 0, y: 0, z: 0 }; res();
        };
      });
    };
    /** Serve swing: racket from behind the head over the top and down, peak at `peakIn`. */
    W.serve = function (o) {
      o = Object.assign({ peakIn: 0.15, dur: 0.3, speed: 4, az: 0 }, o);
      const start = performance.now() / 1000, tPeak = o.peakIn, t0 = tPeak - o.dur / 2;
      W.busy = true;
      W.log.push({ k: 'serve', az: o.az, speed: o.speed });
      return new Promise(res => {
        W.prog = now => {
          const t = now - start;
          W.roll = 0;
          if (t < t0) { W.yaw = 0; W.pitch = 2.3; W.acc = { x: 0, y: 0, z: 0 }; return; }
          const k = (t - t0) / o.dur;
          if (k <= 1) { const e = (1 - Math.cos(Math.PI * k)) / 2; W.pitch = lerp(2.3, -0.7, e); W.acc = handAccel(t, tPeak, o.speed, o.az - 0.43, -0.15, 0.06); return; }
          if (k < 3) { W.pitch = lerp(-0.7, 0, sstep((k - 1) / 2)); W.acc = { x: 0, y: 0, z: 0 }; return; }
          W.prog = null; W.busy = false; W.roll = -Math.PI / 2; W.pitch = 0; W.acc = { x: 0, y: 0, z: 0 }; res();
        };
      });
    };

    // autoplay: reads the game's public test hook, plays like a person
    W.think = function (now) {
      const T = window.__sunvolley;
      if (W.auto === null || !T || W.busy) return;
      const G = T.G, ball = T.ball, h = T.H[W.auto];
      if (!G.inGame || G.paused || G.mode === 'ended' || !T.humans.includes(h)) return;
      const sv = G.practice ? 0 : G.server;
      if (G.mode === 'serve' && sv === W.auto) {
        if (!W.serveAt) W.serveAt = now + 0.8 + Math.random() * 0.6;
        if (now > W.serveAt) { W.serveAt = 0; W.press('a', 120); W.roll = 0; W.pitch = 2.3; }
        return;
      }
      W.serveAt = 0;
      if (G.mode === 'toss' && T.tossOwner === W.auto && ball.v.y < 1.6 && ball.v.y > 0) {
        const az = gauss() * W.aim * 0.6, speed = lerp(W.power[0], W.power[1], Math.random());
        W.serve({ peakIn: 0.12 + gauss() * W.timing, speed, az });
        return;
      }
      const plan = h.A.cplan;
      if (G.mode === 'rally' && plan && ball.lastHitter !== W.auto) {
        const dt = plan.t - G.t;
        // take the racket back on the planned side well before the ball arrives (slowly: no swing)
        const side = plan.stroke;
        const back = side === 'fh' ? -1.75 : 1.75;
        if (dt > 0.32) { W.yaw += (back - W.yaw) * 0.05; W.pitch += (-0.15 - W.pitch) * 0.05; W.roll = -Math.PI / 2; }
        if (dt <= 0.3 && dt > 0.05) {
          const az = gauss() * W.aim, speed = lerp(W.power[0], W.power[1], Math.random());
          W.stroke({ side, peakIn: dt - 0.012 + gauss() * W.timing, speed, az, lift: 0.15 + Math.random() * 0.2 });
        }
      } else if (!W.busy) { W.yaw *= 0.95; W.pitch *= 0.95; }
    };

    const pad = { id: 'Mimic (Vendor: 038f Product: 1200)', index, connected: true, mapping: '', timestamp: 0,
      axes: [0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })) };
    let lastT = 0;
    W.sample = function () {
      const now = performance.now() / 1000;
      if (now - lastT < 0.007) return; // ~125 Hz like Bluetooth
      lastT = now;
      W.think(now);
      if (W.prog) W.prog(now);
      W.dYaw += (gauss() * 0.002 - W.dYaw * 0.02) * W.noise; W.dPitch += (gauss() * 0.002 - W.dPitch * 0.02) * W.noise;
      const m = W.left ? -1 : 1;   // mirror: yaw and roll flip, pitch stays, the hand's x flips
      const qw = euler(m * (W.yaw + W.dYaw + gauss() * 0.0015 * W.noise), W.pitch + W.dPitch + gauss() * 0.0015 * W.noise, m * W.roll);
      let qp = mul(mul(Ci, qw), C);
      if (qp.w < 0) qp = { x: -qp.x, y: -qp.y, z: -qp.z, w: -qp.w };
      // accelerometer: gravity reads +g up, plus the hand's own acceleration, in the phone frame
      const aw = { x: m * W.acc.x, y: W.acc.y + G0, z: W.acc.z };
      const ap = rot({ x: -qp.x, y: -qp.y, z: -qp.z, w: qp.w }, rot(Ci, aw));
      const k = 1 / (8 * G0);
      pad.axes = [qp.x, qp.y, qp.z, ap.x * k + gauss() * 0.002, ap.y * k + gauss() * 0.002, ap.z * k + gauss() * 0.002];
      pad.buttons = W.buttons.map(b => ({ pressed: !!b, touched: !!b, value: b ? 1 : 0 }));
      pad.timestamp = performance.now();
    };
    W.pad = pad;
    return W;
  }

  const wands = window.__wands = [makeWand(0), makeWand(1)];
  window.__wand = wands[0];
  navigator.getGamepads = () => wands.map(W => { if (!W.on) return null; W.sample(); return W.pad; });
})();
