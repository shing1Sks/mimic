// Run: node games/lib/test/mimic.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const clock = { t: 0 };
function load(hid, pads) {
  const ctx = {
    performance: { now: () => clock.t },
    navigator: { getGamepads: () => (pads ? pads() : []), hid },
    addEventListener() {}, innerWidth: 1000, innerHeight: 1000,
    Math, Promise, Uint8Array, console,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mimic.js'), 'utf8'), ctx);
  return ctx;
}
const { MimicMath, MimicController } = load(undefined);
const yawQ = deg => MimicMath.fromEuler(deg * Math.PI / 180, 0, 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const I = { x: 0, y: 0, z: 0, w: 1 };

// ---- fake phones: a Wand/Grip pad as Chrome shows it, axes = value / 32767 ----
const WAND = 0x9, GRIP = 0x6;
/** Like the app's MotionSig.sign: low bit of each axis = mode code (axes 0..3) and tag (4..5). */
function sign(ints, mode, tag) {
  const bits = (mode & 15) | ((tag & 3) << 4);
  return ints.map((v, i) => ((v & 1) === (bits >> i & 1) ? v : v > 0 ? v - 1 : v + 1));
}
function mkPad(index) {
  const p = { index, id: 'Mimic (Vendor: 038f Product: 1200)', connected: true,
    axes: [0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })) };
  /** phone-frame quaternion (w >= 0) + accel; mode/tag = signature, or none (old app) */
  p.set = (q, mode, tag = 0, jitter = 0) => {
    let ints = [q.x, q.y, q.z].map(c => Math.round(c * 32767)).concat([0, 0, 4096 + jitter]);
    if (mode) ints = sign(ints, mode, tag);
    p.axes = ints.map(v => v / 32767);
  };
  p.press = (i, on) => { p.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  return p;
}
const phoneQ = (axis, deg) => {
  const h = deg * Math.PI / 360, s = Math.sin(h);
  const q = { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(h) };
  return q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
};
const devMk = name => ({ name, opened: true, vendorId: 0x038f, productId: 0x1200,
  collections: [{ outputReports: [{ reportId: 3 }] }], got: [],
  sendReport: async function (id, data) { this.got.push([id, Array.from(data)]); } });

const tests = {
  restPoseHandInFrontBelowShoulder() {
    const p = MimicMath.armPose(I, 'right');
    assert(p.hand.z < p.shoulder.z - 0.2, 'hand in front of shoulder');
    assert(p.hand.y < p.shoulder.y, 'hand below shoulder');
  },
  yaw90MovesHandSideways() {
    const a = MimicMath.armPose(I, 'right').hand, b = MimicMath.armPose(yawQ(-90), 'right').hand;
    assert(Math.abs(b.x - a.x) > 0.3, 'moved ' + (b.x - a.x));
  },
  smallRotationMovesHandLittle() {
    const a = MimicMath.armPose(I, 'right').hand;
    assert(dist(a, MimicMath.armPose(yawQ(10), 'right').hand) < 0.08);
    assert(dist(a, MimicMath.armPose(yawQ(90), 'right').hand) > 0.3);
  },
  leftHandMirrors() {
    const r = MimicMath.armPose(yawQ(-30), 'right').hand, l = MimicMath.armPose(yawQ(30), 'left').hand;
    assert(Math.abs(r.x + l.x) < 1e-9 && Math.abs(r.y - l.y) < 1e-9 && Math.abs(r.z - l.z) < 1e-9);
  },
  controllerExposesArm() {
    const mc = new MimicController(); mc.update(0);
    assert(mc.arm && mc.arm.hand && mc.arm.handVelocity, 'arm present');
  },
  async rumbleWithoutHidResolvesFalse() {
    const mc = new MimicController();
    assert.strictEqual(await mc.rumble(1, 50), false);
    assert.strictEqual(await mc.enableRumble(), false);
  },
  async rumbleSurvivesReconnect() {
    // the phone drops (Bluetooth blip, app restart) and Chrome hands out a new HIDDevice
    const listeners = {};
    const mk = () => ({ opened: true, vendorId: 0x038f, productId: 0x1200,
      collections: [{ outputReports: [{ reportId: 3 }] }], sent: 0,
      sendReport: async function () { this.sent++; } });
    let current = mk();
    const hid = { getDevices: async () => [current], requestDevice: async () => [current],
      addEventListener: (t, fn) => { listeners[t] = fn; } };
    const ctx = load(hid);
    const mc = new ctx.MimicController();
    assert.strictEqual(await mc.enableRumble(), true);
    const old = current;
    listeners.disconnect({ device: old });
    assert.strictEqual(mc.rumbleReady, false, 'disconnect clears rumble');
    current = mk();
    await listeners.connect({ device: current });
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(mc.rumbleReady, true, 'reconnect re-acquires');
    assert.strictEqual(await mc.rumble(1, 50), true);
    assert.strictEqual(current.sent, 2, 'tagged, then the rumble, on the new device');
  },
  async chooserShowsAtMostOncePerPage() {
    // games call enableRumble() on every click; a cancelled chooser must not come back each time
    let asked = 0;
    const ctx = load({ getDevices: async () => [], requestDevice: async () => { asked++; return []; } });
    const mc = new ctx.MimicController();
    assert.strictEqual(await mc.enableRumble(), false);
    assert.strictEqual(await mc.enableRumble(), false);
    assert.strictEqual(await new ctx.MimicController().enableRumble(), false);
    assert.strictEqual(asked, 1, 'chooser shown ' + asked + ' times');
    await mc.enableRumble({ ask: true });          // an explicit "enable vibration" button may ask again
    assert.strictEqual(asked, 2);
  },
  async rumbleSendsReport3() {
    const sent = [];
    const dev = { opened: true, vendorId: 0x038f, productId: 0x1200,
      collections: [{ outputReports: [{ reportId: 3 }] }],
      sendReport: async (id, data) => { sent.push([id, Array.from(data)]); } };
    const ctx = load({ getDevices: async () => [dev], requestDevice: async () => [dev] });
    const mc = new ctx.MimicController();
    assert.strictEqual(await mc.enableRumble(), true);
    assert.deepStrictEqual(sent, [[3, [0, 0, 0x80]]], 'the tag, once');
    assert.strictEqual(await mc.rumble(1, 300, 0), true);
    assert.deepStrictEqual(sent, [[3, [0, 0, 0x80]], [3, [255, 255, 0]]]);
  },

  // ---- several phones ----
  slotsReadTheirOwnPhone() {
    const a = mkPad(0), b = mkPad(1);
    a.set(phoneQ([0, 0, 1], 30)); b.set(phoneQ([0, 0, 1], -50));
    b.press(0, true);
    const ctx = load(undefined, () => [a, b]);
    const m0 = new ctx.MimicController(), m1 = new ctx.MimicController({ slot: 1 });
    m0.update(0); m1.update(0);
    assert(m0.connected && m1.connected);
    assert(m0.yaw > 0.4 && m1.yaw < -0.7, 'yaws ' + m0.yaw + ' ' + m1.yaw);
    assert(!m0.isDown('a') && m1.isDown('a'), 'buttons are per phone');
    assert.strictEqual(m0.slot, 0); assert.strictEqual(m1.slot, 1);
  },
  allListsMotionPadsInIndexOrderAndKeepsObjects() {
    const a = mkPad(0), b = mkPad(2);
    const pad16 = { index: 1, id: 'Mimic pad', connected: true, axes: [0, 0, 0, 0, 0, 0],
      buttons: new Array(16).fill({ pressed: false }) };
    let list = [a, pad16, b];
    const ctx = load(undefined, () => list);
    assert.strictEqual(typeof ctx.MimicController.all, 'function');
    const all = ctx.MimicController.all();
    assert.strictEqual(all.length, 2, 'the 16-button Pad phone is not a motion controller');
    assert.deepStrictEqual(Array.from(all, c => c.slot), [0, 1]);
    assert.strictEqual(ctx.MimicController.all()[1], all[1], 'same objects each call');
    list = [a];
    assert.strictEqual(ctx.MimicController.all().length, 1);
  },
  emptySlotHasNoFallback() {
    const a = mkPad(0); a.set(phoneQ([0, 0, 1], 10));
    const ctx = load(undefined, () => [a]);
    const m1 = new ctx.MimicController({ slot: 1 }); m1.update(0);
    assert.strictEqual(m1.connected, false);
    assert.strictEqual(m1.source, 'none');
    assert.strictEqual(m1.mode, null);
    const m0 = new ctx.MimicController(); m0.update(0);
    assert.strictEqual(m0.source, 'phone');
  },
  defaultConstructorUnchangedWithoutPhone() {
    const mc = new MimicController(); mc.update(0);
    assert.strictEqual(mc.slot, 0); assert.strictEqual(mc.source, 'mouse'); assert.strictEqual(mc.mode, 'mouse');
    assert.strictEqual(mc.connected, false);
  },

  // ---- mode from the low-bit signature ----
  modeGripAfterSeveralSignedSamples() {
    const a = mkPad(0);
    const ctx = load(undefined, () => [a]);
    const mc = new ctx.MimicController();
    for (let i = 0; i < 5; i++) { a.set(phoneQ([0, 0, 1], 10 + i), GRIP, 0, i * 7); mc.update(i * 16); }
    assert.strictEqual(mc.mode, 'wand', 'not sure yet: default wand');
    for (let i = 5; i < 8; i++) { a.set(phoneQ([0, 0, 1], 10 + i), GRIP, 0, i * 7); mc.update(i * 16); }
    assert.strictEqual(mc.mode, 'grip');
    mc.update(200);   // the same sample read again (no new report) changes nothing
    assert.strictEqual(mc.mode, 'grip');
  },
  modeWandForWandSignatureAndForOldApps() {
    const a = mkPad(0), b = mkPad(1);
    const ctx = load(undefined, () => [a, b]);
    const ma = new ctx.MimicController(), mb = new ctx.MimicController({ slot: 1 });
    let grips = 0;
    for (let i = 0; i < 300; i++) {
      a.set(phoneQ([0.36, 0.48, 0.8], i * 0.7), WAND, 0, i * 3);
      b.set(phoneQ([0.6, 0.0, 0.8], i * 1.3), null, 0, (i * 7919) % 97);   // unsigned: an older app
      ma.update(i * 16); mb.update(i * 16);
      if (mb.mode === 'grip') grips++;
    }
    assert.strictEqual(ma.mode, 'wand');
    assert.strictEqual(mb.mode, 'wand');
    assert.strictEqual(grips, 0, 'an older app never reads as grip');
  },
  signatureMovesAxesByAtMostOneCount() {
    const ints = [0, -1, 32767, -32767, 1234, -5678];
    for (const m of [WAND, GRIP]) for (let t = 0; t < 4; t++)
      sign(ints, m, t).forEach((v, i) => assert(Math.abs(v - ints[i]) <= 1 && Math.abs(v) <= 32767));
  },

  // ---- WebHID: tag each phone once, then per-slot rumble ----
  async eachPhoneIsTaggedOnceAndNothingAsksForMotion() {
    const d0 = devMk('d0'), d1 = devMk('d1');
    const ctx = load({ getDevices: async () => [d0, d1], requestDevice: async () => [] });
    const mc = new ctx.MimicController();
    await mc.enableRumble();
    assert.deepStrictEqual(d0.got, [[3, [0, 0, 0x80]]], 'control byte: 0x80 | tag 0');
    assert.deepStrictEqual(d1.got, [[3, [0, 0, 0x81]]], 'second phone: tag 1');
    for (const t of [1000, 2500, 9000]) { clock.t = t; mc.update(); await 0; }
    assert.strictEqual(d0.got.length + d1.got.length, 2, 'no heartbeat while update() runs');
    assert(!Object.prototype.hasOwnProperty.call(ctx.MimicController, 'requestMotion'));
    clock.t = 0;
  },
  async rumbleGoesToTheSlotsPhone() {
    const d0 = devMk('d0'), d1 = devMk('d1');   // tags 0 and 1, in grant order
    const a = mkPad(0), b = mkPad(1);
    const ctx = load({ getDevices: async () => [d0, d1], requestDevice: async () => [] }, () => [a, b]);
    const m0 = new ctx.MimicController(), m1 = new ctx.MimicController({ slot: 1 });
    await m0.enableRumble();
    // crossed on purpose: the phone on pad 0 echoes tag 1 (d1), the one on pad 1 tag 0 (d0)
    for (let i = 0; i < 8; i++) {
      a.set(phoneQ([0, 0, 1], i), WAND, 1, i); b.set(phoneQ([0, 1, 0], i), GRIP, 0, i);
      m0.update(i); m1.update(i);
    }
    d0.got.length = 0; d1.got.length = 0;
    await m1.rumble(1, 100, 0);
    assert.deepStrictEqual([d0.got.length, d1.got.length], [1, 0], 'slot 1 -> its own phone only');
    await m0.rumble(0.5, 50, 1);
    assert.deepStrictEqual([d0.got.length, d1.got.length], [1, 1]);
    assert.deepStrictEqual(d1.got[0], [3, [128, 50, 1]]);
  },
  async rumbleWithoutTagsGoesToAll() {
    const d0 = devMk('d0'), d1 = devMk('d1');
    const a = mkPad(0); a.set(phoneQ([0, 0, 1], 5));   // older app: no signature
    const ctx = load({ getDevices: async () => [d0, d1], requestDevice: async () => [] }, () => [a]);
    const mc = new ctx.MimicController(); await mc.enableRumble();
    d0.got.length = 0; d1.got.length = 0; mc.update(0);
    assert.strictEqual(await mc.rumble(1, 10), true);
    assert.deepStrictEqual([d0.got.length, d1.got.length], [1, 1]);
  },

  // ---- arm model: elbow continuity past 180 deg (opt-in) ----
  qpowFollowEqualsQpowBelowHalfTurn() {
    const st = {};
    for (let d = -170; d <= 170; d += 10) {
      const q = phoneQ([0.6, 0, 0.8], d), a = MimicMath.qpow(q, 0.4), b = MimicMath.qpowFollow(q, 0.4, st, 0.02);
      ['x', 'y', 'z', 'w'].forEach(k => assert(Math.abs(a[k] - b[k]) < 1e-12, d + ' ' + k));
    }
  },
  continuousArmIsIdenticalForSmallRotations() {
    const a = mkPad(0);
    const ctx = load(undefined, () => [a]);
    const plain = new ctx.MimicController(), cont = new ctx.MimicController({ continuousArm: true });
    for (let i = 0; i < 120; i++) {
      a.set(phoneQ([0.36, 0.48, 0.8], 80 * Math.sin(i / 9)), WAND, 0, i);
      plain.update(i * 16); cont.update(i * 16);
      ['x', 'y', 'z'].forEach(k => assert(Math.abs(plain.arm.hand[k] - cont.arm.hand[k]) < 1e-12));
    }
  },
  continuousArmDoesNotFlipPastHalfTurn() {
    const a = mkPad(0);
    const ctx = load(undefined, () => [a]);
    const plain = new ctx.MimicController(), cont = new ctx.MimicController({ continuousArm: true });
    let maxPlain = 0, maxCont = 0, prevP = null, prevC = null;
    for (let d = 120; d <= 240; d += 1) {
      a.set(phoneQ([0, 0.6, 0.8], d), WAND, 0, d);
      plain.update(d * 16); cont.update(d * 16);
      if (prevP) { maxPlain = Math.max(maxPlain, dist(prevP, plain.arm.hand)); maxCont = Math.max(maxCont, dist(prevC, cont.arm.hand)); }
      prevP = plain.arm.hand; prevC = cont.arm.hand;
    }
    assert(maxPlain > 0.15, 'the short-way arm does jump (' + maxPlain.toFixed(3) + ' m)');
    assert(maxCont < 0.03, 'continuous arm steps at most ' + maxCont.toFixed(3) + ' m');
  },
  singlePlayerUsesWhicheverPhoneIsSending() {
    // the app's Bluetooth pad is paired but idle (app in the background), a browser phone moves
    const idle = mkPad(0), web = mkPad(1); web.id = 'Mimic Web Android (Vendor: 038f Product: 1200)';
    web.set(phoneQ([1, 0, 0], 30), GRIP);
    const ctx = load(undefined, () => [idle, web]);
    const mc = new ctx.MimicController();
    mc.update(1);
    assert(mc.connected && mc.via === 'browser', 'reads the browser phone: ' + mc.connected + ' ' + mc.via);
    const slots = ctx.MimicController.all();
    slots.forEach(c => c.update(2));
    assert(!slots[0].connected && slots[1].connected, 'multiplayer slots stay one per pad');
  },
  keyNamesFollowTheController() {
    const app = mkPad(0); app.set(phoneQ([1, 0, 0], 30), GRIP);
    let ctx = load(undefined, () => [app]); let mc = new ctx.MimicController();
    for (let i = 0; i < 8; i++) { clock.t += 8; app.set(phoneQ([1, 0, 0], 30 + i), GRIP); mc.update(clock.t); }
    assert(mc.mode === 'grip' && mc.via === 'app', mc.mode + ' ' + mc.via);
    assert(mc.keyName('a') === 'Vol Down' && mc.keyName('b') === 'Vol Up' && mc.keyName('center') === 'CENTRE', 'app grip names ' + mc.keyName('a'));
    const web = mkPad(0); web.id = 'Mimic Web Android (Vendor: 038f Product: 1200)'; web.set(phoneQ([1, 0, 0], 30), GRIP);
    ctx = load(undefined, () => [web]); mc = new ctx.MimicController();
    for (let i = 0; i < 8; i++) { clock.t += 8; web.set(phoneQ([1, 0, 0], 30 + i), GRIP); mc.update(clock.t); }
    assert(mc.keyName('a') === 'HOLD' && mc.keyName('b') === 'B' && mc.keyName('one') === 'SWITCH', 'browser grip names ' + mc.keyName('a'));
    const wand = mkPad(0); wand.set(phoneQ([1, 0, 0], 30), WAND);
    ctx = load(undefined, () => [wand]); mc = new ctx.MimicController();
    for (let i = 0; i < 8; i++) { clock.t += 8; wand.set(phoneQ([1, 0, 0], 30 + i), WAND); mc.update(clock.t); }
    assert(mc.keyName('a') === 'A' && mc.keyName('center') === 'Center', 'wand names ' + mc.keyName('a'));
    ctx = load(undefined, () => []); mc = new ctx.MimicController(); mc.update(1);
    assert(mc.keyName('a') === 'left click', 'mouse names ' + mc.keyName('a'));
  },
};

(async () => {
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
  }
  console.log(fail ? `${fail} failed` : 'all passed'); process.exit(fail ? 1 : 0);
})();
