/*
 * GYROWING audio: WebAudio. A recorded propeller loop (CC-BY, see CREDITS.md) pitched by RPM is layered
 * over the synthesised engine, and a recorded wind loop (CC-BY) rises with airspeed; everything else is
 * synthesised. If the recordings fail to load, the synth alone carries on.
 * Continuous: engine (firing pulses + prop beat, pitch from RPM), wind (rises with airspeed),
 * tyre rumble while rolling, stall horn, gear warning. One-shots: gear/flap clunks, touchdown
 * chirp, scrape, crash, UI blips.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  let ctx = null, master = null, noiseBuf = null, ready = false;
  const N = {};
  let volume = 0.8, muted = false;

  function noiseSource() {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.start(0, Math.random() * 2); return s;
  }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.0; }

    // ---- engine: two detuned pulse trains -> lowpass, amplitude-modulated by the blade pass
    N.engBus = ctx.createGain(); N.engBus.gain.value = 0;
    N.engLP = ctx.createBiquadFilter(); N.engLP.type = 'lowpass'; N.engLP.frequency.value = 600; N.engLP.Q.value = 0.8;
    N.o1 = ctx.createOscillator(); N.o1.type = 'sawtooth';
    N.o2 = ctx.createOscillator(); N.o2.type = 'square';
    N.o3 = ctx.createOscillator(); N.o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.32; const g2 = ctx.createGain(); g2.gain.value = 0.16; const g3 = ctx.createGain(); g3.gain.value = 0.12;
    N.o1.connect(g1); N.o2.connect(g2); N.o3.connect(g3); g1.connect(N.engLP); g2.connect(N.engLP); g3.connect(N.engLP);
    // exhaust roar
    N.exh = noiseSource(); N.exhBP = ctx.createBiquadFilter(); N.exhBP.type = 'bandpass'; N.exhBP.frequency.value = 180; N.exhBP.Q.value = 0.9;
    N.exhG = ctx.createGain(); N.exhG.gain.value = 0.0; N.exh.connect(N.exhBP); N.exhBP.connect(N.exhG); N.exhG.connect(N.engLP);
    // prop "whup" modulation
    N.am = ctx.createGain(); N.am.gain.value = 0.75;
    N.lfo = ctx.createOscillator(); N.lfo.type = 'sine'; N.lfoG = ctx.createGain(); N.lfoG.gain.value = 0.25;
    N.lfo.connect(N.lfoG); N.lfoG.connect(N.am.gain);
    N.engLP.connect(N.am); N.am.connect(N.engBus);
    N.cabin = ctx.createBiquadFilter(); N.cabin.type = 'lowpass'; N.cabin.frequency.value = 20000;
    N.engBus.connect(N.cabin); N.cabin.connect(master);
    [N.o1, N.o2, N.o3, N.lfo].forEach(o => { o.frequency.value = 40; o.start(); });

    // ---- wind
    N.wind = noiseSource(); N.windBP = ctx.createBiquadFilter(); N.windBP.type = 'bandpass'; N.windBP.frequency.value = 500; N.windBP.Q.value = 0.5;
    N.windG = ctx.createGain(); N.windG.gain.value = 0; N.wind.connect(N.windBP); N.windBP.connect(N.windG); N.windG.connect(master);
    // ---- tyre rumble
    N.rum = noiseSource(); N.rumLP = ctx.createBiquadFilter(); N.rumLP.type = 'lowpass'; N.rumLP.frequency.value = 140;
    N.rumG = ctx.createGain(); N.rumG.gain.value = 0; N.rum.connect(N.rumLP); N.rumLP.connect(N.rumG); N.rumG.connect(master);
    // ---- scrape
    N.scr = noiseSource(); N.scrBP = ctx.createBiquadFilter(); N.scrBP.type = 'bandpass'; N.scrBP.frequency.value = 1400; N.scrBP.Q.value = 2;
    N.scrG = ctx.createGain(); N.scrG.gain.value = 0; N.scr.connect(N.scrBP); N.scrBP.connect(N.scrG); N.scrG.connect(master);
    // ---- stall horn: reedy square through a bandpass, warbling
    N.horn = ctx.createOscillator(); N.horn.type = 'square'; N.horn.frequency.value = 410;
    N.hornBP = ctx.createBiquadFilter(); N.hornBP.type = 'bandpass'; N.hornBP.frequency.value = 820; N.hornBP.Q.value = 3;
    N.hornG = ctx.createGain(); N.hornG.gain.value = 0; N.horn.connect(N.hornBP); N.hornBP.connect(N.hornG); N.hornG.connect(master);
    N.horn.start();
    // ---- gear warning: intermittent two-tone
    N.gw = ctx.createOscillator(); N.gw.type = 'triangle'; N.gw.frequency.value = 660;
    N.gwG = ctx.createGain(); N.gwG.gain.value = 0; N.gw.connect(N.gwG); N.gwG.connect(master); N.gw.start();
    // ---- recorded loops
    const loop = (url, dest, cb) => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b)).then(buf => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(dest); src.start(0, Math.random() * buf.duration * 0.5);
        cb(src, g);
      }).catch(() => console.warn('[gyrowing] sound unavailable, using the synth:', url));
    loop('assets/snd/prop_loop.ogg', N.cabin, (src, g) => { N.propS = src; N.propG = g; });
    loop('assets/snd/wind_loop.ogg', master, (src, g) => { N.windS = src; N.windSG = g; });
    ready = true;
  }

  const AudioFX = {
    init,
    get ready() { return ready; },
    get suspended() { return !!ctx && ctx.state !== 'running'; },
    get created() { return !!ctx; },
    setVolume(v) { volume = v; if (master) master.gain.setTargetAtTime(muted ? 0 : v, ctx.currentTime, 0.05); },
    mute(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.08); },

    /** Per-frame continuous sound. s: flight state; view: 'chase'|'cockpit'|'external'. */
    update(s, view, warn, paused, rush) {
      if (!ready) return;
      const t = ctx.currentTime, k = 0.06;
      if (paused || !s) {
        [N.engBus, N.windG, N.rumG, N.scrG, N.hornG, N.gwG, N.propG, N.windSG].forEach(g => { if (g) g.gain.setTargetAtTime(0, t, 0.08); });
        return;
      }
      const rpm = s.crashed ? 0 : s.rpm;
      const fire = rpm / 60 * 2;            // 4-cylinder four-stroke: two firings per revolution
      N.o1.frequency.setTargetAtTime(Math.max(8, fire), t, k);
      N.o2.frequency.setTargetAtTime(Math.max(4, fire / 2 * 1.003), t, k);
      N.o3.frequency.setTargetAtTime(Math.max(8, fire * 2.01), t, k);
      N.lfo.frequency.setTargetAtTime(Math.max(1, rpm / 60 * 2), t, k);   // two-blade prop beat
      N.lfoG.gain.setTargetAtTime(0.18 + 0.12 * (1 - s.power), t, k);
      const pwr = s.power;
      N.engLP.frequency.setTargetAtTime(180 + rpm * 0.28 + pwr * 500, t, k);
      N.exhG.gain.setTargetAtTime(0.25 + 0.9 * pwr, t, k);
      N.exhBP.frequency.setTargetAtTime(90 + rpm * 0.06, t, k);
      const inside = view === 'cockpit';
      let eng = s.crashed ? 0 : (0.25 + 0.55 * pwr) * clamp(rpm / 900, 0, 1);
      eng *= inside ? 0.9 : view === 'external' ? 0.55 : 0.7;
      const rec = !!N.propS;
      N.engBus.gain.setTargetAtTime(eng * (rec ? 0.5 : 1), t, 0.1);
      if (rec) {
        N.propS.playbackRate.setTargetAtTime(clamp(0.25 + rpm / 2600, 0.3, 1.35), t, 0.08);
        N.propG.gain.setTargetAtTime(s.crashed ? 0 : eng * 1.25 * clamp(rpm / 700, 0, 1), t, 0.1);
      }
      N.cabin.frequency.setTargetAtTime(inside ? 1400 : 6000, t, 0.2);
      const v = s.tas;
      // ground rush: low and fast, the air gets louder and brighter
      const r = rush || 0;
      const windAmt = clamp((v / 70) * (v / 70), 0, 1.2) * (inside ? 0.22 : 0.5) * (s.crashed ? 0 : 1) * (1 + 1.3 * r);
      N.windG.gain.setTargetAtTime(windAmt * (N.windS ? 0.4 : 1), t, 0.15);
      if (N.windS) { N.windSG.gain.setTargetAtTime(windAmt * 1.6 * (1 + (s.stall || 0) * 0.8), t, 0.15); N.windS.playbackRate.setTargetAtTime(0.8 + v / 200, t, 0.3); }
      N.windBP.frequency.setTargetAtTime(250 + v * 18 + r * 900, t, 0.2);
      const roll = s.onGround && !s.crashed ? clamp(s.groundSpeed / 30, 0, 1) : 0;
      N.rumG.gain.setTargetAtTime(roll * (s.scraping ? 0.2 : 0.5), t, 0.05);
      N.scrG.gain.setTargetAtTime(s.scraping && s.groundSpeed > 1 ? 0.25 : 0, t, 0.05);
      // horns
      const stallOn = warn.stall ? 1 : 0;
      N.hornG.gain.setTargetAtTime(stallOn * 0.09, t, 0.03);
      N.horn.frequency.setTargetAtTime(400 + 25 * Math.sin(t * 22), t, 0.01);
      const gw = warn.gear && (Math.floor(t * 2.5) % 2 === 0) ? 0.05 : 0;
      N.gwG.gain.setTargetAtTime(gw, t, 0.01);
      N.gw.frequency.setTargetAtTime(Math.floor(t * 5) % 2 ? 660 : 550, t, 0.005);
    },

    /** Heavy mechanical thunk (gear locking, flap motor stop). */
    clunk(strength) {
      if (!ready) return;
      const t = ctx.currentTime, s = strength || 0.6;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * s, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
      const n = noiseSource(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.25 * s, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      n.connect(bp); bp.connect(ng); ng.connect(master); n.stop(t + 0.1);
    },
    /** Electric motor whine while flaps/gear travel. */
    motor(seconds, pitch) {
      if (!ready) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(pitch || 180, t); o.frequency.linearRampToValueAtTime((pitch || 180) * 1.15, t + seconds);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
      g.gain.setValueAtTime(0.05, t + seconds - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + seconds + 0.05);
    },
    /** Tyre chirp on touchdown, louder and longer with sink rate. */
    chirp(sink, speed) {
      if (!ready) return;
      const t = ctx.currentTime, s = clamp(0.25 + sink / 3, 0.25, 1) * clamp(speed / 30, 0.3, 1);
      for (const d of [0, 0.06]) {
        const n = noiseSource(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
        bp.frequency.setValueAtTime(2300, t + d); bp.frequency.exponentialRampToValueAtTime(900, t + d + 0.15);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.45 * s, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
        n.connect(bp); bp.connect(g); g.connect(master); n.stop(t + d + 0.2);
      }
      this.clunk(clamp(sink / 3, 0.2, 1));
    },
    crash() {
      if (!ready) return;
      const t = ctx.currentTime;
      const n = noiseSource(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      n.connect(lp); lp.connect(g); g.connect(master); n.stop(t + 2);
      for (let i = 0; i < 6; i++) setTimeout(() => this.clunk(0.9 - i * 0.12), i * 110 + Math.random() * 60);
    },
    blip(f) {
      if (!ready) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f || 880;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.15);
    },
    chime() { this.blip(660); setTimeout(() => this.blip(990), 110); },
    /** Air tearing past: a filtered noise sweep (ridge skims, near misses). */
    whoosh(strength) {
      if (!ready) return;
      const t = ctx.currentTime, s = clamp(strength || 0.6, 0.1, 1);
      const n = noiseSource(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.18); bp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * s, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      n.connect(bp); bp.connect(g); g.connect(master); n.stop(t + 0.7);
    },
    /** A rising two-note sting for a multiplier step (higher notes for higher steps). */
    step(n) {
      if (!ready) return;
      const base = 440 * Math.pow(2, Math.min(n, 8) / 12 * 2);
      this.blip(base); setTimeout(() => this.blip(base * 1.5), 70);
    },
  };
  window.AudioFX = AudioFX;
})();
