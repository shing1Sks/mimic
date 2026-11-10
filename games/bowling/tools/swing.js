/*
 * Synthetic human bowling swings for tests and the playtest's fake phone. A swing is the arm
 * angle phi(t) of a pendulum from the shoulder (0 = hanging, + = forward): stance, push away,
 * back swing, a short pause at the top, then the forward swing whose speed peaks through the
 * bottom (like a real pendulum with a push), the release, the follow-through. Noise and timing
 * are taken from the user's real Wand recordings (recordings/*: quiet-hand jitter ~0.15 rad/s
 * at frame rate, swing peaks 6-18 rad/s, ~125 Hz Bluetooth samples with jitter).
 *
 * The accelerometer (axes 3..5, phone frame, incl. gravity, / 8 g, clipped at full scale like the
 * phone) is simulated from the same motion: the hand on the arm model plus the body's own path
 * (a step / lunge forward), so the real input path (input.js -> kin.js body tracker) sees what a
 * phone would send.
 *
 * gen(o) -> [{ t (ms), q (world quaternion incl. the grip), a (HOLD down), acc [3] }]
 * o: { peakW (rad/s at the bottom), back (rad), yaw (swing plane, rad, + = left), twist (rad of
 *      wrist turn around the release, + = anticlockwise from above), relPhi (arm angle at
 *      release, rad), grip (q0: how the phone sits in the hand), noise (0..1), hz, seed,
 *      t0 (ms), hold (false = never press), lunge: { dist (m forward), dur (s), end (s after the
 *      release) } body path, armL (true arm length, m; default the model's), accNoise (m/s^2),
 *      accLag (ms the accelerometer trails the orientation, default kin.js HAND.LAG as measured),
 *      wrist: { yaw, pitch } (rad the wrist turns the phone through the release, the hand unmoved) }
 */
