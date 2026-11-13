// Athlete animation maths: arms that bend at the elbow, hands on the right side, fielding actions.
// Run: node games/cricket/test/anim.test.js
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'anim.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
/** The athlete's own right, for a facing (rad about y; 0 = facing +z). */
const rightOf = f => ({ x: -Math.cos(f), y: 0, z: Math.sin(f) });

{
  const sh = { x: 0, y: 1.45, z: 0 }, hand = { x: 0.2, y: 1.1, z: 0.25 }, U = 0.3, L = 0.28;   // 0.47 m away: within reach
  const pole = { x: -1, y: -0.5, z: 0 };
  const el = A.solveElbow(sh, hand, U, L, pole);
  check('upper arm keeps its length', Math.abs(len(sub(el, sh)) - U) < 1e-3, len(sub(el, sh)));
  check('forearm keeps its length', Math.abs(len(sub(hand, el)) - L) < 1e-3, len(sub(hand, el)));
  const mid = { x: (sh.x + hand.x) / 2, y: (sh.y + hand.y) / 2, z: (sh.z + hand.z) / 2 };
  check('the elbow bends towards the pole', dot(sub(el, mid), pole) > 0);
  const far = { x: 0, y: 1.45, z: 1.6 }, e2 = A.solveElbow(sh, far, U, L, pole);
  check('out of reach: the arm straightens towards the hand', Math.abs(e2.z - U) < 1e-6 && Math.abs(e2.x) < 1e-6 && Math.abs(e2.y - 1.45) < 1e-6, e2);
  const e3 = A.solveElbow(sh, sh, U, L, pole);
  check('a hand on the shoulder gives a finite elbow', [e3.x, e3.y, e3.z].every(Number.isFinite), e3);
}
{
  for (const f of [0, Math.PI, Math.PI / 2, -2.3]) {
    const R = rightOf(f), p = A.handPair({ x: 3, y: 1.2, z: -7 }, f, 0.09);
    const c = { x: 3, y: 1.2, z: -7 };
    check(`facing ${f.toFixed(2)}: left hand on his left, right on his right (never crossed)`, dot(sub(p.left, c), R) < -0.08 && dot(sub(p.right, c), R) > 0.08, p);
  }
  for (const side of [-1, 1]) for (const f of [0, Math.PI]) {
    const pole = A.elbowPole(f, side), R = rightOf(f);
    check(`elbow pole points out to the ${side > 0 ? 'right' : 'left'} and down (facing ${f.toFixed(2)})`, dot(pole, R) * side > 0.3 && pole.y < -0.3 && Math.abs(len(pole) - 1) < 1e-6, pole);
  }
}

{
  // what a fielder does to take a catch: from {x, z, face (toward the batter)}, the catch point,
  // and how far he could run in the time (runCap, m)
  const me = { x: 0, z: -30, face: 0 }, R = rightOf(0);
  const at = (side, y, fwd) => ({ x: me.x + R.x * side, y, z: me.z + R.z * side + (fwd || 0) });
  const leap = A.fieldAction(me, at(0, 2.5), 0);
  check('a ball at 2.5 m: a leap, 0.5 m off the ground', leap.kind === 'leap' && Math.abs(leap.lift - 0.5) < 1e-9, leap);
  check('1.9 m: a high take', A.fieldAction(me, at(0, 1.9), 0).kind === 'high');
  check('0.3 m: a low take', A.fieldAction(me, at(0, 0.3), 0).kind === 'low');
  const dive = A.fieldAction(me, at(1.6, 1.0), 0);
  check('1.6 m to his right at chest height, no time to run: a dive to the right', dive.kind === 'dive' && dive.side === 1, dive);
  const lefty = A.fieldAction({ x: 0, z: -30, face: Math.PI }, { x: -1.6, y: 1.0, z: -30 }, 0);
  check('facing the other way, the same spot is to his left: dive left', lefty.kind === 'dive' && lefty.side === -1, lefty);
  check('the same ball with time to run there: no dive', A.fieldAction(me, at(1.6, 1.0), 3).kind === 'take');
  check('straight at him: a plain take', A.fieldAction(me, at(0, 1.1), 0).kind === 'take');
  const p0 = A.actionPose(dive, -1), p1 = A.actionPose(dive, 0), p2 = A.actionPose(dive, 2);
  check('dive pose: upright before, down on his side at the catch, back up after', p0.roll === 0 && Math.abs(p1.roll) > 1 && Math.sign(p1.roll) === 1 && p1.y < -0.3 && p2.roll === 0 && p2.y === 0, [p0, p1, p2]);
  const l1 = A.actionPose(leap, 0);
  check('leap pose: in the air at the catch', Math.abs(l1.y - 0.5) < 0.05 && l1.roll === 0, l1);
}
{
  // gesture hands, in the athlete's own frame
  for (const f of [0, Math.PI]) {
    const st = { x: 2, z: -10, facing: f }, R = rightOf(f), rel = p => ({ r: dot(sub(p, { x: 2, y: 0, z: -10 }), R), y: p.y });
    const so = A.gestureHands('sendoff', st);
    check(`sendoff (facing ${f.toFixed(1)}): right arm points out to his right, above the shoulder; left hand low`, rel(so.right).r > 0.5 && so.right.y > 1.6 && so.left.y < 1.2, so);
    const fp = A.gestureHands('facepalm', st);
    check('facepalm: both hands at the face', fp.left.y > 1.5 && fp.right.y > 1.5 && Math.abs(rel(fp.left).r) < 0.15 && Math.abs(rel(fp.right).r) < 0.15, fp);
    const sh = A.gestureHands('shrug', st);
    check('shrug: palms out at the waist, each on its own side', sh.left.y < 1.2 && rel(sh.left).r < -0.3 && rel(sh.right).r > 0.3, sh);
    const ap = A.gestureHands('appeal', st);
    check('appeal: both arms up', ap.left.y > 2 && ap.right.y > 2 && rel(ap.left).r < 0 && rel(ap.right).r > 0, ap);
  }
  check('unknown gesture: no arms', A.gestureHands('nope', { x: 0, z: 0, facing: 0 }) === null);
}
{
  const st = { x: 0, z: 0, facing: 0 }, R = rightOf(0), h = A.gestureHands('stare', st);
  check('stare: hands on hips, each on its own side, at the waist', h && h.left.y > 0.85 && h.left.y < 1.15 && dot(h.left, R) < -0.15 && dot(h.right, R) > 0.15, h);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
