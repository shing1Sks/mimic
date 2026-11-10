/*
 * Willowlight - the bowling arm. Pure maths, no browser (node games/cricket/test/bowl.test.js).
 *
 * The phone sits in the bowling hand (Grip: top along the forearm, screen = palm, as Emberlane
 * measured on real swings). The player holds HOLD through the run-up and the arm action and
 * lets go to release. Everything the delivery does comes from the phone at that instant:
 *
 *   w        angular velocity (least-squares fit over the samples round the release, raw)
 *   r        forearm direction = the phone's top;  palm = the phone's screen normal
 *   v = w x r L    the hand's velocity (L = 0.70 m, straight bowling arm). Its direction does
 *            not depend on how the phone leans in the fist (a rigid body's w is the same
 *            everywhere), only on the arm's swing plane and where in the arc it let go.
 *   pace     from |v| (a standing player has no run-up, so the run-up's share is added: PACE)
 *   length   from v's elevation against the ideal release (arm just past vertical): letting go
 *            early lofts it full, late drives it short. Scaled by GAIN.len (visible option).
 *   line     from v's heading against straight down the pitch (the phone's zero, CENTRE).
 *   spin     from the wrist's twist about the forearm (w . r): clockwise from the bowler's view
 *            turns the ball to the bowler's right off the pitch (an off-break from a
 *            right-armer), anticlockwise to the left. Big twist = big spin, any arm speed.
 *   swing    from the seam: the palm's heading at release against the direction of travel.
 *            Palm (seam) turned right swings it right. Spin scrambles the seam: no swing.
 *
 * The room and the game differ by a mirror: both players face the TV, the camera sits behind
 * the batter, so the bowler bowls "into the screen" and the ball comes toward the camera.
 * Room x (right) stays screen x, room -z (toward the TV) becomes world +z. Every rule above is
 * written in screen terms, so what the bowler does with the hand is what the ball does on screen.
 *
 * Units: metres, seconds, radians, quaternions {x, y, z, w}, three.js axes.
 */
