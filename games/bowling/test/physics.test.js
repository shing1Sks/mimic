// Pin physics sanity: racks stand still, balls roll straight or hook, pins scatter and fall,
// gutters swallow balls, pockets strike. Run: node games/bowling/test/physics.test.js
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'physics.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
// repeatable randomness for the pin-spot play
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function jitterRack(sim, j) {
  P.rack(sim, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => { const s = P.pinSpot(n); return { n, x: s.x + (rnd() - 0.5) * j, z: s.z + (rnd() - 0.5) * j }; }));
}
// a ball already on the lane: some forward roll, side roll for the hook (spin 1 = full hook)
const ROLL = 0.45, SIDE = 0.2;
function roll(sim, x, speed, spin, angleDeg) {
  const r = { x, z: -0.25 };
  const a = (angleDeg || 0) * Math.PI / 180, R = P.BALL.R;
  const rollW = ROLL * speed / R, side = (spin || 0) * SIDE * speed / R;
  r.v = [Math.sin(a) * speed, 0, -Math.cos(a) * speed];
  r.w = [-rollW * Math.cos(a) - side * Math.sin(a), 0, -rollW * Math.sin(a) + side * Math.cos(a)];
  return P.launch(sim, r);
}
function run(sim, maxT) {
  let t = 0, atPins = null;
  while (t < (maxT || 8)) {
    P.step(sim); t += P.DT;
    const b = sim.ball;
    if (b && atPins === null && b.x[2] < P.LANE.HEAD_Z + 0.2) atPins = b.x[0];
    if (t > 2 && P.settled(sim) && (!b || b.gone || b.asleep)) break;
  }
  return { t, atPins, down: sim.pins.filter(p => !P.standing(p)).length, up: sim.pins.filter(p => P.standing(p)).map(p => p.n) };
}

// --- mass properties
check('pin centre of mass ~0.146 m up (regulation 5.7-5.9 in)', P.PIN.COM > 0.135 && P.PIN.COM < 0.155, P.PIN.COM);
check('pin is much easier to spin about its axis than to tip', P.PIN.IY < P.PIN.IX / 4, [P.PIN.IX, P.PIN.IY]);

// --- a rack left alone stands still, even when awake
let sim = P.createSim(); P.rack(sim);
for (const p of sim.pins) p.asleep = false;
for (let i = 0; i < 480 * 3; i++) P.step(sim);
const drift = Math.max(...sim.pins.map(p => Math.hypot(p.x[0] - p.home.x, p.x[2] - p.home.z)));
check('awake rack stays standing for 3 s', sim.pins.every(P.standing));
check('awake rack does not creep (< 2 mm)', drift < 0.002, drift);
check('awake rack falls asleep', sim.pins.every(p => p.asleep));

// --- a pin tipped past its balance point falls; one barely nudged rocks back
sim = P.createSim(); P.rack(sim, [1]);
let p = sim.pins[0]; p.asleep = false; p.w = [0, 0, -4];
for (let i = 0; i < 480 * 2; i++) P.step(sim);
check('a pin given a real shove falls over', !P.standing(p));
sim = P.createSim(); P.rack(sim, [1]);
p = sim.pins[0]; p.asleep = false; p.w = [0, 0, -0.6];
for (let i = 0; i < 480 * 2; i++) P.step(sim);
check('a pin barely nudged wobbles and stays up', P.standing(p));

