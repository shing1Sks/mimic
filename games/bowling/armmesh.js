/*
 * Emberlane - the meshes and materials of your bowling arm below the hand (hand.js puts them
 * together): an anatomical forearm (flat at the wrist, rounder and fuller toward the elbow,
 * the extensor and flexor masses), a shirt sleeve rolled to below the elbow with a double roll,
 * piping and folds, a terry wristband, and the shading: wrap-lit skin (a cheap subsurface
 * look: light bleeds red past the terminator), skin pores and micro creases, knit cloth.
 *
 * Every piece is a tube along local +y (s = metres from the wrist toward the shoulder); its
 * cross-section is a function of (s, angle). Local +z is the back of the forearm, -z the palm.
 */
(function () {
  'use strict';
  const T = THREE, BW = window.BW;
  const TAU = Math.PI * 2;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const sstep = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
  function tab(t, s) {
    if (s <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) if (s <= t[i][0]) { const [s0, v0] = t[i - 1], [s1, v1] = t[i]; const k = (s - s0) / (s1 - s0); const e = k * k * (3 - 2 * k); return v0 + (v1 - v0) * e; }
    return t[t.length - 1][1];
  }
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // ------------------------------------------------------------------ the arm's shape
  // half-width across (radius to ulna) and half-depth (palm to back), measured against the
  // rigged hand's wrist opening (the forearm starts inside the hand and stays inside it)
  const AW = [[-0.022, 0.0250], [-0.01, 0.0262], [0, 0.0272], [0.03, 0.0290], [0.07, 0.0326], [0.12, 0.0370], [0.17, 0.0402], [0.22, 0.0420], [0.28, 0.0428], [0.34, 0.0442], [0.46, 0.0475]];
  const AD = [[-0.022, 0.0160], [-0.01, 0.0178], [0, 0.0195], [0.03, 0.0208], [0.07, 0.0240], [0.12, 0.0292], [0.17, 0.0338], [0.22, 0.0372], [0.28, 0.0398], [0.34, 0.0418], [0.46, 0.0450]];
  const ZC = [[-0.022, -0.0080], [-0.01, -0.0055], [0, -0.0030], [0.05, -0.0010], [0.15, 0.0015], [0.46, 0.0020]];
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };

  /** Arm surface point at (s, th) with extra thickness `off` (cloth over the skin). */
  function armPoint(s, th, xs, off) {
    const a = tab(AW, s), b = tab(AD, s), zc = tab(ZC, s);
    const n = 2.5 - 0.5 * sstep(0.0, 0.2, s);              // boxier wrist, rounder forearm
    const c = Math.cos(th), sn = Math.sin(th);
    let x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), z = b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
    // muscle masses: brachioradialis / extensors on the back of the thumb side, flexors on
    // the palm side toward the little finger; both swell from mid-forearm to the elbow
    const env = sstep(0.03, 0.17, s) * (1 - 0.35 * sstep(0.26, 0.36, s));
    const ext = Math.atan2(0.72, 0.7 * xs), flx = Math.atan2(-0.8, -0.45 * xs), uln = Math.atan2(0.15, -1 * xs);
    let k = 1 + env * (0.12 * Math.exp(-Math.pow(angDiff(th, ext) / 0.75, 2)) + 0.08 * Math.exp(-Math.pow(angDiff(th, flx) / 0.8, 2)))
      - 0.04 * sstep(0.02, 0.1, s) * (1 - sstep(0.16, 0.24, s)) * Math.exp(-Math.pow(angDiff(th, uln) / 0.5, 2));   // flat along the ulna
    x *= k; z *= k;
    if (off) { const nx = x / (a * a), nz = z / (b * b), nl = Math.hypot(nx, nz) || 1; x += nx / nl * off; z += nz / nl * off; }   // along the ellipse normal
    return [x, z + zc];
  }
  const armSection = (s, th, xs) => armPoint(s, th, xs, 0);

  // the sleeve: lower edge folded tight to the skin, a double roll, then the sleeve proper
  const FOLDS = [[150, 0.3, 0.0022, 1.6], [230, 2.1, 0.0014, 2.4], [96, 4.0, 0.0019, 1.1], [330, 1.2, 0.0006, 3.0]];   // [freq, phase, amplitude, tilt]
  const ROLL0 = 0.188, ROLL_MID = 0.2195, ROLL1 = 0.247;
  function sleeveOff(s, th) {
    let off;
    if (s < ROLL1) {
      const e = clamp01((s - ROLL0) / 0.009);                  // rounded lower edge of the roll
      off = 0.0012 + 0.0108 * Math.sin(e * Math.PI / 2);
      off += 0.0016 * Math.sin(clamp01((s - ROLL0) / (ROLL_MID - ROLL0)) * Math.PI) + 0.0014 * Math.sin(clamp01((s - ROLL_MID) / (ROLL1 - ROLL_MID)) * Math.PI);
      off -= 0.0026 * Math.exp(-Math.pow((s - ROLL_MID) / 0.0022, 2));   // the fold between the rolls
      off += 0.0007 * Math.sin(th * 5 + s * 90) * Math.sin(clamp01((s - ROLL0) / (ROLL1 - ROLL0)) * Math.PI);
      const top = clamp01((s - (ROLL1 - 0.006)) / 0.006);      // top of the roll tucks onto the sleeve
      off = off * (1 - top) + 0.0085 * top;
    } else {
      const u = s - ROLL1;
      off = 0.0085 + 0.004 * sstep(0.0, 0.18, u);
      // fabric pushed up above the roll: a few irregular, broken folds rather than rings
      let f = 0;
      for (const [k, ph, a, tilt] of FOLDS) f += a * Math.sin(u * k + ph + tilt * Math.sin(th + ph) + 0.6 * Math.sin(th * 2 + ph * 1.7));
      const lobes = 0.55 + 0.45 * Math.sin(th * 3 + 0.8) * Math.sin(th * 2 - 0.4 + u * 9);
      off += f * lobes * (0.35 + 0.65 * Math.exp(-u / 0.08)) * sstep(0.0, 0.012, u);
      // long drape folds down the sleeve
      off += 0.0024 * Math.sin(th * 3 + u * 22 + 1.4 * Math.sin(th * 2 - u * 11)) * sstep(0.01, 0.07, u) + 0.0018 * Math.sin(th * 2 + 2.2);
      // inner elbow crease
      off += 0.0014 * Math.sin(u * 140 + th) * Math.exp(-Math.pow((s - 0.29) / 0.02, 2)) * Math.max(0, -Math.sin(th));
    }
    return off;
  }
  const sleeveSection = (s, th, xs) => armPoint(s, th, xs, sleeveOff(s, th));
  const pipeSection = (s, th, xs) => { const t = clamp01((s - 0.2165) / 0.007); return armPoint(s, th, xs, sleeveOff(ROLL_MID, th) + 0.0026 + 0.0013 * Math.sin(t * Math.PI)); };
  const bandSection = (s, th, xs) => { const t = clamp01((s - 0.004) / 0.058); return armPoint(s, th, xs, 0.0008 + 0.0056 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 6)))); };

  /** Skin colour per vertex: tanned back, paler pinker inner forearm, contact shadow under
   * the sleeve roll and beside the wristband, a little mottling. Linear RGB. */
  const mottle = (() => { const r = rng(9), N = 64, v = new Float32Array(N * N); for (let i = 0; i < v.length; i++) v[i] = r();
    return (u, w) => { const x = u * N, y = w * N, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const at = (i, j) => v[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }; })();
  function skinTint(s, th, xs, hex) {
    const base = new T.Color(hex);
    const back = Math.sin(th);                                 // +1 back of the arm, -1 palm side
    const c = base.clone();
    c.lerp(new T.Color(0xe7b39a), 0.16 * clamp01(-back));      // inner forearm: paler, pinker
    c.multiplyScalar(1 - 0.06 * clamp01(back));                // sun on the back of the arm
    c.lerp(new T.Color(0xc0604a), 0.08 * (1 - sstep(0.0, 0.08, s)));   // warmer at the wrist
    const m = mottle(th / TAU * 6, s * 30) * 0.6 + mottle(th / TAU * 15 + 3, s * 80) * 0.4;
    c.multiplyScalar(0.95 + 0.1 * m);
    // ambient occlusion where cloth meets skin
    c.multiplyScalar(1 - 0.5 * sstep(0.163, 0.19, s));
    c.multiplyScalar(1 - 0.28 * (1 - sstep(0.06, 0.078, s)) * sstep(0.04, 0.06, s));
    return c;
  }

  // ------------------------------------------------------------------ tube builder
  /** A closed tube along +y from s0 to s1: section(s, th) -> [x, z]. uv: u around, v = s / vScale. */
  function tube(section, s0, s1, nU, nV, o) {
    o = o || {};
    const vScale = o.vScale || 0.2;
    const pos = [], uv = [], col = [], idx = [];
    for (let j = 0; j <= nV; j++) {
      const s = s0 + (s1 - s0) * j / nV;
      for (let i = 0; i <= nU; i++) {
        const th = TAU * (i % nU) / nU;
        const [x, z] = section(s, th);
        pos.push(x, s, z); uv.push(i / nU, (s - s0) / vScale);
        if (o.colors) { const c = o.colors(s, th); col.push(c.r, c.g, c.b); }
      }
    }
    const R = nU + 1;
    for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
      const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    if (o.colors) g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // weld the normals across the uv seam
    const n = g.attributes.normal;
    for (let j = 0; j <= nV; j++) {
      const a = j * R, b = a + nU;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
    return g;
  }

  // ------------------------------------------------------------------ textures
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  /** Tileable height field -> tangent-space normal map canvas. */
  function normalFrom(H, N, M, strength) {
    const c = canvas(N, M), g = c.getContext('2d'), img = g.createImageData(N, M), d = img.data;
    const at = (x, y) => H[((y + M) % M) * N + ((x + N) % N)];
    for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function tileNoise(N, freq, seed) {
    const r = rng(seed), G = freq, v = new Float32Array(G * G); for (let i = 0; i < v.length; i++) v[i] = r();
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * G, fy = y / N * G, xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => v[(j % G) * G + (i % G)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      out[y * N + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    return out;
  }
  function wrapTex(c, srgb) {
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (srgb) t.encoding = T.sRGBEncoding;
    t.anisotropy = 4; return t;
  }
  let skinH = null;
  function skinHeight() {
    if (skinH) return skinH;
    const N = 256, H = new Float32Array(N * N), r = rng(21);
    const n1 = tileNoise(N, 16, 3), n2 = tileNoise(N, 48, 4);
    for (let i = 0; i < H.length; i++) H[i] = n1[i] * 0.35 + n2[i] * 0.25;
    // the fine diamond pattern of skin creases (two families of shallow grooves)
    for (const ang of [0.7, -0.75, 1.55]) {
      const ca = Math.cos(ang), sa = Math.sin(ang), per = ang === 1.55 ? 23 : 11;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const p = (x * ca + y * sa) / per; const f = p - Math.floor(p);
        H[y * N + x] -= (ang === 1.55 ? 0.12 : 0.18) * Math.exp(-Math.pow((f - 0.5) / 0.07, 2)) * (0.6 + 0.4 * n1[(y * 7 % N) * N + x]);
      }
    }
    // pores
    for (let k = 0; k < 1500; k++) {
      const cx = r() * N, cy = r() * N, rad = 0.6 + r() * 0.8, dep = 0.35 + r() * 0.45;
      for (let y = Math.floor(cy - 3); y <= cy + 3; y++) for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
        const d = Math.hypot(x - cx, y - cy); if (d > rad * 2) continue;
        H[((y + N) % N) * N + ((x + N) % N)] -= dep * Math.exp(-(d * d) / (rad * rad));
      }
    }
    skinH = { H, N };
    return skinH;
  }
  let skinN = null, skinRgh = null;
  function skinDetail() { if (!skinN) { const { H, N } = skinHeight(); skinN = wrapTex(normalFrom(H, N, N, 2.2), false); } return skinN; }
  function skinRough() {
    if (skinRgh) return skinRgh;
    const { H, N } = skinHeight(), c = canvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let i = 0; i < N * N; i++) { const v = Math.max(0, Math.min(255, 225 - H[i] * 40)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return (skinRgh = wrapTex(c, false));
  }

  /** Cloth: the jersey scan as a neutral detail map (so the shirt colour stays clean), its
   * normal map, and a ribbed terry knit for the wristband. */
  let cloth = null;
  function clothTextures(diff, nor) {
    if (cloth) return cloth;
    // heather from the jersey scan (low-frequency tone only), knit V-stitches in the normal map
    const img = diff.image, N = 512, c = canvas(N, N), g = c.getContext('2d');
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N), a = d.data;
    let mean = 0; for (let i = 0; i < a.length; i += 4) mean += a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11; mean /= a.length / 4;
    const KN = new Float32Array(N * N), WALES = 40, COURSES = 52, fuzz = tileNoise(N, 128, 11), mel = tileNoise(N, 8, 12);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N * WALES, v = y / N * COURSES, fu = u - Math.floor(u), fv = v - Math.floor(v);
      const l1 = Math.abs((fu - 0.27) - (fv - 0.5) * 0.42), l2 = Math.abs((fu - 0.73) + (fv - 0.5) * 0.42);
      const h = Math.max(0, 1 - Math.pow(l1 / 0.21, 2), 1 - Math.pow(l2 / 0.21, 2));
      KN[y * N + x] = Math.sqrt(h) * 0.9 + fuzz[y * N + x] * 0.25;
      const i = (y * N + x) * 4, l = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) / mean;
      const v8 = Math.max(0, Math.min(255, 205 * (1 + (l - 1) * 1.2) * (0.86 + 0.14 * Math.sqrt(h)) * (0.93 + 0.14 * mel[y * N + x])));
      a[i] = a[i + 1] = a[i + 2] = v8;
    }
    g.putImageData(d, 0, 0);
    const map = wrapTex(c, true);
    const normal = wrapTex(normalFrom(KN, N, N, 1.1), false);
    void nor;
    // terry wristband: 44 ribs around, looped pile noise
    const BW_ = 512, BH = 128, H = new Float32Array(BW_ * BH), n = tileNoise(BW_, 128, 7), r = rng(5);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW_; x++) {
      const rib = Math.pow(0.5 + 0.5 * Math.cos(x / BW_ * TAU * 44), 0.6);
      H[y * BW_ + x] = rib * 1.0 + n[(y * 4 % BW_) * BW_ + x] * 0.55 + r() * 0.12;
    }
    // stitched edges
    for (let y = 0; y < BH; y++) { const e = Math.min(y, BH - 1 - y); if (e < 7) for (let x = 0; x < BW_; x++) H[y * BW_ + x] = H[y * BW_ + x] * 0.4 + 0.4 * Math.cos(y * 1.6) + 0.3; }
    const bandN = wrapTex(normalFrom(H, BW_, BH, 1.6), false);
    const bc = canvas(BW_, BH), bg = bc.getContext('2d'), bi = bg.createImageData(BW_, BH), bd = bi.data;
    for (let i = 0; i < BW_ * BH; i++) { const v = Math.max(0, Math.min(255, 150 + H[i] * 70)); bd[i * 4] = bd[i * 4 + 1] = bd[i * 4 + 2] = v; bd[i * 4 + 3] = 255; }
    bg.putImageData(bi, 0, 0);
    const band = wrapTex(bc, true);
    cloth = { map, normal, band, bandN };
    return cloth;
  }

  // ------------------------------------------------------------------ shading
  const WRAP_FROM = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  const WRAP_TO = `{
      // skin: light wraps past the terminator, red the furthest (scattering under the skin),
      // and a little shines through thin edges when lit from behind
      float nlW = dot( geometry.normal, directLight.direction );
      vec3 wrapW = vec3( 0.55, 0.28, 0.2 );
      vec3 diffW = clamp( ( vec3( nlW ) + wrapW ) / ( 1.0 + wrapW ), 0.0, 1.0 );
      diffW *= mix( vec3( 1.0 ), vec3( 1.0, 0.86, 0.8 ), 1.0 - saturate( nlW * 3.0 ) );
      float thru = pow( saturate( dot( geometry.viewDir, -directLight.direction ) ), 3.0 ) * pow( 1.0 - saturate( dot( geometry.normal, geometry.viewDir ) ), 2.0 );
      reflectedLight.directDiffuse += directLight.color * ( diffW + thru * vec3( 0.55, 0.12, 0.06 ) ) * BRDF_Lambert( material.diffuseColor );
    }`;
  function skinShading(mat, key) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev && prev !== T.Material.prototype.onBeforeCompile) prev(sh, r);
      const chunk = T.ShaderChunk.lights_physical_pars_fragment;
      if (chunk.indexOf(WRAP_FROM) < 0) { console.warn('skin shading: chunk changed'); return; }
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk.replace(WRAP_FROM, WRAP_TO));
    };
    mat.customProgramCacheKey = () => 'skin-' + key;
  }
  /** Fade a mesh out along its local +y between s0 (opaque) and s1 (gone), darkening as it goes
   * (it reads as the arm leaving the light rather than turning to glass). */
  function fadeAlong(mat, s0, s1, key) {
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlong;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlong;')
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float fadeK = 1.0 - smoothstep( ${s0.toFixed(4)}, ${(s0 + 0.65 * (s1 - s0)).toFixed(4)}, vAlong );
          diffuseColor.a *= 1.0 - smoothstep( ${(s0 + 0.3 * (s1 - s0)).toFixed(4)}, ${s1.toFixed(4)}, vAlong );`)
        .replace('#include <output_fragment>', `outgoingLight *= mix( 0.42, 1.0, fadeK );
          #include <output_fragment>`);
    };
    mat.customProgramCacheKey = () => 'fade-' + key;
  }

  BW.ArmMesh = { tube, armSection, sleeveSection, pipeSection, bandSection, skinTint, skinDetail, skinRough, clothTextures, skinShading, fadeAlong };
})();
