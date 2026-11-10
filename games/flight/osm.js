/*
 * GYROWING map data, the pure part: OpenStreetMap vector tiles (OpenMapTiles schema, as served by
 * OpenFreeMap) decoded and turned into things to draw. No DOM or three.js: runs in the page, in the
 * tile worker (osm-worker.js) and in Node for tests.
 *
 *   decodeTile(bytes, keep)   Mapbox Vector Tile protobuf -> { layerName: { extent, features } }
 *   rings / polygons          geometry commands -> rings in tile units, grouped outer + holes
 *   triangulate(outer, holes) ear clipping with holes bridged in (roofs)
 *   buildBuildings(...)       footprints + heights -> one merged mesh's arrays (walls, flat,
 *                             gabled and hipped roofs), with facade UVs and per-building colour
 *   overlayStyle(layer, p)    how a feature is painted on the ground overlay (roads, water, ...)
 *   treePoints(...)           random points inside woods and parks
 *
 * Tile units: 0..extent (4096) across the tile, y down (north at the top), like the local frame's
 * x east, z south, so a tile maps onto its local rectangle with a scale and an offset.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------- protobuf + MVT
  function Reader(buf) { this.b = buf; this.p = 0; }
  Reader.prototype.varint = function () {
    const b = this.b; let v = 0, s = 1, c;
    do { c = b[this.p++]; v += (c & 0x7f) * s; s *= 128; } while (c >= 0x80);
    return v;
  };
  Reader.prototype.skip = function (wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.p += this.varint();
    else if (wire === 5) this.p += 4;
    else throw new Error('pbf wire type ' + wire);
  };
  Reader.prototype.str = function () {
    const n = this.varint(), end = this.p + n, b = this.b;
    let s = '';
    if (typeof TextDecoder !== 'undefined') s = new TextDecoder().decode(b.subarray(this.p, end));
    else for (let i = this.p; i < end; i++) s += String.fromCharCode(b[i]);
    this.p = end; return s;
  };
  Reader.prototype.packed = function () { const n = this.varint(), end = this.p + n, out = []; while (this.p < end) out.push(this.varint()); return out; };
  const zz = n => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

  function readValue(r) {
    const len = r.varint(), end = r.p + len;
    let v = null;
    while (r.p < end) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1) v = r.str();
      else if (f === 2) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 4).getFloat32(0, true); r.p += 4; }
      else if (f === 3) { v = new DataView(r.b.buffer, r.b.byteOffset + r.p, 8).getFloat64(0, true); r.p += 8; }
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) v = zz(r.varint());
      else if (f === 7) v = !!r.varint();
      else r.skip(w);
    }
    return v;
  }
  /**
   * Decode a vector tile. keep: optional set or array of layer names (others are skipped without
   * decoding their features). Features: { type 1 point | 2 line | 3 polygon, props, geom (raw
   * command integers, decoded lazily by rings()) }.
   */
  function decodeTile(bytes, keep) {
    const want = keep ? new Set(keep) : null;
    const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), out = {};
    while (r.p < r.b.length) {
      const tag = r.varint();
      if ((tag >> 3) !== 3 || (tag & 7) !== 2) { r.skip(tag & 7); continue; }
      const len = r.varint(), end = r.p + len;
      const L = { name: '', extent: 4096, keys: [], values: [], raw: [] };
      while (r.p < end) {
        const t = r.varint(), f = t >> 3;
        if (f === 1) L.name = r.str();
        else if (f === 2) { const n = r.varint(); L.raw.push([r.p, r.p + n]); r.p += n; }
        else if (f === 3) L.keys.push(r.str());
        else if (f === 4) L.values.push(readValue(r));
        else if (f === 5) L.extent = r.varint();
        else r.skip(t & 7);
      }
      if (want && !want.has(L.name)) continue;
      const feats = [];
      for (const [a, b] of L.raw) {
        const fr = new Reader(r.b); fr.p = a;
        const ft = { type: 0, props: {}, geom: null };
        while (fr.p < b) {
          const t = fr.varint(), f = t >> 3;
          if (f === 2) { const tags = fr.packed(); for (let i = 0; i + 1 < tags.length; i += 2) ft.props[L.keys[tags[i]]] = L.values[tags[i + 1]]; }
          else if (f === 3) ft.type = fr.varint();
          else if (f === 4) ft.geom = fr.packed();
          else fr.skip(t & 7);
        }
        feats.push(ft);
      }
      out[L.name] = { extent: L.extent, features: feats };
    }
    return out;
  }
  /** Geometry commands -> rings / lines / points: arrays of [x, y] in tile units. */
  function rings(geom) {
    const out = []; let cur = null, x = 0, y = 0;
    for (let i = 0; i < (geom ? geom.length : 0);) {
      const c = geom[i++], cmd = c & 7, n = c >> 3;
      if (cmd === 1 || cmd === 2) {
        for (let k = 0; k < n; k++) {
          x += zz(geom[i++]); y += zz(geom[i++]);
          if (cmd === 1) { cur = [[x, y]]; out.push(cur); } else cur.push([x, y]);
        }
      } else if (cmd === 7 && cur && cur.length) { /* closed implicitly */ }
    }
    return out;
  }
  /** Signed area (tile units, y down): > 0 for an MVT exterior ring. */
  function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }
  /** Rings of a polygon feature -> [{ outer, holes }] (MVT: exteriors positive, holes negative). */
  function polygons(rs) {
    const out = [];
    for (const r of rs) {
      if (r.length < 3) continue;
      const a = ringArea(r);
      if (a > 0 || !out.length) out.push({ outer: r, holes: [], area: Math.abs(a) });
      else out[out.length - 1].holes.push(r);
    }
    return out;
  }
  function pointInRing(x, y, r) {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function pointInPoly(x, y, P) { if (!pointInRing(x, y, P.outer)) return false; for (const h of P.holes) if (pointInRing(x, y, h)) return false; return true; }

  // ---------------------------------------------------------------- triangulation (roofs)
  /** Triangulate a polygon (flat array of [x, y]) with holes: returns vertex indices into outer..holes. */
  function triangulate(outer, holes) {
    const pts = outer.slice(); let poly = outer.map((_, i) => i);
    if (ringArea(outer) < 0) poly.reverse();   // work counter-clockwise in this sense (area > 0)
    for (const h of (holes || []).slice().sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])))) {
      if (h.length < 3) continue;
      const base = pts.length; h.forEach(p => pts.push(p));
      let hi = h.map((_, i) => base + i); if (ringArea(h) > 0) hi.reverse();
      // bridge from the hole's rightmost vertex to the nearest outer vertex that does not cross an edge
      let m = 0; hi.forEach((v, k) => { if (pts[v][0] > pts[hi[m]][0]) m = k; });
      const hv = hi[m], P = pts[hv];
      let best = -1, bd = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const v = poly[k], d = (pts[v][0] - P[0]) ** 2 + (pts[v][1] - P[1]) ** 2;
        if (d >= bd) continue;
        if (!crossesAny(P, pts[v], poly, pts, hv, v)) { bd = d; best = k; }
      }
      if (best < 0) { for (let k = 0; k < poly.length; k++) { const v = poly[k], d = (pts[v][0] - P[0]) ** 2 + (pts[v][1] - P[1]) ** 2; if (d < bd) { bd = d; best = k; } } }
      const rot = hi.slice(m).concat(hi.slice(0, m));
      poly = poly.slice(0, best + 1).concat(rot, [hv, poly[best]], poly.slice(best + 1));
    }
    return earClip(poly, pts);
  }
  function segX(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function crossesAny(a, b, poly, pts) {
    for (let i = 0; i < poly.length; i++) { const p = pts[poly[i]], q = pts[poly[(i + 1) % poly.length]]; if (segX(a, b, p, q)) return true; }
    return false;
  }
  function earClip(poly, pts) {
    const tris = [], V = poly.slice();
    const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    const inTri = (p, a, b, c) => {
      const P = pts[p], A = pts[a], B = pts[b], C = pts[c];
      const s1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
      const s2 = (C[0] - B[0]) * (P[1] - B[1]) - (C[1] - B[1]) * (P[0] - B[0]);
      const s3 = (A[0] - C[0]) * (P[1] - C[1]) - (A[1] - C[1]) * (P[0] - C[0]);
      return s1 >= 0 && s2 >= 0 && s3 >= 0;
    };
    // positive area (y down, "clockwise on screen"): convex corners have a positive cross product
    const sgn = 1;
    let guard = V.length * V.length + 10, i = 0;
    while (V.length > 3 && guard-- > 0) {
      const n = V.length, a = V[(i + n - 1) % n], b = V[i % n], c = V[(i + 1) % n];
      let ear = cross(a, b, c) * sgn > 0;
      if (ear) for (let k = 0; k < n; k++) {
        const p = V[k]; if (p === a || p === b || p === c) continue;
        if (pts[p][0] === pts[b][0] && pts[p][1] === pts[b][1]) continue;
        if (sgn > 0 ? inTri(p, a, b, c) : inTri(p, c, b, a)) { ear = false; break; }
      }
      if (ear) { tris.push(a, b, c); V.splice(i % n, 1); i = Math.max(0, i - 1); } else i++;
      if (i > V.length * 2) { // stuck (degenerate input): fan the rest
        for (let k = 1; k + 1 < V.length; k++) tris.push(V[0], V[k], V[k + 1]);
        return { tris, pts };
      }
    }
    if (V.length === 3) tris.push(V[0], V[1], V[2]);
    return { tris, pts };
  }

  // ---------------------------------------------------------------- buildings
  function hash(x, y) { let h = Math.imul((x * 73856093) ^ (y * 19349663), 0x9E3779B1); h ^= h >>> 15; return (h >>> 0) / 4294967296; }
  const WALLS = [[0.93, 0.9, 0.84], [0.86, 0.82, 0.74], [0.95, 0.94, 0.91], [0.78, 0.72, 0.64], [0.84, 0.66, 0.52], [0.72, 0.74, 0.76], [0.9, 0.86, 0.78]];
  const TOWERS = [[0.55, 0.64, 0.72], [0.68, 0.72, 0.76], [0.46, 0.52, 0.58], [0.8, 0.8, 0.78]];
  const ROOFS = [[0.55, 0.27, 0.2], [0.45, 0.24, 0.19], [0.36, 0.36, 0.38], [0.62, 0.35, 0.25]];
  function hexRgb(s) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim()); if (!m) return null;
    const v = parseInt(m[1], 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }
  /** Height (m) of a building feature: OpenMapTiles render_height, else a modest default. */
  function buildingHeight(props) { const h = +props.render_height; return isFinite(h) && h > 0 ? clamp(h, 2.5, 600) : 7; }
  /** Wall and roof colours for a building (by its own colour tag, else its height and a hash). */
  function buildingColours(props, h, cx, cy) {
    const r = hash(Math.round(cx), Math.round(cy));
    const own = hexRgb(props.colour);
    const wall = own ? own.map(v => 0.35 + 0.65 * v) : (h > 28 ? TOWERS : WALLS)[Math.floor(r * 997) % (h > 28 ? TOWERS.length : WALLS.length)];
    const roof = ROOFS[Math.floor(r * 7919) % ROOFS.length];
    return { wall, roof };
  }
  /** Roof form: 'gable' (simple four-corner houses), 'hip' (small convex), else 'flat'. */
  function roofKind(ring, areaM2, h) {
    if (h > 16 || areaM2 > 600) return 'flat';
    const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
    if (n === 4) return 'gable';
    if (n <= 8 && convex(ring) && areaM2 < 300) return 'hip';
    return 'flat';
  }
  function convex(r) {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (z !== 0) { if (s && Math.sign(z) !== s) return false; s = Math.sign(z); }
    }
    return true;
  }

  /** A growable set of mesh arrays. */
  function MeshBuf() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }
  MeshBuf.prototype.tri = function (a, b, c, col, ua, ub, uc) {
    // face it the way its own normal says (counter-clockwise from the outside)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) { this.nor.push(nx, ny, nz); this.col.push(col[0], col[1], col[2]); }
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  };
  /** A triangle whose winding is chosen so its normal points along `want` ([x, y, z]). */
  MeshBuf.prototype.triFacing = function (a, b, c, want, col, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const d = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2];
    if (d >= 0) this.tri(a, b, c, col, ua, ub, uc); else this.tri(a, c, b, col, ua, uc, ub);
  };
  const ROOF_UV = [0.5, 0.985];   // a solid strip at the top of the facade texture

  /**
   * Build one tile's buildings into merged mesh arrays.
   * feats: decoded 'building' features; o: { extent, toLocal(px, py) -> [x, z], groundAt(x, z),
   * metresPerUnit, minArea (m^2, skip smaller unless tall), maxCount, simple (flat roofs only) }.
   * Returns { pos, nor, col, uv (Float32Array), count (buildings), tris }.
   */
  function buildBuildings(feats, o) {
    const M = new MeshBuf(), mpu = o.metresPerUnit, WIN = 1 / 12;   // facade texture: 12 m a repeat
    let count = 0;
    for (const f of feats) {
      if (f.type !== 3 || f.props.hide_3d) continue;
      if (o.maxCount && count >= o.maxCount) break;
      for (const P of polygons(rings(f.geom))) {
        const areaM2 = P.area * mpu * mpu, h = buildingHeight(f.props), minH = +f.props.render_min_height || 0;
        if (areaM2 < (o.minArea || 0) && h < 20) continue;
        if (areaM2 < 6) continue;
        const outer = P.outer, loc = outer.map(p => o.toLocal(p[0], p[1]));
        let cx = 0, cz = 0; loc.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= loc.length; cz /= loc.length;
        let gMin = Infinity; for (const p of loc) gMin = Math.min(gMin, o.groundAt(p[0], p[1]));
        const gC = o.groundAt(cx, cz);
        if (!isFinite(gMin)) continue;
        const base = minH > 0 ? gC + minH : gMin - 1.0, top = gC + h;
        if (top - base < 1) continue;
        const C = buildingColours(f.props, h, cx, cz);
        const kind = o.simple || minH > 0 ? 'flat' : roofKind(outer, areaM2, h);
        const roofH = kind === 'flat' ? 0 : clamp(Math.sqrt(areaM2) * 0.32, 1.5, 5);
        const eave = top - roofH;
        // walls (outer ring and courtyards)
        const ringsLoc = [{ r: loc, hole: false }].concat(P.holes.map(hr => ({ r: hr.map(p => o.toLocal(p[0], p[1])), hole: true })));
        for (const { r, hole } of ringsLoc) {
          const A = ringArea(r);   // > 0 in the local frame too (same orientation as tile units)
          let u = 0;
          for (let i = 0; i < r.length; i++) {
            const p = r[i], q = r[(i + 1) % r.length];
            const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
            if (len < 0.4) continue;
            // outward for the outer ring, into the courtyard for holes
            const s = (A > 0 ? -1 : 1) * (hole ? -1 : 1);
            const want = [-dz * s, 0, dx * s];
            const a = [p[0], base, p[1]], b = [q[0], base, q[1]], c = [q[0], eave, q[1]], d = [p[0], eave, p[1]];
            const u0 = u * WIN, u1 = (u + len) * WIN, v0 = (base - gC) * WIN, v1 = (eave - gC) * WIN;
            M.triFacing(a, b, c, want, C.wall, [u0, v0], [u1, v0], [u1, v1]);
            M.triFacing(a, c, d, want, C.wall, [u0, v0], [u1, v1], [u0, v1]);
            u += len;
          }
        }
        // roof
        const up = [0, 1, 0];
        if (kind === 'gable') gable(M, loc.slice(0, 4), eave, roofH, C);
        else if (kind === 'hip') {
          const apex = [cx, eave + roofH, cz];
          for (let i = 0; i < loc.length; i++) { const p = loc[i], q = loc[(i + 1) % loc.length]; M.triFacing([p[0], eave, p[1]], [q[0], eave, q[1]], apex, up, C.roof, ROOF_UV, ROOF_UV, ROOF_UV); }
        } else {
          const T = triangulate(outer, P.holes);
          const roofCol = C.wall.map(v => v * 0.62);
          for (let k = 0; k < T.tris.length; k += 3) {
            const pa = o.toLocal(...T.pts[T.tris[k]]), pb = o.toLocal(...T.pts[T.tris[k + 1]]), pc = o.toLocal(...T.pts[T.tris[k + 2]]);
            M.triFacing([pa[0], top, pa[1]], [pb[0], top, pb[1]], [pc[0], top, pc[1]], up, roofCol, ROOF_UV, ROOF_UV, ROOF_UV);
          }
        }
        count++;
      }
    }
    return { pos: new Float32Array(M.pos), nor: new Float32Array(M.nor), col: new Float32Array(M.col), uv: new Float32Array(M.uv), count, tris: M.pos.length / 9 };
  }
  /** A gabled roof over a four-corner footprint, ridge along the long axis, gable ends in wall colour. */
  function gable(M, q, eave, roofH, C) {
    const L = (a, b) => Math.hypot(q[b][0] - q[a][0], q[b][1] - q[a][1]);
    const s = L(0, 1) + L(2, 3) < L(1, 2) + L(3, 0) ? 0 : 1;   // edges s and s+2 are the short ones
    const mid = (a, b) => [(q[a][0] + q[b][0]) / 2, eave + roofH, (q[a][1] + q[b][1]) / 2];
    const i0 = s, i1 = (s + 1) % 4, i2 = (s + 2) % 4, i3 = (s + 3) % 4;
    const r0 = mid(i0, i1), r1 = mid(i2, i3);
    const P = i => [q[i][0], eave, q[i][1]];
    const up = [0, 1, 0];
    // two slopes: (i1, i2, r1, r0) and (i3, i0, r0, r1)
    M.triFacing(P(i1), P(i2), r1, up, C.roof, ROOF_UV, ROOF_UV, ROOF_UV); M.triFacing(P(i1), r1, r0, up, C.roof, ROOF_UV, ROOF_UV, ROOF_UV);
    M.triFacing(P(i3), P(i0), r0, up, C.roof, ROOF_UV, ROOF_UV, ROOF_UV); M.triFacing(P(i3), r0, r1, up, C.roof, ROOF_UV, ROOF_UV, ROOF_UV);
    // gable triangles, facing out along the ridge
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    for (const [a, b, r] of [[i0, i1, r0], [i2, i3, r1]]) M.triFacing(P(a), P(b), r, [r[0] - cx, 0, r[2] - cz], C.wall, [0.1, 0.5], [0.3, 0.5], [0.2, 0.6]);
  }

  // ---------------------------------------------------------------- the ground overlay
  // what each feature looks like on the ground: fill or line (width in metres), colour, and a draw
  // order; null = not drawn. Water is opaque (it is the coastline), land uses are faint tints over
  // the satellite image, roads are crisp
  const ROAD_W = { motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9, minor: 7, service: 4.5, track: 3, path: 0, raceway: 10, busway: 7 };
  function overlayStyle(layer, p) {
    const c = p.class;
    switch (layer) {
      case 'water': return { fill: c === 'swimming_pool' ? '#3a9fc0' : '#2d5f7a', alpha: 0.92, z: 5 };
      case 'waterway': return c === 'river' || c === 'canal' ? { line: '#2d5f7a', width: c === 'river' ? 16 : 10, alpha: 0.9, z: 6 } : c === 'stream' ? { line: '#3a6b82', width: 3, alpha: 0.75, z: 6 } : null;
      case 'landcover':
        if (c === 'wood') return { fill: '#2c4a22', alpha: 0.35, z: 2 };
        if (c === 'grass') return { fill: '#5d7d3a', alpha: 0.22, z: 1 };
        if (c === 'sand') return { fill: '#d8c79a', alpha: 0.3, z: 1 };
        if (c === 'ice') return { fill: '#eef3f6', alpha: 0.4, z: 1 };
        if (c === 'wetland') return { fill: '#486a50', alpha: 0.3, z: 1 };
        if (c === 'farmland') return { fill: '#9a9a5a', alpha: 0.1, z: 1 };
        return null;
      case 'landuse':
        if (c === 'residential' || c === 'suburb' || c === 'neighbourhood') return { fill: '#8f8a83', alpha: 0.18, z: 1 };
        if (c === 'commercial' || c === 'retail') return { fill: '#8a8580', alpha: 0.22, z: 1 };
        if (c === 'industrial' || c === 'railway') return { fill: '#7e7c78', alpha: 0.25, z: 1 };
        if (c === 'cemetery' || c === 'pitch' || c === 'stadium') return { fill: '#5f8a42', alpha: 0.3, z: 2 };
        return null;
      case 'park': return { fill: '#4f7a34', alpha: 0.28, z: 2 };
      case 'aeroway':
        if (c === 'runway') return p._poly ? { fill: '#4a4c50', alpha: 0.95, z: 8 } : { line: '#4a4c50', width: 40, alpha: 0.95, z: 8 };
        if (c === 'taxiway') return p._poly ? { fill: '#55585c', alpha: 0.9, z: 8 } : { line: '#55585c', width: 16, alpha: 0.9, z: 8, center: '#d8b440' };
        if (c === 'apron') return { fill: '#6c6f72', alpha: 0.88, z: 7 };
        if (c === 'helipad') return { fill: '#5a5d61', alpha: 0.9, z: 8 };
        return null;
      case 'transportation': {
        if (p.brunnel === 'tunnel') return null;
        if (c === 'rail' || c === 'transit') return { line: '#5a5550', width: 4, alpha: 0.8, z: 9, lit: false };
        const w = ROAD_W[c];
        if (!w) return null;
        return { line: c === 'motorway' || c === 'trunk' ? '#6a6662' : '#77736e', width: w, alpha: 0.9, z: c === 'motorway' || c === 'trunk' ? 12 : 10, casing: w >= 9, lit: c !== 'track' };
      }
      case 'building': return { fill: '#8e8478', alpha: 0.85, z: 11, edge: '#5e5850' };
    }
    return null;
  }

  // ---------------------------------------------------------------- trees
  /** Random points (tile units) inside woods, parks and grass with trees: up to n, seeded. */
  function treePoints(layers, n, seed) {
    const polys = [];
    const take = (layer, ok) => { const L = layers[layer]; if (!L) return; for (const f of L.features) if (f.type === 3 && ok(f.props)) for (const P of polygons(rings(f.geom))) polys.push({ P, w: f.props.class === 'wood' ? 1 : 0.35 }); };
    take('landcover', p => p.class === 'wood');
    take('park', () => true);
    if (!polys.length) return [];
    const ext = (layers.landcover || layers.park).extent || 4096;
    // area-weighted: try points across the bounding box of all wooded polygons
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { P } of polys) for (const [x, y] of P.outer) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(ext, x1); y1 = Math.min(ext, y1);
    let s = seed >>> 0 || 1;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const out = [];
    for (let k = 0; k < n * 4 && out.length < n; k++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), w = rnd();
      for (const { P, w: pw } of polys) if (w < pw && pointInPoly(x, y, P)) { out.push([x, y, rnd()]); break; }
    }
    return out;
  }

  /** Which layers the game uses (others are skipped while decoding). */
  const LAYERS = ['water', 'waterway', 'landcover', 'landuse', 'park', 'aeroway', 'transportation', 'building'];

  const api = { decodeTile, rings, ringArea, polygons, pointInPoly, triangulate, buildBuildings, buildingHeight, buildingColours, roofKind, overlayStyle, treePoints, LAYERS, hexRgb, Reader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OSM = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null));
