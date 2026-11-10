// The user's first real phone recording (Grip, 11 throws), replayed through the game's input
// path (tools/replay.js). Skipped if the recording is not on this machine.
// Run: node games/bowling/test/replay.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const REC = path.join(__dirname, '..', '..', '..', 'recordings', 'bowling-20261110-013751');
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
if (!fs.existsSync(path.join(REC, 'input.ndjson'))) {
  console.log('  skip (no recording at ' + REC + ')\n\n0 passed, 0 failed');
  process.exit(0);
}
const RP = require(path.join(__dirname, '..', 'tools', 'replay.js'));
const lines = RP.load(REC);
const legacy = RP.replay(lines, { legacy: true });
const now = RP.replay(lines, { arm: true, keyup: true, aim: 1 });   // the lane frame and the hand's position (arm-model velocity)
const meas = RP.replay(lines, { keyup: true, aim: 1 });   // the same, the ball leaving with the hand's measured velocity (v5: at the key-up, 1:1)

// the replay is faithful: the old path reproduces what the game logged at the time
check('all 11 recorded throws are found and replayed', legacy.length === 11 && now.length === 11, [legacy.length, now.length]);
const off = legacy.filter(r => r.was && r.kmh > 10).map(r => [Math.abs(r.kmh - r.was.kmh), Math.abs(r.loft - r.was.loft_deg), Math.abs(r.board - r.was.board)]);
check('the old path replayed matches the logged real swings (speed < 3 km/h, loft < 15 deg, board < 2)', off.length >= 7 && off.every(([s, l, b]) => s < 3 && l < 15 && b < 2), off);
check('...and shows the bug: real swings released 1-25 boards into the right half or the gutter (board < 11)', legacy.filter(r => r.kmh > 10 && r.board < 11).length >= 5, legacy.map(r => +r.board.toFixed(1)));

// the new path: no align, the lane frame from the phone, the hand in the swing plane
const swings = now.filter(r => r.kmh > 10);
const normal = swings.filter(r => Math.abs(r.loft) < 35);
check('every normal real swing (loft < 35 deg) now leaves the hand near the bowling shoulder (boards 11-16, was 2.6-14.4)', normal.length >= 4 && normal.every(r => r.board > 11 && r.board < 16), normal.map(r => +r.board.toFixed(1)));
check('...and no real swing starts in a gutter (boards 1-39)', swings.every(r => r.board > 1 && r.board < 39), swings.map(r => +r.board.toFixed(1)));
check('...with the lane taken at every grip (forearm + REF.HOLD, v6)', now.every(r => r.src === 'grip'), now.map(r => r.src));
// v4: in this session the phone's own zero happened to be straight for the low, clean swings
const zero = RP.replay(lines, { zero: true, arm: true, keyup: true, aim: 1 }).filter(r => r.kmh > 10 && Math.abs(r.loft) < 20);
const zmean = zero.reduce((a, r) => a + r.heading, 0) / zero.length;
check('(v4) with the phone zero as the lane, the low, clean swings (loft < 20 deg) came out straight-ish: mean within 3 deg, each within 6', zero.length >= 3 && Math.abs(zmean) < 3 && zero.every(r => Math.abs(r.heading) < 6), zero.map(r => +r.heading.toFixed(1)));
// the raw forearm at the grip as "straight" turns those same swings ~15 deg left: REF.HOLD
const grip = RP.replay(lines, { grip: true, arm: true, keyup: true, aim: 1 }).filter(r => r.kmh > 10 && Math.abs(r.loft) < 20);
const gmean = grip.reduce((a, r) => a + r.heading, 0) / grip.length;
check('...the raw forearm at the grip as straight turns them ~15 deg left (the phone sits turned in the fist: REF.HOLD)', gmean > 8, +gmean.toFixed(1));

