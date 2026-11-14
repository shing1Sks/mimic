// The match story: what Paaji remembers about the players (this match only).
// Run: node games/cricket/test/story.test.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'story.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const ball = (st, o) => S.ball(st, Object.assign({ inn: 0, wk: 0, bowler: 'A', runs: 0, extra: null, wicket: false }, o));

{
  const st = S.create();
  check('the first over of a bowler: a new bowler', S.overStart(st, { inn: 0, bowler: 'A' }) === 'newBowler');
  for (let i = 0; i < 6; i++) ball(st, { runs: 1 });
  check('his second spell, quiet figures: back for another go', S.overStart(st, { inn: 0, bowler: 'A' }) === 'bowlerBack');
  const st2 = S.create();
  for (let i = 0; i < 6; i++) ball(st2, { wicket: i < 2, wk: i < 2 ? i : 2 });
  check('back with two wickets already: on fire', S.overStart(st2, { inn: 0, bowler: 'A' }) === 'bowlerOnFire');
  const st3 = S.create();
  for (let i = 0; i < 6; i++) ball(st3, { runs: i % 2 ? 4 : 2 });
  check('back after 18 off his over: expensive', S.overStart(st3, { inn: 0, bowler: 'A' }) === 'bowlerExpensive');
  check('a bowler of the other innings is new again', S.overStart(st3, { inn: 1, bowler: 'A' }) === 'newBowler');
  check('figures in words: 0-18 (1), 2-0 (1)', S.figures(st3, { inn: 0, bowler: 'A' }) === '0-18 (1)' && S.figures(st2, { inn: 0, bowler: 'A' }) === '2-0 (1)', [S.figures(st3, { inn: 0, bowler: 'A' }), S.figures(st2, { inn: 0, bowler: 'A' })]);
}
{
  const st = S.create();
  for (let i = 0; i < 5; i++) ball(st, { runs: 6 });
  check('a batter past 30: set, called once', S.batterNote(st, { inn: 0, wk: 0 }) === 'batterSet' && S.batterNote(st, { inn: 0, wk: 0 }) === null);
  const st2 = S.create();
  for (let i = 0; i < 7; i++) ball(st2, { runs: i === 3 ? 1 : 0 });
  check('7 balls for 1: struggling, called once', S.batterNote(st2, { inn: 0, wk: 0 }) === 'batterStruggling' && S.batterNote(st2, { inn: 0, wk: 0 }) === null);
  check('the next batter starts with a clean slate', S.batterNote(st2, { inn: 0, wk: 1 }) === null);
  const st3 = S.create();
  ball(st3, { runs: 0, extra: 'wd' }); ball(st3, { runs: 0, extra: 'wd' });
  check('wides are not balls faced', S.batter(st3, { inn: 0, wk: 0 }).balls === 0);
  check('runs and balls in words: 31 (5)', (b => b.runs === 30 && b.balls === 5)(S.batter(st, { inn: 0, wk: 0 })));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
