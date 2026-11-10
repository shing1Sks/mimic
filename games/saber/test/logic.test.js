// Run: node games/saber/test/logic.test.js
// Scoring, grading, stars, unlocks and modifiers: the pure rules behind the game.
'use strict';
const assert = require('assert');
const L = require('../logic.js');

const base = { dirErr: 0, centre: 0, arc: 1.2, speed: 12 };
const tests = {
  perfectCutScores100() {
    assert.strictEqual(L.scoreCut(base).raw, 100);
  },
  fasterSwingScoresMore() {
    const slow = L.scoreCut(Object.assign({}, base, { speed: 2.5 })).raw;
    const mid = L.scoreCut(Object.assign({}, base, { speed: 6 })).raw;
    const fast = L.scoreCut(Object.assign({}, base, { speed: 10 })).raw;
    assert(slow < mid && mid < fast, [slow, mid, fast].join(' '));
    assert(fast - slow >= 15, 'speed must matter: ' + (fast - slow));
  },
  fullerSwingScoresMore() {
    const flick = L.scoreCut(Object.assign({}, base, { arc: 0.15 })).raw;
    const full = L.scoreCut(Object.assign({}, base, { arc: 1.0 })).raw;
    assert(full - flick >= 15, flick + ' vs ' + full);
  },
  offCentreAndOffAngleCostPoints() {
    assert(L.scoreCut(Object.assign({}, base, { centre: 0.8 })).raw < 100);
    assert(L.scoreCut(Object.assign({}, base, { dirErr: 0.9 })).raw < 100);
  },
  scoreIsAlwaysInRange() {
    for (let i = 0; i < 200; i++) {
      const r = L.scoreCut({ dirErr: Math.random() * 1.5, centre: Math.random() * 2, arc: Math.random() * 3, speed: Math.random() * 30 }).raw;
      assert(r >= 0 && r <= 100 && Number.isInteger(r), String(r));
    }
  },
  heavyNeedsAFastSwing() {
    assert.strictEqual(L.heavyOk(L.HEAVY_SPEED - 0.5), false);
    assert.strictEqual(L.heavyOk(L.HEAVY_SPEED + 0.1), true);
    assert(L.HEAVY_SPEED > L.MIN_SPEED * 2);
  },
  gradeThresholds() {
    assert.strictEqual(L.grade(0.95, false), 'S');
    assert.strictEqual(L.grade(0.85, false), 'A');
    assert.strictEqual(L.grade(0.7, false), 'B');
    assert.strictEqual(L.grade(0.55, false), 'C');
    assert.strictEqual(L.grade(0.3, false), 'D');
    assert.strictEqual(L.grade(0.99, true), 'FAILED');
  },
  starsFromAccuracy() {
    assert.strictEqual(L.stars(0.99, true), 0);
    assert.strictEqual(L.stars(0.4, false), 1);
    assert.strictEqual(L.stars(0.82, false), 2);
    assert.strictEqual(L.stars(0.93, false), 3);
  },
  noFailClearsEarnAtMostOneStar() {
    assert.strictEqual(L.stars(0.99, false, ['nofail']), 1);
  },
  campaignUnlocksInOrder() {
    const S = {};
    assert.strictEqual(L.stageUnlocked(0, S), true);
    assert.strictEqual(L.stageUnlocked(1, S), false);
    S[L.CAMPAIGN[0].id] = 1;
    assert.strictEqual(L.stageUnlocked(1, S), true);
    assert.strictEqual(L.stageUnlocked(2, S), false);
  },
  campaignIntroducesEveryMechanic() {
    const seen = new Set();
    L.CAMPAIGN.forEach(s => Object.keys(s.features).forEach(k => { if (s.features[k]) seen.add(k); }));
    ['heavy', 'bombs', 'arcs', 'walls', 'chains'].forEach(k => assert(seen.has(k), 'missing ' + k));
    assert(L.CAMPAIGN.length >= 10);
    // the first stage is the plain game; each early stage adds exactly one new mechanic
    assert.strictEqual(Object.values(L.CAMPAIGN[0].features).filter(Boolean).length, 0);
    const ids = new Set(L.CAMPAIGN.map(s => s.id));
    assert.strictEqual(ids.size, L.CAMPAIGN.length, 'unique stage ids');
  },
  totalStarsSums() {
    assert.strictEqual(L.totalStars({ a: 2, b: 3, c: 0 }), 5);
  },
  modifiersChangeScoreAndUnlockWithStars() {
    assert(L.modMultiplier(['swift']) > 1);
    assert(L.modMultiplier(['nofail']) < 1);
    assert.strictEqual(L.modMultiplier([]), 1);
    assert.strictEqual(L.modUnlocked('nofail', 0), true);
    assert.strictEqual(L.modUnlocked('swift', 0), false);
    assert.strictEqual(L.modUnlocked('swift', 99), true);
    assert(L.MODS.swift.speed > 1);
  },
  surgeFillsOnlyOnGreatCuts() {
    assert.strictEqual(L.surgeGain(50), 0);
    assert(L.surgeGain(95) > L.surgeGain(75));
    assert(L.surgeGain(75) > 0);
  },
  multiplierClimbsAndResets() {
    let m = { mult: 1, prog: 0 };
    for (let i = 0; i < 100; i++) m = L.multStep(m, true);
    assert.strictEqual(m.mult, 4);
    m = L.multStep(m, false);
    assert.deepStrictEqual(m, { mult: 1, prog: 0 });
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
