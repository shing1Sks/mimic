// Run: node games/fishing/test/lobby.test.js
// Party join flow: up to four phones, A joins, B leaves, a joined player holds A to start.
'use strict';
const assert = require('assert');
const Lb = require('../lobby.js');

const inp = (id, o) => Object.assign({ id, kind: 'phone', a: false, b: false, aDown: false }, o);
const hold = (lb, list, secs) => { let ev = []; for (let t = 0; t < secs; t += 0.05) ev = ev.concat(Lb.stepLobby(lb, list, 0.05)); return ev; };

const tests = {
  aJoinsTheFirstFreeSlot() {
    const lb = Lb.createLobby(4);
    const ev = Lb.stepLobby(lb, [inp('p0', { a: true, aDown: true })], 0.016);
    assert(lb.slots[0].id === 'p0' && ev[0].type === 'join');
  },
  holdingTheJoinPressDoesNotStart() {
    const lb = Lb.createLobby(4);
    Lb.stepLobby(lb, [inp('p0', { a: true, aDown: true })], 0.016);
    const ev = hold(lb, [inp('p0', { aDown: true })], 2);
    assert(!ev.some(e => e.type === 'start'));
  },
  releaseThenHoldStarts() {
    const lb = Lb.createLobby(4);
    Lb.stepLobby(lb, [inp('p0', { a: true, aDown: true })], 0.016);
    Lb.stepLobby(lb, [inp('p0')], 0.016);
    const ev = hold(lb, [inp('p0', { aDown: true })], 1);
    assert(ev.some(e => e.type === 'start'));
  },
  fourPlayersFillFourSlots() {
    const lb = Lb.createLobby(4);
    Lb.stepLobby(lb, ['a', 'b', 'c', 'd', 'e'].map(id => inp(id, { a: true })), 0.016);
    assert.deepStrictEqual(lb.slots.map(s => s && s.id), ['a', 'b', 'c', 'd']);
  },
  bLeavesAndOutsideBIsBack() {
    const lb = Lb.createLobby(4);
    Lb.stepLobby(lb, [inp('p0', { a: true })], 0.016);
    let ev = Lb.stepLobby(lb, [inp('p0', { b: true })], 0.016);
    assert(lb.slots[0] === null && ev[0].type === 'leave');
    ev = Lb.stepLobby(lb, [inp('p9', { b: true })], 0.016);
    assert(ev.length === 1 && ev[0].type === 'back');
  },
  aVanishedControllerLeaves() {
    const lb = Lb.createLobby(4);
    Lb.stepLobby(lb, [inp('p0', { a: true }), inp('p1', { a: true })], 0.016);
    const ev = Lb.stepLobby(lb, [inp('p0')], 0.016);
    assert(lb.slots[1] === null && ev.some(e => e.type === 'leave' && e.slot === 1));
  },
  aMinimumCanBeRequired() {
    const lb = Lb.createLobby(4, 2);
    Lb.stepLobby(lb, [inp('p0', { a: true })], 0.016);
    Lb.stepLobby(lb, [inp('p0')], 0.016);
    assert(!hold(lb, [inp('p0', { aDown: true })], 2).some(e => e.type === 'start'));
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