(function (root) {
  'use strict';
  const Phys = root && root.CK ? root.CK.Phys : require('./phys.js');

  const BOWL = {
    LAG: 30,                  // ms: the key comes up this long after the fingers open
    ARM: 0.70,                // shoulder to ball (m)
    IDEAL_ELEV: -8 * Math.PI / 180,   // hand velocity at the ideal release (arm ~8 deg past vertical)
    MIN_W: 4,                 // rad/s: a slower arm is not a delivery
    MIN_UP: 0.2,              // the forearm must point at least this much up (overarm, not underarm)
    PACE: { A: 8, B: 1.65, MIN: 13.9, MAX: 44 },    // ball m/s = A + B x hand speed (13.9 = 50 km/h)
    SPIN: { K: 8, MIN_TWIST: 4, MAX: 300, SIDE: 0.62, TOP: 0.78, SCRAMBLE: 120 },
    SEAM: { FULL: 25 * Math.PI / 180, LOST: 70 * Math.PI / 180 },
    // visible option BOWLING CONTROL: how much of the release error reaches the ball. Length
    // cannot be 1:1: at 20 rad/s every 10 ms of key timing is 11 deg of release angle (~12 m of
    // length), and the volume key alone jitters by more than that. Line is 1:1 on PRO.
    GAIN: { EASY: { len: 0.02, line: 0.15 }, NORMAL: { len: 0.035, line: 0.25 }, PRO: { len: 0.08, line: 1 } },
    FROM_Z: -18.45,
  };

  // ------------------------------------------------------------------ quaternions
  const S = Math.SQRT1_2;
  const C = { x: -S, y: 0, z: 0, w: S }, Ci = { x: S, y: 0, z: 0, w: S };
  function mul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
  function norm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; }
  function rotate(q, v) { const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conj(q)); return { x: p.x, y: p.y, z: p.z }; }
  function axisAngle(ax, ay, az, a) { const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(a / 2) / l; return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) }; }
  function log(q) {
    const s = q.w < 0 ? -1 : 1, x = q.x * s, y = q.y * s, z = q.z * s, w = Math.min(1, q.w * s);
    const sh = Math.hypot(x, y, z);
    if (sh < 1e-9) return { x: 2 * x, y: 2 * y, z: 2 * z };
    const k = 2 * Math.atan2(sh, w) / sh;
    return { x: x * k, y: y * k, z: z * k };
  }
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = a => Math.hypot(a.x, a.y, a.z);
  const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

  /** Mimic axes 0..2 (phone-frame quaternion xyz, w >= 0) -> world quaternion, as mimic.js. */
  function decodePad(axes) {
    const x = axes[0], y = axes[1], z = axes[2];
    const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    return mul(mul(C, { x, y, z, w }), Ci);
  }
  /** The inverse (tests and the playtest's fake phones). */
  function encodePad(q) {
    let p = mul(mul(Ci, q), C);
    if (p.w < 0) p = { x: -p.x, y: -p.y, z: -p.z, w: -p.w };
    return [p.x, p.y, p.z];
  }
  /** Room -> game for the bowler (the mirror z -> -z): a vector, and an orientation. */
  const mirrorV = v => ({ x: v.x, y: v.y, z: -v.z });
  const mirrorQ = q => ({ x: -q.x, y: -q.y, z: q.z, w: q.w });

  /**
   * Angular velocity (world, rad/s) at tRef from timestamped samples [{t (ms), q}]: a least-
   * squares line through the rotation vectors relative to the sample nearest tRef (Emberlane).
   */
  function fitOmega(samples, tRef, backMs, fwdMs) {
    let win = samples.filter(s => s.t >= tRef - backMs && s.t <= tRef + fwdMs);
    if (win.length < 3) win = samples.filter(s => s.t >= tRef - backMs * 2 && s.t <= tRef + fwdMs * 2);
    if (win.length < 2) return null;
    let ref = win[0];
    for (const s of win) if (Math.abs(s.t - tRef) < Math.abs(ref.t - tRef)) ref = s;
    const rq = conj(ref.q), n = win.length;
    let st = 0;
    const pts = win.map(s => { const t = (s.t - ref.t) / 1000; st += t; return { t, r: log(mul(s.q, rq)) }; });
    const tm = st / n, rm = { x: 0, y: 0, z: 0 };
    for (const p of pts) { rm.x += p.r.x / n; rm.y += p.r.y / n; rm.z += p.r.z / n; }
    let sxx = 0; const sxy = { x: 0, y: 0, z: 0 };
    for (const p of pts) { const d = p.t - tm; sxx += d * d; sxy.x += d * (p.r.x - rm.x); sxy.y += d * (p.r.y - rm.y); sxy.z += d * (p.r.z - rm.z); }
    if (sxx < 1e-10) return null;
    const w = scale(sxy, 1 / sxx);
    const rv = { x: rm.x + w.x * ((tRef - ref.t) / 1000 - tm), y: rm.y + w.y * ((tRef - ref.t) / 1000 - tm), z: rm.z + w.z * ((tRef - ref.t) / 1000 - tm) };
    const ang = len(rv);
    const dq = ang < 1e-9 ? { x: 0, y: 0, z: 0, w: 1 } : axisAngle(rv.x, rv.y, rv.z, ang);
    return { w, q: norm(mul(dq, ref.q)), n };
  }

  /**
   * Velocity at tRef of the point L metres along the phone's top (the hand on a straight arm, the
   * bat's sweet spot): a least-squares line through its positions over +-halfMs. Symmetric, so the
   * swing's acceleration cancels, and a twist about the top cannot move the point (the fitted w
   * of a twisting, swinging arm leans toward the twist axis of the window's average pose).
   */
  function pointVelocity(samples, tRef, L, halfMs) {
    let win = samples.filter(s => Math.abs(s.t - tRef) <= halfMs);
    if (win.length < 3) win = samples.filter(s => Math.abs(s.t - tRef) <= halfMs * 2);
    if (win.length < 3) return null;
    const n = win.length, pts = win.map(s => ({ t: (s.t - tRef) / 1000, p: rotate(s.q, { x: 0, y: 0, z: -L }) }));
    let tm = 0; const pm = { x: 0, y: 0, z: 0 };
    for (const a of pts) { tm += a.t / n; pm.x += a.p.x / n; pm.y += a.p.y / n; pm.z += a.p.z / n; }
    let sxx = 0; const v = { x: 0, y: 0, z: 0 };
    for (const a of pts) { const d = a.t - tm; sxx += d * d; v.x += d * (a.p.x - pm.x); v.y += d * (a.p.y - pm.y); v.z += d * (a.p.z - pm.z); }
    return sxx > 1e-10 ? scale(v, 1 / sxx) : null;
  }

  /** Heading of a horizontal direction (+ = right of straight at the TV, room frame). */
  const heading = v => Math.atan2(v.x, -v.z);

  /** Seam lean -> swing coefficient: full by FULL, scrambled (none) by LOST. */
  function seamSwing(alpha) {
    const a = Math.abs(alpha), s = Math.sign(alpha);
    if (a <= BOWL.SEAM.FULL) return s * a / BOWL.SEAM.FULL;
    const k = clamp((a - BOWL.SEAM.FULL) / (BOWL.SEAM.LOST - BOWL.SEAM.FULL), 0, 1);
    return s * (1 - k);
  }
  function paceFrom(handSpeed) { return clamp(BOWL.PACE.A + BOWL.PACE.B * handSpeed, BOWL.PACE.MIN, BOWL.PACE.MAX); }
  function spinFrom(twist) { const t = Math.abs(twist); return t < BOWL.SPIN.MIN_TWIST ? 0 : Math.min(BOWL.SPIN.MAX, BOWL.SPIN.K * t); }

  /**
   * Read the release from the samples [{t, q}] (room frame), HOLD up at tUp (ms).
   * Returns { ok, why?, t, w, r, palm, v, handSpeed, elev, az, elevErr, twist, alpha, pace (m/s),
   * spin (rad/s), swing (-1..1) }. Signs in screen terms: az + = right, twist + = clockwise from
   * the bowler's view (turns right), alpha + = seam turned right (swings right).
   */
  function readRelease(samples, tUp) {
    const t = tUp - BOWL.LAG;
    const f = fitOmega(samples, t, 24, 24);
    if (!f) return { ok: false, why: 'nodata' };
    const w = f.w, q = f.q;
    const r = rotate(q, { x: 0, y: 0, z: -1 }), palm = rotate(q, { x: 0, y: 1, z: 0 });
    const v = pointVelocity(samples, t, BOWL.ARM, 24) || scale(cross(w, r), BOWL.ARM);
    const handSpeed = len(v), vh = Math.hypot(v.x, v.z);
    const base = { t, w, r, palm, v, handSpeed, wMag: len(w) };
    if (r.y < BOWL.MIN_UP && base.wMag > 1) return Object.assign(base, { ok: false, why: 'underarm' });
    if (base.wMag < BOWL.MIN_W) return Object.assign(base, { ok: false, why: 'slow' });
    if (vh < 0.3 || -v.z < 0.25 * handSpeed) return Object.assign(base, { ok: false, why: 'backward' });
    const elev = Math.atan2(v.y, vh), az = heading(v);
    const twist = dot(w, r);
    const ph = { x: palm.x, z: palm.z };
    const alpha = Math.hypot(ph.x, ph.z) > 0.2 ? wrapPi(heading(ph) - az) : Math.PI / 2;
    const pace = paceFrom(handSpeed), spin = spinFrom(twist);
    const spinness = clamp(spin / BOWL.SPIN.SCRAMBLE, 0, 1);
    return Object.assign(base, { ok: true, elev, az, elevErr: elev - BOWL.IDEAL_ELEV, twist, alpha, pace, spin, swing: seamSwing(alpha) * (1 - spinness) });
  }

  /**
   * The delivery for a release, in the game world. aim: { x, len } where the bowler means to
   * pitch it (len: metres in front of the batter's stumps). o: { arm: +1 the bowling arm on screen
   * right, -1 left; gain: GAIN.NORMAL | GAIN.PRO; rng: () -> 0..1 }.
   * Returns { from, speed, target, w, swing, seamKick, elevAdj, azAdj, spinDir (+1 turns right) }.
   */
  function toDelivery(rel, aim, o) {
    o = o || {};
    const g = o.gain || BOWL.GAIN.NORMAL, rng = o.rng || Math.random;
    const from = { x: 0.34 * (o.arm || 1), y: rel.pace > 30 ? 2.2 : 2.05, z: BOWL.FROM_Z };
    const target = { x: aim.x, z: -aim.len };
    const dx = target.x - from.x, dz = target.z - from.z, dl = Math.hypot(dx, dz) || 1;
    const d = { x: dx / dl, y: 0, z: dz / dl };
    const top = cross({ x: 0, y: 1, z: 0 }, d);      // overspin axis: the ball's top rolls forward
    const sgn = Math.sign(rel.twist || 0);
    const w = rel.spin > 0
      ? { x: -sgn * rel.spin * BOWL.SPIN.SIDE * d.x + rel.spin * BOWL.SPIN.TOP * top.x, y: 0, z: -sgn * rel.spin * BOWL.SPIN.SIDE * d.z + rel.spin * BOWL.SPIN.TOP * top.z }
      : { x: -18 * top.x, y: 0, z: -18 * top.z };      // a seamer's natural backspin
    // an upright seam landing: it may kick either way (random, more for a seamer, none for spin)
    const upright = rel.spin > 0 ? 0 : 1 - Math.min(1, Math.abs(rel.swing) * 0.6);
    const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const seamKick = clamp(gauss() * 0.35 * upright, -0.8, 0.8);
    return { from, speed: rel.pace, target, w, swing: rel.swing || 0, seamKick, elevAdj: g.len * (rel.elevErr || 0), azAdj: g.line * (rel.az || 0), spinDir: rel.spin > 0 ? sgn : 0 };
  }

  /** The ball as it leaves the hand: aim solved (with swing), then the release error added. */
  function launch(del) {
    const s = Phys.solveRelease({ from: del.from, speed: del.speed, target: del.target, w: del.w, swing: del.swing });
    const v = Phys.turnV(s.v, del.elevAdj || 0, del.azAdj || 0);
    return Phys.ball(del.from, v, { w: del.w, swing: del.swing, seamKick: del.seamKick });
  }

  /**
   * What the batter faces, in words: length from where it pitched and the height at the
   * stumps; movement relative to the batter (side: +1 right-handed, -1 left-handed).
   */
  function describe(path, del, side) {
    const tags = [];
    const p = path.pitch, h = path.heightAtBat;
    if (!p || p.z > -0.3) tags.push(h > 1.0 ? 'BEAMER' : 'FULL TOSS');
    else {
      const L = -p.z;
      tags.push(L < 1.8 ? 'YORKER' : L < 4 ? 'FULL' : L < 7 ? 'GOOD LENGTH' : h > 1.3 ? 'BOUNCER' : 'SHORT');
    }
    const away = s => s * (side || 1) > 0;          // moving toward the batter's off side
    if (del.spinDir) tags.push(away(del.spinDir) ? 'LEG-BREAK' : 'OFF-BREAK');
    else if (Math.abs(del.swing) > 0.25 && Phys.swingPace(del.speed) > 0.3) tags.push(away(del.swing) ? 'OUTSWING' : 'INSWING');
    else if (Math.abs(del.seamKick) > 0.25) tags.push(away(del.seamKick) ? 'SEAMS AWAY' : 'SEAMS IN');
    return tags;
  }

  /** Synthetic arm orientation (tests, mouse stand-in, CPU and fake phones): arm angle phi from
   * straight up (+ = forward toward the TV), swing plane heading yaw (+ = right), wrist roll rho
   * about the forearm (+ = clockwise from the bowler's view). Palm faces the TV at rho = 0. */
  function armQuat(phi, yaw, rho) {
    // heading +right = rotation about +y by -yaw; arm tilt about x; palm forward (half turn about
    // the top); then the wrist roll about the top (phone -z): clockwise along the top = about -z
    return norm(mul(mul(mul(axisAngle(0, 1, 0, -(yaw || 0)), axisAngle(1, 0, 0, Math.PI / 2 - phi)), axisAngle(0, 0, 1, Math.PI)), axisAngle(0, 0, -1, rho || 0)));
  }

  const api = { BOWL, mul, conj, norm, rotate, axisAngle, log, cross, dot, len, scale, clamp, wrapPi, decodePad, encodePad, mirrorV, mirrorQ,
    fitOmega, pointVelocity, heading, seamSwing, paceFrom, spinFrom, readRelease, toDelivery, launch, describe, armQuat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Bowl = api; }
})(typeof window !== 'undefined' ? window : null);
