/*
 * Iron Ludus - the troll and the skeleton, sculpted in code, and softer shading for the rest.
 * Classic script: defines window.LudusCreatures (needs THREE, LudusMat).
 *
 * The models' own rigs and animation clips stay: every new part is made in the bind pose at the
 * right place in the world and then attached to the bone it belongs to (Object3D.attach keeps
 * the world transform), so it moves exactly as the old mesh did. The old meshes are hidden.
 */
(function () {
  'use strict';
  const T = THREE;
  const UP = new T.Vector3(0, 1, 0);
  const lin = c => new T.Color(c).convertSRGBToLinear();

  /** Smooth shading on a low-poly mesh: average the normals that meet at a point within `crease` degrees. */
  function smoothNormals(geo, crease) {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    if (!pos || !nor) return;
    const cos = Math.cos((crease || 60) * Math.PI / 180), map = new Map(), key = i => Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    for (let i = 0; i < pos.count; i++) { const k = key(i); if (!map.has(k)) map.set(k, []); map.get(k).push(i); }
    const out = new Float32Array(nor.count * 3), a = new T.Vector3(), b = new T.Vector3(), s = new T.Vector3();
    for (const list of map.values()) for (const i of list) {
      a.fromBufferAttribute(nor, i); s.set(0, 0, 0);
      for (const j of list) { b.fromBufferAttribute(nor, j); if (a.dot(b) >= cos) s.add(b); }
      s.normalize(); out.set([s.x, s.y, s.z], i * 3);
    }
    geo.setAttribute('normal', new T.BufferAttribute(out, 3));
  }

  /* ------------------------------------------------------------ sculpting */
  const noise3 = (x, y, z) => Math.sin(x * 1.7 + Math.sin(y * 2.3)) * Math.cos(y * 1.9 + Math.sin(z * 1.3)) * Math.sin(z * 2.1 + x * 0.7);
  /** Push vertices along their normals by a lumpy field (amp metres, freq per metre); darker in the hollows. */
  function lumpy(geo, amp, freq, shade) {
    geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal, col = new Float32Array(p.count * 3);
    const v = new T.Vector3(), nn = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
      const d = noise3(v.x * freq, v.y * freq, v.z * freq) + 0.5 * noise3(v.x * freq * 2.7 + 3, v.y * freq * 2.7, v.z * freq * 2.7 - 1);
      v.addScaledVector(nn, d * amp); p.setXYZ(i, v.x, v.y, v.z);
      const c = 1 - (shade || 0) * (0.5 - d * 0.5); col.set([c, c, c], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }
  const ellipsoid = (rx, ry, rz, seg) => { const g = new T.SphereGeometry(1, seg || 28, Math.round((seg || 28) * 0.7)); g.scale(rx, ry, rz); return g; };
  /** A limb along +Y: profile = [[radius, fraction of length], ...]. */
  function limb(length, profile, seg) {
    return new T.LatheGeometry(profile.map(p => new T.Vector2(p[0], p[1] * length)), seg || 20);
  }
  /** Place a mesh in world space (bind pose) and hang it on a bone. dir: +Y of the mesh points from a to b. */
  function hang(bone, mesh, a, b, setup) {
    mesh.position.copy(a);
    if (b) mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    if (setup) setup(mesh);   // turn and shape it in world space first: the bone's own scale comes after
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    bone.attach(mesh);
    return mesh;
  }
  const W = (bone) => bone.getWorldPosition(new T.Vector3());

  /* ---------------------------------------------------------------- troll */
  function troll(f) {
    const M = LudusMat, model = f.model, bone = n => model.getObjectByName(n);
    const s = f.p.height / 2.6, V = (x, y, z) => new T.Vector3(x * s, y * s, z * s).add(f.root.position);
    const hide = M.mat(M.stone(), { rough: 0.86, tint: 0x7f8a62, env: 0.45, normal: 0.9 }); hide.vertexColors = true;
    const dark = M.mat(M.stone(), { rough: 0.9, tint: 0x5c6346, env: 0.4 }); dark.vertexColors = true;
    const ivory = new T.MeshStandardMaterial({ color: lin(0xe8dcbc), roughness: 0.45 });
    const eye = new T.MeshStandardMaterial({ color: lin(0x1a0d05), emissive: lin(0xd08a1a), emissiveIntensity: 0.6, roughness: 0.25 });
    const cloth = M.mat(M.burlap(6, 2), { rough: 0.95, tint: 0x6b4a33 }); cloth.side = T.DoubleSide;
    const rope = M.mat(M.rope(18, 1), { rough: 0.9 });
    const body = bone('Body'), head = bone('Head');
    const m = (geo, mat) => new T.Mesh(geo, mat);
    // the bulk: belly, chest leaning forward, a hump over the shoulders
    hang(body, m(lumpy(ellipsoid(0.5, 0.42, 0.44), 0.03 * s, 4 / s, 0.35), hide), V(0, 1.22, 0.06));
    const chest = hang(body, m(lumpy(ellipsoid(0.62, 0.46, 0.5), 0.035 * s, 3.5 / s, 0.35), hide), V(0, 1.68, 0.14), null, o => o.rotateX(0.35));
    hang(body, m(lumpy(ellipsoid(0.42, 0.34, 0.36), 0.03 * s, 4 / s, 0.35), hide), V(0, 1.92, -0.12));
    for (const sx of [-1, 1]) hang(body, m(lumpy(ellipsoid(0.24, 0.22, 0.24), 0.02 * s, 5 / s, 0.3), hide), V(sx * 0.58, 2.06, -0.06));
    // loincloth on a rope belt
    hang(body, m(new T.LatheGeometry([[0.5, 0], [0.53, -0.12], [0.57, -0.3], [0.6, -0.42]].map(p => new T.Vector2(p[0] * s, p[1] * s)), 24, 0, Math.PI * 2), cloth), V(0, 1.12, 0.04));
    const belt = hang(body, m(new T.TorusGeometry(0.5 * s, 0.03 * s, 8, 32), rope), V(0, 1.12, 0.04), null, o => { o.rotation.x = Math.PI / 2; });
    // the head: brow, small sunk eyes, a heavy nose, jutting jaw with tusks, ears
    hang(head, m(lumpy(ellipsoid(0.26, 0.24, 0.28), 0.015 * s, 7 / s, 0.3), hide), V(0, 2.14, 0.52));
    const brow = hang(head, m(lumpy(new T.CapsuleGeometry(0.075, 0.3, 6, 14), 0.008 * s, 12 / s, 0.4), dark), V(0, 2.22, 0.74), null, o => { o.rotation.z = Math.PI / 2; o.scale.set(1, 1, 0.8); });
    for (const sx of [-1, 1]) {
      hang(head, m(new T.SphereGeometry(0.03 * s, 12, 8), eye), V(sx * 0.1, 2.15, 0.77));
      const tusk = hang(head, m(new T.ConeGeometry(0.028 * s, 0.14 * s, 10), ivory), V(sx * 0.12, 2.03, 0.86), null, o => o.rotation.set(-0.3, 0, -sx * 0.35));
      const ear = hang(head, m(lumpy(new T.ConeGeometry(0.07 * s, 0.22 * s, 10), 0.006 * s, 20 / s, 0.3), hide), V(sx * 0.27, 2.17, 0.46), null, o => { o.rotation.set(0.2, 0, -sx * 1.25); o.scale.z = 0.45; });
    }
    hang(head, m(lumpy(ellipsoid(0.07, 0.085, 0.075), 0.006 * s, 18 / s, 0.3), dark), V(0, 2.09, 0.84));
    hang(head, m(lumpy(ellipsoid(0.22, 0.11, 0.18), 0.012 * s, 9 / s, 0.35), hide), V(0, 1.98, 0.7));
    // arms: thick from the shoulder, a knotted elbow, a heavy forearm, a fist like a boulder
    for (const [side, sn] of [['ArmR', 'ArmR_end'], ['ArmL', 'ArmL_end']]) {
      const a = W(bone(side)), b = W(bone(sn)), L = a.distanceTo(b);
      hang(bone(side), m(lumpy(limb(L, [[0, -0.02], [0.2 * s, 0], [0.19 * s, 0.15], [0.14 * s, 0.44], [0.155 * s, 0.55], [0.175 * s, 0.74], [0.13 * s, 0.9], [0.1 * s, 0.97], [0, 0.98]], 22), 0.02 * s, 5 / s, 0.35), hide), a, b);
      const fist = hang(bone(side), m(lumpy(ellipsoid(0.17, 0.15, 0.16), 0.015 * s, 8 / s, 0.35), hide), b.clone().addScaledVector(b.clone().sub(a).normalize(), -0.06 * s));
      for (let k = 0; k < 4; k++) hang(bone(side), m(new T.SphereGeometry(0.045 * s, 10, 8), dark), fist.getWorldPosition(new T.Vector3()).add(new T.Vector3((k - 1.5) * 0.07 * s, -0.08 * s, 0.11 * s)));
    }
    // legs: huge thighs, thick calves, flat wide feet
    for (const [side, sn] of [['LegL', 'LegL_end'], ['LegR', 'LegR_end']]) {
      const a = W(bone(side)), b = W(bone(sn)), L = a.distanceTo(b);
      hang(bone(side), m(lumpy(limb(L, [[0, -0.02], [0.22 * s, 0], [0.21 * s, 0.2], [0.15 * s, 0.5], [0.17 * s, 0.65], [0.12 * s, 0.92], [0, 0.96]], 20), 0.018 * s, 5 / s, 0.35), hide), a, b);
      hang(bone(side), m(lumpy(ellipsoid(0.15, 0.08, 0.25), 0.012 * s, 9 / s, 0.35), hide), V(a.x / s, 0.08, 0.14));
    }
  }

  /* ------------------------------------------------------------- skeleton */
  function bone3(r0, r1, L, seg) {   // a long bone: knobbed ends, a slim shaft
    return limb(L, [[0, -0.02], [r0 * 0.9, -0.01], [r0, 0.03], [r0 * 0.55, 0.12], [r1 * 0.45, 0.5], [r0 * 0.5, 0.88], [r1, 0.96], [r1 * 0.8, 1.0], [0, 1.01]], seg || 12);
  }
  function skeleton(f) {
    const M = LudusMat, model = f.model, bone = n => model.getObjectByName(n);
    const s = f.p.height / 1.85, V = (x, y, z) => new T.Vector3(x * s, y * s, z * s).add(f.root.position);
    const ivory = M.mat(M.stone(), { rough: 0.62, tint: 0xe6dcc2, env: 0.5, normal: 0.45 });
    const hollow = new T.MeshStandardMaterial({ color: lin(0x0d0805), roughness: 1 });
    const glow = new T.MeshStandardMaterial({ color: lin(0x050302), emissive: lin(0x5ad0ff), emissiveIntensity: 1.2 });
    const m = (geo, mat) => new T.Mesh(geo, mat || ivory);
    const head = bone('Head'), torso = bone('Torso'), hips = bone('Hips');
    // skull: cranium, face, cheekbones, eye sockets with a cold light in them, nasal hollow, jaw with teeth
    const D = -0.06;   // the skull sits down on the neck
    hang(head, m(lumpy(ellipsoid(0.112, 0.12, 0.13), 0.002 * s, 30 / s, 0.15)), V(0, 1.6 + D, -0.005));
    hang(head, m(ellipsoid(0.085, 0.065, 0.075)), V(0, 1.52 + D, 0.065));
    for (const sx of [-1, 1]) {
      hang(head, m(ellipsoid(0.03, 0.022, 0.035)), V(sx * 0.072, 1.515 + D, 0.075));
      // sockets: dark hollows set into the face, a cold light deep in each
      hang(head, m(ellipsoid(0.031, 0.027, 0.012), hollow), V(sx * 0.042, 1.555 + D, 0.112));
      hang(head, m(new T.SphereGeometry(0.008 * s, 8, 6), glow), V(sx * 0.042, 1.553 + D, 0.12));
    }
    hang(head, m(ellipsoid(0.045, 0.012, 0.03)), V(0, 1.585 + D, 0.115));
    const nose = hang(head, m(ellipsoid(0.013, 0.02, 0.008), hollow), V(0, 1.513 + D, 0.133));
    const jaw = new T.Group(); jaw.position.copy(V(0, 1.5 + D, 0.0)); jaw.updateMatrixWorld(true); head.attach(jaw);
    const jc = new T.CatmullRomCurve3([V(-0.072, 1.5 + D, 0.005), V(-0.066, 1.44 + D, 0.05), V(0, 1.425 + D, 0.105), V(0.066, 1.44 + D, 0.05), V(0.072, 1.5 + D, 0.005)].map(v => jaw.worldToLocal(v)));
    jaw.add(m(new T.TubeGeometry(jc, 24, 0.014 * s, 8, false)));
    for (let k = 0; k < 10; k++) {
      const a = Math.PI * (0.15 + 0.7 * k / 9), tooth = m(new T.BoxGeometry(0.011 * s, 0.017 * s, 0.009 * s));
      tooth.position.copy(jaw.worldToLocal(V(Math.cos(a) * 0.062, 1.466 + D, 0.04 + Math.sin(a) * 0.065))); jaw.add(tooth);
    }
    f.jaw = jaw; f.jawQ0 = jaw.quaternion.clone();
    for (let k = 0; k < 3; k++) hang(bone('Neck'), m(new T.CylinderGeometry(0.02 * s, 0.022 * s, 0.03 * s, 10)), V(0, 1.31 + k * 0.04, -0.01));
    // spine, ribs, breastbone, collarbones, pelvis
    for (let k = 0; k < 12; k++) {
      const y = 0.66 + k * 0.055, v = m(new T.CylinderGeometry(0.024 * s, 0.026 * s, 0.032 * s, 10));
      hang(y > 0.85 ? torso : hips, v, V(0, y, -0.03));
      hang(y > 0.85 ? torso : hips, m(new T.BoxGeometry(0.012 * s, 0.02 * s, 0.04 * s)), V(0, y - 0.006, -0.06));
    }
    for (let k = 0; k < 6; k++) {
      const y = 1.2 - k * 0.048, w = 0.13 + 0.035 * Math.sin(Math.PI * (k + 1) / 7), d = 0.12 + 0.02 * Math.sin(Math.PI * (k + 1) / 7);
      for (const sx of [-1, 1]) {
        const pts = [V(sx * 0.02, y, -0.03), V(sx * w * 0.8, y - 0.01, -0.05), V(sx * w, y - 0.04, 0.02), V(sx * w * 0.8, y - 0.07, d * 0.75), V(sx * 0.03, y - 0.1, d)];
        hang(torso, m(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, 0.008 * s, 6, false)), new T.Vector3());
      }
    }
    hang(torso, m(new T.BoxGeometry(0.032 * s, 0.2 * s, 0.014 * s)), V(0, 1.1, 0.12));
    for (const sx of [-1, 1]) {
      hang(torso, m(new T.TubeGeometry(new T.CatmullRomCurve3([V(sx * 0.02, 1.22, 0.11), V(sx * 0.13, 1.23, 0.07), V(sx * 0.24, 1.17, 0.0)]), 12, 0.011 * s, 6, false)), new T.Vector3());
      const wing = hang(hips, m(lumpy(ellipsoid(0.085, 0.07, 0.025), 0.003 * s, 30 / s, 0.2)), V(sx * 0.08, 0.68, -0.005), null, o => o.rotation.set(0, sx * 0.5, sx * 0.3));
    }
    hang(hips, m(ellipsoid(0.05, 0.05, 0.03)), V(0, 0.62, -0.04));
    // limbs: long bones with knobbed joints; two bones in each forearm and shin; hands and feet
    const limbBones = (up, down, rUp, rDn) => {
      const a = W(bone(up)), b = W(bone(down)), c = b.clone().add(b.clone().sub(a));
      hang(bone(up), m(bone3(rUp, rUp * 0.9, a.distanceTo(b))), a, b);
      for (const off of [-0.012, 0.012]) {
        const o = new T.Vector3(off * s, 0, off * 0.5 * s);
        hang(bone(down), m(bone3(rDn, rDn * 0.85, b.distanceTo(c))), b.clone().add(o), c.clone().add(o));
      }
      hang(bone(down), m(new T.SphereGeometry(rUp * 1.05, 12, 8)), b);
      return c;
    };
    for (const sx of ['L', 'R']) {
      const hand = limbBones(sx + 'UpperLeg001', sx + 'DownLeg001', 0.02 * s, 0.012 * s);
      hang(bone(sx + 'UpperLeg001'), m(new T.SphereGeometry(0.03 * s, 12, 8)), W(bone(sx + 'UpperLeg001')));
      const fwd = W(bone(sx + 'DownLeg001')).sub(W(bone(sx + 'UpperLeg001'))).normalize();
      for (let k = 0; k < 4; k++) {
        const fp = hand.clone().addScaledVector(fwd, 0.02 * s).add(new T.Vector3((k - 1.5) * 0.012 * s, 0, 0.01 * s));
        hang(bone(sx + 'DownLeg001'), m(bone3(0.006 * s, 0.005 * s, 0.06 * s, 6)), fp, fp.clone().addScaledVector(fwd, 1));
      }
      const foot = limbBones(sx + 'UpperLeg', sx + 'DownLeg', 0.025 * s, 0.015 * s);
      hang(bone(sx + 'DownLeg'), m(ellipsoid(0.035, 0.022, 0.08)), new T.Vector3(foot.x, Math.max(0.025 * s + f.root.position.y, foot.y), foot.z + 0.05 * s));
    }
  }

  /** Dress a fighter: rebuild the troll and the skeleton; smooth the rest. */
  function dress(f) {
    if (!window.LudusMat || !f.model) return;
    f.root.updateMatrixWorld(true);
    if (f.p.model === 'troll' || f.p.model === 'skeleton') {
      const old = []; f.model.traverse(o => { if (o.isMesh) old.push(o); });
      (f.p.model === 'troll' ? troll : skeleton)(f);
      for (const o of old) o.visible = false;
      // one draw call per bone and material, not one per rib and tooth
      const owners = new Set(); f.model.traverse(o => { if (o.isBone || o === f.jaw) owners.add(o); });
      for (const o of owners) LudusMat.mergeChildren(o, c => c.material && c.material.emissive && c.material.emissive.getHex() !== 0);
      f.mats = [];
      f.model.traverse(o => { if (o.isMesh && o.visible && o.material && o.material.emissive && o.material.emissive.getHex() === 0 && !f.mats.includes(o.material)) f.mats.push(o.material); });
      return;
    }
    // the humans and wolves: soft normals across their facets (hard edges above 55 degrees stay)
    f.model.traverse(o => { if (o.isMesh && o.visible) smoothNormals(o.geometry, 55); });
  }

  window.LudusCreatures = { dress, smoothNormals, lumpy };
})();
