// Run: node games/lib/test/mimic-link.test.js  -- the browser controller (mimic-proto.js, mimic-link.js,
// qr.js, and the dev signaling mailbox in tools/serve.py over real HTTP)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const http = require('http'), { spawn } = require('child_process');
const LIB = path.join(__dirname, '..');
const P = require(path.join(LIB, 'mimic-proto.js'));
const QR = require(path.join(LIB, 'qr.js'));
const ArenaInput = require(path.join(LIB, '..', 'arena', 'input.js'));

const deg = r => r * 180 / Math.PI;
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

/** A page context: mimic.js (+ optionally mimic-link.js) with a fake getGamepads. */
function page(opts) {
  opts = opts || {};
  const clock = { t: 0 };
  const ctx = {
    performance: { now: () => clock.t, timeOrigin: 1e12 },
    navigator: { getGamepads: () => (opts.real ? opts.real() : [null, null, null, null]) },
    addEventListener() {}, innerWidth: 1000, innerHeight: 1000,
    Math, Promise, Uint8Array, ArrayBuffer, DataView, console, JSON, setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(LIB, 'mimic.js'), 'utf8'), ctx);
  if (opts.link) {
    vm.runInContext(fs.readFileSync(path.join(LIB, 'mimic-proto.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(LIB, 'qr.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(LIB, 'mimic-link.js'), 'utf8'), ctx);
  }
  ctx.clock = clock;
  return ctx;
}

/** What the phone page computes for one DeviceOrientation sample (see phone.js sendState). */
function phoneAxes(ref, a, b, g, mode) {
  const q = P.fromDeviceOrientation(a, b, g);
  return P.motionAxes(P.relative(ref, q), P.gravityInPhone(q), mode);
}

/** Feed a single virtual motion pad into mimic.js and return the controller after n samples. */
function decodeWith(samples, mode) {
  let pad = null;
  const ctx = page({ real: () => [pad, null, null, null] });
  const mc = new ctx.MimicController();
  const ref = P.yawReference(P.fromDeviceOrientation(...samples[0]));
  samples.forEach((s, i) => {
    pad = P.motionGamepad(0, phoneAxes(ref, s[0], s[1], s[2], mode), 0, i);
    ctx.clock.t += 16;
    mc.update();
  });
  return mc;
}

