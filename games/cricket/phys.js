/*
 * Duskbat - ball physics. Pure maths, no browser (node games/cricket/test/phys.test.js).
 *
 * World: metres, seconds, three.js axes. The batter's stumps stand at z = 0, the bowler's at
 * z = -20.12; the ball is bowled toward +z. x+ is a right-handed batter's off side (his right as
 * he faces the bowler), y up.
 *
 * In the air: gravity, quadratic drag, Magnus drift from spin (w x v) and, before the first
 * bounce, conventional swing: a sideways force along the seam's lean, strongest at 110-145 km/h.
 * Off the ground: a rigid-ball bounce with Coulomb friction at the contact point. The contact
 * point slides with v + w x r, friction acts against that slide (capped at the moment the ball
 * would roll), so sidespin turns the ball, topspin skids on and backspin holds up, with no
 * special cases. A seam that lands upright kicks a little either way (seamKick, per ball).
 */
(function (root) {
  'use strict';
  const G = 9.81;
  const BALL = { R: 0.036, M: 0.16 };
  // 0.5 rho C A / m for drag (Cd 0.4), maximal swing (Cs 0.3) and the Magnus lift factor
  const AIR = { KD: 0.0062, KS: 0.0047, KM: 1.3e-4, SPIN_DECAY: 0.25 };
  const PITCH = { L: 20.12, HALF_W: 1.52, CREASE: 1.22, STUMP_HALF: 0.1143, STUMP_H: 0.711 };
  const SURF = {
    // muSide: grip across the line of travel, higher than along it (a spinning seam bites the
    // dry surface; a skidding ball slides along it)
    pitch: { e: 0.58, mu: 0.3, muSide: 0.65 },
    grass: { e: 0.4, mu: 0.45, muSide: 0.45, roll: 2.4 },
  };
  const FIELD = { CX: 0, CZ: -PITCH.L / 2, R: 62 };   // boundary: a circle round the pitch's middle

  const len = v => Math.hypot(v.x, v.y, v.z);
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  /** Swing needs pace: none below ~80 km/h, full from ~110 to ~145, fading above. */
  function swingPace(sp) {
    if (sp < 22) return 0;
    if (sp < 30.5) return (sp - 22) / 8.5;
    if (sp < 40) return 1;
    return Math.max(0.5, 1 - (sp - 40) / 10);
  }

  function onPitch(p) { return Math.abs(p.x) < PITCH.HALF_W && p.z > -PITCH.L - 1.5 && p.z < 1.5; }

  /** A ball state: { p, v, w (spin, rad/s), swing (-1..1), seamKick (m/s), bounces, rolling, t }. */
  function ball(p, v, o) {
    o = o || {};
    return { p: { x: p.x, y: p.y, z: p.z }, v: { x: v.x, y: v.y, z: v.z }, w: o.w ? { x: o.w.x, y: o.w.y, z: o.w.z } : { x: 0, y: 0, z: 0 },
      swing: o.swing || 0, seamKick: o.seamKick || 0, bounces: 0, rolling: false, t: 0, pitchAt: null, stopped: false };
  }

  /** Bounce on the ground (b.p.y at the ball radius, b.v.y < 0). Returns the surface name. */
  function bounce(b) {
    const name = onPitch(b.p) ? 'pitch' : 'grass', s = SURF[name], R = BALL.R, v = b.v, w = b.w;
    const vy = -v.y;
    // contact point velocity: v + w x (0, -R, 0) = (vx + wz R, 0, vz - wx R)
    const cx = v.x + w.z * R, cz = v.z - w.x * R;
    // friction along and across the direction of travel, each stopping at rolling (2/7 of its slide)
    const h = Math.hypot(v.x, v.z), fx = h > 1e-6 ? v.x / h : 0, fz = h > 1e-6 ? v.z / h : 1;
    const cf = cx * fx + cz * fz, cs = cx * fz - cz * fx;
    const Jf = Math.sign(cf) * Math.min(s.mu * (1 + s.e) * vy, 2 / 7 * Math.abs(cf));
    const Js = Math.sign(cs) * Math.min(s.muSide * (1 + s.e) * vy, 2 / 7 * Math.abs(cs));
    const dvx = -(Jf * fx + Js * fz), dvz = -(Jf * fz - Js * fx);
    v.x += dvx; v.z += dvz;
    // the same impulse turns the ball (solid sphere): dw = 5/(2R) (-dvz, 0, dvx)
    const k = 5 / (2 * R);
    w.x += -dvz * k; w.z += dvx * k;
    v.y = s.e * vy;
    if (b.bounces === 0 && b.seamKick) v.x += b.seamKick;
    b.bounces++;
    if (b.bounces === 1) b.pitchAt = { x: b.p.x, z: b.p.z, t: b.t, surf: name };
    if (v.y < 0.5) { v.y = 0; b.rolling = true; }
    return name;
  }

  /** Advance one step (semi-implicit Euler). Returns 'bounce' on a bounce, else null. */
  function step(b, dt) {
    if (b.stopped) return null;
    const v = b.v, sp = len(v), w = b.w;
    let ax = -AIR.KD * sp * v.x, ay = -AIR.KD * sp * v.y, az = -AIR.KD * sp * v.z;
    if (b.rolling) {
      ay = 0;
      const h = Math.hypot(v.x, v.z);
      const dec = SURF.grass.roll + AIR.KD * h * h;
      if (h <= dec * dt) { v.x = v.z = 0; b.stopped = true; b.t += dt; return null; }
      ax = -dec * v.x / h; az = -dec * v.z / h;
    } else {
      ay -= G;
      const m = cross(w, v);
      ax += AIR.KM * m.x; ay += AIR.KM * m.y; az += AIR.KM * m.z;
      if (b.swing && !b.bounces) {
        const h = Math.hypot(v.x, v.z);
        if (h > 1) {
          const f = AIR.KS * sp * sp * b.swing * swingPace(sp);
          ax += f * v.z / h; az += -f * v.x / h;
        }
      }
    }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    const px = b.p.x, py = b.p.y, pz = b.p.z;
    b.p.x += v.x * dt; b.p.y += v.y * dt; b.p.z += v.z * dt;
    b.t += dt;
    const dec = Math.exp(-AIR.SPIN_DECAY * dt);
    w.x *= dec; w.y *= dec; w.z *= dec;
    if (b.rolling) { b.p.y = BALL.R; return null; }
    if (b.p.y < BALL.R && v.y < 0) {
      // back to the moment of contact, bounce there, finish the step
      const k = (py - BALL.R) / Math.max(1e-9, py - b.p.y);
      b.p.x = px + (b.p.x - px) * k; b.p.z = pz + (b.p.z - pz) * k; b.p.y = BALL.R;
      bounce(b);
      const rest = (1 - k) * dt;
      b.p.x += b.v.x * rest; b.p.z += b.v.z * rest; b.p.y += b.v.y * rest;
      return 'bounce';
    }
    return null;
  }

  function clone(b) { return JSON.parse(JSON.stringify(b)); }

  /**
   * Run a copy forward. o: { dt (s), tMax, until(b) -> bool }. Returns
   * { end (state), samples [{t, x, y, z}], pitch (first bounce or null) }.
   */
  function run(b0, o) {
    o = o || {};
    const dt = o.dt || 1 / 600, tMax = o.tMax || 6, b = clone(b0), samples = o.samples === false ? null : [];
    let n = 0;
    while (b.t < tMax && !b.stopped) {
      step(b, dt);
      if (samples && (n++ % (o.every || 4) === 0)) samples.push({ t: b.t, x: b.p.x, y: b.p.y, z: b.p.z, air: !b.bounces && !b.rolling });
      if (o.until && o.until(b)) break;
    }
    return { end: b, samples, pitch: b.pitchAt };
  }

  /** Where the segment a -> b crosses the plane z = z0 (fraction 0..1), or -1. */
  function crossZ(a, b, z0) {
    if ((a.z - z0) * (b.z - z0) > 0 || a.z === b.z) return -1;
    return (z0 - a.z) / (b.z - a.z);
  }
  const lerp3 = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

  /** Does the ball moving a -> b pass through the stumps at z = zs (the batter's: 0)? */
  function hitsStumps(a, b, zs) {
    const k = crossZ(a, b, zs || 0);
    if (k < 0) return null;
    const p = lerp3(a, b, k);
    const ok = Math.abs(p.x) <= PITCH.STUMP_HALF + BALL.R && p.y <= PITCH.STUMP_H + BALL.R && p.y >= 0;
    return ok ? p : null;
  }

  /**
   * Ball state that pitches at target {x, z} (z > 0: a full toss landing behind the stumps)
   * leaving `from` at `speed`, with spin w and swing included. Newton on (elevation, heading).
   * Returns { v, elev, head, land, err } (err: metres off the target, ~0).
   */
  function solveRelease(o) {
    const from = o.from, sp = o.speed, tg = o.target;
    const mk = (e, a) => ({ x: sp * Math.cos(e) * Math.sin(a), y: sp * Math.sin(e), z: sp * Math.cos(e) * Math.cos(a) });
    const land = (e, a) => {
      const r = run(ball(from, mk(e, a), { w: o.w, swing: o.swing }), { dt: 1 / 400, tMax: 4, samples: false, until: b => b.bounces > 0 || b.p.z > 6 });
      return r.pitch || { x: r.end.p.x, z: r.end.p.z };
    };
    const dz = tg.z - from.z, dx = tg.x - from.x;
    let a = Math.atan2(dx, dz);
    let e = Math.atan2(-from.y, Math.hypot(dx, dz)) + 0.5 * G * Math.hypot(dx, dz) / (sp * sp);
    let L = land(e, a), err = Infinity;
    const D = 1e-3;
    for (let i = 0; i < 14; i++) {
      const ex = tg.x - L.x, ez = tg.z - L.z;
      err = Math.hypot(ex, ez);
      if (err < 0.004) break;
      const Le = land(e + D, a), La = land(e, a + D);
      const j11 = (Le.x - L.x) / D, j12 = (La.x - L.x) / D, j21 = (Le.z - L.z) / D, j22 = (La.z - L.z) / D;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) break;
      let de = (ex * j22 - j12 * ez) / det, da = (j11 * ez - j21 * ex) / det;
      const m = Math.max(Math.abs(de), Math.abs(da));
      if (m > 0.15) { de *= 0.15 / m; da *= 0.15 / m; }
      e += de; a += da;
      L = land(e, a);
    }
    return { v: mk(e, a), elev: e, head: a, land: L, err: Math.hypot(tg.x - L.x, tg.z - L.z) };
  }

  /** Turn a velocity by extra elevation de and heading da (radians), same speed. */
  function turnV(v, de, da) {
    const sp = len(v), h = Math.hypot(v.x, v.z);
    const e = Math.atan2(v.y, h) + de, a = Math.atan2(v.x, v.z) + da;
    return { x: sp * Math.cos(e) * Math.sin(a), y: sp * Math.sin(e), z: sp * Math.cos(e) * Math.cos(a) };
  }

  /** Distance from the boundary's centre (ground plane). */
  function fromCentre(p) { return Math.hypot(p.x - FIELD.CX, p.z - FIELD.CZ); }

  const api = { G, BALL, AIR, PITCH, SURF, FIELD, swingPace, onPitch, ball, bounce, step, run, clone, crossZ, lerp3, hitsStumps, solveRelease, turnV, fromCentre, len, cross };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Phys = api; }
})(typeof window !== 'undefined' ? window : null);
