/*
 * Willowlight - the bat. Pure maths, no browser (node games/cricket/test/bat.test.js).
 *
 * The phone is the bat handle: its top is the blade. It measures rotation precisely but not
 * where the hands are (Sunvolley's recordings: hand position and the face angle are useless for
 * aiming, the swing's path is what people mean). So:
 *   - the sweet spot's velocity u (the point L along the phone's top, a symmetric least-squares
 *     fit of its positions) is the bat's path at any instant. Its heading is where the ball goes,
 *     its elevation lofts or keeps it down, its size is the bat speed.
 *   - timing: the swing's fastest moment against the ball reaching the hitting zone. Off the
 *     middle, an edge, or nothing. The contact itself uses the bat as it was the moment the ball
 *     arrived, so a late swing meets it before the bottom of the arc (into the ground, squarer on
 *     a pull), an early one after (in the air, finer on a pull) - as on a real pitch.
 *   - the blade's angle decides what heights it can meet: a straight bat (pointing down) covers
 *     the ball from the ground to the waist, a cross bat (level) from the knee up. The wrong one
 *     can edge it at best.
 * Footwork is automatic (the batter's body is drawn moving into line); nothing aims the swing.
 * Positions: three.js world, the batter at z ~ 0 facing -z, x+ = a right-hander's off side.
 */
