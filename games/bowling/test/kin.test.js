// The bowling arm in real units: orientation 1:1, release velocity = w x r, spin from the wrist.
// Run: node games/bowling/test/kin.test.js
'use strict';
const path = require('path');
const K = require(path.join(__dirname, '..', 'kin.js'));
const APPROACH_V = K.APPROACH.V;
K.APPROACH.V = 0;   // these checks measure the hand itself; the approach has its own test at the end
const SW = require(path.join(__dirname, '..', 'tools', 'swing.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const deg = r => r * 180 / Math.PI;
const SHOULDER = { x: 0.18, y: 0.98, z: 0.45 };

/** Run one synthetic swing through the same path the game uses: samples -> release event -> fit -> ball. */
function bowl(o) {
  const ss = SW.gen(o), tr = K.createTrack();
  let rel = null;
  for (const s of ss) { K.pushSample(tr, s); }
  for (const e of tr.events) if (e.kind === 'release') rel = e;
  if (!rel) return null;
  const q0 = o.alignWith || o.grip || K.DEFAULT_Q0;
  const f = K.fitRelease(tr.samples, rel.t, q0);
  return Object.assign(K.releaseBall({ w: f.w, Rd: f.Rd, v: f.v, shoulder: SHOULDER }), { fit: f, tRel: rel.t });
}

// --- the phone link
{
  const q = K.norm({ x: 0.2, y: -0.4, z: 0.1, w: 0.85 });
  const back = K.decodePad(K.encodePad(q));
  const d = Math.abs(back.x * q.x + back.y * q.y + back.z * q.z + back.w * q.w);
  check('pad axes encode/decode round trip (as mimic.js decodes)', d > 0.99999, d);
  const id = K.decodePad([0, 0, 0]);
  check('phone at rest as a remote = identity in the world', near(id.w, 1, 1e-9));
}

// --- orientation is 1:1, whatever the grip
{
  const r = K.armVec(K.handRot(K.DEFAULT_Q0, K.DEFAULT_Q0));
  check('align pose: arm hangs straight down, 0.70 m', near(r.x, 0, 1e-9) && near(r.y, -0.70, 1e-9) && near(r.z, 0, 1e-9), r);
  const grips = [K.DEFAULT_Q0, K.axisAngle(0.3, 1, -0.2, 2.1), K.axisAngle(1, 0, 0, 0.4), K.axisAngle(0, 0, 1, Math.PI / 2)];
  const Rtrue = K.swingRot(0.2, -0.9, 0.5);
  let worst = 0;
  for (const g of grips) {
    const Rd = K.handRot(K.mul(Rtrue, g), g);
    worst = Math.max(worst, 1 - Math.abs(Rd.x * Rtrue.x + Rd.y * Rtrue.y + Rd.z * Rtrue.z + Rd.w * Rtrue.w));
  }
  check('any way the phone sits in the hand, after align the hand turns exactly as the phone', worst < 1e-12, worst);
  const fwd = K.armVec(K.swingRot(0, Math.PI / 2, 0));
  check('arm swung 90 deg forward points down the lane (-z), the elbow bent a little (hand < 4 cm low)', near(fwd.z, -0.70, 0.004) && fwd.y < 0 && fwd.y > -0.04 && near(fwd.x, 0, 1e-9), fwd);
  const bend = th => { const r = K.armVec(K.swingRot(0, th, 0)), d = K.rotate(K.swingRot(0, th, 0), { x: 0, y: -1, z: 0 });
    const L = Math.hypot(r.x, r.y, r.z); return { L, off: Math.acos((r.x * d.x + r.y * d.y + r.z * d.z) / L) * 180 / Math.PI }; };
  const b90 = bend(Math.PI / 2), b150 = bend(-2.6), b0 = bend(0);
  check('elbow nearly locked: shoulder-hand stays 0.69-0.70 m through the whole swing', [b90, b150, b0].every(b => b.L > 0.69 && b.L <= 0.7000001), [b90.L, b150.L]);
  check('...hanging it is perfectly straight, over the shoulder (150 deg back) still a slight bend (< 4 deg)', b0.off < 1e-6 && b150.off < 4, [b0.off, b150.off]);
  const tw = K.armVec(K.swingRot(0.2, 0.7, 1.3)), nt = K.armVec(K.swingRot(0.2, 0.7, 0));
  check('a wrist twist does not move the hand', Math.hypot(tw.x - nt.x, tw.y - nt.y, tw.z - nt.z) < 1e-9);
}

// --- release velocity is the hand's real velocity
{
  const r = K.releaseBall({ w: { x: 8, y: 0, z: 0 }, Rd: K.swingRot(0, 0, 0), shoulder: SHOULDER });
  check('8 rad/s through the bottom = 5.6 m/s straight down the lane', near(r.speed, 5.6, 1e-9) && near(r.v.z, -5.6, 1e-9) && near(r.heading, 0, 1e-9), r.v);
  check('released at the bottom: ball starts under the shoulder, ~0.28 m up', near(r.pos.y, 0.28, 1e-9) && near(r.pos.z, 0.45, 1e-9), r.pos);
  const tw = K.releaseBall({ w: { x: 8, y: 12, z: 0 }, Rd: K.swingRot(0, 0, 0), shoulder: SHOULDER });
  check('a wrist twist does not change the ball speed', near(tw.speed, r.speed, 1e-9));
  check('anticlockwise twist (from above) = side roll that hooks left (+z axis)', tw.sideRoll > 0 && tw.spin.z > 8, tw.spin);
  check('side roll = twist x finger radius / ball radius', near(tw.sideRoll, 12 * 0.085 / 0.1085, 1e-9), tw.sideRoll);
  const hard = K.releaseBall({ w: { x: 40, y: 0, z: 0 }, Rd: K.swingRot(0, 0, 0), shoulder: SHOULDER });
  check('only physical sanity caps the speed (13.5 m/s)', hard.capped && near(hard.speed, 13.5, 1e-9));
}

// --- whole swings through samples, noise and the fit
{
  const lazy = bowl({ peakW: 4, seed: 3 }), mid = bowl({ peakW: 8, seed: 4 }), big = bowl({ peakW: 13, seed: 5 });
  const expect = w => w * 0.70 * Math.cos(0.12) ;   // released 0.12 rad past the bottom
  check('lazy swing (4 rad/s) -> lazy ball ~2.8 m/s', near(lazy.speed, expect(4), 0.12), lazy.speed);
  check('medium swing (8 rad/s) -> ~5.6 m/s', near(mid.speed, expect(8), 0.18), mid.speed);
  check('hard swing (13 rad/s) -> ~9.1 m/s', near(big.speed, expect(13), 0.28), big.speed);
  check('speed is proportional to effort (13/4 swing -> 13/4 ball, within 5%)', near(big.speed / lazy.speed, 13 / 4, 13 / 4 * 0.05), big.speed / lazy.speed);
  check('a straight swing rolls straight (< 0.5 deg)', Math.abs(deg(mid.heading)) < 0.5, deg(mid.heading));
  check('released just past the bottom: a little upward (loft 0..10 deg)', deg(mid.loft) > 0 && deg(mid.loft) < 10, deg(mid.loft));
  const left = bowl({ peakW: 8, yaw: 4 * Math.PI / 180, seed: 6 }), right = bowl({ peakW: 8, yaw: -2.5 * Math.PI / 180, seed: 8 });
  check('swing plane 4 deg left -> ball heads 4 deg left (+-0.5)', near(deg(left.heading), 4, 0.5), deg(left.heading));
  check('swing plane 2.5 deg right -> 2.5 deg right (+-0.5)', near(deg(right.heading), -2.5, 0.5), deg(right.heading));
  const early = bowl({ peakW: 8, relPhi: -0.9, seed: 9 });
  check('let go on the way down from the top: ball is low behind you, falling, slower', early.pos.z > 0.6 && early.v.y < -1 && early.speed < mid.speed, { pos: early.pos, v: early.v });
  const late = bowl({ peakW: 8, relPhi: 0.7, seed: 10 });
  check('let go late on the way up: lofted (> 25 deg up)', deg(late.loft) > 25, deg(late.loft));
  const hook = bowl({ peakW: 8, twist: 1.6, seed: 11 }), flat = bowl({ peakW: 8, twist: 0, seed: 11 });
  check('wrist turn through the release -> side roll for a hook (> 6 rad/s)', hook.sideRoll > 6, hook.sideRoll);
  check('...anticlockwise from above hooks left (spin about +z)', hook.spin.z > 6, hook.spin);
  check('no wrist turn -> almost no side roll (< 0.6 rad/s from noise)', Math.abs(flat.sideRoll) < 0.6, flat.sideRoll);
  check('a fast wrist turn (~20 rad/s) does not steer the ball (< 0.2 deg vs the same swing without it)', Math.abs(deg(hook.heading - flat.heading)) < 0.2, deg(hook.heading - flat.heading));
  const hard = bowl({ peakW: 8, twist: 2.4, seed: 12 }), hardFlat = bowl({ peakW: 8, twist: 0, seed: 12 });
  check('a very fast wrist turn (~30 rad/s) does not steer it either (< 0.3 deg)', Math.abs(deg(hard.heading - hardFlat.heading)) < 0.3 && hard.sideRoll > 10, [deg(hard.heading - hardFlat.heading), hard.sideRoll]);
  check('the wrist turn does not change the speed (< 3%)', Math.abs(hook.speed - flat.speed) / flat.speed < 0.03, [hook.speed, flat.speed]);
  // any grip: hold the phone sideways in the fist, align in that grip, same swing, same ball
  const grip = K.axisAngle(0.4, 0.8, 0.3, 1.9);
  const g = bowl({ peakW: 8, seed: 4, grip });
  check('a different grip (aligned in it) gives the same ball (< 1%)', Math.abs(g.speed - mid.speed) / mid.speed < 0.01 && Math.abs(deg(g.heading - mid.heading)) < 0.3, [g.speed, mid.speed]);
  // misaligned: aligned in the default pose but holding it another way -> not the same (honest)
  const mis = bowl({ peakW: 8, seed: 4, grip, alignWith: K.DEFAULT_Q0 });
  check('without aligning a new grip, the arm is wrong (align matters)', Math.abs(mis.speed - mid.speed) > 0.3 || Math.abs(deg(mis.heading)) > 5, [mis.speed, deg(mis.heading)]);
  // repeatability under noise
  const speeds = [], heads = [];
  for (let s = 0; s < 20; s++) { const b = bowl({ peakW: 8, seed: 100 + s }); speeds.push(b.speed); heads.push(deg(b.heading)); }
  const m = speeds.reduce((a, b) => a + b) / 20, sd = Math.sqrt(speeds.reduce((a, b) => a + (b - m) * (b - m), 0) / 20);
  const hsd = Math.sqrt(heads.reduce((a, b) => a + b * b, 0) / 20);
  check('sensor noise moves the speed < 2% (sd over 20 noisy swings)', sd / m < 0.02, { m, sd });
  check('sensor noise + hand wobble move the direction < 0.6 deg rms (~0.2 m at the pins)', hsd < 0.6, hsd);
}

// --- the fit itself
{
  const ss = [];
  for (let i = 0; i < 20; i++) ss.push({ t: i * 8, q: K.axisAngle(0, 0, 1, 3 * i * 0.008) });
  const f = K.fitOmega(ss, 80);
  check('fit of a steady 3 rad/s turn about z', near(f.w.z, 3, 1e-6) && near(f.w.x, 0, 1e-6), f.w);
  check('fit uses ~7 samples at 125 Hz (40 ms back, 16 ms ahead)', f.n >= 6 && f.n <= 8, f.n);
  const tr = K.createTrack();
  [[0, false], [8, true], [8, false], [16, true], [24, false]].forEach(([t, a]) => K.pushSample(tr, { t, q: K.DEFAULT_Q0, a }));
  check('track: duplicate reports ignored, press/release edges at the exact sample time',
    JSON.stringify(tr.events) === JSON.stringify([{ kind: 'press', t: 8 }, { kind: 'release', t: 24 }]), tr.events);
}

// --- the body: steps and lunge from the phone's accelerometer (kin.js body tracker)
function bowlBody(o) {
  // the tracker has no accelerometer-lag compensation (it is off in the game: BODY.USE)
  const ss = SW.gen(Object.assign({ accLag: 0 }, o)), tr = K.createTrack(), body = K.createBody();
  let rel = null, out = null;
  for (const s of ss) {
    K.pushSample(tr, s);
    for (const e of tr.events.splice(0)) { if (e.kind === 'press' && !body.on && !rel) K.bodyStart(body, e.t); if (e.kind === 'release') rel = e; }
    K.bodyUpdate(body, tr.samples, K.DEFAULT_Q0);
    if (rel && !out && s.t > rel.t + 30) {
      const b = K.bodyAt(body, rel.t), f = K.fitRelease(tr.samples, rel.t, K.DEFAULT_Q0);
      out = Object.assign(K.releaseBall({ w: f.w, Rd: f.Rd, v: f.v, shoulder: SHOULDER, bodyV: b.v, bodyP: b.p }), { body: b });
    }
  }
  return out;
}
{
  const lunge = { dist: 0.6, dur: 0.6, end: 0.15 }, k = (lunge.dur - lunge.end) / lunge.dur, vTrue = lunge.dist / lunge.dur * 6 * k * (1 - k);
  const still = bowlBody({ peakW: 8, seed: 21 }), lg = bowlBody({ peakW: 8, seed: 21, lunge });
  const walk = bowlBody({ peakW: 8, seed: 22, lunge: { dist: 1.4, dur: 1.4, end: 0.25 } });
  const hard = bowlBody({ peakW: 12, seed: 23 });
  check('standing still: the body adds < 0.25 m/s and moves < 5 cm', K.len(still.bodyV) < 0.25 && K.len(still.body.p) < 0.05, [still.bodyV, still.body.p]);
  check('a hard swing that clips the 8 g accelerometer does not invent body speed (< 0.3 m/s)', K.len(hard.bodyV) < 0.3, hard.bodyV);
  check('a 0.6 m lunge: body speed at release within 0.2 m/s of the truth, forward', Math.abs(-lg.bodyV.z - vTrue) < 0.2, [lg.bodyV.z, vTrue]);
  check('...it carries the hand ~0.5 m further down the lane', lg.body.p.z < -0.4 && lg.body.p.z > -0.6, lg.body.p);
  check('...and the ball is that much faster (arm + body)', lg.speed - still.speed > 0.8, [lg.speed, still.speed]);
  check('a 1.4 m walk: tracked 1.0-1.5 m, still moving forward at release', walk.body.p.z < -1.0 && walk.body.p.z > -1.5 && walk.bodyV.z < -0.4, [walk.body.p, walk.bodyV]);
  const armShort = bowlBody({ peakW: 8, seed: 24, armL: 0.6 });
  check('a shorter real arm (0.60 m): the hand really moves slower and the ball is slower (no backward "body" below -0.3 m/s)', armShort.speed < still.speed && armShort.bodyV.z <= 0.3001, [armShort.speed, still.speed, armShort.bodyV]);
  check('the mouse (no accelerometer) leaves the body still', (() => { const b = K.createBody(), tr = K.createTrack(); K.bodyStart(b, 0);
    for (let i = 1; i < 100; i++) { K.pushSample(tr, { t: i * 8, q: K.mul(K.swingRot(0, Math.sin(i / 10), 0), K.DEFAULT_Q0), a: true }); K.bodyUpdate(b, tr.samples); }
    return K.len(K.bodyAt(b, 1e9).v) === 0 && K.len(K.bodyAt(b, 1e9).p) === 0; })());
}
// --- the ball rolls off the fingers
{
  const r = K.releaseBall({ w: { x: 10, y: 0, z: 0 }, Rd: K.swingRot(0, 0, 0), shoulder: SHOULDER });
  check('released at 7 m/s it carries forward roll (spin -x for a ball going -z), ~250-350 rpm', r.spin.x < 0 && r.rpm > 250 && r.rpm < 350, [r.spin, r.rpm]);
}

// --- the lane frame: no align needed (kin.js laneRef / gripRef)
{
  const yawQ = y => K.axisAngle(0, 1, 0, y);
  // the phone's own heading zero is 30 deg off the lane: a lane reference at 30 deg undoes it
  const psi = 30 * Math.PI / 180, phi = 0.4;
  const q = K.mul(yawQ(psi), K.mul(K.swingRot(0, phi, 0), K.DEFAULT_Q0));
  const Rd = K.handRot(q, K.laneRef(psi)), want = K.swingRot(0, phi, 0);
  check('laneRef(yaw) turns the phone\'s frame into the lane\'s (Rd = Ry(-yaw) q q0^-1)', Math.abs(Rd.x * want.x + Rd.y * want.y + Rd.z * want.z + Rd.w * want.w) > 0.99999);
  // a swing generated 30 deg off in the phone's frame comes out straight in that lane frame
  const ss = SW.gen({ peakW: 9, seed: 21, noise: 0.3 }).map(s => Object.assign({}, s, { q: K.mul(yawQ(psi), s.q) }));
  const tr = K.createTrack(); ss.forEach(s => K.pushSample(tr, s));
  const rel = tr.events.find(e => e.kind === 'release');
  const T = K.throwFrom(tr.samples, rel.t, K.laneRef(psi), SHOULDER);
  check('...a straight swing in a turned phone frame is straight in the lane frame (< 1 deg), spin too', Math.abs(deg(T.rb.heading)) < 1 && T.rb.spin.x < 0 && Math.abs(T.rb.spin.z) < 0.25 * Math.abs(T.rb.spin.x), [deg(T.rb.heading), T.rb.spin]);
  // gripRef (v6): straight = the forearm's heading at the grip turned REF.HOLD (15 deg) toward
  // the non-bowling side (the phone's top sits outward of the swing line in the fist)
  const fore = h => K.mul(yawQ(h), K.mul(K.swingRot(0, 1.4, 0), K.DEFAULT_Q0));   // arm 80 deg forward
  let g = K.gripRef(fore(-15 * Math.PI / 180), 0);
  check('gripRef: forearm 15 deg right of the phone zero at the grip (this player stance) -> the lane is the phone zero', g.src === 'grip' && near(deg(g.yaw), 0, 0.01), deg(g.yaw));
  g = K.gripRef(fore(80 * Math.PI / 180), 0);
  check('gripRef: the phone zero plays no part: forearm 80 deg off it -> lane at 95 deg', g.src === 'grip' && near(deg(g.yaw), 95, 0.5), deg(g.yaw));
  g = K.gripRef(fore(80 * Math.PI / 180), 0, { side: -1 });
  check('gripRef: left-handed, the offset mirrors (80 - 15 = 65 deg)', near(deg(g.yaw), 65, 0.5), deg(g.yaw));
  g = K.gripRef(K.mul(yawQ(2), K.mul(K.swingRot(0, 0.1, 0), K.DEFAULT_Q0)), 0.3);
  check('gripRef: arm hanging at the grip (no heading to read) -> keeps the current zero', g.src === 'phone' && g.yaw === 0.3, g);
  g = K.gripRef(fore(0.2), 0.25, { aligned: true });
  check('gripRef: a manual re-align (CENTRE, base) is the zero', g.src === 'centre' && g.yaw === 0.25, g);
  // optional aim gain: heading x gain, speed and loft kept
  const v = { x: -Math.sin(0.1) * 5, y: 1, z: -Math.cos(0.1) * 5 }, va = K.aimed(v, 0.5);
  check('aimed(v, 0.5): heading halved, speed and loft kept; gain 1 is the identity', near(Math.atan2(-va.x, -va.z), 0.05, 1e-9) && near(K.len(va), K.len(v), 1e-9) && va.y === 1 && K.aimed(v, 1) === v, va);
}
// --- the hand stays in the swing plane through the shoulder (kin.js planeArm)
{
  const r = { x: 0.2, y: -0.66, z: -0.1 }, L0 = K.len(r);
  const p = K.planeArm(r, { x: 9, y: 0.5, z: 0 });
  check('planeArm: a fast swing about x drops the phone\'s sideways lean from the hand, keeps the arm length', Math.abs(p.x) < 1e-9 && near(K.len(p), L0, 1e-9), p);
  const q = K.planeArm(r, { x: 0.8, y: 0, z: 0 });
  check('...a still or slow arm (< 1.5 rad/s) is left as the phone says', q.x === r.x && q.y === r.y, q);
}

// --- the hand's measured velocity at the release (kin.js handVelocity): accelerometer, not arm
function hand(o) {
  const ss = SW.gen(o), tr = K.createTrack();
  for (const s of ss) K.pushSample(tr, s);
  const rel = tr.events.find(e => e.kind === 'release');
  const T = K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER, { bottom: false });   // the velocity at that instant
  const model = K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER, { hand: false, bottom: false });
  return { T, rb: T.rb, arm: model.rb, hv: T.hv, tRel: rel.t };
}
{
  const m = hand({ peakW: 8, seed: 31 });
  check('handVelocity: a clean swing (real arm = the model) measures the model\'s speed (< 3%), straight like the hand (< 0.7 deg)',
    m.rb.vSrc === 'hand' && Math.abs(m.rb.speed / m.arm.speed - 1) < 0.03 && Math.abs(deg(m.rb.heading)) < 0.7, [m.rb.speed, m.arm.speed, deg(m.rb.heading)]);
  check('...and loft (< 2 deg)', Math.abs(deg(m.rb.loft - m.arm.loft)) < 2, [deg(m.rb.loft), deg(m.arm.loft)]);
  check('...integrated from the backswing apex (hand at rest: < 0.3 m/s), a short window (< 0.6 s)',
    K.len(m.hv.v0) < 0.3 && m.hv.dur > 0.1 && m.hv.dur < 0.6 && m.hv.t0 < m.tRel - 100, [K.len(m.hv.v0), m.hv.dur]);
  const short = hand({ peakW: 8, seed: 31, armL: 0.5 });
  check('the real hand moves at 0.5/0.7 of the model (a shorter lever, as a flexing wrist is): measured, not inferred (< 4%)',
    Math.abs(short.rb.speed / short.arm.speed - 0.5 / 0.7) < 0.04 * 0.71, [short.rb.speed, short.arm.speed]);
  const wy = hand({ peakW: 8, seed: 32, wrist: { yaw: 0.35 } }), w0 = hand({ peakW: 8, seed: 32 });
  check('the wrist turns the phone 20 deg left through the release, the hand swings straight: the model aims it, the hand does not (< 1 deg)',
    Math.abs(deg(wy.arm.heading)) > 4 && Math.abs(deg(wy.rb.heading - w0.rb.heading)) < 1, [deg(wy.arm.heading), deg(wy.rb.heading), deg(w0.rb.heading)]);
  const wp = hand({ peakW: 8, seed: 33, wrist: { pitch: -0.45 } }), p0 = hand({ peakW: 8, seed: 33 });
  check('the wrist flexes the phone 26 deg through the release: the model changes the loft, the hand does not (< 2 deg)',
    Math.abs(deg(wp.arm.loft - p0.arm.loft)) > 8 && Math.abs(deg(wp.rb.loft - p0.rb.loft)) < 2, [deg(wp.arm.loft), deg(wp.rb.loft), deg(p0.rb.loft)]);
  const tw = hand({ peakW: 8, seed: 34, twist: 1.6 });
  check('the wrist twist still rolls the ball sideways (side roll from the phone\'s rotation)', tw.rb.vSrc === 'hand' && tw.rb.sideRoll > 6, tw.rb.sideRoll);
  const big = hand({ peakW: 13, seed: 35 });
  check('a swing that clips the 8 g accelerometer is not measured: the arm model', big.rb.vSrc === 'arm', big.rb.vSrc);
  // a Bluetooth stall in the downswing
  const g = SW.gen({ peakW: 8, seed: 36 }), tr = K.createTrack();
  for (const s of g) if (!(s.t > g.tRel - 180 && s.t < g.tRel - 80)) K.pushSample(tr, s);
  const rel = tr.events.find(e => e.kind === 'release');
  check('a Bluetooth stall (> 70 ms) in the downswing: the arm model', K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER).rb.vSrc === 'arm');
  const mt = K.createTrack();
  for (const s of SW.gen({ peakW: 8, seed: 37 })) K.pushSample(mt, { t: s.t, q: s.q, a: s.a });
  const mrel = mt.events.find(e => e.kind === 'release');
  check('the mouse (no accelerometer): the arm model', K.throwFrom(mt.samples, mrel.t, K.laneRef(0), SHOULDER).rb.vSrc === 'arm');
}

