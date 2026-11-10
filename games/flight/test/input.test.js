// Run: node games/flight/test/input.test.js  -- the Mimic Pad's D-pad is a hat on axis 9
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = { Math, console, Map, Set }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'input.js'), 'utf8'), ctx);
const hat = ctx.FlightInputHat;
const v = i => -1 + (2 / 7) * i;          // Chrome's hat encoding, 0 = up, clockwise
const t = {
  centredIsNothing() { const d = hat(1.2857); assert.ok(!d.up && !d.down && !d.left && !d.right); },
  missingIsNothing() { const d = hat(undefined); assert.ok(!d.up && !d.down && !d.left && !d.right); },
  up() { const d = hat(v(0)); assert.ok(d.up && !d.down && !d.left && !d.right); },
  right() { const d = hat(v(2)); assert.ok(d.right && !d.up); },
  down() { const d = hat(v(4)); assert.ok(d.down && !d.left); },
  left() { const d = hat(v(6)); assert.ok(d.left && !d.down); },
  diagonalUpRight() { const d = hat(v(1)); assert.ok(d.up && d.right); },
  // the phone: tilt is read against gravity, so twisting it (or the phone's own slow yaw drift)
  // never leaks into pitch or roll, even when the neutral pose is not flat
  twistDoesNotLeakIntoRoll() {
    const P = ctx.FlightInputPhone;
    const neutral = P.attitude(P.fromEuler(0, 20 * DEG, 0));           // held 20 deg nose-up
    const a = P.relative(P.attitude(P.fromEuler(15 * DEG, 20 * DEG, 0)), neutral);   // twisted 15 deg
    assert.ok(Math.abs(a.roll) < 0.3 * DEG && Math.abs(a.pitch) < 0.3 * DEG, JSON.stringify(a));
    assert.ok(Math.abs(a.yaw - 15 * DEG) < 0.5 * DEG, 'twist is reported as yaw');
  },
  bankAndPitchAreRelativeToNeutral() {
    const P = ctx.FlightInputPhone;
    const neutral = P.attitude(P.fromEuler(0.4, 10 * DEG, 0));
    const a = P.relative(P.attitude(P.fromEuler(0.4, 2 * DEG, -12 * DEG)), neutral);
    assert.ok(Math.abs(a.pitch + 8 * DEG) < 0.5 * DEG && Math.abs(a.roll + 12 * DEG) < 0.5 * DEG, JSON.stringify(a));
  },
  yawWashoutForgetsAHeldTwist() {
    const P = ctx.FlightInputPhone;
    let y0 = 0; for (let t = 0; t < 30; t += 1 / 60) y0 = P.washout(y0, 0.3, 1 / 60, 6);
    assert.ok(Math.abs(0.3 - y0) < 0.01, 'after 30 s a held 17 deg twist (or drift) is the new neutral');
    let y1 = 0; for (let t = 0; t < 0.5; t += 1 / 60) y1 = P.washout(y1, 0.3, 1 / 60, 6);
    assert.ok(0.3 - y1 > 0.25, 'but a quick twist still steers');
  },
};
const DEG = Math.PI / 180;
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
