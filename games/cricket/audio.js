/*
 * Willowlight - all sound is synthesised with WebAudio (structure as Sunvolley's). No files.
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const A = { ctx: null, master: null, sfx: null, crowdBus: null, muted: false, vol: 1, noiseBuf: null, murmur: null };

  function init() {
    if (A.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    A.master = ctx.createGain(); A.master.gain.value = A.muted ? 0 : 0.9 * A.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    A.master.connect(comp); comp.connect(ctx.destination);
    A.sfx = ctx.createGain(); A.sfx.connect(A.master);
    A.crowdBus = ctx.createGain(); A.crowdBus.gain.value = 0.8; A.crowdBus.connect(A.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noiseBuf = buf;
    startMurmur();
  }
  function resume() { init(); if (A.ctx && A.ctx.state !== 'running') A.ctx.resume(); }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, resume, { capture: true }));
  const ok = () => A.ctx && A.ctx.state === 'running' && !A.muted;

  function noise(t, dur, o) {
    const ctx = A.ctx, src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.5, t + (o.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || A.sfx);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(t, dur, o) {
    const ctx = A.ctx, osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || A.sfx);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  const SFX = {
    /** Willow on leather. power 0..1, sweet: off the middle; edge: a thin click. */
    bat(power, sweet, edge) {
      if (!ok()) return;
      const t = A.ctx.currentTime, v = 0.4 + 0.6 * power;
      if (edge) {
        tone(t, 0.05, { freq: 1900, freqEnd: 1300, gain: 0.25 * v, type: 'triangle' });
        noise(t, 0.05, { freq: 3800, q: 2, gain: 0.35 * v });
        return;
      }
      tone(t, 0.12, { freq: 380 + 120 * power, freqEnd: 170, gain: 0.6 * v, type: 'triangle' });
      tone(t, 0.07, { freq: 900, freqEnd: 600, gain: 0.25 * v * (sweet ? 1 : 0.4) });
      noise(t, 0.06 + 0.04 * power, { freq: 1700, q: 0.9, gain: 0.75 * v });
      noise(t, 0.14, { freq: 220, q: 1.1, gain: 0.45 * v, type: 'lowpass' });
      if (sweet && power > 0.6) noise(t + 0.003, 0.22, { freq: 4200, freqEnd: 1100, q: 0.6, gain: 0.2 * power });
    },
    /** Ball on the pitch or the pad. */
    thud(speed, soft) {
      if (!ok()) return;
      const t = A.ctx.currentTime, v = Math.min(1, speed / 30);
      if (v < 0.04) return;
      tone(t, 0.07, { freq: soft ? 120 : 150, freqEnd: 70, gain: 0.5 * v });
      noise(t, 0.05, { freq: soft ? 500 : 1100, q: 1.2, gain: 0.3 * v });
    },
    stumps() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      tone(t, 0.25, { freq: 260, freqEnd: 140, gain: 0.5, type: 'triangle' });
      tone(t + 0.02, 0.18, { freq: 620, freqEnd: 420, gain: 0.25, type: 'triangle' });
      noise(t, 0.3, { freq: 1500, q: 0.8, gain: 0.6 });
      [0.09, 0.16, 0.27].forEach((d, i) => tone(t + d, 0.06, { freq: 1400 - i * 200, gain: 0.12, type: 'triangle' }));   // the bails
    },
    whoosh(speed) {
      if (!ok()) return;
      const t = A.ctx.currentTime, v = Math.min(1, speed / 20);
      noise(t, 0.2 + 0.1 * v, { freq: 450, freqEnd: 2400 + 1400 * v, q: 2.4, gain: 0.1 + 0.18 * v, attack: 0.05 });
    },
    release(speed) {
      if (!ok()) return;
      const t = A.ctx.currentTime, v = Math.min(1, speed / 40);
      noise(t, 0.16, { freq: 700, freqEnd: 2000 + 1500 * v, q: 2.2, gain: 0.06 + 0.1 * v, attack: 0.03 });
    },
    glove() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      tone(t, 0.06, { freq: 200, freqEnd: 110, gain: 0.35 });
      noise(t, 0.05, { freq: 700, q: 1, gain: 0.3 });
    },
    ui(kind) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      if (kind === 'move') tone(t, 0.06, { freq: 880, gain: 0.08, type: 'triangle' });
      else if (kind === 'back') tone(t, 0.1, { freq: 520, freqEnd: 330, gain: 0.1, type: 'triangle' });
      else { tone(t, 0.08, { freq: 660, gain: 0.1, type: 'triangle' }); tone(t + 0.07, 0.14, { freq: 990, gain: 0.1, type: 'triangle' }); }
    },
    fanfare(big) {
      if (!ok()) return;
      const t = A.ctx.currentTime, seq = big ? [523, 659, 784, 1047, 784, 1047, 1319] : [587, 740, 880, 1175];
      seq.forEach((f, i) => {
        tone(t + i * 0.11, big && i === seq.length - 1 ? 0.9 : 0.24, { freq: f, gain: 0.12, type: 'square' });
        tone(t + i * 0.11, 0.3, { freq: f / 2, gain: 0.08, type: 'triangle' });
      });
    },
    sting() {   // the broadcast replay sting
      if (!ok()) return;
      const t = A.ctx.currentTime;
      noise(t, 0.35, { freq: 300, freqEnd: 4000, q: 1.5, gain: 0.12, attack: 0.2 });
      tone(t + 0.25, 0.3, { freq: 880, gain: 0.07, type: 'triangle' });
    },
  };

  function startMurmur() {
    const ctx = A.ctx, src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 900; f2.gain.value = 6; f2.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.008;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(f); f.connect(f2); f2.connect(g); g.connect(A.crowdBus);
    src.start();
    A.murmur = g;
  }
  function applause(intensity, dur) {
    if (!ok()) return;
    const t0 = A.ctx.currentTime, n = Math.floor(120 + 380 * intensity);
    dur = dur || 2.4;
    for (let i = 0; i < n; i++) {
      const r = Math.random(), t = t0 + dur * r * r * 0.9 + Math.random() * 0.05;
      noise(t, 0.025 + Math.random() * 0.03, { freq: 900 + Math.random() * 2600, q: 1.5 + Math.random() * 2,
        gain: (0.04 + Math.random() * 0.06) * (0.5 + intensity) * (1 - r * 0.6), bus: A.crowdBus });
    }
  }
  function cheer(intensity, vowel) {
    if (!ok()) return;
    const ctx = A.ctx, t = ctx.currentTime, dur = 1.6 + intensity * 1.6;
    noise(t, dur, { freq: 700, q: 0.5, gain: 0.12 + 0.25 * intensity, attack: 0.25, bus: A.crowdBus });
    const formants = vowel === 'ooh' ? [320, 800] : [750, 1200];
    for (let i = 0; i < 10; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = 140 + Math.random() * 160;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * (vowel === 'ooh' ? 0.85 : 1.12), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012 + 0.02 * intensity, t + 0.2 + Math.random() * 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      formants.forEach(fq => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq * (0.9 + Math.random() * 0.2); bp.Q.value = 6; o.connect(bp); bp.connect(g); });
      g.connect(A.crowdBus);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  const Crowd = {
    react(kind, intensity) {
      if (kind === 'ooh') { cheer(0.45, 'ooh'); return; }
      if (kind === 'polite') { applause(0.3 * (intensity || 1), 1.6); return; }
      cheer(intensity, 'ahh');
      applause(intensity, 1.8 + intensity * 2);
    },
  };

  function setMuted(m) { A.muted = m; if (A.master) A.master.gain.value = m ? 0 : 0.9 * A.vol; }
  function setVolume(v) { A.vol = Math.max(0, Math.min(1, v)); if (A.master && !A.muted) A.master.gain.value = 0.9 * A.vol; }

  CK.Audio = { init, resume, SFX, Crowd, setMuted, setVolume, get muted() { return A.muted; }, state: A };
})();
