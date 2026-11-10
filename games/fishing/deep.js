/*
 * Tidecast: Depths - the world under the surface. A drop-off around the cast: a sunlit reef shelf
 * with coral, a kelp forest over a wreck, the blue-black twilight with jellies, and the abyss
 * floor. Light, fog and colour follow the depth; god rays and caustics near the top, marine snow
 * everywhere, plankton and the lure's lamp in the dark. Fish are bold procedural models whose
 * bodies swim with a travelling wave (a vertex shader), one material per fish for its own phase.
 */
(function () {
  'use strict';
  const T = THREE, DZ = TideDepths;
  const col = c => new T.Color(c);
  const rnd = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  const glowTex = canvasTex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });

  // ------------------------------------------------------------------ fish models
  function skin(look) {
    return canvasTex(256, 128, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const t = Math.abs(y / h - 0.5) * 2;
        const c = t < 0.45 ? col(look.belly).lerp(col(look.side), t / 0.45) : col(look.side).lerp(col(look.back), Math.min(1, (t - 0.45) / 0.45));
        g.fillStyle = '#' + c.getHexString(T.SRGBColorSpace); g.fillRect(0, y, w, 1);
      }
      g.globalAlpha = 0.55; g.fillStyle = look.back; g.strokeStyle = look.back;
      let s = look.back.length * 977 + look.side.charCodeAt(2);
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      if (look.mark === 'bars') for (let i = 0; i < 6; i++) { const x = w * (0.22 + i * 0.11); g.fillRect(x, 0, w * 0.04, h * 0.32); g.fillRect(x, h * 0.68, w * 0.04, h * 0.32); }
      if (look.mark === 'stripes') { g.lineWidth = 3; [0.3, 0.38, 0.62, 0.7].forEach(v => { g.beginPath(); g.moveTo(w * 0.15, h * v); g.lineTo(w * 0.95, h * v); g.stroke(); }); }
      if (look.mark === 'waves') { g.lineWidth = 3; for (let k = 0; k < 9; k++) for (const top of [true, false]) { g.beginPath(); for (let x = w * 0.2; x < w; x += 4) { const y = top ? h * (0.06 + k * 0.025) : h * (0.94 - k * 0.025); g.lineTo(x, y + Math.sin(x * 0.12 + k) * 4); } g.stroke(); } }
      if (look.mark === 'spots' || look.mark === 'speckle') {
        const n = look.mark === 'spots' ? 70 : 220, rad = look.mark === 'spots' ? 3.5 : 1.6;
        for (let i = 0; i < n; i++) { const y = r() < 0.5 ? r() * h * 0.4 : h - r() * h * 0.4; g.beginPath(); g.arc(w * (0.1 + r() * 0.85), y, rad * (0.6 + r()), 0, Math.PI * 2); g.fill(); }
      }
      if (look.mark === 'scales') { g.globalAlpha = 0.2; g.strokeStyle = '#ffffff'; g.lineWidth = 1; for (let x = 20; x < w; x += 9) for (let y = 4; y < h; y += 7) { g.beginPath(); g.arc(x + (y % 14 ? 4 : 0), y, 4, 0.3, Math.PI - 0.3); g.stroke(); } }
      g.globalAlpha = 0.35; g.lineWidth = 2;
      g.beginPath(); g.moveTo(w * 0.17, h * 0.2); g.quadraticCurveTo(w * 0.21, h * 0.5, w * 0.17, h * 0.8); g.stroke();
    });
  }
  /** A body of revolution along z (nose -0.5 .. tail +0.5): prof(u) -> radius factor, h/w the section. */
  function bodyGeo(prof, h, w, nu, nv) {
    nu = nu || 30; nv = nv || 18;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, p = prof(u), hh = h * p * 0.5, ww = w * p * 0.5;
      for (let j = 0; j <= nv; j++) {
        const a = j / nv * Math.PI * 2;
        let y = Math.cos(a) * hh; const x = Math.sin(a) * ww;
        if (y < 0) y *= 1.1;
        pos.push(x, y, -0.5 + u); uv.push(u, j / nv);
      }
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const shapeGeo = pts => { const s = new T.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => s.lineTo(p[0], p[1])); return new T.ShapeGeometry(s); };
  const PROF = {
    fish: u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.85) * (1 - 0.74 * u) + 0.025,
    puffer: u => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7) * (u < 0.85 ? 1 : 0.4) + 0.03,
    eel: u => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.35) * (1 - 0.6 * u) + 0.03,
    pike: u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.7) * (1 - 0.55 * u) + 0.02,
    gulper: u => (u < 0.45 ? Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.5) * 0.5 + 0.2), 0.6) : Math.max(0.05, 1 - (u - 0.45) * 1.7)) + 0.02,
    angler: u => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.55) * (1 - 0.5 * u) + 0.03,
    ray: u => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * (u < 0.87 ? 1 : 0.15) + 0.02,
    squid: u => (u < 0.7 ? Math.pow(Math.sin(Math.PI * (u / 0.7) * 0.5 + 0.08), 0.9) : 0.95) * 0.9 + 0.02,
  };
  const cache = {};
  function parts(sp) {
    if (cache[sp.id]) return cache[sp.id];
    const look = sp.look, shape = sp.shape, H = look.h;
    const prof = PROF[shape] || PROF.fish;
    const geo = bodyGeo(prof, H, look.w, shape === 'eel' ? 60 : 30);
    const map = skin(look);
    const fin = new T.MeshStandardMaterial({ color: col(look.fin), roughness: 0.5, side: T.DoubleSide, emissive: sp.glow ? col(look.fin) : 0x000000, emissiveIntensity: sp.glow ? 0.25 : 0 });
    const tail = shape === 'ray' || shape === 'squid' ? null : shape === 'eel' ? shapeGeo([[0, 0.06], [0.1, 0], [0, -0.06]]) : shape === 'puffer' || shape === 'angler' || shape === 'gulper'
      ? shapeGeo([[0, 0.05], [0.12, 0.32 * H], [0.16, 0], [0.12, -0.32 * H], [0, -0.05]])
      : shapeGeo([[0, 0.04 * H / 0.3], [0.2, 0.55 * H], [0.13, 0], [0.2, -0.55 * H], [0, -0.04 * H / 0.3]]);
    const dorsal = shape === 'scorpion' ? null : shape === 'eel' ? null : shapeGeo([[0, 0], [0.06, 0.32 * H], [0.26, 0.26 * H], [0.36, 0]]);
    cache[sp.id] = { geo, map, fin, tail, dorsal, pect: shapeGeo([[0, 0], [0.1, 0.05], [0.12, -0.03]]) };
    return cache[sp.id];
  }
  const eyeMat = new T.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.1, metalness: 0.4 });
  const ringMat = new T.MeshStandardMaterial({ color: 0xf2d27a, roughness: 0.3, metalness: 0.5 });
  const toothMat = new T.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.4 });
  const glowBulb = new T.MeshBasicMaterial({ color: 0xc8fff4 });
  const cyl = new T.CylinderGeometry(1, 1, 1, 8);

  /** A body material that swims: a travelling wave pushes the body sideways, more toward the tail. */
  function waveMat(base, u) {
    const m = base.clone();
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'uniform float uT, uAmp, uFreq;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float kk = clamp(position.z + 0.5, 0.0, 1.0); transformed.x += sin(position.z * uFreq - uT) * uAmp * (0.25 + kk * kk);');
    };
    m.customProgramCacheKey = () => 'tide-wave';
    return m;
  }

  /**
   * A fish model, 1 m long along -Z (nose at -0.5); scale by its length. opts.simple: body and
   * tail only (small schooling fish). Returns a Group with .swim(t, speed) to animate it.
   */
  function makeFish(sp, opts) {
    opts = opts || {};
    const P = parts(sp), g = new T.Group(), look = sp.look, H = look.h, W = look.w;
    const u = { uT: { value: Math.random() * 6 }, uAmp: { value: sp.shape === 'eel' ? 0.07 : sp.shape === 'ray' ? 0 : 0.035 }, uFreq: { value: sp.shape === 'eel' ? 12 : 6 } };
    const bodyMat = waveMat(new T.MeshStandardMaterial({ map: P.map, roughness: sp.shape === 'squid' ? 0.2 : 0.34, metalness: 0.25,
      transparent: sp.shape === 'squid', opacity: sp.shape === 'squid' ? 0.75 : 1, emissive: sp.glow ? col(look.side) : 0x000000, emissiveIntensity: sp.glow ? 0.55 : 0 }), u);
    const body = new T.Mesh(P.geo, bodyMat); g.add(body);
    const tailG = new T.Group(); tailG.position.z = 0.44; g.add(tailG);
    if (P.tail) { const tl = new T.Mesh(P.tail, P.fin); tl.rotation.y = -Math.PI / 2; tailG.add(tl); }
    if (sp.shape === 'ray') { const whip = new T.Mesh(cyl, P.fin); whip.scale.set(0.012, 0.9, 0.012); whip.rotation.x = Math.PI / 2; whip.position.z = 0.4; tailG.add(whip); }
    const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    // eyes (big and gold-ringed: the face is what you remember)
    const eyeR = sp.shape === 'puffer' ? 0.06 : sp.shape === 'gulper' ? 0.02 : sp.shape === 'ray' ? 0.012 : 0.024 + H * 0.02;
    [-1, 1].forEach(s => {
      const ex = s * W * (sp.shape === 'ray' ? 0.08 : 0.34), ey = sp.shape === 'ray' ? H * 0.6 : H * 0.14, ez = sp.shape === 'squid' ? -0.18 : -0.38;
      add(new T.Mesh(new T.SphereGeometry(eyeR * 1.25, 10, 8), ringMat), ex * 0.98, ey, ez + 0.005).scale.z = 0.5;
      add(new T.Mesh(new T.SphereGeometry(eyeR, 10, 8), eyeMat), ex, ey, ez);
    });
    if (sp.glow) {   // things that make their own light: a soft halo the haze cannot swallow
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col(sp.shape === 'lantern' ? '#7ad8ff' : sp.shape === 'squid' ? '#b0f0ff' : '#9effe6'), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.55, fog: false }));
      halo.scale.setScalar(sp.shape === 'lantern' ? 1.6 : 1.1); g.add(halo);
    }
    if (opts.simple) { g.userData = { tail: tailG, u, sp }; g.swim = swimFn; return g; }
    if (P.dorsal) { const d = new T.Mesh(P.dorsal, P.fin); d.rotation.y = -Math.PI / 2; d.position.set(0, H * 0.42, sp.shape === 'pike' ? 0.08 : -0.18); g.add(d); }
    if (sp.shape !== 'ray' && sp.shape !== 'squid') [-1, 1].forEach(s => { const p = new T.Mesh(P.pect, P.fin); p.position.set(s * W * 0.45, -H * 0.12, -0.28); p.rotation.set(0, s > 0 ? -2.4 : -0.7, s * 0.4); if (sp.shape === 'scorpion') p.scale.setScalar(2.2); g.add(p); });
    if (sp.shape === 'scorpion') for (let i = 0; i < 7; i++) { const sp2 = new T.Mesh(new T.ConeGeometry(0.012, 0.16 + Math.sin(i) * 0.04, 5), P.fin); sp2.position.set(0, H * 0.45, -0.25 + i * 0.07); sp2.rotation.x = 0.25; g.add(sp2); }
    if (sp.shape === 'puffer') {
      const spikes = new T.Group();
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), n = new T.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
        const c = new T.Mesh(new T.ConeGeometry(0.012, 0.07, 4), P.fin);
        c.position.copy(n).multiply(new T.Vector3(W * 0.5, H * 0.5, 0.45)); c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n); spikes.add(c);
      }
      spikes.scale.setScalar(0.3); g.add(spikes); g.userData.spikes = spikes;
    }
    if (sp.shape === 'eel') {
      const rib = new T.Mesh(new T.PlaneGeometry(0.035, 0.85, 1, 30), waveMat(P.fin, u));
      rib.geometry.rotateX(Math.PI / 2); rib.geometry.rotateZ(Math.PI / 2); rib.position.set(0, H * 0.45, 0.05); g.add(rib);
    }
    if (sp.shape === 'gulper' || sp.shape === 'angler') {
      const jaw = new T.Mesh(new T.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bodyMat);
      jaw.scale.set(W * 0.48, H * 0.45, 0.22); jaw.position.set(0, -H * 0.05, -0.32); jaw.rotation.x = 0.5; g.add(jaw); g.userData.jaw = jaw;
      for (let i = 0; i < 12; i++) {
        const a = (i / 11 - 0.5) * 2.4, tth = new T.Mesh(new T.ConeGeometry(0.012, 0.06 + (i % 3) * 0.02, 4), toothMat);
        tth.position.set(Math.sin(a) * W * 0.42, (i % 2 ? 0.02 : -0.02) * H * 4, -0.48 + Math.abs(Math.sin(a)) * 0.08); tth.rotation.x = i % 2 ? Math.PI : 0; g.add(tth);
      }
    }
    if (sp.shape === 'angler') {
      const stalk = new T.Mesh(cyl, P.fin); stalk.scale.set(0.008, 0.32, 0.008); stalk.position.set(0, H * 0.55, -0.32); stalk.rotation.x = -0.7; g.add(stalk);
      const bulb = new T.Mesh(new T.SphereGeometry(0.035, 10, 8), glowBulb); bulb.position.set(0, H * 0.62, -0.52); g.add(bulb);
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0x9effe6, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); halo.scale.setScalar(1.4); bulb.add(halo);
    }
    if (sp.shape === 'squid') {
      const tent = [];
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, t = new T.Mesh(new T.ConeGeometry(0.015, 0.5, 5), bodyMat);
        t.geometry.translate(0, -0.25, 0); t.rotation.x = -Math.PI / 2; t.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.45); g.add(t); tent.push(t);
      }
      [-1, 1].forEach(s => { const f = new T.Mesh(shapeGeo([[0, 0], [0.12, 0.08], [0.18, 0]]), P.fin); f.rotation.set(0, s * Math.PI / 2, 0); f.position.set(s * 0.06, 0, 0.32); g.add(f); });
      g.userData.tent = tent;
    }
    if (sp.shape === 'lantern') for (let i = 0; i < 6; i++) add(new T.Mesh(new T.SphereGeometry(0.018, 6, 4), glowBulb), (i % 2 ? 1 : -1) * W * 0.3, -H * 0.3, -0.3 + i * 0.1);
    if (sp.shape === 'grouper') { const lip = new T.Mesh(new T.TorusGeometry(0.06, 0.025, 6, 12), bodyMat); lip.position.set(0, -0.01, -0.49); g.add(lip); }
    g.userData = Object.assign(g.userData, { tail: tailG, u, sp });
    g.swim = swimFn;
    return g;
  }
  /** Animate: t seconds, speed 0..~3 (faster beats when swimming hard). */
  function swimFn(dt, speed) {
    const d = this.userData, u = d.u;
    u.uT.value += dt * (4 + speed * 5);
    d.tail.rotation.y = Math.cos(0.5 * u.uFreq.value - u.uT.value) * (0.25 + Math.min(0.35, speed * 0.12));
    if (d.tent) d.tent.forEach((t, i) => { t.rotation.y = Math.sin(u.uT.value * 0.7 + i) * 0.25; });
    if (d.jaw) d.jaw.rotation.x = 0.35 + Math.sin(u.uT.value * 0.3) * 0.15;
  }

  // ------------------------------------------------------------------ the world below
  function create(W) {
    const scene = W.scene;
    const root = new T.Group(); root.visible = false; scene.add(root);
    const env = new T.Group(); root.add(env);
    const time = { v: 0 };
    // caustics + depth tint injected into the rock materials
    const causticU = { uTime: time && { value: 0 } };
    function withCaustics(mat) {
      mat.onBeforeCompile = sh => {
        sh.uniforms.uTime = causticU.uTime;
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'uniform float uTime; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `
          vec2 cp = vWp.xz * 1.1 + vec2(vWp.y * 0.6, -vWp.y * 0.4);
          float c1 = sin(cp.x * 2.3 + uTime * 1.3 + sin(cp.y * 1.7 + uTime * 0.7)) + sin(cp.y * 2.1 - uTime * 1.1 + sin(cp.x * 1.9 - uTime * 0.6));
          float c2 = sin((cp.x - cp.y) * 3.3 + uTime * 1.7) + sin((cp.x + cp.y) * 2.9 - uTime * 1.2);
          float caus = pow(clamp(1.0 - abs(c1) * 0.6, 0.0, 1.0), 8.0) + pow(clamp(1.0 - abs(c2) * 0.6, 0.0, 1.0), 8.0) * 0.6;
          gl_FragColor.rgb += vec3(0.6, 0.9, 0.95) * caus * 0.28 * exp(vWp.y * 0.11);
          #include <fog_fragment>`);
      };
      mat.customProgramCacheKey = () => 'tide-caustic';
      return mat;
    }

    // the drop-off: a noisy rock shaft, wide on the reef, closing over the kelp, falling away into the dark
    const R = d => d < 20 ? 30 : d < 60 ? 30 - (d - 20) * 0.15 : d < 200 ? 24 + (d - 60) * 0.1 : 38;
    const wallGeo = new T.CylinderGeometry(1, 1, DZ.FLOOR + 10, 72, 120, true);
    {
      const pos = wallGeo.attributes.position, cols = [];
      const zc = { reef: col('#c9a77a'), reef2: col('#6ab0a0'), kelp: col('#4a5a3a'), twi: col('#2a3a56'), aby: col('#14161e') };
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), yl = pos.getY(i), y = yl - (DZ.FLOOR + 10) / 2, d = -y;
        const a = Math.atan2(z, x);
        const n = Math.sin(a * 7 + d * 0.13) * 1.6 + Math.sin(a * 17 - d * 0.31) * 0.7 + Math.sin(d * 0.07 + a * 3) * 2.2;
        const r = R(d) + n;
        pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
        let c = d < 20 ? zc.reef.clone().lerp(zc.reef2, 0.5 + 0.5 * Math.sin(a * 5 + d)) : d < 60 ? zc.kelp.clone() : d < 200 ? zc.twi.clone() : zc.aby.clone();
        c.multiplyScalar(0.85 + 0.3 * Math.max(0, Math.sin(a * 11 + d * 0.5)));
        cols.push(c.r, c.g, c.b);
      }
      wallGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      wallGeo.computeVertexNormals();
    }
    const wall = new T.Mesh(wallGeo, withCaustics(new T.MeshLambertMaterial({ vertexColors: true, side: T.BackSide })));
    env.add(wall);
    // shelves: the reef floor at 18-20 m and the kelp bed at ~58 m, as rings round the shaft
    function shelf(d, r0, r1, c) {
      const g = new T.RingGeometry(r0, r1, 64, 3); g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, -d + Math.sin(pos.getX(i) * 0.4) * Math.cos(pos.getZ(i) * 0.37) * 0.8 + (Math.hypot(pos.getX(i), pos.getZ(i)) - r0) * 0.12);
      g.computeVertexNormals();
      const m = new T.Mesh(g, withCaustics(new T.MeshLambertMaterial({ color: c }))); env.add(m); return m;
    }
    shelf(19, 13, 31, 0xcab48a);
    shelf(58, 9, 27, 0x3a4a30);
    const floor = new T.Mesh(new T.CircleGeometry(44, 40), new T.MeshLambertMaterial({ color: 0x15171c })); floor.rotation.x = -Math.PI / 2; floor.position.y = -DZ.FLOOR; env.add(floor);

    const covers = [];
    const pol = (r0, r1, d) => { const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0); return new T.Vector3(Math.cos(a) * r, -d, Math.sin(a) * r); };
    const reefTmp = new T.Group();
    // reef: branching coral, brain coral, lattice fans, tube sponges, anemones, starfish, sea grass
    const coralCols = [0xff6a5a, 0xffa23a, 0xc85ad8, 0xf4d84a, 0x4ad8b8, 0xff4f86, 0x6a8aff];
    const fanTex = canvasTex(128, 64, (g, w, h) => {
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      for (let i = 0; i < 18; i++) { const a = Math.PI * (i / 17); g.beginPath(); g.moveTo(w / 2, h); g.quadraticCurveTo(w / 2 + Math.cos(a) * w * 0.25, h - Math.sin(a) * h * 0.5, w / 2 + Math.cos(a) * w * 0.5, h - Math.sin(a) * h); g.stroke(); }
      g.lineWidth = 1; for (let r = 8; r < h; r += 7) { g.beginPath(); g.arc(w / 2, h, r, Math.PI, 0); g.stroke(); }
    });
    const brainTex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
      for (let i = 0; i < 26; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    });
    const coralMat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.12 });
    function branch(g, m, from, dir, len, rad, depthLeft) {
      const to = from.clone().addScaledVector(dir, len);
      const b = new T.Mesh(new T.CylinderGeometry(rad * 0.6, rad, 1, 6), m);
      b.position.copy(from).lerp(to, 0.5); b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); b.scale.y = len; g.add(b);
      if (depthLeft <= 0) { const tip = new T.Mesh(new T.SphereGeometry(rad * 0.8, 6, 4), m); tip.position.copy(to); g.add(tip); return; }
      for (let k = 0; k < 3; k++) {
        const d2 = dir.clone().add(new T.Vector3((rnd() - 0.5) * 1.3, 0.2 + rnd() * 0.4, (rnd() - 0.5) * 1.3)).normalize();
        branch(g, m, to, d2, len * (0.6 + rnd() * 0.2), rad * 0.65, depthLeft - 1);
      }
    }
    function coralAt(p, kind, c) {
      const g = new T.Group(); g.position.copy(p); g.rotation.y = rnd() * 6;
      const m = coralMat(c);
      if (kind === 0) branch(g, m, new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), 0.5 + rnd() * 0.4, 0.07, 2);
      else if (kind === 1) {
        const geo = new T.SphereGeometry(0.5 + rnd() * 0.6, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) { const v = new T.Vector3().fromBufferAttribute(pos, i); v.multiplyScalar(1 + Math.sin(v.x * 9) * Math.cos(v.z * 8) * 0.06); pos.setXYZ(i, v.x, v.y, v.z); }
        geo.computeVertexNormals();
        const b = new T.Mesh(geo, new T.MeshStandardMaterial({ color: c, map: brainTex, roughness: 0.9 })); b.position.y = -0.15; g.add(b);
      } else if (kind === 2) {
        const f = new T.Mesh(new T.CircleGeometry(0.8 + rnd() * 0.7, 20, 0, Math.PI), new T.MeshStandardMaterial({ color: c, map: fanTex, alphaTest: 0.4, transparent: false, side: T.DoubleSide, roughness: 0.9, emissive: c, emissiveIntensity: 0.15 }));
        g.add(f);
      } else if (kind === 3) {
        for (let k = 0; k < 4; k++) {
          const hgt = 0.6 + rnd() * 1, r = 0.1 + rnd() * 0.1;
          const t = new T.Mesh(new T.CylinderGeometry(r, r * 0.85, hgt, 10, 1, true), new T.MeshStandardMaterial({ color: c, roughness: 0.9, side: T.DoubleSide }));
          t.position.set((rnd() - 0.5) * 0.5, hgt / 2, (rnd() - 0.5) * 0.5); t.rotation.set((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3); g.add(t);
          const lip = new T.Mesh(new T.TorusGeometry(r, 0.02, 4, 10), m); lip.rotation.x = Math.PI / 2; lip.position.copy(t.position); lip.position.y += hgt / 2; g.add(lip);
        }
      } else if (kind === 4) {
        const base = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.25, 10), m); base.position.y = 0.12; g.add(base);
        for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2, t = new T.Mesh(new T.ConeGeometry(0.025, 0.45, 4), coralMat(0xffd0f0)); t.position.set(Math.cos(a) * 0.12, 0.42, Math.sin(a) * 0.12); t.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); g.add(t); }
      } else if (kind === 5) {
        const s = new T.Shape(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, r = k % 2 ? 0.08 : 0.24; k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(r, 0); }
        const st = new T.Mesh(new T.ShapeGeometry(s), coralMat(0xff7a3a)); st.rotation.x = -Math.PI / 2; st.position.y = 0.03; g.add(st);
      } else {
        for (let k = 0; k < 9; k++) { const hgt = 0.4 + rnd() * 0.7, bl = new T.Mesh(new T.PlaneGeometry(0.06, hgt), new T.MeshStandardMaterial({ color: 0x5aa04a, side: T.DoubleSide })); bl.position.set((rnd() - 0.5) * 0.6, hgt / 2, (rnd() - 0.5) * 0.6); bl.rotation.set((rnd() - 0.5) * 0.4, rnd() * 3, 0); g.add(bl); }
      }
      reefTmp.add(g);
      return g;
    }
    for (let i = 0; i < 140; i++) {
      const near = i < 80, p = pol(near ? 13 : 18, near ? 20 : 29, 18.7), kind = i % 7;
      coralAt(p, kind, coralCols[(i * 3) % coralCols.length]);
      if (kind <= 3 && i % 2 === 0) covers.push({ x: p.x, y: p.y + 0.5, z: p.z, r: 1.2, kind: 'coral' });
    }
    // and on the reef wall itself
    for (let i = 0; i < 50; i++) {
      const d = 3 + rnd() * 15, a = rnd() * Math.PI * 2, r = R(d) - 0.6;
      const g = coralAt(new T.Vector3(Math.cos(a) * r, -d, Math.sin(a) * r), [1, 2, 3, 4][i % 4], coralCols[i % coralCols.length]);
      g.lookAt(0, -d, 0); g.rotateX(Math.PI / 2);
    }
    // one draw call for all the plain-coloured reef pieces: bake them into a single vertex-coloured mesh
    function bake(group) {
      group.updateMatrixWorld(true);
      const pos = [], nor = [], colr = [], idx = [], keep = [];
      group.traverse(o => {
        if (!o.isMesh) return;
        if (o.material.map) { keep.push(o); return; }
        const g = o.geometry.index ? o.geometry : o.geometry.clone().setIndex([...Array(o.geometry.attributes.position.count).keys()]);
        const off = pos.length / 3, P = g.attributes.position, N = g.attributes.normal, c = o.material.color;
        const nm = new T.Matrix3().getNormalMatrix(o.matrixWorld), v = new T.Vector3();
        for (let k = 0; k < P.count; k++) {
          v.fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
          v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
          colr.push(c.r, c.g, c.b);
        }
        for (const k of g.index.array) idx.push(k + off);
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
      geo.setIndex(idx);
      env.add(new T.Mesh(geo, withCaustics(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, emissive: 0x222222 }))));
      for (const o of keep) { const m = o.clone(); o.matrixWorld.decompose(m.position, m.quaternion, m.scale); env.add(m); }
    }
    bake(reefTmp);
    // reef cracks for eels: dark holes in the wall
    // kelp: tall ribbons rising from the kelp bed, swaying (vertex shader)
    const kelpU = { uTime: causticU.uTime };
    const kelpTex = canvasTex(64, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c8a24a'); gr.addColorStop(0.5, '#7a8a3a'); gr.addColorStop(1, '#3a5a26');
      g.fillStyle = gr; g.fillRect(w / 2 - 2, 0, 4, h);
      for (let y = 10; y < h; y += 22) for (const s of [-1, 1]) {
        g.save(); g.translate(w / 2, y + (s > 0 ? 11 : 0)); g.rotate(s * 0.5); g.beginPath(); g.ellipse(s * 14, 0, 15, 6, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    });
    const kelpMat = new T.MeshLambertMaterial({ map: kelpTex, alphaTest: 0.5, side: T.DoubleSide });
    kelpMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = kelpU.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float hk = position.y / 32.0; vec4 wp = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        transformed.x += sin(uTime * 0.7 + wp.x * 0.3 + position.y * 0.12) * hk * hk * 2.2;
        transformed.z += cos(uTime * 0.5 + wp.z * 0.3 + position.y * 0.1) * hk * hk * 1.6;`);
    };
    kelpMat.customProgramCacheKey = () => 'tide-kelp';
    for (let i = 0; i < 46; i++) {
      const h = 22 + rnd() * 12, g = new T.PlaneGeometry(1.4 + rnd() * 0.5, h, 1, 16); g.translate(0, h / 2, 0);
      const p = pol(10, 26, 57.5), m = new T.Mesh(g, kelpMat);
      m.position.copy(p); m.rotation.y = rnd() * 3; env.add(m);
      const m2 = new T.Mesh(g, kelpMat); m2.position.copy(p); m2.rotation.y = m.rotation.y + Math.PI / 2; env.add(m2);
      for (let y = 4; y < h; y += 6) covers.push({ x: p.x, y: p.y + y, z: p.z, r: 1.4, kind: 'kelp' });
    }
    // rocks on both shelves
    const rockMat = withCaustics(new T.MeshLambertMaterial({ color: 0x5a564e, flatShading: true }));
    for (let i = 0; i < 26; i++) {
      const d = i % 2 ? 18.8 : 57.6, p = pol(d > 30 ? 10 : 14, d > 30 ? 25 : 29, d), r = 0.8 + rnd() * 1.8;
      const m = new T.Mesh(new T.DodecahedronGeometry(r, 0), rockMat); m.position.copy(p); m.scale.y = 0.6; m.rotation.set(rnd() * 3, rnd() * 3, 0); env.add(m);
      covers.push({ x: p.x, y: p.y + r * 0.4, z: p.z, r: r + 0.5, kind: 'rock' });
    }
    // the wreck on the kelp bed: a broken hull and a leaning mast
    const wreck = new T.Group(), wood = withCaustics(new T.MeshLambertMaterial({ color: 0x4a3a2a }));
    const hull = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 13, 12, 1, true, 0, Math.PI * 1.3), new T.MeshLambertMaterial({ color: 0x4a3a2a, side: T.DoubleSide }));
    hull.rotation.z = Math.PI / 2; hull.rotation.x = 0.4; wreck.add(hull);
    const mast = new T.Mesh(cyl, wood); mast.scale.set(0.18, 12, 0.18); mast.position.set(1, 5, 0); mast.rotation.z = 0.5; wreck.add(mast);
    const yard = new T.Mesh(cyl, wood); yard.scale.set(0.1, 5, 0.1); yard.position.set(3.4, 9, 0); yard.rotation.z = Math.PI / 2 + 0.5; wreck.add(yard);
    wreck.position.set(-15, -56.5, 6); wreck.rotation.y = 0.8; env.add(wreck);
    for (let k = -2; k <= 2; k++) covers.push({ x: -15 + k * 2.2, y: -55, z: 6 + k * 1.8, r: 2.5, kind: 'wreck' });
    // twilight jellies: glowing bells trailing threads
    const jellies = [];
    for (let i = 0; i < 40; i++) {
      const g = new T.Group(), c = [0x7af0ff, 0xd08aff, 0x8affc0][i % 3];
      const bell = new T.Mesh(new T.SphereGeometry(0.6 + rnd() * 0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthWrite: false }));
      g.add(bell);
      for (let k = 0; k < 7; k++) { const t = new T.Mesh(cyl, new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false })); t.scale.set(0.015, 2 + rnd() * 2, 0.015); t.position.set(Math.cos(k) * 0.35, -1.4, Math.sin(k) * 0.35); g.add(t); }
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.6 })); halo.scale.setScalar(3); g.add(halo);
      g.position.copy(pol(4, 20, 70 + rnd() * 120)); g.userData.ph = rnd() * 6; env.add(g); jellies.push(g);
    }
    // abyss: vents and tube worms glowing on the floor
    for (let i = 0; i < 24; i++) {
      const p = pol(2, 30, DZ.FLOOR - 0.2), c = i % 3 ? 0xff5040 : 0x60ffd0;
      const t = new T.Mesh(cyl, new T.MeshBasicMaterial({ color: c })); t.scale.set(0.08, 0.8 + rnd(), 0.08); t.position.copy(p); t.position.y += 0.5; env.add(t);
      const h = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.7 })); h.scale.setScalar(1.6); h.position.copy(t.position); h.position.y += 0.5; env.add(h);
    }

    // the surface seen from below: a bright rippling ceiling
    const ceiling = new T.Mesh(new T.PlaneGeometry(400, 400), new T.ShaderMaterial({
      side: T.BackSide, transparent: true, depthWrite: false, uniforms: { uTime: causticU.uTime, uC: { value: col('#bff4ff') } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uC; varying vec3 vW;
        void main(){ float r = sin(vW.x*0.9+uTime*1.4)*sin(vW.z*1.1-uTime*1.1)+sin((vW.x-vW.z)*0.6+uTime);
          float d = length(vW.xz - cameraPosition.xz); float win = smoothstep(cameraPosition.y * -1.8 + 10.0, 0.0, d);
          gl_FragColor = vec4(uC * (0.55 + 0.3 * r) , 0.35 + 0.5 * win); }`,
    }));
    ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = -0.05; root.add(ceiling);
    // god rays: tall soft shafts hanging from the surface around the camera
    const rayTex = canvasTex(32, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,240,0.55)'); gr.addColorStop(1, 'rgba(255,255,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h); });
    const rays = [];
    for (let i = 0; i < 9; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(2 + rnd() * 3, 34), new T.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.25, side: T.DoubleSide, fog: false }));
      m.userData = { ox: (rnd() - 0.5) * 30, oz: (rnd() - 0.5) * 30, ph: rnd() * 6 };
      root.add(m); rays.push(m);
    }
    // marine snow around the camera (wraps in a box that travels with it)
    const NS = 900, snowPos = new Float32Array(NS * 3);
    for (let i = 0; i < NS * 3; i++) snowPos[i] = (rnd() - 0.5) * 36;
    const snowGeo = new T.BufferGeometry(); snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    const snowMat = new T.PointsMaterial({ size: 0.06, map: glowTex, color: 0xdff6ff, transparent: true, depthWrite: false, opacity: 0.6 });
    const snow = new T.Points(snowGeo, snowMat); snow.frustumCulled = false; root.add(snow);
    const plankMat = new T.PointsMaterial({ size: 0.26, map: glowTex, color: 0x6affe0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 });
    const plank = new T.Points(snowGeo, plankMat); plank.frustumCulled = false; root.add(plank);
    // bubbles
    const NB = 160, bPos = new Float32Array(NB * 3), bVel = new Float32Array(NB), bLife = new Float32Array(NB);
    const bGeo = new T.BufferGeometry(); bGeo.setAttribute('position', new T.BufferAttribute(bPos, 3));
    const bubbles = new T.Points(bGeo, new T.PointsMaterial({ size: 0.09, map: glowTex, color: 0xe8fbff, transparent: true, depthWrite: false })); bubbles.frustumCulled = false; root.add(bubbles);
    for (let i = 0; i < NB; i++) bPos[i * 3 + 1] = 99;
    let bI = 0;
    function bubble(p, n, spread) {
      for (let k = 0; k < (n || 4); k++) { const i = bI++ % NB; bPos[i * 3] = p.x + (rnd() - 0.5) * (spread || 0.3); bPos[i * 3 + 1] = p.y + (rnd() - 0.5) * (spread || 0.3); bPos[i * 3 + 2] = p.z + (rnd() - 0.5) * (spread || 0.3); bVel[i] = 0.6 + rnd() * 0.8; bLife[i] = 3 + rnd() * 2; }
    }
    // a puff of ink, a cloud of scales: dark or bright billboards that fade
    const puffs = [];
    function puff(p, color, size) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, opacity: 0.9 }));
      s.position.copy(p); s.scale.setScalar(size || 2); root.add(s); puffs.push({ s, t: 0 });
    }

    const tagTex = canvasTex(64, 64, (g, w) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * 0.5, w * 0.95); g.lineTo(w * 0.15, w * 0.4); g.lineTo(w * 0.85, w * 0.4); g.closePath(); g.fill(); });
    // lures: a silver spoon with a lamp
    function makeLure(color) {
      const g = new T.Group();
      const spoon = new T.Mesh(new T.SphereGeometry(0.09, 12, 8), new T.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 0.9, roughness: 0.15, emissive: col(color), emissiveIntensity: 0.25 }));
      spoon.scale.set(0.55, 0.25, 1.2); g.add(spoon);
      const hook = new T.Mesh(new T.TorusGeometry(0.05, 0.008, 6, 10, Math.PI * 1.4), new T.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.8 })); hook.position.z = 0.12; g.add(hook);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: col(color), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.8 })); glow.scale.setScalar(0.9); g.add(glow);
      const lamp = new T.PointLight(0xd8fff4, 0, 10, 1.6); g.add(lamp);
      const tag = new T.Sprite(new T.SpriteMaterial({ map: tagTex, color: col(color), transparent: true, depthWrite: false, depthTest: false, fog: false }));
      tag.position.y = 0.9; tag.scale.setScalar(0.7); tag.renderOrder = 6; tag.visible = false; g.add(tag);
      root.add(g);
      return { g, glow, lamp, tag };
    }
    // the line underwater, with beads every 10 m (depth marks)
    function makeLine(color) {
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      const line = new T.Line(geo, new T.LineBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.85 })); line.frustumCulled = false; root.add(line);
      const beadGeo = new T.BufferGeometry(); beadGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(3 * 40), 3));
      const beads = new T.Points(beadGeo, new T.PointsMaterial({ size: 0.22, map: glowTex, color: col(color), transparent: true, depthWrite: false })); beads.frustumCulled = false; root.add(beads);
      return { line, geo, beads, beadGeo };
    }
    const hot = col('#ff4a2e'), amber = col('#ffb347'), calm = col('#fff6e0');
    function drawLine(L, from, to, tension) {
      const a = L.geo.attributes.position.array; a[0] = from.x; a[1] = from.y; a[2] = from.z; a[3] = to.x; a[4] = to.y; a[5] = to.z;
      L.geo.attributes.position.needsUpdate = true;
      const k = Math.min(1, tension || 0);
      L.line.material.color.copy(calm).lerp(amber, Math.max(0, Math.min(1, (k - 0.55) / 0.3))).lerp(hot, Math.max(0, (k - 0.85) / 0.15));
      const b = L.beadGeo.attributes.position.array, len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      let n = 0;
      for (let m = 10; m < len && n < 40; m += 10, n++) { const s = m / len; b[n * 3] = from.x + (to.x - from.x) * s; b[n * 3 + 1] = from.y + (to.y - from.y) * s; b[n * 3 + 2] = from.z + (to.z - from.z) * s; }
      L.beadGeo.setDrawRange(0, n); L.beadGeo.attributes.position.needsUpdate = true;
    }
    function removeObj(o) { root.remove(o); }

    // ---------------------------------------------------------------- per frame
    const fogC = new T.Color(), tmpA = new T.Color(), tmpB = new T.Color();
    let saved = null;
    /** Switch the scene into the depths (camera below the surface) or back. */
    function setActive(on) {
      if (on === root.visible) return;
      root.visible = on;
      W.setAbove(!on);
      if (on) { saved = { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone(), bg: scene.background }; }
      else if (saved) { scene.fog.near = saved.near; scene.fog.far = saved.far; scene.fog.color.copy(saved.color); scene.background = saved.bg; }
    }
    function center(x, z) { env.position.set(x, 0, z); }
    const cv = new T.Vector3();
    /** depth: where the camera is (m); lampOn: light level 0..; called every frame while active. */
    function update(dt, camDepth, lamp) {
      time.v += dt; causticU.uTime.value = time.v;
      if (!root.visible) return;
      const zm = DZ.zoneMix(camDepth);
      tmpA.set(zm.a.fog); tmpB.set(zm.b.fog); fogC.copy(tmpA).lerp(tmpB, zm.k);
      fogC.multiplyScalar(0.35 + 0.65 * Math.min(1, zm.light * 1.6 + 0.05));
      scene.fog.color.copy(fogC);
      scene.background = fogC;
      scene.fog.near = 1;
      scene.fog.far = Math.max(9, 1.0 / zm.density) * (camDepth > 60 ? 0.8 + (lamp || 0) * 0.02 : 1);
      W.lights.hemi.color.set(0x9fe8ff).multiplyScalar(0.3 + zm.light);
      W.lights.hemi.groundColor.copy(fogC);
      W.lights.hemi.intensity = 0.25 + zm.light * 0.9;
      W.lights.sun.intensity = zm.light * 0.9;
      W.lights.sun.color.set(0xbff4ff);
      W.lights.fill.intensity = 0.05;
      const cam = W.camera.position;
      rays.forEach((m, i) => {
        const u = m.userData; m.position.set(cam.x + u.ox, -15, cam.z + u.oz); m.lookAt(cam.x, -15, cam.z);
        m.material.opacity = Math.max(0, 0.22 - camDepth * 0.008) * (0.6 + 0.4 * Math.sin(time.v * 0.4 + u.ph));
      });
      // snow and plankton wrap around the camera
      snow.position.set(Math.floor(cam.x / 36) * 36, Math.floor(cam.y / 36) * 36, Math.floor(cam.z / 36) * 36);
      plank.position.copy(snow.position);
      const pa = snowGeo.attributes.position.array;
      for (let i = 0; i < NS; i++) { pa[i * 3 + 1] -= dt * 0.08; if (pa[i * 3 + 1] < -18) pa[i * 3 + 1] += 36; }
      snowGeo.attributes.position.needsUpdate = true;
      snowMat.color.set(camDepth > 60 ? 0x5a7090 : 0xdff6ff); snowMat.opacity = camDepth > 200 ? 0.25 : 0.55;
      plankMat.opacity = camDepth < 55 ? 0 : Math.min(0.85, (camDepth - 55) / 30) * (0.6 + 0.4 * Math.sin(time.v * 2.2));
      jellies.forEach(j => { j.position.y += Math.sin(time.v * 0.8 + j.userData.ph) * dt * 0.3; j.children[0].scale.y = 0.85 + Math.sin(time.v * 2 + j.userData.ph) * 0.15; });
      for (let i = 0; i < NB; i++) { if (bLife[i] <= 0) continue; bLife[i] -= dt; bPos[i * 3 + 1] += bVel[i] * dt; bPos[i * 3] += Math.sin(time.v * 3 + i) * dt * 0.1; if (bLife[i] <= 0 || bPos[i * 3 + 1] > -0.1) { bLife[i] = 0; bPos[i * 3 + 1] = 99; } }
      bGeo.attributes.position.needsUpdate = true;
      for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.t += dt; p.s.material.opacity = Math.max(0, 0.9 - p.t * 0.4); p.s.scale.multiplyScalar(1 + dt * 0.5); if (p.t > 2.4) { root.remove(p.s); puffs.splice(i, 1); } }
    }
    /** Cover (kelp, coral, rocks, the wreck) in world space. */
    function worldCovers() { return covers.map(c => ({ x: c.x + env.position.x, y: c.y, z: c.z + env.position.z, r: c.r, kind: c.kind })); }
    function addFish(sp, simple) { const m = makeFish(sp, { simple }); root.add(m); return m; }

    return { root, setActive, center, update, makeLure, makeLine, drawLine, removeObj, bubble, puff, worldCovers, addFish, makeFish, get active() { return root.visible; } };
  }

  window.TideDeep = { create, makeFish };
})();