(function (root) {
  'use strict';
  const K = typeof require === 'function' && typeof module !== 'undefined' ? require('../kin.js') : root.BW.Kin;

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return { u, g: () => { let a = 0, b = 0; while (!a) a = u(); while (!b) b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); } };
  }
  const sstep = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

  function gen(o) {
    o = Object.assign({ peakW: 8, back: 1.2, fwdTop: null, yaw: 0, twist: 0, relPhi: 0.12, grip: K.DEFAULT_Q0,
      noise: 1, hz: 125, seed: 7, t0: 0, hold: true, stance: 0.45, stepYaw: 0, lunge: null, armL: null, accNoise: 0.04,
      accLag: K.HAND ? K.HAND.LAG : 0, wrist: null }, o);
    const R = rng(o.seed), RA = rng((o.seed * 7919 + 13) >>> 0);   // RA: accelerometer noise (keeps R's sequence)
    const fwdTop = o.fwdTop == null ? o.back : o.fwdTop;
    // forward swing from -back to +fwdTop; (1 - cos) profile peaks at the middle with
    // w = (back + fwdTop) * pi / (2 * Tf)
    const Tf = (o.back + fwdTop) * Math.PI / (2 * o.peakW);
    const T = { ready: 0.35, push: 0.30, backT: 0.55, top: 0.07 };
    const tPush = T.ready, tBack = tPush + T.push, tTop = tBack + T.backT, tF = tTop + T.top, tEnd = tF + Tf;
    const phiAt = t => {
      if (t < tPush) return o.stance;
      if (t < tBack) return o.stance + (o.stance + 0.15 - o.stance) * sstep((t - tPush) / T.push);
      if (t < tTop) return (o.stance + 0.15) + (-o.back - o.stance - 0.15) * sstep((t - tBack) / T.backT);
      if (t < tF) return -o.back;
      if (t < tEnd) { const k = (t - tF) / Tf; return -o.back + (o.back + fwdTop) * (1 - Math.cos(Math.PI * k)) / 2; }
      return fwdTop - (t - tEnd) * 0.4;
    };
    // when the arm passes relPhi going forward
    let tRel = tF;
    while (tRel < tEnd && phiAt(tRel) < o.relPhi) tRel += 0.0005;
    // the body's path (shoulder displacement), forward = along the swing plane
    const lg = o.lunge, lgEnd = lg ? tRel + (lg.end || 0) : 0;
    const bodyAt = t => {
      if (!lg) return { x: 0, y: 0, z: 0 };
      const d = -lg.dist * sstep((t - (lgEnd - lg.dur)) / lg.dur);
      return { x: -Math.sin(o.yaw) * -d, y: lg.drop ? -lg.drop * sstep((t - (lgEnd - lg.dur)) / lg.dur) : 0, z: Math.cos(o.yaw) * d };
    };
    const armScale = o.armL ? o.armL / K.ARM.L : 1;
    const twAt = t => o.twist * sstep((t - (tRel - 0.07)) / 0.12);
    // the wrist flexing through the release turns the phone (yaw left / pitch up, rad) without
    // moving the hand: what the rigid arm model cannot tell from a swinging arm
    const wristAt = t => {
      if (!o.wrist) return null;
      const k = sstep((t - (tRel - 0.12)) / 0.2);
      return K.mul(K.axisAngle(0, 1, 0, (o.wrist.yaw || 0) * k), K.axisAngle(1, 0, 0, (o.wrist.pitch || 0) * k));
    };
    const withWrist = (t, q) => { const w = wristAt(t); return w ? K.norm(K.mul(w, q)) : q; };
    const handAt = t => {
      const r = K.armVec(K.swingRot(t < tPush ? o.stepYaw : o.yaw, phiAt(t), twAt(t)));
      const b = bodyAt(t);
      return { x: b.x + r.x * armScale, y: b.y + r.y * armScale, z: b.z + r.z * armScale };
    };
    const G = K.BODY.G, FS = K.BODY.ACC_FS, Ci = K.conj(K.C);
    const out = [];
    let t = 0, wob = 0;
    const dur = tEnd + 0.7, dtNom = 1 / o.hz;
    while (t < dur) {
      const phi = phiAt(t);
      wob += (R.g() * 0.004 - wob * 0.02) * o.noise;       // slow human wobble of the plane
      const tw = twAt(t);
      const yaw = (t < tPush ? o.stepYaw : o.yaw) + wob * 0.3;
      let Rd = K.swingRot(yaw, phi, tw);
      if (o.noise) {
        const n = 0.0022 * o.noise;
        Rd = K.norm(K.mul(K.axisAngle(R.g(), R.g(), R.g(), Math.abs(R.g()) * n), Rd));
      }
      const q = withWrist(t, K.norm(K.mul(Rd, o.grip)));
      const a = o.hold && t >= tPush - 0.1 && t < tRel;
      // accelerometer: the hand's acceleration + gravity, in the phone frame, clipped at 8 g; like
      // the real phone it is accLag ms older than the orientation in the same report
      const tl = t - o.accLag / 1000;
      const h = 0.002, p0 = handAt(tl - h), p1 = handAt(tl), p2 = handAt(tl + h);
      const f = { x: (p2.x - 2 * p1.x + p0.x) / (h * h), y: (p2.y - 2 * p1.y + p0.y) / (h * h) + G, z: (p2.z - 2 * p1.z + p0.z) / (h * h) };
      const ql = o.accLag ? withWrist(tl, K.norm(K.mul(K.swingRot((tl < tPush ? o.stepYaw : o.yaw) + wob * 0.3, phiAt(tl), twAt(tl)), o.grip))) : q;
      const fp = K.rotate(Ci, K.rotate(K.conj(ql), f));
      const an = o.noise ? o.accNoise : 0;
      const acc = [fp.x, fp.y, fp.z].map(v => Math.max(-1, Math.min(1, (v + RA.g() * an) / FS)));
      out.push({ t: o.t0 + t * 1000, q, a, acc });
      t += dtNom * (1 + (o.noise ? R.g() * 0.12 : 0));
    }
    return Object.assign(out, { tRel: o.t0 + tRel * 1000, Tf, peakW: o.peakW });
  }

  const api = { gen, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.BW = root.BW || {}; root.BW.Swing = api; }
})(typeof window !== 'undefined' ? window : null);
