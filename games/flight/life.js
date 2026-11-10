/*
 * GYROWING life: the things that move. Light aircraft flying the circuit at both fields and one
 * cruising around the island, bird flocks, sailboats on the sea and the lake, cars on the roads and
 * in the car park, and the south-cape lighthouse with its beam at night.
 *
 * Models: sailboat (Quaternius, CC0), car (J-Toastie, CC-BY), lighthouse (Poly by Google, CC-BY),
 * all via GLTFLoader once the vendored loaders are ready. Each one has a procedural fallback.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const M = 'assets/models/';
  const CAR_YAW = 0;   // the car model's nose direction relative to -z
  const UP = new THREE.Vector3(0, 1, 0);

  function whenLoaders(cb) {
    if (window.__threeLoadersReady && THREE.GLTFLoader) cb();
    else addEventListener('three-loaders', () => cb(), { once: true });
  }
  /** Load a GLB and flatten it into per-material geometries, scaled so its longest side is `size`
   * metres, base on y = 0, long axis along z. cb(parts | null). */
  function loadModel(file, size, cb, upright) {
    whenLoaders(() => {
      if (!THREE.GLTFLoader) { cb(null); return; }
      new THREE.GLTFLoader().load(M + file, gltf => {
        try {
          const parts = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); parts.push({ g, m: o.material }); } });
          const box = new THREE.Box3(); parts.forEach(p => { p.g.computeBoundingBox(); box.union(p.g.boundingBox); });
          const sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
          const rotY = !upright && sz.x > sz.z ? Math.PI / 2 : 0;
          const k = size / (upright ? sz.y : Math.max(sz.x, sz.z));
          const mtx = new THREE.Matrix4().makeRotationY(rotY).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-ctr.x, -box.min.y, -ctr.z));
          parts.forEach(p => { p.g.applyMatrix4(mtx); p.g.computeBoundingSphere(); if (p.m) { p.m.envMapIntensity = 0.6; } });
          cb(parts);
        } catch (e) { console.warn('[gyrowing] model unusable', file, e); cb(null); }
      }, undefined, () => { console.warn('[gyrowing] model failed, using a stand-in:', file); cb(null); });
    });
  }
  function instanced(scene, parts, n) {
    return parts.map(p => { const im = new THREE.InstancedMesh(p.g, p.m, n); im.frustumCulled = false; im.castShadow = false; scene.add(im); return im; });
  }

  function build(scene, T, W) {
    const L = { };
    const rnd = T.mulberry(4242);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(0, 0, 0, 'YXZ'), s4 = new THREE.Vector3(1, 1, 1), p4 = new THREE.Vector3();
    const AP = T.AIRPORT, BK = T.BROOK;

    // ------------------------------------------------ traffic
    function trafficPlane(scheme) {
      const p = Aircraft.build(scheme, { lights: false });
      const fake = FM.groundState({ x: 0, z: 0, heading: 0, elevation: 0 });
      fake.gear = 0; p.update(Object.assign(fake, { rpm: 0, groundSpeed: 0, agl: 100 }), 0, 0, false);
      const g = new THREE.Group();
      const baked = Aircraft.bake(p); g.add(baked);
      const disc = p.parts.disc; disc.material = disc.material.clone(); disc.material.opacity = 0.35; disc.position.set(0, 0.04, -2.12); g.add(disc);
      const glowL = p.parts.glowL, glowR = p.parts.glowR, strobe = p.parts.strobeL;
      [glowL, glowR, strobe].forEach(x => { x.material = x.material.clone(); g.add(x); });
      scene.add(g);
      return { g, disc, glowL, glowR, strobe };
    }
    const curve = (pts, closed) => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), closed !== false, 'centripetal');
    const E = AP.elev, EB = BK.elev;
    const routes = [
      { scheme: 'red', speed: 46, u: 0.55, c: curve([[900, E + 140, 0], [1700, E + 280, -300], [1700, E + 300, -1300], [0, E + 300, -1450], [-1900, E + 300, -1300], [-2100, E + 230, -200], [-1300, E + 90, 0], [-300, E + 60, 0]]) },
      { scheme: 'green', speed: 55, u: 0.2, c: curve([[-9000, 760, 4000], [-2000, 800, 5600], [6000, 780, 4500], [10500, 820, -500], [8000, 840, -7000], [0, 900, -8200], [-8500, 800, -5000], [-10500, 760, 0]]) },
      { scheme: 'red', speed: 44, u: 0.8, c: curve([[BK.runway.x, EB + 80, -900], [BK.runway.x + 300, EB + 250, -1700], [BK.runway.x + 1300, EB + 290, -1500], [BK.runway.x + 1400, EB + 300, 1400], [BK.runway.x + 300, EB + 220, 2000], [BK.runway.x, EB + 90, 1000]]) },
    ];
    routes.forEach(r => { r.len = r.c.getLength(); r.plane = trafficPlane(r.scheme); r.bank = 0; r.prevHdg = null; });
    L.traffic = routes;

    // ------------------------------------------------ birds
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, -0.6, 0, 0.1, 0, 0, 0.15, 0, 0, -0.25, 0, 0, 0.15, 0.6, 0, 0.1, 0, 0, -0.2, 0, -0.04, 0.35, 0, 0.02, 0.1], 3));
    birdGeo.computeVertexNormals();
    const birdU = { uTime: { value: 0 } };
    const birdMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    birdMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = birdU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat ph = uTime * 7.0 + float(gl_InstanceID) * 1.37;\ntransformed.y += abs(position.x) * sin(ph) * 0.75;');
    };
    birdMat.customProgramCacheKey = () => 'gw-bird';
    const lm = T.landmarks;
    const flocks = [
      { x: lm.lighthouse.x + 200, z: lm.lighthouse.z + 300, y: 60, n: 16, r: 140, size: 1.4, col: '#e9ecef' },     // gulls at the cape
      { x: lm.lake.x - 600, z: lm.lake.z + 500, y: 70, n: 14, r: 120, size: 1.2, col: '#d8dde0' },
      { x: -2600, z: 700, y: E + 90, n: 18, r: 160, size: 0.8, col: '#2a2d30' },                                // starlings over the fields
      { x: lm.summit.x + 600, z: lm.summit.z + 1600, y: lm.summit.y - 200, n: 3, r: 260, size: 2.6, col: '#3b2f26' }, // eagles
      { x: BK.runway.x - 1500, z: 1500, y: EB + 120, n: 12, r: 130, size: 0.8, col: '#2a2d30' },
    ];
    let nb = 0; flocks.forEach(f => { f.start = nb; nb += f.n; f.birds = Array.from({ length: f.n }, () => ({ a: rnd() * 6.28, r: f.r * (0.6 + rnd() * 0.6), dy: (rnd() - 0.5) * 25, w: (0.18 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1) * (f.size > 2 ? 0.4 : 1), ph: rnd() * 6 })); });
    const birds = new THREE.InstancedMesh(birdGeo, birdMat, nb);
    flocks.forEach(f => { for (let i = 0; i < f.n; i++) birds.setColorAt(f.start + i, lin(f.col)); });
    birds.frustumCulled = false; scene.add(birds);
    L.flocks = flocks;

    // ------------------------------------------------ boats
    const boats = [];
    const water = (x, z) => T.heightAt(x, z) < -3;
    const tryRoute = (cx, cz, rMin, rMax) => {
      for (let k = 0; k < 40; k++) {
        const x = cx + (rnd() - 0.5) * 2 * rMax * 2, z = cz + (rnd() - 0.5) * 2 * rMax * 2, r = rMin + rnd() * (rMax - rMin);
        let ok = true; for (let a = 0; a < 6.28; a += 0.4) if (!water(x + Math.cos(a) * (r + 40), z + Math.sin(a) * (r + 40))) { ok = false; break; }
        if (ok) return { x, z, r };
      }
      return null;
    };
    for (let i = 0; i < 9; i++) {
      const lake = i >= 6;
      const c = lake ? tryRoute(lm.lake.x, lm.lake.z, 120, 320) : tryRoute(lm.lighthouse.x + (i - 3) * 1600, lm.lighthouse.z + 1600, 250, 700);
      if (c) boats.push({ c, a: rnd() * 6.28, w: (2.5 + rnd() * 2) / c.r * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6 });
    }
    L.boats = boats;
    const wakeTex = World.canvasTex(32, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(w * 0.4, 0); ctx.lineTo(w * 0.6, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    }, false);
    const wakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }), Math.max(1, boats.length));
    wakes.frustumCulled = false; scene.add(wakes);
    let boatMeshes = null;
    const boatFallback = () => {
      const hull = new THREE.BufferGeometry().copy(new THREE.CylinderGeometry(1.4, 0.9, 1.2, 8, 1).scale(1, 1, 3.6).translate(0, 0.4, 0));
      const sail = new THREE.ConeGeometry(2.2, 9, 3).translate(0, 5.5, 0.6);
      boatMeshes = instanced(scene, [{ g: hull, m: new THREE.MeshLambertMaterial({ color: 0xf2f2ee }) }, { g: sail, m: new THREE.MeshLambertMaterial({ color: 0xffffff }) }], boats.length);
    };
    loadModel('sailboat.glb', 10, parts => { if (parts) boatMeshes = instanced(scene, parts, boats.length); else boatFallback(); });

    // ------------------------------------------------ cars
    const roads = (W.roads || []).filter(r => r.len > 300);
    const cars = [];
    const total = roads.reduce((a, r) => a + r.len, 0);
    for (let i = 0; i < 44 && roads.length; i++) {
      let pick = rnd() * total, r = roads[0];
      for (const rr of roads) { if (pick < rr.len) { r = rr; break; } pick -= rr.len; }
      cars.push({ r, s: rnd() * r.len, dir: rnd() < 0.5 ? 1 : -1, v: 12 + rnd() * 10, col: ['#b0241c', '#e8e8e8', '#20324d', '#3a3d40', '#c9b48a', '#2d5a3c'][(rnd() * 6) | 0] });
    }
    const cp = W.carPark;
    const parked = [];
    if (cp) for (let i = 0; i < 12; i++) parked.push({ x: cp.x0 + 4 + (i % 6) * 13, z: i < 6 ? cp.z0 + 4 : cp.z1 - 4, y: cp.y + 0.05, yaw: i < 6 ? 0 : Math.PI });
    L.cars = cars;
    let carMeshes = null;
    const nCars = cars.length + parked.length;
    const carFallback = () => {
      const body = new THREE.BoxGeometry(1.8, 0.8, 4.2).translate(0, 0.65, 0), cab = new THREE.BoxGeometry(1.6, 0.6, 2.0).translate(0, 1.3, 0.2);
      carMeshes = instanced(scene, [{ g: body, m: new THREE.MeshLambertMaterial({ color: 0xffffff }) }, { g: cab, m: new THREE.MeshLambertMaterial({ color: 0x8899aa }) }], nCars);
      carMeshes[0].instanceColor = null;
      cars.concat(parked).forEach((c, i) => carMeshes[0].setColorAt(i, lin(c.col || '#777777')));
    };
    if (nCars) loadModel('car.glb', 4.4, parts => { if (parts) carMeshes = instanced(scene, parts, nCars); else carFallback(); });
    // head and tail lights (night only)
    const hlPos = new Float32Array(Math.max(1, cars.length) * 2 * 3), hlCol = [], hlSize = [];
    cars.forEach(() => { hlCol.push(1, 0.92, 0.7, 0.9, 0.08, 0.05); hlSize.push(0.9, 0.6); });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hlPos, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(hlCol.length ? hlCol : [0, 0, 0, 0, 0, 0], 3));
    hg.setAttribute('size', new THREE.Float32BufferAttribute(hlSize.length ? hlSize : [0, 0], 1));
    const headlights = new THREE.Points(hg, W.pointsMat({ base: 0 }));
    headlights.frustumCulled = false; scene.add(headlights); W.lightMats.push(headlights.material);

    // ------------------------------------------------ lighthouse
    const lh = lm.lighthouse;
    const lhGroup = new THREE.Group(); lhGroup.position.set(lh.x, lh.y - 0.5, lh.z); scene.add(lhGroup);
    W.addObstacle({ x: lh.x, z: lh.z, y0: lh.y - 1, y1: lh.y + 24, r: 5, kind: 'building' });
    loadModel('lighthouse.glb', 24, parts => {
      if (parts) parts.forEach(p => { const m = new THREE.Mesh(p.g, p.m); m.castShadow = true; lhGroup.add(m); });
      else {
        for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.25, 2.85 - i * 0.25, 3.6, 16), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xb3261e : 0xf4f2ec })); seg.position.y = 1.8 + i * 3.6; lhGroup.add(seg); }
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 12), new THREE.MeshLambertMaterial({ color: 0x223040 })); lamp.position.y = 23; lhGroup.add(lamp);
      }
    }, true);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const beam = new THREE.Group(); beam.position.y = 22.5; lhGroup.add(beam);
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(16, 220, 20, 1, true).translate(0, -110, 0).rotateZ(s * Math.PI / 2), beamMat); beam.add(c); }
    const lampGlow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 22.5, 0], 3)).setAttribute('color', new THREE.Float32BufferAttribute([1, 0.95, 0.8], 3)).setAttribute('size', new THREE.Float32BufferAttribute([3], 1)), W.pointsMat({ base: 0.15 }));
    lampGlow.frustumCulled = false; lhGroup.add(lampGlow); W.lightMats.push(lampGlow.material);

    // ------------------------------------------------ per frame
    const tmpA = new THREE.Vector3(), tmpT = new THREE.Vector3();
    L.update = function (dt, time, night, cam) {
      // traffic
      for (const r of routes) {
        r.u = (r.u + r.speed * dt / r.len) % 1;
        r.c.getPointAt(r.u, tmpA); r.c.getTangentAt(r.u, tmpT);
        const hdg = Math.atan2(tmpT.x, -tmpT.z);
        if (r.prevHdg !== null) {
          let dh = hdg - r.prevHdg; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
          const want = clamp(Math.atan(r.speed * (dh / Math.max(dt, 1e-3)) / 9.81), -0.6, 0.6);
          r.bank += (want - r.bank) * (1 - Math.exp(-dt * 2));
        }
        r.prevHdg = hdg;
        const pitch = Math.asin(clamp(tmpT.y, -1, 1));
        const g = r.plane.g;
        g.position.copy(tmpA);
        e4.set(pitch, -hdg, -r.bank); g.quaternion.setFromEuler(e4);
        r.plane.disc.rotation.z -= dt * 3;
        const vis = 0.25 + 0.75 * night;
        r.plane.glowL.material.opacity = r.plane.glowR.material.opacity = vis;
        r.plane.strobe.material.opacity = ((time + r.u * 7) % 1.25) < 0.06 ? 0.4 + 0.6 * night : 0;
        g.visible = cam.distanceTo(tmpA) < 14000;
      }
      // birds
      birdU.uTime.value = time;
      for (const f of flocks) {
        const near = Math.hypot(cam.x - f.x, cam.z - f.z) < 5000;
        for (let i = 0; i < f.n; i++) {
          const b = f.birds[i];
          b.a += b.w * dt;
          const x = f.x + Math.cos(b.a) * b.r, z = f.z + Math.sin(b.a) * b.r, y = f.y + b.dy + Math.sin(time * 0.4 + b.ph) * 6;
          const sg = Math.sign(b.w), hdg = Math.atan2(Math.sin(b.a) * sg, -Math.cos(b.a) * sg);   // yaw facing the flight direction (models face -z)
          e4.set(0, hdg, -Math.sign(b.w) * 0.35); q4.setFromEuler(e4);
          s4.setScalar(near ? f.size : 0.0001);
          m4.compose(p4.set(x, y, z), q4, s4); birds.setMatrixAt(f.start + i, m4);
        }
      }
      birds.instanceMatrix.needsUpdate = true;
      // boats
      boats.forEach((b, i) => {
        b.a += b.w * dt;
        const x = b.c.x + Math.cos(b.a) * b.c.r, z = b.c.z + Math.sin(b.a) * b.c.r;
        const sg = Math.sign(b.w), hdg = Math.atan2(Math.sin(b.a) * sg, -Math.cos(b.a) * sg);
        e4.set(Math.sin(time * 0.9 + b.ph) * 0.03, hdg, Math.sin(time * 0.7 + b.ph) * 0.06 + (b.w > 0 ? 0.08 : -0.08)); q4.setFromEuler(e4);
        m4.compose(p4.set(x, 0.05, z), q4, s4.set(1, 1, 1));
        if (boatMeshes) boatMeshes.forEach(im => im.setMatrixAt(i, m4));
        e4.set(0, hdg, 0); q4.setFromEuler(e4);
        m4.compose(p4.set(x, 0.12, z), q4, s4.set(4, 1, 26)); wakes.setMatrixAt(i, m4);
      });
      if (boatMeshes) boatMeshes.forEach(im => { im.instanceMatrix.needsUpdate = true; });
      wakes.instanceMatrix.needsUpdate = true;
      // cars
      cars.forEach((c, i) => {
        c.s += c.dir * c.v * dt;
        if (c.s > c.r.len) { c.s = c.r.len; c.dir = -1; } else if (c.s < 0) { c.s = 0; c.dir = 1; }
        const cum = c.r.cum, pts = c.r.pts;
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= c.s) lo = mid; else hi = mid; }
        const a = pts[lo], b = pts[hi], f = (c.s - cum[lo]) / Math.max(1e-3, cum[hi] - cum[lo]);
        let dx = (b.x - a.x) * c.dir, dz = (b.z - a.z) * c.dir; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const x = a.x + (b.x - a.x) * f - dz * 1.8, z = a.z + (b.z - a.z) * f + dx * 1.8, y = a.y + (b.y - a.y) * f - 0.42;
        const yaw = Math.atan2(-dx, -dz) + CAR_YAW;
        q4.setFromAxisAngle(UP, yaw);
        m4.compose(p4.set(x, y, z), q4, s4.set(1, 1, 1));
        if (carMeshes) carMeshes.forEach(im => im.setMatrixAt(i, m4));
        hlPos.set([x + dx * 2.3, y + 0.7, z + dz * 2.3, x - dx * 2.3, y + 0.8, z - dz * 2.3], i * 6);
      });
      if (carMeshes && !L._parkedSet) {
        parked.forEach((c, j) => { q4.setFromAxisAngle(UP, c.yaw); m4.compose(p4.set(c.x, c.y, c.z), q4, s4.set(1, 1, 1)); carMeshes.forEach(im => im.setMatrixAt(cars.length + j, m4)); });
        L._parkedSet = true;
      }
      if (carMeshes) carMeshes.forEach(im => { im.instanceMatrix.needsUpdate = true; });
      hg.attributes.position.needsUpdate = true;
      // lighthouse
      beam.rotation.y = time * 0.9;
      beamMat.opacity = 0.09 * night;
      beam.visible = night > 0.02;
    };
    return L;
  }

  window.Life = { build, loadModel };
})();
