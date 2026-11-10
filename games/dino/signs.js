// Ironfern signposting maths (pure): which side a threat is on, where its off-screen arrow sits on
// the screen edge, which way the hurt indicator points, and the render-scale governor that keeps
// the frame rate up on a laptop GPU. Node tests: test/signs.test.js.
(function (root) {
  'use strict';
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  /** Signed angle of a world bearing relative to the view yaw (three.js yaw: + is to the LEFT). */
  function relBearing(viewYaw, bearing) { return wrap(bearing - viewYaw); }
  /** Yaw that looks from a to b (same convention as the camera: yaw 0 looks down -z). */
  function bearingTo(a, b) { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }
  /** The spotter's word for a relative bearing. */
  function side(rel) {
    const a = Math.abs(rel);
    if (a < 0.35) return 'ahead';
    if (a > 2.3) return 'behind';
    return rel > 0 ? 'left' : 'right';
  }

  /** Projected coords (NDC, y up) of a point -> null if it is on screen, else where its arrow sits
   * on the screen edge (inset by margin) and the arrow's angle (rad, NDC: 0 = right, + = up).
   * behind: the point is behind the camera (its projection is mirrored). */
  function edgeArrow(x, y, behind, margin) {
    const m = margin == null ? 0.08 : margin;
    if (!behind && Math.abs(x) <= 1 && Math.abs(y) <= 1) return null;
    if (behind) {
      x = -x; y = -y * 0.3;
      if (Math.abs(x) < 1e-6) x = 1e-6;
      x = Math.sign(x) * 1e3; // pin it to the side it is on
    }
    const lim = 1 - m, k = lim / Math.max(Math.abs(x), Math.abs(y), 1e-9);
    return { x: x * k, y: y * k, ang: Math.atan2(y, x) };
  }

  /** Screen rotation (rad, clockwise, 0 = up) of the hurt indicator for an attack from `bearing`. */
  function hurtAngle(viewYaw, bearing) { return -relBearing(viewYaw, bearing); }

  // ---------------------------------------------------------------- render-scale governor
  // Drops the render resolution in steps when frames run slow, climbs back when there is headroom,
  // and does not retry a level that just failed for a while (no see-sawing).
  function governor(o) {
    o = o || {};
    return { scale: o.max || 1, min: o.min || 0.6, max: o.max || 1, ema: 1 / 60, last: 0, failed: null, failT: -1e9 };
  }
  function govern(g, dt, now) {
    const s = Object.assign({}, g);
    s.ema += (Math.min(dt, 1 / 20) - s.ema) * 0.05;
    if (now - s.last < 1.5) return s;
    if (s.ema > 1 / 50 && s.scale > s.min + 1e-9) {
      s.failed = s.scale; s.failT = now;
      s.scale = Math.max(s.min, +(s.scale - 0.1).toFixed(3)); s.last = now;
    } else if (s.ema < 1 / 57 && s.scale < s.max - 1e-9 && now - s.last > 4) {
      const next = Math.min(s.max, +(s.scale + 0.05).toFixed(3));
      if (!(s.failed != null && next >= s.failed - 1e-9 && now - s.failT < 20)) { s.scale = next; s.last = now; }
    }
    return s;
  }

  const api = { relBearing, bearingTo, side, edgeArrow, hurtAngle, governor, govern };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.Signs = api; }
})(typeof window !== 'undefined' ? window : this);
