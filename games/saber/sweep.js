/*
 * Cadence Cut - swept-blade hit test. Pure math, no three.js, so it runs in Node tests too.
 *
 * The blade is the segment hilt -> tip. Between two frames both ends may move: the arm model
 * translates the hilt and the phone's rotation turns the blade. The sweep interpolates the hilt
 * linearly and the blade direction spherically-ish (nlerp), in steps small enough that no point
 * of the blade can jump over half a box, and reports the first pose that touches the box.
 *
 * A moving box is handled by the caller: shift the previous blade pose by the box's motion and
 * test against the box's current centre (relative motion is all that matters).
 *
 * Classic script: defines window.CadenceSweep. Node: module.exports.
 */
(function (root) {
  'use strict';

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = a => Math.hypot(a.x, a.y, a.z);
  const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
  const along = (p, d, s) => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });
  function unit(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }

  /** Segment p + d*t, t in [t0, t1], against the axis-aligned box centred at c with half size h. Entry t or -1. */
  function segBox(p, d, t0, t1, c, h) {
    let tmin = t0, tmax = t1;
    const o = [p.x - c.x, p.y - c.y, p.z - c.z], dd = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (Math.abs(o[a]) > h) return -1; continue; }
      let ta = (-h - o[a]) / dd[a], tb = (h - o[a]) / dd[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > tmin) tmin = ta;
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  /** Screen-plane direction name of a motion vector: 'left' | 'right' | 'up' | 'down'. */
  function dirName(m) {
    return Math.abs(m.x) >= Math.abs(m.y) ? (m.x >= 0 ? 'right' : 'left') : (m.y >= 0 ? 'up' : 'down');
  }

  const MISS = Object.freeze({ hit: false });

  /**
   * Did the blade, moving from (hiltPrev, tipPrev) to (hiltNow, tipNow), pass through the box?
   * Returns { hit: false } or { hit: true, f, s, point, motion, dir }:
   *   f       0..1, how far through the frame the contact happened
   *   s       distance from the hilt along the blade to the contact
   *   point   the contact point at that moment
   *   motion  how that blade point moved over the frame (prev -> now)
   *   dir     the motion's screen direction: 'left' | 'right' | 'up' | 'down'
   */
  function bladeSweepHits(hiltPrev, tipPrev, hiltNow, tipNow, boxCenter, boxHalf) {
    const move = Math.max(len(sub(hiltNow, hiltPrev)), len(sub(tipNow, tipPrev)));
    if (move < 1e-6) return MISS; // a blade at rest is not a cut
    const lenP = len(sub(tipPrev, hiltPrev)), lenN = len(sub(tipNow, hiltNow));
    const dP = unit(sub(tipPrev, hiltPrev)), dN = unit(sub(tipNow, hiltNow));
    const K = Math.max(1, Math.min(128, Math.ceil(move / (boxHalf * 0.5))));
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const h = lerp(hiltPrev, hiltNow, f), d = unit(lerp(dP, dN, f));
      const L = lenP + (lenN - lenP) * f;
      const te = segBox(h, d, 0, L, boxCenter, boxHalf);
      if (te < 0) continue;
      const motion = sub(along(hiltNow, dN, te), along(hiltPrev, dP, te));
      return { hit: true, f, s: te, point: along(h, d, te), motion, dir: dirName(motion) };
    }
    return MISS;
  }

  /**
   * Screen-space cut: the player sees a flat picture, so a cut counts when the blade, as drawn,
   * sweeps over the block as drawn. a0-b0 is the blade's cutting part on screen last frame,
   * a1-b1 this frame (2D points, any consistent units); rect = { cx, cy, hw, hh }.
   * Returns { hit: false } or { hit: true, f (0..1 through the frame), point (2D) }.
   */
  function screenSweepHits(a0, b0, a1, b1, rect) {
    const move = Math.max(Math.hypot(a1.x - a0.x, a1.y - a0.y), Math.hypot(b1.x - b0.x, b1.y - b0.y));
    if (move < 1e-6) return MISS;
    const step = Math.max(1e-4, Math.min(rect.hw, rect.hh) * 0.5);
    const K = Math.max(1, Math.min(256, Math.ceil(move / step)));
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const ax = a0.x + (a1.x - a0.x) * f, ay = a0.y + (a1.y - a0.y) * f;
      const bx = b0.x + (b1.x - b0.x) * f, by = b0.y + (b1.y - b0.y) * f;
      const c = clip2D(ax, ay, bx - ax, by - ay, rect);
      if (c) return { hit: true, f, point: { x: ax + (bx - ax) * c, y: ay + (by - ay) * c } };
    }
    return MISS;
  }

  /** Segment p + d*t, t in [0,1], against a 2D rectangle: midpoint t of the inside part, or null. */
  function clip2D(px, py, dx, dy, r) {
    let t0 = 0, t1 = 1;
    const o = [px - r.cx, py - r.cy], d = [dx, dy], h = [r.hw, r.hh];
    for (let a = 0; a < 2; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (Math.abs(o[a]) > h[a]) return null; continue; }
      let ta = (-h[a] - o[a]) / d[a], tb = (h[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return (t0 + t1) / 2;
  }

  /*
   * Screen sweep for big swings. Projecting only last frame's and this frame's blade and joining
   * them with straight lines on screen breaks when the blade points beyond the screen: a point
   * behind the camera projects mirrored (an overhead blade lands at the bottom of the screen), and
   * even in front of the camera the projection is far from linear, so the in-between blade swept
   * the whole screen and "cut" blocks it never touched, with whatever direction the tip happened
   * to be moving. Here the frame's motion is cut into small 3D steps (hilt lerp, direction nlerp),
   * each step's blade is clipped to the part in front of the camera and projected, and the cut
   * direction is the on-screen motion of the blade point that touched the block, taken from its
   * real 3D motion at the moment of contact.
   *
   * cam = { view(p) -> camera-space point (x right, y up, z back; in front means z < 0),
   *         f: 1 / tan(vertical fov / 2), near: closest depth that counts }.
   * Screen units are those of screenSweepHits callers: x = f * x / depth, y = f * y / depth
   * (NDC height units, aspect already folded in).
   */
  const STEP_ANG = 0.02, STEP_MOVE = 0.02;

  function nlerpDir(d0, d1, f) {
    const x = d0.x + (d1.x - d0.x) * f, y = d0.y + (d1.y - d0.y) * f, z = d0.z + (d1.z - d0.z) * f;
    const l = Math.hypot(x, y, z);
    if (l > 1e-6) return { x: x / l, y: y / l, z: z / l };
    // (near) opposite directions: no unique path; turn through any perpendicular
    return f < 0.5 ? d0 : d1;
  }
  function poseAt(path, f) { return { h: lerp(path.h0, path.h1, f), d: nlerpDir(path.d0, path.d1, f) }; }

  /** Blade from s = from to s = to, clipped to depth >= near; projected segment or null. */
  function screenSeg(h, d, from, to, cam) {
    const A = cam.view(along(h, d, from)), B = cam.view(along(h, d, to));
    let zA = -A.z, zB = -B.z, sA = from, sB = to, pA = A, pB = B;
    const n = cam.near;
    if (zA < n && zB < n) return null;
    if (zA < n || zB < n) {
      const t = (n - zA) / (zB - zA), P = lerp(A, B, t), sP = from + (to - from) * t;
      if (zA < n) { pA = P; zA = n; sA = sP; } else { pB = P; zB = n; sB = sP; }
    }
    return { a: { x: cam.f * pA.x / zA, y: cam.f * pA.y / zA }, b: { x: cam.f * pB.x / zB, y: cam.f * pB.y / zB }, sA, sB, zA, zB };
  }

  /** The blade's cutting part (from..to along it) over one frame, as small projected steps. */
  function bladeScreenPath(h0, d0, h1, d1, from, to, cam) {
    const dot = Math.max(-1, Math.min(1, d0.x * d1.x + d0.y * d1.y + d0.z * d1.z));
    const ang = Math.acos(dot), mv = len(sub(h1, h0));
    const K = Math.max(1, Math.min(256, Math.ceil(Math.max(ang / STEP_ANG, mv / STEP_MOVE))));
    const path = { h0, d0, h1, d1, from, to, cam, K, segs: [], still: ang < 1e-6 && mv < 1e-6 };
    for (let k = 0; k <= K; k++) { const p = poseAt(path, k / K); path.segs.push(screenSeg(p.h, p.d, from, to, cam)); }
    return path;
  }

  /**
   * Did the projected blade path pass over rect? { hit: false } or
   * { hit: true, f, s, point, motion, dir }: f 0..1 through the frame, s the contact distance along
   * the blade, point the 2D contact, motion the contact point's screen velocity (per frame) and dir
   * its name.
   */
  function pathSweepHits(path, rect) {
    if (path.still) return MISS;
    const segs = path.segs, K = path.K;
    for (let k = 1; k <= K; k++) {
      const s0 = segs[k - 1], s1 = segs[k];
      if (!s0 || !s1) continue;
      const r = screenSweepHits(s0.a, s0.b, s1.a, s1.b, rect);
      if (!r.hit) continue;
      const f = (k - 1 + r.f) / K;
      const p = poseAt(path, f);
      const seg = screenSeg(p.h, p.d, path.from, path.to, path.cam);
      if (!seg) continue;
      // screen parameter of the contact on the segment, then perspective-correct 3D parameter
      const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y, l2 = dx * dx + dy * dy;
      const u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((r.point.x - seg.a.x) * dx + (r.point.y - seg.a.y) * dy) / l2)) : 0;
      const t = u * seg.zA / (seg.zB - u * (seg.zB - seg.zA));
      const s = seg.sA + (seg.sB - seg.sA) * t;
      // the contact point's real motion, projected at the moment of contact
      const e = Math.min(1e-3, 0.5 / K);
      const fa = Math.max(0, f - e), fb = Math.min(1, f + e);
      const pa = poseAt(path, fa), pb = poseAt(path, fb);
      const Pa = path.cam.view(along(pa.h, pa.d, s)), Pb = path.cam.view(along(pb.h, pb.d, s));
      const Pc = path.cam.view(along(p.h, p.d, s));
      const z = -Pc.z, inv = 1 / (fb - fa);
      const vx = (Pb.x - Pa.x) * inv, vy = (Pb.y - Pa.y) * inv, vz = -(Pb.z - Pa.z) * inv; // vz: depth rate
      const motion = { x: path.cam.f * (vx * z - Pc.x * vz) / (z * z), y: path.cam.f * (vy * z - Pc.y * vz) / (z * z) };
      const point = { x: path.cam.f * Pc.x / z, y: path.cam.f * Pc.y / z };
      return { hit: true, f, s, point, motion, dir: dirName(motion) };
    }
    return MISS;
  }

  /**
   * q^t like MimicMath.qpow (the arm model's upper-arm share), but continuous over time.
   * qpow always takes the short way round, so when the whole rotation passes 180 deg (pointing
   * far up/back or down with a twisted wrist) the partial rotation flips to the other side and
   * the elbow, hence the hilt, jumps. Here the rotation angle is tracked through 180 deg:
   *   partial = t * (theta - 360deg * k) about q's axis (theta in 0..180, w >= 0),
   * where k is 0 for the short way and becomes 1 at the moment the rotation crosses 180 deg (the
   * swap q -> -q, k -> 1 - k leaves the partial rotation unchanged). Away from 180 deg, k eases
   * back to 0 by `relax` per call, so the arm returns to its usual pose while the player moves.
   * st = { s, k } is the caller's state (start with {}), updated in place. Returns the partial q.
   */
  function qpowFollow(q, t, st, relax) {
    let s = q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
    let k = st.k || 0;
    // the phone sends w >= 0, so passing 180 deg shows up as a sign swap against last frame
    if (st.s && s.x * st.s.x + s.y * st.s.y + s.z * st.s.z + s.w * st.s.w < 0) k = 1 - k;
    const w = Math.max(-1, Math.min(1, s.w)), theta = 2 * Math.acos(w);
    if (k > 0 && theta < 140 * Math.PI / 180) k = Math.max(0, k - (relax || 0));
    st.s = s; st.k = k;
    const sh = Math.sin(theta / 2);
    if (sh < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
    const phi = t * (theta - 2 * Math.PI * k), c = Math.sin(phi / 2) / sh;
    return { x: s.x * c, y: s.y * c, z: s.z * c, w: Math.cos(phi / 2) };
  }

  /**
   * The hilt's hand position from the controller's arm model, with the elbow's share of the
   * rotation tracked continuously through 180 deg (qpowFollow) so the hilt never jumps.
   * pose: the arm model for this hand ({ shoulder, elbow, hand }, MimicMath.armPose(q, side)),
   * side: 'right' | 'left'. A left arm is the right arm in a mirrored world (as in mimic.js):
   * mirror q and the pose, solve as a right arm, mirror the hand back. MM: { qpow, rotate }.
   */
  function continuousHand(q, pose, side, st, relax, MM, share) {
    const L = side === 'left', f = v => (L ? { x: -v.x, y: v.y, z: v.z } : v);
    const qq = L ? { x: q.x, y: -q.y, z: -q.z, w: q.w } : q;
    const sh = f(pose.shoulder), el = f(pose.elbow), hd = f(pose.hand), k = share === undefined ? 0.4 : share;
    const upperW = { x: el.x - sh.x, y: el.y - sh.y, z: el.z - sh.z };
    const short = MM.qpow(qq, k);
    const upper = MM.rotate({ x: -short.x, y: -short.y, z: -short.z, w: short.w }, upperW); // arm-local upper arm
    const nu = MM.rotate(qpowFollow(qq, k, st, relax), upper);
    return f({ x: hd.x - upperW.x + nu.x, y: hd.y - upperW.y + nu.y, z: hd.z - upperW.z + nu.z });
  }

  const api = { bladeSweepHits, segBox, dirName, screenSweepHits, bladeScreenPath, pathSweepHits, screenSeg, qpowFollow, continuousHand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CadenceSweep = api;
})(typeof window !== 'undefined' ? window : this);
