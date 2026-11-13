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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
