/*
 * Duskwater - map "Depot Nine": layout data, collision, ray casts and a navigation graph.
 * Pure math, no three.js (world.js draws it). Classic script: window.ArenaMap. Node: module.exports.
 *
 * Coordinates in metres, three.js axes: x east, y up, z south. North (-z) is the quay and water.
 * Team 0 (Wardens) spawns west, team 1 (Corsairs) east. The layout is mirror-symmetric across x = 0
 * so neither side gets a better lane.
 *
 * Solids are axis-aligned boxes { x0,y0,z0,x1,y1,z1, kind, tint }. Ramps are rectangles whose
 * height rises linearly along one axis. Nothing walkable sits above anything walkable, so the
 * floor is a height field and the nav graph is a 2D grid.
 */
(function (root) {
  'use strict';

  const STEP_UP = 0.45;
  const CONTAINER = { l: 6.1, w: 2.45, h: 2.6 };

  function buildMap() {
    const solids = [], ramps = [], lamps = [];
    const box = (cx, cz, w, d, h, kind, y0 = 0, tint = 0) => {
      const b = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, kind, tint };
      solids.push(b); return b;
    };
    const container = (cx, cz, alongX, tint, y0 = 0) =>
      box(cx, cz, alongX ? CONTAINER.l : CONTAINER.w, alongX ? CONTAINER.w : CONTAINER.l, CONTAINER.h, 'container', y0, tint);
    // mirror helper: place at +x and -x (tints may differ for variety)
    const pair = (fn) => { fn(1); fn(-1); };

    // ---- perimeter
    box(-47, 0, 2, 64, 7, 'wall');
    box(47, 0, 2, 64, 7, 'wall');
    box(0, 31, 96, 2, 7, 'wall');
    box(0, -30.55, 92, 0.5, 1.0, 'rail');           // quay railing
    box(0, -31.3, 92, 1, 6, 'invisible');           // keeps everyone out of the water

    // ---- central warehouse (x -11..11, z -7..7), doors on all four sides
    const T = 0.5, H = 6.5, LIN = 3.2;
    pair(s => { box(6.25 * s, -7, 9.5, T, H, 'shed'); box(6.25 * s, 7, 9.5, T, H, 'shed'); });            // north and south walls
    box(0, -7, 3, T, H - LIN, 'shed', LIN); box(0, 7, 3, T, H - LIN, 'shed', LIN);                      // doors x -1.5..1.5
    pair(s => { box(11 * s, -4.5, T, 5, H, 'shed'); box(11 * s, 4.5, T, 5, H, 'shed'); box(11 * s, 0, T, 4, H - LIN, 'shed', LIN); });
    box(0, -5.125, 22.5, 4.25, 0.3, 'roof', H); box(0, 0, 22.5, 4, 0.3, 'roof', H); box(0, 5.125, 22.5, 4.25, 0.3, 'roof', H); // skylight gaps
    // interior, mirror-symmetric so neither team gets the better side of the shed
    pair(s => {
      box(3.6 * s, 0, 0.6, 0.6, H, 'pillar');
      box(6.2 * s, -3.9, 4, 1.1, 2.8, 'rack');
      box(7.6 * s, 4.1, 1.5, 1.5, 1.5, 'crate'); box(7.6 * s, 4.1, 1.15, 1.15, 1.0, 'crate', 1.5, 1);
      box(3.2 * s, 3.8, 1.3, 1.3, 0.95, 'crate', 0, 1);                                                   // jump-up crate
      box(1.8 * s, -3.6, 1.4, 1.4, 1.4, 'crate');
    });
    box(0, 4.6, 2.4, 0.6, 1.0, 'barrier');

    // ---- north lane: the quay
    pair(s => {
      container(34 * s, -20, false, s > 0 ? 1 : 0);
      container(22 * s, -24, true, s > 0 ? 3 : 1); container(22 * s, -24, true, s > 0 ? 0 : 2, CONTAINER.h);
      container(18 * s, -15, false, s > 0 ? 0 : 3);
      container(8.5 * s, -21, true, s > 0 ? 2 : 0);
      container(21 * s, -8.6, true, 2);                 // lane separator quay/middle
      box(13 * s, -27, 2.4, 0.6, 1.0, 'barrier');
      box(30 * s, -27.5, 1.3, 1.3, 1.3, 'crate', 0, 1);
    });
    // gantry crane straddling the quay centre
    [[-3, -26.5], [3, -26.5], [-3, -11.5], [3, -11.5]].forEach(([x, z]) => box(x, z, 0.9, 0.9, 16, 'crane'));
    box(0, -26.5, 7.2, 1, 1.2, 'crane', 16); box(0, -11.5, 7.2, 1, 1.2, 'crane', 16);
    box(-3, -19, 0.8, 15, 0.8, 'crane', 15.2); box(3, -19, 0.8, 15, 0.8, 'crane', 15.2);
    box(0, -24, 1.6, 40, 1.4, 'crane', 17.2);         // boom out over the water
    box(0, -15, 2.6, 2.4, 2.2, 'crane', 13.6);        // operator cab
    for (let x = -42; x <= 42; x += 7) if (Math.abs(x) > 5) box(x, -29.3, 0.4, 0.4, 0.55, 'bollard');

    // ---- south lane: raised loading dock with ramps, container yard
    box(0, 25, 20, 10, 2.2, 'dock');
    ramps.push({ x0: -17, x1: -10, z0: 20.5, z1: 24.5, axis: 'x', h0: 0, h1: 2.2 });
    ramps.push({ x0: 10, x1: 17, z0: 20.5, z1: 24.5, axis: 'x', h0: 2.2, h1: 0 });
    box(0, 27, 4, 3, 2.6, 'booth', 2.2);
    pair(s => {
      box(6 * s, 20.15, 6, 0.3, 0.9, 'rail', 2.2);      // dock edge parapet: crouch cover
      box(6.5 * s, 23, 1.3, 1.3, 1.1, 'crate', 2.2, 1);
      container(30 * s, 22, false, s > 0 ? 0 : 3);
      container(24 * s, 12.5, true, s > 0 ? 3 : 0);     // lane separator middle/south
      container(22 * s, 27.6, true, 1);
      box(14 * s, 16, 1.4, 1.4, 1.4, 'crate');
      box(5 * s, 14.5, 2.4, 0.6, 1.0, 'barrier');
    });
    // sightline breakers: no straight shot from spawn to spawn (see test/map.test.js)
    pair(s => {
      container(15.8 * s, 0, false, s > 0 ? 1 : 3);       // screens the warehouse side doors
      container(16.5 * s, 10, true, s > 0 ? 0 : 2);       // yard edge
      box(14.5 * s, -10.6, 1.5, 1.5, 1.5, 'crate');       // quay corner stack
      box(14.5 * s, -10.6, 1.2, 1.2, 1.0, 'crate', 1.5, 1);
    });
    box(0, 10, 1.6, 1.6, 1.6, 'crate', 0, 1); box(0, 10, 1.2, 1.2, 1.1, 'crate', 1.6);                      // in front of the south door
    box(0, -10, 1.6, 1.6, 1.6, 'crate', 0, 1); box(0, -10, 1.2, 1.2, 1.1, 'crate', 1.6);                    // in front of the north door
    pair(s => { box(2.6 * s, 8.15, 1.6, 1.6, 1.4, 'crate'); box(2.6 * s, 8.15, 1.5, 1.5, 1.0, 'crate', 1.4, 1);
                box(2.6 * s, -8.15, 1.6, 1.6, 1.4, 'crate'); box(2.6 * s, -8.15, 1.5, 1.5, 1.0, 'crate', 1.4, 1); });

    // ---- spawns
    pair(s => {
      box(42 * s, 21, 4, 4, 3, 'booth');
      box(42.5 * s, -14, 4, 3, 3, 'booth');
      box(35 * s, 6, 1.4, 1.4, 1.4, 'crate');
      box(35.5 * s, -5.5, 1.4, 1.4, 1.4, 'crate', 0, 1);
    });

    // ---- lamp posts (thin poles; world.js adds heads and glow)
    [[-30, -10], [30, -10], [-30, 9], [30, 9], [-14, -28], [14, -28], [-12, 18], [12, 18]].forEach(([x, z]) => {
      box(x, z, 0.3, 0.3, 5.2, 'pole'); lamps.push({ x, z, y: 5.2 });
    });

    const spawns = [0, 1].map(team => [-10, -5, 0, 5, 10].map(z => ({ x: team ? 41.5 : -41.5, z, yaw: team ? Math.PI / 2 : -Math.PI / 2 })));
    const lanes = {
      north: [{ x: -30, z: -16 }, { x: -13, z: -18 }, { x: 0, z: -19 }, { x: 13, z: -18 }, { x: 30, z: -16 }],
      mid:   [{ x: -25, z: 0 }, { x: -11, z: 0 }, { x: 0, z: 2 }, { x: 11, z: 0 }, { x: 25, z: 0 }],
      south: [{ x: -28, z: 17 }, { x: -13.5, z: 22.5 }, { x: 0, z: 23.5 }, { x: 13.5, z: 22.5 }, { x: 28, z: 17 }],
    };
    const landmarks = { dock: { x: 0, z: 23 }, quay: { x: 0, z: -19 }, shed: { x: 0, z: 1.5 } };
    return { solids, ramps, lamps, spawns, lanes, landmarks, bounds: { x0: -46, x1: 46, z0: -30, z1: 30 } };
  }

  // ---------------------------------------------------------------- queries

  function rampHeightAt(r, x, z) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return null;
    const f = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
    return r.h0 + (r.h1 - r.h0) * f;
  }

  /** Floor height under (x, z) for something whose feet are at fromY (ignores roofs and lintels overhead). */
  function groundHeight(map, x, z, fromY) {
    let g = 0;
    for (const s of map.solids) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (s.y1 <= fromY + STEP_UP + 0.05 && s.y1 > g) g = s.y1;
    }
    for (const r of map.ramps) {
      const h = rampHeightAt(r, x, z);
      if (h != null && h <= fromY + STEP_UP + 0.15 && h > g) g = h;
    }
    return g;
  }

  /** Highest ramp surface at (x, z), or -1. */
  function rampAt(map, x, z) {
    let best = -1;
    for (const r of map.ramps) { const h = rampHeightAt(r, x, z); if (h != null && h > best) best = h; }
    return best;
  }

  function circleHitsSolid(map, x, z, r, yLow, yHigh) {
    for (const s of map.solids) {
      if (s.y1 <= yLow || s.y0 >= yHigh) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
      const cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return true;
    }
    return false;
  }

  function resolveCircle(map, p, r, height) {
    const yLow = p.y + STEP_UP, yHigh = p.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of map.solids) {
        if (s.y1 <= yLow || s.y0 >= yHigh) continue;
        if (p.x < s.x0 - r || p.x > s.x1 + r || p.z < s.z0 - r || p.z > s.z1 + r) continue;
        const cx = p.x < s.x0 ? s.x0 : p.x > s.x1 ? s.x1 : p.x;
        const cz = p.z < s.z0 ? s.z0 : p.z > s.z1 ? s.z1 : p.z;
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += dx / d * push; p.z += dz / d * push;
        } else { // centre inside the box: leave along the shallowest side
          const opts = [[s.x0 - r - p.x, 0], [s.x1 + r - p.x, 0], [0, s.z0 - r - p.z], [0, s.z1 + r - p.z]];
          opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
          p.x += opts[0][0]; p.z += opts[0][1];
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Slide a standing circle (feet at pos.y) by (dx, dz) against walls and ramp sides. Returns the new position. */
  function moveCircle(map, pos, dx, dz, r, height) {
    const p = { x: pos.x, y: pos.y, z: pos.z };
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.5)));
    const sx = dx / n, sz = dz / n;
    for (let i = 0; i < n; i++) {
      for (let axis = 0; axis < 2; axis++) {
        const ox = p.x, oz = p.z;
        if (axis === 0) p.x += sx; else p.z += sz;
        const rh = map.ramps.length ? rampAt(map, p.x, p.z) : -1;
        if (rh > p.y + STEP_UP + 0.15) { p.x = ox; p.z = oz; continue; }  // side of a ramp
        resolveCircle(map, p, r, height);
      }
    }
    return p;
  }

  /**
   * Slab test of a ray against a box, no allocations. Returns the entry distance, or -1 for a miss
   * (or a ray that starts inside). The entry face is left in _hitAxis / _hitSign.
   */
  let _hitAxis = 0, _hitSign = 0;
  function slab(ox, oy, oz, dx, dy, dz, b, maxT) {
    let tmin = 0, tmax = maxT, axis = -1, sign = 0, t1, t2, sg, t;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < b.x0 || ox > b.x1) return -1; }
    else { t1 = (b.x0 - ox) / dx; t2 = (b.x1 - ox) / dx; sg = -1; if (t1 > t2) { t = t1; t1 = t2; t2 = t; sg = 1; } if (t1 > tmin) { tmin = t1; axis = 0; sign = sg; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < b.y0 || oy > b.y1) return -1; }
    else { t1 = (b.y0 - oy) / dy; t2 = (b.y1 - oy) / dy; sg = -1; if (t1 > t2) { t = t1; t1 = t2; t2 = t; sg = 1; } if (t1 > tmin) { tmin = t1; axis = 1; sign = sg; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < b.z0 || oz > b.z1) return -1; }
    else { t1 = (b.z0 - oz) / dz; t2 = (b.z1 - oz) / dz; sg = -1; if (t1 > t2) { t = t1; t1 = t2; t2 = t; sg = 1; } if (t1 > tmin) { tmin = t1; axis = 2; sign = sg; } if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
    if (axis < 0) return -1;
    _hitAxis = axis; _hitSign = sign;
    return tmin;
  }

  /** Ray (origin o, unit direction d) against a box. { t, n } of the entry point, or null. */
  function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
    const t = slab(ox, oy, oz, dx, dy, dz, b, maxT);
    if (t < 0) return null;
    const n = [0, 0, 0]; n[_hitAxis] = _hitSign;
    return { t, n };
  }

  function rayRamp(ox, oy, oz, dx, dy, dz, r, maxT) {
    const alongX = r.axis === 'x';
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const k = (r.h1 - r.h0) / len;
    const o = alongX ? ox - r.x0 : oz - r.z0, dd = alongX ? dx : dz;
    const den = dy - dd * k;
    if (Math.abs(den) < 1e-9) return null;
    const t = (r.h0 + o * k - oy) / den;
    if (t <= 0 || t > maxT) return null;
    const x = ox + dx * t, z = oz + dz * t;
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return null;
    const nl = Math.hypot(k, 1);
    return { t, n: alongX ? [-k / nl, 1 / nl, 0] : [0, 1 / nl, -k / nl] };
  }

  /** Nearest world hit along a ray (ground plane included). { t, n, solid } or null. */
  function raycast(map, ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    let bt = maxT, bs = null, ba = 0, bsg = 0;
    for (const s of map.solids) {
      if (s.kind === 'invisible') continue;
      const t = slab(ox, oy, oz, dx, dy, dz, s, bt);
      if (t >= 0) { bt = t; bs = s; ba = _hitAxis; bsg = _hitSign; }
    }
    if (bs) { const n = [0, 0, 0]; n[ba] = bsg; best = { t: bt, n, solid: bs }; }
    for (const r of map.ramps) {
      const h = rayRamp(ox, oy, oz, dx, dy, dz, r, best ? best.t : maxT);
      if (h) best = { t: h.t, n: h.n, solid: null, ramp: r };
    }
    if (dy < -1e-9) {
      const t = -oy / dy;
      if (t > 0 && t < (best ? best.t : maxT)) best = { t, n: [0, 1, 0], solid: null, ground: true };
    }
    return best;
  }

  function lineOfSight(map, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    const ux = dx / L, uy = dy / L, uz = dz / L, maxT = L - 0.05;
    if (uy < -1e-9 && -y0 / uy < maxT && y0 > 0) return false;   // dips below the ground
    for (const s of map.solids) {                                  // any hit will do: stop at the first
      if (s.kind !== 'invisible' && slab(x0, y0, z0, ux, uy, uz, s, maxT) >= 0) return false;
    }
    for (const r of map.ramps) if (rayRamp(x0, y0, z0, ux, uy, uz, r, maxT)) return false;
    return true;
  }

  // ---------------------------------------------------------------- navigation graph

  const NAV_STEP = 2;

  function buildNav(map) {
    const b = map.bounds;
    const xs = [], zs = [];
    for (let x = b.x0 + 1; x <= b.x1 - 1 + 1e-6; x += NAV_STEP) xs.push(x);
    for (let z = b.z0 + 1; z <= b.z1 - 1 + 1e-6; z += NAV_STEP) zs.push(z);
    const grid = new Int32Array(xs.length * zs.length).fill(-1);
    const raw = [];
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
      const x = xs[i], z = zs[j];
      const y = groundHeight(map, x, z, 3);
      if (circleHitsSolid(map, x, z, 0.5, y + STEP_UP, y + 1.7)) continue;
      grid[j * xs.length + i] = raw.length;
      raw.push({ x, y, z, i, j });
    }
    const adj = raw.map(() => []);
    const walkable = (a, c) => {
      const N = 7;
      let h = a.y;
      for (let k = 1; k <= N; k++) {
        const f = k / N, px = a.x + (c.x - a.x) * f, pz = a.z + (c.z - a.z) * f;
        const rh = rampAt(map, px, pz);
        if (rh > h + 0.5) return false;
        const nh = groundHeight(map, px, pz, h);
        if (Math.abs(nh - h) > 0.5) return false;
        h = nh;
        if (circleHitsSolid(map, px, pz, 0.42, h + STEP_UP, h + 1.7)) return false;
      }
      return Math.abs(h - c.y) < 0.3;
    };
    const dirs = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    raw.forEach((a, ai) => {
      for (const [di, dj] of dirs) {
        const i = a.i + di, j = a.j + dj;
        if (i < 0 || j < 0 || i >= xs.length || j >= zs.length) continue;
        const ci = grid[j * xs.length + i];
        if (ci < 0) continue;
        const c = raw[ci];
        if (walkable(a, c) && walkable(c, a)) {
          const cost = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
          adj[ai].push([ci, cost]); adj[ci].push([ai, cost]);
        }
      }
    });
    // keep the largest connected piece (drops crate and container tops)
    const comp = new Int32Array(raw.length).fill(-1);
    let bestC = -1, bestSize = 0, c = 0;
    for (let s = 0; s < raw.length; s++) {
      if (comp[s] >= 0) continue;
      const stack = [s]; comp[s] = c; let size = 0;
      while (stack.length) { const u = stack.pop(); size++; for (const [v] of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); } }
      if (size > bestSize) { bestSize = size; bestC = c; }
      c++;
    }
    const remap = new Int32Array(raw.length).fill(-1);
    const nodes = [];
    raw.forEach((n, k) => { if (comp[k] === bestC) { remap[k] = nodes.length; nodes.push({ x: n.x, y: n.y, z: n.z, i: n.i, j: n.j }); } });
    const nadj = nodes.map(() => []);
    raw.forEach((n, k) => { if (remap[k] >= 0) nadj[remap[k]] = adj[k].filter(([v]) => remap[v] >= 0).map(([v, w]) => [remap[v], w]); });
    const ngrid = new Int32Array(xs.length * zs.length).fill(-1);
    nodes.forEach((n, k) => { ngrid[n.j * xs.length + n.i] = k; });
    return { nodes, adj: nadj, grid: ngrid, nx: xs.length, nz: zs.length, x0: xs[0], z0: zs[0], step: NAV_STEP };
  }

  function nearestNode(nav, x, z) {
    const ci = Math.round((x - nav.x0) / nav.step), cj = Math.round((z - nav.z0) / nav.step);
    let best = -1, bd = Infinity;
    for (let rad = 0; rad <= 4 && best < 0; rad++) {
      for (let j = cj - rad; j <= cj + rad; j++) for (let i = ci - rad; i <= ci + rad; i++) {
        if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) continue;
        const k = nav.grid[j * nav.nx + i];
        if (k < 0) continue;
        const n = nav.nodes[k], d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
        if (d < bd) { bd = d; best = k; }
      }
    }
    if (best < 0) nav.nodes.forEach((n, k) => { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = k; } });
    return best;
  }

  /** A* over the grid. Returns an array of node indices from a to b, or null. Scratch arrays live on nav. */
  function findPath(nav, a, b) {
    if (a < 0 || b < 0) return null;
    if (a === b) return [a];
    const N = nav.nodes.length;
    if (!nav._g) { nav._g = new Float64Array(N); nav._from = new Int32Array(N); nav._stamp = new Uint32Array(N); nav._closed = new Uint32Array(N); nav._gen = 0; nav._hf = new Float64Array(N * 4); nav._hk = new Int32Array(N * 4); }
    const g = nav._g, from = nav._from, stamp = nav._stamp, closed = nav._closed, hf = nav._hf, hk = nav._hk;
    const gen = ++nav._gen;
    const nb = nav.nodes[b], nodes = nav.nodes;
    const hfn = k => Math.hypot(nodes[k].x - nb.x, nodes[k].z - nb.z);
    let hn = 0;
    const push = (f, k) => {
      if (hn >= hf.length) return; // cannot happen on this map; guards the fixed heap
      let i = hn++; hf[i] = f; hk[i] = k;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; const tf = hf[p], tk = hk[p]; hf[p] = hf[i]; hk[p] = hk[i]; hf[i] = tf; hk[i] = tk; i = p; }
    };
    const pop = () => {
      const top = hk[0]; hn--;
      if (hn > 0) {
        hf[0] = hf[hn]; hk[0] = hk[hn];
        let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && hf[l] < hf[m]) m = l; if (r < hn && hf[r] < hf[m]) m = r; if (m === i) break; const tf = hf[m], tk = hk[m]; hf[m] = hf[i]; hk[m] = hk[i]; hf[i] = tf; hk[i] = tk; i = m; }
      }
      return top;
    };
    const G = k => stamp[k] === gen ? g[k] : Infinity;
    stamp[a] = gen; g[a] = 0; from[a] = -1; push(hfn(a), a);
    let found = false;
    while (hn > 0) {
      const u = pop();
      if (u === b) { found = true; break; }
      if (closed[u] === gen) continue;
      closed[u] = gen;
      const gu = g[u];
      for (const e of nav.adj[u]) {
        const v = e[0], ng = gu + e[1];
        if (ng < G(v)) { stamp[v] = gen; g[v] = ng; from[v] = u; push(ng + hfn(v), v); }
      }
    }
    if (!found) return null;
    const path = [b];
    let k = b;
    while (k !== a) { k = from[k]; path.push(k); }
    return path.reverse();
  }

  const api = { buildMap, buildNav, nearestNode, findPath, groundHeight, rampAt, rampHeightAt, circleHitsSolid, moveCircle, rayBox, rayRamp, raycast, lineOfSight, STEP_UP, CONTAINER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaMap = api;
})(typeof window !== 'undefined' ? window : this);
