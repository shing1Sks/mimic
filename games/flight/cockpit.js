/*
 * GYROWING cockpit: the inside of the aircraft for the cockpit view. A shaped instrument panel in
 * powder-coated grey with chrome-bezelled gauges, a radio stack, switch row and annunciators (one
 * live canvas: the static parts are painted once, the needles redrawn 15 times a second with the
 * HUD's gauge code), a leather glareshield hood with a wet compass, curved painted windshield
 * pillars, two-tone side trim, ram's-horn yokes on chrome shafts that follow the controls, and a
 * throttle quadrant whose throttle moves. Body frame: forward -Z, up +Y, right +X.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const D2R = Math.PI / 180;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // eye point (left seat) and the panel plane
  const EYE = new THREE.Vector3(-0.27, 0.93, 0.08);
  const PANEL = { w: 1.12, h: 0.46, y: 0.47, z: -0.74, tilt: -0.2 };
  const CW = 1120, CH = 460;   // canvas px: 1 px = 1 mm

  // ---------------------------------------------------------------- procedural textures
  function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** Leather / vinyl grain: a soft mottled base with fine pores (also used as its own bump map). */
  function grainTex(base, seed, rep) {
    const r = rng(seed);
    const c = canvas(256, 256, (x, w, h) => {
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) { const g = x.createRadialGradient(0, 0, 0, 0, 0, 1); const a = 0.05 * r(); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.save(); x.translate(r() * w, r() * h); x.scale(6 + r() * 18, 6 + r() * 18); x.fillStyle = g; x.fillRect(-1, -1, 2, 2); x.restore(); }
      for (let i = 0; i < 5000; i++) { x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.06)'; x.fillRect(r() * w, r() * h, 1 + r(), 1 + r()); }
    });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep || 4, rep || 4); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  /** Woven headliner / carpet fabric. */
  function weaveTex(base, seed) {
    const r = rng(seed);
    const c = canvas(128, 128, (x, w, h) => {
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { x.fillStyle = `rgba(0,0,0,${0.05 + 0.05 * r()})`; x.fillRect(0, y, w, 1); }
      for (let xx = 0; xx < w; xx += 2) { x.fillStyle = `rgba(255,255,255,${0.02 + 0.03 * r()})`; x.fillRect(xx, 0, 1, h); }
      for (let i = 0; i < 900; i++) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(r() * w, r() * h, 1, 1); }
    });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  // ---------------------------------------------------------------- geometry helpers
  /** A rounded-rectangle slab (w x h, depth d, corner radius r, bevel b), centred, extruded along +z. */
  function slab(w, h, d, r, b) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: !!b, bevelThickness: b || 0, bevelSize: b || 0, bevelSegments: 2, curveSegments: 5 });
    g.translate(0, 0, -d / 2);
    return g;
  }
  /** A smooth surface from f(u, v) -> Vector3 over a nu x nv grid (normals computed). */
  function sheet(f, nu, nv, uvScale) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = f(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu * (uvScale ? uvScale[0] : 1), j / nv * (uvScale ? uvScale[1] : 1)); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const tube = (pts, r, seg, rad) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg || 24, r, rad || 10, false);

  function build(plane) {
    const group = plane.parts.cockpit;
    // ---- materials
    const leatherT = grainTex('#2b2826', 7, 5);
    const leather = new THREE.MeshStandardMaterial({ map: leatherT, bumpMap: leatherT, bumpScale: 0.0015, roughness: 0.72, metalness: 0.0, color: lin('#9a948e'), side: THREE.DoubleSide });
    const trimT = grainTex('#857d72', 11, 3);
    const trimTan = new THREE.MeshStandardMaterial({ map: trimT, bumpMap: trimT, bumpScale: 0.001, roughness: 0.8, color: lin('#cfc8be'), side: THREE.DoubleSide });
    const darkTrim = new THREE.MeshStandardMaterial({ map: leatherT, roughness: 0.85, color: lin('#5f5b57') });
    const fabric = new THREE.MeshStandardMaterial({ map: weaveTex('#8f8c86', 3), roughness: 0.95, side: THREE.DoubleSide });
    const carpet = new THREE.MeshStandardMaterial({ map: weaveTex('#2c2d30', 5), roughness: 1 });
    const paint = new THREE.MeshStandardMaterial({ color: lin('#a9a59d'), roughness: 0.6, metalness: 0.0 });
    const panelEdge = new THREE.MeshStandardMaterial({ color: lin('#1e2124'), roughness: 0.55, metalness: 0.2 });
    const chrome = new THREE.MeshStandardMaterial({ color: lin('#d8dde2'), roughness: 0.18, metalness: 1.0 });
    const rubber = new THREE.MeshStandardMaterial({ color: lin('#141516'), roughness: 0.9 });
    const plastic = new THREE.MeshStandardMaterial({ color: lin('#1b1c1e'), roughness: 0.4 });

    // ---- the panel: a shaped slab whose face is the live canvas
    const cnv = document.createElement('canvas'); cnv.width = CW; cnv.height = CH;
    const tex = new THREE.CanvasTexture(cnv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    tex.repeat.set(1 / PANEL.w, 1 / PANEL.h); tex.offset.set(0.5, 0.5);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const panel = new THREE.Group();
    panel.position.set(0, PANEL.y, PANEL.z); panel.rotation.x = PANEL.tilt;
    const slabG = slab(PANEL.w, PANEL.h, 0.05, 0.035, 0.008); slabG.translate(0, 0, -0.025);
    panel.add(new THREE.Mesh(slabG, [faceMat, panelEdge]));
    group.add(panel);
    // knee fascia under the panel, and the floor
    const fascia = new THREE.Mesh(slab(1.16, 0.17, 0.16, 0.05, 0.012), darkTrim);
    fascia.position.set(0, PANEL.y - PANEL.h / 2 - 0.07, PANEL.z + 0.05); fascia.rotation.x = -0.35; group.add(fascia);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.8).rotateX(-Math.PI / 2), carpet); floor.position.set(0, 0.0, -0.2); group.add(floor);

    // ---- glareshield: a leather hood with a crowned top and a rolled lip over the panel
    const lipY = PANEL.y + PANEL.h / 2 + 0.03, lipZ = PANEL.z + 0.05;
    const hood = sheet((u, v) => {
      const x = (u - 0.5) * 1.16, crown = 0.025 * (1 - Math.pow(x / 0.58, 2));
      const z = lipZ - v * 0.36, y = lipY + crown + 0.012 * Math.sin(v * Math.PI) - v * 0.012;
      return V(x, y, z);
    }, 24, 6, [5, 1.6]);
    group.add(new THREE.Mesh(hood, leather));
    const lip = new THREE.Mesh(tube([V(-0.58, lipY - 0.005, lipZ), V(-0.3, lipY + 0.014, lipZ + 0.004), V(0, lipY + 0.02, lipZ + 0.006), V(0.3, lipY + 0.014, lipZ + 0.004), V(0.58, lipY - 0.005, lipZ)], 0.016, 32, 10), leather);
    group.add(lip);
    // hood cheeks: close the sides of the hood down to the panel
    for (const sx of [-1, 1]) {
      const cheek = sheet((u, v) => V(sx * (0.58 - 0.01 * v), lipY - v * 0.06 - u * 0.02, lipZ - u * 0.36), 4, 3);
      group.add(new THREE.Mesh(cheek, leather));
    }
    // wet compass on the glareshield: a heading card turning in a black housing
    const compass = new THREE.Group();
    const cardC = canvas(512, 64, (x, w, h) => {
      x.fillStyle = '#101214'; x.fillRect(0, 0, w, h);
      x.font = '700 26px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) {
        const px = w - d / 360 * w;
        x.fillStyle = '#e9e6dd'; x.fillRect(px - 1, 0, 2, d % 30 === 0 ? 16 : d % 10 === 0 ? 11 : 6);
        if (d % 30 === 0) { const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10); x.fillStyle = d % 90 === 0 ? '#ffb13b' : '#e9e6dd'; x.fillText(lab, px, 40); }
      }
    });
    const cardT = new THREE.CanvasTexture(cardC); cardT.wrapS = THREE.RepeatWrapping; cardT.encoding = THREE.sRGBEncoding;
    const card = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.024, 32, 1, true), new THREE.MeshBasicMaterial({ map: cardT, toneMapped: false }));
    compass.add(card);
    const housing = new THREE.Mesh(slab(0.07, 0.05, 0.06, 0.012, 0.004), plastic); housing.position.set(0, 0.006, -0.012); compass.add(housing);
    const window_ = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.022), new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.6 }));
    window_.position.set(0, 0, 0.028); compass.add(window_);
    const lubber = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.02, 0.002), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); lubber.position.set(0, 0, 0.0285); compass.add(lubber);
    housing.geometry.translate(0, 0, -0.012);   // housing sits behind the card window
    compass.position.set(0.0, lipY + 0.06, lipZ - 0.12); compass.rotation.x = -0.05;
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.035, 10), chrome); mount.position.set(0, lipY + 0.035, lipZ - 0.13);
    group.add(mount); group.add(compass);

    // ---- windshield frame: curved painted pillars, centre strip, roof bow
    const pillar = sx => [V(sx * 0.57, 0.69, -1.0), V(sx * 0.585, 0.95, -0.78), V(sx * 0.565, 1.17, -0.52), V(sx * 0.52, 1.27, -0.33)];
    for (const sx of [-1, 1]) {
      group.add(new THREE.Mesh(tube(pillar(sx), 0.028, 28, 12), paint));
      // door post, behind the shoulder, and the door sill under the elbow
      group.add(new THREE.Mesh(tube([V(sx * 0.585, 0.64, 0.36), V(sx * 0.57, 1.0, 0.33), V(sx * 0.52, 1.28, 0.3)], 0.035, 16, 10), paint));
      group.add(new THREE.Mesh(tube([V(sx * 0.565, 0.645, -0.98), V(sx * 0.575, 0.65, -0.4), V(sx * 0.575, 0.64, 0.5)], 0.03, 20, 10), darkTrim));
    }
    group.add(new THREE.Mesh(tube([V(0, 0.715, -1.02), V(0, 0.98, -0.8), V(0, 1.2, -0.54), V(0, 1.285, -0.36)], 0.011, 24, 8), paint));
    group.add(new THREE.Mesh(tube([V(-0.52, 1.27, -0.33), V(0, 1.31, -0.35), V(0.52, 1.27, -0.33)], 0.03, 20, 10), paint));
    for (const sx of [-1, 1]) group.add(new THREE.Mesh(tube([V(sx * 0.52, 1.28, -0.33), V(sx * 0.53, 1.29, 0.1), V(sx * 0.52, 1.28, 0.6)], 0.022, 12, 8), paint));
    const roof = new THREE.Mesh(sheet((u, v) => V((u - 0.5) * 1.04, 1.30 + 0.035 * Math.sin(u * Math.PI), -0.32 + v * 0.95), 10, 4, [4, 4]), fabric);
    group.add(roof);

    // ---- side trim: tan upholstered door panels with a dark kick strip and an armrest
    for (const sx of [-1, 1]) {
      const wall = sheet((u, v) => V(sx * (0.585 - 0.03 * Math.sin(v * Math.PI)), 0.05 + v * 0.58, 0.55 - u * 1.5), 12, 6, [3, 1.2]);
      group.add(new THREE.Mesh(wall, trimTan));
      const kick = new THREE.Mesh(slab(1.5, 0.16, 0.03, 0.02, 0.006), darkTrim); kick.rotation.y = Math.PI / 2; kick.position.set(sx * 0.56, 0.12, -0.2); group.add(kick);
      const arm = new THREE.Mesh(slab(0.42, 0.05, 0.08, 0.022, 0.01), darkTrim); arm.rotation.y = Math.PI / 2; arm.position.set(sx * 0.53, 0.47, 0.1); group.add(arm);
      const handle = new THREE.Mesh(tube([V(sx * 0.56, 0.56, -0.12), V(sx * 0.535, 0.575, -0.05), V(sx * 0.56, 0.56, 0.02)], 0.008, 10, 8), chrome); group.add(handle);
    }

    // (no windshield tint or glint: a full-screen transparent layer cost an Iris Xe a third of its frame rate)

    // ---- yokes: ram's horn on a chrome shaft, rubber grips, a hub with a badge
    const badgeC = canvas(128, 64, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2d31'); g.addColorStop(1, '#151719'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.font = '700 26px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#d8dde2'; x.fillText('GYRO', w / 2 - 14, h / 2 + 1); x.fillStyle = '#ffb13b'; x.fillText('W', w / 2 + 38, h / 2 + 1);
    });
    const badgeT = new THREE.CanvasTexture(badgeC); badgeT.encoding = THREE.sRGBEncoding;
    const badgeMat = new THREE.MeshStandardMaterial({ map: badgeT, roughness: 0.35, metalness: 0.3 });
    const horn = tube([V(-0.15, 0.035, 0), V(-0.135, -0.025, 0), V(-0.08, -0.05, 0), V(0, -0.055, 0), V(0.08, -0.05, 0), V(0.135, -0.025, 0), V(0.15, 0.035, 0)], 0.013, 40, 10);
    const grip = tube([V(0, -0.045, 0), V(0.004, 0.02, 0), V(0, 0.085, 0.004)], 0.018, 12, 12);
    const yokes = [-0.27, 0.27].map(x => {
      const y = new THREE.Group();
      y.add(new THREE.Mesh(horn, plastic));
      for (const sx of [-1, 1]) { const gm = new THREE.Mesh(grip, rubber); gm.position.set(0.15 * sx, 0.035, 0); gm.scale.x = sx; y.add(gm); }
      const hub = new THREE.Mesh(slab(0.09, 0.05, 0.035, 0.014, 0.005), plastic); hub.position.set(0, -0.035, 0); y.add(hub);
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.03), badgeMat); badge.position.set(0, -0.035, 0.0236); y.add(badge);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 14).rotateX(Math.PI / 2), chrome); shaft.position.set(0, -0.035, -0.17); y.add(shaft);
      y.position.set(x, PANEL.y - 0.05, PANEL.z + 0.27);
      group.add(y); return y;
    });
    // shaft boots where the yokes enter the panel
    for (const x of [-0.27, 0.27]) { const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.03, 16).rotateX(Math.PI / 2), rubber); boot.position.set(x, PANEL.y - 0.085, PANEL.z + 0.03); group.add(boot); }

    // ---- throttle quadrant: throttle (moves), prop and mixture, on a centre pedestal
    const ped = new THREE.Mesh(slab(0.16, 0.2, 0.2, 0.03, 0.01), darkTrim); ped.position.set(0, PANEL.y - PANEL.h / 2 - 0.06, PANEL.z + 0.1); ped.rotation.x = -0.35; group.add(ped);
    const lever = (col, x, len, knob) => {
      const g = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 8).rotateX(Math.PI / 2), chrome); rod.position.z = len / 2; g.add(rod);
      const k = new THREE.Mesh(knob, new THREE.MeshStandardMaterial({ color: lin(col), roughness: 0.35 })); k.position.z = len; g.add(k);
      g.position.set(x, PANEL.y - PANEL.h / 2 + 0.05, PANEL.z + 0.06); group.add(g); return g;
    };
    const thr = lever('#141414', -0.035, 0.11, new THREE.CylinderGeometry(0.018, 0.018, 0.026, 18).rotateX(Math.PI / 2));
    lever('#1d4f9a', 0.0, 0.09, new THREE.CylinderGeometry(0.012, 0.014, 0.02, 12).rotateX(Math.PI / 2));
    lever('#b0201b', 0.035, 0.09, new THREE.CylinderGeometry(0.012, 0.012, 0.022, 6).rotateX(Math.PI / 2));
    group.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });

    // ---------------------------------------------------------------- the panel face
    const g = new HUD(cnv);
    g.dpr = 1; g.s = 1.15; g.w = CW; g.h = CH;
    const ctx = cnv.getContext('2d');
    // gauge layout (canvas px)
    const R = 60, CX = 250, TOP = 128, BOT = 312, DX = 146;
    const GAUGES = [[CX - DX, TOP], [CX, TOP], [CX + DX, TOP], [CX - DX, BOT], [CX, BOT], [CX + DX, BOT]];
    const TACH = [585, 120, 54];
    const staticC = canvas(CW, CH, paintStatic);
    function label(x, t, px, py, size, col, weight) { x.font = (weight || 600) + ' ' + size + 'px ' + FONT; x.fillStyle = col || '#d4d9dc'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, px, py); }
    function screw(x, px, py) {
      const gr = x.createRadialGradient(px - 1, py - 1, 0, px, py, 4); gr.addColorStop(0, '#c9ced2'); gr.addColorStop(1, '#5b6166');
      x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fillStyle = gr; x.fill();
      x.strokeStyle = '#2a2e31'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(px - 3, py + 1); x.lineTo(px + 3, py - 1); x.stroke();
    }
    function bezel(x, px, py, r) {
      // a recessed hole, a brushed chrome ring and four screws
      x.beginPath(); x.arc(px, py + 3, r + 12, 0, Math.PI * 2); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fill();
      const ring = x.createLinearGradient(px - r, py - r, px + r, py + r);
      ring.addColorStop(0, '#eef1f3'); ring.addColorStop(0.35, '#8e959b'); ring.addColorStop(0.55, '#d5dade'); ring.addColorStop(1, '#4c5257');
      x.beginPath(); x.arc(px, py, r + 9, 0, Math.PI * 2); x.fillStyle = ring; x.fill();
      x.beginPath(); x.arc(px, py, r + 5, 0, Math.PI * 2); x.fillStyle = '#0a0c0e'; x.fill();
      for (const a of [45, 135, 225, 315]) screw(x, px + Math.cos(a * D2R) * (r + 17), py + Math.sin(a * D2R) * (r + 17));
    }
    function rocker(x, px, py, name, on) {
      x.fillStyle = '#0d0e10'; x.fillRect(px - 11, py - 17, 22, 34);
      const gr = x.createLinearGradient(0, py - 15, 0, py + 15); gr.addColorStop(0, on ? '#e8e8e2' : '#3c3f43'); gr.addColorStop(0.5, '#2a2c2f'); gr.addColorStop(1, on ? '#1f2123' : '#d0d0ca');
      x.fillStyle = gr; x.fillRect(px - 8, py - 14, 16, 28);
      label(x, name, px, py + 28, 9.5, '#c9cfd3');
    }
    function paintStatic(x, w, h) {
      // powder-coated grey with a fine texture, darker under the glareshield's shadow
      const base = x.createLinearGradient(0, 0, 0, h); base.addColorStop(0, '#24272a'); base.addColorStop(0.18, '#33373b'); base.addColorStop(1, '#2c3034'); x.fillStyle = base; x.fillRect(0, 0, w, h);
      const r = rng(21);
      for (let i = 0; i < 26000; i++) { x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.035)'; x.fillRect(r() * w, r() * h, 1, 1); }
      const sh = x.createLinearGradient(0, 0, 0, 70); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = sh; x.fillRect(0, 0, w, 70);
      // the pilot's sub-panel: a slightly lighter raised plate behind the six-pack
      x.fillStyle = 'rgba(255,255,255,0.035)'; roundRectPath(x, 40, 40, 430, 370, 18); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2; x.stroke();
      for (const [px, py] of GAUGES) bezel(x, px, py, R);
      bezel(x, TACH[0], TACH[1], TACH[2]);
      // labels engraved under the gauges
      const names = ['AIRSPEED', 'ATTITUDE', 'ALTITUDE', 'TURN', 'HEADING', 'VERT SPEED'];
      GAUGES.forEach(([px, py], i) => label(x, names[i], px, py + R + 25, 9, '#aeb6bb'));
      label(x, 'TACHOMETER', TACH[0], TACH[1] + TACH[2] + 24, 9, '#aeb6bb');
      // radio stack: com/nav and transponder faceplates with knobs
      const rx = 520, ry = 196;
      x.fillStyle = '#0c0d0f'; roundRectPath(x, rx - 8, ry - 8, 146, 216, 8); x.fill();
      const radios = [['COM 1', '122.800', '118.300'], ['NAV 1', '110.50', '113.90'], ['XPDR', '1200', 'ALT']];
      radios.forEach((rd, i) => {
        const y0 = ry + i * 68;
        const fp = x.createLinearGradient(0, y0, 0, y0 + 60); fp.addColorStop(0, '#2b2e32'); fp.addColorStop(1, '#1a1c1f'); x.fillStyle = fp; x.fillRect(rx, y0, 130, 60);
        x.fillStyle = '#071108'; x.fillRect(rx + 8, y0 + 14, 86, 30);
        label(x, rd[0], rx + 22, y0 + 7, 8, '#8e989e');
        x.font = '600 14px ' + FONT; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#5ef095'; x.fillText(rd[1], rx + 12, y0 + 24);
        x.fillStyle = '#2f8a52'; x.font = '600 11px ' + FONT; x.fillText(rd[2], rx + 12, y0 + 37);
        const kg = x.createRadialGradient(rx + 112, y0 + 28, 1, rx + 112, y0 + 30, 14); kg.addColorStop(0, '#55595e'); kg.addColorStop(1, '#16181a');
        x.beginPath(); x.arc(rx + 112, y0 + 30, 13, 0, Math.PI * 2); x.fillStyle = kg; x.fill();
        x.beginPath(); x.arc(rx + 112, y0 + 30, 7, 0, Math.PI * 2); x.fillStyle = '#26292c'; x.fill();
      });
      // systems block frame and annunciator frame
      x.fillStyle = 'rgba(0,0,0,0.28)'; roundRectPath(x, 680, 46, 330, 206, 12); x.fill();
      label(x, 'ENGINE  ·  SYSTEMS', 845, 38, 9, '#aeb6bb');
      x.fillStyle = '#0b0c0e'; roundRectPath(x, 680, 274, 330, 88, 8); x.fill();
      // switch row: magnetos key, master and lights rockers, breakers
      x.fillStyle = 'rgba(0,0,0,0.22)'; roundRectPath(x, 40, 418, 600, 34, 6); x.fill();
      const key = x.createRadialGradient(80, 430, 2, 80, 432, 16); key.addColorStop(0, '#9aa1a7'); key.addColorStop(1, '#2a2d30');
      x.beginPath(); x.arc(80, 432, 15, 0, Math.PI * 2); x.fillStyle = key; x.fill();
      x.fillStyle = '#c8cdd1'; x.fillRect(77, 420, 6, 24);
      label(x, 'OFF  R  L  BOTH  START', 80, 452, 7, '#8e989e');
      const sw = [['MASTER', 1], ['FUEL', 1], ['BCN', 1], ['LAND', 0], ['TAXI', 0], ['NAV', 1], ['STRB', 1], ['PITOT', 0]];
      sw.forEach(([n, on], i) => rocker(x, 150 + i * 56, 418, n, on));
      for (let i = 0; i < 8; i++) { const bx = 700 + i * 38; x.beginPath(); x.arc(bx, 412, 9, 0, Math.PI * 2); x.fillStyle = '#121315'; x.fill(); x.beginPath(); x.arc(bx, 412, 5, 0, Math.PI * 2); x.fillStyle = '#e4e4de'; x.fill(); label(x, String([5, 10, 15, 5, 10, 5, 20, 15][i]), bx, 430, 9, '#aeb6bb'); }
      label(x, 'CIRCUIT BREAKERS', 833, 446, 8, '#8e989e');
      label(x, 'GYROWING  GW-1', 1060, 438, 12, '#7d878d', 700);
      label(x, 'NO ACROBATIC MANEUVERS', 1052, 80, 8, '#8e989e');
      label(x, 'EXCEPT ROLLS AND LOOPS', 1052, 92, 8, '#8e989e');
      for (const [px, py] of [[18, 18], [CW - 18, 18], [18, CH - 18], [CW - 18, CH - 18], [CW / 2, 18]]) screw(x, px, py);
    }
    function roundRectPath(x, px, py, w, h, r) { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); }
    function tach(x, y, r, rpm) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1114'; ctx.fill();
      const A = v => (-225 + clamp(v, 0, 3500) / 3500 * 270) * D2R;
      ctx.lineWidth = 6; ctx.strokeStyle = '#3ddc84'; ctx.beginPath(); ctx.arc(x, y, r - 8, A(2100), A(2700)); ctx.stroke();
      ctx.strokeStyle = '#ff4d3d'; ctx.beginPath(); ctx.arc(x, y, r - 8, A(2700), A(2760)); ctx.stroke();
      ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 2;
      for (let v = 0; v <= 3500; v += 250) {
        const a = A(v), big = v % 500 === 0;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); ctx.lineTo(x + Math.cos(a) * (r - (big ? 16 : 10)), y + Math.sin(a) * (r - (big ? 16 : 10))); ctx.stroke();
        if (big && v % 1000 === 0) label(ctx, String(v / 100), x + Math.cos(a) * (r - 28), y + Math.sin(a) * (r - 28), 13, '#e8edf0');
      }
      label(ctx, 'RPM', x, y + r * 0.35, 10, '#8b979f'); label(ctx, 'x100', x, y + r * 0.52, 9, '#8b979f');
      const a = A(rpm);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 12), y + Math.sin(a) * (r - 12)); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#3a4248'; ctx.fill();
    }
    function turnCoord(x, y, r, rate, slip) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1114'; ctx.fill();
      label(ctx, 'TURN COORDINATOR', x, y - r * 0.55, 8, '#8b979f');
      ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const a = s * 18 * D2R; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 4) * s, y + Math.sin(Math.abs(a)) * (r - 4)); ctx.lineTo(x + Math.cos(a) * (r - 16) * s, y + Math.sin(Math.abs(a)) * (r - 16)); ctx.stroke(); }
      label(ctx, 'L', x - r * 0.75, y + r * 0.55, 12, '#e8edf0'); label(ctx, 'R', x + r * 0.75, y + r * 0.55, 12, '#e8edf0');
      const bank = clamp(rate / 3 * 18, -30, 30) * D2R;
      ctx.save(); ctx.translate(x, y); ctx.rotate(bank);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.62, 0); ctx.lineTo(r * 0.62, 0); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.18); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#05080a'; ctx.fillRect(x - r * 0.5, y + r * 0.25, r, 14);
      const bx = x + clamp(-slip * 4, -1, 1) * r * 0.42;
      ctx.beginPath(); ctx.arc(bx, y + r * 0.25 + 7, 6, 0, Math.PI * 2); ctx.fillStyle = '#ddd'; ctx.fill();
    }
    function annunciator(x, y, w, h, text, on, col) {
      ctx.fillStyle = on ? col : '#1b1e21'; ctx.fillRect(x, y, w, h);
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillRect(x, y, w, h); ctx.shadowBlur = 0; }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      label(ctx, text, x + w / 2, y + h / 2 + 1, 12, on ? '#111' : '#59636a');
    }
    /** A soft highlight across the round glass of every gauge (drawn over the needles). */
    function glass(x, y, r) {
      const gr = ctx.createLinearGradient(x - r, y - r, x + r * 0.2, y + r * 0.4);
      gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.03)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
    }

    function draw(d) {
      ctx.drawImage(staticC, 0, 0);
      const [a, b, c, e, f, h] = GAUGES;
      g.asi(a[0], a[1], R, d.ias); g.attitude(b[0], b[1], R, d.pitch, d.bank, d.slip); g.altimeter(c[0], c[1], R, d.altFt, 99999);
      turnCoord(e[0], e[1], R, d.turnRate, d.slip); g.heading(f[0], f[1], R, d.hdg, d.bug); g.vsi(h[0], h[1], R, d.vsFpm);
      tach(TACH[0], TACH[1], TACH[2], d.rpm);
      for (const [px, py] of GAUGES) glass(px, py, R);
      glass(TACH[0], TACH[1], TACH[2]);
      g.systems(690, 58, 300, 182, d);
      const ax = 690, ay = 282, aw = 98, ah = 32, gx = 104;
      annunciator(ax, ay, aw, ah, 'STALL', d.stall && Math.floor(performance.now() / 250) % 2 === 0, '#ff4d3d');
      annunciator(ax + gx, ay, aw, ah, 'GEAR', d.gearWarn, '#ff4d3d');
      annunciator(ax + gx * 2, ay, aw, ah, 'BRAKE', d.brake, '#ffb13b');
      annunciator(ax, ay + 40, aw, ah, 'TRIM', d.trimming, '#5ad1ff');
      annunciator(ax + gx, ay + 40, aw, ah, 'FLAPS', d.flapPos > 0.01 && d.flapPos < 0.99 && Math.abs(d.flapPos * 3 - Math.round(d.flapPos * 3)) > 0.02, '#ffb13b');
      annunciator(ax + gx * 2, ay + 40, aw, ah, 'LOW ALT', d.terrain, '#ff4d3d');
      // night: the panel lights go on, a warm red wash
      if (d.night > 0.05) { ctx.fillStyle = 'rgba(40,4,0,' + (0.3 * d.night) + ')'; ctx.fillRect(0, 0, CW, CH); }
      tex.needsUpdate = true;
    }
    let drawT = 0;

    /** Per frame while the cockpit is shown: gauges at 15 Hz, yokes, throttle and compass every frame. */
    function update(d, dt) {
      drawT -= dt;
      if (drawT <= 0) { drawT = 1 / 15; draw(d); }
      for (const y of yokes) { y.position.z = PANEL.z + 0.27 + clamp(d.elevator, -1, 1) * 0.07; y.rotation.z = -clamp(d.aileron, -1, 1) * 0.6; }
      thr.position.z = PANEL.z + 0.06 + clamp(d.throttle, 0, 1) * -0.05 + 0.03;
      cardT.offset.x = -((d.hdg || 0) / 360);
      faceMat.color.setScalar(1 - 0.35 * (d.night || 0));
    }
    return { update, EYE: EYE.clone(), group };
  }

  window.Cockpit = { build, EYE };
})();
