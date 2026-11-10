/*
 * Emberlane - the bowling arm. Pure maths, no browser needed (node test/kin.test.js).
 *
 * The phone is the ball in your hand. It measures its orientation precisely (~125 Hz) but not
 * where it is, so the hand's position comes from a physical arm: the shoulder is fixed, the arm
 * is straight (a bowler's arm is), and the phone's orientation swings it. Whatever the phone
 * does, the hand does:
 *
 *   Rd(t)   = Ry(-yaw) q(t) q0^-1   rotation of the hand since hanging, in the lane frame
 *                                   (laneRef / gripRef: no align needed)
 *   hand(t) = shoulder + body(t) + armVec(Rd(t))   (armVec ~ Rd * (0, -L, 0), L = 0.70 m)
 *
 * armVec: the forearm and hand follow the phone exactly; the elbow is nearly locked, the upper
 * arm trailing by a slight natural bend that grows with the swing angle (zero at the bottom).
 * body(t): the approach steps and the lunge, from the phone's accelerometer minus what the arm
 * alone would do (createBody / bodyUpdate below), starting from rest at the grip.
 *
 * At align (q0) the arm hangs straight down with the palm toward the pins, whatever way the
 * phone sits in the hand. Nothing is smoothed, clamped or assisted: the hand turns with the
 * phone every sample.
 *
 * Letting go: the ball leaves with the hand's real velocity at that instant, measured: the
 * accelerometer integrated over the downswing from the backswing apex (handVelocity, v5). Only
 * without it (mouse, a Bluetooth gap, a clipped 8 g reading) does the arm model's v = w x r (+ the
 * body's velocity) stand in, where
 * w is the phone's measured angular velocity (least-squares fit over the samples around the
 * release, so sensor noise does not leak in) and r the shoulder-to-ball vector. Real metres per
 * second, in the real direction, including up/down (a late release lofts, an early one drops).
 * The ball also keeps the hand's rotation, except the wrist twist about the arm: the fingers
 * leave the ball last, on its side, so a twist rolls the ball sideways instead of spinning it
 * like a top (finger speed = twist x FINGER_R, ball surface speed the same -> side roll rate =
 * twist x FINGER_R / R). That side roll is what hooks it on the dry back end. The thumb leaves
 * first and the ball rolls off the fingertips with forward roll (ROLL_OFF x v / R, ~250-350 rpm
 * at 20-30 km/h): a fixed physical constant of the release, it never changes speed or direction.
 * Without it the ball skids out of the hand with the arm's backspin and loses ~30% of its speed
 * turning that into a roll; with it, ~16%, as on a real lane.
 *
 * Units: metres, seconds, radians. Axes as three.js: x right, y up, z toward the bowler; the
 * lane runs toward -z. Quaternions are {x, y, z, w}.
 */
