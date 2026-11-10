// Run: node games/fishing/test/reel.test.js
// The reel crank (circling the rod tip) and the strike jerk, from synthetic phone motion.
'use strict';
const assert = require('assert');
const L = require('../logic.js');

function dir(p, y) { return { x: Math.cos(p) * Math.sin(y), y: Math.sin(p), z: -Math.cos(p) * Math.cos(y) }; }
/** Circle the rod tip `hz` times a second, radius r (rad), for secs; returns the last turns/s. */
function crankFor(hz, r, secs, sign) {
  const cr = L.createCrank(), dt = 1 / 60;
  let tps = 0;
  for (let t = 0; t < secs; t += dt) {
    const a = sign * 2 * Math.PI * hz * t;
    tps = L.stepCrank(cr, dir(0.6 + r * Math.sin(a), r * Math.cos(a)), dt);
  }
  return tps;
}
/** Pitch history of a rod lifted by `rise` rad over `dur` s, sampled at 60 Hz. */
function lift(rise, dur) {
  const h = [], dt = 1 / 60; let prev = 0.3;
  for (let t = 0; t <= 0.5; t += dt) {
    const k = Math.min(1, Math.max(0, (t - 0.1) / dur));
    const p = 0.3 + rise * (k * k * (3 - 2 * k));
    h.push({ t, pitch: p, rate: (p - prev) / dt }); prev = p;
  }
  return h;
}
/** The first jerk of `kind` seen frame by frame (a strike passes through a twitch on the way up). */
const firstJerk = (h, kind) => {
  let any = null;
  for (let i = 2; i <= h.length; i++) { const j = L.detectJerk(h.slice(0, i)); if (j && (!kind || j.kind === kind)) return j; if (j && !any) any = j; }
  return any;
};

const tests = {
  circlingReelsAtTheCrankRate() {
    const tps = crankFor(2, 0.12, 2, 1);
    assert(Math.abs(tps - 2) < 0.35, 'tps ' + tps.toFixed(2));
    assert(Math.abs(L.reelSpeed(tps, false) - 2 * L.LINE_PER_TURN) < 0.35);
  },
  eitherDirectionReels() {
    const a = crankFor(1.5, 0.12, 2, 1), b = crankFor(1.5, 0.12, 2, -1);
    assert(Math.abs(a - b) < 0.2 && a > 1.1, a.toFixed(2) + ' ' + b.toFixed(2));
  },
  fasterCirclesReelFaster() {
    assert(crankFor(3, 0.1, 2, 1) > crankFor(1, 0.1, 2, 1) + 1.2);
  },
  aStillRodDoesNotReel() {
    const cr = L.createCrank();
    let tps = 0;
    for (let i = 0; i < 120; i++) tps = L.stepCrank(cr, dir(0.6 + Math.sin(i) * 0.004, 0), 1 / 60);
    assert(tps < 0.05, 'tremor reeled ' + tps);
  },
  aSingleSweepIsNotACrank() {
    const cr = L.createCrank();
    let after = 0;
    for (let i = 0; i < 90; i++) after = L.stepCrank(cr, dir(0.5, i < 20 ? i / 20 * 0.8 : 0.8), 1 / 60);
    assert(after < 0.2, 'kept reeling after one sweep: ' + after.toFixed(2));
  },
  holdingAReelsAtTheButtonRate() {
    assert.strictEqual(L.reelSpeed(0, true), L.A_REEL);
    assert(L.reelSpeed(4, true) > L.A_REEL, 'a fast crank beats the button');
  },
  pitchUpRateReadsTheLift() {
    assert(L.pitchUpRate(dir(0.3, 0), { x: 5, y: 0, z: 0 }) > 4.9);
    assert(L.pitchUpRate(dir(0.3, 0), { x: -5, y: 0, z: 0 }) < -4.9);
    assert(Math.abs(L.pitchUpRate(dir(0.3, 0), { x: 0, y: 5, z: 0 })) < 1e-9, 'a sideways turn is no lift');
  },
  aSharpLiftIsAStrike() {
    const j = firstJerk(lift(0.6, 0.12), 'strike');
    assert(j && j.kind === 'strike', JSON.stringify(j));
    assert(j.strength > 0.3 && j.strength <= 1);
  },
  aSlowLiftIsNotAStrike() {
    const j = firstJerk(lift(0.6, 0.6), 'strike');
    assert(!j || j.kind !== 'strike', JSON.stringify(j));
  },
  aSmallFlickIsATwitch() {
    const j = firstJerk(lift(0.18, 0.08));
    assert(j && j.kind === 'twitch', JSON.stringify(j));
  },
  droppingTheRodIsNothing() {
    assert.strictEqual(firstJerk(lift(-0.6, 0.1)), null);
  },
  crankWobbleIsNotAStrike() {
    const h = [], dt = 1 / 60; let prev = 0.6;
    for (let t = 0; t < 2; t += dt) {
      const p = 0.6 + 0.1 * Math.sin(2 * Math.PI * 2.5 * t);
      h.push({ t, pitch: p, rate: (p - prev) / dt }); prev = p;
      const j = L.detectJerk(h);
      assert(!j || j.kind !== 'strike', 'at ' + t.toFixed(2));
    }
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
