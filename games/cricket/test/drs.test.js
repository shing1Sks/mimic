// DRS: ball-tracking verdicts for an LBW review (pitching, impact, wickets, umpire's call).
// Run: node games/cricket/test/drs.test.js
'use strict';
const path = require('path');
const D = require(path.join(__dirname, '..', 'drs.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const v = (pitchX, atX, sx, sy) => D.verdict({ pitch: { x: pitchX, z: -4 }, at: { x: atX }, stumps: { x: sx, y: sy }, side: 1 });
{
  const r = v(0.02, 0.03, 0.02, 0.4);
  check('in line, in line, hitting the middle: OUT, not umpire\'s call', r.out && !r.umpiresCall && r.rows.map(x => x.v).join() === 'IN LINE,IN LINE,HITTING', r);
  const leg = v(-0.4, 0.03, 0.02, 0.4);
  check('pitched outside leg: NOT OUT whatever else', !leg.out && leg.rows[0].v === 'OUTSIDE LEG', leg);
  const off = v(0.4, 0.03, 0.02, 0.4);
  check('pitched outside off is fine (only leg side is protected)', off.out && off.rows[0].v === 'OUTSIDE OFF', off);
  const imp = v(0.02, 0.3, 0.02, 0.4);
  check('hit outside the line: NOT OUT', !imp.out && imp.rows[1].v === 'OUTSIDE', imp);
  const miss = v(0.02, 0.03, 0.3, 0.4);
  check('missing the stumps: NOT OUT, MISSING', !miss.out && miss.rows[2].v === 'MISSING', miss);
  const high = v(0.02, 0.03, 0.0, 0.9);
  check('going over the top: MISSING', !high.out && high.rows[2].v === 'MISSING', high);
  const clip = v(0.02, 0.03, 0.13, 0.4);
  check('only clipping the outside of the stumps: UMPIRE\'S CALL, the on-field OUT stands', clip.out && clip.umpiresCall && clip.rows[2].v === "UMPIRE'S CALL", clip);
  const lefty = D.verdict({ pitch: { x: 0.4, z: -4 }, at: { x: 0.03 }, stumps: { x: 0, y: 0.4 }, side: -1 });
  check('a left-hander: +x is his leg side', !lefty.out && lefty.rows[0].v === 'OUTSIDE LEG', lefty);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