// --- the ball on the lane
sim = P.createSim();
let b = roll(sim, 0, 8, 0);
let r = run(sim, 4);
check('straight ball with no spin stays on its line (< 1 cm)', Math.abs(r.atPins) < 0.01, r.atPins);
check('ball loses some speed to friction but not too much', (() => { const s = P.createSim(); const bb = roll(s, 0, 8, 0); let t = 0; while (bb.x[2] > -18) { P.step(s); t += P.DT; } const v = Math.hypot(...bb.v); return v > 6 && v < 7.8; })());
const hook = (spin, speed) => { const s = P.createSim(); roll(s, 0, speed || 7.5, spin); return run(s, 4).atPins; };
const h5 = hook(0.5), h1 = hook(1), hm = hook(-1);
check('side roll hooks left (spin > 0)', h5 < -0.15 && h1 < h5, [h5, h1]);
check('opposite side roll hooks right', hm > 0.3, hm);
check('full hook is big (> 0.3 m, late) but stays on the lane from the right edge (< 0.75 m)', Math.abs(h1) > 0.3 && Math.abs(h1) < 0.75, h1);
check('slower balls hook more (more time on the dry back end)', Math.abs(hook(0.6, 6)) > Math.abs(hook(0.6, 9)));
// the hook is a late break: little movement in the oil, most of it on the dry back end
{ const s = P.createSim(); const bb = roll(s, 0, 7.5, 1); let x10 = null; while (bb.x[2] > P.LANE.HEAD_Z) { P.step(s); if (x10 === null && bb.x[2] < -10) x10 = bb.x[0]; }
  check('hook bites late: < 30% of the move happens in the first 10 m', Math.abs(x10) < 0.3 * Math.abs(bb.x[0]), [x10, bb.x[0]]); }

// --- gutters
sim = P.createSim(); P.rack(sim);
roll(sim, 0.45, 8, 0, 1.2);
r = run(sim, 5);
check('a ball angled off the edge drops into the gutter', sim.ball.gutter, sim.ball.x);
check('a gutter ball knocks nothing down', r.down === 0, r);

// --- pin action
sim = P.createSim(); P.rack(sim);
roll(sim, 0.06, 8, 0);
r = run(sim, 8);
check('a straight ball into the pocket strikes', r.down === 10, r);
let strikes = 0, total = 0, scatter = 0;
for (let i = 0; i < 12; i++) {
  sim = P.createSim(); jitterRack(sim, 0.01);
  roll(sim, 0.05 + (rnd() - 0.5) * 0.08, 7 + rnd() * 2, 0);
  r = run(sim, 8); total += r.down; if (r.down === 10) strikes++;
  if (r.down >= 6) scatter++;
}
check('pocket-ish balls usually carry most of the rack', scatter >= 10, { scatter, total });
check('...and strike sometimes but not always', strikes >= 3 && strikes <= 11, strikes);
sim = P.createSim(); P.rack(sim);
roll(sim, 0.32, 8, 0);
r = run(sim, 8);
check('a light hit on the right side leaves pins standing', r.down > 0 && r.down < 10, r);
sim = P.createSim(); P.rack(sim, [10]);
roll(sim, 0.457, 7, 0);
r = run(sim, 8);
check('ball straight at the 10 pin converts it', r.down === 1, r);
// pins knock each other: a pin flung into a neighbour takes it down
sim = P.createSim(); P.rack(sim, [2, 4]);
const p2 = sim.pins[0]; p2.asleep = false; p2.v = [-1.2, 0, -2.0];
r = run(sim, 4);
check('a flying pin knocks over the pin behind it', r.down === 2, r);
// nothing ever leaves through the floor or flies off forever
sim = P.createSim(); P.rack(sim); roll(sim, 0, 10.5, 0);
run(sim, 8);
check('after a fast hit every pin is on the deck, in a gutter or in the pit', sim.pins.every(q => q.gone === 'pit' || (q.x[1] > -0.2 && Math.abs(q.x[0]) < 0.8 && q.x[2] > -20.4)), sim.pins.map(q => q.x.map(v => +v.toFixed(2))));
// --- the approach: a ball dropped behind the foul line lands there and stays out of the gutters
sim = P.createSim();
let dropped = P.launch(sim, { x: 0.6, y: 0.5, z: 1.2, v: [0, -0.5, 0.4], w: [0, 0, 0] });
for (let i = 0; i < 480 * 2; i++) P.step(sim);
check('a ball dropped on the approach rests on its floor (y = R), even beside the lane', Math.abs(dropped.x[1] - P.BALL.R) < 0.004 && !dropped.gutter, dropped.x);
check('...and it rolls slowly backward, not through the floor', dropped.x[2] > 1.2 && dropped.x[2] < 3, dropped.x);
sim = P.createSim();
dropped = P.launch(sim, { x: 0, y: 0.3, z: 0.5, v: [0, 0, 3], w: [0, 0, 0] });
for (let i = 0; i < 480 * 3; i++) P.step(sim);
check('a ball rolling back off the end of the approach leaves play ("back")', dropped.gone === 'back', dropped.x);
sim = P.createSim();
const lob = P.launch(sim, { x: 0, y: 0.6, z: 0.4, v: [0, 2.5, -5], w: [0, 0, 0] });
let landZ = null, thud = 0;
for (let i = 0; i < 480 * 2; i++) { const ev = P.advance(sim, P.DT); for (const e of ev) if (e.kind === 'floor' && e.a === lob && landZ === null) { landZ = lob.x[2]; thud = e.speed; } }
check('a lofted ball lands well down the lane with a hard thud', landZ < -2 && thud > 2, { landZ, thud });

