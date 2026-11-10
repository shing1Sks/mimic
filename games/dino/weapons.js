// Ironfern weapons (Stage C): carbine (AKM rig), marksman (M21/MK14, 4x scope), sidearm (Glock rig).
// The top half is pure (fire rate, ammo/reload, spread, damage falloff, recoil) and runs in Node
// (test/weapons.test.js). The browser half draws the viewmodel in its own scene after the world,
// fires rays through the crosshair into DH.Dinos / ctx.world, and drives recoil, sounds and effects.
(function (root) {
  'use strict';

  // ================================================================== pure logic
  const SPECS = {
    carbine: {
      id: 'carbine', name: 'Carbine', magSize: 30, reserve: 120, rpm: 600, auto: true, reloadTime: 2.5,
      damage: 34, falloff: { near: 40, far: 160, minFrac: 0.55 },
      spread: { base: 0.004, perShot: 0.0045, max: 0.035, recover: 0.06, adsMul: 0.45 },
      kick: { pitch: 0.011, yaw: 0.0045, climb: 0.6 }, shake: 0.12, zoom: 1.35,
    },
    marksman: {
      id: 'marksman', name: 'Marksman', magSize: 5, reserve: 25, interval: 1.1, auto: false, reloadTime: 2.6,
      damage: 150, falloff: { near: 150, far: 400, minFrac: 0.8 },
      spread: { base: 0.004, perShot: 0.01, max: 0.03, recover: 0.05, adsMul: 0.08 }, // the scope comes up by itself: a shot fired a beat early still flies true
      kick: { pitch: 0.05, yaw: 0.01, climb: 0 }, shake: 0.32, zoom: 4,
    },
    sidearm: {
      id: 'sidearm', name: 'Sidearm', magSize: 15, reserve: 60, rpm: 400, auto: false, reloadTime: 2.0,
      damage: 24, falloff: { near: 20, far: 80, minFrac: 0.5 },
      spread: { base: 0.007, perShot: 0.01, max: 0.04, recover: 0.08, adsMul: 0.55 },
      kick: { pitch: 0.02, yaw: 0.006, climb: 0.3 }, shake: 0.14, zoom: 1.15,
    },
  };
  const ORDER = ['carbine', 'marksman', 'sidearm'];
  const BUFFER = 0.12;      // a semi-auto press this close to ready is remembered
  const DRY_RELOAD = 0.3;   // dry click -> auto reload delay
  const BURST_GAP = 0.35;   // pause that resets the recoil pattern

  function fireInterval(spec) { return spec.interval || 60 / spec.rpm; }

  function createState(spec) {
    return {
      id: spec.id, name: spec.name, mag: spec.magSize, magSize: spec.magSize, reserve: spec.reserve,
      reloading: false, reloadT: 0, reloadElapsed: 0, spread: spec.spread.base,
      cooldown: 0, queued: false, autoReloadT: 0, shotIndex: 0, sinceShot: 99,
    };
  }

  /** Advance timers. trig = { pressed, held }. Returns 'reload' when an auto reload starts,
   * 'loaded' when a reload completes, else null. */
  function tick(s, spec, dt, trig) {
    let ev = null;
    const held = !!(trig && trig.held);
    s.cooldown -= dt;
    s.cooldown = held && spec.auto ? Math.max(s.cooldown, -dt) : Math.max(s.cooldown, 0);
    s.sinceShot += dt;
    if (s.sinceShot > BURST_GAP) s.shotIndex = 0;
    // bloom only settles once you ease off the trigger
    if (s.sinceShot > Math.min(0.25, fireInterval(spec) * 1.5)) s.spread = Math.max(spec.spread.base, s.spread - spec.spread.recover * dt);
    if (s.reloading) {
      s.reloadElapsed += dt;
      s.reloadT = Math.min(1, s.reloadElapsed / spec.reloadTime);
      if (s.reloadElapsed >= spec.reloadTime) {
        const n = Math.min(spec.magSize - s.mag, s.reserve);
        s.mag += n; s.reserve -= n;
        s.reloading = false; s.reloadT = 0; s.reloadElapsed = 0;
        ev = 'loaded';
      }
    } else if (s.mag === 0 && s.reserve > 0 && s.autoReloadT <= 0) {
      s.autoReloadT = DRY_RELOAD; // an empty gun always reloads itself (the phone may never send R)
    } else if (s.autoReloadT > 0) {
      s.autoReloadT -= dt;
      if (s.autoReloadT <= 0 && startReload(s, spec)) ev = 'reload';
    }
    return ev;
  }

  /** Pull the trigger. Returns 'fire', 'dry' (empty: click, auto reload follows) or null. */
  function tryFire(s, spec, trig) {
    if (s.reloading) { s.queued = false; return null; }
    const want = spec.auto ? trig.held || trig.pressed : trig.pressed || s.queued;
    if (!want) return null;
    if (s.mag <= 0) {
      s.queued = false;
      if (!trig.pressed) return null;
      if (s.reserve > 0 && s.autoReloadT <= 0) s.autoReloadT = DRY_RELOAD;
      return 'dry';
    }
    if (s.cooldown > 0) {
      if (!spec.auto && trig.pressed && s.cooldown <= BUFFER) s.queued = true;
      return null;
    }
    s.queued = false;
    s.mag--;
    if (s.mag === 0 && s.reserve > 0) s.autoReloadT = 0.25; // the phone may never send reload
    s.cooldown += fireInterval(spec);
    s.spread = Math.min(spec.spread.max, s.spread + spec.spread.perShot);
    s.shotIndex = s.sinceShot > BURST_GAP ? 1 : s.shotIndex + 1;
    s.sinceShot = 0;
    return 'fire';
  }

  function startReload(s, spec) {
    if (s.reloading || s.mag >= spec.magSize || s.reserve <= 0) return false;
    s.reloading = true; s.reloadElapsed = 0; s.reloadT = 0; s.autoReloadT = 0; s.queued = false;
    return true;
  }
  function cancelReload(s) { s.reloading = false; s.reloadElapsed = 0; s.reloadT = 0; }
  function refill(s, spec) { s.reserve = Math.max(s.reserve, spec.reserve); }

  /** Cone half-angle (rad) for this shot. mods: { ads, dodging } */
  function effectiveSpread(spec, spread, mods) {
    let a = spread;
    if (mods && mods.ads) a *= spec.spread.adsMul;
    if (mods && mods.dodging) a = a * 2 + 0.01;
    return a;
  }

  function damageAt(spec, dist) {
    const f = spec.falloff;
    if (dist <= f.near) return spec.damage;
    if (dist >= f.far) return spec.damage * f.minFrac;
    return spec.damage * (1 - (1 - f.minFrac) * (dist - f.near) / (f.far - f.near));
  }

  /** View kick for shot number i of a burst (0-based); rnd in [0,1). mods: { ads } -> { pitch, yaw } rad */
  function recoil(spec, i, rnd, mods) {
    const k = spec.kick, ads = mods && mods.ads ? 0.7 : 1;
    const pitch = k.pitch * (1 + k.climb * Math.min(1, i / 8)) * ads;
    const yaw = k.yaw * (0.7 * Math.sin(i * 0.9 + 0.5) + 0.6 * (rnd * 2 - 1)) * ads;
    return { pitch, yaw };
  }

  /** dir (unit {x,y,z}) jittered uniformly inside a cone of half-angle `angle`. u1, u2 in [0,1). */
  function spreadDir(dir, angle, u1, u2, out) {
    out = out || { x: 0, y: 0, z: 0 };
    const th = angle * Math.sqrt(u1), ph = 2 * Math.PI * u2;
    let ax = 0, ay = 1, az = 0;
    if (Math.abs(dir.y) > 0.99) { ax = 1; ay = 0; }
    // right = dir x a, up = right x dir
    let rx = dir.y * az - dir.z * ay, ry = dir.z * ax - dir.x * az, rz = dir.x * ay - dir.y * ax;
    const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * dir.z - rz * dir.y, uy = rz * dir.x - rx * dir.z, uz = rx * dir.y - ry * dir.x;
    const c = Math.cos(th), s = Math.sin(th), cp = Math.cos(ph) * s, sp = Math.sin(ph) * s;
    const x = dir.x * c + rx * cp + ux * sp, y = dir.y * c + ry * cp + uy * sp, z = dir.z * c + rz * cp + uz * sp;
    const l = Math.hypot(x, y, z);
    out.x = x / l; out.y = y / l; out.z = z / l;
    return out;
  }

  const Logic = { SPECS, ORDER, fireInterval, createState, tick, tryFire, startReload, cancelReload, refill, effectiveSpread, damageAt, recoil, spreadDir };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Logic; return; }

  // ================================================================== browser
  const DH = root.DH = root.DH || {};
  DH.WeaponLogic = Logic;
  const T = root.THREE;
  const A = DH.Assets;
  A.register('gun_akm', 'assets/guns/akm_rig.glb');
  A.register('gun_glock', 'assets/guns/glock_rig.glb');
  A.register('gun_m21', 'assets/guns/m21.glb');
  A.register('sky_hdr', 'assets/hdr/industrial_sunset_02_1k.hdr');
  for (const n of ['shot_carbine', 'shot_marksman', 'shot_sidearm', 'reload_carbine', 'reload_marksman', 'reload_sidearm', 'dry_click', 'shell_1', 'shell_2', 'shell_3']) {
    A.register('sfx_' + n, 'assets/sfx/' + n + '.ogg');
  }

  // Viewmodel placement (hip set back ~10% on 2026-11-10 so the gun covers less of the jungle), in the viewmodel camera's space (metres; -Z forward). `hip`/`ads` place the
  // gun's bounding-box centre; `len` is the gun's real length the model is scaled to.
  const VIEW = {
    carbine: {
      key: 'gun_akm', gun: /^AKM_model/, len: 0.88, rotY: Math.PI / 2,
      anims: { idle: 'Armature|Idle', shoot: 'Armature|Shoot', reload: 'Armature|Reload' },
      hip: [0.2, -0.245, -0.72], ads: [0, -0.118, -0.52], kickBack: 0.035, kickRot: 0.035, flash: 0.28,
      sound: 'sfx_shot_carbine', vol: 0.8, reloadSound: 'sfx_reload_carbine', reloadDelay: 0.35, bloodScale: 1,
    },
    marksman: {
      key: 'gun_m21', gun: null, len: 1.12, rotY: 0, procedural: true,
      hip: [0.18, -0.23, -0.8], ads: [0, -0.1, -0.4], kickBack: 0.09, kickRot: 0.12, flash: 0.4,
      sound: 'sfx_shot_marksman', vol: 0.95, reloadSound: 'sfx_reload_marksman', reloadDelay: 0.5, bloodScale: 1.8,
    },
    sidearm: {
      key: 'gun_glock', gun: /^Glock19/, len: 0.19, rotY: Math.PI / 2,
      anims: { idle: 'Armature|Idle', shoot: 'Armature|Shoot', reload: 'Armature|Reload', grip: 'Armature|Grip' },
      hip: [0.155, -0.18, -0.51], ads: [0, -0.072, -0.42], kickBack: 0.04, kickRot: 0.12, flash: 0.15,
      sound: 'sfx_shot_sidearm', vol: 0.75, reloadSound: 'sfx_reload_sidearm', reloadDelay: 0.15, bloodScale: 0.8,
    },
  };

  let ctx = null, ready = false;
  let vmScene = null, vmCamera = null;
  const guns = {};       // id -> { pivot, wrapper, mixer, actions, muzzle, ejector, mag, magHome, magDrop }
  let states = {};
  let slot = 0, pending = -1, switchPhase = 0; // 0 idle, 1 lowering, 2 raising
  let switchT = 0, adsT = 0, lowerAmt = 0, scopeOverlay = null;
  let kickZ = 0, kickR = 0, swayX = 0, swayY = 0, shootAnimT = 0, reloadSoundT = -1;
  const SWITCH_DOWN = 0.2, SWITCH_UP = 0.28;

  const W = DH.Weapons = {
    scoped: false, ads: 0, current: null, vm: null,
    init, reset, update, render, refill: refillAll,
    select(i) { if (i !== slot && i >= 0 && i < ORDER.length) beginSwitch(i); },
    get list() { return ORDER.map(id => states[id]); },
  };

  // ------------------------------------------------------------------ setup
  function init(c) {
    ctx = c;
    vmScene = new T.Scene();
    vmCamera = new T.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20);
    vmScene.add(vmCamera);
    const key = new T.DirectionalLight(0xfff0dc, 3.2); key.position.set(-1, 2, 1.2); vmScene.add(key);
    const rim = new T.DirectionalLight(0xbcd2ff, 0.9); rim.position.set(1.5, 0.6, -1); vmScene.add(rim);
    vmScene.add(new T.HemisphereLight(0xc8d8f0, 0x2a2618, 0.5));
    W.vm = { scene: vmScene, camera: vmCamera };
    scopeOverlay = document.getElementById('scope');
    if (scopeOverlay) buildScope(scopeOverlay);
    reset(c);
    DH.bus.on('assets:ready', onAssets);
  }

  function onAssets() {
    const hdr = A.get('sky_hdr');
    if (hdr && ctx.renderer) {
      const pm = new T.PMREMGenerator(ctx.renderer);
      vmScene.environment = pm.fromEquirectangular(hdr).texture;
      pm.dispose();
    }
    for (const id of ORDER) { try { buildGun(id); } catch (e) { console.error('[weapons] build', id, e); } }
    ready = true;
    showOnly(ORDER[slot]);
  }

  let glassMat = null;
  function tuneMaterial(m, rigged) {
    if (!m || !m.isMeshStandardMaterial) return;
    const n = m.name || '';
    if (/skin/i.test(n)) { m.metalness = 0; m.roughness = 0.55; }
    else if (/shirt|glove/i.test(n)) { m.metalness = 0; m.roughness = 0.85; }
    else if (/wood|bakelite|plastic|frame|mag/i.test(n)) { m.metalness = 0.05; m.roughness = 0.55; }
    else if (rigged) { m.metalness = 0.75; m.roughness = Math.max(0.32, m.roughness); }
    else { m.metalness = 0.35; m.roughness = 0.45; }
    m.envMapIntensity = 1.2;
  }

  const _v = new T.Vector3();
  function buildGun(id) {
    const cfg = VIEW[id], g = A.get(cfg.key);
    if (!g) { console.warn('[weapons] missing model', cfg.key); return; }
    const model = g.scene;
    const pivot = new T.Group(), wrapper = new T.Group();
    wrapper.add(model); pivot.add(wrapper);
    pivot.rotation.order = 'YXZ';
    let mixer = null; const actions = {};
    if (cfg.anims) {
      mixer = new T.AnimationMixer(model);
      for (const k in cfg.anims) {
        const clip = g.animations.find(a => a.name === cfg.anims[k]);
        if (clip) actions[k] = mixer.clipAction(clip);
      }
      if (actions.grip) { actions.grip.play(); }
      if (actions.idle) actions.idle.play();
      for (const k of ['shoot', 'reload']) if (actions[k]) { actions[k].setLoop(T.LoopOnce, 1); actions[k].clampWhenFinished = false; }
      mixer.update(0.001);
    }
    // the M21's flip-up lens covers stand open like dinner plates: drop them
    model.traverse(o => { if (/^Cover_Mount_(Front|Rear)$/.test(o.name)) o.visible = false; });
    model.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
        if (o.name === 'Glass') { // scope lens: dark coated glass, not a white disc
          o.material = glassMat = glassMat || new T.MeshStandardMaterial({ color: 0x07131a, metalness: 0.6, roughness: 0.04, envMapIntensity: 1.6 });
        } else (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => tuneMaterial(m, !!cfg.anims));
      }
    });
    // measure the gun (skinned vertices in the current pose) in wrapper-parent space
    wrapper.rotation.set(0, cfg.rotY, 0);
    const measure = () => {
      wrapper.updateMatrixWorld(true);
      const box = new T.Box3(), pts = [];
      model.traverse(o => {
        if (!o.isMesh || !o.visible || (o.parent && !o.parent.visible) || (cfg.gun && !cfg.gun.test(o.name) && !(o.parent && cfg.gun.test(o.parent.name)))) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) {
          _v.fromBufferAttribute(pos, i);
          if (o.isSkinnedMesh) o.boneTransform(i, _v);
          _v.applyMatrix4(o.matrixWorld);
          box.expandByPoint(_v); pts.push(_v.x, _v.y, _v.z);
        }
      });
      return { box, pts };
    };
    let m = measure();
    const size = m.box.getSize(new T.Vector3());
    const s = cfg.len / Math.max(1e-6, size.z);
    wrapper.scale.setScalar(s);
    m = measure();
    const c = m.box.getCenter(new T.Vector3());
    wrapper.position.copy(c).negate();
    m = measure();
    const b = m.box, len = b.max.z - b.min.z;
    // muzzle: average of the front-most 2% of the gun's points; ejector: right side of the receiver
    const mz = new T.Vector3(); let cnt = 0;
    for (let i = 0; i < m.pts.length; i += 3) if (m.pts[i + 2] < b.min.z + len * 0.02) { mz.x += m.pts[i]; mz.y += m.pts[i + 1]; mz.z += m.pts[i + 2]; cnt++; }
    mz.divideScalar(Math.max(1, cnt)); mz.z -= 0.01 + cfg.flash * 0.3; // flash centre sits just past the muzzle
    const ej = new T.Vector3(b.max.x * 0.6, b.max.y * 0.55, len * (id === 'sidearm' ? -0.05 : 0.08));
    const anchorParent = findBone(model, 'Root') || wrapper;
    anchorParent.updateWorldMatrix(true, false);
    const muzzle = new T.Object3D(), ejector = new T.Object3D();
    muzzle.position.copy(anchorParent.worldToLocal(mz.clone()));
    ejector.position.copy(anchorParent.worldToLocal(ej.clone()));
    anchorParent.add(muzzle); anchorParent.add(ejector);
    // marksman: magazine node for the procedural reload
    let mag = null, magHome = null, magDrop = null;
    if (cfg.procedural) {
      model.traverse(o => { if (!mag && /^Magazine$/.test(o.name)) mag = o; });
      if (mag) {
        magHome = mag.position.clone();
        mag.parent.updateWorldMatrix(true, false);
        mag.getWorldPosition(_v);
        const a = mag.parent.worldToLocal(_v.clone()), d = mag.parent.worldToLocal(_v.clone().add(new T.Vector3(0, -0.3, 0.05)));
        magDrop = d.sub(a);
      }
    }
    pivot.visible = false;
    vmScene.add(pivot);
    guns[id] = { pivot, wrapper, mixer, actions, muzzle, ejector, mag, magHome, magDrop, cfg, size: b.getSize(new T.Vector3()) };
  }
  function findBone(model, name) { let r = null; model.traverse(o => { if (!r && o.isBone && o.name === name) r = o; }); return r; }

  function buildScope(el) {
    el.innerHTML = '<div class="scope-lens"><svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<g stroke="#050605" fill="none">' +
      '<line x1="-100" y1="0" x2="-6" y2="0" stroke-width="2.4"/><line x1="6" y1="0" x2="100" y2="0" stroke-width="2.4"/>' +
      '<line x1="0" y1="6" x2="0" y2="100" stroke-width="2.4"/><line x1="0" y1="-100" x2="0" y2="-6" stroke-width="0.8"/>' +
      '<line x1="-100" y1="0" x2="-62" y2="0" stroke-width="5"/><line x1="62" y1="0" x2="100" y2="0" stroke-width="5"/><line x1="0" y1="62" x2="0" y2="100" stroke-width="5"/>' +
      [-48, -36, -24, -12, 12, 24, 36, 48].map(x => `<circle cx="${x}" cy="0" r="1.1" fill="#050605"/><circle cx="0" cy="${-x}" r="1.1" fill="#050605"/>`).join('') +
      '<line x1="-6" y1="0" x2="6" y2="0" stroke-width="0.5"/><line x1="0" y1="-6" x2="0" y2="6" stroke-width="0.5"/>' +
      '</g><circle cx="0" cy="0" r="0.9" fill="#e5483b"/></svg></div>';
  }

  // ------------------------------------------------------------------ state
  function reset(c) {
    ctx = c || ctx;
    states = {};
    ORDER.forEach(id => { states[id] = createState(SPECS[id]); });
    slot = 0; pending = -1; switchPhase = 2; switchT = 0;
    adsT = 0; W.ads = 0; kickZ = kickR = 0; reloadSoundT = -1;
    W.current = states[ORDER[slot]];
    setScoped(false);
    if (ctx) ctx.fovZoom = 1;
    if (ready) showOnly(ORDER[slot]);
  }
  function refillAll() { ORDER.forEach(id => refill(states[id], SPECS[id])); }

  function showOnly(id) { for (const k in guns) guns[k].pivot.visible = k === id; }

  function setScoped(on) {
    if (W.scoped === on) return;
    W.scoped = on;
    if (scopeOverlay) scopeOverlay.classList.toggle('on', on);
    if (ctx) ctx.fovZoom = on ? SPECS.marksman.zoom : 1;
  }

  function beginSwitch(i) {
    if (pending === i) return;
    pending = i;
    const st = W.current;
    if (st && st.reloading) cancelReload(st);
    reloadSoundT = -1;
    setScoped(false);
    // lowering starts from wherever a half-finished raise left the gun
    if (switchPhase !== 1) { switchT = switchPhase === 2 ? SWITCH_DOWN * (1 - switchT / SWITCH_UP) : 0; switchPhase = 1; }
  }

  function startReloadFx(id) {
    const g = guns[id];
    reloadSoundT = VIEW[id].reloadDelay;
    if (g && g.actions.reload) {
      const a = g.actions.reload;
      a.reset(); a.timeScale = a.getClip().duration / SPECS[id].reloadTime; a.play();
    }
    setScoped(false);
  }

  // ------------------------------------------------------------------ firing
  const _o = new T.Vector3(), _d = new T.Vector3(), _end = new T.Vector3(), _mz = new T.Vector3(), _ndc = new T.Vector3();
  const _ray = new T.Raycaster();
  function muzzleWorld(id, out) {
    // project the viewmodel muzzle to the screen, then put it on the main camera's ray at that pixel
    const g = guns[id];
    if (!g) return out.copy(ctx.camera.position);
    g.muzzle.getWorldPosition(_mz);
    const dist = _mz.length();
    _ndc.copy(_mz).project(vmCamera);
    _ray.setFromCamera(_ndc, ctx.camera);
    return out.copy(_ray.ray.origin).addScaledVector(_ray.ray.direction, dist);
  }

  function fire(id) {
    const spec = SPECS[id], cfg = VIEW[id], st = states[id], p = ctx.player;
    ctx.camera.updateMatrixWorld();
    const ray = ctx.aimRay();
    _o.copy(ray.origin);
    const ang = effectiveSpread(spec, st.spread, { ads: W.scoped || adsT > 0.6, dodging: p && p.dodgeT > 0 });
    spreadDir(ray.dir, ang, Math.random(), Math.random(), _d);
    DH.bus.emit('shot:fired', { weapon: id });

    const dh = DH.Dinos && DH.Dinos.raycast ? DH.Dinos.raycast(_o, _d, 400) : null;
    const wh = ctx.world && ctx.world.raycast ? ctx.world.raycast(_o, _d, 400) : null;
    const sp = DH.Dinos && DH.Dinos.shootSpit ? DH.Dinos.shootSpit(_o, _d, Math.min(dh ? dh.dist : 400, wh ? wh.dist : 400)) : null;
    const useDino = !sp && dh && (!wh || dh.dist <= wh.dist);
    if (sp) {
      _end.copy(sp.point);
      DH.bus.emit('shot:spit', { weapon: id, point: sp.point });
    } else if (useDino) {
      const dmg = damageAt(spec, dh.dist);
      const r = (DH.Dinos.damage && DH.Dinos.damage(dh.dino, dmg, dh.zone, _d.clone())) || {};
      _end.copy(dh.point);
      const d = dh.dino || {};
      const attach = d.root || d.object || d.obj || d.group || d.mesh || (d.isObject3D ? d : null);
      if (DH.Fx) DH.Fx.blood(dh.point, _d, cfg.bloodScale, attach);
      DH.bus.emit('shot:hit', { weapon: id, dino: dh.dino, zone: dh.zone, killed: !!r.killed, point: dh.point.clone(), damage: dmg });
    } else if (wh) {
      _end.copy(wh.point);
      nearMissCheck(id, wh.dist);
      if (DH.Fx) DH.Fx.impact(wh.point, wh.normal, wh.surface || 'dirt');
      DH.bus.emit('shot:miss', { weapon: id, point: wh.point.clone(), surface: wh.surface || 'dirt' });
    } else {
      nearMissCheck(id, 400);
      _end.copy(_o).addScaledVector(_d, 400);
      DH.bus.emit('shot:miss', { weapon: id, point: _end.clone() });
    }

    // feedback
    const g = guns[id];
    muzzleWorld(id, _mz);
    if (DH.Fx) {
      DH.Fx.muzzle(_mz, W.scoped ? null : g && g.muzzle, cfg.flash);
      if (id !== 'marksman' || Math.random() < 0.5) DH.Fx.tracer(_mz, _end);
      if (g && !W.scoped && id !== 'marksman') DH.Fx.shell(g.ejector, id);
    }
    if (DH.Audio) DH.Audio.play(cfg.sound, { volume: cfg.vol, rate: 0.95 + Math.random() * 0.1, echo: id === 'sidearm' ? 0.5 : 0.65, maxVoices: 8 });
    const k = recoil(spec, st.shotIndex - 1, Math.random(), { ads: W.scoped || adsT > 0.6 });
    ctx.addKick(k.pitch, k.yaw);
    ctx.addShake(spec.shake);
    kickZ += cfg.kickBack; kickR += cfg.kickRot;
    if (g && g.actions.shoot) { const a = g.actions.shoot; a.reset(); a.play(); shootAnimT = a.getClip().duration; }
    if (W.scoped && scopeOverlay) scopeOverlay.style.setProperty('--kick', '1');
  }

  function nearMissCheck(id, maxDist) {
    const nm = DH.Dinos && DH.Dinos.nearMiss ? DH.Dinos.nearMiss(_o, _d, maxDist + 2) : null;
    if (nm) DH.bus.emit('shot:near', { weapon: id, dino: nm });
  }

  // The marksman scopes in by itself once the aim settles (the phone has no AIM button): swing to
  // find the target in the wide view, hold steady, the scope comes up; a big swing drops it.
  let steadyT = 0;
  let rateS = 0;
  function autoScope(dt, f, sens) {
    // smoothed over ~0.15 s: the phone's motion arrives in bursty packets, one frame is not a swing
    const tu = f.turn && DH.Aim ? DH.Aim.turnU(f.turn, 0.9, 0.6, ctx.settings && ctx.settings.phoneSens) : { x: 0, y: 0 };
    const inst = ((Math.abs(f.dx) + Math.abs(f.dy)) * 0.0022 * (sens || 1) + Math.abs(tu.x) + Math.abs(tu.y)) / Math.max(dt, 1e-3); // half-screens / s
    rateS += (inst - rateS) * Math.min(1, dt * 7);
    const rate = rateS;
    if (W.scoped) { if (rate > 1.0) steadyT = -0.35; else steadyT = Math.max(steadyT, 0.4); } // a deliberate swing (~45 deg/s) drops it
    else steadyT = rate < 0.6 ? steadyT + dt : Math.min(steadyT, 0) + (rate < 1.2 ? dt * 0.3 : 0);
    if (steadyT < 0) steadyT = Math.min(0, steadyT + dt);
    return steadyT >= 0.3 && (W.scoped || somethingNearCrosshair());
  }
  /** Only scope in when there is an animal to scope at near the crosshair (not on an empty view). */
  const _sp = new T.Vector3();
  function somethingNearCrosshair() {
    if (!DH.Dinos || !ctx.crossNdc) return true;
    const cn = ctx.crossNdc();
    return DH.Dinos.list().some(d => {
      if (!d.alive || !d.root.visible || d.species === 'grazer') return false;
      _sp.copy(d.pos); _sp.y += d.inst.tpl.height * 0.5; _sp.project(ctx.camera);
      return _sp.z < 1 && Math.abs(_sp.x - cn.x) < 0.3 && Math.abs(_sp.y - cn.y) < 0.3;
    });
  }

  // ------------------------------------------------------------------ update
  function update(dt, c, f) {
    ctx = c;
    const p = c.player || {};
    // switching
    if (f.pressed.switch) beginSwitch(((pending >= 0 ? pending : slot) + 1) % ORDER.length);
    if (f.pressed.slot1) W.select(0); if (f.pressed.slot2) W.select(1); if (f.pressed.slot3) W.select(2);
    if (switchPhase === 1) {
      switchT += dt;
      if (switchT >= SWITCH_DOWN) {
        if (guns[ORDER[slot]] && guns[ORDER[slot]].actions.reload) guns[ORDER[slot]].actions.reload.stop();
        slot = pending; pending = -1; switchPhase = 2; switchT = 0;
        W.current = states[ORDER[slot]];
        if (ready) showOnly(ORDER[slot]);
      }
    } else if (switchPhase === 2) {
      switchT += dt;
      if (switchT >= SWITCH_UP) { switchPhase = 0; switchT = 0; }
    }
    const id = ORDER[slot], spec = SPECS[id], st = states[id];
    W.current = st;
    const ducking = !!p.ducking;
    const busy = switchPhase !== 0 || ducking;

    if (f.pressed.reload && !busy && startReload(st, spec)) startReloadFx(id);

    const trig = { pressed: !!f.pressed.fire && !busy, held: !!f.held.fire && !busy };
    const ev = tick(st, spec, dt, trig);
    if (ev === 'reload') startReloadFx(id);
    if (!busy) {
      for (let n = 0; n < 3; n++) {
        const r = tryFire(st, spec, trig);
        if (r === 'fire') fire(id);
        else { if (r === 'dry' && DH.Audio) DH.Audio.play('sfx_dry_click', { volume: 0.7 }); break; }
        trig.pressed = false;
      }
    }
    if (reloadSoundT >= 0) {
      reloadSoundT -= dt;
      if (reloadSoundT < 0) { reloadSoundT = -1; if (st.reloading && DH.Audio) DH.Audio.play(VIEW[id].reloadSound, { volume: 0.75 }); }
    }

    // aim down sights / scope
    const auto = id === 'marksman' && autoScope(dt, f, c.settings && c.settings.sens);
    const wantAim = (!!f.held.scope || auto) && !busy && !st.reloading;
    adsT = Math.max(0, Math.min(1, adsT + (wantAim ? dt / 0.16 : -dt / 0.12)));
    W.ads = adsT;
    if (id === 'marksman') {
      setScoped(wantAim && adsT >= 1);
      if (!W.scoped) ctx.fovZoom = 1; // no creeping pre-zoom: it slid an off-centre target out from under the crosshair
    } else {
      setScoped(false);
      ctx.fovZoom = 1 + (spec.zoom - 1) * adsT * adsT * (3 - 2 * adsT);
    }
    if (scopeOverlay && W.scoped) {
      const kk = parseFloat(scopeOverlay.style.getPropertyValue('--kick')) || 0;
      if (kk > 0) scopeOverlay.style.setProperty('--kick', Math.max(0, kk - dt * 5).toFixed(3));
    }
    animateViewmodel(dt, c, f, id, st, ducking);
  }

  function animateViewmodel(dt, c, f, id, st, ducking) {
    const g = guns[id];
    if (!g) return;
    const cfg = VIEW[id], p = c.player || {}, t = c.time;
    if (g.mixer) {
      if (shootAnimT > 0) shootAnimT -= dt;
      const busyAnim = shootAnimT > 0 || st.reloading;
      if (g.actions.idle) {
        const w = g.actions.idle.getEffectiveWeight();
        g.actions.idle.setEffectiveWeight(busyAnim ? 0 : Math.min(1, w + dt * 4));
      }
      if (!st.reloading && g.actions.reload && g.actions.reload.isRunning()) g.actions.reload.stop();
      g.mixer.update(dt);
    }
    // springs
    const kd = Math.exp(-dt * 13);
    kickZ *= kd; kickR *= Math.exp(-dt * 10);
    swayX += (Math.max(-0.03, Math.min(0.03, -f.dx * 0.00022)) - swayX) * Math.min(1, dt * 8);
    swayY += (Math.max(-0.03, Math.min(0.03, f.dy * 0.00022)) - swayY) * Math.min(1, dt * 8);
    const lowerTarget = ducking ? 1 : 0;
    lowerAmt += (lowerTarget - lowerAmt) * Math.min(1, dt * 9);
    let sw = 0;
    if (switchPhase === 1) sw = Math.min(1, switchT / SWITCH_DOWN);
    else if (switchPhase === 2) sw = 1 - Math.min(1, switchT / SWITCH_UP);
    const sw2 = sw * sw * (3 - 2 * sw);
    const low = Math.max(lowerAmt, sw2);

    // crosshair direction in the viewmodel camera: the gun points where you aim
    const n = c.crossNdc ? c.crossNdc() : { x: 0, y: 0 };
    const th = Math.tan(T.MathUtils.degToRad(vmCamera.fov / 2));
    const cx = n.x * th * vmCamera.aspect, cy = n.y * th;
    const a = adsT * adsT * (3 - 2 * adsT);
    const hip = cfg.hip, ads = cfg.ads;
    const pv = g.pivot;
    // ads: put the sight line on the crosshair ray
    const az = ads[2];
    const adsX = cx * -az + ads[0], adsY = cy * -az + ads[1];
    const hipX = hip[0] + n.x * 0.09, hipY = hip[1] + n.y * 0.06;
    const breath = 1 - a * 0.7;
    pv.position.set(
      hipX + (adsX - hipX) * a + swayX * breath + Math.sin(t * 0.9) * 0.0025 * breath,
      hipY + (adsY - hipY) * a + swayY * breath + Math.sin(t * 1.7) * 0.003 * breath - low * 0.32,
      hip[2] + (az - hip[2]) * a + kickZ);
    // aim at a point 40 m down the crosshair ray
    const tx = cx * 40, ty = cy * 40, tz = -40;
    const dx = tx - pv.position.x, dy = ty - pv.position.y, dz = tz - pv.position.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const dk = p.dodgeT > 0 && DH.Player ? Math.sin(Math.PI * (1 - p.dodgeT / DH.Player.DODGE_WINDOW)) * (p.dodgeDir || 1) : 0;
    let rx = pitch + kickR - low * 0.9, rz = -dk * 0.35 + swayX * 2, ry = yaw;
    if (cfg.procedural) {
      // bolt cycle after a shot, and a tilt-and-swap reload with the mag dropping out
      const since = st.sinceShot;
      if (since < 1.0 && !st.reloading) { const b = Math.sin(Math.min(1, Math.max(0, (since - 0.25) / 0.6)) * Math.PI); rz += b * 0.22; rx -= b * 0.05; }
      if (st.reloading) {
        const r = st.reloadT, tilt = Math.sin(Math.min(1, r * 1.25) * Math.PI);
        rz += tilt * 0.55; rx -= tilt * 0.25; pv.position.y -= tilt * 0.06;
        if (g.mag) {
          // out by 35%, new mag in from 50% to 80%
          let o = 0;
          if (r < 0.35) o = r / 0.35; else if (r < 0.5) o = 1; else if (r < 0.8) o = 1 - (r - 0.5) / 0.3; else o = 0;
          g.mag.position.copy(g.magHome).addScaledVector(g.magDrop, o);
          g.mag.visible = !(r > 0.34 && r < 0.5);
        }
      } else if (g.mag) { g.mag.position.copy(g.magHome); g.mag.visible = true; }
    }
    pv.rotation.set(rx, ry, rz);
  }

  // ------------------------------------------------------------------ render
  function render(renderer) {
    if (!ready || W.scoped) return;
    const el = renderer.domElement, asp = el.width / Math.max(1, el.height);
    if (Math.abs(vmCamera.aspect - asp) > 1e-3) { vmCamera.aspect = asp; vmCamera.updateProjectionMatrix(); }
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
})(typeof window !== 'undefined' ? window : this);
