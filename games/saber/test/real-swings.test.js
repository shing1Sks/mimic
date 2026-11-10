// Run: node games/saber/test/real-swings.test.js
// Real swings from the user's phone (recordings/saber-20261109-024111): nine big swings that went
// above the screen or behind the camera and came back through the block grid. For every grid block
// a swing really crosses on screen (brute-force ground truth, stored in the fixture), the cut must
// land when the drawn blade reaches the block and in the direction the blade moved there.
'use strict';
const assert = require('assert');
global.window = global; // mimic.js attaches MimicMath to window
require('../../lib/mimic.js');
const MM = global.MimicMath;
const SW = require('../sweep.js');
const FIX = require('./fixtures/real-offscreen-swings.json');

// the game's camera: at (0, 1.45, 1.75) looking at (0, 1.2, -6), 68 deg vertical fov
const D = Math.PI / 180, F = 1 / Math.tan(34 * D), ASPECT = 1536 / 695;
const POS = { x: 0, y: 1.45, z: 1.75 };
const norm = a => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const FWD = norm({ x: 0, y: 1.2 - 1.45, z: -6 - 1.75 }), RIGHT = norm(cross(FWD, { x: 0, y: 1, z: 0 })), UP = cross(RIGHT, FWD);
const view = p => { const d = { x: p.x - POS.x, y: p.y - POS.y, z: p.z - POS.z }; return { x: dot(d, RIGHT), y: dot(d, UP), z: -dot(d, FWD) }; };
const CAM = { view, f: F, near: 0.3 };
const screen = p => { const v = view(p); return { x: F * v.x / -v.z, y: F * v.y / -v.z }; };
const rectOf = (x, y) => {
  const H = 0.22 + 0.07, c = screen({ x, y, z: -1.75 }), e = screen({ x: x + H, y: y + H, z: -1.75 });
  const hs = Math.max(Math.abs(e.x - c.x), Math.abs(e.y - c.y));
  return { cx: c.x, cy: c.y, hw: hs, hh: hs };
};

// phone axes -> blade pose, as game.js does (continuous arm, blade tilted up by PITCH_OFF)
const S2 = Math.SQRT1_2, C = { x: -S2, y: 0, z: 0, w: S2 }, Ci = { x: S2, y: 0, z: 0, w: S2 };
const OFF = { x: Math.sin(0.1), y: 0, z: 0, w: Math.cos(0.1) };
function poses(axes) {
  const st = {}; let pq = null;
  return axes.map(([x, y, z], i) => {
    const q = MM.mul(MM.mul(C, { x, y, z, w: Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) }), Ci);
    const dir = MM.rotate(MM.mul(q, OFF), { x: 0, y: 0, z: -1 });
    const pose = MM.armPose(q, 'right');
    const upperW = { x: pose.elbow.x - pose.shoulder.x, y: pose.elbow.y - pose.shoulder.y, z: pose.elbow.z - pose.shoulder.z };
    const sh = MM.qpow(q, 0.4), upper = MM.rotate({ x: -sh.x, y: -sh.y, z: -sh.z, w: sh.w }, upperW);
    const av = pq ? 2 * Math.acos(Math.min(1, Math.abs(q.x * pq.x + q.y * pq.y + q.z * pq.z + q.w * pq.w))) * 60 : 0; pq = q;
    const nu = MM.rotate(SW.qpowFollow(q, 0.4, st, (1 / 60) * (0.6 + 0.15 * av)), upper);
    const hand = { x: pose.hand.x - upperW.x + nu.x, y: pose.hand.y - upperW.y + nu.y, z: pose.hand.z - upperW.z + nu.z };
    const hilt = { x: hand.x * 1.6, y: hand.y * 1.6 + 1.45, z: hand.z * 1.6 + 1.75 };
    const raw = { x: pose.hand.x * 1.6, y: pose.hand.y * 1.6 + 1.45, z: pose.hand.z * 1.6 + 1.75 };
    return { t: i / 60, dir, hilt, raw, tip: { x: hilt.x + dir.x * 3.5, y: hilt.y + dir.y * 3.5, z: hilt.z + dir.z * 3.5 },
      rawTip: { x: raw.x + dir.x * 3.5, y: raw.y + dir.y * 3.5, z: raw.z + dir.z * 3.5 } };
  });
}
// the game's speed gate: tip speed over ~45 ms, x/y only
function tipSpeed(P, i, key) {
  let k = i; while (k > 0 && P[i].t - P[k].t < 0.045) k--;
  const dt = Math.max(1e-3, P[i].t - P[k].t);
  return { x: (P[i][key].x - P[k][key].x) / dt, y: (P[i][key].y - P[k][key].y) / dt };
}
const at = (h, d, s) => ({ x: h.x + d.x * s, y: h.y + d.y * s, z: h.z + d.z * s });
const angErr = (a, b) => { let e = Math.abs(a - b); return e > Math.PI ? 2 * Math.PI - e : e; };

function firstNew(P, rect) {
  for (let i = 1; i < P.length; i++) {
    const v = tipSpeed(P, i, 'tip'); if (Math.hypot(v.x, v.y) < 2.0) continue;
    const r = SW.pathSweepHits(SW.bladeScreenPath(P[i - 1].hilt, P[i - 1].dir, P[i].hilt, P[i].dir, 0.35, 3.5, CAM), rect);
    if (r.hit) return { i, angle: Math.atan2(r.motion.y, r.motion.x) };
  }
  return null;
}
// the pre-fix pipeline: two projected poses joined on screen, direction from the tip's world motion
function firstOld(P, rect) {
  const sc = p => { const s = screen(p); return { x: s.x, y: s.y }; };
  for (let i = 1; i < P.length; i++) {
    const v = tipSpeed(P, i, 'rawTip'); if (Math.hypot(v.x, v.y) < 2.0) continue;
    const A = P[i - 1], B = P[i];
    const r = SW.screenSweepHits(sc(at(A.raw, A.dir, 0.35)), sc(at(A.raw, A.dir, 3.5)), sc(at(B.raw, B.dir, 0.35)), sc(at(B.raw, B.dir, 3.5)), rect);
    if (r.hit) return { i, angle: Math.atan2(v.y, v.x) };
  }
  return null;
}

const tests = {};
let oldBad = 0, total = 0;
FIX.swings.forEach(sw => {
  tests['realSwingAt' + sw.t + 's_' + sw.off.join('_')] = () => {
    const P = poses(sw.axes);
    sw.expect.forEach(e => {
      total++;
      const rect = rectOf(e.x, e.y), r = firstNew(P, rect), o = firstOld(P, rect);
      const where = 'block (' + e.x + ', ' + e.y + ')';
      assert.ok(r, where + ': the swing crosses it but no cut');
      assert.ok(r.i >= e.first - 1 && r.i <= e.first + 1, where + ': cut at frame ' + r.i + ', blade reaches it at frame ' + e.first);
      assert.ok(angErr(r.angle, e.angle) < 45 * D, where + ': cut direction off by ' + (angErr(r.angle, e.angle) / D).toFixed(0) + ' deg (want ' + e.dir + ')');
      if (!o || o.i < e.first - 1 || angErr(o.angle, e.angle) >= 45 * D) oldBad++;
    });
  };
});
tests.fixtureReallyExercisesTheBug = () => {
  // the old two-pose projection got a good share of these real swings wrong (early or wrong way)
  assert.ok(total > 50 && oldBad >= 10, 'old pipeline failed ' + oldBad + ' of ' + total);
  console.log('     (old pipeline: ' + oldBad + ' of ' + total + ' real crossings early/wrong/missed; new: 0)');
};
void ASPECT;

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
