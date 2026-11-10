// Run: node games/flight/test/skim.test.js  -- the low-flying score: chains, multipliers, bonuses, banking
'use strict';
const assert = require('assert');
const S = require('../skim.js');

const fly = (st, f, sec, dt) => { const ev = []; dt = dt || 1 / 30; for (let t = 0; t < sec; t += dt) ev.push(...S.update(st, Object.assign({ agl: 20, kt: 100, onGround: false, crashed: false, walls: 0, p: 0, q: 0, bank: 0 }, f), dt)); return ev; };
// a run that has been up high once (chains only count after the climb-out)
const armed = () => { const st = S.create(); S.update(st, { agl: 300, kt: 100, onGround: false, walls: 0, p: 0, q: 0, bank: 0 }, 0.01); return st; };
const t = {
  takeoffClimbOutDoesNotScore() {
    const st = S.create();
    S.update(st, { onGround: true }, 1 / 30);
    const ev = fly(st, { agl: 25 }, 8);
    assert.strictEqual(ev.length, 0);
    assert.ok(armed().armed && !st.armed);
  },
  highFlightScoresNothing() {
    const st = S.create();
    const ev = fly(st, { agl: 300 }, 10);
    assert.strictEqual(ev.length, 0);
    assert.strictEqual(st.total, 0);
    assert.strictEqual(st.low, 0);
  },
  tooSlowIsNotASkim() {
    assert.strictEqual(S.lowness(10, 50), 0);
    assert.strictEqual(S.lowness(8, 100), 1);
    assert.ok(S.lowness(40, 100) > 0 && S.lowness(40, 100) < 1);
  },
  lowFlightStartsAChainAndClimbsTheMultiplier() {
    const st = armed();
    const ev = fly(st, { agl: 15 }, 13);
    assert.ok(ev.some(e => e.type === 'start'));
    assert.ok(ev.filter(e => e.type === 'mult').length >= 3, 'x2 x3 x4 by 12 s');
    assert.strictEqual(st.mult, 4);
    assert.ok(st.chain > 500, 'chain ' + st.chain);
    assert.strictEqual(st.total, 0, 'not banked yet');
  },
  lowerScoresFaster() {
    const a = armed(), b = armed();
    fly(a, { agl: 10 }, 6); fly(b, { agl: 45 }, 6);
    assert.ok(a.chain > b.chain * 2, a.chain + ' vs ' + b.chain);
  },
  climbingAwayBanksAfterTheGrace() {
    const st = armed();
    fly(st, { agl: 15 }, 6);
    const chain = Math.round(st.chain);
    let ev = fly(st, { agl: 200 }, 1.5);
    assert.ok(!ev.some(e => e.type === 'banked'), 'a short pop-up keeps the chain');
    ev = fly(st, { agl: 200 }, 1.5);
    const b = ev.find(e => e.type === 'banked');
    assert.ok(b && b.pts === chain, JSON.stringify(b));
    assert.strictEqual(st.total, chain);
    assert.strictEqual(st.best, chain);
    assert.strictEqual(st.mult, 1);
  },
  crashingLosesTheChain() {
    const st = armed();
    fly(st, { agl: 15 }, 5);
    const ev = S.update(st, { crashed: true }, 1 / 30);
    assert.strictEqual(ev[0].type, 'lost');
    assert.strictEqual(st.total, 0);
  },
  ridgeSkimPaysOnceAtTheCrest() {
    const st = armed(), ev = [];
    // the ground rises under us to 12 m below, then falls away
    // sampled at 60 fps: the crest takes ~1 s to pass (the detector is frame-rate independent)
    for (let i = 0; i < 150; i++) { const agl = 12 + Math.abs(i / 60 - 0.9) * 40; ev.push(...S.update(st, { agl, kt: 110, onGround: false, walls: 0, p: 0, q: 0, bank: 0 }, 1 / 60)); }
    const r = ev.filter(e => e.type === 'bonus' && e.kind === 'ridge');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(st.ridges, 1);
  },
  threadingAValley() {
    const st = armed();
    const ev = fly(st, { agl: 30, walls: 2 }, 7);
    assert.strictEqual(ev.filter(e => e.kind === 'thread').length, 2);
    assert.strictEqual(fly(armed(), { agl: 30, walls: 1 }, 7).filter(e => e.kind === 'thread').length, 0);
  },
  rollsLoopsAndInverted() {
    const st = armed();
    let ev = fly(st, { agl: 300, p: 1.2 }, 5.5);   // 1.2 rad/s for 5.5 s: just over one roll
    assert.strictEqual(ev.filter(e => e.kind === 'roll').length, 1);
    ev = fly(st, { agl: 300, q: 0.8, pitch: 80 }, 8.2);
    assert.strictEqual(ev.filter(e => e.kind === 'loop').length, 1);
    assert.strictEqual(fly(armed(), { agl: 300, q: 0.3, pitch: 5 }, 30).filter(e => e.kind === 'loop').length, 0, 'a long steep turn is not a loop');
    ev = fly(st, { agl: 300, bank: 175 }, 3);
    assert.strictEqual(ev.filter(e => e.kind === 'inverted').length, 1, 'once per inversion');
    assert.strictEqual(st.stunts, 3);
    assert.ok(st.total > 3000, 'stunts outside a chain go straight to the total');
  },
  bonusesInAChainAreMultiplied() {
    const st = armed();
    fly(st, { agl: 15 }, 8.5);   // x3
    const ev = fly(st, { agl: 15, p: 1.4 }, 4.6);
    const b = ev.find(e => e.kind === 'roll');
    assert.ok(b && b.pts >= 1000 * 3, JSON.stringify(b));
  },
  landingBanks() {
    const st = armed();
    fly(st, { agl: 15 }, 5);
    const ev = S.update(st, { onGround: true }, 1 / 30);
    assert.strictEqual(ev[0].type, 'banked');
    assert.ok(st.total > 0);
  },
  resultGrades() {
    const st = S.create(); st.total = 10000; st.best = 2500; st.maxMult = 6;
    const r = S.result(st, 10000);
    assert.strictEqual(r.score, 100);
    assert.strictEqual(r.rows.length, 5);
    assert.ok(S.result(Object.assign(S.create(), { total: 0 }), 4000).score === 0);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed');
process.exitCode = fail ? 1 : 0;
