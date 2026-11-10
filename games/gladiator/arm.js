/*
 * Iron Ludus - your sword arm: the sword, the gauntlet round its grip, forearm and upper arm.
 * Classic script: defines window.LudusArm (needs THREE, LudusCombat, MimicMath).
 *
 * The sword turns exactly as the phone turns (with the grip's roll taken out at CENTRE, so a
 * natural grip shows knuckles up and edges top and bottom). The hand holds the sword; the arm is a
 * two-bone IK chain from a fixed shoulder to the wrist behind the fist, so the forearm always meets
 * the gauntlet and the hand never leaves the hilt. Space: your head (x right, y up, z back), with
 * the rig shifted by C.BODY.rigOffset to bring the hilt into view.
 */
(function () {
  'use strict';
  const T = THREE, C = LudusCombat, MM = MimicMath;
  const BLADE = C.BODY.blade, GUARD_Z = C.BODY.guardZ;
  const RIG_OFFSET = new T.Vector3(...C.BODY.rigOffset);
  // the camera sits a little above and behind your eyes so a blade pointing at him still reads as a blade
  const CAM = new T.Vector3(0.04, 0.12, 0.2);
  const { upper: UPPER, fore: FORE, armExt: ARM_EXT, wrist: WRIST } = C.ARM;

  const lin = c => new T.Color(c).convertSRGBToLinear();
  const std = (c, rough, metal, extra) => new T.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: rough, metalness: metal || 0 }, extra || {}));

  /* ----------------------------------------------------------------- sword */
  /**
   * A blade along -Z from z = 0: a flattened hexagonal section, flats facing +-X, edges +-Y, with a
   * fuller down the middle of each flat. Groups: 0 flats, 1 bevels (the edge), 2 fuller.
   */
  function bladeGeometry(L) {
    const N = 16, groups = [[], [], []];
    const ring = s => {
      const w = s < 0.84 ? 0.033 * (1 - 0.2 * s) : 0.033 * (1 - 0.2 * 0.84) * (1 - (s - 0.84) / 0.16);
      const t = 0.0064 * (1 - 0.5 * s), b = Math.min(w, 0.0095), fw = Math.max(0, Math.min(0.0058, (w - b) * 0.6)), z = -s * L;
      return [[0, w, z], [t, w - b, z], [t, fw, z], [t, -fw, z], [t, -(w - b), z], [0, -w, z], [-t, -(w - b), z], [-t, -fw, z], [-t, fw, z], [-t, w - b, z]];
    };
    const SIDE = [1, 0, 2, 0, 1, 1, 0, 2, 0, 1];
    let prev = ring(0);
    for (let i = 1; i <= N; i++) {
      const cur = ring(i / N), fuller = (i - 0.5) / N < 0.62;
      for (let j = 0; j < 10; j++) {
        const a = prev[j], b = prev[(j + 1) % 10], c = cur[(j + 1) % 10], d = cur[j];
        const g = SIDE[j] === 2 && !fuller ? 0 : SIDE[j];
        groups[g].push(a, b, c, a, c, d);
      }
      prev = cur;
    }
    const pos = [];
    for (const g of groups) for (const p of g) pos.push(...p);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    let off = 0;
    groups.forEach((g, k) => { geo.addGroup(off, g.length, k); off += g.length; });
    geo.computeVertexNormals();
    return geo;
  }
  let gripTex = null;
  function leatherWrap() {
    if (gripTex) return gripTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#3a2416'; g.fillRect(0, 0, 64, 128);
    for (let i = -4; i < 12; i++) {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.moveTo(0, i * 16); g.lineTo(64, i * 16 + 20); g.lineTo(64, i * 16 + 23); g.lineTo(0, i * 16 + 3); g.fill();
      g.fillStyle = 'rgba(255,210,170,0.08)'; g.beginPath(); g.moveTo(0, i * 16 + 5); g.lineTo(64, i * 16 + 25); g.lineTo(64, i * 16 + 27); g.lineTo(0, i * 16 + 7); g.fill();
    }
    gripTex = new T.CanvasTexture(c); gripTex.encoding = T.sRGBEncoding; gripTex.wrapS = gripTex.wrapT = T.RepeatWrapping;
    return gripTex;
  }
  /** Your sword: blade along -Z from the crossguard at GUARD_Z, grip and pommel behind it (+Z). */
  function buildSword() {
    const g = new T.Group();
    const flat = std(0xe6e2da, 0.18, 1, { envMapIntensity: 1.5 }), edge = std(0xffffff, 0.05, 1, { envMapIntensity: 2.2, emissive: lin(0x2a2c30) });
    const fuller = std(0x8a929c, 0.3, 1, { envMapIntensity: 1.3 });
    const blade = new T.Mesh(bladeGeometry(BLADE), [flat, edge, fuller]); blade.position.z = GUARD_Z - 0.004; g.add(blade);
    const iron = LudusMat.mat(LudusMat.iron(), { rough: 0.32, metal: 1, env: 1.4, tint: 0xc9a46a });
    const bar = new T.Mesh(new T.CapsuleGeometry(0.011, 0.15, 4, 10), iron); bar.scale.set(1, 1, 0.8); bar.position.z = GUARD_Z; g.add(bar);
    const block = new T.Mesh(new T.BoxGeometry(0.03, 0.034, 0.024), iron); block.position.z = GUARD_Z + 0.002; g.add(block);
    const tex = leatherWrap();
    const grip = new T.Mesh(new T.CylinderGeometry(0.0165, 0.0175, 0.15, 14), std(0xffffff, 0.62, 0, { map: tex, bumpMap: tex, bumpScale: 0.004 }));
    for (const z of [GUARD_Z + 0.014, GUARD_Z + 0.16]) { const f = new T.Mesh(new T.TorusGeometry(0.0178, 0.0035, 6, 18), iron); f.position.z = z; g.add(f); }
    grip.rotation.x = Math.PI / 2; grip.position.z = GUARD_Z + 0.087; g.add(grip);
    const pommel = new T.Mesh(new T.LatheGeometry([[0, -0.012], [0.017, -0.012], [0.027, -0.006], [0.028, 0], [0.027, 0.006], [0.017, 0.012], [0, 0.012]].map(p => new T.Vector2(p[0], p[1])), 18), iron);
    pommel.rotation.z = Math.PI / 2; pommel.position.z = GUARD_Z + 0.172; g.add(pommel);   // a wheel, faces to the flats
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    return g;
  }

  /* -------------------------------------------------------------- gauntlet */
  /**
   * A right gauntlet closed round a grip on the Z axis (centre z = 0): back of the hand to +X, fingers
   * wrapping under (-Y) to the palm (-X), thumb over the top, knuckle plate riveted on.
   */
  function buildGauntlet(leather, plate) {
    const g = new T.Group();
    const R0 = 0.017, ARC = Math.PI * 1.25;
    for (let i = 0; i < 4; i++) {
      const z = GUARD_Z + 0.032 + i * 0.023, r = 0.0115 - i * 0.0008;
      const f = new T.Mesh(new T.TorusGeometry(R0 + r, r, 10, 18, ARC), leather);
      f.rotation.z = -ARC + 0.35; f.position.z = z; g.add(f);
      // two lames over the back of each finger, overlapping like scales
      for (const [a0, a1] of [[-0.35, 0.42], [-1.2, -0.42]]) {
        const pl = new T.Mesh(new T.TorusGeometry(R0 + r, r * 1.22, 6, 8, a1 - a0), plate);
        pl.rotation.z = a0; pl.position.z = z; pl.scale.z = 0.82; g.add(pl);
      }
      for (const a of [0.35, 0.35 - ARC]) {   // round off both ends of the curled finger
        const tip = new T.Mesh(new T.SphereGeometry(r, 10, 8), leather);
        tip.position.set(Math.cos(a) * (R0 + r), Math.sin(a) * (R0 + r), z); g.add(tip);
      }
    }
    // back of the hand, knuckles to wrist
    const back = new T.Mesh(new T.SphereGeometry(1, 18, 12), leather);
    back.scale.set(0.024, 0.033, 0.06); back.position.set(0.026, -0.006, GUARD_Z + 0.105); g.add(back);
    const palm = new T.Mesh(new T.SphereGeometry(1, 16, 10), leather);
    palm.scale.set(0.02, 0.03, 0.05); palm.position.set(-0.02, -0.014, GUARD_Z + 0.1); g.add(palm);
    const bp = new T.Mesh(new T.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), plate);
    bp.scale.set(0.034, 0.02, 0.05); bp.rotation.z = -Math.PI / 2; bp.position.set(0.033, -0.008, GUARD_Z + 0.108); g.add(bp);
    // knuckle plate and rivets
    const kp = new T.Mesh(new T.CapsuleGeometry(0.0135, 0.072, 4, 10), plate);
    kp.rotation.x = Math.PI / 2; kp.position.set(0.03, 0.006, GUARD_Z + 0.066); kp.scale.set(1, 1, 0.75); g.add(kp);
    for (let i = 0; i < 4; i++) { const rv = new T.Mesh(new T.SphereGeometry(0.0042, 8, 6), plate); rv.position.set(0.042, 0.008, GUARD_Z + 0.036 + i * 0.023); g.add(rv); }
    // thumb: from the palm side over the top of the grip, its tip on the index finger
    const thumb = new T.Mesh(new T.CapsuleGeometry(0.0115, 0.05, 4, 10), leather);
    const ta = new T.Vector3(-0.022, 0.012, GUARD_Z + 0.085), tb = new T.Vector3(0.006, 0.026, GUARD_Z + 0.036);
    thumb.position.copy(ta).lerp(tb, 0.5); thumb.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), tb.clone().sub(ta).normalize()); g.add(thumb);
    // a wrist ball: the forearm's cuff closes over it from any angle
    const wrist = new T.Mesh(new T.SphereGeometry(0.03, 16, 12), leather);
    wrist.position.set(WRIST.x, WRIST.y, WRIST.z); g.add(wrist);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    return g;
  }
  const lathe = (pts, mat, seg) => new T.Mesh(new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 18), mat);
  /** Forearm along +Y from the elbow (y = 0) to the wrist (y = FORE): leather bracer, straps, the gauntlet's flared cuff. */
  function buildForearm(linen, leather, plate) {
    const g = new T.Group();
    g.add(lathe([[0, -0.01], [0.05, 0.0], [0.054, 0.04], [0.05, 0.075], [0.043, 0.1], [0, 0.1]], linen));   // the sleeve bunched at the elbow
    g.add(lathe([[0.046, 0.06], [0.046, 0.09], [0.044, 0.2], [0.038, FORE - 0.02], [0, FORE - 0.02]], leather));
    for (const y of [0.11, 0.19]) { const st = new T.Mesh(new T.TorusGeometry(0.0465 - (y - 0.11) * 0.03, 0.004, 6, 22), leather); st.rotation.x = Math.PI / 2; st.position.y = y; g.add(st); }
    // the gauntlet's iron cuff flares past the wrist and over the back of the hand
    g.add(lathe([[0.04, FORE - 0.06], [0.043, FORE - 0.03], [0.05, FORE + 0.01], [0.056, FORE + 0.032], [0.052, FORE + 0.036], [0.047, FORE + 0.01]], plate));
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, rv = new T.Mesh(new T.SphereGeometry(0.0045, 8, 6), plate); rv.position.set(Math.cos(a) * 0.046, FORE - 0.035, Math.sin(a) * 0.046); g.add(rv); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    return g;
  }
  /** Upper arm along +Y from the shoulder to the elbow: tunic sleeve and elbow cop. */
  function buildUpperArm(cloth, plate, skin) {
    const g = new T.Group();
    g.add(lathe([[0, -0.02], [0.058, -0.01], [0.06, 0.08], [0.052, UPPER - 0.03], [0.048, UPPER], [0, UPPER]], cloth));
    const elbow = new T.Mesh(new T.SphereGeometry(0.05, 16, 12), skin); elbow.position.y = UPPER; g.add(elbow);
    const cop = new T.Mesh(new T.SphereGeometry(0.052, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), plate); cop.position.y = UPPER; cop.rotation.x = -Math.PI / 2; g.add(cop);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    return g;
  }

  /** A body (Group facing -Z at the feet) with a head at eye height; the rig hangs off the head. */
  function makeBody(parent) {
    const body = new T.Group(); parent.add(body);
    const head = new T.Group(); head.position.y = C.BODY.eye; body.add(head);
    return { body, head };
  }
  function makeRig(head, tint) {
    const R = { armState: {}, fadeLimb: 1 };
    R.rig = new T.Group(); R.rig.position.copy(RIG_OFFSET); head.add(R.rig);
    R.head = head;
    R.hand = new T.Group(); R.rig.add(R.hand);
    R.swordGrp = buildSword(); R.hand.add(R.swordGrp);
    const M = LudusMat;
    const leather = M.mat(M.leather('dark'), { rough: 0.55, env: 0.7 }), plate = M.mat(M.iron(), { rough: 0.3, metal: 0.9, env: 1.3 });
    R.fist = buildGauntlet(leather, plate); R.hand.add(R.fist);
    const linen = M.mat(M.linen(), { rough: 0.95, env: 0.4, tint: tint ? 0xffffff : 0xffffff });
    if (tint) linen.color = lin(tint).lerp(new T.Color(1, 1, 1), 0.55);
    R.limbMats = [linen, M.mat(M.leather(), { rough: 0.6, env: 0.6 }), plate, linen];
    R.forearm = buildForearm(R.limbMats[0], R.limbMats[1], R.limbMats[2]); R.rig.add(R.forearm);
    R.upperArm = buildUpperArm(R.limbMats[3], R.limbMats[2], R.limbMats[0]); R.rig.add(R.upperArm);
    R.armParts = [R.forearm, R.upperArm, R.fist];
    return R;
  }

  const solveArm = (q, pose, ext) => C.solveArm(q, pose, ext, MM.rotate);
  const tv = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
  /** The blade in world space (hilt, tip, edge direction) for q and pose, without moving any mesh. */
  function bladeWorld(R, q, pose, ext) {
    const hp = solveArm(q, pose, ext).hand;
    const bx = hp.x + RIG_OFFSET.x, by = hp.y + RIG_OFFSET.y, bz = hp.z + RIG_OFFSET.z;
    const hd = MM.rotate(q, { x: 0, y: 0, z: GUARD_Z }), td = MM.rotate(q, { x: 0, y: 0, z: GUARD_Z - BLADE }), e = MM.rotate(q, { x: 0, y: 1, z: 0 });
    return {
      h: new T.Vector3(bx + hd.x, by + hd.y, bz + hd.z).applyMatrix4(R.head.matrixWorld),
      t: new T.Vector3(bx + td.x, by + td.y, bz + td.z).applyMatrix4(R.head.matrixWorld),
      edge: new T.Vector3(e.x, e.y, e.z).transformDirection(R.head.matrixWorld),
    };
  }
  function orient(g, a, b) {
    g.position.set(a.x, a.y, a.z);
    tv.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    g.quaternion.setFromUnitVectors(UP, tv);
  }
  /** Put a rig's sword and arm where the phone says. q: sword orientation (THREE.Quaternion). */
  function poseRig(R, cam, q, pose, o) {
    const qp = { x: q.x, y: q.y, z: q.z, w: q.w };
    const A = solveArm(qp, pose, o.ext || 0);
    R.hand.quaternion.copy(q); R.hand.position.set(A.hand.x, A.hand.y, A.hand.z);
    orient(R.upperArm, A.shoulder, A.elbow);
    orient(R.forearm, A.elbow, A.wrist);
    R.solved = A;
    R.rig.updateMatrixWorld(true);
  }
  /** Your body's hit capsules in world space: head, torso, sword arm (as drawn), legs. */
  function bodyCapsules(R, B, q, pose, ext) {
    const A = solveArm(q, pose, ext);
    const p = B.body.position, hw = v => new T.Vector3(v.x + RIG_OFFSET.x, v.y + RIG_OFFSET.y, v.z + RIG_OFFSET.z).applyMatrix4(R.head.matrixWorld);
    const fz = new T.Vector3(0, 0, -1).transformDirection(B.body.matrixWorld), sx = new T.Vector3(1, 0, 0).transformDirection(B.body.matrixWorld);
    const at = (x, y, z) => new T.Vector3(p.x, y, p.z).addScaledVector(sx, x).addScaledVector(fz, z);
    const EYE = C.BODY.eye;
    return [
      { zone: 'head', a: at(0, EYE - 0.06, -0.02), b: at(0, EYE + 0.1, -0.02), r: 0.12 },
      { zone: 'torso', a: at(0, 0.98, -0.02), b: at(0, EYE - 0.24, -0.02), r: 0.19 },
      { zone: 'swordArm', a: hw(A.shoulder), b: hw(A.elbow), r: 0.055 },
      { zone: 'swordArm', a: hw(A.elbow), b: hw(A.hand), r: 0.055 },
      { zone: 'offArm', a: at(-0.22, 1.36, 0), b: at(-0.25, 1.02, -0.12), r: 0.05 },
      { zone: 'legs', a: at(-0.12, 0.92, 0), b: at(-0.13, 0.08, 0.02), r: 0.085 },
      { zone: 'legs', a: at(0.12, 0.92, 0), b: at(0.13, 0.08, 0.02), r: 0.085 },
    ];
  }
  /** A faint ribbon behind the outer blade, shown only while it moves fast. */
  function makeTrail(scene) {
    const N = 14, geo = new T.BufferGeometry();
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3), idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh);
    return { mesh, N, pts: [] };
  }
  function updateTrail(tr, blade, speed) {
    if (!tr || !blade) return;
    const k = Math.max(0, Math.min(1, (speed - 12) / 14));
    const a = blade.h.clone().lerp(blade.t, 0.68), b = blade.t.clone();
    // a jump (a lost sample, a re-aim) is not a swing: start the ribbon afresh
    if (tr.pts.length && tr.pts[0].b.distanceTo(b) > 0.6) tr.pts.length = 0;
    tr.pts.unshift({ a, b, k });
    if (tr.pts.length > tr.N) tr.pts.length = tr.N;
    const pos = tr.mesh.geometry.attributes.position.array, col = tr.mesh.geometry.attributes.color.array;
    for (let i = 0; i < tr.N; i++) {
      const p = tr.pts[Math.min(i, tr.pts.length - 1)], f = i >= tr.pts.length ? 0 : p.k * Math.pow(1 - i / (tr.N - 1), 2.2) * 0.2;
      pos.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], i * 6);
      col.set([0.55 * f, 0.62 * f, 0.75 * f, f, f * 0.97, f * 0.9], i * 6);
    }
    tr.mesh.geometry.attributes.position.needsUpdate = true; tr.mesh.geometry.attributes.color.needsUpdate = true;
    tr.mesh.visible = tr.pts.some(p => p.k > 0.02);
  }
  /** Camera position for a body: just above and behind the eyes. */
  function cameraAt(B, out) { return out.set(CAM.x, C.BODY.eye + CAM.y, CAM.z).applyMatrix4(B.body.matrixWorld); }

  window.LudusArm = { makeTrail, updateTrail, BLADE, GUARD_Z, RIG_OFFSET, CAM, ARM_EXT, buildSword, buildGauntlet, makeBody, makeRig, solveArm, bladeWorld, poseRig, bodyCapsules, cameraAt, bladeGeometry };
})();