(function (root) {
  'use strict';

  const ARM = {
    L: 0.70,             // shoulder to ball centre, arm straight (m); configurable (setArm)
    UPPER: 0.31,         // shoulder to elbow (m); the rest is forearm + hand to the ball centre
    ELBOW_LAG: 0.07,     // the slight natural bend: the upper arm trails the forearm by
                         // LAG x angle x sin(angle) (0 hanging and straight up, ~6 deg at 90)
    FINGER_R: 0.085,     // fingertips from the forearm's twist axis (m)
    BALL_R: 0.1085,
    ROLL_OFF: 0.6,       // the thumb leaves first and the ball rolls off the fingertips: forward
                         // roll at release = ROLL_OFF x speed / R (a real release, ~250-350 rpm)
    V_MAX: 13.5,         // physical sanity only: faster than any human has rolled a ball
    W_MAX: 90,           // rad/s, ~860 rpm: beyond any human
  };
  /** Body (approach steps and lunge) from the phone's linear acceleration. */
  const BODY = {
    // OFF: on the user's first real recording the tracker measured the arm model's error, not
    // the body: the hand really moved level and at ~55-80% of the model's speed through the
    // release, so "body" = measured - model sat at its clamps (vertical -1.5 m/s on 6 of 9 real
    // swings) and the accelerometer integration still drifts ~0.7 m/s rms over a 3 s swing (with
    // the 25 ms accelerometer delay found in the recording compensated). See tools/replay.js.
    USE: false,
    G: 9.80665, ACC_FS: 8 * 9.80665,   // axes 3..5 full scale = 8 g
    SAT: 0.995,          // |axis| at full scale: clipped, not trusted. The app clamps to +-32767
                         // (8 g); 0.97 (7.76 g) threw out a real, isolated 7.78 g reading just
                         // after a release (2026-11-10 03:23 throw 3: arm model 34 km/h vs 19.6)
    HALF: 4,             // samples each side for the centred arm-velocity fit (~32 ms at 125 Hz):
                         // a cubic, so the fast-changing swing near the bottom is not biased
    TAU: 6,              // leak (s): slow, so a whole approach keeps its speed; drift from a 1 deg
                         // tilt error stays ~0.3 m/s over a 2 s swing (and ZUPT at the grip)
    ZUPT_W: 0.8, ZUPT_A: 0.9, ZUPT_MS: 90,   // still phone for 90 ms = the body is still
    DEAD: 0.3,           // m/s: below this the body fades out (quadratically): sensor and fit noise
    V_MAX: 3.5,          // m/s, horizontal (a brisk approach)
    FWD: 1.5, BACK: 0.35, SIDE: 0.45, DOWN: 0.4, UP: 0.12,   // where the shoulder may go (m)
  };

  /**
   * The hand's true velocity at the release, measured (handVelocity below): the accelerometer
   * integrated over the downswing only, from the backswing apex where the hand is at rest.
   */
  const HAND = {
    USE: true,
    LAG: 20,             // ms: the accelerometer reading in a report is this much older than its
                         // orientation (fit on the user's recording: 15-20 ms minimises the
                         // apex-to-follow-through closure error, 0 and 40 ms are 30-60% worse)
    APEX_BACK: 700,      // ms before the release: where the backswing apex is looked for ...
    APEX_MIN: 120,       // ... up to this close to the release (the recording: 250-630 ms)
    GAP: 70,             // ms: a Bluetooth gap longer than this inside the window: not measured
    RETIME: 3,           // samples each side: arrival times smoothed by a local line (Bluetooth
                         // delivers in bursts: 1-45 ms between reports of a steady 8 ms stream)
  };

  // ------------------------------------------------------------------ quaternions
  const S = Math.SQRT1_2;
  const C = { x: -S, y: 0, z: 0, w: S }, Ci = { x: S, y: 0, z: 0, w: S };   // phone frame <-> world
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
  function rotate(q, v) {
    const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conj(q));
    return { x: p.x, y: p.y, z: p.z };
  }
  function axisAngle(ax, ay, az, a) {
    const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(a / 2) / l;
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) };
  }
  /** Rotation vector (axis * angle) of a unit quaternion, the short way round. */
  function log(q) {
    const s = q.w < 0 ? -1 : 1, x = q.x * s, y = q.y * s, z = q.z * s, w = Math.min(1, q.w * s);
    const sh = Math.hypot(x, y, z);
    if (sh < 1e-9) return { x: 2 * x, y: 2 * y, z: 2 * z };
    const k = 2 * Math.atan2(sh, w) / sh;
    return { x: x * k, y: y * k, z: z * k };
  }
  function slerp(a, b, t) {
    let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const bb = d < 0 ? { x: -b.x, y: -b.y, z: -b.z, w: -b.w } : b;
    d = Math.abs(d);
    if (d > 0.9995) return norm({ x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t, z: a.z + (bb.z - a.z) * t, w: a.w + (bb.w - a.w) * t });
    const th = Math.acos(d), s = Math.sin(th), ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
    return { x: a.x * ka + bb.x * kb, y: a.y * ka + bb.y * kb, z: a.z * ka + bb.z * kb, w: a.w * ka + bb.w * kb };
  }
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = a => Math.hypot(a.x, a.y, a.z);
  const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

  /** Mimic Wand/Grip axes 0..2 (phone-frame quaternion xyz, w >= 0) -> world quaternion (as mimic.js). */
  function decodePad(axes) {
    const x = axes[0], y = axes[1], z = axes[2];
    const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    return mul(mul(C, { x, y, z, w }), Ci);
  }
  /** The inverse, for tests and the playtest's fake phone: world quaternion -> axes 0..2. */
  function encodePad(q) {
    let p = mul(mul(Ci, q), C);
    if (p.w < 0) p = { x: -p.x, y: -p.y, z: -p.z, w: -p.w };
    return [p.x, p.y, p.z];
  }

  /** Align pose used until the player aligns: phone hanging top-down, screen toward the pins. */
  const DEFAULT_Q0 = axisAngle(1, 0, 0, -Math.PI / 2);

  /**
   * The lane frame. The phone reports its orientation in its own world frame: pitch and roll are
   * absolute (gravity), the heading is relative to a zero the phone app sets when the mode starts
   * (top edge toward the screen). A lane reference turns that into the lane's frame:
   *   Rd = Ry(-yaw) * q * q0^-1
   * yaw: the lane's forward direction in the phone's world frame (rad, + = left);
   * q0: how the phone sits in the hand when the arm hangs palm-forward (default DEFAULT_Q0: top
   * along the forearm, which the user's real Grip recording confirms: the centripetal
   * acceleration of every fast swing points along the phone's long axis).
   * A plain quaternion is still accepted as a reference (the old full-pose align, tests).
   */
  function laneRef(yaw, q0) {
    yaw = yaw || 0;
    return { yaw, q0: q0 || DEFAULT_Q0, L: axisAngle(0, 1, 0, -yaw) };
  }
  /** Rotation of the hand since the hanging pose, in the lane frame. ref: laneRef or quaternion. */
  function handRot(q, ref) {
    if (!ref) return norm(mul(q, conj(DEFAULT_Q0)));
    if (ref.w !== undefined) return norm(mul(q, conj(ref)));
    return norm(mul(ref.L, mul(q, conj(ref.q0))));
  }
  /** A world-frame vector of the phone's frame into the lane frame. */
  function toLane(ref, v) { return ref && ref.L ? rotate(ref.L, v) : v; }
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  /**
   * Where the arm (forearm, the phone's top) points for phone orientation q, in the phone's world
   * frame: heading (rad, + = left of the phone's zero) and tilt from hanging (rad).
   */
  function armHeading(q, q0) {
    const d = rotate(norm(mul(q, conj(q0 || DEFAULT_Q0))), { x: 0, y: -1, z: 0 });
    return { yaw: Math.atan2(-d.x, -d.z), tilt: Math.acos(Math.max(-1, Math.min(1, -d.y))) };
  }
  /**
   * The lane reference for one throw, taken when the ball is gripped (v6). No align needed:
   *  - by default straight down the lane = the forearm's heading at the grip (the phone's top
   *    in the stance: forearm held out in front, Vol Down pressed) turned HOLD toward the
   *    non-bowling side. The phone does not sit straight in the fist: its top points outward of
   *    the line the arm swings in (it also leans 7-19 deg outward at the bottom of the swing),
   *    so the forearm at the grip reads ~15 deg right of where a right-hander then swings. That
   *    offset was the same in both real sessions (median swing plane - grip heading 13.4 and
   *    16.9 deg); the phone's own heading zero was not: the Mimic app sets it from however the
   *    phone happens to be held when Grip starts (screen up in the hand, top forward-ish), and
   *    the swings sat within +-13 deg of it one session (2026-11-10 01:37) and +13..+30 deg off
   *    it the next (03:23). Taken per throw, the reference also follows the player turning in
   *    the room and any yaw drift of the phone's game rotation vector (no magnetometer).
   *  - arm hanging at the grip (forearm < TILT_MIN from vertical: no heading to read): the
   *    phone's zero (base);
   *  - a manual CENTRE re-zero (o.aligned): its forearm heading (base) is straight, as before.
   * o.side: 1 right-handed, -1 left-handed (the offset mirrors); o.hold overrides HOLD (rad).
   * Pitch and roll stay absolute; nothing about the swing itself is used (no aim assist).
   * (tools/replay.js --zero: the phone's zero as the lane, the v4/v5 default, for comparison.)
   */
  const REF = { TILT_MIN: 25 * Math.PI / 180, HOLD: 15 * Math.PI / 180 };
  function gripRef(q, base, o) {
    base = base || 0; o = o || {};
    const a = armHeading(q);
    let yaw = base, src = o.aligned ? 'centre' : 'phone';
    if (!o.aligned && a.tilt > REF.TILT_MIN) {
      let g = a.yaw;
      if (Math.abs(wrapPi(g - base)) > Math.PI / 2 && a.tilt > Math.PI / 2 + REF.TILT_MIN) g = wrapPi(g + Math.PI);   // arm held back
      yaw = wrapPi(g + (o.side || 1) * (o.hold != null ? o.hold : REF.HOLD)); src = 'grip';
    }
    return { ref: laneRef(yaw), yaw, src, armYaw: a.yaw, tilt: a.tilt };
  }

  /**
   * Line-up: the player's own HOLD (gripRef's offset between the forearm at the grip and the
   * line the arm then swings in), learned from a few practice swings aimed straight at the pins.
   * Real sessions: 13.4 and 16.9 deg for one player; another grip can sit anywhere from straight
   * to ~35 deg. Each practice swing's heading is measured with hold 0 and aim 1:1. Three swings
   * that agree within LINEUP.SPREAD set it (median); a wild one asks for another, up to MAX.
   * Only practice swings are used: real throws never move it (no aim assist).
   */
  const LINEUP = { N: 3, MAX: 5, SPREAD: 25 * Math.PI / 180, MIN_V: 4 / 3.6, MAX_OFF: 45 * Math.PI / 180,
    LO: -10 * Math.PI / 180, HI: 35 * Math.PI / 180 };
  const lineup = {
    C: LINEUP,
    /** Does this practice release count (rb from throwFrom with hold 0, aim 1)? */
    valid: rb => !!rb && rb.speed >= LINEUP.MIN_V && Math.abs(rb.heading) <= LINEUP.MAX_OFF,
    /** raws: valid swing headings (rad, + = left); side 1 right / -1 left. -> { done, more, hold (rad) } */
    result(raws, side) {
      const h = raws.map(x => x * (side || 1)).sort((a, b) => a - b), n = h.length;
      const med = n ? (n % 2 ? h[(n - 1) / 2] : (h[n / 2 - 1] + h[n / 2]) / 2) : REF.HOLD;
      const hold = Math.max(LINEUP.LO, Math.min(LINEUP.HI, med));
      if (n < LINEUP.N) return { done: false, more: false, hold, n };
      // the N swings closest to the median agree?
      const near = [...h].sort((a, b) => Math.abs(a - med) - Math.abs(b - med)).slice(0, LINEUP.N);
      const spread = Math.max(...near) - Math.min(...near);
      const done = spread <= LINEUP.SPREAD || n >= LINEUP.MAX;
      return { done, more: !done, hold, n, spread };
    },
  };

  /**
   * Shoulder -> ball centre for a hand rotation. The forearm and hand follow the phone exactly
   * (direction d = Rd * down); the upper arm trails it by a small angle in the swing plane, the
   * elbow's natural bend. At the bottom of the swing the bend is zero and grows smoothly, so the
   * hand speed through the bottom is exactly w x L. A wrist twist turns neither part.
   */
  function armVec(Rd) {
    const d = rotate(Rd, { x: 0, y: -1, z: 0 });
    const F = ARM.L - ARM.UPPER;
    const c = Math.max(-1, Math.min(1, -d.y)), th = Math.acos(c);
    let u = d;
    const lag = ARM.ELBOW_LAG * th * Math.sin(th);
    if (lag > 1e-6) {
      // turn d back toward hanging by `lag`, in the plane (down, d)
      let ax = cross({ x: 0, y: -1, z: 0 }, d);
      const al = len(ax);
      ax = al > 1e-6 ? scale(ax, 1 / al) : { x: 1, y: 0, z: 0 };
      u = rotate(axisAngle(ax.x, ax.y, ax.z, -lag), d);
    }
    return { x: u.x * ARM.UPPER + d.x * F, y: u.y * ARM.UPPER + d.y * F, z: u.z * ARM.UPPER + d.z * F };
  }
  /** Change the arm (metres): { L, UPPER, ELBOW_LAG, ROLL_OFF }. */
  function setArm(o) { Object.assign(ARM, o || {}); }

  /**
   * Swing angles -> hand rotation (mouse stand-in and tests): yaw about up (+ = left), phi = arm
   * angle from hanging (+ = forward), twist about the arm (+ = anticlockwise seen from above).
   */
  function swingRot(yaw, phi, twist) {
    return norm(mul(mul(axisAngle(0, 1, 0, yaw), axisAngle(1, 0, 0, phi)), axisAngle(0, 1, 0, twist || 0)));
  }

  /**
   * Angular velocity (world, rad/s) around time tRef from timestamped samples [{t (ms), q}],
   * by a least-squares line through the rotation vectors relative to the sample nearest tRef.
   * Returns { w, q (orientation at tRef), n (samples used) } or null.
   */
  function fitOmega(samples, tRef, backMs, fwdMs) {
    backMs = backMs == null ? 40 : backMs; fwdMs = fwdMs == null ? 16 : fwdMs;
    let win = samples.filter(s => s.t >= tRef - backMs && s.t <= tRef + fwdMs);
    if (win.length < 3) win = samples.filter(s => s.t >= tRef - backMs * 2 && s.t <= tRef + fwdMs * 2);
    if (win.length < 2) return null;
    let ref = win[0];
    for (const s of win) if (Math.abs(s.t - tRef) < Math.abs(ref.t - tRef)) ref = s;
    const rq = conj(ref.q);
    let st = 0, n = win.length;
    const pts = win.map(s => { const t = (s.t - ref.t) / 1000; st += t; return { t, r: log(mul(s.q, rq)) }; });
    const tm = st / n;
    let sxx = 0; const sxy = { x: 0, y: 0, z: 0 }, rm = { x: 0, y: 0, z: 0 };
    for (const p of pts) { rm.x += p.r.x / n; rm.y += p.r.y / n; rm.z += p.r.z / n; }
    for (const p of pts) {
      const dt = p.t - tm; sxx += dt * dt;
      sxy.x += dt * (p.r.x - rm.x); sxy.y += dt * (p.r.y - rm.y); sxy.z += dt * (p.r.z - rm.z);
    }
    if (sxx < 1e-10) return null;
    const w = scale(sxy, 1 / sxx);
    // orientation at tRef: the fitted line evaluated there, applied to the reference
    const tr = (tRef - ref.t) / 1000;
    const rv = add(rm, scale(w, tr - tm));
    const ang = len(rv);
    const dq = ang < 1e-9 ? { x: 0, y: 0, z: 0, w: 1 } : axisAngle(rv.x, rv.y, rv.z, ang);
    return { w, q: norm(mul(dq, ref.q)), n };
  }

  /**
   * Everything about the hand at the release instant tRef, from the samples around it:
   *  - v: the hand's (ball centre's) velocity, a least-squares line through the arm-model
   *    positions shoulder->ball of the samples within +-28 ms of tRef. This is w x r computed
   *    the robust way: a twist about the arm cannot move the hand, so it cannot leak in.
   *  - w: angular velocity (fitOmega), for the wrist twist and the ball's spin;
   *  - Rd: the hand rotation at tRef.
   */
  function fitRelease(samples, tRef, q0, halfMs) {   // q0: lane reference (laneRef) or quaternion
    halfMs = halfMs == null ? 28 : halfMs;
    const om0 = fitOmega(samples, tRef, 40, 16);
    if (!om0) return null;
    const om = { w: toLane(q0, om0.w), q: om0.q, n: om0.n };
    // symmetric window: a straight line through the positions is then the velocity at tRef
    // (acceleration cancels; only the third derivative is left)
    let win = samples.filter(s => Math.abs(s.t - tRef) <= halfMs);
    if (win.length < 4) win = samples.filter(s => Math.abs(s.t - tRef) <= halfMs * 2);
    const Rd = handRot(om.q, q0);
    let v;
    if (win.length >= 3) {
      let st = 0; const n = win.length;
      const pts = win.map(s => { const t = (s.t - tRef) / 1000; st += t; return { t, p: armVec(handRot(s.q, q0)) }; });
      const tm = st / n, pm = { x: 0, y: 0, z: 0 };
      for (const q of pts) { pm.x += q.p.x / n; pm.y += q.p.y / n; pm.z += q.p.z / n; }
      let sxx = 0; v = { x: 0, y: 0, z: 0 };
      for (const q of pts) { const d = q.t - tm; sxx += d * d; v.x += d * (q.p.x - pm.x); v.y += d * (q.p.y - pm.y); v.z += d * (q.p.z - pm.z); }
      v = scale(v, 1 / Math.max(1e-12, sxx));
    } else {
      v = cross(om.w, armVec(Rd));
    }
    return { v, w: om.w, Rd, q: om.q, n: win.length };
  }

  /**
   * The ball as it leaves the hand.
   * o: { w (world angular velocity of the phone), Rd (hand rotation at release), shoulder {x,y,z},
   *      v (optional: the hand velocity from fitRelease; default w x r) }
   * Returns { pos, v, spin, speed, heading (rad, + = left of straight), loft (rad, + = up),
   *           twist (rad/s about the arm, + = anticlockwise from above), sideRoll (rad/s),
   *           rpm (total ball rotation), capped }.
   */
  function releaseBall(o) {
    const r = armVec(o.Rd);
    const pos = add(add(o.shoulder, o.bodyP || { x: 0, y: 0, z: 0 }), o.plane === false ? r : planeArm(r, o.w));
    let v = o.v ? { x: o.v.x, y: o.v.y, z: o.v.z } : cross(o.w, r);
    const armV = { x: v.x, y: v.y, z: v.z };
    const bodyV = o.bodyV ? releaseBodyV(o.bodyV, armV) : { x: 0, y: 0, z: 0 };
    v = add(v, bodyV);
    let speed = len(v), capped = false;
    if (speed > ARM.V_MAX) { v = scale(v, ARM.V_MAX / speed); speed = ARM.V_MAX; capped = true; }
    const up = scale(r, -1 / len(r));                   // along the arm, hand -> shoulder
    const twist = dot(o.w, up);
    const rigid = sub(o.w, scale(up, twist));            // the hand's rotation, minus the twist
    const vh = Math.hypot(v.x, v.z);
    const back = vh > 0.05 ? { x: -v.x / vh, y: 0, z: -v.z / vh } : { x: 0, y: 0, z: 1 };
    const sideRoll = twist * ARM.FINGER_R / ARM.BALL_R;
    // rolling off the fingertips: forward roll about (up x direction of travel)
    const fwdRoll = ARM.ROLL_OFF * vh / ARM.BALL_R;
    const rollAx = { x: -back.z, y: 0, z: back.x };       // up x (direction of travel)
    let spin = add(add(rigid, scale(back, sideRoll)), scale(rollAx, fwdRoll));
    const sw = len(spin);
    if (sw > ARM.W_MAX) spin = scale(spin, ARM.W_MAX / sw);
    return {
      pos, v, spin, speed, capped, twist, sideRoll, fwdRoll, armV, armSpeed: len(armV), bodyV,
      heading: Math.atan2(-v.x, -v.z),
      loft: Math.atan2(v.y, Math.max(1e-6, vh)),
      rpm: len(spin) * 60 / (2 * Math.PI),
    };
  }

  /**
   * The hand swings in a vertical plane through the shoulder (a rotation about the shoulder keeps
   * it there). The phone's top is not exactly along the forearm: in the user's Grip recording it
   * leans 10-35 deg outward at the release (the phone sits angled in the fist), which put the hand
   * 7-40 cm right of the shoulder and the ball in the right gutter. So once the arm is swinging,
   * the shoulder->hand vector loses its component along the horizontal swing axis (same length):
   * the hand is where a swinging arm puts it, the phone's lean in the fist does not move it.
   * Weight 0 below 1.5 rad/s of horizontal swing (stance, slow moves), 1 above 4 rad/s.
   */
  function planeArm(r, w) {
    if (!w) return r;
    const wh = Math.hypot(w.x, w.z), k = Math.max(0, Math.min(1, (wh - 1.5) / 2.5));
    if (k <= 0) return r;
    const n = { x: w.x / wh, y: 0, z: w.z / wh }, d = dot(r, n);
    const rp = sub(r, scale(n, d * k)), l = len(rp);
    return l > 1e-6 ? scale(rp, len(r) / l) : r;
  }

  /**
   * The hand's real velocity at the release instant tRel (lane frame, m/s), from the phone's
   * accelerometer, not from the arm model. Why: the rigid arm (hand = shoulder + 0.7 m along the
   * phone) makes the wrist part of the arm, so a flexing wrist reads as a faster, more lofted
   * swing: on the user's recording the model released 1.3-1.8x faster than the accelerometer
   * says and 10-30 deg too lofted, and the phone's lean in the fist read as aim.
   *
   *  - The anchor: the backswing apex, the sample in [tRel - APEX_BACK, tRel - APEX_MIN] where
   *    the arm model's hand speed is smallest. The arm stops there, so the model's velocity
   *    (~0-0.3 m/s; its scale error scales with the swing speed, ~0 here) starts the integration.
   *  - From there to tRel: v += a dt (trapezoid), a = Ry(-yaw) R(t - LAG) f - g at t - LAG, f the
   *    specific force the phone measured (incl. gravity), R its orientation LAG ms earlier,
   *    timestamps smoothed (RETIME). A downswing is 250-630 ms, so drift has little time to build.
   *  - Nothing is blended in from the arm model after the anchor (a complementary prior would
   *    pull the speed back toward the model's 1.3-1.8x overestimate, see tools/replay.js).
   * Returns { v, t0 (anchor time), dur (s), n, v0 } or null (no accelerometer: the mouse; a
   * Bluetooth gap > GAP ms or a clipped 8 g reading inside the window): the caller then uses the
   * arm model.
   */
  function handVelocity(samples, tRel, ref, o) {
    o = Object.assign({}, HAND, o || {});
    const lo = Math.min(tRel - o.APEX_BACK, o.anchor != null ? o.anchor : Infinity) - 60;
    const win = samples.filter(s => s.t >= lo && s.t <= tRel + o.LAG + 60);
    if (win.length < 8 || win.some(s => !s.acc)) return null;
    // the apex: slowest arm-model hand speed before the release
    let i0 = -1, best = Infinity;
    for (let i = 0; i < win.length; i++) {
      const t = win[i].t;
      if (o.anchor != null) { if (t <= o.anchor) i0 = i; continue; }   // forced anchor (tools/replay.js checks)
      if (t < tRel - o.APEX_BACK || t > tRel - o.APEX_MIN) continue;
      const f = fitRelease(samples, t, ref, 40);
      if (!f) continue;
      const sp = len(f.v);
      if (sp < best) { best = sp; i0 = i; }
    }
    if (i0 < 0) return null;
    // smoothed times: a local least-squares line of arrival time against sample number
    const T = win.map((s, i) => {
      const a = Math.max(0, i - o.RETIME), b = Math.min(win.length - 1, i + o.RETIME);
      let n = 0, mx = 0, my = 0, sxy = 0, sxx = 0;
      for (let j = a; j <= b; j++) { n++; mx += j; my += win[j].t; }
      mx /= n; my /= n;
      for (let j = a; j <= b; j++) { sxy += (j - mx) * (win[j].t - my); sxx += (j - mx) * (j - mx); }
      return sxx > 0 ? my + (i - mx) * sxy / sxx : s.t;
    });
    for (let i = 1; i < T.length; i++) if (T[i] <= T[i - 1]) T[i] = T[i - 1] + 0.1;
    // each reading is LAG ms old: it belongs at tau = T - LAG, in the orientation of that moment,
    // so the release needs the readings up to LAG ms after it (the game waits 40 ms)
    const tau = T.map(t => t - o.LAG);
    let ia = -1, ib = -1;
    for (let i = 0; i < win.length; i++) { if (ia < 0 && tau[i] >= win[i0].t) ia = i; if (tau[i] < tRel) ib = i; }
    if (ia < 0 || ib < ia || ib + 1 >= win.length) return null;   // not enough readings yet
    for (let i = ia; i <= ib + 1; i++) {
      if (i > ia && win[i].t - win[i - 1].t > o.GAP) return null;
      if (win[i].acc.some(a => Math.abs(a) >= BODY.SAT)) return null;
    }
    const qAt = t => {
      let j = 1;
      while (j < T.length - 1 && T[j] < t) j++;
      const k = Math.max(0, Math.min(1, (t - T[j - 1]) / (T[j] - T[j - 1])));
      return slerp(win[j - 1].q, win[j].q, k);
    };
    const accAt = i => {
      const s = win[i], k = BODY.ACC_FS;
      const aw = toLane(ref, rotate(qAt(tau[i]), rotate(C, { x: s.acc[0] * k, y: s.acc[1] * k, z: s.acc[2] * k })));
      return { x: aw.x, y: aw.y - BODY.G, z: aw.z };
    };
    const tA = tau[ia];
    const v0 = (fitRelease(samples, tA, ref, 40) || {}).v;
    if (!v0) return null;
    let v = { x: v0.x, y: v0.y, z: v0.z }, aPrev = accAt(ia);
    const series = o.series ? [{ t: tA, v }] : null;
    for (let i = ia + 1; i <= ib + 1; i++) {
      let a = accAt(i), t1 = tau[i];
      if (t1 > tRel) {   // the last step ends at the release: the reading there interpolated
        const k = (tRel - tau[i - 1]) / (t1 - tau[i - 1]);
        a = { x: aPrev.x + (a.x - aPrev.x) * k, y: aPrev.y + (a.y - aPrev.y) * k, z: aPrev.z + (a.z - aPrev.z) * k };
        t1 = tRel;
      }
      const h = (t1 - tau[i - 1]) / 2000;
      v = { x: v.x + (a.x + aPrev.x) * h, y: v.y + (a.y + aPrev.y) * h, z: v.z + (a.z + aPrev.z) * h };
      aPrev = a;
      if (series) series.push({ t: t1, v });
    }
    return { v, v0, t0: tA, anchor: win[i0].t, dur: (tRel - tA) / 1000, n: ib - ia + 2, series };
  }

  /**
   * Release at the bottom (v7). On the phone the fingers open at the bottom of the swing but the
   * thumb lifts Vol Down later: on the user's two recordings a median 62 ms after the hand's
   * lowest point (-34..+154 ms), and every 10 ms of that adds a few degrees of loft (key-up lofts
   * median 25 deg) and widens the heading scatter (rms 26 vs 13 deg at the bottom).
   * So: when the key comes up within BOTTOM.WINDOW ms after the swing's bottom, the ball leaves
   * from the bottom: that pose and the hand's measured velocity at that instant. Later key-ups
   * release at key-up (a late release really lofts); a key-up before the bottom is left alone.
   * The bottom: the hand's vertical velocity crossing zero upward after the downswing's fastest
   * descent (< -MIN_DOWN m/s), found by looking back from the key-up over the integrated velocity
   * (handVelocity's series; the arm model's hand velocity when the accelerometer is unusable).
   * Returns { t, lag (ms), src } or null (no downswing to the bottom before the key-up).
   */
  const BOTTOM = { USE: true, WINDOW: 150, MIN_DOWN: 0.15, MIN_SPEED: 1.2 };   // MIN_DOWN: short real swings from a held-out stance only sink at 0.2-0.3 m/s
  function swingBottom(samples, tRel, ref, hv) {
    let ser = hv && hv.series, src = 'hand';
    if (!ser) {
      src = 'arm';
      ser = [];
      for (const s of samples) {
        if (s.t < tRel - HAND.APEX_BACK || s.t > tRel) continue;
        const f = fitRelease(samples, s.t, ref, 28);
        if (f) ser.push({ t: s.t, v: f.v });
      }
    }
    if (!ser || ser.length < 4) return null;
    let im = 0;
    for (let i = 1; i < ser.length; i++) if (ser[i].v.y < ser[im].v.y) im = i;
    if (ser[im].v.y > -BOTTOM.MIN_DOWN) return null;
    for (let i = im + 1; i < ser.length; i++) {
      const a = ser[i - 1], b = ser[i];
      if (a.v.y < 0 && b.v.y >= 0) {
        const k = -a.v.y / (b.v.y - a.v.y), t = a.t + (b.t - a.t) * k;
        if (len(b.v) < BOTTOM.MIN_SPEED || t >= tRel) return null;
        return { t, lag: tRel - t, src };
      }
    }
    return null;
  }

  /**
   * Aim gain: the heading relative to the lane reference is multiplied by GAIN (0.4 keeps 40% of
   * every aim error), linearly, so the ball still goes exactly where the swing points, only
   * less far off; speed and loft are kept. Only for a forward throw (|heading| < 90 deg).
   * Why: from the release spot the ball reaches the pins within about -1..+1.5 deg, and real
   * phone swings scatter ~+-7 deg (v6). The game's AIM option: NORMAL 0.25 (default; 0.4 still left a
   * player in the gutter half the time, 2026-11-10), PRO 1:1;
   * ?aim=G overrides. GAIN here (the maths library's own default) stays 1:1.
   */
  const AIM = { GAIN: 1, NORMAL: 0.25, PRO: 1 };
  /**
   * The approach: in a bowling alley the player walks 3-4 steps and the body carries ~1.5-2.5 m/s
   * into the release (pro release speeds 27-30 km/h come from arm swing + walk). In a living room
   * nobody walks, and the real hands measured 11-13 km/h on swings the player called hard: the
   * ball felt dead. V (m/s) is added along the lane to every forward throw: a lazy swing still
   * rolls lazily (5 + 7 km/h), a hard one arrives at alley speed (13 + 7 = 20 km/h). A forward
   * walk adds no sideways error, so it also makes the line a little less twitchy, as walking does.
   * 0 for the old standing-throw behaviour (tests, replay --noapproach).
   */
  const APPROACH = { V: 2.0 };
  function aimed(v, g) {
    if (g === 1 || !v) return v;
    const h = Math.atan2(-v.x, -v.z);
    if (Math.abs(h) >= Math.PI / 2) return v;
    const d = (g - 1) * h, c = Math.cos(d), s = Math.sin(d);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
  }

  /**
   * One throw, exactly as the game makes it (game.js finishRelease, tools/replay.js):
   * HOLD came up at tRel; samples = the track; ref = the throw's lane reference (gripRef);
   * shoulder = {x, y, z}; o.body = body tracker state to add (off by default: BODY.USE);
   * o.plane (default true, planeArm); o.hand (default HAND.USE): the ball leaves with the
   * hand's measured velocity (handVelocity), the arm model's only where that is not available
   * (rb.vSrc 'hand' / 'arm'); o.aimGain (default AIM.GAIN = 1, see aimed); o.bottom (default
   * BOTTOM.USE): a key-up up to BOTTOM.WINDOW ms after the swing's bottom releases at the bottom.
   * Returns { f (fitRelease), rb (releaseBall), hv, release: { mode 'bottom' | 'keyup', t (the
   * instant the ball left), lag (ms from the bottom to the key-up, null without one) } } or null.
   */
  function throwFrom(samples, tRel, ref, shoulder, o) {
    o = o || {};
    const halfMs = o.halfMs == null ? 28 : o.halfMs;
    let f = fitRelease(samples, tRel, ref, halfMs);
    if (!f) return null;
    const useHand = o.hand != null ? o.hand : HAND.USE;
    let hv = useHand ? handVelocity(samples, tRel, ref, { series: true }) : null;
    let tOut = tRel, mode = 'keyup', lag = null;
    if (o.bottom != null ? o.bottom : BOTTOM.USE) {
      const bt = swingBottom(samples, tRel, ref, hv);
      if (bt) {
        lag = bt.lag;
        const f2 = bt.lag <= BOTTOM.WINDOW ? fitRelease(samples, bt.t, ref, halfMs) : null;
        if (f2) {
          const hv2 = hv ? handVelocity(samples, bt.t, ref, { anchor: hv.anchor }) : null;
          if (!hv || hv2) { f = f2; hv = hv2; tOut = bt.t; mode = 'bottom'; }
        }
      }
    }
    let bodyV = null, bodyP = null;
    if (o.body && (o.useBody != null ? o.useBody : BODY.USE)) { const bd = bodyAt(o.body, tOut); bodyV = bd.v; bodyP = o.clampP ? o.clampP(bd.p) : bd.p; }
    // the approach (APPROACH): a real bowler walks into the throw; standing in a room the player
    // does not, so a forward walk is added to the hand's velocity (only to a forward throw)
    let vh = hv ? hv.v : f.v;
    const appr = o.approach != null ? o.approach : APPROACH.V;
    if (appr > 0 && vh.z < 0) vh = { x: vh.x, y: vh.y, z: vh.z - appr };
    const v = aimed(vh, o.aimGain != null ? o.aimGain : AIM.GAIN);
    const rb = releaseBall({ w: f.w, Rd: f.Rd, v, shoulder, bodyV, bodyP, plane: o.plane });
    rb.vSrc = hv ? 'hand' : 'arm';
    rb.armModelV = f.v;
    return { f, rb, bodyP, hv, release: { mode, t: tOut, lag } };
  }

  /**
   * The body's part of the release: the measured body velocity, limited to what a bowler's body
   * does (it moves with the throw or stands; it does not run backward or sideways at 3 m/s).
   * Along the throw -0.3..V_MAX m/s, across +-0.8, up/down +-0.8.
   */
  function releaseBodyV(bv, armV) {
    const h = Math.hypot(armV.x, armV.z);
    const f = h > 0.3 ? { x: armV.x / h, z: armV.z / h } : { x: 0, z: -1 };
    let along = bv.x * f.x + bv.z * f.z, across = bv.x * -f.z + bv.z * f.x;
    along = Math.max(-0.3, Math.min(BODY.V_MAX, along));
    across = Math.max(-0.8, Math.min(0.8, across));
    const y = Math.max(-0.8, Math.min(0.8, bv.y));
    return { x: f.x * along - f.z * across, y, z: f.z * along + f.x * across };
  }

  /**
   * Where the body (the shoulder) goes during the swing, from the phone's accelerometer: the
   * approach steps and the lunge carry the hand further and faster than the arm alone.
   *
   * The phone measures the hand's acceleration a (world frame, gravity removed). The arm model
   * says what the hand would do with the shoulder still: v_arm (centred fit of the arm-model
   * positions, so it is not late). What is left is the body: dv_body = a dt - d(v_arm). It starts
   * from rest at the grip, leaks (TAU) so drift dies, is zeroed when the phone is still (ZUPT),
   * ignores samples where the accelerometer clips (8 g, the bottom of a hard swing) and is clamped
   * to a plausible approach and lunge. It runs HALF samples behind the newest (the centred fit).
   * Samples without acc (mouse) leave the body still.
   */
  function createBody() {
    return { on: false, t0: 0, v: { x: 0, y: 0, z: 0 }, p: { x: 0, y: 0, z: 0 }, hist: [], lastT: 0, vArmPrev: null, quiet: 0 };
  }
  function bodyStart(b, t) {
    b.on = true; b.t0 = t; b.lastT = t; b.v = { x: 0, y: 0, z: 0 }; b.p = { x: 0, y: 0, z: 0 };
    b.hist = [{ t, v: b.v, p: b.p }]; b.vArmPrev = null; b.accPrev = null; b.quiet = 0;
  }
  function bodyStop(b) { b.on = false; }
  /**
   * Arm-model hand velocity at sample j: the slope at t_j of a least-squares cubic through the
   * arm-model positions of samples j +- HALF (real timestamps). A straight line there would lag
   * the swing's fast-turning velocity by ~0.1-0.2 m/s near the bottom of a hard swing.
   */
  function armVelAt(ss, j, q0) {
    const H = BODY.HALF, a = Math.max(0, j - H), z = Math.min(ss.length - 1, j + H);
    if (z - a + 1 < 6) return null;
    // normal equations in u = (t - t_j) / 10 ms, basis 1, u, u^2, u^3
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bx = [0, 0, 0, 0], by = [0, 0, 0, 0], bz = [0, 0, 0, 0];
    for (let i = a; i <= z; i++) {
      const u = (ss[i].t - ss[j].t) / 10, p = armVec(handRot(ss[i].q, q0));
      const f = [1, u, u * u, u * u * u];
      for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) M[r][c] += f[r] * f[c]; bx[r] += f[r] * p.x; by[r] += f[r] * p.y; bz[r] += f[r] * p.z; }
    }
    // solve M c = b for the three right-hand sides (Gaussian elimination, partial pivoting)
    const A = M.map((row, r) => row.concat([bx[r], by[r], bz[r]]));
    for (let c = 0; c < 4; c++) {
      let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < 4; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let k2 = c; k2 < 7; k2++) A[r][k2] -= k * A[c][k2]; }
    }
    // slope at u = 0 is c1 (per 10 ms) -> per second x100
    return { x: A[1][4] / A[1][1] * 100, y: A[1][5] / A[1][1] * 100, z: A[1][6] / A[1][1] * 100 };
  }
  /** World linear acceleration of a sample (m/s^2, gravity removed), or null without acc. */
  function sampleAccel(s, ref) {
    if (!s.acc) return null;
    const k = BODY.ACC_FS;
    const aw = toLane(ref, rotate(s.q, rotate(C, { x: s.acc[0] * k, y: s.acc[1] * k, z: s.acc[2] * k })));
    const sat = Math.abs(s.acc[0]) >= BODY.SAT || Math.abs(s.acc[1]) >= BODY.SAT || Math.abs(s.acc[2]) >= BODY.SAT;
    return { x: aw.x, y: aw.y - BODY.G, z: aw.z, sat };
  }
  /** Process every sample that now has HALF samples after it. */
  function bodyUpdate(b, ss, q0) {
    if (!b.on) return;
    const H = BODY.HALF;
    for (let j = 1; j < ss.length - H; j++) {
      const s = ss[j];
      if (s.t <= b.lastT) continue;
      const prev = ss[j - 1];
      const dt = (s.t - prev.t) / 1000;
      b.lastT = s.t;
      const vArm = armVelAt(ss, j, q0);
      const acc = sampleAccel(s, q0);
      const accP = b.accPrev;
      b.accPrev = acc;
      if (!vArm || !acc || !accP || !(dt > 0) || dt > 0.06 || !b.vArmPrev) { b.vArmPrev = vArm; continue; }
      let v = scale(b.v, Math.exp(-dt / BODY.TAU));
      if (!acc.sat && !accP.sat) {
        // trapezoid: the velocity change between the two samples
        const h = dt / 2;
        v = add(v, { x: (acc.x + accP.x) * h - (vArm.x - b.vArmPrev.x), y: (acc.y + accP.y) * h - (vArm.y - b.vArmPrev.y), z: (acc.z + accP.z) * h - (vArm.z - b.vArmPrev.z) });
      }
      b.vArmPrev = vArm;
      // still phone: no rotation, specific force = g
      const w = len(log(mul(s.q, conj(prev.q)))) / dt;
      const fm = Math.hypot(acc.x, acc.y + BODY.G, acc.z);
      if (w < BODY.ZUPT_W && Math.abs(fm - BODY.G) < BODY.ZUPT_A) b.quiet += dt * 1000; else b.quiet = 0;
      if (b.quiet >= BODY.ZUPT_MS) v = { x: 0, y: 0, z: 0 };
      const vh = Math.hypot(v.x, v.z);
      if (vh > BODY.V_MAX) { v.x *= BODY.V_MAX / vh; v.z *= BODY.V_MAX / vh; }
      v.y = Math.max(-1.5, Math.min(1.5, v.y));
      b.v = v;
      // soft dead band: sensor noise while seated does not walk you around
      const sp = len(v), keep = sp > BODY.DEAD ? 1 : sp / BODY.DEAD;
      const p = add(b.p, scale(v, dt * keep * keep));
      p.z = Math.max(-BODY.FWD, Math.min(BODY.BACK, p.z));
      p.x = Math.max(-BODY.SIDE, Math.min(BODY.SIDE, p.x));
      p.y = Math.max(-BODY.DOWN, Math.min(BODY.UP, p.y));
      b.p = p;
      b.hist.push({ t: s.t, v, p });
      while (b.hist.length > 2 && b.hist[b.hist.length - 1].t - b.hist[0].t > 3000) b.hist.shift();
    }
  }
  /** Body state at time t (latest processed sample at or before t). */
  function bodyAt(b, t) {
    let best = b.hist[0] || { t: 0, v: { x: 0, y: 0, z: 0 }, p: { x: 0, y: 0, z: 0 } };
    for (const h of b.hist) if (h.t <= t + 0.5) best = h;
    const sp = len(best.v), keep = sp > BODY.DEAD ? 1 : sp / BODY.DEAD;
    return { v: scale(best.v, keep * keep), p: best.p, t: best.t };
  }

  /**
   * Sample buffer + button edges for one phone. push() every new sample {t, q, a}; it reports
   * 'press' / 'release' with the exact sample time. Keeps ~1.5 s.
   */
  function createTrack() {
    return { samples: [], lastA: false, events: [] };
  }
  function pushSample(track, s) {
    const ss = track.samples;
    if (ss.length && s.t <= ss[ss.length - 1].t) return false;   // same report seen again
    ss.push(s);
    while (ss.length > 2 && ss[ss.length - 1].t - ss[0].t > 1500) ss.shift();
    if (s.a && !track.lastA) track.events.push({ kind: 'press', t: s.t });
    if (!s.a && track.lastA) track.events.push({ kind: 'release', t: s.t });
    track.lastA = s.a;
    return true;
  }

  const api = { ARM, BODY, HAND, AIM, aimed, BOTTOM, swingBottom, handVelocity, C, mul, conj, norm, rotate, axisAngle, log, slerp, cross, dot, len, add, sub, scale,
    decodePad, encodePad, DEFAULT_Q0, handRot, laneRef, toLane, armHeading, gripRef, REF, lineup, APPROACH, planeArm, throwFrom, wrapPi, armVec, setArm, swingRot, fitOmega, fitRelease, releaseBall, releaseBodyV,
    createBody, bodyStart, bodyStop, bodyUpdate, bodyAt, sampleAccel, createTrack, pushSample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.BW = root.BW || {}; root.BW.Kin = api; }
})(typeof window !== 'undefined' ? window : null);
