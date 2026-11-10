/*
 * Iron Ludus - opponents in the sand: model setup, animation, the weapon in their hand, the body
 * you can cut, wounds you can see. Classic script: defines window.LudusFighters.
 *
 * Every model faces +Z (toward the player). A Fighter is a Group at the opponent's feet:
 *   fighter.root  (position/heading)  ->  fighter.pose (lean/twist/lunge/kneel)  ->  model
 * The weapon is not animated by a clip: each frame it is put exactly where the brain's plan says
 * (guard, the wind-up drawn back to the side the blow comes from, the blow's arc from combat.js
 * attackPose), and the arm reaches for its grip by IK. What you see is what hits: collisions use
 * the same weapon segment and the same bone capsules.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat;

  // capsules from bones: a -> b (or a straight up by `up` for a head), `ext` stretches past b for an
  // end bone that has no child; radii are for a 1.85 m body and scale with height
  const HUMAN_PARTS = [
    { zone: 'head', a: 'Head', up: 0.2, r: 0.12 },
    { zone: 'torso', a: 'Hips', b: 'Neck', r: 0.17 },
    { zone: 'swordArm', a: 'UpperArmR', b: 'LowerArmR', r: 0.055 }, { zone: 'swordArm', a: 'LowerArmR', b: 'WristR', ext: 0.35, r: 0.05 },
    { zone: 'offArm', a: 'UpperArmL', b: 'LowerArmL', r: 0.055 }, { zone: 'offArm', a: 'LowerArmL', b: 'WristL', ext: 0.35, r: 0.05 },
    { zone: 'legs', a: 'UpperLegL', b: 'LowerLegL', r: 0.085 }, { zone: 'legs', a: 'LowerLegL', b: 'FootL', r: 0.065 },
    { zone: 'legs', a: 'UpperLegR', b: 'LowerLegR', r: 0.085 }, { zone: 'legs', a: 'LowerLegR', b: 'FootR', r: 0.065 },
  ];
  const RIGS = {
    dummy: { parts: [] },
    recruit:  { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      hand: 'WristR', palm: 'Middle1R', ik: ['UpperArmR', 'LowerArmR'], offIk: ['UpperArmL', 'LowerArmL'], offHand: 'WristL', shoulder: 'UpperArmR', hide: ['Sword_1', 'Sword_2', 'Sword_3', 'Sword'], parts: HUMAN_PARTS },
    champion: { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      hand: 'WristR', palm: 'Middle1R', ik: ['UpperArmR', 'LowerArmR'], offIk: ['UpperArmL', 'LowerArmL'], offHand: 'WristL', shoulder: 'UpperArmR', parts: HUMAN_PARTS },
    axeman:   { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      hand: 'WristR', palm: 'Middle1R', ik: ['UpperArmR', 'LowerArmR'], offIk: ['UpperArmL', 'LowerArmL'], offHand: 'WristL', shoulder: 'UpperArmR', hide: ['Backpack'], parts: HUMAN_PARTS },
    skeleton: { idle: 'Skeleton_Idle', attack: 'Skeleton_Attack', death: 'Skeleton_Death', walk: 'Skeleton_Running', raise: 0.35, strike: 0.6, walkRate: 0.6,
      hand: 'RDownLeg001', handExt: true, ik: ['RUpperLeg001', 'RDownLeg001'], offIk: ['LUpperLeg001', 'LDownLeg001'], offHand: 'LDownLeg001', offExt: true, shoulder: 'RUpperLeg001',
      parts: [{ zone: 'head', a: 'Head', up: 0.22, r: 0.12 }, { zone: 'torso', a: 'Hips', b: 'Neck', r: 0.15 },
        { zone: 'swordArm', a: 'RUpperLeg001', b: 'RDownLeg001', r: 0.05 }, { zone: 'swordArm', a: 'RDownLeg001', b: 'RUpperLeg001', ext: -1, r: 0.045 },
        { zone: 'offArm', a: 'LUpperLeg001', b: 'LDownLeg001', r: 0.05 }, { zone: 'offArm', a: 'LDownLeg001', b: 'LUpperLeg001', ext: -1, r: 0.045 },
        { zone: 'legs', a: 'LUpperLeg', b: 'LDownLeg', r: 0.07 }, { zone: 'legs', a: 'LDownLeg', b: 'LUpperLeg', ext: -1, r: 0.06 },
        { zone: 'legs', a: 'RUpperLeg', b: 'RDownLeg', r: 0.07 }, { zone: 'legs', a: 'RDownLeg', b: 'RUpperLeg', ext: -1, r: 0.06 }] },
    wolf:     { idle: 'Idle', attack: 'Attack', hit: 'Idle_HitReact_Left', hit2: 'Idle_HitReact_Right', death: 'Death', walk: 'Walk', raise: 0.3, strike: 0.5, jaws: 'Head',
      parts: [{ zone: 'head', a: 'Neck2', b: 'Head', ext: 0.6, r: 0.11 }, { zone: 'torso', a: 'Body', b: 'Neck1', r: 0.17 },
        { zone: 'legs', a: 'FrontUpperLegL', b: 'FrontLowerLegL', ext: 0.8, r: 0.05 }, { zone: 'legs', a: 'FrontUpperLegR', b: 'FrontLowerLegR', ext: 0.8, r: 0.05 },
        { zone: 'legs', a: 'BackUpperLegL', b: 'BackLowerLegL', ext: 0.8, r: 0.05 }, { zone: 'legs', a: 'BackUpperLegR', b: 'BackLowerLegR', ext: 0.8, r: 0.05 }] },
    troll:    { idle: 'Idle', attack: 'Attack', hit: 'HitRecieve', death: 'Death', walk: 'Walk', raise: 0.35, strike: 0.6, fist: 'ArmR', fistEnd: 'ArmR_end', shoulder: 'ArmR',
      parts: [{ zone: 'head', a: 'Head', b: 'Head_end', r: 0.2 }, { zone: 'torso', a: 'Body', b: 'Head', r: 0.36 },
        { zone: 'swordArm', a: 'ArmR', b: 'ArmR_end', r: 0.13 }, { zone: 'offArm', a: 'ArmL', b: 'ArmL_end', r: 0.13 },
        { zone: 'legs', a: 'LegL', b: 'LegL_end', r: 0.16 }, { zone: 'legs', a: 'LegR', b: 'LegR_end', r: 0.16 }] },
  };

  /*
   * Guards in the fighter's frame (metres for a 1.85 m fighter; x = your screen right, y up, z toward
   * you): where the grip is and where the blade points. GUARD[side] stands in the way of cuts coming
   * from that side of your screen ('mid' = point at you, 'none' = lowered).
   */
  const P = (hx, hy, hz, dx, dy, dz) => ({ hand: new T.Vector3(hx, hy, hz), dir: new T.Vector3(dx, dy, dz).normalize() });
  const GUARD = {
    left: P(-0.32, 1.02, 0.4, -0.12, 1, 0.22), right: P(0.2, 1.02, 0.42, 0.14, 1, 0.22),
    high: P(-0.34, 1.7, 0.32, 1, 0.16, 0.12), low: P(-0.24, 0.9, 0.42, 0.5, -0.82, 0.25),
    mid: P(-0.12, 1.05, 0.4, 0.12, 0.85, 0.5), none: P(-0.3, 0.92, 0.25, -0.15, -0.55, 0.65),
    flung: P(-0.5, 1.45, 0.05, -0.75, 0.6, -0.3),
  };
  // the shield (on his left arm: your right) and the dagger stand in for the lines the sword is not covering
  const SHIELD_POSE = { rest: [0.24, 1.12, 0.42, 0.3, 0, 1], high: [0.12, 1.5, 0.42, 0.15, 0.55, 1], low: [0.16, 0.78, 0.44, 0.15, -0.35, 1],
    mid: [0.06, 1.15, 0.47, 0.05, 0, 1], left: [-0.05, 1.15, 0.47, -0.25, 0, 1] };
  const DAGGER_POSE = { rest: P(0.22, 1.08, 0.36, -0.35, 0.8, 0.45), left: P(-0.02, 1.1, 0.42, -0.25, 0.9, 0.35), mid: P(0.06, 1.1, 0.45, -0.1, 0.4, 0.9),
    high: P(0.16, 1.5, 0.36, -0.9, 0.25, 0.2), low: P(0.2, 0.9, 0.42, -0.4, -0.75, 0.35) };

  const UPV = new T.Vector3(0, 1, 0), _dw = new T.Vector3();
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion(), _m = new T.Matrix4();
  /** Cyclic-coordinate-descent IK in world space: rotate each joint so the effector heads for the target. */
  function ccd(chain, effector, target, iters) {
    for (let it = 0; it < iters; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const bone = chain[i];
        bone.getWorldPosition(_a); effector.getWorldPosition(_b);
        _b.sub(_a); _c.copy(target).sub(_a);
        if (_b.lengthSq() < 1e-8 || _c.lengthSq() < 1e-8) continue;
        _q.setFromUnitVectors(_b.normalize(), _c.normalize());
        bone.parent.getWorldQuaternion(_q2);
        _q3.copy(_q2).invert().multiply(_q).multiply(_q2);
        bone.quaternion.premultiply(_q3);
        bone.updateMatrixWorld(true);
      }
    }
  }
  /** Orientation whose +Y is `dir` and whose +X leans toward `side` (the blade's edge leads that way). */
  function basisQ(out, dir, side) {
    const y = _a.copy(dir).normalize();
    const x = _b.copy(side).addScaledVector(y, -side.dot(y));
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0).addScaledVector(y, -y.x);
    x.normalize();
    const z = _c.crossVectors(x, y);
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
  }

  function findClip(clips, name) {
    if (!name) return null;
    return clips.find(c => c.name === name) || clips.find(c => c.name.split('|').pop() === name) || null;
  }
  const mat = (color, rough, metal, extra) => { const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal || 0 }, extra || {})); m.color.convertSRGBToLinear(); return m; };

  /** A steel sword (or a wooden rudis): blade along +Y, grip at the origin; the blade is wide in X. */
  function makeSword(len, wood) {
    const g = new T.Group();
    const steel = wood ? mat(0x8a6038, 0.75) : new T.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 1, roughness: 0.28 });
    const sh = new T.Shape(), w = wood ? 0.03 : 0.026;
    sh.moveTo(-w, 0); sh.lineTo(-w * 0.85, len - 0.1); sh.lineTo(0, len); sh.lineTo(w * 0.85, len - 0.1); sh.lineTo(w, 0); sh.lineTo(-w, 0);
    const bg = new T.ExtrudeGeometry(sh, { depth: wood ? 0.012 : 0.004, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 });
    bg.translate(0, 0.1, -0.003);
    g.add(new T.Mesh(bg, steel));
    const brass = wood ? mat(0x5a3a1e, 0.8) : new T.MeshStandardMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.35 });
    const guard = new T.Mesh(new T.BoxGeometry(0.19, 0.028, 0.035), brass); guard.position.y = 0.1; g.add(guard);
    const grip = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.16, 8), mat(0x3a2416, 0.8)); g.add(grip);
    const pommel = new T.Mesh(new T.SphereGeometry(0.026, 10, 8), brass); pommel.position.y = -0.09; g.add(pommel);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  /** A long-hafted axe. Haft along +Y, grip at the origin, double head at the top. */
  function makeAxe(len) {
    const g = new T.Group();
    const wood = new T.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.8 });
    const iron = new T.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.38 });
    const haft = new T.Mesh(new T.CylinderGeometry(0.022, 0.026, len, 8), wood); haft.position.y = len / 2 - 0.12; g.add(haft);
    const sh = new T.Shape();
    sh.moveTo(0, -0.05); sh.lineTo(0.05, -0.06); sh.quadraticCurveTo(0.2, -0.16, 0.24, -0.2); sh.quadraticCurveTo(0.17, 0, 0.24, 0.2);
    sh.quadraticCurveTo(0.2, 0.16, 0.05, 0.06); sh.lineTo(0, 0.05); sh.lineTo(0, -0.05);
    const hg = new T.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    hg.translate(0, 0, -0.01);
    for (const sx of [1, -1]) { const head = new T.Mesh(hg, iron); head.scale.x = sx; head.position.y = len - 0.22; g.add(head); }
    const cap = new T.Mesh(new T.BoxGeometry(0.06, 0.14, 0.05), iron); cap.position.y = len - 0.22; g.add(cap);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /** A troll's club: a knotted log with iron studs. Along +Y, grip at the origin. */
  function makeClub(len) {
    const g = new T.Group();
    const wood = mat(0x5b3a1f, 0.85), iron = mat(0x4d4a46, 0.45, 0.85), wrap = mat(0x2e1d10, 0.9);
    const log = new T.Mesh(new T.CylinderGeometry(0.1, 0.05, len, 9), wood); log.position.y = len / 2; g.add(log);
    const knot = new T.Mesh(new T.SphereGeometry(0.11, 9, 7), wood); knot.position.y = len; knot.scale.set(1, 0.7, 1); g.add(knot);
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4, y = len * (0.62 + 0.035 * i), r = 0.05 + 0.05 * (y / len);
      const st = new T.Mesh(new T.ConeGeometry(0.018, 0.06, 6), iron);
      st.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(st);
      st.lookAt(st.position.x * 3, y, st.position.z * 3); st.rotateX(Math.PI / 2);   // the cone's point outward
    }
    const grip = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.22, 8), wrap); grip.position.y = 0.08; g.add(grip);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /* --------------------------------------------------------------- wounds */
  let woundTex = null, dentTex = null;
  function canvasTex(draw) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; draw(c.getContext('2d'));
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }
  function getWoundTex() {
    return woundTex || (woundTex = canvasTex(g => {
      const grd = g.createRadialGradient(64, 32, 2, 64, 32, 60);
      grd.addColorStop(0, 'rgba(70,0,0,0.95)'); grd.addColorStop(0.35, 'rgba(120,8,6,0.85)'); grd.addColorStop(1, 'rgba(90,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(64, 32, 60, 13, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(25,0,0,0.95)'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 33); g.quadraticCurveTo(64, 27, 118, 31); g.stroke();
      g.strokeStyle = 'rgba(255,120,110,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(16, 30); g.quadraticCurveTo(64, 24, 112, 28); g.stroke();
      for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(110,0,0,0.8)'; g.fillRect(30 + i * 15 + Math.random() * 6, 34, 2.4, 6 + Math.random() * 14); }
    }));
  }
  function getDentTex() {
    return dentTex || (dentTex = canvasTex(g => {
      const grd = g.createRadialGradient(64, 32, 1, 64, 32, 40);
      grd.addColorStop(0, 'rgba(20,20,22,0.85)'); grd.addColorStop(0.6, 'rgba(60,60,64,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(64, 32, 44, 14, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(235,235,240,0.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(26, 30); g.quadraticCurveTo(64, 20, 102, 30); g.stroke();
    }));
  }

  class Fighter {
    constructor(profile, gltf, assets) {
      this.p = profile;
      this.rig = RIGS[profile.model];
      this.sc = profile.height / 1.85;
      const model = T.SkeletonUtils.clone(gltf.scene);
      this.model = model;
      this.mats = [];
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          if (this.rig.hide && this.rig.hide.includes(o.name)) o.visible = false;
          o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if (m.emissive) this.mats.push(m);
            // the arena's sky in the metal and a softer sheen on cloth and skin
            if (m.isMeshStandardMaterial) { m.envMapIntensity = m.metalness > 0.4 ? 1.1 : 0.55; if (m.metalness < 0.4) m.roughness = Math.max(m.roughness, 0.6); }
            // a hide and old bone with some grain to them, not flat card
            if (m.isMeshStandardMaterial && (profile.model === 'troll' || profile.model === 'skeleton') && o.geometry.attributes.uv && window.LudusMat) {
              m.normalMap = LudusMat.stone().normalMap; m.normalScale.set(0.6, 0.6); m.needsUpdate = true;
            }
          });
        }
      });
      const box = new T.Box3().setFromObject(model);
      const h = box.max.y - box.min.y, k = profile.height / h;
      model.scale.multiplyScalar(k);
      model.position.y = -box.min.y * k;
      this.pose = new T.Group(); this.pose.add(model);
      this.root = new T.Group(); this.root.add(this.pose);
      this.root.userData.fighter = this;
      model.updateMatrixWorld(true);
      const bone = n => (n ? model.getObjectByName(n) : null);
      // a bone without a child (the skeleton's forearms): its far end, one forearm-length along it
      const endOf = (b, fromName) => {
        const from = bone(fromName);
        if (!b || !from) return b;
        const e = new T.Object3D(); b.add(e);
        b.getWorldPosition(_a); from.getWorldPosition(_b);
        const wl = _a.distanceTo(_b); const ws = new T.Vector3(); b.getWorldScale(ws);
        e.position.set(0, wl / Math.max(1e-6, ws.y), 0);
        return e;
      };
      this.chest = bone('Chest') || bone('Torso');
      this.parts = (this.rig.parts || []).map(s => ({ s, a: bone(s.a), b: s.b ? bone(s.b) : null })).filter(x => x.a);
      // the sword arm, its grip, and the other arm
      if (profile.weapon === 'sword' || profile.weapon === 'axe') {
        this.ikChain = (this.rig.ik || []).map(bone).filter(Boolean);
        this.ikEnd = this.rig.handExt ? endOf(bone(this.rig.hand), this.rig.ik[0]) : bone(this.rig.hand);
        // the grip sits in the palm, not at the wrist: a point between the wrist and the finger roots
        this.palm = this.ikEnd;
        const fingers = bone(this.rig.palm);
        if (fingers && this.ikEnd && fingers.parent === this.ikEnd) { this.palm = new T.Object3D(); this.ikEnd.add(this.palm); this.palm.position.copy(fingers.position).multiplyScalar(0.7); }
        const wpn = profile.weapon === 'axe' ? makeAxe(1.05) : profile.model === 'dummy' ? makeSword(0.7, true) : makeSword(0.75);
        this.blade = profile.weapon === 'axe' ? [0.3, 0.95] : [0.12, 0.85];
        this.weapon = new T.Group(); this.weapon.add(wpn); this.root.add(this.weapon);
      }
      this.ikChainL = (this.rig.offIk || []).map(bone).filter(Boolean);
      this.ikEndL = this.rig.offExt ? endOf(bone(this.rig.offHand), this.rig.offIk[0]) : bone(this.rig.offHand);
      this.shoulderBone = bone(this.rig.shoulder);
      this.fist = bone(this.rig.fist); this.fistEnd = bone(this.rig.fistEnd);
      if (this.fist && profile.weapon === 'fist') { this.clubLen = 1.0 * this.sc * 0.62; this.club = makeClub(this.clubLen); this.root.add(this.club); }
      this.jaws = bone(this.rig.jaws);
      if (profile.shield && assets.shield) {
        const sh = assets.shield.clone(); sh.scale.setScalar(0.24 * this.sc);
        sh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); } });
        const g = new T.Group(); g.add(sh);
        // centre the model on its own disc so the collider and the picture agree
        g.updateMatrixWorld(true);
        const bb = new T.Box3().setFromObject(sh), ctr = bb.getCenter(new T.Vector3());
        sh.position.sub(ctr);
        const dims = bb.getSize(new T.Vector3());
        this.shieldR = Math.max(dims.x, dims.y) / 2 * 0.95;
        // the model's face points along whichever axis is thinnest: turn that to +Z
        if (dims.x < dims.y && dims.x < dims.z) sh.rotation.y = Math.PI / 2; else if (dims.y < dims.x && dims.y < dims.z) sh.rotation.x = -Math.PI / 2;
        this.shield = g; this.root.add(g);
        this.shieldC = new T.Vector3(...SHIELD_POSE.rest.slice(0, 3)); this.shieldN = new T.Vector3(...SHIELD_POSE.rest.slice(3)).normalize();
      }
      if (profile.dagger) {
        this.dagger = new T.Group(); this.dagger.add(makeSword(0.34)); this.root.add(this.dagger);
        this.dHand = DAGGER_POSE.rest.hand.clone(); this.dDir = DAGGER_POSE.rest.dir.clone();
      }
      // the weapon's planned pose in the fighter's frame, eased toward the brain's wish every frame
      this.wHand = GUARD.mid.hand.clone().multiplyScalar(this.sc); this.wDir = GUARD.mid.dir.clone();
      this.from = null; this.planKey = '';
      this.segH = new T.Vector3(); this.segT = new T.Vector3();
      // animation
      this.mixer = new T.AnimationMixer(model);
      const clips = gltf.animations || [];
      const act = n => { const c = findClip(clips, n); return c ? this.mixer.clipAction(c) : null; };
      this.idle = act(this.rig.idle) || act('Idle');
      this.walk = act(this.rig.walk);
      this.attackClip = act(this.rig.attack);
      this.hits = [act(this.rig.hit), act(this.rig.hit2)].filter(Boolean);
      this.death = act(this.rig.death);
      for (const a of [this.idle, this.walk]) if (a) { a.play(); a.setEffectiveWeight(0); }
      if (this.idle) this.idle.setEffectiveWeight(1);
      if (this.walk && this.rig.walkRate) this.walk.timeScale = this.rig.walkRate;
      if (this.attackClip) { this.attackClip.play(); this.attackClip.setEffectiveWeight(0); this.attackClip.timeScale = 0; }
      this.hits.forEach(a => { a.setLoop(T.LoopOnce); a.clampWhenFinished = false; });
      if (this.death) { this.death.setLoop(T.LoopOnce); this.death.clampWhenFinished = true; }
      this.atkW = 0; this.walkW = 0; this.flash = 0; this.flinch = 0; this.flinchDir = 0;
      this.lean = { x: 0, y: 0, z: 0 }; this.lunge = 0; this.kneelT = 0; this.limpT = 0; this.dead = false; this.deadT = 0;
      this.mode = 'idle'; this.modeT = 0; this.attackInfo = null; this.daze = 0;
      this.wounds = []; this.dropped = [];
      this.spring = { x: 0, z: 0, vx: 0, vz: 0 };
    }

    get height() { return this.p.height; }
    setWalking(on) { this.walking = on; }
    setAction(mode, attack) { if (mode !== this.mode) { this.mode = mode; this.modeT = 0; } if (attack) this.attackInfo = attack; }
    hitReact(dir, big) {
      this.flash = 1; this.flinch = big ? 1 : 0.6; this.flinchDir = dir === 'right' ? -1 : dir === 'left' ? 1 : 0;
      const a = this.hits.length ? this.hits[(Math.random() * this.hits.length) | 0] : null;
      if (a && !this.dead) { a.reset(); a.setEffectiveWeight(big ? 1 : 0.7); a.fadeIn(0.05); a.play(); a.fadeOut(0.45); }
    }
    blockReact(s) { this.flinch = Math.max(this.flinch, 0.3 * (s || 1)); this.flinchDir = 0; }
    die() {
      if (this.dead) return; this.dead = true; this.deadT = 0;
      if (this.death) {
        [this.idle, this.walk, this.attackClip].forEach(a => a && a.fadeOut(0.15));
        this.death.reset(); this.death.setEffectiveWeight(1); this.death.fadeIn(0.1); this.death.play();
      }
    }

    /**
     * The brain's state -> where the weapon should be this frame. b = brain, target = the point the
     * blow is aimed at in this fighter's frame (null outside attacks). Fixes the attack's path at the
     * start of the blow so it cannot steer after you.
     */
    plan(b, target, dt) {
      const sc = this.sc, a = b.attack;
      const cfg = this.attackCfg();
      let key = b.state, want = null, rate = 14, exact = false;
      if (b.state === 'windup' && a) {
        if (!a.target || !a.frozen) a.target = target;
        key = 'w' + a.id;
        want = C.attackPose(a, 'windup', 1, cfg);
        const f = Math.min(1, b.elapsed / Math.max(1, a.windup));
        if (this.planKey !== key) { this.from = { hand: this.wHand.clone(), dir: this.wDir.clone() }; }
        const e = C.smooth(Math.min(1, f / 0.8));
        this.wHand.copy(this.from.hand).lerp(_a.set(want.hilt.x, want.hilt.y, want.hilt.z), e);
        this.wDir.copy(this.from.dir).lerp(_b.set(want.dir.x, want.dir.y, want.dir.z), e).normalize();
        exact = true;
      } else if (b.state === 'strike' && a) {
        if (!a.frozen) { a.frozen = true; if (!a.target) a.target = target; }
        key = 's' + a.id;
        const pz = C.attackPose(a, 'strike', Math.min(1, b.elapsed / a.strikeMs), cfg);
        this.wHand.set(pz.hilt.x, pz.hilt.y, pz.hilt.z); this.wDir.set(pz.dir.x, pz.dir.y, pz.dir.z).normalize();
        exact = true;
      } else if (b.state === 'stagger') { want = GUARD.flung; rate = 10; }
      else if (b.state === 'recover') { want = this.modeT < 0.35 ? GUARD.none : GUARD[b.guard || 'none']; rate = 7; }
      else if (b.state === 'kneel') { want = GUARD.low; rate = 6; }
      else {
        want = GUARD[b.guard || 'none'] || GUARD.none;
        rate = C.brainParrying(b) ? 26 : 16;
      }
      this.planKey = key;
      if (!exact && want) {
        const k = 1 - Math.exp(-rate * dt);
        _a.copy(want.hand).multiplyScalar(sc);
        // an active parry: the blade drives out toward the incoming blow
        if (C.brainParrying(b)) _a.z += 0.14 * sc;
        this.wHand.lerp(_a, k); this.wDir.lerp(want.dir, k).normalize();
      }
      // the shield and the dagger take the lines the sword is not on
      if (this.shield && b.shield) {
        const g = b.state === 'idle' || b.state === 'recover' ? b.seen : null;
        const sp = SHIELD_POSE[g === 'high' || g === 'low' || g === 'mid' ? g : g === 'right' ? 'rest' : 'rest'];
        const k = 1 - Math.exp(-(C.brainParrying(b) ? 22 : 12) * dt);
        this.shieldC.lerp(_a.set(sp[0], sp[1], sp[2]).multiplyScalar(sc), k);
        this.shieldN.lerp(_b.set(sp[3], sp[4], sp[5]).normalize(), k).normalize();
      }
      if (this.dagger) {
        const g = b.state === 'idle' || b.state === 'recover' ? b.seen : null;
        const dp = DAGGER_POSE[g === 'left' ? 'left' : g === 'mid' ? 'mid' : g === 'high' ? 'high' : g === 'low' ? 'low' : 'rest'];
        const k = 1 - Math.exp(-18 * dt);
        this.dHand.lerp(_a.copy(dp.hand).multiplyScalar(sc), k); this.dDir.lerp(dp.dir, k).normalize();
      }
    }
    /** What combat.attackPose needs: the sword shoulder in this frame, arm reach, blade along the weapon. */
    attackCfg() {
      const s = this.sc;
      if (!this._cfg) this._cfg = { shoulder: C.v3(-0.19 * s, 1.43 * s, 0.04 * s), reach: 0.56 * s, blade: this.blade || [0.12, 0.85] };
      if (this.shoulderBone && !this.dead) {
        this.shoulderBone.getWorldPosition(_c); this.root.worldToLocal(_c);
        // the bind pose shoulder, not the animated one: the strike's arc should not wander with the idle sway
        if (!this._sh) this._sh = _c.clone();
        this._cfg.shoulder = C.v3(this._sh.x, this._sh.y, this._sh.z);
      }
      // the troll's blow is his whole arm and club, swung from the shoulder
      if (this.p.weapon === 'fist') { const al = this.armLen || 1.5; this._cfg.reach = 0.0001; this._cfg.blade = [al * 0.5, al + (this.clubLen || 0)]; }
      return this._cfg;
    }

    update(dt, b) {
      this.modeT += dt;
      const r = this.rig, A = this.attackClip, info = this.attackInfo;
      let target = 0, at = 0;
      if (A && !this.dead) {
        const D = A.getClip().duration;
        if (this.mode === 'windup' && info) {
          const f = Math.min(1, this.modeT / (info.windup / 1000));
          at = D * r.raise * Math.pow(f, 0.7); target = 0.8;
        } else if (this.mode === 'strike' && info) {
          const sd = info.strikeMs / 1000, f = Math.min(1, this.modeT / sd);
          at = D * (r.raise + (r.strike - r.raise) * f); target = 0.8;
          if (this.modeT > sd) { const g = Math.min(1, (this.modeT - sd) / 0.5); at = D * (r.strike + (1 - r.strike) * g); target = 0.8 * (1 - g); }
        }
        A.time = Math.min(D - 1e-3, at);
        this.atkW += (target - this.atkW) * Math.min(1, dt * 14);
        A.setEffectiveWeight(this.atkW);
      }
      const wantWalk = this.walking && !this.dead && this.kneelT < 0.1 ? 1 : 0;
      this.walkW += (wantWalk - this.walkW) * Math.min(1, dt * 6);
      if (this.walk) this.walk.setEffectiveWeight(this.walkW * (1 - this.atkW));
      if (this.idle && !this.dead) this.idle.setEffectiveWeight((1 - this.walkW) * (1 - this.atkW));
      this.mixer.update(dt);
      // breathing: the chest rises and falls, faster after effort
      if (!this.dead && this.chest) { this.breath = (this.breath || 0) + dt * (this.mode === 'idle' ? 1.6 : 2.6); const k = 1 + Math.sin(this.breath) * 0.018; this.chest.scale.set(k, 1 + (k - 1) * 0.5, k); }

      // the body tells the blow: shoulders turn away and back, weight goes back then forward
      let lx = 0, ly = 0, lz = 0, lunge = 0, py = 0;
      if (info && (this.mode === 'windup' || this.mode === 'strike')) {
        const sd = info.strikeMs / 1000;
        const wind = this.mode === 'windup' ? Math.min(1, this.modeT / (info.windup / 1000)) : 1;
        const s = this.mode === 'strike' ? Math.min(1, this.modeT / sd) : 0;
        const back = wind * (1 - s), fwd = s * Math.max(0, 1 - (this.modeT - sd) / 0.6);
        const k = info.heavy ? 1.4 : 1;
        switch (C.LINE_DIR[info.line]) {
          case 'left':  ly = (-0.5 * back + 0.45 * fwd) * k; lz = 0.07 * back; lx = info.line === 'highLeft' ? -0.12 * back : 0; break;
          case 'right': ly = (0.5 * back - 0.45 * fwd) * k; lz = -0.07 * back; lx = info.line === 'highRight' ? -0.12 * back : 0; break;
          case 'high':  lx = (-0.22 * back + 0.3 * fwd) * k; break;
          case 'low':   lx = (0.18 * back + 0.25 * fwd) * k; break;
          case 'thrust': lx = 0.06 * back; ly = 0.25 * back - 0.2 * fwd; break;
        }
        lunge = (-0.2 * back + (info.line === 'thrust' ? 0.35 : 0.15) * fwd);
        if (this.p.weapon === 'jaws') { lunge = -0.25 * back + 1.0 * C.smooth(s) * Math.max(0, 1 - (this.modeT - sd) / 0.5); py = Math.sin(Math.PI * s) * (info.aim === 'arm' ? 0.55 : 0.18); }
      }
      if (this.mode === 'stagger' && !this.dead) {
        this.daze += dt;
        lx += -0.14 + Math.sin(this.daze * 7) * 0.05; lz += Math.sin(this.daze * 4.3) * 0.08; lunge -= 0.25;
      } else this.daze = 0;
      // kneeling: down on one knee, chest forward
      this.kneelT += ((this.mode === 'kneel' && !this.dead ? 1 : 0) - this.kneelT) * Math.min(1, dt * 6);
      py -= 0.42 * this.sc * this.kneelT; lx += 0.12 * this.kneelT; lz += 0.08 * this.kneelT;
      // a cut leg: he favours it
      if (this.limp > 0 && !this.dead) { this.limpT += dt * (this.walking ? 7 : 2.5); lz += Math.sin(this.limpT) * 0.05 * this.limp; py -= Math.max(0, Math.sin(this.limpT)) * 0.03 * this.limp; }
      this.flinch = Math.max(0, this.flinch - dt * 3.2);
      lx -= this.flinch * 0.3; ly += this.flinch * 0.25 * this.flinchDir; lunge -= this.flinch * 0.22;
      // a struck training post rocks on its spring
      const sp = this.spring;
      sp.vx += (-60 * sp.x - 5 * sp.vx) * dt; sp.vz += (-60 * sp.z - 5 * sp.vz) * dt; sp.x += sp.vx * dt; sp.z += sp.vz * dt;
      lx += sp.x; lz += sp.z;
      const e = Math.min(1, dt * 12);
      this.lean.x += (lx - this.lean.x) * e; this.lean.y += (ly - this.lean.y) * e; this.lean.z += (lz - this.lean.z) * e;
      this.lunge += (lunge - this.lunge) * e;
      this.pose.rotation.set(this.lean.x, this.lean.y, this.lean.z);
      this.pose.position.set(0, py, this.lunge);
      this.root.updateMatrixWorld(true);
      if (this.driveTarget && this.ikChain && this.ikChain.length && !this.dead) {
        ccd(this.ikChain, this.palm || this.ikEnd, this.driveTarget, 4);
      } else if (!this.dead) this.poseWeapon(b);
      if (this.dead && this.weapon && this.weapon.parent === this.root) this.dropWeapon();
      this.flash = Math.max(0, this.flash - dt * 5);
      for (const m of this.mats) m.emissive.setRGB(this.flash * 0.12, 0, 0);
      for (const d of this.dropped) this.fall(d, dt);
      if (this.dead) { this.deadT += dt; if (this.deadT > 2.5) this.root.position.y -= dt * 0.25; }
    }

    /** Put the weapon (and shield, dagger) where the plan says and reach for them. */
    poseWeapon(b) {
      const armed = this.weapon && (!b || b.armed !== false);
      if (this.weapon) this.weapon.visible = armed && this.weapon.parent === this.root;
      const exact = b && (b.state === 'windup' || b.state === 'strike');
      if (armed && this.weapon.parent === this.root) {
        // outside a blow the weapon rides with the body (a lunge, a kneel); a blow keeps its planned path
        this.weapon.position.copy(this.wHand);
        if (!exact) this.weapon.position.add(this.pose.position);
        // the edge leads into the blow; at rest it faces you
        const side = b && b.state === 'strike' && b.attack && C.TRAVEL[b.attack.line] ? _c.set(C.TRAVEL[b.attack.line].x, C.TRAVEL[b.attack.line].y, 0) : _c.set(0, 0, 1);
        basisQ(this.weapon.quaternion, this.wDir, side);
        this.weapon.updateMatrixWorld(true);
        // the arm reaches for the grip, then the weapon goes where the hand actually got to: never out of it
        if (this.ikChain && this.ikChain.length) {
          _a.copy(this.weapon.position); this.root.localToWorld(_a); ccd(this.ikChain, this.palm, _a.clone(), 6);
          this.palm.getWorldPosition(_a); this.root.worldToLocal(_a); this.weapon.position.copy(_a); this.weapon.updateMatrixWorld(true);
        }
        this.segH.set(0, this.blade[0], 0); this.weapon.localToWorld(this.segH);
        this.segT.set(0, this.blade[1], 0); this.weapon.localToWorld(this.segT);
      }
      if (this.fist && this.p.weapon === 'fist') {
        // the troll's arm is one bone: point it along the planned blow
        this.fist.parent.getWorldQuaternion(_q2);
        _dw.copy(this.wDir).applyQuaternion(this.root.getWorldQuaternion(_q3)).normalize();
        _q.setFromUnitVectors(UPV, _dw);
        this.fist.quaternion.copy(_q2.invert().multiply(_q));
        this.fist.updateMatrixWorld(true);
        this.fist.getWorldPosition(this.segH); (this.fistEnd || this.fist).getWorldPosition(this.segT);
        if (!this.armLen) this.armLen = this.segH.distanceTo(this.segT);
        this.segH.lerp(this.segT, 0.5);
        if (this.club) {
          this.club.position.copy(this.segT); this.root.worldToLocal(this.club.position);
          basisQ(this.club.quaternion, this.wDir, _c.set(0, 0, 1));
          this.segT.addScaledVector(_dw, this.clubLen);
        }
      }
      if (this.jaws && this.p.weapon === 'jaws') {
        this.jaws.getWorldPosition(this.segH);
        this.root.getWorldDirection(_a);
        this.segT.copy(this.segH).addScaledVector(_a, 0.22 * this.sc).y -= 0.02;
      }
      if (this.shield && this.shield.parent === this.root) {
        this.shield.position.copy(this.shieldC).add(this.pose.position);
        this.shield.quaternion.setFromUnitVectors(_a.set(0, 0, 1), this.shieldN);
        if (this.ikChainL.length) { _a.copy(this.shield.position).addScaledVector(this.shieldN, -0.06); this.root.localToWorld(_a); ccd(this.ikChainL, this.ikEndL, _a.clone(), 3); }
      }
      if (this.dagger && this.dagger.parent === this.root) {
        this.dagger.position.copy(this.dHand).add(this.pose.position); basisQ(this.dagger.quaternion, this.dDir, _c.set(1, 0, 0));
        if (this.ikChainL.length) { _a.copy(this.dagger.position); this.root.localToWorld(_a); ccd(this.ikChainL, this.ikEndL, _a.clone(), 3); }
      }
    }
    /** His striking segment in world space { h, t }, or null (unarmed, dead). */
    weaponSeg() {
      if (this.dead) return null;
      if (this.p.weapon === 'fist' || this.p.weapon === 'jaws') return { h: this.segH, t: this.segT, r: this.p.weapon === 'fist' ? 0.13 * this.sc : 0.08 };
      if (!this.weapon || !this.weapon.visible || this.weapon.parent !== this.root) return null;
      return { h: this.segH, t: this.segT, r: 0.014 };
    }
    daggerSeg() {
      if (!this.dagger || this.dead || this.dagger.parent !== this.root) return null;
      const h = new T.Vector3(0, 0.12, 0), t = new T.Vector3(0, 0.44, 0);
      this.dagger.localToWorld(h); this.dagger.localToWorld(t);
      return { h, t, r: 0.012 };
    }
    shieldDisc() {
      if (!this.shield || this.dead || this.shield.parent !== this.root) return null;
      const c = this.shield.getWorldPosition(new T.Vector3()), n = this.shieldN.clone().applyQuaternion(this.root.getWorldQuaternion(_q)).normalize();
      return { c, n, R: this.shieldR, th: 0.035 };
    }
    /** World-space hit capsules [{ zone, a, b, r }]. */
    capsules() {
      const out = [], s = this.sc;
      for (const x of this.parts) {
        const a = x.a.getWorldPosition(new T.Vector3());
        let b2;
        if (x.s.up) b2 = a.clone().add(_a.set(0, x.s.up * s, 0));
        else {
          b2 = x.b.getWorldPosition(new T.Vector3());
          if (x.s.ext) {
            // ext > 0: stretch past b by that share of a->b; ext = -1: a is the end bone, mirror b through it
            if (x.s.ext < 0) { const d = a.clone().sub(b2); b2 = a.clone().add(d); }
            else b2.add(_a.copy(b2).sub(a).multiplyScalar(x.s.ext));
          }
        }
        out.push({ zone: x.s.zone, a, b: b2, r: x.s.r * s, bone: x.a });
      }
      return out;
    }
    /** A fresh wound or dent where your blade landed (world point, the blade's motion), stuck to the bone it hit. */
    addWound(point, motion, bone, armored, size) {
      if (!bone) return;
      const m = new T.Mesh(new T.PlaneGeometry(1, 0.5), new T.MeshBasicMaterial({ map: armored ? getDentTex() : getWoundTex(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4 }));
      const s = (armored ? 0.13 : 0.2) * (0.7 + 0.6 * Math.min(1, size || 0.6)) * this.sc;
      bone.updateMatrixWorld(true);
      const ws = bone.getWorldScale(new T.Vector3());
      m.scale.set(s / ws.x, s / ws.y, s / ws.z);
      // face the attacker, stretched along the cut
      const toward = this.root.getWorldDirection(new T.Vector3());
      const look = point.clone().add(toward);
      const q = new T.Quaternion(), mtx = new T.Matrix4().lookAt(look, point, UPV);
      q.setFromRotationMatrix(mtx);
      const roll = Math.atan2(motion ? motion.y : 0, motion ? Math.abs(motion.x) + 1e-3 : 1);
      q.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), roll));
      bone.add(m);
      const inv = bone.getWorldQuaternion(new T.Quaternion()).invert();
      m.quaternion.copy(inv.multiply(q));
      m.position.copy(bone.worldToLocal(point.clone().addScaledVector(toward, 0.03)));
      m.renderOrder = 3;
      this.wounds.push(m);
      if (this.wounds.length > 22) { const o = this.wounds.shift(); o.parent && o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); }
    }
    /** Knock a training post (or any fighter) by a blow: world velocity of the blade. */
    knock(vel, s) { const sp = this.spring, m = Math.min(1, 20 / Math.max(1e-6, Math.hypot(vel.x, vel.z))); sp.vx += -vel.z * m * 0.05 * s; sp.vz += -vel.x * m * 0.05 * s; }
    dropWeapon() { if (this.weapon && this.weapon.parent === this.root) this.drop(this.weapon); }
    dropShield() { if (this.shield && this.shield.parent === this.root) this.drop(this.shield); }
    rearm() {
      if (!this.weapon || this.weapon.parent === this.root) return;
      // he draws a spare from his belt; the old one stays in the sand
      const spare = this.weapon.clone(); spare.userData = {}; this.weapon = spare; this.root.add(spare); spare.position.copy(this.wHand);
    }
    drop(obj) {
      const scene = this.root.parent;
      if (!scene) return;
      obj.updateMatrixWorld(true);
      const p = obj.getWorldPosition(new T.Vector3()), q = obj.getWorldQuaternion(new T.Quaternion());
      obj.parent.remove(obj); scene.add(obj); obj.position.copy(p); obj.quaternion.copy(q);
      obj.userData.v = new T.Vector3((Math.random() - 0.5) * 2, 1.6, 1.2 + Math.random());
      obj.userData.w = new T.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
      this.dropped.push(obj);
    }
    fall(o, dt) {
      const v = o.userData.v; if (!v) return;
      v.y -= 9.8 * dt; o.position.addScaledVector(v, dt);
      const w = o.userData.w; o.rotation.x += w.x * dt; o.rotation.y += w.y * dt; o.rotation.z += w.z * dt;
      if (o.position.y < 0.05) { o.position.y = 0.05; v.multiplyScalar(0.3); v.y = Math.abs(v.y) * 0.3; w.multiplyScalar(0.4); if (v.length() < 0.2) { o.userData.v = null; o.rotation.x = Math.PI / 2; } }
    }
    remove() { for (const d of this.dropped) d.parent && d.parent.remove(d); }
    /**
     * Versus: this fighter is a player's body. Its own weapon is hidden (the player's sword is
     * drawn instead) and its sword arm reaches for `target` (world point, the player's hilt) each frame.
     */
    drive(target) { this.driveTarget = target; if (this.weapon) this.weapon.visible = !target; }
  }

  /*
   * The palus: a training post the shape of a man. An oak post on a stone plinth, a sackcloth body
   * stuffed with straw and bound with rope, a padded head under a dented iron bucket, a fixed off
   * arm and a sword arm on an iron pivot that swings a wooden rudis back at you. Cuts tear the
   * sacking and leave straw sticking out.
   */
  const SACK = [[0, -0.02], [0.13, 0], [0.172, 0.07], [0.19, 0.2], [0.188, 0.32], [0.175, 0.42], [0.15, 0.5], [0.08, 0.555], [0, 0.56]];
  const sackR = y => { for (let i = 1; i < SACK.length; i++) if (y <= SACK[i][1]) { const a = SACK[i - 1], b = SACK[i]; return a[0] + (b[0] - a[0]) * (y - a[1]) / Math.max(1e-6, b[1] - a[1]); } return 0.08; };
  let tearTex = null;
  function getTearTex() {
    if (tearTex) return tearTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(40,26,12,0.95)'; g.beginPath();
    for (let k = 0; k <= 18; k++) { const a = k / 18 * Math.PI * 2, r = 14 + Math.random() * 9; g[k ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r * 1.5, 32 + Math.sin(a) * r * 0.7); }
    g.fill();
    g.strokeStyle = 'rgba(222,190,110,0.95)'; g.lineWidth = 1.4;
    for (let k = 0; k < 26; k++) { const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 8; g.beginPath(); g.moveTo(32 + Math.cos(a) * r * 1.4, 32 + Math.sin(a) * r * 0.6); g.lineTo(32 + Math.cos(a) * (r + 7) * 1.5, 32 + Math.sin(a) * (r + 6) * 0.7); g.stroke(); }
    tearTex = new T.CanvasTexture(c); tearTex.encoding = T.sRGBEncoding;
    return tearTex;
  }
  class Dummy extends Fighter {
    constructor(profile) {
      const M = LudusMat, g = new T.Group();
      const oak = M.mat(M.wood(), { rough: 0.82 }), oakDark = M.mat(M.wood('dark'), { rough: 0.85 }), sack = M.mat(M.burlap(7, 4), { rough: 0.95, normal: 0.9 }), sackHead = M.mat(M.burlap(4, 3), { rough: 0.95, normal: 0.9 });
      const rope = M.mat(M.rope(14, 1), { rough: 0.9 }), iron = M.mat(M.iron(), { rough: 0.42, metal: 0.85, env: 1.1 }), stone = M.mat(M.stone(), { rough: 0.92 });
      const leather = M.mat(M.leather(), { rough: 0.62 });
      const mesh = (geo, m, parent, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; o.receiveShadow = true; (parent || g).add(o); return o; };
      // plinth and post
      mesh(new T.CylinderGeometry(0.34, 0.4, 0.16, 8), stone, g, 0, 0.08, 0).rotation.y = Math.PI / 8;
      const band = mesh(new T.TorusGeometry(0.087, 0.012, 6, 18), iron, g, 0, 0.19, 0); band.rotation.x = Math.PI / 2;
      mesh(new T.CylinderGeometry(0.066, 0.078, 0.84, 12), oak, g, 0, 0.58, 0);
      for (const y of [0.42, 0.66]) { const r = mesh(new T.TorusGeometry(0.07, 0.005, 5, 18), oakDark, g, 0, y, 0); r.rotation.x = Math.PI / 2; }
      // body: the stuffed sack, bound with rope
      const body = new T.Group(); body.name = 'Body'; body.position.set(0, 0.95, 0); g.add(body);
      mesh(new T.LatheGeometry(SACK.map(p => new T.Vector2(p[0], p[1])), 22), sack, body);
      for (const y of [0.1, 0.3, 0.46]) { const r = mesh(new T.TorusGeometry(sackR(y) + 0.004, 0.011, 6, 26), rope, body, 0, y, 0); r.rotation.x = Math.PI / 2; }
      const helix = new T.CatmullRomCurve3(Array.from({ length: 17 }, (_, k) => { const f = k / 16, a = f * Math.PI * 2, y = 0.06 + f * 0.36; const r = sackR(y) + 0.006; return new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); }));
      mesh(new T.TubeGeometry(helix, 64, 0.009, 6, false), rope, body);
      // shoulder timber, fixed off arm, pivot for the sword arm
      mesh(new T.BoxGeometry(0.72, 0.075, 0.075), oakDark, body, 0, 0.47, 0);
      const offA = new T.Vector3(0.33, 0.47, 0), offB = new T.Vector3(0.34, 0.08, 0.24);
      const off = mesh(new T.BoxGeometry(0.06, offA.distanceTo(offB), 0.06), oak, body); off.position.copy(offA).lerp(offB, 0.5);
      off.quaternion.setFromUnitVectors(UPV, offB.clone().sub(offA).normalize());
      mesh(new T.CylinderGeometry(0.045, 0.045, 0.12, 12), leather, body, offB.x, offB.y + 0.04, offB.z - 0.03).quaternion.copy(off.quaternion);
      const hub = mesh(new T.CylinderGeometry(0.05, 0.05, 0.09, 14), iron, body, -0.33, 0.47, 0.04); hub.rotation.x = Math.PI / 2;
      mesh(new T.SphereGeometry(0.018, 10, 8), iron, body, -0.33, 0.47, 0.09);
      // neck, padded head, iron bucket helmet
      mesh(new T.CylinderGeometry(0.035, 0.045, 0.1, 10), oak, body, 0, 0.6, 0);
      const head = mesh(new T.SphereGeometry(0.11, 18, 14), sackHead, body, 0, 0.71, 0); head.name = 'Head'; head.scale.set(1, 1.1, 0.95);
      const seam = mesh(new T.TorusGeometry(0.111, 0.004, 4, 28), rope, body, 0, 0.71, 0); seam.scale.set(1, 1.1, 1); seam.rotation.y = Math.PI / 2;
      const helm = new T.Group(); helm.position.set(0, 0.78, 0); helm.rotation.set(-0.08, 0.3, 0.13); body.add(helm);
      mesh(new T.CylinderGeometry(0.098, 0.118, 0.12, 20, 1, true), iron, helm).material.side = T.DoubleSide;
      mesh(new T.CircleGeometry(0.098, 20), iron, helm, 0, 0.06, 0).rotation.x = -Math.PI / 2;
      const rim = mesh(new T.TorusGeometry(0.119, 0.008, 6, 24), iron, helm, 0, -0.06, 0); rim.rotation.x = Math.PI / 2;
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; mesh(new T.SphereGeometry(0.006, 6, 4), iron, helm, Math.cos(a) * 0.112, -0.035, Math.sin(a) * 0.112); }
      const named = (n, x, y, z) => { const o = new T.Object3D(); o.name = n; o.position.set(x, y, z); body.add(o); return o; };
      named('ShoulderR', -0.33, 0.47, 0.04); named('ShoulderL', 0.33, 0.47, 0); named('OffEnd', offB.x, offB.y, offB.z); named('Hips', 0, 0.02, 0); named('Neck', 0, 0.52, 0);
      named('HeadTop', 0, 0.86, 0); named('Post0', 0, -0.8, 0); named('Post1', 0, -0.05, 0);
      super(Object.assign({}, profile), { scene: g, animations: [] }, {});
      this.rig = { parts: [] };
      const o = n => this.model.getObjectByName(n);
      this.parts = [
        { s: { zone: 'head', r: 0.12 }, a: o('Head'), b: o('HeadTop') }, { s: { zone: 'torso', r: 0.19 }, a: o('Hips'), b: o('Neck') },
        { s: { zone: 'offArm', r: 0.04 }, a: o('ShoulderL'), b: o('OffEnd') }, { s: { zone: 'legs', r: 0.075 }, a: o('Post0'), b: o('Post1') },
      ];
      this.body = o('Body');
      this.armMesh = new T.Mesh(new T.BoxGeometry(0.058, 1, 0.058), oak); this.armMesh.castShadow = true; this.root.add(this.armMesh);
      // the rudis: grained wood, not paint
      this.weapon.traverse(m => { if (m.isMesh) m.material = M.mat(M.wood('pale'), { rough: 0.7 }); });
      this.shoulderL = o('ShoulderR');
      this.ikChain = []; this.blade = [0.1, 0.78];
      this.tufts = [];
    }
    attackCfg() {
      if (!this._cfg) {
        this.root.updateMatrixWorld(true);
        const s = this.shoulderL.getWorldPosition(new T.Vector3()); this.root.worldToLocal(s);
        this._cfg = { shoulder: C.v3(s.x, s.y, s.z), reach: 0.6, blade: this.blade };
      }
      return this._cfg;
    }
    poseWeapon(b) {
      super.poseWeapon(b);
      // the sword arm: a timber from the pivot to the grip
      const s = this.shoulderL.getWorldPosition(_a); this.root.worldToLocal(s);
      const h = this.weapon.position, d = _b.copy(h).sub(s), l = d.length();
      this.armMesh.position.copy(s).addScaledVector(d, 0.5);
      this.armMesh.quaternion.setFromUnitVectors(UPV, d.normalize()); this.armMesh.scale.set(1, Math.max(0.05, l), 1);
    }
    capsules() {
      const out = super.capsules();
      const s = this.shoulderL.getWorldPosition(new T.Vector3()), h = this.weapon.position.clone(); this.root.localToWorld(h);
      out.push({ zone: 'swordArm', a: s, b: h, r: 0.04, bone: this.shoulderL });
      return out;
    }
    /** A cut in the sacking: a ragged tear on its surface with straw sticking out of it. */
    addWound(point, motion, bone, armored, size) {
      if (!this.body || !bone || !['Hips', 'Neck', 'Head', 'HeadTop'].includes(bone.name)) return;
      const p = this.body.worldToLocal(point.clone());
      const head = bone.name === 'Head' || bone.name === 'HeadTop' || p.y > 0.6;
      const cy = head ? 0.71 : Math.max(0.02, Math.min(0.54, p.y));
      const n = new T.Vector3(p.x, head ? p.y - 0.71 : 0, p.z); if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();
      const r = head ? 0.112 : sackR(cy) + 0.002;
      const at = head ? new T.Vector3(0, 0.71, 0).addScaledVector(n, r) : new T.Vector3(n.x * r, cy, n.z * r);
      const g = new T.Group(); g.position.copy(at); g.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
      const s = 0.07 + 0.05 * Math.min(1, size || 0.5);
      const tear = new T.Mesh(new T.PlaneGeometry(s * 1.4, s * 0.8), new T.MeshStandardMaterial({ map: getTearTex(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }));
      tear.rotation.z = Math.atan2(motion ? motion.y : 0, motion ? Math.abs(motion.x) + 1e-3 : 1);
      g.add(tear);
      if (!getTearTex.straw) getTearTex.straw = new T.MeshStandardMaterial({ color: new T.Color(0xd9b866).convertSRGBToLinear(), roughness: 0.9 });
      for (let k = 0; k < 9; k++) {
        const st = new T.Mesh(new T.CylinderGeometry(0.0015, 0.003, 0.04 + Math.random() * 0.05, 4), getTearTex.straw);
        st.position.set((Math.random() - 0.5) * s * 0.8, (Math.random() - 0.5) * s * 0.4, 0.01);
        st.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
        st.translateY(0.02);
        g.add(st);
      }
      this.body.add(g); this.tufts.push(g);
      if (this.tufts.length > 14) { const old = this.tufts.shift(); this.body.remove(old); }
    }
    hitReact() { this.flash = 0; }
    die() {}
  }

  window.LudusFighters = { Fighter, Dummy, RIGS, makeSword, makeAxe, GUARD, basisQ };
})();
