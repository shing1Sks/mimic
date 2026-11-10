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
          this.col[j] *= 0.98 + 0.02 * f; this.col[j + 1] *= 0.95 + 0.05 * f; this.col[j + 2] *= 0.9 + 0.1 * f;
        }
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
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
    fx.sparks = new Particles(scene, 400, { gravity: 6, size: 0.022, additive: true, drag: 1.5 });
    fx.blood = new Particles(scene, 600, { gravity: 9.8, size: 0.06, additive: false, drag: 0.6, soft: true, floorHit: (x, z) => decal(x, z) });
    fx.dust = new Particles(scene, 200, { gravity: -0.15, size: 0.5, additive: false, drag: 2.5, soft: true });
    fx.dust.mat.opacity = 0.35;
    fx.chip = new Particles(scene, 300, { gravity: 7, size: 0.035, additive: false, drag: 1.2 });
    const c1 = new T.Color(), tmp = new T.Vector3();

    /** Sparks flying from p, biased along dir (Vector3, optional). */
    fx.clash = (p, strength, dir) => {
      const n = Math.round(18 + 40 * strength);
      for (let k = 0; k < n; k++) {
        tmp.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 4 * strength);
        if (dir) tmp.addScaledVector(dir, 1.5);
        c1.setRGB(1, 0.5 + Math.random() * 0.3, 0.12 + Math.random() * 0.15);
        fx.sparks.emit(p, tmp, c1, 0.25 + Math.random() * 0.35);
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
        const d = 0.25 + Math.random() * 0.3; c1.setRGB(d, 0.01, 0.01);
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
