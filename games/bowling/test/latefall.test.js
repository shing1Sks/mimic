// A pin that is still at the count but falls before the sweep (physics.js decided() can call a
// pin "standing" while it has only just begun to tip). Real rule: pins that fall before the sweep
// count for that ball, so the second ball never faces an empty rack.
// Run: node games/bowling/test/latefall.test.js
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'physics.js'));
const S = require(path.join(__dirname, '..', 'scoring.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

// the 7-pin left after a 9-count, just starting to tip
const sim = P.createSim({});
const s7 = P.pinSpot(7);
P.rack(sim, [{ n: 7, x: s7.x, z: s7.z }]);
const pin = sim.pins[0], th = 0.18;
pin.q = [Math.sin(th / 2), 0, 0, Math.cos(th / 2)]; pin.asleep = false; pin.still = 0;
const standingBefore = 10;
P.advance(sim, 0.05, 90);
check('at the count the deck reads decided with the 7 standing', P.decided(sim) && P.standing(pin));
let rolls = [standingBefore - sim.pins.filter(P.standing).length];
check('the first ball is counted as 9', rolls[0] === 9, rolls);
for (let t = 0; t < 1.5; t += 0.05) P.advance(sim, 0.05, 90);
check('the 7 falls before the sweep', !P.standing(pin));

// the game's hand-off at the sweep: what stands now is what the second ball faces
const downNow = standingBefore - sim.pins.filter(P.standing).length;
const keep = sim.pins.filter(P.standing);
check('reproduction: without a recount the second ball would face an empty rack', keep.length === 0 && !S.next(rolls).fresh);
const rc = S.sweepCount(rolls, downNow);
check('the recount gives the late pin to the first ball (a strike)', rc.changed && rc.rolls[0] === 10, rc);
check('after the recount the frame is over, no empty-rack second ball', S.next(rc.rolls).fresh && S.marks(rc.rolls)[0][1] === 'X');

// a recount never lowers a count or touches an unchanged one
check('no change when nothing more fell', !S.sweepCount([7], 7).changed && S.sweepCount([7], 7).rolls[0] === 7);
check('never lowers a count', S.sweepCount([7], 5).rolls[0] === 7);
check('late pin on the second ball makes the spare', (r => r[1] === 3 && S.marks(r)[0][1] === '/')(S.sweepCount([7, 2], 3).rolls));
check('tenth frame bonus ball corrected', (r => r.length === 21 && r[20] === 10)(S.sweepCount(Array(18).fill(0).concat([10, 10, 9]), 10).rolls));
check('no rolls: nothing to correct', !S.sweepCount([], 4).changed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
