/*
 * Mimic motion controller, read through the browser Gamepad API (Bluetooth, no network).
 *
 * The phone appears as a joystick with 12 buttons and 6 axes:
 *   axes 0..2  orientation quaternion x, y, z in the PHONE frame (x right, y toward the phone's
 *              top, z out of the screen), relative to a level frame whose forward is where the
 *              phone pointed at the last Center press. w = sqrt(1 - x^2 - y^2 - z^2) >= 0.
 *   axes 3..5  acceleration in the phone frame incl. gravity, full scale = 8 g.
 *   buttons    A B 1 2 - + Home Up Down Left Right Center
 *
 * This file converts that into game-friendly values in three.js world coordinates
 * (x right, y up, z toward the player): an object with identity rotation points into the
 * screen (-Z) with its face up (+Y), exactly like the phone at rest held as a remote.
 *
 * Usage (classic script, works from file://):
 *   <script src="../lib/mimic.js"></script>
 *   const mc = new MimicController();
 *   function frame() { mc.update(); mc.quat; mc.angularVelocity; mc.pressed('a'); ... }
 *
 * Without a phone connected, the mouse stands in: position = where it points, left button = A,
 * right button = B, keys: Space = A, Enter = B, C = Center, 1/2, arrows. Fast mouse flicks
 * produce real angular velocity, so swings work too.
 *
 * Several phones (local multiplayer): each phone is its own gamepad.
 *   MimicController.all()            controllers for every Mimic motion pad present, by gamepad
 *                                    index (same objects each call); check .connected after update()
 *   new MimicController({ slot: 1 }) the 2nd phone. Only slot 0 has the mouse/keyboard fallback.
 *   new MimicController()            exactly as before (slot 0).
 *   mc.mode                          'wand' | 'grip' | 'mouse' (slot 0 fallback) | null (empty slot)
 *   new MimicController({ continuousArm: true })  mc.arm's elbow tracked through 180 deg of
 *                                    rotation (no flip); off by default, identical below 180 deg.
 *
 * How Grip and the mode are known: the app hides a 4-bit mode code (and a 2-bit tag, see below)
 * in the lowest bit of each axis (1/32767, far below sensor noise). An older app's noise matches a
 * code by chance, so a code counts only after SIG_FRAMES different samples in a row agree.
 *
 * WebHID (once the player has granted it, see enableRumble): rumble goes out on output report 3,
 * and each phone gets a tag once when it is opened: [0, 0, 0x80 | tag]. The phone echoes the tag in
 * the axes, so rumble finds the right phone with several of them. (Grip always sends the motion
 * report; nothing asks for it any more.)
 */
