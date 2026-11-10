/*
 * Emberlane - the house band: a procedural lounge / neo-soul bed (Rhodes, round bass, brushed
 * kit, a warm pad, now and then a vibes lick), scheduled a beat ahead on the audio clock so it
 * never loops audibly. Also the short stings for strikes, spares, splits and gutters, voiced
 * on whatever chord the band is on. Driven by audio.js (init, tick each frame, sting).
 */
(function () {
  'use strict';
  const BPM = 86, BEAT = 60 / BPM, S16 = BEAT / 4, SWING = 0.17 * S16;   // lazy, swung 16ths
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // 8 bars in Db: ii V I vi / IV iii ii V(sus). Bass root + a close mid-register voicing.
  const PROG = [
    { b: 39, v: [54, 58, 61, 65] },   // Ebm9
    { b: 44, v: [54, 60, 63, 65] },   // Ab13
    { b: 37, v: [53, 56, 60, 63] },   // Dbmaj9
    { b: 46, v: [49, 53, 56, 60] },   // Bbm9
    { b: 42, v: [53, 56, 58, 61] },   // Gbmaj9
    { b: 41, v: [51, 56, 60, 63] },   // Fm7
    { b: 39, v: [54, 58, 61, 65] },   // Ebm9
    { b: 44, v: [54, 58, 61, 65] },   // Ab13sus
  ];
  const PENTA = [61, 63, 65, 68, 70, 73, 75, 77];   // Db major pentatonic, for the vibes
  // comping rhythms (16th positions, length in 16ths); 14 anticipates the next chord
  const COMP = [[[0, 6], [7, 3], [14, 2]], [[0, 4], [6, 2], [10, 4]], [[0, 10], [11, 2], [14, 2]], [[2, 4], [7, 4], [12, 4]]];

  let ac = null, out = null, rev = null, bus = {}, t0 = 0, step = 0, on = false, noise = null;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function init(ctx, dest, revSend) {
    ac = ctx; out = dest; rev = revSend;
    const n = ac.sampleRate; noise = ac.createBuffer(1, n, n);
    const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // the band's own tone: a gentle tape-ish saturation and a dusk low-pass on everything
    const sat = ac.createWaveShaper(); sat.curve = curve(1.6); sat.oversample = '2x';
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10000; lp.Q.value = 0.5;
    const glue = ac.createGain(); glue.gain.value = 0.9;
    sat.connect(lp); lp.connect(glue); glue.connect(out);
    const send = ac.createGain(); send.gain.value = 0.22; lp.connect(send); send.connect(rev);
    const mk = (g) => { const x = ac.createGain(); x.gain.value = g; x.connect(sat); return x; };
    bus.keys = ac.createGain(); bus.keys.gain.value = 0.6;
    const pan = ac.createStereoPanner(); bus.keys.connect(pan); pan.connect(sat);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = BPM / 60 * 1.5; lg.gain.value = 0.32;   // Rhodes autopan
    lfo.connect(lg); lg.connect(pan.pan); lfo.start();
    bus.bass = mk(0.14); bus.drums = mk(0.3); bus.pad = mk(0.12); bus.vibes = mk(0.3);
  }
  function curve(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }

  // ---------------------------------------------------------------- instruments
  function env(g, t, a, peak, dec, end) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * (end || 0.0001)), t + a + dec);
  }
  /** Electric piano: two-operator FM with a bark that fades into a round sine. */
  function rhodes(m, t, dur, vel, dest) {
    const f = mtof(m), c = ac.createOscillator(), mo = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    c.frequency.value = f; mo.frequency.value = f; c.detune.value = (rnd() - 0.5) * 6;
    const idx = f * (1.2 + vel * 2);
    mg.gain.setValueAtTime(idx, t); mg.gain.exponentialRampToValueAtTime(idx * 0.3, t + 0.5);
    mo.connect(mg); mg.connect(c.frequency); c.connect(g); g.connect(dest || bus.keys);
    const len = Math.max(0.25, dur), pk = 0.16 * vel;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + 0.006);
    g.gain.exponentialRampToValueAtTime(pk * 0.35, t + Math.min(len, 1.2));
    g.gain.setValueAtTime(pk * 0.35, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.35);
    c.start(t); mo.start(t); c.stop(t + len + 0.4); mo.stop(t + len + 0.4);
    const ti = ac.createOscillator(), tg = ac.createGain();   // the tine's bell on the attack
    ti.frequency.value = f * 4.02; env(tg, t, 0.002, pk * 0.12, 0.15);
    ti.connect(tg); tg.connect(dest || bus.keys); ti.start(t); ti.stop(t + 0.2);
  }
  function bass(m, t, dur, vel) {
    const f = mtof(m), o = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f * 2; const g2 = ac.createGain(); g2.gain.value = 0.18;
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(900 + vel * 500, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.25);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus.bass);
    const pk = 0.5 * vel, len = Math.max(0.12, dur * 0.92);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + 0.008);
    g.gain.exponentialRampToValueAtTime(pk * 0.5, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
    o.start(t); o2.start(t); o.stop(t + len + 0.1); o2.stop(t + len + 0.1);
  }
  function kick(t, vel, dest) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    env(g, t, 0.003, 0.9 * vel, 0.32);
    o.connect(g); g.connect(dest || bus.drums); o.start(t); o.stop(t + 0.4);
  }
  function hiss(t, dur, type, freq, q, pk, dest, a) {
    const s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = 0.8 + rnd() * 0.4;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); env(g, t, a || 0.002, pk, dur);
    s.connect(f); f.connect(g); g.connect(dest || bus.drums);
    s.start(t, rnd() * 0.5); s.stop(t + dur + (a || 0) + 0.05);
  }
  function snare(t, vel) {   // a brushed snare: a soft swish with a little drum body
    hiss(t, 0.16, 'bandpass', 2400, 0.7, 0.3 * vel);
    hiss(t, 0.09, 'lowpass', 900, 0.7, 0.18 * vel);
    const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    env(g, t, 0.002, 0.12 * vel, 0.1); o.connect(g); g.connect(bus.drums); o.start(t); o.stop(t + 0.15);
  }
  function hat(t, vel, open) { hiss(t, open ? 0.22 : 0.035, 'bandpass', 7000, 1.2, (open ? 0.1 : 0.15) * vel); }
  function pad(ms, t, dur) {
    for (const m of ms) for (const dt of [-7, 7]) {
      const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt;
      lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.4;
      o.connect(lp); lp.connect(g); g.connect(bus.pad);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      o.start(t); o.stop(t + dur + 0.7);
    }
  }
  function vibes(m, t, vel, dest) {
    const f = mtof(m);
    [[1, 1, 1.6], [4, 0.12, 0.35], [10, 0.03, 0.12]].forEach(([r, a, d]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f * r;
      env(g, t, 0.003, 0.12 * vel * a, d); o.connect(g); g.connect(dest || bus.vibes); o.start(t); o.stop(t + d + 0.05);
    });
  }

  // ---------------------------------------------------------------- the arrangement
  function at(i) { return t0 + i * S16 + (i % 2 ? SWING : 0); }
  function sched(i) {
    const bar = Math.floor(i / 16), pos = i % 16, bi = bar % 8, cyc = Math.floor(bar / 8);
    const ch = PROG[bi], nx = PROG[(bi + 1) % 8], t = at(i);
    const full = cyc % 2 === 1, intro = bar < 2;
    if (pos === 0) seed = 9973 * (bar + 1) + 7;   // each bar is repeatable, varies bar to bar
    const hum = () => (rnd() - 0.5) * 0.012;
    // keys
    if (pos === 0) bus.pattern = COMP[(bar * 7 + cyc) % COMP.length];
    for (const [p, len] of bus.pattern || []) if (p === pos) {
      const c = p >= 14 ? nx : ch, v = 0.55 + rnd() * 0.3 - (p ? 0.12 : 0);
      c.v.forEach((m, k) => rhodes(m, t + k * 0.008 + hum(), len * S16, v));
      if (p === 0 && full) rhodes(c.v[c.v.length - 1] + 12, t + 0.03, len * S16, v * 0.5);
    }
    if (pos === 0) pad(ch.v.slice(0, 3), t, BEAT * 4);
    // bass: root, a fifth or octave, a walk into the next root
    const bl = [[0, ch.b, 5, 0.95], [6, ch.b + (bar % 2 ? 7 : 12), 2, 0.6], [8, ch.b, 3, 0.8], [11, ch.b + 7, 2, 0.55], [14, nx.b + (nx.b > ch.b ? -1 : 1), 2, 0.6]];
    if (!intro || bar === 1) for (const [p, m, len, v] of bl) if (p === pos) bass(m, t + hum(), len * S16, v);
    // kit, laid back a hair behind the beat
    const lb = 0.012;
    if (!intro) {
      if (pos === 0 || pos === 7 || (pos === 10 && bar % 2)) kick(t + lb, pos ? 0.5 : 0.7);
      if (pos === 4 || pos === 12) snare(t + lb + 0.008, 0.85 + rnd() * 0.15);
      if ((bi === 7) && pos >= 13) snare(t + lb, 0.3 + 0.12 * (pos - 13));   // a little fill into the top
    }
    if (pos % 2 === 0) hat(t + lb, (pos % 4 ? 0.55 : 0.9) * (intro ? 0.6 : 1), pos === 14 && bar % 4 === 3);
    else if (full && rnd() < 0.35) hat(t + lb, 0.3, false);
    // the vibes play a short line in the fuller half
    if (full && (bi === 2 || bi === 5) && pos >= 8 && pos % 2 === 0 && rnd() < 0.7) vibes(PENTA[Math.floor(rnd() * PENTA.length)], t + hum(), 0.6 + rnd() * 0.3);
  }

  function start() { if (!ac || on) return; on = true; t0 = ac.currentTime + 0.15; step = 0; }
  function stop() { on = false; }
  /** Schedule everything due in the next ~0.3 s. Call often (every frame). */
  function tick() {
    if (!on || !ac) return;
    const now = ac.currentTime;
    if (at(step) < now - 0.5) {   // we were asleep (hidden tab): skip ahead, keep the grid
      step = Math.ceil((now - t0) / S16);
    }
    while (at(step) < now + 0.3) { if (at(step) >= now - 0.02) sched(step); step++; }
  }
  function chordNow() { const bar = on ? Math.floor(Math.max(0, ac.currentTime - t0) / (BEAT * 4)) : 2; return PROG[bar % 8]; }

  /** A short stinger on top of the band. kind: strike | spare | split | gutter; n = strikes in a row. */
  function sting(kind, n, dest) {
    if (!ac) return;
    const t = ac.currentTime + 0.01, ch = chordNow(), g = ac.createGain();
    g.gain.value = 0.55; g.connect(dest); dest = g;
    n = n || 1;
    if (kind === 'strike') {
      const lvl = Math.min(4, n);
      kick(t, 0.5, dest);
      // a brass-ish stab: filtered saws that open up, on the home chord
      const home = [61, 65, 68, 72, 75].concat(lvl >= 2 ? [77] : []).concat(lvl >= 3 ? [80, 84] : []);
      if (lvl >= 3) brass([56, 63, 66, 70, 73], t, 0.18, 0.7, dest);
      brass([49].concat(home.slice(0, 5)), t + (lvl >= 3 ? 0.2 : 0), 0.5 + lvl * 0.15, 0.6 + lvl * 0.1, dest);
      const arp = [73, 77, 80, 84, 87, 89, 92, 96].slice(0, 3 + lvl * 1 + (lvl >= 3 ? 1 : 0));
      arp.forEach((m, k) => vibes(m, t + 0.12 + (lvl >= 3 ? 0.2 : 0) + k * 0.07, 0.9 - k * 0.04, dest));
      home.slice(0, 4).forEach(m => rhodes(m, t + 0.02, 1.2, 0.7, dest));
    } else if (kind === 'spare') {
      [[65, 68, 70, 73], [65, 68, 72, 75]].forEach((c, k) => c.forEach(m => rhodes(m, t + k * 0.22, k ? 1.2 : 0.18, 0.75, dest)));
      [80, 84, 87].forEach((m, k) => vibes(m, t + 0.24 + k * 0.08, 0.7, dest));
    } else if (kind === 'split') {
      // unresolved: a sus cluster and a question
      [68, 73, 75, 78].forEach(m => rhodes(m, t, 1.1, 0.5, dest));
      vibes(82, t + 0.3, 0.45, dest); vibes(80, t + 0.55, 0.35, dest);
    } else if (kind === 'gutter') {
      // a soft shrug: two muted notes sliding down, warm, no trombone
      [[ch.b + 12, 0], [ch.b + 9, 0.26]].forEach(([m, d]) => rhodes(m + 12, t + d, 0.32, 0.55, dest));
      vibes(ch.b + 24 + 3, t + 0.55, 0.25, dest);
    }
  }
  function brass(ms, t, dur, vel, dest) {
    for (const m of ms) for (const dt of [-9, 0, 9]) {
      const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt;
      lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 0.07); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      o.connect(lp); lp.connect(g); g.connect(dest);
      const pk = 0.03 * vel;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + 0.02);
      g.gain.setValueAtTime(pk * 0.8, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
      o.start(t); o.stop(t + dur + 0.35);
    }
  }

  window.BW = window.BW || {};
  window.BW.Music = { init, start, stop, tick, sting, get on() { return on; }, BPM };
})();
