// Player attitude: send-offs, glares, huddles, the odd chirp. Run: node games/cricket/test/attitude.test.js
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'attitude.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const seed = n => { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

{
  const rng = seed(3), ctx = A.context();
  let all = true;
  for (let i = 0; i < 200; i++) { ctx.ball = i; const r = A.react('wicket', ctx, rng); if (!r || !['bowler', 'fielders', 'keeper'].includes(r.who) || !r.huddle) all = false; }
  check('every wicket: the fielding side celebrates (a huddle and a bowler gesture)', all);
}
{
  const rng = seed(5), ctx = A.context(); let lines = 0, back2back = 0, prevLineBall = -9;
  for (let i = 0; i < 2000; i++) {
    ctx.ball = i;
    const r = A.react(i % 3 ? 'dot' : 'beaten', ctx, rng);
    if (r && r.line) { lines++; if (i - prevLineBall === 1) back2back++; prevLineBall = i; }
  }
  check('chirps on at most 1 in 8 quiet balls', lines <= 2000 / 8 && lines > 50, lines);
  check('never on two balls running', back2back === 0, back2back);
}
{
  const rng = seed(9), ctx = A.context(); let raised = 0;
  for (let i = 0; i < 400; i++) { ctx.ball = i * 3; const r = A.react('six', ctx, rng); if (r && r.who === 'batter') raised++; }
  check('the batter reacts to about half of his sixes (35-65%)', raised >= 140 && raised <= 260, raised);
  const r = A.react('appeal', A.context(), rng);
  check('an appeal: bowler and keeper go up', r && r.gesture === 'appeal');
  const m = A.react('mishap', A.context(), seed(1));
  check('a mishap: the fielder shrugs or facepalms', m && ['shrug', 'facepalm'].includes(m.gesture) && m.who === 'fielder', m);
  check('every reaction lasts 1.2-2.5 s', ['wicket', 'six', 'four', 'dot', 'beaten', 'drop', 'mishap', 'appeal'].every(e => { const x = A.react(e, A.context(), () => 0.001); return !x || (x.secs >= 1.2 && x.secs <= 2.5); }));
}
{
  const BAN = ['fuck', 'shit', 'bitch', 'bastard', 'chutiya', 'madar', 'behen', 'bhosd', 'gaand', 'saala', 'kamina', 'harami', 'randi', 'lund'];
  check('every chirp is short (<= 28 characters)', A.LINES_PG.every(l => l.length <= 28), A.LINES_PG.filter(l => l.length > 28));
  check('no swearing or slurs in any chirp', A.LINES_PG.every(l => !BAN.some(b => l.toLowerCase().includes(b))));
  check('at least 12 chirps', A.LINES_PG.length >= 12, A.LINES_PG.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
