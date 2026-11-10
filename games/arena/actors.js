/*
 * Duskwater - actors (the player and every bot share this), their bodies (animated SWAT soldiers,
 * box soldiers as the fallback) and the bot brain.
 *
 * Bots perceive through a view cone plus line-of-sight rays, react after a delay, aim with an
 * error that shrinks while they track you, fire in bursts, fall back to cover when hurt or dry,
 * then peek back out. Between fights they push a lane, sometimes hold an angle, and late in the
 * round they hunt so rounds always finish.
 */
(function (global) {
  'use strict';
  const T = global.THREE, M = global.ArenaMap, R = global.ArenaRules, BA = global.ArenaBotAim;

  const TEAMS = [
    { name: 'Wardens', short: 'WRD', color: '#58c7d8', hex: 0x58c7d8, names: ['Bram', 'Cole', 'Dace', 'Ines', 'Juno'],
      jacket: 0x2f5e74, vest: 0x24323c, pants: 0x2c3239, hat: 0x3e4c43, visor: 0x6fe6ff },
    { name: 'Corsairs', short: 'CRS', color: '#f0a050', hex: 0xf0a050, names: ['Rook', 'Vane', 'Silt', 'Moth', 'Pike'],
      jacket: 0x8a4b2c, vest: 0x3b2d25, pants: 0x3d3732, hat: 0x9c2f26, visor: 0xffb347 },
  ];

  // difficulty tables and the reaction / aim / turning model live in botaim.js (tested in Node)
  const DIFF = BA.DIFF;

  const rand = (a, b) => a + Math.random() * (b - a);
  const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------ character model

  const geoCache = {};
  function geo(w, h, d, oy = 0) {
    const k = [w, h, d, oy].join(',');
    if (!geoCache[k]) { geoCache[k] = new T.BoxGeometry(w, h, d); if (oy) geoCache[k].translate(0, oy, 0); }
    return geoCache[k];
  }
  const matCache = {};
  function mat(hex, emissive) {
    const k = hex + (emissive ? 'e' : '');
    if (!matCache[k]) matCache[k] = emissive ? new T.MeshBasicMaterial({ color: hex }) : new T.MeshLambertMaterial({ color: hex });
    return matCache[k];
  }
  let blobTex = null, markerTex = null;
  function blobMaterial() {
    if (!blobTex) blobTex = global.ArenaWorld.canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, false);
    return new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  }
  function markerMaterial(color) {
    if (!markerTex) markerTex = global.ArenaWorld.canvasTex(64, (g, s) => {
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(s * 0.2, s * 0.25); g.lineTo(s * 0.8, s * 0.25); g.lineTo(s * 0.5, s * 0.75); g.closePath(); g.fill();
    }, false);
    return new T.SpriteMaterial({ map: markerTex, color, depthTest: false, transparent: true, opacity: 0.85, fog: false });
  }

  /** The old box soldier: the fallback when the SWAT model is unavailable. */
  function makeBoxCharacter(team) {
    const t = TEAMS[team];
    const root = new T.Group(); root.rotation.order = 'YXZ';
    const hips = new T.Group(); hips.position.y = 0.9; root.add(hips);
    const leg = x => { const m = new T.Mesh(geo(0.17, 0.9, 0.2, -0.45), mat(t.pants)); m.position.set(x, 0, 0); hips.add(m); return m; };
    const legL = leg(-0.11), legR = leg(0.11);
    [legL, legR].forEach(l => { const boot = new T.Mesh(geo(0.18, 0.14, 0.27, -0.83), mat(0x1c1c1e)); boot.position.z = -0.03; l.add(boot); });
    const torso = new T.Mesh(geo(0.46, 0.56, 0.26, 0.28), mat(t.jacket)); hips.add(torso);
    const vest = new T.Mesh(geo(0.48, 0.36, 0.3, 0.36), mat(t.vest)); hips.add(vest);
    const head = new T.Group(); head.position.y = 0.6; hips.add(head);
    head.add(new T.Mesh(geo(0.24, 0.27, 0.25, 0.135), mat(0x2a2624)));
    const visor = new T.Mesh(geo(0.2, 0.06, 0.03), mat(t.visor, true)); visor.position.set(0, 0.17, -0.13); head.add(visor);
    if (team === 0) { // helmet with brim
      const h = new T.Mesh(geo(0.29, 0.13, 0.3, 0.06), mat(t.hat)); h.position.y = 0.21; head.add(h);
      const brim = new T.Mesh(geo(0.3, 0.03, 0.08), mat(t.hat)); brim.position.set(0, 0.22, -0.17); head.add(brim);
    } else { // knit cap and scarf
      const h = new T.Mesh(geo(0.26, 0.12, 0.27, 0.06), mat(t.hat)); h.position.y = 0.22; head.add(h);
      const sc = new T.Mesh(geo(0.27, 0.08, 0.27), mat(0x5a2a22)); sc.position.y = 0.03; head.add(sc);
      const pack = new T.Mesh(geo(0.32, 0.36, 0.14, 0.18), mat(0x4a4036)); pack.position.set(0, 0.12, 0.2); hips.add(pack);
    }
    const arms = new T.Group(); arms.position.set(0, 0.48, 0); hips.add(arms);
    const armR = new T.Mesh(geo(0.12, 0.12, 0.42), mat(t.jacket)); armR.position.set(0.2, -0.08, -0.2); arms.add(armR);
    const armL = new T.Mesh(geo(0.12, 0.12, 0.5), mat(t.jacket)); armL.position.set(-0.12, -0.08, -0.3); armL.rotation.y = -0.35; arms.add(armL);
    const gun = new T.Group(); gun.position.set(0.08, -0.06, -0.42); arms.add(gun);
    const gunBody = new T.Mesh(geo(0.07, 0.11, 0.62), mat(0x24272b)); gun.add(gunBody);
    const gunMag = new T.Mesh(geo(0.05, 0.16, 0.08, -0.08), mat(0x24272b)); gunMag.position.set(0, -0.04, -0.05); gun.add(gunMag);
    const muzzle = new T.Object3D(); muzzle.position.set(0, 0.02, -0.34); gun.add(muzzle);
    const blob = new T.Mesh(new T.PlaneGeometry(1.1, 1.1), blobMaterial()); blob.rotation.x = -Math.PI / 2;
    const marker = new T.Sprite(markerMaterial(t.hex)); marker.scale.set(0.28, 0.28, 1); marker.visible = false;
    root.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return { root, hips, legL, legR, head, arms, gun, gunBody, muzzle, blob, marker, phase: 0, kick: 0, fall: 0 };
  }

  // ------------------------------------------------------------ SWAT soldier (glTF, skinned)

  /*
   * Quaternius' SWAT model, one clone per bot (SkeletonUtils), tinted per team. Each bot carries
   * all four gun models in its right hand and shows the one it is using. Animation follows the
   * actor: idle / aim / shoot, run in four directions by velocity relative to facing, walk, hit
   * reaction, death. Aim pitch and crouch are layered on the bones after the mixer so the body
   * matches the hit volumes in rayHit().
   */
  const TEAM_TINT = [
    { Swat: 0x4d6a8a, Swat_Black: 0x22262c, Visor: 0x6fe6ff },   // Wardens: navy blue
    { Swat: 0x8a7552, Swat_Black: 0x2e261e, Visor: 0xffb347 },   // Corsairs: desert tan
  ];
  // gun models in a bot's hand: source model, mesh node to take, forward axis, length (m), grip point
  const BOT_GUNS = {
    tern:     { file: 'glock', fwd: '-z', len: 0.19, grip: 0.78 },
    skiff:    { file: 'mpx', fwd: '-z', len: 0.6, grip: 0.58 },
    breaker:  { file: 'akm_rig', node: 'AKM_model', fwd: '+x', len: 0.88, grip: 0.62 },
    longline: { file: 'm21', fwd: '-z', len: 1.1, grip: 0.62 },
  };
  const CLIP = n => 'CharacterArmature|' + n;
  let swatProto = null, swatTried = false;

  /** Merge [{ geo, mm (Matrix4) }] into one non-indexed geometry with position, normal and uv. */
  function mergeGeometries(list) {
    const pos = [], nor = [], uv = [], v = new T.Vector3(), nm = new T.Matrix3();
    for (const { geo, mm } of list) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      nm.getNormalMatrix(mm);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(mm); pos.push(v.x, v.y, v.z);
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); } else nor.push(0, 1, 0);
        if (U) uv.push(U.getX(i), U.getY(i)); else uv.push(0, 0);
      }
      if (g !== geo) g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  const GUN_LOD_DIST = 7;
  const _avgCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  /** Average colour of a texture (sRGB image -> linear), white when it cannot be read. */
  function textureAverage(tex) {
    const c = new T.Color(1, 1, 1), img = tex && tex.image;
    if (!img || !_avgCanvas) return c;
    try {
      _avgCanvas.width = _avgCanvas.height = 8;
      const g = _avgCanvas.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, 8, 8); g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4 * 255;
      c.setRGB(r / n, gg / n, b / n);
      if (c.convertSRGBToLinear) c.convertSRGBToLinear();
    } catch (e) { /* tainted or not decoded: plain white */ }
    return c;
  }
  /** One vertex-coloured mesh for a gun's material buckets (Map material -> [{ geo, mm }]). */
  function gunLowDetail(buckets) {
    if (buckets.size < 2) return null;
    const parts = [], cols = [];
    let rough = 0, metal = 0, wsum = 0;
    buckets.forEach((list, mat) => {
      const g = mergeGeometries(list), n = g.attributes.position.count;
      const c = (mat.color ? mat.color.clone() : new T.Color(1, 1, 1)).multiply(textureAverage(mat.map));
      parts.push(g); cols.push(c);
      rough += (mat.roughness != null ? mat.roughness : 0.6) * n; metal += (mat.metalness || 0) * n; wsum += n;
    });
    const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    parts.forEach((g, i) => {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      for (let k = 0; k < n; k++) col.set([cols[i].r, cols[i].g, cols[i].b], (o + k) * 3);
      o += n; g.dispose();
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const first = buckets.keys().next().value;
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: rough / wsum, metalness: metal / wsum, envMap: first.envMap || null, envMapIntensity: first.envMapIntensity != null ? first.envMapIntensity : 1 });
    const m = new T.Mesh(geo, mat); m.castShadow = false;
    return m;
  }

  /** A static copy of a (possibly skinned) gun, muzzle along -z, grip at the origin, with a 'muzzle' child. */
  function gunTemplate(assets, id) {
    const c = BOT_GUNS[id], g = assets.gltf[c.file];
    if (!g) return null;
    const out = new T.Group(); out.name = 'gun_' + id;
    const turn = new T.Group(); if (c.fwd === '+x') turn.rotation.y = Math.PI / 2;
    out.add(turn);
    let src = g.scene;
    if (c.node) { src.traverse(o => { if (o.name === c.node) src = o; }); if (src === g.scene) return null; }
    src.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(src.matrixWorld).invert();
    const FINISH = global.ArenaFx.FINISH, mats = new Map();
    const finish = mat => { // same real-finish re-tint as the first-person guns
      const f = FINISH[mat.name];
      if (!f) return mat;
      if (!mats.has(mat)) { const c = mat.clone(); c.color.setHex(f[0]); c.roughness = f[1]; c.metalness = f[2]; mats.set(mat, c); }
      return mats.get(mat);
    };
    // bake every mesh (skinned ones in bind pose) into one static mesh per material: a gun is
    // one to a few draw calls per bot instead of dozens
    const buckets = new Map();
    src.traverse(o => {
      if (!o.isMesh) return;
      const mm = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      if (Array.isArray(o.material)) { const m = new T.Mesh(o.geometry, o.material.map(finish)); m.matrixAutoUpdate = false; m.matrix.copy(mm); turn.add(m); return; }
      const mat = finish(o.material);
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push({ geo: o.geometry, mm });
    });
    buckets.forEach((list, mat) => { const m = new T.Mesh(mergeGeometries(list), mat); m.castShadow = false; turn.add(m); });
    const FX = global.ArenaFx;
    const ms = FX.measureGun(out, out, 0.5, 0.5);
    // past a few metres a gun in a soldier's hand is a few dozen pixels: draw it as one mesh
    // (each part's colour baked per vertex) instead of one draw call per material
    const low = gunLowDetail(buckets);
    if (low) {
      const hi = new T.Group(); turn.children.slice().forEach(ch => hi.add(ch));
      const lod = new T.LOD(); lod.addLevel(hi, 0); lod.addLevel(low, GUN_LOD_DIST);
      turn.add(lod);
    }
    const k = c.len / ms.L;
    const grip = new T.Vector3((ms.box.min.x + ms.box.max.x) / 2, ms.box.min.y + (ms.box.max.y - ms.box.min.y) * 0.45, ms.box.min.z + ms.L * c.grip);
    const fit = new T.Group(); fit.add(turn); out.add(fit);
    fit.scale.setScalar(k); fit.position.copy(grip).multiplyScalar(-k);
    const muzzle = new T.Object3D(); muzzle.name = 'muzzle'; muzzle.position.copy(ms.muzzle).sub(grip).multiplyScalar(k); out.add(muzzle);
    return out;
  }

  /** Build the shared prototype once: the SWAT scene with the four guns seated in the right hand. */
  function buildSwatProto(assets) {
    swatTried = true;
    const g = assets && assets.gltf && assets.gltf.swat, SU = T.SkeletonUtils;
    if (!g || !SU || !global.ArenaFx) return null;
    const scene = SU.clone(g.scene);
    const wrist = scene.getObjectByName('WristR'), fore = scene.getObjectByName('LowerArmR');
    if (!wrist || !fore) return null;
    // pose: arm pointing, then work out how a gun pointing straight ahead sits in the hand
    const mixer = new T.AnimationMixer(scene), clip = g.animations.find(a => a.name === CLIP('Idle_Gun_Pointing'));
    if (clip) { mixer.clipAction(clip).play(); mixer.update(0.05); }
    scene.updateMatrixWorld(true);
    const wp = new T.Vector3(), fp = new T.Vector3();
    wrist.getWorldPosition(wp); fore.getWorldPosition(fp);
    const along = wp.clone().sub(fp).normalize();
    const want = new T.Matrix4().compose(wp.clone().addScaledVector(along, 0.07).add(new T.Vector3(0, 0.01, 0)),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI), new T.Vector3(1, 1, 1)); // model faces +z, guns -z
    const local = new T.Matrix4().copy(wrist.matrixWorld).invert().multiply(want);
    Object.keys(BOT_GUNS).forEach(id => {
      const t = gunTemplate(assets, id);
      if (!t) return;
      local.decompose(t.position, t.quaternion, t.scale);
      t.visible = false;
      wrist.add(t);
    });
    mixer.stopAllAction();
    const clips = {};
    g.animations.forEach(a => { clips[a.name.replace('CharacterArmature|', '')] = a; });
    return { scene, clips };
  }

  function teamMaterials(proto, team) {
    proto.mats = proto.mats || {};
    if (proto.mats[team]) return proto.mats[team];
    const tint = TEAM_TINT[team] || TEAM_TINT[0], out = {};
    proto.scene.traverse(o => {
      if (!o.isMesh || !o.isSkinnedMesh) return;
      const m = o.material;
      if (out[m.name]) return;
      const c = m.clone();
      if (tint[m.name] != null) c.color.setHex(tint[m.name]);
      if (m.name === 'Visor') { c.emissive = new T.Color(tint.Visor); c.emissiveIntensity = 0.25; }
      c.roughness = Math.max(0.55, c.roughness); c.envMapIntensity = 0.7;
      out[m.name] = c;
    });
    proto.mats[team] = out;
    return out;
  }

  const _qa = new T.Quaternion(), _qp = new T.Quaternion(), _va = new T.Vector3(), _vb = new T.Vector3(), _vc = new T.Vector3();
  const _axis = new T.Vector3(), _off = new T.Vector3(), _inv = new T.Matrix4();
  /** Rotate a bone by `angle` around a world-space axis (parent world rotation must be current). */
  function rotWorld(bone, axis, angle) {
    if (!bone || !angle) return;
    bone.parent.getWorldQuaternion(_qp);
    _va.copy(axis).applyQuaternion(_qp.invert()).normalize();
    _qa.setFromAxisAngle(_va, angle);
    bone.quaternion.premultiply(_qa);
  }
  /** Move a bone by a world-space offset. */
  function moveWorld(bone, offset) {
    if (!bone) return;
    bone.parent.getWorldPosition(_vb); // also brings the parent's world matrix up to date
    _inv.copy(bone.parent.matrixWorld).invert();
    _vc.copy(_vb).add(offset).applyMatrix4(_inv);
    _vb.applyMatrix4(_inv);
    bone.position.add(_vc.sub(_vb));
  }

  /*
   * The soldier comes as nine skinned meshes (one per material), which is nine draw calls per
   * soldier per view: with four split-screen views that is the biggest cost in a frame. All nine
   * share one skeleton, bind pose and transform and are flat-coloured, so they merge into one
   * skinned mesh with the (team-tinted) colours in the vertices. Returns null when the model does
   * not fit that shape, and the nine meshes are used as they are.
   */
  function mergedSoldier(proto, team) {
    proto.merged = proto.merged || {};
    if (proto.merged[team] !== undefined) return proto.merged[team];
    const parts = [];
    proto.scene.updateMatrixWorld(true);
    proto.scene.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
    const a = parts[0];
    const same = (m, n) => m.elements.every((v, i) => Math.abs(v - n.elements[i]) < 1e-5);
    const ok = parts.length > 1 && parts.every(p => p.geometry.index && p.skeleton.bones.length === a.skeleton.bones.length &&
      p.skeleton.bones.every((b, i) => b === a.skeleton.bones[i]) && same(p.bindMatrix, a.bindMatrix) && same(p.matrixWorld, a.matrixWorld));
    if (!ok) { proto.merged[team] = null; return null; }
    const tint = TEAM_TINT[team] || TEAM_TINT[0];
    let nv = 0, ni = 0;
    parts.forEach(p => { nv += p.geometry.attributes.position.count; ni += p.geometry.index.count; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), idx = new Uint32Array(ni);
    const c = new T.Color();
    let v0 = 0, i0 = 0;
    parts.forEach(p => {
      const g = p.geometry, n = g.attributes.position.count, name = p.material.name;
      if (name === 'Visor') c.setHex(tint.Visor).multiplyScalar(0.3).add(new T.Color(p.material.color));
      else if (tint[name] != null) c.setHex(tint[name]); else c.copy(p.material.color);
      for (let k = 0; k < n; k++) {
        pos.set([g.attributes.position.getX(k), g.attributes.position.getY(k), g.attributes.position.getZ(k)], (v0 + k) * 3);
        nor.set([g.attributes.normal.getX(k), g.attributes.normal.getY(k), g.attributes.normal.getZ(k)], (v0 + k) * 3);
        col.set([c.r, c.g, c.b], (v0 + k) * 3);
        si.set([g.attributes.skinIndex.getX(k), g.attributes.skinIndex.getY(k), g.attributes.skinIndex.getZ(k), g.attributes.skinIndex.getW(k)], (v0 + k) * 4);
        sw.set([g.attributes.skinWeight.getX(k), g.attributes.skinWeight.getY(k), g.attributes.skinWeight.getZ(k), g.attributes.skinWeight.getW(k)], (v0 + k) * 4);
      }
      const ix = g.index;
      for (let k = 0; k < ix.count; k++) idx[i0 + k] = ix.getX(k) + v0;
      v0 += n; i0 += ix.count;
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius *= 1.7; // room for every clip, the death fall included (per-view culling)
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.7 });
    proto.merged[team] = { geo, mat, names: parts.map(p => p.name) };
    return proto.merged[team];
  }

  function makeSwat(team, assets) {
    if (!swatTried) swatProto = buildSwatProto(assets);
    const P = swatProto;
    if (!P) return null;
    const SU = T.SkeletonUtils;
    const body = SU.clone(P.scene);
    body.rotation.y = Math.PI; // the model faces +z, actors face -z at yaw 0
    const mats = teamMaterials(P, team);
    body.traverse(o => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) {
        // culled per view against a bind-pose sphere grown to cover every clip (runs, the death
        // fall): with split screen each soldier would otherwise be drawn in every view, even behind
        const g = o.geometry;
        if (!g.userData.cullSphere) {
          g.computeBoundingSphere();
          g.boundingSphere.radius *= 1.7;
          g.userData.cullSphere = true;
        }
        o.frustumCulled = true;
        if (mats[o.material.name]) o.material = mats[o.material.name];
      }
      o.castShadow = false; o.receiveShadow = false;
    });
    const merged = mergedSoldier(P, team);
    if (merged) {
      const parts = [];
      body.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
      const first = parts[0];
      const one = new T.SkinnedMesh(merged.geo, merged.mat);
      one.name = 'SwatMerged';
      first.parent.add(one);
      one.position.copy(first.position); one.quaternion.copy(first.quaternion); one.scale.copy(first.scale);
      one.bind(new T.Skeleton(first.skeleton.bones, first.skeleton.boneInverses), first.bindMatrix);
      one.castShadow = false; one.receiveShadow = false;
      parts.forEach(p => p.parent.remove(p));
    }
    const root = new T.Group(); root.rotation.order = 'YXZ'; root.add(body);
    const mixer = new T.AnimationMixer(body);
    const actions = {};
    Object.keys(P.clips).forEach(n => { actions[n] = mixer.clipAction(P.clips[n]); });
    ['Death', 'HitRecieve'].forEach(n => { if (actions[n]) { actions[n].setLoop(T.LoopOnce, 1); actions[n].clampWhenFinished = true; } });
    const bones = {};
    ['Body', 'Chest', 'Neck', 'Torso', 'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR'].forEach(n => { bones[n] = body.getObjectByName(n); });
    const guns = {};
    Object.keys(BOT_GUNS).forEach(id => { guns[id] = body.getObjectByName('gun_' + id); });
    const blob = new T.Mesh(new T.PlaneGeometry(1.0, 1.0), blobMaterial()); blob.rotation.x = -Math.PI / 2;
    const marker = new T.Sprite(markerMaterial(TEAMS[team].hex)); marker.scale.set(0.28, 0.28, 1); marker.visible = false;
    const fallbackMuzzle = new T.Object3D(); fallbackMuzzle.position.set(0.2, 1.35, -0.6); root.add(fallbackMuzzle);
    const m = {
      root, blob, marker, kick: 0, fall: 0, muzzle: fallbackMuzzle, swat: true,
      mixer, actions, cur: null, gunId: null, lastFire: -9, hitT: 0, dead: false,
      play(name, fade = 0.2, scale = 1) {
        const a = actions[name] || actions.Idle_Gun;
        if (!a) return;
        a.timeScale = scale;
        if (this.cur === a) return;
        a.reset().setEffectiveWeight(1).fadeIn(fade).play();
        if (this.cur) this.cur.fadeOut(fade);
        this.cur = a;
      },
      onFire(t) { this.lastFire = t; },
      onHit() { if (!this.dead) this.hitT = 0.32; },
      update(actor, dt, now) {
        if (this.gunId !== actor.weaponId) {
          // hidden guns also skip their matrix updates
          Object.keys(guns).forEach(id => { if (guns[id]) guns[id].visible = guns[id].matrixWorldAutoUpdate = id === actor.weaponId; });
          this.gunId = actor.weaponId;
          const g = guns[actor.weaponId];
          this.muzzle = (g && g.getObjectByName('muzzle')) || fallbackMuzzle;
        }
        const vx = actor.vel.x, vz = actor.vel.z, sp = Math.hypot(vx, vz);
        const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw), rx = Math.cos(actor.yaw), rz = -Math.sin(actor.yaw);
        const fwd = vx * fx + vz * fz, side = vx * rx + vz * rz;
        const shooting = now - this.lastFire < 0.35, engaged = now - this.lastFire < 2.5 || (actor.bot && actor.bot.mode === 'engage');
        this.hitT -= dt;
        if (!actor.alive) {
          if (!this.dead) { this.dead = true; this.play('Death', 0.1); }
        } else {
          if (this.dead) { this.dead = false; this.cur = null; mixer.stopAllAction(); }
          if (this.hitT > 0 && sp < 1.5) this.play('HitRecieve', 0.06);
          else if (sp > 0.6 && actor.crouch < 0.5) {
            if (Math.abs(fwd) >= Math.abs(side)) {
              if (fwd < 0) this.play('Run_Back', 0.2, sp / 4.2);
              else if (sp < 2.9) this.play('Walk', 0.2, sp / 1.7);
              else this.play(shooting ? 'Run_Shoot' : 'Run', 0.2, sp / 4.6);
            } else this.play(side > 0 ? 'Run_Right' : 'Run_Left', 0.2, sp / 4.2);
          } else this.play(shooting ? 'Idle_Gun_Shoot' : engaged || actor.crouch > 0.5 ? 'Idle_Gun_Pointing' : 'Idle_Gun', 0.25);
        }
        mixer.update(dt);
        // procedural layers: aim pitch through the spine, crouch through the legs
        if (actor.alive) {
          _axis.set(rx, 0, rz);
          const pitch = actor.pitch + this.kick * 0.5;
          rotWorld(bones.Chest, _axis, pitch * 0.65);
          rotWorld(bones.Neck, _axis, pitch * 0.35);
          const c = actor.crouch;
          if (c > 0.02) {
            moveWorld(bones.Body, _off.set(0, -0.42 * c, 0));
            rotWorld(bones.UpperLegL, _axis, 1.35 * c); rotWorld(bones.UpperLegR, _axis, 1.2 * c);
            rotWorld(bones.LowerLegL, _axis, -2.0 * c); rotWorld(bones.LowerLegR, _axis, -1.85 * c);
          }
        }
      },
    };
    return m;
  }

  /** A bot's body: the SWAT soldier when it loaded, else the box soldier. */
  function makeCharacter(team, assets) {
    let m = null;
    try { m = makeSwat(team, assets); } catch (e) { console.warn('Duskwater: soldier model fallback', e); }
    return m || makeBoxCharacter(team);
  }

  // ------------------------------------------------------------ actor

  let nextId = 1;
  class Actor {
    constructor(name, team, isPlayer) {
      this.id = nextId++; this.name = name; this.team = team; this.isPlayer = isPlayer;
      this.pos = { x: 0, y: 0, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
      this.yaw = 0; this.pitch = 0; this.onGround = true; this.crouch = 0; this.crouching = false; this.walking = false;
      this.hp = 100; this.armor = 0; this.alive = true; this.money = R.ECONOMY.start;
      this.primary = null; this.slot = 'sidearm'; this.ammo = {};
      this.reloadT = 0; this.drawT = 0; this.nextFireT = 0; this.shotsInBurst = 0; this.lastShotT = -9;
      this.kills = 0; this.deaths = 0; this.assists = 0; this.hs = 0; this.shots = 0; this.hits = 0; this.dmg = 0;
      this.roundKills = 0; this.damagers = {}; this.stepDist = 0; this.spotted = 0; this.deathT = 0;
      this.model = null; this.bot = null; this.ph = null; // ph: the human player's view state (game.js)
      this.giveWeapon('tern');
    }
    get weaponId() { return this.slot === 'primary' && this.primary ? this.primary : 'tern'; }
    get weapon() { return R.WEAPONS[this.weaponId]; }
    giveWeapon(id) {
      const w = R.WEAPONS[id];
      this.ammo[id] = { mag: w.mag, reserve: w.reserve };
      if (w.slot === 'primary') { this.primary = id; this.slot = 'primary'; }
      else if (!this.primary) this.slot = 'sidearm';
      this.reloadT = 0; this.drawT = w.draw;
    }
    eyeY() { return this.pos.y + 1.62 - 0.5 * this.crouch; }
    height() { return 1.8 - 0.5 * this.crouch; }
    refill() { for (const id of Object.keys(this.ammo)) { const w = R.WEAPONS[id]; this.ammo[id] = { mag: w.mag, reserve: w.reserve }; } }
    totalHp() { return this.alive ? this.hp : 0; }

    /** Ray vs this actor's hit volumes: head sphere, body box (legs below the hips). { t, zone } or null. */
    rayHit(ox, oy, oz, dx, dy, dz, maxT) {
      if (!this.alive) return null;
      const ey = this.eyeY();
      // head sphere
      const hx = this.pos.x, hy = ey + 0.02, hz = this.pos.z, r = 0.17;
      const lx = ox - hx, ly = oy - hy, lz = oz - hz;
      const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - c;
      let best = null;
      if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, zone: 'head' }; }
      const box = { x0: this.pos.x - 0.27, x1: this.pos.x + 0.27, z0: this.pos.z - 0.27, z1: this.pos.z + 0.27, y0: this.pos.y, y1: ey - 0.15 };
      const h = M.rayBox(ox, oy, oz, dx, dy, dz, box, best ? best.t : maxT);
      if (h) {
        const y = oy + dy * h.t;
        best = { t: h.t, zone: y < this.pos.y + 0.85 - 0.4 * this.crouch ? 'legs' : 'body' };
      }
      return best;
    }

    syncModel(dt, now = 0) {
      const m = this.model; if (!m) return;
      if (m.swat) {
        m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
        m.root.rotation.y = this.yaw;
        m.kick *= Math.exp(-14 * dt);
        // a soldier no camera can see keeps its clock but skips posing (game.js: refreshOnScreen)
        if (m.offscreen) m.pendDt = (m.pendDt || 0) + dt;
        else { m.update(this, dt + (m.pendDt || 0), now); m.pendDt = 0; }
        m.blob.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
        m.blob.visible = this.alive;
        if (!this.alive) m.marker.visible = false;
        m.marker.position.set(this.pos.x, this.pos.y + this.height() + 0.45, this.pos.z);
        return;
      }
      m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      m.root.rotation.y = this.yaw;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      m.phase += sp * dt * 2.3;
      const sw = Math.min(1, sp / 4) * 0.65;
      m.legL.rotation.x = Math.sin(m.phase) * sw; m.legR.rotation.x = -Math.sin(m.phase) * sw;
      m.hips.position.y = 0.9 - 0.42 * this.crouch + Math.abs(Math.cos(m.phase)) * 0.03 * Math.min(1, sp / 4);
      const ls = 1 - 0.46 * this.crouch; m.legL.scale.y = m.legR.scale.y = ls;
      m.kick *= Math.exp(-14 * dt);
      m.arms.rotation.x = this.pitch * 0.9 + m.kick;
      m.head.rotation.x = this.pitch * 0.4;
      const wid = this.weaponId;
      m.gunBody.scale.z = wid === 'tern' ? 0.35 : wid === 'skiff' ? 0.7 : wid === 'longline' ? 1.35 : 1;
      m.blob.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
      if (!this.alive) {
        m.fall = Math.min(1, m.fall + dt * 2.6);
        const e = 1 - Math.pow(1 - m.fall, 3);
        m.root.rotation.x = e * Math.PI / 2 * 0.96;
        m.root.position.y = this.pos.y + 0.1 * e;
        m.legL.rotation.x = m.legR.rotation.x = 0;
        m.blob.visible = false; m.marker.visible = false;
      } else {
        m.root.rotation.x = 0; m.fall = 0; m.blob.visible = true;
      }
      m.marker.position.set(this.pos.x, this.pos.y + this.height() + 0.45, this.pos.z);
    }
    muzzleWorld(out) { if (!this.model) return out.set(this.pos.x, this.eyeY() - 0.2, this.pos.z); this.model.muzzle.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.model.muzzle.matrixWorld); }
  }

  // ------------------------------------------------------------ bot brain

  class Bot {
    constructor(actor, diffName) {
      this.a = actor; this.setDifficulty(diffName);
      this.reset();
    }
    setDifficulty(n) { this.dn = DIFF[n] ? n : 'recruit'; this.d = BA.get(n); }
    reset() {
      this.mode = 'advance'; this.path = null; this.pathIdx = 0; this.goal = null; this.repathT = 0;
      this.target = null; this.visible = false; this.lostT = 9; this.reaction = 0; this.errMag = 0; this.errAng = 0;
      this.lastKnown = null; this.senseT = Math.random() * 0.1; this.holdT = 0; this.waypoint = 1;
      this.burstLeft = 0; this.pauseT = 0; this.strafeDir = 0; this.strafeT = 0; this.aimHead = false; this.headRoll = 0;
      this.coverT = 0; this.stuckT = 0; this.lastPos = { x: this.a.pos.x, z: this.a.pos.z }; this.skipT = 0;
      this.aimYaw = this.a.yaw; this.aimPitch = 0; this.wantCrouch = false; this.retreated = false; this.peekFrom = null;
      this.lane = null; this.laneDir = 1; this.huntT = 0;
      this.turnSt = { yaw: this.a.yaw, rate: 0 };
    }
    assignLane(lane, map) {
      this.lane = map.lanes[lane]; this.laneName = lane;
      this.laneDir = this.a.team === 0 ? 1 : -1;
      this.waypoint = this.laneDir > 0 ? 0 : this.lane.length - 1;
      // roughly 2 in 5 bots anchor: hold the near end of their lane before pushing; the rest hold mid-lane if they get there
      this.anchor = Math.random() < 0.4;
      this.holdAt = this.anchor ? this.waypoint : 2;
      this.offset = { x: rand(-1.5, 1.5), z: rand(-1.5, 1.5) };
    }

    // ---- perception
    sense(G) {
      const a = this.a, d = this.d;
      const ex = a.pos.x, ey = a.eyeY(), ez = a.pos.z;
      let best = null, bestD = Infinity, bestAng = 0;
      for (const e of G.actors) {
        if (!e.alive || e.team === a.team) continue;
        const dx = e.pos.x - ex, dz = e.pos.z - ez, dist = Math.hypot(dx, dz);
        const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - a.yaw));
        const tracking = e === this.target && this.visible;
        if (!BA.canNotice(d, { dist, angle: ang, tracking })) continue;
        const headY = e.eyeY(), chestY = e.pos.y + 1.1 - 0.3 * e.crouch;
        if (!M.lineOfSight(G.map, ex, ey, ez, e.pos.x, headY, e.pos.z) && !M.lineOfSight(G.map, ex, ey, ez, e.pos.x, chestY, e.pos.z)) continue;
        if (dist < bestD) { bestD = dist; best = e; bestAng = ang; }
      }
      if (best) {
        if (best !== this.target || this.lostT > 1.2) {
          const warned = this.lastKnown && Math.hypot(this.lastKnown.x - best.pos.x, this.lastKnown.z - best.pos.z) < 6 && G.time - this.lastKnown.t < 3;
          this.reaction = BA.reactionTime(d, { dist: bestD, angle: bestAng, warned }, Math.random);
          this.seenAt = G.time;
          if (best.isPlayer && G.rec) G.rec('botSees', { bot: a.name, v: best.ph ? 'P' + (best.ph.slot + 1) : best.name, dist: Math.round(bestD), angle: Math.round(bestAng / DEG), reaction: Math.round(this.reaction * 100) / 100, warned: !!warned });
          this.errMag = BA.initialError(d, { dist: bestD }, Math.random);
          this.errAng = Math.random() * Math.PI * 2;
          this.aimHead = Math.random() < d.headAim;
          this.wantCrouch = bestD > 12 && Math.random() < d.crouch;
          this.retreated = false;
        }
        this.target = best; this.visible = true; this.lostT = 0;
        best.spotted = G.time;
        this.lastKnown = { x: best.pos.x, y: best.pos.y, z: best.pos.z, t: G.time };
        // call it out to nearby teammates: roughly where, and a moment late (a callout, not a wallhack)
        for (const f of G.actors) {
          if (f === a || !f.alive || f.team !== a.team || !f.bot) continue;
          const fb = f.bot;
          if (fb.visible || Math.hypot(f.pos.x - a.pos.x, f.pos.z - a.pos.z) >= 30 || (fb.lastKnown && G.time - fb.lastKnown.t < 1)) continue;
          const j = BA.heardJitter(Math.hypot(best.pos.x - f.pos.x, best.pos.z - f.pos.z), Math.random);
          fb.lastKnown = { x: best.pos.x + j.x, y: best.pos.y, z: best.pos.z + j.z, t: G.time - 0.5 };
        }
      } else {
        this.visible = false;
      }
      // gunfire and footsteps heard
      for (const n of G.noises) {
        if (n.team === a.team || G.time - n.t > 0.25) continue;
        const dist = Math.hypot(n.x - ex, n.z - ez);
        if (dist < d.hear * (n.loud ? 1 : 0.4) && !this.visible) {
          // heard, not seen: they know the direction, not the exact spot
          const j = BA.heardJitter(dist, Math.random);
          this.lastKnown = { x: n.x + j.x, y: n.y, z: n.z + j.z, t: G.time };
        }
      }
    }

    onHurt(G, attacker) {
      this.errMag += 2.5; // a flinch: being hit throws the aim off
      if (!this.visible && attacker) {
        const j = BA.heardJitter(Math.hypot(attacker.pos.x - this.a.pos.x, attacker.pos.z - this.a.pos.z), Math.random);
        this.lastKnown = { x: attacker.pos.x + j.x, y: attacker.pos.y, z: attacker.pos.z + j.z, t: G.time };
        this.reaction = Math.min(this.reaction, this.d.reaction * 0.8);
      }
    }

    // ---- navigation
    pathTo(G, x, z) {
      const a = this.a;
      const s = M.nearestNode(G.nav, a.pos.x, a.pos.z), e = M.nearestNode(G.nav, x, z);
      this.path = M.findPath(G.nav, s, e); this.pathIdx = 0; this.goal = { x, z };
      if (this.path && this.path.length > 1) this.pathIdx = 1;
    }
    followPath(G, dt) {
      if (!this.path) return null;
      const a = this.a, nodes = G.nav.nodes;
      this.skipT -= dt;
      if (this.skipT <= 0) {
        this.skipT = 0.25;
        while (this.pathIdx + 1 < this.path.length) {
          const n = nodes[this.path[this.pathIdx + 1]];
          if (Math.abs(n.y - a.pos.y) > 0.3 || nodes[this.path[this.pathIdx]].y !== n.y) break;
          if (!M.lineOfSight(G.map, a.pos.x, a.pos.y + 0.6, a.pos.z, n.x, n.y + 0.6, n.z)) break;
          const dx = n.x - a.pos.x, dz = n.z - a.pos.z, L = Math.hypot(dx, dz) || 1, px = -dz / L * 0.38, pz = dx / L * 0.38;
          if (!M.lineOfSight(G.map, a.pos.x + px, a.pos.y + 0.6, a.pos.z + pz, n.x + px, n.y + 0.6, n.z + pz)) break;
          if (!M.lineOfSight(G.map, a.pos.x - px, a.pos.y + 0.6, a.pos.z - pz, n.x - px, n.y + 0.6, n.z - pz)) break;
          this.pathIdx++;
        }
      }
      let tx, tz;
      const last = this.pathIdx >= this.path.length - 1;
      if (this.pathIdx >= this.path.length) return null;
      const n = nodes[this.path[this.pathIdx]];
      tx = n.x; tz = n.z;
      if (last && this.goal) { tx = this.goal.x; tz = this.goal.z; }
      const dx = tx - a.pos.x, dz = tz - a.pos.z, dist = Math.hypot(dx, dz);
      if (dist < (last ? 0.6 : 1.0)) { this.pathIdx++; if (this.pathIdx >= this.path.length) { this.path = null; return null; } }
      return { x: dx / (dist || 1), z: dz / (dist || 1), dist };
    }

    findCover(G, from) {
      const a = this.a, nav = G.nav;
      const ci = Math.round((a.pos.x - nav.x0) / nav.step), cj = Math.round((a.pos.z - nav.z0) / nav.step);
      const cands = [];
      for (let j = cj - 5; j <= cj + 5; j++) for (let i = ci - 5; i <= ci + 5; i++) {
        if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) continue;
        const k = nav.grid[j * nav.nx + i]; if (k < 0) continue;
        const n = nav.nodes[k], dd = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
        if (dd < 1.5 || Math.hypot(n.x - from.x, n.z - from.z) < 5) continue;
        cands.push([dd, n]);
      }
      cands.sort((p, q) => p[0] - q[0]);
      for (let i = 0; i < Math.min(40, cands.length); i++) {
        const n = cands[i][1];
        if (!M.lineOfSight(G.map, from.x, from.y + 1.5, from.z, n.x, n.y + 1.3, n.z)) return n;
      }
      return null;
    }

    // ---- main
    update(G, dt) {
      const a = this.a, d = this.d;
      if (!a.alive) return;
      this.senseT -= dt;
      if (this.senseT <= 0) { this.senseT = 0.1; this.sense(G); }
      if (!this.visible) this.lostT += dt;
      this.reaction -= dt;

      const w = a.weapon, ammo = a.ammo[a.weaponId];
      let move = null, speed = 4.7 * w.speedMult, faceYaw = null, facePitch = 0;
      a.walking = false;

      // out of ammo in the primary: switch to the sidearm
      if (a.slot === 'primary' && ammo.mag === 0 && ammo.reserve === 0) G.switchWeapon(a, 'sidearm');

      if (this.visible && this.target && this.target.alive && this.mode !== 'cover') {
        this.mode = 'engage';
        const tg = this.target;
        const dist = Math.hypot(tg.pos.x - a.pos.x, tg.pos.z - a.pos.z);
        // hurt or dry: fall back
        const dry = ammo.mag === 0 || (ammo.mag <= Math.ceil(w.mag * 0.15) && a.reloadT <= 0);
        if (((a.hp < 38 && !this.retreated) || dry) && dist > 5) {
          const c = this.findCover(G, { x: tg.pos.x, y: tg.pos.y, z: tg.pos.z });
          if (c) {
            this.retreated = true; this.mode = 'cover'; this.coverT = rand(1.4, 2.6); this.peekFrom = { x: a.pos.x, z: a.pos.z };
            this.pathTo(G, c.x, c.z);
            if (ammo.mag < w.mag) G.reload(a);
          } else if (ammo.mag === 0) G.reload(a);
        }
        if (this.mode === 'engage') {
          // strafe / stand and shoot
          this.strafeT -= dt;
          if (this.strafeT <= 0) {
            this.strafeT = rand(0.35, 0.9);
            this.strafeDir = Math.random() < d.strafe && w.id !== 'longline' ? (Math.random() < 0.5 ? -1 : 1) : 0;
          }
          if (this.strafeDir) {
            const yaw = Math.atan2(-(tg.pos.x - a.pos.x), -(tg.pos.z - a.pos.z));
            move = { x: Math.cos(yaw) * this.strafeDir, z: -Math.sin(yaw) * this.strafeDir };
            speed = this.dn === 'veteran' && this.burstLeft > 0 ? 0 : 2.6;
          }
          if (dist > 38 && w.id !== 'longline' && !this.strafeDir) { this.pathTo(G, tg.pos.x, tg.pos.z); move = this.followPath(G, dt); speed = 2.2; a.walking = true; }
          a.crouching = this.wantCrouch && !move;
          // aim: true direction plus a shrinking error
          this.headRoll -= dt;
          if (this.headRoll <= 0) { this.headRoll = 1; if (Math.random() < 0.3) this.aimHead = Math.random() < d.headAim; }
          const ty = this.aimHead ? tg.eyeY() + 0.02 : tg.pos.y + 1.12 - 0.35 * tg.crouch;
          const dx = tg.pos.x - a.pos.x, dy = ty - a.eyeY(), dz = tg.pos.z - a.pos.z;
          const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, Math.hypot(dx, dz));
          // tracking: how fast the target crosses this bot's view, which its aim lags behind
          const lat = (tg.vel.x * -dz + tg.vel.z * dx) / Math.max(0.5, Math.hypot(dx, dz));
          const angVel = lat / Math.max(1, dist) / DEG;
          this.errMag = BA.errorStep(this.errMag, d, dt, { angVel, moving: !!move, dist });
          this.errAng += dt * rand(0.5, 2.5); // the error wanders around the target
          const err = this.errMag * DEG;
          faceYaw = trueYaw + Math.cos(this.errAng) * err;
          facePitch = truePitch + Math.sin(this.errAng) * err * 0.6;
          // fire when roughly on target
          const off = Math.hypot(wrap(this.aimYaw - trueYaw), this.aimPitch - truePitch);
          const tol = BA.fireTolerance(d, dist);
          this.pauseT -= dt;
          if (this.reaction <= 0 && off < tol && a.reloadT <= 0 && a.drawT <= 0) {
            if (ammo.mag === 0) G.reload(a);
            else if (this.pauseT <= 0) {
              if (this.burstLeft <= 0) this.burstLeft = w.auto ? Math.round(rand(d.burst[0], d.burst[1]) * (dist < 10 ? 2 : 1)) : 1;
              if (G.tryFire(a, this.aimYaw, this.aimPitch)) {
                // recoil it does not fully hold down: the aim climbs off and has to come back
                this.errMag += d.kick * R.recoilKick(w.id, Math.max(0, Math.floor(a.shotsInBurst) - 1)).pitch;
                this.burstLeft--;
                if (this.burstLeft <= 0) this.pauseT = w.auto ? rand(d.pause[0], d.pause[1]) * (dist < 10 ? 0.5 : 1) : rand(0.15, 0.45) + (w.id === 'longline' ? 0.6 : 0);
              }
            }
          }
        }
      } else {
        a.crouching = false;
        if (this.mode === 'engage') { this.mode = 'search'; this.path = null; }
      }

      if (this.mode === 'cover') {
        move = this.followPath(G, dt);
        if (!move) {
          this.coverT -= dt; a.crouching = true;
          if (this.coverT <= 0 && a.reloadT <= 0) {
            this.mode = 'search'; a.crouching = false;
            if (this.peekFrom) this.pathTo(G, this.peekFrom.x, this.peekFrom.z);
          }
        }
        if (this.lastKnown) faceYaw = Math.atan2(-(this.lastKnown.x - a.pos.x), -(this.lastKnown.z - a.pos.z));
      } else if (this.mode === 'search' || (this.mode !== 'engage' && this.lastKnown && G.time - this.lastKnown.t < 5)) {
        if (this.mode !== 'search') { this.mode = 'search'; this.path = null; }
        const lk = this.lastKnown;
        if (!lk || G.time - lk.t > 7) { this.mode = 'advance'; this.path = null; }
        else {
          if (!this.path || this.repathT <= 0) { this.pathTo(G, lk.x, lk.z); this.repathT = 1.5; }
          move = this.followPath(G, dt); speed = 3.4 * w.speedMult; a.walking = true;
          faceYaw = Math.atan2(-(lk.x - a.pos.x), -(lk.z - a.pos.z));
          facePitch = Math.atan2(lk.y + 1.4 - a.eyeY(), Math.hypot(lk.x - a.pos.x, lk.z - a.pos.z));
          if (!move && Math.hypot(lk.x - a.pos.x, lk.z - a.pos.z) < 2) { this.lastKnown = null; this.mode = 'advance'; }
          if (ammo.mag < w.mag * 0.5 && a.reloadT <= 0 && ammo.reserve > 0) G.reload(a);
        }
      }

      if (this.mode === 'advance') {
        if (ammo.mag < w.mag && ammo.reserve > 0 && a.reloadT <= 0) G.reload(a);
        const hunt = G.roundTimeLeft < d.hunt || G.aliveCount(1 - a.team) <= 1;
        this.repathT -= dt;
        if (hunt) {
          // sweep toward the enemy's general area (within ~10 m), not straight to where they stand
          if (!this.path || this.repathT <= 0) {
            const foes = G.actors.filter(e => e.alive && e.team !== a.team);
            if (foes.length) {
              const f = foes[(this.a.id + Math.floor(G.time / 12)) % foes.length];
              this.pathTo(G, f.pos.x + rand(-10, 10), f.pos.z + rand(-10, 10));
            }
            this.repathT = 6;
          }
          move = this.followPath(G, dt);
          if (move) { speed *= 0.8; a.walking = true; }
        } else if (this.holdT > 0) {
          this.holdT -= dt;
          const nxt = this.lane[Math.max(0, Math.min(this.lane.length - 1, this.waypoint))];
          faceYaw = Math.atan2(-(nxt.x - a.pos.x), -(nxt.z - a.pos.z)) + Math.sin(G.time * 0.7 + a.id) * 0.5;
          a.crouching = this.dn !== 'recruit' && this.holdT > 1;
        } else if (this.lane) {
          if (!this.path) {
            const wp = this.lane[this.waypoint];
            this.pathTo(G, wp.x + this.offset.x, wp.z + this.offset.z);
          }
          move = this.followPath(G, dt);
          if (!move) {
            const reachedIdx = this.waypoint;
            if (reachedIdx === this.holdAt) this.holdT = this.anchor ? rand(6, 15) : rand(3, 8);
            this.waypoint += this.laneDir;
            if (this.waypoint < 0 || this.waypoint >= this.lane.length) { // reached the far end: roam another lane back
              const lanes = Object.keys(G.map.lanes);
              this.assignLane(lanes[Math.floor(Math.random() * lanes.length)], G.map);
              this.laneDir = -this.laneDir; this.waypoint = this.laneDir > 0 ? 0 : this.lane.length - 1; this.holdAt = -1;
            }
            this.path = null;
          }
          if (move && this.waypoint === this.holdAt) { speed *= 0.6; a.walking = true; }
        }
      }

      // stuck detection
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        const moved = Math.hypot(a.pos.x - this.lastPos.x, a.pos.z - this.lastPos.z);
        if (move && speed > 1 && moved < 0.4) { this.path = null; this.repathT = 0; this.offset = { x: rand(-2, 2), z: rand(-2, 2) }; }
        this.stuckT = 0; this.lastPos = { x: a.pos.x, z: a.pos.z };
      }
      this.repathT -= dt;

      // facing
      if (faceYaw == null) {
        if (move) faceYaw = Math.atan2(-move.x, -move.z);
        else faceYaw = this.aimYaw;
      }
      // turning has a top speed that winds up (botaim.js): no instant 180s
      const engaged = this.mode === 'engage';
      this.turnSt.yaw = this.aimYaw;
      this.aimYaw = BA.turnStep(this.turnSt, faceYaw, dt, d, engaged);
      const turn = d.turn * (engaged ? 1 : 0.6);
      const dp = facePitch - this.aimPitch;
      this.aimPitch += Math.max(-turn * dt, Math.min(turn * dt, dp * Math.min(1, 12 * dt)));
      a.yaw = this.aimYaw; a.pitch = this.aimPitch;

      // movement intent -> velocity (physics in game.js)
      const tx = move ? move.x * speed : 0, tz = move ? move.z * speed : 0;
      const k = Math.min(1, dt * (a.onGround ? 12 : 2));
      a.vel.x += (tx - a.vel.x) * k; a.vel.z += (tz - a.vel.z) * k;
      if (a.crouching) { a.vel.x *= 0.96; a.vel.z *= 0.96; }
    }
  }

  global.ArenaActors = { TEAMS, DIFF, Actor, Bot, makeCharacter, wrap };
})(window);
