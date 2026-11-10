// Run: node games/flight/test/tutorial.test.js  -- the first-flight lesson waits for each real input
'use strict';
const assert = require('assert');
const T = require('../tutorial.js');

const base = { thr: 0.55, sx: 0, sy: 0, vsFpm: 0, bank: 0, hdg: 90, aglFt: 2000, skim: false };
const run = (st, f, sec) => { const ev = []; for (let t = 0; t < sec; t += 1 / 30) ev.push(...T.update(st, Object.assign({}, base, f), 1 / 30)); return ev; };
const t = {
  waitsForFullPower() {
    const st = T.create('pad');
    assert.strictEqual(T.view(st).id, 'power');
    assert.ok(/R2/.test(T.view(st).text) && /\bA\b/.test(T.view(st).text), 'names the Pad controls');
    run(st, { thr: 0.7 }, 5);
    assert.strictEqual(T.view(st).id, 'power', 'not until 100%');
    const ev = run(st, { thr: 1 }, 0.6);
    assert.ok(ev.some(e => e.type === 'step' && e.step === 'power'));
    assert.strictEqual(T.view(st).id, 'climb');
  },
  climbNeedsTheStickAndTheClimb() {
    const st = T.create('pad'); st.i = 1;
    run(st, { sy: 0.6, vsFpm: 50 }, 4);
    assert.strictEqual(T.view(st).id, 'climb', 'stick back but not climbing yet');
    assert.ok(T.view(st).progress === 0);
    run(st, { sy: 0.6, vsFpm: 700 }, 1);
    assert.ok(T.view(st).progress > 0.3 && T.view(st).progress < 1, 'progress shows while held');
    run(st, { sy: 0.6, vsFpm: 700 }, 1.2);
    assert.strictEqual(T.view(st).id, 'dive');
  },
  turnsCountHeadingChangeTheRightWay() {
    const st = T.create('kbm'); st.i = 3;
    assert.ok(/\bA\b/.test(T.view(st).text), 'keyboard words');
    let hdg = 90;
    for (let k = 0; k < 120; k++) { hdg += 0.4; T.update(st, Object.assign({}, base, { sx: 1, bank: 20, hdg }), 1 / 30); }
    assert.strictEqual(T.view(st).id, 'left', 'turning right does not count for the left turn');
    for (let k = 0; k < 200 && T.view(st).id === 'left'; k++) { hdg -= 0.5; T.update(st, Object.assign({}, base, { sx: -1, bank: -25, hdg }), 1 / 30); }
    assert.strictEqual(T.view(st).id, 'right');
  },
  rightTurnCountsFromWhenTheWingsBankRight() {
    const st = T.create('pad'); st.i = 4;
    let hdg = 90, bank = -25;
    // still rolling out of the left turn: heading keeps going left for a while
    for (let k = 0; k < 90; k++) { hdg -= 0.4; bank += 0.5; T.update(st, Object.assign({}, base, { sx: 1, bank, hdg }), 1 / 30); }
    for (let k = 0; k < 400 && T.view(st).id === 'right'; k++) { hdg += 0.35; T.update(st, Object.assign({}, base, { sx: 1, bank: 25, hdg }), 1 / 30); }
    assert.strictEqual(T.view(st).id, 'release', 'the leftover left drift is not held against the right turn');
  },
  letGoAndEaseOffThenLowPass() {
    const st = T.create('pad'); st.i = 5;
    run(st, { bank: 3 }, 2.2);
    assert.strictEqual(T.view(st).id, 'ease');
    run(st, { thr: 0.6 }, 1.2);
    assert.strictEqual(T.view(st).id, 'low');
    const ev = run(st, { skim: true }, 3.2);
    assert.ok(ev.some(e => e.type === 'done'));
    assert.strictEqual(T.view(st).title, 'You can fly');
  },
  lowPassTimesOutRatherThanTrapping() {
    const st = T.create('pad'); st.i = 7;
    const ev = run(st, {}, 80);
    assert.ok(ev.some(e => e.type === 'done'), 'the last step gives way after its timeout');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed');
process.exitCode = fail ? 1 : 0;
