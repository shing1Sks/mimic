// Swing = shot: the direction the hand travels at its fastest aims the ball, the swing's speed
// sets how far it goes. The racket angle is automatic. Run: node games/tennis/test/swing.test.js
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'contact.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const near = (a, b, e) => Math.abs(a - b) < e;

// --- the hand's own motion (phone accelerometer, world frame, gravity removed) ---
function push(h, a, ms) { for (let t = 0; t < ms; t += 8) M.handStep(h, a, 0.008); }
let h = M.handTracker();
M.handStart(h); push(h, { x: 0, y: 0, z: -40 }, 120); M.handMark(h);
let d = M.handDir(h, 0);
check('hand pushed straight at the court: az 0', Math.abs(d.az) < 1e-6, d);
check('hand speed is measured (m/s)', d.speed > 3 && d.speed < 6, d.speed);
h = M.handTracker(); M.handStart(h); push(h, { x: -20, y: 0, z: -40 }, 120); M.handMark(h);
check('hand moving forward-left: az < 0', M.handDir(h, 0).az < -0.3, M.handDir(h, 0));
h = M.handTracker(); M.handStart(h); push(h, { x: 0, y: 0, z: -40 }, 120); M.handMark(h);
push(h, { x: 0, y: 0, z: 60 }, 120); M.handMark(h);   // braking after the hit does not count
check('the fastest moment decides, not the follow-through brake', Math.abs(M.handDir(h, 0).az) < 1e-6);
h = M.handTracker(); push(h, { x: 0, y: 0, z: 0 }, 3000);
check('a still hand drifts to zero', Math.hypot(h.v.x, h.v.y, h.v.z) < 1e-6);
h = M.handTracker(); M.handStart(h); push(h, { x: 0, y: 30, z: -40 }, 120); M.handMark(h);
check('upward hand path reads as lift', M.handDir(h, 0).lift > 0.3);
h = M.handTracker(); M.handStart(h);
for (let i = 0; i < 25; i++) { M.handStep(h, { x: 0, y: 0, z: 200 }, 0.008); M.handMark(h); }   // big fast wind-up, backward
for (let i = 0; i < 25; i++) { M.handStep(h, { x: -10, y: 0, z: -200 }, 0.008); M.handMark(h); } // forward, a little left
check('the back-swing never counts: only motion toward the court aims', h.best && h.best.z < 0 && Math.abs(M.handDir(h, 0).az) < 0.3, h.best);
h = M.handTracker(); M.handStart(h); push(h, { x: 0, y: 0, z: -40 }, 120); M.handMark(h);
check('bias corrects a natural lean (a +0.2 bias turns straight into az -0.2)', Math.abs(M.handDir(h, 0.2).az + 0.2) < 1e-6);
check('empty tracker is straight', M.handDir(M.handTracker(), 0).az === 0);
check('handPower: 1.2 m/s is nothing, 4.5 m/s is full, more over-hits', M.handPower(1.2) === 0 && Math.abs(M.handPower(4.5) - 1) < 1e-6 && M.handPower(9) === 1.25);

// --- rally: direction from the swing, depth from power ---
const from = { x: 0, y: 1, z: 11.5 };
const r0 = M.swingRally({ from, az: 0, power: 0.6, lift: 0 });
check('straight swing from the middle lands down the middle', Math.abs(r0.target.x) < 0.2 && r0.target.z < 0, r0.target);
const rL = M.swingRally({ from, az: -0.3, power: 0.6, lift: 0 });
const rR = M.swingRally({ from, az: 0.3, power: 0.6, lift: 0 });
check('swing left goes left, swing right goes right', rL.target.x < -2 && rR.target.x > 2, [rL.target.x, rR.target.x]);
const soft = M.swingRally({ from, az: 0, power: 0.1, lift: 0 });
const hard = M.swingRally({ from, az: 0, power: 1, lift: 0 });
check('harder swing lands deeper and faster', hard.target.z < soft.target.z - 5 && hard.pace > soft.pace + 20, [soft, hard]);
check('a full swing still lands in (inside the baseline)', hard.target.z > -11.89, hard.target);
const over = M.swingRally({ from, az: 0, power: 1.25, lift: 0 });
check('an over-hit sails long', over.target.z < -11.89, over.target);
check('a 25-degree swing stays in, a very wide one can go out wide', Math.abs(M.swingRally({ from, az: 0.44, power: 0.6, lift: 0 }).target.x) < 4.12 && M.swingRally({ from, az: 1.2, power: 0.6, lift: 0 }).target.x > 4.12);
check('lift makes topspin', M.swingRally({ from, az: 0, power: 0.6, lift: 1 }).top > 0.3);

// --- serve: aimed from the box centre, depth from power, an over-hit is long ---
const box = { x0: -4.11, x1: 0, z0: -6.4, z1: 0 };
const sv = { x: 0.85, y: 2.6, z: 12.35 };
const s0 = M.swingServe({ from: sv, az: 0, power: 0.6, box });
check('straight serve lands in the box', s0.target.x > box.x0 && s0.target.x < box.x1 && s0.target.z < 0 && s0.target.z > box.z0, s0.target);
const sL = M.swingServe({ from: sv, az: -0.3, power: 0.6, box }), sR = M.swingServe({ from: sv, az: 0.3, power: 0.6, box });
check('serve: swing left goes left, swing right goes right', sL.target.x < s0.target.x - 0.8 && sR.target.x > s0.target.x + 0.8, [sL.target.x, sR.target.x]);
const sSoft = M.swingServe({ from: sv, az: 0, power: 0.1, box }), sHard = M.swingServe({ from: sv, az: 0, power: 1, box });
check('serve: harder goes deeper and faster', sHard.target.z < sSoft.target.z - 2.5 && sHard.pace > sSoft.pace + 20, [sSoft, sHard]);
check('serve: a full swing is a deep serve, still in', sHard.target.z > box.z0, sHard.target);
check('serve: an over-hit goes past the service line', M.swingServe({ from: sv, az: 0, power: 1.25, box }).target.z < box.z0);
check('serve: a wide swing can miss the box', M.swingServe({ from: sv, az: 0.9, power: 0.6, box }).target.x > box.x1);

check('swingPower lets a huge swing over-hit (above 1)', M.swingPower(26, 7, 1) > 1.05 && M.swingPower(60, 7, 1) <= 1.25);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
