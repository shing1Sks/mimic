/*
 * Sunvolley — physical racket/ball contact. Pure math, no browser needed (tested in Node:
 * node games/tennis/test/contact.test.js). Points are plain {x, y, z} in metres.
 */
(function (root) {
  'use strict';
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  const len = a => Math.sqrt(dot(a, a));
  const EPS = 1e-12;

  /**
   * Did the racket head touch the ball during this frame? The head swept the segment
   * headPrev -> headNow, the ball swept ballPrev -> ballNow. Contact when the closest approach
   * between the two swept segments is within r (ball radius + racket-face half-size allowance).
   * Segment-vs-segment, so a fast head that jumps past the ball in one frame still connects.
   * Returns { hit, t (0..1 along the head sweep), u (0..1 along the ball path),
   *           point (ball centre at contact), headPoint, dist }.
   */
  function sweptContact(headPrev, headNow, ballPrev, ballNow, r) {
    const d1 = sub(headNow, headPrev), d2 = sub(ballNow, ballPrev), w = sub(headPrev, ballPrev);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, w);
    let s, t;
    if (a <= EPS && e <= EPS) { s = 0; t = 0; }
    else if (a <= EPS) { s = 0; t = clamp01(f / e); }
    else {
      const c = dot(d1, w);
      if (e <= EPS) { t = 0; s = clamp01(-c / a); }
      else {
        const b = dot(d1, d2), denom = a * e - b * b;
        s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp01(-c / a); }
        else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
      }
    }
    const headPoint = lerp3(headPrev, headNow, s), point = lerp3(ballPrev, ballNow, t);
    const dist = len(sub(headPoint, point));
    return { hit: dist <= r, t: s, u: t, point, headPoint, dist };
  }

  /**
   * What the strings do to the ball. normal: racket-face normal (either side), headVel: racket
   * head velocity from the arm (m/s), ballVel: incoming ball velocity.
   * Direction = face normal (turned to the side the head is moving into) blended with the swing
   * direction; pace = head speed x 0.9 + incoming speed x 0.3; spin from the head's vertical
   * velocity (up = topspin, down = slice).
   * Returns { dir (unit), pace, top (-1..1), headSpeed, inSpeed, elevDeg }.
   */
  const FACE_BLEND = 0.65;
  function shotFromContact(o) {
    const hv = o.headVel, bv = o.ballVel;
    let n = o.normal;
    const nl = len(n) || 1;
    n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
    // the face that meets the ball is the one moving into it (head velocity relative to the ball)
    if (dot(n, sub(hv, bv)) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    const headSpeed = len(hv), inSpeed = len(bv);
    let dir = n;
    if (headSpeed > 0.5) {
      const k = (1 - FACE_BLEND) / headSpeed;
      dir = { x: n.x * FACE_BLEND + hv.x * k, y: n.y * FACE_BLEND + hv.y * k, z: n.z * FACE_BLEND + hv.z * k };
      const dl = len(dir) || 1;
      dir = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
    }
    const pace = headSpeed * 0.9 + inSpeed * 0.3;
    const top = Math.max(-1, Math.min(1, hv.y / 8));
    const elevDeg = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 180 / Math.PI;
    return { dir, pace, top, headSpeed, inSpeed, elevDeg };
  }

  /**
   * Hit zones. The phone measures rotation precisely but not where the hand is, so the arm
   * model's racket height and depth can be off by tens of centimetres. Contact stays physical
   * (the head must sweep through the ball's path, on time, on the right side), but height (ky)
   * and depth (kz) differences are shrunk before the distance test. REAL is the strict test.
   */
  const ZONES = {
    REAL: { r: 0.093, ky: 1, kz: 1 },
    NORMAL: { r: 0.2, ky: 0.4, kz: 0.2 },   // ~1 m of depth = a timing window of about +-50 ms
    EASY: { r: 0.3, ky: 0.3, kz: 0.12 },
  };
  function zoneContact(headPrev, headNow, ballPrev, ballNow, zone) {
    const o = ballNow;
    const f = p => ({ x: p.x, y: o.y + (p.y - o.y) * zone.ky, z: o.z + (p.z - o.z) * zone.kz });
    const r = sweptContact(f(headPrev), f(headNow), f(ballPrev), f(ballNow), zone.r);
    // report real positions, not the shrunk ones
    return Object.assign(r, { point: lerp3(ballPrev, ballNow, r.u), headPoint: lerp3(headPrev, headNow, r.t) });
  }

  /**
   * How a swing missed, from d = (head - ball) at closest approach: "TOO HIGH 25 cm", "EARLY"...
   * The ball flies toward +z (the player). d.z > 0: it had not reached the racket yet (EARLY);
   * d.z < 0: it had already gone past (LATE).
   */
  function missLabel(d) {
    if (Math.abs(d.y) >= Math.abs(d.z)) return (d.y > 0 ? 'TOO HIGH ' : 'TOO LOW ') + Math.round(Math.abs(d.y) * 100) + ' cm';
    return d.z > 0 ? 'EARLY' : 'LATE';
  }

  // ---------------------------------------------------------------------------------------
  // Magnetic contact: what a phone can measure well is rotation and swing speed, not where the
  // hand is. So a hit is a swing at the right moment (|e| within the window, e = swing time -
  // planned contact time) and the ball snaps to the strings.
  const MAGNET_WINDOW = { REAL: 0.07, NORMAL: 0.14, EASY: 0.22 };   // seconds either side
  function inWindow(e, W) { return Math.abs(e) <= W; }

  // ---------------------------------------------------------------------------------------
  // Swing = shot. Recorded strokes showed the racket angle is useless for aiming (people hold
  // and flick a phone every which way), but the direction the HAND travels at its fastest
  // matches where they meant to hit. So the racket angle is automatic: the hand's path aims the
  // ball, its speed (or a fast wrist) sets how far. Timing only decides hit or miss.
  const HAND_TAU = 0.25;                       // s: the integration forgets old motion (drift)
  function handTracker() { return { v: { x: 0, y: 0, z: 0 }, best: null, bestM: 0 }; }
  /** One sensor step: a = linear acceleration (world, gravity removed, m/s^2). */
  function handStep(h, a, dt) {
    const k = Math.exp(-dt / HAND_TAU), v = h.v;
    h.v = { x: v.x * k + a.x * dt, y: v.y * k + a.y * dt, z: v.z * k + a.z * dt };
    return h;
  }
  function handStart(h) { h.best = null; h.bestM = 0; return h; }
  /** Call on every swing frame: keeps the fastest moment of the hand moving toward the court
   * (within 75 degrees of straight). The wind-up travels backward and never aims the ball. */
  function handMark(h) {
    const m = Math.hypot(h.v.x, h.v.z);
    if (-h.v.z > m * 0.26 && m > h.bestM) { h.bestM = m; h.best = { x: h.v.x, y: h.v.y, z: h.v.z }; }
    return h;
  }
  /** az: radians, + = right, 0 = straight at the far court, after removing the natural lean
   * (bias) of that stroke; lift: up per unit across; speed: m/s. */
  function handDir(h, bias) {
    if (!h.best || h.bestM < 1e-9) return { az: 0, lift: 0, speed: 0 };
    return { az: Math.atan2(h.best.x, -h.best.z) - (bias || 0), lift: h.best.y / h.bestM, speed: h.bestM };
  }
  /** Measured natural lean per stroke (right hand): forehands drift left, serves more so. */
  const SWING_BIAS = { fh: -0.18, bh: -0.15, sv: -0.43 };
  /** Power from hand speed: 1.2 m/s is nothing, 4.5 m/s full, faster over-hits (to 1.25). */
  function handPower(speed) { return Math.max(0, Math.min(1.25, (speed - 1.2) / 3.3)); }
  // fitted on recorded strokes: a deliberate 'left' or 'right' lands near that sideline, only a
  // really wide swing goes out
  const RALLY_GAIN = 0.45, SERVE_GAIN = 0.25, MAX_AZ = 0.22;
  /** Linear for normal swings, easing off toward MAX_AZ for huge ones (never wildly out). */
  const aim = (az, g) => MAX_AZ * Math.tanh(az * g / MAX_AZ);
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Rally shot for the near player (+z side). power 0..1.25 (over 1 = over-hit, lands long). */
  function swingRally(o) {
    const D = 3 + o.power * 8;                       // metres past the net: 1.0 = deep, in
    const tz = -D, dist = o.from.z - tz;
    const ref = Math.atan2(-o.from.x, dist);         // a straight swing heads for the middle
    const a = ref + aim(o.az, RALLY_GAIN);
    return { target: { x: o.from.x + Math.tan(a) * dist, z: tz }, pace: 14 + o.power * 30,
      top: clampN(o.lift * 0.5, -0.9, 1), power: o.power };
  }
  /** Serve into box {x0,x1,z0,z1}: straight = box centre, depth from power, over-hit = long. */
  function swingServe(o) {
    const b = o.box, cx = (b.x0 + b.x1) / 2;
    const zFar = Math.abs(b.z0) > Math.abs(b.z1) ? b.z0 : b.z1, sgn = Math.sign(zFar) || -1;
    const D = 1.5 + o.power * 4.6;                   // 1.0 = 6.1 m, just inside the 6.4 m line
    const tz = sgn * D, dist = Math.abs(o.from.z - tz);
    const ref = Math.atan2(cx - o.from.x, dist);
    const a = ref + aim(o.az, SERVE_GAIN);
    return { target: { x: o.from.x + Math.tan(a) * dist, z: tz }, pace: 20 + o.power * 30, top: 0.25 };
  }

  // ---------------------------------------------------------------------------------------
  // Handedness. A left-hander is the right-hander's mirror image across the player's own x axis:
  // the racket shoulder sits on the left, a forehand is taken back on the left (yaw > 0 in
  // three.js, where + yaw turns left), and the natural lean of each stroke drifts the other way.
  // Everything else (racket orientation, timing, power) stays 1:1 from the phone.
  const sideSign = hand => (hand === 'left' ? -1 : 1);
  /** Which groundstroke the racket is being taken back for, from the controller's yaw (rad). */
  function strokeSide(yaw, hand) {
    const y = yaw * sideSign(hand);           // in a right-hander's terms
    return y < -0.6 ? 'fh' : y > 0.6 ? 'bh' : null;
  }
  /** Contact yaw for a stroke so an on-time level swing heads toward court angle az (+ = right). */
  function contactYaw(stroke, az, hand) {
    const k = sideSign(hand), a = az * k;      // mirror, solve as a right-hander, mirror back
    const y = stroke === 'fh' ? Math.max(-1.85, Math.min(-1.2, -Math.PI / 2 - a)) : Math.max(1.2, Math.min(1.85, Math.PI / 2 - a));
    return y * k;
  }
  /** The natural lean of a stroke for this hand (mirrors SWING_BIAS for a left-hander). */
  function swingBias(kind, hand) { return (SWING_BIAS[kind] || 0) * sideSign(hand); }

  /** Shot power 0..1 from the swing's peak rotation speed (precise on a phone) vs the swing threshold. */
  function swingPower(peakW, threshold, k) {
    return Math.max(0, Math.min(1.25, (peakW - threshold) / (threshold * 2) * (k || 1)));
  }

  const api = { swingPower, sweptContact, shotFromContact, zoneContact, ZONES, missLabel, MAGNET_WINDOW, inWindow, handTracker, handStep, handStart, handMark, handDir, handPower, SWING_BIAS, swingRally, swingServe, sideSign, strokeSide, contactYaw, swingBias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.TN = root.TN || {}; Object.assign(root.TN, api); }
})(typeof window !== 'undefined' ? window : null);
