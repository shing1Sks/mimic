/*
 * Willowlight - reading each phone at its own rate. mimic.js updates once per frame and smooths
 * angular velocity; a release or a bat swing needs every raw report with its timestamp. So each
 * seat polls its phone's gamepad every 4 ms and keeps the samples ({t, q, a, acc}, ~1.5 s) and
 * HOLD's press / release edges at sample precision (as Emberlane's input.js). mimic.js is still
 * used for the other buttons, the mode, wording and rumble.
 *
 * Without a phone the mouse stands in through the very same path (testing only): bowling, mouse
 * height is the arm angle (bottom = down behind, top = over and through), left button / Space =
 * HOLD, Z / X twist the wrist, Q / E turn the seam. Batting, mouse height is the bat (top =
 * backlift, a fast pull down = the swing), sideways = the swing's direction, Shift = cross bat.
 * With ?rec=1 (games/lib/recorder.js) every phone sample is recorded as {k:'ev', name:'m'}.
 */
(function () {
  'use strict';
  const CK = window.CK;
  const Bo = CK.Bowl, Ba = CK.Bat;

  function isMotionPad(p) {
    return !!p && p.connected !== false && p.axes.length >= 6 && (p.buttons.length === 12 || (/mimic/i.test(p.id) && p.buttons.length < 16));
  }
  const sending = p => !(p.axes[0] === 0 && p.axes[1] === 0 && p.axes[2] === 0 && p.axes[5] === 0);
  function motionPads() { const out = []; for (const p of (navigator.getGamepads ? navigator.getGamepads() : []) || []) if (isMotionPad(p)) out.push(p); return out; }

  const mouse = { x: 0.5, y: 0.35, down: false, keys: {} };
  addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; });
  addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  addEventListener('keydown', e => { mouse.keys[e.code] = true; });
  addEventListener('keyup', e => { mouse.keys[e.code] = false; });
  addEventListener('blur', () => { mouse.down = false; mouse.keys = {}; });

  /**
   * One seat's motion source. kind 'phone' (mc: its MimicController slot) or 'mouse'.
   * role() -> 'bat' | 'bowl' | null tells the mouse stand-in what to imitate.
   */
  function create(kind, mc, role) {
    const S = { samples: [], events: [], lastA: false, q: { x: 0, y: 0, z: 0, w: 1 }, a: false, hz: 0, on: false };
    let lastKey = '', nNew = 0, hzT = performance.now(), mLast = 0, mTwist = 0, mRho = 0;
    function push(s) {
      const ss = S.samples;
      if (ss.length && s.t <= ss[ss.length - 1].t) s.t = ss[ss.length - 1].t + 0.5;
      ss.push(s);
      while (ss.length > 2 && ss[ss.length - 1].t - ss[0].t > 1500) ss.shift();
      if (s.a && !S.lastA) S.events.push({ kind: 'press', t: s.t });
      if (!s.a && S.lastA) S.events.push({ kind: 'release', t: s.t });
      S.lastA = s.a; S.q = s.q; S.a = s.a; nNew++;
    }
    function poll() {
      if (kind !== 'phone') return;
      const p = motionPads()[mc.slot || 0];
      S.on = !!(p && sending(p));
      if (!S.on) return;
      const ax = p.axes, a = !!(p.buttons[0] && p.buttons[0].pressed);
      const key = ax[0] + ',' + ax[1] + ',' + ax[2] + ',' + ax[3] + ',' + ax[4] + ',' + ax[5] + ',' + a;
      if (key === lastKey) return;
      lastKey = key;
      const now = performance.now();
      let t = p.timestamp;
      if (!(t > 0) || Math.abs(t - now) > 1000) t = now;
      push({ t, q: Bo.decodePad(ax), a, acc: [ax[3], ax[4], ax[5]] });
      if (window.MimicRec && MimicRec.active) MimicRec.event('m', { slot: mc.slot, st: +t.toFixed(2), ax: [0, 1, 2, 3, 4, 5].map(i => +ax[i].toFixed(5)), a });
    }
    const timer = kind === 'phone' ? setInterval(poll, 4) : null;
    function mouseSample(now) {
      const dt = mLast ? Math.min(0.05, (now - mLast) / 1000) : 0; mLast = now;
      const k = mouse.keys;
      if (k.KeyZ) mTwist = 22; else if (k.KeyX) mTwist = -22; else mTwist *= Math.exp(-dt * 10);
      mRho += mTwist * dt;
      const seam = k.KeyQ ? 0.45 : k.KeyE ? -0.45 : 0;
      let q;
      if (role() === 'bowl') q = Bo.armQuat(-2.7 + (1 - mouse.y) * 4.9, (mouse.x - 0.5) * 0.5, mRho + seam);
      else {
        const th = -2.6 + mouse.y * 4.0, dir = (mouse.x - 0.5) * 1.6;
        q = k.ShiftLeft || k.ShiftRight ? Ba.batQuat(th * 0.9, dir, 'flat', 0.1, 1) : Ba.batQuat(th, dir, 'vertical');
      }
      push({ t: now, q, a: mouse.down || !!k.Space });
    }
    return {
      S, kind, mc,
      frame(now) {
        if (kind === 'phone') { poll(); } else { S.on = true; mouseSample(now); }
        if (now - hzT > 1000) { S.hz = nNew * 1000 / (now - hzT); nNew = 0; hzT = now; }
      },
      drain() { const e = S.events; S.events = []; return e; },
      lastT() { const s = S.samples; return s.length ? s[s.length - 1].t : 0; },
      dispose() { if (timer) clearInterval(timer); },
    };
  }

  CK.Input = { create, motionPads, mouse };
})();
