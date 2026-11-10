/*
 * GYROWING aircraft model: an original low-wing, single-prop trainer with retractable tricycle
 * gear, built from lofted sections. Body frame: forward -Z, up +Y, right +X, origin at the CG.
 * Moving parts: propeller, ailerons, flaps, elevator, rudder, gear legs, lights.
 */
(function () {
  'use strict';
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const V3 = THREE.Vector3;

  /** Loft closed loops of equal length into a mesh (with end caps). loops: arrays of Vector3. */
  function loft(loops, opts) {
    opts = opts || {};
    const n = loops[0].length, pos = [], uv = [], idx = [];
    loops.forEach((L, j) => L.forEach((p, i) => { pos.push(p.x, p.y, p.z); uv.push(i / (n - 1), j / (loops.length - 1)); }));
    for (let j = 0; j < loops.length - 1; j++) for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = j * n + i, b = j * n + i2, c = (j + 1) * n + i, d = (j + 1) * n + i2;
      if (opts.flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const cap = (L, rev) => {
      const base = pos.length / 3, ctr = new V3();
      L.forEach(p => ctr.add(p)); ctr.multiplyScalar(1 / L.length);
      L.forEach(p => { pos.push(p.x, p.y, p.z); uv.push(0.5, 0.5); });
      pos.push(ctr.x, ctr.y, ctr.z); uv.push(0.5, 0.5);
      const ci = base + L.length;
      for (let i = 0; i < L.length; i++) { const i2 = (i + 1) % L.length; if (rev !== !!opts.flip) idx.push(ci, base + i, base + i2); else idx.push(ci, base + i2, base + i); }
    };
    if (opts.capStart !== false) cap(loops[0], true);
    if (opts.capEnd !== false) cap(loops[loops.length - 1], false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // NACA 00xx half thickness at chord fraction f (t = thickness ratio)
  const naca = (f, t) => 5 * t * (0.2969 * Math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f * f * f - 0.1036 * f * f * f * f);

  /**
   * An airfoil panel between span stations. spec(s) -> { le: V3, chord: number, cdir: V3 (unit,
   * leading -> trailing), tdir: V3 (unit, thickness "up") , t: thickness ratio }. f0..f1 = chord range.
   */
  function airfoilPanel(spec, s0, s1, f0, f1, steps, flip) {
    const loops = [];
    for (let k = 0; k <= (steps || 1); k++) {
      const s = s0 + (s1 - s0) * k / (steps || 1);
      const sp = spec(s), L = [];
      const m = 7;
      const fs = []; for (let i = 0; i <= m; i++) { const u = i / m; fs.push(f0 + (f1 - f0) * (f0 === 0 ? (1 - Math.cos(u * Math.PI / 2)) : u)); }
      fs.forEach(f => L.push(sp.le.clone().addScaledVector(sp.cdir, f * sp.chord).addScaledVector(sp.tdir, Math.max(0.004, naca(Math.min(f, 0.999), sp.t)) * sp.chord + sp.camber * sp.chord * Math.sin(f * Math.PI))));
      for (let i = fs.length - 1; i >= (f0 === 0 ? 1 : 0); i--) { const f = fs[i]; L.push(sp.le.clone().addScaledVector(sp.cdir, f * sp.chord).addScaledVector(sp.tdir, -Math.max(0.004, naca(Math.min(f, 0.999), sp.t)) * sp.chord * 0.8 + sp.camber * sp.chord * Math.sin(f * Math.PI))); }
      loops.push(L);
    }
    return loft(loops, { flip });
  }
  /** Make a pivot group whose local origin is p0 and whose geometry rotates about the p0->p1 hinge. */
  function hinged(geo, mat, p0, p1) {
    const pivot = new THREE.Group();
    pivot.position.copy(p0);
    geo.translate(-p0.x, -p0.y, -p0.z);
    const mesh = new THREE.Mesh(geo, mat);
    pivot.add(mesh);
    pivot.userData.axis = p1.clone().sub(p0).normalize();
    mesh.castShadow = true; mesh.receiveShadow = true;
    return pivot;
  }
  function setHinge(pivot, angle) { pivot.quaternion.setFromAxisAngle(pivot.userData.axis, angle); }

  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function liveryTexture(scheme) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    // u (x) goes around the fuselage starting at the right side, v (y, flipped) along the length nose -> tail
    ctx.fillStyle = scheme.base; ctx.fillRect(0, 0, 512, 512);
    // belly colour (u around 0.5..0.75 = bottom half): loop goes right -> top -> left -> bottom
    const band = (u0, u1, color) => { ctx.fillStyle = color; ctx.fillRect(u0 * 512, 0, (u1 - u0) * 512, 512); };
    band(0.55, 0.95, scheme.belly);
    // a sweeping cheatline on each side, rising toward the tail
    ctx.fillStyle = scheme.stripe;
    for (const side of [0, 1]) {
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const v = k / 40, rise = 0.03 * Math.pow(v, 2);
        const u = side === 0 ? 0.995 - rise : 0.505 + rise;
        const x = (side === 0 ? u : u) * 512, y = (1 - v) * 512;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let k = 40; k >= 0; k--) {
        const v = k / 40, rise = 0.03 * Math.pow(v, 2), w = 0.035 - 0.012 * v;
        const u = side === 0 ? 0.995 - rise - w : 0.505 + rise + w;
        ctx.lineTo(u * 512, (1 - v) * 512);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = scheme.accent;
    ctx.fillRect(0, 0, 512, 512 * 0.03); // tail cone tip
    ctx.fillRect(0.955 * 512, 0, 0.008 * 512, 512); ctx.fillRect(0.535 * 512, 0, 0.008 * 512, 512);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  /** A spinning two-blade prop seen as a blur: faint near the hub, a darker band, painted tips as a ring. */
  function propDiscTexture(scheme) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(40,42,46,0.0)'); g.addColorStop(0.25, 'rgba(40,42,46,0.55)'); g.addColorStop(0.8, 'rgba(40,42,46,0.75)');
    g.addColorStop(0.86, scheme.accent); g.addColorStop(0.93, scheme.accent); g.addColorStop(0.97, 'rgba(40,42,46,0.2)'); g.addColorStop(1, 'rgba(40,42,46,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    // two faint blade streaks give it motion
    ctx.globalCompositeOperation = 'destination-out';
    for (let a = 0; a < 2; a++) { ctx.save(); ctx.translate(128, 128); ctx.rotate(a * Math.PI + 0.6); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 128, 0, 1.4); ctx.closePath(); ctx.fill(); ctx.restore(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }

  const SCHEMES = {
    hero: { base: '#f4f3ef', belly: '#1e3a5c', stripe: '#1e3a5c', accent: '#f08c1e', tail: '#1e3a5c', tag: 'GW-01' },
    red: { base: '#f2efe9', belly: '#9e2a2b', stripe: '#9e2a2b', accent: '#e7c547', tail: '#9e2a2b', tag: 'GW-17' },
    green: { base: '#e9eee6', belly: '#2f5d50', stripe: '#2f5d50', accent: '#d8d5c8', tail: '#2f5d50', tag: 'GW-33' },
  };

  function build(schemeName, opts) {
    opts = opts || {};
    const scheme = SCHEMES[schemeName || 'hero'];
    const root = new THREE.Group();
    const parts = {};
    const paint = new THREE.MeshStandardMaterial({ map: liveryTexture(scheme), roughness: 0.42, metalness: 0.08 });
    const white = new THREE.MeshStandardMaterial({ color: lin(scheme.base), roughness: 0.45, metalness: 0.05 });
    const tailMat = new THREE.MeshStandardMaterial({ color: lin(scheme.tail), roughness: 0.45, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: lin('#2a2d31'), roughness: 0.6, metalness: 0.2 });
    const tire = new THREE.MeshStandardMaterial({ color: lin('#1a1a1a'), roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: lin('#c9ccd0'), roughness: 0.25, metalness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({ color: lin('#1c2a33'), roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55 });
    const accent = new THREE.MeshStandardMaterial({ color: lin(scheme.accent), roughness: 0.4 });

    // ---------- fuselage (superellipse sections)
    const stations = [ // z, half-width, half-height, centre y
      [-2.02, 0.28, 0.29, 0.04], [-1.85, 0.42, 0.40, 0.06], [-1.5, 0.5, 0.5, 0.08], [-0.95, 0.56, 0.56, 0.1],
      [-0.3, 0.58, 0.6, 0.12], [0.6, 0.56, 0.58, 0.13], [1.6, 0.46, 0.49, 0.15], [2.9, 0.31, 0.37, 0.2],
      [4.3, 0.18, 0.26, 0.26], [5.5, 0.1, 0.18, 0.31], [6.05, 0.05, 0.12, 0.33],
    ];
    const ring = 18, ex = 2.6;
    const loops = stations.map(([z, w, h, yc]) => {
      const L = [];
      for (let i = 0; i < ring; i++) {
        const a = i / ring * Math.PI * 2; // 0 = right side, pi/2 = top
        const c = Math.cos(a), s = Math.sin(a);
        L.push(new V3(w * Math.sign(c) * Math.pow(Math.abs(c), 2 / ex), yc + h * Math.sign(s) * Math.pow(Math.abs(s), 2 / ex), z));
      }
      L.push(L[0].clone()); // seam for the texture
      return L;
    });
    const fg = loft(loops, { capStart: false, flip: true });
    const fus = new THREE.Mesh(fg, paint); fus.castShadow = true; fus.receiveShadow = true; root.add(fus);
    // canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    canopy.scale.set(0.5, 0.46, 1.35); canopy.position.set(0, 0.62, 0.05); root.add(canopy);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 20, Math.PI), dark);
    frame.position.set(0, 0.64, -0.62); frame.scale.set(1, 0.92, 1); root.add(frame);
    const frame2 = frame.clone(); frame2.position.z = 0.5; root.add(frame2);
    // spinner + propeller
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 16).rotateX(-Math.PI / 2), white);
    spinner.position.set(0, 0.04, -2.27); root.add(spinner);
    const prop = new THREE.Group(); prop.position.set(0, 0.04, -2.1); root.add(prop);
    for (const sgn of [1, -1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.92, 0.03).translate(0, 0.52, 0), dark);
      blade.rotation.z = sgn > 0 ? 0 : Math.PI; blade.rotation.y = 0.35 * sgn;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.121, 0.1, 0.031).translate(0, 0.93, 0), accent);
      blade.add(tip); prop.add(blade);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({ map: propDiscTexture(scheme), color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.set(0, 0.04, -2.12); root.add(disc);
    parts.prop = prop; parts.disc = disc;
    // exhaust stubs and cowl intakes
    for (const sx of [-1, 1]) { const ex1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 6), chrome); ex1.rotation.x = 0.6; ex1.position.set(0.36 * sx, -0.32, -1.45); root.add(ex1); }

    // ---------- wings (low wing, 5 deg dihedral, taper)
    const dih = 5 * Math.PI / 180, wingY = -0.42, half = 5.5;
    const wingSpec = side => s => ({
      le: new V3(side * s, wingY + s * Math.tan(dih), -0.78 + s * 0.05),
      chord: 1.68 - 0.5 * (s / half), cdir: new V3(0, 0, 1), tdir: new V3(-side * Math.sin(dih), Math.cos(dih), 0), t: 0.15 - 0.03 * (s / half), camber: 0.015,
    });
    for (const side of [1, -1]) {
      const sp = wingSpec(side), flip = side > 0;
      const main = new THREE.Mesh(airfoilPanel(sp, 0.2, half, 0, 0.74, 1, flip), paint === null ? white : white);
      main.castShadow = true; main.receiveShadow = true; root.add(main);
      // wingtip
      const tipCap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), white);
      // flaps & ailerons hinge at 76% chord
      const hingeAt = s => { const q = sp(s); return q.le.clone().addScaledVector(q.cdir, 0.75 * q.chord).addScaledVector(q.tdir, 0.02); };
      const flap = hinged(airfoilPanel(sp, 0.62, 2.95, 0.755, 1, 1, flip), white, hingeAt(0.62), hingeAt(2.95));
      const ail = hinged(airfoilPanel(sp, 3.0, 5.35, 0.755, 1, 1, flip), white, hingeAt(3.0), hingeAt(5.35));
      root.add(flap); root.add(ail);
      parts[side > 0 ? 'flapR' : 'flapL'] = flap; parts[side > 0 ? 'ailR' : 'ailL'] = ail;
      // fixed trailing piece at the root & tip
      root.add(new THREE.Mesh(airfoilPanel(sp, 0.2, 0.62, 0.74, 1, 1, flip), white));
      root.add(new THREE.Mesh(airfoilPanel(sp, 5.35, half, 0.74, 1, 1, flip), white));
      // tip fairing with nav light
      const tq = sp(half);
      const navPos = tq.le.clone().addScaledVector(tq.cdir, 0.25 * tq.chord).add(new V3(side * 0.02, 0, 0));
      tipCap.position.copy(navPos); tipCap.scale.set(0.4, 0.8, 3.5);
      root.add(tipCap);
      const nav = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x22ff55 : 0xff2222 }));
      nav.position.copy(navPos).add(new V3(side * 0.05, 0, -0.1)); root.add(nav);
      parts[side > 0 ? 'navR' : 'navL'] = navPos.clone().add(new V3(side * 0.08, 0, -0.1));
      // a stripe on the wing upper surface near the tip
      const stripe = new THREE.Mesh(airfoilPanel(s => { const q = sp(s); q.t *= 1.04; return q; }, 4.4, 4.7, 0.0, 0.74, 1, flip), tailMat);
      root.add(stripe);
    }
    // wing root fairings
    const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), white);
    fair.scale.set(0.62, 0.3, 1.25); fair.position.set(0, -0.36, 0.0); root.add(fair);

    // ---------- tail
    const hY = 0.33, hHalf = 1.8;
    const hSpec = side => s => ({ le: new V3(side * s, hY, 4.95 + s * 0.12), chord: 0.98 - 0.28 * (s / hHalf), cdir: new V3(0, 0, 1), tdir: new V3(0, 1, 0), t: 0.11, camber: 0 });
    const elevator = new THREE.Group(); root.add(elevator); parts.elev = [];
    for (const side of [1, -1]) {
      const sp = hSpec(side), flip = side > 0;
      root.add(new THREE.Mesh(airfoilPanel(sp, 0.05, hHalf, 0, 0.56, 1, flip), white));
      const hp = s => { const q = sp(s); return q.le.clone().addScaledVector(q.cdir, 0.57 * q.chord); };
      const el = hinged(airfoilPanel(sp, 0.05, hHalf, 0.575, 1, 1, flip), tailMat, hp(0.05), hp(hHalf));
      root.add(el); parts.elev.push(el);
    }
    const vH = 1.55;
    const vSpec = s => ({ le: new V3(0, 0.38 + s, 4.65 + s * 0.55), chord: 1.25 - 0.5 * (s / vH), cdir: new V3(0, 0, 1), tdir: new V3(1, 0, 0), t: 0.11, camber: 0 });
    root.add(new THREE.Mesh(airfoilPanel(vSpec, 0, vH, 0, 0.56, 1, false), tailMat));
    const rp = s => { const q = vSpec(s); return q.le.clone().addScaledVector(q.cdir, 0.57 * q.chord); };
    const rudder = hinged(airfoilPanel(vSpec, 0, vH, 0.575, 1, 1, false), tailMat, rp(0), rp(vH));
    root.add(rudder); parts.rudder = rudder;
    // dorsal fillet
    const dorsal = new THREE.Mesh(airfoilPanel(s => ({ le: new V3(0, 0.36 + s, 3.3 + s * 6), chord: 1.6 - s * 6.5, cdir: new V3(0, 0, 1), tdir: new V3(1, 0, 0), t: 0.08, camber: 0 }), 0, 0.2, 0, 1, 1, false), tailMat);
    root.add(dorsal);
    const beaconPos = new V3(0, 0.38 + vH + 0.04, 4.65 + vH * 0.55 + 0.3);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    beacon.position.copy(beaconPos); root.add(beacon);
    parts.tailLight = new V3(0, 0.33, 6.08);

    // ---------- landing gear
    function leg(pivotPos, strutLen, wheelR, wheelW, isNose) {
      const pivot = new THREE.Group(); pivot.position.copy(pivotPos);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, strutLen, 6).translate(0, -strutLen / 2, 0), chrome);
      pivot.add(strut);
      const wheel = new THREE.Group(); wheel.position.y = -strutLen;
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 16).rotateZ(Math.PI / 2), tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, wheelW * 1.05, 10).rotateZ(Math.PI / 2), white);
      wheel.add(tyre); wheel.add(hub);
      if (isNose) { const fork = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.08), chrome); fork.position.set(wheelW * 0.7, 0.05, 0); wheel.add(fork); }
      pivot.add(wheel);
      pivot.traverse(m => { if (m.isMesh) m.castShadow = true; });
      root.add(pivot);
      return { pivot, wheel, strutLen };
    }
    // aero wheel contact points (FM): nose x=1.7 z=1.25; mains x=-0.35, y=+-1.4, z=1.3
    const gearN = leg(new V3(0, -0.42, -1.7), 1.25 - 0.42 - 0.19, 0.19, 0.12, true);
    const gearL = leg(new V3(-1.4, -0.35, 0.35), 1.3 - 0.35 - 0.25, 0.25, 0.14, false);
    const gearR = leg(new V3(1.4, -0.35, 0.35), 1.3 - 0.35 - 0.25, 0.25, 0.14, false);
    parts.gearN = gearN; parts.gearL = gearL; parts.gearR = gearR;

    // ---------- lights: glow sprites
    const glowTex = glowTexture();
    const glow = (pos, color, size) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(pos); s.scale.setScalar(size); root.add(s); return s;
    };
    parts.glowL = glow(parts.navL, 0xff3030, 0.8);
    parts.glowR = glow(parts.navR, 0x30ff60, 0.8);
    parts.glowTail = glow(parts.tailLight, 0xffffff, 0.6);
    parts.beacon = glow(beaconPos, 0xff2a10, 1.2);
    parts.strobeL = glow(parts.navL, 0xffffff, 2.2); parts.strobeR = glow(parts.navR, 0xffffff, 2.2);
    parts.landGlow = glow(new V3(-1.9, -0.36, -0.85), 0xfff4d8, 0.9);

    // landing light (spot) on the left wing leading edge
    if (opts.lights !== false) {
      const spot = new THREE.SpotLight(0xfff1d6, 0, 450, 0.32, 0.5, 1.3);
      spot.position.set(-1.9, -0.36, -0.85);
      spot.target.position.set(-1.9, -6, -60);
      root.add(spot); root.add(spot.target);
      parts.spot = spot;
    }

    // ---------- cockpit interior: an empty group that cockpit.js fills (seen only from the pilot's seat)
    const cockpit = new THREE.Group();
    cockpit.visible = false;
    root.add(cockpit);
    parts.cockpit = cockpit; parts.canopy = canopy;

    root.traverse(m => { if (m.isMesh && m !== disc && m.material !== glassMat) { m.castShadow = true; m.receiveShadow = true; } });
    [paint, white, tailMat, dark, chrome, accent].forEach(m => { m.envMapIntensity = 0.8; });
    glassMat.envMapIntensity = 1.4;
    canopy.castShadow = false;

    // merge the static skin (fuselage, fixed wing and tail panels, fairings) into one mesh per material
    {
      const keep = new Set([canopy, frame, frame2, disc]);
      const statics = root.children.filter(o => o.isMesh && !keep.has(o));
      const tmpRoot = new THREE.Group();
      statics.forEach(o => { root.remove(o); tmpRoot.add(o); });
      const merged = bake({ root: tmpRoot, parts: { disc: null } });
      merged.children.slice().forEach(m => { root.add(m); if (m.material === paint) parts.skin = m; });
    }

    let tLight = 0;
    /** Pose the moving parts from the flight model state. */
    function update(s, dt, night, cockpitView) {
      tLight += dt;
      // propeller: blades blur into a disc at speed
      const rps = s.rpm / 60;
      prop.rotation.z -= Math.min(rps, 6.5) * 2 * Math.PI * dt * (rps > 6.5 ? 1.0 : 1);
      if (rps > 6.5) prop.rotation.z -= 0.9 + Math.random() * 0.5;
      const blur = clamp((s.rpm - 350) / 600, 0, 1);
      disc.material.opacity = 0.42 * blur * (cockpitView ? 0.16 : 1);
      disc.rotation.z -= dt * 3.1;
      prop.children.forEach(b => { b.visible = blur < 0.6; });
      // surfaces (radians of deflection)
      const sf = s.surfaces;
      setHinge(parts.ailR, -sf.aileron * 0.3); setHinge(parts.ailL, -sf.aileron * 0.3);
      parts.elev.forEach(e => setHinge(e, (e === parts.elev[0] ? -1 : 1) * sf.elevator * 0.42));
      setHinge(rudder, sf.rudder * 0.45);
      setHinge(parts.flapR, s.flap * 0.6); setHinge(parts.flapL, -s.flap * 0.6);
      // gear: mains fold inward into the wing, nose folds aft
      const g = clamp(s.gear, 0, 1), up = 1 - g;
      gearL.pivot.rotation.z = up * Math.PI / 2 * 0.98; gearR.pivot.rotation.z = -up * Math.PI / 2 * 0.98;
      gearN.pivot.rotation.x = -up * Math.PI / 2 * 0.95;
      gearN.pivot.rotation.y = g > 0.98 ? -sf.rudder * 0.19 * clamp(1 - s.groundSpeed / 32, 0.25, 1) : 0;
      const showGear = g > 0.02;
      gearL.pivot.visible = gearR.pivot.visible = gearN.pivot.visible = showGear;
      // wheel spin
      const spin = (s.onGround ? s.groundSpeed : 0) * dt;
      gearN.wheel.rotation.x -= spin / 0.19; gearL.wheel.rotation.x -= spin / 0.25; gearR.wheel.rotation.x -= spin / 0.25;
      // lights
      const vis = 0.12 + 0.88 * night;
      parts.glowL.material.opacity = parts.glowR.material.opacity = parts.glowTail.material.opacity = vis;
      const sp = 1.2 + night * 0.5;
      parts.glowL.scale.setScalar(sp * 0.6); parts.glowR.scale.setScalar(sp * 0.6); parts.glowTail.scale.setScalar(sp * 0.5);
      const b = (tLight % 1.4) < 0.12 ? 1 : 0;
      parts.beacon.material.opacity = b * (0.6 + 0.4 * night); parts.beacon.scale.setScalar(1 + 0.8 * night);
      const st = tLight % 1.25, flash = (st < 0.05 || (st > 0.15 && st < 0.2)) ? 1 : 0;
      parts.strobeL.material.opacity = parts.strobeR.material.opacity = flash * (0.35 + 0.65 * night);
      parts.strobeL.scale.setScalar(2 + 1.2 * night); parts.strobeR.scale.setScalar(2 + 1.2 * night);
      const landOn = g > 0.98 && (night > 0.05 || s.agl < 600);
      parts.landGlow.material.opacity = landOn ? 0.5 + 0.5 * night : 0; parts.landGlow.scale.setScalar(0.8 + 0.8 * night);
      if (parts.spot) parts.spot.intensity = landOn ? 5 * night : 0;
    }

    return { root, parts, update, setCockpit(v) { cockpit.visible = v; canopy.visible = !v; frame.visible = frame2.visible = !v; if (parts.skin) parts.skin.visible = !v; } };
  }

  /** Merge a posed, static aircraft into one mesh per material (parked aircraft: ~8 draws, not ~70). */
  function bake(model) {
    const root = model.root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map();
    root.traverse(o => {
      if (!o.isMesh || !o.visible || o === model.parts.disc) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    const out = new THREE.Group();
    byMat.forEach((list, mat) => {
      const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
      const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), U = new Float32Array(n * 2);
      let o = 0;
      list.forEach(g => {
        P.set(g.attributes.position.array, o * 3);
        if (g.attributes.normal) Nn.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
        o += g.attributes.position.count;
      });
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); mg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      mg.computeBoundingSphere();
      const m = new THREE.Mesh(mg, mat); m.castShadow = true; m.receiveShadow = true;
      out.add(m);
    });
    return out;
  }

  window.Aircraft = { build, bake, SCHEMES };
})();
