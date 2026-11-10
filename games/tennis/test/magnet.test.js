// Plain Node test for the swing-timed "magnetic" contact. Run: node games/tennis/test/magnet.test.js
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'contact.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const W = M.MAGNET_WINDOW.NORMAL;

check('windows: EASY wider than NORMAL', M.MAGNET_WINDOW.EASY > M.MAGNET_WINDOW.NORMAL && W >= 0.1);
check('inWindow: on time is in', M.inWindow(0, W) && M.inWindow(W * 0.9, W) && !M.inWindow(W * 1.2, W));

check('swingPower: at threshold = 0', M.swingPower(7, 7, 1) === 0);
check('swingPower: a medium swing (1.8x threshold) is medium power', Math.abs(M.swingPower(12.6, 7, 1) - 0.4) < 0.15, M.swingPower(12.6, 7, 1));
check('swingPower: a big swing (3x threshold) is full power', M.swingPower(21, 7, 1) > 0.95 && M.swingPower(21, 7, 1) <= 1.0001);
check('swingPower: BIG power option boosts it', M.swingPower(12.6, 7, 1.4) > M.swingPower(12.6, 7, 1) + 0.1);


console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
