/*
 * Emberlane - reading the phone at its own rate. games/lib/mimic.js updates once per animation
 * frame (~60 Hz) and smooths angular velocity; a release needs the exact sample the button
 * came up on and the raw orientations around it. So this polls the same gamepad every 4 ms,
 * keeps every new report (~125 Hz over Bluetooth) with its timestamp, orientation, accelerometer
 * and buttons, and finds HOLD's press / release edges at sample precision (kin.js track). The
 * accelerometer feeds the body tracker (kin.js: the approach steps and the lunge). mimic.js is
 * still used for the other buttons, the mode (Wand / Grip), the menu cursor and rumble.
 *
 * Mode honesty: a Mimic phone in Point (air mouse) or Pad mode is connected but sends no motion. S.phoneHint says when a phone is
 * evidently there but not sending motion, so the game can say so instead of quietly playing
 * with the mouse stand-in.
 *
 * Without a phone the mouse stands in, through the very same path: mouse height = arm angle
 * (top = forward, bottom = back), sideways = swing plane, left button or Space = HOLD, Z / X =
 * wrist twist. A fast mouse flick is a fast swing. (No accelerometer: the body stays put.)
 *
 * With ?rec=1 (games/lib/recorder.js) every phone sample is written to the recording as
 * {k:'ev', name:'m', st (sample ms), ax [6 raw axes], b (button bits), mode}, plus 'phone'
 * status changes, so real swings can be replayed and studied.
 */
(function () {
  'use strict';
  const K = BW.Kin;
  const VID = 0x038f, PID = 0x1200;

  function isMotionPad(p) {
    return !!p && p.connected !== false && p.axes.length >= 6 &&
      (p.buttons.length === 12 || (/mimic/i.test(p.id) && p.buttons.length < 16));
  }
  const sending = p => !(p.axes[0] === 0 && p.axes[1] === 0 && p.axes[2] === 0 && p.axes[5] === 0);

  function create(mc) {
    const track = K.createTrack();
    const body = K.createBody();
    const S = { q: K.DEFAULT_Q0, a: false, padOn: false, hz: 0, source: 'mouse',
      padSilent: false, hidGranted: false, phoneHint: '' };
    let lastKey = '', nNew = 0, hzT = performance.now(), centerSeen = false;
    const mouse = { y: 0.55, x: 0.5, down: false, keys: {}, movedT: -1e9 };
    addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; if (e.movementX || e.movementY) mouse.movedT = performance.now(); });
    addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
    addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
    addEventListener('keydown', e => {
      mouse.keys[e.code] = true;
    });
    addEventListener('keyup', e => { mouse.keys[e.code] = false; });
    addEventListener('blur', () => { mouse.down = false; mouse.keys = {}; });
    let mTwist = 0, mLast = 0;

    // a phone granted to this site over WebHID (rumble / motion switch) counts as present
    async function checkHid() {
      try {
        if (!navigator.hid) return;
        const ds = await navigator.hid.getDevices();
        S.hidGranted = ds.some(d => d.vendorId === VID && d.productId === PID);
      } catch (e) { /* no WebHID */ }
    }
    checkHid(); setInterval(checkHid, 2000);
    if (navigator.hid && navigator.hid.addEventListener) {
      navigator.hid.addEventListener('connect', checkHid); navigator.hid.addEventListener('disconnect', checkHid);
    }

    function rec(name, data) { if (window.MimicRec && MimicRec.active) MimicRec.event(name, data); }

    function pad() {
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      const c = [];
      let silent = false;
      for (const p of list || []) {
        if (!isMotionPad(p)) continue;
        if (sending(p)) c.push(p); else silent = true;
      }
      S.padSilent = silent && !c.length;
      return c[mc.slot || 0] || null;
    }
    function poll() {
      const p = pad();
      S.padOn = !!p;
      if (!p) return;
      S.source = 'phone';
      const ax = p.axes, a = !!(p.buttons[0] && p.buttons[0].pressed);
      let bits = 0;
      for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i] && p.buttons[i].pressed) bits |= 1 << i;
      const key = ax[0] + ',' + ax[1] + ',' + ax[2] + ',' + ax[3] + ',' + ax[4] + ',' + ax[5] + ',' + bits;
      if (key === lastKey) return;
      lastKey = key;
      const now = performance.now();
      let t = p.timestamp;
      if (!(t > 0) || Math.abs(t - now) > 1000) t = now;
      const ss = track.samples, prev = ss[ss.length - 1];
      if (prev && t <= prev.t) t = prev.t + 0.5;      // new data, same timestamp
      const q = K.decodePad(ax);
      const acc = [ax[3], ax[4], ax[5]];
      K.pushSample(track, { t, q, a, acc });
      S.q = q; S.a = a; S.bits = bits; nNew++;
      if (bits & 2048) centerSeen = true;   // CENTRE (re-align): latched until the game reads it
      rec('m', { st: +t.toFixed(2), ax: [ax[0], ax[1], ax[2], ax[3], ax[4], ax[5]].map(v => +v.toFixed(5)), b: bits, mode: mc.mode });
    }
    setInterval(poll, 4);

    function mouseSample(now) {
      S.source = 'mouse';
      const dt = mLast ? Math.min(0.05, (now - mLast) / 1000) : 0; mLast = now;
      if (mouse.keys.KeyZ) mTwist += 9 * dt;
      else if (mouse.keys.KeyX) mTwist -= 9 * dt;
      else mTwist *= Math.exp(-dt * 6);
      const phi = 1.55 - mouse.y * 2.9;               // top: forward and up, bottom: far back
      const yaw = (0.5 - mouse.x) * 0.5;
      const q = K.mul(K.swingRot(yaw, phi, mTwist), K.DEFAULT_Q0);
      const a = mouse.down || !!mouse.keys.Space;
      K.pushSample(track, { t: now, q, a });
      S.q = q; S.a = a; nNew++;
    }

    let lastStatus = '';
    return {
      S, track, body, mouse,
      /** Once per animation frame. */
      frame(now) {
        poll();
        if (!S.padOn) mouseSample(now);
        if (now - hzT > 1000) { S.hz = nNew * 1000 / (now - hzT); nNew = 0; hzT = now; }
        // a phone is evidently here but sends no motion: its gamepad is silent, it is granted
        // over WebHID, or Grip's PC keys arrived
        S.phoneHint = S.padOn ? '' : S.padSilent ? 'silent-pad' : S.hidGranted ? 'hid' : '';
        const st = (S.padOn ? 'motion' : 'nomotion') + '|' + (mc.mode || '') + '|' + S.phoneHint;
        if (st !== lastStatus) { lastStatus = st; rec('phone', { padOn: S.padOn, mode: mc.mode, hint: S.phoneHint, hid: S.hidGranted, silent: S.padSilent}); }
      },
      /** Run the body tracker over the new samples (q0 = the align pose). */
      updateBody(q0) { K.bodyUpdate(body, track.samples, q0 || K.DEFAULT_Q0); },
      /** Button edges since last call: [{kind: 'press'|'release', t}]. */
      drain() { const e = track.events; track.events = []; return e; },
      lastT() { const s = track.samples; return s.length ? s[s.length - 1].t : 0; },
      /** True once for every CENTRE press seen by the 4 ms sampler (even one shorter than a frame). */
      takeCenter() { const c = centerSeen; centerSeen = false; return c; },
    };
  }

  window.BW = window.BW || {};
  window.BW.Input = { create };
})();
