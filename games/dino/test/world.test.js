// Run: node games/dino/test/world.test.js  -- world pure logic: terrain, paths, scattering, mission layouts
'use strict';
const assert = require('assert');
const W = require('../world-lib.js');
const { LAYOUT, ORDER } = require('../layout.js');
const near = (a, b, e = 1e-6, msg) => assert.ok(Math.abs(a - b) <= e, `${msg || ''} ${a} != ${b} (±${e})`);
const dxz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const t = {
  // ---------------------------------------------------------------- random + noise
  rngIsDeterministicAndInRange() {
    const a = W.rng(42), b = W.rng(42), c = W.rng(43);
    const va = [a(), a(), a()], vb = [b(), b(), b()];
    assert.deepStrictEqual(va, vb);
    assert.notDeepStrictEqual(va, [c(), c(), c()]);
    const r = W.rng(7);
    for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
  },
  noiseIsSmoothAndBounded() {
    let mn = 9, mx = -9;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.37, z = i * 0.11, v = W.fbm(x, z, 3, 4);
      mn = Math.min(mn, v); mx = Math.max(mx, v);
      const d = Math.abs(W.vnoise(x, z, 3) - W.vnoise(x + 0.01, z, 3));
      assert.ok(d < 0.05, 'value noise is continuous');
    }
    assert.ok(mn >= -1.001 && mx <= 1.001 && mx - mn > 0.5, `range ${mn}..${mx}`);
  },

  // ---------------------------------------------------------------- paths
  polylineLengthAndResample() {
    const p = [{ x: 0, z: 0 }, { x: 0, z: -10 }, { x: 10, z: -10 }];
    near(W.polyLength(p), 20);
    const r = W.resample(p, 2.5);
    assert.strictEqual(r.length, 9);
    for (let i = 1; i < r.length; i++) near(dxz(r[i], r[i - 1]), 2.5, 1e-9);
    assert.deepStrictEqual([r[8].x, r[8].z], [10, -10], 'keeps the end point');
  },
  catmullPassesThroughControlPoints() {
    const p = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 1, z: -10 }, { x: 0, y: 2, z: -20 }, { x: 8, y: 0, z: -30 }];
    const s = W.catmull(p, 8);
    assert.strictEqual(s.length, 3 * 8 + 1);
    p.forEach((q, i) => { near(s[i * 8].x, q.x); near(s[i * 8].y, q.y); near(s[i * 8].z, q.z); });
  },
  distToPolylineGivesNearestPointAndArcLength() {
    const p = [{ x: 0, z: 0 }, { x: 0, z: -10 }, { x: 10, z: -10 }];
    const a = W.distToPolyline(3, -5, p);
    near(a.d, 3); near(a.t, 5); near(a.px, 0); near(a.pz, -5); assert.strictEqual(a.side, 1, 'right of travel is +1');
    const b = W.distToPolyline(5, -12, p);
    near(b.d, 2); near(b.t, 15); assert.strictEqual(b.side, -1, 'travelling +X, -Z is on the left');
    assert.strictEqual(W.distToPolyline(-3, -5, p).side, -1);
    near(W.distToPolyline(0, 4, p).d, 4, 1e-9, 'clamped before the start');
  },
  yawConventionLooksDownMinusZAndTurnsLeftPositive() {
    near(W.yawTo({ x: 0, z: 0 }, { x: 0, z: -10 }), 0);
    near(W.yawTo({ x: 0, z: 0 }, { x: -10, z: 0 }), Math.PI / 2, 1e-9, 'left (-X) is +yaw');
    near(W.yawTo({ x: 0, z: 0 }, { x: 10, z: 0 }), -Math.PI / 2, 1e-9);
    const d = W.yawDir(0.7); near(Math.hypot(d.x, d.z), 1); near(W.yawTo({ x: 0, z: 0 }, d), 0.7);
  },

  // ---------------------------------------------------------------- terrain
  terrainPadsRoadsAndRiversShapeTheGround() {
    const ter = W.makeTerrain({
      seed: 1, amp: 3, scale: 40,
      features: [
        { type: 'hill', x: 50, z: 50, r: 20, h: 10 },
        { type: 'pad', x: 0, z: 0, r: 6, blend: 4, h: 2 },
        { type: 'road', pts: [{ x: -100, z: -30 }, { x: 100, z: -30 }], width: 6, shoulder: 3 },
        { type: 'river', pts: [{ x: 0, z: 100 }, { x: 0, z: -100 }].map(p => ({ x: p.x + 80, z: p.z })), width: 12, depth: 3, bank: 6, level: -1 },
      ],
    });
    near(ter.height(0, 0), 2, 1e-9, 'flat pad');
    near(ter.height(3, 2), 2, 1e-9, 'pad interior');
    assert.ok(ter.height(50, 50) > ter.height(50, 80) + 5, 'hill rises');
    // road is level across its width
    near(ter.height(-20, -31.5), ter.height(-20, -28.5), 1e-6, 'road is level across');
    assert.ok(ter.mask(-20, -30).road > 0.95 && ter.mask(-20, -60).road < 0.01);
    // river carved below its level
    assert.ok(ter.height(80, 40) < -3.5, 'river bed below water');
    assert.ok(ter.mask(80, 40).river > 0.95);
    for (let i = 0; i < 200; i++) assert.ok(isFinite(ter.height(i * 3 - 300, i * 2 - 200)));
  },
  rampAndSlopeFeatures() {
    const ter = W.makeTerrain({ seed: 2, amp: 0, features: [
      { type: 'slope', axis: 'z', from: -10, to: -50, h: 8 },
      { type: 'ramp', x0: -5, x1: 5, z0: 0, z1: 10, h0: 0, h1: 3, blend: 1 },
    ] });
    near(ter.height(100, 0), 0); near(ter.height(100, -60), 8); near(ter.height(100, -30), 4, 1.5);
    near(ter.height(0, 5), 1.5, 1e-6, 'ramp midpoint'); near(ter.height(0, 10), 3, 1e-6);
  },
  heightGridMatchesTerrainAtVerticesAndInterpolatesTriangles() {
    const ter = W.makeTerrain({ seed: 5, amp: 4, scale: 25 });
    const g = W.heightGrid(ter.height, -50, -50, 100, 2);
    assert.strictEqual(g.n, 51);
    for (let j = 0; j < g.n; j += 7) for (let i = 0; i < g.n; i += 5) {
      const x = -50 + i * 2, z = -50 + j * 2;
      near(W.gridHeight(g, x, z), ter.height(x, z), 1e-4);
    }
    // inside a cell the value lies on the plane of its triangle (diagonal from (i,j+1) to (i+1,j))
    const h00 = W.gridHeight(g, 0, 0), h10 = W.gridHeight(g, 2, 0), h01 = W.gridHeight(g, 0, 2), h11 = W.gridHeight(g, 2, 2);
    near(W.gridHeight(g, 0.5, 0.5), h00 + (h10 - h00) * 0.25 + (h01 - h00) * 0.25, 1e-4);
    near(W.gridHeight(g, 1.5, 1.5), h11 + (h01 - h11) * 0.25 + (h10 - h11) * 0.25, 1e-4);
    near(W.gridHeight(g, 500, 0), ter.height(500, 0), 1e-9, 'falls back outside the grid');
  },
  rayMarchHitsTheGround() {
    const flat = (x, z) => 0;
    const h = W.rayHeightfield(flat, { x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    near(h.dist, 10, 1e-3); near(h.point.y, 0, 1e-3);
    const hill = (x, z) => Math.max(0, 5 - Math.abs(x - 30) * 0.5);
    const d = { x: 1, y: -0.05, z: 0 }, L = Math.hypot(d.x, d.y); d.x /= L; d.y /= L;
    const r = W.rayHeightfield(hill, { x: 0, y: 4, z: 0 }, d, 200);
    assert.ok(r && r.point.x > 20 && r.point.x < 30, 'hits the near flank of the hill');
    near(r.point.y, hill(r.point.x, 0), 0.02);
    assert.strictEqual(W.rayHeightfield(flat, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, 100), null, 'up misses');
  },
  rayCylinderHitsTrunks() {
    const c = { x: 10, z: 0, r: 0.5, y0: 0, y1: 8 };
    const h = W.rayCylinder({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, c, 100);
    near(h.dist, 9.5); near(h.normal.x, -1);
    assert.strictEqual(W.rayCylinder({ x: 0, y: 9, z: 0 }, { x: 1, y: 0, z: 0 }, c, 100), null, 'above the trunk');
    assert.strictEqual(W.rayCylinder({ x: 0, y: 1, z: 2 }, { x: 1, y: 0, z: 0 }, c, 100), null, 'beside it');
    assert.strictEqual(W.rayCylinder({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, c, 5), null, 'beyond max');
  },

  // ---------------------------------------------------------------- scattering
  scatterRespectsSpacingBoundsAndExclusions() {
    const zones = [{ circle: { x: 0, z: 0, r: 10 } }, { poly: [{ x: -50, z: 20 }, { x: 50, z: 20 }], r: 4 }];
    const pts = W.scatter({ seed: 9, count: 300, bounds: [-50, -50, 50, 50], minDist: 3, exclude: zones });
    assert.ok(pts.length > 150, 'places most of them: ' + pts.length);
    pts.forEach(p => {
      assert.ok(p.x >= -50 && p.x <= 50 && p.z >= -50 && p.z <= 50);
      assert.ok(Math.hypot(p.x, p.z) >= 10, 'outside the circle');
      assert.ok(Math.abs(p.z - 20) >= 4, 'off the road');
      assert.ok(p.rot >= 0 && p.rot < Math.PI * 2 && p.s > 0);
    });
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(dxz(pts[i], pts[j]) >= 3 - 1e-9);
    const again = W.scatter({ seed: 9, count: 300, bounds: [-50, -50, 50, 50], minDist: 3, exclude: zones });
    assert.deepStrictEqual(again, pts, 'deterministic');
  },
  scatterDensityFunctionThinsPlacement() {
    const near0 = p => Math.hypot(p.x, p.z) < 25;
    const pts = W.scatter({ seed: 4, count: 400, bounds: [-50, -50, 50, 50], minDist: 1, density: (x, z) => Math.hypot(x, z) < 25 ? 1 : 0.1 });
    const a = pts.filter(near0).length, b = pts.length - a;
    // inner disc is ~20% of the area but should hold most points
    assert.ok(a > b, `dense near (${a}) vs far (${b})`);
  },
  exclusionHelper() {
    const z = [{ circle: { x: 5, z: 5, r: 2 } }, { rect: [10, 10, 20, 12] }, { poly: [{ x: 0, z: 0 }, { x: 0, z: -10 }], r: 1 }];
    assert.ok(W.excluded(5, 6, z)); assert.ok(W.excluded(15, 11, z)); assert.ok(W.excluded(0.5, -5, z));
    assert.ok(!W.excluded(30, 30, z)); assert.ok(!W.excluded(2, -5, z));
  },

  // ---------------------------------------------------------------- mission layouts (the contract)
  everyMissionHasEveryLayoutName() {
    ORDER.forEach(id => {
      const L = LAYOUT[id], d = W.describe(id);
      L.stands.forEach(s => assert.ok(d.stands[s.name], `${id}: stand ${s.name}`));
      L.rails.forEach(r => assert.ok(d.rails[r.name], `${id}: rail ${r.name}`));
      Object.keys(L.spawns).forEach(k => assert.ok(d.spawns[k], `${id}: spawn ${k}`));
      Object.keys(L.points).forEach(k => assert.ok(d.points[k], `${id}: point ${k}`));
      assert.deepStrictEqual(W.validate(d, L), [], `${id} validates`);
    });
  },
  validateCatchesMissingAndBrokenEntries() {
    const d = W.describe('pens');
    const bad = JSON.parse(JSON.stringify(d)); delete bad.spawns.river; bad.rails.drive1[0].x += 30; bad.stands.pens1.arc = 0;
    const e = W.validate(bad, LAYOUT.pens);
    assert.ok(e.some(m => /spawn river/.test(m)), e.join('; '));
    assert.ok(e.some(m => /drive1.*start/.test(m)), e.join('; '));
    assert.ok(e.some(m => /arc/.test(m)), e.join('; '));
  },
  standsMatchTheirDescriptions() {
    const g = W.describe('gate3'), s = g.stands.gate;
    near(s.pos.y - s.floor, 1.7, 1e-6, 'eye 1.7 above the floor');
    near(s.floor - g.terrain.height(s.pos.x, s.pos.z), 2.5, 0.35, 'gatehouse platform ~2.5 m up');
    const o = W.describe('overwatch'), tw = o.stands.tower;
    near(tw.floor - o.terrain.height(tw.pos.x, tw.pos.z), 14, 0.5, 'tower ~14 m');
    const sv = o.points.survivors, dsv = dxz(sv, tw.pos);
    assert.ok(dsv > 60 && dsv < 80, 'survivors ~70 m: ' + dsv);
    const rel = W.yawTo(tw.pos, sv) - tw.yaw; assert.ok(rel > 0.05, 'survivors left of centre');
    o.spawns.herd.points.forEach(p => { const dd = dxz(p, tw.pos); assert.ok(dd >= 110 && dd <= 170, 'herd 110-170 m: ' + dd); });
    ['stalkA', 'stalkB', 'stalkC'].forEach(k => {
      const path = o.spawns[k].path; assert.ok(dxz(path[path.length - 1], sv) < 8, k + ' ends at the survivors');
    });
    const h = W.describe('horn'), f = h.stands.field;
    near(dxz(h.spawns.laneA.points[0], f.pos), 120, 6, 'lane A ~120 m');
    near(dxz(h.spawns.laneB.points[0], f.pos), 110, 6); near(dxz(h.spawns.laneC.points[0], f.pos), 110, 6);
    const a = W.describe('apex'), pz = a.stands.plaza;
    near(dxz(a.spawns.rexEntry.points[0], pz.pos), 70, 30, 'gate ~70 m (the rex enters beyond it)');
    a.spawns.rexCircle.path.forEach(p => { const dd = dxz(p, pz.pos); assert.ok(dd >= 28 && dd <= 52, 'circle 30-50: ' + dd); });
    near(dxz(a.spawns.balcony.points[0], pz.pos), 20, 4, 'balcony ~20 m');
    assert.ok(a.spawns.balcony.points[0].y > a.terrain.height(a.spawns.balcony.points[0].x, a.spawns.balcony.points[0].z) + 3, 'balcony is up');
  },
  railsJoinTheirStandsAndHaveTheRightLength() {
    const d = W.describe('pens');
    LAYOUT.pens.rails.forEach(r => {
      const pts = d.rails[r.name], a = d.stands[r.from], b = d.stands[r.to];
      assert.ok(dxz(pts[0], a.pos) < 0.5 && dxz(pts[pts.length - 1], b.pos) < 0.5);
      near(pts[0].y + 1.7, a.pos.y, 0.05, r.name + ' starts at stand floor'); near(pts[pts.length - 1].y + 1.7, b.pos.y, 0.05);
      const L = W.polyLength(pts); assert.ok(L > 90 && L < 150, r.name + ' length ' + L);
    });
    const br = d.stands.pens2; assert.ok(br.floor > d.terrain.height(br.pos.x, br.pos.z) + 2, 'bridge stands above the river bed');
  },
  groundSpawnsSitOnTheGround() {
    ORDER.forEach(id => {
      const d = W.describe(id);
      Object.entries(d.spawns).forEach(([k, s]) => {
        if (s.air || s.elevated) return;
        s.points.forEach(p => near(p.y, d.heightAt(p.x, p.z), 0.05, `${id}.${k} on ground`));
      });
    });
  },
  heightAtIncludesTheBridgeDeck() {
    const d = W.describe('pens'), s = d.stands.pens2;
    near(d.heightAt(s.pos.x, s.pos.z), s.floor, 0.05);
    assert.ok(d.heightAt(s.pos.x + 30, s.pos.z) < s.floor - 2, 'water beside it is lower');
  },
};

let fails = 0;
for (const [name, fn] of Object.entries(t)) {
  try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(fails ? `${fails} failing` : 'all passing');
process.exit(fails ? 1 : 0);
