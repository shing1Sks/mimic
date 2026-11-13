/*
 * Willowlight - athlete animation maths. Pure, no browser (node games/cricket/test/anim.test.js).
 *
 * Arms: two-bone IK with a pole, so an elbow bends out and down like an elbow instead of flipping
 * through the body (the old midpoint guess crossed arms whenever a hand reached round). Hands are
 * placed in the athlete's own frame, so his left hand stays on his left whichever way he faces.
 * Frames: three.js world, y up; facing is the rotation about y, 0 = facing +z.
 */
(function (root) {
  'use strict';
  const v = (x, y, z) => ({ x, y, z });
  const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z), sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, k) => v(a.x * k, a.y * k, a.z * k), dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = a => Math.hypot(a.x, a.y, a.z);
  const norm = a => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : v(0, 0, 0); };

  /** The athlete's forward and right for a facing. */
  const forwardOf = f => v(Math.sin(f), 0, Math.cos(f));
  const rightOf = f => v(-Math.cos(f), 0, Math.sin(f));

  /**
   * Elbow position for a shoulder, a hand target, the bone lengths and a pole (the direction the
   * elbow should point). Out of reach, the arm straightens toward the hand.
   */
  function solveElbow(sh, hand, U, L, pole) {
    const d = sub(hand, sh), D = len(d);
    if (D < 1e-6) return add(sh, mul(norm(pole), U));               // hand on the shoulder: elbow along the pole
    const dir = mul(d, 1 / D);
    if (D >= U + L) return add(sh, mul(dir, U));                       // straight arm
    const Dc = Math.max(Math.abs(U - L) + 1e-6, D);
    const a = (U * U - L * L + Dc * Dc) / (2 * Dc);                    // along the shoulder-hand line
    const h = Math.sqrt(Math.max(0, U * U - a * a));                   // away from it
    let p = sub(pole, mul(dir, dot(pole, dir)));                       // the pole, square to the line
    if (len(p) < 1e-6) p = Math.abs(dir.y) < 0.9 ? sub(v(0, -1, 0), mul(dir, -dir.y)) : v(1, 0, 0);
    return add(add(sh, mul(dir, a)), mul(norm(p), h));
  }

  /** Where an elbow points for the athlete's left (-1) or right (+1) arm: out, down, a little back. */
  function elbowPole(facing, side) {
    const out = mul(rightOf(facing), side), back = mul(forwardOf(facing), -1);
    return norm(add(add(mul(out, 0.6), v(0, -0.7, 0)), mul(back, 0.3)));
  }

  /** Both hands round a point, spread (m) to each side in the athlete's own frame. */
  function handPair(c, facing, spread) {
    const r = mul(rightOf(facing), spread);
    return { left: sub(c, r), right: add(c, r) };
  }

  const api = { solveElbow, elbowPole, handPair, forwardOf, rightOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Anim = api; }
})(typeof window !== 'undefined' ? window : null);
