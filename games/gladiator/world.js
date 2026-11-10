/*
 * Iron Ludus - the Ashen Circus: sand, podium wall, stone tiers, a living crowd, banners, torches,
 * the gate, the patron's box, sun and sky. Classic script: defines window.LudusWorld.
 *
 * Layout: arena centre at the origin, sand radius R. The duel happens near the centre with the
 * player at +Z looking toward -Z, where the gate and the patron's box are.
 */
(function () {
  'use strict';
  const T = THREE;
  const R = 24;             // sand radius
  const WALL_H = 4;         // podium wall
  const TIERS = 11, TIER_D = 1.9, TIER_H = 1.45;
  const GATE_ANGLE = -Math.PI / 2; // gate at -Z

  let preloaded = {};
  function tex(loader, url, repeat, srgb) {
    const img = preloaded[url];
    const t = img ? new T.Texture(img) : loader.load(url);
    if (img) t.needsUpdate = true;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    if (srgb) t.encoding = T.sRGBEncoding;
    return t;
  }

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  /* ---------------------------------------------------------------- crowd */
  // One sprite sheet: 4 people variants x 2 poses (seated / arms up)
  function crowdSheet() {
    return canvasTex(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const cw = w / 4, ch = h / 2;
      for (let pose = 0; pose < 2; pose++) for (let v = 0; v < 4; v++) {
        const x0 = v * cw, y0 = pose * ch, cx = x0 + cw / 2;
        g.save();
        // body (white: tinted per instance by the shader), head and hair stay natural
        g.fillStyle = '#ffffff';
        g.beginPath();
        const sh = 0.36 + v * 0.03;
        g.moveTo(cx - cw * sh, y0 + ch);
        g.quadraticCurveTo(cx - cw * (sh + 0.02), y0 + ch * 0.42, cx, y0 + ch * 0.4);
        g.quadraticCurveTo(cx + cw * (sh + 0.02), y0 + ch * 0.42, cx + cw * sh, y0 + ch);
        g.fill();
        if (pose === 1) { // arms raised
          g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = cw * 0.11;
          g.beginPath(); g.moveTo(cx - cw * 0.22, y0 + ch * 0.52); g.lineTo(cx - cw * 0.36, y0 + ch * 0.12); g.stroke();
          g.beginPath(); g.moveTo(cx + cw * 0.22, y0 + ch * 0.52); g.lineTo(cx + cw * 0.38, y0 + ch * 0.1); g.stroke();
          g.fillStyle = ['#c58c5c', '#8d5a3a', '#e0b08a', '#6b4129'][v];
          g.beginPath(); g.arc(cx - cw * 0.36, y0 + ch * 0.1, cw * 0.06, 0, 7); g.fill();
          g.beginPath(); g.arc(cx + cw * 0.38, y0 + ch * 0.08, cw * 0.06, 0, 7); g.fill();
        }
        const skin = ['#c58c5c', '#8d5a3a', '#e0b08a', '#6b4129'][v];
        g.fillStyle = skin;
        g.beginPath(); g.ellipse(cx, y0 + ch * 0.3, cw * 0.13, ch * 0.13, 0, 0, 7); g.fill();
        g.fillStyle = ['#2a1d14', '#120c08', '#6d4a22', '#3a2a1a'][v];
        g.beginPath(); g.ellipse(cx, y0 + ch * 0.22, cw * 0.14, ch * 0.08, 0, Math.PI, 0); g.fill();
        g.restore();
      }
    });
  }

  function buildCrowd(scene, sunDir) {
    const geo = new T.PlaneGeometry(0.62, 0.95);
    geo.translate(0, 0.42, 0);
    const mat = new T.ShaderMaterial({
      uniforms: { map: { value: crowdSheet() }, uTime: { value: 0 }, uExcite: { value: 0.3 },
        uSun: { value: sunDir.clone().normalize() } },
      transparent: false, alphaTest: 0.5, side: T.DoubleSide,
      vertexShader: `
        attribute vec3 aInfo; // x phase, y variant 0..3, z energy 0..1
        uniform float uTime, uExcite;
        varying vec2 vUv; varying vec3 vCol; varying float vShade; varying float vPose;
        uniform vec3 uSun;
        void main() {
          float ph = aInfo.x, v = aInfo.y, en = aInfo.z;
          float beat = sin(uTime * (5.0 + en * 3.0) + ph * 6.2831);
          float jump = max(0.0, beat) * (0.04 + 0.22 * uExcite * en);
          float pose = step(0.55 - 0.5 * uExcite * en, beat * 0.5 + 0.5) * step(0.25, uExcite * en);
          vPose = pose;
          vUv = vec2((uv.x + v) / 4.0, (uv.y * 0.5) + (1.0 - pose) * 0.5);
          vec3 p = position; p.y += jump;
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 0.0, 1.0));
          vShade = 0.55 + 0.45 * max(0.0, dot(n, uSun));
          vCol = instanceColor;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec2 vUv; varying vec3 vCol; varying float vShade; varying float vPose;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.5) discard;
          // white parts of the sheet take the tunic colour
          float white = step(0.97, min(t.r, min(t.g, t.b)));
          vec3 c = mix(t.rgb, vCol, white) * vShade;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
    const spots = [];
    for (let i = 0; i < TIERS; i++) {
      const r = R + 1.2 + i * TIER_D + 0.6, y = WALL_H + 0.6 + i * TIER_H;
      const step = 0.62 + Math.random() * 0.05;
      const n = Math.floor((2 * Math.PI * r) / step);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const da = Math.atan2(Math.sin(a - GATE_ANGLE), Math.cos(a - GATE_ANGLE));
        if (Math.abs(da) < 0.16 && i < 6) continue;     // patron's box above the gate
        if (Math.random() < 0.08) continue;              // empty seats
        spots.push({ a, r: r + (Math.random() - 0.5) * 0.25, y });
      }
    }
    const mesh = new T.InstancedMesh(geo, mat, spots.length);
    const info = new Float32Array(spots.length * 3);
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), col = new T.Color();
    const tunics = ['#e9e1cf', '#d9cfb7', '#a8352a', '#c9a24a', '#5a6f8f', '#7b4f2b', '#f2efe6', '#8c2f39', '#4e6b3a', '#c46b2d', '#d8d2c4'];
    spots.forEach((p, i) => {
      const x = Math.cos(p.a) * p.r, z = Math.sin(p.a) * p.r;
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), -p.a - Math.PI / 2); // face the centre
      const k = 0.9 + Math.random() * 0.2;
      s.set(k, k, k);
      m.compose(new T.Vector3(x, p.y, z), q, s);
      mesh.setMatrixAt(i, m);
      col.set(tunics[(Math.random() * tunics.length) | 0]).multiplyScalar(0.75 + Math.random() * 0.3);
      mesh.setColorAt(i, col);
      info[i * 3] = Math.random(); info[i * 3 + 1] = (Math.random() * 4) | 0; info[i * 3 + 2] = 0.35 + Math.random() * 0.65;
    });
    geo.setAttribute('aInfo', new T.InstancedBufferAttribute(info, 3));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, mat, count: spots.length };
  }

  /* ------------------------------------------------------------- banners */
  function bannerTex(i) {
    return canvasTex(128, 320, (g, w, h) => {
      const base = i % 2 ? '#7d1a1a' : '#8a5a14';
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, 14);
      g.strokeStyle = '#e6c066'; g.lineWidth = 5; g.strokeRect(10, 20, w - 20, h - 70);
      // swallowtail
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h - 44); g.lineTo(w, h); g.fill();
      g.globalCompositeOperation = 'source-over';
      // emblem: crossed blades under a sun disc (original design)
      g.fillStyle = '#e6c066'; g.strokeStyle = '#e6c066';
      g.beginPath(); g.arc(w / 2, 100, 26, 0, 7); g.fill();
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2;
        g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 30, 100 + Math.sin(a) * 30);
        g.lineTo(w / 2 + Math.cos(a) * 42, 100 + Math.sin(a) * 42); g.lineWidth = 4; g.stroke();
      }
      g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(30, 230); g.lineTo(w - 30, 150); g.stroke();
      g.beginPath(); g.moveTo(w - 30, 230); g.lineTo(30, 150); g.stroke();
      g.font = 'bold 22px Georgia'; g.textAlign = 'center'; g.fillText('LVDVS', w / 2, 262);
    });
  }

  /* ------------------------------------------------------------- the build */
  function build(scene, renderer, assets) {
    const L = new T.TextureLoader();
    preloaded = assets.images || {};
    const A = 'assets/tex/';
    const world = { scene, R, flames: [], banners: [], gatePos: new T.Vector3(0, 0, -R + 0.6) };

    // sky + environment
    if (assets.hdr) {
      const pm = new T.PMREMGenerator(renderer);
      // the sky HDR contains the sun disc (values in the thousands): clamp a copy for lighting so
      // the sun is not counted twice (the DirectionalLight is the sun) and skin does not wash out
      let src = assets.hdr;
      const d = src.image && src.image.data;
      if (d && d instanceof Float32Array) {
        const c = new Float32Array(d.length);
        for (let i = 0; i < d.length; i++) c[i] = (i & 3) === 3 ? d[i] : Math.min(d[i], 1.6) * 0.7;
        src = new T.DataTexture(c, src.image.width, src.image.height, src.format, T.FloatType);
        src.mapping = T.EquirectangularReflectionMapping; src.encoding = assets.hdr.encoding; src.needsUpdate = true;
      }
      const env = pm.fromEquirectangular(src).texture;
      scene.environment = env;
      scene.background = assets.hdr;
      assets.hdr.mapping = T.EquirectangularReflectionMapping;
    } else scene.background = new T.Color(0x9fc4e8);
    scene.fog = new T.Fog(0xd8c7a8, 60, 160);

    // sun
    const sunDir = new T.Vector3(-0.45, 0.8, 0.35).normalize();
    const sun = new T.DirectionalLight(0xffe6c2, 2.05);
    sun.position.copy(sunDir).multiplyScalar(30);
    sun.target.position.set(0, 0, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 5; sc.far = 70;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    scene.add(new T.HemisphereLight(0xcfe3ff, 0x9a7b55, 0.45));
    world.sun = sun;
    // dust hanging in the sunlight over the fighting ground, drifting slowly
    {
      const N = 220, pos = new Float32Array(N * 3), c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 7; pos[i * 3 + 1] = 0.2 + Math.random() * 3; pos[i * 3 + 2] = 1 + Math.random() * 6; }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const motes = new T.Points(geo, new T.PointsMaterial({ size: 0.022, map: new T.CanvasTexture(c), transparent: true, opacity: 0.42, depthWrite: false, color: 0xfff0d0 }));
      motes.frustumCulled = false; scene.add(motes); world.motes = motes;
    }

    // sand
    const sandMat = new T.MeshStandardMaterial({
      map: tex(L, A + 'aerial_sand_diff_1k.jpg', [14, 14], true),
      normalMap: tex(L, A + 'aerial_sand_nor_gl_1k.jpg', [14, 14]),
      roughnessMap: tex(L, A + 'aerial_sand_rough_1k.jpg', [14, 14]),
      color: 0xf1d2a6, roughness: 1, normalScale: new T.Vector2(0.8, 0.8),
    });
    const sand = new T.Mesh(new T.CircleGeometry(R + 0.5, 96), sandMat);
    sand.rotation.x = -Math.PI / 2; sand.receiveShadow = true;
    scene.add(sand);
    world.sand = sand;

    // podium wall
    const wallMat = new T.MeshStandardMaterial({
      map: tex(L, A + 'large_sandstone_blocks_01_diff_1k.jpg', [36, 2], true),
      normalMap: tex(L, A + 'large_sandstone_blocks_01_nor_gl_1k.jpg', [36, 2]),
      color: 0xf0dcc0, roughness: 0.95, side: T.BackSide,
    });
    const wall = new T.Mesh(new T.CylinderGeometry(R + 0.5, R + 0.5, WALL_H, 128, 1, true), wallMat);
    wall.position.y = WALL_H / 2; wall.receiveShadow = true;
    scene.add(wall);
    const lip = new T.Mesh(new T.TorusGeometry(R + 0.55, 0.18, 6, 160), new T.MeshStandardMaterial({ color: 0xd8c3a0, roughness: 0.9 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = WALL_H;
    scene.add(lip);

    // stepped tiers (lathe of a stair profile)
    const prof = [new T.Vector2(R + 0.5, WALL_H)];
    for (let i = 0; i < TIERS; i++) {
      const r0 = R + 0.5 + i * TIER_D, y0 = WALL_H + i * TIER_H;
      prof.push(new T.Vector2(r0 + TIER_D, y0));
      prof.push(new T.Vector2(r0 + TIER_D, y0 + TIER_H));
    }
    const rTop = R + 0.5 + TIERS * TIER_D, yTop = WALL_H + TIERS * TIER_H;
    prof.push(new T.Vector2(rTop + 3, yTop));
    const tierMat = new T.MeshStandardMaterial({
      map: tex(L, A + 'sandstone_blocks_08_diff_1k.jpg', [90, 12], true),
      normalMap: tex(L, A + 'sandstone_blocks_08_nor_gl_1k.jpg', [90, 12]),
      color: 0xe8d2b0, roughness: 0.95, side: T.DoubleSide,
    });
    const tiers = new T.Mesh(new T.LatheGeometry(prof, 160), tierMat);
    tiers.receiveShadow = true;
    scene.add(tiers);

    // outer arcade on top
    if (assets.arch) {
      const parts = [];
      assets.arch.traverse(o => { if (o.isMesh) parts.push(o); });
      const N = 52, rA = rTop + 1.2;
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1.9, 2.4, 1.9);
      for (const part of parts) {
        part.updateWorldMatrix(true, false);
        const im = new T.InstancedMesh(part.geometry, part.material, N);
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2;
          q.setFromAxisAngle(new T.Vector3(0, 1, 0), -a - Math.PI / 2);
          m.compose(new T.Vector3(Math.cos(a) * rA, yTop, Math.sin(a) * rA), q, s);
          im.setMatrixAt(k, m.clone().multiply(part.matrixWorld));
        }
        scene.add(im);
      }
      const ring = new T.Mesh(new T.CylinderGeometry(rA + 0.8, rA + 0.8, 1.2, 96, 1, true),
        new T.MeshStandardMaterial({ color: 0xcdb48e, roughness: 0.95, side: T.DoubleSide }));
      ring.position.y = yTop + 8.9;
      scene.add(ring);
    }

    // the gate (dark tunnel with a raised portcullis) and the patron's box above it
    const gx = 0, gz = -R - 0.35;
    const gateDark = new T.Mesh(new T.PlaneGeometry(4.2, 3.6), new T.MeshBasicMaterial({ color: 0x0b0806 }));
    gateDark.position.set(gx, 1.8, gz + 0.1);
    scene.add(gateDark);
    const frameMat = new T.MeshStandardMaterial({ color: 0xbfa27a, roughness: 0.9 });
    for (const sx of [-2.35, 2.35]) {
      const p = new T.Mesh(new T.BoxGeometry(0.5, 4, 0.7), frameMat);
      p.position.set(gx + sx, 2, gz + 0.3); p.castShadow = true; scene.add(p);
    }
    const lintel = new T.Mesh(new T.BoxGeometry(5.2, 0.5, 0.8), frameMat);
    lintel.position.set(gx, 3.85, gz + 0.3); scene.add(lintel);
    const barMat = new T.MeshStandardMaterial({ color: 0x2b2420, metalness: 0.8, roughness: 0.5 });
    const bars = new T.InstancedMesh(new T.BoxGeometry(0.07, 1.0, 0.07), barMat, 9); // one draw call for the portcullis
    for (let k = -4; k <= 4; k++) bars.setMatrixAt(k + 4, new T.Matrix4().makeTranslation(gx + k * 0.45, 3.2, gz + 0.25));
    scene.add(bars);
    // patron's box
    const box = new T.Group();
    const floor = new T.Mesh(new T.BoxGeometry(9, 0.5, 4), frameMat); floor.position.set(0, WALL_H + 2.2, -R - 3);
    box.add(floor);
    const cloth = canvasTex(256, 64, (g, w, h) => {
      for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? '#8e1b1b' : '#e8dcc4'; g.fillRect(k * 16, 0, 16, h); }
      g.fillStyle = '#e6c066'; g.fillRect(0, h - 10, w, 10);
    });
    const canopy = new T.Mesh(new T.PlaneGeometry(9.6, 4.4), new T.MeshStandardMaterial({ map: cloth, side: T.DoubleSide, roughness: 1 }));
    canopy.rotation.x = -Math.PI / 2 + 0.18; canopy.position.set(0, WALL_H + 7.0, -R - 3);
    box.add(canopy);
    for (const sx of [-4.4, -1.5, 1.5, 4.4]) {
      const c = new T.Mesh(new T.CylinderGeometry(0.22, 0.26, 4.6, 12), new T.MeshStandardMaterial({ color: 0xece0c8, roughness: 0.7 }));
      c.position.set(sx, WALL_H + 4.7, -R - 1.2); box.add(c);
    }
    const drape = new T.Mesh(new T.PlaneGeometry(9, 2.2), new T.MeshStandardMaterial({ map: bannerTex(1), color: 0xffffff, roughness: 1, side: T.DoubleSide }));
    drape.position.set(0, WALL_H + 1.2, -R - 0.9);
    box.add(drape);
    scene.add(box);

    // banners on the podium wall and torches between them
    const NB = 18;
    for (let k = 0; k < NB; k++) {
      const a = (k / NB) * Math.PI * 2 + Math.PI / NB;
      const da = Math.atan2(Math.sin(a - GATE_ANGLE), Math.cos(a - GATE_ANGLE));
      if (Math.abs(da) < 0.2) continue;
      const b = new T.Mesh(new T.PlaneGeometry(1.2, 3.0, 1, 6), new T.MeshStandardMaterial({ map: bannerTex(k), side: T.DoubleSide, roughness: 1, transparent: false, alphaTest: 0.5 }));
      const rr = R + 0.38;
      b.position.set(Math.cos(a) * rr, WALL_H - 1.55, Math.sin(a) * rr);
      b.lookAt(0, b.position.y, 0);
      b.userData.phase = Math.random() * 6;
      scene.add(b); world.banners.push(b);
    }
    const flameTex = canvasTex(64, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h * 0.65, 2, w / 2, h * 0.6, w / 2);
      gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.35, 'rgba(255,170,40,0.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.6, w / 2, h * 0.42, 0, 0, 7); g.fill();
    });
    // the torches are instanced: one draw call per part of the model instead of one per part per torch
    const torchParts = [];
    if (assets.torch) { assets.torch.updateMatrixWorld(true); assets.torch.traverse(o => { if (o.isMesh) torchParts.push({ o, im: new T.InstancedMesh(o.geometry, o.material, NB) }); }); }
    const torchRoot = new T.Object3D(), rootInv = assets.torch ? new T.Matrix4().copy(assets.torch.matrixWorld).invert() : null;
    for (let k = 0; k < NB; k++) {
      const a = (k / NB) * Math.PI * 2;
      const pos = new T.Vector3(Math.cos(a) * (R + 0.2), WALL_H - 0.9, Math.sin(a) * (R + 0.2));
      if (torchParts.length) {
        const t = torchRoot; t.position.set(0, 0, 0); t.rotation.set(0, 0, 0); t.scale.setScalar(1.6); t.position.copy(pos); t.position.y -= 0.6;
        t.lookAt(0, t.position.y, 0); t.rotateX(-0.35); t.updateMatrix();
        for (const tp of torchParts) tp.im.setMatrixAt(k, new T.Matrix4().multiplyMatrices(t.matrix, rootInv).multiply(tp.o.matrixWorld));
      }
      const f = new T.Sprite(new T.SpriteMaterial({ map: flameTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      f.position.copy(pos); f.position.y += 0.42; f.position.multiplyScalar(1); f.scale.set(0.45, 0.8, 1);
      f.userData.phase = Math.random() * 10;
      scene.add(f); world.flames.push(f);
    }

    for (const tp of torchParts) { tp.im.castShadow = tp.o.castShadow; tp.im.receiveShadow = tp.o.receiveShadow; if (tp.im.computeBoundingSphere) tp.im.computeBoundingSphere(); else tp.im.frustumCulled = false; scene.add(tp.im); }
    world.crowd = buildCrowd(scene, sunDir);
    return world;
  }

  function update(world, t, excite) {
    const c = world.crowd;
    if (c) { c.mat.uniforms.uTime.value = t; c.mat.uniforms.uExcite.value += (excite - c.mat.uniforms.uExcite.value) * 0.08; }
    for (const f of world.flames) {
      const k = 0.85 + 0.15 * Math.sin(t * 17 + f.userData.phase) + 0.08 * Math.sin(t * 31 + f.userData.phase * 2);
      f.scale.set(0.45 * k, 0.8 * (0.9 + 0.2 * k), 1);
    }
    for (const b of world.banners) b.rotation.z = Math.sin(t * 1.3 + b.userData.phase) * 0.03;
    if (world.motes && world.motes.visible) {
      const p = world.motes.geometry.attributes.position, a = p.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] += Math.sin(t * 0.3 + i) * 0.0009 + 0.0006; a[i + 1] += Math.sin(t * 0.5 + i * 1.7) * 0.0006;
        if (a[i] > 3.5) a[i] = -3.5;
      }
      p.needsUpdate = true;
    }
  }

  window.LudusWorld = { build, update, R };
})();
