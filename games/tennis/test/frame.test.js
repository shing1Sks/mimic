// The far player's frame is the court turned half a turn: shots solved there must fly in the
// world exactly as the mirror image of the same shot from the near side.
// Run: node games/tennis/test/frame.test.js
'use strict';
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'physics.js'));
const F = require(path.join(__dirname, '..', 'frame.js'));
const TN = global.TN;
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);

const v = { x: 1.5, y: 2, z: -3 };
check('L is its own inverse', JSON.stringify(F.L(-1, F.L(-1, v))) === JSON.stringify(v));
check('near side is the world', JSON.stringify(F.L(1, v)) === JSON.stringify(v));
check('far side turns x and z', F.L(-1, v).x === -1.5 && F.L(-1, v).y === 2 && F.L(-1, v).z === 3);

// a shot the far player solves in their frame, flown in the world, lands at the turned target
const fromL = { x: 0.8, y: 1.0, z: 11.6 }, targetL = { x: -2.5, z: -9 };
const solL = TN.solveShot(fromL, targetL, 24, 0.5, { clearNet: true });
const solW = F.solToWorld(-1, solL);
const b = { p: F.L(-1, fromL), v: solW.v, w: solW.w, rolling: false };
const pr = TN.predict(b, 4, 1);
check('far player shot lands at the turned target (x)', near(pr.firstBounce.x, -targetL.x, 0.05), pr.firstBounce);
check('far player shot lands at the turned target (z)', near(pr.firstBounce.z, -targetL.z, 0.05), pr.firstBounce);
// prediction from the far frame equals the turned world prediction
const prL = TN.predict(F.localBall(-1, b), 4, 1);
check('prediction is frame independent', near(prL.firstBounce.x, -pr.firstBounce.x, 1e-6) && near(prL.firstBounce.z, -pr.firstBounce.z, 1e-6));

// the receiver's deuce box seen from the far server's frame is the near server's deuce box
const boxW = TN.serviceBox(1, true), boxL = TN.serviceBox(-1, true);
const c = F.L(-1, { x: (boxW.x0 + boxW.x1) / 2, y: 0, z: (boxW.z0 + boxW.z1) / 2 });
check('service boxes turn into each other', TN.inBox(c.x, c.z, boxL), { c, boxL });

// orientation: a racket pointing into the court (-z) on the far side points to +z in the world
const q = F.quatToWorld(-1, { x: 0, y: 0, z: 0, w: 1 });
const fw = F.qmul(F.qmul(q, { x: 0, y: 0, z: -1, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
check('far racket forward points at the near side', near(fw.z, 1, 1e-9) && near(fw.x, 0, 1e-9));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
