// Run: node games/fishing/test/bite.test.js
// Free fish: noticing a lure, nibbling, striking, missing; splashes that spook; one fish per lure.
'use strict';
const assert = require('assert');
const L = require('../logic.js');

const lure = (o) => Object.assign({ id: 1, x: 0, z: -20, inWater: true, age: 0, twitch: 99, moving: 0, claimed: -1 }, o);
/** Step fish until fn(events) says stop, or secs pass. Returns all events. */
function sim(fishes, lures, secs, rng, stop) {
  const all = [];
  for (let t = 0; t < secs; t += 1 / 60) {
    for (const l of lures) { l.age += 1 / 60; l.twitch += 1 / 60; }
    for (const f of fishes) { const ev = L.stepFish(f, 1 / 60, lures, rng); all.push(...ev); if (stop && ev.some(stop)) return all; }
  }
  return all;
}

const tests = {
  aNearbyFishNoticesAFreshLure() {
    let noticed = 0;
    for (let s = 1; s <= 20; s++) {
      const rng = L.rng32(s);
      const f = L.spawnFish(rng, { species: 'perch', x: 3, z: -22, id: 7 });
      const ev = sim([f], [lure()], 8, rng, e => e.type === 'notice');
      if (ev.some(e => e.type === 'notice')) noticed++;
    }
    assert(noticed >= 16, noticed + '/20');
  },
  aFarFishIgnoresIt() {
    const rng = L.rng32(3);
    const f = L.spawnFish(rng, { species: 'perch', x: 25, z: -55, id: 7 });
    f.state = 'wander'; f.vt = 0; f.v = 0; f.turnT = 99;
    const ev = sim([f], [lure()], 5, rng);
    assert(!ev.some(e => e.type === 'notice'));
  },
  perchNibblesThenStrikes() {
    const rng = L.rng32(11);
    const f = L.spawnFish(rng, { species: 'perch', x: 1, z: -21, id: 7 });
    const ev = sim([f], [lure()], 30, rng, e => e.type === 'strike');
    const types = ev.map(e => e.type);
    const si = types.indexOf('strike');
    assert(si > 0, types.join(','));
    assert(types.slice(0, si).filter(t => t === 'nibble').length >= 2, 'perch nibble first: ' + types.join(','));
  },
  anUnansweredStrikeIsAMiss() {
    const rng = L.rng32(11);
    const f = L.spawnFish(rng, { species: 'perch', x: 1, z: -21, id: 7 });
    const l = lure();
    sim([f], [l], 30, rng, e => e.type === 'strike');
    const ev = sim([f], [l], 2, rng, e => e.type === 'miss');
    assert(ev.some(e => e.type === 'miss') && f.state === 'flee' && l.claimed === -1);
  },
  theStrikeWindowIsTheSpeciesWindow() {
    const rng = L.rng32(5);
    const f = L.spawnFish(rng, { species: 'mackerel', x: 0, z: -20.3, id: 2 });
    const l = lure({ claimed: 2 });
    f.state = 'strike'; f.t = f.sp.window; f.lure = 1;
    let t = 0;
    while (f.state === 'strike' && t < 3) { L.stepFish(f, 1 / 60, [l], rng); t += 1 / 60; }
    assert(Math.abs(t - f.sp.window) < 0.05, t.toFixed(2));
  },
  mackerelHitAMovingLure() {
    let direct = 0;
    for (let s = 1; s <= 10; s++) {
      const rng = L.rng32(s);
      const f = L.spawnFish(rng, { species: 'mackerel', x: 0.5, z: -21, id: 3 });
      const ev = sim([f], [lure({ moving: 1.2 })], 12, rng, e => e.type === 'strike' || e.type === 'nibble');
      if (ev.length && ev[ev.length - 1].type === 'strike') direct++;
    }
    assert(direct >= 9, direct + '/10');
  },
  aSplashOnTopSpooksAWaryFish() {
    let spooked = 0;
    for (let s = 1; s <= 20; s++) {
      const rng = L.rng32(s);
      const f = L.spawnFish(rng, { species: 'ray', x: 0.3, z: -20, id: 1 });
      if (L.splashNear(f, 0, -20, rng, true)) spooked++;
    }
    assert(spooked >= 17, spooked + '/20');
    const rng = L.rng32(1);
    const far = L.spawnFish(rng, { species: 'ray', x: 8, z: -20, id: 1 });
    assert(!L.splashNear(far, 0, -20, rng, true), 'a splash 8 m off does not reach');
  },
  oneFishPerLure() {
    const rng = L.rng32(8);
    const fs = [1, 2, 3, 4].map(i => L.spawnFish(rng, { species: 'perch', x: i * 0.7, z: -21, id: i }));
    const l = lure();
    sim(fs, [l], 6, rng);
    assert(fs.filter(f => f.lure === 1).length <= 1);
  },
  reelingTheLureOutLetsTheFishGo() {
    const rng = L.rng32(11);
    const f = L.spawnFish(rng, { species: 'perch', x: 1, z: -21, id: 7 });
    const l = lure();
    sim([f], [l], 30, rng, e => e.type === 'notice');
    l.inWater = false;
    const ev = L.stepFish(f, 1 / 60, [l], rng);
    assert(ev.some(e => e.type === 'lose') && f.lure === -1 && l.claimed === -1);
  },
  sizesSkewSmallAndStayInRange() {
    const rng = L.rng32(2);
    let small = 0;
    for (let i = 0; i < 400; i++) {
      const f = L.spawnFish(rng, { species: 'bass' });
      assert(f.kg >= f.sp.kg[0] && f.kg <= f.sp.kg[1]);
      if (f.size < 0.5) small++;
    }
    assert(small > 240, 'most are ordinary: ' + small);
    assert.strictEqual(L.stars(0.9), 3); assert.strictEqual(L.stars(0.05), 1);
  },
  theLegendOnlyComesWhenCalled() {
    const rng = L.rng32(4);
    for (let i = 0; i < 300; i++) assert.notStrictEqual(L.spawnFish(rng).sp.id, 'grouper');
    assert.strictEqual(L.spawnFish(rng, { legendary: true }).sp.id, 'grouper');
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
