// Two-player join flow. Run: node games/tennis/test/lobby.test.js
'use strict';
const path = require('path');
const Lb = require(path.join(__dirname, '..', 'lobby.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const inp = (id, o) => Object.assign({ id, kind: 'phone', a: false, b: false, aDown: false }, o);
let lb = Lb.createLobby(2);
let ev = Lb.stepLobby(lb, [inp('p0', { a: true, aDown: true }), inp('p1')], 0.016);
check('A joins the first free slot', lb.slots[0] && lb.slots[0].id === 'p0' && ev[0].type === 'join');
check('the join press does not start', !ev.some(e => e.type === 'start'));
ev = Lb.stepLobby(lb, [inp('p0', { aDown: true }), inp('p1')], 1);
check('cannot start with an empty slot', !ev.some(e => e.type === 'start') && lb.hold === 0);
ev = Lb.stepLobby(lb, [inp('p0'), inp('p1', { a: true, aDown: true })], 0.016);
check('second controller takes P2', lb.slots[1] && lb.slots[1].id === 'p1');
ev = Lb.stepLobby(lb, [inp('p0', { b: true }), inp('p1')], 0.016);
check('B leaves', lb.slots[0] === null && ev[0].type === 'leave');
ev = Lb.stepLobby(lb, [inp('p0', { a: true, aDown: true }), inp('p1')], 0.016);
check('rejoin fills the free slot', lb.slots[0].id === 'p0');
let started = false;
for (let i = 0; i < 30 && !started; i++) started = Lb.stepLobby(lb, [inp('p0', { aDown: true }), inp('p1')], 0.05).some(e => e.type === 'start');
check('holding A with every slot filled starts', started);
ev = Lb.stepLobby(lb, [inp('p0')], 0.016);
check('a controller that disappears leaves', lb.slots[1] === null && ev.some(e => e.type === 'leave' && e.slot === 1));
ev = Lb.stepLobby(Lb.createLobby(2), [inp('p9', { b: true })], 0.016);
check('B from outside the lobby is back', ev.length === 1 && ev[0].type === 'back');
ev = Lb.stepLobby(lb, [inp('p0'), inp('p1', { a: true }), inp('p2', { a: true })], 0.016);
check('no third slot in singles', lb.slots.filter(Boolean).length === 2 && !lb.slots.some(s => s && s.id === 'p2'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
