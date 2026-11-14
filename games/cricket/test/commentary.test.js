// Paaji's call scheduler: one line at a time, big moments first, no repeats, nothing stale.
// Run: node games/cricket/test/commentary.test.js
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'commentary.js'));
const LINES = require(path.join(__dirname, '..', 'commentary-lines.js')).LINES;
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const seed = n => { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const clock = () => { const c = { t: 100000 }; c.now = () => c.t; return c; };

check('the bundled lines cover every moment the game calls', ['six', 'four', 'edgeFour', 'dot', 'beaten', 'appeal', 'bowled', 'caught', 'lbw', 'playedOn', 'dropped', 'misfield', 'sledge', 'lastOver', 'quick20', 'hatTrick', 'threeWickets', 'wide', 'noBall', 'won', 'lost', 'betweenOvers', 'start'].every(m => LINES.some(l => l.moment === m)));
check('every line has an id, a moment, a priority 1-4 and subtitle text', LINES.every(l => l.id && l.moment && [1, 2, 3, 4].includes(l.prio) && l.text.length > 3));
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(1) });
  const d = s.moment('dot', c.t);
  check('a dot ball gets a line', d && d.moment === 'dot');
  c.t += 300;
  const six = s.moment('six', c.t);
  check('a six interrupts a dot line still playing', six && six.moment === 'six');
  c.t += 300;
  check('a four does not interrupt the six', s.moment('four', c.t) === null);
  c.t += 5000;
  check('once the six is done, the four gets its turn', s.moment('four', c.t) !== null);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(2), coolDownMs: 4000 });
  const a = s.moment('dot', c.t); s.done(a.id); c.t += 1500;
  check('quiet balls stay quiet: a second dot line inside the cool-down is skipped', s.moment('dot', c.t) === null);
  c.t += 4000;
  check('...and allowed after it', s.moment('dot', c.t) !== null);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(3), noRepeat: 15 });
  const ids = [];
  for (let i = 0; i < 500; i++) { const l = s.moment(['six', 'four', 'caught', 'bowled', 'dropped'][i % 5], c.t); if (l) { ids.push(l.id); s.done(l.id); } c.t += 6000; }
  let rep = 0; ids.forEach((id, i) => { if (ids.slice(Math.max(0, i - 15), i).includes(id)) rep++; });
  check('no line repeats within the last 15 played (500 requests)', rep === 0 && ids.length > 400, [rep, ids.length]);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(4) });
  check('a moment more than 1 s old is dropped (a hidden tab coming back)', s.moment('six', c.t - 1200) === null);
  check('an unknown moment gets nothing, no error', s.moment('nope', c.t) === null);
  const s2 = C.createScheduler({ lines: LINES, now: c.now, rng: seed(4), clips: null });
  check('without any audio clips, lines still come (subtitles only)', s2.moment('six', c.t) !== null);
}

{
  // review: the result call must never be lost behind a long six or wicket clip
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(5) });
  s.moment('six', c.t); c.t += 300;
  const won = s.moment('won', c.t);
  check('the match-winning call interrupts the six that won it', won && won.moment === 'won');
  c.t += 300;
  check('...and nothing interrupts the result call', s.moment('caught', c.t) === null);
  const c2 = clock(), s2 = C.createScheduler({ lines: LINES, now: c2.now, rng: seed(6) });
  s2.moment('bowled', c2.t); c2.t += 800;
  check('a wicket on the very next moment, inside 1.5 s of the last big call: waits', s2.moment('caught', c2.t) === null);
  c2.t += 1000;
  check('a new big moment interrupts an older big call after 1.5 s', s2.moment('caught', c2.t) !== null);
  check('milestones (quick 20, three wickets) and results outrank a wicket call', ['quick20', 'threeWickets'].every(m => LINES.find(l => l.moment === m).prio >= 3) && ['won', 'lost', 'hatTrick'].every(m => LINES.find(l => l.moment === m).prio === 4));
}
{
  // his own famous lines (w: 3) are picked three times as readily as each original one
  const L = [{ id: 'r1', moment: 'x', prio: 2, text: 'real one', w: 3 }, { id: 'o1', moment: 'x', prio: 2, text: 'orig one' }, { id: 'o2', moment: 'x', prio: 2, text: 'orig two' }, { id: 'o3', moment: 'x', prio: 2, text: 'orig six' }];
  const c = clock(), s = C.createScheduler({ lines: L, now: c.now, rng: seed(9), noRepeat: 1 });
  const n = {}; let prev = null, rep = 0;
  for (let i = 0; i < 3000; i++) { const l = s.moment('x', c.t); n[l.id] = (n[l.id] || 0) + 1; if (l.id === prev) rep++; prev = l.id; s.done(l.id); c.t += 6000; }
  const ratio = n.r1 / ((n.o1 + n.o2 + n.o3) / 3);
  // with no back-to-back repeats, w:3 among four lines settles at 3/5 of the time after another line: 1.8x each other one
  check('weighted lines: a w:3 line plays ~1.8x as often as each w:1 line here, never twice in a row', ratio > 1.6 && ratio < 2.0 && rep === 0, [n, ratio.toFixed(2)]);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
