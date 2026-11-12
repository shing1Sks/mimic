/*
 * Mimic browser controller: the parts shared by the phone page (games/phone/) and the PC side
 * (games/lib/mimic-link.js). Pure functions plus a small signaling client; tested in Node
 * (games/lib/test/mimic-link.test.js). Protocol and signaling contract: docs/browser-controller.md.
 *
 * The browser phone produces EXACTLY what the Mimic app sends over Bluetooth (app/.../MotionFeed.kt,
 * HidDescriptor.kt), so games/lib/mimic.js decodes it unchanged:
 *   Wand / Grip  six int16 axes: quaternion x, y, z (phone frame, relative to a yaw-only reference
 *                taken at the last Centre press, w >= 0) and acceleration incl. gravity (8 g full
 *                scale), with the mode code and tag hidden in the axes' low bits (MotionSig.sign).
 *   Pad          the app's gamepad report as Chrome shows it: 16 buttons, sticks, analog triggers
 *                on axes 3/4 (rest -1), right stick Y on axis 5, D-pad as a hat on axis 9.
 */
(function (root) {
  'use strict';
  const G = 9.80665;
  const SIG = { WAND: 0x9, GRIP: 0x6 };
  const MOTION_BUTTONS = ['a', 'b', 'one', 'two', 'minus', 'plus', 'home', 'up', 'down', 'left', 'right', 'center'];
  const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'home'];
  const VID_PID_MOTION = '(Vendor: 038f Product: 1200)', VID_PID_PAD = '(Vendor: 038f Product: 1201)';

  // ------------------------------------------------------------------ quaternions (x, y, z, w)
  function mul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
  function rotate(q, v) {
    const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conj(q));
    return { x: p.x, y: p.y, z: p.z };
  }
  function normalize(q) {
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
  }
  const axisAngle = (ax, ay, az, rad) => { const s = Math.sin(rad / 2); return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(rad / 2) }; };

  /**
   * DeviceOrientationEvent (alpha, beta, gamma in degrees) -> the phone->world rotation, the same
   * quaternion Android's rotation vector gives (world: x east-ish, y north-ish, z up; the phone
   * frame x right, y top, z out of the screen). W3C: R = Rz(alpha) Rx(beta) Ry(gamma).
   */
  function fromDeviceOrientation(alpha, beta, gamma) {
    const d = Math.PI / 180;
    return normalize(mul(mul(axisAngle(0, 0, 1, (alpha || 0) * d), axisAngle(1, 0, 0, (beta || 0) * d)), axisAngle(0, 1, 0, (gamma || 0) * d)));
  }

  /** Port of MotionFeed.yawReference: rotation about up that turns the phone's heading to forward. */
  function yawReference(q) {
    const { x, y, z, w } = q;
    let fx = 2 * (x * y - z * w), fy = 1 - 2 * (x * x + z * z);   // phone top in world
    if (Math.hypot(fx, fy) < 0.3) { fx = -2 * (x * z + y * w); fy = -2 * (y * z - x * w); }  // upright: its back
    const heading = Math.atan2(-fx, fy);
    const half = -heading / 2;
    return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  }

  /** ref * q with w >= 0 (what the app sends). */
  function relative(ref, q) {
    let r = mul(ref, q);
    if (r.w < 0) r = { x: -r.x, y: -r.y, z: -r.z, w: -r.w };
    return r;
  }

  /** Gravity as the phone's accelerometer reads it (+g pointing up), in the phone frame. */
  const gravityInPhone = q => { const g = rotate(conj(q), { x: 0, y: 0, z: G }); return g; };

  const clampI = v => Math.max(-32767, Math.min(32767, Math.round(v)));
  /** MotionSig.sign: low bit of axes 0..3 = mode code, 4..5 = tag; values move by at most 1, toward zero. */
  function sign(ints, mode, tag) {
    const bits = (mode & 15) | ((tag & 3) << 4);
    return ints.map((v0, i) => {
      const v = clampI(v0), want = bits >> i & 1;
      return (v & 1) === want ? v : v > 0 ? v - 1 : v + 1;
    });
  }
  /** Inverse of sign: { mode, tag }. */
  function readSig(ints) {
    let bits = 0;
    ints.forEach((v, i) => { bits |= (v & 1) << i; });
    return { mode: bits & 15, tag: bits >> 4 & 3 };
  }

  /** The six signed axes for a relative orientation r and phone-frame acceleration (m/s^2). */
  function motionAxes(r, acc, mode) {
    const k = 32767 / (8 * G);
    return sign([r.x * 32767, r.y * 32767, r.z * 32767, acc.x * k, acc.y * k, acc.z * k], mode === 'grip' ? SIG.GRIP : SIG.WAND, 0);
  }

  // ------------------------------------------------------------------ pad
  /** Hat index from the D-pad: 0 = up, clockwise, 8 = centred (the app's PadState.hat). */
  function hatIndex(up, right, down, left) {
    if (up && down) { up = down = false; }
    if (left && right) { left = right = false; }
    if (up) return right ? 1 : left ? 7 : 0;
    if (down) return right ? 3 : left ? 5 : 4;
    if (right) return 2;
    if (left) return 6;
    return 8;
  }
  /** Chrome's hat axis value (-1 + 2/7 * index; centred = 8 -> 1.2857). */
  const hatAxis = i => -1 + 2 / 7 * i;

  /**
   * Pad state (sticks -1..1, triggers 0..1, buttons by name, dpad) -> the gamepad Chrome shows for
   * the app's Pad: { buttons: 16 values 0/1 (L2/R2 analog), axes: 10 }.
   */
  function padGamepadState(s) {
    const b = new Array(16).fill(0);
    PAD_BUTTONS.forEach((n, i) => { if (s.buttons && s.buttons[n]) b[i] = 1; });
    const lt = Math.max(0, Math.min(1, s.lt || 0)), rt = Math.max(0, Math.min(1, s.rt || 0));
    if (lt > 0) b[6] = Math.max(b[6], lt); if (rt > 0) b[7] = Math.max(b[7], rt);
    const d = s.dpad || {};
    const q = v => Math.round(Math.max(-1, Math.min(1, v || 0)) * 127) / 127;
    return {
      buttons: b,
      axes: [q(s.lx), q(s.ly), q(s.rx), lt * 2 - 1, rt * 2 - 1, q(s.ry), 0, 0, 0, hatAxis(hatIndex(d.up, d.right, d.down, d.left))],
    };
  }

  // ------------------------------------------------------------------ wire format (DataChannel)
  /*
   * Binary state packet, little endian:
   *   u8 kind (1 motion, 2 pad)  u8 flags (bit0: phone page visible)  u16 buttons (motion: bits 0..11)
   *   u32 seq                    f64 phone time (ms, performance.timeOrigin + now)
   *   motion: 6 x i16 axes (already signed)
   *   pad:    u16 buttons (16 pad buttons) i8 lx ly rx ry  u8 lt rt  u8 hat (0..8)  u8 pad
   * Every packet carries the full state, so a lost packet costs nothing; the receiver drops any
   * packet whose seq is not newer than the last one it applied.
   */
  const KIND = { MOTION: 1, PAD: 2 };
  function encodeMotion(seq, t, buttons, axes, flags) {
    const buf = new ArrayBuffer(28), v = new DataView(buf);
    v.setUint8(0, KIND.MOTION); v.setUint8(1, flags || 0); v.setUint16(2, buttons & 0xFFF, true);
    v.setUint32(4, seq >>> 0, true); v.setFloat64(8, t, true);
    for (let i = 0; i < 6; i++) v.setInt16(16 + 2 * i, clampI(axes[i]), true);
    return buf;
  }
  function encodePad(seq, t, s, flags) {
    const buf = new ArrayBuffer(28), v = new DataView(buf);
    let bits = 0;
    PAD_BUTTONS.forEach((n, i) => { if (s.buttons && s.buttons[n]) bits |= 1 << i; });
    const i8 = x => Math.round(Math.max(-1, Math.min(1, x || 0)) * 127);
    const u8 = x => Math.round(Math.max(0, Math.min(1, x || 0)) * 255);
    const d = s.dpad || {};
    v.setUint8(0, KIND.PAD); v.setUint8(1, flags || 0); v.setUint16(2, 0, true);
    v.setUint32(4, seq >>> 0, true); v.setFloat64(8, t, true);
    v.setUint16(16, bits, true);
    v.setInt8(18, i8(s.lx)); v.setInt8(19, i8(s.ly)); v.setInt8(20, i8(s.rx)); v.setInt8(21, i8(s.ry));
    v.setUint8(22, u8(s.lt)); v.setUint8(23, u8(s.rt)); v.setUint8(24, hatIndex(d.up, d.right, d.down, d.left));
    return buf;
  }
  function decode(buf) {
    const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (v.byteLength < 16) return null;
    const kind = v.getUint8(0), out = { kind, flags: v.getUint8(1), seq: v.getUint32(4, true), t: v.getFloat64(8, true) };
    if (kind === KIND.MOTION && v.byteLength >= 28) {
      out.buttons = v.getUint16(2, true);
      out.axes = [0, 1, 2, 3, 4, 5].map(i => v.getInt16(16 + 2 * i, true));
      return out;
    }
    if (kind === KIND.PAD && v.byteLength >= 25) {
      const bits = v.getUint16(16, true), buttons = {};
      PAD_BUTTONS.forEach((n, i) => { buttons[n] = !!(bits & (1 << i)); });
      const h = v.getUint8(24);
      const dpad = { up: h === 7 || h === 0 || h === 1, right: h >= 1 && h <= 3, down: h >= 3 && h <= 5, left: h >= 5 && h <= 7 };
      out.pad = { buttons, lx: v.getInt8(18) / 127, ly: v.getInt8(19) / 127, rx: v.getInt8(20) / 127, ry: v.getInt8(21) / 127,
        lt: v.getUint8(22) / 255, rt: v.getUint8(23) / 255, dpad, hat: h };
      return out;
    }
    return null;
  }

  // ------------------------------------------------------------------ virtual gamepads
  const btn = v => ({ pressed: v > 0.5, touched: v > 0, value: v });
  /** A Wand/Grip pad exactly as Chrome shows the app's motion controller. */
  function motionGamepad(index, axesInts, buttons, ts, name) {
    return {
      id: 'Mimic Web ' + (name ? name + ' ' : '') + VID_PID_MOTION, index, connected: true, mapping: '', timestamp: ts || 0,
      axes: axesInts.map(v => v / 32767),
      buttons: MOTION_BUTTONS.map((_, i) => btn(buttons >> i & 1)),
      vibrationActuator: null, __mimicWeb: true,
    };
  }
  /** A Pad exactly as Chrome shows the app's gamepad (mapping '' and the hat on axis 9). */
  function padGamepad(index, padState, ts, name) {
    const g = padGamepadState(padState || {});
    return {
      id: 'Mimic Web Gamepad ' + (name ? name + ' ' : '') + VID_PID_PAD, index, connected: true, mapping: '', timestamp: ts || 0,
      axes: g.axes, buttons: g.buttons.map(btn), vibrationActuator: null, __mimicWeb: true,
    };
  }

  /**
   * Merge the real gamepads with the virtual ones. Each virtual entry { key, pad, index? } keeps
   * its index while it can (index is written back); a real pad that takes the index wins and the
   * virtual one moves to the lowest free index. The array is indexed by gamepad index (like
   * Chrome's: nulls in the gaps), so list[pad.index] === pad.
   */
  function mergeGamepads(real, virtuals) {
    const out = Array.from(real || []);
    const used = new Set();
    out.forEach((p, i) => { if (p) used.add(p.index !== undefined ? p.index : i); });
    // first those that can keep their index, then the rest into the lowest free ones
    const keep = virtuals.filter(v => v.index !== undefined && v.index !== null && !used.has(v.index) && (used.add(v.index), true));
    for (const v of virtuals) {
      if (keep.includes(v)) continue;
      let idx = 0;
      while (used.has(idx)) idx++;
      used.add(idx); v.index = idx;
    }
    for (const v of virtuals) {
      while (out.length <= v.index) out.push(null);
      v.pad.index = v.index;
      out[v.index] = v.pad;
    }
    return out;
  }

  // ------------------------------------------------------------------ signaling client
  const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
  function randomId(n) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';   // no 0/o/1/l: readable aloud
    let s = '';
    const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(n)) : Array.from({ length: n }, () => Math.floor(Math.random() * 256));
    for (let i = 0; i < n; i++) s += abc[r[i] % abc.length];
    return s;
  }

  /**
   * Mailbox client for one peer in one room. base = signaling URL (e.g. http://pc:8765/signal);
   * POST base/<room>  {from, to, type, data}            -> {seq}
   * GET  base/<room>?for=<me>&after=<seq>&wait=<ms>     -> {seq, msgs:[{seq, from, to, type, data}]}
   * onMessage(msg) is called for each message addressed to `me`.
   */
  class Signal {
    constructor(base, room, me, onMessage, opts) {
      this.base = String(base).replace(/\/+$/, ''); this.room = room; this.me = me;
      this.onMessage = onMessage; this.after = 0; this.running = false;
      this.wait = (opts && opts.wait) || 8000; this.minGap = (opts && opts.minGap) || 300;
      this.fetch = (opts && opts.fetch) || (typeof fetch !== 'undefined' ? fetch.bind(root || globalThis) : null);
      this.errors = 0;
    }
    url(q) { return this.base + '/' + encodeURIComponent(this.room) + (q || ''); }
    async send(to, type, data) {
      // text/plain keeps it a "simple" request: no CORS preflight against a remote signaling host
      const r = await this.fetch(this.url(), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ from: this.me, to, type, data }) });
      if (!r.ok) throw new Error('signal POST ' + r.status);
      return r.json();
    }
    start() {
      if (this.running) return;
      this.running = true;
      const sleep = ms => new Promise(res => setTimeout(res, ms));
      const loop = async () => {
        while (this.running) {
          const t0 = Date.now();
          try {
            const r = await this.fetch(this.url(`?for=${encodeURIComponent(this.me)}&after=${this.after}&wait=${this.wait}`), { cache: 'no-store' });
            if (!r.ok) throw new Error('signal GET ' + r.status);
            const j = await r.json();
            this.errors = 0;
            for (const m of j.msgs || []) {
              if (m.seq > this.after) this.after = m.seq;
              try { this.onMessage(m); } catch (e) { if (typeof console !== 'undefined') console.warn('[mimic signal]', e); }
            }
            // a server without long-poll answers at once: poll no faster than minGap
            const took = Date.now() - t0;
            if (!(j.msgs || []).length && took < this.minGap) await sleep(this.minGap - took);
          } catch (e) {
            this.errors++;
            await sleep(Math.min(5000, 500 * this.errors));
          }
        }
      };
      this._loop = loop();
    }
    stop() { this.running = false; }
  }

  const api = {
    G, SIG, MOTION_BUTTONS, PAD_BUTTONS, KIND,
    mul, conj, rotate, normalize, fromDeviceOrientation, yawReference, relative, gravityInPhone,
    sign, readSig, motionAxes, hatIndex, hatAxis, padGamepadState,
    encodeMotion, encodePad, decode, motionGamepad, padGamepad, mergeGamepads,
    Signal, randomId, SAFE_ID,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MimicProto = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null));
