// Run: node games/dino/test/feel.test.js  -- game clock (hit-stop, slow motion), ADRENALINE, rumble
'use strict';
const assert = require('assert');
const F = require('../feel.js');
const run = (c, secs, dt) => { let k = 1; for (let t = 0; t < secs - 1e-9; t += dt) k = F.step(c, dt); return k; };
const t = {
  normalClockRunsAtFullSpeed() {
    const c = F.createClock();
    assert.strictEqual(F.step(c, 1 / 60), 1);
  },
  hitStopFreezesThenReleases() {
    const c = F.createClock();
    F.hitStop(c, 100);
    assert.ok(F.step(c, 0.016) <= F.HIT_STOP_SCALE + 1e-9, 'frozen');
    run(c, 0.1, 0.016);
    assert.strictEqual(F.step(c, 0.016), 1, 'back to normal after 100 ms');
  },
  longerHitStopWins() {
    const c = F.createClock();
    F.hitStop(c, 150); F.hitStop(c, 40);
    run(c, 0.1, 0.01);
    assert.ok(F.step(c, 0.01) < 0.1, 'still in the 150 ms stop');
  },
  slowMoEasesInHoldsAndOut() {
    const c = F.createClock();
    F.slowMo(c, 0.3, 1, 0.1, 0.2);
    const k0 = F.step(c, 0.02);
    assert.ok(k0 < 1 && k0 > 0.3, 'easing in');
    const k1 = run(c, 0.4, 0.02);
    assert.ok(Math.abs(k1 - 0.3) < 1e-6, 'holding at 0.3, got ' + k1);
    run(c, 0.7, 0.02);
    assert.strictEqual(F.step(c, 0.02), 1);
    assert.strictEqual(c.slow, null);
  },
  weakerSlowDoesNotCutAStrongOne() {
    const c = F.createClock();
    F.slowMo(c, 0.2, 2);
    F.slowMo(c, 0.5, 0.3);
    run(c, 0.5, 0.02);
    assert.ok(F.step(c, 0.02) < 0.25);
  },
  adrenalineNeedsAFullMeterAndALunge() {
    const c = F.createClock();
    const leap = { kind: 'leap', dist: 20, windowMs: 2000 };
    assert.strictEqual(F.wantsAdrenaline(c, leap), false, 'meter starts half full');
    F.charge(c, 0.6);
    assert.strictEqual(c.meter, 1, 'clamped at 1');
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'spit', dist: 25, windowMs: 2000 }), false, 'a spit is not a lunge');
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'charge', dist: 80, windowMs: 4000 }), false, 'too far away');
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'leap', dist: 20, windowMs: 2000, playerTarget: false }), false, 'not coming for you');
    assert.ok(F.wantsAdrenaline(c, leap));
  },
  adrenalineStartsOutThereNeverAtTheBarrel() {
    const c = F.createClock(); c.meter = 1;
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'bite', dist: 8, windowMs: 700 }), false, 'a bite is already in your face');
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'leap', dist: 5, windowMs: 900 }), false, 'too close');
    assert.ok(F.wantsAdrenaline(c, { kind: 'leap', dist: 24, windowMs: 2400 }), 'a rush from the ferns');
    const dl = F.adrenalineDelay(2400);
    assert.ok(Math.abs(dl - (2.4 - F.ADREN.lead)) < 1e-9, 'drops in for the last stretch of the run');
    assert.strictEqual(F.adrenalineDelay(600), 0);
  },
  adrenalineStretchesTheStrikeAndEmptiesTheMeter() {
    const c = F.createClock(); c.meter = 1;
    const real = F.startAdrenaline(c, { kind: 'leap', windowMs: 850, id: 7 });
    assert.strictEqual(c.meter, 0);
    assert.ok(real > 2 && real <= F.ADREN.maxReal, 'a 0.85 s leap lasts ' + real + ' s of real time');
    const k = run(c, 0.5, 0.02);
    assert.ok(Math.abs(k - F.ADREN.scale) < 1e-6);
    // the game time that passes inside it is about the strike window
    const c2 = F.createClock(); c2.meter = 1; F.startAdrenaline(c2, { kind: 'leap', windowMs: 850 });
    let game = 0; for (let i = 0; i < 400 && c2.adren; i++) game += 0.01 * F.step(c2, 0.01);
    assert.ok(game > 0.6 && game < 1.0, 'game time inside: ' + game.toFixed(2));
  },
  adrenalineHasACooldownAndCannotStack() {
    const c = F.createClock(); c.meter = 1;
    F.startAdrenaline(c, { kind: 'leap', windowMs: 850 });
    c.meter = 1;
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'leap', dist: 16, windowMs: 1800 }), false, 'already running');
    run(c, F.ADREN.maxReal + 0.1, 0.02);
    assert.strictEqual(c.adren, null);
    assert.strictEqual(F.wantsAdrenaline(c, { kind: 'leap', dist: 16, windowMs: 1800 }), false, 'cooling down');
    run(c, F.ADREN.cooldown + 0.1, 0.05);
    assert.ok(F.wantsAdrenaline(c, { kind: 'leap', dist: 16, windowMs: 1800 }));
  },
  endingAdrenalineEasesOutQuickly() {
    const c = F.createClock(); c.meter = 1;
    F.startAdrenaline(c, { kind: 'charge', windowMs: 3000 });
    run(c, 0.5, 0.02);
    F.endAdrenaline(c);
    run(c, F.ADREN.easeOut + 0.05, 0.02);
    assert.strictEqual(c.adren, null);
    assert.strictEqual(F.step(c, 0.02), 1);
  },
  killStopsScaleWithSizeAndWeakSpots() {
    assert.ok(F.killStopMs('rex', 'body') > F.killStopMs('trike', 'body'));
    assert.ok(F.killStopMs('trike', 'body') > F.killStopMs('raptor', 'body'));
    assert.ok(F.killStopMs('raptor', 'head') > F.killStopMs('raptor', 'body'));
    assert.ok(F.killStopMs('rex', 'eye') <= 300, 'never long enough to feel like a stall');
  },
  everyWeaponRumblesAndTheRifleHardest() {
    for (const w of ['carbine', 'marksman', 'sidearm']) {
      const r = F.shotRumble(w);
      assert.ok(r[0] > 0 && r[0] <= 1 && r[1] > 0 && r[1] <= 255, w);
    }
    assert.ok(F.shotRumble('marksman')[0] > F.shotRumble('sidearm')[0]);
    assert.ok(F.shotRumble('sidearm')[0] > F.shotRumble('carbine')[0]);
    assert.ok(F.shotRumble('carbine')[1] < 60, 'short enough for 10 shots a second');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
