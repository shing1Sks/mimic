/*
 * Tidecast - all sound is synthesised here (WebAudio): the sea, gulls, a slow pentatonic
 * guitar-and-pad bed, and every line, reel and water effect.
 */
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;

  class Synth {
    constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.6, sfx: 1 }; this.noiseBuf = null; this.nextNote = 0; this.step = 0; this.gullT = 6; }

    start() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      if (!AC) return;
      const c = this.ctx = new AC();
      this.out = c.createDynamicsCompressor();
      this.out.threshold.value = -16; this.out.ratio.value = 3;
      this.master = c.createGain(); this.master.connect(this.out); this.out.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
      this.ambBus = c.createGain(); this.ambBus.connect(this.master);
      // a little room for the plucks
      this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.2); const vg = c.createGain(); vg.gain.value = 0.32;
      this.verb.connect(vg); vg.connect(this.master);
      const n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
      this.buildSea();
      this.buildStrain();
      this.applyVolumes();
      this.nextNote = c.currentTime + 0.3;
    }
    impulse(sec) {
      const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
      return b;
    }
    setVolumes(master, music, sfx) { this.vol = { master, music, sfx }; this.applyVolumes(); }
    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
      this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
      this.ambBus.gain.setTargetAtTime(this.vol.sfx * 0.55, t, 0.05);
    }
    suspend() { if (this.ctx) this.ctx.suspend(); }
    resume() { if (this.ctx) this.ctx.resume(); }

    noise(dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(this.ctx.currentTime, Math.random() * 1.5); if (dur) s.stop(this.ctx.currentTime + dur); return s; }
    env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

    // ------------------------------------------------------------ ambience
    buildSea() {
      const c = this.ctx;
      // two swells of filtered noise, slow and out of step: waves lapping the dock posts
      for (const [f, rate, depth, lvl] of [[420, 0.11, 0.6, 0.35], [900, 0.17, 0.5, 0.18]]) {
        const src = this.noise(), lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
        lp.type = 'lowpass'; lp.frequency.value = f; lp.Q.value = 0.4;
        g.gain.value = lvl; lfo.frequency.value = rate; lg.gain.value = lvl * depth;
        lfo.connect(lg); lg.connect(g.gain); lfo.start();
        src.connect(lp); lp.connect(g); g.connect(this.ambBus);
      }
      // wind hiss
      const w = this.noise(), hp = c.createBiquadFilter(), wg = c.createGain();
      hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.3; wg.gain.value = 0.025;
      w.connect(hp); hp.connect(wg); wg.connect(this.ambBus);
    }
    gull() {
      const c = this.ctx, t = c.currentTime, pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.ambBus); }
      const calls = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < calls; i++) {
        const o = c.createOscillator(), g = c.createGain(), t0 = t + i * (0.22 + Math.random() * 0.08);
        o.type = 'sawtooth';
        const f = 1500 + Math.random() * 400;
        o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.05); o.frequency.exponentialRampToValueAtTime(f * 0.62, t0 + 0.18);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 2.5;
        this.env(g, t0, 0.02, 0.05, 0.17);
        o.connect(bp); bp.connect(g); g.connect(pan || this.ambBus);
        o.start(t0); o.stop(t0 + 0.25);
      }
    }

    // ------------------------------------------------------------ music: slow plucked guitar + pad
    pluck(freq, t, vel, dest) {
      const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = freq; o2.frequency.value = freq * 2.001;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(freq * 6, t); lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 1.2);
      const g2 = c.createGain(); g2.gain.value = 0.25;
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
      this.env(g, t, 0.004, vel, 1.8);
      g.connect(dest || this.musicBus); g.connect(this.verb);
      o.start(t); o2.start(t); o.stop(t + 2); o2.stop(t + 2);
    }
    pad(freqs, t, dur) {
      const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const f of freqs) for (const det of [-4, 4]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
      }
      lp.connect(g); g.connect(this.musicBus); g.connect(this.verb);
    }
    /** Call every frame: schedules the bed a little ahead, and the odd gull. */
    tick(dt, mood) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const c = this.ctx;
      this.gullT -= dt;
      if (this.gullT <= 0) { this.gullT = 9 + Math.random() * 16; this.gull(); }
      // D major pentatonic over I - vi - IV - V, eight steps a bar at 72 bpm
      const CH = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
      const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81];
      const stepDur = 60 / 72 / 2;
      const mf = m => 440 * Math.pow(2, (m - 69) / 12);
      while (this.nextNote < c.currentTime + 0.25) {
        const t = this.nextNote, s = this.step, bar = (s >> 3) % 4, ch = CH[bar], inBar = s & 7;
        if (inBar === 0) { this.pad(ch.map(m => mf(m - 12)), t, stepDur * 8.4); this.pluck(mf(ch[0] - 24), t, 0.09); }
        const pat = [0, -1, 1, 2, -1, 1, 2, 1];
        if (pat[inBar] >= 0 && Math.random() < 0.85) this.pluck(mf(ch[pat[inBar]]), t + (Math.random() - 0.5) * 0.012, 0.045 + Math.random() * 0.02);
        if (mood > 0.5 && (inBar === 3 || inBar === 6) && Math.random() < 0.5) this.pluck(mf(SCALE[(Math.random() * SCALE.length) | 0] + 12), t + stepDur * 0.5, 0.035);
        this.nextNote += stepDur; this.step++;
      }
    }

    // ------------------------------------------------------------ the line and the water
    /** Rod groan + line hum that follow the tension of the tightest line (0..1). */
    buildStrain() {
      const c = this.ctx;
      this.hum = c.createOscillator(); this.hum.type = 'sawtooth'; this.hum.frequency.value = 180;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 8;
      this.humG = c.createGain(); this.humG.gain.value = 0;
      this.hum.connect(bp); bp.connect(this.humG); this.humG.connect(this.sfxBus); this.hum.start();
      this.humBp = bp;
    }
    strain(T) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, v = T > 0.45 ? Math.pow((T - 0.45) / 0.6, 1.6) * 0.06 : 0;
      this.humG.gain.setTargetAtTime(v, t, 0.06);
      this.hum.frequency.setTargetAtTime(150 + T * 260, t, 0.08);
      this.humBp.frequency.setTargetAtTime(700 + T * 1400, t, 0.08);
    }
    whoosh(power) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, s = this.noise(0.5), bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.12); bp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
      this.env(g, t, 0.03, 0.12 + power * 0.25, 0.32);
      s.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    }
    /** One tick of line peeling off the spool (call at the spool's rate). */
    spool(level) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, s = this.noise(0.03), hp = c.createBiquadFilter(), g = c.createGain();
      hp.type = 'highpass'; hp.frequency.value = 3500;
      this.env(g, t, 0.001, 0.05 * level, 0.02);
      s.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    }
    click(level) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 2200 + Math.random() * 300;
      this.env(g, t, 0.001, 0.025 * (level || 1), 0.018);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.03);
    }
    drag(level) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 1300 + Math.random() * 200;
      bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 3;
      this.env(g, t, 0.002, 0.05 * level, 0.04);
      o.connect(bp); bp.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.06);
    }
    splash(size, far) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, s = this.noise(0.9), lp = c.createBiquadFilter(), g = c.createGain();
      const k = far ? 0.55 : 1;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500 + size * 2500, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.4 + size * 0.4);
      this.env(g, t, 0.006, (0.12 + size * 0.35) * k, 0.35 + size * 0.5);
      s.connect(lp); lp.connect(g); g.connect(this.sfxBus);
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(260 - size * 120, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      this.env(og, t, 0.004, (0.12 + size * 0.2) * k, 0.2);
      o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.3);
    }
    plip(level) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.05);
      this.env(g, t, 0.003, 0.09 * (level || 1), 0.07);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.1);
    }
    strike() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
      this.env(g, t, 0.004, 0.45, 0.3);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.4);
      this.splash(0.5);
    }
    hookSet() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      [0, 0.07].forEach((d, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.value = i ? 880 : 660;
        this.env(g, t + d, 0.004, 0.14, 0.18);
        o.connect(g); g.connect(this.sfxBus); o.start(t + d); o.stop(t + d + 0.25);
      });
    }
    snap() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, s = this.noise(0.08), hp = c.createBiquadFilter(), g = c.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      this.env(g, t, 0.001, 0.6, 0.06);
      s.connect(hp); hp.connect(g); g.connect(this.sfxBus);
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.5);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
      this.env(og, t, 0.002, 0.18, 0.5);
      o.connect(lp); lp.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 0.6);
    }
    slip() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.4);
      this.env(g, t, 0.01, 0.16, 0.4);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.5);
    }
    /** Landed: a rising pluck arpeggio, bigger for bigger fish. */
    fanfare(stars) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, mf = m => 440 * Math.pow(2, (m - 69) / 12);
      const notes = [62, 66, 69, 74, 78, 81].slice(0, 3 + stars);
      notes.forEach((m, i) => this.pluck(mf(m), t + i * 0.09, 0.16, this.sfxBus));
      this.pluck(mf(notes[notes.length - 1] + 12), t + notes.length * 0.09 + 0.05, 0.12, this.sfxBus);
    }
    ui(kind) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      const f = { move: 1200, ok: 880, go: 660, back: 440 }[kind] || 800;
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
      if (kind === 'go') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.12);
      if (kind === 'back') o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.1);
      this.env(g, t, 0.003, kind === 'move' ? 0.03 : 0.08, 0.12);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.18);
    }
    beep(high) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = high ? 1320 : 880;
      this.env(g, t, 0.004, 0.14, high ? 0.5 : 0.18);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.6);
    }
    /** A distant foghorn: the round is over. */
    horn() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, lp = c.createBiquadFilter(), g = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 380;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.25); g.gain.setValueAtTime(0.32, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      for (const f of [87, 87.8, 130.6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 2.5); }
      lp.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    }
    /** Something golden stirs. */
    legend() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, mf = m => 440 * Math.pow(2, (m - 69) / 12);
      [57, 64, 69, 73, 76].forEach((m, i) => this.pluck(mf(m), t + i * 0.18, 0.1, this.sfxBus));
      this.pad([mf(45), mf(52), mf(57)], t, 3.5);
    }
  }

  window.TideAudio = { Synth };
})();
