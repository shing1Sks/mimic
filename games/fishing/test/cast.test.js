// Run: node games/fishing/test/cast.test.js
// Casting from the rod's real stroke: how hard you flick sets the distance, where the rod stops
// sets the direction, release timing nudges the arc inside a wide window.
'use strict';
const assert = require('assert');
const L = require('../logic.js');
const D = Math.PI / 180;

/** Synthetic overhead stroke sampled at 60 Hz: rod from pitch 160 deg (behind) over the top to
 *  15 deg in front, peak turn rate ~w rad/s, rotated yawDeg right. A held until relT (s from the peak). */
function stroke(w, yawDeg, relT) {
  const out = [], dt = 1 / 60, total = (160 - 15) * D, dur = total / (w * 0.64);
  const yw = (yawDeg || 0) * D;
  const dir = th => ({ x: Math.cos(th) * Math.sin(yw), y: Math.sin(th), z: -Math.cos(th) * Math.cos(yw) });
  let t = 0;
  for (; t < 0.4; t += dt) out.push({ t, f: dir(160 * D), a: true });            // loaded behind
  const t0 = t;
  for (; t < t0 + dur; t += dt) { const k = (t - t0) / dur; out.push({ t, f: dir((160 * D) - total * (k * k * (3 - 2 * k))), a: true }); }
  for (const s of out) s.peak = t0 + dur / 2;
  for (let e = t + 0.6; t < e; t += dt) out.push({ t, f: dir(15 * D), a: true });
  const peak = t0 + dur / 2;
  for (const s of out) if (s.t >= peak + relT) s.a = false;
  return out;
}
function cast(samples, mode) {
  const c = L.createCaster();
  for (const s of samples) { const r = L.stepCaster(c, s, mode || 'thumb'); if (r) return r; }
  return null;
}
const dist = l => L.landing(l, 3.6).dist;

const tests = {
  aCleanFlickCastsStraightOut() {
    const l = cast(stroke(20, 0, 0.08));
    assert(l && !l.fail, JSON.stringify(l));
    assert(Math.abs(l.heading) < 2 * D, 'heading ' + l.heading / D);
    assert.strictEqual(l.timing, 'clean');
  },
  harderFlicksGoFurther() {
    const d = [6, 10, 15, 20, 27].map(w => dist(cast(stroke(w, 0, 0.05))));
    for (let i = 1; i < d.length; i++) assert(d[i] > d[i - 1] + 3, d.map(x => x.toFixed(1)).join(' '));
    assert(d[0] > 5 && d[0] < 20, 'a gentle flick lands near: ' + d[0].toFixed(1));
    assert(d[4] > 40 && d[4] < 55, 'a full flick reaches the far fish: ' + d[4].toFixed(1));
  },
  theReleaseWindowIsWideAndForgiving() {
    // anywhere from just before the peak to the end of the follow-through is a clean cast
    const ref = dist(cast(stroke(18, 0, 0.05)));
    for (const rel of [-0.04, 0, 0.1, 0.2]) {
      const l = cast(stroke(18, 0, rel));
      assert.strictEqual(l.timing, 'clean', 'release at ' + rel);
      assert(Math.abs(dist(l) - ref) < ref * 0.12, rel + ': ' + dist(l).toFixed(1) + ' vs ' + ref.toFixed(1));
    }
  },
  timingStillMatters() {
    const early = cast(stroke(18, 0, -0.25)), clean = cast(stroke(18, 0, 0.05)), late = cast(stroke(18, 0, 0.3));
    assert(early.elev > clean.elev && late.elev < clean.elev);
    assert(dist(early) < dist(clean) && dist(late) < dist(clean));
    assert(/early/.test(L.castWord(early)) && /late/.test(L.castWord(late)));
  },
  whereTheRodStopsIsWhereItGoes() {
    const r = cast(stroke(20, 25, 0.05)), l = cast(stroke(20, -25, 0.05));
    assert(Math.abs(r.heading - 25 * D) < 2 * D && Math.abs(l.heading + 25 * D) < 2 * D, r.heading / D + ' ' + l.heading / D);
    const pr = L.landing(r, 3.6), pl = L.landing(l, 3.6);
    assert(Math.abs(pr.x + pl.x) < 1e-6 && Math.abs(pr.z - pl.z) < 1e-6, 'mirror casts mirror');
  },
  snapModeCastsWithoutAButton() {
    const s = stroke(20, 0, 0).map(x => Object.assign({}, x, { a: false }));
    const l = cast(s, 'snap');
    assert(l && !l.fail && l.timing === 'clean', JSON.stringify(l));
  },
  aBackswingAloneIsATangle() {
    // rod swung from in front to behind, then let go: no forward stroke to cast with
    const s = [], dt = 1 / 60;
    const dir = th => ({ x: 0, y: Math.sin(th), z: -Math.cos(th) });
    for (let t = 0; t < 0.3; t += dt) s.push({ t, f: dir(15 * D), a: true });
    for (let k = 0; k <= 12; k++) s.push({ t: 0.3 + k * dt, f: dir((15 + 145 * k / 12) * D), a: true });
    for (let t = 0.3 + 13 * dt; t < 1.4; t += dt) s.push({ t, f: dir(160 * D), a: t < 0.6 });
    const r = cast(s);
    assert(r && r.fail === 'backward', JSON.stringify(r));
  },
  noStrokeNoCast() {
    const s = []; for (let t = 0; t < 1.5; t += 1 / 60) s.push({ t, f: { x: 0, y: 0.5, z: -0.866 }, a: t < 0.8 });
    assert.deepStrictEqual(cast(s), { fail: 'weak' });
  },
  flightIsDeterministic() {
    const a = L.landing(cast(stroke(17, 7, 0.05)), 3.6), b = L.landing(cast(stroke(17, 7, 0.05)), 3.6);
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
