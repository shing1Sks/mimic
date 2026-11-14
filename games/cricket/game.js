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
    // length and line measured from the bowler's own habit (last 5 balls), see bowl.js
    lineup: { label: 'BOWLING LINE-UP', vals: ['AUTO', 'OFF'], def: 0 },
    power: { label: 'BAT POWER', vals: ['SOFT', 'NORMAL', 'BIG'], def: 1 },
    // phone -> browser (Bluetooth) plus screen -> eyes: a swing timed to what you see arrives this late
    lag: { label: 'SWING DELAY FIX', vals: [0, 30, 60, 90, 120], def: 2 },
    team0: { label: 'P1 TEAM', vals: CK.Teams.TEAMS.map(t => t.id), def: 0 },
    team1: { label: 'P2 TEAM', vals: CK.Teams.TEAMS.map(t => t.id), def: 1 },
    hand0: { label: 'P1 PLAYS', vals: ['RIGHT-HANDED', 'LEFT-HANDED'], def: 0 },
    hand1: { label: 'P2 PLAYS', vals: ['RIGHT-HANDED', 'LEFT-HANDED'], def: 0 },
    cpu: { label: 'COMPUTER', vals: ['CLUB', 'PRO'], def: 0 },
    replays: { label: 'REPLAYS', vals: ['ON', 'OFF'], def: 0 },
    comm: { label: 'COMMENTARY', vals: ['ON', 'OFF'], def: 0 },
    commVol: { label: 'COMMENTARY VOLUME', vals: [1, 0.7, 0.4], def: 0 },
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
  // the sides (CK.Teams): kit colours on the athletes, team colours in the HUD, names on the board
  const teamOf = i => CK.Teams.byId(opt('team' + i));
  const tcol = i => teamOf(i).css;
  const kitOf = i => { const t = teamOf(i); return Object.assign({}, KITS[i], { shirt: t.shirt, pants: t.pants, helmet: t.pants }); };
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
  renderer.shadowMap.autoUpdate = false;   // drawn once a frame, even with two views
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
  // the ball's shadow: a soft dark disc on the ground, darker and tighter as it comes down
  const ballShadow = new T.Mesh(new T.CircleGeometry(0.09, 20), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2; ballShadow.renderOrder = 2; scene.add(ballShadow);
  // where a skied hit will come down (broadcast style)
  const landRing = new T.Mesh(new T.RingGeometry(0.55, 0.75, 40), new T.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  landRing.rotation.x = -Math.PI / 2; landRing.position.y = 0.03; scene.add(landRing);
  // dust: little puffs of the strip where the ball pitches (and the stumps when it hits them)
  const dustTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(235,215,170,0.9)'); g.addColorStop(1, 'rgba(235,215,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
  const dust = Array.from({ length: 24 }, () => { const sp = new T.Sprite(new T.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); return { sp, v: new T.Vector3(), t: 0, life: 0, size: 0.3 }; });
  let dustNext = 0;
  function puff(p, n, power) {
    for (let i = 0; i < n; i++) {
      const d = dust[dustNext++ % dust.length];
      d.sp.position.set(p.x, Math.max(0.05, p.y), p.z);
      d.v.set((Math.random() - 0.5) * 1.6 * power, (0.4 + Math.random()) * power, (Math.random() - 0.5) * 1.6 * power);
      d.t = 0; d.life = 0.6 + Math.random() * 0.5; d.size = 0.25 + 0.25 * power; d.sp.visible = true;
    }
  }
  function dustFrame(dt) {
    for (const d of dust) {
      if (!d.sp.visible) continue;
      d.t += dt; d.v.multiplyScalar(Math.exp(-dt * 3)); d.sp.position.addScaledVector(d.v, dt);
      const k = d.t / d.life; d.sp.material.opacity = 0.75 * (1 - k); d.sp.scale.setScalar(d.size * (1 + k * 2.2));
      if (k >= 1) d.sp.visible = false;
    }
  }
  const ballQ = new T.Quaternion(), _dq = new T.Quaternion(), _ax = new T.Vector3();
  const cpuBat = { q: BA.batQuat(0, 0, 'vertical') };
  const aimRing = new T.Mesh(new T.RingGeometry(0.3, 0.46, 40), new T.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
  aimRing.rotation.x = -Math.PI / 2; aimRing.visible = false; scene.add(aimRing);
  const aimDot = new T.Mesh(new T.CircleGeometry(0.08, 16), aimRing.material); aimDot.rotation.x = -Math.PI / 2; aimRing.add(aimDot); aimDot.rotation.x = 0;
  const pitchMark = new T.Mesh(new T.CircleGeometry(0.11, 20), new T.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.0, toneMapped: false, depthWrite: false }));
  pitchMark.rotation.x = -Math.PI / 2; pitchMark.position.y = 0.012; scene.add(pitchMark);
  const people = { ready: false, batter: null, nonStriker: null, bowler: null, fielders: [], umpire: null };
  CK.Rig.onReady(() => {
    people.batter = CK.makeAthlete(Object.assign({}, KITS[0]));
    people.nonStriker = CK.makeAthlete(Object.assign({}, KITS[0]));
    people.outgoing = CK.makeAthlete(Object.assign({}, KITS[0]));   // the man just out, walking off
    people.outgoing.root.visible = false; scene.add(people.outgoing.root);
    people.bowler = CK.makeAthlete(Object.assign({}, KITS[1], { pads: false, helmet: null, gloves: null }));
    people.umpire = CK.makeAthlete({ body: 'm', shirt: 0xf0f0ea, pants: 0x1c1c22, skin: 0xc68642, hair: 0x2a2a2a });
    for (let i = 0; i < 10; i++) people.fielders.push(CK.makeAthlete(Object.assign({}, KITS[1], { body: 'm', pads: i === 0, gloves: i === 0 ? 0xf2f2f2 : null, helmet: null, skin: [0xd9a273, 0x8d5524, 0xc68642, 0xf1c8a0][i % 4] })));
    [people.batter, people.nonStriker, people.bowler, people.umpire, ...people.fielders].forEach(a => scene.add(a.root));
    // the stadium's cheerleaders: two on each of four platforms just past the rope
    people.cheer = [];
    const platM = new T.MeshStandardMaterial({ color: 0x1b1f2e, roughness: 0.6 }), ledM = new T.MeshBasicMaterial({ color: 0xff3d8b, toneMapped: false });
    const pomM = [new T.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4, metalness: 0.3 }), new T.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.4 })];
    [[Math.PI - 0.4, 66], [Math.PI + 0.4, 66], [Math.PI / 2, 67], [-Math.PI / 2, 67]].forEach(([a, r], k) => {
      const cx = Math.sin(a) * r, cz = PH.FIELD.CZ + Math.cos(a) * r, face = Math.atan2(-cx, PH.FIELD.CZ - cz);
      const plat = new T.Group();
      const top = new T.Mesh(new T.BoxGeometry(3.4, 0.8, 1.8), platM); top.position.y = 0.4; plat.add(top);
      const led = new T.Mesh(new T.BoxGeometry(3.42, 0.14, 1.82), ledM); led.position.y = 0.72; plat.add(led);
      plat.position.set(cx, 0, cz); plat.rotation.y = face; scene.add(plat);
      for (const s of [-1, 1]) {
        const A = CK.makeAthlete({ body: 'f', shirt: 0xff2f7d, pants: 0xffffff, skin: [0xf1c8a0, 0xc68642, 0xe0ac69, 0x8d5524][(k * 2 + (s > 0 ? 1 : 0)) % 4], hair: 0x1e140c });
        scene.add(A.root);
        const poms = [0, 1].map(j => { const m = new T.Mesh(new T.IcosahedronGeometry(0.14, 1), pomM[(k + j) % 2]); scene.add(m); return m; });
        people.cheer.push({ A, poms, plat, x: cx + Math.cos(face) * 0.8 * s, z: cz - Math.sin(face) * 0.8 * s, face, ph: k * 0.7 + (s > 0 ? 0.35 : 0) });
      }
    });
    // the fan cam: three painted, shirtless superfans with a flag, at the rope by a cheer platform
    people.fans = [];
    {
      const a0 = Math.PI / 2 + 0.11, r = 68.4;
      for (let k = 0; k < 3; k++) {
        const a = a0 + (k - 1) * 0.022, x = Math.sin(a) * r, z = PH.FIELD.CZ + Math.cos(a) * r, face = Math.atan2(-x, PH.FIELD.CZ - z);
        const skin = [0xd9a273, 0xc68642, 0x8d5524][k];
        const A = CK.makeAthlete({ body: 'm', shirt: skin, pants: [0x1d2433, 0x3a3f4a, 0x23324d][k], skin, hair: 0x1a120b });
        A.root.scale.set(1.18, 1, 1.15);            // a well-fed superfan, shirt off
        // the belly, and the team painted across the chest (stuck to the torso bone: it moves with him)
        const tb = A.B.torso, ws = new T.Vector3(); A.root.updateMatrixWorld(true); tb.getWorldScale(ws);
        const sk = 1 / (ws.x || 1);
        const belly = new T.Mesh(new T.SphereGeometry(0.17, 14, 10), new T.MeshStandardMaterial({ color: new T.Color(skin).convertSRGBToLinear(), roughness: 0.75 }));
        belly.scale.set(0.95 * sk, 0.85 * sk, 0.8 * sk); belly.position.set(0, -0.03 * sk, 0.06 * sk); tb.add(belly);
        const paint = new T.Mesh(new T.PlaneGeometry(0.36, 0.22), new T.MeshStandardMaterial({ transparent: true, roughness: 0.7 }));
        paint.scale.setScalar(sk); paint.position.set(0, 0.26 * sk, 0.13 * sk); tb.add(paint);
        A.root.traverse(o => { o.castShadow = false; });
        scene.add(A.root);
        people.fans.push({ A, paint, flag: k === 1 ? fanFlag() : null, x, z, face, ph: k * 1.7, k });
      }
    }
    people.ready = true;
    cheerN = -1; cheerFrame(0);   // the cheerleaders on their platforms from the start (the title shows the ground)
    try { CK.crowdImpostors(scene, world.crowd, CK.bakeCrowdAtlas(renderer)); } catch (e) { console.warn('crowd atlas', e); }
    paintTeams();
  });
  function paintTeams() {
    if (!people.ready || !G.match) return;
    world.flags.paint(teamOf(0).shirt, teamOf(1).shirt);   // the fans: P1's side on the +x half, P2's on the -x half
    const inn = MA.current(G.match), bk = kitOf(inn.bat), fk = kitOf(inn.bowl);
    [people.batter, people.nonStriker, people.outgoing].forEach(a => a.paint(bk));
    people.bowler.paint(fk);
    people.fielders.forEach(a => a.paint({ shirt: fk.shirt, pants: fk.pants }));
    castPlayers();
  }
  /** Who is who this ball: the real players' looks on the striker, non-striker, the man walking off, the bowler and the field. */
  function castPlayers() {
    if (!people.ready || !G.match) return;
    const i = MA.current(G.match), bt = teamOf(i.bat), bw = teamOf(i.bowl), Lb = CK.Teams.lineup(bt), Lw = CK.Teams.lineup(bw);
    people.batter.look(bt.looks[Lb.batterIdx(i.wkts)]);
    people.nonStriker.look(bt.looks[Lb.batterIdx(i.wkts + 1)]);
    if (people.outgoing) people.outgoing.look(bt.looks[Lb.batterIdx(i.wkts - 1)]);
    const bi = Lw.bowlerIdx(Math.floor(i.balls / 6)), fl = Lw.fielders(bi);
    people.bowler.look(bw.looks[bi]);
    people.fielders.forEach((a, k) => a.look(bw.looks[fl[k]]));
    G.fieldNames = fl.map(k => bw.players[k]);
  }
  /** The fielder in an outcome, by name (his position if the field is not cast). */
  /** A fielder's name from his position's name (the drop list carries positions). */
  function dropName(pos) { const k = G.field ? G.field.findIndex(f => f.name === pos) : -1; return (k >= 0 && G.fieldNames && G.fieldNames[k]) || pos; }
  const fname = o => (o && o.by >= 0 && G.fieldNames && G.fieldNames[o.by]) || (o && o.name) || '';

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
    G.match = MA.create({ overs, wickets: wk, names: [0, 1].map(i => teamOf(i).name), firstBat });
    G.batRuns = [[], []];   // each innings: runs per batter (by wickets down)
    G.att = CK.Attitude.context(); G.gesture = null; G.wkBalls = [];
    G.story = CK.Story.create();
    G.inGame = true; G.paused = false; G.result = null;
    showScreen(null);
    $('hud').classList.remove('hidden');
    paintTeams();
    newBall(true);
    banner(kind === 'versus' ? `${G.match.names[inn().bat]} BATS` : kind === 'nets-bowl' ? 'YOU BOWL' : 'YOU BAT', `${overs} OVER${overs > 1 ? 'S' : ''} · ${wk} WICKET${wk > 1 ? 'S' : ''}`, 'neutral', 2.2);
    walkOut('start');
    updateScorebug();
    AU.resume();
  }

  // Paaji (CK.Commentary): the voice through the game's audio, his line as the subtitle
  const paajiPlayer = CK.Commentary.createPlayer({
    lines: CK.CommentaryLines, base: 'assets/commentary/',
    audio: () => (AU.state.ctx ? { ctx: AU.state.ctx, out: AU.state.master } : null),   // muted = master gain 0
    enabled: () => opt('comm') === 'ON', volume: () => opt('commVol'),
    onLine: l => say(l.text, Math.max(2.2, l.text.length * 0.06)),
  });
  let paajiLoading = false;
  function paaji(kind, at) {
    if (opt('comm') !== 'ON') return null;
    if (!paajiLoading && AU.state.ctx) { paajiLoading = true; paajiPlayer.load(); }
    return paajiPlayer.moment(kind, at);
  }
  /** A call a little after the moment; dropped if the tab was hidden and it fires more than 1 s late. */
  function paajiLater(kind, ms) { const due = performance.now() + ms; setTimeout(() => paaji(kind, due), ms); }
  /** The cheerleaders: a sway between balls, a pom-pom routine on the beat after a big moment. */
  function cheerFrame(dt) {
    if (!people.ready || !people.cheer) return;
    const on = CK.Hype.extras(gfxLevel()).cheerleaders, t = performance.now() / 1000, dancing = G.dance > 0, special = G.cheerSpecial > 0;
    // far from the play: a new pose every 2nd frame while dancing, every 8th while swaying (every
    // frame for the special number, with the camera on them)
    cheerN = (cheerN + 1) % (dancing ? 2 : 8);
    const step = cheerN === 0 || special, _p = _cheerP;
    cheerDt += dt;
    for (const c of people.cheer) {
      c.A.root.visible = on; c.plat.visible = on; c.poms.forEach(m => { m.visible = on; });
      if (!on || !step) continue;
      if (!c.shadowOff) { c.A.root.traverse(o => { o.castShadow = false; }); c.shadowOff = true; }
      const beat = (t * 2.2 + c.ph) * Math.PI * 2, st = { x: c.x, z: c.z, facing: c.face };
      let arms = null, y = 0.8, spin = 0;
      if (special) {
        // the special number: a jump and a full spin together, then pom-poms high and wide
        const s = clamp(1 - G.cheerSpecial / 2.0, 0, 1), jump = clamp((s - 0.05) / 0.4, 0, 1);
        spin = jump * Math.PI * 2;
        y += Math.sin(jump * Math.PI) * 0.55;
        const h = CK.Anim.gestureHands('cheer', st);
        const wide = s > 0.45 ? Math.sin((s - 0.45) * 14 + c.ph) * 0.35 : 0, up = 1.15 + (s > 0.45 ? 0.2 : 0) + y - 0.8;
        h.left.y += up + wide; h.right.y += up - wide;
        arms = { left: { hand: h.left }, right: { hand: h.right } };
      } else if (dancing) {
        const h = CK.Anim.gestureHands(Math.sin(beat / 2) > 0 ? 'cheer' : 'shrug', st);
        if (Math.sin(beat / 2) <= 0) { h.left.y += 0.9; h.right.y += 0.9; }   // arms wide and high on the off-beat
        const lift = 0.8 + Math.abs(Math.sin(beat)) * 0.2; h.left.y += lift; h.right.y += lift;   // standing on the platform
        arms = { left: { hand: h.left }, right: { hand: h.right } };
        y += Math.abs(Math.sin(beat)) * 0.2;
      }
      CK.poseAthlete(c.A, { x: c.x, z: c.z, facing: c.face + spin + (dancing || special ? 0 : Math.sin(t * 1.3 + c.ph) * 0.25), y, run: 0, crouch: dancing || special ? 0 : 0.05, arms }, cheerDt);
      ['left', 'right'].forEach((s, j) => { const palm = c.A.B.arms[s].palm; if (palm) { palm.getWorldPosition(_p); c.poms[j].position.copy(_p); } });
    }
    if (step) cheerDt = 0;
    fanFrame(dt, !!(G.cutaway && G.cutaway.shot === 'fans'));
  }
  let cheerN = 0, cheerDt = 0;
  // the superfans' body paint and flag: the team's colours on canvas (made once per team)
  const fanTex = {};
  const hex6 = n => '#' + n.toString(16).padStart(6, '0');
  function teamCanvas(tm, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), hex6(tm.shirt), hex6(tm.accent));
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function fanFlag() {
    const geo = new T.PlaneGeometry(1.5, 0.95, 14, 1);
    const flag = new T.Mesh(geo, new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 0.8 }));
    const pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.6, 6), new T.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.5 }));
    scene.add(flag); scene.add(pole);
    return { flag, pole, base: Float32Array.from(geo.attributes.position.array) };
  }
  /** Paint the superfans for team seat i: body paint stripes and the flag. */
  function paintFans(i) {
    if (!people.fans) return;
    const tm = teamOf(i), key = tm.id;
    if (!fanTex[key]) {
      fanTex[key] = {
        body: teamCanvas(tm, 160, 100, (x, a, b) => { x.clearRect(0, 0, 160, 100); x.fillStyle = a; x.beginPath(); x.ellipse(80, 50, 78, 46, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = b; x.fillRect(4, 40, 152, 20); x.fillStyle = a === '#ffffff' || a === '#f2f2f2' ? '#c8102e' : '#ffffff'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(tm.short, 80, 52); }),
        flag: teamCanvas(tm, 192, 120, (x, a, b) => { x.fillStyle = a; x.fillRect(0, 0, 192, 120); x.fillStyle = b; x.fillRect(0, 44, 192, 32); x.fillStyle = a; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.fillText(tm.short, 96, 71); }),
      };
    }
    for (const f of people.fans) {
      f.paint.material.map = fanTex[key].body; f.paint.material.needsUpdate = true;
      if (f.flag) { f.flag.flag.material.map = fanTex[key].flag; f.flag.flag.material.needsUpdate = true; }
    }
  }
  /** The superfans: jumping and waving the flag when the fan cam is on them, swaying otherwise. */
  function fanFrame(dt, live) {
    if (!people.fans) return;
    const on = CK.Hype.extras(gfxLevel()).cheerleaders, t = performance.now() / 1000;
    for (const f of people.fans) {
      f.A.root.visible = on; if (f.flag) { f.flag.flag.visible = on; f.flag.pole.visible = on; }
      if (!on || (!live && cheerN !== 0)) continue;
      const st = { x: f.x, z: f.z, facing: f.face }, beat = t * 2.6 + f.ph;
      let arms = null, y = 0;
      if (live) {
        const h = CK.Anim.gestureHands('cheer', st), w = Math.sin(beat * Math.PI * 2);
        if (f.k === 0) { h.left.y += 0.3 + 0.3 * w; h.right.y += 0.3 - 0.3 * w; }                    // fist pumps
        else if (f.k === 1) { h.right.y += 0.45; h.left.y += 0.15 + 0.2 * w; }                     // the flag high
        else { const mx = (h.left.x + h.right.x) / 2, mz = (h.left.z + h.right.z) / 2, c = 0.5 + 0.5 * w;   // clapping overhead
          h.left.x = lerp(h.left.x, mx, c); h.left.z = lerp(h.left.z, mz, c); h.right.x = lerp(h.right.x, mx, c); h.right.z = lerp(h.right.z, mz, c); h.left.y += 0.35; h.right.y += 0.35; }
        arms = { left: { hand: h.left }, right: { hand: h.right } };
        y = Math.max(0, Math.sin(beat * Math.PI)) * (f.k === 1 ? 0.12 : 0.26);
      }
      CK.poseAthlete(f.A, { x: f.x, z: f.z, facing: f.face + (live ? Math.sin(beat * 2) * 0.2 : Math.sin(t + f.ph) * 0.15), y, run: 0, crouch: live ? 0 : 0.1, arms }, live ? dt : dt * 8);
      if (f.flag) {
        // the pole in the right hand, the flag streaming out and waving
        f.A.B.arms.right.palm.getWorldPosition(_fanP);
        f.flag.pole.position.set(_fanP.x, _fanP.y + 0.55, _fanP.z);
        const g = f.flag.flag;
        g.position.set(_fanP.x, _fanP.y + 1.1, _fanP.z); g.rotation.set(0, f.face + Math.sin(t * 1.7) * 0.35, 0);
        g.translateX(0.75);
        const pos = g.geometry.attributes.position, b = f.flag.base;
        for (let v = 0; v < pos.count; v++) { const px = b[v * 3] + 0.75; pos.array[v * 3 + 2] = Math.sin(px * 4.2 - t * 9) * 0.12 * px; }
        pos.needsUpdate = true;
      }
    }
  }
  const _fanP = new T.Vector3();
  const _cheerP = new T.Vector3(), _bubP = new T.Vector3();
  /** A reaction (CK.Attitude) after a moment: a gesture for a couple of seconds, maybe a chirp. */
  function attitude(ev, by) {
    if (!G.att) return;
    const r = CK.Attitude.react(ev, G.att);
    if (!r) return;
    r.by = by; r.until = performance.now() + r.secs * 1000;
    G.gesture = r;
    if (r.line) paaji('sledge');
    if (r.gesture === 'batRaise') G.batCheer = Math.max(G.batCheer || 0, r.secs);
  }
  const gfxLevel = () => (opt('gfx') === 'AUTO' && !dyn.shadows ? 'LOW' : opt('gfx'));   // AUTO dropped to light: no extras
  const gestureOn = who => { const g = G.gesture; return g && g.who === who && performance.now() < g.until && G.phase !== 'runup' ? g : null; };
  function bubbleFrame() {
    const el = $('bubble'), g = G.gesture;
    const on = g && g.line && performance.now() < g.until && G.phase !== 'runup' && G.screen === 'game';
    if (!on) { el.classList.remove('on'); return; }
    const A = g.who === 'batter' ? people.batter : g.who === 'fielder' ? people.fielders[g.by] : people.bowler;
    if (!A) { el.classList.remove('on'); return; }
    // split-screen: whichever half sees him (each half has its own camera)
    const split = (G.views || []).length > 1, halves = split ? [0, 1] : [0];
    let at = null;
    for (const i of halves) {
      A.root.getWorldPosition(_bubP); _bubP.y += 2.3; _bubP.project(split ? camSt[i].cam : camera);
      if (_bubP.z <= 1 && Math.abs(_bubP.x) <= 1.05 && Math.abs(_bubP.y) <= 1.05) { const w = split ? innerWidth / 2 : innerWidth; at = { x: i * (split ? w : 0) + (_bubP.x + 1) / 2 * w, y: (1 - _bubP.y) / 2 * innerHeight }; break; }
    }
    if (!at) { el.classList.remove('on'); return; }
    el.querySelector('span').textContent = g.line;
    el.style.left = at.x + 'px'; el.style.top = at.y + 'px';
    el.classList.add('on');
  }
  function newBall(first) {
    if (G.att) G.att.ball++;
    if (G.match && G.match.overs > 1 && inn() && inn().balls === (G.match.overs - 1) * 6 && inn().cur.length === 0) paaji('lastOver');
    G.phase = 'ready'; G.phaseT = 0; G.ball = null; G.ballOn = false; G.contact = null; G.outcome = null; G.hold = false;
    G.del = null; G.rel = null; G.path = null; G.cpuPlan = null; G.frames = []; G.stumpsFall = null; G.runs = null; G.fielderPlan = null;
    G.slow = 1; G.tracker = BA.tracker(); G.fed = 0;
    G.celebrate = null; G.batCheer = 0; G.eventFrame = null; G.cutAt = 0; G.keyUp = 0; G.aimRef = null; G.stepT = 0; G.landAt = null; G.tsT = 0;
    G.bowler = { x: armSide() * 1.5, z: -31.5, run: 0, phase: 'mark', relT: 0 };
    ballMesh.visible = false; trail.clear(); trail.push({ x: 0, y: -5, z: 0 }, false);
    resetStumps();
    const prevField = G.field;
    G.field = FI.setField(bowlKind(), batSide());
    if (prevField) G.field.forEach((f, i) => { if (prevField[i] && prevField[i].cur) { f.cur = prevField[i].cur; f.face = prevField[i].face; } });
    hud.speedOff();
    castPlayers();
    prompts();
    if (!first && G.match && G.story) {
      // a new over: who has the ball (and his figures, if he is back for another spell)
      if (inn().balls > 0 && inn().balls % 6 === 0) {
        const nm = bowlerName(), w = CK.Story.bowler(G.story, { inn: G.match.i, bowler: nm });
        banner(w.balls ? 'BACK INTO THE ATTACK' : 'NEW BOWLER', nm.toUpperCase() + (w.balls ? ' · ' + CK.Story.figures(G.story, { inn: G.match.i, bowler: nm }) : ''), 'neutral', 1.8);
      }
      const note = CK.Story.batterNote(G.story, { inn: G.match.i, wk: inn().wkts });
      if (note) paajiLater(note, 700);
    }
    if (!first) updateScorebug();
  }
  function bowlKind() {
    const s = bowlSeat();
    if (s.kind === 'cpu') return G.cpuStyle || 'pace';
    return G.lastSpin ? 'spin' : 'pace';
  }

  // ---------------------------------------------------------------------------------
  // The delivery
  function defaultAim() { return { x: 0.11 * batSide(), len: 5.8 }; }

  function bowlerFrame(dt, now) {
    const s = bowlSeat();
    if (s.kind === 'cpu') { cpuBowlerFrame(dt); return; }
    const inp = s.input;
    const ev = inp.drain();
    if (G.phase === 'ready') {
      // HOLD locks the marker as it was just before the press (the arm is already moving on it)
      for (const e of ev) if (e.kind === 'press' && G.phaseT > 0.5) { startRunup(e.t); return; }
      if (opt('aim') === 'ON') {
        // the marker starts on a good length; once the phone settles in the stance, tilting it from
        // there steers it (any grip: only the change counts, so the phone pointing up is fine)
        if (!G.aimRef) { Object.assign(G.aimSm, defaultAim()); if (G.phaseT > 0.3 && BO.steady(inp.S.samples, 250, 0.06)) { G.aimRef = inp.S.q; G.aimBase = defaultAim(); } }
        // a big quick move (bringing the phone up from the follow-through) is not aiming: settle again
        else if (!BO.steady(inp.S.samples, 150, 0.35)) G.aimRef = null;
        else { const a = BO.tiltAim(G.aimRef, inp.S.q, G.aimBase); G.aimSm.x = lerp(G.aimSm.x, a.x, 0.3); G.aimSm.len = lerp(G.aimSm.len, a.len, 0.3); }
      } else Object.assign(G.aimSm, defaultAim());
    } else if (G.phase === 'runup') {
      if (!G.keyUp) for (const e of ev) if (e.kind === 'release') { G.keyUp = e.t; G.cutAt = 0; break; }
      // the ball leaves at the whip: wait until it has peaked (up to 300 ms after the key)
      if (G.keyUp && BO.whipKnown(inp.S.samples, G.keyUp)) { release(inp, G.keyUp); return; }
      if (G.phaseT > 6) { toast('Run-up called off: let go of ' + keyA(s.mc) + ' to bowl'); newBall(); }
    }
  }
  function startRunup(tPress) {
    G.aim = { x: G.aimSm.x, len: G.aimSm.len };
    const mc = bowlSeat().mc; if (mc && opt('aim') === 'ON') mc.rumble(0.35, 40, 0);   // the marker locks
    G.phase = 'runup'; G.phaseT = 0; G.bowler.phase = 'run'; G.tPress = tPress; G.keyUp = 0;
    G.cutAt = 0.75;                                   // the run-up shot, then back behind the batter
    prompts();
  }
  const NOT_A_BALL = {
    nowhip: ['NO ARM ACTION', 'Whip your arm over the top as you let go'],
    underarm: ['NOT A DELIVERY', 'Underarm: bring the arm over your head'],
    backward: ['NOT A DELIVERY', 'Let go as your arm comes over toward the screen'],
  };
  function release(inp, tUp) {
    const seat = inn().bowl;
    G.seamAlphas = G.seamAlphas || [[], []];
    G.habit = G.habit || [{ dt: [], az: [] }, { dt: [], az: [] }];
    const H = G.habit[seat], auto = opt('lineup') === 'AUTO' && H.dt.length >= 2;
    const rel = BO.readRelease(inp.S.samples, tUp, { tPress: G.tPress, seamRef: BO.seamNeutral(G.seamAlphas[seat]),
      dtRef: auto ? BO.median(H.dt) : null, azRef: auto ? BO.median(H.az) : null });
    logEvent('release', { seat, tPress: G.tPress, tUp, ok: rel.ok, why: rel.why, whip: rel.t, dt: rel.dt, hand: rel.handSpeed, az: rel.az, twist: rel.twist, alpha: rel.alpha, seam: rel.seam, pace: rel.pace, spin: rel.spin, swing: rel.swing, aim: G.aim });
    if (!rel.ok) {
      if (rel.why === 'tap') { toast('Keep holding ' + keyA(bowlSeat().mc) + ' through the run-up, let go as the arm comes over'); G.phase = 'ready'; G.phaseT = 0.6; G.bowler.phase = 'mark'; prompts(); return; }
      const w = NOT_A_BALL[rel.why] || NOT_A_BALL.nowhip;
      banner(w[0], w[1], 'bad', 1.6);
      G.phase = 'void'; G.phaseT = 0;
      return;
    }
    G.seamAlphas[seat].push(rel.alpha);
    H.dt.push(rel.dt); H.az.push(rel.azRaw);
    [G.seamAlphas[seat], H.dt, H.az].forEach(a => { while (a.length > 5) a.shift(); });
    if (H.dt.length === 2 && opt('lineup') === 'AUTO') toast('Line-up set to your action');
    const gain = BO.BOWL.GAIN[opt('control')];
    const del = BO.toDelivery(rel, opt('aim') === 'ON' ? G.aim : defaultAim(), { arm: armSide(), gain, rng, view: 'bowler' });
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
    G.lastSpin = del.spinDir !== 0;
    G.cutAt = 0;
    deliveryCard(del, rel, pr);
    logEvent('delivery', { bowler: inn().bowl, kind: bowlSeat().kind, kmh: del.speed * 3.6, aim: del.aim, target: { x: del.target.x, len: -del.target.z }, pitch: pr.pitch && { x: pr.pitch.x, len: -pr.pitch.z },
      atStumps: { x: atS.x, y: atS.y }, swing: del.swing, spinDir: del.spinDir, spin: rel.spin, tags: G.lastTags });
    G.phase = 'flight'; G.phaseT = 0; G.ballOn = true; G.t = 0;
    G.bowler.phase = 'follow'; G.bowler.relT = 0;
    ballMesh.visible = true; trail.clear();
    SFX.release(del.speed);
    hud.speed(del.speed * 3.6, G.lastTags, G.delCard);
    G.footwork = footworkFor(G.path);
    if (batSeat().kind === 'cpu') {
      const onStumps = !!(atS && Math.abs(atS.x) < 0.15 && atS.y < 0.75);
      G.cpuPlan = BA.cpuShot({ x: atC.x, h: atC.y, len: pr.pitch && pr.pitch.z < -0.3 ? -pr.pitch.z : null, onStumps }, cpuSkill(), rng, batSide());
    }
    prompts();
  }

  // the computer bowler: a style per innings, a varied plan per ball, human-sized errors
  function cpuBowlerFrame(dt) {
    if (G.phase === 'ready' && G.phaseT > 1.0) { G.aim = cpuAim(); G.phase = 'runup'; G.phaseT = 0; G.bowler.phase = 'run'; G.cutAt = 0.85; prompts(); }
    else if (G.phase === 'runup' && G.phaseT > RUN_T + 0.25) {
      const sk = cpuSkill(), spin = G.cpuStyle === 'spin';
      const pace = spin ? rand(78, 92) / 3.6 : rand(128, 146) / 3.6;
      const twist = spin ? (rng() < 0.65 ? 1 : -1) * rand(14, 26) : 0;
      const rel = { ok: true, pace, twist, spin: BO.spinFrom(twist), swing: spin ? 0 : rand(-0.8, 0.8), lenErr: 0, az: 0, cpu: true };
      const a = G.aim;
      const del = BO.toDelivery(rel, { x: a.x + rand(-1, 1) * sk.acc * 0.35, len: a.len + rand(-1, 1) * sk.acc * 2 }, { arm: armSide(), gain: BO.BOWL.GAIN.NORMAL, rng, view: 'bowler' });
      launchDelivery(del, rel);
    }
  }
  function cpuAim() {
    const r = rng(), side = batSide();
    const len = r < 0.1 ? rand(0.6, 1.5) : r < 0.32 ? rand(2.2, 4) : r < 0.78 ? rand(4.5, 7) : r < 0.94 ? rand(7.5, 9.5) : rand(10, 11.5);
    return { len: G.cpuStyle === 'spin' ? clamp(len, 2, 7.5) : len, x: side * rand(-0.05, 0.3) };
  }

  /**
   * What the delivery did against what the bowler meant: where it pitched vs the aim, the timing of
   * the key against the whip, the arm's line, and how far it moved (the same ball without its swing
   * and spin, compared at the stumps). Shown on the speed gun and the pitch map.
   */
  function deliveryCard(del, rel, pr) {
    const lines = [];
    if (!rel.cpu) {
      // how far off the marker, and why: the key's timing (length) and the arm's line (line)
      const miss = Math.hypot(del.lenAdj, del.lineAdj || 0);
      if (miss < 0.25) lines.push(['ON THE MARKER', 'hot']);
      else {
        const why = Math.abs(rel.lenErr || 0) < 0.03 && Math.abs(rel.az || 0) < 0.05 ? 'FLAT OUT SPRAYS IT' : Math.abs(del.lenAdj) >= Math.abs(del.lineAdj || 0)
          ? (rel.lenErr < 0 ? 'LET GO EARLY' : 'LET GO LATE') : ('ARM ' + ((del.lineAdj || 0) > 0 ? 'RIGHT' : 'LEFT') + ' OF LINE');
        lines.push(['MISSED BY ' + miss.toFixed(1) + ' m · ' + why, miss > 0.6 ? 'warn' : '']);
      }
    }
    const plain = Object.assign({}, del, { w: { x: 0, y: 0, z: 0 }, swing: 0, seamKick: 0 });
    const p0 = PH.run(BO.launch(plain), { until: b => b.p.z >= 0 || b.t > 3, samples: false }).end.p;
    const p1 = pr.samples.find(s => s.z >= 0) || pr.samples[pr.samples.length - 1];
    const moved = Math.round((p1.x - p0.x) * 100);
    if (Math.abs(moved) >= 8) lines.push([(del.spinDir ? 'TURNED ' : del.swing ? 'SWUNG ' : 'SEAMED ') + Math.abs(moved) + ' cm ' + (moved < 0 ? '▸' : '◂'), Math.abs(moved) > 25 ? 'hot' : '']);
    G.delCard = { lines, aim: del.aim, pitch: pr.pitch, moved: Math.abs(moved) };
  }
  /** Session log for the recorder (?rec=1): deliveries, shots and results, to study real play. */
  function logEvent(name, data) {
    try { if (window.MimicRec && MimicRec.active) MimicRec.event('ck.' + name, JSON.parse(JSON.stringify(data, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v)))); } catch (e) { /* recorder optional */ }
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
      if (ev === 'bounce' && G.phase === 'flight') { SFX.thud(PH.len(G.ball.v), false); markPitch(p); if (G.ball.bounces === 1) puff(p, 6, Math.min(1.4, PH.len(G.ball.v) / 25)); }
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
    // a phone's blade turns part of the way towards what the ball's height needs (the phone is small
    // and held every which way); timing and the swing's path stay the player's own
    const raw = BA.swingBlade(j.swing), st = BA.stateAt(G.tracker, tA);
    const blade = batSeat().kind === 'phone' ? BA.assistBlade(raw, G.contact.p.y) : raw;
    const push = j.swing.peak < BA.BAT.V_SWING;
    const q = BA.quality(j.e, timingK(), BA.fit(blade, G.contact.p.y), push);
    G.lastTiming = j.e;
    if (q === 'miss') { beaten('miss', j.e); return; }
    const u = batSeat().kind === 'phone' ? BA.contactVelocity(st.u, j.swing.peak, q) : st.u;   // a timed hit keeps its power
    strike({ u, b: blade, e: j.e, q, push });
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
      paaji('beaten');
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
    attitude('appeal'); paaji('appeal');
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
    if (c.wide) { endBallSoon(1.2, { runs: 0, extra: 'wd' }, 'TOO WIDE', 'WIDE'); paaji('wide'); return; }
    endBallSoon(1.0, { runs: 0, extra: noBall() ? 'nb' : null }, c.how === 'leave' ? 'WELL LEFT' : 'PAST THE EDGE', c.how === 'leave' ? 'LEFT ALONE' : 'BEATEN');
  }
  /** A full toss above the waist at the popping crease. */
  function noBall() { const p = G.path; return !!p && (!p.pitch || p.pitch.z > -1.22) && p.heightAtBat > 1.0; }

  // ---------------------------------------------------------------------------------
  // The stroke
  function strike(sw) {
    const c = G.contact, side = batSide();
    const sh = BA.shot({ u: sw.u, b: sw.b, ballV: c.v, ballP: c.p, q: sw.q, e: sw.e, side, push: sw.push, power: BA.BAT.POWER[opt('power')], rng,
      phone: batSeat().kind === 'phone' });
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
    G.eventFrame = G.frames.length;
    if (sh.playedOn) { G.outcome = { type: 'playedon' }; logShot(sw, sh); return; }
    const flight = PH.run(G.ball, { tMax: 14, every: 3 }).samples;
    const bowlerAt = { x: G.bowler.x, z: G.bowler.z };
    G.outcome = FI.resolve(flight, G.field, { rng, bowler: bowlerAt });
    G.outcome.flight = flight;
    const land = flight.find((x, i) => i && !x.air);
    G.landAt = land && sh.loft > 14 && Math.hypot(land.x, land.z) > 14 ? land : null;
    planFielding(G.outcome);
    if (G.outcome.type === 'runs' && G.outcome.runs > 0) G.runs = { n: G.outcome.runs, t0: 0 };
    if (sh.sweet && power > 0.7) crowdReact('cheer', 0.4);
    logShot(sw, sh);
  }
  function logShot(sw, sh) {
    logEvent('shot', { batter: inn().bat, kind: batSeat().kind, e: sw.e, q: sw.q, push: !!sw.push, u: sw.u, shot: sh.kind, speed: sh.speed, az: sh.az, loft: sh.loft, sweet: sh.sweet, edge: sh.edge,
      outcome: G.outcome && { type: G.outcome.type, runs: G.outcome.runs, by: G.outcome.name, t: G.outcome.t } });
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
      if (o.mishap && o.mishap.kind === 'juggle') { G.juggleT = G.t; crowdReact('ooh'); }
      if (noBall()) { banner('NO BALL', 'CAUGHT, BUT IT WAS A NO BALL', 'neutral', 1.8); endBallSoon(1.8, { runs: 0, extra: 'nb' }); return; }
      const bc = bowlSeat().mc; if (bc && bowlSeat().kind === 'phone') bc.rumble(0.8, 140, 3);
      const btc = batSeat().mc; if (btc && batSeat().kind === 'phone') btc.rumble(0.35, 60, 1);
      wicket('CAUGHT', fname(o));
      return;
    }
    if (o.mishap && o.mishap.kind === 'misfield4' && !o.missCalled && G.t >= o.mishap.missT) {
      o.missCalled = true; crowdReact('ooh');
      banner('MISFIELD!', 'THROUGH ' + fname(o).toUpperCase() + "'S HANDS", 'neutral', 1.4);
      attitude('mishap', o.by); paaji('misfield');
    }
    if ((o.type === 'four' || o.type === 'six') && G.t >= o.t) {
      o.done = true;
      const six = o.type === 'six';
      banner(six ? 'SIX!' : 'FOUR!', (G.stroke ? G.stroke.kind : '') + (six ? ' · ' + Math.round(carryOf(o)) + ' M' : ''), 'good', 2.2, true);
      hype(six ? 'six' : 'four', o);
      endBallSoon(six ? 2.4 : 2.0, { runs: six ? 6 : 4, boundary: true, extra: noBall() ? 'nb' : null }, null, null, six);
      return;
    }
    if (o.type === 'runs' && G.t >= o.t && !o.picked) {
      o.picked = true; holdBall(o.by);
      const mk = o.mishap && o.mishap.kind;
      if (mk === 'leaveIt') { banner('LEFT IT!', 'TWO FIELDERS, NOBODY TAKES IT', 'neutral', 1.6); crowdReact('ooh'); attitude('mishap', o.by); paaji('misfield'); }
      else if (mk === 'fumble') { banner('FUMBLE!', fname(o).toUpperCase() + ' · EXTRA RUN', 'neutral', 1.4); crowdReact('ooh'); attitude('mishap', o.by); paaji('misfield'); }
      else if (o.dropped && o.dropped.length) { attitude('drop', o.by); banner('DROPPED!', dropName(o.dropped[0]).toUpperCase() + ' PUTS IT DOWN', 'neutral', 1.6); crowdReact('ooh'); paaji('dropped'); }
      const throwT = Math.max(0.5, o.back - o.t - FI.F.GATHER), fumbleT = mk === 'fumble' ? 0.9 : 0;   // a fumble: he gathers it again
      G.throwBall = { t0: G.t + FI.F.GATHER + fumbleT, dur: throwT, from: null, to: nearerEnd(o.at) };
    }
    if (o.type === 'runs' && o.picked && !o.endQueued) {
      const runsDone = o.runs ? FI.F.RUN1 + (o.runs - 1) * FI.F.RUNN : 0;
      if (G.t >= Math.max(o.back, runsDone) + 0.2) {
        o.endQueued = true;
        const words = ['NO RUN', 'SINGLE', 'TWO RUNS', 'THREE RUNS'][o.runs] || o.runs + ' RUNS';
        endBallSoon(0.9, { runs: o.runs, extra: noBall() ? 'nb' : null }, (G.stroke ? G.stroke.kind + ' · ' : '') + 'TO ' + fname(o).toUpperCase(), words);
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
    G.eventFrame = G.eventFrame || G.frames.length;
    hype('wicket', { how });
    attitude('wicket');
    endBallSoon(2.6, { runs: 0, wicket: how.toLowerCase() }, null, null, true);
  }
  /** Queue the end of this ball: banner words now (optional), record after `after` seconds. */
  function endBallSoon(after, rec, sub, main, replay) {
    if (G.ending) return;
    if (!rec.runs && !rec.extra && !rec.wicket && !rec.boundary) { const bt = G.contact && G.contact.how === 'miss'; attitude(bt ? 'beaten' : 'dot'); if (!bt) paaji('dot'); }
    if (rec.extra === 'nb') paaji('noBall');
    if (main) banner(main, sub || '', rec.extra ? 'neutral' : rec.runs ? 'good' : 'neutral', after);
    G.ending = { t: after, rec, replay: replay && opt('replays') === 'ON' && G.frames.length > 20 };
  }
  function finishBall() {
    const e = G.ending; G.ending = null;
    if (e.replay && !G.replay) { startReplay(() => startCutaway(e.rec, () => recordBall(e.rec))); return; }
    recordBall(e.rec);
  }
  function recordBall(rec) {
    const ib = G.match.i, bw = inn().wkts;
    const before = (G.batRuns && G.batRuns[ib][bw]) || 0;
    if (rec.runs && rec.extra !== 'wd' && G.batRuns) G.batRuns[ib][bw] = before + rec.runs;
    if (before < 20 && G.batRuns && G.batRuns[ib][bw] >= 20) paajiLater('quick20', 2600);
    if (rec.wicket && bw + 1 === 3) paajiLater('threeWickets', 2600);
    if (G.story) CK.Story.ball(G.story, { inn: ib, wk: bw, bowler: bowlerName(), runs: rec.runs || 0, extra: rec.extra || null, wicket: !!rec.wicket });
    const ev = MA.record(G.match, rec);
    logEvent('ball', { rec, label: ev.label, score: [inn().runs, inn().wkts, inn().balls] });
    hud.ballDot(ev.label);
    updateScorebug();
    if (ev.matchOver || (ev.inningsOver && /^nets/.test(G.kind))) { G.phase = 'over'; setTimeout(() => (/^nets/.test(G.kind) ? endNets() : endMatch()), 600); return; }
    if (ev.inningsOver) { inningsBreak(); return; }
    if (rec.wicket && !ev.over) { newBall(); walkOut('wicket'); return; }
    if (rec.wicket) G.pendingWalk = true;
    if (ev.over) { const sm = G.story ? CK.Story.overStart(G.story, { inn: G.match.i, bowler: bowlerName() }) : null; paaji(sm && sm !== 'newBowler' ? sm : Math.random() < 0.5 ? 'newBowler' : 'betweenOvers'); banner('END OF OVER', overSummary(), 'neutral', 1.8); world.crowd.wave = { a: Math.random() * 6.28, t: 6 }; AU.Crowd.chant(2); G.phase = 'between'; G.phaseT = 0; G.betweenT = 1.9; if (bowlSeat().kind === 'cpu') G.cpuStyle = G.cpuStyle === 'spin' ? 'pace' : 'spin'; return; }
    newBall();
  }
  /** The man bowling this over (the bowling side's last five, in turn). */
  function bowlerName() { return CK.Teams.lineup(teamOf(inn().bowl)).bowler(Math.floor(inn().balls / 6)); }
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
  function continueAfterBreak() { showScreen(null); paintTeams(); newBall(true); banner(`${G.match.names[inn().bat]} BATS`, MA.need(G.match).text, 'neutral', 2); walkOut('chase'); }
  /**
   * The striker walks out to the middle: at the start of each innings and after a wicket. The first
   * ball waits for him and for Paaji's line (so the welcome is never cut off); HOLD skips it.
   */
  function walkOut(kind) {
    const name = CK.Teams.lineup(teamOf(inn().bat)).batter(inn().wkts);
    const side = batSide(), dur = kind === 'wicket' ? 3.2 : 4.2;
    G.walk = { t: 0, dur, kind, from: kind === 'wicket' ? { x: -7 * side, z: 11 } : { x: -9 * side, z: 14 } };
    const show = () => { if (G.walk) banner(kind === 'wicket' ? 'NEW BATTER' : 'OPENING THE BATTING', name.toUpperCase() + ' · ' + teamOf(inn().bat).short, 'neutral', 2.2); };
    if (kind === 'wicket') show(); else setTimeout(show, 2300);
    paaji(kind === 'start' ? 'start' : kind === 'chase' ? 'chaseStart' : 'newBatter');
    prompts();
  }
  function walkPos() {
    const W = G.walk, side = batSide(), k = clamp(W.t / W.dur, 0, 1), e = k * (2 - k);
    const to = { x: -0.42 * side, z: -1.0 };
    return { x: lerp(W.from.x, to.x, e), z: lerp(W.from.z, to.z, e), k, dir: Math.atan2(to.x - W.from.x, to.z - W.from.z) };
  }
  function walkFrame(dt) {
    const W = G.walk;
    W.t += dt;
    const skip = skipKey;
    skipKey = false;
    if (skip && W.t > 0.4) { W.t = W.dur; W.skipped = true; }
    // after a wicket the man who is out walks off, head down, crossing the new batter on his way in
    const O = people.outgoing;
    if (W.kind === 'wicket' && O && W.t < W.dur) {
      const w = walkPos(), side = batSide(), k = clamp(W.t / W.dur, 0, 1);
      const fx = Math.sin(w.dir), fz = Math.cos(w.dir);
      const from = { x: -0.42 * side + fz * 2.4, z: -1.0 - fx * 2.4 }, to = { x: W.from.x + fz * 2.4, z: W.from.z - fx * 2.4 };
      const x = lerp(from.x, to.x, k * 0.85), z = lerp(from.z, to.z, k * 0.85);
      O.root.visible = true;
      CK.poseAthlete(O, { x, z, facing: Math.atan2(to.x - from.x, to.z - from.z), twist: 0, crouch: 0.12, run: 0.34, arms: null }, dt);
    } else if (O) O.root.visible = false;
    // done when he is in and Paaji has finished his line (never more than 3.5 s more)
    if (W.t >= W.dur && (W.skipped || !paajiPlayer.speaking || W.t > W.dur + 3.5)) { G.walk = null; G.phaseT = 0; if (O) O.root.visible = false; prompts(); }
  }

  function endMatch() {
    G.phase = 'over'; G.inGame = true;
    const m = G.match, r = MA.result(m), a = m.innings[0], b = m.innings[1];
    $('end-kicker').textContent = r.winner < 0 ? 'WHAT A FINISH' : 'MATCH RESULT';
    $('end-title').textContent = r.winner < 0 ? 'TIED!' : (G.kind === 'versus' ? m.names[r.winner] + ' WINS' : (r.winner === 0 ? 'YOU WIN' : 'CPU WINS'));
    $('end-sub').textContent = r.text;
    $('end-card').innerHTML = [a, b].map(x => `<div class="ec-row" style="--tc:${tcol(x.bat)}"><b>${m.names[x.bat]}</b><span>${x.runs}/${x.wkts}</span><small>${MA.oversText(x.balls)} ov · 4s ${x.fours} · 6s ${x.sixes}</small></div>`).join('');
    showScreen('end');
    if (r.winner >= 0) SFX.fanfare(true);
    if (r.winner >= 0) paaji(G.kind !== 'versus' && r.winner === 1 ? 'lost' : 'won');
    crowdReact('cheer', 0.8);
  }

  function endNets() {
    const m = G.match, a = m.innings[0], you = G.kind === 'nets-bat';
    $('end-kicker').textContent = you ? 'BATTING NETS' : 'BOWLING NETS';
    $('end-title').textContent = you ? `${a.runs} RUNS` : `${a.wkts} WICKET${a.wkts === 1 ? '' : 'S'}`;
    $('end-sub').textContent = you ? `${a.wkts} out · ${a.fours} fours · ${a.sixes} sixes · ${a.dots} dots` : `${a.runs} runs conceded · ${a.dots} dot balls · ${a.extras} extras`;
    $('end-card').innerHTML = a.overs.map((o, i) => `<div class="ec-row" style="--tc:${tcol(a.bat)}"><b>OVER ${i + 1}</b><span>${o.filter(l => /^\d/.test(l)).reduce((s, l) => s + (+l), 0) + o.filter(l => /wd|nb/.test(l)).length}</span><small>${o.join('  ')}</small></div>`).join('');
    showScreen('end');
    SFX.fanfare(false);
  }

  // ---------------------------------------------------------------------------------
  // Fielders and the bowler's body
  function planFielding(o) {
    const plans = G.field.map(f => ({ x: f.x, z: f.z, tx: f.x, tz: f.z, sp: 0, start: FI.F.REACT }));
    const ballDir = o.flight && o.flight.length > 4 ? o.flight[Math.min(o.flight.length - 1, 30)] : null;
    if (o.type === 'caught' && o.at && o.by >= 0 && G.field[o.by]) {
      // leap, dive or a plain take (CK.Anim), judged from where he stood, facing the batter
      const f = G.field[o.by], face = Math.atan2(-f.x, -0.5 - f.z);
      o.action = Object.assign(CK.Anim.fieldAction({ x: f.x, z: f.z, face }, o.at, FI.F.RUN * Math.max(0, o.t - FI.F.REACT)), { face });
    }
    const mis = o.mishap;
    if (mis && mis.kind === 'leaveIt' && o.at && plans[mis.with]) {
      const p2 = plans[mis.with], d2 = Math.hypot(o.at.x - p2.x, o.at.z - p2.z);
      p2.tx = o.at.x + 0.9; p2.tz = o.at.z + 0.4; p2.sp = d2 / Math.max(0.25, o.t - FI.F.REACT);
    }
    plans.forEach((p, i) => {
      if (i === mis?.with && mis.kind === 'leaveIt') return;
      if (i === o.by && o.at) { const d = Math.hypot(o.at.x - p.x, o.at.z - p.z), tAt = mis && mis.kind === 'misfield4' ? mis.missT : o.t; p.tx = o.at.x; p.tz = o.at.z; p.sp = d / Math.max(0.25, tAt - FI.F.REACT); }
      else if (ballDir && i !== 0) {
        const d = Math.hypot(ballDir.x - p.x, ballDir.z - p.z);
        if (d < 30) { p.tx = p.x + (ballDir.x - p.x) * 0.35; p.tz = p.z + (ballDir.z - p.z) * 0.35; p.sp = 4; }
      }
    });
    if ((o.type === 'four' || o.type === 'six') && o.flight) {
      // the nearest outfielder chases it to the rope
      const end = o.flight.find(s => PH.fromCentre(s) > PH.FIELD.R) || o.flight[o.flight.length - 1];
      let bi = 1, bd = 1e9;
      plans.forEach((p, i) => { if (!i || (mis && mis.kind === 'misfield4' && i === o.by)) return; const d = Math.hypot(end.x - p.x, end.z - p.z); if (d < bd) { bd = d; bi = i; } });
      plans[bi].tx = end.x * 0.95; plans[bi].tz = PH.FIELD.CZ + (end.z - PH.FIELD.CZ) * 0.95; plans[bi].sp = 7;
    }
    G.fielderPlan = plans;
  }

  // ---------------------------------------------------------------------------------
  // Stumps
  function resetStumps() {
    const s = world.stumps.bat;
    s.stumps.forEach((x, i) => { x.rotation.set(0, 0, 0); x.position.set((i - 1) * 0.0965, 0, 0); });
    s.bails.forEach((b, i) => { b.position.set((i - 0.5) * 0.0965, 0.72, 0); b.rotation.set(0, 0, Math.PI / 2); });
    G.stumpsFall = null;
  }
  function knockStumps(at) {
    const sp = G.ball ? Math.min(1.5, PH.len(G.ball.v) / 25) : 1;
    G.stumpsFall = { t: 0, x: at.x, sp, bails: [0, 1].map(() => ({ v: { x: rand(-3, 3), y: rand(4.5, 7) * sp, z: rand(3, 6) * sp }, w: rand(14, 26) })),
      stumps: [0, 1, 2].map(i => ({ v: { x: (i - 1) * rand(0.4, 1.2), y: rand(0.5, 2) * sp, z: (2.2 - Math.abs((i - 1) * 0.0965 - at.x) * 8) * sp }, p: { x: 0, y: 0, z: 0 } })) };
    puff({ x: at.x, y: 0.2, z: 0.1 }, 10, 1.6);
    G.shake = 0.28; G.tsT = 0.65;
  }
  function stumpsFrame(dt) {
    const f = G.stumpsFall; if (!f) return;
    f.t += dt;
    const s = world.stumps.bat, k = Math.min(1, f.t / 0.35);
    s.stumps.forEach((st, i) => {
      const hit = Math.max(0, 1 - Math.abs((i - 1) * 0.0965 - f.x) / 0.2), m = f.stumps && f.stumps[i];
      st.rotation.x = Math.min(1.45, (0.35 + hit * 1.1) * k * (1 + f.t * 0.6));
      st.rotation.z = (i - 1) * 0.25 * k;
      if (m && hit > 0.2 && st.position.y > -0.01) {   // the stump that took it cartwheels out of the ground
        m.v.y -= 9.8 * dt; m.p.x += m.v.x * dt * hit; m.p.y = Math.max(0, m.p.y + m.v.y * dt * hit); m.p.z += m.v.z * dt * hit;
        st.position.set((i - 1) * 0.0965 + m.p.x, m.p.y, m.p.z);
      }
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
    if (G.walk && G.walk.t < G.walk.dur) {
      // walking out to the crease, bat under the arm
      const w = walkPos();
      const st = { x: w.x, z: w.z, facing: w.dir, twist: 0, crouch: 0, run: 0.42, arms: null };
      return { st, bat: { p: { x: w.x - 0.3 * Math.cos(w.dir), y: 0.72, z: w.z + 0.3 * Math.sin(w.dir) }, q: BA.batQuat(0.5, 0, 'vertical') } };
    }
    const st = { x, z, facing: side * Math.PI / 2, twist: 0.45 * side + clamp(Math.atan2(b.x, -b.z) * 0.25, -0.5, 0.5) * (Math.abs(b.y) < 0.8 ? 1 : 0.2), crouch: 0.35, run: 0,
      arms: side > 0 ? { left: { hand: hands }, right: { hand: low } } : { right: { hand: hands }, left: { hand: low } } };
    if (runOff) { st.z = runOff.z; st.x = 0.9 * side; st.facing = runOff.dir > 0 ? 0 : Math.PI; st.run = runOff.dir ? 1 : 0; st.arms = null; st.twist = 0; st.crouch = 0; }
    if (G.batCheer > 0 && !runOff) {
      // a boundary: the bat goes up to the crowd, face toward the camera
      const hu = { x: x + 0.1 * side, y: 2.25, z: z + 0.05 };
      st.facing = 0.35 * side; st.twist = 0; st.crouch = 0.05;
      st.arms = side > 0 ? { left: { hand: hu }, right: { hand: { x: hu.x, y: hu.y - 0.09, z: hu.z } } } : { right: { hand: hu }, left: { hand: { x: hu.x, y: hu.y - 0.09, z: hu.z } } };
      return { st, bat: { p: hu, q: BA.batQuat(Math.PI * 0.95, 0, 'vertical') } };
    }
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
    const sw = -side;   // world x of the bowling arm's side
    const markZ = -31.5, creaseZ = BO.BOWL.FROM_Z - 0.75, cx = sw * 0.55;
    if (B.phase === 'mark') { B.x = sw * 1.2; B.z = markZ; }
    else if (B.phase === 'run') {
      const k = clamp(G.phaseT / RUN_T, 0, 1), e = k * (2 - k);
      B.x = lerp(sw * 1.2, cx, e); B.z = lerp(markZ, creaseZ, e);
      if (k >= 1) B.run = Math.max(0.2, B.run - dt * 4);
    } else if (B.phase === 'follow') {
      B.relT += dt;
      const k = clamp(B.relT / 1.1, 0, 1), e = k * (2 - k);
      B.x = lerp(cx, sw * 2.6, e); B.z = lerp(creaseZ, -14.5, e);
      B.run = (1 - k) * 0.8;
    }
    // the bowling arm: the phone's own direction, the room turned half round into the ground
    let r;
    const seat = bowlSeat();
    if (seat.kind === 'cpu') r = cpuArmDir();
    else r = halfTurn(BO.rotate(seat.input.S.q, { x: 0, y: 0, z: -1 }));
    const arm = side > 0 ? 'right' : 'left';
    const cel = G.celebrate && G.celebrate.t > 0 ? Math.min(1, G.celebrate.t * 4) : 0;
    return { x: B.x, z: B.z, facing: 0, run: B.run, crouch: 0, armDir: r, arm, lean: B.phase === 'follow' ? 0.25 * (1 - cel) : 0, cel };
  }
  function cpuArmDir() {
    const B = G.bowler;
    let phi = -2.6;
    if (G.phase === 'runup') { const k = clamp((G.phaseT - (RUN_T - 0.15)) / 0.4, 0, 1); phi = -2.6 + k * 2.75; }
    else if (B.phase === 'follow') phi = 0.15 + clamp(B.relT / 0.35, 0, 1) * 2.3;
    return halfTurn(BO.rotate(BO.armQuat(phi, 0, 0), { x: 0, y: 0, z: -1 }));
  }
  const halfTurn = v => ({ x: -v.x, y: v.y, z: -v.z });
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
        const dx = f.x - f.cur.x, dz = f.z - f.cur.z, d = Math.hypot(dx, dz), step = Math.min(d, (d > 4 ? 10 : 6) * dt);   // back to the mark before the next ball
        if (d > 0.05) { f.cur.x += dx / d * step; f.cur.z += dz / d * step; }
        if (d > 0.6) f.face = Math.atan2(dx, dz);
        f.run = d > 0.6 ? 0.85 : Math.max(0, (f.run || 0) - dt * 3);
      } else f.run = Math.max(0, (f.run || 0) - dt * 3);
      const ballP = G.ball ? G.ball.p : null;
      const face = f.run > 0.2 ? f.face : Math.atan2(-f.cur.x, -f.cur.z - 1);
      const st = { x: f.cur.x, z: f.cur.z, facing: f.keeper && G.phase !== 'hit' ? Math.PI : face, run: f.run || 0, crouch: f.keeper ? (G.phase === 'hit' ? 0.2 : 0.85) : (G.phase === 'flight' ? 0.3 : 0.1) };
      if (ballP && G.phase === 'hit' && G.outcome && G.outcome.by === i) {
        const d = Math.hypot(ballP.x - f.cur.x, ballP.z - f.cur.z);
        const held = G.ballHeldBy === i, act = G.outcome.action;
        if (act) {
          const ap = CK.Anim.actionPose(act, G.t - G.outcome.t);
          st.y = (st.y || 0) + ap.y; st.roll = ap.roll;
          if (ap.roll) { st.facing = act.face; st.run = 0; }
        }
        if (d < 3 || held) {
          if (!held && d > 0.2 && !st.roll) st.facing = Math.atan2(ballP.x - f.cur.x, ballP.z - f.cur.z);   // turn to the ball (not mid-dive)
          const fw = CK.Anim.forwardOf(st.facing);
          const at = held ? { x: f.cur.x + fw.x * 0.28, y: 1.1, z: f.cur.z + fw.z * 0.28 } : { x: ballP.x, y: clamp(ballP.y, 0.2, 2.9), z: ballP.z };
          const pr = CK.Anim.handPair(at, st.facing, 0.07);   // his left hand on his left, whichever way he faces
          st.arms = { left: { hand: pr.left }, right: { hand: pr.right } };
        }
      }
      const g = G.gesture && performance.now() < G.gesture.until && G.phase !== 'runup' ? G.gesture : null;
      if (g && !st.arms && G.ballHeldBy !== i) {
        const who = g.who === 'fielder' && g.by === i ? g.gesture : g.gesture === 'appeal' && f.keeper ? 'appeal' : null;
        if (who) { const h = CK.Anim.gestureHands(who, st); if (h) st.arms = { left: { hand: h.left }, right: { hand: h.right } }; }
        else if (g.huddle && !f.keeper && (G.phase !== 'hit' || (G.outcome && G.outcome.type === 'caught' && G.outcome.done && G.ballHeldBy !== i))) {
          // the wicket huddle: the nearer fielders run in to the bowler, arms up once they get there
          const bx = G.bowler.x + Math.sin(i * 2.1) * 1.6, bz = G.bowler.z + Math.cos(i * 2.1) * 1.6;
          const dx = bx - f.cur.x, dz = bz - f.cur.z, d = Math.hypot(dx, dz);
          if (d < 32) {
            if (d > 0.6) { const step = Math.min(d, 6.5 * dt); f.cur.x += dx / d * step; f.cur.z += dz / d * step; st.x = f.cur.x; st.z = f.cur.z; st.facing = Math.atan2(dx, dz); st.run = 1; }
            else { st.facing = Math.atan2(G.bowler.x - f.cur.x, G.bowler.z - f.cur.z); const h = CK.Anim.gestureHands('cheer', st); st.arms = { left: { hand: h.left }, right: { hand: h.right } }; st.run = 0; }
          }
        }
      }
      return st;
    });
  }

  /** Everything the renderer needs this frame. */
  function liveFrame(dt) {
    if (batSeat().kind === 'cpu') cpuBatFrame();
    const b = batterState(dt);
    const side = batSide(), aside = armSide();
    const ns = { x: aside * 2.6, z: -PH.PITCH.L - 1.2, facing: 0, run: 0, crouch: 0.1 };
    const rp = G.runs && G.phase === 'hit' ? runProgress() : null;
    if (rp) { ns.z = -2 - (PH.PITCH.L - 1.2) - rp.z; ns.run = rp.dir ? 1 : 0; ns.facing = rp.dir > 0 ? Math.PI : 0; ns.x = -0.9 * side; }
    let ballP = G.ball && (G.ballOn || G.phase === 'hit') ? { x: G.ball.p.x, y: G.ball.p.y, z: G.ball.p.z } : null;
    if (G.ballHeldBy !== undefined && G.ballHeldBy !== null && G.field[G.ballHeldBy]) {
      const f = G.field[G.ballHeldBy].cur || G.field[G.ballHeldBy], fw = CK.Anim.forwardOf(G.field[G.ballHeldBy].face || 0);
      ballP = { x: f.x + fw.x * 0.28, y: 1.12, z: f.z + fw.z * 0.28 };   // in his hands, in front of him
      if (G.juggleT !== undefined && G.juggleT !== null && G.t - G.juggleT < 0.75) ballP.y += 0.55 * Math.sin(Math.PI * (G.t - G.juggleT) / 0.75);   // juggled, then held
      const th = G.throwBall;
      if (th && G.t >= th.t0) {
        const k = clamp((G.t - th.t0) / th.dur, 0, 1);
        if (!th.from) th.from = ballP;
        ballP = { x: lerp(th.from.x, th.to.x, k), y: lerp(th.from.y, th.to.y, k) + Math.sin(k * Math.PI) * Math.min(9, th.dur * 3.5), z: lerp(th.from.z, th.to.z, k) };
      }
    }
    if (G.phase === 'ready' || G.phase === 'runup') ballP = null;
    if (G.ball && G.ballOn && dt > 0) {
      const w = G.ball.w, wl = Math.hypot(w.x, w.y, w.z);
      const vis = wl > 1 ? wl * 0.09 : PH.len(G.ball.v) * 0.6;   // spinners: the seam tumbling; a hit: rolling
      _ax.set(wl > 1 ? w.x : 1, wl > 1 ? w.y : 0, wl > 1 ? w.z : 0).normalize();
      ballQ.premultiply(_dq.setFromAxisAngle(_ax, vis * dt));
    }
    return { batter: b.st, bat: b.bat, bowler: bowlerState(dt), ns, fielders: fielderStates(dt), ball: ballP, ballQ: ballP ? [ballQ.x, ballQ.y, ballQ.z, ballQ.w] : null,
      umpire: { x: aside * 1.35, z: -PH.PITCH.L - 2.4, facing: 0, run: 0, crouch: 0.15, out: G.umpireOut || 0 } };
  }
  function applyFrame(F, dt) {
    if (!people.ready) return;
    CK.poseAthlete(people.batter, F.batter, dt);
    batMesh.visible = true;
    batMesh.position.set(F.bat.p.x, F.bat.p.y, F.bat.p.z);
    batMesh.quaternion.set(F.bat.q.x, F.bat.q.y, F.bat.q.z, F.bat.q.w);
    const bw = F.bowler, A = people.bowler;
    // a gesture (send-off, appeal) takes his arms once the celebration has had its moment
    const bg = gestureOn('bowler'), gh = bg && (!bw.cel || G.celebrate.t > 1.0) ? CK.Anim.gestureHands(bg.gesture, bw) : null;
    const bArms = gh ? { left: { hand: gh.left }, right: { hand: gh.right } } : bw.cel ? { left: { hand: { x: bw.x + 0.35, y: 2.45, z: bw.z + 0.15 } }, right: { hand: { x: bw.x - 0.35, y: 2.45, z: bw.z + 0.15 } } } : null;
    if (gh) bw.cel = bw.cel || 1;   // keep the phone's arm out of it
    CK.poseAthlete(A, { x: bw.x, z: bw.z, facing: bw.facing, run: bw.run, crouch: bw.crouch, lean: bw.lean, y: bw.cel && !gh ? Math.abs(Math.sin(performance.now() / 160)) * 0.18 * bw.cel : 0, arms: bArms }, dt);
    const sh = CK.boneWorld(A, bw.arm === 'left' ? 'UpperArmL' : 'UpperArmR', new T.Vector3());
    const r = bw.armDir;
    const hand = { x: sh.x + r.x * 0.66, y: sh.y + r.y * 0.66, z: sh.z + r.z * 0.66 };
    const armB = A.B.arms[bw.arm];
    if (!bw.cel) {
      CK.aimBone(armB.upper, armB.lower, { x: sh.x + r.x * 0.32 - 0.02, y: sh.y + r.y * 0.32 - 0.03, z: sh.z + r.z * 0.32 + 0.04 });
      CK.aimBone(armB.lower, armB.palm, hand);
    }
    CK.poseAthlete(people.nonStriker, F.ns, dt);
    const u = F.umpire;
    const uArms = u.out ? { right: { hand: { x: u.x - 0.25, y: 2.25, z: u.z + 0.15 } } } : null;
    CK.poseAthlete(people.umpire, Object.assign({}, u, { arms: uArms }), dt);
    F.fielders.forEach((st, i) => CK.poseAthlete(people.fielders[i], st, dt));
    // the ball: in the bowler's hand before the release
    if (F.ball) {
      ballMesh.visible = true; ballMesh.position.set(F.ball.x, F.ball.y, F.ball.z);
      if (F.ballQ) ballMesh.quaternion.set(F.ballQ[0], F.ballQ[1], F.ballQ[2], F.ballQ[3]);
    }
    else if (G.phase === 'ready' || (G.phase === 'runup' && !G.keyUp)) { ballMesh.visible = true; ballMesh.position.copy(hand); }
    else ballMesh.visible = false;
    const fast = G.ball && PH.len(G.ball.v) > 14;
    trail.push(ballMesh.position, ballMesh.visible && fast && (G.phase === 'flight' || G.phase === 'hit') && !G.replayStill, camera.position);
    ballShadow.visible = ballMesh.visible && ballMesh.position.y < 25;
    if (ballShadow.visible) {
      const hgt = ballMesh.position.y;
      ballShadow.position.set(ballMesh.position.x + hgt * 0.12, 0.02, ballMesh.position.z + hgt * 0.08);
      ballShadow.scale.setScalar(1 + hgt * 0.35); ballShadow.material.opacity = clamp(0.55 - hgt * 0.05, 0.08, 0.55);
    }
    // the halo keeps the ball readable from far away: the follow shot, and from the bowler's end
    halo.visible = ballMesh.visible && (G.phase === 'hit' || (G.phase === 'flight' && camera.position.distanceTo(ballMesh.position) > 12));
    if (halo.visible) { halo.position.copy(ballMesh.position); const d = camera.position.distanceTo(ballMesh.position); halo.scale.setScalar(Math.max(0.25, d * 0.012)); }
  }

  // ---------------------------------------------------------------------------------
  // Replays: the frames since the release, played back slower from another angle
  function snapshot(F) {
    if (G.phase !== 'flight' && G.phase !== 'hit') return;
    G.frames.push({ F: JSON.parse(JSON.stringify(F)), stumps: world.stumps.bat.stumps.map(s => [s.rotation.x, s.rotation.z, s.position.x, s.position.y, s.position.z]), bails: world.stumps.bat.bails.map(b => [b.position.x, b.position.y, b.position.z, b.rotation.x]), cam: G.camMode });
    if (G.frames.length > 60 * 9) G.frames.shift();
  }
  function startReplay(done) {
    const frames = G.frames.slice();
    // from 0.8 s before the bat (or the stumps) to 1.6 s after: a short highlight, not the whole ball
    const ev = G.eventFrame != null ? G.eventFrame : Math.max(0, frames.length - 90);
    const i0 = Math.max(0, ev - 48), i1 = Math.min(frames.length - 1, ev + 100);
    G.replay = { frames, t: 0, done, start: i0, end: i1 };
    bugText('REPLAY'); $('replay-bug').classList.add('on'); $('hud').classList.add('replaying');
    SFX.sting();
  }
  function replayFrame(dt) {
    const R = G.replay;
    R.t += dt * 0.6 * 60;
    const i = Math.min(R.end, R.start + Math.floor(R.t));
    const fr = R.frames[i];
    G.replayStill = false;
    applyFrame(fr.F, dt * 0.6);
    world.stumps.bat.stumps.forEach((s, k) => { s.rotation.x = fr.stumps[k][0]; s.rotation.z = fr.stumps[k][1]; s.position.set(fr.stumps[k][2], fr.stumps[k][3], fr.stumps[k][4]); });
    world.stumps.bat.bails.forEach((b, k) => { b.position.set(fr.bails[k][0], fr.bails[k][1], fr.bails[k][2]); b.rotation.x = fr.bails[k][3]; });
    replayCamera(fr.F, dt);
    if (i >= R.end || R.skip) {
      G.replay = null; $('replay-bug').classList.remove('on'); $('hud').classList.remove('replaying');
      R.done();
    }
  }

  /**
   * After the replay of a six: the stadium cam on the cheerleaders' special number, then the fan
   * cam on the batting side's painted superfans. After a wicket's replay, sometimes, the bowling
   * side's fans. HOLD, Space or a click skips.
   */
  function bugText(t) { const b = $('replay-bug'); b.lastChild.textContent = t; }
  function startCutaway(rec, done) {
    const six = rec.boundary && rec.runs === 6, wk = !!rec.wicket;
    const shots = six ? ['cheer', 'fans'] : wk && Math.random() < 0.6 ? ['fans'] : [];
    if (!shots.length || !people.fans || !CK.Hype.extras(gfxLevel()).cheerleaders || opt('replays') !== 'ON') { done(); return; }
    paintFans(six ? inn().bat : inn().bowl);
    G.cutaway = { shots, i: -1, t: 0, shot: null, done };
    nextCut();
  }
  function nextCut() {
    const C = G.cutaway;
    C.i++; C.t = 0; C.shot = C.shots[C.i];
    if (!C.shot) { G.cutaway = null; $('replay-bug').classList.remove('on'); $('hud').classList.remove('replaying'); C.done(); return; }
    C.dur = C.shot === 'cheer' ? 2.1 : 2.6;
    if (C.shot === 'cheer') { G.cheerSpecial = 2.0; bugText('STADIUM CAM'); if (Math.random() < 0.5) paaji('cheerCam'); }
    else { bugText('FAN CAM'); paaji('fanCam'); crowdReact('cheer', 0.6); }
    $('replay-bug').classList.add('on'); $('hud').classList.add('replaying');
    C.first = true;
  }
  function cutawayFrame(dt) {
    const C = G.cutaway;
    if (seats.some(x => x.kind === 'phone' && x.mc && x.mc.pressed('a')) || skipKey) { C.shots.length = C.i + 1; C.t = C.dur; }
    skipKey = false;
    C.t += dt;
    if (G.cheerSpecial > 0) G.cheerSpecial -= dt;
    cheerFrame(dt);
    // the camera: in front of the platform (the cheer cam) or right up close to the superfans
    let x, z, face, h, d, fov;
    if (C.shot === 'cheer') { const c = people.cheer[4]; x = c.plat.position.x; z = c.plat.position.z; face = c.face; h = 1.95; d = 8.5; fov = 32; }
    else { const f = people.fans[1]; x = f.x; z = f.z; face = f.face; h = 1.75; d = 5.6; fov = 38; }
    const fx = Math.sin(face), fz = Math.cos(face), drift = C.t * 0.35;
    _p.set(x + fx * d - fz * (1.3 - drift), h + 0.35, z + fz * d + fx * (1.3 - drift)); _l.set(x, h, z);
    cam.mode = 'cut'; G.camMode = 'cut'; G.views = ['cut']; $('hud').classList.remove('split');
    setCam(_p, _l, fov, C.first ? 1 : 1 - Math.exp(-dt * 4)); C.first = false;
    applyCamTo(cam, dt, innerWidth / innerHeight);
    if (C.t >= C.dur) nextCut();
  }

  // ---------------------------------------------------------------------------------
  // Cameras. Each player watches from his own end: the batter from behind the stumps, the
  // bowler from behind his own arm, bowling into the screen and following the ball down to the
  // batter. Solo: the human's end. Two players: split screen while the ball is bowled (P1 left,
  // P2 right, each half at its player's end), one full-screen broadcast shot once it is hit.
  const camera2 = new T.PerspectiveCamera(30, innerWidth / 2 / innerHeight, 0.1, 2000);
  const camSt = [
    { p: new T.Vector3(0, 30, 40), l: new T.Vector3(0, 0, -10), fov: 42, mode: null, cam: camera },
    { p: new T.Vector3(0, 30, 40), l: new T.Vector3(0, 0, -10), fov: 42, mode: null, cam: camera2 },
  ];
  const cam = camSt[0];   // the main view (replays)
  function setCamOn(st, p, l, fov, k) { st.p.lerp(p, k); st.l.lerp(l, k); st.fov = lerp(st.fov, fov, k); }
  function setCam(p, l, fov, k) { setCamOn(cam, p, l, fov, k); }
  const _p = new T.Vector3(), _l = new T.Vector3();
  /** A shot everyone shares (big moments): the celebration, the catch, the ball in play. */
  function sharedShot() {
    if (G.celebrate && G.celebrate.t > 0 && G.celebrate.t < G.celebrate.dur) return 'celebrate';
    const o = G.outcome;
    if (G.phase === 'hit' && o && o.type === 'caught' && G.t >= o.t - 0.5 && G.field[o.by]) return 'catch';
    if (G.phase === 'hit' && G.ball && o && o.type !== 'playedon' && G.phaseT > 0.15) return 'follow';
    return null;
  }
  /** The live views this frame: one full screen, or two halves in a two-player match. */
  function planViews() {
    if (!G.inGame || !G.match) return ['title'];
    if (G.walk && G.walk.t < G.walk.dur + 0.2) return ['walkout'];
    const sh = sharedShot();
    if (sh) return [sh];
    const role = i => (inn().bowl === i ? 'bowl' : 'bat');
    if (G.kind === 'versus' && seats[0].kind !== 'cpu' && seats[1].kind !== 'cpu') return [role(0), role(1)];
    if (bowlSeat().kind !== 'cpu') return ['bowl'];
    if (G.phase === 'runup' && G.phaseT < (G.cutAt || 0) && !G.keyUp) return ['runup'];
    return ['bat'];
  }
  /** Where shot `shot` puts view state st. split: a half-width view. */
  function shotCam(shot, st, dt, F, split) {
    const side = G.inGame && G.match ? batSide() : 1;
    const cut = shot !== st.mode;
    let k = cut ? 1 : 1 - Math.exp(-dt * 3);
    if (shot === 'title') {
      const a = performance.now() / 1000 * 0.05;
      _p.set(Math.sin(a) * 48, 18, PH.FIELD.CZ + Math.cos(a) * 48); _l.set(0, 2, PH.FIELD.CZ);
      setCamOn(st, _p, _l, 46, 1 - Math.exp(-dt * 1.5));
    } else if (shot === 'follow') {
      // broadcast follow: high behind the batter's end, panning and pushing toward the ball
      const b = G.ballHeldBy !== null && G.ballHeldBy !== undefined && F.ball ? F.ball : G.ball.p;
      const d = Math.hypot(b.x, b.z - Z_CONTACT);
      const dir = d > 0.5 ? { x: b.x / d, z: (b.z - Z_CONTACT) / d } : { x: 0, z: -1 };
      const back = 16 + d * 0.25;
      _p.set(b.x - dir.x * back * 0.9, 9 + d * 0.16 + Math.max(0, b.y - 6) * 0.5, b.z - dir.z * back + 4);
      const r = Math.hypot(_p.x, _p.z - PH.FIELD.CZ);
      if (r > 76) { _p.x *= 76 / r; _p.z = PH.FIELD.CZ + (_p.z - PH.FIELD.CZ) * 76 / r; }
      _l.set(b.x, Math.max(0.5, b.y * 0.8), b.z);
      if (cut) { st.p.set(0.4 * side, 6, 9); st.l.set(b.x, 1, b.z); k = 1 - Math.exp(-dt * 6); }
      else k = 1 - Math.exp(-dt * 4);
      setCamOn(st, _p, _l, clamp(38 - d * 0.08 + Math.max(0, b.y - 8) * 0.4, 30, 44), k);
    } else if (shot === 'catch') {
      const f = G.field[G.outcome.by].cur || G.field[G.outcome.by];
      const dx = -f.x, dz = Z_CONTACT - f.z, dl = Math.hypot(dx, dz) || 1;
      _p.set(f.x + dx / dl * 6.5 - dz / dl * 2, 1.9, f.z + dz / dl * 6.5 + dx / dl * 2); _l.set(f.x, 1.3, f.z);
      setCamOn(st, _p, _l, 30, cut ? 1 : 1 - Math.exp(-dt * 5));
    } else if (shot === 'celebrate') {
      const B = G.bowler;
      _p.set(B.x + 1.2 * armSide(), 1.7, B.z + 6.5); _l.set(B.x, 1.45, B.z);
      setCamOn(st, _p, _l, 32, cut ? 1 : 1 - Math.exp(-dt * 4));
    } else if (shot === 'walkout') {
      // in front of the striker as he walks out, backing toward the crease with him
      const w = walkPos(), fx = Math.sin(w.dir), fz = Math.cos(w.dir);
      _p.set(w.x + fx * 5.6 - fz * 1.6, 1.8, w.z + fz * 5.6 + fx * 1.6); _l.set(w.x, 1.55, w.z);
      setCamOn(st, _p, _l, 36, cut ? 1 : 1 - Math.exp(-dt * 5));
    } else if (shot === 'runup') {
      // end-on to the bowler, running in at the camera, then cut back behind the batter
      const B = G.bowler;
      _p.set(B.x - 3.2 * armSide(), 1.75, B.z + 9.5); _l.set(B.x * 0.6, 1.25, B.z - 2);
      setCamOn(st, _p, _l, 34, cut ? 1 : 1 - Math.exp(-dt * 8));
    } else if (shot === 'bowl') {
      // behind the bowler's arm: over his shoulder at the mark, following him to the crease, then
      // holding there while the ball goes down to the batter (a long lens, as on TV)
      const B = G.bowler, sw = -armSide();
      const z = Math.min(B.z - 7, -26.3);
      _p.set(sw * 0.75 + B.x * 0.25, 3.3, z); _l.set(0, 0.75, -1.5);
      setCamOn(st, _p, _l, split ? 30 : 24, cut || (G.phase === 'ready' && G.phaseT < 0.1) ? 1 : 1 - Math.exp(-dt * 6));
    } else {
      // behind the batter: the delivery comes toward the camera (higher when the keeper stands up)
      const up = G.field && G.field[0] && G.field[0].z < 5;
      _p.set(0.55 * side, up ? 2.7 : 2.15, up ? 7.2 : 6.6); _l.set(0.05 * side, up ? 0.9 : 1.05, -14);
      setCamOn(st, _p, _l, split ? 46 : 40, cut || (G.phase === 'ready' && G.phaseT < 0.1) ? 1 : k);
    }
    st.mode = shot;
  }
  function updateCamera(dt, F) {
    const plan = planViews();
    G.views = plan;
    plan.forEach((shot, i) => {
      const st = camSt[i];
      shotCam(shot, st, dt, F, plan.length > 1);
      applyCamTo(st, dt, plan.length > 1 ? innerWidth / 2 / innerHeight : innerWidth / innerHeight);
    });
    G.camMode = plan.length > 1 ? 'split' : plan[0];
    $('hud').classList.toggle('split', plan.length > 1);
    if (plan.length > 1) {
      [0, 1].forEach(i => { const t = $('half' + i); t.querySelector('b').textContent = seats[i].name; t.querySelector('span').textContent = plan[i] === 'bowl' ? 'BOWLING' : 'BATTING'; t.style.setProperty('--tc', tcol(i)); });
    }
    fadeOccluders(plan, F);
  }
  /**
   * Nobody blocks the play: anyone standing between a camera and what matters in its shot (the
   * batter, the stumps, the bowler's release, the ball, the catcher) fades to nothing. With two
   * views, blocking either one fades the person.
   */
  const _o = new T.Vector3(), _q2 = new T.Vector3(), _q3 = new T.Vector3();
  function fadeOccluders(plan, F) {
    if (!people.ready) return;
    const side = G.match ? batSide() : 1, o = G.outcome;
    const keep = new Set();
    if (plan.includes('catch') || plan.includes('follow')) { if (o && o.by >= 0) keep.add(people.fielders[o.by]); }
    if (plan.some(s => s === 'celebrate' || s === 'runup' || s === 'bowl' || s === 'replay')) keep.add(people.bowler);
    const views = plan.map((shot, i) => {
      const focus = [];
      if (shot === 'bat' || shot === 'runup' || shot === 'bowl') focus.push({ x: -0.3 * side, y: 1.4, z: -1 }, { x: 0, y: 0.4, z: 0 }, { x: 0.3, y: 2.1, z: -18.6 }, { x: 0, y: 0.2, z: -9 });
      if (shot === 'runup' || shot === 'bowl') focus.push({ x: G.bowler.x, y: 1.3, z: G.bowler.z });
      if (shot === 'bowl' && G.aim) focus.push({ x: G.aim.x, y: 0.05, z: -G.aim.len });
      if (F && F.ball) focus.push(F.ball);
      if ((shot === 'catch' || shot === 'follow') && o && G.field[o.by]) { const f = G.field[o.by].cur || G.field[o.by]; focus.push({ x: f.x, y: 1.2, z: f.z }); }
      if (shot === 'celebrate') focus.push({ x: G.bowler.x, y: 1.4, z: G.bowler.z });
      const C = camSt[i].cam.position;
      return { shot, C, cam: camSt[i].cam, focus, batD: C.distanceTo(_q2.set(-0.42 * side, 1, -1)) - 0.6 };
    });
    const list = [...people.fielders, people.umpire, people.nonStriker, people.bowler];
    for (const A of list) {
      if (!A || keep.has(A)) { if (A) A.setOpacity(Math.min(1, A.opacity + 0.15)); continue; }
      let block = false;
      for (const v of views) {
        const C = v.C;
        A.root.getWorldPosition(_o); _o.y = 1.0;
        for (const f of v.focus) {
          const fx = f.x - C.x, fy = f.y - C.y, fz = f.z - C.z, L2 = fx * fx + fy * fy + fz * fz;
          const t = ((_o.x - C.x) * fx + (_o.y - C.y) * fy + (_o.z - C.z) * fz) / (L2 || 1);
          if (t <= 0.02 || t >= 0.93) continue;
          const px = C.x + fx * t - _o.x, py = C.y + fy * t - _o.y, pz = C.z + fz * t - _o.z;
          if (px * px + py * py * 0.35 + pz * pz < 0.7 * 0.7) { block = true; break; }
        }
        // behind the batter: nobody nearer the camera than the striker stays in the frame
        if (!block && v.shot === 'bat' && _o.distanceTo(C) < v.batD) {
          _q2.copy(_o).project(v.cam); _o.y = 0.1; _q3.copy(_o).project(v.cam);
          if (Math.abs(_q2.x) < 1.15 && Math.min(_q2.y, _q3.y) < 1 && _q2.z < 1) block = true;
        }
        if (_o.distanceTo(C) < 2.2) block = true;
        if (block) break;
      }
      A.setOpacity(block ? Math.max(0, A.opacity - 0.25) : Math.min(1, A.opacity + 0.1));
    }
  }
  function replayCamera(F, dt) {
    const side = batSide();
    const b = F.ball || { x: 0, y: 1, z: 0 };
    const first = cam.mode !== 'replay'; cam.mode = 'replay'; G.camMode = 'replay'; G.views = ['replay'];
    $('hud').classList.remove('split');
    if (Math.hypot(b.x, b.z) < 14) { _p.set(-7.5 * side, 1.5, -3.5); _l.set(b.x * 0.4, 0.7, b.z * 0.5 - 0.6); setCam(_p, _l, 30, first ? 1 : 1 - Math.exp(-dt * 6)); }
    else { _p.set(b.x * 0.5 - 6, 6 + b.y * 0.4, Math.min(8, b.z * 0.5 + 12)); _l.set(b.x, b.y, b.z); setCam(_p, _l, 34, first ? 1 : 1 - Math.exp(-dt * 3)); }
    applyCamTo(cam, dt, innerWidth / innerHeight);
    fadeOccluders(['replay'], F);
  }
  function applyCamTo(st, dt, aspect) {
    const c = st.cam;
    c.position.copy(st.p);
    if (G.shake > 0 && st === cam) { G.shake = Math.max(0, G.shake - dt * 0.6); c.position.x += (Math.random() - 0.5) * G.shake; c.position.y += (Math.random() - 0.5) * G.shake; }
    c.lookAt(st.l);
    if (Math.abs(c.fov - st.fov) > 0.01 || Math.abs(c.aspect - aspect) > 1e-3) { c.fov = st.fov; c.aspect = aspect; c.updateProjectionMatrix(); }
  }
  /** Draw the views: full screen, or two halves side by side. */
  function renderViews() {
    const w = innerWidth, h = innerHeight, plan = G.views || ['title'];
    renderer.shadowMap.needsUpdate = true;
    if (plan.length > 1 && !G.dbgCam) {
      renderer.setScissorTest(true);
      [0, 1].forEach(i => {
        const x = i * w / 2;
        renderer.setViewport(x, 0, w / 2, h); renderer.setScissor(x, 0, w / 2, h);
        renderer.render(scene, camSt[i].cam);
        renderer.shadowMap.needsUpdate = false;
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
    } else renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------------------------
  // The broadcast: crowd, horns and drums, fireworks, celebrations, commentary
  const pick = a => a[(Math.random() * a.length) | 0];
  let captionT = 0;
  function say(text, hold) {
    const el = $('caption');
    el.querySelector('span').textContent = text;
    el.classList.add('on');
    captionT = hold || 2.2;
  }
  function hype(kind, info) {
    const ex = CK.Hype.extras(gfxLevel());
    const hz = G.match && inn() ? CK.Hype.crowd(kind, { batting: teamOf(inn().bat).id, bowling: teamOf(inn().bowl).id }) : null;
    if (hz) {
      if (hz.groan) setTimeout(() => AU.Crowd.react('ooh', 0.3), 300);   // the other half of the ground
      if (hz.band) SFX.band(kind);
      if (hz.dance) G.dance = 4;
      if (ex.placards && hz.placards.length) world.placards.show(hz.placards, teamOf(0).id === hz.roar ? 1 : -1, CK.Teams.byId(hz.roar).css, 3.2);
    }
    if (kind === 'six') {
      crowdReact('roar'); world.crowd.excite = 1.6; SFX.horn(); SFX.drums(12); flash(0.35);
      world.boards.flash(3, true); AU.Crowd.chant(2);
      world.screen({ big: 'SIX!', sub: G.stroke ? G.stroke.kind : '', hot: 4, col: '#2fd3c3' });
      const o = info.flight && (info.flight.find(s => PH.fromCentre(s) > PH.FIELD.R) || info.flight[info.flight.length - 1]);
      const ax = o ? o.x : 0, az = o ? o.z : -60, d = Math.hypot(ax, az - PH.FIELD.CZ) || 1;
      for (let i = 0; i < Math.round(10 * ex.fireworks); i++) {
        const a = Math.atan2(ax, az - PH.FIELD.CZ) + (i - 4.5) * 0.2 + (Math.random() - 0.5) * 0.1, r = PH.FIELD.R + 22;
        world.fx.burst({ x: Math.sin(a) * r, y: 36 + Math.random() * 14, z: PH.FIELD.CZ + Math.cos(a) * r }, i * 0.16 + (i > 5 ? 0.6 : 0));
      }
      void d;
      G.batCheer = 2.2;
      attitude('six');
      paaji('six');
    } else if (kind === 'four') {
      crowdReact('cheer', 0.85); world.crowd.excite = 1.15; SFX.drums(8); flash(0.2); world.boards.flash(2, true); AU.Crowd.chant(1);
      world.screen({ big: 'FOUR!', sub: G.stroke ? G.stroke.kind : '', hot: 3, col: '#ffc24d' });
      G.batCheer = 1.4;
      attitude('four');
      paaji(G.stroke && G.stroke.edge ? 'edgeFour' : 'four');
    } else if (kind === 'wicket') {
      crowdReact('roar'); world.crowd.excite = 1.3; SFX.horn(); SFX.drums(6); flash(0.25); world.boards.flash(2);
      world.screen({ big: 'OUT!', sub: info.how, hot: 3.5, col: '#ff6b7e' });
      for (let i = 0; i < Math.round(4 * ex.fireworks); i++) { const a = Math.PI + (i - 1.5) * 0.35; world.fx.burst({ x: Math.sin(a) * 84, y: 38 + Math.random() * 8, z: PH.FIELD.CZ + Math.cos(a) * 84 }, 0.5 + i * 0.2); }
      G.celebrate = { t: -0.55, dur: 1.7 };
      const h = info.how;
      // three wickets on three balls running: the hat-trick call instead
      const i0 = inn(), wb = G.wkBalls || (G.wkBalls = []);
      const cur = { inn: G.match.i, ball: i0.balls, bowler: CK.Teams.lineup(teamOf(i0.bowl)).bowler(Math.floor(i0.balls / 6)) };
      const hat = CK.Hype.hatTrick(wb, cur);
      wb.push(cur);
      paaji(hat ? 'hatTrick' : h === 'BOWLED' ? 'bowled' : h === 'PLAYED ON' ? 'playedOn' : h === 'LBW' ? 'lbw' : 'caught');
    }
  }

  // ---------------------------------------------------------------------------------
  // HUD
  const hud = {
    speed(kmh, tags, card) {
      $('gun-val').textContent = Math.round(kmh);
      $('gun-tags').innerHTML = tags.map(t => `<span>${t}</span>`).join('');
      $('gun-card').innerHTML = card ? card.lines.map(([t, c]) => `<span class="${c}">${t}</span>`).join('') : '';
      $('gun').classList.add('on');
      const aim = $('pmap-aim');
      if (card && card.aim && bowlSeat().kind !== 'cpu') {
        const p = pmapPos({ x: card.aim.x, z: -card.aim.len }, batSide());
        aim.style.top = p.top; aim.style.left = p.left; aim.classList.add('on');
        $('pmap-dot').classList.remove('on');
        $('pmap').classList.add('on');
      } else aim.classList.remove('on');
    },
    speedOff() { $('pmap-aim').classList.remove('on'); $('pmap-dot').classList.remove('on'); $('gun').classList.remove('on'); $('shot').classList.remove('on'); $('pmap').classList.remove('on'); pitchMark.material.opacity = 0; },
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
      const dot = $('pmap-dot'), q = pmapPos(p, side);
      dot.style.top = q.top; dot.style.left = q.left; dot.classList.add('on');
      $('pmap').classList.add('on');
    },
    ballDot() { renderOver(); },
  };
  /** Pitch-map coordinates (seen from the bowler's end: the batter at the bottom). */
  function pmapPos(p, side) {
    const L = clamp(-p.z, -0.5, 12), x = clamp(p.x * side, -1.4, 1.4);
    return { top: (6 + (1 - L / 12) * 82).toFixed(1) + '%', left: (50 + x / 1.6 * 50).toFixed(1) + '%' };
  }
  function renderOver() {
    const cur = inn().cur;
    $('sb-over').innerHTML = cur.map(l => `<i class="${l === 'W' ? 'w' : l === '4' || l === '6' ? 'b' : /wd|nb/.test(l) ? 'x' : ''}">${l === '•' ? '' : l}</i>`).join('') + '<i class="next"></i>'.repeat(Math.max(0, 6 - cur.filter(l => !/wd|nb/.test(l)).length));
  }
  function updateScorebug() {
    if (!G.match) return;
    const m = G.match, i = inn();
    $('sb-team').textContent = m.names[i.bat];
    $('sb-team').style.setProperty('--tc', tcol(i.bat));
    $('sb-score').textContent = `${i.runs}-${i.wkts}`;
    $('sb-overs').textContent = `${MA.oversText(i.balls)}/${m.overs}`;
    const nd = MA.need(m);
    $('sb-info').textContent = nd ? nd.text : `RUN RATE ${MA.runRate(i).toFixed(2)}`;
    const bl = CK.Teams.lineup(teamOf(i.bat)), wl = CK.Teams.lineup(teamOf(i.bowl)), br = (G.batRuns && G.batRuns[m.i][i.wkts]) || 0;
    $('sb-bowler').innerHTML = `<b style="color:${tcol(i.bat)}">${bl.batter(i.wkts)}</b> ${br}* · <b style="color:${tcol(i.bowl)}">${wl.bowler(Math.floor(i.balls / 6))}</b> BOWLING`;
    world.screen({ score: `${m.names[i.bat]}  ${i.runs}-${i.wkts}`, sub: `${MA.oversText(i.balls)} OVERS · ` + (nd ? nd.text : 'RUN RATE ' + MA.runRate(i).toFixed(2)) });
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
      if (G.walk) bp = 'The batter is walking in · <b>Space</b> skips';
      else if (G.phase === 'ready') bp = (opt('aim') === 'ON' ? (G.aimRef ? 'Tilt to move the marker, ' : 'Hold the phone still, ') : '') + `<b>hold ${keyA(bs.mc)}</b> to run in`;
      else if (G.phase === 'runup') bp = `Whip your arm over, <b>let go of ${keyA(bs.mc)}</b> as it comes over`;
      else bp = G.phase === 'runup' ? 'Whip it over…' : 'Wrist twist = spin · wrist turned = swing';
    } else bp = G.cpuStyle === 'spin' ? 'Computer: spin' : 'Computer: pace';
    if (ts.kind !== 'cpu') tp = G.phase === 'ready' || G.phase === 'runup' ? `Phone down like a bat · <b>${keyC(ts.mc)}</b> to align · swing as it arrives` : 'Swing through it · keep still to leave';
    else tp = 'Computer batting';
    $('prompt-bowl').innerHTML = `<em style="background:${tcol(inn().bowl)}">${seats[inn().bowl].name}</em> ${bp}`;
    $('prompt-bat').innerHTML = `<em style="background:${tcol(inn().bat)}">${seats[inn().bat].name}</em> ${tp}`;
  }

  // ---------------------------------------------------------------------------------
  // Screens, menus, options
  function showScreen(name) {
    G.screen = name || 'game';
    $('bubble').classList.remove('on');
    ['title', 'lobby', 'pause', 'break', 'end', 'solo'].forEach(n => $(n).classList.toggle('hidden', n !== name));
    if (name === 'title' || name === 'lobby' || name === 'solo') $('hud').classList.add('hidden');
    refreshFocus();
  }
  function toTitle() {
    G.inGame = false; G.match = null; G.phase = 'idle'; G.paused = false; G.replay = null; G.ending = null; G.walk = null; G.cutaway = null; G.pendingWalk = false;
    $('replay-bug').classList.remove('on');
    ballMesh.visible = false; batMesh.visible = false; aimRing.visible = false; trail.clear();
    showScreen('title'); setPanel('main');
  }
  function setPaused(v, why) {
    if (!G.inGame || G.phase === 'over') return;
    G.paused = v;
    if (v) $('bubble').classList.remove('on');
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
    if (k === 'team0' || k === 'team1') return CK.Teams.byId(v).name.toUpperCase();
    if (k === 'vol' || k === 'commVol') return Math.round(v * 100) + '%';
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
    // the two seats never share a team: skip over the other seat's
    if (k === 'team0' || k === 'team1') {
      const ids = OPTS[k].vals, other = k === 'team0' ? 'team1' : 'team0';
      settings[k] = ids.indexOf(CK.Teams.pickOther(ids[settings[k]], ids[settings[other]], d));
    }
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
    else if (act === 'restart') { G.walk = null; G.cutaway = null; G.pendingWalk = false; const k = G.kind; G.replay = null; G.ending = null; $('replay-bug').classList.remove('on'); startMatch(k); }
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
      el.querySelector('.s-role').textContent = teamOf(i).name.toUpperCase() + ' · ' + (lobby.st.firstBat === i ? 'BATS FIRST' : 'BOWLS FIRST');
      el.style.setProperty('--tc', tcol(i));
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
      : phones < 2 ? `${phones} of 2 phones connected. Open Mimic in Grip mode${qrOn() ? ' (or scan the code)' : ''}, then press <b>${joinKey()}</b>.` : `Press <b>${joinKey()}</b> on each phone to take a seat.`;
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
  /** Is the scan-to-join QR available here (mimic-link hides it when there is no relay)? */
  const qrOn = () => { const e = document.querySelector('.mimic-scan'); return !!e && !e.hidden && e.childElementCount > 0; };
  function updateCtrlStatus() {
    const k = isPhone(mc) + ctrlMode(mc) + mc.via + qrOn();
    if (k === ctrlKey) return;
    ctrlKey = k;
    const el = $('title-ctrl');
    el.classList.toggle('phone', isPhone(mc));
    el.querySelector('span').textContent = isPhone(mc) ? 'Phone connected · ' + (ctrlMode(mc) === 'grip' ? 'Grip' : 'Wand') : 'Using mouse';
    el.querySelector('small').innerHTML = isPhone(mc) ? `Point at a button, <b>${mc.keyName('a')}</b> picks.` : 'Open Mimic on your phone in <b>Grip</b> mode' + (qrOn() ? ', or scan the code.' : '.');
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
  let lastNow = performance.now(), skipKey = false;
  const skippable = () => G.replay || G.cutaway || G.walk;
  addEventListener('keydown', e => { if (skippable() && (e.key === ' ' || e.key === 'Enter')) { skipKey = true; e.preventDefault(); } });
  addEventListener('pointerdown', () => { if (skippable()) skipKey = true; });
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
    if (G.celebrate) G.celebrate.t += dt;
    bubbleFrame();
    if (G.batCheer > 0) G.batCheer -= dt;
    if (G.dance > 0) G.dance -= dt;
    cheerFrame(dt);
    // stump mic: the bowler's feet on the run-up, quicker and louder toward the crease
    if (G.phase === 'runup' && G.bowler.run > 0.3 && G.phaseT < RUN_T) { G.stepT -= dt; if (G.stepT <= 0) { G.stepT = 0.34 - 0.12 * G.phaseT / RUN_T; SFX.step(0.6 + 0.6 * G.phaseT / RUN_T); } }
    if (G.walk) walkFrame(dt);
    else if (G.phase === 'ready' || G.phase === 'runup') bowlerFrame(dt, now);
    if (G.cheerSpecial > 0) G.cheerSpecial -= dt;
    if (G.phase === 'void' && G.phaseT > 1.6) newBall();
    if (G.phase === 'between' && G.phaseT > G.betweenT) { newBall(); if (G.pendingWalk) { G.pendingWalk = false; walkOut('wicket'); } }
    // the aim spot
    const showAim = G.phase === 'ready' && !G.walk && bowlSeat().kind !== 'cpu' && opt('aim') === 'ON';
    aimRing.visible = showAim || (G.phase === 'runup' && bowlSeat().kind !== 'cpu' && opt('aim') === 'ON');
    if (aimRing.visible) {
      const a = G.phase === 'runup' ? G.aim : G.aimSm;
      aimRing.position.set(a.x, 0.015, -a.len);
      // yellow and pulsing while it steers, grey until the phone settles, red once locked
      aimRing.material.color.setHex(G.phase === 'runup' ? 0xff3b30 : G.aimRef ? 0xffd36b : 0xb8b8b8);
      aimRing.material.opacity = G.phase === 'runup' ? 0.95 : G.aimRef ? 0.7 + 0.25 * Math.sin(now / 160) : 0.5;
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
    if (G.phase === 'ready' && G.phaseT < dt * 1.5) { G.umpireOut = 0; G.ballHeldBy = null; G.throwBall = null; G.stroke = null; G.juggleT = null; }
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
    if (G.replay) {
      // HOLD on any phone, Space or a click skips the highlight
      if (seats.some(x => x.kind === 'phone' && x.mc && x.mc.pressed('a')) || skipKey) G.replay.skip = true;
      skipKey = false;
      replayFrame(rdt);
    }
    else if (G.cutaway) cutawayFrame(rdt);
    else {
      let ts = 1;
      if (G.tsT > 0) { G.tsT -= rdt; ts = 0.3; }
      const oc = G.outcome;
      if (G.phase === 'hit' && oc && oc.type === 'caught' && G.t > oc.t - 0.4 && G.t < oc.t + 0.25) ts = 0.3;
      const sdt = rdt * ts;
      if (G.inGame && !G.paused && G.screen === 'game' && G.phase !== 'over') gameFrame(sdt, now);
      if (G.inGame && G.match && people.ready) { F = liveFrame(G.paused ? 0 : sdt); applyFrame(F, G.paused ? 0 : sdt); snapshot(F); }
      dustFrame(sdt);
      landRing.material.opacity = G.phase === 'hit' && G.landAt && G.ball && G.ballOn && !G.ball.bounces ? 0.55 + 0.35 * Math.sin(now / 120) : Math.max(0, landRing.material.opacity - rdt * 2);
      if (G.landAt) landRing.position.set(G.landAt.x, 0.03, G.landAt.z);
      // the crowd's hum: up as the bowler runs in, loudest with the ball in the air
      if (G.inGame) AU.Crowd.setTension(G.phase === 'runup' ? 0.45 + Math.min(0.4, G.phaseT * 0.3) : G.phase === 'flight' ? 0.9 : G.phase === 'hit' ? 0.7 : 0.15);
      else if (people.ready) idleScene(rdt);
      updateCamera(rdt, F || {});
    }
    if (bannerT > 0) { bannerT -= rdt; if (bannerT <= 0) $('banner').classList.remove('on'); }
    if (toastT > 0) { toastT -= rdt; if (toastT <= 0) $('toast').classList.remove('on'); }
    if (captionT > 0) { captionT -= rdt; if (captionT <= 0) $('caption').classList.remove('on'); }
    world.crowd.update(rdt);
    world.tick(rdt);
    if (G.dbgCam) { const d = G.dbgCam; camera.position.set(d.p[0], d.p[1], d.p[2]); camera.lookAt(d.l[0], d.l[1], d.l[2]); camera.fov = d.fov || 35; camera.updateProjectionMatrix(); }
    renderViews();
  }
  /** Title screen: the players warm up in the middle. */
  function idleScene(dt) {
    batMesh.visible = true;
    cheerFrame(dt);
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
    inn: () => G.match && inn(), hype, say, planViews, knockStumps, attitude, paaji, paajiPlayer, walkOut, startCutaway,
  };
})();