(function (global) {
  'use strict';
  const NAMES = ['a', 'b', 'one', 'two', 'minus', 'plus', 'home', 'up', 'down', 'left', 'right', 'center'];
  const G = 9.80665;

  // phone frame -> three.js world frame: rotation of -90 deg about X
  const S = Math.SQRT1_2;
  const C = { x: -S, y: 0, z: 0, w: S };
  const Ci = { x: S, y: 0, z: 0, w: S };

  function mul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  function rotate(q, v) {
    const p = mul(mul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
    return { x: p.x, y: p.y, z: p.z };
  }
  function fromEuler(yaw, pitch, roll) { // yaw about Y, then pitch about X, then roll about Z (three.js 'YXZ')
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    return mul(mul({ x: 0, y: sy, z: 0, w: cy }, { x: sp, y: 0, z: 0, w: cp }), { x: 0, y: 0, z: sr, w: cr });
  }

  /** q^t: the same rotation axis, t times the angle (t in 0..1 = partial rotation). */
  function qpow(q, t) {
    const s = q.w < 0 ? -1 : 1;
    const w = Math.min(1, q.w * s), ang = 2 * Math.acos(w), sh = Math.sin(ang / 2);
    if (sh < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
    const k = Math.sin(t * ang / 2) / sh;
    return { x: q.x * s * k, y: q.y * s * k, z: q.z * s * k, w: Math.cos(t * ang / 2) };
  }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }

  /**
   * q^t like qpow, but continuous over time (same approach as saber/sweep.js). qpow takes the
   * short way round, so when the whole rotation passes 180 deg the partial rotation flips to the
   * other side and the elbow jumps. Here the angle is tracked through 180 deg (k counts the extra
   * turn) and eased back to the short way by `relax` per call while below 140 deg.
   * st = { s, k } is the caller's state (start with {}). With k = 0 (never past 180 deg) the
   * result is exactly qpow(q, t).
   */
  function qpowFollow(q, t, st, relax) {
    const s = q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
    let k = st.k || 0;
    // the phone sends w >= 0, so passing 180 deg shows up as a sign swap against last frame
    if (st.s && s.x * st.s.x + s.y * st.s.y + s.z * st.s.z + s.w * st.s.w < 0) k = 1 - k;
    const theta = 2 * Math.acos(Math.max(-1, Math.min(1, s.w)));
    if (k > 0 && theta < 140 * Math.PI / 180) k = Math.max(0, k - (relax || 0));
    st.s = s; st.k = k;
    const sh = Math.sin(theta / 2);
    if (sh < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
    const phi = t * (theta - 2 * Math.PI * k), c = Math.sin(phi / 2) / sh;
    return { x: s.x * c, y: s.y * c, z: s.z * c, w: Math.cos(phi / 2) };
  }

  /*
   * Arm model. The phone knows its rotation precisely but not where it is in space, so the hand
   * position is derived from rotation through a simple arm, like the 3DoF VR controllers did:
   * the shoulder is fixed, the upper arm takes part of the rotation (ELBOW_SHARE), the forearm
   * and hand take all of it. Big swings sweep big arcs; small wrist turns stay small.
   * Positions are metres in three.js space relative to the player's head (x right, y up, z back).
   */
  const ARM = { shoulder: { x: 0.18, y: -0.25, z: 0.1 }, upper: { x: 0, y: -0.24, z: -0.14 },
    forearm: { x: 0, y: 0, z: -0.26 }, grip: { x: 0, y: 0, z: -0.08 }, ELBOW_SHARE: 0.4 };
  function armRight(q, st, relax) {
    const shoulder = ARM.shoulder;
    const share = st ? qpowFollow(q, ARM.ELBOW_SHARE, st, relax) : qpow(q, ARM.ELBOW_SHARE);
    const elbow = add(shoulder, rotate(share, ARM.upper));
    const wrist = add(elbow, rotate(q, ARM.forearm));
    const hand = add(wrist, rotate(q, ARM.grip));
    return { shoulder, elbow, wrist, hand };
  }
  /** st/relax optional: pass a state object ({}) to track the elbow continuously (qpowFollow). */
  function armPose(q, side, st, relax) {
    if (side !== 'left') return armRight(q, st, relax);
    // mirror across x: a left arm is a right arm in a mirrored world
    const m = armRight({ x: q.x, y: -q.y, z: -q.z, w: q.w }, st, relax);
    const f = v => ({ x: -v.x, y: v.y, z: v.z });
    return { shoulder: f(m.shoulder), elbow: f(m.elbow), wrist: f(m.wrist), hand: f(m.hand) };
  }

  const VID = 0x038f, PID = 0x1200, RUMBLE_REPORT = 3;
  function isRumbleDevice(d) {
    return d && d.vendorId === VID && d.productId === PID &&
      (d.collections || []).some(c => (c.outputReports || []).some(r => r.reportId === RUMBLE_REPORT));
  }
  const nav = () => (typeof navigator !== 'undefined' ? navigator : {});

  /*
   * The phones' WebHID devices, shared by every controller on the page: opened once, followed
   * across reconnects, each given a tag 0..3 that its phone echoes back in the axes.
   */
  const CONTROL = 0x80;
  const hidMgr = {
    devices: [], tags: new Map(), watching: false,
    add(d) {
      if (!isRumbleDevice(d) || this.devices.includes(d)) return;
      const used = new Set(this.devices.map(x => this.tags.get(x)));
      let tag = 0; while (used.has(tag) && tag < 3) tag++;
      this.tags.set(d, tag); this.devices.push(d);
      // tell the phone its tag (once; a failed send just leaves rumble going to every phone)
      try { Promise.resolve(d.sendReport(RUMBLE_REPORT, new Uint8Array([0, 0, CONTROL | (tag & 3)]))).catch(() => {}); } catch (e) { /* ignore */ }
    },
    remove(d) { this.devices = this.devices.filter(x => x !== d); },
    async open(list) {
      for (const d of list || []) {
        if (!isRumbleDevice(d)) continue;
        try { if (!d.opened) await d.open(); this.add(d); } catch (e) { /* stays without it */ }
      }
    },
    /** Reuse permissions granted on an earlier visit, silently (no chooser). */
    async adopt() {
      const hid = nav().hid;
      if (!hid) return;
      try { await this.open(await hid.getDevices()); } catch (e) { /* stays without rumble */ }
    },
    /**
     * Follow the phones across disconnects: Chrome hands out a new device object when one comes
     * back (Bluetooth blip, app restart, laptop sleep), so drop the old one and pick up the new.
     */
    watch() {
      const hid = nav().hid;
      if (this.watching || !hid || !hid.addEventListener) return;
      this.watching = true;
      hid.addEventListener('disconnect', e => { if (e && e.device) this.remove(e.device); });
      hid.addEventListener('connect', () => this.adopt());
    },
    async send(d, bytes) {
      try { await d.sendReport(RUMBLE_REPORT, new Uint8Array(bytes)); return true; }
      catch (e) { this.remove(d); this.adopt(); return false; }  // stale device: re-acquire
    },
  };

  /** Wand/Grip pads (12 buttons, >= 6 axes; or "Mimic" with fewer than 16), by gamepad index. */
  function isMotionPad(p) {
    return !!p && p.connected !== false && p.axes.length >= 6 &&
      (p.buttons.length === 12 || (/mimic/i.test(p.id) && p.buttons.length < 16));
  }
  function motionPads() {
    const g = nav().getGamepads ? nav().getGamepads() : [];
    const out = [];
    for (const p of g || []) if (isMotionPad(p)) out.push(p);
    return out;
  }
  /** A pad that has never moved (or a phone on another mode) reports all-zero axes: not sending. */
  const sending = p => !(p.axes[0] === 0 && p.axes[1] === 0 && p.axes[2] === 0 && p.axes[5] === 0);

  const SIG = { WAND: 0x9, GRIP: 0x6 }, SIG_FRAMES = 6;
  const sigs = new Map();   // gamepad index -> { id, key, code, tag, n }
  /** Read the low-bit signature of a pad's current sample; counts agreeing distinct samples. */
  function trackSig(p) {
    let st = sigs.get(p.index);
    if (!st || st.id !== p.id) { st = { id: p.id, key: '', code: -1, tag: 0, n: 0 }; sigs.set(p.index, st); }
    const v = [0, 1, 2, 3, 4, 5].map(i => Math.round(p.axes[i] * 32767));
    const key = v.join(',');
    if (key === st.key) return st;
    st.key = key;
    let bits = 0;
    v.forEach((x, i) => { bits |= (x & 1) << i; });
    const code = bits & 15;
    if (code === st.code) st.n++; else { st.code = code; st.n = 1; }
    st.tag = bits >> 4 & 3;
    return st;
  }
  const sigKnown = st => !!st && st.n >= SIG_FRAMES && (st.code === SIG.WAND || st.code === SIG.GRIP);
  const allCache = [];

  class MimicController {
    /** opts: { slot: 0..3 (default 0), continuousArm: false } */
    constructor(opts) {
      opts = opts || {};
      this.slot = Math.max(0, opts.slot | 0);
      this._continuous = !!opts.continuousArm;
      this._armSt = {};
      this.connected = false;      // a phone is sending
      this.source = this.slot === 0 ? 'mouse' : 'none';   // 'phone' | 'mouse' | 'none' (empty slot > 0)
      this.mode = this.slot === 0 ? 'mouse' : null;       // 'wand' | 'grip' | 'mouse' | null
      this._sig = null;
      this.quat = { x: 0, y: 0, z: 0, w: 1 };          // world orientation
      this.forward = { x: 0, y: 0, z: -1 };            // where the phone's top points (world)
      this.up = { x: 0, y: 1, z: 0 };                  // where the screen faces (world)
      this.angularVelocity = { x: 0, y: 0, z: 0 };     // rad/s, world frame
      this.angularSpeed = 0;                           // |angularVelocity|
      this.accel = { x: 0, y: -G, z: 0 };              // m/s^2 world frame, incl. gravity... see linearAccel
      this.linearAccel = { x: 0, y: 0, z: 0 };         // world frame, gravity removed
      this.pointer = { x: 0, y: 0, onScreen: true };   // -1..1 where it points on a virtual screen
      this.yaw = 0; this.pitch = 0; this.roll = 0;     // radians, convenience
      this._down = {}; this._prev = {};
      NAMES.forEach(n => { this._down[n] = false; this._prev[n] = false; });
      this._lastQ = null; this._lastT = 0;
      this._mouse = { x: 0, y: 0, buttons: {}, keys: {} };
      this._pad = null;
      this._hand = 'right';
      this.arm = Object.assign(armPose({ x: 0, y: 0, z: 0, w: 1 }, 'right'), { handVelocity: { x: 0, y: 0, z: 0 } });
      if (this.slot === 0) this._installFallback();
      hidMgr.watch();
      hidMgr.adopt();
    }

    /** Controllers for every Mimic motion pad present (Wand or Grip), by gamepad index. */
    static all() {
      const n = motionPads().length;
      for (let i = 0; i < n; i++) if (!allCache[i]) allCache[i] = new MimicController({ slot: i });
      return allCache.slice(0, n);
    }

    /** Call once per frame before reading anything. */
    update(now = performance.now()) {
      NAMES.forEach(n => { this._prev[n] = this._down[n]; });
      const pad = this._findPad();
      let q;
      if (pad) {
        this.connected = true; this.source = 'phone';
        this._sig = trackSig(pad);
        this.mode = sigKnown(this._sig) && this._sig.code === SIG.GRIP ? 'grip' : 'wand';
        const a = pad.axes;
        const x = a[0], y = a[1], z = a[2];
        const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
        q = mul(mul(C, { x, y, z, w }), Ci);
        const k = 8 * G;
        const ap = { x: a[3] * k, y: a[4] * k, z: a[5] * k };
        this.accel = rotate(C, rotate({ x, y, z, w }, ap)); // phone frame -> level frame -> world
        NAMES.forEach((n, i) => { this._down[n] = !!(pad.buttons[i] && pad.buttons[i].pressed); });
      } else if (this.slot > 0) {
        this.connected = false; this.source = 'none'; this.mode = null; this._sig = null;
        q = { x: 0, y: 0, z: 0, w: 1 };
        this.accel = { x: 0, y: G, z: 0 };
        NAMES.forEach(n => { this._down[n] = false; });
      } else {
        this.connected = false; this.source = 'mouse'; this.mode = 'mouse'; this._sig = null;
        const m = this._mouse;
        q = fromEuler(-m.x * 0.9, m.y * 0.6, 0);
        this.accel = { x: 0, y: G, z: 0 };
        const map = { a: m.buttons[0] || m.keys[' '], b: m.buttons[2] || m.keys['Enter'], one: m.keys['1'], two: m.keys['2'],
          minus: m.keys['-'], plus: m.keys['='] || m.keys['+'], home: m.keys['h'], up: m.keys['ArrowUp'], down: m.keys['ArrowDown'],
          left: m.keys['ArrowLeft'], right: m.keys['ArrowRight'], center: m.keys['c'] };
        NAMES.forEach(n => { this._down[n] = !!map[n]; });
      }
      // accelerometer reads +g upward at rest; remove it
      this.linearAccel = { x: this.accel.x, y: this.accel.y - G, z: this.accel.z };

      // angular velocity from successive orientations (world frame)
      if (this._lastQ) {
        const dt = Math.max(1e-3, (now - this._lastT) / 1000);
        let d = mul(q, { x: -this._lastQ.x, y: -this._lastQ.y, z: -this._lastQ.z, w: this._lastQ.w });
        if (d.w < 0) d = { x: -d.x, y: -d.y, z: -d.z, w: -d.w };
        const s = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
        const ang = 2 * Math.atan2(s, d.w);
        const k = s > 1e-9 ? ang / s / dt : 0;
        const raw = { x: d.x * k, y: d.y * k, z: d.z * k };
        // light smoothing: Bluetooth delivers ~125 Hz, frames ~60 Hz, so steps are uneven
        const sm = 0.5, av = this.angularVelocity;
        this.angularVelocity = { x: av.x + (raw.x - av.x) * sm, y: av.y + (raw.y - av.y) * sm, z: av.z + (raw.z - av.z) * sm };
      }
      this._lastQ = q; this._lastT = now;
      const av = this.angularVelocity;
      this.angularSpeed = Math.hypot(av.x, av.y, av.z);

      this.quat = q;
      this.forward = rotate(q, { x: 0, y: 0, z: -1 });
      this.up = rotate(q, { x: 0, y: 1, z: 0 });
      const f = this.forward;
      this.yaw = Math.atan2(-f.x, -f.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
      // arm-modelled hand position and velocity
      const prevHand = this.arm.hand, prevT = this._armT;
      const armDt = prevT !== undefined ? Math.max(1e-3, (now - prevT) / 1000) : 0;
      const pose = this._continuous
        ? armPose(q, this._hand, this._armSt, armDt * (0.6 + 0.15 * this.angularSpeed))
        : armPose(q, this._hand);
      let hv = this.arm.handVelocity;
      if (prevT !== undefined) {
        const dt = Math.max(1e-3, (now - prevT) / 1000);
        const raw = { x: (pose.hand.x - prevHand.x) / dt, y: (pose.hand.y - prevHand.y) / dt, z: (pose.hand.z - prevHand.z) / dt };
        hv = { x: hv.x + (raw.x - hv.x) * 0.5, y: hv.y + (raw.y - hv.y) * 0.5, z: hv.z + (raw.z - hv.z) * 0.5 };
      }
      this._armT = now;
      this.arm = Object.assign(pose, { handVelocity: hv });

      const right = rotate(q, { x: 1, y: 0, z: 0 });
      this.roll = Math.atan2(right.y, this.up.y);
      // pointer on a virtual screen ~0.9 rad wide, 0.55 rad tall
      this.pointer = {
        x: Math.max(-1.2, Math.min(1.2, -this.yaw / 0.45)),
        y: Math.max(-1.2, Math.min(1.2, this.pitch / 0.3)),
        onScreen: f.z < 0 && Math.abs(this.yaw) < 0.55 && Math.abs(this.pitch) < 0.35,
      };
      return this;
    }

    /** Which hand holds the phone: 'right' (default) or 'left'. */
    setHand(side) { this._hand = side === 'left' ? 'left' : 'right'; }

    /**
     * Ask permission to vibrate the phone (Chrome WebHID). Must be called from a click or key
     * press: Chrome shows a one-time device chooser (only when no granted phone is around, or
     * fewer are granted than phones present). Resolves true when rumble is ready. The same grant
     * lets Grip switch to motion by itself on every Mimic game of this site.
     */
    async enableRumble(opts = {}) {
      const hid = nav().hid;
      if (!hid) return false;
      try {
        await hidMgr.adopt();
        const missing = !hidMgr.devices.length || hidMgr.devices.length < motionPads().length;
        // the chooser shows at most once per page (games call this on every click, and a
        // cancelled chooser coming back each time is maddening); { ask: true } from an explicit
        // "enable vibration" button asks again
        if (missing && (opts.ask || !hidMgr.asked)) {
          hidMgr.asked = true;
          await hidMgr.open(await hid.requestDevice({ filters: [{ vendorId: VID, productId: PID }] }));
        }
        return hidMgr.devices.length > 0;
      } catch (e) { return hidMgr.devices.length > 0; }
    }

    /**
     * Make the phone kick: strength 0..1, duration ms (max 255), pattern 0 impact, 1 buzz, 2 rise,
     * 3 double. With several phones it goes to this slot's phone when the tags tell them apart,
     * otherwise to all of them.
     */
    async rumble(strength, ms, pattern = 0) {
      const targets = this._rumbleTargets();
      if (!targets.length) return false;
      const st = Math.round(Math.max(0, Math.min(1, strength)) * 255);
      const d = Math.max(0, Math.min(255, Math.round(ms)));
      const ok = await Promise.all(targets.map(t => hidMgr.send(t, [st, d, pattern & 3])));
      return ok.some(Boolean);
    }

    get rumbleReady() { return hidMgr.devices.length > 0; }

    _rumbleTargets() {
      const devs = hidMgr.devices;
      if (devs.length <= 1 || !sigKnown(this._sig)) return devs.slice();
      const tag = this._sig.tag;
      const mine = devs.filter(d => hidMgr.tags.get(d) === tag);
      // another phone echoing the same tag (one not granted, still on 0): cannot tell, send to all
      let claims = 0;
      for (const p of motionPads()) { const st = sigs.get(p.index); if (sigKnown(st) && st.tag === tag) claims++; }
      return mine.length === 1 && claims <= 1 ? mine : devs.slice();
    }

    isDown(name) { return this._down[name]; }
    /** True only on the frame the button went down. */
    pressed(name) { return this._down[name] && !this._prev[name]; }
    released(name) { return !this._down[name] && this._prev[name]; }

    /** Rotate a vector from controller-local space (forward = -Z, face = +Y) to world. */
    toWorld(v) { return rotate(this.quat, v); }

    _findPad() {
      const p = motionPads()[this.slot];
      return p && sending(p) ? p : null;
    }

    _installFallback() {
      const m = this._mouse;
      addEventListener('mousemove', e => {
        m.x = (e.clientX / innerWidth) * 2 - 1;
        m.y = -((e.clientY / innerHeight) * 2 - 1);
      });
      addEventListener('mousedown', e => { m.buttons[e.button] = true; });
      addEventListener('mouseup', e => { m.buttons[e.button] = false; });
      addEventListener('contextmenu', e => e.preventDefault());
      addEventListener('keydown', e => { m.keys[e.key] = true; if (e.key === ' ') e.preventDefault(); });
      addEventListener('keyup', e => { m.keys[e.key] = false; });
      addEventListener('blur', () => { m.buttons = {}; m.keys = {}; });
    }
  }

  global.MimicController = MimicController;
  global.MimicMath = { mul, rotate, fromEuler, armPose, qpow, qpowFollow };
})(window);
