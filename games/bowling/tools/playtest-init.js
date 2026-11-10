// Emberlane playtest: a fake Mimic Wand on the Gamepad API (12 buttons, 6 axes; axes 0..2 =
// phone-frame quaternion as games/lib/mimic.js decodes, 3..5 = accel / 8 g). It replays a queue
// of timestamped samples [{t (performance.now ms), axes:[x,y,z], acc:[3] (phone frame / 8 g, incl.
// gravity; default: at rest for that orientation), a, center, b}] at their times,
// like ~125 Hz Bluetooth reports. Loaded as a Playwright init script (see playtest.py).
(function () {
  'use strict';
  const F = window.__fake = { queue: [], cur: { axes: [0.5, 0, 0], acc: null, a: false, center: false, b: false }, on: true };
  // gravity seen by a still phone with these axes (phone-frame quaternion xyz, w >= 0)
  function restAcc(ax) {
    const x = ax[0], y = ax[1], z = ax[2], w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    // world up (level frame: z up in the phone convention used by mimic.js before C) -> phone frame
    // mimic.js: world = C * qp * acc; world up (three.js y) = C * (0,0,1) in the level frame
    const v = { x: 0, y: 0, z: 1 / 8 };
    // rotate by conj(qp)
    const qx = -x, qy = -y, qz = -z, qw = w;
    const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
    return [v.x + qw * tx + (qy * tz - qz * ty), v.y + qw * ty + (qz * tx - qx * tz), v.z + qw * tz + (qx * ty - qy * tx)];
  }
  F.restAcc = restAcc;
  const pad = { id: 'Mimic (Vendor: 038f Product: 1200)', index: 0, connected: true, mapping: '', timestamp: 0,
    axes: [0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })) };
  F.push = list => { F.queue.push(...list); F.queue.sort((p, q) => p.t - q.t); };
  F.hold = (o) => { Object.assign(F.cur, o); };
  function update() {
    const now = performance.now();
    while (F.queue.length && F.queue[0].t <= now) { Object.assign(F.cur, F.queue.shift()); }
    const c = F.cur;
    const ax = c.axes;
    // gravity in the phone frame, roughly (only used by mimic.js for linearAccel)
    const acc = c.acc || restAcc(ax);
    if (pad.axes[0] !== ax[0] || pad.axes[1] !== ax[1] || pad.axes[2] !== ax[2] || pad.axes[3] !== acc[0] || pad.buttons[0].pressed !== !!c.a || pad.buttons[11].pressed !== !!c.center || pad.buttons[1].pressed !== !!c.b) {
      pad.timestamp = c.t || now;
    }
    pad.axes = [ax[0], ax[1], ax[2], acc[0], acc[1], acc[2]];
    pad.buttons[0] = { pressed: !!c.a, touched: !!c.a, value: c.a ? 1 : 0 };
    pad.buttons[1] = { pressed: !!c.b, touched: !!c.b, value: c.b ? 1 : 0 };
    pad.buttons[11] = { pressed: !!c.center, touched: !!c.center, value: c.center ? 1 : 0 };
  }
  navigator.getGamepads = function () { if (!F.on) return [null]; update(); return [Object.assign({}, pad, { axes: pad.axes.slice(), buttons: pad.buttons.slice() })]; };
})();
