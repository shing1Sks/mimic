/*
 * Duskwater - sound. Gunshots, reloads, bolt work, footsteps, brass and bullet impacts play
 * recorded samples (assets/sfx, see CREDITS.md); every one of them falls back to the original
 * synthesis (noise + oscillators) when its sample is missing. UI blips, hit markers, the round
 * foghorn and the wind bed stay synthesized.
 *
 * Positional sounds take a distance, a stereo pan and an occlusion flag: gain and low-pass fall
 * with distance, far sounds arrive late (speed of sound) and send more into a shared convolution
 * reverb, the slap of a shot off containers and water.
 */
(function (global) {
  'use strict';

  const GUNS = {
    //       crack freq, crack decay, thump start/end Hz, thump decay, tail decay, level
    tern:     { cf: 2600, cd: 0.09, t0: 170, t1: 60, td: 0.09, tail: 0.35, lvl: 0.75, q: 0.9 },
    skiff:    { cf: 3200, cd: 0.06, t0: 150, t1: 70, td: 0.06, tail: 0.25, lvl: 0.6, q: 1.1 },
    breaker:  { cf: 1900, cd: 0.12, t0: 120, t1: 45, td: 0.13, tail: 0.55, lvl: 0.85, q: 0.8 },
    longline: { cf: 1300, cd: 0.22, t0: 95, t1: 32, td: 0.28, tail: 1.2, lvl: 1.0, q: 0.7 },
  };

  // sample variants per sound
  const SHOTS = { tern: ['tern_1', 'tern_2'], skiff: ['skiff_1', 'skiff_2', 'skiff_3'], breaker: ['breaker_1', 'breaker_2'], longline: ['longline_1', 'longline_2'] };
  const SHOT_GAIN = { tern: 0.8, skiff: 0.62, breaker: 0.85, longline: 1.0 };
  const RELOAD = { tern: 'reload_tern', skiff: 'reload_skiff', breaker: 'reload_rifle', longline: 'reload_rifle' };
  const HIT = { metal: 'hit_metal', wood: 'hit_wood', concrete: 'hit_concrete' };
  const pick = list => list[Math.floor(Math.random() * list.length)];

  class Sfx {
    constructor() {
      const AC = global.AudioContext || global.webkitAudioContext;
      this.ok = !!AC;
      this.volume = 0.8;
      // split screen: sounds that belong to one player (their gun, their hurt) lean toward that
      // player's side of the screen; game.js sets this around such calls
      this.panBias = 0;
      if (!this.ok) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
      this.master = c.createGain(); this.master.gain.value = this.volume;
      this.master.connect(this.comp); this.comp.connect(c.destination);
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // brown-ish noise for wind and water
      this.brown = c.createBuffer(1, len, c.sampleRate);
      const b = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      this.ambStarted = false;
      this.buf = {};
      this.reloadNodes = {}; this.reloadTimers = {};
      // shared reverb: a generated harbour impulse (early slap off steel, long damp tail)
      this.verb = c.createConvolver();
      this.verb.buffer = this._impulse(2.4);
      this.verbIn = c.createGain(); this.verbIn.gain.value = 1;
      const vOut = c.createGain(); vOut.gain.value = 0.55;
      this.verbIn.connect(this.verb); this.verb.connect(vOut); vOut.connect(this.master);
    }

    _impulse(secs) {
      const c = this.ctx, n = Math.floor(c.sampleRate * secs), ir = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / c.sampleRate;
          const k = 0.25 + 0.7 * Math.min(1, t / secs); // darker as it decays
          lp += (Math.random() * 2 - 1 - lp) * (1 - k);
          d[i] = lp * Math.exp(-t * 3.1) * (t < 0.012 ? t / 0.012 : 1);
        }
        // early reflections: container walls and the far quay
        [0.07, 0.11, 0.16, 0.23].forEach((t, j) => {
          const i0 = Math.floor((t + ch * 0.007 + Math.random() * 0.01) * c.sampleRate);
          for (let k = 0; k < 300; k++) d[i0 + k] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-k / 60) / (j + 1);
        });
      }
      return ir;
    }

    /** Decode the sample ArrayBuffers from ArenaAssets (name -> buffer|null). Missing ones keep the synth. */
    loadSamples(map) {
      if (!this.ok || !map) return;
      Object.keys(map).forEach(name => {
        const ab = map[name];
        if (!ab) return;
        try {
          this.ctx.decodeAudioData(ab.slice(0)).then(b => { this.buf[name] = b; if (name === 'water_loop' && this.ambStarted) this._waterLoop(); }, () => {});
        } catch (e) { /* old decodeAudioData signature: skip, the synth covers it */ }
      });
    }
    has(name) { return !!(this.buf && this.buf[name]); }
    /** Play a sample into dest. o: { rate, gain, when (s from now), offset } */
    _sample(name, dest, o = {}) {
      const b = this.buf[name]; if (!b) return null;
      const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
      src.buffer = b; src.playbackRate.value = o.rate || 1;
      g.gain.value = o.gain == null ? 1 : o.gain;
      src.connect(g); g.connect(dest);
      src.start(c.currentTime + (o.when || 0), o.offset || 0);
      return src;
    }
    /** Distance chain for samples: low-pass + gain by distance, reverb send that grows with distance. */
    _far(dist, pan, occluded, level, verb) {
      const c = this.ctx;
      const near = 1 / (1 + Math.max(0, dist) / 11);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 18000 * Math.pow(near, 1.5) * (occluded ? 0.22 : 1));
      const out = this._out(pan, level * near * (occluded ? 0.5 : 1));
      lp.connect(out);
      const send = c.createGain(); send.gain.value = level * (verb == null ? 0.35 : verb) * Math.min(1, 0.25 + dist / 40);
      lp.connect(send); send.connect(this.verbIn);
      return lp;
    }

    resume() {
      if (!this.ok) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.ambStarted) { this.ambStarted = true; this._ambience(); }
    }
    setVolume(v) { this.volume = v; if (this.ok) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    get live() { return this.ok && this.ctx.state === 'running'; }

    // ---- building blocks
    _out(pan, gain) {
      const c = this.ctx, g = c.createGain();
      g.gain.value = gain;
      pan = (pan || 0) + this.panBias;
      if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.master); }
      else g.connect(this.master);
      return g;
    }
    _noise(dest, t, dur, type, freq, q, a, decay, buf) {
      const c = this.ctx, s = c.createBufferSource();
      s.buffer = buf || this.noise;
      s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t, Math.random() * 1.5); s.stop(t + dur);
      return f;
    }
    _tone(dest, t, type, f0, f1, a, decay, attack = 0.002) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + decay + 0.05);
    }
    /** Positional chain: distance -> gain and low-pass, occlusion muffles further. */
    _spatial(dist, pan, occluded, level) {
      const c = this.ctx;
      const near = 1 / (1 + Math.max(0, dist) / 9);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(500, 16000 * near * near * (occluded ? 0.25 : 1));
      const out = this._out(pan, level * near * (occluded ? 0.55 : 1));
      lp.connect(out);
      return lp;
    }

    // ---- game sounds
    shot(kind, dist = 0, pan = 0, occluded = false) {
      if (!this.live) return;
      const name = pick(SHOTS[kind] || SHOTS.breaker);
      if (this.buf[name]) {
        const lvl = SHOT_GAIN[kind] || 0.8, rate = 0.96 + Math.random() * 0.08;
        if (dist < 1) {
          this._sample(name, this._out(pan, lvl), { rate });
          const send = this.ctx.createGain(); send.gain.value = 0.22 * lvl; send.connect(this.verbIn);
          this._sample(name, send, { rate });
        } else {
          // far shots arrive late (343 m/s) and sound darker and wetter
          this._sample(name, this._far(dist, pan, occluded, lvl * 1.1, 0.6), { rate: rate * (dist > 35 ? 0.97 : 1), when: dist / 343 });
        }
        return;
      }
      const p = GUNS[kind] || GUNS.breaker, t = this.ctx.currentTime;
      const dest = dist < 1 ? this._out(pan, p.lvl) : this._spatial(dist, pan, occluded, p.lvl * 0.9);
      this._noise(dest, t, p.cd + 0.05, 'bandpass', p.cf, p.q, 0.9, p.cd);                 // crack
      this._noise(dest, t, 0.03, 'highpass', 5000, 0.7, 0.5, 0.025);                        // transient
      this._tone(dest, t, 'sine', p.t0, p.t1, 1.0, p.td);                                    // thump
      this._tone(dest, t, 'triangle', p.t0 * 2.1, p.t1 * 1.5, 0.25, p.td * 0.7);
      const tail = this._noise(dest, t + 0.01, p.tail + 0.1, 'lowpass', 900, 0.5, 0.22, p.tail); // harbour slap-back
      tail.frequency.exponentialRampToValueAtTime(220, t + p.tail);
      if (dist > 1) this._noise(dest, t + 0.09 + dist * 0.004, p.tail, 'lowpass', 600, 0.5, 0.12, p.tail * 0.8);
    }
    dry() { if (!this.live) return; if (this.buf.click) { this._sample('click', this._out(0, 0.5), { rate: 1.1 }); return; } const t = this.ctx.currentTime, o = this._out(0, 0.5); this._noise(o, t, 0.05, 'highpass', 3000, 2, 0.6, 0.03); this._tone(o, t, 'square', 900, 700, 0.08, 0.03); }
    footstep(dist = 0, pan = 0, occluded = false, heavy = false) {
      if (!this.live) return;
      const step = pick(['step_1', 'step_2', 'step_3']);
      if (this.buf[step]) {
        const dest = dist < 1 ? this._out(pan, 0.3) : this._far(dist * 0.8, pan, occluded, heavy ? 0.9 : 0.6, 0.15);
        this._sample(step, dest, { rate: 0.82 + Math.random() * 0.22, offset: 0.06 });
        return;
      }
      const t = this.ctx.currentTime;
      const dest = dist < 1 ? this._out(pan, 0.22) : this._spatial(dist * 0.8, pan, occluded, 0.5);
      this._noise(dest, t, 0.08, 'bandpass', 520 + Math.random() * 200, 1.2, heavy ? 0.9 : 0.6, 0.06);
      this._noise(dest, t + 0.025, 0.06, 'bandpass', 1500 + Math.random() * 500, 1.5, 0.25, 0.04);
      this._tone(dest, t, 'sine', 110, 60, 0.35, 0.06);
    }
    land() { if (!this.live) return; const t = this.ctx.currentTime, o = this._out(0, 0.4); this._noise(o, t, 0.15, 'lowpass', 500, 0.8, 0.9, 0.12); this._tone(o, t, 'sine', 90, 45, 0.6, 0.12); }
    impact(surface, dist = 5, pan = 0) {
      if (!this.live) return;
      const hit = HIT[surface] || HIT.concrete;
      if (this.buf[hit]) {
        this._sample(hit, this._far(dist, pan, false, surface === 'metal' ? 0.45 : 0.5, 0.25), { rate: 0.85 + Math.random() * 0.35 });
        if (surface === 'metal' && Math.random() < 0.3) { // the odd ricochet whine
          const t = this.ctx.currentTime;
          this._tone(this._far(dist, pan, false, 0.08, 0.2), t + 0.02, 'sine', 3200 + Math.random() * 1500, 900, 0.5, 0.35, 0.01);
        }
        return;
      }
      const t = this.ctx.currentTime, dest = this._spatial(dist, pan, false, 0.5);
      if (surface === 'metal') {
        this._tone(dest, t, 'sine', 2400 + Math.random() * 1600, 1800, 0.25, 0.18);
        this._noise(dest, t, 0.06, 'highpass', 3500, 0.8, 0.35, 0.04);
      } else if (surface === 'wood') {
        this._noise(dest, t, 0.08, 'bandpass', 800, 2, 0.6, 0.06);
        this._tone(dest, t, 'triangle', 300, 180, 0.2, 0.05);
      } else {
        this._noise(dest, t, 0.1, 'bandpass', 1200, 0.9, 0.55, 0.07);
      }
    }
    hitmarker(head, kill) {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(0, 0.45);
      if (head) { this._tone(o, t, 'sine', 2350, 2350, 0.4, 0.22); this._tone(o, t, 'sine', 3520, 3520, 0.18, 0.15); }
      else this._noise(o, t, 0.04, 'bandpass', 2600, 3, 0.7, 0.03);
      if (kill) { this._tone(o, t + 0.05, 'triangle', 660, 660, 0.25, 0.15); this._tone(o, t + 0.12, 'triangle', 990, 990, 0.2, 0.2); }
    }
    hurt(heavy) {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(0, 0.6);
      this._tone(o, t, 'sine', heavy ? 120 : 160, 50, 0.9, 0.18);
      this._noise(o, t, 0.12, 'lowpass', 700, 1, 0.5, 0.1);
    }
    flesh(dist, pan) { if (!this.live) return; const t = this.ctx.currentTime, d = this._spatial(dist, pan, false, 0.5); this._noise(d, t, 0.06, 'lowpass', 900, 1, 0.8, 0.05); }
    /** A whole reload of `weapon` lasting `secs`: sampled when possible, else the synth clicks. key: whose reload (split screen). */
    reloadSeq(weapon, secs, key = 0) {
      if (!this.live) return;
      this.stopReload(key);
      const nodes = this.reloadNodes[key] = [], timers = this.reloadTimers[key] = [];
      const b = this.buf[RELOAD[weapon]];
      if (b) {
        const when = Math.max(0, Math.min(0.25, secs - b.duration - 0.05));
        const rate = b.duration > secs - 0.1 ? b.duration / (secs - 0.1) : 1;
        nodes.push(this._sample(RELOAD[weapon], this._out(0.12, 0.55), { when, rate }));
        if (weapon === 'longline' && this.buf.bolt) nodes.push(this._sample('bolt', this._out(0.12, 0.35), { when: Math.max(0, secs - 1.45), offset: 0.3 }));
        return;
      }
      this.reload('out');
      const bias = this.panBias;
      const later = part => () => { const b0 = this.panBias; this.panBias = bias; this.reload(part); this.panBias = b0; };
      timers.push(setTimeout(later('in'), secs * 600), setTimeout(later('bolt'), secs * 880));
    }
    /** Cut a reload short (weapon switch, death). No key: every reload. */
    stopReload(key) {
      if (!this.ok) return;
      const keys = key == null ? Object.keys(this.reloadNodes) : [key];
      keys.forEach(k => {
        (this.reloadNodes[k] || []).forEach(n => { try { if (n) n.stop(); } catch (e) { /* already ended */ } });
        (this.reloadTimers[k] || []).forEach(clearTimeout);
        this.reloadNodes[k] = []; this.reloadTimers[k] = [];
      });
    }
    /** Bolt cycle after a Longline shot. */
    bolt() { if (!this.live) return; if (this.buf.bolt) this._sample('bolt', this._out(0.1, 0.3), { offset: 0.25 }); else this.reload('bolt'); }
    /** Weapon swap: a short handling clack. */
    swap() { if (!this.live) return; if (this.buf.click) this._sample('click', this._out(0.1, 0.35), { rate: 0.8 }); else this.reload('shell'); }
    /** Brass hitting the ground, `when` seconds from now. */
    shell(when = 0.45, dist = 0, pan = 0) {
      if (!this.live) return;
      const n = pick(['shell_1', 'shell_2', 'shell_3']);
      if (!this.buf[n]) return;
      const dest = dist < 1 ? this._out(pan + 0.2, 0.16) : this._far(dist, pan, false, 0.25, 0.1);
      this._sample(n, dest, { when, rate: 1.25 + Math.random() * 0.4 });
    }
    reload(part) {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(0.15, 0.4);
      const f = { out: [1800, 0.05], in: [1100, 0.07], bolt: [2600, 0.04], shell: [3200, 0.03] }[part] || [1500, 0.05];
      this._noise(o, t, f[1] + 0.03, 'bandpass', f[0], 4, 0.8, f[1]);
      this._noise(o, t + f[1] * 0.6, f[1] + 0.03, 'bandpass', f[0] * 1.4, 5, 0.5, f[1] * 0.8);
      if (part === 'bolt') this._tone(o, t, 'square', 400, 300, 0.05, 0.04);
    }
    ui(kind) {
      if (!this.ok) return;
      this.resume();
      const t = this.ctx.currentTime, o = this._out(0, 0.25);
      if (kind === 'move') this._tone(o, t, 'triangle', 880, 880, 0.18, 0.05);
      else if (kind === 'ok') { this._tone(o, t, 'triangle', 660, 660, 0.25, 0.08); this._tone(o, t + 0.06, 'triangle', 990, 990, 0.2, 0.1); }
      else if (kind === 'buy') { this._tone(o, t, 'square', 1320, 1320, 0.08, 0.05); this._tone(o, t + 0.05, 'square', 1760, 1760, 0.08, 0.08); this._noise(o, t + 0.02, 0.1, 'highpass', 6000, 1, 0.2, 0.08); }
      else if (kind === 'deny') this._tone(o, t, 'square', 180, 150, 0.15, 0.15);
      else if (kind === 'back') this._tone(o, t, 'triangle', 520, 400, 0.18, 0.07);
    }
    /** Round start: a two-note foghorn rolling in off the water. */
    horn() {
      if (!this.live) return;
      const c = this.ctx, t = c.currentTime, o = this._out(0, 0.3);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2; lp.connect(o);
      [[0, 82.4], [1.0, 73.4]].forEach(([dt, f]) => {
        [1, 1.005, 2.002].forEach((m, k) => {
          const os = c.createOscillator(), g = c.createGain();
          os.type = 'sawtooth'; os.frequency.value = f * m;
          g.gain.setValueAtTime(0.0001, t + dt);
          g.gain.exponentialRampToValueAtTime(k === 2 ? 0.15 : 0.4, t + dt + 0.18);
          g.gain.setValueAtTime(k === 2 ? 0.15 : 0.4, t + dt + 0.75);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.3);
          os.connect(g); g.connect(lp); os.start(t + dt); os.stop(t + dt + 1.4);
        });
      });
    }
    sting(win) {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(0, 0.22);
      const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
      notes.forEach((f, i) => this._tone(o, t + i * 0.11, 'triangle', f, f, 0.5, 0.35, 0.01));
    }
    tick() { if (!this.live) return; const t = this.ctx.currentTime; this._tone(this._out(0, 0.15), t, 'sine', 1400, 1400, 0.3, 0.05); }

    // ---- gulls (gull.js): all synthesized
    /** A herring gull's "kee-ow" call, two or three notes; dist 0 = the player's own gull. */
    gullCry(dist = 0, pan = 0, notes = 0) {
      if (!this.live) return;
      const c = this.ctx, t0 = c.currentTime, n = notes || 2 + Math.floor(Math.random() * 2);
      const dest = dist < 1 ? this._out(pan, 0.2) : this._spatial(dist, pan, false, 0.5);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 1.4; bp.connect(dest);
      const base = 1650 + Math.random() * 250;
      for (let i = 0; i < n; i++) {
        const t = t0 + i * (0.2 + Math.random() * 0.05), len = i === 0 ? 0.24 : 0.17;
        const o = c.createOscillator(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base * (i === 0 ? 0.82 : 1.05), t);
        o.frequency.linearRampToValueAtTime(base * 1.2, t + len * 0.25);
        o.frequency.exponentialRampToValueAtTime(base * 0.62, t + len);
        vib.frequency.value = 38; vg.gain.value = 70; vib.connect(vg); vg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g); g.connect(bp);
        o.start(t); vib.start(t); o.stop(t + len + 0.03); vib.stop(t + len + 0.03);
      }
    }
    /** One wing beat (own gull only: soft, close). */
    flap() { if (!this.live) return; const t = this.ctx.currentTime; this._noise(this._out(0, 0.12), t, 0.12, 'lowpass', 520, 0.7, 0.7, 0.1, this.brown); }
    /** The dive: air tearing past, rising over `secs`. */
    diveWhoosh(secs = 1) {
      if (!this.live) return;
      const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + secs);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + secs * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + secs + 0.15);
      s.connect(f); f.connect(g); g.connect(this._out(0, 1));
      s.start(t, Math.random()); s.stop(t + secs + 0.2);
    }
    /** A gull hits someone in the face: wet thump, feathers, an indignant squawk. */
    gullHit(dist = 0, pan = 0) {
      if (!this.live) return;
      const t = this.ctx.currentTime, d = dist < 1 ? this._out(pan, 0.7) : this._spatial(dist, pan, false, 0.8);
      this._tone(d, t, 'sine', 140, 55, 0.9, 0.16);
      this._noise(d, t, 0.25, 'lowpass', 1100, 0.8, 0.8, 0.22);
      this._noise(d, t + 0.03, 0.3, 'bandpass', 3200, 1.5, 0.35, 0.25);
      this.gullCry(dist, pan, 1);
    }
    /** A gull shot out of the sky: a puff of feathers and a short squawk. */
    gullDown(dist = 0, pan = 0) {
      if (!this.live) return;
      const t = this.ctx.currentTime, d = dist < 1 ? this._out(pan, 0.5) : this._spatial(dist, pan, false, 0.6);
      this._noise(d, t, 0.3, 'bandpass', 1800, 0.9, 0.6, 0.28);
      this.gullCry(dist, pan, 1);
    }
    /** The round-winning kill: a deep drop under the slow-motion. */
    finalBlow() {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(0, 0.55);
      this._tone(o, t, 'sine', 70, 28, 1, 1.3, 0.01);
      this._noise(o, t, 1.2, 'lowpass', 260, 0.7, 0.5, 1.1, this.brown);
    }
    /** Low health: a heartbeat (lub-dub) for the player who is in trouble. */
    heartbeat(pan = 0) {
      if (!this.live) return;
      const t = this.ctx.currentTime, o = this._out(pan, 0.35);
      this._tone(o, t, 'sine', 62, 40, 0.9, 0.12, 0.005);
      this._tone(o, t + 0.17, 'sine', 55, 36, 0.6, 0.1, 0.005);
    }

    _waterLoop() {
      if (this.waterSrc || !this.buf.water_loop) return;
      const c = this.ctx, src = c.createBufferSource(); src.buffer = this.buf.water_loop; src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = c.createGain(); g.gain.value = 0.07;
      src.connect(lp); lp.connect(g); g.connect(this.master); src.start();
      this.waterSrc = src;
    }
    _ambience() {
      const c = this.ctx;
      const src = c.createBufferSource(); src.buffer = this.brown; src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0.11;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 160;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      src.connect(lp); lp.connect(g); g.connect(this.master); src.start();
      this._waterLoop();
      // distant water lapping
      const lap = () => {
        if (this.live) {
          const t = c.currentTime, o = this._out(-0.3 + Math.random() * 0.6, 0.05);
          this._noise(o, t, 0.6, 'lowpass', 300 + Math.random() * 200, 1, 0.8, 0.5, this.brown);
        }
        setTimeout(lap, 1400 + Math.random() * 2600);
      };
      lap();
    }
  }

  global.ArenaSfx = Sfx;
})(window);