const tests = {
  // ---------------------------------------------------------------- orientation -> axes -> mimic.js
  turningLeftIsPositiveYawAfterCentre() {
    const mc = decodeWith([[70, 0, 0], [100, 0, 0]], 'wand');   // centred facing 70 deg, then 30 deg left
    assert.strictEqual(mc.connected, true);
    near(deg(mc.yaw), 30, 0.05, 'yaw');
    near(deg(mc.pitch), 0, 0.05, 'pitch');
  },
  tiltingTheTopUpIsPositivePitch() {
    const mc = decodeWith([[0, 0, 0], [0, 25, 0]], 'wand');
    near(deg(mc.pitch), 25, 0.05, 'pitch');
    near(deg(mc.yaw), 0, 0.05, 'yaw');
  },
  quaternionSurvivesTheWireExactly() {
    // the int16 axes mimic.js reads back give the same rotation the phone computed (to int16 precision)
    for (const s of [[10, 20, 30], [200, -60, 45], [359, 89, -10], [123, 170, 80]]) {
      const q = P.fromDeviceOrientation(...s), ref = P.yawReference(P.fromDeviceOrientation(0, 0, 0));
      const r = P.relative(ref, q);
      const ax = phoneAxes(ref, ...s, 'wand');
      const x = ax[0] / 32767, y = ax[1] / 32767, z = ax[2] / 32767, w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
      const dot = Math.abs(x * r.x + y * r.y + z * r.z + w * r.w);
      assert(dot > 1 - 1e-6, 'rotation differs, dot ' + dot);
    }
  },
  gravityReadsUpLikeTheAccelerometer() {
    // flat on a table: +1 g on the phone's z (axis 5 = 4096 for 8 g full scale)
    const ax = phoneAxes({ x: 0, y: 0, z: 0, w: 1 }, 0, 0, 0, 'wand');
    near(ax[5], 4096, 1, 'z accel');
    near(ax[3], 0, 1, 'x accel');
    const mc = decodeWith([[0, 0, 0], [0, 0, 0.1]], 'wand');
    near(mc.linearAccel.y, 0, 0.05, 'gravity removed');
  },
  yawReferenceUsesTheBackWhenUpright() {
    // upright (beta 90): the top points at the ceiling, so heading comes from where the back faces
    const r = P.yawReference(P.fromDeviceOrientation(40, 90, 0));
    const q = P.relative(r, P.fromDeviceOrientation(40, 90, 0));
    const back = P.rotate(q, { x: 0, y: 0, z: -1 });
    near(back.x, 0, 1e-6, 'back x'); assert(back.y > 0.99, 'back faces forward');
  },

  // ---------------------------------------------------------------- signature -> mc.mode
  gripSignatureGivesGripMode() {
    const s = Array.from({ length: 10 }, (_, i) => [i * 0.7, 3 + i * 0.3, i * 0.2]);
    assert.strictEqual(decodeWith(s, 'grip').mode, 'grip');
  },
  wandSignatureGivesWandMode() {
    const s = Array.from({ length: 10 }, (_, i) => [i * 0.7, 3 + i * 0.3, i * 0.2]);
    assert.strictEqual(decodeWith(s, 'wand').mode, 'wand');
  },
  signMatchesTheAppAndReadsBack() {
    const ints = [12345, -12345, 0, 1, -1, 32767];
    for (const [m, code] of [['wand', P.SIG.WAND], ['grip', P.SIG.GRIP]]) {
      const s = P.sign(ints, code, 2);
      s.forEach((v, i) => assert(Math.abs(v - ints[i]) <= 1 && Math.abs(v) <= Math.abs(ints[i]) + (ints[i] === 0 ? 1 : 0), m + ' moved too far'));
      assert.deepStrictEqual(Object.assign({}, P.readSig(s)), { mode: code, tag: 2 });
    }
  },

  // ---------------------------------------------------------------- pad shape
  padLooksLikeTheAppsPadToGames() {
    const g = P.padGamepad(1, { buttons: { a: true, start: true }, lx: 0.5, ly: -1, rt: 1, dpad: { up: true, right: true } }, 0);
    assert.strictEqual(g.buttons.length, 16);
    assert.strictEqual(g.axes.length, 10);
    assert(/mimic/i.test(g.id));
    assert.strictEqual(ArenaInput.classifyPad(g), 'mimic');
    assert.strictEqual(g.buttons[0].pressed, true); assert.strictEqual(g.buttons[9].pressed, true);
    near(g.axes[0], 0.5, 0.01, 'lx'); near(g.axes[1], -1, 1e-9, 'ly');
    near(g.axes[3], -1, 1e-9, 'lt at rest'); near(g.axes[4], 1, 1e-9, 'rt pulled');
    near(g.axes[9], -1 + 2 / 7, 1e-9, 'hat up-right');
    const centred = P.padGamepad(0, {}, 0);
    assert(centred.axes[9] > 1.2, 'centred hat is out of range like Chrome (8 -> 1.2857)');
    // and the motion pad is what arena ignores and mimic.js takes
    assert.strictEqual(ArenaInput.classifyPad(P.motionGamepad(0, [1, 2, 3, 4, 5, 6], 0, 0)), 'mimic-motion');
  },
  hatIndexCoversAllDirections() {
    const c = (u, r, d, l) => P.hatIndex(u, r, d, l);
    assert.deepStrictEqual([c(1, 0, 0, 0), c(1, 1, 0, 0), c(0, 1, 0, 0), c(0, 1, 1, 0), c(0, 0, 1, 0), c(0, 0, 1, 1), c(0, 0, 0, 1), c(1, 0, 0, 1), c(0, 0, 0, 0)],
      [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.strictEqual(c(1, 0, 1, 0), 8, 'opposite keys cancel');
  },

  // ---------------------------------------------------------------- wire format
  packetsRoundTrip() {
    const ax = [100, -200, 300, -400, 500, 4096];
    const m = P.decode(P.encodeMotion(77, 1234.5, 0b100000000001, ax, 1));
    assert.deepStrictEqual([m.kind, m.seq, m.t, m.buttons, m.flags], [1, 77, 1234.5, 0b100000000001, 1]);
    assert.deepStrictEqual(Array.from(m.axes), ax);
    const s = { buttons: { a: true, home: true, l2: true }, lx: -1, ly: 0.5, rx: 0.25, ry: -0.25, lt: 1, rt: 0.5, dpad: { left: true } };
    const d = P.decode(P.encodePad(78, 99, s, 0));
    assert.strictEqual(d.kind, 2); assert.strictEqual(d.seq, 78);
    assert.strictEqual(d.pad.buttons.a && d.pad.buttons.home && d.pad.buttons.l2 && !d.pad.buttons.b, true);
    near(d.pad.lx, -1, 0.01, 'lx'); near(d.pad.ly, 0.5, 0.01, 'ly'); near(d.pad.rt, 0.5, 0.01, 'rt');
    assert.strictEqual(d.pad.dpad.left, true); assert.strictEqual(d.pad.hat, 6);
    assert.strictEqual(P.decode(new ArrayBuffer(4)), null);
  },

  // ---------------------------------------------------------------- merging gamepads
  mergeKeepsIndicesStableAndYieldsToRealPads() {
    const v1 = { key: 'a', pad: { id: 'v1' } }, v2 = { key: 'b', pad: { id: 'v2' } };
    let out = P.mergeGamepads([null, null, null, null], [v1, v2]);
    assert.strictEqual(out[0].id, 'v1'); assert.strictEqual(out[1].id, 'v2');
    assert.strictEqual(out[1].index, 1);
    // a Bluetooth phone appears at index 0: it keeps it, the browser phone moves to a free index
    const real = { id: 'bt', index: 0 };
    out = P.mergeGamepads([real, null, null, null], [v1, v2]);
    assert.strictEqual(out[0], real); assert.strictEqual(out[1].id, 'v2'); assert.strictEqual(out[2].id, 'v1');
    out = P.mergeGamepads([real, null, null, null], [v1, v2]);
    assert.strictEqual(out[2].id, 'v1', 'stays where it moved');
    out.forEach((p, i) => { if (p) assert.strictEqual(p.index, i, 'list[pad.index] === pad'); });
  },

  // ---------------------------------------------------------------- mimic-link.js inside a page
  getGamepadsWrapperFeedsMimicControllerAll() {
    let bt = null;
    const ctx = page({ link: true, real: () => [bt, null, null, null] });
    const sent = [];
    const fakePeer = (id, mode, n) => ({ id, n, joined: true, open: true, mode, name: 'Phone', label: '', index: undefined,
      axes: [0, 0, 0, 0, 0, 0], buttons: 0, pad: {}, ts: 0, ctl: { readyState: 'open', send: m => sent.push([id, m]) } });
    const a = fakePeer('phoneA', 'grip', 1), b = fakePeer('phoneB', 'wand', 2), c = fakePeer('phoneC', 'pad', 3);
    ctx.MimicLink._peers.set('phoneA', a); ctx.MimicLink._peers.set('phoneB', b); ctx.MimicLink._peers.set('phoneC', c);
    let list = ctx.navigator.getGamepads().filter(Boolean);
    assert.strictEqual(list.length, 3);
    assert.strictEqual(list.filter(p => p.buttons.length === 12).length, 2);
    // drive both motion phones for a few frames with real, changing samples
    const refA = P.yawReference(P.fromDeviceOrientation(0, 0, 0));
    for (let i = 0; i < 10; i++) {
      a.axes = phoneAxes(refA, 20 + i * 0.5, i * 0.2, 0, 'grip');
      b.axes = phoneAxes(refA, -10 - i * 0.5, i * 0.2, 0, 'wand');
      ctx.clock.t += 16;
      ctx.MimicController.all().forEach(m => m.update());
    }
    const all = ctx.MimicController.all();
    assert.strictEqual(all.length, 2, 'two motion phones, the Pad phone is not one');
    assert.deepStrictEqual(Array.from(all.map(m => m.mode)), ['grip', 'wand']);
    near(deg(all[0].yaw), 24.5, 0.1, 'phone A yaw'); near(deg(all[1].yaw), -14.5, 0.1, 'phone B yaw');
    // a Bluetooth phone joining takes its index; browser phones move, mimic.js keeps working
    bt = P.motionGamepad(0, phoneAxes(refA, 5, 0, 0, 'wand'), 0, 0); bt.id = 'Mimic (Vendor: 038f Product: 1200)'; bt.__mimicWeb = undefined;
    list = ctx.navigator.getGamepads();
    assert.strictEqual(list[0], bt);
    assert.strictEqual(ctx.MimicController.all().length, 3);
    // rumble through MimicController reaches the right browser phone (mimic.js is not edited)
    const slotOfB = ctx.MimicController.all().findIndex(m => { m.update(); return m._findPad() && m._findPad().id === list.find(p => p && p.index === b.index).id && m._findPad().index === b.index; });
    assert(slotOfB >= 0, 'phone B has a slot');
    sent.length = 0;
    ctx.MimicController.all()[slotOfB].rumble(0.8, 120, 3);
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0][0], 'phoneB');
    assert.deepStrictEqual(JSON.parse(sent[0][1]), { t: 'rumble', s: 0.8, ms: 120, p: 3 });
    assert.strictEqual(ctx.MimicController.all()[slotOfB].rumbleReady, true);
    // the Pad phone's vibrationActuator works like a real pad's
    sent.length = 0;
    const padG = ctx.navigator.getGamepads().find(p => p && p.buttons.length === 16);
    padG.vibrationActuator.playEffect('dual-rumble', { duration: 200, strongMagnitude: 0.5, weakMagnitude: 0.2 });
    assert.strictEqual(sent[0][0], 'phoneC');
    // MimicLink.rumble by gamepad index
    sent.length = 0;
    assert.strictEqual(ctx.MimicLink.rumble(a.index, 1, 50, 0), true);
    assert.strictEqual(sent[0][0], 'phoneA');
    assert.strictEqual(ctx.MimicLink.phones().length, 3);
  },
  noPhonesMeansTheNativeListUntouched() {
    const native = [null, null, null, null];
    const ctx = page({ link: true, real: () => native });
    assert.strictEqual(ctx.navigator.getGamepads(), native);
  },

  // ---------------------------------------------------------------- QR
  qrPicksSaneVersions() {
    const u = 'http://192.168.1.23:8765/phone/?room=abcd1234&mode=grip';
    const q = QR.encode(u, 'M');
    assert.strictEqual(q.size, q.version * 4 + 17);
    assert(q.version <= 5, 'a room URL fits a small code (v' + q.version + ')');
    // finder pattern corners are dark, their separators light
    assert.strictEqual(q.modules[0][0], true); assert.strictEqual(q.modules[7][7], false);
    assert(/^<svg/.test(QR.svg(u)));
    // decoded with a real reader: optional, see games/lib/test/qr-zxing.py (passes for v1..v27, L/M/Q/H)
  },

  // ---------------------------------------------------------------- signaling over HTTP (tools/serve.py)
  async signalingMailboxContract() {
    const port = 18000 + Math.floor(Math.random() * 2000);
    const srv = spawn('python', [path.join(LIB, '..', '..', 'tools', 'serve.py'), String(port)], { stdio: 'ignore' });
    const req = (method, p, body) => new Promise((res, rej) => {
      const data = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
      const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data) } }, resp => {
        let d = ''; resp.on('data', c => { d += c; }); resp.on('end', () => res({ status: resp.statusCode, json: d ? JSON.parse(d) : null, headers: resp.headers }));
      });
      r.on('error', rej); if (data) r.write(data); r.end();
    });
    try {
      for (let i = 0; ; i++) { try { await req('GET', '/signal-info'); break; } catch (e) { if (i > 50) throw e; await new Promise(r => setTimeout(r, 100)); } }
      const info = await req('GET', '/signal-info');
      assert.strictEqual(info.json.port, port); assert.strictEqual(info.json.lan_bound, false);
      // post + get, filtered by recipient, after a seq
      let r = await req('POST', '/signal/room1', { from: 'ph1', to: 'host', type: 'offer', data: { sdp: 'x' } });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.seq, 1);
      assert.strictEqual(r.headers['access-control-allow-origin'], '*');
      await req('POST', '/signal/room1', { from: 'host', to: 'ph1', type: 'answer', data: { sdp: 'y' } });
      r = await req('GET', '/signal/room1?for=host&after=0');
      assert.deepStrictEqual(r.json.msgs.map(m => [m.seq, m.from, m.type, m.data.sdp]), [[1, 'ph1', 'offer', 'x']]);
      r = await req('GET', '/signal/room1?for=host&after=1');
      assert.strictEqual(r.json.msgs.length, 0);
      r = await req('GET', '/signal/room1?for=ph1&after=0');
      assert.strictEqual(r.json.msgs[0].type, 'answer');
      // rooms are separate
      r = await req('GET', '/signal/room2?for=host&after=0');
      assert.strictEqual(r.json.msgs.length, 0);
      // long-poll: a waiting GET returns as soon as a message arrives
      const t0 = Date.now();
      const waiting = req('GET', '/signal/room1?for=host&after=1&wait=5000');
      setTimeout(() => req('POST', '/signal/room1', { from: 'ph2', to: 'host', type: 'ice', data: { c: 1 } }), 300);
      r = await waiting;
      const took = Date.now() - t0;
      assert.strictEqual(r.json.msgs.length, 1); assert(took >= 250 && took < 2500, 'long-poll returned after ' + took + ' ms');
      // and times out empty
      const t1 = Date.now();
      r = await req('GET', '/signal/room1?for=nobody&after=0&wait=400');
      assert.strictEqual(r.json.msgs.length, 0); assert(Date.now() - t1 >= 350, 'waited');
      // validation
      assert.strictEqual((await req('POST', '/signal/bad%20room', { from: 'a', to: 'b', type: 't' })).status, 400);
      assert.strictEqual((await req('POST', '/signal/r', { from: 'a b', to: 'b', type: 't' })).status, 400);
      assert.strictEqual((await req('POST', '/signal/r', 'not json')).status, 400);
      assert.strictEqual((await req('GET', '/signal/r?for=')).status, 400);
      assert.strictEqual((await req('OPTIONS', '/signal/r')).status, 204);
      // static files still served
      assert.strictEqual((await new Promise(res => http.get({ host: '127.0.0.1', port, path: '/phone/' }, x => { x.resume(); res(x.statusCode); }))), 200);
    } finally { srv.kill(); }
  },
  signalingMessagesExpire() {
    // the mailbox's TTL with a fake clock (python, same module)
    const code = [
      'import sys, importlib.util', `sys.argv=['x']`,
      `spec=importlib.util.spec_from_file_location('serve', r'${path.join(LIB, '..', '..', 'tools', 'serve.py')}')`,
      'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      't=[0.0]; mb=m.Mailbox(clock=lambda: t[0])',
      "mb.post('r', {'from':'a','to':'b','type':'offer'})",
      "assert len(mb.get('r','b',0)['msgs'])==1",
      't[0]=61.0',
      "assert len(mb.get('r','b',0)['msgs'])==0, 'message expired'",
      "mb.post('r', {'from':'a','to':'b','type':'offer'}); assert mb.get('r','b',0)['msgs'][0]['seq']==2, 'seq keeps counting'",
      't[0]=700.0', "mb.get('x','b',0)", "assert 'r' not in mb.rooms, 'idle room dropped'",
      "for i in range(600): mb.post('big', {'from':'a','to':'b','type':'ice'})",
      "assert len(mb.rooms['big']['msgs'])==500", "print('ok')",
    ].join('\n');
    const out = require('child_process').execFileSync('python', ['-c', code]).toString().trim();
    assert.strictEqual(out, 'ok');
  },
};

(async () => {
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
  }
  console.log(fail ? `${fail} failed` : 'all passed'); process.exit(fail ? 1 : 0);
})();
