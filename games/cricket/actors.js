/*
 * Willowlight - the people and the gear: skinned players (CC0 Quaternius characters, see
 * CREDITS.md) posed from the phones, the bat, the ball, the crowd made from the same characters.
 *
 * An athlete's legs and body come from the model's own clips (idle, run); the arms are aimed
 * every frame: the batter's two hands hold the bat where the phone puts it, the bowler's arm
 * turns exactly as the phone, a fielder's hands go to the ball.
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const T = THREE;
  const FILES = { m: 'assets/models/athlete_m.glb', f: 'assets/models/athlete_f.glb' };
  const HEIGHT = 1.78;

  const Rig = CK.Rig = { ready: false, gltf: {}, _cbs: [], failed: false };
  Rig.onReady = cb => { if (Rig.ready) cb(); else Rig._cbs.push(cb); };
  (function load() {
    const go = () => {
      const loader = new T.GLTFLoader(), keys = Object.keys(FILES);
      Promise.all(keys.map(k => new Promise((res, rej) => loader.load(FILES[k], g => res([k, g]), undefined, rej))))
        .then(list => {
          list.forEach(([k, g]) => { Rig.gltf[k] = g; });
          Rig.ready = true;
          Rig._cbs.splice(0).forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
        })
        .catch(e => { Rig.failed = true; console.warn('Willowlight: player models did not load', e); });
    };
    if (T.GLTFLoader) go(); else addEventListener('three-loaders', go, { once: true });
  })();
  const clipOf = (g, name) => g.animations.find(c => c.name.split('|').pop().replace(/^(Man|Female)_/, '') === name) || null;

  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion();
  /** Turn `bone` (world space) so that `child` moves toward `target`. */
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
  function turnBone(bone, axis, angle) {
    _q.setFromAxisAngle(axis, angle);
    bone.parent.getWorldQuaternion(_q2);
    _q3.copy(_q2).invert().multiply(_q).multiply(_q2);
    bone.quaternion.premultiply(_q3);
  }
  const std = o => new T.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0 }, o));

  // ------------------------------------------------------------------ gear
  /** The bat: origin at the top hand, blade along -Z (the phone's top), face toward +Y. */
  function makeBat() {
    const g = new T.Group();
    const willow = std({ color: 0xe9cf9a, roughness: 0.55 }), gripM = std({ color: 0x1c2a44, roughness: 0.9 });
    const handle = new T.Mesh(new T.CylinderGeometry(0.017, 0.016, 0.3, 10), gripM);
    handle.rotation.x = Math.PI / 2; handle.position.z = -0.1; g.add(handle);
    // the blade: a bevelled box with a raised spine on the back
    const shape = new T.Shape();
    const w = 0.054, top = 0.24, toe = 0.8;
    shape.moveTo(-w * 0.75, -top); shape.lineTo(w * 0.75, -top); shape.lineTo(w, -top - 0.05); shape.lineTo(w, -toe + 0.02);
    shape.quadraticCurveTo(w, -toe, w - 0.02, -toe); shape.lineTo(-w + 0.02, -toe); shape.quadraticCurveTo(-w, -toe, -w, -toe + 0.02); shape.lineTo(-w, -top - 0.05); shape.closePath();
    const blade = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), willow);
    blade.rotation.x = Math.PI / 2;     // shape's -y becomes -z (along the phone's top)
    blade.position.y = -0.011;
    g.add(blade);
    const spine = new T.Mesh(new T.CylinderGeometry(0.026, 0.03, 0.5, 10, 1, false, 0, Math.PI), willow);
    spine.rotation.x = Math.PI / 2; spine.rotation.y = Math.PI; spine.position.set(0, -0.012, -0.52); spine.scale.set(1, 1, 0.55);
    g.add(spine);
    const sticker = new T.Mesh(new T.PlaneGeometry(0.085, 0.16), new T.MeshBasicMaterial({ color: 0xffb547, toneMapped: false }));
    sticker.rotation.x = -Math.PI / 2; sticker.position.set(0, 0.0175, -0.36); g.add(sticker);
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    return g;
  }
  /** A white floodlit-game ball with its stitched seam. */
  function makeBall() {
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#f6f3ea'; x.fillRect(0, 0, 256, 128);
      x.fillStyle = '#d9d2c2'; x.fillRect(0, 58, 256, 12);
      x.strokeStyle = '#b8323a'; x.lineWidth = 2;
      for (let i = 0; i < 256; i += 6) { x.beginPath(); x.moveTo(i, 57); x.lineTo(i + 3, 61); x.stroke(); x.beginPath(); x.moveTo(i, 71); x.lineTo(i + 3, 67); x.stroke(); }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
    })();
    const m = new T.Mesh(new T.SphereGeometry(0.036 * 1.3, 20, 14), std({ map: tex, roughness: 0.35, emissive: 0x2a2620 }));
    m.castShadow = true;
    return m;
  }
  /** A fading streak behind the ball so a 140 km/h delivery can be followed. */
  function makeTrail(n) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const line = new T.Line(geo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    line.frustumCulled = false;
    const pts = [];
    return {
      line,
      push(p, on) {
        pts.unshift([p.x, p.y, p.z]); if (pts.length > n) pts.pop();
        for (let i = 0; i < n; i++) {
          const q = pts[Math.min(i, pts.length - 1)] || [p.x, p.y, p.z];
          pos[i * 3] = q[0]; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = q[2];
          const k = on ? Math.pow(1 - i / n, 1.6) * 0.75 : 0;
          col[i * 3] = k; col[i * 3 + 1] = k * 0.92; col[i * 3 + 2] = k * 0.75;
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      },
      clear() { pts.length = 0; },
    };
  }

  // ------------------------------------------------------------------ athletes
  /**
   * kit: { body: 'm'|'f', shirt, pants, skin?, hair?, shoes?, pads?, helmet?, gloves? }.
   * Returns { root, model, mixer, idle, run, B (bones), paint(kit) }. Facing +z at rotation 0.
   */
  function makeAthlete(kit) {
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
    const B = {
      arms: { right: { upper: bone('UpperArmR'), lower: bone('LowerArmR'), palm: bone('PalmR') }, left: { upper: bone('UpperArmL'), lower: bone('LowerArmL'), palm: bone('PalmL') } },
      torso: bone('Torso'), hips: bone('Hips'), head: bone('Head'),
      legs: [['UpperLegL', 'LowerLegL'], ['UpperLegR', 'LowerLegR']].map(([u, l]) => [bone(u), bone(l)]).filter(x => x[0] && x[1]),
    };
    model.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(model);
    const k = HEIGHT / Math.max(0.5, box.max.y - box.min.y) * (kit.scale || 1);
    model.position.y -= box.min.y;
    const holder = new T.Group(); holder.add(model); holder.scale.setScalar(k);
    const root = new T.Group(); root.add(holder);
    const mixer = new T.AnimationMixer(model);
    const act = n => { const c = clipOf(g, n); if (!c) return null; const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); return a; };
    const idle = act('Idle'), run = act('Run');
    if (idle) idle.setEffectiveWeight(1);
    const A = { root, model, mixer, idle, run, B, mats, gear: [] };
    A.paint = c => {
      const set = (n, col) => (mats[n] || []).forEach(m => m.color.setHex(col).convertSRGBToLinear());
      if (c.shirt !== undefined) set('Shirt', c.shirt);
      if (c.pants !== undefined) set('Pants', c.pants);
      set('Shoes', c.shoes !== undefined ? c.shoes : 0xf2f2f2); set('Socks', 0xf2f2f2);
      if (c.skin !== undefined) set('Skin', c.skin);
      if (c.hair !== undefined) { set('Hair', c.hair); set('HairBase', c.hair); }
    };
    A.paint(kit);
    // pads, helmet, gloves: simple shapes riding on the bones
    const padM = std({ color: 0xf4f4f0, roughness: 0.7 });
    root.updateMatrixWorld(true);
    const ws = new T.Vector3();
    // gear is sized in metres: undo the bone's own world scale (the rig's armature is scaled)
    const addTo = (b, mesh, pos) => {
      if (!b) return;
      b.getWorldScale(ws);
      const s = 1 / (ws.x || 1);
      mesh.scale.multiplyScalar(s); mesh.position.copy(pos).multiplyScalar(s);
      b.add(mesh); mesh.traverse(m => { if (m.isMesh) m.castShadow = true; }); A.gear.push(mesh);
    };
    if (kit.pads) {
      B.legs.forEach(([u, l]) => {
        const pad = new T.Mesh(new T.BoxGeometry(0.15, 0.5, 0.11), padM);
        // a lower leg bone runs along its +y
        addTo(l, pad, new T.Vector3(0, 0.22, 0.045));
      });
    }
    if (kit.helmet) {
      const h = new T.Group();
      const shell = new T.Mesh(new T.SphereGeometry(0.135, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), std({ color: kit.helmet, roughness: 0.35, metalness: 0.2 }));
      h.add(shell);
      const peak = new T.Mesh(new T.BoxGeometry(0.2, 0.012, 0.08), std({ color: kit.helmet, roughness: 0.35 }));
      peak.position.set(0, 0.0, 0.14); h.add(peak);
      const grille = new T.Mesh(new T.TorusGeometry(0.11, 0.006, 4, 16, Math.PI), std({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 }));
      grille.rotation.set(Math.PI / 2, 0, Math.PI); grille.position.set(0, -0.06, 0.04); grille.scale.set(1, 1.1, 1); h.add(grille);
      addTo(B.head, h, new T.Vector3(0, 0.12, 0.0));
    }
    if (kit.gloves) {
      ['left', 'right'].forEach(s => { const gl = new T.Mesh(new T.BoxGeometry(0.09, 0.11, 0.1), std({ color: kit.gloves, roughness: 0.6 })); addTo(B.arms[s].palm, gl, new T.Vector3(0, 0.05, 0)); });
    }
    // fading (the camera sees through anyone standing in front of the play)
    A.allMats = [];
    root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!A.allMats.includes(m)) A.allMats.push(m); }); });
    A.opacity = 1;
    A.setOpacity = v => {
      if (Math.abs(v - A.opacity) < 0.005) return;
      A.opacity = v;
      const see = v < 0.99;
      // three.js compiles an opaque material with alpha forced to 1: switching needs a recompile
      A.allMats.forEach(m => { if (m.transparent !== see) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; } m.opacity = v; });
      root.traverse(o => { if (o.isMesh) o.castShadow = v > 0.5; });
    };
    A.rest = [B.torso, B.hips, ...['left', 'right'].flatMap(s => [B.arms[s].upper, B.arms[s].lower, B.arms[s].palm]), ...B.legs.flat()].filter(Boolean).map(b => [b, b.quaternion.clone()]);
    return A;
  }

  const UP = new T.Vector3(0, 1, 0), _side = new T.Vector3(), _sh = new T.Vector3(), _el = new T.Vector3(), _t2 = new T.Vector3();
  /**
   * st: { x, z, facing (rad about y; 0 = facing +z), run 0..1, crouch 0..1, lean, twist,
   *   arms: { left?: {hand, elbow?}, right?: {hand, elbow?} } (world Vector3s), y (lift) }.
   */
  function pose(A, st, dt) {
    A.root.position.set(st.x, st.y || 0, st.z);
    A.root.rotation.y = st.facing || 0;
    const run = Math.min(1, st.run || 0);
    if (A.run && A.idle) { A.run.setEffectiveWeight(run); A.idle.setEffectiveWeight(1 - run); A.run.timeScale = 0.75 + run * 0.6; }
    A.rest.forEach(([b, q]) => b.quaternion.copy(q));
    A.mixer.update(dt || 0);
    A.root.updateMatrixWorld(true);
    const B = A.B;
    _side.set(1, 0, 0).applyAxisAngle(UP, st.facing || 0);
    if (B.torso) {
      if (st.twist) turnBone(B.torso, UP, st.twist);
      if (st.lean || st.crouch) turnBone(B.torso, _side, (st.lean || 0) + (st.crouch || 0) * 0.35);
    }
    const bend = (st.crouch || 0) * 0.9 * (1 - run * 0.8);
    if (bend > 0.01) {
      B.legs.forEach(([u]) => turnBone(u, _side, bend));
      A.root.updateMatrixWorld(true);
      B.legs.forEach(([, l]) => turnBone(l, _side, -bend * 1.9));
      A.root.position.y = (st.y || 0) - (0.47 * (1 - Math.cos(bend)) + 0.45 * (1 - Math.cos(bend * 0.9)));
    }
    A.root.updateMatrixWorld(true);
    if (st.arms) for (const s of ['left', 'right']) {
      const t = st.arms[s], arm = B.arms[s];
      if (!t || !arm.upper) continue;
      let elbow = t.elbow;
      if (!elbow) {
        arm.upper.getWorldPosition(_sh);
        _el.addVectors(_sh, t.hand).multiplyScalar(0.5);
        _t2.copy(_side).multiplyScalar(s === 'right' ? -0.07 : 0.07); _el.add(_t2); _el.y -= 0.08;
        elbow = _el;
      }
      aimBone(arm.upper, arm.lower, elbow);
      aimBone(arm.lower, arm.palm, t.hand);
    }
  }
  /** World position of a bone (shoulder etc.) into v. */
  function boneWorld(A, name, v) { const b = A.model.getObjectByName(name); if (b) b.getWorldPosition(v); return v; }

  // ------------------------------------------------------------------ crowd impostors (as Sunvolley)
  const SKINS = [0xf1c8a0, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226, 0xd9a273];
  const HAIRS = [0x2a1b12, 0x111111, 0x5a3a1e, 0xb88a4a, 0x8a3a1c, 0x3b2a20];
  const SHIRTS = [0xff5d73, 0xffb547, 0xffffff, 0x4fd1c5, 0x6c8cff, 0xffe066, 0x9b7bff, 0x2ecc71, 0xff8c42, 0x1e90ff, 0x223044, 0xd94b4b, 0x0f9d8a, 0xf2f2f2];
  const PANTS = [0x2b3445, 0x1d2430, 0x6b5a45, 0x3d4a5e, 0x8a8f99, 0x20262e];
  const pick = a => a[(Math.random() * a.length) | 0];
  const COLS = 8, ROWS = 4, CELL_W = 96, CELL_H = 192, FRAME = { w: 0.9, h: 1.8, y0: -0.02 };

  function bakeCrowdAtlas(renderer) {
    const rt = new T.WebGLRenderTarget(COLS * CELL_W, ROWS * CELL_H * 2, { samples: 4 });
    rt.texture.encoding = T.sRGBEncoding;
    const sc = new T.Scene();
    sc.add(new T.HemisphereLight(0xdfe9ff, 0x5a4a3a, 0.8));
    const sun = new T.DirectionalLight(0xffe2c0, 1.0); sun.position.set(1.2, 2.5, 3); sc.add(sun);
    const cam = new T.OrthographicCamera(-FRAME.w / 2, FRAME.w / 2, FRAME.h + FRAME.y0, FRAME.y0, 0.1, 20);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    const prevTarget = renderer.getRenderTarget(), prevTone = renderer.toneMapping;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.setScissorTest(true);
    const kits = Array.from({ length: COLS * ROWS }, (_, i) => ({ shirt: SHIRTS[i % SHIRTS.length], pants: pick(PANTS), hair: pick(HAIRS), skin: pick(SKINS) }));
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < COLS * ROWS; i++) {
        const g = Rig.gltf[i % 2 ? 'f' : 'm'];
        const model = T.SkeletonUtils.clone(g.scene);
        const mats = {};
        model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.frustumCulled = false; (mats[o.material.name] = mats[o.material.name] || []).push(o.material); } });
        const set = (n, c) => (mats[n] || []).forEach(m => { m.color.setHex(c).convertSRGBToLinear(); m.roughness = 0.8; m.metalness = 0; });
        const kit = kits[i];
        set('Shirt', kit.shirt); set('Pants', kit.pants); set('Hair', kit.hair); set('HairBase', kit.hair); set('Skin', kit.skin); set('Shoes', 0x2a2a2a);
        const mixer = new T.AnimationMixer(model);
        const clip = clipOf(g, half ? 'Clapping' : 'Sitting');
        if (clip) { mixer.clipAction(clip).play(); mixer.setTime(half ? clip.duration * ((i % 5) / 5) : clip.duration * 0.98); }
        model.rotation.y = (i % 3 - 1) * 0.18;
        model.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(model);
        model.scale.multiplyScalar(1.68 / Math.max(0.5, box.max.y - box.min.y) * (0.92 + (i % 4) * 0.04));
        sc.add(model);
        const cx = (i % COLS) * CELL_W, cy = (Math.floor(i / COLS) + half * ROWS) * CELL_H;
        renderer.setViewport(cx, cy, CELL_W, CELL_H); renderer.setScissor(cx, cy, CELL_W, CELL_H);
        renderer.render(sc, cam);
        sc.remove(model);
        model.traverse(o => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); if (o.isMesh) o.material.dispose(); });
        mixer.uncacheRoot(model);
      }
    }
    renderer.setScissorTest(false);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    return { texture: rt.texture, cols: COLS, rows: ROWS * 2, cells: COLS * ROWS };
  }

  /** Swap the world's simple crowd for character impostors (GPU-animated, see Sunvolley). */
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
          attribute float aCell; attribute float aRy; attribute float aPh; uniform float uTime; uniform float uExcite;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          float up = (uExcite > 0.3 && sin(aPh * 13.7) > 1.1 - min(1.0, uExcite) * 1.3) ? 1.0 : 0.0;
          { float col = mod(aCell, ${atlas.cols}.0); float row = floor(aCell / ${atlas.cols}.0) + up * ${atlas.rows / 2}.0;
            vUv = (uv + vec2(col, row)) / vec2(${atlas.cols}.0, ${atlas.rows}.0); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float d = atan(cameraPosition.x - c.x, cameraPosition.z - c.z) - aRy;
            d = atan(sin(d), cos(d));
            float a = aRy + d * 0.85, ca = cos(a), sa = sin(a);
            transformed = vec3(transformed.x * ca + transformed.z * sa, transformed.y, -transformed.x * sa + transformed.z * ca);
            transformed.y += up > 0.5 ? max(0.0, sin(uTime * 8.0 + aPh * 3.0)) * 0.14 : -0.45 + sin(uTime * 1.3 + aPh) * 0.012;
          }`);
    };
    const mesh = new T.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const col = new T.Color(), m4 = new T.Matrix4();
    for (let i = 0; i < n; i++) {
      const b = crowd.base[i];
      // floodlit from the field side, the back rows a touch darker
      mesh.setColorAt(i, col.setScalar(0.72 + Math.random() * 0.22));
      mesh.setMatrixAt(i, m4.makeScale(b.sc, b.sc, b.sc).setPosition(b.x, b.y, b.z));
    }
    scene.add(mesh);
    crowd.bodies.visible = false; crowd.heads.visible = false;
    crowd.impostors = mesh;
    crowd.impUpdate = () => { uni.uTime.value = crowd.t; uni.uExcite.value = crowd.excite; };
  }

  Object.assign(CK, { makeBat, makeBall, makeTrail, makeAthlete, poseAthlete: pose, boneWorld, aimBone, bakeCrowdAtlas, crowdImpostors });
})();
