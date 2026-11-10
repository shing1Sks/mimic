// Ironfern core: renderer, camera at the current stand, input, the shared context and the
// screen state machine. Stages plug in through DH.World / DH.Dinos / DH.Weapons / DH.Fx /
// DH.Audio / DH.Missions / DH.Hud.
(function () {
  'use strict';
  const T = THREE, DH = window.DH;
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------------ events
  const handlers = {};
  DH.bus = {
    on(e, f) { (handlers[e] = handlers[e] || []).push(f); return f; },
    off(e, f) { handlers[e] = (handlers[e] || []).filter(x => x !== f); },
    emit(e, d) { (handlers[e] || []).slice().forEach(f => { try { f(d); } catch (err) { console.error('[bus]', e, err); } }); },
  };

  // ------------------------------------------------------------------ renderer
  const canvas = $('gl');
  // The world is drawn into a multisampled HDR target and copied to the screen (tone mapping on the
  // copy). Drawing into a smaller corner of that target is how the resolution scales on the fly:
  // resizing the real canvas stalls the GPU for a second or more on a laptop.
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // Never render above one pixel per CSS pixel (a 1.5x laptop screen would cost 2.25x the fill), and
  // let the governor (signs.js) trade resolution for frame rate on a weak GPU.
  const BASE_PR = Math.min(1, devicePixelRatio || 1);
  let gov = DH.Signs.governor({ min: 0.6, max: 1 });
  renderer.setPixelRatio(BASE_PR);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  // The sun's shadow map is drawn only when something asks (ctx.shadowDirty): the world is static and
  // the animals wear soft contact shadows instead, so the whole jungle is not re-drawn every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 900);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // ------------------------------------------------------------------ input
  // Mouse + keyboard here; the phone (Mimic Grip or Wand) arrives as a motion controller through
  // MimicController and is merged into the same per-frame snapshot (see phone below).
  const BIND = {
    fire: ['Mouse0'], scope: ['Mouse2'], reload: ['KeyR'], dodge: ['Space'], duck: ['ControlLeft', 'ControlRight', 'KeyC'],
    switch: ['KeyQ', 'WheelDown', 'WheelUp'], slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'],
    pause: ['Escape', 'KeyP'], confirm: ['Enter', 'Mouse0'],
    align: ['KeyV'],
  };
  // Phone buttons (Grip: Vol Down = a held, Vol Up tap = b, double = one, flick = two, CENTRE or
  // hold Vol Up = center), see docs/controller-contract.md
  const PHONE = { fire: 'a', confirm: 'a', reload: 'b', switch: 'one', dodge: 'two', align: 'center' };
  // Pause from the phone: keep holding Vol Up (or CENTRE) after it aligns. The contract has no free
  // button, so it rides on the held `center` bit: the align it starts with is undone on pause.
  const PAUSE_HOLD = 1.2; // s of `center` held (Vol Up: ~0.6 s to align + this)
  const held = {}, pressedCodes = {};
  let mdx = 0, mdy = 0;
  const down = c => { if (!held[c]) pressedCodes[c] = true; held[c] = true; };
  const up = c => { held[c] = false; };
  addEventListener('keydown', e => { if (/^(Space|Tab|Arrow)/.test(e.code) || e.ctrlKey) e.preventDefault(); down(e.code); });
  addEventListener('keyup', e => up(e.code));
  addEventListener('mousedown', e => { down('Mouse' + e.button); });
  addEventListener('mouseup', e => up('Mouse' + e.button));
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => { pressedCodes[e.deltaY > 0 ? 'WheelDown' : 'WheelUp'] = true; }, { passive: true });
  addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
  addEventListener('blur', () => { for (const k in held) held[k] = false; });
  const Input = {
    locked: () => document.pointerLockElement === canvas,
    lock() { if (!Input.locked()) { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } },
    unlock() { if (Input.locked()) document.exitPointerLock(); },
    /** Snapshot for this frame: { dx, dy (mouse counts), turn: { x, y } (rad of phone turn, right /
     * down +), phone (a phone is sending), held: {action}, pressed: {action} }. */
    frame() {
      const f = { dx: mdx, dy: mdy, turn: { x: 0, y: 0 }, phone: false, held: {}, pressed: {}, centerHeld: false };
      for (const a in BIND) { f.held[a] = BIND[a].some(c => held[c]); f.pressed[a] = BIND[a].some(c => pressedCodes[c]); }
      mdx = mdy = 0; for (const k in pressedCodes) delete pressedCodes[k];
      phone.read(f);
      return f;
    },
    BIND, PHONE,
  };

  // The phone: aim is the change in where it points since last frame, applied 1:1 (Aim.step), so
  // it adds to the mouse and stays exact after an align. Raw: no smoothing, no assist.
  const mc = typeof MimicController === 'function' ? new MimicController() : null;
  const phone = {
    mc, last: null, settle: 0, fireLock: false,
    get connected() { return !!(mc && mc.connected && mc.source === 'phone'); },
    read(f) {
      if (!mc) return;
      mc.update();
      if (!phone.connected) { phone.last = null; return; }
      f.phone = true;
      // CENTRE / hold Vol Up re-zeroes the phone's heading in the app: that jump is not a turn
      if (mc.isDown('center') || mc.released('center')) phone.settle = 3;
      f.centerHeld = mc.isDown('center');
      const now = { yaw: mc.yaw, pitch: mc.pitch };
      if (phone.last && phone.settle === 0) {
        let dyaw = now.yaw - phone.last.yaw;
        if (dyaw > Math.PI) dyaw -= 2 * Math.PI; else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
        const dp = now.pitch - phone.last.pitch;
        // more than ~35 deg in one frame is a reconnect or a re-centre, not a hand
        if (Math.abs(dyaw) < 0.6 && Math.abs(dp) < 0.6) { f.turn.x = -dyaw; f.turn.y = -dp; }
      }
      phone.settle = Math.max(0, phone.settle - 1);
      phone.last = now;
      // a held Vol Down that started a mission does not fire until it is let go once
      if (phone.fireLock && !mc.isDown('a')) phone.fireLock = false;
      for (const a in PHONE) {
        const b = PHONE[a];
        if (a === 'fire' && phone.fireLock) continue;
        f.held[a] = f.held[a] || mc.isDown(b);
        f.pressed[a] = f.pressed[a] || mc.pressed(b);
      }
    },
  };
  Input.phone = phone;
  DH.Input = Input;

  // ------------------------------------------------------------------ shared context
  const savedSettings = (() => { try { return JSON.parse(localStorage.getItem('ironfern.settings') || '{}'); } catch (e) { return {}; } })();
  // sens: mouse; phoneSens: phone turn -> aim turn (1 = the crosshair turns exactly as far as the phone)
  const settings = Object.assign({ sens: 1, phoneSens: 1, volume: 0.9, quality: 1, invertY: false }, savedSettings);
  // an integrated laptop GPU gets a lighter jungle unless the player chose otherwise (?quality=1 forces full)
  if (savedSettings.quality == null) {
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      if (/Intel|Iris|UHD|HD Graphics|Mali|Adreno|PowerVR|Apple GPU/i.test(name)) settings.quality = 0.75;
    } catch (e) { /* keep 1 */ }
  }
  { const qq = new URLSearchParams(location.search).get('quality'); if (qq) settings.quality = Math.max(0.5, Math.min(1, +qq || 1)); }
  const ctx = {
    T, scene, camera, renderer, settings, input: Input, bus: DH.bus,
    time: 0, dt: 0, state: 'loading', missionId: null,
    world: null, player: DH.Player.create(),
    /** Where the camera stands and how far it may turn: missions.js sets this. */
    view: { pos: new T.Vector3(0, 1.7, 0), stand: { yaw: 0, pitch: 0, arc: 1.2, pitchMin: -0.5, pitchMax: 0.4 } },
    aim: DH.Aim.create({ yaw: 0 }),
    shake: 0, kick: { pitch: 0, yaw: 0 }, fovZoom: 1, shadowDirty: true,
    /** Ray through the crosshair: { origin: Vector3, dir: Vector3 } (world). */
    aimRay() {
      const n = ctx.crossNdc();
      _ray.setFromCamera(new T.Vector2(n.x, n.y), camera);
      return { origin: _ray.ray.origin.clone(), dir: _ray.ray.direction.clone() };
    },
    /** Where the crosshair is on screen (NDC, y up). The aim is linear in angle (the phone's turn),
     * so the crosshair sits where that angle projects: this keeps the scope, which looks along the
     * same angle, exactly on what the crosshair was on (no jump when it comes up). */
    crossNdc() {
      const a = ctx.aim, hfy = 35 * Math.PI / 180, hfx = Math.atan(Math.tan(hfy) * camera.aspect);
      return { x: Math.tan(a.cx * hfx) / Math.tan(hfx), y: -Math.tan(a.cy * hfy) / Math.tan(hfy) };
    },
    /** Apply an attack to the player (dodge/duck rules in player.js); emits player:* events. */
    strike(s) {
      const r = DH.Player.strike(ctx.player, s);
      DH.bus.emit(r.result === 'hit' ? 'player:hurt' : 'player:' + r.result, Object.assign({ hp: ctx.player.hp }, s));
      if (r.dead) DH.bus.emit('player:dead', s);
      return r;
    },
    addShake(a) { ctx.shake = Math.min(1.5, ctx.shake + a); },
    addKick(pitch, yaw) { ctx.kick.pitch += pitch; ctx.kick.yaw += yaw; },
  };
  const _ray = new T.Raycaster();
  DH.ctx = ctx;
  window.__dh = ctx; // automated checks

  // ------------------------------------------------------------------ states
  const call = (mod, fn, ...a) => { const m = DH[mod]; if (m && typeof m[fn] === 'function') return m[fn](...a); };
  const Core = DH.Core = {
    /** title | select | briefing | play | pause | results */
    go(state, data) {
      const prev = ctx.state; ctx.state = state;
      if (state === 'play') {
        // with a phone the mouse is not needed; pointer lock still helps the mouse, where allowed
        Input.lock(); call('Audio', 'resume');
        if (phone.connected && mc.isDown('a')) phone.fireLock = true;
      } else if (state !== 'loading') Input.unlock();
      call('Hud', 'showScreen', state, data, prev);
      DH.bus.emit('state', { state, prev, data });
    },
    /** Build the mission's world and start its briefing. */
    async startMission(id) {
      ctx.missionId = id;
      ctx.player = DH.Player.create();
      call('Hud', 'showScreen', 'loading', { text: 'Entering the island…' });
      if (ctx.world && ctx.world.dispose) ctx.world.dispose();
      ctx.world = DH.World && typeof DH.World.build === 'function' ? await DH.World.build(ctx, id) : null;
      call('Dinos', 'reset', ctx); call('Fx', 'reset', ctx); call('Weapons', 'reset', ctx);
      call('Missions', 'start', id, ctx);
      ctx.aim = DH.Aim.create(ctx.view.stand);
      prewarm(id);
      ctx.shadowDirty = true;
      Core.go('briefing', { id });
    },
    ctx,
  };
  /** Compile every shader the mission will need now (animals, effects, the guns): on a laptop GPU a
   * first-use compile freezes the game for up to seconds, right when something attacks. */
  function prewarm(id) {
    try {
      const M = DH.Missions && DH.Missions.MISSIONS[id], sp = new Set();
      if (M) M.plan.forEach(st => (st.phases || []).concat(st.ambush || []).forEach(ph => (ph.waves || [ph]).forEach(w => (w.spawns || []).forEach(e => sp.add(e.species)))));
      if (sp.has('dilo')) sp.add('raptor');
      const roots = DH.Dinos && DH.Dinos.prewarmRoots ? DH.Dinos.prewarmRoots([...sp]) : [];
      camera.updateMatrixWorld();
      const ahead = new T.Vector3(0, -0.5, -9).applyMatrix4(camera.matrixWorld);
      roots.forEach((r, i) => { r.position.copy(ahead).add(new T.Vector3((i % 5 - 2) * 3, 0, 0)); scene.add(r); });
      // compile, then really draw once into a small target: ANGLE (D3D11) builds the GPU shader at
      // the first draw, which otherwise freezes the game the first time each animal appears
      const rt = new T.WebGLRenderTarget(96, 54, { samples: settings.quality >= 1 ? 4 : 0, type: T.HalfFloatType });
      const compileAll = (sc, cam, target) => {
        const hidden = []; sc.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
        renderer.compile(sc, cam);
        renderer.setRenderTarget(target); renderer.render(sc, cam); renderer.setRenderTarget(null);
        hidden.forEach(o => { o.visible = false; });
      };
      renderer.shadowMap.needsUpdate = true;
      compileAll(scene, camera, rt);
      roots.forEach(r => scene.remove(r));
      if (DH.Weapons && DH.Weapons.vm) compileAll(DH.Weapons.vm.scene, DH.Weapons.vm.camera, null); // the guns draw straight to the screen
      rt.dispose();
    } catch (e) { console.warn('[core] prewarm', e); }
  }
  document.addEventListener('pointerlockchange', () => { if (!Input.locked() && ctx.state === 'play') Core.go('pause'); });

  // ------------------------------------------------------------------ camera
  const _dodge = new T.Vector3();
  function updateCamera(dt, f) {
    const p = ctx.player, st = ctx.view.stand;
    const scoped = !!(DH.Weapons && DH.Weapons.scoped);
    // the aim maps the phone's total turn to the view, so it needs the real (unzoomed) field of view
    const hfy = 70 / 2 * Math.PI / 180, hfx = Math.atan(Math.tan(hfy) * camera.aspect);
    ctx.aim = DH.Aim.step(ctx.aim, f.dx, settings.invertY ? -f.dy : f.dy, dt, st, { sens: settings.sens, scoped, hfx, hfy, turn: f.turn, phoneSens: settings.phoneSens });
    // recoil kick recovers; shake decays
    const kr = Math.exp(-dt * 9);
    ctx.kick.pitch *= kr; ctx.kick.yaw *= kr;
    ctx.shake = Math.max(0, ctx.shake - dt * 2.2);
    const sh = ctx.shake * ctx.shake * 0.03, t = ctx.time;
    camera.rotation.set(ctx.aim.pitch + ctx.kick.pitch + sh * Math.sin(t * 61), ctx.aim.yaw + ctx.kick.yaw + sh * Math.sin(t * 47 + 1), sh * 0.5 * Math.sin(t * 53));
    // dodge: a quick sidestep and back; duck: drop behind cover
    const dk = p.dodgeT > 0 ? Math.sin(Math.PI * (1 - p.dodgeT / DH.Player.DODGE_WINDOW)) : 0;
    _dodge.set(Math.cos(ctx.aim.yaw), 0, -Math.sin(ctx.aim.yaw)).multiplyScalar(dk * 0.9 * p.dodgeDir);
    const duckY = p.duckAmt = (p.duckAmt || 0) + ((p.ducking ? 1 : 0) - (p.duckAmt || 0)) * Math.min(1, dt * 10);
    camera.position.copy(ctx.view.pos).add(_dodge); camera.position.y -= duckY * 0.75;
    const fov = 70 / (ctx.fovZoom || 1);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ scaled world pass
  const _sz = new T.Vector2();
  let worldRT = null;
  const blit = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
    uniforms: { tMap: { value: null }, uScale: { value: new T.Vector2(1, 1) }, uMax: { value: new T.Vector2(1, 1) }, uTexel: { value: new T.Vector2(1, 1) }, uFxaa: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // FXAA (3.11 "lite") on the copy when the target is not multisampled: MSAA costs ~10 ms a frame
    // on an Iris Xe with this much alpha-tested foliage, FXAA well under 1 ms
    fragmentShader: `uniform sampler2D tMap; uniform vec2 uScale, uMax, uTexel; uniform float uFxaa; varying vec2 vUv;
      vec3 tap(vec2 uv) { return texture2D(tMap, min(uv, uMax)).rgb; }
      float lum(vec3 c) { c = c / (1.0 + c); return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        vec2 uv = vUv * uScale;
        vec3 col = tap(uv);
        if (uFxaa > 0.5) {
          vec3 nw = tap(uv + vec2(-1.0, -1.0) * uTexel), ne = tap(uv + vec2(1.0, -1.0) * uTexel);
          vec3 sw = tap(uv + vec2(-1.0, 1.0) * uTexel), se = tap(uv + vec2(1.0, 1.0) * uTexel);
          float lNW = lum(nw), lNE = lum(ne), lSW = lum(sw), lSE = lum(se), lM = lum(col);
          float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
          float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
          float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
          vec3 a = 0.5 * (tap(uv + dir * (1.0 / 3.0 - 0.5)) + tap(uv + dir * (2.0 / 3.0 - 0.5)));
          vec3 bb = a * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));
          float lB = lum(bb);
          col = (lB < lMin || lB > lMax) ? a : bb;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: true,
  }));
  blit.frustumCulled = false;
  const blitScene = new T.Scene(), blitCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitScene.add(blit);
  function drawWorld(scale) {
    renderer.getDrawingBufferSize(_sz);
    if (!worldRT || worldRT.width !== _sz.x || worldRT.height !== _sz.y) {
      if (worldRT) worldRT.dispose();
      worldRT = new T.WebGLRenderTarget(_sz.x, _sz.y, { samples: settings.quality >= 1 ? 4 : 0, type: T.HalfFloatType });
    }
    const w = Math.max(1, Math.round(_sz.x * scale)), h = Math.max(1, Math.round(_sz.y * scale));
    worldRT.viewport.set(0, 0, w, h); worldRT.scissor.set(0, 0, w, h); worldRT.scissorTest = true;
    renderer.setRenderTarget(worldRT); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const u = blit.material.uniforms;
    u.tMap.value = worldRT.texture; u.uScale.value.set(w / _sz.x, h / _sz.y); u.uMax.value.set((w - 0.5) / _sz.x, (h - 0.5) / _sz.y);
    u.uTexel.value.set(1 / _sz.x, 1 / _sz.y); u.uFxaa.value = worldRT.samples ? 0 : 1;
    renderer.clear(); renderer.render(blitScene, blitCam);
  }

  // Last resort after the resolution governor: still under ~40 fps at its lowest scale for 12 s of
  // play at Full quality, the next mission loads Light (said once in the feed; Settings can undo it).
  // A GPU that copes never gets here, so Full stays Full where it runs.
  let slowT = 0;
  function autoLight(dt) {
    if ((settings.quality || 1) < 1 || settings.qualityLocked) return;
    slowT = gov.scale <= gov.min + 1e-6 && gov.ema > 1 / 40 ? slowT + dt : Math.max(0, slowT - dt * 2);
    if (slowT < 12) return;
    settings.quality = 0.75; slowT = 0;
    try { localStorage.setItem('ironfern.settings', JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    DH.bus.emit('mission:feed', { text: 'Graphics set to Light from the next mission (Settings to change)', kind: 'info' });
  }

  // ------------------------------------------------------------------ loop
  const MENUS = { title: 1, select: 1, briefing: 1, pause: 1, results: 1, settings: 1 };
  // the phone's long Vol Up hold: how long `center` has been held, and the aim before its align
  const hold = { t: 0, preAlign: null, latch: false };
  // the last attack: a dodge steps away from the animal that is attacking (cosmetic: any dodge in
  // the window counts), instead of alternating sides
  let lastAttack = null;
  DH.bus.on('dino:attack', d => { if (d && d.dino && d.dino.pos) lastAttack = { pos: d.dino.pos.clone(), t: ctx.time }; });
  function dodgeAway() {
    const p = ctx.player;
    if (!lastAttack || ctx.time - lastAttack.t > 4) return;
    const dx = lastAttack.pos.x - camera.position.x, dz = lastAttack.pos.z - camera.position.z;
    const side = dx * Math.cos(ctx.aim.yaw) - dz * Math.sin(ctx.aim.yaw); // + = to the right
    if (Math.abs(side) > 0.3) p.dodgeDir = side > 0 ? -1 : 1;
  }
  const cursor = mc && window.MimicCursor ? MimicCursor.create(mc, { visible: () => !!MENUS[ctx.state] }) : null;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.dt = dt; ctx.time += dt;
    const f = Input.frame();
    if (ctx.state === 'play') {
      hold.t = f.centerHeld ? hold.t + dt : 0;
      if (!f.centerHeld) hold.latch = false;
      if (f.pressed.pause) { Core.go('pause'); }
      else if (hold.t >= PAUSE_HOLD && !hold.latch) {
        hold.latch = true;
        if (hold.preAlign) ctx.aim = hold.preAlign; // the hold meant pause, not align
        Core.go('pause');
      } else {
        if (f.pressed.align) { hold.preAlign = ctx.aim; ctx.aim = DH.Aim.align(ctx.aim, ctx.view.stand); DH.bus.emit('aim:aligned', {}); }
        ctx.player.ducking = f.held.duck;
        if (f.pressed.dodge && DH.Player.dodge(ctx.player, ctx.time)) { dodgeAway(); DH.bus.emit('player:dodge', {}); }
        DH.Player.tick(ctx.player, dt);
        updateCamera(dt, f);
        call('Missions', 'update', dt, ctx, f);
        call('Dinos', 'update', dt, ctx);
        call('Weapons', 'update', dt, ctx, f);
      }
    } else if (MENUS[ctx.state]) {
      // menus with the phone: point and press Vol Down (a) on a button (wandcursor.js); Vol Down
      // anywhere on the title / briefing moves on; Vol Up tap (b) backs out or resumes
      const clicked = cursor ? cursor.update() : false;
      if (ctx.state === 'pause') {
        if (f.pressed.pause || f.pressed.reload) Core.go('play');
      } else if (f.pressed.reload) {
        const back = { select: 'title', briefing: 'select', results: 'select', settings: 'select' }[ctx.state];
        if (back) Core.go(back);
      } else if (f.phone && !clicked && f.pressed.confirm) {
        const next = { title: 'select', briefing: 'play' }[ctx.state];
        if (next) Core.go(next);
      }
    }
    if (cursor && !MENUS[ctx.state]) cursor.update();   // hides it
    call('Hud', 'update', dt, ctx, f);
    if (ctx.world && ctx.world.update) ctx.world.update(dt, ctx);
    call('Fx', 'update', dt, ctx);
    call('Audio', 'update', dt, ctx);
    if (ctx.shadowDirty) { renderer.shadowMap.needsUpdate = true; ctx.shadowDirty = false; }
    if (ctx.state === 'play') { gov = DH.Signs.govern(gov, dt, now / 1000); ctx.renderScale = gov.scale; autoLight(dt); }
    drawWorld(ctx.state === 'play' ? gov.scale : 1);
    if (ctx.state === 'play' || ctx.state === 'pause') call('Weapons', 'render', renderer, ctx);
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    ['Audio', 'Fx', 'Dinos', 'Weapons', 'Missions', 'Hud'].forEach(m => call(m, 'init', ctx));
    await DH.Assets.load((done, total) => {
      $('loadbar').style.width = Math.round(100 * done / Math.max(1, total)) + '%';
      $('loadtext').textContent = `Loading ${done} / ${total}`;
    });
    DH.bus.emit('assets:ready', ctx);
    const q = new URLSearchParams(location.search);
    if (q.get('mission')) await Core.startMission(q.get('mission'));
    else Core.go('title');
    requestAnimationFrame(frame);
  }
  addEventListener('mousedown', () => call('Audio', 'resume'));
  addEventListener('keydown', () => call('Audio', 'resume'));
  boot();
})();
