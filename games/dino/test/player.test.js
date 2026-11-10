// Run: node games/dino/test/player.test.js  -- dodge, duck and damage rules
'use strict';
const assert = require('assert');
const P = require('../player.js');
const t = {
  hitWhenStandingStill() {
    const p = P.create();
    const r = P.strike(p, { damage: 30, dodgeable: true, duckable: false });
    assert.strictEqual(r.result, 'hit'); assert.strictEqual(p.hp, 70);
  },
  dodgeInsideTheWindowAvoidsIt() {
    const p = P.create();
    assert.ok(P.dodge(p, 0)); P.tick(p, 0.2, 0.2);
    const r = P.strike(p, { damage: 30, dodgeable: true });
    assert.strictEqual(r.result, 'dodged'); assert.strictEqual(p.hp, 100);
  },
  dodgeWindowExpires() {
    const p = P.create(); P.dodge(p, 0); P.tick(p, 0.9, 0.9);
    assert.strictEqual(P.strike(p, { damage: 30, dodgeable: true }).result, 'hit');
  },
  dodgeHasACooldown() {
    const p = P.create(); P.dodge(p, 0); P.tick(p, 0.3, 0.3);
    assert.strictEqual(P.dodge(p, 0.3), false, 'cannot spam dodge');
    P.tick(p, 1.5, 1.8); assert.ok(P.dodge(p, 1.8));
  },
  duckAvoidsDuckableOnly() {
    const p = P.create(); p.ducking = true;
    assert.strictEqual(P.strike(p, { damage: 20, duckable: true }).result, 'ducked');
    assert.strictEqual(P.strike(p, { damage: 20, duckable: false, dodgeable: true }).result, 'hit');
  },
  deathAtZero() {
    const p = P.create(); const r = P.strike(p, { damage: 150 });
    assert.strictEqual(p.hp, 0); assert.ok(r.dead);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
