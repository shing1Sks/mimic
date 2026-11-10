// The scorebook and the lobby. Run: node games/cricket/test/match.test.js
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'match.js'));
const L = require(path.join(__dirname, '..', 'lobby.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

{
  const m = M.create({ overs: 1, wickets: 2, names: ['ANA', 'BEN'], firstBat: 0 });
  const seq = [{ runs: 4, boundary: true }, { runs: 0 }, { extra: 'wd' }, { runs: 1 }, { runs: 6 }, { runs: 0, wicket: 'bowled' }];
  let ev;
  seq.forEach(b => { ev = M.record(m, b); });
  const a = m.innings[0];
  check('5 legal balls + a wide: 12 runs, 1 wicket, 0.5 overs', a.runs === 12 && a.wkts === 1 && M.oversText(a.balls) === '0.5', [a.runs, a.wkts, a.balls]);
  check('ball-by-ball labels', a.cur.join(' ') === '4 • wd 1 6 W', a.cur);
  ev = M.record(m, { runs: 2 });
  check('the sixth legal ball ends the over and the innings (1 over)', ev.over && ev.inningsOver && m.i === 1 && m.target === 15, [ev, m.target]);
  check('the second innings: the other player bats', M.current(m).bat === 1 && M.need(m).text === 'NEED 15 FROM 6');
  M.record(m, { runs: 6 }); M.record(m, { runs: 4, boundary: true });
  M.record(m, { extra: 'nb', runs: 4 });
  check('a no-ball scores 1 plus what was hit, and is not a legal ball', M.current(m).runs === 15 && M.current(m).balls === 2, M.current(m));
  check('...the chase is over once the target is reached', m.done);
  const r = M.result(m);
  check('result: BEN wins by 2 wickets with 4 balls left', r.winner === 1 && r.text === 'BEN wins by 2 wickets (4 balls left)', r);
}
{
  const m = M.create({ overs: 1, wickets: 1, names: ['A', 'B'], firstBat: 1 });
  check('B bats first when chosen', M.current(m).bat === 1);
  M.record(m, { runs: 1 }); M.record(m, { runs: 0, wicket: 'caught' });
  check('all out (1 wicket) ends the innings at once', m.i === 1 && m.target === 2);
  for (let i = 0; i < 6; i++) M.record(m, { runs: 0 });
  check('defended 0: B wins by 1 run', m.done && M.result(m).winner === 1 && M.result(m).text === 'B wins by 1 run', M.result(m));
}
{
  const m = M.create({ overs: 1, wickets: 2 });
  for (let i = 0; i < 6; i++) M.record(m, { runs: 1 });
  for (let i = 0; i < 6; i++) M.record(m, { runs: 1 });
  check('level scores: tied', M.result(m).by === 'tie');
}

// --- lobby
{
  const lb = L.createLobby(2);
  const inp = (id, o) => Object.assign({ id, kind: 'phone', a: false, b: false, one: false, aDown: false }, o);
  let ev = L.stepLobby(lb, [inp('p0', { a: true, aDown: true }), inp('p1')], 0.016);
  check('HOLD joins the first free seat', ev[0].type === 'join' && lb.slots[0].id === 'p0');
  ev = L.stepLobby(lb, [inp('p0', { aDown: true }), inp('p1')], 0.5);
  check('holding with one seat empty does not start', !ev.length && lb.hold === 0);
  L.stepLobby(lb, [inp('p0'), inp('p1', { a: true, aDown: true })], 0.016);
  ev = L.stepLobby(lb, [inp('p0', { one: true }), inp('p1')], 0.016);
  check('SWITCH from a seated phone swaps who bats first', ev[0].type === 'swap' && lb.firstBat === 1);
  ev = L.stepLobby(lb, [inp('p0', { aDown: true }), inp('p1')], 0.5);
  ev = ev.concat(L.stepLobby(lb, [inp('p0', { aDown: true }), inp('p1')], 0.4));
  check('both seated, a held HOLD starts after 0.8 s', ev.some(e => e.type === 'start'));
  ev = L.stepLobby(lb, [inp('p0')], 0.016);
  check('a phone that disappears leaves its seat', ev[0].type === 'leave' && lb.slots[1] === null);
  ev = L.stepLobby(lb, [inp('p0'), inp('p9', { b: true })], 0.016);
  check('B from a phone not seated goes back', ev[0].type === 'back');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
