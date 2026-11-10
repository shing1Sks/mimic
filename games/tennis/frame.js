/*
 * Sunvolley — each player's own frame. The near player plays toward -z as always; the far
 * player (two-player mode) gets the same court turned half a turn about the vertical axis, so
 * all the swing, aim and footwork code is written once, for "my half is +z, I hit toward -z".
 * A half turn (not a mirror) keeps a right-handed player right-handed and leaves the ball
 * physics unchanged. Pure math, tested in Node: node games/tennis/test/frame.test.js
 */
(function (root) {
  'use strict';
  /** World -> local for side s (+1 near, -1 far). The same map takes local back to world. */
  function L(s, v) { return s > 0 ? { x: v.x, y: v.y, z: v.z } : { x: -v.x, y: v.y, z: -v.z }; }
  /** A ball state as seen from side s (other fields copied as they are). */
  function localBall(s, b) { return Object.assign({}, b, { p: L(s, b.p), v: L(s, b.v), w: L(s, b.w) }); }
  /** A solved shot {v, w, ...} from side s's frame to the world. */
  function solToWorld(s, sol) { return Object.assign({}, sol, { v: L(s, sol.v), w: L(s, sol.w) }); }
  function qmul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  const HALF_TURN = { x: 0, y: 1, z: 0, w: 0 };
  /** An orientation in side s's frame, in the world. */
  function quatToWorld(s, q) { return s > 0 ? { x: q.x, y: q.y, z: q.z, w: q.w } : qmul(HALF_TURN, q); }

  const api = { L, localBall, solToWorld, quatToWorld, qmul };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.TN = root.TN || {}; root.TN.Frame = api; }
})(typeof window !== 'undefined' ? window : null);