// --- momentum and mass: one ball-pin hit, head on
function headOn(mass) {
  const s = P.createSim(); P.rack(s, [1]);
  const R = P.BALL.R, v0 = 7.5;
  const b = P.launch(s, { x: 0, z: P.LANE.HEAD_Z + 1.2, v: [0, 0, -v0], w: [-v0 / R, 0, 0], mass });   // rolling
  const pin = s.pins[0];
  let before = null, t = 0;
  while (t < 1.5) {
    if (!before && Math.abs(b.x[2] - pin.x[2]) < 0.2) before = { vb: b.v.slice(), wb: b.w.slice() };
    P.step(s); t += P.DT;
    if (before && !before.t && pin.touched) before.t = t;
    if (before && before.t && t > before.t + 0.025) break;
  }
  const pb = b.m * before.vb[2], pa = b.m * b.v[2] + pin.m * pin.v[2];
  const ke = (m, v) => 0.5 * m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return { loss: 1 - Math.hypot(...b.v) / Math.hypot(...before.vb), dp: Math.abs(pa - pb) / Math.abs(pb), keB: ke(b.m, before.vb), keA: ke(b.m, b.v) + ke(pin.m, pin.v), pinV: Math.hypot(...pin.v), ballV: Math.hypot(...b.v) };
}
{
  const h = headOn(), h16 = headOn(P.BALL.MASS_16LB);
  // a free point pin would take (1 + e) M / (m + M) = 30% of a 6.8 kg ball's speed head on; the
  // real pin also spins and tips (and is struck below its centre of mass), so it takes less
  check('head-on ball-pin hit: ball loses 15-32% of its speed (6.8 kg ball, 1.53 kg pin)', h.loss > 0.15 && h.loss < 0.32, h);
  check('...along-lane momentum is conserved through the hit (< 5%)', h.dp < 0.05, h.dp);
  check('...no energy is created (KE after <= before)', h.keA <= h.keB * 1.001, [h.keA, h.keB]);
  check('...the pin flies off faster than the ball goes on', h.pinV > h.ballV, [h.pinV, h.ballV]);
  check('a 16 lb ball loses less speed in the same hit', h16.loss < h.loss, [h16.loss, h.loss]);
}
// --- the ball ploughs through the rack
{
  const s = P.createSim(); P.rack(s);
  const b = roll(s, 0.06, 6.3, 0);
  let vIn = null, vOut = null, t = 0;
  while (t < 5 && !b.gone) { P.step(s); t += P.DT; if (vIn === null && b.hitPins) vIn = 6.3; if (vOut === null && b.x[2] < P.LANE.PIT_Z) vOut = Math.hypot(b.v[0], b.v[2]); }
  check('a pocket hit at 6.3 m/s: the ball keeps >= 35% of its speed through the rack and goes on into the pit', vOut > 0.35 * 6.3 && vOut < 0.9 * 6.3, vOut);
}
// --- skid, hook, roll: the ball skids through the oil, hooks on the dry back end, then rolls
// straight on (it carries its momentum: no drift once it rolls)
{
  const s = P.createSim();
  const R = P.BALL.R, v0 = 7.2;
  const b = P.launch(s, { x: 0.3, z: -0.3, v: [0, 0, -v0], w: [-0.35 * v0 / R, 0, 0.17 * v0 / R] });
  const slip = () => Math.hypot(b.v[0] + b.w[2] * R, b.v[2] - b.w[0] * R);
  let s10 = null, rollZ = null, hRoll = null, hEnd = null;
  while (b.x[2] > P.LANE.HEAD_Z + 0.4) {
    P.step(s);
    if (s10 === null && b.x[2] < -10) s10 = slip();
    if (rollZ === null && slip() < 0.05) { rollZ = b.x[2]; hRoll = Math.atan2(b.v[0], -b.v[2]); }
  }
  hEnd = Math.atan2(b.v[0], -b.v[2]);
  check('still skidding at 10 m (in the oil)', s10 > 1, s10);
  check('rolls before the pins, on the dry back end', rollZ !== null && rollZ < P.LANE.OIL_END && rollZ > P.LANE.HEAD_Z + 0.4, rollZ);
  check('once rolling it keeps its line (< 0.5 deg change to the pins)', Math.abs(hEnd - hRoll) * 180 / Math.PI < 0.5, [hRoll, hEnd]);
}

