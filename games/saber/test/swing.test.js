// Run: node games/saber/test/swing.test.js
// Big swings that start or end off-screen (above the head, at the floor, far to the sides) must cut
// the block they pass through, in the direction the blade really moves, and only when the drawn
// blade is actually over the drawn block.
'use strict';
const assert = require('assert');
const { bladeScreenPath, pathSweepHits, qpowFollow } = require('../sweep.js');

const D = Math.PI / 180;
const v = (x, y, z) => ({ x, y, z });
// camera at the origin looking down -z, 68 deg vertical field of view (like the game)
const F = 1 / Math.tan(34 * D);
const CAM = { view: p => p, f: F, near: 0.3 };
const screen = p => ({ x: F * p.x / -p.z, y: F * p.y / -p.z });
// blade direction from yaw (left +) and pitch (up +), like the phone's forward
const dirOf = (yaw, pitch) => v(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const HILT = v(0.3, -0.75, -0.6);      // below and just in front of the eye, like the arm model's hilt
const FROM = 0.35, LEN = 3.5;
const BLOCK = v(0.3, 0.05, -3.5), HALF = 0.29;
function blockRect(c, half) {
  const ctr = screen(c), e = screen(v(c.x + half, c.y + half, c.z));
  const hs = Math.max(Math.abs(e.x - ctr.x), Math.abs(e.y - ctr.y));
  return { cx: ctr.x, cy: ctr.y, hw: hs, hh: hs };
}
const RECT = blockRect(BLOCK, HALF);
const aimPitch = Math.atan2(BLOCK.y - HILT.y, HILT.z - BLOCK.z), aimYaw = 0;

/** Play a sequence of (yaw, pitch) frames; return every frame that reports a hit. */
function swing(frames, hilt = () => HILT) {
  const hits = [];
  for (let i = 1; i < frames.length; i++) {
    const [y0, p0] = frames[i - 1], [y1, p1] = frames[i];
    const path = bladeScreenPath(hilt(i - 1), dirOf(y0, p0), hilt(i), dirOf(y1, p1), FROM, LEN, CAM);
    const r = pathSweepHits(path, RECT);
    if (r.hit) hits.push(Object.assign({ frame: i, pitch: p0 + (p1 - p0) * r.f, yaw: y0 + (y1 - y0) * r.f }, r));
  }
  return hits;
}
const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
const angleOf = m => Math.atan2(m.y, m.x);
const add = (a, b, k) => v(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const unit = a => { const l = Math.hypot(a.x, a.y, a.z); return v(a.x / l, a.y / l, a.z / l); };

/** Ground truth, independent of the sweep: is any visible blade point drawn inside the rect? */
function truthOverlap(h, d) {
  for (let i = 0; i <= 400; i++) {
    const p = add(h, d, FROM + (LEN - FROM) * i / 400);
    if (-p.z < CAM.near) continue;
    const q = screen(p);
    if (Math.abs(q.x - RECT.cx) <= RECT.hw && Math.abs(q.y - RECT.cy) <= RECT.hh) return true;
  }
  return false;
}
/** Frames during which the drawn blade really passes over the drawn block (finely sampled). */
function truthFrames(frames, hilt = () => HILT) {
  const out = [];
  for (let i = 1; i < frames.length; i++) {
    const d0 = dirOf(...frames[i - 1]), d1 = dirOf(...frames[i]);
    for (let k = 0; k <= 300; k++) {
      const f = k / 300, h = add(hilt(i - 1), add(hilt(i), hilt(i - 1), -1), f);
      if (truthOverlap(h, unit(add(d0, add(d1, d0, -1), f)))) { out.push(i); break; }
    }
  }
  return out;
}
function assertMatchesTruth(frames, hits, hilt) {
  assert.deepStrictEqual(hits.map(h => h.frame), truthFrames(frames, hilt), 'cuts only where the drawn blade crosses the drawn block');
}
function assertDirection(hits, want, wantAngle, tol = 35 * D) {
  assert.ok(hits.length >= 1, 'the swing through the block must cut it');
  const h = hits[0];
  assert.strictEqual(h.dir, want, 'first contact direction ' + h.dir + ' at frame ' + h.frame + ' ' + JSON.stringify(h.motion));
  let err = Math.abs(angleOf(h.motion) - wantAngle); if (err > Math.PI) err = 2 * Math.PI - err;
  assert.ok(err < tol, 'motion angle off by ' + (err / D).toFixed(1) + ' deg');
}
// a planar swing through the block: blade turns about the hilt from aim + 100 deg along w to aim - 100 deg
function planar(wScreen, n = 16) {
  const aim = unit(add(BLOCK, HILT, -1));
  let w = v(wScreen.x, wScreen.y, 0);
  w = unit(add(w, aim, -(w.x * aim.x + w.y * aim.y + w.z * aim.z)));
  return lin(100 * D, -100 * D, n).map(t => {
    const d = add(add(v(0, 0, 0), aim, Math.cos(t)), w, Math.sin(t));
    return [Math.atan2(-d.x, -d.z), Math.asin(d.y)];
  });
}

const tests = {
  overheadSwingFromBehindTheHeadCutsDown() {
    // starts pointing up and back over the head (tip behind the camera), ends at the floor
    const frames = lin(150 * D, -60 * D, 14).map(p => [aimYaw, p]);
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    assertDirection(hits, 'down', -90 * D);
  },
  swingUpFromTheFloorCutsUp() {
    const frames = lin(-120 * D, 80 * D, 14).map(p => [aimYaw, p]);
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    assertDirection(hits, 'up', 90 * D);
  },
  bigOverTheTopFrameStepIsNotACut() {
    // one fast frame from up-and-back (tip behind the camera) to above the screen top: the old
    // two-pose projection mirrored the tip and swept the whole screen; the blade never got near
    const frames = [[aimYaw, 120 * D], [aimYaw, 75 * D]];
    assert.deepStrictEqual(truthFrames(frames), []);
    assert.strictEqual(swing(frames).length, 0);
  },
  wideSideSwingRightToLeftCutsLeft() {
    const frames = lin(-130 * D, 120 * D, 16).map(y => [y, aimPitch]);
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    assertDirection(hits, 'left', 180 * D);
  },
  wideSideSwingLeftToRightCutsRight() {
    const frames = lin(120 * D, -130 * D, 16).map(y => [y, aimPitch]);
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    assertDirection(hits, 'right', 0);
  },
  planarDownSwingFromOffScreenCutsDown() {
    const frames = planar(v(0, 1, 0));
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    assertDirection(hits, 'down', -90 * D);
  },
  planarDiagonalSwingFromOffScreenCornerCutsDiagonally() {
    // from far up-left (off screen) to far down-right (off screen), through the block
    const frames = planar(v(-1, 1, 0));
    const hits = swing(frames);
    assertMatchesTruth(frames, hits);
    const a = angleOf(hits[0].motion) / D;
    assert.ok(a < -20 && a > -70, 'down-right motion, got ' + a.toFixed(0) + ' deg');
  },
  planarSwingsInAllFourDirections() {
    const want = [[0, 1, 'down', -90], [0, -1, 'up', 90], [1, 0, 'left', 180], [-1, 0, 'right', 0]];
    want.forEach(([x, y, name, ang]) => {
      const frames = planar(v(x, y, 0), 12);
      const hits = swing(frames);
      assertMatchesTruth(frames, hits);
      assertDirection(hits, name, ang * D);
    });
  },
  bladeWhollyBehindTheCameraNeverCuts() {
    const hits = swing(lin(150 * D, 210 * D, 6).map(p => [aimYaw, p]));
    assert.strictEqual(hits.length, 0);
  },
  swingThatComesBackFromAboveAndStopsShortIsNotACut() {
    // the blade returns from overhead and stops above the block: no contact
    const frames = lin(140 * D, 60 * D, 10).map(p => [aimYaw, p]);
    assert.deepStrictEqual(truthFrames(frames), []);
    assert.strictEqual(swing(frames).length, 0);
  },
  translationOnlyStillCuts() {
    // the arm slides the whole blade sideways without turning it
    const frames = [[aimYaw, aimPitch], [aimYaw, aimPitch], [aimYaw, aimPitch]];
    const hilt = i => v(HILT.x - 0.8 + 0.8 * i, HILT.y, HILT.z);
    const hits = swing(frames, hilt);
    assertMatchesTruth(frames, hits, hilt);
    assertDirection(hits, 'right', 0);
  },

  // ---- arm model continuity: a twisted wrist pointing far up or down must not snap the elbow ----
  qpowFollowIsContinuousThroughHalfTurnAndBack() {
    // rotation about a fixed axis 120 -> 240 -> 60 deg; the phone sends w >= 0, so q flips sign at
    // 180 deg. The partial rotation must move smoothly the whole way, and end back on the short way.
    const ax = v(0, 0.6, 0.8);
    const q = deg => { const h = deg * D / 2, s = Math.sin(h); let r = { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(h) }; if (r.w < 0) r = { x: -r.x, y: -r.y, z: -r.z, w: -r.w }; return r; };
    const signedAngle = p => { const a = 2 * Math.acos(Math.max(-1, Math.min(1, Math.abs(p.w)))) * Math.sign(p.w || 1); return a * Math.sign(p.x * ax.x + p.y * ax.y + p.z * ax.z || 1); };
    const st = {};
    const path = lin(120, 240, 120).concat(lin(240, 60, 180), lin(60, 330, 270));
    let last = null;
    path.forEach(d => {
      const p = qpowFollow(q(d), 0.4, st, 0.02);
      // compare as rotations: the angle between this partial rotation and the last one
      if (last) {
        const dot = Math.abs(p.x * last.x + p.y * last.y + p.z * last.z + p.w * last.w);
        const step = 2 * Math.acos(Math.min(1, dot)) / D;
        assert.ok(step < 4, 'elbow jumped ' + step.toFixed(1) + ' deg at ' + d.toFixed(0) + ' deg');
      }
      last = p;
    });
    const end = signedAngle(last) / D;
    // ends at 330 deg = -30 deg the short way: the elbow has eased back to -12 deg, not 132
    assert.ok(Math.abs(end - 0.4 * -30) < 0.5, 'back on the short way at the end: ' + end.toFixed(1));
  },
  qpowFollowMatchesShortWayWhenFresh() {
    const s = Math.sin(0.5), q = { x: s, y: 0, z: 0, w: Math.cos(0.5) };
    const r = qpowFollow(q, 0.4, {}, 0);
    assert.ok(Math.abs(r.x - Math.sin(0.2)) < 1e-9 && Math.abs(r.w - Math.cos(0.2)) < 1e-9);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
