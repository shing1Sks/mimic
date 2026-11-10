/*
 * GYROWING map layer: OpenStreetMap around the aircraft in the real-world mode. Vector tiles from
 * OpenFreeMap (OpenMapTiles schema; no key, free public instance; data (c) OpenStreetMap
 * contributors, ODbL) become:
 *
 *   - a ground overlay per terrain tile (zoom 13-14): roads, rivers, lakes and the coastline, land
 *     use, parks, airfield runways, taxiways and aprons, building footprints, lit up at night
 *   - real buildings extruded from footprints and heights, one merged mesh per zoom-14 tile, full
 *     detail near the aircraft and a lighter LOD (no sheds, flat roofs) further out
 *   - trees scattered in OSM woods and parks
 *
 * Being a good citizen: only tiles around the aircraft, nearest first, at most 2 requests at a time;
 * every tile goes into Cache Storage, so a second visit downloads nothing; failures back off, and
 * repeated failures pause the layer (the satellite terrain carries on without it). Decoding and
 * mesh building run in osm-worker.js so the frame rate does not stutter.
 */
(function () {
  'use strict';
  const TILEJSON = 'https://tiles.openfreemap.org/planet';
  const FALLBACK = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
  const CACHE = 'gyrowing-osm-v1';
  const CONCURRENCY = 2, GRID = 17;
  // per Graphics quality: 3D detail radii (m), trees per tile, overlay sizes (px) by zoom
  const QUAL = [
    { full: 1300, lod: 2600, tree: 1500, trees: 500, ov14: 512, ov13: 256, ovFar: 6000 },
    { full: 1900, lod: 3800, tree: 2200, trees: 900, ov14: 1024, ov13: 512, ovFar: 9000 },
    { full: 2200, lod: 5000, tree: 2800, trees: 1400, ov14: 1024, ov13: 512, ovFar: 12000 },
    { full: 2800, lod: 6500, tree: 3400, trees: 2000, ov14: 1024, ov13: 1024, ovFar: 16000 },
  ];

  function create(RW, renderer, world) {
    const L = { level: 2, q: 1, stats: { tiles: 0, net: 0, cached: 0, failed: 0, bytes: 0, buildings: 0, meshes: 0, paused: false }, ok: true };
    const group = new THREE.Group(); RW.group.add(group);
    const tiles = new Map();
    let worker = null, jobId = 0, inflight = 0, workBusy = 0, upd = 0, failRun = 0, pauseUntil = 0, template = null, locRef = null;
    const jobs = new Map();
    try { worker = new Worker('osm-worker.js'); worker.onmessage = onResult; worker.onerror = () => { L.ok = false; }; } catch (e) { L.ok = false; }
    const cacheP = (typeof caches !== 'undefined') ? caches.open(CACHE).catch(() => null) : Promise.resolve(null);
    const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    // ---- tile URL template: the live TileJSON (it names the current planet build), else a known build
    const templateP = (async () => {
      const cache = await cacheP;
      try {
        const r = await fetch(TILEJSON, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { const j = await r.json(); if (j.tiles && j.tiles[0]) { if (cache) cache.put(TILEJSON, new Response(JSON.stringify(j))).catch(() => {}); return j.tiles[0]; } }
      } catch (e) { /* offline: try the cached copy */ }
      try { if (cache) { const hit = await cache.match(TILEJSON); if (hit) { const j = await hit.json(); if (j.tiles) return j.tiles[0]; } } } catch (e) { /* no cache */ }
      return FALLBACK;
    })().then(t => { template = t; return t; });

    async function fetchTile(t) {
      const url = template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
      const cache = await cacheP;
      if (cache) { try { const hit = await cache.match(url); if (hit) { L.stats.cached++; return await hit.arrayBuffer(); } } catch (e) { /* ignore */ } }
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (r.status === 204 || r.status === 404) return new ArrayBuffer(0);   // empty sea or no data
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.arrayBuffer();
      L.stats.net++; L.stats.bytes += b.byteLength;
      if (cache) cache.put(url, new Response(b.slice(0), { headers: { 'Content-Type': 'application/x-protobuf' } })).catch(() => {});
      return b;
    }

    // ---- materials: facades with windows (lit ones glow at night), trees
    // two looks for each facade: Lambert on the lower tiers, physically based on High and Ultra
    // (windows and curtain walls reflect the sky through the scene's environment map)
    const facade = facadeTextures(), glassTex = glassTextures();
    const mats = {
      lambert: { masonry: new THREE.MeshLambertMaterial({ vertexColors: true, map: facade.day, emissiveMap: facade.lit, emissive: 0x000000 }),
        glass: new THREE.MeshLambertMaterial({ vertexColors: true, map: glassTex.day, emissiveMap: glassTex.lit, emissive: 0x000000 }) },
      pbr: { masonry: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xcfcfcf, map: facade.day, roughnessMap: facade.rough, roughness: 1, metalness: 0, emissiveMap: facade.lit, emissive: 0x000000, envMapIntensity: 0.9 }),
        glass: new THREE.MeshStandardMaterial({ vertexColors: true, map: glassTex.day, roughnessMap: glassTex.rough, roughness: 1, metalness: 0.55, emissiveMap: glassTex.lit, emissive: 0x000000, envMapIntensity: 1.25 }) },
    };
    let cur = mats.lambert;
    const treeGeos = [treeGeometry(false), treeGeometry(true)], treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });

    function get(z, x, y) {
      const key = z + '/' + x + '/' + y;
      let t = tiles.get(key);
      if (!t) { t = { z, x, y, key, rect: RW.F.tileRect(z, x, y), state: 'new', want: 0, prio: 0, ov: 0, ovTex: null, ovSize: 0, mesh: null, mode: null, trees: null, treesWant: 0, fade: 0, tries: 0, retryAt: 0, sent: false, job: false }; tiles.set(key, t); }
      return t;
    }

    function clearAll() {
      for (const t of tiles.values()) dispose(t);
      tiles.clear(); jobs.clear();
    }
    function dispose(t) {
      if (t.ovTex) { t.ovTex.dispose(); t.ovTex = null; }
      if (t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; }
      if (t.glass) { group.remove(t.glass); t.glass.geometry.dispose(); t.glass = null; }
      if (t.trees) { group.remove(t.trees); t.trees.dispose(); t.trees = null; }
    }

    /** Per frame from realworld's update: plan, fetch, decode, place; apply overlays to terrain. */
    L.update = function (camera, dt) {
      if (!RW.active || !RW.F) return;
      if (locRef !== RW.loc) { clearAll(); locRef = RW.loc; }
      const night = world.night || 0;
      for (const set of [mats.lambert, mats.pbr]) { set.masonry.emissive.setRGB(1, 0.82, 0.56).multiplyScalar(night * 1.25); set.glass.emissive.setRGB(1, 0.86, 0.66).multiplyScalar(night * 1.1); }
      for (const t of tiles.values()) if (t.fade < 1 && (t.ovTex || t.mesh)) { t.fade = Math.min(1, t.fade + dt * 1.5); if (t.mesh) t.mesh.material.opacity = 1; }
      applyOverlays();
      if (!L.level || !L.ok || !template) return;
      upd -= dt; if (upd > 0) return; upd = 0.4;
      plan(camera.position);
      pump();
    };

    function plan(cam) {
      const Q = QUAL[L.q], light = L.level === 1, F = RW.F;
      const tick = (L.tickN = (L.tickN || 0) + 1);
      const gCam = RW.heightAt(cam.x, cam.z), agl = Math.max(0, cam.y - gCam);
      const dist = r => { const dx = Math.max(r.x0 - cam.x, 0, cam.x - r.x1), dz = Math.max(r.z0 - cam.z, 0, cam.z - r.z1); return Math.hypot(dx, dz, agl * 0.8); };
      const kLight = light ? 0.6 : 1;
      for (const t of tiles.values()) { t.wantMode = null; t.treesWant = 0; t.ov = 0; }
      const mark = (t, d) => { if (t.want !== tick) { t.want = tick; t.prio = d; } else t.prio = Math.min(t.prio, d); };
      // buildings and trees: the zoom-14 tiles within the LOD radius
      const R = Q.lod * kLight, a = F.localToTile(cam.x - R, cam.z - R, 14), b = F.localToTile(cam.x + R, cam.z + R, 14);
      for (let ty = Math.floor(a.y); ty <= Math.floor(b.y); ty++) for (let tx = Math.floor(a.x); tx <= Math.floor(b.x); tx++) {
        const rect = F.tileRect(14, tx, ty), d = dist(rect);
        if (d > R) continue;
        const t = get(14, tx, ty);
        mark(t, d);
        // three rings: full detail, no sheds and flat roofs, and only the big and tall far out
        t.wantMode = d < Q.full * kLight ? 'full' : d < Q.lod * kLight * 0.6 ? 'lod' : 'far';
        t.treesWant = d < Q.tree * kLight ? Math.round(Q.trees * kLight) : 0;
      }
      // overlays: the terrain tiles of zoom 13-14 in view
      RW.forEachNode(n => {
        if (n.want !== RW.tick() || n.z < 13 || n.z > 14) return;
        const d = dist(n.rect);
        if (n.z === 13 && d > Q.ovFar * kLight) return;
        const t = get(n.z, n.x, n.y);
        mark(t, d);
        t.ov = n.z === 14 ? (light ? Q.ov14 / 2 : Q.ov14) : Q.ov13;
        // the parent's overlay stands in while this one loads
        if (n.z === 14) { const p = get(13, n.x >> 1, n.y >> 1); mark(p, d + 500); p.ov = Q.ov13; }
      });
      // forget what has not been wanted for a while
      for (const [k, t] of tiles) {
        if (t.want === tick) continue;
        if (t.want < tick - 8 || (t.want < tick - 2 && t.state !== 'ok')) { dispose(t); tiles.delete(k); continue; }
        if (t.mesh && t.want < tick - 2) { group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; t.mode = null; }
        if (t.glass && t.want < tick - 2) { group.remove(t.glass); t.glass.geometry.dispose(); t.glass = null; }
        if (t.trees && t.want < tick - 2) { group.remove(t.trees); t.trees.dispose(); t.trees = null; }
      }
      // what the ready tiles still need from the worker
      for (const t of tiles.values()) {
        if (t.want !== tick) continue;
        t.needs = (t.ov && t.ovSize < t.ov) || (t.wantMode && t.mode !== t.wantMode) || (t.treesWant && !t.trees && !t.treesDone);
      }
      L.stats.tiles = tiles.size;
      let b2 = 0, m2 = 0; for (const t of tiles.values()) { if (t.mesh) { m2++; b2 += t.nb || 0; } }
      L.stats.buildings = b2; L.stats.meshes = m2;
      L.tick = tick;
    }

    function pump() {
      const now = performance.now();
      if (now < pauseUntil) { L.stats.paused = true; return; }
      L.stats.paused = false;
      const list = [...tiles.values()].filter(t => t.want === L.tick).sort((p, q) => p.prio - q.prio);
      // downloads, nearest first
      for (const t of list) {
        if (inflight >= CONCURRENCY) break;
        if (t.state === 'new' || (t.state === 'fail' && now > t.retryAt && t.tries < 3)) {
          t.state = 'loading'; inflight++;
          fetchTile(t).then(buf => { t.buf = buf; t.state = 'ok'; failRun = 0; })
            .catch(() => { t.state = 'fail'; t.tries++; t.retryAt = performance.now() + 20000 * t.tries; L.stats.failed++; if (++failRun >= 8) { pauseUntil = performance.now() + 120000; failRun = 0; } })
            .finally(() => { inflight--; });
        }
      }
      // worker jobs, one tile at a time per tile, two queued at most
      for (const t of list) {
        if (workBusy >= 2) break;
        if (t.state !== 'ok' || t.job || !t.needs) continue;
        if (!t.buf || !t.buf.byteLength) { t.needs = false; t.ovSize = t.ov; t.mode = t.wantMode; t.treesDone = true; continue; }
        const msg = { id: ++jobId, key: t.key, rect: t.rect };
        if (!t.sent) { msg.buf = t.buf.slice(0); }
        if (t.ov && t.ovSize < t.ov) msg.overlay = t.ov;
        const wantB = t.wantMode && t.mode !== t.wantMode, wantT = t.treesWant && !t.trees && !t.treesDone;
        if (wantB || wantT) {
          const grid = groundGrid(t.rect);
          if (!grid) { if (!msg.overlay) continue; } else { msg.grid = grid; msg.n = GRID; if (wantB) msg.build = t.wantMode; if (wantT) { msg.trees = t.treesWant; msg.seed = t.x * 7919 + t.y; } }
        }
        if (!msg.overlay && !msg.build && !msg.trees) continue;
        t.job = true; t.sent = true; workBusy++;
        jobs.set(msg.id, t);
        worker.postMessage(msg, msg.buf ? [msg.buf] : []);
      }
    }

    /** Ground heights over a tile (GRID x GRID), or null while the elevation is still loading. */
    function groundGrid(r) {
      const g = new Float32Array(GRID * GRID);
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
        const h = RW.groundAt(r.x0 + (r.x1 - r.x0) * i / (GRID - 1), r.z0 + (r.z1 - r.z0) * j / (GRID - 1));
        if (h === null) return null;
        g[j * GRID + i] = h;
      }
      return g;
    }

    function onResult(e) {
      const m = e.data, t = jobs.get(m.id);
      jobs.delete(m.id); workBusy = Math.max(0, workBusy - 1);
      if (!t) return;
      t.job = false;
      if (tiles.get(t.key) !== t) { if (m.overlay && m.overlay.close) m.overlay.close(); return; }
      if (m.miss) { t.sent = false; return; }
      if (m.error) { t.needs = false; t.ovSize = t.ov; t.mode = t.wantMode; t.treesDone = true; console.warn('[gyrowing] map tile', t.key, m.error); return; }
      if (m.overlay) {
        if (t.ovTex) t.ovTex.dispose();
        const tex = new THREE.Texture(m.overlay);
        tex.flipY = false; tex.encoding = THREE.sRGBEncoding; tex.anisotropy = maxAniso; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
        t.ovTex = tex; t.ovSize = m.overlay.width; t.fade = 0;
      }
      if (m.mesh) {
        for (const [slot, arr, kind] of [['mesh', m.mesh, 'masonry'], ['glass', m.glass, 'glass']]) {
          if (t[slot]) { group.remove(t[slot]); t[slot].geometry.dispose(); t[slot] = null; }
          if (!arr || !arr.pos.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(arr.pos, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(arr.nor, 3));
          g.setAttribute('color', new THREE.BufferAttribute(arr.col, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(arr.uv, 2));
          g.computeBoundingSphere();
          const mesh = new THREE.Mesh(g, cur[kind]); mesh.matrixAutoUpdate = false; mesh.userData.kind = kind;
          mesh.castShadow = mesh.receiveShadow = L.q >= 3;
          group.add(mesh); t[slot] = mesh;
        }
        t.mode = m.mode; t.nb = m.buildings;
      }
      if (m.trees) {
        t.treesDone = true;
        const n = m.trees.length / 4;
        if (n) {
          // the shared tree, with this tile's bounds, so the whole stand is culled when out of view
          const tg = new THREE.BufferGeometry(); const treeGeo = treeGeos[L.q >= 2 ? 1 : 0]; for (const k in treeGeo.attributes) tg.setAttribute(k, treeGeo.attributes[k]);
          const r = t.rect; tg.boundingSphere = new THREE.Sphere(new THREE.Vector3((r.x0 + r.x1) / 2, m.trees[1], (r.z0 + r.z1) / 2), Math.hypot(r.x1 - r.x0, r.z1 - r.z0) * 0.6 + 400);
          const im = new THREE.InstancedMesh(tg, treeMat, n), M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
          for (let i = 0; i < n; i++) {
            const s = 9 + m.trees[i * 4 + 3] * 9;
            Q4.setFromAxisAngle(Y, m.trees[i * 4 + 3] * 40); S.set(s * 0.9, s, s * 0.9); P.set(m.trees[i * 4], m.trees[i * 4 + 1] - 0.4, m.trees[i * 4 + 2]);
            M4.compose(P, Q4, S); im.setMatrixAt(i, M4);
            const k = 0.75 + (i * 0.6180339 % 1) * 0.4; C.setRGB(k, k * (0.95 + 0.1 * (i % 3) / 2), k * 0.9); im.setColorAt(i, C);
          }
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.matrixAutoUpdate = false;
          group.add(im); t.trees = im;
        }
      }
      t.needs = (t.ov && t.ovSize < t.ov) || (t.wantMode && t.mode !== t.wantMode) || (t.treesWant && !t.trees && !t.treesDone);
    }

    /** Point each terrain tile's shader at its own overlay, or its parent's while its own loads. */
    function applyOverlays() {
      RW.forEachNode(n => {
        const u = n.mesh.material.userData.osm; if (!u) return;
        let t = null;
        if (L.level && n.z >= 13 && n.z <= 14) {
          t = tiles.get(n.z + '/' + n.x + '/' + n.y);
          if ((!t || !t.ovTex) && n.z === 14) t = tiles.get('13/' + (n.x >> 1) + '/' + (n.y >> 1));
          if (t && !t.ovTex) t = null;
        }
        if (!t) { u.uOsmOn.value = 0; return; }
        u.tOsm.value = t.ovTex;
        u.uOsmRect.value.set(t.rect.x0, t.rect.z0, t.rect.x1 - t.rect.x0, t.rect.z1 - t.rect.z0);
        u.uOsmOn.value = t.fade;
      });
    }

    /** Graphics quality (0..2) and map detail (0 off, 1 light, 2 full). */
    L.setQuality = function (q, level) {
      L.q = Math.max(0, Math.min(QUAL.length - 1, q | 0));
      cur = L.q >= 2 ? mats.pbr : mats.lambert;
      for (const t of tiles.values()) for (const m of [t.mesh, t.glass]) if (m) { m.material = cur[m.userData.kind]; m.castShadow = m.receiveShadow = L.q >= 3; }
      if (level !== undefined && level !== L.level) { L.level = level; if (!level) clearAll(); }
      group.visible = !!L.level;
    };
    L.clear = clearAll;
    return L;
  }

  // ---------------------------------------------------------------- textures and models
  /** Facade: a 4 x 4 grid of windows (12 m a repeat), a solid strip at the top for roofs; the lit
   * version has a third of the windows warm (for night). Wall colour comes from vertex colours. */
  function facadeTextures() {
    const S = 256, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
    const day = mk(), lit = mk(), rough = mk(), d = day.getContext('2d'), l = lit.getContext('2d'), rr = rough.getContext('2d');
    rr.fillStyle = '#e6e6e6'; rr.fillRect(0, 0, S, S);
    d.fillStyle = '#ffffff'; d.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { d.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'; d.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
    l.fillStyle = '#000'; l.fillRect(0, 0, S, S);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * 64 + 14, y = r * 64 + 12 + (r === 0 ? 4 : 0), w = 36, h = 38;
      d.fillStyle = 'rgba(0,0,0,0.18)'; d.fillRect(x - 3, y - 3, w + 6, h + 6);
      const g = d.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#3b4a57'); g.addColorStop(0.55, '#5f7383'); g.addColorStop(1, '#2c3843');
      d.fillStyle = g; d.fillRect(x, y, w, h);
      rr.fillStyle = '#262626'; rr.fillRect(x, y, w, h);
      d.fillStyle = 'rgba(255,255,255,0.55)'; d.fillRect(x, y + h, w, 3);
      if (rnd() < 0.36) { l.fillStyle = rnd() < 0.7 ? '#ffcf8a' : '#fff1d6'; l.fillRect(x + 2, y + 2, w - 4, h - 4); }
    }
    d.fillStyle = '#ffffff'; d.fillRect(0, 0, S, 8); l.fillStyle = '#000'; l.fillRect(0, 0, S, 8);
    const T = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
    return { day: T(day), lit: T(lit), rough: T(rough, false) };
  }
  /** Curtain wall: 3 m x 3.5 m glass panels on thin mullions, a little variation panel to panel;
   * the lit version warms about a quarter of them; roughness: glass glossy, mullions matte. */
  function glassTextures() {
    const S = 256, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
    const day = mk(), lit = mk(), rough = mk(), d = day.getContext('2d'), l = lit.getContext('2d'), r = rough.getContext('2d');
    l.fillStyle = '#000'; l.fillRect(0, 0, S, S); r.fillStyle = '#9a9a9a'; r.fillRect(0, 0, S, S);
    d.fillStyle = '#c9d0d6'; d.fillRect(0, 0, S, S);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cw = S / 4, ch = S / (12 / 3.5);
    for (let y = 0; y < S; y += ch) for (let x = 0; x < S; x += cw) {
      const k = 0.85 + rnd() * 0.25;
      const g = d.createLinearGradient(x, y, x + cw, y + ch);
      g.addColorStop(0, `rgb(${70 * k | 0},${92 * k | 0},${110 * k | 0})`); g.addColorStop(1, `rgb(${46 * k | 0},${62 * k | 0},${78 * k | 0})`);
      d.fillStyle = g; d.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      r.fillStyle = '#1a1a1a'; r.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      if (rnd() < 0.27) { l.fillStyle = rnd() < 0.6 ? '#ffe2b0' : '#f2f6ff'; l.fillRect(x + 3, y + 3, cw - 6, ch - 6); }
    }
    d.fillStyle = '#d6d9dc'; d.fillRect(0, 0, S, 8); l.fillStyle = '#000'; l.fillRect(0, 0, S, 8); r.fillStyle = '#cccccc'; r.fillRect(0, 0, S, 8);
    const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
    return { day: T(day, true), lit: T(lit, true), rough: T(rough, false) };
  }
  /** A small broadleaf-and-conifer-ish tree: trunk and two blobs, vertex coloured (1 unit tall). */
  function treeGeometry(rich) {
    const parts = rich ? [
      [new THREE.CylinderGeometry(0.035, 0.06, 0.45, 6).translate(0, 0.22, 0), new THREE.Color('#4a3524')],
      [new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.85, 1).translate(0, 0.58, 0), new THREE.Color('#38582a')],
      [new THREE.IcosahedronGeometry(0.22, 0).translate(0.14, 0.72, 0.06), new THREE.Color('#43662d')],
      [new THREE.IcosahedronGeometry(0.2, 0).translate(-0.12, 0.76, -0.08), new THREE.Color('#3f5f2b')],
      [new THREE.IcosahedronGeometry(0.18, 0).translate(0.02, 0.9, 0.0), new THREE.Color('#4d7232')],
    ] : [
      [new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5).translate(0, 0.2, 0), new THREE.Color('#4a3524')],
      [new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.95, 1).translate(0, 0.62, 0), new THREE.Color('#3e5f2a')],
      [new THREE.IcosahedronGeometry(0.22, 0).translate(0.08, 0.86, 0.04), new THREE.Color('#4c6e30')],
    ];   // Performance and Balanced: the lighter tree
    const pos = [], nor = [], col = [];
    for (const [g0, c0] of parts) {
      const g = g0.toNonIndexed(); g.computeVertexNormals();
      const c = c0.clone().convertSRGBToLinear(), p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); const ao = 0.6 + 0.4 * Math.min(1, p[i + 1]); col.push(c.r * ao, c.g * ao, c.b * ao); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  window.OSMLayer = { create, QUAL };
})();
