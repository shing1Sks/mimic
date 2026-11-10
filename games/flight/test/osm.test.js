// Run: node games/flight/test/osm.test.js  -- vector tile decoding, roofs, building extrusion, overlay styles, trees
'use strict';
const assert = require('assert');
const O = require('../osm.js');

// ---- a tiny Mapbox Vector Tile encoder, enough to build fixtures
const varint = (n, out) => { while (n >= 128) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); };
const zig = n => (n << 1) ^ (n >> 31);
const field = (f, w, out) => varint(f * 8 + w, out);
const bytes = (f, arr, out) => { field(f, 2, out); varint(arr.length, out); out.push(...arr); };
const str = s => Array.from(Buffer.from(s, 'utf8'));
function packed(nums) { const o = []; nums.forEach(n => varint(n, o)); return o; }
/** geometry commands for rings (closed polygons) or lines */
function geom(rs, closed) {
  const out = []; let x = 0, y = 0;
  for (const r of rs) {
    out.push((1 << 3) | 1, zig(r[0][0] - x), zig(r[0][1] - y)); x = r[0][0]; y = r[0][1];
    out.push(((r.length - 1) << 3) | 2);
    for (let i = 1; i < r.length; i++) { out.push(zig(r[i][0] - x), zig(r[i][1] - y)); x = r[i][0]; y = r[i][1]; }
    if (closed) out.push((1 << 3) | 7);
  }
  return out;
}
function layer(name, feats) {
  const keys = [], vals = [], L = [];
  bytes(1, str(name), L);
  for (const f of feats) {
    const tags = [];
    for (const [k, v] of Object.entries(f.props || {})) {
      let ki = keys.indexOf(k); if (ki < 0) { keys.push(k); ki = keys.length - 1; }
      let vi = vals.findIndex(x => x === v); if (vi < 0) { vals.push(v); vi = vals.length - 1; }
      tags.push(ki, vi);
    }
    const F = [];
    bytes(2, packed(tags), F); field(3, 0, F); varint(f.type, F); bytes(4, packed(geom(f.rings, f.type === 3)), F);
    bytes(2, F, L);
  }
  keys.forEach(k => bytes(3, str(k), L));
  vals.forEach(v => { const V = []; if (typeof v === 'string') bytes(1, str(v), V); else { field(5, 0, V); varint(v, V); } bytes(4, V, L); });
  field(5, 0, L); varint(4096, L);
  return L;
}
function tile(layers) { const T = []; for (const [n, f] of Object.entries(layers)) bytes(3, layer(n, f), T); return Uint8Array.from(T); }

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];   // clockwise on screen: an MVT exterior
const triArea = (T) => { let a = 0; for (let k = 0; k < T.tris.length; k += 3) { const p = T.pts[T.tris[k]], q = T.pts[T.tris[k + 1]], r = T.pts[T.tris[k + 2]]; a += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2; } return a; };
const flatGround = () => 100;
const opts = (o) => Object.assign({ extent: 4096, toLocal: (px, py) => [px * 0.5, py * 0.5], groundAt: flatGround, metresPerUnit: 0.5 }, o);

