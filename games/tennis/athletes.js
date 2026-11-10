/*
 * Sunvolley — skinned athletes (CC0 Quaternius characters, see CREDITS.md) and the crowd made
 * from the same characters.
 *
 * An athlete keeps the procedural athlete's interface (root, racket, addTo, setVisible) so the
 * game can swap it in once the models have loaded. Legs and body come from the model's own
 * idle / run clips; the racket arm is posed every frame from the player's real arm (the arm model
 * fed by the phone): the upper arm aims at the elbow, the forearm at the hand, and the racket sits
 * in the hand with the phone's exact orientation.
 *
 * The crowd: every spectator is a camera-facing impostor (two triangles) cut from an atlas that is
 * rendered once at start from the same characters in a seated pose, each cell with its own kit.
 */
(function () {
  'use strict';
  const TN = window.TN = window.TN || {};
  const T = THREE;
  const FILES = { m: 'assets/models/athlete_m.glb', f: 'assets/models/athlete_f.glb', f2: 'assets/models/athlete_f2.glb' };
  const SHOULDER_H = 1.62;    // world height of the racket shoulder the arm model hangs from (game.js)

  const Rig = TN.Rig = { ready: false, gltf: {}, _cbs: [], failed: false };
  Rig.onReady = cb => { if (Rig.ready) cb(); else Rig._cbs.push(cb); };

  function load() {
    const go = () => {
      const loader = new T.GLTFLoader();
      const keys = Object.keys(FILES);
      Promise.all(keys.map(k => new Promise((res, rej) => loader.load(FILES[k], g => res([k, g]), undefined, rej))))
        .then(list => {
          list.forEach(([k, g]) => { Rig.gltf[k] = g; });
          Rig.ready = true;
          Rig._cbs.splice(0).forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
        })
        .catch(e => { Rig.failed = true; console.warn('Sunvolley: athlete models did not load, keeping the simple athletes', e); });
    };
    if (T.GLTFLoader) go(); else addEventListener('three-loaders', go, { once: true });
  }
  load();

  const clipOf = (g, name) => g.animations.find(c => c.name.split('|').pop().replace(/^(Man|Female)_/, '') === name) || null;

  // ---------------------------------------------------------------------------------
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion();
  /** Turn `bone` (in world space) so that `child` moves toward `target`. */
  function aimBone(bone, child, target) {
    bone.getWorldPosition(_a); child.getWorldPosition(_b);
    _b.sub(_a); _c.copy(target).sub(_a);
    if (_b.lengthSq() < 1e-10 || _c.lengthSq() < 1e-10) return;
    _q.setFromUnitVectors(_b.normalize(), _c.normalize());
    bone.parent.getWorldQuaternion(_q2);
    _q3.copy(_q2).invert().multiply(_q).multiply(_q2);
    bone.quaternion.premultiply(_q3);
    bone.updateMatrixWorld(true);
  }
  /** Extra rotation of a bone about a world axis (twist the torso, lean). */
  function turnBone(bone, axis, angle) {
    _q.setFromAxisAngle(axis, angle);
    bone.parent.getWorldQuaternion(_q2);
    _q3.copy(_q2).invert().multiply(_q).multiply(_q2);
    bone.quaternion.premultiply(_q3);
  }

  /**
   * kit: { body: 'm'|'f'|'f2', shirt, shorts, accent, skin?, hair?, racket, grip }.
   */
  function makeRigAthlete(kit) {
    const g = Rig.gltf[kit.body] || Rig.gltf.m;
    const model = T.SkeletonUtils.clone(g.scene);
    const mats = {};
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { (mats[m.name] = mats[m.name] || []).push(m); m.roughness = Math.max(0.55, m.roughness || 0.8); m.metalness = 0; });
    });
    const bone = n => model.getObjectByName(n);
    // both arms: the racket arm is the player's playing hand (st.hand), the other follows the clips
    const arms = { right: { upper: bone('UpperArmR'), lower: bone('LowerArmR'), palm: bone('PalmR') },
      left: { upper: bone('UpperArmL'), lower: bone('LowerArmL'), palm: bone('PalmL') } };
    if (!arms.left.upper || !arms.left.lower || !arms.left.palm) arms.left = arms.right;
    const B = { arms, upper: arms.right.upper, lower: arms.right.lower, palm: arms.right.palm, torso: bone('Torso'), hips: bone('Hips'), head: bone('Head'), shoulder: bone('ShoulderR'),
      legs: [['UpperLegL', 'LowerLegL'], ['UpperLegR', 'LowerLegR']].map(([u, l]) => [bone(u), bone(l)]).filter(x => x[0] && x[1]) };
    // scale so the racket shoulder stands where the game's arm model hangs it
    model.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(model);
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
    const sh = B.upper.getWorldPosition(new T.Vector3());
    const k = SHOULDER_H / Math.max(0.3, sh.y);
    const holder = new T.Group(); holder.add(model);
    holder.scale.setScalar(k);
    holder.rotation.y = Math.PI;            // the models face +z; athletes face -z at rest
    const root = new T.Group(); root.add(holder);
    const racket = TN.makeRacket(kit.racket, kit.grip);
    racket.scale.setScalar(1.08);
    racket.traverse(m => { if (m.isMesh) m.castShadow = true; });
    const mixer = new T.AnimationMixer(model);
    const act = n => { const c = clipOf(g, n); if (!c) return null; const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); return a; };
    const idle = act('Idle'), run = act('Run');
    if (idle) idle.setEffectiveWeight(1);
    const A = {
      rig: true, root, racket, model, mixer, idle, run, B, mats, kitBody: kit.body,
      addTo(scene) { scene.add(root, racket); },
      setVisible(v) { root.visible = v; racket.visible = v; },
      paint(c) {
        const set = (n, col) => (mats[n] || []).forEach(m => m.color.setHex(col).convertSRGBToLinear());
        if (c.shirt !== undefined) set('Shirt', c.shirt);
        if (c.shorts !== undefined) set('Pants', c.shorts);
        if (c.accent !== undefined) { set('Shoes', c.accent); set('Socks', 0xf4f4f4); }
        if (c.skin !== undefined) set('Skin', c.skin);
        if (c.hair !== undefined) { set('Hair', c.hair); set('HairBase', c.hair); }
      },
    };
    // bones this code turns: back to the clip's pose every frame (a bone a clip does not animate
    // would otherwise keep every frame's extra turn)
    A.rest = [B.torso, B.upper, B.lower, B.palm, arms.left.upper, arms.left.lower, arms.left.palm, ...B.legs.flat()].filter(Boolean).map(b => [b, b.quaternion.clone()]);
    A.paint(kit);
    return A;
  }

  const _sh = new T.Vector3(), _hand = new T.Vector3(), _el = new T.Vector3(), _fwd = new T.Vector3(), _side = new T.Vector3(), _tmp = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0);
  /** Same inputs as TN.poseAthlete, plus dt for the clips. */
  function poseRig(A, st, dt) {
    A.root.position.set(st.x, 0, st.z);
    A.root.rotation.y = st.facing;
    // clips: idle <-> run by running speed
    const run = Math.min(1, st.run || 0);
    if (A.run && A.idle) {
      A.run.setEffectiveWeight(run); A.idle.setEffectiveWeight(1 - run);
      A.run.timeScale = 0.7 + run * 0.6;
    }
    A.rest.forEach(([b, q]) => b.quaternion.copy(q));
    A.mixer.update(dt || 0);
    A.root.updateMatrixWorld(true);
    // ready stance: lean in, turn the shoulders with the racket
    const B = A.B;
    if (B.torso) {
      _side.set(1, 0, 0).applyAxisAngle(UP, st.facing);
      turnBone(B.torso, UP, st.twist || 0);
      turnBone(B.torso, _side, -(st.lean || 0) * 0.8 - (st.crouch || 0) * 0.18);
    }
    // athletic stance: knees bent, sitting into the legs (less while running: the clip does it)
    const bend = (st.crouch || 0) * 0.75 * (1 - run * 0.8);
    if (bend > 0.01) {
      B.legs.forEach(([u, l]) => { turnBone(u, _side, bend); });
      A.root.updateMatrixWorld(true);
      B.legs.forEach(([u, l]) => { turnBone(l, _side, -bend * 1.9); });
      A.root.position.y = -(0.47 * (1 - Math.cos(bend)) + 0.45 * (1 - Math.cos(bend * 0.9))) * 1.0;
    } else A.root.position.y = 0;
    A.root.updateMatrixWorld(true);
    // racket arm
    let hand, elbow;
    if (st.arm) { hand = st.arm.hand; elbow = st.arm.elbow; }
    else {
      // computer player: hand forward-down of the shoulder toward where the racket points
      B.upper.getWorldPosition(_sh);
      _fwd.set(0, 0, -1).applyQuaternion(st.racketQuat);
      _hand.copy(_fwd).multiplyScalar(0.42); _hand.y -= 0.22;
      _side.set(0.12, 0, 0).applyAxisAngle(UP, st.facing);
      _hand.add(_side).setLength(0.6).add(_sh);
      _el.addVectors(_sh, _hand).multiplyScalar(0.5);
      _tmp.set(0.08, -0.12, 0.06).applyAxisAngle(UP, st.facing); _el.add(_tmp);
      hand = _hand; elbow = _el;
    }
    const arm = st.hand === 'left' ? B.arms.left : B.arms.right;
    aimBone(arm.upper, arm.lower, elbow);
    aimBone(arm.lower, arm.palm, hand);
    // the racket lives in the player's hand with the phone's orientation (its grip is the hand)
    A.racket.position.copy(hand);
    A.racket.quaternion.copy(st.racketQuat);
    // the palm follows the grip so the hand closes on the handle
    arm.palm.getWorldPosition(_a);
    A.gap = _a.distanceTo(hand);           // testing aid: how far the drawn hand is from the grip
  }

  // ---------------------------------------------------------------------------------
  // Crowd impostors
  const SKINS = [0xf1c8a0, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226, 0xd9a273];
  const HAIRS = [0x2a1b12, 0x111111, 0x5a3a1e, 0xb88a4a, 0x8a3a1c, 0x3b2a20, 0xd8c8a0];
  const SHIRTS = [0xff5d73, 0xffb547, 0xffffff, 0x4fd1c5, 0x6c8cff, 0xf2f2f2, 0xffe066, 0x9b7bff, 0x2ecc71, 0xff8c42, 0x1e90ff, 0x223044, 0xd94b4b, 0x3a7d5c];
  const PANTS = [0x2b3445, 0x1d2430, 0x6b5a45, 0x3d4a5e, 0x8a8f99, 0x20262e];
  const pick = a => a[(Math.random() * a.length) | 0];
  const COLS = 8, ROWS = 4, CELL_W = 96, CELL_H = 192;   // atlas: 32 spectators x 2 poses, 768 x 1536
  const FRAME = { w: 0.9, h: 1.8, y0: -0.02 };          // metres of the model each cell shows (feet at 0)

  /** Render the spectator atlas: seated and cheering versions of random kits. */
  function bakeCrowdAtlas(renderer) {
    const rt = new T.WebGLRenderTarget(COLS * CELL_W, ROWS * CELL_H * 2, { samples: 4 });
    rt.texture.encoding = T.sRGBEncoding;
    const sc = new T.Scene();
    sc.add(new T.HemisphereLight(0xdfe9ff, 0x5a4a3a, 0.75));
    const sun = new T.DirectionalLight(0xfff1dc, 1.05); sun.position.set(1.2, 2.5, 3); sc.add(sun);
    const cam = new T.OrthographicCamera(-FRAME.w / 2, FRAME.w / 2, FRAME.h + FRAME.y0, FRAME.y0, 0.1, 20);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);   // straight on: bounds are world heights
    const bodies = ['m', 'f', 'f2', 'm'];
    const prevTarget = renderer.getRenderTarget(), prevScissor = renderer.getScissorTest();
    const prevTone = renderer.toneMapping; renderer.toneMapping = T.NoToneMapping;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.setScissorTest(true);
    const kits = Array.from({ length: COLS * ROWS }, (_, i) => ({ shirt: SHIRTS[i % SHIRTS.length], pants: pick(PANTS), hair: pick(HAIRS), skin: pick(SKINS) }));
    kits.sort(() => Math.random() - 0.5);
    for (let half = 0; half < 2; half++) {        // 0: seated, 1: cheering (standing, clapping)
      for (let i = 0; i < COLS * ROWS; i++) {
        const body = bodies[i % bodies.length];
        const g = Rig.gltf[body];
        const model = T.SkeletonUtils.clone(g.scene);
        model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.frustumCulled = false; } });
        const mats = {}; model.traverse(o => { if (o.isMesh) (mats[o.material.name] = mats[o.material.name] || []).push(o.material); });
        const set = (n, c) => (mats[n] || []).forEach(m => { m.color.setHex(c).convertSRGBToLinear(); m.roughness = 0.8; m.metalness = 0; });
        // the same kit in both halves (seed per cell)
        const kit = kits[i];
        set('Shirt', kit.shirt); set('Pants', kit.pants); set('Hair', kit.hair); set('HairBase', kit.hair); set('Skin', kit.skin);
        set('Shoes', 0x2a2a2a);
        const mixer = new T.AnimationMixer(model);
        const clip = clipOf(g, half ? 'Clapping' : 'Sitting');
        if (clip) { const a = mixer.clipAction(clip); a.play(); mixer.setTime(half ? clip.duration * ((i % 5) / 5) : clip.duration * 0.98); }
        model.rotation.y = (i % 3 - 1) * 0.18;     // not everyone square on
        model.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(model); // bind-pose box: only used for the scale
        model.scale.multiplyScalar((half ? 1.68 : 1.68) / Math.max(0.5, box.max.y - box.min.y) * (0.92 + (i % 4) * 0.04));
        sc.add(model);
        const cx = (i % COLS) * CELL_W, cy = (Math.floor(i / COLS) + half * ROWS) * CELL_H;
        renderer.setViewport(cx, cy, CELL_W, CELL_H); renderer.setScissor(cx, cy, CELL_W, CELL_H);
        renderer.render(sc, cam);
        sc.remove(model);
        model.traverse(o => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); if (o.isMesh) o.material.dispose(); });
        mixer.uncacheRoot(model);
      }
    }
    renderer.setScissorTest(prevScissor);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    TN._atlasRT = rt; TN._rd = renderer;
    return { texture: rt.texture, cols: COLS, rows: ROWS * 2, cells: COLS * ROWS };
  }

  /**
   * Replace the world's crowd with impostors. crowd: world.crowd ({ base[], phase, excite, t }).
   * Everything moves on the GPU: each spectator turns toward whichever camera is drawing (so the
   * two split-screen views both look right), sways in the seat, and when the crowd gets excited a
   * share of them stand up and clap. Returns update(dt) that only feeds the clock and excitement.
   */
  function crowdImpostors(scene, crowd, atlas) {
    const n = crowd.n;
    const geo = new T.PlaneGeometry(FRAME.w, FRAME.h);
    geo.translate(0, FRAME.h / 2 + FRAME.y0, 0);
    const cell = new Float32Array(n), ry = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { cell[i] = (Math.random() * atlas.cells) | 0; ry[i] = crowd.base[i].ry; ph[i] = crowd.phase[i]; }
    geo.setAttribute('aCell', new T.InstancedBufferAttribute(cell, 1));
    geo.setAttribute('aRy', new T.InstancedBufferAttribute(ry, 1));
    geo.setAttribute('aPh', new T.InstancedBufferAttribute(ph, 1));
    const uni = { uTime: { value: 0 }, uExcite: { value: 0 } };
    const mat = new T.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, side: T.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aCell; attribute float aRy; attribute float aPh;
          uniform float uTime; uniform float uExcite;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          float up = (uExcite > 0.35 && sin(aPh * 13.7) > 1.1 - min(1.0, uExcite) * 1.2) ? 1.0 : 0.0;
          { float col = mod(aCell, ${atlas.cols}.0); float row = floor(aCell / ${atlas.cols}.0) + up * ${atlas.rows / 2}.0;
            vUv = (uv + vec2(col, row)) / vec2(${atlas.cols}.0, ${atlas.rows}.0); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float d = atan(cameraPosition.x - c.x, cameraPosition.z - c.z) - aRy;
            d = atan(sin(d), cos(d));
            float a = aRy + d * 0.85, ca = cos(a), sa = sin(a);
            // the instance matrix holds no rotation: turn here, in its local space
            transformed = vec3(transformed.x * ca + transformed.z * sa, transformed.y, -transformed.x * sa + transformed.z * ca);
            transformed.y += up > 0.5 ? max(0.0, sin(uTime * 8.0 + aPh * 3.0)) * 0.12 : -0.45 + sin(uTime * 1.3 + aPh) * 0.012;
            // spectators right next to the camera (the stand behind a player) would fill the view: hide them
            if (length((cameraPosition - c).xz) < 7.0) transformed *= 0.0;
          }`);
    };
    const mesh = new T.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const col = new T.Color(), m4 = new T.Matrix4();
    for (let i = 0; i < n; i++) {
      const b = crowd.base[i];
      mesh.setColorAt(i, col.setScalar(0.8 + Math.random() * 0.2));
      mesh.setMatrixAt(i, m4.makeScale(b.sc, b.sc, b.sc).setPosition(b.x, b.y, b.z));
    }
    scene.add(mesh);
    crowd.bodies.visible = false; crowd.heads.visible = false;
    crowd.impostors = mesh;
    return function update() { uni.uTime.value = crowd.t; uni.uExcite.value = crowd.excite; };
  }

  /** A still, seated character (the chair umpire). Feet at the group origin, facing +z. */
  function makeSeated(body, kit, height) {
    const g = Rig.gltf[body] || Rig.gltf.m;
    const model = T.SkeletonUtils.clone(g.scene);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false; o.material = o.material.clone();
      const c = kit[{ Shirt: 'shirt', Pants: 'shorts', Skin: 'skin', Hair: 'hair', HairBase: 'hair', Shoes: 'shoes' }[o.material.name]];
      if (c !== undefined) o.material.color.setHex(c).convertSRGBToLinear();
    });
    const box = new T.Box3().setFromObject(model);
    model.scale.multiplyScalar(height / (box.max.y - box.min.y));
    const mixer = new T.AnimationMixer(model), clip = clipOf(g, 'Sitting');
    if (clip) { mixer.clipAction(clip).play(); mixer.setTime(clip.duration * 0.98); }
    const grp = new T.Group(); grp.add(model);
    return { group: grp, mixer };
  }

  Object.assign(TN, { makeRigAthlete, poseRig, bakeCrowdAtlas, crowdImpostors, makeSeated });
})();
