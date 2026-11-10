/*
 * Tidecast - game loop, players, the cast / bite / fight cycle, menus, HUD.
 * The rod is the phone, 1:1: mc.forward is the rod's direction, mc.angularVelocity its turn.
 * Every rule lives in logic.js (tested in Node); this file wires motion, sound, rumble and pictures.
 */
(function () {
  'use strict';
  const T = THREE, L = TideLogic, LB = TideLobby;
  const $ = id => document.getElementById(id);
  const clamp = L.clamp;
  const W = TideScene.createWorld($('gl'));
  const synth = new TideAudio.Synth();
  const mc = new MimicController();          // menus and solo: whichever phone is sending, else the mouse
  const COLORS = ['#ffb84d', '#5fd6c8', '#ff7a8a', '#a993ff'];
  const SLOT_X = { 1: [0], 2: [-1.6, 1.6], 3: [-3, 0, 3], 4: [-3.9, -1.3, 1.3, 3.9] };
  const rec = (name, data) => { if (window.MimicRec && MimicRec.event) MimicRec.event(name, data); };

  // ------------------------------------------------------------------ storage + settings
  const STORE = 'tidecast.v1';
  const store = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  store.journal = store.journal || {}; store.lobby = store.lobby || { rule: 'big', time: 180 };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* private mode */ } };
  const SETS = [
    { k: 'vol', label: 'Volume', n: 11, fmt: v => v * 10 + '%' },
    { k: 'music', label: 'Music', n: 11, fmt: v => v * 10 + '%' },
    { k: 'sfx', label: 'Effects', n: 11, fmt: v => v * 10 + '%' },
    { k: 'gfx', label: 'Graphics', n: 3, fmt: v => ['Auto', 'High', 'Low'][v] },
    { k: 'hand', label: 'Playing hand', n: 2, fmt: v => ['Right', 'Left'][v] },
    { k: 'release', label: 'Cast release', n: 2, fmt: v => ['Thumb (A)', 'Snap'][v] },
    { k: 'strike', label: 'Strike with', n: 2, fmt: v => ['Jerk', 'Jerk or A'][v] },
  ];
  const cfg = Object.assign({ vol: 8, music: 6, sfx: 10, gfx: 0, hand: 0, release: 0, strike: 0 }, store.settings || {});
  SETS.forEach(s => { cfg[s.k] = clamp(cfg[s.k] | 0, 0, s.n - 1); });
  const NOTES = {
    gfx: () => cfg.gfx === 0 ? 'Auto keeps full detail and lowers the render scale, then shadows, only while the frame rate stays low.' + (dyn.pr < PR_MAX - 1e-3 || dyn.q < 2 ? ' Now ' + Math.round(dyn.pr / PR_MAX * 100) + '%' + (dyn.q < 2 ? ', no shadows.' : '.') : '')
      : cfg.gfx === 1 ? 'Always full resolution with shadows.' : 'Lighter render, no shadows, calmer water.',
    hand: () => 'The hand that holds the rod. In Dock Party each player can switch in the lobby.',
    release: () => cfg.release ? 'Snap: the line flies at the peak of your flick. No button.' : 'Thumb: hold A like a thumb on the spool, flick, let go to release. Timing sets the arc.',
    strike: () => cfg.strike ? 'A press also sets the hook (for players who cannot jerk the rod).' : 'Set the hook with a sharp upward jerk of the rod.',
  };
  function applySettings() {
    synth.setVolumes(cfg.vol / 10, cfg.music / 10, cfg.sfx / 10);
    dyn.t = dyn.n = dyn.sum = 0; dyn.lowN = 0;
    if (cfg.gfx === 1) { setPR(PR_MAX); setQ(2); } else if (cfg.gfx === 2) { setPR(Math.min(dyn.pr, PR_LOW)); setQ(0); } else setQ(2);
  }
  function renderSettings() {
    $('setList').innerHTML = SETS.map(s => `<div class="set-row"><span>${s.label}</span><button class="nav" data-act="set:${s.k}:-1">&#9664;</button><b>${s.fmt(cfg[s.k])}</b><button class="nav" data-act="set:${s.k}:1">&#9654;</button></div>`).join('');
    $('setNote').textContent = (NOTES[lastSet] || NOTES.gfx)();
    $('setRumble').textContent = mc.rumbleReady ? 'Vibration on' : 'Enable vibration';
  }
  let lastSet = 'gfx';
  function changeSetting(k, d) {
    const s = SETS.find(x => x.k === k);
    cfg[k] = clamp(cfg[k] + d, 0, s.n - 1);
    lastSet = k;
    store.settings = Object.assign({}, cfg); save();
    applySettings(); renderSettings(); synth.ui('move');
    if (k === 'hand' && sess) sess.players.forEach(p => { if (p.kind !== 'slot') setPlayerHand(p, cfg.hand ? 'left' : 'right'); });
  }

  // ------------------------------------------------------------------ render scale + quality
  const PR_MAX = Math.min(window.devicePixelRatio || 1, 1.25), PR_MIN = Math.min(PR_MAX, 0.6), PR_LOW = Math.min(PR_MAX, 0.85);
  const dyn = { pr: PR_MAX, t: 0, n: 0, sum: 0, q: 2, lowN: 0, fps: 60 };
  function setPR(pr) { if (Math.abs(pr - dyn.pr) > 1e-3) { dyn.pr = pr; W.renderer.setPixelRatio(pr); W.resize(); } }
  function setQ(q) { if (q !== dyn.q) { dyn.q = q; W.setQuality(q); } }
  function dynResolution(rdt) {
    dyn.t += rdt; dyn.n++; dyn.sum += rdt;
    if (dyn.t < 1) return;
    const fps = dyn.fps = dyn.n / dyn.sum, top = cfg.gfx === 2 ? PR_LOW : PR_MAX;
    dyn.t = dyn.n = dyn.sum = 0;
    if (cfg.gfx === 1) return;
    if (fps < 50) setPR(Math.max(PR_MIN, dyn.pr - (fps < 38 ? 0.15 : 0.07)));
    else if (fps > 58.5) setPR(Math.min(top, dyn.pr + 0.05));
    // still slow at the lowest scale: shadows off (Auto only), back on after a long good stretch
    if (cfg.gfx === 0) {
      if (fps < 45 && dyn.pr <= PR_MIN + 1e-3) { if (++dyn.lowN >= 3) { setQ(0); dyn.lowN = 0; } }
      else if (fps > 59 && dyn.q === 0 && dyn.pr >= top - 1e-3) { if (++dyn.lowN >= 20) { setQ(2); dyn.lowN = 0; } }
      else dyn.lowN = 0;
    }
  }

  // ------------------------------------------------------------------ controllers
  const slotCtrls = [];
  const slotCtrl = n => slotCtrls[n] || (slotCtrls[n] = new MimicController({ slot: n }));
  class KeyPad extends MimicController { _findPad() { return null; } }   // mouse + keyboard only
  let keyPad = null;
  const ctrlMode = c => c && c.source === 'phone' ? (c.mode || 'wand') : 'mouse';
  /** A button's name on this controller (Grip: the volume keys, Wand: A/B, mouse: click/keys). */
  const K = (c, b) => c.keyName(b);
  const kbd = s => '<kbd>' + s + '</kbd>';

  // ------------------------------------------------------------------ state
  let state = 'title', prevState = 'title', settingsFrom = 'title';
  const MENU = new Set(['title', 'lobby', 'align', 'journal', 'settings', 'pause', 'results']);
  let sess = null;
  let soloMode = 'calm';
  const cursor = MimicCursor.create(mc, { visible: () => MENU.has(state), selector: '.nav, .mi, [data-act]' });

  function setScreen(s) {
    if (s !== state) prevState = state;
    state = s;
    for (const id of ['title', 'lobby', 'align', 'journal', 'settings', 'pause', 'results']) $(id).classList.toggle('hidden', id !== s);
    $('hud').classList.toggle('hidden', !(s === 'play' || s === 'pause' || (s === 'settings' && sess && !sess.over)));
    document.body.classList.toggle('playing', s === 'play');
    document.body.classList.toggle('paused', s === 'pause' || s === 'settings');
    hintKey = '';
  }

  // ------------------------------------------------------------------ title scenery: two anglers idling
  let demo = null;
  function buildDemo() {
    if (demo) return;
    demo = [-1.7, 1.7].map((x, i) => {
      const a = W.createAngler(COLORS[i], x);
      a.marker.visible = false;
      return { a, x, bobAt: new T.Vector3(x + (i ? 6 : -9), 0, -(16 + i * 9)), ph: i * 2 };
    });
    W.frameFor(0); W.snapCamera();
  }
  function clearDemo() { if (demo) { demo.forEach(d => W.removeAngler(d.a)); demo = null; } }
  function updateDemo(t) {
    if (!demo) return;
    for (const d of demo) {
      const yaw = Math.atan2(-(d.bobAt.x - d.x), -d.bobAt.z) * 0.6 + Math.sin(t * 0.4 + d.ph) * 0.03, pitch = 0.5 + Math.sin(t * 0.7 + d.ph) * 0.03;
      const q = MimicMath.fromEuler(yaw, pitch, 0);
      const arm = MimicMath.armPose(q, 'right');
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(new T.Quaternion(q.x, q.y, q.z, q.w));
      const bp = d.bobAt.clone(); bp.y = W.bob(bp.x, bp.z, t) + 0.02;
      W.poseAngler(d.a, arm, dir, 0.12, bp.clone().sub(d.a.tip).normalize(), false);
      d.a.bob.position.copy(bp); d.a.bob.scale.setScalar(1 + Math.max(0, W.camera.position.distanceTo(bp) - 6) * 0.075);
      W.drawLine(d.a, bp, 0.5);
    }
  }

  // ------------------------------------------------------------------ fish in the sea
  function spawnFree(opts) {
    const f = L.spawnFish(Math.random, Object.assign({ id: ++sess.fishId }, opts || {}));
    f.shadow = W.makeShadow();
    addModel(f);
    sess.fish.push(f);
    return f;
  }
  /** The fish itself, seen through the clear water near the dock (its shadow carries further). */
  function addModel(f) {
    f.model = W.makeFish(f.sp, true); f.model.scale.setScalar(f.cm / 100); f.model.rotation.order = 'YXZ';
    f.model.traverse(o => { o.castShadow = false; });
    W.scene.add(f.model);
  }
  function dropModel(f) { if (f.model) { W.scene.remove(f.model); f.model = null; } }
  function removeFree(f) {
    sess.fish = sess.fish.filter(x => x !== f);
    if (f.shadow) { W.scene.remove(f.shadow); f.shadow = null; }
    dropModel(f);
  }
  const _m = new T.Vector3();
  function swimModel(f, x, z, hdg, t, depth, speed) {
    const m = f.model; if (!m) return;
    m.visible = W.camera.position.distanceTo(_m.set(x, 0, z)) < 40;
    if (!m.visible) return;
    m.position.set(x, -(depth === undefined ? 0.35 + f.sp.depth * 0.22 : depth), z);
    m.rotation.set(0, -hdg + Math.sin(t * (3 + speed * 4)) * 0.08, 0);
    m.userData.tail.rotation.y = Math.sin(t * (6 + speed * 9) + f.id) * 0.4;
  }
  function fishPop() { return 8 + (sess ? sess.players.length * 2 : 0); }

  // ------------------------------------------------------------------ players
  function newPlayer(i, ctrl, kind, n, hand) {
    const x = SLOT_X[n][i];
    const a = W.createAngler(COLORS[i], x);
    const p = {
      i, mc: ctrl, kind, color: COLORS[i], name: 'P' + (i + 1), x, a, hand: hand || (cfg.hand ? 'left' : 'right'),
      st: 'wait', stT: 0, armed: false, crank: L.createCrank(), jerk: [], prS: 0, jerkCool: 0, strikeT: -9,
      lure: { id: i + 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, inWater: false, age: 0, twitch: 99, moving: 0, claimed: -1 },
      castHold: false, caster: L.createCaster(), waitT: 0, directAt: 4, biteSoft: false, missAt: -9, dangerT: 0, creakT: 0, fight: null, fish: null, holder: null, dip: 0, pop: 0, clickAcc: 0, dragAcc: 0, tickAcc: 0, fxT: 0,
      catches: [], casts: 0, longest: 0, snaps: 0, escapes: 0, rumbleNext: 0, card: null, said: {}, lastFish: null, prevFish: null,
    };
    setPlayerHand(p, p.hand);
    return p;
  }
  function setPlayerHand(p, hand) { p.hand = hand; p.mc.setHand(hand); }
  function rumble(p, s, ms, pat, prio) {
    const now = performance.now();
    if (!prio && now < p.rumbleNext) return;
    p.rumbleNext = now + Math.max(90, ms * 0.85);
    p.mc.rumble(s, ms, pat);
  }
  const base = p => ({ x: p.x, z: 0.1 });
  function setSt(p, st) {
    p.st = st; p.stT = 0;
    if (st === 'ready') { p.caster = L.createCaster(); p.armed = false; }   // A must come up once before a cast
    if (st !== 'ready') W.aim(p.a, 0, false);
  }

  // ------------------------------------------------------------------ sessions
  function startSession(mode, entries, opts) {
    endSession();
    clearDemo();
    const n = entries.length;
    sess = { mode, rule: opts.rule || 'big', dur: opts.dur || 0, t: 0, over: false, overtime: 0, players: [], fish: [], fishId: 0, legend: false, legendT: 0, count: mode === 'calm' ? 0 : 3.2, respawn: 0, ended: false };
    sess.players = entries.map((e, i) => newPlayer(i, e.ctrl, e.kind, n, e.hand));
    for (let i = 0; i < fishPop(); i++) spawnFree();
    W.frameFor(n, sess.players[0].x);
    W.snapCamera();
    buildCards();
    setScreen('play');
    synth.start();
    if (mode === 'calm') { sess.players.forEach(p => setSt(p, 'ready')); banner('Golden Hour', 'no clock · fish as long as you like'); }
    else banner('Get ready', mode === 'party' ? (sess.rule === 'big' ? 'heaviest fish wins' : 'biggest total catch wins') : 'your heaviest fish before sunset');
    rec('session', { mode, players: n, rule: sess.rule, dur: sess.dur });
  }
  function endSession() {
    if (!sess) return;
    sess.players.forEach(p => { W.removeAngler(p.a); if (p.holder) W.scene.remove(p.holder); if (p.fish && p.fish.shadow) W.scene.remove(p.fish.shadow); });
    sess.fish.forEach(f => { if (f.shadow) W.scene.remove(f.shadow); dropModel(f); });
    sess.players.forEach(p => { if (p.fish) dropModel(p.fish); });
    sess = null;
    synth.strain(0);
    clearFloats();
    document.body.classList.remove('catching');
    $('catch').classList.add('hidden');
  }
  let lastStart = null;
  function startSolo(mode) {
    soloMode = mode;
    $('alignMode').textContent = mode === 'calm' ? 'Golden Hour' : 'Sunset Derby';
    renderAlign();
    setScreen('align');
  }
  function goSolo() {
    lastStart = { mode: soloMode, entries: [{ ctrl: mc, kind: 'solo' }], opts: { dur: soloMode === 'derby' ? store.lobby.time || 180 : 0 } };
    startSession(lastStart.mode, lastStart.entries, lastStart.opts);
  }
  function restart() { if (lastStart) startSession(lastStart.mode, lastStart.entries, lastStart.opts); }
  function toTitle() {
    endSession();
    buildDemo();
    W.setDay(0.08);
    setScreen('title');
    renderTitle();
  }

  // ------------------------------------------------------------------ casting
  const _f = new T.Vector3(), _av = new T.Vector3(), _t = new T.Vector3(), _bt = new T.Vector3();
  /** A cast decided by the stroke detector (logic.js stepCaster). */
  function startCast(p, ln) {
    p.castHold = false;
    if (ln.fail === 'weak') { float(p, p.a.tip, 'Flick it!', 'swing the rod over your shoulder and snap it forward', 'bad'); return; }
    p.casts++;
    if (ln.fail === 'backward') {
      setSt(p, 'snag'); p.lure.inWater = false;
      float(p, p.a.tip, 'Tangled behind you', 'finish the flick forward, then let go', 'bad');
      synth.slip(); rumble(p, 0.6, 120, 3, true);
      rec('cast', { p: p.i, backward: true });
      return;
    }
    const l = p.lure;
    l.x = p.a.tip.x; l.y = p.a.tip.y; l.z = p.a.tip.z; l.vx = ln.v.x; l.vy = ln.v.y; l.vz = ln.v.z;
    l.inWater = false; l.claimed = -1; l.launch = ln;
    setSt(p, 'flight');
    synth.whoosh(0.3 + ln.power * 0.7);
    rumble(p, 0.3 + 0.6 * ln.power, 90, 2, true);
    rec('cast', { p: p.i, speed: +ln.speed.toFixed(2), heading: +ln.heading.toFixed(3), elev: +ln.elev.toFixed(3), power: +ln.power.toFixed(2), timing: ln.timing, dt: +ln.dt.toFixed(3) });
  }
  function land(p) {
    const l = p.lure, b = base(p);
    l.y = 0;
    const d = Math.hypot(l.x - b.x, l.z - b.z);
    if (l.z > -1.5) { setSt(p, 'snag'); float(p, p.a.tip, 'Dropped at your feet', 'release later in the swing', 'bad'); synth.slip(); return; }
    l.inWater = true; l.age = 0; l.twitch = 99; l.moving = 0;
    setSt(p, 'drift');
    p.longest = Math.max(p.longest, d);
    W.splash(l.x, l.z, 0.18);
    synth.splash(0.15, d > 25);
    rumble(p, 0.25, 30, 0, true);
    for (const f of sess.fish.slice()) L.splashNear(f, l.x, l.z, Math.random, false);
    float(p, new T.Vector3(l.x, 0.4, l.z), Math.round(d) + ' m', L.castWord(l.launch), 'cast');
    W.ripple(l.x, l.z, 1.6, 2.2);
    p.waitT = 0; p.directAt = (sess.mode === 'calm' ? 2.2 : 3.2) + Math.random() * 1.6;
    rec('land', { p: p.i, d: +d.toFixed(1), x: +l.x.toFixed(2), z: +l.z.toFixed(2) });
  }

  // ------------------------------------------------------------------ hooking + the fight
  function hook(p, q) {
    const f = p.biteFish;
    if (!f) return;
    removeFree(f);
    f.state = 'hooked';
    const b = base(p), l = p.lure;
    const d = Math.max(3, Math.hypot(l.x - b.x, l.z - b.z)), phi = Math.atan2(l.x - b.x, -(l.z - b.z));
    p.fish = f; p.fight = L.createFight(f, d, phi, q, Math.random);
    f.shadow = W.makeShadow(); addModel(f);
    p.holder = new T.Group(); W.scene.add(p.holder);
    const m = W.makeFish(f.sp); const s = f.cm / 100; m.scale.setScalar(s); m.rotation.order = 'YXZ';
    p.fishMesh = m; p.holder.add(m); p.holder.visible = false;
    p.prevFish = null; p.said = {};
    setSt(p, 'fight');
    synth.hookSet(); rumble(p, 1, 140, 0, true);
    W.splash(l.x, l.z, 0.45); synth.splash(0.4, d > 25);
    float(p, new T.Vector3(l.x, 0.6, l.z), 'Hooked!', q > 0.75 ? 'solid hook-set' : q > 0.45 ? 'good hook-set' : 'light hook-set', 'big');
    rec('hook', { p: p.i, sp: f.sp.id, kg: f.kg, q: +q.toFixed(2) });
  }
  function fishPos(p, out) {
    const fs = p.fight, b = base(p);
    return out.set(b.x + Math.sin(fs.phi) * fs.d, 0, b.z - Math.cos(fs.phi) * fs.d);
  }
  function endFight(p, how) {
    const f = p.fish, fs = p.fight;
    const at = fishPos(p, new T.Vector3());
    p.lure.inWater = false; p.lure.claimed = -1; p.lastLost = how;
    if (how === 'landed') {
      const stars = L.stars(f.size);
      const j = store.journal[f.sp.id] = store.journal[f.sp.id] || { n: 0, best: 0, cm: 0 };
      const record = f.kg > j.best;
      j.n++; if (record) { j.best = f.kg; j.cm = f.cm; }
      save();
      const c = { sp: f.sp, kg: f.kg, cm: f.cm, size: f.size, stars, record, n: j.n };
      p.catches.push(c); p.lastCatch = c;
      setSt(p, 'catch');
      p.holder.visible = true; p.holder.scale.setScalar(1);
      if (f.shadow) { W.scene.remove(f.shadow); f.shadow = null; }
      dropModel(f);
      W.splash(at.x, at.z, 0.6); synth.splash(0.5, false);
      synth.fanfare(stars); rumble(p, 0.9, 250, 2, true);
      W.sparkle(p.a.tip.clone().add(new T.Vector3(0, -0.4, 0)));
      if (sess.players.length === 1) { $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go'); showCatchCard(p, c); }
      else showPartyCatch(p, c);
      rec('landed', { p: p.i, sp: f.sp.id, kg: f.kg, secs: +fs.t.toFixed(1) });
    } else {
      setSt(p, 'lost');
      W.scene.remove(p.holder); p.holder = null;
      if (how === 'snap') {
        p.snaps++; synth.snap(); rumble(p, 1, 255, 0, true); W.shake(0.6);
        float(p, p.a.tip, 'Snap!', 'the line was screaming: ease off when it runs', 'bad');
        if (f.shadow) { W.scene.remove(f.shadow); f.shadow = null; }
        dropModel(f);
      } else {
        p.escapes++; synth.slip(); rumble(p, 0.5, 90, 3, true);
        float(p, at.clone().setY(0.5), 'It got away', fs.slackT > 0.5 ? 'too much slack' : 'thrown on the jump', 'bad');
        // back to the sea, wary
        f.state = 'flee'; f.t = 3; f.cool = 12; f.lure = -1; f.x = at.x; f.z = at.z;
        sess.fish.push(f);
      }
      rec('lost', { p: p.i, how, sp: f.sp.id });
    }
    p.fight = null; p.fish = how === 'landed' ? f : null;
  }

  // ------------------------------------------------------------------ the per-player step
  function stepPlayer(p, dt, nowS) {
    const c = p.mc;
    p.stT += dt;
    let f = c.forward, av = c.angularVelocity;
    if (c.mode === 'mouse') ({ f, av } = mouseRod(p, c, dt));
    _f.set(f.x, f.y, f.z); _av.set(av.x, av.y, av.z);
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const pu = L.pitchUpRate(f, av);
    p.jerk.push({ t: nowS, pitch, rate: pu });
    while (p.jerk.length > 2 && nowS - p.jerk[0].t > 0.35) p.jerk.shift();
    const tps = L.stepCrank(p.crank, f, dt);
    const aDown = c.isDown('a');
    if (!p.armed && !aDown) p.armed = true;
    const aPress = p.armed && c.pressed('a'), aRel = p.armed && c.released('a'), aHeld = p.armed && aDown;
    p.prS += (pu - p.prS) * Math.min(1, dt / 0.12);
    p.jerkCool -= dt;
    const jerk = L.detectJerk(p.jerk);

    const l = p.lure;
    let bend = 0.06, bendTo = null, lineTo = null, sag = 0.1, showLine = true, showBob = true;
    l.age += dt; l.twitch += dt;
    l.moving = 0;

    switch (p.st) {
      case 'wait': case 'done':
        break;
      case 'ready': {
        p.castHold = aHeld;
        const ln = L.stepCaster(p.caster, { t: nowS, f: { x: f.x, y: f.y, z: f.z }, a: aHeld }, cfg.release ? 'snap' : 'thumb');
        if (ln) { startCast(p, ln); break; }
        W.aim(p.a, Math.atan2(f.x, -f.z), Math.abs(pitch) < 1.15 && f.z < 0.2, aHeld ? 1 : 0.5 + 0.5 * Math.sin(nowS * 3));
        break;
      }
      case 'flight': {
        for (let k = 0; k < 4; k++) { L.stepFlight(l, dt / 4); if (l.y <= 0) break; }
        p.clickAcc += Math.hypot(l.vx, l.vz) * dt * 1.4;
        while (p.clickAcc > 1) { p.clickAcc--; synth.spool(0.8); }
        sag = 0.02 * p.stT;
        if (l.y <= 0) land(p);
        break;
      }
      case 'drift': case 'bite': {
        const b = base(p), dx = b.x - l.x, dz = b.z - l.z, d = Math.hypot(dx, dz);
        const reel = p.st === 'drift' ? L.reelSpeed(tps, aHeld) : 0;
        if (reel > 0) {
          l.x += dx / d * reel * dt; l.z += dz / d * reel * dt; l.moving = reel;
          p.tickAcc += reel * dt;
          if (p.tickAcc > L.LINE_PER_TURN) { p.tickAcc = 0; rumble(p, 0.12, 16, 0); synth.click(0.6); }
          p.clickAcc += reel * dt * 7;
          while (p.clickAcc > 1) { p.clickAcc--; synth.click(0.5); }
        }
        if (p.st === 'drift' && d < 2.8) {   // reeled all the way in
          l.inWater = false; setSt(p, 'ready'); break;
        }
        const biter = sess.fish.find(fi => fi.lure === l.id);
        if (p.st === 'drift') {
          // nobody biting: send a fish (its shadow is seen closing on the float)
          p.waitT += dt;
          // a fish that dawdles on its way is sent off and another called
          if (l.claimed >= 0) { p.claimT = (p.claimT || 0) + dt; if (p.claimT > 9 && biter && biter.state === 'approach') { L.flee(biter, l.x, l.z); l.claimed = -1; p.claimT = 0; p.directAt = p.waitT + 0.5; } }
          else p.claimT = 0;
          if (l.claimed < 0 && p.waitT > p.directAt) {
            const r = L.directBite(sess.fish, l, Math.random);
            if (r.spawn) L.sendToLure(spawnFree({ x: r.spawn.x, z: r.spawn.z }), l);
            p.directAt = p.waitT + 10;
          }
          if (jerk && jerk.kind === 'strike' && nowS - p.missAt < 0.9) {
            float(p, new T.Vector3(l.x, 0.5, l.z), 'Late by ' + (nowS - p.missAt + 0.1).toFixed(1) + ' s', 'strike the moment it thumps', 'bad');
            p.missAt = -9;
          }
        }
        if (p.st === 'bite') {
          bend = 0.35;
          const strike = (jerk && jerk.kind === 'strike') || (cfg.strike === 1 && aPress);
          if (strike) { hook(p, jerk && jerk.kind === 'strike' ? jerk.strength : 0.55); break; }
          if (jerk && jerk.kind === 'twitch') p.biteSoft = true;
        } else if (jerk && jerk.kind === 'strike' && nowS - p.strikeT > 0.5) {
          p.strikeT = nowS; p.jerkCool = 0.4;
          if (biter && biter.state === 'nibble') {
            if (Math.random() < 0.7 - biter.sp.curiosity * 0.3) { L.flee(biter, l.x, l.z); l.claimed = -1; float(p, new T.Vector3(l.x, 0.5, l.z), 'Too early!', 'wait for the thump', 'bad'); }
            else float(p, new T.Vector3(l.x, 0.5, l.z), 'Easy...', 'it is still nibbling');
          }
          popLure(p, 0.35, 1);
        } else if (jerk && p.jerkCool <= 0) {
          p.jerkCool = 0.4; popLure(p, 0.22, 0.6);
        }
        sag = 0.15 + d * 0.012;
        break;
      }
      case 'fight': {
        const fs = p.fight;
        const m = p.crank.m || f;
        const reel = L.reelSpeed(tps, aHeld);
        const line0 = fs.line;
        const ev = L.stepFight(fs, { reel, rodDir: m, pitch: Math.asin(clamp(m.y, -1, 1)) }, dt, Math.random);
        fightFx(p, fs, ev, reel, line0, dt, nowS);
        if (fs.over) { endFight(p, fs.over); break; }
        const fp = fishPos(p, _t);
        l.x = fp.x; l.z = fp.z;
        bend = Math.min(1.1, fs.T * 1.05 + 0.05);
        sag = Math.max(0, fs.line - fs.d) * 0.35 + Math.max(0, 0.6 - fs.T) * 0.02 * fs.d;
        break;
      }
      case 'catch': {
        showBob = false;
        const s = p.lastCatch, len = s.cm / 100;
        p.holder.position.copy(p.a.tip).add(new T.Vector3(0, -0.12, 0));
        p.holder.rotation.y += dt * 0.9;
        p.fishMesh.rotation.set(Math.PI / 2 - 0.05, 0, Math.sin(nowS * 9) * 0.12);
        p.fishMesh.position.set(0, -len / 2, 0);
        p.fishMesh.userData.tail.rotation.y = Math.sin(nowS * 14) * 0.35;
        lineTo = p.holder.position; sag = 0;
        bend = Math.min(0.6, 0.1 + s.kg / 40);
        if (p.stT > (sess.players.length === 1 ? 7 : 3.6)) finishCatch(p);
        break;
      }
      case 'lost': case 'snag':
        showLine = false; showBob = false;
        if (p.stT > 1.6) setSt(p, 'ready');
        break;
    }
    if (p.st !== 'ready') p.castHold = false;

    // the float and the line
    p.dip = Math.max(0, p.dip - dt * 4);
    p.pop = Math.max(0, p.pop - dt * 3);
    if (p.st === 'ready' || p.st === 'wait' || p.st === 'done') {
      // the rig hangs from the tip, swinging with the rod
      _bt.copy(p.a.tip).add(new T.Vector3(Math.sin(nowS * 1.7 + p.i) * 0.03, -0.55, 0));
      lineTo = _bt; sag = 0;
    } else if (p.st === 'flight') { _bt.set(l.x, l.y, l.z); lineTo = _bt; }
    else if (p.st === 'drift' || p.st === 'bite' || p.st === 'fight') {
      const y = p.st === 'bite' ? -0.2 : W.bob(l.x, l.z, W.time) + 0.02 - p.dip * 0.06 + p.pop * 0.05 - (p.st === 'fight' ? 0.03 + Math.min(0.08, p.fight ? p.fight.T * 0.08 : 0) : 0);
      _bt.set(l.x, y, l.z); lineTo = _bt;
      if (p.st === 'fight' && p.fight && p.fight.air && p.fishMesh) lineTo = p.holder.position;
    }
    if (lineTo) bendTo = _t.copy(lineTo).sub(p.a.tip).normalize();
    W.poseAngler(p.a, c.arm, _f, bend, bendTo, p.hand === 'left');
    if (p.st === 'catch') { p.holder.position.copy(p.a.tip).add(new T.Vector3(0, -0.12, 0)); lineTo = p.holder.position; }
    if (p.st === 'ready' || p.st === 'wait' || p.st === 'done') { _bt.copy(p.a.tip).add(new T.Vector3(Math.sin(nowS * 1.7 + p.i) * 0.03, -0.55, 0)); lineTo = _bt; }
    if (p.st === 'fight' && p.fight && p.fight.air) lineTo = p.holder.position;
    W.drawLine(p.a, lineTo || p.a.tip, sag, showLine && !!lineTo, p.st === 'fight' && p.fight ? p.fight.T : p.st === 'bite' ? 0.5 : 0);
    p.a.bob.visible = showBob && !!lineTo && p.st !== 'bite';
    if (lineTo && p.a.bob.visible) {
      p.a.bob.position.copy(lineTo);
      if (p.st === 'fight') p.a.bob.position.y = Math.max(lineTo.y, -0.06);
    }
    // a marker over each float so everyone finds their own in the glare
    const mk = p.a.marker;
    mk.visible = sess.players.length > 1 && (p.st === 'drift' || p.st === 'bite' || p.st === 'fight');
    if (mk.visible) {
      const dCam = W.camera.position.distanceTo(p.a.bob.position);
      mk.position.set(l.x, 0.35 + dCam * 0.02, l.z); mk.scale.setScalar(0.22 + dCam * 0.012);
    }
    p.a.bob.scale.setScalar(1 + Math.max(0, W.camera.position.distanceTo(p.a.bob.position) - 6) * 0.1);
    // the halo: soft while waiting, flashes on a nibble, flares on the strike
    p.halo = Math.max(0, (p.halo || 0) - dt * 2.5);
    p.a.halo.material.opacity = (p.st === 'drift' ? 0.32 : 0.15) + p.halo * 0.8;
    p.a.halo.scale.setScalar(0.45 + p.halo * 0.9);
  }

  /**
   * The mouse stand-in (testing, or a keyboard player in the lobby) only turns about 35 degrees up
   * and down, too little to swing a rod over the shoulder; stretch its pitch so a sweep from the
   * top of the screen to the bottom is a full overhead cast. Phones are never touched by this.
   */
  function mouseRod(p, c, dt) {
    const pitch = clamp(0.55 + c.pitch * 2.6, -0.6, 2.2), yaw = c.yaw;
    const f = { x: -Math.cos(pitch) * Math.sin(yaw), y: Math.sin(pitch), z: -Math.cos(pitch) * Math.cos(yaw) };
    const pf = p.mouseF || f;
    const ax = L.cross(pf, f), sn = Math.hypot(ax.x, ax.y, ax.z), ang = Math.atan2(sn, L.dot(pf, f));
    const k = sn > 1e-9 ? ang / sn / Math.max(dt, 1e-3) : 0;
    const raw = { x: ax.x * k, y: ax.y * k, z: ax.z * k }, o = p.mouseAv || raw;
    p.mouseAv = { x: o.x + (raw.x - o.x) * 0.5, y: o.y + (raw.y - o.y) * 0.5, z: o.z + (raw.z - o.z) * 0.5 };
    p.mouseF = f;
    return { f, av: p.mouseAv };
  }

  function popLure(p, pull, lvl) {
    const l = p.lure, b = base(p), d = Math.hypot(b.x - l.x, b.z - l.z) || 1;
    l.x += (b.x - l.x) / d * pull; l.z += (b.z - l.z) / d * pull;
    l.twitch = 0; p.pop = 1;
    W.ripple(l.x, l.z, 0.45, 1.2); synth.plip(lvl);
  }

  /** Sound, rumble, spray and words for the fight, from the step's events. */
  function fightFx(p, fs, ev, reel, line0, dt, nowS) {
    const at = fishPos(p, new T.Vector3());
    const far = 1 + fs.d / 40;   // spray and leaps read from the dock even far out
    for (const e of ev) {
      if (e === 'jump') {
        W.splash(at.x, at.z, 0.7 * far); synth.splash(0.6, fs.d > 25); rumble(p, 0.8, 120, 3, true);
        say(p, 'jump', 'Jump! Bow the rod', p.fish.sp.name, true);
      } else if (e === 'splash') { W.splash(at.x, at.z, 0.8 * far); synth.splash(0.7, fs.d > 25); }
      else if (e === 'burst') say(p, 'burst' + Math.floor(fs.t), 'Not done yet!', 'tire it out first', true);
      else if (e === 'phase:charge') say(p, 'charge', 'Coming at you!', 'reel fast');
    }
    // the drag sings while a run peels line off; the reel clicks while you crank
    const payout = Math.max(0, fs.line - line0) / dt;
    if (payout > 0.2) {
      p.dragAcc += payout * dt * 9;
      while (p.dragAcc > 1) { p.dragAcc--; synth.drag(Math.min(1, 0.4 + fs.T * 0.6)); }
    }
    p.clickAcc += reel * dt * 7;
    while (p.clickAcc > 1) { p.clickAcc--; synth.click(0.5); }
    // the line in your hand: a hum that rises with the load, hammering pulses in the danger zone
    if (fs.danger) rumble(p, 1, 120, 3);
    else if (fs.T > 0.15) rumble(p, 0.1 + 0.75 * Math.pow(fs.T, 1.3), 140, 1);
    if (fs.danger) {
      if (!p.inDanger) { p.inDanger = true; if (nowS - p.dangerT > 4) { p.dangerT = nowS; float(p, at.clone().setY(0.9), 'Line screaming!', fs.slipping ? 'stop reeling, raise the rod off the fish' : 'ease off', 'bad'); } }
      p.creakT -= dt;
      if (p.creakT <= 0) { p.creakT = 0.32 - Math.min(0.2, fs.strain * 0.2); synth.creak(Math.min(1, 0.5 + fs.strain)); }
    } else p.inDanger = false;
    if (fs.slipping) { p.dragAcc += dt * 26; while (p.dragAcc > 1) { p.dragAcc--; synth.drag(1); } }
    // the water: head-shakes splash, runs leave a wake, and the leap
    p.fxT -= dt;
    const vis = W.camera.position.distanceTo(at) < 70;
    if (p.fxT <= 0 && vis) {
      if (fs.phase === 'thrash') { p.fxT = 0.22; W.splash(at.x + (Math.random() - 0.5) * 0.3, at.z, 0.25 * far); if (Math.random() < 0.5) synth.splash(0.1, true); }
      else if (fs.phase === 'run' || fs.phase === 'burst' || fs.phase === 'charge') { p.fxT = 0.28; W.ripple(at.x, at.z, (0.5 + p.fish.size * 0.5) * far, 1.4); }
      else { p.fxT = 0.7; W.ripple(at.x, at.z, 0.3, 1.2); }
    }
    // shadow follows the fish, nose along its motion
    const sh = p.fish.shadow;
    if (sh) {
      if (p.prevFish) { const dx = at.x - p.prevFish.x, dz = at.z - p.prevFish.z; if (dx * dx + dz * dz > 1e-6) p.fishHdg = Math.atan2(dx, -dz); }
      const len = Math.max(0.55, p.fish.cm / 100 * 1.4) * (1 + fs.d / 45);
      sh.position.set(at.x, 0.03, at.z); sh.rotation.y = -(p.fishHdg || 0); sh.scale.setScalar(len);
      sh.material.opacity = fs.air ? 0.12 : 0.5; sh.visible = true;
    }
    p.prevFish = at.clone();
    if (p.fish.model) { p.fish.model.visible = !fs.air; if (!fs.air) swimModel(p.fish, at.x, at.z, p.fishHdg || 0, nowS, 0.3, fs.phase === 'run' || fs.phase === 'thrash' ? 1.5 : 0.6); }
    // airborne: the fish arcs out of the water
    if (p.holder) {
      p.holder.visible = !!fs.air;
      if (fs.air) {
        const k = clamp((fs.pt - 0.15) / 0.7, 0, 1), sc = 1 + fs.d / 25, hgt = (0.5 + p.fish.size * 1.1) * sc;
        p.holder.position.set(at.x, Math.sin(Math.PI * k) * hgt, at.z);
        p.holder.rotation.set(0, 0, 0); p.holder.scale.setScalar(sc);
        p.fishMesh.position.set(0, 0, 0);
        p.fishMesh.rotation.set((0.5 - k) * 1.8, -(p.fishHdg || 0), Math.sin(nowS * 20) * 0.3);
        p.fishMesh.userData.tail.rotation.y = Math.sin(nowS * 30) * 0.5;
      }
    }
    synthStrainMax = Math.max(synthStrainMax, fs.T);
  }
  let synthStrainMax = 0;
  /** A message over the fish, at most once per key per fight. */
  function say(p, key, text, sub, big) {
    if (p.said[key]) return;
    p.said[key] = true;
    float(p, fishPos(p, new T.Vector3()).setY(0.8), text, sub, big ? 'big' : '');
  }
  function finishCatch(p) {
    if (p.holder) { W.scene.remove(p.holder); p.holder = null; }
    p.fish = null;
    $('catch').classList.add('hidden'); document.body.classList.remove('catching');
    if (p.card) { const pc = p.card.querySelector('.pcatch'); if (pc) pc.remove(); }
    setSt(p, sess.overtime > 0 ? 'done' : 'ready');
  }

  // ------------------------------------------------------------------ the session step
  const lures = () => sess.players.map(p => p.lure);
  function stepSession(dt, nowS) {
    const S = sess;
    if (S.count > 0) {
      const before = Math.ceil(S.count);
      S.count -= dt;
      const now = Math.ceil(S.count);
      if (now !== before && now > 0) { banner(String(now), ''); synth.beep(false); }
      if (S.count <= 0) { S.players.forEach(p => setSt(p, 'ready')); banner('Lines in!', S.mode === 'party' ? 'fish until the sun sets' : 'the sun is going down'); synth.beep(true); }
    } else S.t += dt;
    const timed = S.dur > 0;
    const remaining = timed ? S.dur - S.t : Infinity;
    W.setDay(timed ? 0.05 + 0.95 * clamp(S.t / S.dur, 0, 1) : 0.08 + 0.85 * clamp(S.t / 900, 0, 1));

    // free fish
    const ls = lures();
    for (const f of S.fish.slice()) {
      const ev = L.stepFish(f, dt, ls, Math.random);
      for (const e of ev) fishEvent(e);
      if (f.shadow) {
        const dCam = W.camera.position.distanceTo(_t.set(f.x, 0, f.z));
        const len = Math.max(0.6, f.cm / 100 * 1.6) * (1 + dCam / 40);
        f.shadow.position.set(f.x, 0.03, f.z); f.shadow.scale.setScalar(len);
        f.shadow.rotation.y = -f.h + Math.sin(f.phase) * 0.12;
        swimModel(f, f.x, f.z, f.h, nowS, undefined, f.v);
        f.shadow.material.opacity = (f.state === 'strike' ? 0.62 : 0.46) * clamp(1.3 - dCam / 70, 0.2, 1);
      }
      // fish give themselves away: a ring of nervous water now and then, rarely a leap
      f.sign = (f.sign === undefined ? Math.random() * 5 : f.sign) - dt;
      if (f.sign <= 0 && f.state !== 'nibble' && f.state !== 'strike') {
        f.sign = 3 + Math.random() * 5;
        if (Math.random() < 0.12) { W.splash(f.x, f.z, 0.15 + f.size * 0.3); synth.splash(0.08, true); }
        else W.ripple(f.x, f.z, 0.35 + f.size * 0.6, 1.8);
      }
    }
    if (S.fish.length < fishPop()) { S.respawn -= dt; if (S.respawn <= 0) { S.respawn = 4; spawnFree({ z: -44 - Math.random() * 12 }); } }
    // the legend rises near the end of a round, or now and then at dusk in Golden Hour
    const legendDue = timed ? remaining < 55 && remaining > 15 : S.t > 300 && S.t - S.legendT > 240;
    if (legendDue && !S.fish.some(f => f.sp.legendary) && !S.players.some(p => p.fish && p.fish.sp.legendary) && (timed ? !S.legend : true)) {
      S.legend = true; S.legendT = S.t;
      spawnFree({ legendary: true, x: (Math.random() - 0.5) * 30, z: -26 - Math.random() * 14 });
      banner('Something golden stirs', 'out past the glare'); synth.legend();
    }

    synthStrainMax = 0;
    for (const p of S.players) {
      if (p.kind !== 'solo') p.mc.update();   // solo rides mc, updated by the frame
      stepPlayer(p, dt, nowS);
    }
    synth.strain(synthStrainMax);

    // the horn: whoever has a fish on gets to finish
    if (timed && remaining <= 0 && !S.over) {
      if (!S.overtime) {
        S.overtime = 0.001; synth.horn();
        S.players.forEach(p => { if (p.st !== 'fight' && p.st !== 'catch') { p.lure.inWater = false; setSt(p, 'done'); } });
        banner('Sunset!', S.players.some(p => p.st === 'fight') ? 'land what is on the line' : 'lines out of the water');
      }
      S.overtime += dt;
      S.players.forEach(p => { if (p.st === 'ready' || p.st === 'lost' || p.st === 'snag' || p.st === 'drift' || p.st === 'flight') { p.lure.inWater = false; setSt(p, 'done'); } });
      if ((S.players.every(p => p.st === 'done') && S.overtime > 2.2) || S.overtime > 30) finishSession();
    }
  }
  function fishEvent(e) {
    const p = sess.players.find(q => q.lure.id === (e.lure && e.lure.id));
    if (!p) return;
    const l = p.lure;
    if (e.type === 'nibble') {
      if (p.st !== 'drift') return;
      p.dip = 1; p.halo = 0.6; synth.plip(0.8); W.ripple(l.x, l.z, 0.3, 0.9);
      rumble(p, 0.18, 25, 0, true);
      rec('nibble', { p: p.i, sp: e.fish.sp.id });
    } else if (e.type === 'strike') {
      if (p.st !== 'drift') { e.fish.state = 'wander'; l.claimed = -1; e.fish.lure = -1; return; }
      setSt(p, 'bite'); p.biteFish = e.fish; p.biteSoft = false; p.halo = 1.4;
      synth.strike(); rumble(p, 1, 255, 1, true);
      setTimeout(() => { if (p.st === 'bite') rumble(p, 1, 220, 3, true); }, 270);
      W.splash(l.x, l.z, 0.55); W.ripple(l.x, l.z, 1.2, 1.4);
      float(p, new T.Vector3(l.x, 0.6, l.z), '!', '', 'big');
      rec('strike', { p: p.i, sp: e.fish.sp.id, window: e.fish.sp.window });
    } else if (e.type === 'miss') {
      if (p.st === 'bite') {
        setSt(p, 'drift'); p.biteFish = null; p.missAt = performance.now() / 1000; p.waitT = 0; p.directAt = 3;
        float(p, new T.Vector3(l.x, 0.5, l.z), p.biteSoft ? 'Too soft!' : 'Missed it', p.biteSoft ? 'snap the rod up, hard and fast' : 'jerk the rod up the moment it thumps', 'bad');
        W.ripple(l.x, l.z, 0.4, 1);
      }
    }
  }
  function finishSession() {
    const S = sess;
    S.over = true;
    renderResults();
    setScreen('results');
  }

  // ------------------------------------------------------------------ HUD
  function buildCards() {
    const box = $('cards');
    box.innerHTML = '';
    box.classList.toggle('solo', sess.players.length === 1);
    for (const p of sess.players) {
      const el = document.createElement('div');
      el.className = 'card'; el.style.setProperty('--c', p.color);
      el.innerHTML = `<div class="top"><span class="who">${sess.players.length > 1 ? p.name : 'YOU'}</span><span class="best"></span></div>
        <div class="what"></div><div class="bars"><div class="blabel"><span>line</span><span class="lv"></span></div><div class="bar tension"><i></i></div><div class="bar energy"><i></i></div></div><div class="hint"></div>`;
      box.appendChild(el); p.card = el; p.cardKey = '';
    }
    $('board').innerHTML = '';
    $('rule').textContent = sess.mode === 'party' ? (sess.rule === 'big' ? 'Heaviest fish wins' : 'Biggest total catch wins') : sess.mode === 'derby' ? 'Sunset Derby · heaviest fish' : '';
  }
  const fishWord = kg => kg >= 15 ? 'A monster!' : kg >= 5 ? 'A big one!' : kg >= 1.2 ? 'A good fish' : 'Fish on';
  function cardState(p) {
    const c = p.mc, a = K(c, 'a'), fs = p.fight;
    const reelHow = 'circle the tip or hold ' + kbd(a);
    switch (p.st) {
      case 'wait': return { what: 'Get ready', hint: 'Point the rod out to sea · ' + kbd(K(c, 'center')) + ' aligns' };
      case 'ready': return { what: p.castHold ? 'Thumb on the spool...' : 'Ready to cast', cls: p.castHold ? 'hot' : '',
        hint: cfg.release ? 'Swing the rod back and snap it forward: harder goes further' : p.castHold ? 'Swing back, snap it forward, let go: harder goes further' : 'Point where you want it, hold ' + kbd(a) + ', flick, let go' };
      case 'flight': return { what: 'Line out...', hint: '' };
      case 'drift': {
        const d = Math.hypot(p.lure.x - p.x, p.lure.z);
        return { what: 'Waiting · ' + Math.round(d) + ' m', hint: 'Reel: ' + reelHow + ' · a small flick twitches the float' };
      }
      case 'bite': return { what: 'STRIKE!', cls: 'hot', hint: 'Jerk the rod up now' + (cfg.strike ? ' (or ' + kbd(a) + ')' : '') };
      case 'fight': {
        let hint = 'Reel when it rests · lean the rod against its runs', cls = '';
        if (fs.danger) { hint = fs.slipping ? 'Line screaming! Stop reeling, lift the rod off the fish' : 'Too tight! Ease off'; cls = 'bad'; }
        else if (fs.air) { hint = 'Jump! Lower the rod'; cls = 'hot'; }
        else if (fs.slackT > 0.4) { hint = 'Slack line! Reel in'; cls = 'bad'; }
        else if (fs.phase === 'run' || fs.phase === 'burst') hint = "It's running: let it, rod up and to the side";
        else if (fs.phase === 'rest') hint = 'It rests: reel, or pump the rod back and reel down';
        else if (fs.phase === 'charge') hint = 'Coming at you: reel fast';
        else if (fs.phase === 'thrash') hint = 'Head-shakes: keep it steady';
        return { what: fishWord(p.fish.kg) + ' · ' + Math.round(fs.d) + ' m', cls, hint, bars: true };
      }
      case 'catch': return { what: p.lastCatch.sp.name + ' · ' + p.lastCatch.kg.toFixed(2) + ' kg', cls: 'hot', hint: sess.players.length === 1 ? kbd(a) + ' back to fishing' : '' };
      case 'lost': return { what: p.lastLost === 'snap' ? 'Line snapped' : 'It got away', cls: 'bad', hint: 'New rig coming up' };
      case 'snag': return { what: 'Tangled', cls: 'bad', hint: 'Let go of ' + kbd(a) + ' as the rod comes forward' };
      case 'done': return { what: 'Lines out', hint: '' };
    }
    return { what: '', hint: '' };
  }
  function renderHud() {
    const S = sess;
    // clock
    const clock = $('clock');
    if (S.dur > 0) {
      const rem = Math.max(0, S.dur - S.t);
      $('clockText').textContent = S.count > 0 ? Math.floor(S.dur / 60) + ':' + String(S.dur % 60).padStart(2, '0') : Math.floor(rem / 60) + ':' + String(Math.floor(rem % 60)).padStart(2, '0');
      $('clockSub').textContent = S.overtime ? 'overtime' : 'until sunset';
      clock.classList.toggle('low', rem < 30);
    } else {
      $('clockText').textContent = 'Golden hour';
      const tot = S.players[0].catches;
      $('clockSub').textContent = tot.length ? tot.length + (tot.length === 1 ? ' fish · ' : ' fish · ') + tot.reduce((a, c) => a + c.kg, 0).toFixed(1) + ' kg' : 'no clock';
      clock.classList.remove('low');
    }
    // board
    if (S.players.length > 1) {
      const rk = L.rank(S.players, S.rule);
      const html = rk.map(r => { const p = S.players[r.i]; return `<div class="br" style="--c:${p.color}"><b>${p.name}</b><span>${p.catches.length} fish</span><em>${r.score.toFixed(2)} kg</em></div>`; }).join('');
      if ($('board').dataset.k !== html) { $('board').innerHTML = html; $('board').dataset.k = html; }
    } else if (S.mode === 'derby') {
      const best = S.players[0].catches.reduce((a, c) => Math.max(a, c.kg), 0);
      const html = `<div class="br" style="--c:${COLORS[0]}"><b>&#9733;</b><span>Heaviest today</span><em>${best.toFixed(2)} kg</em><small>Your record: ${(store.derbyBest || 0).toFixed(2)} kg</small></div>`;
      if ($('board').dataset.k !== html) { $('board').innerHTML = html; $('board').dataset.k = html; }
    } else if ($('board').dataset.k !== 'calm') { $('board').innerHTML = ''; $('board').dataset.k = 'calm'; }
    // the danger zone pulses red at the screen's edge (solo: the whole screen is yours)
    let danger = 0;
    for (const p of S.players) if (p.fight && p.fight.danger) danger = Math.max(danger, 0.35 + p.fight.strain * 0.65);
    $('strain').style.opacity = (danger * (S.players.length > 1 ? 0.45 : 1) * (0.7 + 0.3 * Math.sin(performance.now() / 70))).toFixed(2);
    // cards
    for (const p of S.players) {
      const cs = cardState(p);
      const bestKg = p.catches.reduce((a, c) => Math.max(a, c.kg), 0);
      const best = p.catches.length ? `<b>${(S.rule === 'total' ? p.catches.reduce((a, c) => a + c.kg, 0) : bestKg).toFixed(2)} kg</b> · ${p.catches.length} fish` : 'no fish yet';
      const key = cs.what + '|' + (cs.cls || '') + '|' + cs.hint + '|' + best + '|' + !!cs.bars;
      if (key !== p.cardKey) {
        p.cardKey = key;
        const w = p.card.querySelector('.what'); w.textContent = cs.what; w.className = 'what ' + (cs.cls || '');
        p.card.querySelector('.hint').innerHTML = cs.hint;
        p.card.querySelector('.best').innerHTML = best;
        p.card.classList.toggle('idle', !cs.bars);
      }
      if (!cs.bars && p.card.dataset.idle !== '1') {
        p.card.dataset.idle = '1';
        p.card.querySelector('.bar.tension i').style.width = '0%'; p.card.querySelector('.bar.energy i').style.width = '0%';
        p.card.querySelector('.bar.tension').classList.remove('danger', 'slack');
        p.card.querySelector('.lv').textContent = 'no fish on';
      }
      if (cs.bars && p.fight) {
        p.card.dataset.idle = '';
        const fs = p.fight, tb = p.card.querySelector('.bar.tension');
        const tw = clamp(fs.T, 0, 1.1) / 1.1 * 100;
        tb.firstChild.style.width = tw.toFixed(1) + '%';
        tb.firstChild.style.setProperty('--w', (100 / Math.max(0.01, tw / 100)).toFixed(0) + '%');
        tb.classList.toggle('danger', fs.T > 0.92 || fs.strain > 0.25);
        tb.classList.toggle('slack', fs.slackT > 0.3);
        p.card.querySelector('.bar.energy i').style.width = (fs.S * 100).toFixed(1) + '%';
        p.card.querySelector('.lv').textContent = fs.slackT > 0.3 ? 'slack' : fs.T > 0.92 ? 'breaking' : 'fish energy below';
      }
    }
  }

  // floating words over the water
  const floats = [];
  function float(p, at, text, sub, cls) {
    const el = document.createElement('div');
    el.className = 'fl ' + (cls || '');
    el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    if (p && sess && sess.players.length > 1) el.style.color = cls === 'bad' ? '' : p.color;
    $('floats').appendChild(el);
    floats.push({ el, at: at.clone(), t: 0, life: cls === 'big' ? 1.6 : 1.9 });
  }
  function updateFloats(dt) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      if (f.t >= f.life) { f.el.remove(); floats.splice(i, 1); continue; }
      const s = W.toScreen(f.at);
      const k = f.t / f.life;
      f.el.style.left = clamp(s.x, 80, innerWidth - 80) + 'px';
      f.el.style.top = clamp(s.y - k * 40, 60, innerHeight - 160) + 'px';
      f.el.style.opacity = (k < 0.1 ? k / 0.1 : k > 0.75 ? (1 - k) / 0.25 : 1).toFixed(2);
    }
  }
  function clearFloats() { floats.forEach(f => f.el.remove()); floats.length = 0; }
  let bannerT = 0;
  function banner(main, sub) {
    const b = $('banner');
    b.querySelector('.b-main').textContent = main; b.querySelector('.b-sub').textContent = sub || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    bannerT = 2.2;
  }
  function starsHtml(n) { return [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); }
  function showCatchCard(p, c) {
    $('catchKicker').textContent = c.sp.legendary ? 'LEGENDARY' : c.stars >= 3 ? 'TROPHY' : 'LANDED';
    $('catchName').textContent = c.sp.name;
    $('catchStars').innerHTML = starsHtml(c.stars);
    $('catchKg').textContent = c.kg.toFixed(2);
    $('catchCm').textContent = c.cm + ' cm';
    $('catchBlurb').textContent = c.sp.blurb;
    $('catchRecord').textContent = c.n === 1 ? 'New species in your journal' : c.record ? 'Personal best' : '';
    $('catchNext').innerHTML = kbd(K(p.mc, 'a')) + ' back to fishing';
    $('catch').classList.remove('hidden');
    document.body.classList.add('catching');
  }
  function showPartyCatch(p, c) {
    const old = p.card.querySelector('.pcatch'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'pcatch';
    el.innerHTML = `<div class="n">${c.sp.name}</div><div class="k">${c.kg.toFixed(2)}<em>kg</em></div>`;
    p.card.appendChild(el);
  }

  // ------------------------------------------------------------------ menus
  function keyRows(c) {
    const g = { a: 'Vol Down', b: 'Vol Up', center: 'CENTRE' };
    const live = c && c.connected && c.source === 'phone';
    const wandK = b => live && ctrlMode(c) === 'wand' ? c.keyName(b) : { a: 'A', b: 'B', center: 'Center' }[b];
    const gripK = b => live && ctrlMode(c) === 'grip' ? c.keyName(b) : g[b];
    return `<span></span><b>Wand</b><b>Grip</b>
      <span>Cast (hold, let go)</span><span>${kbd(wandK('a'))}</span><span>${kbd(gripK('a'))}</span>
      <span>Reel (or circle the tip)</span><span>hold ${kbd(wandK('a'))}</span><span>hold ${kbd(gripK('a'))}</span>
      <span>Pause</span><span>${kbd(wandK('b'))}</span><span>${kbd(gripK('b'))}</span>
      <span>Align to the sea</span><span>${kbd(wandK('center'))}</span><span>${kbd(gripK('center'))}</span>`;
  }
  function renderTitle() {
    const n = L.SPECIES.filter(s => store.journal[s.id]).length;
    $('journalSub').textContent = n + ' of ' + L.SPECIES.length + ' species';
    $('keys').innerHTML = keyRows(mc);
    const a = mc.connected ? K(mc, 'a') : 'A';
    $('howCast').innerHTML = cfg.release ? 'Swing the rod back over your shoulder and snap it forward; harder goes further.' : 'Hold ' + kbd(a) + ', swing back, snap the rod forward and let go. Harder goes further; aim with where the rod stops.';
    $('howReel').innerHTML = 'Circle the rod tip like a crank, or hold ' + kbd(a) + '.';
    renderRumble();
  }
  function renderRumble() {
    const on = mc.rumbleReady;
    $('rumbleBtn').textContent = on ? 'Vibration on' : 'Vibration off: click to set up';
    $('rumbleBtn').classList.toggle('on', on);
  }
  function requestRumble(ask) {
    mc.enableRumble(ask ? { ask: true } : undefined).then(ok => { renderRumble(); if (state === 'settings') renderSettings(); if (ok) mc.rumble(0.6, 40, 0); }, renderRumble);
  }
  function renderAlign() {
    const c = mc, ph = c.connected && c.source === 'phone';
    const mode = ctrlMode(c);
    $('alignText').innerHTML = ph
      ? `Hold the phone like the rod's handle, top edge toward the tip${mode === 'wand' ? ', ' + kbd(c.keyName('a')) + ' under your thumb' : ''}. Point it at the horizon and press ${kbd(c.keyName('center'))}.`
      : 'No phone paired: the mouse plays the rod. Hold the left button, flick the mouse up then down, let go. Pair Mimic (Wand) for the real thing.';
  }

  // journal
  function drawFishIcon(cv, sp, known) {
    const w = cv.width = 240, h = cv.height = 80, g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    const L0 = sp.flat ? 0.62 : 0.78, len = w * L0, x0 = (w - len) / 2, cy = h / 2, bh = Math.min(h * 0.8, len * sp.look.h * (sp.flat ? 2.6 : 1));
    g.save();
    if (known) {
      const gr = g.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
      gr.addColorStop(0, sp.look.back); gr.addColorStop(0.45, sp.look.side); gr.addColorStop(1, sp.look.belly);
      g.fillStyle = gr;
    } else g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    if (sp.flat) {
      g.moveTo(x0, cy); g.quadraticCurveTo(x0 + len * 0.4, cy - bh / 2, x0 + len * 0.75, cy); g.quadraticCurveTo(x0 + len * 0.4, cy + bh / 2, x0, cy);
      g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + len * 0.72, cy); g.lineTo(x0 + len * 1.15, cy - 2); g.stroke();
    } else {
      g.moveTo(x0, cy);
      g.bezierCurveTo(x0 + len * 0.15, cy - bh * 0.62, x0 + len * 0.62, cy - bh * 0.5, x0 + len * 0.82, cy - bh * 0.06);
      g.lineTo(x0 + len, cy - bh * 0.42); g.lineTo(x0 + len * 0.95, cy); g.lineTo(x0 + len, cy + bh * 0.42); g.lineTo(x0 + len * 0.82, cy + bh * 0.06);
      g.bezierCurveTo(x0 + len * 0.62, cy + bh * 0.5, x0 + len * 0.15, cy + bh * 0.55, x0, cy);
      g.fill();
      g.beginPath(); g.moveTo(x0 + len * 0.3, cy - bh * 0.45); g.lineTo(x0 + len * 0.4, cy - bh * 0.72); g.lineTo(x0 + len * 0.62, cy - bh * 0.4); g.fill();
      if (known) { g.fillStyle = '#111'; g.beginPath(); g.arc(x0 + len * 0.1, cy - bh * 0.08, Math.max(2, bh * 0.07), 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }
  function renderJournal() {
    const n = L.SPECIES.filter(s => store.journal[s.id]).length;
    $('journalCount').textContent = n + ' of ' + L.SPECIES.length + ' caught';
    const box = $('species');
    box.innerHTML = '';
    for (const sp of L.SPECIES) {
      const j = store.journal[sp.id];
      const el = document.createElement('div');
      el.className = 'sp' + (j ? '' : ' unknown') + (sp.legendary ? ' legend' : '');
      const cv = document.createElement('canvas');
      drawFishIcon(cv, sp, !!j);
      el.appendChild(cv);
      el.insertAdjacentHTML('beforeend', j
        ? `<div class="n">${sp.name}</div><div class="s">best ${j.best.toFixed(2)} kg · ${j.n} caught</div><div class="m">${sp.blurb}</div>`
        : `<div class="n">${sp.legendary ? 'Something golden' : 'Not yet caught'}</div><div class="s">${sp.kg[0]}-${sp.kg[1]} kg</div><div class="m">${sp.legendary ? 'Only ever seen near sundown.' : 'Keep casting.'}</div>`);
      box.appendChild(el);
    }
  }

  // results
  function renderResults() {
    const S = sess, solo = S.players.length === 1;
    const rk = L.rank(S.players, S.mode === 'party' ? S.rule : 'big');
    $('resKicker').textContent = S.mode === 'calm' ? 'Golden Hour · session' : 'The sun is down';
    if (solo) {
      const p = S.players[0], best = rk[0].score;
      let title = p.catches.length ? p.catches.length + (p.catches.length === 1 ? ' fish' : ' fish') + ' in the bucket' : 'Quiet water today';
      if (S.mode === 'derby') {
        const prev = store.derbyBest || 0;
        if (best > prev) { store.derbyBest = best; save(); title = best > 0 ? 'New derby record: ' + best.toFixed(2) + ' kg' : title; }
        else title = best > 0 ? 'Heaviest: ' + best.toFixed(2) + ' kg (record ' + prev.toFixed(2) + ')' : title;
      }
      $('resTitle').textContent = title;
    } else {
      const w = S.players[rk[0].i];
      $('resTitle').textContent = rk[0].score > 0 ? (rk.length > 1 && rk[1].score === rk[0].score && rk[1].n === rk[0].n ? 'A dead heat!' : w.name + ' takes the dock') : 'Nobody caught a thing';
    }
    const box = $('podium');
    box.innerHTML = '';
    rk.forEach((r, place) => {
      const p = S.players[r.i];
      const big = p.catches.slice().sort((a, b) => b.kg - a.kg)[0];
      const total = p.catches.reduce((a, c) => a + c.kg, 0);
      const el = document.createElement('div');
      el.className = 'pc' + (place === 0 && r.score > 0 && !solo ? ' win' : '');
      el.style.setProperty('--c', p.color);
      el.innerHTML = `<div class="rk"><b>${solo ? 'YOU' : r.score > 0 ? place + 1 + ['st', 'nd', 'rd', 'th'][place] : p.name}</b><span>${solo || r.score <= 0 ? '' : p.name}</span></div>
        <div class="score">${r.score.toFixed(2)}<em>kg ${S.mode === 'party' && S.rule === 'total' ? 'total' : 'heaviest'}</em></div>
        <div class="fish">${big ? big.sp.name + ' · ' + big.kg.toFixed(2) + ' kg' : 'no catch'}</div>`;
      if (big) { const cv = document.createElement('canvas'); drawFishIcon(cv, big.sp, true); el.appendChild(cv); }
      el.insertAdjacentHTML('beforeend', `<div class="stats"><span>Fish <b>${p.catches.length}</b></span><span>Total <b>${total.toFixed(1)} kg</b></span><span>Casts <b>${p.casts}</b></span><span>Longest <b>${Math.round(p.longest)} m</b></span><span>Snapped <b>${p.snaps}</b></span><span>Got away <b>${p.escapes}</b></span></div>`);
      box.appendChild(el);
    });
  }

  // ------------------------------------------------------------------ party lobby
  const lobby = { st: null, keyA: false, keyDown: false, keyB: false, guard: 0, hands: {} };
  function openLobby() {
    lobby.st = LB.createLobby(4, 1);
    lobby.guard = 0.35;
    renderLobbyOpts();
    setScreen('lobby');
  }
  function lobbyInputs() {
    const list = [];
    const n = Math.min(4, MimicController.all().length);
    for (let i = 0; i < n; i++) {
      const c = slotCtrl(i);
      c.update();
      if (c.connected && c.source === 'phone') list.push({ id: 'phone' + i, kind: 'slot', ctrl: c, a: c.pressed('a'), b: c.pressed('b'), aDown: c.isDown('a'), one: c.pressed('one') });
    }
    if (!keyPad) keyPad = new KeyPad({ slot: 0 });
    keyPad.update();
    list.push({ id: 'keys', kind: 'keys', ctrl: keyPad, a: lobby.keyA, b: lobby.keyB, aDown: lobby.keyDown, one: lobby.keyH });
    lobby.keyA = lobby.keyB = lobby.keyH = false;
    return list;
  }
  function lobbyFrame(dt) {
    const inputs = lobbyInputs();
    if (lobby.guard > 0) { lobby.guard -= dt; inputs.forEach(p => { p.a = p.b = false; }); }
    const ev = LB.stepLobby(lobby.st, inputs, dt);
    for (const e of ev) {
      if (e.type === 'join') { synth.ui('ok'); if (lobby.hands[e.id] === undefined) lobby.hands[e.id] = cfg.hand ? 'left' : 'right'; }
      else if (e.type === 'leave') synth.ui('back');
      else if (e.type === 'back') { synth.ui('back'); toTitle(); return; }
      else if (e.type === 'start') { startParty(inputs); return; }
    }
    for (const p of inputs) if (p.one && lobby.st.slots.some(s => s && s.id === p.id)) { lobby.hands[p.id] = lobby.hands[p.id] === 'left' ? 'right' : 'left'; synth.ui('move'); }
    renderLobby(inputs);
  }
  function renderLobby(inputs) {
    const slots = lobby.st.slots;
    let html = '';
    slots.forEach((s, i) => {
      const inp = s && inputs.find(p => p.id === s.id);
      const c = inp && inp.ctrl;
      if (s) {
        const mode = s.kind === 'keys' ? 'Mouse + keys' : ctrlMode(c) === 'grip' ? 'Grip' : 'Wand';
        const hand = lobby.hands[s.id] === 'left' ? 'Left' : 'Right';
        const sp = c ? clamp(c.angularSpeed / 12, 0, 1) : 0;
        const help = s.kind === 'keys' ? 'Mouse is the rod · hold Space or click to cast · H hand · Backspace leaves'
          : `Swing to test · ${kbd(c.keyName('center'))} aligns · ${kbd(c.keyName('one'))} hand · ${kbd(c.keyName('b'))} leaves`;
        html += `<div class="slot joined" style="--c:${COLORS[i]}"><div class="hat"></div><div class="tag">P${i + 1}</div><div class="st">${mode} · ${hand} hand</div><div class="meter"><i style="width:${(sp * 100).toFixed(0)}%"></i></div><div class="help">${help}</div></div>`;
      } else {
        html += `<div class="slot" style="--c:${COLORS[i]}"><div class="hat"></div><div class="tag">P${i + 1}</div><div class="st">Press A to join</div><div class="help">Wand ${kbd('A')} · Grip ${kbd('Vol Down')}<br>keyboard ${kbd('Space')}</div></div>`;
      }
    });
    if ($('slots').dataset.k !== html) { $('slots').innerHTML = html; $('slots').dataset.k = html; }
    const n = slots.filter(Boolean).length;
    const phones = inputs.filter(p => p.kind === 'slot').length;
    const st = n ? `${n} on the dock. A joined player <b>holds A</b> to start <span class="hold"><i style="width:${(lobby.st.hold / LB.HOLD_TO_START * 100).toFixed(0)}%"></i></span>`
      : phones ? `${phones} phone${phones > 1 ? 's' : ''} paired. Press A on each phone to join.` : 'Pair phones in Mimic (Wand or Grip) or scan the code, then press A.';
    if ($('lobbyStatus').innerHTML !== st) $('lobbyStatus').innerHTML = st;
    $('lobbyStart').classList.toggle('disabled', !n);
  }
  function renderLobbyOpts() {
    document.querySelectorAll('#optRule .nav').forEach(b => b.classList.toggle('sel', b.dataset.act === 'rule:' + store.lobby.rule));
    document.querySelectorAll('#optTime .nav').forEach(b => b.classList.toggle('sel', b.dataset.act === 'time:' + store.lobby.time));
  }
  function startParty(inputs) {
    const slots = lobby.st.slots.filter(Boolean);
    if (!slots.length) return;
    const entries = slots.map(s => {
      const inp = inputs.find(p => p.id === s.id);
      return { ctrl: inp ? inp.ctrl : keyPad, kind: s.kind, hand: lobby.hands[s.id] || (cfg.hand ? 'left' : 'right') };
    });
    lastStart = { mode: 'party', entries, opts: { rule: store.lobby.rule, dur: store.lobby.time } };
    synth.ui('go');
    startSession('party', entries, lastStart.opts);
  }

  // ------------------------------------------------------------------ actions
  function act(a) {
    synth.start();
    const [k, v, w] = a.split(':');
    switch (k) {
      case 'calm': case 'derby': synth.ui('go'); startSolo(k); break;
      case 'party': synth.ui('go'); openLobby(); break;
      case 'journal': synth.ui('ok'); renderJournal(); setScreen('journal'); break;
      case 'settings': synth.ui('ok'); settingsFrom = state; renderSettings(); setScreen('settings'); break;
      case 'setBack': synth.ui('back'); setScreen(settingsFrom); if (settingsFrom === 'title') renderTitle(); break;
      case 'set': changeSetting(v, +w); break;
      case 'rumble': requestRumble(false); break;
      case 'rumbleAsk': requestRumble(true); break;
      case 'title': synth.ui('back'); toTitle(); break;
      case 'rule': store.lobby.rule = v; save(); renderLobbyOpts(); synth.ui('move'); break;
      case 'time': store.lobby.time = +v; save(); renderLobbyOpts(); synth.ui('move'); break;
      case 'lobbyStart': if (lobby.st && lobby.st.slots.some(Boolean)) startParty(lobbyInputs()); break;
      case 'alignGo': synth.ui('go'); goSolo(); break;
      case 'resume': resume(); break;
      case 'restart': synth.ui('go'); restart(); break;
      case 'end': synth.ui('back'); if (sess) finishSession(); break;
      case 'again': synth.ui('go'); restart(); break;
    }
  }
  function pause() { if (state !== 'play') return; synth.ui('back'); synth.strain(0); setScreen('pause'); $('pauseEnd').textContent = sess.mode === 'calm' ? 'End session' : 'End round'; }
  function resume() { if (!sess) return; synth.ui('ok'); setScreen('play'); sess.players.forEach(p => { p.armed = false; }); }

  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (el) { act(el.dataset.act); return; }
  });
  let rumbleAsked = false;
  addEventListener('pointerdown', () => { synth.start(); if (!rumbleAsked && state === 'title') { rumbleAsked = true; requestRumble(false); } });
  addEventListener('keydown', e => {
    synth.start();
    const k = e.key;
    if (state === 'lobby') {
      if (k === ' ') { if (!lobby.keyDown) lobby.keyA = true; lobby.keyDown = true; e.preventDefault(); }
      if (k === 'Backspace') lobby.keyB = true;
      if (k === 'h' || k === 'H') lobby.keyH = true;
      if (k === 'Escape') toTitle();
      if (k === 'Enter') act('lobbyStart');
      return;
    }
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (state === 'play') pause();
      else if (state === 'pause') resume();
      else if (state === 'settings') act('setBack');
      else if (state !== 'title') toTitle();
    }
    if (k === 'Enter' && state === 'align') act('alignGo');
  });
  addEventListener('keyup', e => { if (e.key === ' ') lobby.keyDown = false; });

  /** Phone buttons outside play: B backs out, Center on the align screen starts. */
  function phoneMenus() {
    if (!mc.connected || mc.source !== 'phone') return;
    if (state === 'align' && mc.pressed('center')) act('alignGo');
    else if (mc.pressed('b')) {
      if (state === 'pause') resume();
      else if (state === 'settings') act('setBack');
      else if (state === 'journal' || state === 'align' || state === 'results') toTitle();
    }
  }
  function playButtons() {
    for (const p of sess.players) {
      const c = p.mc;
      if (c.source === 'phone' && (c.pressed('b') || c.pressed('home') || c.pressed('plus'))) { pause(); return; }
      if (p.st === 'catch' && sess.players.length === 1 && p.stT > 1.2 && c.pressed('a')) finishCatch(p);
    }
  }

  // ------------------------------------------------------------------ badge + hint bar
  let chipKey = '', hintKey = '';
  function updateChip() {
    const n = MimicController.all().length;
    const key = mc.source + '|' + mc.mode + '|' + n;
    if (key === chipKey) return;
    chipKey = key;
    const on = mc.connected;
    $('chip').classList.toggle('on', on);
    const dev = ctrlMode(mc) === 'grip' ? 'Grip' : 'Wand';
    $('chip').querySelector('span').textContent = on ? (n > 1 ? n + ' phones' : dev + ' connected') : 'No phone: mouse';
    const ct = $('titleCtrl');
    ct.classList.toggle('on', on);
    ct.querySelector('span').textContent = on ? dev + ' connected' + (n > 1 ? ' · ' + n + ' phones' : '') : 'No phone yet: the mouse stands in';
    ct.querySelector('small').textContent = on ? 'Point at a button and press ' + mc.keyName('a') + '. Hold it like a rod.' : 'Open Mimic, pick Wand (or Grip), pair over Bluetooth.';
    if (state === 'title') renderTitle();
    if (state === 'align') renderAlign();
  }
  function renderHint() {
    const ph = mc.connected && mc.source === 'phone';
    const kb = (k, t) => '<span><kbd>' + k + '</kbd>' + t + '</span>';
    let h = '';
    if (state === 'title') h = ph ? kb('Point', 'choose') + kb(mc.keyName('a'), 'select') : kb('Click', 'choose');
    else if (state === 'lobby') h = kb('A', 'join') + kb('B', 'leave') + kb('Hold A', 'start');
    else if (state === 'align') h = ph ? kb(mc.keyName('center'), 'aim set, start') + kb(mc.keyName('b'), 'back') : kb('Enter', 'start') + kb('Esc', 'back');
    else if (state === 'journal' || state === 'results') h = ph ? kb('Point', 'choose') + kb(mc.keyName('a'), 'select') + kb(mc.keyName('b'), 'back') : kb('Click', 'choose') + kb('Esc', 'back');
    else if (state === 'pause') h = ph ? kb(mc.keyName('a'), 'select') + kb(mc.keyName('b'), 'resume') : kb('Click', 'choose') + kb('Esc', 'resume');
    else if (state === 'settings') h = ph ? kb(mc.keyName('a'), 'change') + kb(mc.keyName('b'), 'back') : kb('Click', 'change') + kb('Esc', 'back');
    const key = state + '|' + h;
    if (key === hintKey) return;
    hintKey = key;
    $('mhint').innerHTML = h;
    $('mhint').classList.toggle('hidden', !h);
    $('pauseTip').innerHTML = ph ? 'Rod drifted off the sea? Point it out and press ' + kbd(mc.keyName('center')) + '.' : 'The mouse plays the rod: hold the left button, flick, let go.';
  }

  // ------------------------------------------------------------------ the camera director (solo)
  // Follows the cast out, settles on the float, pushes in when a fish comes to it and harder on the
  // strike, frames the line and the fish through the fight, and holds the catch up for a close-up.
  // Dock Party keeps one wide shared view.
  const shot = { pos: new T.Vector3(), look: new T.Vector3(), key: null, fov: 0, speed: 2 };
  const _k = new T.Vector3(), _F = new T.Vector3();
  function cameraShot() {
    if (!sess || sess.over || sess.players.length !== 1) return null;
    const p = sess.players[0], V = W.view, base = W.baseFov, l = p.lure;
    shot.key = null; shot.fov = base; shot.speed = 2; shot.pos.copy(V.pos); shot.look.copy(V.look);
    if (p.st === 'catch' && p.holder) {
      const len = p.lastCatch.cm / 100, d = 0.8 + len * 1.5;
      _F.copy(p.holder.position); _F.y -= len / 2;
      shot.pos.set(_F.x - d * 0.55, _F.y + d * 0.12, _F.z + d * 0.85); shot.look.copy(_F);
      shot.key = _k.set(_F.x - d * 0.4, _F.y + 0.3, _F.z + d * 0.6); shot.speed = 2.5;
    } else if (p.st === 'flight') {
      shot.look.lerp(_F.set(l.x, l.y, l.z), 0.55); shot.pos.y += 0.5; shot.speed = 3;
    } else if (p.st === 'drift' || p.st === 'bite') {
      _F.set(l.x, 0, l.z);
      const dF = W.camera.position.distanceTo(_F), bite = p.st === 'bite', near = l.claimed >= 0;
      shot.look.lerp(_F, bite ? 0.95 : near ? 0.85 : 0.6);
      shot.fov = bite ? Math.max(16, base * 14 / Math.max(14, dF)) : near ? Math.max(20, base * 20 / Math.max(20, dF)) : Math.max(30, base * 30 / Math.max(30, dF));
      shot.speed = bite ? 4 : near ? 1.4 : 1.1;
    } else if (p.st === 'fight' && p.fight) {
      fishPos(p, _F);
      const dF = W.camera.position.distanceTo(_F);
      shot.look.copy(p.a.tip).lerp(_F, 0.72); shot.look.y = Math.min(shot.look.y, 0.8);
      shot.fov = Math.min(base, Math.max(38, base * 26 / Math.max(26, dF * 0.9)));
      shot.pos.x += Math.sin(p.fight.phi) * 0.8; shot.pos.y += 0.4;
      shot.speed = 1.6;
    } else return null;
    return shot;
  }
  let perfT = 0, perfN = 0, perfSum = 0;
  /** Frame rate into the play recording every 10 s, so a session can be judged afterwards. */
  function perfLog(dt) {
    if (state !== 'play') return;
    perfT += dt; perfN++; perfSum += dt;
    if (perfT < 10) return;
    rec('perf', { fps: +(perfN / perfSum).toFixed(1), pr: +dyn.pr.toFixed(2), q: dyn.q });
    perfT = perfN = perfSum = 0;
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), titleT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    const nowS = now / 1000;
    dynResolution(dt);
    mc.update(now);
    updateChip();
    renderHint();
    const clicked = cursor.update();
    if (!clicked) phoneMenus();
    synth.tick(dt, sess && sess.players.some(p => p.st === 'fight') ? 1 : 0.3);

    if (state === 'lobby') lobbyFrame(dt);
    if (sess && state === 'play') { playButtons(); if (state === 'play') stepSession(dt, nowS); renderHud(); }
    if (state === 'title' || state === 'lobby' || state === 'journal' || (state === 'settings' && !sess) || state === 'align') {
      titleT += dt;
      buildDemo();
      updateDemo(titleT);
      W.frameFor(0);
    }
    W.update(state === 'pause' ? 0 : dt);
    W.updateCamera(state === 'pause' ? 0 : dt, cameraShot());
    perfLog(dt);
    updateFloats(dt);
    W.render();
  }

  addEventListener('resize', () => W.resize());
  addEventListener('blur', () => { if (state === 'play') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

  applySettings();
  buildDemo();
  W.setDay(0.08);
  setScreen('title');
  renderTitle();
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------ test hooks
  window.__tc = {
    get state() { return state; }, get sess() { return sess; }, get dyn() { return dyn; }, cfg, store, act, W, L,
    setScreen, startSolo, goSolo, openLobby, finishSession, pause, toTitle,
    /** Put a fish on the given player's line right now (screenshots / bots). */
    forceBite(i, species) {
      const p = sess.players[i || 0];
      if (p.st !== 'drift') return false;
      const f = spawnFree({ species: species || 'bass', x: p.lure.x + 0.3, z: p.lure.z });
      f.lure = p.lure.id; p.lure.claimed = f.id; f.state = 'strike'; f.t = 9;
      fishEvent({ type: 'strike', fish: f, lure: p.lure });
      return true;
    },
    forceHook(i, q) { const p = sess.players[i || 0]; if (p.st === 'bite') hook(p, q || 0.7); return p.st; },
    forceLand(i) { const p = sess.players[i || 0]; if (p.fight) { p.fight.S = 0.05; p.fight.d = p.fight.line = 2.5; L.beginPhase(p.fight, 'rest', Math.random); p.fight.pDur = 9; } },
    castAt(i, d, heading) {   // drop the float at d metres, heading rad (as if cast)
      const p = sess.players[i || 0];
      const l = p.lure; l.x = p.x + Math.sin(heading || 0) * d; l.z = 0.1 - Math.cos(heading || 0) * d; l.y = 0;
      l.launch = { timing: 'clean', power: 0.6 }; land(p);
    },
  };
})();
