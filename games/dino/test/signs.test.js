// Run: node games/dino/test/signs.test.js  -- threat signposting maths and the render-scale governor
'use strict';
const assert = require('assert');
const S = require('../signs.js');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ` ${a} != ${b}`);

const t = {
  // ---------------------------------------------------------------- bearings (three.js yaw: +yaw turns left)
  relativeBearingIsSignedAndWrapped() {
    near(S.relBearing(0, 0.5), 0.5);
    near(S.relBearing(0, -0.5), -0.5);
    near(S.relBearing(3, -3), 2 * Math.PI - 6, 1e-9, 'wraps the short way');
  },
  bearingOfAPoint() {
    // looking down -z (yaw 0): a point to the left (-x) has a positive bearing
    assert.ok(S.bearingTo({ x: 0, z: 0 }, { x: -10, z: -10 }) > 0);
    near(S.bearingTo({ x: 0, z: 0 }, { x: 0, z: -10 }), 0);
  },
  calloutWords() {
    assert.strictEqual(S.side(0.1), 'ahead');
    assert.strictEqual(S.side(0.9), 'left');
    assert.strictEqual(S.side(-0.9), 'right');
    assert.strictEqual(S.side(2.8), 'behind');
  },
  // ---------------------------------------------------------------- edge arrows
  onScreenPointsNeedNoArrow() {
    assert.strictEqual(S.edgeArrow(0.2, -0.3, false), null);
  },
  offScreenPointsGetAnArrowOnTheEdgePointingAtThem() {
    const a = S.edgeArrow(3, 0, false, 0.08);
    near(a.x, 0.92); near(a.y, 0); near(a.ang, 0);
    const b = S.edgeArrow(-0.5, 4, false, 0.08);
    near(b.y, 0.92); assert.ok(b.x < 0 && b.x > -0.2, 'keeps the direction');
    near(b.ang, Math.atan2(4, -0.5));
  },
  pointsBehindTheCameraFlipToTheSideTheyAreOn() {
    // projected coords of a point behind the camera are mirrored: x = +0.3 means it is on the LEFT
    const a = S.edgeArrow(0.3, 0.1, true, 0.08);
    assert.ok(a.x < -0.9, 'pinned to the left edge');
    assert.ok(Math.abs(a.y) < 0.92);
  },
  // ---------------------------------------------------------------- hurt indicator
  hurtArrowPointsAtTheAttacker() {
    near(S.hurtAngle(0, 0), 0, 1e-9, 'straight ahead = up');
    near(S.hurtAngle(0, Math.PI / 2), -Math.PI / 2, 1e-9, 'from the left = pointing left (screen angle, clockwise +)');
  },
  // ---------------------------------------------------------------- render scale governor
  governorDropsResolutionWhenFramesAreSlow() {
    let g = S.governor({ min: 0.6, max: 1 });
    for (let i = 0; i < 120; i++) g = S.govern(g, 1 / 30, i / 30);
    assert.ok(g.scale < 1, 'went down: ' + g.scale);
    assert.ok(g.scale >= 0.6);
  },
  governorHoldsAtVsync() {
    let g = S.governor({ min: 0.6, max: 1 });
    for (let i = 0; i < 600; i++) g = S.govern(g, 1 / 60, i / 60);
    assert.strictEqual(g.scale, 1);
  },
  governorClimbsBackButRemembersALevelThatFailed() {
    let g = S.governor({ min: 0.6, max: 1 }), t = 0;
    for (let i = 0; i < 150; i++) { t += 1 / 30; g = S.govern(g, 1 / 30, t); }
    const low = g.scale;
    for (let i = 0; i < 60 * 8; i++) { t += 1 / 60; g = S.govern(g, 1 / 60, t); }
    assert.ok(g.scale > low, 'climbs when there is headroom');
    assert.ok(g.scale <= 1);
  },
  governorIgnoresSingleHitches() {
    let g = S.governor({ min: 0.6, max: 1 }), t = 0;
    for (let i = 0; i < 300; i++) { t += 1 / 60; g = S.govern(g, i === 100 ? 0.25 : 1 / 60, t); }
    assert.strictEqual(g.scale, 1);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, '\n     ', e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