// --- release at the bottom (kin.js swingBottom, v7): the thumb lifts Vol Down after the fingers open
function relAt(o) {
  const ss = SW.gen(Object.assign({ peakW: 8, seed: 41 }, o)), tr = K.createTrack();
  for (const s of ss) K.pushSample(tr, s);
  const rel = tr.events.find(e => e.kind === 'release');
  return { T: K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER), K0: K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER, { bottom: false }) };
}
{
  const a = relAt({ relPhi: 0.6 });   // key up ~80 ms after the bottom
  check('key-up 80 ms after the bottom: the ball leaves from the bottom, level (|loft| < 3 deg), at the bottom\'s speed',
    a.T.release.mode === 'bottom' && a.T.release.lag > 50 && a.T.release.lag < 110 && Math.abs(deg(a.T.rb.loft)) < 3 && a.T.rb.speed > a.K0.rb.speed,
    [a.T.release, deg(a.T.rb.loft), deg(a.K0.rb.loft), a.T.rb.speed, a.K0.rb.speed]);
  check('...from the bottom pose (the hand low: ball centre < 0.3 m up; at the key-up it was > 0.35)', a.T.rb.pos.y < 0.3 && a.K0.rb.pos.y > 0.35, [a.T.rb.pos.y, a.K0.rb.pos.y]);
  const late = relAt({ relPhi: 1.5, fwdTop: 2.0 });   // ~210 ms late: an honest lob
  check('key-up > BOTTOM.WINDOW (150 ms) after the bottom: released at the key-up, lofted', late.T.release.mode === 'keyup' && late.T.release.lag > 150 && deg(late.T.rb.loft) > 30, [late.T.release, deg(late.T.rb.loft)]);
  const early = relAt({ relPhi: -0.3 });   // before the bottom
  check('key-up before the bottom: untouched (keyup, dropping: loft < -8 deg)', early.T.release.mode === 'keyup' && early.T.release.lag === null && deg(early.T.rb.loft) < -8, [early.T.release, deg(early.T.rb.loft)]);
  const clip = relAt({ relPhi: 0.6, peakW: 13 });   // accelerometer clipped: the arm model finds the bottom too
  check('...with the arm model (a clipped accelerometer) the bottom is found as well', clip.T.rb.vSrc === 'arm' && clip.T.release.mode === 'bottom' && Math.abs(deg(clip.T.rb.loft)) < 5, [clip.T.release, deg(clip.T.rb.loft)]);
  const stance = SW.gen({ peakW: 8, seed: 42 }), tr = K.createTrack();
  for (const s of stance) if (s.t < stance.tRel - 900) K.pushSample(tr, Object.assign({}, s, { a: s.t > stance[0].t + 200 }));
  check('no swing (let go standing still): no bottom, released where it is', K.swingBottom(tr.samples, tr.samples[tr.samples.length - 1].t, K.laneRef(0), null) === null);
}

