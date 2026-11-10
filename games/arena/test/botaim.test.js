// Run: node games/arena/test/botaim.test.js
'use strict';
const assert = require('assert');
const B = require('../botaim.js');
const R = require('../rules.js');

/** Seeded random numbers, so the measured curves are the same on every run. */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/**
 * One bot shooting at one player who stands (or strafes) at `dist` metres, as actors.js does it:
 * react, settle the aim, fire inside the tolerance, kick per shot, pause between bursts. Returns
 * seconds until the player (100 hp, no armour) is dead, capped at 10.
 */
function duel(name, o, rnd) {
  const d = B.get(name), w = R.WEAPONS[o.weapon || 'tern'], dt = 1 / 120;
  let t = B.reactionTime(d, { dist: o.dist, angle: o.angle || 0, warned: false }, rnd);
  let err = B.initialError(d, { dist: o.dist }, rnd), errAng = rnd() * Math.PI * 2;
  let hp = 100, next = t, burst = 0, shots = 0, pauseUntil = 0, lastShot = -9;
  const angVel = o.strafe ? o.strafe / o.dist / B.DEG : 0;
  // the error has been settling while it reacted
  for (let s = 0; s < t; s += dt) err = B.errorStep(err, d, dt, { angVel });
  for (; t < 10 && hp > 0; t += dt) {
    err = B.errorStep(err, d, dt, { angVel });
    errAng += dt * (0.5 + 2 * rnd());
    if (t - lastShot > 0.3) shots = Math.max(0, shots - dt * 14);
    if (t < next || t < pauseUntil || err * B.DEG > B.fireTolerance(d, o.dist)) continue;
    if (burst <= 0) burst = w.auto ? Math.round(d.burst[0] + rnd() * (d.burst[1] - d.burst[0])) : 1;
    // where the round goes: aim error plus the weapon's cone
    const spread = R.spreadFor(w, { speed: 0, shotsInBurst: shots }) * d.spreadMult * B.DEG;
    const r = Math.tan(spread * rnd()), phi = rnd() * Math.PI * 2;
    const lat = o.dist * (Math.tan(err * B.DEG * Math.cos(errAng)) + r * Math.cos(phi));
    const ver = o.dist * (Math.tan(err * B.DEG * Math.sin(errAng)) * 0.6 + r * Math.sin(phi));
    let zone = null;
    if (Math.abs(lat) < 0.27 && ver > -1.1 && ver < 0.35) zone = ver < -0.27 ? 'legs' : 'body';
    if (Math.abs(lat) < 0.17 && ver > 0.38 && ver < 0.66) zone = 'head';
    if (zone) hp -= R.computeDamage(w, zone, o.dist, 0).health * d.dmgMult;
    err += d.kick * R.recoilKick(w.id, Math.floor(shots)).pitch; shots++; lastShot = t; next = t + R.fireInterval(w); burst--;
    if (burst <= 0) pauseUntil = t + (w.auto ? d.pause[0] + rnd() * (d.pause[1] - d.pause[0]) : 0.15 + rnd() * 0.3);
  }
  return Math.min(10, t);
}
function medianTTK(name, o, n = 400) {
  const rnd = rng(1234), v = [];
  for (let i = 0; i < n; i++) v.push(duel(name, o, rnd));
  v.sort((a, b) => a - b);
  return v[Math.floor(n / 2)];
}
function medianReaction(name, o) {
  const rnd = rng(99), v = [];
  for (let i = 0; i < 400; i++) v.push(B.reactionTime(B.get(name), o, rnd));
  v.sort((a, b) => a - b);
  return v[200];
}
function turnTime(name, rad) {
  const st = { yaw: 0, rate: 0 }, d = B.get(name);
  let t = 0;
  while (Math.abs(B.wrap(rad - st.yaw)) > 0.05 && t < 5) { B.turnStep(st, rad, 1 / 120, d, true); t += 1 / 120; }
  return t;
}

