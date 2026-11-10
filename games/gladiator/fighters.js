/*
 * Iron Ludus - opponents in the sand: model setup, animation, attack poses, reactions.
 * Classic script: defines window.LudusFighters.
 *
 * Every model faces +Z (toward the player). A Fighter is a Group at the opponent's feet:
 *   fighter.root  (position/heading, lunges)  ->  fighter.pose (lean/twist)  ->  model
 * The attack clip is not left to play freely: its time is driven by the brain so the raised
 * "wind-up" pose is held for exactly the telegraph and the blow lands on the impact frame.
 */
(function () {
  'use strict';
  const T = THREE;

  // clip names per model: [idle, attack, hit, death, walk] (matched on the last '|' segment)
  // ik: the weapon arm [upper, lower] driven toward the guard / strike pose; side: which screen side
  // the weapon shoulder is on (-1 = your left). The attack clip still moves the body and legs.
  const RIGS = {
    recruit:  { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      weapon: 'sword', hand: 'WristR', hide: ['Sword_1', 'Sword_2', 'Sword_3'], ik: ['UpperArmR', 'LowerArmR'], side: -1 },
    champion: { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      weapon: 'sword', hand: 'WristR', ik: ['UpperArmR', 'LowerArmR'], side: -1 },
    axeman:   { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', hit2: 'HitRecieve_2', death: 'Death', walk: 'Walk', raise: 0.32, strike: 0.55,
      weapon: 'axe', hand: 'WristR', hide: ['Backpack'], ik: ['UpperArmR', 'LowerArmR'], side: -1 },
    skeleton: { idle: 'Skeleton_Idle', attack: 'Skeleton_Attack', death: 'Skeleton_Death', walk: 'Skeleton_Running', raise: 0.35, strike: 0.6,
      weapon: 'sword', hand: 'RDownLeg001', walkRate: 0.6, ik: ['RUpperLeg001'], side: 1 },
    wolf:     { idle: 'Idle', attack: 'Attack', hit: 'Idle_HitReact_Left', hit2: 'Idle_HitReact_Right', death: 'Death', walk: 'Walk', raise: 0.3, strike: 0.5 },
    troll:    { idle: 'Idle', attack: 'Attack', hit: 'HitRecieve', death: 'Death', walk: 'Walk', raise: 0.35, strike: 0.6 },
  };

  /*
   * Weapon poses in the fighter's frame (metres for a 1.85 m fighter; x = your screen right,
   * y up, z toward you): where the hand goes and where the blade points.
   *   GUARD[side]  covers cuts coming from that side of your screen ('mid' = point at you)
   *   WIND[dir]    the raised wind-up for a strike from dir;  END[dir] where the blow finishes
   */
  const P = (hx, hy, hz, dx, dy, dz) => ({ hand: new T.Vector3(hx, hy, hz), dir: new T.Vector3(dx, dy, dz).normalize() });
  const GUARD = {
    left: P(-0.30, 1.05, 0.38, -0.15, 1, 0.25), right: P(0.22, 1.05, 0.40, 0.15, 1, 0.25),
    high: P(-0.34, 1.52, 0.32, 1, 0.12, 0.1), low: P(-0.25, 0.85, 0.40, 0.55, -0.8, 0.25),
    mid: P(-0.10, 1.00, 0.45, 0.06, 0.32, 0.95), all: P(-0.28, 1.12, 0.40, 1, 0.45, 0.1),
    none: P(-0.30, 0.90, 0.22, -0.2, -0.6, 0.6),
  };
  const WIND = {
    left: P(-0.45, 1.45, 0.05, -0.55, 0.75, -0.35), right: P(0.30, 1.45, 0.10, 0.55, 0.75, -0.35),
    high: P(-0.12, 1.85, 0.05, 0.1, 0.55, -0.8), low: P(-0.40, 0.75, 0.15, -0.6, -0.55, 0.2),
    thrust: P(-0.18, 1.15, -0.10, 0.05, 0.08, 1),
  };
  const END = {
    left: P(0.25, 1.05, 0.65, 0.85, 0.05, 0.5), right: P(-0.35, 1.05, 0.65, -0.85, 0.05, 0.5),
    high: P(-0.05, 0.95, 0.70, 0, -0.45, 0.9), low: P(0.20, 0.85, 0.65, 0.75, 0.35, 0.5),
    thrust: P(-0.05, 1.20, 0.80, 0, 0.03, 1),
  };
  const UPV = new T.Vector3(0, 1, 0), WT = new T.Vector3(), WD = new T.Vector3(), WQ = new T.Quaternion(), WQ2 = new T.Quaternion();
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion();
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

  function findClip(clips, name) {
    if (!name) return null;
    return clips.find(c => c.name === name) || clips.find(c => c.name.split('|').pop() === name) || null;
  }

  /** A simple steel sword for opponents that come without a weapon. Blade along +Y, grip at the origin. */
  function makeSword(len) {
    const g = new T.Group();
    const steel = new T.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 1, roughness: 0.28 });
    const blade = new T.Mesh(new T.BoxGeometry(0.055, len, 0.012), steel);
    blade.position.y = 0.1 + len / 2; g.add(blade);
    const guard = new T.Mesh(new T.BoxGeometry(0.2, 0.03, 0.04), new T.MeshStandardMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.35 }));
    guard.position.y = 0.1; g.add(guard);
    const grip = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.16, 8), new T.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.8 }));
    g.add(grip);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /** A long-hafted gladiator axe. Haft along +Y, grip at the origin, double head at the top. */
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

  class Fighter {
    constructor(profile, gltf, assets) {
      this.p = profile;
      this.rig = RIGS[profile.model];
      const model = T.SkeletonUtils.clone(gltf.scene);
      this.model = model;
      this.mats = [];
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
          if (this.rig.hide && this.rig.hide.includes(o.name)) o.visible = false;
          o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.emissive) this.mats.push(m); });
        }
      });
      if (this.rig.yaw) model.rotation.y = this.rig.yaw;
      // normalise height, feet on the ground
      const box = new T.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      const k = profile.height / h;
      model.scale.multiplyScalar(k);
      model.position.y = -box.min.y * k;
      this.pose = new T.Group(); this.pose.add(model);
      this.root = new T.Group(); this.root.add(this.pose);
      this.root.userData.fighter = this;
      // weapon in hand
      if (this.rig.weapon) {
        const bone = model.getObjectByName(this.rig.hand);
        let w = null;
        // weapon length from grip to tip, used for blade-on-blade contact
        if (this.rig.weapon === 'axe') { w = makeAxe(1.05); this.weaponLen = [0.25, 0.93]; }
        if (this.rig.weapon === 'sword') { w = makeSword(0.75); this.weaponLen = [0.1, 0.85]; }
        if (w && bone) {
          // bones carry the model's (and armature's) scale; undo it so the weapon keeps its real size
          const holder = new T.Group(); holder.add(w); bone.add(holder);
          const ws = new T.Vector3(); bone.getWorldScale(ws);
          holder.scale.setScalar(1 / Math.max(1e-6, ws.x));
          const wr = this.rig.weaponRot || [0, 0, 0];
          holder.rotation.set(wr[0], wr[1], wr[2]);
          w.traverse(o => { if (o.isMesh) o.castShadow = true; });
          this.weapon = holder;
          this.ikChain = (this.rig.ik || []).map(n => model.getObjectByName(n)).filter(Boolean);
          this.ikEnd = bone;
          // the other arm, for a player's body that carries a shield (versus)
          this.ikChainL = ['UpperArmL', 'LowerArmL'].map(n => model.getObjectByName(n)).filter(Boolean);
          this.ikEndL = model.getObjectByName('WristL');
        }
      }
      // current weapon pose (fighter frame), eased toward the wanted one every frame
      this.wHand = GUARD.mid.hand.clone(); this.wDir = GUARD.mid.dir.clone();
      this.guardSide = 'mid';
      this.segH = new T.Vector3(); this.segT = new T.Vector3();
      // animation
      this.mixer = new T.AnimationMixer(model);
      const clips = gltf.animations;
      const act = n => { const c = findClip(clips, n); return c ? this.mixer.clipAction(c) : null; };
      this.idle = act(this.rig.idle) || act('Idle');
      this.walk = act(this.rig.walk);
      this.attack = act(this.rig.attack);
      this.hits = [act(this.rig.hit), act(this.rig.hit2)].filter(Boolean);
      this.death = act(this.rig.death);
      for (const a of [this.idle, this.walk]) if (a) { a.play(); a.setEffectiveWeight(0); }
      if (this.idle) this.idle.setEffectiveWeight(1);
      if (this.walk && this.rig.walkRate) this.walk.timeScale = this.rig.walkRate;
      if (this.attack) { this.attack.play(); this.attack.setEffectiveWeight(0); this.attack.timeScale = 0; }
      this.hits.forEach(a => { a.setLoop(T.LoopOnce); a.clampWhenFinished = false; });
      if (this.death) { this.death.setLoop(T.LoopOnce); this.death.clampWhenFinished = true; }
      this.atkW = 0; this.walkW = 0; this.flash = 0; this.flinch = 0; this.flinchDir = 1;
      this.lean = { x: 0, y: 0, z: 0 }; this.lunge = 0; this.hop = 0; this.dead = false; this.deadT = 0;
      this.mode = 'idle'; this.modeT = 0; this.attackInfo = null; this.daze = 0;
    }

    /** Height of the chest and head, for aiming and hit boxes. */
    get height() { return this.p.height; }

    setWalking(on) { this.walking = on; }

    /** Brain state -> pose. phase: 'windup' (0..1 through the wind-up), 'strike' (0..1 after impact), 'recover', 'stagger', 'idle'. */
    setAction(mode, attack) { if (mode !== this.mode) { this.mode = mode; this.modeT = 0; } if (attack) this.attackInfo = attack; }

    hitReact(dir, big) {
      this.flash = 1; this.flinch = big ? 1 : 0.6; this.flinchDir = dir === 'right' ? -1 : dir === 'left' ? 1 : 0;
      const a = this.hits.length ? this.hits[(Math.random() * this.hits.length) | 0] : null;
      if (a && !this.dead) { a.reset(); a.setEffectiveWeight(big ? 1 : 0.7); a.fadeIn(0.05); a.play(); a.fadeOut(0.45); }
    }
    blockReact() { this.flinch = Math.max(this.flinch, 0.35); this.flinchDir = 0; }
    evadeHop() { this.hop = 1; }
    die() {
      if (this.dead) return; this.dead = true; this.deadT = 0;
      if (this.death) {
        [this.idle, this.walk, this.attack].forEach(a => a && a.fadeOut(0.15));
        this.death.reset(); this.death.setEffectiveWeight(1); this.death.fadeIn(0.1); this.death.play();
      }
    }

    update(dt) {
      this.modeT += dt;
      const r = this.rig, A = this.attack, info = this.attackInfo;
      // attack clip time + weight driven by the brain's phase
      let target = 0, at = 0;
      if (A && !this.dead) {
        const D = A.getClip().duration;
        if (this.mode === 'windup' && info) {
          const f = Math.min(1, this.modeT / (info.windup / 1000));
          at = D * r.raise * Math.pow(f, 0.7); target = 1;
        } else if (this.mode === 'strike') {
          const f = Math.min(1, this.modeT / 0.16);
          at = D * (r.raise + (r.strike - r.raise) * f); target = 1;
          if (this.modeT > 0.16) { const g = Math.min(1, (this.modeT - 0.16) / 0.5); at = D * (r.strike + (1 - r.strike) * g); target = 1 - g; }
        }
        A.time = Math.min(D - 1e-3, at);
        this.atkW += (target - this.atkW) * Math.min(1, dt * 14);
        A.setEffectiveWeight(this.atkW);
      }
      const wantWalk = this.walking && !this.dead ? 1 : 0;
      this.walkW += (wantWalk - this.walkW) * Math.min(1, dt * 6);
      if (this.walk) this.walk.setEffectiveWeight(this.walkW * (1 - this.atkW));
      if (this.idle && !this.dead) this.idle.setEffectiveWeight((1 - this.walkW) * (1 - this.atkW));
      this.mixer.update(dt);

      // procedural lean / twist / lunge so the strike direction reads
      let lx = 0, ly = 0, lz = 0, lunge = 0;
      if (info && (this.mode === 'windup' || this.mode === 'strike')) {
        const wind = this.mode === 'windup' ? Math.min(1, this.modeT / (info.windup / 1000)) : 1;
        const s = this.mode === 'strike' ? Math.min(1, this.modeT / 0.14) : 0;
        const back = wind * (1 - s), fwd = s * Math.max(0, 1 - (this.modeT - 0.14) / 0.6);
        const k = info.heavy ? 1.35 : 1;
        switch (info.dir) {
          case 'left':  ly = (-0.55 * back + 0.5 * fwd) * k; lz = 0.08 * back; break; // winds up to his right (our left)
          case 'right': ly = (0.55 * back - 0.5 * fwd) * k; lz = -0.08 * back; break;
          case 'high':  lx = (-0.22 * back + 0.3 * fwd) * k; break;
          case 'low':   lx = (0.18 * back + 0.25 * fwd) * k; break;
          case 'thrust': lx = 0.05 * back; break;
        }
        lunge = (-0.25 * back + (info.dir === 'thrust' ? 0.75 : 0.45) * fwd) * (this.p.beast ? 1.6 : 1);
      }
      if (this.mode === 'stagger' && !this.dead) {
        this.daze += dt;
        lx += -0.12 + Math.sin(this.daze * 7) * 0.05; lz += Math.sin(this.daze * 4.3) * 0.08; lunge -= 0.3;
      } else this.daze = 0;
      this.flinch = Math.max(0, this.flinch - dt * 3.2);
      lx -= this.flinch * 0.32; ly += this.flinch * 0.25 * this.flinchDir; lunge -= this.flinch * 0.25;
      this.hop = Math.max(0, this.hop - dt * 2.2);
      const hopY = Math.sin(this.hop * Math.PI) * 0.45;
      lunge -= Math.sin(this.hop * Math.PI) * 0.9;
      const e = Math.min(1, dt * 12);
      this.lean.x += (lx - this.lean.x) * e; this.lean.y += (ly - this.lean.y) * e; this.lean.z += (lz - this.lean.z) * e;
      this.lunge += (lunge - this.lunge) * e;
      this.pose.rotation.set(this.lean.x, this.lean.y, this.lean.z);
      this.pose.position.set(0, hopY, this.lunge);
      if (this.driveTarget && this.ikChain && this.ikChain.length && !this.dead) {
        // a player's avatar: the arm reaches for wherever that player's own sword is
        this.pose.updateMatrixWorld(true);
        ccd(this.ikChain, this.ikEnd, this.driveTarget, 3);
        // and the shield arm reaches for the inside of that player's shield
        if (this.driveTargetL && this.ikEndL && this.ikChainL.length === 2) ccd(this.ikChainL, this.ikEndL, this.driveTargetL, 2);
      } else if (this.weapon && !this.dead) this.poseWeapon(dt);
      // hit flash
      this.flash = Math.max(0, this.flash - dt * 5);
      for (const m of this.mats) m.emissive.setRGB(this.flash * 0.1, 0, 0);
      if (this.dead) {
        this.deadT += dt;
        if (this.deadT > 2.5) this.root.position.y -= dt * 0.25;
      }
    }

    /** Drive the weapon arm (IK) and blade toward the pose the brain is in: guard side, wind-up, blow. */
    poseWeapon(dt) {
      const info = this.attackInfo;
      let want, rate;
      if (this.mode === 'windup' && info) { want = WIND[info.dir] || WIND.high; rate = Math.min(22, Math.max(8, 3.2 / (info.windup / 1000))); }
      else if (this.mode === 'strike' && info && this.modeT < 0.3) { want = END[info.dir] || END.high; rate = 34; }
      else if (this.mode !== 'idle') { want = GUARD.none; rate = 8; }
      else { want = GUARD[this.guardSide] || GUARD.none; rate = 16; }
      const k = 1 - Math.exp(-rate * dt);
      this.wHand.lerp(want.hand, k); this.wDir.lerp(want.dir, k).normalize();
      if (this.weaponKick > 0) { // struck blade: it jumps, then settles back
        this.wDir.x += (this.kickSign || 1) * 0.5 * this.weaponKick * dt * 10; this.wHand.z -= 0.08 * this.weaponKick * dt * 10;
        this.wDir.normalize(); this.weaponKick = Math.max(0, this.weaponKick - dt * 5);
      } else this.kickSign = Math.random() < 0.5 ? -1 : 1;
      const sc = this.p.height / 1.85;
      this.pose.updateMatrixWorld(true);
      const target = WT.copy(this.wHand).multiplyScalar(sc);
      this.pose.localToWorld(target);
      if (this.ikChain.length) ccd(this.ikChain, this.ikEnd, target, 2);
      this.pose.getWorldQuaternion(WQ);
      WD.copy(this.wDir).applyQuaternion(WQ);
      WQ2.setFromUnitVectors(UPV, WD);
      this.ikEnd.getWorldQuaternion(WQ);
      this.weapon.quaternion.copy(WQ.invert().multiply(WQ2));
      this.weapon.updateMatrixWorld(true);
      this.segH.set(0, this.weaponLen[0], 0); this.weapon.localToWorld(this.segH);
      this.segT.set(0, this.weaponLen[1], 0); this.weapon.localToWorld(this.segT);
    }
    /**
     * Versus: this fighter is a player's body. Its own weapon is hidden (the player's sword is
     * drawn instead) and its sword arm reaches for `target` (world point, the player's hilt) each frame.
     */
    drive(target) { this.driveTarget = target; if (this.weapon) this.weapon.visible = !target; }
    /** His weapon's striking part in world space { h, t }, or null for beasts. */
    weaponSeg() { return this.weapon && !this.dead ? { h: this.segH, t: this.segT } : null; }

    /**
     * World-space hit zones (half sizes in metres, facing the camera). Index 1 is always the torso.
     * Humanoids: head, torso, legs, weapon arm. Beasts: head, torso.
     */
    boxes() {
      const h = this.p.height, c = new T.Vector3();
      this.pose.getWorldPosition(c);
      if (this.p.beast) {
        return [{ name: 'head', center: c.clone().add(new T.Vector3(0, h * 0.72, 0.35)), hw: 0.2, hh: 0.17 },
          { name: 'torso', center: c.clone().add(new T.Vector3(0, h * 0.5, 0)), hw: 0.3, hh: h * 0.32 }];
      }
      const big = this.p.model === 'troll';
      const out = [{ name: 'head', center: c.clone().add(new T.Vector3(0, h * (big ? 0.8 : 0.88), 0)), hw: h * (big ? 0.12 : 0.075), hh: h * (big ? 0.1 : 0.075) },
        { name: 'torso', center: c.clone().add(new T.Vector3(0, h * 0.63, 0)), hw: h * (big ? 0.22 : 0.15), hh: h * 0.18 },
        { name: 'legs', center: c.clone().add(new T.Vector3(0, h * 0.24, 0)), hw: h * (big ? 0.2 : 0.12), hh: h * 0.22 }];
      if (this.weapon && this.ikEnd) { const w = new T.Vector3(); this.ikEnd.getWorldPosition(w); out.push({ name: 'arm', center: w, hw: 0.09 * h / 1.85, hh: 0.09 * h / 1.85 }); }
      return out;
    }
  }

  window.LudusFighters = { Fighter, RIGS, makeSword, makeAxe, GUARD };
})();
