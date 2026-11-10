/*
 * GYROWING speed effects: air streaks that whip past the camera when you are fast and low, so speed
 * reads as speed. Each streak is a short line fixed in the world along the flight path ahead; the
 * aircraft flies through them and they are respawned ahead once behind. Additive, one draw call.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function SpeedFX(scene, n) {
    this.n = n || 110;
    this.pos = new Float32Array(this.n * 6);
    this.col = new Float32Array(this.n * 6);
    this.p = Array.from({ length: this.n }, () => new THREE.Vector3(1e9, 1e9, 1e9));
    this.b = Array.from({ length: this.n }, () => 0.5 + Math.random() * 0.5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 6; this.lines.visible = false;
    scene.add(this.lines);
    this.dir = new THREE.Vector3(); this.side = new THREE.Vector3(); this.up = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.strength = 0;
  }
  /** Put streak i somewhere ahead along the path: 15..140 m out, 5..32 m off the axis. */
  SpeedFX.prototype.spawn = function (i, cam, near) {
    const d = near ? 6 + Math.random() * 130 : 90 + Math.random() * 60;
    // mostly beside and below the path, where the ground is: streaks overhead read as scratches
    const sx = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 28), sy = -2 - Math.random() * 16 + Math.random() * Math.random() * 10;
    this.p[i].copy(cam).addScaledVector(this.dir, d).addScaledVector(this.side, sx).addScaledVector(this.up, sy);
    this.b[i] = 0.4 + Math.random() * 0.6;
  };
  /**
   * cam: camera position; vel: velocity (m/s, world); want: 0..1 how strong (speed and ground
   * proximity, from game.js); night dims them.
   */
  SpeedFX.prototype.update = function (cam, vel, want, dt, night) {
    this.strength += (want - this.strength) * (1 - Math.exp(-dt * 3));
    const on = this.strength > 0.02;
    this.lines.visible = on;
    if (!on) { this.armed = false; return; }
    const sp = vel.length();
    if (sp < 1) return;
    this.dir.copy(vel).multiplyScalar(1 / sp);
    this.side.set(0, 1, 0).cross(this.dir); if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0); this.side.normalize();
    this.up.copy(this.dir).cross(this.side).normalize();
    if (!this.armed) { for (let i = 0; i < this.n; i++) this.spawn(i, cam, true); this.armed = true; }
    const len = clamp(sp * 0.07, 1, 7);
    const t = this.tmp;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      t.copy(p).sub(cam);
      const along = t.dot(this.dir);
      if (along < -4 || along > 220 || t.lengthSq() > 200 * 200) { this.spawn(i, cam, false); t.copy(p).sub(cam); }
      const k = i * 6;
      this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
      this.pos[k + 3] = p.x - this.dir.x * len; this.pos[k + 4] = p.y - this.dir.y * len; this.pos[k + 5] = p.z - this.dir.z * len;
      // brightest close by, gone by 140 m; the tail fades to nothing so each streak tapers
      const fade = clamp(1 - t.length() / 140, 0, 1) * this.b[i];
      const c = fade * (1 - 0.6 * (night || 0));
      this.col[k] = c; this.col[k + 1] = c; this.col[k + 2] = c * 1.05;
      this.col[k + 3] = 0; this.col[k + 4] = 0; this.col[k + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.mat.opacity = clamp(this.strength, 0, 1) * 0.55;
  };
  SpeedFX.prototype.reset = function () { this.strength = 0; this.armed = false; this.lines.visible = false; };

  /** How strong the speed effects should be: 0 slow or high, 1 fast and on the deck. */
  function speedFeel(kt, agl) {
    const spd = clamp((kt - 70) / 70, 0, 1);
    const prox = clamp((160 - agl) / 140, 0, 1);
    return Math.max(spd * prox, 0.4 * clamp((kt - 120) / 50, 0, 1));   // on the deck, or a fast dive
  }

  window.SpeedFX = SpeedFX;
  window.speedFeel = speedFeel;
})();
