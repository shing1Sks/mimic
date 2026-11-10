/*
 * GYROWING terrain: a deterministic procedural island (30 x 30 km) with a northern mountain
 * range, a long farmed valley holding the airfield, a lake in the hills and the sea to the south.
 * Pure JS (no three.js): the same height grid feeds the renderer and the physics, and height
 * queries interpolate exactly over the rendered triangles, so wheels sit on what you see.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2D simplex noise (after Gustavson), seeded
  function makeNoise(seed) {
    const rnd = mulberry(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    return function (xin, yin) {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0, tt, g;
      tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { g = perm[ii + perm[jj]] & 7; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
      return 70 * n;
    };
  }

  const SIZE = 30000, N = 500, CELL = SIZE / N, HALF = SIZE / 2;
  const ELEV = 40; // airfield elevation (m)
  const AIRPORT = {
    elev: ELEV,
    runway: { x0: -700, x1: 700, z: 0, halfWidth: 15, heading: 90, names: ['09', '27'] },
    aimPoint: -400,           // touchdown zone for runway 09 (300 m past the threshold)
    paved: [                  // [x0, x1, z0, z1]
      [-700, 700, -15, 15],   // runway
      [-660, 660, 82, 98],    // parallel taxiway
      [-668, -652, 15, 82], [-8, 8, 15, 82], [652, 668, 15, 82], // connectors
      [-220, 220, 98, 190],   // apron
    ],
    flat: [-1050, 1050, -160, 300],
    id: 'GWF', name: 'Gyrowing Field',
  };
  // a second, smaller field east of the lake: runway 36/18 (north-south), for cross-country flights
  const BROOK = {
    id: 'BRK', name: 'Brookfield', elev: 46,
    runway: { axis: 'z', x: 8200, z0: -450, z1: 450, halfWidth: 12, heading: 0, names: ['36', '18'] },
    aimPoint: 300,             // touchdown zone for runway 36 (landing northbound, toward -z)
    paved: [
      [8188, 8212, -450, 450],   // runway
      [8212, 8290, -40, 40],     // apron
    ],
    flat: [7900, 8450, -700, 700],
  };
  const AIRPORTS = [AIRPORT, BROOK];

  function buildTerrain(seed) {
    seed = seed || 7;
    const nA = makeNoise(seed), nB = makeNoise(seed + 1), nC = makeNoise(seed + 2), nD = makeNoise(seed + 3);
    function fbm(nz, x, y, oct) {
      let a = 1, f = 1, s = 0, t = 0;
      for (let i = 0; i < oct; i++) { s += a * nz(x * f, y * f); t += a; a *= 0.5; f *= 2.03; }
      return s / t;
    }
    function ridged(nz, x, y, oct) {
      let a = 1, f = 1, s = 0, t = 0, w = 1;
      for (let i = 0; i < oct; i++) {
        let r = 1 - Math.abs(nz(x * f, y * f)); r *= r; r *= w; w = clamp(r * 1.6, 0, 1);
        s += a * r; t += a; a *= 0.5; f *= 2.1;
      }
      return s / t;
    }
    function rectDist(x, z, r) {
      const dx = Math.max(r[0] - x, 0, x - r[1]), dz = Math.max(r[2] - z, 0, z - r[3]);
      return Math.hypot(dx, dz);
    }

    /** The analytic height (before gridding). */
    function raw(x, z) {
      const n1 = fbm(nA, x * 0.00017, z * 0.00017, 5);
      const n2 = fbm(nB, x * 0.0007 + 31.3, z * 0.0007 - 17.1, 4);
      const rg = ridged(nC, x * 0.00026 + 7.7, z * 0.00026 + 3.1, 6);
      // hills everywhere, mountains in the north
      const mN = smoothstep(-2200, -9500, z + n1 * 1800);
      let h = 115 + 95 * n1 + 40 * n2 + mN * (240 + 1700 * Math.pow(rg, 1.7) + 260 * n1) + (1 - mN) * 220 * rg * rg * smoothstep(0.1, 0.6, n1 + 0.3);
      // the valley: a gently meandering farmed floor running west-east through the airfield
      const vz = z - 650 * Math.sin(x * 0.00033) * smoothstep(0, 2500, Math.abs(x));
      const vMask = 1 - smoothstep(450 + 250 * n2, 2700, Math.abs(vz));
      const floor = 36 + Math.max(0, -x) * 0.0035 + Math.max(0, x - 4000) * 0.002 + n2 * 8;
      h = mix(h, floor, vMask * 0.94);
      // lake in the north-eastern hills
      const dl = Math.hypot((x - 5600) / 1.5, z + 2900) / (1500 + 350 * n2);
      h = mix(-28, h, smoothstep(0.55, 1.15, dl));
      // coast: sea to the south, and the island edges
      const coast = 6800 + 1400 * n1 + 500 * n2;
      h = mix(h, -60, smoothstep(coast - 1400, coast + 900, z));
      const edge = Math.max(Math.abs(x), Math.abs(z)) / (HALF - 300) + 0.06 * n2;
      h = mix(h, -90, smoothstep(0.8, 0.99, edge));
      // the airfields: flat, with a soft blend into the land around them
      for (const ap of AIRPORTS) h = mix(ap.elev, h, smoothstep(0, 650, rectDist(x, z, ap.flat)));
      return h;
    }

    const V = N + 1;
    const heights = new Float32Array(V * V);
    for (let j = 0; j < V; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < V; i++) heights[j * V + i] = raw(-HALF + i * CELL, z);
    }
    // erode the high ground a little: two smoothing passes, weighted toward the peaks
    for (let pass = 0; pass < 4; pass++) {
      const src = heights.slice();
      for (let j = 1; j < V - 1; j++) for (let i = 1; i < V - 1; i++) {
        const k = j * V + i, h = src[k];
        if (h < 160) continue;
        const avg = (src[k - 1] + src[k + 1] + src[k - V] + src[k + V]) * 0.15 + (src[k - V - 1] + src[k - V + 1] + src[k + V - 1] + src[k + V + 1]) * 0.05 + h * 0.2;
        heights[k] = mix(h, avg, smoothstep(160, 700, h));
      }
    }
    // the runway area must be exactly flat in the grid (physics and render agree)
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      for (const ap of AIRPORTS) if (rectDist(x, z, ap.flat) < CELL * 1.5) heights[j * V + i] = ap.elev;
    }

    /** Height exactly on the rendered triangles (split along the i+1,j / i,j+1 diagonal). */
    function heightAt(x, z) {
      let fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
      if (fx < 0 || fz < 0 || fx >= N || fz >= N) return -90;
      const i = Math.floor(fx), j = Math.floor(fz);
      fx -= i; fz -= j;
      const h00 = heights[j * V + i], h10 = heights[j * V + i + 1], h01 = heights[(j + 1) * V + i], h11 = heights[(j + 1) * V + i + 1];
      if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }
    function slopeAt(x, z) {
      const d = CELL;
      const dx = heightAt(x + d, z) - heightAt(x - d, z), dz = heightAt(x, z + d) - heightAt(x, z - d);
      return Math.hypot(dx, dz) / (2 * d);
    }
    function surfaceAt(x, z) {
      for (const ap of AIRPORTS) for (const r of ap.paved) if (x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) return 'paved';
      return 'grass';
    }
    function onRunway(x, z, ap) {
      const r = (ap || AIRPORT).runway;
      if (r.axis === 'z') return z >= r.z0 && z <= r.z1 && Math.abs(x - r.x) <= r.halfWidth;
      return x >= r.x0 && x <= r.x1 && Math.abs(z - r.z) <= r.halfWidth;
    }
    const landmarks = findLandmarks(heightAt);
    return { SIZE, N, CELL, HALF, V, heights, heightAt, slopeAt, surfaceAt, onRunway, raw, AIRPORT, AIRPORTS, BROOK, landmarks, noise: [nA, nB, nC, nD], fbm, seed, mulberry };
  }

  /** Named places for missions and scenery: the summit, the lake, a lighthouse point on the south coast. */
  function findLandmarks(heightAt) {
    let summit = { x: 0, z: -6000, y: -1e9 };
    for (let z = -13000; z < -2500; z += 120) for (let x = -11000; x < 11000; x += 120) {
      const h = heightAt(x, z); if (h > summit.y) summit = { x, z, y: h };
    }
    // the lighthouse: the southernmost dry land on a line south of the airfield, on a headland
    let light = null;
    for (const x0 of [1800, 2600, 1000, 3400, -600]) {
      for (let z = 3000; z < 13000; z += 20) {
        if (heightAt(x0, z) < 2.5) { const zz = z - 60; if (heightAt(x0, zz) > 2.5) { light = { x: x0, z: zz, y: heightAt(x0, zz) }; } break; }
      }
      if (light) break;
    }
    if (!light) light = { x: 1800, z: 7000, y: 3 };
    return { summit, lake: { x: 5600, z: -2900, y: 0 }, lighthouse: light };
  }

  const api = { buildTerrain, makeNoise, mulberry, SIZE, N, CELL, AIRPORT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Terrain = api;
})(typeof window !== 'undefined' ? window : null);
