// Run: node games/dino/test/nav.test.js  -- the obstacle grid animals steer with
'use strict';
const assert = require('assert');
const N = require('../nav.js');
const wall = () => { const g = N.createGrid(0, 0, 100, 0.5); N.markSegment(g, -5, 10, 5, 10, 0.3); return g; };
const t = {
  emptyGridIsFreeAndOffMapIsFree() {
    const g = N.createGrid(0, 0, 50, 1);
    assert.ok(!N.blocked(g, 0, 0)); assert.ok(!N.blocked(g, 500, 500));
  },
  circlesAndSegmentsBlock() {
    const g = N.createGrid(0, 0, 50, 0.5);
    N.markCircle(g, 3, 3, 1);
    assert.ok(N.blocked(g, 3, 3) && N.blocked(g, 3.7, 3)); assert.ok(!N.blocked(g, 5, 3));
    N.markSegment(g, -10, -5, 10, -5, 0);
    for (let x = -10; x <= 10; x += 0.5) assert.ok(N.blocked(g, x, -5), 'a wall has no gaps at ' + x);
    N.clearCircle(g, 0, -5, 1.2);
    assert.ok(!N.blocked(g, 0, -5) && N.blocked(g, 3, -5));
  },
  freeAlongSeesTheWall() {
    const g = wall();
    assert.ok(!N.freeAlong(g, 0, 0, 0, 12, 0), 'straight into the wall');
    assert.ok(N.freeAlong(g, 0, 0, 0, 8, 0), 'not there yet');
    assert.ok(N.freeAlong(g, 0, 0, Math.PI, 12, 0), 'away from it');
  },
  steerYawGoesAround() {
    const g = wall();
    assert.strictEqual(N.steerYaw(g, 0, 0, Math.PI, 6, 0.5), Math.PI, 'a clear heading is kept');
    const y = N.steerYaw(g, 0, 7, 0, 5, 0.5);
    assert.ok(Math.abs(y) > 0.2 && N.freeAlong(g, 0, 7, y, 5, 0.5), 'turns to a clear heading: ' + y);
  },
  constrainNeverEntersAWall() {
    const g = wall();
    const p = N.constrain(g, 0, 9.4, 0, 10.2);
    assert.ok(!N.blocked(g, p.x, p.z));
    const s = N.constrain(g, 0, 9.0, 0.4, 10.2);
    assert.ok(!N.blocked(g, s.x, s.z) && s.x === 0.4, 'slides along it');
    const inside = N.constrain(g, 0, 10, 0, 11.5);
    assert.strictEqual(inside.z, 11.5, 'one already inside walks out');
  },
  findPathGoesRoundALongFence() {
    const g = N.createGrid(0, 0, 100, 0.5);
    N.markSegment(g, -20, 10, 15, 10, 0.3);    // a fence with its only gap at the east end
    const p = N.findPath(g, 0, 20, 0, 0, 20000);
    assert.ok(p && p.length >= 2, 'a way round');
    const last = p[p.length - 1]; assert.ok(Math.hypot(last.x, last.z) < 0.6, 'ends at the goal');
    let px = 0.25, pz = 20.25;   // the start cell centre
    for (const q of p) { for (let t = 0; t <= 1; t += 0.05) assert.ok(!N.blocked(g, px + (q.x - px) * t, pz + (q.z - pz) * t), 'never through the fence'); px = q.x; pz = q.z; }
    N.markSegment(g, 15, 10, 49, 10, 0.3);
    N.markSegment(g, -49, 10, -20, 10, 0.3);
    assert.strictEqual(N.findPath(g, 0, 20, 0, 0, 20000), null, 'no way at all');
  },
  insideOfAShedIsSolid() {
    const g = N.createGrid(0, 0, 60, 0.5);
    [[-5, -5, 5, -5], [5, -5, 5, 5], [5, 5, -5, 5], [-5, 5, -5, -5]].forEach(([a, b, c, d]) => N.markSegment(g, a, b, c, d, 0));
    assert.ok(!N.blocked(g, 0, 0));
    assert.ok(N.fillEnclosed(g) > 0);
    assert.ok(N.blocked(g, 0, 0), 'the floor inside is filled'); assert.ok(!N.blocked(g, 10, 0), 'outside stays open');
  },
  occludedBehindTheWall() {
    const g = wall();
    assert.ok(N.occluded(g, 0, 0, 0, 20)); assert.ok(!N.occluded(g, 0, 0, 20, 0));
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