const tests = {
  threeLabelledLevelsEasiestFirst() {
    assert.deepStrictEqual(B.ORDER, ['recruit', 'regular', 'veteran']);
    B.ORDER.forEach((n, i) => assert.strictEqual(B.DIFF[n].blurb, ['easy', 'fair', 'hard'][i]));
    assert.strictEqual(B.get('nonsense'), B.DIFF.recruit, 'unknown falls back to the easy one');
  },
  reactionTimesAreHuman() {
    const m = n => medianReaction(n, { dist: 15, angle: 0 });
    // a person reacts in roughly 0.25 s at best; a bot should never beat that, and Recruit is slow
    assert.ok(m('veteran') >= 0.38 && m('veteran') < 0.6, `veteran ${m('veteran')}`);
    assert.ok(m('regular') >= 0.55 && m('regular') < 0.85, `regular ${m('regular')}`);
    assert.ok(m('recruit') >= 0.85, `recruit ${m('recruit')}`);
    assert.ok(medianReaction('regular', { dist: 15, angle: 1.0 }) > m('regular') + 0.15, 'slower at the edge of view');
    assert.ok(medianReaction('regular', { dist: 50, angle: 0 }) > m('regular'), 'slower far away');
  },
  noInstantOneEighties() {
    const r = turnTime('recruit', Math.PI), g = turnTime('regular', Math.PI), v = turnTime('veteran', Math.PI);
    assert.ok(r > 1.2, `recruit 180 in ${r.toFixed(2)} s`);
    assert.ok(g > 0.8, `regular 180 in ${g.toFixed(2)} s`);
    assert.ok(v > 0.55, `veteran 180 in ${v.toFixed(2)} s`);
    assert.ok(r > g && g > v);
  },
  turningSettlesWithoutOvershoot() {
    const st = { yaw: 0, rate: 0 };
    let maxYaw = 0;
    for (let i = 0; i < 600; i++) { B.turnStep(st, 1, 1 / 120, B.DIFF.veteran, true); maxYaw = Math.max(maxYaw, st.yaw); }
    assert.ok(Math.abs(st.yaw - 1) < 1e-3 && maxYaw <= 1 + 1e-6);
  },
  aimNeverPerfectAndWorseOnAMovingTarget() {
    B.ORDER.forEach(n => {
      const d = B.get(n);
      let still = d.initErr, moving = d.initErr;
      for (let i = 0; i < 600; i++) { still = B.errorStep(still, d, 1 / 120, {}); moving = B.errorStep(moving, d, 1 / 120, { angVel: 15 }); }
      assert.ok(still >= d.errFloor - 1e-6, `${n} settles to its floor, not to zero`);
      assert.ok(moving > still + 0.5, `${n} lags a strafing target (${moving.toFixed(2)} vs ${still.toFixed(2)})`);
    });
  },
  aimRecoversAfterAKick() {
    const d = B.DIFF.regular;
    let e = d.errFloor + 5;
    for (let i = 0; i < 120; i++) e = B.errorStep(e, d, 1 / 120, {});
    assert.ok(e < d.errFloor + 5 * 0.3, 'most of the kick is gone after a second');
  },
  timeToKillCurves() {
    // a bot with the starting pistol against a player standing in the open, 15 m away
    const r = medianTTK('recruit', { dist: 15 }), g = medianTTK('regular', { dist: 15 }), v = medianTTK('veteran', { dist: 15 });
    console.log(`     TTK, Tern at 15 m, standing: recruit ${r.toFixed(2)} s, regular ${g.toFixed(2)} s, veteran ${v.toFixed(2)} s`);
    assert.ok(r > 3.0, 'recruit: plenty of time for a first-time phone player to answer');
    assert.ok(g > 1.8 && g < 4.0, 'regular: a fair fight');
    assert.ok(v > 1.0 && v < 2.2, 'veteran: hard, not instant');
    assert.ok(r > g && g > v);
  },
  movementAndRangeProtectThePlayer() {
    const still = medianTTK('regular', { dist: 15 }), strafe = medianTTK('regular', { dist: 15, strafe: 4 });
    const far = medianTTK('regular', { dist: 40, weapon: 'breaker' }), near = medianTTK('regular', { dist: 15, weapon: 'breaker' });
    console.log(`     regular: strafing ${strafe.toFixed(2)} s vs standing ${still.toFixed(2)} s; Breaker at 40 m ${far.toFixed(2)} s vs 15 m ${near.toFixed(2)} s`);
    assert.ok(strafe > still * 1.2, 'strafing makes them miss');
    assert.ok(far > near * 1.3, 'long range is not a free kill');
  },
  noticesOnlyWhatItCouldSee() {
    const d = B.DIFF.recruit;
    assert.ok(B.canNotice(d, { dist: 20, angle: 0.3 }));
    assert.ok(!B.canNotice(d, { dist: 20, angle: 1.4 }), 'not out of the corner of the eye');
    assert.ok(!B.canNotice(d, { dist: 60, angle: 0 }), 'not across the whole depot');
    assert.ok(B.canNotice(d, { dist: 2, angle: 3 }), 'someone touching them, yes');
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
