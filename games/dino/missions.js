// Ironfern missions: mission scripts as data and the director that runs them (stands, rides on
// rails, waves, objectives, checkpoints, scoring, stars, saved bests). The pure parts at the top
// are exported for Node (test/missions.test.js); the director below needs the browser and DH.*.
(function (root) {
  'use strict';

  // ================================================================== pure: scoring
  const POINTS = { raptor: 100, dilo: 120, ptero: 80, trike: 300, rex: 2000, grazer: -250 };
  const WEAK = { head: 1, eye: 1, mouth: 1 };
  const isWeak = z => !!(z && WEAK[z]);
  /** Kill points for a species; weak-spot kills count double (penalties never do). */
  function killPoints(species, zone) {
    const p = POINTS[species] || 0;
    return p > 0 && isWeak(zone) ? p * 2 : p;
  }
  /** 1 star for finishing, 2 at th[0], 3 at th[1]. */
  function starsFor(total, th) { return total >= th[1] ? 3 : total >= th[0] ? 2 : 1; }
  /** stats: { killPoints, shots, hits, time, damageTaken, deaths, penalty }, cfg: { par, stars } */
  function scoreResult(s, cfg) {
    const accuracy = s.shots > 0 ? Math.min(1, s.hits / s.shots) : 0;
    const accuracyBonus = Math.round(1000 * accuracy);
    const timeBonus = Math.max(0, Math.round((cfg.par - (s.time || 0)) * 5));
    const damagePenalty = -Math.round(3 * (s.damageTaken || 0)) || 0;
    const deathPenalty = -250 * (s.deaths || 0) || 0;
    const penalty = -Math.abs(s.penalty || 0) || 0;
    const total = Math.max(0, Math.round((s.killPoints || 0) + accuracyBonus + timeBonus + damagePenalty + deathPenalty + penalty));
    return { killPoints: s.killPoints || 0, accuracy, accuracyBonus, timeBonus, damagePenalty, deathPenalty, penalty, total, stars: starsFor(total, cfg.stars) };
  }
  /** Best per mission: { [id]: { score, stars } }. Score and stars each keep their max. */
  function mergeBest(map, id, r) {
    const prev = (map || {})[id];
    const newBest = !prev || r.total > prev.score;
    const out = Object.assign({}, map);
    out[id] = { score: prev ? Math.max(prev.score, r.total) : r.total, stars: prev ? Math.max(prev.stars, r.stars) : r.stars };
    return { map: out, newBest };
  }

  // ================================================================== pure: objectives
  // def.type: kill {species, count, tagged?} | targets {count} | clear {planned} | survive {time}
  //           | boss {species}; any may carry timeLimit (s) and label.
  const objective = {
    create(def) {
      const need = def.type === 'clear' ? (def.planned || 0) : def.type === 'boss' ? 1 : (def.count || 0);
      return { def, type: def.type, need, have: 0, elapsed: 0, cleared: false };
    },
    kill(o, ev) {
      const d = o.def;
      if (o.type === 'kill') { if (ev.species === d.species && (!d.tagged || ev.tagged)) o.have++; }
      else if (o.type === 'boss') { if (ev.species === d.species) o.have++; }
      else if (o.type === 'clear') { if (ev.species !== 'grazer') o.have++; }
    },
    target(o) { if (o.type === 'targets') o.have++; },
    tick(o, dt) { o.elapsed += dt; },
    view(o) {
      const d = o.def, label = d.label || '';
      let done;
      if (o.type === 'survive') done = o.elapsed >= d.time;
      else if (o.type === 'clear') done = o.cleared;
      else done = o.have >= o.need;
      const failed = !done && d.timeLimit != null && o.elapsed >= d.timeLimit;
      let timer = null;
      if (o.type === 'survive') timer = Math.max(0, d.time - o.elapsed);
      else if (d.timeLimit != null) timer = Math.max(0, d.timeLimit - o.elapsed);
      const counted = o.type === 'kill' || o.type === 'targets' || o.type === 'clear';
      const text = counted ? `${label} ${Math.min(o.have, o.need)}/${o.need}` : label;
      return { text, have: o.have, need: o.need, timer, done, failed };
    },
  };

  // ================================================================== pure: waves
  /** Waves not fired yet that are due. wave: { id, at? | after?+delay? | afterKills? }.
   * st: { t (s since phase start), fired: {id}, clearedAt: {id: t}, kills } */
  function dueWaves(waves, st) {
    return waves.filter(w => {
      if (st.fired[w.id]) return false;
      if (w.at != null) return st.t >= w.at;
      if (w.after != null) return st.clearedAt[w.after] != null && st.t - st.clearedAt[w.after] >= (w.delay || 0);
      if (w.afterKills != null) return st.kills >= w.afterKills;
      return true;
    });
  }
  /** How many hostile animals a list of waves spawns (grazers and ambient ones excluded). */
  function plannedCount(waves) {
    let n = 0;
    (waves || []).forEach(w => (w.spawns || []).forEach(s => { if (s.species !== 'grazer' && !s.ambient) n += s.n || 1; }));
    return n;
  }

  // ================================================================== pure: rails
  function cr(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  /** Catmull-Rom through points ({x,y,z}); at(d) samples by distance along it:
   * { x, y, z, dx, dz } with (dx, dz) the unit horizontal travel direction. */
  function rail(points, perSeg) {
    const P = points, n = P.length, S = perSeg || 24;
    const samples = [];
    if (n === 1) samples.push({ x: P[0].x, y: P[0].y, z: P[0].z });
    for (let i = 0; i < n - 1; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
      for (let k = 0; k < S; k++) {
        const t = k / S;
        samples.push({ x: cr(a.x, b.x, c.x, d.x, t), y: cr(a.y, b.y, c.y, d.y, t), z: cr(a.z, b.z, c.z, d.z, t) });
      }
    }
    if (n > 1) samples.push({ x: P[n - 1].x, y: P[n - 1].y, z: P[n - 1].z });
    const cum = [0];
    for (let i = 1; i < samples.length; i++) {
      const p = samples[i], q = samples[i - 1];
      cum.push(cum[i - 1] + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    const length = cum[cum.length - 1];
    function at(dist) {
      const D = Math.max(0, Math.min(length, dist));
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= D) lo = m; else hi = m; }
      const p = samples[lo], q = samples[Math.min(hi, samples.length - 1)];
      const seg = cum[hi] - cum[lo], f = seg > 0 ? (D - cum[lo]) / seg : 0;
      let dx = q.x - p.x, dz = q.z - p.z;
      const h = Math.hypot(dx, dz) || 1; dx /= h; dz /= h;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f, dx, dz };
    }
    return { length, at };
  }

  const Pure = { POINTS, isWeak, killPoints, starsFor, scoreResult, mergeBest, objective, dueWaves, plannedCount, rail };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Pure; return; }

  // ================================================================== mission scripts
  // A plan is a list of steps: { stand, phases: [...] } or { ride: railName, to: standName, ambush }.
  // Phase: { objective, waves, hint (control to prompt), note, targets?, protect? (point name) }.
  // Spawn entry: { species, from: layout spawn name | side: 'left'|'right' (ride ambush), n, stagger (s),
  //   tagged, aggro, target: 'stand'|'survivors'|'self', ambient (does not need killing) }.
  const R = (from, n, extra) => Object.assign({ species: 'raptor', from, n: n || 1, stagger: 1 }, extra);
  // weapon: what the stand hands you (Q / double Vol Up still switches by hand).
  const MISSIONS = {
    gate3: {
      par: 150, stars: [1800, 2800],
      brief: 'Get your eye in at the visitor gate. Knock down the six practice plates, then stop whatever comes up the road and out of the ferns.',
      objectiveText: 'Plates, then the road, then the ferns.',
      controls: ['fire', 'align', 'dodge'],
      plan: [{ stand: 'gate', phases: [
        { objective: { type: 'targets', count: 6, label: 'Practice plates' }, targets: true, hint: 'fire', weapon: 'carbine',
          note: 'Six plates in front of the gate. Put the crosshair on each and fire.' },
        { objective: { type: 'clear', label: 'Road hostiles' }, hint: 'reload', weapon: 'carbine', note: 'Spitters on the road. Shoot the green spit out of the air, or flick to dodge it.',
          waves: [{ id: 'd1', at: 1.5, spawns: [{ species: 'dilo', from: 'road', n: 2, stagger: 4, aggro: 0.5 }] },
            { id: 'd2', after: 'd1', delay: 1.5, spawns: [{ species: 'dilo', from: 'road', n: 1, aggro: 0.6 }] }] },
        { objective: { type: 'kill', species: 'raptor', count: 3, label: 'Raptors' }, hint: 'dodge', weapon: 'carbine', note: 'Raptors in the ferns. When one crouches to leap: FLICK the phone sideways.',
          waves: [{ id: 'r1', at: 2, spawns: [R('leftBrush', 1, { aggro: 0.45 })] }, { id: 'r2', after: 'r1', delay: 1.5, spawns: [R('rightBrush', 1, { aggro: 0.55 })] },
            { id: 'r3', after: 'r2', delay: 1, spawns: [R('road', 1, { aggro: 0.9 })] }] },
      ] }],
    },
    overwatch: {
      par: 140, stars: [900, 1500],
      brief: 'Three tagged raptors are stalking the survivors at the crashed jeep. Snipe them before they reach it. Do not hit the grazers.',
      objectiveText: 'Kill the 3 tagged raptors. Spare the herd.',
      controls: ['fire', 'align', 'switch'],
      plan: [{ stand: 'tower', phases: [
        { objective: { type: 'kill', species: 'raptor', tagged: true, count: 3, label: 'Tagged raptors', timeLimit: 150 },
          protect: 'survivors', hint: 'scope', weapon: 'marksman',
          note: 'Swing to a red TAG marker and hold still: the scope comes up. One shot each. Spare the grazers.',
          waves: [
            { id: 'herd', at: 0, spawns: [{ species: 'grazer', from: 'herd', n: 10, ambient: true, aggro: 0, target: 'self' }] },
            { id: 'a', at: 3, spawns: [R('stalkA', 1, { tagged: true, target: 'survivors', aggro: 0.05 })] },
            { id: 'b', after: 'a', delay: 2, spawns: [R('stalkB', 1, { tagged: true, target: 'survivors', aggro: 0.1 })] },
            { id: 'c', after: 'b', delay: 1, spawns: [R('stalkC', 1, { tagged: true, target: 'survivors', aggro: 0.2 })] },
          ] },
      ] }],
    },
    pens: {
      par: 200, stars: [2400, 3800],
      brief: 'Drive through the raptor paddocks to the feeding station. Three stops, ambushes from both sides, pterosaurs over the river.',
      objectiveText: 'Clear each stop. Keep the jeep moving.',
      controls: ['fire', 'dodge', 'reload'],
      plan: [
        { stand: 'pens1', phases: [{ objective: { type: 'clear', label: 'Paddock raptors' }, hint: 'reload', weapon: 'carbine', note: 'They come through the broken fences. Follow the red arrows.',
          waves: [{ id: 'f', at: 1.5, spawns: [R('pens1Front', 2, { stagger: 1.5, aggro: 0.5 })] }, { id: 'l', after: 'f', delay: 1, spawns: [R('pens1Left', 2, { stagger: 1.4, aggro: 0.6 })] },
            { id: 'r', after: 'l', delay: 1, spawns: [R('pens1Right', 2, { stagger: 1.2, aggro: 0.7 })] }] }] },
        { ride: 'drive1', to: 'pens2', ambush: [{ at: 0.5, spawns: [R(null, 1, { side: 'left', aggro: 0.6 }), R(null, 1, { side: 'right', stagger: 1.5, aggro: 0.6 })] }] },
        { stand: 'pens2', phases: [{ objective: { type: 'clear', label: 'Bridge hostiles' }, hint: 'dodge', weapon: 'carbine', note: 'Pterosaurs over the water. Shoot them as they dive, or FLICK to dodge.',
          waves: [{ id: 'p1', at: 2, spawns: [{ species: 'ptero', from: 'river', n: 1 }] },
            { id: 'p2', after: 'p1', delay: 1, spawns: [{ species: 'ptero', from: 'river', n: 2, stagger: 2.5 }] },
            { id: 'b', after: 'p2', delay: 1, spawns: [R('pens2Banks', 2, { stagger: 1.5 })] }] }] },
        { ride: 'drive2', to: 'pens3', ambush: [{ at: 0.55, spawns: [R(null, 2, { side: 'right', stagger: 1.2, aggro: 0.6 })] }] },
        { stand: 'pens3', phases: [{ objective: { type: 'clear', label: 'Feeding station' }, hint: 'dodge', weapon: 'carbine', note: 'Last stop. Watch the roof: FLICK when one leaps.',
          waves: [{ id: 'l', at: 1.5, spawns: [R('pens3Left', 2, { stagger: 1.2 })] }, { id: 'r', at: 5, spawns: [R('pens3Right', 2, { stagger: 1.2 })] },
            { id: 'roof', afterKills: 4, spawns: [R('pens3Roof', 1, { aggro: 1 })] },
            { id: 'last', after: 'roof', delay: 0.5, spawns: [R('pens3Left', 2, { stagger: 0.6, aggro: 1 }), R('pens3Right', 2, { stagger: 0.6, aggro: 1 })] }] }] },
      ],
    },
    horn: {
      par: 90, stars: [2600, 4200],
      brief: 'A triceratops stampede across open ground. The front plate is armour: hit the flank or the eye, or FLICK aside when one charges.',
      objectiveText: 'Hold the line for 75 seconds.',
      controls: ['fire', 'dodge', 'align'],
      plan: [{ stand: 'field', phases: [
        { objective: { type: 'survive', time: 75, label: 'Hold the line' }, hint: 'dodge', weapon: 'carbine', note: 'Shoot the flanks or the eye. FLICK when a charge is on you.',
          waves: [
            { id: 'a1', at: 2, spawns: [{ species: 'trike', from: 'laneA', aggro: 0.8 }] },
            { id: 'b1', at: 13, spawns: [{ species: 'trike', from: 'laneB', aggro: 0.9 }] },
            { id: 'c1', at: 22, spawns: [{ species: 'trike', from: 'laneC', aggro: 0.9 }] },
            { id: 'ac', at: 32, spawns: [{ species: 'trike', from: 'laneA', aggro: 1 }, { species: 'trike', from: 'laneC', aggro: 1, stagger: 2.5 }] },
            { id: 'fl', at: 42, spawns: [R('flankLeft', 1), R('flankRight', 1, { stagger: 2 })] },
            { id: 'b2', at: 50, spawns: [{ species: 'trike', from: 'laneB', aggro: 1 }] },
            { id: 'a2', at: 58, spawns: [{ species: 'trike', from: 'laneA', aggro: 1 }, { species: 'trike', from: 'laneB', aggro: 1, stagger: 1.5 }, { species: 'trike', from: 'laneC', aggro: 1, stagger: 3 }] },
          ] },
      ] }],
    },
    apex: {
      par: 180, stars: [3200, 5200],
      brief: 'The apex predator owns the visitor centre plaza. Its eye and open mouth are the weak spots. Dodge the charge. Extraction comes when it falls.',
      objectiveText: 'Bring down the apex.',
      controls: ['fire', 'dodge', 'switch'],
      outro: 'Extraction inbound',
      plan: [{ stand: 'plaza', phases: [
        { objective: { type: 'boss', species: 'rex', label: 'Bring down the apex' }, hint: 'dodge', weapon: 'carbine', note: 'Aim for the eye, or the mouth when it roars. FLICK when it charges.',
          waves: [{ id: 'rex', at: 1.5, spawns: [{ species: 'rex', from: 'rexEntry', aggro: 1 }] },
            { id: 'bal', at: 35, spawns: [R('balcony', 2, { stagger: 1.5, ambient: true })] },
            { id: 'bal2', after: 'bal', delay: 25, spawns: [R('balcony', 2, { stagger: 1.5, ambient: true })] }] },
      ] }],
    },
  };
  const NAMES = { raptor: 'Raptor', dilo: 'Dilophosaur', trike: 'Triceratops', ptero: 'Pterosaur', rex: 'Apex', grazer: 'Grazer' };
  const WEAK_LABEL = { head: 'HEADSHOT', eye: 'EYE SHOT', mouth: 'MOUTH SHOT' };
  const RIDE_SPEED = 6, EYE = 1.7, RIDE_ARC = 1.4, TARGET_PTS = 50;

  // ================================================================== director
  const DH = root.DH = root.DH || {};
  const emit = (e, d) => DH.bus && DH.bus.emit(e, d);
  const safe = (f, fallback) => { try { return f(); } catch (err) { console.warn('[missions]', err); return fallback; } };
  const L = () => (DH.Layout && DH.Layout.LAYOUT) || {};

  function loadBest() { return safe(() => JSON.parse(localStorage.getItem('ironfern.best') || '{}'), {}) || {}; }
  function saveBest(m) { safe(() => localStorage.setItem('ironfern.best', JSON.stringify(m))); }

  let ctx = null;
  const S = {
    id: null, title: '', active: false, mode: 'idle', // stand | ride | arrive | clear | down | done | idle
    step: 0, phase: 0, phaseDef: null, obj: null, view: null, note: '', hint: null, t: 0, timer: 0,
    stats: null, checkpoint: null,
  };
  let waveSt = null, records = [], targets = [], ride = null, ambushRecs = null;
  const pick = {}; // spawn name -> next point index

  const newStats = () => ({ killPoints: 0, shots: 0, hits: 0, kills: 0, weakKills: 0, time: 0, damageTaken: 0, deaths: 0, penalty: 0, targets: 0 });
  const mission = () => MISSIONS[S.id];
  const step = () => mission() && mission().plan[S.step];
  const world = () => ctx && ctx.world;
  const banner = (text, sub, kind, dur) => emit('mission:banner', { text, sub: sub || '', kind: kind || 'info', dur: dur || 2.2 });
  const feed = (text, points, kind) => emit('mission:feed', { text, points, kind: kind || 'info' });

  function groundY(x, z, fallback) {
    const w = world();
    const h = w && w.heightAt ? safe(() => w.heightAt(x, z), null) : null;
    return typeof h === 'number' && isFinite(h) ? h : fallback;
  }

  // ---------------------------------------------------------------- camera placement
  function standInfo(name) {
    const w = world(), s = w && w.stands && w.stands[name];
    let lay = null;
    const m = L()[S.id]; if (m) lay = (m.stands || []).find(x => x.name === name);
    const pick = (k, d) => s && s[k] != null ? s[k] : d;
    return {
      pos: s && s.pos ? s.pos.clone() : new THREE.Vector3(0, EYE, 0),
      stand: { yaw: pick('yaw', 0), pitch: pick('pitch', -0.03), arc: pick('arc', lay ? lay.arc : 1.2), pitchMin: pick('pitchMin', -0.6), pitchMax: pick('pitchMax', 0.45) },
    };
  }
  function placeAtStand(name, keepAim) {
    const info = standInfo(name);
    ctx.view.pos.copy(info.pos);
    ctx.view.stand = info.stand;
    ctx.shadowDirty = true;
    if (keepAim && ctx.aim) {
      const a = Object.assign({}, ctx.aim), st = info.stand;
      a.yaw = Math.max(st.yaw - st.arc, Math.min(st.yaw + st.arc, a.yaw));
      ctx.aim = a;
    } else if (DH.Aim) ctx.aim = DH.Aim.create(info.stand);
  }
  function standGround(name) {
    const p = standInfo(name).pos;
    return new THREE.Vector3(p.x, p.y, p.z);
  }
  function point(name) {
    const w = world(), p = w && w.points && w.points[name];
    return p ? p.clone() : null;
  }

  // ---------------------------------------------------------------- spawning
  function spawnPoints(name) {
    const w = world(), sp = w && w.spawns && w.spawns[name];
    if (!sp) return { pts: [], path: null };
    if (Array.isArray(sp)) return { pts: sp, path: null };
    return { pts: sp.points || [], path: sp.path || null };
  }
  function fallbackSpawn(i) {
    const v = ctx.view, yaw = v.stand.yaw + (Math.random() - 0.5) * 1.4, d = 35 + Math.random() * 25;
    const x = v.pos.x - Math.sin(yaw) * d, z = v.pos.z - Math.cos(yaw) * d;
    return new THREE.Vector3(x, groundY(x, z, 0), z);
  }
  /** Spawn one entry; returns the records (one per animal). */
  function spawnEntry(e, waveId, standName) {
    const out = [], n = e.n || 1;
    for (let i = 0; i < n; i++) {
      let at, path;
      if (e.side) {
        const p = ride && ride.cur, sgn = e.side === 'left' ? -1 : 1;
        const base = p || { x: ctx.view.pos.x, z: ctx.view.pos.z, dx: 0, dz: -1 };
        const rx = -base.dz * sgn, rz = base.dx * sgn, lat = 20 + Math.random() * 8, fwd = 8 + i * 4 + Math.random() * 6;
        const x = base.x + rx * lat + base.dx * fwd, z = base.z + rz * lat + base.dz * fwd;
        at = new THREE.Vector3(x, groundY(x, z, ctx.view.pos.y - EYE), z);
      } else {
        const { pts, path: pth } = spawnPoints(e.from);
        if (pts.length) { const k = (pick[e.from] = (pick[e.from] || 0) + 1) - 1; at = pts[k % pts.length].clone(); }
        else at = fallbackSpawn(i);
        if (pth && pth.length) path = pth.map(p => p.clone());
      }
      let target;
      if (e.target === 'survivors') target = point('survivors') || standGround(standName);
      else if (e.target === 'self') target = at.clone();
      else target = e.side ? ctx.view.pos.clone() : standGround(standName);
      const opts = { at, path, target, tagged: !!e.tagged, aggro: e.aggro == null ? 0.7 : e.aggro, delay: (e.stagger || 0) * i };
      if (e.species === 'rex') {
        const c = spawnPoints('rexCircle'), ch = spawnPoints('rexCharge');
        opts.circle = (c.path || c.pts).map(p => p.clone()); opts.charge = (ch.path || ch.pts).map(p => p.clone());
      }
      const D = DH.Dinos;
      let d = D && D.spawn ? safe(() => D.spawn(e.species, opts), null) : null;
      if (!d && e.species === 'dilo' && D && D.spawn) d = safe(() => D.spawn('raptor', opts), null); // no dilo model
      out.push({ d, wave: waveId, ambient: !!e.ambient || e.species === 'grazer', stalker: e.target === 'survivors' });
    }
    return out;
  }
  const alive = r => !!(r.d && r.d.alive);

  // ---------------------------------------------------------------- practice targets
  let plateTex = null;
  function plateTexture() {
    if (plateTex) return plateTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#d9d2bb'; g.fillRect(0, 0, 128, 128);
    const ring = (r, col) => { g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
    ring(62, '#cfc7ad'); ring(50, '#a8382c'); ring(38, '#d9d2bb'); ring(24, '#a8382c'); ring(10, '#1d1c18');
    for (let i = 0; i < 260; i++) { // rust and grime
      g.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${50 + Math.random() * 30 | 0},20,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 4, 1 + Math.random() * 3);
    }
    plateTex = new THREE.CanvasTexture(c); plateTex.encoding = THREE.sRGBEncoding;
    return plateTex;
  }
  function clearTargets() {
    targets.forEach(t => { if (t.group.parent) t.group.parent.remove(t.group); t.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
    targets = [];
  }
  function buildTargets(count, standName) {
    clearTargets();
    let { pts } = spawnPoints('targets');
    const sp = standInfo(standName);
    if (!pts.length) { // fallback: down the road ahead of the stand
      pts = [15, 22, 30, 38, 48, 60].map((d, i) => {
        const yaw = sp.stand.yaw + (i % 2 ? 0.12 : -0.12);
        const x = sp.pos.x - Math.sin(yaw) * d, z = sp.pos.z - Math.cos(yaw) * d;
        return new THREE.Vector3(x, groundY(x, z, sp.pos.y - 2.5 - EYE), z);
      });
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x5e4129, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c8a82, roughness: 0.45, metalness: 0.8 });
    const face = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6, metalness: 0.35 });
    pts.slice(0, count).forEach(p0 => {
      const p = p0.clone(); p.y = groundY(p.x, p.z, p.y);
      const group = new THREE.Group(); group.position.copy(p);
      // big enough to read at 36 m (about a raptor's chest), high enough to clear the undergrowth
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.85, 0.12), wood); post.position.y = 0.925;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), steel); arm.position.set(0, 1.8, 0.08);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 32), [steel, face, steel]);
      plate.rotation.x = Math.PI / 2; plate.position.set(0, 1.8, 0.15);
      [post, arm, plate].forEach(m => { m.castShadow = true; m.receiveShadow = true; group.add(m); });
      group.lookAt(sp.pos.x, p.y, sp.pos.z);
      ctx.scene.add(group);
      targets.push({ group, plate, down: false, fall: 0 });
    });
    return targets.length;
  }
  function ding() {
    if (DH.Audio && DH.Audio.play && DH.Assets && DH.Assets.has && DH.Assets.has('sfx_ding')) { safe(() => DH.Audio.play('sfx_ding')); return; }
    safe(() => {
      const ac = DH.Assets.audioContext(), t = ac.currentTime;
      [1760, 2637, 3520].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f * (0.995 + Math.random() * 0.01);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 / (i + 1), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 - i * 0.2);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 1);
      });
    });
  }
  function knock(t) {
    if (t.down) return;
    t.down = true; S.stats.hits++; S.stats.targets++; S.stats.killPoints += TARGET_PTS;
    ding();
    feed('Plate down', TARGET_PTS, 'target');
    emit('mission:target', { target: t });
    if (S.obj) objective.target(S.obj);
  }
  const _rc = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null, _v = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  function targetsOnShot() {
    const up = targets.filter(t => !t.down);
    if (!up.length || !ctx.aimRay) return false;
    const r = ctx.aimRay();
    _rc.set(r.origin, r.dir); _rc.far = 200;
    const hit = _rc.intersectObjects(up.map(t => t.plate), false)[0];
    if (!hit) return false;
    knock(up.find(t => t.plate === hit.object));
    return true;
  }
  function targetsNear(p) {
    if (!p) return;
    targets.forEach(t => { if (!t.down && t.plate.getWorldPosition(_v).distanceTo(p) < 0.35) knock(t); });
  }

  // ---------------------------------------------------------------- flow
  function snapshot() { return { step: S.step, phase: S.phase, stats: Object.assign({}, S.stats) }; }
  function startStep(i, phase, keepAim) {
    S.step = i;
    const st = step();
    if (!st) return finish();
    if (st.ride) return startRide(st);
    placeAtStand(st.stand, keepAim);
    startPhase(phase || 0);
  }
  function startPhase(k) {
    const st = step(), ph = st.phases[k];
    S.phase = k; S.phaseDef = ph; S.mode = 'stand'; S.t = 0;
    S.checkpoint = snapshot();
    records = []; waveSt = { t: 0, fired: {}, clearedAt: {}, kills: 0 };
    const def = Object.assign({}, ph.objective);
    if (def.type === 'clear') def.planned = plannedCount(ph.waves);
    if (ph.targets) def.count = buildTargets(def.count || 6, st.stand) || def.count;
    S.obj = objective.create(def);
    S.note = ph.note || ''; S.hint = ph.hint || null;
    if (DH.Weapons && DH.Weapons.refill) safe(() => DH.Weapons.refill());
    giveWeapon(ph.weapon);
    emit('mission:phase', { id: S.id, step: S.step, phase: k, stand: st.stand, def: ph });
  }
  function giveWeapon(id) {
    const W = DH.Weapons, ord = DH.WeaponLogic && DH.WeaponLogic.ORDER;
    if (!id || !W || !W.select || !ord) return;
    const i = ord.indexOf(id);
    if (i >= 0 && (!W.current || W.current.id !== id)) safe(() => W.select(i));
  }
  /** The spotter calls out where a wave is coming from. */
  function callout(recs) {
    const live = recs.filter(r => r.d && !r.ambient);
    if (!live.length || !DH.Signs) return;
    const d = live[0].d, v = ctx.view, by = {};
    live.forEach(r => { by[r.d.species] = (by[r.d.species] || 0) + 1; });
    const what = Object.keys(by).map(k => (by[k] > 1 ? by[k] + ' ' : '') + (NAMES[k] || k).toLowerCase() + (by[k] > 1 ? 's' : '')).join(', ');
    const rel = DH.Signs.relBearing(ctx.aim ? ctx.aim.yaw : v.stand.yaw, DH.Signs.bearingTo(v.pos, d.pos));
    const sd = DH.Signs.side(rel), tagged = live.some(r => r.d.tagged);
    const where = sd === 'ahead' ? 'ahead' : sd === 'behind' ? 'behind you' : 'on your ' + sd;
    emit('mission:callout', { text: (tagged ? 'Tagged ' : '') + what + ' ' + where, side: sd });
  }
  function startRide(st) {
    const w = world(), pts = w && w.rails && w.rails[st.ride];
    S.mode = 'ride'; S.phaseDef = null; S.obj = null; S.hint = null;
    giveWeapon('carbine');
    S.note = 'On the move. Watch both sides.';
    S.checkpoint = snapshot();
    if (!pts || pts.length < 2) { ride = null; startStep(S.step + 1, 0, false); return; }
    const r = rail(pts);
    const p0 = r.at(0);
    ride = { r, d: 0, amb: 0, cur: p0, def: st, hold: 0, arrive: null };
    ctx.view.stand = { yaw: Math.atan2(-p0.dx, -p0.dz), pitch: 0, arc: RIDE_ARC, pitchMin: -0.5, pitchMax: 0.4 };
    if (ctx.aim) ctx.aim = Object.assign({}, ctx.aim, { yaw: ctx.view.stand.yaw });
    ctx.view.pos.set(p0.x, p0.y + EYE, p0.z);
    banner('Moving out', 'Next stop: ' + st.to, 'info', 1.6);
  }
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  function updateRide(dt) {
    const rd = ride, r = rd.r, st = rd.def;
    if (rd.arrive) { // ease from the rail end onto the stand
      const A = rd.arrive; A.t = Math.min(1, A.t + dt / 0.9);
      const e = A.t * A.t * (3 - 2 * A.t);
      ctx.view.pos.lerpVectors(A.from, A.to, e);
      const ny = A.yaw0 + angDiff(A.yaw0, A.yaw1) * e, dy = ny - ctx.view.stand.yaw;
      ctx.view.stand.yaw = ny; if (ctx.aim) ctx.aim.yaw += dy;
      if (A.t >= 1) { ride = null; startStep(S.step + 1, 0, true); }
      return;
    }
    if (ambushRecs) { // the jeep stalls until the ambush is dealt with
      rd.hold += dt;
      if (rd.hold > 30 || !ambushRecs.some(alive)) { ambushRecs = null; S.obj = null; S.note = 'Road clear. Moving.'; }
      else return;
    }
    const amb = st.ambush && st.ambush[rd.amb];
    if (amb && rd.d / r.length >= amb.at) {
      rd.amb++; rd.hold = 0;
      ambushRecs = [];
      amb.spawns.forEach(e => { ambushRecs.push(...spawnEntry(e, 'ambush', st.to)); });
      records.push(...ambushRecs);
      callout(ambushRecs);
      S.obj = objective.create({ type: 'clear', label: 'Ambush', planned: ambushRecs.length });
      S.note = 'Ambush! Clear the road.'; S.hint = 'fire';
      banner('AMBUSH', 'Both sides', 'warn', 1.6);
      if (!ambushRecs.some(alive)) { ambushRecs = null; S.obj = null; }
      return;
    }
    const speed = Math.max(1.2, Math.min(RIDE_SPEED, 1.2 + rd.d * 0.9, 1.2 + (r.length - rd.d) * 0.9));
    rd.d = Math.min(r.length, rd.d + speed * dt);
    const p = rd.cur = r.at(rd.d);
    ctx.view.pos.set(p.x, p.y + EYE, p.z);
    const want = Math.atan2(-p.dx, -p.dz), cur = ctx.view.stand.yaw;
    const ny = cur + angDiff(cur, want) * (1 - Math.exp(-dt * 3));
    ctx.view.stand.yaw = ny; if (ctx.aim) ctx.aim.yaw += ny - cur;
    if (rd.d >= r.length - 1e-3) {
      const info = standInfo(st.to);
      rd.arrive = { t: 0, from: ctx.view.pos.clone(), to: info.pos, yaw0: ctx.view.stand.yaw, yaw1: info.stand.yaw };
    }
  }
  function updateStand(dt) {
    const ph = S.phaseDef;
    S.t += dt; waveSt.t = S.t;
    objective.tick(S.obj, dt);
    if (ph.waves) {
      dueWaves(ph.waves, waveSt).forEach(w => {
        waveSt.fired[w.id] = true;
        const recs = [];
        (w.spawns || []).forEach(e => recs.push(...spawnEntry(e, w.id, step().stand)));
        records.push(...recs);
        callout(recs);
      });
      ph.waves.forEach(w => {
        if (waveSt.fired[w.id] && waveSt.clearedAt[w.id] == null && !records.some(r => r.wave === w.id && !r.ambient && alive(r))) waveSt.clearedAt[w.id] = S.t;
      });
      const allFired = ph.waves.every(w => waveSt.fired[w.id]);
      S.obj.cleared = allFired && !records.some(r => !r.ambient && alive(r));
    } else S.obj.cleared = true;
    const v = objective.view(S.obj);
    if (v.failed) return fail(ph.protect ? 'The survivors were taken' : 'Out of time');
    if (v.done) {
      const st = step(), more = S.phase + 1 < st.phases.length;
      S.mode = 'clear'; S.wait = more ? 1.4 : 2.0;
      S.after = more ? () => startPhase(S.phase + 1) : () => startStep(S.step + 1, 0, false);
      banner(more ? 'Objective complete' : (S.step + 1 >= mission().plan.length ? (mission().outro || 'Area secure') : 'Stand clear'), '', 'good', S.wait);
    }
  }
  function fail(text) {
    if (S.mode === 'down' || S.mode === 'done') return;
    S.mode = 'down'; S.wait = 2.8; S.downText = text;
    if (DH.Dinos && DH.Dinos.reset) safe(() => DH.Dinos.reset(ctx));
    ambushRecs = null;
    banner(text, 'Back to the last checkpoint', 'bad', 2.8);
  }
  function restart(fromCheckpoint, countDeath) {
    const cp = S.checkpoint || { step: 0, phase: 0, stats: newStats() };
    if (DH.Dinos && DH.Dinos.reset) safe(() => DH.Dinos.reset(ctx));
    S.stats = Object.assign({}, cp.stats);
    if (countDeath) S.stats.deaths++;
    const p = ctx.player; p.hp = p.maxHp || 100; p.ducking = false; p.dodgeT = 0; p.dodgeReadyAt = 0;
    ride = null; ambushRecs = null;
    const st = mission().plan[cp.step];
    if (st && st.ride) { S.step = cp.step; startRide(st); }
    else startStep(cp.step, fromCheckpoint ? cp.phase : 0, false);
    emit('mission:retry', { id: S.id, step: S.step, phase: S.phase });
  }
  function finish() {
    S.mode = 'done';
    clearTargets();
    const m = mission(), sc = scoreResult(S.stats, m);
    const mb = mergeBest(loadBest(), S.id, sc);
    saveBest(mb.map);
    const ord = (DH.Layout && DH.Layout.ORDER) || Object.keys(MISSIONS);
    const result = Object.assign({ id: S.id, title: S.title, next: ord[ord.indexOf(S.id) + 1] || null }, sc, {
      kills: S.stats.kills, weakKills: S.stats.weakKills, shots: S.stats.shots, hits: S.stats.hits, targets: S.stats.targets,
      time: S.stats.time, deaths: S.stats.deaths, damageTaken: S.stats.damageTaken, best: mb.map[S.id], newBest: mb.newBest, thresholds: m.stars,
    });
    S.active = false;
    emit('mission:end', { id: S.id, result });
    if (DH.Core && DH.Core.go) DH.Core.go('results', result);
  }
  function abort() {
    S.active = false; S.mode = 'idle'; ride = null; ambushRecs = null; records = [];
    clearTargets();
    if (DH.Dinos && DH.Dinos.reset && ctx) safe(() => DH.Dinos.reset(ctx));
  }

  // ---------------------------------------------------------------- events
  function hook(c) {
    const on = (e, f) => DH.bus.on(e, d => { if (S.active) f(d || {}); });
    const playing = () => S.mode === 'stand' || S.mode === 'ride' || S.mode === 'clear';
    on('shot:fired', () => { if (!playing()) return; S.stats.shots++; targetsOnShot(); });
    on('shot:miss', d => targetsNear(d.point));
    on('shot:hit', d => {
      if (!playing()) return;
      S.stats.hits++;
      const sp = d.dino && d.dino.species;
      if (sp === 'grazer' && !d.killed) { S.stats.penalty += 50; feed('Grazer hit', -50, 'penalty'); }
    });
    on('dino:dead', d => {
      if (d.byPlayer === false || S.mode === 'down') return;
      const sp = d.species || (d.dino && d.dino.species), tagged = d.tagged != null ? d.tagged : !!(d.dino && d.dino.tagged);
      const pts = killPoints(sp, d.zone), weak = isWeak(d.zone) && pts > 0;
      S.stats.killPoints += pts; if (pts > 0) S.stats.kills++; if (weak) S.stats.weakKills++;
      if (S.obj) objective.kill(S.obj, { species: sp, tagged });
      if (waveSt) waveSt.kills++;
      if (pts < 0) feed((NAMES[sp] || 'Animal') + ' killed', pts, 'penalty');
      else feed(weak ? WEAK_LABEL[d.zone] : (NAMES[sp] || 'Target') + ' down', pts, weak ? 'weak' : 'kill');
      // a kill inside ADRENALINE (feel.js) pays half again
      if (pts > 0 && DH.Feel && DH.Feel.adrenaline()) { const b = Math.round(pts / 2); S.stats.killPoints += b; feed('Clutch', b, 'weak'); }
    });
    on('player:hurt', d => { S.stats.damageTaken += d.damage || 0; });
    on('player:dead', () => { if (playing()) fail('You were taken down'); });
    on('dino:reached', d => {
      if (!S.phaseDef || !S.phaseDef.protect || !playing()) return;
      const rec = records.find(r => r.d && r.d === d.dino);
      if ((rec && rec.stalker) || (d.dino && d.dino.tagged)) fail('The survivors were taken');
    });
    DH.bus.on('state', d => { if (S.active && (d.state === 'select' || d.state === 'title')) abort(); });
  }

  // ---------------------------------------------------------------- public API
  DH.Missions = {
    MISSIONS, state: S,
    /** The practice plates (HUD markers, automated play). */
    targets: () => targets,
    init(c) { ctx = c; if (DH.bus) hook(c); },
    list() {
      const best = loadBest(), lay = L();
      const ord = (DH.Layout && DH.Layout.ORDER) || Object.keys(MISSIONS);
      return ord.map(id => ({ id, title: (lay[id] && lay[id].title) || id, blurb: (lay[id] && lay[id].blurb) || '', best: best[id] || null,
        brief: MISSIONS[id] && MISSIONS[id].brief, objective: MISSIONS[id] && MISSIONS[id].objectiveText, controls: MISSIONS[id] ? MISSIONS[id].controls : [] }));
    },
    info(id) { return this.list().find(m => m.id === id) || null; },
    start(id, c) {
      ctx = c || ctx;
      if (!MISSIONS[id]) { console.warn('[missions] unknown mission', id); return; }
      abort();
      for (const k in pick) delete pick[k];
      S.id = id; S.title = (L()[id] && L()[id].title) || id;
      S.stats = newStats(); S.active = true; S.checkpoint = null;
      startStep(0, 0, false);
    },
    update(dt, c, f) {
      ctx = c || ctx;
      if (!S.active) return;
      if (S.mode !== 'down' && S.mode !== 'done') S.stats.time += dt;
      // knocked-over plates fall back on their base
      targets.forEach(t => { if (t.down && t.fall < 1) { t.fall = Math.min(1, t.fall + dt * 3.2); t.group.rotation.x = -1.45 * t.fall * t.fall; t.group.updateMatrixWorld(); } });
      // never a dead end: a dry gun with no reserve gets a resupply after a beat
      const W = DH.Weapons, w = W && W.current;
      if (w && w.mag === 0 && w.reserve === 0 && !w.reloading && (S.mode === 'stand' || S.mode === 'ride')) {
        S.dryT = (S.dryT || 0) + dt;
        if (S.dryT > 1.2) { S.dryT = 0; if (W.refill) safe(() => W.refill()); feed('Ammo resupplied', 0, 'info'); }
      } else S.dryT = 0;
      if (S.mode === 'stand') updateStand(dt);
      else if (S.mode === 'ride' && ride) updateRide(dt);
      else if (S.mode === 'clear' || S.mode === 'down') {
        S.wait -= dt;
        if (S.wait <= 0) { if (S.mode === 'down') restart(true, true); else { const a = S.after; S.after = null; a && a(); } }
      }
      S.view = S.obj ? objective.view(S.obj) : null;
    },
    /** Restart the current stand from its first phase (pause menu). */
    retryStand() { if (S.id && mission()) { S.active = true; restart(false, false); } },
    /** Dev/testing: complete the current objective. */
    skip() {
      if (!S.active) return;
      if (S.mode === 'ride' && ride) { ambushRecs = null; ride.d = ride.r.length; ride.amb = 99; return; }
      if (S.obj) { S.obj.have = S.obj.need; S.obj.cleared = true; S.obj.elapsed = Math.max(S.obj.elapsed, S.obj.def.time || 0); }
      if (S.phaseDef && S.phaseDef.waves) S.phaseDef.waves.forEach(w => { waveSt.fired[w.id] = true; });
    },
    abort,
    pure: Pure,
  };
})(typeof window !== 'undefined' ? window : this);
