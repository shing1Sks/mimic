/*
 * Cadence Cut - procedural audio.
 * A tiny WebAudio synth (drums, bass, arp, pad, lead, risers, SFX) and a step sequencer that
 * schedules every 16th note at an exact AudioContext time computed from the step index, so the
 * music never drifts and the game can derive block timing from the same clock.
 */
(function (global) {
  'use strict';

  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const QUAL = {
    M: [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7],
    '7': [0, 4, 7, 10], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], madd9: [0, 3, 7, 14],
  };
  function midi(name) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
    return NOTE[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  }
  function chord(spec) {
    const parts = spec.split(':');
    const r = midi(parts[0]);
    return QUAL[parts[1]].map(i => r + i);
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // small deterministic RNG
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** Expand a song definition: section table per bar, chords per bar, a generated lead melody. */
  function prepareSong(song) {
    if (song._prepared) return song;
    const bars = [];
    song.sections.forEach(sec => {
      const layers = {};
      sec.layers.split('').forEach(ch => { if (ch !== ' ') layers[ch] = true; });
      sec.layerSet = layers;
      sec.start = bars.length;
      for (let i = 0; i < sec.bars; i++) bars.push(sec);
    });
    song.barSections = bars;
    song.totalBars = bars.length;
    song.stepDur = 60 / song.bpm / 4;
    song.beatDur = 60 / song.bpm;
    song.duration = song.totalBars * 16 * song.stepDur;
    song.chordsA = song.prog.map(chord);
    song.chordsB = (song.progB || song.prog).map(chord);
    song.melody = makeMelody(song);
    song._prepared = true;
    return song;
  }

  function chordForBar(song, bar) {
    const sec = song.barSections[Math.max(0, Math.min(song.totalBars - 1, bar))];
    const list = sec.alt ? song.chordsB : song.chordsA;
    return list[(bar - sec.start) % list.length];
  }

  // A 4-bar lead phrase built from chord tones on strong steps and scale steps in between.
  function makeMelody(song) {
    const r = rng(hash(song.id + ':melody'));
    const scale = song.scale;
    const root = song.keyRoot;
    const degToMidi = d => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const rhythms = [
      [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
      [[0, 6], [6, 2], [8, 2], [10, 6]],
      [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]],
      [[0, 4], [4, 2], [6, 2], [8, 8]],
      [[2, 2], [4, 2], [6, 4], [10, 3], [13, 3]],
    ];
    const phrase = [];
    let deg = 4 + Math.floor(r() * 3);
    const pick = [0, 1, 2, 3].map(() => rhythms[Math.floor(r() * rhythms.length)]);
    pick[3] = rhythms[3]; // phrase ends on a long note
    for (let bar = 0; bar < 4; bar++) {
      const ch = song.chordsA[bar % song.chordsA.length];
      const pcs = ch.map(n => ((n % 12) + 12) % 12);
      const notes = [];
      pick[bar].forEach(([step, len], i) => {
        const strong = step === 0 || step === 8 || i === pick[bar].length - 1;
        if (strong) {
          // nearest chord tone to current degree
          let best = deg, bestD = 99;
          for (let d = 0; d <= 11; d++) {
            const pc = ((degToMidi(d) % 12) + 12) % 12;
            if (pcs.indexOf(pc) >= 0 && Math.abs(d - deg) < bestD) { bestD = Math.abs(d - deg); best = d; }
          }
          deg = best;
        } else {
          deg += [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
          deg = Math.max(2, Math.min(11, deg));
        }
        notes.push({ step, len, midi: degToMidi(deg) });
      });
      phrase.push(notes);
    }
    return phrase;
  }

  class Synth {
    constructor() { this.ctx = null; this.player = null; this.vol = { music: 1, sfx: 1 }; }

    init() {
      if (this.ctx) return this.ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = ctx.createGain(); this.master.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 3.5;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8 * this.vol.sfx; this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.gain.value = this.vol.music; this.music.connect(this.master); // songs (sequenced or decoded)
      this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = 0.0; // patched to a reverb per song
      this.noiseBuf = this._noiseBuffer(2);
      this.impulse = this._impulse(2.6, 2.4);
      return ctx;
    }

    /** Music and effects volume, 0..1 each (the Settings screen). */
    setVolumes(music, sfx) {
      this.vol.music = music; this.vol.sfx = sfx;
      if (this.music) this.music.gain.value = music;
      if (this.sfx) this.sfx.gain.value = 0.8 * sfx;
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume(); return Promise.resolve(); }

    _noiseBuffer(sec) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    _impulse(sec, decay) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return b;
    }

    /** Build a fresh per-song bus graph, so stopping a song cleanly silences everything it scheduled. */
    _buildBus() {
      const ctx = this.ctx;
      const bus = {};
      bus.out = ctx.createGain(); bus.out.gain.value = 1; bus.out.connect(this.music);
      bus.duck = ctx.createGain(); bus.duck.connect(bus.out);
      bus.drums = ctx.createGain(); bus.drums.gain.value = 0.9; bus.drums.connect(bus.out);
      bus.reverb = ctx.createConvolver(); bus.reverb.buffer = this.impulse;
      bus.rev = ctx.createGain(); bus.rev.connect(bus.reverb);
      const revOut = ctx.createGain(); revOut.gain.value = 0.32; bus.reverb.connect(revOut); revOut.connect(bus.out);
      bus.delay = ctx.createDelay(1.5);
      bus.delayFb = ctx.createGain(); bus.delayFb.gain.value = 0.38;
      const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
      bus.delay.connect(dlp); dlp.connect(bus.delayFb); bus.delayFb.connect(bus.delay);
      bus.dly = ctx.createGain(); bus.dly.connect(bus.delay);
      const dOut = ctx.createGain(); dOut.gain.value = 0.28; dlp.connect(dOut); dOut.connect(bus.out);
      return bus;
    }

    // ---------- instruments (all take an absolute AudioContext time) ----------
    _env(g, t, peak, attack, decay, floor) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(floor || 0.0001, t + attack + decay);
    }
    _noise(t, dur, type, freq, peak, dest, q, sendRev) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.8;
      const g = ctx.createGain(); this._env(g, t, peak, 0.002, dur);
      src.connect(f); f.connect(g); g.connect(dest);
      if (sendRev) { const s = ctx.createGain(); s.gain.value = sendRev; g.connect(s); s.connect(sendRev.dest || this.bus.rev); }
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
      return f;
    }
    kick(t, v) {
      const ctx = this.ctx, b = this.bus;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      this._env(g, t, 0.95 * v, 0.003, 0.42);
      o.connect(g); g.connect(b.drums); o.start(t); o.stop(t + 0.5);
      this._noise(t, 0.015, 'highpass', 2500, 0.25 * v, b.drums);
      const d = b.duck.gain;
      d.cancelScheduledValues(t); d.setValueAtTime(0.32, t); d.linearRampToValueAtTime(1, t + 0.24);
    }
    clap(t, v) {
      const b = this.bus;
      for (let i = 0; i < 3; i++) this._noise(t + i * 0.011, i === 2 ? 0.22 : 0.02, 'bandpass', 1500, 0.55 * v, b.drums, 1.1);
      const s = this.ctx.createGain(); s.gain.value = 0.35;
      const f = this._noise(t, 0.3, 'bandpass', 1800, 0.25 * v, s, 1);
      s.connect(b.rev); void f;
    }
    snare(t, v) {
      const ctx = this.ctx, b = this.bus;
      this._noise(t, 0.13, 'bandpass', 2200, 0.45 * v, b.drums, 0.7);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      this._env(g, t, 0.3 * v, 0.002, 0.09); o.connect(g); g.connect(b.drums); o.start(t); o.stop(t + 0.15);
    }
    hat(t, open, v) {
      this._noise(t, open ? 0.2 : 0.045, 'highpass', open ? 7000 : 8500, (open ? 0.16 : 0.13) * v, this.bus.drums, 0.6);
    }
    crash(t) {
      this._noise(t, 1.8, 'highpass', 4200, 0.2, this.bus.drums, 0.5, 0.6);
    }
    sweep(t, dur, up) {
      const ctx = this.ctx, b = this.bus;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
      f.frequency.setValueAtTime(up ? 300 : 7000, t); f.frequency.exponentialRampToValueAtTime(up ? 9000 : 250, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(up ? 0.22 : 0.14, t + dur * (up ? 0.97 : 0.1));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      src.connect(f); f.connect(g); g.connect(b.out); g.connect(b.rev);
      src.start(t); src.stop(t + dur + 0.1);
    }
    bass(t, m, dur, cutoff, wave) {
      const ctx = this.ctx, b = this.bus;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = wave || 'sawtooth'; o2.type = 'sine';
      o1.frequency.value = mtof(m); o2.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
      f.frequency.setValueAtTime(cutoff * 3.2, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
      g.gain.setValueAtTime(0.3, t + Math.max(0.02, dur - 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
      const g2 = ctx.createGain(); g2.gain.value = 0.55;
      o1.connect(f); f.connect(g); o2.connect(g2); g2.connect(g); g.connect(b.duck);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    }
    pluck(t, m, dur, wave, bright, v) {
      const ctx = this.ctx, b = this.bus;
      const o = ctx.createOscillator(); o.type = wave || 'square'; o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(Math.max(300, bright * 0.18), t + dur);
      const g = ctx.createGain(); this._env(g, t, 0.09 * (v || 1), 0.003, dur);
      o.connect(f); f.connect(g); g.connect(b.duck); g.connect(b.dly);
      o.start(t); o.stop(t + dur + 0.05);
    }
    pad(t, notes, dur, cutoff) {
      const ctx = this.ctx, b = this.bus;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1300; f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + Math.min(0.45, dur * 0.4));
      g.gain.setValueAtTime(0.05, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
      f.connect(g); g.connect(b.duck);
      const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(b.rev);
      notes.forEach(n => {
        [-9, 9].forEach(det => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
          o.connect(f); o.start(t); o.stop(t + dur + 0.4);
        });
      });
    }
    lead(t, m, dur, wave) {
      const ctx = this.ctx, b = this.bus;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = wave || 'sawtooth'; o2.type = 'square';
      o1.frequency.value = mtof(m); o2.frequency.value = mtof(m); o2.detune.value = 7;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.3; lg.gain.value = 9;
      lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
      f.frequency.exponentialRampToValueAtTime(1600, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.075, t + 0.015);
      g.gain.setValueAtTime(0.06, t + Math.max(0.03, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      const g2 = ctx.createGain(); g2.gain.value = 0.4;
      o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(b.out); g.connect(b.dly); g.connect(b.rev);
      [o1, o2, lfo].forEach(o => { o.start(t); o.stop(t + dur + 0.2); });
    }

    // ---------- SFX (immediate) ----------
    sfxCut(quality, m) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      // swish
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
      f.frequency.setValueAtTime(7000, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.14);
      const g = ctx.createGain(); this._env(g, t, 0.32, 0.004, 0.16);
      src.connect(f); f.connect(g); g.connect(this.sfx); src.start(t, Math.random()); src.stop(t + 0.25);
      // thump
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.1);
      this._env(og, t, 0.35, 0.002, 0.14); o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.2);
      // tonal ping in the song's current chord
      [0, 12].forEach((oct, i) => {
        const p = ctx.createOscillator(), pg = ctx.createGain(); p.type = i ? 'sine' : 'triangle';
        p.frequency.value = mtof(m + oct);
        this._env(pg, t, (0.06 + 0.1 * quality) / (i + 1), 0.002, 0.35 + 0.3 * quality);
        p.connect(pg); pg.connect(this.sfx); p.start(t); p.stop(t + 0.8);
      });
    }
    sfxBad() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      this._env(g, t, 0.2, 0.003, 0.22); o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.3);
      this._noise(t, 0.12, 'lowpass', 1200, 0.25, this.sfx);
    }
    sfxMiss() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
      this._env(g, t, 0.16, 0.004, 0.2); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.3);
    }
    /** Non-tonal slice: a bright metallic ring that sits on top of any track, any key. */
    sfxSlice(quality, heavy) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(9000, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.13);
      const g = ctx.createGain(); this._env(g, t, 0.3, 0.003, 0.15);
      src.connect(f); f.connect(g); g.connect(this.sfx); src.start(t, Math.random()); src.stop(t + 0.22);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(heavy ? 150 : 210, t); o.frequency.exponentialRampToValueAtTime(heavy ? 38 : 60, t + (heavy ? 0.25 : 0.1));
      this._env(og, t, heavy ? 0.6 : 0.32, 0.002, heavy ? 0.32 : 0.14); o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.4);
      [3150, 4730, 6890].forEach((fr, i) => {
        const p = ctx.createOscillator(), pg = ctx.createGain(); p.type = 'sine';
        p.frequency.value = fr * (heavy ? 0.5 : 1) * (1 + (Math.random() - 0.5) * 0.02);
        this._env(pg, t, (0.025 + 0.035 * quality) / (i + 1), 0.001, 0.18 + 0.25 * quality);
        p.connect(pg); pg.connect(this.sfx); p.start(t); p.stop(t + 0.6);
      });
      if (heavy) this._noise(t, 0.5, 'lowpass', 2400, 0.35, this.sfx);
    }
    sfxClang() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      [523, 1187, 1720].forEach((fr, i) => {
        const p = ctx.createOscillator(), pg = ctx.createGain(); p.type = i ? 'sine' : 'triangle'; p.frequency.value = fr;
        this._env(pg, t, 0.12 / (i + 1), 0.002, 0.35); p.connect(pg); pg.connect(this.sfx); p.start(t); p.stop(t + 0.5);
      });
      this._noise(t, 0.06, 'highpass', 3000, 0.2, this.sfx);
    }
    sfxBoom() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
      this._env(g, t, 0.7, 0.003, 0.5); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.6);
      this._noise(t, 0.6, 'lowpass', 1600, 0.6, this.sfx, 0.7);
      this._noise(t, 0.15, 'bandpass', 3000, 0.3, this.sfx);
    }
    sfxChime(up) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      (up ? [2093, 2637, 3136] : [1568]).forEach((fr, i) => {
        const p = ctx.createOscillator(), pg = ctx.createGain(); p.type = 'sine'; p.frequency.value = fr;
        this._env(pg, t + i * 0.05, 0.06, 0.002, 0.3); p.connect(pg); pg.connect(this.sfx); p.start(t + i * 0.05); p.stop(t + i * 0.05 + 0.4);
      });
    }
    sfxTick(level) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const p = ctx.createOscillator(), pg = ctx.createGain(); p.type = 'sine'; p.frequency.value = 1800 + level * 900;
      this._env(pg, t, 0.025, 0.002, 0.05); p.connect(pg); pg.connect(this.sfx); p.start(t); p.stop(t + 0.1);
    }
    sfxSurge() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(8000, t + 0.5);
      const g = ctx.createGain(); this._env(g, t, 0.3, 0.3, 0.3);
      src.connect(f); f.connect(g); g.connect(this.sfx); src.start(t); src.stop(t + 0.7);
      this.sfxChime(true);
    }
    /** Wall scrape while the blade is inside glass. */
    sfxScrape() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._noise(t, 0.12, 'bandpass', 600 + Math.random() * 400, 0.18, this.sfx, 4);
    }
    sfxUi(kind) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const notes = kind === 'go' ? [74, 81] : kind === 'back' ? [69, 62] : [86];
      notes.forEach((n, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = mtof(n);
        this._env(g, t + i * 0.07, 0.07, 0.003, 0.12); o.connect(g); g.connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.2);
      });
    }
  }

  /** Plays a prepared song. Step k sounds at exactly startTime + k * stepDur. */
  class Player {
    constructor(synth, song, startTime) {
      this.synth = synth; this.song = prepareSong(song); this.start = startTime;
      this.next = 0; this.total = this.song.totalBars * 16;
      synth.bus = synth._buildBus();
      this.bus = synth.bus;
      this.timer = setInterval(() => this.tick(), 20);
      this.tick();
    }
    tick() {
      const ctx = this.synth.ctx;
      if (ctx.state !== 'running') return;
      const horizon = ctx.currentTime + 0.14;
      while (this.next < this.total) {
        const t = this.start + this.next * this.song.stepDur;
        if (t > horizon) break;
        if (t >= ctx.currentTime - 0.01) this.playStep(this.next, t);
        this.next++;
      }
    }
    playStep(step, t) {
      const S = this.synth, song = this.song, sd = song.stepDur;
      const bar = step >> 4, s = step & 15;
      const sec = song.barSections[bar];
      const L = sec.layerSet;
      const ch = chordForBar(song, bar);
      const inSec = bar - sec.start;
      const hot = sec.intensity >= 2;
      if (s === 0 && inSec === 0 && L.x) S.crash(t);
      if (L.k && song.kick.indexOf(s) >= 0) S.kick(t, 1);
      if (L.k && hot && song.kickHot && song.kickHot.indexOf(s) >= 0) S.kick(t, 0.75);
      if (L.c && song.clap.indexOf(s) >= 0) S.clap(t, 1);
      if (L.h && s % 4 === 2) S.hat(t, song.openHats, 1);
      if (L.H && s % 2 === 1) S.hat(t, false, s % 4 === 3 ? 0.8 : 0.55);
      if (L.r) {
        const prog = (inSec * 16 + s) / (sec.bars * 16);
        const div = prog < 0.5 ? 4 : prog < 0.8 ? 2 : 1;
        if (s % div === 0) S.snare(t, 0.25 + 0.75 * prog);
        if (inSec === 0 && s === 0) S.sweep(t, sec.bars * 16 * sd, true);
      }
      if (L.d && inSec === 0 && s === 0) S.sweep(t, 4 * 16 * sd * 0.5, false);
      if (L.b) {
        const bi = song.bassSteps.indexOf(s);
        if (bi >= 0) {
          const off = song.bassNotes ? song.bassNotes[bi] : 0;
          const len = song.bassLen || 2;
          S.bass(t, ch[0] - 12 + off, sd * len * 0.92, hot ? song.bassCut * 1.4 : song.bassCut, song.bassWave);
        }
      }
      if (L.a && s % song.arpRate === 0) {
        const i = s / song.arpRate;
        const tones = ch.concat(ch.map(n => n + 12));
        const pat = song.arpPattern;
        const n = tones[pat[i % pat.length] % tones.length] + song.arpOct;
        S.pluck(t, n, sd * song.arpRate * 1.6, song.arpWave, hot ? 4200 : 2600, hot ? 1.1 : 0.85);
      }
      if (L.p && s === 0) S.pad(t, ch.map(n => n + 12), 16 * sd, sec.intensity >= 2 ? 2000 : 1200);
      if (L.l) {
        const phrase = song.melody[inSec % 4];
        for (let i = 0; i < phrase.length; i++) {
          if (phrase[i].step === s) S.lead(t, phrase[i].midi + (song.leadOct || 0), phrase[i].len * sd * 0.95, song.leadWave);
        }
      }
    }
    stop(fade) {
      clearInterval(this.timer);
      const ctx = this.synth.ctx, out = this.bus.out;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + (fade || 0.08));
      setTimeout(() => { try { out.disconnect(); } catch (e) { /* already gone */ } }, (fade || 0.08) * 1000 + 300);
    }
  }

  /** Decoded track cache: url -> Promise<AudioBuffer>. */
  const bufCache = {};
  function loadTrack(synth, url) {
    synth.init();
    if (!bufCache[url]) {
      bufCache[url] = fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.arrayBuffer(); })
        .then(ab => new Promise((res, rej) => synth.ctx.decodeAudioData(ab, res, rej)));
      bufCache[url].catch(() => { delete bufCache[url]; });
    }
    return bufCache[url];
  }

  /** Plays a decoded track so that song time 0 (its first downbeat, song.offset into the file) is at startTime. */
  class FilePlayer {
    constructor(synth, song, buffer, startTime) {
      const ctx = synth.ctx;
      this.synth = synth; this.song = song;
      this.out = ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(synth.music);
      const src = this.src = ctx.createBufferSource(); src.buffer = buffer; src.connect(this.out);
      const at = startTime - song.offset;
      if (at >= ctx.currentTime) src.start(at);
      else src.start(ctx.currentTime, ctx.currentTime - at);
    }
    stop(fade) {
      const ctx = this.synth.ctx, g = this.out.gain, t = ctx.currentTime, f = fade || 0.08;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + f);
      setTimeout(() => { try { this.src.stop(); this.out.disconnect(); } catch (e) { /* gone */ } }, f * 1000 + 300);
    }
  }

  global.CadenceAudio = { Synth, Player, FilePlayer, loadTrack, prepareSong, chordForBar, chord, midi, mtof, rng, hash };
})(window);
