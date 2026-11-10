// Run: node games/fishing/test/cast.test.js
// Casting from the rod's real motion: release timing sets the elevation, wrist speed the distance,
// the tip's path the direction. No aim assist: the same motion always lands in the same place.
'use strict';
const assert = require('assert');
const L = require('../logic.js');
const D = Math.PI / 180;

/** Overhead cast: rod pitched thDeg above the horizon toward the sea (yawDeg right), turning
 *  forward (tip coming down) at w rad/s about the horizontal axis across the rod. */
function overhead(thDeg, w, yawDeg) {
  const th = thDeg * D, yw = (yawDeg || 0) * D;
  const rod = { x: Math.cos(th) * Math.sin(yw), y: Math.sin(th), z: -Math.cos(th) * Math.cos(yw) };
  const axis = { x: Math.cos(yw), y: 0, z: Math.sin(yw) };   // the rod's right-hand axis
  return L.castLaunch(rod, { x: -w * axis.x, y: 0, z: -w * axis.z });
}
const H = 3.6;
const dist = l => L.landing(l, H).dist;

const tests = {
  releaseAtVerticalLeavesAtTheLagAngle() {
    const l = overhead(90, 10);
    assert(Math.abs(l.heading) < 1e-6, 'straight out: ' + l.heading);
    assert(Math.abs(l.elev - L.CAST.LAG) < 1e-6, 'elev ' + l.elev / D);
  },
  releaseTimingMovesTheElevation() {
    const early = overhead(125, 10), mid = overhead(90, 10), late = overhead(55, 10);
    assert(early.elev > mid.elev && mid.elev > late.elev, [early.elev, mid.elev, late.elev].map(e => (e / D).toFixed(0)).join(' '));
    assert.strictEqual(L.castWord(mid.elev), 'clean release');
    assert.strictEqual(L.castWord(early.elev), 'sky-high');
    assert(['slapped down', 'a touch late'].includes(L.castWord(late.elev)));
  },
  aCleanReleaseGoesFurthest() {
    const best = dist(overhead(90, 10));
    assert(best > dist(overhead(130, 10)) + 10, 'early release should balloon short');
    assert(best > dist(overhead(50, 10)) + 8, 'late release should slap down short');
  },
  fasterWristCastsFurther() {
    const d = [5, 8, 11, 14].map(w => dist(overhead(90, w)));
    for (let i = 1; i < d.length; i++) assert(d[i] > d[i - 1] + 3, d.map(x => x.toFixed(1)).join(' '));
    assert(d[0] > 12 && d[0] < 28, 'a gentle flick lands near: ' + d[0].toFixed(1));
    assert(d[2] > 40 && d[2] < 65, 'a good flick reaches the far fish: ' + d[2].toFixed(1));
  },
  speedIsCappedByTheLine() {
    assert(overhead(90, 60).speed <= L.CAST.MAX_SPEED);
    assert(dist(overhead(90, 60)) < 80);
  },
  aLimpReleaseJustDropsTheRig() {
    assert.strictEqual(overhead(90, 1).speed, 0);
  },
  theTipsPathSetsTheDirection() {
    const r = overhead(90, 10, 25), l = overhead(90, 10, -25);
    assert(Math.abs(r.heading - 25 * D) < 1e-6 && Math.abs(l.heading + 25 * D) < 1e-6, r.heading / D + ' ' + l.heading / D);
    const pr = L.landing(r, H), pl = L.landing(l, H);
    assert(Math.abs(pr.x + pl.x) < 1e-6 && Math.abs(pr.z - pl.z) < 1e-6, 'mirror casts mirror');
  },
  sidearmFlingsAlongTheSweep() {
    // rod level, pointing 45 deg right, sweeping left (turning about +Y): the tip moves forward-left
    const rod = { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 };
    const l = L.castLaunch(rod, { x: 0, y: 10, z: 0 });
    assert(l.heading < 0 && l.heading > -60 * D, 'heads left of straight: ' + (l.heading / D).toFixed(1));
    assert(Math.abs(l.elev - L.CAST.LAG) < 1e-6, 'flat sweep leaves at the lag angle');
    assert(!l.backward);
  },
  aBackswingReleaseGoesBehind() {
    const l = overhead(90, -10);   // tip moving back over the shoulder
    assert(l.backward, 'heading ' + (l.heading / D).toFixed(0));
  },
  twistingTheRodDoesNotCast() {
    const l = L.castLaunch({ x: 0, y: 0.5, z: -0.866 }, { x: 0, y: 5, z: -8.66 });   // spin about its own axis
    assert.strictEqual(l.speed, 0);
  },
  flightIsDeterministic() {
    const a = L.landing(overhead(95, 9.3, 7), H), b = L.landing(overhead(95, 9.3, 7), H);
    assert.deepStrictEqual(a, b);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
