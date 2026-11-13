// The bat: swing timing, blade angle and the swing's path decide the shot. Synthetic swings.
// Run: node games/cricket/test/bat.test.js
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'bat.js'));
const SY = require(path.join(__dirname, 'synth.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const rad = d => d * Math.PI / 180;
const BALL_V = { x: 0, y: 0.5, z: 33 };
const seeded = () => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

/**
 * Feed a swing; the ball reaches the bat at tArr (ms). Returns what the game would decide, as
 * the game does it: judge at arrival, wait while pending, then quality + shot.
 */
function play(swing, tArr, o) {
  o = Object.assign({ h: 0.5, side: 1, k: 1, x: 0 }, o);
  const tr = T.tracker();
  let j = null;
  for (const s of swing) {
    T.step(tr, s);
    if (s.t < tArr) continue;
    j = T.judge(tr, tArr, s.t, o.k);
    if (j.status !== 'pending') break;
  }
  if (!j || j.status === 'none') return { status: 'none' };
  const st = T.stateAt(tr, tArr);
  const push = j.swing.peak < T.BAT.V_SWING;
  const blade = T.swingBlade(j.swing);
  const f = T.fit(blade, o.h);
  const q = T.quality(j.e, o.k, f, push);
  if (q === 'miss') return { status: 'ready', q, e: j.e, f };
  const sh = T.shot({ u: st.u, b: blade, ballV: BALL_V, ballP: { x: o.x, y: o.h, z: -0.9 }, q, e: j.e, side: o.side, push, rng: seeded() });
  return Object.assign({ status: 'ready', q, e: j.e, f, peak: j.swing.peak }, sh);
}

// --- a straight bat, on time
{
  const r = play(SY.batSwing({ peakW: 18, tPeak: 1000 }), 1000);
  check('straight bat, fastest as the ball arrives: off the middle', r.q === 'middle', r);
  check('...straight back down the ground (within 5 deg)', Math.abs(r.az) < 5, r.az);
  check('...hard: 28-42 m/s off the bat', r.speed > 28 && r.speed <= 42, r.speed);
  check('...kept down (loft under 10 deg)', r.loft < 10 && r.loft > -5, r.loft);
  check('...called a straight drive, sweet spot', r.kind === 'STRAIGHT DRIVE' && r.sweet, r.kind);
}

// --- the swing's path aims
{
  const cover = play(SY.batSwing({ peakW: 18, dir: rad(40) }), 1000);
  check('swing path 40 deg to the off side: cover drive at ~40 deg', Math.abs(cover.az - 40) < 5 && cover.kind === 'COVER DRIVE', [cover.az, cover.kind]);
  const lefty = play(SY.batSwing({ peakW: 18, dir: rad(40) }), 1000, { side: -1 });
  check('the same swing from a left-hander goes to his leg side: on drive', lefty.az < -35 && lefty.kind === 'ON DRIVE', [lefty.az, lefty.kind]);
  const lofted = play(SY.batSwing({ peakW: 18, thetaPeak: rad(25) }), 1000);
  check('met 25 deg after the bottom of the arc (bat rising): lofted 20-30 deg', lofted.loft > 18 && lofted.loft < 32 && /LOFTED/.test(lofted.kind), [lofted.loft, lofted.kind]);
  const pull = play(SY.batSwing({ peakW: 16, plane: 'flat', sweep: 1 }), 1000, { h: 1.05 });
  check('level bat sweeping round at a chest-high ball: a pull to square leg', pull.q === 'middle' && pull.kind === 'PULL' && Math.abs(pull.az + 90) < 6, [pull.q, pull.kind, pull.az]);
  const cut = play(SY.batSwing({ peakW: 16, plane: 'flat', sweep: -1 }), 1000, { h: 0.8 });
  check('level bat sweeping to the off side: a cut to point', cut.kind === 'CUT' && Math.abs(cut.az - 90) < 6, [cut.kind, cut.az]);
}

// --- timing
{
  const late = play(SY.batSwing({ peakW: 18, tPeak: 1055 }), 1000);
  check('55 ms late: still hit, not off the middle', late.q === 'good', [late.q, late.e]);
  check('...met before the bottom of the arc: hit down', late.loft < 0, late.loft);
  const early = play(SY.batSwing({ peakW: 18, tPeak: 945 }), 1000);
  check('55 ms early: met after the bottom: goes up', early.q === 'good' && early.loft > 8, [early.q, early.loft]);
  const pullEarly = play(SY.batSwing({ peakW: 16, plane: 'flat', sweep: 1, tPeak: 950 }), 1000, { h: 1.05 });
  const pullLate = play(SY.batSwing({ peakW: 16, plane: 'flat', sweep: 1, tPeak: 1050 }), 1000, { h: 1.05 });
  check('an early pull goes finer (behind square), a late one squarer/in front', pullEarly.az < -100 && pullLate.az > -80, [pullEarly.az, pullLate.az]);
  const edge = play(SY.batSwing({ peakW: 18, tPeak: 1100 }), 1000);
  check('100 ms late with a straight bat: outside edge, behind on the off side', edge.q === 'edge' && edge.kind === 'OUTSIDE EDGE' && edge.az > 140, [edge.q, edge.kind, edge.az]);
  const miss = play(SY.batSwing({ peakW: 18, tPeak: 1200 }), 1000);
  check('200 ms late: missed', miss.q === 'miss', miss);
  const wayEarly = play(SY.batSwing({ peakW: 18, tPeak: 750 }), 1000);
  check('250 ms early: missed (or no swing near the ball)', wayEarly.q === 'miss' || wayEarly.status === 'none', wayEarly);
  const pro = play(SY.batSwing({ peakW: 18, tPeak: 1062 }), 1000, { k: T.BAT.TIMING.PRO });
  const easy = play(SY.batSwing({ peakW: 18, tPeak: 1100 }), 1000, { k: T.BAT.TIMING.EASY });
  check('TIMING WINDOW: PRO turns 62 ms late into an edge, EASY turns 100 ms into a hit', pro.q === 'edge' && easy.q === 'good', [pro.q, easy.q]);
}

// --- waiting for a late swing's peak
{
  const tr = T.tracker(), sw = SY.batSwing({ peakW: 18, tPeak: 1040 });
  let first = null;
  for (const s of sw) { T.step(tr, s); if (s.t >= 1000 && !first) first = T.judge(tr, 1000, s.t, 1); }
  check('ball arrives while the bat is still speeding up: pending (the game holds the ball)', first.status === 'pending', first.status);
  const j = T.judge(tr, 1000, 1200, 1);
  check('...then ready once it peaks: 40 ms late', j.status === 'ready' && Math.abs(j.e - 0.04) < 0.012, j);
}

// --- no shot, a backlift only, a defensive prod
{
  const still = [];
  for (let t = 600; t <= 1300; t += 8) still.push({ t, q: SY.batQuat(0, 0, 'vertical') });
  check('bat held still: no shot (a leave)', play(still, 1000).status === 'none');
  const back = [];
  for (let t = 600; t <= 1300; t += 8) back.push({ t, q: SY.batQuat(-2.4 * Math.min(1, Math.max(0, (t - 900) / 150)), 0, 'vertical') });
  check('lifting the bat back fast is not a swing', play(back, 1000).status === 'none');
  const prod = play(SY.batSwing({ peakW: 4, tPeak: 1000 }), 1000);
  check('a slow forward prod on time: defended, dies near the pitch (< 12 m/s)', prod.kind === 'DEFENDED' && prod.speed < 12, [prod.kind, prod.speed, prod.peak]);
}

// --- the blade's angle against the ball's height
{
  const high = play(SY.batSwing({ peakW: 18 }), 1000, { h: 1.45 });
  check('straight bat at a head-high bouncer: an edge at best, even on time', high.q === 'edge' || high.q === 'miss', [high.q, high.f]);
  const yorker = play(SY.batSwing({ peakW: 16, plane: 'flat', sweep: 1 }), 1000, { h: 0.08 });
  check('cross bat at a yorker on the toes: edge at best (under it)', yorker.q === 'edge' || yorker.q === 'miss', [yorker.q, yorker.kind]);
  check('fit: straight bat at shin height is perfect, level bat at chest height too', T.fit({ x: 0, y: -1, z: 0 }, 0.3) === 1 && T.fit({ x: 1, y: 0, z: 0 }, 1.1) === 1);
}

// --- the computer batter goes through the same rules
{
  const rng = seeded();
  let leaves = 0, shots = 0;
  for (let i = 0; i < 200; i++) {
    const c = T.cpuShot({ x: 0.7, h: 0.6, len: 6, onStumps: false }, { sigma: 0.04, aggro: 0.5 }, rng, 1);
    if (!c) leaves++; else shots++;
  }
  check('computer batter mostly leaves a wide one outside off', leaves > 120, [leaves, shots]);
  const c = T.cpuShot({ x: 0, h: 1.2, len: 10, onStumps: false }, { sigma: 0, aggro: 1 }, seeded(), 1);
  const sh = T.shot({ u: c.u, b: c.b, ballV: BALL_V, q: 'middle', e: 0, side: 1, rng: seeded() });
  check('...pulls a short one to the leg side with a cross bat', sh.az < -55 && /PULL|HOOK/.test(sh.kind), [sh.az, sh.kind]);
}

{
  // the phone is small: how the hand holds it should not decide straight or cross bat on its own
  const deg = 180 / Math.PI, elOf = b => Math.asin(-b.y) * deg;
  const level = { x: 0, y: -Math.sin(rad(12)), z: -Math.cos(rad(12)) };          // 12 deg below level
  const full = T.assistBlade(level, 0.3), high = T.assistBlade({ x: 0, y: -1, z: 0 }, 1.5);
  check('a near-level phone on a full ball becomes a straight bat (>= 50 deg)', elOf(full) >= 50, elOf(full));
  check('...and meets it cleanly, not off the bottom edge', T.fit(full, 0.3) >= 0.9, T.fit(full, 0.3));
  check('a hanging bat on a bouncer turns towards a cross bat (< 35 deg)', elOf(high) < 35, elOf(high));
  check('the heading of the blade is kept', Math.abs(Math.atan2(full.x, -full.z)) < 1e-9);
  // the loft: a phone swing that finishes steeply rising is a lofted hit, not a skier
  const upU = { x: 0, y: Math.sin(rad(75)) * 20, z: -Math.cos(rad(75)) * 20 };
  const up = T.shot({ u: upU, b: { x: 0, y: -1, z: 0 }, ballV: BALL_V, ballP: { x: 0, y: 0.5, z: 0 }, q: 'middle', e: 0, side: 1, power: 1.75, phone: true, rng: seeded() });
  check('a steeply rising phone swing (+75 deg) lofts at most 45 deg', up.loft <= 45 && up.loft > 30, up.loft);
  const drive = T.shot({ u: { x: 0, y: Math.sin(rad(20)) * 20, z: -Math.cos(rad(20)) * 20 }, b: { x: 0, y: -1, z: 0 }, ballV: BALL_V, ballP: { x: 0, y: 0.5, z: 0 }, q: 'middle', e: 0, side: 1, power: 1.75, phone: true, rng: seeded() });
  check('...while a +20 deg path still lofts as before (about 22 deg)', Math.abs(drive.loft - 22) < 1, drive.loft);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
