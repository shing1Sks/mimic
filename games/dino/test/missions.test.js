// Run: node games/dino/test/missions.test.js  -- scoring, stars, objectives, wave scheduling, rails
'use strict';
const assert = require('assert');
const M = require('../missions.js');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ` ${a} != ${b}`);

const t = {
  // ---------------------------------------------------------------- scoring
  speciesPoints() {
    assert.strictEqual(M.killPoints('raptor', 'body'), 100);
    assert.strictEqual(M.killPoints('dilo', 'torso'), 120);
    assert.strictEqual(M.killPoints('ptero'), 80);
    assert.strictEqual(M.killPoints('trike', 'flank'), 300);
    assert.strictEqual(M.killPoints('rex', 'leg'), 2000);
    assert.strictEqual(M.killPoints('grazer', 'body'), -250);
    assert.strictEqual(M.killPoints('unknown', 'body'), 0);
  },
  weakSpotDoubles() {
    assert.strictEqual(M.killPoints('raptor', 'head'), 200);
    assert.strictEqual(M.killPoints('trike', 'eye'), 600);
    assert.strictEqual(M.killPoints('rex', 'mouth'), 4000);
    assert.ok(M.isWeak('head') && M.isWeak('eye') && M.isWeak('mouth') && !M.isWeak('flank') && !M.isWeak());
  },
  grazerPenaltyIsNotDoubled() {
    assert.strictEqual(M.killPoints('grazer', 'head'), -250);
  },
  scoreBreakdown() {
    const r = M.scoreResult({ killPoints: 1000, shots: 20, hits: 15, time: 80, damageTaken: 30, deaths: 1, penalty: 0 },
      { par: 120, stars: [1500, 2500] });
    near(r.accuracy, 0.75);
    assert.strictEqual(r.accuracyBonus, 750);
    assert.strictEqual(r.timeBonus, 200);          // (120 - 80) * 5
    assert.strictEqual(r.damagePenalty, -90);      // 3 per hp
    assert.strictEqual(r.deathPenalty, -250);
    assert.strictEqual(r.total, 1000 + 750 + 200 - 90 - 250);
    assert.strictEqual(r.stars, 2);
  },
  scoreNeverNegativeAndNoShotsMeansNoAccuracyBonus() {
    const r = M.scoreResult({ killPoints: -500, shots: 0, hits: 0, time: 500, damageTaken: 0, deaths: 0, penalty: 0 }, { par: 60, stars: [1, 2] });
    assert.strictEqual(r.accuracy, 0); assert.strictEqual(r.accuracyBonus, 0); assert.strictEqual(r.timeBonus, 0);
    assert.strictEqual(r.total, 0); assert.strictEqual(r.stars, 1);
  },
  starsByThreshold() {
    assert.strictEqual(M.starsFor(0, [100, 200]), 1);
    assert.strictEqual(M.starsFor(100, [100, 200]), 2);
    assert.strictEqual(M.starsFor(199, [100, 200]), 2);
    assert.strictEqual(M.starsFor(5000, [100, 200]), 3);
  },
  bestKeepsTheHigherScore() {
    let b = {};
    let r = M.mergeBest(b, 'gate3', { total: 900, stars: 1 });
    assert.ok(r.newBest); assert.deepStrictEqual(r.map.gate3, { score: 900, stars: 1 });
    r = M.mergeBest(r.map, 'gate3', { total: 500, stars: 2 });
    assert.ok(!r.newBest); assert.strictEqual(r.map.gate3.score, 900); assert.strictEqual(r.map.gate3.stars, 2, 'stars keep their own max');
    r = M.mergeBest(r.map, 'gate3', { total: 1200, stars: 3 });
    assert.ok(r.newBest); assert.deepStrictEqual(r.map.gate3, { score: 1200, stars: 3 });
  },

  // ---------------------------------------------------------------- objectives
  killObjectiveCountsMatchingSpecies() {
    const o = M.objective.create({ type: 'kill', species: 'raptor', count: 2, label: 'Raptors' });
    M.objective.kill(o, { species: 'dilo' });
    assert.strictEqual(M.objective.view(o).have, 0);
    M.objective.kill(o, { species: 'raptor' });
    let v = M.objective.view(o);
    assert.strictEqual(v.text, 'Raptors 1/2'); assert.ok(!v.done);
    M.objective.kill(o, { species: 'raptor' });
    assert.ok(M.objective.view(o).done);
  },
  taggedObjectiveIgnoresUntagged() {
    const o = M.objective.create({ type: 'kill', species: 'raptor', tagged: true, count: 3, label: 'Tagged raptors', timeLimit: 100 });
    M.objective.kill(o, { species: 'raptor', tagged: false });
    M.objective.kill(o, { species: 'raptor', tagged: true });
    const v = M.objective.view(o);
    assert.strictEqual(v.text, 'Tagged raptors 1/3');
    assert.strictEqual(v.timer, 100);
  },
  timeLimitFails() {
    const o = M.objective.create({ type: 'kill', species: 'raptor', count: 1, timeLimit: 10 });
    M.objective.tick(o, 9.5); assert.ok(!M.objective.view(o).failed);
    near(M.objective.view(o).timer, 0.5);
    M.objective.tick(o, 1); assert.ok(M.objective.view(o).failed); assert.strictEqual(M.objective.view(o).timer, 0);
  },
  doneBeforeTimeLimitDoesNotFail() {
    const o = M.objective.create({ type: 'kill', species: 'raptor', count: 1, timeLimit: 10 });
    M.objective.kill(o, { species: 'raptor' }); M.objective.tick(o, 20);
    const v = M.objective.view(o); assert.ok(v.done && !v.failed);
  },
  surviveCountsDown() {
    const o = M.objective.create({ type: 'survive', time: 60, label: 'Hold the line' });
    M.objective.tick(o, 20);
    let v = M.objective.view(o); near(v.timer, 40); assert.ok(!v.done);
    M.objective.tick(o, 41); v = M.objective.view(o); assert.ok(v.done); assert.strictEqual(v.timer, 0);
  },
  targetsObjective() {
    const o = M.objective.create({ type: 'targets', count: 2, label: 'Plates' });
    M.objective.target(o); assert.strictEqual(M.objective.view(o).text, 'Plates 1/2');
    M.objective.target(o); assert.ok(M.objective.view(o).done);
  },
  clearObjectiveNeedsTheFlag() {
    const o = M.objective.create({ type: 'clear', label: 'Hostiles', planned: 4 });
    M.objective.kill(o, { species: 'raptor' }); M.objective.kill(o, { species: 'grazer' });
    let v = M.objective.view(o); assert.strictEqual(v.text, 'Hostiles 1/4'); assert.ok(!v.done);
    o.cleared = true; assert.ok(M.objective.view(o).done);
  },
  bossObjective() {
    const o = M.objective.create({ type: 'boss', species: 'rex', label: 'Bring down the apex' });
    M.objective.kill(o, { species: 'raptor' }); assert.ok(!M.objective.view(o).done);
    assert.strictEqual(M.objective.view(o).text, 'Bring down the apex');
    M.objective.kill(o, { species: 'rex' }); assert.ok(M.objective.view(o).done);
  },

  // ---------------------------------------------------------------- waves
  timedWaves() {
    const waves = [{ id: 'a', at: 0 }, { id: 'b', at: 5 }];
    const st = { t: 0, fired: {}, clearedAt: {}, kills: 0 };
    assert.deepStrictEqual(M.dueWaves(waves, st).map(w => w.id), ['a']);
    st.fired.a = true; st.t = 4.9;
    assert.deepStrictEqual(M.dueWaves(waves, st), []);
    st.t = 5; assert.deepStrictEqual(M.dueWaves(waves, st).map(w => w.id), ['b']);
  },
  afterClearWaves() {
    const waves = [{ id: 'a', at: 0 }, { id: 'b', after: 'a', delay: 2 }];
    const st = { t: 10, fired: { a: true }, clearedAt: {}, kills: 0 };
    assert.deepStrictEqual(M.dueWaves(waves, st), [], 'a not cleared yet');
    st.clearedAt.a = 9; assert.deepStrictEqual(M.dueWaves(waves, st), [], 'delay not passed');
    st.t = 11; assert.deepStrictEqual(M.dueWaves(waves, st).map(w => w.id), ['b']);
  },
  afterKillsWaves() {
    const waves = [{ id: 'k', afterKills: 3 }];
    const st = { t: 0, fired: {}, clearedAt: {}, kills: 2 };
    assert.deepStrictEqual(M.dueWaves(waves, st), []);
    st.kills = 3; assert.deepStrictEqual(M.dueWaves(waves, st).map(w => w.id), ['k']);
  },
  plannedCount() {
    assert.strictEqual(M.plannedCount([{ spawns: [{ species: 'raptor', n: 2 }, { species: 'grazer', n: 9 }] }, { spawns: [{ species: 'dilo' }] }]), 3);
  },

  // ---------------------------------------------------------------- rails
  railPassesThroughItsPoints() {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 10, y: 0, z: -20 }];
    const r = M.rail(pts);
    const a = r.at(0); near(a.x, 0); near(a.z, 0);
    const b = r.at(r.length); near(b.x, 10, 1e-3); near(b.z, -20, 1e-3);
    // straight first segment heads along -z
    const s = r.at(1); near(s.dx, 0, 0.2, "CR bows a little"); assert.ok(s.dz < -0.97);
    assert.ok(r.length > 24 && r.length < 26, 'length ~ 10 + 14.1: ' + r.length);
  },
  railSamplesAreEvenlySpaced() {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: -30 }];
    const r = M.rail(pts);
    const p1 = r.at(10), p2 = r.at(11);
    near(Math.hypot(p2.x - p1.x, p2.z - p1.z), 1, 0.05);
  },
  railClampsAndHandlesTwoPoints() {
    const r = M.rail([{ x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }]);
    near(r.length, 6, 1e-3);
    near(r.at(-5).x, 0); near(r.at(99).x, 6, 1e-3); near(r.at(3).y, 1);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
