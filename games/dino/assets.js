// Asset registry and loader. Every module registers what it needs at script load
// (DH.Assets.register), core.js calls load() once, then modules read by key.
(function (root) {
  'use strict';
  const DH = root.DH = root.DH || {};
  const reg = new Map();     // key -> { url, type, opts }
  const got = new Map();     // key -> loaded value
  const typeOf = url => /\.glb$|\.gltf$/i.test(url) ? 'gltf' : /\.hdr$/i.test(url) ? 'hdr'
    : /\.(jpe?g|png|webp)$/i.test(url) ? 'tex' : /\.(ogg|wav|mp3)$/i.test(url) ? 'sound' : 'json';

  let actx = null;
  /** One shared AudioContext (resumed on the first click by core.js). */
  function audioContext() {
    if (!actx) actx = new (root.AudioContext || root.webkitAudioContext)();
    return actx;
  }

  function waitLoaders() {
    return root.__threeLoadersReady ? Promise.resolve()
      : new Promise(r => root.addEventListener('three-loaders', r, { once: true }));
  }

  /** opts for textures: { srgb: bool (colour maps), repeat: [u,v] }. */
  function register(key, url, opts) {
    if (!reg.has(key)) reg.set(key, { url, type: (opts && opts.type) || typeOf(url), opts: opts || {} });
  }

  function loadOne(key, e, T) {
    switch (e.type) {
      case 'gltf': return new Promise((res, rej) => new T.GLTFLoader().load(e.url, g => {
        g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        res(g);
      }, undefined, rej));
      case 'hdr': return new Promise((res, rej) => new T.RGBELoader().load(e.url, res, undefined, rej));
      case 'tex': return new Promise((res, rej) => new T.TextureLoader().load(e.url, t => {
        if (e.opts.srgb) t.encoding = T.sRGBEncoding;
        t.wrapS = t.wrapT = T.RepeatWrapping;
        if (e.opts.repeat) t.repeat.set(e.opts.repeat[0], e.opts.repeat[1]);
        t.anisotropy = 8;
        res(t);
      }, undefined, rej));
      case 'sound': return fetch(e.url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => audioContext().decodeAudioData(b));
      default: return fetch(e.url).then(r => r.json());
    }
  }

  /** Loads everything registered (and not loaded yet). onProgress(done, total, key). A missing
   * asset is logged and skipped so the game still runs. */
  async function load(onProgress) {
    await waitLoaders();
    const T = root.THREE;
    const todo = [...reg.entries()].filter(([k]) => !got.has(k));
    let done = 0;
    await Promise.all(todo.map(([k, e]) => loadOne(k, e, T)
      .then(v => got.set(k, v))
      .catch(err => console.warn('[assets] failed', k, e.url, err && err.message))
      .finally(() => { done++; if (onProgress) onProgress(done, todo.length, k); })));
  }

  function get(key) { return got.get(key); }
  function has(key) { return got.has(key); }

  /** Independent copy of a loaded model (skinned meshes keep their own skeleton).
   * Returns { root: Object3D, animations: AnimationClip[] } or null. */
  function cloneModel(key) {
    const g = got.get(key);
    if (!g) return null;
    const rootObj = root.THREE.SkeletonUtils.clone(g.scene);
    return { root: rootObj, animations: g.animations || [] };
  }

  DH.Assets = { register, load, get, has, cloneModel, audioContext, entries: () => [...reg.keys()] };
})(window);
