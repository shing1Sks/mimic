// The bowling release from synthetic overarm actions. Run: node games/cricket/test/bowl.test.js
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'bowl.js'));
const P = require(path.join(__dirname, '..', 'phys.js'));
const SY = require(path.join(__dirname, 'synth.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const rel = o => { const s = SY.overarm(o); return B.readRelease(s.samples, s.tUp); };
const AIM = { x: 0.1, len: 6 };
const seeded = () => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
/** Bowl it all the way: release -> delivery -> flight to the batter. */
function bowl(o, aim, gain) {
  const r = rel(o);
  const d = B.toDelivery(r, aim || AIM, { arm: 1, gain: gain || B.BOWL.GAIN.NORMAL, rng: seeded() });
  d.seamKick = 0;
  const b = B.launch(d);
  const run = P.run(b, { until: x => x.p.z >= 0, samples: false });
  return { r, d, pitch: run.pitch, end: run.end };
}

// --- the phone link and the arm
{
  const q = B.armQuat(0.4, 0.2, 0.7), back = B.decodePad(B.encodePad(q));
  check('pad axes round trip as mimic.js decodes them', Math.abs(back.x * q.x + back.y * q.y + back.z * q.z + back.w * q.w) > 0.99999);
  const up = B.rotate(B.armQuat(0, 0, 0), { x: 0, y: 0, z: -1 }), palm = B.rotate(B.armQuat(0, 0, 0), { x: 0, y: 1, z: 0 });
  check('arm straight up: phone top up, palm (screen) toward the TV', up.y > 0.999 && palm.z < -0.999, [up, palm]);
}

// --- pace from the arm
{
  const fast = rel({ peakW: 26 }), slow = rel({ peakW: 10 });
  check('a whipped arm (26 rad/s) bowls 130-158 km/h', fast.ok && fast.pace * 3.6 > 130 && fast.pace * 3.6 < 158, fast.pace * 3.6);
  check('a gentle arm (10 rad/s) bowls 65-95 km/h', slow.ok && slow.pace * 3.6 > 65 && slow.pace * 3.6 < 95, slow.pace * 3.6);
  check('pace grows with arm speed, monotonic', [10, 14, 18, 22].map(w => rel({ peakW: w }).pace).every((v, i, a) => !i || v > a[i - 1]));
  const lazy = rel({ peakW: 3 });
  check('a lazy wave (3 rad/s) is not a delivery', !lazy.ok && lazy.why === 'slow', lazy.why);
}

// --- length from when HOLD comes up
{
  const on = rel({ peakW: 20 });
  check('let go on time: release error ~0 (within 2 deg)', Math.abs(deg(on.elevErr)) < 2, deg(on.elevErr));
  const early = rel({ peakW: 20, upOffset: -40 }), late = rel({ peakW: 20, upOffset: 40 });
  check('let go 40 ms early: the ball leaves higher (fuller)', early.elevErr > rad(15), deg(early.elevErr));
  check('let go 40 ms late: lower (shorter)', late.elevErr < -rad(15), deg(late.elevErr));
  const bo = bowl({ peakW: 20 }), be = bowl({ peakW: 20, upOffset: -40 }), bl = bowl({ peakW: 20, upOffset: 40 });
  check('on time it pitches on the aimed spot (within 25 cm)', Math.abs(-bo.pitch.z - AIM.len) < 0.25, bo.pitch);
  check('early pitches fuller, late shorter (NORMAL control)', -be.pitch.z < AIM.len - 0.5 && -bl.pitch.z > AIM.len + 0.5, [be.pitch.z, bl.pitch.z]);
  check('...but NORMAL keeps it a sensible miss (under 4 m off)', AIM.len - (-be.pitch.z) < 4 && -bl.pitch.z - AIM.len < 4, [be.pitch.z, bl.pitch.z]);
  const pe = bowl({ peakW: 20, upOffset: -40 }, AIM, B.BOWL.GAIN.PRO);
  check('PRO control: the same early release goes much fuller (or a full toss)', !pe.pitch || -pe.pitch.z < -be.pitch.z - 1.5, pe.pitch);
  const under = SY.overarm({ peakW: 20, upOffset: 230 });
  const ru = B.readRelease(under.samples, under.tUp);
  check('let go with the arm already down by the hip: not a delivery (underarm)', !ru.ok && ru.why === 'underarm', [ru.why, ru.r && ru.r.y]);
}

// --- line from the swing plane
{
  const r = rel({ peakW: 20, yaw: rad(10) });
  check('arm swung 10 deg right of straight: heading +10 deg', Math.abs(deg(r.az) - 10) < 1, deg(r.az));
  const lean = rel({ peakW: 20, yaw: rad(10), lean: rad(25) });
  check('the phone rolled 25 deg in the fist does not move the line', Math.abs(deg(lean.az) - 10) < 1, deg(lean.az));
  const b = bowl({ peakW: 20, yaw: rad(10) }), s = bowl({ peakW: 20 });
  const off = b.end.p.x - s.end.p.x;
  check('NORMAL control: 10 deg right lands 0.4-1.5 m right at the stumps', off > 0.4 && off < 1.5, off);
  const pro = bowl({ peakW: 20, yaw: rad(10) }, AIM, B.BOWL.GAIN.PRO);
  check('PRO: 10 deg right is 10 deg right (>2.5 m)', pro.end.p.x - s.end.p.x > 2.5, pro.end.p.x - s.end.p.x);
  check('the ball travels toward the batter (+z) when the arm swings at the TV', b.end.p.z >= 0);
}

// --- spin from the wrist
{
  const cw = rel({ peakW: 13, twist: 25 }), ccw = rel({ peakW: 13, twist: -25 }), none = rel({ peakW: 13 });
  check('wrist twist clockwise reads + twist, anticlockwise -', cw.twist > 20 && ccw.twist < -20, [cw.twist, ccw.twist]);
  check('no twist: no spin', none.spin === 0, none.spin);
  check('25 rad/s of wrist: big spin (~1400 rpm+)', cw.spin * 60 / (2 * Math.PI) > 1300, cw.spin * 60 / (2 * Math.PI));
  check('spin scrambles the seam: no swing on a big spinner', Math.abs(cw.swing) < 0.05, cw.swing);
  const aim = { x: 0, len: 4.5 };
  const tc = bowl({ peakW: 13, twist: 25 }, aim), ta = bowl({ peakW: 13, twist: -25 }, aim), tn = bowl({ peakW: 13 }, aim);
  check('clockwise turns right off the pitch (bowler\'s view)', tc.end.p.x - tn.end.p.x > 0.1, tc.end.p.x - tn.end.p.x);
  check('anticlockwise turns left', ta.end.p.x - tn.end.p.x < -0.1, ta.end.p.x - tn.end.p.x);
  check('right-handed batter: turning right (to his off side) is a leg-break', B.describe({ pitch: tc.pitch, heightAtBat: 0.5 }, tc.d, 1).includes('LEG-BREAK'));
  check('...and for a left-hander the same ball is an off-break', B.describe({ pitch: tc.pitch, heightAtBat: 0.5 }, tc.d, -1).includes('OFF-BREAK'));
}

// --- swing from the seam
{
  const r = rel({ peakW: 22, rho0: rad(-25) });
  check('wrist turned so the palm faces 25 deg right: seam right, full swing right', r.swing > 0.8 && deg(r.alpha) > 20, [r.swing, deg(r.alpha)]);
  const l = rel({ peakW: 22, rho0: rad(25) });
  check('palm 25 deg left: swings left', l.swing < -0.8, l.swing);
  const sc = rel({ peakW: 22, rho0: rad(-80) });
  check('palm side-on (80 deg): scrambled seam, no swing', Math.abs(sc.swing) < 0.05, sc.swing);
  const b = bowl({ peakW: 22, rho0: rad(-25) }, { x: 0, len: 5 }), s = bowl({ peakW: 22 }, { x: 0, len: 5 });
  // the solver lands both on the spot; the swinger arrives there curving right, and keeps going
  check('a swinging ball still pitches on the spot', Math.abs(b.pitch.x - s.pitch.x) < 0.05, [b.pitch.x, s.pitch.x]);
  check('...and carries on right after it: past the stumps further right', b.end.p.x - s.end.p.x > 0.05, b.end.p.x - s.end.p.x);
  check('right-hander: swinging right (away) is outswing', B.describe({ pitch: b.pitch, heightAtBat: 0.6 }, b.d, 1).includes('OUTSWING'));
}

// --- the words for length
{
  const w = (z, h) => B.describe({ pitch: z === null ? null : { x: 0, z }, heightAtBat: h }, { spinDir: 0, swing: 0, seamKick: 0, speed: 35 }, 1)[0];
  check('length words: yorker / full / good / short / bouncer / full toss / beamer',
    w(-1, 0.1) === 'YORKER' && w(-3, 0.4) === 'FULL' && w(-6, 0.7) === 'GOOD LENGTH' && w(-9, 1.0) === 'SHORT' && w(-10, 1.6) === 'BOUNCER' && w(null, 0.6) === 'FULL TOSS' && w(null, 1.3) === 'BEAMER');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
