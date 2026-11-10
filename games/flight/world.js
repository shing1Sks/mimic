/*
 * GYROWING world: textured terrain (Poly Haven CC0 aerial photo detail over an art-directed macro
 * colour, farm patchwork, forests, rock, snow, beaches), sea and lake with shorelines, the physical
 * sky and height fog (atmos.js), lit cumulus, instanced forests and villages, roads, and two airfields
 * (runway markings, edge/approach lights, PAPI, hangars, tower, terminal, windsock).
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const TEX = 'assets/tex/';

  const GLSL_HASH = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
`;

  function shareGeo(src, sphere) {
    const g = new THREE.BufferGeometry();
    for (const k in src.attributes) g.setAttribute(k, src.attributes[k]);
    if (src.index) g.setIndex(src.index);
    g.boundingSphere = sphere;
    return g;
  }
  /** Merge geometries, painting each a vertex colour; `shade` darkens toward the base (fake AO). */
  function mergeColored(parts, shade) {
    const pos = [], nor = [], col = [];
    for (const [geo, color] of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        const ao = shade ? 0.55 + 0.45 * clamp(p[i + 1], 0, 1) : 1;
        pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(color.r * ao, color.g * ao, color.b * ao);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }

  // ------------------------------------------------------------------ light colour keys
  // by sun elevation (deg): sun light colour + intensity, ambient, height-fog density
  const SKY_KEYS = [
    { e: -90, sun: '#000000', si: 0, amb: 0.06, fog: 0.00007 },
    { e: -14, sun: '#000000', si: 0, amb: 0.07, fog: 0.00007 },
    { e: -6, sun: '#000000', si: 0, amb: 0.12, fog: 0.00008 },
    { e: -1, sun: '#ff6a2a', si: 0.25, amb: 0.22, fog: 0.00011 },
    { e: 4, sun: '#ff9a52', si: 1.4, amb: 0.35, fog: 0.00012 },
    { e: 12, sun: '#ffd2a0', si: 2.3, amb: 0.48, fog: 0.0001 },
    { e: 28, sun: '#fff0dc', si: 2.7, amb: 0.56, fog: 0.00008 },
    { e: 90, sun: '#fff8ee', si: 3.0, amb: 0.6, fog: 0.000075 },
  ];
  function skyAt(elevDeg) {
    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].e < elevDeg) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    const t = clamp((elevDeg - a.e) / (b.e - a.e), 0, 1);
    return { sun: lin(a.sun).lerp(lin(b.sun), t), si: mix(a.si, b.si, t), amb: mix(a.amb, b.amb, t), fog: mix(a.fog, b.fog, t) };
  }

  function sunDirection(hours) {
    const lat = 42 * Math.PI / 180, dec = 14 * Math.PI / 180;
    const H = (hours - 12) * 15 * Math.PI / 180;
    const sinE = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const e = Math.asin(sinE);
    const cosA = (Math.sin(dec) - sinE * Math.sin(lat)) / (Math.cos(e) * Math.cos(lat));
    let A = Math.acos(clamp(cosA, -1, 1));
    if (H > 0) A = 2 * Math.PI - A;
    return new THREE.Vector3(Math.sin(A) * Math.cos(e), Math.sin(e), -Math.cos(A) * Math.cos(e)).normalize();
  }

  // ------------------------------------------------------------------ textures
  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function speckle(ctx, w, h, n, colors, size, rnd) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[(rnd() * colors.length) | 0];
      ctx.globalAlpha = 0.25 + rnd() * 0.35;
      ctx.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
    }
    ctx.globalAlpha = 1;
  }
  const white1 = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();

  /** Load a photo texture; onLoad(tex, meanLinearColor). Failures leave the procedural look. */
  function loadTex(url, maxAniso, onLoad) {
    new THREE.TextureLoader().load(url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
      let mean = new THREE.Color(0.5, 0.5, 0.5);
      try {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const x = c.getContext('2d'); x.drawImage(t.image, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        mean = new THREE.Color(r / 256 / 255, g / 256 / 255, b / 256 / 255).convertSRGBToLinear();
      } catch (e) { /* tainted canvas: keep grey */ }
      onLoad(t, mean);
    }, undefined, () => console.warn('[gyrowing] texture failed, keeping the procedural look:', url));
  }

  function runwayTexture(rnd, maxAniso, L, names) {
    // L m x 30 m (+ 3 m shoulders each side -> 36 m)
    const Wd = 36, W = L > 1000 ? 4096 : 2048, H = 128;
    const t = canvasTex(W, H, (ctx) => {
      const mx = W / L, my = H / Wd;
      const X = m => m * mx, Y = m => (m + Wd / 2) * my;
      ctx.fillStyle = '#4a4b4d'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#5b5a55'; ctx.fillRect(0, 0, W, Y(-15)); ctx.fillRect(0, Y(15), W, H - Y(15));
      speckle(ctx, W, H, L * 40, ['#3c3d3f', '#56575a', '#606164', '#444547'], 1.4, rnd);
      for (const [a, b] of [[250, 520], [L - 520, L - 250]]) {
        for (let i = 0; i < 70; i++) {
          const x = a + rnd() * (b - a), y = (rnd() - 0.5) * 8;
          ctx.fillStyle = 'rgba(20,20,22,' + (0.08 + rnd() * 0.14) + ')';
          ctx.fillRect(X(x), Y(y - 0.6), X(15 + rnd() * 40), my * (0.9 + rnd() * 1.6));
        }
      }
      ctx.fillStyle = 'rgba(60,60,62,0.5)';
      for (let i = 0; i < 18; i++) ctx.fillRect(X(rnd() * L), Y((rnd() - 0.5) * 24), X(10 + rnd() * 30), my * (2 + rnd() * 6));
      ctx.fillStyle = '#e9e8e1';
      ctx.fillRect(0, Y(-15), W, my * 0.9); ctx.fillRect(0, Y(14.1), W, my * 0.9);
      for (let x = 70; x < L - 70; x += 50) ctx.fillRect(X(x), Y(-0.45), X(30), my * 0.9);
      function end(flip, label) {
        ctx.save();
        if (flip) { ctx.translate(W, H); ctx.scale(-1, -1); }
        for (let i = 0; i < 6; i++) { const y = 2.2 + i * 2.1; ctx.fillRect(X(6), Y(y), X(30), my * 1.2); ctx.fillRect(X(6), Y(-y - 1.2), X(30), my * 1.2); }
        ctx.save();
        ctx.translate(X(56), Y(0)); ctx.rotate(Math.PI / 2);
        ctx.font = 'bold ' + Math.round(X(18)) + 'px Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.scale(my / mx * 0.62, 1);
        ctx.fillText(label, 0, 0);
        ctx.restore();
        ctx.fillRect(X(300), Y(-9), X(45), my * 4); ctx.fillRect(X(300), Y(5), X(45), my * 4);
        for (const [x, n] of [[150, 3], [450, 2], [600, 1]]) for (let k = 0; k < n; k++) {
          if (x > L / 2 - 30) continue;
          ctx.fillRect(X(x), Y(5 + k * 1.6), X(22), my * 0.9); ctx.fillRect(X(x), Y(-5.9 - k * 1.6), X(22), my * 0.9);
        }
        ctx.restore();
      }
      end(false, names[0]); end(true, names[1]);
      speckle(ctx, W, H, L * 6, ['#4a4b4d', '#55565a'], 1.2, rnd);
    });
    t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function asphaltTexture(rnd, maxAniso) {
    const t = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#56575a'; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 5000, ['#3f4042', '#606164', '#4c4d50'], 1.5, rnd);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return t;
  }
  function roadTexture(maxAniso) {
    const t = canvasTex(64, 256, (ctx, w, h) => {
      ctx.fillStyle = '#4b4c4e'; ctx.fillRect(0, 0, w, h);
      const r = Terrain.mulberry(5); speckle(ctx, w, h, 900, ['#3e3f41', '#5a5b5e'], 1.5, r);
      ctx.fillStyle = '#d9d6cc'; ctx.fillRect(3, 0, 2, h); ctx.fillRect(w - 5, 0, 2, h);
      ctx.fillStyle = '#d9c35a'; ctx.fillRect(w / 2 - 1, 0, 2, h * 0.55);
      ctx.fillStyle = 'rgba(70,80,50,0.9)'; ctx.fillRect(0, 0, 2, h); ctx.fillRect(w - 2, 0, 2, h);
    });
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return t;
  }
  function puffTexture(rnd) {
    return canvasTex(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 320; i++) {
        const a = rnd() * Math.PI * 2, r = 16 + rnd() * 48;
        ctx.fillStyle = 'rgba(0,0,0,' + (0.04 + rnd() * 0.12) + ')';
        ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 3 + rnd() * 12, 0, Math.PI * 2); ctx.fill();
      }
    }, false);
  }
  function signTexture(text) {
    return canvasTex(256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
      const parts = text.split('|');
      let x = 4;
      parts.forEach((p, i) => {
        const yel = i % 2 === 0;
        const pw = (w - 8) / parts.length;
        ctx.fillStyle = yel ? '#f2c230' : '#111'; ctx.fillRect(x, 4, pw - 4, h - 8);
        ctx.fillStyle = yel ? '#111' : '#f2c230';
        ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.trim(), x + (pw - 4) / 2, h / 2 + 2);
        x += pw;
      });
    });
  }

  // ------------------------------------------------------------------ build
  function build(scene, renderer, T) {
    const W = { T, fogMul: 1, fogBase: 0, islandOn: true };
    const before = new Set(scene.children);
    const rnd = T.mulberry(99);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const AP = T.AIRPORT, E = AP.elev;
    const [nA, nB, , nD] = T.noise;
    const atm = Atmos.shared;

    // ---------------- lights
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a5a3a, 0.5);
    scene.add(hemi);
    W.sun = sun; W.hemi = hemi;
    scene.fog = new THREE.FogExp2(0xb8d2ec, 0.00012);
    W.fogScale = 1100;

    // ---------------- terrain
    const V = T.V, N = T.N, CELL = T.CELL, HALF = T.HALF, H = T.heights;
    const pos = new Float32Array(V * V * 3), nor = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), field = new Float32Array(V * V), forestA = new Float32Array(V * V);
    const forestAt = (x, z) => T.fbm(nD, x * 0.00055 + 3.3, z * 0.00055 - 8.1, 3) + 0.12 * nB(x * 0.004, z * 0.004);
    W.forestAt = forestAt;
    const C = {
      sand: lin('#c2b08a'), wetSand: lin('#8f8566'), grass1: lin('#4f6a2e'), grass2: lin('#6c7a3c'), dry: lin('#8c8452'),
      forest: lin('#2b4224'), rock: lin('#7a736b'), rock2: lin('#5c574f'), snow: lin('#eef2f6'), mowed: lin('#566f36'),
    };
    const tmp = new THREE.Color();
    const hAt = (i, j) => H[clamp(j, 0, N) * V + clamp(i, 0, N)];
    const apDist = (x, z) => Math.min(...T.AIRPORTS.map(a => Math.max(a.flat[0] - x, 0, x - a.flat[1]) + Math.max(a.flat[2] - z, 0, z - a.flat[3])));
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const k = j * V + i, x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * CELL), gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * CELL);
        const nl = Math.hypot(gx, 1, gz);
        nor[k * 3] = -gx / nl; nor[k * 3 + 1] = 1 / nl; nor[k * 3 + 2] = -gz / nl;
        const g = Math.hypot(gx, gz);
        const n1 = nB(x * 0.0021, z * 0.0021), n2 = nA(x * 0.0008 + 5, z * 0.0008);
        tmp.copy(C.grass1).lerp(C.grass2, clamp(0.5 + 0.6 * n1, 0, 1));
        tmp.lerp(C.dry, clamp(0.15 + 0.4 * n2, 0, 0.6) * smoothstep(150, 500, h));
        const fd = forestAt(x, z);
        const forest = smoothstep(0.08, 0.2, fd) * smoothstep(1250, 950, h) * (1 - smoothstep(0.55, 0.8, g));
        tmp.lerp(C.forest, forest * 0.85);
        forestA[k] = forest;
        const dAp = apDist(x, z);
        tmp.lerp(C.mowed, 1 - smoothstep(0, 300, dAp));
        const rock = Math.max(smoothstep(0.5, 0.95, g), smoothstep(1000, 1450, h) * 0.8) * (0.75 + 0.25 * n1);
        tmp.lerp(n1 > 0 ? C.rock : C.rock2, rock);
        const snow = smoothstep(1250 + 160 * n1, 1420 + 160 * n1, h) * (1 - smoothstep(0.85, 1.2, g));
        tmp.lerp(C.snow, snow);
        const beach = 1 - smoothstep(1.5, 5 + 3 * n1, h);
        tmp.lerp(h < 0 ? C.wetSand : C.sand, beach);
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
        field[k] = (1 - smoothstep(0.06, 0.12, g)) * smoothstep(8, 14, h) * (1 - smoothstep(220, 320, h)) *
          (1 - smoothstep(0.02, 0.12, fd)) * smoothstep(250, 600, dAp) * smoothstep(-0.25, 0.05, n2 + 0.2);
      }
    }
    const TC = 10, CP = N / TC, SKIRT = 30;
    const extraPos = [], extraNor = [], extraCol = [], extraField = [], extraForest = [];
    let nextV = V * V;
    const skirtV = k => {
      extraPos.push(pos[k * 3], pos[k * 3 + 1] - SKIRT, pos[k * 3 + 2]); extraNor.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
      extraCol.push(col[k * 3] * 0.8, col[k * 3 + 1] * 0.8, col[k * 3 + 2] * 0.8); extraField.push(field[k]); extraForest.push(forestA[k]);
      return nextV++;
    };
    const chunkDefs = [];
    for (let cj = 0; cj < TC; cj++) for (let ci = 0; ci < TC; ci++) {
      const i0 = ci * CP, j0 = cj * CP;
      const sk = new Map();
      const skirtOf = k => { if (!sk.has(k)) sk.set(k, skirtV(k)); return sk.get(k); };
      const lods = [1, 2, 5].map(step => {
        const arr = [];
        for (let j = j0; j < j0 + CP; j += step) for (let i = i0; i < i0 + CP; i += step) {
          const a = j * V + i, b = a + step, c = a + step * V, d = c + step;
          arr.push(a, c, b, c, d, b);
        }
        if (step > 1) {
          const edge = [];
          for (let t = 0; t < CP; t += step) {
            edge.push([j0 * V + i0 + t, j0 * V + i0 + t + step]);
            edge.push([(j0 + CP) * V + i0 + t, (j0 + CP) * V + i0 + t + step]);
            edge.push([(j0 + t) * V + i0, (j0 + t + step) * V + i0]);
            edge.push([(j0 + t) * V + i0 + CP, (j0 + t + step) * V + i0 + CP]);
          }
          for (const [e0, e1] of edge) { const s0 = skirtOf(e0), s1 = skirtOf(e1); arr.push(e0, s0, e1, e1, s0, s1, e0, e1, s0, e1, s1, s0); }
        }
        return arr;
      });
      let hMin = 1e9, hMax = -1e9;
      for (let j = j0; j <= j0 + CP; j++) for (let i = i0; i <= i0 + CP; i++) { const h = H[j * V + i]; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
      chunkDefs.push({ lods, cx: -HALF + (i0 + CP / 2) * CELL, cz: -HALF + (j0 + CP / 2) * CELL, hMin, hMax });
    }
    const cat = (a, b) => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
    const aPos = new THREE.BufferAttribute(cat(pos, extraPos), 3), aNor = new THREE.BufferAttribute(cat(nor, extraNor), 3);
    const aCol = new THREE.BufferAttribute(cat(col, extraCol), 3), aField = new THREE.BufferAttribute(cat(field, extraField), 1);
    const aForest = new THREE.BufferAttribute(cat(forestA, extraForest), 1);

    // photo detail: two grasses, rock, ploughed dirt, sand, snow (each divided by its mean colour so
    // it adds texture without fighting the macro colour); uTexOn stays 0 until they arrive
    const tU = {
      tGrassA: { value: white1 }, tGrassB: { value: white1 }, tRock: { value: white1 }, tDirt: { value: white1 }, tSand: { value: white1 }, tSnow: { value: white1 },
      mGrassA: { value: new THREE.Color(1, 1, 1) }, mGrassB: { value: new THREE.Color(1, 1, 1) }, mRock: { value: new THREE.Color(1, 1, 1) },
      mDirt: { value: new THREE.Color(1, 1, 1) }, mSand: { value: new THREE.Color(1, 1, 1) }, mSnow: { value: new THREE.Color(1, 1, 1) },
      uTexOn: { value: 0 }, uDetail: { value: 1 },
    };
    const want = { tGrassA: 'forrest_ground_01_diff.jpg', tGrassB: 'aerial_grass_rock_diff.jpg', tRock: 'aerial_rocks_02_diff.jpg', tDirt: 'dirt_aerial_02_diff.jpg', tSand: 'aerial_beach_01_diff.jpg', tSnow: 'snow_field_aerial_diff.jpg' };
    let loaded = 0;
    Object.entries(want).forEach(([k, f]) => loadTex(TEX + f, maxAniso, (t, mean) => {
      tU[k].value = t; tU['m' + k.slice(1)].value.copy(mean);
      if (++loaded === Object.keys(want).length) tU.uTexOn.value = 1;
    }));
    W.terrainTexReady = () => tU.uTexOn.value === 1;
    W.treeFar = 5000;
    W.setDetail = level => { tU.uDetail.value = level > 0 ? 1 : 0; W.treeFar = level >= 2 ? 8000 : level === 1 ? 5000 : 3500; };

    const tmat = new THREE.MeshLambertMaterial({ vertexColors: true });
    tmat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tU);
      sh.vertexShader = 'attribute float field;\nattribute float forest;\nvarying float vField;\nvarying float vForest;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvField = field; vForest = forest; vWN = normal;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = `varying float vField; varying float vForest; varying vec3 vWPos; varying vec3 vWN;
