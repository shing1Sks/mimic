/*
 * Duskwater - visual effects (tracers, sparks, dust, instanced bullet marks, muzzle flashes) and
 * the first-person weapon view: glTF arms + gun rigs with their own animation, rendered in their
 * own scene on top of the world so they never clip into walls. buildGun() is the procedural
 * fallback when a rig did not load.
 */
(function (global) {
  'use strict';
  const T = global.THREE;
  const W = () => global.ArenaWorld;

  function starTex() {
    return W().canvasTex(64, (g, s) => {
      g.translate(s / 2, s / 2);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.2, 'rgba(255,200,110,0.9)'); gr.addColorStop(0.55, 'rgba(255,120,40,0.25)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr;
      g.beginPath();
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = i % 2 ? s * 0.16 : s * 0.5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill();
    }, false);
  }
  function dotTex() {
    return W().canvasTex(32, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, false);
  }
  function holeTex() {
    return W().canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(10,8,8,1)'); gr.addColorStop(0.22, 'rgba(20,18,16,0.95)'); gr.addColorStop(0.35, 'rgba(60,55,50,0.6)'); gr.addColorStop(1, 'rgba(60,55,50,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, false);
  }

  class Particles {
    constructor(scene, n, size, blending, opacity) {
      this.n = n; this.i = 0;
      this.p = new Float32Array(n * 3).fill(-999); this.c = new Float32Array(n * 3);
      this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.p, 3));
      g.setAttribute('color', new T.BufferAttribute(this.c, 3));
      this.geo = g;
      this.points = new T.Points(g, new T.PointsMaterial({ size, map: dotTex(), vertexColors: true, transparent: true, opacity, depthWrite: false, blending, sizeAttenuation: true }));
      this.points.frustumCulled = false;
      scene.add(this.points);
    }
    emit(x, y, z, vx, vy, vz, r, gC, b, life, grav = 9, drag = 1) {
      const k = this.i; this.i = (this.i + 1) % this.n;
      this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
      this.v[k * 3] = vx; this.v[k * 3 + 1] = vy; this.v[k * 3 + 2] = vz;
      this.c[k * 3] = r; this.c[k * 3 + 1] = gC; this.c[k * 3 + 2] = b;
      this.life[k] = life; this.grav[k] = grav; this.drag[k] = drag;
    }
    update(dt) {
      let any = false;
      for (let k = 0; k < this.n; k++) {
        if (this.life[k] <= 0) continue;
        any = true;
        this.life[k] -= dt;
        if (this.life[k] <= 0) { this.p[k * 3 + 1] = -999; continue; }
        const dr = Math.exp(-this.drag[k] * dt);
        this.v[k * 3] *= dr; this.v[k * 3 + 1] = this.v[k * 3 + 1] * dr - this.grav[k] * dt; this.v[k * 3 + 2] *= dr;
        this.p[k * 3] += this.v[k * 3] * dt; this.p[k * 3 + 1] += this.v[k * 3 + 1] * dt; this.p[k * 3 + 2] += this.v[k * 3 + 2] * dt;
        // fade by darkening (works for additive and normal blending)
        if (this.life[k] < 0.15) { const f = 0.85; this.c[k * 3] *= f; this.c[k * 3 + 1] *= f; this.c[k * 3 + 2] *= f; }
      }
      if (any) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; }
    }
    clear() { this.life.fill(0); this.p.fill(-999); this.geo.attributes.position.needsUpdate = true; }
  }

  // bullet-hole tint per surface (multiplies the hole texture)
  const HOLE_TINT = { concrete: 0xb8b0a6, metal: 0x707070, wood: 0x8a6c4c };

  class Effects {
    constructor(scene) {
      this.scene = scene;
      // tracers
      const tg = new T.BoxGeometry(0.014, 0.014, 1); tg.translate(0, 0, 0.5);
      this.tracers = [];
      for (let i = 0; i < 40; i++) {
        const m = new T.Mesh(tg, new T.MeshBasicMaterial({ color: 0xffd090, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
        m.visible = false; m.frustumCulled = false; scene.add(m);
        this.tracers.push({ m, from: new T.Vector3(), dir: new T.Vector3(), len: 0, d: 0, alive: false });
      }
      this.ti = 0;
      this.sparks = new Particles(scene, 400, 0.065, T.AdditiveBlending, 1);
      this.dust = new Particles(scene, 300, 0.34, T.NormalBlending, 0.5);
      // bullet marks: one instanced mesh, tinted per surface, oldest replaced first
      this.holeN = 160;
      this.holes = new T.InstancedMesh(new T.PlaneGeometry(0.14, 0.14),
        new T.MeshStandardMaterial({ map: holeTex(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), this.holeN);
      this.holes.instanceMatrix.setUsage(T.DynamicDrawUsage);
      const hide = new T.Matrix4().makeScale(0, 0, 0), white = new T.Color(1, 1, 1);
      for (let i = 0; i < this.holeN; i++) { this.holes.setMatrixAt(i, hide); this.holes.setColorAt(i, white); }
      this.holes.frustumCulled = false; this.holes.count = this.holeN;
      scene.add(this.holes);
      this.hi = 0; this._dummy = new T.Object3D(); this._c = new T.Color(); this._hide = hide;
      // world muzzle flashes (bots) and metal-hit flashes
      const fm = new T.SpriteMaterial({ map: starTex(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
      this.flashes = [];
      for (let i = 0; i < 16; i++) { const s = new T.Sprite(fm); s.visible = false; s.userData.t = 0; scene.add(s); this.flashes.push(s); }
      this.fi = 0;
      // one shared flash light: the count of lights never changes, so no shader recompiles
      this.light = new T.PointLight(0xffa860, 0, 10, 2); scene.add(this.light);
      this.lightT = 0;
    }
    tracer(from, to, color) {
      const t = this.tracers[this.ti]; this.ti = (this.ti + 1) % this.tracers.length;
      t.from.copy(from); t.dir.subVectors(to, from); t.len = t.dir.length(); t.dir.normalize(); t.d = 0.4; t.alive = true;
      t.m.material.color.setHex(color || 0xffd090);
      t.m.visible = true;
    }
    impact(p, n, surface) {
      const [nx, ny, nz] = n;
      if (surface === 'metal') {
        for (let i = 0; i < 9; i++) this.sparks.emit(p.x, p.y, p.z, nx * 3 + (Math.random() - 0.5) * 6, ny * 3 + Math.random() * 4.5, nz * 3 + (Math.random() - 0.5) * 6, 1, 0.55, 0.16, 0.12 + Math.random() * 0.22, 12, 1.2);
        this.flashAt(p, 0.18 + Math.random() * 0.12, 0.035);
      } else if (surface === 'concrete') {
        for (let i = 0; i < 3; i++) this.sparks.emit(p.x, p.y, p.z, nx * 2 + (Math.random() - 0.5) * 3, ny * 2 + Math.random() * 2, nz * 2 + (Math.random() - 0.5) * 3, 0.9, 0.55, 0.25, 0.06 + Math.random() * 0.06, 10, 1);
      }
      const col = surface === 'wood' ? [0.42, 0.3, 0.19] : surface === 'metal' ? [0.32, 0.3, 0.29] : [0.6, 0.58, 0.54];
      const n2 = surface === 'metal' ? 4 : 8;
      for (let i = 0; i < n2; i++) this.dust.emit(p.x + nx * 0.05, p.y + ny * 0.05, p.z + nz * 0.05, nx * (1.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2, ny * 1.6 + Math.random() * 0.9, nz * (1.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2, col[0], col[1], col[2], 0.6 + Math.random() * 0.6, 0.5, 3);
      // decal
      const d = this._dummy, s = 0.75 + Math.random() * 0.6;
      d.position.set(p.x + nx * 0.01, p.y + ny * 0.01, p.z + nz * 0.01);
      d.lookAt(p.x + nx, p.y + ny, p.z + nz); d.rotateZ(Math.random() * 6.28); d.scale.set(s, s, 1);
      d.updateMatrix();
      this.holes.setMatrixAt(this.hi, d.matrix);
      this.holes.setColorAt(this.hi, this._c.setHex(HOLE_TINT[surface] || HOLE_TINT.concrete));
      this.holes.instanceMatrix.needsUpdate = true; this.holes.instanceColor.needsUpdate = true;
      this.hi = (this.hi + 1) % this.holeN;
    }
    bodyHit(p, dir, head) {
      for (let i = 0; i < (head ? 14 : 7); i++) this.dust.emit(p.x, p.y, p.z, dir.x * 2 + (Math.random() - 0.5) * 1.5, dir.y * 2 + Math.random() * 1.2, dir.z * 2 + (Math.random() - 0.5) * 1.5, 0.42, 0.05, 0.04, 0.35 + Math.random() * 0.3, 4, 3);
    }
    flashAt(p, size, t) {
      const s = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
      s.position.copy(p); s.userData.t = t; s.visible = true; s.layers.set(0); // a caller may hide it from one view (split screen)
      s.scale.set(size, size, 1); s.material.rotation = Math.random() * 6;
      return s;
    }
    /** Bot muzzle flash: sprite plus the shared light when the player is not firing. */
    muzzle(p) {
      this.flashAt(p, 0.45 + Math.random() * 0.3, 0.05);
      if (this.lightT <= 0) { this.light.position.copy(p); this.light.intensity = 1.6; this.lightT = 0.045; }
    }
    playerFlash(p) { this.light.position.copy(p); this.light.intensity = 2.4; this.lightT = 0.05; }
    clear() {
      for (let i = 0; i < this.holeN; i++) this.holes.setMatrixAt(i, this._hide);
      this.holes.instanceMatrix.needsUpdate = true;
      this.sparks.clear(); this.dust.clear(); this.tracers.forEach(t => { t.alive = false; t.m.visible = false; });
    }
    update(dt) {
      for (const t of this.tracers) {
        if (!t.alive) continue;
        t.d += dt * 260;
        const seg = Math.min(5, t.len);
        if (t.d - seg > t.len) { t.alive = false; t.m.visible = false; continue; }
        const head = Math.min(t.d, t.len), tail = Math.max(0.4, t.d - seg);
        t.m.position.copy(t.from).addScaledVector(t.dir, tail);
        t.m.scale.set(1, 1, Math.max(0.01, head - tail));
        t.m.lookAt(t.from.x + t.dir.x * 1000, t.from.y + t.dir.y * 1000, t.from.z + t.dir.z * 1000);
      }
      this.sparks.update(dt); this.dust.update(dt);
      for (const s of this.flashes) if (s.visible) { s.userData.t -= dt; if (s.userData.t <= 0) s.visible = false; }
      if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; }
    }
  }

  // ------------------------------------------------------------ first-person weapons

  const SLEEVES = [0x2f5e74, 0x8a4b2c];

  function buildGun(id, team) {
    const g = new T.Group();
    const L = c => new T.MeshLambertMaterial({ color: c });
    const metal = L(0x3b4047), steel = L(0x4e545c), dark = L(0x1a1c20), poly = L(id === 'longline' ? 0x6b6650 : 0x3e4239);
    const accent = L({ tern: 0xe08a3a, skiff: 0x47b7c4, breaker: 0xd8b13c, longline: 0xc4553a }[id]);
    const sleeve = L(SLEEVES[team] || SLEEVES[0]), glove = L(0x2a2a2d), cuff = L(0x1a1a1c);
    const add = (w, h, d, x, y, z, m, rx = 0, ry = 0, rz = 0) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); g.add(b); return b; };
    const cyl = (r0, r1, len, x, y, z, m, seg = 10) => { const c = new T.Mesh(new T.CylinderGeometry(r0, r1, len, seg), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; };
    const limb = (a, b, w, m) => { // a box stretched between two points (forearms)
      const A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]), len = A.distanceTo(B);
      const mesh = new T.Mesh(new T.BoxGeometry(w, w * 0.9, len), m);
      mesh.position.copy(A).add(B).multiplyScalar(0.5); mesh.lookAt(B); g.add(mesh); return mesh;
    };
    const hand = (x, y, z, ry = 0, rz = 0) => { add(0.07, 0.075, 0.09, x, y, z, glove, 0, ry, rz); add(0.074, 0.03, 0.05, x, y + 0.02, z - 0.06, glove, 0.5, ry, rz); };
    let muzzleZ, muzzleY = 0.025;
    if (id === 'tern') {
      add(0.04, 0.045, 0.19, 0, 0.035, -0.05, steel);                  // slide
      add(0.042, 0.008, 0.12, 0, 0.06, -0.03, accent);                 // top strip
      add(0.044, 0.012, 0.05, 0, 0.03, -0.01, dark);                   // ejection port band
      add(0.034, 0.03, 0.17, 0, 0.0, -0.05, metal);                    // frame
      add(0.008, 0.012, 0.01, 0, 0.064, -0.135, dark); add(0.03, 0.012, 0.01, 0, 0.064, 0.035, dark); // sights
      add(0.036, 0.12, 0.05, 0, -0.06, 0.02, poly, 0.22);              // grip
      add(0.01, 0.035, 0.05, 0, -0.025, -0.035, dark);                 // trigger guard
      hand(0.0, -0.05, 0.04); hand(-0.035, -0.06, 0.03, 0.3);
      limb([0.01, -0.08, 0.08], [0.1, -0.24, 0.42], 0.075, sleeve);
      limb([-0.04, -0.09, 0.07], [-0.17, -0.24, 0.4], 0.075, sleeve);
      add(0.08, 0.08, 0.03, 0.03, -0.11, 0.17, cuff, 0.4, 0.25);
      muzzleZ = -0.15; muzzleY = 0.035;
    } else if (id === 'skiff') {
      add(0.055, 0.075, 0.28, 0, 0.02, -0.07, metal);
      add(0.057, 0.012, 0.16, 0, 0.062, -0.07, accent);
      add(0.035, 0.035, 0.09, 0, 0.022, -0.25, dark);                  // suppressor stub
      add(0.012, 0.02, 0.012, 0, 0.068, -0.18, dark); add(0.03, 0.02, 0.012, 0, 0.068, 0.04, dark);
      add(0.035, 0.16, 0.045, 0, -0.1, -0.12, dark, -0.12);            // magazine
      add(0.038, 0.1, 0.045, 0, -0.06, 0.04, poly, 0.3);               // grip
      add(0.015, 0.015, 0.17, 0.02, 0.02, 0.14, steel); add(0.015, 0.015, 0.17, -0.02, 0.02, 0.14, steel); add(0.05, 0.05, 0.015, 0, 0.0, 0.22, steel); // wire stock
      hand(0.0, -0.06, 0.05); hand(-0.02, -0.04, -0.2, 0.2, 0.3);
      limb([0.01, -0.09, 0.09], [0.12, -0.26, 0.42], 0.075, sleeve);
      limb([-0.04, -0.07, -0.18], [-0.24, -0.3, 0.12], 0.075, sleeve);
      muzzleZ = -0.3;
    } else if (id === 'breaker') {
      add(0.06, 0.085, 0.36, 0, 0.02, -0.04, metal);                   // receiver
      add(0.068, 0.07, 0.22, 0, 0.015, -0.31, poly);                   // handguard
      for (let k = 0; k < 4; k++) add(0.07, 0.012, 0.025, 0, 0.0, -0.24 - k * 0.045, dark); // vents
      cyl(0.012, 0.012, 0.18, 0, 0.025, -0.5, dark, 8);
      add(0.03, 0.035, 0.04, 0, 0.026, -0.6, dark);                    // muzzle brake
      add(0.026, 0.03, 0.08, 0, 0.085, -0.02, dark); add(0.02, 0.02, 0.01, 0, 0.11, 0.0, accent); // optic + dot
      add(0.012, 0.03, 0.012, 0, 0.08, -0.38, dark);
      add(0.042, 0.16, 0.065, 0, -0.1, -0.11, poly, -0.25);            // magazine
      add(0.038, 0.1, 0.045, 0, -0.065, 0.06, poly, 0.3);              // grip
      add(0.048, 0.085, 0.2, 0, 0.0, 0.22, poly);                      // stock
      add(0.062, 0.012, 0.15, 0, 0.066, -0.1, accent);
      hand(0.0, -0.065, 0.07); hand(-0.02, -0.045, -0.3, 0.2, 0.3);
      limb([0.01, -0.09, 0.11], [0.12, -0.26, 0.44], 0.078, sleeve);
      limb([-0.04, -0.07, -0.28], [-0.26, -0.3, 0.06], 0.078, sleeve);
      muzzleZ = -0.63;
    } else {
      add(0.056, 0.075, 0.46, 0, 0.01, -0.06, metal);
      cyl(0.013, 0.011, 0.55, 0, 0.025, -0.55, dark, 8);
      cyl(0.021, 0.021, 0.3, 0, 0.095, -0.08, dark, 12);                 // scope tube
      cyl(0.03, 0.022, 0.06, 0, 0.095, -0.25, dark, 12); cyl(0.026, 0.021, 0.05, 0, 0.095, 0.08, dark, 12);
      add(0.012, 0.04, 0.02, 0, 0.055, -0.15, dark); add(0.012, 0.04, 0.02, 0, 0.055, 0.0, dark); // rings
      add(0.05, 0.02, 0.02, 0.045, 0.035, 0.05, steel);                // bolt handle
      add(0.04, 0.12, 0.05, 0, -0.07, 0.1, poly, 0.3);
      add(0.058, 0.1, 0.26, 0, -0.01, 0.3, poly);
      add(0.058, 0.012, 0.2, 0, 0.05, -0.24, accent);
      add(0.04, 0.07, 0.06, 0, -0.06, -0.1, dark);
      hand(0.0, -0.07, 0.1); hand(-0.02, -0.04, -0.32, 0.2, 0.3);
      limb([0.01, -0.09, 0.13], [0.12, -0.26, 0.46], 0.078, sleeve);
      limb([-0.04, -0.07, -0.3], [-0.26, -0.3, 0.06], 0.078, sleeve);
      muzzleZ = -0.84;
    }
    const muzzle = new T.Object3D(); muzzle.position.set(0, muzzleY, muzzleZ); g.add(muzzle);
    return { group: g, muzzle };
  }

  // ------------------------------------------------------------ first-person view models from glTF rigs

  /*
   * Each weapon is an arms+gun rig (J-Toastie's Glock and AKM rigs, with Idle/Shoot/Reload clips).
   * The Skiff and Longline have no arms of their own, so the AKM rig's arms hold them: the AKM is
   * hidden and the MPX / Mk14 is parented to the rig's gun bone, so it follows the shoot and
   * reload animation. Sizes are normalised by measuring the posed gun mesh at load, then:
   *   len   gun length in metres in view space
   *   hip   where the gun's sight point sits relative to the eye (x right, y up, z forward = -)
   *   aim   the same while aiming down sights (x = 0 puts the sights on the crosshair)
   *   swap  { file, len (relative to the AKM), grip: [fraction from AKM muzzle, from swap muzzle], dy }
   *   sight fraction of the gun length from the muzzle where the sights / optic are
   */
  const VM = {
    tern:     { rig: 'glock_rig', gun: 'Glock19', len: 0.2, hip: [0.085, -0.1, -0.28], aim: [0, -0.009, -0.33], sight: 0.88, flash: 0.075, eject: 0.62, shell: 'pistol' },
    skiff:    { rig: 'akm_rig', gun: 'AKM_model', len: 0.6, hip: [0.13, -0.125, -0.27], aim: [0, -0.012, -0.28], sight: 0.6, flash: 0.1, eject: 0.55, shell: 'pistol',
                swap: { file: 'mpx', len: 0.78, grip: [0.62, 0.6], dy: 0 } },
    breaker:  { rig: 'akm_rig', gun: 'AKM_model', len: 0.78, hip: [0.125, -0.12, -0.29], aim: [0, -0.012, -0.28], sight: 0.62, flash: 0.12, eject: 0.6, shell: 'rifle' },
    longline: { rig: 'akm_rig', gun: 'AKM_model', len: 1.0, hip: [0.15, -0.15, -0.56], aim: [0, -0.045, -0.5], sight: 0.6, flash: 0.13, eject: 0.58, shell: 'rifle',
                swap: { file: 'm21', len: 1.15, grip: [0.62, 0.66], dy: 0 } },
  };
  const SLEEVE_TINT = [0x34465a, 0x6b5a3e];
  // the rigs' flat low-poly colours, re-tinted toward real finishes: [colour, roughness, metalness]
  const FINISH = {
    Metal1: [0x3b3e44, 0.42, 0.85], Metal2: [0x2a2c31, 0.5, 0.8], Black: [0x17181b, 0.55, 0.5], 'Black.002': [0x17181b, 0.55, 0.5],
    DarkPlastic: [0x1d1e21, 0.7, 0.05], Wood: [0x4a2812, 0.55, 0], BakeliteMag: [0x5a2410, 0.45, 0.05],
    Frame: [0x1c1d20, 0.72, 0.05], Slide: [0x2c2e33, 0.38, 0.85], Magazine: [0x1c1d20, 0.6, 0.2], GrayShade2: [0x45484e, 0.45, 0.7],
  };

  const _v = new T.Vector3(), _m = new T.Matrix4();
  /** Visit every vertex of the meshes under obj, posed (skinning applied), in `space`'s local frame. */
  function eachVertex(obj, space, fn) {
    space.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(space.matrixWorld).invert();
    obj.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const pos = o.geometry.attributes.position;
      if (o.isSkinnedMesh) o.skeleton.update();
      _m.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.boneTransform(i, _v); // posed, in the mesh's own space
        _v.applyMatrix4(_m);
        fn(_v);
      }
    });
  }
  /** Bounds and key points of a gun (muzzle along -z) in `space`: muzzle centre, sight point, eject point. */
  function measureGun(obj, space, sightF, ejectF) {
    const box = new T.Box3();
    eachVertex(obj, space, v => box.expandByPoint(v));
    const L = box.max.z - box.min.z, eps = L * 0.012;
    const mz = new T.Vector3(), mzN = { n: 0 };
    let sightTop = -Infinity, ejTop = -Infinity, ejRight = -Infinity;
    const zs = box.min.z + L * sightF, ze = box.min.z + L * ejectF;
    eachVertex(obj, space, v => {
      if (v.z < box.min.z + eps) { mz.add(v); mzN.n++; }
      if (Math.abs(v.z - zs) < L * 0.04) sightTop = Math.max(sightTop, v.y);
      if (Math.abs(v.z - ze) < L * 0.05) { ejTop = Math.max(ejTop, v.y); ejRight = Math.max(ejRight, v.x); }
    });
    mz.divideScalar(Math.max(1, mzN.n));
    const cx = (box.min.x + box.max.x) / 2;
    return {
      box, L,
      muzzle: mz,
      sight: new T.Vector3(cx, isFinite(sightTop) ? sightTop : box.max.y, zs),
      eject: new T.Vector3(isFinite(ejRight) ? cx + (ejRight - cx) * 0.6 : cx, isFinite(ejTop) ? ejTop - (box.max.y - box.min.y) * 0.08 : box.max.y, ze),
    };
  }

  function findBone(root, name) { let b = null; root.traverse(o => { if (!b && o.isBone && o.name === name) b = o; }); return b; }

  /** Build one rig-based view model. Returns null when the rig is missing (caller falls back). */
  function buildRigGun(id, team, assets, env) {
    const cfg = VM[id], src = assets && assets.gltf && assets.gltf[cfg.rig];
    const SU = T.SkeletonUtils;
    if (!src || !SU) return null;
    if (cfg.swap && !(assets.gltf[cfg.swap.file])) return null;
    const holder = new T.Group();          // our transform: placement, sway, kick
    const inner = new T.Group();           // centres the sight point on the holder origin
    const rig = SU.clone(src.scene);
    rig.rotation.y = Math.PI / 2;          // rigs face +x; view space faces -z
    inner.add(rig); holder.add(inner);
    const mixer = new T.AnimationMixer(rig);
    const clip = n => src.animations.find(a => a.name === 'Armature|' + n);
    const act = {};
    ['Idle', 'Shoot', 'Reload'].forEach(n => { const c = clip(n); if (c) act[n] = mixer.clipAction(c); });
    if (act.Idle) act.Idle.play();
    mixer.update(0.01);
    // materials: env reflections, team sleeves, no fog in view space
    rig.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const out = ms.map(m => {
        const c = m.clone();
        if (env) { c.envMap = env; c.envMapIntensity = 0.9; }
        if (/shirt/i.test(c.name)) { c.color.setHex(SLEEVE_TINT[team] || SLEEVE_TINT[0]); c.roughness = 0.95; }
        if (/glove/i.test(c.name)) { c.color.setHex(0x26282c); }
        const f = FINISH[c.name];
        if (f) { c.color.setHex(f[0]); c.roughness = f[1]; c.metalness = f[2]; }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    let gunNode = null; rig.traverse(o => { if (!gunNode && o.name === cfg.gun) gunNode = o; });
    const bone = findBone(rig, 'Root');
    if (!gunNode || !bone) return null;
    let gunObj = gunNode, swapObj = null;
    if (cfg.swap) {
      // measure the AKM in rig space, then size and seat the swap gun where the AKM was
      const ak = measureGun(gunNode, inner, 0.5, 0.5);
      gunNode.visible = false;
      swapObj = assets.gltf[cfg.swap.file].scene.clone(true);
      const wrap = new T.Group(); wrap.add(swapObj); inner.add(wrap);
      const sw = measureGun(swapObj, wrap, 0.5, 0.5);
      const k = ak.L * cfg.swap.len / sw.L;
      wrap.scale.setScalar(k);
      const zA = ak.box.min.z + ak.L * cfg.swap.grip[0], zS = (sw.box.min.z + sw.L * cfg.swap.grip[1]) * k;
      wrap.position.set((ak.box.min.x + ak.box.max.x) / 2 - (sw.box.min.x + sw.box.max.x) / 2 * k,
        ak.box.max.y - sw.box.max.y * k + (ak.box.max.y - ak.box.min.y) * (cfg.swap.dy || 0), zA - zS);
      wrap.updateMatrixWorld(true);
      bone.attach(wrap);                   // follow the rig's gun bone from now on
      swapObj.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false; o.castShadow = false;
        o.material = o.material.clone(); if (env) { o.material.envMap = env; o.material.envMapIntensity = 0.9; }
      });
      gunObj = swapObj;
    }
    // normalise size, centre the sights
    const g = measureGun(gunObj, inner, cfg.sight, cfg.eject);
    const k = cfg.len / g.L;
    inner.scale.setScalar(k);
    inner.position.set(-g.sight.x * k, -g.sight.y * k, -g.sight.z * k);
    holder.updateMatrixWorld(true);
    // muzzle and ejection port ride on the gun bone
    const mk = p => { const o = new T.Object3D(); o.position.copy(p); inner.add(o); o.updateMatrixWorld(true); bone.attach(o); return o; };
    const muzzle = mk(g.muzzle), eject = mk(g.eject);
    return { group: holder, muzzle, eject, mixer, act, rig: true, cfg };
  }

  // brass casings: a small pooled set living in view space
  class Shells {
    constructor(scene, env) {
      const mat = new T.MeshStandardMaterial({ color: 0xc9953f, metalness: 1, roughness: 0.32, envMap: env || null, envMapIntensity: 1.3 });
      this.geo = { pistol: new T.CylinderGeometry(0.0042, 0.0042, 0.019, 8), rifle: new T.CylinderGeometry(0.005, 0.0056, 0.039, 8) };
      this.pool = [];
      for (let i = 0; i < 14; i++) {
        const m = new T.Mesh(this.geo.rifle, mat); m.visible = false; m.frustumCulled = false; scene.add(m);
        this.pool.push({ m, v: new T.Vector3(), w: new T.Vector3(), t: 0 });
      }
      this.i = 0;
    }
    emit(pos, right, up, kind) {
      const s = this.pool[this.i]; this.i = (this.i + 1) % this.pool.length;
      s.m.geometry = this.geo[kind] || this.geo.rifle;
      s.m.position.copy(pos); s.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.PI / 2);
      s.v.copy(right).multiplyScalar(1.1 + Math.random() * 0.5).addScaledVector(up, 0.9 + Math.random() * 0.5);
      s.v.z += 0.15 + Math.random() * 0.2;
      s.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 18 + Math.random() * 10);
      s.t = 0.7; s.m.visible = true;
    }
    update(dt) {
      for (const s of this.pool) {
        if (s.t <= 0) continue;
        s.t -= dt;
        if (s.t <= 0) { s.m.visible = false; continue; }
        s.v.y -= 5.5 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      }
    }
  }

  function flashTextures() {
    const side = W().canvasTex(64, (g, s) => { // a flame tongue seen from the side
      const gr = g.createRadialGradient(s * 0.15, s / 2, 0, s * 0.15, s / 2, s * 0.85);
      gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.85)'); gr.addColorStop(0.6, 'rgba(255,110,30,0.25)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, s * 0.42); g.quadraticCurveTo(s * 0.6, s * 0.2, s, s / 2); g.quadraticCurveTo(s * 0.6, s * 0.8, 0, s * 0.58); g.closePath(); g.fill();
    }, false);
    return { star: starTex(), side };
  }

  class ViewModel {
    constructor(assets, env) {
      this.assets = assets; this.env = env;
      this.scene = new T.Scene();
      if (env) this.scene.environment = env;
      this.camera = new T.PerspectiveCamera(56, 1, 0.01, 10);
      this.hemi = new T.HemisphereLight(0xa8b4de, 0x4a3834, env ? 0.35 : 0.75); this.scene.add(this.hemi);
      this.sun = new T.DirectionalLight(0xffb27a, env ? 1.6 : 1.0); this.sun.position.set(-1, 1.2, 0.2); this.scene.add(this.sun);
      const rim = new T.DirectionalLight(0x8fa0ff, 0.3); rim.position.set(1, 0.3, -1); this.scene.add(rim);
      this.root = new T.Group(); this.scene.add(this.root);
      this.guns = {};
      this.team = 0;
      // muzzle flash: a star facing the eye plus two crossed flame tongues along the barrel
      const ft = flashTextures();
      this.flash = new T.Group();
      const fmat = map => new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false });
      this.flashStar = new T.Sprite(new T.SpriteMaterial({ map: ft.star, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      const tongue = new T.PlaneGeometry(1, 0.42); tongue.translate(0.5, 0, 0); tongue.rotateY(Math.PI / 2); // extends along -z
      this.flashA = new T.Mesh(tongue, fmat(ft.side)); this.flashB = new T.Mesh(tongue, fmat(ft.side)); this.flashB.rotation.z = Math.PI / 2;
      this.flash.add(this.flashStar, this.flashA, this.flashB);
      this.flash.visible = false; this.scene.add(this.flash);
      this.flashLight = new T.PointLight(0xffa860, 0, 1.6, 2); this.scene.add(this.flashLight);
      this.shells = new Shells(this.scene, env);
      this.current = null;
      this.t = { bob: 0, kick: 0, kickRot: 0, swayX: 0, swayY: 0, flashT: 0, aim: 0, roll: 0, shootT: 0, reloadT: 0 };
      this._sunDir = new T.Vector3(-0.62, 0.34, -0.72).normalize();
      this._q = new T.Quaternion(); this._p = new T.Vector3(); this._r = new T.Vector3(); this._u = new T.Vector3();
    }
    _build(id, team) {
      let g = null;
      try { g = buildRigGun(id, team, this.assets, this.env); } catch (e) { console.warn('Duskwater: view model fallback for', id, e); }
      if (!g) { const b = buildGun(id, team); g = { group: b.group, muzzle: b.muzzle, eject: null, rig: false, cfg: null }; }
      if (g.mixer) g.mixer.addEventListener('finished', e => { if (e.action !== g.act.Idle && g.act.Idle) this._toIdle(g); });
      return g;
    }
    setWeapon(id, team) {
      const key = id + team;
      if (!this.guns[key]) { this.guns[key] = this._build(id, team); this.root.add(this.guns[key].group); }
      Object.keys(this.guns).forEach(k => { this.guns[k].group.visible = k === key; });
      if (this.key !== key) { const g = this.guns[key]; if (g.mixer) this._toIdle(g, 0); }
      this.current = id; this.key = key; this.team = team;
    }
    /** Build every weapon for a team up front so the first switch does not hitch. */
    prepare(team) {
      const keep = this.current;
      Object.keys(VM).forEach(id => this.setWeapon(id, team));
      if (keep) this.setWeapon(keep, team);
    }
    _toIdle(g, fade = 0.12) {
      const a = g.act;
      ['Shoot', 'Reload'].forEach(n => { if (a[n] && a[n].isRunning()) a[n].fadeOut(fade); });
      if (a.Idle) { if (!a.Idle.isRunning() || a.Idle.getEffectiveWeight() < 1) a.Idle.reset().fadeIn(fade).play(); }
    }
    _once(g, name, duration, fade) {
      const a = g.act[name]; if (!a) return;
      ['Idle', 'Shoot', 'Reload'].forEach(n => { if (n !== name && g.act[n] && g.act[n].isRunning()) g.act[n].fadeOut(fade); });
      a.reset(); a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true;
      a.timeScale = duration ? a.getClip().duration / duration : 1;
      a.setEffectiveWeight(1); a.fadeIn(fade).play();
    }
    /** Fired a shot. strength scales the procedural kick. */
    fire(strength) {
      this.t.kick += 0.03 * strength; this.t.kickRot += 0.06 * strength; this.t.flashT = 0.05; this.t.roll += (Math.random() - 0.5) * 0.04 * strength;
      const g = this.guns[this.key];
      if (g && g.rig && g.act.Shoot && !(g.act.Reload && g.act.Reload.isRunning() && g.act.Reload.getEffectiveWeight() > 0.5)) {
        const auto = this.current === 'skiff' || this.current === 'breaker';
        this._once(g, 'Shoot', auto ? 0.12 : this.current === 'longline' ? 0.3 : 0.24, 0.02);
      }
      if (g && g.eject && this.current !== 'longline') this._ejectShell(g);
      else if (g && g.eject) setTimeout(() => { if (this.guns[this.key] === g) this._ejectShell(g); }, 520); // bolt throw
    }
    _ejectShell(g) {
      this.root.updateMatrixWorld(true);
      g.eject.getWorldPosition(this._p);
      this.root.getWorldQuaternion(this._q);
      this._r.set(1, 0, 0).applyQuaternion(this._q); this._u.set(0, 1, 0).applyQuaternion(this._q);
      this.shells.emit(this._p, this._r, this._u, g.cfg ? g.cfg.shell : 'rifle');
    }
    /** Reload started: play the rig's reload clip stretched to the weapon's reload time. */
    reload(duration) {
      const g = this.guns[this.key];
      if (g && g.rig && g.act.Reload) this._once(g, 'Reload', duration, 0.15);
    }
    cancel() { const g = this.guns[this.key]; if (g && g.rig) this._toIdle(g, 0.1); }
    resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    /** s: { dt, speed, onGround, lookYaw, lookPitch, reload (0..1 or -1), draw (0..1), aim (0..1), crouch, camQuat } */
    update(s) {
      const t = this.t, dt = s.dt;
      const g = this.guns[this.key];
      t.bob += dt * (s.onGround ? Math.min(1, s.speed / 5) * 9.5 : 0);
      t.swayX += (-s.lookYaw * 0.9 - t.swayX) * Math.min(1, dt * 8); t.swayY += (s.lookPitch * 0.9 - t.swayY) * Math.min(1, dt * 8);
      t.kick *= Math.exp(-dt * 16); t.kickRot *= Math.exp(-dt * 13); t.roll *= Math.exp(-dt * 10);
      t.aim += ((s.aim ? 1 : 0) - t.aim) * Math.min(1, dt * 12);
      const bobAmt = Math.min(1, s.speed / 5) * (1 - 0.75 * t.aim);
      let x, y, z;
      if (g && g.rig) {
        const c = g.cfg, a = t.aim;
        x = c.hip[0] + (c.aim[0] - c.hip[0]) * a; y = c.hip[1] + (c.aim[1] - c.hip[1]) * a; z = c.hip[2] + (c.aim[2] - c.hip[2]) * a;
      } else {
        const pistol = this.current === 'tern';
        const base = pistol ? [0.12, -0.13, -0.4] : [0.15, -0.15, -0.4];
        const aimP = [0, pistol ? -0.098 : this.current === 'breaker' ? -0.108 : -0.1, pistol ? -0.34 : -0.3];
        x = base[0] + (aimP[0] - base[0]) * t.aim; y = base[1] + (aimP[1] - base[1]) * t.aim; z = base[2] + (aimP[2] - base[2]) * t.aim;
      }
      x += Math.sin(t.bob) * 0.012 * bobAmt + t.swayX * 0.05 * (1 - 0.6 * t.aim); y += -Math.abs(Math.cos(t.bob)) * 0.012 * bobAmt + t.swayY * 0.05 * (1 - 0.6 * t.aim) - s.crouch * 0.01;
      z += t.kick * (1 - 0.4 * t.aim);
      let rx = t.kickRot * (1 - 0.5 * t.aim), rz = t.roll + t.swayX * 0.2, ry = t.swayX * 0.15;
      // procedural reload dip only for the fallback guns (rigs have a real reload clip)
      if (s.reload >= 0 && !(g && g.rig)) { const k = Math.sin(Math.min(1, s.reload) * Math.PI); y -= k * 0.13; rx -= k * 0.65; rz += k * 0.4; }
      if (s.draw > 0) { y -= s.draw * 0.25; rx -= s.draw * 0.8; }
      this.root.position.set(x, y, z);
      this.root.rotation.set(rx, ry, rz);
      if (g && g.mixer) g.mixer.update(dt);
      // keep the view model's sun where the world's sun is
      if (s.camQuat) { this._q.copy(s.camQuat).invert(); this.sun.position.copy(this._sunDir).applyQuaternion(this._q); }
      this.shells.update(dt);
      if (t.flashT > 0 && g) {
        t.flashT -= dt;
        this.root.updateMatrixWorld(true);
        g.muzzle.getWorldPosition(this.flash.position);
        this.root.getWorldQuaternion(this.flash.quaternion);
        const base = (g.cfg ? g.cfg.flash : (this.current === 'tern' ? 0.06 : 0.08)) * (1 - 0.35 * t.aim);
        const k = base * (0.8 + Math.random() * 0.5);
        this.flashStar.scale.set(k, k, 1); this.flashStar.material.rotation = Math.random() * 6;
        const L = k * (1.6 + Math.random() * 0.8);
        this.flashA.scale.set(L, L, L); this.flashB.scale.set(L, L, L);
        this.flashA.rotation.z = Math.random() * 0.5; this.flashB.rotation.z = Math.PI / 2 + Math.random() * 0.5;
        this.flash.visible = true; this.flashLight.position.copy(this.flash.position); this.flashLight.intensity = 3;
      } else { this.flash.visible = false; this.flashLight.intensity = 0; }
    }
  }

  global.ArenaFx = { Effects, ViewModel, VM, FINISH, measureGun };
})(window);
