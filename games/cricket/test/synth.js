// Synthetic phone motion for the tests: an overarm bowling action and a bat swing, sampled like
// the phone streams them (~125 Hz, timestamped, HOLD as button a).
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'bowl.js'));

/**
 * Overarm action. The arm angle from vertical goes phi(t) = A tanh((t - tv) / tau), fastest
 * (peakW rad/s) as it passes straight up at tv. o: { peakW, yaw (plane heading, + right),
 * rho0 (wrist roll at release, + clockwise), twist (rad/s at release), upOffset (ms: HOLD comes up
 * this much after the ideal moment + the lag), lean (phone rolled in the fist, rad), hz }.
 * Returns { samples [{t, q, a}], tUp, tIdeal }.
 */
function overarm(o) {
  o = Object.assign({ peakW: 20, yaw: 0, rho0: 0, twist: 0, upOffset: 0, lean: 0, hz: 125 }, o);
  const A = 2.4, tau = A / o.peakW, tv = 1000;
  const phiIdeal = -B.BOWL.IDEAL_ELEV;
  const tIdeal = tv + tau * Math.atanh(phiIdeal / A) * 1000;
  const tUp = tIdeal + B.BOWL.LAG + o.upOffset;
  const out = [], dt = 1000 / o.hz;
  for (let t = tv - 700; t <= tv + 400; t += dt) {
    const k = (t - tv) / 1000 / tau;
    const phi = A * Math.tanh(k);
    const rho = o.rho0 + o.twist * tau * Math.tanh(k);
    let q = B.armQuat(phi, o.yaw, rho);
    if (o.lean) q = B.mul(q, B.axisAngle(0, 0, -1, o.lean));   // the phone sits rolled in the fist
    out.push({ t, q, a: t < tUp });
  }
  return { samples: out, tUp, tIdeal, tau };
}

/**
 * A bat swing (phone = handle, top = blade). The bat turns about a horizontal axis through the
 * hands in a plane whose heading is `dir` (+ = toward the batter's right / off side for a
 * right-hander), from the backlift over the shoulder (theta = -150 deg) through hanging straight
 * down (theta = 0) to the follow-through. Fastest (peakW) at tPeak (ms), where theta = thetaPeak.
 * plane: 'vertical' (straight bat; thetaPeak > 0 = met after the bottom of the arc, rising) or
 * 'flat' (cross bat sweeping level: sweep +1 round to the leg side, -1 to the off side; lift tilts
 * the blade up, rad).
 */
function batSwing(o) {
  o = Object.assign({ peakW: 18, dir: 0, tPeak: 1000, thetaPeak: 0, plane: 'vertical', lift: 0, sweep: 1, hz: 125, t0: 300, t1: 1500 }, o);
  const A = 2.2, tau = A / o.peakW, out = [], dt = 1000 / o.hz;
  for (let t = o.t0; t <= o.t1; t += dt) {
    const k = (t - o.tPeak) / 1000 / tau;
    const th = o.thetaPeak + A * Math.tanh(k);
    out.push({ t, q: batQuat(th, o.dir, o.plane, o.lift, o.sweep), a: false });
  }
  return out;
}
/** Bat orientation: forward (phone top) = the blade (bat.js batQuat). */
const batQuat = (theta, dir, plane, lift, sweep) => require(path.join(__dirname, '..', 'bat.js')).batQuat(theta, dir, plane, lift, sweep);

module.exports = { overarm, batSwing, batQuat };
