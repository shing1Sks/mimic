/*
 * Emberlane - sound. Real recordings (CC0, freesound; see CREDITS.md) for the pin crash, pin
 * knocks, the ball rolling, the hall and the pinsetter, re-voiced here: knocks pitched down,
 * shortened and given a synthesised maple body; a sub boom under the first hit; a rumble that
 * follows the ball. Moments (strike, spare, split, gutter) get a room reaction and a sting from
 * the house band (music.js). Every effect is placed by distance to the camera and sent into a
 * shared hall reverb; everything meets a glue compressor, a limiter and a soft clip, so a full
 * rack never distorts. Buses: effects + hall (VOLUME), music (MUSIC), all muted together.
 */
(function () {
  'use strict';
  const FILES = { strike: 'strike.ogg', crash: 'crash.ogg', roll: 'roll.ogg', amb: 'ambience.ogg', machine: 'machine.ogg',
    knock1: 'knock1.ogg', knock2: 'knock2.ogg', knock3: 'knock3.ogg', knock4: 'knock4.ogg', knock5: 'knock5.ogg', knock6: 'knock6.ogg' };
  const M = () => window.BW && window.BW.Music;
  let ac = null, master = null, sfx = null, amb = null, mus = null, duck = null, rev = null, buf = {}, noise = null, brown = null;
  let muted = false, volume = 0.8, musicLvl = 0.5;
  let listener = { x: 0, y: 1.4, z: 1.5 };
  const roll = { src: null, g: null, lp: null, peak: null, rum: null, rumG: null, pan: null, last: null, gutter: false };
  const pins = [];   // pin hits queued this frame, voiced at the next frame() spread over its 16 ms
  let active = [], duckTo = 1, duckUntil = 0, rolling = false, nextLane = 0, lastMoment = -99;
  const stats = { plays: {}, synth: 0 };   // for tests: what was played, without listening

  function ctx() {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
      build();
      load();
    }
    return ac;
  }
  function build() {
    // master: glue compressor -> brickwall-ish limiter -> soft clip -> out
    master = ac.createGain(); master.gain.value = muted ? 0 : 1;
    const glue = ac.createDynamicsCompressor(); glue.threshold.value = -20; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.25;
    const lim = ac.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    const clip = ac.createWaveShaper(); clip.curve = softClip(); clip.oversample = '4x';
    const trim = ac.createGain(); trim.gain.value = 0.95;
    master.connect(glue); glue.connect(lim); lim.connect(clip); clip.connect(trim); trim.connect(ac.destination);
    // effects: warm EQ (body up, the 2-5 kHz bite down, air softened)
    sfx = ac.createGain(); sfx.gain.value = volume;
    const lo = ac.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 220; lo.gain.value = 1.5;
    const bite = ac.createBiquadFilter(); bite.type = 'peaking'; bite.frequency.value = 3200; bite.Q.value = 1.2; bite.gain.value = -4;
    const air = ac.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 7000; air.gain.value = -4;
    sfx.connect(lo); lo.connect(bite); bite.connect(air); air.connect(master);
    // the hall: a synthetic impulse of a big hard room (pre-delay, early slaps, a darkening tail)
    const conv = ac.createConvolver(); conv.buffer = hallIR(1.9, 0.016);
    rev = ac.createGain(); rev.gain.value = 1;
    const revLo = ac.createBiquadFilter(); revLo.type = 'highpass'; revLo.frequency.value = 140;
    const revOut = ac.createGain(); revOut.gain.value = 0.55;
    rev.connect(revLo); revLo.connect(conv); conv.connect(revOut); revOut.connect(sfx);
    amb = ac.createGain(); amb.gain.value = 1; amb.connect(sfx);
    // music: its own smaller room, ducked under big moments and while the ball runs
    mus = ac.createGain(); mus.gain.value = musicGain();
    duck = ac.createGain(); duck.gain.value = 1;
    const mconv = ac.createConvolver(); mconv.buffer = hallIR(1.3, 0.01);
    const mrev = ac.createGain(); mrev.gain.value = 1; const mrevOut = ac.createGain(); mrevOut.gain.value = 0.5;
    mrev.connect(mconv); mconv.connect(mrevOut); mrevOut.connect(duck);
    mus.connect(duck); duck.connect(master);
    const n = ac.sampleRate * 2;
    noise = ac.createBuffer(1, n, ac.sampleRate); brown = ac.createBuffer(1, n, ac.sampleRate);
    const w = noise.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    if (M()) { M().init(ac, mus, mrev); if (musicLvl > 0) M().start(); }
  }
  function musicGain() { return muted ? 0 : 0.9 * musicLvl * musicLvl * 2; }
  function softClip() { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3)); } return c; }
  function hallIR(rt, pre) {
    const sr = ac.sampleRate, n = Math.floor(sr * (rt + pre + 0.1)), b = ac.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch), p0 = Math.floor(pre * sr);
      // early reflections off lanes, ceiling, the masking wall
      for (let k = 0; k < 9; k++) { const at = p0 + Math.floor((0.004 + Math.random() * 0.07) * sr); d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - k * 0.04); }
      let lp = 0;
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, k = Math.min(0.92, 0.25 + t * 0.6);   // the tail gets darker as it decays
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] += lp * 2.2 * Math.exp(-6.9 * t / rt) * Math.min(1, t / 0.02);
      }
    }
    return b;
  }
  /** A loop with its end cross-faded into its start, so the seam is inaudible. */
  function loopable(b, fade) {
    const f = Math.floor(fade * b.sampleRate), n = b.length - f, o = ac.createBuffer(b.numberOfChannels, n, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const s = b.getChannelData(ch), d = o.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = s[i];
      for (let i = 0; i < f; i++) { const k = i / f; d[i] = s[i] * Math.sin(k * Math.PI / 2) + s[n + i] * Math.cos(k * Math.PI / 2); }
    }
    return o;
  }
  function load() {
    for (const [k, f] of Object.entries(FILES)) {
      fetch('assets/snd/' + f).then(r => r.arrayBuffer()).then(a => ac.decodeAudioData(a)).then(b => {
        buf[k] = k === 'amb' ? loopable(b, 3) : b;
        if (k === 'amb' || k === 'roll') startLoops();
      }).catch(() => {});
    }
  }
  /** Call from any user gesture (and every frame is fine): browsers start audio only after one. */
  function unlock() { const c = ctx(); if (c && c.state === 'suspended' && c.resume) c.resume(); }

  function startLoops() {
    if (!ac) return;
    if (buf.amb && !amb.started) {
      amb.started = true;
      const s = ac.createBufferSource(); s.buffer = buf.amb; s.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
      const g = ac.createGain(); g.gain.value = 0.3;
      s.connect(lp); lp.connect(g); g.connect(amb); s.start();
      // room tone: air handling and the hum of forty pinsetters, felt more than heard
      const r = ac.createBufferSource(); r.buffer = brown; r.loop = true;
      const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 180;
      const rg = ac.createGain(); rg.gain.value = 0.015;
      r.connect(rl); rl.connect(rg); rg.connect(amb); r.start();
    }
    if (buf.roll && !roll.src) {
      roll.src = ac.createBufferSource(); roll.src.buffer = buf.roll; roll.src.loop = true;
      roll.lp = ac.createBiquadFilter(); roll.lp.type = 'lowpass'; roll.lp.frequency.value = 900;
      roll.peak = ac.createBiquadFilter(); roll.peak.type = 'peaking'; roll.peak.frequency.value = 420; roll.peak.Q.value = 3; roll.peak.gain.value = 0;
      roll.g = ac.createGain(); roll.g.gain.value = 0;
      roll.pan = ac.createStereoPanner();
      // the weight of it: low rumble from brown noise that tracks the speed
      roll.rum = ac.createBufferSource(); roll.rum.buffer = brown; roll.rum.loop = true;
      const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 150; rl.Q.value = 0.7;
      roll.rumG = ac.createGain(); roll.rumG.gain.value = 0;
      roll.src.connect(roll.lp); roll.lp.connect(roll.peak); roll.peak.connect(roll.g); roll.g.connect(roll.pan);
      roll.rum.connect(rl); rl.connect(roll.rumG); roll.rumG.connect(roll.pan);
      roll.pan.connect(sfx);
      const send = ac.createGain(); send.gain.value = 0.18; roll.pan.connect(send); send.connect(rev);
      roll.src.start(); roll.rum.start();
    }
  }

  // ---------------------------------------------------------------- placement and voices
  const dist = (x, y, z) => Math.hypot(x - listener.x, y - listener.y, z - listener.z);
  const att = d => 1 / (1 + d / 4.5);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rr = (a, b) => a + Math.random() * (b - a);
  /** An output chain at a point: distance gain, a darker tone further away, pan, hall send. */
  function spot(x, y, z, wet, t) {
    const d = dist(x, y, z), g = ac.createGain(), lp = ac.createBiquadFilter(), p = ac.createStereoPanner(), s = ac.createGain();
    g.gain.value = att(d);
    lp.type = 'lowpass'; lp.frequency.value = 16000 / (1 + d / 5);
    p.pan.value = clamp((x - listener.x) / (Math.abs(z - listener.z) + 1.5), -0.8, 0.8);
    s.gain.value = (wet == null ? 0.25 : wet) * (0.6 + d / 10);
    g.connect(lp); lp.connect(p); p.connect(sfx); p.connect(s); s.connect(rev);
    return g;
  }
  function sample(name, dest, gain, rate, t, opt) {
    if (!buf[name]) return null;
    stats.plays[name] = (stats.plays[name] || 0) + 1;
    opt = opt || {};
    const s = ac.createBufferSource(); s.buffer = buf[name]; s.playbackRate.value = rate || 1;
    const g = ac.createGain();
    if (opt.dur) {   // keep only the first hit of a clip, faded out
      g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, t + opt.dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);
    } else g.gain.value = gain;
    let head = s;
    if (opt.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lp; f.Q.value = 0.5; s.connect(f); head = f; }
    head.connect(g); g.connect(dest);
    s.start(t, opt.offset || 0);
    if (opt.dur) s.stop(t + opt.dur + 0.02);
    return s;
  }
  function burst(dest, t, dur, type, freq, q, gain, att0) {
    const s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = rr(0.8, 1.2);
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); const a = att0 || 0.002;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
  }
  function tone(dest, t, f0, f1, dur, gain, type) {
    stats.synth++;
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- pins
  // A pin hit = a recorded knock (pitched down to maple, first hit only, darker when soft) + the
  // pin's body (three damped modes) + a short clack. At most 14 pin voices sound at once and
  // dense clatter is levelled, so ten pins read as a rich clatter, not a buzz.
  function voicePin(h, t) {
    const now = ac.currentTime;
    active = active.filter(e => e > now);
    const e = clamp(h.speed / 4, 0.04, 1);
    if (active.length >= 14 && e < 0.5) return;
    const floor = h.kind === 'floor', wall = h.kind === 'wall';
    const dense = 1 / Math.sqrt(1 + active.length * 0.35);
    const lvl = Math.pow(e, 1.3) * dense * (floor ? 0.8 : wall ? 0.9 : 1);
    const out = spot(h.x, h.y, h.z, 0.3, t);
    const len = 0.08 + e * 0.1;
    active.push(t + len + 0.05);
    const k = 1 + Math.floor(Math.random() * 6);
    const rate = floor ? rr(0.6, 0.7) : wall ? rr(0.52, 0.6) : rr(0.72, 0.86) + e * 0.06;
    sample('knock' + k, out, 2.0 * lvl, rate, t, { dur: len, lp: 1800 + e * 3200 });
    // the body: hollow-ish maple modes, lower and longer for a pin landing on the deck
    const f0 = floor ? rr(175, 220) : wall ? rr(130, 160) : rr(220, 290);
    [[1, 0.5, 0.11], [2.32, 0.26, 0.07], [3.9, 0.12, 0.045]].forEach(([r, a, d]) => tone(out, t, f0 * r, f0 * r * 0.985, d * (0.7 + e * 0.6), a * lvl * (floor || wall ? 0.3 : 0.45)));
    if (floor || wall) burst(out, t, 0.05, 'lowpass', 600, 0.7, 0.3 * lvl);
    if (wall) tone(out, t, 95, 70, 0.16, 0.25 * lvl);   // the kickback panel booms
    if (e > 0.2) burst(out, t, 0.008, 'bandpass', 1900, 0.8, 0.25 * lvl);
  }
  /** The ball meets the rack: the recorded crash, a felt boom, and the music gets out of the way. */
  function crash(speed, x, y, z) {
    const t = ac.currentTime, e = clamp(speed / 8, 0.15, 1.2), out = spot(x, y, z, 0.35, t);
    sample('crash', out, 0.8 * e, rr(0.9, 0.98), t);
    tone(out, t, 72, 40, 0.5, 0.3 * e);
    burst(out, t, 0.18, 'lowpass', 260, 0.7, 0.4 * e, 0.003);
    // the rack giving way: a short low clatter from the strike take, kept dark
    if (speed > 4) sample('strike', out, 0.35 * e, rr(0.78, 0.84), t + 0.015, { lp: 2400, offset: 0.06, dur: 0.9 });
    duckFor(0.45, 2.4);
  }

  // ---------------------------------------------------------------- room reactions
  function clap(dest, t, g) {
    burst(dest, t, rr(0.018, 0.03), 'bandpass', rr(900, 1500), 1.1, g, 0.001);
    burst(dest, t, 0.012, 'lowpass', 600, 0.7, g * 0.6, 0.001);
    burst(dest, t, 0.01, 'bandpass', 2600, 1, g * 0.35, 0.001);
  }
  function claps(people, secs, loud, side) {
    const t0 = ac.currentTime + 0.25;
    for (let p = 0; p < people; p++) {
      const x = (side || 0) + rr(-4, 4), z = listener.z + rr(1.5, 6), out = spot(x, 0.9, z, 0.7, t0);
      const rate = rr(3.6, 5.4), start = rr(0, 0.5), n = Math.floor(secs * rate);
      for (let i = 0; i < n; i++) clap(out, t0 + start + i / rate + rr(-0.015, 0.015), loud * rr(0.6, 1) * (1 - i / (n + 2)));
    }
  }
  /** A small group's cheer: buzzy throats through vowel formants that glide (whoo / yeah / ooh). */
  function voices(count, kind, loud) {
    const t0 = ac.currentTime + 0.18;
    const V = { yeah: [[600, 1900, 2600], [750, 1250, 2500]], whoo: [[400, 900, 2400], [320, 760, 2300]], ooh: [[380, 850, 2400], [330, 700, 2300]] };
    for (let i = 0; i < count; i++) {
      const female = Math.random() < 0.45, f = (female ? rr(210, 290) : rr(110, 160)), t = t0 + rr(0, 0.35), d = rr(0.45, 0.9);
      const k = kind === 'mix' ? (Math.random() < 0.5 ? 'yeah' : 'whoo') : kind, v = V[k];
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const up = k === 'ooh' ? 1.12 : 1.35;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * up, t + d * 0.35); o.frequency.exponentialRampToValueAtTime(f * (k === 'ooh' ? 0.8 : 0.9), t + d);
      const vib = ac.createOscillator(), vg = ac.createGain(); vib.frequency.value = rr(5, 7); vg.gain.value = f * 0.025; vib.connect(vg); vg.connect(o.frequency);
      const out = spot(listener.x + rr(-5, 5), 1.5, listener.z + rr(2, 7), 0.8, t), g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(loud * rr(0.6, 1), t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      g.connect(out);
      v[0].forEach((fr, j) => {
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6 + j * 3;
        bp.frequency.setValueAtTime(fr * (female ? 1.15 : 1), t); bp.frequency.linearRampToValueAtTime(v[1][j] * (female ? 1.15 : 1), t + d);
        const bg = ac.createGain(); bg.gain.value = [1, 0.5, 0.18][j];
        o.connect(bp); bp.connect(bg); bg.connect(g);
      });
      burst(g, t, d * 0.8, 'bandpass', 1500, 0.8, 0.06, 0.05);   // breath
      o.start(t); vib.start(t); o.stop(t + d + 0.05); vib.stop(t + d + 0.05);
    }
  }
  function duckFor(level, secs) {
    duckTo = Math.min(duckTo, level); duckUntil = Math.max(duckUntil, ac.currentTime + secs);
  }

  // ---------------------------------------------------------------- distant lanes
  function otherLane() {
    const side = Math.random() < 0.5 ? -1 : 1, x = side * rr(4, 14), z = rr(-17, -19), t = ac.currentTime;
    const out = spot(x, 0.3, z, 0.95, t), g = ac.createGain(); g.gain.value = rr(0.35, 0.7); g.connect(out);
    const strike = Math.random() < 0.3, len = rr(1.8, 2.6);
    // a ball we never see, swelling as it nears their pins
    const r = ac.createBufferSource(), f = ac.createBiquadFilter(), rg = ac.createGain();
    r.buffer = buf.roll; r.loop = true; r.playbackRate.value = rr(0.8, 1.0); f.type = 'lowpass'; f.frequency.value = 420;
    rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(0.5, t + len * 0.8); rg.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
    r.connect(f); f.connect(rg); rg.connect(g); r.start(t); r.stop(t + len + 0.2);
    sample(strike ? 'strike' : 'crash', g, strike ? 0.6 : 0.8, rr(0.85, 1.0), t + len, { lp: strike ? 1400 : 900 });
    if (strike && Math.random() < 0.5) setTimeout(() => { if (ac) claps(3, 1.2, 0.05, x); }, (len + 0.5) * 1000);
  }

  const SFX = {
    setListener(p) { listener = p; },
    /** Each frame: the rolling ball (speed m/s, position, on the floor?). */
    roll(speed, x, y, z, onFloor) {
      if (!roll.g) return;
      const t = ac.currentTime, d = dist(x, y, z), a = att(d);
      let vr = 0;   // closing speed to the camera, for a touch of Doppler
      if (roll.last && t > roll.last.t) vr = (d - roll.last.d) / (t - roll.last.t);
      roll.last = { t, d };
      const k = onFloor ? clamp(speed / 7, 0, 1.2) : 0;
      rolling = onFloor && speed > 1 && z > -18;
      const gut = roll.gutter;
      roll.g.gain.setTargetAtTime(k * (gut ? 0.55 : 0.38) * a, t, 0.05);
      roll.rumG.gain.setTargetAtTime(k * (gut ? 0.12 : 0.22) * a, t, 0.06);
      const dop = clamp(1 - vr * 0.01, 0.9, 1.1);
      roll.src.playbackRate.setTargetAtTime((0.5 + Math.min(1.0, speed / 10)) * dop, t, 0.08);
      roll.lp.frequency.setTargetAtTime((gut ? 1400 : 380 + speed * 90) / (1 + d / 12), t, 0.08);
      roll.peak.gain.setTargetAtTime(gut ? 9 : 0, t, 0.1);
      roll.pan.pan.setTargetAtTime(clamp((x - listener.x) / (Math.abs(z - listener.z) + 1.5), -0.7, 0.7), t, 0.08);
    },
    /** Once per frame: voice last frame's pin hits, music, ducking, the other lanes. */
    frame() {
      if (!ac) return;
      const t = ac.currentTime;
      if (pins.length) {
        pins.sort((a, b) => b.speed - a.speed);
        const keep = pins.slice(0, 6).sort((a, b) => a.i - b.i);
        keep.forEach((h, j) => voicePin(h, t + 0.002 + j * 0.016 / keep.length + Math.random() * 0.003));
        pins.length = 0;
      }
      if (M()) M().tick();
      if (t > duckUntil) duckTo = 1;
      const target = Math.min(duckTo, rolling ? 0.62 : 1);
      if (duck) duck.gain.setTargetAtTime(target, t, target < duck.gain.value ? 0.08 : 0.6);
      if (buf.roll && buf.crash && !muted) {
        if (!nextLane) nextLane = t + rr(6, 14);
        else if (t > nextLane) { if (t - lastMoment > 3 && !rolling) otherLane(); nextLane = t + rr(9, 24); }
      }
    },
    /** Physics impact. kind: ball-pin | pin-pin | floor | wall; who: 'ball' | 'pin'. */
    impact(kind, speed, x, y, z, who) {
      if (!ctx()) return;
      if (kind === 'ball-pin') { crash(speed, x, y, z); return; }
      const t = ac.currentTime;
      if (kind === 'floor' && who === 'ball') {
        // a 7 kg ball on maple: a deep, short thud with a woody knock
        const k = clamp(speed / 4, 0, 1), out = spot(x, y, z, 0.3, t);
        tone(out, t, 78, 46, 0.3, 1.1 * k);
        burst(out, t, 0.07, 'lowpass', 380, 0.9, 0.7 * k);
        tone(out, t, 210, 190, 0.06, 0.25 * k);
        return;
      }
      if (kind === 'wall' && who === 'ball') {
        const out = spot(x, y, z, 0.35, t), k = clamp(speed / 6, 0, 1);
        tone(out, t, 90, 60, 0.2, 0.7 * k); burst(out, t, 0.1, 'lowpass', 700, 0.8, 0.5 * k);
        return;
      }
      if (speed < 0.22) return;   // resting contacts
      pins.push({ kind: kind === 'pin-pin' || kind === 'ball-pin' ? 'pin' : kind, speed, x, y, z, i: pins.length });
    },
    /** The ball drops into the pit: a cushioned thump behind the curtain. */
    pit(x, y, z) {
      if (!ctx()) return;
      const t = ac.currentTime + 0.05, out = spot(x, y, z, 0.5, t);
      tone(out, t, 62, 38, 0.4, 0.3); burst(out, t, 0.2, 'lowpass', 300, 0.7, 0.2, 0.01);
    },
    gutter(x, y, z) {
      if (!ctx()) return;
      roll.gutter = true;
      const t = ac.currentTime, out = spot(x, y, z, 0.3, t);
      tone(out, t, 120, 80, 0.15, 0.35); burst(out, t, 0.12, 'bandpass', 500, 1.5, 0.25);   // drops into the channel
    },
    /** The result banner. kind: strike | spare | split | gutter | count; n: strikes in a row. */
    moment(kind, n) {
      if (!ctx()) return;
      lastMoment = ac.currentTime;
      const Mu = M(), lvl = Math.min(4, n || 1);
      if (kind === 'strike') {
        const t = ac.currentTime;
        tone(sfx, t, 60, 38, 0.5, 0.18 + lvl * 0.04);   // a felt punch under the sting
        if (Mu) Mu.sting('strike', lvl, sfx);
        claps(3 + lvl * 2, 1.4 + lvl * 0.4, 0.16 + lvl * 0.02);
        voices(2 + lvl * 2, 'mix', 0.07 + lvl * 0.012);
        duckFor(0.25, 2.6 + lvl * 0.3);
      } else if (kind === 'spare') {
        if (Mu) Mu.sting('spare', 1, sfx);
        claps(3, 1.2, 0.14); voices(2, 'yeah', 0.06);
        duckFor(0.35, 2.0);
      } else if (kind === 'split') {
        if (Mu) Mu.sting('split', 1, sfx);
        voices(4, 'ooh', 0.05);
        duckFor(0.5, 1.6);
      } else if (kind === 'gutter') {
        if (Mu) Mu.sting('gutter', 1, sfx);
        duckFor(0.55, 1.4);
      }
    },
    strike(n) { SFX.moment('strike', n); },
    spare() { SFX.moment('spare'); },
    machine(x, y, z) {
      if (!ctx()) return;
      const t = ac.currentTime, out = spot(x, y, z, 0.5, t);
      sample('machine', out, 0.9, 1, t);
      roll.gutter = false;
      // the ball comes home: a rumble under the lane, then it pops up into the return
      const home = spot(-1.0, 0.5, 0.9, 0.2, t), g = ac.createGain(); g.connect(home);
      const s = ac.createBufferSource(); s.buffer = brown; s.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
      g.gain.setValueAtTime(0.0001, t + 0.3); g.gain.exponentialRampToValueAtTime(0.5, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      s.connect(lp); lp.connect(g); s.start(t + 0.3); s.stop(t + 2.2);
      burst(home, t + 1.75, 0.25, 'lowpass', 900, 0.7, 0.15, 0.12);
      tone(home, t + 2.0, 150, 110, 0.12, 0.45); tone(home, t + 2.13, 140, 105, 0.1, 0.25);
    },
    grab() { if (!ctx()) return; const t = ac.currentTime; tone(sfx, t, 150, 110, 0.07, 0.18); roll.gutter = false; roll.last = null; },
    release(speed) { if (!ctx()) return; burst(sfx, ac.currentTime, 0.18, 'lowpass', 650, 0.7, Math.min(0.2, speed / 40), 0.04); roll.gutter = false; },
    ui(kind) {
      if (!ctx()) return;
      const t = ac.currentTime, v = n => tone(sfx, t + n[1], n[0], n[0], 0.5, n[2]);
      if (kind === 'align') [[523, 0, 0.06], [784, 0.07, 0.05]].forEach(v);
      else if (kind === 'move') burst(sfx, t, 0.03, 'bandpass', 1200, 2, 0.05);
      else [[659, 0, 0.05]].forEach(v);
    },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 1; if (mus) mus.gain.value = musicGain(); },
    /** Effects volume 0..1 (0.8 = the old fixed level). */
    setVolume(v) { volume = clamp(v, 0, 1); if (sfx) sfx.gain.value = volume; },
    /** Music volume 0..1; 0 stops the band. */
    setMusic(v) {
      musicLvl = clamp(v, 0, 1);
      if (mus) mus.gain.setTargetAtTime(musicGain(), ac.currentTime, 0.1);
      const Mu = M(); if (Mu && ac) { if (musicLvl > 0) Mu.start(); else Mu.stop(); }
    },
    get muted() { return muted; },
  };

  window.BW = window.BW || {};
  window.BW.Audio = { unlock, SFX, ctx, stats, loaded: () => Object.keys(buf) };
})();