// the hand's measured velocity (kin.js handVelocity): the accelerometer over the downswing only
const K = require(path.join(__dirname, '..', 'kin.js'));
const real = meas.filter(r => r.modelKmh > 10);
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
check('every real swing (8) leaves with the measured hand velocity, integrated from the backswing apex 0.2-0.65 s before the release',
  real.length === 8 && real.every(r => r.vSrc === 'hand' && r.anchorMs < -200 && r.anchorMs > -650), real.map(r => [r.vSrc, Math.round(r.anchorMs)]));
check('...at 10-19 km/h, this player\'s real hand speeds (the rigid arm said 15-36)', real.every(r => r.kmh > 10 && r.kmh < 19), real.map(r => +r.kmh.toFixed(1)));
check('...the rigid arm overstated them (median 1.4x+): the wrist is not part of a rigid arm', median(real.map(r => r.modelKmh / r.kmh)) > 1.4, real.map(r => +(r.modelKmh / r.kmh).toFixed(2)));
const armRows = now.filter(r => r.kmh > 10);
check('lofts come down: median |loft| under 0.7x the rigid arm\'s', median(real.map(r => Math.abs(r.loft))) < 0.7 * median(armRows.map(r => Math.abs(r.loft))),
  [real.map(r => Math.round(r.loft)), armRows.map(r => Math.round(r.loft))]);
const bottom = real.filter((r, i) => Math.abs(armRows[i].loft) < 35 && Math.abs(r.heading) < 10);
check('...the swings let go near the bottom (4) leave nearly level (|loft| < 16 deg), as an underhand release does', bottom.length === 4 && bottom.every(r => Math.abs(r.loft) < 16), bottom.map(r => Math.round(r.loft)));

// drift, checked on the recording itself
const S = lines.filter(e => e.k === 'ev' && e.name === 'm').map(e => ({ t: e.st, q: K.decodePad(e.ax), acc: e.ax.slice(3, 6) }));
const ref = K.laneRef(0);
const armV = t => { const f = K.fitRelease(S, t, ref, 40); return f ? f.v : null; };
const quiet = [];
for (let i = 0; i < S.length - 200; i += 37) {
  const t0 = S[i].t, t1 = t0 + 500, o0 = K.fitOmega(S, t0, 40, 40), o1 = K.fitOmega(S, t1, 40, 40), a0 = armV(t0), a1 = armV(t1);
  if (!o0 || !o1 || !a0 || !a1 || K.len(o0.w) > 0.3 || K.len(o1.w) > 0.3 || K.len(a0) > 0.1 || K.len(a1) > 0.1) continue;
  const h = K.handVelocity(S, t1, ref, { anchor: t0 });
  if (h) quiet.push(K.len(K.sub(h.v, a1)));
}
quiet.sort((a, b) => a - b);
check('drift in 0.5 s of a quiet hand (bias, noise, gravity removal) stays small: p90 < 0.15 m/s', quiet.length > 50 && quiet[(quiet.length * 0.9) | 0] < 0.15,
  { n: quiet.length, median: +quiet[quiet.length >> 1].toFixed(3), p90: +quiet[(quiet.length * 0.9) | 0].toFixed(3) });
// through a whole swing: apex -> release -> top of the follow-through, where the arm is at rest again
function closure(o) {
  let sq = 0;
  for (const r of real) {
    const h = K.handVelocity(S, r.tRel, ref, o);
    let B = 0, b = Infinity;
    for (let t = r.tRel + 120; t < r.tRel + 500; t += 4) { const v = armV(t); if (v && K.len(v) < b) { b = K.len(v); B = t; } }
    const e = K.sub(K.handVelocity(S, B, ref, Object.assign({ anchor: h.t0 }, o)).v, armV(B));
    sq += K.dot(e, e);
  }
  return Math.sqrt(sq / real.length);
}
const c20 = closure({}), c0 = closure({ LAG: 0 }), c40 = closure({ LAG: 40 });
check('the accelerometer lag (HAND.LAG 20 ms) is the one the recording shows: the swing closes better than with 0 or 40 ms', c20 < c0 && c20 < c40, [c20, c0, c40].map(x => +x.toFixed(2)));
check('KNOWN WEAK: a whole swing (0.6-0.9 s, through the 3-6 g bottom twice) still misses rest by < 0.9 m/s rms (not the 0.15 a quiet hand gets)', c20 < 0.9, +c20.toFixed(2));

