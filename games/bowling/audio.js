/*
 * Emberlane - sound. Real recordings (CC0, freesound; see CREDITS.md) for the pin crash, pin
 * knocks, the ball rolling, the hall and the pinsetter; small synthesised layers for the
 * thud of a dropped ball, the gutter, and the UI. Everything is placed by distance to the
 * camera, so the crash is huge in the pin camera and distant from the foul line.
 */
(function () {
  'use strict';
  const FILES = { strike: 'strike.ogg', crash: 'crash.ogg', roll: 'roll.ogg', amb: 'ambience.ogg', machine: 'machine.ogg',
    knock1: 'knock1.ogg', knock2: 'knock2.ogg', knock3: 'knock3.ogg', knock4: 'knock4.ogg', knock5: 'knock5.ogg', knock6: 'knock6.ogg' };
  let ac = null, master = null, buf = {}, muted = false, volume = 0.8, rollSrc = null, rollGain = null, rollFilt = null, ambGain = null, started = false;
  let listener = { x: 0, y: 1.4, z: 1.5 };
  let lastKnock = 0, knocksThisFrame = 0;
  const stats = { plays: {}, synth: 0 };   // for tests: what was played, without listening

  function ctx() {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
      master = ac.createGain(); master.gain.value = muted ? 0 : 1.1 * volume;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ac.destination);
      load();
    }
    return ac;
  }
  function load() {
    for (const [k, f] of Object.entries(FILES)) {
      fetch('assets/snd/' + f).then(r => r.arrayBuffer()).then(a => ac.decodeAudioData(a)).then(b => { buf[k] = b; if (k === 'amb' || k === 'roll') startLoops(); }).catch(() => {});
    }
  }
  /** Call from any user gesture (and every frame is fine): browsers start audio only after one. */
  function unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume(); }

  function startLoops() {
    if (!ac) return;
    if (buf.amb && !ambGain) {
      const s = ac.createBufferSource(); s.buffer = buf.amb; s.loop = true;
      ambGain = ac.createGain(); ambGain.gain.value = 0.16;
      s.connect(ambGain); ambGain.connect(master); s.start();
    }
    if (buf.roll && !rollSrc) {
      rollSrc = ac.createBufferSource(); rollSrc.buffer = buf.roll; rollSrc.loop = true;
      rollFilt = ac.createBiquadFilter(); rollFilt.type = 'lowpass'; rollFilt.frequency.value = 900;
      rollGain = ac.createGain(); rollGain.gain.value = 0;
      rollSrc.connect(rollFilt); rollFilt.connect(rollGain); rollGain.connect(master); rollSrc.start();
    }
  }

  const dist = (x, y, z) => Math.hypot(x - listener.x, y - listener.y, z - listener.z);
  const att = d => 1 / (1 + d / 4.5);

  function play(name, gain, rate, delay) {
    const c = ctx(); if (!c || !buf[name]) return null;
    stats.plays[name] = (stats.plays[name] || 0) + 1;
    const s = c.createBufferSource(); s.buffer = buf[name]; s.playbackRate.value = rate || 1;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(master); s.start(c.currentTime + (delay || 0));
    return s;
  }
  function noiseBurst(dur, freq, q, gain, type) {
    const c = ctx(); if (!c) return;
    const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }
  function thump(freq, dur, gain) {
    const c = ctx(); if (!c) return; stats.synth++;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function chime(notes, gain) {
    const c = ctx(); if (!c) return;
    notes.forEach((f, i) => {
      const t = c.currentTime + i * 0.07, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1);
    });
  }

  const SFX = {
    setListener(p) { listener = p; },
    /** Each frame: the rolling ball (speed m/s, position, on the floor?). */
    roll(speed, x, y, z, onFloor) {
      if (!rollGain) return;
      const t = ac.currentTime;
      const g = onFloor ? Math.min(1, speed / 7) * 0.9 * att(dist(x, y, z)) : 0;
      rollGain.gain.setTargetAtTime(g, t, 0.05);
      rollSrc.playbackRate.setTargetAtTime(0.55 + Math.min(1.2, speed / 9), t, 0.08);
      rollFilt.frequency.setTargetAtTime(500 + speed * 140, t, 0.08);
    },
    frame() { knocksThisFrame = 0; },
    /** Physics impact. kind: ball-pin | pin-pin | floor | wall; who: 'ball' | 'pin'. */
    impact(kind, speed, x, y, z, who) {
      const a = att(dist(x, y, z));
      if (kind === 'ball-pin') {
        play('crash', Math.min(1.3, 0.25 + speed / 7) * a * 1.6, 0.92 + Math.random() * 0.12);
        return;
      }
      if (kind === 'floor' && who === 'ball') {
        // a bowling ball landing on maple: a deep, short thud
        const k = Math.min(1, speed / 4);
        thump(70 + Math.random() * 10, 0.22, 0.9 * k * a);
        noiseBurst(0.08, 320, 1.2, 0.5 * k * a, 'lowpass');
        return;
      }
      if (kind === 'wall' && who === 'ball') { noiseBurst(0.12, 900, 2, Math.min(0.6, speed / 6) * a); return; }
      // pins: knocks, throttled so a crash stays a crash and not a buzz
      const now = performance.now();
      if (knocksThisFrame > 3 || now - lastKnock < 12) return;
      knocksThisFrame++; lastKnock = now;
      const n = 1 + Math.floor(Math.random() * 6);
      const loud = Math.min(1, speed / 3.5) * (kind === 'floor' ? 0.6 : 0.9);
      play('knock' + n, loud * a * 1.2, kind === 'floor' ? 0.75 + Math.random() * 0.15 : 0.9 + Math.random() * 0.25);
    },
    gutter(x, y, z) { noiseBurst(0.35, 600, 0.8, 0.35 * att(dist(x, y, z))); },
    strike() { play('strike', 0.55, 1.0, 0.0); setTimeout(() => chime([523, 659, 784, 1047], 0.08), 350); },
    spare() { chime([587, 740, 880], 0.07); },
    machine(x, y, z) { play('machine', 0.5 * att(dist(x, y, z)) + 0.05, 1); },
    grab() { thump(160, 0.08, 0.15); },
    release(speed) { noiseBurst(0.06, 2400, 0.7, Math.min(0.25, speed / 40)); },
    ui(kind) { if (kind === 'align') chime([880, 1320], 0.05); else if (kind === 'move') thump(520, 0.04, 0.05); else chime([660], 0.05); },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 1.1 * volume; },
    /** Master volume 0..1 (0.8 = the old fixed level). */
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = muted ? 0 : 1.1 * volume; },
    get muted() { return muted; },
  };

  window.BW = window.BW || {};
  window.BW.Audio = { unlock, SFX, ctx, stats, loaded: () => Object.keys(buf) };
})();
