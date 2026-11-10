/*
 * Iron Ludus - sound. Web Audio, samples from assets/sfx plus a synthesized steel ring and
 * sub thump layered under clashes (the "bang"). Classic script: defines window.LudusAudio.
 */
(function () {
  'use strict';
  const GROUPS = {
    clash: ['clash_1', 'clash_2', 'clash_3', 'clash_4', 'clash_5', 'clash_6', 'clash_7', 'clash_8', 'clash_9', 'clash_10', 'k_metal_hit_01', 'k_metal_hit_02'],
    blade: ['sword_1', 'sword_2', 'sword_3', 'sword_4', 'sword_5', 'sword_6', 'sword_7', 'sword_8', 'sword_9', 'sword_10'],
    swish: ['swish_1', 'swish_2', 'swish_3', 'swish_4', 'swish_5', 'swish_6', 'swish_7', 'swish_8', 'swish_9'],
    flesh: ['flesh_1', 'flesh_2', 'flesh_3', 'k_hit_01', 'k_hit_02', 'k_hit_03'],
    shield: ['k_wood_hit_01', 'k_wood_hit_02', 'k_wood_hit_03'],
    grunt: ['grunt_1', 'grunt_2', 'grunt_3', 'grunt_4', 'grunt_5'],
    die: ['die_1'],
    roar: ['cr_roar_01', 'cr_roar_02', 'cr_roar_03'],
    troll: ['cr_troll_01', 'cr_troll_02', 'cr_troll_03'],
    wolf: ['cr_howl', 'cr_barking_01'],
    beastHurt: ['cr_hurt_01', 'cr_hurt_02', 'cr_hurt_03'],
    monster: ['cr_monster_03', 'cr_monster_05', 'cr_grunt_01', 'cr_grunt_03'],
    scream: ['cr_scream_01'],
    step: ['k_footstep_01', 'k_stones_01'],
    cheer: ['crowd_cheer', 'crowd_chant'],
    crowdSoft: ['crowd_soft'],
    shout: ['crowd_shout'],
  };
  let ctx = null, master = null, crowdGain = null, crowdSrc = null, muted = false;
  const buffers = {};
  const loading = {};

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9 * volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0; crowdGain.connect(master);
    return ctx;
  }
  function load(name) {
    if (buffers[name] || loading[name] || !ensure()) return loading[name];
    loading[name] = fetch('assets/sfx/' + name + '.ogg').then(r => r.arrayBuffer())
      .then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
      .then(buf => { buffers[name] = buf; return buf; }).catch(() => { delete loading[name]; return null; });
    return loading[name];
  }
  /** Fetch every sample, a few at a time (simple static servers refuse big bursts). */
  function preload() {
    if (!ensure()) return Promise.resolve();
    const names = ['crowd_amb']; for (const g in GROUPS) GROUPS[g].forEach(n => names.push(n));
    let i = 0;
    const worker = () => i < names.length ? Promise.resolve(load(names[i++])).then(worker) : Promise.resolve();
    return Promise.all([worker(), worker(), worker()]);
  }
  function unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }

  /** Play a random sample of a group. o = { vol, rate, pan, delay } */
  function play(group, o = {}) {
    if (!ctx || muted) return;
    const list = GROUPS[group] || [group];
    const name = list[(Math.random() * list.length) | 0];
    const buf = buffers[name];
    if (!buf) { load(name); return; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (o.rate || 1) * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain(); g.gain.value = o.vol === undefined ? 1 : o.vol;
    let node = g;
    if (ctx.createStereoPanner && o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); node = p; }
    src.connect(g); node.connect(master);
    src.start(ctx.currentTime + (o.delay || 0));
  }

  /** Synthesized steel: inharmonic ringing partials + a sub thump. strength 0..1. */
  function ring(strength, bright) {
    if (!ctx || muted) return;
    const t = ctx.currentTime, s = Math.max(0.2, Math.min(1, strength));
    const base = bright ? 1850 : 1350;
    [1, 1.47, 2.09, 2.76, 3.9].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * m * (0.99 + Math.random() * 0.02);
      const g = ctx.createGain();
      const dur = (bright ? 1.4 : 0.7) / (1 + i * 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * s / (1 + i * 0.6), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    });
    thump(s * (bright ? 1 : 0.7));
  }
  function thump(s) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * s, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
  }

  function startCrowd() {
    if (!ctx || crowdSrc) return;
    const buf = buffers.crowd_amb;
    if (!buf) { load('crowd_amb').then(() => startCrowd()); return; }
    crowdSrc = ctx.createBufferSource(); crowdSrc.buffer = buf; crowdSrc.loop = true;
    crowdSrc.connect(crowdGain); crowdSrc.start();
  }
  /** Crowd ambience level 0..1 (smoothed by Web Audio). */
  function crowd(level) {
    if (!ctx || !crowdGain) return;
    crowdGain.gain.setTargetAtTime(muted ? 0 : 0.18 + 0.5 * Math.max(0, Math.min(1, level)), ctx.currentTime, 0.4);
  }
  let volume = 1;
  function applyGain() { if (master) master.gain.value = muted ? 0 : 0.9 * volume; }
  function setMuted(m) { muted = m; applyGain(); }
  /** Master volume 0..1 (0 mutes). */
  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); muted = volume === 0; applyGain(); }

  window.LudusAudio = { preload, unlock, play, ring, thump, startCrowd, crowd, setMuted, setVolume, get muted() { return muted; }, get volume() { return volume; } };
})();
