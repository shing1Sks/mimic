/*
 * Iron Ludus - game loop: the phone as your sword, the duel, HUD, screens.
 * Rules live in combat.js (tested); bodies and weapons in fighters.js; this file wires them to the
 * phone and the scene.
 *
 * Your blade is a 3D blade in the arena: its orientation is the phone's, 1:1, its hilt moves with
 * an arm model, and a forward push of the phone lunges you in. No buttons fight for you: CENTRE
 * lines the blade up, + / Home pauses. Everything else is where your blade is and how fast it moves.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat, Sfx = LudusAudio, MM = MimicMath;
  const mc = new MimicController();
  const $ = id => document.getElementById(id);
  const rec = (name, data) => { try { if (window.MimicRec && MimicRec.event) MimicRec.event(name, data); } catch (e) { /* not recording */ } };
  const r2 = v => Math.round(v * 100) / 100;

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
  const camera = new T.PerspectiveCamera(70, 1, 0.03, 500);
  scene.add(camera);
  const ov = $('overlay'), og = ov.getContext('2d');
  let W = 1, H = 1, aspect = 1;
  function resize() {
    W = innerWidth; H = innerHeight; aspect = W / H;
    renderer.setSize(W, H); camera.aspect = aspect; camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio || 1, 2); ov.width = W * dpr; ov.height = H * dpr; og.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  const PLAYER = new T.Vector3(0, 0, 5), EYE = C.BODY.eye;

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
    for (const n of ['arch', 'torch', 'shield']) jobs.push(() => L.loadAsync('assets/models/' + n + '.glb').then(g => { assets[n] = g.scene; }));
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
  // A rig is the sword, the gloved fist round its grip, the forearm and upper arm, in the space of
  // your head (the arm model's space). The head sits on your body, which faces your opponent.
  const BLADE = C.BODY.blade, GUARD_Z = C.BODY.guardZ;
  const RIG_OFFSET = new T.Vector3(...C.BODY.rigOffset); // bring the hand and hilt into view
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
      f.rotation.z = Math.PI * 0.32 + i * 0.05;
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
  /** A body (Group facing -Z at the feet) with a head at eye height; the rig hangs off the head. */
  function makeBody(parent) {
    const body = new T.Group(); parent.add(body);
    const head = new T.Group(); head.position.y = EYE; body.add(head);
    return { body, head };
  }
  function makeRig(head, tint) {
    const R = { armState: {}, fadeLimb: 1 };
    R.rig = new T.Group(); R.rig.position.copy(RIG_OFFSET); head.add(R.rig);
    R.head = head;
    R.hand = new T.Group(); R.rig.add(R.hand);
    R.swordGrp = buildSword(); R.hand.add(R.swordGrp);
    const mat = (color, rough, env, metal) => { // colours are picked by eye (sRGB); the renderer works in linear
      const m = new T.MeshStandardMaterial({ color, roughness: rough, envMapIntensity: env, metalness: metal || 0, transparent: true });
      m.color.convertSRGBToLinear(); return m;
    };
    R.limbMats = [mat(0x4a2d1a, 0.8, 0.35), mat(0x3a3029, 0.42, 0.7, 0.65), mat(tint || 0x6b1a14, 0.9, 0.3)];
    R.handMats = [mat(0x3b2416, 0.72, 0.4), mat(0x8a7350, 0.35, 0.9, 0.85)];
    R.handMats.forEach(m => { m.transparent = false; });
    R.fist = buildFist(R.handMats[0], R.handMats[1]); R.hand.add(R.fist);
    R.forearm = new T.Mesh(new T.CylinderGeometry(0.044, 0.035, 1, 14), R.limbMats[0]); R.rig.add(R.forearm);
    R.bracer = new T.Mesh(new T.CylinderGeometry(0.049, 0.043, 0.13, 14), R.limbMats[1]); R.rig.add(R.bracer);
    R.upperArm = new T.Mesh(new T.CylinderGeometry(0.058, 0.047, 1, 14), R.limbMats[2]); R.rig.add(R.upperArm);
    R.armParts = [R.forearm, R.bracer, R.upperArm, R.fist];
    for (const m of R.armParts) m.traverse(o => { o.renderOrder = 5; });
    return R;
  }

  const UP = new T.Vector3(0, 1, 0), tmpV = new T.Vector3(), tmpV2 = new T.Vector3(), tmpQ = new T.Quaternion();
  function placeLimb(mesh, a, b) {
    tmpV.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = tmpV.length();
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.normalize());
    mesh.scale.set(1, len, 1);
  }
  /*
   * The arm must never block the fight: any part of it that comes close to the eyes inside the
   * middle of the view fades out, and returns as it leaves. The sword and the fist never fade.
   */
  const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  function intrusion(cam, p) {
    const x = p.x + RIG_OFFSET.x, y = p.y + RIG_OFFSET.y, d = -(p.z + RIG_OFFSET.z);
    if (d < 0.01) return 0;
    const tv = Math.tan(cam.fov * Math.PI / 360), th = tv * cam.aspect;
    const r = 0.06;
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
    R.limbMats.forEach(m => { m.opacity = R.fadeLimb; m.depthWrite = R.fadeLimb > 0.98; });
    R.forearm.visible = R.bracer.visible = R.upperArm.visible = R.fadeLimb > 0.03;
  }
  /** Hand position in head space for an arm pose and a lunge extension (m, along the body's forward). */
  const ARM_EXT = 0.45;   // of a lunge, the arm's share; the body steps in the rest
  function handAt(arm, ext) { return { x: arm.hand.x, y: arm.hand.y, z: arm.hand.z - ext * ARM_EXT }; }
  /**
   * The blade in world space for an orientation q (plain quaternion), arm pose and extension, without
   * moving any mesh (used for the in-between steps of a fast swing). edgeRoll: CENTRE calibration.
   */
  function bladeWorld(R, q, arm, ext, edgeRoll) {
    const hp = handAt(arm, ext);
    const base = tmpV.set(hp.x + RIG_OFFSET.x, hp.y + RIG_OFFSET.y, hp.z + RIG_OFFSET.z);
    const hd = MM.rotate(q, { x: 0, y: 0, z: GUARD_Z }), td = MM.rotate(q, { x: 0, y: 0, z: GUARD_Z - BLADE });
    const h = new T.Vector3(base.x + hd.x, base.y + hd.y, base.z + hd.z).applyMatrix4(R.head.matrixWorld);
    const t = new T.Vector3(base.x + td.x, base.y + td.y, base.z + td.z).applyMatrix4(R.head.matrixWorld);
    const e = MM.rotate(q, { x: Math.sin(edgeRoll || 0), y: Math.cos(edgeRoll || 0), z: 0 });
    const edge = new T.Vector3(e.x, e.y, e.z).transformDirection(R.head.matrixWorld);
    return { h, t, edge };
  }
  /** Put a rig's sword and arm where the phone says. q: display orientation (THREE.Quaternion). */
  function poseRig(R, cam, q, arm, o) {
    R.hand.quaternion.copy(q);
    const hp = handAt(arm, o.ext || 0);
    R.hand.position.set(hp.x, hp.y, hp.z);
    R.swordGrp.rotation.z = -(o.edgeRoll || 0);   // the edges where your grip put them at CENTRE
    const wrist = { x: hp.x - (arm.hand.x - arm.wrist.x), y: hp.y - (arm.hand.y - arm.wrist.y), z: hp.z - (arm.hand.z - arm.wrist.z) };
    placeLimb(R.forearm, arm.elbow, wrist);
    const bp = { x: arm.elbow.x + (wrist.x - arm.elbow.x) * 0.8, y: arm.elbow.y + (wrist.y - arm.elbow.y) * 0.8, z: arm.elbow.z + (wrist.z - arm.elbow.z) * 0.8 };
    placeLimb(R.bracer, arm.elbow, wrist); R.bracer.position.set(bp.x, bp.y, bp.z); R.bracer.scale.y = 1;
    placeLimb(R.upperArm, arm.shoulder, arm.elbow);
    if (cam) fadeArm(R, cam, arm, wrist, o.dt || 0.016);
    R.rig.updateMatrixWorld(true);
  }
  /** Your body's hit capsules in world space: head, torso, sword arm (from the arm model), legs. */
  function bodyCapsules(R, B, arm, ext) {
    const p = B.body.position, hw = v => new T.Vector3(v.x + RIG_OFFSET.x, v.y + RIG_OFFSET.y, v.z + RIG_OFFSET.z).applyMatrix4(R.head.matrixWorld);
    const fz = new T.Vector3(0, 0, -1).transformDirection(B.body.matrixWorld), sx = new T.Vector3(1, 0, 0).transformDirection(B.body.matrixWorld);
    const at = (x, y, z) => new T.Vector3(p.x, y, p.z).addScaledVector(sx, x).addScaledVector(fz, z);
    const hand = handAt(arm, ext);
    return [
      { zone: 'head', a: at(0, EYE - 0.06, -0.02), b: at(0, EYE + 0.1, -0.02), r: 0.12 },
      { zone: 'torso', a: at(0, 0.98, -0.02), b: at(0, EYE - 0.24, -0.02), r: 0.19 },
      { zone: 'swordArm', a: hw(arm.shoulder), b: hw(arm.elbow), r: 0.055 },
      { zone: 'swordArm', a: hw(arm.elbow), b: hw(hand), r: 0.055 },
      { zone: 'offArm', a: at(-0.22, 1.36, 0), b: at(-0.25, 1.02, -0.12), r: 0.05 },
      { zone: 'legs', a: at(-0.12, 0.92, 0), b: at(-0.13, 0.08, 0.02), r: 0.085 },
      { zone: 'legs', a: at(0.12, 0.92, 0), b: at(0.13, 0.08, 0.02), r: 0.085 },
    ];
  }
  function slerpQ(a, b, t) {
    let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let wa, wb;
    if (d > 0.9995) { wa = 1 - t; wb = t; } else { const th = Math.acos(d), s = Math.sin(th); wa = Math.sin((1 - t) * th) / s; wb = Math.sin(t * th) / s; }
    const o = { x: a.x * wa + bx * wb, y: a.y * wa + by * wb, z: a.z * wa + bz * wb, w: a.w * wa + bw * wb };
    const l = Math.hypot(o.x, o.y, o.z, o.w) || 1;
    return { x: o.x / l, y: o.y / l, z: o.z / l, w: o.w / l };
  }
  const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));

  // mc.arm turns the upper arm the short way round (q^0.4): when the phone's whole rotation passes
  // 180 deg the elbow flips sides and the hilt jumps. Same arm, but the elbow's share is tracked
  // continuously through 180 deg (MimicMath.qpowFollow) and eased back to the usual arm.
  const ELBOW_SHARE = 0.4;
  function continuousArm(q, pose, dt, armState, angSpeed) {
    const upperW = { x: pose.elbow.x - pose.shoulder.x, y: pose.elbow.y - pose.shoulder.y, z: pose.elbow.z - pose.shoulder.z };
    const short = MM.qpow(q, ELBOW_SHARE);
    const upper = MM.rotate({ x: -short.x, y: -short.y, z: -short.z, w: short.w }, upperW);
    const nu = MM.rotate(MM.qpowFollow(q, ELBOW_SHARE, armState, dt * (0.6 + 0.15 * (angSpeed || 0))), upper);
    const d = { x: nu.x - upperW.x, y: nu.y - upperW.y, z: nu.z - upperW.z };
    const add = v => ({ x: v.x + d.x, y: v.y + d.y, z: v.z + d.z });
    return { shoulder: pose.shoulder, elbow: add(pose.elbow), wrist: add(pose.wrist), hand: add(pose.hand) };
  }

  /*
   * One phone as a sword: orientation, arm, lunge and CENTRE calibration, plus the blade's path
   * through the last frame in small steps. Shared by the ladder and versus (one per player).
   */
  function makeSwordHand(ctl, R, B, side) {
    const H = { ctl, R, B, side: side || 'right', q: { x: 0, y: 0, z: 0, w: 1 }, prevQ: null, arm: null, ext: 0, extV: 0, extGoal: 0, lungeCd: 0,
      edgeRoll: 0, rollSin: 0, rollCos: 1, calibrated: false, path: [], blade: null, prevBlade: null, angSpeed: 0, knock: 0, knockAxis: new T.Vector3(0, 0, 1),
      tipVel: new T.Vector3(), held: false, lungeMul: 1 };
    return H;
  }
  /** Capture how the hilt is held (its roll) as the edge plane: at CENTRE, or quietly before the first CENTRE. */
  function calibrate(H, q, now) {
    const g = MM.rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, { x: 0, y: 1, z: 0 });
    if (Math.hypot(g.x, g.y) < 0.5) return;
    const phi = Math.atan2(g.x, g.y);
    if (now) { H.edgeRoll = phi; H.calibrated = true; H.rollSin = Math.sin(phi); H.rollCos = Math.cos(phi); return; }
    H.rollSin += (Math.sin(phi) - H.rollSin) * 0.02; H.rollCos += (Math.cos(phi) - H.rollCos) * 0.02;
    H.edgeRoll = Math.atan2(H.rollSin, H.rollCos);
  }
  /**
   * Read the phone and move the blade. dt real seconds. o = { fight (bool: lunges allowed),
   * freeze (hit-stop: hold the blade where it struck) }. Fills H.path with the blade's steps.
   */
  function updateSwordHand(H, dt, o) {
    const c = H.ctl;
    let q, arm;
    if (c.source === 'phone') {
      q = c.quat;
      arm = H.side === 'left' ? MM.armPose(q, 'left') : continuousArm(q, MM.armPose(q, 'right'), dt, H.R.armState, H.angSpeed);
      if (!H.calibrated && !o.fight && c.angularSpeed < 1.2) calibrate(H, q, false);
      if (c.pressed('center')) { calibrate(H, q, true); rec('align', { roll: r2(H.edgeRoll * 180 / Math.PI) }); }
    } else {
      // mouse: the tip follows the cursor; the blade rides a little raised, like a guard
      const yaw = c.yaw * 1.15, pitch = c.pitch * 1.25 + 0.45;
      q = MM.fromEuler(yaw, pitch, -c.yaw * 0.5);
      arm = MM.armPose(q, H.side);
    }
    H.mouse = c.source !== 'phone';
    if (H.prevQ && dt > 0) H.angSpeed = qAngle(q, H.prevQ) / dt;
    // the lunge: a hard push of the phone along the blade drives the arm and the body forward
    H.lungeCd -= dt;
    const la = c.linearAccel, f = c.forward;
    const push = c.source === 'phone' ? la.x * f.x + la.y * f.y + la.z * f.z : 0;
    if (o.fight && H.lungeCd <= 0 && H.ext < 0.05 && ((push > 14 && c.angularSpeed < 7) || (o.keyLunge))) {
      H.extGoal = Math.min(1, o.keyLunge ? 0.9 : (push - 8) / 18) * 0.42 * H.lungeMul;
      H.lungeCd = 0.55; H.lungeT = 0; rec('lunge', { push: r2(push), ext: r2(H.extGoal) });
      Sfx.play('step', { vol: 0.5 });
    }
    if (H.extGoal > 0) {
      H.lungeT += dt;
      if (H.lungeT < 0.11) H.ext += (H.extGoal - H.ext) * Math.min(1, dt * 30);
      else if (H.lungeT > 0.22) { H.ext += (0 - H.ext) * Math.min(1, dt * (5 * H.lungeMul + 2)); if (H.ext < 0.005) { H.ext = 0; H.extGoal = 0; } }
    }
    const dq = new T.Quaternion(q.x, q.y, q.z, q.w);
    // a blade beaten aside: knocked off line for a moment, springing back to your hand
    if (H.knock > 0.002) { dq.premultiply(tmpQ.setFromAxisAngle(H.knockAxis, H.knock * 0.7)); H.knock *= Math.exp(-9 * dt); } else H.knock = 0;
    const dqp = { x: dq.x, y: dq.y, z: dq.z, w: dq.w };
    if (o.freeze && H.blade) { H.path = [H.blade, H.blade]; H.prevQ = H.prevQ || dqp; return; }
    H.B.body.updateMatrixWorld(true);
    // the blade's steps from last frame's pose to this one (a fast swing turns ~0.5 rad a frame)
    const from = H.dispQ || dqp, steps = Math.max(1, Math.min(12, Math.ceil(qAngle(from, dqp) / 0.07)));
    const ext0 = H.prevExt === undefined ? H.ext : H.prevExt;
    H.path = [H.blade || bladeWorld(H.R, from, MM.armPose(from, H.side), ext0, H.edgeRoll)];
    for (let k = 1; k < steps; k++) {
      const qk = slerpQ(from, dqp, k / steps);
      H.path.push(bladeWorld(H.R, qk, MM.armPose(qk, H.side), ext0 + (H.ext - ext0) * k / steps, H.edgeRoll));
    }
    const cur = bladeWorld(H.R, dqp, arm, H.ext, H.edgeRoll);
    H.path.push(cur);
    H.prevBlade = H.blade; H.blade = cur; H.arm = arm; H.dispQ = dqp; H.prevQ = { x: q.x, y: q.y, z: q.z, w: q.w }; H.prevExt = H.ext;
    if (dt > 0 && H.prevBlade) H.tipVel.copy(cur.t).sub(H.prevBlade.t).divideScalar(dt);
    H.q = dq;
  }

  /* --------------------------------------------------------------- state */
  const S = {
    state: 'loading', mode: 'ladder', boutIdx: 0, hand: 'right',
    hp: 100, maxHp: 100, fame: 0, wounds: C.woundState(),
    foe: null, queue: [], brain: null, fighter: null, mate: null, corpse: null,
    swing: C.swingTracker(), swingHit: -1, timeScale: 1, slowT: 0, freezeT: 0, gameMs: 0, realT: 0,
    shake: 0, excite: 0.3, vignette: 0, flash: 0, daze: 0, offT: 0, openT: 0, sway: 0, swayV: 0,
    stats: null, total: null, won: 0, introT: 0, endT: 0, kickX: 0, kickY: 0,
    hisPrev: null, capsPrev: null, fps: 60, lastPop: {}, last: null, practiceFoe: 'dummy',
  };
  // settings that outlive the page: sword hand, volume, read assist
  const PREFS_KEY = 'ironludus.settings', VOLUMES = [1, 0.75, 0.5, 0.25, 0];
  const prefs = (() => { try { return Object.assign({ hand: 'right', volume: 1, assist: false }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return { hand: 'right', volume: 1, assist: false }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } };
  const volText = v => v > 0 ? Math.round(v * 100) + '%' : 'OFF';
  function applyPrefs() {
    S.hand = prefs.hand === 'left' ? 'left' : 'right'; mc.setHand(S.hand);
    if (HAND) HAND.side = S.hand;
    Sfx.setVolume(prefs.volume);
    $('opt-hand').textContent = S.hand.toUpperCase();
    document.querySelectorAll('.opt-vol').forEach(el => { el.textContent = volText(prefs.volume); });
    document.querySelectorAll('.opt-assist').forEach(el => { el.textContent = prefs.assist ? 'ON' : 'OFF'; });
  }
  const freshStats = () => ({ hits: 0, parries: 0, blocks: 0, beats: 0, taken: 0, bestHit: 0, bestSpeed: 0, counters: 0, time: 0, fame: 0, whiffs: 0, swings: 0, disarms: 0 });

  let world = null, fx = null, clashLight = null;
  const ME = makeBody(scene); ME.body.position.copy(PLAYER);
  const R0 = makeRig(ME.head);
  const rig = R0.rig;
  let HAND = makeSwordHand(mc, R0, ME, 'right');
  window.__ludus = S; // for tests
  window.__ludusDebug = { gfx: () => ({ renderer, scene, camera, world }), hand: () => HAND,
    bladeFor: q => { ME.body.updateMatrixWorld(true); const b = bladeWorld(R0, q, MM.armPose(q, S.hand), 0, HAND.edgeRoll); return { h: b.h, t: b.t }; },
    start: (i, mode) => { ['title', 'results', 'pause'].forEach(id => $(id).classList.add('hidden')); $('hud').classList.remove('hidden'); newRun(mode || 'ladder'); if (i) startBout(i); } };

  /* ----------------------------------------------------------- utilities */
  function toView(v3) { tmpV2.copy(v3).project(camera); return { x: tmpV2.x * aspect, y: tmpV2.y, ok: tmpV2.z < 1 }; }
  function viewToPx(p) { return { x: (p.x / aspect + 1) / 2 * W, y: (1 - p.y) / 2 * H }; }
  function worldPx(v) { const p = toView(v); return p.ok ? viewToPx(p) : null; }
  function rumble(s, ms, pat) { try { mc.rumble(s, ms, pat); } catch (e) { /* no rumble */ } }

  const POP_POS = { center: [0.5, 0.42], high: [0.5, 0.26], left: [0.3, 0.45], right: [0.7, 0.45], low: [0.5, 0.64] };
  const POP_H = { big: 54, mid: 38, bad: 38, dmg: 32, sub: 24 }, livePops = [];
  function popAt(text, cls, x, y) {
    const el = document.createElement('div');
    cls = cls || 'mid';
    el.className = 'pop ' + cls; el.textContent = text;
    const now = performance.now(), h = POP_H[cls.split(' ')[0]] || 38, w = text.length * h * 0.42;
    x = Math.max(w / 2 + 12, Math.min(innerWidth - w / 2 - 12, x));
    for (let i = livePops.length - 1; i >= 0; i--) if (now - livePops[i].t > 900) livePops.splice(i, 1);
    for (let n = 0; n < 4; n++) {
      const hit = livePops.find(o => Math.abs(o.x - x) < (o.w + w) / 2 && Math.abs(o.y - y) < (o.h + h) / 2);
      if (!hit) break;
      y = hit.y - (hit.h + h) / 2 - 2;
      if (y < 120) y = hit.y + (hit.h + h) / 2 + 2;   // never up into the HUD
    }
    livePops.push({ x, y, w, h, t: now });
    el.style.left = x + 'px'; el.style.top = y + 'px';
    $('popups').appendChild(el); setTimeout(() => el.remove(), 1150);
  }
  function pop(text, cls, at) {
    if (cls === 'big' || cls === 'bad') S.lastBigPop = S.realT;
    if (at && at.isVector3) { const p = worldPx(at); if (p) { popAt(text, cls, p.x, p.y); return; } at = 'center'; }
    const p = POP_POS[at || 'center']; popAt(text, cls, p[0] * W, p[1] * H);
  }
  function popOnce(key, gap, text, cls, at) {
    if (S.realT - (S.lastPop[key] || -99) < gap) return;
    S.lastPop[key] = S.realT; pop(text, cls, at);
  }

  /* ------------------------------------------------- controller wording */
  const WORDS = {
    wand: { a: 'A', b: 'B', center: 'Center', pause: '+ / Home', name: 'Wand' },
    grip: { a: 'Vol Down', b: 'Vol Up', center: 'hold Vol Up', pause: 'blade at the floor + hold Vol Down', name: 'Grip' },
    gripWeb: { a: 'HOLD', b: 'B', center: 'CENTRE', pause: 'blade at the floor + hold HOLD', name: 'Grip' },
    mouse: { a: 'left mouse', b: 'right mouse', center: 'C', pause: 'Esc', name: 'mouse' },
  };
  function ctlMode(c) { c = c || mc; return c.source !== 'phone' ? 'mouse' : (c.mode === 'grip' ? 'grip' : 'wand'); }
  function wordsFor(c) { c = c || mc; const m = ctlMode(c); return WORDS[m === 'grip' && c.via === 'browser' ? 'gripWeb' : m]; }
  function word(key, c) { c = c || mc; return key === 'center' && c.source === 'phone' && c.mode !== 'grip' ? c.keyName('center') : wordsFor(c)[key]; }
  function modeName(c) { return wordsFor(c).name; }
  let wordsMode = null;
  function applyWords(force) {
    const m = ctlMode(), Wd = wordsFor(), wk = Wd === WORDS.gripWeb ? 'gripWeb' : m;
    if (wk === wordsMode && !force) return;
    wordsMode = wk;
    document.querySelectorAll('[data-w]').forEach(el => { el.textContent = Wd[el.dataset.w]; });
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
      : 'Hold it like a sword, point at the screen, <kbd>' + Wd.center + '</kbd>.';
  }
  let hintTimer = 0;
  function hint(text, secs) { $('hint').innerHTML = text || ''; hintTimer = secs || 0; }

  /* ------------------------------------------------------------ bouts */
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  function boutLabel(i) { return C.LADDER[i].title.toUpperCase(); }
  function newRun(mode) {
    S.mode = mode; S.boutIdx = 0; S.hp = S.maxHp; S.fame = 0; S.won = 0; S.wounds = C.woundState();
    S.total = freshStats();
    if (fx) fx.clearDecals();
    startBout(0);
  }
  function startBout(i) {
    S.boutIdx = i; S.stats = freshStats();
    const L = C.LADDER[i];
    if (S.mode === 'practice') S.queue = [S.practiceFoe === 'dummy' ? Object.assign({}, C.DUMMY) : Object.assign({}, L.foes[0], { hp: Infinity })];
    else S.queue = L.foes.slice();
    clearFoe();
    spawnNext(true);
    showCard('intro');
  }
  function clearFoe() {
    for (const x of [S.fighter, S.mate && S.mate.fighter, S.corpse]) if (x) { x.remove(); scene.remove(x.root); }
    S.fighter = null; S.brain = null; S.foe = null; S.mate = null; S.corpse = null; S.hisPrev = null; S.capsPrev = null; S.daggerPrev = null; S.shieldPrev = null;
  }
  function spawnNext(first) {
    const p = S.queue.shift();
    const f = p.model === 'dummy' ? new LudusFighters.Dummy(p) : new LudusFighters.Fighter(p, assets.models[p.model], assets);
    scene.add(f.root);
    S.fighter = f; S.foe = { p, hp: p.hp, maxHp: p.hp };
    S.brain = C.createBrain(p, (Math.random() * 1e9) | 0);
    if (p.model === 'dummy') S.brain.dist = p.range.idle;
    f.root.position.set(first ? 0 : 1.5, 0, PLAYER.z - S.brain.dist);
    f.setWalking(p.model !== 'dummy');
    if (p.pack && S.queue.length && S.queue[0].pack) {
      const q = S.queue.shift();
      const g = new LudusFighters.Fighter(q, assets.models[q.model], assets);
      g.root.position.set(2.4, 0, PLAYER.z - q.range.idle - 6); scene.add(g.root); g.setWalking(true);
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
    $('card-stats').innerHTML = ''; $('ladder').innerHTML = '';
    const practice = S.mode === 'practice';
    if (kind === 'intro') {
      $('card-kicker').textContent = practice ? 'PRACTICE' : (L.title === 'Final' ? 'THE FINAL BOUT' : L.title.toUpperCase() + ' OF VI');
      $('card-title').textContent = practice ? (S.practiceFoe === 'dummy' ? 'THE TRAINING POST' : 'SPAR WITH CASSIA') : L.name.toUpperCase();
      $('card-text').innerHTML = practice
        ? (S.practiceFoe === 'dummy'
          ? 'A straw palus on a spring arm. Cut it anywhere and read the strike: where, edge or flat, how fast. Every few seconds its rudis swings back: meet it with your blade.'
          : 'Cassia won\'t fall and you can\'t die. Watch her hand draw back, meet her cut, then cut where her blade is not.')
        : L.intro + '<br><span class="lesson">' + L.lesson + '</span>';
      $('card-menu').innerHTML = practice
        ? `<button class="mi primary" data-act="fight">BEGIN</button><button class="mi" data-act="swap-practice">${S.practiceFoe === 'dummy' ? 'SPAR INSTEAD' : 'TRAINING POST'}</button>`
        : '<button class="mi primary" data-act="fight">FIGHT</button>';
      renderLadder();
    } else if (kind === 'between') {
      const st = S.stats;
      $('card-kicker').textContent = 'THE CROWD ROARS';
      $('card-title').textContent = 'VICTORY';
      const heal = Math.round((S.maxHp - S.hp) * 0.5);
      S.hp += heal;
      // wounds close up between bouts: half of each
      for (const k of ['swordArm', 'offArm', 'legs', 'head', 'torso']) S.wounds[k] = Math.floor((S.wounds[k] || 0) / 2);
      S.wounds.armLevel = Math.min(3, Math.floor(S.wounds.swordArm / 12)); S.wounds.legLevel = Math.min(3, Math.floor(S.wounds.legs / 12));
      $('card-text').textContent = `${L.name} falls. The crowd roars your name. ` + (heal > 0 ? `You bind your wounds (+${heal} health).` : 'Not a scratch on you.');
      $('card-stats').innerHTML = statsHtml(st);
      $('card-menu').innerHTML = '<button class="mi primary" data-act="next">NEXT BOUT</button>';
      renderLadder(true);
    }
    $('card-hint').innerHTML = `Hold the phone like a sword hilt, point at him, <kbd>${word('center')}</kbd> to line up. Then <kbd>${word('a')}</kbd>.`;
    $('card').classList.remove('hidden');
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
    const cells = [['HITS', st.hits], ['PARRIES', st.parries], ['BEST HIT', st.bestHit], ['FASTEST', st.bestSpeed + ' m/s'], ['DAMAGE TAKEN', st.taken], ['FAME', st.fame]];
    return cells.map(c => `<div><b>${c[1]}</b><span>${c[0]}</span></div>`).join('');
  }
  function hideCard() { $('card').classList.add('hidden'); }
  function beginFight() {
    hideCard();
    S.state = 'fight';
    S.fighter.setWalking(false);
    pop(S.mode === 'practice' ? 'TRAIN' : 'FIGHT!', 'big');
    Sfx.play('cheer', { vol: 0.7 }); S.excite = 0.8;
    rec('bout', { idx: S.boutIdx, mode: S.mode, foe: S.foe.p.id, roll: r2(HAND.edgeRoll * 180 / Math.PI), calibrated: HAND.calibrated });
    if (S.boutIdx === 0 && S.won === 0 && S.mode !== 'practice') hint('Watch her <b>sword hand draw back</b>: the blow comes from that side. Put your blade in its way, or beat into it to parry. Then cut where her blade is not.', 9);
    if (S.mode === 'practice' && S.practiceFoe === 'dummy') hint('Swing through the post. Faster = harder, edge first. <b>Push the phone forward</b> to lunge with the point.', 8);
  }
  function foeDown() {
    const f = S.fighter, p = S.foe.p;
    f.die(); C.brainKill(S.brain);
    rec('kill', { foe: p.id });
    if (S.mate && !S.mate.fighter.dead) {
      if (S.corpse) { S.corpse.remove(); scene.remove(S.corpse.root); }
      S.corpse = f;
      S.fighter = S.mate.fighter; S.brain = S.mate.brain; S.foe = S.mate.foe; S.mate = null; S.hisPrev = null; S.capsPrev = null;
      S.brain.timer = 1100; S.fighter.setWalking(true);
      $('foe-name').textContent = S.foe.p.name.toUpperCase(); updateHud(true);
      Sfx.play('beastHurt', { vol: 1 }); Sfx.play('cheer', { vol: 0.8, delay: 0.2 }); Sfx.play('wolf', { vol: 0.9, delay: 0.5 });
      S.excite = 1.2; slowMo(0.6, 0.35); rumble(1, 200, 2);
      addFame(C.FAME.kill); pop('ONE DOWN!', 'big', 'high');
      return;
    }
    Sfx.play(p.beast ? 'beastHurt' : p.model === 'troll' ? 'troll' : 'die', { vol: 1 });
    Sfx.play('cheer', { vol: 1, delay: 0.25 });
    S.excite = 1.3; slowMo(1.3, 0.25);
    rumble(1, 255, 2);
    addFame(C.FAME.kill);
    pop('VICTORY', 'big', 'high');
    S.state = 'down'; S.endT = 0;
  }
  function addFame(n) { S.fame = Math.max(0, S.fame + n); S.stats.fame += n; }
  function slowMo(secs, scale) { S.slowT = Math.max(S.slowT, secs); S.timeScale = Math.min(S.timeScale, scale); }
  function boutWon() {
    if (S.stats.taken === 0) { addFame(C.FAME.flawless); pop('FLAWLESS', 'big'); }
    S.won = S.boutIdx + 1;
    for (const k in S.stats) S.total[k] = k === 'bestHit' || k === 'bestSpeed' ? Math.max(S.total[k], S.stats[k]) : S.total[k] + S.stats[k];
    if (S.boutIdx + 1 >= C.LADDER.length) { showResults(true); return; }
    S.state = 'between';
    showCard('between');
  }
  function defeat() {
    S.state = 'defeat'; S.endT = 0;
    for (const k in S.stats) S.total[k] = k === 'bestHit' || k === 'bestSpeed' ? Math.max(S.total[k], S.stats[k]) : S.total[k] + S.stats[k];
    Sfx.play('die', { vol: 1, rate: 0.85 }); Sfx.play('shout', { vol: 0.8 });
    rumble(1, 255, 1);
    pop('YOU FALL', 'bad');
    slowMo(1.5, 0.35);
    rec('defeat', { bout: S.boutIdx });
  }
  function showResults(champion) {
    S.state = 'results';
    $('hud').classList.add('hidden');
    const rank = C.rankFor(S.fame, S.won);
    $('res-kicker').textContent = champion ? 'FREEDOM IS YOURS' : `FELL IN ${C.LADDER[S.boutIdx].title.toUpperCase()}`;
    $('res-title').textContent = rank.toUpperCase();
    $('res-fame').textContent = S.fame; $('res-fame-l').textContent = 'FAME'; $('res-again').textContent = 'FIGHT AGAIN';
    const t = S.total;
    $('res-stats').innerHTML = [['BOUTS WON', S.won + ' / 6'], ['HITS', t.hits], ['BEST HIT', t.bestHit], ['FASTEST CUT', t.bestSpeed + ' m/s'], ['PARRIES', t.parries], ['GUARDS BEATEN', t.beats], ['DISARMS', t.disarms], ['DAMAGE TAKEN', t.taken]]
      .map(c => `<div><b>${c[1]}</b><span>${c[0]}</span></div>`).join('');
    $('results').classList.remove('hidden');
    focusMenu($('res-menu'));
    if (champion) { Sfx.play('cheer', { vol: 1 }); Sfx.play('cheer', { vol: 0.8, delay: 1.5 }); S.excite = 1.4; }
  }

  /* -------------------------------------------------------------- combat */
  const ZONE_WORD = { head: 'HEAD', torso: 'BODY', swordArm: 'SWORD ARM', offArm: 'OFF ARM', legs: 'LEG' };
  const KIND_WORD = { edge: 'EDGE', flat: 'FLAT', thrust: 'THRUST', draw: 'DRAW CUT' };
  const AIM_ZONE = { head: 'head', torso: 'torso', arm: 'swordArm', legs: 'legs' };
  function zoneWord(zone) { return zone === 'offArm' && S.foe && S.foe.p.shield ? 'SHIELD ARM' : ZONE_WORD[zone] || zone; }
  /** Your blade on screen: the side it threatens, as he reads it. */
  function threatOf(H) {
    const b = H.blade; if (!b) return null;
    const sw = S.swing;
    if (sw.active && sw.peak > 8) return C.LINE_GUARD[sw.line];
    const eye = ME.head.getWorldPosition(tmpV);
    const tx = b.t.x - eye.x, ty = b.t.y - eye.y;
    const d = tmpV2.copy(b.t).sub(b.h).normalize();
    if (d.z < -0.8) return 'mid';
    if (ty > 0.3) return 'high';
    if (ty < -0.5) return 'low';
    return tx > 0 ? 'right' : 'left';
  }
  function onBrainEvent(e) {
    const f = S.fighter, p = S.foe.p;
    if (e.type === 'telegraph') {
      f.setAction('windup', e.attack);
      if (e.attack.heavy) Sfx.play(p.model === 'troll' ? 'troll' : p.beast ? 'wolf' : 'grunt', { vol: 0.9, rate: 0.8 });
      else if (p.beast && Math.random() < 0.5) Sfx.play('wolf', { vol: 0.5, rate: 1.2 });
      if (e.attack.kind === 'riposte') popOnce('riposte', 1, 'RIPOSTE', 'sub', 'high');
    } else if (e.type === 'feint') {
      f.setAction('windup', e.attack); f.modeT = 0;
      if (e.trap) { popOnce('trap', 2, 'FEINT - YOU BIT', 'bad', 'high'); rec('feint', { trap: true }); }
      else rec('feint', { trap: false });
    } else if (e.type === 'strike') {
      f.setAction('strike', e.attack);
      Sfx.play('swish', { vol: e.attack.heavy ? 1 : 0.7, rate: e.attack.heavy ? 0.7 : 1 });
      S.strikeDone = false;
    } else if (e.type === 'whiff') {
      rec('strike', { line: e.attack.line, aim: e.attack.aim, heavy: e.attack.heavy, result: 'whiff' });
      f.setAction('recover');
    } else if (e.type === 'recovered') {
      f.setAction('idle');
      if (S.mate && !S.mate.fighter.dead && Math.random() < 0.45) swapPack();
    } else if (e.type === 'rearm') {
      f.rearm(); popOnce('rearm', 2, 'HE DRAWS A SPARE', 'sub', 'high'); f.setAction('idle');
    } else if (e.type === 'rise') f.setAction('idle');
  }
  function brainStarted(a) { if (a) onBrainEvent({ type: 'telegraph', attack: a }); }

  /** His blade, shield and body this frame and last, for the sweeps. */
  function foeShapes() {
    const f = S.fighter;
    const w = f.weaponSeg(), d = f.daggerSeg(), s = f.shieldDisc(), caps = f.capsules();
    const cur = { w: w ? { h: w.h.clone(), t: w.t.clone(), r: w.r } : null, d, s, caps };
    const prev = S.hisPrev || cur;
    S.hisPrev = cur;
    return { cur, prev };
  }
  const segL = (A, B, f) => ({ h: A.h.clone().lerp(B.h, f), t: A.t.clone().lerp(B.t, f) });
  const capsL = (A, B, f) => B.map((c, i) => { const a = A[i] || c; return { zone: c.zone, a: a.a.clone().lerp(c.a, f), b: a.b.clone().lerp(c.b, f), r: c.r, bone: c.bone }; });

  /**
   * One frame of contact: your blade's steps against his blade, dagger, shield and body, and his
   * striking blade against your blade and body, in time order. dt: real seconds this frame.
   */
  function contacts(dt) {
    const f = S.fighter, b = S.brain, H = HAND;
    if (!f || f.dead || !H.blade) return;
    const { cur, prev } = foeShapes();
    const path = H.path, K = path.length - 1;
    const myCaps1 = bodyCapsules(H.R, ME, H.arm, H.ext), myCaps0 = S.myCapsPrev || myCaps1; S.myCapsPrev = myCaps1;
    const strikeLive = b.state === 'strike' && !S.strikeDone && cur.w && prev.w;
    const subDt = dt / Math.max(1, K);
    S.cdt = Math.round(dt * 1000); S.csteps = K;
    for (let k = 1; k <= K; k++) {
      const f0 = (k - 1) / K, f1 = k / K, A0 = path[k - 1], A1 = path[k];
      // his blow first: it is what you are defending against
      if (strikeLive && !S.strikeDone) {
        const W0 = segL(prev.w, cur.w, f0), W1 = segL(prev.w, cur.w, f1);
        const onBlade = C.sweepSegSeg(W0, W1, A0, A1, cur.w.r + 0.014);
        const onBody = C.sweepBody(W0, W1, capsL(myCaps0, myCaps1, f0), capsL(myCaps0, myCaps1, f1), cur.w.r);
        if (onBlade && (!onBody || onBlade.f <= onBody.f)) { hisBlowOnBlade(onBlade, W0, W1, A0, A1, subDt); }
        else if (onBody) { hisBlowOnBody(onBody, W0, W1, subDt); }
      }
      if (S.swingHit === S.swing.id && (S.swing.active || S.realT - S.hitT < 0.35)) continue;
      // your blade against his guard pieces and body
      let best = null;
      const consider = (h, what) => { if (h && (!best || h.f < best.h.f)) best = { h, what }; };
      if (cur.w && prev.w && b.state !== 'strike') consider(C.sweepSegSeg(A0, A1, segL(prev.w, cur.w, f0), segL(prev.w, cur.w, f1), cur.w.r + 0.014), 'blade');
      if (cur.d && S.daggerPrev) consider(C.sweepSegSeg(A0, A1, segL(S.daggerPrev, cur.d, f0), segL(S.daggerPrev, cur.d, f1), 0.026), 'dagger');
      if (cur.s && S.shieldPrev) consider(C.sweepDisc(A0, A1, S.shieldPrev, cur.s, 0.012), 'shield');
      consider(C.sweepBody(A0, A1, capsL(prev.caps, cur.caps, f0), capsL(prev.caps, cur.caps, f1), 0.012), 'body');
      if (best) {
        const vel = C.pointVel(A0, A1, best.h.u, subDt);
        const cls = C.classifyContact({ hilt: A1.h, tip: A1.t, vel, u: best.h.u, edge: H.mouse ? null : A1.edge });
        if (best.what === 'body') landBlow(best.h, cls, vel, A1);
        else guardContact(best.what, best.h, cls, vel, prev, cur, f0, f1);
        if (S.swingHit === S.swing.id && S.hitT === S.realT) break;
      }
    }
    S.daggerPrev = cur.d ? { h: cur.d.h.clone(), t: cur.d.t.clone() } : null;
    S.shieldPrev = cur.s ? { c: cur.s.c.clone(), n: cur.s.n.clone(), R: cur.s.R, th: cur.s.th } : null;
  }

  /** His blow met your blade. hit: from the sweep (u on his blade, w on yours). */
  function hisBlowOnBlade(hit, W0, W1, A0, A1, subDt) {
    const b = S.brain, f = S.fighter, p = S.foe.p, a = b.attack;
    S.strikeDone = true;
    const myV = C.pointVel(A0, A1, hit.w, subDt), hisV = C.pointVel(W0, W1, hit.u, Math.max(1e-3, subDt * S.timeScale));
    const hisDir = C.norm(hisV), into = -C.dot(myV, hisDir);
    const at = new T.Vector3(hit.point.x, hit.point.y, hit.point.z);
    if (p.weapon === 'jaws' || p.weapon === 'fist') {
      // a beast runs onto your blade: it is cut by how hard the two of you meet
      const rel = C.sub(myV, hisV);
      const cls = C.classifyContact({ hilt: A1.h, tip: A1.t, vel: rel, u: hit.w, edge: HAND.mouse ? null : A1.edge });
      const zone = p.weapon === 'jaws' ? 'head' : 'swordArm';
      const verdict = p.weapon === 'jaws' ? 'parry' : C.judgeBlock({ into, u: hit.w, heavy: true, offBalance: S.offT > 0 });
      applyCut(cls, zone, rel, at, f.capsules().find(c => c.zone === zone), true);
      if (S.state !== 'fight') return;
      if (verdict === 'parry' || (p.weapon === 'jaws')) { C.endStrike(b, 'parried'); f.setAction('stagger'); pop(p.weapon === 'jaws' ? 'IMPALED!' : 'CUT THE ARM!', 'big', 'high'); slowMo(0.35, 0.3); }
      else { C.endStrike(b, 'beaten'); beatenThrough(a, at, hisDir); }
      rec('strike', { line: a.line, aim: a.aim, heavy: a.heavy, result: 'blade', into: r2(into) });
      return;
    }
    const verdict = C.judgeBlock({ into, u: hit.w, heavy: a.heavy, offBalance: S.offT > 0 });
    rec('parry', { result: verdict, into: r2(into), u: r2(hit.w), heavy: a.heavy, line: a.line, off: S.offT > 0 });
    clashFx(at, verdict === 'parry' ? 1 : verdict === 'block' ? 0.6 : 0.8, hisDir);
    if (verdict === 'parry') {
      C.endStrike(b, 'parried'); f.setAction('stagger');
      S.stats.parries++; addFame(C.FAME.parry);
      Sfx.play('clash', { vol: 1 }); Sfx.ring(1, true); Sfx.play('shout', { vol: 0.55, delay: 0.1 });
      rumble(1, 150, 3); flashLight(at, 1.2);
      slowMo(0.45, 0.22); S.flash = 0.7; S.shake = 0.1;
      S.excite = Math.min(1.4, S.excite + 0.5);
      pop('PARRY!', 'big', 'high');
    } else if (verdict === 'block') {
      C.endStrike(b, 'blocked'); f.blockReact(0.6);
      S.stats.blocks++; addFame(C.FAME.block);
      Sfx.play('clash', { vol: 0.9 }); Sfx.ring(0.6, false);
      rumble(0.75, 70, 0); flashLight(at, 0.6);
      S.freezeT = 0.06; S.shake = 0.06; kick(-hisDir.x * 0.02, hisDir.y * 0.015);
      HAND.knock = 0.25; HAND.knockAxis.set(0, 0, 1).cross(new T.Vector3(hisDir.x, hisDir.y, hisDir.z)).normalize();
      popOnce('block', 0.6, a.heavy ? 'HELD - JUST' : 'BLOCKED', 'mid', 'high');
    } else {
      C.endStrike(b, 'beaten');
      beatenThrough(a, at, hisDir);
    }
  }
  /** A heavy blow drove through your guard: your blade is knocked aside and part of it lands. */
  function beatenThrough(a, at, hisDir) {
    Sfx.play('clash', { vol: 1, rate: 0.8 }); Sfx.ring(0.8, false); Sfx.thump(1);
    HAND.knock = 1; HAND.knockAxis.set(0, 0, 1).cross(new T.Vector3(hisDir.x, hisDir.y, hisDir.z)).normalize();
    if (HAND.knockAxis.lengthSq() < 1e-6) HAND.knockAxis.set(1, 0, 0);
    const zone = AIM_ZONE[a.aim] || 'torso';
    pop(a.heavy ? 'BEATEN THROUGH' : 'GUARD BEATEN', 'bad', 'high');
    popOnce('beaten', 3, a.heavy ? 'meet a heavy blow near your hilt, moving into it' : 'your blade was going the wrong way', 'sub', 'center');
    hurt(Math.round(a.damage * C.PARRY.beatenShare), zone, a);
  }
  /** His blow landed on you. */
  function hisBlowOnBody(hit, W0, W1, subDt) {
    const b = S.brain, a = b.attack, p = S.foe.p;
    S.strikeDone = true;
    C.endStrike(b, 'hit');
    const zone = hit.zone;
    const mul = { head: 1.5, torso: 1, swordArm: 0.6, offArm: 0.5, legs: 0.7 }[zone] || 1;
    rec('strike', { line: a.line, aim: a.aim, heavy: a.heavy, result: 'hit', zone });
    hurt(Math.max(1, Math.round(a.damage * mul)), zone, a);
    if (p.beast) Sfx.play(p.model === 'wolf' ? 'wolf' : 'troll', { vol: 0.7 });
  }
  function hurt(dmg, zone, a) {
    if (S.mode === 'practice') dmg = 0;
    S.hp = Math.max(0, S.hp - dmg); S.stats.taken += dmg; addFame(C.FAME.taken * dmg);
    const fxw = C.applyWound(S.wounds, zone, dmg, {});
    HAND.lungeMul = C.woundMods(S.wounds).lunge;
    S.vignette = 1; S.shake = 0.2;
    const sx = a && C.TRAVEL[a.line] ? C.TRAVEL[a.line].x : (Math.random() - 0.5);
    kick(-0.07 * sx, zone === 'head' ? -0.07 : zone === 'legs' ? 0.05 : 0.03);
    Sfx.play('flesh', { vol: 1 }); Sfx.play('grunt', { vol: 0.9, rate: 0.75 }); Sfx.thump(0.8);
    // where it lands is what you feel: a head blow rings and dazes, a leg drags, the sword arm stings
    if (zone === 'head') { rumble(1, 255, 1); S.daze = Math.max(S.daze, fxw.daze ? 1.6 : 0.6); Sfx.ring(0.5, false); }
    else if (zone === 'swordArm') { rumble(1, 120, 3); }
    else if (zone === 'legs') { rumble(0.9, 200, 2); }
    else rumble(1, 200, 0);
    S.excite = Math.min(1.3, S.excite + 0.25);
    rec('hurt', { zone, dmg, hp: S.hp });
    if (dmg > 0) pop('-' + dmg + '  ' + ZONE_WORD[zone], 'bad', a && C.TRAVEL[a.line] ? (C.TRAVEL[a.line].x > 0 ? 'left' : 'right') : 'center');
    else if (S.mode === 'practice') pop('HIT: ' + ZONE_WORD[zone], 'bad', 'center');
    if (fxw.limp) popOnce('limp', 3, 'YOUR LEG: SHORTER LUNGE', 'sub', 'low');
    if (zone === 'swordArm' && dmg >= 8) popOnce('armw', 3, 'SWORD ARM CUT: WEAKER CUTS', 'sub', 'low');
    if (S.hp <= 0 && S.mode !== 'practice') defeat();
  }

  /** Your blade landed on his body. */
  function landBlow(hit, cls, vel, A1) {
    const at = new T.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const cap = S.hisPrev.caps[hit.part];
    applyCut(cls, hit.zone, vel, at, cap, false);
  }
  /** A cut or thrust of yours on his body (also a beast running onto your point). */
  function applyCut(cls, zone, vel, at, cap, runOn) {
    const b = S.brain, f = S.fighter, p = S.foe.p;
    const armor = (p.armor || {})[zone] || 0;
    const res = C.strikeDamage({ kind: cls.kind, speed: cls.speed, axial: cls.axial, edge01: cls.edge01, zone, armor,
      state: b.state === 'recover' ? 'idle' : b.state, mul: C.woundMods(S.wounds).cut });
    const speed = Math.round(cls.kind === 'thrust' ? cls.axial : cls.speed);
    if (res.result === 'touch') { if (S.realT - (S.lastTouch || 0) > 0.4) { S.lastTouch = S.realT; Sfx.play('blade', { vol: 0.15, rate: 1.4 }); rumble(0.2, 20, 0); } return; }
    S.swingHit = S.swing.id; S.hitT = S.realT; S.swing.contact = 'body';
    const motion = new T.Vector3(vel.x, vel.y, vel.z).normalize();
    S.last = { zone, kind: cls.kind, speed, dmg: res.damage, result: res.result, t: S.realT, edge: Math.round(cls.edge01 * 100) };
    showReadout();
    rec('hit', { zone, kind: cls.kind, speed: r2(cls.speed), axial: r2(cls.axial), edge: r2(cls.edge01), dmg: res.damage, result: res.result, state: b.state, runOn: !!runOn, fdt: S.cdt, steps: S.csteps });
    f.knock(vel, Math.min(1, cls.speed / 20));
    if (res.result === 'armor') {
      Sfx.play('clash', { vol: 0.6, rate: 1.3 }); Sfx.ring(0.35, false);
      fx.clash(at, 0.35, motion.clone().negate()); rumble(0.55, 40, 0);
      f.addWound(at, motion, cap && cap.bone, true, 0.6);
      b.balance -= 6 + 10 * res.power; if (res.stagger) { C.stagger(b, p.staggerMs * 0.5); f.setAction('stagger'); }
      popOnce('armor', 1, 'TURNED BY ARMOUR', 'sub', at);
      S.freezeT = 0.03;
      return;
    }
    S.foe.hp -= res.damage;
    S.stats.hits++; S.stats.bestHit = Math.max(S.stats.bestHit, res.damage); S.stats.bestSpeed = Math.max(S.stats.bestSpeed, speed);
    addFame(C.FAME.hit(res.damage));
    const wfx = C.brainHit(b, res, zone);
    if (res.counter) { S.stats.counters++; addFame(C.FAME.counter); }
    if (b.state === 'stagger') f.setAction('stagger');
    f.hitReact(motion.x > 0 ? 'right' : 'left', res.stagger);
    f.addWound(at, motion, cap && cap.bone, p.model === 'dummy' || p.model === 'skeleton', res.power);
    // straw from the post, bone from the dead, blood from the rest
    if (p.model === 'dummy') fx.chips(at, Math.min(1, res.power), motion, { r: 0.85, g: 0.7, b: 0.38 });
    else if (p.model === 'skeleton') fx.chips(at, Math.min(1, res.power), motion, { r: 0.85, g: 0.82, b: 0.74 });
    else if (cls.kind !== 'flat') fx.bleed(at, Math.min(1, res.power), motion);
    else fx.clash(at, 0.2, null);
    Sfx.play(cls.kind === 'flat' ? 'shield' : 'flesh', { vol: 0.6 + 0.4 * Math.min(1, res.power) }); Sfx.play('blade', { vol: 0.4 });
    if (p.model !== 'dummy') Sfx.play(p.beast ? (p.model === 'troll' ? 'troll' : 'beastHurt') : p.model === 'skeleton' ? 'monster' : 'grunt', { vol: 0.8, delay: 0.05 });
    else Sfx.play('shield', { vol: 0.7, rate: 0.8 });
    Sfx.thump(0.4 + 0.5 * Math.min(1, res.power));
    rumble(0.4 + 0.5 * Math.min(1, res.power), 40 + 50 * Math.min(1, res.power), 0);
    S.freezeT = 0.035 + 0.08 * Math.min(1, res.power);     // hit-stop: the blade bites
    S.excite = Math.min(1.4, S.excite + 0.1 + 0.2 * res.power);
    const big = res.damage >= 30 || (zone === 'head' && res.damage >= 20);
    if (big) { Sfx.play('shout', { vol: 0.6, delay: 0.12 }); slowMo(0.35, 0.35); }
    pop(String(res.damage), 'dmg', at);
    if (res.counter) pop('COUNTER!', 'big', 'high');
    else if (wfx.disarm) { pop('DISARMED!', 'big', 'high'); f.dropWeapon(); S.stats.disarms++; addFame(C.FAME.disarm); slowMo(0.6, 0.3); Sfx.ring(1, true); }
    else if (wfx.shieldDrop) { pop('SHIELD DROPPED!', 'big', 'high'); f.dropShield(); addFame(250); slowMo(0.5, 0.3); }
    else if (wfx.kneel) { pop('DOWN ON ONE KNEE!', 'big', 'high'); f.setAction('kneel'); addFame(C.FAME.kneel); slowMo(0.5, 0.3); }
    else if (big) pop(zone === 'head' ? 'HEAD!' : 'DEEP CUT!', 'mid', 'high');
    if (wfx.limp) { f.limp = b.wounds.legLevel; popOnce('limp', 2.5, 'HE LIMPS', 'sub', 'high'); }
    if (zone === 'swordArm' && b.wounds.armLevel > 0) popOnce('armlv', 2.5, 'HIS SWORD ARM WEAKENS', 'sub', 'high');
    if (cls.kind === 'flat' && !runOn && res.damage >= 4) popOnce('flat', 8, 'FLAT OF THE BLADE: TURN THE EDGE INTO IT', 'sub', 'low');
    if (S.foe.hp <= 0) foeDown();
  }
  /** Your blade met his blade, dagger or shield. */
  function guardContact(what, hit, cls, vel, prev, cur, f0, f1) {
    const b = S.brain, f = S.fighter, p = S.foe.p;
    S.swingHit = S.swing.id; S.hitT = S.realT; S.swing.contact = what;
    const at = new T.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const speed = cls.speed;
    if (speed < 2.5) { if (S.realT - (S.lastTouch || 0) > 0.5) { S.lastTouch = S.realT; Sfx.play('blade', { vol: 0.2, rate: 0.7 }); rumble(0.25, 25, 0); fx.clash(at, 0.1, null); } S.swingHit = -1; S.swing.contact = null; return; }
    const his = b.state === 'windup' ? 'windup' : C.brainParrying(b) ? 'parrying' : 'guard';
    const armMul = 1 - 0.15 * b.wounds.armLevel;
    const strength = (what === 'shield' ? p.shieldStrength || 20 : what === 'dagger' ? p.daggerStrength || 10 : p.guardStrength || 10) * (b.state === 'stagger' || b.state === 'recover' ? 0.5 : 1) * armMul;
    const verdict = C.judgeCut({ speed, his, strength, into: his === 'parrying' ? 4 : 0 });
    const motion = new T.Vector3(vel.x, vel.y, vel.z).normalize();
    rec('clash', { on: what, verdict, speed: r2(speed), his, strength: r2(strength), fdt: S.cdt, steps: S.csteps });
    S.last = { zone: what === 'shield' ? 'SHIELD' : what === 'dagger' ? 'DAGGER' : 'BLADE', kind: verdict, speed: Math.round(speed), dmg: 0, result: verdict, t: S.realT };
    showReadout();
    clashFx(at, verdict === 'beat' ? 1 : 0.6, motion.clone().negate(), what === 'shield');
    if (verdict === 'beat') {
      C.brainBeaten(b); f.setAction('stagger'); if (what === 'blade') f.blockReact(1);
      S.stats.beats++; addFame(C.FAME.beat);
      Sfx.ring(1, true); rumble(1, 140, 3); S.freezeT = 0.08; S.flash = 0.35;
      S.excite = Math.min(1.4, S.excite + 0.4); Sfx.play('shout', { vol: 0.5, delay: 0.08 });
      pop(what === 'shield' ? 'SHIELD BATTERED ASIDE!' : his === 'windup' ? 'BEAT HIS BLOW!' : 'GUARD BEATEN!', 'big', 'high');
    } else if (verdict === 'parried') {
      HAND.knock = 1; HAND.knockAxis.set(0, 0, 1).cross(motion).normalize(); if (HAND.knockAxis.lengthSq() < 1e-6) HAND.knockAxis.set(1, 0, 0);
      S.openT = 0.45; kick(0.025 * Math.sign(motion.x || 1), 0.012);
      Sfx.ring(1, true); rumble(1, 120, 1);
      pop('PARRIED!', 'bad', 'high'); popOnce('parriedwhy', 2, speed < strength ? 'too soft: cut harder or go round' : 'he met it', 'sub', 'center');
      brainStarted(C.brainParriedYou(b));
    } else {
      Sfx.ring(0.6, false); rumble(0.7, 60, 0); S.freezeT = 0.05;
      f.blockReact(0.5);
      const r = C.brainBlocked(b, C.cutPower(speed));
      if (r === 'broken') { pop('BALANCE BROKEN!', 'big', 'high'); f.setAction('stagger'); addFame(150); }
      else {
        popOnce('blocked', 0.8, what === 'shield' ? 'ON THE SHIELD' : what === 'dagger' ? 'ON THE DAGGER' : 'ON HIS BLADE', 'sub', at);
        if (r) brainStarted(r);
      }
      if (b.read && b.state === 'idle') popOnce('read', 3, 'HE READS YOUR ' + (b.read.replace(/([A-Z])/g, ' $1').toUpperCase()) + ' CUTS', 'sub', 'low');
    }
  }
  function clashFx(at, s, dir, wood) {
    fx.clash(at, s, dir ? new T.Vector3(dir.x, dir.y, dir.z) : null); flashLight(at, s);
    Sfx.play(wood ? 'shield' : 'clash', { vol: 0.6 + 0.4 * s });
  }
  function kick(x, y) { S.kickX += x; S.kickY += y; }
  function flashLight(p, s) { clashLight.position.copy(p); clashLight.intensity = 6 * s; }

  /** Swing bookkeeping: logs every swing, and a full swing that met nothing carries you off balance. */
  function swingFrame(dt) {
    const H = HAND, b = S.brain, f = S.fighter, sw = S.swing;
    const view = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, -1) };
    const ev = C.swingStep(sw, { t: S.realT * 1000, vel: H.tipVel, ang: H.angSpeed, view });
    if (ev === 'start') S.swingSwished = false;
    // a swing he can see coming: fast enough to be meant
    if (sw.active && S.swingNoted !== sw.id && sw.peak > 10 && b && f && !f.dead && S.state === 'fight') {
      S.swingNoted = sw.id;
      C.brainSwing(b, { line: sw.line, big: true });
    }
    if (sw.active && !S.swingSwished && sw.peak > 9) { S.swingSwished = true; Sfx.play('swish', { vol: 0.3 + 0.5 * Math.min(1, sw.peak / 25), rate: 0.85 + 0.3 * Math.min(1, sw.peak / 25) }); }
    if (ev === 'end') {
      S.stats && S.stats.swings++;
      rec('swing', { id: sw.id, peak: r2(sw.peak), ang: r2(sw.peakAng), line: sw.line, ms: Math.round(sw.endT - sw.startT), contact: sw.contact || null, rev: sw.reversed });
      if (!sw.contact && sw.peak > C.SWING.big && S.state === 'fight' && f && !f.dead && b.dist < 2.3) {
        // a full swing at nothing: your weight follows it for a moment, and he sees it
        S.offT = Math.min(0.6, 0.3 + 0.012 * (sw.peak - C.SWING.big));
        S.swayV += Math.max(-1.2, Math.min(1.2, sw.dir.x * 0.9));
        S.stats.whiffs++;
        const side = threatOf(H);
        const notLine = side === 'left' ? 'left' : side === 'right' ? 'right' : side === 'high' ? 'high' : null;
        const a = C.brainOpening(b, notLine);
        if (a) { brainStarted(a); popOnce('whiff', 1.5, 'OVERCOMMITTED', 'bad', 'center'); }
        rec('whiff', { peak: r2(sw.peak), punished: !!a });
      }
    }
  }

  /** The Grey Pack: the second wolf prowls and trades places to pounce. */
  function swapPack() {
    const m = S.mate;
    const cur = { fighter: S.fighter, brain: S.brain, foe: S.foe };
    S.fighter = m.fighter; S.brain = m.brain; S.foe = m.foe; S.hisPrev = null; S.capsPrev = null;
    S.mate = cur;
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
  const LEVEL = n => n >= 3 ? 'w3' : n >= 2 ? 'w2' : n >= 1 ? 'w1' : '';
  function dollClass(el, zone, lv) { const k = el.id + zone; if (hudCache[k] !== lv) { hudCache[k] = lv; const z = el.querySelector('.z-' + zone); if (z) z.setAttribute('class', 'z-' + zone + ' ' + lv); } }
  function paintDoll(el, w, extra) {
    dollClass(el, 'head', LEVEL(Math.floor((w.head || 0) / 12)));
    dollClass(el, 'torso', LEVEL(Math.floor((w.torso || 0) / 20)));
    dollClass(el, 'arm', LEVEL(w.armLevel) + (extra && extra.disarmed ? ' gone' : ''));
    dollClass(el, 'off', LEVEL(Math.floor((w.offArm || 0) / 9)) + (extra && extra.noShield ? ' gone' : ''));
    dollClass(el, 'legs', LEVEL(w.legLevel) + (extra && extra.kneel ? ' gone' : ''));
  }
  function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    setW('#me .hp i', S.hp / S.maxHp); setW('#me .hp b', S.hp / S.maxHp);
    const hn = Math.ceil(S.hp); if (hudCache.hpn !== hn) { hudCache.hpn = hn; $('me-hp').textContent = hn; }
    paintDoll($('me-doll'), S.wounds);
    if (S.foe && S.brain) {
      const fr = isFinite(S.foe.maxHp) ? Math.max(0, S.foe.hp / S.foe.maxHp) : 1;
      setW('#foe .hp i', fr); setW('#foe .hp b', fr);
      setW('#foe .poise i', isFinite(S.brain.p.balance) && S.brain.p.balance < 1e8 ? Math.max(0, S.brain.balance / S.brain.p.balance) : 1);
      paintDoll($('foe-doll'), S.brain.wounds, { disarmed: !S.brain.armed, noShield: S.foe.p.shield && !S.brain.shield, kneel: S.brain.state === 'kneel' });
    }
    const t = S.mode === 'practice' ? 'PRACTICE' : boutLabel(S.boutIdx) + (C.LADDER[S.boutIdx].title === 'Final' ? '' : ' OF VI');
    if (hudCache.title !== t) { hudCache.title = t; $('bout-title').textContent = t; }
    if (hudCache.fame !== S.fame) { hudCache.fame = S.fame; $('fame').innerHTML = 'FAME <b>' + S.fame + '</b>'; }
    const prac = S.mode === 'practice' && S.stats;
    $('practice').classList.toggle('hidden', !prac);
    if (prac) {
      const key = S.stats.hits + '|' + S.stats.bestSpeed + '|' + S.stats.parries + '|' + S.stats.bestHit;
      if (hudCache.prac !== key) { hudCache.prac = key; $('pr-hits').textContent = S.stats.hits; $('pr-best').textContent = S.stats.bestSpeed; $('pr-dmg').textContent = S.stats.bestHit; $('pr-par').textContent = S.stats.parries; }
    }
  }
  let readoutT = 0;
  function showReadout() {
    const l = S.last; if (!l) return;
    const el = $('readout');
    const kind = KIND_WORD[l.kind] || l.kind.toUpperCase();
    const zone = l.zone === l.zone.toUpperCase() ? l.zone : zoneWord(l.zone);
    el.innerHTML = `<span class="k">${kind}</span><span>${zone}</span><span><b>${l.speed}</b> m/s</span>` + (l.dmg ? `<span class="d"><b>${l.dmg}</b> dmg</span>` : '');
    el.classList.remove('hidden'); el.classList.toggle('good', l.result === 'hit' || l.result === 'beat'); readoutT = S.mode === 'practice' ? 6 : 2.4;
  }

  /* --------------------------------------------------------- overlay */
  function drawOverlay() {
    og.clearRect(0, 0, W, H);
    if (S.yieldT > 0.25 && (S.state === 'fight' || S.state === 'intro')) { // Grip pause gesture in progress
      const f = Math.min(1, S.yieldT / 1.2);
      og.lineWidth = 6; og.strokeStyle = 'rgba(230,192,102,0.95)';
      og.beginPath(); og.arc(W / 2, H * 0.55, 34, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); og.stroke();
      og.font = '600 14px Segoe UI, sans-serif'; og.textAlign = 'center'; og.fillStyle = 'rgba(244,234,214,0.95)'; og.fillText('PAUSING...', W / 2, H * 0.55 + 58);
    }
    if (S.state !== 'fight' || !S.fighter || S.fighter.dead) return;
    const b = S.brain, f = S.fighter;
    // read assist (off by default): a faint trace of where his blow will travel
    if (prefs.assist && b.state === 'windup' && b.attack && b.attack.target) {
      const cfg = f.attackCfg(), a = b.attack;
      og.save(); og.setLineDash([3, 7]); og.lineWidth = 2; og.strokeStyle = a.heavy ? 'rgba(255,120,70,0.55)' : 'rgba(255,225,170,0.45)';
      og.beginPath(); let started = false;
      for (let i = 0; i <= 16; i++) {
        const pz = C.attackPose(a, 'strike', i / 16, cfg), seg = cfg.blade[1] * 0.85;
        const tip = new T.Vector3(pz.hilt.x + pz.dir.x * seg, pz.hilt.y + pz.dir.y * seg, pz.hilt.z + pz.dir.z * seg);
        f.root.localToWorld(tip);
        const px = worldPx(tip); if (!px) continue;
        if (!started) { og.moveTo(px.x, px.y); started = true; } else og.lineTo(px.x, px.y);
      }
      og.stroke(); og.restore();
    }
    if ((b.state === 'stagger' || b.state === 'disarmed' || b.state === 'kneel') && S.realT - (S.lastBigPop || -9) > 0.9) {
      const head = f.capsules().find(c => c.zone === 'head');
      const px = head && worldPx(head.b);
      if (px) {
        og.font = '700 18px Georgia, serif'; og.textAlign = 'center'; og.shadowColor = 'rgba(0,0,0,0.8)'; og.shadowBlur = 6;
        og.fillStyle = 'rgba(255,215,110,0.95)';
        og.fillText(b.state === 'disarmed' ? 'UNARMED!' : b.state === 'kneel' ? 'KNEELING!' : 'OPEN!', px.x, Math.max(120, px.y - 22));
        og.shadowBlur = 0;
      }
    }
  }

  /* ------------------------------------------------------------- menus */
  let menuEl = null, menuIdx = 0;
  let wandCursor = null, inMenuNow = false;
  function focusMenu(el) { menuEl = el; menuIdx = 0; markFocus(); }
  function markFocus() { if (!menuEl) return; [...menuEl.querySelectorAll('.mi')].forEach((b, i) => b.classList.toggle('focus', i === menuIdx)); }
  function menuNav(clicked) {
    if (!menuEl) return;
    const items = [...menuEl.querySelectorAll('.mi')];
    if (!items.length) return;
    if (mc.pressed('down') || mc.pressed('right')) { menuIdx = (menuIdx + 1) % items.length; markFocus(); }
    if (mc.pressed('up') || mc.pressed('left')) { menuIdx = (menuIdx + items.length - 1) % items.length; markFocus(); }
    if (mc.source === 'phone' && !clicked && mc.pressed('a')) act(items[menuIdx].dataset.act);
    if (mc.source === 'phone' && mc.pressed('b')) {
      const back = menuEl.querySelector('[data-act=resume]') || (S.state === 'results' ? menuEl.querySelector('[data-act=quit]') : null);
      if (back) act(back.dataset.act);
    }
  }
  function act(a) {
    Sfx.unlock();
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
      case 'swap-practice': S.practiceFoe = S.practiceFoe === 'dummy' ? 'spar' : 'dummy'; startBout(0); break;
      case 'hand': prefs.hand = S.hand === 'right' ? 'left' : 'right'; applyPrefs(); savePrefs(); break;
      case 'assist': prefs.assist = !prefs.assist; applyPrefs(); savePrefs(); break;
      case 'sound': {
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
  let keyLunge = false;
  function takeKeyLunge() { const k = keyLunge; keyLunge = false; return k; }
  addEventListener('keydown', e => {
    if ((e.key === 'f' || e.key === 'F') && !e.repeat) keyLunge = true;
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
  const camLook = new T.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.1, (now - last) / 1000); last = now;
    S.realT += realDt;
    if (realDt > 0) S.fps += (1 / realDt - S.fps) * 0.05;
    mc.update(now);
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

    // time: slow motion and hit-stop (your blade always moves in real time)
    if (S.slowT > 0) { S.slowT -= realDt; if (S.slowT <= 0) S.timeScale = 1; }
    let dt = realDt * S.timeScale;
    const frozen = S.freezeT > 0;
    if (frozen) { S.freezeT -= realDt; dt = 0; }
    if (S.state === 'paused') dt = 0;
    S.gameMs += dt * 1000;

    const fighting = S.state === 'fight';
    // body: the lunge carries you in; a missed full swing pulls you after it
    S.swayV += (-S.sway * 40 - S.swayV * 9) * realDt; S.sway += S.swayV * realDt;
    ME.body.position.set(PLAYER.x + S.sway * 0.06, 0, PLAYER.z - HAND.ext * (1 - ARM_EXT));
    ME.body.updateMatrixWorld(true);
    updateSwordHand(HAND, realDt, { fight: fighting, freeze: frozen, keyLunge: fighting && takeKeyLunge() });
    poseRig(R0, camera, HAND.q, HAND.arm, { ext: HAND.ext, edgeRoll: HAND.mouse ? 0 : HAND.edgeRoll, dt: realDt });

    const inMenu = ['title', 'between', 'results', 'paused'].includes(S.state) || (S.state === 'intro' && !$('card').classList.contains('hidden'));
    inMenuNow = inMenu;
    const clicked = wandCursor ? wandCursor.update() : false;
    if (inMenu) menuNav(clicked);
    if (S.state === 'fight' || S.state === 'intro') {
      if (mc.source === 'phone') S.hadPhone = true;
      else if (S.hadPhone) { S.hadPhone = false; pause('Your phone disconnected. Reconnect it (Mimic app, Bluetooth), then RESUME.'); }
      if (mc.source === 'phone' && mc.isDown('a') && mc.pitch < -1.15) { S.yieldT = (S.yieldT || 0) + realDt; if (S.yieldT > 1.2) pause(); }
      else S.yieldT = 0;
    }
    if (mc.pressed('center') && S.state !== 'title') pop('ALIGNED', 'sub', 'high');

    const f = S.fighter, b = S.brain;
    if ((S.state === 'intro' || S.state === 'fight') && f && !f.dead) {
      S.introT += dt;
      const want = PLAYER.z - (b ? b.dist : 2);
      // walk in from the gate during the intro; afterwards the brain's footwork sets the distance
      if (S.state === 'intro' && b) {
        const dz = want - f.root.position.z, dx = -f.root.position.x;
        const len = Math.hypot(dx, dz), sp = (f.p.footSpeed || 2.2) * 1.3;
        if (len > 0.02) { const k = Math.min(len, sp * dt) / len; f.root.position.x += dx * k; f.root.position.z += dz * k; }
        b.dist = PLAYER.z - f.root.position.z;
        f.setWalking(len > 0.25 && f.p.model !== 'dummy');
      } else {
        const dzw = want - f.root.position.z;
        f.root.position.z = want; f.root.position.x += (0 - f.root.position.x) * Math.min(1, dt * 4);
        f.setWalking(Math.abs(dzw) > dt * 0.6 && f.p.model !== 'dummy');
      }
    }
    if (S.mate && (S.state === 'intro' || S.state === 'fight')) {
      const m = S.mate.fighter, side = f && f.root.position.x > 0.5 ? -1 : 1;
      const tgt = new T.Vector3(side * (1.9 + 0.3 * Math.sin(S.realT * 0.8)), 0, PLAYER.z - m.p.range.idle - 1.2 + 0.5 * Math.sin(S.realT * 0.55));
      const d = tgt.sub(m.root.position); d.y = 0;
      const len = d.length();
      if (len > 0.03) m.root.position.addScaledVector(d.normalize(), Math.min(len, 2.6 * dt));
      m.setWalking(len > 0.15);
      m.root.rotation.y = Math.atan2(PLAYER.x - m.root.position.x, PLAYER.z - m.root.position.z);
      m.plan(S.mate.brain, null, dt); m.update(dt, S.mate.brain);
    }
    if (S.corpse) S.corpse.update(dt);
    if (S.state === 'fight' && b) {
      S.stats.time += dt;
      for (const e of C.brainStep(b, dt * 1000)) onBrainEvent(e);
      if (b.state === 'stagger' && f.mode !== 'stagger') f.setAction('stagger');
      if (b.state === 'kneel' && f.mode !== 'kneel') f.setAction('kneel');
      if ((b.state === 'idle' || b.state === 'disarmed') && (f.mode === 'stagger' || f.mode === 'recover' || f.mode === 'kneel') && f.modeT > 0.4) f.setAction('idle');
      if (b.state === 'recover' && f.mode === 'strike' && f.modeT > b.attack.strikeMs / 1000) f.setAction('recover');
      if (b.state === 'disarmed' && f.weapon && f.weapon.parent === f.root) f.dropWeapon();
      if (hintTimer > 0) { hintTimer -= realDt; if (hintTimer <= 0) hint(''); }
    }
    // fighter: face the player, plan the weapon, animate
    if (f) {
      f.root.rotation.y = Math.atan2(ME.body.position.x - f.root.position.x, ME.body.position.z - f.root.position.z);
      if (b) {
        const dist = ME.body.position.z - f.root.position.z;
        const hand = HAND.blade ? f.root.worldToLocal(bodyCapsules(R0, ME, HAND.arm || MM.armPose(MM.fromEuler(0, 0, 0), 'right'), HAND.ext)[3].b.clone()) : null;
        let target = null;
        if (b.attack) {
          target = C.aimPoint(b.attack.aim, dist);
          if (b.attack.aim === 'arm' && hand) target = C.v3(hand.x, hand.y, hand.z);
        }
        f.plan(b, target, dt);
      }
      f.update(dt, b);
    }
    if (S.state === 'fight' && f && !f.dead && b) {
      C.brainSee(b, { threat: threatOf(HAND) });
      swingFrame(realDt);
      contacts(realDt);
    } else if (S.state !== 'fight') S.hisPrev = null;
    if (S.state === 'down') {
      S.endT += realDt;
      if (S.endT > 2.4) {
        if (S.queue.length) { clearFoe(); spawnNext(false); S.state = 'intro'; setTimeout(() => { if (S.state === 'intro') beginFight(); }, 1800); }
        else boutWon();
      }
    }
    if (S.state === 'defeat') { S.endT += realDt; if (S.endT > 2.6) showResults(false); }
    S.offT = Math.max(0, S.offT - dt); S.openT = Math.max(0, S.openT - dt); S.daze = Math.max(0, S.daze - realDt);

    // camera: your eyes, a little forward with the lunge, jolted by blows
    const shake = S.shake > 0 ? S.shake : 0; S.shake = Math.max(0, S.shake - realDt * 0.8);
    const limp = S.wounds.legLevel > 0 && HAND.ext > 0.05 ? Math.sin(S.realT * 18) * 0.012 * S.wounds.legLevel : 0;
    camera.position.set(ME.body.position.x + (Math.random() - 0.5) * shake * 0.3, EYE + limp + (Math.random() - 0.5) * shake * 0.3, ME.body.position.z);
    if (S.state === 'title' || S.state === 'loading') {
      const a = S.realT * 0.05;
      camera.position.set(Math.sin(a) * 9, 3.2, Math.cos(a) * 9);
      camLook.set(0, 4.5, 0);
    } else {
      // look a little up at a giant, so his shoulders (his tells) stay in view
      const fh = f ? f.p.height : 1.8, ty = Math.max(1.0, Math.min(1.85, 0.5 * fh + 0.36));
      S.camY = S.camY === undefined ? ty : S.camY + (ty - S.camY) * Math.min(1, realDt * 3);
      camLook.set(ME.body.position.x * 0.5, S.camY, ME.body.position.z - 2.1);
    }
    camera.lookAt(camLook);
    camera.rotateZ(-S.sway * 0.05);
    if (Math.abs(S.kickX) + Math.abs(S.kickY) > 1e-4) { camera.rotateY(S.kickX); camera.rotateX(S.kickY); }
    const kd = Math.exp(-9 * realDt); S.kickX *= kd; S.kickY *= kd;
    rig.visible = !['title', 'loading', 'results'].includes(S.state);

    // effects
    S.vignette = Math.max(0, S.vignette - realDt * 1.6);
    $('vignette').style.opacity = Math.max(S.vignette, S.hp < 30 && S.state === 'fight' ? 0.35 + 0.1 * Math.sin(S.realT * 4) : 0, S.daze * 0.5);
    S.flash = Math.max(0, S.flash - realDt * 2.5); $('flash').style.opacity = S.flash;
    clashLight.intensity = Math.max(0, clashLight.intensity - realDt * 40);
    S.excite += (0.3 - S.excite) * Math.min(1, realDt * 0.35);
    Sfx.crowd(S.excite);
    fx.update(dt);
    LudusWorld.update(world, S.realT, Math.min(1, S.excite));
    if (readoutT > 0) { readoutT -= realDt; if (readoutT <= 0) $('readout').classList.add('hidden'); }

    if (S.state !== 'title') updateHud();
    renderer.render(scene, camera);
    drawOverlay();
  }

  /* ----------------------------------------------------------- versus */
  const core = {
    mc, scene, renderer, Sfx, $, assets, og, makeBody, makeRig, poseRig, bodyCapsules, makeSwordHand, updateSwordHand, popAt, word, modeName,
    takeKeyLunge, rec, EYE, fx: () => fx, world: () => world, flashLight,
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
