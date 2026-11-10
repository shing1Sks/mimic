/*
 * Iron Ludus - game loop: input, the sword in your hand, the duel, HUD, screens.
 * Rules live in combat.js (tested); this file wires them to the phone and the scene.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat, Sfx = LudusAudio;
  const mc = new MimicController();
  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------ renderer */
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // resolution scales itself to hold the frame rate (see frame()): swings are only as good as the samples
  const PR_MAX = Math.min(devicePixelRatio || 1, 1.5), PR_MIN = 0.6;
  renderer.setPixelRatio(Math.min(PR_MAX, 1.25));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  $('stage').appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(68, 1, 0.03, 500);
  scene.add(camera);
  const ov = $('overlay'), og = ov.getContext('2d');
  let W = 1, H = 1, aspect = 1;
  function resize() {
    W = innerWidth; H = innerHeight; aspect = W / H;
    renderer.setSize(W, H); camera.aspect = aspect; camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio || 1, 2); ov.width = W * dpr; ov.height = H * dpr; og.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  const PLAYER = new T.Vector3(0, 0, 5), EYE = 1.65;

  /* -------------------------------------------------------------- assets */
  const MODELS = ['recruit', 'axeman', 'skeleton', 'wolf', 'troll', 'champion'];
  const assets = { models: {} };
  const TEXTURES = ['aerial_sand_diff_1k.jpg', 'aerial_sand_nor_gl_1k.jpg', 'aerial_sand_rough_1k.jpg', 'large_sandstone_blocks_01_diff_1k.jpg',
    'large_sandstone_blocks_01_nor_gl_1k.jpg', 'sandstone_blocks_08_diff_1k.jpg', 'sandstone_blocks_08_nor_gl_1k.jpg'];
  /** Load everything a couple of files at a time, retrying: simple static servers refuse bursts. */
  function loadAll() {
    const L = new T.GLTFLoader(), IL = new T.ImageLoader();
    assets.images = {};
    const jobs = [];
    MODELS.forEach(n => jobs.push(() => L.loadAsync('assets/models/' + n + '.glb').then(g => { assets.models[n] = g; })));
    for (const n of ['arch', 'torch', 'axe', 'shield']) jobs.push(() => L.loadAsync('assets/models/' + n + '.glb').then(g => { assets[n] = g.scene; }));
    TEXTURES.forEach(n => jobs.push(() => IL.loadAsync('assets/tex/' + n).then(img => { assets.images['assets/tex/' + n] = img; })));
    jobs.push(() => new T.RGBELoader().setDataType(T.FloatType).loadAsync('assets/hdr/sky.hdr').then(t => { assets.hdr = t; }));
    let next = 0, done = 0;
    const retry = (job, n) => job().catch(e => n > 0 ? new Promise(r => setTimeout(r, 400 + (8 - n) * 500)).then(() => retry(job, n - 1)) : Promise.reject(e));
    const worker = () => {
      if (next >= jobs.length) return Promise.resolve();
      const job = jobs[next++];
      return retry(job, 8).then(() => { done++; $('load-fill').style.width = (100 * done / jobs.length) + '%'; }).then(worker);
    };
    return Promise.all([worker(), worker()]);
  }

  /* ------------------------------------------------------- your sword arm */
  // A rig is the sword, the gloved fist around its grip, the forearm, upper arm and the shield, all in
  // the space of the camera that holds them. The single-player view has one; versus has one per player.
  const BLADE = 0.82, GUARD_Z = -0.09;
  const RIG_OFFSET = new T.Vector3(-0.03, 0.2, -0.05); // bring the hand and hilt into view
  function buildSword() {
    const g = new T.Group();
    const steel = new T.MeshStandardMaterial({ color: 0xe4e8ee, metalness: 1, roughness: 0.22, envMapIntensity: 1.3 });
    const shape = new T.Shape();
    shape.moveTo(-0.027, 0); shape.lineTo(-0.024, BLADE - 0.13); shape.lineTo(0, BLADE); shape.lineTo(0.024, BLADE - 0.13); shape.lineTo(0.027, 0); shape.lineTo(-0.027, 0);
    const bg = new T.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.006, bevelSegments: 1, steps: 1 });
    bg.translate(0, 0, -0.0015); bg.rotateX(-Math.PI / 2); bg.rotateZ(Math.PI / 2);
    const blade = new T.Mesh(bg, steel); blade.position.z = GUARD_Z - 0.005; g.add(blade);
    const fuller = new T.Mesh(new T.BoxGeometry(0.0072, 0.012, BLADE * 0.62), new T.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.35 }));
    fuller.position.z = GUARD_Z - 0.03 - BLADE * 0.31; g.add(fuller);
    const brass = new T.MeshStandardMaterial({ color: 0xc89b45, metalness: 1, roughness: 0.3 });
    const guard = new T.Mesh(new T.BoxGeometry(0.026, 0.17, 0.026), brass); guard.position.z = GUARD_Z; g.add(guard);
    for (const s of [-1, 1]) { const k = new T.Mesh(new T.SphereGeometry(0.014, 10, 8), brass); k.position.set(0, s * 0.085, GUARD_Z); g.add(k); }
    const grip = new T.Mesh(new T.CylinderGeometry(0.017, 0.019, 0.16, 10), new T.MeshStandardMaterial({ color: new T.Color(0x3b2314).convertSRGBToLinear(), roughness: 0.75 }));
    grip.rotation.x = Math.PI / 2; grip.position.z = GUARD_Z + 0.09; g.add(grip);
    const pommel = new T.Mesh(new T.SphereGeometry(0.03, 12, 10), brass); pommel.position.z = GUARD_Z + 0.18; g.add(pommel);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    return g;
  }
  /** A leather gauntlet closed round the grip: four curled fingers, a riveted back plate, the thumb over the top. */
  function buildFist(glove, plate) {
    const g = new T.Group();
    const finger = new T.TorusGeometry(0.027, 0.0115, 8, 14, Math.PI * 1.45);
    for (let i = 0; i < 4; i++) {
      const f = new T.Mesh(finger, glove);
      f.position.z = GUARD_Z + 0.036 + i * 0.024;
      f.rotation.z = Math.PI * 0.32 + i * 0.05;           // the curl opens toward the thumb
      f.scale.set(1, 1, 1.05 - i * 0.06);
      g.add(f);
    }
    const back = new T.Mesh(new T.BoxGeometry(0.026, 0.07, 0.105), glove);
    back.position.set(0.033, -0.004, GUARD_Z + 0.085); back.rotation.z = 0.15; g.add(back);
    const knuckles = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.1, 10, 1, false, 0, Math.PI), plate);
    knuckles.rotation.x = Math.PI / 2; knuckles.rotation.y = -Math.PI / 2 + 0.15; knuckles.position.set(0.042, -0.004, GUARD_Z + 0.082); g.add(knuckles);
    for (let i = 0; i < 3; i++) { const r = new T.Mesh(new T.SphereGeometry(0.0045, 6, 4), plate); r.position.set(0.06, -0.004, GUARD_Z + 0.05 + i * 0.03); g.add(r); }
    const thumb = new T.Mesh(new T.CapsuleGeometry(0.013, 0.045, 4, 8), glove);
    thumb.rotation.x = Math.PI / 2 - 0.25; thumb.position.set(-0.012, 0.03, GUARD_Z + 0.055); g.add(thumb);
    const cuff = new T.Mesh(new T.CylinderGeometry(0.05, 0.043, 0.06, 14, 1, true), glove);
    cuff.rotation.x = Math.PI / 2; cuff.position.set(0.012, -0.004, GUARD_Z + 0.165); g.add(cuff);
    return g;
  }
  function makeRig(parent, tint) {
    const R = { armState: {}, fadeLimb: 1, fadeHand: 1 };
    R.rig = new T.Group(); R.rig.position.copy(RIG_OFFSET); parent.add(R.rig);
    R.hand = new T.Group(); R.rig.add(R.hand);
    R.swordGrp = buildSword(); R.hand.add(R.swordGrp);
    // the arm's materials fade when it comes between your eyes and the fight (see fadeArm)
    const mat = (color, rough, env, metal) => { // colours are picked by eye (sRGB); the renderer works in linear
      const m = new T.MeshStandardMaterial({ color, roughness: rough, envMapIntensity: env, metalness: metal || 0, transparent: true });
      m.color.convertSRGBToLinear(); return m;
    };
    R.limbMats = [mat(0x4a2d1a, 0.8, 0.35), mat(0x3a3029, 0.42, 0.7, 0.65), mat(tint || 0x6b1a14, 0.9, 0.3)];
    R.handMats = [mat(0x3b2416, 0.72, 0.4), mat(0x8a7350, 0.35, 0.9, 0.85)];
    R.handMats.forEach(m => { m.transparent = false; }); // the fist never fades: it holds the sword
    R.fist = buildFist(R.handMats[0], R.handMats[1]); R.hand.add(R.fist);
    R.forearm = new T.Mesh(new T.CylinderGeometry(0.044, 0.035, 1, 14), R.limbMats[0]); R.rig.add(R.forearm);
    R.bracer = new T.Mesh(new T.CylinderGeometry(0.049, 0.043, 0.13, 14), R.limbMats[1]); R.rig.add(R.bracer);
    R.upperArm = new T.Mesh(new T.CylinderGeometry(0.058, 0.047, 1, 14), R.limbMats[2]); R.rig.add(R.upperArm);
    R.armParts = [R.forearm, R.bracer, R.upperArm, R.fist];
    for (const m of R.armParts) m.traverse(o => { o.renderOrder = 5; });
    R.shieldGrp = new T.Group(); R.rig.add(R.shieldGrp);
    addShield(R);
    return R;
  }
  function addShield(R) {
    if (!assets.shield || R.shieldModel) return;
    R.shieldModel = assets.shield.clone(); R.shieldModel.scale.setScalar(0.22);
    R.shieldModel.traverse(o => { if (o.isMesh) { o.renderOrder = 5; o.castShadow = false; } });
    R.shieldGrp.add(R.shieldModel);
    // the side you see: oak planks, a leather arm strap and grip, an iron rim (the model's inside was a flat grey disc)
    R.shieldGrp.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(R.shieldModel), inv = new T.Matrix4().copy(R.shieldGrp.matrixWorld).invert();
    box.applyMatrix4(inv);
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    const rad = Math.min(box.max.x - box.min.x, box.max.y - box.min.y) / 2 * 0.97;
    const back = new T.Mesh(new T.CircleGeometry(rad, 40), new T.MeshStandardMaterial({ map: shieldBackTex(), roughness: 0.85, envMapIntensity: 0.4 }));
    back.position.set(cx, cy, box.min.z - 0.003); back.rotation.y = Math.PI;
    R.shieldGrip = new T.Vector3(cx, cy, box.min.z - 0.05); // where a forearm meets its inside (versus: the rival's body holds it here)
    const rim = new T.Mesh(new T.TorusGeometry(rad, 0.012, 6, 40), new T.MeshStandardMaterial({ color: 0x5a5550, metalness: 0.8, roughness: 0.45 }));
    rim.position.copy(back.position);
    for (const m of [back, rim]) { m.renderOrder = 5; R.shieldGrp.add(m); }
  }
  let shieldTex = null;
  function shieldBackTex() {
    if (shieldTex) return shieldTex;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 6; i++) { // planks
      const x = i * 256 / 6, l = rnd(26, 36);
      g.fillStyle = `hsl(28, 42%, ${l}%)`; g.fillRect(x, 0, 256 / 6, 256);
      for (let k = 0; k < 26; k++) { // grain
        g.strokeStyle = `hsla(25, 40%, ${l - rnd(6, 14)}%, ${rnd(0.25, 0.6)})`; g.lineWidth = rnd(0.5, 1.5);
        const gx = x + rnd(2, 256 / 6 - 2); g.beginPath(); g.moveTo(gx, 0); g.bezierCurveTo(gx + rnd(-4, 4), 90, gx + rnd(-4, 4), 170, gx + rnd(-3, 3), 256); g.stroke();
      }
      g.fillStyle = 'rgba(20,10,4,0.7)'; g.fillRect(x, 0, 2, 256);
    }
    const strap = (y, h) => {
      g.fillStyle = '#3a2214'; g.fillRect(0, y, 256, h);
      g.fillStyle = 'rgba(255,220,180,0.12)'; g.fillRect(0, y, 256, 2);
      g.fillStyle = '#b9b2a6';
      for (const x of [20, 236]) { g.beginPath(); g.arc(x, y + h / 2, 4, 0, 7); g.fill(); }
    };
    strap(84, 22); strap(150, 26);
    const grd = g.createRadialGradient(128, 128, 60, 128, 128, 132); // weathered edge
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(10,5,2,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    shieldTex = new T.CanvasTexture(c); shieldTex.encoding = T.sRGBEncoding; shieldTex.anisotropy = 4;
    return shieldTex;
  }
  const R0 = makeRig(camera);
  const rig = R0.rig;

  const UP = new T.Vector3(0, 1, 0), tmpV = new T.Vector3(), tmpV2 = new T.Vector3(), tmpQ = new T.Quaternion();
  function placeLimb(mesh, a, b) {
    tmpV.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = tmpV.length();
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.normalize());
    mesh.scale.set(1, len, 1);
  }
  /*
   * The arm must never block the fight. Raising the phone high swings the arm model's forearm up
   * between your eyes and the opponent (it filled a quarter of the screen). The sword and the hilt stay
   * exactly where they are (everything is judged on the drawn blade), but any part of the arm that
   * comes close to the eyes inside the middle of the view fades out, and returns as it leaves.
   */
  const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  function intrusion(cam, p) { // p: point in rig space -> 0 (harmless) .. 1 (right in your face)
    const x = p.x + RIG_OFFSET.x, y = p.y + RIG_OFFSET.y, d = -(p.z + RIG_OFFSET.z);
    if (d < 0.01) return 0;
    const tv = Math.tan(cam.fov * Math.PI / 360), th = tv * cam.aspect;
    const r = 0.06; // the arm is thick: judge its inner side, not its axis
    const edge = Math.max((Math.abs(x) - r) / (d * th), (Math.abs(y) - r) / (d * tv));
    return (1 - smooth01(0.35, 0.8, edge)) * (1 - smooth01(0.3, 0.55, d));
  }
  function fadeArm(R, cam, arm, wrist, dt) {
    let limb = 0;
    const L = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
    for (let k = 0; k <= 4; k++) limb = Math.max(limb, intrusion(cam, L(arm.elbow, wrist, k / 4)));
    for (let k = 1; k <= 2; k++) limb = Math.max(limb, intrusion(cam, L(arm.shoulder, arm.elbow, k / 2)));
    const e = Math.min(1, dt * 14);
    R.fadeLimb += (1 - Math.min(1, limb * 1.6) - R.fadeLimb) * e;
    const setO = (mats, o) => mats.forEach(m => { m.opacity = o; m.depthWrite = o > 0.98; });
    setO(R.limbMats, R.fadeLimb);
    R.forearm.visible = R.bracer.visible = R.upperArm.visible = R.fadeLimb > 0.03;
  }
  /**
   * Put a rig's sword and arm where the phone says. q: display orientation (THREE.Quaternion), arm: arm
   * pose (camera space), o = { thrustT, shieldT, side: 'left'|'right', dt }. Returns the blade in world space.
   */
  function poseRig(R, cam, q, arm, o) {
    R.hand.quaternion.copy(q);
    R.hand.position.set(arm.hand.x, arm.hand.y, arm.hand.z);
    if (o.thrustT > 0) { const f = Math.sin(Math.min(1, o.thrustT / 0.28) * Math.PI); R.hand.position.add(tmpV.set(0, 0, -0.32 * f).applyQuaternion(q)); }
    const hp = R.hand.position;
    const wrist = { x: hp.x - (arm.hand.x - arm.wrist.x), y: hp.y - (arm.hand.y - arm.wrist.y), z: hp.z - (arm.hand.z - arm.wrist.z) };
    placeLimb(R.forearm, arm.elbow, wrist);
    const bp = { x: arm.elbow.x + (wrist.x - arm.elbow.x) * 0.8, y: arm.elbow.y + (wrist.y - arm.elbow.y) * 0.8, z: arm.elbow.z + (wrist.z - arm.elbow.z) * 0.8 };
    placeLimb(R.bracer, arm.elbow, wrist); R.bracer.position.set(bp.x, bp.y, bp.z); R.bracer.scale.y = 1;
    placeLimb(R.upperArm, arm.shoulder, arm.elbow);
    fadeArm(R, cam, arm, wrist, o.dt || 0.016);
    // shield: edge-on at rest, raised across the body while the guard is held
    const side = o.side === 'left' ? 1 : -1, s = o.shieldT;
    // raised, it covers the lower body on the shield side, angled so its painted rim shows and the
    // fight stays visible over it (square in front of the eyes it hid half the screen)
    R.shieldGrp.position.set(side * (0.62 - 0.3 * s), -0.7 + 0.3 * s, -0.5 - 0.1 * s);
    R.shieldGrp.rotation.set(0.25 * (1 - s) - 0.12 * s, Math.PI + side * (1.25 * (1 - s) + 0.55 * s), side * 0.15 * s);
    cam.updateMatrixWorld(true);
    return { hiltW: R.hand.localToWorld(new T.Vector3(0, 0, GUARD_Z)), tipW: R.hand.localToWorld(new T.Vector3(0, 0, GUARD_Z - BLADE)) };
  }

  /* --------------------------------------------------------------- state */
  const S = {
    state: 'loading', mode: 'ladder', boutIdx: 0, hand: 'right',
    hp: 100, maxHp: 100, stamina: C.STAMINA_MAX, sinceSpend: 9, fame: 0,
    foe: null, queue: [], brain: null, fighter: null,
    attack: null, coverStart: null, covers: false,
    shieldUp: false, shieldSince: 0, shieldT: 0,
    dodgeT: 0, dodgeDir: 0, dodgeCd: 0, dodgeX: 0,
    thrustT: 0, thrustCd: 0, stunT: 0, knock: 0,
    swing: C.swingTracker(), swingSwished: 0,
    timeScale: 1, slowT: 0, freezeT: 0, gameMs: 0, realT: 0,
    shake: 0, excite: 0.3, vignette: 0, flash: 0,
    stats: null, total: null, won: 0,
    blade: { h: { x: 0, y: -1 }, t: { x: 0, y: 0 }, ok: false }, prevBlade: null,
    camTarget: new T.Vector3(0, 1.3, 0), introT: 0, endT: 0, lastGlance: 0,
    deflectYaw: 0, deflectPitch: 0, overT: 0, kickX: 0, kickY: 0, bindT: 0, binding: false, whiffs: 0,
    wSeg: null, wSegPrev: null, mate: null, fps: 60, lastPop: {}, view: null, dispQ: null,
  };
  // settings that outlive the page: sword hand and volume
  const PREFS_KEY = 'ironludus.settings', VOLUMES = [1, 0.75, 0.5, 0.25, 0];
  const prefs = (() => { try { return Object.assign({ hand: 'right', volume: 1 }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return { hand: 'right', volume: 1 }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } };
  const volText = v => v > 0 ? Math.round(v * 100) + '%' : 'OFF';
  function applyPrefs() {
    S.hand = prefs.hand === 'left' ? 'left' : 'right'; mc.setHand(S.hand);
    Sfx.setVolume(prefs.volume);
    $('opt-hand').textContent = S.hand.toUpperCase();
    document.querySelectorAll('.opt-vol').forEach(el => { el.textContent = volText(prefs.volume); });
  }
  window.__ludus = S; // for tests
  window.__ludusDebug = { gfx: () => ({ renderer, scene, camera, world }), start: (i, mode) => { ["title", "results", "pause"].forEach(id => $(id).classList.add("hidden")); $("hud").classList.remove("hidden"); newRun(mode || "ladder"); if (i) startBout(i); } };
  const freshStats = () => ({ hits: 0, parries: 0, blocks: 0, taken: 0, bestHit: 0, counters: 0, time: 0, fame: 0, whiffs: 0 });

  let world = null, fx = null, clashLight = null;

  /* ----------------------------------------------------------- utilities */
  function toView(v3) { // world point -> view units {x: ndc.x * aspect, y: ndc.y, ok}
    tmpV2.copy(v3).project(camera);
    return { x: tmpV2.x * aspect, y: tmpV2.y, ok: tmpV2.z < 1 };
  }
  function viewToPx(p) { return { x: (p.x / aspect + 1) / 2 * W, y: (1 - p.y) / 2 * H }; }
  const camRight = new T.Vector3(), camUp = new T.Vector3();
  function rectOf(box) { // world box (facing camera) -> view rect
    const c = toView(box.center);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0); camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const r = toView(tmpV.copy(box.center).addScaledVector(camRight, box.hw));
    const u = toView(tmpV.copy(box.center).addScaledVector(camUp, box.hh));
    return { cx: c.x, cy: c.y, hw: Math.abs(r.x - c.x), hh: Math.abs(u.y - c.y), name: box.name, center: box.center, ok: c.ok };
  }
  function viewToWorldAt(p, depthPoint) { // view point -> world point at the depth of depthPoint
    const d = depthPoint.clone().project(camera).z;
    return new T.Vector3(p.x / aspect, p.y, d).unproject(camera);
  }
  function rumble(s, ms, pat) { try { mc.rumble(s, ms, pat); } catch (e) { /* no rumble */ } }

  const POP_POS = { center: [0.5, 0.42], high: [0.5, 0.28], left: [0.32, 0.45], right: [0.68, 0.45] };
  // live call-outs, so a new one never prints over another (it steps up above it)
  const POP_H = { big: 54, mid: 38, bad: 38, dmg: 32, sub: 24 }, livePops = [];
  function popAt(text, cls, x, y) {
    const el = document.createElement('div');
    cls = cls || 'mid';
    el.className = 'pop ' + cls; el.textContent = text;
    const now = performance.now(), h = POP_H[cls.split(' ')[0]] || 38, w = text.length * h * 0.42;
    for (let i = livePops.length - 1; i >= 0; i--) if (now - livePops[i].t > 900) livePops.splice(i, 1);
    for (let n = 0; n < 4; n++) {
      const hit = livePops.find(o => Math.abs(o.x - x) < (o.w + w) / 2 && Math.abs(o.y - y) < (o.h + h) / 2);
      if (!hit) break;
      y = hit.y - (hit.h + h) / 2 - 2;
    }
    livePops.push({ x, y, w, h, t: now });
    el.style.left = x + 'px'; el.style.top = y + 'px';
    $('popups').appendChild(el); setTimeout(() => el.remove(), 1150);
  }
  function pop(text, cls, at) {
    if (at && at.x !== undefined) { const p = viewToPx(at); popAt(text, cls, p.x, p.y); }
    else { const p = POP_POS[at || 'center']; popAt(text, cls, p[0] * W, p[1] * H); }
  }

  /* ------------------------------------------------- controller wording */
  // Grip (phone in a fist, only the volume keys) and Wand send the same report; only the words differ.
  const WORDS = {
    wand: { a: 'A', b: 'B', center: 'Center', pause: '+ / Home', thrust: '1', side: 'Left / Right', name: 'Wand' },
    grip: { a: 'Vol Down', b: 'Vol Up', center: 'hold Vol Up', pause: 'blade at the floor + hold Vol Down', thrust: 'double-tap Vol Up', side: 'Vol Up', name: 'Grip' },
    // a browser phone's Grip (games/phone): on-screen HOLD / B / CENTRE / SWITCH instead of the volume keys
    gripWeb: { a: 'HOLD', b: 'B', center: 'CENTRE', pause: 'blade at the floor + hold HOLD', thrust: 'SWITCH', side: 'B', name: 'Grip' },
    mouse: { a: 'left mouse', b: 'right mouse', center: 'C', pause: 'Esc', thrust: 'F', side: '← / →', name: 'mouse' },
  };
  function ctlMode(c) { c = c || mc; return c.source !== 'phone' ? 'mouse' : (c.mode === 'grip' ? 'grip' : 'wand'); }
  function wordsFor(c) { c = c || mc; const m = ctlMode(c); return WORDS[m === 'grip' && c.via === 'browser' ? 'gripWeb' : m]; }
  function word(key, c) { return wordsFor(c)[key]; }
  function modeName(c) { return wordsFor(c).name; }
  let wordsMode = null;
  function applyWords(force) {
    const m = ctlMode(), W = wordsFor(), wk = W === WORDS.gripWeb ? 'gripWeb' : m;
    if (wk === wordsMode && !force) return;
    wordsMode = wk;
    document.querySelectorAll('[data-w]').forEach(el => { el.textContent = W[el.dataset.w]; });
    // the how-to table's Grip column: app volume keys, or a browser phone's on-screen buttons
    document.querySelectorAll('[data-web]').forEach(el => {
      if (el.dataset.app == null) el.dataset.app = el.innerHTML;
      el.innerHTML = wk === 'gripWeb' ? el.dataset.web : el.dataset.app;
    });
    document.body.dataset.ctl = m;
    for (const el of [$('ctrl-pill'), $('title-ctrl')]) {
      el.classList.toggle('phone', m !== 'mouse');
      el.querySelector('span').textContent = m === 'mouse' ? 'No phone: using mouse' : 'Phone connected · ' + WORDS[m].name;
    }
    $('title-ctrl').querySelector('small').innerHTML = m === 'mouse'
      ? 'Open Mimic, pair over Bluetooth, pick <b>Wand</b> or <b>Grip</b>.'
      : 'Point at the screen, <kbd>' + W.center + '</kbd> to line up the blade.';
  }
  let hintTimer = 0;
  function hint(text, secs) { $('hint').innerHTML = text || ''; hintTimer = secs || 0; }

  /* --------------------------------------------------------- the sword */
  // mc.arm turns the upper arm the short way round (q^0.4): when the phone's whole rotation passes
  // 180 deg the elbow flips sides and the hilt jumps ~0.6 m in one frame (seen once in a recorded
  // session). Same arm, but the elbow's share is tracked continuously through 180 deg and eased
  // back to the usual arm while the player moves (approach shared with Cadence Cut's sweep.js).
  const ELBOW_SHARE = 0.4;
  function qpowFollow(q, t, st, relax) {
    const s = q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
    let k = st.k || 0;
    if (st.s && s.x * st.s.x + s.y * st.s.y + s.z * st.s.z + s.w * st.s.w < 0) k = 1 - k;
    const theta = 2 * Math.acos(Math.max(-1, Math.min(1, s.w)));
    if (k > 0 && theta < 140 * Math.PI / 180) k = Math.max(0, k - (relax || 0));
    st.s = s; st.k = k;
    const sh = Math.sin(theta / 2);
    if (sh < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
    const phi = t * (theta - 2 * Math.PI * k), c = Math.sin(phi / 2) / sh;
    return { x: s.x * c, y: s.y * c, z: s.z * c, w: Math.cos(phi / 2) };
  }
  function continuousArm(q, pose, dt, armState, angSpeed) {
    const MM = MimicMath;
    const upperW = { x: pose.elbow.x - pose.shoulder.x, y: pose.elbow.y - pose.shoulder.y, z: pose.elbow.z - pose.shoulder.z };
    const short = MM.qpow(q, ELBOW_SHARE);
    const upper = MM.rotate({ x: -short.x, y: -short.y, z: -short.z, w: short.w }, upperW);
    const nu = MM.rotate(qpowFollow(q, ELBOW_SHARE, armState, dt * (0.6 + 0.15 * (angSpeed || 0))), upper);
    const d = { x: nu.x - upperW.x, y: nu.y - upperW.y, z: nu.z - upperW.z };
    const add = v => ({ x: v.x + d.x, y: v.y + d.y, z: v.z + d.z });
    return { shoulder: pose.shoulder, elbow: add(pose.elbow), wrist: add(pose.wrist), hand: add(pose.hand) };
  }
  const swordQ = new T.Quaternion();
  function updateSword(dt) {
    let q, arm;
    if (mc.source === 'phone') { q = mc.quat; arm = S.hand === 'left' ? mc.arm : continuousArm(q, mc.arm, dt, R0.armState, S.angSpeed); }
    else {
      // mouse: the tip follows the cursor; the blade rides a little raised, like a guard
      const yaw = mc.yaw * 1.15, pitch = mc.pitch * 1.25 + 0.5;
      q = MimicMath.fromEuler(yaw, pitch, -mc.yaw * 0.6);
      arm = MimicMath.armPose(q, S.hand);
    }
    swordQ.set(q.x, q.y, q.z, q.w);
    // a tired arm drags behind the phone
    if (!S.dispQ) S.dispQ = swordQ.clone();
    const tired = S.state === 'fight' && S.stamina < C.TIRED ? 1 - S.stamina / C.TIRED : 0;
    S.dispQ.slerp(swordQ, tired > 0 ? 1 - Math.exp(-(26 - 18 * tired) * dt) : 1);
    swordQ.copy(S.dispQ);
    // guard break knocks the blade aside for a moment
    if (S.knock > 0) { tmpQ.setFromAxisAngle(new T.Vector3(0, 0, 1), S.knock * 0.9 * (S.hand === 'left' ? -1 : 1)); swordQ.premultiply(tmpQ); }
    // blade-on-blade: your blade is thrown off-line, then springs back
    if (Math.abs(S.deflectYaw) + Math.abs(S.deflectPitch) > 1e-3) {
      tmpQ.setFromEuler(new T.Euler(S.deflectPitch, S.deflectYaw, 0, 'YXZ')); swordQ.premultiply(tmpQ);
    }
    const dk = Math.exp(-7 * dt); S.deflectYaw *= dk; S.deflectPitch *= dk;
    S.shieldT += ((S.shieldUp ? 1 : 0) - S.shieldT) * Math.min(1, dt * 16);
    const { hiltW, tipW } = poseRig(R0, camera, swordQ, arm, { thrustT: S.thrustT, shieldT: S.shieldT, side: S.hand, dt });
    const h = toView(hiltW), t = toView(tipW);
    S.prevBlade = S.blade;
    S.blade = { h, t, ok: h.ok && t.ok, hiltW, tipW };
  }
  function bladePointW(f) { return S.blade.hiltW.clone().lerp(S.blade.tipW, f); }

  /* ------------------------------------------------------------ bouts */
  function boutLabel(i) { return C.LADDER[i].title.toUpperCase(); }
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  function newRun(mode) {
    S.mode = mode; S.boutIdx = 0; S.hp = S.maxHp; S.fame = 0; S.won = 0;
    S.total = freshStats();
    if (fx) fx.clearDecals();
    startBout(0);
  }
  function startBout(i) {
    S.boutIdx = i; S.stats = freshStats();
    const L = C.LADDER[i];
    S.queue = L.foes.map(p => S.mode === 'practice' ? Object.assign({}, p, { hp: Infinity }) : p);
    S.stamina = C.STAMINA_MAX;
    clearFoe();
    spawnNext(true);
    showCard('intro');
  }
  function clearFoe() {
    for (const x of [S.fighter, S.mate && S.mate.fighter, S.corpse]) if (x) scene.remove(x.root);
    S.fighter = null; S.brain = null; S.foe = null; S.attack = null; S.mate = null; S.corpse = null;
    S.wSeg = S.wSegPrev = null; S.bindT = 0; S.binding = false; S.lastClash = null; S.swingTimes = [];
  }
  function spawnNext(first) {
    const p = S.queue.shift();
    const f = new LudusFighters.Fighter(p, assets.models[p.model], assets);
    f.root.position.set(first ? 0 : 1.5, 0, PLAYER.z - p.dist - (first ? 7 : 9));
    scene.add(f.root);
    S.fighter = f; S.foe = { p, hp: p.hp, maxHp: p.hp };
    S.brain = C.createBrain(p, (Math.random() * 1e9) | 0);
    f.setWalking(true);
    // a pack comes in together: the second one prowls and trades places
    if (p.pack && S.queue.length && S.queue[0].pack) {
      const q = S.queue.shift();
      const g = new LudusFighters.Fighter(q, assets.models[q.model], assets);
      g.root.position.set(2.4, 0, PLAYER.z - q.dist - 8); scene.add(g.root); g.setWalking(true);
      S.mate = { fighter: g, foe: { p: q, hp: q.hp, maxHp: q.hp }, brain: C.createBrain(q, (Math.random() * 1e9) | 0) };
    }
    S.state = 'intro'; S.introT = 0;
    $('foe-name').textContent = p.name.toUpperCase();
    updateHud(true);
    const roar = p.model === 'troll' ? 'troll' : p.model === 'wolf' ? 'wolf' : p.model === 'skeleton' ? 'monster' : null;
    if (roar) setTimeout(() => Sfx.play(roar, { vol: 0.9 }), 400);
  }

  function showCard(kind) {
    const L = C.LADDER[S.boutIdx];
    const card = $('card');
    $('card-stats').innerHTML = ''; $('ladder').innerHTML = '';
    if (kind === 'intro') {
      $('card-kicker').textContent = S.mode === 'practice' ? 'PRACTICE' : (L.title === 'Final' ? 'THE FINAL BOUT' : L.title.toUpperCase() + ' OF VI');
      $('card-title').textContent = S.mode === 'practice' ? 'THE TRAINING SAND' : L.name.toUpperCase();
      $('card-text').innerHTML = S.mode === 'practice' ? 'Cassia won\'t fall and you can\'t die. Read the red zone, parry, and cut around her blade.'
        : L.intro + '<br><span class="lesson">' + L.lesson + '</span>';
      $('card-menu').innerHTML = '<button class="mi primary" data-act="fight">FIGHT</button>';
      renderLadder();
    } else if (kind === 'between') {
      const st = S.stats;
      $('card-kicker').textContent = 'THE CROWD ROARS';
      $('card-title').textContent = 'VICTORY';
      const heal = Math.round((S.maxHp - S.hp) * 0.5);
      S.hp += heal;
      $('card-text').textContent = `${L.name} falls. The crowd roars your name. ` + (heal > 0 ? `You bind your wounds (+${heal} health).` : 'Not a scratch on you.');
      $('card-stats').innerHTML = statsHtml(st);
      $('card-menu').innerHTML = '<button class="mi primary" data-act="next">NEXT BOUT</button>';
      renderLadder(true);
    }
    card.classList.remove('hidden');
    S.cardKind = kind;
    focusMenu($('card-menu'));
  }
  function renderLadder(afterWin) {
    if (S.mode === 'practice') return;
    $('ladder').innerHTML = C.LADDER.map((L, i) => {
      const done = i < S.boutIdx || (afterWin && i === S.boutIdx);
      const next = afterWin ? i === S.boutIdx + 1 : i === S.boutIdx;
      return `<div class="rung ${done ? 'done' : ''} ${next ? 'next' : ''}">${ROMAN[i]} &middot; ${L.name.split(' the ')[0]}</div>`;
    }).join('');
  }
  function statsHtml(st) {
    const cells = [['HITS', st.hits], ['PARRIES', st.parries], ['BLOCKS', st.blocks], ['BEST HIT', st.bestHit], ['DAMAGE TAKEN', st.taken], ['FAME', st.fame]];
    return cells.map(c => `<div><b>${c[1]}</b><span>${c[0]}</span></div>`).join('');
  }
  function hideCard() { $('card').classList.add('hidden'); }

  function beginFight() {
    hideCard();
    S.state = 'fight';
    S.fighter.setWalking(false);
    pop('FIGHT!', 'big');
    Sfx.play('cheer', { vol: 0.7 }); S.excite = 0.8;
    if (S.boutIdx === 0 && S.won === 0) hint(`Watch for the <b>red zone</b>: put your blade across it. Her blade follows yours: <b>show one side, cut the other</b>. Hold <kbd>${word('a')}</kbd> for your shield.`, 8);
  }

  function foeDown() {
    const f = S.fighter, p = S.foe.p;
    f.die(); C.brainKill(S.brain); S.attack = null;
    if (S.mate && !S.mate.fighter.dead) {
      // one of the pack falls: the other comes straight in
      if (S.corpse) scene.remove(S.corpse.root);
      S.corpse = f;
      S.fighter = S.mate.fighter; S.brain = S.mate.brain; S.foe = S.mate.foe; S.mate = null;
      S.brain.timer = 1100; S.fighter.setWalking(true);
      $('foe-name').textContent = S.foe.p.name.toUpperCase(); updateHud(true);
      Sfx.play('beastHurt', { vol: 1 }); Sfx.play('cheer', { vol: 0.8, delay: 0.2 }); Sfx.play('wolf', { vol: 0.9, delay: 0.5 });
      S.excite = 1.2; S.slowT = 0.6; S.timeScale = 0.35; rumble(1, 200, 2);
      addFame(C.FAME.kill); pop('ONE DOWN!', 'big');
      return;
    }
    Sfx.play(p.beast ? 'beastHurt' : p.model === 'troll' ? 'troll' : 'die', { vol: 1 });
    Sfx.play('cheer', { vol: 1, delay: 0.25 });
    S.excite = 1.3; S.slowT = 1.2; S.timeScale = 0.3;
    rumble(1, 255, 2);
    addFame(C.FAME.kill);
    pop(S.queue.length ? 'ONE DOWN!' : 'VICTORY', 'big');
    S.state = 'down'; S.endT = 0;
  }
  function addFame(n) { S.fame = Math.max(0, S.fame + n); S.stats.fame += n; }

  function boutWon() {
    if (S.stats.taken === 0) { addFame(C.FAME.flawless); pop('FLAWLESS', 'big'); }
    S.won = S.boutIdx + 1;
    for (const k in S.stats) S.total[k] = k === 'bestHit' ? Math.max(S.total[k], S.stats[k]) : S.total[k] + S.stats[k];
    if (S.boutIdx + 1 >= C.LADDER.length) { showResults(true); return; }
    S.state = 'between';
    showCard('between');
  }
  function defeat() {
    S.state = 'defeat'; S.endT = 0; S.attack = null;
    for (const k in S.stats) S.total[k] = k === 'bestHit' ? Math.max(S.total[k], S.stats[k]) : S.total[k] + S.stats[k];
    Sfx.play('die', { vol: 1, rate: 0.85 }); Sfx.play('shout', { vol: 0.8 });
    rumble(1, 255, 1);
    pop('YOU FALL', 'bad');
    S.timeScale = 0.35; S.slowT = 1.5;
  }
  function showResults(champion) {
    S.state = 'results';
    $('hud').classList.add('hidden');
    const rank = C.rankFor(S.fame, S.won);
    $('res-kicker').textContent = champion ? 'FREEDOM IS YOURS' : `FELL IN ${C.LADDER[S.boutIdx].title.toUpperCase()}`;
    $('res-title').textContent = rank.toUpperCase();
    $('res-fame').textContent = S.fame; $('res-fame-l').textContent = 'FAME'; $('res-again').textContent = 'FIGHT AGAIN';
    const t = S.total;
    $('res-stats').innerHTML = [['BOUTS WON', S.won + ' / 6'], ['HITS', t.hits], ['BEST HIT', t.bestHit], ['COUNTERS', t.counters], ['PARRIES', t.parries], ['BLOCKS', t.blocks], ['DAMAGE TAKEN', t.taken], ['MISSED SWINGS', t.whiffs]]
      .map(c => `<div><b>${c[1]}</b><span>${c[0]}</span></div>`).join('');
    $('results').classList.remove('hidden');
    focusMenu($('res-menu'));
    if (champion) { Sfx.play('cheer', { vol: 1 }); Sfx.play('cheer', { vol: 0.8, delay: 1.5 }); S.excite = 1.4; }
  }

  /* -------------------------------------------------------------- combat */
  const SIDE_WORD = { left: 'LEFT', right: 'RIGHT', high: 'HIGH', low: 'LOW', thrust: 'THRUST' };
  /** Pop a message at most once per `gap` seconds per key (keeps the screen readable). */
  function popOnce(key, gap, text, cls, at) {
    if (S.realT - (S.lastPop[key] || -99) < gap) return;
    S.lastPop[key] = S.realT; pop(text, cls, at);
  }
  function onBrainEvent(e) {
    const f = S.fighter, p = S.foe.p;
    if (e.type === 'telegraph') {
      S.attack = e.attack; S.coverStart = null; S.covers = false;
      f.setAction('windup', e.attack);
      if (e.attack.heavy) { Sfx.play(p.model === 'troll' ? 'troll' : p.beast ? 'wolf' : 'grunt', { vol: 0.9, rate: 0.8 }); }
      else if (p.beast && Math.random() < 0.5) Sfx.play('wolf', { vol: 0.5, rate: 1.2 });
      if (e.attack.lunge) { Sfx.play('step', { vol: 0.7 }); fx.puff(f.root.position, 8); }
    } else if (e.type === 'feint') {
      S.attack = e.attack; S.coverStart = null; S.covers = false;
      f.setAction('windup', e.attack); f.modeT = 0;
      pop('FEINT!', 'sub', 'high');
    } else if (e.type === 'impact') {
      f.setAction('strike', e.attack);
      resolveStrike(e.attack);
      S.attack = null;
    } else if (e.type === 'recovered') {
      f.setAction('idle');
      if (S.mate && !S.mate.fighter.dead && Math.random() < 0.45) swapPack();
    } else if (e.type === 'step') {
      if (e.out) Sfx.play('step', { vol: 0.45 });
    }
  }
  /** The brain started a strike outside its own step (riposte, punish): show it like any other. */
  function brainStarted(a) { if (a) onBrainEvent({ type: 'telegraph', attack: a }); }

  function resolveStrike(a) {
    const nowMs = S.gameMs;
    const coverFor = S.covers && S.coverStart !== null ? nowMs - S.coverStart : -1;
    const swingInto = S.swing.active && S.covers && S.swing.power > 0.12;
    const res = C.resolveDefense({ attack: a, coverFor, swingInto, shieldFor: S.shieldUp ? nowMs - S.shieldSince : -1,
      dodging: S.dodgeT > 0, stamina: S.stamina, parryWindow: S.foe.p.parryWindow, overextended: S.overT > 0 });
    const p = S.foe.p, beast = p.beast;
    const clashAt = S.shieldUp && coverFor < 0 ? camera.localToWorld(new T.Vector3(-0.15, -0.2, -0.6)) : bladePointW(0.7);
    S.lastDefense = res.result;
    switch (res.result) {
      case 'parry': {
        S.stats.parries++; addFame(C.FAME.parry);
        C.brainParried(S.brain); S.fighter.setAction('stagger');
        if (S.shieldUp && coverFor < 0) Sfx.play('shield', { vol: 1 }); else Sfx.play('clash', { vol: 1 });
        Sfx.ring(1, true);
        fx.clash(clashAt, 1, null); flashLight(clashAt, 1);
        rumble(1, 140, 3);
        S.slowT = 0.45; S.timeScale = 0.22; S.flash = 0.7; S.shake = 0.12;
        kick(a.dir === 'left' ? 0.02 : -0.02, 0.015);
        S.excite = Math.min(1.4, S.excite + 0.5); Sfx.play('shout', { vol: 0.55, delay: 0.1 });
        pop('PARRY!', 'big', 'high'); pop('OPEN - STRIKE NOW', 'sub', 'center');
        break;
      }
      case 'block': {
        S.stats.blocks++; addFame(C.FAME.block);
        spend(res.staminaCost);
        if (S.shieldUp && coverFor < 0) Sfx.play('shield', { vol: 1 }); else { Sfx.play('clash', { vol: 0.9 }); Sfx.ring(0.6, false); }
        fx.clash(clashAt, 0.6, null); flashLight(clashAt, 0.6);
        rumble(0.75, 60, 0);
        S.shake = 0.07; S.fighter.blockReact();
        // the blow drives your blade back a little
        S.deflectYaw += (a.dir === 'left' ? -1 : a.dir === 'right' ? 1 : 0) * 0.12; S.deflectPitch += a.dir === 'high' ? -0.12 : 0;
        kick(a.dir === 'left' ? 0.025 : a.dir === 'right' ? -0.025 : 0, a.dir === 'high' ? -0.02 : 0.008);
        pop('BLOCK', 'mid', 'high');
        if (S.stamina < 25) popOnce('lowguard', 2, 'YOUR GUARD IS TIRING', 'sub', 'center');
        break;
      }
      case 'guardbreak': {
        spend(res.staminaCost); S.stamina = Math.max(0, S.stamina - 10);
        Sfx.play(S.shieldUp && coverFor < 0 ? 'shield' : 'clash', { vol: 1, rate: 0.85 }); Sfx.ring(0.8, false); Sfx.thump(1);
        fx.clash(clashAt, 0.8, null);
        hurt(res.damage, a);
        S.knock = 1; S.stunT = 0.6;
        pop(a.heavy ? 'HEAVY! GUARD BROKEN' : 'TOO TIRED - GUARD BROKEN', 'bad', 'high');
        rumble(1, 180, 1);
        break;
      }
      case 'dodged':
        Sfx.play('swish', { vol: 0.7, rate: 0.8 });
        pop('DODGED', 'mid', S.dodgeDir < 0 ? 'right' : 'left');
        addFame(60);
        break;
      default:
        hurt(res.damage, a);
        rumble(1, 220, 1);
        Sfx.play(beast ? 'beastHurt' : 'flesh', { vol: 0.6 });
        if (S.overT > 0 && S.covers) popOnce('over', 1.5, 'STILL RECOVERING FROM YOUR MISS', 'sub', 'center');
        else if (a.kind === 'punish') popOnce('punished', 1.5, 'PUNISHED', 'sub', 'center');
        break;
    }
    C.brainStruck(S.brain, res.result);
  }
  function kick(x, y) { S.kickX += x; S.kickY += y; }
  function hurt(dmg, a) {
    if (S.mode === 'practice') dmg = Math.round(dmg * 0.0);
    S.hp = Math.max(0, S.hp - dmg); S.stats.taken += dmg; addFame(C.FAME.taken * dmg);
    S.vignette = 1; S.shake = 0.22;
    // the blow snaps your head round, away from where it came from
    const sx = a && a.dir === 'left' ? 1 : a && a.dir === 'right' ? -1 : (Math.random() - 0.5);
    kick(0.07 * sx, a && a.dir === 'high' ? -0.06 : a && a.dir === 'low' ? 0.05 : 0.03);
    Sfx.play('flesh', { vol: 1 }); Sfx.play('grunt', { vol: 0.9, rate: 0.75 }); Sfx.thump(0.8);
    S.excite = Math.min(1.3, S.excite + 0.25);
    if (dmg > 0) pop('-' + dmg, 'bad', a && a.dir === 'left' ? 'left' : a && a.dir === 'right' ? 'right' : 'center');
    else if (S.mode === 'practice') pop('HIT (practice)', 'bad', 'center');
    if (S.hp <= 0 && S.mode !== 'practice') defeat();
  }
  function spend(n) { S.stamina = Math.max(0, S.stamina - n); S.sinceSpend = 0; }

  function flashLight(p, s) { clashLight.position.copy(p); clashLight.intensity = 6 * s; }

  /** Effective power of the swing in flight: rushed and tired cuts carry less. */
  function swingEff() {
    const sw = S.swing;
    return C.effectivePower(sw.power, { sinceLastMs: sw.startT - sw.prevEndT, chain: sw.chain, stamina: S.stamina });
  }

  /** The player's blade lands on his body (cut or thrust). */
  function landCut(power, from, zone, contactView, motion, align) {
    const b = S.brain, f = S.fighter, p = S.foe.p;
    const brainState = b.state === 'chain' ? 'recover' : b.state;
    // a man with a weapon guards with it (judged as blade contact before this); only a turtle guard is a rule
    const guard = f.weapon ? (b.guard === 'all' ? 'all' : null) : b.guard;
    const res = C.resolveCut({ power, from, zone, align, enemy: { guard, state: brainState, armor: p.armor, zoneArmor: p.zoneArmor, evade: p.evade } });
    const at = viewToWorldAt(contactView, tmpV.copy(f.boxes()[1].center));
    const motionW = new T.Vector3(motion.x, motion.y, 0).applyQuaternion(camera.quaternion).normalize();
    S.lastCut = res.result;
    if (res.result === 'hit') {
      S.foe.hp -= res.damage; S.whiffs = 0;
      S.stats.hits++; S.stats.bestHit = Math.max(S.stats.bestHit, res.damage); addFame(C.FAME.hit(power));
      if (res.counter) { S.stats.counters++; addFame(C.FAME.counter); }
      C.brainHit(b, res);
      if (res.stagger) f.setAction('stagger');
      f.hitReact(from === 'left' ? 'left' : from === 'right' ? 'right' : 'none', res.stagger);
      fx.bleed(at, Math.min(1, power), motionW);
      Sfx.play('flesh', { vol: 0.6 + 0.4 * Math.min(1, power) }); Sfx.play('blade', { vol: 0.5 });
      Sfx.play(p.beast ? 'beastHurt' : p.model === 'troll' ? 'troll' : p.model === 'skeleton' ? 'monster' : 'grunt', { vol: 0.8, delay: 0.05 });
      Sfx.thump(0.5 + 0.4 * Math.min(1, power));
      rumble(0.45 + 0.4 * Math.min(1, power), 45, 0);
      S.freezeT = 0.04 + 0.09 * Math.min(1, power);     // hit-stop: the blade bites
      kick(-motion.x * 0.02, -motion.y * 0.02);
      S.excite = Math.min(1.4, S.excite + 0.12 + 0.2 * power);
      if (power > 0.8 || res.counter || zone === 'head') Sfx.play('shout', { vol: 0.35 + 0.3 * Math.min(1, power), delay: 0.12 });
      pop(String(res.damage), 'dmg', contactView);
      if (res.counter) pop('COUNTER!', 'big', 'high');
      else if (zone === 'head' && power > 0.4) pop('HEAD!', 'mid', 'high');
      else if (zone === 'arm') popOnce('arm', 1, 'SWORD ARM', 'sub', contactView);
      else if (zone === 'legs') popOnce('legs', 1, 'LEG', 'sub', contactView);
      if (p.armor && power < p.armor) popOnce('hide', 1.5, 'TOO WEAK FOR THAT HIDE - SWING HARDER', 'sub', 'center');
      else if (align < 0.55) popOnce('align', 1.5, 'POOR EDGE - CUT ACROSS, NOT ALONG', 'sub', 'center');
      else if (power < 0.3 && S.stamina < C.TIRED) popOnce('tired', 1.5, 'TIRED ARM - WEAK CUT', 'sub', 'center');
      else if (power < 0.35 && S.swing.startT - S.swing.prevEndT < C.SWING.rushMs) popOnce('rushed', 1.5, 'RUSHED - CHAMBER YOUR CUTS', 'sub', 'center');
      if (S.foe.hp <= 0) foeDown();
    } else if (res.result === 'blocked') {
      const broke = C.brainPoise(b, res.poise);
      Sfx.play('clash', { vol: 0.8 }); Sfx.ring(0.5, false);
      fx.clash(at, 0.5, motionW.clone().negate()); flashLight(at, 0.5);
      rumble(0.6, 50, 0);
      f.blockReact();
      if (broke) { pop('GUARD BROKEN!', 'big', 'high'); f.setAction('stagger'); Sfx.play('shout', { vol: 0.5 }); addFame(150); }
      else pop(b.guard === 'all' ? 'FULL GUARD - THRUST THROUGH IT' : 'BLOCKED', 'sub', contactView);
    } else if (res.result === 'armor') {
      Sfx.play('clash', { vol: 0.55, rate: 1.25 }); Sfx.ring(0.3, false);
      fx.clash(at, 0.3, motionW.clone().negate());
      rumble(0.5, 40, 0);
      S.deflectYaw += -Math.sign(motion.x || 1) * 0.12;
      popOnce('armor', 1, 'GLANCED OFF ARMOUR', 'sub', contactView);
    } else if (res.result === 'evaded') {
      f.evadeHop(); Sfx.play('swish', { vol: 0.5 });
      pop('EVADED', 'sub', contactView);
      C.brainHit(b, { stagger: false });
      brainStarted(C.brainOpening(b, 'whiff'));
    } else {
      popOnce('glance', 0.8, align < 0.25 ? 'FLAT - NO EDGE' : S.swing.chain >= 2 ? 'WAGGLING - CHAMBER YOUR CUTS' : 'TOO SLOW', 'sub', contactView);
      Sfx.play('blade', { vol: 0.25, rate: 1.3 });
    }
  }

  /** Your blade met his. c = { point (view), power, from, motion }. */
  function bladeClash(c) {
    const b = S.brain, f = S.fighter, sw = S.swing;
    sw.hit = true; sw.clashed = true;
    S.lastClash = { t: S.realT, state: b.state };
    const at = viewToWorldAt(c.point, f.weaponSeg().t);
    const motionW = new T.Vector3(c.motion.x, c.motion.y, 0).applyQuaternion(camera.quaternion).normalize();
    const mlen = Math.hypot(c.motion.x, c.motion.y) || 1;
    // both blades bounce: yours back the way it came
    const throwBack = 0.18 + 0.3 * Math.min(1, c.power);
    S.deflectYaw += (c.motion.x / mlen) * throwBack; S.deflectPitch += -(c.motion.y / mlen) * throwBack * 0.8;
    f.blockReact(); f.weaponKick = 1;
    fx.clash(at, 0.5 + 0.5 * Math.min(1, c.power), motionW.clone().negate()); flashLight(at, 0.5 + 0.5 * Math.min(1, c.power));
    Sfx.play('clash', { vol: 0.7 + 0.3 * Math.min(1, c.power) });
    if (b.state === 'windup') {
      if (C.brainBeat(b, c.power)) {
        S.attack = null; f.setAction('stagger');
        Sfx.ring(1, true); rumble(1, 140, 3);
        S.freezeT = 0.09; S.flash = 0.35; S.excite = Math.min(1.4, S.excite + 0.45); Sfx.play('shout', { vol: 0.6, delay: 0.08 });
        S.stats.counters++; addFame(C.FAME.beat);
        S.lastClash.result = 'beat';
        pop('BEAT ASIDE!', 'big', 'high'); pop('OPEN - STRIKE', 'sub', 'center');
      } else {
        Sfx.ring(0.6, false); rumble(0.7, 60, 0);
        S.lastClash.result = 'clash';
        popOnce('beatweak', 1, 'CLASH - HIT THE BLADE HARDER TO BEAT IT', 'sub', c.point);
      }
      return;
    }
    if (b.state !== 'idle') { Sfx.ring(0.4, false); rumble(0.5, 40, 0); S.lastClash.result = 'clash'; return; }
    C.brainNoteCut(b, c.from);
    const r = C.brainBlocked(b, { from: c.from, power: c.power });
    S.lastClash.result = r.result;
    if (r.result === 'parry') {
      // he caught it on his blade and threw it aside: you are open
      Sfx.ring(1, true); rumble(1, 120, 1);
      S.deflectYaw += (c.motion.x / mlen) * 0.35; S.stunT = Math.max(S.stunT, 0.45); S.overT = Math.max(S.overT, 0.45);
      kick(0.02 * Math.sign(c.motion.x || 1), 0.01);
      const why = b.read && c.from === b.read ? `READ: YOUR ${SIDE_WORD[c.from] || ''} CUT` : c.power < 0.45 ? 'TOO SOFT A CUT' : 'SEEN COMING';
      pop('PARRIED!', 'bad', 'high'); pop(why, 'sub', 'center');
      S.excite = Math.min(1.3, S.excite + 0.15);
    } else {
      Sfx.ring(0.6, false); rumble(0.7, 60, 0);
      const broke = C.brainPoise(b, Math.round(10 + 25 * c.power));
      if (broke) {
        pop('GUARD BROKEN!', 'big', 'high'); f.setAction('stagger'); Sfx.play('shout', { vol: 0.5 }); addFame(150);
      } else {
        const why = b.read && c.from === b.read ? `ON THE BLADE - YOUR ${SIDE_WORD[c.from] || ''} IS READ` : 'ON THE BLADE - CUT AROUND IT';
        popOnce('blocked', 0.9, why, 'sub', c.point);
        if (c.power < 0.45) S.bindT = 0.001;    // a soft cut that stays on his blade becomes a bind
      }
    }
    if (r.riposte) { brainStarted(r.riposte); popOnce('riposte', 1, 'RIPOSTE!', 'sub', 'high'); }
  }

  /** Blades resting crossed: a bind. Wind off it with a sharp cut, or he shoves through. */
  function updateBind(dt) {
    const b = S.brain, f = S.fighter, seg = S.wSeg;
    if (!S.bindT || !seg || b.state !== 'idle' || !S.blade.ok) { S.bindT = 0; S.binding = false; return; }
    const cut = (bl, k) => ({ x: bl.h.x + (bl.t.x - bl.h.x) * k, y: bl.h.y + (bl.t.y - bl.h.y) * k });
    const touching = C.segCross(cut(S.blade, 0.3), S.blade.t, seg.h, seg.t, 0.04);
    if (!touching) { S.bindT = 0; S.binding = false; return; }
    S.bindT += dt;
    if (!S.binding && S.bindT > 0.18) { S.binding = true; pop('BIND', 'mid', touching); }
    if (!S.binding) return;
    spend(14 * dt);
    if (Math.random() < dt * 6) { Sfx.play('blade', { vol: 0.25, rate: 0.6 }); fx.clash(viewToWorldAt(touching, f.weaponSeg().t), 0.12, null); rumble(0.3, 30, 0); }
    if (S.swing.active && swingEff() > 0.35) {
      // wound off the bind: his blade is pinned the wrong way
      S.bindT = 0; S.binding = false;
      C.brainHit(b, { stagger: true }); f.setAction('stagger');
      Sfx.ring(0.8, true); pop('WOUND OFF THE BIND!', 'big', 'high'); addFame(180);
      S.swing.hit = false; S.swing.clashed = false;
      return;
    }
    if (S.bindT > (S.foe.p.bindMs || 650) / 1000 + 0.18) {
      S.bindT = 0; S.binding = false;
      S.deflectYaw += 0.45 * (Math.random() < 0.5 ? -1 : 1); S.stunT = 0.35; S.overT = 0.4;
      Sfx.play('clash', { vol: 0.9, rate: 0.8 }); rumble(0.9, 100, 1);
      pop('SHOVED OFF THE BIND', 'bad', 'high');
      brainStarted(C.brainOpening(b, 'stunned'));
    }
  }

  function fightInput(dt) {
    const sw = S.swing, b = S.blade, brain = S.brain, f = S.fighter;
    // shield
    // HOLD A (Wand) / Vol Down (Grip) raises the shield; releasing it frees the blade. A menu press
    // does not leak into the fight: the button must come up once first.
    if (!mc.isDown('a')) S.aLatch = false;
    const wantShield = mc.isDown('a') && !S.aLatch && S.stamina > 2 && S.stunT <= 0;
    if (wantShield && !S.shieldUp) { S.shieldUp = true; S.shieldSince = S.gameMs; Sfx.play('step', { vol: 0.4 }); }
    if (!wantShield) S.shieldUp = false;
    // sidestep
    S.dodgeCd -= dt;
    // B / Vol Up tap steps away from the incoming strike (or swaps sides); Wand Left/Right pick the side
    let stepDir = mc.pressed('left') ? -1 : mc.pressed('right') ? 1 : 0;
    if (!stepDir && mc.pressed('b')) {
      const a = S.attack && S.brain && S.brain.state === 'windup' ? S.attack.dir : null;
      stepDir = a === 'left' ? 1 : a === 'right' ? -1 : (S.lastStep = -(S.lastStep || 1));
    }
    for (const [btn, dir] of [['step', stepDir]]) {
      if (dir && S.dodgeCd <= 0 && S.stamina >= C.DODGE_COST * 0.5) {
        spend(C.DODGE_COST); S.dodgeT = 0.42; S.dodgeDir = dir; S.dodgeCd = 0.7;
        Sfx.play('swish', { vol: 0.6, rate: 0.7 }); Sfx.play('step', { vol: 0.6 });
        fx.puff(camera.position, 10);
      }
    }
    // thrust: forward jab of the phone; Wand 1 / Grip double-tap Vol Up / F (mouse) as a backup
    S.thrustCd -= dt;
    const jab = mc.source === 'phone' && (mc.linearAccel.x * mc.forward.x + mc.linearAccel.y * mc.forward.y + mc.linearAccel.z * mc.forward.z) > 16 && mc.angularSpeed < 4;
    if ((mc.pressed('one') || jab || takeKeyThrust()) && S.thrustCd <= 0 && !S.shieldUp && S.stunT <= 0 && S.stamina >= C.THRUST_COST * 0.5) {
      spend(C.THRUST_COST); S.thrustT = 0.0001; S.thrustCd = 0.6; S.thrustHit = false;
      Sfx.play('swish', { vol: 0.5, rate: 1.3 });
    }
    // his weapon on screen this frame
    const ws = f.weaponSeg();
    S.wSegPrev = S.wSeg;
    S.wSeg = ws ? { h: toView(ws.h), t: toView(ws.t) } : null;
    if (S.wSeg && !(S.wSeg.h.ok && S.wSeg.t.ok)) S.wSeg = null;
    if (!b.ok) return;
    // what he sees of your blade
    const body = rectOf(f.boxes()[1]);
    S.view = { body, wseg: S.wSeg };
    if (body.ok && !f.dead) C.brainSee(brain, { threat: C.threatFrom(b, body, sw.active && sw.power > 0.2 ? sw.from : null) });
    // swing
    const ev = C.swingStep(sw, { t: S.gameMs, speed: S.stunT > 0 ? 0 : (S.angSpeed || 0), tip: b.t });
    if (ev === 'start') {
      S.swingSwished = 0; sw.clashed = false; sw.outOfReach = false;
      // flailing: four swings inside a second and a half and you are not guarding anything
      S.swingTimes = (S.swingTimes || []).filter(x => S.gameMs - x < 1500); S.swingTimes.push(S.gameMs);
      if (S.swingTimes.length >= 4 && brain.state === 'idle') {
        const a = C.brainOpening(brain, 'flail');
        if (a) { brainStarted(a); popOnce('flail', 2.5, 'FLAILING - WALKED STRAIGHT THROUGH', 'bad', 'center'); }
      }
    }
    if (sw.active && !S.swingSwished && sw.power > 0.25) { S.swingSwished = 1; Sfx.play('swish', { vol: 0.35 + 0.5 * Math.min(1, sw.power), rate: 0.9 + 0.3 * sw.power }); }
    if (ev === 'end' && sw.power > 0.05) {
      spend(C.swingCost(sw.power));
      if (sw.power > 0.3 && sw.from) C.brainNoteCut(brain, sw.from);
      if (!sw.hit && sw.power > 0.3 && S.state === 'fight' && !f.dead) {
        // a full swing at nothing: you are overextended and he knows it
        spend(C.WHIFF_COST); S.overT = 0.45; S.whiffs++; S.stats.whiffs = (S.stats.whiffs || 0) + 1; addFame(C.FAME.whiff);
        const a = C.brainOpening(brain, S.stamina < 15 ? 'tired' : 'whiff');
        if (a) { brainStarted(a); popOnce('whiff', 1.2, sw.outOfReach ? 'OUT OF REACH - YOU ARE OPEN' : 'MISSED - YOU ARE OPEN', 'bad', 'center'); }
        else popOnce('whiff', 1.6, sw.outOfReach ? 'OUT OF REACH' : 'MISSED', 'sub', 'center');
        if (S.whiffs === 3 || S.whiffs === 6) { Sfx.play('shout', { vol: 0.35, rate: 0.7 }); popOnce('jeer', 3, 'THE CROWD JEERS YOUR FLAILING', 'sub', 'high'); S.excite = Math.max(0.2, S.excite - 0.2); }
      }
    }
    // cut contact: his blade first, then wherever your blade passes over him
    if (sw.active && !sw.hit && S.stunT <= 0 && !S.shieldUp && S.state === 'fight' && S.prevBlade && S.prevBlade.ok && !f.dead) {
      const cut = (bl, k) => ({ x: bl.h.x + (bl.t.x - bl.h.x) * k, y: bl.h.y + (bl.t.y - bl.h.y) * k });
      const a0 = cut(S.prevBlade, 0.3), b0 = S.prevBlade.t, a1 = cut(b, 0.3), b1 = b.t;
      const eff = swingEff();
      let best = null;
      for (const r of f.boxes().map(rectOf)) {
        if (!r.ok) continue;
        const hit = C.screenSweepHits(a0, b0, a1, b1, r);
        if (hit.hit && (!best || hit.f < best.f - 1e-6)) best = Object.assign(hit, { zone: r.name });
      }
      let clash = null;
      if (S.wSeg && S.wSegPrev && eff > 0.08) {
        const w0 = S.wSegPrev, w1 = S.wSeg;
        const c = C.bladesCross(a0, b0, a1, b1, w0.h, w0.t, w1.h, w1.t, 0.025);
        if (c.hit && (!best || c.f <= best.f + 0.05)) clash = c;
      }
      const motion = { x: b1.x - b0.x, y: b1.y - b0.y };
      const from = C.cutFrom(C.dirName(Math.hypot(motion.x, motion.y) > 1e-4 ? motion : sw.motion));
      if (clash) bladeClash({ point: clash.point, power: eff, from, motion });
      else if (best) {
        if (!C.brainInReach(brain)) sw.outOfReach = true;   // the blade passes short of him
        else {
          sw.hit = true;
          const bd = { x: b1.x - a1.x, y: b1.y - a1.y }, bl = Math.hypot(bd.x, bd.y) || 1, ml = Math.hypot(motion.x, motion.y);
          const align = ml > 1e-4 ? Math.abs(bd.x * motion.y - bd.y * motion.x) / (bl * ml) : 1;
          landCut(eff, from, best.zone, best.point, motion, align);
        }
      }
    }
    // thrust contact (at full extension)
    if (S.thrustT > 0.1 && !S.thrustHit && S.state === 'fight' && !f.dead) {
      S.thrustHit = true;
      let landed = false;
      if (C.brainInReach(brain, 'thrust')) {
        if (f.weapon && brain.state === 'idle' && brain.guard === 'mid') {
          // point in line: he turns it aside with his own point
          bladeClash({ point: b.t, power: 0.45, from: 'thrust', motion: { x: 0, y: 0.01 } });
          landed = true;
        } else {
          for (const r of f.boxes().map(rectOf)) {
            if (!r.ok) continue;
            const R2 = Object.assign({}, r, { hw: r.hw * 1.3 + 0.05, hh: r.hh * 1.1 + 0.05 });
            if (Math.abs(b.t.x - R2.cx) <= R2.hw && Math.abs(b.t.y - R2.cy) <= R2.hh) {
              landCut(C.effectivePower(0.45, { stamina: S.stamina }), 'thrust', r.name, b.t, { x: 0, y: 0.01 }, 1);
              landed = true; break;
            }
          }
        }
      }
      if (!landed) {
        S.overT = 0.35;
        brainStarted(C.brainOpening(brain, 'whiff'));
        popOnce('whiff', 1.2, C.brainInReach(brain, 'thrust') ? 'THRUST MISSED' : 'OUT OF REACH', 'sub', 'center');
      }
    }
    updateBind(dt);
  }

  /** The Grey Pack: the second wolf prowls and trades places to pounce. */
  function swapPack() {
    const m = S.mate;
    const cur = { fighter: S.fighter, brain: S.brain, foe: S.foe };
    S.fighter = m.fighter; S.brain = m.brain; S.foe = m.foe;
    S.mate = cur; S.attack = null;
    S.brain.timer = 250 + Math.random() * 250; S.brain.state = 'idle';
    cur.fighter.setAction('idle'); cur.fighter.setWalking(true); S.fighter.setWalking(true);
    $('foe-name').textContent = S.foe.p.name.toUpperCase();
    updateHud(true);
    Sfx.play('wolf', { vol: 0.8, rate: 1.1 });
    popOnce('pack', 2, 'THE OTHER ONE!', 'sub', 'high');
  }

  /* ----------------------------------------------------------- HUD */
  const hudCache = {};
  function setW(sel, v) { const k = Math.round(v * 1000) / 10; if (hudCache[sel] !== k) { hudCache[sel] = k; document.querySelector(sel).style.width = k + '%'; } }
  function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    setW('#me .hp i', S.hp / S.maxHp); setW('#me .hp b', S.hp / S.maxHp);
    const hn = Math.ceil(S.hp); if (hudCache.hpn !== hn) { hudCache.hpn = hn; $('me-hp').textContent = hn; }
    setW('#me .st i', S.stamina / C.STAMINA_MAX);
    document.querySelector('#me .st').classList.toggle('low', S.stamina < C.TIRED);
    if (S.foe) {
      const f = isFinite(S.foe.maxHp) ? Math.max(0, S.foe.hp / S.foe.maxHp) : 1;
      setW('#foe .hp i', f); setW('#foe .hp b', f);
      setW('#foe .poise i', S.brain ? Math.max(0, S.brain.poise / S.foe.p.poise) : 1);
    }
    const t = S.mode === 'practice' ? 'PRACTICE' : boutLabel(S.boutIdx) + (C.LADDER[S.boutIdx].title === 'Final' ? '' : ' OF VI');
    if (hudCache.title !== t) { hudCache.title = t; $('bout-title').textContent = t; }
    if (hudCache.fame !== S.fame) { hudCache.fame = S.fame; $('fame').innerHTML = 'FAME <b>' + S.fame + '</b>'; }
  }

  /* --------------------------------------------------------- overlay */
  const ZN = C.GUARD_ZONES;
  const ZLABEL = { left: 'BLOCK LEFT', right: 'BLOCK RIGHT', high: 'BLOCK HIGH', low: 'BLOCK LOW', thrust: 'POINT AT THEM' };
  function arrow(g, x, y, ang, size, color) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = color; g.beginPath();
    g.moveTo(size, 0); g.lineTo(-size * 0.6, -size * 0.75); g.lineTo(-size * 0.25, 0); g.lineTo(-size * 0.6, size * 0.75); g.closePath(); g.fill();
    g.restore();
  }
  function drawOverlay() {
    og.clearRect(0, 0, W, H);
    if (S.yieldT > 0.25 && (S.state === 'fight' || S.state === 'intro')) { // Grip pause gesture in progress
      const f = Math.min(1, S.yieldT / 1.2);
      og.lineWidth = 6; og.strokeStyle = 'rgba(230,192,102,0.95)';
      og.beginPath(); og.arc(W / 2, H * 0.55, 34, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); og.stroke();
      og.font = '600 14px Segoe UI, sans-serif'; og.textAlign = 'center'; og.fillStyle = 'rgba(244,234,214,0.95)'; og.fillText('PAUSING...', W / 2, H * 0.55 + 58);
    }
    if (S.state !== 'fight' || !S.fighter || S.fighter.dead) return;
    const b = S.brain, p = S.foe.p;
    // opponent's guard / openness
    const body = rectOf(S.fighter.boxes()[1]);
    if (body.ok) {
      const c = viewToPx({ x: body.cx, y: body.cy });
      const hw = body.hw / aspect * W / 2, hh = body.hh * H / 2;
      og.textAlign = 'center';
      if (b.state === 'idle' && b.guard && b.guard !== 'mid') {
        // his blade is the guard (you can see it); the marker just names the side it covers
        let x = c.x, y = c.y;
        if (b.guard === 'left') x = c.x - hw - 26; if (b.guard === 'right') x = c.x + hw + 26;
        if (b.guard === 'high') y = c.y - hh - 30; if (b.guard === 'low') y = c.y + hh + 20;
        drawShield(x, y, b.guard === 'all' ? 22 : 12);
        if (b.guard === 'all') { og.font = '600 11px Segoe UI, sans-serif'; og.fillStyle = 'rgba(244,234,214,0.85)'; og.fillText('FULL GUARD', x, y + 34); }
      } else if (b.state === 'stagger' || b.state === 'recover') {
        og.font = '700 18px Georgia, serif';
        og.fillStyle = b.state === 'stagger' ? 'rgba(255,215,110,0.95)' : 'rgba(244,234,214,0.7)';
        og.fillText(b.state === 'stagger' ? 'OPEN!' : 'open', c.x, c.y - hh - 18);
      }
      og.font = '600 12px Segoe UI, sans-serif';
      if (b.state === 'idle' && b.read) { og.fillStyle = 'rgba(255,170,120,0.9)'; og.fillText('READING YOUR ' + (SIDE_WORD[b.read] || '') + ' CUTS', c.x, c.y - hh - 44); }
      if (!C.brainInReach(b) && b.state !== 'windup') { og.fillStyle = 'rgba(244,234,214,0.75)'; og.fillText('OUT OF REACH - THRUST OR WAIT', c.x, c.y + hh + 46); }
      if (S.binding) { og.fillStyle = 'rgba(255,214,102,0.95)'; og.font = '700 16px Georgia, serif'; og.fillText('BIND - CUT HARD TO WIND OFF', c.x, c.y + hh + 66); }
    }
    // incoming strike telegraph
    const a = S.attack;
    if (!a || b.state !== 'windup') return;
    const z = ZN[a.dir];
    const zc = viewToPx({ x: z.cx, y: z.cy });
    const zw = z.hw / aspect * W / 2, zh = z.hh * H / 2;
    const remaining = Math.max(0, a.windup - b.elapsed), frac = remaining / a.windup;
    const inParry = remaining <= p.parryWindow;
    const covered = S.covers;
    const pulse = 0.5 + 0.5 * Math.sin(S.realT * (a.heavy ? 20 : 12));
    const red = a.heavy ? `rgba(255,${40 + 30 * pulse},30,` : 'rgba(235,60,40,';
    const col = covered ? 'rgba(255,214,102,' : red;
    og.save();
    og.fillStyle = col + (covered ? 0.16 : 0.1 + 0.08 * pulse) + ')';
    og.strokeStyle = col + '0.95)'; og.lineWidth = a.heavy ? 4 : 3; og.setLineDash(covered ? [] : [14, 9]);
    roundRect(zc.x - zw, zc.y - zh, zw * 2, zh * 2, 18); og.fill(); og.stroke();
    og.setLineDash([]);
    // where it comes from
    const big = Math.min(W, H) * 0.06;
    if (a.dir === 'left') arrow(og, 46, zc.y, 0, big, col + '0.95)');
    if (a.dir === 'right') arrow(og, W - 46, zc.y, Math.PI, big, col + '0.95)');
    if (a.dir === 'high') arrow(og, W / 2, 56, Math.PI / 2, big, col + '0.95)');
    if (a.dir === 'low') arrow(og, W / 2, H - 60, -Math.PI / 2, big, col + '0.95)');
    if (a.dir === 'thrust') { og.strokeStyle = col + '0.95)'; og.lineWidth = 4; og.beginPath(); og.arc(zc.x, zc.y, 14, 0, 7); og.stroke(); }
    // timing ring: closes on the impact moment; bright inside the parry window
    const rT = Math.min(zw, zh) * 0.32, r = rT + frac * Math.min(W, H) * 0.25;
    og.lineWidth = inParry ? 6 : 2.5;
    og.strokeStyle = inParry ? 'rgba(255,255,255,0.95)' : col + '0.6)';
    og.beginPath(); og.arc(zc.x, zc.y, rT, 0, 7); og.stroke();
    og.lineWidth = 3; og.strokeStyle = col + '0.9)';
    og.beginPath(); og.arc(zc.x, zc.y, r, 0, 7); og.stroke();
    // label
    og.font = '700 20px Georgia, serif'; og.textAlign = 'center'; og.fillStyle = col + '1)';
    og.shadowColor = 'rgba(0,0,0,0.8)'; og.shadowBlur = 6;
    const label = a.heavy ? 'HEAVY! PARRY OR DODGE' : (covered ? (inParry ? 'PARRY NOW' : 'GUARDED - wait for the ring') : ZLABEL[a.dir]);
    const ly = a.dir === 'high' ? Math.max(zc.y + 7, 132) : zc.y + 7;   // keep clear of the bout banner
    og.fillText(label, zc.x, ly);
    if (a.kind) { og.font = '700 15px Georgia, serif'; og.fillText(a.kind === 'riposte' ? 'RIPOSTE' : 'PUNISHING YOUR OPENING', zc.x, zc.y - 22); }
    if (S.overT > 0 && !a.heavy) { og.font = '600 12px Segoe UI, sans-serif'; og.fillText('still recovering: block only, no parry', zc.x, zc.y + 30); }
    og.restore();
  }
  function drawShield(x, y, s) {
    og.save(); og.translate(x, y);
    og.fillStyle = 'rgba(230,192,102,0.9)'; og.strokeStyle = 'rgba(40,20,5,0.9)'; og.lineWidth = 2;
    og.beginPath(); og.moveTo(-s, -s); og.lineTo(s, -s); og.lineTo(s, s * 0.15); og.quadraticCurveTo(s * 0.6, s * 0.9, 0, s * 1.2);
    og.quadraticCurveTo(-s * 0.6, s * 0.9, -s, s * 0.15); og.closePath(); og.fill(); og.stroke();
    og.restore();
  }
  function roundRect(x, y, w, h, r) {
    og.beginPath(); og.moveTo(x + r, y); og.arcTo(x + w, y, x + w, y + h, r); og.arcTo(x + w, y + h, x, y + h, r);
    og.arcTo(x, y + h, x, y, r); og.arcTo(x, y, x + w, y, r); og.closePath();
  }

  /* ------------------------------------------------------------- menus */
  let menuEl = null, menuIdx = 0;
  let wandCursor = null, inMenuNow = false;   // the Wand points at menus like a mouse; A clicks
  function focusMenu(el) { menuEl = el; menuIdx = 0; markFocus(); }
  function markFocus() { if (!menuEl) return; [...menuEl.querySelectorAll('.mi')].forEach((b, i) => b.classList.toggle('focus', i === menuIdx)); }
  function menuNav(clicked) {
    if (!menuEl) return;
    const items = [...menuEl.querySelectorAll('.mi')];
    if (!items.length) return;
    if (mc.pressed('down') || mc.pressed('right')) { menuIdx = (menuIdx + 1) % items.length; markFocus(); }
    if (mc.pressed('up') || mc.pressed('left')) { menuIdx = (menuIdx + items.length - 1) % items.length; markFocus(); }
    // A / Vol Down presses what the cursor points at, or the highlighted (first) item; B / Vol Up goes back
    if (mc.source === 'phone' && !clicked && mc.pressed('a')) act(items[menuIdx].dataset.act);
    if (mc.source === 'phone' && mc.pressed('b')) {
      const back = menuEl.querySelector('[data-act=resume]') || (S.state === 'results' ? menuEl.querySelector('[data-act=quit]') : null);
      if (back) act(back.dataset.act);
    }
  }
  function act(a) {
    Sfx.unlock();
    S.aLatch = true;           // the press that chose this must come up before it can raise the shield
    switch (a) {
      case 'versus':
        $('title').classList.add('hidden'); S.mode = 'versus'; S.state = 'versus'; clearFoe(); rig.visible = false;
        Sfx.startCrowd(); VS.enter(); break;
      case 'vs-mouse': VS.toggleMouse(); break;
      case 'vs-go': VS.go(); break;
      case 'ladder': case 'practice':
        $('title').classList.add('hidden'); $('hud').classList.remove('hidden');
        Sfx.startCrowd();
        newRun(a); break;
      case 'hand':
        prefs.hand = S.hand === 'right' ? 'left' : 'right'; applyPrefs(); savePrefs(); break;
      case 'sound': { // steps down to off, then back to full
        const i = VOLUMES.findIndex(v => Math.abs(v - prefs.volume) < 0.01);
        prefs.volume = VOLUMES[(i + 1) % VOLUMES.length]; applyPrefs(); savePrefs(); break;
      }
      case 'mute':
        if (prefs.volume > 0) { prefs.lastVolume = prefs.volume; prefs.volume = 0; } else prefs.volume = prefs.lastVolume || 1;
        applyPrefs(); savePrefs(); break;
      case 'fight': beginFight(); break;
      case 'next': hideCard(); startBout(S.boutIdx + 1); break;
      case 'resume': $('pause').classList.add('hidden'); S.state = S.pausedFrom; menuEl = null; break;
      case 'restart':
        $('pause').classList.add('hidden');
        if (S.mode === 'versus') { S.state = 'versus'; menuEl = null; VS.rematch(); break; }
        S.hp = Math.max(S.hp, 40); startBout(S.boutIdx); break;
      case 'again':
        $('results').classList.add('hidden');
        if (S.mode === 'versus') { S.state = 'versus'; menuEl = null; VS.rematch(); break; }
        $('hud').classList.remove('hidden'); newRun(S.mode === 'practice' ? 'ladder' : S.mode); break;
      case 'quit': toTitle(); break;
    }
  }
  function toTitle() {
    if (S.mode === 'versus') { VS.exit(); S.mode = 'ladder'; resize(); }
    ['pause', 'results', 'card', 'lobby'].forEach(id => $(id).classList.add('hidden'));
    $('restart-label').textContent = 'RESTART BOUT';
    $('hud').classList.add('hidden'); $('title').classList.remove('hidden');
    clearFoe(); S.state = 'title'; focusMenu($('title-menu'));
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.mi'); if (b) { e.stopPropagation(); act(b.dataset.act); }
  });
  let rumbleAsked = false;
  function askRumble() {
    Sfx.unlock();
    if (rumbleAsked || mc.rumbleReady) return; rumbleAsked = true;
    $('rumble-status').textContent = 'Vibration: pick your phone in the prompt';
    mc.enableRumble().then(ok => { $('rumble-status').textContent = ok ? 'Vibration ready' : 'Vibration off (needs Chrome + WebHID)'; });
  }
  addEventListener('pointerdown', askRumble); addEventListener('keydown', askRumble);
  function pause(why) {
    if (!['fight', 'intro', 'down'].includes(S.state) && !(S.state === 'versus' && VS.state !== 'lobby' && VS.state !== 'results')) return;
    S.pausedFrom = S.state; S.state = 'paused'; S.yieldT = 0;
    $('pause-why').textContent = why || ''; $('pause-why').classList.toggle('hidden', !why);
    $('restart-label').textContent = S.mode === 'versus' ? 'RESTART MATCH' : 'RESTART BOUT';
    applyWords(true);
    $('pause').classList.remove('hidden'); focusMenu($('pause-menu'));
  }
  let keyThrust = false;
  function takeKeyThrust() { const k = keyThrust; keyThrust = false; return k; }
  addEventListener('keydown', e => {
    if ((e.key === 'f' || e.key === 'F') && !e.repeat) keyThrust = true;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (S.state === 'paused') act('resume');
      else if (S.state === 'versus' && VS.state === 'lobby') toTitle();
      else pause();
    }
    if (e.key === 'm' || e.key === 'M') act('mute');
    if ((e.key === 'Enter' || e.key === ' ') && menuEl && !menuEl.closest('.hidden') && S.state !== 'fight') {
      const items = [...menuEl.querySelectorAll('.mi')]; if (items[menuIdx]) { e.preventDefault(); act(items[menuIdx].dataset.act); }
    }
  });

  /* -------------------------------------------------------------- loop */
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.1, (now - last) / 1000); last = now;
    S.realT += realDt;
    if (realDt > 0) S.fps += (1 / realDt - S.fps) * 0.05;
    mc.update(now);
    // rotation speed straight from the orientation stream (two-sample mean, no smoothing lag), so a
    // swing still reads at full speed when the frame rate dips (a recorded session ran at ~15 fps)
    {
      const q = mc.quat, L = S.lastQ;
      if (L && realDt > 0) {
        const d = Math.min(1, Math.abs(q.x * L.x + q.y * L.y + q.z * L.z + q.w * L.w));
        const raw = 2 * Math.acos(d) / realDt;
        S.angSpeed = (raw + (S.angRaw || 0)) / 2; S.angRaw = raw;
      }
      S.lastQ = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
    // dynamic resolution: drop it when the frame rate sags, creep back up when there is headroom
    S.prT = (S.prT || 0) + realDt;
    if (S.prT > 1.2 && S.state !== 'loading' && S.state !== 'paused') {
      S.prT = 0;
      const pr = renderer.getPixelRatio();
      S.prHold = Math.max(0, (S.prHold || 0) - 1.2);
      // a step down that did not raise the frame rate (CPU-bound, not pixel-bound) is undone and
      // resolution holds for a while: blur that buys nothing is all loss
      if (S.prTry && S.fps < S.prTry.fps * 1.04) { renderer.setPixelRatio(S.prTry.pr); S.prTry = null; S.prHold = 30; }
      else {
        S.prTry = null;
        let np = pr;
        if (S.fps < 50 && pr > PR_MIN && !S.prHold) { np = Math.max(PR_MIN, pr - 0.1); S.prTry = { pr, fps: S.fps }; }
        else if (S.fps > 58 && pr < PR_MAX) np = Math.min(PR_MAX, pr + 0.05);
        if (np !== pr) renderer.setPixelRatio(np);
      }
    }
    if (S.state === 'loading') return;
    applyWords();
    if (!wandCursor && window.MimicCursor) wandCursor = MimicCursor.create(mc, { visible: () => inMenuNow });

    // versus: its own loop, two cameras, split screen
    if (S.state === 'versus' || (S.state === 'paused' && S.pausedFrom === 'versus')) {
      if (S.state === 'paused' && (mc.pressed('plus') || mc.pressed('home'))) act('resume');
      VS.frame(realDt, S.state === 'paused');
      inMenuNow = S.state === 'paused' || VS.state === 'results';
      const clickedV = wandCursor ? wandCursor.update() : false;
      if (inMenuNow) {
        menuNav(clickedV);
        // the second phone can drive the pause / results menu with its buttons too
        for (const c of VS.others()) {
          if (!menuEl || menuEl.closest('.hidden')) break;
          const items = [...menuEl.querySelectorAll('.mi')];
          if (c.pressed('a') && items[menuIdx]) { act(items[menuIdx].dataset.act); break; }
          const back = menuEl.querySelector('[data-act=resume]');
          if (c.pressed('b') && back) { act('resume'); break; }
        }
      }
      if (VS.state === 'lobby') {
        const a = S.realT * 0.05;
        camera.position.set(Math.sin(a) * 9, 3.2, Math.cos(a) * 9); camera.lookAt(0, 4.5, 0);
        LudusWorld.update(world, S.realT, 0.4); Sfx.crowd(0.4);
        renderer.render(scene, camera); og.clearRect(0, 0, W, H);
      } else VS.render();
      return;
    }
    if (mc.pressed('plus') || mc.pressed('home')) { if (S.state === 'paused') act('resume'); else pause(); }

    // time: slow motion and hit-stop
    if (S.slowT > 0) { S.slowT -= realDt; if (S.slowT <= 0) S.timeScale = 1; }
    let dt = realDt * S.timeScale;
    if (S.freezeT > 0) { S.freezeT -= realDt; dt = 0; }
    if (S.state === 'paused' || S.state === 'title' || S.state === 'results') dt = S.state === 'paused' ? 0 : dt;
    S.gameMs += dt * 1000;

    updateSword(realDt);

    const inMenu = ['title', 'between', 'results', 'paused'].includes(S.state) || (S.state === 'intro' && !$('card').classList.contains('hidden'));
    inMenuNow = inMenu;
    const clicked = wandCursor ? wandCursor.update() : false;
    if (inMenu) menuNav(clicked);
    if (S.state === 'fight' || S.state === 'intro') {
      // a phone that drops out pauses the bout; Grip has no pause key: lower the blade to the floor and hold Vol Down
      if (mc.source === 'phone') S.hadPhone = true;
      else if (S.hadPhone) { S.hadPhone = false; pause('Your phone disconnected. Reconnect it (Mimic app, Bluetooth), then RESUME.'); }
      if (mc.source === 'phone' && mc.isDown('a') && mc.pitch < -1.15) { S.yieldT = (S.yieldT || 0) + realDt; if (S.yieldT > 1.2) pause(); }
      else S.yieldT = 0;
      if (mc.pressed('center')) pop('ALIGNED', 'sub', 'high');
    }

    const f = S.fighter;
    if ((S.state === 'intro' || S.state === 'fight') && f && !f.dead) {
      S.introT += dt;
      const target = new T.Vector3(0, 0, PLAYER.z - f.p.dist - (S.brain ? S.brain.dist : 0));
      const d = target.clone().sub(f.root.position); d.y = 0;
      const speed = Math.max(f.p.beast ? 3.6 : f.p.model === 'troll' ? 1.8 : 2.4, (f.p.footSpeed || 2.4) * 1.3);
      const len = d.length();
      if (len > 0.02) f.root.position.addScaledVector(d.normalize(), Math.min(len, speed * dt));
      if (S.state === 'fight' || len < 0.05) f.setWalking(len > 0.25);
    }
    // the rest of the pack prowls off to the side
    if (S.mate && (S.state === 'intro' || S.state === 'fight')) {
      const m = S.mate.fighter, side = f && f.root.position.x > 0.5 ? -1 : 1;
      const tgt = new T.Vector3(side * (1.9 + 0.3 * Math.sin(S.realT * 0.8)), 0, PLAYER.z - m.p.dist - 1.4 + 0.5 * Math.sin(S.realT * 0.55));
      const d = tgt.sub(m.root.position); d.y = 0;
      const len = d.length();
      if (len > 0.03) m.root.position.addScaledVector(d.normalize(), Math.min(len, 2.6 * dt));
      m.setWalking(len > 0.15);
      m.root.rotation.y = Math.atan2(PLAYER.x + S.dodgeX - m.root.position.x, PLAYER.z - m.root.position.z);
      m.update(dt);
    }
    if (S.corpse) S.corpse.update(dt);
    if (S.state === 'fight') {
      S.stats.time += dt;
      fightInput(dt);
      // is the blade across the incoming strike? (judged on this frame's blade, before the blow lands)
      const updateCover = () => {
        if (S.brain.state !== 'windup') S.attack = null;
        if (S.attack && S.blade.ok) {
          const c = C.guardCovers(S.blade, S.attack.dir);
          if (c && !S.covers) S.coverStart = S.gameMs;
          S.covers = c;
        } else { S.covers = false; S.coverStart = null; }
      };
      updateCover();
      // brain
      for (const e of C.brainStep(S.brain, dt * 1000)) onBrainEvent(e);
      if (S.brain.state === 'stagger' && f.mode !== 'stagger') f.setAction('stagger');
      if (S.brain.state === 'idle' && (f.mode === 'stagger' || f.mode === 'strike') && f.modeT > 0.7) f.setAction('idle');
      updateCover();
      // stamina
      S.sinceSpend += dt;
      S.stamina = C.staminaStep(S.stamina, dt, { sinceSpend: S.sinceSpend, shieldUp: S.shieldUp });
      if (S.shieldUp) S.sinceSpend = 0;
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hint(''); }
      if (S.stamina < 15 && hintTimer <= 0) hint('Exhausted! Your cuts are feeble and your guard will break. Stop swinging to breathe.', 2);
    } else {
      S.covers = false;
    }
    if (S.state === 'down') {
      S.endT += realDt;
      if (S.endT > 2.4) {
        if (S.queue.length) { clearFoe(); spawnNext(false); S.state = 'intro'; setTimeout(() => { if (S.state === 'intro') beginFight(); }, 1800); }
        else boutWon();
      }
    }
    if (S.state === 'defeat') { S.endT += realDt; if (S.endT > 2.6) showResults(false); }
    // timers
    S.overT = Math.max(0, S.overT - dt);
    S.dodgeT = Math.max(0, S.dodgeT - dt); S.stunT = Math.max(0, S.stunT - dt); S.knock = Math.max(0, S.knock - dt * 2.5);
    if (S.thrustT > 0) { S.thrustT += dt; if (S.thrustT > 0.28) S.thrustT = 0; }
    const dodgeTarget = S.dodgeT > 0 ? S.dodgeDir * 0.75 : 0;
    S.dodgeX += (dodgeTarget - S.dodgeX) * Math.min(1, realDt * 12);

    // fighter: face the player
    if (f) {
      const dx = PLAYER.x + S.dodgeX - f.root.position.x, dz = PLAYER.z - f.root.position.z;
      f.root.rotation.y = Math.atan2(dx, dz);
      f.guardSide = S.brain && S.brain.guard ? S.brain.guard : 'none';
      f.update(dt);
    }
    // camera
    const shake = S.shake > 0 ? S.shake : 0; S.shake = Math.max(0, S.shake - realDt * 0.8);
    camera.position.set(PLAYER.x + S.dodgeX + (Math.random() - 0.5) * shake * 0.3, EYE + (Math.random() - 0.5) * shake * 0.3, PLAYER.z);
    if (S.state === 'title' || S.state === 'loading') {
      const a = S.realT * 0.05;
      camera.position.set(Math.sin(a) * 9, 3.2, Math.cos(a) * 9);
      S.camTarget.set(0, 4.5, 0);
    } else if (f) {
      const h = f.p.height;
      const ty = Math.max(0.85, Math.min(1.8, h * 0.62));
      S.camTarget.lerp(tmpV.set(f.root.position.x * 0.8, ty, f.root.position.z), Math.min(1, realDt * 4));
    }
    camera.lookAt(S.camTarget);
    // camera kick: the blow you take (or land) jolts the view, then it settles
    if (Math.abs(S.kickX) + Math.abs(S.kickY) > 1e-4) { camera.rotateY(S.kickX); camera.rotateX(S.kickY); }
    const kd = Math.exp(-9 * realDt); S.kickX *= kd; S.kickY *= kd;
    rig.visible = !['title', 'loading', 'results'].includes(S.state);

    // effects
    S.vignette = Math.max(0, S.vignette - realDt * 1.6); $('vignette').style.opacity = Math.max(S.vignette, S.hp < 30 && S.state === 'fight' ? 0.35 + 0.1 * Math.sin(S.realT * 4) : 0);
    S.flash = Math.max(0, S.flash - realDt * 2.5); $('flash').style.opacity = S.flash;
    clashLight.intensity = Math.max(0, clashLight.intensity - realDt * 40);
    S.excite += (0.3 - S.excite) * Math.min(1, realDt * 0.35);
    Sfx.crowd(S.excite);
    fx.update(dt);
    LudusWorld.update(world, S.realT, Math.min(1, S.excite));

    if (S.state !== 'title') updateHud();
    renderer.render(scene, camera);
    drawOverlay();
  }

  /* ----------------------------------------------------------- versus */
  const core = {
    mc, scene, renderer, Sfx, $, assets, og, makeRig, poseRig, continuousArm, popAt, word, modeName, takeKeyThrust,
    fx: () => fx, world: () => world, flashLight,
    pause: why => pause(why), quit: () => toTitle(),
    showScreen(id) { ['title', 'pause', 'results', 'card', 'lobby'].forEach(x => $(x).classList.toggle('hidden', x !== id)); },
    hideScreens() { ['title', 'pause', 'results', 'card', 'lobby'].forEach(x => $(x).classList.add('hidden')); },
    showResults(r) {
      $('res-kicker').textContent = r.kicker; $('res-title').textContent = r.title;
      $('res-fame').textContent = r.fame; $('res-fame-l').textContent = r.fameLabel || '';
      $('res-stats').innerHTML = r.statsHtml; $('res-again').textContent = r.again || 'FIGHT AGAIN';
      $('results').classList.remove('hidden'); focusMenu($('res-menu'));
    },
  };
  const VS = LudusVersus.create(core);
  window.__ludusVs = VS; // for tests
  Object.assign(window.__ludusDebug, { act, showCard, showResults, pause, toTitle, core });

  /* ------------------------------------------------------------- boot */
  function boot() {
    applyPrefs();
    loadAll().then(() => {
      world = LudusWorld.build(scene, renderer, assets);
      fx = LudusFx.create(scene);
      clashLight = new T.PointLight(0xffe2a8, 0, 4, 2); scene.add(clashLight);
      addShield(R0);
      $('loading').classList.add('hidden');
      $('title').classList.remove('hidden');
      S.state = 'title'; focusMenu($('title-menu'));
      Sfx.preload();
      window.__ludusReady = true;
    }).catch(err => { $('load-text').textContent = 'Failed to load: ' + err.message; console.error(err); });
    requestAnimationFrame(frame);
  }
  if (window.__threeLoadersReady) boot(); else addEventListener('three-loaders', boot, { once: true });
})();
