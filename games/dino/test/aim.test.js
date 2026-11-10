// Run: node games/dino/test/aim.test.js  -- light-gun aim that never drifts from the phone
'use strict';
const assert = require('assert');
const A = require('../aim.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const stand = { yaw: 0, arc: 1.2, pitchMin: -0.4, pitchMax: 0.3, pitch: 0 };
const o = { sens: 1, scoped: false, hfx: 0.9, hfy: 0.6 };
const step = (s, dx, dy, opts) => A.step(s, dx, dy, 0.016, stand, Object.assign({}, o, opts || {}));
const t = {
  phoneTurnIsOneToOneInAngle() {
    // turn the phone 0.2 rad right and 0.1 rad down: the crosshair lands 0.2 rad right, 0.1 rad down
    const s = step(A.create(stand), 0, 0, { turn: { x: 0.2, y: 0.1 } });
    near(s.cx * o.hfx, 0.2); near(s.cy * o.hfy, 0.1); near(s.yaw, 0); near(s.pitch, 0);
  },
  phoneTurnPastTheEdgeKeepsTheWorldAngle() {
    // 0.9 rad right: the view pans, but the world direction under the crosshair is still 0.9 rad
    let s = A.create(stand);
    for (let i = 0; i < 9; i++) s = step(s, 0, 0, { turn: { x: 0.1, y: 0 } });
    near(s.yaw - s.cx * o.hfx, -0.9, 1e-9);
    for (let i = 0; i < 9; i++) s = step(s, 0, 0, { turn: { x: -0.1, y: 0 } });
    near(s.cx, 0, 1e-9); near(s.yaw, 0, 1e-9);
  },
  phoneTurnScopedIsAlsoOneToOne() {
    const s = step(A.create(stand), 0, 0, { scoped: true, turn: { x: 0.05, y: 0 } });
    near(s.yaw, -0.05); near(s.cx, 0);
  },
  phoneSensScalesTheTurn() {
    const a = step(A.create(stand), 0, 0, { turn: { x: 0.1, y: 0 }, phoneSens: 2 });
    near(a.cx * o.hfx, 0.2);
  },
  crosshairFollowsTheMouse() {
    const s = step(A.create(stand), 100, 50);
    assert.ok(s.cx > 0 && s.cy > 0, 'right/down moves the crosshair right/down');
    near(s.yaw, 0); near(s.pitch, 0);
  },
  noDriftAfterGoingPastTheEdge() {
    // the bug: turn far right (crosshair hits the edge, view pans), come back the same amount
    let s = A.create(stand);
    s = step(s, 450, 0); s = step(s, 450, 0);   // ~0.5 rad of phone: well past the screen edge
    assert.ok(s.yaw < 0, 'turned the view right');
    s = step(s, -450, 0); s = step(s, -450, 0);
    near(s.cx, 0, 1e-9); near(s.yaw, 0, 1e-9);
  },
  edgePansAndTheAimStaysContinuous() {
    // the world direction under the crosshair moves smoothly across the edge (no jump)
    const dir = s => s.yaw - s.cx * o.hfx;
    let prev = dir(A.create(stand)), s = A.create(stand);
    for (let i = 0; i < 40; i++) {
      s = step(s, 25, 0);
      const d = dir(s);
      assert.ok(prev - d > 0 && prev - d < 0.06, 'monotonic small steps: ' + (prev - d));
      prev = d;
    }
    assert.ok(s.yaw < 0 && Math.abs(s.cx) <= 1, 'panned');
  },
  aLittlePastTheArcIsStillRemembered() {
    // up to ~15 degrees beyond the stand's limit the phone and crosshair stay in step
    let s = A.create(stand);
    const toLimit = (1 + stand.arc / o.hfx) / 0.0022;     // counts to reach the limit
    s = step(s, toLimit + 100, 0);
    s = step(s, -(toLimit + 100), 0);
    near(s.cx, 0, 1e-9); near(s.yaw, 0, 1e-9);
  },
  staysInsideTheStandArc() {
    let s = A.create(stand);
    for (let i = 0; i < 100; i++) s = step(s, 500, 0);
    assert.ok(s.yaw >= -stand.arc - 1e-9 && s.cx <= 1);
    // after slamming into the limit, coming back starts moving straight away (no dead travel)
    const back = step(s, -200, 0);
    assert.ok(back.cx < s.cx || back.yaw > s.yaw, 'responds immediately on the way back');
  },
  scopedLooksWhereTheCrosshairWas() {
    let s = step(A.create(stand), 200, 0);
    const aimed = s.yaw - s.cx * o.hfx;
    const sc = step(s, 0, 0, { scoped: true });
    near(sc.cx, 0); near(sc.yaw, aimed, 1e-6);
    const turned = step(sc, 100, 0, { scoped: true });
    assert.ok(turned.yaw < sc.yaw && sc.yaw - turned.yaw < 0.08, 'scoped turning is slow and steady');
  },
  alignRecentres() {
    let s = step(A.create(stand), 700, -300);
    s = A.align(s, stand);
    near(s.cx, 0); near(s.cy, 0); near(s.yaw, 0); near(s.pitch, 0);
  },
  sensitivityScales() {
    const a = step(A.create(stand), 50, 0, { sens: 1 }).cx;
    const b = step(A.create(stand), 50, 0, { sens: 2 }).cx;
    near(b, 2 * a);
  },
  ndcIsCrosshairWithYUp() {
    const s = Object.assign(A.create(stand), { cx: 0.3, cy: 0.4 });
    const n = A.ndc(s);
    near(n.x, 0.3); near(n.y, -0.4);
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
