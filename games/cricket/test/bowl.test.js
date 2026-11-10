// The bowling release: synthetic overarm actions and the user's real deliveries.
// Run: node games/cricket/test/bowl.test.js
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'bowl.js'));
const P = require(path.join(__dirname, '..', 'phys.js'));
const SY = require(path.join(__dirname, 'synth.js'));
const REAL = require(path.join(__dirname, 'fixtures', 'real-bowls.json'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const rel = (o, ro) => { const s = SY.overarm(o); return B.readRelease(s.samples, s.tUp, ro); };
const AIM = { x: 0.1, len: 6 };
const seeded = () => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
/** Bowl it all the way: release -> delivery -> flight to the batter. */
function bowlRel(r, aim, gain) {
  const d = B.toDelivery(r, aim || AIM, { arm: 1, gain: gain || B.BOWL.GAIN.NORMAL, rng: seeded() });
  d.seamKick = 0;
  const run = P.run(B.launch(d), { until: x => x.p.z >= 0, samples: false });
  return { r, d, pitch: run.pitch, end: run.end };
}
const bowl = (o, aim, gain, ro) => bowlRel(rel(o, ro), aim, gain);
/** A real recorded delivery (test/fixtures/real-bowls.json: samples round the key-up, raw pad axes). */
function real(i) {
  const f = REAL[i];
  return { samples: f.s.map(([t, ax, a]) => ({ t, q: B.decodePad(ax), a: !!a })), tUp: 0, tPress: f.tPress - f.tUp };
}

// --- the phone link and the arm
{
  const q = B.armQuat(0.4, 0.2, 0.7), back = B.decodePad(B.encodePad(q));
  check('pad axes round trip as mimic.js decodes them', Math.abs(back.x * q.x + back.y * q.y + back.z * q.z + back.w * q.w) > 0.99999);
  const up = B.rotate(B.armQuat(0, 0, 0), { x: 0, y: 0, z: -1 });
  check('arm straight up: the phone top points up', up.y > 0.999, up);
}

// --- the user's real deliveries (2026-11-10 session)
{
  const rs = REAL.map((_, i) => { const x = real(i); return B.readRelease(x.samples, x.tUp, { tPress: x.tPress }); });
  check('all 4 real throws are deliveries', rs.every(r => r.ok), rs.map(r => r.why));
  check('...all head within 8 deg of straight (key-up reading gave 40-57 deg on two)', rs.every(r => Math.abs(deg(r.az)) < 8), rs.map(r => deg(r.az).toFixed(1)));
  check('...pace 100-150 km/h from 15-22 m/s whips', rs.every(r => r.pace * 3.6 > 100 && r.pace * 3.6 < 150), rs.map(r => (r.pace * 3.6).toFixed(0)));
  const dts = rs.map(r => r.dt).sort((a, b) => a - b);
  check('...the key came up -92..+25 ms from the whip; DT_IDEAL sits at their median', Math.abs((dts[1] + dts[2]) / 2 - B.BOWL.DT_IDEAL) < 10, dts.map(Math.round));
  check('...none twisted hard enough for spin (natural twist under MIN_TWIST)', rs.every(r => r.spin === 0), rs.map(r => r.twist.toFixed(1)));
  const lens = rs.map(r => bowlRel(r, { x: 0, len: 6 }).pitch);
  check('...NORMAL: every real ball pitches within 2 m of the aimed 6 m, within 0.6 m of the line', lens.every(p => p && Math.abs(-p.z - 6) < 2 && Math.abs(p.x) < 0.6), lens.map(p => p && [p.x.toFixed(2), (-p.z).toFixed(2)]));
  const neutral = B.seamNeutral(rs.map(r => r.alpha));
  check('the real screen sits ~100 deg off the palm line: measured from the natural grip, no swing', Math.abs(deg(neutral)) > 80 && rs.every(r => Math.abs(B.readRelease(real(rs.indexOf(r)).samples, 0, { seamRef: neutral }).swing) < 1), deg(neutral));
}

// --- stray taps and lazy arms
{
  const tap = [];
  for (let t = -500; t <= 400; t += 10) tap.push({ t, q: B.armQuat(-1.2, 0, 0), a: t > -40 && t < 0 });
  const r = B.readRelease(tap, 0, { tPress: -40 });
  check('a 40 ms tap with the arm still: a stray tap (ignored, not a no-ball)', !r.ok && r.why === 'tap', r.why);
  const lazy = rel({ peakW: 4 });
  check('a lazy wave (4 rad/s, 2.8 m/s hand): no whip, not a delivery', !lazy.ok && lazy.why === 'nowhip', [lazy.why, lazy.handSpeed]);
}

// --- pace from the whip
{
  const fast = rel({ peakW: 30 }), slow = rel({ peakW: 13 });
  check('a whipped arm (30 rad/s, 21 m/s hand) bowls 125-155 km/h', fast.ok && fast.pace * 3.6 > 125 && fast.pace * 3.6 < 155, fast.pace * 3.6);
  check('a gentle arm (13 rad/s) bowls 75-100 km/h', slow.ok && slow.pace * 3.6 > 75 && slow.pace * 3.6 < 100, slow.pace * 3.6);
  check('pace grows with arm speed, monotonic', [12, 16, 20, 24].map(w => rel({ peakW: w }).pace).every((v, i, a) => !i || v > a[i - 1]));
}

// --- length from when HOLD comes up against the whip
{
  const on = rel({ peakW: 20 });
  check('let go at the natural moment: no length error', on.ok && Math.abs(on.lenErr) < 0.012, on.lenErr);
  const early = rel({ peakW: 20, upOffset: -60 }), late = rel({ peakW: 20, upOffset: 60 });
  check('early / late key-ups still find the same whip', early.ok && late.ok && Math.abs(early.t - late.t) < 10, [early.t, late.t]);
  const bo = bowl({ peakW: 20 }), be = bowl({ peakW: 20, upOffset: -60 }), bl = bowl({ peakW: 20, upOffset: 60 });
  check('on time it pitches on the aimed spot (within 15 cm)', Math.abs(-bo.pitch.z - AIM.len) < 0.15, bo.pitch);
  check('60 ms early pitches ~0.9 m fuller, 60 ms late ~0.9 m shorter (NORMAL)', Math.abs(-be.pitch.z - (AIM.len - 0.9)) < 0.2 && Math.abs(-bl.pitch.z - (AIM.len + 0.9)) < 0.2, [be.pitch.z, bl.pitch.z]);
  const pe = bowl({ peakW: 20, upOffset: -60 }, AIM, B.BOWL.GAIN.PRO);
  check('PRO doubles it (1.8 m fuller)', Math.abs(-pe.pitch.z - (AIM.len - 1.8)) < 0.25, pe.pitch);
  const under = SY.overarm({ peakW: 20 });
  // the same action with the whip low behind the hip (an underarm flick): arm angle -2.4..-0.6
  const flick = under.samples.map(s => ({ t: s.t, q: B.armQuat(-1.5 + 0.9 * Math.tanh((s.t - 1000) / 120), 0, 0), a: s.a }));
  const ru = B.readRelease(flick, under.tUp);
  check('a whip with the arm down by the hip: not a delivery (underarm)', !ru.ok && ru.why === 'underarm', ru.why);
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
  const cw = rel({ peakW: 13, twist: 25 }), ccw = rel({ peakW: 13, twist: -25 }), none = rel({ peakW: 13 }), mild = rel({ peakW: 13, twist: 5 });
  check('wrist twist clockwise reads + twist, anticlockwise -', cw.twist > 20 && ccw.twist < -20, [cw.twist, ccw.twist]);
  check('no twist, or a natural 5 rad/s: no spin', none.spin === 0 && mild.spin === 0, [none.spin, mild.spin]);
  check('25 rad/s of wrist: big spin (~1500 rpm+)', cw.spin * 60 / (2 * Math.PI) > 1500, cw.spin * 60 / (2 * Math.PI));
  check('spin scrambles the seam: no swing on a big spinner', Math.abs(cw.swing) < 0.05, cw.swing);
  const aim = { x: 0, len: 4.5 };
  const tc = bowl({ peakW: 13, twist: 25 }, aim), ta = bowl({ peakW: 13, twist: -25 }, aim), tn = bowl({ peakW: 13 }, aim);
  check('clockwise turns right off the pitch (bowler\'s view)', tc.end.p.x - tn.end.p.x > 0.1, tc.end.p.x - tn.end.p.x);
  check('anticlockwise turns left', ta.end.p.x - tn.end.p.x < -0.1, ta.end.p.x - tn.end.p.x);
  check('right-handed batter: turning right (to his off side) is a leg-break', B.describe({ pitch: tc.pitch, heightAtBat: 0.5 }, tc.d, 1).includes('LEG-BREAK'));
  check('...and for a left-hander the same ball is an off-break', B.describe({ pitch: tc.pitch, heightAtBat: 0.5 }, tc.d, -1).includes('OFF-BREAK'));
}

// --- swing from the seam, against the player's own grip
{
  const ref = rel({ peakW: 22 }).alpha;
  const r = rel({ peakW: 22, rho0: rad(-25) }, { seamRef: ref });
  check('wrist turned 25 deg from your normal grip (palm right): full swing right', r.swing > 0.8, [r.swing, deg(r.seam)]);
  const l = rel({ peakW: 22, rho0: rad(25) }, { seamRef: ref });
  check('turned 25 deg the other way: swings left', l.swing < -0.8, l.swing);
  const sc = rel({ peakW: 22, rho0: rad(-80) }, { seamRef: ref });
  check('turned 80 deg: scrambled seam, no swing', Math.abs(sc.swing) < 0.05, sc.swing);
  check('no grip learned yet (first ball): no swing', rel({ peakW: 22, rho0: rad(-25) }).swing === 0);
  check('the natural grip is a circular median (wraps through 180 deg)', Math.abs(deg(B.seamNeutral([rad(170), rad(-175), rad(178)])) - 178) < 0.01 || Math.abs(Math.abs(deg(B.seamNeutral([rad(170), rad(-175), rad(178)]))) - 178) < 0.01);
  const b = bowl({ peakW: 22, rho0: rad(-25) }, { x: 0, len: 5 }, null, { seamRef: ref }), s = bowl({ peakW: 22 }, { x: 0, len: 5 });
  check('a swinging ball still pitches on the spot', Math.abs(b.pitch.x - s.pitch.x) < 0.05, [b.pitch.x, s.pitch.x]);
  check('...and carries on right after it', b.end.p.x - s.end.p.x > 0.05, b.end.p.x - s.end.p.x);
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
