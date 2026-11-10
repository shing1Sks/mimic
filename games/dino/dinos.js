// Ironfern dinosaurs (Stage B): the DH.Dinos manager. Spawning, per-animal AI (the state machine
// lives in dino-logic.js), locomotion that follows the terrain, animation blending, procedural hit
// reactions, attacks with telegraphs, per-bone hitboxes for raycasts, damage, deaths, corpses and
// creature sounds. The look (materials, hit capsules, scale) lives in dino-look.js.
//   DH.Dinos.spawn(species, { at, path?, target, tagged?, aggro?, delay?, circle?, charge? }) -> dino
//   DH.Dinos.raycast(origin, dir, maxDist) -> { dino, zone, point, normal, dist } | null
//   DH.Dinos.damage(dino, amount, zone, dir) -> { killed, damage }
//   events: dino:spawn, dino:hit, dino:dead, dino:attack, dino:reached
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const T = window.THREE;
  const LOGIC = () => DH.DinoLogic, LOOK = () => DH.DinoLook;

  // ------------------------------------------------------------------ sounds
  const SND = ['breath', 'dilo_die', 'dilo_rattle', 'dilo_screech1', 'dilo_screech2', 'flesh1', 'flesh2', 'flesh_tear',
    'grazer_alarm', 'grazer_call1', 'grazer_call2', 'grazer_call3', 'grazer_snore', 'grunt_low', 'ptero_die',
    'ptero_screech1', 'ptero_screech2', 'ptero_screech3', 'ptero_screech4', 'raptor_call1', 'raptor_call2', 'raptor_die1',
    'raptor_die2', 'raptor_growl2', 'raptor_growl5', 'raptor_growl8', 'raptor_growl9', 'raptor_growl12', 'raptor_growl13',
    'raptor_shriek1', 'raptor_shriek2', 'raptor_shriek3', 'rex_growl1', 'rex_growl2', 'rex_growl3', 'rex_growl4',
    'rex_huff1', 'rex_huff2', 'rex_roar1', 'rex_roar2', 'rex_roar3', 'rex_snarl1', 'rex_snarl2', 'rex_snarl3', 'rex_snarl4',
    'snarl_long1', 'snarl_long2', 'snarl_long3', 'spit1', 'spit2', 'spit3', 'stomp1', 'stomp2', 'trike_bellow1',
    'trike_bellow2', 'trike_charge', 'trike_die', 'trike_snort1', 'trike_snort2'];
  if (DH.Assets) SND.forEach(n => DH.Assets.register('dino_' + n, 'assets/sfx/dino_' + n + '.ogg'));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + (b - a) * Math.random();
  // per species: calls while moving, telegraph cries, deaths. [key list, volume, rate range, ref distance]
  const VOX = {
    raptor: { idle: [['raptor_call1', 'raptor_call2', 'raptor_growl2', 'raptor_growl5', 'raptor_growl8', 'raptor_growl9', 'raptor_growl12', 'raptor_growl13'], 0.55, [0.95, 1.15], 6],
      tele: [['raptor_shriek1', 'raptor_shriek2', 'raptor_shriek3'], 0.9, [0.95, 1.1], 8], die: [['raptor_die1', 'raptor_die2'], 0.85, [0.9, 1.05], 8],
      hurt: [['raptor_growl8', 'raptor_growl12', 'raptor_call2'], 0.6, [1.05, 1.2], 6], every: [2.5, 6] },
    dilo: { idle: [['snarl_long1', 'snarl_long2', 'snarl_long3', 'dilo_rattle'], 0.5, [1.25, 1.45], 6],
      tele: [['dilo_screech1', 'dilo_screech2', 'dilo_rattle'], 0.9, [0.95, 1.1], 8], die: [['dilo_die'], 0.85, [0.9, 1], 8],
      hurt: [['dilo_screech2'], 0.6, [1.1, 1.25], 6], every: [3, 7] },
    trike: { idle: [['trike_snort1', 'trike_snort2', 'trike_bellow1'], 0.7, [0.6, 0.75], 10],
      tele: [['trike_charge', 'trike_bellow2'], 1, [0.6, 0.7], 14], die: [['trike_die'], 1, [0.55, 0.65], 14],
      hurt: [['trike_bellow1', 'trike_bellow2'], 0.7, [0.65, 0.75], 10], every: [4, 8] },
    rex: { idle: [['rex_huff1', 'rex_huff2', 'rex_growl1', 'rex_growl2', 'rex_growl3', 'rex_growl4'], 0.9, [0.85, 1], 18],
      tele: [['rex_snarl1', 'rex_snarl2', 'rex_snarl3', 'rex_snarl4'], 1, [0.6, 0.7], 18], roar: [['rex_roar1', 'rex_roar2', 'rex_roar3'], 1, [0.9, 1], 30],
      die: [['rex_roar3'], 1, [0.6, 0.65], 30], hurt: [['rex_growl3', 'rex_huff2'], 0.8, [0.8, 0.9], 18], every: [4, 7] },
    ptero: { idle: [['ptero_screech1', 'ptero_screech2', 'ptero_screech3', 'ptero_screech4'], 0.45, [1.05, 1.25], 10],
      tele: [['ptero_screech1', 'ptero_screech2', 'ptero_screech3', 'ptero_screech4'], 1, [0.95, 1.05], 14], die: [['ptero_die'], 0.9, [0.8, 0.9], 10],
      hurt: [['ptero_screech4'], 0.6, [1.2, 1.3], 8], every: [4, 9] },
    grazer: { idle: [['grazer_call1', 'grazer_call2', 'grazer_call3', 'grazer_snore'], 0.5, [0.75, 0.95], 14],
      alarm: [['grazer_alarm', 'grazer_call2'], 0.8, [0.6, 0.75], 16], die: [['grazer_call1', 'trike_die'], 0.9, [0.5, 0.6], 14],
      hurt: [['grazer_alarm'], 0.7, [0.65, 0.75], 14], every: [6, 16] },
  };
  function voice(d, kind, volMul) {
    const v = VOX[d.species] && VOX[d.species][kind];
    if (!v || !DH.Audio || !DH.Audio.play) return;
    const size = d.variant === 'apato' ? 0.75 : 1;
    DH.Audio.play('dino_' + pick(v[0]), { pos: headPos(d), volume: v[1] * (volMul || 1), rate: rnd(v[2][0], v[2][1]) * size, ref: v[3], maxVoices: 6 });
  }
  function sfx(key, pos, vol, rate, ref) {
    if (DH.Audio && DH.Audio.play) DH.Audio.play('dino_' + key, { pos, volume: vol, rate: rate || 1, ref: ref || 6, maxVoices: 8 });
  }

  // ------------------------------------------------------------------ state
  let ctx = null, nextId = 1;
  const dinos = [], spits = [];
  const VARIANTS = { raptor: ['raptor'], dilo: ['dilo'], trike: ['trike'], ptero: ['ptero'], rex: ['rex'], grazer: ['para', 'para', 'para', 'stego', 'apato'] };
  const UP = new T.Vector3(0, 1, 0);
  const _v = new T.Vector3(), _w = new T.Vector3(), _a = new T.Vector3(), _b = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion();
  const _m = new T.Matrix4();

  const groundAt = (x, z) => (ctx && ctx.world && typeof ctx.world.heightAt === 'function') ? (ctx.world.heightAt(x, z) || 0) : 0;
  const playerPos = () => (ctx && ctx.view && ctx.view.pos) || _v.set(0, 1.7, 0);
  const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function headPos(d) {
    const h = d.inst.bones.Head;
    return h ? h.getWorldPosition(new T.Vector3()) : d.root.position.clone();
  }
  const angDiff = (a, b) => { const x = b - a; if (!isFinite(x)) return 0; return x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI)); };

  // ------------------------------------------------------------------ spawn
  function spawn(species, o) {
    const L = LOGIC(), K = LOOK();
    if (!L || !K || !L.SPECIES[species] || !ctx) return null;
    o = o || {};
    const variant = pick(VARIANTS[species]);
    const inst = K.instance(variant, { tagged: !!o.tagged });
    if (!inst) return null;
    const at = (o.at && o.at.clone) ? o.at.clone() : new T.Vector3();
    const target = (o.target && o.target.clone) ? o.target.clone() : playerPos().clone();
    const pp = playerPos();
    const playerTarget = species !== 'grazer' && hdist(target, pp) < 15;
    const sp = L.SPECIES[species];
    const brain = L.createBrain(species, { aggro: o.aggro, delay: o.delay || 0, playerTarget });
    const d = {
      id: nextId++, species, variant, alive: true, hp: brain.hp, maxHp: brain.maxHp, pos: at, tagged: !!o.tagged, root: inst.root,
      inst, brain, sp, path: (o.path || []).map(p => p.clone()), pathI: 0, target, home: target.clone(), playerTarget,
      circle: (o.circle || []).map(p => p.clone()), circleI: 0, charge: (o.charge || []).map(p => p.clone()),
      heading: 0, speed: 0, desired: 0, vel: new T.Vector3(), knock: new T.Vector3(), pitch: 0, roll: 0,
      flinch: 0, flinchAxis: new T.Vector3(1, 0, 0), crouch: 0, rear: 0, neckPitch: 0, headDown: 0,
      voxT: rnd(1, 4), stepPhase: 0, corpseT: 0, packLoss: false, alarmed: false, offset: 0, wanderTo: null,
      strafe: Math.random() < 0.5 ? -1 : 1, fly: null, weights: {}, oneShot: null, deathPose: false, lastHitZone: 'body',
    };
    if (species === 'ptero') {
      // fly in from where it spawned, at altitude
      const alt = rnd(15, 22); // low enough to read against the sky, high enough to need a look up
      at.y = Math.max(at.y, groundAt(at.x, at.z) + alt);
      d.fly = { alt, radius: rnd(22, 32), dir: Math.random() < 0.5 ? 1 : -1, bank: 0, swoop: null, climbV: new T.Vector3() };
    } else {
      at.y = groundAt(at.x, at.z);
    }
    const aim = d.path.length ? d.path[0] : target;
    d.heading = Math.atan2(aim.x - at.x, aim.z - at.z);
    if (playerTarget && sp.pack) {
      // packs: animals of the same species spawned close together in time and space fan out
      const mates = dinos.filter(x => x.alive && x.species === species && x.pack && ctx.time - x.born < 20 && hdist(x.home, target) < 6 && hdist(x.spawnAt, at) < 40);
      d.pack = mates.length ? mates[0].pack : { id: d.id };
      d.offset = L.flankOffset(mates.length, 9);
    } else if (sp.pack) d.pack = { id: d.id };
    d.born = ctx.time; d.spawnAt = at.clone();
    // animation actions
    const clips = inst.clips;
    d.actions = {};
    for (const name in clips) {
      const a = inst.mixer.clipAction(clips[name]);
      d.actions[name] = a;
      if (/^(Idle|Walk|Run|Flying)$/.test(name)) { a.play(); a.setEffectiveWeight(0); a.time = Math.random() * clips[name].duration; }
      d.weights[name] = 0;
    }
    d.loco = species === 'ptero' ? ['Flying'] : ['Idle', 'Walk', 'Run'];
    d.nat = {
      walk: inst.tpl.speeds.walk > 0.2 ? inst.tpl.speeds.walk : sp.walk || 2,
      run: inst.tpl.speeds.run > 0.5 ? inst.tpl.speeds.run : sp.run || 6,
    };
    placeRoot(d, 0);
    inst.mixer.update(0);
    inst.root.updateMatrixWorld(true);
    if (K.fixCrests) K.fixCrests(inst);
    if (species !== 'ptero') inst.root.add(contactShadow(inst.tpl));
    inst.root.visible = brain.state !== 'wait';
    ctx.scene.add(inst.root);
    dinos.push(d);
    if (DH.bus) DH.bus.emit('dino:spawn', { dino: d });
    return d;
  }

  // A soft dark ellipse under the animal: grounds it (the sun's shadow map is static) and makes a
  // small animal in the ferns easier to pick out.
  let blobTex = null;
  function contactShadow(tpl) {
    if (!blobTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      blobTex = new T.CanvasTexture(c);
    }
    const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000, fog: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.renderOrder = 1;
    m.scale.set(tpl.length * 0.32, tpl.length * 0.75, 1);
    m.userData.blob = true;
    return m;
  }

  // ------------------------------------------------------------------ animation
  function oneShot(d, name, o) {
    const a = d.actions[name]; if (!a) return;
    o = o || {};
    if (d.oneShot && d.oneShot.name !== name && d.actions[d.oneShot.name] && d.oneShot.name !== 'Death') {
      d.weights[d.oneShot.name] = d.weights[d.oneShot.name] || 0;
    }
    a.reset(); a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = o.rate || 1;
    if (o.startAt) a.time = o.startAt * a.getClip().duration;
    a.play();
    d.oneShot = { name, until: o.hold ? Infinity : (a.getClip().duration * (1 - (o.startAt || 0))) / (o.rate || 1) - 0.15, w: o.weight == null ? 1 : o.weight, t: 0 };
  }
  function animate(d, dt) {
    const A = d.actions, W = d.weights, k = Math.min(1, dt * (d.oneShot && d.oneShot.t < 0.05 ? 9 : 6));
    let os = 0;
    if (d.oneShot) {
      d.oneShot.t += dt;
      if (d.oneShot.t >= d.oneShot.until) d.oneShot = null;
      else os = d.oneShot.w;
    }
    const tgt = {};
    if (d.species === 'ptero') tgt.Flying = 1 - os;
    else {
      const s = Math.abs(d.speed), wn = d.nat.walk, rn = d.nat.run;
      const wWalk = Math.min(1, s / (wn * 0.5)), wRun = Math.max(0, Math.min(1, (s - wn * 1.15) / (Math.min(rn, wn * 3) * 0.6 - wn * 1.15 + 1e-3)));
      tgt.Idle = (1 - wWalk) * (1 - os); tgt.Walk = wWalk * (1 - wRun) * (1 - os); tgt.Run = wWalk * wRun * (1 - os);
      if (A.Walk) A.Walk.timeScale = Math.max(0.5, Math.min(2.2, s / wn));
      if (A.Run) A.Run.timeScale = Math.max(0.6, Math.min(2.4, s / rn));
    }
    if (d.oneShot) tgt[d.oneShot.name] = os;
    for (const n in A) {
      const want = tgt[n] || 0;
      W[n] += (want - W[n]) * k;
      if (W[n] < 0.002 && want === 0) W[n] = 0;
      A[n].setEffectiveWeight(W[n]);
      if (W[n] > 0 && !A[n].isRunning() && /^(Idle|Walk|Run|Flying)$/.test(n)) A[n].play();
    }
    if (d.deathPose && A.Death) { for (const n in A) A[n].setEffectiveWeight(n === 'Death' ? 1 : 0); }
    d.inst.mixer.update(dt);
  }

  // rotate a bone about a world axis (applied after the mixer, so it is additive)
  function rotBone(bone, axisW, ang) {
    if (!bone || !ang) return;
    bone.parent.getWorldQuaternion(_q2);
    _v.copy(axisW).applyQuaternion(_q2.invert());
    _q.setFromAxisAngle(_v.normalize(), ang);
    bone.quaternion.premultiply(_q);
  }
  function procedural(d, dt) {
    const B = d.inst.bones;
    const fwd = _a.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    const right = _b.crossVectors(fwd, UP).normalize().clone();
    d.flinch = Math.max(0, d.flinch - dt * 3.2);
    const fl = d.flinch > 0 ? Math.sin((1 - d.flinch) * 9) * d.flinch * 0.45 : 0;
    const torso = B.Torso || B.Body, neck = B.Neck, head = B.Head;
    // +pitch = nose up about the animal's right axis
    if (torso) rotBone(torso, right, d.rear * 0.55 - d.crouch * 0.25);
    if (neck) rotBone(neck, right, d.neckPitch * 0.5 - d.headDown * 0.5);
    if (head) rotBone(head, right, d.neckPitch * 0.5 - d.headDown * 0.35);
    if (d.inst.headStretch && head) head.scale.copy(d.inst.headStretch);
    if (d.inst.boneScale) for (const n in d.inst.boneScale) if (B[n]) B[n].scale.setScalar(d.inst.boneScale[n]);
    if (fl) {
      if (torso) rotBone(torso, d.flinchAxis, fl * 0.5);
      if (neck) rotBone(neck, d.flinchAxis, fl * 0.8);
      if (head) rotBone(head, d.flinchAxis, fl);
    }
  }

  // ------------------------------------------------------------------ movement helpers
  function placeRoot(d, dt) {
    const r = d.root, p = d.pos;
    r.position.copy(p);
    if (d.species !== 'ptero') {
      // follow the slope: pitch from samples ahead and behind
      const L = d.inst.tpl.length * 0.35, fx = Math.sin(d.heading), fz = Math.cos(d.heading);
      const hf = groundAt(p.x + fx * L, p.z + fz * L), hb = groundAt(p.x - fx * L, p.z - fz * L);
      const want = -Math.atan2(hf - hb, 2 * L) * 0.8;
      d.pitch += (want - d.pitch) * Math.min(1, dt * 6);
    }
    r.rotation.set(0, 0, 0); r.rotation.order = 'YXZ';
    r.rotation.y = d.heading; r.rotation.x = d.pitch; r.rotation.z = d.roll;
    // the dragon stand-in flies upright: tip it forward so the pterosaur flies flat, legs trailing
    if (d.species === 'ptero') d.inst.inner.rotation.x += ((d.alive ? 1.05 : 0) - d.inst.inner.rotation.x) * Math.min(1, dt * 3 + (dt === 0 ? 1 : 0));
    d.inst.inner.position.y = d.species === 'ptero' ? (d.alive ? 0 : d.inst.tpl.height * 0.3) : d.inst.tpl.groundOffset - d.crouch * d.inst.tpl.height * 0.12;
  }
  function turnTo(d, yaw, dt, rate) {
    const k = rate * dt, diff = angDiff(d.heading, yaw);
    d.heading += Math.max(-k, Math.min(k, diff));
    return Math.abs(diff);
  }
  function steer(d, goal, speed, dt, o) {
    o = o || {};
    const dx = goal.x - d.pos.x, dz = goal.z - d.pos.z, dist = Math.hypot(dx, dz);
    let yaw = Math.atan2(dx, dz);
    // separation from other animals
    let sx = 0, sz = 0;
    for (const e of dinos) {
      if (e === d || !e.alive || e.species === 'ptero' || !e.root.visible) continue;
      const ex = d.pos.x - e.pos.x, ez = d.pos.z - e.pos.z, dd = Math.hypot(ex, ez);
      const min = (d.inst.tpl.length + e.inst.tpl.length) * 0.4;
      if (dd > 1e-3 && dd < min) { sx += ex / dd * (min - dd) / min; sz += ez / dd * (min - dd) / min; }
    }
    if (sx || sz) yaw = Math.atan2(Math.sin(yaw) + sx * 1.5, Math.cos(yaw) + sz * 1.5);
    const turnRate = (d.sp.turnRate || 2) * (o.turnBoost || 1) * (speed < 1 ? 1.6 : 1);
    const off = turnTo(d, yaw, dt, turnRate);
    // slow down for sharp turns and when arriving
    let want = speed * Math.max(0.25, Math.cos(Math.min(off, 1.4)));
    if (o.arrive) want = Math.min(want, Math.max(0, dist - o.arrive) * 1.2);
    accel(d, want, dt);
    return dist;
  }
  function accel(d, want, dt) {
    const a = want > d.speed ? (d.species === 'trike' || d.species === 'rex' ? 5 : 9) : 12;
    d.speed += Math.max(-a * dt, Math.min(a * dt, want - d.speed));
    d.desired = want;
  }
  function advance(d, dt) {
    const s = d.speed;
    d.pos.x += Math.sin(d.heading) * s * dt + d.knock.x * dt;
    d.pos.z += Math.cos(d.heading) * s * dt + d.knock.z * dt;
    d.knock.multiplyScalar(Math.exp(-dt * 5));
    if (d.species !== 'ptero' || !d.alive) {
      const g = groundAt(d.pos.x, d.pos.z);
      if (d.species === 'ptero') d.pos.y = Math.max(g, d.pos.y);
      else d.pos.y = g;
    }
  }
  /** Where a player-hunting animal is heading: the stand (live: rides move), pushed out to its flank. */
  function huntGoal(d, out) {
    const pp = playerPos();
    out.set(pp.x, groundAt(pp.x, pp.z), pp.z);
    if (d.offset) {
      const dx = d.pos.x - out.x, dz = d.pos.z - out.z, dist = Math.hypot(dx, dz) || 1;
      const lat = LOGIC().flankAt(d.offset, dist, 6, 24);
      out.x += (-dz / dist) * lat + (dx / dist) * Math.abs(lat) * 0.3;
      out.z += (dx / dist) * lat + (dz / dist) * Math.abs(lat) * 0.3;
    }
    return out;
  }

  // ------------------------------------------------------------------ per-species locomotion
  const _goal = new T.Vector3();
  function locomote(d, dt) {
    const b = d.brain, sp = d.sp, pp = playerPos();
    const dPlayer = hdist(d.pos, pp);
    if (d.species === 'ptero') return flyer(d, dt);
    const runSp = sp.run * (0.85 + 0.15 * b.aggro) * (b.rage ? 1.2 : 1);
    switch (b.state) {
      case 'approach': {
        // follow the path first
        if (d.pathI < d.path.length) {
          const p = d.path[d.pathI];
          const r = Math.max(2.5, d.inst.tpl.length * 0.4);
          if (hdist(d.pos, p) < r) d.pathI++;
          const spd = d.playerTarget ? approachSpeed(d) : stalkSpeed(d);
          steer(d, p, spd, dt);
          break;
        }
        if (!d.playerTarget) { steer(d, d.target, stalkSpeed(d), dt, { arrive: 1 }); break; }
        if (d.species === 'rex') { rexStalk(d, dt, dPlayer); break; }
        huntGoal(d, _goal);
        if (d.species === 'raptor' && b.cooldown > 0 && dPlayer < 13) {
          // circle at a respectful distance while recovering the nerve
          const ang = Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z) + d.strafe * 0.6;
          _goal.set(pp.x + Math.sin(ang) * 11, 0, pp.z + Math.cos(ang) * 11);
          steer(d, _goal, sp.walk * 1.6, dt, { turnBoost: 2 });
          break;
        }
        if (d.species === 'dilo') { steer(d, _goal, dPlayer > b.stopDist + 10 ? runSp * 0.75 : sp.walk, dt, { arrive: Math.max(0, b.stopDist - 1) }); break; }
        if (d.species === 'trike') { steer(d, _goal, dPlayer > 70 ? 4.5 : sp.walk * 1.4, dt, { arrive: Math.max(0, b.chargeDist - 1) }); break; }
        steer(d, _goal, approachSpeed(d), dt);
        break;
      }
      case 'reached': case 'graze': case 'hesitate': case 'wait': case 'roar':
        accel(d, 0, dt);
        if (b.state === 'hesitate' && d.lookAt) turnTo(d, Math.atan2(d.lookAt.x - d.pos.x, d.lookAt.z - d.pos.z), dt, 2);
        if (b.state === 'roar') turnTo(d, Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z), dt, 1.2);
        break;
      case 'wander': {
        if (!d.wanderTo || hdist(d.pos, d.wanderTo) < 2) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * (sp.wander || 20);
          d.wanderTo = new T.Vector3(d.home.x + Math.sin(a) * r, 0, d.home.z + Math.cos(a) * r);
        }
        steer(d, d.wanderTo, sp.walk * (d.variant === 'apato' ? 1.2 : 1), dt, { arrive: 1 });
        break;
      }
      case 'flee': {
        const from = d.fleeFrom || pp;
        const ax = d.pos.x - from.x, az = d.pos.z - from.z, l = Math.hypot(ax, az) || 1;
        _goal.set(d.pos.x + ax / l * 20, 0, d.pos.z + az / l * 20);
        if (d.species === 'grazer' && hdist(d.pos, d.home) > 70) _goal.lerp(d.home, 0.5);
        steer(d, _goal, d.species === 'grazer' ? sp.run : runSp * 0.9, dt);
        break;
      }
      case 'stagger':
        accel(d, 0, dt);
        break;
      case 'stumble': {
        // a charge collapses: slide, roll onto the shoulder, get back up
        accel(d, 0, dt * 0.45);
        const t = b.t, D = b.dur;
        const roll = t < 0.45 ? t / 0.45 : t > D - 0.7 ? Math.max(0, (D - t) / 0.7) : 1;
        d.roll = roll * 0.38 * d.strafe; d.crouch = roll * 0.8;
        break;
      }
      case 'recover': {
        d.roll *= Math.exp(-dt * 4);
        if (d.species === 'raptor' || d.species === 'dilo') {
          const ang = Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z) + d.strafe * 0.9;
          const R = d.species === 'raptor' ? 13 : b.stopDist + 4;
          _goal.set(pp.x + Math.sin(ang) * R, 0, pp.z + Math.cos(ang) * R);
          steer(d, _goal, d.species === 'raptor' ? runSp * 0.6 : sp.walk, dt, { turnBoost: 2.5 });
        } else if (d.species === 'trike' || d.species === 'rex') {
          // run on past, veer off and slow down; then it turns and walks back out
          if (b.t < 0.05) d.veer = d.heading + d.strafe * 1.0;
          turnTo(d, d.veer, dt, 1.2);
          accel(d, b.t < 1.2 ? d.speed : sp.walk, dt * 0.6);
        } else accel(d, 0, dt);
        break;
      }
      case 'telegraph': telegraphMove(d, dt, dPlayer); break;
      default: accel(d, 0, dt);
    }
    if (b.state !== 'telegraph') { d.crouch *= Math.exp(-dt * 6); d.rear *= Math.exp(-dt * 5); }
    if (b.state !== 'stumble' && b.state !== 'recover') d.roll *= Math.exp(-dt * 5);
    d.neckPitch += ((b.state === 'roar' ? 0.75 : 0) - d.neckPitch) * Math.min(1, dt * 4);
    if (!(b.state === 'telegraph' && b.kind === 'charge')) d.headDown += ((b.state === 'graze' ? (d.variant === 'apato' ? 0.15 : 0.45) : 0) - d.headDown) * Math.min(1, dt * 2);
    if (!d.leap) advance(d, dt);
  }
  function approachSpeed(d) {
    const b = d.brain, sp = d.sp;
    if (d.species === 'raptor') return b.aggro >= 0.5 ? sp.run * (0.7 + 0.3 * b.aggro) : sp.walk + (sp.run * 0.6 - sp.walk) * b.aggro * 2;
    if (d.species === 'rex') return sp.walk * (b.rage ? 1.4 : 1);
    return sp.walk * 1.4;
  }
  function stalkSpeed(d) { return d.sp.walk + (d.sp.run * 0.5 - d.sp.walk) * d.brain.aggro; }
  function rexStalk(d, dt, dPlayer) {
    const pp = playerPos(), b = d.brain;
    if (dPlayer < 12) { huntGoal(d, _goal); steer(d, _goal, d.sp.walk * 1.5, dt, { arrive: 5 }); return; }
    if (d.circle.length > 1) {
      if (d.circleI === 0 && !d.onCircle) { // join the loop at the nearest point
        let best = 0, bd = Infinity; d.circle.forEach((p, i) => { const dd = hdist(p, d.pos); if (dd < bd) { bd = dd; best = i; } });
        d.circleI = best; d.onCircle = true;
      }
      const p = d.circle[d.circleI % d.circle.length];
      if (hdist(d.pos, p) < 4) d.circleI = (d.circleI + 1) % d.circle.length;
      steer(d, p, approachSpeed(d), dt);
      return;
    }
    // no loop given: pace sideways at stalking distance
    const R = 28, ang = Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z) + d.strafe * 0.35;
    _goal.set(pp.x + Math.sin(ang) * R, 0, pp.z + Math.cos(ang) * R);
    steer(d, _goal, approachSpeed(d), dt);
  }
  function telegraphMove(d, dt, dPlayer) {
    const b = d.brain, sp = d.sp, pp = playerPos();
    const yawP = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z);
    const tMs = b.t * 1000, a = b.kind === 'bite' ? sp.bite : sp.attack;
    switch (b.kind) {
      case 'leap': {
        // crouch, then spring at the stand
        const crouchMs = a.telegraphMs - 260;
        if (tMs < crouchMs) {
          accel(d, 0, dt * 2); turnTo(d, yawP, dt, 8);
          d.crouch = Math.min(1, d.crouch + dt * 5);
        } else {
          if (!d.leap) {
            const land = new T.Vector3(pp.x, 0, pp.z).sub(_w.set(d.pos.x, 0, d.pos.z)).normalize();
            const end = new T.Vector3(pp.x - land.x * 1.6, 0, pp.z - land.z * 1.6);
            end.y = Math.max(groundAt(end.x, end.z), pp.y - 1.75);
            d.leap = { from: d.pos.clone(), to: end, t: 0, dur: (a.telegraphMs - crouchMs) / 1000 };
            oneShot(d, 'Jump', { rate: 1.6, startAt: 0.25 });
          }
          d.crouch = Math.max(0, d.crouch - dt * 6);
          const L = d.leap; L.t += dt; const u = Math.min(1, L.t / L.dur);
          d.pos.lerpVectors(L.from, L.to, u); d.pos.y += Math.sin(Math.PI * u) * 1.3;
          d.speed = 0; turnTo(d, yawP, dt, 8);
        }
        break;
      }
      case 'spit': {
        accel(d, 0, dt * 2); turnTo(d, yawP, dt, 4);
        const k = Math.min(1, tMs / a.telegraphMs);
        d.rear = Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.5) * (tMs < a.telegraphMs + 250 ? 1 : 0.4);
        d.neckPitch = 0.4 * d.rear;
        break;
      }
      case 'charge': {
        if (tMs < a.telegraphMs) {
          // paw the ground and lower the head
          accel(d, 0, dt * 2); turnTo(d, yawP, dt, 2.5);
          d.headDown = Math.min(1, d.headDown + dt * 2.2);
          d.chargeDir = d.heading;
        } else {
          if (!d.charging) { d.charging = true; voice(d, d.species === 'rex' ? 'roar' : 'tele', 1); }
          const remain = Math.max(0.05, (b.windowMs - tMs) / 1000);
          const need = Math.max(0, dPlayer - a.reach * 0.6) / remain;
          turnTo(d, yawP, dt, 1.1); // only a little homing: a committed charge
          const want = Math.min(a.maxSpeed * 1.6, need * 1.08);
          d.speed = want > d.speed ? Math.min(want, d.speed + 24 * dt) : Math.max(want, d.speed - 10 * dt);
          d.headDown = Math.min(1, d.headDown + dt * 2);
        }
        break;
      }
      case 'bite': {
        turnTo(d, yawP, dt, 2); accel(d, dPlayer > 6 ? 3 : 0, dt);
        if (tMs > a.telegraphMs - 480 && !d.bitePlayed) { d.bitePlayed = true; oneShot(d, 'Attack', { rate: 1.1 }); }
        d.neckPitch = tMs < a.telegraphMs - 300 ? 0.35 : -0.2;
        break;
      }
    }
  }
  function flyer(d, dt) {
    const b = d.brain, f = d.fly, pp = playerPos();
    const gy = groundAt(pp.x, pp.z);
    if (!d.alive) { // falling
      d.vel.y -= 9.8 * dt; d.vel.multiplyScalar(Math.exp(-dt * 0.4));
      d.pos.addScaledVector(d.vel, dt);
      const g = groundAt(d.pos.x, d.pos.z);
      if (d.pos.y <= g) { if (!d.landed) { d.landed = true; sfx('stomp2', d.pos, 0.5, 1.4); } d.pos.y = g; d.vel.set(0, 0, 0); }
      d.pitch += (0 - d.pitch) * Math.min(1, dt * 2); d.roll *= Math.exp(-dt * 2);
      return;
    }
    if (b.state === 'telegraph') {
      if (!f.swoop) {
        const end = pp.clone(); end.y += 1.1;
        const ctrl = d.pos.clone().lerp(end, 0.55); ctrl.y = end.y + 2;
        f.swoop = { p0: d.pos.clone(), p1: ctrl, p2: end, dur: b.windowMs / 1000 };
      }
      const S = f.swoop, u = Math.pow(Math.min(1, b.t / S.dur), 1.7), iu = 1 - u;
      const prev = d.pos.clone();
      d.pos.set(0, 0, 0).addScaledVector(S.p0, iu * iu).addScaledVector(S.p1, 2 * iu * u).addScaledVector(S.p2, u * u);
      d.vel.subVectors(d.pos, prev).divideScalar(Math.max(dt, 1e-4));
      if (b.t * 1000 > b.windowMs - 450 && !d.clawed) { d.clawed = true; oneShot(d, 'Attack', { rate: 1.3 }); }
    } else if (b.state === 'recover' || b.state === 'flee') {
      // pull up and away
      if (f.swoop) { f.climbV.copy(d.vel).setY(0).setLength(9); f.swoop = null; d.clawed = false; } // pull up, but stay in the fight
      const climbTo = gy + f.alt + (b.state === 'flee' ? 15 : 0);
      d.vel.x += (f.climbV.x - d.vel.x) * dt; d.vel.z += (f.climbV.z - d.vel.z) * dt;
      d.vel.y += ((d.pos.y < climbTo ? 7 : 0) - d.vel.y) * Math.min(1, dt * 2);
      d.pos.addScaledVector(d.vel, dt);
    } else {
      // circle in wide arcs out in FRONT of the stand (never for long behind the player), rising and falling a little
      const sy = ctx.view && ctx.view.stand ? ctx.view.stand.yaw : d.heading;
      const cx = pp.x - Math.sin(sy) * 30, cz = pp.z - Math.cos(sy) * 30, ang = Math.atan2(d.pos.x - cx, d.pos.z - cz) + f.dir * dt * (d.sp.fly / f.radius);
      const R = f.radius + Math.sin(ctx.time * 0.3 + d.id) * 6;
      _goal.set(cx + Math.sin(ang) * R, gy + f.alt + Math.sin(ctx.time * 0.5 + d.id) * 3, cz + Math.cos(ang) * R);
      const want = _w.subVectors(_goal, d.pos);
      const l = want.length(); if (l > 1e-3) want.multiplyScalar(Math.min(d.sp.fly * 1.4, l * 1.5) / l);
      d.vel.lerp(want, Math.min(1, dt * 1.5));
      d.pos.addScaledVector(d.vel, dt);
    }
    // face the velocity, bank into turns
    const hv = Math.hypot(d.vel.x, d.vel.z);
    if (hv > 0.5) {
      const yaw = Math.atan2(d.vel.x, d.vel.z), dy = angDiff(d.heading, yaw);
      d.heading += dy * Math.min(1, dt * 4);
      f.bank += (Math.max(-0.7, Math.min(0.7, -dy * 3)) - f.bank) * Math.min(1, dt * 3);
    }
    d.roll = f.bank;
    d.pitch += (Math.max(-0.6, Math.min(0.6, -Math.atan2(d.vel.y, Math.max(1, hv)))) - d.pitch) * Math.min(1, dt * 3);
    d.speed = hv;
  }

  // ------------------------------------------------------------------ the update
  function update(dt, c) {
    ctx = c || ctx; if (!ctx) return;
    const L = LOGIC(); if (!L) return;
    const pp = playerPos();
    for (let i = dinos.length - 1; i >= 0; i--) {
      // an attack can kill the player mid-loop, and the mission's retry then resets every dino
      if (i >= dinos.length) continue;
      const d = dinos[i], b = d.brain;
      if (!d.alive) { corpse(d, dt, i); continue; }
      // senses
      let dist;
      if (!d.playerTarget) dist = hdist(d.pos, d.pathI < d.path.length ? d.path[d.path.length - 1] : d.target);
      else dist = hdist(d.pos, pp);
      if (!d.playerTarget && d.pathI < d.path.length) dist = Math.max(dist, 4); // not there until the path is done
      // one attack at a time: two leaps landing together cannot both be dodged, so the others hold off
      if (d.playerTarget && b.state !== 'telegraph' && dinos.some(e => e !== d && e.alive && e.playerTarget && e.brain.state === 'telegraph')) b.cooldown = Math.max(b.cooldown, 0.35);
      const s = { dist, pathDone: d.pathI >= d.path.length, packLoss: d.packLoss, alarmed: d.alarmed };
      d.packLoss = false; d.alarmed = false;
      const acts = L.step(b, s, dt);
      for (const a of acts) { act(d, a); if (dinos[i] !== d) break; }
      if (dinos[i] !== d || !d.alive) continue;
      if (b.state === 'wait') continue;
      locomote(d, dt);
      placeRoot(d, dt);
      d.hp = b.hp;
      animate(d, dt);
      d.root.updateMatrixWorld(true);
      procedural(d, dt);
      d.root.updateMatrixWorld(true);
      vocal(d, dt);
      steps(d);
      if (d.inst.collar) d.inst.collar.userData.led.visible = (ctx.time + d.id * 0.37) % 1.8 < 0.09;
    }
    updateSpits(dt);
  }

  function act(d, a) {
    const b = d.brain;
    switch (a.type) {
      case 'appear': d.root.visible = true; voice(d, 'idle', 0.8); break;
      case 'attack': {
        d.leap = null; d.charging = false; d.bitePlayed = false; d.spitPopped = false;
        if (d.species === 'ptero' && d.fly) d.fly.swoop = null;
        if (a.kind === 'leap' || a.kind === 'spit' || a.kind === 'bite') voice(d, 'tele');
        if (a.kind === 'swoop') voice(d, 'tele');
        if (a.kind === 'charge') { sfx(d.species === 'rex' ? 'rex_growl2' : 'trike_snort1', d.pos, 0.9, d.species === 'rex' ? 0.8 : 0.65, 14); oneShot(d, 'Attack', { rate: 0.7, weight: 0.45 }); }
        if (a.kind === 'spit') oneShot(d, 'Attack', { rate: 0.7, weight: 0.6 });
        if (DH.bus) DH.bus.emit('dino:attack', { dino: d, kind: a.kind, dodgeable: a.dodgeable, duckable: a.duckable, windowMs: a.windowMs });
        break;
      }
      case 'spit': launchSpit(d); break;
      case 'strike': {
        d.leap = null; d.charging = false;
        if (a.kind === 'leap') { oneShot(d, 'Attack', { rate: 1.2 }); }
        if (a.kind === 'bite') sfx('flesh_tear', headPos(d), 0.5, 1, 6);
        if (a.kind === 'spit' && d.spitPopped) { d.spitPopped = false; break; } // shot out of the air
        if (a.inReach && d.alive && ctx.strike) {
          const r = ctx.strike({ damage: a.damage, dodgeable: a.dodgeable, duckable: a.duckable, kind: a.kind, from: d.pos.clone(), species: d.species });
          if (r && r.result === 'hit' && (a.kind === 'charge' || a.kind === 'bite')) ctx.addShake && ctx.addShake(0.9);
        }
        if (a.kind === 'leap') { // land in front of the stand and spring back out
          d.knock.set(d.pos.x - playerPos().x, 0, d.pos.z - playerPos().z).setLength(6);
        }
        break;
      }
      case 'roar': voice(d, 'roar'); oneShot(d, 'Attack', { rate: 0.45, weight: 0.5 }); if (ctx.addShake && hdist(d.pos, playerPos()) < 50) ctx.addShake(0.35); if (DH.bus) DH.bus.emit('dino:roar', { dino: d, dist: hdist(d.pos, playerPos()) }); break;
      case 'reached': if (DH.bus) DH.bus.emit('dino:reached', { dino: d, point: d.target.clone() }); voice(d, 'idle'); break;
      case 'alarm': voice(d, 'alarm'); break;
      case 'state':
        if (a.to === 'hesitate') { voice(d, 'idle', 0.7); }
        if (a.to === 'stumble') { sfx('stomp1', d.pos, 1, 0.6, 14); sfx('stomp2', d.pos, 0.9, 0.7, 14); voice(d, 'hurt'); if (ctx.addShake && hdist(d.pos, playerPos()) < 30) ctx.addShake(0.5); if (DH.Fx && DH.Fx.impact) DH.Fx.impact(d.pos.clone().setY(d.pos.y + 0.3), UP.clone(), 'dirt'); }
        if (a.from === 'telegraph') { d.leap = null; d.charging = false; }
        if (a.to === 'wander') d.wanderTo = null;
        break;
    }
    void b;
  }

  // ------------------------------------------------------------------ sounds while alive
  function vocal(d, dt) {
    d.voxT -= dt;
    const st = d.brain.state;
    if (d.voxT <= 0) {
      const v = VOX[d.species];
      d.voxT = rnd(v.every[0], v.every[1]);
      if (st === 'approach' || st === 'graze' || st === 'wander' || st === 'circle' || st === 'reached' || st === 'recover') voice(d, 'idle');
    }
  }
  function steps(d) {
    if (!(d.species === 'rex' || d.species === 'trike' || d.variant === 'apato')) return;
    const A = d.actions, run = d.weights.Run > d.weights.Walk;
    const a = run ? A.Run : A.Walk; if (!a || (d.weights.Run + d.weights.Walk) < 0.3) return;
    const ph = (a.time / a.getClip().duration) * 2 % 1;
    if (ph < d.stepPhase) {
      const dp = hdist(d.pos, playerPos());
      sfx(Math.random() < 0.5 ? 'stomp1' : 'stomp2', d.pos, (d.species === 'rex' ? 0.9 : 0.55) * (run ? 1.2 : 0.8), d.species === 'rex' ? 0.6 : 0.8, d.species === 'rex' ? 16 : 10);
      if (d.species === 'rex' && dp < 45 && ctx.addShake) ctx.addShake(0.12 * (1 - dp / 45) * (run ? 2 : 1));
      // the phone feels the big ones walking (feel.js)
      const feelR = d.species === 'rex' ? 60 : 30;
      if (dp < feelR && DH.bus) DH.bus.emit('dino:step', { dino: d, near: (1 - dp / feelR) * (run ? 1 : 0.6) });
    }
    d.stepPhase = ph;
  }

  // ------------------------------------------------------------------ spit projectiles
  let spitGeo = null, spitMat = null;
  function launchSpitMat() {
    spitGeo = new T.SphereGeometry(0.2, 12, 10);
    spitMat = new T.MeshStandardMaterial({ color: 0xc8e04a, emissive: 0x6a8a10, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.92, fog: false });
  }
  function launchSpit(d) {
    if (!spitGeo) launchSpitMat();
    const from = headPos(d), b = d.brain, sp = d.sp;
    const remain = Math.max(0.15, (b.windowMs - b.t * 1000) / 1000);
    const to = playerPos().clone(); to.y -= 0.15; to.x += rnd(-0.25, 0.25);
    const g = new T.Group();
    for (let i = 0; i < 5; i++) { const m = new T.Mesh(spitGeo, spitMat); m.scale.setScalar(1 - i * 0.16); g.add(m); }
    ctx.scene.add(g);
    spits.push({ g, from, to, t: 0, dur: remain, arc: Math.min(3, from.distanceTo(to) * 0.08), dino: d, pos: from.clone() });
    sfx(pick(['spit1', 'spit2', 'spit3']), from, 0.9, rnd(0.9, 1.1), 6);
    void sp;
  }
  function updateSpits(dt) {
    for (let i = spits.length - 1; i >= 0; i--) {
      const s = spits[i]; s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      s.g.children.forEach((m, k) => {
        const uu = Math.max(0, u - k * 0.025);
        m.position.lerpVectors(s.from, s.to, uu); m.position.y += Math.sin(Math.PI * uu) * s.arc;
        if (k === 0) s.pos.copy(m.position);
      });
      if (u >= 1) {
        ctx.scene.remove(s.g); spits.splice(i, 1);
        if (DH.Fx && DH.Fx.impact) DH.Fx.impact(s.to.clone(), new T.Vector3(0, 0, 1), 'water');
      }
    }
  }

  // ------------------------------------------------------------------ corpses
  function corpse(d, dt, i) {
    d.corpseT += dt;
    if (d.corpseT > 0.4) d.deathPose = true;
    if (d.species === 'ptero') { flyer(d, dt); placeRoot(d, dt); }
    else if (d.speed > 0.05 || d.knock.lengthSq() > 0.01) {
      // momentum carries a running animal on
      d.speed = Math.max(0, d.speed - dt * (d.species === 'trike' || d.species === 'rex' ? 7 : 12));
      advance(d, dt); placeRoot(d, dt);
    }
    if (d.corpseT < 6) {
      animate(d, dt);
      d.root.updateMatrixWorld(true);
      d.flinch = Math.max(0, d.flinch - dt * 3);
    }
    if (!d.thud && d.corpseT > (d.species === 'ptero' ? 99 : 0.75)) {
      d.thud = true;
      const big = d.species === 'rex' || d.species === 'trike' || d.variant === 'apato';
      sfx('stomp1', d.pos, big ? 1 : 0.45, big ? 0.55 : 1.2, big ? 16 : 6);
      if (big && ctx.addShake && hdist(d.pos, playerPos()) < 40) ctx.addShake(0.4);
    }
    if (d.corpseT > 20) {
      // settle into the undergrowth, then go
      const k = (d.corpseT - 20) / 5;
      d.inst.inner.position.y = d.inst.tpl.groundOffset - k * Math.max(0.6, d.inst.tpl.height * 0.6);
      if (k >= 1) { ctx.scene.remove(d.root); dinos.splice(i, 1); }
    }
  }

  function die(d, zone, dir, byPlayer) {
    if (!d.alive) return;
    d.alive = false; d.hp = 0; d.brain.state = 'dead'; d.lastHitZone = zone;
    d.leap = null;
    if (d.species === 'ptero') { d.vel.copy(d.vel.lengthSq() > 1 ? d.vel : _v.set(Math.sin(d.heading) * 8, 0, Math.cos(d.heading) * 8)); }
    oneShot(d, 'Death', { hold: true, rate: d.species === 'rex' ? 0.8 : 1 });
    d.deathPose = false;
    if (d.inst.collar) d.inst.collar.userData.led.visible = false;
    voice(d, 'die');
    // the pack falters
    if (d.pack) dinos.forEach(e => { if (e !== d && e.alive && e.pack === d.pack) { e.packLoss = true; e.lookAt = d.pos.clone(); } });
    alarmNear(d.pos, 45);
    if (DH.bus) DH.bus.emit('dino:dead', { dino: d, species: d.species, tagged: d.tagged, zone, byPlayer: byPlayer !== false });
    void dir;
  }
  function alarmNear(p, r) {
    for (const e of dinos) if (e.alive && e.species === 'grazer' && hdist(e.pos, p) < r) { e.alarmed = true; e.fleeFrom = playerPos().clone(); }
  }

  // ------------------------------------------------------------------ raycast
  const _o = { x: 0, y: 0, z: 0 }, _d = { x: 0, y: 0, z: 0 };
  function raycast(origin, dir, maxDist) {
    const L = LOGIC(); if (!L) return null;
    maxDist = maxDist || 1000;
    _o.x = origin.x; _o.y = origin.y; _o.z = origin.z; _d.x = dir.x; _d.y = dir.y; _d.z = dir.z;
    let best = null;
    for (const d of dinos) {
      if (!d.alive || !d.root.visible) continue;
      const tpl = d.inst.tpl;
      _w.copy(d.pos); if (d.species !== 'ptero') _w.y += tpl.height * 0.5;
      if (L.raySphere(_o, _d, _w, tpl.radius * 1.3 + 0.5) < 0) continue;
      let tb = Infinity, hb = null;
      // forgiveness that grows with range: a phone held at arm's length cannot hold a 30 cm body
      // capsule at 140 m, so far animals get a slightly fatter hitbox (+15 cm at 100 m, max +30 cm)
      const extra = Math.min(0.3, Math.hypot(_w.x - _o.x, _w.y - _o.y, _w.z - _o.z) * 0.0015);
      for (const h of d.inst.hit) {
        const mw = h.bone.matrixWorld;
        if (h.s == null) h.s = mw.getMaxScaleOnAxis();
        _a.copy(h.a).applyMatrix4(mw); _b.copy(h.b).applyMatrix4(mw);
        const t = L.rayCapsule(_o, _d, _a, _b, h.r * h.s + extra);
        if (t >= 0 && t < tb) { tb = t; hb = h; h.wa = h.wa || new T.Vector3(); h.wb = h.wb || new T.Vector3(); h.wa.copy(_a); h.wb.copy(_b); }
      }
      let part = hb && hb.part, special = null;
      for (const s of d.inst.specials) {
        const mw = s.bone.matrixWorld; if (s.s == null) s.s = mw.getMaxScaleOnAxis();
        _a.copy(s.c).applyMatrix4(mw);
        const t = L.raySphere(_o, _d, _a, s.r * s.s);
        if (t >= 0 && (t < tb + s.r * s.s * 2.5)) { if (!special || (s.part === 'eye' && special.s.part !== 'eye') || (s.part === special.s.part && t < special.t)) special = { t, s, c: _a.clone() }; }
      }
      let t = tb, normal;
      const point = new T.Vector3();
      if (special) {
        t = special.t; part = special.s.part;
        point.copy(origin).addScaledVector(dir, t);
        normal = point.clone().sub(special.c).normalize();
      } else if (hb) {
        point.copy(origin).addScaledVector(dir, t);
        const u = L.segParam(point, hb.wa, hb.wb);
        normal = point.clone().sub(_v.copy(hb.wa).lerp(hb.wb, u)).normalize();
      } else continue;
      if (t > maxDist || (best && t >= best.dist)) continue;
      // the normal in the animal's frame for armour / flank
      const inv = d.root.getWorldQuaternion(_q).invert();
      const nl = normal.clone().applyQuaternion(inv);
      const zone = L.classifyZone(d.species, part, nl, { roaring: d.brain.state === 'roar' });
      best = { dino: d, zone, point, normal, dist: t };
    }
    return best;
  }

  // ------------------------------------------------------------------ damage
  function damage(d, amount, zone, dir) {
    const L = LOGIC();
    if (!d || !d.alive || !L) return { killed: false, damage: 0 };
    zone = zone || 'body';
    const r = L.applyDamage(d.brain, amount, zone);
    d.hp = d.brain.hp;
    if (DH.bus) DH.bus.emit('dino:hit', { dino: d, zone, damage: r.damage });
    const hp = headPos(d);
    sfx(Math.random() < 0.5 ? 'flesh1' : 'flesh2', zone === 'armor' ? d.pos : hp, zone === 'armor' ? 0.4 : 0.7, rnd(0.85, 1.1), 4);
    // procedural hit reaction: flinch away from the shot, knock back on big hits
    const sd = dir ? _w.copy(dir).setY(0) : _w.set(0, 0, 1);
    if (sd.lengthSq() < 1e-6) sd.set(0, 0, 1);
    sd.normalize();
    d.flinchAxis.crossVectors(UP, sd).normalize();
    d.flinch = Math.min(1, Math.max(d.flinch, r.flinch || 0.3));
    const mass = d.species === 'rex' || d.species === 'trike' ? 0.15 : d.species === 'grazer' ? 0.3 : 1;
    if (r.stagger || r.killed) d.knock.addScaledVector(sd, (r.killed ? 2.5 : 3.5) * mass);
    if (r.stagger && d.species === 'rex') { voice(d, 'hurt', 1.2); }
    else if (!r.killed && Math.random() < 0.5) voice(d, 'hurt');
    if (d.species === 'grazer') alarmNear(d.pos, 35);
    if (r.killed) die(d, zone, dir, true);
    return { killed: !!r.killed, damage: r.damage };
  }

  // ------------------------------------------------------------------ bus hooks
  function hook() {
    if (!DH.bus || hook.done) return; hook.done = true;
    DH.bus.on('shot:miss', e => { if (e && e.point) alarmNear(e.point, 22); });
  }

  // ------------------------------------------------------------------ public
  function reset(c) {
    ctx = c || ctx;
    for (const d of dinos) if (d.root.parent) d.root.parent.remove(d.root);
    dinos.length = 0;
    for (const s of spits) if (s.g.parent) s.g.parent.remove(s.g);
    spits.length = 0;
  }
  /** A shot through a spit glob pops it (generous: the glob is hard to hit). Returns its point or null. */
  function shootSpit(origin, dir, maxDist) {
    const L = LOGIC(); let best = null, bt = maxDist || 400;
    for (const s of spits) {
      const t = L.raySphere(origin, dir, s.pos, 0.7);
      if (t >= 0 && t < bt) { bt = t; best = s; }
    }
    if (!best) return null;
    spits.splice(spits.indexOf(best), 1); ctx.scene.remove(best.g);
    if (best.dino) best.dino.spitPopped = true;
    if (DH.Fx && DH.Fx.impact) DH.Fx.impact(best.pos.clone(), dir.clone().negate(), 'water');
    if (DH.bus) DH.bus.emit('spit:popped', { point: best.pos.clone(), dino: best.dino });
    return { point: best.pos.clone(), dist: bt };
  }
  /** The live animal a missed shot passed closest to, if it was within ~a body width. */
  function nearMiss(origin, dir, maxDist) {
    let best = null, bd = Infinity;
    for (const d of dinos) {
      if (!d.alive || !d.root.visible || d.species === 'grazer') continue;
      _w.copy(d.pos); if (d.species !== 'ptero') _w.y += d.inst.tpl.height * 0.5;
      const t = _a.copy(_w).sub(origin).dot(dir);
      if (t < 0 || t > (maxDist || 400)) continue;
      const miss = _b.copy(origin).addScaledVector(dir, t).distanceTo(_w);
      const lim = d.inst.tpl.height * 0.5 + 1.2;
      if (miss < lim && miss < bd) { bd = miss; best = d; }
    }
    return best;
  }
  /** Build one of each look a mission will spawn, so their shaders compile behind the loading
   * screen and not when the first raptor jumps out. Returns the temporary roots (caller removes). */
  function prewarmRoots(speciesList) {
    const K = LOOK(), out = [];
    if (!K) return out;
    (speciesList || []).forEach(sp => (VARIANTS[sp] || []).forEach(v => {
      for (const tagged of [false, true]) {
        const inst = K.instance(v, { tagged }); if (!inst) continue;
        if (sp !== 'ptero') inst.root.add(contactShadow(inst.tpl));
        out.push(inst.root);
      }
    }));
    if (!spitGeo) { launchSpitMat(); }
    out.push(new T.Mesh(spitGeo, spitMat));
    return out;
  }
  function count(f) {
    f = f || {};
    return dinos.filter(d => (f.species == null || d.species === f.species) && (f.alive == null || d.alive === f.alive) && (f.tagged == null || d.tagged === f.tagged)).length;
  }
  DH.Dinos = {
    init(c) { ctx = c; hook(); },
    reset, spawn, update, raycast, damage, count, shootSpit, nearMiss, prewarmRoots,
    list: () => dinos.slice(),
  };
})();
