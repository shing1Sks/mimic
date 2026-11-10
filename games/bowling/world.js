/*
 * Emberlane - the hall. Built once from the loaded assets:
 *  - lanes: maple/pine boards drawn from a real veneer scan, markings, a glossy lacquer with a
 *    planar reflection (the mirror look of a real lane, strongest far away where you see it at a
 *    grazing angle, softer on the dry back end), gutters, cappings, kickbacks, pit, curtain;
 *  - pins: lathe of the regulation outline, gloss white with the red neck stripes;
 *  - balls: urethane-look swirl with lacquer and finger holes;
 *  - the masking unit (lit panels, ours animates), ceiling, lane lights, walls, neon, settee,
 *    ball returns; neighbour lanes with their own racks;
 *  - lights: pin deck spot with shadows, a key over the approach (hand and ball shadows),
 *    lane washes, warm practicals; the HDR environment for reflections.
 */
(function () {
  'use strict';
  const T = THREE, BW = window.BW, P = BW.Phys, L = P.LANE;
  const LANE_LEN = -P.LANE.PIT_Z;             // foul line to the end of the pin deck (19.16 m)
  const PITCH = 1.75;                          // lane centre to lane centre
  const NEIGH = 3;                             // lanes each side of ours
  const CAP_IN = L.GUTTER_X, CAP_OUT = PITCH / 2;

  // ------------------------------------------------------------------ helpers
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texFrom(c, srgb, aniso, renderer) {
    const t = new T.CanvasTexture(c);
    if (srgb) t.encoding = T.sRGBEncoding;
    t.anisotropy = aniso ? renderer.capabilities.getMaxAnisotropy() : 1;
    return t;
  }
  function rngFrom(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function box(w, h, d, mat, x, y, z, parent) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (parent) parent.add(m); return m;
  }

  /** The veneer scan with its grain contrast lifted and a lacquered-maple tint. */
  function prepGrain(img) {
    const N = 1024, c = canvas(N, N), g = c.getContext('2d');
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N), a = d.data;
    let mean = 0; for (let i = 0; i < a.length; i += 4) mean += a[i + 1]; mean /= a.length / 4;
    for (let i = 0; i < a.length; i += 4) {
      const v = (a[i + 1] - mean) / 255;          // grain detail, -0.05..0.05 in the scan
      const k = 1 + v * 7.5;                      // much stronger figure, like the lacquered lane
      a[i] = Math.max(0, Math.min(255, 238 * k)); a[i + 1] = Math.max(0, Math.min(255, 228 * k)); a[i + 2] = Math.max(0, Math.min(255, 214 * k));
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ lane surface texture
  /**
   * The lane as a canvas: u along the lane (canvas x, foul line at 0), v across (canvas y,
   * right edge at the top). 39 boards; maple heads, pine middle, maple back end and deck; every
   * board a different strip of the scan with staggered butt joints; arrows, dots, pin spots.
   */
  function laneTexture(grain, renderer) {
    const W = 4096, H = 1024, c = canvas(W, H), g = c.getContext('2d');
    const rnd = rngFrom(77);
    const mPerPx = LANE_LEN / W, boardH = H / 39;
    const zx = z => -z / mPerPx;                               // lane z (negative) -> canvas x
    const xy = x => (L.HALF - x) / (2 * L.HALF) * H;           // lane x -> canvas y
    const HEADS = 4.9, PINE_END = 15.2;
    for (let b = 0; b < 39; b++) {
      const y0 = Math.round(b * boardH), y1 = Math.round((b + 1) * boardH);
      let x = 0;
      while (x < W) {
        const zHere = x * mPerPx;
        const seg = (1.8 + rnd() * 2.6) / mPerPx;
        const sx = rnd() * 600, sy = rnd() * (1024 - 40);
        g.drawImage(grain, sx, sy, 420, 22 + rnd() * 10, x, y0, seg, y1 - y0);
        // species / ageing tint per board segment
        const pine = zHere > HEADS && zHere < PINE_END;
        const t = rnd();
        g.fillStyle = pine ? `rgba(${222 + t * 25},${160 + t * 30},${86 + t * 30},0.34)` : `rgba(${228 + t * 20},${182 + t * 30},${112 + t * 30},0.26)`;
        g.globalCompositeOperation = 'multiply';
        g.fillRect(x, y0, seg, y1 - y0);
        g.globalCompositeOperation = 'source-over';
        // butt joint
        g.fillStyle = 'rgba(70,40,15,0.35)'; g.fillRect(x, y0, 1, y1 - y0);
        x += seg;
      }
      // board seam
      g.fillStyle = 'rgba(80,46,18,0.42)'; g.fillRect(0, y0, W, 1);
    }
    // the transition from heads to pine is a hard line on real wood lanes (the "dovetail")
    for (const zz of [HEADS, PINE_END]) {
      for (let b = 0; b < 39; b++) {
        const off = (b % 2 ? 0.06 : -0.06) + (b % 3) * 0.02;
        g.fillStyle = 'rgba(60,34,12,0.5)';
        g.fillRect(zx(-(zz + off)), Math.round(b * boardH), 2, Math.ceil(boardH));
      }
    }
    // markings (boards counted from the right for a right-hander: board 1 at the right edge)
    const boardX = n => L.HALF - (n - 0.5) * (2 * L.HALF / 39);
    g.fillStyle = '#17110c';
    // foul line
    g.fillRect(0, 0, Math.max(2, 0.01 / mPerPx), H);
    // dots at 7 ft
    for (const n of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
      g.beginPath(); g.ellipse(zx(-2.134), xy(boardX(n)), 0.009 / mPerPx, 0.009 / (2 * L.HALF / H), 0, 0, Math.PI * 2); g.fill();
    }
    // arrows (range finders), the V pointing at the pins
    [[5, 0], [10, 1], [15, 2], [20, 3], [25, 2], [30, 1], [35, 0]].forEach(([n, k]) => {
      const tip = 3.66 + k * 0.305, len = 0.16, half = 0.012;
      const cx = xy(boardX(n));
      g.fillStyle = '#20150d';
      g.beginPath();
      g.moveTo(zx(-tip), cx);
      g.lineTo(zx(-(tip - len)), cx - half / (2 * L.HALF / H));
      g.lineTo(zx(-(tip - len * 0.82)), cx);
      g.lineTo(zx(-(tip - len)), cx + half / (2 * L.HALF / H));
      g.closePath(); g.fill();
    });
    // down-lane markers at 40 ft (boards 10, 15, 25, 30)
    for (const n of [10, 15, 25, 30]) { g.fillStyle = 'rgba(30,20,12,0.6)'; g.fillRect(zx(-12.19), xy(boardX(n)) - 1, 0.05 / mPerPx, 3); }
    // pin spots
    for (let n = 1; n <= 10; n++) {
      const s = P.pinSpot(n);
      g.fillStyle = 'rgba(40,26,14,0.55)';
      g.beginPath(); g.ellipse(zx(s.z), xy(s.x), 0.028 / mPerPx, 0.028 / (2 * L.HALF / H), 0, 0, Math.PI * 2); g.fill();
    }
    const t = texFrom(c, true, true, renderer);
    t.generateMipmaps = true;
    return t;
  }

  function approachTexture(grain, renderer) {
    const W = 2048, H = 1024, c = canvas(W, H), g = c.getContext('2d');
    // u across the approach (x from -0.875 to 0.875), v along it (foul line at the top)
    const rnd = rngFrom(31), N = 66, bw = W / N;
    const LEN = L.APPROACH_END;
    for (let b = 0; b < N; b++) {
      let y = 0;
      while (y < H) {
        const seg = (0.9 + rnd() * 1.8) / LEN * H;
        g.save(); g.translate(b * bw, y); g.rotate(Math.PI / 2);
        g.drawImage(grain, rnd() * 600, rnd() * 980, 400, 24, 0, -bw, seg, bw);
        g.restore();
        const t = rnd();
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = `rgba(${200 + t * 30},${150 + t * 30},${86 + t * 30},0.36)`; g.fillRect(b * bw, y, bw, seg);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(70,40,15,0.35)'; g.fillRect(b * bw, y, bw, 1);
        y += seg;
      }
      g.fillStyle = 'rgba(80,46,18,0.4)'; g.fillRect(b * bw, 0, 1, H);
    }
    // approach dots: rows at 2-6 in, 12 ft and 15 ft
    const xpx = x => (x + 0.875) / 1.75 * W, zpx = z => z / LEN * H;
    g.fillStyle = '#1a120c';
    const boardX = n => L.HALF - (n - 0.5) * (2 * L.HALF / 39);
    for (const [z, set] of [[0.1, [3, 5, 8, 11, 14, 20, 26, 29, 32, 35, 37]], [3.66, [3, 5, 10, 15, 20, 25, 30, 35, 37]], [4.57, [3, 5, 10, 15, 20, 25, 30, 35, 37]]]) {
      for (const n of set) { g.beginPath(); g.arc(xpx(boardX(n)), zpx(z), n === 20 ? 9 : 7, 0, Math.PI * 2); g.fill(); }
    }
    return texFrom(c, true, true, renderer);
  }

  // ------------------------------------------------------------------ planar reflection
  function createMirror(renderer) {
    const rt = new T.WebGLRenderTarget(16, 16, { type: T.HalfFloatType, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, generateMipmaps: true });
    rt.texture.generateMipmaps = true;
    const cam = new T.PerspectiveCamera();
    const texMat = new T.Matrix4();
    const normal = new T.Vector3(0, 1, 0), P0 = new T.Vector3(0, 0, 0);
    const v = new T.Vector3(), look = new T.Vector3(), target = new T.Vector3(), camPos = new T.Vector3(), rot = new T.Matrix4();
    const plane = new T.Plane(), clip = new T.Vector4(), q = new T.Vector4();
    return {
      rt, texMat,
      setSize(w, h) { rt.setSize(Math.max(1, w), Math.max(1, h)); },
      render(scene, camera, hide) {
        camPos.setFromMatrixPosition(camera.matrixWorld);
        v.subVectors(P0, camPos);
        if (v.dot(normal) > 0) return;
        v.reflect(normal).negate(); v.add(P0);
        rot.extractRotation(camera.matrixWorld);
        look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
        target.subVectors(P0, look); target.reflect(normal).negate(); target.add(P0);
        cam.position.copy(v);
        cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
        cam.lookAt(target);
        cam.far = camera.far; cam.near = camera.near;
        cam.updateMatrixWorld();
        cam.projectionMatrix.copy(camera.projectionMatrix);
        texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
        // oblique near plane: only what is above the lane surface
        plane.setFromNormalAndCoplanarPoint(normal, P0).applyMatrix4(cam.matrixWorldInverse);
        clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
        const pm = cam.projectionMatrix;
        q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
        q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
        q.z = -1; q.w = (1 + pm.elements[10]) / pm.elements[14];
        clip.multiplyScalar(2 / clip.dot(q));
        pm.elements[2] = clip.x; pm.elements[6] = clip.y; pm.elements[10] = clip.z + 1 - 0.003; pm.elements[14] = clip.w;
        hide.forEach(o => { o.visible = false; });
        const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        renderer.shadowMap.autoUpdate = sh;
        hide.forEach(o => { o.visible = true; });
      },
    };
  }

  /** Adds the planar reflection to a standard/physical material lying on y = 0. */
  function reflective(mat, mirror, opts) {
    opts = Object.assign({ strength: 1, laneZ: true }, opts);
    mat.onBeforeCompile = sh => {
      sh.uniforms.reflMap = { value: mirror.rt.texture };
      sh.uniforms.reflMat = { value: mirror.texMat };
      sh.uniforms.reflStrength = { value: opts.strength };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; uniform sampler2D reflMap; uniform mat4 reflMat; uniform float reflStrength;`)
        .replace('#include <output_fragment>', `
          {
            vec4 rc = reflMat * vec4(vWPos, 1.0);
            vec2 ruv = rc.xy / rc.w;
            float dz = ${opts.laneZ ? '-vWPos.z' : '0.0'};
            // lacquer + oil: crisp heads, a touch softer down-lane, the dry back end and deck duller
            float gloss = ${opts.laneZ ? '1.0 - 0.38 * smoothstep(11.0, 14.5, dz) - 0.25 * smoothstep(17.6, 18.6, dz)' : '1.0'};
            float lod = ${opts.laneZ ? 'mix(0.0, 1.6, smoothstep(9.0, 15.0, dz)) + 0.6 * smoothstep(17.6, 18.6, dz)' : '1.2'};
            ruv += (vNormal.xz) * 0.0;
            vec3 refl = textureLod(reflMap, ruv, lod).rgb;
            vec3 V = normalize(cameraPosition - vWPos);
            float F = 0.05 + 0.95 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
            float k = reflStrength * gloss;
            outgoingLight = outgoingLight * (1.0 - F * k * 0.7) + refl * F * k;
          }
          #include <output_fragment>`);
    };
    mat.customProgramCacheKey = () => 'refl' + (opts.laneZ ? 'L' : 'A');
    return mat;
  }

  // ------------------------------------------------------------------ pins
  function pinGeometry() {
    // the regulation outline, smoothed and resampled evenly in height (so v = height)
    const prof = P.PIN_PROFILE.map(([y, r]) => new T.Vector3(r, y, 0));
    const curve = new T.CatmullRomCurve3(prof, false, 'centripetal');
    const dense = curve.getPoints(400);
    const pts = [];
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const y = P.PIN.HEIGHT * i / N;
      let r = 0;
      for (let k = 1; k < dense.length; k++) {
        if (dense[k].y >= y) { const a = dense[k - 1], b = dense[k], f = (y - a.y) / Math.max(1e-6, b.y - a.y); r = a.x + (b.x - a.x) * f; break; }
      }
      if (i === N) r = 0;
      if (i === 0) r = Math.max(r, 0.0258);
      pts.push(new T.Vector2(Math.max(0, r), y));
    }
    pts.unshift(new T.Vector2(0, 0));
    const g = new T.LatheGeometry(pts, 28);
    // v by height for the stripe texture
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / P.PIN.HEIGHT);
    g.translate(0, -P.PIN.COM, 0);
    g.computeVertexNormals();
    return g;
  }
  function pinTexture(renderer) {
    const c = canvas(256, 1024), g = c.getContext('2d');
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 256, 1024);
    // faint wear near the belly where pins hit each other
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(150,140,125,${Math.random() * 0.07})`;
      const y = 1024 - (0.06 + Math.random() * 0.12) / P.PIN.HEIGHT * 1024;
      g.fillRect(Math.random() * 256, y, 2 + Math.random() * 16, 1);
    }
    const band = (h0, h1) => { g.fillRect(0, 1024 - h1 / P.PIN.HEIGHT * 1024, 256, (h1 - h0) / P.PIN.HEIGHT * 1024); };
    g.fillStyle = '#c4141c';
    band(0.243, 0.253);
    band(0.262, 0.272);
    // small original crest on the front of the belly
    g.save(); g.translate(64, 1024 - 0.168 / P.PIN.HEIGHT * 1024);
    g.fillStyle = '#c4141c'; g.beginPath(); g.moveTo(0, -16); g.quadraticCurveTo(10, -2, 0, 14); g.quadraticCurveTo(-10, -2, 0, -16); g.fill();
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(4, 3, 0, 10); g.quadraticCurveTo(-4, 3, 0, -4); g.fill();
    g.restore();
    return texFrom(c, true, false, renderer);
  }

  // ------------------------------------------------------------------ balls
  function noise2(seed) {
    const rnd = rngFrom(seed), G = 64, v = new Float32Array(G * G);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    const at = (x, y) => v[((y % G + G) % G) * G + ((x % G + G) % G)];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  /** Swirl colour map + bump (finger holes) for a ball. cols: [base, swirl, accent] hex. */
  function ballTextures(cols, seed, renderer) {
    const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const n1 = noise2(seed), n2 = noise2(seed + 9);
    const C = cols.map(h => new T.Color(h));
    const fbm = (x, y, n) => n(x, y) * 0.5 + n(x * 2.1, y * 2.1) * 0.25 + n(x * 4.3, y * 4.3) * 0.125 + n(x * 8.7, y * 8.7) * 0.0625;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // wrap seamlessly around u by sampling on a circle
      const a = x / W * Math.PI * 2, r = 2.2;
      const px = Math.cos(a) * r + 10, py = Math.sin(a) * r + 10, pz = y / H * 4.5;
      const wx = fbm(px + pz * 0.7, py, n1) * 3.2, wy = fbm(py + 3.1, pz + px * 0.3, n2) * 3.2;
      const f = fbm(px + wx, pz + wy, n1);
      const s = Math.sin(f * 15.0 + wx * 2.0) * 0.5 + 0.5;
      const m1 = Math.pow(s, 2.2), m2 = Math.pow(Math.max(0, fbm(pz * 3 + wy, px * 3, n2) - 0.52) * 4, 2);
      let rr = C[0].r + (C[1].r - C[0].r) * m1, gg = C[0].g + (C[1].g - C[0].g) * m1, bb = C[0].b + (C[1].b - C[0].b) * m1;
      rr += (C[2].r - rr) * Math.min(1, m2); gg += (C[2].g - gg) * Math.min(1, m2); bb += (C[2].b - bb) * Math.min(1, m2);
      const i = (y * W + x) * 4;
      d[i] = rr * 255; d[i + 1] = gg * 255; d[i + 2] = bb * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // finger holes (two fingers + thumb) near the equator, and the bump map for them
    const b = canvas(512, 256), bg = b.getContext('2d');
    bg.fillStyle = '#808080'; bg.fillRect(0, 0, 512, 256);
    const holes = [[0.25, 0.43, 0.018], [0.25, 0.57, 0.018], [0.36, 0.5, 0.022]];
    for (const [u, v, r] of holes) {
      const hx = u * W, hy = v * H, rx = r / (2 * Math.PI * 0.1085) * W, ry = r / (Math.PI * 0.1085) * H;
      const grd = g.createRadialGradient(hx, hy, 0, hx, hy, rx);
      grd.addColorStop(0, '#050505'); grd.addColorStop(0.72, '#0b0b0b'); grd.addColorStop(0.86, 'rgba(40,40,40,0.9)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(hx, hy, rx * 1.1, ry * 1.1, 0, 0, Math.PI * 2); g.fill();
      const bx = u * 512, by = v * 256, brx = rx / 2, bry = ry / 2;
      const bgrd = bg.createRadialGradient(bx, by, 0, bx, by, brx * 1.15);
      bgrd.addColorStop(0, '#000'); bgrd.addColorStop(0.8, '#202020'); bgrd.addColorStop(0.92, '#a0a0a0'); bgrd.addColorStop(1, '#808080');
      bg.fillStyle = bgrd; bg.beginPath(); bg.ellipse(bx, by, brx * 1.15, bry * 1.15, 0, 0, Math.PI * 2); bg.fill();
    }
    return { map: texFrom(c, true, true, renderer), bump: texFrom(b, false, false, renderer) };
  }
  const BALL_SETS = [
    ['#2a0606', '#d8461c', '#ffb347'],   // ember
    ['#03161c', '#108a8a', '#9ef0e0'],   // tide
    ['#140620', '#7a2cc9', '#e2b8ff'],   // dusk
    ['#1d1405', '#c99a1c', '#fff1b0'],   // brass
  ];
  const HOUSE_SETS = [['#0b1a3a', '#3a64d8', '#cfe0ff'], ['#2a0a18', '#c2185b', '#ffc1e3'], ['#06200f', '#2e9e4f', '#c8ffd8'], ['#222', '#888', '#eee']];
  function ballMaterial(tx) {
    return new T.MeshPhysicalMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 0.004, roughness: 0.32, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1, sheen: 0 });
  }

  // ------------------------------------------------------------------ masking art
  function maskingArt(lane, w, h) {
    const c = canvas(w, h), g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0a0f24'); grd.addColorStop(0.62, '#13173a'); grd.addColorStop(1, '#3b1a2a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // warm horizon
    const hz = g.createRadialGradient(w * 0.5, h * 1.05, 10, w * 0.5, h * 1.05, w * 0.6);
    hz.addColorStop(0, 'rgba(255,140,60,0.85)'); hz.addColorStop(0.4, 'rgba(220,70,50,0.35)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz; g.fillRect(0, 0, w, h);
    // flowing ember lines
    const rnd = rngFrom(lane * 13 + 5);
    for (let k = 0; k < 9; k++) {
      g.strokeStyle = `rgba(255,${120 + rnd() * 90},${50 + rnd() * 40},${0.15 + rnd() * 0.35})`;
      g.lineWidth = 1 + rnd() * 2.5;
      g.beginPath();
      const y0 = h * (0.45 + rnd() * 0.5), amp = h * (0.05 + rnd() * 0.12), ph = rnd() * 6;
      for (let x = 0; x <= w; x += 8) { const y = y0 - amp * Math.sin(x / w * Math.PI * (1 + rnd() * 0.02) * 1.6 + ph); if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    // stars
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,235,210,${rnd() * 0.6})`; g.fillRect(rnd() * w, rnd() * h * 0.55, 1.5, 1.5); }
    // lantern emblem + lane number
    const cx = w * 0.5, cy = h * 0.42, R = h * 0.2;
    g.strokeStyle = 'rgba(255,190,120,0.95)'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,170,90,0.95)';
    g.beginPath(); g.moveTo(cx, cy - R * 0.62); g.quadraticCurveTo(cx + R * 0.42, cy, cx, cy + R * 0.58); g.quadraticCurveTo(cx - R * 0.42, cy, cx, cy - R * 0.62); g.fill();
    g.fillStyle = '#1a0f1c';
    g.beginPath(); g.moveTo(cx, cy - R * 0.18); g.quadraticCurveTo(cx + R * 0.18, cy + R * 0.12, cx, cy + R * 0.34); g.quadraticCurveTo(cx - R * 0.18, cy + R * 0.12, cx, cy - R * 0.18); g.fill();
    g.font = `700 ${Math.round(h * 0.13)}px "Segoe UI", system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillStyle = 'rgba(255,225,190,0.92)';
    g.fillText(String(lane), cx, h * 0.86);
    g.font = `600 ${Math.round(h * 0.055)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,200,150,0.55)';
    if (g.letterSpacing !== undefined) g.letterSpacing = '6px';
    g.fillText('EMBERLANE', cx, h * 0.12);
    return c;
  }

  /** Merge [geometry, x, y, z] parts (position, normal, uv) into one non-indexed geometry. */
  function mergeGeos(list) {
    const parts = list.map(([g, x, y, z]) => { const n = g.index ? g.toNonIndexed() : g; n.translate(x, y, z); return n; });
    const total = parts.reduce((k, g) => k + g.attributes.position.count, 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }

  /** Merge a group's direct child meshes that share material, shadow flags and layers into one
   * mesh each (fewer draw calls); children in `skip` stay as they are. */
  function mergeChildren(group, skip) {
    const by = new Map();
    for (const o of group.children) {
      if (!o.isMesh || (skip && skip.has(o)) || o.children.length) continue;
      const k = [o.material.uuid, o.castShadow, o.receiveShadow, o.layers.mask].join('|');
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(o);
    }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const geo = mergeGeos(list.map(o => { o.updateMatrix(); const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix); return [g, 0, 0, 0]; }));
      geo.computeBoundingSphere();
      const o0 = list[0], m = new T.Mesh(geo, o0.material);
      m.castShadow = o0.castShadow; m.receiveShadow = o0.receiveShadow; m.layers.mask = o0.layers.mask;
      list.forEach(o => group.remove(o));
      group.add(m);
    }
  }

  /** The kickback panel: dark laminate, a stainless pinstripe, ember lines rising toward the pit
   * and the lantern emblem near the deck. u = 0 at the bowler's end. */
  function kickbackArt(renderer) {
    const W = 2048, H = 440, c = canvas(W, H), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1d1a22'); bg.addColorStop(0.55, '#121117'); bg.addColorStop(1, '#0c0b0f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const rnd = rngFrom(404);
    // fine horizontal grain in the laminate
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.018})`; g.fillRect(rnd() * W, rnd() * H, 30 + rnd() * 220, 1); }
    // a soft ember swell low at the bowler's end, rising toward the deck
    const sw = g.createLinearGradient(0, H, W, 0);
    sw.addColorStop(0, 'rgba(255,90,30,0.0)'); sw.addColorStop(0.55, 'rgba(255,90,30,0.16)'); sw.addColorStop(1, 'rgba(255,140,60,0.05)');
    g.fillStyle = sw;
    g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 16) g.lineTo(x, H - (0.08 + 0.7 * Math.pow(x / W, 1.6)) * H); g.lineTo(W, H); g.closePath(); g.fill();
    // flowing lines
    for (let k = 0; k < 14; k++) {
      const a0 = 0.05 + rnd() * 0.25, a1 = 0.45 + rnd() * 0.45, ph = rnd() * 6, amp = 0.03 + rnd() * 0.06;
      g.strokeStyle = `rgba(255,${110 + rnd() * 100},${40 + rnd() * 50},${0.14 + rnd() * 0.32})`;
      g.lineWidth = 1 + rnd() * 2.4;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const u = x / W, y = H * (1 - (a0 + (a1 - a0) * Math.pow(u, 1.4)) - amp * Math.sin(u * 7 + ph));
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // lantern emblem near the deck end
    const cx = W * 0.74, cy = H * 0.42, R = H * 0.2;
    g.strokeStyle = 'rgba(255,180,110,0.55)'; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,150,70,0.6)';
    g.beginPath(); g.moveTo(cx, cy - R * 0.62); g.quadraticCurveTo(cx + R * 0.42, cy, cx, cy + R * 0.58); g.quadraticCurveTo(cx - R * 0.42, cy, cx, cy - R * 0.62); g.fill();
    g.fillStyle = '#14121a';
    g.beginPath(); g.moveTo(cx, cy - R * 0.18); g.quadraticCurveTo(cx + R * 0.18, cy + R * 0.12, cx, cy + R * 0.34); g.quadraticCurveTo(cx - R * 0.18, cy + R * 0.12, cx, cy - R * 0.18); g.fill();
    // stainless pinstripes and panel joints
    g.fillStyle = 'rgba(200,205,215,0.55)'; g.fillRect(0, 10, W, 3); g.fillRect(0, H - 12, W, 2);
    g.fillStyle = 'rgba(0,0,0,0.6)'; for (const u of [0.33, 0.66]) g.fillRect(u * W, 0, 3, H);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (const u of [0.33, 0.66]) g.fillRect(u * W + 3, 0, 1, H);
    const t = texFrom(c, true, true, renderer);
    return t;
  }
  /** Back wall of the pinsetter bays: a faint cool glow up top so the machines read as silhouettes. */
  function bayWallTex(renderer) {
    const c = canvas(64, 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#1b1d24'); gr.addColorStop(0.35, '#121318'); gr.addColorStop(0.7, '#08090d'); gr.addColorStop(1, '#030304');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    return texFrom(c, true, false, renderer);
  }

  // ------------------------------------------------------------------ build
  function build(renderer, A) {
    const scene = new T.Scene();
    scene.background = new T.Color(0x07060a);
    scene.fog = new T.FogExp2(0x0d0a10, 0.011);
    const pmrem = new T.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(A.hdr).texture;
    scene.environment = env;
    A.hdr.dispose(); pmrem.dispose();

    const grain = prepGrain(A.maple);
    const mirror = createMirror(renderer);
    const laneTex = laneTexture(grain, renderer);
    const reflHide = [];

    // ---- materials
    const laneMat = reflective(new T.MeshStandardMaterial({ map: laneTex, color: new T.Color(0.95, 0.78, 0.6), roughness: 0.12, metalness: 0, envMapIntensity: 0.15 }), mirror, { strength: 1.5 });
    const apprMat = reflective(new T.MeshStandardMaterial({ map: approachTexture(grain, renderer), color: new T.Color(0.95, 0.8, 0.64), roughness: 0.28, envMapIntensity: 0.15 }), mirror, { strength: 0.7, laneZ: false });
    const capMat = new T.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.3, metalness: 0.2, envMapIntensity: 0.6 });
    const gutterMat = new T.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.32, metalness: 0.35, envMapIntensity: 0.45 });
    const blackMat = new T.MeshBasicMaterial({ color: 0x020203 });
    const ceilMat = new T.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.9 });
    const wallTex = A.tex.concrete; wallTex.wrapS = wallTex.wrapT = T.RepeatWrapping; wallTex.repeat.set(6, 2);
    const wallMat = new T.MeshStandardMaterial({ color: 0x2a2a3a, map: wallTex, normalMap: A.tex.concreteN, roughness: 0.85, envMapIntensity: 0.3 });
    A.tex.concreteN.wrapS = A.tex.concreteN.wrapT = T.RepeatWrapping; A.tex.concreteN.repeat.set(6, 2);
    const carpetTex = A.tex.carpet; carpetTex.wrapS = carpetTex.wrapT = T.RepeatWrapping; carpetTex.repeat.set(10, 4);
    const carpetMat = new T.MeshStandardMaterial({ color: 0x4a3550, map: carpetTex, roughness: 1, envMapIntensity: 0.2 });
    const metalTex = A.tex.metal; metalTex.wrapS = metalTex.wrapT = T.RepeatWrapping;
    const metalMat = new T.MeshStandardMaterial({ color: 0x9a9aa2, map: metalTex, normalMap: A.tex.metalN, roughness: 0.38, metalness: 0.9, envMapIntensity: 1 });
    const hoodMat = new T.MeshStandardMaterial({ color: 0x3a1410, roughness: 0.2, envMapIntensity: 0.9 });
    const glow = (hex, k) => new T.MeshBasicMaterial({ color: new T.Color(hex).multiplyScalar(k), fog: false, toneMapped: false });

    // ---- pin deck surroundings (kickbacks, pit, curtain, the pinsetter bay)
    const KB_TOP = 0.95, KB_PLATE = 0.17, KB_LEN = 3.7, KB_Z = -18.55;
    const kickSideMat = new T.MeshStandardMaterial({ color: 0x141318, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.4 });
    const kickTex = kickbackArt(renderer);
    const kickArtMat = [false, true].map(flip => {
      const t = flip ? kickTex.clone() : kickTex;
      if (flip) { t.wrapS = T.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; t.needsUpdate = true; }
      return new T.MeshStandardMaterial({ map: t, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.55 });
    });
    const kickArtGeo = new T.PlaneGeometry(KB_LEN, KB_TOP - KB_PLATE);
    const plateTex = A.tex.metal.clone(); plateTex.wrapS = plateTex.wrapT = T.RepeatWrapping; plateTex.repeat.set(9, 0.5); plateTex.needsUpdate = true;
    const kickPlateMat = new T.MeshStandardMaterial({ color: 0x9aa0a8, map: plateTex, roughness: 0.34, metalness: 1, envMapIntensity: 0.9 });
    const chromeTrim = new T.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.22, metalness: 1, envMapIntensity: 1 });
    const pitMat = new T.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, envMapIntensity: 0.2 });
    const curtainN = A.tex.clothN.clone(); curtainN.wrapS = curtainN.wrapT = T.RepeatWrapping; curtainN.repeat.set(10, 8); curtainN.needsUpdate = true;
    const curtainMat = new T.MeshPhysicalMaterial({ color: 0x15141b, roughness: 0.82, normalMap: curtainN, normalScale: new T.Vector2(0.6, 0.6),
      sheen: 1, sheenColor: new T.Color(0x4b4458), sheenRoughness: 0.38, envMapIntensity: 0.25 });
    const curtainGeo = (() => {
      // heavy pit curtain hanging in folds just behind the cushion line
      const w = 2 * L.GUTTER_X + 0.12, y0 = L.PIT_Y, y1 = 1.2;
      const g = new T.PlaneGeometry(w, y1 - y0, 160, 6);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), yk = (p.getY(i) + (y1 - y0) / 2) / (y1 - y0);
        const f = 0.026 * Math.sin(x * Math.PI * 2 / 0.14 + 0.5 * Math.sin(x * 9.0)) + 0.009 * Math.sin(x * Math.PI * 2 / 0.053 + 1.3);
        p.setXYZ(i, x, y0 + yk * (y1 - y0), L.BACK_Z - 0.05 + f * (0.75 + 0.25 * (1 - yk)));
      }
      g.computeVertexNormals();
      return g;
    })();
    // the pinsetter: setting table with its spotting cups, side frames, sweep guides, the
    // curtain rod, and the pin wheel turning behind the curtain. Merged per kind of material.
    const setterMat = new T.MeshStandardMaterial({ color: 0x3a3d42, map: A.tex.metal, normalMap: A.tex.metalN, roughness: 0.5, metalness: 0.6, envMapIntensity: 0.6 });
    const cupMat = new T.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.45, metalness: 0.7, envMapIntensity: 0.6, side: T.DoubleSide });
    const SET_Y = 1.64;
    const setterGeo = mergeGeos([
      [new T.BoxGeometry(1.52, 0.05, 2.1), 0, SET_Y, -18.75],
      [new T.BoxGeometry(1.4, 0.12, 0.05), 0, SET_Y + 0.05, -17.68],
      ...[-1, 1].flatMap(s => [
        [new T.BoxGeometry(0.06, 1.12, 0.1), s * 0.865, 1.22, -17.72],
        [new T.BoxGeometry(0.06, 1.12, 0.1), s * 0.865, 1.22, -19.85],
        [new T.BoxGeometry(0.08, 0.09, 2.5), s * 0.865, 1.8, -18.78],
        [new T.BoxGeometry(0.03, 0.55, 0.06), s * 0.835, 1.5, -17.9],       // sweep guides
        [new T.BoxGeometry(0.05, 0.05, 1.5), s * 0.865, 1.02, -18.8],        // lower rail
      ]),
      [new T.BoxGeometry(1.76, 0.07, 0.07), 0, 1.22, L.BACK_Z - 0.1],         // curtain rod
      [new T.BoxGeometry(1.76, 0.06, 0.08), 0, 1.78, -19.9],
    ]);
    const cupGeo = mergeGeos(Array.from({ length: 10 }, (_, i) => { const sp = P.pinSpot(i + 1); return [new T.CylinderGeometry(0.052, 0.058, 0.1, 18, 1, true), sp.x, SET_Y - 0.075, sp.z]; }));
    const WHEEL = { Y: 0.8, Z: -20.62, R: 0.78 };
    const wheelGeo = mergeGeos([
      [new T.TorusGeometry(WHEEL.R, 0.024, 8, 72), 0, 0, 0],
      [new T.TorusGeometry(WHEEL.R - 0.17, 0.016, 8, 60), 0, 0, 0],
      [new T.CylinderGeometry(0.09, 0.09, 0.12, 20).rotateX(Math.PI / 2), 0, 0, 0],
      ...Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; const g = new T.BoxGeometry(0.026, WHEEL.R, 0.02); g.translate(0, WHEEL.R / 2, 0); g.rotateZ(a); return [g, 0, 0, 0]; }),
      ...Array.from({ length: 14 }, (_, i) => { const a = (i + 0.5) / 14 * Math.PI * 2; const g = new T.BoxGeometry(0.12, 0.05, 0.08); g.translate(0, WHEEL.R - 0.085, 0.04); g.rotateZ(a); return [g, 0, 0, 0]; }),
    ]);
    const wheels = [];
    const kickLed = glow(0xffa860, 1.6);

    // ---- lanes
    const laneGeo = (() => {
      const g = new T.BufferGeometry(), x0 = -L.HALF, x1 = L.HALF, z0 = 0, z1 = -LANE_LEN;
      g.setAttribute('position', new T.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
      g.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      // u along the lane, v across (right edge = v 1)
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    })();
    const gutterGeo = (() => {
      // an elliptic channel, as deep as the physics gutter floor
      const segs = 18, w = (L.GUTTER_X - L.HALF) / 2, depth = -L.GUTTER_Y;
      const shape = [];
      for (let i = 0; i <= segs; i++) { const a = Math.PI * i / segs; shape.push([-Math.cos(a) * w, -Math.sin(a) * depth * 1.02]); }
      const pos = [], idx = [];
      const z0 = 0.0, z1 = L.PIT_Z;
      for (let i = 0; i <= segs; i++) { pos.push(shape[i][0], shape[i][1], z0, shape[i][0], shape[i][1], z1); }
      for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    })();
    const laneXs = [];
    for (let k = -NEIGH; k <= NEIGH; k++) laneXs.push(k * PITCH);
    const lanes = new T.Group(); scene.add(lanes);
    for (const lx of laneXs) {
      const lane = new T.Mesh(laneGeo, laneMat); lane.position.x = lx; lane.receiveShadow = true; lanes.add(lane); reflHide.push(lane);
      for (const s of [-1, 1]) {
        const gt = new T.Mesh(gutterGeo, gutterMat); gt.position.set(lx + s * (L.HALF + L.GUTTER_X) / 2, 0, 0); gt.receiveShadow = true; lanes.add(gt); reflHide.push(gt);
        // capping between gutters (shared by neighbours, drawn once per side)
        const cap = box(CAP_OUT - CAP_IN, 0.03, LANE_LEN + 0.4, capMat, lx + s * (CAP_IN + CAP_OUT) / 2, 0.012, -LANE_LEN / 2 + 0.2, lanes);
        cap.receiveShadow = true;
        // foul-line sensor housings
        box(0.06, 0.05, 0.08, metalMat, lx + s * (CAP_IN + 0.05), 0.04, 0.0, lanes);
        // kickbacks: a laminate panel with the house graphic (lane side), a stainless kick plate
        // along the bottom, an aluminium cap with a warm LED line under it
        const kx = lx + s * (L.GUTTER_X + 0.015);
        box(0.03, KB_TOP - KB_PLATE, KB_LEN, kickSideMat, kx, (KB_TOP + KB_PLATE) / 2, KB_Z, lanes);
        const art = new T.Mesh(kickArtGeo, kickArtMat[s < 0 ? 0 : 1]);
        art.rotation.y = -s * Math.PI / 2; art.position.set(lx + s * (L.GUTTER_X - 0.0005), (KB_TOP + KB_PLATE) / 2, KB_Z);
        art.receiveShadow = true; lanes.add(art);
        const plate = box(0.034, KB_PLATE - L.GUTTER_Y, KB_LEN, kickPlateMat, kx, (KB_PLATE + L.GUTTER_Y) / 2, KB_Z, lanes);
        plate.receiveShadow = true;
        box(0.05, 0.022, KB_LEN + 0.02, chromeTrim, kx, KB_TOP + 0.011, KB_Z, lanes);
        box(0.004, 0.008, KB_LEN - 0.1, kickLed, lx + s * (L.GUTTER_X - 0.002), KB_TOP - 0.012, KB_Z, lanes);
      }
      // the pit: rubber mat floor, its front wall under the deck edge, the hanging curtain
      const pitFloor = box(2 * L.GUTTER_X, 0.02, 1.2, pitMat, lx, L.PIT_Y, (L.PIT_Z + L.BACK_Z) / 2, lanes);
      pitFloor.receiveShadow = true;
      box(2 * L.HALF, 0.6, 0.02, pitMat, lx, -0.3, L.PIT_Z - 0.01, lanes);
      const cur = new T.Mesh(curtainGeo, curtainMat); cur.position.set(lx, 0, 0); cur.receiveShadow = true; lanes.add(cur);
      // the pinsetter in its bay above the deck
      const ps = new T.Mesh(setterGeo, setterMat); ps.position.x = lx; ps.layers.set(1); lanes.add(ps);   // layer 1: not drawn in the lane reflection
      const cups = new T.Mesh(cupGeo, cupMat); cups.position.x = lx; cups.layers.set(1); lanes.add(cups);
      const wheel = new T.Mesh(wheelGeo, setterMat); wheel.position.set(lx, WHEEL.Y, WHEEL.Z); wheel.rotation.z = lx * 0.7; wheel.layers.set(1); lanes.add(wheel);
      wheels.push(wheel);
    }
    // one draw call per material for all the lanes' fittings (caps, kickbacks, pits, curtains...)
    mergeChildren(lanes, new Set([...reflHide, ...wheels]));

    // ---- gutter bumpers on our lane (an option, physics.js BUMPER): a moulded rail over each
    // gutter, its inner face on the lane edge, satin black with an ember light line along the top
    // inner edge and an ember underglow into the gutter, held by arms from the capping
    const B = P.BUMPER;
    const bumpers = new T.Group(); bumpers.visible = false; scene.add(bumpers);
    const railMat = new T.MeshStandardMaterial({ color: 0x3a2219, roughness: 0.28, metalness: 0.25, envMapIntensity: 1.0 });
    const railGeo = (() => {
      const sh = new T.Shape(), W = B.W, H = B.TOP, r = 0.028, y0 = -0.03;
      sh.moveTo(0, y0); sh.lineTo(0, H - r); sh.quadraticCurveTo(0, H, r, H);
      sh.lineTo(W - 0.012, H); sh.quadraticCurveTo(W, H, W, H - 0.012); sh.lineTo(W, y0); sh.lineTo(0, y0);
      const g = new T.ExtrudeGeometry(sh, { depth: B.Z0 - B.Z1, bevelEnabled: false, curveSegments: 8 });
      g.translate(0, 0, B.Z1);
      return g;
    })();
    const bumpGlow = glow(0xff6a2a, 3.0), bumpFace = glow(0xff5a24, 1.6), bumpUnder = glow(0xff7a30, 0.9);
    for (const s of [-1, 1]) {
      const rail = new T.Mesh(railGeo, railMat);
      rail.position.x = s * B.X; rail.scale.x = s; rail.castShadow = true; rail.receiveShadow = true; bumpers.add(rail);
      const zc = (B.Z0 + B.Z1) / 2, zl = B.Z0 - B.Z1 - 0.06;
      box(0.012, 0.004, zl, bumpGlow, s * (B.X + 0.03), B.TOP + 0.002, zc, bumpers);           // ember line along the top
      box(0.003, 0.008, zl, bumpFace, s * (B.X - 0.0012), B.TOP - 0.045, zc, bumpers);         // and down the lane-side face
      box(0.004, 0.004, zl, bumpUnder, s * (B.X + B.W * 0.5), -0.033, zc, bumpers);           // underglow into the gutter
      for (let z = B.Z0 - 0.4; z > B.Z1 + 0.3; z -= 2.2)                                          // arms to the capping
        box(L.GUTTER_X + 0.02 - (B.X + B.W), 0.018, 0.04, capMat, s * (B.X + B.W + L.GUTTER_X + 0.02) / 2, 0.02, z, bumpers);
    }
    // the approach: one wide floor, and the floor between approaches
    const approach = new T.Mesh(new T.PlaneGeometry(PITCH, L.APPROACH_END), apprMat);
    approach.rotation.x = -Math.PI / 2; approach.position.set(0, 0, L.APPROACH_END / 2); approach.receiveShadow = true;
    // plane uv: u across (x), v along: the canvas has the foul line at the top (v = 1 at z = 0)
    scene.add(approach); reflHide.push(approach);
    for (const lx of laneXs) {
      if (lx === 0) continue;
      const a = new T.Mesh(approach.geometry, apprMat); a.rotation.x = -Math.PI / 2; a.position.set(lx, 0, L.APPROACH_END / 2); a.receiveShadow = true; scene.add(a); reflHide.push(a);
    }
    // settee floor (carpet) beyond the approaches, a step down
    const carpet = new T.Mesh(new T.PlaneGeometry(PITCH * (2 * NEIGH + 1) + 2, 6), carpetMat);
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, -0.15, L.APPROACH_END + 3); carpet.receiveShadow = true; scene.add(carpet);
    box(PITCH * (2 * NEIGH + 1) + 2, 0.15, 0.06, capMat, 0, -0.075, L.APPROACH_END + 0.03, scene);

    // ---- masking unit across all lanes
    const HALL_W = PITCH * (2 * NEIGH + 1);
    const MASK_Z = -17.35, MASK_Y0 = 0.98, MASK_Y1 = 2.05;
    // the masking unit is a fascia over the pinsetter bays: a hood above, the panels' backing,
    // the bays' ceiling, and the back wall glowing faintly behind the machines
    const maskDark = new T.MeshBasicMaterial({ color: 0x040405 });
    box(HALL_W + 1, 0.45, 3.5, maskDark, 0, MASK_Y1 + 0.225, MASK_Z - 1.75, scene);
    box(HALL_W + 1, MASK_Y1 - MASK_Y0, 0.02, maskDark, 0, (MASK_Y0 + MASK_Y1) / 2, MASK_Z - 0.03, scene);
    box(HALL_W + 1, 0.03, 3.5, new T.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.8 }), 0, 1.9, MASK_Z - 1.75, scene);
    const bayWall = new T.Mesh(new T.PlaneGeometry(HALL_W + 1, 1.9 - L.PIT_Y), new T.MeshBasicMaterial({ map: bayWallTex(renderer) }));
    bayWall.position.set(0, (1.9 + L.PIT_Y) / 2, -20.82); scene.add(bayWall);
    const panelW = PITCH - 0.06, panelH = MASK_Y1 - MASK_Y0;
    let ourPanel = null;
    laneXs.forEach((lx, i) => {
      const num = 11 + i;
      const c = maskingArt(num, 896, 544);
      const tex = texFrom(c, true, true, renderer);
      const mat = new T.MeshBasicMaterial({ map: tex, color: new T.Color(0.9, 0.9, 0.9), toneMapped: false, fog: true });
      const m = new T.Mesh(new T.PlaneGeometry(panelW, panelH), mat);
      m.position.set(lx, (MASK_Y0 + MASK_Y1) / 2, MASK_Z + 0.002); scene.add(m);
      if (lx === 0) ourPanel = { mesh: m, canvas: c, tex, base: maskingArt(num, 896, 544), num };
      // trim lines
      box(panelW + 0.04, 0.02, 0.02, glow(0xff8a40, 2.4), lx, MASK_Y1 + 0.02, MASK_Z + 0.01, scene);
    });
    // the light bar under the masking unit (lights the deck; its glow shows in the lane)
    box(HALL_W, 0.03, 0.05, glow(0xfff1dc, 2.2), 0, MASK_Y0 - 0.03, MASK_Z - 0.08, scene);
    box(HALL_W + 1, 0.06, 0.2, new T.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 }), 0, MASK_Y0 - 0.06, MASK_Z + 0.06, scene);

    // ---- ceiling, soffit, lane lights
    const ceil = new T.Mesh(new T.PlaneGeometry(HALL_W + 2, 30), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.6, -6); scene.add(ceil);
    const soffit = box(HALL_W + 1, 0.5, 15, new T.MeshStandardMaterial({ color: 0x101016, roughness: 0.8 }), 0, 3.15, -9.0, scene);
    soffit.receiveShadow = false;
    const fixtures = new T.Group(); scene.add(fixtures);
    const puckMat = glow(0xffd9b0, 5), downMat = glow(0xffd29a, 6), puckGeo = new T.CylinderGeometry(0.07, 0.07, 0.02, 20), downGeo = new T.CylinderGeometry(0.09, 0.09, 0.02, 24);
    for (const lx of laneXs) {
      for (let z = -3.2; z > -15; z -= 4.6) {
        const c = new T.Mesh(puckGeo, puckMat);
        c.position.set(lx, 2.89, z); fixtures.add(c);
      }
      // warm downlight pucks over the approach
      for (const zz of [1.2, 3.4]) {
        const ring = new T.Mesh(downGeo, downMat);
        ring.position.set(lx, 3.58, zz); fixtures.add(ring);
      }
    }
    // ember neon along the front edge of the soffit
    box(HALL_W + 1, 0.025, 0.025, glow(0xff6a2a, 4), 0, 2.88, -1.48, scene);
    box(HALL_W + 1, 0.3, 0.04, new T.MeshStandardMaterial({ color: 0x1a1018, roughness: 0.6 }), 0, 3.05, -1.5, scene);

    // ---- side walls with sconces and neon
    const sconceGlow = glow(0xffb070, 4.2), sconceMat = new T.MeshStandardMaterial({ color: 0x18110c, roughness: 0.5, metalness: 0.4 });
    for (const s of [-1, 1]) {
      const wx = s * (HALL_W / 2 + 0.6);
      const wall = new T.Mesh(new T.PlaneGeometry(30, 3.8), wallMat);
      wall.rotation.y = -s * Math.PI / 2; wall.position.set(wx, 1.75, -7); wall.receiveShadow = true; scene.add(wall);
      for (let z = 2; z > -16; z -= 3.5) {
        box(0.06, 0.5, 0.12, sconceGlow, wx - s * 0.04, 1.9, z, fixtures);
        box(0.08, 0.6, 0.18, sconceMat, wx - s * 0.01, 1.9, z, fixtures);
      }
      box(0.03, 0.03, 30, glow(0xff5a24, 3.2), wx - s * 0.03, 2.75, -7, scene);
    }
    mergeChildren(fixtures);
    // back wall behind the settee
    const back = new T.Mesh(new T.PlaneGeometry(HALL_W + 2, 3.8), wallMat);
    back.rotation.y = Math.PI; back.position.set(0, 1.75, L.APPROACH_END + 6); scene.add(back);

    // ---- ball returns (between pairs of lanes): a low console with a rounded hood where the
    // balls come up, chrome rails and an ember light line, a few house balls waiting
    const consoleMat = new T.MeshStandardMaterial({ color: 0x101014, roughness: 0.42, metalness: 0.1, envMapIntensity: 0.5 });
    const chrome = new T.MeshStandardMaterial({ color: 0xd8d8de, roughness: 0.12, metalness: 1, envMapIntensity: 1.2 });
    const balls = [];
    const ballGeo = new T.SphereGeometry(P.BALL.R, 64, 40);
    const playerBallMats = BALL_SETS.map((c, i) => ballMaterial(ballTextures(c, 100 + i, renderer)));
    const houseMats = HOUSE_SETS.map((c, i) => ballMaterial(ballTextures(c, 200 + i, renderer)));
    const consoleGeo = (() => {
      // side profile (z along, y up): low at the front, rising to the hood at the back
      const sh = new T.Shape();
      sh.moveTo(0, 0); sh.lineTo(1.9, 0); sh.lineTo(1.9, 0.62); sh.quadraticCurveTo(1.9, 0.9, 1.6, 0.92);
      sh.lineTo(1.25, 0.92); sh.quadraticCurveTo(1.05, 0.92, 0.95, 0.62); sh.lineTo(0.1, 0.5); sh.quadraticCurveTo(0, 0.49, 0, 0.4); sh.lineTo(0, 0);
      const g = new T.ExtrudeGeometry(sh, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 });
      g.translate(0, 0, -0.18); g.rotateY(-Math.PI / 2);   // profile x -> world +z
      return g;
    })();
    for (const lx of [-PITCH / 2, -PITCH / 2 - 2 * PITCH, PITCH / 2 + PITCH, PITCH / 2 + 3 * PITCH]) {
      const g = new T.Group(); g.position.set(lx, 0, 0.55); scene.add(g);
      const body = new T.Mesh(consoleGeo, consoleMat); body.castShadow = true; body.receiveShadow = true; g.add(body);
      // the hood opening (dark) and its chrome ring
      const ring = new T.Mesh(new T.TorusGeometry(0.15, 0.018, 12, 32, Math.PI), chrome);
      ring.position.set(0, 0.62, 0.93); ring.rotation.y = Math.PI; g.add(ring);
      const mouth = new T.Mesh(new T.CircleGeometry(0.15, 24, 0, Math.PI), blackMat); mouth.position.set(0, 0.62, 0.935); mouth.rotation.y = Math.PI; g.add(mouth);
      // rails on the low deck and an ember light line along the side
      for (const s of [-1, 1]) {
        const rail = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.9, 10), chrome);
        rail.rotation.x = Math.PI / 2 - 0.13; rail.position.set(s * 0.09, 0.58, 0.5); g.add(rail);
        box(0.006, 0.012, 1.7, glow(0xff7a30, 2.6), s * 0.215, 0.3, 0.95, g);
      }
      for (let k = 0; k < 3; k++) {
        const b = new T.Mesh(ballGeo, houseMats[(k + Math.round(lx * 3)) & 3]);
        b.position.set(0, 0.55 + P.BALL.R + k * 0.03, 0.45 + k * 0.23); b.rotation.set(Math.random() * 6, Math.random() * 6, 0); b.castShadow = true; g.add(b);
      }
    }

    // ---- settee seats (behind the bowler; seen in the attract camera)
    const leatherMat = new T.MeshStandardMaterial({ color: 0x5a1a14, normalMap: A.tex.leatherN, roughness: 0.5, envMapIntensity: 0.5 });
    for (const lx of laneXs) {
      const g = new T.Group(); g.position.set(lx, -0.15, L.APPROACH_END + 2.2); scene.add(g);
      const seat = new T.Mesh(new T.CapsuleGeometry(0.22, 1.0, 6, 16), leatherMat);
      seat.rotation.z = Math.PI / 2; seat.scale.set(1, 1, 0.6); seat.position.set(0, 0.42, 0); g.add(seat);
      const backr = new T.Mesh(new T.CapsuleGeometry(0.2, 1.0, 6, 16), leatherMat);
      backr.rotation.z = Math.PI / 2; backr.scale.set(1, 1, 0.45); backr.position.set(0, 0.75, 0.25); g.add(backr);
      box(1.3, 0.3, 0.5, capMat, 0, 0.15, 0, g);
    }

    // ---- pins: ours (physics-driven) and the neighbours' racks
    const pinGeo = pinGeometry();
    // glossy white plastic coat: lit by the deck light, only a little by the room (the room's
    // lamps in the clearcoat give the highlights; more and the whole pin blooms)
    const pinMat = new T.MeshPhysicalMaterial({ map: pinTexture(renderer), roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 0.28 });
    const pins = [];
    for (let i = 0; i < 10; i++) {
      const m = new T.Mesh(pinGeo, pinMat); m.castShadow = true; m.receiveShadow = true; scene.add(m); pins.push(m);
    }
    const neigh = new T.InstancedMesh(pinGeo, pinMat, NEIGH * 2 * 10);
    neigh.castShadow = true; neigh.receiveShadow = true;
    {
      const rnd = rngFrom(5), M = new T.Matrix4(), Q = new T.Quaternion();
      let k = 0;
      for (const lx of laneXs) {
        if (lx === 0) continue;
        const leave = rnd() < 0.4 ? new Set([1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 10)]) : new Set();
        for (let n = 1; n <= 10; n++) {
          const s = P.pinSpot(n);
          const gone = leave.has(n);
          M.compose(new T.Vector3(lx + s.x + (rnd() - 0.5) * 0.008, gone ? -5 : P.PIN.COM, s.z + (rnd() - 0.5) * 0.008), Q, new T.Vector3(1, 1, 1));
          neigh.setMatrixAt(k++, M);
        }
      }
      neigh.count = k;
    }
    scene.add(neigh);
    // pins riding in the pin wheels' pockets
    const wheelPinGeo = mergeGeos(Array.from({ length: 9 }, (_, i) => {
      const a = (i * 1.55 + 0.5) / 14 * Math.PI * 2, g = pinGeo.clone();
      g.rotateZ(a + Math.PI); g.translate(-Math.sin(a) * (WHEEL.R - 0.14), Math.cos(a) * (WHEEL.R - 0.14), 0.1);
      return [g, 0, 0, 0];
    }));
    const wheelPinMat = new T.MeshStandardMaterial({ map: pinMat.map, color: 0x4e4c4a, roughness: 0.4, envMapIntensity: 0.12 });
    for (const w of wheels) { const m = new T.Mesh(wheelPinGeo, wheelPinMat); m.layers.set(1); w.add(m); }

    // the ball in play
    const ball = new T.Mesh(ballGeo, playerBallMats[0]);
    ball.castShadow = true; scene.add(ball);

    // the pinsetter's sweep bar
    const sweep = box(2 * L.GUTTER_X + 0.1, 0.16, 0.05, new T.MeshPhysicalMaterial({ color: 0x23232a, roughness: 0.3, metalness: 0.6, clearcoat: 0.5 }), 0, 1.4, -17.9, scene);
    sweep.castShadow = true;

    // ---- lights
    scene.add(new T.HemisphereLight(0x3a3448, 0x140c08, 0.25));
    // the masking unit's deck light: just behind the bottom edge of the panels, aimed down and
    // back over the pins (the key light of the deck; also grazes the kickbacks and the curtain)
    const deck = new T.SpotLight(0xfff1de, 4.7, 7, 1.05, 0.65, 1.5);
    deck.position.set(0, 0.96, -17.3); deck.target.position.set(0, 0, -19.1);
    deck.castShadow = true; deck.shadow.mapSize.set(1024, 1024); deck.shadow.camera.near = 0.3; deck.shadow.camera.far = 4; deck.shadow.bias = -0.0004; deck.shadow.normalBias = 0.01;
    scene.add(deck, deck.target);
    // one wide, shadowless light for the neighbours' decks
    const nd = new T.SpotLight(0xfff3e2, 13, 12, 1.5, 0.5, 1.6);
    nd.position.set(0, 2.6, -15.6); nd.target.position.set(0, 0, -19.4);
    scene.add(nd, nd.target);
    const key = new T.SpotLight(0xffd6a8, 26, 9, 0.75, 0.6, 1.4);
    key.position.set(0.2, 3.4, 2.0); key.target.position.set(0.1, 0, -0.6);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 7; key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const wash = new T.SpotLight(0xffd8b0, 22, 22, 0.55, 0.9, 1.3);
    wash.position.set(0, 3.0, -1.0); wash.target.position.set(0, 0, -12);
    scene.add(wash, wash.target);

    // ---- our masking panel: redraw for moments (strike, spare, count)
    function panel(drawFn) {
      const p = ourPanel, g = p.canvas.getContext('2d');
      g.drawImage(p.base, 0, 0);
      if (drawFn) drawFn(g, p.canvas.width, p.canvas.height);
      p.tex.needsUpdate = true;
    }

    const lastMirrorCam = new T.Matrix4(); let mirrorSkip = 0, mirrorDiv = 3, mirrorEvery = 2, lastW = 0, lastH = 0;

    return {
      scene, env, mirror, reflHide, pins, ball, wheel: wheels[NEIGH], ballGeo, playerBallMats, houseMats, sweep, deck, key, laneXs, panel,
      laneMat, BALL_SETS, PITCH, bumpers,
      setBumpers(on) { bumpers.visible = !!on; },
      setSize(w, h) { lastW = w; lastH = h; mirror.setSize(Math.round(w / mirrorDiv), Math.round(h / mirrorDiv)); },
      /** Low quality: the reflection at a quarter of the screen size, refreshed every third frame while the camera holds. */
      setQuality(low) { mirrorDiv = low ? 4 : 3; mirrorEvery = low ? 3 : 2; if (lastW) this.setSize(lastW, lastH); },
      // the reflection refreshes every frame while the camera moves, every other frame while
      // it holds still (the bowler's and the deck's views), where nothing in it moves fast
      renderReflection(camera) {
        camera.updateMatrixWorld();
        const e0 = lastMirrorCam.elements, e1 = camera.matrixWorld.elements;
        let rot = 0; for (let i = 0; i < 11; i++) rot = Math.max(rot, Math.abs(e0[i] - e1[i]));
        const dp = Math.hypot(e0[12] - e1[12], e0[13] - e1[13], e0[14] - e1[14]);
        const moved = rot > 0.002 || dp > 0.008;   // slow drifts count as still
        // a gentle glide (the strike camera drifting in, < 3 cm / 0.25 deg a frame) refreshes every
        // other frame: a full reflection pass every frame there was the strike-camera hitch
        const fast = rot > 0.004 || dp > 0.03;
        if (fast || ++mirrorSkip >= (moved ? 2 : mirrorEvery)) { mirrorSkip = 0; lastMirrorCam.copy(camera.matrixWorld); mirror.render(scene, camera, reflHide); }
      },
    };
  }

  BW.World = { build, ballTextures, BALL_SETS };
})();
