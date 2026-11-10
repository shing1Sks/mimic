// Run: node games/flight/test/missions.test.js  -- missions: rings, waypoints, landings, objectives
'use strict';
const assert = require('assert');
const Terrain = require('../terrain.js');
const M = require('../missions.js');

const T = Terrain.buildTerrain(7);
const defs = M.build(T);
const helpers = { onRunway: (id, x, z) => T.onRunway(x, z, T.AIRPORTS.find(a => a.id === id)) };
const P = o => Object.assign({ x: 0, y: 500, z: 0, onGround: false, gs: 50, agl: 300 }, o);

const t = {
  everyMissionIsDefined() {
    for (const id of ['rings', 'xc', 'crosswind', 'tour', 'night']) {
      const d = defs[id];
      assert.ok(d && d.name && d.blurb && d.steps.length, id);
      assert.ok(d.start && (d.start.kind === 'runway' || d.start.kind === 'air'), id + ' start');
    }
    assert.strictEqual(defs.crosswind.wind.fromDeg, 0, 'crosswind for runway 09 comes from the north');
    assert.ok(defs.night.hours > 20 || defs.night.hours < 5, 'night circuit is flown at night');
  },
  ringCourseClearsTheTerrain() {
    const rings = defs.rings.steps.filter(s => s.kind === 'ring');
    assert.ok(rings.length >= 8, 'at least 8 rings');
    let prev = { x: defs.rings.start.x, y: defs.rings.start.alt, z: defs.rings.start.z };
    for (const r of rings) {
      assert.ok(r.y - T.heightAt(r.x, r.z) > 40, 'ring centre at least 40 m above the ground');
      for (let k = 1; k < 20; k++) {           // the straight line between rings stays clear
        const f = k / 20, x = prev.x + (r.x - prev.x) * f, z = prev.z + (r.z - prev.z) * f, y = prev.y + (r.y - prev.y) * f;
        assert.ok(y - T.heightAt(x, z) > 15, 'leg clears terrain at ' + Math.round(x) + ',' + Math.round(z));
      }
      prev = r;
    }
  },
  ringCourseOnAnyTerrain() {
    // a synthetic V-shaped valley running north, rising 1 m per 10 m to the north (like real terrain fed from tiles)
    const T2 = { heightAt: (x, z) => 2000 + Math.abs(x) * 0.6 - z * 0.1 };
    const c = M.ringCourse(T2, 0, 0, 0, 8, 650, 90);
    assert.strictEqual(c.rings.length, 8);
    for (const r of c.rings) {
      assert.ok(Math.abs(r.x) < 900, 'follows the valley floor: ' + Math.round(r.x));
      assert.ok(r.y - T2.heightAt(r.x, r.z) >= 85, 'clears the ground by the margin');
    }
    assert.ok(c.startAlt >= c.rings[0].y - 60, 'starts within reach of ring 1');
  },
  flyingThroughARingCountsIt() {
    const st = M.start(defs.rings, helpers);
    const r = st.def.steps[0];
    const h = r.hdg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
    M.update(st, P({ x: r.x - fx * 30, y: r.y + 3, z: r.z - fz * 30 }), 0.5);
    const ev = M.update(st, P({ x: r.x + fx * 30, y: r.y + 3, z: r.z + fz * 30 }), 0.5);
    assert.ok(ev.some(e => e.type === 'step' && e.ok), JSON.stringify(ev));
    assert.strictEqual(st.i, 1); assert.strictEqual(st.passed, 1);
  },
  passingBesideARingIsAMiss() {
    const st = M.start(defs.rings, helpers);
    const r = st.def.steps[0];
    const h = r.hdg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const off = r.r * 2;                       // two radii to the right
    M.update(st, P({ x: r.x - fx * 30 + rx * off, y: r.y, z: r.z - fz * 30 + rz * off }), 0.5);
    const ev = M.update(st, P({ x: r.x + fx * 30 + rx * off, y: r.y, z: r.z + fz * 30 + rz * off }), 0.5);
    assert.ok(ev.some(e => e.type === 'step' && !e.ok), JSON.stringify(ev));
    assert.strictEqual(st.missed, 1); assert.strictEqual(st.i, 1);
  },
  aWideMissStillMovesTheRunOn() {
    // overshooting a turn by 400 m used to leave the run stuck on that ring (seen in a playtest)
    const st = M.start(defs.rings, helpers);
    const r = st.def.steps[0];
    const h = r.hdg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    M.update(st, P({ x: r.x - fx * 30 + rx * 400, y: r.y, z: r.z - fz * 30 + rz * 400 }), 0.5);
    M.update(st, P({ x: r.x + fx * 30 + rx * 400, y: r.y, z: r.z + fz * 30 + rz * 400 }), 0.5);
    assert.strictEqual(st.missed, 1); assert.strictEqual(st.i, 1);
  },
  crossingTheRingPlaneFarAwayIsIgnored() {
    const st = M.start(defs.rings, helpers);
    const r = st.def.steps[0];
    const h = r.hdg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    M.update(st, P({ x: r.x - fx * 30 + rx * 3000, y: r.y, z: r.z - fz * 30 + rz * 3000 }), 0.5);
    const ev = M.update(st, P({ x: r.x + fx * 30 + rx * 3000, y: r.y, z: r.z + fz * 30 + rz * 3000 }), 0.5);
    assert.strictEqual(ev.length, 0); assert.strictEqual(st.i, 0);
  },
  takeoffWaypointAndLandingSequence() {
    const st = M.start(defs.xc, helpers);
    assert.strictEqual(st.def.steps[0].kind, 'takeoff');
    M.update(st, P({ onGround: true, agl: 0, gs: 20 }), 0.1);
    assert.strictEqual(st.i, 0, 'still rolling');
    M.update(st, P({ onGround: false, agl: 40, gs: 35 }), 0.1);
    assert.strictEqual(st.i, 1, 'airborne counts as takeoff');
    const wp = st.def.steps[1];
    assert.strictEqual(wp.kind, 'waypoint');
    M.update(st, P({ x: wp.x + wp.r * 0.5, z: wp.z }), 0.1);
    assert.strictEqual(st.i, 2, 'inside the waypoint radius');
    while (st.def.steps[st.i].kind !== 'land') { const w = st.def.steps[st.i]; M.update(st, P({ x: w.x, z: w.z }), 0.1); }
    const ap = T.BROOK;
    M.update(st, P({ x: ap.runway.x, z: 0, onGround: true, gs: 10, agl: 0 }), 0.1);
    assert.ok(!st.done, 'still rolling out');
    const ev = M.update(st, P({ x: ap.runway.x, z: -100, onGround: true, gs: 1, agl: 0 }), 0.1);
    assert.ok(st.done && !st.failed && ev.some(e => e.type === 'complete'), JSON.stringify(ev));
  },
  stoppingOffTheRunwayIsNotALanding() {
    const st = M.start(defs.crosswind, helpers);
    M.update(st, P({ x: 0, z: 400, onGround: true, gs: 0.5, agl: 0 }), 0.1);
    assert.ok(!st.done || st.failed, 'stopped in the grass beside the runway');
  },
  objectiveGivesDistanceAndTurn() {
    const st = M.start(defs.tour, helpers);
    const wp = st.def.steps[0];
    // aircraft 2 km due west of the waypoint, flying north: the target is 90 deg to the right
    const o = M.objective(st, P({ x: wp.x - 2000, z: wp.z }), 0);
    assert.ok(Math.abs(o.distM - 2000) < 1, o.distM);
    assert.ok(Math.abs(o.relBearing - 90) < 1, o.relBearing);
    assert.ok(o.title && o.text && o.progress, JSON.stringify(o));
    const o2 = M.objective(st, P({ x: wp.x - 2000, z: wp.z }), 180);
    assert.ok(Math.abs(o2.relBearing + 90) < 1, 'flying south it is to the left: ' + o2.relBearing);
  },
  resultSummarises() {
    const st = M.start(defs.rings, helpers);
    st.passed = 7; st.missed = 3; st.t = 151; st.done = true;
    const r = M.result(st);
    assert.ok(r.title && r.rows.length && typeof r.score === 'number', JSON.stringify(r));
    assert.ok(r.rows.some(x => /7/.test(x[1])), 'reports the rings');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
