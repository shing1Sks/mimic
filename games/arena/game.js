/*
 * Duskwater - main: renderer, player controllers, weapons, rounds and economy, HUD, menus.
 *
 * One to four human players. Each has a "view" (ph): an actor, a camera, a first-person view
 * model, an input source and a HUD laid over that player's part of the screen. Solo play is one
 * view filling the screen; split screen tiles the views with scissored viewports (split.js has
 * the layout, lobby and quality rules).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ loading

  // Everything (models, textures, HDRI, sounds) loads behind the splash bar; any asset that fails
  // comes back null and the game falls back to its procedural version of that thing.
  const loadBar = document.getElementById('loadbar');
  const setLoad = (f, txt) => {
    if (!loadBar) return;
    loadBar.querySelector('i').style.width = Math.round(f * 100) + '%';
    loadBar.querySelector('span').textContent = txt;
  };
  setLoad(0, 'Loading the depot');
  ArenaAssets.load((f, n, total) => setLoad(f, `Loading the depot  ${n}/${total}`))
    .catch(e => { console.warn('Duskwater: assets failed, using procedural fallbacks', e); return null; })
    .then(assets => {
      document.body.classList.add('loaded');
      boot(assets);
    });

  function boot(ASSETS) {
    const T = THREE, I = ArenaInput, R = ArenaRules, M = ArenaMap, A = ArenaActors, FX = ArenaFx, SP = ArenaSplit;
    const $ = id => document.getElementById(id);
    const DEG = Math.PI / 180;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const wrap = A.wrap;
    // player colours: the badge on each view, the lobby card, the tag over a teammate's head
    const PCOL = ['#ffae57', '#7fd4ff', '#a6e57f', '#e58fd8'];

    // ------------------------------------------------------------ settings

    const OPTIONS = [
      { key: 'lookSens', label: 'Stick look speed', min: 0.3, max: 2.5, step: 0.05, def: 1, fmt: v => v.toFixed(2) + 'x' },
      { key: 'deadzone', label: 'Stick dead zone', min: 0, max: 0.35, step: 0.01, def: 0.12, fmt: v => Math.round(v * 100) + '%' },
      { key: 'curve', label: 'Stick response curve', min: 1, max: 3, step: 0.1, def: 1.8, fmt: v => v.toFixed(1) },
      { key: 'accel', label: 'Look acceleration', type: 'toggle', def: true },
      { key: 'aimAssist', label: 'Aim assist (pad only)', type: 'toggle', def: false },
      { key: 'invertY', label: 'Invert Y', type: 'toggle', def: false },
      { key: 'mouseSens', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, def: 1, fmt: v => v.toFixed(2) + 'x' },
      { key: 'fov', label: 'Field of view', min: 75, max: 105, step: 1, def: 90, fmt: v => v + '°' },
      { key: 'renderScale', label: 'Render scale', min: 0.5, max: 1.5, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
      { key: 'split2', label: 'Two-player split', type: 'choice', values: ['h', 'v'], names: { h: 'Top / bottom', v: 'Side by side' }, def: 'h' },
      { key: 'autoRes', label: 'Auto resolution', type: 'toggle', def: true },
      { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, def: 0.8, fmt: v => Math.round(v * 100) + '%' },
      { key: 'showFps', label: 'Show frame rate', type: 'toggle', def: false },
    ];
    const S = {};
    OPTIONS.forEach(o => { S[o.key] = o.def; });
    S.mode = 'squad'; S.diff = 'regular'; S.toWin = 5; S.splitMode = 'coop'; S.splitFill = true;
    try { Object.assign(S, JSON.parse(localStorage.getItem('duskwater.settings') || '{}')); } catch (e) { /* defaults */ }
    const save = () => { try { localStorage.setItem('duskwater.settings', JSON.stringify(S)); } catch (e) { /* private mode */ } };
    const SELECTORS = {
      mode: { values: ['squad', 'solo'], label: v => v === 'squad' ? 'Squad 5v5' : 'Solo vs 5' },
      diff: { values: ['recruit', 'regular', 'veteran'], label: v => A.DIFF[v].label },
      toWin: { values: [3, 5, 8], label: v => v + ' rounds' },
    };

    // ------------------------------------------------------------ engine

    const canvas = $('gl');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    const scene = new T.Scene();
    // the menu flyover camera; each player has their own camera in a match
    const menuCam = new T.PerspectiveCamera(60, 16 / 9, 0.05, 900);
    const map = M.buildMap();
    const nav = M.buildNav(map);
    const world = ArenaWorld.buildWorld(scene, map, ASSETS, renderer);
    renderer.shadowMap.needsUpdate = true;
    const fx = new FX.Effects(scene);
    const sfx = new ArenaSfx();
    sfx.loadSamples(ASSETS && ASSETS.sfx);
    const mc = new MimicController();

    // input: one source per use. The solo game reads keyboard + the best pad, menus read every
    // device, split-screen players each read one pad (or the keyboard and mouse).
    const soloIn = new I.InputManager(canvas, 'auto');
    const menuIn = new I.InputManager(canvas, 'all');
    const kbmIn = new I.InputManager(canvas, { kbm: true, pad: null });
    const padIns = new Map(); // gamepad index -> InputManager
    function padIn(index) {
      if (!padIns.has(index)) { const m = new I.InputManager(canvas, { kbm: false, pad: index }); Object.assign(m.opts, soloIn.opts); padIns.set(index, m); }
      return padIns.get(index);
    }
    const allInputs = () => [soloIn, menuIn, kbmIn, ...padIns.values()];
    function updateInputs(dt) {
      const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      I.playPads(list).forEach(gp => padIn(gp.index));
      allInputs().forEach(m => m.update(dt));
    }

    // ------------------------------------------------------------ game state

    const G = {
      map, nav, actors: [], time: 0, noises: [], roundTimeLeft: 999,
      aliveCount: team => G.actors.reduce((n, a) => n + (a.alive && a.team === team ? 1 : 0), 0),
      tryFire: (a, yaw, pitch) => tryFire(a, yaw, pitch),
      reload: a => startReload(a),
      switchWeapon: (a, slot) => switchWeapon(a, slot),
    };
    const game = {
      state: 'splash', phase: 'buy', phaseT: 0, round: 0, score: [0, 0], lossStreak: [0, 0], matchOver: false,
      player: null, mode: 'squad', split: false, feed: [], feedV: 0, lastWinner: -1, stats: { fps: 60 },
    };
    let H = []; // the human players' views, in slot order

    // ------------------------------------------------------------ player views

    const tpl = $('vhudTpl');
    function makeHud(slot) {
      const root = tpl.content.firstElementChild.cloneNode(true);
      const e = {};
      root.querySelectorAll('[data-h]').forEach(el => { e[el.dataset.h] = el; });
      e.radar = root.querySelector('.radar'); e.rctx = e.radar.getContext('2d');
      e.ptag.innerHTML = `P${slot + 1}<em></em>`;
      root.style.setProperty('--pc', PCOL[slot]);
      const dds = [];
      for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'dd'; e.dmgdirs.appendChild(d); dds.push({ el: d, t: 0, att: null }); }
      $('views').appendChild(root);
      return { root, inner: root.firstElementChild, e, dds, ddi: 0 };
    }

    // first-person rigs are built once per player slot and kept between matches
    const vmCache = [];
    function vmFor(slot) { return vmCache[slot] || (vmCache[slot] = new FX.ViewModel(ASSETS, world.env)); }

    /** dev: 'auto' (solo), 'kbm' or 'pad:<index>'. */
    function makeView(slot, dev, actor) {
      const cam = new T.PerspectiveCamera(60, 16 / 9, 0.05, 900);
      cam.rotation.order = 'YXZ';
      const input = dev === 'auto' ? soloIn : dev === 'kbm' ? kbmIn : padIn(+dev.slice(4));
      const ph = {
        slot, dev, a: actor, cam, input, vm: vmFor(slot), hud: makeHud(slot),
        rect: { x: 0, y: 0, w: innerWidth, h: innerHeight }, scale: 1, vpan: 0, curZoom: 1,
        buyOpen: false, buyIndex: 0, scoped: false, aiming: false, crouchToggle: false, fireQueue: 0,
        punch: { pitch: 0, yaw: 0 }, shake: 0, hurtT: 0, spectate: null, deathT: 0, look: { yaw: 0, pitch: 0 },
        guideHidden: false, guideKey: '', guideSince: 0, bannerT: 0, hitT: 0, radarT: 0, sbT: 0, feedV: -1,
      };
      actor.ph = ph;
      return ph;
    }
    function dropViews() {
      H.forEach(ph => { ph.hud.root.remove(); });
      H = [];
      $('views').innerHTML = '';
    }
    const usesMouse = ph => ph.dev === 'kbm' || (ph.dev === 'auto' && (ph.input.lastDevice === 'kbm' || !ph.input.pad));
    const padOf = ph => ph.input.lastDevice === 'pad';

    // ------------------------------------------------------------ layout, cameras, quality

    let quality = SP.qualityFor(1), dynScale = 1;
    function pixelRatio() { return S.renderScale * quality.scale * dynScale; }

    function layout() {
      const W = innerWidth, Hh = innerHeight;
      const rects = SP.layoutViews(Math.max(1, H.length), W, Hh, S.split2);
      H.forEach((ph, i) => {
        ph.rect = rects[i];
        ph.vpan = H.length > 1 ? SP.viewPan(ph.rect, W) : 0;
        ph.scale = H.length > 1 ? SP.hudScale(ph.rect) : 1;
        const r = ph.rect, s = ph.scale, el = ph.hud.root, inn = ph.hud.inner;
        Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        Object.assign(inn.style, { width: (r.w / s) + 'px', height: (r.h / s) + 'px', transform: `scale(${s})` });
        el.classList.toggle('split', H.length > 1);
        el.classList.toggle('short', H.length > 1 && r.h / s < 760);
        // views touching the centre line make room for the match bar sitting there
        const mid = H.length > 1 && !(H.length === 2 && S.split2 === 'v');
        el.classList.toggle('above-bar', mid && r.y + r.h < innerHeight - 2);
        el.classList.toggle('below-bar', mid && r.y > 2);
        ph.cam.aspect = r.w / r.h;
        ph.vm.resize(r.w / r.h);
        updateFov(ph, ph.curZoom);
      });
      // dividers between views, the spare quarter with three players, the match bar
      document.querySelectorAll('.vdiv').forEach(d => d.remove());
      if (H.length > 1) {
        const lines = [];
        if (H.length === 2 && S.split2 === 'v') lines.push([W / 2 - 1, 0, 2, Hh]);
        else if (H.length === 2) lines.push([0, Hh / 2 - 1, W, 2]);
        else { lines.push([W / 2 - 1, 0, 2, Hh]); lines.push([0, Hh / 2 - 1, W, 2]); }
        lines.forEach(([x, y, w, h]) => { const d = document.createElement('div'); d.className = 'vdiv'; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); $('hud').appendChild(d); });
      }
      const spare = SP.spareRect(H.length, W, Hh);
      $('spare').classList.toggle('hidden', !spare);
      if (spare) Object.assign($('spare').style, { left: spare.x + 'px', top: spare.y + 'px', width: spare.w + 'px', height: spare.h + 'px' });
      $('topbar').classList.toggle('mid', H.length > 1 && !(H.length === 2 && S.split2 === 'v'));
    }

    function resize() {
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(innerWidth, innerHeight, false);
      menuCam.aspect = innerWidth / innerHeight; menuCam.updateProjectionMatrix();
      layout();
    }
    function updateFov(ph, zoom) {
      ph.curZoom = zoom;
      const v = SP.verticalFov(S.fov, ph.cam.aspect);
      ph.cam.fov = 2 * Math.atan(Math.tan(v * DEG / 2) / zoom) / DEG;
      ph.cam.updateProjectionMatrix();
    }
    addEventListener('resize', resize);
    // a lost WebGL context drops render targets: rebuild the environment map and the static shadows
    canvas.addEventListener('webglcontextrestored', () => {
      world.refreshEnv(renderer, vmCache.map(v => v.scene));
      renderer.shadowMap.needsUpdate = true;
    });

    // automatic resolution (solo and split): measured every two seconds of play
    let adaptT = 0, adaptN = 0, adaptAcc = 0;
    function adaptQuality(dt) {
      if (!S.autoRes || game.state !== 'playing') {
        adaptT = adaptN = adaptAcc = 0;
        if (!S.autoRes && dynScale !== 1) { dynScale = 1; renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight, false); }
        return;
      }
      adaptAcc += dt; adaptN++;
      if (adaptAcc < 2) return;
      const fps = adaptN / adaptAcc; adaptAcc = 0; adaptN = 0;
      adaptHold = Math.max(0, adaptHold - 2);
      // a step down that bought nothing (the frame is CPU-bound, not pixel-bound) is undone, and
      // resolution stays put for a while: blur that does not raise the frame rate is all loss
      if (adaptTry && fps < adaptTry.fps * 1.04) { setDyn(adaptTry.scale); adaptTry = null; adaptHold = 30; return; }
      adaptTry = null;
      let next = SP.adaptScale(dynScale, fps, SP.fpsTarget(H.length), quality.minScale / quality.scale, 1);
      if (next < dynScale && adaptHold > 0) next = dynScale;
      if (next < dynScale) adaptTry = { scale: dynScale, fps };
      if (next !== dynScale) setDyn(next);
    }
    let adaptHold = 0, adaptTry = null;
    function setDyn(v) { dynScale = v; renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight, false); }

    // ------------------------------------------------------------ rumble

    let lastRumble = 0;
    /** Phone rumble goes to the phone paired for it; with several players only P1's events use it. */
    function rumble(ph, strength, ms, pattern = 0, force = false) {
      if (!mc.rumbleReady || !ph || ph.slot !== 0) return;
      const now = performance.now();
      if (!force && now - lastRumble < 70) return;
      lastRumble = now;
      mc.rumble(strength, ms, pattern);
    }

    // ------------------------------------------------------------ sound placement

    /** Play sounds that belong to one player (their gun, their pain) on that player's side of the screen. */
    function asView(ph, fn) {
      const b = sfx.panBias;
      sfx.panBias = ph ? ph.vpan * 0.6 : 0;
      try { fn(); } finally { sfx.panBias = b; }
    }
    function listenerOf(ph) {
      const p = ph.a;
      if (p.alive) return { x: p.pos.x, y: p.eyeY(), z: p.pos.z, yaw: p.yaw, ph };
      return { x: ph.cam.position.x, y: ph.cam.position.y, z: ph.cam.position.z, yaw: ph.cam.rotation.y, ph };
    }
    /** A world sound: heard by the nearest player, panned in that player's view and toward that player's screen side. */
    function spatial(x, y, z) {
      const Ls = H.map(listenerOf);
      const L = Ls[Math.max(0, SP.nearestListener(Ls, x, z))] || { x: 0, y: 0, z: 0, yaw: 0, ph: null };
      const dx = x - L.x, dz = z - L.z, dist = Math.hypot(dx, dz, y - L.y);
      const pan = dist > 0.1 ? (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / Math.max(1, Math.hypot(dx, dz)) : 0;
      const occluded = dist > 2 && !M.lineOfSight(map, L.x, L.y, L.z, x, y, z);
      const local = clamp(pan, -1, 1) * 0.85;
      return { dist, pan: L.ph && H.length > 1 ? SP.mixPan(local, L.ph.vpan) : local, occluded };
    }

    // ------------------------------------------------------------ bodies and layers

    // Layers keep each view honest: 0 world, 1 + team = overhead markers only that team sees,
    // 4 + slot = a human's own body (hidden from that human's camera).
    const MARK = team => 1 + team, BODY = slot => 4 + slot;
    function setLayer(obj, layer) { obj.traverse(o => o.layers.set(layer)); }
    function setupCameraLayers(ph) {
      const c = ph.cam;
      c.layers.set(0);
      c.layers.enable(MARK(ph.a.team));
      for (let s = 0; s < 4; s++) if (s !== ph.slot) c.layers.enable(BODY(s));
    }
    const tagTex = [];
    function playerTag(slot) {
      if (!tagTex[slot]) tagTex[slot] = ArenaWorld.canvasTex(128, (g, s) => {
        g.clearRect(0, 0, s, s);
        g.fillStyle = 'rgba(13,15,23,0.75)'; g.fillRect(s * 0.18, s * 0.28, s * 0.64, s * 0.44);
        g.fillStyle = PCOL[slot]; g.fillRect(s * 0.18, s * 0.28, s * 0.06, s * 0.44);
        g.font = `bold ${s * 0.3}px Bahnschrift, Segoe UI, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('P' + (slot + 1), s * 0.53, s * 0.51);
      }, false);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tagTex[slot], depthTest: false, transparent: true, fog: false }));
      sp.scale.set(0.9, 0.9, 1); sp.renderOrder = 5;
      return sp;
    }
    // three.js refreshes a skeleton's bone texture on every render call; with one call per view
    // that is up to four uploads a frame for the same pose. Once per game frame is enough.
    let frameNo = 0;
    function oncePerFrame(root) {
      root.traverse(o => {
        if (!o.isSkinnedMesh || o.skeleton._once) return;
        const sk = o.skeleton, up = sk.update.bind(sk);
        sk._once = true;
        sk.update = () => { if (sk._frame !== frameNo) { sk._frame = frameNo; up(); } };
      });
    }
    function addBody(a) {
      a.model = A.makeCharacter(a.team, ASSETS);
      oncePerFrame(a.model.root);
      scene.add(a.model.root); scene.add(a.model.blob); scene.add(a.model.marker);
      a.model.marker.visible = true;
      setLayer(a.model.marker, MARK(a.team));
      if (a.ph) {
        setLayer(a.model.root, BODY(a.ph.slot)); setLayer(a.model.blob, BODY(a.ph.slot));
        a.tag = playerTag(a.ph.slot); setLayer(a.tag, MARK(a.team)); scene.add(a.tag);
        a.model.marker.visible = false; // the tag replaces the dot
      }
    }

    // ------------------------------------------------------------ match / round flow

    function clearActors() {
      G.actors.forEach(a => {
        if (a.model) { scene.remove(a.model.root); scene.remove(a.model.blob); scene.remove(a.model.marker); }
        if (a.tag) scene.remove(a.tag);
      });
      G.actors = [];
      dropViews();
    }

    /**
     * plan: { mode: 'squad' | 'solo' | 'coop' | 'versus', humans: [{ slot, dev, team }], bots: [n0, n1] }.
     * The solo menu entry is one human on the keyboard plus the best pad.
     */
    function startMatch(plan) {
      clearActors();
      if (!plan) plan = { mode: S.mode, humans: [{ slot: 0, dev: 'auto', team: 0 }], bots: [S.mode === 'solo' ? 0 : 4, 5] };
      game.mode = plan.mode;
      game.split = plan.humans.length > 1;
      plan.humans.forEach(h => {
        const a = new A.Actor(game.split ? 'P' + (h.slot + 1) : 'You', h.team, true);
        G.actors.push(a);
        H.push(makeView(h.slot, h.dev, a));
      });
      game.player = H[0].a;
      [0, 1].forEach(t => { for (let i = 0; i < plan.bots[t]; i++) G.actors.push(new A.Actor(A.TEAMS[t].names[i % 5], t, false)); });
      G.actors.forEach(a => {
        if (a.isPlayer) { if (game.split) addBody(a); return; }
        a.bot = new A.Bot(a, S.diff);
        addBody(a);
      });
      H.forEach(ph => {
        ph.vm.prepare(ph.a.team);
        setupCameraLayers(ph);
        const kind = ph.dev === 'kbm' ? 'Keyboard' : ph.dev === 'auto' ? '' : 'Pad';
        ph.hud.e.ptag.querySelector('em').textContent = kind + (game.mode === 'versus' ? ' · ' + A.TEAMS[ph.a.team].name : '');
        ph.hud.e.ptag.querySelector('em').style.color = game.mode === 'versus' ? A.TEAMS[ph.a.team].color : '';
      });
      // quality for this many views
      quality = SP.qualityFor(H.length); dynScale = 1; adaptHold = 0; adaptTry = null;
      resize();
      warmShaders();
      game.score = [0, 0]; game.round = 0; game.lossStreak = [0, 0]; game.matchOver = false;
      game.feed = []; game.feedV++;
      G.time = 0;
      setState('playing');
      startRound();
    }

    /**
     * Compile every shader the match can need now, hidden ones included (other guns in a
     * soldier's hand, distant-gun meshes): otherwise each compiles the first time it shows up,
     * a visible hitch in the middle of a fight.
     */
    function warmShaders() {
      const hidden = [];
      scene.traverse(o => { if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; } });
      try { renderer.compile(scene, H[0].cam); } catch (e) { /* best effort */ }
      hidden.forEach(o => { o.visible = false; });
    }

    function startRound() {
      game.round++;
      const lanes = ['north', 'mid', 'south'];
      const counters = [0, 0];
      const offs = [Math.floor(Math.random() * 3), Math.floor(Math.random() * 3)];
      G.actors.forEach(a => {
        if (!a.alive) { a.primary = null; a.armor = 0; a.slot = 'sidearm'; Object.keys(a.ammo).forEach(k => { if (k !== 'tern') delete a.ammo[k]; }); }
        a.alive = true; a.hp = 100; a.refill(); a.reloadT = 0; a.drawT = 0; a.shotsInBurst = 0;
        a.slot = a.primary ? 'primary' : 'sidearm';
        a.damagers = {}; a.roundKills = 0; a.crouch = 0; a.crouching = false; a.vel = { x: 0, y: 0, z: 0 }; a.onGround = true;
        const team = a.team, k = counters[team]++;
        a.pos = { x: 0, y: 0, z: 0 }; a.yaw = map.spawns[team][0].yaw; a.pitch = 0;
        if (a.bot) {
          a.bot.reset();
          a.bot.assignLane(lanes[(k + offs[team]) % 3], map);
          a.bot.aimYaw = a.yaw;
          botBuy(a);
        }
      });
      // spawn slots: humans take the middle ones (they were added first)
      const order = [2, 1, 3, 0, 4];
      const place = (a, s) => { a.pos.x = s.x + (Math.random() - 0.5) * 0.5; a.pos.z = s.z + (Math.random() - 0.5) * 0.5; a.pos.y = 0; };
      [0, 1].forEach(t => G.actors.filter(a => a.team === t).forEach((a, i) => place(a, map.spawns[t][order[i % 5]])));

      game.phase = 'buy'; game.phaseT = R.ROUND.buyTime; G.roundTimeLeft = R.ROUND.liveTime;
      fx.clear();
      sfx.stopReload();
      const first = game.score[0] + game.score[1] === 0;
      H.forEach(ph => {
        Object.assign(ph, { spectate: null, punch: { pitch: 0, yaw: 0 }, scoped: false, crouchToggle: false, deathT: 0 });
        closeBuy(ph);
        ph.vm.setWeapon(ph.a.weaponId, ph.a.team); ph.vm.cancel();
        const where = ph.a.team === 0 ? 'Wardens hold the west gate' : 'Corsairs hold the east gate';
        showBanner(ph, `Round ${game.round}`, first ? `Buy phase — ${where}` : 'Buy phase', null, 2.6);
      });
      sfx.ui('ok');
    }

    function botBuy(a) {
      const W = R.WEAPONS, arm = R.ARMOUR.price;
      if (!a.primary) {
        let pick = null;
        if (a.money >= W.longline.price + arm && Math.random() < (S.diff === 'veteran' ? 0.28 : 0.12)) pick = 'longline';
        else if (a.money >= W.breaker.price + arm) pick = 'breaker';
        else if (a.money >= W.skiff.price + arm || (a.money >= W.skiff.price && Math.random() < 0.5)) pick = 'skiff';
        if (pick) { a.money -= W[pick].price; a.giveWeapon(pick); }
      }
      if (a.armor < 60 && a.money >= arm) { a.money -= arm; a.armor = R.ARMOUR.amount; }
    }

    function endRound(winner, reason) {
      if (game.phase !== 'live') return;
      game.phase = 'post'; game.phaseT = R.ROUND.postTime;
      game.score[winner]++;
      const loser = 1 - winner;
      G.actors.forEach(a => {
        a.money = R.clampMoney(a.money + R.roundReward(a.team === winner, game.lossStreak[a.team]));
      });
      game.lossStreak[winner] = 0; game.lossStreak[loser]++;
      game.lastWinner = winner;
      if (game.score[winner] >= S.toWin) game.matchOver = true;
      const name = A.TEAMS[winner].name;
      const sub = game.matchOver ? 'Match point taken' : reason;
      H.forEach(ph => { showBanner(ph, `${name} take the round`, sub, winner, R.ROUND.postTime); closeBuy(ph); });
      // the sting follows the side the players are on; in versus it is a win for someone
      sfx.sting(game.mode === 'versus' ? true : winner === 0);
    }

    function modeLabel() {
      return { squad: 'Squad 5v5', solo: 'Solo vs 5', coop: `Co-op · ${H.length} players`, versus: `Versus · ${H.length} players` }[game.mode] || '';
    }

    function finishMatch() {
      setState('results');
      const w = game.score[0] > game.score[1] ? 0 : 1;
      if (game.mode === 'versus') {
        $('resTitle').textContent = `${A.TEAMS[w].name} win`;
        $('resTitle').style.color = `var(--t${w})`;
      } else {
        const won = w === 0;
        $('resTitle').textContent = won ? 'Victory' : 'Defeat';
        $('resTitle').style.color = won ? 'var(--t0)' : 'var(--t1)';
      }
      $('resSub').textContent = `Wardens ${game.score[0]} – ${game.score[1]} Corsairs · ${A.DIFF[S.diff].label} bots · ${modeLabel()}`;
      const line = ph => {
        const p = ph.a;
        const acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0;
        const hs = p.kills ? Math.round(p.hs / p.kills * 100) : 0;
        const who = H.length > 1 ? `<b style="color:${PCOL[ph.slot]}">P${ph.slot + 1}</b> ` : 'Your ';
        return `<div class="small">${who}accuracy ${acc}% · headshot kills ${hs}% · damage dealt ${Math.round(p.dmg)}</div>`;
      };
      $('resTable').innerHTML = `<div style="margin-bottom:12px">${H.map(line).join('')}</div>` + scoreboardHtml(true, null);
      unlockPointer();
    }

    // ------------------------------------------------------------ weapons

    function aimDir(yaw, pitch, out) {
      const cp = Math.cos(pitch);
      return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    }
    const _dir = new T.Vector3(), _right = new T.Vector3(), _up = new T.Vector3(), _o = new T.Vector3(), _end = new T.Vector3(), _mz = new T.Vector3(), _bm = new T.Vector3();

    function surfaceOf(hit) {
      if (!hit || !hit.solid) return 'concrete';
      const k = hit.solid.kind;
      if (k === 'crate') return 'wood';
      if (['container', 'crane', 'rail', 'pole', 'bollard', 'pillar', 'rack', 'shed', 'roof'].includes(k)) return 'metal';
      return 'concrete';
    }

    function tryFire(a, yaw, pitch) {
      if (!a.alive || a.reloadT > 0 || a.drawT > 0 || G.time < a.nextFireT) return false;
      if (game.phase === 'buy' || (game.phase === 'post' && !a.isPlayer)) return false;
      const ph = a.ph;
      const w = a.weapon, am = a.ammo[w.id];
      if (am.mag <= 0) {
        if (ph) { asView(ph, () => sfx.dry()); a.nextFireT = G.time + 0.25; if (am.reserve > 0) startReload(a); }
        return false;
      }
      am.mag--;
      a.nextFireT = G.time + R.fireInterval(w);
      const speed = Math.hypot(a.vel.x, a.vel.z);
      const scoped = !!(ph && ph.scoped);
      let spread = R.spreadFor(w, { speed, airborne: !a.onGround, crouched: a.crouch > 0.5, shotsInBurst: a.shotsInBurst, scoped });
      if (ph && ph.aiming && !scoped) spread *= 0.85;
      if (!ph) spread *= 0.9;
      // direction with spread cone
      aimDir(yaw, pitch, _dir);
      _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      _up.crossVectors(_right, _dir);
      const r = Math.tan(spread * DEG * Math.random()), phi = Math.random() * Math.PI * 2;
      _dir.addScaledVector(_right, Math.cos(phi) * r).addScaledVector(_up, Math.sin(phi) * r).normalize();
      const shotIndex = Math.floor(a.shotsInBurst);
      a.shotsInBurst += 1; a.lastShotT = G.time; a.shots++;
      _o.set(a.pos.x, a.eyeY(), a.pos.z);
      const hitInfo = resolveShot(a, _o, _dir, w);
      // effects and sound
      if (ph) {
        _mz.set(0.16, -0.12, -0.75).applyQuaternion(ph.cam.quaternion).add(ph.cam.position);
        fx.tracer(_mz, hitInfo.end, w.tracer);
        fx.playerFlash(_mz);
        if (a.model) { // split screen: the others see this player's muzzle flash on the body
          a.muzzleWorld(_bm);
          const s = fx.flashAt(_bm, 0.45 + Math.random() * 0.3, 0.05);
          setLayer(s, BODY(ph.slot));
          a.model.kick += w.id === 'longline' ? 0.25 : 0.08;
          if (a.model.onFire) a.model.onFire(G.time);
        }
        asView(ph, () => { sfx.shot(w.sound, 0, 0); sfx.shell(w.id === 'longline' ? 1.0 : 0.38 + Math.random() * 0.15); });
        const pad = padOf(ph);
        const k = R.recoilKick(w.id, shotIndex), sc = (pad ? 0.62 : 1) * (a.crouch > 0.5 ? 0.85 : 1);
        ph.punch.pitch += k.pitch * DEG * sc * (0.9 + Math.random() * 0.2);
        ph.punch.yaw += k.yaw * DEG * sc + (Math.random() - 0.5) * 0.08 * DEG;
        ph.shake = Math.min(1, ph.shake + (w.id === 'longline' ? 0.9 : w.id === 'tern' ? 0.3 : 0.22));
        ph.vm.fire(w.id === 'longline' ? 2.2 : w.id === 'tern' ? 1.2 : 1);
        rumble(ph, w.id === 'longline' ? 0.75 : w.id === 'tern' ? 0.35 : 0.25, w.id === 'longline' ? 110 : 45, 0);
        if (w.id === 'longline') { ph.scoped = false; setTimeout(() => { if (a.alive && a.weaponId === 'longline' && a.reloadT <= 0) asView(ph, () => sfx.bolt()); }, 260); }
      } else {
        a.muzzleWorld(_mz);
        fx.muzzle(_mz);
        if (Math.random() < 0.75) fx.tracer(_mz, hitInfo.end, w.tracer);
        a.model.kick += w.id === 'longline' ? 0.25 : 0.08;
        if (a.model.onFire) a.model.onFire(G.time);
        const sp = spatial(a.pos.x, a.eyeY(), a.pos.z);
        sfx.shot(w.sound, Math.max(1.5, sp.dist), sp.pan, sp.occluded);
        if (sp.dist < 12 && w.id !== 'longline') sfx.shell(0.4 + Math.random() * 0.2, sp.dist, sp.pan);
      }
      G.noises.push({ x: a.pos.x, y: a.pos.y, z: a.pos.z, t: G.time, team: a.team, loud: true });
      if (am.mag === 0 && am.reserve > 0 && ph) setTimeout(() => { if (a.alive && a.ammo[w.id] && a.ammo[w.id].mag === 0 && a.weaponId === w.id) startReload(a); }, 220);
      return true;
    }

    function resolveShot(a, o, d, w) {
      const wh = M.raycast(map, o.x, o.y, o.z, d.x, d.y, d.z, 220);
      let maxT = wh ? wh.t : 220, victim = null, vh = null;
      for (const e of G.actors) {
        if (e === a || !e.alive || e.team === a.team) continue;
        const h = e.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, maxT);
        if (h && h.t < maxT) { maxT = h.t; victim = e; vh = h; }
      }
      _end.copy(o).addScaledVector(d, maxT);
      if (victim) {
        fx.bodyHit(_end, d, vh.zone === 'head');
        applyDamage(victim, a, w, vh.zone, vh.t, d);
      } else if (wh) {
        const surf = surfaceOf(wh);
        fx.impact(_end, wh.n, surf);
        const sp = spatial(_end.x, _end.y, _end.z);
        if (sp.dist < 30 && (a.isPlayer || Math.random() < 0.6)) sfx.impact(surf, sp.dist, sp.pan);
        // near miss: a round cracking into cover beside a player shakes that player's view
        for (const ph of H) {
          const p = ph.a;
          if (p === a || !p.alive || p.team === a.team) continue;
          if (Math.hypot(_end.x - p.pos.x, _end.y - p.eyeY(), _end.z - p.pos.z) < 3.5) ph.shake = Math.min(1, ph.shake + 0.15);
        }
      }
      return { end: _end.clone(), victim };
    }

    function applyDamage(v, att, w, zone, dist, dir) {
      const d = R.computeDamage(w, zone, dist, v.armor);
      v.armor = Math.max(0, v.armor - d.armor);
      const dmg = Math.min(v.hp, Math.round(d.health));
      v.hp -= dmg;
      att.dmg += dmg; att.hits++;
      v.damagers[att.id] = (v.damagers[att.id] || 0) + dmg;
      const head = zone === 'head';
      if (v.ph) {
        const ph = v.ph;
        ph.hurtT = 1; ph.shake = Math.min(1, ph.shake + 0.5);
        ph.punch.pitch += (Math.random() * 0.8 + 0.4) * DEG; ph.punch.yaw += (Math.random() - 0.5) * 1.2 * DEG;
        showDamageDir(ph, att);
        asView(ph, () => sfx.hurt(dmg > 40));
        rumble(ph, head ? 1 : clamp(0.45 + dmg / 80, 0.5, 1), head ? 220 : 140, head ? 3 : 0, true);
      } else {
        const sp = spatial(v.pos.x, v.eyeY(), v.pos.z);
        if (sp.dist < 40) sfx.flesh(sp.dist, sp.pan);
      }
      if (att.ph) { hitMarker(att.ph, head, v.hp <= 0); asView(att.ph, () => sfx.hitmarker(head, v.hp <= 0)); }
      if (v.bot) v.bot.onHurt(G, att);
      if (v.model && v.model.onHit && v.hp > 0) v.model.onHit(head);
      if (v.hp <= 0) kill(v, att, w, head);
    }

    function kill(v, att, w, head) {
      v.alive = false; v.hp = 0; v.deaths++; v.deathT = G.time; v.reloadT = 0;
      att.kills++; att.roundKills++;
      if (head) att.hs++;
      att.money = R.clampMoney(att.money + R.killReward(w.id));
      Object.keys(v.damagers).forEach(id => { if (+id !== att.id && v.damagers[id] >= 40) { const as = G.actors.find(x => x.id === +id); if (as) as.assists++; } });
      addFeed(att, v, w, head);
      if (v.tag) v.tag.visible = false;
      if (v.ph) {
        const ph = v.ph;
        ph.deathT = 0; ph.scoped = false; closeBuy(ph); sfx.stopReload(ph.slot);
        rumble(ph, 1, 255, 2, true);
        showBanner(ph, 'Eliminated', `by ${att.name} · ${w.name}${head ? ' · headshot' : ''}`, 1, 2);
      }
      if (att.ph) rumble(att.ph, 0.45, 70, 3, true);
    }

    function startReload(a) {
      const w = a.weapon, am = a.ammo[w.id];
      if (!a.alive || a.reloadT > 0 || am.mag >= w.mag || am.reserve <= 0) return;
      a.reloadT = w.reload; a.reloadTotal = w.reload; a.shotsInBurst = 0;
      if (a.ph) {
        const ph = a.ph;
        ph.scoped = false;
        asView(ph, () => sfx.reloadSeq(w.id, w.reload, ph.slot));
        ph.vm.reload(w.reload);
      }
    }
    function finishReload(a) {
      const w = a.weapon, am = a.ammo[w.id];
      const take = Math.min(w.mag - am.mag, am.reserve);
      am.mag += take; am.reserve -= take;
    }
    function switchWeapon(a, slot) {
      if (slot === 'primary' && !a.primary) return;
      if (a.slot === slot) return;
      a.slot = slot; a.reloadT = 0; a.drawT = a.weapon.draw; a.shotsInBurst = 0;
      if (a.ph) { const ph = a.ph; ph.vm.setWeapon(a.weaponId, a.team); ph.vm.cancel(); ph.scoped = false; sfx.stopReload(ph.slot); asView(ph, () => sfx.swap()); }
    }

    // ------------------------------------------------------------ physics

    function stepActor(a, dt) {
      const p = M.moveCircle(map, a.pos, a.vel.x * dt, a.vel.z * dt, 0.36, a.height());
      a.pos.x = p.x; a.pos.z = p.z;
      if (a.onGround && a.vel.y <= 0) {
        const g = M.groundHeight(map, a.pos.x, a.pos.z, a.pos.y);
        if (a.pos.y - g <= 0.55) { a.pos.y = g; a.vel.y = 0; } else a.onGround = false;
      }
      if (!a.onGround) {
        const prevY = a.pos.y;
        a.vel.y -= 17 * dt;
        a.pos.y += a.vel.y * dt;
        const g = M.groundHeight(map, a.pos.x, a.pos.z, Math.max(prevY, a.pos.y));
        if (a.pos.y <= g && a.vel.y <= 0) {
          a.pos.y = g;
          if (a.ph && a.vel.y < -4) { asView(a.ph, () => sfx.land()); a.ph.shake = Math.min(1, a.ph.shake + 0.15); }
          a.vel.y = 0; a.onGround = true;
        }
      }
      // crouch smoothing
      a.crouch += ((a.crouching ? 1 : 0) - a.crouch) * Math.min(1, dt * 10);
      // footsteps
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (a.onGround && sp > 2.8 && !a.walking && a.crouch < 0.5) {
        a.stepDist += sp * dt;
        if (a.stepDist > 2.1) {
          a.stepDist = 0;
          if (a.ph) asView(a.ph, () => sfx.footstep(0, 0, false));
          else {
            const s = spatial(a.pos.x, a.pos.y + 0.2, a.pos.z);
            if (s.dist < 32) sfx.footstep(s.dist, s.pan, s.occluded, true);
          }
          G.noises.push({ x: a.pos.x, y: a.pos.y, z: a.pos.z, t: G.time, team: a.team, loud: false });
        }
      }
    }
    function separate() {
      const L = G.actors;
      for (let i = 0; i < L.length; i++) {
        const a = L[i]; if (!a.alive) continue;
        for (let j = i + 1; j < L.length; j++) {
          const b = L[j]; if (!b.alive || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
          const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.72 && d > 1e-4) { const push = (0.72 - d) / 2; a.pos.x -= dx / d * push; a.pos.z -= dz / d * push; b.pos.x += dx / d * push; b.pos.z += dz / d * push; }
        }
      }
    }
    function tickWeapons(a, dt) {
      if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) { a.reloadT = 0; finishReload(a); } }
      if (a.drawT > 0) a.drawT = Math.max(0, a.drawT - dt);
      const w = a.weapon;
      if (G.time - a.lastShotT > Math.max(0.22, R.fireInterval(w) * 1.8)) a.shotsInBurst = Math.max(0, a.shotsInBurst - dt * 14);
    }

    // ------------------------------------------------------------ player

    function aimAssistFactor(ph) {
      const p = ph.a;
      if (!S.aimAssist || !padOf(ph)) return 1;
      let best = 1;
      const ey = p.eyeY();
      aimDir(p.yaw + ph.punch.yaw, p.pitch + ph.punch.pitch, _dir);
      for (const e of G.actors) {
        if (!e.alive || e.team === p.team) continue;
        const tx = e.pos.x - p.pos.x, ty = e.pos.y + 1.2 - e.crouch * 0.35 - ey, tz = e.pos.z - p.pos.z;
        const dist = Math.hypot(tx, ty, tz);
        if (dist > 60) continue;
        const cosA = (tx * _dir.x + ty * _dir.y + tz * _dir.z) / dist;
        const ang = Math.acos(clamp(cosA, -1, 1));
        const cone = Math.atan2(0.75, dist) + 1.2 * DEG;
        if (ang > cone) continue;
        const key = '_los' + ph.slot;
        if (G.time - (e[key + 'T'] || -1) > 0.1) { e[key + 'T'] = G.time; e[key] = M.lineOfSight(map, p.pos.x, ey, p.pos.z, e.pos.x, e.pos.y + 1.2, e.pos.z); }
        if (!e[key]) continue;
        best = Math.min(best, 0.4 + 0.6 * (ang / cone));
      }
      return best;
    }

    function updatePlayer(ph, dt) {
      const p = ph.a, f = ph.input.frame;
      const frozen = game.phase === 'buy';
      const w = p.weapon;
      const pad = padOf(ph);
      // aim / scope
      ph.aiming = f.held.aim && p.reloadT <= 0 && p.drawT <= 0;
      const wantScope = ph.aiming && w.id === 'longline';
      if (wantScope && !ph.scoped && G.time >= p.nextFireT - 0.05) ph.scoped = true;
      if (!wantScope) ph.scoped = false;
      const zoom = ph.scoped ? w.zoom : ph.aiming ? (w.id === 'breaker' ? 1.25 : 1.12) : 1;
      const z = ph.curZoom + (zoom - ph.curZoom) * Math.min(1, dt * 18);
      if (Math.abs(z - ph.curZoom) > 1e-3) updateFov(ph, z);
      // look
      const sensScale = 1 / ph.curZoom;
      const assist = aimAssistFactor(ph);
      p.yaw += (f.lookYaw + f.padYaw * assist) * sensScale;
      p.pitch = clamp(p.pitch + (f.lookPitch + f.padPitch * assist) * sensScale, -1.45, 1.45);
      p.yaw = wrap(p.yaw);
      ph.look = { yaw: f.lookYaw + f.padYaw, pitch: f.lookPitch + f.padPitch };
      // crouch
      if (f.pressed.crouchToggle) ph.crouchToggle = !ph.crouchToggle;
      if (f.pressed.crouch) ph.crouchToggle = false;
      p.crouching = f.held.crouch || ph.crouchToggle;
      // movement
      const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw), rX = Math.cos(p.yaw), rZ = -Math.sin(p.yaw);
      let wx = rX * f.moveX + fwdX * f.moveY, wz = rZ * f.moveX + fwdZ * f.moveY;
      const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
      const padWalk = pad && f.moveMag > 0 && f.moveMag < 0.62;
      p.walking = f.held.walk || padWalk;
      let speed = 5.5 * w.speedMult;
      if (pad) speed *= Math.min(1, f.moveMag / 0.62 * 0.52 + (f.moveMag >= 0.62 ? 1 : 0) * 0.48);
      if (f.held.walk) speed *= 0.52;
      if (p.crouch > 0.5) speed *= 0.45;
      if (ph.aiming) speed *= ph.scoped ? 0.5 : 0.75;
      if (frozen) speed = 0;
      const tx = (f.moveMag > 0 ? wx / Math.max(1e-6, Math.hypot(wx, wz)) : 0) * speed, tz = (f.moveMag > 0 ? wz / Math.max(1e-6, Math.hypot(wx, wz)) : 0) * speed;
      const k = p.onGround ? (f.moveMag > 0 ? 11 : 13) : 1.4;
      p.vel.x += (tx - p.vel.x) * Math.min(1, dt * k); p.vel.z += (tz - p.vel.z) * Math.min(1, dt * k);
      if (f.pressed.jump && p.onGround && !frozen && p.crouch < 0.6) { p.vel.y = 6.1; p.onGround = false; }
      // weapons
      if (f.pressed.nextWeapon || f.pressed.prevWeapon) switchWeapon(p, p.slot === 'primary' ? 'sidearm' : 'primary');
      if (f.pressed.slot1) switchWeapon(p, 'primary');
      if (f.pressed.slot2) switchWeapon(p, 'sidearm');
      if (f.pressed.reload) startReload(p);
      if (!ph.buyOpen) {
        const yaw = p.yaw + ph.punch.yaw, pitch = p.pitch + ph.punch.pitch;
        // semi-auto: a press shortly before the weapon is ready still fires
        if (f.pressed.fire) ph.fireQueue = 0.18;
        if (w.auto ? f.held.fire : ph.fireQueue > 0) { if (tryFire(p, yaw, pitch)) ph.fireQueue = 0; }
        ph.fireQueue = Math.max(0, ph.fireQueue - dt);
      }
      // recoil recovery
      if (G.time - p.lastShotT > Math.min(0.12, R.fireInterval(w) + 0.03)) {
        const r = Math.exp(-w.recovery * dt);
        ph.punch.pitch *= r; ph.punch.yaw *= r;
      }
    }

    // ------------------------------------------------------------ main update

    function update(dt) {
      G.time += dt;
      G.noises = G.noises.filter(n => G.time - n.t < 0.5);

      if (game.phase === 'buy') {
        game.phaseT -= dt;
        if (game.phaseT <= 0) {
          game.phase = 'live'; game.phaseT = R.ROUND.liveTime; sfx.horn();
          H.forEach(ph => { closeBuy(ph); showBanner(ph, 'Go', 'Clear the depot', null, 1.2); });
        }
      } else if (game.phase === 'live') {
        game.phaseT -= dt; G.roundTimeLeft = game.phaseT;
        const a0 = G.aliveCount(0), a1 = G.aliveCount(1);
        if (a1 === 0) endRound(0, 'Corsairs eliminated');
        else if (a0 === 0) endRound(1, 'Wardens eliminated');
        else if (game.phaseT <= 0) {
          const hp = t => G.actors.reduce((s, a) => s + (a.team === t ? a.totalHp() : 0), 0);
          endRound(R.timeoutWinner({ alive: a0, hp: hp(0) }, { alive: a1, hp: hp(1) }), 'Time ran out');
        }
      } else if (game.phase === 'post') {
        game.phaseT -= dt;
        if (game.phaseT <= 0) { if (game.matchOver) { finishMatch(); return; } startRound(); return; }
      }

      // players
      for (const ph of H) {
        const p = ph.a;
        if (p.alive && !ph.buyOpen) updatePlayer(ph, dt);
        else if (p.alive) { p.vel.x *= 0.8; p.vel.z *= 0.8; ph.aiming = false; ph.scoped = false; }
      }
      // bots
      for (const a of G.actors) if (a.bot && a.alive) {
        if (game.phase === 'live') a.bot.update(G, dt);
        else { a.vel.x *= 0.85; a.vel.z *= 0.85; if (game.phase === 'buy') { a.yaw = a.bot.aimYaw; } }
      }
      for (const a of G.actors) { if (a.alive) { stepActor(a, dt); tickWeapons(a, dt); } }
      separate();
      for (const a of G.actors) {
        if (a.model) a.syncModel(dt, G.time);
        if (a.tag) { a.tag.visible = a.alive; a.tag.position.set(a.pos.x, a.pos.y + a.height() + 0.5, a.pos.z); }
      }

      for (const ph of H) {
        const p = ph.a, f = ph.input.frame;
        // spectating a teammate (bot or player) once dead
        if (!p.alive) {
          ph.deathT += dt;
          const mates = G.actors.filter(a => a.team === p.team && a.alive && a !== p);
          if (ph.deathT > 1.6 && mates.length) {
            if (!ph.spectate || !ph.spectate.alive) ph.spectate = mates[0];
            if (f.pressed.jump || f.pressed.fire) { const i = mates.indexOf(ph.spectate); ph.spectate = mates[(i + 1) % mates.length]; }
          }
        }
        // spotting for the radar
        if (p.alive && Math.floor(G.time * 5) !== Math.floor((G.time - dt) * 5)) {
          aimDir(p.yaw, p.pitch, _dir);
          for (const e of G.actors) {
            if (!e.alive || e.team === p.team) continue;
            const tx = e.pos.x - p.pos.x, tz = e.pos.z - p.pos.z, d = Math.hypot(tx, tz);
            if (d > 70 || (tx * _dir.x + tz * _dir.z) / d < 0.55) continue;
            if (M.lineOfSight(map, p.pos.x, p.eyeY(), p.pos.z, e.pos.x, e.eyeY(), e.pos.z)) e.spotted = G.time;
          }
        }
        ph.shake *= Math.exp(-dt * 7);
        ph.hurtT = Math.max(0, ph.hurtT - dt * 1.6);
      }
    }

    // ------------------------------------------------------------ cameras

    function updateCamera(ph) {
      const p = ph.a, camera = ph.cam;
      if (p.alive) {
        camera.position.set(p.pos.x, p.eyeY(), p.pos.z);
        const sh = ph.shake * ph.shake;
        camera.rotation.set(p.pitch + ph.punch.pitch + (Math.random() - 0.5) * sh * 0.01, p.yaw + ph.punch.yaw + (Math.random() - 0.5) * sh * 0.01, (Math.random() - 0.5) * sh * 0.012);
      } else if (ph.spectate && ph.spectate.alive) {
        const s = ph.spectate;
        aimDir(s.yaw, s.pitch * 0.5, _dir);
        camera.position.set(s.pos.x - _dir.x * 2.6 + Math.cos(s.yaw) * 0.6, s.eyeY() + 0.55, s.pos.z - _dir.z * 2.6 - Math.sin(s.yaw) * 0.6);
        camera.rotation.set(s.pitch * 0.5 - 0.12, s.yaw, 0);
      } else {
        // death cam: sink and tilt where you fell
        const k = Math.min(1, ph.deathT / 1.2);
        camera.position.set(p.pos.x, p.pos.y + 1.62 - 1.2 * k, p.pos.z);
        camera.rotation.set(p.pitch * (1 - k) - 0.3 * k, p.yaw, 0.5 * k);
      }
      // a spectated player's own body is hidden from their camera, not from ours: nothing to do
    }
    function updateMenuCamera(t) {
      const a = t * 0.045;
      menuCam.position.set(Math.cos(a) * 40, 13 + Math.sin(t * 0.07) * 2, Math.sin(a) * 26 + 4);
      menuCam.lookAt(0, 2, -6);
    }

    // ------------------------------------------------------------ HUD

    const txtCache = new Map();
    function setText(el, v) { if (txtCache.get(el) !== v) { txtCache.set(el, v); el.textContent = v; } }
    // style writes cost a style recalculation per view; skip the ones that did not change
    const styleCache = new WeakMap();
    function setStyle(el, prop, v) {
      let c = styleCache.get(el); if (!c) { c = {}; styleCache.set(el, c); }
      if (c[prop] === v) return;
      c[prop] = v;
      if (prop[0] === '-') el.style.setProperty(prop, v); else el.style[prop] = v;
    }
    /** ph: one view, or null for every view. */
    function showBanner(ph, title, sub, team, secs) {
      (ph ? [ph] : H).forEach(v => {
        const b = v.hud.e.banner;
        b.querySelector('b').textContent = title; b.querySelector('span').textContent = sub || '';
        b.className = 'banner show' + (team === 0 ? ' t0' : team === 1 ? ' t1' : '');
        v.bannerT = secs || 2;
      });
    }
    function hitMarker(ph, head, killed) {
      const h = ph.hud.e.hitmarker;
      h.className = 'hitmarker' + (killed ? ' kill' : '') + (head ? ' head' : '');
      h.style.opacity = 1; ph.hitT = killed ? 0.35 : 0.16;
    }
    function showDamageDir(ph, att) { const hd = ph.hud, d = hd.dds[hd.ddi]; hd.ddi = (hd.ddi + 1) % hd.dds.length; d.t = 1.4; d.att = att; }
    function addFeed(att, v, w, head) {
      game.feed.unshift({ att, v, w, head, t: G.time });
      game.feed = game.feed.slice(0, 5);
      game.feedV++;
    }
    function renderFeed(ph) {
      if (ph.feedV === game.feedV) return;
      ph.feedV = game.feedV;
      const n = H.length > 2 ? 3 : 5;
      ph.hud.e.feed.innerHTML = game.feed.slice(0, n).map(e => {
        const me = e.att === ph.a || e.v === ph.a;
        return `<div class="kf${me ? ' me' : ''}"><span class="t${e.att.team}">${e.att.name}</span><i>${e.w.name}</i>${e.head ? '<span class="hs">◎</span>' : ''}<span class="t${e.v.team}">${e.v.name}</span></div>`;
      }).join('');
    }
    /** viewerTeam: whose cash shows (null = everyone's, the results screen). */
    function scoreboardHtml(full, viewer) {
      const viewerTeam = viewer ? viewer.team : null;
      return [0, 1].map(team => {
        const cash = full || viewerTeam === null || team === viewerTeam;
        const rows = G.actors.filter(a => a.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        return `<table class="sb t${team}"><caption>${A.TEAMS[team].name} — ${game.score[team]}</caption><tr><th>Name</th><th>K</th><th>D</th><th>A</th><th>HS</th><th>Dmg</th>${cash ? '<th>Cash</th>' : ''}</tr>` +
          rows.map(a => {
            const name = a.ph && H.length > 1 ? `<b style="color:${PCOL[a.ph.slot]}">${a.name}</b>` : a.name;
            return `<tr class="${a === viewer || (!viewer && a.isPlayer) ? 'me' : ''} ${a.alive || full ? '' : 'dead'}"><td>${name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td><td>${a.hs}</td><td>${Math.round(a.dmg)}</td>${cash ? `<td>$${a.money}</td>` : ''}</tr>`;
          }).join('') + '</table>';
      }).join('');
    }

    // radar: the level drawn once, then rotated around each player
    const RS = 3, mapCanvas = document.createElement('canvas');
    mapCanvas.width = 96 * RS; mapCanvas.height = 66 * RS;
    (function drawRadarMap() {
      const g = mapCanvas.getContext('2d');
      g.fillStyle = 'rgba(30,60,80,0.55)'; g.fillRect(0, 0, mapCanvas.width, 2 * RS); // water edge hint
      for (const s of map.solids) {
        if (s.kind === 'invisible' || s.y0 > 3 || s.kind === 'pole' || s.kind === 'bollard') continue;
        g.fillStyle = s.kind === 'dock' ? 'rgba(200,190,170,0.35)' : s.y1 > 2 ? 'rgba(235,225,210,0.75)' : 'rgba(235,225,210,0.45)';
        g.fillRect((s.x0 + 48) * RS, (s.z0 + 33) * RS, (s.x1 - s.x0) * RS, (s.z1 - s.z0) * RS);
      }
      map.ramps.forEach(r => { g.fillStyle = 'rgba(200,190,170,0.25)'; g.fillRect((r.x0 + 48) * RS, (r.z0 + 33) * RS, (r.x1 - r.x0) * RS, (r.z1 - r.z0) * RS); });
    })();
    function drawRadar(ph) {
      const p = ph.a, rctx = ph.hud.e.rctx, W = ph.hud.e.radar.width, c = W / 2, sc = 2.6;
      const L = p.alive || !ph.spectate ? p : ph.spectate;
      // nothing moved (buy time, holding an angle): keep the last picture instead of repainting it
      let sig = Math.round(L.yaw * 200) + ',' + Math.round(L.pos.x * 20) + ',' + Math.round(L.pos.z * 20);
      for (const a of G.actors) if (a !== L && (a.team === p.team || G.time - a.spotted < 1.5)) sig += ',' + Math.round(a.pos.x * 10) + ',' + Math.round(a.pos.z * 10) + (a.alive ? '' : 'd');
      if (sig === ph.radarSig) return;
      ph.radarSig = sig;
      rctx.clearRect(0, 0, W, W);
      rctx.save(); // the canvas is a circle by its CSS border-radius: no clip path needed
      rctx.translate(c, c); rctx.rotate(L.yaw); rctx.scale(sc / RS, sc / RS);
      rctx.translate(-(L.pos.x + 48) * RS, -(L.pos.z + 33) * RS);
      rctx.drawImage(mapCanvas, 0, 0);
      for (const a of G.actors) {
        if (a === L) continue;
        const show = a.team === p.team || G.time - a.spotted < 1.5;
        if (!show) continue;
        const x = (a.pos.x + 48) * RS, y = (a.pos.z + 33) * RS, r = (a.alive ? 1.0 : 0.7) * RS / sc * 2.6;
        rctx.fillStyle = !a.alive ? 'rgba(160,160,160,0.6)' : a.team === 0 ? '#58c7d8' : '#ff6a3a';
        rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.fill();
        if (a.ph && a.alive && H.length > 1) { rctx.strokeStyle = PCOL[a.ph.slot]; rctx.lineWidth = RS * 0.9; rctx.beginPath(); rctx.arc(x, y, r * 1.7, 0, Math.PI * 2); rctx.stroke(); }
      }
      rctx.restore();
      rctx.fillStyle = H.length > 1 ? PCOL[ph.slot] : '#fff';
      rctx.beginPath(); rctx.moveTo(c, c - 7); rctx.lineTo(c + 5, c + 5); rctx.lineTo(c, c + 2); rctx.lineTo(c - 5, c + 5); rctx.closePath(); rctx.fill();
    }

    // the shared match bar
    function updateTopbar() {
      const live = game.phase === 'live';
      const secs = Math.max(0, Math.ceil(game.phase === 'post' ? 0 : game.phaseT));
      setText($('timer'), `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
      setText($('phase'), game.phase === 'buy' ? 'BUY PHASE' : live ? `ROUND ${game.round}` : 'ROUND OVER');
      $('clock').classList.toggle('low', live && secs <= 15);
      setText($('score0'), String(game.score[0])); setText($('score1'), String(game.score[1]));
      [0, 1].forEach(t => {
        const pips = G.actors.filter(a => a.team === t).map(a => `<i class="${a.alive ? '' : 'dead'}${a.isPlayer && H.length > 1 ? ' h' : ''}"></i>`).join('');
        if (txtCache.get('pips' + t) !== pips) { txtCache.set('pips' + t, pips); $('pips' + t).innerHTML = pips; }
      });
    }
    let spareT = 0;
    function updateSpare(dt) {
      if (H.length !== 3) return;
      spareT -= dt;
      if (spareT > 0) return;
      spareT = 0.5;
      const html = scoreboardHtml(false, null);
      if (txtCache.get('spare') !== html) { txtCache.set('spare', html); document.querySelector('#spare .spare-body').innerHTML = html; }
    }

    function updateHud(ph, dt) {
      const p = ph.a, e = ph.hud.e, w = p.weapon;
      const shown = p.alive ? p : (ph.spectate || p);
      setText(e.hp, String(Math.max(0, Math.ceil(shown.hp))));
      setStyle(e.hpbar, 'width', shown.hp + '%');
      e.hp.parentNode.classList.toggle('low', shown.hp <= 30);
      setText(e.ar, String(Math.round(shown.armor))); setStyle(e.arbar, 'width', shown.armor + '%');
      setText(e.money, '$' + p.money);
      const sw = shown.weapon, sam = shown.ammo[sw.id];
      setText(e.wname, `${sw.name} · ${sw.kind}`);
      setText(e.mag, String(sam.mag)); setText(e.reserve, String(sam.reserve));
      e.weapon.classList.toggle('empty', sam.mag === 0);
      const rb = e.reloadbar;
      if (shown.reloadT > 0) { setStyle(rb, 'opacity', '1'); rb.firstChild.style.width = (100 * (1 - shown.reloadT / shown.reloadTotal)) + '%'; } else setStyle(rb, 'opacity', '0');
      // crosshair gap from current spread, in this view's (unscaled) pixels
      const spread = R.spreadFor(w, { speed: Math.hypot(p.vel.x, p.vel.z), airborne: !p.onGround, crouched: p.crouch > 0.5, shotsInBurst: p.shotsInBurst, scoped: ph.scoped });
      const px = Math.tan(spread * DEG) / Math.tan(ph.cam.fov * DEG / 2) * (ph.rect.h / ph.scale) / 2;
      setStyle(e.crosshair, '--gap', Math.round(4 + Math.min(60, px)) + 'px'); // whole pixels: no restyle every frame of a walk
      setStyle(e.crosshair, 'display', p.alive && !ph.scoped ? '' : 'none');
      e.scope.classList.toggle('on', ph.scoped && p.alive);
      if (ph.hitT > 0) { ph.hitT -= dt; if (ph.hitT <= 0) e.hitmarker.style.opacity = 0; }
      // damage directions
      for (const d of ph.hud.dds) {
        if (d.t <= 0) { setStyle(d.el, 'opacity', '0'); continue; }
        d.t -= dt;
        const dx = d.att.pos.x - p.pos.x, dz = d.att.pos.z - p.pos.z;
        const fx_ = dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw), rx = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
        d.el.style.transform = `rotate(${Math.atan2(rx, fx_)}rad)`;
        setStyle(d.el, 'opacity', Math.min(1, d.t).toFixed(2));
      }
      setStyle(e.hurt, 'opacity', (Math.round(Math.max(ph.hurtT * 0.8, p.alive && p.hp < 30 ? 0.35 + 0.15 * Math.sin(G.time * 5) : 0) * 40) / 40).toFixed(3));
      if (ph.bannerT > 0) { ph.bannerT -= dt; if (ph.bannerT <= 0) e.banner.classList.remove('show'); }
      renderFeed(ph);
      // spectate label and hints
      setText(e.spectate, !p.alive && ph.spectate && ph.spectate.alive ? `Watching ${ph.spectate.name}` : '');
      const pad = padOf(ph);
      let hint = '';
      if (ph.dev.startsWith('pad:') && !ph.input.pad) hint = `P${ph.slot + 1}: controller lost — wake the phone and press a button`;
      else if (game.phase === 'buy' && p.alive) hint = ph.buyOpen ? '' : (pad ? 'SELECT  open requisition' : 'B  open requisition');
      else if (!p.alive && ph.spectate) hint = pad ? 'A  next teammate' : 'SPACE  next teammate';
      else if (usesMouse(ph) && !ph.input.locked && p.alive) hint = 'Click to capture the mouse';
      setText(e.hint, hint);
      renderGuide(ph, pad);
      ph.radarT -= dt;
      if (ph.radarT <= 0) { ph.radarT = H.length > 2 ? 0.08 : 0.05; drawRadar(ph); }
      // hold scoreboard (in this view)
      const f = ph.input.frame;
      const sbOpen = (f.held.scoreboard && !(game.phase === 'buy' && pad)) || (!p.alive && f.held.scoreboard);
      e.sb.classList.toggle('hidden', !sbOpen);
      if (sbOpen) { ph.sbT -= dt; if (ph.sbT <= 0) { ph.sbT = 0.25; e.sbBody.innerHTML = scoreboardHtml(false, p); } }
      if (ph.buyOpen) renderBuy(ph, false);
    }

    // ---------------------------------------------------------------- key guide (top left of each view)
    function renderGuide(ph, pad) {
      const p = ph.a;
      const phase = !p.alive ? 'dead' : game.phase;
      const key = (pad ? 'pad' : 'kbm') + phase + (ph.guideHidden ? 'h' : '');
      const el = ph.hud.e.keys;
      if (key !== ph.guideKey) {
        ph.guideKey = key; ph.guideSince = G.time;
        const g = I.guide(pad ? 'pad' : 'kbm', phase);
        el.querySelector('.kg-goal').textContent = g.goal;
        el.querySelector('.kg-rows').innerHTML = g.rows.map(r =>
          '<div' + (r[2] ? ' class="' + r[2] + '"' : '') + '><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('');
      }
      if (ph.buyOpen && H.length > 1) { el.classList.add('off'); return; } // the shop covers it anyway
      if (H.length > 1) {
        // split screen has no room for a guide that stays: it shows while buying and for the
        // first seconds of the round; HOME / H flips that
        const auto = phase === 'buy' || (phase === 'live' && G.time - ph.guideSince < 8);
        el.classList.toggle('off', ph.guideHidden ? auto : !auto);
        el.classList.remove('quiet');
        return;
      }
      // full strength when something changes, then it folds to its goal line so the depot shows
      el.classList.toggle('off', !!ph.guideHidden);
      el.dataset.hint = pad ? 'HOME · show all keys' : 'H · show all keys';
      el.classList.toggle('quiet', !ph.guideHidden && phase === 'live' && G.time - ph.guideSince > 12);
    }

    // ------------------------------------------------------------ buy menu (per player)

    const BUY_ITEMS = ['skiff', 'breaker', 'longline', 'armour'];
    function openBuy(ph) {
      if (game.phase !== 'buy' || !ph.a.alive) return;
      ph.buyOpen = true; ph.hud.e.buy.classList.remove('hidden');
      if (usesMouse(ph)) unlockPointer();
      ph.buyIndex = 0;
      renderBuy(ph, true); asView(ph, () => sfx.ui('ok'));
    }
    function closeBuy(ph) {
      if (!ph.buyOpen) return;
      ph.buyOpen = false; ph.hud.e.buy.classList.add('hidden');
    }
    function buy(ph, item) {
      const p = ph.a;
      if (game.phase !== 'buy' || !p.alive) return;
      if (item === 'armour') {
        if (p.armor >= R.ARMOUR.amount || p.money < R.ARMOUR.price) { asView(ph, () => sfx.ui('deny')); return; }
        p.money -= R.ARMOUR.price; p.armor = R.ARMOUR.amount;
      } else {
        const w = R.WEAPONS[item];
        if (p.primary === item || p.money < w.price) { asView(ph, () => sfx.ui('deny')); return; }
        p.money -= w.price; p.giveWeapon(item); p.drawT = 0.2; ph.vm.setWeapon(p.weaponId, p.team);
      }
      asView(ph, () => sfx.ui('buy')); renderBuy(ph, true);
    }
    function statBar(label, v) { return `<div>${label}<s><i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i></s></div>`; }
    function buyRows(ph) { return Array.from(ph.hud.e.buyList.querySelectorAll('.nav-item')); }
    function setBuyFocus(ph, i) {
      const rows = buyRows(ph);
      if (!rows.length) return;
      ph.buyIndex = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle('focus', k === ph.buyIndex));
    }
    function renderBuy(ph, force) {
      const p = ph.a, e = ph.hud.e;
      setText(e.buyMoney, '$' + p.money);
      setText(e.buyTime, Math.ceil(game.phaseT) + 's left');
      const key = p.money + '|' + p.primary + '|' + p.armor + '|' + padOf(ph);
      if (!force && ph.buyKey === key) return;
      ph.buyKey = key;
      e.buyList.innerHTML = BUY_ITEMS.map((id, i) => {
        if (id === 'armour') {
          const owned = p.armor >= 100, poor = p.money < R.ARMOUR.price;
          return `<button class="nav-item buy-row${owned ? ' owned' : poor ? ' poor' : ''}" data-buy="armour"><span class="key">${i + 1}</span><span class="nm"><b>Plate carrier</b><span>Armour 100</span></span><span class="stats"></span><span class="price">${owned ? 'Worn' : '$' + R.ARMOUR.price}</span></button>`;
        }
        const w = R.WEAPONS[id], owned = p.primary === id, poor = p.money < w.price;
        const dps = w.damage * w.rpm / 60;
        return `<button class="nav-item buy-row${owned ? ' owned' : poor ? ' poor' : ''}" data-buy="${id}"><span class="key">${i + 1}</span><span class="nm"><b>${w.name}</b><span>${w.kind}</span></span>` +
          `<span class="stats">${statBar('DMG', w.damage / 112)}${statBar('RATE', w.rpm / 840)}${statBar('DPS', dps / 360)}${statBar('CTRL', 1 - (w.spread + w.burstMax * 0.3) / 2.5)}</span>` +
          `<span class="price">${owned ? 'Owned' : '$' + w.price}</span></button>`;
      }).join('') + `<button class="nav-item" data-buyact="close">Done</button>`;
      const rows = buyRows(ph);
      rows.forEach((b, i) => {
        b.onclick = () => { if (b.dataset.buy) buy(ph, b.dataset.buy); else { closeBuy(ph); lockPointer(); } };
        b.onmouseenter = () => setBuyFocus(ph, i);
      });
      setBuyFocus(ph, ph.buyIndex);
      setText(e.buyHelp, padOf(ph) ? 'D-pad / left stick to choose, A to buy, B or SELECT to close.' : 'Click or press 1–4 to buy, B or Esc to close. Survivors keep their gear.');
    }
    function buyFrame(ph, f) {
      if (f.pressed.menuBack || f.pressed.buy) { closeBuy(ph); if (usesMouse(ph)) lockPointer(); return; }
      if (f.pressed.menuDown) { setBuyFocus(ph, ph.buyIndex + 1); asView(ph, () => sfx.ui('move')); }
      if (f.pressed.menuUp) { setBuyFocus(ph, ph.buyIndex - 1); asView(ph, () => sfx.ui('move')); }
      if (f.pressed.menuOk) { const r = buyRows(ph)[ph.buyIndex]; if (r) r.click(); }
    }

    // ------------------------------------------------------------ screens and menu navigation

    const SCREENS = ['splash', 'menu', 'options', 'controls', 'lobby', 'pause', 'results'];
    let screenStack = [];
    let navIndex = 0;
    function visibleNavRoot() {
      for (const id of SCREENS) if (!$(id).classList.contains('hidden')) return $(id);
      return null;
    }
    function navItems() { const r = visibleNavRoot(); return r ? Array.from(r.querySelectorAll('.nav-item')).filter(e => !e.disabled && e.offsetParent !== null) : []; }
    function setFocus(i) {
      const items = navItems();
      items.forEach(e => e.classList.remove('focus'));
      if (!items.length) return;
      navIndex = (i + items.length) % items.length;
      items[navIndex].classList.add('focus');
      items[navIndex].scrollIntoView({ block: 'nearest' });
    }
    function bindHover() { navItems().forEach((e, i) => { e.onmouseenter = () => setFocus(i); }); }
    function showScreen(id, push) {
      SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id));
      if (push) screenStack.push(id); else screenStack = [id];
      if (id === 'menu') refreshMenu();
      if (id === 'options') buildOptions();
      if (id === 'controls') buildControls();
      bindHover(); setFocus(0);
    }
    function hideScreens() { SCREENS.forEach(s => $(s).classList.add('hidden')); screenStack = []; }
    function back() {
      sfx.ui('back');
      if (screenStack.length > 1) { screenStack.pop(); const id = screenStack[screenStack.length - 1]; SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id)); if (id === 'menu') refreshMenu(); bindHover(); setFocus(0); return; }
      if (game.state === 'paused') resume();
    }
    function setState(s) {
      game.state = s;
      $('hud').classList.toggle('hidden', !(s === 'playing' || s === 'paused'));
      if (s === 'playing') { hideScreens(); }
      if (s === 'menu') { showScreen('menu'); clearActors(); game.split = false; resize(); }
      if (s === 'results') { showScreen('results'); }
    }
    function pause() {
      if (game.state !== 'playing') return;
      H.forEach(closeBuy);
      game.state = 'paused'; game.pausedAt = performance.now(); showScreen('pause'); sfx.ui('back');
    }
    function resume() { if (game.state !== 'paused') return; game.state = 'playing'; hideScreens(); lockPointer(); }

    function lockPointer() { if (H.some(usesMouse) || (!H.length && (soloIn.lastDevice === 'kbm' || !soloIn.pad))) soloIn.lock(); }
    function unlockPointer() { game.expectUnlock = true; soloIn.unlock(); }
    soloIn.onLockChange = locked => {
      const mouseView = H.find(usesMouse);
      if (!locked && game.state === 'playing' && mouseView && !mouseView.buyOpen && !game.expectUnlock && mouseView.input.lastDevice === 'kbm') pause();
      game.expectUnlock = false;
    };

    function refreshMenu() {
      document.querySelectorAll('#menu .sel').forEach(el => { const k = el.dataset.key; el.querySelector('.val').textContent = SELECTORS[k].label(S[k]); });
      const rb = $('rumbleBtn');
      rb.textContent = mc.rumbleReady ? 'Phone rumble: on' : 'Phone rumble: enable';
    }
    function cycleSelector(key, dir) {
      const sel = SELECTORS[key]; const i = sel.values.indexOf(S[key]);
      S[key] = sel.values[(i + dir + sel.values.length) % sel.values.length];
      save(); refreshMenu(); sfx.ui('move');
    }

    function optValue(o, v) {
      if (o.type === 'toggle') return v ? 'On' : 'Off';
      if (o.type === 'choice') return o.names[v] || v;
      return o.fmt(v);
    }
    function buildOptions() {
      $('optList').innerHTML = OPTIONS.map(o => o.type === 'toggle' || o.type === 'choice'
        ? `<div class="nav-item opt${o.type === 'choice' ? ' sel' : ''}" data-key="${o.key}"><label>${o.label}</label><output></output></div>`
        : `<div class="nav-item opt" data-key="${o.key}"><label>${o.label}</label><div class="sl"><i></i></div><output></output></div>`).join('');
      $('optList').querySelectorAll('.opt').forEach(el => {
        const o = OPTIONS.find(x => x.key === el.dataset.key);
        el.onclick = e => {
          e.stopPropagation();
          if (o.type === 'toggle' || o.type === 'choice') { adjustOption(o.key, 1); return; }
          const sl = el.querySelector('.sl'), r = sl.getBoundingClientRect();
          if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6) { S[o.key] = clamp(o.min + (e.clientX - r.left) / r.width * (o.max - o.min), o.min, o.max); S[o.key] = Math.round(S[o.key] / o.step) * o.step; applyOptions(); }
        };
      });
      applyOptions(true);
    }
    function adjustOption(key, dir) {
      const o = OPTIONS.find(x => x.key === key);
      if (o.type === 'toggle') S[key] = !S[key];
      else if (o.type === 'choice') { const i = o.values.indexOf(S[key]); S[key] = o.values[(i + dir + o.values.length) % o.values.length]; }
      else S[key] = clamp(Math.round((S[key] + dir * o.step) / o.step) * o.step, o.min, o.max);
      sfx.ui('move'); applyOptions();
    }
    function inputOpts() { return { mouseSens: S.mouseSens, padSens: S.lookSens, invertY: S.invertY, deadzone: S.deadzone, curve: S.curve, accel: S.accel }; }
    function applyOptions(noSave) {
      $('optList').querySelectorAll('.opt').forEach(el => {
        const o = OPTIONS.find(x => x.key === el.dataset.key), v = S[o.key];
        el.querySelector('output').textContent = optValue(o, v);
        const bar = el.querySelector('.sl i'); if (bar) bar.style.width = ((v - o.min) / (o.max - o.min) * 100) + '%';
      });
      allInputs().forEach(m => Object.assign(m.opts, inputOpts()));
      sfx.setVolume(S.volume);
      if (Math.abs(renderer.getPixelRatio() - pixelRatio()) > 1e-3) resize(); else layout();
      if (!noSave) save();
    }

    const CONTROL_ROWS = [
      ['Move', 'Left stick · half tilt walks quietly', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · <kbd>Shift</kbd> walks'],
      ['Look', 'Right stick (+ phone gyro)', 'Mouse'],
      ['Fire', 'R2', 'Left click'],
      ['Aim / scope', 'L2', 'Right click'],
      ['Jump', 'A', '<kbd>Space</kbd>'],
      ['Crouch', 'B (hold) · L3 (toggle)', '<kbd>Ctrl</kbd> / <kbd>C</kbd>'],
      ['Reload', 'X', '<kbd>R</kbd>'],
      ['Switch weapon', 'Y · R1 · L1 · D-pad ◂▸', '<kbd>Q</kbd> <kbd>1</kbd> <kbd>2</kbd> wheel'],
      ['Buy (buy phase)', 'Select', '<kbd>B</kbd>'],
      ['Scoreboard', 'Select (hold, live) · R3', '<kbd>Tab</kbd>'],
      ['Pause (everyone)', 'Start', '<kbd>Esc</kbd>'],
      ['Hide key guide', 'Home', '<kbd>H</kbd>'],
      ['Menus', 'D-pad / stick · A ok · B back', 'Mouse, arrows · <kbd>Enter</kbd> · <kbd>Esc</kbd>'],
      ['Split lobby', 'A join · Start ready · ◂▸ team · B leave', '<kbd>Enter</kbd> join/ready · <kbd>←</kbd><kbd>→</kbd> team · <kbd>Esc</kbd> leave'],
    ];
    function buildControls() {
      $('controlsTable').innerHTML = '<tr><th>Action</th><th>Mimic Pad / gamepad</th><th>Keyboard &amp; mouse</th></tr>' +
        CONTROL_ROWS.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
    }

    function renderReadout() {
      const input = menuIn;
      const pads = input.padInfo();
      const ps = input.padState;
      let html = '';
      if (!pads.length) html = '<div class="dev">No gamepad yet. Open Mimic\'s <b>Pad</b> screen and press any button (Chrome lists a pad only after input).</div>';
      pads.forEach(p => {
        const used = p.kind !== 'mimic-motion';
        html += `<div class="dev"><span class="kind">${p.kind}</span>${used ? '<b>usable</b>' : 'ignored (motion controller)'}<br><span class="small">#${p.index} ${p.id.replace(/</g, '&lt;')} · ${p.buttons.length} buttons · ${p.axes.length} axes · mapping "${p.mapping}"</span>`;
        const layout = used ? I.PAD_LAYOUTS[p.kind] || I.PAD_LAYOUTS.generic : null;
        html += '<div class="axes">' + p.axes.map((v, i) => {
          const left = v < 0 ? 50 + v * 50 : 50, width = Math.min(50, Math.abs(v) * 50);
          const role = layout ? Object.entries(layout.axes).filter(([, idx]) => idx === i).map(([k]) => k).concat(layout.hatAxis === i ? ['hat'] : []).join(' ') : '';
          return `<span>axis ${i}${role ? ' <em style="color:var(--sodium);font-style:normal">' + role + '</em>' : ''}</span><div class="ab"><i style="left:${left}%;width:${width}%"></i></div><span>${v.toFixed(3)}</span>`;
        }).join('') + '</div>';
        html += '<div class="btns">' + p.buttons.map((b, i) => `<span class="${b ? 'on' : ''}">${i}</span>`).join('') + '</div></div>';
      });
      if (ps) {
        const dz = S.deadzone, st = (x, y, label, zone) => `<div class="stick"><div class="dz" style="left:${50 - zone * 50}%;top:${50 - zone * 50}%;width:${zone * 100}%;height:${zone * 100}%"></div><i style="left:${50 + x * 50}%;top:${50 + y * 50}%"></i><em>${label}</em></div>`;
        html += `<div class="dev"><b>Decoded (${ps.layout} layout${pads.length > 1 ? ', all pads together' : ''})</b><div class="sticks">${st(ps.lx, ps.ly, 'move', input.opts.moveDeadzone)}${st(ps.rx, ps.ry, 'look', dz)}</div><br>` +
          `L2 ${ps.lt.toFixed(2)} · R2 ${ps.rt.toFixed(2)}<br>` +
          `Pressed: ${Object.entries(ps.buttons).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(' ') || '—'}<br>` +
          `<span class="small">Look after dead zone + curve: yaw ${(input.frame.padYaw * 60).toFixed(2)} pitch ${(input.frame.padPitch * 60).toFixed(2)} rad/s</span></div>`;
      }
      $('readout').innerHTML = html;
    }

    function padStatusLine() {
      const list = I.playPads(navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);
      const kinds = list.map(I.classifyPad);
      const nM = kinds.filter(k => k === 'mimic').length, nO = kinds.length - nM;
      let line;
      if (!list.length) line = 'No gamepad yet: open Mimic\'s Pad screen and press a button. Keyboard and mouse work too.';
      else {
        const parts = [];
        if (nM) parts.push(nM === 1 ? '<b>Mimic Pad</b>' : `<b>${nM} Mimic Pads</b>`);
        if (nO) parts.push(nO === 1 ? '<b>gamepad</b>' : `<b>${nO} gamepads</b>`);
        line = `<span class="ok">●</span> ${parts.join(' + ')} connected` + (list.length > 1 ? ' · ready for split screen' : '');
      }
      const r = mc.rumbleReady ? ' · rumble ready' : '';
      return line + r;
    }

    // ------------------------------------------------------------ split-screen lobby

    let lobby = null, lobbyGo = 0;
    function devLabel(dev) {
      if (dev === 'kbm') return 'Keyboard & mouse';
      const idx = +dev.slice(4);
      const gp = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).find(g => g && g.index === idx);
      const kind = gp ? I.classifyPad(gp) : null;
      return (kind === 'mimic' ? 'Mimic Pad' : 'Gamepad') + ` · #${idx + 1}`;
    }
    function openLobby() {
      lobby = SP.lobbyCreate(S.splitMode, S.splitFill);
      lobbyGo = 0;
      game.state = 'lobby';
      showScreen('lobby', true);
      renderLobby();
      sfx.ui('ok');
    }
    function closeLobby() {
      lobby = null;
      game.state = 'menu';
      showScreen('menu');
      sfx.ui('back');
    }
    function lobbyAct(dev, action) {
      const r = SP.lobbyInput(lobby, dev, action);
      if (!r.ev) return;
      if (r.ev === 'back') { closeLobby(); return; }
      lobby = r.st;
      S.splitMode = lobby.mode; S.splitFill = lobby.fill; save();
      sfx.ui(r.ev === 'leave' || r.ev === 'unready' ? 'back' : r.ev === 'full' ? 'deny' : r.ev === 'ready' || r.ev === 'join' ? 'ok' : 'move');
      lobbyGo = 0;
      renderLobby();
    }
    function lobbyFrame(dt) {
      // pads: each one separately, so the lobby knows who pressed what
      const list = I.playPads(navigator.getGamepads ? Array.from(navigator.getGamepads()) : []);
      const live = new Set(list.map(gp => 'pad:' + gp.index));
      lobby.slots.filter(s => s.dev !== 'kbm' && !live.has(s.dev)).forEach(s => { lobby = SP.lobbyDrop(lobby, s.dev); renderLobby(); });
      for (const gp of list) {
        const m = padIn(gp.index), dev = 'pad:' + gp.index, pp = m.padPressed, f = m.frame;
        if (!lobby) return;
        if (pp.a) lobbyAct(dev, 'join');
        if (!lobby) return;
        if (pp.start) lobbyAct(dev, 'start');
        if (pp.b) lobbyAct(dev, 'back');
        if (!lobby) return;
        if (pp.y) lobbyAct(dev, 'mode');
        if (pp.x) lobbyAct(dev, 'fill');
        if (f.pressed.menuLeft) lobbyAct(dev, 'left');
        if (f.pressed.menuRight) lobbyAct(dev, 'right');
      }
      // keyboard and mouse as one player
      const k = kbmIn.keysPressed || {};
      if (k.Enter || k.Space) lobbyAct('kbm', 'join');
      if (!lobby) return;
      if (k.Escape || k.Backspace) lobbyAct('kbm', 'back');
      if (!lobby) return;
      if (k.KeyM) lobbyAct('kbm', 'mode');
      if (k.KeyN) lobbyAct('kbm', 'fill');
      if (k.ArrowLeft || k.KeyA) lobbyAct('kbm', 'left');
      if (k.ArrowRight || k.KeyD) lobbyAct('kbm', 'right');
      // everyone ready: a short count, then go
      const can = SP.lobbyCanStart(lobby);
      if (can.ok) {
        lobbyGo += dt;
        setText($('lStatus'), `Deploying in ${Math.max(1, Math.ceil(1.5 - lobbyGo))}…`);
        $('lStatus').classList.add('go');
        if (lobbyGo >= 1.5) {
          const plan = SP.teamPlan(lobby);
          lobby = null;
          sfx.ui('ok');
          startMatch(plan);
          lockPointer();
        }
      } else {
        lobbyGo = 0;
        setText($('lStatus'), can.reason);
        $('lStatus').classList.remove('go');
      }
    }
    function renderLobby() {
      if (!lobby) return;
      const versus = lobby.mode === 'versus';
      $('lMode').textContent = versus ? 'Team versus' : 'Co-op vs bots';
      $('lFill').textContent = lobby.fill ? 'Fill teams to 5' : 'Players only';
      $('lModeKey').textContent = 'Y / M'; $('lFillKey').textContent = 'X / N';
      $('lDiff').textContent = A.DIFF[S.diff].label; $('lWin').textContent = S.toWin + ' rounds';
      const cards = [];
      for (let i = 0; i < SP.MAX_PLAYERS; i++) {
        const s = lobby.slots[i];
        if (!s) {
          cards.push(`<div class="lslot empty" style="--pc:${PCOL[i]}"><div class="pn">P${i + 1}</div><div class="join"><b>Press A or START</b><small>Pad or gamepad &middot; keyboard: Enter</small></div>${i === lobby.slots.length ? '<div class="ljoin" data-mimic-join="pad" data-size="96"></div>' : ''}</div>`);
          continue;
        }
        const kb = s.dev === 'kbm';
        const team = versus || i === 0 ? `<div class="team t${s.team}">${versus && !s.ready ? '<i>◂</i>' : '<i></i>'}<span>${A.TEAMS[versus ? s.team : 0].name}</span>${versus && !s.ready ? '<i>▸</i>' : '<i></i>'}</div>` : `<div class="team t0"><i></i><span>Wardens</span><i></i></div>`;
        const how = s.ready
          ? (kb ? '<kbd>Esc</kbd> not ready' : '<kbd>B</kbd> not ready')
          : (kb ? `<kbd>Enter</kbd> ready${versus ? ' · <kbd>←</kbd><kbd>→</kbd> team' : ''} · <kbd>Esc</kbd> leave` : `<kbd>START</kbd> ready${versus ? ' · <kbd>◂▸</kbd> team' : ''} · <kbd>B</kbd> leave`);
        cards.push(`<div class="lslot on" style="--pc:${PCOL[i]}"><div class="pn">P${i + 1}</div><div class="dev">${devLabel(s.dev)}</div>${team}<div class="how">${how}</div><div class="state${s.ready ? ' ready' : ''}">${s.ready ? 'Ready' : 'Not ready'}</div></div>`);
      }
      $('lSlots').innerHTML = cards.join('');
      $('lHelp').innerHTML = 'All ready: match starts · B / Esc with nobody in: back';
    }

    // ------------------------------------------------------------ menu actions

    const ACTS = {
      play: () => { sfx.ui('ok'); startMatch(); lockPointer(); },
      split: () => openLobby(),
      again: () => { sfx.ui('ok'); const plan = lastPlan(); startMatch(plan); lockPointer(); },
      restart: () => { sfx.ui('ok'); const plan = lastPlan(); startMatch(plan); lockPointer(); },
      options: () => { sfx.ui('ok'); showScreen('options', true); },
      controls: () => { sfx.ui('ok'); showScreen('controls', true); },
      back: () => back(),
      resume: () => resume(),
      quit: () => { sfx.ui('back'); game.state = 'menu'; setState('menu'); },
      lmode: () => {
        if (!lobby) return;
        lobby = lobby.slots.length ? SP.lobbyInput(lobby, lobby.slots[0].dev, 'mode').st : Object.assign({}, lobby, { mode: lobby.mode === 'coop' ? 'versus' : 'coop' });
        S.splitMode = lobby.mode; save(); renderLobby(); sfx.ui('move');
      },
      lfill: () => { if (lobby) { lobby = Object.assign({}, lobby, { fill: !lobby.fill, slots: lobby.slots.map(s => Object.assign({}, s, { ready: false })) }); S.splitFill = lobby.fill; save(); renderLobby(); sfx.ui('move'); } },
      rumble: async () => {
        sfx.ui('ok');
        const ok = await mc.enableRumble();
        refreshMenu();
        $('padStatus').innerHTML = padStatusLine() + (ok ? '' : '<br>Rumble needs the Mimic Pad paired over Bluetooth and Chrome\'s device permission.');
        if (ok && mc.rumbleReady) mc.rumble(0.8, 120, 3);
      },
    };
    // "play again" keeps the same players and teams
    function lastPlan() {
      if (!H.length || !game.split) return null;
      const bots = [0, 1].map(t => G.actors.filter(a => a.bot && a.team === t).length);
      return { mode: game.mode, humans: H.map(ph => ({ slot: ph.slot, dev: ph.dev, team: ph.a.team })), bots };
    }
    document.addEventListener('click', e => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // keep Enter from double-activating
      const el = e.target.closest('[data-act]');
      if (el && ACTS[el.dataset.act]) { ACTS[el.dataset.act](); return; }
      const sel = e.target.closest('.sel');
      if (sel && SELECTORS[sel.dataset.key]) cycleSelector(sel.dataset.key, 1);
    });
    canvas.addEventListener('mousedown', () => { const v = H.find(usesMouse); if (game.state === 'playing' && v && !v.buyOpen && !soloIn.locked) lockPointer(); });

    // first gesture: start audio, leave the splash
    function firstGesture() {
      sfx.resume();
      // the key or click that leaves the splash must not also press the first menu item
      if (game.state === 'splash') { game.state = 'menu'; showScreen('menu'); game.skipMenu = true; }
    }
    addEventListener('mousedown', firstGesture);
    addEventListener('keydown', e => {
      firstGesture();
      // quick buy with number keys while the keyboard player's requisition is open
      const v = H.find(usesMouse);
      if (v && v.buyOpen && /^Digit[1-4]$/.test(e.code)) buy(v, BUY_ITEMS[+e.code.slice(5) - 1]);
    });

    function menuFrame(f) {
      const items = navItems();
      if (!items.length) return;
      if (f.pressed.menuDown) { setFocus(navIndex + 1); sfx.ui('move'); }
      if (f.pressed.menuUp) { setFocus(navIndex - 1); sfx.ui('move'); }
      const cur = items[navIndex];
      if (!cur) return;
      if (f.pressed.menuLeft || f.pressed.menuRight) {
        const dir = f.pressed.menuRight ? 1 : -1;
        if (cur.classList.contains('opt')) adjustOption(cur.dataset.key, dir);
        else if (cur.classList.contains('sel')) cycleSelector(cur.dataset.key, dir);
      }
      if (f.pressed.menuOk) cur.click();
    }

    // ------------------------------------------------------------ rendering

    const _vm = { yaw: 0, pitch: 0 };
    function renderViews(dt) {
      const Hh = innerHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, innerWidth, Hh);
      renderer.clear();
      const split = H.length > 1;
      if (split) renderer.setScissorTest(true);
      // world matrices once per frame, not once per view
      scene.matrixWorldAutoUpdate = true; scene.updateMatrixWorld(); scene.matrixWorldAutoUpdate = false;
      for (const ph of H) {
        const r = ph.rect, p = ph.a;
        if (split) { renderer.setViewport(r.x, Hh - r.y - r.h, r.w, r.h); renderer.setScissor(r.x, Hh - r.y - r.h, r.w, r.h); }
        world.sky.position.copy(ph.cam.position);
        renderer.render(scene, ph.cam);
        const showVm = p.alive && !ph.scoped;
        if (showVm) {
          if (ph.vm.key !== p.weaponId + p.team) ph.vm.setWeapon(p.weaponId, p.team);
          const look = ph.look || _vm;
          ph.vm.update({ dt, speed: Math.hypot(p.vel.x, p.vel.z), onGround: p.onGround, lookYaw: look.yaw, lookPitch: look.pitch,
            reload: p.reloadT > 0 ? 1 - p.reloadT / p.reloadTotal : -1, draw: p.drawT > 0 ? p.drawT / p.weapon.draw : 0, aim: ph.aiming && !ph.scoped, crouch: p.crouch, camQuat: ph.cam.quaternion });
          ph.look = { yaw: 0, pitch: 0 };
          renderer.clearDepth();
          renderer.render(ph.vm.scene, ph.vm.camera);
        }
      }
      if (split) { renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, Hh); }
      scene.matrixWorldAutoUpdate = true;
    }

    /**
     * Soldiers outside every player's view skip animation and bone matrices (the biggest CPU cost
     * per soldier). Runs after the cameras moved, so one that turns into view is posed (with the
     * time it missed) before this frame draws: nothing pops.
     */
    const _fr = [new T.Frustum(), new T.Frustum(), new T.Frustum(), new T.Frustum()], _pm = new T.Matrix4(), _sph = new T.Sphere();
    function refreshOnScreen() {
      H.forEach((ph, i) => { ph.cam.updateMatrixWorld(); _pm.multiplyMatrices(ph.cam.projectionMatrix, ph.cam.matrixWorldInverse); _fr[i].setFromProjectionMatrix(_pm); });
      for (const a of G.actors) {
        const m = a.model;
        if (!m || !m.swat) continue;
        _sph.center.set(a.pos.x, a.pos.y + 0.9, a.pos.z); _sph.radius = 2.2;
        let vis = false;
        for (let i = 0; i < H.length && !vis; i++) if (H[i].a !== a && _fr[i].intersectsSphere(_sph)) vis = true;
        if (vis && m.offscreen) {
          m.offscreen = false; m.root.matrixWorldAutoUpdate = true;
          m.update(a, m.pendDt || 0, G.time); m.pendDt = 0;
        } else if (!vis && !m.offscreen) { m.offscreen = true; m.root.matrixWorldAutoUpdate = false; }
      }
    }

    // ------------------------------------------------------------ main loop

    let last = performance.now(), menuT = 0, readoutT = 0, fpsAcc = 0, fpsN = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      frameNo++;
      const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      menuT += dt;
      updateInputs(dt);
      const mf = menuIn.frame;

      // splash: any pad button continues too
      if (game.skipMenu) game.skipMenu = false;
      else if (game.state === 'splash' && (mf.pressed.menuOk || mf.pressed.pause)) { game.state = 'menu'; showScreen('menu'); game.skipMenu = true; }
      else if (game.state === 'lobby') lobbyFrame(dt);
      else if (game.state === 'menu' || game.state === 'results' || game.state === 'paused') {
        const settled = game.state !== 'paused' || performance.now() - (game.pausedAt || 0) > 300; // the Esc that paused must not also resume
        if (game.state === 'paused' && screenStack.length <= 1 && (mf.pressed.pause || mf.pressed.menuBack)) { if (settled) resume(); }
        else if (mf.pressed.menuBack && screenStack.length > 1) back();
        else menuFrame(mf);
      } else if (game.state === 'playing') {
        let paused = false;
        for (const ph of H) {
          const f = ph.input.frame;
          if (ph.buyOpen) buyFrame(ph, f);
          else if (f.pressed.pause) { pause(); paused = true; break; }
          else if (f.pressed.buy && game.phase === 'buy') openBuy(ph);
          if (f.pressed.guide) { ph.guideHidden = !ph.guideHidden; ph.guideKey = ''; }
        }
        if (!paused) update(dt);
      }

      if (game.state === 'menu' && Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) $('padStatus').innerHTML = padStatusLine();
      if (game.state === 'lobby' && Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) renderLobby();
      if (!$('options').classList.contains('hidden')) { readoutT -= dt; if (readoutT <= 0) { readoutT = 0.06; renderReadout(); } }

      const inGame = (game.state === 'playing' || game.state === 'paused') && H.length;
      fx.update(dt);
      if (inGame) {
        H.forEach(updateCamera);
        refreshOnScreen();
        world.update(menuT, H[0].cam.position);
        updateTopbar();
        updateSpare(dt);
        H.forEach(ph => updateHud(ph, dt));
        renderViews(dt);
        adaptQuality(dt);
      } else {
        updateMenuCamera(menuT);
        world.update(menuT, menuCam.position);
        renderer.clear();
        renderer.render(scene, menuCam);
      }
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        game.stats.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
        setText($('fps'), S.showFps ? Math.round(game.stats.fps) + ' fps' + (game.state === 'playing' || game.state === 'paused' ? ` · ${Math.round(pixelRatio() * 100)}% res` : '') : '');
      }
    }

    allInputs().forEach(m => Object.assign(m.opts, inputOpts()));
    sfx.setVolume(S.volume);
    resize();
    requestAnimationFrame(frame);

    // test / debug hook (read-only use from Playwright; also handy in the console)
    const P1 = () => H[0];
    window.__arena = {
      game, G, S, map, nav, renderer, scene, fx, world, sfx, assets: ASSETS, SP,
      get H() { return H; },
      get input() { return P1() ? P1().input : soloIn; },
      get camera() { return P1() ? P1().cam : menuCam; },
      get vm() { return P1() ? P1().vm : null; },
      get lobby() { return lobby; },
      startMatch: plan => { firstGesture(); startMatch(plan); },
      ui: { scoreboardHtml, showScreen, setState, pause, resume, finishMatch, openLobby, lobbyAct, openBuy: (i = 0) => openBuy(H[i]), closeBuy: (i = 0) => closeBuy(H[i]), firstGesture },
      give(id, slot = 0) { const ph = H[slot], p = ph.a; p.giveWeapon(id); p.drawT = 0; ph.vm.setWeapon(p.weaponId, p.team); },
      fire: (slot = 0) => { const ph = H[slot]; return tryFire(ph.a, ph.a.yaw + ph.punch.yaw, ph.a.pitch + ph.punch.pitch); },
      reload: (slot = 0) => startReload(H[slot].a),
      fastForward(seconds, stepDt = 1 / 30) {
        let t = 0;
        while (t < seconds && game.state === 'playing') { updateInputs(stepDt); update(stepDt); t += stepDt; }
        return { phase: game.phase, round: game.round, score: game.score.slice(), state: game.state };
      },
    };
  }
})();