uniform sampler2D tGrassA, tGrassB, tRock, tDirt, tSand, tSnow;
uniform vec3 mGrassA, mGrassB, mRock, mDirt, mSand, mSnow;
uniform float uTexOn, uDetail;
vec3 two(sampler2D t, vec2 p, float s1, float s2) {
  if (uDetail < 0.5) return texture2D(t, p / s1).rgb;   // performance tier: one scale only
  return mix(texture2D(t, p / s1).rgb, texture2D(t, p / s2 + 0.37).rgb, 0.45);
}
// texture detail relative to its mean: mostly brightness, a little hue, bounded
vec3 rel(vec3 c, vec3 m, float k) { float l = dot(c, vec3(0.3, 0.55, 0.15)) / max(dot(m, vec3(0.3, 0.55, 0.15)), 1e-3); return clamp(mix(vec3(l), c / max(m, vec3(1e-3)), k), vec3(0.45), vec3(1.6)); }
` + GLSL_HASH +
        sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  float dist = length(vWPos - cameraPosition);
  float plough = 0.0;
  if (vField > 0.01) {
    vec2 p = mat2(0.94, 0.34, -0.34, 0.94) * vWPos.xz;
    vec2 cs = vec2(230.0, 150.0);
    float row = floor(p.y / cs.y);
    p.x += hash12(vec2(row, 7.0)) * cs.x;
    vec2 c = floor(p / cs);
    vec2 f = fract(p / cs);
    float hs = hash12(c);
    vec3 fc;
    if (hs < 0.28) fc = vec3(0.105, 0.20, 0.045);
    else if (hs < 0.46) { fc = vec3(0.36, 0.30, 0.10); plough = 0.5; }
    else if (hs < 0.60) { fc = vec3(0.17, 0.11, 0.06); plough = 1.0; }
    else if (hs < 0.82) fc = vec3(0.16, 0.25, 0.06);
    else fc = vec3(0.27, 0.29, 0.10);
    float st = 0.9 + 0.1 * sin((hs > 0.5 ? p.x : p.y) * 1.6);
    fc *= mix(st, 1.0, smoothstep(250.0, 1200.0, dist));
    vec2 e = min(f, 1.0 - f) * cs;
    float hedge = (1.0 - smoothstep(1.5, 4.5, min(e.x, e.y))) * (1.0 - smoothstep(1500.0, 5000.0, dist));
    fc = mix(fc, vec3(0.045, 0.075, 0.025), hedge * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, fc, clamp(vField, 0.0, 1.0) * 0.9);
    plough *= vField * (1.0 - hedge);
  }
  diffuseColor.rgb *= 0.86 + 0.28 * vnoise(vWPos.xz * 0.0013 + 3.0);
  if (uTexOn > 0.5) {
    vec2 p = vWPos.xz;
    vec3 n = normalize(vWN);
    float slope = 1.0 - n.y;
    float h = vWPos.y;
    float gmix = smoothstep(0.35, 0.65, vnoise(p * 0.004));
    vec3 grass = mix(rel(two(tGrassA, p, 14.0, 97.0), mGrassA, 0.3), rel(two(tGrassB, p, 31.0, 211.0), mGrassB, 0.15), gmix * 0.6 + 0.1);
    vec3 detail = mix(grass, rel(two(tDirt, p, 29.0, 151.0), mDirt, 0.5), plough);
    detail = mix(detail, rel(two(tGrassB, p, 11.0, 73.0), mGrassB, 0.0) * 0.85, vForest * 0.7);
    // broad mottling (patches of lusher and drier grass) so open ground never reads as one flat colour
    float mott = uDetail > 0.5 ? rel(texture2D(tGrassB, p / 520.0 + 0.11).rgb, mGrassB, 0.0).r : 1.0;
    detail *= mix(1.0, mott, 0.55 * (1.0 - vForest));
    vec3 colr = diffuseColor.rgb * detail;
    float wRock = max(smoothstep(0.09, 0.22, slope), smoothstep(950.0, 1350.0, h) * 0.85);
    vec3 ry = two(tRock, p, 130.0, 520.0), rk = ry;
    if (uDetail > 0.5 && wRock > 0.01) {
      vec3 rx = mix(texture2D(tRock, vWPos.zy / 150.0).rgb, texture2D(tRock, vWPos.zy / 47.0 + 0.3).rgb, 0.5);
      vec3 rz = mix(texture2D(tRock, vWPos.xy / 150.0).rgb, texture2D(tRock, vWPos.xy / 47.0 + 0.6).rgb, 0.5);
      rk = mix(ry, mix(rx, rz, abs(n.z) / (abs(n.x) + abs(n.z) + 1e-4)), smoothstep(0.12, 0.4, slope));
    }
    // keep the art-directed rock colour, take only the photo's light and shade (no visible tiling hue)
    rk = diffuseColor.rgb * rel(rk, mRock, 0.25) * (0.85 + 0.3 * vnoise(p * 0.006));
    colr = mix(colr, rk, wRock * 0.9);
    float wSnow = smoothstep(1230.0, 1400.0, h) * (1.0 - smoothstep(0.22, 0.4, slope));
    colr = mix(colr, two(tSnow, p, 70.0, 320.0) * 1.15, wSnow);
    float wSand = 1.0 - smoothstep(1.5, 5.0, h);
    colr = mix(colr, two(tSand, p, 23.0, 140.0) * mix(0.62, 1.0, smoothstep(-2.0, 1.5, h)), wSand);
    diffuseColor.rgb = colr;
  } else {
    float dn = vnoise(vWPos.xz * 0.3) * 0.5 + vnoise(vWPos.xz * 0.045) * 0.5;
    diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * dn, 1.0 - smoothstep(120.0, 1500.0, dist));
  }
}`);
    };
    tmat.customProgramCacheKey = () => 'gw-terrain';
    const terrain = new THREE.Group();
    const chunkR = CP * CELL * 0.7072;
    const tchunks = chunkDefs.map(cd => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', aPos); g.setAttribute('normal', aNor); g.setAttribute('color', aCol); g.setAttribute('field', aField); g.setAttribute('forest', aForest);
      const idxAttrs = cd.lods.map(a => new THREE.BufferAttribute(new Uint32Array(a), 1));
      g.setIndex(idxAttrs[0]);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cd.cx, (cd.hMin + cd.hMax) / 2, cd.cz), Math.hypot(chunkR, (cd.hMax - cd.hMin) / 2 + SKIRT));
      const m = new THREE.Mesh(g, tmat);
      m.receiveShadow = true; m.matrixAutoUpdate = false;
      terrain.add(m);
      return { m, g, idxAttrs, cx: cd.cx, cz: cd.cz, lod: 0 };
    });
    scene.add(terrain);
    W.terrain = terrain;
    W.updateTerrainLod = function (cam) {
      for (const c of tchunks) {
        const d = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - chunkR) + Math.max(0, cam.y - 600) * 0.5;
        const lod = d < 1800 ? 0 : d < 6500 ? 1 : 2;
        if (lod !== c.lod) { c.g.setIndex(c.idxAttrs[lod]); c.lod = lod; }
        c.m.receiveShadow = d < 300;
      }
    };

    // ---------------- water: sky reflection, sun glitter, shallows and surf from a depth map
    const depthData = new Uint8Array(V * V * 4);
    for (let k = 0; k < V * V; k++) { const d = clamp(-H[k], 0, 30) / 30; depthData[k * 4] = Math.round(d * 255); depthData[k * 4 + 1] = H[k] > 0 ? 255 : 0; depthData[k * 4 + 3] = 255; }
    const depthTex = new THREE.DataTexture(depthData, V, V); depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
    const waterU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uDeep: { value: lin('#0b2633') }, uShallow: { value: lin('#2f8a8a') },
      uDepth: { value: null }, uSize: { value: T.SIZE }, uNight: { value: 0 },
    }]);
    waterU.uDepth.value = depthTex;
    Object.assign(waterU, atm);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(140000, 140000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: waterU, fog: true,
      vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: `uniform float uTime, uSize, uNight; uniform vec3 uSunDir, uSunColor, uZen, uHor, uDeep, uShallow; uniform sampler2D uDepth;
varying vec3 vW;
#include <fog_pars_fragment>
${GLSL_HASH}
vec2 wv(vec2 p, vec2 d, float f, float a, float s){ float ph = dot(p, d) * f + uTime * s; return d * (a * f * cos(ph)); }
void main(){
  vec2 p = vW.xz; vec2 g = vec2(0.0);
  g += wv(p, vec2(0.96, 0.28), 0.055, 0.28, 0.9);
  g += wv(p, vec2(-0.37, 0.93), 0.1, 0.13, 1.4);
  g += wv(p, vec2(0.66, -0.75), 0.21, 0.05, 2.1);
  g += wv(p, vec2(-0.98, -0.2), 0.47, 0.022, 3.0);
  g += wv(p, vec2(0.2, 0.98), 1.1, 0.008, 4.2);
  g += wv(p, vec2(-0.7, 0.71), 2.3, 0.003, 5.5);
  float dist = length(cameraPosition - vW);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(600.0, 9000.0, dist) * 0.85));
  vec3 v = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHor, uZen, pow(clamp(r.y, 0.0, 1.0), 0.5));
  vec2 uv = (vW.xz + 0.5 * uSize) / uSize;
  vec4 dm = texture2D(uDepth, uv);
  float depth = dm.r * 30.0;
  bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
  if (!inside) depth = 30.0;
  float shallow = 1.0 - smoothstep(0.5, 9.0, depth);
  vec3 body = mix(uDeep, uShallow, shallow * 0.85) * (0.35 + 0.65 * clamp(length(uHor) * 1.2, 0.0, 1.0));
  vec3 col = mix(body, sky, fres * (1.0 - 0.5 * shallow));
  float spec = pow(max(dot(r, uSunDir), 0.0), 420.0) * 6.0 + pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.12;
  col += uSunColor * spec;
  // surf: a moving foam line where the water gets shallow
  float shore = (1.0 - smoothstep(0.0, 1.6, depth)) * (inside ? 1.0 : 0.0);
  float wave = 0.5 + 0.5 * sin(depth * 5.0 - uTime * 1.6 + vnoise(p * 0.05) * 6.0);
  float foam = shore * smoothstep(0.55, 0.9, wave * (0.6 + 0.6 * vnoise(p * 0.35 + uTime * 0.2)));
  foam = max(foam, (1.0 - smoothstep(0.0, 0.35, depth)) * 0.7 * (inside ? 1.0 : 0.0));
  col = mix(col, vec3(0.85, 0.88, 0.9) * (0.25 + 0.75 * clamp(length(uHor), 0.0, 1.0)), foam * (1.0 - smoothstep(800.0, 4000.0, dist)));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
}`,
    }));
    water.position.y = 0;
    scene.add(water);
    W.water = water;

    // ---------------- sky
    const sky = Atmos.createSky();
    scene.add(sky.mesh);
    W.sky = sky.mesh; W.skyObj = sky;

    // ---------------- clouds: instanced camera-facing puffs, built into cumulus with flat bases
    const puffTex = puffTexture(rnd);
    const cloudPuffs = [];
    for (let c = 0; c < 95; c++) {
      let cx, cz, tries = 0;
      do { cx = (rnd() - 0.5) * 34000; cz = (rnd() - 0.5) * 34000; tries++; } while (Math.hypot(cx + 2500, cz) < 1800 && tries < 10);
      const base = 1450 + rnd() * 500, wdt = 260 + rnd() * 650, ht = 220 + rnd() * 420;
      const n = 18 + ((rnd() * 22) | 0);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * wdt;
        const dome = Math.sqrt(Math.max(0, 1 - (r / wdt) * (r / wdt)));
        const y = (0.1 + 0.9 * rnd()) * ht * dome;
        const size = 160 + rnd() * 200 * (0.6 + dome);
        cloudPuffs.push([cx + Math.cos(a) * r, base + y + size * 0.25, cz + Math.sin(a) * r * 0.75, size, y / ht, rnd() * 6.28, 0.95 + rnd() * 0.05]);
      }
      for (let i = 0; i < 5; i++) cloudPuffs.push([cx + (rnd() - 0.5) * wdt * 1.1, base + 40, cz + (rnd() - 0.5) * wdt * 0.6, wdt * 0.7, 0, rnd() * 6.28, 0.55]);
    }
    const cg = new THREE.InstancedBufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    cg.setIndex([0, 1, 2, 0, 2, 3]);
    const offs = new Float32Array(cloudPuffs.length * 3), prm = new Float32Array(cloudPuffs.length * 4);
    cloudPuffs.forEach((p, i) => { offs.set([p[0], p[1], p[2]], i * 3); prm.set([p[3], p[4], p[5], p[6]], i * 4); });
    cg.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 3));
    cg.setAttribute('params', new THREE.InstancedBufferAttribute(prm, 4));
    cg.instanceCount = cloudPuffs.length;
    const cloudU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color() },
    }]);
    cloudU.map.value = puffTex;
    Object.assign(cloudU, atm);
    const clouds = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: cloudU, transparent: true, depthWrite: false, fog: true,
      vertexShader: `attribute vec3 offset; attribute vec4 params; varying vec2 vUv; varying float vShade; varying float vA; varying vec3 vView; varying vec2 vQ;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = viewMatrix * vec4(offset, 1.0);
  float c = cos(params.z), s = sin(params.z);
  vec2 p = mat2(c, -s, s, c) * position.xy;
  mvPosition.xy += p * params.x;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv; vQ = position.xy; vShade = params.y; vA = params.w * smoothstep(40.0, 300.0, -mvPosition.z);
  vView = normalize(offset - cameraPosition);
#include <fog_vertex>
}`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uLit, uShade, uSunDir, uGlow; varying vec2 vUv; varying float vShade; varying float vA; varying vec3 vView; varying vec2 vQ;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(map, vUv);
  // light from above and from the sun's side of the puff; dark flat bases
  float up = vQ.y + 0.5;
  float lit = clamp(vShade * 0.9 + up * 0.55 + 0.05, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  float fw = pow(max(dot(vView, uSunDir), 0.0), 8.0);
  col += uGlow * fw * (1.0 - t.a) * 1.4 + uGlow * fw * 0.25;
  gl_FragColor = vec4(col, min(1.0, t.a * 1.35) * vA);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
}`,
    }));
    clouds.frustumCulled = false; clouds.renderOrder = 5;
    scene.add(clouds);
    W.clouds = clouds;

    // ---------------- materials shared by the airfields
    const metal = new THREE.MeshLambertMaterial({ color: lin('#9aa6ae') });
    const metalDark = new THREE.MeshLambertMaterial({ color: lin('#59636b') });
    const concrete = new THREE.MeshLambertMaterial({ color: lin('#b9b4aa') });
    const glass = new THREE.MeshLambertMaterial({ color: lin('#27404f'), emissive: lin('#000000') });
    const ironMat = new THREE.MeshLambertMaterial({ color: lin('#c2c8cc') });
    loadTex(TEX + 'corrugated_iron_02_diff.jpg', maxAniso, t => { t.repeat.set(4, 1.2); ironMat.map = t; ironMat.color.setRGB(1.5, 1.5, 1.5); ironMat.needsUpdate = true; });
    const asph = asphaltTexture(rnd, maxAniso);
    const yel = new THREE.MeshBasicMaterial({ color: lin('#c9a227'), polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const apGroup = new THREE.Group(); scene.add(apGroup);
    W.lightMats = [];

    // airfield lights: custom points that scale with distance and glow at night
    const lightPos = [], lightCol = [], lightSize = [];
    const addLight = (x, y, z, c, s) => { lightPos.push(x, y, z); const cc = lin(c); lightCol.push(cc.r, cc.g, cc.b); lightSize.push(s || 1); return lightPos.length / 3 - 1; };
    const pointsMat = (extra) => new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uNight: { value: 0 }, uBase: { value: extra.base } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 color; attribute float size; uniform float uScale, uNight, uBase; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
  float px = size * uScale * (3.0 + 5.0 * uNight) * clamp(400.0 / d, 0.35, 3.0);
  gl_PointSize = clamp(px, 1.5, 30.0); vC = color; vA = (uBase + (1.0 - uBase) * uNight) * smoothstep(60000.0, 8000.0, d);
  gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; float a = 1.0 - smoothstep(0.0, 1.0, r); a *= a;
  float core = 1.0 - smoothstep(0.0, 0.35, r);
  gl_FragColor = vec4(vC * (1.0 + core * 1.5), a * vA); }`,
    });
    W.pointsMat = pointsMat;
    const papis = [];
    const obstacles = new Map();
    const okey = (x, z) => ((Math.floor(x / 60) + 1000) * 4000 + (Math.floor(z / 60) + 1000));
    const addObstacle = (o) => { const k = okey(o.x, o.z); if (!obstacles.has(k)) obstacles.set(k, []); obstacles.get(k).push(o); };
    W.addObstacle = addObstacle;

    const slabMats = [];
    loadTex(TEX + 'asphalt_02_diff.jpg', maxAniso, t => slabMats.forEach(m => {
      const c = t.clone(); c.needsUpdate = true; c.repeat.copy(m.map.repeat).multiplyScalar(20 / 8); m.map = c; m.color.multiplyScalar(1.25); m.needsUpdate = true;
    }));
    function slab(r, y, elev, color, repeat) {
      const w = r[1] - r[0], d = r[3] - r[2];
      const tex = asph.clone(); tex.needsUpdate = true; tex.repeat.set(w / (repeat || 20), d / (repeat || 20));
      const mat = new THREE.MeshLambertMaterial({ map: tex, color: color || 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      slabMats.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
      m.position.set((r[0] + r[1]) / 2, elev + y, (r[2] + r[3]) / 2); m.receiveShadow = true;
      apGroup.add(m); return m;
    }
    const tline = (x0, x1, z0, z1, elev) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.3, x1 - x0), Math.max(0.3, z1 - z0)).rotateX(-Math.PI / 2), yel);
      m.position.set((x0 + x1) / 2, elev + 0.05, (z0 + z1) / 2); apGroup.add(m);
    };
    function shadowAll(g) { g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
    function hangar(x, z, w, d, h, elev, rot, doorTowardMinusZ) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ironMat); body.position.y = h / 2; g.add(body);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 20, 1, false, -Math.PI / 2, Math.PI), ironMat);
      roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.28); roof.position.y = h; g.add(roof);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.85), metalDark); door.position.set(0, h * 0.425, (doorTowardMinusZ === false ? 1 : -1) * (d / 2 + 0.05)); if (doorTowardMinusZ !== false) door.rotation.y = Math.PI; g.add(door);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.6, d * 1.01), metalDark); band.position.y = 0.3; g.add(band);
      g.position.set(x, elev, z); g.rotation.y = rot || 0; shadowAll(g);
      apGroup.add(g);
      addObstacle({ x, z, y0: elev, y1: elev + h + w * 0.14, r: Math.max(w, d) * 0.55, kind: 'building' });
    }
    function windsock(x, z, elev) {
      const sock = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), metalDark); pole.position.y = 3; sock.add(pole);
      const pivot = new THREE.Group(); pivot.position.y = 5.9; sock.add(pivot);
      const sockTex = canvasTex(64, 16, (ctx, w, h) => { for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#f4f4f0' : '#ff6a1a'; ctx.fillRect(i * w / 5, 0, w / 5 + 1, h); } });
      const sockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.22, 3.2, 10, 1, true).rotateZ(Math.PI / 2).translate(1.6, 0, 0),
        new THREE.MeshLambertMaterial({ map: sockTex, side: THREE.DoubleSide }));
      pivot.add(sockMesh);
      // a ring of white stones at the foot
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe8e8e0, polygonOffset: true, polygonOffsetFactor: -2 }));
      ring.position.y = 0.05; sock.add(ring);
      sock.position.set(x, elev, z); apGroup.add(sock);
      return { pivot, mesh: sockMesh };
    }
    function sign(x, z, elev, text, rotY) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.3), [metalDark, metalDark, metalDark, metalDark, new THREE.MeshBasicMaterial({ map: signTexture(text) }), new THREE.MeshBasicMaterial({ map: signTexture(text) })]);
      box.position.y = 0.75; g.add(box);
      for (const sx of [-1.2, 1.2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), metalDark); leg.position.set(sx, 0.2, 0); g.add(leg); }
      g.position.set(x, elev, z); g.rotation.y = rotY || 0; apGroup.add(g);
    }

    // ---------------- runways (both fields): pavement, markings, edge/threshold/approach lights, PAPI
    function runwayOf(ap) {
      const r = ap.runway;
      const zAxis = r.axis === 'z';
      const L = zAxis ? r.z1 - r.z0 : r.x1 - r.x0;
      const tex = runwayTexture(rnd, maxAniso, L, r.names);
      const geo = new THREE.PlaneGeometry(L, 36).rotateX(-Math.PI / 2);
      if (zAxis) geo.rotateY(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      if (zAxis) mesh.position.set(r.x, ap.elev + 0.03, (r.z0 + r.z1) / 2); else mesh.position.set((r.x0 + r.x1) / 2, ap.elev + 0.03, r.z);
      mesh.receiveShadow = true; apGroup.add(mesh);
      // a frame along the runway: s = distance from the first-named threshold, t = right of centreline
      const hw = zAxis ? r.halfWidth : 15;
      const at = zAxis ? ((s, t) => [r.x + t, r.z1 - s]) : ((s, t) => [r.x0 + s, r.z + t]);
      const e = ap.elev;
      for (let s = 0; s <= L + 0.1; s += 60) for (const t of [-hw - 1.5, hw + 1.5]) { const [x, z] = at(s, t); addLight(x, e + 0.4, z, '#fff6dc'); }
      for (let t = -hw; t <= hw; t += 3) {
        let [x, z] = at(-1, t); addLight(x, e + 0.3, z, '#38ff6a'); [x, z] = at(L + 1, t); addLight(x, e + 0.3, z, '#38ff6a');
        [x, z] = at(-3, t); addLight(x, e + 0.3, z, '#ff3030', 0.8); [x, z] = at(L + 3, t); addLight(x, e + 0.3, z, '#ff3030', 0.8);
      }
      for (let s = -30; s >= -420; s -= 30) { const [x, z] = at(s, 0); addLight(x, e + 0.6 - s * 0.003, z, '#ffffff', 1.3); }
      for (let t = -12; t <= 12; t += 2) { const [x, z] = at(-150, t); addLight(x, e + 1.1, z, '#ffffff', 1.1); }
      // light fixtures (small posts) along the edges, only near the runway so they read on the ground
      const fixG = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 6);
      const fixN = Math.floor(L / 60) * 2 + 2;
      const fix = new THREE.InstancedMesh(fixG, metalDark, fixN);
      let fi = 0; const m4 = new THREE.Matrix4();
      for (let s = 0; s <= L + 0.1 && fi < fixN; s += 60) for (const t of [-hw - 1.5, hw + 1.5]) { const [x, z] = at(s, t); m4.makeTranslation(x, e + 0.2, z); fix.setMatrixAt(fi++, m4); }
      fix.count = fi; apGroup.add(fix);
      // PAPI on the left of the first-named runway, abeam its aiming point
      const aim = zAxis ? (r.z1 - ap.aimPoint) : ap.aimPoint;
      const sAim = zAxis ? ap.aimPoint : ap.aimPoint - r.x0;
      const units = [-46, -40, -34, -28].map(t => at(sAim, t));
      const idx = units.map(([x, z]) => addLight(x, e + 0.9, z, '#ffffff', 1.5));
      units.forEach(([x, z]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.0), metalDark); b.position.set(x, e + 0.45, z); apGroup.add(b); });
      const back = zAxis ? { x: 0, z: 1 } : { x: -1, z: 0 };   // unit vector toward the approaching aircraft
      papis.push({ units, idx, e, back });
      void aim;
      return { at, L, hw };
    }
    runwayOf(AP);
    const rwB = runwayOf(T.BROOK);

    // ---------------- Gyrowing Field: taxiways, apron, buildings
    AP.paved.slice(1).forEach(r => slab(r, 0.02, E, 0xd8d8d8));
    tline(-660, 660, 89.85, 90.15, E); tline(-660.15, -659.85, 15, 90, E); tline(-0.15, 0.15, 15, 90, E); tline(659.85, 660.15, 15, 90, E);
    // apron: lead-in lines and stand numbers
    const standTex = canvasTex(1024, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#d6b02c'; ctx.lineWidth = 5; ctx.fillStyle = '#d6b02c'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center';
      for (let i = 0; i < 7; i++) {
        const x = 70 + i * 147;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h * 0.78); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 40, h * 0.78); ctx.lineTo(x + 40, h * 0.78); ctx.stroke();
        ctx.fillText(String(i + 1), x + 30, h * 0.7);
      }
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(w, 6); ctx.stroke();
    });
    const stands = new THREE.Mesh(new THREE.PlaneGeometry(420, 70).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: standTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    stands.position.set(0, E + 0.06, 135); apGroup.add(stands);
    hangar(-150, 225, 36, 30, 9, E); hangar(-105, 225, 30, 28, 8, E); hangar(80, 225, 40, 32, 10, E); hangar(135, 225, 28, 26, 8, E);
    // terminal: a long low block with a glass band
    const term = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.BoxGeometry(48, 7, 14), concrete); tb.position.y = 3.5; term.add(tb);
    const tg = new THREE.Mesh(new THREE.BoxGeometry(48.2, 2.6, 14.2), glass); tg.position.y = 4.3; term.add(tg);
    const tr = new THREE.Mesh(new THREE.BoxGeometry(50, 0.6, 16), metalDark); tr.position.y = 7.2; term.add(tr);
    term.position.set(-10, E, 212); shadowAll(term); apGroup.add(term);
    addObstacle({ x: -10, z: 212, y0: E, y1: E + 8, r: 26, kind: 'building' });
    W.terminalGlass = tg;
    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 18, 12), concrete); shaft.position.y = 9; tower.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.6, 4, 8), glass); cab.position.y = 20; tower.add(cab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.0, 0.8, 8), concrete); cap.position.y = 22.4; tower.add(cap);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 4), metalDark); ant.position.y = 25.6; tower.add(ant);
    const base = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 12), concrete); base.position.set(0, 2.5, 6); tower.add(base);
    tower.position.set(270, E, 150); shadowAll(tower);
    apGroup.add(tower);
    addObstacle({ x: 270, z: 150, y0: E, y1: E + 28, r: 6, kind: 'building' });
    addLight(270, E + 28.8, 150, '#ff3020', 1.2);
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 14), new THREE.MeshLambertMaterial({ color: lin('#dcdcd2') }));
      tank.position.set(-260 + i * 8, E + 3, 150); tank.castShadow = true; apGroup.add(tank);
    }
    // car park beside the terminal (cars added by life.js)
    slab([-60, 30, 250, 290], 0.02, E, 0xbfbfbf, 10);
    W.carPark = { x0: -55, x1: 25, z0: 255, z1: 285, y: E };
    // taxiway signs at the hold points
    sign(-668 + 12, 22, E, 'A | 09-27', Math.PI / 2); sign(14, 24, E, 'B | 09-27', 0); sign(674, 22, E, 'C | 09-27', Math.PI / 2);
    const sockA = windsock(-420, -45, E);

    // ---------------- Brookfield: a small apron, two hangars, a windsock
    const BK = T.BROOK, EB = BK.elev;
    BK.paved.slice(1).forEach(r => slab(r, 0.02, EB, 0xd0d0d0));
    tline(8212, 8290, -0.15, 0.15, EB);
    hangar(8310, -20, 24, 20, 7, EB, Math.PI / 2); hangar(8310, 22, 20, 18, 6, EB, Math.PI / 2);
    const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 6), concrete); hut.position.set(8300, EB + 1.6, 55); hut.castShadow = true; apGroup.add(hut);
    const sockB = windsock(BK.runway.x - 40, BK.runway.z1 - 140, EB);
    W.socks = [sockA, sockB];
    void rwB;

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
    const lcol = new THREE.Float32BufferAttribute(lightCol, 3); lg.setAttribute('color', lcol);
    lg.setAttribute('size', new THREE.Float32BufferAttribute(lightSize, 1));
    const rwyLights = new THREE.Points(lg, pointsMat({ base: 0.55 }));
    rwyLights.frustumCulled = false;
    apGroup.add(rwyLights);
    W.lightMats.push(rwyLights.material);
    const papiRed = lin('#ff2a1a'), papiWhite = lin('#ffffff');
    const papiThresh = [2.5, 2.83, 3.17, 3.5];
    W.updatePapi = function (view) {
      for (const P of papis) for (let i = 0; i < 4; i++) {
        const [x, z] = P.units[i];
        const dx = view.x - x, dz = view.z - z;
        const ahead = dx * P.back.x + dz * P.back.z;
        const ang = Math.atan2(view.y - (P.e + 0.9), Math.hypot(dx, dz)) * 180 / Math.PI;
        const c = (ahead > 0 && ang > papiThresh[i]) ? papiWhite : papiRed;
        lcol.setXYZ(P.idx[i], c.r, c.g, c.b);
      }
      lcol.needsUpdate = true;
    };

    // ---------------- trees (instanced, chunked so the frustum culls them)
    const treeCon = mergeColored([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.3, 5, 1, true).translate(0, 0.15, 0), lin('#4b3524')],
      [new THREE.ConeGeometry(0.44, 0.42, 8, 1, true).translate(0, 0.38, 0), lin('#23402a')],
      [new THREE.ConeGeometry(0.36, 0.38, 8, 1, true).translate(0, 0.58, 0), lin('#27462c')],
      [new THREE.ConeGeometry(0.27, 0.34, 7, 1, true).translate(0, 0.76, 0), lin('#2c4d2f')],
      [new THREE.ConeGeometry(0.16, 0.3, 6, 1, true).translate(0, 0.93, 0), lin('#325533')],
    ], true);
    const treeDec = mergeColored([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.45, 5, 1, true).translate(0, 0.22, 0), lin('#4f3a28')],
      [new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.85, 1).translate(0, 0.62, 0), lin('#476a2a')],
      [new THREE.IcosahedronGeometry(0.26, 0).translate(0.17, 0.78, 0.08), lin('#527530')],
      [new THREE.IcosahedronGeometry(0.24, 0).translate(-0.15, 0.8, -0.1), lin('#4a6c2b')],
      [new THREE.IcosahedronGeometry(0.22, 0).translate(0.02, 0.92, -0.02), lin('#5a7d34')],
    ], true);
    // far versions: one cone or one blob, ~1/8 of the triangles, swapped in per chunk by distance
    const treeConLo = mergeColored([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.3, 3, 1, true).translate(0, 0.15, 0), lin('#4b3524')],
      [new THREE.ConeGeometry(0.42, 0.8, 6, 1, true).translate(0, 0.6, 0), lin('#27462c')],
    ], true);
    const treeDecLo = mergeColored([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.45, 3, 1, true).translate(0, 0.22, 0), lin('#4f3a28')],
      [new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.9, 1).translate(0, 0.7, 0), lin('#4d702d')],
    ], true);
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const CH = 12, chunkSize = T.SIZE / CH;
    const treeChunks = [];
    const buckets = [[], []].map(() => Array.from({ length: CH * CH }, () => []));
    function clearOfAirport(x, z, m) {
      for (const ap of T.AIRPORTS) {
        const f = ap.flat;
        if (x > f[0] - m && x < f[1] + m && z > f[2] - m && z < f[3] + m) return false;
      }
      const r = AP.runway;
      if (x < r.x0 && x > r.x0 - 3500 && Math.abs(z) < 140 + (r.x0 - x) * 0.12) return false;
      if (x > r.x1 && x < r.x1 + 2500 && Math.abs(z) < 140 + (x - r.x1) * 0.12) return false;
      const rb = T.BROOK.runway;
      if (z > rb.z1 && z < rb.z1 + 3000 && Math.abs(x - rb.x) < 140 + (z - rb.z1) * 0.12) return false;
      if (z < rb.z0 && z > rb.z0 - 2500 && Math.abs(x - rb.x) < 140 + (rb.z0 - z) * 0.12) return false;
      return true;
    }
    W.clearOfAirport = clearOfAirport;
    let treeCount = 0;
    for (let i = 0; i < 110000 && treeCount < 30000; i++) {
      const x = (rnd() - 0.5) * (T.SIZE - 1200), z = (rnd() - 0.5) * (T.SIZE - 1200);
      const h = T.heightAt(x, z);
      if (h < 4 || h > 1350) continue;
      const fd = forestAt(x, z);
      const p = smoothstep(0.06, 0.2, fd) * 0.95 + 0.03;
      if (rnd() > p) continue;
      if (T.slopeAt(x, z) > 0.75) continue;
      if (!clearOfAirport(x, z, 120)) continue;
      const conifer = h > 450 ? rnd() < 0.85 : rnd() < 0.35;
      const sz = (conifer ? 15 : 12) * (0.7 + rnd() * 0.6) * (h > 1100 ? 0.7 : 1);
      const ci = clamp(Math.floor((x + HALF) / chunkSize), 0, CH - 1) * CH + clamp(Math.floor((z + HALF) / chunkSize), 0, CH - 1);
      const tint = 0.75 + rnd() * 0.45, autumn = !conifer && rnd() < 0.12;
      buckets[conifer ? 0 : 1][ci].push([x, h - 0.5, z, sz, rnd() * 6.28, tint, autumn]);
      addObstacle({ x, z, y0: h, y1: h + sz * (conifer ? 1.05 : 0.95), r: sz * 0.32, kind: 'tree' });
      treeCount++;
    }
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const tc = new THREE.Color();
    [treeCon, treeDec].forEach((geo, type) => {
      buckets[type].forEach((list, ci) => {
        if (!list.length) return;
        const cx = -HALF + (Math.floor(ci / CH) + 0.5) * chunkSize, cz = -HALF + (ci % CH + 0.5) * chunkSize;
        let maxY = 0; list.forEach(t => { maxY = Math.max(maxY, t[1] + t[3]); });
        const sphere = new THREE.Sphere(new THREE.Vector3(cx, maxY / 2, cz), chunkSize * 0.75 + maxY);
        const g = shareGeo(geo, sphere), gLo = shareGeo(type ? treeDecLo : treeConLo, sphere);
        const im = new THREE.InstancedMesh(g, treeMat, list.length);
        list.forEach((t, i) => {
          q4.setFromAxisAngle(yAxis, t[4]); s4.set(t[3] * (0.85 + 0.3 * ((i * 7919) % 10) / 10), t[3], t[3]); p4.set(t[0], t[1], t[2]);
          m4.compose(p4, q4, s4); im.setMatrixAt(i, m4);
          if (t[6]) tc.setRGB(1.9 * t[5], 1.1 * t[5], 0.5 * t[5]); else tc.setRGB(t[5], t[5] * (0.95 + 0.1 * ((i * 31) % 7) / 7), t[5]);
          im.setColorAt(i, tc);
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = false; im.receiveShadow = false;
        scene.add(im);
        treeChunks.push({ im, cx, cz, g, gLo });
      });
    });
    W.treeCount = treeCount;

    // ---------------- villages + farmhouses
    const villages = [];
    for (let i = 0; i < 6000 && villages.length < 11; i++) {
      const x = (rnd() - 0.5) * 24000, z = (rnd() - 0.5) * 24000;
      const h = T.heightAt(x, z);
      if (h < 10 || h > 320 || T.slopeAt(x, z) > 0.05) continue;
      if (!clearOfAirport(x, z, 1500)) continue;
      if (villages.some(v => Math.hypot(v.x - x, v.z - z) < 3800)) continue;
      villages.push({ x, z, n: 50 + ((rnd() * 70) | 0) });
    }
    const houses = [];
    const placeHouse = (x, z, big) => {
      const h = T.heightAt(x, z);
      if (h < 3 || T.slopeAt(x, z) > 0.18 || !clearOfAirport(x, z, 60)) return false;
      const w = (big ? 14 : 7) + rnd() * 5, d = (big ? 10 : 6) + rnd() * 4, wh = (big ? 6 : 3.2) + rnd() * 2.6;
      const rot = Math.round(rnd() * 4) * Math.PI / 2 + (rnd() - 0.5) * 0.3;
      houses.push({ x, z, y: h - 0.3, w, d, wh, rh: 1.8 + rnd() * 2.2, rot });
      addObstacle({ x, z, y0: h, y1: h + wh + 3, r: Math.max(w, d) * 0.55, kind: 'building' });
      return true;
    };
    villages.forEach(v => {
      let placed = 0;
      for (let k = 0; k < v.n * 3 && placed < v.n; k++) {
        const a = rnd() * Math.PI * 2, r = 30 + Math.pow(rnd(), 0.7) * 320;
        if (placeHouse(v.x + Math.cos(a) * r, v.z + Math.sin(a) * r, rnd() < 0.08)) placed++;
      }
    });
    for (let k = 0; k < 5000 && houses.length < 900; k++) {
      const x = (rnd() - 0.5) * 26000, z = (rnd() - 0.5) * 26000;
      const h = T.heightAt(x, z); if (h < 8 || h > 400) continue;
      if (forestAt(x, z) > 0.05) continue;
      placeHouse(x, z, rnd() < 0.3);
      if (rnd() < 0.6) placeHouse(x + 25 + rnd() * 20, z + (rnd() - 0.5) * 30, true);
    }
    const wallGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    // windows: a dark band painted into the wall colour via a tiny texture
    const wallTex = canvasTex(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5a6670'; for (let i = 0; i < 3; i++) ctx.fillRect(4 + i * 10, 12, 5, 7);
      ctx.fillStyle = '#c8c2b6'; ctx.fillRect(0, 28, w, 4);
    });
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: wallTex }), houses.length);
    const roofGeo = (() => {
      const g = new THREE.BufferGeometry();
      const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
      const ids = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4];
      const p = []; ids.forEach(i => p.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]));
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
      return g;
    })();
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), houses.length);
    const wallCols = ['#e8e2d4', '#efe7d2', '#d9cdb5', '#c9b79a', '#e3d6c1', '#b55a3c', '#d8d3c8'].map(lin);
    const roofCols = ['#8c3b22', '#7a3320', '#5b4b45', '#3f4448', '#94492a', '#6b2f22'].map(lin);
    const winPos = [], winCol = [], winSize = [];
    houses.forEach((hs, i) => {
      q4.setFromAxisAngle(yAxis, hs.rot);
      m4.compose(p4.set(hs.x, hs.y, hs.z), q4, s4.set(hs.w, hs.wh + 0.3, hs.d)); walls.setMatrixAt(i, m4);
      m4.compose(p4.set(hs.x, hs.y + hs.wh + 0.3, hs.z), q4, s4.set(hs.w * 1.08, hs.rh, hs.d * 1.12)); roofs.setMatrixAt(i, m4);
      walls.setColorAt(i, wallCols[(rnd() * wallCols.length) | 0]);
      roofs.setColorAt(i, roofCols[(rnd() * roofCols.length) | 0]);
      if (rnd() < 0.65) { winPos.push(hs.x, hs.y + 2, hs.z); const c = lin(rnd() < 0.8 ? '#ffc070' : '#fff0d0'); winCol.push(c.r, c.g, c.b); winSize.push(0.5 + rnd() * 0.4); }
    });
    walls.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true;
    walls.frustumCulled = false; roofs.frustumCulled = false;
    walls.receiveShadow = true;
    scene.add(walls); scene.add(roofs);

    // ---------------- roads: a minimum spanning network between the villages, both fields and the cape
    const roadNodes = villages.map(v => ({ x: v.x, z: v.z }));
    roadNodes.push({ x: -10, z: 330, ap: AP }, { x: 8350, z: 0, ap: T.BROOK }, { x: T.landmarks.lighthouse.x, z: T.landmarks.lighthouse.z - 250 });
    const segOK = (a, b) => {
      for (let k = 1; k < 60; k++) {
        const f = k / 60, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        if (T.heightAt(x, z) < 2.5 || T.slopeAt(x, z) > 0.35) return false;
        for (const ap of T.AIRPORTS) { const fl = ap.flat; if (x > fl[0] && x < fl[1] && z > fl[2] && z < fl[3] && !((a.ap === ap) || (b.ap === ap))) return false; }
        for (const ap of T.AIRPORTS) for (const r of ap.paved.slice(0, 1)) if (x > r[0] - 10 && x < r[1] + 10 && z > r[2] - 10 && z < r[3] + 10) return false;
      }
      return true;
    };
    const edges = [];
    for (let i = 0; i < roadNodes.length; i++) for (let j = i + 1; j < roadNodes.length; j++) {
      const d = Math.hypot(roadNodes[i].x - roadNodes[j].x, roadNodes[i].z - roadNodes[j].z);
      if (d < 14000 && segOK(roadNodes[i], roadNodes[j])) edges.push([d, i, j]);
    }
    edges.sort((a, b) => a[0] - b[0]);
    const parent = roadNodes.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const roadEdges = [];
    for (const [, i, j] of edges) { const a = find(i), b = find(j); if (a !== b) { parent[a] = b; roadEdges.push([i, j]); } }
    const roads = [];
    const rpos = [], ruv = [], rnor = [], ridx = [];
    for (const [i, j] of roadEdges) {
      const a = roadNodes[i], b = roadNodes[j];
      const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(len / 18));
      const px = -(b.z - a.z) / len, pz = (b.x - a.x) / len;
      const amp = Math.min(160, len * 0.06), ph = rnd() * 6.28;
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const f = k / n, bend = Math.sin(f * Math.PI) * amp * Math.sin(f * 3.1 + ph);
        const x = a.x + (b.x - a.x) * f + px * bend, z = a.z + (b.z - a.z) * f + pz * bend;
        pts.push({ x, y: Math.max(T.heightAt(x, z), 1) + 0.45, z });
      }
      const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
      roads.push({ pts, cum, len: cum[cum.length - 1] });
      const base = rpos.length / 3;
      for (let k = 0; k < pts.length; k++) {
        const p0 = pts[Math.max(0, k - 1)], p1 = pts[Math.min(pts.length - 1, k + 1)];
        const tl = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1, rx = -(p1.z - p0.z) / tl, rz = (p1.x - p0.x) / tl;
        for (const sd of [-1, 1]) {
          const x = pts[k].x + rx * 3.6 * sd, z = pts[k].z + rz * 3.6 * sd;
          rpos.push(x, Math.max(T.heightAt(x, z), pts[k].y - 0.45) + 0.45, z); ruv.push(sd < 0 ? 0 : 1, cum[k] / 14); rnor.push(0, 1, 0);
        }
        if (k > 0) { const q = base + k * 2; ridx.push(q - 2, q, q - 1, q - 1, q, q + 1); }
      }
    }
    if (rpos.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
      rg.setAttribute('normal', new THREE.Float32BufferAttribute(rnor, 3)); rg.setIndex(ridx);
      const rm = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: roadTexture(maxAniso), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      rm.receiveShadow = true; rm.frustumCulled = false; scene.add(rm);
    }
    W.roads = roads;

    // night lights: windows and street lamps along the roads near villages
    for (const r of roads) for (let s = 0; s < r.len; s += 140) {
      const k = r.cum.findIndex(c => c >= s); const p = r.pts[Math.max(0, k)];
      if (villages.some(v => Math.hypot(v.x - p.x, v.z - p.z) < 700)) { winPos.push(p.x + 5, p.y + 5, p.z); winCol.push(1.0, 0.75, 0.4); winSize.push(0.6); }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(winPos, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(winCol, 3));
    wg.setAttribute('size', new THREE.Float32BufferAttribute(winSize, 1));
    const winLights = new THREE.Points(wg, pointsMat({ base: 0 }));
    winLights.frustumCulled = false;
    scene.add(winLights);
    W.lightMats.push(winLights.material);
    W.houseCount = houses.length; W.villages = villages;

    /** Tree / building hit test at world point p (x, y, z). Returns a reason or null. */
    W.obstacleHit = function (x, y, z) {
      const cx = Math.floor(x / 60), cz = Math.floor(z / 60);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = obstacles.get((cx + i + 1000) * 4000 + (cz + j + 1000));
        if (!list) continue;
        for (const o of list) {
          if (y < o.y0 || y > o.y1) continue;
          const dx = x - o.x, dz = z - o.z;
          if (dx * dx + dz * dz < o.r * o.r) return o.kind === 'tree' ? 'Flew into the trees' : 'Hit a building';
        }
      }
      return null;
    };

    // ---------------- time of day
    W.night = 0;
    let envElev = -999;
    W.setTime = function (hours) {
      const sd = sunDirection(hours);
      const elev = Math.asin(sd.y) * 180 / Math.PI;
      const k = skyAt(elev);
      W.sunDir = sd; W.elev = elev;
      const night = clamp((-elev - 1) / 9, 0, 1);
      W.night = night;
      const moon = new THREE.Vector3(-sd.x, Math.abs(sd.y) * 0.6 + 0.35, -sd.z).normalize();
      const sk = Atmos.setSun(sky, sd, night, moon, renderer.toneMappingExposure, scene);
      W.skyCols = sk;
      scene.fog.density = k.fog * W.fogMul;
      if (elev > -2) { sun.color.copy(k.sun); sun.intensity = k.si; W.lightDir = sd.clone(); if (sd.y < 0.05) W.lightDir.y = 0.05; }
      else { sun.color.set(0x8aa4d6).convertSRGBToLinear(); sun.intensity = 0.22 * night; W.lightDir = moon; }
      hemi.color.copy(sk.zen).multiplyScalar(1.8).lerp(new THREE.Color(1, 1, 1), 0.35 * (1 - night)); hemi.groundColor.copy(lin('#6b6a4a')).multiplyScalar(0.6 + 0.4 * (1 - night));
      hemi.intensity = k.amb * 1.4;
      waterU.uZen.value.copy(sk.zen); waterU.uHor.value.copy(sk.hor); waterU.uSunDir.value.copy(sd); waterU.uSunColor.value.copy(k.sun).multiplyScalar(elev > -1 ? k.si / 2.5 : 0);
      waterU.uNight.value = night;
      // clouds: white sunlit tops, blue-grey bases tinted by the sky, a warm rim toward the sun
      const sunLit = k.sun.clone().multiplyScalar(Math.min(1, k.si / 2.4));
      cloudU.uLit.value.copy(sunLit).multiplyScalar(1.05).add(sk.zen.clone().multiplyScalar(0.35)).add(new THREE.Color(0.02, 0.02, 0.025));
      cloudU.uShade.value.copy(sunLit).multiplyScalar(0.32).add(sk.zen.clone().multiplyScalar(0.5)).add(sk.hor.clone().multiplyScalar(0.15)).add(new THREE.Color(0.006, 0.007, 0.01));
      cloudU.uSunDir.value.copy(sd); cloudU.uGlow.value.copy(sk.toward).multiplyScalar(elev > -4 ? 0.5 : 0);
      W.lightMats.forEach(m => { m.uniforms.uNight.value = clamp((-elev + 4) / 10, 0, 1); });
      glass.emissive.copy(lin('#ffd59a')).multiplyScalar(0.35 * night);
      // reflections follow the sky (rebuilt only when the sun has moved noticeably)
      if (Math.abs(elev - envElev) > 1.5) {
        envElev = elev;
        sky.groundTint = new THREE.Color(0.05, 0.06, 0.035).multiplyScalar(0.25 + 0.75 * clamp(k.si / 2.5, 0, 1) + 0.05);
        Atmos.updateEnvironment(renderer, scene, sky);
      }
      return { elev, night };
    };

    let lodT = 0;
    W.update = function (camera, focus, time, dt, windDir) {
      lodT -= dt;
      if (lodT <= 0) {
        lodT = 0.25;
        W.updateTerrainLod(camera.position);
        // trees are most of the island's triangles: draw them as far as the fog lets you see them
        const far = W.treeFar + Math.max(0, camera.position.y - 500) * 1.2;
        if (W.islandOn) for (const t of treeChunks) {
          const d = Math.hypot(camera.position.x - t.cx, camera.position.z - t.cz);
          t.im.visible = d < far + chunkSize * 0.7;
          // full trees only in the chunks around the camera (a 15 m tree is a few pixels past ~1.5 km)
          const lo = Math.max(0, d - chunkSize * 0.72) + Math.max(0, camera.position.y - 400) > 1200;
          t.im.geometry = lo ? t.gLo : t.g;
        }
      }
      sky.mesh.position.copy(camera.position);
      water.position.x = Math.round(camera.position.x / 1000) * 1000; water.position.z = Math.round(camera.position.z / 1000) * 1000;
      waterU.uTime.value = time;
      const ld = W.lightDir || new THREE.Vector3(0, 1, 0);
      sun.position.copy(focus).addScaledVector(ld, 300);
      sun.target.position.copy(focus);
      const sz = innerHeight / 1080;
      W.lightMats.forEach(m => { m.uniforms.uScale.value = sz; });
      W.updatePapi(camera.position);
      if (windDir !== undefined) for (const s of W.socks) { s.pivot.rotation.y = windDir; s.pivot.rotation.z = -0.25 + Math.sin(time * 2.1) * 0.05; }
      clouds.position.y = W.islandOn ? 0 : W.fogBase;
      Atmos.update(camera, W.sunDir || new THREE.Vector3(0, 1, 0), scene.fog.density, W.fogScale, W.fogBase);
    };
    W.update(new THREE.PerspectiveCamera(), new THREE.Vector3(), 0, 0);
    // everything island-specific (terrain, sea, airfields, trees, villages, roads), so the real-world
    // mode can hide it and keep the sky, sun, fog and clouds
    const shared = new Set([sun, sun.target, hemi, sky.mesh, clouds]);
    W.islandObjects = scene.children.filter(o => !before.has(o) && !shared.has(o));
    W.setIslandVisible = function (on, extra) {
      W.islandOn = on;
      for (const o of W.islandObjects.concat(extra || [])) o.visible = on;
    };
    return W;
  }

  window.World = { build, sunDirection, lin, canvasTex, loadTex };
})();
