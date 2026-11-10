// Run: node games/arena/test/map.test.js
'use strict';
const assert = require('assert');
const M = require('../map.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const map = M.buildMap();

const tests = {
  hasSpawnsForBothTeams() {
    assert.strictEqual(map.spawns[0].length, 5);
    assert.strictEqual(map.spawns[1].length, 5);
  },
  spawnsAreClearOfSolids() {
    for (const team of map.spawns) for (const s of team) {
      assert.ok(!M.circleHitsSolid(map, s.x, s.z, 0.45, 0.1, 1.7), `spawn ${s.x},${s.z} blocked`);
    }
  },
  rayHitsBox() {
    const box = { x0: -1, y0: 0, z0: -1, x1: 1, y1: 2, z1: 1 };
    const h = M.rayBox(-5, 1, 0, 1, 0, 0, box, 100);
    near(h.t, 4); assert.deepStrictEqual(h.n, [-1, 0, 0]);
    assert.strictEqual(M.rayBox(-5, 3, 0, 1, 0, 0, box, 100), null);
    assert.strictEqual(M.rayBox(-5, 1, 0, 1, 0, 0, box, 3), null, 'max distance respected');
  },
  groundOnRampIsInterpolated() {
    const r = map.ramps[0];
    const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    const g = M.groundHeight(map, mx, mz, 10);
    near(g, (r.h0 + r.h1) / 2, 0.01);
  },
  groundIgnoresRoofsAboveYou() {
    // standing inside the warehouse, the roof is not the floor
    assert.ok(M.groundHeight(map, 0, 0, 0) < 0.5);
  },
  moveCircleStopsAtWall() {
    const wall = { x0: 0, y0: 0, z0: -5, x1: 1, y1: 3, z1: 5 };
    const tiny = { solids: [wall], ramps: [] };
    const p = M.moveCircle(tiny, { x: -1, y: 0, z: 0 }, 2, 0, 0.4, 1.8);
    assert.ok(p.x <= -0.4 + 1e-6, `went into wall: ${p.x}`);
    near(p.z, 0);
    const s = M.moveCircle(tiny, { x: -1, y: 0, z: 0 }, 2, 1, 0.4, 1.8);
    near(s.z, 1, 1e-6, 'slides along wall');
  },
  navGraphConnectsSpawns() {
    const nav = M.buildNav(map);
    assert.ok(nav.nodes.length > 200);
    const a = M.nearestNode(nav, map.spawns[0][0].x, map.spawns[0][0].z);
    const b = M.nearestNode(nav, map.spawns[1][0].x, map.spawns[1][0].z);
    const path = M.findPath(nav, a, b);
    assert.ok(path && path.length > 5, 'path between spawns');
    // the raised dock is reachable
    const d = map.landmarks.dock;
    const top = M.nearestNode(nav, d.x, d.z);
    assert.ok(nav.nodes[top].y > 1.5, 'dock node is on top');
    assert.ok(M.findPath(nav, a, top), 'dock reachable via ramps');
  },
  noSightlineBetweenSpawnZones() {
    // nobody should be able to shoot across the map from spawn to spawn
    const open = [];
    for (let z0 = -12; z0 <= 12; z0 += 1) for (let x0 = -44; x0 <= -34; x0 += 2)
      for (let z1 = -12; z1 <= 12; z1 += 1) for (const x1 of [34, 39, 44]) {
        if (M.lineOfSight(map, x0, 1.62, z0, x1, 1.62, z1)) open.push(`(${x0},${z0})->(${x1},${z1})`);
      }
    assert.strictEqual(open.length, 0, `${open.length} open lines, e.g. ${open.slice(0, 4).join(' ')}`);
  },
  lineOfSightBlockedByWarehouse() {
    assert.strictEqual(M.lineOfSight(map, -20, 1.6, 5, 20, 1.6, 5), false);
    assert.strictEqual(M.lineOfSight(map, -40, 1.6, -10, -38, 1.6, -10), true);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
