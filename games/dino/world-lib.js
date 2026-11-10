// Ironfern world (Stage A), pure part: random + noise, path helpers, terrain height functions,
// scattering with exclusion zones, ray tests, and the five mission layouts as plain data
// (stands, rails, spawns, points + the anchors world.js dresses). No THREE here; Node-testable.
(function (root) {
  'use strict';
  const EYE = 1.7;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ================================================================ random + noise
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0,1)
  }
  /** Smooth value noise in [-1, 1]. */
  function vnoise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return (lerp(lerp(a, b, ux), lerp(c, d, ux), uz)) * 2 - 1;
  }
  /** Fractal sum of value noise, normalised to [-1, 1]. */
  function fbm(x, z, seed, oct) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < (oct || 4); i++) { s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1, seed + i * 31); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  // ================================================================ paths
  function polyLength(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); return L; }
  /** Evenly spaced points (xz arc length) along a polyline; keeps both ends; y interpolated if present. */
  function resample(p, step) {
    const L = polyLength(p), n = Math.max(1, Math.round(L / step)), out = [];
    let seg = 0, acc = 0;
    for (let k = 0; k <= n; k++) {
      const want = L * k / n;
      while (seg < p.length - 2 && acc + Math.hypot(p[seg + 1].x - p[seg].x, p[seg + 1].z - p[seg].z) < want) {
        acc += Math.hypot(p[seg + 1].x - p[seg].x, p[seg + 1].z - p[seg].z); seg++;
      }
      const a = p[seg], b = p[seg + 1] || a, sl = Math.hypot(b.x - a.x, b.z - a.z) || 1, t = clamp((want - acc) / sl, 0, 1);
      const q = { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
      if (a.y != null) q.y = lerp(a.y, b.y != null ? b.y : a.y, t);
      out.push(q);
    }
    out[out.length - 1] = Object.assign({}, p[p.length - 1]);
    return out;
  }
  /** Centripetal-free uniform Catmull-Rom through every control point; perSeg samples per segment. */
  function catmull(p, perSeg) {
    const n = p.length, S = perSeg || 8, out = [];
    const g = i => p[clamp(i, 0, n - 1)];
    for (let i = 0; i < n - 1; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let s = 0; s < S; s++) {
        const t = s / S, t2 = t * t, t3 = t2 * t;
        const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
        const q = { x: f('x'), z: f('z') }; if (p1.y != null) q.y = f('y');
        out.push(q);
      }
    }
    out.push(Object.assign({}, p[n - 1]));
    return out;
  }
  /** Nearest point on a polyline: { d, t (arc length there), px, pz, i, u (0..1 in segment), side (+1 right of travel) }. */
  function distToPolyline(x, z, p) {
    let best = { d: Infinity }, acc = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1e-9, L = Math.sqrt(L2);
      const u = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1), px = a.x + ex * u, pz = a.z + ez * u;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.d) {
        const cr = ex * (z - a.z) - ez * (x - a.x); // >0: right of travel (y up)
        best = { d, t: acc + L * u, px, pz, i, u, side: cr > 0 ? 1 : -1 };
      }
      acc += L;
    }
    return best;
  }
  /** Yaw (core convention: 0 looks toward -Z, positive turns left) that looks from a to b. */
  function yawTo(a, b) { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }
  function yawDir(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }

  // ================================================================ terrain
  /**
   * spec: { seed, base, amp, scale, features: [...] }
   *   hill  {x,z,r,h}           gaussian bump (h may be negative)
   *   slope {axis:'x'|'z', from, to, h}   smooth step of h between two coordinates
   *   pad   {x,z,r | w,d, h, blend}       flatten to h (circle or w×d rectangle)
   *   ramp  {x0,x1,z0,z1,h0,h1,blend}     linear slope h0→h1 along z in a rectangle
   *   road  {pts:[{x,z,y?}], width, shoulder, raise}  level across, follows the base terrain (or y) along
   *   river {pts, width, depth, bank, level}           carved channel; water surface at level
   */
  function makeTerrain(spec) {
    spec = spec || {};
    const seed = spec.seed || 1, base = spec.base || 0, amp = spec.amp == null ? 2 : spec.amp, scale = spec.scale || 60;
    const F = spec.features || [];
    const add = F.filter(f => f.type === 'hill' || f.type === 'slope');
    const shape = F.filter(f => f.type === 'pad' || f.type === 'ramp' || f.type === 'road');
    const rivers = F.filter(f => f.type === 'river');
    function baseH(x, z) {
      let h = base + (amp ? amp * fbm(x / scale, z / scale, seed, 4) + amp * 0.12 * vnoise(x / 7, z / 7, seed + 99) : 0);
      for (const f of add) {
        if (f.type === 'hill') { const dx = x - f.x, dz = z - f.z; h += f.h * Math.exp(-(dx * dx + dz * dz) / (f.r * f.r)); }
        else { const c = f.axis === 'x' ? x : z; h += f.h * smooth(f.from, f.to, c); }
      }
      return h;
    }
    function rectDist(f, x, z) {
      const dx = Math.max(f.x0 - x, 0, x - f.x1), dz = Math.max(f.z0 - z, 0, z - f.z1);
      return Math.hypot(dx, dz);
    }
    function roadAt(f, x, z) {
      const n = distToPolyline(x, z, f.pts), hw = f.width / 2;
      const w = 1 - smooth(hw, hw + (f.shoulder || 2), n.d);
      if (w <= 0) return { w: 0, n };
      const a = f.pts[n.i], b = f.pts[n.i + 1];
      const y = a.y != null ? lerp(a.y, b.y != null ? b.y : a.y, n.u) : preRoad(n.px, n.pz) + (f.raise || 0);
      return { w, y, n };
    }
    /** Base terrain plus pads and ramps: roads are levelled to this along their centre line. */
    function preRoad(x, z) {
      let h = baseH(x, z);
      for (const f of shape) if (f.type !== 'road') h = shapeOne(f, h, x, z);
      return h;
    }
    function shapeOne(f, h, x, z) {
      if (f.type === 'pad') {
        const d = f.w ? rectDist({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, z0: f.z - f.d / 2, z1: f.z + f.d / 2 }, x, z) : Math.max(0, Math.hypot(x - f.x, z - f.z) - f.r);
        const w = 1 - smooth(0, f.blend || 3, d); return w > 0 ? lerp(h, f.h, w) : h;
      }
      const d = rectDist(f, x, z), w = 1 - smooth(0, f.blend || 2, d);
      return w > 0 ? lerp(h, lerp(f.h0, f.h1, clamp((z - f.z0) / (f.z1 - f.z0), 0, 1)), w) : h;
    }
    function height(x, z) {
      let h = baseH(x, z);
      for (const f of shape) {
        if (f.type === 'pad') {
          const d = f.w ? rectDist({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, z0: f.z - f.d / 2, z1: f.z + f.d / 2 }, x, z) : Math.max(0, Math.hypot(x - f.x, z - f.z) - f.r);
          const w = 1 - smooth(0, f.blend || 3, d); if (w > 0) h = lerp(h, f.h, w);
        } else if (f.type === 'ramp') {
          const d = rectDist(f, x, z), w = 1 - smooth(0, f.blend || 2, d);
          if (w > 0) h = lerp(h, lerp(f.h0, f.h1, clamp((z - f.z0) / (f.z1 - f.z0), 0, 1)), w);
        } else {
          const r = roadAt(f, x, z); if (r.w > 0) h = lerp(h, r.y, r.w);
        }
      }
      for (const f of rivers) {
        const n = distToPolyline(x, z, f.pts), hw = f.width / 2, out = hw + (f.bank || 4);
        if (n.d < out) {
          const t = n.d / out, target = f.level - f.depth * (1 - t * t);
          const w = 1 - smooth(hw * 0.6, out, n.d);
          h = Math.min(h, lerp(h, target, w));
        }
      }
      return h;
    }
    /** Ground-cover weights for the splat shader: { road, river, roadU, roadV }. */
    function mask(x, z) {
      let road = 0, roadU = 0, roadV = 0, river = 0;
      for (const f of shape) if (f.type === 'road') {
        const n = distToPolyline(x, z, f.pts), hw = f.width / 2;
        const w = 1 - smooth(hw * 0.75, hw + (f.shoulder || 2) * 0.5, n.d);
        if (w > road) { road = w; roadU = n.side * n.d / f.width; roadV = n.t / f.width; }
      }
      for (const f of rivers) { const n = distToPolyline(x, z, f.pts); river = Math.max(river, 1 - smooth(f.width / 2, f.width / 2 + (f.bank || 4) + 3, n.d)); }
      return { road, river, roadU, roadV };
    }
    return { height, baseH, mask, spec };
  }

  /** Height samples on an n×n grid (cell metres) — the terrain mesh uses exactly these. */
  function heightGrid(fn, x0, z0, size, cell) {
    const n = Math.round(size / cell) + 1, h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = fn(x0 + i * cell, z0 + j * cell);
    return { x0, z0, cell, n, h, fn };
  }
  /** Height on the grid's triangles (diagonal from (i,j+1) to (i+1,j)); analytic outside. */
  function gridHeight(g, x, z) {
    const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
    if (fx < 0 || fz < 0 || fx > g.n - 1 || fz > g.n - 1) return g.fn(x, z);
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= g.n - 1) i = g.n - 2; if (j >= g.n - 1) j = g.n - 2;
    const u = fx - i, v = fz - j, n = g.n, H = g.h;
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // ================================================================ rays
  /** March a ray over a height function; refine by bisection. -> { point, normal, dist } | null */
  function rayHeightfield(hf, o, d, maxDist, step) {
    step = step || 0.75;
    let prev = 0, pa = o.y - hf(o.x, o.z);
    if (pa < 0) return null;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist), x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt;
      const a = y - hf(x, z);
      if (a <= 0) {
        let lo = prev, hi = tt;
        for (let k = 0; k < 18; k++) {
          const m = (lo + hi) / 2, mx = o.x + d.x * m, mz = o.z + d.z * m;
          if (o.y + d.y * m - hf(mx, mz) > 0) lo = m; else hi = m;
        }
        const px = o.x + d.x * hi, pz = o.z + d.z * hi, e = 0.25;
        const nx = hf(px - e, pz) - hf(px + e, pz), nz = hf(px, pz - e) - hf(px, pz + e), ny = 2 * e, L = Math.hypot(nx, ny, nz);
        return { point: { x: px, y: hf(px, pz), z: pz }, normal: { x: nx / L, y: ny / L, z: nz / L }, dist: hi };
      }
      if (tt >= maxDist) break;
      prev = tt; pa = a;
    }
    return null;
  }
  /** Ray vs a vertical cylinder {x,z,r,y0,y1}. -> { point, normal, dist } | null */
  function rayCylinder(o, d, c, maxDist) {
    const ox = o.x - c.x, oz = o.z - c.z, a = d.x * d.x + d.z * d.z;
    if (a < 1e-12) return null;
    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c.r * c.r, disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxDist) return null;
    const y = o.y + d.y * t;
    if (y < c.y0 || y > c.y1) return null;
    const px = o.x + d.x * t, pz = o.z + d.z * t;
    return { point: { x: px, y, z: pz }, normal: { x: (px - c.x) / c.r, y: 0, z: (pz - c.z) / c.r }, dist: t };
  }

  // ================================================================ scattering
  /** zones: [{circle:{x,z,r}} | {rect:[x0,z0,x1,z1]} | {poly:[{x,z}], r}] */
  function excluded(x, z, zones) {
    if (!zones) return false;
    for (const zn of zones) {
      if (zn.circle) { if (Math.hypot(x - zn.circle.x, z - zn.circle.z) < zn.circle.r) return true; }
      else if (zn.rect) { const r = zn.rect; if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true; }
      else if (zn.poly) { if (distToPolyline(x, z, zn.poly).d < zn.r) return true; }
    }
    return false;
  }
  /**
   * Dart throwing with a spatial hash. opts: { seed, count, bounds:[x0,z0,x1,z1], minDist, exclude, density(x,z)->0..1,
   * scale:[min,max], tries } -> [{x, z, rot, s}]
   */
  function scatter(o) {
    const R = rng(o.seed || 1), [x0, z0, x1, z1] = o.bounds, md = o.minDist || 0, cs = Math.max(md, 0.5);
    const grid = new Map(), out = [], tries = o.tries || o.count * 25, sc = o.scale || [1, 1];
    const key = (i, j) => i * 73856093 ^ j * 19349663;
    for (let k = 0; k < tries && out.length < o.count; k++) {
      const x = lerp(x0, x1, R()), z = lerp(z0, z1, R()), keep = R();
      if (o.density && keep > o.density(x, z)) continue;
      if (excluded(x, z, o.exclude)) continue;
      const ci = Math.floor(x / cs), cj = Math.floor(z / cs);
      let ok = true;
      if (md > 0) {
        for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1 && ok; dj++) {
          const cell = grid.get(key(ci + di, cj + dj));
          if (cell) for (const q of cell) if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < md * md) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const p = { x, z, rot: R() * Math.PI * 2, s: lerp(sc[0], sc[1], R()) };
      out.push(p);
      const kk = key(ci, cj); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(p);
    }
    return out;
  }

  // ================================================================ mission layouts
  const P = (x, z) => ({ x, z });
  function finish(d, opts) {
    const ter = d.terrain;
    const hAt = d.heightAt || ter.height;
    d.heightAt = hAt;
    const g = (p, lift) => ({ x: p.x, y: (p.y != null ? p.y : hAt(p.x, p.z)) + (lift || 0), z: p.z });
    for (const k in d.stands) {
      const s = d.stands[k], floor = s.floor != null ? s.floor : hAt(s.x, s.z) + (s.up || 0);
      d.stands[k] = { pos: { x: s.x, y: floor + EYE, z: s.z }, floor, yaw: s.yaw, pitch: s.pitch || 0, arc: s.arc,
        pitchMin: s.pitchMin == null ? -0.55 : s.pitchMin, pitchMax: s.pitchMax == null ? 0.4 : s.pitchMax };
    }
    for (const k in d.spawns) {
      const s = d.spawns[k], fixed = s.air || s.elevated;
      s.points = s.points.map(p => fixed && p.y != null ? Object.assign({}, p) : g(p));
      if (s.path) s.path = (s.raw ? s.path : resample(s.path, 4)).map(p => p.y != null && (fixed || s.raw) ? Object.assign({}, p) : g(p));
      delete s.raw;
    }
    for (const k in d.points) d.points[k] = g(d.points[k]);
    for (const k in d.rails) d.rails[k] = resample(d.rails[k], 6).map(p => g(p));
    return d;
  }
  /** Ground points from a stand toward yaw at distances, offset sideways. */
  function ahead(s, yaw, dist, side) { const f = yawDir(yaw); return P(s.x + f.x * dist - f.z * (side || 0), s.z + f.z * dist + f.x * (side || 0)); }

  const MISSIONS = {
    // ---------------------------------------------------------- Gate 3: gatehouse over a jungle road
    gate3() {
      const road = [P(0, 60), P(0, 20), P(0, 0), P(0, -22), P(3, -42), P(-1, -62), P(-8, -82), P(-17, -100), P(-30, -125), P(-46, -150)];
      const terrain = makeTerrain({ seed: 11, amp: 2.2, scale: 45, features: [
        { type: 'hill', x: -60, z: -40, r: 40, h: 6 }, { type: 'hill', x: 70, z: -70, r: 45, h: 8 }, { type: 'hill', x: 20, z: -170, r: 60, h: 10 },
        { type: 'pad', x: 0, z: 0, w: 40, d: 12, h: 0, blend: 6 },
        { type: 'road', pts: road, width: 7, shoulder: 4 },
      ] });
      const s = { x: 0, z: -0.6 };
      // practice plates: all six in view from the gate at the start, fanned across the road and its
      // verges at 12-36 m, each on a cleared patch so no fern hides it
      const gy = yawTo(s, P(-2, -60));
      const tgt = [[0.5, 12], [-0.62, 14], [0.22, 20], [-0.18, 25], [0.04, 30], [-0.3, 36]].map(([a, dd]) => ahead(s, gy + a, dd));
      const roadPath = resample(road.slice(2), 1).filter(q => Math.hypot(q.x, q.z) <= 92 && q.z < -6).reverse();
      const roadStart = roadPath.findIndex(q => Math.hypot(q.x, q.z) <= 52); // close enough to read a spitter
      const d = {
        id: 'gate3', terrain, size: 420, center: P(0, -60), seed: 11,
        env: { sky: 'day', fog: 0.0085, sunElev: 0.75, sunAz: 0.9, exposure: 1.0, amb: ['jungle_day', 'cicadas'] },
        stands: { gate: { x: s.x, z: s.z, up: 2.5, yaw: yawTo(s, P(-2, -60)), pitch: -0.05, arc: 1.1, pitchMin: -0.6, pitchMax: 0.35 } },
        rails: {},
        spawns: {
          road: { points: [roadPath[roadStart], roadPath[roadStart + 6], roadPath[roadStart + 3]].map(q => P(q.x, q.z)), path: roadPath.slice(roadStart).concat([P(0, -6)]) },
          leftBrush: { points: [P(-19, -20), P(-24, -28), P(-16, -31), P(-27, -16)], path: [P(-19, -20), P(-11, -14), P(-4, -8), P(-1, -5)] },
          rightBrush: { points: [P(19, -21), P(24, -27), P(16, -32), P(27, -15)], path: [P(19, -21), P(11, -14), P(4, -8), P(1, -5)] },
          targets: { points: tgt },
        },
        points: {},
        roads: [{ pts: road, width: 7 }],
        clear: [{ rect: [-22, -8, 22, 8] }, { poly: road, r: 5.2, trees: true }].concat(tgt.map(q => ({ circle: { x: q.x, z: q.z, r: 2.8 } }))),
        focus: [P(0, 0), P(0, -40), P(-8, -82), P(-25, -120)],
        shadow: { x: -3, z: -40, r: 75 },
      };
      return finish(d);
    },

    // ---------------------------------------------------------- Overwatch: ranger tower over a valley
    overwatch() {
      const terrain = makeTerrain({ seed: 23, amp: 1.6, scale: 55, features: [
        { type: 'hill', x: 0, z: 14, r: 34, h: 6 },
        { type: 'hill', x: -150, z: -110, r: 60, h: 18 }, { type: 'hill', x: 160, z: -120, r: 60, h: 20 },
        { type: 'hill', x: 20, z: -320, r: 90, h: 26 }, { type: 'hill', x: 105, z: -125, r: 18, h: 5 },
        { type: 'pad', x: 0, z: 4, r: 6, h: 6.2, blend: 10 },
      ] });
      const s = { x: 0, z: 4 };
      const sv = P(-27, -63);
      const herdC = P(6, -140);
      const R = rng(5), herd = [];
      while (herd.length < 12) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 24, x = herdC.x + Math.cos(a) * r, z = herdC.z + Math.sin(a) * r * 0.8;
        const dd = Math.hypot(x - s.x, z - s.z); if (dd >= 114 && dd <= 166) herd.push(P(x, z));
      }
      const d = {
        id: 'overwatch', terrain, size: 560, center: P(0, -110), seed: 23,
        env: { sky: 'day', fog: 0.0038, sunElev: 0.62, sunAz: 0.7, exposure: 1.0, amb: ['jungle_day', 'cicadas'] },
        stands: { tower: { x: s.x, z: s.z, up: 14, yaw: yawTo(s, P(-4, -100)), pitch: -0.14, arc: 0.9, pitchMin: -0.8, pitchMax: 0.3 } },
        rails: {},
        spawns: {
          herd: { points: herd, path: [herdC] },
          stalkA: { points: [P(-112, -112)], path: [P(-112, -112), P(-100, -100), P(-82, -92), P(-60, -80), P(-42, -70), P(-31, -65)] }, // the first one gives time to find the scope
          stalkB: { points: [P(22, -232)], path: [P(22, -232), P(14, -190), P(6, -148), P(-8, -108), P(-24, -70)] },
          stalkC: { points: [P(92, -118)], path: [P(92, -118), P(64, -100), P(34, -86), P(4, -74), P(-22, -66)] },
        },
        points: { survivors: sv },
        roads: [{ pts: [P(0, 40), P(-6, 20), P(-14, -10), P(-24, -40), P(-30, -70), P(-40, -110), P(-70, -150)], width: 5 }],
        clear: [{ circle: { x: 0, z: 4, r: 9 } }, { circle: { x: sv.x, z: sv.z, r: 7 } }],
        focus: [P(0, 4), P(-27, -63), P(6, -140)],
        shadow: { x: -5, z: -95, r: 140 },
        herdC,
      };
      d.terrain.spec.features.push({ type: 'road', pts: d.roads[0].pts, width: 4.5, shoulder: 3 });
      return finish(d);
    },

    // ---------------------------------------------------------- The Pens: jeep through the paddocks
    pens() {
      const B = { x: 20, z0: -112, z1: -148 };
      const road = [P(0, 40), P(0, 0), P(0, -30), P(6, -60), P(16, -90), P(20, -104), P(20, -112), P(20, -148), P(21, -156), P(28, -175), P(20, -205), P(5, -225), P(0, -238), P(-2, -275)];
      const river = [P(-260, -116), P(-140, -126), P(-40, -124), P(20, -130), P(90, -137), P(180, -128), P(280, -120)];
      const feats = [
        { type: 'slope', axis: 'z', from: -150, to: -232, h: 7 },
        { type: 'hill', x: -70, z: -40, r: 45, h: 4 }, { type: 'hill', x: 80, z: -30, r: 50, h: 5 },
        { type: 'hill', x: 60, z: -260, r: 50, h: 10 }, { type: 'hill', x: -60, z: -280, r: 50, h: 8 },
        { type: 'pad', x: 0, z: -248, w: 54, d: 34, h: 7.2, blend: 8 },
        { type: 'road', pts: road, width: 6.5, shoulder: 4 },
        { type: 'river', pts: river, width: 20, depth: 3.2, bank: 6.5, level: -1.6 },
      ];
      const terrain = makeTerrain({ seed: 37, amp: 1.4, scale: 50, features: feats });
      const deckY = (x, z) => {
        if (Math.abs(x - B.x) > 3.2 || z > B.z0 + 0.5 || z < B.z1 - 0.5) return null;
        const t = (z - B.z0) / (B.z1 - B.z0);
        const y0 = terrain.baseH(B.x, B.z0), y1 = terrain.baseH(B.x, B.z1);
        return lerp(y0, y1, t) + Math.sin(Math.PI * clamp(t, 0, 1)) * 0.5 + 0.12;
      };
      const heightAt = (x, z) => { const h = terrain.height(x, z), dk = deckY(x, z); return dk != null ? Math.max(h, dk) : h; };
      const s1 = P(0, 0), s2 = P(20, -130), s3 = P(0, -238);
      const rail1 = road.slice(1, 7).concat([s2]);
      const rail2 = [s2, P(20, -148), P(21, -156), P(28, -175), P(20, -205), P(5, -225), s3];
      const roofY = 7.2 + 4.6;
      const d = {
        id: 'pens', terrain, heightAt, deckY, size: 600, center: P(10, -130), seed: 37,
        env: { sky: 'overcast', fog: 0.0075, sunElev: 0.55, sunAz: 1.0, exposure: 0.95, rain: true, amb: ['jungle_day', 'rain', 'music_battle'] },
        stands: {
          pens1: { x: s1.x, z: s1.z, yaw: 0, pitch: -0.04, arc: 1.4 },
          pens2: { x: s2.x, z: s2.z, yaw: yawTo(s2, P(20, -200)), pitch: 0.02, arc: 1.5, pitchMax: 0.6 },
          pens3: { x: s3.x, z: s3.z, yaw: 0, pitch: 0, arc: 1.5, pitchMax: 0.5 },
        },
        rails: { drive1: rail1, drive2: rail2 },
        spawns: {
          pens1Left: { points: [P(-24, -18), P(-32, -26), P(-28, -8)], path: [P(-24, -18), P(-14, -14), P(-7, -12.5), P(-2.5, -11), P(-1.5, -5)] },
          pens1Right: { points: [P(25, -16), P(33, -24), P(29, -6)], path: [P(25, -16), P(14, -13), P(7, -11.5), P(2.5, -11), P(1.5, -5)] },
          pens1Front: { points: [P(1, -46), P(-2, -54), P(3, -58)], path: road.slice(2, 4).reverse().concat([P(0, -6)]).map((q, i) => i === 0 ? P(1, -46) : q) },
          river: { air: true, raw: true,
            points: [{ x: -50, y: 20, z: -126 }, { x: 75, y: 21, z: -134 }], // close enough to be in the fight within a few seconds
            path: [{ x: -110, y: 22, z: -126 }, { x: -60, y: 18, z: -124 }, { x: -15, y: 13, z: -128 }, { x: 12, y: 8, z: -129 }, { x: 20, y: 4.5, z: -130 }] },
          pens2Banks: { points: [P(-8, -148), P(52, -150), P(-16, -152), P(46, -154)], path: [P(-8, -148), P(6, -147), P(16, -145), P(20, -138)] },
          pens3Left: { points: [P(-27, -250), P(-31, -244)], path: [P(-27, -250), P(-19, -249), P(-11, -246), P(-2, -241)] },
          pens3Right: { points: [P(27, -248), P(31, -242)], path: [P(27, -248), P(19, -246.8), P(9.5, -245.8), P(2, -241)] },   // clear of the east shed's corner
          pens3Roof: { elevated: true, raw: true, points: [{ x: 6.5, y: roofY, z: -251 }],
            path: [{ x: 6.5, y: roofY, z: -251 }, { x: 4, y: 7.2, z: -246 }, { x: 1.5, y: 7.2, z: -241.5 }] },
        },
        points: {},
        roads: [{ pts: road, width: 6.5 }], river: { pts: river, width: 20, level: -1.6 }, bridge: B,
        clear: [{ poly: road, r: 6, trees: true }, { rect: [-27, -266, 27, -230] }],
        focus: road.slice(1, 13),
        shadow: { x: 10, z: -125, r: 70 },
      };
      return finish(d);
    },

    // ---------------------------------------------------------- Horn and Plate: open field, barrier on a rise
    horn() {
      const terrain = makeTerrain({ seed: 51, amp: 1.0, scale: 70, features: [
        { type: 'hill', x: 0, z: 8, r: 28, h: 2.6 },
        { type: 'hill', x: -170, z: -60, r: 70, h: 14 }, { type: 'hill', x: 180, z: -90, r: 70, h: 16 }, { type: 'hill', x: 0, z: -290, r: 90, h: 22 },
        { type: 'pad', x: 0, z: 0.5, w: 12, d: 6, h: 2.3, blend: 8 },
      ] });
      const s = { x: 0, z: 0.5 };
      const lane = (pts) => ({ points: [pts[0]], path: pts });
      const d = {
        id: 'horn', terrain, size: 560, center: P(0, -80), seed: 51,
        env: { sky: 'day', fog: 0.0042, sunElev: 0.5, sunAz: 0.6, exposure: 1.0, amb: ['cicadas', 'jungle_day'] },
        stands: { field: { x: s.x, z: s.z, yaw: 0, pitch: -0.03, arc: 1.2, pitchMin: -0.45 } },
        rails: {},
        spawns: {
          laneA: lane([P(0, -120), P(1, -80), P(0, -40), P(0, -4)]),
          laneB: lane([P(-64, -89), P(-44, -60), P(-22, -30), P(-3, -4)]),
          laneC: lane([P(64, -89), P(44, -60), P(22, -30), P(3, -4)]),
          flankLeft: { points: [P(-40, -12), P(-46, -22), P(-36, -26)], path: [P(-40, -12), P(-24, -7), P(-12, -3), P(-3, -1)] },
          flankRight: { points: [P(41, -11), P(46, -21), P(36, -27)], path: [P(41, -11), P(24, -7), P(12, -3), P(3, -1)] },
        },
        points: {},
        roads: [{ pts: [P(-120, 30), P(-60, 22), P(-20, 12), P(10, 10), P(70, 18), P(140, 10)], width: 5 }],
        clear: [{ circle: { x: 0, z: 0, r: 9 } }],
        focus: [P(0, 0), P(0, -60), P(0, -120)],
        shadow: { x: 0, z: -55, r: 110 },
      };
      ['laneA', 'laneB', 'laneC'].forEach(k => d.clear.push({ poly: d.spawns[k].path, r: 7 }));
      d.terrain.spec.features.push({ type: 'road', pts: d.roads[0].pts, width: 4.5, shoulder: 3 });
      return finish(d);
    },

    // ---------------------------------------------------------- Apex: visitor-centre plaza at dusk
    apex() {
      const top = 3.0;
      const terrain = makeTerrain({ seed: 67, amp: 1.2, scale: 50, features: [
        { type: 'hill', x: -120, z: 40, r: 70, h: 10 }, { type: 'hill', x: 130, z: 10, r: 70, h: 12 },
        { type: 'pad', x: 0, z: -42, w: 84, d: 66, h: 0, blend: 10 },
        { type: 'pad', x: 0, z: 14, w: 64, d: 34, h: top, blend: 6 },
        { type: 'ramp', x0: -11, x1: 11, z0: -11.2, z1: -3, h0: 0, h1: top, blend: 1.5 },
        { type: 'road', pts: [P(0, -74), P(0, -110), P(6, -150), P(-10, -200)], width: 8, shoulder: 4 },
      ] });
      const s = { x: 0, z: -2.2 };
      const C = P(0, -42), ring = [];
      for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + i / 16 * Math.PI * 2; ring.push(P(C.x + Math.cos(a) * 10.5, C.z + Math.sin(a) * 10.5)); }
      const balY = 4.6;
      const d = {
        id: 'apex', terrain, size: 520, center: P(0, -50), seed: 67,
        env: { sky: 'dusk', fog: 0.0072, sunElev: 0.1, sunAz: -2.7, exposure: 1.1, amb: ['crickets', 'music_menace'] },
        stands: { plaza: { x: s.x, z: s.z, floor: top, yaw: 0, pitch: -0.08, arc: 1.3, pitchMin: -0.6, pitchMax: 0.55 } },
        rails: {},
        spawns: {
          rexEntry: { points: [P(0, -92)], path: [P(0, -92), P(0, -84), P(0, -74), P(0, -62)] },
          rexCircle: { points: [ring[0]], path: ring, raw: false },
          rexCharge: { points: [C], path: [C, P(0, -26), P(0, -12)] },
          balcony: { elevated: true, raw: true,
            points: [{ x: 12.75, y: balY, z: -17.5 }, { x: 12.75, y: balY, z: -17.1 }],   // in the dark doorway: they step out of the building
            path: [{ x: 11.8, y: balY, z: -17.4 }, { x: 8.5, y: 0, z: -15 }, { x: 4, y: 0, z: -12.5 }, { x: 1.5, y: top, z: -3.4 }] },
        },
        points: { gate: P(0, -74), fountain: C },
        roads: [{ pts: [P(0, -74), P(0, -110), P(6, -150), P(-10, -200)], width: 8 }],
        clear: [{ rect: [-44, -76, 44, -9] }, { rect: [-34, -11, 34, 34] }],
        focus: [P(0, 0), P(0, -40), P(0, -75)],
        shadow: { x: 0, z: -35, r: 70 },
        top, plazaC: C,
      };
      const out = finish(d);
      // balcony path drops to the plaza: fix the ground y of its middle points
      out.spawns.balcony.path.forEach((p, i) => { if (i > 0 && i < 3) p.y = out.heightAt(p.x, p.z); });
      out.spawns.rexCircle.path = resample(ring, 4).map(p => ({ x: p.x, y: out.heightAt(p.x, p.z), z: p.z }));
      return out;
    },
  };

  function describe(id) { const f = MISSIONS[id]; if (!f) throw new Error('no world for mission ' + id); return f(); }

  /** Errors (strings) for a world description against one layout.js entry; [] when good. */
  function validate(d, L) {
    const e = [], fin = p => p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
    (L.stands || []).forEach(s => {
      const w = d.stands && d.stands[s.name];
      if (!w) return e.push('missing stand ' + s.name);
      if (!fin(w.pos)) e.push('stand ' + s.name + ' has a bad pos');
      if (!(w.arc > 0)) e.push('stand ' + s.name + ' arc must be > 0');
      if (!isFinite(w.yaw)) e.push('stand ' + s.name + ' yaw');
      if (!(w.pitchMin < w.pitchMax)) e.push('stand ' + s.name + ' pitch range');
    });
    (L.rails || []).forEach(r => {
      const pts = d.rails && d.rails[r.name];
      if (!pts || pts.length < 2) return e.push('missing rail ' + r.name);
      if (!pts.every(fin)) e.push('rail ' + r.name + ' has bad points');
      const a = d.stands[r.from], b = d.stands[r.to];
      if (a && Math.hypot(pts[0].x - a.pos.x, pts[0].z - a.pos.z) > 1) e.push('rail ' + r.name + ' does not start at ' + r.from);
      if (b && Math.hypot(pts[pts.length - 1].x - b.pos.x, pts[pts.length - 1].z - b.pos.z) > 1) e.push('rail ' + r.name + ' does not end at ' + r.to);
    });
    Object.keys(L.spawns || {}).forEach(k => {
      const s = d.spawns && d.spawns[k];
      if (!s) return e.push('missing spawn ' + k);
      if (!s.points || !s.points.length || !s.points.every(fin)) e.push('spawn ' + k + ' needs points');
      if (s.path && !s.path.every(fin)) e.push('spawn ' + k + ' has a bad path');
    });
    Object.keys(L.points || {}).forEach(k => { if (!d.points || !fin(d.points[k])) e.push('missing point ' + k); });
    return e;
  }

  const api = { EYE, clamp, lerp, smooth, rng, hash2, vnoise, fbm, polyLength, resample, catmull, distToPolyline, yawTo, yawDir,
    makeTerrain, heightGrid, gridHeight, rayHeightfield, rayCylinder, excluded, scatter, describe, validate, ahead, MISSIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.WorldLib = api; }
})(typeof window !== 'undefined' ? window : this);
