/*
 * Iron Ludus - particles: clash sparks, blood spray, blood on the sand, dust puffs.
 * Classic script: defines window.LudusFx.
 */
(function () {
  'use strict';
  const T = THREE;

  function dotTex(soft) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft ? 0.4 : 0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  class Particles {
    constructor(scene, n, opts) {
      this.n = n; this.i = 0;
      this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
      this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
      this.g = opts.gravity; this.drag = opts.drag || 0;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
      geo.setAttribute('color', new T.BufferAttribute(this.col, 3));
      this.mat = new T.PointsMaterial({ size: opts.size, map: dotTex(opts.soft), vertexColors: true, transparent: true,
        depthWrite: false, blending: opts.additive ? T.AdditiveBlending : T.NormalBlending, sizeAttenuation: true });
      this.points = new T.Points(geo, this.mat); this.points.frustumCulled = false;
      for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -100;
      scene.add(this.points);
      this.floorHit = opts.floorHit || null;
    }
    emit(p, v, color, life) {
      const k = this.i++ % this.n, j = k * 3;
      this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
      this.vel[j] = v.x; this.vel[j + 1] = v.y; this.vel[j + 2] = v.z;
      this.col[j] = color.r; this.col[j + 1] = color.g; this.col[j + 2] = color.b;
      this.life[k] = life; this.max[k] = life;
    }
    update(dt) {
      for (let k = 0; k < this.n; k++) {
        if (this.life[k] <= 0) continue;
        const j = k * 3;
        this.life[k] -= dt;
        this.vel[j + 1] -= this.g * dt;
        const d = 1 - this.drag * dt;
        this.vel[j] *= d; this.vel[j + 1] *= d; this.vel[j + 2] *= d;
        this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
        if (this.pos[j + 1] < 0.01) {
          if (this.floorHit) this.floorHit(this.pos[j], this.pos[j + 2]);
          this.life[k] = 0;
        }
        if (this.life[k] <= 0) this.pos[j + 1] = -100;
        else if (this.mat.blending === T.AdditiveBlending) {
          const f = this.life[k] / this.max[k];
          // white hot to orange, then out: additive, so cooling fades to nothing, never to a dark speck
          this.col[j] *= 0.985 + 0.015 * f; this.col[j + 1] *= 0.955 + 0.045 * f; this.col[j + 2] *= 0.9 + 0.1 * f;
        }
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }

  /**
   * Sparks as streaks: each a thin quad from where it is back along its flight, turned to the camera,
   * white hot at the head cooling to orange; alpha fades it out (never a dark speck on the sand).
   */
  class Streaks {
    constructor(scene, n) {
      this.n = n; this.i = 0; this.cam = null;
      this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
      this.pos = new Float32Array(n * 12); this.col = new Float32Array(n * 16);
      const idx = []; for (let k = 0; k < n; k++) { const a = k * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new T.BufferGeometry(); geo.setIndex(idx);
      geo.setAttribute('position', new T.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new T.BufferAttribute(this.col, 4));
      this.mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; scene.add(this.mesh);
      this.a = new T.Vector3(); this.b = new T.Vector3(); this.d = new T.Vector3(); this.s = new T.Vector3();
    }
    emit(p, v, color, life) {
      const k = this.i++ % this.n, j = k * 3;
      this.p[j] = p.x; this.p[j + 1] = p.y; this.p[j + 2] = p.z; this.v[j] = v.x; this.v[j + 1] = v.y; this.v[j + 2] = v.z;
      this.life[k] = life; this.max[k] = life;
    }
    update(dt) {
      const cam = this.cam;
      for (let k = 0; k < this.n; k++) {
        const j = k * 3, o = k * 12, c = k * 16;
        if (this.life[k] <= 0) { this.col.fill(0, c, c + 16); continue; }
        this.life[k] -= dt;
        this.v[j + 1] -= 6 * dt; const dr = 1 - 1.5 * dt; this.v[j] *= dr; this.v[j + 1] *= dr; this.v[j + 2] *= dr;
        this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
        const f = Math.max(0, this.life[k] / this.max[k]);
        this.a.set(this.p[j], this.p[j + 1], this.p[j + 2]);
        this.d.set(this.v[j], this.v[j + 1], this.v[j + 2]);
        const sp = this.d.length() || 1;
        this.b.copy(this.a).addScaledVector(this.d, -(0.018 + 0.011 * sp) / sp);
        if (cam) this.s.copy(this.a).sub(cam.position); else this.s.set(0, 0, 1);
        this.s.cross(this.d).normalize().multiplyScalar(0.0045);
        this.pos.set([this.a.x + this.s.x, this.a.y + this.s.y, this.a.z + this.s.z, this.a.x - this.s.x, this.a.y - this.s.y, this.a.z - this.s.z,
          this.b.x + this.s.x, this.b.y + this.s.y, this.b.z + this.s.z, this.b.x - this.s.x, this.b.y - this.s.y, this.b.z - this.s.z], o);
        const g = 0.55 + 0.45 * f, bl = 0.15 + 0.8 * f * f, al = Math.min(1, f * 1.6);
        this.col.set([1, g, bl, al, 1, g, bl, al, 1, 0.45 * g, 0.1, 0, 1, 0.45 * g, 0.1, 0], c);
      }
      this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  function create(scene) {
    const fx = {};
    // blood pools on the sand
    const decalMat = new T.MeshStandardMaterial({ color: 0x350303, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.95, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, map: dotTex(false) });
    const decals = [];
    for (let k = 0; k < 90; k++) {
      const m = new T.Mesh(new T.CircleGeometry(1, 12), decalMat);
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1;
      scene.add(m); decals.push(m);
    }
    let di = 0, lastDecal = 0;
    function decal(x, z, size) {
      const now = performance.now();
      if (now - lastDecal < 25) return; lastDecal = now;
      const m = decals[di++ % decals.length];
      m.visible = true; m.position.set(x, 0.012 + Math.random() * 0.004, z);
      const s = size || (0.05 + Math.random() * 0.12); m.scale.set(s, s * (0.7 + Math.random() * 0.6), 1);
      m.rotation.z = Math.random() * 6;
    }
    fx.sparks = new Streaks(scene, 300);
    fx.setCamera = c => { fx.sparks.cam = c; };
    fx.blood = new Particles(scene, 600, { gravity: 9.8, size: 0.06, additive: false, drag: 0.6, soft: true, floorHit: (x, z) => decal(x, z) });
    fx.dust = new Particles(scene, 200, { gravity: -0.15, size: 0.5, additive: false, drag: 2.5, soft: true });
    fx.dust.mat.opacity = 0.35;
    fx.chip = new Particles(scene, 300, { gravity: 7, size: 0.035, additive: false, drag: 1.2 });
    const c1 = new T.Color(), tmp = new T.Vector3();

    /** Sparks flying from p, biased along dir (Vector3, optional). */
    fx.clash = (p, strength, dir) => {
      const n = Math.round(18 + 40 * strength);
      for (let k = 0; k < n; k++) {
        tmp.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(2.5 + Math.random() * 6 * strength);
        if (dir) tmp.addScaledVector(dir, 1.5);
        c1.setRGB(1, 0.72 + Math.random() * 0.28, 0.32 + Math.random() * 0.35);
        fx.sparks.emit(p, tmp, c1, 0.15 + Math.random() * 0.3);
      }
    };
    // versus: blood thrown off a player's own body stays out of that player's eyes (layer = what only the other sees)
    const layered = {};
    const bloodOn = layer => {
      if (!layer) return fx.blood;
      if (!layered[layer]) { layered[layer] = new Particles(scene, 300, { gravity: 9.8, size: 0.06, additive: false, drag: 0.6, soft: true, floorHit: (x, z) => decal(x, z) }); layered[layer].points.layers.set(layer); }
      return layered[layer];
    };
    /** Blood spray from p, thrown along dir (the cut's motion). layer: see bloodOn. */
    fx.bleed = (p, strength, dir, layer) => {
      const sys = bloodOn(layer);
      const n = Math.round(14 + 50 * strength);
      for (let k = 0; k < n; k++) {
        tmp.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(1.2 + 2.2 * strength);
        if (dir) tmp.addScaledVector(dir, 1 + Math.random() * 2.5 * strength);
        const d = 0.5 + Math.random() * 0.25; c1.setRGB(d, 0.03 + d * 0.02, 0.025);
        sys.emit(p, tmp, c1, 1.6);
      }
      for (let k = 0; k < 3; k++) { lastDecal = 0; decal(p.x + (Math.random() - 0.5) * 0.5, p.z + (Math.random() - 0.5) * 0.5, 0.05 + 0.1 * strength * Math.random()); }
    };
    fx.puff = (p, n) => {
      for (let k = 0; k < (n || 12); k++) {
        tmp.set((Math.random() - 0.5) * 1.6, Math.random() * 0.4, (Math.random() - 0.5) * 1.6);
        c1.setRGB(0.78, 0.66, 0.5);
        fx.dust.emit(new T.Vector3(p.x + tmp.x * 0.2, 0.08, p.z + tmp.z * 0.2), tmp, c1, 1.2);
      }
    };
    /** Chips that do not bleed: straw from a training post, bone from the dead. color: THREE.Color-like {r,g,b}. */
    fx.chips = (p, strength, dir, color) => {
      const n = Math.round(10 + 30 * strength);
      for (let k = 0; k < n; k++) {
        tmp.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(1 + 2 * strength);
        if (dir) tmp.addScaledVector(dir, 1 + Math.random() * 2 * strength);
        const v = 0.8 + Math.random() * 0.4; c1.setRGB(color.r * v, color.g * v, color.b * v);
        fx.chip.emit(p, tmp, c1, 0.9 + Math.random() * 0.6);
      }
    };
    fx.update = dt => { fx.sparks.update(dt); fx.blood.update(dt); fx.dust.update(dt); fx.chip.update(dt); for (const k in layered) layered[k].update(dt); };
    fx.clearDecals = () => decals.forEach(d => { d.visible = false; });
    return fx;
  }

  window.LudusFx = { create };
})();
