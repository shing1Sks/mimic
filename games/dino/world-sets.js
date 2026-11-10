// Ironfern world (Stage A), per-mission dressing: the structures and props that make each stand
// read as a place (gatehouse, ranger tower, paddocks + bridge + feeding station, barrier on a rise,
// visitor centre plaza), plus where the jungle grows. Each set(B) returns
// { terrain: {...splat opts}, forest(x,z), grassy(x,z), brush(x,z), scrub(x,z), clear: [...], canopy, ferns, ..., build() }.
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const L = () => DH.WorldLib;
  const PI = Math.PI;

  // ------------------------------------------------------------------ shared structures
  function railing(B, x0, z0, x1, z1, y, o) {
    o = o || {};
    const m = o.mat || B.mat('rusty_metal_02', { tile: 1, rough: 0.55, metal: 0.7 });
    const L2 = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const h = o.h || 1.05;
    [h, h * 0.5].forEach(hh => B.box(L2, 0.05, 0.05, m, { x: cx, z: cz, y: y + hh - 0.025, ry, surface: 'metal' }));
    const n = Math.max(1, Math.round(L2 / (o.step || 1.6)));
    for (let i = 0; i <= n; i++) { const u = i / n; B.box(0.06, h, 0.06, m, { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, y, ry, surface: 'metal' }); }
  }
  /** Corrugated-iron work shed. Returns its top y. */
  function shed(B, x, z, w, d, h, o) {
    o = o || {};
    const y = o.y != null ? o.y : Math.min(B.h(x - w / 2, z - d / 2), B.h(x + w / 2, z + d / 2), B.h(x, z)) - 0.2;
    const wall = B.mat(o.wall || 'container_side', { tile: 2.5, rough: 0.65, metal: 0.25, color: o.tint || 0xd8d4c8 });
    const roof = B.mat('rusty_metal_02', { tile: 3, rough: 0.6, metal: 0.6 });
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = o.ry || 0; B.add(g);
    const base = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 3 });
    B.box(w + 0.4, 0.35, d + 0.4, base, { parent: g, x: 0, y: 0, z: 0 });
    B.box(w, h, d, wall, { parent: g, x: 0, y: 0.3, z: 0, surface: 'metal' });
    // door + windows (dark recesses) on the +z face, roof slab with overhang
    const dark = B.flat(0x15130f, { roughness: 0.9 });
    B.box(1.6, 2.3, 0.08, dark, { parent: g, x: -w * 0.2, y: 0.3, z: d / 2 + 0.01, surface: null });
    B.box(1.4, 0.8, 0.08, dark, { parent: g, x: w * 0.25, y: 1.6, z: d / 2 + 0.01, surface: null });
    B.box(w + 0.8, 0.12, d + 0.8, roof, { parent: g, x: 0, y: h + 0.3, z: 0, rz: o.slope || 0.04, surface: 'metal' });
    return y + h + 0.42;
  }
  function crates(B, x, z, n, ry) {
    for (let i = 0; i < n; i++) B.model('crate_wood', { x: x + (i % 2) * 1.05 - 0.5, z: z + Math.floor(i / 2) * 1.05, ry: (ry || 0) + (B.R() - 0.5) * 0.3, h: 1.0 });
    if (n > 2) B.model('crate_wood', { x: x, z: z + 0.4, y: B.h(x, z) + 1.0, ry: 0.4, h: 0.95 });
  }
  function barrels(B, x, z, n) {
    for (let i = 0; i < n; i++) {
      const a = B.R() * PI * 2, r = i ? 0.9 + B.R() * 0.6 : 0;
      const fall = B.R() < 0.25;
      B.model('barrel_hazard', { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, h: 1.0, ry: B.R() * 6, tilt: fall ? [PI / 2, 0] : null, dy: fall ? 0.4 : 0 });
    }
  }
  /** Floodlight mast with a real light (optional). */
  function mast(B, x, z, o) {
    o = o || {};
    const g = B.model('floodlight_post', { x, z, y: o.y, h: o.h || 9, ry: o.ry || 0, tilt: o.tilt });
    if (o.light && g) {
      const s = new THREE.SpotLight(o.color || 0xffd9a0, o.intensity || 350, o.dist || 70, o.angle || 0.6, 0.5, 2);
      const h = (o.h || 9) * 0.97, y = (o.y != null ? o.y : B.h(x, z)) + h;
      s.position.set(x, y, z); s.target.position.set(o.tx != null ? o.tx : x, B.h(x, z), o.tz != null ? o.tz : z - 10);
      B.light(s); B.add(s.target);
      const lamp = B.box(0.9, 0.5, 0.3, B.flat(0x111111, { emissive: new THREE.Color(o.color || 0xffd9a0), emissiveIntensity: 6 }), { x, z, y: y - 0.3, ry: Math.atan2(-(s.target.position.x - x), -(s.target.position.z - z)), surface: null, shadow: false });
      if (o.flicker) {
        let next = 0, on = 1;
        B.anim.push((dt, t) => {
          if (t > next) { on = on ? (Math.random() < 0.3 ? 0 : 1) : 1; next = t + (on ? 0.4 + Math.random() * 3 : 0.04 + Math.random() * 0.15); }
          s.intensity = (o.intensity || 350) * on * (0.92 + Math.random() * 0.08);
          lamp.material.emissiveIntensity = on ? 6 : 0.2;
        });
      }
      return s;
    }
    return null;
  }
  /** Offset a road polyline sideways (positive = right of travel). */
  function offsetLine(pts, off, from, to) {
    const W = L(), P = W.resample(pts, 3).filter(p => (from == null || p.z <= from) && (to == null || p.z >= to)), out = [];
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      out.push({ x: p.x - dz / l * off, z: p.z + dx / l * off });
    });
    return out;
  }
  function fenceAlong(B, key, line, o) {
    const step = 14;
    const P = L().resample(line, step);
    for (let i = 1; i < P.length; i++) B.fenceRun(key, P[i - 1], P[i], o);
  }

  // ================================================================== Gate 3
  function gate3(B) {
    const d = B.d, W = L(), y0 = B.h(0, 0), st = d.stands.gate, floor = st.floor;
    const plaster = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 2.5, rough: 0.9, color: 0xb8b0a0 });
    const concrete = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 3, rough: 0.85 });
    const planks = B.mat('weathered_planks', { tile: 2, rough: 0.9 });
    const rust = B.mat('rusty_metal_02', { tile: 1.5, rough: 0.55, metal: 0.7 });
    const iron = B.mat('corrugated_iron_02', { tile: 2, rough: 0.6, metal: 0.5 });
    const build = () => {
      // gate towers and the walkway the player stands on
      [-1, 1].forEach(s => {
        B.box(3.4, 7.2, 3.6, B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 2.2, rough: 0.9, color: 0xa8a49a }), { x: s * 6.6, z: 0.2, y: y0 - 0.3, surface: 'stone' });
        B.box(3.8, 0.35, 4, concrete, { x: s * 6.6, z: 0.2, y: y0 + 6.9, surface: 'stone' });
        B.box(3.6, 0.6, 0.15, B.flat(0x8a6a1a, { roughness: 0.7 }), { x: s * 6.6, z: -1.62, y: y0 + 1.0, surface: 'stone' });
      });
      B.box(9.8, 0.3, 3.2, planks, { x: 0, z: 0, y: floor - 0.3, surface: 'wood' });
      B.box(9.8, 0.35, 0.25, rust, { x: 0, z: -1.5, y: floor - 0.65, surface: 'metal' });
      B.box(9.8, 0.35, 0.25, rust, { x: 0, z: 1.5, y: floor - 0.65, surface: 'metal' });
      railing(B, -4.8, -1.55, 4.8, -1.55, floor, { mat: rust });
      railing(B, -4.8, 1.55, 4.8, 1.55, floor, { mat: rust });
      // overhead gantry with the park sign
      B.box(17, 0.8, 0.6, rust, { x: 0, z: -0.4, y: y0 + 6.3, surface: 'metal' });
      B.sign({ x: 0, z: -0.75, y: y0 + 5.0, up: 0, posts: 0, w: 9, h: 1.3, logo: true, bg: '#20372a', lines: [{ t: 'IRONFERN ISLAND', size: 66, bold: true }, { t: 'GATE 3  ·  HALCYON BIOTECH', size: 34 }], ry: PI });
      // gate leaves: one swung open, one torn off and lying on the road
      const leaf = (x, z, ry, tilt, y) => {
        const g = new THREE.Group(); g.position.set(x, y != null ? y : y0, z); g.rotation.set(tilt || 0, ry, 0, 'YXZ'); B.add(g);
        B.box(4.4, 0.12, 0.12, rust, { parent: g, x: 2.2, y: 0.1, z: 0 }); B.box(4.4, 0.12, 0.12, rust, { parent: g, x: 2.2, y: 2.2, z: 0 });
        B.box(0.12, 2.3, 0.12, rust, { parent: g, x: 0.05, y: 0, z: 0 }); B.box(0.12, 2.3, 0.12, rust, { parent: g, x: 4.35, y: 0, z: 0 });
        B.box(4.2, 2.0, 0.04, iron, { parent: g, x: 2.2, y: 0.2, z: 0 });
        B.collide(g, 'metal');
      };
      leaf(-4.9, -1.9, -1.25);
      leaf(1.5, -9.5, 0.4, -PI / 2 + 0.06, y0 + 0.1);
      // perimeter wall then chain-link off into the jungle
      [-1, 1].forEach(s => {
        B.box(30, 3.4, 0.5, plaster, { x: s * 23.4, z: 0.6, y: y0 - 0.4, surface: 'stone' });
        B.box(30, 0.2, 0.7, concrete, { x: s * 23.4, z: 0.6, y: y0 + 3.0, surface: 'stone' });
        B.fenceRun('fence_chainlink', { x: s * 38.5, z: 0.6 }, { x: s * 80, z: 2 }, { h: 4, broken: 0.25 });
        B.fenceRun('fence_chainlink', { x: s * 80, z: 2 }, { x: s * 130, z: -4 }, { h: 4, broken: 0.4 });
      });
      // gate clutter
      B.model('sandbags', { x: -2.6, z: -3.4, h: 0.9, ry: 0.1 }); B.model('sandbags', { x: 2.7, z: -3.3, h: 0.9, ry: -0.15 });
      B.model('sandbags', { x: -9.5, z: -2.6, h: 0.9, ry: 0.5 });
      crates(B, 9.2, -3.2, 3, 0.2); barrels(B, -9.8, -4.6, 3);
      B.model('generator', { x: 9.5, z: 3.5, l: 2.1, ry: 1.2 });
      B.model('container_green', { x: -16, z: 7, l: 6, ry: 0.15 });
      // things down the road
      B.model('jeep', { x: -9.2, z: -27, h: 1.85, ry: 2.6, tilt: [0.05, -0.12] });
      B.model('pickup_truck', { x: 10.5, z: -47, h: 1.8, ry: -0.5, tilt: [0.12, 0.22], dy: -0.25 });
      mast(B, 6.8, -36, { h: 8, tilt: [0, 0.22] });
      B.model('sign_construction', { x: 4.6, z: -8, h: 1.5, ry: -0.3 });
      B.sign({ x: 6.0, z: -13, w: 2.4, h: 1.5, up: 1.0, ry: -0.25, bg: '#e8e2cc', fg: '#a01810', lines: [{ t: 'RESTRICTED AREA', size: 52, bold: true }, { t: 'HALCYON BIOTECH STAFF ONLY', size: 30, color: '#222' }, { t: 'NO ENTRY BEYOND GATE 3', size: 30, color: '#222' }] });
      B.sign({ x: -5.6, z: -52, w: 1.3, h: 1.6, up: 1.0, ry: 0.35, tilt: 0.12, bg: '#e8e2cc', fg: '#111', lines: [{ t: 'SPEED', size: 60, bold: true }, { t: 'LIMIT', size: 60, bold: true }, { t: '15', size: 120, bold: true }] });
      B.sign({ x: -6.5, z: -8, w: 1.8, h: 1.2, up: 0.9, ry: 0.4, tilt: -0.2, bg: '#c8a01a', fg: '#111', stripe: '#111', lines: [{ t: 'DANGER', size: 70, bold: true }, { t: 'ANIMAL CROSSING', size: 34, bold: true }] });
    };
    return {
      build,
      terrain: { grassy: 0.05 },
      forest: (x, z) => z > 4 ? 0.85 : 1,
      brush: (x, z) => (Math.abs(x) > 12 && Math.abs(x) < 34 && z < -10 && z > -38) ? 1 : 0,
      grassy: (x, z) => Math.abs(z) < 12 ? 0.35 : 0.12,
      clear: [{ rect: [-12, -40, -5.5, -20] }, { circle: { x: 10.5, z: -47, r: 4 } }, { rect: [-32, -4, 32, 12] }],
      canopy: 560, ferns: 3200, bigleaf: 1300, bushes: 1500, grass: 700, palmy: () => 0.55,
    };
  }

  // ================================================================== Overwatch
  function overwatch(B) {
    // the player stands at the front of the deck (tower centred 1.95 m behind): the legs and roof stay out of the view
    const d = B.d, st = d.stands.tower, g0 = B.h(st.pos.x, st.pos.z), floor = st.floor, sx = st.pos.x, sz = st.pos.z + 1.95;
    const W = L();
    const timber = B.mat('weathered_planks', { tile: 1.6, rough: 0.9, color: 0xa08c78 });
    const iron = B.mat('corrugated_iron_02', { tile: 2, rough: 0.6, metal: 0.5 });
    const build = () => {
      // ranger tower: four legs, X bracing, deck, half walls, roof, ladder
      const hw = 2.1, top = floor + 2.6;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => B.box(0.32, top - g0 + 0.6, 0.32, timber, { x: sx + a * hw, z: sz + b * hw, y: g0 - 0.6, surface: 'wood' }));
      for (let lv = 0; lv < 3; lv++) {
        const ya = g0 + 1 + lv * 4.4, yb = ya + 4.4, len = Math.hypot(4.2, 4.4), ang = Math.atan2(4.4, 4.2);
        [[0, -hw, 0], [0, hw, 0], [-hw, 0, PI / 2], [hw, 0, PI / 2]].forEach(([ox, oz, ry]) => {
          [ang, -ang].forEach(rz => B.box(len, 0.16, 0.12, timber, { x: sx + ox, z: sz + oz, y: (ya + yb) / 2, ry, rz, centred: true, surface: 'wood' }));
        });
        [[0, -hw, 0], [0, hw, 0], [-hw, 0, PI / 2], [hw, 0, PI / 2]].forEach(([ox, oz, ry]) => B.box(4.4, 0.2, 0.16, timber, { x: sx + ox, z: sz + oz, y: ya, ry, surface: 'wood' }));
      }
      B.box(5.0, 0.25, 5.0, timber, { x: sx, z: sz, y: floor - 0.25, surface: 'wood' });
      // half walls on three sides; the front (toward the valley) is an open rail
      B.box(5.0, 1.0, 0.08, timber, { x: sx, z: sz + 2.45, y: floor, surface: 'wood' });
      B.box(0.08, 1.0, 5.0, timber, { x: sx - 2.45, z: sz, y: floor, surface: 'wood' });
      B.box(0.08, 1.0, 5.0, timber, { x: sx + 2.45, z: sz, y: floor, surface: 'wood' });
      railing(B, sx - 2.45, sz - 2.45, sx + 2.45, sz - 2.45, floor, { mat: timber, h: 1.0, step: 2.45 });
      B.box(5.8, 0.12, 5.8, iron, { x: sx, z: sz, y: top, rx: -0.12, surface: 'metal' });
      for (let r = 0; r < 18; r++) B.box(0.6, 0.06, 0.08, timber, { x: sx + 1.2, z: sz + hw + 0.25, y: g0 + 0.4 + r * 0.8, surface: 'wood' });
      [-0.25, 0.25].forEach(o => B.box(0.08, floor - g0, 0.08, timber, { x: sx + 1.2 + o * 2.4, z: sz + hw + 0.25, y: g0, surface: 'wood' }));
      // kit on the deck: radio crate, sandbag on the rail
      B.model('crate_wood', { x: sx + 1.5, z: sz + 1.6, y: floor, h: 0.7, ry: 0.3 });
      B.sign({ x: sx - 3.2, z: sz - 3.0, w: 2.6, h: 1.4, up: 0.8, ry: 0.15, logo: true, bg: '#25402e', lines: [{ t: 'RANGER STATION 4', size: 46, bold: true }, { t: 'VALLEY OBSERVATION', size: 30 }, { t: 'HALCYON BIOTECH', size: 26 }] });
      shed(B, sx + 9, sz + 10, 4.5, 3.6, 2.6, { ry: -0.3, wall: 'weathered_planks', tint: 0x9a8a78 });
      barrels(B, sx + 6, sz + 6, 2);
      // the survivors: a jeep on its side with a flare burning beside it
      const sv = d.points.survivors;
      B.model('jeep', { x: sv.x, z: sv.z, h: 1.85, ry: 0.9, tilt: [0.1, 1.35], dy: 0.25 });
      B.model('crate_wood', { x: sv.x + 2.4, z: sv.z + 1.6, h: 0.6, ry: 0.5, tilt: [0, 0.4] });
      const fx = sv.x + 2.8, fz = sv.z + 2.4, fy = B.h(fx, fz);
      const flareMat = B.flat(0x300404, { emissive: new THREE.Color(0xff2a12), emissiveIntensity: 40 });
      B.cyl(0.04, 0.04, 0.28, flareMat, { x: fx, z: fz, y: fy, rz: 0.6, surface: null, shadow: false });
      const fl = B.light(new THREE.PointLight(0xff3a1a, 60, 28, 2)); fl.position.set(fx, fy + 0.4, fz);
      const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,120,80,1)'); gr.addColorStop(0.25, 'rgba(255,40,10,0.6)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return B.own(new THREE.CanvasTexture(c)); })();
      const spr = new THREE.Sprite(B.own(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
      spr.position.set(fx, fy + 0.3, fz); spr.scale.setScalar(2.2); B.add(spr);
      // drifting flare smoke: a few soft billboards
      const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,190,180,0.55)'); gr.addColorStop(1, 'rgba(255,190,180,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return B.own(new THREE.CanvasTexture(c)); })();
      const puffs = [];
      for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(B.own(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0xe0b0a8 }))); B.add(s); puffs.push({ s, t: i / 14 }); }
      B.anim.push((dt, t) => {
        fl.intensity = 50 + Math.sin(t * 31) * 8 + Math.random() * 14; spr.scale.setScalar(2 + Math.random() * 0.5);
        puffs.forEach(p => { p.t = (p.t + dt * 0.09) % 1; const k = p.t; p.s.position.set(fx + k * 5 + Math.sin(k * 9 + t) * 0.3, fy + 0.4 + k * 9, fz - k * 2); p.s.scale.setScalar(0.6 + k * 5); p.s.material.opacity = (1 - k) * 0.5; });
      });
      // an old pasture fence across the valley, mostly down
      B.fenceRun('fence_chainlink_post', { x: -85, z: -100 }, { x: 85, z: -104 }, { h: 2.4, broken: 0.75, gaps: [{ x: -38, z: -101, r: 14 }, { x: 0, z: -102, r: 10 }] });
      B.sign({ x: -48, z: -98, w: 1.6, h: 1.0, up: 0.8, ry: 0.2, tilt: 0.3, bg: '#c8a01a', fg: '#111', stripe: '#111', lines: [{ t: 'HERBIVORE', size: 50, bold: true }, { t: 'PASTURE', size: 50, bold: true }] });
      mast(B, -14, -10, { h: 9, tilt: [0.1, -0.15] });
    };
    const edge = (x, z) => { const n = W.fbm(x / 40, z / 40, 7, 3) * 18; return Math.max(W.smooth(92 + n, 108 + n, Math.abs(x)), W.smooth(-222 - n, -238 - n, z), W.smooth(-16, -4, z)); };
    return {
      build,
      terrain: { grassy: 0.6, tintGrass: 0x7a9050, grassFn: (x, z) => 1 - edge(x, z) * 0.7 },
      forest: edge,
      grassy: (x, z) => {
        const along = W.distToPolyline(x, z, d.spawns.stalkA.path).d < 14 ? 0.9 : 0;
        const patch = W.smooth(0.15, 0.45, W.fbm(x / 30, z / 30, 9, 3));
        const herd = Math.hypot(x - d.herdC.x, z - d.herdC.z) < 32 ? 0.05 : 1;
        return (1 - edge(x, z)) * Math.max(along, patch * 0.7) * herd;
      },
      // keep the sightline from the tower into the valley open
      clear: [{ circle: { x: 0, z: 4, r: 7 } }, { poly: [{ x: 0, z: 0 }, { x: -6, z: -40 }], r: 16 }, { poly: [{ x: -2, z: -5 }, { x: -30, z: -40 }], r: 10 }],
      rockPile: [{ x: 88, z: -112, rot: 0.5, s: 3.2 }, { x: 96, z: -124, rot: 2, s: 4.2 }, { x: 84, z: -128, rot: 4, s: 2.6 }, { x: 101, z: -108, rot: 1, s: 3.6 }, { x: 79, z: -119, rot: 3, s: 1.8 }].map(r => Object.assign(r, { sx: 1.3 })),
      lone: 14, canopy: 700, ferns: 1800, bigleaf: 700, bushes: 1100, grass: 7000, rocks: 160,
      palmy: (x, z) => z > -20 ? 0.7 : 0.35,
    };
  }

  // ================================================================== The Pens
  function pens(B) {
    const d = B.d, W = L(), road = d.roads[0].pts, br = d.bridge;
    const concrete = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 2.5 });
    const rust = B.mat('rusty_metal_02', { tile: 1.5, rough: 0.55, metal: 0.7 });
    const planks = B.mat('weathered_planks', { tile: 2, rough: 0.85 });
    let jeep = null;
    const build = () => {
      // paddock fences both sides of the road from the gate to the river
      const left = offsetLine(road, -7.5, 28, -96), right = offsetLine(road, 7.5, 28, -96);
      const gapsL = [{ x: -7.5, z: -12, r: 5 }], gapsR = [{ x: 7.5, z: -10, r: 5 }];
      fenceAlong(B, 'fence_chainlink', left, { h: 4.6, broken: 0.22, gaps: gapsL.concat([{ x: -7.5, z: -9, r: 2.5 }]) });
      fenceAlong(B, 'fence_chainlink', right, { h: 4.6, broken: 0.22, gaps: gapsR.concat([{ x: 7.5, z: -9, r: 2.5 }]) });
      // outer paddock boundaries
      B.fenceRun('fence_chainlink', { x: -7.5, z: 28 }, { x: -70, z: 30 }, { h: 4.6, broken: 0.3 });
      B.fenceRun('fence_chainlink', { x: 7.5, z: 28 }, { x: 70, z: 30 }, { h: 4.6, broken: 0.3 });
      B.fenceRun('fence_chainlink', { x: -70, z: 30 }, { x: -75, z: -90 }, { h: 4.6, broken: 0.35 });
      B.fenceRun('fence_chainlink', { x: 70, z: 30 }, { x: 78, z: -85 }, { h: 4.6, broken: 0.35 });
      // the paddock gate at pens1: concrete pillars, one leaf hanging, one flat in the mud
      [-1, 1].forEach(s => { B.box(1.2, 5.6, 1.2, concrete, { x: s * 4.4, z: -9, surface: 'stone' }); B.box(1.5, 0.3, 1.5, concrete, { x: s * 4.4, z: -9, y: B.h(s * 4.4, -9) + 5.5, surface: 'stone' }); });
      B.box(10, 0.6, 0.5, rust, { x: 0, z: -9, y: B.h(0, -9) + 5.2, rz: 0.05, surface: 'metal' });
      B.sign({ x: 0, z: -8.6, y: B.h(0, -9) + 3.8, up: 0, posts: 0, w: 4.4, h: 1.1, bg: '#c8a01a', fg: '#111', stripe: '#111', lines: [{ t: 'PADDOCK R-7', size: 64, bold: true }], ry: 0 });
      B.sign({ x: 3.0, z: -9.4, y: B.h(3, -9) + 2.2, up: 0, posts: 0, w: 2.6, h: 1.3, bg: '#e8e2cc', fg: '#a01810', lines: [{ t: 'CARNIVORE CONTAINMENT', size: 40, bold: true }, { t: 'KEEP GATE CLOSED', size: 40, color: '#222' }, { t: 'HALCYON BIOTECH', size: 28, color: '#222' }] });
      const leaf = new THREE.Group(); leaf.position.set(-3.9, B.h(-3.9, -9), -9.3); leaf.rotation.set(0, -1.1, 0.25, 'YXZ'); B.add(leaf);
      B.box(3.8, 4.2, 0.08, B.mat('container_side', { tile: 2.5, rough: 0.6, metal: 0.4, color: 0x9a9a90 }), { parent: leaf, x: 1.9, y: 0.3, z: 0 }); B.collide(leaf, 'metal');
      B.box(3.8, 0.1, 4.2, rust, { x: 2.8, z: -15, y: B.h(2.8, -15) + 0.05, ry: 0.35, rx: 0.06, surface: 'metal' });
      B.sign({ x: -9.5, z: -24, w: 1.5, h: 1.0, up: 0.6, ry: 0.4, tilt: 0.35, bg: '#c8a01a', fg: '#111', stripe: '#111', lines: [{ t: 'DANGER', size: 64, bold: true }, { t: 'HIGH VOLTAGE', size: 34, bold: true }] });
      mast(B, -9.5, 4, { h: 9, tilt: [0, 0.1] }); mast(B, 9.5, -40, { h: 9 });
      B.model('pickup_truck', { x: 30, z: -40, h: 1.8, ry: 2.2, tilt: [0, 1.4], dy: 0.6 });
      crates(B, -20, -40, 4, 0.5);
      // bridge: arched deck in segments, steel railings, girders, piers
      const N = 12, deckW = 5.4;
      for (let i = 0; i < N; i++) {
        const za = br.z0 + (br.z1 - br.z0) * i / N, zb = br.z0 + (br.z1 - br.z0) * (i + 1) / N;
        const ya = d.deckY(br.x, za + (i ? 0 : -0.3)), yb = d.deckY(br.x, zb + (i === N - 1 ? 0.3 : 0)), zm = (za + zb) / 2, len = Math.abs(zb - za) + 0.05;
        const ang = Math.atan2(yb - ya, Math.abs(zb - za));
        B.box(deckW, 0.3, len, planks, { x: br.x, z: zm, y: (ya + yb) / 2 - 0.15, centred: true, rx: ang, surface: 'wood' });
        B.box(0.3, 0.8, len, rust, { x: br.x - deckW / 2 + 0.15, z: zm, y: (ya + yb) / 2 - 0.65, centred: true, rx: ang, surface: 'metal' });
        B.box(0.3, 0.8, len, rust, { x: br.x + deckW / 2 - 0.15, z: zm, y: (ya + yb) / 2 - 0.65, centred: true, rx: ang, surface: 'metal' });
      }
      [-1, 1].forEach(s => {
        const xr = br.x + s * (deckW / 2 - 0.1);
        for (let i = 0; i <= 12; i++) { const z = br.z0 + (br.z1 - br.z0) * i / 12; B.box(0.08, 1.1, 0.08, rust, { x: xr, z, y: d.deckY(br.x, z), surface: 'metal' }); }
        for (let i = 0; i < 6; i++) {
          const za = br.z0 + (br.z1 - br.z0) * i / 6, zb = br.z0 + (br.z1 - br.z0) * (i + 1) / 6, ya = d.deckY(br.x, za) + 1.05, yb = d.deckY(br.x, zb) + 1.05;
          if (s > 0 && i === 3) continue; // a gap where something went through
          B.box(0.07, 0.07, Math.abs(zb - za), rust, { x: xr, z: (za + zb) / 2, y: (ya + yb) / 2, centred: true, rx: Math.atan2(yb - ya, Math.abs(zb - za)), surface: 'metal' });
        }
      });
      [-124, -136].forEach(z => { const top = d.deckY(br.x, z) - 1.0, bot = d.river.level - 3.5; B.box(deckW - 0.6, top - bot, 1.4, concrete, { x: br.x, z, y: bot, surface: 'stone' }); });
      B.sign({ x: br.x + 3.6, z: br.z0 + 2, w: 1.6, h: 0.9, up: 0.9, ry: -0.3, bg: '#e8e2cc', fg: '#111', lines: [{ t: 'BRIDGE 2', size: 56, bold: true }, { t: 'MAX 8 TONNES', size: 36 }] });
      // feeding station
      const ly = 7.2;
      shed(B, -15, -238, 10, 12, 4.4, { y: ly - 0.2, tint: 0xc8c0b0 });
      shed(B, -16, -258, 12, 12, 4.6, { y: ly - 0.2, tint: 0x9a9a8a });
      shed(B, 15, -238, 10, 12, 4.4, { y: ly - 0.2, tint: 0xe0dccf });
      shed(B, 12.5, -257, 12, 12, 4.6, { y: ly - 0.2 });
      // the hoist frame over the road end, with a chain and hook
      [-1, 1].forEach(s => B.box(0.4, 7, 0.4, rust, { x: s * 5, z: -266, y: ly - 0.2, surface: 'metal' }));
      B.box(10.6, 0.5, 0.5, rust, { x: 0, z: -266, y: ly + 6.6, surface: 'metal' });
      B.box(0.05, 3.2, 0.05, B.flat(0x2a2620, { metalness: 0.8, roughness: 0.4 }), { x: 0.8, z: -266, y: ly + 3.5, surface: null });
      B.model('container_green', { x: -6, z: -272, l: 6.1, ry: 0.1, y: ly });
      B.model('container_green', { x: -6.2, z: -272.2, l: 6.1, ry: 0.06, y: ly + 2.6 });
      B.model('generator', { x: 7.5, z: -246, l: 2.1, ry: -1.4, y: ly });
      barrels(B, -7.5, -247, 4); crates(B, 6.5, -232, 4, -0.2);
      B.model('barrels_oil', { x: 8.5, z: -268, h: 1.2, ry: 0.4, y: ly });
      B.sign({ x: -5.2, z: -231, y: ly, w: 2.8, h: 1.4, up: 1.0, ry: 0.25, logo: true, bg: '#20372a', lines: [{ t: 'FEEDING STATION C', size: 44, bold: true }, { t: 'AUTHORISED STAFF ONLY', size: 30 }] });
      mast(B, -5.5, -262, { h: 9, y: ly }); mast(B, 5.5, -228, { h: 9 });
      // the player's jeep: rides under the camera
      jeep = B.model('jeep', { x: 0, z: 0, h: 1.55, collide: false });
      if (jeep) { jeep.traverse(o => { if (o.isMesh) o.castShadow = true; }); jeep.userData.prev = null; jeep.userData.noMerge = true; }
      let heading = 0;
      B.anim.push((dt, t, ctx) => {
        if (!jeep) return;
        const p = ctx.view.pos, prev = jeep.userData.prev;
        if (prev) { const dx = p.x - prev.x, dz = p.z - prev.z; if (dx * dx + dz * dz > 1e-5) heading = Math.atan2(-dx, -dz); }
        else heading = ctx.view.stand.yaw;
        jeep.userData.prev = { x: p.x, z: p.z };
        const f = W.yawDir(heading), jx = p.x + f.x * 1.45, jz = p.z + f.z * 1.45;
        const gy = Math.max(B.h(jx, jz), d.deckY(jx, jz) || -99);
        jeep.position.set(jx, gy, jz);
        jeep.rotation.set(0, heading + PI, 0);
      });
    };
    const paddock = (x, z) => z < 26 && z > -92 && Math.abs(x) > 8 && Math.abs(x) < 72;
    return {
      build, followShadow: true,
      terrain: { grassy: 0.15, wet: 0.35, grassFn: (x, z) => paddock(x, z) ? 1.6 : 0.6 },
      forest: (x, z) => paddock(x, z) ? 0.4 : (z < -225 && z > -270 && Math.abs(x) < 34) ? 0 : 1,
      grassy: (x, z) => paddock(x, z) ? 0.9 : 0.1,
      scrub: (x, z) => paddock(x, z) ? 0.5 : 0,
      clear: [{ rect: [-28, -275, 28, -228] }, { circle: { x: 30, z: -40, r: 5 } }, { rect: [14, -152, 26, -108] }],
      canopy: 760, ferns: 3200, bigleaf: 1300, bushes: 1500, grass: 1400,
      palmy: (x, z) => (z < -100 && z > -160) ? 0.85 : 0.45,
    };
  }

  // ================================================================== Horn and Plate
  function horn(B) {
    const d = B.d, W = L(), st = d.stands.field;
    const build = () => {
      const by = st.floor;
      for (let i = -2; i <= 2; i++) B.model('concrete_barrier', { x: i * 1.72, z: -1.1, h: 1.05, ry: (B.R() - 0.5) * 0.04, y: B.h(i * 1.72, -1.1) - 0.03, surface: 'stone' });
      B.model('concrete_barrier', { x: -5.2, z: -0.2, h: 1.05, ry: 0.5, surface: 'stone' });
      B.model('concrete_barrier', { x: 5.3, z: -0.4, h: 1.05, ry: -0.55, tilt: [0, 0.08], surface: 'stone' });
      B.model('sandbags', { x: -7.2, z: 1.4, h: 0.9, ry: 0.9 }); B.model('sandbags', { x: 7.3, z: 1.0, h: 0.9, ry: -1.0 });
      crates(B, -2.4, 2.8, 3, 0.1);
      B.model('jeep', { x: 4.5, z: 8.5, h: 1.85, ry: 0.4 });
      mast(B, -8, 5, { h: 9, ry: 0.4 });
      B.sign({ x: -9.5, z: -4, w: 2.4, h: 1.3, up: 0.9, ry: 0.5, logo: true, bg: '#25402e', lines: [{ t: 'PASTURE 2', size: 56, bold: true }, { t: 'LARGE HERBIVORES', size: 32 }, { t: 'STAY IN YOUR VEHICLE', size: 26 }] });
      // the field: an overturned truck, a trough, old fence posts, dead trees away from the lanes
      B.model('pickup_truck', { x: 34, z: -70, h: 1.8, ry: 1.1, tilt: [0, PI * 0.95], dy: 1.75 });
      B.model('jeep', { x: -38, z: -112, h: 1.85, ry: -0.6, tilt: [0.2, 1.5], dy: 0.3 });
      B.box(4, 0.7, 1.2, B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 2 }), { x: -22, z: -88, ry: 0.4, surface: 'stone' });
      B.fenceRun('fence_chainlink_post', { x: -100, z: -150 }, { x: 100, z: -146 }, { h: 2.4, broken: 0.6 });
      B.fenceRun('fence_barrier_large', { x: -28, z: 14 }, { x: -12, z: 12 }, { h: 3, broken: 0.3 });
      B.fenceRun('fence_barrier_large', { x: 12, z: 12 }, { x: 30, z: 15 }, { h: 3, broken: 0.3 });
    };
    const edge = (x, z) => { const n = W.fbm(x / 35, z / 35, 3, 3) * 14; return Math.max(W.smooth(88 + n, 104 + n, Math.abs(x)), W.smooth(-150 - n, -168 - n, z), W.smooth(18, 32, z)); };
    const scrubZone = (x, z) => (Math.abs(x) > 26 && Math.abs(x) < 58 && z < 2 && z > -34) ? 1 : 0;
    return {
      build,
      terrain: { grassy: 0.75, tintGrass: 0x7a9050, grassFn: (x, z) => 1 - edge(x, z) * 0.6 },
      forest: edge,
      scrub: scrubZone,
      brush: (x, z) => scrubZone(x, z) * 0.6,
      grassy: (x, z) => (1 - edge(x, z)) * (0.25 + 0.6 * W.smooth(0.0, 0.4, W.fbm(x / 25, z / 25, 4, 3))),
      clear: [{ circle: { x: 0, z: 2, r: 10 } }, { circle: { x: 34, z: -70, r: 5 } }, { circle: { x: -38, z: -112, r: 4 } }],
      lone: 10, canopy: 650, ferns: 1400, bigleaf: 500, bushes: 1300, grass: 6500, rocks: 120,
      palmy: () => 0.4,
    };
  }

  // ================================================================== Apex
  function apex(B) {
    const d = B.d, W = L(), top = d.top, C = d.plazaC;
    const concrete = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 2.5, rough: 0.8 });
    const plaster = B.mat('concrete_floor_worn_001', { moss: 0.22, tile: 3, rough: 0.9, color: 0xc4b8a4 });
    const brick = B.mat('brick_wall_001', { moss: 0.22, tile: 2.5, rough: 0.9 });
    const rust = B.mat('rusty_metal_02', { tile: 1.5, rough: 0.55, metal: 0.7 });
    const glass = B.flat(0x1a2228, { roughness: 0.08, metalness: 0.2, envMapIntensity: 1.5 });
    const build = () => {
      // plaza paving (cracked concrete over the flat pad)
      const pave = new THREE.Mesh(B.own(new THREE.PlaneGeometry(84, 64, 1, 1)), B.mat('asphalt_02', { tile: 6, rough: 0.92, color: 0x9a9284 }));
      pave.rotation.x = -PI / 2; pave.position.set(0, 0.03, -43); pave.receiveShadow = true; B.add(pave); B.collide(pave, 'stone');
      const geo = pave.geometry, uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 84, uv.getY(i) * 64);
      // steps up to the visitor centre (16 risers) and the landing the player stands on
      const n = 16, z0 = -11.2, z1 = -3, run = (z1 - z0) / n, rise = top / n;
      for (let i = 0; i < n; i++) B.box(22, (i + 1) * rise, z1 - (z0 + i * run) + 0.02, concrete, { x: 0, z: (z0 + i * run + z1) / 2, y: 0, surface: 'stone' });
      B.box(30, 0.1, 6, concrete, { x: 0, z: -0.2, y: top - 0.08, surface: 'stone' });
      [-1, 1].forEach(s => { B.box(1.2, top + 0.9, 8.6, brick, { x: s * 11.6, z: -7.1, y: 0, surface: 'stone' }); });
      railing(B, -14.5, -3.0, -11.6, -3.0, top); railing(B, 11.6, -3.0, 14.5, -3.0, top);
      // the visitor centre: concrete frame, tall glass front (some panes gone), a portico
      const by = top;
      B.box(56, 13, 30, plaster, { x: 0, z: 17, y: by - 0.5, surface: 'stone' });
      B.box(58, 0.8, 32, concrete, { x: 0, z: 17, y: by + 12.5, surface: 'stone' });
      for (let i = -3; i <= 3; i++) B.box(1.0, 11.5, 1.0, concrete, { x: i * 5.2, z: 1.7, y: by, surface: 'stone' });
      for (let i = -3; i < 3; i++) if (i !== -1) B.box(4.2, 10.6, 0.1, glass, { x: i * 5.2 + 2.6, z: 1.95, y: by + 0.2, surface: 'metal' });
      B.box(4.2, 2.6, 0.1, glass, { x: -2.6, z: 1.95, y: by + 8.2, surface: 'metal' });
      B.box(34, 0.5, 4, concrete, { x: 0, z: 0.2, y: by + 11.5, surface: 'stone' });
      B.sign({ x: 0, z: -1.9, y: by + 12.1, up: 0, posts: 0, w: 16, h: 1.8, ry: PI, logo: true, bg: '#1d2f26', lines: [{ t: 'HALCYON VISITOR CENTRE', size: 62, bold: true }, { t: 'IRONFERN ISLAND', size: 32 }] });
      const warm = B.flat(0x221a10, { emissive: new THREE.Color(0xffa850), emissiveIntensity: 1.6 });
      B.box(3.6, 2.0, 0.05, warm, { x: 7.8, z: 2.05, y: by + 6.6, surface: null, shadow: false });
      // wings: the right one has the balcony the raptors use
      const wing = (s) => {
        const xc = s * 21.5;
        B.box(17, 9, 17, s > 0 ? plaster : brick, { x: xc, z: -17.5, y: -0.4, surface: 'stone' });
        B.box(18, 0.5, 18, concrete, { x: xc, z: -17.5, y: 8.6, surface: 'stone' });
        for (let k = 0; k < 3; k++) B.box(0.1, 2.0, 1.6, glass, { x: s * 12.95, z: -12 - k * 5, y: 5.6, surface: 'metal' });
      };
      wing(1); wing(-1);
      B.box(2.8, 0.25, 11, concrete, { x: 11.6, z: -17, y: 4.35, surface: 'stone' });
      railing(B, 10.3, -11.6, 10.3, -15, 4.6); railing(B, 10.3, -19.5, 10.3, -22.4, 4.6, { h: 0.9 });
      B.box(0.06, 0.06, 4.6, rust, { x: 10.1, z: -17.4, y: 4.2, rx: 0.5, centred: true, surface: 'metal' });
      [-12, -22].forEach(z => B.box(0.25, 4.3, 0.25, concrete, { x: 10.4, z, y: 0, surface: 'stone' }));
      B.box(1.2, 2.4, 0.1, B.flat(0x0e0c0a), { x: 12.96, z: -17.5, y: 4.6, ry: PI / 2, surface: null });
      // fountain: a dry ring with stagnant water and a broken centre column
      const ring = new THREE.Mesh(B.own(new THREE.TorusGeometry(4.2, 0.35, 8, 40)), concrete); ring.rotation.x = PI / 2; ring.position.set(C.x, 0.35, C.z); ring.castShadow = ring.receiveShadow = true; B.add(ring); B.collide(ring, 'stone');
      const pool = new THREE.Mesh(B.own(new THREE.CircleGeometry(4.0, 32)), B.flat(0x1c2018, { roughness: 0.05 })); pool.rotation.x = -PI / 2; pool.position.set(C.x, 0.2, C.z); B.add(pool);
      B.cyl(0.6, 0.8, 2.4, concrete, { x: C.x, z: C.z, rz: 0.06, surface: 'stone' });
      // main gate: two pillars, a hanging crossbeam, leaves smashed in
      [-1, 1].forEach(s => { B.box(2.4, 10, 2.4, brick, { x: s * 6.4, z: -75, surface: 'stone' }); B.box(3, 0.6, 3, concrete, { x: s * 6.4, z: -75, y: B.h(s * 6.4, -75) + 10, surface: 'stone' }); });
      const beam = new THREE.Group(); beam.position.set(6.4, B.h(6.4, -75) + 9.2, -75); beam.rotation.z = -0.55; B.add(beam);
      B.box(13, 1.4, 0.5, B.mat('weathered_planks', { tile: 2, color: 0x8a7050 }), { parent: beam, x: -6.5, y: -0.7, z: 0, centred: true });
      B.collide(beam, 'wood');
      B.sign({ x: 2.5, z: -74.6, y: B.h(0, -75) + 6.6, up: 0, posts: 0, w: 6, h: 1.2, tilt: -0.55, ry: 0, bg: '#5a3a1a', fg: '#e8c870', lines: [{ t: 'IRONFERN', size: 80, bold: true }] });
      B.box(5.4, 0.15, 7.5, B.mat('weathered_planks', { tile: 2, color: 0x7a6048 }), { x: 2.6, z: -66, y: 0.05, ry: 0.35, rz: 0.05, surface: 'wood' });
      const hang = new THREE.Group(); hang.position.set(-5.2, B.h(-5.2, -75), -75.2); hang.rotation.set(0.12, 0.9, 0, 'YXZ'); B.add(hang);
      B.box(5.2, 6.2, 0.2, B.mat('weathered_planks', { tile: 2, color: 0x7a6048 }), { parent: hang, x: 2.6, y: 0.4, z: 0 }); B.collide(hang, 'wood');
      // perimeter wall with breaches
      [[-44, -8.6], [8.6, 44]].forEach(([a, b]) => {
        const len = b - a, cx = (a + b) / 2;
        B.box(len, 4.2, 0.8, brick, { x: cx, z: -75.5, y: -0.3, surface: 'stone' });
      });
      // dusk lamps (one failing) and plaza clutter
      mast(B, -30, -16, { h: 10, ry: -0.8, light: true, tx: -6, tz: -38, intensity: 420, dist: 80, angle: 0.65 });
      mast(B, 30, -64, { h: 10, ry: 2.4, light: true, tx: 6, tz: -46, intensity: 420, dist: 80, angle: 0.65, flicker: true });
      mast(B, -30, -66, { h: 10, ry: -2.2, light: true, tx: -4, tz: -60, intensity: 320, dist: 70, angle: 0.6 });
      B.model('jeep', { x: -19, z: -52, h: 1.85, ry: 2.4, tilt: [0.1, PI * 0.5], dy: 0.9 });
      B.model('pickup_truck', { x: 22, z: -44, h: 1.8, ry: -0.9 });
      crates(B, -24, -28, 4, 0.3); barrels(B, 24, -64, 3);
      B.model('sign_construction', { x: -6, z: -14, h: 1.5, ry: 0.4, tilt: [0, 1.3], dy: 0.2 });
      B.sign({ x: 16, z: -32, w: 2.2, h: 1.2, up: 1.0, ry: -0.9, tilt: 0.25, logo: true, bg: '#20372a', lines: [{ t: 'WELCOME', size: 54, bold: true }, { t: 'TOURS DEPART HOURLY', size: 28 }] });
      // planters with palms along the plaza sides
      const planters = [];
      [-1, 1].forEach(s => { for (let k = 0; k < 4; k++) { const x = s * 33, z = -20 - k * 15; B.box(3, 0.7, 3, concrete, { x, z, y: 0, surface: 'stone' }); planters.push({ x, z, y: 0.6, rot: B.R() * 6, s: 9 + B.R() * 4, tilt: [(B.R() - 0.5) * 0.2, (B.R() - 0.5) * 0.2] }); } });
      B.instances('palm_tree', planters, { trunkH: 0.7 });
      B.instances('palm_coconut', [{ x: 14, z: -56, y: 0, rot: 1.2, s: 13, tilt: [1.35, 0.1] }], { trunkH: 0.1 }); // a fallen palm
      // weeds in the paving cracks
      const weeds = W.scatter({ seed: 77, count: Math.round(260 * B.q), bounds: [-40, -73, 40, -12], minDist: 1.2, scale: [0.35, 0.8], exclude: [{ circle: { x: C.x, z: C.z, r: 5 } }] });
      B.instances('grass_tall', weeds.map(p => ({ x: p.x, z: p.z, y: 0.02, rot: p.rot, s: p.s, sx: 1.3 })), { shadow: false });
      B.instances('fern', weeds.filter((p, i) => i % 5 === 0).map(p => ({ x: p.x + 0.5, z: p.z, y: 0.02, rot: p.rot, s: 0.6, sx: 1 })), { shadow: false });
    };
    const inside = (x, z) => z > -80 && z < 34 && Math.abs(x) < 46;
    return {
      build,
      terrain: { grassy: 0.15, tintLeaves: 0xb0a898, wet: 0.15 },
      forest: (x, z) => inside(x, z) ? 0 : 1,
      grassy: (x, z) => inside(x, z) ? 0 : 0.2,
      clear: [{ rect: [-47, -80, 47, 35] }],
      canopy: 560, ferns: 2400, bigleaf: 900, bushes: 1100, grass: 400,
      palmy: () => 0.6,
    };
  }

  DH.WorldSets = { gate3, overwatch, pens, horn, apex };
})();
