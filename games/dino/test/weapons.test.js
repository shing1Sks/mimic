// Run: node games/dino/test/weapons.test.js  -- weapon state: fire rate, ammo/reload, spread, damage, recoil
'use strict';
const assert = require('assert');
const W = require('../weapons.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const S = W.SPECS;
const HOLD = { pressed: false, held: true }, PRESS = { pressed: true, held: true }, NONE = { pressed: false, held: false };

/** Hold the trigger for `secs` at 60 fps and count the shots. */
function holdFor(id, secs, trig = HOLD) {
  const spec = S[id], s = W.createState(spec);
  let shots = 0;
  for (let t = 0; t < secs - 1e-9; t += 1 / 60) {
    W.tick(s, spec, 1 / 60, trig);
    while (W.tryFire(s, spec, trig) === 'fire') shots++;
    if (trig === PRESS) trig = HOLD; // one press only
  }
  return { s, shots };
}

const t = {
  threeWeaponsWithTheDesignedRoles() {
    assert.deepStrictEqual(W.ORDER, ['carbine', 'marksman', 'sidearm']);
    assert.strictEqual(S.carbine.magSize, 30); assert.ok(S.carbine.auto);
    assert.strictEqual(S.marksman.magSize, 5); assert.ok(!S.marksman.auto);
    assert.strictEqual(S.sidearm.magSize, 15); assert.ok(!S.sidearm.auto);
    near(S.marksman.zoom, 4); near(S.carbine.zoom, 1.35, 0.01);
  },
  fireIntervalFollowsRpm() {
    near(W.fireInterval(S.carbine), 0.1, 1e-9);
    near(W.fireInterval(S.marksman), 1.1, 1e-9);
  },
  fullAutoHoldsAt600Rpm() {
    const { shots } = holdFor('carbine', 1.0);
    assert.ok(shots >= 10 && shots <= 11, 'about 10 shots in one second, got ' + shots);
  },
  fullAutoDoesNotDriftAtUnevenFrameRates() {
    const spec = S.carbine, s = W.createState(spec);
    let shots = 0;
    for (let i = 0; i < 60; i++) { // 2 s at a wobbling ~30 fps
      W.tick(s, spec, i % 2 ? 0.025 : 0.0416, HOLD);
      while (W.tryFire(s, spec, HOLD) === 'fire') shots++;
    }
    assert.ok(shots >= 20 && shots <= 21, 'rate holds at uneven dt, got ' + shots);
  },
  semiAutoNeedsAPressPerShot() {
    const { shots } = holdFor('sidearm', 1.0, PRESS);
    assert.strictEqual(shots, 1, 'holding the trigger fires once');
  },
  semiAutoBuffersAPressJustBeforeItIsReady() {
    const spec = S.sidearm, s = W.createState(spec);
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'fire');
    W.tick(s, spec, W.fireInterval(spec) - 0.04, HOLD);
    assert.strictEqual(W.tryFire(s, spec, PRESS), null, 'too early');
    W.tick(s, spec, 0.05, NONE);
    assert.strictEqual(W.tryFire(s, spec, NONE), 'fire', 'the early press is honoured once ready');
  },
  boltPaceLimitsTheMarksman() {
    const spec = S.marksman, s = W.createState(spec);
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'fire');
    W.tick(s, spec, 0.5, NONE);
    assert.strictEqual(W.tryFire(s, spec, PRESS), null, 'bolt still cycling');
    W.tick(s, spec, 0.7, NONE);
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'fire');
    assert.strictEqual(s.mag, 3);
  },
  emptyMagDryClicksThenReloadsItself() {
    const spec = S.sidearm, s = W.createState(spec);
    s.mag = 0;
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'dry');
    assert.ok(!s.reloading, 'reload waits a beat after the click');
    W.tick(s, spec, 0.4, NONE);
    assert.ok(s.reloading, 'auto reload started');
    const before = s.reserve;
    W.tick(s, spec, spec.reloadTime + 0.01, NONE);
    assert.ok(!s.reloading);
    assert.strictEqual(s.mag, 15);
    assert.strictEqual(s.reserve, before - 15);
  },
  lastRoundStartsTheReloadWithoutAnotherPull() {
    // on the phone the player may never press reload: firing the last round reloads by itself
    const spec = S.carbine, s = W.createState(spec);
    s.mag = 1;
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'fire');
    assert.strictEqual(s.mag, 0);
    W.tick(s, spec, 0.3, NONE);
    assert.ok(s.reloading, 'reloading after the last shot');
  },
  anEmptyGunWithReserveReloadsEvenWithoutAPull() {
    const spec = S.carbine, s = W.createState(spec);
    s.mag = 0;
    W.tick(s, spec, 0.05, NONE); W.tick(s, spec, 0.4, NONE);
    assert.ok(s.reloading);
  },
  holdingAnEmptyAutoClicksOnce() {
    const spec = S.carbine, s = W.createState(spec);
    s.mag = 0; s.reserve = 0;
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'dry');
    W.tick(s, spec, 0.2, HOLD);
    assert.strictEqual(W.tryFire(s, spec, HOLD), null, 'no machine-gun clicking');
    W.tick(s, spec, 0.2, NONE);
    assert.strictEqual(W.tryFire(s, spec, PRESS), 'dry', 'a new pull clicks again');
  },
  reloadRefillsFromReserveOnly() {
    const spec = S.carbine, s = W.createState(spec);
    s.mag = 10; s.reserve = 12;
    assert.ok(W.startReload(s, spec));
    assert.strictEqual(W.tryFire(s, spec, PRESS), null, 'no firing while reloading');
    W.tick(s, spec, spec.reloadTime / 2, NONE);
    assert.ok(s.reloadT > 0.4 && s.reloadT < 0.6, 'reloadT is progress 0..1');
    W.tick(s, spec, spec.reloadTime, NONE);
    assert.strictEqual(s.mag, 22); assert.strictEqual(s.reserve, 0);
    assert.ok(!W.startReload(s, spec), 'nothing left to load');
  },
  noReloadWhenFull() {
    const spec = S.carbine, s = W.createState(spec);
    assert.ok(!W.startReload(s, spec));
  },
  cancelReloadKeepsAmmo() {
    const spec = S.carbine, s = W.createState(spec);
    s.mag = 3; const r = s.reserve;
    W.startReload(s, spec); W.tick(s, spec, 0.5, NONE);
    W.cancelReload(s);
    assert.ok(!s.reloading); assert.strictEqual(s.mag, 3); assert.strictEqual(s.reserve, r);
  },
  refillTopsUpTheReserve() {
    const spec = S.marksman, s = W.createState(spec);
    s.reserve = 1; s.mag = 2;
    W.refill(s, spec);
    assert.strictEqual(s.reserve, spec.reserve);
    assert.strictEqual(s.mag, 2, 'the mag is untouched');
  },
  spreadGrowsWhileFiringAndRecovers() {
    const spec = S.carbine;
    const { s } = holdFor('carbine', 0.8);
    assert.ok(s.spread > spec.spread.base * 3, 'bloom while spraying');
    assert.ok(s.spread <= spec.spread.max + 1e-9);
    for (let i = 0; i < 120; i++) W.tick(s, spec, 1 / 60, NONE);
    near(s.spread, spec.spread.base);
  },
  aimingTightensSpread() {
    const spec = S.marksman;
    const hip = W.effectiveSpread(spec, spec.spread.base, {});
    const scoped = W.effectiveSpread(spec, spec.spread.base, { ads: true });
    assert.ok(scoped < hip * 0.1, 'the scope is precise');
    assert.ok(W.effectiveSpread(S.carbine, S.carbine.spread.base, { ads: true }) < W.effectiveSpread(S.carbine, S.carbine.spread.base, {}));
    assert.ok(W.effectiveSpread(S.carbine, 0.01, { dodging: true }) > 0.01, 'dodging throws the aim');
  },
  damageFallsOffWithDistance() {
    for (const id of W.ORDER) {
      const spec = S[id];
      near(W.damageAt(spec, 1), spec.damage);
      near(W.damageAt(spec, 1000), spec.damage * spec.falloff.minFrac);
      const mid = W.damageAt(spec, (spec.falloff.near + spec.falloff.far) / 2);
      assert.ok(mid < spec.damage && mid > spec.damage * spec.falloff.minFrac);
    }
    assert.ok(W.damageAt(S.marksman, 200) > W.damageAt(S.carbine, 200) * 3, 'the rifle carries');
  },
  recoilKicksUpAndWandersSideways() {
    const spec = S.carbine;
    const k0 = W.recoil(spec, 0, 0.5), k9 = W.recoil(spec, 9, 0.5);
    assert.ok(k0.pitch > 0, 'view kicks up');
    assert.ok(k9.pitch > k0.pitch, 'sustained fire climbs harder');
    const yaws = [0, 1, 2, 3, 4, 5, 6, 7].map(i => W.recoil(spec, i, 0.5).yaw);
    assert.ok(yaws.some(y => y > 0) && yaws.some(y => y < 0), 'horizontal drift goes both ways');
    assert.ok(W.recoil(S.marksman, 0, 0.5).pitch > k0.pitch * 2, 'the rifle kicks hardest');
    assert.ok(W.recoil(spec, 0, 0.5, { ads: true }).pitch < k0.pitch, 'aiming steadies the kick');
  },
  spreadDirectionStaysInsideTheCone() {
    const dir = { x: 0, y: 0, z: -1 };
    for (let i = 0; i < 200; i++) {
      const d = W.spreadDir(dir, 0.02, Math.random(), Math.random());
      const len = Math.hypot(d.x, d.y, d.z);
      near(len, 1, 1e-9);
      assert.ok(Math.acos(-d.z) <= 0.02 + 1e-9);
    }
    const same = W.spreadDir({ x: 1, y: 0, z: 0 }, 0, 0.3, 0.7);
    near(same.x, 1);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(t)) {
  try { fn(); console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
