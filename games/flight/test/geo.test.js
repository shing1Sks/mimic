// Run: node games/flight/test/geo.test.js  -- real-world maths: tiles, terrarium, local frame, LOD, airports, runways
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const Geo = require('../geo.js');
const DB = Geo.loadAirports(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'airports.json'), 'utf8')));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (tol ${tol})`);

const t = {
  // ---------------------------------------------------------------- tile maths
  lonLatToTileKnownValues() {
    // z0 is one tile; the equator/prime meridian sits in the middle
    const c = Geo.lonLatToTile(0, 0, 0); near(c.x, 0.5, 1e-9); near(c.y, 0.5, 1e-9);
    // Bangalore HAL at z10 is tile 732 / 474
    const b = Geo.lonLatToTile(77.6682, 12.95, 10); assert.strictEqual(Math.floor(b.x), 732); assert.strictEqual(Math.floor(b.y), 474);
  },
  tileRoundTrip() {
    for (const [lon, lat] of [[77.6, 12.9], [-122.4, 37.6], [7.65, 45.97], [-157.9, 21.3]]) {
      const p = Geo.lonLatToTile(lon, lat, 13), q = Geo.tileToLonLat(p.x, p.y, 13);
      near(q.lon, lon, 1e-9); near(q.lat, lat, 1e-9);
    }
  },
  tileUrls() {
    assert.strictEqual(Geo.elevationUrl(10, 732, 478), 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/732/478.png');
    assert.strictEqual(Geo.imageryUrl(10, 732, 478), 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/10/478/732.jpg');
  },
  // ---------------------------------------------------------------- terrarium
  terrariumDecode() {
    assert.strictEqual(Geo.decodeTerrarium(128, 0, 0), 0);
    assert.strictEqual(Geo.decodeTerrarium(128, 3, 128), 3.5);
    near(Geo.decodeTerrarium(140, 197, 0), 12 * 256 + 197, 1e-9);   // 3269 m, about Leh
    assert.strictEqual(Geo.decodeTerrarium(0, 0, 0), -32768);
  },
  terrariumImage() {
    const px = new Uint8ClampedArray([128, 0, 0, 255, 128, 10, 0, 255, 129, 0, 0, 255, 127, 0, 0, 255]);
    const h = Geo.decodeTerrariumImage(px, 2, 2);
    assert.deepStrictEqual(Array.from(h), [0, 10, 256, -256]);
  },
  // ---------------------------------------------------------------- local frame
  localFrameIsMetres() {
    const F = Geo.frame(46.0, 7.65);
    const o = F.toLocal(7.65, 46.0); near(o.x, 0, 1e-6); near(o.z, 0, 1e-6);
    const n = F.toLocal(7.65, 46.0 + 1 / 111.2);     // ~1 km north
    near(n.z, -1000, 6, 'north is -z'); near(n.x, 0, 1e-6);
    const e = F.toLocal(7.65 + 1 / (111.32 * Math.cos(46 * Math.PI / 180)), 46.0);   // ~1 km east
    near(e.x, 1000, 6, 'east is +x');
    const back = F.toLonLat(e.x, e.z); near(back.lon, 7.65 + 1 / (111.32 * Math.cos(46 * Math.PI / 180)), 1e-9); near(back.lat, 46, 1e-9);
  },
  tileRectsTile() {
    const F = Geo.frame(12.95, 77.67);
    const t = Geo.lonLatToTile(77.67, 12.95, 12), tx = Math.floor(t.x), ty = Math.floor(t.y);
    const r = F.tileRect(12, tx, ty), right = F.tileRect(12, tx + 1, ty), child = F.tileRect(13, tx * 2 + 1, ty * 2 + 1);
    near(right.x0, r.x1, 1e-6, 'neighbours share an edge');
    near(child.x1, r.x1, 1e-6); near(child.z1, r.z1, 1e-6, 'children tile their parent');
    assert.ok(r.x0 <= 0 && r.x1 >= 0 && r.z0 <= 0 && r.z1 >= 0, 'the origin lies in its own tile');
    near(r.x1 - r.x0, 40075016.7 / 4096 * Math.cos(12.95 * Math.PI / 180), 1, 'tile width in metres');
  },
  // ---------------------------------------------------------------- LOD
  lodFineNearCoarseFar() {
    const F = Geo.frame(12.95, 77.67);
    const sel = Geo.selectTiles(F, { x: 0, z: 0, agl: 100 }, { rootZoom: 11, maxZoom: 14, radius: 45000, splitK: 1.6 });
    const at = (x, z) => sel.find(n => x >= n.rect.x0 && x < n.rect.x1 && z >= n.rect.z0 && z < n.rect.z1);
    assert.strictEqual(at(10, 10).z, 14, 'finest tiles under the aircraft');
    assert.ok(at(30000, 0).z <= 12, 'coarse tiles 30 km away');
    assert.ok(sel.length < 260, 'a bounded number of tiles: ' + sel.length);
  },
  lodLeavesDoNotOverlap() {
    const F = Geo.frame(46, 7.65);
    const sel = Geo.selectTiles(F, { x: 1234, z: -777, agl: 300 }, { rootZoom: 11, maxZoom: 14, radius: 30000, splitK: 1.6 });
    // sample a grid of points: each is covered by at most one leaf
    for (let x = -20000; x <= 20000; x += 1700) for (let z = -20000; z <= 20000; z += 1300) {
      const n = sel.filter(s => x >= s.rect.x0 && x < s.rect.x1 && z >= s.rect.z0 && z < s.rect.z1).length;
      assert.ok(n <= 1, `point ${x},${z} covered ${n} times`);
    }
  },
  lodHighAltitudeIsCoarser() {
    const F = Geo.frame(34.13, 77.55);
    const opt = { rootZoom: 11, maxZoom: 14, radius: 45000, splitK: 1.6 };
    const low = Geo.selectTiles(F, { x: 0, z: 0, agl: 50 }, opt), high = Geo.selectTiles(F, { x: 0, z: 0, agl: 12000 }, opt);
    assert.ok(Math.max(...high.map(n => n.z)) < 14 && high.length < low.length, 'fewer, coarser tiles from high up');
  },
  elevationSource() {
    // a z14 node reads its heights from a quarter-of-a-quarter of the z12 tile above it
    const s = Geo.elevationSource(14, 5 * 4 + 3, 7 * 4 + 1, 12);
    assert.deepStrictEqual([s.z, s.x, s.y], [12, 5, 7]);
    near(s.u0, 3 / 4, 1e-12); near(s.v0, 1 / 4, 1e-12); near(s.size, 1 / 4, 1e-12);
    const same = Geo.elevationSource(11, 9, 9, 12); assert.deepStrictEqual([same.z, same.u0, same.size], [11, 0, 1]);
  },
  bilinear() {
    const g = new Float32Array([0, 10, 20, 30]);   // 2 x 2
    near(Geo.sampleGrid(g, 2, 0.5, 0.5), 15, 1e-9); near(Geo.sampleGrid(g, 2, 1, 0), 10, 1e-9); near(Geo.sampleGrid(g, 2, 5, 5), 30, 1e-9);
  },
  // ---------------------------------------------------------------- airports
  findByIcaoIataAndName() {
    assert.strictEqual(Geo.findAirport(DB, 'VOBG').id, 'VOBG');
    assert.strictEqual(Geo.findAirport(DB, 'bom').id, 'VABB');
    assert.strictEqual(Geo.findAirport(DB, 'sfo').id, 'KSFO');
    assert.strictEqual(Geo.findAirport(DB, 'IXL').id, 'VILH');
    assert.strictEqual(Geo.findAirport(DB, 'Kushok').id, 'VILH');
    assert.strictEqual(Geo.findAirport(DB, 'LEH').id, 'LFOH', 'a 3-letter code is an IATA code first (Le Havre)');
    assert.strictEqual(Geo.findAirport(DB, 'zzzzqq'), null);
    assert.ok(Geo.searchAirports(DB, 'zurich', 5).some(a => a.id === 'LSZH'));
  },
  nearestAirports() {
    const n = Geo.nearestAirports(DB, 34.1359, 77.5465, 3, 50);
    assert.strictEqual(n[0].id, 'VILH'); assert.ok(n[0].km < 1);
    const hal = Geo.nearestAirports(DB, 12.95, 77.6682, 8, 60).map(a => a.id);
    assert.ok(hal.includes('VOBL'), 'Kempegowda is near HAL');
  },
  runwayGeometry() {
    const ap = Geo.findAirport(DB, 'VOBG'), F = Geo.frame(ap.lat, ap.lon);
    const rws = Geo.runwaysLocal(F, ap);
    const r = rws.find(x => x.name === '09');
    near(r.hdg, 85, 1.5, 'HAL 09 points east (85 deg true in the data)'); near(r.len, 3307, 70, 'length'); assert.ok(!r.approx);
    const r27 = rws.find(x => x.name === '27'); near(r27.hdg, 265, 1.5); near(r27.thr.x, r.end.x, 1e-6, 'the reciprocal starts where 09 ends');
    assert.ok(Geo.onRunway(r, (r.thr.x + r.end.x) / 2, (r.thr.z + r.end.z) / 2) && !Geo.onRunway(r, r.thr.x, r.thr.z + 200));
  },
  runwayBadEndsFallBack() {
    const ap = Geo.findAirport(DB, 'LSTZ');   // its two ends coincide in the data
    if (!ap) return;
    const r = Geo.runwaysLocal(Geo.frame(ap.lat, ap.lon), ap)[0];
    assert.ok(r.len > 400 && r.approx, 'a sane runway from the heading and length');
  },
  pickRunwayIntoWind() {
    const ap = Geo.findAirport(DB, 'VOBG'), F = Geo.frame(ap.lat, ap.lon);
    assert.strictEqual(Geo.pickRunway(Geo.runwaysLocal(F, ap), 270).name, '27', 'wind from the west: land/take off west');
    assert.strictEqual(Geo.pickRunway(Geo.runwaysLocal(F, ap), 80).name, '09');
    const sfo = Geo.findAirport(DB, 'KSFO');
    assert.ok(Geo.pickRunway(Geo.runwaysLocal(Geo.frame(sfo.lat, sfo.lon), sfo), 290).len > 3000, 'prefers a long runway');
  },
  // ---------------------------------------------------------------- locations
  presetsResolve() {
    assert.ok(Geo.PRESETS.length >= 7);
    for (const p of Geo.PRESETS) {
      assert.ok(p.id && p.name && p.blurb, p.id);
      const ap = Geo.findAirport(DB, p.airport); assert.ok(ap, p.id + ' airport ' + p.airport);
      for (const w of p.tour || []) assert.ok(Geo.haversineKm(ap.lat, ap.lon, w.lat, w.lon) < 120, p.id + ' waypoint ' + w.name + ' is near');
    }
    for (const id of ['blr', 'bom', 'leh', 'zermatt', 'sfo', 'gcn', 'hnl']) assert.ok(Geo.PRESETS.find(p => p.id === id), id);
  },
  challengesForALocation() {
    const loc = Geo.locationFor(DB, Geo.PRESETS.find(p => p.id === 'blr'));
    const ch = Geo.planChallenges(DB, loc, { windFromDeg: 270 });
    const ids = ch.map(c => c.id);
    for (const k of ['tour', 'hop', 'landing', 'free']) assert.ok(ids.includes(k), k);
    const hop = ch.find(c => c.id === 'hop');
    const dest = hop.steps[hop.steps.length - 1];
    assert.strictEqual(dest.kind, 'land'); assert.notStrictEqual(dest.airport, 'VOBG');
    assert.ok(hop.steps[0].kind === 'takeoff' && hop.distKm > 8 && hop.distKm < 90, 'a real hop: ' + hop.distKm);
    for (const c of ch) assert.ok(c.name && c.blurb && c.goal && c.goal.length < 90, c.id + ' explains itself in a line');
  },
  anyAirportGetsChallenges() {
    const loc = Geo.locationFor(DB, { airport: 'LSZH' });
    const ch = Geo.planChallenges(DB, loc, { windFromDeg: 250 });
    assert.ok(ch.find(c => c.id === 'landing') && ch.find(c => c.id === 'free'));
    assert.strictEqual(loc.start.runway.name, '28', 'Zurich into a westerly: runway 28');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