// v6, the second session (2026-11-10 03:23): the phone zero was set ~20 deg off where this player
// swings; the forearm at the grip was not (its offset is the same as in the first session)
const REC2 = path.join(__dirname, '..', '..', '..', 'recordings', 'bowling-20261110-032317');
if (fs.existsSync(path.join(REC2, 'input.ndjson'))) {
  const l2 = RP.load(REC2);
  const real2 = o => RP.replay(l2, o).filter(r => r.modelKmh > 10);
  const v6 = { keyup: true, aim: 1 };
  const z2 = real2({ zero: true, keyup: true, aim: 1 }), g2 = real2(v6), g1 = RP.replay(lines, v6).filter(r => r.modelKmh > 10);
  check('(03:23) with the phone zero as the lane, 8 of 9 real swings head 11-39 deg left (median > 12): all gutters', median(z2.map(r => r.heading)) > 12 && z2.filter(r => r.heading > 10).length >= 8, z2.map(r => +r.heading.toFixed(1)));
  check('v6 (grip + HOLD): the median heading of the real swings is within 4 deg of straight in BOTH sessions', Math.abs(median(g2.map(r => r.heading))) < 4 && Math.abs(median(g1.map(r => r.heading))) < 4,
    [median(g1.map(r => r.heading)), median(g2.map(r => r.heading))].map(x => +x.toFixed(1)));
  check('(03:23) throw 3: an isolated 7.78 g reading is not a clipped one (8 g): measured, ~20 km/h (the arm model said 34)', !!g2[2] && g2[2].vSrc === 'hand' && g2[2].kmh > 17 && g2[2].kmh < 23, g2[2] && [g2[2].vSrc, +g2[2].kmh.toFixed(1)]);
  // v7 defaults (release at the bottom, AIM NORMAL 0.4) on both sessions
  const d1 = RP.replay(lines, {}).filter(r => r.modelKmh > 10), d2 = real2({});
  const both = d1.concat(d2);
  const inWin = both.filter(r => r.rel.lag != null && r.rel.lag <= 150);
  check('v7: every real swing let go 0-150 ms after the bottom (9 of them; the rest let go before it, or 155 ms late) leaves from the bottom, level (|loft| < 3 deg; at the key-up those were lofted 0-41)',
    inWin.length >= 8 && inWin.every(r => r.rel.mode === 'bottom' && Math.abs(r.loft) < 3), inWin.map(r => [Math.round(r.rel.lag), r.rel.mode, Math.round(r.loft)]));
  check('v7: the late ones (> 150 ms) still release at the key-up, lofted', both.filter(r => r.rel.mode === 'keyup' && r.rel.lag > 150).every(r => r.loft > 15),
    both.filter(r => r.rel.mode === 'keyup').map(r => [Math.round(r.rel.lag || 0), Math.round(r.loft)]));
  const pins = rs => rs.reduce((a, r) => a + r.roll.down, 0), gut = rs => rs.filter(r => r.roll.gutter || r.roll.dropped).length;
  const pro = RP.replay(lines, { aim: 1 }).filter(r => r.modelKmh > 10).concat(real2({ aim: 1 }));
  const bump = RP.replay(lines, { bumpers: true }).filter(r => r.modelKmh > 10).concat(real2({ bumpers: true }));
  check('v7: Normal aim knocks more pins than Pro over both sessions, and fewer gutters', pins(both) > pins(pro) && gut(both) < gut(pro), [pins(both), gut(both), pins(pro), gut(pro)]);
  check('v7: with bumpers no real swing ends in a gutter, and more pins fall', gut(bump.filter(r => !r.roll.dropped)) === 0 && pins(bump) > pins(both), [pins(bump), gut(bump)]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
