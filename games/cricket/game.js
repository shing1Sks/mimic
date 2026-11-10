/*
 * Willowlight - game flow: seats and roles, the delivery (aim, run-up, release), the stroke,
 * fielding and running, the scorebook, cameras, replays, HUD, menus, lobby, CPU players.
 *
 * Both players face the TV. The camera sits behind the batter, so the batter's phone is the
 * world 1:1 (room = world) and the bowler bowls "into the screen": his room is the world
 * mirrored front to back (bowl.js), which keeps everything he does in screen terms.
 */
(function () {
  'use strict';
  const CK = window.CK, PH = CK.Phys, BO = CK.Bowl, BA = CK.Bat, FI = CK.Field, MA = CK.Match, LB = CK.Lobby;
  const AU = CK.Audio, SFX = AU.SFX;
  const T = THREE;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const deg = Math.PI / 180;

  // ---------------------------------------------------------------------------------
  // Settings (persisted)
  const OPTS = {
    overs: { label: 'OVERS', vals: [1, 2, 3, 5], names: ['1 · SUPER OVER', '2 EACH', '3 EACH', '5 EACH'], def: 1 },
    wkts: { label: 'WICKETS', vals: [2, 3, 5, 10], def: 1 },
    timing: { label: 'TIMING WINDOW', vals: ['EASY', 'NORMAL', 'PRO'], def: 1 },
    control: { label: 'BOWLING CONTROL', vals: ['EASY', 'NORMAL', 'PRO'], def: 1 },
    aim: { label: 'BOWLING AIM SPOT', vals: ['ON', 'OFF'], def: 0 },
    power: { label: 'BAT POWER', vals: ['SOFT', 'NORMAL', 'BIG'], def: 1 },
    // phone -> browser (Bluetooth) plus screen -> eyes: a swing timed to what you see arrives this late
    lag: { label: 'SWING DELAY FIX', vals: [0, 30, 60, 90, 120], def: 2 },
    hand0: { label: 'P1 PLAYS', vals: ['RIGHT-HANDED', 'LEFT-HANDED'], def: 0 },
    hand1: { label: 'P2 PLAYS', vals: ['RIGHT-HANDED', 'LEFT-HANDED'], def: 0 },
    cpu: { label: 'COMPUTER', vals: ['CLUB', 'PRO'], def: 0 },
    replays: { label: 'REPLAYS', vals: ['ON', 'OFF'], def: 0 },
    sound: { label: 'SOUND', vals: ['ON', 'OFF'], def: 0 },
    vol: { label: 'VOLUME', vals: [1, 0.8, 0.6, 0.4, 0.2], def: 0 },
    gfx: { label: 'GRAPHICS', vals: ['AUTO', 'HIGH', 'LOW'], def: 0 },
  };
  const settings = {};
  Object.keys(OPTS).forEach(k => { settings[k] = OPTS[k].def; });
  try { Object.assign(settings, JSON.parse(localStorage.getItem('willowlight.settings') || '{}')); } catch (e) { /* blocked */ }
  Object.keys(OPTS).forEach(k => { settings[k] = clamp(settings[k] | 0, 0, OPTS[k].vals.length - 1); });
  const saveSettings = () => { try { localStorage.setItem('willowlight.settings', JSON.stringify(settings)); } catch (e) { /* blocked */ } };
  const opt = k => OPTS[k].vals[settings[k]];

  // ---------------------------------------------------------------------------------
  // Controllers and seats
  const mc = new MimicController();
  const slotCtrls = [];
  function slotCtrl(n) { if (!slotCtrls[n]) slotCtrls[n] = new MimicController({ slot: n }); return slotCtrls[n]; }
  class KeyPad extends MimicController { _findPad() { return null; } }
  let keyCtrl = null;
  const isPhone = c => !!c && c.connected && c.source === 'phone';
  const ctrlMode = c => (c && c.source === 'phone' ? (c.mode || 'wand') : 'mouse');
  /** The HOLD key in this phone's own words (app Grip: Vol Down; browser phone: HOLD; Wand: A). */
  const keyA = c => (ctrlMode(c) === 'mouse' ? 'click / Space' : c.keyName('a'));
  const keyB = c => (ctrlMode(c) === 'mouse' ? 'Esc' : c.keyName('b'));
  const keyC = c => (ctrlMode(c) === 'mouse' ? 'C' : ctrlMode(c) === 'grip' && c.via !== 'browser' ? 'CENTRE (or hold Vol Up)' : c.keyName('center'));
  function joinKey() {
    const pads = CK.Input.motionPads();
    const web = pads.some(p => /mimic web/i.test(p.id)), app = pads.some(p => !/mimic web/i.test(p.id));
    return web && app ? 'Vol Down / HOLD' : web ? 'HOLD' : 'Vol Down';
  }

  const KITS = [
    { body: 'm', shirt: 0x149b8f, pants: 0x16233a, skin: 0xd9a273, hair: 0x1e140c, helmet: 0x16233a, gloves: 0xf2f2f2, pads: true },
    { body: 'm', shirt: 0xc23b4e, pants: 0x2a1622, skin: 0x8d5524, hair: 0x111111, helmet: 0x6e1f2c, gloves: 0xf2f2f2, pads: true },
  ];
  const TEAM_COL = ['#2fd3c3', '#ff6b7e'];
  /** seats[i]: { idx, name, kind: 'phone' | 'mouse' | 'cpu', mc, input }. */
  const seats = [{ idx: 0, name: 'P1', kind: 'mouse', mc, input: null }, { idx: 1, name: 'P2', kind: 'cpu', mc: null, input: null }];
  const sideOf = i => (settings['hand' + i] === 1 ? -1 : 1);       // batting: +1 right-handed
  function setSeat(i, kind, ctrl) {
    const s = seats[i];
    if (s.input) s.input.dispose();
    s.kind = kind; s.mc = ctrl || null;
    s.input = kind === 'cpu' ? null : CK.Input.create(kind === 'phone' ? 'phone' : 'mouse', ctrl, () => roleOf(i));
    s.name = kind === 'cpu' ? 'CPU' : 'P' + (i + 1);
  }

  // ---------------------------------------------------------------------------------
  // Renderer, scene, cameras
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const PR_MAX = Math.min(window.devicePixelRatio || 1, 1.25), PR_MIN = Math.min(PR_MAX, 0.6);
  const dyn = { pr: PR_MAX, t: 0, n: 0, sum: 0, low: 0, shadows: true, fps: 60 };
  renderer.setPixelRatio(dyn.pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  $('stage').appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 2000);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  const world = CK.buildWorld(scene);
  const prTop = () => (opt('gfx') === 'LOW' ? Math.min(PR_MAX, 0.8) : PR_MAX);
  function setShadows(on) { dyn.shadows = on; dyn.low = 0; world.lights.key.castShadow = on; }
  setShadows(opt('gfx') !== 'LOW');
  /** AUTO: the render scale follows the frame rate; still low at the bottom for 4 s, shadows go. */
  function dynResolution(rdt) {
    dyn.t += rdt; dyn.n++; dyn.sum += rdt;
    if (dyn.t < 1) return;
    const fps = dyn.fps = dyn.n / dyn.sum;
    let pr = dyn.pr;
    if (opt('gfx') === 'HIGH') pr = PR_MAX;
    else if (fps < 52) pr = Math.max(PR_MIN, pr - (fps < 40 ? 0.15 : 0.07));
    else if (fps > 58.5) pr = Math.min(prTop(), pr + 0.05);
    pr = Math.min(pr, prTop());
    if (Math.abs(pr - dyn.pr) > 1e-3) { dyn.pr = pr; renderer.setPixelRatio(pr); }
    if (opt('gfx') === 'AUTO' && dyn.shadows && pr <= PR_MIN + 1e-3 && fps < 40) { if (++dyn.low >= 6) setShadows(false); } else dyn.low = 0;
    dyn.t = dyn.n = dyn.sum = 0;
  }

  // ---------------------------------------------------------------------------------
  // Actors (made once the models are in)
  const ballMesh = CK.makeBall(); scene.add(ballMesh); ballMesh.visible = false;
  const trail = CK.makeTrail(26); scene.add(trail.line);
  // a soft halo that keeps the ball a few pixels wide however far the camera is (broadcast style)
  const halo = new T.Sprite(new T.SpriteMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,250,235,0.95)'); g.addColorStop(0.35, 'rgba(255,240,200,0.45)'); g.addColorStop(1, 'rgba(255,230,180,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(c); return t; })(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
  scene.add(halo); halo.visible = false;
  const batMesh = CK.makeBat(); scene.add(batMesh); batMesh.visible = false;
  const cpuBat = { q: BA.batQuat(0, 0, 'vertical') };
  const aimRing = new T.Mesh(new T.RingGeometry(0.24, 0.34, 40), new T.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
  aimRing.rotation.x = -Math.PI / 2; aimRing.visible = false; scene.add(aimRing);
  const aimDot = new T.Mesh(new T.CircleGeometry(0.08, 16), aimRing.material); aimDot.rotation.x = -Math.PI / 2; aimRing.add(aimDot); aimDot.rotation.x = 0;
  const pitchMark = new T.Mesh(new T.CircleGeometry(0.11, 20), new T.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.0, toneMapped: false, depthWrite: false }));
  pitchMark.rotation.x = -Math.PI / 2; pitchMark.position.y = 0.012; scene.add(pitchMark);
  const people = { ready: false, batter: null, nonStriker: null, bowler: null, fielders: [], umpire: null };
  CK.Rig.onReady(() => {
    people.batter = CK.makeAthlete(Object.assign({}, KITS[0]));
    people.nonStriker = CK.makeAthlete(Object.assign({}, KITS[0]));
    people.bowler = CK.makeAthlete(Object.assign({}, KITS[1], { pads: false, helmet: null, gloves: null }));
    people.umpire = CK.makeAthlete({ body: 'm', shirt: 0xf0f0ea, pants: 0x1c1c22, skin: 0xc68642, hair: 0x2a2a2a });
    for (let i = 0; i < 10; i++) people.fielders.push(CK.makeAthlete(Object.assign({}, KITS[1], { body: i % 3 === 2 ? 'f' : 'm', pads: i === 0, gloves: i === 0 ? 0xf2f2f2 : null, helmet: null, skin: [0xd9a273, 0x8d5524, 0xc68642, 0xf1c8a0][i % 4] })));
    [people.batter, people.nonStriker, people.bowler, people.umpire, ...people.fielders].forEach(a => scene.add(a.root));
    people.ready = true;
    try { CK.crowdImpostors(scene, world.crowd, CK.bakeCrowdAtlas(renderer)); } catch (e) { console.warn('crowd atlas', e); }
    paintTeams();
  });
  function paintTeams() {
    if (!people.ready || !G.match) return;
    const inn = MA.current(G.match), bk = KITS[inn.bat], fk = KITS[inn.bowl];
    [people.batter, people.nonStriker].forEach(a => a.paint(bk));
    people.bowler.paint(fk);
    people.fielders.forEach(a => a.paint({ shirt: fk.shirt, pants: fk.pants }));
  }

  // ---------------------------------------------------------------------------------
  // Game state
  const Z_CONTACT = -1.25;          // where the bat meets the ball (in front of the front pad)
  const RUN_T = 1.25;               // s from the mark to the crease
  const G = {
    screen: 'title', inGame: false, paused: false, kind: null, match: null, phase: 'idle', t: 0, phaseT: 0,
    ball: null, ballOn: false, del: null, rel: null, path: null, contact: null, outcome: null, hold: false,
    aim: { x: 0.1, len: 6 }, aimSm: { x: 0.1, len: 6 }, cpuPlan: null, cpuDel: null, tracker: BA.tracker(), fed: 0,
    result: null, banner: null, replay: null, frames: [], shake: 0, slow: 1, lastTags: [], nets: null,
    stumpsFall: null, bowler: { x: 1.4, z: -31, run: 0, phase: 'mark' }, runs: null, fielderPlan: null,
  };
  const inn = () => MA.current(G.match);
  const roleOf = i => (!G.match ? 'bat' : inn().bat === i ? 'bat' : 'bowl');
  const batSeat = () => seats[inn().bat], bowlSeat = () => seats[inn().bowl];
  const batSide = () => sideOf(inn().bat);
  const armSide = () => sideOf(inn().bowl);            // bowling arm on screen right (+1) or left
  const timingK = () => BA.BAT.TIMING[opt('timing')];
  const cpuSkill = () => (opt('cpu') === 'PRO' ? { sigma: 0.032, aggro: 0.65, acc: 0.25 } : { sigma: 0.05, aggro: 0.45, acc: 0.45 });
  let rng = Math.random;

  // ---------------------------------------------------------------------------------
  // Starting
  function startMatch(kind) {
    G.kind = kind;
    const overs = kind === 'nets-bat' || kind === 'nets-bowl' ? 2 : opt('overs');
    const wk = kind === 'nets-bat' || kind === 'nets-bowl' ? 10 : opt('wkts');
    const firstBat = kind === 'versus' ? lobby.st.firstBat : kind === 'nets-bowl' ? 1 : 0;
    G.match = MA.create({ overs, wickets: wk, names: seats.map(s => s.name), firstBat });
    G.inGame = true; G.paused = false; G.result = null;
    showScreen(null);
    $('hud').classList.remove('hidden');
    paintTeams();
    newBall(true);
    banner(kind === 'versus' ? `${G.match.names[inn().bat]} BATS` : kind === 'nets-bowl' ? 'YOU BOWL' : 'YOU BAT', `${overs} OVER${overs > 1 ? 'S' : ''} · ${wk} WICKET${wk > 1 ? 'S' : ''}`, 'neutral', 2.2);
    updateScorebug();
    AU.resume();
  }

  function newBall(first) {
    G.phase = 'ready'; G.phaseT = 0; G.ball = null; G.ballOn = false; G.contact = null; G.outcome = null; G.hold = false;
    G.del = null; G.rel = null; G.path = null; G.cpuPlan = null; G.frames = []; G.stumpsFall = null; G.runs = null; G.fielderPlan = null;
    G.slow = 1; G.tracker = BA.tracker(); G.fed = 0;
    G.bowler = { x: armSide() * 1.5, z: -31.5, run: 0, phase: 'mark', relT: 0 };
    ballMesh.visible = false; trail.clear(); trail.push({ x: 0, y: -5, z: 0 }, false);
    resetStumps();
    const prevField = G.field;
    G.field = FI.setField(bowlKind(), batSide());
    if (prevField) G.field.forEach((f, i) => { if (prevField[i] && prevField[i].cur) { f.cur = prevField[i].cur; f.face = prevField[i].face; } });
    hud.speedOff();
    prompts();
    if (!first) updateScorebug();
  }
  function bowlKind() {
    const s = bowlSeat();
    if (s.kind === 'cpu') return G.cpuStyle || 'pace';
    return G.lastPace && G.lastPace < 26 ? 'spin' : 'pace';
  }

  // ---------------------------------------------------------------------------------
  // The delivery
  /** Aim spot from where the bowler points the phone (mirrored room: right = right on screen). */
  function aimFromPhone(q) {
    const f = BO.rotate(q, { x: 0, y: 0, z: -1 });
    const elev = Math.asin(clamp(f.y, -1, 1)) / deg, head = Math.atan2(f.x, -f.z) / deg;
    return { len: clamp(1 - elev * 0.35, -0.6, 12), x: clamp(head * 0.06, -1.4, 1.4) };
  }
  function defaultAim() { return { x: 0.11 * batSide(), len: 5.8 }; }

  function bowlerFrame(dt, now) {
    const s = bowlSeat();
    if (s.kind === 'cpu') { cpuBowlerFrame(dt); return; }
    const inp = s.input;
    const ev = inp.drain();
    if (G.phase === 'ready') {
      // HOLD locks the spot as it was just before the press (the arm is already moving on it)
      for (const e of ev) if (e.kind === 'press' && G.phaseT > 0.5) { startRunup(); return; }
      if (opt('aim') === 'ON') {
        const a = aimFromPhone(inp.S.q);
        G.aimSm.x = lerp(G.aimSm.x, a.x, 0.25); G.aimSm.len = lerp(G.aimSm.len, a.len, 0.25);
      } else Object.assign(G.aimSm, defaultAim());
    } else if (G.phase === 'runup') {
      for (const e of ev) if (e.kind === 'release') { release(inp, e.t); return; }
      if (G.phaseT > 6) { toast('Run-up called off: let go of ' + keyA(s.mc) + ' to bowl'); newBall(); }
    }
  }
  function startRunup() {
    G.aim = { x: G.aimSm.x, len: G.aimSm.len };
    G.phase = 'runup'; G.phaseT = 0; G.bowler.phase = 'run';
    prompts();
  }
  function release(inp, tUp) {
    const rel = BO.readRelease(inp.S.samples, tUp);
    if (!rel.ok) {
      const why = { slow: 'Too gentle: swing your arm over hard', underarm: 'Underarm: let go with your arm up, over the top', backward: 'Let go as your arm comes over toward the screen', nodata: 'Lost the phone for a moment: bowl again' }[rel.why] || 'Bowl again';
      banner('NOT A DELIVERY', why, 'bad', 1.6);
      G.phase = 'void'; G.phaseT = 0;
      return;
    }
    const gain = BO.BOWL.GAIN[opt('control')];
    const del = BO.toDelivery(rel, opt('aim') === 'ON' ? G.aim : defaultAim(), { arm: armSide(), gain, rng });
    launchDelivery(del, rel);
    const c = bowlSeat().mc; if (c) c.rumble(0.25, 25, 0);
  }
  function launchDelivery(del, rel) {
    G.del = del; G.rel = rel;
    G.ball = BO.launch(del);
    G.lastPace = del.speed;
    // what it will do, for the speed gun, the batter's footwork and the computer batter
    const pr = PH.run(G.ball, { until: b => b.p.z >= 0.2 || b.t > 3, every: 2 });
    const atC = pr.samples.find(s => s.z >= Z_CONTACT) || pr.samples[pr.samples.length - 1];
    const atS = pr.samples.find(s => s.z >= 0) || atC;
    G.path = { pitch: pr.pitch, heightAtBat: atC.y, atContact: atC, atStumps: atS };
    G.lastTags = BO.describe(G.path, del, batSide());
    G.phase = 'flight'; G.phaseT = 0; G.ballOn = true; G.t = 0;
    G.bowler.phase = 'follow'; G.bowler.relT = 0;
    ballMesh.visible = true; trail.clear();
    SFX.release(del.speed);
    hud.speed(del.speed * 3.6, G.lastTags);
    G.footwork = footworkFor(G.path);
    if (batSeat().kind === 'cpu') {
      const onStumps = !!(atS && Math.abs(atS.x) < 0.15 && atS.y < 0.75);
      G.cpuPlan = BA.cpuShot({ x: atC.x, h: atC.y, len: pr.pitch && pr.pitch.z < -0.3 ? -pr.pitch.z : null, onStumps }, cpuSkill(), rng, batSide());
    }
    prompts();
  }

  // the computer bowler: a style per innings, a varied plan per ball, human-sized errors
  function cpuBowlerFrame(dt) {
    if (G.phase === 'ready' && G.phaseT > 1.0) { G.aim = cpuAim(); G.phase = 'runup'; G.phaseT = 0; G.bowler.phase = 'run'; prompts(); }
    else if (G.phase === 'runup' && G.phaseT > RUN_T + 0.25) {
      const sk = cpuSkill(), spin = G.cpuStyle === 'spin';
      const pace = spin ? rand(78, 92) / 3.6 : rand(128, 146) / 3.6;
      const twist = spin ? (rng() < 0.65 ? 1 : -1) * rand(14, 26) : 0;
      const rel = { ok: true, pace, twist, spin: BO.spinFrom(twist), swing: spin ? 0 : rand(-0.8, 0.8), elevErr: 0, az: 0 };
      const a = G.aim;
      const del = BO.toDelivery(rel, { x: a.x + rand(-1, 1) * sk.acc * 0.35, len: a.len + rand(-1, 1) * sk.acc * 2 }, { arm: G.cpuArm, gain: BO.BOWL.GAIN.NORMAL, rng });
      launchDelivery(del, rel);
    }
  }
  function cpuAim() {
    const r = rng(), side = batSide();
    const len = r < 0.1 ? rand(0.6, 1.5) : r < 0.32 ? rand(2.2, 4) : r < 0.78 ? rand(4.5, 7) : r < 0.94 ? rand(7.5, 9.5) : rand(10, 11.5);
    return { len: G.cpuStyle === 'spin' ? clamp(len, 2, 7.5) : len, x: side * rand(-0.05, 0.3) };
  }

  /** Where the batter's front pad goes: into line, a stride forward to full balls, back to short ones. */
  function footworkFor(path) {
    const atC = path.atContact, side = batSide();
    const L = path.pitch && path.pitch.z < -0.3 ? -path.pitch.z : 0;
    const fwd = L < 5 ? 1 : L > 7.5 ? -1 : 0;
    return { padX: clamp(atC.x - 0.2 * side, -0.55, 0.3), padZ: fwd > 0 ? -1.15 : fwd < 0 ? -0.7 : -0.95, fwd };
  }

  // ---------------------------------------------------------------------------------
  // The ball in flight
  const SUB = 1 / 600;
  function flightStep(dt, now) {
    let left = dt;
    while (left > 1e-9 && G.ballOn) {
      const h = Math.min(SUB, left); left -= h;
      const prev = { x: G.ball.p.x, y: G.ball.p.y, z: G.ball.p.z };
      const ev = PH.step(G.ball, h); G.t += h;
      const p = G.ball.p;
      if (ev === 'bounce' && G.phase === 'flight') { SFX.thud(PH.len(G.ball.v), false); markPitch(p); }
      if (G.phase === 'flight') {
        if (!G.contact && PH.crossZ(prev, p, Z_CONTACT) >= 0 && G.ball.v.z > 0) {
          const k = PH.crossZ(prev, p, Z_CONTACT);
          G.contact = { tArr: now - left * 1000 / Math.max(1e-3, G.slow), p: PH.lerp3(prev, p, k), v: Object.assign({}, G.ball.v), state: 'arrived' };
          arrive();
        }
        if (G.contact && G.contact.state === 'beaten') beatenChecks(prev, p);
      } else if (G.phase === 'hit') hitPhysics(prev, p, ev);
    }
  }
  function markPitch(p) {
    if (G.ball.bounces !== 1) return;
    pitchMark.position.x = p.x; pitchMark.position.z = p.z; pitchMark.material.opacity = 0.9;
    hud.pitchMap(p, batSide());
  }

  /** The ball reaches the bat. */
  function arrive() {
    const s = batSeat();
    if (s.kind === 'cpu') {
      const c = G.cpuPlan;
      cpuSwingVisual(c);
      if (!c) { beaten('leave'); return; }
      const f = BA.fit(c.b, G.contact.p.y), q = BA.quality(c.e, 1, f, c.push);
      if (q === 'miss') { beaten('miss'); return; }
      strike({ u: c.u, b: c.b, e: c.e, q, push: c.push });
      return;
    }
    // the swing that meets it reaches the browser `lag` ms later: until it is known (and has
    // peaked), the ball goes on in slow motion at the bat
    G.hold = true;
  }
  const lagMs = () => (batSeat().kind === 'phone' ? opt('lag') : Math.min(30, opt('lag')));
  /** Human batter: decide once the swing's samples are in, or keep waiting while it speeds up. */
  function judgeContact(now) {
    feedTracker();
    const tA = G.contact.tArr + lagMs();
    if (now < tA) return;
    const j = BA.judge(G.tracker, tA, now, timingK());
    if (j.status === 'pending') return;
    G.hold = false;
    if (j.status === 'none') { beaten('leave'); return; }
    const st = BA.stateAt(G.tracker, tA), blade = BA.swingBlade(j.swing);
    const push = j.swing.peak < BA.BAT.V_SWING;
    const q = BA.quality(j.e, timingK(), BA.fit(blade, G.contact.p.y), push);
    G.lastTiming = j.e;
    if (q === 'miss') { beaten('miss', j.e); return; }
    strike({ u: st.u, b: blade, e: j.e, q, push });
  }
  function feedTracker() {
    const inp = batSeat().input; if (!inp) return;
    for (const s of inp.S.samples) if (s.t > G.fed) { BA.step(G.tracker, s); G.fed = s.t; }
  }

  function beaten(how, e) {
    G.contact.state = 'beaten'; G.contact.how = how;
    if (how === 'miss') {
      hud.shot(e !== undefined ? [['BEATEN', 'warn'], [e < 0 ? 'EARLY ' + Math.round(-e * 1000) + ' ms' : 'LATE ' + Math.round(e * 1000) + ' ms', '']] : [['BEATEN', 'warn']], e);
      SFX.whoosh(8);
    }
  }
  /** Bat missed (or no shot): the pad, the stumps, a wide, then the keeper. */
  function beatenChecks(prev, p) {
    const c = G.contact, side = batSide(), fw = G.footwork;
    if (!c.padDone && p.z >= fw.padZ) {
      c.padDone = true;
      const k = Math.max(0, PH.crossZ(prev, p, fw.padZ)), at = PH.lerp3(prev, p, k);
      const body = { x: fw.padX + 0.1 * side };
      if (Math.abs(at.x - fw.padX) < 0.1 + PH.BALL.R && at.y < 0.62) { padHit(at); return; }
      if (Math.abs(at.x - body.x) < 0.2 && at.y >= 0.62 && at.y < 1.55) { bodyHit(at); return; }
    }
    if (!c.stumpDone) {
      const hs = PH.hitsStumps(prev, p, 0);
      if (hs) { c.stumpDone = true; wicket('BOWLED', null, hs); return; }
      if (PH.crossZ(prev, p, 0) >= 0) {
        c.stumpDone = true;
        const k = PH.crossZ(prev, p, 0), at = PH.lerp3(prev, p, k);
        if (at.x * side > 0.95 || at.x * side < -0.5 || at.y > 1.9) c.wide = true;
      }
    }
    if (p.z > 11 && !c.kept) { c.kept = true; keeperTakes(); }
  }
  function padHit(at) {
    SFX.thud(PH.len(G.ball.v), true);
    const side = batSide();
    // would it have gone on to hit the stumps? (the same flight, the pad not there)
    const ghost = PH.run(G.ball, { until: b => b.p.z >= 0.05, samples: false }).end;
    const g0 = PH.run(G.ball, { until: b => b.p.z >= -0.02, samples: false }).end;
    const hitting = !!PH.hitsStumps(g0.p, ghost.p, 0);
    const pitchedLeg = G.path.pitch && G.path.pitch.x * side < -(PH.PITCH.STUMP_HALF + PH.BALL.R);
    const inLine = Math.abs(at.x) <= PH.PITCH.STUMP_HALF + PH.BALL.R;
    const out = hitting && !pitchedLeg && inLine;
    G.ball.v = { x: G.ball.v.x * 0.15 + rand(-0.6, 0.6), y: 0.8, z: -G.ball.v.z * 0.06 };
    G.contact.lbw = { out, hitting, pitchedLeg, inLine, at };
    if (out) { wicket('LBW', null, at); return; }
    G.contact.state = 'dead';
    endBallSoon(1.4, { runs: 0, extra: null }, pitchedLeg ? 'PITCHED OUTSIDE LEG' : !inLine ? 'HIT OUTSIDE THE LINE' : 'MISSING THE STUMPS', 'PAD');
    crowdReact('ooh');
  }
  function bodyHit() {
    SFX.thud(PH.len(G.ball.v), true);
    G.ball.v = { x: rand(-1, 1), y: 0.5, z: -1 };
    G.contact.state = 'dead';
    endBallSoon(1.3, { runs: 0, extra: null }, 'ON THE BODY', 'OUCH');
  }
  function keeperTakes() {
    const c = G.contact;
    SFX.glove();
    G.ballOn = false; ballMesh.visible = false;
    if (c.wide) { endBallSoon(1.2, { runs: 0, extra: 'wd' }, 'TOO WIDE', 'WIDE'); return; }
    endBallSoon(1.0, { runs: 0, extra: noBall() ? 'nb' : null }, c.how === 'leave' ? 'WELL LEFT' : 'PAST THE EDGE', c.how === 'leave' ? 'LEFT ALONE' : 'BEATEN');
  }
  /** A full toss above the waist at the popping crease. */
  function noBall() { const p = G.path; return !!p && (!p.pitch || p.pitch.z > -1.22) && p.heightAtBat > 1.0; }

  // ---------------------------------------------------------------------------------
  // The stroke
  function strike(sw) {
    const c = G.contact, side = batSide();
    const sh = BA.shot({ u: sw.u, b: sw.b, ballV: c.v, ballP: c.p, q: sw.q, e: sw.e, side, push: sw.push, power: BA.BAT.POWER[opt('power')], rng });
    G.stroke = sh;
    c.state = 'hit';
    const from = G.ball.p.z < -0.3 ? G.ball.p : c.p;
    G.ball = PH.ball(from, sh.v, {});
    G.phase = 'hit'; G.phaseT = 0; G.t = 0; G.ballOn = true;
    const power = clamp(sh.speed / 38, 0, 1);
    SFX.bat(power, sh.sweet, sh.edge);
    const bc = batSeat().mc;
    if (bc && batSeat().kind === 'phone') { if (sh.sweet) bc.rumble(0.55 + 0.45 * power, 60, 0); else if (sh.edge) bc.rumble(0.3, 35, 1); else bc.rumble(0.45 * power + 0.2, 45, 0); }
    G.shake = sh.sweet ? 0.12 * power : 0.04;
    const tags = [[sh.kind, sh.sweet ? 'hot' : sh.edge ? 'warn' : '']];
    if (!sh.edge && sh.speed > 8) tags.push([Math.round(sh.speed * 3.6) + ' km/h', '']);
    if (sw.e !== undefined && batSeat().kind !== 'cpu') tags.push([Math.abs(sw.e) < 0.02 ? 'PERFECT' : (sw.e < 0 ? 'EARLY ' : 'LATE ') + Math.round(Math.abs(sw.e) * 1000) + ' ms', Math.abs(sw.e) < 0.02 ? 'hot' : '']);
    hud.shot(tags, batSeat().kind !== 'cpu' ? sw.e : undefined);
    if (sh.playedOn) { G.outcome = { type: 'playedon' }; return; }
    const flight = PH.run(G.ball, { tMax: 14, every: 3 }).samples;
    const bowlerAt = { x: G.bowler.x, z: G.bowler.z };
    G.outcome = FI.resolve(flight, G.field, { rng, bowler: bowlerAt });
    G.outcome.flight = flight;
    planFielding(G.outcome);
    if (G.outcome.type === 'runs' && G.outcome.runs > 0) G.runs = { n: G.outcome.runs, t0: 0 };
    if (sh.sweet && power > 0.7) crowdReact('cheer', 0.4);
  }

  function hitPhysics(prev, p, ev) {
    const o = G.outcome;
    if (!o) return;
    if (ev === 'bounce' && G.phaseT < 6) SFX.thud(PH.len(G.ball.v) * 0.6, false);
    if (o.type === 'playedon') {
      const hs = PH.hitsStumps(prev, p, 0);
      if (hs && !G.contact.out) { G.contact.out = true; wicket('PLAYED ON', null, hs); }
    }
  }
  function hitTimers() {
    const o = G.outcome;
    if (!o) return;
    if (o.type === 'playedon') {
      if (G.t > 2 && !G.contact.out) { G.contact.out = true; endBallSoon(0.6, { runs: 0 }, 'SURVIVES', 'INSIDE EDGE'); }
      return;
    }
    if (o.done) return;
    if (o.type === 'caught' && G.t >= o.t) {
      o.done = true; G.ballOn = false; holdBall(o.by);
      if (noBall()) { banner('NO BALL', 'CAUGHT, BUT IT WAS A NO BALL', 'neutral', 1.8); endBallSoon(1.8, { runs: 0, extra: 'nb' }); return; }
      const bc = bowlSeat().mc; if (bc && bowlSeat().kind === 'phone') bc.rumble(0.8, 140, 3);
      const btc = batSeat().mc; if (btc && batSeat().kind === 'phone') btc.rumble(0.35, 60, 1);
      wicket('CAUGHT', o.name);
      return;
    }
    if ((o.type === 'four' || o.type === 'six') && G.t >= o.t) {
      o.done = true;
      const six = o.type === 'six';
      banner(six ? 'SIX!' : 'FOUR!', (G.stroke ? G.stroke.kind : '') + (six ? ' · ' + Math.round(carryOf(o)) + ' M' : ''), 'good', 2.2, true);
      crowdReact('cheer', six ? 1 : 0.75);
      flash(six ? 0.35 : 0.2);
      endBallSoon(2.2, { runs: six ? 6 : 4, boundary: true, extra: noBall() ? 'nb' : null }, null, null, six);
      return;
    }
    if (o.type === 'runs' && G.t >= o.t && !o.picked) {
      o.picked = true; holdBall(o.by);
      if (o.dropped && o.dropped.length) { banner('DROPPED!', o.dropped[0].toUpperCase() + ' PUTS IT DOWN', 'neutral', 1.6); crowdReact('ooh'); }
      const throwT = Math.max(0.5, o.back - o.t - FI.F.GATHER);
      G.throwBall = { t0: G.t + FI.F.GATHER, dur: throwT, from: null, to: nearerEnd(o.at) };
    }
    if (o.type === 'runs' && o.picked && !o.endQueued) {
      const runsDone = o.runs ? FI.F.RUN1 + (o.runs - 1) * FI.F.RUNN : 0;
      if (G.t >= Math.max(o.back, runsDone) + 0.2) {
        o.endQueued = true;
        const words = ['NO RUN', 'SINGLE', 'TWO RUNS', 'THREE RUNS'][o.runs] || o.runs + ' RUNS';
        endBallSoon(0.9, { runs: o.runs, extra: noBall() ? 'nb' : null }, (G.stroke ? G.stroke.kind + ' · ' : '') + 'TO ' + (o.name || '').toUpperCase(), words);
      }
    }
  }
  const carryOf = o => { const f = o.flight, s = f.find((x, i) => i && !x.air) || f[f.length - 1]; return Math.hypot(s.x, s.z - Z_CONTACT); };
  const nearerEnd = at => (Math.hypot(at.x, at.z) < Math.hypot(at.x, at.z + PH.PITCH.L) ? { x: 0, y: 0.8, z: 0.4 } : { x: 0, y: 0.8, z: -PH.PITCH.L - 0.4 });
  function holdBall(by) { G.ballHeldBy = by; G.ballOn = false; G.ball.v = { x: 0, y: 0, z: 0 }; }

  // ---------------------------------------------------------------------------------
  // Wickets, the end of a ball
  function wicket(how, by, at) {
    if (G.contact) G.contact.state = 'dead';
    if (how === 'BOWLED' || how === 'PLAYED ON') {
      knockStumps(at || { x: 0, y: 0.4, z: 0 });
      SFX.stumps();
      const bc = bowlSeat().mc; if (bc && bowlSeat().kind === 'phone') bc.rumble(1, 160, 3);
      const btc = batSeat().mc; if (btc && batSeat().kind === 'phone') btc.rumble(0.5, 90, 1);
      G.ball.v = { x: G.ball.v.x * 0.3, y: 1.2, z: G.ball.v.z * 0.15 };
    }
    G.umpireOut = how === 'LBW' || how === 'CAUGHT' ? 0.01 : 0;
    const sub = how === 'CAUGHT' ? 'CAUGHT · ' + (by || '').toUpperCase() : how === 'LBW' ? 'LEG BEFORE WICKET' : how === 'PLAYED ON' ? 'PLAYED ON' : 'BOWLED · ' + (G.lastTags[0] || '');
    if (noBall() && how !== 'BOWLED') { endBallSoon(1.6, { runs: 0, extra: 'nb' }, 'NOT OUT: NO BALL', 'NO BALL'); return; }
    banner('OUT!', sub, 'bad', 2.4, true);
    crowdReact('cheer', 0.9);
    flash(0.25);
    endBallSoon(2.4, { runs: 0, wicket: how.toLowerCase() }, null, null, true);
  }
  /** Queue the end of this ball: banner words now (optional), record after `after` seconds. */
  function endBallSoon(after, rec, sub, main, replay) {
    if (G.ending) return;
    if (main) banner(main, sub || '', rec.extra ? 'neutral' : rec.runs ? 'good' : 'neutral', after);
    G.ending = { t: after, rec, replay: replay && opt('replays') === 'ON' && G.frames.length > 20 };
  }
  function finishBall() {
    const e = G.ending; G.ending = null;
    if (e.replay && !G.replay) { startReplay(() => recordBall(e.rec)); return; }
    recordBall(e.rec);
  }
  function recordBall(rec) {
    const ev = MA.record(G.match, rec);
    hud.ballDot(ev.label);
    updateScorebug();
    if (ev.matchOver || (ev.inningsOver && /^nets/.test(G.kind))) { G.phase = 'over'; setTimeout(() => (/^nets/.test(G.kind) ? endNets() : endMatch()), 600); return; }
    if (ev.inningsOver) { inningsBreak(); return; }
    if (ev.over) { banner('END OF OVER', overSummary(), 'neutral', 1.8); G.phase = 'between'; G.phaseT = 0; G.betweenT = 1.9; if (bowlSeat().kind === 'cpu') G.cpuStyle = G.cpuStyle === 'spin' ? 'pace' : 'spin'; return; }
    newBall();
  }
  function overSummary() { const o = inn().overs[inn().overs.length - 1] || []; return o.join('  '); }

  function inningsBreak() {
    G.phase = 'break';
    const m = G.match, a = m.innings[0];
    $('break-kicker').textContent = 'INNINGS BREAK';
    $('break-title').textContent = `${m.names[a.bat]} ${a.runs}/${a.wkts}`;
    $('break-sub').textContent = `${MA.oversText(a.balls)} overs · ${a.fours} fours · ${a.sixes} sixes`;
    $('break-need').textContent = `${m.names[m.innings[1].bat]} needs ${m.target} to win from ${m.overs * 6} balls`;
    $('break-swap').innerHTML = G.kind === 'versus' ? 'Swap roles: <b>' + m.names[m.innings[1].bat] + '</b> takes the bat, <b>' + m.names[m.innings[1].bowl] + '</b> takes the ball.' : '';
    showScreen('break');
    G.cpuStyle = 'pace';
  }
  function continueAfterBreak() { showScreen(null); paintTeams(); newBall(true); banner(`${G.match.names[inn().bat]} BATS`, MA.need(G.match).text, 'neutral', 2); }

  function endMatch() {
    G.phase = 'over'; G.inGame = true;
    const m = G.match, r = MA.result(m), a = m.innings[0], b = m.innings[1];
    $('end-kicker').textContent = r.winner < 0 ? 'WHAT A FINISH' : 'MATCH RESULT';
    $('end-title').textContent = r.winner < 0 ? 'TIED!' : (G.kind === 'versus' ? m.names[r.winner] + ' WINS' : (r.winner === 0 ? 'YOU WIN' : 'CPU WINS'));
    $('end-sub').textContent = r.text;
    $('end-card').innerHTML = [a, b].map(x => `<div class="ec-row" style="--tc:${TEAM_COL[x.bat]}"><b>${m.names[x.bat]}</b><span>${x.runs}/${x.wkts}</span><small>${MA.oversText(x.balls)} ov · 4s ${x.fours} · 6s ${x.sixes}</small></div>`).join('');
    showScreen('end');
    if (r.winner >= 0) SFX.fanfare(true);
    crowdReact('cheer', 0.8);
  }

  function endNets() {
    const m = G.match, a = m.innings[0], you = G.kind === 'nets-bat';
    $('end-kicker').textContent = you ? 'BATTING NETS' : 'BOWLING NETS';
    $('end-title').textContent = you ? `${a.runs} RUNS` : `${a.wkts} WICKET${a.wkts === 1 ? '' : 'S'}`;
    $('end-sub').textContent = you ? `${a.wkts} out · ${a.fours} fours · ${a.sixes} sixes · ${a.dots} dots` : `${a.runs} runs conceded · ${a.dots} dot balls · ${a.extras} extras`;
    $('end-card').innerHTML = a.overs.map((o, i) => `<div class="ec-row" style="--tc:${TEAM_COL[a.bat]}"><b>OVER ${i + 1}</b><span>${o.filter(l => /^\d/.test(l)).reduce((s, l) => s + (+l), 0) + o.filter(l => /wd|nb/.test(l)).length}</span><small>${o.join('  ')}</small></div>`).join('');
    showScreen('end');
    SFX.fanfare(false);
  }

  // ---------------------------------------------------------------------------------
  // Fielders and the bowler's body
  function planFielding(o) {
    const plans = G.field.map(f => ({ x: f.x, z: f.z, tx: f.x, tz: f.z, sp: 0, start: FI.F.REACT }));
    const ballDir = o.flight && o.flight.length > 4 ? o.flight[Math.min(o.flight.length - 1, 30)] : null;
    plans.forEach((p, i) => {
      if (i === o.by && o.at) { const d = Math.hypot(o.at.x - p.x, o.at.z - p.z); p.tx = o.at.x; p.tz = o.at.z; p.sp = d / Math.max(0.25, o.t - FI.F.REACT); }
      else if (ballDir && i !== 0) {
        const d = Math.hypot(ballDir.x - p.x, ballDir.z - p.z);
        if (d < 30) { p.tx = p.x + (ballDir.x - p.x) * 0.35; p.tz = p.z + (ballDir.z - p.z) * 0.35; p.sp = 4; }
      }
    });
    if ((o.type === 'four' || o.type === 'six') && o.flight) {
      // the nearest outfielder chases it to the rope
      const end = o.flight.find(s => PH.fromCentre(s) > PH.FIELD.R) || o.flight[o.flight.length - 1];
      let bi = 1, bd = 1e9;
      plans.forEach((p, i) => { if (!i) return; const d = Math.hypot(end.x - p.x, end.z - p.z); if (d < bd) { bd = d; bi = i; } });
      plans[bi].tx = end.x * 0.95; plans[bi].tz = PH.FIELD.CZ + (end.z - PH.FIELD.CZ) * 0.95; plans[bi].sp = 7;
    }
    G.fielderPlan = plans;
  }

  // ---------------------------------------------------------------------------------
  // Stumps
  function resetStumps() {
    const s = world.stumps.bat;
    s.stumps.forEach(x => { x.rotation.set(0, 0, 0); x.position.y = 0; });
    s.bails.forEach((b, i) => { b.position.set((i - 0.5) * 0.0965, 0.72, 0); b.rotation.set(0, 0, Math.PI / 2); });
    G.stumpsFall = null;
  }
  function knockStumps(at) {
    G.stumpsFall = { t: 0, x: at.x, bails: [{ v: { x: rand(-2, 2), y: rand(3, 5), z: rand(2, 4) }, w: rand(8, 16) }, { v: { x: rand(-2, 2), y: rand(3, 5), z: rand(2, 4) }, w: rand(8, 16) }] };
  }
  function stumpsFrame(dt) {
    const f = G.stumpsFall; if (!f) return;
    f.t += dt;
    const s = world.stumps.bat, k = Math.min(1, f.t / 0.35);
    s.stumps.forEach((st, i) => {
      const hit = Math.max(0, 1 - Math.abs((i - 1) * 0.0965 - f.x) / 0.2);
      st.rotation.x = (0.25 + hit * 0.7) * k * (1 - 0.15 * Math.sin(f.t * 30) * Math.max(0, 1 - f.t * 3));
      st.rotation.z = (i - 1) * 0.12 * k;
    });
    s.bails.forEach((b, i) => {
      const bv = f.bails[i];
      if (b.position.y > 0.01) {
        bv.v.y -= 9.8 * dt;
        b.position.x += bv.v.x * dt; b.position.y += bv.v.y * dt; b.position.z += bv.v.z * dt;
        b.rotation.x += bv.w * dt; b.rotation.y += bv.w * 0.7 * dt;
        if (b.position.y < 0.01) b.position.y = 0.01;
      }
    });
  }

  // ---------------------------------------------------------------------------------
  // Actor states each frame (plain data, so a replay can store and replay them)
  function batterState(dt) {
    const side = batSide(), fw = G.footwork || { padX: -0.1 * side, padZ: -0.95, fwd: 0 };
    const going = G.phase === 'flight' || G.phase === 'hit';
    const k = going ? clamp(G.t / 0.35, 0, 1) : 0;
    const base = { x: -0.42 * side, z: -1.0 };
    const x = base.x + (fw.padX + 0.18 * side - 0.08 * side - base.x) * k * 0.7;
    const z = base.z + (fw.padZ + 0.1 - base.z) * k;
    let q;
    const seat = batSeat();
    if (seat.kind === 'cpu') q = cpuBat.q;
    else q = seat.input.S.q;
    const b = BO.rotate(q, { x: 0, y: 0, z: -1 });
    const C = { x: x + 0.16 * side, y: 1.28, z: z - 0.06 };
    let d = { x: b.x, y: b.y - 0.55, z: b.z }; const dl = Math.hypot(d.x, d.y, d.z) || 1;
    const hands = { x: C.x + d.x / dl * 0.48, y: C.y + d.y / dl * 0.48, z: C.z + d.z / dl * 0.48 };
    const low = { x: hands.x + b.x * 0.1, y: hands.y + b.y * 0.1, z: hands.z + b.z * 0.1 };
    const runOff = G.runs && G.phase === 'hit' ? runProgress() : null;
    const st = { x, z, facing: side * Math.PI / 2, twist: 0.45 * side + clamp(Math.atan2(b.x, -b.z) * 0.25, -0.5, 0.5) * (Math.abs(b.y) < 0.8 ? 1 : 0.2), crouch: 0.35, run: 0,
      arms: side > 0 ? { left: { hand: hands }, right: { hand: low } } : { right: { hand: hands }, left: { hand: low } } };
    if (runOff) { st.z = runOff.z; st.x = 0.9 * side; st.facing = runOff.dir > 0 ? 0 : Math.PI; st.run = runOff.dir ? 1 : 0; st.arms = null; st.twist = 0; st.crouch = 0; }
    return { st, bat: runOff ? { p: { x: st.x + 0.3 * side, y: 0.6, z: st.z }, q: BA.batQuat(0.6, 0, 'vertical') } : { p: hands, q } };
  }
  function runProgress() {
    const r = G.runs, t = G.t - 0.15;
    if (t < 0) return null;
    const L = PH.PITCH.L - 1.2;
    let i = 0, acc = 0;
    while (i < r.n) { const d = i === 0 ? FI.F.RUN1 : FI.F.RUNN; if (t < acc + d) break; acc += d; i++; }
    if (i >= r.n) return { z: r.n % 2 ? -1.0 - L : -1.0, dir: 0 };
    const d = i === 0 ? FI.F.RUN1 : FI.F.RUNN, k = clamp((t - acc) / d, 0, 1);
    const from = i % 2 ? -1.0 - L : -1.0, to = i % 2 ? -1.0 : -1.0 - L;
    return { z: lerp(from, to, k), dir: i % 2 ? 1 : -1 };
  }
  function bowlerState(dt) {
    const B = G.bowler, side = armSide();
    B.phase === 'run' ? (B.run = Math.min(1, B.run + dt * 3)) : (B.run = Math.max(0, B.run - dt * 2.5));
    const markZ = -31.5, creaseZ = BO.BOWL.FROM_Z - 0.75, cx = side * 0.55;
    if (B.phase === 'mark') { B.x = side * 1.5; B.z = markZ; }
    else if (B.phase === 'run') {
      const k = clamp(G.phaseT / RUN_T, 0, 1), e = k * (2 - k);
      B.x = lerp(side * 1.5, cx, e); B.z = lerp(markZ, creaseZ, e);
      if (k >= 1) B.run = Math.max(0.2, B.run - dt * 4);
    } else if (B.phase === 'follow') {
      B.relT += dt;
      const k = clamp(B.relT / 1.1, 0, 1), e = k * (2 - k);
      B.x = lerp(cx, side * 2.6, e); B.z = lerp(creaseZ, -14.5, e);
      B.run = (1 - k) * 0.8;
    }
    // the bowling arm: the phone's own direction, mirrored into the screen
    let r;
    const seat = bowlSeat();
    if (seat.kind === 'cpu') r = cpuArmDir();
    else r = BO.mirrorV(BO.rotate(seat.input.S.q, { x: 0, y: 0, z: -1 }));
    const arm = side > 0 ? 'left' : 'right';       // facing the camera, the avatar's left arm is on screen right
    return { x: B.x, z: B.z, facing: 0, run: B.run, crouch: 0, armDir: r, arm, lean: B.phase === 'follow' ? 0.25 : 0 };
  }
  function cpuArmDir() {
    const B = G.bowler;
    let phi = -2.6;
    if (G.phase === 'runup') { const k = clamp((G.phaseT - (RUN_T - 0.15)) / 0.4, 0, 1); phi = -2.6 + k * 2.75; }
    else if (B.phase === 'follow') phi = 0.15 + clamp(B.relT / 0.35, 0, 1) * 2.3;
    return BO.mirrorV(BO.rotate(BO.armQuat(phi, 0, 0), { x: 0, y: 0, z: -1 }));
  }
  function cpuSwingVisual(c) {
    G.cpuSwing = c ? { t0: performance.now(), e: c.e, cross: c.b.y > -0.5, dir: Math.atan2(c.u.x, -c.u.z) } : null;
  }
  function cpuBatFrame() {
    const s = G.cpuSwing;
    if (!s || !G.contact) {
      // stance, then the backlift as the bowler arrives
      const lift = G.phase === 'flight' ? clamp(G.t / 0.35, 0, 1) : 0;
      cpuBat.q = BA.batQuat(-lift * 2.3, 0, 'vertical');
      return;
    }
    const tt = (performance.now() - s.t0) / 1000 - s.e;
    const th = 2.2 * Math.tanh(tt / 0.12);
    const sweep = s.dir < 0 ? 1 : -1;
    cpuBat.q = s.cross ? BA.batQuat(th * 0.9, s.dir + sweep * Math.PI / 2, 'flat', 0.1, sweep) : BA.batQuat(th, s.dir, 'vertical');
  }
  function fielderStates(dt) {
    const plans = G.fielderPlan;
    return G.field.map((f, i) => {
      const P = plans && plans[i];
      if (!f.cur) f.cur = { x: f.x, z: f.z };
      if (P && G.phase === 'hit' && G.t > P.start && P.sp > 0) {
        const dx = P.tx - f.cur.x, dz = P.tz - f.cur.z, d = Math.hypot(dx, dz), step = Math.min(d, P.sp * dt);
        if (d > 0.05) { f.cur.x += dx / d * step; f.cur.z += dz / d * step; }
        f.face = d > 0.3 ? Math.atan2(dx, dz) : f.face;
        f.run = d > 0.3 ? clamp(P.sp / 7, 0.4, 1) : 0;
      } else if (G.phase === 'ready' || G.phase === 'runup' || G.phase === 'between') {
        const dx = f.x - f.cur.x, dz = f.z - f.cur.z, d = Math.hypot(dx, dz), step = Math.min(d, 6 * dt);
        if (d > 0.05) { f.cur.x += dx / d * step; f.cur.z += dz / d * step; }
        if (d > 0.6) f.face = Math.atan2(dx, dz);
        f.run = d > 0.6 ? 0.85 : Math.max(0, (f.run || 0) - dt * 3);
      } else f.run = Math.max(0, (f.run || 0) - dt * 3);
      const ballP = G.ball ? G.ball.p : null;
      const face = f.run > 0.2 ? f.face : Math.atan2(-f.cur.x, -f.cur.z - 1);
      const st = { x: f.cur.x, z: f.cur.z, facing: f.keeper && G.phase !== 'hit' ? Math.PI : face, run: f.run || 0, crouch: f.keeper ? (G.phase === 'hit' ? 0.2 : 0.85) : (G.phase === 'flight' ? 0.3 : 0.1) };
      if (ballP && G.phase === 'hit' && G.outcome && G.outcome.by === i) {
        const d = Math.hypot(ballP.x - f.cur.x, ballP.z - f.cur.z);
        if (d < 3 || G.ballHeldBy === i) st.arms = { left: { hand: handsAt(f, ballP, -1) }, right: { hand: handsAt(f, ballP, 1) } };
      }
      return st;
    });
  }
  function handsAt(f, p, s) { return { x: (G.ballHeldBy !== undefined && G.ballHeldBy !== null ? f.cur.x : p.x) + s * 0.08, y: G.ballHeldBy !== undefined && G.ballHeldBy !== null ? 1.1 : clamp(p.y, 0.3, 2.2), z: (G.ballHeldBy !== undefined && G.ballHeldBy !== null ? f.cur.z + 0.25 : p.z) }; }

  /** Everything the renderer needs this frame. */
  function liveFrame(dt) {
    if (batSeat().kind === 'cpu') cpuBatFrame();
    const b = batterState(dt);
    const side = batSide(), aside = armSide();
    const ns = { x: -aside * 1.6, z: -PH.PITCH.L - 1.2, facing: 0, run: 0, crouch: 0.1 };
    const rp = G.runs && G.phase === 'hit' ? runProgress() : null;
    if (rp) { ns.z = -2 - (PH.PITCH.L - 1.2) - rp.z; ns.run = rp.dir ? 1 : 0; ns.facing = rp.dir > 0 ? Math.PI : 0; ns.x = -0.9 * side; }
    let ballP = G.ball && (G.ballOn || G.phase === 'hit') ? { x: G.ball.p.x, y: G.ball.p.y, z: G.ball.p.z } : null;
    if (G.ballHeldBy !== undefined && G.ballHeldBy !== null && G.field[G.ballHeldBy]) {
      const f = G.field[G.ballHeldBy].cur || G.field[G.ballHeldBy];
      ballP = { x: f.x, y: 1.15, z: f.z + 0.25 };
      const th = G.throwBall;
      if (th && G.t >= th.t0) {
        const k = clamp((G.t - th.t0) / th.dur, 0, 1);
        if (!th.from) th.from = ballP;
        ballP = { x: lerp(th.from.x, th.to.x, k), y: lerp(th.from.y, th.to.y, k) + Math.sin(k * Math.PI) * Math.min(9, th.dur * 3.5), z: lerp(th.from.z, th.to.z, k) };
      }
    }
    if (G.phase === 'ready' || G.phase === 'runup') ballP = null;
    return { batter: b.st, bat: b.bat, bowler: bowlerState(dt), ns, fielders: fielderStates(dt), ball: ballP,
      umpire: { x: -aside * 0.45, z: -PH.PITCH.L - 2.4, facing: 0, run: 0, crouch: 0.15, out: G.umpireOut || 0 } };
  }
  function applyFrame(F, dt) {
    if (!people.ready) return;
    CK.poseAthlete(people.batter, F.batter, dt);
    batMesh.visible = true;
    batMesh.position.set(F.bat.p.x, F.bat.p.y, F.bat.p.z);
    batMesh.quaternion.set(F.bat.q.x, F.bat.q.y, F.bat.q.z, F.bat.q.w);
    const bw = F.bowler, A = people.bowler;
    CK.poseAthlete(A, { x: bw.x, z: bw.z, facing: bw.facing, run: bw.run, crouch: bw.crouch, lean: bw.lean }, dt);
    const sh = CK.boneWorld(A, bw.arm === 'left' ? 'UpperArmL' : 'UpperArmR', new T.Vector3());
    const r = bw.armDir;
    const hand = { x: sh.x + r.x * 0.66, y: sh.y + r.y * 0.66, z: sh.z + r.z * 0.66 };
    const armB = A.B.arms[bw.arm];
    CK.aimBone(armB.upper, armB.lower, { x: sh.x + r.x * 0.32 - 0.02, y: sh.y + r.y * 0.32 - 0.03, z: sh.z + r.z * 0.32 + 0.04 });
    CK.aimBone(armB.lower, armB.palm, hand);
    CK.poseAthlete(people.nonStriker, F.ns, dt);
    const u = F.umpire;
    const uArms = u.out ? { right: { hand: { x: u.x - 0.25, y: 2.25, z: u.z + 0.15 } } } : null;
    CK.poseAthlete(people.umpire, Object.assign({}, u, { arms: uArms }), dt);
    F.fielders.forEach((st, i) => CK.poseAthlete(people.fielders[i], st, dt));
    // the ball: in the bowler's hand before the release
    if (F.ball) { ballMesh.visible = true; ballMesh.position.set(F.ball.x, F.ball.y, F.ball.z); ballMesh.rotation.x += dt * 30; }
    else if (G.phase === 'ready' || G.phase === 'runup') { ballMesh.visible = true; ballMesh.position.copy(hand); }
    else ballMesh.visible = false;
    trail.push(ballMesh.position, ballMesh.visible && (G.phase === 'flight' || G.phase === 'hit') && !G.replayStill);
    halo.visible = ballMesh.visible && G.phase === 'hit';
    if (halo.visible) { halo.position.copy(ballMesh.position); const d = camera.position.distanceTo(ballMesh.position); halo.scale.setScalar(Math.max(0.25, d * 0.012)); }
  }

  // ---------------------------------------------------------------------------------
  // Replays: the frames since the release, played back slower from another angle
  function snapshot(F) {
    if (G.phase !== 'flight' && G.phase !== 'hit') return;
    G.frames.push({ F: JSON.parse(JSON.stringify(F)), stumps: world.stumps.bat.stumps.map(s => [s.rotation.x, s.rotation.z]), bails: world.stumps.bat.bails.map(b => [b.position.x, b.position.y, b.position.z, b.rotation.x]), cam: G.camMode });
    if (G.frames.length > 60 * 9) G.frames.shift();
  }
  function startReplay(done) {
    const frames = G.frames.slice();
    // from just before the bat (or the stumps) to the end
    let i0 = Math.max(0, frames.length - 60 * 4.5);
    G.replay = { frames, i: i0, t: 0, done, kind: G.ending ? 'x' : 'x', start: i0 };
    $('replay-bug').classList.add('on'); $('hud').classList.add('replaying');
    SFX.sting();
  }
  function replayFrame(dt) {
    const R = G.replay;
    R.t += dt * 0.5 * 60;
    const i = Math.min(R.frames.length - 1, R.start + Math.floor(R.t));
    const fr = R.frames[i];
    G.replayStill = false;
    applyFrame(fr.F, dt * 0.5);
    world.stumps.bat.stumps.forEach((s, k) => { s.rotation.x = fr.stumps[k][0]; s.rotation.z = fr.stumps[k][1]; });
    world.stumps.bat.bails.forEach((b, k) => { b.position.set(fr.bails[k][0], fr.bails[k][1], fr.bails[k][2]); b.rotation.x = fr.bails[k][3]; });
    replayCamera(fr.F, dt);
    if (i >= R.frames.length - 1) {
      G.replay = null; $('replay-bug').classList.remove('on'); $('hud').classList.remove('replaying');
      R.done();
    }
  }

  // ---------------------------------------------------------------------------------
  // Cameras
  const cam = { p: new T.Vector3(0, 30, 40), l: new T.Vector3(0, 0, -10), fov: 42 };
  function setCam(p, l, fov, k) {
    cam.p.lerp(p, k); cam.l.lerp(l, k); cam.fov = lerp(cam.fov, fov, k);
  }
  const _p = new T.Vector3(), _l = new T.Vector3();
  function updateCamera(dt, F) {
    const side = G.inGame && G.match ? batSide() : 1;
    let k = 1 - Math.exp(-dt * 3);
    if (!G.inGame) {
      const a = performance.now() / 1000 * 0.05;
      _p.set(Math.sin(a) * 48, 18, PH.FIELD.CZ + Math.cos(a) * 48); _l.set(0, 2, PH.FIELD.CZ);
      setCam(_p, _l, 46, 1 - Math.exp(-dt * 1.5));
      G.camMode = 'title';
    } else if (G.phase === 'hit' && G.ball && G.outcome && G.outcome.type !== 'playedon') {
      // broadcast follow: high behind the batter's end, panning and pushing toward the ball
      const b = G.ballHeldBy !== null && G.ballHeldBy !== undefined && F.ball ? F.ball : G.ball.p;
      const d = Math.hypot(b.x, b.z - Z_CONTACT);
      const dir = d > 0.5 ? { x: b.x / d, z: (b.z - Z_CONTACT) / d } : { x: 0, z: -1 };
      const back = 16 + d * 0.25;
      _p.set(b.x - dir.x * back * 0.9, 9 + d * 0.16, b.z - dir.z * back + 4);
      const r = Math.hypot(_p.x, _p.z - PH.FIELD.CZ);
      if (r > 76) { _p.x *= 76 / r; _p.z = PH.FIELD.CZ + (_p.z - PH.FIELD.CZ) * 76 / r; }
      _l.set(b.x, Math.max(0.5, b.y * 0.7), b.z);
      k = 1 - Math.exp(-dt * (G.phaseT < 0.4 ? 2.5 : 4));
      setCam(_p, _l, clamp(38 - d * 0.08, 30, 40), k);
      G.camMode = 'follow';
    } else {
      // behind the batter: the delivery comes toward the camera
      _p.set(0.55 * side, 2.15, 6.6); _l.set(0.05 * side, 1.05, -14);
      setCam(_p, _l, 40, G.phase === 'ready' && G.phaseT < 0.1 ? 1 : k);
      G.camMode = 'bat';
    }
    applyCam(dt);
  }
  function replayCamera(F, dt) {
    const side = batSide();
    const b = F.ball || { x: 0, y: 1, z: 0 };
    if (Math.hypot(b.x, b.z) < 14) { _p.set(-7.5 * side, 1.5, -3.5); _l.set(b.x * 0.4, 0.7, b.z * 0.5 - 0.6); setCam(_p, _l, 30, 1 - Math.exp(-dt * 6)); }
    else { _p.set(b.x * 0.5 - 6, 6 + b.y * 0.4, Math.min(8, b.z * 0.5 + 12)); _l.set(b.x, b.y, b.z); setCam(_p, _l, 34, 1 - Math.exp(-dt * 3)); }
    applyCam(dt);
  }
  function applyCam(dt) {
    camera.position.copy(cam.p);
    if (G.shake > 0) { G.shake = Math.max(0, G.shake - dt * 0.6); camera.position.x += (Math.random() - 0.5) * G.shake; camera.position.y += (Math.random() - 0.5) * G.shake; }
    camera.lookAt(cam.l);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------------------------
  // HUD
  const hud = {
    speed(kmh, tags) {
      $('gun-val').textContent = Math.round(kmh);
      $('gun-tags').innerHTML = tags.map(t => `<span>${t}</span>`).join('');
      $('gun').classList.add('on');
    },
    speedOff() { $('gun').classList.remove('on'); $('shot').classList.remove('on'); $('pmap').classList.remove('on'); pitchMark.material.opacity = 0; },
    shot(tags, e) {
      $('shot-tags').innerHTML = tags.map(([t, c]) => `<span class="${c}">${t}</span>`).join('');
      const m = $('shot-meter');
      if (e === undefined) m.classList.add('hidden');
      else {
        m.classList.remove('hidden');
        const W = BA.BAT.WIN.edge * timingK() * 1.3;
        m.querySelector('i').style.left = (50 + clamp(e / W, -1, 1) * 50) + '%';
        const g = BA.BAT.WIN.good * timingK() / W * 50, p = BA.BAT.WIN.perfect * timingK() / W * 50;
        m.querySelector('.sm-good').style.cssText = `left:${50 - g}%;width:${2 * g}%`;
        m.querySelector('.sm-perf').style.cssText = `left:${50 - p}%;width:${2 * p}%`;
      }
      $('shot').classList.add('on');
    },
    pitchMap(p, side) {
      const L = clamp(-p.z, 0, 12), x = clamp(p.x * side, -1.2, 1.2);
      const dot = $('pmap-dot');
      dot.style.top = (6 + (1 - L / 12) * 82) + '%';
      dot.style.left = (50 + x / 1.5 * 50) + '%';
      $('pmap').classList.add('on');
    },
    ballDot() { renderOver(); },
  };
  function renderOver() {
    const cur = inn().cur;
    $('sb-over').innerHTML = cur.map(l => `<i class="${l === 'W' ? 'w' : l === '4' || l === '6' ? 'b' : /wd|nb/.test(l) ? 'x' : ''}">${l === '•' ? '' : l}</i>`).join('') + '<i class="next"></i>'.repeat(Math.max(0, 6 - cur.filter(l => !/wd|nb/.test(l)).length));
  }
  function updateScorebug() {
    if (!G.match) return;
    const m = G.match, i = inn();
    $('sb-team').textContent = m.names[i.bat];
    $('sb-team').style.setProperty('--tc', TEAM_COL[i.bat]);
    $('sb-score').textContent = `${i.runs}-${i.wkts}`;
    $('sb-overs').textContent = `${MA.oversText(i.balls)}/${m.overs}`;
    const nd = MA.need(m);
    $('sb-info').textContent = nd ? nd.text : `RUN RATE ${MA.runRate(i).toFixed(2)}`;
    $('sb-bowler').innerHTML = `<b style="color:${TEAM_COL[i.bowl]}">${m.names[i.bowl]}</b> BOWLING`;
    renderOver();
  }
  let bannerT = 0;
  function banner(main, sub, cls, dur, slam) {
    const b = $('banner');
    b.querySelector('.b-main').textContent = main; b.querySelector('.b-sub').textContent = sub || '';
    b.className = 'on ' + (cls || '') + (slam ? ' slam' : '');
    bannerT = dur || 1.6;
  }
  let toastT = 0;
  function toast(t) { $('toast').textContent = t; $('toast').classList.add('on'); toastT = 2.2; }
  function flash(a) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = a; requestAnimationFrame(() => { f.style.transition = 'opacity 0.5s'; f.style.opacity = 0; }); }
  function crowdReact(kind, k) { AU.Crowd.react(kind, k); world.crowd.excite = Math.max(world.crowd.excite, kind === 'cheer' ? 0.4 + (k || 0.5) : 0.2); }

  /** The two players' prompts: what to do now, in each phone's own words. */
  function prompts() {
    if (!G.inGame || !G.match) return;
    const bs = bowlSeat(), ts = batSeat();
    let bp = '', tp = '';
    if (bs.kind !== 'cpu') {
      if (G.phase === 'ready') bp = (opt('aim') === 'ON' ? 'Point to aim, then ' : '') + `<b>hold ${keyA(bs.mc)}</b> to run in`;
      else if (G.phase === 'runup') bp = `Arm over the top, <b>let go of ${keyA(bs.mc)}</b> to bowl`;
      else bp = 'Wrist twist = spin · palm turned = swing';
    } else bp = G.cpuStyle === 'spin' ? 'Computer: spin' : 'Computer: pace';
    if (ts.kind !== 'cpu') tp = G.phase === 'ready' || G.phase === 'runup' ? `Phone down like a bat · <b>${keyC(ts.mc)}</b> to align · swing as it arrives` : 'Swing through it · keep still to leave';
    else tp = 'Computer batting';
    $('prompt-bowl').innerHTML = `<em style="background:${TEAM_COL[inn().bowl]}">${seats[inn().bowl].name}</em> ${bp}`;
    $('prompt-bat').innerHTML = `<em style="background:${TEAM_COL[inn().bat]}">${seats[inn().bat].name}</em> ${tp}`;
  }

  // ---------------------------------------------------------------------------------
  // Screens, menus, options
  function showScreen(name) {
    G.screen = name || 'game';
    ['title', 'lobby', 'pause', 'break', 'end', 'solo'].forEach(n => $(n).classList.toggle('hidden', n !== name));
    if (name === 'title' || name === 'lobby' || name === 'solo') $('hud').classList.add('hidden');
    refreshFocus();
  }
  function toTitle() {
    G.inGame = false; G.match = null; G.phase = 'idle'; G.paused = false; G.replay = null; G.ending = null;
    $('replay-bug').classList.remove('on');
    ballMesh.visible = false; batMesh.visible = false; aimRing.visible = false; trail.clear();
    showScreen('title'); setPanel('main');
  }
  function setPaused(v, why) {
    if (!G.inGame || G.phase === 'over') return;
    G.paused = v;
    $('pause-hint').innerHTML = why || 'Phone drifted? Point it at the screen and press <b>CENTRE</b> (or hold Vol Up).';
    showScreen(v ? 'pause' : null);
  }
  const menuFocus = { title: 0, opts: 0, solo: 0, pause: 0, end: 0, break: 0 };
  function activeMenu() {
    if (G.screen === 'lobby') return null;
    if (G.screen === 'title') return G.panel === 'opts' ? 'opts' : 'title';
    if (['solo', 'pause', 'end', 'break'].includes(G.screen)) return G.screen;
    return null;
  }
  const menuItems = n => Array.from($(n + '-menu').querySelectorAll('.mi')).filter(el => el.offsetParent !== null);
  function refreshFocus() {
    const m = activeMenu();
    Object.keys(menuFocus).forEach(n => menuItems(n).forEach((el, i) => el.classList.toggle('focus', m === n && i === menuFocus[n])));
  }
  function optLabel(k) {
    const o = OPTS[k], v = o.vals[settings[k]];
    if (k === 'overs') return o.names[settings[k]];
    if (k === 'vol') return Math.round(v * 100) + '%';
    if (k === 'lag') return v + ' ms';
    if (k === 'gfx') return v + (v === 'AUTO' && !dyn.shadows ? ' · LIGHT' : '');
    return String(v);
  }
  function refreshOpts() {
    document.querySelectorAll('.mi.opt').forEach(el => { el.querySelector('b').textContent = optLabel(el.dataset.opt); });
    AU.setMuted(opt('sound') === 'OFF'); AU.setVolume(opt('vol'));
    $('quick-sub').textContent = `${optLabel('overs').toLowerCase()} · ${opt('wkts')} wickets`;
  }
  function changeOpt(k, d) {
    const n = OPTS[k].vals.length;
    settings[k] = (settings[k] + d + n) % n;
    if (k === 'gfx') { setShadows(opt('gfx') !== 'LOW'); dyn.t = dyn.n = dyn.sum = 0; }
    saveSettings(); refreshOpts(); SFX.ui('move');
  }
  function buildOpts() {
    const box = $('opts-grid');
    box.innerHTML = Object.keys(OPTS).map(k => `<div class="mi opt" data-opt="${k}"><span>${OPTS[k].label}</span><span class="ov"><i class="arr">&#9664;</i><b></b><i class="arr">&#9654;</i></span></div>`).join('');
  }
  function setPanel(p) {
    G.panel = p;
    $('title-menu').classList.toggle('hidden', p !== 'main');
    $('opts-menu').classList.toggle('hidden', p !== 'opts');
    $('title').classList.toggle('opts', p === 'opts');
    menuFocus[p === 'opts' ? 'opts' : 'title'] = 0; refreshFocus();
  }
  function activate(el) {
    if (!el) return;
    AU.resume();
    if (el.dataset.opt) { changeOpt(el.dataset.opt, 1); return; }
    const act = el.dataset.act;
    SFX.ui(act === 'back' ? 'back' : 'ok');
    if (act === 'versus') openLobby();
    else if (act === 'solo') { showScreen('solo'); menuFocus.solo = 0; refreshFocus(); }
    else if (act === 'nets-bat' || act === 'nets-bowl' || act === 'cpu-match') startSolo(act);
    else if (act === 'options') setPanel('opts');
    else if (act === 'back') { if (G.screen === 'solo') toTitle(); else setPanel('main'); }
    else if (act === 'resume') setPaused(false);
    else if (act === 'restart') { const k = G.kind; G.replay = null; G.ending = null; $('replay-bug').classList.remove('on'); startMatch(k); }
    else if (act === 'quit') toTitle();
    else if (act === 'continue') continueAfterBreak();
    else if (act === 'rematch') { if (G.kind === 'versus') lobby.st.firstBat = 1 - G.match.innings[0].bat; startMatch(G.kind); }
  }
  function startSolo(act) {
    // seat 0: the phone (or the mouse), seat 1: the computer
    setSeat(0, isPhone(mc) ? 'phone' : 'mouse', mc);
    setSeat(1, 'cpu', null);
    G.cpuStyle = 'pace'; G.cpuArm = 1;
    startMatch(act === 'cpu-match' ? 'cpu' : act);
  }
  function bindMenus() {
    document.querySelectorAll('.mi').forEach(el => {
      el.addEventListener('click', e => {
        if (el.dataset.opt) { const arr = e.target.closest('.arr'); if (arr) { changeOpt(el.dataset.opt, arr === el.querySelectorAll('.arr')[0] ? -1 : 1); return; } }
        activate(el);
      });
      el.addEventListener('mouseenter', () => { const m = activeMenu(); if (!m) return; const i = menuItems(m).indexOf(el); if (i >= 0) { menuFocus[m] = i; refreshFocus(); } });
    });
  }
  function navMenu(d) { const m = activeMenu(); if (!m) return; const it = menuItems(m); menuFocus[m] = (menuFocus[m] + d + it.length) % it.length; refreshFocus(); SFX.ui('move'); }
  function menuSide(d) { const m = activeMenu(); if (!m) return; const el = menuItems(m)[menuFocus[m]]; if (el && el.dataset.opt) changeOpt(el.dataset.opt, d); else navMenu(d); }
  function menuBack() {
    const m = activeMenu();
    if (m === 'opts') { SFX.ui('back'); setPanel('main'); } else if (m === 'solo') { SFX.ui('back'); toTitle(); } else if (m === 'pause') setPaused(false);
  }
  addEventListener('keydown', e => {
    AU.resume();
    if (G.screen === 'lobby') return;
    if (e.key === 'Escape') { if (G.inGame && G.screen === 'game') setPaused(true); else if (G.paused) setPaused(false); else menuBack(); return; }
    if (e.key === 'm' || e.key === 'M') { settings.sound = settings.sound ? 0 : 1; saveSettings(); refreshOpts(); return; }
    const m = activeMenu(); if (!m) return;
    if (e.key === 'ArrowUp') { navMenu(-1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { navMenu(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') menuSide(-1);
    else if (e.key === 'ArrowRight') menuSide(1);
    else if (e.key === 'Backspace') menuBack();
    else if (e.key === 'Enter') { activate(menuItems(m)[menuFocus[m]]); e.preventDefault(); }
  });

  // ---------------------------------------------------------------------------------
  // Two-player lobby
  const lobby = { st: LB.createLobby(2), keyJoin: false, keyLeave: false, keyHold: false, keySwap: false, guard: 0 };
  function lobbyInputs() {
    const list = [];
    const n = Math.max(2, Math.min(4, MimicController.all().length));
    for (let i = 0; i < n; i++) {
      const c = slotCtrl(i); c.update();
      if (isPhone(c)) list.push({ id: 'phone' + i, kind: 'phone', ctrl: c, a: c.pressed('a'), b: c.pressed('b'), one: c.pressed('one'), aDown: c.isDown('a') });
    }
    if (!keyCtrl) keyCtrl = new KeyPad();
    list.push({ id: 'keys', kind: 'mouse', ctrl: keyCtrl, a: lobby.keyJoin, b: lobby.keyLeave, one: lobby.keySwap, aDown: lobby.keyHold });
    lobby.keyJoin = lobby.keyLeave = lobby.keySwap = false;
    return list;
  }
  function openLobby() { lobby.st = LB.createLobby(2); lobby.guard = 0.35; showScreen('lobby'); renderLobby([]); }
  function renderLobby(inputs) {
    const sl = lobby.st.slots;
    for (let i = 0; i < 2; i++) {
      const el = $('slot' + i), s = sl[i];
      el.classList.toggle('joined', !!s);
      const inp = s && inputs.find(p => p.id === s.id);
      el.querySelector('.s-role').textContent = lobby.st.firstBat === i ? 'BATS FIRST' : 'BOWLS FIRST';
      el.querySelector('.s-role').className = 's-role ' + (lobby.st.firstBat === i ? 'bat' : 'bowl');
      if (s) {
        const c = inp && inp.ctrl;
        el.querySelector('.s-state').textContent = 'READY · ' + (s.kind === 'mouse' ? 'MOUSE + KEYS' : ctrlMode(c).toUpperCase());
        el.querySelector('.s-help').innerHTML = s.kind === 'mouse' ? '<kbd>Tab</kbd> swaps roles · <kbd>Backspace</kbd> leaves'
          : `<b>${c.keyName('one')}</b> swaps roles · <b>${c.keyName('b')}</b> leaves · ${c.keyName('center')} aligns`;
        const sp = c ? clamp(c.angularSpeed / 14, 0, 1) : 0;
        el.querySelector('.s-bar i').style.width = (sp * 100).toFixed(0) + '%';
      } else {
        el.querySelector('.s-state').textContent = 'PRESS TO JOIN';
        el.querySelector('.s-help').innerHTML = `Grip: <b>${joinKey()}</b> · Wand: <b>A</b> · keyboard: <kbd>Space</kbd>`;
        el.querySelector('.s-bar i').style.width = '0%';
      }
    }
    const full = sl.every(Boolean), phones = inputs.filter(p => p.kind === 'phone').length;
    $('lobby-status').innerHTML = full
      ? `Both in. <b>Hold ${joinKey()}</b> to start <span class="hold"><i style="width:${(lobby.st.hold / LB.HOLD_TO_START * 100).toFixed(0)}%"></i></span>`
      : phones < 2 ? `${phones} of 2 phones connected. Open Mimic in Grip mode (or scan the code), then press <b>${joinKey()}</b>.` : `Press <b>${joinKey()}</b> on each phone to take a seat.`;
    $('lobby-start').classList.toggle('dim', !full);
  }
  function lobbyFrame(dt) {
    const inputs = lobbyInputs();
    if (lobby.guard > 0) { lobby.guard -= dt; inputs.forEach(p => { p.a = p.b = p.one = false; }); }
    for (const e of LB.stepLobby(lobby.st, inputs, dt)) {
      if (e.type === 'join') { SFX.ui('ok'); AU.resume(); }
      else if (e.type === 'leave') SFX.ui('back');
      else if (e.type === 'swap') SFX.ui('move');
      else if (e.type === 'back') { SFX.ui('back'); toTitle(); return; }
      else if (e.type === 'start') { startVersus(inputs); return; }
    }
    renderLobby(inputs);
  }
  function startVersus(inputs) {
    const sl = lobby.st.slots;
    if (!sl.every(Boolean)) return;
    inputs = inputs || lobbyInputs();
    sl.forEach((s, i) => {
      const inp = inputs.find(p => p.id === s.id);
      if (s.kind === 'mouse') setSeat(i, 'mouse', keyCtrl); else setSeat(i, 'phone', inp ? inp.ctrl : slotCtrl(+s.id.replace('phone', '')));
    });
    SFX.ui('ok');
    startMatch('versus');
  }
  addEventListener('keydown', e => {
    if (G.screen !== 'lobby') return;
    if (e.key === ' ') { if (!e.repeat) lobby.keyJoin = true; lobby.keyHold = true; e.preventDefault(); }
    if (e.key === 'Backspace') lobby.keyLeave = true;
    if (e.key === 'Tab') { lobby.keySwap = true; e.preventDefault(); }
    if (e.key === 'Escape') toTitle();
  });
  addEventListener('keyup', e => { if (e.key === ' ') lobby.keyHold = false; });
  $('lobby-start').addEventListener('click', () => startVersus());
  $('lobby-swap').addEventListener('click', () => { lobby.st.firstBat = 1 - lobby.st.firstBat; SFX.ui('move'); });
  $('lobby-back').addEventListener('click', () => { SFX.ui('back'); toTitle(); });

  // ---------------------------------------------------------------------------------
  // Phone buttons outside the motion: pause, align, menus
  let wandCursor = null;
  function phoneButtons(clicked) {
    if (G.inGame && G.screen === 'game') {
      for (const s of seats) {
        const c = s.mc;
        if (s.kind !== 'phone' || !c) continue;
        if (c !== mc) c.update();
        if (c.pressed('b')) { setPaused(true); return; }
        if (c.pressed('center')) toast(s.name + ': forward set');
      }
      return;
    }
    if (!isPhone(mc)) return;
    const m = activeMenu(); if (!m) return;
    if (mc.pressed('up')) navMenu(-1);
    if (mc.pressed('down')) navMenu(1);
    if (mc.pressed('a') && !clicked) activate(menuItems(m)[menuFocus[m]]);
    if (mc.pressed('b')) { if (G.paused) setPaused(false); else menuBack(); }
  }
  let ctrlKey = '';
  function updateCtrlStatus() {
    const k = isPhone(mc) + ctrlMode(mc) + mc.via;
    if (k === ctrlKey) return;
    ctrlKey = k;
    const el = $('title-ctrl');
    el.classList.toggle('phone', isPhone(mc));
    el.querySelector('span').textContent = isPhone(mc) ? 'Phone connected · ' + (ctrlMode(mc) === 'grip' ? 'Grip' : 'Wand') : 'Using mouse';
    el.querySelector('small').innerHTML = isPhone(mc) ? `Point at a button, <b>${mc.keyName('a')}</b> picks.` : 'Open Mimic on your phone in <b>Grip</b> mode, or scan the code.';
    document.querySelectorAll('[data-web]').forEach(x => { if (x.dataset.app == null) x.dataset.app = x.innerHTML; x.innerHTML = ctrlMode(mc) === 'grip' && mc.via === 'browser' ? x.dataset.web : x.dataset.app; });
  }
  let rumbleAsked = false;
  function askRumble() {
    if (rumbleAsked || G.inGame) return;
    rumbleAsked = true;
    Promise.resolve().then(() => mc.enableRumble()).then(ok => { $('rumble-status').textContent = ok ? 'Vibration on' : 'Vibration off: allow Mimic when Chrome asks'; $('rumble-status').classList.toggle('on', !!ok); }, () => {});
  }
  addEventListener('pointerdown', askRumble, true);

  // ---------------------------------------------------------------------------------
  // The main loop
  let lastNow = performance.now();
  const fpsWin = [];
  function gameFrame(dt, now) {
    for (const s of seats) if (s.input) s.input.frame(now);
    // a phone that drops out mid-match pauses it
    for (const s of seats) {
      if (s.kind !== 'phone') continue;
      s.offT = s.input.S.on ? 0 : (s.offT || 0) + dt;
      if (s.offT > 1.2) { s.offT = 0; setPaused(true, `<b>${s.name}'s phone</b> stopped sending. Reconnect it (Mimic, Grip mode), then resume.`); return; }
    }
    G.phaseT += dt;
    if (G.phase === 'ready' || G.phase === 'runup') bowlerFrame(dt, now);
    if (G.phase === 'void' && G.phaseT > 1.6) newBall();
    if (G.phase === 'between' && G.phaseT > G.betweenT) newBall();
    // the aim spot
    const showAim = G.phase === 'ready' && bowlSeat().kind !== 'cpu' && opt('aim') === 'ON';
    aimRing.visible = showAim || (G.phase === 'runup' && bowlSeat().kind !== 'cpu' && opt('aim') === 'ON');
    if (aimRing.visible) {
      const a = G.phase === 'runup' ? G.aim : G.aimSm;
      aimRing.position.set(a.x, 0.015, -a.len);
      aimRing.material.opacity = G.phase === 'runup' ? 0.95 : 0.6 + 0.3 * Math.sin(now / 200);
    }
    if (G.phase === 'flight' || G.phase === 'hit') {
      if (G.hold) { judgeContact(now); if (G.hold && now - G.contact.tArr > lagMs() + 400) { G.hold = false; beaten('miss'); } }
      if (G.ballOn) flightStep(dt * (G.hold ? 0.12 : G.slow), now); else if (G.phase === 'hit') G.t += dt;
      if (G.phase === 'hit') hitTimers();
      feedTracker();
    }
    if (G.ending) { G.ending.t -= dt; if (G.ending.t <= 0) finishBall(); }
    stumpsFrame(dt);
    if (G.umpireOut) G.umpireOut += dt;
    if (pitchMark.material.opacity > 0 && G.phase !== 'flight') pitchMark.material.opacity = Math.max(0, pitchMark.material.opacity - dt * 0.4);
    if (G.phase === 'ready' && G.phaseT < dt * 1.5) { G.umpireOut = 0; G.ballHeldBy = null; G.throwBall = null; G.stroke = null; }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    fpsWin.push(rdt); if (fpsWin.length > 120) fpsWin.shift();
    if (rdt > 0) dynResolution(rdt);
    mc.update(now);
    updateCtrlStatus();
    if (!wandCursor && window.MimicCursor) wandCursor = MimicCursor.create(mc, { visible: () => !!activeMenu() });
    phoneButtons(wandCursor ? wandCursor.update() : false);
    if (G.screen === 'lobby') lobbyFrame(rdt);
    let F = null;
    if (G.replay) replayFrame(rdt);
    else {
      if (G.inGame && !G.paused && G.screen === 'game' && G.phase !== 'over') gameFrame(rdt, now);
      if (G.inGame && G.match && people.ready) { F = liveFrame(G.paused ? 0 : rdt); applyFrame(F, G.paused ? 0 : rdt); snapshot(F); }
      else if (people.ready) idleScene(rdt);
      updateCamera(rdt, F || {});
    }
    if (bannerT > 0) { bannerT -= rdt; if (bannerT <= 0) $('banner').classList.remove('on'); }
    if (toastT > 0) { toastT -= rdt; if (toastT <= 0) $('toast').classList.remove('on'); }
    world.crowd.update(rdt);
    if (G.dbgCam) { const d = G.dbgCam; camera.position.set(d.p[0], d.p[1], d.p[2]); camera.lookAt(d.l[0], d.l[1], d.l[2]); camera.fov = d.fov || 35; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }
  /** Title screen: the players warm up in the middle. */
  function idleScene(dt) {
    batMesh.visible = true;
    const t = performance.now() / 1000;
    const q = BA.batQuat(-0.4 + Math.sin(t * 1.3) * 0.25, 0, 'vertical');
    const hands = { x: -0.26, y: 0.82, z: -1.06 };
    CK.poseAthlete(people.batter, { x: -0.42, z: -1.0, facing: Math.PI / 2, twist: 0.45, crouch: 0.3, arms: { left: { hand: hands }, right: { hand: { x: hands.x, y: hands.y - 0.09, z: hands.z } } } }, dt);
    batMesh.position.set(hands.x, hands.y, hands.z); batMesh.quaternion.set(q.x, q.y, q.z, q.w);
    CK.poseAthlete(people.bowler, { x: 1.4, z: -24, facing: 0, run: 0 }, dt);
    CK.poseAthlete(people.nonStriker, { x: -1.6, z: -21.3, facing: 0 }, dt);
    CK.poseAthlete(people.umpire, { x: -0.45, z: -22.5, facing: 0, crouch: 0.15 }, dt);
    const fs = FI.setField('pace', 1);
    fs.forEach((f, i) => CK.poseAthlete(people.fielders[i], { x: f.x, z: f.z, facing: Math.atan2(-f.x, -f.z - 1), crouch: i === 0 ? 0.85 : 0.1 }, dt));
  }

  buildOpts();
  bindMenus();
  refreshOpts();
  setSeat(0, 'mouse', mc);
  toTitle();
  requestAnimationFrame(frame);

  window.__cricket = {
    G, seats, settings, world, people, renderer, scene, camera, lobby, startMatch, startSolo, openLobby, toTitle, setPaused, setSeat, slotCtrl, changeOpt,
    get fps() { const s = fpsWin.reduce((a, b) => a + b, 0); return fpsWin.length / (s || 1); }, get renderScale() { return dyn.pr; }, get shadows() { return dyn.shadows; },
    inn: () => G.match && inn(),
  };
})();
