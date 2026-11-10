// Run: node games/fishing/test/replay.test.js
// The real phone session of 2026-11-10 (recordings/fishing-20261110-195110, Wand, Golden Hour)
// replayed through the rules. In that session 7 casts landed 3.7, 20.8, 5.2, 7.1, 9.8, 10.9 and
// 48.7 m, 2 of 4 strikes were missed, and a fight on a 3.2 kg snapper snapped with no warning.
'use strict';
const assert = require('assert');
const L = require('../logic.js');
const R = require('./replay.js');
const S = R.session();

/** Feed the samples to the live cast detector as the game does (Thumb mode by default). */
function castFrom(rec, mode) {
  const c = L.createCaster();
  for (const s of R.decode(rec.samples)) { const r = L.stepCaster(c, s, mode || 'thumb'); if (r) return { r, at: s.t - rec.t }; }
  return null;
}
/** The strike as the game sees it: jerk detection on the smoothed motion, inside the species window. */
function strike(rec) {
  const win = L.byId(rec.sp).window, h = [];
  let soft = false;
  for (const s of R.decode(rec.samples)) {
    h.push({ t: s.t, pitch: s.pitch, rate: L.pitchUpRate(s.f, s.av) });
    while (h.length > 2 && s.t - h[0].t > 0.35) h.shift();
    const j = L.detectJerk(h), dt = s.t - rec.t;
    if (dt < 0 || dt > win || !j) continue;
    if (j.kind === 'strike') return { hooked: true, dt };
    soft = true;
  }
  return { hooked: false, soft };
}

const tests = {
  everyRecordedCastNowFlies() {
    const d = S.casts.map(c => { const x = castFrom(c); assert(x && !x.r.fail, 'cast at ' + c.t + ': ' + JSON.stringify(x)); return L.landing(x.r, 3.6).dist; });
    assert(d.every(x => x >= 25), 'landed ' + d.map(x => x.toFixed(0)).join(', ') + ' m (old: ' + S.casts.map(c => c.oldLanding).join(', ') + ')');
  },
  theRealReleasesAreAllClean() {
    // players let go at the end of the stroke or during the backswing; both now read as clean
    for (const c of S.casts) assert.strictEqual(castFrom(c).r.timing, 'clean', 'cast at ' + c.t);
  },
  theCastIsDecidedFast() {
    for (const c of S.casts) { const x = castFrom(c); assert(x.at < 0.3, 'decided ' + x.at.toFixed(2) + ' s after the old release'); }
  },
  snapModeAgreesOnTheRealFlicks() {
    for (const c of S.casts) {
      const a = castFrom(c, 'thumb').r, b = castFrom(c, 'snap').r;
      assert(b && !b.fail && Math.abs(L.landing(a, 3.6).dist - L.landing(b, 3.6).dist) < 6, 'cast at ' + c.t);
    }
  },
  realStrikesLandInsideTheNewWindows() {
    // reaction to the strike rumble took 0.62-0.70 s to show as a jerk; the windows now allow it
    const r = S.strikes.map(strike);
    assert.strictEqual(r.filter(x => x.hooked).length, 3, JSON.stringify(r));
    const mack = r[S.strikes.findIndex(s => s.sp === 'mackerel')];
    assert(mack.hooked && mack.dt > 0.5, 'the mackerel (old window 0.5 s) is now hooked at ' + mack.dt);
  },
  theMissedPerchIsExplained() {
    // the player only lifted slowly near the end: the miss now says "too soft", not nothing
    const r = strike(S.strikes[0]);
    assert(!r.hooked && r.soft, JSON.stringify(r));
  },
  haulingTheRodIsNotCranking() {
    const cr = L.createCrank(); let sum = 0, n = 0, prev = null;
    for (const s of R.decode(S.fight.samples)) { sum += L.stepCrank(cr, s.f, prev ? Math.max(1e-3, s.t - prev.t) : 1 / 60); prev = s; n++; }
    assert(sum / n < 0.35, 'mean crank ' + (sum / n).toFixed(2));
  },
  theRecordedFightStyleNeverSnapsWithoutWarning() {
    // A held, rod hauled high and back: replay it against snappers; a snap, if any, follows a warning
    const smp = R.decode(S.fight.samples);
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = L.rng32(seed), f = L.spawnFish(rng, { species: 'snapper' });
      const fs = L.createFight(f, 30, 0.3, 0.9, rng), cr = L.createCrank();
      let warn = 0;
      for (let k = 0; k < 6000 && !fs.over; k++) {
        const s = smp[k % smp.length], tps = L.stepCrank(cr, s.f, 1 / 60), m = cr.m || s.f;
        L.stepFight(fs, { reel: L.reelSpeed(tps, s.a), rodDir: m, pitch: Math.asin(m.y) }, 1 / 60, rng);
        warn = fs.danger ? warn + 1 / 60 : 0;
      }
      if (fs.over === 'snap') assert(warn >= 0.9, 'snapped after ' + warn.toFixed(2) + ' s of warning');
      if (fs.over === 'landed') landed++;
    }
    assert(landed >= 12, 'landed ' + landed + '/20');
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
