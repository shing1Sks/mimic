/*
 * Willowlight - the bowling arm. Pure maths, no browser (node games/cricket/test/bowl.test.js).
 *
 * The phone sits in the bowling hand (Grip: top along the forearm). The player holds HOLD
 * through the run-up and the arm action and lets go to release.
 *
 * The release is anchored on the WHIP, not on the key. The user's first real session
 * (recordings/cricket-20261110-201345, 4 deliveries) showed the arm cocked behind the head,
 * almost still, then a whip of 150-200 ms peaking at 15-22 m/s of hand speed; Vol Down came up
 * between 92 ms before and 25 ms after the whip's peak (median -29 ms). Read at key-up, the arm
 * was often still behind the head: headings of 40-57 deg (huge wides) on two of four balls. Read
 * at the whip's peak, all four headed within 7 deg of straight. So:
 *
 *   whip     the fastest moment of the hand moving forward with the arm up (the point L =
 *            0.70 m along the phone's top, a symmetric least-squares fit of its positions) within
 *            -WIN_BEFORE..+WIN_AFTER ms of the key-up. The ball leaves the hand there. Session 2
 *            (26 throws): the plain fastest moment was often the wind-up going back or the
 *            follow-through coming down, which called 11 good throws "backward" / "underarm".
 *   line-up  people let go at their own moment (session medians -29 / +52 ms) and swing in their
 *            own plane (session 2: 17 deg left of the phone's zero on average, the bowling arm
 *            coming across the body). With LINE-UP AUTO (a visible option) length and line are
 *            measured from the player's own last 5 balls, so only a change from their habit
 *            moves the ball; the first ball uses the defaults.
 *   pace     from the whip's hand speed (a standing player has no run-up: PACE adds its share)
 *   length   from when the key came up against the whip: earlier than the natural timing
 *            (DT_IDEAL) floats it fuller, later drags it shorter, GAIN.len metres per second
 *            (visible option BOWLING CONTROL). The aim spot is where an on-time ball pitches.
 *   line     from the hand's heading at the whip against straight down the pitch (the phone's
 *            zero, CENTRE). A rigid body's w is the same everywhere, so the phone's lean in the
 *            fist does not move it. Scaled by GAIN.line (visible option).
 *   spin     from the wrist's twist about the forearm (w . r): clockwise from the bowler's view
 *            turns the ball to the bowler's right off the pitch, anticlockwise to the left. Real
 *            throws twisted up to 6 rad/s without meaning to: spin starts at MIN_TWIST.
 *   swing    from the seam: the palm's (screen's) heading at the whip against the direction of
 *            travel, measured from the player's own natural grip (the real screen sat 95-137 deg
 *            off the line of travel: the phone does not lie on the palm). Spin scrambles it.
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
    ARM: 0.70,                // shoulder to ball (m)
    WIN_BEFORE: 400, WIN_AFTER: 300,   // ms round the key-up where the whip is looked for
    // ms: key-up against the whip's peak on an on-time ball, until the player's own habit is
    // learned (line-up). Session 1 let go 29 ms before the peak (median), session 2 52 ms after.
    DT_IDEAL: 0,
    MIN_HAND: 5,              // m/s at the whip: slower is not a delivery (real whips 15-22)
    TAP_MS: 220,              // a shorter press with no whip is a stray tap, not a delivery
    MIN_UP: 0.2,              // the forearm must point at least this much up at the whip (overarm)
    // ball m/s = A + B x hand speed: real whips of 15 / 22 m/s bowl 108 / 145 km/h
    PACE: { A: 8, B: 1.45, MIN: 13.9, MAX: 44 },
    SPIN: { K: 8, MIN_TWIST: 7, MAX: 300, SIDE: 0.62, TOP: 0.78, SCRAMBLE: 120 },
    SEAM: { FULL: 25 * Math.PI / 180, LOST: 70 * Math.PI / 180 },
    // visible option BOWLING CONTROL. The marker says where the ball pitches; the action only
    // costs a small miss (2026-11-14 rework: 7 of 9 real balls had come out full tosses when the
    // timing and the arm's heading set the length and line outright). len: metres per second of
    // key timing off the player's habit; line: metres per radian of the arm off their line;
    // pace: the spread (m, 1 sd) of a flat-out 44 m/s ball, by (pace/44)^3; cap: the most it misses.
    GAIN: { EASY: { len: 2, line: 0.75, pace: 0.1, cap: 0.5 }, NORMAL: { len: 4, line: 1.5, pace: 0.2, cap: 1.0 }, PRO: { len: 8, line: 3, pace: 0.35, cap: 1.8 } },
    // aiming by tilt from the settled stance: metres of line / length per radian, a dead zone for
    // the hand's tremor, and the strip the marker stays inside (yorker to bouncer, on the cut pitch)
    AIM: { LINE: 2.2, LENGTH: 11, DEAD: 0.045, X: 1.0, LEN: [0.3, 11] },
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
   * The whip: the hand's fastest moment moving forward with the arm up, within the window round
   * the key-up (null if none yet). .any: the fastest moment of any kind (to say what went wrong).
   */
  function findWhip(samples, tUp) {
    let best = null, any = null;
    for (const s of samples) {
      if (s.t < tUp - BOWL.WIN_BEFORE || s.t > tUp + BOWL.WIN_AFTER) continue;
      const v = pointVelocity(samples, s.t, BOWL.ARM, 30);
      if (!v) continue;
      const sp = len(v), up = rotate(s.q, { x: 0, y: 0, z: -1 }).y;
      const c = { t: s.t, speed: sp, v, up, fwd: -v.z >= 0.25 * sp };
      if (!any || sp > any.speed) any = c;
      if (c.fwd && up >= BOWL.MIN_UP && (!best || sp > best.speed)) best = c;
    }
    if (best) best.any = any;
    return best || (any ? { none: true, any } : null);
  }
  /** Have enough samples arrived after the key-up to know the whip (it peaked and fell away)? */
  function whipKnown(samples, tUp) {
    const last = samples.length ? samples[samples.length - 1].t : 0;
    if (last >= tUp + BOWL.WIN_AFTER) return true;
    const w = findWhip(samples, tUp);
    if (!w || w.none || last < w.t + 50) return false;
    const v = pointVelocity(samples, last - 15, BOWL.ARM, 15);
    return !!v && len(v) < 0.5 * w.speed;
  }

  /**
   * Read the release from the samples [{t, q}] (room frame), HOLD up at tUp (ms).
   * o: { tPress (ms), seamRef (rad: the player's natural palm angle from earlier balls),
   *      dtRef (ms: their natural key timing), azRef (rad: their natural line) }.
   * Returns { ok, why?, t (the whip), dt (key-up - whip, ms), w, r, palm, v, handSpeed, az,
   * lenErr (s off the natural timing, + = late = shorter), twist, alpha (raw palm angle), seam,
   * pace (m/s), spin, swing }. Signs in screen terms: az + = right, twist + = clockwise from the
   * bowler (turns right), seam + = turned right (swings right).
   * why: 'tap' | 'nowhip' | 'underarm' | 'backward'.
   */
  function readRelease(samples, tUp, o) {
    o = o || {};
    const held = o.tPress != null ? tUp - o.tPress : Infinity;
    const wh = findWhip(samples, tUp);
    if (!wh || wh.none || wh.speed < BOWL.MIN_HAND) {
      const a = wh && wh.any, hs = a ? a.speed : 0;
      const why = held < BOWL.TAP_MS && hs < BOWL.MIN_HAND ? 'tap' : !a || hs < BOWL.MIN_HAND ? 'nowhip' : !a.fwd ? 'backward' : 'underarm';
      return { ok: false, why, handSpeed: hs, dt: a ? tUp - a.t : null };
    }
    const f = fitOmega(samples, wh.t, 30, 30);
    if (!f) return { ok: false, why: 'nowhip', handSpeed: wh.speed };
    const w = f.w, q = f.q, v = wh.v;
    const r = rotate(q, { x: 0, y: 0, z: -1 }), palm = rotate(q, { x: 0, y: 1, z: 0 });
    const handSpeed = wh.speed, vh = Math.hypot(v.x, v.z), dt = tUp - wh.t;
    const base = { t: wh.t, dt, w, r, palm, v, handSpeed, wMag: len(w) };
    if (r.y < BOWL.MIN_UP) return Object.assign(base, { ok: false, why: 'underarm' });
    if (vh < 0.3 || -v.z < 0.25 * handSpeed) return Object.assign(base, { ok: false, why: 'backward' });
    const az = heading(v), twist = dot(w, r);
    const ph = { x: palm.x, z: palm.z };
    const alpha = Math.hypot(ph.x, ph.z) > 0.2 ? wrapPi(heading(ph) - az) : 0;
    const seam = wrapPi(alpha - (o.seamRef != null ? o.seamRef : alpha));
    const pace = paceFrom(handSpeed), spin = spinFrom(twist);
    const spinness = clamp(spin / BOWL.SPIN.SCRAMBLE, 0, 1);
    const dtRef = o.dtRef != null ? o.dtRef : BOWL.DT_IDEAL, azRef = o.azRef != null ? o.azRef : 0;
    return Object.assign(base, { ok: true, azRaw: az, az: wrapPi(az - azRef), dtRef, azRef, lenErr: (dt - dtRef) / 1000, twist, alpha, seam, pace, spin, swing: seamSwing(seam) * (1 - spinness) });
  }

  /** Median of a player's recent values (null when there are none). */
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  /** The player's natural palm angle: the circular median of their recent balls' raw alpha. */
  function seamNeutral(alphas) {
    if (!alphas.length) return null;
    const ref = alphas[alphas.length - 1];
    const d = alphas.map(a => wrapPi(a - ref)).sort((a, b) => a - b);
    return wrapPi(ref + d[d.length >> 1]);
  }

  /**
   * The delivery for a release, in the game world. aim: { x, len } where the bowler means to
   * pitch it (len: metres in front of the batter's stumps). o: { arm: +1 the bowling arm on screen
   * right, -1 left; gain: GAIN.*; rng: () -> 0..1; view: 'bowler' when the bowler watches from
   * behind his own arm (screen right = world -x: the room is the world turned half round, no
   * mirror) or 'batter' (camera behind the batter, the bowler mirrored into the screen) }.
   * Returns { from, speed, target, aim, w, swing, seamKick, azAdj, lenAdj, spinDir (+1 turns right) }.
   */
  function toDelivery(rel, aim, o) {
    o = o || {};
    const g = o.gain || BOWL.GAIN.NORMAL, rng = o.rng || Math.random;
    const sx = o.view === 'bowler' ? -1 : 1;   // screen right in world x
    const from = { x: 0.34 * (o.arm || 1) * sx, y: rel.pace > 30 ? 2.2 : 2.05, z: BOWL.FROM_Z };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2.5, 2.5); };
    // the miss: timing and arm line against the player's habit, and the spread of bowling flat out
    const cap = g.cap != null ? g.cap : 1, flat = Math.pow(clamp((rel.pace || 0) / BOWL.PACE.MAX, 0, 1), 3) * (g.pace || 0);
    const lenAdj = clamp(g.len * (rel.lenErr || 0) + gauss() * flat, -cap, cap);
    const lineAdj = clamp(g.line * (rel.az || 0) + gauss() * flat * 0.6, -cap * 0.6, cap * 0.6);   // screen right +
    const target = { x: aim.x + lineAdj * sx, z: -clamp(aim.len + lenAdj, -1.5, 13) };
    const dx = target.x - from.x, dz = target.z - from.z, dl = Math.hypot(dx, dz) || 1;
    const d = { x: dx / dl, y: 0, z: dz / dl };
    const top = cross({ x: 0, y: 1, z: 0 }, d);      // overspin axis: the ball's top rolls forward
    const sgn = Math.sign(rel.twist || 0) * sx;
    const w = rel.spin > 0
      ? { x: -sgn * rel.spin * BOWL.SPIN.SIDE * d.x + rel.spin * BOWL.SPIN.TOP * top.x, y: 0, z: -sgn * rel.spin * BOWL.SPIN.SIDE * d.z + rel.spin * BOWL.SPIN.TOP * top.z }
      : { x: -18 * top.x, y: 0, z: -18 * top.z };      // a seamer's natural backspin
    const swing = (rel.swing || 0) * sx;
    const upright = rel.spin > 0 ? 0 : 1 - Math.min(1, Math.abs(swing) * 0.6);
    const seamKick = clamp(gauss() * 0.35 * upright, -0.8, 0.8);
    return { from, speed: rel.pace, target, aim: { x: aim.x, len: aim.len }, w, swing, seamKick, lenAdj, lineAdj, azAdj: 0, spinDir: rel.spin > 0 ? sgn : 0 };
  }

  /** The ball as it leaves the hand: aim solved (with swing), then the release error added. */
  function launch(del) {
    const s = Phys.solveRelease({ from: del.from, speed: del.speed, target: del.target, w: del.w, swing: del.swing });
    const v = Phys.turnV(s.v, 0, del.azAdj || 0);
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

  /**
   * The aim marker from a tilt of the phone since it settled (q0, room frame), any grip: tipping it
   * toward the screen (about the room's x axis) pitches it fuller, moving its top right or left
   * moves the line. From the bowler's end screen right is world -x. base: { x, len } the start spot.
   */
  function tiltAim(q0, q, base) {
    const A = BOWL.AIM, dq = mul(q, conj(q0)), rv = log(dq);
    const f0 = rotate(q0, { x: 0, y: 0, z: -1 }), f = rotate(dq, f0);
    // the top's sideways move (an upright phone rolled, a level one turned), as an angle
    const side = Math.asin(clamp(f.x, -1, 1)) - Math.asin(clamp(f0.x, -1, 1));
    const fwd = -rv.x;
    const dz = a => Math.abs(a) <= A.DEAD ? 0 : a - Math.sign(a) * A.DEAD;
    return { x: clamp(base.x - dz(side) * A.LINE, -A.X, A.X), len: clamp(base.len - dz(fwd) * A.LENGTH, A.LEN[0], A.LEN[1]) };
  }
  /** Has the phone held still (within tol rad of its latest pose) for the last ms? */
  function steady(samples, ms, tol) {
    tol = tol || 0.06;
    const n = samples.length;
    if (n < 3) return false;
    const last = samples[n - 1], t0 = last.t - ms;
    if (samples[0].t > t0) return false;
    const lc = conj(last.q);
    for (let i = n - 1; i >= 0 && samples[i].t >= t0; i--) if (len(log(mul(samples[i].q, lc))) > tol) return false;
    return true;
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
    fitOmega, pointVelocity, heading, seamSwing, paceFrom, spinFrom, findWhip, whipKnown, readRelease, median, seamNeutral, toDelivery, launch, describe, armQuat, tiltAim, steady };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Bowl = api; }
})(typeof window !== 'undefined' ? window : null);
