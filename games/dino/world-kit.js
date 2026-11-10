// Ironfern world (Stage A), rendering kit: splat-shaded terrain, sky dome, water, model templates
// and instancing (with wind sway and triplanar detail on flat-coloured models), textured boxes,
// signs, lights. world.js creates a builder (DH.WorldKit.builder) per mission; world-sets.js dresses it.
(function () {
  'use strict';
  const DH = window.DH = window.DH || {};
  const A = () => DH.Assets, WL = () => DH.WorldLib;

  // ------------------------------------------------------------------ model catalogue
  // fit: target size in metres (h = height, l = longest horizontal); mats: per-material tweaks
  // (leaf: alpha-tested, two-sided, sways; tri: triplanar detail texture for flat-coloured parts).
  const M = {
    tree_broadleaf: { f: 'nature/tree_broadleaf', kind: 'tree', trunk: 0.032, mats: { Leaves_NormalTree: { leaf: 1, tint: 0x5a7040 }, Bark_NormalTree: { rough: 0.95, tint: 0x6a645c } } },
    tree_dead: { f: 'nature/tree_dead', kind: 'tree', trunk: 0.03, mats: { Bark_DeadTree: { rough: 0.95, tint: 0x7d756c } } },
    palm_coconut: { f: 'nature/palm_coconut', kind: 'tree', trunk: 0.016, mats: { '*': { leaf: 1, tint: 0x9aa38a, rough: 0.85 } } },
    palm_triangle: { f: 'nature/palm_triangle', kind: 'tree', trunk: 0.02, mats: { '*': { leaf: 1, tint: 0x9aa38a, rough: 0.85 } } },
    palm_tree: { f: 'nature/palm_tree', kind: 'tree', trunk: 0.04, mats: { '*': { leaf: 1, tint: 0x8f9a7a, rough: 0.85 } } },
    palm_curved: { f: 'nature/palm_curved', kind: 'tree', trunk: 0.04, mats: { Wood: { tri: 'bark', tint: 0x6b5a48 }, Green: { leafFlat: 1, tint: 0x3d5a24 }, DarkGreen: { leafFlat: 1, tint: 0x2b4119 } } },
    fern: { f: 'nature/fern', kind: 'plant', mats: { '*': { leaf: 1, tint: 0x6a8050 } } },
    plant_big_leaf: { f: 'nature/plant_big_leaf', kind: 'plant', mats: { '*': { leaf: 1, tint: 0x6f8c55 } } },
    bush: { f: 'nature/bush', kind: 'plant', mats: { '*': { leaf: 1, tint: 0x56683e } } },
    grass_tall: { f: 'nature/grass_tall', kind: 'plant', mats: { '*': { leaf: 1, tint: 0x8a9460 } } },
    vines_hanging: { f: 'nature/vines_hanging', kind: 'plant', top: 1, mats: { '*': { leaf: 1, tint: 0x6f8452 } } },
    rock_large: { f: 'nature/rock_large', kind: 'rock', mats: { '*': { tri: 'rock', replace: 0.85 } } },
    rock_moss: { f: 'nature/rock_moss', kind: 'rock', mats: { Rock: { tri: 'rock', replace: 0.9 }, Green: { tri: 'rock', replace: 0.6, tint: 0x55703a } } },
    log_moss: { f: 'nature/log_moss', kind: 'log', mats: { Wood: { tri: 'bark', tint: 0x5c4a3a, replace: 0.5 }, Green: { tri: 'rock', tint: 0x55703a, replace: 0.5 }, DarkGreen: { tri: 'rock', tint: 0x3c5228, replace: 0.5 } } },
    // props
    jeep: { f: 'props/jeep', kind: 'metal', mats: { DarkGreen_Jeep: { tri: 'rust', tint: 0x3b4a2c, replace: 0.35, rough: 0.7 }, LightGreen_Jeep: { tri: 'rust', tint: 0x4a5a36, replace: 0.3, rough: 0.7 }, Windows_Jeep: { rough: 0.05, metal: 0.2, color: 0x6a7a80, glass: 1 }, '*': { rough: 0.6 } } },
    pickup_truck: { f: 'props/pickup_truck', kind: 'metal', mats: { '*': { tri: 'rust', replace: 0.0, detail: 0.6, rough: 0.65, dull: 0.35 } } },
    container_green: { f: 'props/container_green', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.7, rough: 0.6 } } },
    barrel_hazard: { f: 'props/barrel_hazard', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.7, rough: 0.55 } } },
    barrels_oil: { f: 'props/barrels_oil', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.8, rough: 0.55, dull: 0.55 } } },
    concrete_barrier: { f: 'props/concrete_barrier', kind: 'rock', mats: { '*': { tri: 'concrete', replace: 0.8, tint: 0xb8b2a8 } } },
    crate_wood: { f: 'props/crate_wood', kind: 'wood', mats: { DarkWood: { tri: 'planks', replace: 0.6, tint: 0x6b5236 }, Wood: { tri: 'planks', replace: 0.7, tint: 0x9a7a55 } } },
    fence_barrier_large: { f: 'props/fence_barrier_large', kind: 'metal', mats: { Texture_Fence: { fence: 1 }, '*': { tri: 'rust', detail: 0.6, rough: 0.6, dull: 0.8 } } },
    fence_chainlink: { f: 'props/fence_chainlink', kind: 'metal', mats: { Texture_Fence: { fence: 1 }, '*': { tri: 'rust', detail: 0.6, rough: 0.55 } } },
    fence_chainlink_post: { f: 'props/fence_chainlink_post', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.6, rough: 0.5 } } },
    floodlight_post: { f: 'props/floodlight_post', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.7, rough: 0.6, dull: 0.6 } } },
    generator: { f: 'props/generator', kind: 'metal', mats: { '*': { tri: 'rust', detail: 0.7, rough: 0.6 } } },
    sandbags: { f: 'props/sandbags', kind: 'dirt', mats: { '*': { tri: 'mud', detail: 0.5, rough: 0.95, tint: 0x8a7a5c } } },
    sign_construction: { f: 'props/sign_construction', kind: 'metal', mats: { '*': { rough: 0.6, dull: 0.8 } } },
  };
  const TEX = ['forest_leaves_02', 'leafy_grass', 'mud_forest', 'muddy_tracks', 'mossy_rock', 'concrete_floor_worn_001',
    'brick_wall_001', 'asphalt_02', 'weathered_planks', 'corrugated_iron_02', 'rusty_metal_02', 'container_side'];
  const TRI = { bark: 'weathered_planks', rock: 'mossy_rock', rust: 'rusty_metal_02', planks: 'weathered_planks', concrete: 'concrete_floor_worn_001', mud: 'mud_forest' };

  function register() {
    const R = A().register;
    for (const k in M) R('world_m_' + k, 'assets/' + M[k].f + '.glb');
    TEX.forEach(t => { R('world_t_' + t + '_diff', 'assets/tex/' + t + '_diff.jpg', { srgb: true }); R('world_t_' + t + '_nor', 'assets/tex/' + t + '_nor.jpg'); });
    R('sky_hdr', 'assets/hdr/lush_dirt_path_1k.hdr');
    R('world_hdr_dusk', 'assets/hdr/industrial_sunset_02_1k.hdr');
  }

  // ------------------------------------------------------------------ shared shader bits
  const shared = { time: { value: 0 }, wind: { value: 1 } };
  const tex = (n, k) => A().get('world_t_' + n + '_' + (k || 'diff')) || null;

  /** Triplanar detail: modulate (or replace) a flat colour with a world-space texture. */
  function addTriplanar(mat, o) {
    const map = tex(o.tex), nor = tex(o.tex, 'nor');
    if (!map) return;
    const u = { tpMap: { value: map }, tpScale: { value: o.scale || 0.5 }, tpReplace: { value: o.replace || 0 }, tpDetail: { value: o.detail == null ? 0.8 : o.detail } };
    chain(mat, sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 tpW = vec4(transformed, 1.0); vec3 tpN = objectNormal;
          #ifdef USE_INSTANCING
            tpW = instanceMatrix * tpW; tpN = mat3(instanceMatrix) * tpN;
          #endif
          vTpPos = (modelMatrix * tpW).xyz; vTpNrm = normalize(mat3(modelMatrix) * tpN);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNrm; uniform sampler2D tpMap; uniform float tpScale, tpReplace, tpDetail;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 b = pow(abs(vTpNrm), vec3(4.0)); b /= (b.x + b.y + b.z);
            vec3 p = vTpPos * tpScale;
            vec3 c = texture2D(tpMap, p.zy).rgb * b.x + texture2D(tpMap, p.xz).rgb * b.y + texture2D(tpMap, p.xy).rgb * b.z;
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            vec3 det = diffuseColor.rgb * mix(1.0, clamp(l / 0.22, 0.25, 2.2), tpDetail);
            diffuseColor.rgb = mix(det, c * diffuseColor.rgb / max(0.08, dot(diffuseColor.rgb, vec3(0.333))) * 0.45, tpReplace);
          }`);
    }, 'tp');
    if (nor && !mat.normalMap) mat.userData.tpNor = nor;
  }
  /** Wind sway for foliage (object-space height drives the bend). */
  function addSway(mat, amp, h) {
    const u = { swAmp: { value: amp }, swH: { value: h } };
    chain(mat, sh => {
      Object.assign(sh.uniforms, u); sh.uniforms.uTime = shared.time; sh.uniforms.uWind = shared.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWind, swAmp, swH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 ip = vec3(0.0);
            #ifdef USE_INSTANCING
              ip = instanceMatrix[3].xyz;
            #endif
            float k = clamp(position.y / swH, 0.0, 1.5); k *= k;
            float ph = uTime * 1.1 + ip.x * 0.23 + ip.z * 0.19;
            float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25 + sin(uTime * 4.7 + position.x * 3.0 + position.z * 2.0) * 0.12;
            transformed.x += g * swAmp * swH * k * uWind;
            transformed.z += cos(ph * 0.83) * 0.6 * swAmp * swH * k * uWind;
          }`);
    }, 'sw');
  }
  // compose several onBeforeCompile hooks on one material
  function chain(mat, fn, tag) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => { if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r); fn(sh); };
    const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    const key = (mat.userData.pk || '') + tag;
    mat.userData.pk = key;
    mat.customProgramCacheKey = () => key + pk;
    mat.needsUpdate = true;
  }

  // ------------------------------------------------------------------ model templates
  const templates = {}; // key -> { parts: [{ geometry, material }], size, h }
  function fixMaterial(m, cfg, key, hUnits) {
    if (m.userData.fixed) return m;
    m.userData.fixed = true;
    const c = cfg.mats && (cfg.mats[m.name] || cfg.mats['*']) || {};
    m.metalness = c.metal != null ? c.metal : 0;
    m.roughness = c.rough != null ? c.rough : 0.9;
    m.envMapIntensity = 1;
    if (c.color != null) m.color.setHex(c.color);
    if (c.tint != null) m.color.multiply(new THREE.Color(c.tint).multiplyScalar(c.leaf || c.leafFlat ? 1.05 : 1.5));
    if (c.dull) { const hsl = {}; m.color.getHSL(hsl); m.color.setHSL(hsl.h, hsl.s * c.dull, hsl.l * (0.6 + 0.4 * c.dull)); }
    if (c.leaf) {
      m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.depthWrite = true;
      m.roughness = c.rough != null ? c.rough : 0.75;
      addSway(m, cfg.kind === 'tree' ? 0.012 : 0.035, hUnits);
    }
    if (c.leafFlat) { m.side = THREE.DoubleSide; addSway(m, 0.012, hUnits); }
    if (c.glass) { m.transparent = true; m.opacity = 0.14; m.depthWrite = false; }
    if (c.fence) { m.transparent = false; m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.metalness = 0.4; m.roughness = 0.5; m.color.setHex(0x8c8a84); }
    if (c.tri) addTriplanar(m, { tex: TRI[c.tri], replace: c.replace, detail: c.detail, scale: c.tri === 'rock' ? 0.35 : 0.6 });
    return m;
  }
  function template(key) {
    if (templates[key]) return templates[key];
    const g = A().get('world_m_' + key), cfg = M[key];
    if (!g || !cfg) return null;
    const sc = g.scene; sc.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sc), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    // normalise: height 1 (bottom or top at y=0), centred on x/z
    const s = 1 / size.y;
    const norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-ctr.x, cfg.top ? -box.max.y : -box.min.y, -ctr.z));
    const parts = [];
    sc.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => fixMaterial(m, cfg, key, 1));
      parts.push({ geometry: geo, material: o.material });
    });
    return (templates[key] = { parts, size: { x: size.x * s, y: 1, z: size.z * s }, aspect: Math.max(size.x, size.z) / size.y, cfg });
  }

  // ------------------------------------------------------------------ impostors (far LOD)
  // Each plant/tree template is rendered once, side-on and unlit, into a texture; far instances
  // draw 3 crossed quads with it. Albedo is baked; the scene lights the quads (normals lean up).
  const impostors = {};
  function impostor(renderer, key) {
    if (impostors[key]) return impostors[key];
    const t = template(key);
    if (!t || !renderer) return null;
    const T = THREE, w = Math.max(t.size.x, t.size.z, 0.2) * 1.02, H = 1.02;
    const RW = 256, RH = Math.max(64, Math.min(512, Math.round(256 * H / w)));
    const rt = new T.WebGLRenderTarget(RW, RH, { depthBuffer: true });
    rt.texture.encoding = T.sRGBEncoding; rt.texture.generateMipmaps = true; rt.texture.minFilter = T.LinearMipmapLinearFilter;
    const sc = new T.Scene(), cam = new T.OrthographicCamera(-w / 2, w / 2, H, 0, -10, 10);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    // soft bake light (physically-correct units: pi = albedo-level) gives the crown some volume
    sc.add(new T.HemisphereLight(0xffffff, 0x3a4030, Math.PI * 0.75));
    const bl = new T.DirectionalLight(0xffffff, Math.PI * 0.6); bl.position.set(0.4, 1, 0.8); sc.add(bl);
    const mats = [];
    t.parts.forEach(p => [].concat(p.material).forEach(m => {
      const b = new T.MeshLambertMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, alphaTest: m.alphaTest || 0, side: T.DoubleSide });
      mats.push(b); sc.add(new T.Mesh(p.geometry, b));
    }));
    const prevRT = renderer.getRenderTarget(), prevCC = renderer.getClearColor(new T.Color()), prevCA = renderer.getClearAlpha();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x2c3a1c, 0); renderer.clear(); renderer.render(sc, cam);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCC, prevCA);
    mats.forEach(m => m.dispose());
    // 3 vertical quads at 60 degrees, base at y=0, height 1
    const pos = [], nor = [], uv = [], idx = [];
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2, nx = -Math.sin(a), nz = Math.cos(a), b = k * 4;
      [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        pos.push(cx * sx, sy * H, cz * sx);
        const L = Math.hypot(nx * 0.25, 0.95, nz * 0.25); nor.push(nx * 0.25 / L, 0.95 / L, nz * 0.25 / L);
        uv.push((sx + 1) / 2, sy);
      });
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
    const mat = new T.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.45, side: T.DoubleSide, roughness: 0.9, metalness: 0, color: 0xffffff });
    return (impostors[key] = { geometry: g, material: mat, rt });
  }

  // ------------------------------------------------------------------ builder
  function builder(ctx, desc) {
    const T = THREE, root = new T.Group(); root.name = 'world';
    const B = {
      T, ctx, d: desc, root, q: Math.max(0.5, Math.min(1, (ctx.settings && ctx.settings.quality) || 1)),
      colliders: [], trunks: [], anim: [], owned: [], lights: [], R: WL().rng(desc.seed || 1),
      shared,
    };
    B.add = (o, parent) => { (parent || root).add(o); return o; };
    B.own = x => { B.owned.push(x); return x; };
    B.collide = (o, surface) => { o.userData.surface = surface; B.colliders.push(o); return o; };
    B.h = (x, z) => desc.heightAt(x, z);

    // ---------------------------------------------------------------- materials
    const matCache = {};
    /** PBR from the texture kit; UVs on generated boxes are in metres, `tile` metres per repeat. */
    B.mat = (name, o) => {
      o = o || {};
      const k = name + JSON.stringify(o);
      if (matCache[k]) return matCache[k];
      const m = new T.MeshStandardMaterial({ map: tex(name), normalMap: tex(name, 'nor'), roughness: o.rough == null ? 0.85 : o.rough, metalness: o.metal || 0, color: o.color != null ? o.color : 0xffffff });
      if (o.tile && m.map) {
        // clone so the repeat is ours
        m.map = B.own(m.map.clone()); m.map.needsUpdate = true; m.map.repeat.set(1 / o.tile, 1 / o.tile);
        if (m.normalMap) { m.normalMap = B.own(m.normalMap.clone()); m.normalMap.needsUpdate = true; m.normalMap.repeat.set(1 / o.tile, 1 / o.tile); }
      }
      if (o.side) m.side = o.side;
      if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei || 1; }
      if (o.normalScale) m.normalScale.set(o.normalScale, o.normalScale);
      // weathering: a world-space mossy-rock layer over concrete and brick
      if (o.moss) addTriplanar(m, { tex: 'mossy_rock', replace: o.moss, detail: 0.15, scale: 0.3 });
      return (matCache[k] = B.own(m));
    };
    B.flat = (color, o) => {
      o = o || {};
      const k = 'flat' + color + JSON.stringify(o);
      if (matCache[k]) return matCache[k];
      const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0 }, o));
      return (matCache[k] = B.own(m));
    };

    /** Box with metre UVs (so tiled textures keep their scale), bottom at y=0 unless centred. */
    B.boxGeo = (w, h, d, centred) => {
      const g = new T.BoxGeometry(w, h, d);
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
        if (nx > 0.5) uv.setXY(i, z, y); else if (ny > 0.5) uv.setXY(i, x, z); else uv.setXY(i, x, y);
      }
      if (!centred) g.translate(0, h / 2, 0);
      return B.own(g);
    };
    /** A textured box placed in the world. o: { x, y, z, ry, rx, rz, mat, surface, shadow } */
    B.box = (w, h, d, mat, o) => {
      o = o || {};
      const m = new T.Mesh(B.boxGeo(w, h, d, o.centred), mat);
      m.position.set(o.x || 0, o.y != null ? o.y : B.h(o.x || 0, o.z || 0), o.z || 0);
      m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
      m.castShadow = o.shadow !== false; m.receiveShadow = true;
      B.add(m, o.parent);
      if (o.surface !== null) B.collide(m, o.surface || 'stone');
      return m;
    };
    B.cyl = (r0, r1, h, mat, o) => {
      o = o || {};
      const g = B.own(new T.CylinderGeometry(r0, r1, h, o.seg || 12, 1, !!o.open));
      if (!o.centred) g.translate(0, h / 2, 0);
      const m = new T.Mesh(g, mat);
      m.position.set(o.x || 0, o.y != null ? o.y : B.h(o.x || 0, o.z || 0), o.z || 0);
      m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
      m.castShadow = o.shadow !== false; m.receiveShadow = true;
      B.add(m, o.parent);
      if (o.surface !== null) B.collide(m, o.surface || 'metal');
      return m;
    };

    // ---------------------------------------------------------------- models
    /** One placed copy of a catalogue model. o: { x, z, y, ry, h (metres) | s, tilt:[rx,rz], surface, collide } */
    B.model = (key, o) => {
      const t = template(key);
      if (!t) return null;
      o = o || {};
      const g = new T.Group();
      t.parts.forEach(p => { const m = new T.Mesh(p.geometry, p.material); m.castShadow = o.shadow !== false; m.receiveShadow = true; g.add(m); });
      const s = o.h || (o.l ? o.l / Math.max(t.size.x, t.size.z) : o.s || 1);
      g.scale.setScalar(s);
      g.position.set(o.x || 0, o.y != null ? o.y : B.h(o.x || 0, o.z || 0) + (o.dy || 0), o.z || 0);
      g.rotation.set((o.tilt && o.tilt[0]) || 0, o.ry || 0, (o.tilt && o.tilt[1]) || 0, 'YXZ');
      B.add(g, o.parent);
      if (o.collide !== false) B.collide(g, o.surface || ({ metal: 'metal', wood: 'wood', rock: 'stone', dirt: 'dirt', tree: 'wood', log: 'wood' }[t.cfg.kind] || 'metal'));
      g.userData.size = { x: t.size.x * s, y: s, z: t.size.z * s };
      return g;
    };
    /** Many copies as InstancedMeshes. list: [{ x, z, y?, rot, s (height m), tilt? }] */
    const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3();
    B.instances = (key, list, o) => {
      const t = template(key);
      if (!t || !list.length) return null;
      o = o || {};
      const out = [];
      // spatial chunks so frustum culling works (each chunk gets a geometry view sharing the
      // template's buffers, with its own bounding sphere); far chunks skip the shadow pass
      const CH = o.chunk || 160, chunks = new Map(), sh = desc.shadow;
      list.forEach(it => { const k = Math.floor(it.x / CH) + ',' + Math.floor(it.z / CH); if (!chunks.has(k)) chunks.set(k, []); chunks.get(k).push(it); });
      const r0 = Math.max(t.size.x, t.size.z, 1) * 0.75;
      chunks.forEach(items => {
        let cx = 0, cz = 0, cy = 0, rad = 0, smax = 0;
        items.forEach(it => { cx += it.x; cz += it.z; smax = Math.max(smax, it.s * (it.sx || 1)); });
        cx /= items.length; cz /= items.length;
        items.forEach(it => { it._y = it.y != null ? it.y : B.h(it.x, it.z) - (o.sink || 0) * it.s; cy += it._y; });
        cy /= items.length;
        items.forEach(it => { rad = Math.max(rad, Math.hypot(it.x - cx, it._y - cy, it.z - cz)); });
        const sphere = new T.Sphere(new T.Vector3(cx, cy + smax * 0.5, cz), rad + smax * (r0 + 0.6));
        const casts = o.shadow !== false && (!sh || Math.hypot(cx - sh.x, cz - sh.z) < sh.r * 1.45 + CH);
        t.parts.forEach(p => {
          const g = new T.BufferGeometry();
          g.index = p.geometry.index; g.attributes = p.geometry.attributes; g.groups = p.geometry.groups;
          g.boundingBox = p.geometry.boundingBox;
          // raycasting tests each instance against the geometry's local sphere, so colliders keep it
          g.boundingSphere = o.surface ? p.geometry.boundingSphere : sphere;
          const im = new T.InstancedMesh(g, p.material, items.length);
          if (o.surface) im.frustumCulled = false;
          items.forEach((it, i) => {
            _e.set((it.tilt && it.tilt[0]) || 0, it.rot || 0, (it.tilt && it.tilt[1]) || 0, 'YXZ'); _q.setFromEuler(_e);
            _p.set(it.x, it._y, it.z);
            const sx = it.s * (it.sx || 1); _s.set(sx, it.s, sx);
            im.setMatrixAt(i, _m.compose(_p, _q, _s));
          });
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = casts; im.receiveShadow = true;
          B.add(im);
          if (o.surface) B.collide(im, o.surface);
          out.push(im);
        });
      });
      if (t.cfg.trunk && o.trunks !== false) list.forEach(it => {
        const y = it.y != null ? it.y : B.h(it.x, it.z);
        B.trunks.push({ x: it.x, z: it.z, r: Math.max(0.12, t.cfg.trunk * it.s), y0: y - 1, y1: y + it.s * (o.trunkH || 0.55) });
      });
      return out;
    };

    /** Far LOD: baked impostor cards (3 crossed quads, 6 triangles) in one InstancedMesh per kind. */
    B.cards = (key, list, o) => {
      const imp = impostor(ctx.renderer, key);
      if (!imp || !list.length) return null;
      o = o || {};
      const im = new T.InstancedMesh(imp.geometry, imp.material, list.length);
      list.forEach((it, i) => {
        _e.set(0, it.rot || 0, 0, 'YXZ'); _q.setFromEuler(_e);
        _p.set(it.x, it.y != null ? it.y : B.h(it.x, it.z) - (o.sink || 0) * it.s, it.z);
        const sx = it.s * (it.sx || 1); _s.set(sx, it.s, sx);
        im.setMatrixAt(i, _m.compose(_p, _q, _s));
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; im.userData.card = true;
      B.add(im);
      return im;
    };

    /** Merge static meshes per material (and surface) into one mesh each: hundreds of boxes and
     * prop parts become a few dozen draw calls. Collider surfaces carry over to the merged meshes. */
    B.mergeStatic = () => {
      root.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(root.matrixWorld).invert();
      const groups = new Map();
      const surfOf = o => { let q = o; while (q && q !== root) { if (q.userData.surface) return q.userData.surface; q = q.parent; } return ''; };
      const dyn = o => { let q = o; while (q && q !== root) { if (q.userData.noMerge) return true; q = q.parent; } return false; };
      const OK = ['position', 'normal', 'uv', 'color'];
      root.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || dyn(o)) return;
        const g = o.geometry;
        if (!g.attributes.position || !g.attributes.normal || Object.keys(g.morphAttributes || {}).length) return;
        const names = Object.keys(g.attributes).filter(n => OK.includes(n)).sort();
        const key = o.material.uuid + '|' + names.join(',') + '|' + surfOf(o) + '|' + o.castShadow + '|' + o.renderOrder;
        if (!groups.has(key)) groups.set(key, { names, list: [], surf: surfOf(o), mat: o.material, cast: o.castShadow });
        groups.get(key).list.push(o);
      });
      const removed = new Set(), merged = [];
      const _v = new T.Vector3(), _nm = new T.Matrix3();
      groups.forEach(gr => {
        if (gr.list.length < 2) return;
        let nv = 0, ni = 0;
        gr.list.forEach(o => { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
        const arrs = {};
        gr.names.forEach(n => { arrs[n] = new Float32Array(nv * gr.list[0].geometry.attributes[n].itemSize); });
        const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
        let vo = 0, io = 0;
        gr.list.forEach(o => {
          const g = o.geometry, m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
          _nm.getNormalMatrix(m);
          const cnt = g.attributes.position.count;
          gr.names.forEach(n => {
            const a = g.attributes[n], it = a.itemSize, out = arrs[n];
            for (let i = 0; i < cnt; i++) {
              const j = vo + i;
              if (n === 'position') { _v.fromBufferAttribute(a, i).applyMatrix4(m); out[j * 3] = _v.x; out[j * 3 + 1] = _v.y; out[j * 3 + 2] = _v.z; }
              else if (n === 'normal') { _v.fromBufferAttribute(a, i).applyMatrix3(_nm).normalize(); out[j * 3] = _v.x; out[j * 3 + 1] = _v.y; out[j * 3 + 2] = _v.z; }
              else { out[j * it] = a.getX(i); if (it > 1) out[j * it + 1] = a.getY(i); if (it > 2) out[j * it + 2] = a.getZ(i); if (it > 3) out[j * it + 3] = a.getW(i); }
            }
          });
          // a mirrored transform flips the winding
          const flip = m.determinant() < 0;
          if (g.index) for (let i = 0; i < g.index.count; i += 3) { const a0 = g.index.getX(i), a1 = g.index.getX(i + 1), a2 = g.index.getX(i + 2); idx[io++] = vo + a0; idx[io++] = vo + (flip ? a2 : a1); idx[io++] = vo + (flip ? a1 : a2); }
          else for (let i = 0; i < cnt; i += 3) { idx[io++] = vo + i; idx[io++] = vo + i + (flip ? 2 : 1); idx[io++] = vo + i + (flip ? 1 : 2); }
          vo += cnt;
          removed.add(o);
        });
        const geo = B.own(new T.BufferGeometry());
        gr.names.forEach(n => geo.setAttribute(n, new T.BufferAttribute(arrs[n], gr.list[0].geometry.attributes[n].itemSize)));
        geo.setIndex(new T.BufferAttribute(idx, 1));
        geo.computeBoundingSphere(); geo.computeBoundingBox();
        const mesh = new T.Mesh(geo, gr.mat);
        mesh.castShadow = gr.cast; mesh.receiveShadow = true; mesh.name = 'merged';
        if (gr.surf) mesh.userData.surface = gr.surf;
        merged.push(mesh);
      });
      removed.forEach(o => o.parent && o.parent.remove(o));
      // prune groups left empty
      let pruned = true;
      while (pruned) {
        pruned = false;
        const empty = []; root.traverse(o => { if (o !== root && o.isGroup && !o.children.length) empty.push(o); });
        empty.forEach(o => { if (o.parent) { o.parent.remove(o); pruned = true; } });
      }
      merged.forEach(m => root.add(m));
      const alive = o => { let found = false; o.traverse(c => { if (c.isMesh) found = true; }); let q = o; while (q && q !== root) q = q.parent; return found && q === root; };
      B.colliders = B.colliders.filter(alive).concat(merged.filter(m => m.userData.surface));
      return { merged: merged.length, from: removed.size };
    };

    // ---------------------------------------------------------------- signs (canvas textures)
    /** Weathered painted sign. o: { w, h, lines:[{t, size, bold, color}], bg, fg, stripe, logo } -> Texture */
    B.signTex = (o) => {
      let W = 512, H = Math.round(512 * o.h / o.w);
      if (H < 150) { H = 150; W = Math.min(2048, Math.round(150 * o.w / o.h)); }
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = o.bg || '#1f3a2a'; g.fillRect(0, 0, W, H);
      if (o.stripe) { g.fillStyle = o.stripe; for (let x = -H; x < W; x += 48) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H * 0.35, H * 0.65); g.lineTo(x + H * 0.35, H * 0.65); g.fill(); } }
      g.strokeStyle = o.fg || '#e8e0c8'; g.lineWidth = 8; g.strokeRect(14, 14, W - 28, H - 28);
      if (o.logo) { // Halcyon mark: a fern frond in a ring
        const cx = 70, cy = H / 2, r = Math.max(10, Math.min(46, H / 2 - 30));
        g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(cx, cy + r * 0.8); g.quadraticCurveTo(cx + r * 0.1, cy, cx - r * 0.1, cy - r * 0.8); g.stroke();
        for (let i = 0; i < 6; i++) { const y = cy + r * 0.6 - i * r * 0.26, l = r * (0.55 - i * 0.06); g.beginPath(); g.moveTo(cx, y); g.lineTo(cx - l, y - l * 0.5); g.moveTo(cx, y); g.lineTo(cx + l, y - l * 0.5); g.stroke(); }
      }
      const x0 = o.logo ? 140 : W / 2;
      g.textAlign = o.logo ? 'left' : 'center'; g.textBaseline = 'middle';
      const lines = o.lines || [];
      const total = lines.reduce((a, l) => a + l.size * 1.25, 0);
      let y = H / 2 - total / 2;
      lines.forEach(l => {
        g.fillStyle = l.color || o.fg || '#e8e0c8';
        g.font = `${l.bold ? '700' : '500'} ${l.size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
        y += l.size * 0.625; g.fillText(l.t, x0, y, W - (o.logo ? 160 : 60)); y += l.size * 0.625;
      });
      // weathering: grime, rust runs, moss at the bottom
      const R = B.R;
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + R() * 30},${30 + R() * 20},${15},${R() * 0.12})`; g.fillRect(R() * W, R() * H, 2 + R() * 18, 2 + R() * 10); }
      for (let i = 0; i < 26; i++) { const x = R() * W, l = H * (0.15 + R() * 0.6); const gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, 'rgba(110,55,20,0.45)'); gr.addColorStop(1, 'rgba(110,55,20,0)'); g.fillStyle = gr; g.fillRect(x, R() * H * 0.3, 2 + R() * 5, l); }
      const mg = g.createLinearGradient(0, H * 0.7, 0, H); mg.addColorStop(0, 'rgba(40,60,20,0)'); mg.addColorStop(1, 'rgba(40,60,20,0.55)'); g.fillStyle = mg; g.fillRect(0, H * 0.7, W, H * 0.3);
      const t = B.own(new T.CanvasTexture(c)); t.encoding = T.sRGBEncoding; t.anisotropy = 8;
      return t;
    };
    /** Sign board on posts. o: { x, z, ry, w, h, up (board bottom), posts, tilt, ...signTex opts } */
    B.sign = (o) => {
      const g = new T.Group(), up = o.up == null ? 1.2 : o.up;
      const face = new T.MeshStandardMaterial({ map: B.signTex(o), roughness: 0.75, metalness: 0.1 });
      B.own(face);
      const back = B.mat('rusty_metal_02', { tile: 1.5, rough: 0.7 });
      const board = new T.Mesh(B.boxGeo(o.w, o.h, 0.06, true), [back, back, back, back, face, back]);
      board.position.y = up + o.h / 2; board.castShadow = true; board.receiveShadow = true; g.add(board);
      const post = B.mat('rusty_metal_02', { tile: 1, rough: 0.6, metal: 0.6 });
      if (o.posts !== 0) [-1, 1].forEach(sd => { const p = new T.Mesh(B.boxGeo(0.09, up + o.h + 0.1, 0.09), post); p.position.set(sd * (o.w / 2 - 0.25), -0.3, -0.06); p.castShadow = true; g.add(p); });
      g.position.set(o.x, o.y != null ? o.y : B.h(o.x, o.z), o.z);
      g.rotation.set(0, o.ry || 0, o.tilt || 0, 'YXZ');
      B.add(g); B.collide(g, 'metal');
      return g;
    };

    // ---------------------------------------------------------------- runs of models along a line
    /** Chain-link or barrier fence from a to b; o.broken: probability a panel is missing/leaning. */
    B.fenceRun = (key, a, b, o) => {
      o = o || {};
      const t = template(key); if (!t) return;
      const L = Math.hypot(b.x - a.x, b.z - a.z), h = o.h || 3.4, pw = t.size.x * h, n = Math.max(1, Math.round(L / pw));
      const ry = Math.atan2(-(b.z - a.z), b.x - a.x), list = [], lean = [];
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
        const r = B.R();
        if (o.gaps && o.gaps.some(gp => Math.hypot(gp.x - x, gp.z - z) < gp.r)) continue;
        if (r < (o.broken || 0) * 0.5) continue;
        const it = { x, z, rot: ry, s: h, sx: (L / n) / pw };
        if (r < (o.broken || 0)) { it.tilt = [(B.R() - 0.5) * 0.9, (B.R() - 0.5) * 0.3]; it.y = B.h(x, z) - 0.1; lean.push(it); } else list.push(it);
      }
      // batched: every run of this model becomes one instanced set (see B.flushFences)
      (B._fences[key] = B._fences[key] || []).push(...list, ...lean);
    };

    B._fences = {};
    B.flushFences = () => { for (const k in B._fences) B.instances(k, B._fences[k], { surface: 'metal', chunk: 400 }); B._fences = {}; };

    // ---------------------------------------------------------------- lights
    B.light = (l) => { B.add(l); B.lights.push(l); return l; };
    return B;
  }

  // ------------------------------------------------------------------ terrain mesh + splat material
  function terrain(B, o) {
    const T = THREE, d = B.d, W = WL(), cell = o.cell || 2, size = d.size, x0 = d.center.x - size / 2, z0 = d.center.z - size / 2;
    const grid = W.heightGrid(d.terrain.height, x0, z0, size, cell), n = grid.n;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), sp = new Float32Array(n * n * 4), ex = new Float32Array(n * n * 3);
    const seed = d.seed || 1, grassy = o.grassy || 0, H = grid.h;
    const hAt = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * cell, z = z0 + j * cell, y = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 4; uv[k * 2 + 1] = z / 4;
      const m = d.terrain.mask(x, z);
      const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cell), gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cell), slope = Math.hypot(gx, gz);
      const nz = W.fbm(x / 18, z / 18, seed + 5, 3), nz2 = W.fbm(x / 7, z / 7, seed + 9, 2);
      const fo = o.forestFn ? o.forestFn(x, z) : 0.5;
      let grass = W.clamp(grassy + nz * 0.9 - 0.15, 0, 1) * (o.grassFn ? o.grassFn(x, z) : 1) * (1 - fo * 0.6);
      let mud = W.clamp(nz2 * 0.9 - 0.25, 0, 1) * 0.8 + fo * W.clamp(0.25 + nz * 0.4, 0, 0.6) + m.river * 0.9 + W.clamp(m.road * 2 * (1 - m.road), 0, 1) * 0.5;
      let rock = W.smooth(0.55, 0.95, slope) + (m.river > 0.6 ? 0.15 : 0);
      const road = m.road;
      grass *= (1 - road) * (1 - rock); mud *= (1 - road);
      if (o.paved && o.paved(x, z)) { grass *= 0.3; }
      sp[k * 4] = grass; sp[k * 4 + 1] = W.clamp(mud, 0, 1); sp[k * 4 + 2] = road; sp[k * 4 + 3] = W.clamp(rock, 0, 1);
      ex[k * 3] = m.roadU; ex[k * 3 + 1] = m.roadV; ex[k * 3 + 2] = 0.5 + 0.5 * W.fbm(x / 60, z / 60, seed + 13, 3) * 0.9 + m.river * 0.3;
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = (j + 1) * n + i, c = j * n + i + 1, e = (j + 1) * n + i + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = e; idx[q++] = c;
    }
    const geo = B.own(new T.BufferGeometry());
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setAttribute('splat', new T.BufferAttribute(sp, 4));
    geo.setAttribute('extra', new T.BufferAttribute(ex, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();

    const mat = B.own(new T.MeshStandardMaterial({ map: tex('forest_leaves_02'), normalMap: tex('forest_leaves_02', 'nor'), roughness: 1, metalness: 0 }));
    mat.normalScale.set(1.2, 1.2);
    const U = {
      tG: { value: tex('leafy_grass') }, tM: { value: tex('mud_forest') }, tR: { value: tex('muddy_tracks') }, tK: { value: tex('mossy_rock') },
      nG: { value: tex('leafy_grass', 'nor') }, nM: { value: tex('mud_forest', 'nor') }, nR: { value: tex('muddy_tracks', 'nor') }, nK: { value: tex('mossy_rock', 'nor') },
      tintL: { value: new T.Color(o.tintLeaves || 0x5c5844) }, tintG: { value: new T.Color(o.tintGrass || 0xa4ac80) }, tintR: { value: new T.Color(0x8c7a6c) },
      wet: { value: o.wet || 0 },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat; attribute vec3 extra; varying vec4 vSplat; varying vec3 vExtra; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vExtra = extra; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vSplat; varying vec3 vExtra; varying vec3 vWP;
          uniform sampler2D tG, tM, tR, tK, nG, nM, nR, nK; uniform vec3 tintL, tintG, tintR; uniform float wet;
          float tLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`)
        .replace('#include <map_fragment>', `
          vec2 uvL = vUv * 1.25, uvG = vUv * 1.4, uvM = vUv * 1.0, uvK = vUv * 0.55;
          vec2 uvR = vec2(vExtra.x + 0.5, vExtra.y * 0.5);
          vec3 cL = texture2D(map, uvL).rgb * tintL, cG = texture2D(tG, uvG).rgb * tintG, cM = texture2D(tM, uvM).rgb, cR = texture2D(tR, uvR).rgb * tintR, cK = texture2D(tK, uvK).rgb;
          // break up tiling with a second, rotated lookup of the forest floor
          cL = mix(cL, texture2D(map, vec2(uvL.y, -uvL.x) * 0.37).rgb * tintL, 0.35);
          cG = mix(cG, texture2D(tG, vec2(-uvG.y, uvG.x) * 0.41).rgb * tintG, 0.3);
          vec4 sp = vSplat; float sL = max(0.0, 1.0 - sp.x - sp.y - sp.z - sp.w);
          // height-aware blend: brighter (higher) texels win at the borders
          vec4 hw = sp * (vec4(tLum(cG), tLum(cM), tLum(cR) + 0.25, tLum(cK) + 0.1) + 0.35);
          float hl = sL * (tLum(cL) + 0.35);
          float mx = max(max(max(hw.x, hw.y), max(hw.z, hw.w)), hl) - 0.18;
          hw = max(hw - mx, 0.0); hl = max(hl - mx, 0.0);
          float sum = hw.x + hw.y + hw.z + hw.w + hl + 1e-5; hw /= sum; hl /= sum;
          // tyre ruts along the road
          float ru = abs(abs(vExtra.x) - 0.2);
          float rut = (1.0 - smoothstep(0.03, 0.09, ru)) * hw.z;
          vec3 col = cL * hl + cG * hw.x + cM * hw.y + cR * hw.z + cK * hw.w;
          col *= mix(0.78, 1.18, clamp(vExtra.z, 0.0, 1.0));
          col *= 1.0 - rut * 0.35;
          float wetK = clamp(wet + rut * 0.45 + hw.y * wet, 0.0, 1.0);
          col *= 1.0 - wetK * 0.25;
          diffuseColor.rgb *= col;
          vec3 tn = (texture2D(normalMap, uvL).xyz * 2.0 - 1.0) * hl + (texture2D(nG, uvG).xyz * 2.0 - 1.0) * hw.x + (texture2D(nM, uvM).xyz * 2.0 - 1.0) * hw.y
                  + (texture2D(nR, uvR).xyz * 2.0 - 1.0) * hw.z + (texture2D(nK, uvK).xyz * 2.0 - 1.0) * hw.w;
          tn.xy *= 1.0 - rut * 0.6;
          float wsRough = clamp(0.95 * hl + 0.9 * hw.x + 0.8 * hw.y + 0.85 * hw.z + 0.75 * hw.w - wetK * 0.35, 0.4, 1.0);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = wsRough;')
        .replace('vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = normalize(tn + vec3(0.0, 0.0, 0.35));');
    };
    mat.customProgramCacheKey = () => 'ironfern-terrain';
    const mesh = new T.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'terrain';
    B.add(mesh);
    return { mesh, grid, splat: sp };
  }

  // ------------------------------------------------------------------ sky dome (gradient + sun + humid cloud deck)
  function sky(B, o) {
    const T = THREE;
    const U = {
      zen: { value: new T.Color(o.zenith) }, hor: { value: o.horizon }, sunC: { value: new T.Color(o.sunColor) }, sunDir: { value: o.sunDir.clone() },
      cloud: { value: o.cloud == null ? 0.6 : o.cloud }, cloudC: { value: new T.Color(o.cloudColor || 0xd8dcd8) }, uTime: shared.time, glow: { value: o.glow || 1 },
    };
    const mat = B.own(new T.ShaderMaterial({
      uniforms: U, side: T.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `
        uniform vec3 zen, hor, sunC, sunDir, cloudC; uniform float cloud, uTime, glow; varying vec3 vD;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p *= 2.07; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vD); float y = max(d.y, 0.0);
          vec3 c = mix(hor, zen, pow(y, 0.55));
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          c += sunC * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.9) * glow + sunC * smoothstep(0.9994, 0.9997, sd) * 30.0;
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
            float cl = smoothstep(0.42, 0.85, fbm(cp)) * cloud * smoothstep(0.0, 0.18, d.y);
            vec3 cc = cloudC * (0.75 + 0.5 * pow(sd, 3.0)) ;
            c = mix(c, cc, cl * 0.85);
          }
          c = mix(c, hor, smoothstep(0.08, 0.0, d.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    }));
    const m = new T.Mesh(B.own(new T.SphereGeometry(850, 48, 24)), mat);
    m.renderOrder = -10; m.frustumCulled = false; m.name = 'sky';
    B.add(m);
    B.anim.push(() => { m.position.copy(B.ctx.camera.position); });
    return m;
  }

  // ------------------------------------------------------------------ water ribbon along a polyline
  function waterTex(B) {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), W = WL();
    const hgt = (x, y) => W.fbm(x / 22, y / 22, 3, 4) + 0.4 * W.fbm(x / 7, y / 7, 4, 2);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // tileable by wrapping the lookups
      const f = (a, b) => hgt(((a % S) + S) % S, ((b % S) + S) % S);
      const dx = f(x + 1, y) - f(x - 1, y), dy = f(x, y + 1) - f(x, y - 1);
      const i = (y * S + x) * 4; img.data[i] = 128 + dx * 220; img.data[i + 1] = 128 + dy * 220; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = B.own(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function water(B, pts, width, level) {
    const T = THREE, W = WL(), P = W.resample(pts, 4), pos = [], uv = [], idx = [];
    let v = 0;
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L, hw = width / 2;
      pos.push(p.x + nx * hw, level, p.z + nz * hw, p.x - nx * hw, level, p.z - nz * hw);
      if (i) v += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z);
      uv.push(0, v / 12, width / 12, v / 12);
      if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    });
    const g = B.own(new T.BufferGeometry());
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    const nt = waterTex(B);
    const mat = B.own(new T.MeshStandardMaterial({ color: 0x18200f, roughness: 0.08, metalness: 0.0, normalMap: nt, transparent: true, opacity: 0.93, envMapIntensity: 0.9 }));
    mat.normalScale.set(0.35, 0.35);
    const m = new T.Mesh(g, mat); m.receiveShadow = true; m.name = 'water';
    B.add(m);
    B.anim.push((dt, t) => { nt.offset.set(t * 0.01, -t * 0.045); });
    return m;
  }

  DH.WorldKit = { M, register, builder, terrain, sky, water, template, impostor, shared, tex };
  if (DH.Assets) register();
})();
