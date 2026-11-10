// End to end without a browser: a synthetic human swing (tools/swing.js) -> the release
// (kin.js, the same calls game.js makes) -> the lane and pins (physics.js).
// Run: node games/bowling/test/bowl.test.js
'use strict';
const path = require('path');
const K = require(path.join(__dirname, '..', 'kin.js'));
const P = require(path.join(__dirname, '..', 'physics.js'));
const SW = require(path.join(__dirname, '..', 'tools', 'swing.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const SHOULDER = { x: 0.17, y: 0.92, z: 0.42 };   // game.js BODY, stance at the centre
function bowl(o, rack) {
  const ss = SW.gen(o), tr = K.createTrack();
  ss.forEach(s => K.pushSample(tr, s));
  const rel = tr.events.find(e => e.kind === 'release');
  const f = K.fitRelease(tr.samples, rel.t, K.DEFAULT_Q0);
  const rb = K.releaseBall({ w: f.w, Rd: f.Rd, v: f.v, shoulder: SHOULDER });
  const sim = P.createSim();
  if (rack !== false) P.rack(sim);
  const b = P.launch(sim, { x: rb.pos.x, y: rb.pos.y, z: rb.pos.z, v: [rb.v.x, rb.v.y, rb.v.z], w: [rb.spin.x, rb.spin.y, rb.spin.z] });
  let t = 0, tPins = null, xPins = null, firstFloorZ = null;
  while (t < 14) {
    const ev = P.advance(sim, P.DT);
    for (const e of ev) if (e.kind === 'floor' && e.a === b && firstFloorZ === null) firstFloorZ = b.x[2];
    t += P.DT;
    if (tPins === null && b.x[2] < P.LANE.HEAD_Z + 0.3) { tPins = t; xPins = b.x[0]; }
    if (b.gone === 'back') break;
    if (t > 3 && (b.gone || b.asleep) && P.settled(sim)) break;
  }
  return { rb, b, sim, tPins, xPins, firstFloorZ, down: sim.pins.filter(p => !P.standing(p)).length };
}
const deg = d => d * Math.PI / 180;

// a firm, straight-ish swing aimed a hair left (from board 14 to the 1-3 pocket)
let strikes = 0, carry = 0;
for (let s = 0; s < 10; s++) {
  const r = bowl({ peakW: 11, yaw: deg(0.32), noise: 0.25, seed: 300 + s });
  if (r.down === 10) strikes++;
  if (r.down >= 7) carry++;
}
check('a firm swing at the pocket carries most of the rack (>= 7 of 10 balls take 7+)', carry >= 7, carry);
check('...and a straight ball strikes only sometimes (1..6 of 10), as on a real lane', strikes >= 1 && strikes <= 6, strikes);
let hookStrikes = 0;
for (let s = 0; s < 10; s++) if (bowl({ peakW: 11, yaw: deg(-0.8), twist: 2.0, noise: 0.25, seed: 300 + s }).down === 10) hookStrikes++;
check('a hook into the pocket (better entry angle) strikes more often (>= 5 of 10)', hookStrikes >= 5 && hookStrikes > strikes, [hookStrikes, strikes]);

// lazy vs hard: time to the pins follows the swing
const lazy = bowl({ peakW: 4, seed: 5 }, false), hard = bowl({ peakW: 12, seed: 6 }, false);
check('a lazy swing (4 rad/s) crawls: > 5 s to the pins', lazy.tPins > 5, lazy.tPins);
check('a hard swing (12 rad/s) arrives in < 2.6 s', hard.tPins < 2.6, hard.tPins);

// a swing 3 degrees right from board 14 ends in the right gutter, nothing assisted
const off = bowl({ peakW: 9, yaw: deg(-3), seed: 7 });
check('a swing 3 deg right goes in the right gutter, no pins', off.b.gutter && off.down === 0, { x: off.b.x[0], down: off.down });

// let go at the top of the back swing: the ball lands behind the foul line
const early = bowl({ peakW: 8, relPhi: -1.0, seed: 8 }, false);
check('let go on the way down from the top: it lands on the approach, behind the foul line', early.firstFloorZ > 0.3, early.firstFloorZ);

// the wrist turn hooks it, and the hook is late (the oil), as on a real lane
const flat = bowl({ peakW: 8, twist: 0, seed: 9 }, false), hook = bowl({ peakW: 8, twist: 1.8, seed: 9 }, false);
check('a wrist turn through the release hooks the ball left by > 0.2 m at the pins', flat.xPins - hook.xPins > 0.2, [flat.xPins, hook.xPins]);

// travel time: a 27 km/h release (7.5 m/s, arm 0.70 m at 10.7 rad/s through the bottom) takes
// 2.0-2.6 s from the foul line to the head pin, and keeps most of its speed (it rolls off the
// fingers with forward roll, so little is lost becoming a rolling ball)
{
  const w = 7.5 / K.ARM.L, Rd = K.swingRot(0, 0.02, 0);
  const rb = K.releaseBall({ w: { x: w, y: 0, z: 0 }, Rd, shoulder: { x: 0.17, y: 0.92, z: 0.3 } });
  const sim = P.createSim(), b = P.launch(sim, { x: rb.pos.x, y: rb.pos.y, z: rb.pos.z, v: [rb.v.x, rb.v.y, rb.v.z], w: [rb.spin.x, rb.spin.y, rb.spin.z] });
  let t = 0, tLine = null, tHead = null, vHead = null;
  while (t < 6 && tHead === null) { P.step(sim); t += P.DT; if (tLine === null && b.x[2] < 0) tLine = t; if (b.x[2] < P.LANE.HEAD_Z + 0.17) { tHead = t - tLine; vHead = Math.hypot(...b.v); } }
  check('27 km/h: foul line to head pin in 2.0-2.6 s', tHead > 2.0 && tHead <= 2.6, tHead);
  check('...arriving with >= 80% of the release speed', vHead >= 0.8 * rb.speed, [vHead, rb.speed]);
  check('...with a real release rev rate (200-400 rpm)', rb.rpm > 200 && rb.rpm < 400, rb.rpm);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
