// Ironfern effects (Stage C): muzzle flash, tracers, impact puffs (dirt / foliage / metal / wood /
// stone / water), blood puffs and decals that stick to the animal, ejected shell casings.
// Everything is pooled and allocated in init(); steady-state shots allocate nothing.
//   DH.Fx.impact(point, normal, kind)          DH.Fx.blood(point, dir, scale, attachTo?)
//   DH.Fx.muzzle(worldPos, vmAnchor?, size?)   DH.Fx.tracer(from, to)
//   DH.Fx.shell(vmEjector, weaponId)           (vm* objects live in DH.Weapons.vm.scene)
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const T = THREE;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------------ textures (canvas, made once)
  function canvasTex(size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }
  function puffTex() {
    return canvasTex(128, (g, s) => {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * 6.28, r = Math.random() * s * 0.2, x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
        const rad = s * rnd(0.12, 0.3);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
    });
  }
  function softTex() {
    return canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,210,0.8)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
  }
  function chipTex() {
    return canvasTex(32, (g, s) => {
      g.fillStyle = '#fff'; g.beginPath();
      const n = 7;
      for (let i = 0; i < n; i++) { const a = i / n * 6.28, r = s * rnd(0.22, 0.45); g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); }
      g.closePath(); g.fill();
    });
  }
  function flashTex() {
    return canvasTex(128, (g, s) => {
      const c = s / 2;
      g.translate(c, c);
      for (let i = 0; i < 9; i++) { // jagged petals
        g.rotate(6.28 / 9 + rnd(-0.15, 0.15));
        const len = c * rnd(0.55, 0.98), w = c * rnd(0.07, 0.14);
        const gr = g.createLinearGradient(0, 0, len, 0);
        gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.5, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.42);
      gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.5, 'rgba(255,215,140,0.85)'); gr.addColorStop(1, 'rgba(255,150,50,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
  }
  function bloodTex() {
    return canvasTex(128, (g, s) => {
      const c = s / 2;
      g.fillStyle = 'rgba(255,255,255,0.95)';
      const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill(); };
      blob(c, c, s * 0.2);
      for (let i = 0; i < 9; i++) blob(c + rnd(-0.16, 0.16) * s, c + rnd(-0.16, 0.16) * s, s * rnd(0.06, 0.13));
      for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28, r = s * rnd(0.22, 0.46); blob(c + Math.cos(a) * r, c + Math.sin(a) * r, s * rnd(0.01, 0.035)); }
    });
  }

  // ------------------------------------------------------------------ state
  let ctx = null, ready = false;
  const TEX = {};
  const N_PART = 260, N_TRACER = 12, N_SHELL = 18, N_DECAL = 56;
  const parts = [], tracers = [], shells = [], decals = [];
  let pi = 0, ti = 0, si = 0, di = 0;
  let worldLight = null, worldLightT = 0;
  let vmFlash = null, vmLight = null, vmFlashT = 0, vmFlashDur = 0.055, vmAnchor = null, vmFlashSize = 0.16;
  const _v = new T.Vector3(), _q = new T.Quaternion(), _z = new T.Vector3(0, 0, 1), _w = new T.Vector3();
  const GRAV = -9.8;
  const TUNE = { flash: 0.055 }; // seconds the muzzle flash stays up (tests stretch it to photograph it)

  function makeParticle() {
    const mat = new T.SpriteMaterial({ map: TEX.puff, transparent: true, depthWrite: false, fog: true });
    const sp = new T.Sprite(mat); sp.visible = false; sp.frustumCulled = false;
    sp.renderOrder = 5;
    return { sp, mat, vel: new T.Vector3(), age: 0, life: 1, s0: 1, s1: 1, op: 1, grav: 0, drag: 0, spin: 0, live: false };
  }

  function spawn(pos, tex, color, o) {
    const p = parts[pi]; pi = (pi + 1) % N_PART;
    p.live = true; p.age = 0; p.life = o.life;
    p.sp.position.copy(pos);
    p.vel.copy(o.vel);
    p.s0 = o.s0; p.s1 = o.s1 == null ? o.s0 : o.s1; p.op = o.op == null ? 1 : o.op;
    p.grav = o.grav || 0; p.drag = o.drag || 0; p.spin = o.spin || 0;
    if (p.mat.map !== tex) p.mat.map = tex;
    p.mat.color.setRGB(color[0], color[1], color[2]);
    p.mat.blending = o.add ? T.AdditiveBlending : T.NormalBlending;
    p.mat.rotation = Math.random() * 6.28;
    p.mat.opacity = p.op;
    p.sp.scale.setScalar(p.s0);
    p.sp.visible = true;
    return p;
  }

  // random direction in the hemisphere around n, biased toward it by `tight` (0 = wide, 1 = along n)
  const _d = new T.Vector3();
  function hemi(n, tight, speed) {
    _d.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    if (_d.dot(n) < 0) _d.negate();
    _d.lerp(n, tight).normalize().multiplyScalar(speed);
    return _d;
  }

  const KINDS = {
    dirt: { puff: [0.42, 0.35, 0.26], chip: [0.18, 0.14, 0.1], puffs: 5, chips: 7 },
    foliage: { puff: [0.38, 0.4, 0.27], chip: [0.2, 0.36, 0.12], puffs: 3, chips: 10, leaf: true },
    wood: { puff: [0.5, 0.43, 0.33], chip: [0.62, 0.5, 0.33], puffs: 3, chips: 9, splinter: true },
    metal: { puff: [0.45, 0.45, 0.45], chip: [0.3, 0.3, 0.3], puffs: 2, chips: 0, sparks: 12 },
    stone: { puff: [0.55, 0.54, 0.5], chip: [0.35, 0.34, 0.32], puffs: 4, chips: 6, sparks: 3 },
    water: { puff: [0.75, 0.8, 0.82], chip: [0.7, 0.78, 0.85], puffs: 4, chips: 8, splash: true },
  };

  function distScale(point) { return ctx ? 1 + Math.max(0, ctx.camera.position.distanceTo(point) - 20) * 0.012 : 1; }

  function impact(point, normal, kind) {
    if (!ready || !point) return;
    const k = KINDS[kind] || KINDS.dirt;
    const n = normal ? _w.copy(normal).normalize() : _w.set(0, 1, 0);
    const s = distScale(point);
    for (let i = 0; i < k.puffs; i++) {
      _v.copy(point).addScaledVector(n, 0.05 * s);
      const p = spawn(_v, TEX.puff, k.puff, { vel: hemi(n, 0.55, rnd(0.6, 2.2) * (k.splash ? 2 : 1)), life: rnd(0.7, 1.4), s0: 0.18 * s, s1: rnd(0.9, 1.6) * s, op: 0.55, drag: 2.5, grav: k.splash ? -3 : 0.25 });
      p.mat.rotation = Math.random() * 6.28;
    }
    for (let i = 0; i < k.chips; i++) {
      const sp = k.leaf ? rnd(1.2, 3) : rnd(2.5, 6);
      spawn(point, TEX.chip, k.chip, { vel: hemi(n, k.leaf ? 0.3 : 0.45, sp), life: k.leaf ? rnd(1, 1.8) : rnd(0.5, 0.9), s0: (k.splinter ? rnd(0.03, 0.06) : rnd(0.02, 0.05)) * s, op: 1, grav: k.leaf ? -1.2 : GRAV, drag: k.leaf ? 2.2 : 0.4, spin: rnd(-12, 12) });
    }
    for (let i = 0; i < (k.sparks || 0); i++) {
      spawn(point, TEX.soft, [1, 0.72, 0.35], { vel: hemi(n, 0.35, rnd(4, 11)), life: rnd(0.12, 0.3), s0: 0.05 * s, s1: 0.015 * s, op: 1, add: true, grav: GRAV, drag: 1 });
    }
    if (k.sparks) { worldFlash(point, 6 * s, 0.05); }
  }

  function blood(point, dir, scale, attachTo) {
    if (!ready || !point) return;
    scale = scale || 1;
    const s = distScale(point) * scale;
    const back = _w.copy(dir || _z).normalize().negate(); // toward the shooter
    for (let i = 0; i < 5; i++) {
      _v.copy(back).multiplyScalar(i < 2 ? rnd(0.4, 1.2) : -rnd(0.5, 2)); // a little back at you, most carries through
      _v.x += rnd(-0.6, 0.6); _v.y += rnd(-0.2, 0.8); _v.z += rnd(-0.6, 0.6);
      spawn(point, TEX.puff, [0.42, 0.03, 0.03], { vel: _v, life: rnd(0.6, 1.0), s0: 0.2 * s, s1: rnd(0.7, 1.2) * s, op: 0.95, drag: 3, grav: -1.5 });
    }
    for (let i = 0; i < 8; i++) {
      spawn(point, TEX.chip, [0.25, 0.01, 0.01], { vel: hemi(back, 0.1, rnd(1.5, 4.5)), life: rnd(0.4, 0.8), s0: rnd(0.02, 0.045) * s, op: 1, grav: GRAV, drag: 0.5 });
    }
    if (attachTo) decal(point, back, 0.22 * scale * (0.8 + Math.random() * 0.5), attachTo);
  }

  // A blood decal at point facing n, parented to the bone of attachTo nearest the hit (so it rides the animation)
  const _bp = new T.Vector3();
  function decal(point, n, size, attachTo) {
    const d = decals[di]; di = (di + 1) % N_DECAL;
    if (d.parent) d.parent.remove(d);
    let target = attachTo, best = Infinity;
    attachTo.traverse(o => { if (o.isBone) { o.getWorldPosition(_bp); const dd = _bp.distanceToSquared(point); if (dd < best) { best = dd; target = o; } } });
    d.position.copy(point).addScaledVector(n, 0.015);
    d.quaternion.setFromUnitVectors(_z, n);
    _q.setFromAxisAngle(_z, Math.random() * 6.28); d.quaternion.multiply(_q);
    d.scale.setScalar(size);
    d.visible = true;
    ctx.scene.add(d); d.updateMatrixWorld(true);
    target.updateWorldMatrix(true, false);
    target.attach(d);
  }

  function worldFlash(pos, intensity, t) {
    if (!worldLight) return;
    worldLight.position.copy(pos); worldLight.intensity = intensity; worldLightT = t;
    worldLight.userData.i0 = intensity; worldLight.userData.t0 = t;
  }

  function muzzle(worldPos, anchor, size) {
    if (!ready) return;
    if (worldPos) worldFlash(worldPos, 60, 0.06);
    if (anchor && vmFlash) {
      vmAnchor = anchor; vmFlashT = vmFlashDur = TUNE.flash; vmFlashSize = size || 0.16;
      vmFlash.material.rotation = Math.random() * 6.28;
      vmFlash.visible = true;
      placeVmFlash(1);
    }
  }
  function placeVmFlash(k) {
    if (!vmAnchor) return;
    vmAnchor.getWorldPosition(_v); // the vm scene root is untransformed
    vmFlash.position.copy(_v);
    vmFlash.scale.setScalar(vmFlashSize * (0.75 + 0.5 * Math.random()) * (0.6 + 0.4 * k));
    vmFlash.material.opacity = k;
    vmLight.position.copy(_v);
    vmLight.intensity = 1.2 * k;
  }

  const _a = new T.Vector3(), _b = new T.Vector3();
  function tracer(from, to) {
    if (!ready || !from || !to) return;
    const tr = tracers[ti]; ti = (ti + 1) % N_TRACER;
    tr.from.copy(from); tr.dir.copy(to).sub(from);
    tr.len = tr.dir.length(); if (tr.len < 3) return;
    tr.dir.divideScalar(tr.len);
    tr.head = 1.5; tr.live = true; tr.mesh.visible = true;
    placeTracer(tr);
  }
  function placeTracer(tr) {
    const head = Math.min(tr.head, tr.len), tail = Math.max(0, head - 9);
    _a.copy(tr.from).addScaledVector(tr.dir, tail);
    _b.copy(tr.from).addScaledVector(tr.dir, head);
    tr.mesh.position.copy(_a); tr.mesh.lookAt(_b);
    const l = Math.max(0.01, head - tail), w = 0.012 + tail * 0.0006;
    tr.mesh.scale.set(w, w, l);
  }

  function shell(ejector, weaponId) {
    if (!ready || !ejector || !vmScene()) return;
    const s = shells[si]; si = (si + 1) % N_SHELL;
    ejector.getWorldPosition(s.mesh.position);
    const small = weaponId === 'sidearm';
    s.mesh.scale.setScalar(small ? 0.7 : 1);
    s.vel.set(rnd(1.3, 2.0), rnd(1.4, 2.2), rnd(0.1, 0.6));
    s.spin.set(rnd(-25, 25), rnd(-10, 10), rnd(-30, 30));
    s.mesh.rotation.set(0, 0, Math.PI / 2);
    s.age = 0; s.live = true; s.tink = false; s.mesh.visible = true;
    s.tinkAt = rnd(0.45, 0.65);
  }
  function vmScene() { return DH.Weapons && DH.Weapons.vm && DH.Weapons.vm.scene; }

  function attachVm() {
    const sc = vmScene();
    if (!sc || vmFlash) return;
    vmFlash = new T.Sprite(new T.SpriteMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0xfff0d8 }));
    vmFlash.visible = false; vmFlash.renderOrder = 10;
    sc.add(vmFlash);
    vmLight = new T.PointLight(0xffb066, 0, 2.5, 2);
    sc.add(vmLight);
    const geo = new T.CylinderGeometry(0.0045, 0.0045, 0.028, 10);
    const mat = new T.MeshStandardMaterial({ color: 0xc9a14e, metalness: 1, roughness: 0.28 });
    for (let i = 0; i < N_SHELL; i++) {
      const m = new T.Mesh(geo, mat); m.visible = false; m.frustumCulled = false; sc.add(m);
      shells.push({ mesh: m, vel: new T.Vector3(), spin: new T.Vector3(), age: 0, live: false, tink: false, tinkAt: 0.5 });
    }
  }

  // ------------------------------------------------------------------ api
  DH.Fx = {
    init(c) {
      ctx = c;
      TEX.puff = puffTex(); TEX.soft = softTex(); TEX.chip = chipTex(); TEX.flash = flashTex(); TEX.blood = bloodTex();
      for (let i = 0; i < N_PART; i++) { const p = makeParticle(); parts.push(p); c.scene.add(p.sp); }
      const tgeo = new T.BoxGeometry(1, 1, 1); tgeo.translate(0, 0, 0.5);
      const tmat = new T.MeshBasicMaterial({ color: 0xffd7a0, transparent: true, opacity: 0.32, blending: T.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < N_TRACER; i++) {
        const m = new T.Mesh(tgeo, tmat); m.visible = false; m.frustumCulled = false; c.scene.add(m);
        tracers.push({ mesh: m, from: new T.Vector3(), dir: new T.Vector3(), len: 0, head: 0, live: false });
      }
      const dgeo = new T.PlaneGeometry(1, 1);
      const dmat = new T.MeshStandardMaterial({ map: TEX.blood, color: 0x5a0606, transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4 });
      for (let i = 0; i < N_DECAL; i++) { const m = new T.Mesh(dgeo, dmat); m.visible = false; m.renderOrder = 2; decals.push(m); }
      worldLight = new T.PointLight(0xffb066, 0, 30, 2);
      c.scene.add(worldLight);
      ready = true;
      DH.bus.on('assets:ready', attachVm);
      attachVm();
    },
    reset(c) {
      ctx = c || ctx;
      parts.forEach(p => { p.live = false; p.sp.visible = false; if (!p.sp.parent) ctx.scene.add(p.sp); });
      tracers.forEach(t => { t.live = false; t.mesh.visible = false; if (!t.mesh.parent) ctx.scene.add(t.mesh); });
      shells.forEach(s => { s.live = false; s.mesh.visible = false; });
      decals.forEach(d => { if (d.parent) d.parent.remove(d); d.visible = false; });
      if (worldLight && !worldLight.parent) ctx.scene.add(worldLight);
      if (worldLight) worldLight.intensity = 0;
    },
    update(dt, c) {
      if (!ready) return;
      for (let i = 0; i < N_PART; i++) {
        const p = parts[i]; if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) { p.live = false; p.sp.visible = false; continue; }
        const k = p.age / p.life;
        p.vel.y += p.grav * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.sp.position.addScaledVector(p.vel, dt);
        p.sp.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k)));
        p.mat.opacity = p.op * (1 - k) * (1 - k * 0.3);
        if (p.spin) p.mat.rotation += p.spin * dt;
      }
      for (let i = 0; i < N_TRACER; i++) {
        const t = tracers[i]; if (!t.live) continue;
        t.head += 420 * dt;
        if (t.head - 9 >= t.len) { t.live = false; t.mesh.visible = false; continue; }
        placeTracer(t);
      }
      for (let i = 0; i < shells.length; i++) {
        const s = shells[i]; if (!s.live) continue;
        s.age += dt;
        s.vel.y += GRAV * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt; s.mesh.rotation.z += s.spin.z * dt;
        if (!s.tink && s.age > s.tinkAt) {
          s.tink = true;
          if (DH.Audio && DH.Audio.play) DH.Audio.play('sfx_shell_' + (1 + Math.floor(Math.random() * 3)), { volume: 0.16, rate: rnd(0.9, 1.15), maxVoices: 4 });
        }
        if (s.age > 0.9) { s.live = false; s.mesh.visible = false; }
      }
      if (worldLight && worldLightT > 0) {
        worldLightT -= dt;
        worldLight.intensity = worldLightT > 0 ? worldLight.userData.i0 * worldLightT / worldLight.userData.t0 : 0;
      }
      if (vmFlash && vmFlashT > 0) {
        vmFlashT -= dt;
        if (vmFlashT <= 0) { vmFlash.visible = false; vmLight.intensity = 0; } else placeVmFlash(vmFlashT / vmFlashDur);
      }
    },
    impact, blood, muzzle, tracer, shell, tune: TUNE,
  };
})();
