// Run: node games/arena/test/gull.test.js
'use strict';
const assert = require('assert');
const Gl = require('../gull.js');
const M = require('../map.js');
const { GULL } = Gl;

const map = M.buildMap();
const still = { mx: 0, my: 0, yaw: 0, climb: 0 };
const run = (g, inp, secs, fn = Gl.fly) => { for (let t = 0; t < secs; t += 1 / 60) fn(g, inp, 1 / 60, map, M); return g; };

const tests = {
  risesToCruiseThenHolds() {
    const g = Gl.create(0, -20, 1.5, 0, 0);
    let up = false;
    for (let t = 0; t < 4 && !up; t += 1 / 60) up = Gl.rise(g, still, 1 / 60, map, M);
    assert.ok(up, 'reached cruise height');
    assert.ok(g.y >= GULL.cruise - 0.01 && g.y < GULL.cruise + 1, `y ${g.y}`);
    const y = g.y;
    run(g, still, 2);
    assert.ok(Math.abs(g.y - y) < 0.3, 'holds altitude with no input');
  },
  fliesWhereTheCameraLooks() {
    const g = Gl.create(0, 0, 10, 0, 0); g.vy = 0; g.mode = 'fly';
    run(g, { mx: 0, my: 1, yaw: 0, climb: 0 }, 1.5);           // yaw 0 looks toward -z
    assert.ok(g.z < -8, `forward is -z at yaw 0 (z ${g.z})`);
    const h = Gl.create(0, 0, 10, 0, 0); h.vy = 0; h.mode = 'fly';
    run(h, { mx: 0, my: 1, yaw: Math.PI / 2, climb: 0 }, 1.5);  // yaw +90 looks toward -x
    assert.ok(h.x < -8 && Math.abs(h.z) < 1, `turned camera turns the flight (x ${h.x})`);
    assert.ok(Math.hypot(h.vx, h.vz) <= GULL.speed + 1e-6, 'never faster than cruise');
  },
  climbsAndSinksButKeepsClearOfTheFloor() {
    const g = Gl.create(0, -20, 10, 20, 0); g.vy = 0; g.mode = 'fly';
    run(g, { mx: 0, my: 0, yaw: 0, climb: 1 }, 6);
    assert.ok(g.y <= GULL.maxY + 1e-6 && g.y > 18, 'climbs to the ceiling');
    run(g, { mx: 0, my: 0, yaw: 0, climb: -1 }, 8);
    assert.ok(Math.abs(g.y - GULL.minClear) < 0.05, `sinks to the floor clearance (y ${g.y})`);
  },
  staysInsideTheHarbour() {
    const g = Gl.create(0, 40, 10, 0, 0); g.vy = 0;
    run(g, { mx: 0, my: 1, yaw: -Math.PI / 2, climb: 0 }, 3);  // yaw -90 looks toward +x
    assert.ok(g.x <= GULL.bounds.x1 + 1e-6, 'east bound');
    const n = Gl.create(0, 0, 10, -30, 0); n.vy = 0;
    run(n, { mx: 0, my: 1, yaw: 0, climb: -1 }, 4);
    assert.ok(n.z >= GULL.bounds.z0 - 1e-6, 'out over the water, but not forever');
  },
  cannotFlyThroughWalls() {
    // low along the warehouse's west wall (x = -11, door gap only at z -2..2): try to go through at z = 4.5
    const g = Gl.create(0, -16, 3, 4.5, 0); g.vy = 0; g.mode = 'fly';
    run(g, { mx: 0, my: 1, yaw: -Math.PI / 2, climb: 0 }, 2);
    assert.ok(g.x < -11, `blocked by the shed wall (x ${g.x})`);
  },
  landsOnTopOfABoxRatherThanSinkingIn() {
    const g = { x: 0, y: 2.7, z: 0, vx: 0, vy: -3, vz: 0 };
    const box = { x0: -1, x1: 1, z0: -1, z1: 1, y0: 0, y1: 2.6 };
    assert.ok(Gl.pushOut(g, box, 0.42));
    assert.ok(Math.abs(g.y - (2.6 + 0.42)) < 1e-6 && g.vy === 0, 'pushed up, not sideways');
  },
  diveHomesInAndHits() {
    const g = Gl.create(0, 0, 10, 0, 0); g.mode = 'dive'; g.vx = 0; g.vy = 0; g.vz = -GULL.diveSpeed;
    const target = { x: 6, y: 1.6, z: -12 };
    let r = 'flying', t = 0;
    for (; t < GULL.diveMax && r !== 'hit'; t += 1 / 60) r = Gl.diveStep(g, target.x, target.y, target.z, 1 / 60, map, M);
    assert.strictEqual(r, 'hit');
    assert.ok(t < 1.2, `fast (${t.toFixed(2)} s)`);
  },
  diveTargetIsTheFoeNearestTheCrosshairInSight() {
    const g = { x: 0, y: 10, z: 0 };
    const dir = { x: 0, y: -0.6, z: -0.8 };
    const foes = [{ x: 0, y: 1.6, z: -11 }, { x: 2.5, y: 1.6, z: -11 }, { x: 0, y: 1.6, z: 11 }];
    assert.strictEqual(Gl.pickDiveTarget(g, dir, foes), 0, 'dead ahead wins');
    assert.strictEqual(Gl.pickDiveTarget(g, dir, foes, i => i !== 0), 1, 'the next one when the first is behind cover');
    assert.strictEqual(Gl.pickDiveTarget(g, dir, foes, i => i === 2), -1, 'nothing behind the camera');
    assert.strictEqual(Gl.pickDiveTarget(g, dir, [{ x: 0, y: 1.6, z: -60 }]), -1, 'out of range');
  },
  spotsWhatItLooksAt() {
    const g = { x: 0, y: 10, z: 0 }, dir = { x: 0, y: -0.5, z: -0.866 };
    assert.ok(Gl.canSpot(g, dir, { x: 2, y: 1, z: -15 }));
    assert.ok(!Gl.canSpot(g, dir, { x: 0, y: 1, z: 15 }), 'not behind');
    assert.ok(Gl.canSpot(g, dir, { x: 0, y: 8, z: 2 }), 'anything very close');
    assert.ok(!Gl.canSpot(g, dir, { x: 0, y: 1, z: -50 }), 'not too far');
  },
  gullsCanBeShot() {
    const g = { x: 0, y: 8, z: -10 };
    const d = Math.hypot(0, 6.4, -10), t = Gl.rayHitsGull(g, 0, 1.6, 0, 0, 6.4 / d, -10 / d, 100);
    assert.ok(t > 11 && t < 12.1, `hit at ${t}`);
    assert.strictEqual(Gl.rayHitsGull(g, 0, 1.6, 0, 0, 0, -1, 100), -1, 'a level shot passes under it');
  },
  assistWindow() {
    assert.ok(Gl.earnsAssist(10, 10 + GULL.assistWindow - 0.1));
    assert.ok(!Gl.earnsAssist(10, 10 + GULL.assistWindow + 0.1));
    assert.ok(!Gl.earnsAssist(null, 3));
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
