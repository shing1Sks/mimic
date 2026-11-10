// Left-handed play: the hilt rides the left arm, the mirror image of the right arm, and stays
// continuous through 180 deg like the right one. The blade itself is the phone 1:1 either way.
// Run: node games/saber/test/hand.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SW = require('../sweep.js');
const ctx = { window: {}, navigator: {}, performance: { now: () => 0 }, console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'mimic.js'), 'utf8'), ctx);
const MM = ctx.MimicMath;

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); } }
const close = (a, b, e = 1e-9) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.z - b.z) < e;
const mirrorV = v => ({ x: -v.x, y: v.y, z: v.z });
const mirrorQ = q => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const poses = Array.from({ length: 60 }, () => MM.fromEuler((rnd() - 0.5) * 2.4, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 2));
const hand = (q, side, st = {}) => SW.continuousHand(q, MM.armPose(q, side), side, st, 0, MM, 0.4);

test('rightHandMatchesTheArmModelAwayFrom180', () => {
  for (const q of poses) assert(close(hand(q, 'right'), MM.armPose(q, 'right').hand, 1e-9));
});
test('leftHandMatchesTheMirroredArmModelAwayFrom180', () => {
  for (const q of poses) assert(close(hand(q, 'left'), MM.armPose(q, 'left').hand, 1e-9));
});
test('leftHandIsTheMirrorOfTheRightHand', () => {
  for (const q of poses) assert(close(hand(q, 'left'), mirrorV(hand(mirrorQ(q), 'right')), 1e-9));
});
test('leftHiltSitsOnTheLeftAtRest', () => {
  const r = hand({ x: 0, y: 0, z: 0, w: 1 }, 'right'), l = hand({ x: 0, y: 0, z: 0, w: 1 }, 'left');
  assert(r.x > 0.1 && l.x < -0.1 && Math.abs(r.x + l.x) < 1e-9 && Math.abs(r.y - l.y) < 1e-9);
});
test('leftHandStaysContinuousThroughHalfTurn', () => {
  // point straight up, then keep going over the top and behind: the hilt must not jump
  for (const side of ['right', 'left']) {
    const st = {}; let prev = null, worst = 0;
    for (let i = 0; i <= 120; i++) {
      const pitch = (i / 120) * 3.4, q = MM.fromEuler(side === 'left' ? -0.5 : 0.5, pitch, side === 'left' ? -0.8 : 0.8);
      const h = SW.continuousHand(q, MM.armPose(q, side), side, st, 0, MM, 0.4);
      if (prev) worst = Math.max(worst, Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z));
      prev = h;
    }
    assert(worst < 0.03, side + ' jump ' + worst.toFixed(3) + ' m');
  }
});

console.log(fail ? `${fail} failed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
