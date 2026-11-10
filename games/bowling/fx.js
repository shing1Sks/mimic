/*
 * Emberlane - impact effects: soft round particles with their own size, colour and life (lacquer
 * flecks and deck dust where pins are struck, a white-hot contact glint, embers on a strike),
 * and the ball track: the darker oil line a ball leaves on the lane, which shows its path and hook.
 */
(function () {
  'use strict';
  const T = THREE;

  const PVERT = `attribute float size; attribute vec4 col; varying vec4 vCol; uniform float scale; uniform float maxPx;
    void main(){ vCol = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(size * scale / -mv.z, 1.0, maxPx); }`;
  // a soft disc; `hard` sharpens it for flecks, embers keep a glowing falloff
  const PFRAG = `varying vec4 vCol; uniform float hard;
    void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
      float a = mix(pow(1.0 - r, 1.6), 1.0 - smoothstep(0.55, 1.0, r), hard);
      gl_FragColor = vec4(vCol.rgb, vCol.a * a); }`;

  function particles(n, additive, hard) {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
    const life = new Float32Array(n), life0 = new Float32Array(n), base = new Float32Array(n * 4), drag = new Float32Array(n), grav = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -50;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('col', new T.BufferAttribute(col, 4));
    geo.setAttribute('size', new T.BufferAttribute(size, 1));
    const mat = new T.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending, uniforms: { scale: { value: 600 }, maxPx: { value: 14 }, hard: { value: hard ? 1 : 0 } } });
    const points = new T.Points(geo, mat);
    points.frustumCulled = false; points.renderOrder = 5;
    let head = 0, live = 0;
    return {
      points, mat,
      /** o: { x, y, z, vx, vy, vz, size, r, g, b, a, life, drag, grav } */
      spawn(o) {
        const i = head; head = (head + 1) % n;
        pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z;
        vel[i * 3] = o.vx || 0; vel[i * 3 + 1] = o.vy || 0; vel[i * 3 + 2] = o.vz || 0;
        base[i * 4] = o.r; base[i * 4 + 1] = o.g; base[i * 4 + 2] = o.b; base[i * 4 + 3] = o.a == null ? 1 : o.a;
        size[i] = o.size; life[i] = life0[i] = o.life; drag[i] = o.drag || 0; grav[i] = o.grav == null ? 9.8 : o.grav;
        live = Math.max(live, 1);
      },
      update(dt) {
        if (!live) return;
        let any = 0;
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          if (life[i] <= 0) { pos[i * 3 + 1] = -50; col[i * 4 + 3] = 0; continue; }
          any = 1;
          const k = Math.exp(-drag[i] * dt);
          vel[i * 3] *= k; vel[i * 3 + 2] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          // flecks land on the deck and skid to a stop
          if (pos[i * 3 + 1] < 0.002 && grav[i] > 0 && Math.abs(pos[i * 3]) < 0.53) { pos[i * 3 + 1] = 0.002; vel[i * 3 + 1] *= -0.25; vel[i * 3] *= 0.6; vel[i * 3 + 2] *= 0.6; }
          const f = life[i] / life0[i], fade = Math.min(1, f * 3);
          col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1]; col[i * 4 + 2] = base[i * 4 + 2]; col[i * 4 + 3] = base[i * 4 + 3] * fade;
        }
        live = any;
        geo.attributes.position.needsUpdate = true; geo.attributes.col.needsUpdate = true; geo.attributes.size.needsUpdate = true;
      },
    };
  }

  /** The ball track: a strip under the ball's path, darker where the ball has rolled, fading out. */
  function track(maxN) {
    const N = maxN || 140;
    const pos = new Float32Array(N * 2 * 3), uv = new Float32Array(N * 2 * 2), age = new Float32Array(N * 2);
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setAttribute('age', new T.BufferAttribute(age, 1));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { now: { value: 0 }, fadeS: { value: 3.2 }, glow: { value: new T.Color(1.6, 0.62, 0.22) } },
      vertexShader: `attribute float age; varying vec2 vUv; varying float vAge; uniform float now;
        void main(){ vUv = uv; vAge = now - age; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // a dark oiled core with a faint warm sheen at its edge, fading with age (strong: the lit lane is
      // far above white before tone mapping, so a light touch vanishes)
      fragmentShader: `varying vec2 vUv; varying float vAge; uniform float fadeS; uniform vec3 glow;
        void main(){ float x = abs(vUv.x - 0.5) * 2.0; float core = 1.0 - smoothstep(0.15, 1.0, x);
          float t = clamp(vAge / fadeS, 0.0, 1.0); float a = core * (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.08, vAge + 0.02);
          float edge = smoothstep(0.35, 0.75, x) * (1.0 - smoothstep(0.75, 1.0, x));
          vec3 c = mix(vec3(0.02, 0.01, 0.0), glow, edge * 0.55);
          gl_FragColor = vec4(c, a * mix(0.55, 0.6, edge)); }`,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    let n = 0, last = null;
    const W = 0.055;
    return {
      mesh, mat,
      clear() { n = 0; last = null; geo.setDrawRange(0, 0); },
      /** add the ball's lane contact at (x, z) at time t; dir from the previous point */
      add(x, z, t) {
        if (last && Math.hypot(x - last.x, z - last.z) < 0.12) return;
        if (n >= N) return;
        const dx = last ? x - last.x : 0, dz = last ? z - last.z : -1, l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l * W, nz = dx / l * W;
        const i = n * 2;
        pos.set([x - nx, 0.0012, z - nz, x + nx, 0.0012, z + nz], i * 3);
        uv.set([0, n, 1, n], i * 2);
        age[i] = age[i + 1] = t;
        n++; last = { x, z };
        geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.age.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
      },
    };
  }

  window.BW = window.BW || {};
  window.BW.FX = { particles, track };
})();
