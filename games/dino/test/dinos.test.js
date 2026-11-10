// Run: node games/dino/test/dinos.test.js  -- dinosaur zones, AI states, packs, telegraphs, charges
'use strict';
const assert = require('assert');
const L = require('../dino-logic.js');
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const run = (b, s, secs, dt) => { const acts = []; dt = dt || 0.05; for (let t = 0; t < secs - 1e-9; t += dt) acts.push(...L.step(b, s, dt, () => 0.5)); return acts; };
const types = a => a.map(x => x.type);

const t = {
  // ------------------------------------------------ zones
  zoneMultipliersFollowTheDesignDoc() {
    assert.strictEqual(L.zoneMultiplier('raptor', 'head'), 3);
    assert.strictEqual(L.zoneMultiplier('dilo', 'head'), 3);
    assert.strictEqual(L.zoneMultiplier('trike', 'armor'), 0.3);
    assert.strictEqual(L.zoneMultiplier('trike', 'eye'), 4);
    assert.strictEqual(L.zoneMultiplier('trike', 'flank'), 1.5);
    assert.strictEqual(L.zoneMultiplier('rex', 'eye'), 2.5, 'tuned down 2026-11-09: carbine eye shots ended the boss in 30 s');
    assert.strictEqual(L.zoneMultiplier('raptor', 'body'), 1);
    assert.strictEqual(L.zoneMultiplier('nope', 'head'), 1);
  },
  rexMouthIsOnlySoftWhileRoaring() {
    assert.strictEqual(L.zoneMultiplier('rex', 'mouth', { roaring: true }), 3);
    assert.ok(L.zoneMultiplier('rex', 'mouth', { roaring: false }) < 3);
    assert.strictEqual(L.classifyZone('rex', 'mouth', null, { roaring: true }), 'mouth');
    assert.strictEqual(L.classifyZone('rex', 'mouth', null, { roaring: false }), 'head');
  },
  trikeFrontIsArmourSidesAreFlank() {
    assert.strictEqual(L.classifyZone('trike', 'head', { x: 0, y: 0, z: 1 }), 'armor');
    assert.strictEqual(L.classifyZone('trike', 'eye', { x: 1, y: 0, z: 0 }), 'eye');
    assert.strictEqual(L.classifyZone('trike', 'body', { x: 0.9, y: 0.1, z: 0.1 }), 'flank');
    assert.strictEqual(L.classifyZone('trike', 'body', { x: 0, y: 0.2, z: 0.95 }), 'armor');
    assert.strictEqual(L.classifyZone('trike', 'body', { x: 0, y: 1, z: 0 }), 'body');
  },
  smallDinoEyesCountAsHead() {
    assert.strictEqual(L.classifyZone('raptor', 'eye'), 'head');
    assert.strictEqual(L.classifyZone('raptor', 'neck'), 'body');
    assert.strictEqual(L.classifyZone('ptero', 'wing'), 'wing');
    assert.strictEqual(L.classifyZone('raptor', 'wing'), 'body');
  },
  // ------------------------------------------------ packs
  flankOffsetsFanOutAlternately() {
    assert.deepStrictEqual([0, 1, 2, 3, 4].map(i => L.flankOffset(i, 6)), [0, 6, -6, 12, -12]);
  },
  flankConvergesNearTheTarget() {
    assert.strictEqual(L.flankAt(10, 50), 10);
    assert.strictEqual(L.flankAt(10, 5), 0);
    const mid = L.flankAt(10, 20); assert.ok(mid > 0 && mid < 10);
  },
  // ------------------------------------------------ timing
  telegraphWindows() {
    const rn = L.attackWindowMs('raptor', 'leap', 14), rf = L.attackWindowMs('raptor', 'leap', 30);
    assert.ok(rn > 650 && rf > rn + 1000, 'a rush from the ferns gives you time to stop it: ' + rn + ' / ' + rf);
    assert.strictEqual(L.attackWindowMs('rex', 'bite', 6), 700);
    assert.strictEqual(L.attackWindowMs('ptero', 'swoop', 40), 800 + 1500);
    const spit = L.attackWindowMs('dilo', 'spit', 26); assert.strictEqual(spit, 900 + 2000, 'a slow glob you can see coming and shoot');
    const near = L.attackWindowMs('trike', 'charge', 22), far = L.attackWindowMs('trike', 'charge', 36);
    assert.ok(near > 900 && far > near, 'charge window grows with distance');
  },
  // ------------------------------------------------ state machine
  delayedSpawnWaitsThenAppears() {
    const b = L.createBrain('raptor', { delay: 1 });
    assert.strictEqual(b.state, 'wait');
    const a = run(b, { dist: 50 }, 1.1);
    assert.ok(types(a).includes('appear')); assert.strictEqual(b.state, 'approach');
  },
  raptorStalksFirstThenRushesFromRange() {
    const b = L.createBrain('raptor', { rnd: () => 0.5 });
    assert.ok(b.holdR >= 20, 'its stalking ring is out in the ferns');
    let a = L.step(b, { dist: 24 }, 0.05);
    assert.ok(!types(a).includes('attack'), 'it shows itself before it commits');
    run(b, { dist: 40 }, 2);
    assert.ok(!types(L.step(b, { dist: 40 }, 0.05)).includes('attack'), 'too far to rush');
    assert.ok(!types(L.step(b, { dist: 6 }, 0.05)).includes('attack'), 'never starts an attack at the barrel');
    assert.ok(!types(L.step(b, { dist: 16 }, 0.05)).includes('attack'), 'not until it is back out on its ring');
    a = L.step(b, { dist: 24 }, 0.05);
    const atk = a.find(x => x.type === 'attack');
    assert.ok(atk && atk.kind === 'leap' && atk.dodgeable && !atk.duckable && atk.windowMs > 2000);
    a = run(b, { dist: 3 }, atk.windowMs / 1000 - 0.1);
    assert.ok(!types(a).includes('strike'), 'not before the window');
    a = run(b, { dist: 3 }, 0.15);
    const st = a.find(x => x.type === 'strike');
    assert.ok(st && st.inReach && st.damage > 0); assert.strictEqual(b.state, 'recover');
    assert.ok(b.cooldown > 0);
  },
  twoHitsStopARush() {
    const b = L.createBrain('raptor', { rnd: () => 0.5 }); b.cooldown = 0;
    L.step(b, { dist: 24 }, 0.05);
    run(b, { dist: 18 }, 0.5);
    assert.ok(!L.applyDamage(b, 34, 'body').stumble);
    const r = L.applyDamage(b, 34, 'body');
    assert.ok(r.stumble && !r.killed); assert.strictEqual(b.state, 'stumble');
    assert.ok(!types(run(b, { dist: 3 }, 3)).includes('strike'), 'a stopped rush never lands');
  },
  strikeOutOfReachDoesNotLand() {
    const b = L.createBrain('raptor', { rnd: () => 0.5 }); b.cooldown = 0;
    const w = L.step(b, { dist: 24 }, 0.05).find(x => x.type === 'attack').windowMs;
    const st = run(b, { dist: 20 }, w / 1000 + 0.1).find(x => x.type === 'strike');
    assert.ok(st && !st.inReach);
  },
  neverAttacksFromOutsideTheView() {
    const b = L.createBrain('trike', { rnd: () => 0.5 });
    assert.ok(!types(L.step(b, { dist: b.chargeDist - 1, front: false }, 0.05)).includes('attack'), 'it ran past: no charge from behind');
    assert.ok(types(L.step(b, { dist: b.chargeDist - 1, front: true }, 0.05)).includes('attack'));
  },
  holdBearingKeepsTheThreatInFront() {
    assert.ok(Math.abs(L.holdBearing(0.2, 0, 1) - 0.2) < 1e-9);
    assert.ok(Math.abs(L.holdBearing(2.5, 0, 1) - 1) < 1e-9);
    assert.ok(Math.abs(L.holdBearing(-3, 0, 1) + 1) < 1e-9);
    assert.ok(Math.abs(L.holdBearing(Math.PI - 0.1, Math.PI, 0.5) - (Math.PI - 0.1)) < 1e-9, 'wraps round');
  },
  packLossMakesRaptorsHesitate() {
    const b = L.createBrain('raptor', {});
    L.step(b, { dist: 40, packLoss: true }, 0.05);
    assert.strictEqual(b.state, 'hesitate');
    run(b, { dist: 40 }, 2);
    assert.strictEqual(b.state, 'approach');
  },
  diloStopsAtRangeAndSpits() {
    const b = L.createBrain('dilo', { rnd: () => 0.5 });
    assert.strictEqual(b.stopDist, 29);
    assert.ok(!types(L.step(b, { dist: 32 }, 0.05)).includes('attack'));
    const a = L.step(b, { dist: 28 }, 0.05);
    const atk = a.find(x => x.type === 'attack');
    assert.ok(atk && atk.kind === 'spit' && atk.dodgeable && !atk.duckable, 'the phone has no duck: every attack is dodged or shot');
    const later = run(b, { dist: 28 }, atk.windowMs / 1000 + 0.06);
    assert.ok(types(later).includes('spit') && types(later).includes('strike'));
    assert.ok(types(later).indexOf('spit') < types(later).indexOf('strike'));
  },
  stalkerReachesItsTargetInsteadOfAttacking() {
    const b = L.createBrain('raptor', { playerTarget: false });
    assert.deepStrictEqual(types(L.step(b, { dist: 2, pathDone: false }, 0.05)), []);
    const a = L.step(b, { dist: 2, pathDone: true }, 0.05);
    assert.ok(types(a).includes('reached')); assert.ok(!types(a).includes('attack'));
    assert.deepStrictEqual(types(L.step(b, { dist: 2, pathDone: true }, 0.05)), [], 'reached fires once');
  },
  grazersNeverAttackAndFleeWhenAlarmed() {
    const b = L.createBrain('grazer', { aggro: 0, rnd: () => 0 });
    const a = run(b, { dist: 1 }, 30);
    assert.ok(!types(a).includes('attack'));
    assert.ok(['graze', 'wander'].includes(b.state));
    L.step(b, { dist: 1, alarmed: true }, 0.05, () => 0.5);
    assert.strictEqual(b.state, 'flee');
    run(b, { dist: 1 }, 12);
    assert.strictEqual(b.state, 'graze');
  },
  pteroCirclesThenSwoops() {
    const b = L.createBrain('ptero', { rnd: () => 0 });
    assert.strictEqual(b.state, 'circle');
    const a = run(b, { dist: 50 }, 4);
    const atk = a.find(x => x.type === 'attack');
    assert.ok(atk && atk.kind === 'swoop' && atk.dodgeable && !atk.duckable);
  },
  rexRoarsThenCharges() {
    const b = L.createBrain('rex', { rnd: () => 0 });
    let a = run(b, { dist: 30 }, 7.2);
    assert.ok(types(a).includes('roar')); assert.strictEqual(b.state, 'roar');
    a = run(b, { dist: 30 }, 2.7);
    const atk = a.find(x => x.type === 'attack');
    assert.ok(atk && atk.kind === 'charge' && atk.dodgeable);
  },
  noAttackNeedsADuck() {
    for (const k in L.SPECIES) {
      const sp = L.SPECIES[k];
      for (const a of [sp.attack, sp.bite]) if (a) assert.ok(a.dodgeable && !a.duckable, k + ' ' + a.kind + ' must be dodgeable');
    }
  },
  rexBitesAtCloseRange() {
    const b = L.createBrain('rex', {});
    const atk = L.step(b, { dist: 6 }, 0.05).find(x => x.type === 'attack');
    assert.ok(atk && atk.kind === 'bite' && atk.windowMs === 700);
  },
  // ------------------------------------------------ damage
  headshotKillsARaptor() {
    const b = L.createBrain('raptor', {});
    const r = L.applyDamage(b, 34, 'head');
    assert.strictEqual(r.damage, 102); assert.ok(r.killed); assert.strictEqual(b.state, 'dead');
    assert.strictEqual(L.applyDamage(b, 34, 'head').damage, 0, 'dead animals take no more damage');
  },
  trikeArmourShrugsOffCarbineFire() {
    const b = L.createBrain('trike', {});
    const r = L.applyDamage(b, 34, 'armor');
    assert.ok(Math.abs(r.damage - 10.2) < 1e-9); assert.ok(!r.killed);
  },
  chargeIsStoppedByEnoughDamage() {
    assert.ok(!L.chargeStopped('trike', 100)); assert.ok(L.chargeStopped('trike', 130)); assert.ok(L.chargeStopped('raptor', 50) && !L.chargeStopped('dilo', 1e9));
    const b = L.createBrain('trike', { rnd: () => 0.5 });
    L.step(b, { dist: b.chargeDist - 1 }, 0.05);
    assert.strictEqual(b.state, 'telegraph'); assert.strictEqual(b.kind, 'charge');
    run(b, { dist: 20 }, 1.0); // pawing over, now running
    assert.ok(!L.applyDamage(b, 34, 'body').stumble);
    assert.ok(!L.applyDamage(b, 34, 'body').stumble);
    assert.ok(!L.applyDamage(b, 34, 'body').stumble);
    const r = L.applyDamage(b, 34, 'body');
    assert.ok(r.stumble); assert.strictEqual(b.state, 'stumble');
    const a = run(b, { dist: 2 }, 3);
    assert.ok(!types(a).includes('strike'), 'a stopped charge never lands');
  },
  damageWhilePawingDoesNotCountTowardsStopping() {
    const b = L.createBrain('trike', { rnd: () => 0.5 });
    L.step(b, { dist: 20 }, 0.05);
    const r = L.applyDamage(b, 200, 'body');
    assert.ok(!r.stumble); assert.strictEqual(b.chargeDmg, 0);
  },
  rexStaggersAtThresholdsAndRages() {
    assert.strictEqual(L.thresholdsCrossed([0.75, 0.5], 1000, 740, 1000), 1);
    assert.strictEqual(L.thresholdsCrossed([0.75, 0.5], 1000, 400, 1000), 2);
    assert.strictEqual(L.thresholdsCrossed([0.75, 0.5], 700, 600, 1000), 0);
    const b = L.createBrain('rex', {});
    const q = b.maxHp / 3000; // the tests were written for 3000 hp
    let r = L.applyDamage(b, 800 * q, 'body'); assert.ok(r.stagger); assert.strictEqual(b.state, 'stagger');
    r = L.applyDamage(b, 100 * q, 'body'); assert.ok(!r.stagger);
    r = L.applyDamage(b, 800 * q, 'body'); assert.ok(r.stagger && r.rage && b.rage);
  },
  bigHitStaggersAndCancelsTheLeap() {
    const b = L.createBrain('raptor', { rnd: () => 0.5 }); b.cooldown = 0;
    L.step(b, { dist: 24 }, 0.05);
    assert.strictEqual(b.state, 'telegraph');
    const r = L.applyDamage(b, 80, 'body');
    assert.ok(r.stagger); assert.strictEqual(b.state, 'stagger');
    assert.ok(!types(run(b, { dist: 3 }, 0.6)).includes('strike'));
  },
  diloFleesWhenBadlyHurtThenReturns() {
    const b = L.createBrain('dilo', {});
    const r = L.applyDamage(b, 60, 'body');
    assert.ok(!r.flee);
    const r2 = L.applyDamage(b, 30, 'body');
    assert.ok(r2.flee); assert.strictEqual(b.state, 'flee');
    run(b, { dist: 40 }, 6);
    assert.strictEqual(b.state, 'approach');
  },
  grazerHitBolts() {
    const b = L.createBrain('grazer', { aggro: 0 });
    const r = L.applyDamage(b, 34, 'body'); assert.ok(r.flee); assert.strictEqual(b.state, 'flee');
  },
  // ------------------------------------------------ geometry
  rayCapsuleHitsSideAndCaps() {
    const o = { x: 0, y: 0, z: -10 }, d = { x: 0, y: 0, z: 1 };
    const t1 = L.rayCapsule(o, d, { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.5);
    assert.ok(Math.abs(t1 - 9.5) < 1e-9);
    const t2 = L.rayCapsule({ x: -10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.5);
    assert.ok(Math.abs(t2 - 8.5) < 1e-9);
    assert.strictEqual(L.rayCapsule(o, d, { x: -1, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }, 0.5), -1);
    assert.strictEqual(L.raySphere(o, d, { x: 0, y: 0, z: 0 }, 1), 9);
    assert.strictEqual(L.segParam({ x: 5, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }), 0.5);
  },
};

let pass = 0, fail = 0;
for (const [name, fn] of Object.entries(t)) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); }
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
void seq;