(function (root) {
  'use strict';
  const B = root && root.CK ? root.CK.Bowl : require('./bowl.js');
  const deg = Math.PI / 180;

  const BAT = {
    L: 0.62,            // hands to the sweet spot (m)
    V_PUSH: 1.4,        // m/s at the sweet spot: a still bat is a leave
    V_SWING: 6,         // m/s: a full shot from here, below it a push or a defensive prod
    POWER: { SOFT: 1.4, NORMAL: 1.75, BIG: 2.2 },   // arm-only phone swing -> bat speed (body, hands)
    WIN: { perfect: 0.035, good: 0.075, edge: 0.12 },   // s either side of the ball's arrival
    TIMING: { PRO: 0.7, NORMAL: 1, EASY: 1.5 },         // visible option TIMING WINDOW
    PUSH_WIN: 1.5,      // a slow prod has a wider window (its peak is broad)
    Q: 0.2,             // collision efficiency off the middle: v_out = Q v_in + (1 + Q) v_bat
    V_MAX: 42,
  };

  function tracker() { return { hist: [], cur: null, swings: [] }; }
  const fwdOk = v => { const s = Math.hypot(v.x, v.y, v.z); return s > 1e-6 && v.z < 0.5 * s && !(v.y > 0.7 * s && v.z > 0); };

  /** One phone sample {t (ms), q}. Updates the current swing (fastest moment, start, end). */
  function step(tr, s) {
    const h = tr.hist;
    if (h.length && s.t <= h[h.length - 1].t) return tr;
    h.push({ t: s.t, q: s.q, p: B.rotate(s.q, { x: 0, y: 0, z: -BAT.L }) });
    while (h.length > 2 && h[h.length - 1].t - h[0].t > 1500) h.shift();
    if (h.length < 3) return tr;
    const a = h[h.length - 3], c = h[h.length - 1], dt = (c.t - a.t) / 1000;
    if (dt <= 0) return tr;
    const v = { x: (c.p.x - a.p.x) / dt, y: (c.p.y - a.p.y) / dt, z: (c.p.z - a.p.z) / dt };
    const sp = fwdOk(v) ? Math.hypot(v.x, v.y, v.z) : 0, tm = h[h.length - 2].t;
    tr.speed = sp;
    const cur = tr.cur;
    if (!cur) {
      if (sp > BAT.V_PUSH) tr.cur = { t0: tm, peak: sp, tPeak: tm, qPeak: h[h.length - 2].q, ended: false, tEnd: null };
    } else {
      if (sp > cur.peak) { cur.peak = sp; cur.tPeak = tm; cur.qPeak = h[h.length - 2].q; }
      if ((tm - cur.t0 > 40 && sp < cur.peak * 0.45) || sp < BAT.V_PUSH * 0.7 || tm - cur.t0 > 700) {
        cur.ended = true; cur.tEnd = tm;
        tr.swings.push(cur); tr.cur = null;
        while (tr.swings.length > 4) tr.swings.shift();
      }
    }
    return tr;
  }

  /** The blade's direction at a swing's fastest moment: what kind of swing it is (straight / cross). */
  function swingBlade(sw) { return B.rotate(sw.qPeak, { x: 0, y: 0, z: -1 }); }

  /** The bat at time t (ms): blade direction b (unit) and sweet-spot velocity u (m/s). */
  function stateAt(tr, t) {
    const h = tr.hist;
    if (!h.length) return null;
    let near = h[0];
    for (const x of h) if (Math.abs(x.t - t) < Math.abs(near.t - t)) near = x;
    const u = B.pointVelocity(h, t, BAT.L, 18) || { x: 0, y: 0, z: 0 };
    return { b: B.rotate(near.q, { x: 0, y: 0, z: -1 }), u, speed: Math.hypot(u.x, u.y, u.z) };
  }

  /**
   * Timing for a ball reaching the bat at tArr (ms), seen at time now (ms). k: window scale.
   * { status: 'none' (no swing near it: a leave) | 'pending' (still speeding up: wait) |
   *   'ready', e (s, + = late), swing }.
   */
  function judge(tr, tArr, now, k) {
    const W = BAT.WIN.edge * (k || 1) * BAT.PUSH_WIN;
    const cands = tr.swings.concat(tr.cur ? [tr.cur] : []).filter(s => s.t0 <= tArr + W * 1000 && (!s.ended || s.tEnd >= tArr - W * 1000));
    if (!cands.length) return { status: 'none' };
    let s = cands[0];
    for (const c of cands) if (Math.abs(c.tPeak - tArr) < Math.abs(s.tPeak - tArr)) s = c;
    const peaked = s.ended || (tr.speed !== undefined && tr.speed < s.peak * 0.97 && now - s.tPeak > 40);
    if (peaked) return { status: 'ready', e: (s.tPeak - tArr) / 1000, swing: s };
    if (now - tArr > W * 1000) return { status: 'ready', e: (now - tArr) / 1000, swing: s };
    return { status: 'pending', swing: s };
  }

  /** How well the blade's angle suits the ball's height h (m): 1 good .. 0.25 hopeless. */
  function fit(b, h) {
    const el = Math.asin(Math.max(-1, Math.min(1, -b.y))) / deg;     // 90 = blade straight down
    const straight = h <= 0.95 ? 1 : h >= 1.35 ? 0.25 : 1 - (h - 0.95) / 0.4 * 0.75;
    const cross = h >= 0.45 ? 1 : h <= 0.15 ? 0.25 : 0.25 + (h - 0.15) / 0.3 * 0.75;
    const ws = Math.max(0, Math.min(1, (el - 25) / 25));             // 0 level .. 1 at 50 deg+
    return straight * ws + cross * (1 - ws);
  }

  /** 'middle' | 'good' | 'edge' | 'miss' from the timing error e (s), window scale k, height fit f. */
  function quality(e, k, f, push) {
    const s = (k || 1) * (push ? BAT.PUSH_WIN : 1), a = Math.abs(e);
    if (f < 0.5) return a <= BAT.WIN.edge * s ? 'edge' : 'miss';
    const w = s * f;
    return a <= BAT.WIN.perfect * w ? 'middle' : a <= BAT.WIN.good * w ? 'good' : a <= BAT.WIN.edge * s ? 'edge' : 'miss';
  }

  const SHOTS = {
    straight: [[25, 'STRAIGHT DRIVE', 'STRAIGHT DRIVE'], [70, 'COVER DRIVE', 'ON DRIVE'], [110, 'SQUARE DRIVE', 'FLICK'], [180, 'LATE CUT', 'GLANCE']],
    cross: [[25, 'SLOG', 'SLOG'], [70, 'CUT', 'PULL'], [110, 'CUT', 'PULL'], [180, 'LATE CUT', 'HOOK']],
  };
  function shotName(azR, crossBat, loft, push, speed) {
    if (push) return speed < 11 ? 'DEFENDED' : Math.abs(azR) > 100 ? 'NUDGE' : 'PUSH';
    const tab = crossBat ? SHOTS.cross : SHOTS.straight, a = Math.abs(azR);
    const row = tab.find(r => a <= r[0]) || tab[tab.length - 1];
    const n = azR >= 0 ? row[1] : row[2];
    return loft > 18 && !/HOOK|SLOG/.test(n) ? 'LOFTED ' + n : n;
  }

  /**
   * The ball off the bat. o: { u (the bat's path when the ball arrived), b (the blade at the swing's
   * fastest moment: straight or cross bat), ballV, ballP, q (quality),
   * e, side (+1 right-handed, -1 left), power (BAT.POWER.*), push, rng }.
   * Returns { v, kind, sweet, edge, playedOn, batSpeed, az (deg, RH frame), loft (deg) }.
   */
  function shot(o) {
    const side = o.side || 1, rng = o.rng || Math.random;
    const vi = Math.hypot(o.ballV.x, o.ballV.y, o.ballV.z);
    const u = o.u, vb = Math.min(BAT.V_MAX, Math.hypot(u.x, u.y, u.z) * (o.power || BAT.POWER.NORMAL));
    const uh = Math.hypot(u.x, u.z);
    let az = Math.atan2(u.x * side, -u.z) / deg, loft = Math.atan2(u.y, uh) / deg;
    const crossBat = Math.asin(Math.max(-1, Math.min(1, -o.b.y))) / deg < 35;
    const r = (a, b) => a + (b - a) * rng();
    let speed, kind, edge = false, playedOn = false;
    if (o.q === 'middle' || o.q === 'good') {
      speed = o.push ? 0.12 * vi + vb : BAT.Q * vi + (1 + BAT.Q) * vb * (o.q === 'middle' ? 1 : 0.85);
      if (o.q === 'good') az += r(-4, 4);
      loft = Math.max(-12, Math.min(55, loft * 0.9 + 4));
      if (o.push) loft = Math.min(loft, 8);
      kind = shotName(az, crossBat, loft, o.push, speed);
    } else {
      edge = true;
      const h = o.ballP ? o.ballP.y : 0.5;
      if (crossBat && h > 0.8) { kind = 'TOP EDGE'; az = r(120, 175) * (rng() < 0.5 ? -1 : 1); loft = r(50, 72); speed = r(14, 21); }
      else if (crossBat) { kind = 'BOTTOM EDGE'; az = r(-30, 30); loft = -20; speed = 0.2 * vi + 0.3 * vb; }
      else if (o.e > 0) { kind = 'OUTSIDE EDGE'; az = r(148, 172); loft = r(4, 14); speed = 0.6 * vi + 0.15 * vb; }
      else if (o.ballP && Math.abs(o.ballP.x) < 0.22 && rng() < 0.35) { kind = 'PLAYED ON'; playedOn = true; speed = 4; az = 180; loft = -5; }
      else { kind = 'INSIDE EDGE'; az = -r(140, 170); loft = r(0, 10); speed = 0.3 * vi + 0.25 * vb; }
    }
    const a = az * deg, l = loft * deg;
    const v = { x: speed * Math.cos(l) * Math.sin(a) * side, y: speed * Math.sin(l), z: -speed * Math.cos(l) * Math.cos(a) };
    if (playedOn && o.ballP) {   // back onto the stumps behind
      const d = Math.hypot(o.ballP.x, o.ballP.z) || 1;
      v.x = -o.ballP.x / d * speed; v.z = -o.ballP.z / d * speed; v.y = 0.3;
    }
    return { v, kind, sweet: o.q === 'middle', edge, playedOn, batSpeed: vb, az, loft, speed };
  }

  /**
   * The computer batter: from where the ball will be at the bat (h height, x across, len where
   * it pitched or null) choose a shot, then swing it with human timing noise. Returns null for a
   * leave, else { u, b, e, push } for quality()/shot(). skill: { sigma (s), aggro 0..1 }.
   */
  function cpuShot(ball, skill, rng, side) {
    rng = rng || Math.random; side = side || 1;
    const x = ball.x * side, h = ball.h, L = ball.len, onStumps = ball.onStumps;
    const g = () => { let a = 0, b = 0; while (!a) a = rng(); while (!b) b = rng(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
    const r = (a, b) => a + (b - a) * rng();
    if (h > 1.65) return null;                                     // duck under it
    if (!onStumps && x > 0.42 && rng() < 0.75) return null;         // shoulder arms outside off
    if (!onStumps && x < -0.5 && rng() < 0.5) return null;
    let az, loft, vb, crossBat = false, push = false;
    const aggro = skill.aggro;
    if (h > 1.0) { crossBat = true; az = r(-115, -60); loft = r(4, 30) * aggro; vb = r(15, 24); }
    else if (L === null || L < 3.6) { az = x > 0.15 ? r(20, 60) : x < -0.1 ? r(-60, -15) : r(-12, 12); loft = rng() < aggro * 0.6 ? r(15, 34) : r(-6, 6); vb = r(14, 24); }
    else {
      const p = rng();
      if (p < 0.5 - aggro * 0.3) { push = true; az = r(-20, 20); loft = 0; vb = r(1.6, 3.5); }
      else if (p < 0.85 - aggro * 0.2) { az = x > 0.1 ? r(40, 100) : r(-100, -30); loft = r(-4, 4); vb = r(8, 13); }
      else { az = x > 0.15 ? r(25, 70) : r(-70, -10); loft = r(10, 32); vb = r(15, 23); }
    }
    const a = az * deg, l = loft * deg, s = vb / BAT.POWER.NORMAL;
    const u = { x: s * Math.cos(l) * Math.sin(a) * side, y: s * Math.sin(l), z: -s * Math.cos(l) * Math.cos(a) };
    const b = crossBat ? { x: Math.cos(a) * side, y: 0, z: Math.sin(a) } : { x: 0, y: -1, z: 0 };
    return { u, b, e: g() * skill.sigma, push };
  }

  /**
   * Bat orientation (forward = phone top = blade) for an angle theta in a swing plane: 'vertical'
   * hangs straight down at theta 0 and swings toward heading dir (+ right) for theta > 0; 'flat'
   * is level, pointing at the bowler at theta 0, sweeping round to the leg side (sweep +1) or the
   * off side (-1), the blade tilted up by lift. (Synthetic swings, the mouse stand-in, the CPU.)
   */
  function batQuat(theta, dir, plane, lift, sweep) {
    if (plane === 'flat') {
      const yaw = -(sweep || 1) * theta + (dir || 0);
      return B.norm(B.mul(B.axisAngle(0, 1, 0, -yaw), B.axisAngle(1, 0, 0, lift || 0)));
    }
    const tilt = B.axisAngle(1, 0, 0, -Math.PI / 2 + theta);
    return B.norm(B.mul(B.mul(B.axisAngle(0, 1, 0, -(dir || 0)), B.axisAngle(1, 0, 0, lift || 0)), tilt));
  }

  const api = { BAT, batQuat, tracker, step, swingBlade, stateAt, judge, fit, quality, shot, shotName, cpuShot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Bat = api; }
})(typeof window !== 'undefined' ? window : null);
