/*
 * Sunvolley — all sound is synthesised with WebAudio. No files.
 */
(function () {
  'use strict';
  const TN = window.TN = window.TN || {};

  const A = {
    ctx: null, master: null, sfx: null, crowdBus: null, muted: false, vol: 1, noiseBuf: null,
    murmur: null, voiceOn: true,
  };

  function init() {
    if (A.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    A.master = ctx.createGain(); A.master.gain.value = A.muted ? 0 : 0.9 * A.vol;
    // gentle limiter so stacked effects never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    A.master.connect(comp); comp.connect(ctx.destination);
    A.sfx = ctx.createGain(); A.sfx.connect(A.master);
    A.crowdBus = ctx.createGain(); A.crowdBus.gain.value = 0.8; A.crowdBus.connect(A.master);
    // 2 s of white noise, reused everywhere
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noiseBuf = buf;
    startMurmur();
  }

  function resume() {
    init();
    if (A.ctx && A.ctx.state !== 'running') A.ctx.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, resume, { capture: true }));

  function ok() { return A.ctx && A.ctx.state === 'running' && !A.muted; }

  function noise(t, dur, opts) {
    const ctx = A.ctx;
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    const off = Math.random() * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 1000, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    const peak = opts.gain || 0.5;
    const atk = opts.attack || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(opts.bus || A.sfx);
    src.start(t, off); src.stop(t + dur + 0.05);
    return g;
  }

  function tone(t, dur, opts) {
    const ctx = A.ctx;
    const o = ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain || 0.3, t + (opts.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(opts.bus || A.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------------------------
  const SFX = {
    /** Racket on ball. power 0..1, sweet 0..1 (timing quality) */
    hit(power, sweet, far) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      const v = (0.35 + 0.65 * power) * (far ? 0.45 : 1);
      // the string "pock"
      tone(t, 0.09, { freq: 520 + 260 * power, freqEnd: 210, gain: 0.55 * v, type: 'triangle' });
      tone(t, 0.05, { freq: 1600 + 400 * sweet, freqEnd: 900, gain: 0.18 * v * sweet });
      // felt + air crack
      noise(t, 0.07 + 0.05 * power, { freq: 2400, q: 0.8, gain: 0.7 * v });
      noise(t, 0.12, { freq: 260, q: 1.2, gain: 0.5 * v, type: 'lowpass' });
      if (power > 0.7 && !far) noise(t + 0.004, 0.25, { freq: 5000, freqEnd: 1200, q: 0.6, gain: 0.25 * power });
      if (sweet < 0.35) tone(t, 0.18, { freq: 190, freqEnd: 120, gain: 0.25 * v, type: 'square' }); // frame clank
    },
    bounce(speed, far) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      const v = Math.min(1, speed / 22) * (far ? 0.5 : 1);
      if (v < 0.03) return;
      tone(t, 0.08, { freq: 170, freqEnd: 80, gain: 0.45 * v });
      noise(t, 0.05, { freq: 1300, q: 1.4, gain: 0.35 * v });
    },
    net() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      noise(t, 0.22, { freq: 400, q: 0.7, gain: 0.5, type: 'lowpass' });
      tone(t, 0.15, { freq: 110, freqEnd: 70, gain: 0.3 });
    },
    whoosh(speed) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      const v = Math.min(1, speed / 25);
      noise(t, 0.22 + 0.1 * v, { freq: 500, freqEnd: 2600 + 1500 * v, q: 2.5, gain: 0.12 + 0.2 * v, attack: 0.06 });
    },
    toss() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      noise(t, 0.12, { freq: 900, freqEnd: 1800, q: 3, gain: 0.08, attack: 0.03 });
    },
    ui(kind) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      if (kind === 'move') tone(t, 0.06, { freq: 880, gain: 0.08, type: 'triangle' });
      else if (kind === 'back') tone(t, 0.1, { freq: 520, freqEnd: 330, gain: 0.1, type: 'triangle' });
      else { tone(t, 0.08, { freq: 660, gain: 0.1, type: 'triangle' }); tone(t + 0.07, 0.14, { freq: 990, gain: 0.1, type: 'triangle' }); }
    },
    chime() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      [784, 988, 1319].forEach((f, i) => tone(t + i * 0.07, 0.35, { freq: f, gain: 0.12, type: 'triangle' }));
    },
    /** Short original fanfare for winning a game / the match. */
    fanfare(big) {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      const seq = big ? [523, 659, 784, 1047, 784, 1047, 1319] : [587, 740, 880, 1175];
      seq.forEach((f, i) => {
        tone(t + i * 0.11, big && i === seq.length - 1 ? 0.9 : 0.24, { freq: f, gain: 0.13, type: 'square', bus: A.sfx });
        tone(t + i * 0.11, 0.3, { freq: f / 2, gain: 0.08, type: 'triangle' });
      });
    },
    sad() {
      if (!ok()) return;
      const t = A.ctx.currentTime;
      [392, 370, 349, 262].forEach((f, i) => tone(t + i * 0.16, 0.3, { freq: f, gain: 0.1, type: 'triangle' }));
    },
  };

  // Crowd -------------------------------------------------------------------------
  function startMurmur() {
    const ctx = A.ctx;
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 450; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 900; f2.gain.value = 6; f2.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0.018;
    // slow random swell
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.007;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(f); f.connect(f2); f2.connect(g); g.connect(A.crowdBus);
    src.start();
    A.murmur = g;
  }

  /** Applause made of many tiny noise claps. intensity 0..1 */
  function applause(intensity, dur) {
    if (!ok()) return;
    const ctx = A.ctx, t0 = ctx.currentTime;
    dur = dur || 2.4;
    const n = Math.floor(120 + 380 * intensity);
    for (let i = 0; i < n; i++) {
      // density front-loaded, decaying tail
      const r = Math.random();
      const t = t0 + dur * r * r * 0.9 + Math.random() * 0.05;
      noise(t, 0.025 + Math.random() * 0.03, {
        freq: 900 + Math.random() * 2600, q: 1.5 + Math.random() * 2,
        gain: (0.04 + Math.random() * 0.06) * (0.5 + intensity) * (1 - r * 0.6), bus: A.crowdBus,
      });
    }
  }

  /** A cheer: swelling filtered noise plus a formant "ahh/ooh" choir. */
  function cheer(intensity, vowel) {
    if (!ok()) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const dur = 1.6 + intensity * 1.4;
    noise(t, dur, { freq: 700, q: 0.5, gain: 0.12 + 0.25 * intensity, attack: 0.25, bus: A.crowdBus });
    // formant voices
    const formants = vowel === 'ooh' ? [320, 800] : [750, 1200];
    const voices = 10;
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = 140 + Math.random() * 160;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * (vowel === 'ooh' ? 0.85 : 1.12), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((0.012 + 0.02 * intensity), t + 0.2 + Math.random() * 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      formants.forEach(fq => {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq * (0.9 + Math.random() * 0.2); bp.Q.value = 6;
        o.connect(bp); bp.connect(g);
      });
      g.connect(A.crowdBus);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  const Crowd = {
    react(kind, intensity) {
      if (kind === 'ooh') { cheer(0.4, 'ooh'); return; }
      if (kind === 'groan') { cheer(0.25, 'ooh'); applause(0.15, 1.2); return; }
      if (kind === 'polite') { applause(0.3 * (intensity || 1), 1.8); return; }
      cheer(intensity, 'ahh');
      applause(intensity, 1.8 + intensity * 1.8);
    },
  };

  // Umpire voice via the OS speech engine (offline voices on Windows). Optional nicety.
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /en-GB/i.test(v.lang) && v.localService) || vs.find(v => /^en/i.test(v.lang) && v.localService) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function say(text) {
    if (A.muted || !A.voiceOn || !('speechSynthesis' in window) || !voice) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.rate = 1.0; u.pitch = 0.95; u.volume = 0.85 * A.vol;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  function setMuted(m) {
    A.muted = m;
    if (A.master) A.master.gain.value = m ? 0 : 0.9 * A.vol;
    if (m && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  /** Master volume 0..1 (the options' VOLUME row); mute stays separate. */
  function setVolume(v) { A.vol = Math.max(0, Math.min(1, v)); if (A.master && !A.muted) A.master.gain.value = 0.9 * A.vol; }

  TN.Audio = { init, resume, SFX, Crowd, say, setMuted, setVolume, get muted() { return A.muted; }, state: A };
})();
