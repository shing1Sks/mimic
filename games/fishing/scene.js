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
    { at: 0, top: '#24407e', mid: '#f0904e', hor: '#ffc46e', sun: '#ffe2a0', sunI: 2.4, deep: '#0c2638', shallow: '#17414f', fog: '#f1a466', hemi: '#8fa6d6', ground: '#6a4434', amb: 0.6 },
    { at: 0.55, top: '#1e2f6a', mid: '#e86f45', hor: '#ffa45a', sun: '#ffc888', sunI: 1.9, deep: '#0b2133', shallow: '#153848', fog: '#e9855a', hemi: '#7c84c0', ground: '#5a3430', amb: 0.5 },
    { at: 1, top: '#141a48', mid: '#a84a62', hor: '#f27c52', sun: '#ff8a56', sunI: 0.9, deep: '#09192a', shallow: '#132e40', fog: '#8e4a5c', hemi: '#555a98', ground: '#3a2830', amb: 0.4 },
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
    scene.fog = new T.Fog(0xf1a466, 90, 700);

    // ---------------------------------------------------------------- sky
    const skyU = { top: { value: col('#3b4f86') }, mid: { value: col('#e7a06a') }, hor: { value: col('#ffd49a') }, sunDir: { value: sunDir }, sunCol: { value: col('#fff0c8') }, glow: { value: 1 } };
    const sky = new T.Mesh(new T.SphereGeometry(900, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top, mid, hor, sunDir, sunCol; uniform float glow; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, h));
          c = mix(c, top, smoothstep(0.12, 0.7, h));
          c = mix(c, hor * 0.82, smoothstep(0.0, -0.08, h));
          float s = max(dot(vP, sunDir), 0.0);
          float disk = smoothstep(0.99955, 0.99975, s);
          c += sunCol * (disk * 9.0 + pow(s, 600.0) * 1.6 + pow(s, 24.0) * 0.35 * glow + pow(s, 4.0) * 0.12 * glow);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    sky.renderOrder = -10;
    scene.add(sky);

    // clouds: soft streaks lit from below by the low sun
    const cloudTex = canvasTex(512, 128, (g, w, h) => {
      for (let i = 0; i < 26; i++) {
        const rx = 30 + Math.random() * 70, ry = 6 + Math.random() * 12;
        const x = rx + 4 + Math.random() * (w - 2 * rx - 8), y = h * (0.4 + Math.random() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, rx);
        gr.addColorStop(0, 'rgba(255,255,255,0.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, Math.PI * 2); g.fill(); g.restore();
      }
    });
    const clouds = [];
    for (let i = 0; i < 11; i++) {
      const m = new T.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, color: 0xffd2b0, opacity: 0.8 });
      const s = new T.Sprite(m);
      const a = (i / 11 - 0.5) * 2.4 + (Math.random() - 0.5) * 0.2;
      s.position.set(Math.sin(a) * 700, 55 + Math.random() * 110, -Math.cos(a) * 700);
      const sc = 260 + Math.random() * 260; s.scale.set(sc, sc * 0.22, 1);
      s.userData.drift = 0.6 + Math.random();
      scene.add(s); clouds.push(s);
    }

    // ---------------------------------------------------------------- sea
    const waterU = {
      uTime: { value: 0 }, uSun: { value: sunDir }, uSunCol: { value: col('#fff0c8') }, uSkyTop: { value: col('#24407e') }, uSkyMid: { value: col('#f0904e') }, uSkyHor: { value: col('#ffc46e') },
      uDeep: { value: col('#173847') }, uShallow: { value: col('#2f6268') }, uFog: { value: col('#f1a466') }, uFogNear: { value: 120 }, uFogFar: { value: 900 }, uDetail: { value: 1 },
    };
    const water = new T.Mesh(new T.PlaneGeometry(2400, 2400), new T.ShaderMaterial({
      uniforms: waterU, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `
        uniform float uTime, uFogNear, uFogFar, uDetail; uniform vec3 uSun, uSunCol, uSkyTop, uSkyMid, uSkyHor, uDeep, uShallow, uFog; varying vec3 vW;
        vec2 wv(vec2 p, vec2 d, float f, float sp, float a){ float ph = dot(p, d) * f + uTime * sp; return d * (a * f * cos(ph)); }
        void main(){
          vec2 p = vW.xz;
          float dist = length(cameraPosition.xz - p);
          vec2 g = wv(p, normalize(vec2(0.25, 1.0)), 0.31, 0.9, 0.16);
          g += wv(p, normalize(vec2(-0.7, 0.6)), 0.57, 1.3, 0.07);
          g += wv(p, normalize(vec2(0.9, 0.25)), 1.21, 1.9, 0.03);
          float near = smoothstep(220.0, 30.0, dist) * uDetail;   // fine ripples fade before they alias
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
          // the glitter path: tight sparkles plus a broad golden sheen toward the low sun
          float az = max(dot(normalize(vec3(-V.x, 0.0, -V.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          vec3 spec = uSunCol * (pow(s, 700.0) * 60.0 + pow(s, 90.0) * 3.0 + pow(s, 12.0) * 0.3) + uSunCol * pow(az, 60.0) * 0.18;
          vec3 base = mix(uShallow, uDeep, smoothstep(4.0, 70.0, dist));
          base += uSunCol * 0.05 * pow(max(dot(normalize(vec3(-V.x, 0.0, -V.z)), uSun), 0.0), 3.0);
          vec3 c = mix(base, skyc, fres) + spec;
          c = mix(c, uFog, smoothstep(uFogNear, uFogFar, dist));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    water.rotation.x = -Math.PI / 2;
    water.renderOrder = -5;
    scene.add(water);
    /** The swell under a floating thing at (x, z), metres (matches the shader's big waves). */
    function bob(x, z, t) {
      return 0.03 * Math.sin((0.25 * x + 1.0 * z) / 1.03 * 0.31 + t * 0.9) + 0.014 * Math.sin((-0.7 * x + 0.6 * z) / 0.92 * 0.57 + t * 1.3);
    }

    // ---------------------------------------------------------------- far shores
    const farMat = new T.MeshLambertMaterial({ color: 0x4a3d5c });
    const domeGeo = new T.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    function hills(x, z, n, spread, hMax, seed) {
      const g = new T.Group();
      let s = seed;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < n; i++) {
        const h = hMax * (0.35 + r() * 0.65), w = h * (2.6 + r() * 3);
        const m = new T.Mesh(domeGeo, farMat);
        m.position.set(x + (r() - 0.5) * spread, -1.5, z + (r() - 0.5) * spread * 0.25);
        m.scale.set(w, h, w * 0.35);
        g.add(m);
      }
      scene.add(g);
      return g;
    }
    hills(-430, -560, 12, 520, 62, 11);
    hills(420, -700, 8, 360, 40, 29);
    // the point with the lighthouse, right
    const point = hills(176, -330, 5, 80, 18, 5);
    const lh = new T.Group();
    const white = new T.MeshLambertMaterial({ color: 0xf2ede4 }), red = new T.MeshLambertMaterial({ color: 0xb8432e });
    for (let i = 0; i < 4; i++) {
      const seg = new T.Mesh(new T.CylinderGeometry(2.6 - i * 0.35, 2.95 - i * 0.35, 4.5, 12), i % 2 ? red : white);
      seg.position.y = 2.25 + i * 4.5; lh.add(seg);
    }
    const lampMat = new T.MeshBasicMaterial({ color: 0xfff1c0 });
    const lamp = new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 2, 10), lampMat); lamp.position.y = 19; lh.add(lamp);
    const cap = new T.Mesh(new T.ConeGeometry(1.9, 1.8, 10), red); cap.position.y = 20.9; lh.add(cap);
    lh.position.set(186, 12, -318);
    scene.add(lh);
    const glowTex = canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.55)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    const lhGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffe6b0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    lhGlow.position.set(186, 31, -318); lhGlow.scale.setScalar(18); scene.add(lhGlow);
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
      [-0.1, 0.1].forEach(lx => {
        const leg = shadow(new T.Mesh(new T.CylinderGeometry(0.075, 0.065, 0.62, 10), pants)); leg.position.set(lx, 0.39, 0); g.add(leg);
        const boot = shadow(new T.Mesh(new T.BoxGeometry(0.14, 0.13, 0.28), bootMat)); boot.position.set(lx, 0.065, -0.04); g.add(boot);
      });
      // a fisherman's oilskin: a coat that flares to the knee, a vest panel, rounded shoulders
      const coat = shadow(new T.Mesh(new T.CylinderGeometry(0.2, 0.25, 0.78, 16), jacket)); coat.position.y = 1.0; coat.scale.z = 0.78; g.add(coat);
      const chest = shadow(new T.Mesh(new T.SphereGeometry(0.205, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), jacket)); chest.position.y = 1.38; chest.scale.set(1, 0.55, 0.78); g.add(chest);
      const vest = new T.Mesh(new T.CylinderGeometry(0.206, 0.226, 0.4, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76), new T.MeshStandardMaterial({ color: 0x2e3a2a, roughness: 0.9, side: T.DoubleSide }));
      vest.position.y = 1.16; vest.scale.z = 0.8; g.add(vest);
      const neck = new T.Mesh(new T.CylinderGeometry(0.055, 0.06, 0.08, 10), skin); neck.position.y = 1.5; g.add(neck);
      const head = shadow(new T.Mesh(new T.SphereGeometry(0.115, 16, 12), skin)); head.position.y = 1.62; head.scale.set(0.95, 1.05, 1); g.add(head);
      const hatMat = new T.MeshStandardMaterial({ color: c, roughness: 0.65 });
      const brim = shadow(new T.Mesh(new T.CylinderGeometry(0.21, 0.25, 0.05, 24), hatMat)); brim.position.y = 1.69; g.add(brim);
      const crown = shadow(new T.Mesh(new T.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMat)); crown.position.y = 1.7; crown.scale.y = 0.85; g.add(crown);
      const band = new T.Mesh(new T.CylinderGeometry(0.137, 0.14, 0.03, 16), new T.MeshStandardMaterial({ color: 0x241c16 })); band.position.y = 1.72; g.add(band);
      scene.add(g);
      const armMat = jacket;
      const parts = {
        upper: shadow(new T.Mesh(cyl, armMat)), fore: shadow(new T.Mesh(cyl, armMat)), hand: shadow(new T.Mesh(new T.SphereGeometry(0.055, 8, 6), skin)),
        upper2: shadow(new T.Mesh(cyl, armMat)), fore2: shadow(new T.Mesh(cyl, armMat)), hand2: shadow(new T.Mesh(new T.SphereGeometry(0.055, 8, 6), skin)),
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
      // the float: white below, the player's colour on top, a little antenna
      const bob = new T.Group();
      const lower = new T.Mesh(new T.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.4 }));
      const upper = new T.Mesh(new T.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.25 }));
      const stick = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.12, 5), new T.MeshStandardMaterial({ color: 0x222222 })); stick.position.y = 0.1;
      const knob = new T.Mesh(new T.SphereGeometry(0.018, 8, 6), new T.MeshBasicMaterial({ color: c })); knob.position.y = 0.16;
      bob.add(lower, upper, stick, knob);
      scene.add(bob);
      const marker = new T.Sprite(new T.SpriteMaterial({ map: markerTex, color: c, transparent: true, depthWrite: false, depthTest: false, fog: false }));
      marker.renderOrder = 5; scene.add(marker);
      return { g, parts, grip, reel, segs, tipBead, line, lineGeo, lineMat, bob, marker, N, color: c, x, tip: new T.Vector3(), hand: new T.Vector3(), headPos: new T.Vector3(x, DECK_Y + 1.62, 0.55), visible: true };
    }
    const markerTex = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w * 0.5, w * 0.92); g.lineTo(w * 0.18, w * 0.45); g.lineTo(w * 0.82, w * 0.45); g.closePath(); g.fill();
      g.beginPath(); g.arc(w * 0.5, w * 0.34, w * 0.2, 0, Math.PI * 2); g.fill();
    });
    function removeAngler(a) {
      [a.g, a.grip, a.reel, a.tipBead, a.line, a.bob, a.marker, ...a.segs, ...Object.values(a.parts)].forEach(o => scene.remove(o));
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
      place(a.parts.upper, S, E, 0.062); place(a.parts.fore, E, W, 0.052); a.parts.hand.position.copy(W);
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
      place(a.parts.upper2, S2, E2, 0.062); place(a.parts.fore2, E2, reelHand, 0.052); a.parts.hand2.position.copy(reelHand);
      // blank: a quadratic curve whose far half leans toward the line
      const L = 2.2 - 0.12;
      const bendDir = new T.Vector3().copy(dir).lerp(bendTo || dir, Math.min(0.9, bend)).normalize();
      const P0 = gripEnd, P1 = new T.Vector3().copy(P0).addScaledVector(dir, L * 0.55);
      const P2 = new T.Vector3().copy(P1).addScaledVector(bendDir, L * 0.45 * (1 - 0.15 * bend));
      for (let i = 0; i <= ROD_SEG; i++) {
        const t = i / ROD_SEG, u = 1 - t;
        _p[i].set(0, 0, 0).addScaledVector(P0, u * u).addScaledVector(P1, 2 * u * t).addScaledVector(P2, t * t);
      }
      for (let i = 0; i < ROD_SEG; i++) place(a.segs[i], _p[i], _p[i + 1], 0.011 - i * 0.00075);
      a.tip.copy(_p[ROD_SEG]);
      a.tipBead.position.copy(a.tip);
    }
    /** Draw the line from the rod tip to `to`, sagging by `sag` metres in the middle. */
    function drawLine(a, to, sag, visible) {
      a.line.visible = visible !== false;
      if (!a.line.visible) return;
      const pos = a.lineGeo.attributes.position.array, N = a.N;
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        pos[i * 3] = a.tip.x + (to.x - a.tip.x) * s;
        pos[i * 3 + 1] = a.tip.y + (to.y - a.tip.y) * s - sag * 4 * s * (1 - s);
        pos[i * 3 + 2] = a.tip.z + (to.z - a.tip.z) * s;
      }
      a.lineGeo.attributes.position.needsUpdate = true;
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
      const finMat = new T.MeshStandardMaterial({ color: col(look.fin), roughness: 0.5, transparent: true, opacity: 0.88, side: T.DoubleSide });
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
    function makeFish(sp) {
      const P = fishParts(sp), g = new T.Group();
      const body = new T.Mesh(P.geo, P.mat); body.castShadow = true; g.add(body);
      const tailG = new T.Group(); tailG.position.z = 0.44; g.add(tailG);
      if (P.tail) { const tl = new T.Mesh(P.tail, P.finMat); tl.rotation.y = -Math.PI / 2; tailG.add(tl); }
      else { const whip = new T.Mesh(cyl, P.finMat); whip.scale.set(0.012, 0.9, 0.012); whip.rotation.x = Math.PI / 2; whip.position.z = 0.4; tailG.add(whip); }
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
    function setDay(t) {
      t = Math.max(0, Math.min(1, t));
      if (Math.abs(t - dayT) < 0.002) return;
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
      clouds.forEach(c => c.material.color.copy(P.mid).lerp(col('#fff2e0'), 0.45 - t * 0.3));
      farMat.color.copy(P.top).lerp(P.fog, 0.42).multiplyScalar(0.62);
      const dusk = Math.max(0, (t - 0.45) / 0.55);
      lanterns.forEach(l => { l.bulbMat.emissiveIntensity = 0.6 + dusk * 2.4; l.glow.material.opacity = 0.25 + dusk * 0.7; l.light.intensity = dusk * 1.6; });
      lhGlow.material.opacity = 0.35 + dusk * 0.65;
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
    let shake = 0;
    function updateCamera(dt, focus, focusAmt) {
      const k = 1 - Math.exp(-dt * 2.5);
      const targetPos = view.pos.clone(), targetLook = view.look.clone();
      if (focus && focusAmt > 0) {
        // ease toward a landed fish held up at the dock: from the side, back far enough to frame it
        const d = 0.8 + (focus.size || 0.4) * 1.5;
        targetPos.lerp(new T.Vector3(focus.x - d * 0.55, focus.y + d * 0.12, focus.z + d * 0.85), focusAmt);
        targetLook.lerp(focus, focusAmt);
        key.position.set(focus.x - d * 0.4, focus.y + 0.3, focus.z + d * 0.6);
      }
      key.intensity += ((focus ? 2.2 * focusAmt : 0) - key.intensity) * k;
      camCur.pos.lerp(targetPos, k); camCur.look.lerp(targetLook, k);
      camera.position.copy(camCur.pos);
      if (shake > 0) { shake = Math.max(0, shake - dt * 0.6); camera.position.x += (Math.random() - 0.5) * shake * 0.1; camera.position.y += (Math.random() - 0.5) * shake * 0.1; }
      camera.lookAt(camCur.look);
    }
    function snapCamera() { camCur.pos.copy(view.pos); camCur.look.copy(view.look); }

    // ---------------------------------------------------------------- per frame
    let time = 0;
    function update(dt) {
      time += dt;
      waterU.uTime.value = time;
      sun.position.copy(sunDir).multiplyScalar(40).add(new T.Vector3(0, 0, 2));
      sun.target.position.set(0, DECK_Y, 2);
      clouds.forEach(c => { c.position.x += c.userData.drift * dt; if (c.position.x > 900) c.position.x = -900; });
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
      camera.fov = w / h < 1.5 ? 58 : 50;
      camera.updateProjectionMatrix();
    }
    function setQuality(q) {   // 2 high, 1 medium, 0 low
      renderer.shadowMap.enabled = q >= 1;
      sun.castShadow = q >= 1;
      sun.shadow.mapSize.set(q >= 2 ? 1536 : 1024, q >= 2 ? 1536 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      waterU.uDetail.value = q >= 1 ? 1 : 0;
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    const _v = new T.Vector3();
    function toScreen(p) {
      _v.copy(p).project(camera);
      return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, behind: _v.z > 1 };
    }
    resize();
    return {
      renderer, scene, camera, DECK_Y, bob, update, render, resize, setQuality, setDay, frameFor, updateCamera, snapCamera, toScreen,
      createAngler, removeAngler, poseAngler, drawLine, makeFish, makeShadow, ripple, splash, sparkle,
      shake: v => { shake = Math.max(shake, v); }, get time() { return time; }, sunDir,
    };
  }

  window.TideScene = { createWorld };
})();
