// Run: node games/lib/test/wandcursor.test.js  -- the Wand as a menu cursor
'use strict';
const assert = require('assert');
const W = require('../wandcursor.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const t = {
  pointerMapsToScreen() {
    const p = W.toScreen({ x: 0, y: 0 }, 1000, 600);
    near(p.x, 500); near(p.y, 300);
    const tl = W.toScreen({ x: -1, y: 1 }, 1000, 600);   // pointing up-left
    near(tl.x, 0); near(tl.y, 0);
    const off = W.toScreen({ x: 1.2, y: -1.2 }, 1000, 600);
    assert.ok(off.x <= 999 && off.y <= 599, 'clamped onto the screen');
  },
  smoothingFollowsButCalmsJitter() {
    let s = { x: 0, y: 0 };
    s = W.smooth(s, { x: 100, y: 0 }, 1 / 60);
    assert.ok(s.x > 20 && s.x < 80, 'one frame moves part of the way: ' + s.x);
    for (let i = 0; i < 60; i++) s = W.smooth(s, { x: 100, y: 0 }, 1 / 60);
    near(s.x, 100, 0.5);
  },
  picksTheClickableUnderOrNear() {
    const btn = { id: 'b' };
    // fake hit test: the button covers x 100..200
    const hit = (x, y) => (x >= 100 && x <= 200 && y >= 50 && y <= 80) ? btn : null;
    assert.strictEqual(W.pick(150, 60, hit), btn, 'directly over');
    assert.strictEqual(W.pick(90, 60, hit), btn, 'just beside it still counts (forgiving)');
    assert.strictEqual(W.pick(10, 300, hit), null, 'far away is nothing');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
