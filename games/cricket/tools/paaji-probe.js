// Paaji timeline probe (init script for paaji-timeline.py): logs every commentary clip's fetch and
// decode, each clip source's start / stop / end, the caption, and the game's phases into window.__tl.
// It wraps browser APIs only, so it measures any version of the game the same way.
(function () {
  'use strict';
  const T = window.__tl = [];
  const now = () => performance.now();
  const log = (ev, o) => T.push(Object.assign({ t: Math.round(now()), ev }, o || {}));
  const urlOf = new WeakMap(), idOf = new WeakMap(), bySize = new Map();   // a copied buffer: known by its size
  const of = window.fetch;
  window.fetch = function (u, ...a) {
    const url = String((u && u.url) || u), m = /commentary\/([A-Za-z0-9_]+)\.ogg/.exec(url);
    if (m) log('fetch0', { id: m[1] });
    return of.call(this, u, ...a).then(r => {
      if (!m) return r;
      const ab = r.arrayBuffer.bind(r);
      r.arrayBuffer = () => ab().then(b => { urlOf.set(b, m[1]); bySize.set(b.byteLength, m[1]); log('fetch1', { id: m[1], bytes: b.byteLength }); return b; });
      return r;
    });
  };
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (b, ...a) {
    const id = urlOf.get(b) || (b && bySize.get(b.byteLength)), t0 = now(), bytes = b && b.byteLength;
    return dec.call(this, b, ...a).then(buf => {
      if (id) { idOf.set(buf, id); log('decoded', { id, ms: Math.round(now() - t0), dur: Math.round(buf.duration * 1000), mem: buf.length * buf.numberOfChannels * 4, sr: buf.sampleRate, bytes }); }
      return buf;
    });
  };
  const st = AudioBufferSourceNode.prototype.start, sp = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when, off, dur) {
    const id = this.buffer && idOf.get(this.buffer);
    if (id) {
      const ctx = this.context, at = when && when > ctx.currentTime ? (when - ctx.currentTime) * 1000 : 0;
      const p = this.__p = { id, t0: now() + at };
      log('start', { id, dur: Math.round(this.buffer.duration * 1000), delay: Math.round(at), ctx: ctx.state, off: off || 0 });
      this.addEventListener('ended', () => log('ended', { id, played: Math.round(now() - p.t0) }));
    }
    return st.call(this, when, off, dur);
  };
  AudioBufferSourceNode.prototype.stop = function (when) {
    if (this.__p) {
      const ctx = this.context, at = when && when > ctx.currentTime ? (when - ctx.currentTime) * 1000 : 0;
      log('stop', { id: this.__p.id, at: Math.round(now() + at - this.__p.t0), ahead: Math.round(at), dur: Math.round(this.buffer.duration * 1000) });
    }
    return sp.call(this, when);
  };
  let lastPhase = null, lastCap = null;
  const flags = {};
  function poll() {
    requestAnimationFrame(poll);
    const C = window.__cricket; if (!C || !C.G) return;
    const G = C.G;
    if (G.phase !== lastPhase) { log('phase', { p: G.phase, scr: G.screen }); lastPhase = G.phase; }
    for (const k of ['walk', 'replay', 'cutaway', 'drs']) { const v = !!G[k]; if (v !== !!flags[k]) { log(k + (v ? '0' : '1')); flags[k] = v; } }
    const el = document.getElementById('caption');
    if (el) {
      const on = el.classList.contains('on'), txt = on ? el.querySelector('span').textContent : null;
      if (txt !== lastCap) { log(txt ? 'cap' : 'cap0', txt ? { text: txt } : {}); lastCap = txt; }
    }
    const ctx = window.CK && CK.Audio && CK.Audio.state.ctx;
    if (ctx && ctx.state !== flags.cs) { log('ctx', { s: ctx.state }); flags.cs = ctx.state; }
  }
  requestAnimationFrame(poll);
})();
