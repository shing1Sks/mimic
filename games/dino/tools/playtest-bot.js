// Scripted player for IRONFERN. Plays like a person aiming with the phone (inputs sent as mouse + keys): it only reacts to
// what is on screen (or signposted by the HUD's edge arrows), moves the crosshair at a human speed
// with a reaction delay and a little tremor, and only uses the phone's inputs: mouse movement,
// left click (Vol Down), R (Vol Up), Q (double Vol Up), V (align), Space (flick dodge).
(function () {
  'use strict';
  const T = THREE;
  const bot = window.__bot = {
    log: [], shots: [], phase: null, phases: [], fpsS: [], frames: 0, fpsT: 0,
    target: null, targetSince: 0, firing: false, fireUntil: 0, lastFire: 0, searchDir: 1,
    unseenT: 0, offscreenHurts: 0, hurts: 0, dodges: 0, dodgeOk: 0, wantShots: [], useArrows: true,
    noise: { x: 0, y: 0 }, seen: new Map(), pendingDodge: [],
  };
  const ev = (k, d) => bot.log.push(Object.assign({ t: +(__dh.time).toFixed(2), k }, d || {}));
  const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type || 'keydown', { code, bubbles: true }));
  const tap = (code) => { key(code, 'keydown'); setTimeout(() => key(code, 'keyup'), 60); };
  const mouse = (type) => window.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true }));
  const move = (dx, dy) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
  const shot = name => bot.wantShots.push(name);

  // ---------------------------------------------------------------- cleanliness audit
  // Every frame, for every animal: did it appear in plain view (pop), is it inside something solid
  // (clip), off the ground (float), or moving without its legs (slide)?
  bot.audit = { pop: [], clip: [], float: [], slide: [], frames: 0 };
  const seenIds = new Set(), lastPos = new Map(), _p2 = new T.Vector3(), _dir = new T.Vector3();
  const note = (k, d, extra) => { const a = bot.audit[k]; if (a.length < 400) a.push(Object.assign({ t: +(__dh.time).toFixed(1), id: d.id, sp: d.species, st: d.brain.state, x: +d.pos.x.toFixed(1), z: +d.pos.z.toFixed(1) }, extra || {})); };
  function onScreenClear(d) {
    const c = __dh.camera; _p2.copy(d.pos); _p2.y += d.inst.tpl.height * 0.6; _p2.project(c);
    if (_p2.z > 1 || Math.abs(_p2.x) > 1 || Math.abs(_p2.y) > 1) return false;
    const w = __dh.world, eye = c.position; _dir.copy(d.pos); _dir.y += d.inst.tpl.height * 0.6; _dir.sub(eye); const L = _dir.length(); _dir.divideScalar(L);
    const fog = __dh.scene.fog && __dh.scene.fog.density; if (fog && L * fog > 1.1) return false;
    const h = w && w.raycast ? w.raycast(eye, _dir, L) : null; return !(h && h.dist < L - 1.5);
  }
  function audit() {
    if (__dh.state !== 'play' || !DH.Dinos) return;
    bot.audit.frames++;
    const nav = (__dh.world && __dh.world.nav) || window.__navAudit, dt = Math.max(1e-3, __dh.dt);
    for (const d of DH.Dinos.list()) {
      if (!d.root.visible) continue;
      if (!seenIds.has(d.id)) { seenIds.add(d.id); if (d.species !== 'ptero' && d.species !== 'grazer' && onScreenClear(d)) note('pop', d, { dist: Math.round(d.pos.distanceTo(__dh.camera.position)) }); }
      if (!d.alive || d.species === 'ptero') { lastPos.delete(d.id); continue; }
      if (nav && DH.Nav.blocked(nav, d.pos.x, d.pos.z) && !d.leap && !d.elev) note('clip', d);
      const g = __dh.world.heightAt(d.pos.x, d.pos.z);
      if (!d.leap && !d.elev && Math.abs(d.pos.y - g) > 0.35) note('float', d, { dy: +(d.pos.y - g).toFixed(2) });
      const lp = lastPos.get(d.id);
      if (lp && !d.leap && __dh.dt > 0.004) {
        const v = Math.hypot(d.pos.x - lp.x, d.pos.z - lp.z) / dt, legs = Math.abs(d.speed);
        if (v > 2.5 && v > legs * 2.2 + 1.5 && d.knock.length() < 0.5) note('slide', d, { v: +v.toFixed(1), legs: +legs.toFixed(1) });
      }
      lastPos.set(d.id, { x: d.pos.x, z: d.pos.z });
    }
  }

  // ---------------------------------------------------------------- bus
  const on = (e, f) => DH.bus.on(e, f);
  let phaseStat = null;
  function newPhase(name) {
    if (phaseStat) closePhase();
    phaseStat = { name, t0: __dh.time, shots: 0, hits: 0, kills: 0, hurt: 0, deaths: 0, unseen: 0, firstContact: null, dodged: 0, attacks: 0 };
    shot(name + '_start');
    setTimeout(() => shot(name + '_3s'), 3000);
  }
  function closePhase() { phaseStat.dur = +(__dh.time - phaseStat.t0).toFixed(1); phaseStat.unseen = +phaseStat.unseen.toFixed(1); bot.phases.push(phaseStat); phaseStat = null; }
  on('mission:phase', d => newPhase(`s${d.step}p${d.phase}_${d.stand}`));
  on('mission:retry', d => { ev('retry', d); if (phaseStat) phaseStat.deaths++; shot('retry_' + bot.log.length); });
  on('shot:fired', () => { if (phaseStat) phaseStat.shots++; });
  on('shot:hit', d => { if (phaseStat) phaseStat.hits++; });
  on('mission:target', () => { if (phaseStat) phaseStat.hits++; });
  on('dino:dead', d => { if (phaseStat && d.byPlayer !== false) phaseStat.kills++; });
  on('player:hurt', d => {
    bot.hurts++; if (phaseStat) phaseStat.hurt += d.damage || 0;
    const from = d.from || (d.dino && d.dino.pos);
    let off = null;
    if (from) { const p = from.clone().project(__dh.camera); off = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1; if (off) bot.offscreenHurts++; }
    ev('hurt', { dmg: d.damage, kind: d.kind, offscreen: off, hp: __dh.player.hp });
  });
  on('player:dodged', () => { bot.dodgeOk++; if (phaseStat) phaseStat.dodged++; ev('dodged'); });
  on('dino:attack', d => {
    if (phaseStat) phaseStat.attacks++;
    const dp = d.dino.pos.clone(); dp.y += 1; const p = dp.project(__dh.camera);
    ev('attack', { kind: d.kind, ms: d.windowMs, dodge: d.dodgeable, duck: d.duckable, onscreen: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 });
    if (d.dodgeable) {
      // react to the DODGE call (last ~0.5 s) after a human delay; a phone flick adds ~0.1 s
      const call = Math.max(0, d.windowMs / 1000 - 0.5), react = 0.22 + Math.random() * 0.15;
      bot.pendingDodge.push(__dh.time + call + react); // game time: the prompt runs on it too
    }
  });
  on('mission:end', d => { if (phaseStat) closePhase(); bot.result = d.result; ev('end', { total: d.result.total, stars: d.result.stars }); shot('results'); });

  // ---------------------------------------------------------------- targets
  const _v = new T.Vector3(), _m = new T.Vector3();
  function aimPoint(d, out) {
    const sp = d.species, inst = d.inst, st = d.brain.state;
    let best = null;
    if (sp === 'rex' || sp === 'trike') {
      const want = sp === 'rex' && st === 'roar' ? 'mouth' : 'eye';
      const s = inst.specials.find(x => x.part === want) || inst.specials.find(x => x.part === 'eye');
      if (s && (sp === 'rex' || st === 'telegraph')) { out.copy(s.c).applyMatrix4(s.bone.matrixWorld); return out; }
      if (sp === 'trike') { const h = inst.hit.find(x => x.part === 'body'); if (h) { out.copy(h.a).lerp(h.b, 0.5).applyMatrix4(h.bone.matrixWorld); return out; } }
    }
    // centre mass: the body capsule; small fast animals: chest
    const h = inst.hit.find(x => x.part === 'body') || inst.hit[0];
    if (h) { out.copy(h.a).lerp(h.b, 0.5).applyMatrix4(h.bone.matrixWorld); return out; }
    out.copy(d.pos); out.y += inst.tpl.height * 0.5; return out;
  }
  function wanted() {
    const M = DH.Missions.state, ph = M.phaseDef, out = [];
    const tagOnly = ph && ph.objective && ph.objective.tagged;
    for (const d of DH.Dinos.list()) {
      if (!d.alive || !d.root.visible || d.species === 'grazer') continue;
      if (tagOnly && !d.tagged) continue;
      out.push({ kind: 'dino', d, size: d.species === 'rex' ? 0.5 : d.species === 'trike' ? 0.8 : 0.45, pt: aimPoint(d, new T.Vector3()) });
    }
    const plates = DH.Missions.targets ? DH.Missions.targets() : [];
    for (const t of plates) if (!t.down) out.push({ kind: 'plate', t, size: 0.22, pt: t.plate.getWorldPosition(new T.Vector3()) });
    return out;
  }
  // ---------------------------------------------------------------- what a person can see
  // Every 0.35 s: draw the scene into a small target with each candidate in a flat unique colour
  // (foliage still occludes with its alpha cut-out), and count each colour's pixels.
  const VW = 400, VH = 225, SCALE = (1600 / VW) * (900 / VH);
  let rt = null, buf = null, visAt = 0;
  const vis = new Map(); // obj -> full-res visible pixels
  const pal = [];
  for (const r of [0, 0.5, 1]) for (const g of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) if (r + g + b > 0 && !(r === 1 && g === 1 && b === 1)) pal.push([r, g, b]);
  function measureVis(cands) {
    const c = __dh, R = c.renderer;
    if (!rt) { rt = new T.WebGLRenderTarget(VW, VH); buf = new Uint8Array(VW * VH * 4); }
    vis.clear();
    for (let k = 0; k < cands.length; k += pal.length) {
      const grp = cands.slice(k, k + pal.length), saved = [];
      grp.forEach((o, i) => {
        const col = pal[i], mat = new T.MeshBasicMaterial({ color: new T.Color(col[0], col[1], col[2]), fog: false, toneMapped: false });
        const root = o.d ? o.d.root : o.t.plate;
        root.traverse(m => { if (m.isMesh && !m.userData.blob) { saved.push([m, m.material]); m.material = mat; } });
      });
      const au = R.shadowMap.autoUpdate, fog = c.scene.fog, bg = c.scene.background; R.shadowMap.autoUpdate = false;
      c.scene.background = new T.Color(1, 1, 1);
      R.setRenderTarget(rt); R.clear(); R.render(c.scene, c.camera); R.readRenderTargetPixels(rt, 0, 0, VW, VH, buf); R.setRenderTarget(null);
      R.shadowMap.autoUpdate = au; c.scene.background = bg;
      saved.forEach(([m, mt]) => { m.material.dispose && m.material.dispose(); m.material = mt; });
      const counts = new Array(grp.length).fill(0);
      const q = v => v < 60 ? 0 : v > 230 ? 2 : 1;
      for (let i = 0; i < buf.length; i += 4) {
        const r = q(buf[i]), g = q(buf[i + 1]), b = q(buf[i + 2]);
        if (r + g + b === 0 || (r === 2 && g === 2 && b === 2)) continue;
        // match exactly (mid values: linear 0.5 -> sRGB ~188)
        if (!((buf[i] < 8 || buf[i] > 247 || Math.abs(buf[i] - 128) < 6) && (buf[i + 1] < 8 || buf[i + 1] > 247 || Math.abs(buf[i + 1] - 128) < 6) && (buf[i + 2] < 8 || buf[i + 2] > 247 || Math.abs(buf[i + 2] - 128) < 6))) continue;
        const idx = pal.findIndex(p => p[0] * 2 === r && p[1] * 2 === g && p[2] * 2 === b);
        if (idx >= 0 && idx < grp.length) counts[idx]++;
      }
      grp.forEach((o, i) => vis.set(o.d || o.t, counts[i] * SCALE));
    }
  }
  bot.visOf = o => vis.get(o) || 0;
  function screenOf(p) { _v.copy(p).project(__dh.camera); return { x: _v.x, y: _v.y, on: Math.abs(_v.x) < 0.98 && Math.abs(_v.y) < 0.98 && _v.z < 1 }; }
  function arrowed(o) { // the HUD signposts it (edge arrow / marker)
    const a = window.DH.Hud && DH.Hud.markers ? DH.Hud.markers() : null;
    if (!a) return false;
    return a.some(m => m.obj === (o.d || o.t));
  }

  // ---------------------------------------------------------------- control loop
  let lastT = 0;
  function step() {
    requestAnimationFrame(step);
    const c = window.__dh; if (!c) return;
    const now = performance.now() / 1000, dt = Math.min(0.05, now - (lastT || now)); lastT = now;
    bot.frames++;
    audit();
    if (now - bot.fpsT >= 1) { if (bot.fpsT) bot.fpsS.push(bot.frames / (now - bot.fpsT)); bot.fpsT = now; bot.frames = 0; }
    for (let i = bot.pendingDodge.length - 1; i >= 0; i--) if (c.time >= bot.pendingDodge[i]) { bot.pendingDodge.splice(i, 1); bot.dodges++; tap('Space'); }
    if (c.state !== 'play') { if (bot.firing) { mouse('mouseup'); bot.firing = false; } return; }
    const M = DH.Missions.state;
    if (!M || !M.active || (M.mode !== 'stand' && M.mode !== 'ride' && M.mode !== 'clear')) { if (bot.firing) { mouse('mouseup'); bot.firing = false; } return; }
    const W = DH.Weapons, w = W.current, scoped = !!W.scoped;
    // weapon: a person would switch for long shots if the game has not
    if (M.phaseDef && M.phaseDef.objective && M.phaseDef.objective.tagged && w && w.id !== 'marksman' && now - (bot.lastSwitch || 0) > 1.2) { bot.lastSwitch = now; tap('KeyQ'); }
    // pick a target: something on screen first, nearest to the crosshair; else something signposted
    const cand = wanted();
    const vis = [];
    if (now - visAt > 0.35) { visAt = now; measureVis(cand); }
    for (const o of cand) {
      const s = screenOf(o.pt); o.s = s; o.dist = c.camera.position.distanceTo(o.pt);
      const px = bot.visOf(o.d || o.t); o.px = px;
      const id = o.d || o.t; if (!bot.seen.has(id)) bot.seen.set(id, { kind: o.d ? o.d.species : 'plate', maxPx: 0, firstSeen: null, born: c.time, dist: 0 });
      const rec = bot.seen.get(id); if (px > rec.maxPx) { rec.maxPx = Math.round(px); rec.dist = Math.round(o.dist); }
      // a person notices something moving of ~40+ pixels; a still plate needs ~25
      if (s.on && px >= (o.d ? 40 : 25)) { vis.push(o); if (rec.firstSeen == null) rec.firstSeen = +(c.time - rec.born).toFixed(1); }
    }
    const cn = c.crossNdc ? c.crossNdc() : { x: c.aim.cx, y: -c.aim.cy }, cx = cn.x, cy = cn.y;
    const urgency = o => (o.d && o.d.brain.state === 'telegraph' ? -5 : 0) + Math.hypot(o.s.x - cx, o.s.y - cy) * 0.6 + o.dist * 0.01;
    vis.sort((a, b) => urgency(a) - urgency(b));
    let tgt = vis[0] || null, seen = !!tgt;
    // a person sticks with the animal they are already on unless another is about to attack
    const cur = vis.find(o => (o.d || o.t) === bot.target);
    if (cur && !(tgt && tgt.d && tgt.d.brain.state === 'telegraph' && tgt !== cur)) tgt = cur;
    if (!tgt && bot.useArrows) { const sign = cand.filter(arrowed); sign.sort((a, b) => a.dist - b.dist); tgt = sign[0] || null; }
    if (cand.length && !seen && phaseStat) phaseStat.unseen += dt;
    if (tgt && phaseStat && phaseStat.firstContact == null) phaseStat.firstContact = +(c.time - phaseStat.t0).toFixed(1);
    const key2 = tgt ? (tgt.d || tgt.t) : null;
    if (key2 !== bot.target) { bot.target = key2; bot.targetSince = now; if (bot.firing) { mouse('mouseup'); bot.firing = false; } }
    const hfy = 35 * Math.PI / 180, hfx = Math.atan(Math.tan(hfy) * c.camera.aspect);
    const kEff = scoped ? 0.00045 * (c.fovZoom || 1) / hfx : 0.0022;
    // tremor
    bot.noise.x += (Math.random() - 0.5) * 0.004 - bot.noise.x * dt * 3; bot.noise.y += (Math.random() - 0.5) * 0.004 - bot.noise.y * dt * 3;
    let ex = 0, ey = 0, rawErr = 9;
    if (tgt && now - bot.targetSince > 0.25) {
      const sx = scoped ? 0 : cx, sy = scoped ? 0 : cy;
      ex = Math.max(-1.6, Math.min(1.6, tgt.s.x - sx)); ey = Math.max(-1.6, Math.min(1.6, tgt.s.y - sy));
      // near the screen edge a person turns the phone further so the view pans the target inward
      // a steady hand: tiny errors are left alone (the aim settles, the scope can come up)
      rawErr = Math.hypot(ex, ey);
      const dz = scoped ? 0.006 : Math.min(0.012, ((tgt.size || 0.3) / Math.max(1, tgt.dist)) * 0.5 / 0.61);
      if (rawErr < dz) { ex = 0; ey = 0; }
      if (!tgt.s.on) { // off screen: turn toward it (the arrow says which way)
        const p = c.camera.worldToLocal(_m.copy(tgt.pt));
        ex = p.x > 0 ? 1 : -1; ey = 0;
      }
    } else if (!tgt && cand.length && !bot.useArrows) {
      // search: sweep the arc
      ex = bot.searchDir * 0.6; if (Math.abs(c.aim.yaw - c.view.stand.yaw) > c.view.stand.arc * 0.95) bot.searchDir = -Math.sign(c.aim.yaw - c.view.stand.yaw);
      ex = bot.searchDir * 0.5;
    }
    const maxRate = scoped ? 6 : 2.6; // same hand speed: in the scope it moves the image faster // screen halves per second a hand can sweep
    let mx = Math.max(-maxRate * dt, Math.min(maxRate * dt, ex * Math.min(1, dt * 6))), my = Math.max(-maxRate * dt, Math.min(maxRate * dt, ey * Math.min(1, dt * 6)));
    mx += bot.noise.x * dt * 4; my += bot.noise.y * dt * 4;
    if (mx || my) move(mx / kEff, -my / kEff);
    // fire when the crosshair is on it
    let fire = false;
    if (tgt && tgt.s.on && now - bot.targetSince > 0.3 && w && !w.reloading && w.mag > 0 && (w.id !== 'marksman' || scoped)) {
      const ang = tgt.size / Math.max(1, tgt.dist), err = rawErr * hfy / (c.fovZoom || 1);
      fire = err < Math.max(ang * 0.6, 0.0015);
    }
    const auto = w && (w.id === 'carbine');
    if (fire) {
      if (auto) { if (!bot.firing) { mouse('mousedown'); bot.firing = true; bot.fireUntil = now + 0.35; } else if (now > bot.fireUntil) { mouse('mouseup'); bot.firing = false; } }
      else if (now - bot.lastFire > (w.id === 'marksman' ? 1.25 : 0.28)) { bot.lastFire = now; mouse('mousedown'); setTimeout(() => mouse('mouseup'), 50); }
    } else if (bot.firing) { mouse('mouseup'); bot.firing = false; }
    // reload when empty, or low with nothing to shoot
    if (w && !w.reloading && w.reserve > 0 && (w.mag === 0 || (!tgt && w.mag < w.magSize * 0.4)) && now - (bot.lastReload || 0) > 1) { bot.lastReload = now; tap('KeyR'); }
  }
  { const M = DH.Missions.state; if (M && M.phaseDef) newPhase(`s${M.step}p${M.phase}_first`); }
  let started = false;
  on('state', d => { if (d.state === 'play' && !started) { started = true; if (phaseStat) phaseStat.t0 = __dh.time; setTimeout(() => tap('KeyV'), 300); setTimeout(() => shot('play_2s'), 2000); } });
  requestAnimationFrame(step);
})();