// --- bounces: a urethane / reactive ball on a lane rebounds at e ~0.2-0.4, pins hop off the deck,
// and nothing ever gains energy
function energy(s) {
  let e = 0;
  for (const b of [s.ball, ...s.pins]) {
    if (!b) continue;
    const v = b.v, q = b.q, wb = P.qrot([-q[0], -q[1], -q[2], q[3]], b.w[0], b.w[1], b.w[2], [0, 0, 0]);
    const I = [1 / b.iI[0], 1 / b.iI[b.isSphere ? 0 : 1], 1 / b.iI[b.isSphere ? 0 : 2]];
    e += 0.5 * b.m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + b.m * 9.81 * b.x[1] + 0.5 * (I[0] * wb[0] * wb[0] + I[1] * wb[1] * wb[1] + I[2] * wb[2] * wb[2]);
  }
  return e;
}
/**
 * Step a sim. apex: height of each rebound after the first landing (the ball's bottom above the
 * floor); apexE: the sim's energy at each of those apexes; over: how far the energy ever got
 * above its starting value (J).
 */
function bounces(s, b, maxT, until) {
  const apex = [], apexE = [], impacts = [];
  const e0 = energy(s);
  let t = 0, up = 0, upE = 0, over = 0, landed = false;
  while (t < maxT) {
    const ev = P.advance(s, P.DT); t += P.DT;
    for (const e of ev) if (e.a === b && e.kind === 'floor') { impacts.push({ z: b.x[2], speed: e.speed }); landed = true; }
    const e = energy(s); over = Math.max(over, e - e0);
    const h = b.x[1] - P.BALL.R - P.floorY(b.x[0], b.x[2]);
    if (h > 0.002 && landed) { if (h > up) { up = h; upE = e; } } else if (up > 0) { apex.push(up); apexE.push(upE); up = 0; }
    if (until && until(b)) break;
  }
  return { apex, apexE, impacts, over };
}
const falling = a => a.every((x, i) => i === 0 || x < a[i - 1]);
{
  // dropped straight down on the lane from 0.3 m: rebound height / drop height = e^2
  let s = P.createSim(); let b = P.launch(s, { x: 0, y: P.BALL.R + 0.3, z: -3, v: [0, 0, 0], w: [0, 0, 0] });
  let r = bounces(s, b, 2);
  const ratio = r.apex[0] / 0.3;
  check('a ball dropped 0.3 m on the lane rebounds 4-16% of the drop (restitution 0.2-0.4)', ratio > 0.04 && ratio < 0.16, ratio);
  check('...each rebound lower than the last, then it rests', r.apex.length >= 2 && falling(r.apex) && Math.abs(b.x[1] - P.BALL.R) < 0.002, r.apex);
  check('...and never gains energy: below its start throughout, less at every apex', r.over < 1e-3 && falling(r.apexE), [r.over, r.apexE]);
  // lofted 45 deg at 20 km/h from the hand: lands on the lane, bounces at least once, then rolls on
  s = P.createSim(); P.rack(s);
  const v = 20 / 3.6, a = Math.PI / 4;
  b = P.launch(s, { x: 0.17, y: 0.2, z: 0.25, v: [0, v * Math.sin(a), -v * Math.cos(a)], w: [-0.6 * v * Math.cos(a) / P.BALL.R, 0, 0] });
  const e0 = energy(s);
  r = bounces(s, b, 4, bb => bb.x[2] < -12);
  check('a 45 deg loft at 20 km/h lands 2-5 m down the lane', r.impacts.length && r.impacts[0].z < -2 && r.impacts[0].z > -5, r.impacts[0]);
  check('...bounces at least once (> 2 cm) and at most three times, each lower', r.apex.length >= 1 && r.apex.length <= 3 && r.apex[0] > 0.02 && falling(r.apex), r.apex);
  check('...then rolls on down the lane on the floor', Math.abs(b.x[1] - P.BALL.R) < 0.002 && b.v[2] < -2, { y: b.x[1], v: b.v });
  check('...energy never rises along the way', r.over < 1e-3 && falling(r.apexE) && energy(s) < e0, [r.over, r.apexE, energy(s), e0]);
  // a normal release just above the lane sets down with at most a little hop
  s = P.createSim(); b = P.launch(s, { x: 0.17, y: 0.22, z: 0.25, v: [0, -0.3, -7], w: [-0.6 * 7 / P.BALL.R, 0, 0] });
  r = bounces(s, b, 1.5);
  check('a normal release (ball 11 cm up) sets down: any hop after landing < 2 cm', r.apex.every(x => x < 0.02), r.apex);
  // dropped behind the foul line it bounces on the approach too
  s = P.createSim(); b = P.launch(s, { x: 0.2, y: P.BALL.R + 0.5, z: 0.6, v: [0, 0, 0.1], w: [0, 0, 0] });
  r = bounces(s, b, 2);
  check('a ball dropped 0.5 m on the approach bounces (2-8 cm) before it settles', r.apex[0] > 0.02 && r.apex[0] < 0.08 && b.x[2] > 0, r.apex);
}
{
  // a pin dropped on its side from 0.4 m (centre) hops back up: pin-deck restitution ~0.45
  const s = P.createSim(); P.rack(s, [1]);
  const p = s.pins[0]; p.asleep = false; p.x = [0, 0.4, P.LANE.HEAD_Z]; p.q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  let t = 0, prev = 0, top = 0; const tops = [];
  while (t < 1.5) { P.step(s); t += P.DT; if (p.v[1] > 0) top = Math.max(top, p.x[1]); if (p.v[1] <= 0 && prev > 0) tops.push(top), top = 0; prev = p.v[1]; }
  const rest = 0.058, ratio = (tops[0] - rest) / (0.4 - rest);
  check('a pin dropped on its side rebounds 10-35% of the drop (pin-deck e ~0.3-0.6)', ratio > 0.1 && ratio < 0.35, { tops, ratio });
}
{
  // a hard pocket hit: pins hop off the deck, the ball barely rides up, nothing gains energy
  const s = P.createSim(); P.rack(s);
  const b = roll(s, 0.06, 8.5, 0);
  const e0 = energy(s);
  let t = 0, over = 0, pinTop = 0, ballLift = 0;
  while (t < 4) {
    P.step(s); t += P.DT;
    over = Math.max(over, energy(s) - e0);
    for (const p of s.pins) if (!p.gone) pinTop = Math.max(pinTop, p.x[1]);
    if (b.hitPins && !b.gone) ballLift = Math.max(ballLift, b.x[1] - P.BALL.R);
  }
  check('in a hard crash pins fly / hop clear of the deck (a pin centre > 0.2 m up)', pinTop > 0.2, pinTop);
  check('...the ball rides up only a little on the hits (0.5-30 mm)', ballLift > 0.0005 && ballLift < 0.03, ballLift);
  check('...and the crash never has more energy than the ball brought in', over < 1e-3, over);
}
{
  // into the pit: it falls, hits the cushion, bounces back off it and comes to rest on the pit floor
  const s = P.createSim();
  const b = P.launch(s, { x: 0, z: P.LANE.HEAD_Z - 0.3, v: [0, 0, -6], w: [-6 / P.BALL.R, 0, 0] });
  let t = 0, back = 0, wall = 0;
  while (t < 4) { const ev = P.advance(s, P.DT); t += P.DT; for (const e of ev) if (e.a === b && e.kind === 'wall') wall = Math.max(wall, e.speed); back = Math.max(back, b.v[2]); }
  check('a ball into the pit hits the cushion and bounces back off it (0.5-2.5 m/s)', wall > 4 && back > 0.5 && back < 2.5, { wall, back });
  check('...and ends in the pit, out of play, resting on its floor', b.gone === 'pit' && b.asleep && Math.abs(b.x[1] - (P.LANE.PIT_Y + P.BALL.R)) < 0.01 && b.x[2] < P.LANE.PIT_Z, b.x);
}

