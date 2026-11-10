// The session the player called "so much better" (2026-11-10 18:58, Grip, 18 balls, CENTRE
// aligned), replayed with the game's defaults. Guards the two changes that made it: the added
// approach walk (kin.js APPROACH) and Aim Normal 0.25 (kin.js AIM). If a change drops these
// numbers, it has undone what the player felt. Skipped if the recording is not on this machine.
// Run: node games/bowling/test/feel.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const REC = path.join(__dirname, '..', '..', '..', 'recordings', 'bowling-20261110-185800');
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
if (!fs.existsSync(path.join(REC, 'input.ndjson'))) {
  console.log('  skip (no recording at ' + REC + ')\n\n0 passed, 0 failed');
  process.exit(0);
}
const K = require(path.join(__dirname, '..', 'kin.js'));
const RP = require(path.join(__dirname, '..', 'tools', 'replay.js'));
const lines = RP.load(REC);
const sum = rows => {
  const r = rows.filter(x => x.roll && x.roll.down != null), k = r.map(x => x.kmh).sort((a, b) => a - b);
  return { n: r.length, pins: r.reduce((a, x) => a + x.roll.down, 0), gutters: r.filter(x => x.roll.gutter).length, kmh: k[k.length >> 1] };
};

check('defaults: the approach is a 2 m/s walk and Aim Normal keeps 0.25', K.APPROACH.V === 2.0 && K.AIM.NORMAL === 0.25, [K.APPROACH.V, K.AIM.NORMAL]);
const now = sum(RP.replay(lines, {}));
check('all 18 balls replay', now.n === 18, now.n);
check('with the defaults the balls leave at alley speed (median 18-26 km/h)', now.kmh > 18 && now.kmh < 26, now);
check('...and knock down 75+ pins with at most 4 gutters (the player scored 81 live)', now.pins >= 75 && now.gutters <= 4, now);
K.APPROACH.V = 0;
const before = sum(RP.replay(lines, { aim: 0.4 }));
K.APPROACH.V = 2.0;
check('the same swings without the approach and at aim 0.4 (the old game) do far worse: < 65 pins, 6+ gutters', before.pins < 65 && before.gutters >= 6, before);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
