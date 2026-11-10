/*
 * GYROWING real world, the streaming part: terrain from open data, loaded around the aircraft.
 *
 *   Elevation  AWS Terrain Tiles (Mapzen terrarium PNG), z <= 12 (~30 m, SRTM-class data)
 *   Imagery    EOX Sentinel-2 cloudless 2016 (CC BY 4.0), z <= 14 (~10 m)
 *   Airports   OurAirports (public domain), runways from data/airports.json
 *
 * The ground is a quadtree of web-mercator tiles (geo.js picks the leaves: fine under the
 * aircraft, coarse toward the horizon, coarser as you climb). Each leaf is a 33 x 33 vertex grid
 * with skirts, heights from the best elevation tile loaded so far (its own, or a coarser ancestor
 * while that one is on its way) and the best imagery loaded so far, so the view never has holes
 * and sharpens as data arrives.
 *
 * Being kind to the tile servers: only tiles the current view needs are requested, nearest first,
 * at most 4 at a time per server; stale requests are dropped before they start; every tile goes
 * into the browser's Cache Storage, so a second flight over the same place downloads nothing.
 *
 * Physics: heightAt(x, z) interpolates the finest built grid exactly like its triangles, so the
 * wheels sit on what you see. Runways (and 120 m around them) are flattened in the grids to the
 * runway's own slope from the elevation data.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ROOT_Z = 11, EMAX = Geo.SOURCES.elevation.maxZoom, IMAX = Geo.SOURCES.imagery.maxZoom, TS = 256;
  const CACHE = 'gyrowing-tiles-v1';

  function create(scene, renderer, world) {
    const RW = { active: false, group: new THREE.Group(), loc: null, F: null, stats: { net: 0, cached: 0, failed: 0, bytes: 0, nodes: 0, visible: 0, inflight: 0, builds: 0 } };
    RW.group.visible = false; scene.add(RW.group);
    const terrainG = new THREE.Group(), runwayG = new THREE.Group();
    RW.group.add(terrainG); RW.group.add(runwayG);
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    let S = 32, RADIUS = 46000, SPLIT = 1.6;
    RW.setDetail = q => { S = q === 0 ? 24 : q === 2 ? 40 : 32; RADIUS = q === 0 ? 36000 : 46000; sharedIndex = null; };

    // ------------------------------------------------------------------ fetching + caches
    const cacheP = (typeof caches !== 'undefined') ? caches.open(CACHE).catch(() => null) : Promise.resolve(null);
    async function fetchBlob(url) {
      const cache = await cacheP;
      if (cache) { try { const hit = await cache.match(url); if (hit) { RW.stats.cached++; return await hit.blob(); } } catch (e) { /* cache unavailable */ } }
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob();
      RW.stats.net++; RW.stats.bytes += b.size;
      if (cache) cache.put(url, new Response(b, { headers: { 'Content-Type': b.type || 'application/octet-stream' } })).catch(() => {});
      return b;
    }
    const cnv = document.createElement('canvas'); cnv.width = cnv.height = TS;
    const ctx2 = cnv.getContext('2d', { willReadFrequently: true });
    /** A store of tiles of one kind: entries { key, z, x, y, state, prio, want, data }. */
    function Store(kind, max, cap) {
      this.kind = kind; this.max = max; this.cap = cap; this.map = new Map(); this.active = 0;
    }
    Store.prototype.need = function (z, x, y, prio, tick) {
      const key = z + '/' + x + '/' + y;
      let e = this.map.get(key);
      if (!e) { e = { key, z, x, y, state: 'queued', prio, want: tick }; this.map.set(key, e); }
      else { if (e.want !== tick || prio < e.prio) e.prio = prio; e.want = tick; }
      return e;
    };
    Store.prototype.get = function (z, x, y) { const e = this.map.get(z + '/' + x + '/' + y); return e && e.state === 'ok' ? e : null; };
    Store.prototype.pump = function (tick) {
      while (this.active < this.max) {
        let best = null;
        for (const e of this.map.values()) if (e.state === 'queued' && e.want >= tick - 1 && (!best || e.prio < best.prio)) best = e;
        if (!best) break;
        this.start(best);
      }
    };
    Store.prototype.start = function (e) {
      e.state = 'loading'; this.active++; RW.stats.inflight++;
      const job = this.kind === 'elev' ? loadElev(e) : loadImg(e);
      job.then(() => { e.state = 'ok'; RW.dataVersion++; })
        .catch(err => { e.state = 'fail'; e.err = String(err && err.message || err); RW.stats.failed++; })
        .finally(() => { this.active--; RW.stats.inflight--; });
    };
    /** Forget the least recently wanted loaded tiles beyond the cap (never ones in use). */
    Store.prototype.evict = function (inUse) {
      if (this.map.size <= this.cap) return;
      const list = [...this.map.values()].filter(e => e.state !== 'loading' && !inUse.has(e.key)).sort((a, b) => a.want - b.want);
      for (let i = 0; i < list.length && this.map.size > this.cap; i++) {
        const e = list[i]; if (e.data && e.data.dispose) e.data.dispose(); this.map.delete(e.key);
      }
    };
    async function loadElev(e) {
      const blob = await fetchBlob(Geo.elevationUrl(e.z, e.x, e.y));
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      ctx2.clearRect(0, 0, TS, TS); ctx2.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
      e.data = Geo.decodeTerrariumImage(ctx2.getImageData(0, 0, TS, TS).data, TS, TS);
    }
    async function loadImg(e) {
      const blob = await fetchBlob(Geo.imageryUrl(e.z, e.x, e.y));
      const bmp = await createImageBitmap(blob);
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      e.data = t;
    }
    const elev = new Store('elev', Geo.SOURCES.elevation.concurrency, 140);
    const img = new Store('img', Geo.SOURCES.imagery.concurrency, 320);
    RW.dataVersion = 0;

    // ------------------------------------------------------------------ flatten zones (runways)
    let zones = [];
    function flatten(x, z, h) {
      for (let k = 0; k < zones.length; k++) {
        const Z = zones[k];
        if (x < Z.bx0 || x > Z.bx1 || z < Z.bz0 || z > Z.bz1) continue;
        const dx = x - Z.ax, dz = z - Z.az;
        const along = dx * Z.dx + dz * Z.dz, across = dx * -Z.dz + dz * Z.dx;
        const ox = Math.max(0, -along, along - Z.len), oy = Math.max(0, Math.abs(across) - Z.hw);
        const d = Math.hypot(ox, oy);
        if (d >= Z.core + Z.blend) continue;
        const re = Z.ea + (Z.eb - Z.ea) * clamp(along / Z.len, 0, 1);
        h = d <= Z.core ? re : re + (h - re) * smoothstep(Z.core, Z.core + Z.blend, d);
      }
      return h;
    }
    function makeZone(rw, ap) {
      const dx = (rw.end.x - rw.thr.x) / rw.len, dz = (rw.end.z - rw.thr.z) / rw.len, pad = 600;
      return { rw, ap, ax: rw.thr.x, az: rw.thr.z, dx, dz, len: rw.len, hw: rw.width / 2, core: 120, blend: 380, ea: ap.elev, eb: ap.elev, final: false,
        bx0: Math.min(rw.thr.x, rw.end.x) - pad, bx1: Math.max(rw.thr.x, rw.end.x) + pad, bz0: Math.min(rw.thr.z, rw.end.z) - pad, bz1: Math.max(rw.thr.z, rw.end.z) + pad };
    }
    /** Raw elevation from the best loaded tile (no flattening); null if nothing covers it yet. */
    function rawElev(x, z) {
      if (!RW.F) return null;
      for (let ez = EMAX; ez >= ROOT_Z - 2; ez--) {
        const t = RW.F.localToTile(x, z, ez), tx = Math.floor(t.x), ty = Math.floor(t.y);
        const e = elev.get(ez, tx, ty);
        if (e) return Geo.sampleGrid(e.data, TS, (t.x - tx) * TS - 0.5, (t.y - ty) * TS - 0.5);
      }
      return null;
    }
    RW.rawElev = rawElev;
    /** Runway end elevations from the DEM, a least-squares line through samples along the centreline. */
    function settleZone(Z) {
      if (Z.final) return;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const f = i / 8, x = Z.ax + Z.dx * Z.len * f, z = Z.az + Z.dz * Z.len * f;
        const t = RW.F.localToTile(x, z, EMAX);
        if (!elev.get(EMAX, Math.floor(t.x), Math.floor(t.y))) return;
        pts.push([f, rawElev(x, z)]);
      }
      const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - m * sx) / n;
      const slope = clamp(m, -0.025 * Z.len, 0.025 * Z.len);   // runways slope at most ~2.5%
      Z.ea = b; Z.eb = b + slope; Z.final = true;
      Z.rw.elevA = Z.ea; Z.rw.elevB = Z.eb;
      for (const nd of nodes.values()) if (nd.built && overlaps(nd.rect, Z)) nd.dirty = true;
      placeRunwayMesh(Z);
    }
    const overlaps = (r, Z) => !(r.x1 < Z.bx0 || r.x0 > Z.bx1 || r.z1 < Z.bz0 || r.z0 > Z.bz1);

    // ------------------------------------------------------------------ terrain nodes
    const nodes = new Map();   // key -> { z, x, y, key, rect, mesh, grid, elevKey, imgKey, want, dirty }
    // ground detail: Sentinel-2 is 10 m a pixel, a blur from a few hundred feet. A CC0 aerial texture
    // (the island's) modulates its brightness near the camera, two scales, fading out by 2.5 km;
    // brightness only, so water, towns and snow keep their real colours
    const detailU = { tDetail: { value: null }, uDetailOn: { value: 0 }, uDetailMean: { value: 0.5 } };
    // the terrain is lit in its own small shader (sun + sky): a MeshBasicMaterial has a fraction of
    // a Lambert's uniforms, and with ~150 tiles each on its own texture that is most of the CPU cost
    const lightU = { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSkyCol: { value: new THREE.Color(0.4, 0.45, 0.5) }, uGndCol: { value: new THREE.Color(0.2, 0.2, 0.15) } };
    if (window.World && World.loadTex) World.loadTex('assets/tex/aerial_grass_rock_diff.jpg', maxAniso, (t, mean) => { detailU.tDetail.value = t; detailU.uDetailMean.value = (mean.r + mean.g + mean.b) / 3; detailU.uDetailOn.value = 1; });
    function detailPatch(sh) {
      Object.assign(sh.uniforms, detailU, lightU);
      sh.vertexShader = `varying vec3 vDWorld; varying vec3 vNW;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vDWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vNW = normal;`);
      sh.fragmentShader = `uniform sampler2D tDetail; uniform float uDetailOn, uDetailMean; varying vec3 vDWorld; varying vec3 vNW;
uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol;
` + sh.fragmentShader.replace('vec3 outgoingLight = reflectedLight.indirectDiffuse;', `vec3 nW = normalize(vNW);
  vec3 outgoingLight = diffuseColor.rgb * (uSunCol * max(dot(nW, uSunDir), 0.0) + mix(uGndCol, uSkyCol, 0.5 * nW.y + 0.5));`).replace('#include <map_fragment>', `#include <map_fragment>
        if (uDetailOn > 0.5) {
          float fd = 1.0 - smoothstep(250.0, 2500.0, length(vDWorld - cameraPosition));
          if (fd > 0.0) {
            float a = dot(texture2D(tDetail, vDWorld.xz / 41.0).rgb, vec3(0.3333)) / uDetailMean;
            float b = dot(texture2D(tDetail, vDWorld.xz / 9.7 + 0.37).rgb, vec3(0.3333)) / uDetailMean;
            diffuseColor.rgb *= mix(1.0, clamp(a * 0.6 + b * 0.4, 0.4, 1.7), 0.55 * fd);
          }
        }`);
    }
    const placeholder = new THREE.DataTexture(new Uint8Array([118, 128, 96, 255]), 1, 1); placeholder.encoding = THREE.sRGBEncoding; placeholder.needsUpdate = true;
    let sharedIndex = null, sharedIndexS = 0;
    function gridIndex() {
      if (sharedIndex && sharedIndexS === S) return sharedIndex;
      const N1 = S + 1, idx = [];
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1; idx.push(a, c, b, c, d, b); }
      // skirts: one ring of vertices after the grid, in edge order (top, right, bottom, left)
      const edge = [];
      for (let i = 0; i < S; i++) edge.push(i);
      for (let j = 0; j < S; j++) edge.push(j * N1 + S);
      for (let i = S; i > 0; i--) edge.push(S * N1 + i);
      for (let j = S; j > 0; j--) edge.push(j * N1);
      const base = N1 * N1, m = edge.length;
      for (let k = 0; k < m; k++) { const a = edge[k], b = edge[(k + 1) % m], sa = base + k, sb = base + (k + 1) % m; idx.push(a, b, sa, b, sb, sa); }
      sharedIndex = { attr: new THREE.BufferAttribute(new Uint32Array(idx), 1), edge };
      sharedIndexS = S;
      return sharedIndex;
    }
    /** The finest loaded tile of a store covering node (z, x, y) at or below maxZ: { e, u0, v0, size }. */
    function best(store, z, x, y, maxZ, minZ) {
      for (let k = Math.min(z, maxZ); k >= minZ; k--) {
        const src = Geo.elevationSource(z, x, y, k);
        const e = store.get(src.z, src.x, src.y);
        if (e) return Object.assign({ e }, src);
      }
      return null;
    }
    function buildNode(n, es, is) {
      const ix = gridIndex(), N1 = S + 1, nv = N1 * N1, ne = ix.edge.length;
      const r = n.rect, w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const grid = new Float32Array(nv);
      for (let j = 0; j <= S; j++) {
        const v = (es.v0 + es.size * j / S) * TS - 0.5, z = r.z0 + d * j / S;
        for (let i = 0; i <= S; i++) {
          const u = (es.u0 + es.size * i / S) * TS - 0.5, x = r.x0 + w * i / S;
          let h = Geo.sampleGrid(es.e.data, TS, u, v);
          if (zones.length) h = flatten(x, z, h);
          grid[j * N1 + i] = h < -0.5 ? -0.5 : h;   // the sea is a flat surface at sea level
        }
      }
      const pos = new Float32Array((nv + ne) * 3), nor = new Float32Array((nv + ne) * 3), uv = new Float32Array((nv + ne) * 2);
      const dxs = w / S, dzs = d / S, skirt = Math.max(12, w * 0.012);
      let hMin = 1e9, hMax = -1e9;
      for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
        const k = j * N1 + i, h = grid[k];
        pos[k * 3] = r.x0 + dxs * i - cx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = r.z0 + dzs * j - cz;
        const hl = grid[j * N1 + Math.max(0, i - 1)], hr = grid[j * N1 + Math.min(S, i + 1)], hu = grid[Math.max(0, j - 1) * N1 + i], hd = grid[Math.min(S, j + 1) * N1 + i];
        const gx = (hr - hl) / (dxs * (Math.min(S, i + 1) - Math.max(0, i - 1))), gz = (hd - hu) / (dzs * (Math.min(S, j + 1) - Math.max(0, j - 1)));
        const l = Math.hypot(gx, 1, gz); nor[k * 3] = -gx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -gz / l;
        if (h < hMin) hMin = h; if (h > hMax) hMax = h;
      }
      for (let k = 0; k < ne; k++) {
        const s = ix.edge[k], t = nv + k;
        pos[t * 3] = pos[s * 3]; pos[t * 3 + 1] = pos[s * 3 + 1] - skirt; pos[t * 3 + 2] = pos[s * 3 + 2];
        nor[t * 3] = nor[s * 3]; nor[t * 3 + 1] = nor[s * 3 + 1]; nor[t * 3 + 2] = nor[s * 3 + 2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(ix.attr);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (hMin + hMax) / 2, 0), Math.hypot(w / 2, d / 2, (hMax - hMin) / 2 + skirt));
      if (n.mesh) { n.mesh.geometry.dispose(); n.mesh.geometry = g; }
      else {
        const mat = new THREE.MeshBasicMaterial({ map: placeholder });
        mat.onBeforeCompile = detailPatch;
        n.mesh = new THREE.Mesh(g, mat);
        n.mesh.position.set(cx, 0, cz); n.mesh.matrixAutoUpdate = false; n.mesh.updateMatrix();
        terrainG.add(n.mesh);
      }
      n.grid = grid; n.N1 = N1; n.built = true; n.dirty = false; n.elevKey = es.e.key; n.imgKey = null; n.S = S;
      setImage(n, is);
      RW.stats.builds++;
    }
    function setImage(n, is) {
      const N1 = n.N1, uv = n.mesh.geometry.attributes.uv.array, nv = N1 * N1, edge = gridIndex().edge, Sx = N1 - 1;
      if (is) {
        for (let j = 0; j <= Sx; j++) for (let i = 0; i <= Sx; i++) { const k = j * N1 + i; uv[k * 2] = is.u0 + is.size * i / Sx; uv[k * 2 + 1] = is.v0 + is.size * j / Sx; }
        for (let k = 0; k < edge.length; k++) { uv[(nv + k) * 2] = uv[edge[k] * 2]; uv[(nv + k) * 2 + 1] = uv[edge[k] * 2 + 1]; }
        n.mesh.geometry.attributes.uv.needsUpdate = true;
      }
      n.mesh.material.map = is ? is.e.data : placeholder;
      n.imgKey = is ? is.e.key : null;
    }

    // ------------------------------------------------------------------ runways
    const asphalt = runwayTexture();
    function runwayTexture() {
      const c = document.createElement('canvas'); c.width = 64; c.height = 1024;
      const x = c.getContext('2d');
      x.fillStyle = '#3d3f42'; x.fillRect(0, 0, 64, 1024);
      for (let i = 0; i < 1400; i++) { const v = 50 + Math.random() * 30; x.fillStyle = `rgba(${v},${v},${v + 3},0.35)`; x.fillRect(Math.random() * 64, Math.random() * 1024, 1.5, 1.5); }
      x.fillStyle = '#e8e8e2';
      x.fillRect(2, 0, 2, 1024); x.fillRect(60, 0, 2, 1024);                // edge lines
      for (let y = 70; y < 954; y += 36) x.fillRect(31, y, 2, 18);          // centreline
      for (const y0 of [6, 1018 - 30]) for (let i = 0; i < 8; i++) x.fillRect(7 + i * 6.6 + (i >= 4 ? 4 : 0), y0, 3.4, 30);   // threshold piano keys
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
      return t;
    }
    function placeRunwayMesh(Z) {
      if (Z.mesh) { runwayG.remove(Z.mesh); Z.mesh.geometry.dispose(); }
      const rw = Z.rw, hw = rw.width / 2, nx = -Z.dz, nz = Z.dx, y0 = Z.ea + 0.12, y1 = Z.eb + 0.12;
      const P = [rw.thr.x - nx * hw, y0, rw.thr.z - nz * hw, rw.thr.x + nx * hw, y0, rw.thr.z + nz * hw, rw.end.x + nx * hw, y1, rw.end.z + nz * hw, rw.end.x - nx * hw, y1, rw.end.z - nz * hw];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      const rep = Math.max(1, Math.round(rw.len / 900));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, rep, 0, rep]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);   // counter-clockwise from above: the lit side faces up
      const m = new THREE.Mesh(g, rw.paved ? runwayMat : grassStripMat);
      m.receiveShadow = true; m.renderOrder = 1;
      runwayG.add(m); Z.mesh = m;
      // edge lights, every 60 m, white; threshold green, end red
      const pos = [], col = [], size = [];
      const add = (x, y, z, c, s) => { pos.push(x, y + 0.4, z); col.push(c.r, c.g, c.b); size.push(s); };
      const W = new THREE.Color(1, 0.92, 0.75), Gn = new THREE.Color(0.2, 1, 0.4), Rd = new THREE.Color(1, 0.2, 0.15);
      const nL = Math.max(2, Math.floor(rw.len / 60));
      for (let i = 0; i <= nL; i++) { const f = i / nL, x = rw.thr.x + Z.dx * rw.len * f, z = rw.thr.z + Z.dz * rw.len * f, y = Z.ea + (Z.eb - Z.ea) * f; add(x + nx * (hw + 2), y, z + nz * (hw + 2), W, 0.8); add(x - nx * (hw + 2), y, z - nz * (hw + 2), W, 0.8); }
      for (let i = -3; i <= 3; i++) { add(rw.thr.x + nx * i * hw / 3, Z.ea, rw.thr.z + nz * i * hw / 3, Gn, 1); add(rw.end.x + nx * i * hw / 3, Z.eb, rw.end.z + nz * i * hw / 3, Rd, 1); }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); lg.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
      const pts = new THREE.Points(lg, lightMat); pts.frustumCulled = false; m.add(pts);
      // PAPI for both landing directions: four lights left of the aiming point; on a 3 degree glide
      // path the two nearest the runway show red, the outer two white (updated per frame)
      const pp = [], pc = [], ps = []; Z.papi = [];
      const aimD = Math.min(300, rw.len * 0.18);
      for (const [t, dx, dz, e0, e1] of [[rw.thr, Z.dx, Z.dz, Z.ea, Z.eb], [rw.end, -Z.dx, -Z.dz, Z.eb, Z.ea]]) {
        const y = e0 + (e1 - e0) * aimD / rw.len + 1;
        for (let i = 0; i < 4; i++) {
          const off = hw + 15 + i * 9, x = t.x + dx * aimD + dz * off, z = t.z + dz * aimD - dx * off;
          pp.push(x, y, z); pc.push(1, 1, 1); ps.push(1.7); Z.papi.push({ x, y, z, th: [3.5, 3.17, 2.83, 2.5][i] });
        }
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3)); pg.setAttribute('size', new THREE.Float32BufferAttribute(ps, 1));
      Z.papiPts = new THREE.Points(pg, papiMat); Z.papiPts.frustumCulled = false; m.add(Z.papiPts);
    }
    function updatePapi(cam) {
      for (const Z of zones) {
        if (!Z.papiPts || Math.hypot(Z.ax - cam.x, Z.az - cam.z) > 15000) continue;
        const col = Z.papiPts.geometry.attributes.color;
        Z.papi.forEach((L, k) => {
          const ang = Math.atan2(cam.y - L.y, Math.max(1, Math.hypot(cam.x - L.x, cam.z - L.z))) * 180 / Math.PI;
          if (ang > L.th) col.setXYZ(k, 1, 0.97, 0.9); else col.setXYZ(k, 1, 0.12, 0.08);
        });
        col.needsUpdate = true;
      }
    }
    const runwayMat = new THREE.MeshLambertMaterial({ map: asphalt, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const grassStripMat = new THREE.MeshLambertMaterial({ color: new THREE.Color("#6d7444").convertSRGBToLinear(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const lightMat = world.pointsMat ? world.pointsMat({ base: 0.0 }) : new THREE.PointsMaterial({ size: 2 });
    if (world.lightMats) world.lightMats.push(lightMat);
    const papiMat = world.pointsMat ? world.pointsMat({ base: 1 }) : new THREE.PointsMaterial({ size: 3, vertexColors: true });
    if (world.lightMats) world.lightMats.push(papiMat);

    // ------------------------------------------------------------------ location
    let tick = 0, lodT = 0, lastCam = null, rootKeys = [];
    /**
     * Fly at a location (geo.js locationFor): set the frame, runways of every airport within
     * 70 km (flattened and drawn), and start loading around the start point.
     */
    RW.setLocation = function (loc, db) {
      RW.clear();
      RW.loc = loc; RW.F = loc.frame;
      const near = Geo.nearestAirports(db, loc.lat, loc.lon, 40, 70);
      if (!near.find(a => a.id === loc.airport.id)) near.unshift(loc.airport);
      RW.airports = near.map(a => Geo.localAirport(loc.frame, a));
      zones = [];
      for (const ap of RW.airports) {
        const seen = new Set();
        for (const rw of ap.runways) {
          const id = [rw.name, rw.recip].sort().join('/');
          if (seen.has(id)) { const twin = zones.find(z => z.ap === ap && z.id === id); rw.zone = twin; continue; }
          seen.add(id);
          const Z = makeZone(rw, ap); Z.id = id; rw.zone = Z; zones.push(Z);
          placeRunwayMesh(Z);
        }
      }
      RW.fallbackElev = loc.airport.elev;
      tick = 0; lodT = 0; lastCam = null;
      RW.active = true; RW.group.visible = true;
    };
    /** Drop every node, texture and runway (keeps Cache Storage). */
    RW.clear = function () {
      for (const n of nodes.values()) disposeNode(n);
      nodes.clear();
      for (const Z of zones) if (Z.mesh) { runwayG.remove(Z.mesh); Z.mesh.geometry.dispose(); }
      zones = [];
      for (const st of [elev, img]) { for (const e of st.map.values()) if (e.data && e.data.dispose) e.data.dispose(); st.map.clear(); }
      RW.loc = null; RW.F = null; RW.airports = [];
    };
    RW.deactivate = function () { RW.active = false; RW.group.visible = false; };
    function disposeNode(n) { if (n.mesh) { terrainG.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); n.mesh = null; } }

    /** Make sure the start area and its runway are loaded: elevation tiles within `radius` m of (x, z). */
    RW.preload = function (x, z, radius) {
      RW.preloadArea = { x, z, radius };
    };
    function preloadNeeds(t) {
      const P = RW.preloadArea; if (!P) return [];
      const a = RW.F.localToTile(P.x - P.radius, P.z - P.radius, EMAX), b = RW.F.localToTile(P.x + P.radius, P.z + P.radius, EMAX);
      const out = [];
      for (let ty = Math.floor(a.y); ty <= Math.floor(b.y); ty++) for (let tx = Math.floor(a.x); tx <= Math.floor(b.x); tx++) out.push(elev.need(EMAX, tx, ty, -50, t));
      return out;
    }
    /** 0..1 how ready the start is: preload tiles in, the start runway settled, the nodes under the start built. */
    RW.readiness = function (x, z) {
      if (!RW.F) return 0;
      const pre = RW.preloadArea ? preloadNeeds(tick) : [];
      const done = pre.filter(e => e.state === 'ok' || e.state === 'fail').length;
      const t = RW.F.localToTile(x, z, IMAX);
      const nd = nodes.get(IMAX + '/' + Math.floor(t.x) + '/' + Math.floor(t.y));
      const under = nd && nd.built && nd.elevKey && +nd.elevKey.split('/')[0] === EMAX ? 1 : 0;
      const zs = zones.filter(Z => Math.hypot(Z.ax - x, Z.az - z) < 6000);
      const zoneOk = zs.every(Z => Z.final);
      const failedAll = pre.length && pre.every(e => e.state === 'fail');
      if (failedAll) return -1;
      return (pre.length ? done / pre.length : 1) * 0.6 + under * 0.25 + (zoneOk ? 0.15 : 0);
    };

    // ------------------------------------------------------------------ per frame
    RW.update = function (camera, focus, dt) {
      if (!RW.active || !RW.F) return;
      // terrain light follows the world's sun and sky (same units as a Lambert surface)
      if (world.sun) {
        const ld = world.lightDir || world.sun.position.clone().sub(world.sun.target.position).normalize();
        lightU.uSunDir.value.copy(ld).normalize();
        // the imagery is already sunlit: scale so a flat field at midday shows about its own colours
        // (a Lambert surface would come out ~3x brighter and wash the desert at Leh to white)
        const K = 1 / 2.9;
        lightU.uSunCol.value.copy(world.sun.color).multiplyScalar(world.sun.intensity * K);
        if (world.hemi) { lightU.uSkyCol.value.copy(world.hemi.color).multiplyScalar(world.hemi.intensity * K); lightU.uGndCol.value.copy(world.hemi.groundColor).multiplyScalar(world.hemi.intensity * K); }
      }
      lodT -= dt;
      const cam = camera.position;
      const moved = !lastCam || Math.hypot(cam.x - lastCam.x, cam.z - lastCam.z) > 150 || Math.abs(cam.y - lastCam.y) > 150;
      if (lodT <= 0 || (moved && lodT < 0.15)) {
        lodT = 0.3; lastCam = cam.clone(); tick++;
        const g = RW.heightAt(cam.x, cam.z);
        const sel = Geo.selectTiles(RW.F, { x: cam.x, z: cam.z, agl: cam.y - g }, { rootZoom: ROOT_Z, maxZoom: IMAX, radius: RADIUS, splitK: SPLIT });
        RW.selection = sel;
        const roots = new Set();
        for (const leaf of sel) {
          let n = nodes.get(leaf.key);
          if (!n) { n = { z: leaf.z, x: leaf.x, y: leaf.y, key: leaf.key, rect: leaf.rect, built: false }; nodes.set(leaf.key, n); }
          n.want = tick; n.d = leaf.d;
          const size = leaf.rect.x1 - leaf.rect.x0, prio = leaf.d / size;   // nearer (in tile sizes) first
          const es = Geo.elevationSource(leaf.z, leaf.x, leaf.y, EMAX);
          elev.need(es.z, es.x, es.y, prio, tick);
          img.need(leaf.z, leaf.x, leaf.y, prio + 0.5, tick);
          const rs = Geo.elevationSource(leaf.z, leaf.x, leaf.y, ROOT_Z);
          roots.add(rs.z + '/' + rs.x + '/' + rs.y);
        }
        // the coarse root tiles come first: they fill the whole view within a second
        rootKeys = [...roots];
        for (const k of rootKeys) { const [z, x, y] = k.split('/').map(Number); elev.need(z, x, y, -10, tick); img.need(z, x, y, -9, tick); }
        preloadNeeds(tick);
        // runways near the camera: their elevation tiles, so they settle before you get there
        for (const Z of zones) if (!Z.final && Math.hypot(Z.ax - cam.x, Z.az - cam.z) < 25000) {
          for (const p of [[Z.ax, Z.az], [Z.ax + Z.dx * Z.len, Z.az + Z.dz * Z.len]]) { const t = RW.F.localToTile(p[0], p[1], EMAX); elev.need(EMAX, Math.floor(t.x), Math.floor(t.y), 0.5, tick); }
        }
        // visibility + bookkeeping
        let vis = 0;
        for (const n of nodes.values()) { const on = n.want === tick && n.built; if (n.mesh) n.mesh.visible = on; if (on) vis++; }
        RW.stats.visible = vis; RW.stats.nodes = nodes.size;
        // evictions: nodes not wanted for a while, then tiles no node uses
        if (nodes.size > 520) {
          const old = [...nodes.values()].filter(n => n.want < tick - 2).sort((a, b) => a.want - b.want);
          for (let i = 0; i < old.length && nodes.size > 420; i++) { disposeNode(old[i]); nodes.delete(old[i].key); }
        }
        const usedE = new Set(), usedI = new Set();
        for (const n of nodes.values()) { if (n.elevKey) usedE.add(n.elevKey); if (n.imgKey) usedI.add(n.imgKey); }
        elev.evict(usedE); img.evict(usedI);
        // drop queued requests nobody wants any more
        for (const st of [elev, img]) for (const [k, e] of st.map) if (e.state === 'queued' && e.want < tick - 1) st.map.delete(k);
      }
      elev.pump(tick); img.pump(tick);
      updatePapi(cam);
      for (const Z of zones) if (!Z.final) settleZone(Z);
      // (re)build: nearest first, a few per frame
      let budget = 4;
      const todo = [];
      for (const n of nodes.values()) {
        if (n.want !== tick) continue;
        const es = best(elev, n.z, n.x, n.y, EMAX, ROOT_Z - 2);
        if (!es) continue;
        const is = best(img, n.z, n.x, n.y, IMAX, ROOT_Z - 2);
        const needBuild = !n.built || n.dirty || n.elevKey !== es.e.key || n.S !== S;
        const needImg = !needBuild && (is ? is.e.key : null) !== n.imgKey;
        if (needBuild || needImg) todo.push({ n, es, is, needBuild });
      }
      todo.sort((a, b) => (a.n.built ? 1 : 0) - (b.n.built ? 1 : 0) || a.n.d - b.n.d);
      for (const t of todo) {
        if (budget <= 0) break;
        if (t.needBuild) { buildNode(t.n, t.es, t.is); budget--; if (t.n.mesh) t.n.mesh.visible = true; }
        else { setImage(t.n, t.is); budget -= 0.25; }
      }
    };

    // ------------------------------------------------------------------ physics queries
    /** Ground height exactly on the rendered triangles of the finest built tile. */
    RW.heightAt = function (x, z) {
      if (!RW.F) return 0;
      for (let k = IMAX; k >= ROOT_Z; k--) {
        const t = RW.F.localToTile(x, z, k), tx = Math.floor(t.x), ty = Math.floor(t.y);
        const n = nodes.get(k + '/' + tx + '/' + ty);
        if (!n || !n.grid) continue;
        const N1 = n.N1, Sx = N1 - 1;
        let fx = (t.x - tx) * Sx, fz = (t.y - ty) * Sx;
        const i = Math.min(Sx - 1, Math.floor(fx)), j = Math.min(Sx - 1, Math.floor(fz));
        fx -= i; fz -= j;
        const g = n.grid, h00 = g[j * N1 + i], h10 = g[j * N1 + i + 1], h01 = g[(j + 1) * N1 + i], h11 = g[(j + 1) * N1 + i + 1];
        if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
        return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
      }
      const r = rawElev(x, z);
      return r === null ? (RW.fallbackElev || 0) : Math.max(-0.5, zones.length ? flatten(x, z, r) : r);
    };
    /** Runway under a point (any airport), or null. */
    RW.runwayAt = function (x, z, margin) {
      for (const Z of zones) { if (x < Z.bx0 || x > Z.bx1 || z < Z.bz0 || z > Z.bz1) continue; if (Geo.onRunway(Z.rw, x, z, margin || 0)) return Z.rw; }
      return null;
    };
    RW.surfaceAt = (x, z) => { const r = RW.runwayAt(x, z, 2); return r && r.paved ? 'paved' : 'grass'; };
    RW.onRunway = (x, z, apId) => { const r = RW.runwayAt(x, z, 0); return !!r && (!apId || r.airport === apId); };
    RW.airportById = id => (RW.airports || []).find(a => a.id === id);
    /** This streamer's own copy of a runway (it carries the flatten zone), by airport id and name. */
    RW.findRunway = (apId, name) => { const ap = RW.airportById(apId); return ap ? ap.runways.find(r => r.name === name) || null : null; };
    /** The elevation of a runway's threshold (DEM-settled once loaded), for any copy of the runway. */
    RW.runwayElev = rw => {
      const own = rw.zone ? rw : RW.findRunway(rw.airport, rw.name);
      if (!own || !own.zone) { const ap = RW.airportById(rw.airport); return ap ? ap.elev : RW.fallbackElev || 0; }
      const Z = own.zone; return Z.rw === own ? Z.ea : Z.eb;
    };
    return RW;
  }

  window.RealWorld = { create };
})();
