/*
 * Sunvolley — game flow, rules, AI, swing detection, camera, HUD, circuit, two players.
 *
 * Every human player is a "Human" (controller + swing + racket state). The swing, aim and
 * footwork code is written for the near side (my half is +z, I hit toward -z); the far player in
 * two-player mode runs the very same code in a frame turned half a turn (frame.js).
 */
(function () {
  'use strict';
  const TN = window.TN;
  const C = TN.COURT;
  const F = TN.Frame;
  const AU = TN.Audio, SFX = AU.SFX;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const NAME = 'SUNVOLLEY';

  // ---------------------------------------------------------------------------------
  // Opponents: each one plays a recognisable way.
  const ROSTER = [
    { name: 'PIP', title: 'THE LOBBER', tier: 'ROOKIE', colors: { body: 'f2', shirt: 0x9b7bff, shorts: 0xf3f3f3, accent: 0xffe066, hair: 0xd8b060 },
      blurb: 'Loops everything high and deep, then waits for you to miss.',
      tip: 'High balls sit up. Wait for it, then swing through hard.',
      quips: ['another moonball', 'up and over', 'patience pays'],
      speed: 5.4, react: 0.34, pace: [15, 20], err: 0.14, serve: [27, 34], fault1: 0.28, fault2: 0.07, wide: 2.2, depth: [7.4, 10.0], slice: 0.08, reach: 1.15, lob: 0.4 },
    { name: 'RIO', title: 'THE ALL-ROUNDER', tier: 'PRO', colors: { body: 'm', shirt: 0xff5d73, shorts: 0x1c2b44, accent: 0xffffff, skin: 0xa86b45, hair: 0x111111 },
      blurb: 'Solid from everywhere, mixes pace and angles.',
      tip: 'Move it side to side: aim with where your hand travels.',
      quips: ['clean angle', 'right on the line', 'well worked'],
      speed: 6.6, react: 0.2, pace: [19, 26], err: 0.085, serve: [33, 42], fault1: 0.22, fault2: 0.04, wide: 3.0, depth: [7.8, 10.4], slice: 0.18, reach: 1.3, lob: 0.06 },
    { name: 'MARLO', title: 'THE WALL', tier: 'PRO', colors: { body: 'f', shirt: 0x2fbf71, shorts: 0x14202e, accent: 0xf2f2f2 },
      blurb: 'Gets everything back, deep and steady. Expect long rallies.',
      tip: 'Power alone will not get past. Go wide, then wider.',
      quips: ['the wall holds', 'one more ball', 'nothing gets by'],
      speed: 7.1, react: 0.16, pace: [18, 24], err: 0.05, serve: [30, 38], fault1: 0.14, fault2: 0.02, wide: 2.4, depth: [9.2, 10.8], slice: 0.32, reach: 1.42, lob: 0.05 },
    { name: 'VEGA', title: 'THE CANNON', tier: 'ACE', colors: { body: 'm', shirt: 0x23232c, shorts: 0x23232c, accent: 0xffb547, skin: 0xc68642, hair: 0x1a1410 },
      blurb: 'Huge serve, flat heavy hitting, aims for the lines.',
      tip: 'Take the racket back early. Big pace comes back fast.',
      quips: ['too much pace', 'bang', 'line to line'],
      speed: 7.6, react: 0.12, pace: [23, 32], err: 0.06, serve: [41, 50], fault1: 0.2, fault2: 0.03, wide: 3.6, depth: [8.6, 10.9], slice: 0.15, reach: 1.45, lob: 0 },
  ];
  const CIRCUIT = [
    { opp: 0, round: 'ROUND ONE', games: 2 },
    { opp: 2, round: 'SEMIFINAL', games: 2 },
    { opp: 3, round: 'FINAL', games: 3 },
  ];
  const P2_LOOK = { body: 'f', shirt: 0xff5d73, shorts: 0x1c2b44, accent: 0xffffff };
  const P1_LOOK = { body: 'm', shirt: 0x1aa59a, shorts: 0xf3f3f3, accent: 0xffb547, skin: 0xe2b48c, hair: 0x2a1b12, racket: 0x14202e, grip: 0xffb547 };
  const GAMES = [1, 3, 5];
  const SENS = [{ name: 'RELAXED', t: 9.5 }, { name: 'NORMAL', t: 7.0 }, { name: 'SENSITIVE', t: 5.2 }];
  const SOUND = ['ON + UMPIRE', 'ON', 'OFF'];
  // Hit zone (see contact.js ZONES): the phone has no position tracking, so height/depth get slack.
  const ZONE = ['REAL', 'NORMAL', 'EASY'];
  // Swing power: the arm model sees the arm only, not the body turning into the shot, so the
  // racket-head speed it measures is a fraction of a real swing's. This scales it back up.
  const POWER = [{ name: 'LIGHT', k: 1.6 }, { name: 'NORMAL', k: 2.2 }, { name: 'BIG', k: 3.0 }];
  const VOLUME = [1, 0.8, 0.6, 0.4, 0.2];
  // AUTO: full detail, the render scale (then the sun's shadows) give way only while the frame rate
  // stays low; HIGH: always full detail; LOW: lighter render scale, no sun shadows
  const GFX = ['AUTO', 'HIGH', 'LOW'];
  // playing hand per player: [P1, P2] (solo uses P1's)
  const HANDS = [{ name: 'RIGHT', h: ['right', 'right'] }, { name: 'LEFT', h: ['left', 'left'] },
    { name: 'P1 RIGHT · P2 LEFT', h: ['right', 'left'] }, { name: 'P1 LEFT · P2 RIGHT', h: ['left', 'right'] }];

  // Racket on the arm. The controller's arm model (metres, relative to the player's head) is
  // hung off the character's racket shoulder and scaled to the character's size.
  const MM = window.MimicMath;
  const BODY_K = 1.12;                 // athlete root scale (actors.js)
  const SHOULDER_X = 0.25 * BODY_K;    // racket shoulder, body space
  const HEAD_L = 0.53 * 1.08;          // hand -> racket head centre (racket model x scale)
  const CONTACT_R = C.R + 0.06;        // ball radius + racket-face half-size allowance
  const SERVE_PITCH = 1.35;            // racket pointing up-forward: where the toss peaks
  const MOUSE_YAW_K = 2.4, MOUSE_PITCH_K = 3.4; // test-only mouse: widen its small range into full swings
  const HEAD_VMAX = 45;                // m/s cap (a mouse can teleport the racket)
  const SLOWMO = 0.3;                  // time scale while a winner gets past
  function shoulderY(crouch) { return (0.92 - crouch * 0.12 + 0.1 + 0.46) * BODY_K; }

  const settings = { opp: 1, games: 1, sens: 1, sound: 0, zone: 1, power: 1, vol: 0, gfx: 0, hand: 0 };
  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  (function () {
    const old = loadJSON('mimicOpen.settings');   // the game's earlier save
    if (old) { Object.assign(settings, old); if (old.diff !== undefined && old.opp === undefined) settings.opp = [0, 1, 3][old.diff] || 1; }
    Object.assign(settings, loadJSON('sunvolley.settings') || {});
    settings.opp = clamp(settings.opp | 0, 0, ROSTER.length - 1);
    settings.vol = clamp(settings.vol | 0, 0, VOLUME.length - 1); settings.gfx = clamp(settings.gfx | 0, 0, GFX.length - 1);
    settings.hand = clamp(settings.hand | 0, 0, HANDS.length - 1);
  })();
  function saveSettings() { saveJSON('sunvolley.settings', settings); }
  const circuit = Object.assign({ round: 0, trophies: 0, best: 0 }, loadJSON('sunvolley.circuit') || {});
  circuit.round = Math.max(0, Math.min(CIRCUIT.length - 1, circuit.round | 0));
  function saveCircuit() { saveJSON('sunvolley.circuit', circuit); }

  // ---------------------------------------------------------------------------------
  // Controllers. Slot 0 = the first phone, with the mouse/keyboard standing in when none is there.
  const mc = new MimicController();
  const hasLibSlots = typeof MimicController.all === 'function';
  /** Fallback until games/lib ships slots: the n-th Mimic motion controller, no mouse. */
  class SlotPad extends MimicController {
    constructor(n) { super(); this._slot = n; }
    _installFallback() { /* other slots have no mouse */ }
    _findPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const list = [];
      for (const p of pads) if (p && p.connected && p.buttons.length === 12 && p.axes.length >= 6) list.push(p);
      const p = list[this._slot];
      if (p && p.axes[0] === 0 && p.axes[1] === 0 && p.axes[2] === 0 && p.axes[5] === 0) return null;
      return p || null;
    }
    update(now) {
      super.update(now);
      if (!this.connected) { this.source = 'none'; Object.keys(this._down).forEach(k => { this._down[k] = false; }); }
      return this;
    }
  }
  /** Mouse + keyboard only (a test player in the lobby next to a phone). */
  class KeyPad extends MimicController { _findPad() { return null; } }
  const slotCtrls = [mc];
  function slotCtrl(n) {
    if (!slotCtrls[n]) slotCtrls[n] = hasLibSlots ? new MimicController({ slot: n }) : new SlotPad(n);
    return slotCtrls[n];
  }
  let keyCtrl = null;
  const isPhone = c => !!c && c.connected && c.source === 'phone';
  function ctrlMode(c) { return c && c.source === 'phone' ? (c.mode || 'wand') : 'mouse'; }
  // button wording for whichever controller this is (Grip: only the volume keys are reachable)
  function btnA(c) { return ctrlMode(c) === 'grip' ? 'Vol Down' : 'A'; }
  function btnB(c) { const m = ctrlMode(c); return m === 'grip' ? 'Vol Up' : m === 'mouse' ? 'Esc' : 'B'; }
  function alignHow(c) { return ctrlMode(c) === 'grip' ? 'hold Vol Up' : 'tap Center'; }

  // the Wand points at menus like a mouse; A clicks (created once the page exists)
  let wandCursor = null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // dynamic resolution: the render scale follows the frame rate (keeps 60 on laptop GPUs and in
  // split screen, where every frame is drawn twice)
  const PR_MAX = Math.min(window.devicePixelRatio || 1, 1.25), PR_MIN = Math.min(PR_MAX, 0.6);
  const dyn = { pr: PR_MAX, t: 0, n: 0, sum: 0, low: 0, shadows: true };
  renderer.setPixelRatio(dyn.pr);
  const prTop = () => settings.gfx === 2 ? Math.min(PR_MAX, 0.85) : PR_MAX;
  function dynResolution(rdt) {
    dyn.t += rdt; dyn.n++; dyn.sum += rdt;
    if (dyn.t < 1) return;
    const fps = dyn.n / dyn.sum;
    let pr = dyn.pr;
    if (settings.gfx === 1) pr = PR_MAX;
    else if (fps < 52) pr = Math.max(PR_MIN, pr - (fps < 40 ? 0.15 : 0.07));
    else if (fps > 58.5) pr = Math.min(prTop(), pr + 0.05);
    pr = Math.min(pr, prTop());
    if (Math.abs(pr - dyn.pr) > 1e-3) { dyn.pr = pr; renderer.setPixelRatio(pr); }
    // AUTO fallback: still under 40 fps at the lowest render scale for 4 s -> drop the sun's shadows
    if (settings.gfx === 0 && dyn.shadows && pr <= PR_MIN + 1e-3 && fps < 40) { if (++dyn.low >= 4) setShadows(false); } else dyn.low = 0;
    dyn.t = dyn.n = dyn.sum = 0;
  }
  function setShadows(on) {
    dyn.shadows = on; dyn.low = 0;
    if (typeof world !== 'undefined' && world) world.lights.sun.castShadow = on;
  }
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;   // rendered once per frame even with two views
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $('stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);
  const camera2 = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 900);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); });

  const world = TN.buildWorld(scene);
  setShadows(settings.gfx !== 2);
  const fx = TN.makeBallFX(scene);
  const machine = TN.makeBallMachine();
  machine.position.set(0, 0, -12.4); machine.visible = false;
  scene.add(machine);

  function athlete(colors) { const a = TN.makeAthlete(colors); a.addTo(scene); return a; }
  /** Materials of an athlete by the colour they were made with, so the kit can be repainted. */
  function paintable(model, base) {
    const by = {};
    [model.root, model.rUpper, model.rFore, model.hand, model.racket].forEach(o => o.traverse(m => {
      if (!m.isMesh || !m.material || !m.material.color) return;
      const k = m.material.color.getHex();
      (by[k] = by[k] || new Set()).add(m.material);
    }));
    return function paint(c) {
      ['shirt', 'shorts', 'accent'].forEach(r => (by[base[r]] || []).forEach(mat => mat.color.setHex(c[r])));
    };
  }
  const P = {
    i: 0, side: 1, x: 0.9, z: 12.3, vx: 0, vz: 0, facing: 0, phase: 0, run: 0, plan: null, stroke: 'fh', cplan: null,
    model: athlete({ shirt: 0x1aa59a, shorts: 0xf3f3f3, skin: 0xe2b48c, hair: 0x2a1b12, accent: 0xffb547, racket: 0x14202e, grip: 0xffb547 }),
    home: { x: 0, z: 12.6 },
  };
  // made with unique placeholder colours (0x...fe) so the kit can be repainted per opponent
  const AI_BASE = { shirt: 0xff5d74, shorts: 0x1c2b45, accent: 0xfefefe };
  const AI = {
    i: 1, side: -1, x: -0.9, z: -12.3, vx: 0, vz: 0, facing: Math.PI, phase: 0, run: 0, plan: null, stroke: 'fh', cplan: null,
    model: athlete({ shirt: AI_BASE.shirt, shorts: AI_BASE.shorts, skin: 0xa86b45, hair: 0x111111, accent: AI_BASE.accent, racket: 0xf2f2f2, grip: 0x1c2b44 }),
    swing: null, reactAt: 0, hitDone: false, home: { x: 0, z: -12.6 }, human: null,
  };
  const paintOld = paintable(AI.model, AI_BASE);
  const rigAI = {};            // skinned opponents by body, made once the models load
  let aiLook = null;
  function paintAI(look) {
    aiLook = look;
    if (!rigAI.m) { paintOld(look); return; }
    const want = rigAI[look.body] || rigAI.m;
    if (AI.model !== want) {
      const vis = AI.model.root.visible;
      AI.model.setVisible(false);
      AI.model = want; want.setVisible(vis);
    }
    want.paint(look);
  }
  /** Swap the simple athletes for the skinned ones and the capsule crowd for impostors. */
  function upgradeLooks() {
    const pv = P.model.root.visible;
    P.model.setVisible(false);
    P.model = TN.makeRigAthlete(P1_LOOK); P.model.addTo(scene); P.model.setVisible(pv);
    const av = AI.model.root.visible;
    ['m', 'f', 'f2'].forEach(b => {
      rigAI[b] = TN.makeRigAthlete({ body: b, shirt: 0xff5d73, shorts: 0x1c2b44, accent: 0xffffff, racket: 0xf2f2f2, grip: 0x1c2b44 });
      rigAI[b].addTo(scene); rigAI[b].setVisible(false);
    });
    AI.model.setVisible(false);
    AI.model = rigAI.m; AI.model.setVisible(av);
    if (aiLook) paintAI(aiLook);
    const U = world.crowd.umpire;
    if (U) {
      const u = TN.makeSeated('m', { shirt: 0xf4f4f0, shorts: 0x14304e, skin: 0xc68642, hair: 0x2a2a2a, shoes: 0x111111 }, 1.8);
      // seated: the hips sit on the chair (the clip's hips are about a quarter of the height up)
      u.group.position.set(U.seat.x + 0.08, U.seat.y - 0.47, U.seat.z);
      u.group.rotation.y = Math.PI / 2;           // looking across the court
      scene.add(u.group);
      U.standIn.forEach(m => { m.visible = false; });
    }
    try {
      const atlas = TN.bakeCrowdAtlas(renderer);
      TN._atlas = atlas;
      const upd = TN.crowdImpostors(scene, world.crowd, atlas);
      const cr = world.crowd;
      cr.update = dt => { cr.t += dt; cr.excite = Math.max(0, cr.excite - dt * 0.35); upd(dt, crowdView); };
    } catch (e) { console.warn('Sunvolley: crowd impostors unavailable', e); }
  }
  const crowdView = new THREE.Vector3(0, 6, 30);
  TN.Rig.onReady(upgradeLooks);
  const ball = {
    p: { x: 0, y: 1, z: 12 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, rolling: false,
    held: 0, toss: false, lastHitter: -1, bounces: 0, serve: false, netTouch: false, decided: true, deuce: true, hitT: 0,
  };

  const G = {
    mode: 'title', inGame: false, paused: false, practice: false, kind: 'match', screen: 'title', panel: 'main',
    t: 0, timer: 0, hitStop: 0, inputGuard: 0, slow: 0, slowDone: false,
    score: { pts: [0, 0], games: [0, 0] }, server: 0, faults: 0, rally: 0, gamesToWin: 3,
    stats: null, shake: 0, punch: 0, aiServeAt: 0, hits: 0, whiffs: 0, lastShot: null,
    prac: { streak: 0, best: 0, hits: 0, ins: 0, targets: 0, side: 1, serveCount: 0 },
    opp: ROSTER[1], round: -1,
  };
  function newStats() { return { won: [0, 0], winners: [0, 0], aces: [0, 0], errors: [0, 0], df: [0, 0], top: [0, 0], longest: 0 }; }
  const versus = () => G.kind === 'versus';

  // ---------------------------------------------------------------------------------
  // Human players
  function makeHuman(idx, A, cam) {
    return {
      idx, A, s: A.side, mc, cam, kind: 'phone',
      SW: { active: false, t: 0, peak: 0, peakT: 0, vert: 0, horiz: 0, cool: 0, lastFy: null, lastYaw: 0 },
      HAND: TN.handTracker(),   // the hand's own motion: aims the ball, speed sets power
      RK: {
        q: new THREE.Quaternion(), hand: new THREE.Vector3(), elbow: new THREE.Vector3(), anchor: new THREE.Vector3(), tmp: new THREE.Vector3(),
        wq: new THREE.Quaternion(), whand: new THREE.Vector3(), welbow: new THREE.Vector3(),
        head: null, headPrev: null, rel: null, vel: { x: 0, y: 0, z: 0 }, speed: 0, nearMiss: false,
      },
      MG: { used: false, wasActive: false, kind: null },
      near: null, lastShot: null, hits: 0, camState: { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3() },
    };
  }
  const H = [makeHuman(0, P, camera), makeHuman(1, AI, camera2)];
  let humans = [H[0]];                       // active this match
  const humanOf = idx => humans.find(h => h.idx === idx) || null;
  const loc = (h, v) => F.L(h.s, v);         // world <-> this player's frame (same map both ways)
  function nameOf(i) { return versus() ? 'P' + (i + 1) : i === 0 ? 'YOU' : G.opp.name; }
  function callName(i) { return versus() ? (i === 0 ? 'player one' : 'player two') : i === 0 ? 'player' : G.opp.name.toLowerCase(); }

  // practice targets: glowing rings deep in the opponent's corners
  const targets = [];
  [-1, 1].forEach(s => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
    m.rotation.x = -Math.PI / 2; m.position.set(s * 2.7, 0.006, -9.6); m.visible = false;
    scene.add(m);
    targets.push(m);
  });

  // ---------------------------------------------------------------------------------
  // HUD helpers
  const sfx = i => (i ? '-' + i : '');
  const hud = {
    banner(main, sub, kind, dur) {
      const b = $('banner');
      b.querySelector('.b-main').textContent = main;
      b.querySelector('.b-sub').textContent = sub || '';
      b.className = 'on slam ' + (kind || 'neutral');
      void b.offsetWidth;
      clearTimeout(hud._bt);
      hud._bt = setTimeout(() => { b.className = ''; }, (dur || 1.6) * 1000);
    },
    /** Shot readout for player i: speed, tags, and where the ball will land (mini court). */
    speed(i, kmh, tags, land) {
      const s = $('speed' + sfx(i));
      s.querySelector('b').textContent = Math.round(kmh);
      s.querySelector('.sp-val').style.display = kmh ? '' : 'none';
      s.querySelector('.sp-tags').innerHTML = (tags || []).map(t => `<span class="${t[1] || ''}">${t[0]}</span>`).join('');
      const ct = s.querySelector('.sp-court');
      if (land) {
        const dot = ct.querySelector('.sp-dot');
        // local frame: x across (-6..6 m), z from the net (0) to past the far baseline (-14 m)
        dot.style.left = clamp((land.x + 6) / 12, 0.02, 0.98) * 100 + '%';
        dot.style.top = clamp((land.z + 14) / 14, 0.02, 0.98) * 100 + '%';
        dot.className = 'sp-dot ' + (land.in ? 'in' : 'out');
        ct.classList.toggle('serve', !!land.box);
        ct.style.display = '';
      } else ct.style.display = 'none';
      s.className = 'speed on';
      clearTimeout(hud['_st' + i]);
      hud['_st' + i] = setTimeout(() => { s.className = 'speed'; }, 2100);
    },
    prompt(i, html) {
      const p = $('prompt' + sfx(i));
      if (!p) return;
      if (!html) { p.className = 'prompt'; return; }
      if (p._html !== html) { p.innerHTML = html; p._html = html; }
      p.className = 'prompt on';
    },
    clearPrompts() { [0, 1].forEach(i => { const p = $('prompt' + sfx(i)); p.className = 'prompt'; p._html = ''; }); },
    score() {
      const s = G.score;
      for (let i = 0; i < 2; i++) {
        const row = $('sb-p' + i);
        row.querySelector('.sb-name').textContent = nameOf(i);
        row.querySelector('.sb-games').textContent = s.games[i];
        const el = row.querySelector('.sb-pts');
        const txt = ptsLabel(i);
        if (el.textContent !== txt) { el.textContent = txt; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        row.classList.toggle('serving', G.server === i);
      }
      const a = s.pts[0], b = s.pts[1];
      const tag = $('sb-tag');
      let t = '';
      if (a >= 3 && b >= 3) t = a === b ? 'DEUCE' : 'ADVANTAGE ' + nameOf(a > b ? 0 : 1);
      const gp = isGamePoint();
      if (gp >= 0 && !t) t = (s.games[gp] + 1 >= G.gamesToWin ? 'MATCH POINT ' : 'GAME POINT ') + nameOf(gp);
      else if (gp >= 0) t += ' · ' + (s.games[gp] + 1 >= G.gamesToWin ? 'MATCH POINT' : 'GAME POINT');
      tag.textContent = t; tag.className = t ? 'on' : '';
      $('sb-mode').textContent = (G.kind === 'circuit' ? CIRCUIT[G.round].round + ' · ' : '') + 'FIRST TO ' + G.gamesToWin;
    },
    practice() {
      const p = G.prac;
      $('pb-streak').textContent = p.streak;
      $('pb-best').textContent = p.best;
      $('pb-in').textContent = p.hits ? Math.round((p.ins / p.hits) * 100) + '%' : '0%';
      $('pb-targets').textContent = p.targets;
    },
    rally(n) {
      const c = $('rally-chip');
      if (n >= 4 && !G.practice) {
        c.classList.remove('hidden'); c.querySelector('b').textContent = n;
        c.classList.toggle('hot', n >= 10);
      } else c.classList.add('hidden');
    },
    toast(i, text) {
      const t = $('toast' + sfx(i));
      t.textContent = text; t.className = 'toast on';
      clearTimeout(hud['_tt' + i]);
      hud['_tt' + i] = setTimeout(() => { t.className = 'toast'; }, 1300);
    },
  };

  function ptsLabel(i) {
    const a = G.score.pts[i], b = G.score.pts[1 - i];
    if (a >= 3 && b >= 3) return a > b ? 'AD' : '40';
    return ['0', '15', '30', '40'][Math.min(3, a)];
  }
  function isGamePoint() {
    const [a, b] = G.score.pts;
    if (a >= 3 && a > b) return 0;
    if (b >= 3 && b > a) return 1;
    return -1;
  }
  function callText() {
    const sv = G.server, a = G.score.pts[sv], b = G.score.pts[1 - sv];
    const names = ['love', 'fifteen', 'thirty', 'forty'];
    if (a >= 3 && b >= 3) {
      if (a === b) return 'Deuce';
      return 'Advantage, ' + callName(a > b ? sv : 1 - sv);
    }
    if (a === b) return names[a] + ' all';
    return names[a] + ', ' + names[b];
  }
  function say(t) { if (settings.sound === 0) AU.say(t); }

  // ---------------------------------------------------------------------------------
  // Swing detection (per player, in the controller's own frame)
  function swingThreshold() { return SENS[settings.sens].t; }
  function detectSwing(h, dt) {
    const mc = h.mc, SW = h.SW;
    const f = mc.forward, yaw = mc.yaw;
    let dv = 0, dh = 0;
    if (SW.lastFy !== null) {
      dv = f.y - SW.lastFy;
      dh = yaw - SW.lastYaw;
      if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
    }
    SW.lastFy = f.y; SW.lastYaw = yaw;
    TN.handStep(h.HAND, mc.linearAccel, dt);
    SW.cool -= dt;
    const w = mc.angularSpeed, T = swingThreshold();
    if (!SW.active) {
      if (w > T && SW.cool <= 0 && G.inputGuard <= 0) {
        SW.active = true; SW.t = 0; SW.peak = w; SW.peakT = G.t; SW.vert = dv; SW.horiz = Math.abs(dh);
        TN.handMark(TN.handStart(h.HAND));
        if (G.inGame && !G.paused) SFX.whoosh(mc.angularSpeed);   // whether the ball is hit is decided by the racket
      }
    } else {
      SW.t += dt; if (w > SW.peak) { SW.peak = w; SW.peakT = G.t; } SW.vert += dv; SW.horiz += Math.abs(dh);
      TN.handMark(h.HAND);
      if ((SW.t > 0.12 && w < T * 0.5) || SW.t > 0.7) { SW.active = false; SW.cool = 0.12; }
    }
  }

  // ---------------------------------------------------------------------------------
  // The racket, carried by the arm model (positions in the player's own frame)
  const isMouse = h => h.mc.source !== 'phone';
  /** 'right' | 'left': the hand this player holds the phone in (options: PLAYING HAND). */
  const handOf = h => HANDS[settings.hand].h[h.idx] || 'right';
  const shoulderX = h => SHOULDER_X * TN.sideSign(handOf(h));   // racket shoulder, body space
  function playerYaw(h) { return isMouse(h) ? h.mc.yaw * MOUSE_YAW_K : h.mc.yaw; }
  function playerPitch(h) { return isMouse(h) ? h.mc.pitch * MOUSE_PITCH_K : h.mc.pitch; }
  function playerCrouch() { return G.inGame && G.mode === 'rally' ? 0.5 : 0.25; }
  /** Controller orientation that drives the arm. Phone: exactly mc.quat (top = racket head,
   * screen = string face). Mouse (testing): its yaw/pitch widened; face on edge for groundstrokes,
   * face forward for the serve (a mouse has no roll). */
  function controlQuat(h) {
    if (!isMouse(h)) return h.mc.quat;
    const serveLike = G.inGame && (G.mode === 'serve' || G.mode === 'toss');
    return MM.fromEuler(playerYaw(h), playerPitch(h), serveLike ? 0 : -Math.PI / 2 * TN.sideSign(handOf(h)));
  }
  function armFor(h, q) { return isMouse(h) ? MM.armPose(q, handOf(h)) : h.mc.arm; }
  /** Racket head centre relative to the character's racket shoulder (character metres). */
  function headRel(q, arm) {
    const d = MM.rotate(q, { x: 0, y: 0, z: -HEAD_L }), s = arm.shoulder;
    return { x: (arm.hand.x - s.x) * BODY_K + d.x, y: (arm.hand.y - s.y) * BODY_K + d.y, z: (arm.hand.z - s.z) * BODY_K + d.z };
  }
  const v3 = (o, p) => o.set(p.x, p.y, p.z);
  function updateRacket(h, rdt) {
    const RK = h.RK;
    const q = controlQuat(h), arm = armFor(h, q), s = arm.shoulder;
    const la = loc(h, { x: h.A.x, y: 0, z: h.A.z });
    const ax = la.x + shoulderX(h), ay = shoulderY(playerCrouch()), az = la.z;
    const jumped = RK.anchor.distanceTo(RK.tmp.set(ax, ay, az)) > 0.6; // serve setup teleports the body
    RK.anchor.set(ax, ay, az);
    RK.elbow.set(ax + (arm.elbow.x - s.x) * BODY_K, ay + (arm.elbow.y - s.y) * BODY_K, az + (arm.elbow.z - s.z) * BODY_K);
    RK.hand.set(ax + (arm.hand.x - s.x) * BODY_K, ay + (arm.hand.y - s.y) * BODY_K, az + (arm.hand.z - s.z) * BODY_K);
    RK.q.set(q.x, q.y, q.z, q.w);
    // the same, in the world, for drawing
    v3(RK.welbow, loc(h, RK.elbow)); v3(RK.whand, loc(h, RK.hand));
    const wq = F.quatToWorld(h.s, q); RK.wq.set(wq.x, wq.y, wq.z, wq.w);
    const rel = headRel(q, arm);
    // head velocity produced by the arm (running is not swing effort)
    if (RK.rel && rdt > 0) {
      let v = { x: (rel.x - RK.rel.x) / rdt, y: (rel.y - RK.rel.y) / rdt, z: (rel.z - RK.rel.z) / rdt };
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > HEAD_VMAX) { const k = HEAD_VMAX / sp; v = { x: v.x * k, y: v.y * k, z: v.z * k }; }
      RK.vel = v; RK.speed = Math.min(sp, HEAD_VMAX);
    }
    RK.rel = rel;
    RK.headPrev = jumped ? null : RK.head;
    RK.head = { x: ax + rel.x, y: ay + rel.y, z: az + rel.z };
  }
  /** Where the racket head will be (body space) if you swing your arm, as you hold it now,
   * around to the contact angle: footwork target. Only the yaw is changed. */
  function contactOffset(h, yawC, q, crouch) {
    const f = MM.rotate(q, { x: 0, y: 0, z: -1 });
    const turn = yawC - Math.atan2(-f.x, -f.z);
    const qc = MM.mul({ x: 0, y: Math.sin(turn / 2), z: 0, w: Math.cos(turn / 2) }, q);
    const hr = headRel(qc, MM.armPose(qc, handOf(h)));
    return { x: shoulderX(h) + hr.x, y: shoulderY(crouch) + hr.y, z: hr.z };
  }

  /**
   * Footwork: pick where on the incoming flight to meet the ball (at the height your racket is
   * held, near the baseline, reachable in time) and run so a level swing of your arm passes
   * through it. The swing itself stays entirely yours. Plan in the player's frame.
   */
  function contactPlan(h, prev) {
    const yaw = playerYaw(h);
    const hand = handOf(h);
    const stroke = TN.strokeSide(yaw, hand); // racket taken back on a side = that stroke (mirrored for lefties)
    const q = controlQuat(h);
    const lb = F.localBall(h.s, ball);
    const me = loc(h, { x: h.A.x, y: 0, z: h.A.z });
    const pr = TN.predict(lb, 4.5, 1);
    // contact angle chosen so an on-time level swing sends it toward the middle of the far court
    // (the head moves along the tangent of its arc); the actual aim comes from the swing itself
    const bx = pr.firstBounce ? pr.firstBounce.x : lb.p.x;
    const az = Math.atan2(-bx * 0.9, 20);
    function best(st) {
      const yawC = TN.contactYaw(st, az, hand);
      const off = contactOffset(h, yawC, q, 0.5);
      let pick = null, cost = 1e9;
      for (let i = 0; i < pr.length; i++) {
        const s = pr[i];
        if (s.bounces >= 2) break;
        if (s.z < 1.0) continue;
        const tx = s.x - off.x, tz = s.z - off.z;
        const travel = Math.hypot(tx - me.x, tz - me.z);
        const c = Math.abs(s.y - off.y) * 4 + Math.abs(s.z - 11.8) * 0.12 + (s.bounces === 0 ? 0.6 : 0) +
          Math.max(0, travel / 7 - s.t) * 6;
        if (c < cost) { cost = c; pick = s; }
      }
      return pick && { t: G.t + pick.t, x: pick.x, y: pick.y, z: pick.z, stroke: st, off, yawC, cost: cost + (st === 'bh' ? 0.4 : 0) };
    }
    if (stroke) return best(stroke);
    if (prev && prev.stroke) { const p = best(prev.stroke); if (p) return p; }
    const a = best('fh'), b = best('bh');
    return !a ? b : !b ? a : (a.cost <= b.cost ? a : b);
  }

  // ---------------------------------------------------------------------------------
  // Contact
  function contactKind(h) {
    if (!G.inGame || G.paused || ball.decided) return null;
    if (G.mode === 'toss' && ball.toss && tossOwner === h.idx) return 'serve';
    if (G.mode === 'rally' && ball.held < 0 && ball.lastHitter !== h.idx && ball.lastHitter !== -1 && ball.bounces <= 1 && h.s * ball.p.z > 0) return 'rally';
    return null;
  }
  // ---------------------------------------------------------------------------------
  // Magnetic contact (Hit zone NORMAL / EASY). The phone measures rotation and swing speed
  // precisely but not where the hand is, so a hit is a swing at the right moment: the ball meets
  // the strings. The racket angle is automatic: where your hand was travelling aims the ball, how
  // fast you swung (hand or wrist, whichever is bigger) sets how far; over-hit and it goes long.
  // Timing only decides hit or miss.
  function magnetContact(h, kind) {
    const SW = h.SW, MG = h.MG, mc = h.mc;
    const W = TN.MAGNET_WINDOW[ZONE[settings.zone]];
    const started = SW.active && !MG.wasActive;
    MG.wasActive = SW.active;
    if (started) { MG.used = false; MG.kind = kind; }
    if (!SW.active || MG.used || !kind) return;
    // The hit happens at the swing's peak (fastest moment), not when the window first opens:
    // a real swing winds up early, and judging its start would always read "early".
    const peaked = mc.angularSpeed < SW.peak * 0.85 && SW.t > 0.04;
    const plan = kind === 'rally' ? h.A.cplan : null;
    const ballPassing = plan && G.t - plan.t > W;          // ball leaving the window mid-swing
    if (!peaked && !ballPassing) return;
    MG.used = true;
    const k = mc.source === 'phone' ? POWER[settings.power].k / 2.2 : 1;
    const bias = TN.swingBias(kind === 'serve' ? 'sv' : (plan && plan.stroke) || 'fh', handOf(h));
    const hand = TN.handDir(h.HAND, bias);
    const power = Math.min(1.25, Math.max(TN.swingPower(SW.peak, swingThreshold(), k), TN.handPower(hand.speed) * k));
    const headSpeed = 4 + power * 24;                     // for the rumble and readouts
    if (kind === 'serve') {
      const lowBy = Math.max(0, (G.tossPeakY || ball.p.y) - ball.p.y);
      if (ball.v.y > 2.5 || lowBy > 1.0) { whiff(h, 'serve', ball.v.y > 2.5 ? 'TOO EARLY' : 'TOO LATE'); return; }
      magnetHit(h, 'serve', headSpeed, 0, lowBy, W, power, hand);
      return;
    }
    if (!plan) return;
    const e = SW.peakT - plan.t;
    if (!TN.inWindow(e, W)) { whiff(h, 'rally', e < 0 ? 'EARLY' : 'LATE'); return; }
    magnetHit(h, 'rally', headSpeed, e, 0, W, power, hand);
  }
  function whiff(h, kind, label) {
    G.whiffs++;
    hud.speed(h.idx, 0, [['WHIFF', 'warn'], [label, '']]);
    if (kind === 'rally') hud.prompt(h.idx, label === 'EARLY' ? 'A touch <b>later</b>: swing as the ball reaches you' : 'A touch <b>earlier</b>: start the swing as it bounces');
  }
  function magnetHit(h, kind, headSpeed, e, lowBy, W, swingPow, dir) {
    const RK = h.RK;
    // the magnet: the ball meets the strings (when the racket is close enough to look right)
    if (RK.head) {
      const lb = loc(h, ball.p);
      const dx = RK.head.x - lb.x, dy = RK.head.y - lb.y, dz = RK.head.z - lb.z;
      if (Math.hypot(dx, dy, dz) < 0.9 && RK.head.y > 0.45) ball.p = loc(h, RK.head);
    }
    const from = loc(h, ball.p);
    let sol, power = swingPow, tags = [];
    if (kind === 'serve') {
      const box = TN.serviceBox(-1, ball.deuce);       // the receiver's box, in my frame
      const m = TN.swingServe({ from, az: dir.az, power, box });
      const net = Math.random() < clamp((lowBy - 0.3) / 0.6, 0, 1);   // hit well below the toss: into the net
      const target = net ? { x: m.target.x, z: -0.8 } : m.target;
      sol = TN.solveShot(from, target, m.pace, m.top, { clearNet: !net, margin: 0.04 });
      tags.push([lowBy < 0.25 ? 'PERFECT TOSS' : 'SERVE', lowBy < 0.25 ? 'hot' : '']);
    } else {
      const m = TN.swingRally({ from, az: dir.az, power, lift: dir.lift });
      sol = TN.solveShot(from, m.target, m.pace, m.top, { clearNet: true, margin: 0.12 });
      tags.push(Math.abs(e) < W * 0.25 ? ['PERFECT', 'hot'] : [e < 0 ? 'EARLY' : 'LATE', '']);
      tags.push([m.top > 0.35 ? 'TOPSPIN' : m.top < -0.2 ? 'SLICE' : 'FLAT', '']);
    }
    tags.push(power > 1 ? ['OVER-HIT', 'warn'] : ['POWER ' + Math.round(power * 100) + '%', power > 0.8 ? 'hot' : '']);
    sol = F.solToWorld(h.s, sol);
    // the bang
    h.mc.rumble(clamp(headSpeed / 30, 0.25, 1), 40 + 60 * power, 0);
    G.hitStop = 0.06; G.shake = 0.05 + 0.16 * power; G.punch = 0.3 + 0.7 * power;
    G.hits++; h.hits++;
    G.lastShot = h.lastShot = { kind, headSpeed, e, magnet: true, power, az: dir.az };
    if (kind === 'serve') {
      ball.serve = true; G.mode = 'rally'; G.rally = -1;
      launch(sol, h.idx, { power, quality: 0.9, tags, serve: true });
    } else {
      launch(sol, h.idx, { power, quality: Math.abs(e) < W * 0.25 ? 1 : 0.75, tags });
      if (G.practice) G.prac.hits++;
    }
  }

  function checkContact(h, ballPrevW) {
    const kind = contactKind(h);
    if (settings.zone !== 0) { magnetContact(h, kind); return; }
    const RK = h.RK;
    const ballNow = loc(h, ball.p), ballPrev = loc(h, ballPrevW);
    if (RK.nearMiss && (!kind || ballNow.z > RK.anchor.z + 1.0)) {
      RK.nearMiss = false; G.whiffs++;
      // swept past it: no rumble, but say how it missed so the swing can be corrected
      hud.speed(h.idx, 0, h.near && h.near.d ? [['WHIFF', 'warn'], [TN.missLabel(h.near.d), '']] : [['WHIFF', 'warn']]);
    }
    if (!kind || !RK.headPrev) return;
    if (kind === 'serve' && RK.speed < 3) return; // a racket held still in the toss's path doesn't serve
    const zone = { r: CONTACT_R, ky: 1, kz: 1 };
    const res = TN.zoneContact(RK.headPrev, RK.head, ballPrev, ballNow, zone);
    if (!h.near || h.near.id !== ball.hitT || res.dist < h.near.dist) // closest approach this ball (testing aid)
      h.near = { id: ball.hitT, kind, dist: res.dist, d: { x: res.headPoint.x - res.point.x, y: res.headPoint.y - res.point.y, z: res.headPoint.z - res.point.z }, speed: RK.speed, t: G.t };
    if (!res.hit) {
      if (res.dist < 0.8 && RK.speed > 4) RK.nearMiss = true;
      return;
    }
    RK.nearMiss = false;
    const at = { x: res.point.x, y: Math.max(C.R, res.point.y), z: res.point.z };
    ball.p = loc(h, at);
    const normal = MM.rotate({ x: RK.q.x, y: RK.q.y, z: RK.q.z, w: RK.q.w }, { x: 0, y: 1, z: 0 });
    const pk = h.mc.source === 'phone' ? POWER[settings.power].k : 1; // the test mouse already exaggerates
    const shot = TN.shotFromContact({ normal, headVel: { x: RK.vel.x * pk, y: RK.vel.y * pk, z: RK.vel.z * pk }, ballVel: loc(h, ball.v) });
    const power = clamp((shot.headSpeed - 4) / 24, 0, 1);
    // the bang
    h.mc.rumble(clamp(shot.headSpeed / 30, 0.25, 1), 40 + 60 * power, 0);
    G.hitStop = 0.06; G.shake = 0.05 + 0.16 * power; G.punch = 0.3 + 0.7 * power;
    G.hits++; h.hits++;
    const sweet = res.dist < 0.035;
    G.lastShot = h.lastShot = { kind, headSpeed: shot.headSpeed, pace: shot.pace, top: shot.top, elevDeg: shot.elevDeg, dist: res.dist };
    const sol = F.solToWorld(h.s, aimShot(h, shot, at, kind === 'serve'));
    const tags = [];
    if (kind === 'serve') {
      ball.serve = true; G.mode = 'rally'; G.rally = -1; // the serve does not count toward the rally
      tags.push([sweet ? 'SWEET SPOT' : 'SERVE', sweet ? 'hot' : '']);
      if (power > 0.8) tags.push(['BIG SERVE', 'hot']);
      launch(sol, h.idx, { power, quality: sweet ? 1 : 0.75, tags, serve: true });
    } else {
      if (sweet) tags.push(['SWEET SPOT', 'hot']);
      tags.push([shot.top > 0.35 ? 'TOPSPIN' : shot.top < -0.2 ? 'SLICE' : 'FLAT', '']);
      if (power > 0.8) tags.push(['POWER', 'hot']);
      launch(sol, h.idx, { power, quality: sweet ? 1 : 0.75, tags });
      if (G.practice) G.prac.hits++;
    }
  }

  /**
   * Turn the contact into a flight (player's frame). Direction across the court is the blended
   * face/swing direction as is. Its elevation sets the depth (0.42 m per degree; raw ballistics
   * would be ~1.4 m per degree at this pace, too twitchy for a phone): too closed finds the net,
   * too open sails long. Pace and spin are exactly what the contact produced.
   */
  function aimShot(h, shot, from, serve) {
    const d = shot.dir, hh = Math.hypot(d.x, d.z);
    const pace = clamp(shot.pace, 3, 62), top = clamp(shot.top, -0.9, 1);
    const raw = () => {
      const hx = hh > 1e-6 ? d.x / hh : 0, hz = hh > 1e-6 ? d.z / hh : -1;
      return { v: { x: d.x * pace, y: d.y * pace, z: d.z * pace }, w: TN.spinVector(hx, hz, top) };
    };
    if (hh < 0.2 || -d.z / hh < 0.25) return raw(); // heading sideways, backwards, straight up or down
    const D = serve ? 5.3 + (shot.elevDeg + 12) * 0.3 : 8.6 + (shot.elevDeg - 2) * 0.42; // past the net
    if (D < 0.6) return raw();
    const tz = -D, s = (from.z - tz) / -d.z;
    const tx = from.x + d.x * s;
    if (Math.abs(tx) > 30) return raw();
    if (h.lastShot) h.lastShot.aim = { tx, tz, az: Math.atan2(d.x, -d.z) * 180 / Math.PI }; // testing aid
    return TN.solveShot(from, { x: tx, z: tz }, pace * (hh / Math.hypot(hh, d.y)), top, { clearNet: false });
  }

  // ---------------------------------------------------------------------------------
  // Prediction / planning (the computer opponent, world frame)
  function planFor(who) {
    const s = who.side;
    const pr = TN.predict(ball, 4.5, 2);
    const fb = pr.firstBounce;
    const plan = { out: false, t: 0, x: 0, y: 0, z: 0, fb };
    // first bounce decides legality
    const hitterSide = ball.lastHitter === 0 ? 1 : -1;
    if (!fb) { plan.out = true; return plan; }
    if (ball.serve) {
      const box = TN.serviceBox(s, ball.deuce);
      if (fb.z * s <= 0 || !TN.inBox(fb.x, fb.z, box)) plan.out = true;
    } else if (fb.z * s <= 0 || !TN.inCourt(fb.x, fb.z, s)) plan.out = true;
    if (hitterSide === s) plan.out = true;
    let pick = null, last = null;
    for (let i = 0; i < pr.length; i++) {
      const q = pr[i];
      if (q.bounces === 0 || q.z * s < 1.0) continue;
      if (q.bounces >= 2) break;
      last = q;
      const zz = q.z * s;
      if ((q.vy < 0 && q.y < 1.25 && q.y > 0.3) || zz > 13.4) { pick = q; break; }
    }
    pick = pick || last;
    if (!pick) { plan.out = true; return plan; }
    plan.t = G.t + pick.t; plan.x = pick.x; plan.y = pick.y; plan.z = pick.z;
    return plan;
  }

  // ---------------------------------------------------------------------------------
  // Launching shots
  function landingFor(h, isServe) {
    const fb = TN.predict(ball, 4, 3).firstBounce;
    if (!fb) return null;
    const recv = -h.s;
    const inn = isServe ? TN.inBox(fb.x, fb.z, TN.serviceBox(recv, ball.deuce)) : TN.inCourt(fb.x, fb.z, recv);
    const l = loc(h, { x: fb.x, y: 0, z: fb.z });
    return { x: l.x, z: l.z, in: inn, box: isServe };
  }
  function launch(sol, hitter, info) {
    ball.v = { x: sol.v.x, y: sol.v.y, z: sol.v.z };
    ball.w = { x: sol.w.x, y: sol.w.y, z: sol.w.z };
    ball.rolling = false;
    ball.lastHitter = hitter;
    ball.serve = !!info.serve;
    ball.bounces = 0;
    ball.netTouch = false;
    ball.hitT = G.t;
    ball.held = -1; ball.toss = false;
    G.rally++;
    hud.rally(G.rally);
    if (G.rally === 10) AU.Crowd.react('ooh');
    const kmh = Math.hypot(sol.v.x, sol.v.y, sol.v.z) * 3.6;
    if (G.stats && hitter < 2) G.stats.top[hitter] = Math.max(G.stats.top[hitter], kmh);
    const power = info.power;
    SFX.hit(power, info.quality, hitter !== 0 && !versus());
    fx.impact(ball.p.x, ball.p.y + 0.04, ball.p.z, power, hitter === 0 ? 0xfff2b0 : 0xffd0d8);
    fx.setTrailColor(hitter === 0 ? 0xbfffe0 : 0xffd2a8);
    const hh = humanOf(hitter);
    if (hh) {
      if (info.tags) hud.speed(hh.idx, kmh, info.tags, landingFor(hh, !!info.serve)); // hit-stop, kick and rumble come from the contact
      hud.prompt(hh.idx, '');
    } else if (!versus()) hud.speed(0, kmh, [[hitter === 1 && !G.practice ? G.opp.name : 'MACHINE', '']]);
    // plans
    humans.forEach(h => { h.A.cplan = null; h.RK.nearMiss = false; });
    AI.plan = null;
    if (hitter === 0 && !AI.human) {
      AI.plan = planFor(AI);
      AI.reactAt = G.t + G.opp.react;
      AI.hitDone = false;
      if (AI.plan && !AI.plan.out) AI.stroke = AI.plan.x <= AI.x + 0.15 ? 'fh' : 'bh';
    }
  }

  function aiHit() {
    const D = G.opp;
    const inSpeed = Math.hypot(ball.v.x, ball.v.z);
    const stretch = clamp(Math.abs(ball.p.x - (AI.x + (AI.stroke === 'fh' ? -0.72 : 0.72))) / 1.4, 0, 1);
    let errP = D.err + Math.max(0, inSpeed - 24) * 0.006 + stretch * 0.1 + Math.max(0, G.rally - 12) * 0.004;
    let tx = rand(-1, 1) * D.wide;
    if (Math.random() < 0.6) tx = Math.sign(-P.x || (Math.random() - 0.5)) * Math.abs(tx); // away from the player
    let tz = rand(D.depth[0], D.depth[1]);
    let hs = rand(D.pace[0], D.pace[1]) * (1 - stretch * 0.15);
    let top = rand(0.2, 0.85);
    if (D.lob && stretch < 0.7 && Math.random() < D.lob) { hs = rand(11, 14); top = rand(0.6, 0.95); tz = rand(9.4, 10.9); } // a high, deep loop
    else if (Math.random() < D.slice || stretch > 0.7) { top = rand(-0.7, -0.3); hs *= 0.85; }
    let clearNet = true;
    if (Math.random() < errP) {
      const r = Math.random();
      if (r < 0.4) { tz = rand(0.3, 2.5); clearNet = false; }
      else if (r < 0.75) tz = rand(12.3, 14.5);
      else tx = Math.sign(tx || 1) * rand(4.4, 5.6);
    }
    const sol = TN.solveShot(ball.p, { x: tx, z: tz }, hs, top, { clearNet, margin: 0.2 });
    launch(sol, 1, { power: clamp((hs - 16) / 16, 0, 1), quality: 0.9 });
  }

  // ---------------------------------------------------------------------------------
  // Serving
  let tossOwner = -1;
  function isDeuceCourt() { return (G.score.pts[0] + G.score.pts[1]) % 2 === 0; }

  function servePrompt(h) {
    const c = h.mc;
    return G.faults ? `<b>Second serve.</b> Press <b>${btnA(c)}</b> to toss` : `Press <b>${btnA(c)}</b> to toss, then swing near the top`;
  }
  function setupServe() {
    const sv = G.practice ? 0 : G.server;
    const deuce = G.practice ? (G.prac.serveCount % 2 === 0) : isDeuceCourt();
    const S = sv === 0 ? P : AI, R = sv === 0 ? AI : P;
    const right = S.side > 0 ? 1 : -1; // server's right in world x
    S.x = (deuce ? right : -right) * 0.85; S.z = S.side * 12.35; S.vx = S.vz = 0;
    const rRight = R.side > 0 ? 1 : -1;
    R.x = (deuce ? rRight : -rRight) * 2.7; R.z = R.side * 12.7; R.vx = R.vz = 0;
    P.cplan = AI.cplan = AI.plan = null; AI.swing = null;
    ball.decided = false; ball.serve = true; ball.deuce = deuce; ball.toss = false; ball.held = sv;
    ball.lastHitter = -1; ball.bounces = 0; ball.rolling = false; ball.netTouch = false;
    ball.v = { x: 0, y: 0, z: 0 }; ball.w = { x: 0, y: 0, z: 0 };
    fx.resetTrail();
    G.mode = 'serve'; G.slowDone = false;
    G.rally = 0; hud.rally(0);
    G.aiServeAt = G.t + 1.5;
    tossOwner = -1;
    hud.clearPrompts();
    const hs = humanOf(sv);
    if (hs) hud.prompt(sv, servePrompt(hs));
    if (versus()) hud.prompt(1 - sv, 'Get ready to return');
  }

  function predictPeak(b) {
    const s = { p: { x: b.p.x, y: b.p.y, z: b.p.z }, v: { x: b.v.x, y: b.v.y, z: b.v.z }, w: { x: 0, y: 0, z: 0 } };
    while (s.v.y > 0) TN.stepBall(s, TN.PHYS_DT);
    return s.p.y;
  }
  function toss(who) {
    const S = who === 0 ? P : AI;
    const h = humanOf(who);
    ball.held = -1; ball.toss = true; tossOwner = who;
    ball.w = { x: 0, y: 0, z: 0 }; ball.rolling = false;
    if (h) {
      // toss into the path of your racket: peak where the head is when the racket points
      // up-forward (in the plane you are aiming in)
      const q = MM.fromEuler(clamp(playerYaw(h), -0.5, 0.5), SERVE_PITCH, 0);
      const hr = headRel(q, MM.armPose(q, handOf(h)));
      const me = loc(h, { x: S.x, y: 0, z: S.z });
      const top = { x: me.x + shoulderX(h) + hr.x, y: shoulderY(0.25) + hr.y, z: me.z + hr.z };
      ball.p = loc(h, { x: top.x, y: 1.5, z: top.z });
      let vy = Math.sqrt(2 * 9.81 * Math.max(0.2, top.y - 1.5));
      for (let k = 0; k < 2; k++) { // compensate drag so the peak lands on the racket path
        const s = { p: { x: 0, y: 1.5, z: 0 }, v: { x: 0, y: vy, z: 0 }, w: { x: 0, y: 0, z: 0 } };
        while (s.v.y > 0) TN.stepBall(s, TN.PHYS_DT);
        vy *= Math.sqrt((top.y - 1.5) / Math.max(0.05, s.p.y - 1.5));
      }
      ball.v = { x: 0, y: vy, z: 0 };
      hud.prompt(who, '');
    } else {
      ball.p = { x: S.x - 0.28, y: 1.5, z: S.z - S.side * 0.32 };
      ball.v = { x: 0, y: 5.5, z: -S.side * 0.12 };
    }
    G.tossPeakY = h ? predictPeak(ball) : 0;
    G.mode = 'toss';
    SFX.toss();
    fx.resetTrail();
  }

  /** The computer's serve (a human's comes from the contact). */
  function serveHit(who) {
    const S = AI;
    const recvSide = -S.side;
    const box = TN.serviceBox(recvSide, ball.deuce);
    const aim = Math.random() < 0.5 ? rand(0.05, 0.3) : rand(0.7, 0.95); // 0..1 across the box
    let tx = lerp(box.x0 + 0.3, box.x1 - 0.3, aim);
    const D = G.opp;
    const first = G.faults === 0;
    const hs = first ? rand(D.serve[0], D.serve[1]) : rand(D.serve[0] * 0.72, D.serve[0] * 0.85);
    const p = clamp((hs - 27) / 23, 0, 1);
    const top = first ? rand(0.0, 0.35) : rand(0.5, 0.9);
    let tz = recvSide * (C.SERVICE - 0.45 - (1 - p) * 1.4), clearNet = true;
    if (Math.random() < (first ? D.fault1 : D.fault2)) {
      const r = Math.random();
      if (r < 0.45) { clearNet = false; tz = recvSide * rand(0.5, 2.5); }
      else if (r < 0.8) tz = recvSide * rand(6.8, 8.2);
      else tx = (box.x0 + box.x1) / 2 + Math.sign(tx - (box.x0 + box.x1) / 2 || 1) * rand(2.4, 3.2);
    }
    const sol = TN.solveShot(ball.p, { x: tx, z: tz }, hs, top, { clearNet, margin: 0.04 });
    ball.serve = true;
    G.mode = 'rally';
    G.rally = -1; // the serve does not count toward the rally
    launch(sol, who, { power: p, quality: 0.9, serve: true });
    hud.speed(0, Math.hypot(sol.v.x, sol.v.y, sol.v.z) * 3.6, [[G.opp.name + ' SERVES', '']]);
  }

  // ---------------------------------------------------------------------------------
  // Rules
  function onBallEvent(ev) {
    if (ev === 'bounce') {
      const sp = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
      const far = ball.p.z < -2;
      if (ball.toss) {
        SFX.bounce(sp, far);
        return;
      }
      if (ball.decided) { if (sp > 1.5) SFX.bounce(sp, far); return; }
      SFX.bounce(sp, far);
      judgeBounce();
    } else if (ev === 'net' || ev === 'tape') {
      SFX.net();
      if (!ball.decided) {
        ball.netTouch = true;
        if (ev === 'tape') AU.Crowd.react('ooh');
      }
      // trajectory changed: replan
      if (ball.lastHitter === 0 && !AI.human) { AI.plan = planFor(AI); if (AI.plan && !AI.plan.out) AI.stroke = AI.plan.x <= AI.x + 0.15 ? 'fh' : 'bh'; }
      humans.forEach(h => { if (ball.lastHitter !== h.idx) h.A.cplan = null; }); // replans next frame
    }
  }

  function judgeBounce() {
    const x = ball.p.x, z = ball.p.z;
    const side = z > 0 ? 1 : -1;
    const hitter = ball.lastHitter;
    if (hitter < 0) return;
    const hitterSide = hitter === 0 ? 1 : -1;
    ball.bounces++;
    if (ball.bounces === 1) {
      if (ball.serve) {
        const box = TN.serviceBox(-hitterSide, ball.deuce);
        const good = side === -hitterSide && TN.inBox(x, z, box);
        fx.bounce(x, z, 0, !good);
        if (!good) return fault(side === hitterSide ? 'NET' : 'OUT');
        if (ball.netTouch) return letServe();
        return;
      }
      if (side === hitterSide) { fx.bounce(x, z, 0, true); return pointTo(hitter === 0 ? 1 : 0, 'NET', hitter); }
      if (!TN.inCourt(x, z, side)) { fx.bounce(x, z, 0, true); return pointTo(hitter === 0 ? 1 : 0, 'OUT', hitter); }
      fx.bounce(x, z, 0, false);
      if (G.practice && hitter === 0) practiceIn(x, z);
    } else if (ball.bounces === 2) {
      pointTo(hitter === 2 ? 1 : hitter, ball.serve ? 'ACE' : 'WINNER', hitter);
    }
  }

  function fault(kind) {
    ball.decided = true;
    P.cplan = AI.cplan = AI.plan = null;
    const sv = G.practice ? 0 : G.server;
    if (G.practice) {
      hud.banner(kind === 'NET' ? 'NET' : 'FAULT', 'serve practice', 'bad', 1.2);
      G.prac.streak = 0; hud.practice();
      G.mode = 'between'; G.timer = 1.4; G.after = 'feed';
      return;
    }
    G.faults++;
    if (G.faults >= 2) {
      G.stats.df[sv]++;
      ball.decided = false; // pointTo() ignores decided balls
      return pointTo(1 - sv, 'DOUBLE FAULT', sv);
    }
    say('Fault');
    hud.banner('FAULT', kind === 'NET' ? 'into the net · second serve' : 'out of the box · second serve', 'bad', 1.3);
    G.mode = 'between'; G.timer = 1.6; G.after = 'serve';
  }

  function letServe() {
    ball.decided = true;
    P.cplan = AI.cplan = AI.plan = null;
    say('Let');
    hud.banner('LET', 'replay the serve', 'neutral', 1.2);
    G.mode = 'between'; G.timer = 1.5; G.after = G.practice ? 'feed' : 'serve';
  }

  function pointTo(winner, reason, hitter) {
    if (ball.decided) return;
    ball.decided = true;
    P.cplan = AI.cplan = AI.plan = null;
    hud.clearPrompts();
    if (G.practice) return practiceEnd(winner, reason, hitter);
    const rally = Math.max(0, G.rally);
    const st = G.stats;
    st.won[winner]++;
    st.longest = Math.max(st.longest, rally);
    if (reason === 'ACE') st.aces[winner]++;
    if (reason === 'WINNER') st.winners[winner]++;
    if (reason === 'OUT' || reason === 'NET') st.errors[1 - winner]++;
    // banner
    const wn = nameOf(winner), ln = nameOf(1 - winner);
    let main = reason, sub, kind;
    if (versus()) {
      kind = winner === 0 ? 'good' : 'p2';
      if (reason === 'WINNER') { main = 'WINNER!'; sub = wn + ' hits a clean winner'; }
      else if (reason === 'ACE') { main = 'ACE!'; sub = wn + ' untouchable'; }
      else if (reason === 'OUT') { sub = ln + ' misses · point ' + wn; say('Out'); }
      else if (reason === 'NET') { sub = ln + ' finds the net · point ' + wn; }
      else if (reason === 'DOUBLE FAULT') { sub = 'point ' + wn; say('Double fault'); }
    } else {
      const youWon = winner === 0, name = G.opp.name;
      kind = youWon ? 'good' : 'bad';
      const quip = !youWon && Math.random() < 0.5 ? G.opp.quips[(Math.random() * G.opp.quips.length) | 0] : null;
      if (reason === 'WINNER') { main = youWon ? 'WINNER!' : 'PASSED'; sub = youWon ? (rally >= 8 ? rally + '-shot rally, clean winner' : 'clean winner') : quip || name + ' hits a winner'; }
      else if (reason === 'ACE') { main = youWon ? 'ACE!' : 'ACE'; sub = youWon ? 'untouchable' : quip || name + ' serves an ace'; }
      else if (reason === 'OUT') { main = 'OUT'; sub = youWon ? name + ' misses long' : 'your shot was out'; say('Out'); }
      else if (reason === 'NET') { main = 'NET'; sub = youWon ? name + ' finds the net' : 'into the net'; }
      else if (reason === 'DOUBLE FAULT') { sub = youWon ? 'gift from ' + name : 'point to ' + name; say('Double fault'); }
    }
    // crowd: they love a long rally and a clean winner, whoever hits it
    const cheered = versus() || winner === 0;
    if (cheered) {
      const inten = clamp(0.35 + rally * 0.05 + (reason === 'WINNER' || reason === 'ACE' ? 0.3 : 0), 0, 1);
      AU.Crowd.react('cheer', inten);
      world.crowd.excite = 0.6 + inten * 1.4;
    } else {
      if (reason === 'OUT' || reason === 'NET' || reason === 'DOUBLE FAULT') AU.Crowd.react('groan');
      else AU.Crowd.react('polite', 0.8);
      world.crowd.excite = 0.25;
    }
    // score
    const s = G.score;
    s.pts[winner]++;
    G.faults = 0;
    const l = 1 - winner;
    let gameWon = false, matchWon = false;
    if (s.pts[winner] >= 4 && s.pts[winner] - s.pts[l] >= 2) {
      gameWon = true;
      s.games[winner]++;
      s.pts = [0, 0];
      if (s.games[winner] >= G.gamesToWin) matchWon = true;
      else G.server = 1 - G.server;
    }
    hud.banner(main, sub, kind, 1.6);
    hud.score();
    G.mode = 'point'; G.timer = 2.4;
    G.after = matchWon ? 'match' : 'serve';
    const delayCall = 1100;
    const good = versus() || winner === 0;
    if (matchWon) {
      setTimeout(() => {
        say('Game, set and match, ' + callName(winner));
        const title = G.kind === 'circuit' ? CIRCUIT[G.round].round.toLowerCase() : 'the match';
        hud.banner(versus() ? wn + ' WINS' : winner === 0 ? 'GAME, SET, MATCH' : 'MATCH OVER',
          versus() ? 'game, set and match' : winner === 0 ? 'you take ' + title : G.opp.name + ' takes ' + title, versus() ? kind : winner === 0 ? 'good' : 'bad', 2.2);
        if (good) { SFX.fanfare(true); AU.Crowd.react('cheer', 1); world.crowd.excite = 3; } else SFX.sad();
      }, delayCall);
      G.timer = 4.2;
    } else if (gameWon) {
      setTimeout(() => {
        say('Game, ' + callName(winner));
        const gp = s.games[winner] + 1 >= G.gamesToWin;
        hud.banner('GAME', wn + '  ' + s.games[0] + ' – ' + s.games[1] + (gp ? ' · one game from the match' : '') + ' · ' + nameOf(G.server) + ' to serve', versus() ? kind : winner === 0 ? 'good' : 'bad', 2.0);
        if (good) { SFX.fanfare(false); world.crowd.excite = 2; }
      }, delayCall);
      G.timer = 3.6;
    } else {
      setTimeout(() => say(callText()), delayCall);
    }
  }

  // ---------------------------------------------------------------------------------
  // Practice
  function practiceIn(x, z) {
    const p = G.prac;
    p.ins++; p.streak++; p.best = Math.max(p.best, p.streak);
    let hitTarget = false;
    targets.forEach(t => { if (Math.hypot(x - t.position.x, z - t.position.z) < 1.15) hitTarget = true; });
    if (hitTarget) { p.targets++; SFX.chime(); hud.banner('TARGET!', 'streak ' + p.streak, 'good', 1.0); world.crowd.excite = 1.2; AU.Crowd.react('polite', 0.6); }
    else if (p.streak > 0 && p.streak % 5 === 0) { hud.banner(p.streak + ' IN A ROW', '', 'good', 1.0); AU.Crowd.react('cheer', 0.4); world.crowd.excite = 1; }
    hud.practice();
  }
  function practiceEnd(winner, reason, hitter) {
    const p = G.prac;
    if (hitter === 0 && (reason === 'OUT' || reason === 'NET')) { p.streak = 0; hud.banner(reason, 'streak reset', 'bad', 0.9); AU.Crowd.react('groan'); }
    else if (hitter === 2 || (hitter === 1 && ball.bounces >= 2)) { p.streak = 0; hud.banner('MISSED', 'meet the ball with your racket', 'bad', 0.9); }
    else if (reason === 'ACE') hud.banner('ACE!', 'serve practice', 'good', 1.0);
    hud.practice();
    G.mode = 'between'; G.timer = 1.3; G.after = 'feed';
  }
  function feed() {
    const D = G.opp;
    G.prac.side = -G.prac.side;
    ball.decided = false; ball.serve = false; ball.toss = false; ball.held = -1; ball.rolling = false;
    ball.p = { x: 0, y: 0.9, z: -12.1 };
    ball.netTouch = false;
    const tx = G.prac.side * rand(1.0, 3.2), tz = rand(7.6, 10.4);
    const sol = TN.solveShot(ball.p, { x: tx, z: tz }, rand(D.pace[0] * 0.85, D.pace[1] * 0.9), rand(0.2, 0.6), { clearNet: true, margin: 0.3 });
    G.mode = 'rally'; G.slowDone = false;
    G.rally = 0;
    fx.resetTrail();
    SFX.hit(0.3, 0.5, true);
    launch(sol, 2, { power: 0.3, quality: 0.5 });
    hud.prompt(0, '');
  }

  // ---------------------------------------------------------------------------------
  // Game start / flow
  function showScreen(name) {
    G.screen = name;
    ['title', 'intro', 'lobby', 'end', 'pause'].forEach(n => $(n).classList.toggle('hidden', n !== name));
  }
  /** kind: 'match' (quick match) | 'practice' | 'circuit' | 'versus' */
  function startGame(kind) {
    if (kind === true) kind = 'practice'; else if (kind === false || !kind) kind = 'match';
    G.kind = kind;
    G.practice = kind === 'practice';
    G.inGame = true; G.paused = false;
    if (kind === 'circuit') { G.round = circuit.round; G.opp = ROSTER[CIRCUIT[G.round].opp]; G.gamesToWin = CIRCUIT[G.round].games; }
    else { G.round = -1; G.opp = ROSTER[settings.opp]; G.gamesToWin = GAMES[settings.games]; }
    if (kind === 'versus') { G.gamesToWin = GAMES[settings.games]; humans = [H[0], H[1]]; AI.human = H[1]; paintAI(P2_LOOK); }
    else { humans = [H[0]]; H[0].mc = mc; AI.human = null; paintAI(G.opp.colors); }
    AI.model.setVisible(!(kind === 'practice'));
    humans.forEach(h => { h.hits = 0; h.A.cplan = null; h.RK.rel = null; h.RK.head = null; h.camState.init = false; });
    G.score = { pts: [0, 0], games: [0, 0] };
    G.server = 0; G.faults = 0; G.slow = 0;
    G.stats = newStats();
    G.prac = { streak: 0, best: 0, hits: 0, ins: 0, targets: 0, side: 1, serveCount: 0 };
    G.inputGuard = 0.5;
    showScreen('game');
    $('hud').classList.remove('hidden');
    $('hud').classList.toggle('split', versus());
    $('scoreboard').classList.toggle('hidden', G.practice);
    $('practice-board').classList.toggle('hidden', !G.practice);
    machine.visible = G.practice;
    AI.model.setVisible(!G.practice);
    targets.forEach(t => { t.visible = G.practice; });
    hud.score(); hud.practice(); hud.clearPrompts();
    P.x = 0; P.z = 12.4; AI.x = 0; AI.z = -12.4;
    refreshPlayerTags();
    if (G.practice) {
      P.x = 0; P.z = 12.5;
      G.mode = 'between'; G.timer = 1.2; G.after = 'feed';
      hud.banner('PRACTICE', 'swing at the fed balls · ' + btnA(mc) + ' for serve practice', 'neutral', 2.2);
      ball.decided = true; ball.held = -1; ball.p = { x: 0, y: -5, z: -12 };
    } else {
      setupServe();
      const sub = versus() ? 'P1 serves first' : 'you serve first';
      hud.banner(kind === 'circuit' ? CIRCUIT[G.round].round : 'FIRST TO ' + G.gamesToWin, (kind === 'circuit' ? 'first to ' + G.gamesToWin + ' · ' : '') + sub, 'neutral', 2.0);
      if (!versus()) setTimeout(() => say(G.opp.name.toLowerCase() + ' to receive. Play.'), 600);
      else setTimeout(() => say('Player one to serve. Play.'), 600);
    }
  }

  function ladderHTML(cur, doneUpTo) {
    return CIRCUIT.map((r, i) => {
      const o = ROSTER[r.opp];
      const st = i < doneUpTo ? 'done' : i === cur ? 'cur' : 'locked';
      const col = '#' + o.colors.shirt.toString(16).padStart(6, '0');
      return `<div class="lad ${st}"><i style="--c:${col}"></i><span>${r.round}</span><b>${o.name}</b></div>`;
    }).join('<div class="lad-line"></div>');
  }

  function showIntro() {
    const r = CIRCUIT[circuit.round], o = ROSTER[r.opp];
    $('intro-ladder').innerHTML = ladderHTML(circuit.round, circuit.round);
    $('intro-kicker').textContent = 'CIRCUIT · ' + r.round + ' · FIRST TO ' + r.games + ' GAMES';
    $('intro-name').textContent = o.name;
    $('intro-title').textContent = o.title + ' · ' + o.tier;
    $('intro-blurb').textContent = o.blurb;
    $('intro-tip').innerHTML = '<b>TIP</b> ' + o.tip;
    $('intro-card').style.setProperty('--opp', '#' + o.colors.shirt.toString(16).padStart(6, '0'));
    paintAI(o.colors);
    G.inGame = false; G.paused = false; G.mode = 'title';
    $('hud').classList.add('hidden');
    showScreen('intro');
    menuFocus.intro = 0; refreshFocus();
  }

  function setEndMenu(buttons) {
    $('end-menu').innerHTML = buttons.map((b, i) => `<button class="mi${i === 0 ? ' primary' : ''}" data-act="${b[0]}">${b[1]}</button>`).join('');
    bindMenu($('end-menu'));
  }
  function showEnd() {
    G.inGame = true; G.mode = 'ended';
    const s = G.score, st = G.stats;
    const won = s.games[0] > s.games[1];
    let kicker, title, cls = won ? 'win' : 'lose', ladder = '';
    if (versus()) {
      kicker = 'TWO PLAYERS · FIRST TO ' + G.gamesToWin;
      title = (won ? 'P1' : 'P2') + ' WINS'; cls = won ? 'win' : 'win p2';
      setEndMenu([['rematch', 'REMATCH'], ['lobby', 'CHANGE PLAYERS'], ['quit', 'MAIN MENU']]);
    } else if (G.kind === 'circuit') {
      const r = G.round, last = r === CIRCUIT.length - 1;
      if (won) {
        if (last) {
          circuit.trophies++; circuit.round = 0; circuit.best = CIRCUIT.length;
          kicker = NAME + ' CIRCUIT · TROPHY ' + circuit.trophies; title = 'CHAMPION';
          ladder = ladderHTML(-1, CIRCUIT.length);
          setEndMenu([['quit', 'MAIN MENU'], ['circuit', 'DEFEND THE TITLE']]);
        } else {
          circuit.round = r + 1; circuit.best = Math.max(circuit.best, r + 1);
          kicker = CIRCUIT[r].round + ' WON'; title = 'THROUGH';
          ladder = ladderHTML(r + 1, r + 1);
          setEndMenu([['circuit', 'PLAY ' + CIRCUIT[r + 1].round], ['quit', 'MAIN MENU']]);
        }
      } else {
        kicker = CIRCUIT[r].round + ' · SO CLOSE'; title = G.opp.name + ' WINS';
        ladder = ladderHTML(r, r);
        setEndMenu([['circuit', 'TRY AGAIN'], ['quit', 'MAIN MENU']]);
      }
      saveCircuit();
    } else {
      kicker = won ? 'QUICK MATCH · vs ' + G.opp.name + ' ' + G.opp.title : 'SO CLOSE. GO AGAIN?';
      title = won ? 'MATCH WON' : G.opp.name + ' WINS';
      setEndMenu([['rematch', 'REMATCH'], ['quit', 'MAIN MENU']]);
    }
    $('end-kicker').textContent = kicker;
    $('end-title').textContent = title;
    $('end-title').className = cls;
    $('end-ladder').innerHTML = ladder;
    $('end-ladder').classList.toggle('hidden', !ladder);
    $('end-score').textContent = s.games[0] + ' – ' + s.games[1];
    const rows = [
      ['POINTS WON', st.won[0], st.won[1]],
      ['WINNERS', st.winners[0], st.winners[1]],
      ['ACES', st.aces[0], st.aces[1]],
      ['ERRORS', st.errors[0], st.errors[1]],
      ['DOUBLE FAULTS', st.df[0], st.df[1]],
      ['FASTEST BALL', Math.round(st.top[0]) + ' km/h', Math.round(st.top[1]) + ' km/h'],
    ];
    $('end-stats').innerHTML = '<span class="h"></span><span class="h v">' + nameOf(0) + '</span><span class="h v">' + nameOf(1) + '</span>' +
      rows.map(r => `<span>${r[0]}</span><span class="v you">${r[1]}</span><span class="v cpu">${r[2]}</span>`).join('') +
      `<span>LONGEST RALLY</span><span class="v" style="grid-column: span 2">${st.longest} shots</span>`;
    showScreen('end');
    $('hud').classList.add('hidden');
    menuFocus.end = 0; refreshFocus();
  }

  function toTitle() {
    G.inGame = false; G.paused = false; G.mode = 'title'; G.panel = 'main'; G.slow = 0;
    showScreen('title');
    $('hud').classList.add('hidden');
    $('hud').classList.remove('split');
    machine.visible = false; targets.forEach(t => { t.visible = false; });
    AI.model.setVisible(true);
    humans = [H[0]]; H[0].mc = mc; AI.human = null;
    G.opp = ROSTER[circuit.round !== undefined ? CIRCUIT[circuit.round].opp : settings.opp];
    paintAI(G.opp.colors);
    ball.decided = true; ball.held = -1; ball.p = { x: 0, y: -5, z: 0 };
    hud.clearPrompts();
    refreshTitle();
    menuFocus.title = 0; refreshFocus();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function setPaused(v, why) {
    if (!G.inGame || G.mode === 'ended') return;
    G.paused = v;
    $('pause').classList.toggle('hidden', !v);
    G.screen = v ? 'pause' : 'game';
    if (v) {
      const lines = humans.map(h => `<b>${versus() ? nameOf(h.idx) + ':' : 'Phone drifted?'}</b> point at the screen and ${alignHow(h.mc)}.`);
      $('pause-hint').innerHTML = (why ? `<span class="warn">${why}</span><br>` : '') + lines.join('<br>');
      menuFocus.pause = 0; refreshFocus(); SFX.ui('back');
    } else G.inputGuard = 0.3;
  }

  // ---------------------------------------------------------------------------------
  // Per-frame logic
  function updateLogic(dt) {
    G.inputGuard -= dt;
    const D = G.opp;
    if (G.mode === 'between' || G.mode === 'point') {
      G.timer -= dt;
      if (G.timer <= 0) {
        if (G.after === 'match') { showEnd(); return; }
        if (G.after === 'feed') { G.mode = 'feedWait'; G.timer = 0.6; return; }
        setupServe();
      }
    }
    if (G.mode === 'feedWait') {
      G.timer -= dt;
      hud.prompt(0, 'Ball machine · press <b>' + btnA(mc) + '</b> for serve practice');
      if (mc.pressed('a') && G.inputGuard <= 0) { G.prac.serveCount++; setupServe(); return; }
      if (G.timer <= 0) feed();
    }
    if (G.mode === 'serve') {
      const sv = G.practice ? 0 : G.server;
      const hs = humanOf(sv);
      if (hs) { if (hs.mc.pressed('a') && G.inputGuard <= 0) toss(sv); }
      else if (G.t >= G.aiServeAt) { toss(1); AI.swing = { t0: G.t + 0.22, dur: 0.5, kind: 'serve' }; }
    }
    if (G.mode === 'toss') {
      if (tossOwner === 1 && !AI.human && ball.v.y < 0.2 && ball.p.y > 2) {
        serveHit(1);
      } else if (ball.p.y < 1.1 && ball.v.y < 0) {
        // dropped toss: retake
        const who = tossOwner;
        ball.toss = false;
        setupServe();
        const h = humanOf(who);
        if (h) hud.prompt(who, `Swing near the <b>top</b> of the toss. Press <b>${btnA(h.mc)}</b> to toss`);
      }
    }
    // safety: dead rally
    if (G.mode === 'rally' && !ball.decided && G.t - ball.hitT > 7) {
      ball.decided = true; G.mode = 'between'; G.timer = 0.5; G.after = G.practice ? 'feed' : 'serve';
    }
    // a winner getting past: let it happen in slow motion
    if (G.mode === 'rally' && !ball.decided && !G.slowDone && ball.bounces === 1 && ball.lastHitter >= 0 && ball.lastHitter < 2) {
      const R = ball.lastHitter === 0 ? AI : P, s = R.side;
      // only once nobody can reach it any more: the computer has tried, a human's hit window
      // has closed (never slow the game while someone can still swing at it)
      const rh = humanOf(R.i);
      const W = TN.MAGNET_WINDOW[ZONE[settings.zone]];
      const beaten = rh ? (!R.cplan || G.t > R.cplan.t + W + 0.05) : AI.hitDone || (AI.plan && AI.plan.out === false && G.t > AI.plan.t);
      if (beaten && ball.p.z * s > R.z * s + 0.3 && ball.v.z * s > 0 && ball.p.y < 1.6) {
        G.slowDone = true; G.slow = 0.85; G.punch = Math.max(G.punch, 0.8);
        AU.Crowd.react('ooh');
      }
    }

    // ---- movement ------------------------------------------------------------
    humans.forEach(h => {
      const A = h.A;
      if (G.mode === 'rally' && !ball.decided && ball.lastHitter !== h.idx && ball.lastHitter !== -1) {
        // keep re-planning (racket height, stroke side) until just before the ball arrives
        if (!A.cplan || A.cplan.t - G.t > 0.3) A.cplan = contactPlan(h, A.cplan) || A.cplan;
        if (A.cplan) A.stroke = A.cplan.stroke;
        // first rallies of a session: say what to do
        if (h.hits < 2 && A.cplan && A.cplan.t - G.t < 1.1 && A.cplan.t - G.t > 0) hud.prompt(h.idx, '<b>Swing</b> as the ball reaches you');
      } else A.cplan = null;
      moveActor(A, loc(h, playerTarget(h)), 8.0, dt);
    });
    if (!AI.human) {
      const at = aiTarget();
      moveActor(AI, at, G.t >= AI.reactAt ? D.speed : 0.6, dt);
      // AI swing anticipation
      if (AI.plan && !AI.plan.out && !AI.hitDone && !AI.swing && G.mode === 'rally' && AI.plan.t - G.t < 0.3) {
        AI.swing = { t0: G.t, dur: 0.55, kind: AI.stroke };
      }
      if (AI.swing && G.t > AI.swing.t0 + AI.swing.dur + 0.3) AI.swing = null;
    }
  }

  /** Where a human runs to, in their own frame. */
  function playerTarget(h) {
    const A = h.A, me = loc(h, { x: A.x, y: 0, z: A.z });
    if (G.mode === 'serve' || G.mode === 'toss') return { x: me.x, y: 0, z: me.z };
    if (G.mode === 'rally' && A.cplan && !ball.decided && ball.lastHitter !== h.idx) {
      return { x: A.cplan.x - A.cplan.off.x, y: 0, z: Math.max(A.cplan.z - A.cplan.off.z, 1.0) };
    }
    const lb = loc(h, ball.p);
    return { x: clamp(lb.x * 0.25, -2, 2), y: 0, z: G.mode === 'rally' ? 12.4 : me.z };
  }
  function aiTarget() {
    if (G.practice) return { x: 0, z: -14 };
    if (G.mode === 'serve' || G.mode === 'toss') return { x: AI.x, z: AI.z };
    if (G.mode === 'rally' && AI.plan && !ball.decided && ball.lastHitter === 0) {
      if (AI.plan.out) return { x: AI.x + (ball.p.x - AI.x) * 0.3, z: -12.6 };
      const off = AI.stroke === 'fh' ? -0.72 : 0.72;
      return { x: AI.plan.x - off, z: Math.min(AI.plan.z - 0.3, -1.5) };
    }
    if (G.mode === 'rally' && ball.lastHitter === 1) return { x: clamp(ball.p.x * 0.3, -2, 2), z: -12.5 };
    return { x: AI.x, z: AI.z };
  }

  function moveActor(A, tgt, maxSp, dt) {
    const dx = tgt.x - A.x, dz = tgt.z - A.z;
    const d = Math.hypot(dx, dz);
    let dvx = 0, dvz = 0;
    if (d > 0.02) { const sp = Math.min(maxSp, d * 5); dvx = (dx / d) * sp; dvz = (dz / d) * sp; }
    const acc = 30 * dt;
    A.vx += clamp(dvx - A.vx, -acc, acc);
    A.vz += clamp(dvz - A.vz, -acc, acc);
    A.x += A.vx * dt; A.z += A.vz * dt;
    A.x = clamp(A.x, -9.5, 9.5);
    const sp = Math.hypot(A.vx, A.vz);
    A.run = lerp(A.run, clamp(sp / 6, 0, 1), 1 - Math.exp(-dt * 10));
    A.phase += dt * (4 + sp * 2.2);
  }

  // ---------------------------------------------------------------------------------
  // Physics step (fixed)
  function physicsStep(dt) {
    if (ball.held >= 0) {
      const S = ball.held === 0 ? P : AI;
      ball.p = { x: S.x - 0.32 * (S.side > 0 ? 1 : -1), y: 1.02 + Math.sin(G.t * 3) * 0.04, z: S.z - S.side * 0.25 };
      return;
    }
    const ev = TN.stepBall(ball, dt);
    if (ev) onBallEvent(ev);
    // (human contact is physical: checkContact() after the step, per frame)
    // AI contact
    if (!AI.human && AI.plan && !AI.plan.out && !AI.hitDone && G.t >= AI.plan.t && G.mode === 'rally' && !ball.decided && !G.practice) {
      AI.hitDone = true;
      const off = AI.stroke === 'fh' ? -0.72 : 0.72;
      const reach = Math.hypot(ball.p.x - (AI.x + off), ball.p.z - AI.z);
      if (reach < G.opp.reach + 0.35 && ball.bounces <= 1) aiHit();
    }
  }

  // ---------------------------------------------------------------------------------
  // Visual update: athletes, rackets, camera, HUD bits
  const eTmp = new THREE.Euler();
  const qBody = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const aiQ = new THREE.Quaternion();
  function aiRacketQuat() {
    let yaw = 0.35, pitch = 0.5, roll = -Math.PI / 2;
    const sw = AI.swing;
    if (sw && G.t >= sw.t0) {
      const k = clamp((G.t - sw.t0) / sw.dur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      if (sw.kind === 'serve') { pitch = lerp(2.6, -0.9, e); yaw = lerp(0.3, -0.3, e); }
      else if (sw.kind === 'fh') { yaw = lerp(-2.0, 1.6, e); pitch = lerp(-0.25, 0.8, e); }
      else { yaw = lerp(2.0, -1.4, e); pitch = lerp(-0.25, 0.7, e); roll = Math.PI / 2; }
    } else if (AI.plan && !AI.plan.out && G.mode === 'rally') {
      // backswing preparation
      yaw = AI.stroke === 'fh' ? -1.4 : 1.4; pitch = 0.1;
      if (AI.stroke === 'bh') roll = Math.PI / 2;
    }
    qBody.setFromAxisAngle(Y, AI.facing);
    eTmp.set(pitch, yaw, roll, 'YXZ');
    aiQ.setFromEuler(eTmp);
    return aiQ.premultiply(qBody);
  }

  const _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
  let titleT = 0;
  let dbgCam = null;   // testing: a fixed camera {p, l}
  function followCam(h, dt) {
    const cs = h.camState, split = versus();
    const me = loc(h, { x: h.A.x, y: 0, z: h.A.z }), lb = loc(h, ball.p);
    const bx = (G.mode === 'rally' && ball.held < 0) ? lb.x : me.x;
    // a narrower half screen needs to stand a little further back to see both sidelines
    const p = split ? { x: me.x * 0.5 + bx * 0.1, y: 6.4, z: me.z + 10.2 } : { x: me.x * 0.6 + bx * 0.1, y: 5.3, z: me.z + 8.3 };
    // solo: tilted a touch down so the player's feet sit clear of the bottom edge and the HUD;
    // deep behind the baseline the camera stops short of the stands (rows were poking into view)
    // and rises instead
    const l = split ? { x: me.x * 0.25 + bx * 0.15, y: -0.6, z: me.z - 17 } : { x: me.x * 0.3 + bx * 0.15, y: -0.95, z: me.z - 17 };
    if (!split && p.z > 22.5) { p.y += (p.z - 22.5) * 0.5; p.z = 22.5; }
    v3(_cp, loc(h, p)); v3(_cl, loc(h, l));
    if (!cs.init) { cs.pos.copy(_cp); cs.look.copy(_cl); cs.init = true; }
    cs.pos.lerp(_cp, 1 - Math.exp(-dt * 4));
    cs.look.lerp(_cl, 1 - Math.exp(-dt * 4));
    const cam = h.cam;
    cam.position.copy(cs.pos);
    if (G.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * G.shake;
      cam.position.y += (Math.random() - 0.5) * G.shake;
    }
    cam.fov = (split ? 54 : 43) - G.punch * 3.5;
    cam.lookAt(cs.look);
  }
  function updateCamera(dt) {
    const cs = H[0].camState;
    if (!G.inGame || G.mode === 'ended') {
      titleT += dt;
      const a = titleT * 0.06 + 0.6;
      // a slow orbit inside the boards (the stands start just behind them)
      _cp.set(Math.sin(a) * 9.5, 6.5 + Math.sin(titleT * 0.13) * 1.5, Math.cos(a) * 17);
      _cl.set(0, 1, 0);
      cs.pos.lerp(_cp, cs.init ? 1 - Math.exp(-dt * 2) : 1);
      cs.look.lerp(_cl, cs.init ? 1 - Math.exp(-dt * 2) : 1);
      cs.init = true;
      camera.position.copy(cs.pos);
      camera.fov = 50;
      camera.lookAt(cs.look);
      H[1].camState.init = false;
    } else humans.forEach(h => followCam(h, dt));
    if (dbgCam) { camera.position.copy(dbgCam.p); camera.fov = 40; camera.lookAt(dbgCam.l); }
    G.shake = Math.max(0, G.shake - dt * 0.9);
    G.punch = Math.max(0, G.punch - dt * 3);
  }

  function pose(model, st, dt) { if (model.rig) TN.poseRig(model, st, dt); else TN.poseAthlete(model, st); }
  function updateActors(dt) {
    // humans: the racket arm is the controller's arm model, hung off the athlete's shoulder
    humans.forEach(h => {
      const A = h.A, me = loc(h, { x: A.x, y: 0, z: A.z }), lb = loc(h, ball.p);
      A.facing = clamp((lb.x - me.x) * -0.04, -0.2, 0.2) + (h.s > 0 ? 0 : Math.PI);
      const ptw = clamp(-playerYaw(h) * 0.2, -0.45, 0.45);
      pose(A.model, { x: A.x, z: A.z, facing: A.facing, run: A.run, phase: A.phase, lean: 0.12, twist: ptw, crouch: playerCrouch(), racketQuat: h.RK.wq, arm: { elbow: h.RK.welbow, hand: h.RK.whand }, hand: handOf(h) }, dt);
    });
    if (AI.human) return;
    AI.facing = Math.PI + clamp((ball.p.x - AI.x) * 0.04, -0.35, 0.35);
    let atw = 0;
    if (AI.swing && G.t >= AI.swing.t0) {
      const k = clamp((G.t - AI.swing.t0) / AI.swing.dur, 0, 1);
      atw = AI.swing.kind === 'fh' ? lerp(-0.7, 0.8, k) : AI.swing.kind === 'bh' ? lerp(0.7, -0.6, k) : 0;
    }
    pose(AI.model, { x: AI.x, z: AI.z, facing: AI.facing, run: AI.run, phase: AI.phase, lean: 0.12, twist: atw, crouch: G.mode === 'rally' ? 0.5 : 0.25, racketQuat: aiRacketQuat() }, dt);
  }

  // controller status
  let ctrlKey = null;
  function updateCtrlStatus() {
    const phone = mc.connected, mode = ctrlMode(mc);
    const key = phone + mode;
    if (key === ctrlKey) return;
    ctrlKey = key;
    const label = phone ? (mode === 'grip' ? 'Phone connected · Grip' : 'Phone connected · Wand') : 'Using mouse';
    [$('ctrl-pill'), $('title-ctrl')].forEach(el => {
      el.classList.toggle('phone', phone);
      el.querySelector('span').textContent = label;
    });
    $('ctrl-pill').querySelector('small').textContent = phone ? btnB(mc) + ' pause' : 'Esc pause';
    $('title-ctrl').querySelector('small').innerHTML = phone
      ? `Point at the screen and ${alignHow(mc)} to align. Point + <b>${btnA(mc)}</b> picks.`
      : "Open Mimic on your phone, pick <b>Wand</b> or <b>Grip</b>.";
    refreshTitle();
  }
  function refreshPlayerTags() {
    [0, 1].forEach(i => {
      const h = H[i], t = $('ptag' + i);
      t.querySelector('b').textContent = 'P' + (i + 1);
      t.querySelector('span').textContent = h.kind === 'keys' ? 'MOUSE' : ctrlMode(h.mc).toUpperCase();
    });
  }

  // phone vibration (WebHID): asked for on the first click / key on the title screen
  let rumbleAsked = false;
  function setRumbleStatus(on) {
    const el = $('rumble-status');
    el.textContent = on ? 'Vibration on' : 'Vibration off: allow Mimic when Chrome asks';
    el.classList.toggle('on', !!on);
  }
  function askRumble() {
    if (rumbleAsked || G.inGame) return;
    rumbleAsked = true;
    if (mc.rumbleReady) { setRumbleStatus(true); return; }
    Promise.resolve().then(() => mc.enableRumble()).then(ok => setRumbleStatus(ok), () => setRumbleStatus(false));
  }
  addEventListener('pointerdown', askRumble, true);
  addEventListener('keydown', askRumble, true);

  function updateMeter() {
    // racket-head speed (m/s); the tick marks a solid groundstroke
    $('hud').querySelector('.m-fill').style.width = clamp(H[0].RK.speed / 35, 0, 1) * 100 + '%';
    $('hud').querySelector('.m-tick').style.left = (15 / 35) * 100 + '%';
  }

  // ---------------------------------------------------------------------------------
  // Two-player lobby
  const lobby = { st: TN.Lobby.createLobby(2), keyJoin: false, keyLeave: false, keyHold: false, guard: 0 };
  function lobbyInputs() {
    const list = [];
    const n = hasLibSlots ? Math.max(2, Math.min(4, MimicController.all().length)) : 4;
    for (let i = 0; i < n; i++) {
      const c = slotCtrl(i);
      if (i > 0) c.update();                       // slot 0 is updated by the main loop
      if (isPhone(c)) list.push({ id: 'phone' + i, kind: 'phone', ctrl: c, a: c.pressed('a'), b: c.pressed('b'), aDown: c.isDown('a') });
    }
    // keyboard + mouse can take one slot (testing / no second phone)
    if (!keyCtrl) keyCtrl = new KeyPad();
    keyCtrl.update();
    list.push({ id: 'keys', kind: 'keys', ctrl: keyCtrl, a: lobby.keyJoin, b: lobby.keyLeave, aDown: lobby.keyHold });
    lobby.keyJoin = lobby.keyLeave = false;
    return list;
  }
  function openLobby() {
    lobby.st = TN.Lobby.createLobby(2);
    lobby.guard = 0.35;      // the A press that opened the lobby is not a join
    showScreen('lobby');
    G.mode = 'title';
    renderLobby([]);
  }
  function renderLobby(inputs) {
    const slots = lobby.st.slots;
    for (let i = 0; i < 2; i++) {
      const el = $('slot' + i), s = slots[i];
      el.classList.toggle('joined', !!s);
      const inp = s && inputs.find(p => p.id === s.id);
      if (s) {
        const c = inp && inp.ctrl;
        const mode = s.kind === 'keys' ? 'MOUSE + KEYS' : ctrlMode(c).toUpperCase();
        el.querySelector('.s-state').textContent = 'READY · ' + mode;
        el.querySelector('.s-help').innerHTML = s.kind === 'keys' ? 'Sweep the mouse to swing · <kbd>Backspace</kbd> leaves'
          : `Point and ${alignHow(c)} to align · swing to test · <b>${btnB(c)}</b> leaves`;
        const sp = c ? clamp(c.angularSpeed / 14, 0, 1) : 0;
        el.querySelector('.s-bar i').style.width = (sp * 100).toFixed(0) + '%';
      } else {
        el.querySelector('.s-state').textContent = 'PRESS A TO JOIN';
        el.querySelector('.s-help').innerHTML = 'Wand: <b>A</b> · Grip: <b>Vol Down</b> · keyboard: <kbd>Space</kbd>';
        el.querySelector('.s-bar i').style.width = '0%';
      }
    }
    const full = slots.every(Boolean);
    const phones = inputs.filter(p => p.kind === 'phone').length;
    $('lobby-status').innerHTML = full
      ? `Everyone in. <b>Hold ${'A'}</b> (Grip: Vol Down) to start` + `<span class="hold"><i style="width:${(lobby.st.hold / TN.Lobby.HOLD_TO_START * 100).toFixed(0)}%"></i></span>`
      : phones < 2 ? `${phones} of 2 phones connected. Pair in Mimic (Wand or Grip), then press A.` : 'Press A on each phone to join.';
    $('lobby-start').classList.toggle('hidden', !full);
  }
  function lobbyFrame(dt) {
    const inputs = lobbyInputs();
    if (lobby.guard > 0) { lobby.guard -= dt; inputs.forEach(p => { p.a = p.b = false; }); }
    const ev = TN.Lobby.stepLobby(lobby.st, inputs, dt);
    for (const e of ev) {
      if (e.type === 'join') { SFX.ui('ok'); AU.resume(); }
      else if (e.type === 'leave') SFX.ui('back');
      else if (e.type === 'back') { SFX.ui('back'); toTitle(); return; }
      else if (e.type === 'start') { startVersus(inputs); return; }
    }
    renderLobby(inputs);
  }
  function startVersus(inputs) {
    const slots = lobby.st.slots;
    if (!slots.every(Boolean)) return;
    slots.forEach((s, i) => {
      const inp = (inputs || lobbyInputs()).find(p => p.id === s.id);
      H[i].mc = inp ? inp.ctrl : (s.kind === 'keys' ? keyCtrl : slotCtrl(+s.id.replace('phone', '')));
      H[i].kind = s.kind;
      H[i].ctrlId = s.id;
    });
    SFX.ui('ok');
    startGame('versus');
  }
  addEventListener('keydown', e => {
    if (G.screen !== 'lobby') return;
    if (e.key === ' ') { if (!e.repeat) lobby.keyJoin = true; lobby.keyHold = true; e.preventDefault(); }
    if (e.key === 'Backspace') lobby.keyLeave = true;
    if (e.key === 'Enter' && lobby.st.slots.every(Boolean)) startVersus();
    if (e.key === 'Escape') toTitle();
  });
  addEventListener('keyup', e => { if (e.key === ' ') lobby.keyHold = false; });

  // ---------------------------------------------------------------------------------
  // Menus (mouse, keyboard, Wand cursor, and the A / B buttons)
  const menuFocus = { title: 0, opts: 0, pause: 0, end: 0, intro: 0 };
  function activeMenu() {
    if (G.screen === 'lobby') return null;          // the lobby is driven by A / B / hold A
    if (G.screen === 'intro') return 'intro';
    if (!G.inGame) return G.panel === 'opts' ? 'opts' : 'title';
    if (G.paused) return 'pause';
    if (G.mode === 'ended') return 'end';
    return null;
  }
  function menuItems(name) { return Array.from($(name + '-menu').querySelectorAll('.mi')).filter(el => el.offsetParent !== null); }
  function refreshFocus() {
    const m = activeMenu();
    ['title', 'opts', 'pause', 'end', 'intro'].forEach(n => menuItems(n).forEach((el, i) => el.classList.toggle('focus', i === menuFocus[n] && m === n)));
  }
  function optLabel(opt) {
    if (opt === 'opp') { const o = ROSTER[settings.opp]; return o.name + ' · ' + o.tier; }
    if (opt === 'games') return 'FIRST TO ' + GAMES[settings.games] + (GAMES[settings.games] === 1 ? ' GAME' : ' GAMES');
    if (opt === 'sens') return SENS[settings.sens].name;
    if (opt === 'sound') return SOUND[settings.sound];
    if (opt === 'zone') return ZONE[settings.zone];
    if (opt === 'power') return POWER[settings.power].name;
    if (opt === 'vol') return Math.round(VOLUME[settings.vol] * 100) + '%';
    if (opt === 'hand') return HANDS[settings.hand].name;
    if (opt === 'gfx') return GFX[settings.gfx] + (settings.gfx === 0 && !dyn.shadows ? ' · LIGHT' : '');
    return '';
  }
  function refreshOpts() {
    document.querySelectorAll('.mi.opt').forEach(el => { el.querySelector('b').textContent = optLabel(el.dataset.opt); });
    AU.setMuted(settings.sound === 2);
    AU.setVolume(VOLUME[settings.vol]);
    refreshTitle();
  }
  function refreshTitle() {
    const r = CIRCUIT[circuit.round], o = ROSTER[r.opp];
    $('circ-sub').textContent = (circuit.trophies ? circuit.trophies + ' trophy' + (circuit.trophies > 1 ? 'ies' : '') + ' · ' : '') + r.round.toLowerCase() + ' vs ' + o.name;
    $('quick-sub').textContent = 'vs ' + ROSTER[settings.opp].name + ' · first to ' + GAMES[settings.games];
  }
  function changeOpt(opt, d) {
    const n = { opp: ROSTER.length, games: GAMES.length, sens: SENS.length, sound: SOUND.length, zone: ZONE.length, power: POWER.length, vol: VOLUME.length, gfx: GFX.length, hand: HANDS.length }[opt];
    settings[opt] = (settings[opt] + d + n) % n;
    if (opt === 'gfx') { setShadows(settings.gfx !== 2); dyn.t = dyn.n = dyn.sum = 0; }
    saveSettings(); refreshOpts(); SFX.ui('move');
  }
  function setPanel(p) {
    G.panel = p;
    $('title-menu').classList.toggle('hidden', p !== 'main');
    $('opts-menu').classList.toggle('hidden', p !== 'opts');
    $('title').classList.toggle('opts', p === 'opts');   // options need the room: the connect block steps aside
    menuFocus[p === 'opts' ? 'opts' : 'title'] = 0; refreshFocus();
  }
  function activate(el) {
    if (!el) return;
    AU.resume();
    if (el.dataset.opt) { changeOpt(el.dataset.opt, 1); return; }
    const act = el.dataset.act;
    SFX.ui(act === 'back' ? 'back' : 'ok');
    if (act === 'match') startGame('match');
    else if (act === 'practice') startGame('practice');
    else if (act === 'circuit') showIntro();
    else if (act === 'play') startGame('circuit');
    else if (act === 'versus') openLobby();
    else if (act === 'lobby') { toTitle(); openLobby(); }
    else if (act === 'options') setPanel('opts');
    else if (act === 'back') { if (G.screen === 'intro') toTitle(); else setPanel('main'); }
    else if (act === 'resume') setPaused(false);
    else if (act === 'restart') startGame(G.kind);
    else if (act === 'rematch') startGame(G.kind);
    else if (act === 'quit') toTitle();
  }
  function bindMenu(root) {
    root.querySelectorAll('.mi').forEach(el => {
      el.addEventListener('click', e => {
        if (el.dataset.opt) {
          const arr = e.target.closest('.arr');
          if (arr) { changeOpt(el.dataset.opt, arr === el.querySelectorAll('.arr')[0] ? -1 : 1); return; }
        }
        activate(el);
      });
      el.addEventListener('mouseenter', () => {
        const m = activeMenu(); if (!m) return;
        const i = menuItems(m).indexOf(el); if (i >= 0) { menuFocus[m] = i; refreshFocus(); }
      });
    });
  }
  bindMenu(document);
  $('lobby-start').addEventListener('click', () => startVersus());
  $('lobby-back').addEventListener('click', () => { SFX.ui('back'); toTitle(); });
  function navMenu(d) {
    const m = activeMenu(); if (!m) return;
    const items = menuItems(m);
    menuFocus[m] = (menuFocus[m] + d + items.length) % items.length;
    refreshFocus(); SFX.ui('move');
  }
  function menuSide(d) {
    const m = activeMenu(); if (!m) return;
    const el = menuItems(m)[menuFocus[m]];
    if (el && el.dataset.opt) changeOpt(el.dataset.opt, d);
    else if (m === 'end') navMenu(d);
  }
  function menuBack() {
    const m = activeMenu();
    if (m === 'opts') { SFX.ui('back'); setPanel('main'); }
    else if (m === 'intro') { SFX.ui('back'); toTitle(); }
    else if (m === 'pause') setPaused(false);
  }
  addEventListener('keydown', e => {
    AU.resume();
    if (G.screen === 'lobby') return;
    if (e.key === 'Escape') {
      if (G.inGame && G.mode !== 'ended') setPaused(!G.paused);
      else menuBack();
      return;
    }
    if (e.key === 'm' || e.key === 'M') { settings.sound = settings.sound === 2 ? 0 : 2; saveSettings(); refreshOpts(); return; }
    const m = activeMenu();
    if (!m) return;
    if (e.key === 'ArrowUp') { navMenu(-1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { navMenu(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') menuSide(-1);
    else if (e.key === 'ArrowRight') menuSide(1);
    else if (e.key === 'Backspace') menuBack();
    else if (e.key === 'Enter' || e.key === ' ') { activate(menuItems(m)[menuFocus[m]]); e.preventDefault(); }
  });
  /** Phone buttons: only A, B and Center are guaranteed (Grip); the D-pad is a Wand extra. */
  function phoneInput(clicked) {
    const playing = G.inGame && G.mode !== 'ended';
    // pause / resume: B (Grip: Vol Up tap) or Home, from any player's phone
    const ctrls = playing ? humans.map(h => h.mc) : [mc];
    for (const c of ctrls) {
      if (!isPhone(c)) continue;
      if (playing && (c.pressed('home') || c.pressed('b'))) { setPaused(!G.paused); return; }
      if (c.pressed('center')) {
        const h = humans.find(x => x.mc === c);
        if (playing && h) hud.toast(h.idx, 'FORWARD SET');
      }
    }
    if (!isPhone(mc)) return;
    const m = activeMenu();
    if (!m) return;
    if (mc.pressed('up')) navMenu(-1);
    if (mc.pressed('down')) navMenu(1);
    if (mc.pressed('left')) menuSide(-1);
    if (mc.pressed('right')) menuSide(1);
    if (mc.pressed('a') && !clicked) activate(menuItems(m)[menuFocus[m]]);
    if (mc.pressed('b')) menuBack();
    if (mc.pressed('a') || mc.pressed('b') || mc.pressed('up') || mc.pressed('down')) AU.resume();
  }

  // ---------------------------------------------------------------------------------
  // Main loop
  let lastNow = performance.now(), acc = 0;
  const fpsWin = [];
  function render() {
    const w = innerWidth, hgt = innerHeight;
    renderer.shadowMap.needsUpdate = true;
    if (G.inGame && G.mode !== 'ended' && versus()) {
      renderer.setScissorTest(true);
      humans.forEach((h, i) => {
        const x = i * w / 2;
        renderer.setViewport(x, 0, w / 2, hgt); renderer.setScissor(x, 0, w / 2, hgt);
        h.cam.aspect = (w / 2) / hgt; h.cam.updateProjectionMatrix();
        renderer.render(scene, h.cam);
        renderer.shadowMap.needsUpdate = false;
      });
      renderer.setScissorTest(false);
    } else {
      renderer.setViewport(0, 0, w, hgt);
      camera.aspect = w / hgt; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    fpsWin.push(rdt); if (fpsWin.length > 120) fpsWin.shift();
    if (rdt > 0) dynResolution(rdt);
    humans.forEach(h => { if (h.mc.setHand) h.mc.setHand(handOf(h)); });
    mc.update(now);
    if (versus() && G.inGame) humans.forEach(h => { if (h.mc !== mc) h.mc.update(now); });
    updateCtrlStatus();
    if (!wandCursor && window.MimicCursor) wandCursor = MimicCursor.create(mc, { visible: () => !!activeMenu() });
    phoneInput(wandCursor ? wandCursor.update() : false);
    if (G.screen === 'lobby') lobbyFrame(rdt);

    if (G.inGame && !G.paused && G.mode !== 'ended') {
      // a phone that drops out mid-match pauses the match
      if (versus()) {
        const lost = humans.find(h => h.kind === 'phone' && !h.mc.connected);
        if (lost) { setPaused(true, nameOf(lost.idx) + "'s phone disconnected. Reconnect it, then resume."); }
      }
      humans.forEach(h => detectSwing(h, rdt));
      let dt = rdt;
      if (G.hitStop > 0) { G.hitStop -= rdt; dt = rdt * 0.06; }
      else if (G.slow > 0) { G.slow -= rdt; dt = rdt * SLOWMO; }
      updateLogic(dt);
      const ballPrev = { x: ball.p.x, y: ball.p.y, z: ball.p.z };
      acc += dt;
      let n = 0;
      while (acc >= TN.PHYS_DT && n < 40) { acc -= TN.PHYS_DT; G.t += TN.PHYS_DT; physicsStep(TN.PHYS_DT); n++; }
      if (n >= 40) acc = 0;
      humans.forEach(h => updateRacket(h, rdt));
      humans.forEach(h => checkContact(h, ballPrev));
      updateMeter();
    } else humans.forEach(h => updateRacket(h, rdt));
    updateActors(rdt);
    updateCamera(rdt);
    world.crowd.update(rdt);
    const showBall = G.inGame && ball.p.y > -1;
    fx.update(rdt, camera, ball.p, showBall);
    targets.forEach((t, i) => { if (t.visible) t.material.opacity = 0.55 + Math.sin(now / 300 + i) * 0.25; });
    render();
  }

  refreshOpts();
  setPanel('main');
  toTitle();
  ball.p = { x: 0, y: -5, z: 0 };
  requestAnimationFrame(frame);

  // testing / debugging hook
  window.__sunvolley = {
    debugCam(p, l) { dbgCam = p ? { p: new THREE.Vector3(p[0], p[1], p[2]), l: new THREE.Vector3(l[0], l[1], l[2]) } : null; },
    G, P, AI, H, ball, mc, world, renderer, scene, settings, circuit, lobby, ROSTER, CIRCUIT, startGame, toTitle, showIntro, openLobby, startVersus, showEnd, setPaused,
    get humans() { return humans; }, get renderScale() { return dyn.pr; }, get tossOwner() { return tossOwner; },
    get fps() { const s = fpsWin.reduce((a, b) => a + b, 0); return fpsWin.length / (s || 1); },
  };
})();
