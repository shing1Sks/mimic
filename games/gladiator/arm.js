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
      const w = s < 0.86 ? 0.026 * (1 - 0.22 * s) : 0.026 * (1 - 0.22 * 0.86) * (1 - (s - 0.86) / 0.14);
      const t = 0.006 * (1 - 0.5 * s), b = Math.min(w, 0.0085), fw = Math.max(0, Math.min(0.0045, (w - b) * 0.6)), z = -s * L;
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
    const flat = std(0xc9d0d8, 0.3, 1, { envMapIntensity: 1.2 }), edge = std(0xf2f5f8, 0.12, 1, { envMapIntensity: 1.5 });
    const fuller = std(0x737b86, 0.42, 1, { envMapIntensity: 1.0 });
    const blade = new T.Mesh(bladeGeometry(BLADE), [flat, edge, fuller]); blade.position.z = GUARD_Z - 0.004; g.add(blade);
    const iron = std(0x7b6a4a, 0.35, 0.9);
    const bar = new T.Mesh(new T.CapsuleGeometry(0.011, 0.15, 4, 10), iron); bar.scale.set(1, 1, 0.8); bar.position.z = GUARD_Z; g.add(bar);
    const block = new T.Mesh(new T.BoxGeometry(0.03, 0.034, 0.024), iron); block.position.z = GUARD_Z + 0.002; g.add(block);
    const tex = leatherWrap();
    const grip = new T.Mesh(new T.CylinderGeometry(0.0165, 0.0175, 0.15, 14), std(0xffffff, 0.7, 0, { map: tex }));
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
  function buildForearm(skin, leather, plate) {
    const g = new T.Group();
    g.add(lathe([[0, -0.01], [0.046, 0.0], [0.047, 0.06], [0.04, 0.2], [0.035, FORE], [0, FORE]], skin));
    g.add(lathe([[0.049, 0.07], [0.05, 0.09], [0.045, 0.22], [0.044, 0.235]], leather));
    for (const y of [0.11, 0.19]) { const s = new T.Mesh(new T.TorusGeometry(0.0485 - (y - 0.11) * 0.04, 0.0035, 6, 20), plate); s.rotation.x = Math.PI / 2; s.position.y = y; g.add(s); }
    // the cuff flares past the wrist and over the back of the hand
    g.add(lathe([[0.039, FORE - 0.05], [0.043, FORE - 0.02], [0.05, FORE + 0.012], [0.054, FORE + 0.03], [0.05, FORE + 0.034]], leather));
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
    const leather = std(0x3d2617, 0.62, 0, { envMapIntensity: 0.5 }), plate = std(0x8c9096, 0.32, 0.85);
    R.fist = buildGauntlet(leather, plate); R.hand.add(R.fist);
    R.limbMats = [std(0x9b6b4c, 0.75), std(0x3d2617, 0.62), std(0x8c9096, 0.32, 0.85), std(tint || 0x4e1712, 0.9)];
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
  /** Camera position for a body: just above and behind the eyes. */
  function cameraAt(B, out) { return out.set(CAM.x, C.BODY.eye + CAM.y, CAM.z).applyMatrix4(B.body.matrixWorld); }

  window.LudusArm = { BLADE, GUARD_Z, RIG_OFFSET, CAM, ARM_EXT, buildSword, buildGauntlet, makeBody, makeRig, solveArm, bladeWorld, poseRig, bodyCapsules, cameraAt, bladeGeometry };
})();
