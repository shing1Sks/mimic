/*
 * Duskwater - draws Depot Nine with three.js. Static boxes are merged into one mesh per surface
 * material (PBR, Poly Haven texture sets, procedural canvas textures as the fallback), lit by a
 * low dusk sun, an HDRI environment (PMREM) and a hazy sky. The sun's shadow map is rendered once
 * (the level is static); actors use blob shadows.
 */
(function (global) {
  'use strict';
  const T = global.THREE;
  // hex colours are sRGB; the renderer outputs sRGB with ACES tone mapping (see game.js)
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  const PAL = {
    fog: 0x9a8790,
    container: [0xa9472f, 0x2f8580, 0xcf9d36, 0x355a8c],
    crate: [0xffffff, 0xd9c2a4],
  };
  // set: texture set (assets/tex/<id>), uv: metres per texture repeat ('local' = one per face)
  const SETS = {
    brick:     { id: 'brick_wall_001', uv: 2.4, rough: 1, metal: 0, fb: 'concrete' },
    plaster:   { id: 'worn_plaster_wall', uv: 3, rough: 1, metal: 0, fb: 'concrete' },
    concrete:  { id: 'concrete_floor_worn_001', uv: 3, rough: 1, metal: 0, fb: 'concrete' },
    iron:      { id: 'corrugated_iron_02', uv: 2, rough: 0.9, metal: 0.45, fb: 'ribbed' },
    container: { id: 'container_side', uv: 2.6, rough: 0.85, metal: 0.35, fb: 'ribbed' },
    rust:      { id: 'rusty_metal_02', uv: 1.6, rough: 0.9, metal: 0.55, fb: 'metal' },
    planks:    { id: 'weathered_planks', uv: 'local', rough: 1, metal: 0, fb: 'wood' },
  };
  const KIND = {
    wall:    { set: 'brick', color: 0xd8d0c8 },
    shed:    { set: 'iron', color: 0x9aa6ad },
    roof:    { set: 'iron', color: 0x6d757c },
    pillar:  { set: 'rust', color: 0x6d7780 },
    crate:   { set: 'planks', color: 0xffffff },
    rack:    { set: 'rust', color: 0x3a7da0 },
    container: { set: 'container', color: 0xffffff },
    barrier: { set: 'concrete', color: 0xe6e0d6 },
    crane:   { set: 'rust', color: 0xe0aa2e },
    bollard: { set: 'rust', color: 0x3a3a3e },
    dock:    { set: 'concrete', color: 0xcfc8bd },
    booth:   { set: 'plaster', color: 0xe8e4dc },
    rail:    { set: 'rust', color: 0xd8b13c },
    pole:    { set: 'rust', color: 0x5b6066 },
  };

  // ------------------------------------------------------------ procedural textures

  function canvasTex(size, draw, repeat = true) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    draw(g, size);
    const t = new T.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4; t.encoding = T.sRGBEncoding;
    return t;
  }
  function speckle(g, s, n, a, dark) {
    for (let i = 0; i < n; i++) {
      const v = dark ? Math.random() * 60 : 120 + Math.random() * 135;
      g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
      const r = Math.random() * 2.2;
      g.fillRect(Math.random() * s, Math.random() * s, r + 0.5, r + 0.5);
    }
  }
  function blotches(g, s, n, rgb, a, rmax) {
    for (let i = 0; i < n; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = rmax * (0.3 + Math.random());
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const TEX = {
    concrete: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#d0cdc8'; g.fillRect(0, 0, s, s);
      blotches(g, s, 18, '120,115,110', 0.18, 50); blotches(g, s, 10, '255,250,240', 0.12, 40);
      speckle(g, s, 2600, 0.35, true); speckle(g, s, 1400, 0.3, false);
      g.strokeStyle = 'rgba(70,65,60,0.45)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
      g.strokeStyle = 'rgba(90,85,80,0.3)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 20; g.lineTo(x, y); } g.stroke(); }
    }),
    ribbed: () => canvasTex(128, (g, s) => {
      for (let x = 0; x < s; x++) {
        const p = (x % 16) / 16, v = 150 + 80 * Math.sin(p * Math.PI * 2) * (p < 0.5 ? 1 : 0.6);
        g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(x, 0, 1, s);
      }
      for (let i = 0; i < 26; i++) { // grime streaks running down, wrapped so tiles do not band
        const x = Math.random() * s, y = Math.random() * s, w = 1 + Math.random() * 4, h = 20 + Math.random() * 70;
        for (const oy of [y, y - s]) {
          const gr = g.createLinearGradient(0, oy, 0, oy + h); gr.addColorStop(0, 'rgba(40,30,25,0.3)'); gr.addColorStop(1, 'rgba(40,30,25,0)');
          g.fillStyle = gr; g.fillRect(x, oy, w, h);
        }
      }
      blotches(g, s, 8, '110,60,30', 0.35, 10);
      speckle(g, s, 500, 0.25, true);
    }),
    wood: () => canvasTex(128, (g, s) => {
      g.fillStyle = '#e6d2b0'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = `rgba(120,80,40,${0.08 + Math.random() * 0.12})`; g.fillRect(0, i * 32, s, 32);
        g.strokeStyle = 'rgba(70,45,20,0.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * 32 + 1); g.lineTo(s, i * 32 + 1); g.stroke();
        g.strokeStyle = 'rgba(120,80,40,0.25)'; g.lineWidth = 1;
        for (let k = 0; k < 5; k++) { g.beginPath(); const y = i * 32 + 4 + Math.random() * 26; g.moveTo(0, y); g.bezierCurveTo(40, y + 3, 80, y - 3, s, y + 1); g.stroke(); }
      }
      g.strokeStyle = 'rgba(80,50,25,0.85)'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
      g.lineWidth = 8; g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
      speckle(g, s, 300, 0.2, true);
    }),
    metal: () => canvasTex(64, (g, s) => {
      g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
      speckle(g, s, 300, 0.25, true); blotches(g, s, 4, '90,60,40', 0.25, 10);
    }),
    asphalt: () => canvasTex(512, (g, s) => {
      g.fillStyle = '#6d6a68'; g.fillRect(0, 0, s, s);
      blotches(g, s, 30, '50,48,48', 0.25, 90); blotches(g, s, 18, '140,135,128', 0.12, 70);
      speckle(g, s, 9000, 0.35, true); speckle(g, s, 5000, 0.25, false);
      g.strokeStyle = 'rgba(30,28,28,0.5)'; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
      g.strokeStyle = 'rgba(40,38,36,0.35)'; g.lineWidth = 3; // slab joints
      for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(0, k * s / 4); g.lineTo(s, k * s / 4); g.stroke(); }
    }),
    glow: () => canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,220,160,1)'); gr.addColorStop(0.25, 'rgba(255,170,90,0.45)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, false),
  };

  // ------------------------------------------------------------ geometry builder

  class Builder {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
    quad(p, n, uvs, c) { // p: 4 points CCW from outside, c: [r,g,b] per vertex or single
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) {
        this.pos.push(p[i][0], p[i][1], p[i][2]); this.nor.push(n[0], n[1], n[2]);
        this.uv.push(uvs[i][0], uvs[i][1]);
        const cc = Array.isArray(c[0]) ? c[i] : c; this.col.push(cc[0], cc[1], cc[2]);
      }
    }
    tri(p, n, uvs, c) {
      for (let i = 0; i < 3; i++) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uvs[i]); this.col.push(...c); }
    }
    box(b, rgb, uvScale, opts = {}) {
      const { x0, y0, z0, x1, y1, z1 } = b;
      const faces = [
        { n: [1, 0, 0], p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], r: [0, 0, -1], u: [0, 1, 0] },
        { n: [-1, 0, 0], p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], r: [0, 0, 1], u: [0, 1, 0] },
        { n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], r: [1, 0, 0], u: [0, 1, 0] },
        { n: [0, 0, -1], p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], r: [-1, 0, 0], u: [0, 1, 0] },
        { n: [0, 1, 0], p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], r: [1, 0, 0], u: [0, 0, -1] },
        { n: [0, -1, 0], p: [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], r: [-1, 0, 0], u: [0, 0, -1] },
      ];
      const ao = opts.ao !== false && y0 < 0.05;
      faces.forEach((f, fi) => {
        if (fi === 5 && y0 <= 0.01) return;
        let uvs;
        if (uvScale === 'local') uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        else uvs = f.p.map(q => [(q[0] * f.r[0] + q[1] * f.r[1] + q[2] * f.r[2]) * uvScale, (q[0] * f.u[0] + q[1] * f.u[1] + q[2] * f.u[2]) * uvScale]);
        const cols = f.p.map(q => {
          const k = (ao && q[1] < y0 + 0.01 && fi < 4) ? 0.55 : 1;
          return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
        });
        this.quad(f.p, f.n, uvs, cols);
      });
    }
    ramp(r, rgb, s) {
      const { x0, x1, z0, z1, h0, h1 } = r;
      // top surface (axis x)
      const k = Math.hypot(h1 - h0, x1 - x0);
      const n = [-(h1 - h0) / k, (x1 - x0) / k, 0];
      this.quad([[x0, h0, z1], [x1, h1, z1], [x1, h1, z0], [x0, h0, z0]], n, [[0, z1 * s], [k * s, z1 * s], [k * s, z0 * s], [0, z0 * s]], rgb);
      const side = rgb.map(v => v * 0.8);
      this.tri([[x0, 0, z1], [x1, 0, z1], h1 > h0 ? [x1, h1, z1] : [x0, h0, z1]], [0, 0, 1], [[x0 * s, 0], [x1 * s, 0], [x1 * s, Math.max(h0, h1) * s]], side);
      this.tri([[x1, 0, z0], [x0, 0, z0], h1 > h0 ? [x1, h1, z0] : [x0, h0, z0]], [0, 0, -1], [[x1 * s, 0], [x0 * s, 0], [x1 * s, Math.max(h0, h1) * s]], side);
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
      g.computeBoundingSphere();
      return g;
    }
  }
  const rgbOf = hex => { const c = new T.Color(hex); return [c.r, c.g, c.b]; };
  const jitter = (rgb, a) => { const k = 1 + (Math.random() - 0.5) * a; return rgb.map(v => Math.min(1, v * k)); };

  /** Merge transformed BoxGeometries (decor) into one geometry with a flat color each. */
  function mergeBoxes(list) {
    const b = new Builder();
    const m = new T.Matrix4(), v = new T.Vector3(), nm = new T.Matrix3();
    for (const it of list) {
      const geo = new T.BoxGeometry(it.w, it.h, it.d).toNonIndexed();
      m.compose(new T.Vector3(it.x, it.y, it.z), new T.Quaternion().setFromEuler(new T.Euler(it.rx || 0, it.ry || 0, it.rz || 0)), new T.Vector3(1, 1, 1));
      nm.getNormalMatrix(m);
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
      const rgb = rgbOf(it.color);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m); b.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z);
        b.uv.push(U.getX(i), U.getY(i)); b.col.push(rgb[0], rgb[1], rgb[2]);
      }
      geo.dispose();
    }
    return b.geometry();
  }

  // ------------------------------------------------------------ sky

  function makeSky(sunDir) {
    const mat = new T.ShaderMaterial({
      uniforms: { sunDir: { value: sunDir.clone().normalize() }, time: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 sunDir; uniform float time; varying vec3 vDir;',
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
        'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }',
        'float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  float sd = max(dot(d, normalize(sunDir)), 0.0);',
        '  vec3 zen = vec3(0.13,0.15,0.30), mid = vec3(0.42,0.36,0.55), hor = vec3(0.56,0.48,0.54), warm = vec3(1.0,0.58,0.32);',
        '  vec3 horC = mix(hor, warm, pow(sd, 3.0));',
        '  vec3 col = mix(horC, mid, smoothstep(0.0, 0.18, h));',
        '  col = mix(col, zen, smoothstep(0.15, 0.7, h));',
        '  col += vec3(1.0,0.55,0.25) * pow(sd, 10.0) * 0.55 + vec3(1.0,0.85,0.6) * pow(sd, 900.0) * 3.0;',
        '  float az = atan(d.z, d.x);',
        '  float band = smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.18, 0.42, h));',
        '  float c = fbm(vec2(az * 5.0 + time * 0.004, h * 18.0)) ;',
        '  c = smoothstep(0.48, 0.8, c) * band;',
        '  vec3 cloud = mix(vec3(0.30,0.24,0.36), vec3(1.0,0.62,0.42), pow(sd, 2.5));',
        '  col = mix(col, cloud, c * 0.85);',
        '  col = mix(col, vec3(0.56,0.48,0.54), smoothstep(0.0, -0.06, h));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false,
    });
    const m = new T.Mesh(new T.SphereGeometry(600, 32, 16), mat);
    // drawn after the opaque world: depth-tested, so only the sky that shows gets shaded
    m.renderOrder = 1000; m.frustumCulled = false;
    return m;
  }

  // ------------------------------------------------------------ ground overlay (paint, stains)

  function groundOverlay(map) {
    const W = 1024, H = 704, sx = W / 92, sz = H / 62.5; // x -46..46, z -31..31.5
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = x => (x + 46) * sx, Z = z => (z + 31) * sz;
    blotches(g, W, 40, '20,18,18', 0.22, 40);
    g.lineCap = 'butt';
    const line = (x0, z0, x1, z1, col, w, dash) => { g.strokeStyle = col; g.lineWidth = w * sx; g.setLineDash(dash ? dash.map(v => v * sx) : []); g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
    const Y = 'rgba(232,184,58,0.75)', Wt = 'rgba(235,232,220,0.55)';
    line(-44, -28.2, 44, -28.2, Y, 0.18, [2.5, 1.5]);       // quay edge safety line
    line(-44, -10.2, -24, -10.2, Wt, 0.12); line(24, -10.2, 44, -10.2, Wt, 0.12);
    line(-44, 10.6, -27.5, 10.6, Wt, 0.12); line(27.5, 10.6, 44, 10.6, Wt, 0.12);
    line(-11, 9.5, 11, 9.5, Y, 0.14, [1.2, 1]); line(-10, 19.4, 10, 19.4, Y, 0.3, [0.8, 0.8]);
    for (let x = -36; x <= 36; x += 9) if (Math.abs(x) > 12) line(x, 13, x, 18, Wt, 0.1); // parking bays
    // spawn zones, hatched in team colours
    [[-46, 'rgba(70,170,190,0.07)'], [38, 'rgba(225,140,60,0.07)']].forEach(([x0, col]) => {
      g.save(); g.beginPath(); g.rect(X(x0), Z(-12.5), 8 * sx, 25 * sz); g.clip();
      g.strokeStyle = col; g.lineWidth = 0.22 * sx; g.setLineDash([]);
      for (let k = -40; k < 40; k += 2.2) { g.beginPath(); g.moveTo(X(x0 + k), Z(-12.5)); g.lineTo(X(x0 + k + 25), Z(12.5)); g.stroke(); }
      g.restore();
      g.strokeStyle = col.replace('0.07', '0.4'); g.lineWidth = 0.2 * sx; g.strokeRect(X(x0), Z(-12.5), 8 * sx, 25 * sz);
    });
    // stencilled depot number in the yard
    g.save(); g.translate(X(0), Z(16.8)); g.fillStyle = 'rgba(235,232,220,0.42)';
    g.font = `bold ${2.2 * sx}px "Arial Black", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('D9', 0, 0); g.restore();
    g.save(); g.translate(X(0), Z(-24)); g.fillStyle = 'rgba(232,184,58,0.5)'; g.font = `bold ${1.4 * sx}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.fillText('BERTH 4', 0, 0); g.restore();
    const t = new T.CanvasTexture(c); t.anisotropy = 8; t.encoding = T.sRGBEncoding;
    const mesh = new T.Mesh(new T.PlaneGeometry(92, 62.5), new T.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 0.01, 0.25);
    mesh.receiveShadow = true;
    return mesh;
  }

  // ------------------------------------------------------------ materials

  /** One PBR material per surface set; procedural canvas texture when the set did not load. */
  function makeMaterials(assets, env) {
    const mats = {}, fallback = {};
    Object.keys(SETS).forEach(k => {
      const set = SETS[k], tex = assets && assets.tex && assets.tex[set.id];
      const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: set.rough, metalness: set.metal, envMapIntensity: 0.75 });
      if (tex) {
        m.map = tex.map; m.normalMap = tex.normalMap; m.roughnessMap = tex.roughnessMap;
        m.normalScale.set(1, 1);
      } else {
        if (!fallback[set.fb]) fallback[set.fb] = TEX[set.fb]();
        m.map = fallback[set.fb]; m.roughness = 0.9; m.metalness = 0;
      }
      if (env) m.envMap = env;
      mats[k] = m;
    });
    return mats;
  }

  /** HDRI -> prefiltered (PMREM) environment map for image-based light and reflections. */
  function makeEnvironment(renderer, hdr) {
    if (!hdr || !renderer) return null;
    try {
      hdr.mapping = T.EquirectangularReflectionMapping;
      const pm = new T.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(hdr);
      pm.dispose();
      return { env: rt.texture, hdr };
    } catch (e) { console.warn('Duskwater: environment failed', e); return null; }
  }

  /** Orthographic shadow box fitted to the playable area as seen from the sun. */
  function fitShadow(sun, sunDir) {
    const view = new T.Matrix4().lookAt(sunDir, new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0)).invert();
    const v = new T.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [-48, 48]) for (const y of [0, 18]) for (const z of [-34, 33]) {
      v.set(x, y, z).applyMatrix4(view);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
    const D = 150, sc = sun.shadow.camera;
    sun.position.copy(sunDir).multiplyScalar(D); sun.target.position.set(0, 0, 0);
    sc.left = x0 - 1; sc.right = x1 + 1; sc.bottom = y0 - 1; sc.top = y1 + 1; sc.near = D - z1 - 5; sc.far = D - z0 + 5;
    sc.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ main

  /** assets: from ArenaAssets.load (may be null / partial). renderer: needed for the HDRI. */
  function buildWorld(scene, map, assets, renderer) {
    const E = makeEnvironment(renderer, assets && assets.hdr);
    const env = E ? E.env : null;
    scene.background = new T.Color(PAL.fog);
    scene.fog = new T.FogExp2(PAL.fog, 0.0062);
    if (env) scene.environment = env;
    const sunDir = new T.Vector3(-0.62, 0.34, -0.72).normalize();
    const sky = makeSky(sunDir); scene.add(sky);

    // lights: low warm sun over the water, cool sky fill (the HDRI adds image-based light)
    const hemi = new T.HemisphereLight(0x9aa8d8, 0x5a4238, env ? 0.35 : 0.8); scene.add(hemi);
    const sun = new T.DirectionalLight(0xffb27a, env ? 2.6 : 1.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
    fitShadow(sun, sunDir);
    scene.add(sun); scene.add(sun.target);
    const fill = new T.DirectionalLight(0x6a78b8, env ? 0.25 : 0.3); fill.position.set(60, 40, 50); scene.add(fill);

    const mats = makeMaterials(assets, env);
    const builders = {};
    Object.keys(SETS).forEach(k => { builders[k] = new Builder(); });
    const uvOf = set => SETS[set].uv === 'local' ? 'local' : 1 / SETS[set].uv;

    for (const s of map.solids) {
      if (s.kind === 'invisible') continue;
      const k = KIND[s.kind] || KIND.wall;
      let rgb = rgbOf(k.color);
      if (s.kind === 'container') rgb = rgbOf(PAL.container[s.tint % 4]);
      if (s.kind === 'crate') rgb = rgbOf(PAL.crate[s.tint % 2]);
      builders[k.set].box(s, jitter(rgb, 0.1), uvOf(k.set));
    }
    map.ramps.forEach(r => builders.concrete.ramp(r, rgbOf(KIND.dock.color), 1 / 3));

    const group = new T.Group();
    Object.keys(builders).forEach(k => {
      if (!builders[k].pos.length) return;
      const mesh = new T.Mesh(builders[k].geometry(), mats[k]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    });

    // decor without collision: container door bars, crane bracing, dock stripes, lamp heads
    const deco = [];
    for (const s of map.solids) {
      if (s.kind === 'container') {
        const alongX = (s.x1 - s.x0) > (s.z1 - s.z0);
        const ends = alongX ? [[s.x0 - 0.03, (s.z0 + s.z1) / 2], [s.x1 + 0.03, (s.z0 + s.z1) / 2]] : [[(s.x0 + s.x1) / 2, s.z0 - 0.03], [(s.x0 + s.x1) / 2, s.z1 + 0.03]];
        ends.forEach(([x, z]) => [-0.45, 0.45].forEach(o => deco.push({ x: alongX ? x : x + o, z: alongX ? z + o : z, y: s.y0 + 1.3, w: alongX ? 0.06 : 0.07, d: alongX ? 0.07 : 0.06, h: 2.3, color: 0x2a2a2a })));
        // corner castings
        for (const cx of [s.x0 + 0.1, s.x1 - 0.1]) for (const cz of [s.z0 + 0.1, s.z1 - 0.1]) for (const cy of [s.y0 + 0.1, s.y1 - 0.1])
          deco.push({ x: cx, y: cy, z: cz, w: 0.24, h: 0.22, d: 0.24, color: 0x3a3634 });
      }
    }
    for (const x of [-3, 3]) for (let k = 0; k < 3; k++) { // crane cross bracing between legs
      deco.push({ x, z: -19, y: 3 + k * 4.4, w: 0.25, d: 15.5, h: 0.25, rx: 0.52 * (k % 2 ? 1 : -1), color: 0xc99626 });
    }
    deco.push({ x: 0, z: -11.5, y: 5.5, w: 6, d: 0.3, h: 0.3, color: 0xc99626 });
    deco.push({ x: 0, z: -26.5, y: 5.5, w: 6, d: 0.3, h: 0.3, color: 0xc99626 });
    for (let x = -9.5; x <= 9.5; x += 1) deco.push({ x, z: 20.02, y: 2.1, w: 0.5, d: 0.04, h: 0.18, rz: 0, color: (Math.round(x + 9.5) % 2) ? 0x1d1d1d : 0xe2b23a }); // dock edge hazard stripes
    map.lamps.forEach(l => {
      deco.push({ x: l.x + 0.5, z: l.z, y: l.y, w: 1.2, d: 0.18, h: 0.12, color: 0x3b4046 });
    });
    // quay edge face and fenders
    deco.push({ x: 0, z: -30.95, y: -1.1, w: 120, d: 0.5, h: 2.2, color: 0x77716a });
    for (let x = -40; x <= 40; x += 8) deco.push({ x, z: -31.25, y: -0.5, w: 1.6, d: 0.35, h: 0.9, color: 0x1c1c1e });
    const decoMesh = new T.Mesh(mergeBoxes(deco), mats.rust);
    decoMesh.castShadow = true; decoMesh.receiveShadow = true;
    group.add(decoMesh);

    // ground: worn asphalt, slab joints and paint from the overlay
    const ground = new T.Mesh(new T.PlaneGeometry(140, 120), (() => {
      const set = assets && assets.tex && assets.tex.asphalt_02;
      const m = new T.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.6, color: 0xd8d4d0 });
      if (set) {
        const rep = t => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(140 / 4.5, 120 / 4.5); return c; };
        m.map = rep(set.map); m.normalMap = rep(set.normalMap); m.roughnessMap = rep(set.roughnessMap);
      } else { const at = TEX.asphalt(); at.repeat.set(140 / 9, 120 / 9); m.map = at; m.color.set(0xc7c2bd); }
      if (env) m.envMap = env;
      return m;
    })());
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 29); ground.receiveShadow = true;
    group.add(ground);
    group.add(groundOverlay(map));

    // lamp heads (emissive) and glow sprites
    const lampMat = new T.MeshBasicMaterial({ color: 0xffd9a0 });
    const glowMat = new T.SpriteMaterial({ map: TEX.glow(), color: 0xffb070, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    const poolTex = TEX.glow();
    const poolMat = new T.MeshBasicMaterial({ map: poolTex, color: 0x6a3c1c, transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    // every lamp head and strip is one mesh, every light pool another: two draw calls, not 28
    const heads = [], pools = [];
    const pool = (x, z, size) => { const g = new T.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2); g.translate(x, 0.03, z); pools.push(g); };
    map.lamps.forEach(l => {
      heads.push({ x: l.x + 0.9, y: l.y - 0.08, z: l.z, w: 0.5, h: 0.08, d: 0.3, color: 0xffffff });
      const s = new T.Sprite(glowMat); s.position.set(l.x + 0.9, l.y - 0.2, l.z); s.scale.set(2.2, 2.2, 1); group.add(s);
      pool(l.x + 0.9, l.z, 9);
    });
    // warehouse strip lights (two real lights fill the shed; the rest are emissive + pools)
    for (const x of [-5.5, 5.5]) { const l = new T.PointLight(0xffd2a0, 1.3, 13, 2); l.position.set(x, 5.2, 0); group.add(l); }
    for (const x of [-6, 0, 6]) for (const z of [-4.5, 4.5]) {
      heads.push({ x, y: 5.6, z, w: 2.2, h: 0.06, d: 0.18, color: 0xffffff });
      pool(x, z, 6);
    }
    group.add(new T.Mesh(mergeBoxes(heads), lampMat));
    const poolGeo = new T.BufferGeometry(), pp = [], pu = [], pi = [];
    pools.forEach(g => {
      const v0 = pp.length / 3;
      pp.push(...g.attributes.position.array); pu.push(...g.attributes.uv.array);
      for (let k = 0; k < g.index.count; k++) pi.push(g.index.getX(k) + v0);
      g.dispose();
    });
    poolGeo.setAttribute('position', new T.Float32BufferAttribute(pp, 3));
    poolGeo.setAttribute('uv', new T.Float32BufferAttribute(pu, 2));
    poolGeo.setIndex(pi); poolGeo.computeBoundingSphere();
    group.add(new T.Mesh(poolGeo, poolMat));

    // water: rolling swell, reflects the sky through the environment map
    const wg = new T.PlaneGeometry(700, 320, 90, 40); wg.rotateX(-Math.PI / 2); wg.translate(0, -0.9, -31 - 160);
    // the swell runs in the vertex shader (height and its exact normal), not on the CPU
    const waterTime = { value: 0 };
    const waterMat = new T.MeshStandardMaterial({ color: 0x1b2f3a, roughness: env ? 0.16 : 0.4, metalness: env ? 0.1 : 0, envMap: env || null, envMapIntensity: 1.1 });
    waterMat.onBeforeCompile = sh => {
      sh.uniforms.wTime = waterTime;
      sh.vertexShader = 'uniform float wTime;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', [
          'float wa = position.x * 0.12 + wTime * 0.9, wb = position.z * 0.17 - wTime * 0.7 + position.x * 0.05, wc = position.x * 0.43 + position.z * 0.31 + wTime * 1.7;',
          'float wdx = 0.0192 * cos(wa) + 0.007 * cos(wb) + 0.0215 * cos(wc), wdz = 0.0238 * cos(wb) + 0.0155 * cos(wc);',
          'vec3 objectNormal = normalize(vec3(-wdx, 1.0, -wdz));',
          '#ifdef USE_TANGENT', 'vec3 objectTangent = vec3(tangent.xyz);', '#endif'].join('\n'))
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += sin(wa) * 0.16 + sin(wb) * 0.14 + sin(wc) * 0.05;');
    };
    const water = new T.Mesh(wg, waterMat);
    water.receiveShadow = false;
    group.add(water);

    // scenery: moored freighter, far shore skyline, sheds beyond the walls
    const far = [];
    far.push({ x: -8, z: -48, y: 2, w: 78, d: 13, h: 9, color: 0x3a2a2c });     // hull
    far.push({ x: -8, z: -48, y: 6.7, w: 78.4, d: 13.4, h: 0.6, color: 0xb84a30 });
    far.push({ x: -36, z: -48, y: 11, w: 12, d: 11, h: 9, color: 0xd9d4c8 });   // bridge
    far.push({ x: -36, z: -48, y: 16, w: 13, d: 12, h: 0.6, color: 0x2a2a2a });
    far.push({ x: -32, z: -48, y: 18, w: 2, d: 2, h: 5, color: 0xb84a30 });
    for (let i = 0; i < 5; i++) far.push({ x: -20 + i * 11, z: -48, y: 8.6, w: 9.8, d: 11, h: 4.6, color: [0xa9472f, 0x2f8580, 0xcf9d36, 0x355a8c, 0x6b6b6b][i] });
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const x = -320 + i * 14 + rnd() * 6, h = 8 + rnd() * rnd() * 70, w = 8 + rnd() * 12;
      far.push({ x, z: -230 - rnd() * 40, y: h / 2, w, d: 10, h, color: 0x3d3450 });
    }
    for (const x of [-120, -60, 40, 110]) { // distant gantry cranes
      far.push({ x: x - 6, z: -150, y: 20, w: 1.6, d: 1.6, h: 40, color: 0x4a3b48 });
      far.push({ x: x + 6, z: -150, y: 20, w: 1.6, d: 1.6, h: 40, color: 0x4a3b48 });
      far.push({ x, z: -158, y: 40, w: 2, d: 50, h: 2.4, color: 0x4a3b48 });
    }
    [[-70, 0, 20, 30, 14], [70, 0, 20, 30, 16], [-60, 30, 30, 18, 11], [60, -26, 26, 20, 12], [0, 52, 70, 20, 13], [-70, -24, 22, 18, 9]].forEach(([x, z, w, d, h]) =>
      far.push({ x, z, y: h / 2, w, d, h, color: 0x6c6670 }));
    const farMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.2, envMapIntensity: 0.5 });
    if (assets && assets.tex && assets.tex.rusty_metal_02) farMat.map = assets.tex.corrugated_iron_02 ? assets.tex.corrugated_iron_02.map : assets.tex.rusty_metal_02.map;
    if (env) farMat.envMap = env;
    const farMesh = new T.Mesh(mergeBoxes(far), farMat);
    farMesh.receiveShadow = true;
    group.add(farMesh);
    // ship and skyline windows: a few warm dots
    const winGeo = new T.BufferGeometry(), wp = [];
    for (let i = 0; i < 260; i++) wp.push(-320 + rnd() * 640, 3 + rnd() * 40, -226 - rnd() * 30);
    winGeo.setAttribute('position', new T.Float32BufferAttribute(wp, 3));
    group.add(new T.Points(winGeo, new T.PointsMaterial({ color: 0xffc77a, size: 1.6, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 })));

    scene.add(group);

    const W = {
      group, sun, sky, water, env, mats,
      /**
       * After a WebGL context loss the prefiltered environment (a render target) is gone: rebuild
       * it and swap it into every material that used the old one, in this scene and `others`.
       */
      refreshEnv(r, others = []) {
        if (!E) return;
        const next = makeEnvironment(r, E.hdr);
        if (!next) return;
        const old = W.env;
        [scene].concat(others).forEach(sc => {
          if (sc.environment === old) sc.environment = next.env;
          sc.traverse(o => { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.envMap === old) { m.envMap = next.env; m.needsUpdate = true; } }); });
        });
        W.env = next.env;
      },
      update(t, camPos) {
        sky.position.copy(camPos);
        sky.material.uniforms.time.value = t;
        waterTime.value = t;
      },
    };
    return W;
  }

  global.ArenaWorld = { buildWorld, PAL, canvasTex, mergeBoxes, TEX, SETS, KIND };
})(window);
