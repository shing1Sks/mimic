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

  /**
   * How a fielder takes a catch. from: { x, z, face (rad, toward the batter) }; at: the catch point;
   * runCap: how far he could run before it arrived (m). Returns { kind, side (-1 left, 0, +1 right in
   * his frame), lift (m, a leap) }. Only a ball he could not run under needs a dive.
   */
  function fieldAction(from, at, runCap) {
    const dx = at.x - from.x, dz = at.z - from.z, gap = Math.max(0, Math.hypot(dx, dz) - (runCap || 0));
    const r = rightOf(from.face || 0), lat = dx * r.x + dz * r.z;
    const side = Math.abs(lat) < 0.25 ? 0 : Math.sign(lat);
    if (at.y > 2.2) return { kind: 'leap', side, lift: Math.min(0.6, at.y - 2.0) };
    if (gap > 1.0) return { kind: 'dive', side: side || 1, lift: 0 };
    if (at.y > 1.6) return { kind: 'high', side, lift: 0 };
    if (at.y < 0.5) return { kind: 'low', side, lift: 0 };
    return { kind: 'take', side, lift: 0 };
  }

  /** The body for an action, dt s from the catch (negative before): { y (m), roll (rad, + = to his right) }. */
  function actionPose(act, dt) {
    const k01 = x => Math.max(0, Math.min(1, x));
    if (act.kind === 'leap') return { y: act.lift * Math.sin(Math.PI * k01((dt + 0.3) / 0.6)), roll: 0 };
    if (act.kind === 'dive') {
      // launch over 0.35 s, land at the catch, stay down 0.6 s, back up over 0.4 s
      const k = dt < 0 ? k01((dt + 0.35) / 0.35) : dt < 0.6 ? 1 : 1 - k01((dt - 0.6) / 0.4);
      return k > 0 ? { y: -0.45 * k, roll: act.side * 1.25 * k } : { y: 0, roll: 0 };
    }
    return { y: 0, roll: 0 };
  }

  const api = { solveElbow, elbowPole, handPair, forwardOf, rightOf, fieldAction, actionPose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Anim = api; }
})(typeof window !== 'undefined' ? window : null);
