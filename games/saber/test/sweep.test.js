// Run: node games/saber/test/sweep.test.js
'use strict';
const assert = require('assert');
const { bladeSweepHits } = require('../sweep.js');

const v = (x, y, z) => ({ x, y, z });
const BOX = v(0, 0, -1.5), HALF = 0.25;
// blade of length 3 pointing into the screen from hilt h, tilted by angle a (radians) about Y
const tipAt = (h, a) => v(h.x - 3 * Math.sin(a), h.y, h.z - 3 * Math.cos(a));

const tests = {
  pureTranslationThroughBlockIsHit() {
    // the whole blade slides left to right, no rotation; neither end pose touches the box
    const hp = v(-1, 0, 0), hn = v(1, 0, 0);
    const r = bladeSweepHits(hp, tipAt(hp, 0), hn, tipAt(hn, 0), BOX, HALF);
    assert.strictEqual(r.hit, true);
    assert.strictEqual(r.dir, 'right');
  },
  pureRotationThroughBlockIsHit() {
    const h = v(0, 0, 0);
    const r = bladeSweepHits(h, tipAt(h, 0.4), h, tipAt(h, -0.4), BOX, HALF);
    assert.strictEqual(r.hit, true);
    assert.strictEqual(r.dir, 'right');
  },
  translationBesideBlockIsMiss() {
    const hp = v(0.6, 0, 0), hn = v(2, 0, 0);
    const r = bladeSweepHits(hp, tipAt(hp, 0), hn, tipAt(hn, 0), BOX, HALF);
    assert.strictEqual(r.hit, false);
  },
  rotationPassingAboveBlockIsMiss() {
    const h = v(0, 0.6, 0);
    const r = bladeSweepHits(h, tipAt(h, 0.4), h, tipAt(h, -0.4), BOX, HALF);
    assert.strictEqual(r.hit, false);
  },
  bladeTooShortToReachIsMiss() {
    const h = v(0, 0, 3); // the tip stops at z = 0, well short of the box
    const r = bladeSweepHits(h, tipAt(h, 0.4), h, tipAt(h, -0.4), BOX, HALF);
    assert.strictEqual(r.hit, false);
  },
  rightToLeftReportsLeft() {
    const hp = v(1, 0, 0), hn = v(-1, 0, 0);
    const r = bladeSweepHits(hp, tipAt(hp, 0), hn, tipAt(hn, 0), BOX, HALF);
    assert.strictEqual(r.hit, true);
    assert.strictEqual(r.dir, 'left');
    assert(r.motion.x < 0, 'motion.x ' + r.motion.x);
  },
  topToBottomReportsDown() {
    const hp = v(0, 1, 0), hn = v(0, -1, 0);
    const r = bladeSweepHits(hp, v(0, 1, -3), hn, v(0, -1, -3), BOX, HALF);
    assert.strictEqual(r.hit, true);
    assert.strictEqual(r.dir, 'down');
  },
  combinedSwingReportsContactPointInsideBox() {
    // arm-model style: hand translates right while the blade also turns right
    const hp = v(-0.4, 0, 0), hn = v(0.4, 0, 0);
    const r = bladeSweepHits(hp, tipAt(hp, 0.3), hn, tipAt(hn, -0.3), BOX, HALF);
    assert.strictEqual(r.hit, true);
    assert.strictEqual(r.dir, 'right');
    assert(r.f >= 0 && r.f <= 1, 'f ' + r.f);
    const p = r.point;
    assert(Math.abs(p.x - BOX.x) <= HALF + 1e-6 && Math.abs(p.y - BOX.y) <= HALF + 1e-6 && Math.abs(p.z - BOX.z) <= HALF + 1e-6,
      'contact ' + JSON.stringify(p));
  },
  stillBladeInsideBoxIsNotACut() {
    // resting inside a block without moving must not count as a cut
    const h = v(0, 0, 0);
    const r = bladeSweepHits(h, tipAt(h, 0), h, tipAt(h, 0), BOX, HALF);
    assert.strictEqual(r.hit, false);
  },

  // ---- screen-space cuts: what you see on screen is what counts ----
  screenSweepAcrossBlockIsHit() {
    const { screenSweepHits } = require('../sweep.js');
    const p = (x, y) => ({ x, y });
    // vertical blade segment slides from left of the block to right of it
    const r = screenSweepHits(p(-0.5, -0.6), p(-0.5, 0.6), p(0.5, -0.6), p(0.5, 0.6), { cx: 0, cy: 0, hw: 0.1, hh: 0.1 });
    assert.strictEqual(r.hit, true);
    assert.ok(r.f > 0.3 && r.f < 0.7, 'contact mid-swing, f=' + r.f);
  },
  screenSweepBesideBlockIsMiss() {
    const { screenSweepHits } = require('../sweep.js');
    const p = (x, y) => ({ x, y });
    // same slide but the blade spans only y 0.3..0.9, above the block
    const r = screenSweepHits(p(-0.5, 0.3), p(-0.5, 0.9), p(0.5, 0.3), p(0.5, 0.9), { cx: 0, cy: 0, hw: 0.1, hh: 0.1 });
    assert.strictEqual(r.hit, false);
  },
  screenSweepFastJumpStillHits() {
    const { screenSweepHits } = require('../sweep.js');
    const p = (x, y) => ({ x, y });
    // a very fast swing: the blade is far left one frame, far right the next
    const r = screenSweepHits(p(-3, -1), p(-3, 1), p(3, -1), p(3, 1), { cx: 0.2, cy: 0, hw: 0.05, hh: 0.05 });
    assert.strictEqual(r.hit, true);
  },
  screenSweepRotationAboutHiltHits() {
    const { screenSweepHits } = require('../sweep.js');
    const p = (x, y) => ({ x, y });
    // blade pivots about its bottom end from pointing up-left to up-right, passing over a block above
    const r = screenSweepHits(p(0, -0.8), p(-0.7, 0.5), p(0, -0.8), p(0.7, 0.5), { cx: 0, cy: 0.3, hw: 0.08, hh: 0.08 });
    assert.strictEqual(r.hit, true);
  },
  screenStillBladeOverBlockIsNotACut() {
    const { screenSweepHits } = require('../sweep.js');
    const p = (x, y) => ({ x, y });
    const r = screenSweepHits(p(0, -1), p(0, 1), p(0, -1), p(0, 1), { cx: 0, cy: 0, hw: 0.1, hh: 0.1 });
    assert.strictEqual(r.hit, false);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