// gutter bumpers (P.BUMPER, an option per game)
{
  const run = (bump, o) => {
    const sim = P.createSim({ bumpers: bump }); P.rack(sim);
    const b = P.launch(sim, { x: o.x, y: o.y, z: -0.3, v: o.v, w: o.w || [-Math.hypot(o.v[0], o.v[2]) / P.BALL.R, 0, 0] });
    let t = 0, first = null, maxX = 0, kePeak = 0, gain = false;
    const ke = () => 0.5 * b.m * (b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2) + 0.5 * (b.w[0] ** 2 + b.w[1] ** 2 + b.w[2] ** 2) / b.iI[0] + b.m * 9.81 * b.x[1];   // total: rolling + spin + height
    while (t < 9 && !b.gone) {
      const vx = b.v[0], k0 = ke();
      P.advance(sim, P.DT); t += P.DT;
      if (ke() > k0 + 1e-4 && b.x[2] > P.LANE.HEAD_Z + 1) gain = true;   // (pins can push it)
      maxX = Math.max(maxX, Math.abs(b.x[0]));
      if (!first && Math.abs(vx) > 0.05 && Math.sign(b.v[0]) !== Math.sign(vx)) first = { vin: vx, vout: b.v[0], z: b.x[2], y: b.x[1] };
    }
    return { b, sim, first, maxX, gain, down: sim.pins.filter(p => !P.standing(p)).length };
  };
  const ang = 5 * Math.PI / 180, sp = 7, v = [Math.sin(ang) * sp, 0, -Math.cos(ang) * sp];   // 5 deg right from the centre
  const off = run(false, { x: 0.2, v }), on = run(true, { x: 0.2, v });
  check('bumpers off: 5 deg right from board ~13 is a gutter ball', off.b.gutter && off.down === 0, [off.b.gutter, off.down]);
  check('bumpers on: the ball comes off the rail and stays on the lane (never past the lane edge)', !on.b.gutter && on.maxX <= P.LANE.HALF - P.BALL.R + 0.002 && on.first, [on.maxX, on.first]);
  check('...rebounding with ~0.45 of its sideways speed (0.35-0.55), rolling (centre at the ball radius)', on.first && -on.first.vout / on.first.vin > 0.35 && -on.first.vout / on.first.vin < 0.55 && Math.abs(on.first.y - P.BALL.R) < 0.005, on.first);
  check('...never gaining energy off the rail, and it reaches the pins', !on.gain && on.down > 0, [on.gain, on.down]);
  // a lofted ball landing on a rail's top bounces off it, never through it
  const lob = run(true, { x: P.LANE.HALF + 0.03, y: 0.45, v: [0, 0.5, -5], w: [0, 0, 0] });
  check('a lob coming down onto a rail top does not pass through it into the gutter', !lob.b.gutter, [lob.b.x, lob.b.gutter]);
  // pins knocked sideways bounce off the rails too
  const crash = run(true, { x: 0.06, v: [0, 0, -8] });
  check('pins stay inside the rails with bumpers up (no pin centre past the lane edge on the deck)', crash.sim.pins.every(p => p.gone || Math.abs(p.x[0]) < P.LANE.HALF + 0.01 || p.x[2] < P.BUMPER.Z1), crash.sim.pins.map(p => +p.x[0].toFixed(2)));
}

// performance: a full crash simulates far faster than real time
const t0 = Date.now();
sim = P.createSim(); P.rack(sim); roll(sim, 0.06, 8, 0);
for (let i = 0; i < 480 * 4; i++) P.step(sim);
const ms = Date.now() - t0;
check('4 s of crash simulates in < 400 ms (Node)', ms < 400, ms);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
