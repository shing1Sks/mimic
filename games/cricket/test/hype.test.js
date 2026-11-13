// The stadium: a mixed crowd backing both sides, placards, cheerleaders, the band.
// Run: node games/cricket/test/hype.test.js
'use strict';
const path = require('path');
const H = require(path.join(__dirname, '..', 'hype.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const ctx = { batting: 'ind', bowling: 'pak' };

for (const ev of ['six', 'four']) {
  const r = H.crowd(ev, ctx);
  check(`${ev}: the batting side's fans roar, the bowling side's groan`, r.roar === 'ind' && r.groan === 'pak', r);
}
for (const ev of ['wicket', 'dot', 'catch']) {
  const r = H.crowd(ev, ctx);
  check(`${ev}: the bowling side's fans roar, the batting side's groan`, r.roar === 'pak' && r.groan === 'ind', r);
}
check('placards: 6 and DHO DAALA on a six, 4 on a four, OUT! on a wicket', H.crowd('six', ctx).placards.includes('6') && H.crowd('six', ctx).placards.includes('DHO DAALA') && H.crowd('four', ctx).placards.includes('4') && H.crowd('wicket', ctx).placards.includes('OUT!'));
check('both sides never roar at once', ['six', 'four', 'wicket', 'dot', 'catch', 'drop', 'nope'].every(e => { const r = H.crowd(e, ctx); return !(r.roar && r.roar === r.groan); }));
check('cheerleaders dance on boundaries and wickets, not on a dot', H.crowd('six', ctx).dance && H.crowd('four', ctx).dance && H.crowd('wicket', ctx).dance && !H.crowd('dot', ctx).dance);
check('the band plays on a six and a wicket (a sting), not on a single', H.crowd('six', ctx).band && H.crowd('wicket', ctx).band && !H.crowd('dot', ctx).band);
check('an unknown event: a quiet crowd', (r => !r.roar && !r.groan && !r.placards.length && !r.dance)(H.crowd('nope', ctx)));
check('lowest graphics: no cheerleaders, no placards, half the fireworks', (q => q.cheerleaders === false && q.placards === false && q.fireworks === 0.5)(H.extras('LOW')) && (q => q.cheerleaders && q.placards && q.fireworks === 1)(H.extras('HIGH')));

{
  // a hat-trick: three wickets on three balls running, same innings, same bowler
  const w = (inn, ball, bowler) => ({ inn, ball, bowler });
  check('three in a row by one bowler: hat-trick', H.hatTrick([w(0, 3, 'A'), w(0, 4, 'A')], w(0, 5, 'A')));
  check('not across innings', !H.hatTrick([w(0, 4, 'A'), w(0, 5, 'A')], w(1, 6, 'A')));
  check('not across a change of bowler', !H.hatTrick([w(0, 4, 'A'), w(0, 5, 'A')], w(0, 6, 'B')));
  check('not with a gap', !H.hatTrick([w(0, 2, 'A'), w(0, 4, 'A')], w(0, 5, 'A')));
  check('not with two wickets', !H.hatTrick([w(0, 4, 'A')], w(0, 5, 'A')));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
