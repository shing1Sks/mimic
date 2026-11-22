/*
 * Mimic state sync: one game runs the match (the host); a friend's copy of the same game page draws
 * it from the host's state instead of a video of it. Pure code, no DOM (node games/lib/test/mimic-sync.test.js).
 *
 * The replicator: both pages build the same scene, so both list the same entities in the same order
 * (an object's transform, visibility, material opacity/colour; a skinned figure's bone rotations;
 * any numbers the game wants carried). The host encodes, every frame, only what changed in the last
 * few frames (so one lost packet heals itself) plus each entity in full now and then; the friend's
 * page decodes into full snapshots stamped with the host's clock.
 *
 * Sizes: positions f32, rotations "smallest three" in 32 bits (~0.08 deg per component), bone
 * rotations the same; a typical cricket frame is ~1.5 KB.
 *
 * The playout: the friend's page shows the host's state as it was D ms ago, D = the network's floor
 * one-way delay plus its jitter (p95, adaptive), and draws the newest snapshot not newer than that,
 * blended toward the next one if it is already in. That is the lowest delay at which frames still
 * come out evenly paced (no doubled or skipped frames from jitter); D is what the game uses to judge
 * that player's timing.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ quaternions in 32 bits
  const S = Math.SQRT1_2;
  /** Smallest three: the index of the largest component (2 bits) and the other three at 10 bits. */
  function packQuat(x, y, z, w) {
    const a = [x, y, z, w];
    let i = 0, m = Math.abs(x);
    for (let k = 1; k < 4; k++) { const v = Math.abs(a[k]); if (v > m) { m = v; i = k; } }
    const sg = a[i] < 0 ? -1 : 1;
    let out = i << 30, sh = 20;
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      let q = Math.round((a[k] * sg * S + 0.5) * 1023);
      q = q < 0 ? 0 : q > 1023 ? 1023 : q;
      out |= q << sh; sh -= 10;
    }
    return out >>> 0;
  }
  function unpackQuat(u, out, o) {
    o = o || 0;
    const i = u >>> 30;
    let sh = 20, ss = 0;
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      const v = (((u >>> sh) & 1023) / 1023 - 0.5) / S;
      out[o + k] = v; ss += v * v; sh -= 10;
    }
    out[o + i] = Math.sqrt(Math.max(0, 1 - ss));
    return out;
  }

  // ------------------------------------------------------------------ bytes
  class Writer {
    constructor(n) { this.buf = new ArrayBuffer(n || 4096); this.dv = new DataView(this.buf); this.o = 0; }
    need(n) {
      if (this.o + n <= this.buf.byteLength) return;
      const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
      new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
      this.buf = nb; this.dv = new DataView(nb);
    }
    u8(v) { this.need(1); this.dv.setUint8(this.o, v); this.o += 1; }
    u16(v) { this.need(2); this.dv.setUint16(this.o, v, true); this.o += 2; }
    u32(v) { this.need(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
    f32(v) { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
    f64(v) { this.need(8); this.dv.setFloat64(this.o, v, true); this.o += 8; }
    bytes() { return this.buf.slice(0, this.o); }
    reset() { this.o = 0; }
  }
  class Reader {
    constructor(buf) { this.dv = new DataView(buf); this.o = 0; }
    u8() { const v = this.dv.getUint8(this.o); this.o += 1; return v; }
    u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
    u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
    f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
    f64() { const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  }

  // ------------------------------------------------------------------ the replicator
  // per-entity groups, in this order in the entity's float layout and on the wire (bit = group flag)
  const G_POS = 1, G_QUAT = 2, G_VIS = 4, G_SCALE = 8, G_PARENT = 16, G_OPAC = 32, G_COLOR = 64, G_MORE = 128;
  const MAGIC = 0x5d, VERSION = 1;
  const REDUNDANT = 3;      // frames a change keeps being sent (a lost packet heals by the next one)
  const REFRESH = 20;       // every entity in full this often (frames), staggered
  const EPS_P = 1e-4, EPS_S = 1e-4, EPS_O = 1 / 512, EPS_X = 1e-5;

  /**
   * spec.entities: [{
   *   obj: () => Object3D,                 position, quaternion, visible
   *   scale: true,                         also its scale
   *   parents: () => [Object3D...],        reparented among these (index sent when it changes)
   *   opacity: { get(), set(v) },          a material opacity (0..1)
   *   color: { get() -> 0xRRGGBB, set(hex) },
   *   extras: [{ get(), set(v) }],         numbers (f32), up to 8
   *   bits: [{ get(), set(b) }],           booleans, up to 8 (sent together)
   *   bones: () => [Object3D...],          local rotations of these (up to 32)
   *   boneT: () => [Object3D...],          local positions of these (up to 32)
   * }]
   * Both pages must list the same entities in the same order.
   */
  function createReplicator(spec) {
    const E = spec.entities.map((e, idx) => {
      const L = { idx, e, n: 0 };
      const take = k => { const at = L.n; L.n += k; return at; };
      L.pos = take(3); L.quat = take(4); L.vis = take(1);
      if (e.scale) L.scale = take(3);
      if (e.parents) L.parent = take(1);
      if (e.opacity) L.opac = take(1);
      if (e.color) L.color = take(1);
      L.extras = (e.extras || []).map(() => take(1));
      if (e.bits) L.bits = take(1);
      L.nb = 0; L.nt = 0;
      return L;
    });
    let bonesBound = false;
    /** Bones are known once the figures exist (models load later): call when they do. */
    function bindBones() {
      for (const L of E) {
        const bs = L.e.bones ? L.e.bones() || [] : [], ts = L.e.boneT ? L.e.boneT() || [] : [];
        L.boneList = bs.slice(0, 32); L.tList = ts.slice(0, 32);
        L.nb = L.boneList.length; L.nt = L.tList.length;
      }
      // the layout grows by the bones: every slot after the fixed ones
      for (const L of E) { L.bq = L.n; L.n += L.nb * 4; L.bt = L.n; L.n += L.nt * 3; }
      offsets();
      bonesBound = true;
    }
    let total = 0;
    function offsets() { total = 0; for (const L of E) { L.base = total; total += L.n; } }
    offsets();

    // ---- host
    let seq = 0;
    const W = new Writer(8192);
    let prev = null, chg = null;   // last sent values, and the seq each slot-group last changed
    function read(L, out) {
      const e = L.e, b = L.base, o = e.obj && e.obj();
      if (o) {
        out[b + L.pos] = o.position.x; out[b + L.pos + 1] = o.position.y; out[b + L.pos + 2] = o.position.z;
        const q = o.quaternion; out[b + L.quat] = q.x; out[b + L.quat + 1] = q.y; out[b + L.quat + 2] = q.z; out[b + L.quat + 3] = q.w;
        out[b + L.vis] = o.visible ? 1 : 0;
        if (L.scale !== undefined) { out[b + L.scale] = o.scale.x; out[b + L.scale + 1] = o.scale.y; out[b + L.scale + 2] = o.scale.z; }
        if (L.parent !== undefined) { const ps = e.parents(); out[b + L.parent] = Math.max(0, ps.indexOf(o.parent)); }
      }
      if (L.opac !== undefined) out[b + L.opac] = e.opacity.get();
      if (L.color !== undefined) out[b + L.color] = e.color.get();
      L.extras.forEach((s, i) => { out[b + s] = e.extras[i].get(); });
      if (L.bits !== undefined) { let v = 0; e.bits.forEach((x, i) => { if (x.get()) v |= 1 << i; }); out[b + L.bits] = v; }
      for (let i = 0; i < L.nb; i++) { const q = L.boneList[i].quaternion, s = b + L.bq + i * 4; out[s] = q.x; out[s + 1] = q.y; out[s + 2] = q.z; out[s + 3] = q.w; }
      for (let i = 0; i < L.nt; i++) { const p = L.tList[i].position, s = b + L.bt + i * 3; out[s] = p.x; out[s + 1] = p.y; out[s + 2] = p.z; }
    }
    const diff = (a, b, s, k, eps) => { for (let i = 0; i < k; i++) if (!(Math.abs(a[s + i] - b[s + i]) <= eps)) return true; return false; };   // (NaN: never sent)
    // a rotation is "changed" past its 32-bit quantisation (q and -q are the same rotation)
    const qdiff = (a, b, s) => !(Math.abs(a[s] * b[s] + a[s + 1] * b[s + 1] + a[s + 2] * b[s + 2] + a[s + 3] * b[s + 3]) >= 0.9999995);

    /** The host's state now as one packet. t: host clock (ms) of the frame this state belongs to. */
    function encode(t) {
      const cur = new Float32Array(total);
      for (const L of E) read(L, cur);
      // group ids per entity: fixed groups 0..6, extras 7..14, bits 15, bones 16.., boneT after
      if (!prev || prev.length !== total) { prev = new Float32Array(total).fill(NaN); chg = E.map(L => new Int32Array(16 + L.nb + L.nt).fill(-1e9)); }
      seq++;
      W.reset();
      W.u8(MAGIC); W.u8(VERSION); W.u32(seq); W.f64(t); W.u16(E.length);
      const countAt = W.o - 2;
      let count = 0;
      for (const L of E) {
        const b = L.base, C = chg[L.idx], full = (seq + L.idx) % REFRESH === 0;
        const mark = (g, changed) => { if (changed) C[g] = seq; return full || seq - C[g] < REDUNDANT; };
        let m = 0;
        if (mark(0, diff(cur, prev, b + L.pos, 3, EPS_P))) m |= G_POS;
        if (mark(1, qdiff(cur, prev, b + L.quat))) m |= G_QUAT;
        if (mark(2, cur[b + L.vis] !== prev[b + L.vis])) m |= G_VIS;
        if (L.scale !== undefined && mark(3, diff(cur, prev, b + L.scale, 3, EPS_S))) m |= G_SCALE;
        if (L.parent !== undefined && mark(4, cur[b + L.parent] !== prev[b + L.parent])) m |= G_PARENT;
        if (L.opac !== undefined && mark(5, diff(cur, prev, b + L.opac, 1, EPS_O))) m |= G_OPAC;
        if (L.color !== undefined && mark(6, cur[b + L.color] !== prev[b + L.color])) m |= G_COLOR;
        let xm = 0;
        L.extras.forEach((s, i) => { if (mark(7 + i, diff(cur, prev, b + s, 1, EPS_X))) xm |= 1 << i; });
        const bitsOn = L.bits !== undefined && mark(15, cur[b + L.bits] !== prev[b + L.bits]);
        let bm = 0, tm = 0;
        // a hidden figure's bones don't matter: they're sent once it shows again (its full refresh)
        const shown = cur[b + L.vis] > 0, justShown = shown && seq - C[2] < REDUNDANT && seq > 1;
        for (let i = 0; i < L.nb; i++) if ((mark(16 + i, qdiff(cur, prev, b + L.bq + i * 4)) || justShown) && shown) bm |= 1 << i;
        for (let i = 0; i < L.nt; i++) if ((mark(16 + L.nb + i, diff(cur, prev, b + L.bt + i * 3, 3, EPS_P * 0.01)) || justShown) && shown) tm |= 1 << i;
        bm >>>= 0; tm >>>= 0;
        if (xm || bitsOn || bm || tm) m |= G_MORE;
        if (!m) continue;
        count++;
        W.u16(L.idx); W.u8(m);
        if (m & G_POS) { W.f32(cur[b + L.pos]); W.f32(cur[b + L.pos + 1]); W.f32(cur[b + L.pos + 2]); }
        if (m & G_QUAT) W.u32(packQuat(cur[b + L.quat], cur[b + L.quat + 1], cur[b + L.quat + 2], cur[b + L.quat + 3]));
        if (m & G_VIS) W.u8(cur[b + L.vis]);
        if (m & G_SCALE) { W.f32(cur[b + L.scale]); W.f32(cur[b + L.scale + 1]); W.f32(cur[b + L.scale + 2]); }
        if (m & G_PARENT) W.u8(cur[b + L.parent]);
        if (m & G_OPAC) W.u8(Math.round(Math.max(0, Math.min(1, cur[b + L.opac])) * 255));
        if (m & G_COLOR) { const c = cur[b + L.color]; W.u8((c >> 16) & 255); W.u8((c >> 8) & 255); W.u8(c & 255); }
        if (m & G_MORE) {
          W.u8(xm); W.u8(bitsOn ? 1 : 0); W.u32(bm); W.u32(tm);
          L.extras.forEach((s, i) => { if (xm & (1 << i)) W.f32(cur[b + s]); });
          if (bitsOn) W.u8(cur[b + L.bits]);
          for (let i = 0; i < L.nb; i++) if (bm & (1 << i)) { const s = b + L.bq + i * 4; W.u32(packQuat(cur[s], cur[s + 1], cur[s + 2], cur[s + 3])); }
          for (let i = 0; i < L.nt; i++) if (tm & (1 << i)) { const s = b + L.bt + i * 3; W.f32(cur[s]); W.f32(cur[s + 1]); W.f32(cur[s + 2]); }
        }
      }
      W.dv.setUint16(countAt, count, true);
      prev = cur;
      return W.bytes();
    }

    // ---- guest
    let state = null, lastSeq = 0;
    /** Fold a packet into the running state; returns { seq, t, snap (Float32Array copy) } or null (stale/foreign). */
    function decode(buf) {
      const R = new Reader(buf);
      if (R.u8() !== MAGIC || R.u8() !== VERSION) return null;
      const sq = R.u32(), t = R.f64(), n = R.u16();
      if (sq <= lastSeq) return null;          // older than what we have (unordered channel)
      lastSeq = sq;
      if (!state || state.length !== total) state = new Float32Array(total).fill(0);
      const st = state;
      for (let j = 0; j < n; j++) {
        const L = E[R.u16()], m = R.u8();
        if (!L) return null;
        const b = L.base;
        if (m & G_POS) { st[b + L.pos] = R.f32(); st[b + L.pos + 1] = R.f32(); st[b + L.pos + 2] = R.f32(); }
        if (m & G_QUAT) unpackQuat(R.u32(), st, b + L.quat);
        if (m & G_VIS) st[b + L.vis] = R.u8();
        if (m & G_SCALE) { st[b + L.scale] = R.f32(); st[b + L.scale + 1] = R.f32(); st[b + L.scale + 2] = R.f32(); }
        if (m & G_PARENT) st[b + L.parent] = R.u8();
        if (m & G_OPAC) st[b + L.opac] = R.u8() / 255;
        if (m & G_COLOR) st[b + L.color] = (R.u8() << 16) | (R.u8() << 8) | R.u8();
        if (m & G_MORE) {
          const xm = R.u8(), bo = R.u8(), bm = R.u32(), tm = R.u32();
          L.extras.forEach((s, i) => { if (xm & (1 << i)) st[b + s] = R.f32(); });
          if (bo) st[b + L.bits] = R.u8();
          for (let i = 0; i < L.nb; i++) if (bm & (1 << i)) unpackQuat(R.u32(), st, b + L.bq + i * 4);
          for (let i = 0; i < L.nt; i++) if (tm & (1 << i)) { const s = b + L.bt + i * 3; st[s] = R.f32(); st[s + 1] = R.f32(); st[s + 2] = R.f32(); }
        }
      }
      return { seq: sq, t, snap: st.slice() };
    }

    /** a and b blended k (0..1) of the way into out: positions/scales/numbers lerp, rotations nlerp, the rest step. */
    function mix(a, b, k, out) {
      out = out || new Float32Array(total);
      if (!b || k <= 0) { out.set(a); return out; }
      if (k >= 1) { out.set(b); return out; }
      for (const L of E) {
        const o = L.base;
        // a jump (back to the marks, a camera cut): no smear between the two places
        const dx = b[o + L.pos] - a[o + L.pos], dy = b[o + L.pos + 1] - a[o + L.pos + 1], dz = b[o + L.pos + 2] - a[o + L.pos + 2];
        const snap = dx * dx + dy * dy + dz * dz > 4;
        const src = snap ? b : null;
        const lerp = (s, n) => { for (let i = 0; i < n; i++) out[o + s + i] = src ? src[o + s + i] : a[o + s + i] + (b[o + s + i] - a[o + s + i]) * k; };
        const step = (s, n) => { for (let i = 0; i < n; i++) out[o + s + i] = (k < 0.5 ? a : b)[o + s + i]; };
        const nl = s => {
          if (src) { for (let i = 0; i < 4; i++) out[o + s + i] = src[o + s + i]; return; }
          const d = a[o + s] * b[o + s] + a[o + s + 1] * b[o + s + 1] + a[o + s + 2] * b[o + s + 2] + a[o + s + 3] * b[o + s + 3], sg = d < 0 ? -1 : 1;
          let x = a[o + s] + (b[o + s] * sg - a[o + s]) * k, y = a[o + s + 1] + (b[o + s + 1] * sg - a[o + s + 1]) * k, z = a[o + s + 2] + (b[o + s + 2] * sg - a[o + s + 2]) * k, w = a[o + s + 3] + (b[o + s + 3] * sg - a[o + s + 3]) * k;
          const l = Math.hypot(x, y, z, w) || 1;
          out[o + s] = x / l; out[o + s + 1] = y / l; out[o + s + 2] = z / l; out[o + s + 3] = w / l;
        };
        lerp(L.pos, 3); nl(L.quat); step(L.vis, 1);
        if (L.scale !== undefined) lerp(L.scale, 3);
        if (L.parent !== undefined) step(L.parent, 1);
        if (L.opac !== undefined) lerp(L.opac, 1);
        if (L.color !== undefined) step(L.color, 1);
        L.extras.forEach(s => lerp(s, 1));
        if (L.bits !== undefined) step(L.bits, 1);
        for (let i = 0; i < L.nb; i++) nl(L.bq + i * 4);
        lerp(L.bt, L.nt * 3);
      }
      return out;
    }

    /** Write a (mixed) snapshot into the scene. */
    function apply(s) {
      for (const L of E) {
        const e = L.e, b = L.base, o = e.obj && e.obj();
        if (o) {
          if (L.parent !== undefined) { const p = e.parents()[s[b + L.parent] | 0]; if (p && o.parent !== p) p.add(o); }
          o.position.set(s[b + L.pos], s[b + L.pos + 1], s[b + L.pos + 2]);
          o.quaternion.set(s[b + L.quat], s[b + L.quat + 1], s[b + L.quat + 2], s[b + L.quat + 3]);
          o.visible = s[b + L.vis] > 0;
          if (L.scale !== undefined) o.scale.set(s[b + L.scale], s[b + L.scale + 1], s[b + L.scale + 2]);
        }
        if (L.opac !== undefined) e.opacity.set(s[b + L.opac]);
        if (L.color !== undefined) e.color.set(s[b + L.color]);
        L.extras.forEach((sl, i) => e.extras[i].set(s[b + sl]));
        if (L.bits !== undefined) { const v = s[b + L.bits] | 0; e.bits.forEach((x, i) => x.set(!!(v & (1 << i)))); }
        for (let i = 0; i < L.nb; i++) { const q = L.boneList[i].quaternion, sl = b + L.bq + i * 4; q.set(s[sl], s[sl + 1], s[sl + 2], s[sl + 3]); }
        for (let i = 0; i < L.nt; i++) { const p = L.tList[i].position, sl = b + L.bt + i * 3; p.set(s[sl], s[sl + 1], s[sl + 2]); }
      }
    }

    return {
      bindBones, encode, decode, mix, apply,
      get bound() { return bonesBound; }, get size() { return total; }, get seq() { return seq; },
      reset() { prev = null; state = null; lastSeq = 0; },
    };
  }

  // ------------------------------------------------------------------ the playout clock
  /**
   * o: { win (ms of history for the delay floor and jitter, 3000), keep (snapshots, 12), margin (ms, 1),
   *      smooth (blend between frames: one frame interval more delay, sub-frame smooth motion),
   *      fixed (ms: use this delay instead of measuring) }.
   * push(t host ms, arrivalHost ms (the guest's arrival time on the host's clock), snap)
   * pick(nowHost) -> { a, b, k, t (host time of what is drawn), delay }.
   *
   * Default (lowest delay): draw the newest frame no newer than nowHost - D, D = the floor one-way
   * delay + p95 jitter + margin: every host frame then comes out once, evenly paced, as soon as the
   * network lets it be on time. smooth: D + one frame interval, blended (no stepping at all).
   */
  function createPlayout(o) {
    o = o || {};
    const win = o.win || 3000, keep = o.keep || 12, margin = o.margin == null ? 1 : o.margin;
    const snaps = [], obs = [];   // obs: [arrivalHost, d = arrival - t]
    let delay = null, interval = 1000 / 60, last = { base: null, jit: null };
    function push(t, arrivalHost, snap) {
      if (snaps.length) { const dt = t - snaps[snaps.length - 1].t; if (dt > 0 && dt < 100) interval += (dt - interval) * 0.05; }
      snaps.push({ t, snap });
      while (snaps.length > keep) snaps.shift();
      obs.push([arrivalHost, arrivalHost - t]);
      while (obs.length && obs[0][0] < arrivalHost - win) obs.shift();
      const ds = obs.map(x => x[1]).sort((x, y) => x - y);
      const base = ds[0], jit = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))] - base;
      const want = o.fixed != null ? o.fixed : base + jit + margin + (o.smooth ? interval : 0);
      last = { base, jit };
      // up at once (a slower network), down gently (no sudden jump back in time on screen)
      delay = delay === null || want > delay ? want : delay + (want - delay) * 0.05;   // (~0.3 s back down at 60 fps)
    }
    function pick(nowHost) {
      if (!snaps.length) return null;
      const r = nowHost - delay;
      let i = snaps.length - 1;
      while (i > 0 && snaps[i].t > r) i--;
      const a = snaps[i], b = snaps[i + 1];
      if (!o.smooth || !b || a.t > r) return { a: a.snap, b: null, k: 0, delay, t: a.t };
      const k = (r - a.t) / Math.max(1e-6, b.t - a.t);
      return { a: a.snap, b: b.snap, k: Math.max(0, Math.min(1, k)), delay, t: r };
    }
    return { push, pick, get delay() { return delay; }, get interval() { return interval; }, get floor() { return last.base; }, get jitter() { return last.jit; }, get count() { return snaps.length; }, clear() { snaps.length = 0; obs.length = 0; delay = null; } };
  }

  const api = { packQuat, unpackQuat, Writer, Reader, createReplicator, createPlayout, REDUNDANT, REFRESH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MimicSync = api;
})(typeof window !== 'undefined' ? window : null);
