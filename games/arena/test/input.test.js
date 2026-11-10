// Run: node games/arena/test/input.test.js
'use strict';
const assert = require('assert');
const I = require('../input.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const btns = (n, pressed = []) => Array.from({ length: n }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
// Chrome's hat switch encoding: -1 + (2/7) * direction (0 = up, clockwise), centred = 1.2857
const HAT = { up: -1, upRight: -0.7143, right: -0.4286, downRight: -0.1429, down: 0.1429, downLeft: 0.4286, left: 0.7143, upLeft: 1, centre: 1.2857 };

function mimicPad(axes = {}, pressed = []) {
  const a = [0, 0, 0, -1, -1, 0, 0, 0, 0, HAT.centre];
  Object.keys(axes).forEach(k => { a[+k] = axes[k]; });
  return { id: 'Mimic Gamepad (Vendor: 038f Product: 1201)', index: 1, connected: true, mapping: '', buttons: btns(16, pressed), axes: a };
}
const mimicMotion = () => ({ id: 'Mimic Motion (Vendor: 038f Product: 1200)', index: 0, connected: true, mapping: '', buttons: btns(12), axes: [0.1, 0.2, 0.3, 0, 0, 0] });
function xbox(axes = [0, 0, 0, 0], pressed = [], values = {}) {
  const b = btns(17, pressed);
  Object.keys(values).forEach(k => { b[+k] = { pressed: values[k] > 0.5, value: values[k] }; });
  return { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 2, connected: true, mapping: 'standard', buttons: b, axes };
}

const tests = {
  mappingTableMatchesMimicPadSpec() {
    const m = I.PAD_LAYOUTS.mimic;
    assert.deepStrictEqual(m.buttons, { a: 0, b: 1, x: 2, y: 3, l1: 4, r1: 5, l2: 6, r2: 7, select: 8, start: 9, l3: 10, r3: 11, home: 12 });
    assert.deepStrictEqual(m.axes, { lx: 0, ly: 1, rx: 2, ry: 5, lt: 3, rt: 4 });
    assert.strictEqual(m.hatAxis, 9);
  },
  actionsBindFireToRightTrigger() {
    assert.deepStrictEqual(I.ACTIONS.fire.pad, ['rt']);
    assert.deepStrictEqual(I.ACTIONS.aim.pad, ['lt']);
    assert.ok(I.ACTIONS.pause.pad.includes('start'));
  },
  classifiesPads() {
    assert.strictEqual(I.classifyPad(mimicPad()), 'mimic');
    assert.strictEqual(I.classifyPad(mimicMotion()), 'mimic-motion');
    assert.strictEqual(I.classifyPad(xbox()), 'standard');
    assert.strictEqual(I.classifyPad({ id: 'Some HID joystick', mapping: '', buttons: btns(10), axes: [0, 0] }), 'generic');
  },
  picksMimicGamepadOverMotionAndStandard() {
    const pad = mimicPad();
    assert.strictEqual(I.pickPad([mimicMotion(), xbox(), pad]), pad);
    assert.strictEqual(I.pickPad([null, mimicMotion()]), null, 'the 12-button motion controller is never used');
    const x = xbox();
    assert.strictEqual(I.pickPad([mimicMotion(), x]), x);
    assert.strictEqual(I.pickPad([]), null);
  },
  readsMimicSticksAndTriggers() {
    const s = I.readPad(mimicPad({ 0: 0.5, 1: -0.25, 2: 0.3, 5: 0.6, 3: -1, 4: 0.8 }, [7, 0]));
    assert.strictEqual(s.layout, 'mimic');
    near(s.lx, 0.5); near(s.ly, -0.25); near(s.rx, 0.3); near(s.ry, 0.6);
    near(s.lt, 0); near(s.rt, 0.9);
    assert.strictEqual(s.buttons.r2, true);
    assert.strictEqual(s.buttons.a, true);
    assert.strictEqual(s.buttons.b, false);
    assert.strictEqual(s.buttons.up, false);
  },
  mimicTriggerButtonCountsEvenIfAxisRests() {
    const s = I.readPad(mimicPad({}, [6]));
    near(s.lt, 1);
  },
  mimicTriggerAxisAloneCountsAsPressed() {
    const s = I.readPad(mimicPad({ 4: 0.2 })); // R2 axis 60% in, button not reported
    near(s.rt, 0.6);
    assert.strictEqual(s.buttons.r2, true);
  },
  untouchedMimicTriggerAxisAtZeroIsNotHalfPressed() {
    // before the first report Chrome can show 0 on every axis; 0 must not read as a half-pulled trigger
    const p = mimicPad({ 3: 0, 4: 0 });
    const s = I.readPad(p);
    near(s.lt, 0); near(s.rt, 0);
  },
  mimicHatDrivesDpad() {
    let s = I.readPad(mimicPad({ 9: HAT.left }));
    assert.strictEqual(s.buttons.left, true);
    assert.strictEqual(s.buttons.up, false);
    s = I.readPad(mimicPad({ 9: HAT.upRight }));
    assert.strictEqual(s.buttons.up, true);
    assert.strictEqual(s.buttons.right, true);
  },
  readsStandardPad() {
    const s = I.readPad(xbox([0.1, 0.2, -0.7, 0.4], [12, 9], { 6: 0.3, 7: 1 }));
    assert.strictEqual(s.layout, 'standard');
    near(s.rx, -0.7); near(s.ry, 0.4);
    near(s.lt, 0.3); near(s.rt, 1);
    assert.strictEqual(s.buttons.up, true);
    assert.strictEqual(s.buttons.start, true);
  },
  decodesHat() {
    const d = I.decodeHat;
    assert.deepStrictEqual(d(HAT.up), { up: true, down: false, left: false, right: false });
    assert.deepStrictEqual(d(HAT.upRight), { up: true, down: false, left: false, right: true });
    assert.deepStrictEqual(d(HAT.right), { up: false, down: false, left: false, right: true });
    assert.deepStrictEqual(d(HAT.downRight), { up: false, down: true, left: false, right: true });
    assert.deepStrictEqual(d(HAT.down), { up: false, down: true, left: false, right: false });
    assert.deepStrictEqual(d(HAT.downLeft), { up: false, down: true, left: true, right: false });
    assert.deepStrictEqual(d(HAT.left), { up: false, down: false, left: true, right: false });
    assert.deepStrictEqual(d(HAT.upLeft), { up: true, down: false, left: true, right: false });
    const none = { up: false, down: false, left: false, right: false };
    assert.deepStrictEqual(d(HAT.centre), none);
    assert.deepStrictEqual(d(3.2857), none);
    assert.deepStrictEqual(d(0), none, 'an axis that never reported reads 0: treat as centred');
    assert.deepStrictEqual(d(NaN), none);
    assert.deepStrictEqual(d(undefined), none);
    assert.deepStrictEqual(d(-0.69), d(HAT.upRight), 'small noise still decodes');
  },
  radialDeadzoneZeroesSmallInput() {
    const r = I.radialDeadzone(0.05, 0.06, 0.12, 0.95);
    assert.strictEqual(r.x, 0); assert.strictEqual(r.y, 0); assert.strictEqual(r.m, 0);
  },
  radialDeadzoneRescalesSmoothly() {
    // just past the inner edge is near 0, not a jump
    const a = I.radialDeadzone(0.13, 0, 0.12, 1);
    assert.ok(a.x > 0 && a.x < 0.02);
    const b = I.radialDeadzone(0.56, 0, 0.12, 1);
    near(b.x, 0.5);
    const c = I.radialDeadzone(1, 0, 0.12, 0.95);
    near(c.x, 1);
  },
  radialDeadzoneKeepsDirectionAndClamps() {
    const r = I.radialDeadzone(0.9, 0.9, 0.1, 0.9);
    near(r.m, 1);
    near(r.x, Math.SQRT1_2); near(r.y, Math.SQRT1_2);
    const q = I.radialDeadzone(-0.3, 0.4, 0.1, 1); // m = 0.5
    near(Math.atan2(q.y, q.x), Math.atan2(0.4, -0.3));
    // radial, not per-axis: a mostly-horizontal push keeps its small vertical part
    const s = I.radialDeadzone(0.8, 0.08, 0.12, 1);
    assert.ok(s.y > 0);
  },
  responseCurve() {
    near(I.responseCurve(0.5, 2), 0.25);
    near(I.responseCurve(-0.5, 2), -0.25);
    near(I.responseCurve(1, 3), 1);
    near(I.responseCurve(0.5, 1), 0.5);
  },
  lookAccelerationRampsOnlyAtFullDeflection() {
    const opts = { accelThreshold: 0.9, accelDelay: 0.15, accelRamp: 0.35, accelBoost: 0.8 };
    let st = I.createLookState();
    for (let i = 0; i < 60; i++) st = I.lookAccelStep(st, 0.5, 1 / 60, opts);
    near(st.mult, 1);
    for (let i = 0; i < 60; i++) st = I.lookAccelStep(st, 1, 1 / 60, opts);
    near(st.mult, 1.8, 0.01);
    st = I.lookAccelStep(st, 0.2, 1 / 60, opts);
    near(st.mult, 1, 1e-9);
  },
  processStickLookGivesRates() {
    const opts = { deadzone: 0.1, outer: 0.95, curve: 2, yawSpeed: 4, pitchSpeed: 2.5, invertY: false, accelThreshold: 0.9, accelDelay: 0.15, accelRamp: 0.35, accelBoost: 0.6 };
    const st = I.createLookState();
    let r = I.processStickLook(0.05, 0.05, st, 1 / 60, opts);
    assert.strictEqual(r.yawRate, 0); assert.strictEqual(r.pitchRate, 0);
    r = I.processStickLook(1, 0, I.createLookState(), 1 / 60, opts);
    near(r.yawRate, -4, 0.01, 'right stick right turns right = negative yaw (three.js)');
    r = I.processStickLook(0, 1, I.createLookState(), 1 / 60, opts);
    assert.ok(r.pitchRate < 0, 'stick down looks down');
    r = I.processStickLook(0, 1, I.createLookState(), 1 / 60, Object.assign({}, opts, { invertY: true }));
    assert.ok(r.pitchRate > 0, 'inverted');
  },

  // A phone touch stick is short-throw: the thumb reaches the rim with a tiny move. It needs a
  // gentler profile than a real stick: slower top speed, more curve, no look acceleration.
  lookProfileForPhoneStickIsGentler() {
    const user = { padSens: 1, deadzone: 0.12, curve: 1.8, accel: true, invertY: false };
    const real = I.lookProfile('standard', user), phone = I.lookProfile('mimic', user);
    assert.ok(phone.yawSpeed < real.yawSpeed * 0.8, 'slower top turn speed');
    assert.ok(phone.curve > real.curve, 'more curve for fine aim near centre');
    assert.strictEqual(phone.accelBoost, 0, 'no look acceleration (the rim is too easy to reach)');
    assert.ok(real.accelBoost > 0, 'real sticks keep acceleration');
    assert.ok(phone.smooth > 0 && real.smooth === 0, 'phone input is smoothed, real sticks are not');
  },
  smoothingCalmsJitterButFollowsIntent() {
    const st = { y: 0, p: 0 };
    let out;
    for (let i = 0; i < 30; i++) out = I.smoothLook(st, 2, 0, 0.35);   // steady push settles near target
    near(out.yaw, 2, 0.05, 'converges to a steady push');
    const st2 = { y: 0, p: 0 };
    out = I.smoothLook(st2, 2, 0, 0.35);
    assert.ok(out.yaw > 0.5 && out.yaw < 1.5, 'one-frame spike is softened');
  },

  // Tuned on a real 7-minute Pad-mode session (recordings/arena-20261109-023329): the phone only
  // starts sending once the thumb is 12% out (AnchoredStick deadzone 0.12, seen as 0.114 after
  // 8-bit), and 56% of aim strokes peaked under half deflection, where the old 2.4 power curve
  // turned 2-6 deg/s. The phone profile must make that inner half useful without a twitchy rim.
  phoneDeadzoneSitsJustUnderThePhonesOwnEngageThreshold() {
    const phone = I.lookProfile('mimic', { padSens: 1, deadzone: 0.12, curve: 1.8, accel: true, invertY: false });
    assert.ok(phone.deadzone >= 0.08 && phone.deadzone < 0.114, 'no throw wasted under the phone threshold');
    const first = I.processStickLook(0.1137, 0, I.createLookState(), 1 / 60, phone); // first value the phone sends
    const degS = Math.abs(first.yawRate) * 180 / Math.PI;
    assert.ok(degS > 0 && degS < 3, `first touch moves, but only a crawl (${degS.toFixed(2)} deg/s)`);
    const bigger = I.lookProfile('mimic', { padSens: 1, deadzone: 0.25, curve: 1.8, accel: true, invertY: false });
    near(bigger.deadzone, 0.25, 1e-9, 'a larger dead zone the player chose is still honoured');
  },
  phoneStickInnerHalfTurnsAtAimingSpeeds() {
    const phone = I.lookProfile('mimic', { padSens: 1, deadzone: 0.12, curve: 1.8, accel: true, invertY: false });
    const degS = x => Math.abs(I.processStickLook(x, 0, I.createLookState(), 1 / 60, phone).yawRate) * 180 / Math.PI;
    assert.ok(degS(0.3) >= 12 && degS(0.3) <= 22, `0.3 tilt tracks a walking enemy (${degS(0.3).toFixed(1)} deg/s)`);
    assert.ok(degS(0.5) >= 30 && degS(0.5) <= 45, `half tilt is a usable correction (${degS(0.5).toFixed(1)} deg/s)`);
    near(degS(1), phone.yawSpeed * 180 / Math.PI, 0.01, 'the rim keeps the same top speed');
    // smooth: one 8-bit step (1/127.5) changes the turn rate by under 1.5 deg/s in the aiming zone
    // (up to 0.6 tilt; old curve 1.45) and under 3 deg/s at the rim (old curve 2.9)
    let prev = degS(0.1137), worstIn = 0, worst = 0;
    for (let v = 0.1137 + 1 / 127.5; v <= 1; v += 1 / 127.5) {
      const d = degS(v); assert.ok(d >= prev - 1e-9, 'monotonic');
      worst = Math.max(worst, d - prev); if (v <= 0.6) worstIn = Math.max(worstIn, d - prev); prev = d;
    }
    assert.ok(worstIn < 1.5 && worst < 3, `largest step ${worstIn.toFixed(2)} inner, ${worst.toFixed(2)} deg/s overall`);
  },
  phoneCurveSettingStillMeansFinerCentre() {
    const at = c => { const p = I.lookProfile('mimic', { padSens: 1, deadzone: 0.12, curve: c, accel: true, invertY: false }); return Math.abs(I.processStickLook(0.3, 0, I.createLookState(), 1 / 60, p).yawRate); };
    assert.ok(at(1.0) > at(1.8) && at(1.8) > at(3.0), 'more curve = slower centre');
  },
  phoneSmoothingIsTheSameAtAnyFrameRate() {
    // the session ran at ~24 fps; per-frame smoothing lagged 2.5x longer there than at 60 fps
    const phone = I.lookProfile('mimic', { padSens: 1, deadzone: 0.12, curve: 1.8, accel: true, invertY: false });
    const coast = fps => {   // turn 40 deg/s, release, measure how far the view keeps going
      const st = { y: 0, p: 0 }, dt = 1 / fps; let deg = 0;
      for (let i = 0; i < fps; i++) I.smoothLook(st, 40, 0, I.smoothAlpha(dt, phone.smoothTau));
      for (let i = 0; i < fps; i++) deg += I.smoothLook(st, 0, 0, I.smoothAlpha(dt, phone.smoothTau)).yaw * dt;
      return deg;
    };
    assert.ok(Math.abs(coast(24) - coast(60)) < 0.4, `coast 24fps ${coast(24).toFixed(2)} vs 60fps ${coast(60).toFixed(2)}`);
    assert.ok(coast(24) < 1.5, 'releasing the stick stops the view within about a degree');
    near(I.smoothAlpha(1 / 60, 0), 1, 1e-9, 'tau 0 = no smoothing');
  },
  standardPadLookIsUnchanged() {
    const user = { padSens: 1, deadzone: 0.12, curve: 1.8, accel: true, invertY: false };
    const real = I.lookProfile('standard', user);
    assert.strictEqual(real.inner, undefined);
    const r = I.processStickLook(0.5, 0, I.createLookState(), 1 / 60, real);
    near(r.yawRate, -Math.pow((0.5 - 0.12) / (0.95 - 0.12), 1.8) * 3.6, 1e-9);
  },

  // the on-screen key guide: always says what each button does, and makes the shop obvious
  guideNamesPhoneButtonsForPad() {
    const g = I.guide('pad', 'live');
    const keys = g.rows.map(r => r[0]);
    ['R2', 'L2', 'X', 'A', 'B', 'SELECT', 'START'].forEach(k => assert.ok(keys.some(x => x.includes(k)), k));
    assert.ok(g.rows.find(r => r[0].includes('R2'))[1].toLowerCase().includes('fire'));
  },
  guideShowsKeyboardKeys() {
    const keys = I.guide('kbm', 'live').rows.map(r => r[0]);
    ['WASD', 'R', 'B', 'Tab', 'Esc'].forEach(k => assert.ok(keys.some(x => x.includes(k)), k));
  },
  guidePutsShopFirstAndHotDuringBuy() {
    const g = I.guide('pad', 'buy');
    assert.ok(g.rows[0][0].includes('SELECT') && /shop/i.test(g.rows[0][1]) && g.rows[0][2] === 'hot');
    assert.ok(/shop|buy/i.test(g.goal));
    const live = I.guide('pad', 'live');
    assert.ok(!live.rows.some(r => r[2] === 'hot'), 'nothing flashing once the round is live');
    assert.ok(live.rows.find(r => r[0].includes('SELECT'))[1].toLowerCase().includes('score'));
  },
  guideForTheGullAfterlife() {
    // the gull reads fire (dive), jump (climb) and crouch (sink): the guide must name those buttons
    const pad = I.guide('pad', 'gull'), kbm = I.guide('kbm', 'gull');
    const row = (g, k) => g.rows.find(r => r[0] === k);
    assert.ok(I.ACTIONS.fire.pad.includes('rt') && /dive/i.test(row(pad, 'R2')[1]) && row(pad, 'R2')[2] === 'hot');
    assert.ok(I.ACTIONS.jump.pad.includes('a') && /climb/i.test(row(pad, 'A')[1]));
    assert.ok(I.ACTIONS.crouch.pad.includes('b') && /sink/i.test(row(pad, 'B')[1]));
    assert.ok(/dive/i.test(row(kbm, 'Left click')[1]) && /climb/i.test(row(kbm, 'Space')[1]));
    assert.ok(/gull/i.test(pad.goal));
  },
  guideCanBeHidden() {
    assert.ok(I.ACTIONS.guide.pad.includes('home') && I.ACTIONS.guide.keys.includes('KeyH'));
    assert.ok(I.guide('pad', 'live').rows.some(r => r[0] === 'HOME' && /hide/i.test(r[1])));
  },
  padsForPicksTheRightControllers() {
    const pad0 = Object.assign(mimicPad(), { index: 0 }), pad1 = Object.assign(mimicPad(), { index: 1 }), motion = Object.assign(mimicMotion(), { index: 2 }), xb = Object.assign(xbox(), { index: 3 });
    const list = [pad0, pad1, motion, xb];
    assert.deepStrictEqual(I.padsFor('auto', list).map(p => p.index), [0]);
    assert.deepStrictEqual(I.padsFor('all', list).map(p => p.index), [0, 1, 3], 'menus take every play pad, never the motion controller');
    assert.deepStrictEqual(I.padsFor({ pad: 1 }, list).map(p => p.index), [1]);
    assert.deepStrictEqual(I.padsFor({ pad: 2 }, list).map(p => p.index), [], 'a split-screen slot never binds the motion controller');
    assert.deepStrictEqual(I.padsFor({ kbm: true, pad: null }, list), []);
  },
  mergedPadsOrButtonsAndTakeTheStrongestStick() {
    const a = I.readPad(mimicPad({ 0: 0.2, 2: -0.9 }, [0]));
    const b = I.readPad(mimicPad({ 0: -0.8, 5: 0.1 }, [1]));
    const m = I.mergePadStates([a, b]);
    assert.ok(m.buttons.a && m.buttons.b && !m.buttons.x);
    near(m.lx, -0.8); near(m.rx, -0.9);
    assert.strictEqual(I.mergePadStates([]), null);
    assert.strictEqual(I.mergePadStates([a]), a);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
