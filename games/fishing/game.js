/*
 * Tidecast: Depths - game loop, players, the cast / dive / bite / fight / catch cycle, the tackle
 * box, menus, HUD. The rod is the phone, 1:1: mc.forward is the rod's direction, its tilt steers
 * the lure under water. The rules live in logic.js and depths.js (tested in Node); this file wires
 * motion, sound, rumble and pictures.
 */
(function () {
  'use strict';
  const T = THREE, L = TideLogic, LB = TideLobby, D = TideDepths;
  const $ = id => document.getElementById(id);
  const clamp = L.clamp;
  const W = TideScene.createWorld($('gl'));
  const deep = TideDeep.create(W);
  const synth = new TideAudio.Synth();
  const mc = new MimicController();          // menus and solo: whichever phone is sending, else the mouse
  const COLORS = ['#ffb84d', '#5fd6c8', '#ff7a8a', '#a993ff'];
  const SLOT_X = { 1: [0], 2: [-1.6, 1.6], 3: [-3, 0, 3], 4: [-3.9, -1.3, 1.3, 3.9] };
  const rec = (name, data) => { if (window.MimicRec && MimicRec.event) MimicRec.event(name, data); };
  const TAU = Math.PI * 2;
  const PLANE_Z = -26;                         // Dock Party: the glass of the aquarium

  // ------------------------------------------------------------------ storage + settings
  // v2 = Depths: coins, gear, bait and the journal. A v1 journal and settings are carried over.
  const STORE = 'tidecast.v2';
  const store = (() => {
    let raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { /* private mode */ }
    const s = D.loadSave(raw);
    if (!raw) {
      try {
        const v1 = JSON.parse(localStorage.getItem('tidecast.v1')) || {};
        if (v1.settings) s.settings = v1.settings;
        if (v1.lobby) s.lobby = Object.assign(s.lobby, v1.lobby);
        for (const k of Object.keys(v1.journal || {})) if (D.byId(k)) s.journal[k] = Object.assign({ n: 0, best: 0, cm: 0, minD: 999, maxD: 0, baits: {} }, v1.journal[k]);
      } catch (e) { /* nothing to carry over */ }
    }
    return s;
  })();
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
  let state = 'title', prevState = 'title', settingsFrom = 'title', shopFrom = 'title';
  const SCREENS = ['title', 'lobby', 'align', 'journal', 'settings', 'pause', 'results', 'shop'];
  const MENU = new Set(SCREENS);
  let sess = null;
  let soloMode = 'calm';
  const cursor = MimicCursor.create(mc, { visible: () => MENU.has(state) || choosing(), selector: '.nav, .mi, [data-act]' });

  function setScreen(s) {
    if (s !== state) prevState = state;
    state = s;
    for (const id of SCREENS) $(id).classList.toggle('hidden', id !== s);
    $('hud').classList.toggle('hidden', !(s === 'play' || s === 'pause' || ((s === 'settings' || s === 'shop') && sess && !sess.over)));
    document.body.classList.toggle('playing', s === 'play');
    document.body.classList.toggle('paused', s === 'pause' || s === 'settings' || s === 'shop');
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

  // ------------------------------------------------------------------ the depths: fish around the lures
  const gear = () => D.gearStats(store);
  const VIS = 1.5;   // fish are drawn half as big again as they are: bold shapes that read through the haze
  function nearestCover(x, y, z, maxD) {
    let best = null, bd = maxD || 1e9;
    for (const c of sess.covers) { const d = Math.hypot(c.x - x, c.y - y, c.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function spawnDeep(sp, x, y, z, single) {
    const list = sp.school && !single ? D.spawnSchool(sp, x, y, z, Math.random) : [D.spawnFish(sp, x, y, z, Math.random)];
    for (const f of list) {
      if (sp.ambush) f.cover = nearestCover(x, y, z, 16);
      f.model = deep.addFish(sp, sp.school > 0 || sp.cls === 1);
      f.model.scale.setScalar(Math.max(0.2, f.cm / 100) * VIS); f.model.rotation.order = 'YXZ';
      sess.deepFish.push(f);
    }
    return list[0];
  }
  function dropDeep(f) {
    sess.deepFish = sess.deepFish.filter(x => x !== f);
    f.state = 'gone';
    if (f.model) { deep.removeObj(f.model); f.model = null; }
  }
  /**
   * Pose a fish model. With o.mouth the point given is its mouth (a hooked fish hangs off the hook
   * by the mouth, never by its middle); o.face turns it toward a direction; o.tired / o.thrash animate.
   */
  function placeModel(f, dt, x, y, z, vx, vy, vz, speed, o) {
    const m = f.model; if (!m) return;
    o = o || {};
    const hs = Math.hypot(vx, vz);
    if (o.face) f.mh = Math.atan2(o.face.x, -o.face.z);
    else if (hs > 0.05) f.mh = Math.atan2(vx, -vz);
    const h = f.mh !== undefined ? f.mh : f.h, pt = o.face ? clamp(Math.atan2(o.face.y, Math.hypot(o.face.x, o.face.z)), -0.9, 0.9) : clamp(vy * 0.35, -0.6, 0.6);
    m.rotation.set(pt, -h, 0);
    if (o.mouth) {
      const half = 0.5 * m.scale.x, c = Math.cos(pt);
      m.position.set(x - Math.sin(h) * c * half, y - Math.sin(pt) * half, z + Math.cos(h) * c * half);
    } else m.position.set(x, y, z);
    m.swim(dt, speed, o);
  }
  const lureList = () => sess.players.filter(p => p.lureD).map(p => p.lure);
  const _k2 = new T.Vector3(), _m = new T.Vector3();
  function stepDeep(dt, nowS) {
    const S = sess, divers = S.players.filter(p => p.lureD && (p.st === 'dive' || p.st === 'bite' || p.st === 'fight'));
    const hooked = S.players.filter(p => p.st === 'fight' && p.fish && p.fpos).map(p => ({ lure: p.lure.id, fish: p.fish, x: p.fpos.x, y: p.fpos.y, z: p.fpos.z,
      struggle: p.fight.phase === 'run' || p.fight.phase === 'thrash' ? 1 : 0.4 }));
    if (divers.length) {
      // keep the water around every diver alive: groups (a school counts once) within reach
      S.spawnT -= dt;
      const groups = S.deepFish.filter(f => !f.leader).length;
      const shallow = divers.every(p => (p.st === 'fight' && p.fpos ? -p.fpos.y : p.lureD.depth) < 8);
      if (S.spawnT <= 0 && groups < Math.min(12, (shallow ? 3 : 7) * divers.length)) {
        S.spawnT = 0.5;
        const p = divers[(Math.random() * divers.length) | 0], c = p.st === 'fight' && p.fpos ? p.fpos : p.lureD;
        const depth = clamp(-c.y + (Math.random() - 0.5) * 16, 1, D.FLOOR - 2);
        // most new fish turn up ahead of the lure, where the camera looks, the rest anywhere around it
        const ahead = !S.party && p.lureD && Math.random() < 0.65;
        const a = ahead ? p.lureD.heading + (Math.random() - 0.5) * 1.6 : Math.random() * TAU, r = ahead ? 6 + Math.random() * 8 : 7 + Math.random() * 9;
        const sp = D.pickSpecies(depth, Math.random, { bait: p.bait, luck: store.luck, legendary: Math.random() < 0.03 + store.luck * 0.01 });
        if (sp) spawnDeep(sp, c.x + Math.sin(a) * r, -depth, S.party ? PLANE_Z + (Math.random() - 0.5) * 4 : c.z - Math.cos(a) * r);
      }
      for (const f of S.deepFish.slice()) {
        if (f.state === 'hooked') continue;
        if (!divers.some(p => { const c = p.fpos && p.st === 'fight' ? p.fpos : p.lureD; return Math.hypot(f.x - c.x, f.y - c.y, f.z - c.z) < 50 && Math.abs(f.y - c.y) < 30; })) dropDeep(f);
      }
    } else if (S.deepFish.length) S.deepFish.slice().forEach(dropDeep);
    const fp = divers[0] ? (divers[0].st === 'fight' && divers[0].fpos ? divers[0].fpos : divers[0].lureD) : null;
    const world = { lures: lureList(), fish: S.deepFish, hooked, focus: fp };
    for (const f of S.deepFish.slice()) {
      if (f.state === 'hooked' || f.state === 'gone') continue;
      if (S.party) f.z += (PLANE_Z + (f.id % 5 - 2) * 0.8 - f.z) * Math.min(1, dt * 1.5);
      for (const e of D.stepFish(f, dt, world, Math.random)) deepEvent(e, nowS);
      if (f.state === 'gone') continue;
      const biter = S.players.find(q => q.st === 'bite' && q.biteFish === f && q.lureD);
      if (biter) {
        // it has the lure: mouth on the hook, shaking its head, pulling the line
        const lu = biter.lureD, fx = lu.x - f.x, fy = lu.y - f.y, fz = lu.z - f.z, fl = Math.hypot(fx, fy, fz) || 1;
        f.x += fx * Math.min(1, dt * 6); f.y += fy * Math.min(1, dt * 6); f.z += fz * Math.min(1, dt * 6);
        placeModel(f, dt, lu.x, lu.y, lu.z, 0, 0, 0, 2.5, { mouth: true, face: { x: fx / fl, y: fy / fl, z: fz / fl }, thrash: true });
      } else placeModel(f, dt, f.x, f.y, f.z, f.vx, f.vy, f.vz, f.speed);
    }
  }
  function playerOfLure(id) { return sess.players.find(q => q.lure.id === id); }
  function deepEvent(e, nowS) {
    const p = playerOfLure(typeof e.lure === 'number' ? e.lure : e.lure && e.lure.id);
    if (!p) return;
    const lu = p.lureD;
    if (e.type === 'nibble') {
      if (p.st !== 'dive') return;
      p.halo = 0.7; synth.plip(0.8); deep.bubble(lu, 3, 0.2);
      rumble(p, 0.18, 25, 0, true);
      rec('nibble', { p: p.i, sp: e.fish.sp.id, depth: Math.round(lu.depth) });
    } else if (e.type === 'strike') {
      if (p.st !== 'dive') { e.fish.state = 'swim'; p.lure.claimed = -1; e.fish.lure = -1; return; }
      setSt(p, 'bite'); p.biteFish = e.fish; p.biteSoft = false; p.halo = 1.4;
      synth.strike(); rumble(p, 1, 255, 1, true);
      setTimeout(() => { if (p.st === 'bite') rumble(p, 1, 220, 3, true); }, 270);
      deep.bubble(lu, 12, 0.6);
      float(p, new T.Vector3(lu.x, lu.y + 0.6, lu.z), '!', 'pull back!', 'big');
      rec('bite', { p: p.i, sp: e.fish.sp.id, depth: Math.round(lu.depth), window: e.fish.sp.window });
    } else if (e.type === 'miss') {
      if (p.st === 'bite' && p.biteFish === e.fish) {
        setSt(p, 'dive'); p.biteFish = null; p.missAt = nowS; p.waitT = 0; p.directAt = 3;
        float(p, new T.Vector3(lu.x, lu.y + 0.5, lu.z), p.biteSoft ? 'Too soft!' : 'Missed it', p.biteSoft ? 'pull the rod back, hard and fast' : 'pull back the moment it thumps', 'bad');
      }
    } else if (e.type === 'chase') {
      if (p.st !== 'fight') return;
      p.hunter = e.fish;
      float(p, p.fpos.clone().add(new T.Vector3(0, 1.2, 0)), 'Something big is coming...', 'reel hard or lose your catch', 'bad');
      rumble(p, 0.7, 200, 2, true);
      rec('chase', { p: p.i, sp: e.fish.sp.id, prey: e.prey.sp.id });
    } else if (e.type === 'eat') {
      if (p.st === 'fight' && p.fish === e.prey) swallowed(p, e.fish);
    }
  }

  // ------------------------------------------------------------------ players
  function newPlayer(i, ctrl, kind, n, hand) {
    const x = SLOT_X[n][i];
    const a = W.createAngler(COLORS[i], x);
    const p = {
      i, mc: ctrl, kind, color: COLORS[i], name: 'P' + (i + 1), x, a, hand: hand || (cfg.hand ? 'left' : 'right'),
      st: 'wait', stT: 0, armed: false, crank: L.createCrank(), jerk: [], prS: 0, jerkCool: 0, strikeT: -9,
      lure: { id: i + 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, inWater: false, active: false, age: 0, twitch: 99, moving: 0, claimed: -1, light: 0, bait: null },
      castHold: false, caster: L.createCaster(), waitT: 0, directAt: 4, biteSoft: false, missAt: -9, dangerT: 0, creakT: 0, fight: null,
      fish: null, holder: null, halo: 0, clickAcc: 0, dragAcc: 0, tickAcc: 0, fxT: 0, lureD: null, lv: null, ul: null, band: 0, zone: null,
      catches: [], casts: 0, longest: 0, snaps: 0, escapes: 0, coins: 0, deepest: 0, rumbleNext: 0, card: null, said: {}, choice: 1,
    };
    p.bait = D.currentBait(store);
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
    sess = { mode, rule: opts.rule || 'big', dur: opts.dur || 0, t: 0, over: false, overtime: 0, players: [], deepFish: [], spawnT: 0, count: mode === 'calm' ? 0 : 3.2,
      party: mode === 'party', covers: [], coinsAtStart: store.coins };
    sess.players = entries.map((e, i) => newPlayer(i, e.ctrl, e.kind, n, e.hand));
    if (sess.party) { deep.center(0, PLANE_Z); sess.covers = deep.worldCovers(); }
    W.frameFor(n, sess.players[0].x);
    W.snapCamera();
    buildCards();
    setScreen('play');
    synth.start();
    if (mode === 'calm') { sess.players.forEach(p => setSt(p, 'ready')); banner('Tidecast: Depths', 'cast, then steer the lure down with the rod'); }
    else banner('Get ready', mode === 'party' ? (sess.rule === 'big' ? 'heaviest fish wins' : 'biggest total catch wins') : 'your heaviest fish before sunset');
    rec('session', { mode, players: n, rule: sess.rule, dur: sess.dur, gear: Object.assign({}, store.gear), coins: store.coins });
  }
  function endSession() {
    if (!sess) return;
    sess.players.forEach(p => { endDive(p, null); W.removeAngler(p.a); if (p.holder) W.scene.remove(p.holder); if (p.fish && p.fish.model) deep.removeObj(p.fish.model); });
    sess.deepFish.slice().forEach(dropDeep);
    sess = null;
    deep.setActive(false); W.setDay(0.08, true);
    synth.strain(0);
    clearFloats();
    document.body.classList.remove('catching');
    $('catch').classList.add('hidden');
  }
  let lastStart = null;
  function startSolo(mode) {
    soloMode = mode;
    $('alignMode').textContent = mode === 'calm' ? 'Tidecast: Depths' : 'Sunset Derby';
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
    W.setDay(0.08, true);
    setScreen('title');
    renderTitle();
  }

  // ------------------------------------------------------------------ casting and the splash
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
  /** The splash: the lure goes under and the dive begins, neutral = how the rod is held right now. */
  function land(p, f) {
    const l = p.lure, d = Math.hypot(l.x - p.x, l.z - 0.1);
    if (l.z > -1.5) { setSt(p, 'snag'); float(p, p.a.tip, 'Dropped at your feet', 'snap the flick forward harder', 'bad'); synth.slip(); return; }
    const g = gear();
    if (sess.party) { l.z = PLANE_Z; l.x = clamp(l.x, -9, 9); }
    const lu = p.lureD = D.createLure(l.x, l.z, { dive: g.dive, lineLen: g.lineLen });
    if (sess.party) lu.plane = PLANE_Z; else { deep.center(l.x, l.z - 4); sess.covers = deep.worldCovers(); }
    D.setNeutral(lu, f || p.mc.forward);
    p.lv = deep.makeLure(p.color); p.ul = deep.makeLine(p.color);
    p.lv.lamp.intensity = g.light ? 2 : 0; p.lv.lamp.distance = g.light;
    p.bait = D.currentBait(store);
    Object.assign(l, { inWater: true, active: true, age: 0, twitch: 99, moving: 0, claimed: -1, light: g.light, bait: p.bait });
    p.longest = Math.max(p.longest, d); p.band = 0; p.zone = 'reef'; p.waitT = 0; p.directAt = 6 + Math.random() * 3;
    p.dive = { t: 0, dp: 0, dy: 0, twitches: 0, taut: 0 }; p.saidTaut = false;
    setSt(p, 'dive');
    W.splash(l.x, l.z, 0.3); synth.splash(0.3, d > 25);
    rumble(p, 0.4, 60, 0, true);
    deep.bubble({ x: lu.x, y: -0.6, z: lu.z }, 24, 0.8);
    float(p, new T.Vector3(l.x, 0.5, l.z), Math.round(d) + ' m', L.castWord(l.launch), 'cast');
    rec('land', { p: p.i, d: +d.toFixed(1), x: +l.x.toFixed(2), z: +l.z.toFixed(2) });
  }
  /** The lure is out of the water (reeled in, lost, or the fish landed): tidy up and log the dive. */
  function endDive(p, why) {
    if (p.lureD && why) rec('dive', { p: p.i, why, maxDepth: Math.round(p.lureD.maxDepth), secs: +p.dive.t.toFixed(1), steer: { pitch: +(p.dive.dp / Math.max(1e-3, p.dive.t)).toFixed(3), yaw: +(p.dive.dy / Math.max(1e-3, p.dive.t)).toFixed(3) }, twitches: p.dive.twitches, tautSecs: +p.dive.taut.toFixed(1) });
    if (p.lureD) { p.deepest = Math.max(p.deepest, p.lureD.maxDepth); if (p.lureD.maxDepth > store.deepest) { store.deepest = Math.round(p.lureD.maxDepth); save(); } }
    if (p.lv) { deep.removeObj(p.lv.g); p.lv = null; }
    if (p.ul) { deep.removeObj(p.ul.line); deep.removeObj(p.ul.beads); p.ul = null; }
    p.lureD = null; p.lure.active = false; p.lure.inWater = false; p.lure.claimed = -1;
  }

  // ------------------------------------------------------------------ hooking + the fight
  function hook(p, q) {
    const f = p.biteFish;
    if (!f) return;
    sess.deepFish = sess.deepFish.filter(x => x !== f);
    f.state = 'hooked';
    const lu = p.lureD, depth0 = Math.max(2, lu.depth);
    const fs = L.createFight(f, depth0 + 4, 0, q, Math.random); fs.bonus = gear().strength;
    p.fish = f; p.fight = fs; p.chain = 0; p.hunter = null;
    p.hk = { ox: lu.ox, oz: lu.oz, hx: lu.x - lu.ox, hz: lu.z - lu.oz, depth0, d0: fs.d };
    p.snagSt = { meter: 0 }; p.runTo = null; p.runPull = 0; p.fpos = new T.Vector3(f.x, f.y, f.z); p.fprev = p.fpos.clone(); p.said = {};
    p.lure.active = false; p.lure.claimed = -1;
    if (p.bait.kind === 'fish') { D.useBait(store); save(); }
    setSt(p, 'fight');
    synth.hookSet(); rumble(p, 1, 140, 0, true);
    deep.bubble(p.fpos, 16, 0.8);
    float(p, p.fpos.clone().add(new T.Vector3(0, 0.8, 0)), 'Hooked!', q > 0.75 ? 'solid hook-set' : q > 0.45 ? 'good hook-set' : 'light hook-set', 'big');
    rec('hook', { p: p.i, sp: f.sp.id, kg: f.kg, q: +q.toFixed(2), depth: Math.round(depth0) });
  }
  /** Where the hooked fish is: deep at first, rising toward where the line enters as you reel it in. */
  function fishPos(p, out) {
    const fs = p.fight, hk = p.hk, frac = clamp((fs.d - L.FIGHT.LAND_D) / (hk.d0 - L.FIGHT.LAND_D), 0, 1.8);
    const a = fs.phi * 0.9, cx = hk.hx * Math.cos(a) - hk.hz * Math.sin(a), cz = hk.hx * Math.sin(a) + hk.hz * Math.cos(a), k = Math.min(1.2, frac);
    out.set(hk.ox + (cx + Math.sin(fs.phi) * 5) * k, -(0.7 + hk.depth0 * frac), hk.oz + (cz - (1 - Math.cos(fs.phi)) * 3) * k);
    if (p.runTo) out.lerp(_bt.set(p.runTo.x, p.runTo.y, p.runTo.z), p.runPull * 0.8);
    if (sess.party) out.z = PLANE_Z;
    return out;
  }
  /** A predator took the hooked fish: the fight carries on with the predator, deep-hooked and angry. */
  function swallowed(p, pred) {
    const prey = p.fish;
    deep.puff(p.fpos, 0xfff0d0, 2.6); deep.bubble(p.fpos, 26, 1.2);
    if (prey.model) { deep.removeObj(prey.model); prey.model = null; }
    sess.deepFish = sess.deepFish.filter(x => x !== pred); pred.state = 'hooked';
    p.fight = D.swallow(p.fight, pred, Math.random, L.createFight); p.fight.bonus = gear().strength;
    p.hk.d0 = Math.max(p.hk.d0, p.fight.d);
    p.fish = pred; p.chain = p.fight.chain; p.hunter = null; p.said = {}; p.runTo = null; p.runPull = 0;
    banner(p.chain > 1 ? 'Swallowed again!' : 'Swallowed!', 'a ' + pred.sp.name + ' took your ' + prey.sp.name);
    synth.strike(); rumble(p, 1, 255, 3, true); W.shake(0.8);
    rec('eat', { p: p.i, pred: pred.sp.id, prey: prey.sp.id, chain: p.chain, kg: pred.kg });
  }
  function endFight(p, how) {
    const f = p.fish, fs = p.fight;
    p.lastLost = how;
    if (how === 'landed' && p.st !== 'lift') {
      setSt(p, 'lift'); p.liftFrom = p.fpos.clone();
      synth.splash(0.4, false);
      return;
    }
    if (how === 'landed') {
      const stars = L.stars(f.size), depth = p.hk.depth0;
      const lg = D.logCatch(store, f, depth, p.bait);
      save();
      const c = { sp: f.sp, kg: f.kg, cm: f.cm, size: f.size, stars, record: lg.record, first: lg.first, n: store.journal[f.sp.id].n, chain: p.chain || 0, depth: Math.round(depth), fish: f };
      p.catches.push(c); p.lastCatch = c;
      if (f.model) { deep.removeObj(f.model); f.model = null; }
      endDive(p, 'landed');
      setSt(p, 'catch');
      p.choice = 1; p.choiceYaw = Math.atan2(p.mc.forward.x, -p.mc.forward.z);
      p.holder = new T.Group(); W.scene.add(p.holder);
      const m = TideDeep.makeFish(f.sp); m.scale.setScalar(f.cm / 100); m.rotation.order = 'YXZ'; p.fishMesh = m; p.holder.add(m);
      const rg = deep.makeRig(p.color); rg.scale.setScalar(1.8); rg.rotation.x = Math.PI / 2; rg.position.y = -0.02; p.holder.add(rg);   // still in its mouth
      if (f.sp.shape === 'puffer' && m.userData.spikes) { m.userData.spikes.scale.setScalar(1); m.scale.multiplyScalar(1.5); }
      W.splash(p.hk.ox, p.hk.oz, 0.6); synth.splash(0.5, false);
      synth.fanfare(stars); rumble(p, 0.9, 250, 2, true);
      W.sparkle(p.a.tip.clone().add(new T.Vector3(0, -0.4, 0)));
      if (sess.players.length === 1) { $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go'); showCatchCard(p, c); }
      else showPartyCatch(p, c);
      rec('landed', { p: p.i, sp: f.sp.id, kg: f.kg, secs: +fs.t.toFixed(1), depth: c.depth, chain: c.chain });
    } else {
      const at = p.fpos ? p.fpos.clone() : new T.Vector3();
      if (how === 'snap') { p.snaps++; synth.snap(); rumble(p, 1, 255, 0, true); W.shake(0.6); float(p, at, 'Snap!', 'the line was screaming: ease off when it runs', 'bad'); }
      else if (how === 'snag') { p.snaps++; synth.snap(); rumble(p, 0.8, 200, 3, true); float(p, at, 'Snagged!', 'lean the rod away when it runs for cover', 'bad'); rec('snag', { p: p.i, sp: f.sp.id, cover: p.snagSt.cover && p.snagSt.cover.kind }); }
      else { p.escapes++; synth.slip(); rumble(p, 0.5, 90, 3, true); float(p, at, 'It got away', fs.slackT > 0.5 ? 'too much slack' : 'thrown when it rolled', 'bad'); }
      if (how === 'thrown' && f.model) { f.state = 'flee'; f.t = 3; f.cool = 12; f.lure = -1; f.x = at.x; f.y = at.y; f.z = at.z; f.leader = null; sess.deepFish.push(f); }
      else if (f.model) { deep.removeObj(f.model); f.model = null; }
      rec('lost', { p: p.i, how, sp: f.sp.id });
      endDive(p, how);
      setSt(p, 'lost');
    }
    p.fight = null; p.fish = how === 'landed' ? f : null; p.fpos = null; p.hunter = null;
  }
  /** Sell, keep as bait, or release the fish on the deck. */
  function decide(p, i) {
    const c = p.lastCatch;
    if (!c || p.st !== 'catch') return;
    if (i === 1 && c.sp.cls >= 3) return;   // too big for the bait well
    if (i === 0) {
      const v = D.price(c.fish, c.stars), was = canUpgrade(); store.coins += v; p.coins += v; float(p, p.a.tip, '+' + v + ' coins', 'sold: ' + c.sp.name, 'cast'); synth.ui('ok');
      coinFly(p, v);
      if (!was && canUpgrade() && sess.players.length === 1) setTimeout(() => { banner('Upgrade ready', 'press ' + K(p.mc, 'two') + ' on deck for the tackle box'); synth.fanfare(1); }, 900);
    }
    else if (i === 1) { D.keepAsBait(store, c.fish); float(p, p.a.tip, 'In the bait well', 'press ' + K(p.mc, 'one') + ' on deck to bait with it', 'cast'); synth.ui('go'); }
    else { store.luck = Math.min(5, store.luck + 0.25); float(p, p.a.tip, 'Released', 'the sea remembers: rarer fish come closer', 'cast'); synth.plip(1); }
    save();
    rec('decide', { p: p.i, sp: c.sp.id, choice: ['sell', 'bait', 'release'][i] });
    finishCatch(p);
  }
  const canUpgrade = () => Object.keys(D.UPGRADES).some(k => { const c = D.upgradeCost(store, k); return c !== null && store.coins >= c; });
  /** Coins burst off the fish and stream up into the purse. */
  function coinFly(p, v) {
    const s = W.toScreen(p.a.tip), dst = $('clockText').getBoundingClientRect();
    const n = Math.min(12, 3 + Math.round(v / 8));
    for (let k = 0; k < n; k++) {
      const e = document.createElement('i'); e.className = 'coinfly'; document.body.appendChild(e);
      const sx = s.x + (Math.random() - 0.5) * 60, sy = s.y + (Math.random() - 0.5) * 40;
      e.animate([{ transform: `translate(${sx}px,${sy}px) scale(0.6)`, opacity: 0 }, { transform: `translate(${sx + (Math.random() - 0.5) * 80}px,${sy - 60 - Math.random() * 40}px) scale(1.1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dst.left + 6}px,${dst.top + 4}px) scale(0.7)`, opacity: 1 }], { duration: 900 + k * 60, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'forwards' })
        .onfinish = () => { e.remove(); synth.click(0.7); const ck = $('clock'); ck.classList.remove('ping'); void ck.offsetWidth; ck.classList.add('ping'); };
    }
  }
  const choosing = () => !!(sess && state === 'play' && sess.mode === 'calm' && sess.players.length === 1 && sess.players[0].st === 'catch');

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
    const aPress = p.armed && c.pressed('a'), aHeld = p.armed && aDown;
    p.jerkCool -= dt;
    const jerk = L.detectJerk(p.jerk);
    const l = p.lure, lu = p.lureD;
    let bend = 0.06, bendTo = null, lineTo = null, sag = 0.1, showLine = true, showBob = true;
    l.twitch += dt;

    switch (p.st) {
      case 'wait': case 'done':
        break;
      case 'ready': {
        p.castHold = aHeld;
        if (c.pressed('two') && sess.players.length === 1 && !sess.over) { act('shop'); return; }
        if (c.pressed('one') && sess.players.length === 1) { D.cycleBait(store); save(); p.bait = D.currentBait(store); synth.ui('move'); float(p, p.a.tip, 'Bait: ' + p.bait.name, p.bait.kind === 'fish' ? 'big bait brings big fish' : 'worms suit small fish', 'cast'); }
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
        if (l.y <= 0) land(p, f);
        break;
      }
      case 'dive': case 'bite': {
        const g = gear();
        const reel = p.st === 'dive' ? L.reelSpeed(p.stT > 0.8 ? tps : 0, aHeld) * g.reel : 0;   // the cast's swing is not a crank
        // the rod tip's own velocity (2.2 m of rod turning at the phone's rate): a sharp sweep darts the lure
        const tip = { x: (av.y * f.z - av.z * f.y) * L.ROD_LEN, y: (av.z * f.x - av.x * f.z) * L.ROD_LEN, z: (av.x * f.y - av.y * f.x) * L.ROD_LEN };
        if (p.st === 'bite') { tip.x = tip.y = tip.z = 0; }
        const tipS = Math.hypot(tip.x, tip.y, tip.z);
        if (p.st === 'dive' && tipS > 2.5 && p.jerkCool <= 0) { p.jerkCool = 0.45; l.twitch = 0; p.dive.twitches++; deep.bubble(lu, 5, 0.2); synth.plip(0.6); }
        if (c.pressed('center')) { D.setNeutral(lu, f); float(p, new T.Vector3(lu.x, lu.y + 0.6, lu.z), 'Re-centred', 'hold the rod like this and the lure just sinks', 'cast'); }
        const r = D.steerLure(lu, { f, reel, tip }, dt);
        p.dive.t += dt; p.dive.dp += Math.abs(Math.asin(clamp(f.y, -1, 1)) - lu.np) * dt; p.dive.dy += Math.abs(L.wrap(Math.atan2(f.x, -f.z) - lu.ny)) * dt;
        Object.assign(l, { x: lu.x, y: lu.y, z: lu.z, active: true, moving: Math.hypot(lu.vx, lu.vy, lu.vz), light: g.light, bait: p.bait });
        if (reel > 0) { p.clickAcc += reel * dt * 7; while (p.clickAcc > 1) { p.clickAcc--; synth.click(0.5); } }
        if (r.surfaced && p.dive.t > 1.5) { endDive(p, 'reeled'); setSt(p, 'ready'); break; }
        if (r.taut) { p.dive.taut += dt; if (!p.wasTaut) { rumble(p, 0.4, 60, 3, true); if (!p.saidTaut) { p.saidTaut = true; float(p, new T.Vector3(lu.x, lu.y + 0.7, lu.z), 'End of the line', 'a longer line in the tackle box goes deeper', 'bad'); } } }
        p.wasTaut = r.taut;
        const band = Math.floor(lu.depth / 10);
        if (band !== p.band) { if (band > p.band) { rumble(p, 0.1 + Math.min(0.45, band * 0.03), 28, 0); synth.click(0.4); } p.band = band; }
        const z = D.zoneAt(lu.depth);
        if (z.id !== p.zone) { p.zone = z.id; if (sess.players.length === 1) banner(z.name, z.top + ' m'); synth.zone && synth.zone(); rec('zone', { p: p.i, zone: z.id }); }
        // a big fish close by: a slow heartbeat in the hand
        const big = sess.deepFish.find(fi => fi.sp.cls >= 4 && Math.hypot(fi.x - lu.x, fi.y - lu.y, fi.z - lu.z) < 7);
        if (big && (nowS - (p.beatT || 0)) > 1.1) { p.beatT = nowS; rumble(p, 0.35, 60, 3, true); }
        if (p.st === 'dive') {
          // nobody biting: send a fish (it is seen swimming in to the lure)
          p.waitT += dt;
          const biter = sess.deepFish.find(fi => fi.lure === l.id);
          if (l.claimed >= 0) { p.claimT = (p.claimT || 0) + dt; if (p.claimT > 9 && biter && biter.state === 'approach') { biter.state = 'flee'; biter.t = 2; biter.lure = -1; l.claimed = -1; p.claimT = 0; p.directAt = p.waitT + 0.5; } }
          else p.claimT = 0;
          if (l.claimed < 0 && p.waitT > p.directAt && lu.depth > 6) {
            const rr = D.directBite(sess.deepFish, l, Math.random);
            if (rr.spawn) {
              const sp = D.pickSpecies(lu.depth, Math.random, { bait: p.bait, luck: store.luck });
              // it comes in from ahead, so it is seen swimming up to the lure
              const ax = lu.x + Math.sin(lu.heading) * 9 + (Math.random() - 0.5) * 6, az = lu.z - Math.cos(lu.heading) * 9 + (Math.random() - 0.5) * 6;
              if (sp && D.baitAppeal(sp, p.bait) > 0) { const nf = spawnDeep(sp, sess.party ? rr.spawn.x : ax, Math.min(-1, rr.spawn.y), sess.party ? PLANE_Z : az, true); nf.state = 'approach'; nf.lure = l.id; l.claimed = nf.id; }
            }
            p.directAt = p.waitT + 9;
          }
          if (jerk && jerk.kind === 'strike' && nowS - p.missAt < 0.9) { float(p, new T.Vector3(lu.x, lu.y + 0.5, lu.z), 'Late by ' + (nowS - p.missAt + 0.1).toFixed(1) + ' s', 'pull back the moment it thumps', 'bad'); p.missAt = -9; }
        } else {
          bend = 0.35;
          const bf = p.biteFish;
          if (!bf || bf.state !== 'strike' || !sess.deepFish.includes(bf) || p.stT > bf.sp.window + 0.4) {
            if (bf && bf.state === 'strike') { bf.state = 'flee'; bf.t = 2; bf.lure = -1; }
            l.claimed = -1; setSt(p, 'dive'); p.biteFish = null; p.missAt = nowS; p.waitT = 0; p.directAt = 6;
            float(p, new T.Vector3(lu.x, lu.y + 0.5, lu.z), p.biteSoft ? 'Too soft!' : 'Missed it', p.biteSoft ? 'pull the rod back, hard and fast' : 'pull back the moment it thumps', 'bad');
            break;
          }
          const strike = (jerk && jerk.kind === 'strike') || (cfg.strike === 1 && aPress);
          if (strike) { hook(p, jerk && jerk.kind === 'strike' ? jerk.strength : 0.55); break; }
          if (jerk && jerk.kind === 'twitch') p.biteSoft = true;
        }
        lineTo = _bt.set(lu.ox, 0.02, lu.oz); sag = 0.05;
        break;
      }
      case 'fight': {
        const fs = p.fight;
        const m = p.crank.m || f;
        const reel = L.reelSpeed(tps, aHeld) * gear().reel;
        p.reeling = reel > 0.2;
        const line0 = fs.line;
        const ev = L.stepFight(fs, { reel, rodDir: m, pitch: Math.asin(clamp(m.y, -1, 1)) }, dt, Math.random);
        fightFx(p, fs, ev, reel, line0, dt, nowS);
        if (fs.over) { endFight(p, fs.over); break; }
        if (D.stepSnag(p.snagSt, p.fpos, sess.covers, fs, dt)) { fs.over = 'snag'; endFight(p, 'snag'); break; }
        bend = Math.min(1.1, fs.T * 1.05 + 0.05);
        lineTo = _bt.set(p.hk.ox, 0.02, p.hk.oz); sag = Math.max(0, fs.line - fs.d) * 0.2;
        break;
      }
      case 'lift': {
        // drawn up and out: the fish rises to where the line enters and breaks the surface
        const k = Math.min(1, p.stT / 0.9), e = k * k * (3 - 2 * k);
        const prevY = p.fpos.y;
        p.fpos.set(p.liftFrom.x + (p.hk.ox - p.liftFrom.x) * e, p.liftFrom.y + (0.7 - p.liftFrom.y) * e, p.liftFrom.z + (p.hk.oz - p.liftFrom.z) * e);
        if (prevY < -0.1 && p.fpos.y >= -0.1) { W.splash(p.hk.ox, p.hk.oz, 0.7); deep.bubble({ x: p.hk.ox, y: -0.5, z: p.hk.oz }, 30, 1); rumble(p, 0.8, 160, 2, true); }
        if (p.fish.model) placeModel(p.fish, dt, p.fpos.x, p.fpos.y, p.fpos.z, 0, 1, 0, 3, { mouth: true, face: { x: 0, y: 1, z: 0.01 }, thrash: true });
        lineTo = _bt.set(p.hk.ox, 0.02, p.hk.oz); bend = 0.8;
        if (k >= 1) endFight(p, 'landed');
        break;
      }
      case 'catch': {
        showBob = false;
        const s = p.lastCatch, len = s.cm / 100;
        p.holder.position.copy(p.a.tip).add(new T.Vector3(0, -0.12, 0));
        p.holder.rotation.y = -2.14 + Math.sin(nowS * 0.7) * 0.45;   // it turns on the line, but keeps its flank to you
        p.fishMesh.rotation.set(Math.PI / 2 - 0.05, 0, Math.sin(nowS * 9) * 0.12);
        p.fishMesh.position.set(0, -len / 2, 0);
        p.fishMesh.swim(dt, 1.5);
        lineTo = p.holder.position; sag = 0;
        bend = Math.min(0.6, 0.1 + s.kg / 40);
        if (choosing()) {
          const dy = L.wrap(Math.atan2(f.x, -f.z) - p.choiceYaw), ch = dy < -0.22 ? 0 : dy > 0.22 ? 2 : 1;
          if (ch !== p.choice) { p.choice = ch; synth.ui('move'); renderChoice(p); }
          if (p.stT > 1.0 && aPress && !cursor.hovering) decide(p, p.choice);
        } else if (p.stT > 3.6) { if (sess.mode !== 'party') decide(p, 0); else finishCatch(p); }
        break;
      }
      case 'lost': case 'snag':
        showLine = false; showBob = false;
        if (p.stT > 1.6) setSt(p, 'ready');
        break;
    }
    if (p.st !== 'ready') p.castHold = false;

    // above the water: the rig hangs from the tip on deck; in the dive the line runs to where it enters the sea
    if (p.st === 'ready' || p.st === 'wait' || p.st === 'done') { lineTo = _bt.copy(p.a.tip).add(new T.Vector3(Math.sin(nowS * 1.7 + p.i) * 0.03, -0.55, 0)); sag = 0; }
    else if (p.st === 'flight') lineTo = _bt.set(l.x, l.y, l.z);
    if (lineTo) bendTo = _t.copy(lineTo).sub(p.a.tip).normalize();
    W.poseAngler(p.a, c.arm, _f, bend, bendTo, p.hand === 'left');
    if (p.st === 'catch') lineTo = p.holder.position;
    if (p.st === 'ready' || p.st === 'wait' || p.st === 'done') lineTo = _bt.copy(p.a.tip).add(new T.Vector3(Math.sin(nowS * 1.7 + p.i) * 0.03, -0.55, 0));
    W.drawLine(p.a, lineTo || p.a.tip, sag, showLine && !!lineTo, p.st === 'fight' && p.fight ? p.fight.T : p.st === 'bite' ? 0.5 : 0);
    p.a.bob.visible = showBob && !!lineTo && (p.st === 'ready' || p.st === 'wait' || p.st === 'done' || p.st === 'flight');
    if (p.a.bob.visible) p.a.bob.position.copy(lineTo);
    p.a.marker.visible = false;
    // below: the lure with its lamp, the line with its depth beads
    p.halo = Math.max(0, p.halo - dt * 2.5);
    if (p.lv && p.lureD) {
      const L0 = p.lureD, R = L0.rope, n = R.length - 1;
      if ((p.st === 'fight' || p.st === 'lift') && p.fpos) {
        // the line runs to the hook in the fish's mouth: it straightens under load, sags when slack
        L0.x = p.fpos.x; L0.y = Math.min(-0.05, p.fpos.y); L0.z = p.fpos.z;
        const dd = Math.hypot(L0.x - L0.ox, L0.y, L0.z - L0.oz), T0 = p.fight ? p.fight.T : 0.3;
        L0.lineOut = dd * (1 + Math.max(0, 0.5 - T0) * 0.12);
        D.stepRope(L0, dt);
      }
      // the rig points back up its line, fluttering as it falls and wobbling as it swims
      const up = _t.set(R[n - 1].x - L0.x, R[n - 1].y - L0.y, R[n - 1].z - L0.z);
      if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
      up.normalize();
      p.lv.g.position.set(L0.x, L0.y, L0.z);
      p.lv.g.quaternion.setFromUnitVectors(_m.set(0, 0, -1), up);
      if (p.st === 'dive' || p.st === 'bite') p.lv.g.rotateZ(Math.sin(L0.phase) * (0.25 + L0.flutter * 0.7) * (p.st === 'bite' ? 2 : 1));
      if (p.st === 'bite') p.lv.g.position.x += Math.sin(nowS * 45) * 0.04;
      p.lv.glow.material.opacity = (p.st === 'fight' ? 0.15 : 0.35) + p.halo * 0.5; p.lv.glow.scale.setScalar(0.4 + p.halo * 1.0 + (sess.party ? 0.8 : 0));
      p.lv.tag.visible = !!sess.party;
      deep.drawLine(p.ul, R, p.lv.tieWorld(), p.st === 'fight' && p.fight ? p.fight.T : p.st === 'bite' ? 0.7 : 0);
      if (Math.hypot(L0.vx, L0.vy, L0.vz) > 2.2 && Math.random() < dt * 8 && p.st === 'dive') deep.bubble(L0, 1, 0.1);
    }
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

  /** Sound, rumble, bubbles and words for the fight, from the step's events. */
  function fightFx(p, fs, ev, reel, line0, dt, nowS) {
    // where the fish is now, and the cover it heads for when it runs
    for (const e of ev) {
      if (e === 'phase:run' || e === 'burst') {
        const cv = nearestCover(p.fpos.x, p.fpos.y, p.fpos.z, 16);
        if (cv && (p.fish.sp.ambush || Math.random() < 0.55)) { p.runTo = cv; say(p, 'cover' + Math.floor(fs.t / 6), 'Running for the ' + cv.kind + '!', 'lean the rod the other way', true); }
      }
      if (e === 'jump') { deep.bubble(p.fpos, 20, 1); rumble(p, 0.8, 120, 3, true); say(p, 'roll', p.fpos.y > -4 ? 'It breaks the surface!' : 'It rolls!', 'bow the rod', true); if (p.fpos.y > -4) W.splash(p.fpos.x, p.fpos.z, 0.8); }
      else if (e === 'burst') say(p, 'burst' + Math.floor(fs.t), 'Not done yet!', 'tire it out first', true);
      else if (e === 'phase:charge') say(p, 'charge', 'Coming at you!', 'reel fast');
    }
    const running = fs.phase === 'run' || fs.phase === 'burst';
    if (p.runTo && running) p.runPull = Math.min(1, p.runPull + dt * (0.45 - Math.max(0, fs.side) * 0.7));
    else p.runPull = Math.max(0, p.runPull - dt * 0.6);
    if (p.runPull <= 0 && !running) p.runTo = null;
    const target = fishPos(p, new T.Vector3());
    p.fprev.copy(p.fpos);
    p.fpos.lerp(target, Math.min(1, dt * 4));
    const v = _t.copy(p.fpos).sub(p.fprev).divideScalar(Math.max(dt, 1e-3));
    if (p.fish.model) {
      // it pulls away from the line: nose toward the hook, body trailing off it
      const R = p.lureD.rope, q = R[R.length - 2], aw = _bt.set(p.fpos.x - q.x, p.fpos.y - q.y, p.fpos.z - q.z);
      const move = v.length() > 0.4 ? _m.copy(v).normalize() : aw.normalize();
      const face = _k2.copy(move).multiplyScalar(-1).lerp(aw.normalize().multiplyScalar(-1), running ? 0.2 : 0.7).normalize();
      placeModel(p.fish, dt, p.fpos.x, p.fpos.y, p.fpos.z, v.x, v.y, v.z, running || fs.phase === 'thrash' ? 3.2 : 1 + (1 - fs.S),
        { mouth: true, face: face.multiplyScalar(-1), tired: fs.S < 0.45 ? (0.45 - fs.S) * 1.6 : 0, thrash: fs.phase === 'thrash' || fs.air });
      if (p.fish.sp.shape === 'puffer' && p.fish.model.userData.spikes) { const k = Math.min(1, fs.t); p.fish.model.userData.spikes.scale.setScalar(0.3 + 0.7 * k); p.fish.model.scale.setScalar(p.fish.cm / 100 * VIS * (1 + 0.6 * k)); }
      if (p.fish.sp.shape === 'squid' && fs.phase === 'run' && fs.pt < dt * 1.5) deep.puff(p.fpos, 0x10101a, 3);
    }
    // the drag sings while line peels off; the reel clicks while you crank
    const payout = Math.max(0, fs.line - line0) / dt;
    if (payout > 0.2) { p.dragAcc += payout * dt * 9; while (p.dragAcc > 1) { p.dragAcc--; synth.drag(Math.min(1, 0.4 + fs.T * 0.6)); } }
    p.clickAcc += reel * dt * 7;
    while (p.clickAcc > 1) { p.clickAcc--; synth.click(0.5); }
    // the line in your hand: a hum rising with the load, hammering pulses in the danger zone
    if (fs.danger) rumble(p, 1, 120, 3);
    else if (fs.T > 0.15) rumble(p, 0.1 + 0.75 * Math.pow(fs.T, 1.3), 140, 1);
    if (fs.danger) {
      if (!p.inDanger) { p.inDanger = true; if (nowS - p.dangerT > 4) { p.dangerT = nowS; float(p, p.fpos.clone().add(new T.Vector3(0, 1, 0)), 'Line screaming!', fs.slipping ? 'stop reeling, raise the rod off the fish' : 'ease off', 'bad'); } }
      p.creakT -= dt;
      if (p.creakT <= 0) { p.creakT = 0.32 - Math.min(0.2, fs.strain * 0.2); synth.creak(Math.min(1, 0.5 + fs.strain)); }
    } else p.inDanger = false;
    if (fs.slipping) { p.dragAcc += dt * 26; while (p.dragAcc > 1) { p.dragAcc--; synth.drag(1); } }
    if (p.snagSt.meter > 0.35 && !p.said.snagwarn) { p.said.snagwarn = true; rumble(p, 0.7, 150, 3, true); }
    p.fxT -= dt;
    if (p.fxT <= 0) { p.fxT = running ? 0.12 : 0.4; deep.bubble(p.fpos, running ? 2 : 1, 0.3); }
    synthStrainMax = Math.max(synthStrainMax, fs.T);
  }
  let synthStrainMax = 0;
  /** A message over the fish, at most once per key per fight. */
  function say(p, key, text, sub, big) {
    if (p.said[key]) return;
    p.said[key] = true;
    float(p, (p.fpos || p.a.tip).clone().add(new T.Vector3(0, 1, 0)), text, sub, big ? 'big' : '');
  }
  function finishCatch(p) {
    if (p.holder) { W.scene.remove(p.holder); p.holder = null; }
    p.fish = null;
    $('catch').classList.add('hidden'); document.body.classList.remove('catching');
    if (p.card) { const pc = p.card.querySelector('.pcatch'); if (pc) pc.remove(); }
    setSt(p, sess.overtime > 0 ? 'done' : 'ready');
  }

  // ------------------------------------------------------------------ the session step
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
    synthStrainMax = 0;
    for (const p of S.players) {
      if (p.kind !== 'solo') p.mc.update();   // solo rides mc, updated by the frame
      stepPlayer(p, dt, nowS);
    }
    stepDeep(dt, nowS);
    synth.strain(synthStrainMax);
    // the horn: whoever has a fish on gets to finish
    if (timed && remaining <= 0 && !S.over) {
      if (!S.overtime) {
        S.overtime = 0.001; synth.horn();
        banner('Sunset!', S.players.some(p => p.st === 'fight') ? 'land what is on the line' : 'lines out of the water');
      }
      S.overtime += dt;
      S.players.forEach(p => { if (p.st === 'ready' || p.st === 'lost' || p.st === 'snag' || p.st === 'dive' || p.st === 'flight') { endDive(p, 'horn'); setSt(p, 'done'); } });
      if ((S.players.every(p => p.st === 'done') && S.overtime > 2.2) || S.overtime > 30) finishSession();
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
    $('gauge').classList.toggle('hidden', sess.players.length !== 1);
  }
  const fishWord = kg => kg >= 15 ? 'A monster!' : kg >= 5 ? 'A big one!' : kg >= 1.2 ? 'A good fish' : 'Fish on';
  function cardState(p) {
    const c = p.mc, a = K(c, 'a'), fs = p.fight;
    switch (p.st) {
      case 'wait': return { what: 'Get ready', hint: 'Point the rod out to sea · ' + kbd(K(c, 'center')) + ' aligns' };
      case 'ready': {
        const solo = sess.players.length === 1, up = solo && canUpgrade();
        return { what: p.castHold ? 'Thumb on the spool...' : up ? 'Upgrade ready: press ' + K(c, 'two') + ' for the tackle box' : 'On deck · bait: ' + p.bait.name, cls: p.castHold || up ? 'hot' : '',
          hint: p.castHold ? 'Swing back, snap it forward, let go: harder goes further' : 'Hold ' + kbd(a) + ', flick, let go' + (solo ? ' · ' + kbd(K(c, 'one')) + ' bait · ' + kbd(K(c, 'two')) + ' tackle box' : '') };
      }
      case 'flight': return { what: 'Line out...', hint: 'Hold the rod as it ends: that pose is level under water' };
      case 'dive': {
        const lu = p.lureD;
        return { what: D.zoneAt(lu.depth).name + ' · ' + Math.round(lu.depth) + ' m' + (lu.taut ? ' · end of line' : ''), cls: lu.taut ? 'bad' : '',
          hint: 'It sinks on its own · lift the rod to hold or climb · turn to glide · sweep to jig · hold ' + kbd(a) + ' to reel' };
      }
      case 'bite': return { what: 'BITE!', cls: 'hot', hint: 'Pull the rod back now' + (cfg.strike ? ' (or ' + kbd(a) + ')' : '') };
      case 'lift': return { what: 'Here it comes!', cls: 'hot', hint: 'Lifting it out' };
      case 'fight': {
        const lean = fs.w > 0 ? 'LEFT' : 'RIGHT', reelK = 'hold ' + kbd(a) + ' or circle the tip';
        let hint = 'Reel it up: ' + reelK, cls = '';
        if (p.snagSt.meter > 0.35) { hint = 'It is in the ' + (p.snagSt.cover ? p.snagSt.cover.kind : 'cover') + '! Lean the rod ' + lean + ' and hold'; cls = 'bad'; }
        else if (fs.danger) { hint = fs.slipping ? 'Ease off! Stop reeling, let it take line' : 'Ease off! Point the rod higher'; cls = 'bad'; }
        else if (p.hunter) { hint = 'Something big is coming: reel hard!'; cls = 'bad'; }
        else if (fs.air) { hint = 'It rolls! Dip the rod tip'; cls = 'hot'; }
        else if (fs.slackT > 0.4) { hint = 'Slack! Reel fast'; cls = 'bad'; }
        else if (fs.phase === 'run' || fs.phase === 'burst') hint = 'It runs: let it go. Rod up, lean it ' + lean;
        else if (fs.phase === 'rest') hint = 'It tires: reel now, or lift the rod and reel down';
        else if (fs.phase === 'charge') hint = 'It swims up at you: reel fast';
        else if (fs.phase === 'thrash') hint = 'Head-shakes: rod up, hold steady';
        const dpt = p.fpos ? Math.round(-p.fpos.y) : 0;
        return { what: (p.chain ? 'Swallowed! ' : '') + fishWord(p.fish.kg) + ' · ' + dpt + ' m down', cls, hint, bars: true };
      }
      case 'catch': return { what: p.lastCatch.sp.name + ' · ' + p.lastCatch.kg.toFixed(2) + ' kg', cls: 'hot', hint: choosing() ? 'Tilt the rod to choose · ' + kbd(a) + ' confirms' : '' };
      case 'lost': return { what: p.lastLost === 'snap' ? 'Line snapped' : p.lastLost === 'snag' ? 'Snagged and lost' : 'It got away', cls: 'bad', hint: 'New rig coming up' };
      case 'snag': return { what: 'Tangled', cls: 'bad', hint: 'Let go of ' + kbd(a) + ' as the rod comes forward' };
      case 'done': return { what: 'Lines out', hint: '' };
    }
    return { what: '', hint: '' };
  }
  function renderHud() {
    const S = sess;
    const clock = $('clock');
    if (S.dur > 0) {
      const rem = Math.max(0, S.dur - S.t);
      $('clockText').textContent = S.count > 0 ? Math.floor(S.dur / 60) + ':' + String(S.dur % 60).padStart(2, '0') : Math.floor(rem / 60) + ':' + String(Math.floor(rem % 60)).padStart(2, '0');
      $('clockSub').textContent = S.overtime ? 'overtime' : 'until sunset';
      clock.classList.toggle('low', rem < 30);
    } else {
      $('clockText').textContent = store.coins + '';
      $('clockSub').textContent = 'coins · bait: ' + S.players[0].bait.name;
      clock.classList.remove('low');
    }
    clock.classList.toggle('coins', !(S.dur > 0));
    if (S.players.length > 1) {
      const rk = L.rank(S.players, S.rule);
      const html = rk.map(r => { const p = S.players[r.i]; return `<div class="br" style="--c:${p.color}"><b>${p.name}</b><span>${p.catches.length} fish</span><em>${r.score.toFixed(2)} kg</em></div>`; }).join('');
      if ($('board').dataset.k !== html) { $('board').innerHTML = html; $('board').dataset.k = html; }
    } else if (S.mode === 'derby') {
      const best = S.players[0].catches.reduce((a, c) => Math.max(a, c.kg), 0);
      const html = `<div class="br" style="--c:${COLORS[0]}"><b>&#9733;</b><span>Heaviest today</span><em>${best.toFixed(2)} kg</em><small>Your record: ${(store.derbyBest || 0).toFixed(2)} kg</small></div>`;
      if ($('board').dataset.k !== html) { $('board').innerHTML = html; $('board').dataset.k = html; }
    } else if ($('board').dataset.k !== 'calm') { $('board').innerHTML = ''; $('board').dataset.k = 'calm'; }
    let danger = 0;
    for (const p of S.players) if (p.fight && p.fight.danger) danger = Math.max(danger, 0.35 + p.fight.strain * 0.65);
    $('strain').style.opacity = (danger * (S.players.length > 1 ? 0.45 : 1) * (0.7 + 0.3 * Math.sin(performance.now() / 70))).toFixed(2);
    if (S.players.length === 1) { renderGauge(S.players[0]); drawRod(S.players[0]); } else $('rodg').classList.add('hidden');
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
        tb.classList.toggle('danger', fs.danger);
        tb.classList.toggle('slack', fs.slackT > 0.3);
        p.card.querySelector('.bar.energy i').style.width = (fs.S * 100).toFixed(1) + '%';
        p.card.querySelector('.lv').textContent = p.snagSt.meter > 0.35 ? 'snagging' : fs.slackT > 0.3 ? 'slack' : fs.danger ? 'breaking' : 'fish energy below';
      }
    }
  }
  /**
   * The fight, drawn as the rod in your hand: it bows further the harder the fish pulls, the line
   * goes from cream to amber to red and thrums before it breaks, the reel spins in when you reel
   * and screams backwards when the fish takes line. Nothing to fill; just read the rod.
   */
  let rodSpin = 0;
  function drawRod(p) {
    const cv = $('rodg'), fs = p.fight;
    cv.classList.toggle('hidden', !(p.st === 'fight' && fs));
    if (!(p.st === 'fight' && fs)) return;
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, T0 = Math.min(1.15, fs.T);
    g.clearRect(0, 0, w, h);
    const hx = w - 34, hy = h - 30;                         // the butt, bottom right
    const bow = T0 * 0.95, len = 190;
    const ang = -Math.PI * 0.72 + bow * 0.55;               // the blank leans up-left, bowing toward the line
    const tx = hx + Math.cos(ang - bow * 0.55) * len, ty = hy + Math.sin(ang - bow * 0.55) * len * (1 - bow * 0.12) + bow * 52;
    const cx = hx + Math.cos(ang) * len * 0.55, cy = hy + Math.sin(ang) * len * 0.55;
    const danger = fs.danger, shake = danger ? (Math.random() - 0.5) * 3 : 0;
    const lc = T0 < 0.55 ? '#fff6e0' : T0 < 0.85 ? '#ffb347' : '#ff4a2e';
    // the line, off to where the fish is
    g.strokeStyle = lc; g.lineWidth = danger ? 2.4 : 1.6; g.globalAlpha = 0.95;
    g.beginPath(); g.moveTo(tx + shake, ty + shake);
    const sagY = Math.max(0, 0.55 - T0) * 60;
    g.quadraticCurveTo((tx + 4) / 2, ty + 30 + sagY, 4, ty + 60 + sagY * 0.5); g.stroke();
    // the blank, thick at the butt to a fine tip
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i === 0 ? 'rgba(0,0,0,0.5)' : i === 1 ? '#1d2a36' : '#5a7a9a';
      g.lineWidth = [9, 6, 1.4][i]; g.lineCap = 'round';
      g.beginPath(); g.moveTo(hx, hy); g.quadraticCurveTo(cx + shake, cy + shake, tx + shake, ty + shake); g.stroke();
    }
    if (danger) { g.strokeStyle = 'rgba(255,74,46,0.55)'; g.lineWidth = 12; g.globalAlpha = 0.35 + 0.3 * Math.sin(performance.now() / 60); g.beginPath(); g.moveTo(hx, hy); g.quadraticCurveTo(cx, cy, tx, ty); g.stroke(); g.globalAlpha = 1; }
    // cork grip and the reel, spinning in when you reel, backwards when it takes line
    g.globalAlpha = 1; g.strokeStyle = '#b08a5a'; g.lineWidth = 11; g.beginPath(); g.moveTo(hx + 12, hy + 14); g.lineTo(hx - 6, hy - 10); g.stroke();
    rodSpin += (fs.slipping ? -0.5 : 0) + (p.reeling ? 0.35 : 0);
    g.save(); g.translate(hx + 6, hy + 4); g.fillStyle = '#c9cdd2'; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2f36'; g.lineWidth = 2.5; for (let k = 0; k < 3; k++) { const a = rodSpin + k * 2.1; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); g.stroke(); }
    g.restore();
    g.font = '600 11px Bahnschrift, "Segoe UI", sans-serif'; g.fillStyle = danger ? '#ff8a6a' : 'rgba(255,244,228,0.8)'; g.textAlign = 'right';
    g.fillText(fs.slipping ? 'DRAG SCREAMING' : danger ? 'LINE BREAKING' : fs.slackT > 0.4 ? 'SLACK LINE' : T0 > 0.6 ? 'ROD LOADED' : 'LINE TIGHT', w - 8, 16);
  }
  /** The depth gauge: zones down the right edge, the line's reach, the lure and the fish on it. */
  let gaugeKey = '';
  function renderGauge(p) {
    const g = gear(), maxD = Math.max(60, Math.min(D.FLOOR, g.lineLen * 1.15));
    const key = maxD + '|' + g.lineLen;
    if (key !== gaugeKey) {
      gaugeKey = key;
      $('gaugeZones').innerHTML = D.ZONES.filter(z => z.top < maxD).map(z => `<i style="top:${(z.top / maxD * 100).toFixed(1)}%;height:${((Math.min(z.bottom, maxD) - z.top) / maxD * 100).toFixed(1)}%;background:${z.fog}"><span>${z.name}</span></i>`).join('')
        + `<b class="limit" style="top:${(g.lineLen / maxD * 100).toFixed(1)}%"><span>${g.lineLen} m line</span></b>`;
    }
    const dl = p.lureD ? p.lureD.depth : 0, df = p.fpos ? -p.fpos.y : null;
    $('gaugeLure').style.top = (dl / maxD * 100).toFixed(1) + '%';
    $('gaugeLure').querySelector('span').textContent = Math.round(p.st === 'fight' && df !== null ? df : dl) + ' m';
    $('gauge').classList.toggle('under', !!p.lureD);
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
      f.el.style.top = clamp(s.y - k * 40, 120, innerHeight - 160) + 'px';
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
    $('catchKicker').textContent = c.chain ? 'SWALLOWED ' + (c.chain > 1 ? 'TWICE · ' : '· ') + 'LANDED' : c.sp.legendary ? 'LEGENDARY' : c.stars >= 3 ? 'TROPHY' : 'LANDED';
    $('catchName').textContent = c.sp.name;
    $('catchStars').innerHTML = starsHtml(c.stars);
    $('catchKg').textContent = c.kg.toFixed(2);
    $('catchCm').textContent = c.cm + ' cm · ' + c.depth + ' m';
    $('catchBlurb').textContent = c.sp.blurb;
    $('catchRecord').textContent = c.first ? 'New species in your journal' : c.record ? 'Personal best' : '';
    const solo = choosing();
    $('choice').classList.toggle('hidden', !solo);
    $('catchNext').innerHTML = solo ? 'Tilt the rod left, centre or right · ' + kbd(K(p.mc, 'a')) + ' confirms' : '';
    $('chSell').querySelector('small').textContent = '+' + D.price(c.fish, c.stars) + ' coins';
    $('chBait').querySelector('small').textContent = c.sp.cls >= 3 ? 'too big to use' : 'brings bigger fish';
    $('chBait').classList.toggle('disabled', c.sp.cls >= 3);
    renderChoice(p);
    $('catch').classList.remove('hidden');
    document.body.classList.add('catching');
  }
  function renderChoice(p) {
    ['chSell', 'chBait', 'chRelease'].forEach((id, i) => $(id).classList.toggle('focus', i === p.choice));
  }
  function showPartyCatch(p, c) {
    const old = p.card.querySelector('.pcatch'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'pcatch';
    el.innerHTML = `<div class="n">${c.chain ? 'Swallowed! ' : ''}${c.sp.name}</div><div class="k">${c.kg.toFixed(2)}<em>kg</em></div>`;
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
    const n = D.SPECIES.filter(s => store.journal[s.id]).length;
    $('journalSub').textContent = n + ' of ' + D.SPECIES.length + ' species';
    $('shopSub').textContent = store.coins + ' coins · ' + gear().lineLen + ' m of line';
    $('keys').innerHTML = keyRows(mc);
    const a = mc.connected ? K(mc, 'a') : 'A';
    $('howCast').innerHTML = cfg.release ? 'Swing the rod back over your shoulder and snap it forward; harder goes further.' : 'Hold ' + kbd(a) + ', swing back, snap the rod forward and let go. Harder goes further; aim with where the rod stops.';
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

  // journal: a field guide, one sketched page per species
  function drawFishIcon(cv, sp, known) {
    const w = cv.width = 240, h = cv.height = 90, g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    const ink = known ? '#3a2a1a' : 'rgba(58,42,26,0.25)';
    const len = w * (sp.shape === 'eel' ? 0.86 : sp.shape === 'puffer' || sp.shape === 'angler' ? 0.5 : sp.shape === 'ray' ? 0.62 : 0.72), x0 = (w - len) / 2, cy = h / 2;
    const bh = Math.min(h * 0.82, len * (sp.shape === 'ray' ? 1.2 : sp.shape === 'eel' ? 0.12 : sp.look.h * 1.05));
    g.lineWidth = 2; g.strokeStyle = ink; g.lineJoin = 'round'; g.lineCap = 'round';
    if (known) { const gr = g.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2); gr.addColorStop(0, sp.look.back); gr.addColorStop(0.5, sp.look.side); gr.addColorStop(1, sp.look.belly); g.fillStyle = gr; }
    else g.fillStyle = 'rgba(58,42,26,0.08)';
    g.beginPath();
    if (sp.shape === 'puffer' || sp.shape === 'angler') {
      g.ellipse(x0 + len * 0.45, cy, len * 0.42, bh / 2, 0, 0, Math.PI * 2);
      g.moveTo(x0 + len * 0.86, cy); g.lineTo(x0 + len, cy - bh * 0.25); g.lineTo(x0 + len, cy + bh * 0.25); g.closePath();
    } else if (sp.shape === 'ray') {
      g.moveTo(x0, cy); g.quadraticCurveTo(x0 + len * 0.4, cy - bh / 2, x0 + len * 0.75, cy); g.quadraticCurveTo(x0 + len * 0.4, cy + bh / 2, x0, cy);
    } else if (sp.shape === 'squid') {
      g.moveTo(x0 + len * 0.35, cy - bh * 0.4); g.lineTo(x0 + len, cy); g.lineTo(x0 + len * 0.35, cy + bh * 0.4); g.closePath();
    } else if (sp.shape === 'eel') {
      g.moveTo(x0, cy); for (let k = 0; k <= 20; k++) { const x = x0 + len * k / 20; g.lineTo(x, cy - bh / 2 + Math.sin(k * 0.9) * 5); } for (let k = 20; k >= 0; k--) { const x = x0 + len * k / 20; g.lineTo(x, cy + bh / 2 + Math.sin(k * 0.9) * 5); } g.closePath();
    } else {
      const nose = sp.shape === 'pike' ? 0.05 : 0.15, jaw = sp.shape === 'gulper' ? 1.4 : 1;
      g.moveTo(x0, cy);
      g.bezierCurveTo(x0 + len * nose, cy - bh * 0.62 * jaw, x0 + len * 0.62, cy - bh * 0.5, x0 + len * 0.82, cy - bh * 0.06);
      g.lineTo(x0 + len, cy - bh * 0.42); g.lineTo(x0 + len * 0.95, cy); g.lineTo(x0 + len, cy + bh * 0.42); g.lineTo(x0 + len * 0.82, cy + bh * 0.06);
      g.bezierCurveTo(x0 + len * 0.62, cy + bh * 0.5, x0 + len * nose, cy + bh * 0.62 * jaw, x0, cy);
    }
    g.fill(); g.stroke();
    if (sp.shape === 'squid') for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x0 + len * 0.35, cy + (k - 2.5) * bh * 0.12); g.quadraticCurveTo(x0 + len * 0.15, cy + (k - 2.5) * bh * 0.2 + 6, x0, cy + (k - 2.5) * bh * 0.25); g.stroke(); }
    if (sp.shape === 'angler') { g.beginPath(); g.moveTo(x0 + len * 0.3, cy - bh * 0.45); g.quadraticCurveTo(x0 + len * 0.1, cy - bh * 0.9, x0 - 4, cy - bh * 0.5); g.stroke(); g.fillStyle = known ? '#9effe6' : ink; g.beginPath(); g.arc(x0 - 4, cy - bh * 0.5, 4, 0, Math.PI * 2); g.fill(); }
    if (sp.shape === 'scorpion') for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(x0 + len * (0.25 + k * 0.07), cy - bh * 0.42); g.lineTo(x0 + len * (0.27 + k * 0.07), cy - bh * 0.75); g.stroke(); }
    if (sp.shape === 'puffer' && known) for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; g.beginPath(); g.moveTo(x0 + len * 0.45 + Math.cos(a) * len * 0.42, cy + Math.sin(a) * bh / 2); g.lineTo(x0 + len * 0.45 + Math.cos(a) * len * 0.5, cy + Math.sin(a) * bh * 0.6); g.stroke(); }
    if (sp.shape !== 'ray' && sp.shape !== 'squid' && sp.shape !== 'eel') { g.fillStyle = ink; g.beginPath(); g.arc(x0 + len * (sp.shape === 'puffer' || sp.shape === 'angler' ? 0.18 : 0.1), cy - bh * 0.1, Math.max(2, bh * 0.07), 0, Math.PI * 2); g.fill(); }
  }
  function renderJournal() {
    const n = D.SPECIES.filter(s => store.journal[s.id]).length;
    $('journalCount').textContent = n + ' of ' + D.SPECIES.length + ' recorded · deepest ' + store.deepest + ' m';
    const box = $('species');
    box.innerHTML = '';
    for (const z of D.ZONES) {
      const list = D.SPECIES.filter(s => D.zoneAt((s.dmin + s.dmax) / 2).id === z.id);
      if (!list.length) continue;
      for (const sp of list) {
        const j = store.journal[sp.id];
        const el = document.createElement('div');
        el.className = 'sp' + (j ? '' : ' unknown') + (sp.legendary ? ' legend' : '');
        el.style.setProperty('--z', z.fog); el.title = z.name;
        const cv = document.createElement('canvas');
        drawFishIcon(cv, sp, !!j);
        el.appendChild(cv);
        const bb = j && D.bestBait(j);
        el.insertAdjacentHTML('beforeend', j
          ? `<div class="n">${sp.name}</div><div class="s">${j.best.toFixed(2)} kg record · ${j.n} caught</div><div class="s">${j.minD}-${j.maxD} m · bait: ${bb === 'worm' || !bb ? 'worm' : D.byId(bb).name}</div><div class="m">${sp.blurb}</div>`
          : `<div class="n">${sp.legendary ? 'Something golden' : 'Not yet seen'}</div><div class="s">${z.name} · ${sp.dmin}-${sp.dmax} m</div><div class="m">${sp.legendary ? 'Only a story so far.' : 'Keep diving.'}</div>`);
        box.appendChild(el);
      }
    }
  }
  // the tackle box: upgrades on the left, the bait well on the right
  function renderShop() {
    $('shopCoins').textContent = store.coins;
    $('shopTrays').innerHTML = Object.keys(D.UPGRADES).map(k => {
      const u = D.UPGRADES[k], lvl = store.gear[k] | 0, cost = D.upgradeCost(store, k), cur = u.vals[lvl], nxt = cost === null ? null : u.vals[lvl + 1];
      const fmt = v => k === 'strength' ? '+' + Math.round(v * 100) + '%' : k === 'light' && !v ? 'none' : v + (u.unit && u.unit !== 'x' ? ' ' + u.unit : u.unit === 'x' ? 'x' : '');
      const pips = u.vals.map((_, i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="tray"><div class="tn">${u.name}</div><div class="tb">${u.blurb}</div><div class="pips">${pips}</div>
        <div class="tv"><b>${fmt(cur)}</b>${nxt === null ? '' : ' &rarr; ' + fmt(nxt)}</div>
        <button class="nav ${cost === null || store.coins < cost ? 'disabled' : 'primary'}" data-act="buy:${k}">${cost === null ? 'Maxed' : cost + ' coins'}</button></div>`;
    }).join('');
    const baits = [{ i: 'worm', name: 'Worm', note: 'always in the tin' }].concat(store.baits.map((b, i) => ({ i, name: b.name, note: b.kg.toFixed(2) + ' kg · size ' + b.cls })));
    $('shopBaits').innerHTML = baits.map(b => `<button class="nav bait ${String(store.bait) === String(b.i) ? 'sel' : ''}" data-act="bait:${b.i}"><b>${b.name}</b><small>${b.note}</small></button>`).join('');
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
      case 'shop': synth.ui('ok'); shopFrom = state; renderShop(); setScreen('shop'); break;
      case 'shopBack': synth.ui('back'); setScreen(shopFrom); if (shopFrom === 'title') renderTitle(); break;
      case 'buy': if (D.buy(store, v)) { save(); synth.fanfare(1); renderShop(); } else synth.ui('back'); break;
      case 'bait': store.bait = v === 'worm' ? 'worm' : +v; save(); synth.ui('move'); renderShop(); if (sess) sess.players.forEach(p => { p.bait = D.currentBait(store); }); break;
      case 'sell': case 'keep': case 'release': if (sess) { const p = sess.players[0]; if (!(k === 'keep' && p.lastCatch && p.lastCatch.sp.cls >= 3)) decide(p, { sell: 0, keep: 1, release: 2 }[k]); } break;
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
      else if (state === 'shop') act('shopBack');
      else if (state !== 'title') toTitle();
    }
    if (k === 'Enter' && state === 'align') act('alignGo');
    if (choosing() && (k === 'ArrowLeft' || k === 'ArrowRight')) { const p = sess.players[0]; p.choice = clamp(p.choice + (k === 'ArrowLeft' ? -1 : 1), 0, 2); renderChoice(p); }
    if (choosing() && k === 'Enter') decide(sess.players[0], sess.players[0].choice);
  });
  addEventListener('keyup', e => { if (e.key === ' ') lobby.keyDown = false; });

  /** Phone buttons outside play: B backs out, Center on the align screen starts. */
  function phoneMenus() {
    if (!mc.connected || mc.source !== 'phone') return;
    if (state === 'align' && mc.pressed('center')) act('alignGo');
    else if (mc.pressed('b')) {
      if (state === 'pause') resume();
      else if (state === 'settings') act('setBack');
      else if (state === 'shop') act('shopBack');
      else if (state === 'journal' || state === 'align' || state === 'results') toTitle();
    }
  }
  function playButtons() {
    for (const p of sess.players) {
      const c = p.mc;
      if (c.source === 'phone' && (c.pressed('b') || c.pressed('home') || c.pressed('plus'))) { pause(); return; }
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

  // ------------------------------------------------------------------ the camera director
  // Solo: follows the cast out, plunges under with the lure and rides behind it, closes in on a
  // bite, pulls back to frame the fish and the line through the fight, and brings the catch up
  // to the dock for a close-up. Dock Party: a side-on aquarium through the glass, every lure in view.
  const shot = { pos: new T.Vector3(), look: new T.Vector3(), key: null, fov: 0, speed: 2 };
  const _k = new T.Vector3(), _F = new T.Vector3();
  function cameraShot() {
    if (window.__tc && __tc.shotOverride) return __tc.shotOverride;   // test hook: review shots
    if (!sess || sess.over) return null;
    const V = W.view, base = W.baseFov;
    shot.key = null; shot.fov = base; shot.speed = 2; shot.pos.copy(V.pos); shot.look.copy(V.look);
    if (sess.party) {
      const under = sess.players.filter(p => p.lureD || (p.st === 'fight' && p.fpos));
      if (!under.length) return null;
      let x = 0, lo = 0, hi = -1e9;
      under.forEach(p => { const c = p.st === 'fight' && p.fpos ? p.fpos : p.lureD; x += c.x; lo = Math.min(lo, c.y); hi = Math.max(hi, c.y); });
      x = clamp(x / under.length, -4, 4); const y = Math.min(-3, (lo + hi) / 2), spread = hi - lo;
      shot.pos.set(x, y + 1, PLANE_Z + 10.5); shot.look.set(x, y - 0.5, PLANE_Z); shot.fov = clamp(62 + spread * 1.6, 62, 92); shot.speed = 1.6;
      return shot;
    }
    const p = sess.players[0];
    if (p.st === 'catch' && p.holder) {
      const len = p.lastCatch.cm / 100, d = 1.0 + len * 1.9;
      _F.copy(p.holder.position); _F.y -= len * 0.42;
      shot.pos.set(_F.x - d * 0.55, _F.y + d * 0.12, _F.z + d * 0.85);
      shot.look.set(_F.x + 0.84 * d * 0.38, _F.y, _F.z + 0.54 * d * 0.38);   // fish left of centre, clear of the catch card
      shot.key = _k.set(_F.x - d * 0.4, _F.y + 0.3, _F.z + d * 0.6); shot.speed = 2.5;
    } else if (p.st === 'flight') {
      shot.look.lerp(_F.set(p.lure.x, p.lure.y, p.lure.z), 0.6); shot.pos.y += 0.5; shot.speed = 3;
    } else if (p.st === 'dive' && p.stT < 0.6 && p.lureD) {
      // the splash: watch it go in from just above the water, then follow it down
      const lu = p.lureD;
      shot.pos.set(lu.ox - Math.sin(lu.heading) * 3.2, 1.1, lu.oz + Math.cos(lu.heading) * 3.2); shot.look.set(lu.ox, -0.3, lu.oz); shot.speed = 6; shot.fov = base * 0.9;
    } else if ((p.st === 'dive' || p.st === 'bite') && p.lureD) {
      const lu = p.lureD, h = lu.heading, back = p.st === 'bite' ? 2.4 : 3.3;
      // behind and a little above it, leading by where it is heading (down, when it sinks fast)
      const lead = clamp(lu.vy * 0.35, -1.2, 0.6);
      shot.pos.set(lu.x - Math.sin(h) * back, Math.min(-1.8, lu.y + 0.8 + lead * 0.5), lu.z + Math.cos(h) * back);
      shot.look.set(lu.x + Math.sin(h) * 2.2, lu.y - 0.3 + lead, lu.z - Math.cos(h) * 2.2);
      shot.speed = p.stT < 1.2 && p.st === 'dive' ? 3 : 5; shot.fov = p.st === 'bite' ? base * 0.85 : base * 1.05;
    } else if (p.st === 'lift' && p.fpos) {
      // ride up with it and break the surface together
      shot.pos.set(p.fpos.x + 1.6, p.fpos.y - 0.4, p.fpos.z + 2.4); shot.look.set(p.fpos.x, p.fpos.y + 0.2, p.fpos.z); shot.speed = 7;
    } else if (p.st === 'fight' && p.fpos) {
      const fp = p.fpos, dx = p.hk.ox - fp.x, dz = p.hk.oz - fp.z, dl = Math.hypot(dx, dz) || 1, far = 2.8 + p.fish.cm / 45;
      shot.pos.set(fp.x + dx / dl * far * 0.55 + (-dz / dl) * far * 0.75, Math.min(-1.8, fp.y + 1.1), fp.z + dz / dl * far * 0.55 + (dx / dl) * far * 0.75);
      shot.look.set(fp.x, fp.y + 0.3, fp.z); shot.speed = 2.6; shot.fov = base * 1.05;
    } else return null;
    return shot;
  }
  let perfT = 0, perfN = 0, perfSum = 0;
  /** Frame rate into the play recording every 10 s, so a session can be judged afterwards. */
  function perfLog(dt) {
    if (state !== 'play') return;
    perfT += dt; perfN++; perfSum += dt;
    if (perfT < 10) return;
    rec('perf', { fps: +(perfN / perfSum).toFixed(1), pr: +dyn.pr.toFixed(2), q: dyn.q, under: deep.active, fish: sess ? sess.deepFish.length : 0 });
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
    if (state === 'title' || state === 'lobby' || state === 'journal' || ((state === 'settings' || state === 'shop') && !sess) || state === 'align') {
      titleT += dt;
      buildDemo();
      updateDemo(titleT);
      W.frameFor(0);
    }
    W.update(state === 'pause' ? 0 : dt);
    W.updateCamera(state === 'pause' ? 0 : dt, cameraShot());
    const camY = W.camera.position.y;
    const wasUnder = deep.active;
    deep.setActive(camY < -0.15 && !!sess);
    if (wasUnder !== deep.active) {
      const wl = $('waterline'); wl.className = ''; void wl.offsetWidth; wl.className = deep.active ? 'plunge' : 'breach';
      synth.setUnder(deep.active); document.body.classList.toggle('under', deep.active);
    }
    if (deep.active) document.body.style.setProperty('--uwEdge', 'rgba(0,' + Math.round(clamp(30 - (-camY) * 0.15, 2, 30)) + ',' + Math.round(clamp(45 - (-camY) * 0.2, 4, 45)) + ',' + clamp(0.45 + (-camY) * 0.004, 0.45, 0.85).toFixed(2) + ')');
    if (wasUnder && !deep.active) W.setDay(sess ? (sess.dur > 0 ? 0.05 + 0.95 * clamp(sess.t / sess.dur, 0, 1) : 0.08 + 0.85 * clamp(sess.t / 900, 0, 1)) : 0.08, true);
    if (!wasUnder && deep.active) { synth.splash(0.3, false); }
    const lamp = sess && sess.players.some(p => p.lureD) ? gear().light : 0;
    deep.update(state === 'pause' ? 0 : dt, -camY, lamp);
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
    get state() { return state; }, get sess() { return sess; }, get dyn() { return dyn; }, cfg, store, act, W, L, D, deep,
    setScreen, startSolo, goSolo, openLobby, finishSession, pause, toTitle, save,
    /** Put a fish of a species on the given player's lure right now (screenshots / bots). */
    forceBite(i, species) {
      const p = sess.players[i || 0];
      if (p.st !== 'dive') return false;
      const lu = p.lureD, f = spawnDeep(D.byId(species || 'bass'), lu.x + 0.4, lu.y, lu.z, true);
      f.lure = p.lure.id; p.lure.claimed = f.id; f.state = 'strike'; f.t = 9;
      deepEvent({ type: 'strike', fish: f, lure: p.lure }, performance.now() / 1000);
      return true;
    },
    forceHook(i, q) { const p = sess.players[i || 0]; if (p.st === 'bite') hook(p, q || 0.7); return p.st; },
    forceLand(i) { const p = sess.players[i || 0]; if (p.fight) { p.fight.S = 0.05; p.fight.d = p.fight.line = 2.5; L.beginPhase(p.fight, 'rest', Math.random); p.fight.pDur = 9; } },
    /** Send a predator after the hooked fish (the eat chain). */
    forcePredator(i, species) {
      const p = sess.players[i || 0];
      if (p.st !== 'fight') return false;
      const f = spawnDeep(D.byId(species || 'pike'), p.fpos.x + 5, p.fpos.y, p.fpos.z, true);
      f.state = 'chase'; f.preyFish = p.fish; f.t = 8; f.cool = 0;
      p.forcedHunter = f;
      return true;
    },
    castAt(i, d, heading) {   // splash the lure at d metres, heading rad (as if cast)
      const p = sess.players[i || 0], l = p.lure;
      l.x = p.x + Math.sin(heading || 0) * d; l.z = 0.1 - Math.cos(heading || 0) * d; l.y = 0;
      l.launch = { timing: 'clean', power: 0.6 }; land(p);
    },
  };
})();
