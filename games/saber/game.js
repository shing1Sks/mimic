/*
 * Cadence Cut - game loop, hit detection, scoring, UI.
 * Object positions are a pure function of (event time - song clock); the song clock is read from
 * the AudioContext output timestamp, the same clock the music (sequenced or decoded) runs on.
 */
(function () {
  'use strict';
  const T = THREE, A = CadenceAudio, SG = CadenceSongs, SW = CadenceSweep, LG = CadenceLogic;
  const W = CadenceScene.createWorld(document.getElementById('gl'));
  const LAY = W.LAYOUT;
  const mc = new MimicController();
  let HAND = 'right';   // the playing hand (Settings); the arm model and hilt mirror for 'left'
  mc.setHand(HAND);
  const synth = new A.Synth();
  const $ = id => document.getElementById(id);

  // ---------- tuning ----------
  const DIR_TOL = 70 * Math.PI / 180;  // allowed deviation from the arrow
  const BOX_HALF = LAY.BLOCK / 2 + 0.07;
  const LINK_HALF = LAY.BLOCK * 0.25 + 0.08;
  const BOMB_HALF = 0.15;
  const MISS_Z = 0.9;
  const ARC_TOL = 0.2;                  // screen units (NDC height) the blade may stray from the bead
  const laneX = l => LAY.LANE_X[0] + l * (LAY.LANE_X[1] - LAY.LANE_X[0]);
  const rowY = r => LAY.ROW_Y[0] + r * (LAY.ROW_Y[1] - LAY.ROW_Y[0]);

  // ---------- storage ----------
  const STORE_KEY = 'cadencecut.v2';
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s) return s;
      const v1 = JSON.parse(localStorage.getItem('cadencecut.v1'));
      return v1 ? { best: v1.best || {} } : {};
    } catch (e) { return {}; }
  }
  function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } }
  const store = loadStore();
  store.best = store.best || {}; store.stars = store.stars || {}; store.mods = (store.mods || []).filter(k => LG.MODS[k]);
  const DIFF_KEYS = ['easy', 'normal', 'hard'];
  const songIndex = id => Math.max(0, SG.SONGS.findIndex(s => s.id === id));
  const sel = {
    tab: store.tab === 'free' ? 'free' : 'campaign',
    stage: Math.max(0, Math.min(LG.CAMPAIGN.length - 1, store.lastStage | 0)),
    song: Math.max(0, Math.min(SG.SONGS.length - 1, store.lastSong | 0)),
    diff: DIFF_KEYS.indexOf(store.lastDiff) >= 0 ? store.lastDiff : 'normal',
    mods: store.mods.slice(),
  };
  if (!LG.stageUnlocked(sel.stage, store.stars)) sel.stage = 0;

  // ---------- settings (Settings screen, from the menu or the pause screen) ----------
  // music / sfx: 0..10 (tenths); fx: 0 full, 1 reduced (no beat flashes, camera shake or kicks);
  // gfx: 0 auto (full detail, render scale gives way only while the frame rate stays low), 1 high, 2 low
  const SET_N = { music: 11, sfx: 11, fx: 2, gfx: 3, hand: 2 };
  const cfg = Object.assign({ music: 10, sfx: 10, fx: 0, gfx: 0, hand: 0 }, store.settings || {});
  Object.keys(SET_N).forEach(k => { cfg[k] = Math.max(0, Math.min(SET_N[k] - 1, cfg[k] | 0)); });
  const FX_NAMES = ['Full', 'Reduced'], GFX_NAMES = ['Auto', 'High', 'Low'], HAND_NAMES = ['Right', 'Left'];
  function applySettings() {
    synth.setVolumes(cfg.music / 10, cfg.sfx / 10);
    setHand(cfg.hand ? 'left' : 'right');
    dyn.t = dyn.n = dyn.sum = 0;
    if (cfg.gfx === 1) setPR(PR_MAX); else if (cfg.gfx === 2) setPR(Math.min(dyn.pr, PR_LOW));
  }
  function renderSettings() {
    $('set-music').textContent = cfg.music * 10 + '%';
    $('set-sfx').textContent = cfg.sfx * 10 + '%';
    $('set-fx').textContent = FX_NAMES[cfg.fx];
    $('set-gfx').textContent = GFX_NAMES[cfg.gfx];
    $('set-hand').textContent = HAND_NAMES[cfg.hand];
    $('set-note').textContent = cfg.gfx === 0 ? 'Auto lowers the render scale only while the frame rate stays low.' + (dyn.pr < PR_MAX - 1e-3 ? ' Now ' + Math.round(dyn.pr / PR_MAX * 100) + '%.' : '')
      : cfg.gfx === 1 ? 'Always full resolution.' : 'Lighter render scale for slower PCs.';
  }
  function changeSetting(k, d) {
    cfg[k] = Math.max(0, Math.min(SET_N[k] - 1, cfg[k] + d));
    store.settings = Object.assign({}, cfg); saveStore();
    applySettings(); renderSettings();
    synth.sfxUi('move');
  }
  let settingsFrom = 'menu';

  // ---------- render scale ----------
  const PR_MAX = Math.min(window.devicePixelRatio || 1, 1.25), PR_MIN = Math.min(PR_MAX, 0.6), PR_LOW = Math.min(PR_MAX, 0.85);
  const dyn = { pr: PR_MAX, t: 0, n: 0, sum: 0 };
  function setPR(pr) { if (Math.abs(pr - dyn.pr) > 1e-3) { dyn.pr = pr; W.renderer.setPixelRatio(pr); } }
  function dynResolution(rdt) {
    dyn.t += rdt; dyn.n++; dyn.sum += rdt;
    if (dyn.t < 1) return;
    const fps = dyn.n / dyn.sum, top = cfg.gfx === 2 ? PR_LOW : PR_MAX;
    if (cfg.gfx === 1) setPR(PR_MAX);
    else if (fps < 52) setPR(Math.max(PR_MIN, dyn.pr - (fps < 40 ? 0.15 : 0.07)));
    else if (fps > 58.5) setPR(Math.min(top, dyn.pr + 0.05));
    dyn.t = dyn.n = dyn.sum = 0;
  }

  let state = 'splash';
  let game = null;
  let play = null;   // what the next startSong plays: { song, diff, features, stage }

  // ---------- blade state ----------
  // The hilt rides the arm model: mc.arm.hand is metres from the player's head and the camera is
  // the head, so hilt = camera + hand * ARM_SCALE. The blade points along the phone 1:1, set into
  // the hilt with a fixed upward tilt (in the phone's own frame, so it stays rigid as you twist).
  const qOff = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), LAY.PITCH_OFF);
  const bladeQ = new T.Quaternion();
  const dir = new T.Vector3(0, 0, -1), prevDir = new T.Vector3(0, 0, -1);
  const hilt = LAY.HILT.clone(), prevHilt = LAY.HILT.clone();
  const tip = new T.Vector3(), prevTip = new T.Vector3();
  const tipHist = [];
  const stroke = { arc: 0, dx: 0, dy: 0, quiet: 0 };
  let bladeSpeed = 0;
  let firstBlade = true;

  const _v = new T.Vector3(), _d = new T.Vector3(), _c = new T.Vector3(), _h = new T.Vector3();

  function nlerp(a, b, f, out) { return out.copy(a).lerp(b, f).normalize(); }
  function hiltFromHand(hand, out) { return out.set(hand.x, hand.y, hand.z).multiplyScalar(LAY.ARM_SCALE).add(W.camBase); }

  // mc.arm turns the upper arm by the short way round (q^0.4), so when the whole rotation passes
  // 180 deg (e.g. pointing at the floor with a twisted wrist) the elbow flips sides and the hilt
  // jumps. Same arm, but the elbow's share is tracked continuously through 180 deg (sweep.js).
  // Left hand: the same, mirrored (sweep.js continuousHand).
  const ELBOW_SHARE = 0.4;              // MimicMath arm model's upper-arm share
  let armState = {};
  function continuousHand(q, dt) {
    // after an excursion past 180 deg, ease back to the usual arm, mostly while the player moves
    return SW.continuousHand(q, mc.arm, HAND, armState, dt * (0.6 + 0.15 * mc.angularSpeed), MimicMath, ELBOW_SHARE);
  }
  function setHand(side) {
    if (side === HAND) return;
    HAND = side; mc.setHand(side); armState = {}; firstBlade = true;
  }

  function updateBlade(dt, nowS) {
    const q = mc.quat;
    bladeQ.set(q.x, q.y, q.z, q.w).multiply(qOff);
    prevDir.copy(dir); prevHilt.copy(hilt);
    dir.set(0, 0, -1).applyQuaternion(bladeQ);
    hiltFromHand(continuousHand(q, dt), hilt);
    if (firstBlade) { prevDir.copy(dir); prevHilt.copy(hilt); firstBlade = false; }
    W.blade.position.copy(hilt);
    W.blade.quaternion.copy(bladeQ);

    const ang = prevDir.angleTo(dir);
    const K = Math.min(10, Math.max(Math.ceil(ang / 0.035), Math.ceil(prevHilt.distanceTo(hilt) / 0.05)));
    if (K <= 1) W.pushTrail(hilt, dir, nowS);
    else for (let k = 1; k <= K; k++) W.pushTrail(_h.lerpVectors(prevHilt, hilt, k / K), nlerp(prevDir, dir, k / K, _d), nowS - dt * (1 - k / K));

    prevTip.copy(tip);
    tip.copy(hilt).addScaledVector(dir, LAY.BLADE_LEN);
    if (tipHist.length === 0) prevTip.copy(tip);
    // swing arc in radians-equivalent: the blade's turn, or the tip's travel when the whole arm moves
    const arcStep = Math.max(ang, tip.distanceTo(prevTip) / LAY.BLADE_LEN);
    tipHist.push({ t: nowS, x: tip.x, y: tip.y, z: tip.z });
    while (tipHist.length > 2 && nowS - tipHist[0].t > 0.25) tipHist.shift();

    const mx = tip.x - prevTip.x, my = tip.y - prevTip.y;
    const ml = Math.hypot(mx, my);
    const sp = ml / Math.max(dt, 1e-3);
    bladeSpeed += (sp - bladeSpeed) * Math.min(1, dt * 14);
    if (sp > 1.5) {
      const ux = mx / ml, uy = my / ml;
      if (stroke.arc > 0 && ux * stroke.dx + uy * stroke.dy > 0.5) {
        stroke.arc += arcStep;
        const nx = stroke.dx * 0.6 + ux * 0.4, ny = stroke.dy * 0.6 + uy * 0.4, nl = Math.hypot(nx, ny) || 1;
        stroke.dx = nx / nl; stroke.dy = ny / nl;
      } else { stroke.arc = arcStep; stroke.dx = ux; stroke.dy = uy; }
      stroke.quiet = 0;
    } else {
      stroke.quiet += dt;
      if (stroke.quiet > 0.09) stroke.arc = 0;
    }
    const glow = Math.min(1, bladeSpeed / 14);
    W.glowA.uniforms.uInt.value = 1.0 + glow * 0.9;
    W.glowB.uniforms.uInt.value = 0.4 + glow * 0.5;
    W.tipSprite.scale.setScalar(0.45 + glow * 0.35);
  }

  function tipVelocity(nowS, out) {
    // velocity over a ~45 ms window: robust to uneven frame and Bluetooth timing
    let old = tipHist[0];
    for (let i = tipHist.length - 1; i >= 0; i--) { if (nowS - tipHist[i].t >= 0.045) { old = tipHist[i]; break; } }
    const dt = Math.max(1e-3, nowS - old.t);
    return out.set((tip.x - old.x) / dt, (tip.y - old.y) / dt, (tip.z - old.z) / dt);
  }

  // ---------- audio clock ----------
  function audioTime() {
    const ctx = synth.ctx;
    const base = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    if (ctx.getOutputTimestamp) {
      // output timestamp gives a smooth, latency-correct clock; fall back if it is stale (e.g. right after resume)
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const est = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (Math.abs(est - base) < 0.12) return est;
      }
    }
    return base;
  }
  function songClock() {
    let t = audioTime() - game.start;
    if (t < game.clock) t = game.clock; // never run backwards
    game.clock = t;
    return t;
  }

  // ---------- track loading ----------
  const trackBuf = {};
  let loadState = 'idle';
  function ensureTrack(song) {
    if (!song.file || trackBuf[song.id]) { loadState = 'ready'; return Promise.resolve(); }
    loadState = 'loading';
    return A.loadTrack(synth, song.file).then(buf => {
      trackBuf[song.id] = buf;
      if (play && play.song === song) loadState = 'ready';
      if (state === 'calib') renderCalib();
    }, err => {
      loadState = 'error';
      console.warn('track load failed', err);
      if (state === 'calib') renderCalib();
    });
  }

  // ---------- game lifecycle ----------
  function clearObjs() {
    if (!game) return;
    game.objs.forEach(o => W.removeObj(o.g));
    game.objs.length = 0;
  }

  function buildPlay() {
    if (sel.tab === 'campaign') {
      const st = LG.CAMPAIGN[sel.stage];
      return { song: SG.SONGS[songIndex(st.song)], diff: st.diff, features: st.features, stage: st, stageIdx: sel.stage };
    }
    return { song: SG.SONGS[sel.song], diff: sel.diff, features: LG.freeFeatures(sel.diff), stage: null };
  }

  function startSong() {
    const P = play, song = P.song;
    const chart = SG.buildChart(song, P.diff, { features: P.features });
    synth.init();
    if (game) { if (game.player) game.player.stop(0.05); clearObjs(); }
    const mods = sel.mods.slice();
    const speed = chart.speed * (mods.indexOf('swift') >= 0 ? LG.MODS.swift.speed : 1);
    const lead = LAY.SPAWN_DIST / speed;
    const events = chart.notes.map(n => ({ kind: n.kind === 'heavy' ? 'heavy' : 'block', at: n.time, n }))
      .concat(chart.extras.map(e => ({ kind: e.type, at: e.t0 !== undefined ? e.t0 : e.time, n: e })))
      .sort((a, b) => a.at - b.at);
    game = {
      song, chart, diffKey: P.diff, stage: P.stage, stageIdx: P.stageIdx, mods, modMul: LG.modMultiplier(mods), lead, speed, events,
      start: synth.ctx.currentTime + 1.0, clock: -1, next: 0, objs: [],
      score: 0, combo: 0, maxCombo: 0, mult: 1, multProg: 0, energy: 0.6,
      hits: 0, bad: 0, miss: 0, rawSum: 0, failed: false, ended: false,
      surge: 0, surgeT: 0, secIdx: -1, wallLean: 0,
      st: { heavy: 0, heavyOk: 0, mines: 0, minesHit: 0, arcs: 0, arcFrac: 0, walls: 0, dodged: 0, links: 0, linksCut: 0, power: 0, powerN: 0 },
      lastNote: chart.notes.length ? chart.notes[chart.notes.length - 1].time : 0,
      chordTone: 0, buzzAt: 0,
    };
    game.player = song.file ? new A.FilePlayer(synth, song, trackBuf[song.id], game.start) : new A.Player(synth, song, game.start);
    $('hudSong').textContent = (P.stage ? P.stage.title + ' · ' : '') + song.title;
    $('hudDiff').textContent = chart.label;
    $('hudMods').textContent = mods.map(k => LG.MODS[k].label).join(' · ');
    setScreen('play');
    banner(P.stage ? P.stage.title : song.title, false);
    updateHud(true);
  }

  // ---------- spawning ----------
  function spawn(ev) {
    const n = ev.n, g0 = game;
    let o;
    if (ev.kind === 'block' || ev.kind === 'heavy') {
      const heavy = ev.kind === 'heavy';
      const g = heavy ? W.makeHeavy(n.dir < 0) : W.makeBlock(n.dir < 0);
      const d = n.dir >= 0 ? SG.DIRS[n.dir] : null;
      o = { kind: ev.kind, n, g, time: n.time, angle: d ? Math.atan2(d.y, d.x) + Math.PI / 2 : 0, x: laneX(n.lane), y: rowY(n.row), spin: n.lane < 2 ? -1 : 1, enter: n.enter | 0 };
      if (heavy) g0.st.heavy++;
    } else if (ev.kind === 'link') {
      o = { kind: 'link', n, g: W.makeLink(), time: n.time, x: laneX(n.lane), y: rowY(n.row), angle: 0, enter: -1 };
      g0.st.links++;
    } else if (ev.kind === 'bomb') {
      o = { kind: 'bomb', n, g: W.makeBomb(), time: n.time, x: laneX(n.lane), y: rowY(n.row), angle: 0, enter: -1 };
      g0.st.mines++;
    } else if (ev.kind === 'wall') {
      const left = n.lanes[0] === 0;
      const x0 = left ? -1.42 : 0.04, x1 = left ? -0.04 : 1.42;
      o = { kind: 'wall', n, g: W.makeWall(x0, x1, (n.t1 - n.t0) * g0.speed), t0: n.t0, t1: n.t1, x0, x1, hit: false, inside: false };
      g0.st.walls++;
    } else if (ev.kind === 'arc') {
      const a = n.from, b = n.to;
      const fx = laneX(a.lane), fy = rowY(a.row), tx = laneX(b.lane), ty = rowY(b.row);
      const dd = a.dir >= 0 ? SG.DIRS[a.dir] : { x: 0, y: 0 };
      const sx = fx + dd.x * 0.32, sy = fy + dd.y * 0.32;
      const dur = n.t1 - n.t0, pts = [];
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const s = i / N, e = s * s * (3 - 2 * s), bul = Math.sin(Math.PI * s) * (1 - s) * 0.45;
        pts.push(new T.Vector3(sx + (tx - sx) * e + dd.x * bul, sy + (ty - sy) * e + dd.y * bul, -s * dur * g0.speed));
      }
      o = { kind: 'arc', n, g: W.makeArc(pts), t0: n.t0, t1: n.t1, pts, tracked: 0, total: 0, tickAt: 0 };
      g0.st.arcs++;
    }
    o.z = -999;
    g0.objs.push(o);
  }

  function placeObj(o, t) {
    const g = game;
    if (o.kind === 'wall' || o.kind === 'arc') {
      o.z = LAY.HIT_Z - (o.t0 - t) * g.speed;
      o.g.position.set(0, 0, o.z);
      return;
    }
    const ahead = o.time - t;
    o.zPrev = o.z < -900 ? LAY.HIT_Z - ahead * g.speed : o.z;
    o.z = LAY.HIT_Z - ahead * g.speed;
    const travel = 1 - ahead / g.lead;
    const s = Math.min(1, Math.max(0.01, travel * 5));
    if (o.kind === 'bomb') {
      o.g.position.set(o.x, o.y, o.z);
      o.g.rotation.set(t * 1.3, t * 1.9, 0);
      const p = 0.5 + 0.5 * Math.sin(t * 12);
      o.g.userData.glow.scale.setScalar(0.45 + 0.2 * p);
      o.g.scale.setScalar(s);
      return;
    }
    if (o.kind === 'link') {
      o.g.position.set(o.x, o.y, o.z);
      o.g.rotation.set(0, 0, Math.PI / 4);
      o.g.scale.setScalar(s);
      return;
    }
    const e = Math.min(1, Math.max(0, travel / 0.5));
    const ease = 1 - Math.pow(1 - e, 3), k = 1 - ease;
    let x = o.x, y = o.y, rot = o.angle;
    switch (o.enter) {
      case 1: y += k * 2.6; break;                                  // drops in from above
      case 2: y -= k * 1.7; rot += k * Math.PI * 0.5 * o.spin; break; // rises out of the floor
      case 3: { const ph = k * 5 + o.x; x += Math.cos(ph) * k * 1.5; y += Math.sin(ph) * k * 1.1; rot += k * Math.PI * 1.5 * o.spin; break; } // swirls in
      default: y += k * 0.6; rot += k * Math.PI * 0.75 * o.spin;
    }
    o.g.position.set(x, y, o.z);
    o.g.rotation.set(0, 0, rot);
    let sc = s;
    if (g.mods.indexOf('vanish') >= 0) sc *= Math.min(1, Math.max(0, (ahead - 0.42) / 0.16));
    o.g.scale.setScalar(Math.max(0.001, sc));
    if (o.kind === 'heavy') o.g.userData.shell.rotation.set(t * 0.8, t * 1.1, 0);
  }

  function removeAt(i) { W.removeObj(game.objs[i].g); game.objs.splice(i, 1); }

  function updatePlay(dt, nowS) {
    const g = game;
    const t = songClock();
    while (g.next < g.events.length && g.events[g.next].at - t <= g.lead) { spawn(g.events[g.next]); g.next++; }
    for (let i = 0; i < g.objs.length; i++) placeObj(g.objs[i], t);

    if (!g.failed) { tryCuts(nowS, t); updateWalls(dt, nowS, t); updateArcs(dt, nowS, t); }

    for (let i = g.objs.length - 1; i >= 0; i--) {
      const o = g.objs[i];
      if (o.kind === 'wall') { if (LAY.HIT_Z - (o.t1 - t) * g.speed > 3.5) removeAt(i); continue; }
      if (o.kind === 'arc') { if (t > o.t1 + 0.4) removeAt(i); continue; }
      if (o.z > MISS_Z) {
        removeAt(i);
        if (!g.failed && (o.kind === 'block' || o.kind === 'heavy')) judgeMiss(o);
      }
    }

    // surge timer
    if (g.surgeT > 0) {
      g.surgeT -= dt;
      if (g.surgeT <= 0) { g.surgeT = 0; banner('Surge over', false); }
    }

    // section call-outs
    const bar = Math.floor(t / (4 * g.song.beatDur));
    if (bar >= 0 && bar < g.song.totalBars) {
      const sec = g.song.barSections[bar];
      const si = g.song.sections.indexOf(sec);
      if (si !== g.secIdx) {
        const prev = g.song.sections[g.secIdx];
        g.secIdx = si;
        if (prev && !sec.rest && t > 2) {
          if (sec.intensity === 3 && prev.intensity < 3) { banner('Drop', false); W.shockwave(new T.Vector3(0, 1.4, -8), 9, g.song.accent); dropFlash = 1; }
          else if (sec.intensity === 0 && prev.intensity >= 2) banner('Breathe', false);
        }
      }
    }

    $('progress').style.width = Math.max(0, Math.min(100, t / g.song.duration * 100)) + '%';

    if (!g.ended) {
      if (g.failed && nowS > g.failAt + 1.6) finish();
      else if (!g.failed && g.next >= g.events.length && !g.objs.some(o => o.kind === 'block' || o.kind === 'heavy') && t > g.lastNote + 0.6) {
        if (!g.clearShown) { g.clearShown = true; banner(g.miss === 0 && g.bad === 0 ? 'Full chain' : 'Song cleared', false); }
        if (t > Math.min(g.song.duration + 0.3, g.lastNote + 4.5)) finish();
      }
    }
    return t;
  }

  // Sweep the cutting part of the blade from last frame's arm-modelled pose to this frame's, judged
  // on screen the way the player sees it (sweep.js). Blocks, links and mines are all tested here.
  const CUT_AHEAD = 1.3;                // m before the hit line a block becomes cuttable
  const _sp = new T.Vector3();
  /** Point -> screen (NDC, x scaled by aspect so squares stay square). */
  function toScreen(p) {
    _sp.copy(p).project(W.camera);
    return { x: _sp.x * W.camera.aspect, y: _sp.y };
  }
  // The same projection for the blade, which can point behind the camera: sweep.js clips it to the
  // part in front (a point behind the camera would project mirrored) and steps big swings in 3D.
  const _vw = new T.Vector3();
  const bladeCam = {
    view(p) { _vw.set(p.x, p.y, p.z).applyMatrix4(W.camera.matrixWorldInverse); return { x: _vw.x, y: _vw.y, z: _vw.z }; },
    get f() { return W.camera.projectionMatrix.elements[5]; },
    near: 0.3,
  };
  /** The blade's part from s0 to s1 on screen (clipped to what is in front of the camera), or null. */
  function bladeOnScreen(s0, s1) { return SW.screenSeg(hilt, dir, s0, s1, bladeCam); }
  function tryCuts(nowS) {
    const g = game;
    if (prevDir.angleTo(dir) < 1e-4 && prevHilt.distanceToSquared(hilt) < 1e-10) return;
    const vel = tipVelocity(nowS, _v.clone());
    const speed2 = Math.hypot(vel.x, vel.y);
    if (speed2 < 0.6) return;
    const path = SW.bladeScreenPath(prevHilt, prevDir, hilt, dir, LAY.BLADE_CUT_FROM, LAY.BLADE_LEN, bladeCam);
    const c = new T.Vector3();
    for (let i = 0; i < g.objs.length; i++) {
      const o = g.objs[i];
      if (o.cut || o.z === undefined || o.kind === 'wall' || o.kind === 'arc') continue;
      if (o.z < LAY.HIT_Z - CUT_AHEAD || o.z > MISS_Z) continue;
      if (o.kind !== 'bomb' && speed2 < LG.MIN_SPEED) continue;
      const half = o.kind === 'link' ? LINK_HALF : o.kind === 'bomb' ? BOMB_HALF : BOX_HALF;
      c.set(o.x, o.y, o.z);
      const ctr = toScreen(c);
      const edge = toScreen(_c.set(o.x + half, o.y + half, o.z));
      const hs = Math.max(Math.abs(edge.x - ctr.x), Math.abs(edge.y - ctr.y));
      const r = SW.pathSweepHits(path, { cx: ctr.x, cy: ctr.y, hw: hs, hh: hs });
      if (!r.hit) continue;
      // cut direction: how the blade point that touched the block moved on screen at that moment
      const ml = Math.hypot(r.motion.x, r.motion.y) || 1;
      const cutDir = { x: r.motion.x / ml, y: r.motion.y / ml };
      if (o.kind === 'bomb') hitBomb(o, c.clone());
      else if (o.kind === 'link') cutLink(o, c.clone(), cutDir);
      else judgeCut(o, nlerp(prevDir, dir, r.f, new T.Vector3()), c.clone(), cutDir, speed2);
    }
    for (let i = g.objs.length - 1; i >= 0; i--) if (g.objs[i].cut) { if (!g.objs[i].kept) W.removeObj(g.objs[i].g); g.objs.splice(i, 1); }
  }

  function addPoints(raw) {
    const g = game;
    const pts = Math.round(raw * g.mult * (g.surgeT > 0 ? 2 : 1) * g.modMul);
    g.score += pts;
    return pts;
  }

  /** cutDir: unit screen direction of the blade's motion at the contact (x right, y up). */
  function judgeCut(o, bladeDir, contact, cutDir, speed2) {
    const g = game;
    o.cut = true;
    const heavy = o.kind === 'heavy';
    const ux = cutDir.x, uy = cutDir.y;
    const nd = o.n.dir >= 0 ? SG.DIRS[o.n.dir] : null;
    const err = nd ? Math.acos(Math.max(-1, Math.min(1, ux * nd.x + uy * nd.y))) : 0;
    const good = err <= DIR_TOL;
    const push = new T.Vector3(ux, uy, 0);

    if (good && heavy && !LG.heavyOk(speed2)) {
      // too soft: the crystal shrugs the blade off
      o.kept = true;
      W.knock(o.g, new T.Vector3(ux * 2.5, uy * 2.5 + 2, 3));
      g.bad++; breakCombo();
      g.energy -= 0.08;
      popAt(contact, 'TOO SOFT', 'swing harder', 'bad');
      sparks(contact, push, 0.2, true, 0xbff4ff);
      synth.sfxClang();
      mc.rumble(0.35, 40, 1);
      shake = 0.03;
      checkFail(); updateHud();
      return;
    }

    // actual cut plane: spanned by the blade and its sweep, through the hilt
    const sweep = new T.Vector3(ux, uy, 0);
    const n = new T.Vector3().crossVectors(bladeDir, sweep);
    if (n.lengthSq() < 1e-6) n.set(-uy, ux, 0);
    n.normalize();
    const centre = o.g.position.clone();
    const off = n.dot(_c.copy(centre).sub(hilt));
    const sliceOff = Math.max(-0.12, Math.min(0.12, off));
    const blockVel = new T.Vector3(0, 0, g.speed * 0.55);
    o.g.updateMatrixWorld(true);
    W.sliceBlock(o.g, n, sliceOff, blockVel, push.clone().multiplyScalar(Math.min(12, speed2) * (heavy ? 0.6 : 0.4)));

    if (good) {
      const sc = LG.scoreCut({ dirErr: nd ? err / DIR_TOL : 0, centre: Math.abs(off) / 0.22, arc: stroke.arc, speed: speed2 });
      let raw = sc.raw;
      g.st.power += sc.speed / 20; g.st.powerN++;
      g.combo++; g.maxCombo = Math.max(g.maxCombo, g.combo); g.hits++;
      g.rawSum += raw;
      const m = LG.multStep({ mult: g.mult, prog: g.multProg }, true); g.mult = m.mult; g.multProg = m.prog;
      const pts = addPoints(heavy ? raw * 1.5 : raw);
      g.energy = Math.min(1, g.energy + 0.03);
      if (g.surgeT <= 0) {
        g.surge = Math.min(1, g.surge + LG.surgeGain(raw) * (heavy ? 1.5 : 1));
        if (g.surge >= 1) startSurge();
      }
      const word = heavy ? 'SHATTER' : LG.cutWord(raw);
      popAt(contact, '+' + pts, word, raw >= 92 || heavy ? 'top' : '');
      if (heavy) {
        g.st.heavyOk++;
        sparks(contact, push, 1, false, 0xbff4ff);
        W.shockwave(contact, 3.2, 0xbff4ff);
        synth.sfxSlice(1, true);
        mc.rumble(1, 80, 3);
        shake = Math.max(shake, 0.045); hitFlash = 1;
      } else {
        sparks(contact, push, raw / 100, false);
        if (g.song.file) synth.sfxSlice(raw / 100, false);
        else {
          const ch = A.chordForBar(g.song, Math.floor(g.clock / g.song.beatDur / 4));
          synth.sfxCut(raw / 100, ch[g.chordTone++ % ch.length] + 24);
        }
        mc.rumble(0.45 + 0.5 * raw / 100, 35, 0); // the bang
        hitFlash = Math.min(1, hitFlash + 0.25);
      }
      if (g.combo > 0 && g.combo % 25 === 0) banner(g.combo + ' chain', false);
      bumpCombo();
    } else {
      g.bad++;
      breakCombo();
      g.score += 10;
      g.energy -= 0.1;
      popAt(contact, 'WRONG WAY', '', 'bad');
      sparks(contact, push, 0.3, true);
      synth.sfxBad();
      mc.rumble(0.3, 60, 1);
      shake = 0.05; redFlash = 0.6;
    }
    checkFail();
    updateHud();
  }

  function cutLink(o, contact, cutDir) {
    const g = game;
    o.cut = true;
    g.st.linksCut++;
    const push = new T.Vector3(cutDir.x, cutDir.y, 0);
    const n = new T.Vector3(-push.y, push.x, 0);
    o.g.updateMatrixWorld(true);
    W.sliceBlock(o.g, n, 0, new T.Vector3(0, 0, g.speed * 0.5), push.clone().multiplyScalar(3));
    const pts = addPoints(20);
    popAt(contact, '+' + pts, '', 'link');
    sparks(contact, push, 0.25, false);
    synth.sfxTick(Math.min(4, g.st.linksCut % 5));
    mc.rumble(0.3, 15, 0);
    updateHud();
  }

  function hitBomb(o, contact) {
    const g = game;
    o.cut = true;
    g.st.minesHit++;
    breakCombo();
    g.energy -= 0.15;
    popAt(contact, 'MINE', '', 'bad');
    const pv = new T.Vector3(), vv = new T.Vector3(), red = new T.Color('#ff2d55'), org = new T.Color('#ffb36b');
    for (let i = 0; i < 70; i++) {
      vv.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 6);
      W.emit(pv.copy(contact), vv, i % 3 ? red : org, 0.4 + Math.random() * 0.6, 1.8);
    }
    W.flash(contact, 3, 0xff3050);
    W.shockwave(contact, 2.5, 0xff2d55);
    synth.sfxBoom();
    mc.rumble(1, 160, 1);
    shake = 0.09; redFlash = 1;
    checkFail(); updateHud();
  }

  // Walls: keep the blade's outer part out of the glass while the wall passes the hit line.
  const _w1 = new T.Vector3(), _w2 = new T.Vector3(), _w3 = new T.Vector3();
  function updateWalls(dt, nowS, t) {
    const g = game;
    let lean = 0;
    for (let i = 0; i < g.objs.length; i++) {
      const o = g.objs[i];
      if (o.kind !== 'wall') continue;
      if (t > o.t0 - 1.0 && t < o.t1 + 0.2) lean = o.x0 < 0 ? 1 : -1;
      const active = t >= o.t0 - 0.05 && t <= o.t1 + 0.05;
      let inside = false;
      if (active) {
        const r0 = toScreen(_w3.set(o.x0, 0, LAY.HIT_Z)), r1 = toScreen(_w3.set(o.x1, 2.7, LAY.HIT_Z));
        const inRect = p => p.x >= r0.x && p.x <= r1.x && p.y >= r0.y && p.y <= r1.y;
        _w2.copy(hilt).addScaledVector(dir, LAY.BLADE_LEN);
        const seg = bladeOnScreen(LAY.BLADE_LEN * 0.7, LAY.BLADE_LEN); // null when behind the camera
        inside = !!seg && (inRect(seg.a) || inRect(seg.b));
      }
      if (inside) {
        if (!o.inside) { o.hit = true; breakCombo(); popAt(_w2.clone(), 'WALL', 'lean away', 'bad'); }
        g.energy -= 0.45 * dt;
        redFlash = Math.max(redFlash, 0.45);
        wallGlow = 1;
        if (nowS > g.buzzAt) { g.buzzAt = nowS + 0.15; mc.rumble(0.6, 120, 1); synth.sfxScrape(); }
        for (let k = 0; k < 2; k++) W.emit(_w2, _w3.set((Math.random() - 0.5) * 3, Math.random() * 3, 2), new T.Color('#ff8ac4'), 0.4, 2);
        checkFail(); updateHud();
      }
      o.inside = inside;
      const mats = o.g.userData.mats;
      mats[0].opacity = inside ? 0.32 : 0.16;
      mats[0].color.set(inside ? 0xff2d55 : 0xff4fa0);
      if (!o.done && t > o.t1 + 0.05) {
        o.done = true;
        if (!o.hit) {
          g.st.dodged++;
          const pts = addPoints(50);
          popAt(new T.Vector3((o.x0 + o.x1) / 2, 1.6, LAY.HIT_Z), '+' + pts, 'DODGED', 'top');
          synth.sfxChime(false); mc.rumble(0.3, 25, 0);
          updateHud();
        }
      }
    }
    g.wallLean += (lean - g.wallLean) * Math.min(1, dt * 4);
  }

  // Arcs: after the head block, trace the bead with the blade until the next block.
  function updateArcs(dt, nowS, t) {
    const g = game;
    for (let i = 0; i < g.objs.length; i++) {
      const o = g.objs[i];
      if (o.kind !== 'arc') continue;
      const ud = o.g.userData;
      if (t < o.t0 || o.done) continue;
      if (t > o.t1) {
        o.done = true; ud.bead.visible = false;
        const frac = o.total > 0 ? o.tracked / o.total : 0;
        g.st.arcFrac += frac;
        const pts = addPoints(Math.round(60 * frac));
        const P = o.pts[o.pts.length - 1];
        popAt(_w3.set(P.x, P.y, LAY.HIT_Z), '+' + pts, 'ARC ' + Math.round(frac * 100) + '%', frac > 0.8 ? 'top' : '');
        if (frac > 0.8) synth.sfxChime(true);
        updateHud();
        continue;
      }
      const s = (t - o.t0) / (o.t1 - o.t0);
      const f = s * (o.pts.length - 1), k = Math.min(o.pts.length - 2, Math.floor(f)), u = f - k;
      const P = _w3.lerpVectors(o.pts[k], o.pts[k + 1], u);
      P.z = LAY.HIT_Z;
      ud.bead.visible = true; ud.bead.position.copy(P);
      const ps = toScreen(P);
      const seg = bladeOnScreen(LAY.BLADE_CUT_FROM, LAY.BLADE_LEN);
      const d = seg ? segDist(ps, seg.a, seg.b) : Infinity;
      const ok = d <= ARC_TOL;
      o.total += dt; if (ok) o.tracked += dt;
      ud.mat.opacity = ok ? 1 : 0.55; ud.outerMat.opacity = ok ? 0.4 : 0.15;
      ud.bead.scale.setScalar(ok ? 0.95 : 0.6);
      if (ok) {
        if (Math.random() < 0.6) W.emit(P, _w1.set((Math.random() - 0.5) * 2, Math.random() * 2, 1.5), W.COL.blade, 0.35, 2);
        if (nowS > o.tickAt) { o.tickAt = nowS + 0.1; mc.rumble(0.22, 20, 0); }
      }
    }
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
  }

  function startSurge() {
    const g = game;
    g.surge = 0; g.surgeT = LG.SURGE_TIME;
    banner('Surge  x2', false);
    synth.sfxSurge();
    mc.rumble(0.9, 200, 2);
    W.shockwave(new T.Vector3(0, 1.3, LAY.HIT_Z), 6, 0xffd27a);
    hitFlash = 1;
  }

  function judgeMiss(o) {
    const g = game;
    g.miss++;
    breakCombo();
    g.energy -= g.diffKey === 'easy' ? 0.07 : 0.1;
    popAt(new T.Vector3(o.x, o.y, -0.2), 'MISS', '', 'miss');
    synth.sfxMiss();
    redFlash = Math.max(redFlash, 0.35);
    checkFail();
    updateHud();
  }

  function breakCombo() { game.combo = 0; game.mult = 1; game.multProg = 0; }

  function checkFail() {
    const g = game;
    const noFail = window.__ccNoFail || g.mods.indexOf('nofail') >= 0;
    if (g.energy <= 0 && !g.failed && noFail) g.energy = 0.01;
    if (g.energy <= 0 && !g.failed) {
      g.energy = 0; g.failed = true; g.failAt = performance.now() / 1000;
      g.player.stop(1.4);
      banner('Charge depleted', true);
    }
  }

  function finish() {
    const g = game;
    g.ended = true;
    if (!g.failed) g.player.stop(1.0);
    clearObjs();
    const total = g.chart.notes.length;
    const judged = g.failed ? Math.max(1, g.hits + g.bad + g.miss) : total;
    const acc = judged ? g.rawSum / (100 * judged) : 0;
    const grade = LG.grade(acc, g.failed);
    const stars = LG.stars(acc, g.failed, g.mods);
    const key = g.song.id + ':' + g.diffKey;
    const prev = store.best[key];
    let isBest = false;
    if (!g.failed && (!prev || g.score > prev.score)) {
      store.best[key] = { score: g.score, acc: Math.round(acc * 1000) / 10, combo: g.maxCombo, grade };
      isBest = true;
    }
    const unlocks = [];
    if (g.stage) {
      const before = LG.totalStars(store.stars);
      const nextIdx = g.stageIdx + 1;
      const wasLocked = nextIdx < LG.CAMPAIGN.length && !LG.stageUnlocked(nextIdx, store.stars);
      store.stars[g.stage.id] = Math.max(store.stars[g.stage.id] | 0, stars);
      const after = LG.totalStars(store.stars);
      if (wasLocked && LG.stageUnlocked(nextIdx, store.stars)) unlocks.push('Stage unlocked: ' + LG.CAMPAIGN[nextIdx].title);
      Object.keys(LG.MODS).forEach(k => { if (!LG.modUnlocked(k, before) && LG.modUnlocked(k, after)) unlocks.push('Modifier unlocked: ' + LG.MODS[k].label); });
    }
    saveStore();
    $('resGrade').textContent = grade;
    $('resGrade').classList.toggle('fail', g.failed);
    $('resTitle').textContent = g.stage ? g.stage.title : g.song.title;
    $('resSub').textContent = (g.stage ? g.song.title + ' · ' : '') + g.chart.label + ' · ' + Math.round(g.song.bpm) + ' bpm' +
      (g.mods.length ? ' · ' + g.mods.map(k => LG.MODS[k].label).join(' + ') : '') + (g.failed ? ' · not cleared' : '');
    $('resStars').innerHTML = [0, 1, 2].map(i => '<i class="' + (i < stars ? 'on' : '') + '" style="animation-delay:' + (0.25 + i * 0.22) + 's"></i>').join('');
    $('resScore').textContent = g.score.toLocaleString('en-US');
    $('resBest').textContent = isBest ? (prev ? 'new best' : 'first clear') : (prev ? 'best ' + prev.score.toLocaleString('en-US') : '');
    $('resUnlock').innerHTML = unlocks.map(u => '<div>' + u + '</div>').join('');
    $('resAcc').textContent = (acc * 100).toFixed(1) + '%';
    $('resCombo').textContent = g.maxCombo;
    $('resCuts').textContent = g.hits + ' / ' + total;
    $('resPower').textContent = g.st.powerN ? Math.round(100 * g.st.power / g.st.powerN) + '%' : '-';
    $('resBad').textContent = g.bad;
    $('resMiss').textContent = g.miss;
    const ex = [];
    if (g.st.heavy) ex.push([g.st.heavyOk + ' / ' + g.st.heavy, 'crystals']);
    if (g.st.mines) ex.push([g.st.minesHit, 'mines touched']);
    if (g.st.arcs) ex.push([Math.round(100 * g.st.arcFrac / g.st.arcs) + '%', 'arcs traced']);
    if (g.st.walls) ex.push([g.st.dodged + ' / ' + g.st.walls, 'walls dodged']);
    if (g.st.links) ex.push([g.st.linksCut + ' / ' + g.st.links, 'chain links']);
    $('resExtra').innerHTML = ex.map(e => '<div><b>' + e[0] + '</b><span>' + e[1] + '</span></div>').join('');
    $('resExtra').style.display = ex.length ? '' : 'none';
    const hasNext = g.stage && g.stageIdx + 1 < LG.CAMPAIGN.length && LG.stageUnlocked(g.stageIdx + 1, store.stars);
    $('resNext').style.display = hasNext ? '' : 'none';
    setScreen('results');
    if (stars) setTimeout(() => synth.sfxChime(true), 300);
  }

  // ---------- feedback ----------
  let hitFlash = 0, redFlash = 0, shake = 0, wallGlow = 0, dropFlash = 0;
  const sparkCol = new T.Color('#ffd7a8'), sparkCol2 = new T.Color('#ff6a3d'), mintCol = new T.Color('#9ffbe3'), badCol = new T.Color('#ff3b3b');
  const goldCol = new T.Color('#ffd27a'), tmpCol = new T.Color();
  function sparks(pos, push, q, bad, tint) {
    const n = bad ? 22 : 34 + Math.round(q * 26);
    const pv = new T.Vector3(), vv = new T.Vector3();
    if (tint) tmpCol.set(tint);
    const surge = game && game.surgeT > 0;
    for (let i = 0; i < n; i++) {
      pv.copy(pos).add(vv.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.25));
      vv.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * 3.5);
      vv.addScaledVector(push, 2 + Math.random() * 4); vv.z += 2 + Math.random() * 2;
      const c = tint && i % 2 ? tmpCol : bad ? badCol : surge && i % 2 ? goldCol : (i % 4 === 0 ? mintCol : i % 3 === 0 ? sparkCol2 : sparkCol);
      W.emit(pv, vv, c, 0.35 + Math.random() * 0.5, 2.2);
    }
    W.flash(pos, bad ? 1.0 : 1.4 + q * 0.8, bad ? 0xff5050 : 0xffe3c4);
  }

  const popsEl = $('pops');
  const _p = new T.Vector3();
  function popAt(pos, big, small, cls) {
    _p.copy(pos).project(W.camera);
    const x = (_p.x + 1) / 2 * innerWidth, y = (1 - _p.y) / 2 * innerHeight;
    const el = document.createElement('div');
    el.className = 'pop ' + (cls || '');
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.innerHTML = '<b>' + big + '</b>' + (small ? '<span>' + small + '</span>' : '');
    popsEl.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }
  const bannerEl = $('banner');
  function banner(text, fail) {
    bannerEl.textContent = text;
    bannerEl.className = '';
    void bannerEl.offsetWidth;
    bannerEl.className = 'show' + (fail ? ' fail' : '');
  }
  let toastTimer = 0;
  function toast(text) {
    const el = $('toast'); el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function bumpCombo() {
    const el = $('combo'); el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 90);
  }
  let hudCache = {};
  function updateHud(force) {
    const g = game; if (!g) return;
    const set = (id, v) => { if (force || hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } };
    set('score', g.score.toLocaleString('en-US'));
    set('combo', String(g.combo));
    set('mult', 'x' + g.mult * (g.surgeT > 0 ? 2 : 1));
    $('multfill').style.width = (g.mult >= 4 ? 100 : 100 * g.multProg / LG.MULT_STEPS[g.mult - 1]) + '%';
    $('surgefill').style.width = (g.surgeT > 0 ? 100 * g.surgeT / LG.SURGE_TIME : 100 * g.surge) + '%';
    $('surge').classList.toggle('on', g.surgeT > 0);
    $('energy').style.width = (g.energy * 100).toFixed(1) + '%';
    $('energy').parentElement.classList.toggle('low', g.energy < 0.25);
  }

  // ---------- screens & navigation ----------
  const screens = { splash: $('splash'), menu: $('menu'), calib: $('calib'), pause: $('pause'), settings: $('settings'), results: $('results') };
  let focusIdx = 0;
  function setScreen(name) {
    state = name;
    Object.keys(screens).forEach(k => screens[k].classList.toggle('hidden', k !== name));
    $('hud').classList.toggle('hidden', !(name === 'play' || name === 'pause'));
    document.body.classList.toggle('playing', name === 'play');
    focusIdx = 0;
    if (name === 'menu') renderMenu();
    if (name === 'calib') renderCalib();
    if (name === 'settings') renderSettings();
    refreshFocus();
    renderHint();
  }
  function navItems() {
    const s = screens[state];
    return s ? Array.prototype.slice.call(s.querySelectorAll('[data-act]')).filter(el => el.style.display !== 'none') : [];
  }
  function refreshFocus() {
    const items = navItems();
    items.forEach((el, i) => el.classList.toggle('focus', i === focusIdx && state !== 'menu'));
  }

  const starsHtml = n => '<span class="stars">' + [0, 1, 2].map(i => '<i class="' + (i < n ? 'on' : '') + '"></i>').join('') + '</span>';
  const FEATURE_NAMES = { heavy: 'Crystals', bombs: 'Mines', arcs: 'Arcs', walls: 'Walls', chains: 'Chains' };
  function featureList(f) { return Object.keys(FEATURE_NAMES).filter(k => f[k]).map(k => FEATURE_NAMES[k]); }

  function renderMenu() {
    $('notice').hidden = mc.source !== 'mouse';
    renderRumble();
    const total = LG.totalStars(store.stars);
    $('starTotal').innerHTML = '&#9733; ' + total + ' / ' + LG.CAMPAIGN.length * 3;
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('sel', el.dataset.tab === sel.tab));
    const songsEl = $('songs');
    songsEl.innerHTML = '';
    songsEl.dataset.tab = sel.tab;
    let selEl = null;
    if (sel.tab === 'campaign') {
      LG.CAMPAIGN.forEach((st, i) => {
        const song = SG.SONGS[songIndex(st.song)];
        const open = LG.stageUnlocked(i, store.stars);
        const el = document.createElement('button');
        el.className = 'song stage nav' + (i === sel.stage ? ' sel' : '') + (open ? '' : ' locked');
        el.dataset.stage = i;
        el.style.setProperty('--accent', song.accent);
        el.innerHTML = '<div class="num">' + String(i + 1).padStart(2, '0') + '</div><div><div class="t">' + st.title + '</div><div class="m">' +
          song.title + ' &middot; ' + SG.DIFFS[st.diff].label + '</div></div>' +
          (open ? starsHtml(store.stars[st.id] | 0) : '<span class="lock">locked</span>');
        songsEl.appendChild(el);
        if (i === sel.stage) selEl = el;
      });
      const st = LG.CAMPAIGN[sel.stage], song = SG.SONGS[songIndex(st.song)];
      const prevF = sel.stage ? LG.CAMPAIGN[sel.stage - 1].features : {};
      const fresh = Object.keys(FEATURE_NAMES).filter(k => st.features[k] && !prevF[k]);
      const b = store.best[song.id + ':' + st.diff];
      $('detail').innerHTML = '<div class="d-title">' + st.title + '</div>' +
        '<div class="d-song">' + song.title + (song.artist ? ' <span>by ' + song.artist + '</span>' : '') + '</div>' +
        '<div class="d-meta">' + SG.DIFFS[st.diff].label + ' &middot; ' + Math.round(song.bpm) + ' bpm &middot; ' + fmtDur(song.duration) + '</div>' +
        (fresh.length ? '<div class="d-new">New: ' + fresh.map(k => FEATURE_NAMES[k]).join(', ') + '</div>' : '') +
        '<div class="d-intro">' + st.intro + '</div>' +
        '<div class="d-feat">' + (featureList(st.features).join(' &middot; ') || 'Blocks only') + '</div>' +
        '<div class="d-best">' + starsHtml(store.stars[st.id] | 0) + (b ? '<b>' + b.score.toLocaleString('en-US') + '</b> best &middot; ' + b.grade : '') + '</div>';
      const open = LG.stageUnlocked(sel.stage, store.stars);
      $('play').classList.toggle('disabled', !open);
      $('play').textContent = open ? 'Play' : 'Locked';
    } else {
      SG.SONGS.forEach((s, i) => {
        const el = document.createElement('button');
        el.className = 'song nav' + (i === sel.song ? ' sel' : '');
        el.dataset.song = i;
        el.style.setProperty('--accent', s.accent);
        el.innerHTML = '<div class="num">' + String(i + 1).padStart(2, '0') + '</div><div><div class="t">' + s.title + '</div><div class="m">' +
          (s.artist || 'Original') + '<span class="mood"> &middot; ' + s.mood + '</span></div></div>' +
          '<div class="bpm"><b>' + Math.round(s.bpm) + '</b>bpm &middot; ' + fmtDur(s.duration) + '</div>';
        songsEl.appendChild(el);
        if (i === sel.song) selEl = el;
      });
      const song = SG.SONGS[sel.song];
      $('detail').innerHTML = '<div class="label">Difficulty</div><div class="diffs">' +
        DIFF_KEYS.map(k => '<button class="diff nav' + (k === sel.diff ? ' sel' : '') + '" data-diff="' + k + '">' + SG.DIFFS[k].label + '</button>').join('') + '</div>' +
        '<div class="d-feat">' + featureList(LG.freeFeatures(sel.diff)).join(' &middot; ') + '</div>' +
        '<div class="label">Best</div><div class="best">' + DIFF_KEYS.map(k => {
          const b = store.best[song.id + ':' + k];
          return '<div class="row' + (k === sel.diff ? ' cur' : '') + '"><span>' + SG.DIFFS[k].label + '</span><b>' +
            (b ? b.score.toLocaleString('en-US') + ' &middot; ' + b.grade + ' &middot; ' + b.acc + '%' : '&mdash;') + '</b></div>';
        }).join('') + '</div>';
      $('play').classList.remove('disabled'); $('play').textContent = 'Play';
    }
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
    // start downloading/decoding the highlighted track now so the calibration screen is ready sooner
    const pre = sel.tab === 'campaign' ? SG.SONGS[songIndex(LG.CAMPAIGN[sel.stage].song)] : SG.SONGS[sel.song];
    if (pre.file && !trackBuf[pre.id] && synth.ctx) A.loadTrack(synth, pre.file).then(buf => { trackBuf[pre.id] = buf; }, () => {});
    $('mods').innerHTML = Object.keys(LG.MODS).map(k => {
      const m = LG.MODS[k], open = LG.modUnlocked(k, total), on = sel.mods.indexOf(k) >= 0;
      return '<button class="mod nav' + (on ? ' sel' : '') + (open ? '' : ' locked') + '" data-mod="' + k + '" title="' + m.desc + '">' +
        '<b>' + m.label + '</b><span>' + (open ? 'x' + m.score : '&#9733; ' + m.needStars) + '</span></button>';
    }).join('');
    const K = keyWords();
    $('help').innerHTML = mc.connected
      ? '<div><span>Choose</span><b>point + ' + K.a + '</b></div><div><span>Pause</span><b>' + K.b + '</b></div><div><span>Re-aim</span><b>' + K.center + '</b></div>' +
        (K.grip ? '' : '<div><span>Pick / tab</span><b>D-pad / 1</b></div>')
      : '<div><span>Pick</span><b>&uarr; &darr;</b></div><div><span>Difficulty</span><b>&larr; &rarr;</b></div><div><span>Tab</span><b>Tab</b></div><div><span>Play</span><b>Enter</b></div><div><span>Pause</span><b>Esc</b></div><div><span>In game</span><b>mouse aims</b></div>';
  }
  function fmtDur(d) { return Math.floor(d / 60) + ':' + String(Math.round(d % 60)).padStart(2, '0'); }

  const LEGEND = {
    heavy: ['crystal', 'Crystal: swing hard'],
    bombs: ['mine', 'Mine: never touch'],
    arcs: ['arc', 'Arc: trace the bead'],
    walls: ['wall', 'Wall: aim away'],
    chains: ['chain', 'Chain: one long sweep'],
  };
  function renderCalib() {
    const P = play, song = P.song;
    $('calibSong').textContent = (P.stage ? P.stage.title + ' · ' : '') + song.title + ' · ' + SG.DIFFS[P.diff].label;
    $('calibIntro').textContent = P.stage ? P.stage.intro : '';
    $('calibCredit').textContent = song.artist ? 'Music: ' + song.title + ' by ' + song.artist + ' (' + song.license + ', OpenGameArt)' : 'Music: original procedural song';
    $('legend').innerHTML = Object.keys(LEGEND).filter(k => P.features[k]).map(k => '<span class="lg ' + LEGEND[k][0] + '"><i></i>' + LEGEND[k][1] + '</span>').join('');
    const loading = loadState === 'loading' ? '<br><em class="loading">Loading the track...</em>' : loadState === 'error' ? '<br><em class="loading err">Track failed to load. Check the connection, then retry.</em>' : '';
    if (mc.connected) {
      $('calibTitle').textContent = 'Aim at the screen';
      const K = keyWords();
      $('calibText').innerHTML = 'Hold it like a hilt, point at the middle of the screen, press <b>' + K.center + '</b> (or <b>' + K.a + '</b>).' + loading;
    } else {
      $('calibTitle').textContent = 'Mouse mode';
      $('calibText').innerHTML = 'The mouse aims the blade. Flick along each arrow; dots cut any way.<br><b>Click</b> or <b>Space</b> to start.' + loading;
    }
    calibSource = mc.source;
  }
  let calibSource = '';

  function moveSel(dlt) {
    if (sel.tab === 'campaign') sel.stage = (sel.stage + dlt + LG.CAMPAIGN.length) % LG.CAMPAIGN.length;
    else sel.song = (sel.song + dlt + SG.SONGS.length) % SG.SONGS.length;
    persistSel(); renderMenu(); synth.sfxUi('move');
  }
  function moveDiff(dlt) {
    if (sel.tab !== 'free') return;
    const i = DIFF_KEYS.indexOf(sel.diff); sel.diff = DIFF_KEYS[Math.max(0, Math.min(2, i + dlt))]; persistSel(); renderMenu(); synth.sfxUi('move');
  }
  function setTab(t) { sel.tab = t; persistSel(); renderMenu(); synth.sfxUi('move'); }
  function toggleMod(k) {
    if (!LG.modUnlocked(k, LG.totalStars(store.stars))) { toast('Earn ' + LG.MODS[k].needStars + ' campaign stars to unlock ' + LG.MODS[k].label); synth.sfxUi('back'); return; }
    const i = sel.mods.indexOf(k);
    if (i >= 0) sel.mods.splice(i, 1); else sel.mods.push(k);
    persistSel(); renderMenu(); synth.sfxUi('move');
  }
  function persistSel() { store.lastSong = sel.song; store.lastDiff = sel.diff; store.lastStage = sel.stage; store.tab = sel.tab; store.mods = sel.mods.slice(); saveStore(); }

  function ensureAudio() {
    synth.init();
    return synth.resume();
  }

  function activate(el) {
    if (!el) return;
    if (el.dataset.tab) { setTab(el.dataset.tab); return; }
    if (el.dataset.stage !== undefined) { sel.stage = +el.dataset.stage; persistSel(); renderMenu(); synth.sfxUi('move'); return; }
    if (el.dataset.song !== undefined) { sel.song = +el.dataset.song; persistSel(); renderMenu(); synth.sfxUi('move'); return; }
    if (el.dataset.diff) { sel.diff = el.dataset.diff; persistSel(); renderMenu(); synth.sfxUi('move'); return; }
    if (el.dataset.mod) { toggleMod(el.dataset.mod); return; }
    act(el.dataset.act);
  }
  function goCalib() {
    play = buildPlay();
    ensureTrack(play.song);
    setScreen('calib');
  }
  function act(a) {
    if (a && a.indexOf('set:') === 0) { const p = a.split(':'); changeSetting(p[1], +p[2]); return; }
    switch (a) {
      case 'settings': settingsFrom = state === 'pause' ? 'pause' : 'menu'; synth.sfxUi('move'); setScreen('settings'); break;
      case 'setback': synth.sfxUi('back'); setScreen(settingsFrom === 'pause' && game ? 'pause' : 'menu'); break;
      case 'play':
        if (sel.tab === 'campaign' && !LG.stageUnlocked(sel.stage, store.stars)) { toast('Earn a star on the previous stage first'); synth.sfxUi('back'); return; }
        if (!synth.ctx || synth.ctx.state !== 'running') { ensureAudio(); if (synth.ctx.state !== 'running') { toast('Click or press a key once to enable sound'); return; } }
        synth.sfxUi('go'); goCalib(); break;
      case 'resume': resumeGame(); break;
      case 'restart': synth.resume(); startSong(); break;
      case 'quit': case 'menu': quitToMenu(); break;
      case 'rumble': requestRumble(); break;
      case 'retry': startSong(); break;
      case 'next':
        if (game && game.stage) { sel.stage = game.stageIdx + 1; sel.tab = 'campaign'; persistSel(); }
        if (game) { clearObjs(); game = null; }
        goCalib(); break;
    }
  }
  function pauseGame() {
    if (state !== 'play' || !game || game.ended) return;
    synth.ctx.suspend();
    setScreen('pause');
  }
  function resumeGame() {
    if (state !== 'pause') return;
    synth.resume();
    setScreen('play');
  }
  function quitToMenu() {
    if (game) { if (state === 'pause') synth.resume(); game.player.stop(0.2); clearObjs(); game = null; }
    synth.sfxUi('back');
    setScreen('menu');
  }
  function confirmCalib() {
    if (state !== 'calib') return;
    if (play.song.file && !trackBuf[play.song.id]) {
      if (loadState === 'error') ensureTrack(play.song).then(() => renderCalib());
      toast(loadState === 'error' ? 'Retrying the track download...' : 'Still loading the track...');
      renderCalib();
      return;
    }
    ensureAudio();
    synth.sfxUi('go');
    startSong();
  }

  // Phone vibration goes over WebHID, which Chrome only allows from a click or key press.
  function requestRumble() {
    mc.enableRumble().then(ok => { renderRumble(); if (ok) mc.rumble(0.6, 40, 0); }, renderRumble);
  }
  function renderRumble() {
    const el = $('rumble'), on = mc.rumbleReady;
    el.textContent = on ? 'Vibration on' : 'Vibration off: click, then allow Mimic';
    el.classList.toggle('on', on);
  }

  function firstInput() {
    if (state === 'splash') { ensureAudio(); requestRumble(); setScreen('menu'); synth.sfxUi('go'); return true; }
    return false;
  }

  // keyboard
  addEventListener('keydown', e => {
    if (e.repeat) return;
    ensureAudio();
    if (firstInput()) return;
    const k = e.key;
    if (state === 'menu') {
      if (k === 'ArrowUp') moveSel(-1); else if (k === 'ArrowDown') moveSel(1);
      else if (k === 'ArrowLeft') moveDiff(-1); else if (k === 'ArrowRight') moveDiff(1);
      else if (k === 'Tab') { setTab(sel.tab === 'campaign' ? 'free' : 'campaign'); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') act('play');
    } else if (state === 'calib') {
      if (k === 'Enter' || k === ' ' || k === 'c' || k === 'C') confirmCalib();
      else if (k === 'Escape') { setScreen('menu'); }
    } else if (state === 'play') {
      if (k === 'Escape' || k === 'p' || k === 'P') pauseGame();
    } else if (state === 'pause' || state === 'results' || state === 'settings') {
      const items = navItems();
      if (k === 'ArrowUp' || k === 'ArrowLeft') { focusIdx = (focusIdx - 1 + items.length) % items.length; refreshFocus(); }
      else if (k === 'ArrowDown' || k === 'ArrowRight') { focusIdx = (focusIdx + 1) % items.length; refreshFocus(); }
      else if (k === 'Enter' || k === ' ') activate(items[focusIdx]);
      else if (k === 'Escape') { if (state === 'pause') resumeGame(); else if (state === 'settings') act('setback'); else quitToMenu(); }
    }
    if (k === ' ' || k.indexOf('Arrow') === 0) e.preventDefault();
  });
  addEventListener('pointerdown', e => {
    ensureAudio();
    if (firstInput()) return;
    if (state === 'calib' && e.button === 0) { confirmCalib(); return; }
    const el = e.target.closest && e.target.closest('.nav, [data-act]');
    if (el && e.button === 0) activate(el);
  });

  // phone: pointer cursor + buttons
  const cursorEl = $('cursor');
  let hoverEl = null;
  function phoneUi() {
    const uiState = state !== 'play';
    const show = mc.connected && uiState;
    cursorEl.style.display = show ? 'block' : 'none';
    let el = null;
    if (show) {
      const x = (mc.pointer.x + 1) / 2 * innerWidth, y = (1 - (mc.pointer.y + 1) / 2) * innerHeight;
      cursorEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, x)), Math.max(0, Math.min(innerHeight - 1, y)));
      el = hit && hit.closest ? hit.closest('.nav, [data-act]') : null;
    }
    if (el !== hoverEl) {
      if (hoverEl) hoverEl.classList.remove('hover');
      hoverEl = el;
      if (hoverEl) { hoverEl.classList.add('hover'); if (mc.connected) synth.sfxUi('move'); }
      if (hoverEl && (state === 'pause' || state === 'results' || state === 'settings')) { focusIdx = navItems().indexOf(hoverEl); refreshFocus(); }
    }
    if (!mc.connected) return;
    const P = n => mc.pressed(n);
    if (state === 'splash') { if (P('a') || P('center')) { firstInput(); } return; }
    if (state === 'menu') {
      if (P('up')) moveSel(-1); if (P('down')) moveSel(1);
      if (P('left')) moveDiff(-1); if (P('right')) moveDiff(1);
      if (P('one')) setTab(sel.tab === 'campaign' ? 'free' : 'campaign');
      if (P('a')) { if (hoverEl) activate(hoverEl); else act('play'); }
    } else if (state === 'calib') {
      if (P('center') || P('a')) confirmCalib();
      if (P('b')) setScreen('menu');
    } else if (state === 'play') {
      if (P('b') || P('home') || P('plus')) pauseGame();   // b: Grip's Vol Up tap, the only spare button it has
    } else if (state === 'pause' || state === 'results' || state === 'settings') {
      const items = navItems();
      if (P('up') || P('left')) { focusIdx = (focusIdx - 1 + items.length) % items.length; refreshFocus(); }
      if (P('down') || P('right')) { focusIdx = (focusIdx + 1) % items.length; refreshFocus(); }
      if (P('a')) activate(hoverEl || items[focusIdx]);
      if (P('home') && state === 'pause') resumeGame();
      if (P('b')) { if (state === 'pause') resumeGame(); else if (state === 'settings') act('setback'); else quitToMenu(); }
    }
  }

  /** The device in hand, in its own words. Grip (one-hand mode) only has a = Vol Down, b = Vol Up tap,
   * center = hold Vol Up (a browser phone's Grip: on-screen HOLD / B / CENTRE); until the lib tells
   * Wand from Grip (mc.mode), name both. */
  function keyWords() {
    const m = mc.mode;
    if (m === 'grip' && mc.via === 'browser') return { grip: true, dev: 'Grip', a: mc.keyName('a'), b: mc.keyName('b'), center: mc.keyName('center') };
    if (m === 'grip') return { grip: true, dev: 'Grip', a: 'Vol Down', b: 'Vol Up', center: 'CENTRE or hold Vol Up' };
    if (m === 'wand') return { grip: false, dev: 'Wand', a: 'A', b: 'B', center: 'CENTER' };
    return { grip: false, dev: 'Wand / Grip', a: 'A / Vol Down', b: 'B / Vol Up', center: 'CENTER / hold Vol Up' };
  }
  /** Bottom hint bar: what the device in hand does on this screen. */
  let hintKey = '';
  function renderHint() {
    const el = $('mhint');
    const K = keyWords(), ph = mc.connected;
    const kb = (k, t) => '<span><kbd>' + k + '</kbd>' + t + '</span>';
    let h = '';
    if (state === 'splash') h = ph ? kb(K.a, 'begin') : kb('Click', 'begin');
    else if (state === 'menu') h = ph ? kb('Point', 'choose') + kb(K.a, 'select') : kb('Click', 'choose') + kb('Enter', 'play');
    else if (state === 'calib') h = ph ? kb(K.center, 'aim set, start') + kb(K.b, 'back') : kb('Click', 'start') + kb('Esc', 'back');
    else if (state === 'pause') h = ph ? kb('Point', 'choose') + kb(K.a, 'select') + kb(K.b, 'resume') : kb('Click', 'choose') + kb('Esc', 'resume');
    else if (state === 'results') h = ph ? kb('Point', 'choose') + kb(K.a, 'select') + kb(K.b, 'menu') : kb('Click', 'choose') + kb('Esc', 'menu');
    else if (state === 'settings') h = ph ? kb('Point', 'choose') + kb(K.a, 'change') + kb(K.b, 'back') : kb('Click', 'change') + kb('Esc', 'back');
    const key = state + '|' + h;
    if (key === hintKey) return;
    hintKey = key;
    el.innerHTML = h;
    el.classList.toggle('hidden', !h);
    $('splashPress').textContent = ph ? 'Press ' + K.a + ' to begin' : 'Click or press any key to begin';
    $('pauseTip').innerHTML = ph ? '<b>' + K.center + '</b> re-aims the blade any time.' : 'In game, the mouse aims the blade.';
  }

  // controller status chip
  const chip = $('chip');
  let chipSrc = null;
  function updateChip() {
    const src = mc.source + '|' + mc.mode;
    if (chipSrc === src) return;
    chipSrc = src;
    chip.classList.toggle('on', mc.connected);
    chip.querySelector('span').textContent = mc.connected ? keyWords().dev + ' connected' : 'No phone: mouse';
    renderHint();
    if (state === 'menu') renderMenu();
    if (state === 'calib') renderCalib();
  }

  // ---------- beat pulse ----------
  /** 0..1 kick-like pulse at song time t: from the sequencer's kick for procedural songs, from onsets for tracks. */
  function beatPulse(song, t, sec) {
    if (song.onsets) {
      const sd = song.stepDur, step = Math.floor(t / sd);
      let p = 0;
      for (let k = 0; k < 3; k++) {
        const s = step - k, bar = s >> 4;
        if (s < 0 || bar >= song.onsets.length) continue;
        const v = +song.onsets[bar][s & 15] / 9;
        p = Math.max(p, v * v * Math.exp(-(t - s * sd) * 7));
      }
      return p;
    }
    const beat = t / song.beatDur, fr = beat - Math.floor(beat);
    return sec.layerSet.k ? Math.exp(-fr * 5) : 0.35 * Math.exp(-fr * 3);
  }

  // ---------- main loop ----------
  const vignette = $('vignette'), flashLayer = $('flashlayer'), wallLayer = $('walllayer');
  const accentCol = new T.Color(), gold = new T.Color('#ffc46b');
  let last = performance.now();
  let tint = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    const nowS = now / 1000;
    if (cfg.gfx !== 1 || dyn.pr !== PR_MAX) dynResolution(dt);
    mc.update(now);
    updateChip();
    phoneUi();
    if (state === 'play' && mc.source === 'mouse' && mc.pressed('home')) pauseGame();

    updateBlade(dt, nowS);

    let beat, pulse, intensity;
    const frozen = state === 'pause' || (state === 'settings' && !!game);
    if (game && (state === 'play' || frozen || state === 'results')) {
      let t = game.clock;
      if (state === 'play') t = updatePlay(dt, nowS);
      const song = game.song;
      beat = t / song.beatDur;
      const bar = Math.max(0, Math.min(song.totalBars - 1, Math.floor(beat / 4)));
      const sec = song.barSections[bar];
      const live = t >= 0 && t < song.duration && !game.failed;
      intensity = live ? sec.intensity / 3 : 0.1;
      pulse = live ? beatPulse(song, t, sec) : 0;
      accentCol.set(song.accent);
      if (game.surgeT > 0) { accentCol.lerp(gold, 0.8); intensity = Math.max(intensity, 0.85); }
    } else {
      beat = nowS * 92 / 60;
      const fr = beat - Math.floor(beat);
      pulse = 0.25 * Math.exp(-fr * 4);
      intensity = 0.15;
      const s = sel.tab === 'campaign' ? SG.SONGS[songIndex(LG.CAMPAIGN[sel.stage].song)] : SG.SONGS[sel.song];
      accentCol.set(s.accent);
    }
    const envDt = frozen ? 0 : dt;
    if (cfg.fx) pulse *= 0.35;   // reduced effects: the world still breathes with the beat, gently
    W.updateEnv(envDt, beat, pulse, intensity, accentCol, nowS);
    if (!frozen) { W.updateDebris(dt); W.updateParticles(dt); W.updateFlashes(dt); W.updateWaves(dt); W.updateTumbles(dt); }
    W.updateTrail(nowS, 1);
    tint += ((game && game.surgeT > 0 ? 1 : 0) - tint) * Math.min(1, dt * 5);
    W.setBladeTint(tint);

    hitFlash = Math.max(0, hitFlash - dt * 3);
    redFlash = Math.max(0, redFlash - dt * 2.5);
    wallGlow = Math.max(0, wallGlow - dt * 3);
    dropFlash = Math.max(0, dropFlash - dt * 1.5);
    vignette.style.opacity = (0.85 + 0.15 * (1 - pulse * intensity)).toFixed(3);
    flashLayer.style.opacity = (Math.min(1, pulse * intensity * 0.45 + hitFlash * 0.4 + redFlash * 0.6 + dropFlash * 0.5) * (cfg.fx ? 0.3 : 1)).toFixed(3);
    flashLayer.style.filter = redFlash > hitFlash ? 'hue-rotate(-20deg) saturate(1.6)' : tint > 0.5 ? 'hue-rotate(25deg) saturate(1.4)' : '';
    wallLayer.style.opacity = wallGlow.toFixed(3);

    // camera: gentle sway with the beat, a lean away from walls, a kick on drops, shake on mistakes
    shake = Math.max(0, shake - dt * 0.25);
    const cam = W.camera;
    cam.position.copy(W.camBase);
    cam.position.y += Math.sin(nowS * 0.7) * 0.02 + pulse * intensity * 0.02;
    const lean = game ? game.wallLean : 0;
    cam.position.x += lean * 0.28;
    cam.quaternion.copy(W.camQuat);
    if (Math.abs(lean) > 1e-3) cam.rotateZ(-lean * 0.06);
    const fov = cfg.fx ? 68 : 68 - dropFlash * 6 + pulse * intensity * 0.8;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (shake > 0 && !cfg.fx) { cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake; }
    W.renderer.render(W.scene, cam);
  }

  addEventListener('resize', () => W.resize());
  addEventListener('blur', () => { if (state === 'play') pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });

  applySettings();
  setScreen('splash');
  requestAnimationFrame(frame);

  // ---------- test / debug hooks ----------
  window.__cc = {
    get state() { return state; },
    /** Screen hooks for layout checks. */
    ui: { setScreen: n => setScreen(n), goCalib: () => goCalib(), startSong: () => startSong(), pause: () => pauseGame(), finish: () => finish() },
    get game() { return game; },
    get clock() { return game ? game.clock : null; },
    audioNow() { return synth.ctx ? synth.ctx.currentTime : null; },
    select(songIdx, diff) { sel.tab = 'free'; sel.song = songIdx; sel.diff = diff; if (state === 'menu') renderMenu(); },
    selectStage(i) { sel.tab = 'campaign'; sel.stage = i; if (state === 'menu') renderMenu(); },
    setMods(list) { sel.mods = list.slice(); if (state === 'menu') renderMenu(); },
    unlockAll() { LG.CAMPAIGN.forEach(s => { store.stars[s.id] = Math.max(store.stars[s.id] | 0, 1); }); saveStore(); if (state === 'menu') renderMenu(); },
    get loadState() { return loadState; },
    /** Freeze/unfreeze the song clock without the pause screen (screenshots in slow headless runs). */
    freeze(on) { if (synth.ctx) { if (on) synth.ctx.suspend(); else synth.ctx.resume(); } },
    /** Upcoming things in world terms, for test bots: [{kind, x, y, time|t0,t1, dir}] */
    upcoming() {
      if (!game) return [];
      return game.objs.filter(o => !o.cut).map(o => o.kind === 'wall' ? { kind: 'wall', t0: o.t0, t1: o.t1, x0: o.x0, x1: o.x1 }
        : o.kind === 'arc' ? { kind: 'arc', t0: o.t0, t1: o.t1, pts: o.pts.map(p => [p.x, p.y]) }
          : { kind: o.kind, x: o.x, y: o.y, time: o.time, dir: o.n.dir === undefined ? -1 : o.n.dir });
    },
    /** Client (mouse) coordinates that make the blade point at world point (x, y, z), in mouse mode. */
    aimClient(x, y, z) {
      // the hilt moves with the aim (arm model), so solve by fixed-point iteration
      const P = new T.Vector3(x, y, z), h = new T.Vector3(), d = new T.Vector3();
      let yaw = 0, pitch = 0;
      for (let i = 0; i < 8; i++) {
        hiltFromHand(MimicMath.armPose(MimicMath.fromEuler(yaw, pitch, 0), HAND).hand, h);
        d.copy(P).sub(h).normalize();
        yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) - LAY.PITCH_OFF;
      }
      const mx = -yaw / 0.9, my = pitch / 0.6;
      return { x: (mx + 1) / 2 * innerWidth, y: (1 - my) / 2 * innerHeight };
    },
    /** Screen-space view used by the cut test: blade cutting segment and a world point, for debugging bots. */
    screen(x, y, z) {
      const a = toScreen(_c.copy(hilt).addScaledVector(dir, LAY.BLADE_CUT_FROM)), b = toScreen(_c.copy(hilt).addScaledVector(dir, LAY.BLADE_LEN));
      return { a, b, p: toScreen(_c.set(x, y, z)) };
    },
    get hilt() { return hilt.clone(); },
    get bladeDir() { return dir.clone(); },
    layout: LAY,
    dirs: SG.DIRS,
    world: W,
    get renderScale() { return dyn.pr; },
    settings: cfg,
  };
})();
