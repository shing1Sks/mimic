/*
 * Emberlane - the game: first-person at the foul line, your arm is the phone (kin.js), the
 * ball leaves with your hand's real velocity, the pins are physics (physics.js). Quick game
 * (10 frames, 1-4 bowlers hot-seat) and practice.
 */
(function () {
  'use strict';
  const T = THREE, BW = window.BW, P = BW.Phys, L = P.LANE, K = BW.Kin, SC = BW.Score;
  const SFX = BW.Audio.SFX;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (k, dt) => 1 - Math.exp(-dt * k);
  const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const Q = new URLSearchParams(location.search);
  const DEBUG = Q.get('debug') === '1';
  // aim gain (kin.js AIM): the AIM option (NORMAL 0.25 / PRO 1:1); ?aim=G overrides it
  const AIM_Q = Q.get('aim') != null && Q.get('aim') !== '' && isFinite(+Q.get('aim')) ? clamp(+Q.get('aim'), 0, 1.5) : null;

  // ------------------------------------------------------------------ body geometry
  // The bowler in the release position: knees bent, shoulder over the slide foot. The ball at
  // the bottom of the swing is ~0.22 m up, as in a real release. You stand ROOM behind the
  // slide spot: a step or lunge (measured by the phone, kin.js body) carries you up to the
  // foul line; the shoulder never crosses LINE_Z (the slide foot stops at the line).
  const BODY = { SHOULDER_Y: 0.92, SHOULDER_Z: 0.42, SIDE: 0.17, ROOM: 0.35, LINE_Z: 0.14 };
  const CAM = { Y: +(Q.get('camy') || 1.36), BACK: +(Q.get('camback') || 1.7), LOOKZ: +(Q.get('lookz') || -3.6), LOOKY: +(Q.get('looky') || 0), FOV: +(Q.get('fov') || 58) };
  const RETURN_SPOT = new T.Vector3(-0.875, 0.53 + 0.1085, 0.75);   // your ball waits at the front of the return
  const PLAYER_COLORS = [0xd8461c, 0x14908f, 0x7a2cc9, 0xc99a1c];
  const PLAYER_CSS = ['#ff7a3d', '#2fc3b8', '#b07cff', '#ffcc4d'];

  // ------------------------------------------------------------------ settings
  const settings = { players: 1, hand: 'right', sound: true, ball: 15, aim: 'normal', bumpers: false, volume: 80, music: 50, quality: 'auto', hold: null };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('emberlane2') || '{}')); } catch (e) { /* storage blocked */ }
  const saveSettings = () => { try { localStorage.setItem('emberlane2', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  SFX.setMuted(!settings.sound); SFX.setVolume(settings.volume / 100); SFX.setMusic(settings.music / 100);
  const applyAim = () => { K.AIM.GAIN = AIM_Q != null ? AIM_Q : settings.aim === 'pro' ? K.AIM.PRO : K.AIM.NORMAL; };
  applyAim();

  // ------------------------------------------------------------------ renderer
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;   // hex colours are sRGB
  const mc = new MimicController();
  const IN = BW.Input.create(mc);
  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(1);
  renderer.physicallyCorrectLights = true;
  renderer.outputEncoding = T.LinearEncoding;
  renderer.toneMapping = T.NoToneMapping;
  renderer.shadowMap.enabled = Q.get('shadows') !== '0'; renderer.shadowMap.type = T.PCFShadowMap;
  $('stage').appendChild(renderer.domElement);
  const post = BW.Post.create(renderer, { msaa: Q.get('msaa') });
  const camera = new T.PerspectiveCamera(CAM.FOV, innerWidth / innerHeight, 0.03, 70);
  camera.layers.enable(1);   // layer 1: seen by the camera, left out of the lane reflection
  // render quality: HIGH draws the scene at full resolution, LOW at 70% (the post chain upscales)
  // with a cheaper lane reflection. AUTO starts HIGH and drops to LOW, once, if the frame rate
  // stays under 45 for 4 s of play (?quality=low|high forces one).
  const QUAL_Q = Q.get('quality');
  const qual = { low: QUAL_Q === 'low' || (QUAL_Q !== 'high' && settings.quality === 'low'), slowS: 0, auto: !QUAL_Q && settings.quality === 'auto' };
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const k = qual.low ? 0.7 : 1;
    post.setSize(Math.round(innerWidth * k), Math.round(innerHeight * k));
    if (W) W.setSize(innerWidth, innerHeight);
  }
  function setQuality(low) { qual.low = low; if (W) W.setQuality(low); resize(); }
  addEventListener('resize', resize);

  let W = null, arms = {}, arm = null, fx = null, spot = null, cursor = null;

  // ------------------------------------------------------------------ state
  const G = {
    mode: 'loading', kind: 'game', paused: false, players: [], cur: 0, sim: null, standingBefore: 10,
    refBase: 0, grip: null, aligned: false, alignHeld: false, bodyOff: new T.Vector3(), ff: 1, skipFF: false, endT: null, mouseOK: false,
    stance: 0, stanceFrom: 0, stanceTo: 0, stanceT: 1,
    grabT: 1, ballFrom: new T.Vector3(), pendingRel: null, roll: null, rollT: 0, firstHit: false, firstHitT: 0,
    timeScale: 1, slowUntil: 0, shake: 0, camMode: 'title', camBlend: 1, camFrom: null,
    resultT: 0, result: null, reset: null, droppedT: 0, decidedT: 0, waitPress: false, t: 0,
    stats: { balls: 0, strikes: 0, spares: 0 }, fps: { n: 0, t: 0, v: 0 }, gutterSaid: false, atArrows: null,
  };
  window.__emb = { G, IN, K, P, get W() { return W; }, get fx() { return fx; }, camera, renderer, settings, post };
  // fit checks (UI screens): filled in once the flow functions exist
  window.__embUI = {};

  const side = () => (settings.hand === 'left' ? -1 : 1);
  /** The shoulder at the stance spot, before any step (the body offset comes on top). */
  const shoulder = () => new T.Vector3(G.stance + side() * BODY.SIDE, BODY.SHOULDER_Y, BODY.SHOULDER_Z + BODY.ROOM);
  /** The measured body offset, kept where a body can go (the slide foot stops at the line). */
  function clampBody(p) {
    return new T.Vector3(p.x, p.y, Math.max(BODY.LINE_Z - (BODY.SHOULDER_Z + BODY.ROOM), p.z));
  }
  const ballMass = () => (settings.ball === 16 ? P.BALL.MASS_16LB : P.BALL.MASS);
  const curPlayer = () => G.players[G.cur];
  const holdName = () => (!IN.S.padOn ? 'left mouse' : mc.mode === 'grip' ? mc.keyName('a') : 'A');
  const alignName = () => (!IN.S.padOn ? 'C' : mc.mode === 'grip' ? (mc.via === 'browser' ? 'CENTRE' : 'Vol Up') : 'Center');
  /** 'motion' (a phone sending motion), 'phone-mouse' (a phone is here but sends mouse / keys
   * or nothing usable: bowling waits for it) or 'mouse' (no phone: the mouse stands in). */
  function inputState() {
    if (IN.S.padOn) return 'motion';
    if (IN.S.phoneHint && !G.mouseOK) return 'phone-mouse';
    return 'mouse';
  }

  // ------------------------------------------------------------------ loading
  function loadAll() {
    const tl = new T.TextureLoader();
    const jobs = [];
    let done = 0;
    const bar = document.querySelector('.ld-bar i');
    const step = () => { done++; bar.style.width = Math.round(done / jobs.length * 100) + '%'; };
    const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => { step(); res(i); }; i.onerror = rej; i.src = src; });
    const tex = (src, srgb) => new Promise((res, rej) => tl.load(src, t => { if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); step(); res(t); }, undefined, rej));
    const A = { tex: {} };
    jobs.push(img('assets/tex/white_maple_veneer_diff_2k.jpg').then(i => { A.maple = i; }));
    jobs.push(new Promise((res, rej) => new T.RGBELoader().load('assets/hdr/billiard_hall_1k.hdr', t => { t.mapping = T.EquirectangularReflectionMapping; A.hdr = t; step(); res(); }, undefined, rej)));
    jobs.push(tex('assets/tex/brushed_concrete_diff_1k.jpg', true).then(t => { A.tex.concrete = t; }));
    jobs.push(tex('assets/tex/brushed_concrete_nor_gl_1k.jpg').then(t => { A.tex.concreteN = t; }));
    jobs.push(tex('assets/tex/dirty_carpet_diff_1k.jpg', true).then(t => { A.tex.carpet = t; }));
    jobs.push(tex('assets/tex/metal_plate_diff_1k.jpg', true).then(t => { A.tex.metal = t; }));
    jobs.push(tex('assets/tex/metal_plate_nor_gl_1k.jpg').then(t => { A.tex.metalN = t; }));
    jobs.push(tex('assets/tex/leather_red_02_nor_gl_1k.jpg').then(t => { A.tex.leatherN = t; }));
    jobs.push(tex('assets/tex/cotton_jersey_diff_1k.jpg', true).then(t => { A.tex.cloth = t; }));
    jobs.push(tex('assets/tex/cotton_jersey_nor_gl_1k.jpg').then(t => { A.tex.clothN = t; }));
    const gl = new T.GLTFLoader();
    jobs.push(new Promise((res, rej) => gl.load('assets/models/hand_right.glb', g => { A.handR = g; step(); res(); }, undefined, rej)));
    jobs.push(new Promise((res, rej) => gl.load('assets/models/hand_left.glb', g => { A.handL = g; step(); res(); }, undefined, rej)));
    return Promise.all(jobs).then(() => A);
  }

  function boot() {
    loadAll().then(A => {
      W = BW.World.build(renderer, A);
      W.setQuality(qual.low);
      W.deck.shadow.autoUpdate = false; W.key.shadow.autoUpdate = false;   // updated on demand (loop)
      for (const s of ['right', 'left']) {
        arms[s] = BW.Hand.build(s === 'right' ? A.handR : A.handL, { left: s === 'left', cloth: A.tex.cloth, clothN: A.tex.clothN });
        arms[s].group.visible = false;
        W.scene.add(arms[s].group);
      }
      arm = arms[settings.hand];
      fx = makeFX();
      spot = new T.Mesh(new T.RingGeometry(0.06, 0.085, 40), new T.MeshBasicMaterial({ color: new T.Color(3, 1.6, 0.7), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
      spot.rotation.x = -Math.PI / 2; spot.position.y = 0.003; W.scene.add(spot);
      resize();
      newRack();
      // compile every material now (both hands, the bumpers, the deck seen from the celebrate
      // camera), not on the first frame that shows it: that was a visible hitch on the first strike
      try {
        const hidden = [arms.right.group, arms.left.group, W.bumpers].filter(o => o && !o.visible);
        hidden.forEach(o => { o.visible = true; });
        renderer.compile(W.scene, camera);
        hidden.forEach(o => { o.visible = false; });
      } catch (e) { /* compile is only a warm-up */ }
      cursor = window.MimicCursor ? MimicCursor.create(mc, { visible: () => menuOpen() }) : null;
      $('loading').classList.add('done');
      toTitle();
      requestAnimationFrame(loop);
    }).catch(e => { $('loading').querySelector('.ld-txt').textContent = 'Could not load: ' + (e && e.message || e); console.error(e); });
  }
  if (window.__threeLoadersReady) boot(); else addEventListener('three-loaders', boot, { once: true });

  // ------------------------------------------------------------------ impact effects (fx.js)
  function makeFX() {
    const F = BW.FX;
    const o = { chips: F.particles(600, false, true), glints: F.particles(60, true, false), embers: F.particles(320, true, false), dust: F.particles(160, false, false), track: F.track() };
    for (const k of ['chips', 'glints', 'embers', 'dust']) W.scene.add(o[k].points);
    o.chips.mat.uniforms.maxPx.value = 9; o.glints.mat.uniforms.maxPx.value = 90; o.embers.mat.uniforms.maxPx.value = 16; o.dust.mat.uniforms.maxPx.value = 48;
    W.scene.add(o.track.mesh); W.reflHide.push(o.track.mesh, o.dust.points, o.chips.points);   // (in the lane's soft mirror, flecks read as snow)
    o.update = dt => {
      const sc = innerHeight * (qual.low ? 0.7 : 1) / (2 * Math.tan(camera.fov * Math.PI / 360));
      for (const k of ['chips', 'glints', 'embers', 'dust']) { o[k].mat.uniforms.scale.value = sc; o[k].update(dt); }
      o.track.mat.uniforms.now.value = G.t;
    };
    return o;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  /** A pin struck (by the ball or another pin): lacquer flecks thrown off and a short contact glint. */
  function impactFX(e, first) {
    const s = clamp((e.speed - 0.9) / 6, 0, 1), many = qual.low ? 0.5 : 1;
    const n = Math.round((first ? 26 : 3 + 16 * s) * many);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = rnd(0.2, 1), sp = rnd(0.5, 2.4) * (0.45 + s) * (first ? 1.3 : 1);
      const red = Math.random() < 0.14;
      fx.chips.spawn({ x: e.x + rnd(-0.01, 0.01), y: e.y + rnd(-0.01, 0.01), z: e.z + rnd(-0.01, 0.01),
        vx: Math.cos(a) * sp * (1 - up * 0.5), vy: up * sp * 1.1, vz: Math.sin(a) * sp * (1 - up * 0.5) - (first ? 0.6 : 0),
        size: rnd(0.005, first ? 0.016 : 0.012), r: red ? 1.1 : 1.45, g: red ? 0.1 : 1.38, b: red ? 0.08 : 1.25, life: rnd(0.45, 1.1), drag: 1.2 });
    }
    if (s > 0.12 || first) fx.glints.spawn({ x: e.x, y: e.y, z: e.z, size: first ? 0.15 : 0.04 + 0.08 * s, r: 5.5, g: 3.6, b: 2.2, a: first ? 0.9 : 0.4 + 0.4 * s, life: first ? 0.11 : 0.05 + 0.05 * s, grav: 0 });
  }
  /** A pin or the ball slapping the deck: a low puff of dust. */
  function dustFX(e) {
    const s = clamp((e.speed - 1) / 4, 0, 1), n = Math.round((2 + 5 * s) * (qual.low ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.15, 0.5) * (0.6 + s);
      fx.dust.spawn({ x: e.x, y: 0.01, z: e.z, vx: Math.cos(a) * sp, vy: rnd(0.05, 0.25), vz: Math.sin(a) * sp, size: rnd(0.03, 0.06), r: 0.62, g: 0.52, b: 0.42, a: 0.16 + 0.14 * s, life: rnd(0.5, 0.9), drag: 2.6, grav: -0.05 });
    }
  }
  /** Embers rising off the deck (a strike, a spare). */
  function embersFX(x, y, z, n, spread) {
    n = Math.round(n * (qual.low ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (spread || 0.45), hot = Math.random();
      fx.embers.spawn({ x: x + Math.cos(a) * r, y: y + rnd(0, 0.25), z: z + Math.sin(a) * r * 0.7,
        vx: Math.cos(a) * rnd(0.2, 1.1), vy: rnd(1.2, 3.6), vz: Math.sin(a) * rnd(0.2, 0.9) + 0.1,
        size: rnd(0.01, 0.026), r: 4.5, g: 1.4 + hot * 1.4, b: 0.35 + hot * 0.4, life: rnd(0.8, 1.9), drag: 0.9, grav: 2.4 });
    }
  }

  // ------------------------------------------------------------------ racks
  function newRack(keep) {
    G.sim = P.createSim({ bumpers: G.bumpers });
    if (keep) P.rack(G.sim, keep);
    else P.rack(G.sim, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => { const s = P.pinSpot(n); return { n, x: s.x + (Math.random() - 0.5) * 0.008, z: s.z + (Math.random() - 0.5) * 0.008 }; }));
    G.standingBefore = G.sim.pins.length;
    G.deckShadowFrames = 3;
    syncPins();
    renderPins();
  }
  function syncPins(override) {
    const pins = G.sim.pins;
    W.pins.forEach((m, i) => {
      const p = pins[i];
      m.visible = !!p && !p.swept && p.x[1] > -1.5;   // pins in the pit stay where they landed
      if (!p) return;
      const lift = override && override.lift ? override.lift(p) : 0;
      m.position.set(p.x[0], p.x[1] + lift, p.x[2]);
      m.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    });
  }

  // ------------------------------------------------------------------ flow
  function startGame(kind) {
    G.kind = kind; G.paused = false;
    const n = kind === 'game' ? settings.players : 1;
    G.players = Array.from({ length: n }, (_, i) => ({ name: 'P' + (i + 1), color: PLAYER_COLORS[i], css: PLAYER_CSS[i], rolls: [] }));
    G.cur = 0; G.stats = { balls: 0, strikes: 0, spares: 0 };
    G.bumpers = !!settings.bumpers; W.setBumpers(G.bumpers); applyAim();
    ['title', 'pause', 'end'].forEach(id => $(id).classList.add('hidden'));
    $('hud').classList.remove('hidden');
    arm.group.visible = false;
    arm = arms[settings.hand]; arm.group.visible = true;
    newRack();
    toReady(true);
    renderSheet();
    if (n > 1) banner(curPlayer().name + ' UP', 'Frame 1', 'turn', 1.6, curPlayer().css);
    G.lineup = null; $('lineup').classList.add('hidden'); $('hud').classList.remove('lu');
    if (IN.S.padOn && settings.hold == null && !Q.has('nolineup')) beginLineup();
  }
  function toTitle() {
    G.mode = 'title'; G.paused = false;
    ['hud', 'pause', 'end'].forEach(id => $(id).classList.add('hidden'));
    $('title').classList.remove('hidden');
    if (arm) arm.group.visible = false;
    G.camMode = 'title';
    newRack(); G.sim.ball = null;
    refreshOptions();
  }
  function toReady(first) {
    G.mode = 'ready'; G.roll = null; G.pendingRel = null; G.firstHit = false; G.crashPlayed = false; G.gutterSaid = false; G.pitSaid = false; G.atArrows = null; G.result = null;
    if (fx) fx.track.clear();
    G.sim.ball = null; G.timeScale = 1; G.slowUntil = 0; G.ff = 1; G.skipFF = false; G.endT = null; G.gutterT = null;
    K.bodyStop(IN.body);
    if (G.cyc && G.cyc.result && !G.cyc.ready) { G.cyc.ready = performance.now(); G.lastCycle = G.cyc;
      if (window.MimicRec) MimicRec.event('cycle', Object.fromEntries(Object.entries(G.cyc).map(([k, v]) => [k, Math.round(v - G.cyc.rel)]))); }
    G.grabT = 1; G.waitPress = IN.S.a;   // still holding from before: needs a fresh press
    const p = curPlayer();
    W.ball.material = W.playerBallMats[G.players.indexOf(p) & 3];
    arm.setShirt(p.color); arm.setGrip(0.15);
    setCam('bowler', first ? 0.01 : 0.9);
    hint(`Hold <b>${holdName()}</b> to pick up the ball`);
    renderSheet(); renderPins();
  }
  /** The lane reference the grip would take now (kin.js gripRef; the mouse is in the lane frame). */
  /** This player's grip offset (rad): the line-up's running estimate, the saved one, or kin's default. */
  const holdRad = () => (G.lineup ? K.lineup.result(G.lineup.raws, side()).hold : settings.hold != null ? settings.hold * Math.PI / 180 : undefined);
  function liveGrip(q) { return IN.S.padOn ? K.gripRef(q || IN.S.q, G.refBase, { aligned: G.aligned, side: side(), hold: holdRad() }) : { ref: K.laneRef(0), yaw: 0, src: 'mouse', armYaw: 0, tilt: 0 }; }
  function grab(tPress) {
    G.mode = 'held';
    G.grabT = 0;
    // this throw's lane reference, from the phone at the grip sample: no align needed
    const s = IN.track.samples.find(x => x.t === tPress);
    G.gripQ = s ? s.q : IN.S.q;
    G.grip = liveGrip(G.gripQ);
    // the body tracker (kin.js) is off: on real data it measured the arm model's error, not steps
    if (K.BODY.USE) K.bodyStart(IN.body, tPress || IN.lastT());
    G.bodyOff.set(0, 0, 0);
    G.ballFrom.copy(W.ball.position);
    SFX.grab(); mc.rumble(0.25, 30, 0);
    hint('Swing back, swing through, <b>let go</b>');
  }
  function clampStance(x) { const s = side() * BODY.SIDE; return clamp(x, -0.46 - s, 0.46 - s); }

  /** HOLD came up at sample time t: wait for the samples just after it, then let go. */
  function scheduleRelease(t) { G.pendingRel = { t, at: performance.now() }; }
  function finishRelease() {
    const tRel = G.pendingRel.t;
    G.pendingRel = null;
    const gr = G.grip || liveGrip();
    const sh = shoulder();
    if (K.BODY.USE) IN.updateBody(gr.ref);
    const T1 = K.throwFrom(IN.track.samples, tRel, gr.ref, { x: sh.x, y: sh.y, z: sh.z },
      { halfMs: IN.S.padOn ? 28 : 60, body: IN.body, bottom: IN.S.padOn, clampP: p => { const c = clampBody(p); return { x: c.x, y: c.y, z: c.z }; } });
    if (!T1) { toReady(); return; }
    const f = T1.f, rb = T1.rb, bp = T1.bodyP || { x: 0, y: 0, z: 0 };
    K.bodyStop(IN.body);
    G.bodyOff.set(bp.x, bp.y, bp.z);
    const b = P.launch(G.sim, { x: rb.pos.x, y: rb.pos.y, z: rb.pos.z, v: [rb.v.x, rb.v.y, rb.v.z], w: [rb.spin.x, rb.spin.y, rb.spin.z], mass: ballMass() });
    // catch up with the time since the release
    // (a release at the bottom left up to BOTTOM.WINDOW ms before the key came up)
    const lag = clamp((performance.now() - T1.release.t) / 1000, 0, 0.3);
    P.advance(G.sim, lag);
    G.mode = 'rolling'; G.rollT = 0; G.droppedT = 0; G.decidedT = 0;
    G.roll = rb; G.stats.balls++;
    arm.setGrip(0.2);
    SFX.release(rb.speed); mc.rumble(clamp(rb.speed / 12, 0.2, 0.7), 50, 0);
    hint('');
    showBallInfo(rb, b);
    const board = boardAt(rb.pos.x);
    if (window.MimicRec) MimicRec.event('throw', {
      speed: +rb.speed.toFixed(3), kmh: +(rb.speed * 3.6).toFixed(1), heading_deg: +(rb.heading * 180 / Math.PI).toFixed(2), loft_deg: +(rb.loft * 180 / Math.PI).toFixed(1),
      twist: +rb.twist.toFixed(2), sideRoll: +rb.sideRoll.toFixed(2), rpm: Math.round(rb.rpm), w: [f.w.x, f.w.y, f.w.z].map(v => +v.toFixed(3)),
      armKmh: +(rb.armSpeed * 3.6).toFixed(1), vSrc: rb.vSrc, modelKmh: +(K.len(rb.armModelV) * 3.6).toFixed(1), bodyV: [rb.bodyV.x, rb.bodyV.y, rb.bodyV.z].map(v => +v.toFixed(2)), bodyP: [bp.x, bp.y, bp.z].map(v => +v.toFixed(2)),
      releaseMode: T1.release.mode, releaseLag: T1.release.lag == null ? null : +T1.release.lag.toFixed(1), aim: K.AIM.GAIN, bumpers: G.bumpers,
      ref: gr.src, refYaw: +(gr.yaw * 180 / Math.PI).toFixed(1), gripArmYaw: +(gr.armYaw * 180 / Math.PI).toFixed(1), gripTilt: +(gr.tilt * 180 / Math.PI).toFixed(0), mode: mc.mode, source: IN.S.source, tRel: +tRel.toFixed(1), mass: ballMass(),
      pos: [rb.pos.x, rb.pos.y, rb.pos.z].map(v => +v.toFixed(3)), board: +board.toFixed(1), capped: rb.capped, nFit: f.n, stance: +G.stance.toFixed(3), aligned: G.aligned, body: K.BODY.USE,
    });
    G.lastThrow = { rb, f, t: performance.now(), bp, grip: gr, release: T1.release };
    if (G.lineup) lineupSwing(tRel, sh);
    G.cyc = { rel: performance.now() };   // timing of this shot (tests, recordings)
    G.atPins = null;
  }
  const boardAt = x => (L.HALF - x) / (2 * L.HALF / 39) + 0.5;

  // ------------------------------------------------------------------ line-up
  // Three practice swings at an empty lane teach the game how this player's phone sits in the
  // fist (kin.js lineup): afterwards straight ahead is where they actually swing. Runs once
  // (first game with the phone), again from the pause menu; real throws never change it.
  function beginLineup() {
    if (!IN.S.padOn) { toast('Line up needs the phone in Grip or Wand mode', 2.4); return; }
    G.lineup = { raws: [], last: null };
    G.aligned = false;
    newRack([]);
    G.sim.ball = null; toReady(true);
    $('lineup').classList.remove('hidden');
    renderLineup();
    if (window.MimicRec) MimicRec.event('lineup', { start: true });
  }
  function lineupSwing(tRel, sh) {
    const g0 = K.gripRef(G.gripQ || IN.S.q, G.refBase, { side: side(), hold: 0 });
    const T0 = g0.src === 'grip' ? K.throwFrom(IN.track.samples, tRel, g0.ref, { x: sh.x, y: sh.y, z: sh.z },
      { halfMs: 28, bottom: true, aimGain: 1, clampP: p => { const c = clampBody(p); return { x: c.x, y: c.y, z: c.z }; } }) : null;
    const ok = !!T0 && K.lineup.valid(T0.rb);
    if (ok) G.lineup.raws.push(T0.rb.heading);
    G.lineup.last = ok ? 'ok' : g0.src !== 'grip' ? 'arm' : 'bad';
    if (ok) SFX.ui('align');
    if (window.MimicRec) MimicRec.event('lineup', { ok, raw: T0 ? +(T0.rb.heading * 180 / Math.PI).toFixed(1) : null, kmh: T0 ? +(T0.rb.speed * 3.6).toFixed(1) : null, n: G.lineup.raws.length });
    renderLineup();
  }
  /** After a practice ball has rolled long enough to see its line: the next swing, or done. */
  function lineupNext() {
    const r = K.lineup.result(G.lineup.raws, side());
    if (r.done) { lineupFinish(r.hold * 180 / Math.PI); return; }
    if (r.more) G.lineup.last = 'more';
    G.sim.ball = null; toReady();
    renderLineup();
  }
  function lineupFinish(holdDeg, skipped) {
    settings.hold = Math.round(holdDeg * 10) / 10; saveSettings();
    if (window.MimicRec) MimicRec.event('lineup', { done: true, hold: settings.hold, skipped: !!skipped });
    G.lineup = { done: true, raws: [], skipped: !!skipped };
    renderLineup();
    G.lineup = null;
    setTimeout(() => { if (!G.lineup) $('lineup').classList.add('hidden'); }, skipped ? 900 : 2600);
    newRack(); G.sim.ball = null; toReady();
    mc.rumble(0.35, 60, 1);
  }
  function renderLineup() {
    const Lu = G.lineup, el = $('lineup');
    if (!Lu || !el) return;
    const n = Lu.raws.length, need = K.lineup.C.N;
    let step, main, note = '';
    if (Lu.done) {
      step = 'LINE UP · DONE';
      main = Lu.skipped ? 'Using the standard grip. Line up any time from the pause menu.'
        : `Lined up. Straight ahead now fits your grip <small>(phone turned ${Math.abs(settings.hold).toFixed(0)}&deg;)</small>. Redo it any time from the pause menu.`;
    } else if (n === 0 && !Lu.last) {
      step = 'LINE UP · 1 OF 3';
      main = `Hold the phone the way you'd hold the ball, top toward the pins. The hand on screen moves with yours. Hold <b>${holdName()}</b> to pick the ball up.`;
    } else {
      step = 'LINE UP · 2 OF 3';
      const left = Math.max(1, need - n);
      main = `Swing straight at the middle pin and let go. ${left} more ${left === 1 ? 'swing' : 'swings'}; these don't count.`;
      if (Lu.last === 'bad') note = 'That one was too soft or far off: swing through and let go near the bottom.';
      if (Lu.last === 'arm') note = 'Pick the ball up with your forearm out in front, phone top forward.';
      if (Lu.last === 'more') note = 'Those swings disagreed: one more.';
    }
    const total = Math.max(need, n + (Lu.last === 'more' ? 1 : 0));
    const dots = Lu.done ? '' : Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    $('hud').classList.toggle('lu', !Lu.done);
    el.innerHTML = `<div class="lu-step">${step}</div><div class="lu-main">${main}</div>${note ? `<div class="lu-note">${note}</div>` : ''}`
      + (dots ? `<div class="lu-dots">${dots}</div>` : '') + (Lu.done ? '' : '<button class="lu-skip" data-act="lineup-skip">Skip</button>');
  }

  function standingPins() { return G.sim.pins.filter(p => P.standing(p)); }

  function evaluate(kind) {
    const up = standingPins(), knocked = G.standingBefore - up.length;
    const p = curPlayer();
    const nx = SC.next(p.rolls);
    p.rolls.push(knocked);
    let label = '', sub = '', cls = 'small';
    if (nx.fresh && knocked === 10) {
      let run = 0; for (let i = p.rolls.length - 1; i >= 0 && p.rolls[i] === 10; i--) run++;
      label = run >= 4 ? run + '-BAGGER' : ['STRIKE', 'STRIKE', 'DOUBLE', 'TURKEY'][run];
      sub = run >= 2 ? run + ' strikes in a row' : ''; cls = 'strike';
      G.stats.strikes++;
      SFX.strike(run); mc.rumble(0.9, 160, 3);
      post.uniforms.flash.value = 0.9;
      embersFX(0, 0.1, -18.6, 110 + 40 * Math.min(run, 4)); embersFX(0, 0.95, -17.4, 50, 0.8);
      panelMoment(run >= 2 ? label : 'STRIKE', run);
      setCam('celebrate', 0.9); G.celebT = 0; G.celebRun = run;
    } else if (!nx.fresh && up.length === 0) {
      label = 'SPARE'; cls = 'spare'; G.stats.spares++;
      SFX.spare(); mc.rumble(0.6, 90, 1);
      embersFX(0, 0.1, -18.6, 70);
      panelMoment('SPARE');
      setCam('celebrate', 0.9); G.celebT = 0; G.celebRun = 0;
    } else if (kind === 'gutter' && knocked === 0) {
      label = 'GUTTER'; sub = 'it happens'; cls = 'small gutter'; SFX.moment('gutter');
    } else {
      label = knocked === 0 ? 'MISS' : String(knocked);
      sub = knocked === 1 ? 'pin' : knocked > 1 ? 'pins' : '';
      if (!nx.fresh || nx.frame === 9) { /* nothing */ }
      if (up.length && nx.fresh && isSplit(up)) { sub = 'SPLIT'; cls = 'small split'; SFX.moment('split'); }
    }
    banner(label, sub, cls, cls === 'strike' ? 2.0 : cls === 'spare' ? 1.8 : 1.3);
    if (window.MimicRec) MimicRec.event('result', { knocked, up: up.map(q => q.n), label });
    renderSheet(); renderPins();
    if (G.cyc) G.cyc.result = performance.now();
    G.mode = 'result'; G.resultT = 0;
    G.result = { up, knocked, strike: cls === 'strike', celebrate: cls === 'strike' || cls === 'spare' };
    if (window.MimicRec) MimicRec.event('timing', { endToResult: G.endT !== null ? +(G.t - G.endT).toFixed(2) : null, rollT: +G.rollT.toFixed(2) });
  }
  function isSplit(up) {
    const ns = new Set(up.map(p => p.n));
    if (ns.has(1) || up.length < 2) return false;
    // standing pins with a gap between them on the same row or adjacent rows
    const cols = up.map(p => Math.round(p.home.x / (L.SPACING / 2)));
    cols.sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) if (cols[i] - cols[i - 1] > 2) return true;
    return false;
  }

  /** After the banner: the pinsetter, then the next ball or the next bowler. */
  /** Every standing pin is at rest and upright (physics decided() can pass a pin that has only
   * just begun to tip; give it time to go before the sweep). */
  function deckSettled() {
    return G.sim.pins.every(q => !P.standing(q) || q.asleep || (P.pinUp(q)[1] > 0.998 && Math.hypot(q.w[0], q.w[1], q.w[2]) < 0.2));
  }
  function startReset() {
    const p = curPlayer();
    // pins that fell after the count still count for that ball: a second ball never faces an
    // empty rack because of a late faller
    const rc = SC.sweepCount(p.rolls, G.standingBefore - standingPins().length);
    if (rc.changed) {
      const prev = p.rolls[p.rolls.length - 1];
      p.rolls = rc.rolls;
      const fr = SC.frames(p.rolls), f = fr[fr.length - 1], last = rc.rolls[rc.rolls.length - 1];
      const strike = last === 10 && (f.rolls.length === 1 || fr.length === 10 && SC.marks(p.rolls)[fr.length - 1].slice(-1)[0] === 'X');
      const spare = !strike && SC.marks(p.rolls)[fr.length - 1].slice(-1)[0] === '/';
      banner(strike ? 'STRIKE' : spare ? 'SPARE' : String(last), 'late pin', strike ? 'strike' : spare ? 'spare' : 'small', 1.6);
      if (strike) { G.stats.strikes++; SFX.strike(0); } else if (spare) { G.stats.spares++; SFX.spare(); }
      if (window.MimicRec) MimicRec.event('recount', { from: prev, to: last });
      renderSheet(); renderPins();
    }
    const nx = SC.next(p.rolls);
    let turnOver = false;
    if (G.kind === 'game') {
      if (SC.frameDone(p.rolls) && G.players.length > 1) turnOver = true;
      if (nx.over) {
        if (G.players.every(q => SC.next(q.rolls).over)) { G.mode = 'end'; setTimeout(showEnd, 600); return; }
        turnOver = true;
      }
    } else if (nx.over) {
      p.rolls = []; // practice: a fresh sheet
    }
    const fresh = turnOver || SC.next(p.rolls).fresh;
    const keep = fresh ? null : standingPins().map(q => ({ n: q.n, x: q.x[0], z: q.x[2] }));
    G.reset = { t: 0, fresh, keep, turnOver };
    G.mode = 'reset';
    setCam('bowler', 1.0);
    SFX.machine(0, 1, -18);
  }
  function updateReset(dt) {
    const R = G.reset; R.t += dt / 0.62;    // the pinsetter cycle in ~1.2 s
    const t = R.t, sw = W.sweep;
    W.wheel.rotation.z -= dt * 1.1;   // the pin wheel turns while the machine cycles
    // sweep bar: down, back, up
    const down = smooth(t / 0.35), back = smooth((t - 0.75) / 0.45), up = smooth((t - 1.25) / 0.3);
    sw.position.y = lerp(1.4, 0.13, down) + up * 1.27;
    sw.position.z = lerp(-17.9, -19.3, back * (1 - up)) + (up > 0 ? 0 : 0);
    if (R.fresh) {
      if (t > 1.0 && !R.cleared) { R.cleared = true; newRack(); R.dropT = 0; }
      if (R.cleared) syncPins({ lift: () => Math.max(0, 0.6 * (1 - smooth((t - 1.35) / 0.5))) });
      else syncPins();
    } else {
      const lift = smooth((t - 0.35) / 0.4) * (1 - smooth((t - 1.5) / 0.4)) * 0.55;
      if (t > 0.35 && !R.lifted) { R.lifted = true; }
      if (t > 1.0 && !R.cleared) { R.cleared = true; newRack(R.keep); G.standingBefore = R.keep.length; }
      if (!R.cleared) syncPins({ lift: q => (P.standing(q) ? lift : 0) }); else syncPins({ lift: () => lift });
    }
    if (t > 1.95) {
      sw.position.set(0, 1.4, -17.9);
      if (R.turnOver) { G.cur = (G.cur + 1) % G.players.length; G.stance = G.stanceTo = G.stanceFrom = 0; banner(curPlayer().name + ' UP', `Frame ${SC.next(curPlayer().rolls).frame + 1} · pass the phone`, 'turn', 1.8, curPlayer().css); }
      G.reset = null;
      toReady();
    }
  }

  function dropped() {
    toast('Dropped. No count, grab it again', 2.4);
    if (window.MimicRec) MimicRec.event('result', { dropped: true });
    G.mode = 'dropped'; G.resultT = 0;
  }

  function showEnd() {
    const ranked = G.players.map((p, i) => ({ p, i, s: SC.score(p.rolls).total })).sort((a, b) => b.s - a.s);
    const solo = G.players.length === 1, top = ranked[0];
    let best = 0; try { best = +localStorage.getItem('emberlane-best') || 0; } catch (e) { /* storage blocked */ }
    const newBest = top.s > best && G.kind === 'game';
    if (newBest) try { localStorage.setItem('emberlane-best', String(top.s)); } catch (e) { /* ignore */ }
    const title = $('end-title');
    title.innerHTML = solo ? '<b class="cnt" data-to="' + top.s + '">0</b>' : `<span style="color:${top.p.css}">${top.p.name}</span> WINS <b class="cnt" data-to="${top.s}">0</b>`;
    $('end').querySelector('.e-kicker').textContent = newBest ? 'NEW PERSONAL BEST' : solo ? 'FINAL SCORE' : 'FINAL';
    $('end').classList.toggle('best', newBest);
    // per bowler: strikes, spares, open frames, longest run of strikes
    const stats = G.players.map(p => {
      const fr = SC.frames(p.rolls), mk = SC.marks(p.rolls).flat();
      let run = 0, cur = 0; for (const r of p.rolls) { cur = r === 10 ? cur + 1 : 0; run = Math.max(run, cur); }
      return { x: mk.filter(m => m === 'X').length, sp: mk.filter(m => m === '/').length, open: fr.filter((f, i) => i < 9 && !f.strike && !f.spare).length + (fr[9] && !fr[9].strike && !fr[9].spare ? 1 : 0), run };
    });
    const chips = (st, p) => `<div class="e-stats">${solo ? '' : `<span class="e-who" style="color:${p.css}">${p.name}</span>`}<span><b>${st.x}</b> strike${st.x === 1 ? '' : 's'}</span><span><b>${st.sp}</b> spare${st.sp === 1 ? '' : 's'}</span><span><b>${st.open}</b> open</span>${st.run >= 2 ? `<span class="hot"><b>${st.run}</b> in a row</span>` : ''}</div>`;
    $('end-body').innerHTML = sheetHTML(true, { stagger: true, win: solo ? -1 : top.i, count: true })
      + (solo ? chips(stats[0], G.players[0]) : ranked.map(r => chips(stats[r.i], r.p)).join(''))
      + (!newBest && best && G.kind === 'game' ? `<div class="e-best">Best ${best}</div>` : '');
    $('hud').classList.add('hidden');
    $('end').classList.remove('hidden');
    // the totals count up as the frames land
    const t0 = performance.now(), els = [...$('end').querySelectorAll('.cnt')];
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0 - 350) / 1300), e = 1 - Math.pow(1 - Math.max(0, k), 3);
      els.forEach(el => { el.textContent = Math.round(+el.dataset.to * e); });
      if (k < 1 && !$('end').classList.contains('hidden')) requestAnimationFrame(tick);
    };
    tick();
    if (newBest || top.s >= 200) embersFX(0, 0.1, -18.6, 160);
  }

  // ------------------------------------------------------------------ HUD
  /** The sheet: per frame the ball boxes (only the last one boxed, as on a real sheet) and the
   * running total; frames still to come show their number, faintly; the newest mark pops in. */
  function sheetHTML(all, opts) {
    opts = opts || {};
    return G.players.map((p, pi) => {
      const mk = SC.marks(p.rolls), sc = SC.score(p.rolls), nx = SC.next(p.rolls);
      const isCur = pi === G.cur && !all;
      const fresh = isCur && sheetFresh.p === pi ? sheetFresh : null;
      let h = `<div class="row-p${pi === G.cur || all ? ' cur' : ''}${opts.win === pi ? ' win' : ''}" style="--pc:${p.css}"><div class="nm">${p.name}</div>`;
      for (let f = 0; f < 10; f++) {
        const m = mk[f] || [];
        const slots = f < 9 ? 2 : 3;
        let bl = '';
        for (let s = 0; s < slots; s++) {
          const v = f < 9 && m.length === 2 && m[0] === '' ? (s === 1 ? 'X' : '') : (m[s] || '');
          const pop = fresh && fresh.f === f && fresh.s === (f < 9 && v === 'X' ? 1 : s) && v !== '' ? ' pop' : '';
          bl += `<span class="${v === 'X' ? 'x' : v === '/' ? 's' : v === '-' ? 'm' : ''}${pop}">${v === '/' ? '' : v}</span>`;
        }
        const now = pi === G.cur && !nx.over && nx.frame === f && !all;
        const tot = sc.cumulative[f];
        const delay = opts.stagger ? ` style="animation-delay:${(pi * 10 + f) * 45}ms"` : '';
        h += `<div class="fr${f === 9 ? ' ten' : ''}${now ? ' now' : ''}${tot == null && !m.length ? ' empty' : ''}"${delay}><div class="bl">${bl}</div><div class="tot">${tot == null ? (m.length ? '' : `<i>${f + 1}</i>`) : tot}</div></div>`;
      }
      return h + `<div class="sum">${opts.count ? '<b class="cnt" data-to="' + sc.total + '">0</b>' : sc.total}</div></div>`;
    }).join('');
  }
  let sheetFresh = {}, sheetRolls = '';
  function renderSheet() {
    // which ball box is new since the last render (it pops in)
    const p = curPlayer(), key = G.players.map(q => q.rolls.length).join(',');
    sheetFresh = {};
    if (p && key !== sheetRolls && p.rolls.length) {
      const fr = SC.frames(p.rolls), f = fr.length - 1;
      sheetFresh = { p: G.cur, f, s: fr[f].rolls.length - 1 };
    }
    sheetRolls = key;
    $('sheet').innerHTML = sheetHTML(false);
    layoutHUD();
  }
  /** The hint and toast sit under the sheet (out of the way of the arm and ball). */
  function layoutHUD() {
    const sh = $('sheet'), y = sh.offsetTop + sh.offsetHeight;
    $('hint').style.top = (y + 12) + 'px';
    $('toast').style.top = (y + 62) + 'px';
  }
  let pinsUp = null;
  function renderPins() {
    const el = $('pins');
    if (!el.children.length) {
      for (let n = 1; n <= 10; n++) { const i = document.createElement('i'); const s = P.pinSpot(n); i.style.left = (58 + s.x / 0.1524 * 14) + 'px'; i.style.top = (86 + (s.z - L.HEAD_Z) / 0.2639 * 23) + 'px'; el.appendChild(i); }
    }
    const up = new Set((G.sim ? G.sim.pins.filter(p => P.standing(p)) : []).map(p => p.n));
    [...el.children].forEach((i, k) => {
      const n = k + 1, wasUp = pinsUp ? pinsUp.has(n) : true;
      // a pin that fell on this ball flares before it goes dark
      if (pinsUp && wasUp && !up.has(n) && G.mode === 'rolling') { i.classList.remove('fell'); void i.offsetWidth; i.classList.add('fell'); }
      if (up.has(n)) i.classList.remove('fell');
      i.classList.toggle('down', !up.has(n));
    });
    pinsUp = up;
  }
  function showBallInfo(rb) {
    const el = $('ballinfo');
    const deg = rb.heading * 180 / Math.PI, revs = Math.abs(rb.sideRoll) * 60 / (2 * Math.PI);
    el.innerHTML = `<div class="bi-speed"><b>${(rb.speed * 3.6).toFixed(1)}</b><span>km/h</span><small>${(rb.speed * 2.237).toFixed(1)} mph</small></div>
      <span class="k">ANGLE</span><span class="v">${Math.abs(deg).toFixed(1)}° ${Math.abs(deg) < 0.05 ? '' : deg > 0 ? 'left' : 'right'}</span>
      <span class="k">SIDE ROLL</span><span class="v">${Math.round(revs)} rpm <small>${rb.twist > 0.5 ? 'hook left' : rb.twist < -0.5 ? 'hook right' : ''}</small></span>
      <span class="k">RELEASE</span><span class="v">board ${Math.round(boardAt(rb.pos.x))} <small>${(rb.pos.y - P.BALL.R).toFixed(2)} m up</small></span>
      <span class="k">AT ARROWS</span><span class="v wait" id="bi-arrows">&middot; &middot; &middot;</span>`;
    el.classList.remove('hidden', 'in'); void el.offsetWidth; el.classList.add('in');
  }
  let bannerT = 0, toastT = 0;
  function banner(main, sub, cls, dur, color) {
    const b = $('banner');
    b.className = ''; void b.offsetWidth;
    b.className = 'show ' + (cls || '');
    b.style.setProperty('--pc', color || '#ffb36b');
    b.querySelector('.b-main').textContent = main; b.querySelector('.b-sub').textContent = sub || '';
    bannerT = dur || 1.4;
  }
  function toast(html, dur) { const t = $('toast'); t.innerHTML = html; t.classList.add('show'); toastT = dur || 2; }
  function hint(html) { $('hint').innerHTML = html; }

  function panelMoment(word, run) { G.panelFx = { word, run: run || 0, k: 0, fr: 0 }; }
  /** Our masking panel playing the call (strike, spare): redrawn at 20 Hz from the game clock. */
  function updatePanel(dt) {
    const M = G.panelFx;
    if (!M) return;
    M.k += dt;
    const k = M.k, word = M.word;
    if (k > 3.2) { W.panel(null); G.panelFx = null; return; }
    if (M.fr++ % 3) return;   // 20 Hz is plenty for a distant panel
    W.panel((g, w, h) => {
      g.fillStyle = `rgba(10,6,14,${Math.min(0.75, k * 3)})`; g.fillRect(0, 0, w, h);
      const s = 1 + 0.25 * Math.exp(-k * 5) * Math.sin(k * 30);
      g.save(); g.translate(w / 2, h * 0.52); g.scale(s, s);
      g.font = `900 ${Math.round(h * 0.3)}px "Segoe UI", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const fit = Math.min(1, w * 0.84 / g.measureText(word).width); g.scale(fit, fit);
      const grd = g.createLinearGradient(0, -h * 0.15, 0, h * 0.15); grd.addColorStop(0, '#fff6e0'); grd.addColorStop(1, '#ff7a2f');
      g.shadowColor = 'rgba(255,120,40,0.9)'; g.shadowBlur = 30;
      g.fillStyle = grd; g.fillText(word, 0, 0);
      g.restore();
      // rays
      g.strokeStyle = `rgba(255,170,90,${0.5 * Math.max(0, 1 - k / 2)})`; g.lineWidth = 3;
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2 + k; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * h * 0.3, h * 0.52 + Math.sin(a) * h * 0.3); g.lineTo(w / 2 + Math.cos(a) * h * (0.4 + k * 0.4), h * 0.52 + Math.sin(a) * h * (0.4 + k * 0.4)); g.stroke(); }
    });
  }

  // ------------------------------------------------------------------ menus
  const menuOpen = () => !$('title').classList.contains('hidden') || !$('pause').classList.contains('hidden') || !$('end').classList.contains('hidden') || !$('phonepanel').classList.contains('hidden');
  function refreshOptions() {
    document.querySelector('[data-opt="players"] b').textContent = settings.players + (settings.players > 1 ? ' BOWLERS' : ' BOWLER');
    document.querySelector('[data-opt="hand"] b').textContent = settings.hand.toUpperCase();
    document.querySelector('[data-opt="ball"] b').textContent = settings.ball + ' LB';
    document.querySelectorAll('[data-opt="quality"] b').forEach(b => { b.textContent = settings.quality === 'auto' ? (qual.low ? 'AUTO · LOW' : 'AUTO') : settings.quality.toUpperCase(); });
    document.querySelectorAll('.vol-in').forEach(i => { i.value = settings.volume; i.style.setProperty('--v', settings.volume + '%'); });
    document.querySelectorAll('.vol-v').forEach(b => { b.textContent = settings.sound ? settings.volume + '%' : 'MUTED'; });
    document.querySelectorAll('.mus-in').forEach(i => { i.value = settings.music; i.style.setProperty('--v', settings.music + '%'); });
    document.querySelectorAll('.mus-v').forEach(b => { b.textContent = !settings.sound ? 'MUTED' : settings.music ? settings.music + '%' : 'OFF'; });
    document.querySelector('[data-opt="aim"] b').textContent = AIM_Q != null ? 'x' + AIM_Q : settings.aim === 'pro' ? 'PRO 1:1' : 'NORMAL';
    document.querySelector('[data-opt="bumpers"] b').textContent = settings.bumpers ? 'ON' : 'OFF';
  }
  // volume sliders (title and pause share the setting)
  document.addEventListener('input', e => {
    if (e.target.classList && e.target.classList.contains('mus-in')) { settings.music = +e.target.value; SFX.setMusic(settings.music / 100); saveSettings(); refreshOptions(); return; }
    if (!e.target.classList || !e.target.classList.contains('vol-in')) return;
    settings.volume = +e.target.value; settings.sound = settings.volume > 0 || settings.sound;
    SFX.setVolume(settings.volume / 100); SFX.setMuted(!settings.sound); saveSettings(); refreshOptions();
  });
  document.addEventListener('change', e => { if (e.target.classList && (e.target.classList.contains('vol-in') || e.target.classList.contains('mus-in'))) SFX.ui('move'); });
  document.addEventListener('click', e => {
    BW.Audio.unlock();
    if (!e.target.closest('[data-act="connect"]')) mc.enableRumble && mc.enableRumble();
    // with the phone in hand, a click hurries the roll / result along (the mouse stand-in does
    // that with its own button press)
    if (IN.S.padOn && !e.target.closest('[data-act],[data-opt],.vol')) skip('click');
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      const k = opt.dataset.opt;
      if (k === 'players') settings.players = settings.players % 4 + 1;
      if (k === 'hand') settings.hand = settings.hand === 'right' ? 'left' : 'right';
      if (k === 'sound') { settings.sound = !settings.sound; SFX.setMuted(!settings.sound); }
      if (k === 'ball') settings.ball = settings.ball === 16 ? 15 : 16;
      if (k === 'quality') {
        settings.quality = { auto: 'high', high: 'low', low: 'auto' }[settings.quality] || 'auto';
        qual.auto = settings.quality === 'auto'; qual.slowS = 0; setQuality(settings.quality === 'low');
      }
      if (k === 'aim') { settings.aim = settings.aim === 'pro' ? 'normal' : 'pro'; applyAim(); }
      if (k === 'bumpers') { settings.bumpers = !settings.bumpers; if (W && G.mode === 'title') W.setBumpers(settings.bumpers); }
      saveSettings(); refreshOptions(); SFX.ui('move');
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    SFX.ui('ok');
    if (a === 'connect') {
      // Chrome's device chooser, asked explicitly (mimic.js shows it at most once otherwise);
      // once granted, mimic.js asks the phone for motion every second and Grip switches
      $('pp-why').textContent = 'Waiting for Chrome…';
      Promise.resolve(mc.enableRumble({ ask: true })).then(ok => {
        $('pp-why').textContent = ok ? 'Connected. Waiting for motion from the phone…' : 'Not connected. Pick Mimic in the popup and press Connect.';
      });
      return;
    }
    if (a === 'usemouse') { G.mouseOK = true; return; }
    if (a === 'game' || a === 'practice') startGame(a);
    else if (a === 'resume') setPause(false);
    else if (a === 'restart') { setPause(false); startGame(G.kind); }
    else if (a === 'rack') { setPause(false); if (G.mode === 'ready') { newRack(); } }
    else if (a === 'lineup') { setPause(false); beginLineup(); }
    else if (a === 'lineup-skip') { if (G.lineup) lineupFinish(settings.hold != null ? settings.hold : K.REF.HOLD * 180 / Math.PI, true); }
    else if (a === 'quit') toTitle();
    else if (a === 'again') startGame(G.kind);
  });
  Object.assign(window.__embUI, { startGame, toTitle, showEnd, banner, setPause: on => setPause(on) });
  function setPause(on) {
    if (G.mode === 'title' || G.mode === 'loading') return;
    G.paused = on;
    $('pause').classList.toggle('hidden', !on);
  }
  addEventListener('keydown', e => {
    BW.Audio.unlock();
    if (e.code === 'Escape') setPause(!G.paused);
    if (e.code === 'KeyM') { settings.sound = !settings.sound; SFX.setMuted(!settings.sound); saveSettings(); refreshOptions(); }
  });

  // ------------------------------------------------------------------ camera
  function setCam(mode, blend) {
    G.camFrom = { pos: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov };
    G.camMode = mode; G.camBlend = 0; G.camBlendDur = blend || 0.6;
  }
  const tmpM = new T.Matrix4(), tmpV = new T.Vector3(), tmpQ = new T.Quaternion();
  function camTarget(dt) {
    const out = { pos: new T.Vector3(), look: new T.Vector3(), fov: CAM.FOV };
    const b = G.sim && G.sim.ball;
    if (G.camMode === 'title') {
      // low down the lane, drifting; the lit rack held right of the menu (the look point leads it)
      const t = G.t * 0.07;
      out.pos.set(-0.75 + Math.sin(t) * 0.45, 0.62 + Math.sin(t * 1.3) * 0.08, -13.4 + Math.sin(t * 0.7) * 0.9);
      const dx = -out.pos.x, dz = -18.55 - out.pos.z, k = titleLead();
      out.look.set(dz * k, 0.34, -18.55 - dx * k); out.fov = 38;
    } else if (G.camMode === 'bowler') {
      const sx = G.stance, bo = G.bodyOff;
      out.pos.set(sx + side() * 0.06 + bo.x, CAM.Y + bo.y * 0.6, BODY.SHOULDER_Z + BODY.ROOM + CAM.BACK + bo.z);
      out.look.set(sx * 0.35 + bo.x * 0.5, CAM.LOOKY, CAM.LOOKZ + bo.z * 0.3);
      if (Q.get('cam') === 'side') { out.pos.set(sx + 1.6, 0.8, 0.2); out.look.set(sx + 0.17, 0.5, 0.3); }
    } else if (G.camMode === 'follow' && b) {
      const z = Math.max(b.x[2], -14.5);
      out.pos.set(b.x[0] * 0.55, 0.62 + Math.max(0, z + 14) * 0.02, z + 2.4);
      out.look.set(b.x[0] * 0.5, 0.12, z - 6);
      out.fov = 46;
    } else if (G.camMode === 'celebrate') {
      // an arc low around the swept deck, then a crane up to the masking panel playing the call;
      // a turkey or better swings wider, from the far side
      const t = G.celebT || 0, big = (G.celebRun || 0) >= 3;
      // (the camera backs out before it tilts up, or the masking unit's underside fills the frame)
      const a = smooth(t / (big ? 1.5 : 1.15)), c = smooth((t - (big ? 1.2 : 0.9)) / 0.9), u = smooth((t - (big ? 1.5 : 1.2)) / 0.85);
      const th = big ? lerp(-0.34, 0.2, a) : lerp(0.24, -0.04, a), R = lerp(2.25, 1.95, a);
      const ax = Math.sin(th) * R, az = -18.6 + Math.cos(th) * R, ay = lerp(0.3, big ? 0.62 : 0.5, a);
      out.pos.set(lerp(ax, 0, c), lerp(ay, 0.92, c), lerp(az, -13.9, c));
      out.look.set(0, lerp(0.22, 1.22, u), lerp(-18.6, -17.6, u));
      out.fov = lerp(big ? 50 : 46, 44, u);
    } else if (G.camMode === 'deck') {
      const bx = b ? clamp(b.x[0], -0.4, 0.4) : 0;
      // low, just off the lane's right edge, easing in toward the deck as the pins fly
      const k = Math.min(1, G.deckT * 0.35);
      out.pos.set(0.62 + bx * 0.2, 0.34 - k * 0.04, -15.9 - k * 0.5);
      out.look.set(bx * 0.25 - 0.05, 0.2, -18.7);
      out.fov = 42;
    } else {
      out.pos.copy(camera.position); camera.getWorldDirection(tmpV); out.look.copy(camera.position).add(tmpV);
    }
    return out;
  }
  /** How far the title camera looks left of the rack so the rack sits centred in the screen space
   * right of the how-to card (tan of the angle; measured once per window size). */
  let leadW = 0, leadK = 0.42;
  function titleLead() {
    if (leadW === innerWidth * 10000 + innerHeight) return leadK;
    const card = document.querySelector('#title .t-right'), r = card && card.getBoundingClientRect();
    if (!r || !r.width) { if (r) { leadW = innerWidth * 10000 + innerHeight; leadK = 0.3; } return leadK; }
    const target = (r.right / innerWidth + 1) / 2, ndc = 2 * target - 1;
    leadW = innerWidth * 10000 + innerHeight;
    leadK = ndc * Math.tan(38 * Math.PI / 360) * innerWidth / innerHeight;
    return leadK;
  }
  function updateCamera(dt) {
    const tg = camTarget(dt);
    tmpM.lookAt(tg.pos, tg.look, new T.Vector3(0, 1, 0));
    tmpQ.setFromRotationMatrix(tmpM);
    if (G.camBlend < 1 && G.camFrom) {
      G.camBlend = Math.min(1, G.camBlend + dt / G.camBlendDur);
      const k = smooth(G.camBlend);
      camera.position.lerpVectors(G.camFrom.pos, tg.pos, k);
      camera.quaternion.slerpQuaternions(G.camFrom.q, tmpQ, k);
      camera.fov = lerp(G.camFrom.fov, tg.fov, k);
    } else {
      camera.position.copy(tg.pos); camera.quaternion.copy(tmpQ); camera.fov = tg.fov;
    }
    if (G.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake;
      G.shake = Math.max(0, G.shake - dt * 0.12);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ the arm
  /** The phone's angular velocity now (lane frame), for the swing plane of the drawn arm. */
  function swingW() {
    const ss = IN.track.samples;
    if (!IN.S.padOn || ss.length < 4) return null;
    const om = K.fitOmega(ss, ss[ss.length - 1].t, 40, 0);
    if (!om) return null;
    const g = (G.mode === 'held' || G.mode === 'released') && G.grip ? G.grip : liveGrip();
    return K.toLane(g.ref, om.w);
  }
  /** The hand now: in the throw's lane frame while the ball is in hand, else the one a grip would take. */
  function currentRd() {
    const g = (G.mode === 'held' || G.mode === 'released') && G.grip ? G.grip : liveGrip();
    return K.handRot(IN.S.q, g.ref);
  }
  function updateArm(dt) {
    if (!arm || !arm.group.visible) return;
    const Rd = currentRd();
    if (G.stanceT < 1) { G.stanceT = Math.min(1, G.stanceT + dt / 0.35); G.stance = lerp(G.stanceFrom, G.stanceTo, smooth(G.stanceT)); }
    const sh = shoulder().add(G.bodyOff);
    // the forearm and hand turn with the phone; the hand sits where the arm model (with the
    // elbow's slight bend) puts it: shift the group by the bend
    // the hand in the swing plane once the arm swings, as at the release (kin.js planeArm)
    const r0 = K.armVec(Rd), straight = K.rotate(Rd, { x: 0, y: -K.ARM.L, z: 0 });
    const r = K.planeArm(r0, swingW());
    arm.group.position.set(sh.x + r.x - straight.x, sh.y + r.y - straight.y, sh.z + r.z - straight.z);
    arm.group.quaternion.set(Rd.x, Rd.y, Rd.z, Rd.w);
    arm.group.updateMatrixWorld(true);
    // the ball: waiting on the return, flying into the hand, in the hand, or in play
    const inHand = G.mode === 'held' || (G.mode === 'released' && !G.sim.ball);
    if (G.mode === 'ready' || G.mode === 'reset' || G.mode === 'dropped') {
      W.ball.position.copy(RETURN_SPOT);
      W.ball.visible = G.mode !== 'dropped' || !G.sim.ball;
      arm.setGrip(lerp(0.15, 0.3, 0.5 + 0.5 * Math.sin(G.t * 1.3)));
    }
    spot.visible = false;   // (pick-your-spot is gone: on real data it moved you by the forearm's angle in the stance)
    if (inHand || G.pendingRel) {
      const target = arm.ballAnchor.getWorldPosition(tmpV);
      if (G.grabT < 1) {
        G.grabT = Math.min(1, G.grabT + dt / 0.2);
        const k = smooth(G.grabT);
        W.ball.position.lerpVectors(G.ballFrom, target, k);
        W.ball.position.y += Math.sin(k * Math.PI) * 0.12;
        arm.setGrip(lerp(0.3, 1, k));
      } else {
        W.ball.position.copy(target);
        arm.setGrip(1);
      }
      arm.ballAnchor.getWorldQuaternion(W.ball.quaternion);
      W.ball.quaternion.multiply(tmpQ.setFromEuler(new T.Euler(0, 0, -Math.PI / 2)));
      W.ball.visible = true;
    }
  }

  // ------------------------------------------------------------------ physics events -> juice
  function onEvents(evs) {
    for (const e of evs) {
      const who = e.a && e.a.kind;
      if (e.kind === 'ball-pin' && !G.firstHit) {
        G.firstHit = true; G.firstHitT = G.t;
        const sp = Math.hypot(...G.sim.ball.v);
        if (sp > 5) { G.timeScale = 0.55; G.slowUntil = G.t + 0.3; }
        G.shake = 0.012 + sp * 0.003;
        mc.rumble(clamp(sp / 9, 0.3, 0.95), 110, 0);
        setCam('deck', 0.25);
      }
      if (e.kind === 'ball-pin' || e.kind === 'pin-pin') impactFX(e, e.kind === 'ball-pin' && !G.crashPlayed);
      else if (e.kind === 'floor' && e.speed > 1.1 && e.z < L.HEAD_Z + 1.2) dustFX(e);
      if (e.kind === 'floor' && who === 'ball' && e.speed < 0.6) continue;
      // the big crash is the ball's first hit; later ball-pin contacts are knocks
      const kind = e.kind === 'ball-pin' && G.crashPlayed ? 'pin-pin' : e.kind;
      if (e.kind === 'ball-pin') G.crashPlayed = true;
      SFX.impact(kind, e.speed, e.x, e.y, e.z, e.b ? 'pin' : who);
      if (e.kind === 'floor' && who === 'ball' && e.speed > 1.2 && G.mode === 'rolling') mc.rumble(clamp(e.speed / 5, 0.2, 0.8), 60, 0);
      // a ball landing (a lofted throw, a drop, a bounce): the camera feels the thud, more the
      // harder it lands and the closer the camera is
      if (e.kind === 'floor' && who === 'ball' && e.speed > 0.9) {
        const near = clamp(1.6 - Math.hypot(camera.position.x - e.x, camera.position.y - e.y, camera.position.z - e.z) / 6, 0.25, 1);
        G.shake = Math.max(G.shake, Math.min(0.03, 0.0035 * e.speed * near));
      }
    }
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const rdt = Math.min(0.05, (now - last) / 1000); last = now;
    G.fps.n++; G.fps.t += rdt;
    if (G.fps.t >= 1) {
      G.fps.v = G.fps.n / G.fps.t; G.fps.n = 0; G.fps.t = 0;
      // AUTO quality: 4 s under 45 fps while bowling (not in menus, not hidden) -> LOW, once
      const playing = G.mode !== 'title' && !G.paused && !document.hidden;
      qual.slowS = qual.auto && !qual.low && playing && G.fps.v < 45 ? qual.slowS + 1 : 0;
      if (qual.slowS >= 4) { setQuality(true); refreshOptions(); toast('Quality lowered to keep it smooth <small>(Quality: AUTO)</small>', 2.4); if (window.MimicRec) MimicRec.event('quality', { low: true, fps: +G.fps.v.toFixed(1) }); }
    }
    mc.update(now);
    IN.frame(now);
    SFX.frame();
    if (cursor) cursor.update();
    statusPill();
    G.t += rdt;

    // optional re-align (Grip: CENTRE / Vol Up hold, Wand: Center): where the forearm points now
    // is straight down the lane. Not needed: every throw takes its reference at the grip. The
    // 4 ms sampler's own record of the centre bit counts too (a pulse between two frames).
    const alignDown = mc.isDown('center') || IN.takeCenter();
    if (alignDown && !G.alignHeld && IN.S.padOn) {
      const a = K.armHeading(IN.S.q);
      if (a.tilt > K.REF.TILT_MIN) {
        G.refBase = a.yaw; G.aligned = true;
        toast('Aligned: straight ahead is where your forearm points', 1.8); SFX.ui('align'); mc.rumble(0.3, 40, 0);
      } else toast('To re-align, point your forearm down the lane (phone top forward) and press again', 2.6);
      if (window.MimicRec) MimicRec.event('align', { q: IN.S.q, yaw: +(a.yaw * 180 / Math.PI).toFixed(1), tilt: +(a.tilt * 180 / Math.PI).toFixed(0), used: a.tilt > K.REF.TILT_MIN });
    }
    G.alignHeld = alignDown;
    if (mc.pressed('b') && G.mode !== 'title') { if (!skip('b')) setPause(!G.paused); }

    const evs = IN.drain();
    if (!G.paused && !menuOpen()) {
      for (const e of evs) {
        if (e.kind === 'press' && G.mode === 'ready') { if (G.waitPress) { G.waitPress = false; } else if (inputState() !== 'phone-mouse') grab(e.t); }
        if (e.kind === 'press') skip('press');   // hurry a roll / result / reset along
        if (e.kind === 'release' && G.mode === 'ready') G.waitPress = false;
        if (e.kind === 'release' && G.mode === 'held') { G.mode = 'released'; scheduleRelease(e.t); }
      }
      if (G.waitPress && !IN.S.a) G.waitPress = false;
    }
    if (G.pendingRel && (IN.lastT() >= G.pendingRel.t + (IN.S.padOn ? 40 : 60) || now - G.pendingRel.at > 110)) finishRelease();

    // the body tracker follows the phone while the ball is in your hand
    if (K.BODY.USE && (G.mode === 'held' || G.mode === 'released')) {
      IN.updateBody(G.grip ? G.grip.ref : null);
      if (IN.body.on) G.bodyOff.copy(clampBody(K.bodyAt(IN.body, Infinity).p));
    } else if (G.mode === 'ready' || G.mode === 'reset') {
      G.bodyOff.multiplyScalar(1 - ease(5, rdt));     // walk back to your spot
    }

    // simulation: a short slow motion at a big first hit; slow balls far from the pins and dead
    // gutter balls fast-forward (up to 3x, eased) so nobody waits on a crawl
    if (G.t > G.slowUntil) G.timeScale = Math.min(1, G.timeScale + rdt * 3);
    G.ff += (ffTarget() - G.ff) * ease(4, rdt);
    const dt = G.paused ? 0 : rdt * G.timeScale * G.ff;
    if (W && !G.paused) {
      if (G.mode === 'rolling' || G.mode === 'result' || G.mode === 'dropped') {
        const evts = P.advance(G.sim, dt, 90);
        onEvents(evts);
        syncPins();
      }
      if (G.mode === 'rolling') { updateRolling(dt, rdt); if (G.lineup && G.mode === 'rolling' && G.rollT > 1.3) lineupNext(); }
      else if (G.mode === 'result') {
        G.resultT += rdt;
        const hold = G.result && G.result.celebrate ? (G.result.strike ? (G.celebRun >= 3 ? 2.5 : 2.15) : 1.9) : 0.35;
        if (G.resultT > hold && (deckSettled() || G.resultT > hold + 1.5)) startReset();
      }
      else if (G.mode === 'reset') updateReset(rdt * (G.reset && G.reset.fast ? 2.5 : 1));
      else if (G.mode === 'dropped') { G.resultT += rdt; if (G.resultT > 1.1) { G.sim.ball = null; toReady(); } }
      // the ball in play
      const b = G.sim.ball;
      if (b && (G.mode === 'rolling' || G.mode === 'result' || G.mode === 'dropped')) {
        W.ball.position.set(b.x[0], b.x[1], b.x[2]);
        W.ball.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
        W.ball.visible = b.gone !== 'back';
        SFX.roll(Math.hypot(b.v[0], b.v[2]), b.x[0], b.x[1], b.x[2], !b.gone && b.x[1] < P.BALL.R + 0.012);
        if (!b.gone && !b.gutter && b.x[1] < P.BALL.R + 0.01 && b.x[2] < -0.3 && b.x[2] > L.HEAD_Z - 0.3 && Math.abs(b.x[0]) < L.HALF) fx.track.add(b.x[0], b.x[2], G.t);
      } else SFX.roll(0, 0, 0, 0, false);
      if (G.mode === 'title') { W.ball.visible = false; }
      updateArm(rdt);
      fx.update(dt);
      updatePanel(rdt);
      if (G.mode === 'deck') G.deckT += dt;
      G.deckT = (G.deckT || 0) + dt; G.celebT = (G.celebT || 0) + rdt;
      updateCamera(rdt);
      SFX.setListener({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
      post.uniforms.flash.value = Math.max(0, post.uniforms.flash.value - rdt * 2.2);
      // shadow maps only re-render when something in them moves: the deck's while pins and ball
      // are in play (or just racked), the bowler's key light while you are at the line
      const still = G.mode === 'ready' || G.mode === 'held' || G.mode === 'released' || G.mode === 'title';
      // (from the strike camera the pins are small: their shadows every other frame)
      W.deck.shadow.needsUpdate = (!still && (G.camMode !== 'celebrate' || (G.fps.n & 1) === 0)) || G.deckShadowFrames-- > 0;
      W.key.shadow.needsUpdate = G.camMode === 'bowler' || G.camBlend < 1;
      if (Q.get('refl') !== '0') W.renderReflection(camera);
      post.render(W.scene, camera, G.t);
    }
    if (bannerT > 0) { bannerT -= rdt; if (bannerT <= 0) $('banner').classList.remove('show'); }
    if (toastT > 0) { toastT -= rdt; if (toastT <= 0) $('toast').classList.remove('show'); }
  }

  /** How fast the ball's world runs (on top of slow motion): 1 to watch the release and the hit;
   * a slow ball far from the pins up to 3x (3.5x below 2 m/s), easing back to 1 about 0.6 s of
   * real time before it reaches them; a dead gutter ball or one past the pins untouched 3x;
   * 3.5x after a skip press. Smoothed by the caller. */
  function ffTarget() {
    const b = G.sim && G.sim.ball;
    if (G.mode !== 'rolling' || !b || b.gone || G.firstHit) return 1;
    if (G.skipFF) return 3.5;
    if (b.gutter && !b.hitPins) return 3;                  // it cannot reach a pin now
    const toPins = b.x[2] - L.HEAD_Z;
    if (toPins < -0.9) return 3;                            // past the pins, nothing touched
    if (G.rollT < 0.5) return 1;
    const sp = Math.hypot(b.v[0], b.v[2]);
    const slow = clamp((4.5 - sp) / 3, 0, 1), max = sp < 2 ? 3.5 : 3;
    const near = clamp((toPins - Math.max(0.6, sp * 0.6)) / 1.5, 0, 1);
    return 1 + (max - 1) * slow * near;
  }

  /** a / b / click during the roll, the result or the reset: hurry it along. True if used. */
  function skip(src) {
    if (G.paused || menuOpen()) return false;
    if (G.mode === 'rolling' && G.rollT > 0.4) {
      G.skipFF = true;
      if (G.firstHit) G.endT = Math.min(G.endT === null ? G.t : G.endT, G.t - 0.85);   // after the hit: call it
      return true;
    }
    if (G.mode === 'result') { startReset(); if (G.reset) G.reset.fast = true; return true; }
    if (G.mode === 'reset' && G.reset) { G.reset.fast = true; return true; }
    if (G.mode === 'dropped') { G.resultT = 99; return true; }
    return false;
  }

  function updateRolling(dt, rdt) {
    const b = G.sim.ball;
    G.rollT += dt;
    if (!b) return;
    if (G.camMode === 'bowler' && G.rollT > 0.45 && b.x[2] < -1.5) { setCam('follow', 0.7); G.deckT = 0; }
    if (G.camMode === 'follow' && b.x[2] < -14.2 && !G.firstHit && !(b.gutter && !b.hitPins)) { setCam('deck', 0.8); G.deckT = 0; }
    if (G.atArrows === null && b.x[2] < -4.57) { G.atArrows = boardAt(b.x[0]); const el = $('bi-arrows'); if (el) { el.textContent = 'board ' + Math.round(G.atArrows); el.classList.add('got'); } }
    if (b.gutter && !G.gutterSaid) { G.gutterSaid = true; G.gutterT = G.t; SFX.gutter(b.x[0], b.x[1], b.x[2]); }
    if (G.atPins === null && b.x[2] < L.HEAD_Z + 0.25) G.atPins = { x: b.x[0], board: boardAt(b.x[0]), t: G.rollT };
    const C = G.cyc;
    if (C && b.gutter && !C.gutter) C.gutter = performance.now();
    if (C && !C.pit && (b.gone === 'pit' || b.x[2] < L.PIT_Z - 0.05)) C.pit = performance.now();
    // dropped behind the line / rolled back
    if (b.gone === 'back' || (b.x[2] > -0.05 && Math.hypot(...b.v) < 0.12 && G.rollT > 0.6)) { G.droppedT += dt; if (G.droppedT > 0.4 || b.gone === 'back') { dropped(); return; } }
    if (b.x[2] > 0.3 && b.v[2] > 0.05) { G.droppedT += dt * 0.5; }
    // the shot is over when the ball is in the pit, has stopped, or is a gutter ball that can no
    // longer touch a pin; then the pins get at most 1.2 s (real time) to show their fate
    const inPit = b.gone === 'pit' || b.x[2] < L.PIT_Z - 0.05;
    if (inPit && !G.pitSaid) { G.pitSaid = true; SFX.pit(b.x[0], b.x[1], b.x[2]); }
    const stopped = !b.gone && b.x[2] < 0 && (b.asleep || Math.hypot(...b.v) < 0.05);
    const deadGutter = b.gutter && !b.hitPins && (b.x[2] < L.HEAD_Z + 1.5 || G.t - G.gutterT > 1.2);
    if (G.endT === null && (inPit || stopped || deadGutter)) { G.endT = G.t; if (C) C.end = performance.now(); }
    if (G.endT !== null) {
      const since = G.t - G.endT;
      const minWait = G.firstHit ? 0.35 : 0.15;
      if ((since > minWait && P.decided(G.sim)) || since > 1.2) evaluate(b.gutter && !b.hitPins ? 'gutter' : 'count');
    }
    if (G.rollT > 30) evaluate('count');
  }

  const HINT_WHY = {
    'silent-pad': 'Seen: the Mimic gamepad is connected but sends no motion.',
    hid: 'Seen: your phone is paired with this site but sends no motion.',
  };
  function statusPill() {
    const st = inputState(), on = st === 'motion';
    // the sample rate is a debugging aid only (?debug=1)
    const txt = on ? `Phone · ${mc.mode === 'grip' ? 'Grip' : 'Wand'}${DEBUG ? ` · ${Math.round(IN.S.hz)} Hz` : ''}`
      : st === 'phone-mouse' ? 'Phone connected · no motion' : 'Mouse · fallback, no phone';
    for (const id of ['status', 'title-ctrl']) {
      const el = $(id); if (!el) continue;
      el.classList.toggle('on', on); el.classList.toggle('warn', st === 'phone-mouse');
      const s = el.querySelector('span'); if (s.textContent !== txt) s.textContent = txt;
    }
    const web = on && mc.mode === 'grip' && mc.via === 'browser';   // browser phone: on-screen HOLD / B / CENTRE
    document.querySelectorAll('.k-hold').forEach(k => { k.textContent = !on ? 'left mouse' : mc.mode === 'grip' ? mc.keyName('a') : 'A'; });
    document.querySelectorAll('.k-align').forEach(k => { k.textContent = !on ? 'C' : mc.mode === 'grip' ? (web ? 'CENTRE' : 'Vol Up') : 'Center'; });
    document.querySelectorAll('.k-alignv').forEach(k => { k.textContent = web ? 'press' : 'hold'; });
    // the how-to table's Grip column: app volume keys, or a browser phone's on-screen buttons
    document.querySelectorAll('[data-web]').forEach(k => {
      if (k.dataset.app == null) k.dataset.app = k.innerHTML;
      const h = web ? k.dataset.web : k.dataset.app; if (k.innerHTML !== h) k.innerHTML = h;
    });
    // a phone that is here but sends mouse: say so, do not bowl with the stand-in
    const pp = $('phonepanel'), show = (st === 'phone-mouse' || window.__embUI.forcePhonePanel) && G.mode !== 'loading';
    if (pp.classList.contains('hidden') === show) {
      pp.classList.toggle('hidden', !show);
      if (show) { $('pp-why').textContent = HINT_WHY[IN.S.phoneHint] || ''; if (G.mode === 'held') { G.mode = 'ready'; K.bodyStop(IN.body); } }
    }
    // with the phone in hand there is no cursor (it comes back if the real mouse moves)
    const noCursor = on && performance.now() - IN.mouse.movedT > 1500;
    if (document.body.classList.contains('nocursor') !== noCursor) document.body.classList.toggle('nocursor', noCursor);
  }
})();
