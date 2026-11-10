// Left-handed play is the right-handed game mirrored across the player's own x axis: the stroke
// read from the racket's take-back, the contact angle footwork aims for, and the natural lean of
// each stroke. Run: node games/tennis/test/hand.test.js
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'contact.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);

// three.js yaw: + turns left. A right-hander takes a forehand back on the right (yaw < 0).
check('right hand: racket back on the right = forehand', M.strokeSide(-1.2, 'right') === 'fh');
check('right hand: racket back on the left = backhand', M.strokeSide(1.2, 'right') === 'bh');
check('left hand: racket back on the left = forehand', M.strokeSide(1.2, 'left') === 'fh');
check('left hand: racket back on the right = backhand', M.strokeSide(-1.2, 'left') === 'bh');
check('both hands: racket in front = no stroke yet', M.strokeSide(0.3, 'left') === null && M.strokeSide(-0.3, 'right') === null);
check('default (no hand given) is right-handed', M.strokeSide(-1.2) === 'fh' && M.sideSign() === 1);
for (const y of [-2, -0.61, -0.2, 0, 0.4, 0.61, 1.9]) {
  check('mirror symmetry of the stroke read at yaw ' + y, M.strokeSide(y, 'left') === M.strokeSide(-y, 'right'));
}

// contact angle: the left-hander's is the right-hander's mirrored (yaw and court angle flip)
for (const st of ['fh', 'bh']) {
  for (const az of [-0.3, -0.1, 0, 0.12, 0.3]) {
    check(`contact yaw ${st} az ${az}: left = -right(-az)`, near(M.contactYaw(st, az, 'left'), -M.contactYaw(st, -az, 'right')));
  }
}
check('right forehand contact is on the right (yaw < 0)', M.contactYaw('fh', 0, 'right') < -1.1);
check('left forehand contact is on the left (yaw > 0)', M.contactYaw('fh', 0, 'left') > 1.1);
check('left backhand contact is on the right (yaw < 0)', M.contactYaw('bh', 0, 'left') < -1.1);
check('right-hand contact yaw unchanged from the original formula',
  near(M.contactYaw('fh', 0.1, 'right'), Math.max(-1.85, Math.min(-1.2, -Math.PI / 2 - 0.1))) &&
  near(M.contactYaw('bh', 0.1, 'right'), Math.max(1.2, Math.min(1.85, Math.PI / 2 - 0.1))));

// natural lean: mirrored, so a left-hander's straight swing also aims straight
for (const k of ['fh', 'bh', 'sv']) {
  check('swing bias ' + k + ' mirrors for a left hand', near(M.swingBias(k, 'left'), -M.SWING_BIAS[k]) && near(M.swingBias(k, 'right'), M.SWING_BIAS[k]));
}
function hand(ax) { const h = M.handTracker(); M.handStart(h); for (let t = 0; t < 120; t += 8) M.handStep(h, { x: ax, y: 0, z: -40 }, 0.008); M.handMark(h); return h; }
const rAz = M.handDir(hand(-7), M.swingBias('fh', 'right')).az;
const lAz = M.handDir(hand(7), M.swingBias('fh', 'left')).az;
check('a mirrored forehand aims mirrored (left az = -right az)', near(lAz, -rAz, 1e-6), { rAz, lAz });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