// --- line-up: the player's grip offset learned from practice swings (kin.js lineup)
{
  const r = d => d * Math.PI / 180;
  const yawQ = y => K.axisAngle(0, 1, 0, y);
  const fore = h => K.mul(yawQ(h), K.mul(K.swingRot(0, 1.4, 0), K.DEFAULT_Q0));
  const rb = (h, kmh) => ({ heading: r(h), speed: (kmh || 12) / 3.6 });
  check('lineup: a slow swing (< 4 km/h) does not count', !K.lineup.valid(rb(10, 3)));
  check('lineup: a swing more than 45 deg off does not count', !K.lineup.valid(rb(50)) && K.lineup.valid(rb(20)));
  let L = K.lineup.result([r(14), r(17)], 1);
  check('lineup: two swings are not enough', !L.done, L);
  L = K.lineup.result([r(14), r(17), r(12)], 1);
  check('lineup: three agreeing swings -> done, hold = their median (14 deg)', L.done && near(deg(L.hold), 14, 0.01), deg(L.hold));
  L = K.lineup.result([r(-14), r(-17), r(-12)], -1);
  check('lineup: left-handed swings mirror to the same hold (14 deg)', L.done && near(deg(L.hold), 14, 0.01), deg(L.hold));
  L = K.lineup.result([r(15), r(19), r(-22)], 1);
  check('lineup: three swings 41 deg apart -> one more swing', !L.done && L.more, L);
  L = K.lineup.result([r(15), r(19), r(-22), r(14)], 1);
  check('lineup: ...and the fourth settles it on the median (14.5 deg)', L.done && near(deg(L.hold), 14.5, 0.01), deg(L.hold));
  L = K.lineup.result([r(40), r(-30), r(10), r(35), r(-20)], 1);
  check('lineup: five swings always finish', L.done, L);
  L = K.lineup.result([r(44), r(42), r(43)], 1);
  check('lineup: the hold is capped at 35 deg', L.done && near(deg(L.hold), 35, 0.01), deg(L.hold));
  const g = K.gripRef(fore(r(-30)), 0, { hold: r(30) });
  check('lineup: gripRef takes the learned hold (forearm 30 right, hold 30 -> lane at the phone zero)', near(deg(g.yaw), 0, 0.5), deg(g.yaw));
}

// --- the approach: a forward walk added to a forward throw (kin.js APPROACH)
{
  const ss = SW.gen({ peakW: 8, seed: 41 }), tr = K.createTrack();
  for (const s of ss) K.pushSample(tr, s);
  const rel = tr.events.find(e => e.kind === 'release');
  const a = K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER, { approach: 0 });
  const b = K.throwFrom(tr.samples, rel.t, K.laneRef(0), SHOULDER, { approach: APPROACH_V });
  check('approach: the default walk is 2 m/s (7.2 km/h)', near(APPROACH_V, 2.0, 1e-9), APPROACH_V);
  check('approach: adds its speed along the lane (forward speed +2 m/s, sideways unchanged)', near(-b.rb.v.z - -a.rb.v.z, 2.0, 0.05) && near(b.rb.v.x, a.rb.v.x, 1e-6), [a.rb.v, b.rb.v]);
  check('approach: the same sideways error turns into a smaller angle', Math.abs(b.rb.heading) <= Math.abs(a.rb.heading) + 1e-9, [deg(a.rb.heading), deg(b.rb.heading)]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
