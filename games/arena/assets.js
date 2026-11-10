/*
 * Duskwater - asset loading. Textures, the HDRI, glTF models (guns, arms, soldiers) and sound
 * files load in parallel behind the splash loading bar. Every item resolves to null when it
 * fails or times out, and every consumer keeps a procedural fallback, so the game always boots.
 *
 * The glTF / RGBE loaders come from ../lib/vendor/loaders.js (an ES module that runs after the
 * classic scripts and fires 'three-loaders').
 */
(function (global) {
  'use strict';
  const T = global.THREE;
  const BASE = 'assets/';

  const TEX_SETS = ['asphalt_02', 'brick_wall_001', 'concrete_floor_worn_001', 'container_side', 'corrugated_iron_02',
    'rusty_metal_02', 'weathered_planks', 'worn_plaster_wall'];
  const MODELS = { glock_rig: 'guns/glock_rig.glb', akm_rig: 'guns/akm_rig.glb', mpx: 'guns/mpx.glb', m21: 'guns/m21.glb',
    glock: 'guns/glock.glb', swat: 'chars/swat.glb' };
  const SOUNDS = ['tern_1', 'tern_2', 'skiff_1', 'skiff_2', 'skiff_3', 'breaker_1', 'breaker_2', 'longline_1', 'longline_2', 'bolt',
    'reload_tern', 'reload_skiff', 'reload_rifle', 'click', 'step_1', 'step_2', 'step_3', 'shell_1', 'shell_2', 'shell_3',
    'hit_metal', 'hit_concrete', 'hit_wood', 'water_loop'];

  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);

  const sleep = ms => new Promise(res => setTimeout(res, ms));
  /** Run fn() (a promise of a value or null) up to `tries` times: a busy local server can drop requests. */
  async function retry(fn, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const v = await limited(fn);
      if (v) return v;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
    return null;
  }

  // at most a few requests in flight: a small local static server refuses connections under a burst
  let active = 0; const queue = [];
  function limited(fn) {
    return new Promise(res => {
      const run = () => { active++; fn().catch(() => null).then(v => { active--; if (queue.length) queue.shift()(); res(v); }); };
      if (active < 4) run(); else queue.push(run);
    });
  }

  const loadersReady = () => !!(global.__threeLoadersReady && T.GLTFLoader);
  function waitForLoaders(ms) {
    if (loadersReady()) return Promise.resolve(true);
    return withTimeout(new Promise(res => global.addEventListener('three-loaders', () => res(true), { once: true })), ms).then(v => !!v);
  }
  /** The module tag in index.html normally provides the loaders; if its fetch failed, import it again. */
  async function ensureLoaders() {
    if (await waitForLoaders(5000)) return true;
    for (let i = 1; i <= 2 && !loadersReady(); i++) {
      try { await import('../lib/vendor/loaders.js?retry=' + i); } catch (e) { await sleep(500 * i); }
    }
    return loadersReady() || waitForLoaders(2000);
  }

  function loadTexture(url, srgb) {
    return new Promise(res => {
      new T.TextureLoader().load(url, t => {
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.anisotropy = 8;
        if (srgb) t.encoding = T.sRGBEncoding;
        res(t);
      }, undefined, () => res(null));
    });
  }

  function loadSet(id) {
    const p = BASE + 'tex/' + id;
    return Promise.all([retry(() => loadTexture(p + '_diff.jpg', true)), retry(() => loadTexture(p + '_nor.jpg', false)), retry(() => loadTexture(p + '_rough.jpg', false))])
      .then(([map, normalMap, roughnessMap]) => map ? { map, normalMap, roughnessMap } : null);
  }

  /**
   * load(onProgress) -> Promise<assets>. assets = { tex: {set: {map, normalMap, roughnessMap}|null},
   * hdr: DataTexture|null, gltf: {name: gltf|null}, sfx: {name: ArrayBuffer|null}, loaders: bool }.
   */
  function load(onProgress) {
    const out = { tex: {}, hdr: null, gltf: {}, sfx: {}, loaders: false };
    let done = 0, total = 0;
    const tick = () => { done++; if (onProgress) onProgress(done / total, done, total); };
    const track = (p, ms) => { total++; return withTimeout(p.catch(() => null), ms).then(v => { tick(); return v; }); };

    // the loader modules first (they are already in flight from index.html), then the rest, a few at a time
    const gate = ensureLoaders();
    const after = fn => gate.then(fn);
    const sounds = SOUNDS.map(n => track(after(() => retry(() => fetch(BASE + 'sfx/' + n + '.ogg').then(r => r.ok ? r.arrayBuffer() : null))), 40000)
      .then(b => { out.sfx[n] = b; }));
    const textures = TEX_SETS.map(id => track(after(() => loadSet(id)), 40000).then(s => { out.tex[id] = s; }));
    const hdr = track(gate.then(ok => ok ? retry(() => new Promise(res => new T.RGBELoader().load(BASE + 'hdr/industrial_sunset_02_1k.hdr', res, undefined, () => res(null)))) : null), 40000)
      .then(t => { out.hdr = t; });
    const models = Object.keys(MODELS).map(k => track(gate.then(ok => ok ? retry(() => new Promise(res => new T.GLTFLoader().load(BASE + MODELS[k], res, undefined, e => { console.warn('Duskwater: model failed (retrying)', k, e && e.message); res(null); }))) : null), 45000)
      .then(g => { out.gltf[k] = g; }));
    if (onProgress) onProgress(0, 0, total);
    return Promise.all([gate.then(ok => { out.loaders = ok; })].concat(sounds, textures, [hdr], models)).then(() => out);
  }

  global.ArenaAssets = { load, TEX_SETS, MODELS, SOUNDS };
})(window);
