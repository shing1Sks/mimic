/*
 * GYROWING — game flow: menus, modes (runway start, air start, landing challenge) and
 * missions (missions.js), physics loop, camera and its sense of motion, effects, rumble, scoring,
 * the objective panel, 3D markers and the HUD feed.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- settings
  const DEFAULTS = { sens: 1.0, expo: 0.25, invert: false, twist: true, autoRudder: true, assist: 'steady',
    tod: 1, timeSpeed: 1, wind: 1, volume: 8, quality: 1, mapDetail: 2, guide: 1, showFps: false };
  const settings = Object.assign({}, DEFAULTS);
  let savedSettings = {};
  try { savedSettings = JSON.parse(localStorage.getItem('gyrowing.settings') || '{}'); Object.assign(settings, savedSettings); } catch (e) { /* storage blocked */ }
  if (typeof settings.assist !== 'string') settings.assist = 'steady';   // the old on/off assist: everyone gets Steady now
  const save = () => { try { localStorage.setItem('gyrowing.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  const bestKey = id => id === 'landing' ? 'gyrowing.best' : 'gyrowing.best.' + id;
  const getBest = id => { try { return +localStorage.getItem(bestKey(id)) || 0; } catch (e) { return 0; } };
  const setBest = (id, v) => { try { localStorage.setItem(bestKey(id), String(v)); } catch (e) { /* ignore */ } };

  const TOD = [['Dawn', 6.1], ['Morning', 9.5], ['Noon', 12.5], ['Afternoon', 15.5], ['Golden hour', 18.3], ['Dusk', 19.6], ['Night', 22.5]];
  const SPEEDS = [['Frozen', 0], ['Real time', 1], ['x20', 20], ['x60', 60]];
  // turbulence only where it is announced: the Gusty setting and the missions that say so
  const WINDS = [['Calm', 0, 0], ['Light breeze', 3, 0], ['Gusty, turbulent', 7, 0.4]];
  const ASSISTS = [['steady', 'Steady: holds attitude'], ['leveller', 'Wing leveller'], ['off', 'Off (raw)']];
  // graphics tiers: name, render-scale cap, post-processing level (post.js)
  const QUAL = [['Performance', 0.8, 0], ['Balanced', 1, 1], ['High', 1.25, 2], ['Ultra', 1.75, 3]];
  const MAPDETAIL = ['Off (satellite only)', 'Light', 'Full'];

  const OPTIONS = [
    { key: 'sens', label: 'Stick sensitivity', fmt: v => v.toFixed(1) + 'x', step: (v, d) => clamp(Math.round((v + d * 0.1) * 10) / 10, 0.5, 2.5) },
    { key: 'expo', label: 'Expo (softer centre)', fmt: v => Math.round(v * 100) + '%', step: (v, d) => clamp(Math.round((v + d * 0.05) * 100) / 100, 0, 0.8) },
    { key: 'invert', label: 'Invert pitch', fmt: v => v ? 'On' : 'Off', step: v => !v },
    { key: 'autoRudder', label: 'Auto-rudder (coordinated turns)', fmt: v => v ? 'On' : 'Off', step: v => !v },
    { key: 'assist', label: 'Flight assist', fmt: v => (ASSISTS.find(a => a[0] === v) || ASSISTS[0])[1], step: (v, d) => ASSISTS[(ASSISTS.findIndex(a => a[0] === v) + d + ASSISTS.length) % ASSISTS.length][0] },
    { key: 'tod', label: 'Time of day', fmt: v => TOD[v][0], step: (v, d) => (v + d + TOD.length) % TOD.length },
    { key: 'timeSpeed', label: 'Time passes', fmt: v => SPEEDS[v][0], step: (v, d) => (v + d + SPEEDS.length) % SPEEDS.length },
    { key: 'wind', label: 'Wind (free flight)', fmt: v => WINDS[v][0], step: (v, d) => (v + d + WINDS.length) % WINDS.length },
    { key: 'volume', label: 'Volume', fmt: v => v * 10 + '%', step: (v, d) => clamp(v + d, 0, 10) },
    { key: 'quality', label: 'Graphics', fmt: v => QUAL[v][0], step: (v, d) => (v + d + QUAL.length) % QUAL.length },
    { key: 'mapDetail', label: 'Real-world map detail', fmt: v => MAPDETAIL[v], step: (v, d) => (v + d + 3) % 3 },
    { key: 'guide', label: 'Controller guide', fmt: v => ['Off', 'First 30 s', 'Always'][v], step: (v, d) => (v + d + 3) % 3 },
    { key: 'showFps', label: 'Frame rate counter', fmt: v => v ? 'On' : 'Off', step: v => !v },
  ];

  // ---------------------------------------------------------------- core objects
  const mc = new MimicController();
  const input = new FlightInput(mc, settings);
  const hud = new HUD($('hud'));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  $('stage').appendChild(renderer.domElement);
  // first run on an integrated GPU (Intel Iris / UHD, phones, Apple-less laptops): start on Performance
  if (savedSettings.quality === undefined) {
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (/intel|iris|uhd|mali|adreno|powervr|swiftshader|llvmpipe/i.test(name) && !/arc\b/i.test(name)) settings.quality = 0;
      window.__gpuName = name;
    } catch (e) { /* keep Balanced */ }
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 60000);
  let T, world, plane, env, puffs, life, cockpit, missionDefs, markers, speedfx;
  let islandT = null, islandExtra = [], rw = null, rwT = null, DB = null, dbP = null, osm = null;
  const post = new Post(renderer);
  // adaptive resolution: the render scale drops (to 0.6) while the frame rate is under 45 and climbs
  // back to the quality setting's cap when there is room, so a laptop GPU stays smooth
  let dynScale = 1, dynT = 0;
  function adaptResolution(dt, fps) {
    dynT += dt; if (dynT < 1.5 || window.__noAdapt) return; dynT = 0;
    const cap = Math.min(window.devicePixelRatio || 1, QUAL[settings.quality][1]);
    let k = dynScale;
    // first step down: the island's photo-detail ground layer and nearer trees (most of its GPU cost
    // on an Iris Xe), or the real world's finer terrain grids; then the render scale
    const lowKey = G.rwMode ? 'autoLowRw' : 'autoLow';
    if (fps < 44 && !G[lowKey] && settings.quality >= 1 && G.state === 'fly') {
      G[lowKey] = true; if (G.rwMode) rw.setDetail(0); else world.setDetail(0);
      toast('Graphics eased off to keep the frame rate up (Options > Graphics)', 3); return;
    }
    if (fps < 44) k = Math.max(0.6 / cap, k - 0.1); else if (fps > 56) k = Math.min(1, k + 0.05);
    if (Math.abs(k - dynScale) > 1e-3) { dynScale = k; renderer.setPixelRatio(cap * dynScale); renderer.setSize(innerWidth, innerHeight); }
  }
  function applyQuality() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUAL[settings.quality][1]) * dynScale); renderer.setSize(innerWidth, innerHeight);
    if (world) {
      world.setDetail(settings.quality);
      // the shadow only covers the aircraft and the ground near it: 1024 is plenty on Performance
      const sm = [1024, 2048, 2048, 4096][settings.quality], sh = world.sun.shadow;
      if (sh.mapSize.x !== sm) { sh.mapSize.set(sm, sm); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    }
    if (rw) rw.setDetail(settings.quality);
    if (osm) osm.setQuality(settings.quality, settings.mapDetail);
    if (post) post.level = QUAL[settings.quality][2];
  }
  function onResize() { applyQuality(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); hud.resize(); }
  addEventListener('resize', onResize);
  onResize();

  const G = {
    state: 'boot', mode: null, s: null, ctl: FM.controls(), view: 'chase', hours: 15.5, time: 0,
    zoom: 1, orbit: { yaw: 0.6, pitch: 0.25, dist: 22, drag: false, idle: 0 }, camQ: new THREE.Quaternion(),
    shake: 0, rumbleT: 0, warn: {}, landing: null, crashT: 0, wreckV: null, legend: true, toastT: 0,
    mission: null, head: { y: 0, x: 0, look: 0 }, prevGust: null, bump: 0,
  };

  // ---------------------------------------------------------------- helpers
  function toast(msg, sec) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); G.toastT = sec || 2.2; }
  function show(id) {
    ['title', 'menu', 'options', 'pause', 'crash', 'result', 'place', 'rwload'].forEach(x => $(x).classList.toggle('hidden', x !== id));
    G.screen = id; G.focus = 0; refreshFocus();
  }
  function hideScreens() { show(null); }
  function focusables() { if (!G.screen) return []; return Array.from($(G.screen).querySelectorAll('.btn, .opt')).filter(e => e.offsetParent !== null); }
  function refreshFocus() { const f = focusables(); f.forEach((e, i) => e.classList.toggle('focus', i === G.focus)); if (f[G.focus] && f[G.focus].scrollIntoView) f[G.focus].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  /** Phone vibration (Mimic over WebHID, or a browser phone), else any gamepad's rumble motors. */
  function rumble(strength, ms, pattern) {
    if (mc.rumbleReady) { mc.rumble(strength, ms, pattern); return; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected || !p.vibrationActuator || p.__mimicWeb) continue;
      try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strength, 0, 1), weakMagnitude: clamp(strength * 0.7, 0, 1) }).catch(() => {}); } catch (e) { /* no motors */ }
    }
  }
  /** Wind as a velocity (m/s, the direction it blows toward) from a direction it comes from (deg) and knots. */
  function windVec(fromDeg, kt) { const f = fromDeg * DEG, v = kt / 1.944; return { x: -Math.sin(f) * v, y: 0, z: Math.cos(f) * v }; }
  function freeWind() { const w = WINDS[settings.wind]; return Object.assign(windVec(90, w[1] * 1.944), { turb: w[2] }); }

  // ---------------------------------------------------------------- boot
  function boot() {
    const t0 = performance.now();
    T = Terrain.buildTerrain(7);
    const t1 = performance.now();
    world = World.build(scene, renderer, T);
    T.villages = world.villages;
    missionDefs = Missions.build(T);
    console.log('[gyrowing] terrain ' + Math.round(t1 - t0) + ' ms, world ' + Math.round(performance.now() - t1) + ' ms');
    plane = Aircraft.build('hero');
    scene.add(plane.root);
    cockpit = Cockpit.build(plane);
    const preExtra = new Set(scene.children);
    // parked visitors on the apron
    [['red', -60, 160, 180], ['green', -25, 160, 180], ['red', 40, 168, 200], ['green', 8250, -25, 270]].forEach(([sch, x, z, h]) => {
      const p = Aircraft.build(sch, { lights: false });
      const elev = x > 5000 ? T.BROOK.elev : T.AIRPORT.elev;
      const fake = FM.groundState({ x, z, heading: h, elevation: elev });
      p.update(Object.assign(fake, { rpm: 0, groundSpeed: 0, agl: 0 }), 0, 0, false);
      p.parts.prop.children.forEach(bl => { bl.visible = true; });
      const baked = Aircraft.bake(p);
      baked.position.set(fake.pos.x, fake.pos.y, fake.pos.z); baked.quaternion.set(fake.quat.x, fake.quat.y, fake.quat.z, fake.quat.w);
      scene.add(baked);
    });
    life = Life.build(scene, T, world);
    islandExtra = scene.children.filter(o => !preExtra.has(o));   // parked aircraft, traffic, boats, birds, cars
    islandT = T;
    rw = RealWorld.create(scene, renderer, world);
    osm = OSMLayer.create(rw, renderer, world);
    applyQuality();
    rwT = { heightAt: rw.heightAt, surfaceAt: rw.surfaceAt, onRunway: (x, z, ap) => rw.onRunway(x, z, ap && ap.id), AIRPORT: null, AIRPORTS: [] };
    loadDB().catch(() => {});
    markers = new Markers(scene);
    puffs = new Puffs(scene, 90);
    speedfx = new SpeedFX(scene, 110);
    env = { groundHeight: T.heightAt, waterLevel: 0, wind: { x: 0, y: 0, z: 0 }, turbulence: 0, surfaceAt: T.surfaceAt };
    G.hours = TOD[settings.tod][1];
    world.setTime(G.hours);
    G.s = FM.groundState({ x: T.AIRPORT.runway.x0 + 40, z: 0, heading: 90, elevation: T.AIRPORT.elev });
    syncPlane(0);
    // compile the cockpit's shaders now, not with a two-second hitch the first time you press Camera
    plane.setCockpit(true); speedfx.lines.visible = true;
    try {
      renderer.compile(scene, camera);
      plane.parts.cockpit.traverse(m => { const ms = m.material ? [].concat(m.material) : []; for (const mt of ms) for (const t of [mt.map, mt.bumpMap]) if (t) renderer.initTexture(t); });
    } catch (e) { /* compiles on first use instead */ }
    plane.setCockpit(false); speedfx.lines.visible = false;
    buildMenu();
    console.log('[gyrowing] world built in ' + Math.round(performance.now() - t0) + ' ms: ' + world.treeCount + ' trees, ' + world.houseCount + ' houses, ' + world.roads.length + ' roads');
    $('loading').classList.add('hidden');
    show('title');
    G.state = 'title';
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- particles (smoke, tyre puffs)
  function Puffs(scene, n) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.visible = false; scene.add(sp);
      this.pool.push({ sp, life: 0, max: 1, v: new THREE.Vector3(), g0: 1, g1: 2, a: 1 });
    }
    this.i = 0;
  }
  Puffs.prototype.spawn = function (pos, vel, size0, size1, life, color, alpha) {
    const p = this.pool[this.i++ % this.pool.length];
    p.sp.position.copy(pos); p.v.copy(vel); p.g0 = size0; p.g1 = size1; p.max = life; p.life = life; p.a = alpha;
    p.sp.material.color.set(color); p.sp.visible = true;
  };
  Puffs.prototype.update = function (dt) {
    for (const p of this.pool) {
      if (!p.sp.visible) continue;
      p.life -= dt; if (p.life <= 0) { p.sp.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.sp.position.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - 0.6 * dt); p.v.y += 0.4 * dt;
      p.sp.scale.setScalar(p.g0 + (p.g1 - p.g0) * t);
      p.sp.material.opacity = p.a * (1 - t) * Math.min(1, t * 8);
    }
  };

  // ---------------------------------------------------------------- mission markers: rings and a beacon
  function Markers(scene) {
    this.scene = scene; this.rings = [];
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffb13b, transparent: true, opacity: 0.9, fog: true });
    this.ringMatDim = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.25, fog: true, depthWrite: false });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.beacon = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 900, 16, 1, true).translate(0, 450, 0), beamMat); this.beacon.add(col);
    const ringG = new THREE.Mesh(new THREE.RingGeometry(30, 38, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb13b, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })); ringG.position.y = 2; this.beacon.add(ringG);
    this.beacon.visible = false; scene.add(this.beacon);
    this.beamMat = beamMat;
  }
  Markers.prototype.clear = function () { this.rings.forEach(r => this.scene.remove(r)); this.rings = []; this.beacon.visible = false; };
  Markers.prototype.setMission = function (def) {
    this.clear();
    if (!def) return;
    def.steps.forEach(st => {
      if (st.kind !== 'ring') { this.rings.push(null); return; }
      const g = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(st.r, 1.8, 10, 56), this.ringMat);
      g.add(torus);
      // little posts so the ring reads as an object, not a sticker
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const k = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), this.ringMat); k.position.set(Math.cos(a) * st.r, Math.sin(a) * st.r, 0); g.add(k); }
      g.position.set(st.x, st.y, st.z); g.rotation.y = Math.PI - st.hdg * DEG;
      this.scene.add(g); this.rings.push(g);
    });
  };
  Markers.prototype.update = function (ms, time) {
    if (!ms) { this.beacon.visible = false; return; }
    const i = ms.i, steps = ms.def.steps;
    this.rings.forEach((g, k) => {
      if (!g) return;
      g.visible = k >= i && k <= i + 3 && !ms.done;
      const cur = k === i;
      g.children.forEach(c => { c.material = cur ? this.ringMat : this.ringMatDim; });
      g.scale.setScalar(cur ? 1 + 0.04 * Math.sin(time * 5) : 1);
    });
    const st = steps[i];
    if (st && !ms.done && (st.kind === 'waypoint' || st.kind === 'land')) {
      this.beacon.visible = true;
      this.beacon.position.set(st.x, Math.max(0, T.heightAt(st.x, st.z)), st.z);
      // on short final the runway itself is the target: the column fades out so it never hides it
      const d = G.s ? Math.hypot(G.s.pos.x - st.x, G.s.pos.z - st.z) : 1e9;
      const fade = st.kind === 'land' ? clamp((d - 1500) / 1500, 0, 1) : 1;
      this.beamMat.opacity = (0.28 + 0.1 * Math.sin(time * 3)) * fade;
      this.beacon.visible = fade > 0.01;
    } else this.beacon.visible = false;
  };

  // ---------------------------------------------------------------- modes and missions
  const LOWPASS_T = 120;
  /** Airborne low over the ground at (x, z), pointed down the lowest way out, for a low pass. */
  function lowpassStart(T, x, z, hdg) {
    const c = Missions.ringCourse(T, x, z, hdg, 1, 700, 45);
    G.s = FM.trimState({ speed: 56, gamma: 0, alt: c.startAlt, x, z, heading: c.legs[0].hdg, gear: false });
    input.throttle = G.s.trim.throttle + 0.15; input.trim = G.s.trim.trim; G.ctl.flaps = 0; G.ctl.gear = false;
  }
  const MODES = {
    tutorial: { name: 'Learn to fly', start() {
      G.s = FM.trimState({ speed: 50, gamma: 0, alt: T.AIRPORT.elev + 620, x: -4200, z: 1600, heading: 65, gear: false });
      input.throttle = 0.5; input.trim = G.s.trim.trim; G.ctl.flaps = 0; G.ctl.gear = false;
    } },
    lowpass: { name: 'Low pass', start() {
      const st = missionDefs.rings.start;
      lowpassStart(T, st.x, st.z, st.hdg);
      toast('Low pass: two minutes. Get under 200 ft at speed and stay there', 5);
    } },
    runway: { name: 'Takeoff', start() {
      startOnRunway(T.AIRPORT);
      toast('Runway 09. Full throttle (D-pad up / Shift), lift the nose at 55 kt', 5);
    } },
    air: { name: 'Air start', start() {
      G.s = FM.trimState({ speed: 52, gamma: 0, alt: T.AIRPORT.elev + 650, x: -4200, z: 1600, heading: 65, gear: false });
      input.throttle = G.s.trim.throttle; input.trim = G.s.trim.trim; G.ctl.flaps = 0; G.ctl.gear = false;
      toast('Trimmed for cruise. The airfield is ahead and to the right', 4);
    } },
    landing: { name: 'Landing challenge', start() {
      const aim = T.AIRPORT.aimPoint, d = 5000 + (aim - T.AIRPORT.runway.x0);
      const x = T.AIRPORT.runway.x0 - 5000;
      G.s = FM.trimState({ speed: 37, gamma: -3, flaps: 1, alt: T.AIRPORT.elev + 1.25 + d * Math.tan(3 * DEG), x, z: 0, heading: 90, gear: true });
      input.throttle = G.s.trim.throttle; input.trim = G.s.trim.trim; G.ctl.flaps = 1; G.ctl.gear = true;
      G.landing = { scored: false, touches: 0, first: null, done: false, t: 0 };
      toast('5 km final, runway 09. Follow the PAPI: two white, two red. Touch down on the aiming point', 6);
    } },
  };
  function startOnRunway(ap) {
    const r = ap.runway;
    G.s = FM.groundState({ x: r.x0 + 35, z: 0, heading: 90, elevation: ap.elev });
    input.throttle = 0; input.trim = 0.1; G.ctl.flaps = 0; G.ctl.gear = true;
  }
  function startMissionState(def) {
    const st = def.start;
    if (st.kind === 'runway') startOnRunway(T.AIRPORT);
    else {
      G.s = FM.trimState({ speed: st.speed, gamma: st.final ? -3 : 0, flaps: st.flaps || 0, alt: st.alt, x: st.x, z: st.z, heading: st.hdg, gear: !!st.gear });
      input.throttle = G.s.trim.throttle; input.trim = G.s.trim.trim; G.ctl.flaps = st.flaps || 0; G.ctl.gear = !!st.gear;
    }
  }

  function startMode(m) {
    G.mode = m;
    G.landing = null; G.mission = null;
    input.resetHolds();
    let w = freeWind(), hours = TOD[settings.tod][1];
    useRealWorld(m === 'rw');
    if (m === 'rw') {
      w = rwWind();
      startRealWorld();
    } else if (m.startsWith('m:')) {
      const def = missionDefs[m.slice(2)];
      startMissionState(def);
      G.mission = Missions.start(def, { onRunway: (id, x, z) => T.onRunway(x, z, T.AIRPORTS.find(a => a.id === id)) });
      w = Object.assign(windVec(def.wind.fromDeg, def.wind.kt), { turb: def.wind.turb });
      if (def.hours !== undefined) hours = def.hours;
      toast(def.name + ': ' + def.blurb, 6);
      markers.setMission(def);
    } else { MODES[m].start(); markers.setMission(null); }
    G.skim = Skim.create(); speedfx.reset();
    G.tutorial = m === 'tutorial' ? Tutorial.create(deviceKind()) : null; G.tutorialEnd = 0;
    $('tutorial').classList.toggle('hidden', !G.tutorial);
    if (m === 'lowpass' || (m === 'rw' && G.rw.ch.skimStart)) G.skim.armed = true;   // already up and running
    G.lowpass = (m === 'lowpass' || (m === 'rw' && G.rw.ch.skimStart)) ? { t: LOWPASS_T, done: false } : null;
    G.ctl = Object.assign(FM.controls(), { flaps: G.ctl.flaps, gear: G.ctl.gear });
    env.wind = { x: w.x, y: 0, z: w.z }; env.turbulence = w.turb;
    FM.matchWind(G.s, env.wind);   // spawn moving with the air: no jolt, no phugoid on the first frames
    G.hours = hours;
    world.setTime(G.hours);
    G.camQ.set(G.s.quat.x, G.s.quat.y, G.s.quat.z, G.s.quat.w);
    G.view = G.view || 'chase'; plane.setCockpit(G.view === 'cockpit');
    G.crashT = 0; G.wreckV = null; G.shake = 0;
    plane.root.visible = true;
    hideScreens();
    G.state = 'fly';
    G.legend = !G.tutorial; G.legendT = G.tutorial ? -2 : 14;
    $('legend').classList.toggle('hidden', !!G.tutorial);
    updateLegend();
    G.flyT = 0; G.coachId = '';
    if (m === 'rw') showGoal(G.rwDef.name, G.rwDef.goal, G.rw.loc.name);
    if (env.turbulence > 0.05) setTimeout(() => { if (G.state === 'fly') toast((env.turbulence > 0.3 ? 'Gusty, turbulent air today' : 'Light turbulence today') + ': expect bumps. ' + (settings.assist === 'steady' ? 'The Steady assist holds the wings level.' : 'Keep the wings level.'), 5); }, 6500);
    window.onbeforeunload = () => (G.state === 'fly' || G.state === 'pause') ? 'Leave the flight?' : undefined;
  }

  // ---------------------------------------------------------------- the real world
  function loadDB() {
    if (!dbP) dbP = fetch('data/airports.json').then(r => r.json()).then(rows => { DB = Geo.loadAirports(rows); return DB; }).catch(e => { dbP = null; throw e; });
    return dbP;
  }
  /** Real places get a westerly (the commonest wind on Earth) of the strength set in Options. */
  function rwWind() { const wd = WINDS[settings.wind]; return Object.assign(windVec(270, wd[1] * 1.944), { turb: wd[2], fromDeg: wd[1] > 0 ? 270 : null }); }
  /** Switch the ground between the island and the streamed real world. */
  function useRealWorld(on) {
    G.rwMode = on;
    if (on) {
      T = rwT;
      world.setIslandVisible(false, islandExtra);
      world.fogMul = 0.42; world.fogScale = 1800;
      env.groundHeight = rw.heightAt; env.surfaceAt = rw.surfaceAt; env.waterLevel = 0;
    } else {
      T = islandT;
      if (rw) rw.deactivate();
      world.setIslandVisible(true, islandExtra);
      world.fogMul = 1; world.fogBase = 0; world.fogScale = 1100;
      env.groundHeight = T.heightAt; env.surfaceAt = T.surfaceAt; env.waterLevel = 0;
    }
    $('attrib').classList.toggle('hidden', !on);
  }
  function openPlace(p) {
    loadDB().then(() => {
      const w = rwWind(), wf = w.fromDeg === null ? undefined : w.fromDeg;
      const loc = Geo.locationFor(DB, p, wf);
      if (!loc) { toast('No airport found for "' + (p.airport || '') + '"', 3); return; }
      const chs = Geo.planChallenges(DB, loc, { windFromDeg: wf });
      G.place = { loc, chs };
      $('plName').textContent = loc.name; $('plSub').textContent = loc.sub; $('plBlurb').textContent = loc.blurb || '';
      const box = $('plList'); box.innerHTML = '';
      chs.forEach((c, i) => {
        const b = document.createElement('button'); b.className = 'btn' + (i === 0 ? ' primary' : ''); b.dataset.act = 'ch:' + c.id;
        const best = getBest('rw:' + loc.id + ':' + c.id);
        b.innerHTML = '<b>' + c.name + '</b><span>' + c.blurb + (best ? ' Best: ' + best + ' / 100' : '') + '</span>';
        box.appendChild(b);
      });
      $('attrib').classList.remove('hidden');
      show('place'); G.state = 'menu';
    }).catch(() => toast('Could not load the airport list (data/airports.json)', 4));
  }
  function searchAirports(q) {
    const box = $('apHits'); box.innerHTML = '';
    if (!DB || !q.trim()) return [];
    const hits = Geo.searchAirports(DB, q, 5);
    hits.forEach(a => { const b = document.createElement('button'); b.className = 'btn slim hit'; b.dataset.act = 'ap:' + a.id; b.innerHTML = '<b>' + a.id + (a.iata ? ' / ' + a.iata : '') + '</b> ' + a.name + (a.city ? ', ' + a.city : '') + ' <i>' + a.country + '</i>'; box.appendChild(b); });
    if (!hits.length) box.innerHTML = '<div class="small">No airport matches. Try an ICAO code (VOBG), an IATA code (BLR) or a city.</div>';
    return hits;
  }
  /** Where the aircraft will appear for a challenge (local x, z) and whether it is airborne. */
  function challengeStart(ch) {
    if (ch.ringsStart) return { x: ch.ringsStart.x, z: ch.ringsStart.z, air: true };
    if (ch.skimStart) return { x: ch.skimStart.x, z: ch.skimStart.z, air: true };
    if (ch.start.kind === 'runway') { const r = ch.start.runway; return { x: r.thr.x, z: r.thr.z, air: false }; }
    return { x: ch.start.x, z: ch.start.z, air: true };
  }
  function beginLoading(ch) {
    const loc = G.place.loc;
    G.rw = { loc, ch };
    useRealWorld(true);
    rw.setLocation(loc, DB);
    const st = challengeStart(ch);
    rw.preload(st.x, st.z, ch.ringsStart || ch.skimStart ? 7000 : 4000);
    // park the aircraft at the start so the streamer loads around it while the bar fills
    const e = loc.airport.elev;
    const sh = (ch.start && ch.start.hdg) || (ch.ringsStart && ch.ringsStart.hdg) || (ch.skimStart && ch.skimStart.hdg) || 0;
    G.s = st.air ? FM.trimState({ speed: 52, gamma: 0, alt: (ch.start && ch.start.alt) || e + 600, x: st.x, z: st.z, heading: sh, gear: false })
      : FM.groundState({ x: st.x, z: st.z, heading: ch.start.runway.hdg, elevation: e });
    G.load = { t: 0, st };
    $('rwlTitle').textContent = loc.name + ': ' + ch.name;
    $('rwlBar').style.width = '0%'; $('rwlText').textContent = 'Starting the download...';
    show('rwload'); G.state = 'rwload';
  }
  function loadingTick(dt) {
    const L = G.load; L.t += dt;
    const r = rw.readiness(L.st.x, L.st.z);
    if (!L.st.air) G.s.pos.y = rw.heightAt(G.s.pos.x, G.s.pos.z) + 1.23;
    const st = rw.stats;
    if (r < 0) { $('rwlText').textContent = 'Could not reach the map servers (offline?). The island in the menu works offline.'; $('rwlBar').style.width = '0%'; return; }
    $('rwlBar').style.width = Math.round(r * 100) + '%';
    $('rwlText').textContent = 'Real terrain and satellite imagery: ' + (st.net + st.cached) + ' tiles (' + (st.bytes / 1048576).toFixed(1) + ' MB downloaded, ' + st.cached + ' from the cache)';
    if (r > 0.995 || (L.t > 40 && r > 0.6)) { G.pending = 'rw'; openCalib(); }
  }
  function startRealWorld() {
    const { loc, ch } = G.rw;
    const w = rwWind();
    const def = Object.assign({}, ch, { id: 'rw:' + loc.id + ':' + ch.id, wind: { fromDeg: 270, kt: WINDS[settings.wind][1] * 1.944, turb: w.turb }, steps: ch.steps.slice() });
    if (ch.skimStart) {
      const k = ch.skimStart;
      lowpassStart(rwT, k.x, k.z, k.hdg);
      def.start = { kind: 'skim' };
    } else if (ch.ringsStart) {
      const rs = ch.ringsStart, c = Missions.ringCourse(rwT, rs.x, rs.z, rs.hdg, 8, 900, 90);   // 900 m apart: real valleys turn hard
      def.steps = c.rings; def.par = 170;
      def.start = { kind: 'air', x: rs.x, z: rs.z, alt: c.startAlt, hdg: c.legs[0].hdg, speed: 52 };
    }
    const st = def.start;
    if (st.kind === 'skim') { /* placed by lowpassStart */ } else if (st.kind === 'runway') {
      const r = st.runway, f = Geo.runwayFrame(r);
      G.s = FM.groundState({ x: r.thr.x + f.dir.x * 30, z: r.thr.z + f.dir.z * 30, heading: r.hdg, elevation: rw.runwayElev(r) });
      input.throttle = 0; input.trim = 0.1; G.ctl.flaps = 0; G.ctl.gear = true;
    } else {
      let alt = st.alt;
      const land = def.steps[def.steps.length - 1];
      if (st.final && land && land.kind === 'land') {   // a 3 degree glide path to the real runway elevation
        const ap = rw.airportById(land.airport), r = ap && ap.runways.find(x => x.name === land.rwy);
        if (r) alt = rw.runwayElev(r) + 1.25 + Math.hypot(land.x - st.x, land.z - st.z) * Math.tan(3 * DEG);
      }
      alt = Math.max(alt, rw.heightAt(st.x, st.z) + 60);
      G.s = FM.trimState({ speed: st.speed || 52, gamma: st.final ? -3 : 0, flaps: st.flaps || 0, alt, x: st.x, z: st.z, heading: st.hdg, gear: !!st.gear });
      input.throttle = G.s.trim.throttle; input.trim = G.s.trim.trim; G.ctl.flaps = st.flaps || 0; G.ctl.gear = !!st.gear;
    }
    G.rwDef = def;
    G.mission = def.steps.length ? Missions.start(def, { onRunway: (id, x, z) => rw.onRunway(x, z, id) }) : null;
    markers.setMission(G.mission ? def : null);
    world.fogBase = loc.airport.elev;
  }
  /** The big card that says what this flight is for, for the first seconds. */
  function showGoal(title, goal, place) {
    const el = $('goalCard');
    el.querySelector('.gc-t').textContent = goal;
    el.querySelector('.gc-s').textContent = place + ' · ' + title + ' · the arrow at the top left points the way';
    el.classList.remove('hidden'); G.goalT = 7;
  }
  /** Runway geometry for approach guidance, island or real: threshold, direction, length, aim, elevation. */
  function runwayGuide(apId, rwyName) {
    if (G.rwMode) {
      const ap = rw.airportById(apId), r = ap && ap.runways.find(x => x.name === rwyName);
      if (!r) return null;
      const f = Geo.runwayFrame(r);
      return { name: r.name, thr: r.thr, dir: f.dir, len: r.len, aimDist: f.aimDist, elev: rw.runwayElev(r) };
    }
    const ap = T.AIRPORTS.find(a => a.id === apId); if (!ap) return null;
    const r = ap.runway;
    if (r.axis === 'z') return { name: r.names[0], thr: { x: r.x, z: r.z1 }, dir: { x: 0, z: -1 }, len: r.z1 - r.z0, aimDist: ap.aimPoint, elev: ap.elev };
    return { name: r.names[0], thr: { x: r.x0, z: r.z }, dir: { x: 1, z: 0 }, len: r.x1 - r.x0, aimDist: ap.aimPoint - r.x0, elev: ap.elev };
  }
  let nearT = 0, nearInfo = null;
  /** The nearest real runway (for the coach in free flight), refreshed once a second. */
  function nearestRunway(s, dt) {
    nearT -= dt; if (nearT > 0 && nearInfo) return nearInfo; nearT = 1;
    let best = null;
    for (const ap of rw.airports || []) for (const r of ap.runways) {
      const d = Math.hypot(r.thr.x - s.pos.x, r.thr.z - s.pos.z);
      if (!best || d < best.d) best = { d, ap, r };
    }
    nearInfo = best ? { name: Geo.shortName(best.ap), rwy: best.r.name, distKm: best.d / 1000, dir: Geo.dirName(Geo.bearing({ x: s.pos.x, z: s.pos.z }, best.r.thr)) } : null;
    return nearInfo;
  }

  // ---------------------------------------------------------------- menus
  function buildMenu() {
    const grid = $('placeGrid'), search = document.querySelector('.ap-search'); grid.innerHTML = '';
    for (const p of Geo.PRESETS) {
      const b = document.createElement('button'); b.className = 'btn place'; b.dataset.act = 'loc:' + p.id;
      b.innerHTML = '<b>' + p.name + '</b><span>' + p.blurb + '</span>';
      grid.appendChild(b);
    }
    if (search) grid.appendChild(search);   // the airport search fills the grid's last cell
    const box = $('missionList'); box.innerHTML = '';
    const lp = document.createElement('button'); lp.className = 'btn hot'; lp.dataset.act = 'lowpass';
    lp.innerHTML = '<b>Low pass<em class="best" data-best="lowpass"></em></b><span>Two minutes skimming the valleys</span>';
    box.appendChild(lp);
    for (const id of ['rings', 'xc', 'crosswind', 'tour', 'night']) {
      const d = missionDefs[id];
      const b = document.createElement('button'); b.className = 'btn'; b.dataset.act = 'm:' + id;
      b.innerHTML = '<b>' + d.name + (id === 'tour' ? '' : '<em class="best" data-best="' + id + '"></em>') + '</b><span>' + (MISSION_TAGS[id] || d.blurb) + '</span>';
      box.appendChild(b);
    }
  }
  /** One short line per mission for the menu card (the full blurb shows when the mission starts). */
  const MISSION_TAGS = { rings: 'Ten rings up a mountain valley', xc: '9 km to Brookfield, by the lake', crosswind: '12 kt gusting across runway 09', tour: 'Lighthouse, lake, summit. No clock', night: 'One circuit by the runway lights' };
  function buildOptions() {
    const box = $('optRows'); box.innerHTML = '';
    OPTIONS.forEach(o => {
      const row = document.createElement('div'); row.className = 'opt'; row.dataset.key = o.key;
      row.innerHTML = '<span class="ol">' + o.label + '</span><span class="ov"><b class="arrow" data-d="-1">&lsaquo;</b><em></em><b class="arrow" data-d="1">&rsaquo;</b></span>';
      row.querySelectorAll('.arrow').forEach(a => a.addEventListener('click', e => { e.stopPropagation(); changeOpt(o, +a.dataset.d); }));
      row.addEventListener('click', () => changeOpt(o, 1));
      box.appendChild(row);
    });
    paintOptions();
  }
  function paintOptions() { OPTIONS.forEach(o => { const r = $('optRows').querySelector('[data-key="' + o.key + '"] em'); if (r) r.textContent = o.fmt(settings[o.key]); }); }
  function changeOpt(o, d) {
    settings[o.key] = o.step(settings[o.key], d);
    paintOptions(); save(); AudioFX.blip(700);
    if (o.key === 'volume') AudioFX.setVolume(settings.volume / 10);
    if (o.key === 'quality') { G.autoLow = G.autoLowRw = false; onResize(); }
    if (o.key === 'mapDetail') applyQuality();
    if (o.key === 'tod' && !(G.mission && G.mission.def.hours !== undefined)) { G.hours = TOD[settings.tod][1]; world.setTime(G.hours); }
    if (o.key === 'wind' && G.s && !G.mission) { const w = freeWind(); env.wind = { x: w.x, y: 0, z: w.z }; env.turbulence = w.turb; }
  }
  let optionsBack = 'menu';
  function openOptions(from) { optionsBack = from; show('options'); }

  function menuAction(act) {
    AudioFX.blip(880);
    if (act.startsWith('m:')) { G.pending = act; openCalib(); return; }
    if (act.startsWith('loc:')) { openPlace(Geo.PRESETS.find(p => p.id === act.slice(4))); return; }
    if (act.startsWith('ap:')) { openPlace({ airport: act.slice(3) }); return; }
    if (act.startsWith('ch:')) { beginLoading(G.place.chs.find(c => c.id === act.slice(3))); return; }
    if (act === 'apGo') {
      loadDB().then(() => {
        const q = $('apCode').value.trim().toLowerCase(), h = searchAirports(q);
        if (h.length === 1 || (h[0] && (h[0].id.toLowerCase() === q || (h[0].iata || '').toLowerCase() === q))) openPlace({ airport: h[0].id });
      });
      return;
    }
    if (act === 'rwCancel') { toMenu(); return; }
    switch (act) {
      case 'runway': case 'air': case 'landing': case 'lowpass': case 'tutorial': G.pending = act; openCalib(); break;
      case 'options': openOptions('menu'); break;
      case 'rumble': mc.enableRumble({ ask: true }).then(ok => { paintMenu(); toast(ok ? 'Phone vibration on' : 'Vibration not available (Chrome + WebHID needed)'); }); break;
      case 'back': if (G.screen === 'options') { if (optionsBack === 'pause') show('pause'); else show('menu'); } else if (G.screen === 'place' || G.screen === 'rwload') toMenu(); break;
      case 'fly': beginFlight(); break;
      case 'resume': resume(); break;
      case 'restart': startMode(G.mode); break;
      case 'pauseOptions': openOptions('pause'); break;
      case 'quit': toMenu(); break;
      case 'retry': startMode(G.mode); break;
    }
  }
  function toMenu() { G.state = 'menu'; window.onbeforeunload = null; $('goalCard').classList.add('hidden'); $('attrib').classList.toggle('hidden', !G.rwMode); $('legend').classList.add('hidden'); $('objective').classList.add('hidden'); markers.setMission(null); paintMenu(); show('menu');
    // never flown the lesson: the cursor starts on it
    let done = false; try { done = !!localStorage.getItem('gyrowing.tutorialDone'); } catch (e) { /* ignore */ }
    if (!done) { const f = focusables(), i = f.findIndex(e => e.dataset.act === 'tutorial'); if (i >= 0) { G.focus = i; refreshFocus(); } }
  }
  function paintMenu() {
    const pad = mimicPadConnected();
    const wrong = !pad && motionPhoneConnected();
    $('phoneStatus').innerHTML = pad ? '<i class="dot on"></i><span>Pad connected: D-pad to move, A to choose</span>'
      : wrong ? '<i class="dot warn"></i><span>That is the Wand/Grip screen: switch the phone to <b>Pad</b>.</span>'
        : '<i class="dot"></i><span>No phone: open Mimic, choose <b>Pad</b>. Keyboard works too.</span>';
    const best = getBest('landing');
    $('bestScore').textContent = best ? best + ' / 100' : 'not flown yet';
    document.querySelectorAll('[data-best]').forEach(e => { const b = getBest(e.dataset.best); e.textContent = b ? 'best ' + b : 'not flown'; e.classList.toggle('none', !b); });
    $('rumbleBtn').textContent = mc.rumbleReady ? 'Phone vibration: on' : 'Enable phone vibration';
    $('rumbleBtn').classList.toggle('hidden', !navigator.hid);
  }
  // flown with the Pad, keyboard or a gamepad: nothing to calibrate, straight into the flight
  function openCalib() { beginFlight(); }
  function mimicPadConnected() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && /mimic/i.test(p.id) && p.buttons.length >= 16) return true;
    return false;
  }
  function beginFlight() { if (G.pending) startMode(G.pending); }
  /** A Mimic Wand/Grip (motion report) is paired but no Pad: the phone is on the wrong screen. */
  function motionPhoneConnected() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.buttons.length === 12 && p.axes.length >= 6) return true;
    return false;
  }
  /** Mimic family badge (top right) and device hint bar (bottom), in the words of what is in hand. */
  let famKey = '';
  function paintFamily() {
    const pad = mimicPadConnected(), wrong = !pad && motionPhoneConnected();
    const scr = G.state === 'pause' ? G.screen : G.state;
    const menuish = ['title', 'menu', 'options', 'pause', 'crash', 'result', 'place', 'rwload'].indexOf(scr) >= 0;
    const kb = (k, t) => '<span><kbd>' + k + '</kbd>' + t + '</span>';
    let hint = '';
    if (pad || !wrong) {
      const P = pad || /pad/i.test(input.lastSource);
      const nav = P ? kb('D-pad', 'move') : kb('↑ ↓', 'move'), ok = P ? 'A' : 'Enter', back = P ? 'B' : 'Esc';
      if (scr === 'menu') hint = nav + kb(ok, 'choose');
      else if (scr === 'options') hint = nav + kb(P ? '◀ ▶' : '← →', 'change') + kb(back, 'done');
      else if (scr === 'place') hint = nav + kb(ok, 'fly') + kb(back, 'back');
      else if (scr === 'rwload') hint = kb(back, 'cancel');
      else if (scr === 'pause') hint = nav + kb(ok, 'choose') + kb(back, 'resume');
      else if (scr === 'crash') hint = kb(ok, 'try again') + kb(back, 'main menu');
      else if (scr === 'result') hint = nav + kb(ok, 'choose');
    }
    const badge = pad ? 'on|Pad connected' : wrong ? 'warn|Switch the phone to Pad' : '|No Pad: keyboard';
    const key = scr + '|' + menuish + '|' + hint + '|' + badge;
    if (key === famKey) return;
    famKey = key;
    const [cls, txt] = badge.split('|');
    const b = $('mbadge');
    b.className = 'mimic-badge ' + cls + (menuish ? '' : ' hidden');
    b.querySelector('span').textContent = txt;
    $('mhint').innerHTML = hint;
    $('mhint').classList.toggle('hidden', !hint || !menuish);
    $('titlePress').innerHTML = pad ? '<kbd>A</kbd>Press A to start' : wrong ? 'Switch the phone to Mimic’s Pad screen' : '<kbd>Any key</kbd>Press a key or button';
  }
  function pause() { if (G.state !== 'fly') return; G.state = 'pause'; show('pause'); $('legend').classList.add('hidden'); }
  function resume() { hideScreens(); G.state = 'fly'; $('legend').classList.toggle('hidden', !G.legend || G.legendT <= 0); }

  document.addEventListener('click', e => {
    AudioFX.init();
    const b = e.target.closest('[data-act]'); if (b) menuAction(b.dataset.act);
  });
  addEventListener('keydown', () => AudioFX.init());
  addEventListener('mousedown', () => AudioFX.init());

  addEventListener('mousedown', e => { if (G.state === 'fly' || G.state === 'crash' || G.state === 'result') { G.orbit.drag = true; G.orbit.mx = e.clientX; G.orbit.my = e.clientY; } });
  addEventListener('mouseup', () => { G.orbit.drag = false; });
  addEventListener('mousemove', e => {
    if (!G.orbit.drag) return;
    G.orbit.yaw -= (e.clientX - G.orbit.mx) * 0.006; G.orbit.pitch = clamp(G.orbit.pitch + (e.clientY - G.orbit.my) * 0.004, -0.3, 1.3);
    G.orbit.mx = e.clientX; G.orbit.my = e.clientY; G.orbit.idle = 0;
  });

  function handleMenuInput(a) {
    const f = focusables();
    if (a.has('navUp')) { G.focus = (G.focus - 1 + f.length) % Math.max(1, f.length); refreshFocus(); AudioFX.blip(600); }
    if (a.has('navDown')) { G.focus = (G.focus + 1) % Math.max(1, f.length); refreshFocus(); AudioFX.blip(600); }
    const el = f[G.focus];
    if (el && el.classList.contains('opt') && (a.has('navLeft') || a.has('navRight'))) {
      changeOpt(OPTIONS.find(o => o.key === el.dataset.key), a.has('navLeft') ? -1 : 1);
    }
    if (a.has('confirm') || a.has('confirmSoft')) { if (el) { if (el.dataset.act) menuAction(el.dataset.act); else if (el.classList.contains('opt')) changeOpt(OPTIONS.find(o => o.key === el.dataset.key), 1); } }
    if (a.has('back') || (a.has('pause') && G.screen !== 'pause')) menuAction('back');
  }

  // ---------------------------------------------------------------- legend
  function updateLegend() {
    const pad = /pad/i.test(input.lastSource) || mimicPadConnected();
    const rows = pad ? [
      ['Left stick', 'pitch and roll'], ['R2 or A (hold)', 'more power'], ['L2 or B (hold)', 'less power, brakes'],
      ['D-pad ◀ ▶', 'flaps up / down'], ['X', 'gear'], ['Right stick ← →', 'rudder'], ['L1 / R1', 'trim'],
      ['Flick stick twice', 'barrel roll / loop'], ['Y', 'camera'], ['START', 'pause'],
    ] : [
      ['W S / ↑ ↓', 'pitch'], ['A D / ← →', 'roll'], ['Q E', 'rudder'], ['Shift / Ctrl', 'throttle'],
      ['F / V', 'flaps down / up'], ['G', 'gear'], ['Space', 'brakes'], ['[ ]', 'trim'], ['1 / 2', 'barrel roll / loop'], ['C', 'camera'], ['Esc', 'pause'], ['H', 'show / hide this'],
    ];
    $('legendRows').innerHTML = rows.map(r => '<div><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('');
    $('legendTitle').textContent = pad ? 'Pad controls' : 'Keyboard';
  }

  // ---------------------------------------------------------------- flight events
  function handleEvents(s) {
    for (const e of s.events) {
      switch (e.type) {
        case 'touchdown': {
          AudioFX.chirp(e.sink, e.speed);
          rumble(clamp(0.25 + e.sink / 2.5, 0.25, 1), 70 + e.sink * 50, 0);
          G.shake = Math.max(G.shake, clamp(e.sink / 4, 0.08, 0.7));
          G.head.y -= clamp(e.sink * 0.03, 0.01, 0.09);
          const p = new THREE.Vector3();
          for (const sx of [-1.4, 1.4]) { p.set(sx, -1.25, 0.35).applyQuaternion(plane.root.quaternion).add(plane.root.position); puffs.spawn(p, new THREE.Vector3(s.vel.x * 0.2, 0.3, s.vel.z * 0.2), 0.6, 3.5, 1.4, 0xd8d8d8, 0.55); }
          if (e.sink > 2.3) toast('Hard landing: ' + Math.round(e.sink * 196.85) + ' fpm');
          if (G.landing) landingTouch(e);
          if (G.mission && !G.mission.touch) G.mission.touch = { fpm: e.sink * 196.85 };
          if (G.rwMode && !G.mission) { const r = rw.runwayAt(e.x, e.z, 3); if (r) toast('Touchdown on runway ' + r.name + ' at ' + Geo.shortName(rw.airportById(r.airport)) + ': ' + Math.round(e.sink * 196.85) + ' fpm', 4); }
          break;
        }
        case 'gear':
          if (e.phase === 'start') { AudioFX.motor(FM.AIRCRAFT.gearTime * 0.95, 140); AudioFX.clunk(0.4); rumble(0.3, 50, 0); }
          else { AudioFX.clunk(0.9); rumble(0.55, 70, 0); G.shake = Math.max(G.shake, 0.08); toast(e.down ? 'Gear down, three green' : 'Gear up'); }
          break;
        case 'tailstrike': AudioFX.clunk(0.5); rumble(0.6, 120, 1); toast('Tail strike! Ease the nose up gently'); break;
        case 'gearBlocked': G.ctl.gear = true; G.warn.blockT = 2; AudioFX.blip(300); break;
        case 'flaps':
          if (e.phase === 'start') { AudioFX.motor(1.4, 210); rumble(0.15, 40, 0); }
          else { AudioFX.clunk(0.35); rumble(0.3, 45, 0); }
          break;
        case 'crash': onCrash(e.reason); break;
      }
    }
    s.events.length = 0;
  }

  function onCrash(reason) {
    if (G.state !== 'fly') return;
    $('legend').classList.add('hidden');
    G.state = 'crashing'; G.crashT = 0;
    AudioFX.crash(); rumble(1, 255, 3); setTimeout(() => rumble(0.8, 200, 0), 300);
    G.shake = 1;
    G.crashReason = reason;
    G.wreckV = new THREE.Vector3(G.s.vel.x, Math.min(0, G.s.vel.y), G.s.vel.z);
    if (G.landing && !G.landing.done) { G.landing.done = true; G.landing.crash = reason; }
    window.onbeforeunload = null;
  }

  function landingTouch(e) {
    const L = G.landing;
    L.touches++;
    if (L.first) return;
    const AP = T.AIRPORT;
    const onRwy = T.onRunway(e.x, e.z);
    const fpm = e.sink * 196.85, centre = Math.abs(e.z), dist = e.x - AP.aimPoint;
    const sinkScore = Math.round(40 * clamp(1 - (fpm - 120) / 480, 0, 1));
    const centreScore = Math.round(30 * clamp(1 - centre / 10, 0, 1));
    const distScore = e.x < AP.runway.x0 ? 0 : Math.round(30 * clamp(1 - Math.abs(dist) / 320, 0, 1));
    L.first = { fpm, centre, dist, kt: e.speed * 1.944, onRwy, sinkScore, centreScore, distScore };
  }

  function showResult(id, title, score, rows) {
    let best = getBest(id);
    if (score > best) { best = score; setBest(id, best); }
    $('resTitle').textContent = title;
    $('resScore').textContent = score;
    $('resBest').textContent = 'best ' + best;
    $('resRows').innerHTML = rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('');
    G.state = 'result'; show('result'); AudioFX.chime();
    $('objective').classList.add('hidden');
    window.onbeforeunload = null;
  }
  function finishLanding() {
    const L = G.landing; if (!L || L.shown) return;
    L.shown = true;
    let score = 0, title, rows = [];
    if (L.crash) { title = 'Crashed: ' + L.crash; }
    else if (!L.first) { title = 'No touchdown'; }
    else {
      const f = L.first;
      const bounces = Math.max(0, L.bounces || 0);
      score = f.onRwy ? Math.max(0, f.sinkScore + f.centreScore + f.distScore - bounces * 8) : 0;
      title = !f.onRwy ? 'Missed the runway' : score >= 90 ? 'Greaser' : score >= 75 ? 'Smooth landing' : score >= 55 ? 'Firm but fair' : score >= 30 ? 'You walked away' : 'Rough arrival';
      rows = [
        ['Sink rate', Math.round(f.fpm) + ' fpm', f.sinkScore + ' / 40'],
        ['Off centreline', f.centre.toFixed(1) + ' m', f.centreScore + ' / 30'],
        ['From aiming point', (f.dist >= 0 ? '+' : '') + Math.round(f.dist) + ' m', f.distScore + ' / 30'],
        ['Touchdown speed', Math.round(f.kt) + ' kt', ''],
      ];
      if (bounces) rows.push(['Bounces', String(bounces), '-' + bounces * 8]);
    }
    showResult('landing', title, score, rows);
  }
  function finishMission() {
    const ms = G.mission; if (!ms || ms.shown) return;
    ms.shown = true;
    const r = Missions.result(ms);
    showResult(ms.def.id, ms.def.name + ': ' + r.title, r.score, r.rows);
  }

  // ---------------------------------------------------------------- mission tick
  function missionTick(s, dt) {
    const ms = G.mission; if (!ms || ms.done) return;
    const ev = Missions.update(ms, { x: s.pos.x, y: s.pos.y, z: s.pos.z, onGround: s.onGround, gs: s.groundSpeed, agl: s.agl }, dt);
    for (const e of ev) {
      if (e.type === 'step') {
        if (e.ok) {
          AudioFX.chime(); rumble(0.6, 90, 0);
          if (e.step.kind === 'ring') toast('Ring ' + (e.index + 1) + ' ✓', 1.2);
          else if (e.step.say) toast(e.step.say, 7);
        } else { AudioFX.blip(220); toast('Missed ring ' + (e.index + 1), 1.6); }
      }
      if (e.type === 'complete' || e.type === 'fail') setTimeout(finishMission, e.type === 'fail' ? 300 : 900);
    }
  }
  function objectiveInfo(s, att) {
    const ms = G.mission;
    if (G.lowpass) {
      const t = Math.ceil(G.lowpass.t), clock = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      return { title: 'Low pass' + (G.rwMode ? ' · ' + G.rw.loc.name : ''), progress: clock, text: 'Under 200 ft and over 70 kt builds a chain. Climb away to bank it', kind: 'free' };
    }
    if (ms) {
      const o = Missions.objective(ms, { x: s.pos.x, y: s.pos.y, z: s.pos.z }, att.heading);
      const st = ms.def.steps[Math.min(ms.i, ms.def.steps.length - 1)];
      let crosswind = null;
      if (st.kind === 'land' && st.rwyHdg !== undefined) {
        const w = env.wind, wf = Math.atan2(-w.x, w.z) / DEG;   // direction the wind comes from
        const rel = ((wf - st.rwyHdg + 540) % 360) - 180, kt = Math.hypot(w.x, w.z) * 1.944;
        if (Math.abs(Math.sin(rel * DEG)) * kt > 5) crosswind = rel < 0 ? 'left' : 'right';
      }
      const rings = ms.def.steps.filter(x => x.kind === 'ring').length;
      return Object.assign(o, { idx: ms.i + 1, total: rings || ms.def.steps.length, crosswind });
    }
    if (G.rwMode) return { title: G.rw.loc.name + ' · ' + G.rwDef.name, text: G.rwDef.goal, progress: '', kind: 'free' };
    // the classic modes get a simple objective too
    const AP = T.AIRPORT;
    if (G.mode === 'landing') return { title: 'Landing challenge', text: 'Land on runway 09 near the aiming point', progress: '', distM: Math.max(0, AP.runway.x0 - s.pos.x), relBearing: 0, kind: 'land' };
    if (G.mode === 'runway') return { title: 'Takeoff', text: s.agl * 3.281 < 1000 ? 'Take off and climb to 1,000 ft' : 'Free flight: explore, then land on runway 09', progress: '', kind: 'free' };
    return { title: 'Free flight', text: 'Explore the island. Runway 09 is at the centre of the valley', progress: '', kind: 'free' };
  }
  let objT = 0;
  function paintObjective(o, dt) {
    objT -= dt; if (objT > 0) return; objT = 0.15;
    const el = $('objective');
    el.classList.remove('hidden');
    el.querySelector('.ob-title').textContent = o.title + (o.progress ? '   ' + o.progress : '');
    el.querySelector('.ob-text').textContent = o.text;
    const nav = el.querySelector('.ob-nav');
    if (o.distM && (o.kind === 'ring' || o.kind === 'waypoint' || o.kind === 'land') && !o.done) {
      nav.classList.remove('hidden');
      nav.querySelector('.ob-arrow').style.transform = 'rotate(' + Math.round(o.relBearing || 0) + 'deg)';
      nav.querySelector('.ob-dist').textContent = o.distM >= 1000 ? (o.distM / 1000).toFixed(1) + ' km' : Math.round(o.distM) + ' m';
      const turn = Math.abs(o.relBearing || 0) < 8 ? 'ahead' : (o.relBearing < 0 ? 'left ' : 'right ') + Math.round(Math.abs(o.relBearing)) + '°';
      nav.querySelector('.ob-turn').textContent = turn + (o.altFt ? '  ·  ' + (Math.round(o.altFt / 50) * 50).toLocaleString('en-US') + ' ft' : '');
    } else nav.classList.add('hidden');
  }

  // ---------------------------------------------------------------- skim: the low-flying score
  let wallT = 0, walls = 0, skimRumT = 0;
  /** How many sides (0..2) have ground above the aircraft within ~250 m: flying a valley. */
  function sampleWalls(s, hdg) {
    const r = { x: Math.cos(hdg * DEG), z: Math.sin(hdg * DEG) };
    let n = 0;
    for (const side of [-1, 1]) {
      let hi = -1e9;
      for (const d of [110, 180, 250]) hi = Math.max(hi, T.heightAt(s.pos.x + r.x * d * side, s.pos.z + r.z * d * side));
      if (hi > s.pos.y - 5) n++;
    }
    return n;
  }
  function skimTick(s, dt) {
    const sk = G.skim; if (!sk) return;
    const att = FM.attitude(s);
    wallT -= dt; if (wallT <= 0) { wallT = 0.15; walls = s.onGround ? 0 : sampleWalls(s, att.heading); }
    const ev = Skim.update(sk, { agl: s.agl, kt: s.airspeed * 1.944, onGround: s.onGround, crashed: s.crashed, walls, p: s.omega.x, q: s.omega.y, bank: att.bank, pitch: att.pitch }, dt);
    for (const e of ev) {
      if (e.type === 'mult') { AudioFX.step(e.mult); rumble(0.25 + e.mult * 0.05, 50, 0); pop('x' + e.mult, 'mult'); }
      else if (e.type === 'bonus') {
        pop(e.label + '  +' + e.pts.toLocaleString('en-US'), e.kind);
        if (e.kind === 'ridge' || e.kind === 'thread') AudioFX.whoosh(0.8); else AudioFX.chime();
        rumble(0.6, 110, 0);
      } else if (e.type === 'banked' && e.pts >= 50) { pop('+' + e.pts.toLocaleString('en-US') + ' banked', 'banked'); AudioFX.chime(); rumble(0.4, 80, 0); }
      else if (e.type === 'lost' && e.pts > 0) pop('Chain lost', 'lost');
    }
    // the phone ticks faster and harder the lower you skim
    skimRumT -= dt;
    if (sk.low > 0.35 && skimRumT <= 0 && !s.crashed) { rumble(0.12 + 0.35 * sk.low, 45, 0); skimRumT = 0.55 - 0.35 * sk.low; }
    // stunts the assist flew (or refused) for a double flick
    const stuntOn = !!(s.ap && s.ap.stunt);
    if (stuntOn && !G.stuntOn) { rumble(0.45, 80, 0); AudioFX.whoosh(0.5); }
    G.stuntOn = stuntOn;
    G.refusedT = Math.max(0, (G.refusedT || 0) - dt);
    if (s.ap && s.ap.refused) {
      if (!G.refusedT) toast(s.ap.refused === 'low' ? 'Stunts need 500 ft of air under you' : s.ap.refused === 'loop' ? 'Loop: dive past 125 kt first, then try again' : 'Roll: get above 80 kt first', 2.5);
      s.ap.refused = null; G.refusedT = 8;
    }
  }
  function lowpassTick(dt) {
    const L = G.lowpass; if (!L || L.done) return;
    L.t -= dt;
    if (L.t <= 10 && Math.ceil(L.t) !== Math.ceil(L.t + dt)) AudioFX.blip(L.t <= 0.5 ? 1200 : 760);
    if (L.t <= 0) {
      L.done = true; L.t = 0;
      Skim.finish(G.skim);
      const r = Skim.result(G.skim, 10000);
      const id = G.rwMode ? 'rw:' + G.rw.loc.id + ':lowpass' : 'lowpass';
      setTimeout(() => { if (G.state === 'fly') showResult(id, 'Low pass: ' + r.title, r.score, r.rows); }, 400);
    }
  }
  /** A floating callout beside the skim meter. */
  function pop(text, kind) {
    const box = $('pops'); if (!box) return;
    const el = document.createElement('div'); el.className = 'pop ' + (kind || ''); el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 1900);
  }
  let skimPaintT = 0;
  function paintSkim(dt, show) {
    skimPaintT -= dt; if (skimPaintT > 0) return; skimPaintT = 0.08;
    const el = $('skim'), sk = G.skim;
    const on = show && sk && (sk.active || sk.total > 0 || G.lowpass);
    el.classList.toggle('hidden', !on);
    if (!on) return;
    el.classList.toggle('live', sk.active);
    el.style.setProperty('--low', sk.low.toFixed(2));
    el.querySelector('.sk-mult').textContent = sk.active ? 'x' + sk.mult : 'SKIM';
    el.querySelector('.sk-pts').textContent = Math.round(sk.active ? sk.chain : sk.total).toLocaleString('en-US');
    el.querySelector('.sk-sub').textContent = sk.active ? (sk.outT > 0 ? 'climbing: banks in ' + Math.max(0, Skim.CFG.grace - sk.outT).toFixed(1) + ' s' : 'chain') : 'total';
    const next = sk.mult >= Skim.CFG.maxMult ? 1 : (sk.chainT % Skim.CFG.multEvery) / Skim.CFG.multEvery;
    el.querySelector('.sk-bar i').style.transform = 'scaleX(' + (sk.active ? next : 0).toFixed(3) + ')';
    el.querySelector('.sk-total').textContent = sk.active && sk.total ? 'total ' + Math.round(sk.total).toLocaleString('en-US') : '';
  }

  // ---------------------------------------------------------------- the controller guide and the first flight
  const guide = new Guide($('guide'));
  /** Which picture to show: the Mimic Pad, a standard gamepad, or the keyboard. */
  function deviceKind() { return mimicPadConnected() ? 'pad' : /gamepad|pad/i.test(input.lastSource) ? 'gamepad' : 'kbm'; }
  function tutorialTick(s, inp, dt) {
    const tu = G.tutorial; if (!tu) return;
    const att = FM.attitude(s);
    tu.device = Tutorial.WORDS[deviceKind()] ? deviceKind() : tu.device;
    const ev = Tutorial.update(tu, { thr: G.ctl.throttle, sx: inp.aileron, sy: inp.elevator, vsFpm: s.vel.y * 196.85, bank: att.bank, hdg: att.heading, aglFt: s.agl * 3.281, skim: G.skim && G.skim.active }, dt);
    for (const e of ev) {
      if (e.type === 'step') { AudioFX.chime(); rumble(0.5, 90, 0); G.tuFlash = 0.6; }
      if (e.type === 'done') { G.tutorialEnd = 7; try { localStorage.setItem('gyrowing.tutorialDone', '1'); } catch (er) { /* ignore */ } }
    }
    const v = Tutorial.view(tu), el = $('tutorial');
    G.tuFlash = Math.max(0, (G.tuFlash || 0) - dt);
    el.classList.toggle('ok', G.tuFlash > 0 || tu.done);
    el.querySelector('.tu-k').textContent = tu.done ? 'First flight · done' : 'First flight · step ' + (v.index + 1) + ' of ' + v.total;
    el.querySelector('.tu-t').textContent = v.title;
    el.querySelector('.tu-x').textContent = v.text;
    el.querySelector('.tu-bar i').style.transform = 'scaleX(' + v.progress.toFixed(3) + ')';
    G.guideShow = v.show;
    if (tu.done && (G.tutorialEnd -= dt) <= 0) { G.tutorial = null; el.classList.add('hidden'); toast('Free flight: the island is yours. Pause for the menu', 4); }
  }
  let guideT = 0;
  function paintGuide(dt, flying, inp) {
    const on = flying && (G.tutorial || settings.guide === 2 || (settings.guide === 1 && (G.flyT || 0) < 30));
    $('guide').classList.toggle('hidden', !on);
    if (!on) return;
    guideT -= dt; if (guideT > 0) return; guideT = 1 / 30;
    guide.update({ device: deviceKind(), raw: input.raw, keys: input.keys, thr: G.ctl.throttle, elev: inp.elevator, ail: inp.aileron, show: G.tutorial ? G.guideShow : [] });
  }

  // ---------------------------------------------------------------- camera
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpQ2 = new THREE.Quaternion();
  function updateCamera(dt) {
    const s = G.s, pos = plane.root.position, q = plane.root.quaternion;
    const view = (G.state === 'crashing' || G.state === 'crash' || G.state === 'result') ? 'external' : (G.state === 'menu' || G.state === 'title' || G.state === 'options' || G.state === 'rwload') ? 'showcase' : G.view;
    plane.setCockpit(view === 'cockpit');
    camera.near = view === 'cockpit' ? 0.05 : 0.3;
    // the sense of motion: G pushes the head down, gusts and the runway jolt it, the engine buzzes it
    const flying = s && !s.crashed && G.state === 'fly';
    const gl = flying ? (s.onGround ? 1 : s.gload) : 1;
    const feelT = flying && !s.onGround ? speedFeel(s.airspeed * 1.944, s.agl) : 0;
    G.feel = (G.feel || 0) + (feelT - (G.feel || 0)) * (1 - Math.exp(-dt * 2.5));
    const H = G.head;
    if (flying && s.gust) {
      const g = s.gust, pg = G.prevGust || { x: g.x, y: g.y, z: g.z };
      G.bump += (Math.abs(g.y - pg.y) * 0.12 + Math.abs(g.x - pg.x) * 0.03 + Math.abs(g.z - pg.z) * 0.03);
      G.prevGust = { x: g.x, y: g.y, z: g.z };
    }
    G.bump = Math.max(0, G.bump * Math.exp(-dt * 6));
    const wantY = -clamp((gl - 1) * 0.022, -0.04, 0.09);
    H.y += (wantY - H.y) * (1 - Math.exp(-dt * 5));
    if (view === 'cockpit') {
      const att = FM.attitude(s);
      const wantLook = clamp(-att.bank * 0.25, -12, 12) * (s.onGround ? 0 : 1);     // look into the turn
      H.look += (wantLook - H.look) * (1 - Math.exp(-dt * 1.5));
      tmpV.copy(Cockpit.EYE); tmpV.y += H.y;
      if (flying) {
        const vib = (0.0006 + 0.0012 * s.power) * (s.rpm > 400 ? 1 : 0);
        tmpV.x += (Math.random() - 0.5) * vib; tmpV.y += (Math.random() - 0.5) * vib + (Math.random() - 0.5) * G.bump * 0.05;
      }
      tmpV.applyQuaternion(q).add(pos);
      camera.position.copy(tmpV);
      tmpE.set(-9 * DEG + (Math.random() - 0.5) * G.bump * 0.01, H.look * DEG, 0); tmpQ2.setFromEuler(tmpE);
      camera.quaternion.copy(q).multiply(tmpQ2);
      camera.fov = 70 / G.zoom + 5 * G.feel;
    } else if (view === 'chase') {
      const k = 1 - Math.exp(-dt * (s.onGround ? 6 : 3.2));
      G.camQ.slerp(q, k);
      // fast and low, the camera tucks in closer and lower: the ground rushes past
      const d = 13.5 * G.zoom * (1 - 0.14 * G.feel);
      tmpV.set(0, 2.2 + d * 0.07 - 0.6 * G.feel, d).applyQuaternion(G.camQ);
      camera.position.copy(pos).add(tmpV);
      camera.position.y -= H.y * 6;
      tmpV2.set(0, 2.1, -14).applyQuaternion(q).add(pos);
      const up = tmpV.set(0, 1, 0).applyQuaternion(G.camQ).lerp(upV, 0.35).normalize();
      camera.up.copy(up);
      camera.lookAt(tmpV2);
      camera.fov = 60 + clamp((s.airspeed - 30) * 0.12, 0, 8) + 7 * G.feel;   // wider as the speed builds, more on the deck
    } else {
      const o = G.orbit;
      if (!o.drag) { o.idle += dt; if (o.idle > 2) o.yaw += dt * 0.12; }
      const dist = (view === 'showcase' ? 16 : o.dist) * (view === 'showcase' ? 1 : G.zoom);
      const yaw = view === 'showcase' ? G.time * 0.07 : o.yaw;
      const pitch = view === 'showcase' ? 0.12 : o.pitch;
      camera.position.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * dist, pos.y + Math.sin(pitch) * dist + 1, pos.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.up.set(0, 1, 0);
      camera.lookAt(pos.x, pos.y + (view === 'showcase' ? 0.8 : 0), pos.z);
      camera.fov = view === 'showcase' ? 40 : 55;
    }
    const gh = T.heightAt(camera.position.x, camera.position.z);
    const minY = Math.max(gh, 0) + (view === 'cockpit' ? -10 : 0.7);
    if (camera.position.y < minY) camera.position.y = minY;
    // shake: touchdowns, buffet, crashes, runway rumble, turbulence
    const buffet = s && !s.crashed ? s.stall * 0.5 + (s.onGround ? clamp(s.groundSpeed / 40, 0, 1) * (T.surfaceAt(s.pos.x, s.pos.z) === 'paved' ? 0.05 : 0.2) : 0) + G.bump * 0.6 : 0;
    const amp = (G.shake + buffet + G.feel * 0.12) * (view === 'cockpit' ? 0.02 : 0.08);
    if (amp > 0.0005) {
      camera.position.x += (Math.random() - 0.5) * amp; camera.position.y += (Math.random() - 0.5) * amp; camera.position.z += (Math.random() - 0.5) * amp;
      camera.rotateZ((Math.random() - 0.5) * amp * 0.3);
    }
    G.shake = Math.max(0, G.shake - dt * 1.5);
    camera.updateProjectionMatrix();
    // G vignette: tunnel at high G, a red tint pushing negative
    const vg = $('vignette');
    const vAmt = flying ? clamp((gl - 2.4) / 2, 0, 0.85) : 0, red = flying ? clamp((-gl - 0.2) / 1.2, 0, 0.6) : 0;
    vg.style.opacity = Math.max(vAmt, red).toFixed(2);
    vg.style.background = red > vAmt ? 'radial-gradient(ellipse at center, rgba(120,0,0,0) 40%, rgba(120,0,0,0.85) 100%)' : 'radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.92) 100%)';
  }

  function syncPlane(dt) {
    const s = G.s;
    plane.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    plane.root.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
    plane.update(s, dt, world.night, G.view === 'cockpit' && G.state === 'fly');
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, skyT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    // real time down to 10 fps: the physics substeps at 240 Hz, so a slow frame is still exact
    // (the user's recording ran at ~8 fps and a 0.05 s cap made the world run at half speed)
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000)); last = now;
    G.time += dt;
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    adaptResolution(dt, fps);
    mc.update(now);
    const flying = G.state === 'fly';
    const inp = input.update(dt, flying);
    const a = inp.actions;
    if ((a.size || mc.connected) && !AudioFX.created) AudioFX.init();

    if (G.state === 'title') {
      if (a.size) { AudioFX.init(); AudioFX.chime(); toMenu(); }
    } else if (G.state === 'menu' || G.state === 'options' || (G.state === 'pause' && G.screen === 'options')) {
      handleMenuInput(a);
      if (G.screen === 'menu' && Math.floor(G.time * 2) !== Math.floor((G.time - dt) * 2)) paintMenu();
    } else if (G.state === 'pause') {
      handleMenuInput(a);
      if (a.has('pause') || a.has('back')) resume();
    } else if (G.state === 'crash') {
      if (a.has('confirm') || a.has('confirmSoft') || a.has('restart')) startMode(G.mode);
      else if (a.has('back') || a.has('pause')) toMenu();
    } else if (G.state === 'result') {
      handleMenuInput(a);
    } else if (G.state === 'rwload') {
      loadingTick(dt);
      if (a.has('back')) toMenu();
    }

    // ---- flight
    const s = G.s;
    if (flying) {
      if (a.has('pause')) pause();
      if (a.has('camera')) { G.view = { chase: 'cockpit', cockpit: 'external', external: 'chase' }[G.view]; G.orbit.idle = 0; toast({ chase: 'Chase view', cockpit: 'Cockpit view', external: 'External view: drag to orbit' }[G.view], 1.2); }
      if (a.has('gear')) { G.ctl.gear = !G.ctl.gear; }
      if (a.has('flapsDown') && G.ctl.flaps < 3) { G.ctl.flaps++; toast('Flaps ' + ['up', '10', '20', '30'][G.ctl.flaps], 1); }
      if (a.has('flapsUp') && G.ctl.flaps > 0) { G.ctl.flaps--; toast('Flaps ' + ['up', '10', '20', '30'][G.ctl.flaps], 1); }
      if (a.has('restart')) startMode(G.mode);
      if (a.has('legend')) { const show = $('legend').classList.contains('hidden'); G.legend = show; G.legendT = show ? 1e9 : -2; $('legend').classList.toggle('hidden', !show); }
      if (a.has('zoomIn')) G.zoom = clamp(G.zoom * 1.12, 0.5, 2.2);
      if (a.has('zoomOut')) G.zoom = clamp(G.zoom / 1.12, 0.5, 2.2);
      const c = G.ctl;
      c.elevator = inp.elevator; c.aileron = inp.aileron; c.rudder = inp.rudder;
      c.throttle = inp.throttle; c.trim = inp.trim; c.brake = inp.brake;
      c.stunt = a.has('rollRight') ? 'rollRight' : a.has('rollLeft') ? 'rollLeft' : a.has('loop') ? 'loop' : null;
      const ctl = FM.applyAssists(s, c, { autoRudder: settings.autoRudder, level: settings.assist, dt });
      if (G.state === 'fly') FM.step(s, ctl, dt, env);
      if (!s.crashed && s.agl < 40 && !G.rwMode) {
        for (const p of [[0, 0, 0], [5.4, -0.2, 0.3], [-5.4, -0.2, 0.3], [0, 0.2, -2.0]]) {
          tmpV.set(p[0], p[1], p[2]).applyQuaternion(plane.root.quaternion);
          const hit = world.obstacleHit(s.pos.x + tmpV.x, s.pos.y + tmpV.y, s.pos.z + tmpV.z);
          if (hit) { s.crashed = true; s.crashReason = hit; s.events.push({ type: 'crash', reason: hit }); break; }
        }
      }
      if (!G.rwMode && (Math.abs(s.pos.x) > 15500 || Math.abs(s.pos.z) > 15500)) { if (G.toastT <= 0) toast('Leaving the island: turn back', 2); }
      if (G.rwMode && Math.hypot(s.pos.x, s.pos.z) > 90000) { if (G.toastT <= 0) toast('Far from ' + G.rw.loc.name + ': the map gets less exact out here. Turn back', 2); }
      handleEvents(s);
      missionTick(s, dt);
      skimTick(s, dt);
      lowpassTick(dt);
      tutorialTick(s, inp, dt);
      const L = G.landing;
      if (L && L.first && !L.done) {
        if (!s.onGround && s.agl > 1.5) L.airborneAgain = true;
        if (L.airborneAgain && s.onGround) { L.bounces = (L.bounces || 0) + 1; L.airborneAgain = false; }
        if ((s.onGround && s.groundSpeed < 3) || (L.t += dt) > 40) { L.done = true; setTimeout(finishLanding, 600); }
      }
      if (L && !L.first && s.pos.x > T.AIRPORT.runway.x1 + 200 && !L.done) { L.done = true; L.crash = null; setTimeout(finishLanding, 300); }
      G.rumbleT -= dt;
      if (G.rumbleT <= 0 && !s.crashed) {
        if (s.stall > 0.12 && !s.onGround) { rumble(0.3 + 0.6 * s.stall, 200, 1); G.rumbleT = 0.22; }
        else if (s.onGround && s.groundSpeed > 2) {
          const grass = T.surfaceAt(s.pos.x, s.pos.z) !== 'paved';
          rumble(clamp(0.06 + s.groundSpeed / 30 * 0.25, 0, 0.5) * (grass ? 1.8 : 1), 230, 1); G.rumbleT = 0.24;
        } else if (G.bump > 0.08) { rumble(clamp(G.bump, 0.1, 0.5), 90, 0); G.rumbleT = 0.3; }
        else G.rumbleT = 0.1;
      }
      if (s.onGround && s.groundSpeed > 8 && T.surfaceAt(s.pos.x, s.pos.z) !== 'paved' && Math.random() < 0.3) {
        tmpV.set(0, -1.2, 1).applyQuaternion(plane.root.quaternion).add(plane.root.position);
        puffs.spawn(tmpV, new THREE.Vector3(0, 0.5, 0), 1, 4, 1.2, 0xb5a77f, 0.35);
      }
      G.legendT -= dt;
      if (G.legendT <= 0 && G.legendT > -1 && !$('legend').classList.contains('hidden')) { $('legend').classList.add('hidden'); G.legendT = -2; G.legend = false; }
    }
    if (G.state === 'crashing') {
      G.crashT += dt;
      const w = G.wreckV, p = G.s.pos;
      const gh = Math.max(T.heightAt(p.x, p.z), 0);
      w.multiplyScalar(Math.exp(-dt * 1.6)); w.y -= 9.8 * dt;
      p.x += w.x * dt; p.z += w.z * dt; p.y = Math.max(gh + 0.7, p.y + w.y * dt);
      if (Math.random() < 0.5) {
        tmpV.set(p.x, p.y + 0.5, p.z);
        puffs.spawn(tmpV, new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.5 + Math.random(), (Math.random() - 0.5) * 0.6), 2, 14, 4, p.y - gh < 2 && gh <= 0.1 && T.heightAt(p.x, p.z) < 0 ? 0xe8eef2 : 0x55585b, 0.55);
      }
      if (G.crashT > 2.2) {
        if (G.landing && !G.landing.shown) finishLanding();
        else { G.state = 'crash'; $('crashReason').textContent = G.crashReason; $('objective').classList.add('hidden'); show('crash'); }
      }
    }
    if (G.state === 'crash' || G.state === 'result') {
      const p = G.s.pos; if (Math.random() < 0.15 && G.s.crashed) puffs.spawn(tmpV.set(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, 2.5, 0), 2, 14, 4, 0x55585b, 0.45);
    }

    // ---- time of day
    if (flying) G.hours = (G.hours + dt * SPEEDS[settings.timeSpeed][1] / 3600) % 24;
    skyT -= dt; if (skyT <= 0) { world.setTime(G.hours); skyT = 0.2; }

    // ---- visuals
    if (G.state === 'menu' || G.state === 'title' || G.state === 'options' || G.state === 'rwload') { s.rpm = 0; s.groundSpeed = 0; }
    syncPlane(dt);
    if (G.s.crashed) { plane.parts.disc.material.opacity = 0; }
    updateCamera(dt);
    const w = env.wind;
    world.update(camera, plane.root.position, G.time, dt, Math.atan2(-w.z, w.x));
    if (G.rwMode) {
      rw.update(camera, plane.root.position, dt);
      osm.update(camera, dt);
      // height fog follows the local ground, so 3,000 m valleys still get their haze
      const gb = rw.heightAt(camera.position.x, camera.position.z);
      world.fogBase += (Math.max(0, Math.min(gb, camera.position.y - 50)) - world.fogBase) * Math.min(1, dt * 0.5);
    } else life.update(dt, G.time, world.night, camera.position);
    markers.update(G.state === 'fly' || G.state === 'pause' ? G.mission : null, G.time);
    puffs.update(dt);
    if (G.state !== 'pause') speedfx.update(camera.position, tmpV.set(s.vel.x, s.vel.y, s.vel.z), G.state === 'fly' ? G.feel : 0, dt, world.night);
    const sd = world.sunDir;
    post.render(scene, camera, sd, { night: world.night > 0.5, warm: sd ? clamp(1.1 - sd.y * 2.2, 0.25, 1) : 0.5 });

    // ---- warnings + sound
    const air = s && !s.onGround && !s.crashed;
    G.warn.stall = flying && air && s.stallWarn;
    G.warn.gear = flying && air && s.gear < 0.98 && s.agl < 150 && G.ctl.throttle < 0.25;
    G.warn.terrain = flying && air && s.agl < 300 && s.vel.y < -4 && (-s.vel.y * 9 > s.agl) && !(s.gear > 0.98 && G.ctl.flaps >= 1);
    G.warn.blockT = Math.max(0, (G.warn.blockT || 0) - dt);
    AudioFX.update(s, G.view, G.warn, !(G.state === 'fly' || G.state === 'crashing'), G.feel || 0);

    // ---- HUD, cockpit panel, objective, coach
    const showHud = G.state === 'fly' || G.state === 'pause';
    if (showHud) {
      const att = FM.attitude(s);
      const L = G.landing;
      const obj = objectiveInfo(s, att);
      let approach = null;
      const landStep = G.mission && !G.mission.done && G.mission.def.steps[G.mission.i];
      if (L && !L.first) {
        const AP = T.AIRPORT, dx = AP.aimPoint - s.pos.x;
        approach = { dist: Math.max(0, AP.runway.x0 - s.pos.x), gs: Math.atan2(s.pos.y - AP.elev - 1.25, Math.max(dx, 50)) / DEG - 3, loc: Math.atan2(s.pos.z, Math.max(AP.runway.x1 - s.pos.x, 50)) / DEG };
      } else if (landStep && landStep.kind === 'land' && obj.distM < 9000 && !s.onGround) {
        const R = runwayGuide(landStep.airport, landStep.rwy);
        if (R) {
          // runway frame: along = distance to go to the aiming point, cross = right of the centreline
          const aim = { x: R.thr.x + R.dir.x * R.aimDist, z: R.thr.z + R.dir.z * R.aimDist };
          const toAim = (aim.x - s.pos.x) * R.dir.x + (aim.z - s.pos.z) * R.dir.z;
          const cross = (s.pos.x - aim.x) * -R.dir.z + (s.pos.z - aim.z) * R.dir.x;
          const toEnd = toAim + R.len - R.aimDist;
          approach = { rwy: R.name, dist: Math.max(0, (R.thr.x - s.pos.x) * R.dir.x + (R.thr.z - s.pos.z) * R.dir.z), gs: Math.atan2(s.pos.y - R.elev - 1.25, Math.max(toAim, 50)) / DEG - 3, loc: Math.atan2(-cross, Math.max(toEnd, 50)) / DEG };
        }
      }
      const phone = input.phone.active;
      const hd = {
        panel: true, cockpit: G.view === 'cockpit',
        ias: s.airspeed * 1.944, altFt: s.pos.y * 3.281, aglFt: s.agl * 3.281, vsFpm: s.vel.y * 196.85,
        hdg: att.heading, pitch: att.pitch, bank: att.bank, slip: s.beta, bug: G.mode === 'landing' ? 90 : (obj.bearing !== undefined ? obj.bearing : undefined),
        throttle: G.ctl.throttle, rpm: s.rpm, trim: inp.trim, trimming: inp.trimming, flapCmd: G.ctl.flaps, flapPos: s.flap,
        gear: s.gear, brake: inp.brake > 0 && s.onGround, gload: s.onGround ? 1 : s.gload,
        stall: G.warn.stall, gearWarn: G.warn.gear, terrain: G.warn.terrain, overspeed: s.airspeed * 1.944 > 160, gearBlocked: G.warn.blockT > 0,
        showControls: false, sourceLabel: phone ? (input.phone.calibrated ? 'PHONE' : 'PHONE: TAP CENTER') : input.lastSource.toUpperCase(), phone: phone && input.phone.calibrated, phonePitch: input.phone.pitch, phoneRoll: input.phone.roll,
        elevator: G.ctl.elevator, aileron: G.ctl.aileron, rudder: G.ctl.rudder,
        approach,
      };
      // the instrument canvas redraws at 30 Hz: needles look the same, and it saves ~2 ms a frame
      G.hudAcc = (G.hudAcc || 0) + dt;
      if (G.hudAcc >= 1 / 31) { hud.draw(hd, G.hudAcc); G.hudAcc = 0; }
      if (G.view === 'cockpit') cockpit.update(Object.assign(hd, { turnRate: s.omega.z / DEG, night: world.night }), dt);
      if (!G.tutorial) paintObjective(obj, dt); else $('objective').classList.add('hidden');
      paintSkim(dt, true);
      // ---- coach: the one next thing to do
      G.flyT = (G.flyT || 0) + dt;
      const src = phone ? 'phone' : /pad/i.test(input.lastSource) ? 'pad' : 'kbm';
      const cs = { mode: G.lowpass ? 'lowpass' : G.mission ? 'mission' : G.rwMode ? 'free' : G.mode, skim: G.skim, flaps: G.ctl.flaps, nearest: G.rwMode ? nearestRunway(s, dt) : null, device: src, ias: s.airspeed * 1.944, aglFt: s.agl * 3.281, onGround: s.onGround,
        gearDown: s.gear > 0.98, throttle: G.ctl.throttle, vsFpm: s.vel.y * 196.85, stall: G.warn.stall, bank: att.bank, t: G.flyT, stunt: !!(s.ap && s.ap.stunt) };
      if (G.mission) cs.mission = { kind: obj.kind, name: obj.name, idx: obj.idx, total: obj.total, distM: obj.distM, relBearing: obj.relBearing, dyM: obj.dyM, altFt: obj.altFt, crosswind: obj.crosswind };
      const c = FlightCoach.coach(cs);
      const ce = $('coach');
      if (c.id !== G.coachId) { G.coachId = c.id; G.coachT = 0; }
      G.coachT += dt;
      ce.querySelector('span').textContent = c.text;
      ce.classList.toggle('hidden', (c.id === 'free' && G.coachT > 20) || !!G.tutorial);
      ce.classList.toggle('quiet', c.id === 'free' && G.coachT > 8);
    } else { hud.draw({ panel: false }, dt); paintSkim(1, false); $('coach').classList.add('hidden'); if (G.state !== 'pause') $('objective').classList.add('hidden'); }
    if (G.goalT > 0) { G.goalT -= dt; if (G.goalT <= 0 || (G.state !== 'fly' && G.state !== 'pause')) { $('goalCard').classList.add('hidden'); G.goalT = 0; } }
    if (G.toastT > 0) { G.toastT -= dt; if (G.toastT <= 0) $('toast').classList.remove('show'); }
    // turbulence is always announced: a chip while the air is rough
    const tc = $('turbChip'), rough = showHud && s && !s.onGround && (s.turb || 0) > 0.08;
    tc.classList.toggle('hidden', !rough);
    if (rough) tc.textContent = 'TURBULENCE · ' + (s.turb > 0.35 ? 'moderate' : 'light');
    paintFamily();
    $('soundHint').classList.toggle('hidden', !(AudioFX.suspended && (G.state === 'fly' || G.state === 'menu')));
    $('fps').textContent = Math.round(fps) + ' fps' + (dynScale < 0.999 ? ' · ' + Math.round(dynScale * 100) + '%' : '');
    $('fps').classList.toggle('hidden', !settings.showFps);
    $('attrib').classList.toggle('fly', G.state === 'fly' || G.state === 'crashing');
    paintGuide(dt, G.state === 'fly', inp);
    if (G.state !== 'fly' && G.state !== 'pause') $('tutorial').classList.add('hidden');
    window.__gw = G;
  }

  window.addEventListener('gamepadconnected', e => { toast((/mimic/i.test(e.gamepad.id) ? 'Mimic connected: ' : 'Controller connected: ') + e.gamepad.id.slice(0, 40)); updateLegend(); });
  window.__gyrowing = { G, settings, FM, input, post, get rw() { return rw; }, get osm() { return osm; }, get DB() { return DB; }, openPlace, beginLoading, menuAction, show, showResult, toMenu, showGoal, toast, get world() { return world; }, get T() { return T; }, get life() { return life; }, get missions() { return missionDefs; }, startMode, camera, scene, renderer, hud };

  buildOptions();
  // the airport search box: live suggestions while typing, Enter goes
  $('apCode').addEventListener('input', () => { if (DB) searchAirports($('apCode').value); else loadDB().then(() => searchAirports($('apCode').value)).catch(() => {}); });
  $('apCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); menuAction('apGo'); } e.stopPropagation(); });
  // the GLTF loaders arrive as a module after this script; start once they are in (or after a short wait)
  let booted = false;
  const go = () => { if (!booted) { booted = true; boot(); } };
  if (window.__threeLoadersReady) setTimeout(go, 30);
  else { addEventListener('three-loaders', () => setTimeout(go, 30), { once: true }); setTimeout(go, 2500); }
})();
