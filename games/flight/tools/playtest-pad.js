// Gyrowing playtest: a fake Mimic Pad (the app's encoding: 17 buttons, sticks on axes 0-2, L2/R2 on
// axes 3/4 resting at -1, D-pad as a hat on axis 9) plus a simple pilot that flies it like a person
// with a stick: bank and pitch targets, gentle hands. Injected as an init script by playtest.py.
(function () {
  'use strict';
  const HAT_OFF = 3.2857;
  const pad = { id: 'Mimic Pad (STANDARD GAMEPAD Vendor: 1209 Product: 4d50)', index: 0, connected: true, mapping: '',
    axes: [0, 0, 0, -1, -1, 0, 0, 0, 0, HAT_OFF], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
  navigator.getGamepads = () => { pad.timestamp = performance.now(); return [pad]; };
  const P = window.__pad = {
    pad, mode: 'idle', hdg: null, alt: null, fps: [], frames: 0, fpsT: 0, gearUp: false,
    press(i, ms) { pad.buttons[i].pressed = true; pad.buttons[i].value = 1; setTimeout(() => { pad.buttons[i].pressed = false; pad.buttons[i].value = 0; }, ms || 120); },
    hat(dir, ms) { pad.axes[9] = { up: -1, right: -1 + 4 / 7, down: -1 + 8 / 7, left: -1 + 12 / 7 }[dir]; setTimeout(() => { pad.axes[9] = HAT_OFF; }, ms || 120); },
    set(o) { Object.assign(P, o); },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = d => ((d + 540) % 360) - 180;
  function step(now) {
    requestAnimationFrame(step);
    P.frames++;
    if (now - P.fpsT >= 1000) { if (P.fpsT) P.fps.push(P.frames * 1000 / (now - P.fpsT)); P.fpsT = now; P.frames = 0; }
    const gw = window.__gyrowing; if (!gw || !gw.G || !gw.G.s) return;
    const G = gw.G, s = G.s;
    if (P.mode === 'hands') return;   // the test script moves the sticks and triggers itself
    if (G.state !== 'fly' || P.mode === 'idle') { pad.axes[0] = pad.axes[1] = 0; pad.axes[3] = pad.axes[4] = -1; return; }
    const att = gw.FM.attitude(s), kt = s.airspeed * 1.944;
    let thr = 0.75, tPitch = 3, tBank = 0;
    if (P.mode === 'takeoff') {
      thr = 1; tPitch = s.onGround ? (kt > 55 ? 9 : 0) : 8;
      if (!s.onGround && s.agl > 40 && G.ctl.gear && !P.gearUp) { P.gearUp = true; P.press(2); }
      if (s.agl > 250) P.mode = 'cruise';
    }
    if (P.mode === 'cruise') {
      if (P.hdg != null) tBank = clamp(wrap(P.hdg - att.heading) * 0.8, -25, 25);
      const alt = P.alt != null ? P.alt : 300;
      tPitch = clamp((alt - s.agl) * 0.03 + 2, -5, 9);
      thr = kt < 85 ? 0.9 : kt > 105 ? 0.55 : 0.75;
    }
    // stick: pitch and bank errors, like a gentle hand (+ axis 1 = stick back = nose up, like S)
    const pe = tPitch - att.pitch, be = tBank - att.bank;
    pad.axes[1] = clamp(pe * 0.06, -0.8, 0.8);
    pad.axes[0] = clamp(be * 0.03, -0.7, 0.7);
    const cur = G.ctl.throttle;
    pad.axes[4] = cur < thr - 0.03 ? 0.2 : -1; pad.axes[3] = cur > thr + 0.03 ? 0.2 : -1;
  }
  requestAnimationFrame(step);
})();
