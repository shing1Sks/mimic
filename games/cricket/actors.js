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
          try { unwrap(Rig.gltf.m.scene); } catch (e) { console.warn('Willowlight: kit unwrap', e); }
          Rig.ready = true;
          Rig._cbs.splice(0).forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
        })
        .catch(e => { Rig.failed = true; console.warn('Willowlight: player models did not load', e); });
    };
    if (T.GLTFLoader) go(); else addEventListener('three-loaders', go, { once: true });
  })();
  /**
   * The model has no texture coordinates: give the man's shirt, skin, shorts and eyes/shoes some,
   * once, on the shared geometry (every clone shares it), so a player's kit and face can be painted
   * on one canvas (CK.Kits.LAYOUT). Each triangle goes whole into one region (front, back, a sleeve,
   * the face, the side of the head, the eyes, a shoe...), so no triangle smears across two. Bind
   * pose, model units (about 4.85 tall), facing +z, arms out along x.
   */
  function unwrap(scene) {
    const L = CK.Kits && CK.Kits.LAYOUT;
    if (!L) return;
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const p = [new T.Vector3(), new T.Vector3(), new T.Vector3()], e1 = new T.Vector3(), e2 = new T.Vector3(), n = new T.Vector3();
    const clamp01 = x => Math.max(0.004, Math.min(0.996, x));
    for (const mesh of meshes) {
      const kind = mesh.material && mesh.material.name;
      if (!['Shirt', 'Skin', 'Pants', 'Eyes', 'Socks', 'Hair'].includes(kind)) continue;
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      const bones = mesh.skeleton.bones.map(b => b.name);
      const uv = new Float32Array(pos.count * 2);
      const comp = (a, i, c) => a.array[i * a.itemSize + c];
      const dom = i => { let m = 0; for (let c = 1; c < 4; c++) if (comp(sw, i, c) > comp(sw, i, m)) m = c; return bones[comp(si, i, m)] || ""; };
      for (let t = 0; t < pos.count; t += 3) {
        for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, t + k).applyMatrix4(mesh.matrixWorld);
        n.crossVectors(e1.subVectors(p[1], p[0]), e2.subVectors(p[2], p[0])).normalize();
        // the triangle's bone: the most common dominant bone of its corners
        const ds = [dom(t), dom(t + 1), dom(t + 2)], b = ds[1] === ds[2] ? ds[1] : ds[0];
        const cy = (p[0].y + p[1].y + p[2].y) / 3, cx = (p[0].x + p[1].x + p[2].x) / 3;
        let reg = 'plain', f = null;
        if (kind === 'Shirt') {
          if (/UpperArm/.test(b)) {
            reg = cx < 0 ? 'sleeveR' : 'sleeveL';
            // round the arm (0.5 = the top in the T pose, the outside of a hanging arm), and along it
            f = q => [0.5 + Math.atan2(q.z + 0.05, q.y - 3.84) / (Math.PI * 2), (Math.abs(q.x) - 0.37) / 0.5];
          } else {
            reg = n.z >= 0 ? 'front' : 'back';
            f = reg === 'front' ? q => [(q.x + 0.53) / 1.06, (4.06 - q.y) / 1.58] : q => [(0.53 - q.x) / 1.06, (4.06 - q.y) / 1.58];
          }
        } else if (kind === 'Skin') {
          const cz = (p[0].z + p[1].z + p[2].z) / 3;
          if (/Head/.test(b) && cy > 4.1) {
            // the scalp under the hair: the crown, and the head behind the ears above the neck (a crop shows it)
            if ((cy > 4.62 && !(n.z > 0.6 && cy < 4.66)) || (cy > 4.3 && cz < -0.1 && n.z < 0.3)) reg = 'scalp';
            else if (n.z > 0.3 || (n.z > -0.2 && Math.abs(cx) < 0.12)) { reg = 'face'; f = q => [(q.x + 0.28) / 0.56, (4.676 - q.y) / 0.56]; }
            else if (n.z > -0.75) { reg = 'side'; f = q => [(0.3 - q.z) / 0.7, (4.676 - q.y) / 0.56]; }
            else reg = 'skin';
          } else reg = /Leg/.test(b) ? 'trouser' : /Palm|Finger|Thumb|MiddleHand/.test(b) ? 'hand' : 'skin';
        } else if (kind === 'Eyes') {
          if (/Head/.test(b)) { reg = 'eyes'; f = q => [(q.x + 0.16) / 0.32, (4.525 - q.y) / 0.115]; }
          else { reg = 'shoe'; f = q => [(q.z + 0.15) / 0.75, (0.17 - q.y) / 0.17]; }
        } else if (kind === 'Socks') { reg = 'sock'; }
        else if (kind === 'Hair') { reg = 'hair'; }
        else if (kind === 'Pants') { reg = 'trouser'; }
        const R = L[reg] || L.plain;
        let us = [0.5, 0.5, 0.5], vs = [0.5, 0.5, 0.5];
        if (f) {
          for (let k = 0; k < 3; k++) { const r = f(p[k]); us[k] = r[0]; vs[k] = r[1]; }
          if (reg === 'sleeveL' || reg === 'sleeveR') for (let k = 1; k < 3; k++) us[k] -= Math.round(us[k] - us[0]);   // across the seam under the arm
        }
        for (let k = 0; k < 3; k++) {
          uv[(t + k) * 2] = (R[0] + clamp01(us[k]) * R[2]) / L.W;
          uv[(t + k) * 2 + 1] = 1 - (R[1] + clamp01(vs[k]) * R[3]) / L.H;
        }
      }
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mesh.geometry = geo;
    }
  }
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
    // drawn 1.6x real size (a broadcast's long lens and motion blur make a real one read bigger)
    const m = new T.Mesh(new T.SphereGeometry(0.036 * 1.6, 24, 16), std({ map: tex, roughness: 0.3, emissive: 0x4a443a }));
    m.castShadow = true;
    return m;
  }
  /**
   * A tapering ribbon behind the ball (a 1-pixel line read as a scratch): camera-facing, wide at
   * the ball and fading out behind, only while the ball is quick, so its path reads at a glance.
   */
  function makeTrail(n) {
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const line = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    line.frustumCulled = false;
    const pts = [], W = 0.05;
    const t = new T.Vector3(), c = new T.Vector3(), sd = new T.Vector3();
    return {
      line,
      /** p: the ball now; on: draw it; cam: the camera position (the ribbon faces it). */
      push(p, on, cam) {
        pts.unshift([p.x, p.y, p.z]); if (pts.length > n) pts.pop();
        for (let i = 0; i < n; i++) {
          const q = pts[Math.min(i, pts.length - 1)] || [p.x, p.y, p.z], q2 = pts[Math.min(i + 1, pts.length - 1)] || q;
          t.set(q[0] - q2[0], q[1] - q2[1], q[2] - q2[2]);
          if (t.lengthSq() < 1e-8) t.set(0, 0, 1);
          c.set(cam ? cam.x - q[0] : 0, cam ? cam.y - q[1] : 1, cam ? cam.z - q[2] : 0);
          // seen end-on the ribbon thins out instead of twisting (|t x c| = sin of the angle)
          sd.crossVectors(t.normalize(), c.normalize()).multiplyScalar(W * (1 - i / n));
          pos.set([q[0] + sd.x, q[1] + sd.y, q[2] + sd.z, q[0] - sd.x, q[1] - sd.y, q[2] - sd.z], i * 6);
          const k = on ? Math.pow(1 - i / n, 1.4) * 0.55 : 0;
          col.set([k, k * 0.95, k * 0.82, k, k * 0.95, k * 0.82], i * 6);
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      },
      clear() { pts.length = 0; },
    };
  }

  // ------------------------------------------------------------------ kits (one canvas per player, shared)
  const KITS = new Map();
  let maxAniso = 4;
  function kitTexture(key, p) {
    let e = KITS.get(key);
    if (!e) {
      const L = CK.Kits.LAYOUT, c = document.createElement('canvas'); c.width = L.W; c.height = L.H;
      CK.Kits.drawPlayer(c.getContext('2d'), p.team, p);
      const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = maxAniso;
      const shut = tex.clone(); shut.offset.set(0, -CK.Kits.BLINK); shut.needsUpdate = true;
      e = { tex, shut, users: 0 };
      KITS.set(key, e);
      // a long session through many teams: let go of kits nobody wears
      if (KITS.size > 48) for (const [k2, e2] of KITS) { if (e2.users <= 0 && k2 !== key) { e2.tex.dispose(); e2.shut.dispose(); KITS.delete(k2); if (KITS.size <= 40) break; } }
    }
    e.users++;
    return e;
  }
  function releaseKit(key) { const e = KITS.get(key); if (e) e.users--; }

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
      torso: bone('Torso'), hips: bone('Hips'), head: bone('Head'), neck: bone('Neck'),
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
    const idle = act('Idle'), run = act('Run'), walk = act('Walk');
    if (idle) idle.setEffectiveWeight(1);
    const A = { root, model, mixer, idle, run, walk, B, mats, gear: [] };
    // life (pose): blinking, glances, breathing; each man on his own clock
    A.life = { t: Math.random() * 10, blink: 1 + Math.random() * 3, shut: 0, glance: 0, gy: 0, gp: 0, yaw: 0, pitch: 0 };
    A.paint = c => {
      const set = (n, col) => (mats[n] || []).forEach(m => { if (!m.map) m.color.setHex(col).convertSRGBToLinear(); });
      if (c.shirt !== undefined) set('Shirt', c.shirt);
      if (c.pants !== undefined) set('Pants', c.pants);
      set('Shoes', c.shoes !== undefined ? c.shoes : 0xf2f2f2); set('Socks', 0xf2f2f2);
      if (c.skin !== undefined) set('Skin', c.skin);
      if (c.hair !== undefined) { set('Hair', c.hair); set('HairBase', c.hair); }
    };
    A.paint(kit);
    // gear (gear.js): one merged mesh per piece on its bone, all sharing this man's gear material
    root.updateMatrixWorld(true);
    const ws = new T.Vector3();
    A.gearMat = std({ color: 0xffffff, roughness: 0.55, map: CK.Gear ? CK.Gear.texture(kit.team || 'mum') : null });
    // gear is sized in metres: undo the bone's own world scale (the rig's armature is scaled)
    const addTo = (b, mesh, pos, shadow) => {
      if (!b) return mesh;
      b.getWorldScale(ws);
      const s = 1 / (ws.x || 1);
      mesh.scale.multiplyScalar(s); mesh.position.copy(pos || new T.Vector3()).multiplyScalar(s);
      b.add(mesh); mesh.castShadow = !!shadow; mesh.frustumCulled = false; A.gear.push(mesh);
      return mesh;
    };
    const piece = geo => new T.Mesh(geo, A.gearMat);
    const role = kit.role || (kit.pads ? 'bat' : 'field');
    A.role = role;
    if (CK.Gear && kit.body !== 'f') {
      const Gr = CK.Gear;
      if (role === 'bat' || role === 'keeper') {
        const HY = new T.Vector3(0, Gr.HEAD.y, Gr.HEAD.z);   // the head bone sits at the mouth: the gear's frame is at the eyes
        A.helmet = addTo(B.head, piece(Gr.helmetGeo()), HY, true);
        A.helmetSeat = { parent: B.head, pos: A.helmet.position.clone(), quat: A.helmet.quaternion.clone() };
        if (role === 'keeper') A.helmet.visible = false;
      }
      if (role === 'bat' || role === 'keeper' || role === 'field') { A.cap = addTo(B.head, piece(Gr.capGeo()), new T.Vector3(0, Gr.HEAD.y, Gr.HEAD.z), false); A.cap.visible = role !== 'bat'; }
      if (role === 'ump') A.hat = addTo(B.head, piece(Gr.hatGeo()), new T.Vector3(0, Gr.HEAD.y, Gr.HEAD.z), true);
      if (role === 'bat' || role === 'keeper') {
        const kp = role === 'keeper';
        A.gloves = ['left', 'right'].map(s => addTo(B.arms[s].palm, piece(Gr.gloveGeo(s === 'right' ? 1 : -1, kp)), null, false));
        A.pads = B.legs.map(([, l]) => addTo(l, piece(Gr.padGeo(kp)), null, true));
      }
    }
    /** What he wears on his head: 'helmet' | 'cap' | 'none' (a fielder's choice, a batter's helmet off). */
    A.headwear = w => {
      if (A.helmet) A.helmet.visible = w === 'helmet';
      if (A.cap) A.cap.visible = w === 'cap';
      A.wearing = w;
      hairShow();
    };
    // hair styles (teams.js style): extra hair on the head bone in his own hair colour (the kit canvas's hair cell)
    const hairs = {};
    let hairStyle = 'short';
    function hairShow() {
      const covered = (A.wearing === 'helmet' && A.helmetAt !== 'hand' && A.helmetAt !== 'up' && A.helmetAt !== 'off') || A.wearing === 'cap';
      for (const k in hairs) hairs[k].visible = k === hairStyle && (k === 'long' || !covered);
      (mats.Hair || []).forEach(m => { m.visible = hairStyle !== 'crop'; });
    }
    A.restyle = p => {
      hairStyle = (p.style && p.style.hair) || 'short';
      if (hairStyle !== 'short' && hairStyle !== 'crop' && !hairs[hairStyle] && CK.Gear && mats.Hair && B.head) {
        const m = new T.Mesh(CK.Gear.hairGeo(hairStyle), mats.Hair[0]);
        hairs[hairStyle] = addTo(B.head, m, new T.Vector3(0, CK.Gear.HEAD.y, CK.Gear.HEAD.z), false);
      }
      hairShow();
    };
    /**
     * Where his helmet is: 'head', 'off' (put down), 'hand' (carried by the grille in his free hand,
     * the shell hanging, its face forward) or 'up' (lifted upright over his head to put it on; pose
     * keeps it over that hand). side: the hand.
     */
    A.helmetTo = (where, side) => {
      const h = A.helmet; if (!h) return;
      A.helmetHand = side || A.helmetHand || 'left';
      if (where === 'hand') {
        const palm = B.arms[A.helmetHand].palm;
        palm.getWorldScale(ws); const s = 1 / (ws.x || 1);
        palm.add(h); h.scale.setScalar(s);
        // the crown down along the fingers, the face forward (the palm's +x on the left hand, -x on the right)
        const Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(A.helmetHand === 'left' ? 1 : -1, 0, 0), X = new T.Vector3().crossVectors(Y, Z);
        h.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z));
        // the grille's bottom bar (0, -0.088, 0.12 in the helmet) in his fist (0.09 down the palm)
        h.position.set(0, 0.09, 0).addScaledVector(Y, 0.088).addScaledVector(Z, -0.12).multiplyScalar(s);
        h.visible = true; if (A.cap) A.cap.visible = false;
      } else if (where === 'up') {
        root.add(h); h.scale.setScalar(1); h.quaternion.identity(); h.visible = true;
      } else if (A.helmetSeat) {
        A.helmetSeat.parent.add(h); h.position.copy(A.helmetSeat.pos); h.quaternion.copy(A.helmetSeat.quat);
        h.scale.setScalar(1 / (A.helmetSeat.parent.getWorldScale(ws).x || 1)); h.visible = where !== 'off';
      }
      A.helmetAt = where;
      hairShow();
    };
    // a player's own look (teams.js): skin and hair colours, a taller or bigger frame (the face and kit: dress)
    const SKIN = [0xf1c8a0, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21], HAIR = { k: 0x16100a, b: 0x5a3a1e, y: 0xc9a35a, r: 0x9a4a1c, g: 0x9a9a9a };
    A.look = l => {
      if (!l) return;
      const hair = HAIR[l.hair] || HAIR.k, skin = SKIN[l.skin] !== undefined ? SKIN[l.skin] : SKIN[2];
      A.paint({ skin, hair });
      const tall = l.build === 'T' ? 1.05 : l.build === 's' ? 0.95 : 1, wide = l.build === 'h' ? 1.1 : 1;
      holder.scale.set(k * wide * tall, k * tall, k * wide * tall);
    };
    /**
     * Dress him as a real player of a side: p = { team, name, number, look, style, keeper }. His
     * shirt, trousers, shoes and face all come from one canvas (CK.Kits), made once per player and
     * shared by whoever wears it; the eyes have a second view of it for blinking.
     */
    A.dress = p => {
      if (!p || !p.team || !CK.Kits || !mats.Shirt) return;
      const key = p.team.id + '|' + p.name + '|' + (p.keeper ? 'k' : '');
      if (A.kitKey === key) { A.look(p.look); return; }
      const e = kitTexture(key, p);
      if (A.kitKey) releaseKit(A.kitKey);
      A.kitKey = key; A.kit = e;
      ['Shirt', 'Skin', 'Pants', 'Socks', 'Hair'].forEach(n => (mats[n] || []).forEach(m => { if (m.map !== e.tex) { m.map = e.tex; m.color.setHex(0xffffff); m.needsUpdate = true; } }));
      (mats.Eyes || []).forEach(m => { m.map = e.tex; m.color.setHex(0xffffff); m.needsUpdate = true; });
      A.look(p.look);
      A.style = p.style || {};
      if (A.gearMat && CK.Gear) { const t = CK.Gear.texture(p.team.id); if (A.gearMat.map !== t) { A.gearMat.map = t; A.gearMat.needsUpdate = true; } }
      // head gear: the batter's helmet, the keeper's cap, most fielders in caps (the same men every ball), the bowler bare-headed
      let h = 0; for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      if (A.role === 'bat') { if (!A.helmetAt || A.helmetAt === 'head') A.headwear('helmet'); }
      else if (A.role === 'keeper') A.headwear(p.style && p.style.hair === 'long' ? 'helmet' : 'cap');
      else if (A.role === 'field') A.headwear(h % 3 ? 'cap' : 'none');
      if (A.restyle) A.restyle(p);
    };
    /** Blink: the eyes' material looks at the shut eyes for a moment. */
    A.setBlink = shut => { if (!A.kit) return; const m = mats.Eyes && mats.Eyes[0]; if (!m) return; const want = shut ? A.kit.shut : A.kit.tex; if (m.map !== want) m.map = want; };
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
    A.rest = [B.torso, B.hips, B.head, B.neck, ...['left', 'right'].flatMap(s => [B.arms[s].upper, B.arms[s].lower, B.arms[s].palm]), ...B.legs.flat()].filter(Boolean).map(b => [b, b.quaternion.clone()]);
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
    A.root.rotation.z = st.roll || 0;   // a dive: rolled about his own forward axis (+ = to his right)
    const run = Math.min(1, st.run || 0);
    const walk = A.walk ? Math.min(1 - run, Math.max(0, st.walk || 0)) : 0;
    if (A.run && A.idle) { A.run.setEffectiveWeight(run); A.idle.setEffectiveWeight(1 - run - walk); A.run.timeScale = 0.75 + run * 0.6; }
    if (A.walk) { A.walk.setEffectiveWeight(walk); A.walk.timeScale = st.walkRate || 1; }
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
    if (st.roll) {
      // roll about the hips, not the feet: put the hips back where they were (the drop comes from st.y)
      const sn = Math.sin(st.roll), f = st.facing || 0, H = 0.9;
      A.root.position.x += Math.cos(f) * H * sn; A.root.position.z -= Math.sin(f) * H * sn;
      A.root.position.y += H * (1 - Math.cos(st.roll));
    }
    A.root.updateMatrixWorld(true);
    if (st.life !== false) life(A, st, dt || 0, run);
    if (st.arms) for (const s of ['left', 'right']) {
      const t = st.arms[s], arm = B.arms[s];
      if (!t || !arm.upper) continue;
      let elbow = t.elbow;
      if (!elbow) {
        // two-bone IK: the elbow bends out and down (CK.Anim), never through the body
        arm.upper.getWorldPosition(_sh);
        if (!arm.len) { arm.lower.getWorldPosition(_el); arm.palm.getWorldPosition(_t2); arm.len = [_sh.distanceTo(_el), _el.distanceTo(_t2)]; }
        const e = CK.Anim.solveElbow(_sh, t.hand, arm.len[0], arm.len[1], CK.Anim.elbowPole(st.facing || 0, s === 'right' ? 1 : -1));
        elbow = _el.set(e.x, e.y, e.z);
      }
      aimBone(arm.upper, arm.lower, elbow);
      aimBone(arm.lower, arm.palm, t.hand);
    }
    // a helmet being put on rides upright just over the hand lifting it
    if (A.helmetAt === 'up' && A.helmet) {
      A.B.arms[A.helmetHand || 'left'].palm.getWorldPosition(_t2); A.root.worldToLocal(_t2);
      A.helmet.position.set(_t2.x * 0.45, _t2.y + 0.02, _t2.z + 0.03);
    }
  }
  /**
   * Life: blinking, breathing, and where he looks. st.look (a world point) turns his head to it
   * (the batter on the bowler, a fielder on the ball); otherwise he glances about now and then.
   * st.lookYaw / st.lookPitch add to it (head down walking off, a look at the sky). Neck and head
   * share the turn, eased, never past what a neck does.
   */
  const _hp = new T.Vector3(), _hq = new T.Quaternion(), _hf = new T.Vector3(), _hs = new T.Vector3();
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  function life(A, st, dt, run) {
    const L = A.life, B = A.B;
    L.t += dt;
    L.blink -= dt;
    if (L.blink <= 0) { L.shut = 0.12; L.blink = Math.random() < 0.12 ? 0.3 : 1.6 + Math.random() * 3.6; }
    if (L.shut > 0) L.shut -= dt;
    if (A.setBlink) A.setBlink(L.shut > 0 || !!st.eyesShut);
    if (!B.head || !B.torso) return;
    // breathing: the chest rises and falls, deeper for a while after running
    L.puff = Math.max(run, (L.puff || 0) - dt * 0.12);
    const br = Math.sin(L.t * (1.6 + L.puff * 1.6)) * (0.012 + L.puff * 0.02) * (1 - run);
    if (Math.abs(br) > 1e-4) turnBone(B.torso, _side, br);
    B.head.getWorldPosition(_hp); B.head.getWorldQuaternion(_hq);
    _hf.set(0, 0, 1).applyQuaternion(_hq);
    const curY = Math.atan2(_hf.x, _hf.z), curP = Math.asin(Math.max(-1, Math.min(1, _hf.y)));
    let wy, wp;
    if (st.look) {
      const dx = st.look.x - _hp.x, dy = st.look.y - _hp.y, dz = st.look.z - _hp.z;
      wy = wrapPi(Math.atan2(dx, dz) - curY); wp = Math.atan2(dy, Math.hypot(dx, dz)) - curP;
    } else {
      L.glance -= dt;
      if (L.glance <= 0) {
        L.glance = 1.4 + Math.random() * 3.4;
        const still = Math.random() < 0.35;
        L.gy = still ? 0 : (Math.random() - 0.5) * 1.2; L.gp = still ? 0 : (Math.random() - 0.4) * 0.3;
      }
      wy = L.gy * (1 - run * 0.8); wp = L.gp * (1 - run * 0.8);
    }
    wy = Math.max(-1.15, Math.min(1.15, wy + (st.lookYaw || 0)));
    wp = Math.max(-0.55, Math.min(0.5, wp + (st.lookPitch || 0)));
    const k = 1 - Math.exp(-dt * (st.look ? 7 : 4));
    L.yaw += (wy - L.yaw) * k; L.pitch += (wp - L.pitch) * k;
    if (B.neck) turnBone(B.neck, UP, L.yaw * 0.4);
    turnBone(B.head, UP, L.yaw * (B.neck ? 0.6 : 1));
    _hs.set(1, 0, 0).applyAxisAngle(UP, curY + L.yaw);
    turnBone(B.head, _hs, -L.pitch);
    B.head.updateMatrixWorld(true);
  }

  /**
   * A bat in his hand (the striker's play bat, or a man's own): side 'left'|'right', style 'carry'
   * (by the handle, the blade swinging forward-down with the arm, walking), 'drag' (hanging low,
   * walking off), 'rest' (his hand on the top of the handle, the toe on the turf). Sets the bat's
   * world position and rotation (the bat's frame: origin at the top hand, blade along -z, face +y).
   */
  const _p0 = new T.Vector3(), _p1 = new T.Vector3(), _fa = new T.Vector3(), _bf = new T.Vector3(), _br = new T.Vector3(), _bd = new T.Vector3(), _by = new T.Vector3(), _bx = new T.Vector3(), _bm = new T.Matrix4();
  function holdBat(A, side, bat, style, o) {
    const arm = A.B.arms[side]; if (!arm || !arm.palm) return;
    arm.palm.getWorldPosition(_p1); arm.lower.getWorldPosition(_p0);
    _fa.subVectors(_p1, _p0).normalize();                         // the forearm, elbow to wrist
    const f = A.root.rotation.y, s = side === 'right' ? 1 : -1;
    _bf.set(Math.sin(f), 0, Math.cos(f)); _br.set(-Math.cos(f), 0, Math.sin(f));   // his forward and right
    const grip = _p1.addScaledVector(_fa, 0.06);
    if (style === 'rest') {
      // the toe on the ground ahead and to the side of the hand
      const toe = _p0.copy(grip).addScaledVector(_bf, 0.32).addScaledVector(_br, s * 0.08); toe.y = 0.02;
      _bd.subVectors(toe, grip).normalize();
    } else {
      const fwd = style === 'drag' ? 0.35 : 0.9;
      _bd.copy(_fa).multiplyScalar(0.6).addScaledVector(_bf, fwd).normalize();
    }
    if (o && o.tilt) _bd.addScaledVector(_br, o.tilt * s).normalize();
    // the face toward his leg
    _by.copy(_br).multiplyScalar(-s).addScaledVector(_bd, -_br.dot(_bd) * -s).normalize();
    if (o && o.twirl) _by.applyAxisAngle(_bd, o.twirl);
    _bx.crossVectors(_by, _bd.clone().negate());
    _bm.makeBasis(_bx, _by, _bd.clone().negate());
    bat.quaternion.setFromRotationMatrix(_bm);
    // the hand holds the handle a little below its top (rest: right on the top)
    bat.position.copy(grip).addScaledVector(_bd, style === 'rest' ? -0.02 : -0.12);
    bat.visible = true;
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
    const uni = { uTime: { value: 0 }, uExcite: { value: 0 }, uWaveA: { value: 0 }, uWaveOn: { value: 0 } };
    const mat = new T.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, side: T.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aCell; attribute float aRy; attribute float aPh; uniform float uTime; uniform float uExcite; uniform float uWaveA; uniform float uWaveOn;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          float up = (uExcite > 0.3 && sin(aPh * 13.7) > 1.1 - min(1.0, uExcite) * 1.3) ? 1.0 : 0.0;
          { vec3 cw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float d = atan(cw.x, cw.z + 10.06) - uWaveA; d = atan(sin(d), cos(d));
            if (uWaveOn > 0.5 && abs(d) < 0.22) up = 1.0; }
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
    crowd.impUpdate = () => { uni.uTime.value = crowd.t; uni.uExcite.value = crowd.excite; uni.uWaveA.value = crowd.wave ? crowd.wave.a : 0; uni.uWaveOn.value = crowd.wave && crowd.wave.t > 0 ? 1 : 0; };
  }

  Object.assign(CK, { holdBat, makeBat, makeBall, makeTrail, makeAthlete, poseAthlete: pose, boneWorld, aimBone, bakeCrowdAtlas, crowdImpostors });
})();
