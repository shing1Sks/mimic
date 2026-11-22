/*
 * Willowlight - the players' gear, made in code: the batting helmet (shell, peak, steel grille,
 * neck guard), caps, the umpire's hat, batting gloves with finger rolls, the keeper's gauntlets,
 * batting and keeping pads with their bolsters and straps.
 *
 * Each piece is one merged mesh (one draw call) riding on a bone, sized in metres in that bone's
 * own frame (actors.js undoes the rig's scale). All of a side's gear shares one small texture:
 * a row of colour cells and the side's flag (CK.Kits.drawGear), so a piece picks its colours by
 * texture coordinate and nothing needs its own material.
 *
 * Frames (from the rig): head: y up, z forward, origin at eye height; palm: y toward the fingers,
 * z out of the back of the hand, the thumb at -x on the right hand and +x on the left; lower leg:
 * y down the shin from the knee, the shin's front at -z.
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const T = THREE;
  // colour cells of the gear texture (CK.Kits.drawGear): u at the middle of each 16 px cell of 128
  const CELL = { white: 0, accent: 1, base: 2, pants: 3, dark: 4, steel: 5, helmet: 6, tan: 7 };
  const cellUV = c => [(CELL[c] * 16 + 8) / 128, 1 - 12 / 64];
  // the flag in the gear texture: x 4..52, y 30..62 of 128x64
  const FLAG = { u0: 4 / 128, u1: 52 / 128, v0: 1 - 62 / 64, v1: 1 - 30 / 64 };

  /** Merge parts [{ geo, m (Matrix4)?, cell? }] into one non-indexed geometry (position, normal, uv). */
  function merge(parts) {
    let n = 0;
    const gs = parts.map(p => { const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()); if (p.m) g.applyMatrix4(p.m); n += g.attributes.position.count; return [g, p]; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const [g, p] of gs) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (!g.attributes.normal) g.computeVertexNormals();
      nor.set(g.attributes.normal.array, o * 3);
      if (p.cell) { const [u, v] = cellUV(p.cell); for (let i = 0; i < c; i++) { uv[(o + i) * 2] = u; uv[(o + i) * 2 + 1] = v; } }
      else if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += c; g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  const M = (x, y, z, rx, ry, rz, sx, sy, sz) => new T.Matrix4().compose(new T.Vector3(x || 0, y || 0, z || 0), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx || 1, sy || 1, sz || 1));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /**
   * A shell: an ellipsoid (centre c, radii r) cut at a rim that depends on the azimuth a (0 = the
   * front): rim(a) is the polar angle from the top where the shell stops. uvAt(a, th) gives each
   * corner's texture coordinate (a patch can carry the flag). Built as separate quads so a flag patch
   * keeps a crisp edge.
   */
  function shell(c, r, rim, uvAt, segA, segT) {
    const pos = [], uv = [];
    const P = (a, th) => [c[0] + r[0] * Math.sin(th) * Math.sin(a), c[1] + r[1] * Math.cos(th), c[2] + r[2] * Math.sin(th) * Math.cos(a)];
    for (let i = 0; i < segA; i++) {
      const a0 = -Math.PI + (i / segA) * Math.PI * 2, a1 = -Math.PI + ((i + 1) / segA) * Math.PI * 2, am = (a0 + a1) / 2;
      for (let j = 0; j < segT; j++) {
        const f0 = j / segT, f1 = (j + 1) / segT;
        const th = (a, f) => rim(a) * f;
        const q = [[a0, th(a0, f0)], [a1, th(a1, f0)], [a1, th(a1, f1)], [a0, th(a0, f1)]];
        const uvq = q.map(([a, t]) => uvAt(a, t, am, (th(am, f0) + th(am, f1)) / 2));
        [[0, 2, 1], [0, 3, 2]].forEach(tri => tri.forEach(k => { pos.push(...P(q[k][0], q[k][1])); uv.push(...uvq[k]); }));
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    // smooth: the ellipsoid's own normals
    const nor = [];
    for (let i = 0; i < pos.length; i += 3) { const nx = (pos[i] - c[0]) / (r[0] * r[0]), ny = (pos[i + 1] - c[1]) / (r[1] * r[1]), nz = (pos[i + 2] - c[2]) / (r[2] * r[2]), l = Math.hypot(nx, ny, nz) || 1; nor.push(nx / l, ny / l, nz / l); }
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    return g;
  }
  /** A thin curved band (the peak of a helmet or cap, a hat's brim): from radius r0 to r1 round azimuths a0..a1, dropping by `drop`. */
  function brim(cy, cz, rx0, rz0, w, a0, a1, drop, seg) {
    const pos = [];
    const at = (a, k) => [Math.sin(a) * (rx0 + w * k), cy - drop * k, cz + Math.cos(a) * (rz0 + w * k)];
    for (let i = 0; i < seg; i++) {
      const u0 = a0 + (a1 - a0) * i / seg, u1 = a0 + (a1 - a0) * (i + 1) / seg;
      const q = [at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)];
      // top and underside, a few mm apart
      [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => pos.push(...q[k])));
      [[0, 2, 1], [0, 3, 2]].forEach(t => t.forEach(k => pos.push(q[k][0], q[k][1] - 0.006, q[k][2])));
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }
  /** A bar along a list of points (a grille bar). */
  function bar(points, r) {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)));
    return new T.TubeGeometry(curve, Math.max(4, points.length * 2), r, 4, false);
  }

  // ------------------------------------------------------------------ head gear
  // head gear is drawn about the eyes; the rig's head bone sits 0.078 m below them and 0.085 m behind (measured from the skin's inverse bind)
  const HEAD = { c: [0, 0.03, -0.045], y: 0.078, z: 0.085 };
  let _helmet = null, _cap = null, _hat = null;
  /** The batting helmet: shell (team colour, the flag on the front and the back), peak, grille, neck guard. */
  function helmetGeo() {
    if (_helmet) return _helmet;
    const c = HEAD.c, r = [0.122, 0.138, 0.15];
    const rim = a => { const s = smooth(0.5, 1.4, Math.abs(a)); return Math.PI * (0.43 + 0.22 * s + 0.03 * smooth(2.2, 3.0, Math.abs(a))); };
    const plain = cellUV('helmet');
    // the flag: a patch over the peak at the front, another low on the back
    const uvAt = (a, th, am, tm) => {
      const front = Math.abs(am) < 0.3 && tm > Math.PI * 0.27 && tm < Math.PI * 0.4, back = Math.abs(Math.abs(am) - Math.PI) < 0.36 && tm > Math.PI * 0.5 && tm < Math.PI * 0.62;
      if (!front && !back) return plain;
      const [a0, a1, t0, t1] = front ? [-0.3, 0.3, 0.27, 0.4] : [Math.PI - 0.36, Math.PI + 0.36, 0.5, 0.62];
      const aa = front ? a : (a < 0 ? a + Math.PI * 2 : a);
      const u = (aa - a0) / (a1 - a0), v = (th / Math.PI - t0) / (t1 - t0);
      return [FLAG.u0 + (front ? u : 1 - u) * (FLAG.u1 - FLAG.u0), FLAG.v1 - v * (FLAG.v1 - FLAG.v0)];
    };
    const parts = [{ geo: shell(c, r, rim, uvAt, 28, 8) }];
    // a raised ridge over the crown, front to back (the vents' spine)
    parts.push({ geo: new T.CylinderGeometry(0.012, 0.012, 0.24, 6, 1, false, 0, Math.PI), m: M(0, c[1] + r[1] - 0.004, c[2] - 0.01, Math.PI / 2, 0, Math.PI / 2, 1, 1, 0.8), cell: 'helmet' });
    // the peak: out from the front rim, a little down
    const fy = c[1] + r[1] * Math.cos(rim(0)) - 0.004;
    parts.push({ geo: brim(fy, c[2], r[0] * Math.sin(rim(0)) * 0.98, r[2] * Math.sin(rim(0)) * 0.98, 0.06, -1.05, 1.05, 0.018, 14), cell: 'helmet' });
    // the grille: three bars round the face below the eyes, a centre bar and two side bars down them, struts to the shell
    const bars = [-0.012, -0.05, -0.088], G = (b, y, k) => [Math.sin(b) * 0.118 * (k || 1), y, -0.005 + Math.cos(b) * 0.142 * (k || 1)];
    bars.forEach((y, i) => { const k = 1 - i * 0.04, pts = []; for (let s = 0; s <= 12; s++) pts.push(G(-1.3 + 2.6 * s / 12, y, k)); parts.push({ geo: bar(pts, 0.0045), cell: 'steel' }); });
    [-0.55, 0, 0.55].forEach(b => parts.push({ geo: bar([G(b, 0.0, 1.0), G(b, -0.05, 0.96), G(b, -0.095, 0.92)], 0.004), cell: 'steel' }));
    [-1.3, 1.3].forEach(b => parts.push({ geo: bar([[Math.sin(b) * 0.121, 0.04, -0.01 + Math.cos(b) * 0.13], G(b, -0.012, 1), G(b, -0.088, 0.92)], 0.005), cell: 'steel' }));
    // the neck guard: a padded curve low on the back
    const ng = [];
    for (let s = 0; s <= 10; s++) { const a = Math.PI - 0.95 + 1.9 * s / 10; ng.push([Math.sin(a) * 0.1, -0.075, c[2] + Math.cos(a) * 0.12]); }
    parts.push({ geo: bar(ng, 0.022), m: M(0, 0, 0, 0, 0, 0, 1, 1.4, 1), cell: 'dark' });
    // the side lugs where the grille bolts on
    [-1, 1].forEach(s => parts.push({ geo: new T.CylinderGeometry(0.014, 0.014, 0.01, 10), m: M(s * 0.12, 0.02, 0.01, 0, 0, Math.PI / 2), cell: 'steel' }));
    _helmet = merge(parts);
    return _helmet;
  }
  /** A cricket cap: six-panel dome, the side's colour, a button, a stiff peak; the flag on the front. */
  function capGeo() {
    if (_cap) return _cap;
    const c = [0, 0.045, -0.04], r = [0.112, 0.125, 0.145];
    const rim = a => Math.PI * (0.5 + 0.06 * smooth(1.5, 3.0, Math.abs(a)));
    const base = cellUV('base'), acc = cellUV('accent');
    const uvAt = (a, th, am, tm) => {
      if (Math.abs(am) < 0.32 && tm > Math.PI * 0.25 && tm < Math.PI * 0.4) {
        const u = (a + 0.32) / 0.64, v = (th / Math.PI - 0.25) / 0.15;
        return [FLAG.u0 + u * (FLAG.u1 - FLAG.u0), FLAG.v1 - v * (FLAG.v1 - FLAG.v0)];
      }
      // the panels' seams in the accent colour
      const seam = Math.abs(((am / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.46;
      return seam && tm < Math.PI * 0.45 ? acc : base;
    };
    const parts = [{ geo: shell(c, r, rim, uvAt, 28, 6) }];
    parts.push({ geo: new T.SphereGeometry(0.012, 8, 6), m: M(c[0], c[1] + r[1], c[2]), cell: 'accent' });
    const fy = c[1] + r[1] * Math.cos(rim(0)) + 0.002;
    parts.push({ geo: brim(fy, c[2], r[0] * 0.98, r[2] * 0.98, 0.07, -0.95, 0.95, 0.02, 12), cell: 'base' });
    _cap = merge(parts);
    return _cap;
  }
  /** The umpire's wide-brimmed hat. */
  function hatGeo() {
    if (_hat) return _hat;
    const c = [0, 0.05, -0.04], r = [0.11, 0.12, 0.14];
    const parts = [{ geo: shell(c, r, () => Math.PI * 0.5, () => cellUV('white'), 24, 5) }];
    parts.push({ geo: new T.CylinderGeometry(r[0] * 1.01, r[0] * 1.01, 0.022, 24, 1, true), m: M(c[0], c[1] + 0.012, c[2], 0, 0, 0, 1, 1, r[2] / r[0]), cell: 'dark' });
    parts.push({ geo: brim(c[1], c[2], r[0] * 0.98, r[2] * 0.98, 0.075, -Math.PI, Math.PI, 0.025, 28), cell: 'white' });
    _hat = merge(parts);
    return _hat;
  }

  // ------------------------------------------------------------------ hair styles
  const _hair = {};
  /**
   * Extra hair for a style (the model's own is 'short'), in the head-gear frame, all of it mapped to
   * the hair cell of the player's kit canvas (CK.Kits.LAYOUT.hair) so it takes his hair colour:
   * quiff (swept up at the front), long (down to the collar at the back and sides), curly (a thick
   * bumpy mop).
   */
  function hairGeo(style) {
    if (_hair[style]) return _hair[style];
    const L = CK.Kits.LAYOUT, H = L.hair, hu = (H[0] + H[2] / 2) / L.W, hv = 1 - (H[1] + H[3] / 2) / L.H;
    const flat = () => [hu, hv];
    let g;
    if (style === 'quiff') {
      g = merge([
        { geo: new T.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), m: M(0, 0.122, 0.0, -0.3, 0, 0, 0.082, 0.034, 0.066) },
        { geo: new T.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), m: M(0, 0.13, -0.055, 0.1, 0, 0, 0.088, 0.026, 0.08) },
      ]);
    } else if (style === 'long') {
      g = shell([0, 0.03, -0.065], [0.112, 0.128, 0.132], a => Math.PI * (0.2 + 0.62 * smooth(0.9, 1.9, Math.abs(a))), flat, 24, 8);
    } else {
      // curly: a fuller crown with knots of curls over it
      const parts = [{ geo: shell([0, 0.06, -0.06], [0.112, 0.105, 0.135], a => Math.PI * (0.42 + 0.14 * smooth(1.0, 2.2, Math.abs(a))), flat, 20, 6) }];
      let s = 7;
      const rnd = () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000; };
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2, th = rnd() * Math.PI * 0.45;
        if (Math.abs(a) < 0.5 && th > Math.PI * 0.3) continue;
        parts.push({ geo: new T.IcosahedronGeometry(0.03, 0), m: M(Math.sin(th) * Math.sin(a) * 0.11, 0.06 + Math.cos(th) * 0.105, -0.06 + Math.sin(th) * Math.cos(a) * 0.135) });
      }
      g = merge(parts);
    }
    // faceted like the model's own hair, every corner on the hair cell
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, hu, hv);
    uv.needsUpdate = true;
    _hair[style] = g;
    return g;
  }

  // ------------------------------------------------------------------ hands
  const _gloves = {};
  /**
   * A batting glove (or the keeper's gauntlet) for side s (+1 right, -1 left), in the palm's frame:
   * the palm block, the finger rolls down the back of the fingers, the thumb, the cuff.
   */
  function gloveGeo(s, keeper) {
    const key = s + (keeper ? 'k' : 'b');
    if (_gloves[key]) return _gloves[key];
    const parts = [];
    const box = (w, h, d, x, y, z, cell, rx) => parts.push({ geo: new T.BoxGeometry(w, h, d, 1, 1, 1), m: M(x, y, z, rx || 0), cell });
    const cyl = (r, l, x, y, z, rx, rz, cell, sx, sz) => parts.push({ geo: new T.CylinderGeometry(r, r, l, 8), m: M(x, y, z, rx || 0, 0, rz || 0, sx || 1, 1, sz || 1), cell });
    if (!keeper) {
      cyl(0.044, 0.05, 0, -0.012, 0.002, 0, 0, 'accent', 1, 0.8);                    // cuff
      box(0.088, 0.085, 0.05, 0, 0.045, 0.004, 'white');                             // palm and back
      box(0.07, 0.03, 0.012, 0, 0.04, 0.03, 'accent');                               // the strap across the back
      for (let i = 0; i < 4; i++) cyl(0.0115, 0.08, -0.033 + i * 0.022, 0.125, 0.014, 0, 0, 'white');   // finger rolls
      box(0.084, 0.08, 0.022, 0, 0.122, -0.008, 'white');                            // the fingers' insides
      cyl(0.014, 0.065, -s * 0.05, 0.06, -0.01, 0, s * 0.5, 'white');                // thumb
      cyl(0.012, 0.03, -s * 0.062, 0.09, -0.012, 0, s * 0.5, 'accent');              // thumb tip guard
    } else {
      cyl(0.05, 0.07, 0, -0.02, 0, 0, 0, 'accent', 1, 0.85);
      box(0.11, 0.1, 0.06, 0, 0.05, 0, 'white');
      box(0.112, 0.11, 0.05, 0, 0.15, 0.002, 'white');                               // the big mitt
      box(0.1, 0.12, 0.012, 0, 0.13, -0.03, 'tan');                                  // leather palm
      box(0.09, 0.05, 0.012, 0, 0.06, 0.032, 'accent');
      cyl(0.022, 0.09, -s * 0.07, 0.08, -0.01, 0, s * 0.45, 'white');                // thumb
      box(0.04, 0.06, 0.006, -s * 0.06, 0.15, -0.012, 'tan');                        // webbing to the thumb
    }
    _gloves[key] = merge(parts);
    return _gloves[key];
  }

  // ------------------------------------------------------------------ legs
  const _pads = {};
  /** A batting pad (or the keeper's shorter one) on the lower leg: bolsters, knee roll, wings, straps. */
  function padGeo(keeper) {
    const key = keeper ? 'k' : 'b';
    if (_pads[key]) return _pads[key];
    const parts = [], top = keeper ? 0.02 : -0.03, bot = keeper ? 0.36 : 0.41, L = bot - top;
    const roll = (r, l, x, y, z, rx, rz, sz, cell) => parts.push({ geo: new T.CylinderGeometry(r, r, l, 10, 1), m: M(x, y, z, rx || 0, 0, rz || 0, 1, 1, sz || 1), cell: cell || 'white' });
    // three vertical bolsters down the front of the shin
    [-0.046, 0, 0.046].forEach(x => roll(0.025, L, x, top + L / 2, -0.07, 0, 0, 0.72));
    // the backing behind them, wrapping the shin, and the wings at the sides
    parts.push({ geo: new T.BoxGeometry(0.14, L, 0.03), m: M(0, top + L / 2, -0.05), cell: 'white' });
    [-1, 1].forEach(s => parts.push({ geo: new T.BoxGeometry(0.02, L * 0.9, 0.07), m: M(s * 0.078, top + L * 0.52, -0.03, 0, s * 0.35, 0), cell: 'white' }));
    // the knee roll: two short bolsters across, above the knee
    if (!keeper) [top - 0.03, top - 0.075].forEach((y, i) => roll(0.026 - i * 0.003, 0.13 - i * 0.02, 0, y, -0.065, 0, Math.PI / 2, 0.8));
    else roll(0.024, 0.12, 0, top - 0.02, -0.065, 0, Math.PI / 2, 0.8);
    // the instep flap over the shoe
    parts.push({ geo: new T.BoxGeometry(0.11, 0.05, 0.03), m: M(0, bot + 0.02, -0.06, 0.4), cell: 'white' });
    // straps round the back of the calf (the side's colour on the buckles)
    (keeper ? [0.1, 0.27] : [0.06, 0.2, 0.34]).forEach(y => {
      parts.push({ geo: new T.BoxGeometry(0.15, 0.022, 0.012), m: M(0, y, 0.088), cell: 'white' });
      [-1, 1].forEach(s => parts.push({ geo: new T.BoxGeometry(0.012, 0.024, 0.11), m: M(s * 0.07, y, 0.035), cell: 'white' }));
      parts.push({ geo: new T.BoxGeometry(0.03, 0.028, 0.01), m: M(0.05, y, 0.095), cell: 'accent' });
    });
    _pads[key] = merge(parts);
    return _pads[key];
  }

  // ------------------------------------------------------------------ the gear texture (per side, shared)
  const _tex = {};
  function texture(teamId) {
    if (_tex[teamId]) return _tex[teamId];
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    CK.Kits.drawGear(c.getContext('2d'), teamId);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
    t.generateMipmaps = false; t.minFilter = T.LinearFilter;   // solid cells: no blending between them far away
    _tex[teamId] = t;
    return t;
  }

  CK.Gear = { helmetGeo, capGeo, hatGeo, gloveGeo, padGeo, hairGeo, texture, merge, CELL, HEAD };
})();
