// Run: node games/arena/test/rules.test.js
'use strict';
const assert = require('assert');
const R = require('../rules.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const tests = {
  fourOriginalWeapons() {
    assert.deepStrictEqual(Object.keys(R.WEAPONS).sort(), ['breaker', 'longline', 'skiff', 'tern']);
    for (const w of Object.values(R.WEAPONS)) {
      assert.ok(w.damage > 0 && w.mag > 0 && w.reload > 0 && w.headMult > 1, w.id);
      assert.ok(['sidearm', 'primary'].includes(w.slot), w.id);
    }
    assert.strictEqual(R.WEAPONS.tern.price, 0);
  },
  recoilPatternIsDeterministicAndClimbs() {
    const a = R.recoilOffset('breaker', 0), b = R.recoilOffset('breaker', 0);
    assert.deepStrictEqual(a, b);
    near(a.pitch, 0); near(a.yaw, 0);
    const p5 = R.recoilOffset('breaker', 5), p12 = R.recoilOffset('breaker', 12);
    assert.ok(p5.pitch > 1 && p12.pitch > p5.pitch, 'climbs upward');
    assert.ok(Math.abs(R.recoilOffset('breaker', 20).yaw) > 0.3, 'drifts sideways later in the spray');
    assert.ok(R.recoilOffset('skiff', 10).pitch < p12.pitch, 'smg kicks less than rifle');
  },
  spreadGrowsWithMovementAndAir() {
    const w = R.WEAPONS.breaker;
    const still = R.spreadFor(w, { speed: 0, airborne: false, crouched: false, shotsInBurst: 0 });
    const moving = R.spreadFor(w, { speed: 5, airborne: false, crouched: false, shotsInBurst: 0 });
    const air = R.spreadFor(w, { speed: 0, airborne: true, crouched: false, shotsInBurst: 0 });
    const crouch = R.spreadFor(w, { speed: 0, airborne: false, crouched: true, shotsInBurst: 0 });
    assert.ok(moving > still * 2);
    assert.ok(air > moving);
    assert.ok(crouch < still);
  },
  scopedPrecisionRifleIsAccurateUnscopedIsNot() {
    const w = R.WEAPONS.longline;
    const s = { speed: 0, airborne: false, crouched: false, shotsInBurst: 0 };
    assert.ok(R.spreadFor(w, Object.assign({ scoped: true }, s)) < R.spreadFor(w, s) / 5);
  },
  damageHeadshotAndFalloff() {
    const w = R.WEAPONS.breaker;
    const body = R.computeDamage(w, 'body', 10, 0);
    const head = R.computeDamage(w, 'head', 10, 0);
    near(head.health, Math.min(w.damage * w.headMult, 999));
    assert.ok(head.health > body.health * 3);
    const far = R.computeDamage(w, 'body', 60, 0);
    assert.ok(far.health < body.health, 'falls off with range');
    const leg = R.computeDamage(w, 'legs', 10, 0);
    assert.ok(leg.health < body.health);
  },
  armourAbsorbs() {
    const w = R.WEAPONS.skiff;
    const bare = R.computeDamage(w, 'body', 5, 0);
    const armoured = R.computeDamage(w, 'body', 5, 100);
    assert.ok(armoured.health < bare.health);
    assert.ok(armoured.armor > 0);
    const thin = R.computeDamage(w, 'body', 5, 1);
    assert.ok(thin.armor <= 1, 'cannot strip more armour than there is');
  },
  rifleHeadshotKillsThroughArmour() {
    const w = R.WEAPONS.breaker;
    assert.ok(R.computeDamage(w, 'head', 20, 100).health >= 100);
    assert.ok(R.computeDamage(R.WEAPONS.longline, 'body', 30, 100).health >= 85);
  },
  economy() {
    assert.strictEqual(R.clampMoney(20000), R.ECONOMY.max);
    assert.strictEqual(R.killReward('skiff'), R.WEAPONS.skiff.killReward);
    assert.strictEqual(R.roundReward(true, 0), R.ECONOMY.win);
    assert.ok(R.roundReward(false, 3) > R.roundReward(false, 0), 'loss bonus grows with streak');
    assert.ok(R.roundReward(false, 99) <= R.ECONOMY.lossMax);
  },
  timeoutWinner() {
    assert.strictEqual(R.timeoutWinner({ alive: 3, hp: 100 }, { alive: 2, hp: 300 }), 0);
    assert.strictEqual(R.timeoutWinner({ alive: 2, hp: 100 }, { alive: 2, hp: 150 }), 1);
    assert.strictEqual(R.timeoutWinner({ alive: 2, hp: 150 }, { alive: 2, hp: 150 }), 0, 'exact tie goes to team 0 (defenders hold)');
  },
  firingCadence() {
    near(R.fireInterval(R.WEAPONS.skiff), 60 / R.WEAPONS.skiff.rpm);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
