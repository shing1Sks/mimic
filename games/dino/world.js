// Ironfern world (Stage A): DH.World.build(ctx, missionId) -> world. One small map per mission,
// built from the plain layout in world-lib.js (DH.WorldLib.describe), dressed by world-sets.js with
// the kit in world-kit.js. world = { stands, rails, spawns, points, heightAt, raycast, update, dispose }.
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const AMB = {
    jungle_day: { f: 'jungle_day', vol: 0.55, bus: 'ambience' }, cicadas: { f: 'cicadas', vol: 0.32, bus: 'ambience' },
    crickets: { f: 'crickets', vol: 0.5, bus: 'ambience' }, rain: { f: 'rain', vol: 0.4, bus: 'ambience' },
    music_menace: { f: 'music_menace', vol: 0.35, bus: 'music' }, music_battle: { f: 'music_battle', vol: 0.22, bus: 'music' },
  };
  // models, textures and HDRIs are registered by world-kit.js at load; ambience loads per mission

  const envCache = {}; // hdr key + level -> PMREM texture (kept between missions)
  /** Image-based light from an HDRI, scaled: the forest HDRI's bright sky gaps would otherwise flood
   * the ambient term and wash out the sun's shadows. */
  function envMap(renderer, key, level) {
    const ck = key + level;
    if (envCache[ck]) return envCache[ck];
    const hdr = DH.Assets.get(key);
    if (!hdr) return null;
    const pm = new THREE.PMREMGenerator(renderer), sc = new THREE.Scene();
    const geo = new THREE.SphereGeometry(100, 64, 32), mat = new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, fog: false, color: new THREE.Color(level, level, level) });
    sc.add(new THREE.Mesh(geo, mat));
    const t = pm.fromScene(sc, 0, 0.1, 1000).texture;
    pm.dispose(); geo.dispose(); mat.dispose();
    return (envCache[ck] = t);
  }
  const V = p => new THREE.Vector3(p.x, p.y, p.z);

  // ------------------------------------------------------------------ vegetation
  function vegetate(B, set) {
    const W = DH.WorldLib, d = B.d, q = B.q, R = B.R;
    const half = d.size / 2 - 6, bounds = [d.center.x - half, d.center.z - half, d.center.x + half, d.center.z + half];
    const clearT = (d.clear || []).concat((d.roads || []).map(r => ({ poly: r.pts, r: r.width / 2 + 1.2 })), set.clear || []);
    if (d.river) clearT.push({ poly: d.river.pts, r: d.river.width / 2 + 1 });
    // understory may grow right up to road edges; trees keep the wider clearings
    const clear = clearT.filter(z => !z.trees).concat((d.roads || []).map(r => ({ poly: r.pts, r: r.width / 2 + 0.3 })));
    const focus = d.focus, fd = (x, z) => focus.length > 1 ? W.distToPolyline(x, z, focus).d : Math.hypot(x - focus[0].x, z - focus[0].z);
    const near = (x, z, r0, r1, far) => { const k = fd(x, z); return k < r0 ? 1 : k > r1 ? far : W.lerp(1, far, (k - r0) / (r1 - r0)); };
    const forest = set.forest || (() => 1), grassy = set.grassy || (() => 0.2);
    const seed = d.seed * 97;
    const sc = (lo, hi) => [lo, hi];
    const S = (o) => W.scatter(Object.assign({ bounds, exclude: clear, tries: (o.count || 100) * 14 }, o));
    const nScale = n => Math.round(n * q);

    // ---- where the player can look from: stands (with their view cones) and the rails
    const stands = Object.values(d.stands), railPts = [];
    for (const k in d.rails) W.resample(d.rails[k], 8).forEach(p => railPts.push(p));
    const visD = Math.min(d.size, 2.1 / Math.max(0.002, d.env.fog));   // beyond this the fog hides everything
    const lodK = 0.55 + 0.45 * q;                                       // quality shrinks the full-detail band
    function view(x, z) {
      let dist = Infinity, cone = railPts.length > 0;
      for (const s of stands) {
        const dd = Math.hypot(x - s.pos.x, z - s.pos.z);
        if (dd < dist) dist = dd;
        if (!cone) { const a = W.yawTo(s.pos, { x, z }) - s.yaw, da = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); if (dd < 22 || da < s.arc + 1.2) cone = true; }
      }
      for (const r of railPts) { const dd = Math.hypot(x - r.x, z - r.z); if (dd < dist) dist = dd; }
      return { dist, cone };
    }
    const stat = { near: 0, card: 0, cut: 0 };
    /** Full meshes inside nearR of a viewpoint, impostor cards out to the fog, nothing behind a
     * single stand or past the fog. Only o.castR-near instances cast shadows. */
    function place(key, list, o) {
      o = o || {};
      // low quality: vegetation stops casting shadows (props and dinos still do)
      // big things (trees, palms, grass bands) drop to impostor cards much sooner below full quality:
      // the Pens road alone put 880k triangles of full trees on screen
      const big = (o.nearR || 30) >= 45 && o.nearR < 400;
      const nearR = (o.nearR || 30) * lodK * (big && q < 1 ? 0.6 : 1), castR = q < 0.75 ? 0 : Math.min(nearR, (o.castR || 0) * lodK);
      const nearC = [], nearN = [], far = [];
      for (const it of list) {
        const v = view(it.x, it.z);
        if (v.dist > visD || !v.cone) { stat.cut++; continue; }
        if (v.dist <= nearR) (v.dist <= castR ? nearC : nearN).push(it);
        else if (o.cards !== false && v.dist <= (o.farR || visD)) far.push(it);
        else stat.cut++;
      }
      stat.near += nearC.length + nearN.length; stat.card += far.length;
      const base = { sink: o.sink, trunkH: o.trunkH, surface: o.surface, trunks: o.trunks, chunk: o.chunk };
      if (nearC.length) B.instances(key, nearC, Object.assign({ shadow: true }, base));
      if (nearN.length) B.instances(key, nearN, Object.assign({ shadow: false }, base));
      if (far.length) {
        B.cards(key, far, { sink: o.sink });
        const t = DH.WorldKit.template(key);
        if (o.trunkH && t && t.cfg.trunk) far.forEach(it => { const y = B.h(it.x, it.z); B.trunks.push({ x: it.x, z: it.z, r: Math.max(0.12, t.cfg.trunk * it.s), y0: y - 1, y1: y + it.s * o.trunkH }); });
      }
    }
    B.vegStat = stat;

    // canopy: broadleaf giants + palms, a band of dense jungle near the play area thinning with distance
    const canopy = S({ seed: seed + 1, exclude: clearT, count: nScale(set.canopy || 420), minDist: 5.5, scale: sc(0, 1),
      density: (x, z) => forest(x, z) * near(x, z, 40, 200, 0.3) });
    const broad = [], palms = { palm_coconut: [], palm_triangle: [], palm_tree: [], palm_curved: [] }, dead = [];
    canopy.forEach(p => {
      const r = R(), wet = set.palmy ? set.palmy(p.x, p.z) : 0.5;
      if (r < 0.03 && fd(p.x, p.z) > 35) dead.push({ x: p.x, z: p.z, rot: p.rot, s: 10 + p.s * 6 });
      else if (r < 0.05 + 0.5 * (1 - wet) + 0.15) broad.push({ x: p.x, z: p.z, rot: p.rot, s: 15 + p.s * 9, tilt: [(R() - 0.5) * 0.08, (R() - 0.5) * 0.08] });
      else {
        const k = R(), lean = [(R() - 0.5) * 0.25, (R() - 0.5) * 0.25];
        if (k < 0.32) palms.palm_coconut.push({ x: p.x, z: p.z, rot: p.rot, s: 10 + p.s * 7, tilt: lean });
        else if (k < 0.55) palms.palm_triangle.push({ x: p.x, z: p.z, rot: p.rot, s: 7 + p.s * 6, tilt: lean });
        else if (k < 0.8) palms.palm_tree.push({ x: p.x, z: p.z, rot: p.rot, s: 6 + p.s * 5, tilt: lean });
        else palms.palm_curved.push({ x: p.x, z: p.z, rot: p.rot, s: 6 + p.s * 4 });
      }
    });
    // lone trees in open ground
    if (set.lone) S({ seed: seed + 2, count: set.lone, minDist: 25, scale: sc(0, 1), density: (x, z) => 1 - forest(x, z) })
      .forEach(p => (R() < 0.4 ? dead : broad).push({ x: p.x, z: p.z, rot: p.rot, s: 12 + p.s * 8 }));
    place('tree_broadleaf', broad, { sink: 0.01, trunkH: 0.45, nearR: 75, castR: 45, chunk: 240 });
    for (const k in palms) place(k, palms[k], { sink: 0.005, trunkH: 0.7, nearR: 70, castR: 40, chunk: 240 });
    place('tree_dead', dead, { sink: 0.02, trunkH: 0.6, nearR: 75, castR: 45, chunk: 240 });

    // vines from the larger broadleaf crowns near the play area
    const vines = [];
    broad.forEach(t => { if (view(t.x, t.z).dist < 40 * lodK && view(t.x, t.z).cone && R() < 0.5 && vines.length < 36 * q) for (let i = 0; i < 3; i++) { const a = R() * 6.28, r = 1.5 + R() * 3; vines.push({ x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r, y: B.h(t.x, t.z) + t.s * (0.45 + R() * 0.15), rot: R() * 6.28, s: 3 + R() * 4 }); } });
    place('vines_hanging', vines, { nearR: 45, cards: false, chunk: 600 });

    // understory: ferns, big-leaf plants, bushes — densest along the stands and the road
    const under = (o) => forest(o.x, o.z);
    const ferns = S({ seed: seed + 3, count: nScale(set.ferns || 1300), minDist: 1.5, scale: sc(0.9, 1.9),
      density: (x, z) => Math.max(under({ x, z }) * near(x, z, 25, 120, 0.12), set.brush ? set.brush(x, z) : 0) });
    place('fern', ferns.map(p => ({ x: p.x, z: p.z, rot: p.rot, s: p.s, sx: 1.25 })), { sink: 0.05, nearR: 26, farR: 140, chunk: 400 });
    const big = S({ seed: seed + 4, count: nScale(set.bigleaf || 500), minDist: 2.2, scale: sc(1.3, 2.4),
      density: (x, z) => Math.max(under({ x, z }) * near(x, z, 20, 100, 0.08), set.brush ? set.brush(x, z) * 0.7 : 0) });
    const bigList = big.map(p => ({ x: p.x, z: p.z, rot: p.rot, s: p.s }));
    const bushes = S({ seed: seed + 5, count: nScale(set.bushes || 600), minDist: 2, scale: sc(1.0, 2.2),
      density: (x, z) => Math.max(Math.max(under({ x, z }), set.scrub ? set.scrub(x, z) : 0) * near(x, z, 30, 160, 0.15), set.brush ? set.brush(x, z) * 0.6 : 0) });
    const bushList = bushes.map(p => ({ x: p.x, z: p.z, rot: p.rot, s: p.s, sx: 1.25 }));
    // mid-storey: giant elephant-ear plants and big shrubs fill the gaps between trunks
    const mid = S({ seed: seed + 9, count: nScale(set.mid || 500), minDist: 3.2, scale: sc(0, 1),
      density: (x, z) => forest(x, z) * near(x, z, 30, 140, 0.15) });
    mid.forEach((p, i) => (i % 2 ? bigList : bushList).push(i % 2 ? { x: p.x, z: p.z, rot: p.rot, s: 2.6 + p.s * 1.8 } : { x: p.x, z: p.z, rot: p.rot, s: 2.4 + p.s * 1.6, sx: 1.2 }));
    place('plant_big_leaf', bigList, { sink: 0.03, nearR: 30, farR: 170, chunk: 400 });
    place('bush', bushList, { sink: 0.13, nearR: 32, farR: 190, chunk: 400 });
    // tall grass in the open
    const grass = S({ seed: seed + 6, count: nScale(set.grass || 1200), minDist: 1.0, scale: sc(0.9, 1.7),
      density: (x, z) => Math.max(grassy(x, z), forest(x, z) * 0.25) * near(x, z, 60, 220, 0.25) * (0.25 + 0.75 * W.smooth(-0.1, 0.25, W.fbm(x / 14, z / 14, seed + 3, 2))) });
    place('grass_tall', grass.map(p => ({ x: p.x, z: p.z, rot: p.rot, s: p.s, sx: 2.4 })), { sink: 0.05, nearR: 70, cards: false, chunk: 400 });
    // rocks and logs
    const rocks = S({ seed: seed + 7, count: nScale(set.rocks || 140), minDist: 3, scale: sc(0, 1), density: (x, z) => 0.3 + 0.7 * forest(x, z) });
    // rocks are cheap and solid (raycast): keep them out to the fog, no cards; only near ones cast
    place('rock_moss', rocks.filter((p, i) => i % 3).map(p => ({ x: p.x, z: p.z, rot: p.rot, s: 0.5 + p.s * 1.6, sx: 1.4, tilt: [(R() - 0.5) * 0.4, (R() - 0.5) * 0.4] })), { surface: 'stone', sink: 0.25, nearR: 400, cards: false, chunk: 600 });
    place('rock_large', rocks.filter((p, i) => !(i % 3)).map(p => ({ x: p.x, z: p.z, rot: p.rot, s: 0.8 + p.s * 2.2 })), { surface: 'stone', sink: 0.25, nearR: 400, cards: false, chunk: 600 });
    if (set.rockPile) place('rock_large', set.rockPile, { surface: 'stone', sink: 0.2, nearR: 400, castR: 400, cards: false });
    const logs = S({ seed: seed + 8, count: nScale(set.logs || 40), minDist: 8, scale: sc(0.9, 1.6), density: (x, z) => forest(x, z) * near(x, z, 30, 120, 0.2) });
    place('log_moss', logs.map(p => ({ x: p.x, z: p.z, rot: p.rot, s: p.s, sx: 1, tilt: [0, (R() - 0.5) * 0.2] })), { surface: 'wood', sink: 0.15, nearR: 90, cards: false, chunk: 600 });
  }

  // ------------------------------------------------------------------ rain
  function rain(B) {
    const T = THREE, N = Math.round(5000 * B.q), pos = new Float32Array(N * 6), sp = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 50, y = Math.random() * 30, z = (Math.random() - 0.5) * 50; pos.set([x, y, z, x + 0.03, y + 0.55, z + 0.02], i * 6); sp[i] = 16 + Math.random() * 6; }
    const g = B.own(new T.BufferGeometry()); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const m = B.own(new T.LineBasicMaterial({ color: 0x9aa4a8, transparent: true, opacity: 0.32, depthWrite: false }));
    const ls = new T.LineSegments(g, m); ls.frustumCulled = false; ls.name = 'rain'; B.add(ls);
    B.anim.push(dt => {
      const c = B.ctx.camera.position; ls.position.set(Math.round(c.x / 2) * 2, c.y - 12, Math.round(c.z / 2) * 2);
      for (let i = 0; i < N; i++) { const o = i * 6; let y = pos[o + 1] - sp[i] * dt; if (y < 0) y += 30; pos[o + 1] = y; pos[o + 4] = y + 0.55; }
      g.attributes.position.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------------ build
  async function build(ctx, missionId) {
    const W = DH.WorldLib, K = DH.WorldKit, T = THREE, scene = ctx.scene;
    const d = W.describe(missionId);
    const env = d.env;
    // ambience (lazy: decoded audio is big, so only this mission's loops)
    if (DH.Assets && env.amb) {
      env.amb.forEach(k => DH.Assets.register('world_amb_' + k, 'assets/amb/' + AMB[k].f + '.ogg'));
      // never let a slow or stuck sound fetch hold the mission up
      try { await Promise.race([DH.Assets.load(), new Promise(r => setTimeout(r, 8000))]); } catch (e) { console.warn('[world] ambience', e); }
    }
    const B = K.builder(ctx, d);
    const saved = { fog: scene.fog, env: scene.environment, bg: scene.background, exposure: ctx.renderer.toneMappingExposure };

    // ---- light, sky, fog
    const dusk = env.sky === 'dusk', overcast = env.sky === 'overcast';
    const el = env.sunElev, az = env.sunAz, sunDir = new T.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const horizon = new T.Color(dusk ? 0x8a6a5c : overcast ? 0x8f9892 : 0xa2aea4);
    scene.fog = new T.FogExp2(horizon.getHex(), env.fog);
    scene.background = horizon.clone();
    scene.environment = envMap(ctx.renderer, dusk ? 'world_hdr_dusk' : 'sky_hdr', env.envLevel || (dusk ? 0.45 : overcast ? 0.55 : 0.4));
    ctx.renderer.toneMappingExposure = (env.exposure || 1) * 0.85;
    K.sky(B, { zenith: dusk ? 0x1c2a4a : overcast ? 0x667480 : 0x3f6fa6, horizon: scene.fog.color, sunDir, sunColor: dusk ? 0xff8a3c : 0xfff1d6,
      cloud: overcast ? 1.0 : dusk ? 0.55 : 0.6, cloudColor: dusk ? 0x6a5058 : overcast ? 0x8e9696 : 0xe4e6e2, glow: dusk ? 2.2 : 1 });
    const sun = B.light(new T.DirectionalLight(dusk ? 0xffa060 : 0xfff0dc, dusk ? 2.2 : overcast ? 1.6 : 3.4));
    const sh = d.shadow;
    sun.castShadow = true;
    const smap = B.q >= 0.9 ? 2048 : 1024;
    sun.shadow.mapSize.set(smap, smap);
    Object.assign(sun.shadow.camera, { left: -sh.r, right: sh.r, top: sh.r, bottom: -sh.r, near: 1, far: 900 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
    const sunAt = (x, z) => { const y = d.heightAt(x, z); sun.target.position.set(x, y, z); sun.position.set(x + sunDir.x * 300, y + sunDir.y * 300, z + sunDir.z * 300); sun.target.updateMatrixWorld(); };
    sunAt(sh.x, sh.z);
    B.add(sun.target);
    const hemi = B.light(new T.HemisphereLight(dusk ? 0x7a6a78 : 0xc4d4e0, dusk ? 0x2a2018 : 0x4a4030, dusk ? 0.45 : overcast ? 0.7 : 0.45));
    void hemi;

    // ---- terrain, water, dressing, vegetation
    const set = (DH.WorldSets && DH.WorldSets[missionId]) ? DH.WorldSets[missionId](B) : {};
    const ter = K.terrain(B, Object.assign({ cell: d.size > 500 ? 2.5 : 2, grassy: 0, forestFn: set.forest }, set.terrain || {}));
    // from here on, place things with the mesh's own heights (O(1), and exactly on the surface)
    B.h = (x, z) => { const g = W.gridHeight(ter.grid, x, z), dk = d.deckY ? d.deckY(x, z) : null; return dk != null && dk > g ? dk : g; };
    if (d.river) K.water(B, d.river.pts, d.river.width + 16, d.river.level);
    if (set.build) set.build();
    vegetate(B, set);
    B.flushFences();
    B.mergeStatic();
    if (env.rain) rain(B);
    scene.add(B.root);

    // ---- ambience
    const sounds = [];
    if (DH.Audio && DH.Audio.loop && env.amb) env.amb.forEach(k => {
      const a = AMB[k]; if (!DH.Assets.has('world_amb_' + k)) return;
      try { sounds.push(DH.Audio.loop('world_amb_' + k, { volume: a.vol, bus: a.bus, fadeIn: 2.5 })); } catch (e) { /* no audio */ }
    });

    // ---- raycast: terrain + solid props + trunks
    const rc = new T.Raycaster();
    const hgt = (x, z) => { const g = W.gridHeight(ter.grid, x, z), dk = d.deckY ? d.deckY(x, z) : null; return dk != null && dk > g ? dk : g; };
    const surfaceAt = (x, z) => {
      const g = ter.grid, i = Math.round((x - g.x0) / g.cell), j = Math.round((z - g.z0) / g.cell);
      if (i < 0 || j < 0 || i >= g.n || j >= g.n) return 'dirt';
      const k = (j * g.n + i) * 4, s = ter.splat, lv = 1 - s[k] - s[k + 1] - s[k + 2] - s[k + 3];
      if (s[k + 3] > 0.5) return 'stone';
      return (s[k + 1] + s[k + 2] > Math.max(s[k], lv)) ? 'dirt' : 'foliage';
    };
    function raycast(origin, dir, maxDist) {
      maxDist = maxDist || 400;
      const o = { x: origin.x, y: origin.y, z: origin.z }, dd = dir.clone().normalize();
      let best = null;
      const th = W.rayHeightfield(hgt, o, dd, maxDist, 0.8);
      if (th) best = { point: V(th.point), normal: V(th.normal), dist: th.dist, surface: surfaceAt(th.point.x, th.point.z) };
      if (d.river && dd.y < -1e-4) { // the river surface
        const tw = (d.river.level - o.y) / dd.y, wx = o.x + dd.x * tw, wz = o.z + dd.z * tw;
        if (tw > 0 && tw < (best ? best.dist : maxDist) && W.gridHeight(ter.grid, wx, wz) < d.river.level && !(d.deckY && d.deckY(wx, wz) != null))
          best = { point: new T.Vector3(wx, d.river.level, wz), normal: new T.Vector3(0, 1, 0), dist: tw, surface: 'water' };
      }
      const lim = best ? best.dist : maxDist;
      rc.set(origin, dd); rc.far = lim; rc.near = 0;
      const hits = rc.intersectObjects(B.colliders, true);
      if (hits.length) {
        const h = hits[0];
        let s = null, o2 = h.object; while (o2 && !s) { s = o2.userData.surface; o2 = o2.parent; }
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dd.clone().negate();
        if (h.instanceId != null && h.face) { const im = new T.Matrix4(); h.object.getMatrixAt(h.instanceId, im); n.copy(h.face.normal).transformDirection(im).transformDirection(h.object.matrixWorld); }
        if (n.dot(dd) > 0) n.negate();
        best = { point: h.point.clone(), normal: n, dist: h.distance, surface: s || 'metal' };
      }
      for (const c of B.trunks) {
        const r = W.rayCylinder(o, dd, c, best ? best.dist : maxDist);
        if (r && (!best || r.dist < best.dist)) best = { point: V(r.point), normal: V(r.normal), dist: r.dist, surface: 'wood' };
      }
      return best;
    }

    // ---- per-frame
    let t = 0; const lastSun = { x: 1e9, z: 1e9 };
    function update(dt, c) {
      t += dt; K.shared.time.value = t;
      K.shared.wind.value = 1 + 0.35 * Math.sin(t * 0.21) + 0.2 * Math.sin(t * 0.53);
      // the shadow map is drawn on demand (core.js): while the camera rides, redraw it a few times a second
      if (set.followShadow) { const cc = c || ctx, p = cc.view.pos; if (Math.hypot(p.x - lastSun.x, p.z - lastSun.z) > 3) { sunAt(p.x, p.z); lastSun.x = p.x; lastSun.z = p.z; cc.shadowDirty = true; } }
      for (const f of B.anim) f(dt, t, c || ctx);
    }

    let disposed = false;
    function dispose() {
      if (disposed) return; disposed = true;
      sounds.forEach(s => { try { s.stop(1.2); } catch (e) { /* ok */ } });
      scene.remove(B.root);
      B.owned.forEach(x => { try { x.dispose(); } catch (e) { /* ok */ } });
      B.root.traverse(o => { if (o.isInstancedMesh) o.dispose && o.dispose(); });
      if (set.dispose) set.dispose();
      scene.fog = saved.fog; scene.environment = saved.env; scene.background = saved.bg;
      ctx.renderer.toneMappingExposure = saved.exposure;
    }

    const toV = o => { const r = {}; for (const k in o) r[k] = V(o[k]); return r; };
    const stands = {};
    for (const k in d.stands) { const s = d.stands[k]; stands[k] = { pos: V(s.pos), yaw: s.yaw, pitch: s.pitch, arc: s.arc, pitchMin: s.pitchMin, pitchMax: s.pitchMax }; }
    const rails = {}; for (const k in d.rails) rails[k] = d.rails[k].map(V);
    const spawns = {};
    for (const k in d.spawns) { const s = d.spawns[k]; spawns[k] = { points: s.points.map(V) }; if (s.path) spawns[k].path = s.path.map(V); }
    const world = {
      id: missionId, stands, rails, spawns, points: toV(d.points),
      heightAt: (x, z) => hgt(x, z),
      raycast, update, dispose, root: B.root, desc: d,
    };
    ctx.shadowDirty = true;
    return world;
  }

  DH.World = { build, AMB };
})();
