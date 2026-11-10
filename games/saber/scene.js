/*
 * Cadence Cut - 3D world: corridor, sky, floor grid, gate rings, equalizer pylons, blade, trail,
 * blocks, sliced halves, particles and flashes. Pure three.js r149, no addons.
 */
(function (global) {
  'use strict';
  const T = global.THREE;

  const LAYOUT = {
    HILT: new T.Vector3(0.29, 0.67, 1.14), // rest pose only; in play the hilt rides the arm model
    ARM_SCALE: 1.6,     // arm-model metres -> scene metres around the camera (a flat screen compresses depth)
    BLADE_LEN: 3.5,
    BLADE_CUT_FROM: 0.35,
    LANE_X: [-0.84, -0.28, 0.28, 0.84],
    ROW_Y: [0.72, 1.28, 1.84],
    HIT_Z: -1.75,
    SPAWN_DIST: 34,
    BLOCK: 0.44,
    PITCH_OFF: 0.2,     // blade tilts up from the phone so a level phone aims at the middle row
  };

  const COL = {
    blade: new T.Color('#6ff5d2'),
    bladeHot: new T.Color('#d8fff4'),
    block: '#ff6a3d',
    blockGlyph: '#fff1dc',
    violet: new T.Color('#7a4dff'),
    gold: new T.Color('#ffc46b'),
    coral: new T.Color('#ff6a3d'),
  };

  // Each song gets its own world: sky, grid, rails, gate shape and pylon colours.
  // sides/rot: gate polygon; twist: gates turn progressively down the corridor.
  const THEMES = {
    lantern: { top: '#07040c', mid: '#1f0c1a', hor: '#7a2f1c', halo: '#ff9a4a', line: '#b85a36', rail: '#ffd08a', fog: '#130812', py: ['#ff9a4a', '#ffd9a0'], sides: 6, rot: Math.PI / 6, twist: 0, dust: '#ffc89a' },
    rush: { top: '#060410', mid: '#1a1030', hor: '#74501a', halo: '#ffd166', line: '#c9963a', rail: '#fff1b8', fog: '#100a1a', py: ['#ffd166', '#ff8a3d'], sides: 4, rot: 0, twist: 0, dust: '#ffe7a8' },
    copper: { top: '#040608', mid: '#0e1a1c', hor: '#5e2a18', halo: '#ff7a59', line: '#2a9e8e', rail: '#ff9c7a', fog: '#0a1012', py: ['#ff7a59', '#3fe0c5'], sides: 24, rot: 0, twist: 0, dust: '#ffb39a' },
    ion: { top: '#01060a', mid: '#04161c', hor: '#0f4c48', halo: '#7cf7d4', line: '#1fae9f', rail: '#e0fff6', fog: '#020d10', py: ['#7cf7d4', '#4aa8ff'], sides: 3, rot: Math.PI / 2, twist: 0.16, dust: '#a8fff0' },
    evasion: { top: '#02040c', mid: '#071530', hor: '#143c64', halo: '#5cc8ff', line: '#3768e0', rail: '#bfeaff', fog: '#040a18', py: ['#5cc8ff', '#9a7dff'], sides: 8, rot: Math.PI / 8, twist: 0, dust: '#bfe6ff' },
    thrust: { top: '#07020a', mid: '#1f0620', hor: '#6e1038', halo: '#ff5c8a', line: '#d4336c', rail: '#ffc2d6', fog: '#12040e', py: ['#ff5c8a', '#ff9a3d'], sides: 4, rot: Math.PI / 4, twist: 0.07, dust: '#ffb3c8' },
    race: { top: '#020804', mid: '#0a1a10', hor: '#305c18', halo: '#9dff6a', line: '#45b456', rail: '#e8ffd0', fog: '#050f08', py: ['#9dff6a', '#3fe0c5'], sides: 6, rot: 0, twist: 0.05, dust: '#d4ffb8' },
    waves: { top: '#030108', mid: '#120626', hor: '#3c1462', halo: '#b07cff', line: '#6b45e6', rail: '#d9c2ff', fog: '#08040f', py: ['#b07cff', '#ff4fa0'], sides: 32, rot: 0, twist: 0, dust: '#cdb8ff' },
  };
  const DEFAULT_THEME = { top: '#050310', mid: '#1a0829', hor: '#5c1a38', halo: '#7340ff', line: '#6b38f2', rail: '#73f2d9', fog: '#0c0616', py: ['#7a4dff', '#ff6a3d'], sides: 8, rot: Math.PI / 8, twist: 0, dust: '#b9a6ff' };

  function canvasTex(size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new T.CanvasTexture(c); t.anisotropy = 4;
    if ('colorSpace' in t) t.colorSpace = 'srgb'; else t.encoding = T.sRGBEncoding;
    return t;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function faceBase(g, s) {
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.7);
    grd.addColorStop(0, '#2b1630'); grd.addColorStop(1, '#0d0712');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.save(); g.shadowColor = COL.block; g.shadowBlur = 22;
    g.strokeStyle = COL.block; g.lineWidth = 9; roundRect(g, 14, 14, s - 28, s - 28, 26); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,214,170,0.55)'; g.lineWidth = 2; roundRect(g, 14, 14, s - 28, s - 28, 26); g.stroke();
  }
  function glowTex(inner, outer) {
    return canvasTex(128, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, inner); grd.addColorStop(0.25, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });
  }

  function glowMaterial(color, power, intensity) {
    return new T.ShaderMaterial({
      uniforms: { uColor: { value: new T.Color(color) }, uPow: { value: power }, uInt: { value: intensity } },
      vertexShader: 'varying vec3 vN; varying vec3 vV;\n' +
        'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uPow; uniform float uInt; varying vec3 vN; varying vec3 vV;\n' +
        'void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), uPow); gl_FragColor = vec4(uColor * f * uInt, 1.0); }',
      blending: T.AdditiveBlending, transparent: true, depthWrite: false,
    });
  }

  function createWorld(canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.25));
    renderer.setSize(global.innerWidth, global.innerHeight, false);
    renderer.localClippingEnabled = true;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = 'srgb'; else renderer.outputEncoding = T.sRGBEncoding;

    const scene = new T.Scene();
    scene.fog = new T.Fog(0x0c0616, 14, 95);
    const camera = new T.PerspectiveCamera(68, global.innerWidth / global.innerHeight, 0.05, 400);
    const camBase = new T.Vector3(0, 1.45, 1.75);
    camera.position.copy(camBase);
    camera.lookAt(0, 1.2, -6);
    const camQuat = camera.quaternion.clone();

    // ---------- sky ----------
    const C = h => new T.Color(h);
    const skyMat = new T.ShaderMaterial({
      uniforms: {
        uPulse: { value: 0 }, uTime: { value: 0 }, uAccent: { value: C('#ff6a3d') }, uHeat: { value: 0 }, uBreak: { value: 0 },
        uTop: { value: C(DEFAULT_THEME.top) }, uMid: { value: C(DEFAULT_THEME.mid) }, uHor: { value: C(DEFAULT_THEME.hor) }, uHalo: { value: C(DEFAULT_THEME.halo) },
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform float uPulse; uniform float uTime; uniform vec3 uAccent; uniform float uHeat; uniform float uBreak;',
        'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uHalo; varying vec3 vD;',
        'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
        'void main(){',
        '  vec3 d = normalize(vD); float y = d.y;',
        '  vec3 c = mix(uMid, uTop, smoothstep(0.02, 0.55, y));',
        '  c = mix(c, uHor * (1.0 + 0.35 * uHeat), exp(-abs(y - 0.01) * 18.0) * 0.9);',
        '  c += uAccent * exp(-abs(y - 0.005) * 60.0) * (0.35 + 0.25 * uPulse + 0.2 * uHeat);',
        // giant halo ahead: breathes on the kick, a second ring opens as the combo heats up
        '  vec3 ah = normalize(vec3(0.0, 0.16, -1.0)); float a = acos(clamp(dot(d, ah), -1.0, 1.0));',
        '  float r0 = 0.30 + 0.012 * uPulse;',
        '  float ring = exp(-pow((a - r0) * 38.0, 2.0)) + 0.35 * exp(-pow((a - r0 - 0.06) * 70.0, 2.0));',
        '  ring += uHeat * 0.3 * exp(-pow((a - 0.44 - 0.02 * uPulse) * 90.0, 2.0));',
        // section change: a ring of light bursts out of the halo
        '  ring += uBreak * 0.9 * exp(-pow((a - 0.30 - (1.0 - uBreak) * 0.9) * 30.0, 2.0));',
        '  c += mix(uHalo, uAccent, 0.3) * ring * (0.55 + 0.6 * uPulse) * smoothstep(-0.02, 0.04, y);',
        '  c += uHalo * 0.5 * exp(-a * 3.0) * (0.25 + 0.15 * uPulse);',
        // stars
        '  vec2 g = vec2(atan(d.x, -d.z), y) * 180.0; vec2 id = floor(g); float s = h(id);',
        '  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);',
        '  c += vec3(0.9,0.85,1.0) * step(0.9965, s) * smoothstep(0.08, 0.4, y) * tw * (1.0 - smoothstep(0.0, 0.42, length(fract(g) - 0.5)));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false,
    });
    const sky = new T.Mesh(new T.SphereGeometry(300, 40, 20), skyMat);
    scene.add(sky);

    // ---------- floor ----------
    const floorMat = new T.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 }, uPulse: { value: 0 }, uAccent: { value: C('#ff6a3d') }, uRip: { value: 1 }, uHit: { value: 0 }, uHeat: { value: 0 },
        uLine: { value: C(DEFAULT_THEME.line) }, uRail: { value: C(DEFAULT_THEME.rail) }, uFog: { value: C(DEFAULT_THEME.fog) }, uHitZ: { value: LAYOUT.HIT_Z },
      },
      extensions: { derivatives: true },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: [
        'uniform float uScroll; uniform float uPulse; uniform vec3 uAccent; uniform float uRip; uniform float uHit; uniform float uHeat;',
        'uniform vec3 uLine; uniform vec3 uRail; uniform vec3 uFog; uniform float uHitZ; varying vec3 vW;',
        'float grid(vec2 p){ vec2 w = fwidth(p); vec2 g = abs(fract(p - 0.5) - 0.5) / w; return (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(0.12, 0.5, max(w.x, w.y))); }',
        'void main(){',
        '  float dist = length(vW.xz - vec2(0.0, 1.5));',
        '  float fade = exp(-dist * 0.028);',
        '  vec2 p = vec2(vW.x / 1.2, (vW.z + uScroll) / 2.4);',
        '  float gl = grid(p);',
        '  float ax = abs(vW.x);',
        '  vec3 base = uFog * 0.55;',
        '  float run = 1.0 - smoothstep(1.25, 1.4, ax);',
        '  base += uFog * 0.6 * run;',
        '  vec3 lineC = mix(uLine, uAccent, 0.2) * (0.35 + 0.6 * uPulse + 0.25 * uHeat);',
        '  vec3 c = base + lineC * gl * (1.0 - run * 0.7);',
        '  float rail = exp(-pow((ax - 1.36) * 60.0, 2.0));',
        '  c += uRail * rail * (0.55 + 0.5 * uPulse + 0.3 * uHeat);',
        '  float centre = exp(-pow(ax * 40.0, 2.0)) * 0.25;',
        '  c += uAccent * centre;',
        // kick ripple: a ring of light rolls out from under the player on each strong beat
        '  float rd = length(vec2(vW.x * 0.8, vW.z - uHitZ));',
        '  float rip = exp(-pow((rd - uRip * 26.0) * 0.9, 2.0)) * (1.0 - uRip) * (1.0 - uRip);',
        '  c += mix(uLine, uRail, 0.5) * rip * 0.55;',
        // hit line: where blocks are cut; flares on each cut
        '  float hz = exp(-pow((vW.z - uHitZ) * 7.0, 2.0)) * run;',
        '  c += uRail * hz * (0.07 + 0.55 * uHit);',
        '  gl_FragColor = vec4(mix(uFog, c, fade), 1.0);',
        '}'].join('\n'),
    });
    const floor = new T.Mesh(new T.PlaneGeometry(80, 260, 1, 1), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -110);
    scene.add(floor);

    // ---------- gate rings ----------
    const rings = [];
    const ringGeos = {};
    const ringGeoFor = sides => ringGeos[sides] || (ringGeos[sides] = new T.TorusGeometry(4.3, 0.05, 6, sides));
    const RING_N = 14, RING_GAP = 9;
    const ringCol = C(DEFAULT_THEME.halo);
    for (let i = 0; i < RING_N; i++) {
      const m = new T.MeshBasicMaterial({ color: ringCol.clone(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: true });
      const r = new T.Mesh(ringGeoFor(8), m);
      r.rotation.z = Math.PI / 8;
      r.position.set(0, 2.1, -6 - i * RING_GAP);
      r.userData.base = r.position.z;
      scene.add(r); rings.push(r);
    }

    // ---------- equalizer pylons ----------
    // thin light bars, dim at the foot and white-hot at the cap
    const PY_N = 30, PY_GAP = 4.2;
    const pyGeo = new T.BoxGeometry(0.07, 1, 0.07, 1, 4, 1); pyGeo.translate(0, 0.5, 0);
    {
      const pos = pyGeo.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), v = 0.1 + 0.8 * Math.pow(y, 1.6) + (y > 0.99 ? 0.35 : 0); cols.set([v, v, v], i * 3); }
      pyGeo.setAttribute('color', new T.BufferAttribute(cols, 3));
    }
    const pyMat = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    const pylons = new T.InstancedMesh(pyGeo, pyMat, PY_N * 2);
    const pyCol = new T.Color();
    const pyA = C(DEFAULT_THEME.py[0]), pyB = C(DEFAULT_THEME.py[1]);
    function colourPylons() {
      for (let i = 0; i < PY_N * 2; i++) {
        const k = (i % PY_N) / PY_N;
        pyCol.copy(pyA).lerp(pyB, (Math.sin(k * 9.0) * 0.5 + 0.5) * 0.8).multiplyScalar(0.9);
        pylons.setColorAt(i, pyCol);
      }
      pylons.instanceColor.needsUpdate = true;
    }
    colourPylons();
    scene.add(pylons);
    const pyDummy = new T.Object3D();

    // ---------- laser fans (high quality) ----------
    // long beams from towers beside the corridor that sweep on the music; brightest in the drops
    const LASER_N = 8;
    const laserGeo = new T.BoxGeometry(0.16, 0.16, 70, 1, 1, 6); laserGeo.translate(0, 0, -35);
    {
      const pos = laserGeo.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const v = Math.pow(1 - Math.min(1, -pos.getZ(i) / 70), 1.5); cols.set([v, v, v], i * 3); }
      laserGeo.setAttribute('color', new T.BufferAttribute(cols, 3));
    }
    const lasers = [];
    for (let i = 0; i < LASER_N; i++) {
      const m = new T.MeshBasicMaterial({ color: ringCol.clone(), vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      const b = new T.Mesh(laserGeo, m);
      const side = i % 2 ? 1 : -1, row = i >> 1;
      b.position.set(side * (8 + row * 1.5), 0, -16 - row * 16);
      b.userData = { side, row, m };
      b.visible = false; b.frustumCulled = false;
      scene.add(b); lasers.push(b);
    }

    // ---------- dust ----------
    const DUST = 260;
    const dustGeo = new T.BufferGeometry();
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 30; dustPos[i * 3 + 1] = Math.random() * 9; dustPos[i * 3 + 2] = -Math.random() * 90 + 4;
    }
    dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3));
    const dotTex = glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)');
    const dustMat = new T.PointsMaterial({ size: 0.07, map: dotTex, color: 0xb9a6ff, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false });
    const dust = new T.Points(dustGeo, dustMat);
    scene.add(dust);

    // ---------- blade ----------
    const blade = new T.Group();
    blade.position.copy(LAYOUT.HILT);
    const L = LAYOUT.BLADE_LEN;
    const mkTube = (r, mat, len, z) => {
      const g = new T.CylinderGeometry(r, r * 0.92, len, 14, 1, true); g.rotateX(-Math.PI / 2); g.translate(0, 0, z);
      return new T.Mesh(g, mat);
    };
    const coreMat = new T.MeshBasicMaterial({ color: 0xf2fffb, fog: false });
    const core = mkTube(0.016, coreMat, L, -L / 2);
    const glowA = glowMaterial(COL.blade, 1.2, 1.1);
    const glowB = glowMaterial(COL.blade, 2.4, 0.45);
    blade.add(core, mkTube(0.04, glowA, L, -L / 2), mkTube(0.11, glowB, L * 1.01, -L / 2));
    // hilt
    const hiltMat = new T.MeshBasicMaterial({ color: 0x1c1626, fog: false });
    const hiltG = new T.CylinderGeometry(0.045, 0.05, 0.42, 16); hiltG.rotateX(-Math.PI / 2); hiltG.translate(0, 0, 0.2);
    blade.add(new T.Mesh(hiltG, hiltMat));
    const bandMat = new T.MeshBasicMaterial({ color: COL.blade, fog: false });
    [0.02, 0.12, 0.3].forEach(z => {
      const g = new T.CylinderGeometry(0.053, 0.053, 0.022, 16); g.rotateX(-Math.PI / 2); g.translate(0, 0, z);
      blade.add(new T.Mesh(g, bandMat));
    });
    const tipSprite = new T.Sprite(new T.SpriteMaterial({ map: glowTex('rgba(230,255,248,1)', 'rgba(111,245,210,0.5)'), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    tipSprite.scale.set(0.5, 0.5, 1); tipSprite.position.set(0, 0, -L);
    blade.add(tipSprite);
    scene.add(blade);

    // ---------- trail ----------
    const TRAIL_MAX = 72;
    const trailGeo = new T.BufferGeometry();
    const trailPos = new Float32Array(TRAIL_MAX * 2 * 3), trailCol = new Float32Array(TRAIL_MAX * 2 * 3);
    trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3).setUsage(T.DynamicDrawUsage));
    trailGeo.setAttribute('color', new T.BufferAttribute(trailCol, 3).setUsage(T.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    trailGeo.setIndex(idx);
    const trail = new T.Mesh(trailGeo, new T.MeshBasicMaterial({ vertexColors: true, blending: T.AdditiveBlending, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false }));
    trail.frustumCulled = false;
    scene.add(trail);
    const trailSamples = []; // {base, tip, t}

    // ---------- block assets ----------
    const sideTex = canvasTex(256, (g, s) => faceBase(g, s));
    const arrowTex = canvasTex(256, (g, s) => {
      faceBase(g, s);
      g.save(); g.shadowColor = COL.block; g.shadowBlur = 30; g.strokeStyle = COL.blockGlyph; g.lineWidth = 36; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(s * 0.22, s * 0.42); g.lineTo(s * 0.5, s * 0.72); g.lineTo(s * 0.78, s * 0.42); g.stroke();
      g.shadowBlur = 0; g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.stroke(); g.restore();
      g.fillStyle = 'rgba(255,241,220,0.25)'; g.beginPath(); g.arc(s * 0.5, s * 0.3, 8, 0, Math.PI * 2); g.fill();
    });
    const dotFaceTex = canvasTex(256, (g, s) => {
      faceBase(g, s);
      g.save(); g.shadowColor = COL.block; g.shadowBlur = 26; g.fillStyle = COL.blockGlyph;
      g.beginPath(); g.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2); g.fill(); g.restore();
    });
    const blockGeo = new T.BoxGeometry(LAYOUT.BLOCK, LAYOUT.BLOCK, LAYOUT.BLOCK);
    { // per-face shading baked as vertex colours; front (+z) uses material 1
      const shade = [0.72, 0.72, 1.0, 0.45, 1.0, 0.55];
      const cols = new Float32Array(24 * 3);
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) cols.set([shade[f], shade[f], shade[f]], (f * 4 + v) * 3);
      blockGeo.setAttribute('color', new T.BufferAttribute(cols, 3));
      blockGeo.groups.forEach((gr, i) => { gr.materialIndex = i === 4 ? 1 : 0; });
    }
    // no fog on blocks: they arrive crisp from the far end instead of out of a murk
    const mkMats = front => [new T.MeshBasicMaterial({ map: sideTex, vertexColors: true, fog: false }), new T.MeshBasicMaterial({ map: front, vertexColors: true, fog: false })];
    const arrowMats = mkMats(arrowTex), dotMats = mkMats(dotFaceTex);
    const blockGlowMat = new T.SpriteMaterial({ map: glowTex('rgba(255,140,90,0.9)', 'rgba(255,90,50,0.35)'), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });

    function makeBlock(isDot) {
      const g = new T.Group();
      const mesh = new T.Mesh(blockGeo, isDot ? dotMats : arrowMats);
      const glow = new T.Sprite(blockGlowMat); glow.scale.set(1.25, 1.25, 1); glow.position.z = -0.05;
      g.add(glow, mesh);
      g.userData.mesh = mesh; g.userData.glow = glow;
      scene.add(g);
      return g;
    }

    // ---------- debris (sliced halves using clipping planes) ----------
    const debris = [];
    let hotAmt = 1.4;
    function sliceBlock(group, planeNormalW, planeOffsetFromCentre, vel, push) {
      const mesh = group.userData.mesh;
      group.updateMatrixWorld(true);
      const centre = new T.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const qW = new T.Quaternion(); mesh.getWorldQuaternion(qW);
      const nLocal = planeNormalW.clone().applyQuaternion(qW.clone().invert());
      [1, -1].forEach(sign => {
        const mats = mesh.material.map(m => { const c = m.clone(); c.clippingPlanes = [new T.Plane()]; c.side = T.DoubleSide; c.transparent = true; return c; });
        const h = new T.Mesh(mesh.geometry, mats);
        h.position.copy(centre); h.quaternion.copy(qW);
        scene.add(h);
        const n = nLocal.clone().multiplyScalar(sign);
        debris.push({
          mesh: h, mats, nLocal: n, cLocal: planeOffsetFromCentre * sign, life: 0, maxLife: 1.1,
          vel: vel.clone().add(planeNormalW.clone().multiplyScalar(sign * 1.6)).add(push.clone().multiplyScalar(0.25)),
          spinAxis: new T.Vector3().crossVectors(planeNormalW, push).normalize().multiplyScalar(sign).add(new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4)).normalize(),
          spin: 5 + Math.random() * 4,
        });
      });
    }
    const _pl = new T.Plane(), _q = new T.Quaternion();
    function updateDebris(dt) {
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.life += dt;
        d.vel.y -= 7.5 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        _q.setFromAxisAngle(d.spinAxis, d.spin * dt);
        d.mesh.quaternion.premultiply(_q);
        d.mesh.updateMatrixWorld(true);
        // keep side where dot(nLocal, p) + cLocal >= 0 (local space), expressed in world space
        _pl.set(d.nLocal, d.cLocal).applyMatrix4(d.mesh.matrixWorld);
        const k = d.life / d.maxLife;
        // halves glow white-hot for a moment, and fade before they can fill the lens
        const hot = 1 + hotAmt * Math.max(0, 1 - d.life / 0.16);
        const near = Math.max(0, Math.min(1, (0.2 - d.mesh.position.z) / 1.2));
        d.mats.forEach(m => { m.clippingPlanes[0].copy(_pl); m.opacity = (1 - k * k) * near; m.color.setScalar(hot); });
        if (d.life >= d.maxLife) {
          scene.remove(d.mesh); d.mats.forEach(m => m.dispose()); debris.splice(i, 1);
        }
      }
    }

    // ---------- particles ----------
    const P_MAX = 900;
    const pGeo = new T.BufferGeometry();
    const pPos = new Float32Array(P_MAX * 3), pCol = new Float32Array(P_MAX * 3);
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3).setUsage(T.DynamicDrawUsage));
    pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3).setUsage(T.DynamicDrawUsage));
    const points = new T.Points(pGeo, new T.PointsMaterial({ size: 0.075, map: dotTex, vertexColors: true, blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    points.frustumCulled = false;
    scene.add(points);
    const parts = [];
    for (let i = 0; i < P_MAX; i++) parts.push({ alive: false, p: new T.Vector3(), v: new T.Vector3(), life: 0, max: 1, c: new T.Color(), drag: 1 });
    let pCursor = 0;
    function emit(pos, vel, color, life, drag) {
      const q = parts[pCursor]; pCursor = (pCursor + 1) % P_MAX;
      q.alive = true; q.p.copy(pos); q.v.copy(vel); q.c.copy(color); q.life = 0; q.max = life; q.drag = drag || 1.5;
    }
    function updateParticles(dt) {
      let n = 0;
      for (let i = 0; i < P_MAX; i++) {
        const q = parts[i];
        if (!q.alive) continue;
        q.life += dt;
        if (q.life >= q.max) { q.alive = false; continue; }
        q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.v.y -= 5 * dt;
        q.p.addScaledVector(q.v, dt);
        const f = 1 - q.life / q.max;
        pPos[n * 3] = q.p.x; pPos[n * 3 + 1] = q.p.y; pPos[n * 3 + 2] = q.p.z;
        pCol[n * 3] = q.c.r * f; pCol[n * 3 + 1] = q.c.g * f; pCol[n * 3 + 2] = q.c.b * f;
        n++;
      }
      pGeo.setDrawRange(0, n);
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    }

    // ---------- flashes ----------
    const flashTex = glowTex('rgba(255,250,235,1)', 'rgba(255,150,90,0.5)');
    const flashes = [];
    for (let i = 0; i < 10; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: flashTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false; scene.add(s); flashes.push({ s, life: 1, max: 0.3, size: 1 });
    }
    let fCursor = 0;
    function flash(pos, size, color) {
      const f = flashes[fCursor]; fCursor = (fCursor + 1) % flashes.length;
      f.s.position.copy(pos); f.s.visible = true; f.life = 0; f.size = size; f.s.material.color.set(color || 0xffffff);
    }
    function updateFlashes(dt) {
      flashes.forEach(f => {
        if (!f.s.visible) return;
        f.life += dt; const k = f.life / f.max;
        if (k >= 1) { f.s.visible = false; return; }
        const sc = f.size * (0.4 + k * 1.2); f.s.scale.set(sc, sc, 1); f.s.material.opacity = (1 - k) * (1 - k);
      });
    }

    // ---------- spark streaks ----------
    // Velocity-stretched quads, one instance each; the CPU integrates, the GPU orients them.
    const S_MAX = 640;
    const sGeo = new T.InstancedBufferGeometry();
    sGeo.setAttribute('position', new T.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    sGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const sPos = new Float32Array(S_MAX * 3), sVel = new Float32Array(S_MAX * 3), sCol = new Float32Array(S_MAX * 3);
    const sPosA = new T.InstancedBufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage);
    const sVelA = new T.InstancedBufferAttribute(sVel, 3).setUsage(T.DynamicDrawUsage);
    const sColA = new T.InstancedBufferAttribute(sCol, 3).setUsage(T.DynamicDrawUsage);
    sGeo.setAttribute('iPos', sPosA); sGeo.setAttribute('iVel', sVelA); sGeo.setAttribute('iCol', sColA);
    sGeo.instanceCount = 0;
    const streakMat = new T.ShaderMaterial({
      uniforms: { uLen: { value: 0.035 }, uWidth: { value: 0.012 } },
      vertexShader: [
        'attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; uniform float uLen; uniform float uWidth; varying vec3 vC; varying float vY; varying float vX;',
        'void main(){',
        '  vec3 a = (viewMatrix * vec4(iPos, 1.0)).xyz; vec3 b = (viewMatrix * vec4(iPos - iVel * uLen, 1.0)).xyz;',
        '  vec3 d = b - a; if (dot(d, d) < 1e-8) d = vec3(0.0, 1e-4, 0.0);',
        '  vec3 side = normalize(cross(d, a)) * uWidth * (1.0 - 0.6 * position.x);',
        '  vec3 p = mix(a, b, position.x) + side * position.y;',
        '  vC = iCol; vY = position.y; vX = position.x;',
        '  gl_Position = projectionMatrix * vec4(p, 1.0);',
        '}'].join('\n'),
      fragmentShader: 'varying vec3 vC; varying float vY; varying float vX; void main(){ float f = (1.0 - abs(vY)) * (1.0 - vX * 0.85); gl_FragColor = vec4(vC * f * 1.6, 1.0); }',
      blending: T.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const streaks = new T.Mesh(sGeo, streakMat);
    streaks.frustumCulled = false;
    scene.add(streaks);
    const sp = [];
    for (let i = 0; i < S_MAX; i++) sp.push({ alive: false, p: new T.Vector3(), v: new T.Vector3(), c: new T.Color(), life: 0, max: 1, drag: 2 });
    let sCursor = 0;
    function streak(pos, vel, color, life, drag) {
      const q = sp[sCursor]; sCursor = (sCursor + 1) % S_MAX;
      q.alive = true; q.p.copy(pos); q.v.copy(vel); q.c.copy(color); q.life = 0; q.max = life; q.drag = drag || 2;
    }
    function updateStreaks(dt) {
      let n = 0;
      for (let i = 0; i < S_MAX; i++) {
        const q = sp[i];
        if (!q.alive) continue;
        q.life += dt;
        if (q.life >= q.max) { q.alive = false; continue; }
        q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.v.y -= 6 * dt;
        q.p.addScaledVector(q.v, dt);
        const f = 1 - q.life / q.max;
        sPos[n * 3] = q.p.x; sPos[n * 3 + 1] = q.p.y; sPos[n * 3 + 2] = q.p.z;
        sVel[n * 3] = q.v.x; sVel[n * 3 + 1] = q.v.y; sVel[n * 3 + 2] = q.v.z;
        sCol[n * 3] = q.c.r * f; sCol[n * 3 + 1] = q.c.g * f; sCol[n * 3 + 2] = q.c.b * f;
        n++;
      }
      sGeo.instanceCount = n;
      if (n) { sPosA.needsUpdate = true; sVelA.needsUpdate = true; sColA.needsUpdate = true; }
    }

    // ---------- slash streaks ----------
    // a bright line drawn through the block along the cut, in screen space
    const slashTex = canvasTex(256, (g, s) => {
      const gx = g.createLinearGradient(0, 0, s, 0);
      gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.35, 'rgba(255,255,255,1)'); gx.addColorStop(0.65, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gx; g.fillRect(0, 0, s, s);
      g.globalCompositeOperation = 'destination-in';
      const gy = g.createLinearGradient(0, 0, 0, s);
      gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.4, 'rgba(0,0,0,0.5)'); gy.addColorStop(0.5, 'rgba(0,0,0,1)'); gy.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gy; g.fillRect(0, 0, s, s);
    });
    const slashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: slashTex, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
      s.visible = false; s.renderOrder = 5; scene.add(s); slashes.push({ s, life: 1, max: 0.24, len: 1, w: 0.2 });
    }
    let slCursor = 0;
    function slash(pos, angle, len, color) {
      const f = slashes[slCursor]; slCursor = (slCursor + 1) % slashes.length;
      f.s.position.copy(pos); f.s.visible = true; f.life = 0; f.len = len; f.s.material.rotation = angle; f.s.material.color.set(color || 0xffffff);
    }
    function updateSlashes(dt) {
      slashes.forEach(f => {
        if (!f.s.visible) return;
        f.life += dt; const k = f.life / f.max;
        if (k >= 1) { f.s.visible = false; return; }
        const e = 1 - Math.pow(1 - k, 3);
        f.s.scale.set(f.len * (0.55 + 0.75 * e), 0.5 * (1 - k * 0.8), 1);
        f.s.material.opacity = (1 - k) * (1 - k) * 1.2;
      });
    }

    // ---------- heavy (crystal) blocks ----------
    function crystalBase(g, s) {
      const grd = g.createLinearGradient(0, 0, s, s);
      grd.addColorStop(0, '#d9f6ff'); grd.addColorStop(0.45, '#5fb8e8'); grd.addColorStop(1, '#1b3a6b');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3;
      [[0, 0.3, 0.55, 0], [0.2, 1, 1, 0.35], [0, 0.75, 0.4, 1], [0.6, 0, 1, 0.6]].forEach(l => { g.beginPath(); g.moveTo(l[0] * s, l[1] * s); g.lineTo(l[2] * s, l[3] * s); g.stroke(); });
      g.save(); g.shadowColor = '#bff4ff'; g.shadowBlur = 20; g.strokeStyle = '#f4fdff'; g.lineWidth = 12; roundRect(g, 12, 12, s - 24, s - 24, 18); g.stroke(); g.restore();
    }
    const heavySide = canvasTex(256, crystalBase);
    const heavyArrow = canvasTex(256, (g, s) => {
      crystalBase(g, s);
      g.save(); g.shadowColor = '#001a33'; g.shadowBlur = 10; g.strokeStyle = '#06152b'; g.lineWidth = 34; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(s * 0.22, s * 0.42); g.lineTo(s * 0.5, s * 0.72); g.lineTo(s * 0.78, s * 0.42); g.stroke(); g.restore();
    });
    const heavyDot = canvasTex(256, (g, s) => {
      crystalBase(g, s); g.fillStyle = '#06152b'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.14, 0, Math.PI * 2); g.fill();
    });
    const mkHeavy = front => [new T.MeshBasicMaterial({ map: heavySide, vertexColors: true, fog: false }), new T.MeshBasicMaterial({ map: front, vertexColors: true, fog: false })];
    const heavyArrowMats = mkHeavy(heavyArrow), heavyDotMats = mkHeavy(heavyDot);
    const heavyGlowMat = new T.SpriteMaterial({ map: glowTex('rgba(200,245,255,0.95)', 'rgba(90,180,255,0.4)'), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 });
    const shellGeo = new T.EdgesGeometry(new T.BoxGeometry(LAYOUT.BLOCK * 1.22, LAYOUT.BLOCK * 1.22, LAYOUT.BLOCK * 1.22));
    const shellMat = new T.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false });
    function makeHeavy(isDot) {
      const g = new T.Group();
      const mesh = new T.Mesh(blockGeo, isDot ? heavyDotMats : heavyArrowMats);
      const glow = new T.Sprite(heavyGlowMat); glow.scale.set(1.7, 1.7, 1); glow.position.z = -0.05;
      const shell = new T.LineSegments(shellGeo, shellMat);
      g.add(glow, mesh, shell);
      g.userData.mesh = mesh; g.userData.shell = shell; g.userData.glow = glow;
      scene.add(g);
      return g;
    }

    // ---------- chain links ----------
    const linkGeo = new T.BoxGeometry(LAYOUT.BLOCK * 0.5, LAYOUT.BLOCK * 0.5, LAYOUT.BLOCK * 0.22);
    const linkTex = canvasTex(128, (g, s) => {
      g.fillStyle = '#2b1020'; g.fillRect(0, 0, s, s);
      g.save(); g.shadowColor = '#ffb08a'; g.shadowBlur = 14; g.strokeStyle = '#ffd2b8'; g.lineWidth = 12; roundRect(g, 10, 10, s - 20, s - 20, 18); g.stroke();
      g.fillStyle = '#fff1dc'; g.beginPath(); g.arc(s / 2, s / 2, 13, 0, Math.PI * 2); g.fill(); g.restore();
    });
    const linkMat = new T.MeshBasicMaterial({ map: linkTex, fog: false });
    const linkGlowMat = new T.SpriteMaterial({ map: glowTex('rgba(255,190,150,0.9)', 'rgba(255,110,70,0.3)'), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    function makeLink() {
      const g = new T.Group();
      const mesh = new T.Mesh(linkGeo, [linkMat, linkMat, linkMat, linkMat, linkMat, linkMat]);
      const glow = new T.Sprite(linkGlowMat); glow.scale.set(0.7, 0.7, 1);
      g.add(glow, mesh); g.userData.mesh = mesh;
      scene.add(g);
      return g;
    }

    // ---------- mines ----------
    const bombCoreGeo = new T.IcosahedronGeometry(0.15, 1);
    const bombMat = new T.MeshBasicMaterial({ color: 0x1a0610 });
    const spikeGeo = new T.ConeGeometry(0.035, 0.13, 6); spikeGeo.translate(0, 0.17, 0);
    const spikeMat = new T.MeshBasicMaterial({ color: 0xff2d55 });
    const bombGlowMat = new T.SpriteMaterial({ map: glowTex('rgba(255,60,80,1)', 'rgba(255,0,40,0.4)'), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
    const bombWire = new T.LineBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9 });
    const bombEdges = new T.EdgesGeometry(bombCoreGeo);
    const spikeDirs = [];
    {
      const pos = new T.IcosahedronGeometry(1, 0).attributes.position, seen = new Set(), v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const k = v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2);
        if (!seen.has(k)) { seen.add(k); spikeDirs.push(v.clone()); }
      }
    }
    const _up = new T.Vector3(0, 1, 0);
    function makeBomb() {
      const g = new T.Group();
      const glow = new T.Sprite(bombGlowMat); glow.scale.set(0.55, 0.55, 1);
      g.add(glow, new T.Mesh(bombCoreGeo, bombMat), new T.LineSegments(bombEdges, bombWire));
      spikeDirs.forEach(v => { const sp = new T.Mesh(spikeGeo, spikeMat); sp.quaternion.setFromUnitVectors(_up, v); g.add(sp); });
      g.userData.glow = glow;
      scene.add(g);
      return g;
    }

    // ---------- walls ----------
    function makeWall(x0, x1, depth) {
      const g = new T.Group();
      const h = 2.7;
      const geo = new T.BoxGeometry(x1 - x0, h, depth); geo.translate((x0 + x1) / 2, h / 2, -depth / 2);
      const mat = new T.MeshBasicMaterial({ color: 0xff4fa0, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      const edge = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: 0xff8ac4, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
      // scan lines across the front face so the glass reads as solid
      const lines = [];
      for (let i = 1; i < 9; i++) { const y = h * i / 9; lines.push(x0, y, 0.002, x1, y, 0.002); }
      const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(lines, 3));
      const scan = new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0xff8ac4, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false }));
      g.add(new T.Mesh(geo, mat), edge, scan);
      g.userData.mats = [mat, edge.material, scan.material];
      scene.add(g);
      return g;
    }

    // ---------- arcs (trace ribbons) ----------
    const beadTex = glowTex('rgba(255,255,255,1)', 'rgba(111,245,210,0.6)');
    function makeArc(points) {
      const curve = new T.CatmullRomCurve3(points);
      const seg = Math.max(24, points.length * 4);
      const mat = new T.MeshBasicMaterial({ color: 0x9ffbe3, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false });
      const outerMat = new T.MeshBasicMaterial({ color: 0x6ff5d2, transparent: true, opacity: 0.18, blending: T.AdditiveBlending, depthWrite: false });
      const g = new T.Group();
      g.add(new T.Mesh(new T.TubeGeometry(curve, seg, 0.07, 8, false), mat), new T.Mesh(new T.TubeGeometry(curve, seg, 0.18, 8, false), outerMat));
      // glowing studs along the ribbon so it reads at a distance
      const studMat = new T.SpriteMaterial({ map: beadTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
      points.forEach((p, i) => { if (i % 2) return; const s = new T.Sprite(studMat); s.position.copy(p); s.scale.set(0.3, 0.3, 1); g.add(s); });
      const bead = new T.Sprite(new T.SpriteMaterial({ map: beadTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      bead.scale.set(0.5, 0.5, 1); bead.visible = false; scene.add(bead);
      g.userData = { mat, outerMat, bead };
      scene.add(g);
      return g;
    }
    function removeObj(g) {
      scene.remove(g);
      if (g.userData && g.userData.bead) scene.remove(g.userData.bead);
    }

    // ---------- shockwave rings ----------
    const ringTex = canvasTex(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });
    const waves = [];
    for (let i = 0; i < 6; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: ringTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.visible = false; scene.add(sp); waves.push({ s: sp, life: 1, max: 0.45, size: 2 });
    }
    let wCursor = 0;
    function shockwave(pos, size, color) {
      const w = waves[wCursor]; wCursor = (wCursor + 1) % waves.length;
      w.s.position.copy(pos); w.s.visible = true; w.life = 0; w.size = size; w.s.material.color.set(color || 0xffffff);
    }
    function updateWaves(dt) {
      waves.forEach(w => {
        if (!w.s.visible) return;
        w.life += dt; const k = w.life / w.max;
        if (k >= 1) { w.s.visible = false; return; }
        const sc = w.size * (0.2 + k); w.s.scale.set(sc, sc, 1); w.s.material.opacity = (1 - k) * (reduced ? 0.5 : 1);
      });
    }

    // ---------- knocked-away objects (deflected heavies) ----------
    const tumbles = [];
    const _kq = new T.Quaternion();
    function knock(group, vel) {
      tumbles.push({ g: group, vel: vel.clone(), life: 0, axis: new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), s0: group.scale.x });
    }
    function updateTumbles(dt) {
      for (let i = tumbles.length - 1; i >= 0; i--) {
        const k = tumbles[i];
        k.life += dt; k.vel.y -= 9 * dt;
        k.g.position.addScaledVector(k.vel, dt);
        _kq.setFromAxisAngle(k.axis, 9 * dt); k.g.quaternion.premultiply(_kq);
        k.g.scale.setScalar(k.s0 * Math.max(0.01, 1 - k.life / 0.8));
        if (k.life > 0.8) { scene.remove(k.g); tumbles.splice(i, 1); }
      }
    }

    // ---------- blade tint (surge) ----------
    const bladeBase = COL.blade.clone(), bladeGold = new T.Color('#ffd27a');
    const bladeCol = COL.blade.clone();
    function setBladeTint(k) {
      bladeCol.copy(bladeBase).lerp(bladeGold, k);
      glowA.uniforms.uColor.value.copy(bladeCol); glowB.uniforms.uColor.value.copy(bladeCol);
      bandMat.color.copy(bladeCol);
    }

    // ---------- theme, heat and quality ----------
    const target = {
      top: C(DEFAULT_THEME.top), mid: C(DEFAULT_THEME.mid), hor: C(DEFAULT_THEME.hor), halo: C(DEFAULT_THEME.halo),
      line: C(DEFAULT_THEME.line), rail: C(DEFAULT_THEME.rail), fog: C(DEFAULT_THEME.fog), pyA: C(DEFAULT_THEME.py[0]), pyB: C(DEFAULT_THEME.py[1]), dust: C(DEFAULT_THEME.dust),
    };
    const themeState = { key: '', sides: 8, rot: Math.PI / 8, twist: 0, pendingSides: 0, pendingRot: 0, pendingTwist: 0, ringVis: 1, hard: 0, snap: false };
    /** Switch the world to a song's look; colours glide over ~half a second, gates swap behind a fade. */
    function setTheme(key, hard, snap) {
      const th = THEMES[key] || DEFAULT_THEME;
      const id = (key || '') + (hard ? '!' : '');
      if (id === themeState.key && !snap) return;
      themeState.key = id; themeState.hard = hard ? 1 : 0; themeState.glide = 150;
      target.top.set(th.top); target.mid.set(th.mid); target.halo.set(th.halo); target.line.set(th.line); target.rail.set(th.rail);
      target.hor.set(th.hor).multiplyScalar(hard ? 1.3 : 1);
      target.fog.set(th.fog); target.pyA.set(th.py[0]); target.pyB.set(th.py[1]); target.dust.set(th.dust);
      if (th.sides !== themeState.sides || th.rot !== themeState.rot) { themeState.pendingSides = th.sides; themeState.pendingRot = th.rot; }
      themeState.pendingTwist = th.twist;
      if (snap) {
        themeState.snap = true;
        if (themeState.pendingSides) { applyGates(); }
        themeState.twist = th.twist;
      }
    }
    function applyGates() {
      const g = ringGeoFor(themeState.pendingSides);
      rings.forEach(r => { r.geometry = g; });
      themeState.sides = themeState.pendingSides; themeState.rot = themeState.pendingRot; themeState.pendingSides = 0;
    }
    const _zAxis = new T.Vector3(0, 0, 1);
    let heat = 0, hitGlow = 0, ripple = 1, lastPulse = 0, breakT = 0, quality = 2, reduced = false;
    /** 0..1 how hot the run is (combo); the world brightens and the halo opens a second ring. */
    function setHeat(h) { heat = h; }
    /** A cut landed: the hit line flares. */
    function hitPulse(k) { hitGlow = Math.min(1, hitGlow + k); }
    /** Section change / drop: a ring of light bursts from the halo. */
    function sectionBurst() { breakT = 1; }
    /** 0 low (no streaks, no lasers, less dust), 1 normal, 2 high (lasers, more sparks, hot debris). */
    function setQuality(q) {
      quality = q;
      streaks.visible = q > 0;
      if (q < 2) lasers.forEach(b => { b.visible = false; });
      dustGeo.setDrawRange(0, q === 0 ? DUST >> 1 : DUST);
      hotAmt = q === 2 ? 1.4 : q === 1 ? 0.9 : 0;
    }
    function setReduced(on) { reduced = !!on; }

    // ---------- per-frame environment ----------
    let envScroll = 0;
    function updateEnv(dt, beat, pulse, intensity, accent, time) {
      const speed = 4 + intensity * 4.5 + heat * 1.5;
      envScroll += dt * speed;
      const su = skyMat.uniforms, fu = floorMat.uniforms;
      // theme glide (dt may be 0 while paused, but the theme can still change from the menu)
      const tk = themeState.snap ? 1 : Math.min(1, Math.max(dt, 1 / 60) * 3);
      themeState.snap = false;
      su.uTop.value.lerp(target.top, tk); su.uMid.value.lerp(target.mid, tk); su.uHor.value.lerp(target.hor, tk); su.uHalo.value.lerp(target.halo, tk);
      fu.uLine.value.lerp(target.line, tk); fu.uRail.value.lerp(target.rail, tk); fu.uFog.value.lerp(target.fog, tk);
      scene.fog.color.copy(fu.uFog.value);
      ringCol.lerp(target.halo, tk);
      if (themeState.glide > 0) { themeState.glide--; pyA.lerp(target.pyA, tk); pyB.lerp(target.pyB, tk); colourPylons(); }
      dustMat.color.lerp(target.dust, tk);
      const gdt = Math.max(dt, 1 / 60);
      if (themeState.pendingSides) { themeState.ringVis -= gdt * 5; if (themeState.ringVis <= 0) { themeState.ringVis = 0; applyGates(); } }
      else themeState.ringVis = Math.min(1, themeState.ringVis + gdt * 3);
      themeState.twist += (themeState.pendingTwist - themeState.twist) * tk;

      // strong kick -> floor ripple
      if (pulse > 0.55 && lastPulse <= 0.55 && ripple > 0.35) ripple = 0;
      lastPulse = pulse;
      ripple = Math.min(1, ripple + dt * 1.6);
      hitGlow = Math.max(0, hitGlow - dt * 4);
      breakT = Math.max(0, breakT - dt * 0.9);
      fu.uScroll.value = envScroll;
      fu.uPulse.value = pulse;
      fu.uRip.value = quality > 0 ? ripple : 1;
      fu.uHit.value = hitGlow;
      fu.uHeat.value = heat;
      su.uPulse.value = pulse;
      su.uTime.value = time;
      su.uHeat.value = heat;
      su.uBreak.value = reduced ? breakT * 0.35 : breakT;
      if (accent) { fu.uAccent.value.lerp(accent, Math.min(1, dt * 2)); su.uAccent.value.copy(fu.uAccent.value); }
      const tw = themeState.twist;
      rings.forEach((r, i) => {
        let z = r.userData.base + (envScroll % RING_GAP);
        r.position.z = z;
        r.rotation.z = themeState.rot + Math.sin(time * 0.3 + i * 0.5) * 0.08 * intensity + tw * (-z / RING_GAP) + tw * time * 0.6;
        const dist = -z;
        // pulse travels outward down the corridor
        const lag = dist / 40;
        const ph = beat - lag; const fr = ph - Math.floor(ph);
        const p = Math.exp(-fr * 5) * (intensity > 0 ? 1 : 0.35);
        const fade = Math.min(1, Math.max(0, (dist + 4) / 8));
        r.material.opacity = (0.3 + 0.9 * p) * (1 + 0.45 * heat) * fade * themeState.ringVis;
        r.material.color.copy(ringCol).lerp(fu.uAccent.value, p * 0.5);
        const sc = 1 + p * 0.05; r.scale.set(sc, sc, 1);
      });
      // lasers: only in the high tier, only once the music lifts
      if (quality === 2) {
        const amt = Math.max(0, Math.min(1, (intensity - 0.45) / 0.4)) * (1 + 0.3 * heat);
        lasers.forEach((b, i) => {
          const u = b.userData;
          const on = amt > 0.01;
          b.visible = on;
          if (!on) return;
          const sweep = Math.sin(time * (0.7 + u.row * 0.17) + u.row * 1.3 + (u.side > 0 ? Math.PI : 0)) * 0.55;
          // rest pose points up and slightly over the corridor; the sweep fans it across the sky
          b.rotation.set(1.0 + 0.25 * Math.sin(time * 0.5 + i), 0, 0);
          b.rotateOnWorldAxis(_zAxis, u.side * (0.45 + 0.2 * u.row / 3) + sweep * (reduced ? 0.4 : 1));
          const flick = reduced ? 0.5 : 0.25 + 0.95 * pulse;
          u.m.opacity = Math.min(1, amt * flick * 0.85);
          u.m.color.copy(ringCol).lerp(fu.uAccent.value, 0.35 + 0.3 * (i % 2));
        });
      }
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < PY_N; i++) {
          const z = 2 - ((i * PY_GAP + envScroll * 1.0) % (PY_N * PY_GAP));
          const ph = beat * 0.5 + i * 0.13 + side * 0.5;
          const bounce = Math.exp(-((beat - Math.floor(beat)) * 4)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + Math.floor(beat) * 2.1)));
          const hgt = 0.4 + (Math.sin(ph * 3.1) * 0.5 + 0.5) * 0.8 + bounce * (1.2 + 2.2 * intensity) * (1 + 0.4 * heat);
          pyDummy.position.set(side ? 6.6 : -6.6, 0, z);
          pyDummy.scale.set(1, hgt, 1);
          pyDummy.updateMatrix();
          pylons.setMatrixAt(side * PY_N + i, pyDummy.matrix);
        }
      }
      pylons.instanceMatrix.needsUpdate = true;
      // dust drifts toward the player
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3 + 2] += dt * speed * 1.6;
        if (dustPos[i * 3 + 2] > 4) dustPos[i * 3 + 2] -= 92;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    // ---------- blade & trail ----------
    const _base = new T.Vector3(), _tip = new T.Vector3();
    function setBlade(quat, dirW) {
      blade.quaternion.copy(quat);
      void dirW;
    }
    function pushTrail(hilt, dir, t) {
      _base.copy(hilt).addScaledVector(dir, LAYOUT.BLADE_LEN * 0.38);
      _tip.copy(hilt).addScaledVector(dir, LAYOUT.BLADE_LEN * 1.0);
      trailSamples.push({ base: _base.clone(), tip: _tip.clone(), t });
      if (trailSamples.length > TRAIL_MAX) trailSamples.shift();
    }
    function updateTrail(now, energy) {
      const maxAge = 0.12;
      while (trailSamples.length && now - trailSamples[0].t > maxAge) trailSamples.shift();
      const n = trailSamples.length;
      const c = bladeCol;
      for (let i = 0; i < n; i++) {
        const s = trailSamples[i];
        const k = 1 - (now - s.t) / maxAge;
        const a = k * k * energy;
        trailPos.set([s.base.x, s.base.y, s.base.z], i * 6);
        trailPos.set([s.tip.x, s.tip.y, s.tip.z], i * 6 + 3);
        trailCol.set([0, 0, 0], i * 6);
        trailCol.set([c.r * a * 0.55, c.g * a * 0.55, c.b * a * 0.55], i * 6 + 3);
      }
      trailGeo.setDrawRange(0, Math.max(0, (n - 1) * 6));
      trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
    }

    function resize() {
      renderer.setSize(global.innerWidth, global.innerHeight, false);
      camera.aspect = global.innerWidth / global.innerHeight;
      camera.updateProjectionMatrix();
    }

    return {
      renderer, scene, camera, camBase, camQuat, blade, tipSprite, glowA, glowB, makeBlock, sliceBlock, updateDebris,
      emit, updateParticles, flash, updateFlashes, updateEnv, setBlade, pushTrail, updateTrail, resize, debris,
      streak, updateStreaks, slash, updateSlashes, setTheme, setHeat, hitPulse, sectionBurst, setQuality, setReduced,
      get quality() { return quality; },
      makeHeavy, makeLink, makeBomb, makeWall, makeArc, removeObj, shockwave, updateWaves, knock, updateTumbles, setBladeTint,
      LAYOUT, COL,
    };
  }

  global.CadenceScene = { createWorld, LAYOUT, COL, THEMES };
})(window);
