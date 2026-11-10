/*
 * Sunvolley — athletes, rackets, ball visuals and effects.
 */
(function () {
  'use strict';
  const TN = window.TN = window.TN || {};

  // ---------------------------------------------------------------------------------
  function makeRacket(frameColor, gripColor) {
    const g = new THREE.Group();
    const fm = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.35, metalness: 0.3 });
    const gm = new THREE.MeshStandardMaterial({ color: gripColor, roughness: 0.8 });
    // handle along -Z
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.2, 8), gm);
    grip.rotation.x = Math.PI / 2; grip.position.z = -0.06; g.add(grip);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 8), fm);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.22; g.add(shaft);
    // throat V
    [-1, 1].forEach(s => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.13), fm);
      arm.position.set(s * 0.04, 0, -0.32); arm.rotation.y = s * 0.38; g.add(arm);
    });
    // head
    const head = new THREE.Mesh(new THREE.TorusGeometry(1, 0.085, 6, 32), fm);
    head.rotation.x = Math.PI / 2;
    head.scale.set(0.125, 0.16, 0.125 * 1.2);
    head.position.z = -0.53;
    g.add(head);
    // strings
    const st = TN.canvasTex(128, 160, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(245,245,235,0.9)'; c.lineWidth = 2;
      for (let x = 6; x < w; x += 9) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      for (let y = 6; y < h; y += 9) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    });
    const strings = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ map: st, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    strings.rotation.x = -Math.PI / 2;
    strings.scale.set(0.118, 0.152, 1);
    strings.position.z = -0.53;
    g.add(strings);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    strings.castShadow = false;
    g.userData.headOffset = new THREE.Vector3(0, 0, -0.53);
    return g;
  }
  TN.makeRacket = makeRacket;

  // ---------------------------------------------------------------------------------
  /**
   * Stylised athlete. Root sits on the floor, faces -Z when rotation.y = 0.
   * The racket arm is driven separately in world space.
   */
  function makeAthlete(o) {
    const root = new THREE.Group();
    const std = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r == null ? 0.65 : r });
    const shirt = std(o.shirt), shorts = std(o.shorts), skin = std(o.skin, 0.7), shoe = std(0xf5f5f5, 0.5), sock = std(0xffffff);
    const accent = std(o.accent, 0.5);

    const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
    const legs = [];
    [-1, 1].forEach(s => {
      const hip = new THREE.Group(); hip.position.set(s * 0.1, 0, 0); hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 3, 8), skin);
      thigh.position.y = -0.24; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 3, 8), skin);
      shin.position.y = -0.2; knee.add(shin);
      const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), sock);
      sk.position.y = -0.33; knee.add(sk);
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), shoe);
      sh.position.set(0, -0.42, -0.05); knee.add(sh);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.025, 0.27), accent);
      sole.position.set(0, -0.465, -0.05); knee.add(sole);
      legs.push({ hip, knee });
    });
    const shortsM = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.26, 12), shorts);
    shortsM.position.y = 0.0; hips.add(shortsM);

    const torso = new THREE.Group(); torso.position.y = 0.1; hips.add(torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.32, 4, 12), shirt);
    chest.scale.set(1.05, 1, 0.72); chest.position.y = 0.3; torso.add(chest);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.06, 14, 1, true), accent);
    stripe.scale.set(1.05, 1, 0.74); stripe.position.y = 0.38; torso.add(stripe);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin);
    neck.position.y = 0.62; torso.add(neck);
    const head = new THREE.Group(); head.position.y = 0.76; torso.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skin);
    skull.scale.set(1, 1.08, 1); head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.147, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), std(o.hair, 0.9));
    hair.position.y = 0.012; hair.rotation.x = 0.25; head.add(hair);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.022, 6, 20), accent);
    band.rotation.x = Math.PI / 2 + 0.15; band.position.y = 0.04; head.add(band);
    // simple face: two dark eyes on the front (-Z)
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x1a1a22 });
    [-1, 1].forEach(s => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeM);
      e.position.set(s * 0.05, 0.0, -0.13); head.add(e);
    });

    // left (free) arm, local to torso
    const lShoulder = new THREE.Group(); lShoulder.position.set(-0.25, 0.46, 0); torso.add(lShoulder);
    const lUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 3, 8), shirt);
    lUpper.position.y = -0.14; lShoulder.add(lUpper);
    const lElbow = new THREE.Group(); lElbow.position.y = -0.3; lShoulder.add(lElbow);
    const lFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 3, 8), skin);
    lFore.position.y = -0.14; lElbow.add(lFore);

    // racket arm: two world-space segments (upper + fore), positioned each frame
    const rUpper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1, 3, 8), shirt);
    const rFore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1, 3, 8), skin);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
    const racket = makeRacket(o.racket, o.grip);

    root.scale.setScalar(1.12);
    racket.scale.setScalar(1.08);
    root.traverse(m => { if (m.isMesh) m.castShadow = true; });
    [rUpper, rFore, hand].forEach(m => { m.castShadow = true; });

    return {
      root, hips, torso, head, legs, lShoulder, lElbow, rUpper, rFore, hand, racket,
      addTo(scene) { scene.add(root, rUpper, rFore, hand, racket); },
      setVisible(v) { [root, rUpper, rFore, hand, racket].forEach(x => { x.visible = v; }); },
    };
  }
  TN.makeAthlete = makeAthlete;

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  /** Place a unit-length capsule (length 1 along Y) between points a and b. */
  function limb(mesh, a, b, radiusScale) {
    _a.subVectors(b, a);
    const len = _a.length();
    mesh.position.copy(a).addScaledVector(_a, 0.5);
    mesh.quaternion.setFromUnitVectors(_up, _a.normalize());
    mesh.scale.set(radiusScale || 1, Math.max(0.01, (len - 0.1) / 1.0), radiusScale || 1);
  }
  TN.limb = limb;

  /**
   * Pose an athlete. `st` = { x, z, facing, run (0..1), phase, lean, twist, racketQuat, crouch }.
   * The racket quaternion is world space; the arm is solved to reach it.
   */
  const _sh = new THREE.Vector3(), _hand = new THREE.Vector3(), _fwd = new THREE.Vector3(), _el = new THREE.Vector3();
  const _side = new THREE.Vector3(), _tmp = new THREE.Vector3();
  function poseAthlete(A, st) {
    A.root.position.set(st.x, 0, st.z);
    A.root.rotation.y = st.facing;
    const run = st.run, ph = st.phase;
    const bob = Math.abs(Math.sin(ph)) * 0.06 * run;
    A.hips.position.y = 0.92 - (st.crouch || 0) * 0.12 + bob;
    A.legs[0].hip.rotation.x = Math.sin(ph) * 0.8 * run + (st.crouch || 0) * -0.4;
    A.legs[1].hip.rotation.x = -Math.sin(ph) * 0.8 * run + (st.crouch || 0) * -0.4;
    A.legs[0].knee.rotation.x = Math.max(0, -Math.sin(ph)) * 1.1 * run + (st.crouch || 0) * 0.7;
    A.legs[1].knee.rotation.x = Math.max(0, Math.sin(ph)) * 1.1 * run + (st.crouch || 0) * 0.7;
    // stance: legs a little apart sideways
    A.legs[0].hip.rotation.z = 0.06; A.legs[1].hip.rotation.z = -0.06;
    A.torso.rotation.set(-(st.lean || 0) - 0.1 * run, st.twist || 0, 0);
    A.lShoulder.rotation.x = -Math.sin(ph) * 0.7 * run + 0.15;
    A.lShoulder.rotation.z = -0.25 - (st.twist || 0) * 0.3;
    A.lElbow.rotation.x = -0.6 - 0.4 * run;
    A.head.rotation.y = -(st.twist || 0) * 0.6;

    A.root.updateMatrixWorld(true);
    // racket arm
    _sh.set(st.hand === 'left' ? -0.25 : 0.25, 0.46, 0); A.torso.localToWorld(_sh);   // racket shoulder: the playing hand's side
    if (st.arm) {
      // arm driven by the player's real arm (elbow + hand in world space): draw it 1:1
      limb(A.rUpper, _sh, st.arm.elbow);
      limb(A.rFore, st.arm.elbow, st.arm.hand);
      A.hand.position.copy(st.arm.hand);
      A.racket.position.copy(st.arm.hand);
      A.racket.quaternion.copy(st.racketQuat);
      return;
    }
    const armK = A.root.scale.x;
    _fwd.set(0, 0, -1).applyQuaternion(st.racketQuat);
    // the hand sits forward-down of the shoulder, biased toward where the racket points
    _hand.copy(_fwd).multiplyScalar(0.42);
    _hand.y -= 0.22;
    _side.set(0.12, 0, 0).applyAxisAngle(_up, st.facing);
    _hand.add(_side);
    _hand.setLength(0.56 * armK).add(_sh);
    // elbow: midway, pushed down and out
    _el.addVectors(_sh, _hand).multiplyScalar(0.5);
    _tmp.set(0.08, -0.1, 0.06).applyAxisAngle(_up, st.facing);
    _el.add(_tmp);
    limb(A.rUpper, _sh, _el);
    limb(A.rFore, _el, _hand);
    A.hand.position.copy(_hand);
    A.racket.position.copy(_hand);
    A.racket.quaternion.copy(st.racketQuat);
  }
  TN.poseAthlete = poseAthlete;

  // ---------------------------------------------------------------------------------
  function glowTex(inner, outer) {
    return TN.canvasTex(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
  }

  /** Ball, blob shadow, trail, impact + bounce effects. */
  function makeBallFX(scene) {
    const VIS_R = 0.085;
    const ballTex = TN.canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#e6f23a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 7;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.22;
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(VIS_R, 20, 14),
      new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.75, emissive: 0x3a4a00, emissiveIntensity: 0.6 }));
    ball.castShadow = false;
    scene.add(ball);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(240,255,120,0.9)', 'rgba(220,255,80,0.25)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.set(0.5, 0.5, 1);
    scene.add(halo);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({
      map: glowTex('rgba(0,0,0,0.75)', 'rgba(0,0,0,0.35)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    // trail: camera-facing ribbon, additive, colour fades out to black
    const TN_ = 15;
    const trailPts = [];
    const tPos = new Float32Array(TN_ * 2 * 3), tCol = new Float32Array(TN_ * 2 * 3);
    const tIdx = [];
    for (let i = 0; i < TN_ - 1; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    tGeo.setIndex(tIdx);
    const trail = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    trail.frustumCulled = false;
    scene.add(trail);
    let trailColor = new THREE.Color(0xdfff6a);

    // impact sprites pool
    const sparkTex = glowTex('rgba(255,255,255,1)', 'rgba(255,230,140,0.5)');
    const pool = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.visible = false; scene.add(s);
      pool.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 0, size: 1 });
    }
    function spawn(x, y, z, o) {
      const p = pool.find(q => q.life <= 0) || pool[0];
      p.s.position.set(x, y, z);
      p.life = p.max = o.life;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
      p.size = o.size; p.grow = o.grow || 0;
      p.s.material.color.set(o.color || 0xffffff);
      p.s.material.opacity = 1;
      p.s.visible = true;
    }

    // bounce marks (flat rings)
    const ringGeo = new THREE.RingGeometry(0.7, 1, 32);
    const marks = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
      marks.push({ m, life: 0, max: 1, size: 0.2 });
    }
    let markI = 0;

    const fx = {
      ball, VIS_R,
      setTrailColor(c) { trailColor.set(c); },
      resetTrail() { trailPts.length = 0; },
      impact(x, y, z, power, color) {
        spawn(x, y, z, { life: 0.22, size: 0.4 + power * 0.9, grow: 5 + power * 6, color: color || 0xfff2b0 });
        const n = 3 + Math.round(power * 6);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4 * (0.5 + power);
          spawn(x, y, z, { life: 0.25 + Math.random() * 0.2, size: 0.12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, vz: (Math.random() - 0.5) * sp, color: 0xffe08a });
        }
      },
      bounce(x, z, speed, out) {
        spawn(x, 0.08, z, { life: 0.4, size: 0.25, grow: 1.6, vy: 0.4, color: out ? 0xff7766 : 0xd8e6ff });
        const mk = marks[markI++ % marks.length];
        mk.m.position.set(x, 0.004, z);
        mk.m.material.color.set(out ? 0xff4d4d : 0xffffff);
        mk.life = mk.max = out ? 2.6 : 1.1;
        mk.size = out ? 0.28 : 0.16;
        mk.m.visible = true;
      },
      update(dt, cam, bp, visible) {
        ball.visible = halo.visible = shadow.visible = trail.visible = visible;
        ball.position.set(bp.x, bp.y + (VIS_R - TN.COURT.R), bp.z);
        ball.rotation.x += dt * 20; ball.rotation.y += dt * 7;
        halo.position.copy(ball.position);
        const dist = cam.position.distanceTo(ball.position);
        const hs = 0.2 + dist * 0.016;
        halo.scale.set(hs, hs, 1);
        // shadow: wider + fainter with height
        const h = Math.max(0, bp.y);
        const s = 0.09 + h * 0.03;
        shadow.scale.set(s, s, 1);
        shadow.material.opacity = Math.max(0.15, 0.85 - h * 0.12);
        shadow.position.set(bp.x, 0.003, bp.z);
        // trail
        if (visible) {
          trailPts.unshift(ball.position.clone());
          if (trailPts.length > TN_) trailPts.pop();
        }
        const n = trailPts.length;
        for (let i = 0; i < TN_; i++) {
          const p = trailPts[Math.min(i, n - 1)] || ball.position;
          const q = trailPts[Math.min(i + 1, n - 1)] || p;
          _a.subVectors(p, q); if (_a.lengthSq() < 1e-8) _a.set(0, 0, 1);
          _b.subVectors(cam.position, p);
          _a.cross(_b).normalize();
          const w = VIS_R * 0.65 * (1 - i / TN_);
          tPos[i * 6] = p.x + _a.x * w; tPos[i * 6 + 1] = p.y + _a.y * w; tPos[i * 6 + 2] = p.z + _a.z * w;
          tPos[i * 6 + 3] = p.x - _a.x * w; tPos[i * 6 + 4] = p.y - _a.y * w; tPos[i * 6 + 5] = p.z - _a.z * w;
          const k = i < n ? Math.pow(1 - i / TN_, 1.8) * 0.5 : 0;
          for (let j = 0; j < 2; j++) {
            tCol[i * 6 + j * 3] = trailColor.r * k; tCol[i * 6 + j * 3 + 1] = trailColor.g * k; tCol[i * 6 + j * 3 + 2] = trailColor.b * k;
          }
        }
        tGeo.attributes.position.needsUpdate = true;
        tGeo.attributes.color.needsUpdate = true;
        // sprites
        pool.forEach(p => {
          if (p.life <= 0) return;
          p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; return; }
          const k = p.life / p.max;
          p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
          p.vy -= 6 * dt;
          const sz = p.size * (1 + p.grow * (1 - k));
          p.s.scale.set(sz, sz, 1);
          p.s.material.opacity = k;
        });
        marks.forEach(mk => {
          if (mk.life <= 0) return;
          mk.life -= dt;
          if (mk.life <= 0) { mk.m.visible = false; return; }
          const k = mk.life / mk.max;
          const sz = mk.size * (1 + (1 - k) * 0.6);
          mk.m.scale.set(sz, sz, 1);
          mk.m.material.opacity = Math.min(1, k * 1.5);
        });
      },
    };
    return fx;
  }
  TN.makeBallFX = makeBallFX;

  /** A small ball machine for practice mode. */
  TN.makeBallMachine = function () {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5 }));
    body.position.y = 0.45; g.add(body);
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.25, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0xff5d73, roughness: 0.4 }));
    hopper.position.y = 0.95; g.add(hopper);
    const balls = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9ec3a }));
    balls.position.y = 1.0; balls.scale.y = 0.3; g.add(balls);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    barrel.rotation.x = Math.PI / 2 - 0.3; barrel.position.set(0, 0.7, 0.4); g.add(barrel);
    [-1, 1].forEach(s => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 0.38, 0.15, -0.2); g.add(wheel);
    });
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  };
})();
