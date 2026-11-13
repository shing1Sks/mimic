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
check('every line has an id, a moment, a priority 1-3 and subtitle text', LINES.every(l => l.id && l.moment && [1, 2, 3].includes(l.prio) && l.text.length > 3));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
