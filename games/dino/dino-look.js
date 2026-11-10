// Ironfern dinosaurs, the look (Stage B): turns the CC0 Quaternius low-poly models into animals.
// Per variant: real-world scale measured at runtime, smoothed normals, a skin shader (mottling,
// countershading, stripes, procedural skin relief (bump), warm rim), per-bone hit capsules fitted to
// the skinned vertices, eye/mouth spheres, natural clip speeds measured from the feet, tag collar.
//   DH.DinoLook.template(variant) -> template (cached)   DH.DinoLook.instance(variant, { tagged }) -> inst
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const T = window.THREE;
  const A = DH.Assets;

  const MODELS = {
    raptor: 'raptor_velociraptor', trex: 'trex', trike: 'triceratops', para: 'parasaurolophus',
    stego: 'stegosaurus', apato: 'apatosaurus', dragon: 'flyer_standin_dragon',
  };
  for (const k in MODELS) A.register('dino_m_' + k, 'assets/dinos/' + MODELS[k] + '.glb');

  // Colours are sRGB hex per original material name. skin: shader knobs.
  //   scale: scale size (m), mottle 0..1, stripe 0..1 (+ freq per m), belly: countershading, bump (m)
  const VARIANTS = {
    raptor: {
      model: 'raptor', length: 3.4, prefix: 'Velociraptor',
      colors: { LightBrown: 0x9a8566, Brown: 0x5c4930, Black: 0x1c1712 },
      skin: { scale: 0.035, mottle: 0.55, stripe: 0.55, stripeFreq: 5.5, belly: 0.55, bump: 0.006, rough: 0.72, warm: 1 },
    },
    dilo: {
      model: 'raptor', length: 5.4, prefix: 'Velociraptor', crests: true,
      colors: { LightBrown: 0x9a915f, Brown: 0x39462a, Black: 0x14120d },
      skin: { scale: 0.05, mottle: 0.7, stripe: 0.3, stripeFreq: 3.2, belly: 0.6, bump: 0.008, rough: 0.66, warm: 1 },
    },
    rex: {
      model: 'trex', length: 12.5, prefix: 'TRex',
      colors: { LightYellow: 0x9a8869, LightGreen: 0x6b6148, Green: 0x4c4736, Black: 0x1a1612, Red: 0x6a2622 },
      skin: { scale: 0.11, mottle: 0.6, stripe: 0.25, stripeFreq: 1.4, belly: 0.5, bump: 0.02, rough: 0.78, warm: 1 },
    },
    trike: {
      model: 'trike', length: 8.5, prefix: 'Triceratops',
      colors: { LightBrown: 0xbcae92, Purple: 0x6b5d4a, Brown: 0x4e4032 },
      skin: { scale: 0.09, mottle: 0.5, stripe: 0.15, stripeFreq: 1.5, belly: 0.45, bump: 0.018, rough: 0.82, warm: 0.8 },
    },
    para: {
      model: 'para', length: 9.5, prefix: 'Parasaurolophus',
      colors: { LightYellow: 0xa99f7c, Green: 0x5d6443, LightGreen: 0x4a4a38, Red: 0x8b4b31 },
      skin: { scale: 0.08, mottle: 0.55, stripe: 0.4, stripeFreq: 1.8, belly: 0.55, bump: 0.014, rough: 0.78, warm: 0.9 },
    },
    stego: {
      model: 'stego', length: 8.5, prefix: 'Stegosaurus',
      colors: { LightBrown: 0x9a896a, DarkBrown: 0x6b3d28, Brown: 0x6b5a3e },
      skin: { scale: 0.08, mottle: 0.55, stripe: 0.2, stripeFreq: 1.5, belly: 0.5, bump: 0.016, rough: 0.8, warm: 0.8 },
    },
    apato: {
      model: 'apato', length: 19, prefix: 'Apatosaurus', deathClip: 'Stegosaurus_Death',
      colors: { Material: 0x7e7563, Brown: 0x4e4a3b },
      skin: { scale: 0.16, mottle: 0.5, stripe: 0.1, stripeFreq: 0.8, belly: 0.5, bump: 0.03, rough: 0.85, warm: 0.7 },
    },
    ptero: {
      model: 'dragon', wingspan: 7, prefix: 'Dragon', flyer: true,
      colors: { Main: 0x6d5c4a, Belly: 0xb8a582, Wings: 0x5a3426, Claws: 0x1d1813, Eyes: 0x0d0b09 },
      skin: { scale: 0.03, mottle: 0.5, stripe: 0, stripeFreq: 1, belly: 0.6, bump: 0.004, rough: 0.7, warm: 1.2 },
    },
  };
  const GLOSSY = { Black: 1, Eyes: 1, Claws: 1 };
  const KERATIN = { trike: 'LightBrown', raptor: 'Black', rex: 'Black', para: 'LightGreen' };

  // ------------------------------------------------------------------ skin shader
  const GLSL_NOISE = `
    uniform float uK, uScale, uMottle, uStripe, uStripeF, uBelly, uBump, uWarm, uTag, uSeed;
    uniform vec3 uUp, uFwd;
    varying vec3 vSP; varying vec3 vSN;
    float dh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float dvn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(dh3(i), dh3(i + vec3(1,0,0)), f.x), mix(dh3(i + vec3(0,1,0)), dh3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(dh3(i + vec3(0,0,1)), dh3(i + vec3(1,0,1)), f.x), mix(dh3(i + vec3(0,1,1)), dh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float dfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * dvn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
    vec3 dPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
      vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos); vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
      float det = dot(sx, r1) * fd; vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
      return normalize(abs(det) * surf_norm - grad); }
  `;
  function skinMaterial(colorHex, sk, tpl, glossy) {
    const m = new T.MeshStandardMaterial({
      color: new T.Color().setHex(colorHex).convertSRGBToLinear(),
      roughness: glossy ? 0.22 : sk.rough, metalness: 0,
      side: T.FrontSide,
    });
    if (glossy) return m;
    const u = {
      uK: { value: tpl.k }, uScale: { value: sk.scale }, uMottle: { value: sk.mottle }, uStripe: { value: sk.stripe },
      uStripeF: { value: sk.stripeFreq }, uBelly: { value: sk.belly }, uBump: { value: sk.bump }, uWarm: { value: sk.warm },
      uTag: { value: 0 }, uSeed: { value: Math.random() * 50 }, uUp: { value: tpl.localUp.clone() }, uFwd: { value: tpl.localFwd.clone() },
    };
    m.userData.u = u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSP; varying vec3 vSN;')
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvSP = transformed; vSN = objectNormal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + '\nfloat skinH = 0.0; float skinEdge = 0.5;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 P = vSP * uK + uSeed;
            vec3 N = normalize(vSN);
            float up = dot(N, normalize(uUp));
            float big = dfbm(P * 0.55) * 1.14;
            float fine = dfbm(P * 2.8) * 1.14;
            vec3 col = diffuseColor.rgb;
            col *= mix(1.0, 0.7 + 0.6 * big, uMottle);
            col *= mix(1.0, 0.88 + 0.24 * fine, 0.4 * uMottle * (1.0 - smoothstep(0.1, 0.5, length(fwidth(P * 2.8)))));
            float dorsal = smoothstep(-0.55, 0.75, up);
            col *= mix(1.0, mix(1.22, 0.82, dorsal), uBelly);
            float along = dot(P, normalize(uFwd));
            float bands = smoothstep(0.55, 0.85, sin(along * uStripeF * 6.2832 + big * 5.0) * 0.5 + 0.5);
            col *= 1.0 - bands * uStripe * smoothstep(0.0, 0.6, up);
            float mid = fine;
            float wfade = 1.0 - smoothstep(0.08, 0.3, length(fwidth(P / uScale * 0.35)));
            float wr = wfade > 0.0 ? dvn(P / uScale * 0.35) * wfade : 0.0;
            skinEdge = mid;
            skinH = (wr * 0.5 + mid * 0.9 + big * 1.6) * uBump;
            diffuseColor.rgb = col;
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor + (0.5 - skinEdge) * 0.18, 0.25, 1.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = dPerturb(-vViewPosition, normal, vec2(dFdx(skinH), dFdy(skinH)), faceDirection);`)
        .replace('#include <output_fragment>', `
          { float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
            outgoingLight += diffuseColor.rgb * vec3(0.9, 0.32, 0.2) * fr * 0.22 * uWarm;
            outgoingLight += vec3(0.85, 0.08, 0.04) * fr * uTag; }
          #include <output_fragment>`);
    };
    m.customProgramCacheKey = () => 'dinoskin';
    return m;
  }

  // ------------------------------------------------------------------ geometry helpers
  /** Smooth the faceted normals (keeps hard creases above ~55 degrees). Shared across clones. */
  function smoothNormals(meshes) {
    const key = (x, y, z) => Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
    const sum = new Map();
    for (const m of meshes) {
      const g = m.geometry, p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const k = key(p.getX(i), p.getY(i), p.getZ(i)); let s = sum.get(k);
        if (!s) sum.set(k, s = [0, 0, 0]);
        s[0] += n.getX(i); s[1] += n.getY(i); s[2] += n.getZ(i);
      }
    }
    const lim = Math.cos(55 * Math.PI / 180);
    for (const m of meshes) {
      const g = m.geometry, p = g.attributes.position, n = g.attributes.normal;
      if (g.userData.smoothed) continue; g.userData.smoothed = true;
      for (let i = 0; i < p.count; i++) {
        const s = sum.get(key(p.getX(i), p.getY(i), p.getZ(i)));
        const l = Math.hypot(s[0], s[1], s[2]) || 1, sx = s[0] / l, sy = s[1] / l, sz = s[2] / l;
        if (sx * n.getX(i) + sy * n.getY(i) + sz * n.getZ(i) > lim) n.setXYZ(i, sx, sy, sz);
      }
      n.needsUpdate = true;
    }
  }

  const PART = name => {
    if (/^Head$|Face|Nose/.test(name)) return 'head';
    if (/Neck/.test(name)) return 'neck';
    if (/Tail/.test(name)) return 'tail';
    if (/Wing|Shoulder\./.test(name)) return 'wing';
    if (/Leg|Foot|Feet/.test(name)) return 'leg';
    return 'body';
  };

  /** PCA capsule fit of points (array of Vector3, bone-local). */
  function fitCapsule(pts) {
    const c = new T.Vector3(); pts.forEach(p => c.add(p)); c.multiplyScalar(1 / pts.length);
    const C = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
    for (const p of pts) { const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
    let ax = new T.Vector3(0.3, 1, 0.2).normalize();
    for (let i = 0; i < 24; i++) {
      ax.set(C[0] * ax.x + C[1] * ax.y + C[2] * ax.z, C[1] * ax.x + C[3] * ax.y + C[4] * ax.z, C[2] * ax.x + C[4] * ax.y + C[5] * ax.z);
      const l = ax.length(); if (l < 1e-20) { ax.set(0, 1, 0); break; } ax.multiplyScalar(1 / l);
    }
    const proj = [], rad = [], tmp = new T.Vector3();
    for (const p of pts) { tmp.subVectors(p, c); const t = tmp.dot(ax); proj.push(t); rad.push(tmp.addScaledVector(ax, -t).length()); }
    proj.sort((a, b) => a - b); rad.sort((a, b) => a - b);
    const pc = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
    const t0 = pc(proj, 0.03), t1 = pc(proj, 0.97), r = pc(rad, 0.8);
    let a0 = t0 + r * 0.75, a1 = t1 - r * 0.75;
    if (a1 < a0) { const m = (t0 + t1) / 2; a0 = a1 = m; }
    return { a: c.clone().addScaledVector(ax, a0), b: c.clone().addScaledVector(ax, a1), r };
  }

  /** k=2 clustering for the two eyes. */
  function twoClusters(pts) {
    let a = pts[0], b = pts[0], best = -1;
    for (const p of pts) { const d = p.distanceToSquared(pts[0]); if (d > best) { best = d; b = p; } }
    best = -1; for (const p of pts) { const d = p.distanceToSquared(b); if (d > best) { best = d; a = p; } }
    let ca = a.clone(), cb = b.clone();
    for (let it = 0; it < 6; it++) {
      const sa = new T.Vector3(), sb = new T.Vector3(); let na = 0, nb = 0;
      for (const p of pts) { if (p.distanceToSquared(ca) < p.distanceToSquared(cb)) { sa.add(p); na++; } else { sb.add(p); nb++; } }
      if (na) ca = sa.multiplyScalar(1 / na); if (nb) cb = sb.multiplyScalar(1 / nb);
    }
    const ra = [], rb = [];
    for (const p of pts) { if (p.distanceToSquared(ca) < p.distanceToSquared(cb)) ra.push(p.distanceTo(ca)); else rb.push(p.distanceTo(cb)); }
    const mx = arr => arr.reduce((m, v) => Math.max(m, v), 0);
    return [{ c: ca, r: mx(ra) }, { c: cb, r: mx(rb) }];
  }

  // eye placement in the head's rest box (forward +Z): [half-width fraction, height fraction, length fraction from the back, radius / head height]
  const EYE = { raptor: [0.7, 0.73, 0.32, 0.08], trex: [0.68, 0.74, 0.38, 0.07], trike: [0.5, 0.45, 0.02, 0.06], para: [0.7, 0.73, 0.35, 0.08] };
  const UPV = new T.Vector3(0, 1, 0);
  const comp = (a, i, c) => c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);

  // ------------------------------------------------------------------ templates
  const modelPrep = {}; // model key -> measured data in model space
  function prepModel(mk) {
    if (modelPrep[mk]) return modelPrep[mk];
    const g = A.get('dino_m_' + mk);
    if (!g) return null;
    const scene = g.scene; scene.updateMatrixWorld(true);
    const meshes = []; scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    smoothNormals(meshes);
    // hit capsules per bone (bone-local) + eye / mouth points
    const perBone = new Map(), eyePts = [], mouthPts = [], headPts = [];
    const v = new T.Vector3(), mtx = new T.Matrix4();
    let headBoneName = 'Head';
    for (const m of meshes) {
      const geo = m.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const matName = mats[0].name;
      const isEye = /^(Black|Eyes)$/.test(matName), isMouth = matName === 'Red' && mk === 'trex';
      const sk = m.skeleton;
      for (let i = 0; i < pos.count; i++) {
        let j = 0, w = -1;
        for (let c = 0; c < 4; c++) { const wc = comp(sw, i, c); if (wc > w) { w = wc; j = comp(si, i, c); } }
        const bone = sk.bones[j]; if (!bone) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(sk.boneInverses[j]);
        if (bone.name === 'Head') headPts.push([meshes.indexOf(m), i]);
        if (isEye && /^(Head|Face)$/.test(bone.name)) { eyePts.push(v.clone()); headBoneName = bone.name; continue; }
        if (isEye && mk === 'dragon') continue;
        if (isMouth) { mouthPts.push({ bone: bone.name, p: v.clone() }); }
        if (!perBone.has(bone.name)) perBone.set(bone.name, []);
        perBone.get(bone.name).push(v.clone());
      }
    }
    const capsules = [];
    for (const [name, pts] of perBone) {
      if (pts.length < 10) continue;
      const c = fitCapsule(pts); c.bone = name; c.part = PART(name);
      capsules.push(c);
    }
    const specials = [];
    if (eyePts.length >= 6 && mk !== 'dragon') {
      for (const e of twoClusters(eyePts)) specials.push({ bone: headBoneName, part: 'eye', c: e.c, r: e.r * 1.5 });
    }
    if (mouthPts.length) {
      // the mouth: the red interior on the head bone
      const hp = mouthPts.filter(m => m.bone === 'Head').map(m => m.p);
      if (hp.length) { const c = new T.Vector3(); hp.forEach(p => c.add(p)); c.multiplyScalar(1 / hp.length); let r = 0; hp.forEach(p => { r = Math.max(r, p.distanceTo(c)); }); specials.push({ bone: 'Head', part: 'mouth', c, r: r * 0.7 }); }
    }
    // measure the Idle pose, forward axis and natural foot speeds on a clone
    const clone = T.SkeletonUtils.clone(scene);
    const mixer = new T.AnimationMixer(clone);
    const clips = {}; for (const a of g.animations) clips[a.name.split('|').pop().replace(/^[A-Za-z]+_/, '')] = a;
    if (mk === 'apato') { const d = g.animations.find(a => /Death/.test(a.name)); if (d) clips.Death = d; }
    const idle = clips.Idle || clips.Flying;
    const box = new T.Box3();
    const cm = []; clone.traverse(o => { if (o.isSkinnedMesh) cm.push(o); });
    if (idle) { const act = mixer.clipAction(idle); act.play(); mixer.setTime(0); }
    clone.updateMatrixWorld(true);
    for (const m of cm) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 2) { v.fromBufferAttribute(p, i); m.boneTransform(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v); }
    }
    const head = clone.getObjectByName('Head'), tail = clone.getObjectByName('Tail2') || clone.getObjectByName('Tail1');
    const hp = head.getWorldPosition(new T.Vector3()), tp = tail.getWorldPosition(new T.Vector3());
    const yawFix = -Math.atan2(hp.x - tp.x, hp.z - tp.z); // rotate so the head points at +Z
    if (!specials.some(x => x.part === 'eye') && EYE[mk]) {
      // no eye material: eyes sit at fixed fractions of the head's box in the Idle pose (tuned by eye)
      const hpts = headPts.map(([mi, vi]) => { const m = cm[mi]; const p = new T.Vector3().fromBufferAttribute(m.geometry.attributes.position, vi); m.boneTransform(vi, p); return p.applyMatrix4(m.matrixWorld).applyAxisAngle(UPV, yawFix); });
      if (hpts.length) {
        const bb = new T.Box3().setFromPoints(hpts), k = EYE[mk];
        const cx = (bb.min.x + bb.max.x) / 2, hw = (bb.max.x - bb.min.x) / 2, hh = bb.max.y - bb.min.y;
        const inv = new T.Matrix4().copy(head.matrixWorld).invert(), sc = 1 / head.matrixWorld.getMaxScaleOnAxis();
        for (const sgn of [-1, 1]) {
          const w = new T.Vector3(cx + sgn * hw * k[0], bb.min.y + hh * k[1], bb.min.z + (bb.max.z - bb.min.z) * k[2]);
          w.applyAxisAngle(UPV, -yawFix).applyMatrix4(inv);
          specials.push({ bone: 'Head', part: 'eye', c: w, r: hh * k[3] * sc });
        }
      }
    }
    const size = box.getSize(new T.Vector3());
    const measure = { length: size.z, span: size.x, height: size.y, minY: box.min.y, center: box.getCenter(new T.Vector3()) };
    // foot speeds (model units / s)
    const speeds = {};
    for (const name of ['Walk', 'Run']) {
      const clip = clips[name]; if (!clip) continue;
      mixer.stopAllAction(); const act = mixer.clipAction(clip); act.reset().play();
      const feet = ['BackFootL', 'BackFootR', 'BackFoot.L', 'BackFoot.R'].map(n => clone.getObjectByName(n)).filter(Boolean);
      if (!feet.length) continue;
      const N = 48, dt = clip.duration / N, samples = feet.map(() => []);
      for (let s = 0; s <= N; s++) {
        mixer.setTime(s * dt); clone.updateMatrixWorld(true);
        feet.forEach((f, k) => samples[k].push(f.getWorldPosition(new T.Vector3())));
      }
      let tot = 0, cnt = 0;
      for (const ss of samples) {
        let lo = Infinity, hi = -Infinity; ss.forEach(p => { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
        for (let s = 1; s < ss.length; s++) {
          if (ss[s].y < lo + (hi - lo) * 0.2) { const vz = -(ss[s].z - ss[s - 1].z) / dt; if (vz > 0) { tot += vz; cnt++; } }
        }
      }
      if (cnt) speeds[name] = tot / cnt;
    }
    mixer.stopAllAction();
    const meshWorldScale = meshes[0].matrixWorld.getMaxScaleOnAxis();
    const inv = new T.Matrix4().copy(meshes[0].matrixWorld).invert();
    const localUp = new T.Vector3(0, 1, 0).transformDirection(inv);
    const localFwd = new T.Vector3(Math.sin(-yawFix), 0, Math.cos(-yawFix)).transformDirection(inv);
    void mtx;
    // nose direction in head-bone space (the dragon's Nose bone hangs off Face, not Head)
    let noseLocal = null;
    const hb = scene.getObjectByName('Head'), nb = scene.getObjectByName('Nose');
    if (hb && nb) noseLocal = nb.getWorldPosition(new T.Vector3()).applyMatrix4(new T.Matrix4().copy(hb.matrixWorld).invert());
    return (modelPrep[mk] = { noseLocal, gltf: g, capsules, specials, clips, measure, yawFix, speeds, meshWorldScale, localUp, localFwd });
  }

  const templates = {};
  function template(vk) {
    if (templates[vk]) return templates[vk];
    const V = VARIANTS[vk]; if (!V) return null;
    const P = prepModel(V.model); if (!P) return null;
    const scale = V.wingspan ? V.wingspan / P.measure.span : V.length / P.measure.length;
    const tpl = {
      key: vk, V, P, scale, k: P.meshWorldScale * scale, localUp: P.localUp, localFwd: P.localFwd,
      groundOffset: -P.measure.minY * scale, height: P.measure.height * scale, length: P.measure.length * scale,
      radius: 0.5 * Math.hypot(P.measure.length, P.measure.height, P.measure.span) * scale,
      speeds: { walk: (P.speeds.Walk || 0) * scale, run: (P.speeds.Run || 0) * scale },
    };
    tpl.materials = {};
    for (const name in V.colors) tpl.materials[name] = skinMaterial(V.colors[name], V.skin, tpl, !!GLOSSY[name]);
    const ker = KERATIN[V.model === 'trex' ? 'rex' : V.model]; if (ker && tpl.materials[ker] && !GLOSSY[ker]) tpl.materials[ker].roughness = 0.5;
    if (tpl.materials.Wings) tpl.materials.Wings.side = T.DoubleSide;
    return (templates[vk] = tpl);
  }

  // ------------------------------------------------------------------ instances
  const _v = new T.Vector3();
  function instance(vk, o) {
    const tpl = template(vk); if (!tpl) return null;
    o = o || {};
    const P = tpl.P, V = tpl.V;
    const model = T.SkeletonUtils.clone(P.gltf.scene);
    const inner = new T.Group(); inner.add(model);
    model.scale.setScalar(tpl.scale); model.rotation.y = P.yawFix;
    if (V.flyer) { const c = P.measure.center.clone().applyAxisAngle(new T.Vector3(0, 1, 0), P.yawFix).multiplyScalar(tpl.scale); model.position.copy(c).negate(); }
    inner.position.y = tpl.groundOffset;
    const root = new T.Group(); root.add(inner);
    const tagMats = o.tagged ? {} : null;
    model.traverse(m => {
      if (!m.isMesh) return;
      // no shadow-map casting (the sun's map is static now): dinos.js gives each animal a contact shadow
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
      let mat = tpl.materials[name] || tpl.materials[Object.keys(tpl.materials)[0]];
      if (tagMats && mat.userData.u) {
        if (!tagMats[name]) { tagMats[name] = skinMaterial(V.colors[name], V.skin, tpl, false); tagMats[name].userData.u.uTag.value = 0.45; tagMats[name].customProgramCacheKey = () => 'dinoskin'; } // red rim glow: reads at 150 m
        mat = tagMats[name];
      }
      m.material = mat;
      if (V.flyer && name === 'Eyes') m.visible = false; // the dragon's cartoon eyes
    });
    const bones = {}; model.traverse(b => { if (b.isBone) bones[b.name] = b; });
    const hit = P.capsules.map(c => ({ bone: bones[c.bone], part: c.part, a: c.a, b: c.b, r: c.r }));
    const specials = P.specials.map(s => ({ bone: bones[s.bone], part: s.part, c: s.c, r: s.r }));
    // dilophosaur crests: two thin bony crests along the top of the skull
    if (V.crests && bones.Head) {
      const hc = P.capsules.find(c => c.bone === 'Head');
      if (hc) {
        const len = (hc.a.distanceTo(hc.b) + hc.r * 1.6) * 0.8, h = hc.r * 0.5;
        const shp = new T.Shape(); shp.moveTo(0, 0); shp.quadraticCurveTo(len * 0.25, h * 1.1, len * 0.55, h); shp.quadraticCurveTo(len * 0.85, h * 0.7, len, 0); shp.lineTo(0, 0);
        const geo = new T.ExtrudeGeometry(shp, { depth: hc.r * 0.06, bevelEnabled: false });
        const mat = skinMaterial(0x7a3e22, V.skin, tpl, false); mat.side = T.DoubleSide;
        mat.color.setHex(0x86603e).convertSRGBToLinear(); mat.userData.u.uMottle.value = 0.9; mat.userData.u.uStripe.value = 0.6;
        for (const s of [-1, 1]) {
          const m = new T.Mesh(geo, mat); m.castShadow = false;
          // bone-local: axis from a to b runs along the skull; place crests on top (+ the up side)
          const ax = _v.subVectors(hc.b, hc.a).normalize().clone();
          const upL = new T.Vector3(0, 0, 1); // tuned visually below via userData
          m.userData.crest = { ax, s, hc, upL };
          bones.Head.add(m);
        }
      }
    }
    // tag collar: a radio collar round the neck with a faint blinking LED
    let collar = null;
    if (o.tagged) {
      const nc = P.capsules.find(c => c.bone === 'Neck') || P.capsules.find(c => c.bone === 'Head');
      const nb = bones[nc.bone];
      collar = new T.Group();
      const rr = nc.r * 0.92;
      const band = new T.Mesh(new T.TorusGeometry(rr, nc.r * 0.07, 8, 28), new T.MeshStandardMaterial({ color: 0x8a1a12, roughness: 0.55, metalness: 0.1 }));
      const box = new T.Mesh(new T.BoxGeometry(nc.r * 0.45, nc.r * 0.35, nc.r * 0.3), new T.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.3 }));
      box.position.set(0, -rr, 0);
      const led = new T.Mesh(new T.SphereGeometry(nc.r * 0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xff2a10 }));
      led.position.set(0, -rr - nc.r * 0.18, 0);
      collar.add(band, box, led); collar.userData.led = led;
      const ax = new T.Vector3().subVectors(nc.b, nc.a); if (ax.lengthSq() < 1e-12) ax.set(0, 1, 0); ax.normalize();
      collar.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), ax);
      collar.position.copy(nc.a).lerp(nc.b, 0.5);
      band.castShadow = box.castShadow = false;
      nb.add(collar);
    }
    // pterosaur stand-in: a long beak instead of a dragon snout (scale the head along its nose axis)
    let headStretch = null;
    if (V.flyer && bones.Head && P.noseLocal) {
      const n = P.noseLocal, ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z') : (Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z');
      headStretch = new T.Vector3(0.75, 0.75, 0.75); headStretch[ax] = 1.9;
    }
    const mixer = new T.AnimationMixer(model);
    const boneScale = V.flyer ? { Tail1: 0.4, UpperLegL: 0.72, UpperLegR: 0.72 } : null;
    return { headStretch, boneScale, tpl, root, inner, model, mixer, bones, hit, specials, collar, clips: P.clips };
  }

  /** Place the dilo crests in head-bone space (called once after the first pose update). */
  function fixCrests(inst) {
    const head = inst.bones.Head; if (!head) return;
    head.children.forEach(m => {
      const c = m.userData.crest; if (!c) return;
      // world up expressed in head-local space -> the top of the skull
      const inv = new T.Matrix4().copy(head.matrixWorld).invert();
      const upL = new T.Vector3(0, 1, 0).transformDirection(inv);
      const ax = c.ax.clone(); upL.addScaledVector(ax, -upL.dot(ax)).normalize();
      const side = new T.Vector3().crossVectors(ax, upL).normalize();
      const basis = new T.Matrix4().makeBasis(ax, upL, side);
      m.quaternion.setFromRotationMatrix(basis);
      m.position.copy(c.hc.a).addScaledVector(ax, -c.hc.r * 0.7).addScaledVector(upL, c.hc.r * 0.55).addScaledVector(side, c.s * c.hc.r * 0.42);
      delete m.userData.crest;
    });
  }

  DH.DinoLook = { VARIANTS, MODELS, template, instance, fixCrests, prepModel };
})();
