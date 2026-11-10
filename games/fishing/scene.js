/*
 * Tidecast - the world: a golden-hour cove, the dock, anglers with rods, lines and floats,
 * fish (shadows under the glare, models when they leap or come up), ripples and spray.
 * The sea surface is shaded (not displaced); bob() gives the same swell to anything floating.
 */
(function () {
  'use strict';
  const T = THREE;
  T.ColorManagement.legacyMode = false;
  const DECK_Y = 1.05;
  const UP = new T.Vector3(0, 1, 0);

  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    if (srgb !== false) t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  const col = c => new T.Color(c);

  // ------------------------------------------------------------------ palettes: golden hour -> dusk
  const PAL = [
    { at: 0, top: '#24407e', mid: '#f0904e', hor: '#ffc46e', sun: '#ffe2a0', sunI: 2.4, deep: '#0c2638', shallow: '#17414f', fog: '#f1a466', hemi: '#8fa6d6', ground: '#6a4434', amb: 0.6, cLit: '#ffd7a0', cDark: '#7a5a7e' },
    { at: 0.55, top: '#1e2f6a', mid: '#e86f45', hor: '#ffa45a', sun: '#ffc888', sunI: 1.9, deep: '#0b2133', shallow: '#153848', fog: '#e9855a', hemi: '#7c84c0', ground: '#5a3430', amb: 0.5, cLit: '#ffb27a', cDark: '#5e4470' },
    { at: 1, top: '#141a48', mid: '#a84a62', hor: '#f27c52', sun: '#ff8a56', sunI: 0.9, deep: '#09192a', shallow: '#132e40', fog: '#8e4a5c', hemi: '#555a98', ground: '#3a2830', amb: 0.4, cLit: '#ff9a6a', cDark: '#3a2c50' },
  ];
  function palAt(t) {
    let a = PAL[0], b = PAL[PAL.length - 1];
    for (let i = 0; i < PAL.length - 1; i++) if (t >= PAL[i].at && t <= PAL[i + 1].at) { a = PAL[i]; b = PAL[i + 1]; break; }
    const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
    const out = {};
    for (const key of Object.keys(a)) {
      if (key === 'at') continue;
      out[key] = typeof a[key] === 'number' ? a[key] + (b[key] - a[key]) * k : col(a[key]).lerp(col(b[key]), k);
    }
    return out;
  }

  function createWorld(canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 1500);
    const sunDir = new T.Vector3(-0.04, 0.12, -1).normalize();

    // ---------------------------------------------------------------- lights
    const hemi = new T.HemisphereLight(0x9fb4d8, 0x6a4a3a, 0.55); scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff0c8, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xbfd0ff, 0.35); fill.position.set(-3, 6, 12); scene.add(fill);
    const key = new T.PointLight(0xfff0dc, 0, 6, 1.5); scene.add(key);   // lights a landed fish for its close-up
    scene.fog = new T.Fog(0xf1a466, 140, 1500);

    // ---------------------------------------------------------------- sky: gradient, sun, and a cloud deck lit from below
    const skyU = { top: { value: col('#3b4f86') }, mid: { value: col('#e7a06a') }, hor: { value: col('#ffd49a') }, sunDir: { value: sunDir }, sunCol: { value: col('#fff0c8') },
      glow: { value: 1 }, uTime: { value: 0 }, cLit: { value: col('#ffd9a8') }, cDark: { value: col('#6a4a72') } };
    const NOISE = `
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }`;
    const sky = new T.Mesh(new T.SphereGeometry(900, 48, 24), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top, mid, hor, sunDir, sunCol, cLit, cDark; uniform float glow, uTime; varying vec3 vP;
        ${NOISE}
        void main(){
          float h = vP.y;
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, h));
          c = mix(c, top, smoothstep(0.12, 0.7, h));
          c = mix(c, hor * 0.82, smoothstep(0.0, -0.08, h));
          float s = max(dot(vP, sunDir), 0.0);
          float disk = smoothstep(0.99955, 0.99975, s);
          vec3 sunL = sunCol * (pow(s, 600.0) * 1.6 + pow(s, 24.0) * 0.35 * glow + pow(s, 4.0) * 0.12 * glow);
          // clouds: a stretched fbm deck on a high plane, dark on top, blazing at the edges toward the sun
          float cov = 0.0, n = 0.0;
          if (h > 0.0) {
            vec2 cp = vP.xz / (h + 0.08);
            cp = vec2(cp.x * 0.28 + uTime * 0.004, cp.y * 0.9);
            n = fbm(cp * 1.4);
            float band = smoothstep(0.01, 0.07, h) * (1.0 - smoothstep(0.32, 0.7, h));
            cov = smoothstep(0.5, 0.74, n) * band;
          }
          float edge = 1.0 - smoothstep(0.5, 0.7, n);
          vec3 cc = mix(cDark, cLit, clamp(0.15 + pow(s, 5.0) * 1.3 + edge * 0.35 - h * 0.6, 0.0, 1.0));
          cc += sunCol * pow(s, 18.0) * edge * 1.4;
          c = mix(c + sunL, cc, cov * 0.94);
          c += sunCol * disk * 9.0 * (1.0 - cov * 0.85);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    sky.renderOrder = -10;
    scene.add(sky);

    // ---------------------------------------------------------------- the seabed and what grows by the dock
    const bedGeo = new T.PlaneGeometry(240, 200, 60, 50); bedGeo.rotateX(-Math.PI / 2);
    {
      const pos = bedGeo.attributes.position, colr = [];
      const sand = col('#7d7a5c'), deep = col('#1f3a40'), weed = col('#34503a');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i) - 60;
        const y = -2.2 - Math.max(0, -z) * 0.09 - Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.35;
        pos.setXYZ(i, x, y, z);
        const k = Math.min(1, Math.max(0, -z / 45));
        const c = sand.clone().lerp(deep, k).lerp(weed, 0.35 * Math.max(0, Math.sin(x * 0.5 + z * 0.3)));
        colr.push(c.r, c.g, c.b);
      }
      bedGeo.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
      bedGeo.computeVertexNormals();
    }
    const seabed = new T.Mesh(bedGeo, new T.MeshLambertMaterial({ vertexColors: true }));
    scene.add(seabed);
    const kelpMat = new T.MeshLambertMaterial({ color: 0x3d5a2e, side: T.DoubleSide });
    const kelps = [];
    for (let i = 0; i < 26; i++) {
      const h = 1 + Math.random() * 1.2, g = new T.PlaneGeometry(0.16, h, 1, 4); g.translate(0, h / 2, 0);
      const m = new T.Mesh(g, kelpMat);
      m.position.set((Math.random() - 0.5) * 14, -2.3, -1 - Math.random() * 8); m.rotation.y = Math.random() * 3;
      m.userData.ph = Math.random() * 6; scene.add(m); kelps.push(m);
    }

    // ---------------------------------------------------------------- sea: see-through near the dock, a mirror far out
    const PILES = [[-5.4, -0.45], [-2.7, -0.45], [0, -0.45], [2.7, -0.45], [5.4, -0.45], [-5.4, 6.1], [-2.7, 6.1], [0, 6.1], [2.7, 6.1], [5.4, 6.1]];
    const waterU = {
      uTime: { value: 0 }, uSun: { value: sunDir }, uSunCol: { value: col('#fff0c8') }, uSkyTop: { value: col('#24407e') }, uSkyMid: { value: col('#f0904e') }, uSkyHor: { value: col('#ffc46e') },
      uDeep: { value: col('#173847') }, uShallow: { value: col('#2f6268') }, uFog: { value: col('#f1a466') }, uFogNear: { value: 120 }, uFogFar: { value: 900 }, uDetail: { value: 1 },
      uPiles: { value: PILES.map(p => new T.Vector2(p[0], p[1])) },
    };
    const water = new T.Mesh(new T.PlaneGeometry(2400, 2400), new T.ShaderMaterial({
      uniforms: waterU, fog: false, transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `
        uniform float uTime, uFogNear, uFogFar, uDetail; uniform vec3 uSun, uSunCol, uSkyTop, uSkyMid, uSkyHor, uDeep, uShallow, uFog; uniform vec2 uPiles[${PILES.length}]; varying vec3 vW;
        ${NOISE}
        float H;
        vec2 wv(vec2 p, vec2 d, float f, float sp, float a){ float ph = dot(p, d) * f + uTime * sp; H += a * sin(ph); return d * (a * f * cos(ph)); }
        void main(){
          vec2 p = vW.xz;
          float dist = length(cameraPosition.xz - p);
          H = 0.0;
          vec2 g = wv(p, normalize(vec2(0.25, 1.0)), 0.31, 0.9, 0.16);
          g += wv(p, normalize(vec2(-0.7, 0.6)), 0.57, 1.3, 0.07);
          g += wv(p, normalize(vec2(0.9, 0.25)), 1.21, 1.9, 0.03);
          float near = smoothstep(220.0, 30.0, dist) * uDetail;
          g += wv(p, normalize(vec2(-0.2, -1.0)), 2.63, 2.8, 0.013) * near;
          g += wv(p, normalize(vec2(0.62, -0.78)), 4.9, 3.9, 0.007) * near;
          g += wv(p, normalize(vec2(-0.93, -0.35)), 9.7, 5.3, 0.0035) * near * smoothstep(60.0, 10.0, dist);
          g *= 1.0 / (1.0 + dist * 0.006);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vW);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 R = reflect(-V, n);
          float ry = max(R.y, 0.0);
          vec3 skyc = mix(uSkyHor, uSkyMid, smoothstep(0.0, 0.14, ry));
          skyc = mix(skyc, uSkyTop, smoothstep(0.1, 0.6, ry));
          float s = max(dot(R, uSun), 0.0);
          vec3 flatV = normalize(vec3(-V.x, 0.0, -V.z));
          float az = max(dot(flatV, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          // the glitter path: a hot core, twinkles scattered on the facets, a broad golden sheen
          float tw = noise(p * 7.0 + vec2(uTime * 0.9, -uTime * 0.7)) * noise(p * 11.0 - vec2(uTime * 1.3, uTime * 0.4));
          vec3 spec = uSunCol * (pow(s, 700.0) * 60.0 + pow(s, 90.0) * 3.0 + pow(s, 12.0) * 0.3)
            + uSunCol * pow(az, 60.0) * 0.18 + uSunCol * smoothstep(0.42, 0.62, tw) * pow(az, 70.0) * pow(s, 6.0) * 4.0 * near;
          // body colour: clear teal shallows, deep blue out to sea; backlit wave crests glow
          vec3 base = mix(uShallow, uDeep, smoothstep(4.0, 70.0, dist));
          base += uSunCol * (0.05 + max(H, 0.0) * 1.2) * pow(az, 3.0) * 0.6;
          vec3 c = mix(base, skyc, fres) + spec;
          // foam around the pilings, breathing with the swell
          float foam = 0.0;
          if (abs(p.x) < 7.0 && p.y > -2.5 && p.y < 8.0)   // only by the dock: the loop is not free
          for (int i = 0; i < ${PILES.length}; i++) {
            float d = length(p - uPiles[i]);
            foam += smoothstep(0.9, 0.2, d + (noise(p * 6.0 + uTime) - 0.5) * 0.5) * (0.55 + 0.45 * sin(uTime * 1.7 + d * 7.0));
          }
          foam = clamp(foam, 0.0, 1.0) * smoothstep(0.35, 0.6, noise(p * 9.0 - uTime * 0.6) + foam * 0.3);
          c = mix(c, vec3(1.0, 0.96, 0.88) * (0.75 + uSunCol * 0.25), foam * 0.8);
          float alpha = clamp(max(max(fres * 1.7, smoothstep(9.0, 42.0, dist)), foam) + 0.5, 0.0, 1.0);
          float fog = smoothstep(uFogNear, uFogFar, dist);
          c = mix(c, uFog, fog);
          gl_FragColor = vec4(c, max(alpha, fog));
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    water.rotation.x = -Math.PI / 2;
    water.renderOrder = -1;
    scene.add(water);
    /** The swell under a floating thing at (x, z), metres (matches the shader's big waves). */
    function bob(x, z, t) {
      return 0.03 * Math.sin((0.25 * x + 1.0 * z) / 1.03 * 0.31 + t * 0.9) + 0.014 * Math.sin((-0.7 * x + 0.6 * z) / 0.92 * 0.57 + t * 1.3);
    }

    // ---------------------------------------------------------------- shores: real terrain, wooded, fading into the haze
    const shoreMats = [];
    function terrain(o) {
      const geo = new T.PlaneGeometry(o.w, o.d, o.sx || 80, o.sz || 20); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, cols = [];
      const off = [((o.seed * 7919) % 97) * 1.3, ((o.seed * 104729) % 89) * 0.7];
      const n2 = (x, z) => Math.sin(x * 1.7 + off[0]) * Math.cos(z * 1.3 + off[1]) + Math.sin(x * 3.9 + z * 2.1 + off[1]) * 0.5 + Math.sin(x * 9.1 - z * 5.3 + off[0]) * 0.18;
      const u0 = o.u0 || 0, u1 = o.u1 || 1;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const u = x / o.w + 0.5, v = z / o.d + 0.5;           // v: 0 the back, 1 the seaward edge
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))), o.sharp || 0.8);
        const ridge = 1 - Math.abs(n2(x / o.w * 4, z / o.d * 2)) * 0.45;
        let y = o.h * env * ridge * Math.pow(1 - v, 0.6) * (0.75 + 0.25 * Math.sin(u * 23 + o.seed));
        y = Math.max(-3, y - v * 6);
        pos.setY(i, y);
      }
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal, low = col(o.low), high = col(o.high), rock = col('#6a5a50'), sandC = col('#b89a70');
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), up = nrm.getY(i);
        const c = low.clone().lerp(high, Math.min(1, Math.max(0, y / o.h))).lerp(rock, Math.min(1, Math.max(0, 0.75 - up) * 1.6));
        if (y < 1.2) c.lerp(sandC, 0.7);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      const m = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true }));
      m.position.set(o.x, 0, o.z);
      scene.add(m); shoreMats.push(m.material);
      return m;
    }
    function heightAt(m, wx, wz) {
      const pos = m.geometry.attributes.position; let best = -9, bd = 1e9;
      const lx = wx - m.position.x, lz = wz - m.position.z;
      for (let i = 0; i < pos.count; i++) { const d = Math.hypot(pos.getX(i) - lx, pos.getZ(i) - lz); if (d < bd) { bd = d; best = pos.getY(i); } }
      return best;
    }
    terrain({ x: -560, z: -900, w: 900, d: 260, h: 120, seed: 3, low: '#3c3a52', high: '#5a4e6a' });
    terrain({ x: 600, z: -980, w: 760, d: 240, h: 85, seed: 9, low: '#3c3a52', high: '#5c5068' });
    const headL = terrain({ x: -300, z: -430, w: 420, d: 170, h: 62, seed: 5, u1: 0.95, low: '#2e3a2c', high: '#4a5236', sx: 96, sz: 26 });
    const pointR = terrain({ x: 205, z: -335, w: 200, d: 110, h: 24, seed: 11, u0: 0.05, low: '#3a3a30', high: '#55503c', sx: 60, sz: 24, sharp: 0.55 });
    {
      const tree = new T.ConeGeometry(1, 1, 6); tree.translate(0, 0.5, 0);
      const inst = new T.InstancedMesh(tree, new T.MeshLambertMaterial({ color: 0x223024 }), 260);
      const mtx = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), p = new T.Vector3();
      const pos = headL.geometry.attributes.position; let n = 0;
      for (let tries = 0; tries < 4000 && n < 260; tries++) {
        const i = (Math.random() * pos.count) | 0, y = pos.getY(i);
        if (y < 8) continue;
        const hgt = 7 + Math.random() * 9;
        p.set(pos.getX(i) + headL.position.x, y - 0.5, pos.getZ(i) + headL.position.z);
        sc.set(hgt * 0.32, hgt, hgt * 0.32);
        inst.setMatrixAt(n++, mtx.compose(p, q, sc));
      }
      inst.count = n; scene.add(inst); shoreMats.push(inst.material);
    }
    const rockMatFar = new T.MeshLambertMaterial({ color: 0x4a4038, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const r = 2 + Math.random() * 5, m = new T.Mesh(new T.DodecahedronGeometry(r, 0), rockMatFar);
      m.position.set(150 + Math.random() * 110, -r * 0.3, -290 + Math.random() * 20); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.scale.y = 0.6;
      scene.add(m);
    }
    const lhX = 236, lhZ = -335, lhY = Math.max(4, heightAt(pointR, lhX, lhZ) - 1);
    const lh = new T.Group();
    const white = new T.MeshLambertMaterial({ color: 0xf2ede4 }), red = new T.MeshLambertMaterial({ color: 0xb8432e });
    for (let i = 0; i < 4; i++) {
      const seg = new T.Mesh(new T.CylinderGeometry(2.6 - i * 0.35, 2.95 - i * 0.35, 4.5, 12), i % 2 ? red : white);
      seg.position.y = 2.25 + i * 4.5; lh.add(seg);
    }
    const lampMat = new T.MeshBasicMaterial({ color: 0xfff1c0 });
    const lamp = new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 2, 10), lampMat); lamp.position.y = 19; lh.add(lamp);
    const cap = new T.Mesh(new T.ConeGeometry(1.9, 1.8, 10), red); cap.position.y = 20.9; lh.add(cap);
    const keeper = new T.Mesh(new T.BoxGeometry(6, 3.5, 4), white); keeper.position.set(5, 1.75, 2); lh.add(keeper);
    const roof = new T.Mesh(new T.ConeGeometry(4.6, 2.2, 4), red); roof.position.set(5, 4.6, 2); roof.rotation.y = Math.PI / 4; lh.add(roof);
    lh.position.set(lhX, lhY, lhZ);
    scene.add(lh);
    const glowTex = canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.55)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    const lhGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffe6b0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    lhGlow.position.set(lhX, lhY + 19, lhZ); lhGlow.scale.setScalar(18); scene.add(lhGlow);
    // the beam: a long soft cone sweeping round at dusk
    const beamGeo = new T.CylinderGeometry(0.6, 16, 220, 16, 1, true); beamGeo.translate(0, -110, 0); beamGeo.rotateZ(Math.PI / 2);
    {
      const pos = beamGeo.attributes.position, a = [];
      for (let i = 0; i < pos.count; i++) a.push(1 - Math.min(1, Math.abs(pos.getX(i)) / 220));
      beamGeo.setAttribute('fade', new T.Float32BufferAttribute(a, 1));
    }
    const beamMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { uO: { value: 0 }, uC: { value: col('#ffe6b0') } },
      vertexShader: 'attribute float fade; varying float vF; void main(){ vF = fade; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uO; uniform vec3 uC; varying float vF; void main(){ gl_FragColor = vec4(uC * uO * vF * vF, 1.0); }',
    });
    const beam = new T.Mesh(beamGeo, beamMat); beam.position.set(lhX, lhY + 19, lhZ); scene.add(beam);
    const sunGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffd9a0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, opacity: 0.55 }));
    sunGlow.scale.setScalar(150); sunGlow.renderOrder = -9; scene.add(sunGlow);


    // a sailboat drifting across the glare
    const boat = new T.Group();
    const hull = new T.Mesh(new T.BoxGeometry(5, 1, 1.6), new T.MeshLambertMaterial({ color: 0x2a2230 })); hull.position.y = 0.4; boat.add(hull);
    const sailShape = new T.Shape(); sailShape.moveTo(0, 0); sailShape.lineTo(2.6, 0); sailShape.lineTo(0, 7.5); sailShape.lineTo(0, 0);
    const sail = new T.Mesh(new T.ShapeGeometry(sailShape), new T.MeshLambertMaterial({ color: 0xf6e3cc, side: T.DoubleSide })); sail.position.set(-0.4, 1, 0); boat.add(sail);
    const jib = new T.Mesh(new T.ShapeGeometry(sailShape), sail.material); jib.position.set(-0.6, 1, 0); jib.scale.set(-0.8, 0.85, 1); boat.add(jib);
    boat.position.set(-140, 0, -260); scene.add(boat);

    // gulls
    const gullMat = new T.MeshBasicMaterial({ color: 0x2b2430, side: T.DoubleSide, fog: true });
    const wingGeo = new T.BufferGeometry();
    wingGeo.setAttribute('position', new T.Float32BufferAttribute([0, 0, -0.25, 0, 0, 0.25, 1.4, 0.15, 0.05], 3));
    wingGeo.computeVertexNormals();
    const gulls = [];
    for (let i = 0; i < 5; i++) {
      const g = new T.Group(), l = new T.Mesh(wingGeo, gullMat), r = new T.Mesh(wingGeo, gullMat);
      r.scale.x = -1; g.add(l, r); g.userData = { l, r, a: Math.random() * 6, rad: 30 + Math.random() * 40, cx: (Math.random() - 0.5) * 80, cz: -60 - Math.random() * 60, h: 18 + Math.random() * 16, sp: 0.08 + Math.random() * 0.06, ph: Math.random() * 6 };
      scene.add(g); gulls.push(g);
    }

    // everything so far is the world above the waterline: hidden while the camera is in the depths
    const aboveObjs = scene.children.filter(o => !o.isLight && o !== sun.target);

    // ---------------------------------------------------------------- the dock
    const woodTex = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#8a6040'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(${40 + Math.random() * 40},${25 + Math.random() * 20},${10 + Math.random() * 10},${0.15 + Math.random() * 0.25})`;
        g.lineWidth = 1 + Math.random() * 2;
        const y = Math.random() * h;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
        g.stroke();
      }
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(40,24,12,0.45)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 6, 3, 0, 0, Math.PI * 2); g.fill(); }
    });
    woodTex.wrapS = woodTex.wrapT = T.RepeatWrapping;
    const plankMat = new T.MeshStandardMaterial({ map: woodTex, roughness: 0.85, metalness: 0 });
    const postMat = new T.MeshStandardMaterial({ color: 0x6b4c36, roughness: 0.9 });
    const dock = new T.Group();
    // walkway back to shore, and a wide end platform
    // every plank in one mesh (one draw call); each keeps its own stretch of the grain texture
    const deck = { pos: [], nor: [], uv: [], idx: [] };
    const plank = (x, z, w, d) => {
      const b = new T.BoxGeometry(w, 0.08, d);
      b.translate(x, DECK_Y - 0.04, z);
      const off = deck.pos.length / 3, du = Math.random(), su = w / 3;
      deck.pos.push(...b.attributes.position.array); deck.nor.push(...b.attributes.normal.array);
      const uv = b.attributes.uv.array;
      for (let i = 0; i < uv.length; i += 2) deck.uv.push(uv[i] * su + du, uv[i + 1] * 0.25 + (deck.idx.length % 4) * 0.25);
      deck.idx.push(...b.index.array.map(i => i + off));
    };
    for (let i = 0; i < 26; i++) plank(0, -0.5 + i * 0.26 + 0.13, 11, 0.24);
    for (let i = 0; i < 70; i++) plank(0, 6.3 + i * 0.26, 3.2, 0.24);
    const deckGeo = new T.BufferGeometry();
    deckGeo.setAttribute('position', new T.Float32BufferAttribute(deck.pos, 3));
    deckGeo.setAttribute('normal', new T.Float32BufferAttribute(deck.nor, 3));
    deckGeo.setAttribute('uv', new T.Float32BufferAttribute(deck.uv, 2));
    deckGeo.setIndex(deck.idx);
    const deckMesh = new T.Mesh(deckGeo, plankMat); deckMesh.receiveShadow = true; dock.add(deckMesh);
    const post = (x, z, top) => {
      const m = new T.Mesh(new T.CylinderGeometry(0.13, 0.15, top + 3, 8), postMat);
      m.position.set(x, (top - 3) / 2, z); m.castShadow = true; dock.add(m); return m;
    };
    [-5.4, -2.7, 0, 2.7, 5.4].forEach(x => { post(x, -0.45, x === -5.4 || x === 5.4 ? DECK_Y + 0.5 : DECK_Y + 0.22); post(x, 6.1, DECK_Y - 0.05); });
    for (let z = 9; z < 26; z += 3.2) { post(-1.5, z, DECK_Y - 0.05); post(1.5, z, DECK_Y - 0.05); }
    // a rope rail along the sides of the end platform
    const ropeMat = new T.MeshStandardMaterial({ color: 0xd8c39a, roughness: 1 });
    [-5.4, 5.4].forEach(x => {
      const curve = new T.CatmullRomCurve3([new T.Vector3(x, DECK_Y + 0.45, -0.45), new T.Vector3(x, DECK_Y + 0.25, 2.8), new T.Vector3(x, DECK_Y + 0.45, 6.1)]);
      dock.add(new T.Mesh(new T.TubeGeometry(curve, 16, 0.025, 5), ropeMat));
    });
    // lanterns on the corner posts
    const lanterns = [];
    const lanternMat = new T.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6, metalness: 0.4 });
    [-5.4, 5.4].forEach(x => {
      const g = new T.Group();
      const capM = new T.Mesh(new T.ConeGeometry(0.11, 0.08, 8), lanternMat); capM.position.y = 0.15; g.add(capM);
      const baseM = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.03, 8), lanternMat); baseM.position.y = -0.12; g.add(baseM);
      const ring = new T.Mesh(new T.TorusGeometry(0.03, 0.006, 6, 12), lanternMat); ring.position.y = 0.21; g.add(ring);
      const bulbMat = new T.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb050, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 });
      const bulb = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.22, 10), bulbMat); g.add(bulb);
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffb860, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.4 }));
      glow.scale.setScalar(1.2); g.add(glow);
      const light = new T.PointLight(0xffb060, 0, 9, 2); g.add(light);
      g.position.set(x, DECK_Y + 0.75, -0.45);
      dock.add(g); lanterns.push({ bulbMat, glow, light });
    });
    // a bucket and a tackle box by the rail
    const bucket = new T.Mesh(new T.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), new T.MeshStandardMaterial({ color: 0x3f6f8a, roughness: 0.5, metalness: 0.3, side: T.DoubleSide }));
    bucket.position.set(4.6, DECK_Y + 0.17, 2.6); bucket.castShadow = true; dock.add(bucket);
    const box = new T.Mesh(new T.BoxGeometry(0.5, 0.22, 0.28), new T.MeshStandardMaterial({ color: 0x2f6b4a, roughness: 0.6 }));
    box.position.set(-4.5, DECK_Y + 0.11, 2.9); box.rotation.y = 0.4; box.castShadow = true; dock.add(box);
    scene.add(dock);
    // rocks where the shore meets the sea, either side of the walkway
    const rockMat = new T.MeshStandardMaterial({ color: 0x4d4440, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1, r = 0.6 + Math.random() * 1.8;
      const m = new T.Mesh(new T.DodecahedronGeometry(r, 0), rockMat);
      m.position.set(side * (9 + Math.random() * 26), -r * 0.35, 14 + Math.random() * 16);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.scale.y = 0.6;
      scene.add(m);
    }

    // ---------------------------------------------------------------- anglers
    const skin = new T.MeshStandardMaterial({ color: 0xc9906a, roughness: 0.7 });
    const pants = new T.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 });
    const bootMat = new T.MeshStandardMaterial({ color: 0x1f1a17, roughness: 0.8 });
    const cyl = new T.CylinderGeometry(1, 1, 1, 10);
    const rodGeo = new T.CylinderGeometry(1, 1, 1, 6);
    const lineMatBase = new T.LineBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.9 });
    /** Stretch a unit cylinder between a and b, radius r. */
    function place(m, a, b, r) {
      const d = new T.Vector3().subVectors(b, a), l = d.length() || 1e-4;
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / l));
      m.scale.set(r, l, r);
    }
    const ROD_SEG = 10;
    function createAngler(color, x) {
      const c = col(color);
      const jacket = new T.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.75), roughness: 0.75 });
      const g = new T.Group();
      g.position.set(x, DECK_Y, 0.55);
      const shadow = m => { m.castShadow = true; return m; };
      // waders and boots
      [-0.1, 0.1].forEach(lx => {
        const leg = shadow(new T.Mesh(new T.CylinderGeometry(0.08, 0.07, 0.62, 12), pants)); leg.position.set(lx, 0.39, 0); g.add(leg);
        const boot = shadow(new T.Mesh(new T.CylinderGeometry(0.075, 0.08, 0.16, 12), bootMat)); boot.position.set(lx, 0.08, 0); g.add(boot);
        const toe = shadow(new T.Mesh(new T.SphereGeometry(0.075, 10, 8), bootMat)); toe.position.set(lx, 0.04, -0.07); toe.scale.set(1, 0.6, 1.4); g.add(toe);
      });
      // an oilskin coat turned on a lathe: hem flared at the knee, waist, chest, sloping shoulders
      const prof = [[0.25, 0.62], [0.255, 0.66], [0.22, 0.9], [0.205, 1.08], [0.215, 1.3], [0.2, 1.42], [0.15, 1.48], [0.07, 1.52], [0.0, 1.53]].map(p => new T.Vector2(p[0], p[1]));
      const coat = shadow(new T.Mesh(new T.LatheGeometry(prof, 20), jacket)); coat.scale.z = 0.8; g.add(coat);
      [-1, 1].forEach(sx => { const sh = shadow(new T.Mesh(new T.SphereGeometry(0.075, 12, 8), jacket)); sh.position.set(sx * 0.18, 1.42, 0); g.add(sh); });
      const pocket = new T.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.55), roughness: 0.85 });
      [-1, 1].forEach(sx => { const pk = new T.Mesh(new T.BoxGeometry(0.1, 0.09, 0.03), pocket); pk.position.set(sx * 0.11, 1.2, -0.17); g.add(pk); });
      const belt = new T.Mesh(new T.TorusGeometry(0.205, 0.018, 6, 20), new T.MeshStandardMaterial({ color: 0x3a2a1c })); belt.rotation.x = Math.PI / 2; belt.position.y = 1.07; belt.scale.y = 0.8; g.add(belt);
      const scarf = new T.Mesh(new T.TorusGeometry(0.085, 0.035, 8, 16), new T.MeshStandardMaterial({ color: c, roughness: 0.8 })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.5; g.add(scarf);
      const tail = new T.Mesh(new T.BoxGeometry(0.06, 0.18, 0.02), scarf.material); tail.position.set(0.06, 1.4, 0.1); tail.rotation.z = 0.3; g.add(tail);
      const head = shadow(new T.Mesh(new T.SphereGeometry(0.11, 18, 14), skin)); head.position.y = 1.63; head.scale.set(0.95, 1.08, 1); g.add(head);
      const hair = new T.Mesh(new T.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), new T.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 }));
      hair.position.y = 1.64; hair.rotation.x = 0.5; g.add(hair);
      [-1, 1].forEach(sx => { const ear = new T.Mesh(new T.SphereGeometry(0.025, 8, 6), skin); ear.position.set(sx * 0.105, 1.62, 0.01); ear.scale.z = 0.6; g.add(ear); });
      // a bucket hat: soft crown and a brim that droops at the edge
      const hatMat = new T.MeshStandardMaterial({ color: c, roughness: 0.7, side: T.DoubleSide });
      const hatProf = [[0.0, 0.17], [0.09, 0.165], [0.125, 0.12], [0.135, 0.06], [0.14, 0.04], [0.2, 0.02], [0.24, -0.01], [0.25, -0.025]].map(p => new T.Vector2(p[0], p[1]));
      const hat = shadow(new T.Mesh(new T.LatheGeometry(hatProf, 24), hatMat)); hat.position.y = 1.68; g.add(hat);
      const band = new T.Mesh(new T.CylinderGeometry(0.137, 0.14, 0.025, 20, 1, true), new T.MeshStandardMaterial({ color: 0x241c16, side: T.DoubleSide })); band.position.y = 1.74; g.add(band);
      scene.add(g);
      const armMat = jacket;
      const parts = {
        upper: shadow(new T.Mesh(cyl, armMat)), fore: shadow(new T.Mesh(cyl, armMat)), hand: shadow(new T.Mesh(new T.SphereGeometry(0.05, 10, 8), skin)), elbow: shadow(new T.Mesh(new T.SphereGeometry(0.06, 10, 8), armMat)),
        upper2: shadow(new T.Mesh(cyl, armMat)), fore2: shadow(new T.Mesh(cyl, armMat)), hand2: shadow(new T.Mesh(new T.SphereGeometry(0.05, 10, 8), skin)), elbow2: shadow(new T.Mesh(new T.SphereGeometry(0.06, 10, 8), armMat)),
      };
      Object.values(parts).forEach(m => scene.add(m));
      // rod: cork grip, reel, then a tapering blank in segments that bend toward the line
      const corkMat = new T.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
      const blankMat = new T.MeshStandardMaterial({ color: 0x1d2a36, roughness: 0.35, metalness: 0.5 });
      const grip = shadow(new T.Mesh(rodGeo, corkMat)); scene.add(grip);
      const reel = new T.Group();
      const spool = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.05, 14), new T.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.3, metalness: 0.8 }));
      spool.rotation.z = Math.PI / 2; reel.add(spool);
      const handle = new T.Mesh(new T.BoxGeometry(0.012, 0.012, 0.09), new T.MeshStandardMaterial({ color: 0x222222 })); handle.position.set(0.035, 0, 0); reel.add(handle);
      scene.add(reel);
      const segs = [];
      for (let i = 0; i < ROD_SEG; i++) { const m = shadow(new T.Mesh(rodGeo, blankMat)); scene.add(m); segs.push(m); }
      const tipBead = new T.Mesh(new T.SphereGeometry(0.012, 6, 4), new T.MeshBasicMaterial({ color: c })); scene.add(tipBead);
      // the line
      const N = 40;
      const lineGeo = new T.BufferGeometry();
      lineGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3));
      const lineMat = lineMatBase.clone();
      const line = new T.Line(lineGeo, lineMat); line.frustumCulled = false; scene.add(line);
      const lineGlow = new T.Line(lineGeo, new T.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
      lineGlow.frustumCulled = false; lineGlow.renderOrder = 3; scene.add(lineGlow);
      const aimM = new T.Mesh(aimGeo, new T.MeshBasicMaterial({ map: aimTex('#' + c.getHexString(T.SRGBColorSpace)), transparent: true, depthWrite: false, opacity: 0.6, fog: false, toneMapped: false }));
      aimM.renderOrder = 2; aimM.visible = false; scene.add(aimM);
      // the float: white below, the player's colour on top, a little antenna
      const bob = new T.Group();
      const lower = new T.Mesh(new T.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.4 }));
      const upper = new T.Mesh(new T.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.25 }));
      const stick = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.12, 5), new T.MeshStandardMaterial({ color: 0x222222 })); stick.position.y = 0.1;
      const knob = new T.Mesh(new T.SphereGeometry(0.018, 8, 6), new T.MeshBasicMaterial({ color: c })); knob.position.y = 0.16;
      const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.5, fog: false }));
      halo.scale.setScalar(0.5); halo.position.y = 0.05;
      bob.add(lower, upper, stick, knob, halo);
      scene.add(bob);
      const marker = new T.Sprite(new T.SpriteMaterial({ map: markerTex, color: c, transparent: true, depthWrite: false, depthTest: false, fog: false }));
      marker.renderOrder = 5; scene.add(marker);
      return { g, parts, grip, reel, segs, tipBead, line, lineGlow, lineGeo, lineMat, bob, halo, marker, aim: aimM, N, color: c, x, tip: new T.Vector3(), hand: new T.Vector3(), headPos: new T.Vector3(x, DECK_Y + 1.62, 0.55), visible: true };
    }
    const aimGeo = new T.PlaneGeometry(4, 9);
    /** Chevrons with a dark rim, so they read on the glare as well as the shadowed water. */
    const aimTex = color => canvasTex(96, 216, (g, w, h) => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let k = 0; k < 3; k++) {
        const y = h * (0.2 + k * 0.27), a = 1 - k * 0.22;
        const path = () => { g.beginPath(); g.moveTo(w * 0.14, y + 26); g.lineTo(w * 0.5, y); g.lineTo(w * 0.86, y + 26); };
        g.globalAlpha = 0.7 * a; g.strokeStyle = '#1a1226'; g.lineWidth = 16; path(); g.stroke();
        g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = 8; path(); g.stroke();
      }
    });
    const markerTex = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * 0.5, w * 0.92); g.lineTo(w * 0.18, w * 0.45); g.lineTo(w * 0.82, w * 0.45); g.closePath(); g.fill();
      g.beginPath(); g.arc(w * 0.5, w * 0.34, w * 0.2, 0, Math.PI * 2); g.fill();
    });
    function removeAngler(a) {
      [a.g, a.grip, a.reel, a.tipBead, a.line, a.lineGlow, a.bob, a.marker, a.aim, ...a.segs, ...Object.values(a.parts)].forEach(o => scene.remove(o));
    }

    const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _d = new T.Vector3(), _q = new T.Quaternion(), _p = [];
    for (let i = 0; i < ROD_SEG + 1; i++) _p.push(new T.Vector3());
    /**
     * Pose an angler. arm: mc.arm-like {shoulder, elbow, hand} in metres from the head; rodDir:
     * unit vector (the phone, 1:1); bend 0..1 toward bendTo (unit, the line); left: mirror the body.
     */
    function poseAngler(a, arm, rodDir, bend, bendTo, left) {
      const H = a.headPos;
      const S = _a.set(arm.shoulder.x, arm.shoulder.y, arm.shoulder.z).add(H);
      const E = _b.set(arm.elbow.x, arm.elbow.y, arm.elbow.z).add(H);
      const W = _c.set(arm.hand.x, arm.hand.y, arm.hand.z).add(H);
      place(a.parts.upper, S, E, 0.066); place(a.parts.fore, E, W, 0.054); a.parts.hand.position.copy(W); a.parts.elbow.position.copy(E);
      a.hand.copy(W);
      // the grip runs back past the hand, the reel sits under it, the blank goes forward
      const dir = _d.copy(rodDir).normalize();
      const butt = new T.Vector3().copy(W).addScaledVector(dir, -0.22);
      const gripEnd = new T.Vector3().copy(W).addScaledVector(dir, 0.12);
      place(a.grip, butt, gripEnd, 0.017);
      a.reel.position.copy(W).addScaledVector(dir, -0.05);
      const down = new T.Vector3(0, -1, 0).addScaledVector(dir, dir.y).normalize();
      a.reel.position.addScaledVector(down, 0.06);
      a.reel.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
      // the other hand on the reel handle
      const S2 = new T.Vector3(-arm.shoulder.x, arm.shoulder.y, arm.shoulder.z).add(H);
      const reelHand = a.reel.position.clone().add(new T.Vector3(left ? -0.06 : 0.06, -0.02, 0));
      const E2 = S2.clone().lerp(reelHand, 0.5).add(new T.Vector3(left ? 0.06 : -0.06, -0.12, 0.05));
      place(a.parts.upper2, S2, E2, 0.066); place(a.parts.fore2, E2, reelHand, 0.054); a.parts.hand2.position.copy(reelHand); a.parts.elbow2.position.copy(E2);
      // blank: a quadratic curve whose far half leans toward the line
      // blank: a loaded cantilever, stiff at the butt, the tip pulled round toward the line
      const L = 2.2 - 0.12, P0 = gripEnd;
      const perp = new T.Vector3();
      if (bendTo) { perp.copy(bendTo).addScaledVector(dir, -bendTo.dot(dir)); if (perp.lengthSq() > 1e-6) perp.normalize(); else perp.set(0, 0, 0); }
      const bd = Math.min(1.1, bend) * 0.42 * (bendTo ? Math.min(1, 1 - bendTo.dot(dir) + 0.3) : 0);
      for (let i = 0; i <= ROD_SEG; i++) {
        const t = i / ROD_SEG, defl = bd * t * t * (3 - t) / 2;
        _p[i].copy(P0).addScaledVector(dir, L * t * (1 - 0.5 * defl * defl)).addScaledVector(perp, L * defl);
      }
      for (let i = 0; i < ROD_SEG; i++) place(a.segs[i], _p[i], _p[i + 1], 0.011 - i * 0.00075);
      a.tip.copy(_p[ROD_SEG]);
      a.tipBead.position.copy(a.tip);
    }
    /** Draw the line from the rod tip to `to`, sagging by `sag` metres in the middle. */
    const lineCalm = col('#fff6e0'), lineHot = col('#ffb347'), lineRed = col('#ff4a2e');
    /**
     * Draw the line from the rod tip to `to`, sagging by `sag` metres in the middle. tension 0..1+
     * colours it (cream, amber, red) and lights a glow along it; above 0.85 it thrums.
     */
    function drawLine(a, to, sag, visible, tension) {
      a.line.visible = a.lineGlow.visible = visible !== false;
      if (!a.line.visible) return;
      const T0 = tension || 0, thrum = T0 > 0.85 ? (T0 - 0.85) * 0.12 : 0;
      const pos = a.lineGeo.attributes.position.array, N = a.N;
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1), w = Math.sin(Math.PI * s) * thrum * Math.sin(time * 90 + i * 1.3);
        pos[i * 3] = a.tip.x + (to.x - a.tip.x) * s + w;
        pos[i * 3 + 1] = a.tip.y + (to.y - a.tip.y) * s - sag * 4 * s * (1 - s) + w;
        pos[i * 3 + 2] = a.tip.z + (to.z - a.tip.z) * s;
      }
      a.lineGeo.attributes.position.needsUpdate = true;
      const k = Math.min(1, T0);
      a.lineMat.color.copy(lineCalm).lerp(k < 0.6 ? lineCalm : lineHot, k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.25)).lerp(lineRed, Math.max(0, (k - 0.85) / 0.15));
      a.lineGlow.material.color.copy(a.lineMat.color);
      a.lineGlow.material.opacity = Math.max(0, (T0 - 0.35) * 0.9);
    }
    /** The aim arrow on the water: where the rod points (not where it will land). */
    function aim(a, heading, show, pulse) {
      a.aim.visible = !!show;
      if (!show) return;
      const r = 13;
      a.aim.position.set(a.x + Math.sin(heading) * r, 0.04, 0.1 - Math.cos(heading) * r);
      a.aim.rotation.set(-Math.PI / 2, 0, -heading);
      a.aim.material.opacity = 0.55 + 0.45 * (pulse || 0);
    }

    // ---------------------------------------------------------------- fish
    function fishTexture(look) {
      return canvasTex(256, 128, (g, w, h) => {
        for (let y = 0; y < h; y++) {
          const t = Math.abs(y / h - 0.5) * 2;   // 1 on the back, 0 on the belly
          const c = t < 0.45 ? col(look.belly).lerp(col(look.side), t / 0.45) : col(look.side).lerp(col(look.back), Math.min(1, (t - 0.45) / 0.45));
          g.fillStyle = '#' + c.getHexString(T.SRGBColorSpace); g.fillRect(0, y, w, 1);
        }
        g.globalAlpha = 0.55; g.fillStyle = look.back; g.strokeStyle = look.back;
        let s = look.back.length * 977;
        const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        if (look.mark === 'bars') for (let i = 0; i < 6; i++) { const x = w * (0.22 + i * 0.11); g.fillRect(x, 0, w * 0.04, h * 0.32); g.fillRect(x, h * 0.68, w * 0.04, h * 0.32); }
        if (look.mark === 'stripes') { g.lineWidth = 3; [0.3, 0.38, 0.62, 0.7].forEach(v => { g.beginPath(); g.moveTo(w * 0.15, h * v); g.lineTo(w * 0.95, h * v); g.stroke(); }); }
        if (look.mark === 'waves') { g.lineWidth = 3; for (let k = 0; k < 9; k++) { g.beginPath(); for (let x = w * 0.2; x < w; x += 4) { const y = h * (0.06 + k * 0.025) + Math.sin(x * 0.12 + k) * 4; x === w * 0.2 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); g.beginPath(); for (let x = w * 0.2; x < w; x += 4) { const y = h * (0.94 - k * 0.025) + Math.sin(x * 0.12 + k) * 4; x === w * 0.2 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); } }
        if (look.mark === 'spots' || look.mark === 'speckle') {
          const n = look.mark === 'spots' ? 70 : 220, rad = look.mark === 'spots' ? 3.5 : 1.6;
          for (let i = 0; i < n; i++) { const y = r() < 0.5 ? r() * h * 0.4 : h - r() * h * 0.4; g.beginPath(); g.arc(w * (0.1 + r() * 0.85), y, rad * (0.6 + r()), 0, Math.PI * 2); g.fill(); }
        }
        if (look.mark === 'scales') { g.globalAlpha = 0.18; g.strokeStyle = '#ffffff'; g.lineWidth = 1; for (let x = 20; x < w; x += 9) for (let y = 4; y < h; y += 7) { g.beginPath(); g.arc(x + (y % 14 ? 4 : 0), y, 4, 0.3, Math.PI - 0.3); g.stroke(); } }
        // gill line and a darker snout
        g.globalAlpha = 0.35; g.strokeStyle = look.back; g.lineWidth = 2;
        g.beginPath(); g.moveTo(w * 0.17, h * 0.2); g.quadraticCurveTo(w * 0.21, h * 0.5, w * 0.17, h * 0.8); g.stroke();
        g.globalAlpha = 1;
      });
    }
    const fishCache = {};
    function fishParts(sp) {
      if (fishCache[sp.id]) return fishCache[sp.id];
      const look = sp.look, NU = 30, NV = 20, pos = [], uv = [], idx = [];
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        let prof;
        if (sp.flat) prof = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * (u < 0.87 ? 1 : 0.15) + 0.02;
        else prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.85) * (1 - 0.74 * u) + 0.025;
        const hh = look.h * prof * 0.5, ww = look.w * prof * 0.5;
        for (let j = 0; j <= NV; j++) {
          const a = j / NV * Math.PI * 2;
          let y = Math.cos(a) * hh; const x = Math.sin(a) * ww;
          if (y < 0) y *= 1.1;
          pos.push(x, y, -0.5 + u); uv.push(u, j / NV);
        }
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j, b = a + NV + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new T.MeshStandardMaterial({ map: fishTexture(look), roughness: 0.32, metalness: 0.28 });
      const finMat = new T.MeshStandardMaterial({ color: col(look.fin), roughness: 0.5, side: T.DoubleSide });
      const shape = pts => { const s = new T.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => s.lineTo(p[0], p[1])); return new T.ShapeGeometry(s); };
      const H = look.h;
      const tail = sp.flat ? null : shape([[0, 0.04 * H / 0.3], [0.2, 0.55 * H], [0.13, 0], [0.2, -0.55 * H], [0, -0.04 * H / 0.3]]);
      const dorsal = sp.flat ? null : shape([[0, 0], [0.06, 0.32 * H], [0.26, 0.26 * H], [0.36, 0]]);
      const pect = shape([[0, 0], [0.1, 0.05], [0.12, -0.03]]);
      fishCache[sp.id] = { geo, mat, finMat, tail, dorsal, pect };
      return fishCache[sp.id];
    }
    const eyeMat = new T.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.1, metalness: 0.4 });
    const eyeRingMat = new T.MeshStandardMaterial({ color: 0xf2d27a, roughness: 0.3, metalness: 0.5 });
    /** A fish model, 1 m long along -Z (nose at -0.5); scale it by the fish's length. */
    function makeFish(sp, simple) {
      const P = fishParts(sp), g = new T.Group();
      const body = new T.Mesh(P.geo, P.mat); body.castShadow = true; g.add(body);
      const tailG = new T.Group(); tailG.position.z = 0.44; g.add(tailG);
      if (P.tail) { const tl = new T.Mesh(P.tail, P.finMat); tl.rotation.y = -Math.PI / 2; tailG.add(tl); }
      else { const whip = new T.Mesh(cyl, P.finMat); whip.scale.set(0.012, 0.9, 0.012); whip.rotation.x = Math.PI / 2; whip.position.z = 0.4; tailG.add(whip); }
      if (simple) { g.userData.tail = tailG; return g; }   // seen through the water: body and tail are enough
      if (P.dorsal) { const d = new T.Mesh(P.dorsal, P.finMat); d.rotation.y = -Math.PI / 2; d.position.set(0, sp.look.h * 0.42, -0.18); g.add(d); }
      [-1, 1].forEach(s => {
        const p = new T.Mesh(P.pect, P.finMat); p.position.set(s * sp.look.w * 0.45, -sp.look.h * 0.12, -0.28); p.rotation.set(0, s > 0 ? -2.4 : -0.7, s * 0.4); g.add(p);
        const eye = new T.Mesh(new T.SphereGeometry(sp.flat ? 0.012 : 0.022, 10, 8), eyeMat);
        const ex = s * sp.look.w * (sp.flat ? 0.08 : 0.32), ey = sp.flat ? sp.look.h * 0.6 : sp.look.h * 0.12;
        eye.position.set(ex, ey, -0.41); g.add(eye);
        const ring = new T.Mesh(new T.SphereGeometry(sp.flat ? 0.015 : 0.027, 10, 8), eyeRingMat); ring.position.set(ex * 0.97, ey, -0.405); ring.scale.z = 0.5; g.add(ring);
      });
      g.userData.tail = tailG;
      return g;
    }

    // shadows of fish under the surface
    const shadowTex = canvasTex(128, 64, (g, w, h) => {
      g.filter = 'blur(5px)';
      g.fillStyle = 'rgba(8,16,22,1)';
      g.beginPath(); g.ellipse(w * 0.42, h / 2, w * 0.3, h * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(w * 0.68, h / 2); g.lineTo(w * 0.9, h * 0.25); g.lineTo(w * 0.86, h / 2); g.lineTo(w * 0.9, h * 0.75); g.closePath(); g.fill();
    }, false);
    const shadowGeo = new T.PlaneGeometry(1, 0.62); shadowGeo.rotateX(-Math.PI / 2); shadowGeo.rotateY(-Math.PI / 2);
    function makeShadow() {
      const m = new T.Mesh(shadowGeo, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.4, fog: false }));
      m.renderOrder = 1; scene.add(m); return m;
    }

    // ---------------------------------------------------------------- ripples and spray
    const ringGeo = new T.RingGeometry(0.92, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    const ripples = [];
    for (let i = 0; i < 40; i++) {
      const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      m.visible = false; m.renderOrder = 2; scene.add(m); ripples.push({ m, t: 0, life: 1, r0: 0.1, r1: 1 });
    }
    let ripI = 0;
    function ripple(x, z, size, life) {
      const r = ripples[ripI++ % ripples.length];
      r.m.position.set(x, 0.02, z); r.t = 0; r.life = life || 1.6; r.r0 = 0.05 * size; r.r1 = 1.2 * size; r.a = Math.min(0.75, 0.35 + size * 0.25); r.m.visible = true;
    }
    const NP = 500, pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP);
    const pGeo = new T.BufferGeometry(); pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    const dropTex = canvasTex(32, 32, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    const spray = new T.Points(pGeo, new T.PointsMaterial({ size: 0.09, map: dropTex, color: 0xfff1dc, transparent: true, depthWrite: false, sizeAttenuation: true }));
    spray.frustumCulled = false; scene.add(spray);
    for (let i = 0; i < NP; i++) pPos[i * 3 + 1] = -99;
    let pI = 0;
    function splash(x, z, size, y) {
      const n = Math.round(10 + size * 40);
      for (let k = 0; k < n; k++) {
        const i = pI++ % NP, a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * (0.8 + size * 1.6);
        pPos[i * 3] = x; pPos[i * 3 + 1] = (y || 0) + 0.02; pPos[i * 3 + 2] = z;
        pVel[i * 3] = Math.cos(a) * s * 0.45; pVel[i * 3 + 1] = (1.2 + Math.random() * 2.2) * (0.6 + size); pVel[i * 3 + 2] = Math.sin(a) * s * 0.45;
        pLife[i] = 1;
      }
      ripple(x, z, 0.5 + size, 1.4 + size); ripple(x, z, 0.3 + size * 0.6, 1 + size * 0.6);
    }
    function updateFx(dt) {
      for (const r of ripples) {
        if (!r.m.visible) continue;
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { r.m.visible = false; continue; }
        const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2));
        r.m.scale.set(rad, 1, rad);
        r.m.material.opacity = r.a * (1 - k);
      }
      for (let i = 0; i < NP; i++) {
        if (pLife[i] <= 0) continue;
        pVel[i * 3 + 1] -= 9.8 * dt;
        pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        if (pPos[i * 3 + 1] < 0) { pLife[i] = 0; pPos[i * 3 + 1] = -99; }
      }
      pGeo.attributes.position.needsUpdate = true;
    }
    // golden sparkles around a landed fish
    const sparkGeo = new T.BufferGeometry(), SPN = 60, spPos = new Float32Array(SPN * 3), spVel = new Float32Array(SPN * 3);
    sparkGeo.setAttribute('position', new T.BufferAttribute(spPos, 3));
    const sparks = new T.Points(sparkGeo, new T.PointsMaterial({ size: 0.07, map: dropTex, color: 0xffd27a, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    sparks.frustumCulled = false; sparks.visible = false; scene.add(sparks);
    let sparkT = 0;
    function sparkle(p) {
      for (let i = 0; i < SPN; i++) {
        spPos[i * 3] = p.x; spPos[i * 3 + 1] = p.y; spPos[i * 3 + 2] = p.z;
        const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, s = 0.5 + Math.random() * 1.4;
        spVel[i * 3] = Math.cos(a) * Math.cos(b) * s; spVel[i * 3 + 1] = Math.sin(b) * s + 0.4; spVel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
      }
      sparkT = 1.6; sparks.visible = true;
    }
    function updateSparks(dt) {
      if (sparkT <= 0) return;
      sparkT -= dt;
      for (let i = 0; i < SPN * 3; i += 3) { spPos[i] += spVel[i] * dt; spPos[i + 1] += spVel[i + 1] * dt; spPos[i + 2] += spVel[i + 2] * dt; spVel[i + 1] -= 0.6 * dt; }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.material.opacity = Math.min(1, sparkT);
      if (sparkT <= 0) sparks.visible = false;
    }

    // ---------------------------------------------------------------- time of day
    let dayT = -1;
    /** t: 0 golden hour .. 1 the sun on the horizon (dusk). */
    function setDay(t, force) {
      t = Math.max(0, Math.min(1, t));
      if (!force && Math.abs(t - dayT) < 0.002) return;
      dayT = t;
      const P = palAt(t);
      const elev = (5.2 - 6.4 * t) * Math.PI / 180;
      sunDir.set(-0.04, Math.sin(elev), -1).normalize();
      skyU.top.value.copy(P.top); skyU.mid.value.copy(P.mid); skyU.hor.value.copy(P.hor); skyU.sunCol.value.copy(P.sun);
      skyU.glow.value = 1 + t * 0.6;
      waterU.uSunCol.value.copy(P.sun).multiplyScalar(1 - t * 0.35); waterU.uSkyTop.value.copy(P.top); waterU.uSkyMid.value.copy(P.mid); waterU.uSkyHor.value.copy(P.hor);
      waterU.uDeep.value.copy(P.deep); waterU.uShallow.value.copy(P.shallow); waterU.uFog.value.copy(P.fog);
      scene.fog.color.copy(P.fog);
      sun.color.copy(P.sun); sun.intensity = P.sunI;
      hemi.color.copy(P.hemi); hemi.groundColor.copy(P.ground); hemi.intensity = P.amb;
      skyU.cLit.value.copy(P.cLit); skyU.cDark.value.copy(P.cDark);
      const dusk = Math.max(0, (t - 0.45) / 0.55);
      lanterns.forEach(l => { l.bulbMat.emissiveIntensity = 0.6 + dusk * 2.4; l.glow.material.opacity = 0.25 + dusk * 0.7; l.light.intensity = dusk * 1.6; });
      lhGlow.material.opacity = 0.35 + dusk * 0.65;
      beamMat.uniforms.uO.value = 0.03 + dusk * 0.32;
      sunGlow.position.copy(sunDir).multiplyScalar(850); sunGlow.material.color.copy(P.sun); sunGlow.material.opacity = 0.55 - t * 0.2;
    }
    setDay(0);

    // ---------------------------------------------------------------- camera framing
    const view = { pos: new T.Vector3(0, 4.8, 8.2), look: new T.Vector3(0, 0.6, -24) };
    const camCur = { pos: view.pos.clone(), look: view.look.clone() };
    function frameFor(n, soloX) {
      if (n === 0) { view.pos.set(0, 4.2, 7.2); view.look.set(0, 0.7, -24); }   // the title
      else if (n === 1) { view.pos.set(soloX - 1.2, 4.3, 5.6); view.look.set(soloX + 0.45, 0.2, -22); }
      else if (n === 2) { view.pos.set(0, 4.9, 7.6); view.look.set(0, 0.2, -24); }
      else { view.pos.set(0, 5.6, 9.2); view.look.set(0, 0.2, -24); }
    }
    let shake = 0, baseFov = 50, fovCur = 50;
    const _tp = new T.Vector3(), _tl = new T.Vector3();
    /**
     * shot (optional): { pos, look, fov, speed, key } overrides the base framing (the game's camera
     * director: follow the cast, push in on the float, frame the fight, the catch close-up).
     */
    function updateCamera(dt, shot) {
      const k = 1 - Math.exp(-dt * ((shot && shot.speed) || 2.2));
      _tp.copy(shot && shot.pos ? shot.pos : view.pos); _tl.copy(shot && shot.look ? shot.look : view.look);
      camCur.pos.lerp(_tp, k); camCur.look.lerp(_tl, k);
      const fov = (shot && shot.fov) || baseFov;
      fovCur += (fov - fovCur) * k;
      if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
      if (shot && shot.key) key.position.copy(shot.key);
      key.intensity += ((shot && shot.key ? 2.2 : 0) - key.intensity) * k;
      camera.position.copy(camCur.pos);
      if (shake > 0) { shake = Math.max(0, shake - dt * 0.6); camera.position.x += (Math.random() - 0.5) * shake * 0.1; camera.position.y += (Math.random() - 0.5) * shake * 0.1; }
      camera.lookAt(camCur.look);
    }
    function snapCamera() { camCur.pos.copy(view.pos); camCur.look.copy(view.look); fovCur = baseFov; }

    // ---------------------------------------------------------------- per frame
    let time = 0;
    function update(dt) {
      time += dt;
      waterU.uTime.value = time;
      sun.position.copy(sunDir).multiplyScalar(40).add(new T.Vector3(0, 0, 2));
      sun.target.position.set(0, DECK_Y, 2);
      skyU.uTime.value = time;
      kelps.forEach(k => { k.rotation.z = Math.sin(time * 0.8 + k.userData.ph) * 0.18; k.rotation.x = Math.sin(time * 0.6 + k.userData.ph * 1.3) * 0.12; });
      beam.rotation.y = time * 0.45;
      boat.position.x += dt * 0.9; if (boat.position.x > 220) boat.position.x = -220;
      boat.position.y = Math.sin(time * 0.6) * 0.15; boat.rotation.z = Math.sin(time * 0.5) * 0.03;
      gulls.forEach(g => {
        const u = g.userData; u.a += u.sp * dt;
        g.position.set(u.cx + Math.cos(u.a) * u.rad, u.h + Math.sin(u.a * 2) * 2, u.cz + Math.sin(u.a) * u.rad * 0.5);
        g.rotation.y = -u.a + Math.PI; g.rotation.z = 0.25;
        const f = Math.sin(time * 5 + u.ph) * 0.45;
        u.l.rotation.z = f; u.r.rotation.z = -f;
      });
      lamp.material.color.setHSL(0.12, 1, 0.6 + 0.3 * Math.max(0, Math.sin(time * 1.2)));
      updateFx(dt); updateSparks(dt);
    }
    function render() { renderer.render(scene, camera); }
    function resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      baseFov = w / h < 1.5 ? 58 : 50;
      camera.fov = fovCur = baseFov;
      camera.updateProjectionMatrix();
    }
    function setQuality(q) {   // 2 high, 1 medium, 0 low
      renderer.shadowMap.enabled = q >= 1;
      sun.castShadow = q >= 1;
      sun.shadow.mapSize.set(q >= 2 ? 1536 : 1024, q >= 2 ? 1536 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    const _v = new T.Vector3();
    function toScreen(p) {
      _v.copy(p).project(camera);
      return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, behind: _v.z > 1 };
    }
    resize();
    function setAbove(v) { aboveObjs.forEach(o => { o.visible = v; }); }
    return {
      renderer, scene, camera, setAbove, lights: { hemi, sun, fill }, DECK_Y, bob, update, render, resize, setQuality, setDay, frameFor, updateCamera, snapCamera, toScreen,
      view, get baseFov() { return baseFov; }, createAngler, removeAngler, poseAngler, drawLine, aim, makeFish, makeShadow, ripple, splash, sparkle,
      shake: v => { shake = Math.max(shake, v); }, get time() { return time; }, sunDir,
    };
  }

  window.TideScene = { createWorld };
})();