const t = {
  decodesLayersFeaturesAndProps() {
    const T = O.decodeTile(tile({
      building: [{ type: 3, props: { render_height: 24, colour: '#aabbcc' }, rings: [sq(100, 100, 40)] }],
      transportation: [{ type: 2, props: { class: 'primary' }, rings: [[[0, 0], [4096, 4096]]] }],
      poi: [{ type: 1, props: { class: 'cafe' }, rings: [[[5, 5]]] }],
    }), O.LAYERS);
    assert.ok(T.building && T.transportation && !T.poi, 'unwanted layers skipped');
    assert.strictEqual(T.building.extent, 4096);
    const b = T.building.features[0];
    assert.strictEqual(b.type, 3); assert.strictEqual(b.props.render_height, 24); assert.strictEqual(b.props.colour, '#aabbcc');
    assert.deepStrictEqual(O.rings(b.geom)[0], sq(100, 100, 40));
    assert.deepStrictEqual(O.rings(T.transportation.features[0].geom)[0], [[0, 0], [4096, 4096]]);
  },
  exteriorsAndHolesAreGrouped() {
    const hole = sq(110, 110, 10).reverse();
    const P = O.polygons([sq(100, 100, 40), hole, sq(300, 300, 20)]);
    assert.strictEqual(P.length, 2);
    assert.strictEqual(P[0].holes.length, 1);
    assert.strictEqual(P[0].area, 1600);
    assert.ok(O.pointInPoly(105, 105, P[0]) && !O.pointInPoly(115, 115, P[0]), 'courtyard is outside');
  },
  triangulatesConvexConcaveAndCourtyards() {
    assert.strictEqual(O.triangulate(sq(0, 0, 10), []).tris.length, 6);
    const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
    assert.ok(Math.abs(triArea(O.triangulate(L, [])) - 300) < 1e-6, 'L shape keeps its area');
    const T = O.triangulate(sq(0, 0, 30), [sq(10, 10, 10).reverse()]);
    assert.ok(Math.abs(triArea(T) - 800) < 1e-6, 'a courtyard is cut out: ' + triArea(T));
  },
  roofKinds() {
    assert.strictEqual(O.roofKind(sq(0, 0, 20), 100, 8), 'gable');
    assert.strictEqual(O.roofKind(sq(0, 0, 20), 100, 40), 'flat', 'towers are flat-roofed');
    assert.strictEqual(O.roofKind([[0, 0], [10, 0], [14, 6], [10, 12], [0, 12], [-4, 6]], 200, 8), 'hip');
    assert.strictEqual(O.roofKind([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]], 300, 8), 'flat', 'concave L is flat');
  },
  extrudesWallsOutwardAndRoofsUp() {
    const feats = O.decodeTile(tile({ building: [{ type: 3, props: { render_height: 30 }, rings: [sq(0, 0, 40)] }] })).building.features;
    const m = O.buildBuildings(feats, opts());
    assert.strictEqual(m.count, 1);
    // 4 walls x 2 + flat roof 2 = 10 triangles
    assert.strictEqual(m.tris, 10);
    let top = -1e9, bottom = 1e9, upRoof = 0;
    for (let i = 0; i < m.pos.length; i += 3) { top = Math.max(top, m.pos[i + 1]); bottom = Math.min(bottom, m.pos[i + 1]); }
    assert.strictEqual(top, 130, 'ground 100 + 30 m');
    assert.ok(bottom < 100, 'walls sink a little into the ground');
    // every wall normal points away from the footprint centre (10, 10); roof normals point up
    for (let k = 0; k < m.tris; k++) {
      const nx = m.nor[k * 9], ny = m.nor[k * 9 + 1], nz = m.nor[k * 9 + 2];
      const cx = (m.pos[k * 9] + m.pos[k * 9 + 3] + m.pos[k * 9 + 6]) / 3, cz = (m.pos[k * 9 + 2] + m.pos[k * 9 + 5] + m.pos[k * 9 + 8]) / 3;
      if (ny > 0.9) { upRoof++; continue; }
      assert.ok(nx * (cx - 10) + nz * (cz - 10) > 0, 'wall faces out');
    }
    assert.strictEqual(upRoof, 2);
  },
  courtyardWallsFaceIntoTheCourtyard() {
    const feats = O.decodeTile(tile({ building: [{ type: 3, props: { render_height: 20 }, rings: [sq(0, 0, 60), sq(20, 20, 20).reverse()] }] })).building.features;
    const m = O.buildBuildings(feats, opts());
    let inward = 0;
    for (let k = 0; k < m.tris; k++) {
      const nx = m.nor[k * 9], ny = m.nor[k * 9 + 1], nz = m.nor[k * 9 + 2];
      if (Math.abs(ny) > 0.5) continue;
      const cx = (m.pos[k * 9] + m.pos[k * 9 + 3] + m.pos[k * 9 + 6]) / 3, cz = (m.pos[k * 9 + 2] + m.pos[k * 9 + 5] + m.pos[k * 9 + 8]) / 3;
      const inCourt = cx > 9.9 && cx < 20.1 && cz > 9.9 && cz < 20.1;
      if (inCourt) { inward++; assert.ok(nx * (cx - 15) + nz * (cz - 15) < 0, 'faces the courtyard centre'); }
    }
    assert.strictEqual(inward, 8);
  },
  housesGetGabledRoofsAndLodDropsSmallOnes() {
    const feats = O.decodeTile(tile({ building: [
      { type: 3, props: { render_height: 6 }, rings: [sq(0, 0, 20)] },        // 100 m^2 house
      { type: 3, props: { render_height: 6 }, rings: [sq(100, 0, 6)] },       // 9 m^2 shed
      { type: 3, props: { render_height: 6, hide_3d: true }, rings: [sq(200, 0, 20)] },
    ] })).building.features;
    const full = O.buildBuildings(feats, opts());
    assert.strictEqual(full.count, 2, 'hide_3d is skipped');
    let peak = -1, eaves = 0; for (let i = 1; i < full.pos.length; i += 3) { peak = Math.max(peak, full.pos[i]); if (full.pos[i] > 101 && full.pos[i] < 105.5) eaves++; }
    assert.ok(peak === 106 && eaves > 0, 'a gabled roof: the eaves sit below the ridge at the full height');
    const lod = O.buildBuildings(feats, opts({ minArea: 50, simple: true }));
    assert.strictEqual(lod.count, 1, 'the shed is dropped at a distance');
    let peak2 = -1; for (let i = 1; i < lod.pos.length; i += 3) peak2 = Math.max(peak2, lod.pos[i]);
    assert.strictEqual(peak2, 106, 'simple LOD has flat roofs');
  },
  buildingsSitOnSlopingGround() {
    const feats = O.decodeTile(tile({ building: [{ type: 3, props: { render_height: 10 }, rings: [sq(0, 0, 40)] }] })).building.features;
    const m = O.buildBuildings(feats, opts({ groundAt: (x, z) => 100 + x }));   // 20 m rise across it
    let bottom = 1e9; for (let i = 1; i < m.pos.length; i += 3) bottom = Math.min(bottom, m.pos[i]);
    assert.ok(bottom <= 99, 'the low side is still in the ground: ' + bottom);
  },
  coloursComeFromTheTagOrTheHeight() {
    const own = O.buildingColours({ colour: '#ff0000' }, 10, 0, 0).wall;
    assert.ok(own[0] > 0.99 && own[1] < 0.4);
    assert.ok(O.buildingColours({}, 80, 3, 4).wall.every(v => v >= 0 && v <= 1));
    assert.strictEqual(O.buildingHeight({}), 7);
    assert.strictEqual(O.buildingHeight({ render_height: 120 }), 120);
  },
  overlayStyles() {
    assert.ok(O.overlayStyle('water', { class: 'lake' }).fill);
    assert.ok(O.overlayStyle('transportation', { class: 'motorway' }).width > O.overlayStyle('transportation', { class: 'service' }).width);
    assert.strictEqual(O.overlayStyle('transportation', { class: 'primary', brunnel: 'tunnel' }), null);
    assert.strictEqual(O.overlayStyle('transportation', { class: 'path' }), null, 'footpaths are not painted');
    assert.ok(O.overlayStyle('aeroway', { class: 'runway' }).width >= 30);
    assert.ok(O.overlayStyle('aeroway', { class: 'apron', _poly: true }).fill);
  },
  treesOnlyInWoodsAndParks() {
    const L = O.decodeTile(tile({
      landcover: [{ type: 3, props: { class: 'wood' }, rings: [sq(0, 0, 1000)] }, { type: 3, props: { class: 'farmland' }, rings: [sq(2000, 2000, 1000)] }],
    }), O.LAYERS);
    const pts = O.treePoints(L, 200, 7);
    assert.strictEqual(pts.length, 200);
    assert.ok(pts.every(p => p[0] >= 0 && p[0] <= 1000 && p[1] >= 0 && p[1] <= 1000));
    assert.deepStrictEqual(O.treePoints(L, 200, 7), pts, 'seeded: the same trees every visit');
    assert.strictEqual(O.treePoints({}, 50, 1).length, 0);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed');
process.exitCode = fail ? 1 : 0;
