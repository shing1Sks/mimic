/*
 * Emberlane - your bowling arm. A rigged hand (WebXR generic hand, MIT) whose fingers are
 * curled around the ball by solving each joint against the ball's surface, the forearm, a
 * rolled shirt sleeve and a wristband (armmesh.js). Everything hangs in one group whose origin is the
 * shoulder and whose rotation is the phone's (kin.handRot): at identity the arm hangs straight
 * down with the palm toward the pins and the ball centre at (0, -L, 0).
 */
(function () {
  'use strict';
  const T = THREE, BW = window.BW, K = BW.Kin;
  const R = BW.Phys.BALL.R, L = K.ARM.L;
  const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
  const JOINTS = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal'];

  // dyed cotton reads deeper than the bright UI colour of the bowler
  const shirtTone = hex => { const c = new T.Color(hex), hsl = {}; c.getHSL(hsl); return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l * 0.7); };

  function build(gltf, opts) {
    opts = Object.assign({ left: false, skin: 0x8a5a40, shirt: 0xd8461c }, opts);
    const group = new T.Group();           // origin = shoulder, rotation = phone
    const ballAnchor = new T.Object3D();
    ballAnchor.position.set(0, -L, 0);
    group.add(ballAnchor);

    // ---- the hand
    const handRoot = gltf.scene;
    const bones = {};
    let skinned = null;
    handRoot.traverse(o => {
      if (o.isBone || (o.name && /finger|thumb|wrist/.test(o.name))) bones[o.name] = o;
      if (o.isSkinnedMesh) skinned = o;
    });
    const skinMat = new T.MeshPhysicalMaterial({ color: opts.skin, roughness: 0.52, metalness: 0, sheen: 0.3, sheenRoughness: 0.55,
      sheenColor: new T.Color(0xffb59a), clearcoat: 0.06, clearcoatRoughness: 0.5, envMapIntensity: 0.4 });
    if (skinned) { skinned.material = skinMat; skinned.castShadow = true; skinned.receiveShadow = true; skinned.frustumCulled = false; }
    // palm toward -z (the pins), fingers down, thumb to the outside; palm against the ball's back
    const holder = new T.Group();
    holder.add(handRoot);
    handRoot.rotation.y = opts.left ? Math.PI / 2 : -Math.PI / 2;
    // mirror for a left hand is done by the left model itself; the offsets mirror in x
    holder.position.set(0, -L + 0.02, R - 0.015);
    group.add(holder);
    group.updateMatrixWorld(true);

    // ---- finger poses: open (relaxed) and wrapped (solved against the ball)
    const ballC = new T.Vector3(0, -L, 0);
    const tmp = new T.Vector3(), tmpQ = new T.Quaternion();
    const chains = [];
    for (const f of FINGERS) chains.push(JOINTS.map(j => bones[f + '-' + j]).concat([bones[f + '-tip']]));
    chains.push(['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'].map(n => bones[n]));
    const rest = new Map();
    for (const ch of chains) for (const b of ch) if (b) rest.set(b, b.quaternion.clone());
    const wrapped = new Map();
    function worldOf(b) { b.updateMatrixWorld(true); return b.getWorldPosition(new T.Vector3()); }
    const toLocal = v => group.worldToLocal(v.clone());
    for (const ch of chains) {
      const isThumb = ch[0] && /thumb/.test(ch[0].name);
      for (let j = 0; j < ch.length - 1; j++) {
        const b = ch[j], child = ch[j + 1];
        if (!b || !child) continue;
        const target = R + (isThumb ? 0.011 : 0.0095);
        // which way curls toward the ball? try the bone's x and z axes both ways
        let best = null;
        for (const ax of [new T.Vector3(1, 0, 0), new T.Vector3(-1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, 0, -1)]) {
          b.quaternion.copy(rest.get(b)).multiply(tmpQ.setFromAxisAngle(ax, 0.15));
          const d = toLocal(worldOf(child)).distanceTo(ballC);
          if (!best || d < best.d) best = { ax, d };
          b.quaternion.copy(rest.get(b));
        }
        if (!isThumb) best.ax = new T.Vector3(-1, 0, 0);       // fingers flex about -x (the rig's convention)
        const d0 = toLocal(worldOf(child)).distanceTo(ballC);
        let ang = 0;
        if (d0 > target) {
          let lo = 0, hi = isThumb ? 0.9 : 1.75;
          for (let it = 0; it < 22; it++) {
            const mid = (lo + hi) / 2;
            b.quaternion.copy(rest.get(b)).multiply(tmpQ.setFromAxisAngle(best.ax, mid));
            const d = toLocal(worldOf(child)).distanceTo(ballC);
            if (d > target) lo = mid; else hi = mid;
          }
          ang = lo;
        }
        b.quaternion.copy(rest.get(b)).multiply(tmpQ.setFromAxisAngle(best.ax, ang));
        wrapped.set(b, b.quaternion.clone());
      }
    }
    const open = new Map();
    for (const [b, q] of wrapped) open.set(b, rest.get(b).clone().slerp(q, 0.28));
    let gripK = -1;
    function setGrip(k) {
      k = Math.max(0, Math.min(1, k));
      if (Math.abs(k - gripK) < 1e-3) return;
      gripK = k;
      for (const [b, q] of wrapped) b.quaternion.copy(open.get(b)).slerp(q, k);
    }
    setGrip(1);

    // ---- the forearm and the shirt sleeve, VR style: skin from the wrist to a sleeve rolled up
    // below the elbow; the sleeve carries on toward the shoulder and fades out before it (no
    // floating upper arm). A terry wristband in the bowler's colour hides the join to the hand.
    const wrist = toLocal(worldOf(bones.wrist || handRoot));
    const dir = wrist.clone().normalize();
    const S = BW.ArmMesh;
    const xs = opts.left ? -1 : 1;                      // thumb side (radius) is +x for a right hand
    const armRoot = new T.Group();
    armRoot.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().negate());   // local +y: wrist -> shoulder
    armRoot.position.copy(wrist);
    group.add(armRoot);

    // skin: warm wrap lighting (subsurface look) shared by the hand and the forearm
    S.skinShading(skinMat, 'hand');
    const foreMat = new T.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.52, metalness: 0,
      normalMap: S.skinDetail(), normalScale: new T.Vector2(0.4, 0.4), roughnessMap: S.skinRough(),
      sheen: 0.3, sheenRoughness: 0.55, sheenColor: new T.Color(0xffb59a), clearcoat: 0.06, clearcoatRoughness: 0.5, envMapIntensity: 0.4 });
    foreMat.normalMap.repeat.set(5, 5); foreMat.roughnessMap.repeat.set(5, 5);
    S.skinShading(foreMat, 'fore');
    const skinGeo = S.tube((s, th) => S.armSection(s, th, xs), -0.022, 0.236, 40, 56, { colors: (s, th) => S.skinTint(s, th, xs, opts.skin) });
    const fore = new T.Mesh(skinGeo, foreMat);
    fore.castShadow = true; fore.receiveShadow = true;
    armRoot.add(fore);

    // the sleeve: knitted jersey in the bowler's colour, a double roll at the cuff, folds, piping
    const tex = opts.cloth ? S.clothTextures(opts.cloth, opts.clothN) : {};
    const SLEEVE_TOP = 0.46, FADE0 = 0.285, FADE1 = 0.44;
    const sleeveMat = new T.MeshPhysicalMaterial({ color: shirtTone(opts.shirt), map: tex.map || null, normalMap: tex.normal || null, normalScale: new T.Vector2(0.9, 0.9),
      roughness: 0.92, metalness: 0, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new T.Color(opts.shirt).lerp(new T.Color(1, 1, 1), 0.08),
      envMapIntensity: 0.35, transparent: true, depthWrite: true });
    if (tex.map) { tex.map.repeat.set(3, 3); tex.normal.repeat.set(3, 3); }
    S.fadeAlong(sleeveMat, FADE0, FADE1, 'sleeve');
    const sleeve = new T.Mesh(S.tube((s, th) => S.sleeveSection(s, th, xs), 0.188, SLEEVE_TOP, 56, 120), sleeveMat);
    sleeve.castShadow = true; sleeve.receiveShadow = true; sleeve.renderOrder = 2;
    armRoot.add(sleeve);
    // contrast piping along the edge of the roll, like a retro bowling shirt
    const pipeMat = new T.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.7, envMapIntensity: 0.3, map: tex.map || null, normalMap: tex.normal || null });
    const pipe = new T.Mesh(S.tube((s, th) => S.pipeSection(s, th, xs), 0.2165, 0.2235, 56, 6), pipeMat);
    pipe.castShadow = true; armRoot.add(pipe);

    // wristband (terry cloth): rounded edges, ribbed
    const bandMat = new T.MeshPhysicalMaterial({ color: shirtTone(opts.shirt), map: tex.band || null, normalMap: tex.bandN || null, normalScale: new T.Vector2(1.2, 1.2),
      roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new T.Color(opts.shirt).lerp(new T.Color(1, 1, 1), 0.12), envMapIntensity: 0.3 });
    if (tex.band) { tex.band.repeat.set(1, 1); }
    const band = new T.Mesh(S.tube((s, th) => S.bandSection(s, th, xs), 0.004, 0.062, 56, 18, { vScale: 0.058 }), bandMat);
    band.castShadow = true; band.receiveShadow = true;
    armRoot.add(band);

    return {
      group, ballAnchor, setGrip, skinMat,
      setShirt(hex) {
        for (const m of [sleeveMat, bandMat]) { m.color.copy(shirtTone(hex)); m.sheenColor.setHex(hex).lerp(new T.Color(1, 1, 1), 0.1); }
      },
    };
  }

  BW.Hand = { build };
})();
